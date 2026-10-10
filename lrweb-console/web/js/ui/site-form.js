// Shared "set up a site" form, used by the client onboarding wizard and the Sites view.
import { h } from '../core/dom.js';
import { Field, Input, Select, Segmented, Switch } from './components.js';
import { Term } from './glossary.js';

const TYPES = [
  { value: 'php', label: 'PHP', icon: 'globe' },
  { value: 'nodejs', label: 'Node.js', icon: 'terminal' },
  { value: 'static', label: 'Static', icon: 'cloud' },
  { value: 'python', label: 'Python', icon: 'bolt' },
  { value: 'reverse-proxy', label: 'Proxy', icon: 'link' },
];
// Starter styles are the server's vhost templates. Only the labels are friendlier; the values sent to the API stay the same.
const STARTER_LABEL = { Generic: 'General website', WordPress: 'WordPress' };
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
  const server = Select({ options: usable.length ? usable.map((s) => ({ value: s.id, label: `${s.name} · ${s.region || s.host}` })) : [{ value: '', label: 'No servers are ready. Add one first.' }], value: initial.serverId || usable[0]?.id || '' });
  const client = Select({ options: [{ value: '', label: 'No client' }, ...clients.map((c) => ({ value: c.id, label: c.company ? `${c.company} (${c.name})` : c.name }))], value: initial.clientId || '' });
  const php = Select({ options: meta.phpVersions, value: initial.phpVersion || meta.phpVersions[1] });
  const vhost = Select({ options: meta.vhostTemplates.map((v) => ({ value: v, label: STARTER_LABEL[v] || v })), value: initial.vhostTemplate || 'Generic' });
  const node = Select({ options: meta.nodejsVersions, value: initial.nodejsVersion || meta.nodejsVersions[0] });
  const py = Select({ options: meta.pythonVersions, value: initial.pythonVersion || meta.pythonVersions[1] });
  const port = Input({ type: 'number', min: 1024, max: 65535, value: initial.appPort || 3000, inputmode: 'numeric' });
  const proxy = Input({ placeholder: 'http://10.0.0.5:8080', value: initial.reverseProxyUrl || '', inputmode: 'url' });
  const db = Switch({ label: 'Create a database', checked: initial.createDatabase ?? true });
  const ssl = Switch({ label: ['Add a free padlock (', Term('ssl', 'SSL'), " certificate from Let's Encrypt)"], checked: initial.issueCertificate ?? true });

  let type = initial.type || 'php';
  const dynamic = h('div', { class: 'form-grid span-all' });
  const typeField = Field({ label: 'Type of site' }, Segmented({ label: 'Type of site', options: TYPES, value: type, onchange: (v) => { type = v; renderDynamic(); } }));

  function renderDynamic() {
    const parts = {
      php: [wrap('phpVersion', 'PHP version', php), wrap('vhostTemplate', 'Site starter style', vhost, { hint: 'Choose WordPress for a WordPress site. It adds the settings WordPress usually needs.' })],
      nodejs: [wrap('nodejsVersion', 'Node.js version', node), wrap('appPort', 'App port', port, { hint: 'The port your app listens on. Keep the default unless you know it needs changing.' })],
      python: [wrap('pythonVersion', 'Python version', py), wrap('appPort', 'App port', port, { hint: 'The port your app listens on. Keep the default unless you know it needs changing.' })],
      'reverse-proxy': [wrap('reverseProxyUrl', 'Send visitors to', proxy, { hint: 'Visitors to this domain are passed on to this address. Start it with http:// or https://.' })],
      static: [h('p', { class: 'muted span-all' }, 'Just HTML, images and other plain files. There is nothing else to set up.')],
    };
    dynamic.replaceChildren(...parts[type]);
    db.closest('.switch').hidden = type === 'static' || type === 'reverse-proxy';
  }

  const el = h('div', { class: 'form-grid' },
    wrap('domain', 'Domain', domain, { required: true, hint: ['The web address, such as example.com. Point its ', Term('dns', 'DNS'), ' at this server before you add the padlock.'] }),
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
      if (!server.value) bad('serverId', 'Choose a server that is online. If none are listed, add one first.');
      if ((type === 'nodejs' || type === 'python') && !(num(port.value) >= 1024 && num(port.value) <= 65535)) bad('appPort', 'Use a port number between 1024 and 65535');
      if (type === 'reverse-proxy') { try { if (!/^https?:$/.test(new URL(proxy.value.trim()).protocol)) throw new Error(); } catch { bad('reverseProxyUrl', 'Enter a full address that starts with http:// or https://'); } }
      return ok;
    },
    setError: (field, msg) => fields[field]?.setError(msg),
  };
}
