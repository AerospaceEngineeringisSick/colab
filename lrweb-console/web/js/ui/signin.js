// Sign-in screen and the signed-in user's menu. The browser only ever holds a short-lived session token (sessionStorage).
import { h } from '../core/dom.js';
import { api, setToken } from '../core/api.js';
import { Modal, Button, Field, Input, Avatar } from './components.js';
import { icon } from './icons.js';

let open = null;

/**
 * openSignIn({ accountsEnabled, onDone })
 * Personal accounts (username + password) when the team has accounts, otherwise the admin token from the server settings.
 */
export function openSignIn({ accountsEnabled, onDone }) {
  if (open) return open;
  let mode = accountsEnabled ? 'account' : 'token';
  const body = h('div', { class: 'stack signin' });
  const modal = Modal({
    title: 'Welcome back',
    subtitle: 'Sign in to LRWeb Console',
    size: 'sm',
    dismissible: false,
    content: body,
    onClose: () => { open = null; },
  });

  function render() {
    const err = h('p', { class: 'field__error', role: 'alert' });
    const username = Input({ autocomplete: 'username', autocapitalize: 'none', autofocus: true, 'aria-label': 'Username' });
    const secret = Input({ type: 'password', autocomplete: mode === 'account' ? 'current-password' : 'off', 'aria-label': mode === 'account' ? 'Password' : 'Admin token' });
    const btn = Button({ variant: 'primary', size: 'lg', icon: 'lock', type: 'submit', class: 'signin__go' }, 'Sign in');

    async function submit(e) {
      e.preventDefault();
      err.textContent = '';
      const value = secret.value.trim();
      if (!value || (mode === 'account' && !username.value.trim())) { err.textContent = mode === 'account' ? 'Enter your username and password.' : 'Enter the admin token.'; return; }
      btn.classList.add('is-loading'); btn.disabled = true;
      try {
        if (mode === 'account') {
          const r = await api.post('/api/auth/login', { username: username.value.trim().toLowerCase(), password: secret.value });
          setToken(r.session.token);
        } else {
          setToken(value);
          await api.get('/api/auth/me'); // validates the token; a wrong one clears below
        }
        modal.close();
        open = null;
        onDone?.();
      } catch (e2) {
        if (mode === 'token') setToken('');
        err.textContent = e2.status === 429 || e2.code === 'locked' || e2.code === 'rate_limited' ? e2.message : mode === 'account' ? 'Wrong username or password.' : 'That token did not work.';
        btn.classList.remove('is-loading'); btn.disabled = false;
        secret.value = '';
        secret.focus();
      }
    }

    const form = h('form', { class: 'stack', onsubmit: submit, novalidate: true },
      h('div', { class: 'signin__brand' },
        h('img', { class: 'logo--on-dark', src: 'assets/brand/logo-light.png', width: 150, height: 35, alt: 'LRWeb' }),
        h('img', { class: 'logo--on-light', src: 'assets/brand/logo-dark.png', width: 150, height: 35, alt: 'LRWeb' })),
      mode === 'account' && Field({ label: 'Username' }, username),
      Field({ label: mode === 'account' ? 'Password' : 'Admin token', hint: mode === 'token' ? 'The token set on the server (LRWEB_ADMIN_TOKEN). Kept for this tab only.' : undefined }, secret),
      err, btn,
      accountsEnabled && h('button', { type: 'button', class: 'link signin__alt', onclick: () => { mode = mode === 'account' ? 'token' : 'account'; render(); } },
        mode === 'account' ? 'Use the admin token instead' : 'Use my own account instead'));
    body.replaceChildren(form);
    requestAnimationFrame(() => (mode === 'account' ? username : secret).focus());
  }
  render();
  open = modal;
  return modal;
}

/**
 * userChip({ me, onSignOut, goto }) -> topbar button with a dropdown. `me` is state.get('me').
 */
export function userChip({ me, onSignOut, goto }) {
  const account = me && !me.system && !me.local && me.id;
  const label = account ? me.name : me?.mode === 'token' ? 'Admin token' : 'Local mode';
  let menu = null;

  const close = () => { menu?.remove(); menu = null; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey, true); };
  const outside = (e) => { if (menu && !menu.contains(e.target) && !btn.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { close(); btn.focus(); } };

  const item = (ic, text, fn) => h('button', { type: 'button', class: 'menu__item', role: 'menuitem', onclick: () => { close(); fn(); } }, icon(ic, { size: 18 }), text);
  function toggle() {
    if (menu) return close();
    menu = h('div', { class: 'glass glass--thick menu', role: 'menu' },
      h('div', { class: 'menu__head' }, h('strong', {}, label), account && h('small', { class: 'muted' }, `${me.role} · @${me.username}`)),
      account ? item('key', 'Your account', () => goto('/team')) : item('key', 'Create your own sign-in', () => goto('/team')),
      account && item('lock', 'Sign out', onSignOut));
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 8}px`;
    menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
    menu.querySelector('button')?.focus();
  }
  const btn = h('button', { type: 'button', class: 'user-chip', 'aria-haspopup': 'menu', onclick: toggle },
    account ? Avatar({ name: me.name, size: 30 }) : h('span', { class: 'user-chip__dot' }, icon('user', { size: 16 })),
    h('span', { class: 'user-chip__name' }, account ? me.name.split(' ')[0] : label));
  return btn;
}
