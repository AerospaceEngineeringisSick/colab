"""LRWeb promo v4 score: hybrid cinematic, 120 BPM, D minor -> D major.

A real orchestra from CC0 sample libraries (VSCO 2 CE strings and brass; VCSL Steinway grand, timpani, drums
and cymbals; fetch them with `python tools/fetch_orchestra.py`), played by a small sampler with velocity layers,
round robins and onset alignment, in a synthetic concert hall. Modern punch comes from a hybrid drum bus
(orchestral drums layered with a sine kick and sub) and a low synth pulse. There are no bells, dings or triangles.

The arrangement follows the music sections in events.json and every sound effect lands on its cue
(written by timeline.js), so each cut, slam and wipe in the picture has a sound on the beat.

    python music.py landscape    -> soundtrack-landscape.wav
    python music.py vertical     -> soundtrack-vertical.wav   (same timeline, same score)
"""
import glob, json, os, re, sys, wave, warnings
from fractions import Fraction
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve, resample_poly
from scipy.ndimage import minimum_filter1d

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
EDIT = sys.argv[1] if len(sys.argv) > 1 else 'landscape'
EV = json.load(open(os.path.join(HERE, 'events.json')))[EDIT]
BPM = EV['bpm']; BEAT = 60 / BPM; BAR = 4 * BEAT; S16 = BAR / 16
DUR = EV['end']; N = int(DUR * SR)
rng = np.random.default_rng(7)
ORCH = os.path.join(HERE, 'samples', 'orch')
V2, VC = os.path.join(ORCH, 'VSCO-2-CE'), os.path.join(ORCH, 'VCSL')
if not os.path.isdir(V2):
    sys.exit('Orchestral samples missing: run  python tools/fetch_orchestra.py')
B = lambda bar: bar * BAR  # bars -> seconds


# ================================================================ dsp
def tt(n): return np.arange(n) / SR
def sos(kind, f, order=2): return butter(order, f, kind, fs=SR, output='sos')
def filt(x, kind, f, order=2): return sosfilt(sos(kind, f, order), x, axis=0)
def st(x): return np.stack([x, x], 1) if x.ndim == 1 else x
def sat(x, d=1.5): return np.tanh(x * d) / np.tanh(d)

def shelf(x, f, db, kind='high'):
    """RBJ shelving EQ."""
    A = 10 ** (db / 40); w = 2 * np.pi * f / SR; cw, sw = np.cos(w), np.sin(w); al = sw / 2 * np.sqrt(2)
    s = 1 if kind == 'high' else -1; sa = 2 * np.sqrt(A) * al
    b0 = A * ((A + 1) + s * (A - 1) * cw + sa); b1 = -2 * s * A * ((A - 1) + s * (A + 1) * cw); b2 = A * ((A + 1) + s * (A - 1) * cw - sa)
    a0 = (A + 1) - s * (A - 1) * cw + sa; a1 = 2 * s * ((A - 1) - s * (A + 1) * cw); a2 = (A + 1) - s * (A - 1) * cw - sa
    return sosfilt(np.array([[b0 / a0, b1 / a0, b2 / a0, 1, a1 / a0, a2 / a0]]), x, axis=0)

def peq(x, f, db, q=1.0):
    A = 10 ** (db / 40); w = 2 * np.pi * f / SR; al = np.sin(w) / (2 * q); cw = np.cos(w)
    b = [1 + al * A, -2 * cw, 1 - al * A]; a = [1 + al / A, -2 * cw, 1 - al / A]
    return sosfilt(np.array([[b[0] / a[0], b[1] / a[0], b[2] / a[0], 1, a[1] / a[0], a[2] / a[0]]]), x, axis=0)

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

def limiter(x, ceiling=.89, look=.005, release=.12):
    d = int(look * SR); need = np.minimum(1, ceiling / (np.abs(x).max(1) + 1e-9))
    g = minimum_filter1d(need, size=2 * d + 1)
    nb = 32; k = int(np.ceil(len(g) / nb)); gb = np.pad(g, (0, k * nb - len(g)), constant_values=1).reshape(k, nb).min(1)
    r = np.exp(-nb / (release * SR)); o = np.zeros(k); v = 1.0
    for i in range(k):
        v = gb[i] if gb[i] < v else r * v + (1 - r) * gb[i]; o[i] = v
    gs = np.interp(np.arange(len(g)), np.arange(k) * nb + nb / 2, o)
    return np.clip(x * np.minimum(gs, g)[:, None], -ceiling, ceiling)  # the centred min-window already looks ahead

def lufs(x):
    """Integrated loudness (BS.1770-style K-weighting and gating)."""
    k = shelf(filt(x, 'high', 60), 1500, 4.0)
    blk, hop = int(.4 * SR), int(.1 * SR)
    ms = np.array([(k[i:i + blk] ** 2).mean(0).sum() for i in range(0, len(k) - blk, hop)])
    l = -.691 + 10 * np.log10(ms + 1e-12); g = ms[l > -70]
    rel = -.691 + 10 * np.log10(g.mean() + 1e-12) - 10
    return -.691 + 10 * np.log10(g[(-.691 + 10 * np.log10(g + 1e-12)) > rel].mean() + 1e-12)

def place(buf, sig, t0, gain=1.0):
    sig = st(sig); i = int(round(t0 * SR))
    if i < 0: sig = sig[-i:]; i = 0
    j = min(len(buf), i + len(sig))
    if j > i: buf[i:j] += gain * sig[:j - i]

def panned(x, p):  # balance pan for stereo sources, constant power
    x = st(x); return x * np.array([np.cos((p + 1) * np.pi / 4), np.sin((p + 1) * np.pi / 4)]) * 1.414

def hall_ir(rt=2.4, pre=.022, seed=3):
    """Concert-hall impulse response: early reflections + a diffuse tail that darkens as it decays."""
    r = np.random.default_rng(seed); n = int(rt * 1.4 * SR); t = tt(n)
    nz = r.standard_normal((n, 2))
    dec = lambda T: np.exp(-6.91 * t / T)[:, None]
    lo = filt(nz, 'low', 350); mid = filt(filt(nz, 'high', 350), 'low', 3500); hi = filt(nz, 'high', 3500)
    late = lo * dec(rt * 1.2) + mid * dec(rt) + hi * dec(rt * .42) * .7
    late *= (1 - np.exp(-np.maximum(t - pre, 0) / .045))[:, None]; late[:int(pre * SR)] = 0
    er = np.zeros((n, 2))
    for k in range(24):
        d = pre * .5 + r.uniform(0, .085); g = .9 * np.exp(-d / .06) * r.uniform(.35, 1)
        er[int(d * SR), k % 2] += g * (1 if r.random() > .3 else -1)
    er = filt(er, 'low', 7000)
    ir = er * .5 + late * (1.0 / np.sqrt((late ** 2).sum(0).mean()))
    return ir / np.sqrt((ir ** 2).sum(0).mean())
IR = hall_ir()
IR_ROOM = hall_ir(.9, .008, 5)

def conv(x, ir): return np.stack([fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], 1)


# ================================================================ sampler
PC = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
def m(s):
    if isinstance(s, (int, np.integer)): return int(s)
    mt = re.fullmatch(r'([A-G][#b]?)(-?\d)', s); return PC[mt[1]] + 12 * (int(mt[2]) + 1)
def hz(n): return 440 * 2 ** ((m(n) - 69) / 12)

_RAW = {}
def readwav(path, maxlen=12.0):
    if path in _RAW: return _RAW[path]
    with warnings.catch_warnings():
        warnings.simplefilter('ignore'); sr, d = wavfile.read(path)
    if d.dtype == np.int16: x = d / 32768.
    elif d.dtype == np.int32: x = d / 2147483648.
    elif d.dtype == np.uint8: x = (d.astype(float) - 128) / 128.
    else: x = d.astype(float)
    x = st(x)[:, :2]
    if sr != SR: x = resample_poly(x, SR, sr, axis=0)
    e = np.abs(x).max(1); on = int(np.argmax(e > e.max() * .004)); x = x[max(0, on - int(.002 * SR)):]
    if maxlen and len(x) > maxlen * SR:
        x = x[:int(maxlen * SR)].copy(); f = int(.3 * SR); x[-f:] *= np.linspace(1, 0, f)[:, None]
    x = x.astype(np.float32)
    sm = np.convolve(np.abs(x).max(1), np.ones(220) / 220, 'same')[:int(.6 * SR)]
    lag = np.argmax(sm > sm.max() * .5) / SR  # perceived onset (bowed notes speak late)
    peak = float(np.abs(x).max()) + 1e-9; rms = float(np.sqrt((x[:int(1.5 * SR)] ** 2).mean())) + 1e-9
    _RAW[path] = (x, lag, peak, rms); return _RAW[path]

_PIT = {}
def pitched(path, semis):
    x = readwav(path)[0]
    if abs(semis) < 1e-3: return x
    key = (path, round(semis, 3))
    if key not in _PIT:
        fr = Fraction(2 ** (semis / 12)).limit_denominator(240)
        _PIT[key] = resample_poly(x, fr.denominator, fr.numerator, axis=0).astype(np.float32)
    return _PIT[key]

class Inst:
    """Multi-sampled instrument. regex needs a group n (note, e.g. C#3) and optionally v (velocity layer)."""
    def __init__(self, folder, regex, shift=0, norm='rms', lagcap=.1, pan=0., gain=1., maxlen=12.0, fixed=None):
        self.z = {}; self.norm, self.lagcap, self.pan, self.gain, self.maxlen = norm, lagcap, pan, gain, maxlen
        for f in sorted(glob.glob(os.path.join(folder, '*.wav'))):
            mt = re.search(regex, os.path.basename(f))
            if not mt: continue
            root = fixed[mt['n']] if fixed else m(mt['n']) + 12 * shift
            v = int(mt.groupdict().get('v') or 1)
            self.z.setdefault(root, {}).setdefault(v, []).append(f)
        assert self.z, f'no samples in {folder}'
        self.roots = np.array(sorted(self.z)); self.rr = 0

    def render(self, note, dur, vel=.8, att=0., rel=.3, cres=None):
        n = m(note); root = int(self.roots[np.argmin(np.abs(self.roots - n) + (self.roots > n) * .01)])
        layers = sorted(self.z[root]); L = len(layers)
        pos = vel * (L - 1) if L > 1 else 0; i0 = int(np.floor(pos)); i1 = min(L - 1, i0 + 1); w = pos - i0
        self.rr += 1; out = None; lag = 0
        for li, wt in ((i0, 1 - w), (i1, w)):
            if wt < .01: continue
            files = self.z[root][layers[li]]; f = files[self.rr % len(files)]
            x, lg, pk, rms = readwav(f, self.maxlen); x = pitched(f, n - root)
            g = (.9 / pk if self.norm == 'peak' else .12 / rms) * (.55 + .45 * li / max(1, L - 1))
            x = x * (g * wt)
            if out is None: out = x
            else: k = min(len(out), len(x)); out = out[:k] + x[:k]
            lag = max(lag, lg * 2 ** (-(n - root) / 12))
        total = int((dur + rel) * SR)
        y = np.zeros((total, 2), np.float32); k = min(total, len(out)); y[:k] = out[:k]
        e = np.ones(total, np.float32)
        if att > 0: a = min(total, int(att * SR)); e[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
        if cres is not None: c = np.interp(tt(total), [0, dur], cres).astype(np.float32); e *= c
        r0 = min(total, int(dur * SR)); e[r0:] *= np.cos(np.linspace(0, np.pi / 2, total - r0)) ** 1.5
        amp = self.gain * (.1 + .9 * vel ** 1.7)
        return y * (e * amp)[:, None], (0 if att > 0 else min(lag, self.lagcap))

    def play(self, bus, t, note, dur, vel=.8, att=0., rel=.3, pan=None, cres=None, gain=1.):
        y, lag = self.render(note, dur, vel, att, rel, cres)
        place(bus, panned(y, self.pan if pan is None else pan), t - lag, gain)

S2 = lambda *p: os.path.join(V2, *p)
C2 = lambda *p: os.path.join(VC, *p)
NT = r'(?P<n>[A-G]#?\d)'
VLN = Inst(S2('Strings', 'Violin Section', 'susVib'), rf'VlnEns_susVib_{NT}_v(?P<v>\d)', 1, pan=-.45, lagcap=.12)
VLA = Inst(S2('Strings', 'Viola Section', 'susvib'), rf'ViolaEns_susvib_{NT}_v(?P<v>\d)', 1, pan=-.1, lagcap=.12)
VC_ = Inst(S2('Strings', 'Cello Section', 'susvib'), rf'susvib_{NT}_v(?P<v>\d)', 1, pan=.3, lagcap=.12)
CB = Inst(S2('Strings', 'Solo Contrabass', 'SusVib'), rf'BKCtbss_SusVib_{NT}_v(?P<v>\d)', 1, pan=.5, lagcap=.12, gain=.8)
VLN_SP = Inst(S2('Strings', 'Violin Section', 'Spic'), rf'VlnEns_Spic_{NT}_v2', 1, norm='peak', pan=-.4, lagcap=.03)
VLA_SP = Inst(S2('Strings', 'Viola Section', 'spic'), rf'Violas_spic_{NT}_v2', 1, norm='peak', pan=-.05, lagcap=.03)
VC_SP = Inst(S2('Strings', 'Cello Section', 'spic'), rf'spic_{NT}_v2', 1, norm='peak', pan=.3, lagcap=.03)
VLN_TR = Inst(S2('Strings', 'Violin Section', 'Trem'), rf'VlnEns_Trem_{NT}_v(?P<v>\d)', 1, pan=-.4, lagcap=.05)
VC_TR = Inst(S2('Strings', 'Cello Section', 'trem'), rf'trem_{NT}_v(?P<v>\d)', 1, pan=.3, lagcap=.05)
VLA_PZ = Inst(S2('Strings', 'Viola Section', 'pizz'), rf'ViolaEns_pizz_{NT}_v(?P<v>\d)', 1, norm='peak', pan=-.1, lagcap=.02)
VC_PZ = Inst(S2('Strings', 'Cello Section', 'pizzT'), rf'pizzT_{NT}_v(?P<v>\d)', 1, norm='peak', pan=.3, lagcap=.02)
HN = Inst(S2('Brass', 'F Horn', 'sus'), rf'MOHorn_sus_{NT}_v(?P<v>\d)', 1, pan=-.25, lagcap=.08)
TBN = Inst(S2('Brass', 'Tenor Trombone', 'sus'), rf'tenortbn_sus_{NT}_v(?P<v>\d)', 1, pan=.2, lagcap=.06)
TBA = Inst(S2('Brass', 'Tuba', 'sus'), rf'Tuba3_sus_{NT}_v(?P<v>\d)', 1, pan=.35, lagcap=.06, gain=.9)
PNO = Inst(C2('Chordophones', 'Zithers', 'Grand Piano, Steinway B', 'Sus'), rf'JHPiano_Sus_Close_{NT}_vl(?P<v>\d)', 0, norm='peak', lagcap=.01, maxlen=9.0)
TIMP_F = {'Timpani1': 138.6, 'Timpani2': 180.3, 'Timpani3': 211.5, 'Timpani4': 247.0, 'Timpani5': 282.3}  # measured principal tones

def one(path, maxlen=12.0):
    x, lag, pk, rms = readwav(path, maxlen); return x / pk
def pick(pattern, i=0):
    fs = sorted(glob.glob(pattern)); assert fs, pattern; return fs[i % len(fs)]
PERC = C2('Membranophones', 'Struck Membranophones')
def timp(bus, t, note, vel=1., gain=1.):
    f = hz(note); name = min(TIMP_F, key=lambda k: abs(np.log2(f / TIMP_F[k])))
    fs = sorted(glob.glob(os.path.join(PERC, 'Timpani 1', 'Hit', f'{name}_Hit_v{4 if vel > .7 else 3}_*.wav')))
    x = one(fs[int(t * 7) % len(fs)]); fr = Fraction(f / TIMP_F[name]).limit_denominator(240)
    place(bus, panned(resample_poly(x, fr.denominator, fr.numerator, axis=0), .15), t - .004, gain * (.35 + .65 * vel))
def timp_roll(bus, t0, t1, note, g0=.1, g1=1., gain=1.):
    f = hz(note); x = one(pick(os.path.join(PERC, 'Timpani 1', 'Roll', 'Timpani3_Roll_v5_*.wav')), 30)
    fr = Fraction(f / 147.2).limit_denominator(240); x = resample_poly(x, fr.denominator, fr.numerator, axis=0)
    n = int((t1 - t0) * SR); x = x[int(.3 * SR):int(.3 * SR) + n]
    place(bus, x * np.geomspace(g0, g1, len(x))[:, None], t0, gain)
BD2 = [one(C2('Membranophones', 'Struck Membranophones', 'Bass Drum 2', f'bassdrum_hit_{v}.wav')) for v in ('f', 'ff')]
BD1 = [one(p) for p in sorted(glob.glob(os.path.join(PERC, 'Bass Drum 1', '*.wav')))]
TOML = [one(p) for p in sorted(glob.glob(os.path.join(PERC, 'Tom 1', '*', 'TomL_HitM_v4*.wav')) + glob.glob(os.path.join(PERC, 'Tom 2', '*', 'TomL_HitM_v4*.wav')))]
TOMH = [one(p) for p in sorted(glob.glob(os.path.join(PERC, 'Tom 1', '*', 'TomH_HitM_v4*.wav')))]
SNR = [one(p) for p in sorted(glob.glob(os.path.join(PERC, 'Snare Drum, Modern 1', 'Snare2_HitSN_v9*.wav')))]
SNR_S = [one(p) for p in sorted(glob.glob(os.path.join(PERC, 'Snare Drum, Modern 1', 'Snare2_HitSN_v5*.wav')))]
SNR_ROLL = one(pick(os.path.join(PERC, 'Snare Drum, Modern 1', 'Snare2_rollSN_v5*.wav')), 20)
FRAME = [one(p) for p in sorted(glob.glob(os.path.join(PERC, 'Frame Drum', 'HDrumL_Hit_v3*.wav')))]
IDIO = C2('Idiophones', 'Struck Idiophones')
CRASH = one(os.path.join(IDIO, 'Clash Cymbals 1', 'cymbal_crash1_ff2.wav'))
CRASH_M = one(os.path.join(IDIO, 'Clash Cymbals 1', 'cymbal_crash1_mf1.wav'))
SUS_HIT = one(os.path.join(IDIO, 'Suspended Cymbal 1', 'susCymb1_hit_fff1.wav'))
SUS_CRESC = {s: one(os.path.join(IDIO, 'Suspended Cymbal 1', f'susCymb1_cresc_{s}.wav')) for s in ('2s', '4s', '7.5s')}
GONG = one(os.path.join(IDIO, 'Gong 1', 'gong_fff.wav'), 14)

def peak_t(x):
    e = np.convolve(np.abs(x).max(1), np.ones(441) / 441, 'same'); return np.argmax(e) / SR
def swell_into(bus, t_hit, key='4s', gain=.5):  # cymbal crescendo whose peak lands on the hit
    x = SUS_CRESC[key]; pk = peak_t(x); y = x[:int(pk * SR)].copy(); f = int(.02 * SR); y[-f:] *= np.linspace(1, 0, f)[:, None]
    place(bus, y, t_hit - pk, gain)
def ekick(bus, t, gain=1., f0=110, f1=42, dec=.38):
    n = int(.7 * SR); tt_ = tt(n); f = f1 + (f0 - f1) * np.exp(-tt_ / .035)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt_ / dec) * np.minimum(1, tt_ / .0015)
    place(bus, sat(x, 1.8), t, gain)
def sub_boom(bus, t, note='D1', gain=1., length=2.4):
    n = int(length * SR); tt_ = tt(n); f = hz(note) * (1 + .6 * np.exp(-tt_ / .08))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt_ / (length / 3.5)) * np.minimum(1, tt_ / .004)
    place(bus, sat(x, 1.4), t, gain)
def noise_sweep(length, f0, f1, f2=None, q=1.2):
    """Band-limited noise whose band sweeps f0 -> f1 (-> f2); used for whooshes and risers."""
    n = int(length * SR); p = tt(n) / length
    fc = f0 * (f1 / f0) ** p if f2 is None else np.where(p < .6, f0 * (f1 / f0) ** (p / .6), f1 * (f2 / f1) ** ((p - .6) / .4))
    x = rng.standard_normal((n, 2)); y = np.zeros_like(x); zi = np.zeros((1, 2, 2))
    blk = 256
    for i in range(0, n, blk):
        c = float(np.clip(fc[i], 60, 14000)); s = butter(1, [c / (1 + .5 / q), min(c * (1 + .5 / q), SR * .48)], 'band', fs=SR, output='sos')
        y[i:i + blk], zi = sosfilt(s, x[i:i + blk], axis=0, zi=zi)
    return y
def whoosh(bus, t_peak, length=1.0, gain=.3, f0=250, f1=2600, f2=400, pan_sweep=True):
    y = noise_sweep(length, f0, f1, f2); p = tt(len(y)) / length
    envl = np.where(p < .6, (p / .6) ** 2.2, np.exp(-(p - .6) / .1)); y *= envl[:, None]
    if pan_sweep: a = (p - .5) * 1.4; y = y * np.stack([np.cos((a + 1) * np.pi / 4), np.sin((a + 1) * np.pi / 4)], 1) * 1.414
    place(bus, y / (np.abs(y).max() + 1e-9), t_peak - .6 * length, gain)
def reverse_swell(bus, t_hit, src, length=1.2, gain=.6):
    """Reverse reverb of a chord (a 'suck' into the downbeat)."""
    wet = conv(np.concatenate([src, np.zeros((int(3 * SR), 2))]), IR)[:int(3.5 * SR)]
    y = wet[::-1][-int(length * SR):].copy(); y /= np.abs(y).max() + 1e-9
    f = int(.3 * SR); y[:f] *= np.linspace(0, 1, f)[:, None]
    place(bus, y, t_hit - len(y) / SR, gain)


# ================================================================ harmony and themes
VOICE = {
    'Dm': ['D2', 'D3', 'A3', 'F4', 'A4', 'D5'], 'Bb': ['Bb1', 'Bb2', 'F3', 'D4', 'F4', 'Bb4'], 'C': ['C2', 'C3', 'G3', 'E4', 'G4', 'C5'],
    'Gm': ['G1', 'G2', 'D3', 'Bb3', 'D4', 'G4'], 'A': ['A1', 'A2', 'E3', 'C#4', 'E4', 'A4'], 'D': ['D2', 'D3', 'A3', 'F#4', 'A4', 'D5'],
    'A/C#': ['C#2', 'C#3', 'A3', 'E4', 'A4', 'C#5'], 'Bm': ['B1', 'B2', 'F#3', 'D4', 'F#4', 'B4'], 'G': ['G1', 'G2', 'D3', 'B3', 'D4', 'G4'],
    'Em7': ['E2', 'E3', 'B3', 'D4', 'G4', 'B4'], 'G/D': ['D2', 'D3', 'B3', 'D4', 'G4', 'B4'],
    # the lift: theme B and the ending sit a whole step up, in E major
    'E': ['E2', 'E3', 'B3', 'G#4', 'B4', 'E5'], 'B/D#': ['D#2', 'D#3', 'B3', 'F#4', 'B4', 'D#5'], 'C#m': ['C#2', 'C#3', 'G#3', 'E4', 'G#4', 'C#5'],
    'F#m7': ['F#2', 'F#3', 'C#4', 'E4', 'A4', 'C#5'], 'B': ['B1', 'B2', 'F#3', 'D#4', 'F#4', 'B4'], 'A/E': ['E2', 'E3', 'A3', 'C#4', 'E4', 'A4'],
}
PROG = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Bb', 'Gm', 'A', 'D', 'A/C#', 'Bm', 'G', 'D', 'A/C#', 'G', 'A',
        'Bm', 'G', 'D', 'B', 'E', 'B/D#', 'C#m', 'A', 'F#m7', 'B', 'E', 'A/E', 'E', 'E']
ch = lambda bar: VOICE[PROG[min(len(PROG) - 1, int(bar))]]
root = lambda bar, octv=0: m(ch(bar)[0]) + 12 * octv
# the theme, as (beat, note, beats) from the start of a phrase
PH1 = [(0, 'A4', 1.5), (1.5, 'F#4', .5), (2, 'A4', 1), (3, 'D5', 1), (4, 'E5', 2), (6, 'C#5', 1), (7, 'A4', 1),
       (8, 'B4', 1.5), (9.5, 'A4', .5), (10, 'F#4', 1), (11, 'B4', 1), (12, 'A4', 2.5), (14.5, 'G4', .5), (15, 'F#4', .5), (15.5, 'G4', .5)]
PH2 = [(4, 'A4', 1), (5, 'B4', 1), (6, 'C#5', 1), (7, 'E5', 1), (8, 'D5', 2), (10, 'B4', 1), (11, 'D5', 1),
       (12, 'C#5', 2.5), (14.5, 'B4', .5), (15, 'C#5', .5), (15.5, 'E5', .5)]
PH_END = [(0, 'B4', 1.5), (1.5, 'A4', .5), (2, 'G4', 1), (3, 'B4', 1), (4, 'C#5', 2), (6, 'E5', 1), (7, 'G5', 1)]
BREAK = [(0, 'D5', 2), (2, 'C#5', 1), (3, 'B4', 1), (4, 'D5', 3), (7, 'B4', 1), (8, 'A4', 2), (10, 'F#4', 1), (11, 'A4', 1), (12, 'E5', 3), (15, 'C#5', 1)]
up = lambda n, k=12: m(n) + k

MUSIC = {s: (a, a + l) for s, a, l in EV['music']}
bus = {k: np.zeros((N, 2), np.float32) for k in ('str', 'spic', 'brass', 'pno', 'perc', 'hyb', 'fx', 'pad')}

def pad(b0, b1, vel, att=.4, rel=.8, sections=('cb', 'vc', 'vla', 'vln'), cres=None, top=True):
    """Sustained string chords, one per bar, voiced across the sections by register."""
    for bar in range(int(b0), int(np.ceil(b1))):
        t0 = B(max(bar, b0)); d = B(min(bar + 1, b1)) - t0; v = ch(bar)
        for i, note in enumerate(v if top else v[:-1]):
            n = m(note); c = cres(bar) if cres else None
            if n < 43 and 'cb' in sections: CB.play(bus['str'], t0, n, d, vel, att, rel, cres=c)
            if 36 <= n < 57 and 'vc' in sections: VC_.play(bus['str'], t0, n + (12 if n < 40 else 0), d, vel, att, rel, cres=c)
            if 55 <= n < 68 and 'vla' in sections: VLA.play(bus['str'], t0, n, d, vel * .95, att, rel, cres=c)
            if n >= 64 and 'vln' in sections: VLN.play(bus['str'], t0, n, d, vel * .9, att, rel, cres=c, gain=.9)

def ostinato(b0, b1, vel, div=16, acc=(0, 3, 6, 8, 11, 14), insts=('vc', 'vla'), rise=0.):
    """Spiccato engine: root/fifth/octave figure with 3-3-2 accents."""
    fig = [0, 0, 7, 0, 0, 7, 0, 12, 0, 0, 7, 0, 0, 7, 0, 12]
    step = BAR / div
    for k in range(int(round((b1 - b0) * div))):
        t = B(b0) + k * step; bar = b0 + k / div; i16 = k % div * (16 // div)
        r = root(bar, 1) if root(bar) < 38 else root(bar)
        r = r + 12 if r < 45 else r
        n = r + fig[i16]; a = 1 if i16 in acc else .62
        v = min(1, vel * a * (1 + rise * (bar - b0) / max(1e-6, b1 - b0)))
        if 'vc' in insts: VC_SP.play(bus['spic'], t, n - 12 if n >= 57 else n, step * 1.4, v, rel=.12)
        if 'vla' in insts: VLA_SP.play(bus['spic'], t, n + 12 if n < 55 else n, step * 1.4, v * .8, rel=.12)
        if 'vln' in insts: VLN_SP.play(bus['spic'], t, n + 12 if n < 67 else n, step * 1.4, v * .7, rel=.12)

def melody(bar0, phrase, inst, vel, octv=0, rel=.35, bus_='brass', gain=1., until=None):
    for beat, note, ln in phrase:
        t = B(bar0) + beat * BEAT
        if until is not None and t >= B(until): continue
        inst.play(bus[bus_], t, up(note, octv), ln * BEAT * 1.02, vel, rel=rel, gain=gain)

def arp(b0, b1, vel, octv=0, pattern=(0, 2, 1, 2, 3, 2, 1, 2), div=8):
    """Piano arpeggio over the bar's chord (8ths)."""
    for k in range(int(round((b1 - b0) * div))):
        bar = b0 + k / div; v = ch(bar); tones = [m(v[1]), m(v[2]), m(v[3]), m(v[5])]
        n = tones[pattern[k % len(pattern)]] + 12 * octv
        PNO.play(bus['pno'], B(b0) + k * BAR / div, n, BAR / div * 3, vel * (1 if k % 4 == 0 else .8), rel=.5)

def drums(b0, b1, style='full', vel=1.):
    """Hybrid trailer groove on a 16th grid (orchestral drums + a sine kick for punch)."""
    PAT = {'full': {'bd': (0, 6, 10), 'sn': (8,), 'tl': (3, 7, 14, 15), 'th': (11, 12), 'tp': (0,)},
           'half': {'bd': (0,), 'sn': (8,), 'tl': (14,), 'th': (), 'tp': (0,)},
           'pulse': {'bd': (0, 8), 'sn': (), 'tl': (), 'th': (), 'tp': ()},
           'toms': {'bd': (0, 8), 'sn': (), 'tl': (0, 3, 6, 8, 11, 14), 'th': (4, 12), 'tp': (0,)},
           'drive': {'bd': (0, 6, 10), 'sn': (4, 12), 'tl': (14, 15), 'th': (7,), 'tp': (0,)}}[style]
    for bar in range(int(b0), int(np.ceil(b1))):
        for k in range(16):
            t = B(bar) + k * S16
            if t < B(b0) - 1e-6 or t >= B(b1) - 1e-6: continue
            if k in PAT['bd']:
                place(bus['perc'], BD2[k % 2], t, .6 * vel); place(bus['perc'], BD1[(bar + k) % len(BD1)], t, .3 * vel)
                ekick(bus['hyb'], t, .16 * vel * (1 if k == 0 else .75))
            if k in PAT['sn']: place(bus['perc'], panned(SNR[bar % len(SNR)], .05), t, .55 * vel)
            if k in PAT['tl']: place(bus['perc'], panned(TOML[(bar * 3 + k) % len(TOML)], .25), t, .45 * vel * (1 if k != 15 else .8))
            if k in PAT['th']: place(bus['perc'], panned(TOMH[(bar + k) % len(TOMH)], -.25), t, .35 * vel)
            if k in PAT['tp']: timp(bus['perc'], t, root(bar, 1) if root(bar) < 43 else root(bar), .9 * vel, .6)

def brass_chord(t, bar, dur, vel, att=0., cres=None, low=True, high=True):
    v = ch(bar)
    if low:
        TBA.play(bus['brass'], t, m(v[0]) + (12 if m(v[0]) < 36 else 0), dur, vel, att, .6, cres=cres)
        for n in v[1:3]: TBN.play(bus['brass'], t, m(n) if m(n) >= 40 else m(n) + 12, dur, vel * .9, att, .5, cres=cres)
    if high:
        for n in v[2:5]: HN.play(bus['brass'], t, m(n) if m(n) < 72 else m(n) - 12, dur, vel * .85, att, .6, cres=cres)

def synth_pulse(b0, b1, gain=.12, cutoff=700):
    """Low analog-style pulse in 8ths (filtered saw), felt more than heard."""
    for k in range(int(round((b1 - b0) * 8))):
        bar = b0 + k / 8; f = hz(root(bar) if root(bar) >= 36 else root(bar) + 12)
        n = int(BAR / 8 * SR * .9); t_ = tt(n); ph = np.cumsum(np.full(n, f)) / SR
        saw = 2 * (ph % 1) - 1 + .6 * (2 * ((ph * 1.005) % 1) - 1)
        e = np.exp(-t_ / .09) * (1 - np.exp(-t_ / .002))
        x = saw * e; dk = filt(x, 'low', cutoff); br = filt(x, 'low', cutoff * 3); x = dk + (br - dk) * np.exp(-t_ / .05)  # filter envelope
        place(bus['hyb'], x, B(b0) + k * BAR / 8, gain * (1 if k % 2 == 0 else .7))


# ================================================================ the score
# INTRO (0-4): a dot, a line, a cursor typing in pizzicato; the pad opens; "jobs." lands; iris
pad(.5, 2, .35, att=1.6, sections=('cb', 'vc'))
pad(1, 2, .3, att=1.2, sections=('vla',))
pad(2, 4, .42, att=.5, sections=('cb', 'vc', 'vla', 'vln'), cres=lambda b: (.8, 1.1))
synth_pulse(2, 4, .08, 500)
PNO.play(bus['pno'], B(2.5), 'D2', 3.0, .7, rel=1.5); PNO.play(bus['pno'], B(2.5), 'A2', 3.0, .55, rel=1.5)
drums(3, 4, 'pulse', .55)

# BUILD (4-8): the pile-up. Spiccato engine, slams every half bar, snare rush, the question, silence
ostinato(4, 5, .42, div=8); ostinato(5, 7, .55, rise=.55); ostinato(7, 7.75, .85, insts=('vc', 'vla', 'vln'))
pad(4, 7, .4, att=.3, sections=('cb', 'vc', 'vla'), cres=lambda b: (.7 + .1 * (b - 4), .8 + .1 * (b - 4)))
VLN_TR.play(bus['str'], B(6), 'D5', B(1), .5, att=.8, rel=.3, cres=(.6, 1.1)); VLN_TR.play(bus['str'], B(6), 'A5', B(1), .45, att=.8, rel=.3, cres=(.6, 1.1))
synth_pulse(4, 7.75, .08, 800)
drums(5, 6, 'toms', .5); drums(6, 7, 'toms', .68)
brass_chord(B(6), 6, B(1), .55, att=.6, cres=(.5, 1.1))
# the question (bar 7): everything holds on the dominant and swells
brass_chord(B(7), 7, B(.75), .75, att=.3, cres=(.5, 1.25))
pad(7, 7.75, .7, att=.2, cres=lambda b: (.6, 1.2))
VLN_TR.play(bus['str'], B(7), 'E5', B(.75), .7, att=.2, rel=.15, cres=(.5, 1.2)); VLN_TR.play(bus['str'], B(7), 'A5', B(.75), .7, att=.2, rel=.15, cres=(.5, 1.2))
VC_TR.play(bus['str'], B(7), 'A2', B(.75), .8, att=.2, rel=.15, cres=(.5, 1.2))
timp_roll(bus['perc'], B(7), B(7.75), 'A2', .05, 1., .9)
swell_into(bus['perc'], B(7.75), '2s', .55)
place(bus['perc'], SNR_ROLL[:int(B(.5) * SR)] * np.geomspace(.08, 1, int(B(.5) * SR))[:, None], B(7.25), .35)

# THEME A (8-16): the drop, the logo, the split screen, the old site, the rebuild
def big_hit(t, bar, g=1.):
    brass_chord(t, bar, B(1.5), .95 * g, cres=(1.1, .55))
    pad(bar, bar + 1, .8 * g, att=0., cres=lambda b: (1.2, .7))
    place(bus['perc'], GONG, t, .45 * g); place(bus['perc'], CRASH, t, .45 * g); place(bus['perc'], BD2[1], t, 1.0 * g)
    timp(bus['perc'], t, root(bar, 1) if root(bar) < 43 else root(bar), 1., .9 * g); sub_boom(bus['hyb'], t, root(bar) % 12 + 24, .4 * g); ekick(bus['hyb'], t, .3 * g, 140, 38, .6)
big_hit(B(8), 8)
melody(8, PH1, HN, .85, gain=1.1)
melody(8, PH1, VLN, .6, octv=0, bus_='str', gain=.5)
pad(9, 11, .62, att=.15)
ostinato(8, 11, .8, div=8, insts=('vc', 'vla'))
drums(8, 10, 'full', .85); drums(10, 11, 'half', .75)
arp(8, 11, .45)
synth_pulse(8, 11, .13, 900)
place(bus['perc'], CRASH_M, B(10), .35)
# the old site (11-12): light, a little comic; the explode (12-13): tension; the rebuild (13): hit
arp(11, 12, .5, octv=1, pattern=(0, 1, 2, 3, 2, 1, 2, 1))
pad(11, 12, .4, att=.1, sections=('vc', 'vla', 'vln'))
place(bus['perc'], BD2[0], B(11), .5)
pad(12, 13, .5, att=.2, cres=lambda b: (.5, 1.3))
VLN_TR.play(bus['str'], B(12), 'F#5', B(1), .6, att=.5, cres=(.4, 1.2)); VLN_TR.play(bus['str'], B(12), 'A5', B(1), .6, att=.5, cres=(.4, 1.2))
ostinato(12, 13, .75, rise=.4, insts=('vc', 'vla'))
timp_roll(bus['perc'], B(12.25), B(13), 'A2', .05, .9, .8); swell_into(bus['perc'], B(13), '2s', .5)
big_hit(B(13), 13, .8)
melody(12, PH2, HN, .85, gain=1.05); melody(12, PH2, VLN, .7, octv=12, bus_='str', gain=.6)
pad(14, 16, .7, att=.1)
ostinato(13, 15.75, .85, insts=('vc', 'vla', 'vln'))
drums(13, 15.5, 'full', .82); arp(13, 15.75, .5)
synth_pulse(13, 15.75, .13, 1000)
for k in range(8): place(bus['perc'], panned(TOML[k % len(TOML)] if k % 2 else TOMH[k % len(TOMH)], (k % 3 - 1) * .3), B(15.5) + k * S16, .3 + .05 * k)

# BREAK (16-20): the dashboard. It keeps a pulse: piano melody, pizzicato ostinato, a soft half-time beat; then a D -> B pivot
def stabs(b0, b1, vel, pos=(0, 3, 6, 10, 12)):
    """The theme-B hook: syncopated spiccato chord stabs across the whole string section."""
    for bar in range(int(b0), int(np.ceil(b1))):
        v = ch(bar)
        for k in pos:
            t = B(bar) + k * S16
            if t < B(b0) - 1e-6 or t >= B(b1) - 1e-6: continue
            a = 1 if k in (0, 6) else .78
            for n in v[2:5]: VLA_SP.play(bus['spic'], t, m(n) if m(n) < 74 else m(n) - 12, S16 * 1.6, vel * a, rel=.1, gain=.9)
            VLN_SP.play(bus['spic'], t, m(v[5]), S16 * 1.6, vel * a, rel=.1, gain=.85)
            VC_SP.play(bus['spic'], t, root(bar, 1) if root(bar) < 45 else root(bar), S16 * 1.6, vel * a, rel=.1, gain=1.0)
melody(16, BREAK, PNO, .58, bus_='pno', rel=.8)
arp(16, 19, .3, octv=-1, pattern=(0, 1, 2, 1))
pad(16, 20, .4, att=.6, sections=('cb', 'vc', 'vla', 'vln'))
ostinato(16, 19, .45, div=8, insts=('vc',))
for k in range(24):  # pizzicato ostinato: root, fifth, octave, fifth
    bar = 16 + k / 8; r0 = root(bar, 1) if root(bar) < 45 else root(bar)
    VC_PZ.play(bus['fx'], B(16) + k * BAR / 8, r0 + [0, 7, 12, 7][k % 4], .3, .5 + .15 * (k % 4 == 0), rel=.2, gain=.45)
drums(16, 19, 'half', .5)
synth_pulse(16, 19, .09, 700)
# riser into drop 2, pivoting to B (the dominant of E)
ostinato(19, 19.875, .7, rise=.6, insts=('vc', 'vla', 'vln'))
brass_chord(B(19), 19, B(.875), .65, att=.8, cres=(.3, 1.25))
VLN_TR.play(bus['str'], B(19), 'F#5', B(.875), .6, att=.5, cres=(.3, 1.25)); VLN_TR.play(bus['str'], B(19), 'D#6', B(.875), .5, att=.5, cres=(.3, 1.25))
timp_roll(bus['perc'], B(19), B(19.875), 'B2', .05, 1., .9); swell_into(bus['perc'], B(19.875), '2s', .5)
place(bus['perc'], SNR_ROLL[:int(B(.75) * SR)] * np.geomspace(.05, 1, int(B(.75) * SR))[:, None], B(19.125), .45)

# THEME B (20-26): up a whole step. Violins sing the theme an octave up, horns double it, trombones hold a counter-line,
# the strings stab a new syncopated hook, and the drums finally play a real backbeat
big_hit(B(20), 20, 1.05)
melody(20, PH1, VLN, .82, octv=14, bus_='str', gain=.75); melody(20, PH1, HN, .88, octv=2, gain=.95)
melody(24, PH_END, VLN, .8, octv=14, bus_='str', gain=.75); melody(24, PH_END, HN, .85, octv=2, gain=.9)
for bar in range(20, 26):
    n = m(ch(bar)[2]); TBN.play(bus['brass'], B(bar), n if n >= 40 else n + 12, BAR * 1.02, .6, rel=.4, gain=.7)
pad(21, 26, .7, att=.12)
stabs(20, 24, .85); stabs(24, 25, .7, pos=(0, 6)); ostinato(25, 25.75, .85, insts=('vc', 'vla', 'vln'), rise=.4)
drums(20, 24, 'drive', 1.0); drums(24, 25, 'half', .8); drums(25, 25.75, 'toms', .95)
arp(20, 24, .5, octv=0); synth_pulse(20, 25.75, .13, 1200)
for b in (20, 22, 24): place(bus['perc'], CRASH_M if b > 20 else CRASH, B(b), .4)
brass_chord(B(25.25), 25, B(.5), .8, att=.15, cres=(.7, 1.2))
swell_into(bus['perc'], B(25.75), '2s', .45)

# OUTRO (26-30): the dawn, the logo, the address. Final hit in E and a long, warm ring-out
big_hit(B(26), 26, 1.05)
HN.play(bus['brass'], B(26), 'G#4', B(2), .8, rel=1.5, cres=(1.1, .5)); VLN.play(bus['str'], B(26), 'G#5', B(3.5), .6, rel=2, cres=(1.0, .4))
VLN.play(bus['str'], B(26), 'E6', B(3), .45, rel=2, cres=(.9, .3))
pad(27, 29.6, .45, att=.8, rel=2.5, cres=lambda b: (.8, .5))
for k, n in enumerate(['E3', 'B3', 'E4', 'G#4', 'B4', 'E5', 'F#5', 'G#5']):
    PNO.play(bus['pno'], B(27) + k * BEAT * .5, n, 4.0, .38 - .02 * k, rel=2.5)
PNO.play(bus['pno'], B(28.5), 'E4', 5.0, .3, rel=3); PNO.play(bus['pno'], B(28.5), 'B4', 5.0, .28, rel=3); PNO.play(bus['pno'], B(28.5), 'G#5', 5.0, .26, rel=3)
sub_boom(bus['hyb'], B(27.5), 'E1', .15, 3)


# ================================================================ sound design, on the cues
def pizz_note(t, bar, i, g=1.):
    v = ch(bar); n = [m(v[3]), m(v[4]), m(v[5]), m(v[4])][i % 4]
    VLA_PZ.play(bus['fx'], t, n, .5, .55, rel=.3, pan=[-.35, .35, -.15, .2][i % 4], gain=.8 * g)
for e in EV['sfx']:
    t, k, g, i, bar = e['t'], e['kind'], e['gain'], e.get('i', 0), e['bar']
    if k == 'dot':
        sub_boom(bus['fx'], t, 'D2', .2, 1.6); reverse_swell(bus['fx'], t, PNO.render('D4', 1.0, .5, rel=.5)[0] + PNO.render('A4', 1.0, .4, rel=.5)[0], .9, .2)
        PNO.play(bus['pno'], t, 'D5', 2.0, .32, rel=1.5); PNO.play(bus['pno'], t, 'A5', 2.0, .22, rel=1.5)
    elif k == 'swipe': whoosh(bus['fx'], t + .12, .55, .16 * g, 400, 3500, 700)
    elif k == 'type':  # the cursor types in pizzicato
        notes = ['D4', 'F4', 'A4', 'D5', 'A4', 'F4', 'E4', 'F4', 'A4', 'C5', 'A4', 'F4', 'D4']
        (VLA_PZ if m(notes[i]) >= 60 else VC_PZ).play(bus['fx'], t, notes[i], .4, .5 + .2 * (i % 4 == 0), rel=.25, pan=-.5 + i / 12, gain=.55)
    elif k == 'hit':
        place(bus['fx'], BD2[0], t, .45 * g); timp(bus['fx'], t, root(bar) if root(bar) >= 43 else root(bar, 1), .8, .5 * g); place(bus['fx'], CRASH_M, t, .12 * g)
    elif k == 'iris':
        whoosh(bus['fx'], t + .25, 1.1, .3, 180, 2200, 300); sub_boom(bus['fx'], t + .1, 'D1', .18, 1.5)
    elif k == 'pop': pizz_note(t, bar, i, g)
    elif k == 'slam':  # each job word lands with its own hit
        sg = .55 + .09 * i; place(bus['perc'], BD2[1], t, .8 * sg); ekick(bus['hyb'], t, .22 * sg, 150, 40, .45)
        timp(bus['perc'], t, root(bar) if root(bar) >= 43 else root(bar, 1), 1., .75 * sg)
        TBN.play(bus['brass'], t, root(bar, 1) if root(bar) < 40 else root(bar), .35, .8, rel=.25, gain=sg); TBA.play(bus['brass'], t, root(bar) + (12 if root(bar) < 36 else 0), .4, .8, rel=.25, gain=sg)
        if i % 2: place(bus['perc'], panned(SNR[i % len(SNR)], 0), t, .45)
        if i == 0: place(bus['perc'], CRASH_M, t, .25)
    elif k == 'tick': place(bus['perc'], panned(SNR_S[i % len(SNR_S)], .1), t, .1 + .25 * g)
    elif k == 'who': whoosh(bus['fx'], t, .8, .15, 300, 1800, 400)
    elif k == 'suck':  # reverse reverb of the chord that is about to hit
        th = B(np.ceil(bar - 1e-6)); src = bus['brass'][int(th * SR):int((th + .8) * SR)] + bus['str'][int(th * SR):int((th + .8) * SR)]
        reverse_swell(bus['fx'], th, src, th - t + .05, .5)
    elif k in ('drop', 'drop2'): whoosh(bus['fx'], t, .6, .2, 200, 5000, 600)
    elif k == 'snap':
        place(bus['perc'], panned(SNR[0], 0), t, .5); place(bus['perc'], TOMH[0], t, .4); whoosh(bus['fx'], t, .35, .12, 800, 5000, 1500)
    elif k == 'whoosh': whoosh(bus['fx'], t, .9, .26 * g, 200, 2400, 350)
    elif k == 'reveal': whoosh(bus['fx'], t, .7, .2, 300, 4000, 600)
    elif k == 'morph':
        whoosh(bus['fx'], t + .25, .9, .22, 250, 3000, 500); VC_SP.play(bus['fx'], t, 'D3', .3, .7, rel=.1, gain=.6)
    elif k == 'flip':
        for j in range(6): place(bus['perc'], panned(SNR_S[j % len(SNR_S)], -.6 + .24 * j), t + j * S16 * .5, .1)
        whoosh(bus['fx'], t + .45, .8, .22, 250, 2600, 400)
    elif k == 'blip':  # dashboard cards: warm pizzicato, pitched to the chord
        pizz_note(t, bar, i, .9); VC_PZ.play(bus['fx'], t, root(bar, 1) if root(bar) < 45 else root(bar), .4, .45, rel=.25, gain=.35)
    elif k == 'deal':
        whoosh(bus['fx'], t + .06, .35, .14, 600, 4500, 1200); place(bus['perc'], panned(TOML[i % len(TOML)], (i - 1) * .4), t, .35)
    elif k == 'tiles':
        for j in range(8): pizz_note(t + j * S16, bar, j, .5)
    elif k == 'strike':
        whoosh(bus['fx'], t + .05, .3, .14, 1200, 6000, 2500); place(bus['perc'], panned(SNR[i % len(SNR)], 0), t, .35)
    elif k == 'final': whoosh(bus['fx'], t, .8, .2, 200, 4000, 500)
    elif k == 'smash':  # LUKE + RALPH collide
        place(bus['perc'], BD2[1], t, .9); place(bus['perc'], CRASH, t, .4); place(bus['perc'], panned(SNR[0], 0), t, .6)
        timp(bus['perc'], t, root(bar, 1) if root(bar) < 43 else root(bar), 1., .8); ekick(bus['hyb'], t, .3, 150, 40, .5)
        brass_chord(t, bar, .45, .95, cres=(1.2, .6))
    elif k == 'fall':  # the other 29 days tumble away
        for j in range(8): VLA_PZ.play(bus['fx'], t + j * S16 * .5, m(ch(bar)[5]) - [0, 3, 5, 7, 10, 12, 15, 17][j], .3, .45, rel=.2, pan=-.6 + .17 * j, gain=.5)


# ================================================================ mix
def send(x, amt): return x * amt
rv_in = send(bus['str'], .42) + send(bus['spic'], .22) + send(bus['brass'], .38) + send(bus['pno'], .3) + send(bus['perc'], .2) + send(bus['fx'], .3)
rv_in = filt(filt(rv_in, 'high', 180), 'low', 12000)
hall = conv(rv_in, IR)
room = conv(filt(bus['perc'], 'high', 120), IR_ROOM)

strings = shelf(peq(filt(bus['str'], 'high', 35), 350, -2.5, .8), 6500, 3.0)
spic = compress(filt(bus['spic'], 'high', 60), -20, 2.5, .003, .08, 3)
brass = shelf(peq(filt(bus['brass'], 'high', 40), 1200, 1.5, .7), 6000, -2)
piano = shelf(filt(bus['pno'], 'high', 50), 7000, 1.0)
perc = shelf(compress(sat(filt(bus['perc'] + room * .35, 'high', 42), 1.3), -16, 3, .002, .1, 3), 5000, 2.0)
hyb = sat(filt(bus['hyb'], 'low', 3500), 1.3)
fx = filt(bus['fx'], 'high', 40)

# sidechain: the drums breathe the strings on big beats (subtle)
kick_env = env_follow(filt(bus['perc'][:, :1] + bus['hyb'][:, :1], 'low', 150), .002, .18)
duck = (1 - .25 * np.clip(kick_env / (kick_env.max() + 1e-9) * 2.2, 0, 1))[:, None]

if os.environ.get('STEMS'):  # debug: loudness of each bus per section
    for nm_, x_ in [('strings', strings), ('spic', spic * .85), ('brass', brass * .95), ('piano', piano * .8), ('perc', perc * .95), ('hyb', hyb * .75), ('fx', fx * .9), ('hall', hall * .55)]:
        row = []
        for s_, (a_, b_) in MUSIC.items():
            seg = x_[int(B(a_) * SR):int(B(b_) * SR)]; row.append(f'{s_}:{10 * np.log10((seg ** 2).mean() + 1e-12):6.1f}')
        sub = filt(x_, 'low', 60); print(f'{nm_:8s}', ' '.join(row), f' sub<60Hz share {10 * np.log10((sub ** 2).sum() / ((x_ ** 2).sum() + 1e-12)):5.1f}dB')
mix = (strings * 1.0 + spic * .85 + brass * .95 + piano * .8) * duck + perc * .95 + hyb * .75 + fx * .9 + hall * .55
mix = filt(mix, 'high', 30, 3)
mix = peq(mix, 320, -1.5, .9); mix = peq(mix, 3000, 1.5, .8); mix = shelf(mix, 8000, 4.5); mix = shelf(mix, 70, -2.0, 'low')
mix = compress(mix, -16, 1.8, .03, .25)  # glue
# the breath before each drop: only the reverse swells and the tail survive
for s, (a, b) in MUSIC.items():
    if s in ('build', 'break'):
        i0, i1 = int((b - (.25 if s == 'build' else .125)) * BAR * SR), int(b * BAR * SR)
        keep = fx[i0:i1] * .9 + hall[i0:i1] * .3
        mix[i0:i1] = mix[i0:i1] * np.linspace(1, 0, i1 - i0)[:, None] ** 3 + keep * (1 - np.linspace(1, 0, i1 - i0)[:, None] ** 3)
L = lufs(mix); mix *= 10 ** ((-14.5 - L) / 20)
mix = limiter(mix, .89)
fo = int(2.5 * SR); mix[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo))[:, None] ** 2
mix[:int(.01 * SR)] *= np.linspace(0, 1, int(.01 * SR))[:, None]

out = os.path.join(HERE, f'soundtrack-{EDIT}.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(mix, -1, 1) * 32767).astype('<i2').tobytes())
print('wrote', out, f'{DUR:.1f}s  {lufs(mix):.1f} LUFS  peak {20 * np.log10(np.abs(mix).max()):.1f} dBFS')
