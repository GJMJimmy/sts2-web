"""Original score + sound design for the intro video, synthesized from scratch (numpy/scipy, no samples).
D minor, 120 BPM, one bar = 2 s; section and SFX timing comes from cues.json, shared with the visuals.
Usage: python score.py <out.wav> <audio.js>   (audio.js: per-frame loudness + kick times for the visuals)
"""
import json, sys
from pathlib import Path
import numpy as np
from scipy import signal

SR = 48000
C = json.loads((Path(__file__).parent / 'cues.json').read_text())
DUR = C['duration']
N = int(DUR * SR)
BEAT = 60 / C['bpm']
BAR = 4 * BEAT
rng = np.random.default_rng(20260930)

def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)

class Bus:
    def __init__(self): self.x = np.zeros((N, 2))
    def add(self, t, sig, pan=0.0, gain=1.0):
        i = int(round(t * SR))
        if sig.ndim == 1:
            a = (pan + 1) * np.pi / 4
            sig = np.stack([sig * np.cos(a), sig * np.sin(a)], 1)
        if i < 0: sig, i = sig[-i:], 0
        n = min(len(sig), N - i)
        if n > 0: self.x[i:i + n] += sig[:n] * gain

music, bass_bus, drums, fx, lead_bus = Bus(), Bus(), Bus(), Bus(), Bus()

def tt(n): return np.arange(n) / SR

def env(n, a=0.005, r=0.2, hold=None):
    """Linear attack, optional sustain `hold` seconds, then exponential release (time constant r)."""
    t = tt(n)
    e = np.minimum(1, t / max(a, 1e-4))
    if hold is not None:
        e = np.where(t > a + hold, np.exp(-(t - a - hold) / r), e)
    else:
        e = e * np.exp(-np.maximum(0, t - a) / r)
    return e

_tables = {}
def saw(freq, n, maxf=12000, phase=None):
    """Band-limited saw from a per-harmonic-count wavetable; `freq` may be an array (glides, vibrato)."""
    f0 = float(np.max(freq))
    K = max(1, min(64, int(maxf / f0)))
    if K not in _tables:
        ph = np.arange(4096) / 4096
        _tables[K] = sum(np.sin(2 * np.pi * k * ph) / k for k in range(1, K + 1)) * (2 / np.pi)
    tab = _tables[K]
    p = np.cumsum(np.broadcast_to(freq, (n,)) / SR) + (rng.random() if phase is None else phase)
    idx = (p % 1) * 4096
    i0 = idx.astype(int)
    fr = idx - i0
    return tab[i0] * (1 - fr) + tab[(i0 + 1) % 4096] * fr

def sine(freq, n, phase=0.0):
    return np.sin(2 * np.pi * (np.cumsum(np.broadcast_to(freq, (n,)) / SR)) + phase)

def lp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, min(fc, SR * 0.45), 'low', fs=SR, output='sos'), x, axis=0)

def hp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, 'high', fs=SR, output='sos'), x, axis=0)

def bp(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, min(hi, SR * 0.45)], 'band', fs=SR, output='sos'), x, axis=0)

def tv_filter(x, fcs, kind='low', block=256):
    """Time-varying 2nd-order filter (cutoff per block, state carried across blocks)."""
    y = np.zeros_like(x)
    zi = np.zeros((1, 2))
    for s in range(0, len(x), block):
        fc = float(np.clip(fcs[min(s, len(fcs) - 1)], 30, SR * 0.45))
        if kind == 'band':
            sos = signal.butter(1, [fc / 1.5, min(fc * 1.5, SR * 0.45)], 'band', fs=SR, output='sos')
        else:
            sos = signal.butter(2, fc, kind, fs=SR, output='sos')
        y[s:s + block], zi = signal.sosfilt(sos, x[s:s + block], zi=zi)
    return y

def noise(n): return rng.standard_normal(n)

def reverb(x, seconds=2.8, lpf=6500, predelay=0.02, seed=1):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = tt(n)
    ir = r.standard_normal((n, 2)) * np.exp(-t * 6.9 / seconds)[:, None]
    ir = lp(ir, lpf)
    ir[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))[:, None]
    ir = np.concatenate([np.zeros((int(predelay * SR), 2)), ir])
    ir /= np.sqrt(np.sum(ir ** 2) / 2)
    out = np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], 1)
    return out

def delay(x, sec, fb=0.35, mix=0.3, pingpong=True):
    d = int(sec * SR)
    y = x.copy()
    tap = x.copy()
    for k in range(1, 6):
        tap = np.roll(tap, d, axis=0); tap[:d] = 0
        tap = tap * fb
        if pingpong: tap = tap[:, ::-1]
        y += tap * (mix / fb)
    return y

# ── harmony ─────────────────────────────────────────────────────────────────────────────────────────────────────────
V = {'Dm': [50, 53, 57, 62], 'Bb': [46, 53, 58, 62], 'F': [48, 53, 57, 60], 'C': [48, 52, 55, 60],
     'Gm': [50, 55, 58, 62], 'A': [49, 52, 57, 61]}
ROOT = {'Dm': 38, 'Bb': 34, 'F': 41, 'C': 36, 'Gm': 43, 'A': 33}
PROG = [None, None, 'Dm', 'Bb', 'Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'Gm', 'A',
        'Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'] + ['Dm', 'Bb', 'F', 'C'] * 3 + \
       ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'Gm', 'A', 'Dm', 'Dm', 'Dm', 'Dm']
assert len(PROG) == DUR / BAR
def bar_t(b): return b * BAR

# ── instruments ─────────────────────────────────────────────────────────────────────────────────────────────────────
def pad_chord(t, dur, notes, cutoff, gain=0.08, attack=0.35, release=1.2, voices=5, detune=0.14):
    n = int((dur + release * 3) * SR)
    e = env(n, attack, release, hold=dur - attack)
    for m in notes:
        for v in range(voices):
            d = (v - (voices - 1) / 2) / ((voices - 1) / 2) * detune
            s = saw(mtof(m + d), n, maxf=cutoff * 2.5)
            s = lp(s, cutoff)
            music.add(t, s * e, pan=0.7 * (v / (voices - 1) * 2 - 1), gain=gain * 1.3 / voices ** 0.5)

def pluck(t, m, gain=0.06, pan=0.0, decay=0.22, bright=1.0, bus=None):
    n = int((decay * 5) * SR)
    tv = tt(n)
    f = mtof(m)
    out = np.zeros(n)
    for k in range(1, int(min(40, 14000 / f)) + 1):
        out += np.sin(2 * np.pi * k * f * tv) / k * np.exp(-tv * (1 / decay + (k - 1) * 9 / bright))
    out *= np.minimum(1, tv / 0.002)
    (bus or music).add(t, out, pan=pan, gain=gain * 1.4)

def bell(t, m, gain=0.08, pan=0.0, decay=2.2, ratio=3.5, index=2.2):
    n = int(decay * 4 * SR)
    tv = tt(n)
    f = mtof(m)
    I = index * np.exp(-tv / (decay * 0.3))
    s = np.sin(2 * np.pi * f * tv + I * np.sin(2 * np.pi * f * ratio * tv))
    s += 0.3 * np.sin(2 * np.pi * f * 2.0 * tv) * np.exp(-tv / (decay * 0.4))
    s *= np.exp(-tv / decay) * np.minimum(1, tv / 0.003)
    fx.add(t, s, pan=pan, gain=gain)

def kick(t, gain=0.9, tone=1.0, bus=None):
    n = int(0.5 * SR)
    tv = tt(n)
    f = 44 + 120 * tone * np.exp(-tv * 32)
    s = sine(f, n) * np.exp(-tv * 7.5)
    s = np.tanh(s * 1.6)
    click = hp(noise(n), 3000) * np.exp(-tv * 300) * 0.25
    (bus or drums).add(t, s + click, gain=gain)

def clap(t, gain=0.35, pan=0.0):
    n = int(0.35 * SR)
    tv = tt(n)
    e = sum(np.exp(-np.maximum(0, tv - o) * 90) * (tv >= o) for o in (0, 0.011, 0.023))
    e += 0.5 * np.exp(-np.maximum(0, tv - 0.03) * 14) * (tv >= 0.03)
    s = bp(noise(n), 900, 2600) * e
    drums.add(t, s, pan=pan, gain=gain * 1.3)

def snare(t, gain=0.3, pan=0.0, length=0.18):
    n = int(length * 2 * SR)
    tv = tt(n)
    s = bp(noise(n), 1200, 8000) * np.exp(-tv / (length * 0.45)) + 0.6 * sine(185 * (1 + 0.4 * np.exp(-tv * 40)), n) * np.exp(-tv * 22)
    drums.add(t, s, pan=pan, gain=gain)

def hat(t, gain=0.08, open_=False, pan=0.25):
    gain *= 1.5
    n = int((0.35 if open_ else 0.06) * SR)
    tv = tt(n)
    s = hp(noise(n), 7500, 4) * np.exp(-tv * (9 if open_ else 70))
    drums.add(t, s, pan=pan, gain=gain)

def tom(t, gain=0.5, f0=95, pan=0.0):
    n = int(0.9 * SR)
    tv = tt(n)
    s = sine(f0 * (1 + 0.8 * np.exp(-tv * 25)), n) * np.exp(-tv * 5) + bp(noise(n), 200, 1200) * np.exp(-tv * 30) * 0.3
    drums.add(t, np.tanh(s * 1.4), pan=pan, gain=gain)

def bass_note(t, m, dur, gain=0.32, cutoff=420, drive=1.8):
    n = int((dur + 0.08) * SR)
    e = env(n, 0.004, 0.05, hold=dur - 0.004)
    f = mtof(m)
    s = lp(saw(f, n, maxf=3000) + saw(f * 1.006, n, maxf=3000), cutoff) * 0.6 + sine(f, n) * 0.8
    bass_bus.add(t, np.tanh(s * drive) * e, gain=gain * 0.7)

def sub(t, m, dur, gain=0.35):
    n = int((dur + 0.4) * SR)
    bass_bus.add(t, sine(mtof(m), n) * env(n, 0.05, 0.25, hold=dur - 0.05), gain=gain * 0.75)

def lead_note(t, m, dur, gain=0.085):
    n = int((dur + 0.35) * SR)
    tv = tt(n)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * tv) * np.clip((tv - 0.15) / 0.25, 0, 1)
    f = mtof(m) * vib
    s = saw(f, n, maxf=9000) + saw(f * 1.004, n, maxf=9000) * 0.8 + saw(f * 0.5, n, maxf=6000) * 0.35
    s = lp(s, 5200)
    lead_bus.add(t, s * env(n, 0.012, 0.12, hold=dur - 0.012), gain=gain * 1.3)

def impact(t, strength=1.0):
    n = int(3.5 * SR)
    tv = tt(n)
    boom = np.tanh(sine(30 + 55 * np.exp(-tv * 7), n) * np.exp(-tv * 1.3) * 2.2)
    fx.add(t, boom, gain=0.4 * strength)
    crack = hp(noise(int(0.08 * SR)), 1800) * np.exp(-tt(int(0.08 * SR)) * 60)
    fx.add(t, crack, gain=0.35 * strength)
    crash = bp(noise(n), 350, 9000) * np.exp(-tv * 1.6) * np.minimum(1, tv / 0.004)
    fx.add(t, np.stack([crash, np.roll(crash, 311)], 1), gain=0.16 * strength)
    tom(t, 0.45 * strength, 70)

def whoosh(t_land, length=0.8, gain=0.22, up=True):
    n = int(length * 1.4 * SR)
    tv = tt(n)
    k = tv / length
    e = np.where(k < 1, k ** 2.2, np.exp(-(k - 1) * 9))
    fc = 400 * (12 ** np.clip(k, 0, 1.2)) if up else 5000 / (8 ** np.clip(k, 0, 1.2))
    s = tv_filter(noise(n), fc, 'band') * e
    pan = np.clip(-0.8 + 1.6 * k, -1, 1)
    a = (pan + 1) * np.pi / 4
    fx.add(t_land - length, np.stack([s * np.cos(a), s * np.sin(a)], 1), gain=gain)

def reverse_swell(t_land, length=3.0, gain=0.25):
    n = int(length * SR)
    tv = tt(n)
    s = bp(noise(n), 300, 7000) * np.exp(-tv * 1.8)
    s = reverb(np.stack([s, s], 1), 2.0, 5000, seed=3)[::-1]
    fx.add(t_land - length, s, gain=gain)

def riser(t0, t1, gain=0.22):
    n = int((t1 - t0) * SR)
    k = tt(n) / (t1 - t0)
    fc = 250 * (40 ** k)
    s = tv_filter(noise(n), fc, 'band') * (k ** 2.5)
    tone = sine(180 * (8 ** k), n) * (k ** 3) * 0.25 + sine(270 * (8 ** k), n) * (k ** 3) * 0.12
    fx.add(t0, np.stack([s + tone, np.roll(s, 97) + tone], 1), gain=gain)

def tick(t, f=2400, gain=0.05, pan=0.0):
    n = int(0.03 * SR)
    tv = tt(n)
    fx.add(t, np.sin(2 * np.pi * f * tv) * np.exp(-tv * 180), pan=pan, gain=gain)

def pop(t, gain=0.14, pan=0.0):
    n = int(0.12 * SR)
    tv = tt(n)
    s = sine(1300 * np.exp(-tv * 18) + 500, n) * np.exp(-tv * 35)
    fx.add(t, s, pan=pan, gain=gain)

def type_click(t, gain=0.1):
    n = int(0.02 * SR)
    tv = tt(n)
    s = bp(noise(n), 2500, 7000) * np.exp(-tv * 400) + 0.3 * np.sin(2 * np.pi * 1800 * tv) * np.exp(-tv * 250)
    fx.add(t, s, pan=float(rng.uniform(-0.3, 0.3)), gain=gain)

def glitch(t, length=0.16, gain=0.16):
    n = int(length * SR)
    out = np.zeros(n)
    s = 0
    while s < n:
        seg = int(rng.uniform(0.008, 0.03) * SR)
        f = rng.choice([110, 220, 440, 880, 1760, 3520]) * rng.uniform(0.9, 1.1)
        tv = tt(seg)
        wave = np.sign(np.sin(2 * np.pi * f * tv)) if rng.random() < 0.6 else np.round(noise(seg) * 3) / 3
        out[s:s + seg] = wave[: n - s] * rng.uniform(0.3, 1)
        s += seg
    fx.add(t, lp(out, 9000), pan=float(rng.uniform(-0.5, 0.5)), gain=gain)

# ── arrangement ─────────────────────────────────────────────────────────────────────────────────────────────────────
# drone: bars 0-7, fading out under the groove
n = int(18 * SR)
tv = tt(n)
dr = sine(mtof(26), n) * 0.3 + lp(saw(mtof(38), n, maxf=1500) + saw(mtof(38) * 1.003, n, maxf=1500), 320) * 0.6 + lp(saw(mtof(45), n, maxf=1500), 400) * 0.25
dr *= np.minimum(1, tv / 3.0) * np.clip((18 - tv) / 6, 0, 1) * (1 + 0.15 * np.sin(2 * np.pi * 0.25 * tv))
music.add(0, np.stack([dr, np.roll(dr, 240)], 1), gain=0.16)
reverse_swell(4.0, 3.5, 0.3)

cut = lambda b: 3200 if 24 <= b < 36 else 900 if b < 4 else 1500 if b < 8 else 2000 if b < 22 else 1300 if b >= 36 else 2200
for b, ch in enumerate(PROG):
    if ch is None: continue
    t0 = bar_t(b)
    if b >= 44:
        if b == 44:
            pad_chord(t0, 5.5, [38, 50, 57, 62, 64, 65, 69], 2400, gain=0.085, attack=0.01, release=1.6)
        continue
    if 22 <= b < 24:  # riser: the chords swell open
        pad_chord(t0, BAR, V[ch], 1200 + (b - 22) * 1500, gain=0.09, attack=0.6)
        continue
    pad_chord(t0, BAR, V[ch] + ([V[ch][0] + 12] if 24 <= b < 36 else []), cut(b), gain=0.075 if 24 <= b < 36 else 0.07)

# title bells (bar 2) and outro bells (bar 44)
for i, (m, dt) in enumerate([(74, 0), (81, 0.02), (86, 0.05), (89, 0.08)]):
    bell(4.0 + dt, m, gain=0.05, pan=(i - 1.5) * 0.35, decay=2.8)
for i, m in enumerate([74, 77, 81, 86, 88]):
    bell(88.0 + i * 0.09, m, gain=0.05, pan=(i - 2) * 0.3, decay=3.2)
for i, m in enumerate([69, 73, 76, 81, 85]):  # success chime over A
    bell(C['chime'] + i * 0.07, m, gain=0.045, pan=(i - 2) * 0.3, decay=1.8)

# arp: bars 4-21 and 24-41 (16ths, chord tones two octaves up)
ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 3, 1, 2]
for b, ch in enumerate(PROG):
    if ch is None or not (4 <= b < 22 or 24 <= b < 42): continue
    tones = sorted(V[ch])[1:] + [V[ch][1] + 12]
    for s in range(16):
        m = tones[ARP[s] % 4] + 24
        acc = 1.0 if s % 4 == 0 else 0.7
        g = 0.035 if b < 8 else 0.05 if b < 24 else 0.045 if b < 36 else 0.04
        pluck(bar_t(b) + s * BEAT / 4, m, gain=g * acc, pan=0.45 * (1 if s % 2 else -1), decay=0.16 if b >= 24 else 0.2, bright=1.4 if b >= 24 else 0.8)

# drums & bass
kicks = []
for b, ch in enumerate(PROG):
    t0 = bar_t(b)
    if 4 <= b < 8:
        kick(t0, 0.55); kicks.append(t0)
        sub(t0, ROOT[ch], BAR - 0.05, 0.28)
        for e in range(8): hat(t0 + e * BEAT / 2 + BEAT / 4, 0.03, pan=0.3)
    elif 8 <= b < 22:
        for bt in (0, 2.5): kick(t0 + bt * BEAT, 0.8); kicks.append(t0 + bt * BEAT)
        snare(t0 + 2 * BEAT, 0.22 if b < 18 else 0.26)
        for e in range(8): hat(t0 + e * BEAT / 2, 0.05 if e % 2 else 0.03)
        for e in range(8): bass_note(t0 + e * BEAT / 2, ROOT[ch] + (12 if e in (3, 6) else 0), BEAT / 2 * 0.8, 0.2, cutoff=380)
    elif 22 <= b < 24:  # riser: accelerating snare roll, cut before the drop
        steps = 8 if b == 22 else 16
        for s in range(steps):
            tt_ = t0 + s * BAR / steps
            if tt_ < 47.7: snare(tt_, 0.08 + 0.2 * ((tt_ - 44) / 4), length=0.1)
        if b == 23:
            for s in range(8): snare(t0 + 1.0 + s * 0.0625, 0.25 + s * 0.02, length=0.08)
        sub(t0, ROOT[ch], BAR - 0.3, 0.2)
    elif 24 <= b < 36:
        for q in range(4): kick(t0 + q * BEAT, 0.95, 1.1); kicks.append(t0 + q * BEAT)
        clap(t0 + BEAT, 0.33); clap(t0 + 3 * BEAT, 0.33)
        for e in range(8):
            hat(t0 + e * BEAT / 2 + BEAT / 4, 0.055, open_=(e % 2 == 1), pan=0.3)
            hat(t0 + e * BEAT / 2, 0.03, pan=-0.3)
        for e in range(8):
            m = ROOT[ch] + (12 if e % 2 else 0)
            bass_note(t0 + e * BEAT / 2 + 0.02, m, BEAT / 2 * 0.7, 0.26, cutoff=650, drive=2.4)
        if b in (27, 31, 35):
            for s in range(4): snare(t0 + 3 * BEAT + s * BEAT / 4, 0.12 + s * 0.04, length=0.1)
    elif 36 <= b < 42:
        kick(t0, 0.6); kick(t0 + 2.5 * BEAT, 0.5); kicks += [t0, t0 + 2.5 * BEAT]
        snare(t0 + 2 * BEAT, 0.14)
        for e in range(8): hat(t0 + e * BEAT / 2 + BEAT / 4, 0.03)
        sub(t0, ROOT[ch], BAR - 0.05, 0.3)
    elif 42 <= b < 44:  # build to the finale
        for e in range(8): kick(t0 + e * BEAT / 2, 0.55 + 0.05 * e); kicks.append(t0 + e * BEAT / 2)
        for s in range(16 if b == 42 else 32): snare(t0 + s * BAR / (16 if b == 42 else 32), 0.07 + 0.012 * s * (1 if b == 42 else 0.5), length=0.08)
        for e in range(8): bass_note(t0 + e * BEAT / 2, ROOT[ch], BEAT / 2 * 0.8, 0.22, cutoff=500)
    elif b == 44:
        kick(t0, 1.0); kicks.append(t0)
        sub(t0, 38, 6.0, 0.35)
riser(*C['riser'], gain=0.2)
riser(84.0, 88.0, gain=0.12)

# lead hook: bars 28-35 (two passes, the second an octave-doubled)
HOOK = [(62, 1.5), (65, 0.5), (69, 1), (67, 0.5), (65, 0.5),
        (65, 1.5), (62, 0.5), (58, 1), (60, 0.5), (62, 0.5),
        (60, 1.5), (65, 0.5), (69, 1), (72, 1),
        (70, 1), (69, 1), (67, 1), (64, 1)]
for rep, b0 in enumerate((28, 32)):
    t = bar_t(b0)
    hook = HOOK if rep == 0 else HOOK[:-4] + [(70, 1), (69, 1), (67, 0.5), (69, 0.5), (74, 1)]
    for m, beats in hook:
        lead_note(t, m + 12, beats * BEAT * 0.92)
        if rep == 1: lead_note(t, m + 24, beats * BEAT * 0.92, gain=0.035)
        t += beats * BEAT

# sound design cues
for t, s in C['impacts']: impact(t, s)
for t in C['whooshes']: whoosh(t, 0.9, 0.2)
for t in C['cuts']: whoosh(t, 0.35, 0.1); tom(t, 0.18, 110)
for t in C['glitches']: glitch(t)
for i, t in enumerate(C['pops']): pop(t, pan=(i % 3 - 1) * 0.4)
for t in C['slices']: whoosh(t, 0.3, 0.16); tom(t, 0.3, 80 + 12 * C['slices'].index(t))
for a, b in C['typing']:
    t = a
    while t < b:
        type_click(t)
        t += rng.uniform(0.045, 0.11)
for a, b in C['ticks']:
    k = 0
    t = a
    while t < b:
        x = (t - a) / (b - a)
        tick(t, 1800 + 1600 * x, 0.045, pan=0.3 * (1 if k % 2 else -1))
        t += 0.035 + 0.09 * x ** 2
        k += 1

# ── mix ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
tvec = tt(N)
duck = np.ones(N)
for k in kicks:  # sidechain from every kick
    i = int(k * SR)
    m = min(N - i, int(0.4 * SR))
    duck[i:i + m] = np.minimum(duck[i:i + m], 1 - 0.55 * np.exp(-tt(m) / 0.09))
music.x *= duck[:, None]
bass_bus.x *= (0.35 + 0.65 * duck)[:, None]
lead = delay(lead_bus.x, BEAT * 0.75, fb=0.3, mix=0.25)
wet_music = reverb(music.x + lead * 0.6, 3.2, 6000, seed=5)
wet_fx = reverb(fx.x, 2.6, 7000, seed=7)
wet_dr = reverb(drums.x, 0.9, 7000, seed=9)
mix = (music.x + wet_music * 0.35 + lead + bass_bus.x + drums.x + wet_dr * 0.12 + fx.x + wet_fx * 0.3)
mix = hp(mix, 30)
mix = mix + 0.45 * hp(mix, 3500)  # gentle high shelf
# fade out the tail
mix *= np.clip((DUR - tvec) / 4.0, 0, 1)[:, None] ** 1.5
mix = np.tanh(mix * 1.1) / np.tanh(1.1)
mix /= np.max(np.abs(mix)) / 0.89

from scipy.io import wavfile
wavfile.write(sys.argv[1], SR, (mix * 32767).astype(np.int16))

# per-frame loudness (60 fps) and kick times for the visuals
hop = SR // 60
mono = np.abs(mix).mean(1)
rms = np.sqrt(np.convolve(mono ** 2, np.ones(hop) / hop, 'same')[::hop])
rms = (rms / rms.max()).round(3).tolist()
Path(sys.argv[2]).write_text('window.AUDIO=' + json.dumps({'rms': rms, 'kicks': sorted(round(k, 3) for k in kicks)}) + ';\n')
print('wrote', sys.argv[1], f'{DUR}s, peak-normalized; kicks={len(kicks)}')
