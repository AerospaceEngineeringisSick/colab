// Demo data for mock mode. Uses RFC 5737 documentation IPs and example-style domains only.
const DAY = 86_400_000;

export function seedIfEmpty(store, now = Date.now()) {
  if (store.meta.get('seeded') || store.all('servers').length) return false;
  const ago = (days, hours = 0) => new Date(now - days * DAY - hours * 3_600_000).toISOString();

  const servers = [
    { id: 'srv_nyc1', name: 'edge-nyc-01', host: '203.0.113.10', sshPort: 22, sshUser: 'lrweb', os: 'ubuntu-24.04', provider: 'Hetzner', region: 'Ashburn, US', status: 'online', panelVersion: '2.5.1', createdAt: ago(212) },
    { id: 'srv_fra1', name: 'web-fra-01', host: '203.0.113.24', sshPort: 22, sshUser: 'lrweb', os: 'debian-12', provider: 'Hetzner', region: 'Falkenstein, DE', status: 'online', panelVersion: '2.5.1', createdAt: ago(148) },
    { id: 'srv_syd1', name: 'apac-syd-01', host: '198.51.100.7', sshPort: 22, sshUser: 'lrweb', os: 'ubuntu-22.04', provider: 'Vultr', region: 'Sydney, AU', status: 'degraded', panelVersion: '2.4.9', createdAt: ago(61) },
    { id: 'srv_lon1', name: 'staging-lon-01', host: '192.0.2.55', sshPort: 22, sshUser: 'lrweb', os: 'ubuntu-24.04', provider: 'DigitalOcean', region: 'London, UK', status: 'pending', panelVersion: '', createdAt: ago(1) },
  ];

  const clients = [
    { id: 'cli_acme', name: 'Maya Fernandez', company: 'Acme Roasters', email: 'maya@acmeroasters.example', phone: '', planId: 'plan_business', status: 'active', billingCustomerId: 'cus_acme', createdAt: ago(190) },
    { id: 'cli_northwind', name: 'Dr. Leo Hartmann', company: 'Northwind Dental', email: 'leo@northwinddental.example', phone: '', planId: 'plan_starter', status: 'active', billingCustomerId: 'cus_northwind', createdAt: ago(144) },
    { id: 'cli_pixel', name: 'Sam Okafor', company: 'Pixel & Pine Studio', email: 'sam@pixelpine.example', phone: '', planId: 'plan_agency', status: 'active', billingCustomerId: 'cus_pixel', createdAt: ago(120) },
    { id: 'cli_harbor', name: 'Priya Nair', company: 'Harbor Legal LLP', email: 'priya@harborlegal.example', phone: '', planId: 'plan_business', status: 'active', billingCustomerId: 'cus_harbor', createdAt: ago(97) },
    { id: 'cli_verdant', name: 'Tomás Rivera', company: 'Verdant Garden Co', email: 'tomas@verdantgarden.example', phone: '', planId: 'plan_starter', status: 'suspended', billingCustomerId: 'cus_verdant', createdAt: ago(80) },
    { id: 'cli_kestrel', name: 'Hannah Lindqvist', company: 'Kestrel Logistics', email: 'hannah@kestrellogistics.example', phone: '', planId: 'plan_agency', status: 'active', billingCustomerId: 'cus_kestrel', createdAt: ago(52) },
    { id: 'cli_lumen', name: 'Aiko Tanaka', company: 'Lumen Yoga', email: 'aiko@lumenyoga.example', phone: '', planId: 'plan_starter', status: 'trial', billingCustomerId: 'cus_lumen', createdAt: ago(6) },
    { id: 'cli_orbit', name: 'Jonas Weber', company: 'Orbit Analytics', email: 'jonas@orbitanalytics.example', phone: '', planId: 'plan_agency', status: 'active', billingCustomerId: 'cus_orbit', createdAt: ago(33) },
  ];

  const site = (id, domain, serverId, clientId, type, runtime, extra = {}) => ({
    id, domain, serverId, clientId, type, runtime, siteUser: domain.split('.')[0].replace(/[^a-z0-9]/g, ''),
    status: 'active', ssl: 'active', database: '', diskMb: 0, createdAt: ago(30), ...extra,
  });
  const sites = [
    site('sit_acme1', 'acmeroasters.example', 'srv_nyc1', 'cli_acme', 'php', '8.3', { database: 'acmeroasters_db', diskMb: 1840, createdAt: ago(188) }),
    site('sit_acme2', 'shop.acmeroasters.example', 'srv_nyc1', 'cli_acme', 'php', '8.3', { database: 'shopacme_db', diskMb: 2310, createdAt: ago(170) }),
    site('sit_north1', 'northwinddental.example', 'srv_fra1', 'cli_northwind', 'php', '8.2', { database: 'northwind_db', diskMb: 720, createdAt: ago(140) }),
    site('sit_pixel1', 'pixelpine.example', 'srv_fra1', 'cli_pixel', 'nodejs', '22', { diskMb: 410, createdAt: ago(118) }),
    site('sit_pixel2', 'blog.pixelpine.example', 'srv_fra1', 'cli_pixel', 'php', '8.4', { database: 'pixelblog_db', diskMb: 980, createdAt: ago(100) }),
    site('sit_harbor1', 'harborlegal.example', 'srv_nyc1', 'cli_harbor', 'php', '8.3', { database: 'harbor_db', diskMb: 650, createdAt: ago(95) }),
    site('sit_verdant1', 'verdantgarden.example', 'srv_syd1', 'cli_verdant', 'php', '8.1', { status: 'suspended', ssl: 'active', database: 'verdant_db', diskMb: 520, createdAt: ago(78) }),
    site('sit_kestrel1', 'kestrellogistics.example', 'srv_fra1', 'cli_kestrel', 'php', '8.3', { database: 'kestrel_db', diskMb: 1320, createdAt: ago(50) }),
    site('sit_kestrel2', 'portal.kestrellogistics.example', 'srv_fra1', 'cli_kestrel', 'nodejs', '20', { diskMb: 290, createdAt: ago(44) }),
    site('sit_lumen1', 'lumenyoga.example', 'srv_nyc1', 'cli_lumen', 'static', '', { diskMb: 85, ssl: 'pending', createdAt: ago(5) }),
    site('sit_orbit1', 'orbitanalytics.example', 'srv_syd1', 'cli_orbit', 'static', '', { diskMb: 140, createdAt: ago(32) }),
    site('sit_orbit2', 'app.orbitanalytics.example', 'srv_syd1', 'cli_orbit', 'python', '3.12', { database: 'orbitapp_db', diskMb: 760, createdAt: ago(31) }),
    site('sit_orbit3', 'api.orbitanalytics.example', 'srv_syd1', 'cli_orbit', 'reverse-proxy', '', { diskMb: 12, createdAt: ago(30) }),
  ];

  const events = [
    { ts: ago(0, 1), kind: 'site', text: 'Issued SSL certificate for lumenyoga.example' },
    { ts: ago(0, 3), kind: 'billing', text: 'Invoice LR-2026-0108 paid by Orbit Analytics' },
    { ts: ago(0, 7), kind: 'server', text: 'apac-syd-01 CPU above 85% for 10 minutes' },
    { ts: ago(1, 2), kind: 'client', text: 'Aiko Tanaka started a trial (Lumen Yoga)' },
    { ts: ago(2, 5), kind: 'site', text: 'Provisioned app.orbitanalytics.example (Python 3.12)' },
    { ts: ago(3, 0), kind: 'billing', text: 'Verdant Garden Co invoice is 12 days overdue' },
    { ts: ago(4, 9), kind: 'server', text: 'staging-lon-01 registered, waiting for CloudPanel install' },
    { ts: ago(6, 1), kind: 'client', text: 'Hannah Lindqvist upgraded to Agency' },
  ];

  servers.forEach((s) => store.insert('servers', s));
  clients.forEach((c) => store.insert('clients', c));
  sites.forEach((s) => store.insert('sites', s));
  events.forEach((e) => store.insert('events', e));
  store.meta.set('seeded', true);
  return true;
}
