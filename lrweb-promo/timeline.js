// LRWeb promo v2: one timeline, two edits (16:9 landscape and a native 9:16 vertical cut).
// Everything is in BARS (150 BPM, 1 bar = 1.6 s). The scene reads this in the browser; `node timeline.js`
// writes events.json, which music.py turns into the arrangement and places every sound effect.
(function () {
  const BPM = 150, BEAT = 60 / BPM, BAR = BEAT * 4;

  // copy shared by both edits
  const ERRORS = [
    ['14 updates available', 'Plugins · theme · core'],
    ['SSL certificate expires in 2 days', 'Visitors will see “Not secure”'],
    ['Last backup: never', 'No restore point found'],
    ['Page load: 9.4s', '53% of visitors already gave up'],
    ['37 suspicious logins', 'wp-admin · 03:12'],
    ['Site down?', 'Nobody is checking'],
    ['PHP 5.6 is end of life', 'Since 2018'],
    ['“Is your website broken?”', 'Email from a customer'],
    ['Disk 98% full', 'Hosting account'],
    ['Contact form not sending', '12 enquiries lost'],
  ];
  const WORDS = ['HOSTED.', 'UPDATED.', 'BACKED UP.', 'SECURED.', 'MONITORED.', 'SPEEDY.', 'SUPPORTED.', 'HANDLED.'];
  const CARE = [
    ['00:12', 'Backup saved off-site'], ['01:40', 'Updates tested, then applied'], ['02:58', 'Security scan: clear'],
    ['04:05', 'SSL padlock renewed'], ['06:30', 'Pages cached · 0.8s'], ['07:59', '540 uptime checks ✓'],
  ];
  const SITES = [
    ['crumb-and-kiln', 'crumbandkiln.co.uk', 'BAKERY'], ['northside-barber', 'northsidebarber.co.uk', 'BARBER'],
    ['petal-and-stem', 'petalandstem.co.uk', 'FLORIST'], ['volt-strength', 'voltstrength.co.uk', 'GYM'],
    ['tidewater', 'tidewater.co.uk', 'RESTAURANT'], ['form-and-field', 'formandfield.studio', 'ARCHITECTS'],
  ];
  const RECEIPT = ['Managed hosting', 'Software updates', 'Daily backups', 'Security monitoring', 'Uptime checks', 'SSL padlock', 'Small edits', 'Luke & Ralph'];

  const seq = (a, step, n) => Array.from({ length: n }, (_, i) => +(a + i * step).toFixed(4));

  // ---------------------------------------------------------------- edits
  // scenes: [name, startBar, lengthBars, options]; cue times inside options are LOCAL bars.
  // music: [section, startBar, lengthBars]
  const landscape = {
    name: 'landscape', W: 1920, H: 1080, bars: 25, end: 40.0,
    music: [['intro', 0, 2], ['build', 2, 2], ['drop', 4, 7.5], ['tapestop', 11.5, 0.5], ['lofi', 12, 2], ['drop2', 14, 6], ['build2', 20, 1], ['outro', 21, 4]],
    scenes: [
      ['night', 0, 2, { lines: [[0, 'IT’S', '11PM.'], [1.0, 'YOUR WEBSITE IS', 'HOME ALONE.']] }],
      ['errors', 2, 2, { spawn: [...seq(0, .25, 4), ...seq(1, .125, 6)], who: [1.0, 1.25, 1.5], gap: 1.75 }],
      ['logo', 4, 1, {}],
      ['words', 5, 2, { at: seq(0, .25, 8) }],
      ['overnight', 7, 2, { ticks: seq(.25, .25, 6), slept: [1.5, 1.75] }],
      ['showcase', 9, 3, { at: seq(0, .45, 6), stop: 2.5 }],
      ['old', 12, 2, { stuck: .25, mosh: 1.5 }],
      ['rescue', 14, 1.5, { cap: [.25, .75] }],
      ['price', 15.5, 3, { from: 0, slam: .25, sticker: 1.0, receipt: seq(1.25, .125, 8), build: 2.5 }],
      ['humans', 18.5, 1.5, { lines: [0, .25, .5], q: .75, a: 1.125 }],
      ['build', 20, 1, { lines: [0, .5], gap: .75 }],
      ['end', 21, 4, { tag: .5, url: 1.0, fine: 1.25 }],
    ],
  };

  const vertical = {
    name: 'vertical', W: 1080, H: 1920, bars: 19, end: 30.4,
    music: [['hook', 0, 1], ['build', 1, 2], ['drop', 3, 5.5], ['tapestop', 8.5, 0.5], ['lofi', 9, 1], ['drop2', 10, 4.5], ['build2', 14.5, 1], ['outro', 15.5, 3.5]],
    scenes: [
      ['night', 0, 1, { lines: [[0, 'IT’S', '11PM.'], [.5, 'YOUR WEBSITE IS', 'HOME ALONE.']] }],
      ['errors', 1, 2, { spawn: [...seq(0, .25, 4), ...seq(1, .125, 4)], who: [1.5, 1.625, 1.75], gap: 1.875 }],
      ['logo', 3, 1, {}],
      ['words', 4, 1, { at: seq(0, .125, 8) }],
      ['overnight', 5, 1.5, { ticks: seq(.125, .125, 6), slept: [1.0, 1.25] }],
      ['showcase', 6.5, 2.5, { at: seq(0, .35, 6), stop: 2.0 }],
      ['old', 9, 1, { stuck: .125, mosh: .625 }],
      ['rescue', 10, 1, { cap: [.125, .5] }],
      ['price', 11, 2, { from: 0, slam: .125, sticker: .75, receipt: seq(1.0, .0625, 8), build: 1.5 }],
      ['humans', 13, 1.5, { lines: [0, .25, .5], q: .75, a: 1.125 }],
      ['build', 14.5, 1, { lines: [0, .5], gap: .75 }],
      ['end', 15.5, 3.5, { tag: .5, url: 1.0, fine: 1.25 }],
    ],
  };

  // ---------------------------------------------------------------- sound effects from scene cues
  function sfx(edit) {
    const ev = [];
    const add = (bar, kind, gain = 1, opt = {}) => ev.push({ t: +(bar * BAR).toFixed(4), kind, gain, ...opt });
    for (const [name, s, len, o] of edit.scenes) {
      const at = (lb) => s + lb;
      if (name === 'night') { add(s, 'hook'); o.lines.forEach(([b], i) => i && add(at(b), 'slam', .8)); }
      if (name === 'errors') { o.spawn.forEach((b, i) => add(at(b), 'error', .55 + .35 * (i / o.spawn.length), { i })); o.who.forEach((b, i) => add(at(b), 'glitch', .8, { i })); add(at(o.gap), 'revcrash'); }
      if (name === 'logo') add(s, 'drop');
      if (name === 'words') o.at.forEach((b, i) => i && add(at(b), 'snap', .5, { i }));
      if (name === 'overnight') { add(s, 'whoosh'); o.ticks.forEach((b, i) => add(at(b), 'tick', .6, { i })); add(at(o.slept[0]), 'slam', .7); }
      if (name === 'showcase') { o.at.forEach((b, i) => add(at(b), 'pass', .6, { i })); }
      if (name === 'old') { add(at(o.stuck), 'stamp', .9); add(at(o.mosh), 'mosh'); }
      if (name === 'rescue') { add(s, 'drop2'); }
      if (name === 'price') { add(at(o.slam), 'cash', .8); add(at(o.sticker), 'stamp', .9); o.receipt.forEach((b, i) => add(at(b), 'tick', .45, { i })); add(at(o.build), 'slam', 1); }
      if (name === 'humans') { add(s, 'whoosh'); add(at(o.q), 'msg_in', .8); add(at(o.a), 'msg_out', .8); }
      if (name === 'build') { add(at(o.gap), 'revcrash'); }
      if (name === 'end') add(s, 'final');
    }
    return ev.sort((a, b) => a.t - b.t);
  }

  const EDITS = { landscape, vertical };
  const TL = { BPM, BEAT, BAR, FPS: 60, ERRORS, WORDS, CARE, SITES, RECEIPT, EDITS, sfx };

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
