"""LRWeb promo v3 soundtrack: epic melodic EDM, 120 BPM, Ab major (Fm - Db - Ab - Eb).

Real CC0 drums and hits (samples/, see samples/CREDITS.md) + synthesised supersaws, lead, plucks, piano,
FM bells and bass, with a proper mix chain. The arrangement and every sound effect come from events.json
(written by timeline.js); all effects sit on the beat grid, and whooshes/reverse swells peak on the beat.

    python3 music.py landscape   -> soundtrack-landscape.wav
    python3 music.py vertical    -> soundtrack-vertical.wav
"""
import json, os, sys, wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.ndimage import minimum_filter1d

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
EDIT = sys.argv[1] if len(sys.argv) > 1 else 'landscape'
EV = json.load(open(os.path.join(HERE, 'events.json')))[EDIT]
BPM = EV['bpm']; BEAT = 60 / BPM; BAR = 4 * BEAT; STEP = BAR / 16
DUR = EV['end']
N = int(DUR * SR)
rng = np.random.default_rng(3)


# ================================================================ dsp
def tt(n): return np.arange(n) / SR
def sos(kind, f, order=2): return butter(order, f, kind, fs=SR, output='sos')
def filt(x, kind, f, order=2): return sosfilt(sos(kind, f, order), x, axis=0)

def lp_sweep(x, fc, block=256):
    y = np.zeros_like(x); zi = np.zeros((1, 2) + x.shape[1:])
    for i in range(0, len(x), block):
        s = sos('low', float(np.clip(fc[min(i, len(fc) - 1)], 40, SR * .45)))
        y[i:i + block], zi = sosfilt(s, x[i:i + block], axis=0, zi=zi)
    return y

def st(x): return np.stack([x, x], 1) if x.ndim == 1 else x
def pan(x, p):
    x = x if x.ndim == 1 else x.mean(1)
    return np.stack([x * np.cos((p + 1) * np.pi / 4), x * np.sin((p + 1) * np.pi / 4)], 1) * 1.414

def place(buf, sig, t0, gain=1.0):
    sig = st(sig); i = int(round(t0 * SR))
    if i < 0: sig = sig[-i:]; i = 0
    j = min(len(buf), i + len(sig))
    if j > i: buf[i:j] += gain * sig[:j - i]

def fade(x, fin=.002, fout=.01):
    x = x.copy(); a = min(len(x), int(fin * SR)); b = min(len(x), int(fout * SR))
    sh = (lambda n: np.linspace(0, 1, n)[:, None]) if x.ndim > 1 else (lambda n: np.linspace(0, 1, n))
    if a: x[:a] *= sh(a)
    if b: x[-b:] *= sh(b)[::-1]
    return x

def resample(x, ratio):
    n = int(len(x) / ratio); pos = np.arange(n) * ratio
    if x.ndim == 1: return np.interp(pos, np.arange(len(x)), x)
    return np.stack([np.interp(pos, np.arange(len(x)), x[:, c]) for c in range(x.shape[1])], 1)

def sat(x, d=1.5): return np.tanh(x * d) / np.tanh(d)

def adsr(n, a=.005, d=.1, s=.7, r=.05):
    t = tt(n); dur = n / SR
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    return e * np.clip((dur - t) / max(r, 1e-6), 0, 1)

def env_follow(x, attack, release, block=64):
    m = np.abs(x).max(1) if x.ndim > 1 else np.abs(x)
    nb = int(np.ceil(len(m) / block)); pk = np.pad(m, (0, nb * block - len(m))).reshape(nb, block).max(1)
    a = np.exp(-block / (attack * SR)); r = np.exp(-block / (release * SR)); e = np.zeros(nb); v = 0.0
    for i in range(nb):
        v = a * v + (1 - a) * pk[i] if pk[i] > v else r * v + (1 - r) * pk[i]; e[i] = v
    return np.repeat(e, block)[:len(m)]

def compress(x, thr_db=-18, ratio=3, attack=.01, release=.12, makeup_db=0, knee=6):
    lv = 20 * np.log10(env_follow(x, attack, release) + 1e-9); over = lv - thr_db
    gr = np.where(over <= -knee / 2, 0, np.where(over >= knee / 2, over * (1 - 1 / ratio), (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee)))
    return x * (10 ** ((-gr + makeup_db) / 20))[:, None]

def limiter(x, ceiling=.93, look=.004, release=.08):
    d = int(look * SR); need = np.minimum(1, ceiling / (np.abs(x).max(1) + 1e-9))
    g = minimum_filter1d(need, size=2 * d + 1)
    nb = 32; k = int(np.ceil(len(g) / nb)); gb = np.pad(g, (0, k * nb - len(g)), constant_values=1).reshape(k, nb).min(1)
    r = np.exp(-nb / (release * SR)); o = np.zeros(k); v = 1.0
    for i in range(k):
        v = gb[i] if gb[i] < v else r * v + (1 - r) * gb[i]; o[i] = v
    gs = np.interp(np.arange(len(g)), np.arange(k) * nb + nb / 2, o)
    return np.clip(x * np.minimum(gs, g)[:, None], -ceiling, ceiling)

def reverb_ir(seconds, pre=.02, damp=6000, width=1.2):
    n = int(seconds * SR); t = tt(n); ir = rng.standard_normal((n, 2))
    ir = filt(ir, 'low', damp) * np.exp(-t / (seconds / 6.5))[:, None] + filt(ir, 'high', 3000) * np.exp(-t / (seconds / 12))[:, None] * .5
    ir[:int(pre * SR)] = 0; m = ir.mean(1, keepdims=True); ir = m + (ir - m) * width
    return ir / np.sqrt((ir ** 2).sum(0))
IR_PLATE = reverb_ir(1.8, .012, 8000)
IR_HALL = reverb_ir(3.6, .03, 5500, 1.4)

def reverb(x, ir, wet):
    return x + wet * np.stack([fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], 1)

def delay(x, time, fb=.35, taps=5, tone=4500):
    y = x.copy(); d = int(time * SR); src = filt(filt(x, 'low', tone), 'high', 300)
    for k in range(1, taps + 1):
        s = np.zeros_like(x); s[d * k:] = src[:len(x) - d * k]
        if k % 2: s = s[:, ::-1]
        y += (fb ** k) * s
    return y

def widen(x, amt):
    m = x.mean(1, keepdims=True); return m + (x - m) * amt

def polyblep_saw(freq, n, ph0=0.0):
    f = np.broadcast_to(np.asarray(freq, float), (n,)); dt = f / SR
    ph = (ph0 + np.cumsum(dt)) % 1.0; y = 2 * ph - 1
    m1 = ph < dt; x = ph[m1] / dt[m1]; y[m1] -= x + x - x * x - 1
    m2 = ph > 1 - dt; x = (ph[m2] - 1) / dt[m2]; y[m2] -= x * x + x + x + 1
    return y


# ================================================================ samples
def load(name, trim=None):
    w = wave.open(os.path.join(HERE, 'samples', name + '.wav'))
    a = np.frombuffer(w.readframes(w.getnframes()), '<i2').reshape(-1, 2).astype(float) / 32768
    on = int(np.argmax(np.abs(a).max(1) > np.abs(a).max() * .04)); a = a[max(0, on - 20):]
    if trim: a = fade(a[:int(trim * SR)], .0005, min(trim * .3, .06))
    return a / (np.abs(a).max() + 1e-9)
_S = {}
def smp(name, trim=None):
    if (name, trim) not in _S: _S[(name, trim)] = load(name, trim)
    return _S[(name, trim)]
def peak_time(x):
    e = np.convolve(np.abs(x).max(1), np.ones(441) / 441, 'same'); return np.argmax(e) / SR


# ================================================================ harmony
NOTE = {'C': 0, 'Db': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'Gb': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11}
def nm(s): return NOTE[s[:-1]] + 12 * (int(s[-1]) + 1)
def hz(m): return 440 * 2 ** ((m - 69) / 12)
def up(s, k=1): return s[:-1] + str(int(s[-1]) + k)

PROG = ['Fm', 'Db', 'Ab', 'Eb']
CH = {'Fm': ['F3', 'Ab3', 'C4', 'F4', 'C5'], 'Db': ['Db3', 'F3', 'Ab3', 'Db4', 'F4'], 'Ab': ['Eb3', 'Ab3', 'C4', 'Eb4', 'Ab4'], 'Eb': ['Eb3', 'G3', 'Bb3', 'Eb4', 'G4']}
ROOT = {'Fm': 'F1', 'Db': 'Db2', 'Ab': 'Ab1', 'Eb': 'Eb2'}
# the hook: (beat offset in a 4-bar phrase, note, beats)
HOOK_A = [(0, 'C5', 1.5), (1.5, 'Eb5', .5), (2, 'F5', 1), (3, 'Eb5', 1), (4, 'F5', 1.5), (5.5, 'Eb5', .5), (6, 'C5', 1.5), (7.5, 'Ab4', .5),
          (8, 'C5', 1), (9, 'Eb5', 1), (10, 'Ab5', 1.5), (11.5, 'G5', .5), (12, 'G5', 1), (13, 'F5', 1), (14, 'Eb5', 1), (15, 'Bb4', 1)]
HOOK_B = HOOK_A[:8] + [(8, 'C5', .5), (8.5, 'Eb5', .5), (9, 'Ab5', 1), (10, 'C6', 1.5), (11.5, 'Bb5', .5), (12, 'Bb5', 1), (13, 'Ab5', 1), (14, 'G5', 1), (15, 'Eb5', 1)]

MUSIC = [(s, a, a + l) for s, a, l in EV['music']]
def section_at(bar):
    for s, a, b in MUSIC:
        if a <= bar < b - 1e-9: return s, a, b
    return None, 0, 0


# ================================================================ instruments
def supersaw(freq, n, voices=9, spread=.013):
    L = np.zeros(n); R = np.zeros(n)
    for v in range(voices):
        det = 1 + spread * (v - (voices - 1) / 2) / ((voices - 1) / 2)
        s = polyblep_saw(freq * det, n, rng.random()) * (1.0 if v == voices // 2 else .8)
        p = (v / (voices - 1)) * 2 - 1
        L += s * np.cos((p + 1) * np.pi / 4); R += s * np.sin((p + 1) * np.pi / 4)
    return np.stack([L, R], 1) / voices * 1.6

def saw_chord(names, length, cutoff=5000, att=.01, rel=.15, voices=9):
    n = int(length * SR); out = np.zeros((n, 2))
    for s in names: out += supersaw(hz(nm(s)), n, voices)
    out = filt(filt(out, 'low', cutoff), 'high', 140) / len(names)
    return out * adsr(n, att, .4, .85, rel)[:, None]

def pad(names, length, cutoff=1400):
    n = int(length * SR); out = np.zeros((n, 2))
    for s in names:
        f = hz(nm(s)); out += supersaw(f, n, 7, .02) * .7
        out += st(np.sin(2 * np.pi * f * 2 * tt(n)) * .15)
    out = filt(out, 'low', cutoff) / len(names)
    return out * adsr(n, .6, 1, .9, .6)[:, None]

def pluck(freq, length, bright=1.0):
    n = int(length * SR); t = tt(n)
    x = polyblep_saw(freq * 1.004, n) + polyblep_saw(freq * .996, n, .3) + .4 * np.sign(np.sin(2 * np.pi * freq * t))
    x = lp_sweep(x, 500 + 6500 * bright * np.exp(-t / .07), 128)
    return x * np.exp(-t / .25) * .35

def lead_note(freq, length):
    n = int(length * SR); t = tt(n)
    vib = 1 + .005 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - .18) / .25, 0, 1)
    x = supersaw(freq * vib, n, 7, .009) + st(.35 * polyblep_saw(freq * 2 * vib, n))
    x = filt(x, 'low', 7000)
    return x * adsr(n, .006, .3, .8, .06)[:, None]

def piano(freq, length, vel=1.0):
    n = int(length * SR); t = tt(n); x = np.zeros(n)
    for k in range(1, 9):
        fk = freq * k * (1 + .0004 * k * k)
        x += np.sin(2 * np.pi * fk * t + rng.random()) * (1 / k ** 1.3) * np.exp(-t * (1.2 + k * .9))
    ham = filt(rng.standard_normal(n), 'band', [1500, 5000]) * np.exp(-t / .004) * .1
    return (x + ham) * np.minimum(t / .002, 1) * vel * .6 * np.clip((length - t) / .08, 0, 1)

def bell(freq, length=1.6):
    n = int(length * SR); t = tt(n)
    mod = np.sin(2 * np.pi * freq * 3.5 * t) * 2.2 * np.exp(-t / .25)
    x = np.sin(2 * np.pi * freq * t + mod) * np.exp(-t / .55) + .25 * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t / .2)
    return x * np.minimum(t / .001, 1) * .6

def sub(freq, length):
    n = int(length * SR); return np.sin(2 * np.pi * freq * tt(n)) * adsr(n, .005, .2, .9, .04)

def bass_note(freq, length):
    n = int(length * SR); t = tt(n)
    x = polyblep_saw(freq * 2, n) * .5 + np.sin(2 * np.pi * freq * t)
    x = lp_sweep(x, 280 + 1600 * np.exp(-t / .05), 128)
    return x * adsr(n, .003, .1, .7, .02)

def noise_riser(length, f0=300, f1=10000):
    n = int(length * SR); t = tt(n); p = t / length
    x = lp_sweep(rng.standard_normal((n, 2)), f0 * (f1 / f0) ** (p ** 1.4))
    saw = polyblep_saw(110 * 2 ** (p * 3), n) * .18
    return filt(x + st(saw), 'high', 180) * (p ** 2)[:, None]


# ================================================================ arrangement
drums = np.zeros((N, 2)); bass = np.zeros((N, 2)); chords = np.zeros((N, 2)); lead = np.zeros((N, 2))
arp = np.zeros((N, 2)); pads = np.zeros((N, 2)); keys = np.zeros((N, 2)); fx = np.zeros((N, 2))
kicks = []

KICK = resample(smp('kick_bigroom'), 51.9 / 54)  # tuned to Ab
CLAP = smp('clap_fat'); SNR = smp('snare_edm', .3); HAT = smp('hat_modular', .08); OHAT = smp('ohat_2', .45)
CRASH = smp('crash_909'); CRASH2 = smp('crash_1')

def kick(t, g=1.0, lp=None):
    place(drums, KICK if lp is None else filt(KICK, 'low', lp), t, g)
    if lp is None or lp > 2000: kicks.append(t)

def clap(t, g=1.0):
    place(drums, CLAP, t, .55 * g); place(drums, SNR, t, .45 * g)

def hat(t, g=1.0, p=.2):
    place(drums, pan(HAT, p), t + rng.normal(0, .0015), .2 * g)

bars = int(np.ceil(EV['bars']))
PAT = [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 4, 3, 1, 2, 3, 4]
for k in range(bars * 16):
    bar_f = k / 16; t = k * STEP; stp = k % 16
    sec, s0, s1 = section_at(bar_f)
    if not sec: continue
    lb = int(bar_f - s0); ch = PROG[lb % 4] if sec != 'outro' else 'Ab'
    left = s1 - bar_f
    gap = sec in ('build', 'break') and left <= .25 + 1e-9
    breakbuild = sec == 'break' and left <= 1 + 1e-9

    # chords / pads / keys (per bar)
    if stp == 0:
        if sec in ('intro', 'build', 'break'):
            place(pads, pad(CH[ch][:4], BAR + .6, 900 if sec == 'intro' else 1600), t, .5)
        if sec in ('drop', 'drop2'):
            place(chords, saw_chord(CH[ch], BAR + .05, 6500), t, .55)
            place(pads, pad(CH[ch][:4], BAR + .6, 2400), t, .25)
            if sec == 'drop2': place(pads, pad([up(n) for n in CH[ch][:3]], BAR + .6, 3000), t, .18)
        if sec == 'break' and not breakbuild:
            for i, nn in enumerate(CH[ch][:4]):
                place(keys, pan(piano(hz(nm(nn)), BAR * .95, .7), -.2 + .13 * i), t + i * .012, .5)
        if sec == 'outro' and lb == 0:
            place(chords, saw_chord(['Ab2', 'Eb3', 'Ab3', 'C4', 'Eb4', 'Ab4', 'C5'], BAR * 2.2, 5000, .005, 1.2), t, .75)
            place(pads, pad(['Ab2', 'Eb3', 'Ab3', 'C4'], BAR * 2.4, 2000), t, .5)
            for i, nn in enumerate(['Ab2', 'Eb3', 'Ab3', 'C4', 'Eb4']):
                place(keys, pan(piano(hz(nm(nn)), BAR * 2, .9), -.3 + .15 * i), t + i * .02, .5)

    # arp
    tones = [nm(n) + 12 for n in CH[ch]]
    if sec in ('drop', 'drop2') or (sec == 'build' and not gap):
        g = .22 if sec != 'build' else .1 + .1 * (bar_f - s0) / (s1 - s0)
        place(arp, pan(pluck(hz(tones[PAT[stp]]), .28, 1.0 if sec != 'build' else .6), -.35 if stp % 2 else .35), t, g)
    if sec in ('intro', 'break') and stp % 2 == 0 and not gap:
        place(arp, pan(pluck(hz(tones[PAT[stp]]), .5, .35), -.4 if stp % 4 else .4), t, .14)

    # drums
    if sec in ('drop', 'drop2'):
        if stp % 4 == 0: kick(t)
        if stp in (4, 12): clap(t)
        if stp % 4 == 2: place(drums, pan(OHAT, .25), t, .16)
        if stp % 4 != 2: hat(t, 1 if stp % 2 == 0 else .55, -.25)
        if stp == 0 and lb % 4 == 0: place(drums, CRASH, t, .35); place(drums, pan(CRASH2, -.3), t, .25)
        if lb % 4 == 3 and stp >= 12: place(drums, SNR, t + STEP / 2, .18 + .04 * (stp - 12))
    if sec == 'build' and not gap:
        p = (bar_f - s0) / (s1 - s0)
        if stp % 4 == 0: kick(t, .9, 300 + 6000 * p ** 2)
        if bar_f - s0 >= 1 and stp in (4, 12): clap(t, .5 + .3 * p)
        if bar_f - s0 >= 2 and stp % 4 == 2: place(drums, pan(OHAT, .2), t, .12)
        if left <= 1 + 1e-9:  # snare roll: 8ths -> 16ths -> 32nds
            q = 1 - left
            if (q < .5 and stp % 2 == 0) or .5 <= q < .75: place(drums, resample(SNR, 1 + .3 * q), t, .2 + .45 * q)
            elif q >= .75:
                for r in range(2): place(drums, resample(SNR, 1.3 + .3 * q), t + r * STEP / 2, .3 + .4 * q)
    if sec == 'intro' and bar_f - s0 >= 2 and stp in (0, 8): kick(t, .45, 180)
    if breakbuild and not gap:
        q = 1 - left
        if stp % 4 == 0: kick(t, .7, 400 + 3000 * q)
        if (q < .5 and stp % 2 == 0) or q >= .5: place(drums, resample(SNR, 1 + .35 * q), t, .15 + .45 * q)

    # bass
    root = hz(nm(ROOT[ch]))
    if sec in ('drop', 'drop2'):
        if stp % 4 == 2: place(bass, bass_note(root * 2, BEAT / 2 * .95), t, .5)
        if stp == 0: place(bass, sub(root, BAR), t, .45)
    if sec in ('intro', 'break') and stp == 0 and not breakbuild:
        place(bass, sub(root, BAR * .98) * np.exp(-tt(int(BAR * .98 * SR)) / 1.2), t, .35)
    if sec == 'build' and stp == 0: place(bass, sub(root, BAR * .9), t, .3)

# lead hook (drops) + a soft piano version in the break + a sparkle on the outro
for s, a, b in MUSIC:
    if s in ('drop', 'drop2'):
        for ph in range(int(np.ceil((b - a) / 4))):
            t0 = (a + ph * 4) * BAR
            for off, note, beats in (HOOK_A if ph % 2 == 0 else HOOK_B):
                tn = t0 + off * BEAT
                if tn >= b * BAR - .01: break
                ln = min(beats * BEAT, b * BAR - tn)
                place(lead, lead_note(hz(nm(note)), ln), tn, .32)
                if s == 'drop2': place(lead, lead_note(hz(nm(note) + 12), ln), tn, .13)
    if s == 'break':
        for off, note, beats in HOOK_A[:8]:
            tn = a * BAR + off * BEAT
            if tn < (b - 1) * BAR: place(keys, pan(piano(hz(nm(note)), beats * BEAT + .4, .9), .1), tn, .55)
    if s == 'outro':
        for i, note in enumerate(['Eb5', 'Ab5', 'C6', 'Eb6', 'Ab6', 'C7']):
            place(arp, pan(bell(hz(nm(note)), 2.0), -.5 + .2 * i), a * BAR + BEAT + i * STEP, .22)


# ================================================================ sound effects (grid-locked)
def at_onset(name, t, g, trim=None, rate=1.0, p=0.0):
    x = smp(name, trim); x = resample(x, rate) if rate != 1 else x
    place(fx, pan(x, p) if p else x, t, g)

def at_peak(name, t, g, trim=None, rate=1.0, p=0.0):
    x = smp(name, trim); x = resample(x, rate) if rate != 1 else x
    place(fx, pan(x, p) if p else x, t - peak_time(x), g)

def rev_swell(t_hit, length=1.0, g=.5):
    x = np.concatenate([CRASH2, CRASH])[:int(2.5 * SR)]
    x = reverb(x, IR_HALL, .7)[:int(length * SR)][::-1]
    place(fx, fade(x, .3, .004), t_hit - len(x) / SR, g)

next_start = lambda t: min([a * BAR for s, a, b in MUSIC if a * BAR > t + 1e-6] + [DUR])
for e in EV['sfx']:
    t, kind, g = e['t'], e['kind'], e['gain']
    if kind == 'ding':
        place(fx, pan(bell(hz(nm(e['note'])), 1.4 if not e.get('soft') else .8), [-.5, .5, -.2, .3, .6, -.6][e['i'] % 6]), t, .28 * g)
        at_onset('notif', t, .1 * g, p=[.4, -.4][e['i'] % 2])
    elif kind == 'thud':
        at_onset('boom', t, .4 * g, trim=.7)
    elif kind == 'error':
        at_onset('error_mm', t, .16 * g, rate=[1, .9, 1.12][e['i'] % 3], p=[-.6, .6][e['i'] % 2])
    elif kind == 'suck':
        hit = next_start(t); rev_swell(hit, hit - t + .25, .6); at_peak('whoosh_whip', hit, .45)
    elif kind == 'drop':
        at_onset('impact_cine', t, .7, trim=4.5); at_onset('boom', t, .6); at_onset('subdrop', t, .4)
    elif kind == 'shimmer':
        for i, note in enumerate(['Eb6', 'Ab6', 'C7', 'Eb7']):
            place(fx, pan(bell(hz(nm(note)), 1.8), -.4 + .27 * i), t + i * STEP, .16)
    elif kind == 'scan':
        n = int(e['len'] * SR); p = tt(n) / e['len']
        x = lp_sweep(rng.standard_normal((n, 2)), 600 * (8000 / 600) ** p) * (np.sin(np.pi * p) ** 1.5)[:, None]
        place(fx, filt(x, 'high', 400), t, .1)
    elif kind == 'whoosh':
        at_peak('whoosh_quick', t, .35 * g)
    elif kind == 'check':
        place(fx, pan(bell(hz(nm(['C6', 'Eb6', 'F6', 'Ab6', 'C7', 'Eb7'][e['i'] % 6])), 1.2), [-.4, .4][e['i'] % 2]), t, .2 * g)
    elif kind == 'land':
        at_onset('boom', t, .5 * g); at_onset('impact_deep2', t, .3 * g, trim=1.5)
    elif kind == 'card':
        at_peak('swoosh', t, .2 * g, rate=[1, 1.1, 1.2][e['i'] % 3], p=[-.4, 0, .4][e['i'] % 3])
    elif kind == 'chime':
        for i, note in enumerate(['Ab5', 'C6', 'Eb6']): place(fx, pan(bell(hz(nm(note)), 2.0), -.3 + .3 * i), t, .15)
    elif kind in ('msg_in', 'msg_out'):
        at_onset(kind, t, .9 * g)
    elif kind == 'final':
        at_onset('impact_cine', t, .75); at_onset('boom', t, .55); place(fx, CRASH2, t, .35); place(fx, CRASH, t, .3)

for s, a, b in MUSIC:  # risers into every drop
    if s == 'build': place(fx, noise_riser((b - a) * BAR - BEAT), a * BAR, .2)
    if s == 'break': place(fx, noise_riser(BAR - BEAT, 500), (b - 1) * BAR, .18); rev_swell(b * BAR, BEAT + .25, .45)


# ================================================================ mix
def sidechain(times, depth, rel):
    g = np.ones(N)
    for t in times:
        i = int(t * SR); n = min(N - i, int(.45 * SR))
        if n > 0: g[i:i + n] = np.minimum(g[i:i + n], 1 - depth * np.exp(-tt(n) / (rel / 3)) * np.clip(tt(n) / .003 + .3, 0, 1))
    return g[:, None]
pump = sidechain(kicks, .75, .22); duck = sidechain(kicks, .45, .15)

drums_b = compress(sat(filt(drums, 'high', 28), 1.2), -14, 3, .003, .08, 2)
bass_b = compress(filt(bass, 'low', 3000), -14, 3, .005, .1, 2) * duck
chords_b = widen(reverb(chords, IR_PLATE, .25), 1.25) * pump
lead_b = reverb(delay(lead, BEAT * .75, .3, 4), IR_HALL, .28) * duck
arp_b = reverb(delay(arp, BEAT * .75, .25, 3), IR_PLATE, .3) * pump
pads_b = widen(reverb(pads, IR_HALL, .35), 1.3) * sidechain(kicks, .4, .25)
keys_b = reverb(keys, IR_HALL, .35)
fx_b = reverb(fx, IR_HALL, .2)

fc = np.full(N, 20000.0)
for s, a, b in MUSIC:
    i0, i1 = int(a * BAR * SR), min(N, int(b * BAR * SR))
    if s == 'intro': fc[i0:i1] = np.geomspace(900, 3500, i1 - i0)
    if s == 'build': fc[i0:i1] = np.geomspace(2000, 16000, i1 - i0)
mel = lp_sweep(chords_b + arp_b + pads_b, fc, 512)

mix = drums_b * 1.0 + bass_b * .8 + mel * 1.8 + lead_b * 1.35 + keys_b * .75 + fx_b * .9
for s, a, b in MUSIC:  # the breath before each drop
    if s in ('build', 'break'):
        i0, i1 = int((b - .25) * BAR * SR), int(b * BAR * SR)
        mix[i0:i1] = fx_b[i0:i1] * .9 + keys_b[i0:i1] * .3

mix = filt(mix, 'high', 25)
mix = compress(mix, -12, 2, .02, .25)
mix = mix + .3 * filt(mix, 'high', 9000)
rms = np.sqrt((mix[int(.3 * N):int(.8 * N)] ** 2).mean()); mix *= .21 / rms
mix = limiter(sat(mix, 1.2) * 1.04, .93)
fo = int(2.0 * SR); mix[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 2
mix[:int(.01 * SR)] *= np.linspace(0, 1, int(.01 * SR))[:, None]

out = os.path.join(HERE, f'soundtrack-{EDIT}.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(mix, -1, 1) * 32767).astype('<i2').tobytes())
print('wrote', out, f'{DUR:.1f}s peak {np.abs(mix).max():.3f} rms {np.sqrt((mix ** 2).mean()):.3f}')
