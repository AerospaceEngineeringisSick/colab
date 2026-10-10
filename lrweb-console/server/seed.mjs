// Demo data for mock mode: LRWeb's own identity from docs/CONTRACT-v2.md section 0.
// Clients are made-up example businesses, servers use RFC 5737 documentation IPs, and every domain is .example.
import { deriveSiteUser } from './validate.mjs';

const DAY = 86_400_000;

export function seedIfEmpty(store, now = Date.now()) {
  if (store.meta.get('seeded') || store.all('servers').length) return false;
  const ago = (days, hours = 0) => new Date(now - days * DAY - hours * 3_600_000).toISOString();

  const servers = [
    { id: 'srv_ldn1', name: 'ldn-web-01', host: '203.0.113.10', sshPort: 22, sshUser: 'lrweb', os: 'ubuntu-24.04', provider: 'Example Cloud', region: 'London, UK', status: 'online', panelVersion: '2.5.1', createdAt: ago(210) },
    { id: 'srv_man1', name: 'man-web-01', host: '203.0.113.24', sshPort: 22, sshUser: 'lrweb', os: 'debian-12', provider: 'Example Cloud', region: 'Manchester, UK', status: 'online', panelVersion: '2.5.1', createdAt: ago(236) },
    { id: 'srv_dub1', name: 'dub-web-01', host: '198.51.100.7', sshPort: 22, sshUser: 'lrweb', os: 'ubuntu-22.04', provider: 'Example Cloud', region: 'Dublin, IE', status: 'degraded', panelVersion: '2.4.9', createdAt: ago(150) },
    { id: 'srv_stg1', name: 'staging-01', host: '192.0.2.55', sshPort: 22, sshUser: 'lrweb', os: 'ubuntu-24.04', provider: 'Example Cloud', region: 'London, UK', status: 'pending', panelVersion: '', createdAt: ago(1) },
  ];

  // billingCustomerId links each client to its billing history; createdAt sets where that history starts.
  const clients = [
    { id: 'cli_smith', name: 'Dave Smith', company: 'Smith & Sons', email: 'dave@smithandsons.example', phone: '', planId: 'plan_essential', status: 'active', billingCustomerId: 'cus_smith', createdAt: ago(208) },
    { id: 'cli_crumb', name: 'Rhiannon Price', company: 'Crumb & Kiln', email: 'rhiannon@crumbandkiln.example', phone: '', planId: 'plan_essential', status: 'active', billingCustomerId: 'cus_crumb', createdAt: ago(226) },
    { id: 'cli_north', name: 'Marcus Reid', company: 'Northside Barber', email: 'marcus@northsidebarber.example', phone: '', planId: 'plan_essential', status: 'suspended', billingCustomerId: 'cus_north', createdAt: ago(187) },
    { id: 'cli_petal', name: 'Lucy Hartley', company: 'Petal & Stem', email: 'lucy@petalandstem.example', phone: '', planId: 'plan_plus', status: 'active', billingCustomerId: 'cus_petal', createdAt: ago(131) },
    { id: 'cli_volt', name: 'Jordan Pike', company: 'VOLT Strength', email: 'jordan@voltstrength.example', phone: '', planId: 'plan_plus', status: 'active', billingCustomerId: 'cus_volt', createdAt: ago(121) },
    { id: 'cli_tide', name: 'Owen Fraser', company: 'Tidewater', email: 'owen@tidewater.example', phone: '', planId: 'plan_pro', status: 'active', billingCustomerId: 'cus_tide', createdAt: ago(169) },
    { id: 'cli_form', name: 'Tom Garrity', company: 'Form & Field', email: 'tom@formandfield.example', phone: '', planId: 'plan_essential', status: 'trial', billingCustomerId: 'cus_form', createdAt: ago(9) },
  ];

  const site = (id, domain, serverId, clientId, type, runtime, startedDaysAgo, extra = {}) => ({
    id, domain, serverId, clientId, type, runtime, siteUser: deriveSiteUser(domain),
    status: 'active', ssl: 'active', database: '', diskMb: 0, createdAt: ago(startedDaysAgo), ...extra,
  });
  const sites = [
    // srv_ldn1 (London): Tidewater is the busiest client, so its sites live on the main London box.
    site('sit_smith1', 'smithandsons.example', 'srv_ldn1', 'cli_smith', 'php', '8.3', 206, { database: 'smithandsons_db', diskMb: 2140 }),
    site('sit_smith2', 'staging.smithandsons.example', 'srv_ldn1', 'cli_smith', 'php', '8.3', 190, { database: 'stagingsmithandsons_db', diskMb: 1180, ssl: 'none' }),
    site('sit_tide1', 'tidewater.example', 'srv_ldn1', 'cli_tide', 'php', '8.3', 167, { database: 'tidewater_db', diskMb: 3120 }),
    site('sit_tide2', 'book.tidewater.example', 'srv_ldn1', 'cli_tide', 'php', '8.3', 160, { database: 'booktidewater_db', diskMb: 880 }),
    site('sit_volt1', 'voltstrength.example', 'srv_ldn1', 'cli_volt', 'nodejs', '22', 119, { diskMb: 430 }),
    site('sit_volt2', 'members.voltstrength.example', 'srv_ldn1', 'cli_volt', 'nodejs', '22', 114, { diskMb: 610 }),
    site('sit_form1', 'formandfield.example', 'srv_ldn1', 'cli_form', 'static', '', 8, { ssl: 'pending', diskMb: 60 }),
    // srv_man1 (Manchester)
    site('sit_crumb1', 'crumbandkiln.example', 'srv_man1', 'cli_crumb', 'php', '8.3', 223, { database: 'crumbandkiln_db', diskMb: 1560 }),
    site('sit_petal1', 'petalandstem.example', 'srv_man1', 'cli_petal', 'php', '8.2', 129, { database: 'petalandstem_db', diskMb: 970 }),
    site('sit_petal2', 'shop.petalandstem.example', 'srv_man1', 'cli_petal', 'php', '8.3', 116, { database: 'shoppetalandstem_db', diskMb: 1420 }),
    site('sit_north1', 'northsidebarber.example', 'srv_man1', 'cli_north', 'php', '8.2', 185, { status: 'suspended', database: 'northsidebarber_db', diskMb: 390 }),
    // srv_dub1 (Dublin, degraded): a static preview site, nothing customer-critical
    site('sit_form2', 'preview.formandfield.example', 'srv_dub1', 'cli_form', 'static', '', 6, { ssl: 'pending', diskMb: 40 }),
  ];

  const events = [
    { ts: ago(0, 1), kind: 'site', text: 'Renewed the SSL certificate for crumbandkiln.example' },
    { ts: ago(0, 3), kind: 'billing', text: 'Tidewater paid its latest care plan invoice' },
    { ts: ago(0, 7), kind: 'server', text: 'dub-web-01 CPU above 85% for 10 minutes' },
    { ts: ago(1, 2), kind: 'client', text: 'Form & Field, the architects, started a trial' },
    { ts: ago(2, 5), kind: 'site', text: 'Added a preview site for Form & Field' },
    { ts: ago(3, 0), kind: 'billing', text: 'Northside Barber has an overdue invoice' },
    { ts: ago(4, 9), kind: 'server', text: 'staging-01 added, waiting for CloudPanel to be installed' },
    { ts: ago(6, 1), kind: 'client', text: 'Petal & Stem moved up to the Plus care plan' },
  ];

  servers.forEach((s) => store.insert('servers', s));
  clients.forEach((c) => store.insert('clients', c));
  sites.forEach((s) => store.insert('sites', s));
  events.forEach((e) => store.insert('events', e));
  store.meta.set('seeded', true);
  return true;
}
