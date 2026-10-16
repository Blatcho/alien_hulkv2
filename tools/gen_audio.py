#!/usr/bin/env python3
"""gen_audio.py - procedural SFX and music for Derelict.

Weapons (pulse rifle, shotgun, SMG), xenomorph-style alien voices, acid,
motion-tracker pings, ship systems (alarm, fire, power, doors, vents), the
marine's own sounds, UI blips, stings and four dark ambient / industrial
music loops.  Everything is synthesised with NumPy (no samples, no
third-party DSP) and encoded to OGG Vorbis through the `ffmpeg` binary.
Output goes to assets/audio/ as sfx_<name>.ogg and music_<name>.ogg, the
exact names src/core/Audio.js loads.  The script is deterministic: every
sound has its own seeded RNG and the encoder runs bitexact.

    python3 tools/gen_audio.py             # build everything
    python3 tools/gen_audio.py rifle smg   # build only names containing these
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

def crack(n, rng, fc=2800, q=0.8, tau=0.01, snap=0.5):
    """Gunshot transient: band-passed burst plus a very short high snap."""
    y = fft_filter(noise(n, rng), "bp", fc, q) * env_exp(n, tau)
    return y + snap * fft_filter(noise(n, rng), "hp", 6000, 0.7) * env_exp(n, tau * 0.4)

def zap(n, f0, f1, tau, rng=None, drive=2.0):
    """Short descending energy 'pew' for the pulse weapons."""
    y = square(glide(f0, f1, n), n) + 0.5 * saw(glide(f0 * 2, f1 * 2, n), n)
    return np.tanh(drive * fft_filter(y, "lp", 5000, 0.8)) * env_exp(n, tau)

def click(n, base, rng, decay=0.02, bright=1.0):
    """Small mechanical click: a tight metal strike with its own noise."""
    return metal(n, base, [1, 1.52, 2.3, 3.4], [decay, decay * 0.7, decay * 0.5, decay * 0.3], rng, click=bright)

def screech(n, f, rng, formants, rough=55.0, drive=3.0, jitter=0.03, breath=0.25, fm=1.6):
    """Alien voice: FM-rich sine with a fast roughness modulation and
    jitter, through formant band-passes."""
    t = tline(n)
    f = np.broadcast_to(np.asarray(f, float), (n,)) * (1 + jitter * slow_noise(n, 40.0, rng))
    ph = TAU * np.cumsum(f) / SR
    src = np.sin(ph + fm * np.sin(ph * 1.5 + rng.uniform(0, TAU)) + 0.6 * np.sin(ph * 0.5))
    src *= 1 - 0.5 * (0.5 + 0.5 * np.sin(TAU * rough * t)) if rough else 1.0
    src += breath * fft_filter(noise(n, rng), "hp", 2500, 0.7)
    y = sum(g * fft_filter(src, "bp", fc, 4.0) for fc, g in formants)
    return np.tanh(drive * y)

def beep(n, f, tau, harm=0.3):
    return (sine(f, n) + harm * square(f, n)) * env_exp(n, tau) * np.minimum(tline(n) / 0.002, 1)

# ---- weapons -------------------------------------------------------------

@sfx("sfx_rifle")
def _(rng):
    # pulse rifle: a sharp crack with a short electric 'pew' under it
    n = secs(0.18)
    y = 1.3 * crack(n, rng, fc=3200, q=0.7, tau=0.009, snap=0.7)
    y += 0.9 * thump(n, 220, 70, 0.025, click=0.3, rng=rng)
    y += 0.5 * delay(zap(secs(0.05), 2200, 500, 0.014), 0, n)
    y += 0.25 * fft_filter(noise(n, rng), "lp", 1500, 0.7) * env_exp(n, 0.04)
    return softclip(y, 1.6)

@sfx("sfx_shotgun", rev=dict(rt60=0.5, wet=0.18, damp=2500))
def _(rng):
    # a deep boom, a chest thump, then the pump: two clacks and a rattle
    n = secs(0.5)
    boom = 1.6 * thump(n, 110, 34, 0.11, click=0.6, rng=rng)
    body = fft_filter(noise(n, rng), "lp", 1100, 0.8) * env_exp(n, 0.045)
    y = softclip(boom + 1.1 * body + 0.8 * crack(n, rng, fc=2200, q=0.6, tau=0.012, snap=0.6), 2.0)
    m = secs(0.12)
    pump = 0.55 * click(m, 1500, rng, 0.025, 0.9) + 0.4 * thump(m, 300, 110, 0.015, click=0.3, rng=rng)
    y += delay(pump, 0.29, n) + delay(pump * 0.85, 0.39, n)
    slide = fft_filter(noise(secs(0.1), rng), "bp", 2400, 1.5) * env_ad(secs(0.1), 0.03, 0.04)
    return y + 0.3 * delay(slide, 0.3, n)

@sfx("sfx_smg")
def _(rng):
    # tight, dry snap: mostly transient
    n = secs(0.12)
    y = 1.2 * crack(n, rng, fc=3800, q=0.9, tau=0.006, snap=0.6)
    y += 0.8 * thump(n, 260, 90, 0.014, click=0.0)
    y += 0.4 * zap(n, 1800, 600, 0.008, rng)
    return softclip(y, 1.5)

@sfx("sfx_reload_out", peak=-3.0)
def _(rng):
    # release catch, then the magazine slides out and clacks free
    n = secs(0.32)
    y = 0.8 * click(secs(0.08), 2100, rng, 0.012, 1.0)
    y = delay(y, 0, n)
    slide = fft_filter(noise(secs(0.16), rng), "bp", 1300, 1.2) * env_ad(secs(0.16), 0.03, 0.06)
    y += 0.45 * delay(slide, 0.05, n)
    y += delay(0.9 * click(secs(0.12), 900, rng, 0.03, 0.6) + 0.7 * thump(secs(0.12), 180, 80, 0.02, click=0.3, rng=rng), 0.2, n)
    return y

@sfx("sfx_reload_in", peak=-3.0)
def _(rng):
    # magazine seats with a thunk, then the bolt is racked back and released
    n = secs(0.5)
    seat = 1.0 * thump(secs(0.12), 220, 90, 0.02, click=0.4, rng=rng) + 0.8 * click(secs(0.12), 700, rng, 0.03, 0.7)
    y = delay(seat, 0, n)
    rack = fft_filter(noise(secs(0.1), rng), "bp", 1800, 1.5) * env_ad(secs(0.1), 0.02, 0.04)
    y += 0.4 * delay(rack, 0.22, n)
    y += delay(0.9 * click(secs(0.1), 1700, rng, 0.02, 1.0), 0.3, n)
    y += delay(1.0 * click(secs(0.15), 1100, rng, 0.035, 0.9) + 0.6 * thump(secs(0.15), 200, 80, 0.02, click=0.2, rng=rng), 0.4, n)
    return y

@sfx("sfx_empty", peak=-5.0)
def _(rng):
    # dry trigger: one thin click
    n = secs(0.07)
    return click(n, 2600, rng, 0.008, 1.2) + 0.3 * thump(n, 400, 200, 0.006, click=0.0)

@sfx("sfx_weapon_switch", peak=-3.0)
def _(rng):
    # click-clack: catch release, slide, lock
    n = secs(0.3)
    y = delay(0.9 * click(secs(0.08), 1900, rng, 0.012, 1.0), 0, n)
    slide = fft_filter(noise(secs(0.12), rng), "bp", 2000, 1.3) * env_ad(secs(0.12), 0.02, 0.05)
    y += 0.35 * delay(slide, 0.04, n)
    y += delay(1.0 * click(secs(0.14), 1200, rng, 0.03, 0.8) + 0.5 * thump(secs(0.14), 240, 100, 0.015, click=0.2, rng=rng), 0.14, n)
    return y

# ---- aliens ---------------------------------------------------------------

ALIEN_F = [(700, 1.0), (1500, 0.9), (2600, 0.7), (4200, 0.4)]

@sfx("sfx_alien_screech", rev=dict(rt60=0.9, wet=0.22, damp=5000))
def _(rng):
    # harsh rising screech with a broken top
    n = secs(0.8)
    t = tline(n)
    f = glide(650, 2100, n) * (1 + 0.05 * np.sin(TAU * 11 * t))
    y = screech(n, f, rng, ALIEN_F, rough=60, drive=4.0, jitter=0.04, breath=0.3)
    y *= adsr(n, 0.04, 0.2, 0.75, 0.2, 0.6)
    return y + 0.25 * fft_filter(noise(n, rng), "hp", 4000, 0.7) * env_ad(n, 0.1, 0.3)

@sfx("sfx_alien_hiss", peak=-3.0)
def _(rng):
    # breathy hiss through teeth, a low throat tone underneath
    n = secs(0.7)
    fc = glide(2600, 5200, n) * (1 + 0.15 * slow_noise(n, 9, rng))
    y = svf(noise(n, rng), fc, 1.4, "bp") * (0.7 + 0.3 * slow_noise(n, 30, rng))
    y *= adsr(n, 0.06, 0.2, 0.8, 0.18, 0.5)
    throat = screech(n, 95 * (1 + 0.1 * slow_noise(n, 6, rng)), rng, [(500, 1.0), (1200, 0.5)], rough=40, drive=1.5, breath=0.0)
    return 2.0 * y + 0.18 * throat * adsr(n, 0.1, 0.2, 0.8, 0.2, 0.45)

@sfx("sfx_alien_attack")
def _(rng):
    # snarl into a claw swipe
    n = secs(0.5)
    m = secs(0.3)
    snarl = growl(m, 160, 95, [(600, 1.0), (1400, 0.8), (3000, 0.5)], rng, drive=4.0, jitter=0.05, rough=38, breath=0.3, sub=0.1)
    y = delay(snarl * env_ad(m, 0.015, 0.1), 0, n)
    y += 1.1 * delay(whoosh(secs(0.3), 500, 3200, 900, rng, q=1.4, attack=0.03, decay=0.08), 0.12, n)
    return y + 0.4 * delay(whoosh(secs(0.25), 900, 4500, 1200, rng, q=2.5, attack=0.02, decay=0.05), 0.15, n)

@sfx("sfx_alien_death", rev=dict(rt60=1.0, wet=0.25, damp=4000))
def _(rng):
    # a screech that breaks and falls, then gurgles out
    n = secs(1.0)
    t = tline(n)
    f = glide(1900, 260, n) * (1 + 0.08 * np.sin(TAU * 7 * t) * np.clip(t * 3, 0, 1))
    y = screech(n, f, rng, ALIEN_F, rough=45, drive=4.0, jitter=0.07, breath=0.3)
    y *= adsr(n, 0.02, 0.3, 0.6, 0.25, 0.7) * (1 - 0.4 * np.clip(t - 0.4, 0, 1) * (0.5 + 0.5 * np.sin(TAU * 18 * t)))
    bub = fft_filter(noise(n, rng), "bp", 650, 2.5) * np.clip(slow_noise(n, 45, rng) * 2.2 - 0.6, 0, 1)
    bub = fft_filter(bub, "lp", 1800, 0.7) * np.clip((t - 0.3) / 0.25, 0, 1) * env_exp(n, 0.5)
    return y + 2.0 * bub

@sfx("sfx_alien_hurt")
def _(rng):
    # short yelp: a quick up-down bark
    n = secs(0.25)
    f = np.concatenate([glide(900, 1700, secs(0.08)), glide(1700, 700, n - secs(0.08))])
    y = screech(n, f, rng, ALIEN_F, rough=70, drive=3.0, jitter=0.05, breath=0.2)
    return y * env_ad(n, 0.01, 0.07)

@sfx("sfx_acid", peak=-4.0)
def _(rng):
    # acid blood on deck plate: sizzle, sputtering pops, a thin steam hiss
    n = secs(0.8)
    t = tline(n)
    siz = fft_filter(noise(n, rng), "hp", 4500, 0.7) * (0.5 + 0.5 * slow_noise(n, 70, rng) ** 2)
    pops = noise(n, rng) * (rng.uniform(0, 1, n) > 0.998) * rng.uniform(0.3, 1, n)
    pops = convolve(fft_filter(pops, "bp", 2200, 1.0) * 5, env_exp(secs(0.02), 0.004), False)
    bub = fft_filter(noise(n, rng), "bp", 800, 3.0) * np.clip(slow_noise(n, 35, rng) * 2 - 0.5, 0, 1)
    env = adsr(n, 0.015, 0.2, 0.7, 0.3, 0.5)
    return (1.4 * siz + 0.8 * pops + 1.2 * bub) * env

# ---- pickups, tracker, shield ----------------------------------------------

@sfx("sfx_tracker_ping", peak=-7.0)
def _(rng):
    # a clean sonar ping with a tiny slapback
    n = secs(0.4)
    m = secs(0.2)
    p = sine(glide(2400, 2150, m), m) * env_exp(m, 0.035) + 0.3 * sine(4800, m) * env_exp(m, 0.012)
    p *= np.minimum(tline(m) / 0.002, 1)
    y = delay(p, 0, n) + 0.3 * delay(fft_filter(p, "lp", 3000, 0.7), 0.1, n)
    return y + 0.08 * delay(fft_filter(p, "lp", 2000, 0.7), 0.2, n)

@sfx("sfx_pickup_ammo", peak=-3.0)
def _(rng):
    # two magazine clinks
    n = secs(0.35)
    a = metal(secs(0.2), 2300, [1, 1.41, 1.98, 2.72, 3.5], [0.06, 0.05, 0.04, 0.03, 0.02], rng, click=0.6)
    b = metal(secs(0.25), 1750, [1, 1.47, 2.1, 2.9, 3.8], [0.09, 0.07, 0.05, 0.04, 0.03], rng, click=0.5)
    return delay(a, 0, n) + 0.9 * delay(b, 0.075, n) + 0.4 * thump(n, 200, 90, 0.02, click=0.2, rng=rng)

@sfx("sfx_pickup_med", peak=-4.0)
def _(rng):
    # soft two-note chime, low-passed so it stays gentle
    n = secs(0.5)
    a = chime(secs(0.4), 880, 0.14, rng, 0.5)
    b = chime(secs(0.4), 1174.7, 0.18, rng, 0.5)
    return fft_filter(delay(a, 0, n) + 0.9 * delay(b, 0.12, n), "lp", 4000, 0.7)

@sfx("sfx_potion", peak=-4.0)
def _(rng):
    # medkit used: a soft three-note chime
    n = secs(0.6)
    y = np.zeros(n)
    for i, (f, at) in enumerate([(659.3, 0.0), (880.0, 0.1), (1174.7, 0.2)]):
        y += (0.8 + 0.1 * i) * delay(chime(secs(0.4), f, 0.16, rng, 0.45), at, n)
    return fft_filter(y, "lp", 4500, 0.7)

@sfx("sfx_shield_on", rev=dict(rt60=0.6, wet=0.18, damp=6000))
def _(rng):
    # energy field spinning up: a rising hum that locks in with a shimmer
    n = secs(0.65)
    t = tline(n)
    f = glide(70, 240, n)
    src = saw(f, n) + 0.6 * square(f * 0.5, n) + 0.4 * sine(f * 2, n)
    y = svf(src, glide(300, 3200, n), 2.2, "lp") * adsr(n, 0.05, 0.15, 0.7, 0.15, 0.5)
    shim = svf(noise(n, rng), glide(1500, 7000, n), 4.0, "bp") * env_ad(n, 0.25, 0.15)
    return np.tanh(1.5 * y) + 0.5 * shim + 0.25 * sine(f * 4, n) * env_ad(n, 0.3, 0.15)

@sfx("sfx_shield_hit")
def _(rng):
    # energy impact: a thud with an electric crackle
    n = secs(0.35)
    y = 1.1 * thump(n, 180, 60, 0.05, click=0.4, rng=rng)
    gate = np.clip(slow_noise(n, 300, rng) * 2.5 - 0.8, 0, 1)
    crk = fft_filter(noise(n, rng), "bp", 3600, 1.2) * gate * env_exp(n, 0.09)
    buzz = fft_filter(square(95 * (1 + 0.2 * slow_noise(n, 50, rng)), n), "bp", 1400, 1.5) * env_exp(n, 0.06)
    return y + 1.5 * crk + 0.5 * buzz

# ---- ship systems -----------------------------------------------------------

@sfx("sfx_alarm", peak=-6.0)
def _(rng):
    # 1.5 s loop: two-tone klaxon, each tone swooping up into place
    n = secs(1.5)
    half = n // 2
    y = np.zeros(n)
    for i, f in enumerate([520, 390]):
        m = half
        fr = glide(f * 0.85, f, m) * (1 + 0.004 * np.sin(TAU * 6 * tline(m)))
        tone = saw(fr, m) + 0.6 * square(fr * 0.5, m) + 0.3 * sine(fr * 2, m)
        tone = fft_filter(tone, "bp", 900, 0.8) + 0.5 * fft_filter(tone, "lp", 600, 1.0)
        tone = np.tanh(2.0 * tone) * adsr(m, 0.02, 0.1, 0.9, 0.04, m / SR - 0.05)
        y[i * half : i * half + m] += tone
    return y

@sfx("sfx_fire", peak=-12.0)
def _(rng):
    # 2 s loop: burning bed with crackle and a thin hiss (all filters wrap)
    n = secs(2.0)
    roar = fft_filter(noise(n, rng), "lp", 380, 0.7, order=2, circular=True)
    roar *= 0.55 + 0.45 * slow_noise(n, 4, rng, circular=True)
    pops = noise(n, rng) * (rng.uniform(0, 1, n) > 0.9991) * rng.uniform(0.2, 1, n)
    pops = fft_filter(pops, "bp", 2600, 1.2, circular=True) * 4
    pops = convolve(pops, env_exp(secs(0.02), 0.004), circular=True)
    hiss = fft_filter(noise(n, rng), "hp", 3800, 0.7, circular=True) * (0.5 + 0.5 * slow_noise(n, 10, rng, circular=True))
    return 6 * roar + 0.6 * pops + 0.12 * hiss

@sfx("sfx_power_down", rev=dict(rt60=0.8, wet=0.2, damp=3000))
def _(rng):
    # systems dying: a long descending whine, the mains hum sagging out, a relay clunk
    n = secs(1.2)
    t = tline(n)
    f = glide(1900, 55, n)
    whine = (0.6 * saw(f, n) + 0.5 * sine(f, n)) * np.exp(-t / 0.7)
    whine = svf(whine, glide(5000, 200, n), 1.2, "lp")
    hum = (sine(120, n) + 0.4 * square(60, n)) * np.exp(-t / 0.35) * (1 + 0.1 * np.sin(TAU * 7 * t))
    hum = fft_filter(hum, "lp", 400, 0.8)
    clunk = thump(secs(0.2), 160, 50, 0.05, click=0.5, rng=rng) + 0.5 * click(secs(0.2), 500, rng, 0.05, 0.6)
    return 1.3 * whine + 0.8 * hum + 1.2 * delay(clunk, 0.95, n)

@sfx("sfx_power_up", rev=dict(rt60=0.6, wet=0.15, damp=3500))
def _(rng):
    # rising whine, a breaker thunk, the hum settles in
    n = secs(1.1)
    t = tline(n)
    m = secs(0.85)
    f = glide(50, 1600, m)
    whine = (0.6 * saw(f, m) + 0.5 * sine(f, m)) * adsr(m, 0.05, 0.1, 0.9, 0.04, 0.8)
    whine = svf(whine, glide(200, 4500, m), 1.4, "lp")
    thunk = 1.4 * thump(secs(0.25), 140, 45, 0.06, click=0.6, rng=rng) + 0.7 * click(secs(0.25), 420, rng, 0.06, 0.7)
    hum = fft_filter(sine(120, n) + 0.4 * square(60, n), "lp", 400, 0.8) * np.clip((t - 0.85) / 0.05, 0, 1)
    return delay(whine, 0, n) + delay(thunk, 0.85, n) + 0.5 * hum

@sfx("sfx_vent_clang", rev=dict(rt60=1.3, wet=0.3, damp=3500))
def _(rng):
    # a grille slamming down on deck plate, ringing afterward
    n = secs(0.9)
    y = 1.3 * thump(secs(0.3), 130, 45, 0.07, click=0.6, rng=rng)
    y = delay(y, 0, n)
    y += metal(n, 310, [1, 1.38, 1.92, 2.47, 3.3, 4.6, 5.9], [0.5, 0.42, 0.33, 0.25, 0.18, 0.11, 0.07], rng, detune=0.02, click=0.7)
    y += 0.5 * delay(metal(secs(0.3), 620, [1, 1.5, 2.2, 3.1], [0.08, 0.06, 0.04, 0.03], rng, click=0.5), 0.06, n)
    return y

@sfx("sfx_door", rev=dict(rt60=1.0, wet=0.25, damp=3000))
def _(rng):
    # pneumatic bulkhead door: air release, servo slide, then it seats with a thunk
    n = secs(0.6)
    m = secs(0.42)
    hiss = svf(noise(m, rng), glide(3500, 1500, m), 1.2, "bp") * env_ad(m, 0.015, 0.14)
    servo = fft_filter(saw(glide(190, 230, m), m) + 0.5 * square(glide(95, 115, m), m), "lp", 700, 1.2) * adsr(m, 0.03, 0.1, 0.8, 0.05, 0.36)
    k = secs(0.25)
    thunk = 1.3 * thump(k, 150, 50, 0.05, click=0.5, rng=rng) + 0.7 * metal(k, 480, [1, 1.45, 2.1, 2.9], [0.12, 0.09, 0.06, 0.04], rng, click=0.5)
    return delay(1.2 * hiss, 0, n) + 0.45 * delay(servo, 0.02, n) + delay(thunk, 0.42, n)

# ---- marine ----------------------------------------------------------------

def step(name, base, fc):
    @sfx(name, peak=-12.0)
    def _(rng):
        # boot on deck plate: a dull thump with a short low metallic ring
        n = secs(0.16)
        y = fft_filter(noise(n, rng), "lp", fc, 0.8) * env_ad(n, 0.003, 0.025)
        y += 0.25 * fft_filter(noise(n, rng), "bp", 2600, 2.0) * env_exp(n, 0.006)
        y += 0.9 * thump(n, 85, 45, 0.03, click=0.0)
        return y + 0.35 * metal(n, base, [1, 1.6, 2.3, 3.4], [0.09, 0.06, 0.04, 0.03], rng, click=0.0)

step("sfx_step1", 165, 750)
step("sfx_step2", 190, 950)

@sfx("sfx_jump")
def _(rng):
    n = secs(0.2)
    g = growl(secs(0.09), 170, 130, [(500, 1.0), (1200, 0.5)], rng, drive=1.5, breath=0.3) * env_ad(secs(0.09), 0.01, 0.03)
    return mix(0.6 * g, whoosh(n, 400, 1800, 1200, rng, q=1.5, attack=0.04, decay=0.07))

@sfx("sfx_land")
def _(rng):
    # landing on deck plate: thud plus a low metal ring
    n = secs(0.22)
    y = thump(n, 95, 40, 0.05, click=0.0)
    y += 0.7 * fft_filter(noise(n, rng), "lp", 650, 0.7) * env_exp(n, 0.03)
    return y + 0.4 * metal(n, 140, [1, 1.55, 2.2, 3.3], [0.12, 0.09, 0.06, 0.04], rng, click=0.2)

@sfx("sfx_dodge")
def _(rng):
    n = secs(0.25)
    return whoosh(n, 900, 350, 1500, rng, q=1.2, attack=0.02, decay=0.1) + 0.4 * whoosh(n, 200, 600, 250, rng, q=1.5, attack=0.05, decay=0.08)

@sfx("sfx_player_hurt")
def _(rng):
    n = secs(0.35)
    y = growl(n, 150, 95, [(480, 1.0), (1100, 0.7), (2400, 0.35)], rng, drive=3.0, sub=0.15)
    return y * env_ad(n, 0.012, 0.09)

@sfx("sfx_player_death", rev=dict(rt60=1.2, wet=0.3))
def _(rng):
    # a long failing grunt, then the body hits the deck
    n = secs(1.3)
    y = growl(n, 125, 58, [(400, 1.0), (900, 0.8), (2200, 0.4)], rng, drive=3.5, jitter=0.07, rough=22, sub=0.25)
    y *= env_ad(n, 0.03, 0.4) * (1 - 0.3 * (0.5 + 0.5 * np.sin(TAU * 6 * tline(n))))
    fall = 1.2 * thump(secs(0.3), 110, 40, 0.07, click=0.5, rng=rng) + 0.4 * metal(secs(0.3), 150, [1, 1.5, 2.3], [0.12, 0.08, 0.05], rng, click=0.0)
    return y + delay(fall, 0.95, n)

@sfx("sfx_bark", peak=-8.0)
def _(rng):
    # radio squelch blip for a speech bubble
    n = secs(0.12)
    m = secs(0.045)
    b = fft_filter(square(1650, m), "bp", 1700, 3.0) * adsr(m, 0.003, 0.01, 0.8, 0.01, 0.035)
    b += 0.5 * fft_filter(noise(m, rng), "bp", 2800, 2.0) * env_exp(m, 0.01)
    return delay(b, 0, n) + 0.8 * delay(b, 0.06, n)

# ---- impacts -----------------------------------------------------------------

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

def hit_metal(name, base, f0, f1):
    @sfx(name, rev=dict(rt60=0.5, wet=0.15))
    def _(rng):
        # ricochet: a metal ping with a descending whine behind it
        n = secs(0.4)
        y = metal(n, base, [1, 1.47, 2.09, 2.56, 3.18, 4.1], [0.14, 0.11, 0.09, 0.07, 0.05, 0.04], rng)
        y += 0.5 * thump(n, 180, 60, 0.025, click=0.5, rng=rng)
        wh = sine(glide(f0, f1, n), n) * env_ad(n, 0.004, 0.08)
        return y + 0.45 * wh + 0.2 * sine(glide(f0 * 2.01, f1 * 2.01, n), n) * env_ad(n, 0.004, 0.05)

hit_metal("sfx_hit_metal1", 880, 3300, 900)
hit_metal("sfx_hit_metal2", 1060, 2800, 1100)

@sfx("sfx_wall_hit")
def _(rng):
    # a round into bulkhead: dull plate thud, a spark, a short dead ring
    n = secs(0.25)
    y = 1.1 * thump(n, 170, 60, 0.04, click=0.6, rng=rng)
    spark = fft_filter(noise(n, rng), "hp", 5000, 0.7) * env_exp(n, 0.008)
    ring = metal(n, 720, [1, 1.5, 2.3, 3.2], [0.05, 0.04, 0.03, 0.02], rng, click=0.0)
    return y + 0.6 * spark + 0.5 * ring + 0.5 * fft_filter(noise(n, rng), "bp", 1800, 0.8) * env_exp(n, 0.02)

@sfx("sfx_explosion", rev=dict(rt60=1.6, wet=0.3, damp=2200))
def _(rng):
    # barrel: a sharp crack, a deep boom, a sweeping blast and scattered debris
    n = secs(1.2)
    t = tline(n)
    boom = 1.6 * thump(n, 75, 24, 0.3, click=0.0)
    blast = svf(noise(n, rng), glide(3500, 150, n), 0.9, "lp") * env_ad(n, 0.01, 0.3)
    crk = crack(n, rng, fc=2500, q=0.6, tau=0.02, snap=0.8)
    y = softclip(boom + 2.2 * blast + 0.9 * crk, 2.2)
    for k in range(10):
        at = 0.15 + k * 0.07 + rng.uniform(0, 0.04)
        m = secs(0.2)
        d = metal(m, rng.uniform(500, 1600), [1, 1.5, 2.3, 3.1], [0.06, 0.05, 0.04, 0.03], rng, click=0.3)
        y += delay((0.5 - k * 0.035) * d, at, n)
    rumble = fft_filter(noise(n, rng), "lp", 150, 0.7) * adsr(n, 0.03, 0.3, 0.4, 0.4, 0.6)
    return y + 1.6 * rumble

@sfx("sfx_crit", peak=-4.0)
def _(rng):
    # short bright tick
    n = secs(0.09)
    y = fft_filter(noise(n, rng), "hp", 6000, 0.7) * env_exp(n, 0.004)
    return y + 0.8 * beep(n, 3500, 0.012, 0.2) + 0.4 * beep(n, 5250, 0.008, 0.0)

@sfx("sfx_kill", peak=-2.0)
def _(rng):
    # confirmed kill: a low thud with a tiny chime riding on it
    n = secs(0.4)
    y = 1.2 * thump(n, 95, 36, 0.08, click=0.3, rng=rng)
    return y + 0.35 * delay(chime(secs(0.3), 1567.98, 0.1, rng, 0.6), 0.04, n)

# ---- UI ----------------------------------------------------------------------

@sfx("sfx_ui_move", peak=-7.0)
def _(rng):
    n = secs(0.08)
    return beep(n, 1800, 0.015, 0.25) + 0.3 * fft_filter(noise(n, rng), "bp", 3000, 4.0) * env_exp(n, 0.006)

@sfx("sfx_ui_confirm", peak=-5.0)
def _(rng):
    n = secs(0.22)
    return delay(beep(secs(0.1), 1200, 0.03, 0.25), 0, n) + delay(beep(secs(0.15), 1800, 0.045, 0.25), 0.07, n)

@sfx("sfx_ui_back", peak=-6.0)
def _(rng):
    n = secs(0.2)
    return delay(beep(secs(0.1), 1500, 0.03, 0.25), 0, n) + delay(beep(secs(0.14), 1000, 0.04, 0.25), 0.06, n)

# ---- stings -------------------------------------------------------------------

@sfx("sfx_loot", rev=dict(rt60=0.6, wet=0.2))
def _(rng):
    n = secs(0.5)
    y = 1.1 * thump(n, 110, 48, 0.07, click=0.4, rng=rng)
    return y + 0.8 * delay(chime(secs(0.4), 1567.98, 0.16, rng, 1.0) + 0.5 * chime(secs(0.4), 2349.3, 0.12, rng, 0.8), 0.03, n)

@sfx("sfx_medkit", peak=-3.0)
def _(rng):
    # auto-injector: a sharp hiss, then the unit's double beep
    n = secs(0.55)
    m = secs(0.25)
    hiss = svf(noise(m, rng), glide(5000, 2500, m), 1.5, "bp") * env_ad(m, 0.006, 0.08)
    y = delay(1.3 * hiss, 0, n) + 0.5 * delay(click(secs(0.06), 2400, rng, 0.01, 1.0), 0, n)
    return y + 0.5 * delay(beep(secs(0.08), 2200, 0.03, 0.2), 0.3, n) + 0.5 * delay(beep(secs(0.1), 2200, 0.035, 0.2), 0.4, n)

@sfx("sfx_room_clear", rev=dict(rt60=1.8, wet=0.35, damp=4500))
def _(rng):
    # short rising synth sting: the section is secure
    n = secs(1.3)
    y = np.zeros(n)
    for i, (f, at, d) in enumerate([(146.8, 0.0, 0.5), (220.0, 0.16, 0.5), (293.7, 0.32, 0.8)]):
        a = int(at * SR); m = n - a
        tone = (saw(f, m) * 0.5 + saw(f * 1.004, m) * 0.5 + 0.4 * square(f * 0.5, m)) * adsr(m, 0.02, 0.1, 0.7, 0.3, d)
        y[a:] += fft_filter(tone, "lp", 1400 + i * 500, 0.9) * (0.5 + 0.2 * i)
    return y * 0.6 + 0.25 * chime(n, 1174.7, 0.45, rng, mod=0.7)

@sfx("sfx_levelup", rev=dict(rt60=1.6, wet=0.35, damp=5000))
def _(rng):
    # objective complete: a four-note rise over a cold pad, with a shimmer sweep
    n = secs(1.4)
    y = np.zeros(n)
    notes = [293.7, 349.2, 440.0, 587.3]
    for i, f in enumerate(notes):
        y += delay(0.7 * chime(secs(0.8), f * 2, 0.3, rng, 0.8), i * 0.1, n)
        m = secs(1.2 - i * 0.1)
        pad = (saw(f, m) + saw(f * 1.004, m) + 0.5 * square(f * 0.5, m)) / 3
        y += 0.14 * delay(fft_filter(pad, "lp", 1500, 0.9, order=2) * adsr(m, 0.08, 0.2, 0.8, 0.35, 0.6), i * 0.1, n)
    sh = svf(noise(n, rng), glide(1200, 8000, n), 2.5, "bp") * env_ad(n, 0.3, 0.35)
    return y + 0.3 * sh

@sfx("sfx_survivor_rescued", rev=dict(rt60=2.0, wet=0.35, damp=4000))
def _(rng):
    # warm two-chord sting: D minor opening into B-flat major, a soft bell on top
    n = secs(1.8)
    y = np.zeros(n)
    for at, notes, d in [(0.0, ["D3", "F3", "A3", "D4"], 0.7), (0.55, ["Bb2", "D3", "F3", "A3", "D4"], 1.1)]:
        a = int(at * SR); m = n - a
        for k, nm in enumerate(notes):
            f = freq(midi(nm))
            tone = sum(saw(f * 2 ** (c / 1200), m, rng.uniform(0, 1)) for c in (-7, 0, 7)) / 3
            tone = fft_filter(tone, "lp", 1100, 0.9, order=2) * adsr(m, 0.12, 0.3, 0.8, 0.5, d)
            y[a:] += tone * (0.3 if k else 0.4)
    y += 0.25 * delay(chime(secs(1.0), 1174.7, 0.4, rng, 0.6), 0.6, n)
    return y

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

    def loop_freq(self, f):
        """Nearest frequency with a whole number of cycles in the loop, so a
        full-length drone wraps without a phase step."""
        return round(f * self.length / SR) * SR / self.length

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

def clank(rng, base, dur=1.4, damp=1500.0):
    """Distant struck metal for the ambient tracks: long inharmonic ring,
    low-passed so it sits far back in the ship."""
    n = secs(dur)
    y = metal(n, base, [1, 1.41, 1.93, 2.48, 3.3, 4.2], [0.55, 0.45, 0.35, 0.25, 0.16, 0.1], rng, detune=0.02, click=0.3)
    return fft_filter(y, "lp", damp, 0.8) * np.minimum(tline(n) / 0.002, 1)

def drum_industrial(rng):
    """Snare substitute: a metallic slap with a short noise body."""
    n = secs(0.25)
    y = fft_filter(noise(n, rng), "bp", 1400, 0.7) * env_exp(n, 0.05)
    y += 0.6 * metal(n, 760, [1, 1.5, 2.2, 3.1], [0.05, 0.04, 0.03, 0.02], rng, click=0.5)
    return y + 0.5 * sine(170 * (1 + 0.4 * env_exp(n, 0.015)), n) * env_exp(n, 0.035)

def wind(n, rng, fc=500.0, rate=0.15, floor=0.3):
    w = fft_filter(noise(n, rng), "lp", fc, 0.9, order=2, circular=True)
    return w * np.clip(slow_noise(n, rate, rng, circular=True) + floor, 0, 1) ** 2

@music("music_title")
def _():
    # slow cold drone, a minor-key pad that slides to a borrowed F minor,
    # sparse struck metal in a long hall
    s = Song("music_title", 60, 15)  # 60.0 s
    s.add(inst_drone(s.loop_freq(freq(midi("A1"))), s.length, s.rng, lo=100, hi=260, lfo=0.03), 0, 0.3)
    s.add(inst_drone(s.loop_freq(freq(midi("E2"))), s.length, s.rng, lo=90, hi=200, lfo=0.05), 0, 0.08)
    prog = [("A2", "madd9", 20), ("F2", "m", 20), ("A2", "madd9", 20)]
    b = 0
    for root, q, length in prog:
        s.notes(inst_pad, [(b, n + 12, length) for n in chord(root, q)], 0.1, cutoff=700, attack=3.5, release=4.0, detune=14, q=0.9)
        s.notes(inst_bass, [(b + k, midi(root) - 12, 6) for k in range(0, length, 8)], 0.22, cutoff=150, release=2.0)
        b += length
    for beat in [3.0, 11.5, 22.0, 30.5, 41.0, 51.5, 57.0]:
        s.add(clank(s.rng, s.rng.uniform(180, 420)), beat, 0.5, s.rng.uniform(-0.6, 0.6))
    for beat in [7.0, 26.0, 46.0]:
        s.add(clank(s.rng, s.rng.uniform(900, 1500), 0.9, 2500), beat, 0.14, s.rng.uniform(-0.8, 0.8))
    s.add(widen(wind(s.length, s.rng, 420, 0.12, 0.25), 25, 0.8), 0, 0.08)
    s.notes(inst_bell, [(14, "E5", 1), (38, "C5", 1), (54, "Bb4", 1)], 0.05, pan=-0.3)
    return s.render(dict(rt60=5.0, wet=0.5, damp=2500))

@music("music_derelict")
def _():
    # ambient exploration: low drone, slow dissonant pads, distant clanks,
    # a slow double-pulse like a heartbeat, air moving through vents
    s = Song("music_derelict", 60, 16)  # 64.0 s
    s.add(inst_drone(s.loop_freq(freq(midi("E1"))), s.length, s.rng, lo=110, hi=300, lfo=0.04), 0, 0.3)
    prog = [("E2", "sus2", 16), ("Bb1", "dim", 16), ("E2", "m", 16), ("D2", "sus2", 16)]
    b = 0
    for root, q, length in prog:
        s.notes(inst_pad, [(b, n + 12, length) for n in chord(root, q)], 0.1, cutoff=750, attack=3.0, release=3.0, detune=16)
        s.notes(inst_bass, [(b, midi(root) - 12, length - 1)], 0.2, cutoff=150, release=1.5)
        for k in range(0, length, 4):
            s.notes(inst_bass, [(b + k, "E1", 0.3), (b + k + 0.55, "E1", 0.25)], 0.26, cutoff=170, release=0.15)
        b += length
    t = 2.0
    while t < 62:
        s.add(clank(s.rng, s.rng.uniform(150, 500)), t, s.rng.uniform(0.25, 0.5), s.rng.uniform(-0.7, 0.7))
        t += float(s.rng.choice([5.0, 6.5, 8.0, 9.5, 11.0]))
    t = 5.0
    while t < 60:
        s.add(clank(s.rng, s.rng.uniform(800, 1600), 0.8, 2200), t, 0.1, s.rng.uniform(-0.9, 0.9))
        t += float(s.rng.choice([7.0, 9.0, 12.0]))
    s.add(widen(wind(s.length, s.rng, 600, 0.1, 0.3), 20, 0.8), 0, 0.09)
    vent = fft_filter(noise(s.length, s.rng), "bp", 2400, 2.5, circular=True)
    vent *= 0.5 + 0.5 * np.sin(TAU * 0.5 * tline(s.length))
    s.add(widen(vent, 15, 0.6), 0, 0.02)
    s.hits(drum_tom(s.rng, 55), [k * 16 + 14 for k in range(4)], 0.3)
    return s.render(dict(rt60=4.0, wet=0.45, damp=2800))

@music("music_tension")
def _():
    # pursuit: a driving sixteenth-note bass, industrial percussion, tritone stabs
    s = Song("music_tension", 138, 32)  # 55.7 s
    prog = [("D1", 32), ("Eb1", 16), ("D1", 16), ("Ab1", 16), ("D1", 16), ("Bb1", 16), ("D1", 16)]
    b = 0
    for root, length in prog:
        r = midi(root)
        bass = [(b + k, r + (12 if int(k * 4) % 8 == 6 else 0) + (1 if int(k * 4) % 16 == 15 else 0), 0.2) for k in every(0, length, 0.25)]
        s.notes(inst_bass, bass, 0.42, cutoff=520, release=0.03)
        s.notes(inst_pad, [(b, r + 24, length), (b + 0.01, r + 27, length), (b + 0.02, r + 30, length)], 0.08, cutoff=650, attack=0.8, release=1.0, detune=12)
        if b >= 16:
            stabs = [0, 1.5, 3, 5.5, 6.5] if b < 64 else [0, 0.75, 1.5, 3, 4.5, 5.5, 6.5, 7.5]
            for blk in range(0, length, 8):
                s.notes(inst_brass, [(b + blk + st, r + n, 0.3) for st in stabs for n in (36, 42, 49)], 0.11, spread=0.4)
        if b >= 64:
            s.notes(inst_lead, [(b, r + 42, 2.5), (b + 3, r + 43, 1), (b + 4, r + 42, 3.5), (b + 8, r + 48, 3.5), (b + 12, r + 46, 3.5)], 0.08, pan=0.2, cutoff=2200, vib=0.004)
        b += length
    kick, snare, hat = drum_kick(s.rng, 160, 0.3), drum_industrial(s.rng), drum_hat(s.rng, 0.03)
    rim = fft_filter(clank(s.rng, 1900, 0.25, 4000), "hp", 800, 0.7)
    for bar in range(32):
        b = bar * 4
        s.hits(kick, [b, b + 1, b + 2, b + 2.75, b + 3], 0.8)
        s.hits(hat, every(b, b + 4, 0.5), 0.07, pan=0.4)
        if bar >= 4:
            s.hits(snare, [b + 1, b + 3], 0.55)
            s.hits(rim, [b + 0.5, b + 2.5] if bar % 2 == 0 else [b + 1.5, b + 3.75], 0.35, pan=-0.35)
        if bar % 8 == 7:
            s.hits(snare, [b + 2.5, b + 3.25, b + 3.75], 0.4)
    return s.render(dict(rt60=1.0, wet=0.18, damp=4000), drive=1.6)

@music("music_extract")
def _():
    # extraction: slow pads that lean on major chords without resolving,
    # a low pulse, and a rising motif that arrives in the second half
    s = Song("music_extract", 66, 14)  # 50.9 s
    s.add(inst_drone(s.loop_freq(freq(midi("D1"))), s.length, s.rng, lo=100, hi=240, lfo=0.04), 0, 0.14)
    prog = [("D2", "m", 8), ("Bb1", "M", 8), ("F2", "M", 8), ("A2", "m", 8),
            ("D2", "m", 8), ("Bb1", "M", 8), ("C2", "M", 8), ("D2", "madd9", 8)]
    b = 0
    for root, q, length in prog:
        s.notes(inst_pad, [(b, n + 12, length) for n in chord(root, q)], 0.13, cutoff=900, attack=2.0, release=2.5, detune=10)
        s.notes(inst_bass, [(b, midi(root) - 12, length - 0.5)], 0.3, cutoff=170, release=1.0)
        b += length
    s.hits(drum_kick(s.rng, 110, 0.5), every(0, 56, 2), 0.32)
    motif = [(32, "D4", 2), (34, "F4", 2), (36, "A4", 2), (38, "C5", 3.5), (44, "D5", 2), (46, "F5", 2), (48, "A5", 4), (52, "G5", 3.5)]
    s.notes(inst_lead, motif, 0.11, pan=-0.1, cutoff=1700, vib=0.005)
    s.notes(inst_bell, [(6, "A4", 1), (22, "F4", 1), (30, "C5", 1), (54, "D5", 1)], 0.06, spread=0.5)
    s.add(widen(wind(s.length, s.rng, 500, 0.12, 0.25), 20, 0.8), 0, 0.05)
    return s.render(dict(rt60=3.5, wet=0.4, damp=3500))

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
