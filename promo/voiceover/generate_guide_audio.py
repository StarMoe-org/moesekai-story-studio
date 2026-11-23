#!/usr/bin/env python3
"""Generate clearly-labeled temporary timing-guide placeholders in promo/voiceover/guide_audio/.

IMPORTANT:
- These clips are ONLY subtle cadence/timing guides for video preview pacing verification.
- They are NEVER placed inside `promo/voiceover/audio/` and are explicitly tagged
  `"is_real_mnr_tts": false` in `promo/voiceover/timings.estimated.json`.
- Replace with real Drama 3 `mnr` TTS audio by running `mnr_drama3_colab.ipynb` on Colab A100
  and unpacking `mnr_voiceover_pack.zip` via `unpack_colab_voice.py`.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import math
import struct
import wave
from pathlib import Path

VOICEOVER_DIR = Path(__file__).resolve().parent
SCRIPT_JSON_PATH = VOICEOVER_DIR / "script.json"
GUIDE_AUDIO_DIR = VOICEOVER_DIR / "guide_audio"
EST_TIMINGS_PATH = VOICEOVER_DIR / "timings.estimated.json"

SAMPLE_RATE = 48000


def _synth_guide_tone(duration_sec: float, freq_hz: float) -> bytes:
    """Synthesize a very gentle, non-intrusive soft chime onset + quiet cadence tail (48kHz PCM16)."""
    n_samples = max(1, int(round(duration_sec * SAMPLE_RATE)))
    buf = bytearray(n_samples * 2)
    attack = int(0.015 * SAMPLE_RATE)
    chime_len = int(0.18 * SAMPLE_RATE)
    end_marker_start = max(chime_len, n_samples - int(0.09 * SAMPLE_RATE))

    for i in range(n_samples):
        t = i / SAMPLE_RATE
        sample = 0.0
        # Soft sparkling onset chime (quiet -26 dBFS so BGM/subtitles stay clear)
        if i < chime_len:
            env = (i / attack) if i < attack else math.exp(-16.0 * (i - attack) / SAMPLE_RATE)
            sample += 0.045 * env * (
                0.7 * math.sin(2.0 * math.pi * freq_hz * t)
                + 0.3 * math.sin(2.0 * math.pi * (freq_hz * 1.5) * t)
            )
        # Subtle end-of-line soft release tick
        if i >= end_marker_start:
            rel_i = i - end_marker_start
            env = math.exp(-35.0 * rel_i / SAMPLE_RATE)
            sample += 0.018 * env * math.sin(2.0 * math.pi * (freq_hz * 0.75) * t)

        clamped = max(-1.0, min(1.0, sample))
        struct.pack_into("<h", buf, i * 2, int(round(clamped * 32767.0)))
    return bytes(buf)


def main() -> int:
    script = json.loads(SCRIPT_JSON_PATH.read_text(encoding="utf-8"))
    GUIDE_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    # Gentle pentatonic scale frequencies across 8 scenes so scene boundaries are audibly clear in guide mode
    scene_freqs = [523.25, 587.33, 659.25, 783.99, 880.0, 659.25, 587.33, 783.99]
    lines_by_id = {ln["id"]: ln for ln in script["lines"]}
    defaults = script.get("timing_defaults", {})
    default_gap = float(defaults.get("inter_line_gap_sec", 0.25))
    default_pad = float(defaults.get("scene_tail_pad_sec", 0.55))

    cursor = 0.0
    scene_timings = []
    line_timings = []

    for sc_idx, sc in enumerate(script["scenes"]):
        sid = sc["scene_id"]
        gap = float(sc.get("inter_line_gap_sec", default_gap))
        pad = float(sc.get("post_scene_pad_sec", default_pad))
        base_freq = scene_freqs[sc_idx % len(scene_freqs)]
        scene_start = round(cursor, 3)

        for idx_in_scene, lid in enumerate(sc["line_ids"]):
            ln = lines_by_id[lid]
            dur_sec = float(ln["est_duration_sec"])
            wav_path = GUIDE_AUDIO_DIR / f"{lid}.wav"
            pcm = _synth_guide_tone(dur_sec, base_freq * (1.0 if idx_in_scene == 0 else 1.12246))
            with wave.open(str(wav_path), "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(SAMPLE_RATE)
                wf.writeframes(pcm)

            raw_bytes = wav_path.read_bytes()
            line_start = round(cursor, 3)
            line_end = round(line_start + dur_sec, 3)
            cursor = line_end

            line_timings.append(
                {
                    "id": lid,
                    "index": ln["index"],
                    "scene_id": sid,
                    "speaker": ln["speaker"],
                    "is_guide_placeholder": True,
                    "audio_file": f"guide_audio/{lid}.wav",
                    "audio_filename": f"{lid}.wav",
                    "start_sec": line_start,
                    "end_sec": line_end,
                    "duration_sec": round(dur_sec, 3),
                    "duration_ms": max(1, int(round(dur_sec * 1000))),
                    "size_bytes": len(raw_bytes),
                    "sha256": hashlib.sha256(raw_bytes).hexdigest(),
                    "sample_rate": SAMPLE_RATE,
                    "channels": 1,
                    "codec": "pcm_s16le",
                    "subtitle_zh": ln["subtitle_zh"],
                    "subtitle_ja": ln["subtitle_ja"],
                    "text_tts": ln["text_tts"],
                }
            )
            if idx_in_scene < len(sc["line_ids"]) - 1:
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
                "line_ids": list(sc["line_ids"]),
            }
        )

    doc = {
        "schema": "moesekai-pv-timings/1",
        "is_real_mnr_tts": False,
        "source": "estimated_timing_guide",
        "warning": "TEMPORARY TIMING GUIDE ONLY — NOT real Fish Audio Drama 3 mnr TTS audio! Run mnr_drama3_colab.ipynb on Colab A100 and unpack via unpack_colab_voice.py to produce promo/voiceover/audio/*.wav and promo/voiceover/timings.json.",
        "model": script["model"],
        "voice_id": script["voice"]["voice_id"],
        "voice_display_zh": script["voice"]["display_name_zh"],
        "voice_display_ja": script["voice"]["display_name_ja"],
        "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "audio_spec": script["audio_spec"],
        "total_duration_sec": round(cursor, 3),
        "total_lines": len(line_timings),
        "scenes": scene_timings,
        "lines": line_timings,
    }
    EST_TIMINGS_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Generated {len(line_timings)} temporary timing-guide WAV clips in {GUIDE_AUDIO_DIR} "
        f"and {EST_TIMINGS_PATH} (total estimated: {doc['total_duration_sec']:.2f}s)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
