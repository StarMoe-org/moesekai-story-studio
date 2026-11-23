import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    encodeIcns,
    encodeIco,
    ICO_SIZES,
    ICNS_CHUNKS,
} from "../scripts/generate-icons.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const buildDir = path.join(appRoot, "build");
const PNG_MAGIC = "89504e470d0a1a0a";

describe("MoeSekai Story Studio native app icon assets", () => {
    it("ships flat pure-vector canonical SVG without gradients, filters, or text", () => {
        const buildSvgPath = path.join(buildDir, "icon.svg");
        const publicSvgPath = path.join(appRoot, "src/renderer/public/icon.svg");

        expect(fs.existsSync(buildSvgPath)).toBe(true);
        expect(fs.existsSync(publicSvgPath)).toBe(true);

        for (const svgFile of [buildSvgPath, publicSvgPath]) {
            const text = fs.readFileSync(svgFile, "utf8");
            expect(text).toContain('viewBox="0 0 512 512"');
            expect(text).toContain("#116B65");
            expect(text).toContain("#FFFFFF");
            expect(text).toContain("#5EEAD4");
            expect(text).not.toMatch(/<(linearGradient|radialGradient|filter|text)\b/i);
        }
    });

    it("provides a crisp 512x512 RGBA PNG at build/icon.png", () => {
        const pngPath = path.join(buildDir, "icon.png");
        expect(fs.existsSync(pngPath)).toBe(true);

        const png = fs.readFileSync(pngPath);
        expect(png.byteLength).toBeGreaterThan(4096);
        expect(png.subarray(0, 8).toString("hex")).toBe(PNG_MAGIC);
        expect(png.readUInt32BE(16)).toBe(512);
        expect(png.readUInt32BE(20)).toBe(512);
        expect(png[25]).toBe(6); // RGBA color type
    });

    it("provides a valid multi-size Windows ICO at build/icon.ico with all 7 PNG entries", () => {
        const icoPath = path.join(buildDir, "icon.ico");
        expect(fs.existsSync(icoPath)).toBe(true);

        const ico = fs.readFileSync(icoPath);
        expect(ico.subarray(0, 4).toString("hex")).toBe("00000100");
        const count = ico.readUInt16LE(4);
        expect(count).toBe(ICO_SIZES.length);

        const foundSizes: number[] = [];
        for (let i = 0; i < count; i++) {
            const dirOff = 6 + i * 16;
            const width = ico[dirOff] === 0 ? 256 : ico[dirOff];
            const height = ico[dirOff + 1] === 0 ? 256 : ico[dirOff + 1];
            const byteLen = ico.readUInt32LE(dirOff + 8);
            const dataOff = ico.readUInt32LE(dirOff + 12);
            const entry = ico.subarray(dataOff, dataOff + byteLen);

            expect(width).toBe(height);
            expect(byteLen).toBeGreaterThan(400);
            expect(entry.subarray(0, 8).toString("hex")).toBe(PNG_MAGIC);
            expect(entry.readUInt32BE(16)).toBe(width);
            expect(entry.readUInt32BE(20)).toBe(height);
            foundSizes.push(width);
        }

        expect(foundSizes).toEqual([...ICO_SIZES]);
    });

    it("provides a valid Apple ICNS at build/icon.icns with all standard PNG chunks", () => {
        const icnsPath = path.join(buildDir, "icon.icns");
        expect(fs.existsSync(icnsPath)).toBe(true);

        const icns = fs.readFileSync(icnsPath);
        expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
        expect(icns.readUInt32BE(4)).toBe(icns.byteLength);

        const found: Array<{ type: string; size: number }> = [];
        let offset = 8;
        while (offset < icns.byteLength) {
            const type = icns.subarray(offset, offset + 4).toString("ascii");
            const chunkLen = icns.readUInt32BE(offset + 4);
            expect(chunkLen).toBeGreaterThan(400);
            const payload = icns.subarray(offset + 8, offset + chunkLen);
            expect(payload.subarray(0, 8).toString("hex")).toBe(PNG_MAGIC);
            const width = payload.readUInt32BE(16);
            const height = payload.readUInt32BE(20);
            expect(width).toBe(height);
            found.push({ type, size: width });
            offset += chunkLen;
        }

        expect(offset).toBe(icns.byteLength);
        expect(found).toEqual(ICNS_CHUNKS.map(c => ({ type: c.type, size: c.size })));
    });

    it("wires native icon paths into electron-builder.yml and encodes minimal ICO/ICNS headers cleanly", () => {
        const builderYml = fs.readFileSync(path.join(appRoot, "electron-builder.yml"), "utf8");
        expect(builderYml).toContain("icon: build/icon.ico");
        expect(builderYml).toContain("installerIcon: build/icon.ico");
        expect(builderYml).toContain("uninstallerIcon: build/icon.ico");
        expect(builderYml).toContain("icon: build/icon.icns");
        expect(builderYml).toContain("icon: build/icon.png");

        const dummy = Buffer.from("89504e470d0a1a0a", "hex");
        const ico = encodeIco([{ size: 256, png: dummy }]);
        expect(ico.subarray(0, 4).toString("hex")).toBe("00000100");
        expect(ico[6]).toBe(0); // 256 encoded as 0

        const icns = encodeIcns([{ type: "ic07", png: dummy }]);
        expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
        expect(icns.readUInt32BE(4)).toBe(8 + 8 + dummy.byteLength);
    });
});
