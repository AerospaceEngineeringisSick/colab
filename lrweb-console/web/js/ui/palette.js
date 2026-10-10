// Command palette (Ctrl/Cmd+K or "/"): jump anywhere, run quick actions.
import { h } from '../core/dom.js';
import { icon } from './icons.js';

let open = null;

/** openPalette(commands: [{ id, label, hint?, icon, keywords?, run() }]) */
export function openPalette(commands) {
  if (open) return open.close();
  const prev = document.activeElement;
  let items = commands;
  let active = 0;

  const input = h('input', { class: 'palette__input', type: 'text', placeholder: 'Search pages and actions…', 'aria-label': 'Search commands', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list' });
  const list = h('ul', { class: 'palette__list', id: 'palette-list', role: 'listbox' });
  const dlg = h('div', { class: 'glass glass--thick glass--liquid palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
    h('div', { class: 'palette__bar' }, icon('search', { size: 18 }), input, h('kbd', {}, 'Esc')), list);
  const scrim = h('div', { class: 'scrim scrim--top', onmousedown: (e) => { if (e.target === scrim) close(); } }, dlg);

  function render() {
    list.replaceChildren(...(items.length ? items.map((c, i) =>
      h('li', { role: 'option', id: `pal-${c.id}`, 'aria-selected': String(i === active), class: ['palette__item', i === active && 'is-active'], onmousemove: () => { if (active !== i) { active = i; paint(); } }, onclick: () => run(c) },
        icon(c.icon || 'arrow-right', { size: 18 }), h('span', { class: 'palette__label' }, c.label), c.hint && h('span', { class: 'muted palette__hint' }, c.hint)))
      : [h('li', { class: 'palette__none muted' }, 'No matches')]));
    input.setAttribute('aria-activedescendant', items[active] ? `pal-${items[active].id}` : '');
  }
  function paint() {
    [...list.children].forEach((li, i) => { li.classList.toggle('is-active', i === active); li.setAttribute('aria-selected', String(i === active)); });
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  }
  function run(c) { close(); c.run(); }
  function close() {
    document.removeEventListener('keydown', onKey, true);
    scrim.classList.remove('is-open');
    setTimeout(() => scrim.remove(), 180);
    prev?.focus?.({ preventScroll: true });
    open = null;
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); run(items[active]); }
    else if (e.key === 'Tab') e.preventDefault();
  }
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    items = q ? commands.filter((c) => `${c.label} ${c.keywords || ''}`.toLowerCase().includes(q)) : commands;
    active = 0;
    render();
  });

  render();
  document.addEventListener('keydown', onKey, true);
  document.getElementById('overlay-root').append(scrim);
  requestAnimationFrame(() => { scrim.classList.add('is-open'); input.focus(); });
  open = { close };
  return open;
}
