#!/usr/bin/env python3
"""
MoeSekai Story Studio Bilibili PV — Original SEKAI-Inspired Synth-Pop BGM, SFX & Mastering Engine
100% copyright-safe procedural synthesis in Python (NumPy + SciPy), 48 kHz Stereo PCM.
Supports:
  - Dynamic duration & scene energy map driven by timeline.json
  - Beat-synced 128 BPM upbeat J-Pop / SEKAI prism synth-pop instrumental
  - Bespoke UI / Prism Transition / Bilibili 一键三连 SFX triggers
  - Automatic voiceover alignment, vocal presence EQ, smooth sidechain envelope ducking (-8.5 dB)
  - K-weighted loudness normalization (-14 LUFS target, -1.0 dBTP limiter)
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any

import numpy as np
from scipy import signal

SR = 48000
BPM = 128.0
BEAT = 60.0 / BPM          # 0.46875 s
BAR = BEAT * 4.0           # 1.875 s
SIXTEENTH = BEAT / 4.0     # 0.1171875 s


def midi_to_hz(m: float) -> float:
    return 440.0 * (2.0 ** ((m - 69.0) / 12.0))


def make_reverb_ir(duration: float = 1.6, decay: float = 3.6, sr: int = SR) -> np.ndarray:
    """Stereo lush algorithmic hall reverb impulse response."""
    rng = np.random.default_rng(20260309)
    n = int(duration * sr)
    t = np.arange(n) / sr
    env = np.exp(-decay * t)
    # Slight pre-delay (18ms)
    pre = int(0.018 * sr)
    env[:pre] = 0.0
    # Smooth fade-in after pre-delay
    fade = int(0.012 * sr)
    env[pre:pre + fade] *= np.linspace(0.0, 1.0, fade)

    noise_l = rng.standard_normal(n) * env
    noise_r = rng.standard_normal(n) * env

    # Warm damping filter (LPF at 5.2kHz, HPF at 180Hz)
    sos_lp = signal.butter(2, 5200.0, btype="low", fs=sr, output="sos")
    sos_hp = signal.butter(2, 180.0, btype="high", fs=sr, output="sos")
    ir_l = signal.sosfilt(sos_hp, signal.sosfilt(sos_lp, noise_l))
    ir_r = signal.sosfilt(sos_hp, signal.sosfilt(sos_lp, noise_r))

    # Add crisp early reflections
    early_taps = [
        (0.019, 0.35, 0.15),
        (0.031, 0.14, 0.32),
        (0.047, 0.24, 0.18),
        (0.068, 0.15, 0.22),
    ]
    for delay_s, gl, gr in early_taps:
        idx = int(delay_s * sr)
        if idx < n:
            ir_l[idx] += gl
            ir_r[idx] += gr

    ir = np.stack([ir_l, ir_r], axis=1)
    norm = np.sqrt(np.mean(np.sum(ir ** 2, axis=0))) + 1e-9
    return (ir / norm) * 0.28


def apply_stereo_reverb(stereo: np.ndarray, ir: np.ndarray, wet: float = 0.24) -> np.ndarray:
    n = stereo.shape[0]
    rev_l = signal.fftconvolve(stereo[:, 0], ir[:, 0], mode="full")[:n]
    rev_r = signal.fftconvolve(stereo[:, 1], ir[:, 1], mode="full")[:n]
    return stereo + wet * np.stack([rev_l, rev_r], axis=1)


def soft_saw(phase: np.ndarray, harmonics: int = 10) -> np.ndarray:
    """Band-limited warm sawtooth using additive harmonics (zero harsh aliasing)."""
    out = np.zeros_like(phase)
    for k in range(1, harmonics + 1):
        out += ((-1.0) ** (k + 1)) * (1.0 / k) * np.sin(k * phase)
    return out * (2.0 / np.pi)


def synth_kick(sr: int = SR) -> np.ndarray:
    dur = 0.34
    n = int(dur * sr)
    t = np.arange(n) / sr
    # Pitch envelope: 155 Hz -> 48 Hz quickly
    f = 48.0 + 115.0 * np.exp(-t * 42.0) + 45.0 * np.exp(-t * 160.0)
    phase = 2.0 * np.pi * np.cumsum(f) / sr
    body = np.sin(phase) * np.exp(-t * 10.5)
    # Crisp transient click
    rng = np.random.default_rng(11)
    click = rng.standard_normal(n) * np.exp(-t * 280.0) * 0.22
    sos = signal.butter(2, [900.0, 4800.0], btype="band", fs=sr, output="sos")
    click = signal.sosfilt(sos, click)
    mono = np.tanh((body + click) * 1.35) * 0.92
    # Fade end cleanly
    mono[-64:] *= np.linspace(1.0, 0.0, 64)
    return np.stack([mono, mono], axis=1)


def synth_snare_clap(sr: int = SR) -> np.ndarray:
    dur = 0.28
    n = int(dur * sr)
    t = np.arange(n) / sr
    rng = np.random.default_rng(22)

    # Punchy tonal snap
    f = 185.0 + 95.0 * np.exp(-t * 60.0)
    body = np.sin(2.0 * np.pi * np.cumsum(f) / sr) * np.exp(-t * 26.0) * 0.42

    # Multi-burst stereo pop clap
    noise_l = rng.standard_normal(n)
    noise_r = rng.standard_normal(n)
    env_clap = (
        np.exp(-np.maximum(t - 0.000, 0.0) * 90.0) * (t >= 0.000) * 0.45
        + np.exp(-np.maximum(t - 0.009, 0.0) * 85.0) * (t >= 0.009) * 0.50
        + np.exp(-np.maximum(t - 0.019, 0.0) * 18.0) * (t >= 0.019) * 0.85
    )
    sos_bp = signal.butter(2, [1100.0, 7200.0], btype="band", fs=sr, output="sos")
    clap_l = signal.sosfilt(sos_bp, noise_l * env_clap) * 0.85
    clap_r = signal.sosfilt(sos_bp, noise_r * env_clap) * 0.85

    # Crisp snare wire top
    sos_hp = signal.butter(2, 4200.0, btype="high", fs=sr, output="sos")
    wire_env = np.exp(-t * 22.0)
    wire_l = signal.sosfilt(sos_hp, rng.standard_normal(n)) * wire_env * 0.25
    wire_r = signal.sosfilt(sos_hp, rng.standard_normal(n)) * wire_env * 0.25

    out = np.stack([body + clap_l + wire_l, body + clap_r + wire_r], axis=1)
    out = np.tanh(out * 1.15) * 0.72
    out[-64:] *= np.linspace(1.0, 0.0, 64)[:, None]
    return out


def synth_hihat(open_hat: bool = False, sr: int = SR) -> np.ndarray:
    dur = 0.22 if open_hat else 0.055
    n = int(dur * sr)
    t = np.arange(n) / sr
    rng = np.random.default_rng(33 if not open_hat else 34)
    # Metallic shimmer + noise
    noise = rng.standard_normal(n)
    metal = (
        np.sin(2 * np.pi * 6230 * t)
        + np.sin(2 * np.pi * 8410 * t)
        + np.sin(2 * np.pi * 10720 * t)
    ) * 0.14
    sos = signal.butter(3, 6800.0, btype="high", fs=sr, output="sos")
    h_l = signal.sosfilt(sos, noise + metal)
    h_r = signal.sosfilt(sos, rng.standard_normal(n) + metal)
    decay = 16.0 if open_hat else 78.0
    env = np.exp(-t * decay)
    env[:16] *= np.linspace(0.0, 1.0, 16)
    amp = 0.22 if open_hat else 0.16
    return np.stack([h_l * env * amp, h_r * env * amp], axis=1)


def synth_crash(sr: int = SR) -> np.ndarray:
    dur = 2.0
    n = int(dur * sr)
    t = np.arange(n) / sr
    rng = np.random.default_rng(44)
    sos = signal.butter(2, [3400.0, 14500.0], btype="band", fs=sr, output="sos")
    env = np.exp(-t * 2.4)
    env[:48] *= np.linspace(0.0, 1.0, 48)
    cl = signal.sosfilt(sos, rng.standard_normal(n)) * env * 0.24
    cr = signal.sosfilt(sos, rng.standard_normal(n)) * env * 0.24
    return np.stack([cl, cr], axis=1)


def synth_fm_bell(freq: float, dur: float, amp: float = 0.22, brightness: float = 1.6, pan: float = 0.0) -> np.ndarray:
    """Crystalline SEKAI FM electric-piano / prism bell note."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    mod_env = brightness * np.exp(-t * 9.0) + 0.15 * np.exp(-t * 2.5)
    mod1 = np.sin(2.0 * np.pi * (freq * 2.0) * t) * mod_env
    mod2 = np.sin(2.0 * np.pi * (freq * 3.0) * t) * (mod_env * 0.35)
    carrier = np.sin(2.0 * np.pi * freq * t + mod1 + mod2)
    # Add soft octave sparkle
    sparkle = np.sin(2.0 * np.pi * (freq * 2.0) * t) * np.exp(-t * 14.0) * 0.18
    env = (1.0 - np.exp(-t * 320.0)) * np.exp(-t * 3.4)
    if n > 120:
        env[-120:] *= np.linspace(1.0, 0.0, 120)
    mono = (carrier + sparkle) * env * amp
    angle = (pan + 1.0) * (np.pi / 4.0)
    return np.stack([mono * math.cos(angle), mono * math.sin(angle)], axis=1)


def synth_lead_note(freq: float, dur: float, amp: float = 0.18, pan: float = 0.0) -> np.ndarray:
    """Warm uplifting Vocaloid/J-pop synth lead note with gentle vibrato."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    vib = 1.0 + 0.0045 * np.sin(2.0 * np.pi * 5.6 * t) * np.clip((t - 0.08) / 0.15, 0.0, 1.0)
    phase = 2.0 * np.pi * np.cumsum(freq * vib) / SR
    osc = 0.55 * soft_saw(phase, 7) + 0.45 * np.sin(phase) + 0.20 * np.sin(2.0 * phase)
    sos = signal.butter(2, min(4200.0, freq * 6.0), btype="low", fs=SR, output="sos")
    osc = signal.sosfilt(sos, osc)
    attack = 1.0 - np.exp(-t * 110.0)
    release_len = min(int(0.06 * SR), n // 3)
    env = attack * (0.72 + 0.28 * np.exp(-t * 4.5))
    if release_len > 0:
        env[-release_len:] *= np.linspace(1.0, 0.0, release_len)
    mono = osc * env * amp
    angle = (pan + 1.0) * (np.pi / 4.0)
    return np.stack([mono * math.cos(angle), mono * math.sin(angle)], axis=1)


def synth_supersaw_chord(midi_notes: list[int], dur: float, amp: float = 0.16) -> np.ndarray:
    """Wide detuned supersaw pad for lush SEKAI synth-pop harmony."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out_l = np.zeros(n, dtype=np.float64)
    out_r = np.zeros(n, dtype=np.float64)
    detunes = [-0.0055, -0.0022, 0.0, 0.0022, 0.0055]
    pans = [-0.75, -0.35, 0.0, 0.35, 0.75]
    for m in midi_notes:
        base_f = midi_to_hz(m)
        for d, p in zip(detunes, pans):
            ph = 2.0 * np.pi * base_f * (1.0 + d) * t
            w = soft_saw(ph, 7)
            ang = (p + 1.0) * (np.pi / 4.0)
            out_l += w * math.cos(ang)
            out_r += w * math.sin(ang)
    scale = amp / (len(midi_notes) * len(detunes) * 0.55)
    out_l *= scale
    out_r *= scale
    sos = signal.butter(2, 2900.0, btype="low", fs=SR, output="sos")
    out_l = signal.sosfilt(sos, out_l)
    out_r = signal.sosfilt(sos, out_r)
    att = min(int(0.025 * SR), n // 4)
    rel = min(int(0.08 * SR), n // 3)
    env = np.ones(n)
    if att > 0:
        env[:att] = np.linspace(0.0, 1.0, att)
    if rel > 0:
        env[-rel:] = np.linspace(1.0, 0.0, rel)
    return np.stack([out_l * env, out_r * env], axis=1)


def synth_bass_note(midi_note: int, dur: float, amp: float = 0.28) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = midi_to_hz(midi_note)
    ph = 2.0 * np.pi * f * t
    sub = np.sin(ph)
    grit = soft_saw(ph, 6)
    sos = signal.butter(2, 560.0, btype="low", fs=SR, output="sos")
    grit = signal.sosfilt(sos, grit)
    env = (1.0 - np.exp(-t * 220.0)) * (0.65 + 0.35 * np.exp(-t * 9.0))
    rel = min(int(0.025 * SR), n // 4)
    if rel > 0:
        env[-rel:] *= np.linspace(1.0, 0.0, rel)
    mono = (0.62 * sub + 0.48 * grit) * env * amp
    return np.stack([mono, mono], axis=1)


def add_buf(target: np.ndarray, sample: np.ndarray, start_sec: float, gain: float = 1.0) -> None:
    idx = int(round(start_sec * SR))
    if idx >= target.shape[0]:
        return
    if idx < 0:
        sample = sample[-idx:]
        idx = 0
    end = min(target.shape[0], idx + sample.shape[0])
    length = end - idx
    if length > 0:
        target[idx:end] += sample[:length] * gain


# ---------------------------------------------------------------------------
# Bespoke SFX Generators
# ---------------------------------------------------------------------------

def sfx_prism_whoosh(dur: float = 0.52) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(101)
    # Filtered sweeping shimmer
    env = np.sin(np.pi * (t / dur)) ** 1.6
    # Crossfade low-passed and high-passed noise for smooth filter sweep
    raw_l = rng.standard_normal(n)
    raw_r = rng.standard_normal(n)
    lo_l = signal.sosfilt(signal.butter(2, [350.0, 1800.0], btype="band", fs=SR, output="sos"), raw_l)
    hi_l = signal.sosfilt(signal.butter(2, [1800.0, 9500.0], btype="band", fs=SR, output="sos"), raw_l)
    lo_r = signal.sosfilt(signal.butter(2, [350.0, 1800.0], btype="band", fs=SR, output="sos"), raw_r)
    hi_r = signal.sosfilt(signal.butter(2, [1800.0, 9500.0], btype="band", fs=SR, output="sos"), raw_r)
    sweep = np.clip(t / dur, 0.0, 1.0)
    w_l = (lo_l * (1.0 - sweep) + hi_l * sweep) * env * 0.34
    w_r = (lo_r * (1.0 - sweep) + hi_r * sweep) * env * 0.34

    # Crystalline pitch glide
    f1 = 587.33 * (2.0 ** (sweep * 1.0))  # D5 -> D6
    f2 = 880.0 * (2.0 ** (sweep * 1.0))   # A5 -> A6
    tone = (np.sin(2 * np.pi * np.cumsum(f1) / SR) + 0.6 * np.sin(2 * np.pi * np.cumsum(f2) / SR)) * env * 0.14
    return np.stack([w_l + tone, w_r + tone], axis=1)


def sfx_drop_impact() -> np.ndarray:
    dur = 0.95
    n = int(dur * SR)
    t = np.arange(n) / SR
    # Warm sub impact
    f = 42.0 + 95.0 * np.exp(-t * 16.0)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.2) * 0.55
    # Dmaj9 sparkling star bloom
    notes = [74, 78, 81, 85, 88]  # D5, F#5, A5, C#6, E6
    buf = np.stack([sub, sub], axis=1)
    for i, m in enumerate(notes):
        bell = synth_fm_bell(midi_to_hz(m), 0.72, amp=0.14, brightness=2.2, pan=(i - 2) * 0.35)
        add_buf(buf, bell, i * 0.028)
    return buf


def sfx_ui_pop(pitch_mul: float = 1.0) -> np.ndarray:
    dur = 0.11
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = (460.0 + 680.0 * np.exp(-t * 45.0)) * pitch_mul
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 36.0) * 0.24
    spark = np.sin(2 * np.pi * 1760.0 * pitch_mul * t) * np.exp(-t * 65.0) * 0.10
    mono = tone + spark
    mono[:16] *= np.linspace(0.0, 1.0, 16)
    return np.stack([mono, mono], axis=1)


def sfx_type_tick(seed: int = 0) -> np.ndarray:
    dur = 0.032
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(500 + seed)
    f = 2100.0 + (seed % 5) * 140.0
    click = (np.sin(2 * np.pi * f * t) * 0.5 + rng.standard_normal(n) * 0.5) * np.exp(-t * 180.0) * 0.13
    sos = signal.butter(2, [1200.0, 7000.0], btype="band", fs=SR, output="sos")
    click = signal.sosfilt(sos, click)
    pan = ((seed % 7) - 3) * 0.12
    ang = (pan + 1.0) * (np.pi / 4.0)
    return np.stack([click * math.cos(ang), click * math.sin(ang)], axis=1)


def sfx_star_chime() -> np.ndarray:
    buf = np.zeros((int(1.1 * SR), 2), dtype=np.float64)
    notes = [74, 81, 85, 86, 90]  # D5 A5 C#6 D6 F#6
    for i, m in enumerate(notes):
        bell = synth_fm_bell(midi_to_hz(m), 0.65, amp=0.13, brightness=2.1, pan=(i - 2) * 0.35)
        add_buf(buf, bell, i * 0.045)
    return buf


def sfx_triad_combo() -> np.ndarray:
    """Three ascending sparkling chimes for Bilibili 点赞 · 投币 · 收藏!"""
    buf = np.zeros((int(1.8 * SR), 2), dtype=np.float64)
    triad = [
        (0.00, [74, 78, 81]),       # D major ping
        (0.32, [76, 81, 85]),       # A/E ping
        (0.64, [78, 81, 86, 90]),   # Dmaj sparkle burst!
    ]
    for offset, chord in triad:
        for j, m in enumerate(chord):
            bell = synth_fm_bell(midi_to_hz(m), 0.72, amp=0.14, brightness=2.4, pan=(j - 1.5) * 0.35)
            add_buf(buf, bell, offset + j * 0.022)
    return buf


# ---------------------------------------------------------------------------
# Main SEKAI Synth-Pop BGM Sequencer (128 BPM, D Major)
# ---------------------------------------------------------------------------

# 8-bar Royal Road uplifting progression in D Major:
# (bass_midi, chord_midis, arp_midis)
PROGRESSION_A = [
    (43, [55, 59, 62, 66, 69], [67, 71, 74, 78, 81, 78, 74, 71]),  # Gmaj9
    (45, [57, 61, 64, 66, 71], [69, 73, 76, 78, 81, 78, 76, 73]),  # A6/9
    (42, [54, 57, 61, 64, 69], [66, 69, 73, 76, 81, 76, 73, 69]),  # F#m7
    (47, [59, 62, 66, 69, 74], [71, 74, 78, 81, 86, 81, 78, 74]),  # Bm7
    (40, [52, 55, 59, 62, 67], [64, 67, 71, 74, 79, 74, 71, 67]),  # Em7
    (45, [57, 61, 64, 67, 71], [69, 73, 76, 79, 81, 79, 76, 73]),  # A9
    (38, [50, 54, 57, 61, 66], [62, 66, 69, 73, 78, 73, 69, 66]),  # Dmaj7
    (42, [54, 57, 62, 66, 69], [66, 69, 74, 78, 81, 78, 74, 69]),  # D/F#
]

# Catchy SEKAI-style lead motif (bar_offset_beats, duration_beats, midi_note) per 8-bar phrase
LEAD_MOTIF_BRIGHT = [
    (0.0, 0.75, 78), (0.75, 0.75, 81), (1.5, 1.0, 86), (2.5, 0.5, 85), (3.0, 1.0, 81),
    (4.0, 0.75, 78), (4.75, 0.75, 81), (5.5, 1.5, 85), (7.0, 1.0, 83),
    (8.0, 0.75, 81), (8.75, 0.75, 85), (9.5, 1.0, 88), (10.5, 0.5, 86), (11.0, 1.0, 85),
    (12.0, 1.5, 81), (13.5, 0.5, 78), (14.0, 2.0, 86),
    (16.0, 0.75, 79), (16.75, 0.75, 83), (17.5, 1.0, 86), (18.5, 0.5, 83), (19.0, 1.0, 81),
    (20.0, 0.75, 79), (20.75, 0.75, 81), (21.5, 1.5, 85), (23.0, 1.0, 88),
    (24.0, 2.5, 86), (26.5, 0.5, 85), (27.0, 1.0, 81),
    (28.0, 1.0, 78), (29.0, 1.0, 81), (30.0, 2.0, 86),
]

LEAD_MOTIF_GENTLE = [
    (0.0, 1.5, 78), (2.0, 1.5, 81),
    (4.0, 1.5, 76), (6.0, 1.5, 81),
    (8.0, 1.5, 78), (10.0, 1.5, 85),
    (12.0, 2.5, 81), (15.0, 1.0, 78),
    (16.0, 1.5, 79), (18.0, 1.5, 83),
    (20.0, 1.5, 81), (22.0, 1.5, 85),
    (24.0, 3.0, 86),
    (28.0, 2.0, 81), (30.0, 1.5, 78),
]


def compose_bgm(total_duration: float, scenes: list[dict[str, Any]], ir: np.ndarray) -> np.ndarray:
    n_samples = int(math.ceil(total_duration * SR))
    drums_bus = np.zeros((n_samples, 2), dtype=np.float64)
    pad_bus = np.zeros((n_samples, 2), dtype=np.float64)
    bell_bus = np.zeros((n_samples, 2), dtype=np.float64)
    bass_bus = np.zeros((n_samples, 2), dtype=np.float64)
    lead_bus = np.zeros((n_samples, 2), dtype=np.float64)

    kick = synth_kick()
    snare = synth_snare_clap()
    hat_c = synth_hihat(False)
    hat_o = synth_hihat(True)
    crash = synth_crash()

    # Map time -> scene energy profile
    def get_scene_mood(t: float) -> str:
        for sc in scenes:
            if sc["start"] <= t < sc["end"]:
                return sc.get("bgm_mood", "groove")
        return "climax"

    n_bars = int(math.ceil(total_duration / BAR))

    for bar_idx in range(n_bars):
        bar_t = bar_idx * BAR
        if bar_t >= total_duration - 0.8:
            break
        mood = get_scene_mood(bar_t + 0.1)
        prog_idx = bar_idx % len(PROGRESSION_A)
        bass_m, chord_ms, arp_ms = PROGRESSION_A[prog_idx]

        # Scene drop crash on phrase boundary or reveal/climax transition
        if prog_idx == 0 and mood in ("reveal", "groove", "climax"):
            add_buf(drums_bus, crash, bar_t, gain=0.75 if mood == "climax" else 0.55)

        # 1) Supersaw Chord Pad
        pad_amp = {"intro": 0.14, "reveal": 0.21, "groove": 0.16, "bridge": 0.17, "climax": 0.23}.get(mood, 0.16)
        chord_wav = synth_supersaw_chord(chord_ms, BAR * 0.98, amp=pad_amp)
        add_buf(pad_bus, chord_wav, bar_t)

        # 2) Crisp Electric Piano / Prism Bell rhythm hits + twinkling 16th arp
        arp_amp = {"intro": 0.12, "reveal": 0.16, "groove": 0.13, "bridge": 0.15, "climax": 0.18}.get(mood, 0.13)
        # Chord stab on beat 1 & upbeat of 2.5
        for st_beat, st_gain in [(0.0, 0.72), (1.5, 0.45), (2.5, 0.55)]:
            for idx_n, m in enumerate(chord_ms[1:4]):
                b_note = synth_fm_bell(
                    midi_to_hz(m + 12),
                    0.42,
                    amp=0.075 * st_gain,
                    brightness=1.5 if mood != "climax" else 2.1,
                    pan=(idx_n - 1) * 0.4,
                )
                add_buf(bell_bus, b_note, bar_t + st_beat * BEAT)

        # 8th/16th sparkling stereo prism arpeggio
        step_div = 16 if mood in ("reveal", "climax", "groove") else 8
        step_dur = BAR / step_div
        for s in range(step_div):
            # Subtle rhythmic space so it breathes
            if step_div == 16 and s % 4 == 3 and mood == "groove":
                continue
            m_arp = arp_ms[s % len(arp_ms)] + (12 if (mood == "climax" and s % 4 == 2) else 0)
            pan = math.sin(s * 0.9) * 0.65
            vel = 1.0 if s % 4 == 0 else (0.72 if s % 2 == 0 else 0.52)
            note_w = synth_fm_bell(midi_to_hz(m_arp), 0.26, amp=arp_amp * 0.62 * vel, brightness=1.9, pan=pan)
            add_buf(bell_bus, note_w, bar_t + s * step_dur)

        # 3) Bouncy Synth Bass (octave J-Pop drive)
        if mood != "intro" or bar_idx >= 1:
            bass_amp = 0.28 if mood in ("reveal", "climax") else 0.22
            if mood == "bridge":
                # Smooth sustained half-note bass
                add_buf(bass_bus, synth_bass_note(bass_m, BEAT * 1.9, amp=bass_amp * 0.85), bar_t)
                add_buf(bass_bus, synth_bass_note(bass_m + 12, BEAT * 1.9, amp=bass_amp * 0.65), bar_t + 2.0 * BEAT)
            else:
                # Energetic 8th-note octave bounce
                pattern = [
                    (0.0, 0, 0.95), (0.5, 12, 0.72), (1.0, 0, 0.85), (1.5, 12, 0.78),
                    (2.0, 0, 0.95), (2.5, 12, 0.72), (3.0, 0, 0.85), (3.5, 12, 0.82),
                ]
                for b_off, oct_add, vel in pattern:
                    add_buf(bass_bus, synth_bass_note(bass_m + oct_add, BEAT * 0.44, amp=bass_amp * vel), bar_t + b_off * BEAT)

        # 4) Drums (4-on-the-floor SEKAI synth-pop groove)
        if mood == "intro":
            # Building pulse: kicks + hi-hats, rising snare fill on last beat of intro bar
            for b in range(4):
                add_buf(drums_bus, kick, bar_t + b * BEAT, gain=0.68)
                add_buf(drums_bus, hat_c, bar_t + (b + 0.5) * BEAT, gain=0.75)
            if bar_idx >= 2:
                # 16th snare build-up
                for k in range(4):
                    add_buf(drums_bus, snare, bar_t + (3.0 + k * 0.25) * BEAT, gain=0.35 + 0.15 * k)
        elif mood == "bridge":
            # Lighter half-time shimmer so AI/i18n feels airy & fresh
            add_buf(drums_bus, kick, bar_t + 0.0 * BEAT, gain=0.72)
            add_buf(drums_bus, kick, bar_t + 2.5 * BEAT, gain=0.60)
            add_buf(drums_bus, snare, bar_t + 2.0 * BEAT, gain=0.65)
            for s in range(8):
                add_buf(drums_bus, hat_c, bar_t + s * 0.5 * BEAT, gain=0.55 if s % 2 == 0 else 0.85)
        else:
            # Full energetic pop groove
            kick_gain = 0.95 if mood in ("reveal", "climax") else 0.82
            for b in range(4):
                add_buf(drums_bus, kick, bar_t + b * BEAT, gain=kick_gain)
            add_buf(drums_bus, snare, bar_t + 1.0 * BEAT, gain=0.82)
            add_buf(drums_bus, snare, bar_t + 3.0 * BEAT, gain=0.86)
            for s in range(16):
                if s in (2, 6, 10, 14):
                    add_buf(drums_bus, hat_o if (s == 14 and mood == "climax") else hat_c, bar_t + s * SIXTEENTH, gain=0.92)
                elif s % 2 == 1:
                    add_buf(drums_bus, hat_c, bar_t + s * SIXTEENTH, gain=0.45)
            # Fill every 8th bar
            if prog_idx == 7:
                add_buf(drums_bus, snare, bar_t + 3.5 * BEAT, gain=0.72)
                add_buf(drums_bus, snare, bar_t + 3.75 * BEAT, gain=0.85)

        # 5) Lead Synth Melody (grouped every 8 bars)
        if prog_idx == 0:
            motif = LEAD_MOTIF_BRIGHT if mood in ("reveal", "climax") else LEAD_MOTIF_GENTLE
            lead_amp = {"intro": 0.0, "reveal": 0.145, "groove": 0.085, "bridge": 0.095, "climax": 0.165}.get(mood, 0.09)
            if lead_amp > 0:
                for b_start, b_dur, m_note in motif:
                    t_note = bar_t + b_start * BEAT
                    if t_note + 0.2 < total_duration - 1.2:
                        note_w = synth_lead_note(midi_to_hz(m_note), b_dur * BEAT * 0.94, amp=lead_amp, pan=0.08)
                        add_buf(lead_bus, note_w, t_note)

    # Final sparkling resolution chord on last ~1.4s
    end_chord_t = max(0.0, total_duration - 1.65)
    for i, m in enumerate([62, 66, 69, 73, 74, 78, 86]):
        add_buf(bell_bus, synth_fm_bell(midi_to_hz(m), 1.55, amp=0.11, brightness=2.0, pan=(i - 3) * 0.26), end_chord_t + i * 0.032)

    # Subtle rhythmic sidechain pumping on pads & bass (classic SEKAI synth-pop bounce!)
    t_arr = np.arange(n_samples) / SR
    beat_phase = (t_arr % BEAT) / BEAT
    sidechain = 1.0 - 0.34 * np.exp(-beat_phase * 7.5)
    pad_bus *= sidechain[:, None]
    bass_bus *= (0.78 + 0.22 * sidechain)[:, None]

    # Add lush stereo hall reverb to bells, pads, lead, and subtle room to drums
    pad_wet = apply_stereo_reverb(pad_bus, ir, wet=0.28)
    bell_wet = apply_stereo_reverb(bell_bus, ir, wet=0.35)
    lead_wet = apply_stereo_reverb(lead_bus, ir, wet=0.25)
    drums_wet = apply_stereo_reverb(drums_bus, ir, wet=0.09)

    mix = drums_wet * 0.88 + bass_bus * 0.92 + pad_wet * 0.88 + bell_wet * 0.95 + lead_wet * 0.85

    # Clean fade-in (150ms) and fade-out (1.3s)
    fi = min(int(0.15 * SR), n_samples)
    fo = min(int(1.30 * SR), n_samples)
    mix[:fi] *= np.linspace(0.0, 1.0, fi)[:, None]
    mix[-fo:] *= np.linspace(1.0, 0.0, fo)[:, None]
    return mix


def compose_sfx(total_duration: float, sfx_cues: list[dict[str, Any]], ir: np.ndarray) -> np.ndarray:
    n_samples = int(math.ceil(total_duration * SR))
    buf = np.zeros((n_samples, 2), dtype=np.float64)

    cache: dict[str, np.ndarray] = {
        "prism_whoosh": sfx_prism_whoosh(),
        "drop_impact": sfx_drop_impact(),
        "star_chime": sfx_star_chime(),
        "triad_combo": sfx_triad_combo(),
        "ui_pop": sfx_ui_pop(1.0),
        "ui_pop_hi": sfx_ui_pop(1.25),
    }

    for i, cue in enumerate(sfx_cues):
        kind = cue["kind"]
        t = float(cue["time"])
        gain = float(cue.get("gain", 0.72))
        if kind == "type_burst":
            count = int(cue.get("count", 12))
            step = float(cue.get("step", 0.065))
            for k in range(count):
                add_buf(buf, sfx_type_tick(i * 31 + k), t + k * step, gain=gain * 0.85)
        elif kind in cache:
            add_buf(buf, cache[kind], t, gain=gain)
        else:
            add_buf(buf, cache["ui_pop"], t, gain=gain)

    return apply_stereo_reverb(buf, ir, wet=0.16)


def load_wav_48k_stereo(path: Path) -> np.ndarray:
    """Decode any WAV/MP3/OGG audio file to 48kHz stereo float64 via FFmpeg for rock-solid format safety."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(path),
        "-ac", "2", "-ar", str(SR), "-f", "f32le", "pipe:1"
    ]
    proc = subprocess.run(cmd, capture_output=True, check=True)
    data = np.frombuffer(proc.stdout, dtype=np.float32).astype(np.float64)
    if data.size == 0:
        return np.zeros((0, 2), dtype=np.float64)
    return data.reshape(-1, 2)


def process_voice_clip(clip: np.ndarray) -> np.ndarray:
    """Clean vocal polish for Minori TTS: 95Hz HPF, +2.2dB presence boost, gentle leveling."""
    if clip.shape[0] < 64:
        return clip
    # High-pass to remove sub-rumble
    sos_hp = signal.butter(2, 95.0, btype="high", fs=SR, output="sos")
    out = np.stack([signal.sosfilt(sos_hp, clip[:, 0]), signal.sosfilt(sos_hp, clip[:, 1])], axis=1)

    # Gentle presence clarity around 3.2 kHz (kept subtle to preserve authentic Drama 3 Minori warmth!)
    sos_pres = signal.butter(2, [2400.0, 5200.0], btype="band", fs=SR, output="sos")
    pres = np.stack([signal.sosfilt(sos_pres, out[:, 0]), signal.sosfilt(sos_pres, out[:, 1])], axis=1)
    out = out + 0.09 * pres

    # Normalize clip RMS gently to -15.5 dBFS so every line sits consistently in the mix
    rms = float(np.sqrt(np.mean(out ** 2))) + 1e-9
    target_rms = 10.0 ** (-15.2 / 20.0)
    gain = min(target_rms / rms, 3.5)
    out *= gain

    # Soft vocal limiter
    out = np.tanh(out * 1.15) / 1.15

    # Micro fades (15ms)
    fade = min(int(0.015 * SR), out.shape[0] // 4)
    if fade > 0:
        out[:fade] *= np.linspace(0.0, 1.0, fade)[:, None]
        out[-fade:] *= np.linspace(1.0, 0.0, fade)[:, None]
    return out


def build_ducking_envelope(voice_stem: np.ndarray, duck_db: float = -8.5) -> np.ndarray:
    """Smooth studio sidechain envelope (60ms attack, 300ms release) driven by voice activity."""
    mono = np.mean(np.abs(voice_stem), axis=1)
    # Downsample envelope detection to 100 Hz blocks for ultra-fast smooth filtering
    hop = SR // 100  # 480 samples = 10ms
    n_blocks = int(math.ceil(len(mono) / hop))
    padded = np.pad(mono, (0, n_blocks * hop - len(mono)))
    rms_blocks = np.sqrt(np.mean(padded.reshape(n_blocks, hop) ** 2, axis=1))

    # Threshold voice presence
    active = np.clip((rms_blocks - 0.012) / 0.045, 0.0, 1.0)
    env_blocks = np.zeros_like(active)
    cur = 0.0
    att_coeff = 1.0 - math.exp(-0.010 / 0.055)   # 55ms attack
    rel_coeff = 1.0 - math.exp(-0.010 / 0.300)   # 300ms smooth release
    for i, a in enumerate(active):
        if a > cur:
            cur += (a - cur) * att_coeff
        else:
            cur += (a - cur) * rel_coeff
        env_blocks[i] = cur

    # Upsample smoothly back to SR
    x_blk = np.arange(n_blocks) * hop
    x_full = np.arange(len(mono))
    env_full = np.interp(x_full, x_blk, env_blocks)
    duck_lin = 10.0 ** (duck_db / 20.0)
    return 1.0 - env_full * (1.0 - duck_lin)


def master_and_normalize(stereo: np.ndarray, target_lufs: float = -14.0) -> np.ndarray:
    """Approximate K-weighted loudness normalization to -14 LUFS with -1.0 dBTP true-peak soft limiter."""
    # K-weighting stage 1 (high shelf approx) + stage 2 (HPF 60Hz)
    sos_k = signal.butter(2, 65.0, btype="high", fs=SR, output="sos")
    kw_l = signal.sosfilt(sos_k, stereo[:, 0])
    kw_r = signal.sosfilt(sos_k, stereo[:, 1])
    ms = float(np.mean(kw_l ** 2 + kw_r ** 2)) + 1e-12
    est_lufs = -0.691 + 10.0 * math.log10(ms)
    gain_db = np.clip(target_lufs - est_lufs, -12.0, 12.0)
    out = stereo * (10.0 ** (gain_db / 20.0))

    # Clean true-peak soft limiter ceiling at -1.0 dBFS (~0.891)
    ceiling = 10.0 ** (-1.0 / 20.0)
    peak = float(np.max(np.abs(out))) + 1e-12
    if peak > ceiling:
        # Smooth knee compression above 0.78
        thresh = 0.78
        abs_x = np.abs(out)
        over = np.maximum(abs_x - thresh, 0.0)
        headroom = ceiling - thresh
        shaped = thresh + headroom * np.tanh(over / headroom)
        out = np.sign(out) * np.where(abs_x > thresh, shaped, abs_x)
    return np.clip(out, -0.99, 0.99)


def write_wav_16bit(path: Path, stereo: np.ndarray, sr: int = SR) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(np.round(stereo * 32767.0), -32768, 32767).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())


def build_default_timeline(duration: float = 75.0) -> dict[str, Any]:
    scenes = [
        {"id": "s01_hook", "start": 0.0, "end": 6.5, "bgm_mood": "intro"},
        {"id": "s02_reveal", "start": 6.5, "end": 14.5, "bgm_mood": "reveal"},
        {"id": "s03_live2d", "start": 14.5, "end": 25.5, "bgm_mood": "groove"},
        {"id": "s04_flow_msk", "start": 25.5, "end": 36.5, "bgm_mood": "groove"},
        {"id": "s05_agent", "start": 36.5, "end": 47.0, "bgm_mood": "bridge"},
        {"id": "s06_i18n_voice", "start": 47.0, "end": 56.5, "bgm_mood": "bridge"},
        {"id": "s07_ecosystem", "start": 56.5, "end": 65.5, "bgm_mood": "groove"},
        {"id": "s08_cta", "start": 65.5, "end": duration, "bgm_mood": "climax"},
    ]
    sfx = [
        {"time": 0.25, "kind": "ui_pop", "gain": 0.70},
        {"time": 6.20, "kind": "prism_whoosh", "gain": 0.85},
        {"time": 6.50, "kind": "drop_impact", "gain": 0.88},
        {"time": 14.20, "kind": "prism_whoosh", "gain": 0.72},
        {"time": 25.20, "kind": "prism_whoosh", "gain": 0.72},
        {"time": 28.00, "kind": "type_burst", "count": 16, "step": 0.075, "gain": 0.55},
        {"time": 36.20, "kind": "prism_whoosh", "gain": 0.75},
        {"time": 37.00, "kind": "star_chime", "gain": 0.65},
        {"time": 46.70, "kind": "prism_whoosh", "gain": 0.72},
        {"time": 56.20, "kind": "prism_whoosh", "gain": 0.72},
        {"time": 65.20, "kind": "prism_whoosh", "gain": 0.88},
        {"time": 65.50, "kind": "drop_impact", "gain": 0.90},
        {"time": duration - 4.0, "kind": "triad_combo", "gain": 0.85},
    ]
    return {"duration": duration, "scenes": scenes, "sfx": sfx, "voice_clips": []}


def main() -> None:
    parser = argparse.ArgumentParser(description="Compose SEKAI BGM, SFX, and voice-ducked master WAV.")
    parser.add_argument("--timeline", type=Path, help="Path to timeline.json")
    parser.add_argument("--out", type=Path, required=True, help="Output mastered WAV path")
    parser.add_argument("--bgm-out", type=Path, help="Optional standalone BGM WAV output")
    args = parser.parse_args()

    if args.timeline and args.timeline.exists():
        tl = json.loads(args.timeline.read_text(encoding="utf-8"))
    else:
        tl = build_default_timeline()

    duration = float(tl["duration"])
    scenes = tl.get("scenes", [])
    sfx_cues = tl.get("sfx", [])
    voice_clips = tl.get("voice_clips", [])

    print(f"[audio] Composing {duration:.2f}s 128 BPM SEKAI synth-pop BGM + {len(sfx_cues)} SFX cues...")
    ir = make_reverb_ir()
    bgm = compose_bgm(duration, scenes, ir)
    sfx = compose_sfx(duration, sfx_cues, ir)

    if args.bgm_out:
        write_wav_16bit(args.bgm_out, master_and_normalize(bgm, target_lufs=-15.0))

    n_samples = bgm.shape[0]
    voice_stem = np.zeros((n_samples, 2), dtype=np.float64)
    loaded_voices = 0

    for vc in voice_clips:
        wav_path = Path(vc["path"])
        if not wav_path.exists():
            print(f"[audio] WARN: missing voice clip {wav_path}")
            continue
        clip = load_wav_48k_stereo(wav_path)
        if clip.shape[0] == 0:
            continue
        clip = process_voice_clip(clip)
        add_buf(voice_stem, clip, float(vc["start"]), gain=1.0)
        loaded_voices += 1

    if loaded_voices > 0:
        print(f"[audio] Mixing {loaded_voices} voiceover clips with smooth -9.5 dB BGM ducking...")
        duck_env = build_ducking_envelope(voice_stem, duck_db=-9.5)
        # Also carve subtle 1.4-4.2kHz midrange pocket on BGM during speech for crisp vocal clarity
        sos_mid = signal.butter(2, [1400.0, 4200.0], btype="band", fs=SR, output="sos")
        bgm_mid = np.stack([signal.sosfilt(sos_mid, bgm[:, 0]), signal.sosfilt(sos_mid, bgm[:, 1])], axis=1)
        speech_amt = 1.0 - duck_env
        bgm_carved = bgm - bgm_mid * (speech_amt[:, None] * 0.44)
        bgm_ducked = bgm_carved * duck_env[:, None]
        master_raw = voice_stem * 1.24 + bgm_ducked * 0.74 + sfx * 0.64
    else:
        print("[audio] No voice clips active -> mastering full-energy BGM + SFX preview mix...")
        master_raw = bgm * 0.94 + sfx * 0.85

    master = master_and_normalize(master_raw, target_lufs=-14.0)
    write_wav_16bit(args.out, master)
    peak_db = 20.0 * math.log10(float(np.max(np.abs(master))) + 1e-12)
    rms_db = 20.0 * math.log10(float(np.sqrt(np.mean(master ** 2))) + 1e-12)
    print(f"[audio] Wrote {args.out} ({duration:.2f}s, 48kHz stereo) | Peak: {peak_db:.2f} dBFS | RMS: {rms_db:.2f} dBFS")


if __name__ == "__main__":
    main()
