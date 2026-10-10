// Settings: connections (CloudPanel, billing), appearance, and the optional admin token.
import { h, ensureCss } from '../core/dom.js';
import { api, getToken, setToken } from '../core/api.js';
import { state, prefs } from '../core/store.js';
import { toast } from '../core/toast.js';
import { Term } from '../ui/glossary.js';
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

// What each connection does, in one sentence. The server's health payload uses the same keys.
const CONNECTIONS = {
  cloudpanel: { title: () => Term('cloudpanel', 'CloudPanel'), does: () => ['Controls your ', Term('server', 'servers'), ' and sites.'], demo: 'Showing demo data. No real servers are contacted.' },
  billing: { title: () => 'Billing', does: () => 'Handles invoices and care plans.', demo: 'Showing demo data. No real payment account is connected.' },
};
// The server reports technical detail names. Known ones get plain labels; others are tidied up from their key.
const DETAIL_LABEL = {
  auth: 'Sign-in', hostKeys: 'Server identity checks', clpctl: 'How commands run', host: 'Address', apiHost: 'Address',
  paymentMethod: 'Payment method', credentials: 'Login details', history: 'Data source', key: 'Secret key', note: 'Note',
};
const DETAIL_VALUE = { configured: 'Set', missing: 'Missing', 'generated from seeded clients': 'Made-up example clients' };
const detailLabel = (k) => DETAIL_LABEL[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function integrationCard(key, i) {
  const c = CONNECTIONS[key];
  const badge = i.mode === 'mock' ? 'Demo data' : i.ready ? 'Live' : 'Needs setup';
  const rows = [
    ['Connection', i.label],
    ...Object.entries(i.details || {}).map(([k, v]) => [detailLabel(k), DETAIL_VALUE[v] ?? v]),
  ];
  return Card({ title: c.title(), subtitle: c.does(), actions: Badge({ kind: i.ready ? 'ok' : 'warn' }, badge) },
    i.mode === 'mock' && h('div', { class: 'callout' }, icon('info', { size: 18 }), h('p', {}, c.demo)),
    !i.ready && i.mode !== 'mock' && h('div', { class: 'callout callout--warn' }, icon('alert', { size: 18 }),
      h('p', {}, 'Not ready yet. Open "For whoever sets up the server" below to see what is missing.')),
    h('details', { class: 'integration__more' },
      h('summary', {}, h('span', {}, 'For whoever sets up the server'), icon('chevron-down', { size: 16, class: 'integration__chev' })),
      h('div', { class: 'integration__body' },
        h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', { class: 'mono' }, v)])),
        i.mode === 'mock' && h('div', {},
          h('p', { class: 'muted' }, 'To connect for real, set these on the server and restart it:'),
          h('ul', { class: 'envlist mono' }, ENV_HELP[key].map(([k, v]) => h('li', {}, h('b', {}, k), ' = ', v)))))));
}

export default async function mount(root, ctx) {
  await ensureCss('css/view-settings.css');
  const integrations = h('div', { class: 'grid grid--2' });
  const token = Input({ type: 'password', placeholder: getToken() ? '••••••••••••' : 'None saved', autocomplete: 'off' });

  root.append(
    PageHeader({ title: 'Settings', subtitle: 'Connections, appearance and access' }),
    integrations,
    Card({ title: 'Appearance', subtitle: 'How the console looks, and how smoothly it runs.' },
      h('div', { class: 'stack' },
        Field({ label: 'Theme', hint: "Auto follows your device's dark or light setting." }, Segmented({ label: 'Theme', value: prefs.get('theme', 'auto'), options: [{ value: 'auto', label: 'Auto' }, { value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'light', label: 'Light', icon: 'sun' }],
          onchange: (v) => { prefs.set('theme', v); state.set('prefs', Date.now()); } })),
        Field({ label: 'Visual effects', hint: 'Auto checks how smoothly this device runs when the page loads, and uses Lite if it is slow. Lite turns off blur and background movement.' },
          Segmented({ label: 'Visual effects', value: prefs.get('fx', 'auto'), options: [{ value: 'auto', label: 'Auto' }, { value: 'full', label: 'Full' }, { value: 'lite', label: 'Lite' }],
            onchange: (v) => { prefs.set('fx', v); state.set('prefs', Date.now()); } })))),
    Card({ title: 'Access', subtitle: 'Billing and server sign-in secrets never reach this browser. The only thing kept here is an optional admin token.' },
      h('div', { class: 'row token-row' },
        h('div', { class: 'grow' }, Field({ label: 'Admin token', hint: 'Only needed if your console is set up with an admin token. Kept in this browser tab only, and gone when you close it. Leave it empty and save to remove it.' }, token)),
        Button({ variant: 'primary', icon: 'key', onclick: () => {
          const t = token.value.trim();
          setToken(t);
          token.value = '';
          token.placeholder = t ? '••••••••••••' : 'None saved';
          toast({ title: t ? 'Admin token saved' : 'Admin token removed', kind: 'ok' });
        } }, 'Save token'))),
  );

  loadInto(integrations, () => api.get('/api/health', { signal: ctx.signal }), (health) => {
    state.set('health', health);
    return [integrationCard('cloudpanel', health.integrations.cloudpanel), integrationCard('billing', health.integrations.billing)];
  });
}
