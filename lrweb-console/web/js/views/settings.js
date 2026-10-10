import { h } from '../core/dom.js';
import { api, getToken, setToken } from '../core/api.js';
import { state, prefs } from '../core/store.js';
import { toast } from '../core/toast.js';
import { PageHeader, Card, Badge, Segmented, Field, Input, Button, loadInto } from '../ui/components.js';
import { icon } from '../ui/icons.js';

const ENV_HELP = {
  cloudpanel: [
    ['LRWEB_CLOUDPANEL_MODE', 'ssh'],
    ['LRWEB_SSH_KEY', '/path/to/lrweb_ed25519'],
    ['LRWEB_SSH_KNOWN_HOSTS', '/path/to/known_hosts  (recommended)'],
  ],
  billing: [
    ['LRWEB_BILLING_MODE', 'whmcs | stripe'],
    ['WHMCS_URL / WHMCS_API_IDENTIFIER / WHMCS_API_SECRET', 'WHMCS'],
    ['STRIPE_SECRET_KEY', 'Stripe (use a restricted key)'],
  ],
};

function integrationCard(name, key, i) {
  return Card({ title: name, subtitle: i.label, actions: Badge({ kind: i.ready ? 'ok' : 'warn' }, i.mode === 'mock' ? 'Demo data' : i.ready ? 'Live' : 'Needs setup') },
    h('dl', { class: 'kv' }, Object.entries(i.details || {}).flatMap(([k, v]) => [h('dt', {}, k), h('dd', { class: 'mono' }, v)])),
    i.mode === 'mock' && h('div', { class: 'callout' }, icon('info', { size: 18 }),
      h('div', {}, h('p', {}, 'Running on realistic demo data. To go live, set these on the server and restart:'),
        h('ul', { class: 'envlist mono' }, ENV_HELP[key].map(([k, v]) => h('li', {}, h('b', {}, k), ' = ', v)))),
    ));
}

export default function mount(root, ctx) {
  const integrations = h('div', { class: 'grid grid--2' });
  const token = Input({ type: 'password', placeholder: getToken() ? '••••••••••••' : 'Not set', autocomplete: 'off' });

  root.append(
    PageHeader({ title: 'Settings', subtitle: 'Integrations, appearance and access' }),
    integrations,
    Card({ title: 'Appearance', subtitle: 'Liquid-glass tuning' },
      h('div', { class: 'stack' },
        Field({ label: 'Theme' }, Segmented({ label: 'Theme', value: prefs.get('theme', 'auto'), options: [{ value: 'auto', label: 'Auto' }, { value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'light', label: 'Light', icon: 'sun' }],
          onchange: (v) => { prefs.set('theme', v); state.set('prefs', Date.now()); } })),
        Field({ label: 'Glass effects', hint: 'Auto measures frame rate on load and switches to Lite on slow devices. Lite removes blur and background motion.' },
          Segmented({ label: 'Glass effects', value: prefs.get('fx', 'auto'), options: [{ value: 'auto', label: 'Auto' }, { value: 'full', label: 'Full' }, { value: 'lite', label: 'Lite' }],
            onchange: (v) => { prefs.set('fx', v); state.set('prefs', Date.now()); } })))),
    Card({ title: 'Access', subtitle: 'The browser never sees billing or SSH secrets; only this optional admin token.' },
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, Field({ label: 'Admin token', hint: 'Stored in this tab (sessionStorage) and sent as a Bearer token.' }, token)),
        Button({ variant: 'primary', icon: 'key', onclick: () => {
          const t = token.value.trim();
          setToken(t);
          token.value = '';
          token.placeholder = t ? '••••••••••••' : 'Not set';
          toast({ title: t ? 'Token updated' : 'Token cleared', kind: 'ok' });
        } }, 'Save token'))),
  );

  loadInto(integrations, () => api.get('/api/health', { signal: ctx.signal }), (health) => {
    state.set('health', health);
    return [integrationCard('CloudPanel', 'cloudpanel', health.integrations.cloudpanel), integrationCard('Billing', 'billing', health.integrations.billing)];
  });
}
