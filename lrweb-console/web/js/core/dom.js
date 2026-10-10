// Tiny hyperscript. Children are always appended as text nodes or Nodes, never parsed as HTML.
const SVG_NS = 'http://www.w3.org/2000/svg';
const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'readOnly', 'indeterminate']);

const isProps = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Node);

function applyProps(el, props, deferred) {
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) {
      if (PROP_KEYS.has(k) && v === false) el[k] = false;
      continue;
    }
    if (k === 'class' || k === 'className') {
      const cls = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      el.setAttribute('class', cls);
    } else if (k === 'style') {
      if (typeof v === 'string') el.style.cssText = v;
      else for (const [p, val] of Object.entries(v)) (p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val));
    } else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'ref') deferred.push(() => v(el));
    else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROP_KEYS.has(k)) deferred.push(() => { el[k] = v; });
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

function make(ns, tag, props, children) {
  const el = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
  const deferred = [];
  if (isProps(props)) applyProps(el, props, deferred);
  else children.unshift(props);
  append(el, children);
  deferred.forEach((fn) => fn()); // value/ref run after children exist (needed for <select>)
  return el;
}

export const h = (tag, props, ...children) => make(null, tag, props, children);
export const svg = (tag, props, ...children) => make(SVG_NS, tag, props, children);

export function clear(el) {
  el.replaceChildren();
  return el;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

const loadedCss = new Set();
/** Lazily load a view-specific stylesheet once. Resolves when it is applied. */
export function ensureCss(href) {
  if (loadedCss.has(href)) return Promise.resolve();
  loadedCss.add(href);
  return new Promise((resolve) => {
    const link = h('link', { rel: 'stylesheet', href, onload: resolve, onerror: resolve });
    document.head.append(link);
  });
}

export const uid = (() => {
  let n = 0;
  return (p = 'id') => `${p}-${++n}`;
})();
