"""LRWeb promo soundtrack — every sound synthesised from scratch with numpy.

120 BPM, one chord per bar (2 s). Ab major, vi-IV-I-V (Fm Db Ab Eb), resolving to Ab on the end card.
Section markers (seconds) match timeline.js exactly, so every cut in the video lands on a hit.

    python3 music.py            -> soundtrack.wav (44.1 kHz stereo, 42 s)
"""
import json, os
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT
DUR = 42.0
N = int(DUR * SR)
rng = np.random.default_rng(7)
HERE = os.path.dirname(os.path.abspath(__file__))
EV = json.load(open(os.path.join(HERE, 'events.json')))


# ---------------------------------------------------------------- helpers
def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)

NOTE = {'C': 0, 'Db': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'Gb': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11}
def nm(s):  # 'Ab4' -> midi
    name, octv = s[:-1], int(s[-1])
    return NOTE[name] + 12 * (octv + 1)

def tt(n):
    return np.arange(n) / SR

def env_adsr(n, a=0.005, d=0.1, s=0.7, r=0.1):
    t = tt(n)
    dur = n / SR
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel_start = max(dur - r, 0)
    e = e * np.clip((dur - t) / max(r, 1e-6), 0, 1) if r > 0 else e
    return e

def polyblep_saw(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    dt = f / SR
    ph = (phase0 + np.cumsum(dt)) % 1.0
    y = 2 * ph - 1
    # polyBLEP correction
    m1 = ph < dt
    x = ph[m1] / dt[m1]
    y[m1] -= x + x - x * x - 1
    m2 = ph > 1 - dt
    x = (ph[m2] - 1) / dt[m2]
    y[m2] -= x * x + x + x + 1
    return y

def square(freq, n, duty=0.5):
    ph = (np.cumsum(np.broadcast_to(freq, (n,)) / SR)) % 1.0
    return np.where(ph < duty, 1.0, -1.0)

def lp(x, fc, order=2):
    sos = butter(order, min(fc, SR * 0.45), 'low', fs=SR, output='sos')
    return sosfilt(sos, x, axis=0)

def hp(x, fc, order=2):
    sos = butter(order, fc, 'high', fs=SR, output='sos')
    return sosfilt(sos, x, axis=0)

def bp(x, lo, hi, order=2):
    sos = butter(order, [lo, hi], 'band', fs=SR, output='sos')
    return sosfilt(sos, x, axis=0)

def lp_sweep(x, fc_curve, block=256):
    """time-varying 2-pole low-pass (block-wise, state carried)."""
    y = np.zeros_like(x)
    zi = np.zeros((1, 2)) if x.ndim == 1 else np.zeros((1, 2, x.shape[1]))
    for i in range(0, len(x), block):
        fc = float(np.clip(fc_curve[min(i, len(fc_curve) - 1)], 30, SR * 0.45))
        sos = butter(2, fc, 'low', fs=SR, output='sos')
        y[i:i + block], zi = sosfilt(sos, x[i:i + block], axis=0, zi=zi)
    return y

def place(buf, sig, t0, gain=1.0):
    i = int(round(t0 * SR))
    if i >= len(buf):
        return
    if i < 0:
        sig = sig[-i:]; i = 0
    j = min(len(buf), i + len(sig))
    buf[i:j] += gain * sig[: j - i]

def pan(sig, p):  # p in [-1,1]
    l = np.cos((p + 1) * np.pi / 4); r = np.sin((p + 1) * np.pi / 4)
    return np.stack([sig * l, sig * r], axis=1)

def stereo(n):
    return np.zeros((n, 2))

def reverb_ir(seconds=2.6, predelay=0.02, bright=6000):
    n = int(seconds * SR)
    t = tt(n)
    ir = rng.standard_normal((n, 2)) * np.exp(-t / (seconds / 6.5))[:, None]
    ir = lp(ir, bright)
    ir[: int(predelay * SR)] = 0
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    return ir

IR = reverb_ir()
IR_BIG = reverb_ir(4.5, 0.03, 5000)

def reverb(x, wet=0.3, ir=IR):
    w = np.stack([fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], axis=1)
    return x * (1 - wet * 0.3) + w * wet

def pingpong(x, time=BEAT * 0.75, fb=0.45, taps=6, tone=4000):
    y = x.copy()
    d = int(time * SR)
    src = lp(x, tone)
    for k in range(1, taps + 1):
        g = fb ** k
        shifted = np.zeros_like(x)
        shifted[d * k:] = src[: len(x) - d * k]
        if k % 2:  # swap channels for ping-pong
            shifted = shifted[:, ::-1]
        y += g * shifted
    return y


# ---------------------------------------------------------------- arrangement
CYCLE = ['Fm', 'Db', 'Ab', 'Eb']
CHORDS = {
    'Fm': ['F3', 'Ab3', 'C4', 'F4'],
    'Db': ['Db3', 'F3', 'Ab3', 'Db4'],
    'Ab': ['Eb3', 'Ab3', 'C4', 'Eb4'],
    'Eb': ['Eb3', 'G3', 'Bb3', 'Eb4'],
}
ROOT = {'Fm': 'F1', 'Db': 'Db2', 'Ab': 'Ab1', 'Eb': 'Eb2'}

def chord_at_bar(b):
    if b in (16,):
        return 'Db'
    if b == 17:
        return 'Eb'
    if b >= 18:
        return 'Ab'
    return CYCLE[b % 4]

# sections (seconds)
S = EV['sections']
DROP1, TAPE, LOFI, DROP2, BREAK, FINAL = S['drop1'], S['tapestop'], S['lofi'], S['drop2'], S['breakdown'], S['final']

def in_drop(t):
    return (DROP1 <= t < TAPE) or (DROP2 <= t < BREAK)


# ---------------------------------------------------------------- instruments
def kick(len_s=0.45, punch=1.0):
    n = int(len_s * SR); t = tt(n)
    f = 45 + 110 * np.exp(-t / 0.035) + 40 * np.exp(-t / 0.006)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.28)
    click = hp(rng.standard_normal(n) * np.exp(-t / 0.004), 2000) * 0.35
    return np.tanh((body + click * punch) * 1.6)

def clap():
    n = int(0.35 * SR); t = tt(n)
    noise = rng.standard_normal(n)
    e = np.zeros(n)
    for k, off in enumerate([0, 0.011, 0.022]):
        i = int(off * SR)
        e[i:] += np.exp(-(t[: n - i]) / 0.006) * (0.8 if k < 2 else 1)
    e += np.exp(-t / 0.12) * 0.45
    return bp(noise * e, 900, 5200) * 1.4

def hat(open_=False):
    n = int((0.22 if open_ else 0.05) * SR); t = tt(n)
    x = hp(rng.standard_normal(n), 7000, 4) * np.exp(-t / (0.07 if open_ else 0.012))
    return x

def snare():
    n = int(0.25 * SR); t = tt(n)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05)
    nz = bp(rng.standard_normal(n), 1500, 9000) * np.exp(-t / 0.09)
    return tone * 0.5 + nz

def pluck(freq, len_s, bright=1.0):
    n = int(len_s * SR); t = tt(n)
    x = polyblep_saw(freq * 1.003, n) + polyblep_saw(freq * 0.997, n, 0.3)
    fc = 600 + 5200 * bright * np.exp(-t / 0.09)
    x = lp_sweep(x, fc, block=128)
    return x * np.exp(-t / 0.22) * 0.5

def supersaw(freq, n, voices=7, spread=0.012):
    x = np.zeros(n)
    for v in range(voices):
        det = 1 + spread * (v - (voices - 1) / 2) / ((voices - 1) / 2)
        x += polyblep_saw(freq * det, n, rng.random())
    return x / voices

def pad_chord(names, len_s, voices=7):
    n = int(len_s * SR)
    L = np.zeros(n); R = np.zeros(n)
    for k, s in enumerate(names):
        f = midi(nm(s))
        L += supersaw(f, n, voices, 0.014)
        R += supersaw(f, n, voices, 0.017)
    e = env_adsr(n, a=0.08, d=0.6, s=0.85, r=0.25)
    return np.stack([L * e, R * e], axis=1) / len(names)

def sub_boom(len_s=2.4):
    n = int(len_s * SR); t = tt(n)
    f = 32 + 90 * np.exp(-t / 0.18)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)

def crash(len_s=3.0):
    n = int(len_s * SR); t = tt(n)
    x = hp(rng.standard_normal((n, 2)), 4000, 2) * np.exp(-t / 0.8)[:, None]
    return x * 0.6

def noise_riser(len_s, f0=300, f1=9000, curve=2.0):
    n = int(len_s * SR); t = tt(n)
    p = (t / len_s) ** curve
    x = rng.standard_normal((n, 2))
    fc = f0 * (f1 / f0) ** p
    x = lp_sweep(x, fc, block=256)
    return x * p[:, None] ** 1.2

def whoosh(len_s=0.7, rev=False):
    n = int(len_s * SR); t = tt(n)
    p = t / len_s
    shape = np.sin(np.pi * p) ** 2
    x = rng.standard_normal((n, 2))
    fc = 400 + 7000 * shape
    x = lp_sweep(x, fc, 256) * shape[:, None]
    # stereo sweep L->R
    x[:, 0] *= np.cos(p * np.pi / 2) + 0.3
    x[:, 1] *= np.sin(p * np.pi / 2) + 0.3
    return x[::-1] if rev else x

def chime(freq, len_s=1.2):
    n = int(len_s * SR); t = tt(n)
    x = (np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t / 0.08)
         + 0.2 * np.sin(2 * np.pi * freq * 4.1 * t) * np.exp(-t / 0.04))
    return x * np.exp(-t / 0.35) * np.minimum(t / 0.002, 1)

def blip_error(len_s=0.22):
    n = int(len_s * SR); t = tt(n)
    f = np.where(t < 0.09, 880, 587)
    return square(f, n, 0.3) * np.exp(-t / 0.12) * 0.6

def keyclick():
    n = int(0.03 * SR); t = tt(n)
    return hp(rng.standard_normal(n), 3000) * np.exp(-t / 0.004) + np.sin(2 * np.pi * 1800 * t) * np.exp(-t / 0.006) * 0.3

def tick():
    n = int(0.04 * SR); t = tt(n)
    return np.sin(2 * np.pi * 3200 * t) * np.exp(-t / 0.008) + hp(rng.standard_normal(n), 5000) * np.exp(-t / 0.003) * 0.4

def bloop(up=True):
    n = int(0.16 * SR); t = tt(n)
    f = 600 + (500 if up else -200) * (t / 0.16)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.05) * np.minimum(t / 0.003, 1)

def stamp():
    n = int(0.5 * SR); t = tt(n)
    body = np.sin(2 * np.pi * np.cumsum(70 + 80 * np.exp(-t / 0.02)) / SR) * np.exp(-t / 0.12)
    slap = bp(rng.standard_normal(n), 300, 3000) * np.exp(-t / 0.03)
    return body + slap * 0.6


# ---------------------------------------------------------------- stems
drums = stereo(N)
bass = stereo(N)
pads = stereo(N)
arp = stereo(N)
lead = stereo(N)
fx = stereo(N)
chip = stereo(N)
kick_times = []

nbars = int(DUR / BAR) + 1

# --- drums
for b in range(nbars):
    for q in range(4):
        t = b * BAR + q * BEAT
        if in_drop(t):
            place(drums, pan(kick(), 0), t, 0.95); kick_times.append(t)
            if q in (1, 3):
                place(drums, pan(clap(), 0), t, 0.42)
            place(drums, pan(hat(True), 0.25), t + BEAT / 2, 0.16)
            for s in range(4):
                if s != 2:
                    place(drums, pan(hat(), -0.3), t + s * BEAT / 4, 0.07 + 0.03 * (s == 1))
        elif 4.0 <= t < 7.5:  # filtered intro kick
            k = lp(kick(), 400)
            place(drums, pan(k, 0), t, 0.3); kick_times.append(t)

# build-up snare roll 4 -> 7.75 (8ths, 16ths, 32nds)
def roll(t0, t1, gain0, gain1):
    t = t0
    while t < t1 - 1e-6:
        p = (t - t0) / (t1 - t0)
        rate = BEAT / 2 if p < 0.4 else (BEAT / 4 if p < 0.8 else BEAT / 8)
        place(drums, pan(snare(), 0.1), t, gain0 + (gain1 - gain0) * p)
        t += rate

roll(4.0, 7.75, 0.05, 0.45)
roll(BREAK + 2.0, FINAL - 0.25, 0.04, 0.4)

# --- bass: offbeat pluck on root in drops, sustained sub in intro/breakdown
for b in range(nbars):
    t0 = b * BAR
    root = midi(nm(ROOT[chord_at_bar(b)]))
    for e in range(8):
        t = t0 + e * BEAT / 2
        if in_drop(t) and e % 2 == 1:
            n = int(BEAT / 2 * 0.95 * SR); tq = tt(n)
            x = polyblep_saw(root * 2, n) * 0.6 + np.sin(2 * np.pi * root * tq) * 1.0
            x = lp_sweep(x, 250 + 1400 * np.exp(-tq / 0.06), 128) * env_adsr(n, 0.004, 0.12, 0.6, 0.03)
            place(bass, pan(x, 0), t, 0.55)
    if (2 * BAR <= t0 < DROP1) or (BREAK <= t0 < FINAL):
        n = int(BAR * SR); tq = tt(n)
        x = np.sin(2 * np.pi * root * tq) * env_adsr(n, 0.05, 0.5, 0.9, 0.1)
        place(bass, pan(x, 0), t0, 0.16)

# final sub + chord
place(bass, pan(sub_boom(4.5), 0), FINAL, 0.9)
place(bass, pan(sub_boom(2.4), 0), DROP1, 0.9)
place(bass, pan(sub_boom(1.6), 0), DROP2, 0.55)

# --- pads (whole piece except lo-fi bar), sweep filter in intro
for b in range(nbars):
    t0 = b * BAR
    if LOFI <= t0 < DROP2 or t0 >= FINAL:
        continue
    names = CHORDS[chord_at_bar(b)]
    p = pad_chord(names, BAR + 0.25)
    place(pads, p, t0, 0.5)
fc = np.full(N, 7000.0)
ti = tt(N)
fc = np.where(ti < DROP1, 300 * (5500 / 300) ** np.clip(ti / DROP1, 0, 1) ** 1.6, fc)
fc = np.where((ti >= BREAK) & (ti < FINAL), 1200 + 4800 * ((ti - BREAK) / (FINAL - BREAK)) ** 2, fc)
pads = lp_sweep(pads, fc, 512)

# final big chord (Ab major, wide)
fin = pad_chord(['Ab2', 'Eb3', 'Ab3', 'C4', 'Eb4', 'Ab4', 'C5'], 6.5, 9)
tf = tt(len(fin))
fin *= np.exp(-tf / 3.2)[:, None]
place(pads, lp(fin, 6500), FINAL, 2.6)

# --- arp: 16th plucks cycling chord tones
for b in range(nbars):
    t0 = b * BAR
    if t0 >= FINAL or LOFI <= t0 < DROP2:
        continue
    ns = [nm(s) + 12 for s in CHORDS[chord_at_bar(b)]]
    pattern = [0, 1, 2, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2]
    for s in range(16):
        t = t0 + s * BEAT / 4
        if t < BAR:  # arp enters bar 1
            continue
        bright = 0.35 + 0.65 * min(1, t / DROP1) if t < DROP1 else 1.0
        g = 0.14 if t < DROP1 else 0.2
        if BREAK <= t < FINAL:
            g = 0.16
        nn = ns[pattern[s]] + (12 if s % 8 == 7 else 0)
        place(arp, pan(pluck(midi(nn), 0.3, bright), -0.35 if s % 2 else 0.35), t, g)
arp = pingpong(arp)

# final sparkle: rising Ab-major pluck run on the logo, with long delay tail
for k, note in enumerate(['Eb5', 'Ab5', 'C6', 'Eb6', 'Ab6']):
    place(arp, pan(pluck(midi(nm(note)), 0.6, 1.0), -0.5 + k * 0.25), FINAL + 0.5 + k * BEAT / 4, 0.22)

# --- lead hook (drops): supersaw lead, one 4-bar phrase
HOOK = [  # (beat offset within 4-bar phrase, note, beats)
    (0, 'C5', 1.5), (1.5, 'Eb5', 0.5), (2, 'F5', 1), (3, 'Eb5', 1),
    (4, 'F5', 1.5), (5.5, 'Eb5', 0.5), (6, 'C5', 2),
    (8, 'C5', 1), (9, 'Eb5', 1), (10, 'Ab5', 1.5), (11.5, 'G5', 0.5),
    (12, 'G5', 1), (13, 'F5', 1), (14, 'Eb5', 1), (15, 'Bb4', 1),
]

def lead_note(freq, beats):
    n = int((beats * BEAT) * SR); t = tt(n)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.15) / 0.2, 0, 1)
    x = supersaw(freq * vib, n, 5, 0.01) + 0.5 * polyblep_saw(freq * 2 * vib, n)
    x = lp(x, 5200) * env_adsr(n, 0.01, 0.25, 0.75, 0.05)
    return x

def lead_phrase(t0, oct_=0, gain=0.23, bars=4):
    for off, note, beats in HOOK:
        if off >= bars * 4:
            continue
        f = midi(nm(note) + 12 * oct_)
        x = lead_note(f, beats)
        place(lead, pan(x, -0.15), t0 + off * BEAT, gain)
        place(lead, pan(x, 0.15), t0 + off * BEAT + 0.012, gain * 0.8)

# drop1 bars 4..10 (Fm Db Ab Eb Fm Db Ab) -> phrase at 8, and first 3 bars at 16
lead_phrase(DROP1)
lead_phrase(DROP1 + 4 * BAR, bars=3)
# drop2 bars 12..15 with octave double
lead_phrase(DROP2)
lead_phrase(DROP2, oct_=1, gain=0.08)
# breakdown: soft hook, first 2 bars
lead_phrase(BREAK, gain=0.12, bars=2)
lead = reverb(pingpong(lead, BEAT * 0.75, 0.3, 4), 0.35)

# --- lo-fi chiptune bar (2009 website)
for off, note, beats in HOOK[:8]:
    t = LOFI + off * BEAT / 2  # double-time squeeze into the 2 s bar
    if t >= DROP2 - 0.05:
        break
    f = midi(nm(note))
    n = int(beats * BEAT / 2 * SR * 0.9)
    x = square(f, n, 0.25) * env_adsr(n, 0.002, 0.05, 0.6, 0.02)
    place(chip, pan(x, 0), t, 0.13)
for q in range(8):  # 8-bit drum ticks
    t = LOFI + q * BEAT / 2
    n = int(0.06 * SR)
    nz = np.sign(rng.standard_normal(n)) * np.exp(-tt(n) / 0.02)
    place(chip, pan(nz, 0), t, 0.08 if q % 2 else 0.14)
    if q % 2 == 0:
        kq = square(110 * np.exp(-tt(n) / 0.02) + 40, n) * np.exp(-tt(n) / 0.03)
        place(chip, pan(kq, 0), t, 0.2)
# bass chip
for q in range(4):
    n = int(BEAT * SR * 0.9)
    place(chip, pan(square(midi(nm('Eb2')) * (1 if q % 2 == 0 else 2), n, 0.5) * env_adsr(n, 0.002, 0.1, 0.5, 0.02), 0), LOFI + q * BEAT, 0.07)
# crush it
steps = 12
chip = np.round(chip * steps) / steps
chip = bp(chip, 250, 3500)

# --- fx / sound design, driven by events.json
place(fx, noise_riser(3.75, 200, 9000), 4.0, 0.28)
place(fx, whoosh(1.5, rev=True), DROP1 - 1.5, 0.5)
place(fx, crash(3.5), DROP1, 0.55)
place(fx, crash(2.5), DROP2, 0.35)
place(fx, crash(5.0), FINAL, 0.6)
place(fx, noise_riser(2.0, 400, 10000), FINAL - 2.0, 0.28)
place(fx, whoosh(1.0, rev=True), FINAL - 1.0, 0.45)

for t in EV['typing']:
    place(fx, pan(keyclick(), rng.uniform(-0.3, 0.3)), t, 0.18)
for t in EV['errors']:
    place(fx, pan(blip_error(), rng.uniform(-0.5, 0.5)), t, 0.22)
CHIME_NOTES = ['Ab5', 'C6', 'Eb6', 'F6', 'Ab6', 'C7']
for k, t in enumerate(EV['chimes']):
    place(fx, pan(chime(midi(nm(CHIME_NOTES[k % len(CHIME_NOTES)]))), (k % 3 - 1) * 0.4), t, 0.14)
for t in EV['whooshes']:
    place(fx, whoosh(0.6), t - 0.3, 0.3)
for t in EV['ticks']:
    place(fx, pan(tick(), 0.2), t, 0.16)
for t in EV['stamps']:
    place(fx, pan(stamp(), 0), t, 0.6)
for k, t in enumerate(EV['bloops']):
    place(fx, pan(bloop(k % 2 == 0), -0.4 if k % 2 == 0 else 0.4), t, 0.25)
place(fx, whoosh(0.5), EV['slider'] - 0.25, 0.45)
fx = reverb(fx, 0.25)


# ---------------------------------------------------------------- sidechain + mix
sc = np.ones(N)
for t in kick_times:
    i = int(t * SR); n = int(0.3 * SR)
    j = min(N, i + n)
    curve = 1 - 0.7 * np.exp(-tt(j - i) / 0.08)
    sc[i:j] = np.minimum(sc[i:j], curve)
sc2 = sc[:, None]

pads = reverb(pads, 0.35)
mix = (drums * 0.85 + bass * sc2 * 1.0 + pads * sc2 * 1.0 + arp * sc2 * 1.1
       + lead * sc2 * 1.9 + fx * 1.0 + chip * 1.0)

# --- tape stop into the 2009 bar: playback rate 1 -> 0 over TAPE..LOFI
i0, i1 = int(TAPE * SR), int(LOFI * SR)
n = i1 - i0
rate = np.linspace(1, 0, n) ** 1.3
pos = i0 + np.cumsum(rate)
seg = np.stack([np.interp(pos, np.arange(N), mix[:, c]) for c in range(2)], axis=1)
seg *= np.linspace(1, 0.2, n)[:, None]
mix[i0:i1] = seg

# --- 2009 bar is pure chiptune, but let the crash of the drop2 pre-roll bleed
lo = (ti >= LOFI) & (ti < DROP2 - 0.5)
mix[lo] = chip[lo] * 2.6 + fx[lo]
wr = (ti >= DROP2 - 0.5) & (ti < DROP2)
mix[wr] = chip[wr] * 2.6 + fx[wr]

# gentle glue + limiter
mix = hp(mix, 28)
mix *= 0.9 / np.percentile(np.abs(mix), 99.95)
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
# fade in/out
fade_in = int(0.4 * SR); mix[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
fade_out = int(1.2 * SR); mix[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None] ** 2
mix *= 0.97 / np.abs(mix).max()

pcm = (mix * 32767).astype('<i2')
import wave
with wave.open(os.path.join(HERE, 'soundtrack.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote soundtrack.wav', DUR, 's')
