#!/usr/bin/env python3
"""
MoeSekai Story Studio — Single-Command Bilibili 1080p60 PV & Cover Master Pipeline

Usage:
  # Auto mode:
  #   - If promo/voiceover/audio/*.wav exists -> renders final voiceover-synced
  #     promo/video/out/moesekai-story-studio-pv.mp4
  #   - Otherwise -> renders complete BGM+SFX+bilingual-subtitles preview master
  #     promo/video/out/moesekai-story-studio-pv-preview.mp4
  python promo/video/render_final.py

  # Force specific mode / options:
  python promo/video/render_final.py --workers 6
  python promo/video/render_final.py --cover-only
  python promo/video/render_final.py --smoke        # Quick 4s 60fps pipeline check
  python promo/video/render_final.py --use-guide    # Mix promo/voiceover/guide_audio/ for pacing preview
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

VIDEO_DIR = Path(__file__).resolve().parent
PROMO_DIR = VIDEO_DIR.parent
REPO_ROOT = PROMO_DIR.parent
CAPTURES_DIR = PROMO_DIR / "captures"
VOICEOVER_DIR = PROMO_DIR / "voiceover"
ENGINE_DIR = VIDEO_DIR / "engine"
AUDIO_DIR = VIDEO_DIR / "audio"
WORK_DIR = VIDEO_DIR / "work"
OUT_DIR = VIDEO_DIR / "out"

SCENE_ORDER = [
    ("s01_hook",           "intro",  6.5),
    ("s02_wish_agent",     "reveal", 11.5),
    ("s03_live2d",         "groove", 10.5),
    ("s04_flow_msk",       "groove", 10.5),
    ("s05_assets_cast",    "bridge", 9.0),
    ("s06_i18n_voice",     "bridge", 9.5),
    ("s07_preflight_open", "groove", 9.5),
    ("s08_cta",            "climax", 9.2),
]

# Built-in fallback bilingual script (automatically replaced when promo/voiceover/script.json exists)
DEFAULT_SCRIPT_LINES = [
    {
        "id": "01_hook_a", "scene_id": "s01_hook", "est_duration_sec": 3.0,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "大家！想做属于自己的 PJSK 二创剧情，却总被剪辑对轨难住吗？",
        "subtitle_ja": "みんな！オリジナルのセカイストーリー、編集が大変で困ってない？",
    },
    {
        "id": "01_hook_b", "scene_id": "s01_hook", "est_duration_sec": 2.6,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "要是有一个专为烤肉与剧情创作打造的专属工作台呢？",
        "subtitle_ja": "もし専用のストーリー制作スタジオがあったら、すごく素敵だよね！",
    },
    {
        "id": "02_reveal_a", "scene_id": "s02_reveal", "est_duration_sec": 3.5,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "隆重介绍！开源免费的 MoeSekai Story Studio！",
        "subtitle_ja": "じゃーん！オープンソースで無料の MoeSekai Story Studio だよ！",
    },
    {
        "id": "02_reveal_b", "scene_id": "s02_reveal", "est_duration_sec": 3.2,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "桌面端与网页端同源引擎，把你的脑洞变成真正可游玩的互动故事！",
        "subtitle_ja": "デスクトップもウェブも同じエンジンで、アイデアがそのまま遊べる物語に！",
    },
    {
        "id": "03_live2d_a", "scene_id": "s03_live2d", "est_duration_sec": 4.5,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "直连官方 Live2D 模型库！多位角色同台演出，动作表情和贴贴站位实时预览！",
        "subtitle_ja": "Live2Dモデルがそのまま動くよ！表情やモーション、立ち位置もリアルタイムで確認できちゃう！",
    },
    {
        "id": "03_live2d_b", "scene_id": "s03_live2d", "est_duration_sec": 4.2,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "内置全屏交互播放器，选项分支和剧情变量边写就能边试玩！",
        "subtitle_ja": "内蔵プレイヤーで選択肢や分岐ルートも、作りながらすぐテストプレイできるんだよ！",
    },
    {
        "id": "04_flow_a", "scene_id": "s04_flow_msk", "est_duration_sec": 4.6,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "既可以像拼积木一样拖拽可视化节点流，也能切换到 .msk 剧本代码精修！",
        "subtitle_ja": "ノードを繋いで直感的に組めるし、.mskスクリプトで細かく編集もできるんだ！",
    },
    {
        "id": "04_flow_b", "scene_id": "s04_flow_msk", "est_duration_sec": 4.4,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "画布与代码 100% 双向无损实时同步，零报错静态编译超安心！",
        "subtitle_ja": "ビジュアルとコードが双方向でぴったり同期するから、とっても安心だね！",
    },
    {
        "id": "05_agent_a", "scene_id": "s05_agent", "est_duration_sec": 4.6,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "更有内置 MoeSekai AI 剧情代理！自动学习官方演出先例，帮你起草和润色剧本！",
        "subtitle_ja": "さらにAIストーリーエージェント搭載！公式演出を参考に、脚本づくりをお手伝いしてくれるよ！",
    },
    {
        "id": "05_agent_b", "scene_id": "s05_agent", "est_duration_sec": 4.0,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "全分支自动模拟体检，还自带快照一键回滚，灵感随便试错！",
        "subtitle_ja": "全ルート自動チェックにスナップショット復元付きだから、何度でも挑戦できるね！",
    },
    {
        "id": "06_i18n_a", "scene_id": "s06_i18n_voice", "est_duration_sec": 4.0,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "支持中日英韩繁 5 种语言本地化包，一份剧本轻松分享给全世界的同好！",
        "subtitle_ja": "5言語のローカライズに対応！世界中のファンにあなたの物語を届けられるよ！",
    },
    {
        "id": "06_i18n_b", "scene_id": "s06_i18n_voice", "est_duration_sec": 3.8,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "还能挂载自定义配音清单并一键打包音频——就像我现在为大家配音这样哦！",
        "subtitle_ja": "カスタムボイスもまるっとパッケージ化！今のわたしみたいに声を吹き込めるんだよ！",
    },
    {
        "id": "13_preflight_a", "scene_id": "s07_preflight_open", "est_duration_sec": 4.4,
        "speaker": "花里实乃理 · 花里みのり",
        "subtitle_zh": "导出前自动体检缺失素材与断链分支，一键导出 .msk 或独立资源包！",
        "subtitle_ja": "書き出し前に素材や分岐を自動チェック！安心して書き出せるよ！",
    },
    {
        "id": "14_open_b", "scene_id": "s07_preflight_open", "est_duration_sec": 4.2,
        "speaker": "花里实乃理 · 花里みのり",
        "subtitle_zh": "与 pjsk.moe 网页端互通，支持 Win / Mac / Linux，MPL-2.0 开源免费！",
        "subtitle_ja": "pjsk.moe Web版互換！Windows・macOS・Linux 対応の無料オープンソース！",
    },
    {
        "id": "08_cta_a", "scene_id": "s08_cta", "est_duration_sec": 3.8,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "现在就访问 story.pjsk.moe，开启属于你的 SEKAI 故事舞台吧！",
        "subtitle_ja": "今すぐ story.pjsk.moe にアクセスして、あなただけのセカイを描こう！",
    },
    {
        "id": "08_cta_b", "scene_id": "s08_cta", "est_duration_sec": 3.5,
        "speaker": "花里实乃理 · MNR",
        "subtitle_zh": "如果喜欢这个开源工具，别忘了点赞、投币、收藏一键三连支持我们哦！",
        "subtitle_ja": "気に入ってくれたら、いいね・コイン・お気に入りもよろしくね！せーの、MORE MORE JUMP！",
    },
]


def ffprobe_json(media_path: Path) -> dict[str, Any]:
    cmd = [
        "ffprobe", "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        str(media_path),
    ]
    out = subprocess.check_output(cmd, text=True, encoding="utf-8")
    return json.loads(out)


def audio_duration_sec(wav_path: Path) -> float:
    info = ffprobe_json(wav_path)
    dur = float(info.get("format", {}).get("duration", 0.0))
    if dur <= 0:
        for st in info.get("streams", []):
            if st.get("duration"):
                dur = float(st["duration"])
                break
    return max(0.2, dur)


def normalize_capture_rel(raw_path: str) -> str:
    """Convert any manifest path into a relative path under promo/captures/."""
    p = raw_path.replace("\\", "/").lstrip("/")
    for prefix in ("promo/captures/", "./promo/captures/", "captures/"):
        if p.startswith(prefix):
            p = p[len(prefix):]
    # Handle absolute Windows path inside promo/captures
    low = p.lower()
    marker = "promo/captures/"
    idx = low.find(marker)
    if idx >= 0:
        p = p[idx + len(marker):]
    return p


def extract_clip_frames(clip_path: Path, slot_name: str, fps: int = 30) -> tuple[str, int, int] | None:
    """Pre-extract real video clip into deterministic JPEG frames for 60fps browser playback."""
    if not clip_path.exists():
        return None
    out_dir = WORK_DIR / "clip_frames" / slot_name
    marker = out_dir / ".source_meta.json"
    sig = {"src": str(clip_path.resolve()), "mtime": clip_path.stat().st_mtime, "size": clip_path.stat().st_size, "fps": fps}

    if marker.exists():
        try:
            old = json.loads(marker.read_text(encoding="utf-8"))
            frames = sorted(out_dir.glob("*.jpg"))
            if old == sig and len(frames) > 10:
                print(f"[captures] Reusing {len(frames)} cached frames for clip slot '{slot_name}'")
                return (f"/clip_frames/{slot_name}", len(frames), fps)
        except Exception:
            pass

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"[captures] Extracting {clip_path.name} -> {slot_name} @ {fps}fps...")
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-i", str(clip_path),
        "-vf", f"fps={fps},scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
        "-q:v", "3",
        str(out_dir / "%05d.jpg"),
    ]
    subprocess.run(cmd, check=True)
    frames = sorted(out_dir.glob("*.jpg"))
    if not frames:
        return None
    marker.write_text(json.dumps(sig, indent=2), encoding="utf-8")
    print(f"[captures] Extracted {len(frames)} frames for '{slot_name}'")
    return (f"/clip_frames/{slot_name}", len(frames), fps)


def load_capture_assets() -> tuple[dict[str, Any], dict[str, str]]:
    """
    Read promo/captures/manifest.json (if available) and map real screenshots & demo clips
    into the 8 PV media slots + Bilibili cover slots.
    """
    manifest_path = CAPTURES_DIR / "manifest.json"
    assets: dict[str, Any] = {}
    cover: dict[str, str] = {}

    if not manifest_path.exists():
        print("[captures] manifest.json not found yet — using crisp fallback cards.")
        return assets, cover

    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    # Support both { items: [...] } and { screenshots: [...], clips: [...] } or flat list
    entries: list[dict[str, Any]] = []
    if isinstance(raw, list):
        entries = raw
    else:
        for key in ("items", "screenshots", "clips", "assets", "media"):
            val = raw.get(key)
            if isinstance(val, list):
                for item in val:
                    copy = dict(item)
                    if "kind" not in copy and "type" not in copy:
                        copy["_group"] = key
                    entries.append(copy)

    shots: list[dict[str, Any]] = []
    clips: list[dict[str, Any]] = []
    for e in entries:
        p_raw = e.get("path") or e.get("file") or e.get("src") or ""
        if not p_raw:
            continue
        rel = normalize_capture_rel(str(p_raw))
        full = CAPTURES_DIR / rel
        if not full.exists():
            continue
        ext = full.suffix.lower()
        rec = dict(e)
        rec["_rel"] = rel
        rec["_full"] = full
        rec["_url"] = f"/captures/{rel}"
        haystack = " ".join([
            str(e.get("id", "")),
            str(e.get("category", "")),
            str(e.get("title_zh", "")),
            str(e.get("caption_zh", "")),
            str(e.get("scene_id", "")),
            rel,
            " ".join(e.get("recommended_for", [])) if isinstance(e.get("recommended_for"), list) else str(e.get("recommended_for", "")),
        ]).lower()
        rec["_hay"] = haystack
        if ext in (".mp4", ".webm", ".mov", ".mkv"):
            clips.append(rec)
        elif ext in (".png", ".jpg", ".jpeg", ".webp"):
            shots.append(rec)

    def pick(pool: list[dict[str, Any]], keywords: list[str], fallback_idx: int = 0) -> dict[str, Any] | None:
        if not pool:
            return None
        best = None
        best_score = -1
        for item in pool:
            score = 0
            for idx, kw in enumerate(keywords):
                if kw in item["_hay"]:
                    score += (len(keywords) - idx) * 10
            if score > best_score:
                best_score = score
                best = item
        if best_score > 0:
            return best
        return pool[fallback_idx % len(pool)]

    def pick_by_id(pool: list[dict[str, Any]], ids: list[str]) -> dict[str, Any] | None:
        for want in ids:
            for item in pool:
                if item.get("id") == want or want in item["_rel"]:
                    return item
        return None

    # Prefer verified exact manifest IDs for all 8 Apple Keynote acts
    shot_light_hero = pick_by_id(shots, ["hero-studio-mmj-light"]) or pick(shots, ["hero", "light"], 0)
    shot_dark_hero  = pick_by_id(shots, ["studio-dark-theme-nightcord"]) or pick(shots, ["dark", "nightcord"], 1)
    shot_theater    = pick_by_id(shots, ["player-theater-minori-stage", "player-ja-locale-playback"]) or shot_light_hero
    shot_agent      = pick_by_id(shots, ["ai-agent-authoring"]) or pick(shots, ["agent", "authoring"], 2)
    shot_snapshots  = pick_by_id(shots, ["ai-agent-snapshots-rollback"]) or shot_agent
    shot_inspector  = pick_by_id(shots, ["cast-and-live2d-inspector"]) or pick(shots, ["inspector", "cast"], 3)
    shot_picker     = pick_by_id(shots, ["asset-picker-costume-bg"]) or pick(shots, ["picker", "costume"], 4)
    shot_i18n       = pick_by_id(shots, ["i18n-multilang-proofread"]) or pick(shots, ["i18n", "proofread"], 5)
    shot_ja_play    = pick_by_id(shots, ["player-ja-locale-playback"]) or shot_theater
    shot_voice      = pick_by_id(shots, ["voice-manifest-bundler"]) or pick(shots, ["voice", "manifest", "bundler"], 6)
    shot_export     = pick_by_id(shots, ["export-preflight-dialog"]) or pick(shots, ["export", "preflight"], 7)

    slot_shots = {
        "agent":      shot_agent,
        "snapshots":  shot_snapshots,
        "picker":     shot_picker,
        "inspector":  shot_inspector,
        "i18n":       shot_i18n,
        "ja_play":    shot_ja_play,
        "voice":      shot_voice,
        "export":     shot_export,
        "light_hero": shot_light_hero,
        "dark_hero":  shot_dark_hero,
    }
    for slot, s in slot_shots.items():
        if s:
            assets[slot] = {"type": "image", "url": s["_url"], "posterUrl": s["_url"], "id": s.get("id", slot)}

    # Extract and wire ALL 4 real 60fps desktop demo clips (at crisp 30fps deterministic frames)!
    clip_specs = [
        ("live2d_clip", ["clip-live2d-stage-playback"],       ["live2d", "stage", "playback"],   shot_theater),
        ("branch_clip", ["clip-branching-choice-transition"], ["branching", "choice"],           shot_theater),
        ("flow_clip",   ["clip-node-flow-and-inspector"],     ["node-flow", "flow", "inspector"], shot_light_hero),
        ("msk_clip",    ["clip-msk-code-live-sync"],          ["msk", "code"],                   shot_light_hero),
    ]
    for slot, id_prefs, kw_prefs, fallback_shot in clip_specs:
        c = pick_by_id(clips, id_prefs) or (pick(clips, kw_prefs, 0) if clips else None)
        if c:
            ext_res = extract_clip_frames(c["_full"], slot, fps=30)
            if ext_res:
                base_u, count, fps = ext_res
                assets[slot] = {"type": "clip", "baseUrl": base_u, "frameCount": count, "fps": fps}
                continue
        if fallback_shot:
            assets[slot] = {"type": "image", "url": fallback_shot["_url"]}

    # Bright Apple Keynote Bilibili cover: unobstructed 5-actor MMJ Live2D + MoeSekai AI Agent panel
    cover["main"] = shot_theater["_url"] if shot_theater else ""
    cover["sub"]  = shot_agent["_url"] if shot_agent else cover["main"]

    print(f"[captures] Loaded {len(shots)} screenshots & {len(clips)} clips from manifest.json.")
    for k, v in assets.items():
        desc = f"clip({v['frameCount']}f@{v['fps']}fps)" if v["type"] == "clip" else Path(v["url"]).name
        print(f"   slot '{k:7s}' -> {desc}")
    return assets, cover


def load_voiceover_script(use_guide: bool = False) -> tuple[list[dict[str, Any]], bool]:
    """
    Load promo/voiceover/script.json if present and locate matching WAV files in
    promo/voiceover/audio/ (real mnr TTS) or promo/voiceover/guide_audio/ (if --use-guide).
    Returns (lines, has_real_mnr_audio).
    """
    script_path = VOICEOVER_DIR / "script.json"
    speaker_label = "花里实乃理 · 花里みのり"
    if script_path.exists():
        raw = json.loads(script_path.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("voice"), dict):
            v_zh = raw["voice"].get("display_name_zh") or "花里实乃理"
            v_ja = raw["voice"].get("display_name_ja") or "花里みのり"
            speaker_label = f"{v_zh} · {v_ja}"
        raw_lines = raw.get("lines") if isinstance(raw, dict) else raw
        if not raw_lines and isinstance(raw, dict) and isinstance(raw.get("scenes"), list):
            raw_lines = []
            for sc in raw["scenes"]:
                sid = sc.get("scene_id") or sc.get("id")
                for ln in sc.get("lines", []):
                    c = dict(ln)
                    c.setdefault("scene_id", sid)
                    raw_lines.append(c)
        lines = []
        for x in (raw_lines or []):
            item = dict(x)
            sp = str(item.get("speaker") or "")
            if not sp or sp.startswith("pjsk_") or "_" in sp:
                item["speaker"] = speaker_label
            lines.append(item)
        print(f"[voice] Loaded {len(lines)} narration lines from {script_path.name} (speaker: {speaker_label})")
    else:
        lines = [dict(x) for x in DEFAULT_SCRIPT_LINES]
        print(f"[voice] script.json not found yet — using built-in {len(lines)}-line bilingual storyboard.")

    # Check real mnr TTS audio directory first!
    real_audio_dir = VOICEOVER_DIR / "audio"
    guide_audio_dir = VOICEOVER_DIR / "guide_audio"
    timings_path = VOICEOVER_DIR / "timings.json"
    timings_dur_by_id: dict[str, float] = {}
    if timings_path.exists():
        try:
            tdata = json.loads(timings_path.read_text(encoding="utf-8"))
            if tdata.get("is_real_mnr_tts") is True:
                for item in tdata.get("lines", []):
                    if item.get("id") and item.get("duration_sec"):
                        timings_dur_by_id[str(item["id"])] = float(item["duration_sec"])
                print(f"[voice] Loaded canonical real mnr timings from timings.json ({len(timings_dur_by_id)} lines)")
        except Exception as exc:
            print(f"[voice] WARN: could not parse timings.json: {exc}")

    def find_wav(base_dir: Path, line: dict[str, Any], idx: int) -> Path | None:
        if not base_dir.exists():
            return None
        candidates = []
        if line.get("audio_file"):
            af = Path(str(line["audio_file"]))
            candidates.append(base_dir / af.name)
            candidates.append(VOICEOVER_DIR / af)
        lid = str(line.get("id") or f"{idx + 1:02d}")
        candidates.append(base_dir / f"{lid}.wav")
        candidates.append(base_dir / f"{idx + 1:02d}_{lid}.wav")
        for c in candidates:
            if c.exists() and c.stat().st_size > 1000:
                return c
        # Prefix match fallback
        for p in sorted(base_dir.glob("*.wav")):
            if p.stem == lid or p.stem.startswith(lid + "_") or p.stem.endswith("_" + lid):
                if p.stat().st_size > 1000:
                    return p
        return None

    real_matches = 0
    for i, ln in enumerate(lines):
        w = find_wav(real_audio_dir, ln, i)
        if w:
            ln["_wav"] = w
            lid = str(ln.get("id") or "")
            if lid in timings_dur_by_id:
                ln["_timings_dur"] = timings_dur_by_id[lid]
            real_matches += 1

    has_real = real_matches >= max(1, int(len(lines) * 0.6))
    if has_real:
        print(f"[voice] DETECTED {real_matches}/{len(lines)} REAL mnr TTS WAV files in promo/voiceover/audio/ -> FINAL MASTER MODE!")
    else:
        for ln in lines:
            ln.pop("_wav", None)
        if use_guide and guide_audio_dir.exists():
            gm = 0
            for i, ln in enumerate(lines):
                w = find_wav(guide_audio_dir, ln, i)
                if w:
                    ln["_wav"] = w
                    gm += 1
            print(f"[voice] Guide audio mode enabled: matched {gm}/{len(lines)} guide WAVs (NOT final mnr TTS).")
        else:
            print("[voice] No real mnr TTS WAVs in promo/voiceover/audio/ yet -> PREVIEW MASTER MODE (BGM+SFX+bilingual subtitles).")

    return lines, has_real


def build_timeline(
    lines: list[dict[str, Any]],
    assets: dict[str, Any],
    cover: dict[str, str],
    smoke: bool = False,
) -> dict[str, Any]:
    """Assemble exact scene start/end timings, subtitle cues, voice clips, and beat-synced SFX."""
    # Group lines by scene_id
    by_scene: dict[str, list[dict[str, Any]]] = {sid: [] for sid, _, _ in SCENE_ORDER}
    for ln in lines:
        sid = ln.get("scene_id") or ln.get("scene") or "s01_hook"
        if sid not in by_scene:
            # Fuzzy map if needed
            matched = next((s for s, _, _ in SCENE_ORDER if sid in s or s in sid), "s02_wish_agent")
            sid = matched
        by_scene[sid].append(ln)

    scenes: list[dict[str, Any]] = []
    subtitles: list[dict[str, Any]] = []
    voice_clips: list[dict[str, Any]] = []
    sfx: list[dict[str, Any]] = []

    cursor = 0.0
    for idx, (sid, mood, min_dur) in enumerate(SCENE_ORDER):
        sc_lines = by_scene[sid]
        sc_start = cursor
        lead_in = 0.42 if idx == 0 else (0.52 if sid == "s02_wish_agent" else 0.44)
        line_t = sc_start + lead_in

        for li, ln in enumerate(sc_lines):
            wav: Path | None = ln.get("_wav")
            if wav:
                dur = float(ln.get("_timings_dur") or audio_duration_sec(wav))
            else:
                dur = float(ln.get("est_duration_sec") or ln.get("duration_sec") or 3.6)

            sub_start = line_t
            sub_end = line_t + dur
            if wav:
                voice_clips.append({
                    "id": ln.get("id", f"{sid}_{li}"),
                    "path": str(wav.resolve()),
                    "start": round(sub_start, 3),
                    "end": round(sub_end, 3),
                })

            subtitles.append({
                "id": ln.get("id", f"{sid}_{li}"),
                "scene_id": sid,
                "start": round(sub_start, 3),
                "end": round(sub_end + 0.12, 3),
                "speaker": ln.get("speaker") or "花里实乃理 · 花里みのり",
                "subtitle_zh": ln.get("subtitle_zh") or ln.get("text_zh") or "",
                "subtitle_ja": ln.get("subtitle_ja") or ln.get("text_ja") or "",
            })
            line_t = sub_end + 0.30

        tail_pad = 0.90 if sid == "s08_cta" else 0.46
        computed_dur = (line_t - 0.30 + tail_pad) - sc_start if sc_lines else min_dur
        sc_dur = max(min_dur, computed_dur)
        sc_end = sc_start + sc_dur

        scenes.append({
            "id": sid,
            "start": round(sc_start, 3),
            "end": round(sc_end, 3),
            "bgm_mood": mood,
        })

        # Clean Apple Keynote SFX cues (restrained & tactile)
        if idx == 0:
            sfx.append({"time": round(sc_start + 0.16, 3), "kind": "ui_pop", "gain": 0.56})
            sfx.append({"time": round(sc_start + 2.12, 3), "kind": "ui_pop", "gain": 0.52})
            sfx.append({"time": round(sc_start + 2.77, 3), "kind": "ui_pop_hi", "gain": 0.54})
            sfx.append({"time": round(sc_start + 3.42, 3), "kind": "ui_pop_hi", "gain": 0.56})
        else:
            sfx.append({"time": round(max(0.0, sc_start - 0.24), 3), "kind": "prism_whoosh", "gain": 0.62 if sid in ("s02_wish_agent", "s08_cta") else 0.52})

        if sid == "s02_wish_agent":
            sfx.append({"time": round(sc_start + 0.45, 3), "kind": "type_burst", "count": 22, "step": 0.11, "gain": 0.44})
            sfx.append({"time": round(sc_start + min(4.75, sc_dur * 0.40), 3), "kind": "star_chime", "gain": 0.62})
        elif sid == "s03_live2d":
            sfx.append({"time": round(sc_start + sc_dur * 0.50, 3), "kind": "ui_pop_hi", "gain": 0.55})
        elif sid == "s04_flow_msk":
            sfx.append({"time": round(sc_start + sc_dur * 0.48, 3), "kind": "ui_pop_hi", "gain": 0.55})
        elif sid == "s05_assets_cast":
            sfx.append({"time": round(sc_start + sc_dur * 0.50, 3), "kind": "ui_pop", "gain": 0.54})
        elif sid == "s06_i18n_voice":
            sfx.append({"time": round(sc_start + 0.35, 3), "kind": "ui_pop_hi", "gain": 0.52})
        elif sid == "s07_preflight_open":
            sfx.append({"time": round(sc_start + sc_dur * 0.52, 3), "kind": "ui_pop", "gain": 0.54})
        elif sid == "s08_cta":
            sfx.append({"time": round(sc_start + 0.05, 3), "kind": "star_chime", "gain": 0.66})
            triad_t = sc_start + max(2.0, sc_dur - 5.1)
            sfx.append({"time": round(triad_t, 3), "kind": "triad_combo", "gain": 0.80})

        cursor = sc_end

    total_dur = round(cursor, 3)
    if smoke:
        total_dur = 4.0

    return {
        "fps": 60,
        "width": 1920,
        "height": 1080,
        "duration": total_dur,
        "scenes": scenes,
        "subtitles": subtitles,
        "voice_clips": voice_clips,
        "sfx": sfx,
        "assets": assets,
        "cover": cover,
    }


def extract_verification_frames(mp4_path: Path, timeline: dict[str, Any]) -> tuple[list[Path], Path]:
    """Extract 8 representative chapter keyframes + 4x2 contact sheet for visual QA."""
    frames_dir = OUT_DIR / "keyframes"
    frames_dir.mkdir(parents=True, exist_ok=True)
    extracted: list[Path] = []
    dur = float(timeline["duration"])

    for idx, sc in enumerate(timeline["scenes"]):
        # Pick 58% through each scene so animations + subtitles are cleanly settled in view!
        sample_t = sc["start"] + (sc["end"] - sc["start"]) * 0.58
        if sample_t >= dur - 0.1:
            sample_t = max(0.2, dur - 0.5)
        out_png = frames_dir / f"kf_{idx + 1:02d}_{sc['id']}.png"
        subprocess.run([
            "ffmpeg", "-y", "-v", "error",
            "-ss", f"{sample_t:.3f}",
            "-i", str(mp4_path),
            "-frames:v", "1",
            str(out_png),
        ], check=True)
        extracted.append(out_png)

    # Assemble crisp 4x2 storyboard contact sheet (1920x540 -> 2560x720)
    contact_path = OUT_DIR / "storyboard-contact-sheet.png"
    inputs = []
    for p in extracted[:8]:
        inputs.extend(["-i", str(p)])
    filter_parts = [f"[{i}:v]scale=640:360[v{i}]" for i in range(len(extracted[:8]))]
    if len(extracted) >= 8:
        filter_complex = ";".join(filter_parts) + ";[v0][v1][v2][v3]hstack=inputs=4[top];[v4][v5][v6][v7]hstack=inputs=4[bot];[top][bot]vstack=inputs=2[out]"
        subprocess.run([
            "ffmpeg", "-y", "-v", "error",
            *inputs,
            "-filter_complex", filter_complex,
            "-map", "[out]",
            str(contact_path),
        ], check=True)
    return extracted, contact_path


def print_ffprobe_summary(mp4_path: Path) -> None:
    info = ffprobe_json(mp4_path)
    fmt = info.get("format", {})
    v_stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
    a_stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), {})
    size_mb = float(fmt.get("size", 0)) / (1024 * 1024)
    print("\n================ FFPROBE MASTER VERIFICATION ================")
    print(f"File       : {mp4_path}")
    print(f"Size       : {size_mb:.2f} MB | Duration: {float(fmt.get('duration', 0)):.2f}s")
    print(f"Video      : {v_stream.get('codec_name')} ({v_stream.get('profile')}) {v_stream.get('width')}x{v_stream.get('height')} | "
          f"r_fps={v_stream.get('r_frame_rate')} avg_fps={v_stream.get('avg_frame_rate')} | pix_fmt={v_stream.get('pix_fmt')}")
    print(f"Audio      : {a_stream.get('codec_name')} {a_stream.get('sample_rate')} Hz, {a_stream.get('channels')}ch, "
          f"{int(a_stream.get('bit_rate', 0)) // 1000} kbps")
    print("=============================================================\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Render MoeSekai Story Studio Bilibili 1080p60 PV & Cover.")
    parser.add_argument("--workers", type=int, default=6, help="Parallel Chromium workers (default: 6)")
    parser.add_argument("--cover-only", action="store_true", help="Only render bilibili-cover.png")
    parser.add_argument("--audit-only", action="store_true", help="Render cover + 8 scene audit PNGs (fast visual QA)")
    parser.add_argument("--skip-cover", action="store_true", help="Skip rendering bilibili-cover.png")
    parser.add_argument("--smoke", action="store_true", help="Render a 4s smoke-test MP4")
    parser.add_argument("--use-guide", action="store_true", help="Use promo/voiceover/guide_audio if real audio missing")
    parser.add_argument("--out", type=Path, help="Override output MP4 path")
    args = parser.parse_args()

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    assets, cover = load_capture_assets()
    lines, has_real_voice = load_voiceover_script(use_guide=args.use_guide)
    timeline = build_timeline(lines, assets, cover, smoke=args.smoke)

    timeline_path = WORK_DIR / "timeline.json"
    timeline_path.write_text(json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[pipeline] Timeline built: {timeline['duration']:.2f}s across {len(timeline['scenes'])} scenes, {len(timeline['subtitles'])} bilingual cues.")

    # 1. Render Bilibili Cover (1920x1080)
    if not args.skip_cover:
        cover_out = OUT_DIR / "bilibili-cover.png"
        subprocess.run([
            "bun", str(ENGINE_DIR / "render.ts"),
            "--mode", "cover",
            "--timeline", str(timeline_path),
            "--out", str(cover_out),
        ], check=True)
        if args.cover_only:
            return

    if args.audit_only:
        audit_dir = WORK_DIR / "audit_frames"
        subprocess.run([
            "bun", str(ENGINE_DIR / "render.ts"),
            "--mode", "audit",
            "--timeline", str(timeline_path),
            "--out", str(audit_dir),
        ], check=True)
        return

    # 2. Compose Original SEKAI BGM + SFX + Voiceover Ducking Master WAV
    master_wav = WORK_DIR / "master_audio.wav"
    bgm_wav = AUDIO_DIR / "sekai_bgm_master.wav"
    subprocess.run([
        sys.executable, str(AUDIO_DIR / "compose_audio.py"),
        "--timeline", str(timeline_path),
        "--out", str(master_wav),
        "--bgm-out", str(bgm_wav),
    ], check=True)

    # 3. Determine Output Path
    if args.out:
        out_mp4 = args.out
    elif args.smoke:
        out_mp4 = WORK_DIR / "smoke_test.mp4"
    elif has_real_voice:
        out_mp4 = OUT_DIR / "moesekai-story-studio-pv.mp4"
    else:
        out_mp4 = OUT_DIR / "moesekai-story-studio-pv-preview.mp4"

    # 4. Render 1080p60 MP4 via Parallel Headless Chromium + FFmpeg
    subprocess.run([
        "bun", str(ENGINE_DIR / "render.ts"),
        "--mode", "video",
        "--timeline", str(timeline_path),
        "--audio", str(master_wav),
        "--out", str(out_mp4),
        "--workers", str(args.workers),
    ], check=True)

    # 5. Verify via ffprobe & Extract Visual Inspection Keyframes + Contact Sheet
    print_ffprobe_summary(out_mp4)
    if not args.smoke:
        kfs, sheet = extract_verification_frames(out_mp4, timeline)
        print(f"[pipeline] Extracted {len(kfs)} keyframes + contact sheet -> {sheet}")


if __name__ == "__main__":
    main()
