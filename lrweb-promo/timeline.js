// LRWeb promo v4, "Websites, handled.": a 60-second motion-design showreel.
// One timeline drives both edits (16:9 landscape and a native 9:16 vertical cut share timing and score).
// Everything is in BARS (120 BPM, 1 bar = 2 s, 1 beat = 0.5 s = 30 frames). The scene reads this in the browser;
// `node timeline.js` writes events.json, which music.py turns into the score and uses to place every sound on the grid.
(function () {
  const BPM = 120, BEAT = 60 / BPM, BAR = BEAT * 4;
  const seq = (a, step, n) => Array.from({ length: n }, (_, i) => +(a + i * step).toFixed(4));

  // ---------------------------------------------------------------- copy
  const POPS = [ // notification banners: [app, title, body]
    ['Website', '14 updates available', 'Plugins, theme and core'],
    ['Security', 'SSL expires in 2 days', 'Visitors will see “Not secure”'],
    ['Backups', 'Last backup: 94 days ago', 'No restore point'],
    ['Speed', 'Page load: 9.4 seconds', 'Most visitors leave after 3'],
    ['Inbox', 'Contact form isn’t sending', '6 enquiries lost'],
    ['Security', '37 failed logins', 'wp-admin · last night'],
    ['Hosting', 'Renewal payment failed', 'Site offline in 5 days'],
    ['Website', 'PHP 7.4 end of life', 'Upgrade required'],
    ['Uptime', 'Is your website down?', 'A customer just asked'],
    ['Website', 'Plugin conflict', 'Checkout not loading'],
    ['Backups', 'Backup failed', 'Disk quota exceeded'],
    ['Speed', 'Images not optimised', '38 MB homepage'],
  ];
  const JOBS = ['Updates.', 'Backups.', 'Security.', 'Hosting.', 'Fixes.', 'Speed.'];
  const SYSTEMS = [ // job two, as a live dashboard: [title, detail, icon]
    ['Uptime', 'Checked every minute', 'uptime'],
    ['Backups', 'Every night, off-site', 'backup'],
    ['Updates', 'Tested on a copy first', 'update'],
    ['Security', 'Scanned daily', 'shield'],
    ['SSL', 'Renewed automatically', 'lock'],
    ['Speed', 'Pages load in 0.8s', 'bolt'],
  ];
  const PLANS = [
    ['Essential', 29, 'Brochure sites'],
    ['Plus', 49, 'Monthly edits'],
    ['Pro', 89, 'Shops & bookings'],
  ];

  // ---------------------------------------------------------------- the edit
  // scenes: [name, startBar, lengthBars, cues]; cue times are LOCAL bars (0.25 = one beat, 0.125 = an 8th).
  const scenes = [
    ['open', 0, 2, { dot: .25, line: .5, cursor: 1.0, type: 1.0 }],                          // a dot of light becomes a cursor
    ['jobs', 2, 2, { l2: 0, l3: .5, iris: 1.0, pops: seq(1.25, .25, 3) }],                 // "comes with jobs." → iris through the o
    ['storm', 4, 4, { words: seq(0, .5, 6), pops: seq(0, .25, 9), rush: seq(2.25, .0625, 8), who: 3.0, gap: 3.75 }],
    ['drop', 8, 2, { ours: 0, mark: .625, word: 1.0, tag: 1.25 }],
    ['two', 10, 1, { split: 0, a: .125, b: .25, grow: .75 }],
    ['build', 11, 5, { before: 0, explode: 1.0, rebuild: 2.0, chrome: 2.0, morph: 3.0, cap: 3.25, flip: 4.75 }],
    ['care', 16, 4, { title: 0, cards: seq(.25, .125, 6), run: 3.0, runB: 3.25 }],
    ['pricing', 20, 4, { plans: [0, .125, .25], split: 1.5, day: 2.0, build: 3.0 }],
    ['humans', 24, 2, { lines: [0, .5, 1.0], people: 1.25, collapse: 1.75 }],
    ['end', 26, 4, { sun: 0, mark: .25, word: .625, tag: 1.0, url: 1.5, fine: 2.0 }],
  ];
  const music = [['intro', 0, 4], ['build', 4, 4], ['themeA', 8, 8], ['break', 16, 4], ['themeB', 20, 6], ['outro', 26, 4]];
  const landscape = { name: 'landscape', W: 1920, H: 1080, bars: 30, end: 60, music, scenes };
  const vertical = { name: 'vertical', W: 1080, H: 1920, bars: 30, end: 60, music, scenes };

  // ---------------------------------------------------------------- sound design from cues (all on the grid)
  function sfx(edit) {
    const ev = [];
    const add = (bar, kind, gain = 1, opt = {}) => ev.push({ t: +(bar * BAR).toFixed(4), bar: +bar.toFixed(4), kind, gain, ...opt });
    const S = Object.fromEntries(edit.scenes.map(([n, s, l, o]) => [n, { s, l, o }]));
    const at = (n, lb) => S[n].s + lb;
    let o;
    o = S.open.o; add(at('open', o.dot), 'dot'); add(at('open', o.line), 'swipe', .6);
    for (let i = 0; i < 13; i++) add(at('open', o.type + i * .0625 + .0625), 'type', 1, { i });
    o = S.jobs.o; add(at('jobs', o.l3), 'hit', .7); add(at('jobs', o.iris), 'iris'); o.pops.forEach((b, i) => add(at('jobs', b), 'pop', 1, { i }));
    o = S.storm.o; o.words.forEach((b, i) => add(at('storm', b), 'slam', 1, { i }));
    o.pops.forEach((b, i) => add(at('storm', b + .125), 'pop', .8, { i: i + 3 })); o.rush.forEach((b, i) => add(at('storm', b), 'tick', .5 + i / 16, { i }));
    add(at('storm', o.who), 'who'); add(at('storm', o.gap), 'suck');
    o = S.drop.o; add(at('drop', 0), 'drop'); add(at('drop', o.mark), 'snap'); add(at('drop', o.word), 'swipe', .5);
    o = S.two.o; add(at('two', o.split), 'swipe', .7); add(at('two', o.grow), 'whoosh');
    o = S.build.o; add(at('build', o.explode), 'whoosh', .8); add(at('build', o.rebuild), 'reveal'); add(at('build', o.morph), 'morph'); add(at('build', o.flip), 'flip');
    o = S.care.o; o.cards.forEach((b, i) => add(at('care', b), 'blip', 1, { i })); add(at('care', o.run), 'swipe', .5);
    o = S.pricing.o; add(at('pricing', 0), 'drop2'); o.plans.forEach((b, i) => add(at('pricing', b), 'deal', 1, { i })); add(at('pricing', o.split), 'tiles'); add(at('pricing', o.day), 'hit', .6); add(at('pricing', o.build), 'hit', .8);
    o = S.humans.o; o.lines.slice(0, 2).forEach((b, i) => add(at('humans', b + .25), 'strike', 1, { i })); add(at('humans', o.people), 'pop', .8, { i: 0 }); add(at('humans', o.collapse), 'suck');
    add(at('end', 0), 'final'); add(at('end', S.end.o.url), 'pop', .6, { i: 1 });
    return ev.sort((a, b) => a.t - b.t);
  }

  const EDITS = { landscape, vertical };
  const TL = { BPM, BEAT, BAR, FPS: 60, POPS, JOBS, SYSTEMS, PLANS, EDITS, sfx };

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
