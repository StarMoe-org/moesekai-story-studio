# Real Drama 3 `mnr` Voiceover Audio Directory (`promo/voiceover/audio/`)

This directory is reserved **exclusively** for real **Fish Audio Drama 3 INT4 (`fishaudio/drama-3-int4`)** voiceover clips synthesized with花里实乃理 (`pjsk_05_minori`) on Google Colab A100.

Do **not** place synthetic placeholder audio here (temporary timing guides live strictly in `../guide_audio/`).

## How to Populate This Folder

1. Upload and run `../mnr_drama3_colab.ipynb` in Google Colab with an **A100 GPU (40GB or 80GB)**.
2. Download `mnr_voiceover_pack.zip` at the end of Step 10.
3. Run from the repository root:
   ```bash
   python promo/voiceover/unpack_colab_voice.py --zip path/to/mnr_voiceover_pack.zip --render
   ```

Expected files after unpacking (`16` lossless 48 kHz mono 16-bit PCM WAV clips, `-16 LUFS`):
- `01_hook_a.wav` .. `16_cta_b.wav` (exact 1:1 match with `../script.json`)
