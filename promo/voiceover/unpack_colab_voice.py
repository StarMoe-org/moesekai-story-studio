#!/usr/bin/env python3
"""Unpack, verify, and ingest Colab-generated Drama 3 mnr TTS voiceover packs.

Usage:
    python promo/voiceover/unpack_colab_voice.py --zip path/to/mnr_voiceover_pack.zip
    python promo/voiceover/unpack_colab_voice.py --zip path/to/mnr_voiceover_pack.zip --render
    python promo/voiceover/unpack_colab_voice.py --verify-only
    python promo/voiceover/unpack_colab_voice.py --self-test
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import wave
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

VOICEOVER_DIR = Path(__file__).resolve().parent
REPO_ROOT = VOICEOVER_DIR.parents[1]
SCRIPT_JSON_PATH = VOICEOVER_DIR / "script.json"
AUDIO_DIR = VOICEOVER_DIR / "audio"
TIMINGS_JSON_PATH = VOICEOVER_DIR / "timings.json"
PACK_MANIFEST_PATH = VOICEOVER_DIR / "pack_manifest.json"
VIDEO_DIR = REPO_ROOT / "promo" / "video"

ALLOWED_SAMPLE_RATES = {24000, 44100, 48000}
MIN_CLIP_DURATION_SEC = 0.70


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _is_safe_zip_member(name: str) -> bool:
    if not name or name.startswith("/") or "\\" in name or ":" in name:
        return False
    parts = PurePosixPath(name).parts
    if not parts or ".." in parts or parts[0] in ("/", "."):
        return False
    return True


def _probe_wav(path: Path) -> dict[str, Any]:
    with wave.open(str(path), "rb") as wf:
        channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        sample_rate = wf.getframerate()
        frames = wf.getnframes()
        comptype = wf.getcomptype()
    if comptype != "NONE":
        raise ValueError(f"{path.name}: expected uncompressed PCM WAV, got {comptype!r}")
    if sample_rate <= 0 or frames <= 0:
        raise ValueError(f"{path.name}: invalid WAV header (rate={sample_rate}, frames={frames})")
    if sample_rate not in ALLOWED_SAMPLE_RATES:
        raise ValueError(f"{path.name}: unexpected sample rate {sample_rate} Hz (allowed: {sorted(ALLOWED_SAMPLE_RATES)})")
    if channels not in (1, 2):
        raise ValueError(f"{path.name}: unexpected channel count {channels}")
    dur_sec = frames / float(sample_rate)
    if dur_sec < MIN_CLIP_DURATION_SEC:
        raise ValueError(f"{path.name}: clip duration {dur_sec:.3f}s is below minimum {MIN_CLIP_DURATION_SEC:.2f}s")
    return {
        "duration_sec": round(dur_sec, 3),
        "duration_ms": max(1, int(round(dur_sec * 1000))),
        "sample_rate": sample_rate,
        "channels": channels,
        "bit_depth": sampwidth * 8,
        "codec": f"pcm_s{sampwidth * 8}le",
        "size_bytes": path.stat().st_size,
        "sha256": _sha256_file(path),
    }


def _load_script(script_path: Path) -> dict[str, Any]:
    if not script_path.exists():
        raise FileNotFoundError(f"Missing voiceover script: {script_path}")
    return json.loads(script_path.read_text(encoding="utf-8"))


def unpack_zip_safely(
    *,
    zip_path: Path,
    audio_dir: Path,
    expected_line_ids: list[str],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, list[Path]]:
    """Safely extract verified audio/*.wav + metadata from mnr_voiceover_pack.zip."""
    if not zip_path.exists():
        raise FileNotFoundError(f"Voiceover zip not found: {zip_path}")

    expected_wav_names = {f"{lid}.wav" for lid in expected_line_ids}
    extracted_wavs: list[Path] = []
    colab_timings: dict[str, Any] | None = None
    pack_manifest: dict[str, Any] | None = None

    with zipfile.ZipFile(zip_path, "r") as zf:
        infos = zf.infolist()
        for info in infos:
            if not _is_safe_zip_member(info.filename):
                raise ValueError(f"Refusing unsafe zip member path: {info.filename!r}")

        audio_dir.mkdir(parents=True, exist_ok=True)
        for info in infos:
            if info.is_dir():
                continue
            posix = PurePosixPath(info.filename)
            if posix.as_posix() == "timings.json":
                colab_timings = json.loads(zf.read(info).decode("utf-8"))
                continue
            if posix.as_posix() == "pack_manifest.json":
                pack_manifest = json.loads(zf.read(info).decode("utf-8"))
                continue
            if len(posix.parts) == 2 and posix.parts[0] == "audio" and posix.parts[1] in expected_wav_names:
                dst = (audio_dir / posix.parts[1]).resolve()
                if audio_dir.resolve() not in dst.parents:
                    raise ValueError(f"Path traversal blocked for {info.filename!r}")
                dst.write_bytes(zf.read(info))
                extracted_wavs.append(dst)

    # Cross-check SHA-256 against pack_manifest.json when present
    if isinstance(pack_manifest, dict) and isinstance(pack_manifest.get("files"), list):
        manifest_sha = {
            str(entry.get("path")): str(entry.get("sha256") or "").lower()
            for entry in pack_manifest["files"]
            if isinstance(entry, dict)
        }
        for wav_p in extracted_wavs:
            rel = f"audio/{wav_p.name}"
            expected_sha = manifest_sha.get(rel, "")
            if expected_sha:
                actual_sha = _sha256_file(wav_p)
                if actual_sha != expected_sha:
                    raise ValueError(f"SHA-256 mismatch for {rel}: got {actual_sha}, expected {expected_sha}")

    return colab_timings, pack_manifest, sorted(extracted_wavs)


def verify_and_build_timings(
    *,
    script: dict[str, Any],
    audio_dir: Path,
    colab_timings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Verify all 16 real mnr WAV clips exist & pass PCM checks, and build canonical timings.json."""
    lines = script["lines"]
    scenes = script["scenes"]
    lines_by_id = {ln["id"]: ln for ln in lines}

    colab_line_meta: dict[str, dict[str, Any]] = {}
    if isinstance(colab_timings, dict):
        for item in colab_timings.get("lines") or []:
            if isinstance(item, dict) and item.get("id"):
                colab_line_meta[str(item["id"])] = item

    missing: list[str] = []
    probed: dict[str, dict[str, Any]] = {}
    for ln in lines:
        lid = ln["id"]
        wav_path = audio_dir / f"{lid}.wav"
        if not wav_path.exists():
            missing.append(str(wav_path))
            continue
        probed[lid] = _probe_wav(wav_path)

    if missing:
        raise FileNotFoundError(
            f"Missing {len(missing)}/{len(lines)} real mnr TTS WAV clip(s) in {audio_dir}:\n  "
            + "\n  ".join(missing[:8])
        )

    defaults = script.get("timing_defaults", {})
    default_gap = float(defaults.get("inter_line_gap_sec", 0.25))
    default_pad = float(defaults.get("scene_tail_pad_sec", 0.55))

    cursor = 0.0
    scene_timings: list[dict[str, Any]] = []
    line_timings: list[dict[str, Any]] = []

    for sc in scenes:
        sid = sc["scene_id"]
        gap = float(sc.get("inter_line_gap_sec", default_gap))
        pad = float(sc.get("post_scene_pad_sec", default_pad))
        scene_start = round(cursor, 3)
        sc_line_ids = list(sc["line_ids"])

        for idx_in_scene, lid in enumerate(sc_line_ids):
            ln = lines_by_id[lid]
            info = probed[lid]
            line_start = round(cursor, 3)
            dur_sec = float(info["duration_sec"])
            line_end = round(line_start + dur_sec, 3)
            cursor = line_end

            cm = colab_line_meta.get(lid, {})
            line_timings.append(
                {
                    "id": lid,
                    "index": ln["index"],
                    "scene_id": sid,
                    "speaker": ln["speaker"],
                    "selected_take": int(cm.get("selected_take") or 1),
                    "audio_file": f"audio/{lid}.wav",
                    "audio_filename": f"{lid}.wav",
                    "start_sec": line_start,
                    "end_sec": line_end,
                    "duration_sec": round(dur_sec, 3),
                    "duration_ms": int(info["duration_ms"]),
                    "size_bytes": int(info["size_bytes"]),
                    "sha256": info["sha256"],
                    "sample_rate": int(info["sample_rate"]),
                    "channels": int(info["channels"]),
                    "codec": info["codec"],
                    "subtitle_zh": ln["subtitle_zh"],
                    "subtitle_ja": ln["subtitle_ja"],
                    "text_tts": ln["text_tts"],
                }
            )
            if idx_in_scene < len(sc_line_ids) - 1:
                cursor = round(cursor + gap, 3)

        cursor = round(cursor + pad, 3)
        scene_end = round(cursor, 3)
        scene_timings.append(
            {
                "scene_id": sid,
                "index": sc["index"],
                "title_zh": sc["title_zh"],
                "start_sec": scene_start,
                "end_sec": scene_end,
                "duration_sec": round(scene_end - scene_start, 3),
                "line_ids": sc_line_ids,
            }
        )

    now_utc = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta_src = colab_timings if isinstance(colab_timings, dict) else {}
    return {
        "schema": "moesekai-pv-timings/1",
        "is_real_mnr_tts": True,
        "source": str(meta_src.get("source") or "colab_drama3_int4"),
        "model": str(meta_src.get("model") or script.get("model", "fishaudio/drama-3-int4")),
        "engine": str(meta_src.get("engine") or script.get("engine", "sglang-omni")),
        "voice_id": script["voice"]["voice_id"],
        "voice_display_zh": script["voice"]["display_name_zh"],
        "voice_display_ja": script["voice"]["display_name_ja"],
        "gpu": str(meta_src.get("gpu") or "unknown"),
        "gpu_tier": str(meta_src.get("gpu_tier") or "A100"),
        "generated_at": str(meta_src.get("generated_at") or now_utc),
        "ingested_at": now_utc,
        "audio_spec": script["audio_spec"],
        "total_duration_sec": round(cursor, 3),
        "total_lines": len(line_timings),
        "scenes": scene_timings,
        "lines": line_timings,
    }


def trigger_video_remux(video_dir: Path) -> int:
    """Invoke promo/video/render_final.py (or render_final.ts via bun) if present."""
    py_script = video_dir / "render_final.py"
    ts_script = video_dir / "render_final.ts"
    if py_script.exists():
        cmd = [sys.executable, str(py_script)]
    elif ts_script.exists():
        bun = shutil.which("bun") or "bun"
        cmd = [bun, "run", str(ts_script)]
    else:
        print(
            f"[unpack] Note: neither {py_script} nor {ts_script} found yet; skipping --render.",
            file=sys.stderr,
        )
        return 0
    print(f"[unpack] Running video render pipeline: {' '.join(cmd)}")
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT))
    return int(proc.returncode)


def run_self_test() -> int:
    """Run isolated temp-dir unit tests for safe unpack, Zip Slip block, and timings generation."""
    script = _load_script(SCRIPT_JSON_PATH)
    line_ids = [ln["id"] for ln in script["lines"]]

    with tempfile.TemporaryDirectory(prefix="moesekai-vo-selftest-") as tmp:
        tmp_root = Path(tmp)
        good_zip = tmp_root / "mnr_voiceover_pack.zip"
        out_audio = tmp_root / "audio"

        # 1. Build a valid synthetic zip containing 16 short PCM WAVs + manifest + timings
        manifest_files = []
        with zipfile.ZipFile(good_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for ln in script["lines"]:
                wav_tmp = tmp_root / f"{ln['id']}.wav"
                with wave.open(str(wav_tmp), "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(48000)
                    wf.writeframes(b"\x00\x00" * 48000)  # 1.000s PCM silence
                raw = wav_tmp.read_bytes()
                rel = f"audio/{ln['id']}.wav"
                zf.writestr(rel, raw)
                manifest_files.append(
                    {"path": rel, "size_bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                )
            zf.writestr(
                "pack_manifest.json",
                json.dumps({"schema": "moesekai-pv-voiceover-pack/1", "files": manifest_files}),
            )
            zf.writestr(
                "timings.json",
                json.dumps({"schema": "moesekai-pv-timings/1", "gpu": "A100-SXM4-80GB", "gpu_tier": "A100-80GB"}),
            )

        colab_t, manifest, wavs = unpack_zip_safely(
            zip_path=good_zip, audio_dir=out_audio, expected_line_ids=line_ids
        )
        assert len(wavs) == len(line_ids), f"expected {len(line_ids)} wavs, got {len(wavs)}"
        assert manifest is not None
        timings = verify_and_build_timings(script=script, audio_dir=out_audio, colab_timings=colab_t)
        assert timings["is_real_mnr_tts"] is True
        assert timings["total_lines"] == 16
        assert len(timings["scenes"]) == 8
        assert timings["total_duration_sec"] > 20.0

        # 2. Verify Zip Slip traversal is blocked
        bad_zip = tmp_root / "evil.zip"
        with zipfile.ZipFile(bad_zip, "w") as zf:
            zf.writestr("../escape.wav", b"bad")
        blocked = False
        try:
            unpack_zip_safely(zip_path=bad_zip, audio_dir=tmp_root / "audio2", expected_line_ids=line_ids)
        except ValueError:
            blocked = True
        assert blocked, "Zip Slip traversal was NOT blocked!"

    print(
        f"[self-test] PASS: unpacked 16/16 WAVs, verified SHA-256 & timings.json "
        f"({timings['total_duration_sec']:.2f}s), and blocked Zip Slip traversal."
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Unpack & verify Colab Drama 3 mnr TTS voiceover zip")
    ap.add_argument("--zip", dest="zip_path", type=Path, default=None, help="Path to mnr_voiceover_pack.zip")
    ap.add_argument("--script", type=Path, default=SCRIPT_JSON_PATH, help="Path to promo/voiceover/script.json")
    ap.add_argument("--audio-dir", type=Path, default=AUDIO_DIR, help="Output directory for real mnr WAV clips")
    ap.add_argument("--timings-out", type=Path, default=TIMINGS_JSON_PATH, help="Output path for canonical timings.json")
    ap.add_argument("--verify-only", action="store_true", help="Verify existing audio/*.wav without unpacking a zip")
    ap.add_argument("--render", action="store_true", help="Invoke promo/video/render_final.py after unpacking")
    ap.add_argument("--self-test", action="store_true", help="Run isolated temp-dir verification tests")
    args = ap.parse_args()

    if args.self_test:
        return run_self_test()

    script = _load_script(args.script)
    line_ids = [ln["id"] for ln in script["lines"]]
    colab_timings: dict[str, Any] | None = None

    if not args.verify_only:
        if args.zip_path is None:
            ap.error("Provide --zip <path/to/mnr_voiceover_pack.zip>, --verify-only, or --self-test")
        colab_timings, pack_manifest, extracted = unpack_zip_safely(
            zip_path=args.zip_path,
            audio_dir=args.audio_dir,
            expected_line_ids=line_ids,
        )
        print(f"[unpack] Extracted {len(extracted)}/{len(line_ids)} verified WAV clip(s) into {args.audio_dir}")
        if pack_manifest is not None:
            PACK_MANIFEST_PATH.write_text(
                json.dumps(pack_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )

    timings = verify_and_build_timings(
        script=script,
        audio_dir=args.audio_dir,
        colab_timings=colab_timings,
    )
    args.timings_out.write_text(json.dumps(timings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"[unpack] Verified {timings['total_lines']}/16 real mnr WAV clips -> {args.timings_out} "
        f"(total duration: {timings['total_duration_sec']:.2f}s across {len(timings['scenes'])} scenes)"
    )

    if args.render:
        return trigger_video_remux(VIDEO_DIR)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
