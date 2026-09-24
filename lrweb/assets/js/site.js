/* LRWeb — site behaviour (GSAP + ScrollTrigger + Lenis, same stack as lrweb.uk) */
(() => {
  'use strict';
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const root = document.documentElement;
  const G = window.gsap && window.ScrollTrigger ? window.gsap : null;
  if (G) G.registerPlugin(ScrollTrigger);

  /* ---------- smooth scroll ---------- */
  let lenis = null;
  if (G && window.Lenis && !reduce) {
    lenis = new Lenis({ lerp: .1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    G.ticker.add(t => lenis.raf(t * 1000));
    G.ticker.lagSmoothing(0);
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]'); if (!a || !lenis) return;
    const t = $(a.getAttribute('href')); if (!t) return;
    e.preventDefault(); lenis.scrollTo(t, { offset: -30, duration: 1.4 });
  });
  const tick = fn => G ? G.ticker.add(() => fn(performance.now())) : (function f(t) { fn(t); requestAnimationFrame(f); })(performance.now());
  requestAnimationFrame(() => setTimeout(() => root.classList.add('is-ready'), 60));

  /* ---------- toast ---------- */
  let toastT;
  const toast = html => {
    let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.innerHTML = html; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 4200);
  };

  /* ---------- nav ---------- */
  const nav = $('.nav'), nights = $$('[data-night]');
  let lastY = scrollY;
  tick(() => {
    if (!nav) return;
    const y = scrollY;
    nav.classList.toggle('is-scrolled', y > 24);
    let night = false;
    for (const s of nights) { const r = s.getBoundingClientRect(); if (r.top <= 40 && r.bottom > 40) { night = true; break; } }
    nav.classList.toggle('on-night', night);
    if (!root.classList.contains('menu-open')) {
      if (y > lastY + 6 && y > 500) nav.classList.add('is-hidden');
      else if (y < lastY - 6) nav.classList.remove('is-hidden');
    }
    lastY = y;
  });
  const burger = $('.burger');
  const closeMenu = () => { root.classList.remove('menu-open'); burger && burger.setAttribute('aria-expanded', 'false'); lenis && lenis.start(); };
  if (burger) burger.addEventListener('click', () => {
    const open = root.classList.toggle('menu-open');
    burger.setAttribute('aria-expanded', open); burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    nav.classList.remove('is-hidden'); lenis && (open ? lenis.stop() : lenis.start());
  });
  $$('.mmenu a').forEach(a => a.addEventListener('click', closeMenu));
  addEventListener('keydown', e => { if (e.key === 'Escape' && root.classList.contains('menu-open')) closeMenu(); });

  /* ---------- reveal ---------- */
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); e.target.dispatchEvent(new CustomEvent('reveal')); } }), { rootMargin: '0px 0px -12% 0px' });
  $$('[data-reveal],[data-inview]').forEach(el => io.observe(el));

  /* ---------- split headings: words rise out of a mask ---------- */
  function splitWords(el) {
    const walk = n => [...n.childNodes].forEach(c => {
      if (c.nodeType === 3) {
        const f = document.createDocumentFragment();
        c.textContent.split(/(\s+)/).forEach(t => { if (!t) return; if (/^\s+$/.test(t)) return f.append(t); const w = document.createElement('span'); w.className = 'w'; const i = document.createElement('span'); i.textContent = t; w.append(i); f.append(w); });
        c.replaceWith(f);
      } else if (c.nodeType === 1 && c.tagName !== 'BR') walk(c);
    });
    walk(el);
    return $$('.w > span', el);
  }
  $$('[data-split]').forEach(el => {
    const words = splitWords(el);
    if (!G || reduce) return;
    const anim = { yPercent: 115, rotate: 4, duration: 1.05, stagger: .045, ease: 'power4.out' };
    if (el.hasAttribute('data-now')) G.from(words, { ...anim, delay: .25 });
    else G.from(words, { ...anim, scrollTrigger: { trigger: el, start: 'top 88%' } });
  });

  /* ---------- odometer ---------- */
  const DIG = '0123456789'.split('').map(d => `<span>${d}</span>`).join('');
  function odo(el, str, stagger = 0) {
    const chars = [...String(str)];
    if (el._len !== chars.length) {
      el.classList.add('odo');
      el.innerHTML = chars.map(c => /\d/.test(c) ? `<span class="odo__d"><span>${DIG}</span></span>` : `<span class="odo__s">${c}</span>`).join('');
      el._len = chars.length; el._cols = [...el.children];
      void el.offsetWidth;
    }
    chars.forEach((c, i) => {
      const col = el._cols[i];
      if (/\d/.test(c)) { const s = col.firstChild; s.style.transitionDelay = stagger ? `${(chars.length - 1 - i) * stagger}ms` : ''; s.style.transform = `translateY(${-c}em)`; }
      else col.textContent = c;
    });
  }
  const odoIO = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; odoIO.unobserve(e.target);
    const el = e.target, raw = el.dataset.to || el.textContent, to = +raw;
    const dec = (String(raw).split('.')[1] || '').length;
    const txt = dec ? to.toFixed(dec) : Math.round(to).toLocaleString('en-GB');
    odo(el, txt.replace(/\d/g, '0'));
    setTimeout(() => odo(el, txt, 90), reduce ? 0 : 160);
  }), { threshold: .4 });

  /* ---------- plain counters (referral amounts) ---------- */
  const cio = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; cio.unobserve(e.target);
    const el = e.target, to = +el.dataset.count, pre = el.dataset.prefix || '';
    if (reduce || !G) { el.textContent = pre + to; return; }
    const o = { v: 0 }; G.to(o, { v: to, duration: 1.4, ease: 'power3.out', onUpdate: () => el.textContent = pre + Math.round(o.v) });
  }), { threshold: .5 });
  $$('[data-count]').forEach(el => cio.observe(el));

  /* ---------- skies ---------- */
  const skies = [];
  if (window.LRSky) $$('canvas.sky-gl').forEach(c => {
    const s = new LRSky(c, { prog: +c.dataset.prog, hz: +c.dataset.hz, sunX: +c.dataset.sunx, sunR: +c.dataset.sunr, aurora: +(c.dataset.aurora || 1) });
    if (!s.ok) return; skies.push(s); c._sky = s;
    const host = c.parentElement;
    host.addEventListener('pointermove', e => { const r = host.getBoundingClientRect(); s.pointer((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height); });
  });
  tick(now => skies.forEach(s => s.render(now)));

  /* ---------- HERO: one night, fast-forwarded ---------- */
  const hero = $('.hero-night');
  if (hero) {
    const stage = $('.hero-night__stage', hero), skyC = $('#heroSky'), sky = skyC && skyC._sky, log = $('#log'), bars = $('#uptime'), cue = $('.hero__cue', hero), bar = $('#heroBar'), con = $('.console', hero), veil = $('.veil', hero);
    const clockT = $('.clock__t', hero);
    const ICON = {
      ok: '<svg viewBox="0 0 18 18" fill="none"><circle class="ring" cx="9" cy="9" r="8" stroke="#3DB88D" stroke-width="1.4" fill="rgba(61,184,141,.16)" transform="rotate(-90 9 9)"/><path class="tick" d="M5.5 9.2l2.3 2.3 4.7-5" stroke="#3DB88D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      run: '<svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="rgba(11,134,234,.3)" stroke-width="2"/><path d="M9 2a7 7 0 0 1 7 7" stroke="#0B86EA" stroke-width="2" stroke-linecap="round"/></svg>',
      todo: '<svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7.2" stroke="rgba(245,248,250,.4)" stroke-width="1.4" stroke-dasharray="2.5 2.5"/></svg>'
    };
    const EV = [
      [1380, 'Uptime check · site up in 0.4s', 'Uptime check', 'monitored.'],
      [1560, 'Nightly backup started', 'Nightly backup', 'backed up.'],
      [1564, 'Plugin updates applied (4)', 'Plugin updates scheduled', 'updated.'],
      [1571, 'Daily backup complete · 312 MB', 'Daily backup due', 'backed up.'],
      [1650, 'Malware scan · all clear', 'Malware scan', 'secured.'],
      [1815, 'SSL certificate renewed', 'SSL certificate renewal', 'secured.'],
      [1862, 'Cache warmed · pages in 0.8s', 'Cache warm-up', 'hosted.'],
      [1920, 'Uptime check · all good', 'Uptime check', 'monitored.']
    ];
    const pad = n => String(n).padStart(2, '0');
    const tm = m => `${pad(Math.floor(m % 1440 / 60))}:${pad(m % 60)}`;
    const words = $$('.swap > span', hero); words[0].classList.add('in');
    let word = 'handled.';
    const setWord = w => {
      if (w === word) return;
      const cur = words.find(s => s.classList.contains('in')) || words[0], nxt = words.find(s => s.textContent === w); if (!nxt) return;
      cur.classList.remove('in'); cur.classList.add('out'); cur.setAttribute('aria-hidden', 'true');
      nxt.classList.remove('out'); nxt.removeAttribute('aria-hidden'); void nxt.offsetWidth; nxt.classList.add('in');
      setTimeout(() => cur.classList.remove('out'), 650); word = w;
    };
    bars.innerHTML = '<b></b>'.repeat(36); const barEls = $$('b', bars);
    let shownKey = -1, shownN = 0, lastClock = '';
    odo(clockT, '23:00');
    function render(p) {
      const mins = 1380 + p * 540, m = Math.floor(mins) % 1440, c = tm(m);
      if (c !== lastClock) { odo(clockT, c); lastClock = c; }
      const n = EV.filter(e => e[0] <= mins).length, done = p > .985, key = n + (done ? 100 : 0);
      if (key !== shownKey) {
        const items = EV.map((e, i) => {
          if (i >= n) return `<li class="todo">${ICON.todo}<span>${e[2]}</span><time>${tm(e[0])}</time></li>`;
          const running = i === 1 && n < 4;
          const cls = [i === n - 1 && !done ? 'fresh' : '', i === n - 1 && n > shownN && shownKey !== -1 ? 'just' : '', running ? 'run' : '', i < n - (done ? 2 : 3) ? 'old' : ''].join(' ');
          return `<li class="${cls}">${running ? ICON.run : ICON.ok}<span>${e[1]}</span><time>${tm(e[0])}</time></li>`;
        });
        items.push(done ? `<li class="done fresh just">${ICON.ok}<span>All done. Nothing for you to do.</span><time>08:00</time></li>` : `<li class="todo">${ICON.todo}<span>Morning report</span><time>08:00</time></li>`);
        log.innerHTML = items.join('');
        shownKey = key; shownN = n;
      }
      setWord(p < .02 || done ? 'handled.' : (n ? EV[n - 1][3] : 'handled.'));
      const lit = Math.floor(p * 36 + .001);
      barEls.forEach((b, i) => b.classList.toggle('on', i < lit));
      if (sky) sky.set('prog', p);
      if (bar) bar.style.transform = `scaleY(${p})`;
      if (cue) cue.style.opacity = p > .06 ? 0 : 1;
    }
    render(reduce ? 1 : 0);
    if (G && !reduce) {
      const st = { p: 0 };
      G.to(st, { p: 1, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom bottom', scrub: .7 }, onUpdate: () => render(st.p) });
      const tl = G.timeline({ delay: .05 });
      tl.to(veil, { opacity: 0, duration: 1.8, ease: 'power2.inOut' })
        .from($$('h1 .w > span', hero), { yPercent: 115, rotate: 5, duration: 1.2, stagger: .09, ease: 'power4.out' }, .25)
        .from(con, { y: 90, rotationX: -22, opacity: 0, duration: 1.4, ease: 'power3.out' }, .45)
        .from(barEls, { scaleY: 0, transformOrigin: '50% 100%', duration: .5, stagger: .012, ease: 'back.out(3)' }, 1)
        .from($$('li', log), { x: -14, opacity: 0, duration: .5, stagger: .05, ease: 'power2.out' }, .95);
      if (fine) {
        G.set(con, { transformPerspective: 1100 });
        const rx = G.quickTo(con, 'rotationX', { duration: .9, ease: 'power3' }), ry = G.quickTo(con, 'rotationY', { duration: .9, ease: 'power3' });
        stage.addEventListener('pointermove', e => {
          const r = con.getBoundingClientRect();
          rx(-(e.clientY - (r.top + r.height / 2)) / innerHeight * 10); ry((e.clientX - (r.left + r.width / 2)) / innerWidth * 12);
          con.style.setProperty('--gx', `${((e.clientX - r.left) / r.width) * 100}%`); con.style.setProperty('--gy', `${((e.clientY - r.top) / r.height) * 100}%`);
        });
        stage.addEventListener('pointerleave', () => { rx(0); ry(0); });
      }
    } else {
      veil.style.display = 'none';
      if (!G && !reduce) addEventListener('scroll', () => { const r = hero.getBoundingClientRect(); render(clamp(-r.top / (r.height - innerHeight), 0, 1)); }, { passive: true });
    }
  }

  /* ---------- who-we-work-with marquee leans with scroll speed ---------- */
  const who = $('.who__row');
  if (who && G && lenis) { const sk = G.quickTo(who, 'skewX', { duration: .5, ease: 'power3' }); tick(() => sk(clamp(-lenis.velocity * .35, -12, 12))); }

  /* ---------- STORY: the laptop ---------- */
  const story = $('.story');
  if (story && G && !reduce) {
    const lap = $('.lap', story), steps = $$('.sstep', story), sbars = $$('.story__bar b', story);
    const tl = G.timeline({
      defaults: { ease: 'power2.inOut' },
      scrollTrigger: {
        trigger: story, start: 'top top', end: 'bottom bottom', scrub: .9,
        onUpdate: self => {
          const p = self.progress, idx = Math.min(3, Math.floor(p * 4.001));
          steps.forEach((s, i) => s.classList.toggle('is-on', i === idx));
          sbars.forEach((b, i) => b.style.transform = `scaleX(${clamp(p * 4 - i, 0, 1)})`);
        }
      }
    });
    tl.to(lap, { '--open': '16deg', '--ry': '-12deg', '--tilt': '-17deg', '--s': 1, duration: 1.1 })
      .from($$('.wire__nav i', story), { scaleX: 0, transformOrigin: 'left', stagger: .1, duration: .4 }, 1.1)
      .from($$('.wire__hero .lines > *', story), { scaleX: 0, transformOrigin: 'left', stagger: .08, duration: .45, ease: 'back.out(1.6)' }, 1.2)
      .from($('.wire__img', story), { scale: .4, opacity: 0, rotate: -8, duration: .6, ease: 'back.out(2)' }, 1.35)
      .from($$('.wire__cards i', story), { y: 30, opacity: 0, stagger: .1, duration: .45, ease: 'back.out(2)' }, 1.55)
      .to(lap, { '--ry': '8deg', duration: 1.4, ease: 'sine.inOut' }, 1.9)
      .to($('.lap__site', story), { clipPath: 'inset(0 0 0% 0)', duration: .9 }, 2.1)
      .from($('.lap__site img', story), { scale: 1.12, duration: 1 }, 2.1)
      .to($('.story__glow', story), { opacity: .9, y: -40, duration: .9, ease: 'power1.out' }, 3)
      .to($$('.lap__toasts div', story), { opacity: 1, y: 0, scale: 1, stagger: .12, duration: .35, ease: 'back.out(2.4)' }, 3.05)
      .to($$('.chip3', story), { opacity: 1, scale: 1, stagger: .09, duration: .45, ease: 'back.out(2.2)' }, 3.15)
      .to(lap, { '--ry': '0deg', '--tilt': '-14deg', duration: .8 }, 3.2)
      .to({}, { duration: .5 });
    $$('.chip3', story).forEach((c, i) => G.to(c, { yPercent: i % 2 ? 14 : -14, duration: 2.4 + i * .3, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
  }

  /* ---------- month of care ---------- */
  const cal = $('#cal');
  if (cal) {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
    const y = now.getFullYear(), mo = now.getMonth(), today = now.getDate();
    const days = new Date(y, mo + 1, 0).getDate(), first = (new Date(y, mo, 1).getDay() + 6) % 7;
    const EDITS = { 5: 'Opening hours updated', 12: 'New photos added to gallery', 19: 'Price list updated', 26: 'Seasonal notice added' };
    $('#calMonth').textContent = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cal__dow">${d}</div>`).join('');
    for (let i = 0; i < first; i++) html += '<div class="day empty"></div>';
    let tues = 0;
    for (let d = 1; d <= days; d++) {
      const dow = new Date(y, mo, d).getDay(), past = d <= today, dots = ['<i class="bk"></i>'], tip = ['Backup at 02:00'];
      if (dow === 2) { dots.push('<i class="up"></i>'); tip.push('updates applied'); if (past) tues++; }
      if (dow === 0) { dots.push('<i class="sc"></i>'); tip.push('deep security scan'); }
      if (EDITS[d]) { dots.push('<i class="ed"></i>'); tip.push(EDITS[d].toLowerCase()); }
      html += `<div class="day ${d === today ? 'today' : ''} ${past ? '' : 'future'}" data-tip="${past ? '' : 'Scheduled: '}${tip.join(', ')}"><span class="d">${d}</span><span class="dots">${dots.join('')}</span></div>`;
    }
    cal.innerHTML = html;
    const set = (id, v) => { const el = $(id); if (el) el.dataset.to = v; };
    set('#tBackups', today); set('#tChecks', (today - 1) * 1440 + now.getHours() * 60 + now.getMinutes()); set('#tUpdates', tues);
    const dayEls = $$('.day:not(.empty)', cal);
    cal.closest('[data-inview]').addEventListener('reveal', () => {
      if (G && !reduce) {
        G.from(dayEls, { scale: .4, opacity: 0, duration: .7, ease: 'back.out(2.4)', stagger: { grid: 'auto', from: 'start', amount: .8 } });
        G.fromTo($('.cal__play'), { left: '-60px' }, { left: '100%', duration: 1.6, ease: 'power1.inOut', delay: .2 });
      }
      dayEls.forEach((d, i) => setTimeout(() => d.classList.add('lit'), reduce ? 0 : 300 + i * 35));
    }, { once: true });
  }
  $$('[data-odo]').forEach(el => odoIO.observe(el));

  /* ---------- before / after ---------- */
  $$('.ba').forEach(ba => {
    const range = $('.ba__range', ba), cur = { v: 50 };
    const apply = () => ba.style.setProperty('--split', cur.v + '%');
    const to = G ? G.quickTo(cur, 'v', { duration: .55, ease: 'power3.out', onUpdate: apply }) : v => { cur.v = v; apply(); };
    let touched = false, intro = null;
    range.addEventListener('input', () => { if (!touched) { touched = true; ba.classList.add('touched'); intro && intro.kill(); } to(+range.value); });
    ba.addEventListener('reveal', () => {
      if (reduce || !G || touched) return;
      intro = G.timeline({ delay: .5 })
        .to(cur, { v: 16, duration: 1, ease: 'power3.inOut', onUpdate: apply })
        .to(cur, { v: 82, duration: 1.3, ease: 'power3.inOut', onUpdate: apply })
        .to(cur, { v: 50, duration: 1.2, ease: 'elastic.out(1,.55)', onUpdate: apply });
    }, { once: true });
  });

  /* ---------- spectrum pin: slide and settle ---------- */
  const spec = $('.spectrum');
  if (spec && G && !reduce) {
    const pin = $('.spectrum__pin', spec); pin.style.transition = 'none'; G.set(pin, { left: '6%' });
    spec.addEventListener('reveal', () => G.to(pin, { left: '50%', duration: 1.8, ease: 'elastic.out(1,.6)', delay: .4 }), { once: true });
  }

  /* ---------- example-site carousel (3D) ---------- */
  const car = $('#carousel');
  if (car) {
    const ring = $('.carousel__ring', car), cards = $$('.ccard', car), N = cards.length, step = 360 / N, dots = $$('.carousel__dots i');
    let R = 600, angle = 0, target = 0, dragging = false, moved = 0, sx = 0, sa = 0, vel = 0, lastX = 0, lastT = 0, hover = false, idle = 0;
    const layout = () => {
      const cw = Math.min(460, innerWidth * (innerWidth < 760 ? .72 : .32));
      car.style.setProperty('--cw', cw + 'px');
      R = (cw / 2) / Math.tan(Math.PI / N) * 1.16;
      cards.forEach((c, i) => { c.style.transform = `rotateY(${i * step}deg) translateZ(${R}px)`; c.style.backfaceVisibility = 'hidden'; });
      $$('.ccard__view', car).forEach(v => v.style.setProperty('--vh', v.clientHeight + 'px'));
    };
    layout(); addEventListener('resize', layout);
    const nearest = i => { const d = ((-i * step - target) % 360 + 540) % 360 - 180; target += d; idle = 0; };
    const go = dir => { target = Math.round(target / step) * step - dir * step; idle = 0; };
    $$('.carousel__ui button').forEach(b => b.addEventListener('click', () => go(+b.dataset.dir)));
    car.addEventListener('pointerdown', e => { if (e.button) return; dragging = true; moved = 0; sx = lastX = e.clientX; sa = target; lastT = performance.now(); vel = 0; car.classList.add('is-drag'); });
    addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - sx; moved = Math.max(moved, Math.abs(dx));
      target = sa + dx * .22;
      const t = performance.now(); vel = (e.clientX - lastX) / Math.max(1, t - lastT); lastX = e.clientX; lastT = t;
    });
    const end = () => { if (!dragging) return; dragging = false; car.classList.remove('is-drag'); target = Math.round((target + vel * 90) / step) * step; idle = 0; };
    addEventListener('pointerup', end); addEventListener('pointercancel', end);
    car.addEventListener('click', e => {
      const c = e.target.closest('.ccard'); if (!c) return;
      if (moved > 6) { e.preventDefault(); return; }
      if (!c.classList.contains('front')) { e.preventDefault(); nearest(cards.indexOf(c)); }
    });
    car.addEventListener('pointerenter', () => hover = true); car.addEventListener('pointerleave', () => hover = false);
    cards.forEach((c, i) => c.addEventListener('focus', () => nearest(i)));
    let visible = false; new IntersectionObserver(([e]) => visible = e.isIntersecting).observe(car);
    tick(() => {
      if (!visible) return;
      if (!dragging && !hover && !reduce && ++idle > 280) go(1);
      angle += (target - angle) * (dragging ? .35 : .075);
      ring.style.transform = `translateZ(${-R}px) rotateY(${angle}deg)`;
      const fi = ((Math.round(-angle / step) % N) + N) % N;
      cards.forEach((c, i) => {
        const rel = (((i * step + angle) % 360) + 540) % 360 - 180;
        c.style.filter = `brightness(${(.3 + .7 * Math.max(0, Math.cos(rel * Math.PI / 180))).toFixed(3)})`;
        c.classList.toggle('front', i === fi); c.tabIndex = i === fi ? 0 : -1;
      });
      dots.forEach((d, i) => d.classList.toggle('on', i === fi));
    });
  }

  /* ---------- pricing cards: spring tilt + glare ---------- */
  if (G && fine && !reduce) $$('.plan').forEach(pl => {
    G.set(pl, { transformPerspective: 1200 });
    const rx = G.quickTo(pl, 'rotationX', { duration: .7, ease: 'power3' }), ry = G.quickTo(pl, 'rotationY', { duration: .7, ease: 'power3' }), ty = G.quickTo(pl, 'y', { duration: .5, ease: 'power3' });
    pl.addEventListener('pointermove', e => { const r = pl.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; rx((.5 - y) * 9); ry((x - .5) * 11); ty(-6); pl.style.setProperty('--gx', x * 100 + '%'); pl.style.setProperty('--gy', y * 100 + '%'); });
    pl.addEventListener('pointerleave', () => { rx(0); ry(0); ty(0); });
  });

  /* ---------- estimator ---------- */
  const est = $('#est');
  if (est) {
    const ranges = [[600, 900], [1200, 1800], [2000, 3500]];
    const plans = ['Starter build · Essential care from £29/mo', 'Standard build · Plus care from £49/mo', 'Larger build · Pro care from £89/mo'];
    let size = 0;
    const price = $('#estPrice'), plan = $('#estPlan'), shop = $('#estShop'), rescue = $('#estRescue');
    const f = n => '£' + n.toLocaleString('en-GB');
    const update = () => {
      const i = Math.max(size, shop.checked ? 2 : 0);
      price.textContent = f(ranges[i][0]) + '–' + f(ranges[i][1]);
      plan.textContent = plans[i] + (rescue.checked ? ' · free migration included' : '');
      if (G && !reduce) G.fromTo(price, { y: 18, opacity: 0, filter: 'blur(6px)' }, { y: 0, opacity: 1, filter: 'blur(0px)', duration: .55, ease: 'power3.out' });
    };
    $$('.seg button', est).forEach(b => b.addEventListener('click', () => { $$('.seg button', est).forEach(x => x.setAttribute('aria-pressed', x === b)); size = +b.dataset.size; update(); }));
    [shop, rescue].forEach(c => c.addEventListener('change', update));
  }

  /* ---------- FAQ ---------- */
  $$('.faq__q').forEach(q => q.addEventListener('click', () => { const it = q.closest('.faq__item'), open = it.classList.toggle('open'); q.setAttribute('aria-expanded', open); setTimeout(() => G && ScrollTrigger.refresh(), 520); }));

  /* ---------- timeline progress (services) ---------- */
  const tls = $$('.timeline');
  if (tls.length) tick(() => tls.forEach(tl => {
    const r = tl.getBoundingClientRect(), vh = innerHeight;
    tl.style.setProperty('--tl', clamp((vh * .62 - r.top) / r.height, 0, 1).toFixed(3));
    $$('li', tl).forEach(li => li.classList.toggle('on', li.getBoundingClientRect().top < vh * .62));
  }));

  /* ---------- work-card hover scroll ---------- */
  const measureWork = () => $$('.wcard__view').forEach(v => v.style.setProperty('--vh', v.clientHeight + 'px'));
  addEventListener('load', measureWork); addEventListener('resize', measureWork);

  /* ---------- contact form (same behaviour as the live site) ---------- */
  const form = $('#contactForm');
  if (form) {
    let mode = 'project';
    const tierWrap = $('#f-tier-wrap'), msgLabel = $('#f-msg-label'), msg = $('#f-msg'), tabs = $$('.tabs button', form);
    const setTab = tab => {
      tabs.forEach(t => t.setAttribute('aria-selected', t === tab));
      mode = tab.dataset.tab; const hosting = mode === 'hosting';
      tierWrap.hidden = !hosting;
      msgLabel.textContent = hosting ? 'Tell us about your current setup' : 'Tell us about the project';
      msg.placeholder = hosting ? 'Where is the site hosted now? Any problems with it? Anything you’d like improved?' : 'What does the website need to do? Any sites you like the look of? Rough timeline?';
    };
    tabs.forEach(t => t.addEventListener('click', () => setTab(t)));
    const plan = new URLSearchParams(location.search).get('plan');
    if (plan) { setTab(tabs.find(t => t.dataset.tab === 'hosting')); const sel = $('#f-tier'); [...sel.options].forEach(o => { if (o.value.toLowerCase().startsWith(plan.toLowerCase())) sel.value = o.value; }); }
    const v = id => ($('#' + id).value || '').trim();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const checks = [['f-name', v('f-name')], ['f-email', /^\S+@\S+\.\S+$/.test(v('f-email'))], ['f-msg', v('f-msg')]];
      let bad = null;
      checks.forEach(([id, ok]) => { const fl = $('#' + id).closest('.field'); fl.classList.toggle('bad', !ok); if (!ok && !bad) bad = $('#' + id); });
      if (bad) { bad.focus(); G && G.fromTo(bad.closest('.field'), { x: -8 }, { x: 0, duration: .6, ease: 'elastic.out(1,.3)' }); return; }
      const payload = { name: v('f-name'), email: v('f-email'), organisation: v('f-biz'), website: v('f-url'), plan: mode === 'hosting' ? $('#f-tier').value : '', message: v('f-msg'), hp: $('#f-hp').value, source: 'website contact form' };
      const mailto = () => {
        const subject = mode === 'hosting' ? 'Hosting & care enquiry' : 'Website project enquiry';
        let body = `Name: ${payload.name}\nBusiness: ${payload.organisation}\nEmail: ${payload.email}\nCurrent site: ${payload.website}\n`;
        if (mode === 'hosting') body += `Plan interest: ${payload.plan}\n`;
        location.href = `mailto:hello@lrweb.uk?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n' + payload.message)}`;
      };
      const btn = $('button[type="submit"]', form), label = btn.innerHTML;
      btn.disabled = true; btn.textContent = 'Sending…';
      const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
      if (window.AbortSignal && AbortSignal.timeout) opts.signal = AbortSignal.timeout(9000);
      fetch(form.dataset.endpoint || '/api/contact', opts).then(res => {
        btn.disabled = false; btn.innerHTML = label;
        if (res.status === 200 || res.status === 201) { form.hidden = true; $('#formOk').hidden = false; $('#formOk h3').focus(); toast('<b>Received.</b> We’ll reply within one working day.'); return; }
        toast('<b>Couldn’t reach our form.</b> Opening your email app instead, or email hello@lrweb.uk.'); mailto();
      }).catch(() => { btn.disabled = false; btn.innerHTML = label; toast('<b>Couldn’t reach our form.</b> Opening your email app instead, or email hello@lrweb.uk.'); mailto(); });
    });
  }

  /* ---------- small things ---------- */
  $$('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
  let buf = '';
  addEventListener('keydown', e => {
    if (e.key.length !== 1 || e.target.matches('input,textarea,select')) return;
    buf = (buf + e.key.toLowerCase()).slice(-5);
    if (buf === 'panic') { buf = ''; toast('<b>Don’t.</b> We’ve got backups.'); }
  });
  addEventListener('load', () => G && ScrollTrigger.refresh());
})();
