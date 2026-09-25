// Single source of truth for timing. The scene reads it in the browser;
// `node timeline.js` writes events.json, which music.py uses to place every hit.
(function () {
  const BPM = 120, BEAT = 60 / BPM, BAR = BEAT * 4;
  const range = (a, b, step) => { const o = []; for (let t = a; t < b - 1e-9; t += step) o.push(+t.toFixed(4)); return o; };

  const sections = { drop1: 8, tapestop: 21.5, lofi: 22, drop2: 24, breakdown: 32, final: 36 };

  const LINE1 = "It's 11pm.", LINE2 = 'Do you know what your website is doing?';
  const typing1 = { t0: 0.7, cps: 1 / 0.075, text: LINE1 };
  const typing2 = { t0: 2.0, cps: 1 / 0.034, text: LINE2 };
  const typeTimes = (o) => [...o.text].map((c, i) => (c === ' ' ? null : +(o.t0 + i / o.cps).toFixed(4))).filter((x) => x !== null);

  const alerts = [
    { t: 4.0,  icon: '!', text: '14 updates available', sub: 'Plugins · theme · core', x: 250, y: 220, r: -4 },
    { t: 4.5,  icon: '🔓', text: 'SSL certificate expires in 2 days', sub: 'Visitors will see “Not secure”', x: 1330, y: 180, r: 3 },
    { t: 5.0,  icon: '⟲', text: 'Last backup: never', sub: 'No restore point found', x: 190, y: 760, r: 3 },
    { t: 5.5,  icon: '⚠', text: '37 suspicious logins blocked… maybe', sub: 'wp-admin · 03:12', x: 1300, y: 780, r: -3 },
    { t: 6.25, icon: '⏱', text: 'Page load: 9.4s', sub: 'Visitors gave up', x: 760, y: 90, r: -2 },
    { t: 6.75, icon: '✕', text: 'Site down? Nobody checked.', sub: 'Uptime monitor: none', x: 700, y: 870, r: 2 },
    { t: 7.0,  icon: '!', text: 'PHP 5.6 is end of life', sub: 'Since 2018', x: 60, y: 470, r: -5 },
    { t: 7.25, icon: '✉', text: '“Is your website broken?”', sub: 'from a customer', x: 1480, y: 480, r: 4 },
  ];

  const words = [ // the rotating word in "Your website, ___"
    { t: 9.0, w: 'handled.' }, { t: 9.5, w: 'monitored.' }, { t: 10.0, w: 'backed up.' },
    { t: 10.5, w: 'updated.' }, { t: 11.0, w: 'secured.' }, { t: 11.5, w: 'handled.' },
  ];

  const careLog = [
    { t: 12.5, time: '00:12', text: 'Daily backup saved off-site' },
    { t: 13.0, time: '01:40', text: 'Updates tested on a copy, then applied' },
    { t: 13.5, time: '02:58', text: 'Security scan: all clear' },
    { t: 14.0, time: '04:05', text: 'Padlock (SSL) renewed' },
    { t: 14.5, time: '06:30', text: 'Pages cached, loading in 0.8s' },
    { t: 15.0, time: '07:59', text: '540 uptime checks. All green.' },
  ];

  const sites = [
    { t: 16.0, img: 'crumb-and-kiln', url: 'crumbandkiln.co.uk', kind: 'Bakery & café' },
    { t: 17.0, img: 'northside-barber', url: 'northsidebarber.co.uk', kind: 'Barbershop' },
    { t: 18.0, img: 'petal-and-stem', url: 'petalandstem.co.uk', kind: 'Florist' },
    { t: 19.0, img: 'volt-strength', url: 'voltstrength.co.uk', kind: 'Independent gym' },
    { t: 20.0, img: 'tidewater', url: 'tidewater.co.uk', kind: 'Seafood restaurant' },
    { t: 21.0, img: 'form-and-field', url: 'formandfield.studio', kind: 'Architects' },
  ];

  const receipt = [
    'Managed hosting', 'Software updates', 'Daily backups', 'Security monitoring',
    'Uptime checks, every minute', 'SSL padlock', 'Small content edits', 'Real humans: Luke & Ralph',
  ].map((text, i) => ({ t: 28.0 + i * 0.25, text }));

  const kicks = [...range(sections.drop1, sections.tapestop, BEAT), ...range(sections.drop2, sections.breakdown, BEAT)];

  const TL = {
    BPM, BEAT, BAR, DUR: 42, FPS: 60, W: 1920, H: 1080,
    sections, typing1, typing2, alerts, words, careLog, sites, receipt, kicks,
    events: {
      sections,
      typing: [...typeTimes(typing1), ...typeTimes(typing2)],
      errors: alerts.map((a) => a.t),
      chimes: careLog.map((c) => c.t),
      whooshes: [12.0, ...sites.slice(1).map((s) => s.t), 26.0, 32.0],
      ticks: receipt.map((r) => r.t),
      stamps: [27.0, 30.0],
      bloops: [33.5, 34.6],
      slider: 23.6,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TL;
    if (require.main === module) {
      require('fs').writeFileSync(require('path').join(__dirname, 'events.json'), JSON.stringify(TL.events, null, 1));
      console.log('wrote events.json');
    }
  } else {
    window.TL = TL;
  }
})();
