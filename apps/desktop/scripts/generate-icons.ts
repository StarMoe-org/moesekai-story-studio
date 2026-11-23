/**
 * Reproducible cross-platform app icon generator for MoeSekai Story Studio.
 *
 * Rasterizes `build/icon.svg` through Electron's Chromium `<canvas>` engine (preserving true
 * 32-bit RGBA alpha transparency outside the squircle at exact 1:1 pixel dimensions regardless
 * of host DPI scaling), then encodes:
 * - `build/icon.png`  (512x512 RGBA PNG for Linux AppImage & runtime BrowserWindow)
 * - `build/icon.ico`  (multi-size Windows ICO: 16, 24, 32, 48, 64, 128, 256 PNG-in-ICO entries)
 * - `build/icon.icns` (Apple ICNS with Big Sur+ ~9.77% outer margin & modern PNG chunks)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const buildDir = path.join(appRoot, "build");
const svgPath = path.join(buildDir, "icon.svg");

export interface IcoImageEntry {
    size: number;
    png: Buffer;
}

export interface IcnsChunkEntry {
    type: string;
    png: Buffer;
}

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

export const ICNS_CHUNKS: ReadonlyArray<{ type: string; size: number }> = [
    { type: "icp4", size: 16 },
    { type: "icp5", size: 32 },
    { type: "icp6", size: 64 },
    { type: "ic07", size: 128 },
    { type: "ic08", size: 256 },
    { type: "ic09", size: 512 },
    { type: "ic10", size: 1024 },
    { type: "ic11", size: 32 },
    { type: "ic12", size: 64 },
    { type: "ic13", size: 256 },
    { type: "ic14", size: 512 },
];

/** Apple macOS Big Sur+ Dock icon margin (~100px per 1024px = 9.765625% on each side). */
const MAC_ICON_MARGIN_RATIO = 100 / 1024;

/**
 * Encodes a spec-compliant Windows ICO containing PNG-compressed RGBA images.
 */
export function encodeIco(entries: ReadonlyArray<IcoImageEntry>): Buffer {
    if (entries.length === 0) {
        throw new Error("encodeIco requires at least one entry.");
    }
    const headerSize = 6 + entries.length * 16;
    const totalSize = headerSize + entries.reduce((sum, e) => sum + e.png.byteLength, 0);
    const out = Buffer.alloc(totalSize);

    // ICONDIR header: reserved=0, type=1 (ICO), count=entries.length
    out.writeUInt16LE(0, 0);
    out.writeUInt16LE(1, 2);
    out.writeUInt16LE(entries.length, 4);

    let dataOffset = headerSize;
    for (let i = 0; i < entries.length; i++) {
        const { size, png } = entries[i];
        const dirOffset = 6 + i * 16;
        const dimByte = size >= 256 ? 0 : size;

        out.writeUInt8(dimByte, dirOffset + 0); // width (0 means 256)
        out.writeUInt8(dimByte, dirOffset + 1); // height (0 means 256)
        out.writeUInt8(0, dirOffset + 2); // palette color count
        out.writeUInt8(0, dirOffset + 3); // reserved
        out.writeUInt16LE(1, dirOffset + 4); // color planes
        out.writeUInt16LE(32, dirOffset + 6); // bits per pixel
        out.writeUInt32LE(png.byteLength, dirOffset + 8); // image bytes
        out.writeUInt32LE(dataOffset, dirOffset + 12); // offset from start of file

        png.copy(out, dataOffset);
        dataOffset += png.byteLength;
    }

    return out;
}

/**
 * Encodes a spec-compliant Apple ICNS archive containing modern PNG chunks.
 */
export function encodeIcns(chunks: ReadonlyArray<IcnsChunkEntry>): Buffer {
    if (chunks.length === 0) {
        throw new Error("encodeIcns requires at least one chunk.");
    }
    const totalSize = 8 + chunks.reduce((sum, c) => sum + 8 + c.png.byteLength, 0);
    const out = Buffer.alloc(totalSize);

    out.write("icns", 0, 4, "ascii");
    out.writeUInt32BE(totalSize, 4);

    let offset = 8;
    for (const chunk of chunks) {
        if (chunk.type.length !== 4) {
            throw new Error(`Invalid ICNS OSType: ${chunk.type}`);
        }
        const chunkLen = 8 + chunk.png.byteLength;
        out.write(chunk.type, offset, 4, "ascii");
        out.writeUInt32BE(chunkLen, offset + 4);
        chunk.png.copy(out, offset + 8);
        offset += chunkLen;
    }

    return out;
}

interface RasterTask {
    key: string;
    size: number;
    marginRatio: number;
}

async function rasterizeTasksViaElectron(
    svgText: string,
    tasks: ReadonlyArray<RasterTask>,
): Promise<Map<string, Buffer>> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "moesekai-icon-gen-"));
    const scriptPath = path.join(tmpDir, "rasterize.cjs");
    const manifestPath = path.join(tmpDir, "manifest.json");
    const outputPath = path.join(tmpDir, "outputs.json");

    fs.writeFileSync(manifestPath, JSON.stringify({ svgText, tasks }), "utf8");

    const helperCode = `
const fs = require("node:fs");
const { app, BrowserWindow } = require("electron");

// Software rasterization avoids transient GPU process resets during offscreen canvas draws.
app.disableHardwareAcceleration();

const manifestPath = process.argv[process.argv.length - 2];
const outputPath = process.argv[process.argv.length - 1];
const { svgText, tasks } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 64,
    height: 64,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const html = "<!doctype html><html><body style='margin:0;background:transparent;'></body></html>";
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));

  const payload = JSON.stringify({
    svgDataUri: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText),
    tasks,
  });

  const rendered = await win.webContents.executeJavaScript(\`(async () => {
    const { svgDataUri, tasks } = \${payload};
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(new Error("Failed to decode SVG in Chromium"));
      img.src = svgDataUri;
    });

    const out = {};
    for (const task of tasks) {
      const canvas = document.createElement("canvas");
      canvas.width = task.size;
      canvas.height = task.size;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, task.size, task.size);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const pad = Math.round(task.size * task.marginRatio);
      const drawSize = task.size - pad * 2;
      ctx.drawImage(img, pad, pad, drawSize, drawSize);
      const dataUrl = canvas.toDataURL("image/png");
      out[task.key] = dataUrl.slice("data:image/png;base64,".length);
    }
    return out;
  })()\`);

  fs.writeFileSync(outputPath, JSON.stringify(rendered), "utf8");
  app.exit(0);
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
`;
    fs.writeFileSync(scriptPath, helperCode, "utf8");

    try {
        const proc = Bun.spawn(["bunx", "electron", scriptPath, manifestPath, outputPath], {
            cwd: appRoot,
            stdout: "inherit",
            stderr: "inherit",
        });
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
            throw new Error(`Electron icon rasterizer exited with code ${exitCode}`);
        }
        const raw = JSON.parse(fs.readFileSync(outputPath, "utf8")) as Record<string, string>;
        const result = new Map<string, Buffer>();
        for (const [k, b64] of Object.entries(raw)) {
            result.set(k, Buffer.from(b64, "base64"));
        }
        return result;
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

async function generateAllIcons(): Promise<void> {
    if (!fs.existsSync(svgPath)) {
        throw new Error(`Canonical SVG not found at ${svgPath}`);
    }
    const svgText = fs.readFileSync(svgPath, "utf8");

    const tasks: RasterTask[] = [];
    // Tight full-bleed squircle sizes for Windows ICO & Linux 512px PNG
    for (const size of [...ICO_SIZES, 512]) {
        tasks.push({ key: `tight-${size}`, size, marginRatio: 0 });
    }
    // macOS Big Sur+ Dock-padded sizes (~9.77% outer transparent margin)
    const macUniqueSizes = Array.from(new Set(ICNS_CHUNKS.map(c => c.size)));
    for (const size of macUniqueSizes) {
        tasks.push({ key: `mac-${size}`, size, marginRatio: MAC_ICON_MARGIN_RATIO });
    }

    console.log(`[desktop:icons] Rasterizing ${tasks.length} PNG variants from build/icon.svg...`);
    const rendered = await rasterizeTasksViaElectron(svgText, tasks);

    // 1. build/icon.png (512x512 RGBA PNG)
    const png512 = rendered.get("tight-512");
    if (!png512) throw new Error("Missing tight-512 rasterization");
    const pngPath = path.join(buildDir, "icon.png");
    fs.writeFileSync(pngPath, png512);

    // 2. build/icon.ico (multi-size Windows ICO)
    const icoEntries: IcoImageEntry[] = ICO_SIZES.map(size => {
        const png = rendered.get(`tight-${size}`);
        if (!png) throw new Error(`Missing tight-${size} rasterization`);
        return { size, png };
    });
    const icoBuf = encodeIco(icoEntries);
    const icoPath = path.join(buildDir, "icon.ico");
    fs.writeFileSync(icoPath, icoBuf);

    // 3. build/icon.icns (Apple ICNS)
    const icnsChunks: IcnsChunkEntry[] = ICNS_CHUNKS.map(({ type, size }) => {
        const png = rendered.get(`mac-${size}`);
        if (!png) throw new Error(`Missing mac-${size} rasterization`);
        return { type, png };
    });
    const icnsBuf = encodeIcns(icnsChunks);
    const icnsPath = path.join(buildDir, "icon.icns");
    fs.writeFileSync(icnsPath, icnsBuf);

    console.log(
        `[desktop:icons] Generated:\n` +
            `  - ${path.relative(appRoot, pngPath)} (${png512.byteLength} bytes, 512x512 RGBA)\n` +
            `  - ${path.relative(appRoot, icoPath)} (${icoBuf.byteLength} bytes, ${icoEntries.length} sizes)\n` +
            `  - ${path.relative(appRoot, icnsPath)} (${icnsBuf.byteLength} bytes, ${icnsChunks.length} chunks)`,
    );
}

if (import.meta.main) {
    await generateAllIcons();
}
