// LRWeb promo v3: one timeline, two edits (16:9 landscape and a native 9:16 vertical cut).
// Everything is in BARS (120 BPM, 1 bar = 2 s). The scene reads this in the browser; `node timeline.js`
// writes events.json, which music.py turns into the arrangement and uses to place every sound, on the grid.
(function () {
  const BPM = 120, BEAT = 60 / BPM, BAR = BEAT * 4;
  const seq = (a, step, n) => Array.from({ length: n }, (_, i) => +(a + i * step).toFixed(4));

  // ---------------------------------------------------------------- copy
  const POPS = [ // modern notification banners: [app, title, body]
    ['Website', '14 updates available', 'Plugins, theme and core'],
    ['Security', 'SSL certificate expires in 2 days', 'Visitors will see “Not secure”'],
    ['Backups', 'Last backup: 94 days ago', 'No restore point this month'],
    ['Speed', 'Page load: 9.4 seconds', 'Most visitors leave after 3'],
    ['Inbox', 'Contact form isn’t sending', '6 enquiries didn’t arrive'],
    ['Security', '37 suspicious login attempts', 'wp-admin · last night'],
    ['Hosting', 'Renewal payment failed', 'Site goes offline in 5 days'],
    ['Website', 'PHP 7.4 has reached end of life', 'Upgrade required'],
    ['Uptime', 'Is your website down?', 'A customer just asked'],
    ['Website', 'Plugin conflict detected', 'Checkout page not loading'],
  ];
  const DIALOGS = [
    ['Update failed', 'Could not update theme. Try again later.'],
    ['Warning', 'Your disk is 98% full.'],
    ['Error 500', 'Internal server error.'],
    ['Security alert', 'Unknown admin user created.'],
    ['Error', 'Database connection lost.'],
    ['Warning', 'Mixed content blocked on 12 pages.'],
  ];
  const JOBS = ['Updates.', 'Backups.', 'Security.', 'Hosting.', 'Fixes.', 'Speed.'];
  const SYSTEMS = [ // job two: what the systems and the humans do
    ['Uptime', 'Checked every minute', 'uptime'],
    ['Backups', 'Saved every night, off-site', 'backup'],
    ['Updates', 'Tested on a copy first', 'update'],
    ['Security', 'Scanned daily', 'shield'],
    ['SSL padlock', 'Renewed automatically', 'lock'],
    ['Speed', 'Pages load in 0.8s', 'bolt'],
  ];
  const SITES = [ // showcase (Crumb & Kiln stars in the before/after)
    ['northside-barber', 'Barber', 'northsidebarber.co.uk'], ['petal-and-stem', 'Florist', 'petalandstem.co.uk'],
    ['volt-strength', 'Gym', 'voltstrength.co.uk'], ['tidewater', 'Restaurant', 'tidewater.co.uk'],
    ['smith-and-sons', 'Plumber', 'smithandsons.co.uk'], ['form-and-field', 'Architects', 'formandfield.studio'],
  ];
  const PLANS = [
    ['Essential', 29, 'For brochure sites that need to just work', '95p a day'],
    ['Plus', 49, 'Monthly content edits included', '£1.61 a day'],
    ['Pro', 89, 'Shops, bookings and busier sites', '£2.93 a day'],
  ];

  // ---------------------------------------------------------------- edits
  // scenes: [name, startBar, lengthBars, cues]; cue times are LOCAL bars (0.25 = one beat).
  // music:  [section, startBar, lengthBars]
  const landscape = {
    name: 'landscape', W: 1920, H: 1080, bars: 29, end: 58.5,
    music: [['intro', 0, 4], ['build', 4, 4], ['drop', 8, 8], ['break', 16, 4], ['drop2', 20, 7], ['outro', 27, 2]],
    scenes: [
      ['hook', 0, 4, { head: .5, pops: seq(1.5, .25, 10) }],
      ['storm', 4, 4, { jobs: seq(0, .5, 6).map((b) => b * .5 + 0), pops: [...seq(0, .125, 16), ...seq(2, .0625, 8)], dialogs: seq(.75, .25, 6), who: 2.5, gap: 3.75 }],
      ['drop', 8, 2, { ours: 0, logo: .5, word: 1.0, tag: 1.25 }],
      ['jobs', 10, 1, { a: 0, b: .5 }],
      ['build', 11, 5, { title: 0, before: .5, scan: 1.5, scanEnd: 3.0, pull: 3.25, show: 4.0 }],
      ['care', 16, 4, { title: 0, cards: seq(.75, .25, 6), human: 2.25, run: 3.0, runB: 3.25 }],
      ['pricing', 20, 5, { gap: 0, left: .25, right: .75, land: 1.25, plans: [1.875, 2.0, 2.125], day: 3.0, build: 3.875 }],
      ['humans', 25, 2, { lines: [0, .25, .5], q: 1.0, a: 1.5 }],
      ['end', 27, 2, { logo: 0, tag: .5, url: .75, fine: 1.0 }],
    ],
  };

  const vertical = {
    name: 'vertical', W: 1080, H: 1920, bars: 23, end: 46.5,
    music: [['intro', 0, 2], ['build', 2, 2], ['drop', 4, 7], ['break', 11, 3], ['drop2', 14, 6], ['outro', 20, 3]],
    scenes: [
      ['hook', 0, 2, { head: .125, pops: seq(0, .25, 8) }],
      ['storm', 2, 2, { jobs: seq(0, .25, 4), pops: [...seq(0, .125, 8), ...seq(1, .0625, 8)], dialogs: seq(.25, .25, 4), who: 1.125, gap: 1.75 }],
      ['drop', 4, 2, { ours: 0, logo: .5, word: 1.0, tag: 1.25 }],
      ['jobs', 6, 1, { a: 0, b: .5 }],
      ['build', 7, 4, { title: 0, before: .125, scan: .75, scanEnd: 1.75, pull: 1.875, show: 3.0 }],
      ['care', 11, 3, { title: 0, cards: seq(.375, .1875, 6), human: 1.5, run: 2.125, runB: 2.375 }],
      ['pricing', 14, 4, { gap: 0, left: .25, right: .5, land: 1.0, plans: [1.5, 1.625, 1.75], day: 2.375, build: 3.0 }],
      ['humans', 18, 2, { lines: [0, .25, .5], q: 1.0, a: 1.5 }],
      ['end', 20, 3, { logo: 0, tag: .5, url: 1.0, fine: 1.25 }],
    ],
  };

  // ---------------------------------------------------------------- sound effects from cues (all on the grid)
  // Notification dings are tuned notes (Ab major pentatonic), so the pop-ups play part of the melody.
  const DING = ['C6', 'Eb6', 'F6', 'Ab6', 'F6', 'Eb6', 'C6', 'Eb6', 'Ab6', 'C7'];
  function sfx(edit) {
    const ev = [];
    const add = (bar, kind, gain = 1, opt = {}) => ev.push({ t: +(bar * BAR).toFixed(4), bar: +bar.toFixed(4), kind, gain, ...opt });
    for (const [name, s, len, o] of edit.scenes) {
      const at = (lb) => s + lb;
      if (name === 'hook') { o.pops.forEach((b, i) => add(at(b), 'ding', .9, { note: DING[i % DING.length], i })); }
      if (name === 'storm') {
        o.pops.forEach((b, i) => add(at(b), 'ding', .35 + .35 * (i / o.pops.length), { note: DING[(i * 3) % DING.length], i, soft: 1 }));
        o.jobs.forEach((b, i) => add(at(b), 'thud', .7, { i }));
        o.dialogs.forEach((b, i) => add(at(b), 'error', .45, { i }));
        add(at(o.gap), 'suck');
      }
      if (name === 'drop') { add(s, 'drop'); add(at(o.logo), 'shimmer'); }
      if (name === 'build') { add(at(o.scan), 'scan', 1, { len: (o.scanEnd - o.scan) * BAR }); add(at(o.pull), 'whoosh'); add(at(o.show), 'whoosh', .7); }
      if (name === 'care') o.cards.forEach((b, i) => add(at(b), 'check', .8, { i }));
      if (name === 'pricing') { add(at(o.left), 'whoosh', .6); add(at(o.land), 'land'); o.plans.forEach((b, i) => add(at(b), 'card', .8, { i })); add(at(o.day), 'chime'); add(at(o.build), 'land', .8); }
      if (name === 'humans') { add(at(o.q), 'msg_in'); add(at(o.a), 'msg_out'); }
      if (name === 'end') add(s, 'final');
    }
    return ev.sort((a, b) => a.t - b.t);
  }

  const EDITS = { landscape, vertical };
  const TL = { BPM, BEAT, BAR, FPS: 60, POPS, DIALOGS, JOBS, SYSTEMS, SITES, PLANS, EDITS, sfx };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TL;
    if (require.main === module) {
      const out = {};
      for (const k in EDITS) out[k] = { bpm: BPM, bars: EDITS[k].bars, end: EDITS[k].end, music: EDITS[k].music, sfx: sfx(EDITS[k]) };
      require('fs').writeFileSync(require('path').join(__dirname, 'events.json'), JSON.stringify(out, null, 1));
      console.log('wrote events.json');
    }
  } else {
    window.TL = TL;
  }
})();
