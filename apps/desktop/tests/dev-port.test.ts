import { afterEach, describe, expect, it } from "bun:test";
import http from "node:http";
import net from "node:net";
import {
    allocateEphemeralPort,
    DEV_PING_APP_ID,
    DEV_PING_PATH,
    findAvailableDevPort,
    isTcpPortAvailable,
    ViteEarlyExitError,
    waitForOwnedDevServer,
} from "../scripts/dev-server-utils.ts";

const activeServers: Array<net.Server | http.Server> = [];

async function occupyTcpPort(host = "127.0.0.1", port = 0): Promise<{ server: net.Server; port: number }> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen({ host, port, exclusive: true }, () => {
            const addr = server.address();
            const boundPort = typeof addr === "object" && addr ? addr.port : 0;
            activeServers.push(server);
            resolve({ server, port: boundPort });
        });
    });
}

async function startHttpServer(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string; port: number }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handler);
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            const boundPort = typeof addr === "object" && addr ? addr.port : 0;
            activeServers.push(server);
            resolve({ server, url: `http://127.0.0.1:${boundPort}`, port: boundPort });
        });
    });
}

afterEach(async () => {
    while (activeServers.length > 0) {
        const srv = activeServers.pop()!;
        await new Promise<void>(resolve => {
            try {
                srv.close(() => resolve());
            } catch {
                resolve();
            }
        });
    }
});

describe("dev server port fallback & Vite identity handshake", () => {
    it("automatically skips an occupied preferred port and returns a verified free port", async () => {
        const busy = await occupyTcpPort("127.0.0.1", 0);
        expect(await isTcpPortAvailable("127.0.0.1", busy.port)).toBe(false);

        const picked = await findAvailableDevPort(busy.port, { host: "127.0.0.1", maxAttempts: 10 });
        expect(picked.fallbackUsed).toBe(true);
        expect(picked.preferredPort).toBe(busy.port);
        expect(picked.port).not.toBe(busy.port);
        expect(await isTcpPortAvailable("127.0.0.1", picked.port)).toBe(true);
    });

    it("falls back to an OS-assigned ephemeral port when all sequential attempts are occupied", async () => {
        const busy1 = await occupyTcpPort("127.0.0.1", 0);
        // Restrict maxAttempts to 1 so sequential probing exhausts immediately on busy1.port
        const picked = await findAvailableDevPort(busy1.port, { host: "127.0.0.1", maxAttempts: 1 });
        expect(picked.fallbackUsed).toBe(true);
        expect(picked.port).not.toBe(busy1.port);
        expect(picked.port).toBeGreaterThan(0);
        expect(await isTcpPortAvailable("127.0.0.1", picked.port)).toBe(true);
    });

    it("returns preferred port directly when free", async () => {
        const freePort = await allocateEphemeralPort("127.0.0.1");
        const picked = await findAvailableDevPort(freePort, { host: "127.0.0.1", maxAttempts: 5 });
        expect(picked.port).toBe(freePort);
        expect(picked.fallbackUsed).toBe(false);
    });

    it("succeeds ONLY when our Vite ping endpoint returns the matching nonce", async () => {
        const expectedNonce = "nonce-moesekai-12345";
        const owned = await startHttpServer((req, res) => {
            if (req.url === DEV_PING_PATH) {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ app: DEV_PING_APP_ID, nonce: expectedNonce }));
                return;
            }
            res.writeHead(404);
            res.end("not found");
        });

        const neverExits = new Promise<number>(() => {});
        await expect(
            waitForOwnedDevServer({
                url: owned.url,
                expectedNonce,
                viteExited: neverExits,
                timeoutMs: 3000,
                pollMs: 40,
            }),
        ).resolves.toBeUndefined();
    });

    it("rejects a foreign 200 OK HTTP server with wrong body/nonce and never mistakes it for our Vite server", async () => {
        const foreign = await startHttpServer((_req, res) => {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<html><body>Unrelated app running on port 5173</body></html>");
        });

        const neverExits = new Promise<number>(() => {});
        await expect(
            waitForOwnedDevServer({
                url: foreign.url,
                expectedNonce: "my-secret-nonce",
                viteExited: neverExits,
                timeoutMs: 350,
                pollMs: 40,
            }),
        ).rejects.toThrow(/another process answered/i);
    });

    it("aborts immediately with ViteEarlyExitError if Vite exits before becoming ready", async () => {
        const unusedPort = await allocateEphemeralPort("127.0.0.1");
        const startedAt = Date.now();
        const earlyExit = new Promise<number>(resolve => setTimeout(() => resolve(1), 60));

        let caught: unknown;
        try {
            await waitForOwnedDevServer({
                url: `http://127.0.0.1:${unusedPort}`,
                expectedNonce: "expected-nonce",
                viteExited: earlyExit,
                timeoutMs: 10_000,
                pollMs: 50,
            });
        } catch (err) {
            caught = err;
        }

        const elapsed = Date.now() - startedAt;
        expect(caught).toBeInstanceOf(ViteEarlyExitError);
        expect((caught as ViteEarlyExitError).exitCode).toBe(1);
        // Must abort right away, nowhere near the 10s timeout
        expect(elapsed).toBeLessThan(1500);
    });
});
