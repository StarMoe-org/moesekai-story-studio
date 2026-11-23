import net from "node:net";

export const DEV_PING_PATH = "/__moesekai_desktop_dev_ping__";
export const DEV_PING_APP_ID = "moesekai-story-studio-desktop";

export class ViteEarlyExitError extends Error {
    readonly exitCode: number;

    constructor(exitCode: number) {
        super(`Vite dev server exited unexpectedly (code ${exitCode}) before becoming ready.`);
        this.name = "ViteEarlyExitError";
        this.exitCode = exitCode;
    }
}

function canBindPort(host: string, port: number): Promise<{ free: boolean; unavailableHost?: boolean }> {
    return new Promise(resolve => {
        const server = net.createServer();
        server.unref();

        server.once("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EADDRNOTAVAIL" || err.code === "EAFNOSUPPORT") {
                resolve({ free: true, unavailableHost: true });
                return;
            }
            resolve({ free: false });
        });

        server.listen({ host, port, exclusive: true }, () => {
            server.close(() => resolve({ free: true }));
        });
    });
}

/**
 * Checks whether `port` is available on `host` (and on `::1` as well when `host` is `127.0.0.1`
 * so servers bound to IPv6 `localhost` don't cause silent conflicts).
 */
export async function isTcpPortAvailable(host: string, port: number): Promise<boolean> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
    const primary = await canBindPort(host, port);
    if (!primary.free) return false;
    if (host === "127.0.0.1") {
        const ipv6 = await canBindPort("::1", port);
        if (!ipv6.free) return false;
    }
    return true;
}

/**
 * Requests an OS-assigned free ephemeral TCP port on `host`.
 */
export function allocateEphemeralPort(host = "127.0.0.1"): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once("error", reject);
        server.listen({ host, port: 0, exclusive: true }, () => {
            const addr = server.address();
            const port = typeof addr === "object" && addr ? addr.port : 0;
            server.close(err => {
                if (err) reject(err);
                else if (port > 0) resolve(port);
                else reject(new Error("Failed to allocate ephemeral TCP port."));
            });
        });
    });
}

export interface FindAvailableDevPortOptions {
    host?: string;
    maxAttempts?: number;
}

export interface AvailableDevPortResult {
    port: number;
    preferredPort: number;
    fallbackUsed: boolean;
}

/**
 * Probes `preferredPort`, advancing sequentially while occupied, and falls back
 * to an OS-assigned free port if all sequential candidates are busy.
 */
export async function findAvailableDevPort(
    preferredPort: number,
    options: FindAvailableDevPortOptions = {},
): Promise<AvailableDevPortResult> {
    const host = options.host ?? "127.0.0.1";
    const maxAttempts = Math.max(1, options.maxAttempts ?? 25);
    const basePort = Number.isInteger(preferredPort) && preferredPort >= 1024 && preferredPort <= 65535
        ? preferredPort
        : 5173;

    for (let offset = 0; offset < maxAttempts; offset++) {
        const candidate = basePort + offset;
        if (candidate > 65535) break;
        if (await isTcpPortAvailable(host, candidate)) {
            return {
                port: candidate,
                preferredPort: basePort,
                fallbackUsed: candidate !== basePort,
            };
        }
    }

    const ephemeral = await allocateEphemeralPort(host);
    return {
        port: ephemeral,
        preferredPort: basePort,
        fallbackUsed: true,
    };
}

export interface WaitForOwnedDevServerOptions {
    url: string;
    expectedNonce: string;
    viteExited: Promise<number>;
    timeoutMs?: number;
    pollMs?: number;
}

/**
 * Polls `${url}${DEV_PING_PATH}` until OUR Vite instance answers with the matching
 * random nonce, racing continuously against `viteExited` so an early Vite crash aborts
 * immediately and a foreign server on the same port can NEVER masquerade as ours.
 */
export async function waitForOwnedDevServer(options: WaitForOwnedDevServerOptions): Promise<void> {
    const {
        url,
        expectedNonce,
        viteExited,
        timeoutMs = 20_000,
        pollMs = 180,
    } = options;

    const pingUrl = `${url.replace(/\/+$/, "")}${DEV_PING_PATH}`;
    const deadline = Date.now() + timeoutMs;

    const exitState: { code: number | null } = { code: null };
    const exitSignal = viteExited.then(code => {
        exitState.code = code;
        return { kind: "exited" as const, code };
    });

    let sawForeignResponse = false;

    while (Date.now() < deadline) {
        if (exitState.code !== null) {
            throw new ViteEarlyExitError(exitState.code);
        }

        const attempt = (async () => {
            try {
                const res = await fetch(pingUrl, {
                    cache: "no-store",
                    signal: AbortSignal.timeout(1500),
                });
                if (!res.ok) {
                    sawForeignResponse = true;
                    return { kind: "not-ready" as const };
                }
                const data = (await res.json().catch(() => null)) as { app?: unknown; nonce?: unknown } | null;
                if (data?.app === DEV_PING_APP_ID && data?.nonce === expectedNonce) {
                    return { kind: "ready" as const };
                }
                sawForeignResponse = true;
                return { kind: "not-ready" as const };
            } catch {
                return { kind: "not-ready" as const };
            }
        })();

        const outcome = await Promise.race([attempt, exitSignal]);
        if (outcome.kind === "exited") {
            throw new ViteEarlyExitError(outcome.code);
        }
        if (outcome.kind === "ready") {
            return;
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        const sleepOutcome = await Promise.race([
            new Promise<{ kind: "slept" }>(resolve => setTimeout(() => resolve({ kind: "slept" }), Math.min(pollMs, remaining))),
            exitSignal,
        ]);
        if (sleepOutcome.kind === "exited") {
            throw new ViteEarlyExitError(sleepOutcome.code);
        }
    }

    if (sawForeignResponse) {
        throw new Error(
            `Timed out waiting for MoeSekai Vite dev server at ${url} (another process answered on that port with an unexpected response).`,
        );
    }
    throw new Error(`Timed out waiting for MoeSekai Vite dev server at ${url}.`);
}
