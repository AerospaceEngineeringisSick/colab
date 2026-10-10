// Shared "provision a site" form, used by the client onboarding wizard and the Sites view.
import { h } from '../core/dom.js';
import { Field, Input, Select, Segmented, Switch } from './components.js';

const TYPES = [
  { value: 'php', label: 'PHP', icon: 'globe' },
  { value: 'nodejs', label: 'Node.js', icon: 'terminal' },
  { value: 'static', label: 'Static', icon: 'cloud' },
  { value: 'python', label: 'Python', icon: 'bolt' },
  { value: 'reverse-proxy', label: 'Proxy', icon: 'link' },
];
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * SiteForm({ meta, servers, clients?, initial?, showClient? })
 *   meta     : response of GET /api/meta
 *   servers  : Server[] (only online/degraded ones are selectable)
 *   clients  : Client[] (needed when showClient is true)
 *   initial  : partial SiteSpec to prefill
 * Returns { el, value(): SiteSpec, validate(): boolean, setError(field, message) }
 */
export function SiteForm({ meta, servers = [], clients = [], initial = {}, showClient = false } = {}) {
  const usable = servers.filter((s) => s.status === 'online' || s.status === 'degraded');
  const fields = {};
  const wrap = (name, label, control, opts = {}) => (fields[name] = Field({ label, ...opts }, control));

  const domain = Input({ placeholder: 'example.com', value: initial.domain || '', inputmode: 'url', autocapitalize: 'none' });
  const server = Select({ options: usable.length ? usable.map((s) => ({ value: s.id, label: `${s.name} · ${s.region || s.host}` })) : [{ value: '', label: 'No online servers available' }], value: initial.serverId || usable[0]?.id || '' });
  const client = Select({ options: [{ value: '', label: 'No client (internal site)' }, ...clients.map((c) => ({ value: c.id, label: c.company ? `${c.company} (${c.name})` : c.name }))], value: initial.clientId || '' });
  const php = Select({ options: meta.phpVersions, value: initial.phpVersion || meta.phpVersions[1] });
  const vhost = Select({ options: meta.vhostTemplates, value: initial.vhostTemplate || 'Generic' });
  const node = Select({ options: meta.nodejsVersions, value: initial.nodejsVersion || meta.nodejsVersions[0] });
  const py = Select({ options: meta.pythonVersions, value: initial.pythonVersion || meta.pythonVersions[1] });
  const port = Input({ type: 'number', min: 1024, max: 65535, value: initial.appPort || 3000, inputmode: 'numeric' });
  const proxy = Input({ placeholder: 'http://10.0.0.5:8080', value: initial.reverseProxyUrl || '', inputmode: 'url' });
  const db = Switch({ label: 'Create a database', checked: initial.createDatabase ?? true });
  const ssl = Switch({ label: "Issue a free Let's Encrypt certificate", checked: initial.issueCertificate ?? true });

  let type = initial.type || 'php';
  const dynamic = h('div', { class: 'form-grid span-all' });
  const typeField = Field({ label: 'Application type' }, Segmented({ label: 'Application type', options: TYPES, value: type, onchange: (v) => { type = v; renderDynamic(); } }));

  function renderDynamic() {
    const parts = {
      php: [wrap('phpVersion', 'PHP version', php), wrap('vhostTemplate', 'Vhost template', vhost, { hint: 'WordPress adds the recommended nginx rules.' })],
      nodejs: [wrap('nodejsVersion', 'Node.js version', node), wrap('appPort', 'App port', port, { hint: 'The port your app listens on.' })],
      python: [wrap('pythonVersion', 'Python version', py), wrap('appPort', 'App port', port, { hint: 'The port your app listens on.' })],
      'reverse-proxy': [wrap('reverseProxyUrl', 'Upstream URL', proxy, { hint: 'Traffic for this domain is proxied here.' })],
      static: [h('p', { class: 'muted span-all' }, 'Serves static files from the site root. Nothing else to configure.')],
    };
    dynamic.replaceChildren(...parts[type]);
    db.closest('.switch').hidden = type === 'static' || type === 'reverse-proxy';
  }

  const el = h('div', { class: 'form-grid' },
    wrap('domain', 'Domain', domain, { required: true, hint: 'Point its DNS A record at the server before issuing SSL.' }),
    wrap('serverId', 'Server', server, { required: true }),
    showClient && wrap('clientId', 'Client', client),
    h('div', { class: 'span-all' }, typeField),
    dynamic,
    h('div', { class: 'span-all row' }, db, ssl));
  renderDynamic();

  const num = (v) => Number(v);
  return {
    el,
    value() {
      const v = { domain: domain.value.trim().toLowerCase(), serverId: server.value, type, createDatabase: db.querySelector('input').checked && type !== 'static' && type !== 'reverse-proxy', issueCertificate: ssl.querySelector('input').checked };
      if (showClient && client.value) v.clientId = client.value;
      if (type === 'php') Object.assign(v, { phpVersion: php.value, vhostTemplate: vhost.value });
      if (type === 'nodejs') Object.assign(v, { nodejsVersion: node.value, appPort: num(port.value) });
      if (type === 'python') Object.assign(v, { pythonVersion: py.value, appPort: num(port.value) });
      if (type === 'reverse-proxy') v.reverseProxyUrl = proxy.value.trim();
      return v;
    },
    validate() {
      Object.values(fields).forEach((f) => f.setError(''));
      let ok = true;
      const bad = (name, msg) => { fields[name]?.setError(msg); ok = false; };
      if (!DOMAIN_RE.test(domain.value.trim().toLowerCase())) bad('domain', 'Enter a valid domain such as example.com');
      if (!server.value) bad('serverId', 'Choose an online server (add one first)');
      if ((type === 'nodejs' || type === 'python') && !(num(port.value) >= 1024 && num(port.value) <= 65535)) bad('appPort', 'Port must be 1024-65535');
      if (type === 'reverse-proxy') { try { if (!/^https?:$/.test(new URL(proxy.value.trim()).protocol)) throw new Error(); } catch { bad('reverseProxyUrl', 'Enter a valid http(s) URL'); } }
      return ok;
    },
    setError: (field, msg) => fields[field]?.setError(msg),
  };
}
