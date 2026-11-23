#!/usr/bin/env bun
/**
 * MoeSekai Story Studio — Parallel Headless Chromium CDP + FFmpeg 1080p60 Renderer
 * Zero external npm dependencies (uses Bun's native HTTP server, WebSocket, and spawn).
 *
 * Modes:
 *   bun render.ts --mode video --timeline timeline.json --audio master.wav --out out.mp4 [--workers 6]
 *   bun render.ts --mode cover --timeline timeline.json --out bilibili-cover.png
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const ENGINE_DIR = import.meta.dir;
const VIDEO_DIR = path.resolve(ENGINE_DIR, "..");
const CAPTURES_DIR = path.join(REPO_ROOT, "promo", "captures");
const WORK_DIR = path.join(VIDEO_DIR, "work");
const BRAND_ICON_SVG = path.join(REPO_ROOT, "apps", "desktop", "build", "icon.svg");

const USER_FONTS_DIR = path.join(os.homedir(), "AppData", "Local", "Microsoft", "Windows", "Fonts");
const SYS_FONTS_DIR = "C:\\Windows\\Fonts";

const FONT_MAP: Record<string, string[]> = {
  "FOT-RodinNTLG-Pro-B.otf": [path.join(USER_FONTS_DIR, "FOT-RodinNTLG Pro B.otf")],
  "MiSans-Regular.ttf": [path.join(USER_FONTS_DIR, "MiSans-Regular.ttf"), path.join(SYS_FONTS_DIR, "MiSans-Regular.otf")],
  "MiSans-Medium.ttf": [path.join(USER_FONTS_DIR, "MiSans-Medium.ttf")],
  "MiSans-Bold.ttf": [path.join(USER_FONTS_DIR, "MiSans-Bold.ttf")],
  "MiSans-Heavy.ttf": [path.join(USER_FONTS_DIR, "MiSans-Heavy.ttf")],
  "NotoSansCJKsc-Black.otf": [path.join(USER_FONTS_DIR, "NotoSansCJKsc-Black.otf")],
  "CascadiaCode.ttf": [path.join(SYS_FONTS_DIR, "CascadiaCode.ttf")],
};

function findChromeBinary(): { bin: string; isHeadlessShell: boolean } {
  const shellCandidates = [
    path.join(os.homedir(), "AppData", "Local", "ms-playwright", "chromium_headless_shell-1243", "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
    path.join(os.homedir(), "AppData", "Local", "ms-playwright", "chromium_headless_shell-1223", "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
  ];
  for (const p of shellCandidates) {
    if (fs.existsSync(p)) return { bin: p, isHeadlessShell: true };
  }
  const fullCandidates = [
    path.join(os.homedir(), "AppData", "Local", "ms-playwright", "chromium-1243", "chrome-win64", "chrome.exe"),
    path.join(os.homedir(), "AppData", "Local", "ms-playwright", "chromium-1223", "chrome-win64", "chrome.exe"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const p of fullCandidates) {
    if (fs.existsSync(p)) return { bin: p, isHeadlessShell: false };
  }
  throw new Error("Could not locate Chrome/Chromium executable.");
}

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    }
  }
  return out;
}

class CDPClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer));
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
        else p.resolve(msg.result);
      }
    };
  }

  static async connect(wsUrl: string): Promise<CDPClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => resolve(new CDPClient(ws));
      ws.onerror = (e) => reject(new Error(`WS error: ${String(e)}`));
    });
  }

  send(method: string, params: Record<string, any> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function launchChromeCDP(chrome: { bin: string; isHeadlessShell: boolean }, port: number, userDataDir: string) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const args = [
    ...(chrome.isHeadlessShell ? [] : ["--headless=new"]),
    "--no-sandbox",
    "--disable-gpu-vsync",
    "--disable-frame-rate-limit",
    "--disable-dev-shm-usage",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-extensions",
    "--mute-audio",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1920,1080",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ];
  const proc = Bun.spawn([chrome.bin, ...args], {
    stdout: "ignore",
    stderr: "ignore",
  });

  // Poll DevTools /json/list until ready
  const deadline = Date.now() + 20000;
  let wsUrl = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const targets = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
        const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      }
    } catch {}
    await Bun.sleep(100);
  }
  if (!wsUrl) {
    proc.kill();
    throw new Error(`Timed out waiting for Chrome DevTools on port ${port}`);
  }
  const cdp = await CDPClient.connect(wsUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return { proc, cdp };
}

function startStaticServer() {
  const mimeFor = (filePath: string) => {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".otf": "font/otf",
      ".ttf": "font/ttf",
      ".json": "application/json",
    };
    return map[ext] || "application/octet-stream";
  };

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      const pathname = decodeURIComponent(url.pathname);

      let target: string | null = null;
      if (pathname.startsWith("/engine/")) {
        target = path.join(ENGINE_DIR, pathname.slice("/engine/".length));
      } else if (pathname === "/brand/icon.svg") {
        target = BRAND_ICON_SVG;
      } else if (pathname.startsWith("/fonts/")) {
        const key = pathname.slice("/fonts/".length);
        const candidates = FONT_MAP[key] || [];
        target = candidates.find((p) => fs.existsSync(p)) || null;
      } else if (pathname.startsWith("/captures/")) {
        target = path.join(CAPTURES_DIR, pathname.slice("/captures/".length));
      } else if (pathname.startsWith("/clip_frames/")) {
        target = path.join(WORK_DIR, "clip_frames", pathname.slice("/clip_frames/".length));
      }

      if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(Bun.file(target), {
        headers: {
          "Content-Type": mimeFor(target),
          "Cache-Control": "public, max-age=3600",
        },
      });
    },
  });
  return server;
}

async function waitPageReady(cdp: CDPClient, url: string) {
  await cdp.send("Page.navigate", { url });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const r = await cdp.send("Runtime.evaluate", {
      expression: "document.readyState === 'complete'",
      returnByValue: true,
    });
    if (r?.result?.value === true) break;
    await Bun.sleep(60);
  }
  // Eagerly force-load EVERY @font-face (even inside display:none scenes!) before frame 0!
  await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const loads = [];
      for (const f of document.fonts) { loads.push(f.load().catch(() => null)); }
      await Promise.all(loads);
      await document.fonts.ready;
      return document.fonts.size;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
}

async function renderCover(timeline: any, outPath: string, baseUrl: string, chrome: { bin: string; isHeadlessShell: boolean }) {
  const port = 19220 + Math.floor(Math.random() * 400);
  const profileDir = path.join(WORK_DIR, `chrome_cover_${port}`);
  const { proc, cdp } = await launchChromeCDP(chrome, port, profileDir);
  try {
    await waitPageReady(cdp, `${baseUrl}/engine/cover.html`);
    const coverCfg = timeline.cover || {
      main: timeline.assets?.live2d?.posterUrl || timeline.assets?.live2d?.url || timeline.assets?.hero?.url || "",
      sub: timeline.assets?.flow?.posterUrl || timeline.assets?.flow?.url || timeline.assets?.hero?.url || "",
      bg: timeline.assets?.hero?.url || timeline.assets?.live2d?.posterUrl || "",
    };
    await cdp.send("Runtime.evaluate", {
      expression: `window.setCoverImages(${JSON.stringify(coverCfg)})`,
      awaitPromise: true,
    });
    await Bun.sleep(150);
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(shot.data, "base64"));
    console.log(`[render] Wrote Bilibili cover -> ${outPath}`);
  } finally {
    cdp.close();
    proc.kill();
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
}

async function renderChunk(
  workerId: number,
  startFrame: number,
  endFrame: number,
  fps: number,
  timeline: any,
  baseUrl: string,
  chrome: { bin: string; isHeadlessShell: boolean },
  chunkPath: string,
  basePort: number
) {
  const port = basePort + workerId;
  const profileDir = path.join(WORK_DIR, `chrome_w${workerId}_${port}`);
  const { proc, cdp } = await launchChromeCDP(chrome, port, profileDir);

  // Pipe high-quality JPEG (q=97) frames directly to FFmpeg H.264 segment encoder (strict BT.709 yuv420p)
  const ff = Bun.spawn([
    "ffmpeg", "-y", "-v", "error",
    "-f", "image2pipe",
    "-vcodec", "mjpeg",
    "-framerate", String(fps),
    "-i", "pipe:0",
    "-vf", "scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "16",
    "-profile:v", "high",
    "-level", "4.2",
    "-pix_fmt", "yuv420p",
    "-color_range", "tv",
    "-colorspace", "bt709",
    "-color_primaries", "bt709",
    "-color_trc", "bt709",
    "-g", String(fps * 2),
    "-keyint_min", String(fps),
    "-sc_threshold", "0",
    "-video_track_timescale", "60000",
    "-an",
    chunkPath,
  ], {
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
  });

  const t0 = Date.now();
  try {
    await waitPageReady(cdp, `${baseUrl}/engine/scene-player.html`);
    await cdp.send("Runtime.evaluate", {
      expression: `window.setTimeline(${JSON.stringify(timeline)})`,
      returnByValue: true,
    });

    const totalChunk = endFrame - startFrame;
    for (let f = startFrame; f < endFrame; f++) {
      await cdp.send("Runtime.evaluate", {
        expression: `window.renderFrame(${f}, ${fps})`,
        awaitPromise: true,
      });
      const shot = await cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 97,
        fromSurface: true,
      });
      const buf = Buffer.from(shot.data, "base64");
      ff.stdin.write(buf);

      const done = f - startFrame + 1;
      if (done % 120 === 0 || done === totalChunk) {
        const dt = (Date.now() - t0) / 1000;
        const rate = done / Math.max(dt, 0.01);
        console.log(`[worker-${workerId}] ${done}/${totalChunk} frames (${rate.toFixed(1)} fps)`);
      }
    }
    await ff.stdin.end();
    const exitCode = await ff.exited;
    if (exitCode !== 0) {
      throw new Error(`FFmpeg worker-${workerId} exited with code ${exitCode}`);
    }
  } finally {
    cdp.close();
    proc.kill();
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
}

async function renderVideo(timeline: any, audioPath: string, outPath: string, workers: number, baseUrl: string, chrome: { bin: string; isHeadlessShell: boolean }) {
  const fps = Number(timeline.fps || 60);
  const totalFrames = Math.round(Number(timeline.duration) * fps);
  const actualWorkers = Math.max(1, Math.min(workers, Math.ceil(totalFrames / 60)));

  console.log(`[render] Rendering ${totalFrames} frames (${timeline.duration.toFixed(2)}s @ ${fps}fps) across ${actualWorkers} Chromium workers...`);
  const tStart = Date.now();

  const chunksDir = path.join(WORK_DIR, "chunks");
  fs.mkdirSync(chunksDir, { recursive: true });
  const basePort = 19400 + Math.floor(Math.random() * 300);

  const chunkPaths: string[] = [];
  const tasks: Promise<void>[] = [];
  const framesPerWorker = Math.ceil(totalFrames / actualWorkers);

  for (let w = 0; w < actualWorkers; w++) {
    const startF = w * framesPerWorker;
    const endF = Math.min(totalFrames, startF + framesPerWorker);
    if (startF >= endF) break;
    const cp = path.join(chunksDir, `chunk_${String(w).padStart(2, "0")}.mp4`);
    chunkPaths.push(cp);
    tasks.push(renderChunk(w, startF, endF, fps, timeline, baseUrl, chrome, cp, basePort));
  }

  await Promise.all(tasks);

  // Concat video chunks + mux high-bitrate 48kHz stereo AAC audio
  const concatList = path.join(chunksDir, "concat.txt");
  fs.writeFileSync(
    concatList,
    chunkPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n") + "\n",
    "utf-8"
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  console.log(`[render] Concatenating ${chunkPaths.length} H.264 chunks + muxing audio -> ${outPath}`);

  const muxArgs = [
    "ffmpeg", "-y", "-v", "warning",
    "-f", "concat", "-safe", "0", "-i", concatList,
  ];
  if (audioPath && fs.existsSync(audioPath)) {
    muxArgs.push("-i", audioPath);
    muxArgs.push(
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "256k",
      "-ar", "48000",
      "-ac", "2",
      "-shortest"
    );
  } else {
    muxArgs.push("-c:v", "copy");
  }
  muxArgs.push("-movflags", "+faststart", outPath);

  const mux = Bun.spawn(muxArgs, { stdout: "inherit", stderr: "inherit" });
  const muxCode = await mux.exited;
  if (muxCode !== 0) throw new Error(`FFmpeg mux exited with code ${muxCode}`);

  const elapsed = (Date.now() - tStart) / 1000;
  console.log(`[render] DONE in ${elapsed.toFixed(1)}s (${(totalFrames / elapsed).toFixed(1)} effective fps) -> ${outPath}`);
}

async function renderAuditFrames(timeline: any, outDir: string, baseUrl: string, chrome: { bin: string; isHeadlessShell: boolean }) {
  const fps = Number(timeline.fps || 60);
  const port = 19260 + Math.floor(Math.random() * 300);
  const profileDir = path.join(WORK_DIR, `chrome_audit_${port}`);
  const { proc, cdp } = await launchChromeCDP(chrome, port, profileDir);
  try {
    await waitPageReady(cdp, `${baseUrl}/engine/scene-player.html`);
    await cdp.send("Runtime.evaluate", {
      expression: `window.setTimeline(${JSON.stringify(timeline)})`,
      returnByValue: true,
    });
    fs.mkdirSync(outDir, { recursive: true });
    for (let i = 0; i < timeline.scenes.length; i++) {
      const sc = timeline.scenes[i];
      const sampleT = sc.start + (sc.end - sc.start) * 0.62;
      const f = Math.round(sampleT * fps);
      await cdp.send("Runtime.evaluate", {
        expression: `window.renderFrame(${f}, ${fps})`,
        awaitPromise: true,
      });
      await Bun.sleep(60);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      const outFile = path.join(outDir, `audit_${String(i + 1).padStart(2, "0")}_${sc.id}.png`);
      fs.writeFileSync(outFile, Buffer.from(shot.data, "base64"));
      console.log(`[audit] Captured ${path.basename(outFile)} @ t=${sampleT.toFixed(2)}s`);
    }
  } finally {
    cdp.close();
    proc.kill();
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || "video";
  const timelinePath = args.timeline;
  const outPath = args.out;
  const audioPath = args.audio || "";
  const workers = Number(args.workers || 6);

  if (!timelinePath || !outPath) {
    console.error("Usage: bun render.ts --mode <video|cover|audit> --timeline <timeline.json> --out <output> [--audio <wav>] [--workers 6]");
    process.exit(1);
  }

  const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf-8"));
  const chrome = findChromeBinary();
  fs.mkdirSync(WORK_DIR, { recursive: true });

  const server = startStaticServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;

  try {
    if (mode === "cover") {
      await renderCover(timeline, outPath, baseUrl, chrome);
    } else if (mode === "audit") {
      await renderAuditFrames(timeline, outPath, baseUrl, chrome);
    } else {
      await renderVideo(timeline, audioPath, outPath, workers, baseUrl, chrome);
    }
  } finally {
    server.stop(true);
  }
}

main().catch((err) => {
  console.error("[render] FATAL:", err);
  process.exit(1);
});
