#!/usr/bin/env python3
"""gen_audio.py - procedural SFX and music for Beast of Thornmoor.

Everything is synthesised with NumPy (no samples, no third-party DSP) and
encoded to OGG Vorbis through the `ffmpeg` binary.  Output goes to
assets/audio/.  The script is deterministic: every sound has its own seeded RNG.

    python3 tools/gen_audio.py            # build everything
    python3 tools/gen_audio.py sfx_coin   # build only names containing "coin"
"""
import math
import os
import subprocess
import sys
import zlib

import numpy as np

SR = 44100
TAU = 2.0 * math.pi
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "audio")

# --------------------------------------------------------------------------
# Basic helpers
# --------------------------------------------------------------------------

def rng_for(name):
    return np.random.default_rng(zlib.crc32(name.encode()) + 1234)

def secs(s):
    return int(round(s * SR))

def tline(n):
    return np.arange(n) / SR

def db(x):
    return 10.0 ** (x / 20.0)

def peak_db(x):
    p = float(np.max(np.abs(x))) if x.size else 0.0
    return 20.0 * math.log10(p) if p > 0 else -120.0

def normalize(x, target_db=-1.0):
    p = float(np.max(np.abs(x)))
    return x * (db(target_db) / p) if p > 0 else x

def mix(*parts):
    """Sum mono arrays of different lengths (zero padded)."""
    n = max(len(p) for p in parts)
    y = np.zeros(n)
    for p in parts:
        y[: len(p)] += p
    return y

def delay(x, s, n=None):
    """Shift x right by s seconds; optional total length."""
    d = secs(s)
    n = n or len(x) + d
    y = np.zeros(n)
    k = min(len(x), n - d)
    if k > 0:
        y[d : d + k] = x[:k]
    return y

# --------------------------------------------------------------------------
# Oscillators and envelopes
# --------------------------------------------------------------------------

def phasor(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, float), (n,))
    return (np.cumsum(f) / SR + phase) % 1.0, f / SR

def sine(freq, n, phase=0.0):
    p, _ = phasor(freq, n, phase)
    return np.sin(TAU * p)

def saw(freq, n, phase=0.0):
    """PolyBLEP band-limited sawtooth; freq may be a per-sample array."""
    p, dt = phasor(freq, n, phase)
    y = 2.0 * p - 1.0
    m = p < dt
    t = p[m] / dt[m]
    y[m] -= t + t - t * t - 1.0
    m = p > 1.0 - dt
    t = (p[m] - 1.0) / dt[m]
    y[m] -= t * t + t + t + 1.0
    return y

def square(freq, n, phase=0.0):
    return saw(freq, n, phase) - saw(freq, n, phase + 0.5)

def triangle(freq, n, phase=0.0):
    p, _ = phasor(freq, n, phase)
    return 1.0 - 4.0 * np.abs(p - 0.5)

def noise(n, rng):
    return rng.uniform(-1.0, 1.0, n)

def slow_noise(n, hz, rng, circular=False):
    """Smooth random control signal in roughly [-1, 1]."""
    y = fft_filter(noise(n, rng), "lp", hz, 0.7, order=2, circular=circular)
    p = np.max(np.abs(y))
    return y / p if p > 0 else y

def glide(f0, f1, n):
    """Exponential frequency glide."""
    return f0 * (f1 / f0) ** np.linspace(0.0, 1.0, n)

def env_exp(n, tau, start=0.0):
    t = tline(n) - start
    return np.where(t < 0, 0.0, np.exp(-np.maximum(t, 0) / tau))

def env_ad(n, a, d):
    t = tline(n)
    return np.minimum(t / max(a, 1e-4), 1.0) * np.exp(-np.maximum(t - a, 0) / d)

def adsr(n, a, d, s, r, gate):
    t = tline(n)
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    g = min(secs(gate), n - 1)
    rel = e[g] * np.exp(-(t - t[g]) / max(r, 1e-4))
    return np.where(np.arange(n) >= g, rel, e)

def fade(x, fin=0.0, fout=0.0):
    y = x.copy()
    a, b = secs(fin), secs(fout)
    shape = (-1,) + (1,) * (x.ndim - 1)
    if a:
        y[:a] *= (np.linspace(0, 1, a) ** 0.5).reshape(shape)
    if b:
        y[-b:] *= (np.linspace(1, 0, b) ** 0.5).reshape(shape)
    return y

# --------------------------------------------------------------------------
# Filters, reverb, echo
# --------------------------------------------------------------------------

def biquad_coeffs(kind, fc, q):
    w = TAU * min(max(fc, 5.0), SR * 0.49) / SR
    cw, sw = math.cos(w), math.sin(w)
    al = sw / (2.0 * q)
    if kind == "lp":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
    elif kind == "hp":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
    elif kind == "bp":
        b = [al, 0.0, -al]
    elif kind == "notch":
        b = [1.0, -2 * cw, 1.0]
    else:
        raise ValueError(kind)
    a = [1 + al, -2 * cw, 1 - al]
    return np.array(b) / a[0], np.array(a) / a[0]

def fft_filter(x, kind, fc, q=0.707, order=1, circular=False):
    """Static biquad applied in the frequency domain (exact IIR response).
    circular=True makes the filter wrap, which is what loops want."""
    n = len(x)
    m = n if circular else n + SR // 2
    b, a = biquad_coeffs(kind, fc, q)
    z = np.exp(-1j * TAU * np.fft.rfftfreq(m))
    h = (b[0] + b[1] * z + b[2] * z * z) / (a[0] + a[1] * z + a[2] * z * z)
    return np.fft.irfft(np.fft.rfft(x, m) * h ** order, m)[:n]

def svf(x, fc, q=0.7, mode="lp"):
    """Time-varying state-variable filter (Zavalishin TPT form).  Pure Python
    loop, so only use it for short sounds with a sweeping cutoff."""
    fc = np.broadcast_to(np.asarray(fc, float), x.shape)
    g = np.tan(np.pi * np.clip(fc, 10.0, SR * 0.45) / SR).tolist()
    k = 1.0 / q
    xs = x.tolist()
    out = [0.0] * len(xs)
    ic1 = ic2 = 0.0
    for i, xi in enumerate(xs):
        gi = g[i]
        a1 = 1.0 / (1.0 + gi * (gi + k))
        a2 = gi * a1
        v3 = xi - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + gi * a2 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        out[i] = v2 if mode == "lp" else (v1 if mode == "bp" else xi - k * v1 - v2)
    return np.array(out)

def convolve(x, ir, circular):
    n = len(x)
    m = n if circular else n + len(ir)
    return np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)[:n]

def reverb(x, rt60=1.5, wet=0.3, damp=3500.0, predelay=0.015, circular=False, rng=None):
    """Cheap diffuse reverb: convolution with decaying filtered noise.  Stereo
    input gets a decorrelated IR per channel."""
    rng = rng or np.random.default_rng(99)
    ir_n = secs(min(rt60 * 1.6, 8.0))
    t = tline(ir_n)
    env = np.exp(-6.91 * t / rt60) * np.minimum(t / 0.01, 1.0)
    chans = x.shape[1] if x.ndim == 2 else 1

    def one_ir():
        ir = noise(ir_n, rng) * env
        ir = fft_filter(ir, "lp", damp, 0.7)
        ir = fft_filter(ir, "hp", 120.0, 0.7)
        ir = np.concatenate([np.zeros(secs(predelay)), ir])
        return ir / (np.sqrt(np.sum(ir * ir)) + 1e-9) * 0.9

    if chans == 1:
        return x * (1 - wet) + wet * convolve(x, one_ir(), circular)
    y = np.empty_like(x)
    for c in range(chans):
        y[:, c] = x[:, c] * (1 - wet) + wet * convolve(x[:, c], one_ir(), circular)
    return y

def echo(x, time=0.3, feedback=0.4, taps=6, damp=2500.0, circular=False):
    ir = np.zeros(secs(time) * taps + 1)
    for k in range(1, taps + 1):
        ir[secs(time) * k] = feedback ** k
    ir = fft_filter(ir, "lp", damp)
    return x + convolve(x, ir, circular)

def softclip(x, drive=1.4):
    return np.tanh(x * drive) / math.tanh(drive)

def stereo(x, pan=0.0):
    if x.ndim == 2:
        return x
    th = (pan + 1) * 0.25 * math.pi
    return np.stack([x * math.cos(th), x * math.sin(th)], axis=1)

def widen(x, ms=12.0, amount=0.5):
    """Haas-style widening of a mono signal."""
    d = secs(ms / 1000.0)
    y = stereo(x)
    y[d:, 1] += amount * x[:-d]
    y[:, 0] += amount * x
    return y * 0.7

# --------------------------------------------------------------------------
# Layered sound-design building blocks
# --------------------------------------------------------------------------

def whoosh(n, f0, f1, f2, rng, q=1.6, attack=0.03, decay=0.09, mode="bp"):
    """Filtered-noise sweep: cutoff goes f0 -> f1 (first 40%) -> f2."""
    k = int(n * 0.4)
    fc = np.concatenate([glide(f0, f1, k), glide(f1, f2, n - k)])
    return svf(noise(n, rng), fc, q, mode) * env_ad(n, attack, decay)

def thump(n, f0, f1, tau, click=0.3, rng=None):
    y = sine(glide(f0, f1, n), n) * env_exp(n, tau)
    if click and rng is not None:
        y += click * fft_filter(noise(n, rng), "lp", 900, 0.7) * env_exp(n, 0.012)
    return y

def metal(n, base, ratios, decays, rng, detune=0.012, click=0.4):
    """Inharmonic partial stack (struck metal) with a short noise click."""
    t = tline(n)
    y = np.zeros(n)
    for i, (r, d) in enumerate(zip(ratios, decays)):
        f = base * r * (1 + rng.uniform(-detune, detune))
        y += np.exp(-t / d) * np.sin(TAU * f * t + rng.uniform(0, TAU)) / (1 + 0.35 * i)
    y /= math.sqrt(len(ratios))
    y += click * fft_filter(noise(n, rng), "hp", 2500, 0.7) * env_exp(n, 0.006)
    return y

def growl(n, f0, f1, formants, rng, drive=3.0, jitter=0.04, rough=28.0, breath=0.2, sub=0.0):
    """Voice-like growl: jittered saw pulse through formant band-passes."""
    t = tline(n)
    f = glide(f0, f1, n) * (1 + jitter * slow_noise(n, 25.0, rng))
    src = saw(f, n) * (1 - 0.45 * (0.5 + 0.5 * np.sin(TAU * rough * t)))
    src += breath * noise(n, rng)
    y = sum(g * fft_filter(src, "bp", fc, 5.0) for fc, g in formants)
    y = np.tanh(drive * y) + sub * sine(f * 0.5, n)
    return y

def bell(n, f, ratios, decays, rng, bright=1.0):
    t = tline(n)
    y = np.zeros(n)
    for i, (r, d) in enumerate(zip(ratios, decays)):
        amp = bright ** i / (1 + 0.5 * i)
        y += amp * np.exp(-t / d) * np.sin(TAU * f * r * t + rng.uniform(0, TAU))
    return y / math.sqrt(len(ratios))

def chime(n, f, tau, rng, mod=1.0):
    """FM glockenspiel-ish ping."""
    t = tline(n)
    idx = mod * np.exp(-t / (tau * 0.4))
    return np.exp(-t / tau) * np.sin(TAU * f * t + idx * np.sin(TAU * f * 3.5 * t + rng.uniform(0, TAU)))

# --------------------------------------------------------------------------
# SFX definitions
# --------------------------------------------------------------------------

SFX = {}

def sfx(name, peak=-1.0, rev=None):
    def deco(fn):
        SFX[name] = (fn, peak, rev)
        return fn
    return deco

def swing(name, f0, f1, f2, dur=0.25):
    @sfx(name)
    def _(rng):
        n = secs(dur)
        y = whoosh(n, f0, f1, f2, rng, q=1.4)
        y += 0.5 * whoosh(n, f0 * 2.2, f1 * 2.0, f2 * 1.8, rng, q=2.5, attack=0.02, decay=0.06)
        return y

swing("sfx_swing1", 350, 2600, 900)
swing("sfx_swing2", 500, 3400, 700)
swing("sfx_swing3", 280, 1900, 1400)

@sfx("sfx_heavy_swing")
def _(rng):
    n = secs(0.4)
    y = whoosh(n, 140, 900, 300, rng, q=1.3, attack=0.06, decay=0.13)
    g = growl(n, 75, 48, [(220, 1.0), (600, 0.6), (1300, 0.3)], rng, drive=2.5, sub=0.3)
    return y + 0.5 * g * env_ad(n, 0.05, 0.12)

def hit_flesh(name, f0, f1):
    @sfx(name)
    def _(rng):
        n = secs(0.25)
        y = 1.2 * thump(n, f0, f1, 0.07, click=0.6, rng=rng)
        wet = fft_filter(noise(n, rng), "bp", 2800, 1.2) * (slow_noise(n, 180, rng) ** 2) * env_exp(n, 0.04)
        crunch = fft_filter(noise(n, rng), "lp", 1400, 0.7) * env_exp(n, 0.025)
        return y + 0.9 * wet + 0.6 * crunch

hit_flesh("sfx_hit_flesh1", 130, 42)
hit_flesh("sfx_hit_flesh2", 160, 55)

def hit_metal(name, base):
    @sfx(name, rev=dict(rt60=0.5, wet=0.15))
    def _(rng):
        n = secs(0.4)
        y = metal(n, base, [1, 1.47, 2.09, 2.56, 3.18, 4.1], [0.18, 0.14, 0.12, 0.09, 0.07, 0.05], rng)
        y += 0.5 * thump(n, 160, 60, 0.03, click=0.4, rng=rng)
        return y

hit_metal("sfx_hit_metal1", 880)
hit_metal("sfx_hit_metal2", 1060)

@sfx("sfx_block", rev=dict(rt60=0.4, wet=0.12))
def _(rng):
    n = secs(0.3)
    y = metal(n, 520, [1, 1.35, 1.92, 2.7, 3.6], [0.12, 0.1, 0.08, 0.05, 0.04], rng)
    return y + 0.8 * thump(n, 200, 70, 0.04, click=0.5, rng=rng)

@sfx("sfx_player_hurt")
def _(rng):
    n = secs(0.35)
    y = growl(n, 150, 95, [(480, 1.0), (1100, 0.7), (2400, 0.35)], rng, drive=3.0, sub=0.15)
    return y * env_ad(n, 0.012, 0.09)

@sfx("sfx_player_death", rev=dict(rt60=1.2, wet=0.3))
def _(rng):
    n = secs(1.2)
    y = growl(n, 125, 58, [(400, 1.0), (900, 0.8), (2200, 0.4)], rng, drive=3.5, jitter=0.07, rough=22, sub=0.25)
    return y * env_ad(n, 0.03, 0.45) * (1 - 0.3 * (0.5 + 0.5 * np.sin(TAU * 6 * tline(n))))

@sfx("sfx_enemy_hurt")
def _(rng):
    n = secs(0.3)
    y = growl(n, 190, 125, [(450, 1.0), (1000, 0.7), (2500, 0.4)], rng, drive=1.6, jitter=0.03, rough=0, breath=0.35)
    return y * env_ad(n, 0.015, 0.08)

@sfx("sfx_enemy_death", rev=dict(rt60=0.6, wet=0.2))
def _(rng):
    n = secs(0.8)
    body = delay(1.3 * thump(secs(0.3), 90, 38, 0.1, click=0.5, rng=rng), 0.02, n)
    y = body
    for i in range(7):
        at = 0.08 + i * 0.08 + rng.uniform(0, 0.03)
        m = secs(0.22)
        clank = metal(m, rng.uniform(600, 1400), [1, 1.5, 2.3, 3.1], [0.07, 0.05, 0.04, 0.03], rng, click=0.3)
        y = y + delay(clank * (0.9 - 0.1 * i), at, n)
    return y

@sfx("sfx_skeleton_rattle")
def _(rng):
    n = secs(0.5)
    y = np.zeros(n)
    t0 = 0.0
    while t0 < 0.46:
        m = secs(0.05)
        f = rng.uniform(1200, 3200)
        c = fft_filter(noise(m, rng), "bp", f, 3.0) * env_exp(m, 0.006)
        c += 0.5 * sine(rng.uniform(500, 900), m) * env_exp(m, 0.008)
        y += delay(c * rng.uniform(0.5, 1.0), t0, n)
        t0 += rng.uniform(0.018, 0.055)
    return y + 0.35 * fft_filter(y, "bp", 260, 4.0)

@sfx("sfx_bat")
def _(rng):
    n = secs(0.4)
    t = tline(n)
    f = glide(4200, 2600, n) * (1 + 0.12 * np.sin(TAU * 34 * t)) * (1 + 0.03 * slow_noise(n, 60, rng))
    scr = np.sin(TAU * np.cumsum(f) / SR + 2.0 * np.sin(TAU * f * 1.5 * t))
    scr *= (0.55 + 0.45 * np.sin(TAU * 13 * t)) * env_ad(n, 0.02, 0.12)
    flap = fft_filter(noise(n, rng), "lp", 500, 0.8) * (0.5 + 0.5 * np.sin(TAU * 16 * t)) ** 3 * env_ad(n, 0.01, 0.2)
    return scr + 1.5 * flap

@sfx("sfx_jump")
def _(rng):
    n = secs(0.2)
    g = growl(secs(0.09), 170, 130, [(500, 1.0), (1200, 0.5)], rng, drive=1.5, breath=0.3) * env_ad(secs(0.09), 0.01, 0.03)
    return mix(0.6 * g, whoosh(n, 400, 1800, 1200, rng, q=1.5, attack=0.04, decay=0.07))

@sfx("sfx_land")
def _(rng):
    n = secs(0.15)
    y = thump(n, 95, 40, 0.05, click=0.0)
    return y + 0.7 * fft_filter(noise(n, rng), "lp", 650, 0.7) * env_exp(n, 0.03)

@sfx("sfx_dodge")
def _(rng):
    n = secs(0.25)
    return whoosh(n, 900, 350, 1500, rng, q=1.2, attack=0.02, decay=0.1) + 0.4 * whoosh(n, 200, 600, 250, rng, q=1.5, attack=0.05, decay=0.08)

def footstep(name, fc):
    @sfx(name, peak=-12.0)
    def _(rng):
        n = secs(0.12)
        y = fft_filter(noise(n, rng), "lp", fc, 0.8) * env_ad(n, 0.004, 0.028)
        y += 0.3 * fft_filter(noise(n, rng), "bp", 3000, 2.0) * env_exp(n, 0.008)
        return y + 0.8 * thump(n, 75, 45, 0.03, click=0.0)

footstep("sfx_footstep1", 800)
footstep("sfx_footstep2", 1000)

@sfx("sfx_coin")
def _(rng):
    n = secs(0.4)
    a = chime(n, 2093, 0.12, rng, 0.6) + 0.5 * chime(n, 2093 * 1.005, 0.12, rng, 0.6)
    b = chime(secs(0.33), 2637, 0.14, rng, 0.6)
    return a + delay(b, 0.07, n) + 0.3 * fft_filter(noise(n, rng), "hp", 4000) * env_exp(n, 0.004)

@sfx("sfx_gem", rev=dict(rt60=0.9, wet=0.3, damp=9000))
def _(rng):
    n = secs(0.6)
    y = np.zeros(n)
    for i, f in enumerate([1046.5, 1318.5, 1568.0, 2093.0, 2637.0]):
        y += delay(chime(secs(0.4), f, 0.18, rng, 1.2) * (0.9 - 0.1 * i), i * 0.045, n)
    shimmer = fft_filter(noise(n, rng), "bp", 7000, 3.0) * (0.5 + 0.5 * np.sin(TAU * 40 * tline(n))) * env_ad(n, 0.05, 0.15)
    return y + 0.5 * shimmer

@sfx("sfx_potion")
def _(rng):
    n = secs(0.6)
    y = np.zeros(n)
    for i, at in enumerate([0.0, 0.11, 0.21]):
        m = secs(0.09)
        g = sine(glide(520 - 60 * i, 180, m), m) * env_ad(m, 0.004, 0.03)
        g = fft_filter(g, "lp", 1200, 1.5) + 0.3 * fft_filter(noise(m, rng), "lp", 700) * env_exp(m, 0.01)
        y += delay(g, at, n)
    for i, f in enumerate([1760, 2217, 2637, 3520]):
        y += 0.5 * delay(chime(secs(0.25), f, 0.09, rng, 0.8), 0.32 + 0.05 * i, n)
    return y

@sfx("sfx_levelup", rev=dict(rt60=1.4, wet=0.35, damp=7000))
def _(rng):
    n = secs(1.5)
    y = np.zeros(n)
    notes = [261.6, 329.6, 392.0, 523.3, 659.3, 784.0, 1046.5]
    for i, f in enumerate(notes):
        y += delay(0.8 * chime(secs(0.9), f, 0.35, rng, 1.0), i * 0.07, n)
        m = secs(1.2 - i * 0.07)
        pad = (saw(f, m) + saw(f * 1.004, m) + saw(f * 0.996, m)) / 3
        y += 0.12 * delay(fft_filter(pad, "lp", 1800, 0.8, order=2) * adsr(m, 0.1, 0.2, 0.8, 0.4, 0.7), i * 0.07, n)
    sh = svf(noise(n, rng), glide(1500, 9000, n), 2.5, "bp") * env_ad(n, 0.3, 0.4)
    return y + 0.35 * sh

@sfx("sfx_loot", rev=dict(rt60=0.6, wet=0.2))
def _(rng):
    n = secs(0.5)
    y = 1.1 * thump(n, 110, 48, 0.07, click=0.4, rng=rng)
    return y + 0.8 * delay(chime(secs(0.4), 1567.98, 0.16, rng, 1.0) + 0.5 * chime(secs(0.4), 2349.3, 0.12, rng, 0.8), 0.03, n)

@sfx("sfx_chest")
def _(rng):
    n = secs(0.7)
    m = secs(0.5)
    t = tline(m)
    f = 110 * (1 + 0.25 * slow_noise(m, 6, rng)) * (1 + 0.02 * slow_noise(m, 90, rng))
    stick = np.clip(slow_noise(m, 70, rng) * 2.5, 0, 1)  # stick-slip gating
    creak = saw(f, m) * stick
    creak = fft_filter(creak, "bp", 900, 2.0) + 0.5 * fft_filter(creak, "bp", 2200, 3.0)
    creak = np.tanh(2 * creak) * env_ad(m, 0.05, 0.25)
    k = secs(0.15)
    click = metal(k, 1700, [1, 1.6, 2.4], [0.03, 0.02, 0.015], rng, click=0.8) + 0.6 * thump(k, 240, 90, 0.02)
    return delay(normalize(creak, -2.0), 0, n) + delay(normalize(click, -1.0), 0.53, n)

@sfx("sfx_checkpoint", rev=dict(rt60=2.2, wet=0.45, damp=4000))
def _(rng):
    n = secs(2.0)
    y = bell(n, 146.8, [0.5, 1.0, 1.19, 1.5, 2.0, 2.51, 2.66, 3.01, 4.2], [1.4, 1.2, 0.9, 0.8, 0.7, 0.5, 0.45, 0.35, 0.2], rng, 0.85)
    strike = fft_filter(noise(n, rng), "bp", 2500, 1.5) * env_exp(n, 0.01)
    return y * np.minimum(tline(n) / 0.004, 1) + 0.4 * strike

@sfx("sfx_gate", rev=dict(rt60=1.0, wet=0.25))
def _(rng):
    n = secs(1.5)
    t = tline(n)
    f = 48 * (1 + 0.15 * slow_noise(n, 3, rng)) * (1 + 0.01 * slow_noise(n, 80, rng))
    groan = np.tanh(2.0 * fft_filter(saw(f, n) + 0.5 * square(f * 0.5, n), "lp", 400, 1.5))
    grind = fft_filter(noise(n, rng), "bp", 350, 1.2) * np.clip(slow_noise(n, 40, rng) * 1.5 + 0.4, 0, 1)
    sq = sine(1400 * (1 + 0.2 * slow_noise(n, 4, rng)), n) * np.clip(slow_noise(n, 9, rng) * 1.3, 0, 1) ** 2
    y = (groan + 0.8 * grind + 0.25 * sq) * adsr(n, 0.15, 0.3, 0.8, 0.25, 1.15)
    clank = metal(secs(0.35), 420, [1, 1.4, 2.1, 2.9], [0.2, 0.15, 0.1, 0.06], rng) + thump(secs(0.35), 120, 45, 0.08, click=0.5, rng=rng)
    return y + 1.2 * delay(clank, 1.18, n)

@sfx("sfx_ui_move", peak=-6.0)
def _(rng):
    n = secs(0.1)
    return fft_filter(noise(n, rng), "bp", 1800, 4.0) * env_exp(n, 0.012) + 0.6 * sine(1300, n) * env_exp(n, 0.02)

@sfx("sfx_ui_confirm", peak=-5.0)
def _(rng):
    n = secs(0.2)
    return chime(n, 880, 0.08, rng, 0.5) + delay(chime(secs(0.15), 1318.5, 0.09, rng, 0.5), 0.06, n)

@sfx("sfx_ui_back", peak=-6.0)
def _(rng):
    n = secs(0.18)
    return chime(n, 1046.5, 0.06, rng, 0.4) + delay(chime(secs(0.13), 698.5, 0.08, rng, 0.4), 0.05, n)

@sfx("sfx_boss_roar", rev=dict(rt60=1.8, wet=0.35, damp=2500))
def _(rng):
    n = secs(1.5)
    t = tline(n)
    y = growl(n, 62, 36, [(260, 1.0), (640, 0.9), (1500, 0.5), (3000, 0.2)], rng, drive=5.0, jitter=0.06, rough=19, breath=0.3, sub=0.5)
    y *= env_ad(n, 0.08, 0.6) * (1 - 0.25 * (0.5 + 0.5 * np.sin(TAU * 7 * t)))
    return y + 0.4 * fft_filter(noise(n, rng), "lp", 300, 0.8) * env_ad(n, 0.1, 0.5)

@sfx("sfx_thunder")
def _(rng):
    n = secs(2.5)
    t = tline(n)
    crack = fft_filter(noise(n, rng), "lp", 1800, 0.8) * env_exp(n, 0.06)
    cut = 90 + 220 * np.clip(slow_noise(n, 1.5, rng) + 0.6, 0, 1.5)
    rumble = svf(noise(n, rng), cut, 1.0, "lp") * np.clip(slow_noise(n, 2.5, rng) * 0.6 + 0.7, 0, 1.3)
    rumble *= env_ad(n, 0.2, 1.1)
    sub = sine(42 * (1 + 0.1 * slow_noise(n, 1, rng)), n) * env_ad(n, 0.3, 0.9)
    return 0.6 * crack + 4.0 * rumble + 0.5 * sub

@sfx("sfx_torch", peak=-12.0)
def _(rng):
    n = secs(2.0)
    roar = fft_filter(noise(n, rng), "lp", 420, 0.7, order=2, circular=True)
    roar *= 0.6 + 0.4 * slow_noise(n, 5, rng, circular=True)
    pops = noise(n, rng) * (rng.uniform(0, 1, n) > 0.9993) * rng.uniform(0.2, 1, n)
    pops = fft_filter(pops, "bp", 2800, 1.2, circular=True) * 4
    pops = convolve(pops, env_exp(secs(0.02), 0.004), circular=True)
    hiss = fft_filter(noise(n, rng), "hp", 3500, 0.7, circular=True) * (0.5 + 0.5 * slow_noise(n, 12, rng, circular=True))
    return 6 * roar + 0.5 * pops + 0.15 * hiss

# --------------------------------------------------------------------------
# Music engine: notes, instruments, sequencer
# --------------------------------------------------------------------------

NOTE_IDX = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
QUAL = {"M": [0, 4, 7], "m": [0, 3, 7], "m7": [0, 3, 7, 10], "M7": [0, 4, 7, 11],
        "madd9": [0, 3, 7, 14], "sus2": [0, 2, 7], "dim": [0, 3, 6], "Madd9": [0, 4, 7, 14]}

def midi(name):
    if isinstance(name, (int, float)):
        return int(name)
    m = NOTE_IDX[name[0]] + (1 if "#" in name else 0) - (1 if "b" in name[1:] else 0)
    return 12 * (int(name[-1]) + 1) + m

def freq(m):
    return 440.0 * 2 ** ((m - 69) / 12)

def chord(root, quality, octaves=1):
    base = midi(root)
    return [base + i + 12 * o for o in range(octaves) for i in QUAL[quality]]

def inst_pluck(f, dur, rng, bright=0.9, release=0.35, decay=3.0):
    """Additive pluck: harmonic k decays faster the higher it is."""
    n = secs(dur + release)
    t = tline(n)
    y = np.zeros(n)
    for k in range(1, 26):
        fk = f * k
        if fk > 15000:
            break
        y += (bright ** (k - 1) / k) * np.exp(-t * (decay + 1.3 * k)) * np.sin(TAU * fk * t + rng.uniform(0, TAU))
    y *= np.minimum(t / 0.002, 1.0) * np.where(t < dur, 1.0, np.exp(-(t - dur) / (release * 0.3)))
    return y * 0.8

def inst_pad(f, dur, rng, cutoff=1300, detune=8, attack=0.9, release=1.6, q=0.8):
    n = secs(dur + release)
    y = sum(saw(f * 2 ** (c / 1200), n, rng.uniform(0, 1)) for c in (-detune, 0, detune, detune * 0.4)) / 4
    y = fft_filter(y, "lp", cutoff, q, order=2)
    return y * adsr(n, attack, 0.6, 0.85, release, dur)

def inst_drone(f, n, rng, lo=180, hi=700, lfo=0.07, circular=True):
    """Full-length low drone with a slowly breathing filter."""
    src = (saw(f, n) + saw(f * 1.003, n, 0.3) + 0.8 * sine(f * 0.5, n) + 0.4 * square(f * 0.5, n, 0.1)) / 3
    dark = fft_filter(src, "lp", lo, 1.0, order=2, circular=circular)
    bright = fft_filter(src, "lp", hi, 1.4, order=2, circular=circular)
    m = 0.5 + 0.5 * np.sin(TAU * lfo * tline(n) + rng.uniform(0, TAU))
    return dark + (bright - dark) * m

def inst_bass(f, dur, rng, cutoff=320, release=0.08):
    n = secs(dur + release)
    y = 0.6 * sine(f, n) + 0.5 * saw(f, n) + 0.25 * square(f, n)
    y = fft_filter(y, "lp", cutoff, 1.2, order=2)
    return y * adsr(n, 0.008, 0.25, 0.75, release, dur)

def inst_lead(f, dur, rng, cutoff=1900, release=0.9, vib=0.007):
    n = secs(dur + release)
    t = tline(n)
    fa = f * (1 + vib * np.sin(TAU * 5.3 * t) * np.clip((t - 0.25) / 0.5, 0, 1))
    y = 0.5 * saw(fa, n) + 0.4 * sine(fa, n) + 0.25 * sine(fa * 2, n)
    y = fft_filter(y, "lp", cutoff, 0.9, order=2)
    return y * adsr(n, 0.12, 0.4, 0.8, release, dur)

def inst_choir(f, dur, rng, attack=1.6, release=2.2):
    n = secs(dur + release)
    src = sum(saw(f * 2 ** (c / 1200), n, rng.uniform(0, 1)) for c in (-11, -4, 5, 12)) / 4
    src *= 1 + 0.08 * np.sin(TAU * 4.5 * tline(n) + rng.uniform(0, TAU))
    y = sum(g * fft_filter(src, "bp", fc, 7.0) for fc, g in [(590, 1.0), (920, 0.8), (2300, 0.45), (2800, 0.3)])
    y += 0.08 * fft_filter(noise(n, rng), "bp", 1500, 1.0)
    return y * adsr(n, attack, 1.0, 0.9, release, dur)

def inst_bell(f, dur, rng):
    n = secs(dur + 2.5)
    return bell(n, f, [1.0, 2.0, 2.76, 4.07, 5.4], [1.8, 1.2, 0.8, 0.5, 0.3], rng, 0.7) * np.minimum(tline(n) / 0.003, 1)

def inst_brass(f, dur, rng, release=0.12):
    n = secs(dur + release)
    t = tline(n)
    src = sum(saw(f * 2 ** (c / 1200), n, rng.uniform(0, 1)) for c in (-9, 0, 9)) / 3
    dark = fft_filter(src, "lp", 550, 1.2, order=2)
    bright = fft_filter(src, "lp", 3600, 1.5, order=2)
    fenv = 0.15 + 0.85 * np.exp(-t / 0.12)
    y = dark + (bright - dark) * fenv
    return np.tanh(1.6 * y) * adsr(n, 0.015, 0.15, 0.75, release, dur)

def drum_kick(rng, f=150, tail=0.35):
    n = secs(tail)
    y = sine(40 + (f - 40) * env_exp(n, 0.028), n) * env_exp(n, 0.11)
    return np.tanh(1.5 * y) + 0.4 * fft_filter(noise(n, rng), "hp", 2000) * env_exp(n, 0.004)

def drum_tom(rng, f=100):
    n = secs(0.5)
    y = sine(f * (1 + 0.6 * env_exp(n, 0.04)), n) * env_exp(n, 0.22)
    return y + 0.3 * fft_filter(noise(n, rng), "lp", 900) * env_exp(n, 0.02)

def drum_snare(rng):
    n = secs(0.3)
    y = fft_filter(noise(n, rng), "bp", 1900, 0.6) * env_exp(n, 0.09)
    return y + 0.6 * sine(185 * (1 + 0.3 * env_exp(n, 0.02)), n) * env_exp(n, 0.045)

def drum_hat(rng, tail=0.05):
    n = secs(tail + 0.02)
    return fft_filter(noise(n, rng), "hp", 7500, 0.7) * env_exp(n, tail * 0.6)

class Song:
    """Stereo multitrack buffer in beats.  Loops are rendered with a tail that
    is folded back onto the head, so reverb/release tails wrap seamlessly."""

    def __init__(self, name, bpm, bars, loop=True, tail=3.0):
        self.name, self.bpm, self.loop = name, bpm, loop
        self.rng = rng_for(name)
        self.spb = 60.0 / bpm
        self.length = secs(bars * 4 * self.spb)
        self.tail = secs(tail)
        self.buf = np.zeros((self.length + self.tail, 2))

    def add(self, x, beat, gain=1.0, pan=0.0):
        s = secs(beat * self.spb)
        x = stereo(x, pan) * gain
        n = min(len(x), len(self.buf) - s)
        if n > 0:
            self.buf[s : s + n] += x[:n]

    def notes(self, inst, events, gain=1.0, pan=0.0, spread=0.0, **kw):
        """events: iterable of (beat, note, duration_in_beats)."""
        for beat, note, dur in events:
            p = pan + spread * self.rng.uniform(-1, 1)
            self.add(inst(freq(midi(note)), dur * self.spb, self.rng, **kw), beat, gain, p)

    def hits(self, sample, beats, gain=1.0, pan=0.0):
        for b in beats:
            self.add(sample, b, gain, pan)

    def render(self, rev=None, peak=-6.0, drive=1.3):
        y = self.buf[: self.length].copy()
        if self.loop:
            y[: self.tail] += self.buf[self.length :] * np.linspace(1, 0, self.tail)[:, None] ** 0.3
        else:
            y = fade(self.buf, 0, 1.5)
        y = normalize(y, -4.0)
        y = softclip(y, drive)
        if rev:
            y = reverb(y, circular=self.loop, rng=self.rng, **rev)
        for c in range(2):
            y[:, c] = fft_filter(y[:, c], "hp", 28, 0.7, circular=self.loop)
        return normalize(y, peak)

def arp(chord_notes, pattern, start, steps, step=0.25, dur=0.3):
    return [(start + i * step, chord_notes[pattern[i % len(pattern)] % len(chord_notes)], dur) for i in range(steps)]

def every(start, end, step):
    b = start
    out = []
    while b < end - 1e-9:
        out.append(b)
        b += step
    return out

# --------------------------------------------------------------------------
# Songs
# --------------------------------------------------------------------------

MUSIC = {}

def music(name):
    def deco(fn):
        MUSIC[name] = fn
        return fn
    return deco

@music("music_title")
def _():
    s = Song("music_title", 72, 12)  # 40.0 s
    prog = [("A2", "m", 8), ("F2", "M", 8), ("D2", "m", 8), ("E2", "M", 8),
            ("A2", "m", 4), ("G2", "M", 4), ("F2", "M", 4), ("E2", "M", 4)]
    b = 0
    for root, q, length in prog:
        s.notes(inst_pad, [(b, n, length) for n in chord(root, q)], 0.16, cutoff=1100, attack=1.2)
        s.notes(inst_bass, [(b + k, midi(root) - 12, 1.9) for k in range(0, length, 2)], 0.45)
        arp_notes = chord(root, q, 2)[:6]
        arp_notes = [n + 24 for n in arp_notes]
        s.notes(inst_pluck, arp(arp_notes, [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 5, 2, 4, 1, 3, 0], b, length * 4), 0.17, pan=0.25, spread=0.1, bright=0.78, decay=2.5)
        b += length
    melody = [(0, 76, 3), (3.5, 74, 0.5), (4, 72, 2.5), (8, 77, 2), (10, 76, 2), (12, 72, 1.5), (13.5, 71, 2.5),
              (16, 74, 3), (19.5, 72, 0.5), (20, 69, 3.5), (24, 71, 2), (26, 80, 2), (28, 76, 3.5),
              (32, 81, 2), (34, 79, 1), (35, 77, 1), (36, 76, 3), (40, 74, 2), (42, 72, 2), (44, 71, 3)]
    s.notes(inst_lead, melody, 0.17, pan=-0.15)
    return s.render(dict(rt60=2.4, wet=0.32, damp=4500))

@music("music_moor")
def _():
    s = Song("music_moor", 64, 16)  # 60.0 s
    prog = [("D2", "m", 16), ("Bb1", "M", 16), ("G2", "m", 16), ("A2", "M", 16)]
    s.add(inst_drone(freq(midi("D1")), s.length, s.rng), 0, 0.3)
    s.add(inst_drone(freq(midi("D1")) * 1.5, s.length, s.rng, lo=120, hi=350, lfo=0.05), 0, 0.12)
    b = 0
    for root, q, length in prog:
        s.notes(inst_pad, [(b, n + 12, length) for n in chord(root, q)], 0.13, cutoff=900, attack=2.5, release=2.5, detune=10)
        s.notes(inst_bass, [(b + k, midi(root) - 12, 3.5) for k in range(0, length, 4)], 0.3, cutoff=200)
        pulse = [(b + k, midi(root) + (12 if (k * 2) % 4 == 2 else 0), 0.2) for k in every(0, length, 0.5)]
        s.notes(inst_pluck, pulse, 0.07, pan=0.2, bright=0.5, decay=6)
        b += length
    choir = [(16, "D4", 12), (16, "F4", 12), (16, "Bb4", 12), (48, "C#4", 12), (48, "E4", 12), (48, "A4", 12)]
    s.notes(inst_choir, choir, 0.16, spread=0.4)
    s.hits(drum_tom(s.rng, 70), [k * 4 for k in range(16)], 0.5)
    s.hits(drum_tom(s.rng, 95), [k * 8 + 6.5 for k in range(8)], 0.3, pan=0.3)
    s.notes(inst_bell, [(14, "A5", 1), (30, "D5", 1), (46, "F5", 1), (62, "E5", 1)], 0.11, pan=-0.3)
    return s.render(dict(rt60=3.5, wet=0.4, damp=3200))

@music("music_graveyard")
def _():
    s = Song("music_graveyard", 64, 16)  # 60.0 s
    prog = [("E2", "madd9", 16), ("C2", "M7", 16), ("A2", "madd9", 16), ("B2", "M", 16)]
    s.add(inst_drone(freq(midi("E1")), s.length, s.rng, lo=110, hi=300, lfo=0.04), 0, 0.28)
    b = 0
    for root, q, length in prog:
        s.notes(inst_pad, [(b, n + 12, length) for n in chord(root, q)], 0.12, cutoff=800, attack=3.0, release=3.0, detune=16)
        s.notes(inst_bass, [(b, midi(root) - 12, length - 1)], 0.25, cutoff=160, release=1.5)
        b += length
    scale = [midi(n) for n in ("E5", "F5", "G5", "A5", "B5", "C6", "D6", "E6", "G6")]
    bells = []
    t = 1.0
    while t < 63:
        bells.append((t, scale[s.rng.integers(len(scale))], 1))
        t += float(s.rng.choice([1.5, 2, 2.5, 3, 4]))
    s.notes(inst_bell, bells, 0.09, spread=0.7)
    wind = fft_filter(noise(s.length, s.rng), "lp", 600, 0.9, order=2, circular=True)
    wind *= np.clip(slow_noise(s.length, 0.15, s.rng, circular=True) + 0.3, 0, 1) ** 2
    s.add(widen(wind, 20, 0.8), 0, 0.09)
    s.hits(drum_tom(s.rng, 60), [k * 16 + 12 for k in range(4)], 0.35)
    return s.render(dict(rt60=5.0, wet=0.5, damp=2800))

@music("music_castle")
def _():
    s = Song("music_castle", 100, 24)  # 57.6 s
    prog = [("C2", "m", 8), ("Ab1", "M", 8), ("F2", "m", 8), ("G2", "M", 8)]
    for phrase in range(3):
        b = phrase * 32
        for root, q, length in prog:
            s.notes(inst_bass, [(b + k, midi(root) + (0 if (k * 2) % 2 == 0 else 12), 0.4) for k in every(0, length, 0.5)], 0.4, cutoff=380)
            s.notes(inst_pad, [(b, n + 12, length) for n in chord(root, q)], 0.11, cutoff=1000, attack=0.6, release=1.0)
            if phrase >= 1:
                cn = [n + 36 + (12 if phrase == 2 else 0) for n in chord(root, q, 2)[:6]] + [midi(root) + 37 + (12 if phrase == 2 else 0)]
                s.notes(inst_pluck, arp(cn, [0, 3, 1, 6, 2, 4, 0, 5, 1, 3, 6, 2, 4, 0, 3, 1], b, length * 4), 0.15, pan=0.3, spread=0.1, bright=0.8, decay=3)
            if phrase == 2:
                s.notes(inst_brass, [(b, n + 24, 0.5) for n in chord(root, q)] + [(b + 2.5, n + 24, 0.5) for n in chord(root, q)], 0.14, spread=0.3)
            b += length
    kick, snare, hat, tom_l, tom_h = drum_kick(s.rng), drum_snare(s.rng), drum_hat(s.rng), drum_tom(s.rng, 80), drum_tom(s.rng, 120)
    for bar in range(24):
        b = bar * 4
        s.hits(kick, [b, b + 1.5, b + 2], 0.75)
        s.hits(hat, every(b, b + 4, 0.5), 0.1, pan=0.35)
        if bar >= 8:
            s.hits(snare, [b + 1, b + 3], 0.5)
        if bar % 4 == 3:
            s.hits(tom_h, [b + 3, b + 3.25], 0.5, pan=-0.3)
            s.hits(tom_l, [b + 3.5, b + 3.75], 0.6, pan=0.3)
    return s.render(dict(rt60=1.8, wet=0.25, damp=4000))

@music("music_boss")
def _():
    s = Song("music_boss", 130, 24)  # 44.3 s
    prog = [("D2", "m", 8), ("Eb2", "M", 8), ("D2", "m", 8), ("A2", "M", 8)]
    for phrase in range(3):
        b = phrase * 32
        for root, q, length in prog:
            bass = [(b + k, midi(root) + (12 if int(k * 4) % 4 == 3 else 0), 0.22) for k in every(0, length, 0.25)]
            s.notes(inst_bass, bass, 0.42, cutoff=450, release=0.03)
            cn = [n + 36 for n in chord(root, q, 2)[:6]] + [midi(root) + 37]
            s.notes(inst_pluck, arp(cn, [0, 2, 4, 6, 5, 3, 1, 2, 0, 3, 5, 4, 6, 2, 1, 3], b, length * 4), 0.15, pan=-0.3, spread=0.15, bright=0.85, decay=4)
            stabs = [0, 1.5, 3, 4.5, 6, 7] if phrase < 2 else [0, 0.75, 1.5, 3, 4.5, 5.25, 6, 7.5]
            s.notes(inst_brass, [(b + st, n + 24, 0.4) for st in stabs for n in chord(root, q)], 0.13, spread=0.4)
            if phrase >= 1:
                s.notes(inst_lead, [(b, midi(root) + 31, 2.5), (b + 3, midi(root) + 34, 1), (b + 4, midi(root) + 36, 3.5)], 0.1, pan=0.2, cutoff=2400)
            b += length
    kick, snare, hat, tom_l, tom_h = drum_kick(s.rng, 170, 0.3), drum_snare(s.rng), drum_hat(s.rng, 0.03), drum_tom(s.rng, 85), drum_tom(s.rng, 130)
    for bar in range(24):
        b = bar * 4
        s.hits(kick, [b, b + 1, b + 2, b + 2.75, b + 3], 0.8)
        s.hits(snare, [b + 1, b + 3], 0.55)
        s.hits(hat, every(b, b + 4, 0.25), 0.08, pan=0.4)
        if bar % 2 == 1:
            s.hits(tom_h, [b + 3.5], 0.5, pan=-0.3)
            s.hits(tom_l, [b + 3.75], 0.6, pan=0.3)
        if bar % 8 == 7:
            s.hits(snare, [b + 2.5, b + 3.25, b + 3.75], 0.4)
    return s.render(dict(rt60=1.2, wet=0.2, damp=4500), drive=1.6)

@music("music_victory")
def _():
    s = Song("music_victory", 90, 4, loop=False, tail=2.0)  # 10.7 s + 2 s tail
    prog = [("F2", "M", 2), ("G2", "M", 2), ("C3", "Madd9", 4), ("F2", "M", 2), ("G2", "M", 2), ("C3", "Madd9", 4)]
    b = 0
    for root, q, length in prog:
        s.notes(inst_pad, [(b, n + 12, length) for n in chord(root, q)], 0.15, cutoff=1500, attack=0.3, release=2.0)
        s.notes(inst_bass, [(b, midi(root) - 12, length - 0.2)], 0.4)
        s.notes(inst_brass, [(b, n + 24, min(length, 2)) for n in chord(root, q)], 0.1, spread=0.3)
        b += length
    bells = [midi(n) for n in ("C5", "E5", "G5", "C6", "E6", "G6", "C7")]
    s.notes(inst_bell, [(12 + i * 0.25, n, 1) for i, n in enumerate(bells)], 0.14, spread=0.6)
    s.notes(inst_bell, [(4 + i * 0.5, n, 1) for i, n in enumerate(bells[:4])], 0.1, spread=0.6)
    s.notes(inst_lead, [(0, "A4", 1.5), (2, "B4", 1.5), (4, "C5", 3.5), (8, "A4", 1), (9, "C5", 1), (10, "D5", 2), (12, "E5", 4)], 0.16)
    s.hits(drum_kick(s.rng), [0, 2, 4, 8, 10, 12], 0.6)
    return s.render(dict(rt60=3.0, wet=0.4, damp=5000))

# --------------------------------------------------------------------------
# Encoding, verification, main
# --------------------------------------------------------------------------

def pick_encoder():
    out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    for enc in ("libvorbis", "vorbis"):
        if any(line.split()[1:2] == [enc] for line in out.splitlines() if line.strip()):
            return enc
    raise SystemExit("ffmpeg has no Vorbis encoder")

def write_ogg(path, x, enc):
    x = stereo(x) if x.ndim == 2 else x[:, None]
    # bitexact: fixed Ogg stream serial and no encoder-version tag, so the
    # output bytes are reproducible run to run.
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", str(x.shape[1]),
           "-i", "pipe:0", "-fflags", "+bitexact", "-flags", "+bitexact", "-c:a", enc, "-q:a", "4"]
    if enc == "vorbis":
        cmd += ["-strict", "-2"]
    subprocess.run(cmd + [path], input=np.clip(x, -1, 1).astype("<f4").tobytes(), check=True)

def probe(path):
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout.strip()
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return float(dur), peak_db(np.frombuffer(raw, "<f4"))

def finish_sfx(y, peak, rev, rng):
    if rev:
        y = reverb(y, rng=rng, **rev)
    y = fft_filter(y, "hp", 30, 0.7)
    return normalize(fade(y, 0.001, 0.004), peak)

def main(argv):
    os.makedirs(OUT_DIR, exist_ok=True)
    enc = pick_encoder()
    only = argv[1:]
    rows = []
    jobs = [(name, lambda n=name, f=fn, p=peak, r=rev: finish_sfx(f(rng_for(n)), p, r, rng_for(n + "_rev")))
            for name, (fn, peak, rev) in SFX.items()]
    jobs += [(name, fn) for name, fn in MUSIC.items()]
    for name, build in jobs:
        if only and not any(o in name for o in only):
            continue
        y = build()
        path = os.path.join(OUT_DIR, name + ".ogg")
        write_ogg(path, y, enc)
        dur, dpk = probe(path)
        rows.append((name + ".ogg", len(y) / SR, peak_db(y), dur, dpk, os.path.getsize(path)))
        print(f"  wrote {name}.ogg ({dur:.2f}s)", flush=True)
    print(f"\n{'file':24s} {'synth s':>8s} {'peak dB':>8s} {'ogg s':>8s} {'dec dB':>8s} {'bytes':>8s}")
    for r in rows:
        print(f"{r[0]:24s} {r[1]:8.2f} {r[2]:8.2f} {r[3]:8.2f} {r[4]:8.2f} {r[5]:8d}")
    print(f"\n{len(rows)} files, {sum(r[5] for r in rows) / 1024:.0f} KiB total, encoder {enc}")

if __name__ == "__main__":
    main(sys.argv)
