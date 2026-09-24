/* LRWeb · site behaviour (GSAP + ScrollTrigger + Lenis, same stack as lrweb.uk) */
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

  /* ---------- every page starts at the top (unless a #link says otherwise) ---------- */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (!location.hash) scrollTo(0, 0);

  /* ---------- page transition: the four brand-colour curtain from lrweb.uk ---------- */
  const curtain = $('.curtain');
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || !curtain || reduce || a.target === '_blank' || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return;
    const href = a.getAttribute('href');
    if (!href || /^(https?:|mailto:|tel:|#|javascript:)/.test(href)) return;
    const url = new URL(href, location.href);
    if (url.pathname === location.pathname && url.search === location.search) return;
    e.preventDefault();
    try { sessionStorage.setItem('lr-pt', '1'); } catch (_) {}
    root.classList.remove('pt-in'); root.classList.add('pt-go');
    setTimeout(() => { location.href = url.href; }, 640);
  });
  addEventListener('pageshow', e => { if (e.persisted) root.classList.remove('pt-go', 'pt-in'); });

  /* ---------- smooth scroll ---------- */
  let lenis = null;
  if (G && window.Lenis && !reduce) {
    lenis = new Lenis({ lerp: .13, wheelMultiplier: 1.12, smoothWheel: true });
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
      [1380, 'Checked your site is up · 0.4s', 'Is the site up?', 'monitored.'],
      [1560, 'Saving tonight’s backup…', 'Nightly backup', 'backed up.'],
      [1564, 'Updated 4 add-ons, tested first', 'Software updates', 'updated.'],
      [1571, 'Backup saved safely off-site', 'Backup check', 'backed up.'],
      [1650, 'Security scan · all clear', 'Security scan', 'secured.'],
      [1815, 'Padlock certificate renewed', 'Padlock (SSL) renewal', 'secured.'],
      [1862, 'Pages sped up · load in 0.8s', 'Speed boost', 'hosted.'],
      [1920, 'Checked your site is up · all good', 'Morning check', 'monitored.']
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
      G.to(st, { p: 1, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom bottom', scrub: .45 }, onUpdate: () => render(st.p) });
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
  if (who && G && lenis) { const o = { v: 0 }, sk = G.quickTo(o, 'v', { duration: .5, ease: 'power3', onUpdate: () => who.style.setProperty('--sk', o.v.toFixed(2) + 'deg') }); tick(() => sk(clamp(-lenis.velocity * .35, -12, 12))); }

  /* ---------- STORY: the laptop ---------- */
  const story = $('.story');
  if (story && G && !reduce) {
    const lap = $('.lap', story), steps = $$('.sstep', story), sbars = $$('.story__bar b', story);
    const tl = G.timeline({
      defaults: { ease: 'power2.inOut' },
      scrollTrigger: {
        trigger: story, start: 'top top', end: 'bottom bottom', scrub: .55,
        onUpdate: self => {
          const p = self.progress, idx = Math.min(3, Math.floor(p * 4.001));
          steps.forEach((s, i) => s.classList.toggle('is-on', i === idx));
          sbars.forEach((b, i) => b.style.transform = `scaleX(${clamp(p * 4 - i, 0, 1)})`);
        }
      }
    });
    tl.to(lap, { '--open': '16deg', '--ry': '-12deg', '--tilt': '-17deg', '--s': 1, duration: 1.1 })
      .to(lap, { '--lit': 1, duration: .5, ease: 'power1.in' }, .55)
      .fromTo($('.lap__boot', story), { opacity: 0 }, { opacity: 1, duration: .25, ease: 'none' }, .7)
      .from($('.lap__boot img', story), { scale: .6, opacity: 0, duration: .3, ease: 'back.out(2)' }, .75)
      .to($('.lap__boot', story), { opacity: 0, duration: .3, ease: 'none' }, 1.05)
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
        G.from(dayEls, { scale: .5, opacity: 0, duration: .6, ease: 'back.out(2)', stagger: { grid: 'auto', from: 'start', amount: .7 }, clearProps: 'transform,opacity' });
        G.fromTo($('.cal__play'), { left: '-60px' }, { left: '100%', duration: 1.6, ease: 'power1.inOut', delay: .2 });
      }
      dayEls.forEach((d, i) => setTimeout(() => d.classList.add('lit'), reduce ? 0 : 300 + i * 35));
    }, { once: true });
  }
  if (cal) cal.addEventListener('click', e => { const d = e.target.closest('.day:not(.empty)'); $$('.day.tapped', cal).forEach(x => x !== d && x.classList.remove('tapped')); if (d) d.classList.toggle('tapped'); });
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
    pl.addEventListener('pointerenter', () => { pl.style.transition = 'box-shadow .4s'; }, { once: true });
    pl.addEventListener('pointermove', e => { const r = pl.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; rx((.5 - y) * 9); ry((x - .5) * 11); ty(-6); pl.style.setProperty('--gx', x * 100 + '%'); pl.style.setProperty('--gy', y * 100 + '%'); });
    pl.addEventListener('pointerleave', () => { rx(0); ry(0); ty(0); });
  });

  /* ---------- estimator ---------- */
  const est = $('#est');
  if (est) {
    const ranges = [[299, 299], [600, 900], [1200, 1800], [2000, 3500]];
    const plans = ['Launch site · with any care plan, from £29/mo', 'Starter build · Essential care from £29/mo', 'Standard build · Plus care from £49/mo', 'Larger build · Pro care from £89/mo'];
    let size = 1;
    const price = $('#estPrice'), plan = $('#estPlan'), shop = $('#estShop'), rescue = $('#estRescue'), meter = $('#estMeter');
    const f = n => '£' + n.toLocaleString('en-GB');
    const update = () => {
      const i = Math.max(size, shop.checked ? 3 : 0);
      price.textContent = ranges[i][0] === ranges[i][1] ? f(ranges[i][0]) : f(ranges[i][0]) + ' to ' + f(ranges[i][1]);
      plan.textContent = plans[i] + (rescue.checked ? ' · free migration included' : '');
      if (meter) meter.style.transform = `scaleX(${(i + 1) / 4})`;
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

  /* ---------- plain-English tips (hover, focus or tap) ---------- */
  const tips = $$('.jg');
  if (tips.length) {
    const box = document.createElement('div'); box.className = 'tipbox'; box.id = 'tipbox'; box.setAttribute('role', 'tooltip'); document.body.append(box);
    let cur = null, at = 0, sy = 0;
    const show = el => {
      if (cur && cur !== el) cur.classList.remove('on');
      cur = el; at = performance.now(); sy = scrollY;
      box.innerHTML = '<b>In plain English</b>' + el.dataset.tip; el.setAttribute('aria-describedby', 'tipbox'); el.classList.add('on');
      place(); box.classList.add('on');
    };
    const place = () => {
      if (!cur) return;
      const r = cur.getBoundingClientRect(), tw = box.offsetWidth, th = box.offsetHeight;
      const x = clamp(r.left + r.width / 2 - tw / 2, 12, innerWidth - tw - 12);
      let y = r.top - th - 10; if (y < 70) y = r.bottom + 10;
      box.style.left = x + 'px'; box.style.top = y + 'px';
    };
    const hide = () => { if (!cur) return; cur.classList.remove('on'); cur.removeAttribute('aria-describedby'); cur = null; box.classList.remove('on'); };
    tips.forEach(el => {
      el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(el); });
      el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
      el.addEventListener('focus', () => show(el));
      el.addEventListener('blur', hide);
      el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (cur === el && performance.now() - at > 350) hide(); else show(el); });
    });
    document.addEventListener('click', hide); addEventListener('scroll', () => { if (cur && Math.abs(scrollY - sy) > 40) hide(); else place(); }, { passive: true });
    addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  }

  /* ---------- two jobs: the build loop ---------- */
  const bs = $('.bscene');
  if (bs && G && !reduce) {
    const page = $('.bs-page', bs), opt = $('.bs-opt', bs), optB = $('b', opt), cur = $('.bs-cursor', bs), stamp = $('.bs-stamp', bs), steps = $$('.bs-steps span', bs);
    const THEMES = [['#C46A3A', '#0F2A3D', '#F6F1E9'], ['#3DB88D', '#0B0D35', '#EEF7F3'], ['#E0A340', '#3B2416', '#FBF3E6']];
    const theme = i => { const t = THEMES[i]; page.style.setProperty('--pa', t[0]); page.style.setProperty('--pb', t[1]); page.style.setProperty('--pc', t[2]); optB.textContent = 'ABC'[i]; };
    const step = i => () => steps.forEach((s, j) => { s.classList.toggle('on', j === i); s.classList.toggle('done', j < i); });
    const nav = $$('.bs-nav > *', bs), heads = $$('.bs-h', bs), texts = $$('.bs-t', bs), btn = $('.bs-btn', bs), img = $('.bs-img', bs), cards = $$('.bs-cards i', bs);
    const all = [...nav, ...heads, ...texts, btn, img, ...cards];
    const click = () => G.timeline().to(cur, { scale: .75, duration: .08 }).to(cur, { scale: 1, duration: .15 }).to(opt, { scale: 1.15, duration: .1 }, 0).to(opt, { scale: 1, duration: .2 });
    const tl = G.timeline({ repeat: -1, paused: true, defaults: { ease: 'power2.out' } });
    tl.call(step(0)).call(() => theme(0))
      .set(all, { opacity: 0 }).set(stamp, { opacity: 0, scale: 1.8, rotate: -16 }).set(cur, { left: '72%', top: '78%', opacity: 1 })
      .to({}, { duration: .7 })
      .call(step(1))
      .fromTo(nav, { opacity: 0, y: -8 }, { opacity: 1, y: 0, stagger: .06, duration: .35 })
      .fromTo(heads, { opacity: 1, scaleX: 0, transformOrigin: '0 50%' }, { scaleX: 1, stagger: .15, duration: .45 })
      .fromTo(texts, { opacity: 1, scaleX: 0, transformOrigin: '0 50%' }, { scaleX: 1, stagger: .1, duration: .35 }, '-=.1')
      .fromTo(btn, { opacity: 0, scale: .3 }, { opacity: 1, scale: 1, duration: .45, ease: 'back.out(3)' })
      .fromTo(img, { opacity: 1, clipPath: 'inset(0 100% 0 0 round 10px)' }, { clipPath: 'inset(0 0% 0 0 round 10px)', duration: .6, ease: 'power2.inOut' }, '<-.25')
      .fromTo(cards, { opacity: 0, y: 14 }, { opacity: 1, y: 0, stagger: .08, duration: .4, ease: 'back.out(2)' })
      .to(cur, { left: '86%', top: '6%', duration: .8, ease: 'power2.inOut' })
      .call(() => { theme(1); click(); }).to({}, { duration: 1 })
      .call(() => { theme(2); click(); }).to({}, { duration: 1 })
      .call(() => { theme(0); click(); }).to({}, { duration: .5 })
      .call(step(2))
      .to(cur, { left: '30%', top: '64%', duration: .8, ease: 'power2.inOut' })
      .to(btn, { scale: 1.15, duration: .15, yoyo: true, repeat: 1 })
      .call(step(3))
      .to(stamp, { opacity: 1, scale: 1, rotate: -5, duration: .5, ease: 'back.out(3)' })
      .to(cur, { opacity: 0, duration: .3 }, '<')
      .to({}, { duration: 2 })
      .to([...all, stamp], { opacity: 0, duration: .45, ease: 'power1.in' });
    new IntersectionObserver(([e]) => e.isIntersecting ? tl.play() : tl.pause()).observe(bs);
  }

  /* ---------- two jobs: the care orbit ---------- */
  const cs = $('.cscene');
  if (cs) {
    const sats = $$('.cs-sat', cs), msg = $('.cs-msg', cs), N = sats.length;
    let vis = false, W = cs.clientWidth, H = cs.clientHeight, lastFront = -1;
    if (window.ResizeObserver) new ResizeObserver(() => { W = cs.clientWidth; H = cs.clientHeight; }).observe(cs);
    new IntersectionObserver(([e]) => vis = e.isIntersecting).observe(cs);
    if (!reduce) sats.forEach(s => { s.style.left = '50%'; s.style.top = '50%'; });
    const t0 = performance.now();
    if (!reduce) tick(now => {
      if (!vis) return;
      const t = (now - t0) / 1000 * .4;
      let front = -1, best = -2;
      sats.forEach((s, i) => {
        const a = t + i * Math.PI * 2 / N, sn = Math.sin(a), k = (sn + 1) / 2;
        s.style.transform = `translate(${(Math.cos(a) * W * .437).toFixed(1)}px,${(sn * H * .26).toFixed(1)}px) scale(${(.7 + .3 * k).toFixed(3)})`;
        s.style.zIndex = sn > 0 ? 3 : 1; s.style.opacity = (.4 + .6 * k).toFixed(2);
        if (sn > best) { best = sn; front = i; }
      });
      if (front !== lastFront && best > .99) {
        lastFront = front; const s = sats[front];
        s.classList.remove('ping'); void s.offsetWidth; s.classList.add('ping');
        msg.style.opacity = 0; setTimeout(() => { msg.textContent = s.dataset.msg; msg.style.opacity = 1; }, 200);
      }
    });
  }

  /* ---------- referral ticket: amount toggle, tilt and foil ---------- */
  $$('.ticketwrap').forEach(w => {
    const tk = $('.ticket', w), sh = $('.ticket-shadow', w), n = $('.ticket__n', w), btns = $$('.ticket__tog button', w);
    let val = 50;
    const setAmt = to => {
      if (!G || reduce) { n.textContent = to; val = to; return; }
      const o = { v: val }; val = to;
      G.to(o, { v: to, duration: .7, ease: 'power3.out', onUpdate: () => n.textContent = Math.round(o.v) });
      G.fromTo(n, { scale: .92 }, { scale: 1, duration: .6, ease: 'back.out(3)' });
    };
    btns.forEach(b => b.addEventListener('click', () => { btns.forEach(x => x.setAttribute('aria-pressed', x === b)); setAmt(+b.dataset.amt); }));
    tk.addEventListener('reveal', () => { if (G && !reduce) { const o = { v: 0 }; G.to(o, { v: 50, duration: 1.4, delay: .4, ease: 'power3.out', onUpdate: () => n.textContent = Math.round(o.v) }); } }, { once: true });
    if (G && fine && !reduce) {
      G.set(sh, { transformPerspective: 1100 });
      const rx = G.quickTo(sh, 'rotationX', { duration: .8, ease: 'power3' }), ry = G.quickTo(sh, 'rotationY', { duration: .8, ease: 'power3' });
      w.addEventListener('pointermove', e => {
        const r = sh.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        rx(clamp((.5 - y) * 12, -10, 10)); ry(clamp((x - .5) * 16, -12, 12));
        tk.style.setProperty('--fx', (100 - x * 100) + '%'); tk.style.setProperty('--fy', (y * 100) + '%');
      });
      w.addEventListener('pointerleave', () => { rx(0); ry(0); });
    }
  });

  /* ---------- services: the control room ---------- */
  const ctrl = $('.ctrl');
  if (ctrl) {
    const items = $$('.ctrl__item', ctrl), panels = $$('.cp', ctrl);
    let idx = 0, timer = null, auto = !reduce, vis = false;
    const select = (i, user) => {
      idx = (i + items.length) % items.length;
      items.forEach((b, j) => b.setAttribute('aria-selected', j === idx));
      panels.forEach((p, j) => { p.hidden = j !== idx; p.classList.toggle('on', j === idx); });
      if (user) { auto = false; ctrl.classList.remove('auto'); clearTimeout(timer); const st = $('.ctrl__stage', ctrl).getBoundingClientRect(); if (innerWidth < 1060 && st.top > innerHeight * .55) { lenis ? lenis.scrollTo(st.top + scrollY - 90, { duration: .9 }) : scrollTo({ top: st.top + scrollY - 90, behavior: 'smooth' }); } }
      else if (auto) { ctrl.classList.remove('auto'); void ctrl.offsetWidth; ctrl.classList.add('auto'); }
      schedule();
    };
    const schedule = () => { clearTimeout(timer); if (auto && vis) timer = setTimeout(() => select(idx + 1), 6000); };
    items.forEach((b, i) => {
      b.addEventListener('click', () => select(i, true));
      b.addEventListener('keydown', e => { const k = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]; if (k) { e.preventDefault(); select(idx + k, true); items[idx].focus(); } });
      b.tabIndex = i === 0 ? 0 : -1;
    });
    ctrl.addEventListener('focusin', () => items.forEach((b, j) => b.tabIndex = j === idx ? 0 : -1));
    new IntersectionObserver(([e]) => { vis = e.isIntersecting; if (vis && auto) select(idx); else clearTimeout(timer); }, { threshold: .3 }).observe(ctrl);
  }

  /* ---------- legal pages: print + table of contents ---------- */
  $$('[data-print]').forEach(b => b.addEventListener('click', () => print()));
  const toc = $$('.toc a');
  if (toc.length) {
    const map = new Map(toc.map(a => [a.getAttribute('href').slice(1), a]));
    const tio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { toc.forEach(a => a.classList.remove('on')); const a = map.get(e.target.id); a && a.classList.add('on'); } }), { rootMargin: '-15% 0px -75% 0px' });
    $$('.legal h2[id]').forEach(h => tio.observe(h));
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
