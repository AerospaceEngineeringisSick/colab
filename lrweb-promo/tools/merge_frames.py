"""Average motion-blur sub-frames (NNNNN_0.jpg, NNNNN_1.jpg, ...) into NNNNN.jpg for frames a..b-1.
   python3 tools/merge_frames.py <dir> <a> <b>"""
import sys, os, glob
import numpy as np
from PIL import Image
d, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
for f in range(a, b):
    name = f'{f:05d}'
    subs = sorted(glob.glob(os.path.join(d, name + '_*.jpg')))
    if not subs: continue
    acc = None
    for s in subs:
        x = np.asarray(Image.open(s), dtype=np.float32)
        acc = x if acc is None else acc + x
    Image.fromarray(np.clip(acc / len(subs) + .5, 0, 255).astype(np.uint8)).save(os.path.join(d, name + '.jpg'), quality=94)
    for s in subs: os.remove(s)
