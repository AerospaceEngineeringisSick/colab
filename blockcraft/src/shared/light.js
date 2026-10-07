// Column-local light: sunlight straight down, then flood fill inside the column.
// Cross-column spreading is finished on the main thread once neighbours exist.
import { WH } from './constants.js';
import { LIGHT_OPACITY, EMIT } from './blocks.js';

const N = 16 * 16 * WH;
const QN = N * 4;
const queue = new Int32Array(QN);

export function computeColumnLight(blocks) {
  const light = new Uint8Array(N);
  // 1. sky light straight down
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    let l = 15;
    for (let y = WH - 1; y >= 0; y--) {
      const p = (y << 8) | (z << 4) | x;
      const op = LIGHT_OPACITY[blocks[p] & 1023];
      if (op) l = Math.max(0, l - op);
      light[p] = l << 4;
      if (!l) {
        // everything below is dark until something emits
        for (let yy = y - 1; yy >= 0; yy--) light[(yy << 8) | (z << 4) | x] = 0;
        break;
      }
    }
  }
  // 2. seed sky flood from lit cells next to darker ones
  let qn = 0;
  for (let p = 0; p < N; p++) {
    const s = light[p] >> 4;
    if (s < 2) continue;
    const x = p & 15, z = (p >> 4) & 15, y = p >> 8;
    if ((x > 0 && (light[p - 1] >> 4) < s - 1) || (x < 15 && (light[p + 1] >> 4) < s - 1) ||
        (z > 0 && (light[p - 16] >> 4) < s - 1) || (z < 15 && (light[p + 16] >> 4) < s - 1) ||
        (y > 0 && (light[p - 256] >> 4) < s - 1)) queue[qn++] = p;
  }
  flood(blocks, light, qn, 4);
  // 3. block light from emitters
  qn = 0;
  for (let p = 0; p < N; p++) {
    const e = EMIT[blocks[p] & 1023];
    if (e) { light[p] = (light[p] & 0xf0) | e; queue[qn++] = p; }
  }
  flood(blocks, light, qn, 0);
  return light;
}

function flood(blocks, light, qn, shift) {
  let head = 0;
  const mask = shift ? 0x0f : 0xf0;
  // the queue may grow past its initial contents; use a ring buffer
  let tail = qn;
  while (head !== tail) {
    const p = queue[head];
    head = (head + 1) % QN;
    const l = (light[p] >> shift) & 15;
    if (l < 2) continue;
    const x = p & 15, z = (p >> 4) & 15, y = p >> 8;
    for (let d = 0; d < 6; d++) {
      let q;
      switch (d) {
        case 0: if (x === 15) continue; q = p + 1; break;
        case 1: if (x === 0) continue; q = p - 1; break;
        case 2: if (y === WH - 1) continue; q = p + 256; break;
        case 3: if (y === 0) continue; q = p - 256; break;
        case 4: if (z === 15) continue; q = p + 16; break;
        default: if (z === 0) continue; q = p - 16; break;
      }
      const op = LIGHT_OPACITY[blocks[q] & 1023];
      if (op >= 15) continue;
      const nl = l - Math.max(1, op);
      if (nl > ((light[q] >> shift) & 15)) {
        light[q] = (light[q] & mask) | (nl << shift);
        queue[tail] = q;
        tail = (tail + 1) % QN;
      }
    }
  }
}
