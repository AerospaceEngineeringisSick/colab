"""Flag frames where part of the image differs sharply from BOTH neighbours while the neighbours agree
(a dropped/half-presented frame). Prints frame numbers.   python3 tools/check_frames.py <frames_dir>"""
import sys, glob, os
import numpy as np
from PIL import Image
fs = sorted(glob.glob(os.path.join(sys.argv[1], '*.jpg')))
def cells(f):
    im = Image.open(f).convert('L').resize((48, 48))
    return np.asarray(im, float).reshape(6, 8, 6, 8).mean((1, 3))  # 6x6 grid
prev = cells(fs[0]); cur = cells(fs[1]); bad = []
for i in range(1, len(fs) - 1):
    nxt = cells(fs[i + 1])
    d1, d2, dn = cur - prev, cur - nxt, np.abs(prev - nxt)
    m = (np.abs(d1) > 45) & (np.abs(d2) > 45) & (np.sign(d1) == np.sign(d2)) & (dn < 20)
    if m.sum() >= 2: bad.append(i)
    prev, cur = cur, nxt
print(' '.join(map(str, bad)))

# second pass: cells that go (near) black suddenly while frames 8 before and after are lit (multi-frame dropouts)
C = [cells(f) for f in fs]
blk = []
for i in range(8, len(C) - 8):
    m = (C[i] < 6) & (C[i - 8] > 35) & (C[i + 8] > 35)
    if m.sum() >= 2: blk.append(i)
print('black:', ' '.join(map(str, blk)))
