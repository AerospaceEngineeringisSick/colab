// Dependency-free SVG charts. They redraw on resize and respect the theme through CSS variables.
import { h, svg, uid } from '../core/dom.js';

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};

// Catmull-Rom -> cubic Bezier, with control points clamped so curves never dip below the baseline.
function smooth(pts, yMin, yMax) {
  const clamp = (y) => Math.min(yMax, Math.max(yMin, y));
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/**
 * AreaChart({ series: [{ name, values: number[], color?: 'var(--accent)' }], labels?: string[],
 *             height?: 220, format?: (n)=>string, yMax?: number, ticks?: 4, labelFormat?: (label)=>string })
 * Returns an element; hover shows a crosshair + tooltip with every series' value.
 */
export function AreaChart({ series, labels = [], height = 220, format = String, yMax, ticks = 4, labelFormat = String } = {}) {
  const palette = ['var(--accent)', 'var(--accent-3)', 'var(--accent-2)', 'var(--warn)'];
  const id = uid('ac');
  const tip = h('div', { class: 'chart__tip glass glass--thin', hidden: true });
  const wrap = h('div', { class: 'chart', style: { height: `${height}px` } });
  const pad = { t: 10, r: 10, b: 24, l: 44 };
  let geo = null;

  function draw() {
    const W = wrap.clientWidth;
    if (W < 40) return;
    const H = height;
    const n = Math.max(...series.map((s) => s.values.length));
    if (n < 2) { wrap.replaceChildren(h('p', { class: 'muted chart__empty' }, 'Not enough data yet')); return; }
    const max = yMax ?? niceMax(Math.max(...series.flatMap((s) => s.values)) * 1.08);
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const x = (i) => pad.l + (i / (n - 1)) * iw;
    const y = (v) => pad.t + (1 - Math.min(v, max) / max) * ih;
    geo = { n, x, y, W, H };

    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': series.map((s) => s.name).join(', ') });
    const defs = svg('defs');
    series.forEach((s, i) => {
      const c = s.color || palette[i % palette.length];
      defs.append(svg('linearGradient', { id: `${id}-g${i}`, x1: 0, y1: 0, x2: 0, y2: 1 },
        svg('stop', { offset: '0', style: `stop-color:${c};stop-opacity:.38` }), svg('stop', { offset: '1', style: `stop-color:${c};stop-opacity:0` })));
    });
    root.append(defs);

    for (let t = 0; t <= ticks; t++) {
      const v = (max / ticks) * t;
      const yy = y(v);
      root.append(svg('line', { class: 'chart__grid', x1: pad.l, x2: W - pad.r, y1: yy, y2: yy }),
        svg('text', { class: 'chart__axis', x: pad.l - 8, y: yy + 4, 'text-anchor': 'end' }, format(v)));
    }
    if (labels.length) {
      const count = Math.min(6, labels.length);
      for (let k = 0; k < count; k++) {
        const i = Math.round((k / (count - 1)) * (labels.length - 1));
        root.append(svg('text', { class: 'chart__axis', x: x(i), y: H - 6, 'text-anchor': k === 0 ? 'start' : k === count - 1 ? 'end' : 'middle' }, labelFormat(labels[i])));
      }
    }
    series.forEach((s, i) => {
      const c = s.color || palette[i % palette.length];
      const pts = s.values.map((v, j) => [x(j), y(v)]);
      const line = smooth(pts, pad.t, pad.t + ih);
      root.append(
        svg('path', { d: `${line}L${x(s.values.length - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z`, fill: `url(#${id}-g${i})` }),
        svg('path', { d: line, class: 'chart__line', style: `stroke:${c}` }));
    });
    const cross = svg('line', { class: 'chart__cross', y1: pad.t, y2: pad.t + ih, x1: 0, x2: 0, style: 'display:none' });
    const dots = series.map((s, i) => svg('circle', { class: 'chart__dot', r: 4, style: `display:none;fill:${s.color || palette[i % palette.length]}` }));
    root.append(cross, ...dots);
    wrap.replaceChildren(root, tip);

    root.addEventListener('pointermove', (e) => {
      const rect = root.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left - pad.l) / iw) * (n - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.display = '';
      series.forEach((s, k) => { if (s.values[i] == null) return; dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(s.values[i])); dots[k].style.display = ''; });
      tip.replaceChildren(
        h('b', {}, labels[i] != null ? labelFormat(labels[i]) : `#${i + 1}`),
        ...series.map((s, k) => h('div', { class: 'chart__tip-row' }, h('i', { style: { background: s.color || palette[k % palette.length] } }), h('span', {}, s.name), h('strong', { class: 'num' }, s.values[i] != null ? format(s.values[i]) : '–'))));
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.transform = `translate(${Math.min(W - tw - 4, Math.max(4, x(i) + 14))}px, ${pad.t + 4}px)`;
    });
    root.addEventListener('pointerleave', () => { cross.style.display = 'none'; dots.forEach((d) => { d.style.display = 'none'; }); tip.hidden = true; });
  }

  new ResizeObserver(() => requestAnimationFrame(draw)).observe(wrap);
  requestAnimationFrame(draw);
  return wrap;
}

/** Donut({ segments: [{ label, value, color }], size?: 148, thickness?: 14, center?: { value, label } }) */
export function Donut({ segments, size = 148, thickness = 14, center } = {}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let offset = 0;
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': segments.map((s) => `${s.label} ${s.value}`).join(', ') },
    svg('circle', { cx: size / 2, cy: size / 2, r, class: 'donut__bg', 'stroke-width': thickness }));
  for (const s of segments) {
    const len = (s.value / total) * c;
    root.append(svg('circle', {
      cx: size / 2, cy: size / 2, r, class: 'donut__seg', 'stroke-width': thickness,
      'stroke-dasharray': `${Math.max(0, len - 3)} ${c - Math.max(0, len - 3)}`, 'stroke-dashoffset': -offset, style: `stroke:${s.color}`,
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
    }));
    offset += len;
  }
  return h('div', { class: 'donut', style: { width: `${size}px`, height: `${size}px` } }, root,
    center && h('div', { class: 'donut__center' }, h('strong', { class: 'num' }, center.value), h('small', {}, center.label)));
}

/** BarChart({ data: [{ label, value }], height?: 160, format? }) -> compact bars (e.g. monthly revenue) */
export function BarChart({ data, height = 160, format = String } = {}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return h('div', { class: 'bars', style: { height: `${height}px` }, role: 'img', 'aria-label': 'Bar chart' },
    data.map((d, i) => h('div', { class: 'bars__col', title: `${d.label}: ${format(d.value)}` },
      h('i', { style: { height: `${Math.max(3, (d.value / max) * 100)}%`, '--i': i } }),
      h('span', {}, d.label))));
}
