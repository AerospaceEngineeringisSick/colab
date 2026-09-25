"""LRWeb promo v2 soundtrack: hard trap / phonk, 150 BPM, C minor.

Real CC0 one-shots (samples/, see samples/CREDITS.md) for drums, the phonk bell and sound effects;
the distorted 808, pads and risers are synthesised. The arrangement and every sound effect come from
events.json (written by timeline.js), so the music is cut to each edit.

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
DUR = EV['end'] + 0.0
N = int(DUR * SR)
rng = np.random.default_rng(11)


# ================================================================ dsp helpers
def tt(n): return np.arange(n) / SR

def sos(kind, f, order=2):
    return butter(order, f, kind, fs=SR, output='sos')

def filt(x, kind, f, order=2): return sosfilt(sos(kind, f, order), x, axis=0)

def lp_sweep(x, fc, block=256):
    y = np.zeros_like(x); zi = np.zeros((1, 2) + x.shape[1:])
    for i in range(0, len(x), block):
        s = sos('low', float(np.clip(fc[min(i, len(fc) - 1)], 40, SR * .45)))
        y[i:i + block], zi = sosfilt(s, x[i:i + block], axis=0, zi=zi)
    return y

def shelf(x, f, gain_db, kind='high'):  # crude shelf: add filtered copy
    g = 10 ** (gain_db / 20) - 1
    return x + g * filt(x, kind, f)

def to_st(x):
    return np.stack([x, x], 1) if x.ndim == 1 else x

def pan(x, p):
    x = x if x.ndim == 1 else x.mean(1)
    return np.stack([x * np.cos((p + 1) * np.pi / 4), x * np.sin((p + 1) * np.pi / 4)], 1) * 1.414

def place(buf, sig, t0, gain=1.0):
    sig = to_st(sig); i = int(round(t0 * SR))
    if i < 0: sig = sig[-i:]; i = 0
    j = min(len(buf), i + len(sig))
    if j > i: buf[i:j] += gain * sig[:j - i]

def fade(x, fin=0.002, fout=0.01):
    x = x.copy(); a = min(len(x), int(fin * SR)); b = min(len(x), int(fout * SR))
    if a: x[:a] *= np.linspace(0, 1, a)[:, None] if x.ndim > 1 else np.linspace(0, 1, a)
    if b: x[-b:] *= np.linspace(1, 0, b)[:, None] if x.ndim > 1 else np.linspace(1, 0, b)
    return x

def resample(x, ratio):  # ratio > 1 = higher pitch, shorter
    n = int(len(x) / ratio)
    pos = np.arange(n) * ratio
    if x.ndim == 1: return np.interp(pos, np.arange(len(x)), x)
    return np.stack([np.interp(pos, np.arange(len(x)), x[:, c]) for c in range(x.shape[1])], 1)

def sat(x, drive=1.5):
    return np.tanh(x * drive) / np.tanh(drive)

def env_follow(x, attack, release, block=64):
    """block-wise peak envelope with attack/release (seconds)."""
    m = np.abs(x).max(1) if x.ndim > 1 else np.abs(x)
    nb = int(np.ceil(len(m) / block)); pk = np.pad(m, (0, nb * block - len(m))).reshape(nb, block).max(1)
    a = np.exp(-block / (attack * SR)); r = np.exp(-block / (release * SR))
    e = np.zeros(nb); v = 0.0
    for i in range(nb):
        v = a * v + (1 - a) * pk[i] if pk[i] > v else r * v + (1 - r) * pk[i]
        e[i] = v
    return np.repeat(e, block)[:len(m)]

def compress(x, thr_db=-18, ratio=3, attack=.01, release=.12, makeup_db=0, knee=6):
    e = env_follow(x, attack, release) + 1e-9
    lv = 20 * np.log10(e)
    over = lv - thr_db
    gr = np.where(over <= -knee / 2, 0, np.where(over >= knee / 2, over * (1 - 1 / ratio), (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee)))
    g = 10 ** ((-gr + makeup_db) / 20)
    return x * g[:, None]

def limiter(x, ceiling=0.93, look=0.004, release=0.06):
    d = int(look * SR)
    need = np.minimum(1, ceiling / (np.abs(x).max(1) + 1e-9))
    g = minimum_filter1d(need, size=2 * d + 1)
    # smooth: instant attack (already looked ahead), exponential release
    nb = 32; nbk = int(np.ceil(len(g) / nb)); gb = np.pad(g, (0, nbk * nb - len(g)), constant_values=1).reshape(nbk, nb).min(1)
    r = np.exp(-nb / (release * SR)); out = np.zeros(nbk); v = 1.0
    for i in range(nbk):
        v = gb[i] if gb[i] < v else r * v + (1 - r) * gb[i]
        out[i] = v
    gs = np.interp(np.arange(len(g)), np.arange(nbk) * nb + nb / 2, out)
    y = x * np.minimum(gs, g)[:, None]
    return np.clip(y, -ceiling, ceiling)

def reverb_ir(seconds=2.2, pre=0.015, damp=5500, width=1.0):
    n = int(seconds * SR); t = tt(n)
    ir = rng.standard_normal((n, 2))
    # frequency-dependent decay: dark tail
    bright = filt(ir, 'high', 2500) * np.exp(-t / (seconds / 9))[:, None]
    body = filt(ir, 'low', damp) * np.exp(-t / (seconds / 6))[:, None]
    ir = bright * .6 + body
    ir[:int(pre * SR)] = 0
    m = ir.mean(1, keepdims=True); ir = m + (ir - m) * width
    return ir / np.sqrt((ir ** 2).sum(0))

IR_ROOM = reverb_ir(1.2, .008, 7000)
IR_HALL = reverb_ir(3.0, .02, 5000, 1.3)

def reverb(x, ir, wet=.25):
    w = np.stack([fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], 1)
    return x + w * wet

def delay(x, time, fb=.35, taps=5, tone=3500, pingpong=True):
    y = x.copy(); d = int(time * SR); src = filt(x, 'low', tone); src = filt(src, 'high', 250)
    for k in range(1, taps + 1):
        s = np.zeros_like(x); s[d * k:] = src[:len(x) - d * k]
        if pingpong and k % 2: s = s[:, ::-1]
        y += (fb ** k) * s
    return y

def widen(x, amt=1.3):
    m = x.mean(1, keepdims=True); return m + (x - m) * amt

def bitcrush(x, bits=7, down=5):
    y = x[::down].repeat(down, 0)[:len(x)]
    q = 2 ** (bits - 1); return np.round(y * q) / q


# ================================================================ samples
def load(name, trim=None, gain_norm=True):
    w = wave.open(os.path.join(HERE, 'samples', name + '.wav'))
    a = np.frombuffer(w.readframes(w.getnframes()), '<i2').reshape(-1, 2).astype(float) / 32768
    pk = np.abs(a).max()
    on = int(np.argmax(np.abs(a).max(1) > pk * 0.05))
    a = a[max(0, on - 30):]
    if trim: a = fade(a[:int(trim * SR)], 0.0005, min(trim * .3, .05))
    if gain_norm: a = a / (np.abs(a).max() + 1e-9)
    return a

S = {}
def smp(name, trim=None):
    k = (name, trim)
    if k not in S: S[k] = load(name, trim)
    return S[k]

def peak_time(x):  # seconds from start to loudest moment (smoothed)
    e = np.convolve(np.abs(x).max(1), np.ones(882) / 882, 'same'); return np.argmax(e) / SR


# ================================================================ music data
NOTE = {'C': 0, 'Db': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'Gb': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11}
def nm(s): return NOTE[s[:-1]] + 12 * (int(s[-1]) + 1)
def hz(m): return 440 * 2 ** ((m - 69) / 12)

PROG = ['Cm', 'Ab', 'Fm', 'G']
ROOT = {'Cm': 'C2', 'Ab': 'Ab1', 'Fm': 'F1', 'G': 'G1'}
PAD = {'Cm': ['C3', 'Eb3', 'G3', 'C4'], 'Ab': ['Ab2', 'C3', 'Eb3', 'Ab3'], 'Fm': ['F2', 'Ab2', 'C3', 'F3'], 'G': ['G2', 'B2', 'D3', 'G3']}
# phonk bell riff: 3-3-2 grouping in 16ths
RIFF = {
    'Cm': {0: 'C5', 3: 'C5', 6: 'Eb5', 8: 'G5', 11: 'F5', 14: 'Eb5'},
    'Ab': {0: 'C5', 3: 'C5', 6: 'Eb5', 8: 'Ab5', 11: 'G5', 14: 'Eb5'},
    'Fm': {0: 'C5', 3: 'C5', 6: 'F5', 8: 'Ab5', 11: 'G5', 14: 'F5'},
    'G': {0: 'B4', 3: 'B4', 6: 'D5', 8: 'G5', 11: 'F5', 14: 'D5'},
}
GHOST = {'Cm': 'G4', 'Ab': 'Ab4', 'Fm': 'F4', 'G': 'G4'}

MUSIC = [(s, a, a + l) for s, a, l in EV['music']]
def section_at(bar):
    for s, a, b in MUSIC:
        if a <= bar < b - 1e-9: return s, a, b
    return 'silence', 0, 0


# ================================================================ instruments
BELL = smp('cowbell_phonk2')  # pitched C4 bell with a C5 attack
def bell(note, length, bright=1.0):
    r = hz(nm(note)) / hz(nm('C5')) * 2.0  # sample fundamental is C4; ×2 plays the written note
    x = resample(BELL, r)[:int(length * SR)]
    x = fade(x, .0005, .02)
    if bright < 1: x = filt(x, 'low', 800 + 6000 * bright)
    return x

def eight08(m_to, m_from, length, glide=.07, drive=3.0):
    n = int(length * SR); t = tt(n)
    f0, f1 = hz(m_from), hz(m_to)
    f = f1 * (f0 / f1) ** np.exp(-t / (glide / 3)) if m_from != m_to else np.full(n, f1)
    f = f * (1 + 1.2 * np.exp(-t / .01))  # punch
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * np.exp(-t / 1.6) * np.minimum(t / .002, 1)
    dirty = np.tanh(x * drive) + 0.15 * np.tanh(x * drive * 3)
    y = 0.55 * x + 0.45 * dirty
    y = filt(y, 'low', 2600)
    return fade(y, .001, .012)

def supersaw_chord(names, length, cutoff=1400):
    n = int(length * SR); t = tt(n); out = np.zeros((n, 2))
    for s in names:
        f = hz(nm(s))
        for v in range(7):
            det = 1 + .016 * (v - 3) / 3
            ph = (rng.random() + np.cumsum(np.full(n, f * det)) / SR) % 1
            saw = 2 * ph - 1
            out[:, v % 2] += saw * (0.6 if v == 3 else 1)
    out = filt(out, 'low', cutoff, 2) / (len(names) * 5)
    e = np.minimum(t / .25, 1) * np.minimum((length - t) / .2, 1)
    return out * e[:, None]

def noise_riser(length, f0=400, f1=9000):
    n = int(length * SR); t = tt(n); p = t / length
    x = rng.standard_normal((n, 2)); x = lp_sweep(x, f0 * (f1 / f0) ** (p ** 1.5))
    saw_f = 80 * 2 ** (p * 4); ph = np.cumsum(saw_f) / SR % 1
    x += to_st((2 * ph - 1) * .25)
    return filt(x, 'high', 200) * (p ** 2)[:, None]


# ================================================================ buses
drums = np.zeros((N, 2)); bass = np.zeros((N, 2)); music = np.zeros((N, 2)); fx = np.zeros((N, 2)); lofi = np.zeros((N, 2))
kicks = []  # times for sidechain

KICK = smp('kick_trap1'); SNARE = smp('snare_trap', .35); CLAP = smp('clap_fat'); PSNARE = smp('snare_phonk', .22)
HAT = smp('hat_hiphop'); HAT2 = smp('hat_modular', .1); OHAT = smp('ohat_2', .5)

def hit_kick(t, g=1.0):
    place(drums, KICK, t, 1.3 * g); kicks.append(t)

def hit_snare(t, g=1.0):
    place(drums, SNARE, t, .75 * g); place(drums, CLAP, t + .004, .65 * g); place(drums, PSNARE, t, .35 * g)

def hit_hat(t, g=1.0, pitch=1.0, p=.2):
    h = HAT if pitch == 1 else resample(HAT, pitch)
    place(drums, pan(h, p), t + rng.normal(0, .002), .3 * g)

bars = int(np.ceil(EV['bars']))
last808 = nm('C2')
steps_total = bars * 16
for k in range(steps_total):
    bar_f = k / 16; t = k * STEP; st = k % 16
    sec, s0, s1 = section_at(bar_f)
    if sec == 'silence': continue
    lb = int(bar_f - s0); chord = PROG[lb % 4]
    sec_len = s1 - s0; to_end = s1 - bar_f  # bars left in section

    # ---------------- phonk bell riff (most sections)
    if sec in ('hook', 'intro', 'build', 'drop', 'drop2', 'outro', 'lofi') and not (sec == 'outro' and lb >= 2):
        gap = sec in ('build',) and to_end <= .25
        if st in RIFF[chord] and not gap:
            note = RIFF[chord][st]
            nxt = min([s for s in RIFF[chord] if s > st] + [16])
            ln = (nxt - st) * STEP + .12
            bright = {'hook': .55, 'intro': .35 + .25 * (bar_f - s0) / sec_len, 'build': .6 + .4 * (bar_f - s0) / sec_len}.get(sec, 1.0)
            b = bell(note, ln, bright)
            acc = 1.0 if st in (0, 8) else .8
            place(lofi if sec == 'lofi' else music, pan(b, -.15), t, .95 * acc)
            if sec == 'drop2':
                place(music, pan(bell(note, ln), .5), t + .008, .3 * acc)  # octave-ish double (brighter, panned)
        if st == 13 and sec in ('drop', 'drop2') and not gap:
            place(music, pan(bell(GHOST[chord], STEP * 2.5, .5), .3), t, .3)

    # ---------------- 808 + kick
    pat808 = {  # step: (length in steps, slide from octave above?)
        0: {0: 6, 6: 4, 10: 6}, 1: {0: 7, 7: 3, 10: 6}, 2: {0: 6, 6: 4, 10: 6}, 3: {0: 4, 4: 3, 7: 3, 10: 4, 14: 2},
    }[lb % 4]
    if sec in ('drop', 'drop2') or (sec == 'outro' and lb == 0):
        if st in pat808:
            root = nm(ROOT[chord])
            m = root + (12 if (lb % 4 == 3 and st == 14) else 0)
            frm = last808 if st != 0 else last808
            glide = .09 if (lb % 4 == 3 and st in (10, 14)) else .03
            place(bass, eight08(m, frm, pat808[st] * STEP + .02, glide), t, .42)
            last808 = m
            if st in (0, 10) or (lb % 4 == 1 and st == 7): hit_kick(t)
        if st == 8: hit_snare(t)
        if lb % 4 == 3 and st in (14, 15) and sec == 'drop2': hit_snare(t, .35)
        # hats
        roll = lb % 4 == 3 and st >= 12
        trip = lb % 2 == 1 and 4 <= st < 8
        if roll:
            if st == 12:
                for r in range(8): hit_hat(t + r * STEP * 4 / 8, .6 + .05 * r, 1 + .06 * r, p=.25)
        elif trip:
            if st == 4:
                for r in range(6): hit_hat(t + r * STEP * 4 / 6, .55 + (.2 if r % 3 == 0 else 0), p=-.2)
        elif st % 2 == 0 or (sec == 'drop2' and st % 4 == 3):
            hit_hat(t, 1.0 if st % 4 == 0 else .6, p=.15 if st % 4 else -.1)
        if sec == 'drop2' and st in (6,): place(drums, pan(OHAT, .35), t, .12)
    elif sec in ('hook', 'intro'):
        if st == 0 and lb == 0:
            place(bass, eight08(nm('C2'), nm('C3'), sec_len * BAR, .25, 2.2), t, .4)
    elif sec == 'build':
        bl = bar_f - s0
        if to_end > .25:
            if st == 0:
                place(bass, filt(eight08(nm(ROOT[chord]), nm(ROOT[chord]), BAR * .9), 'low', 300), t, .4); hit_kick(t, .8)
            dens = 2 if bl < sec_len - 1 else 1
            if st % dens == 0: hit_hat(t, .7 if st % 4 else 1, p=.2)
            # snare roll in the last bar: 8ths -> 16ths -> 32nds, rising
            if to_end <= 1.0 + 1e-9:
                p = 1 - to_end
                if p < .25 and st % 2 == 0 or .25 <= p < .5:
                    hit_snare(t, .25 + .5 * p)
                elif p >= .5:
                    for r in range(2): place(drums, resample(SNARE, 1 + .4 * p), t + r * STEP / 2, .2 + .4 * p)
    elif sec == 'build2':
        if to_end > .25:
            if st % 2 == 0: hit_snare(t, .25 + .5 * (bar_f - s0))
            if st >= 8: place(drums, resample(SNARE, 1.2 + .3 * (bar_f - s0)), t + STEP / 2, .3)
            if st == 0: place(bass, eight08(nm('G1'), nm('G1'), BAR * .7), t, .35)
    elif sec == 'lofi':
        if st in (0, 10): place(lofi, KICK, t, .9)
        if st == 8: place(lofi, SNARE, t, .6)
        if st % 2 == 0: place(lofi, HAT, t, .12)
        if st == 0: place(lofi, eight08(nm(ROOT[chord]), nm(ROOT[chord]), BAR * .8, drive=1.5), t, .6)

    # ---------------- pads (one per bar)
    if st == 0 and sec in ('hook', 'intro', 'build', 'drop', 'drop2', 'build2', 'outro'):
        cut = {'intro': 900, 'hook': 1100, 'build': 1400, 'build2': 2000, 'outro': 1800}.get(sec, 1600)
        ln = BAR + .3
        if sec == 'outro' and lb == 2: ln = BAR * 2.5
        if not (sec == 'outro' and lb > 2):
            place(music, supersaw_chord(PAD[chord if sec != 'outro' else 'Cm'], ln, cut), t, .45 if sec in ('intro', 'hook', 'outro') else .3)

# outro: bell tail line with delay and a final 808 glide down
for s, a, b in MUSIC:
    if s == 'outro':
        t0 = (a + 1) * BAR
        for i, note in enumerate(['C5', 'Eb5', 'G5', 'C6']):
            place(music, pan(bell(note, 1.2), -.4 + .27 * i), t0 + i * STEP * 3, .35)
        place(bass, eight08(nm('C1'), nm('C2'), BAR * 1.8, .8, 2.0), t0, .4)

# ================================================================ sound effects
def fx_at(name, t, g, align='onset', trim=None, rate=1.0, p=0.0, bus=None):
    x = smp(name, trim)
    if rate != 1: x = resample(x, rate)
    off = peak_time(x) if align == 'peak' else 0
    place(bus if bus is not None else fx, pan(x, p) if p else x, t - off, g)

def rev_crash_into(t_hit, g=.5, length=1.6):
    x = np.concatenate([smp('crash_1'), smp('crash_909')[:int(.1 * SR)] * 0])[:int(length * SR)]
    x = reverb(to_st(x), IR_HALL, .6)[::-1]
    place(fx, fade(x, .2, .005), t_hit - len(x) / SR, g)

def riser_into(t_hit, length, g=.35):
    place(fx, noise_riser(length), t_hit - length, g)

next_section_start = lambda t: min([a * BAR for s, a, b in MUSIC if a * BAR > t + 1e-6] + [DUR])
for e in EV['sfx']:
    t, k, g = e['t'], e['kind'], e['gain']
    if k == 'hook':
        fx_at('impact_low', t, .9); fx_at('braam_dist', t, .45); fx_at('subdrop_synth', t, .5); fx_at('crash_909', t, .25)
    elif k == 'slam':
        fx_at('impact_deep2', t, .55 * g, trim=.9); fx_at('glitch_allpass', t, .25 * g)
    elif k == 'error':
        nm_ = ['error_mm', 'error_1', 'error_2'][e['i'] % 3]
        fx_at(nm_, t, .3 * g, rate=[1, 1.12, .94, 1.26][e['i'] % 4], p=[-.6, .5, -.3, .7][e['i'] % 4])
    elif k == 'glitch':
        fx_at(['glitch_2', 'glitch_sfx', 'glitch_1'][e['i'] % 3], t, [.8, 2.2, .35][e['i'] % 3] * g, trim=.4)
    elif k == 'revcrash':
        hit = next_section_start(t); rev_crash_into(hit, .55)
        fx_at('whoosh_whip', hit, .35, align='peak')
    elif k == 'drop':
        fx_at('impact_cine', t, .6, trim=4.5); fx_at('braam_dist', t, .4); fx_at('subdrop', t, .55); fx_at('crash_909', t, .4); fx_at('crash_1', t, .3)
    elif k == 'drop2':
        fx_at('impact_deep3', t, .7, trim=3.5); fx_at('subdrop_synth', t, .5); fx_at('crash_909', t, .4)
    elif k == 'final':
        fx_at('impact_cine', t, .85); fx_at('braam_unfa', t, .55, trim=5); fx_at('subdrop', t, .6); fx_at('crash_1', t, .4); fx_at('crash_909', t, .35)
    elif k == 'snap':
        fx_at('shutter', t, .22 * g * 2, trim=.25, p=[-.4, .4][e['i'] % 2])
    elif k == 'whoosh':
        fx_at('whoosh_quick', t, .5, align='peak')
    elif k == 'pass':
        fx_at('whoosh_whip', t, .32, align='peak', rate=[1, 1.15, .9, 1.25, 1.05, .95][e['i'] % 6], p=[-.5, .5][e['i'] % 2])
    elif k == 'tick':
        fx_at('msg_in', t, .55 * g, rate=[1, 1.12, 1.26, 1.33, 1.5, 1.68, 1.78, 2.0][e['i'] % 8])
    elif k == 'stamp':
        fx_at('stamp', t, .8 * g); fx_at('impact_deep2', t, .4, trim=.6)
    elif k == 'cash':
        fx_at('cash', t, .5 * g)
    elif k == 'mosh':
        fx_at('glitch_1', t, .45); fx_at('glitch_sfx', t + .2, 1.8)
        hit = next_section_start(t); riser_into(hit, hit - t, .3)
    elif k in ('msg_in', 'msg_out'):
        fx_at(k, t, 1.2 * g)

# risers into drops
for s, a, b in MUSIC:
    if s in ('build', 'build2'):
        riser_into(b * BAR - .25 * BAR, (b - a) * BAR - .25 * BAR, .28)
# vinyl bed: intro/hook + lofi
V = smp('vinyl')
for s, a, b in MUSIC:
    if s in ('intro', 'hook', 'lofi'):
        seg = V[:int((b - a) * BAR * SR)]
        place(lofi if s == 'lofi' else fx, seg, a * BAR, .5 if s == 'lofi' else .25)


# ================================================================ mix
ti = tt(N)
def sidechain(times, depth=.55, rel=.18):
    g = np.ones(N)
    for t in times:
        i = int(t * SR); n = min(N - i, int(.4 * SR))
        if n <= 0: continue
        g[i:i + n] = np.minimum(g[i:i + n], 1 - depth * np.exp(-tt(n) / (rel / 3)))
    return g[:, None]

sc = sidechain(kicks)
drums_b = compress(sat(filt(drums, 'high', 30), 1.3), -14, 3, .004, .08, 3)
bass_b = compress(bass, -12, 2.5, .005, .1, 2)
music_b = reverb(music, IR_ROOM, .22)
music_b = delay(music_b, BEAT * .75, .28, 4) * .9
music_b = shelf(filt(music_b, 'high', 160), 5000, 2)
fx_b = reverb(fx, IR_HALL, .18)

# intro/build filter sweep on the music bus
fc = np.full(N, 20000.0)
for s, a, b in MUSIC:
    i0, i1 = int(a * BAR * SR), min(N, int(b * BAR * SR))
    if s in ('intro', 'hook'):
        fc[i0:i1] = np.geomspace(700, 2500, i1 - i0)
    if s == 'build':
        fc[i0:i1] = np.geomspace(2500, 12000, i1 - i0)
music_b = lp_sweep(music_b, fc, 512)

# lofi bus: telephone + crush + wow
lof = filt(lofi, 'band', [280, 3600], 2)
wow = 1 + .004 * np.sin(2 * np.pi * .8 * ti)
pos = np.clip(np.cumsum(wow) - wow[0], 0, N - 1)
lof = np.stack([np.interp(pos, np.arange(N), lof[:, c]) for c in range(2)], 1)
lof = bitcrush(sat(lof, 2), 6, 4) * .8

mix = drums_b * 1.5 + bass_b * sc * .95 + music_b * sc * .9 + fx_b * .85 + lof * .55

# silence gaps before drops (last quarter bar of builds) except the risers/reverse crashes on fx
for s, a, b in MUSIC:
    if s in ('build', 'build2'):
        i0, i1 = int((b - .25) * BAR * SR), int(b * BAR * SR)
        mix[i0:i1] = (fx_b * .85)[i0:i1]

# tape stop into the lofi section
for s, a, b in MUSIC:
    if s == 'tapestop':
        i0, i1 = int(a * BAR * SR), int(b * BAR * SR); n = i1 - i0
        rate = np.linspace(1, 0, n) ** 1.6
        p = i0 + np.cumsum(rate)
        seg = np.stack([np.interp(p, np.arange(N), mix[:, c]) for c in range(2)], 1)
        mix[i0:i1] = seg * np.linspace(1, .3, n)[:, None]
        mix[i0:i1] += (fx_b * .85)[i0:i1] * 0  # (fx already in the stopped signal)

# master: glue, clip, limit, loudness
mix = shelf(filt(mix, 'high', 25), 7000, 2.5)
mix = compress(mix, -10, 2, .02, .2, 0)
mix = widen(mix, 1.15)
rms = np.sqrt((mix[int(.2 * N):int(.8 * N)] ** 2).mean())
mix *= 0.22 / rms  # ≈ -13 dBFS RMS before clip/limit
mix = sat(mix, 1.25) * 1.05
mix = limiter(mix, .93)
fo = int(1.5 * SR); mix[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 2
fi = int(.01 * SR); mix[:fi] *= np.linspace(0, 1, fi)[:, None]

out = os.path.join(HERE, f'soundtrack-{EDIT}.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(mix, -1, 1) * 32767).astype('<i2').tobytes())
print('wrote', out, f'{DUR:.1f}s', 'peak', round(float(np.abs(mix).max()), 3), 'rms', round(float(np.sqrt((mix ** 2).mean())), 3))
