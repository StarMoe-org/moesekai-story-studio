# MoeSekai Story Studio — Bilibili 1080p60 Promotional Video & Cover Pipeline

Code-driven, deterministic **1920×1080 @ 60fps H.264 (`yuv420p`, BT.709) + 48kHz Stereo AAC** motion-graphics pipeline plus 16:9 high-CTR Bilibili cover composer.

## Directory Layout

- `render_final.py` — Single-command end-to-end orchestrator (captures ingest, voiceover/subtitle alignment, SEKAI BGM + SFX + ducking master, parallel Chromium 1080p60 rendering, `ffprobe` validation, keyframe & contact-sheet extraction).
- `audio/compose_audio.py` — Original, 100% copyright-safe 128 BPM SEKAI synth-pop BGM + bespoke UI/prism/三连 SFX synthesizer + voiceover presence EQ & smooth `-8.5 dB` sidechain ducking + `-14 LUFS` broadcast loudness normalizer.
- `engine/`
  - `scene-player.html`, `styles.css`, `scenes.js` — Deterministic 8-chapter HTML5/CSS3 3D + Canvas + Official PJSK Bilingual Subtitle (`MiSans` + `FOT-RodinNTLG Pro B`) motion-graphics stage.
  - `cover.html` — High-CTR 1920×1080 Bilibili thumbnail designer (with bottom-right duration safe zone).
  - `render.ts` — Zero-dependency Bun parallel `chrome-headless-shell` CDP frame-stepper + FFmpeg H.264/AAC mastering engine.
- `out/`
  - `moesekai-story-studio-pv-preview.mp4` — Complete 1080p60 preview master (BGM + SFX + animated bilingual subtitles + real app captures).
  - `moesekai-story-studio-pv.mp4` — Final voiceover-synced 1080p60 master (automatically generated once real `mnr` TTS WAVs exist in `promo/voiceover/audio/`).
  - `bilibili-cover.png` — 1920×1080 Bilibili cover image.
  - `storyboard-contact-sheet.png` & `keyframes/` — Visual QA frame inspection outputs.

## Usage

### 1. Render Preview Master + Bilibili Cover (Before Colab Voiceover)

```bash
python promo/video/render_final.py --workers 6
```

### 2. Render Final `mnr` Voiceover-Synced Master (After Colab A100 Run)

Once you run `promo/voiceover/mnr_drama3_colab.ipynb` on Colab A100 and download `mnr_voiceover_pack.zip`, run the single-command unpack + final render:

```bash
python promo/voiceover/unpack_colab_voice.py --zip /path/to/mnr_voiceover_pack.zip --render
```

Or run `render_final.py` directly after WAV files are placed in `promo/voiceover/audio/`:

```bash
python promo/video/render_final.py
```

`render_final.py` automatically detects the 16 real `mnr` TTS WAV files + `promo/voiceover/timings.json`, dynamically syncs all 8 scene durations and bilingual subtitle cues to the real spoken durations, ducks the SEKAI synth-pop BGM smoothly underneath Minori's voice, and masters `promo/video/out/moesekai-story-studio-pv.mp4`!

### Extra Options

- Cover only: `python promo/video/render_final.py --cover-only`
- Quick 4-second smoke check: `python promo/video/render_final.py --smoke --workers 4`
- Preview with temporary timing-guide audio (not final `mnr` TTS): `python promo/video/render_final.py --use-guide`
