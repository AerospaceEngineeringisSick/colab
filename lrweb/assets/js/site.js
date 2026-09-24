/* LRWeb — site behaviour */
(() => {
  'use strict';
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  let vh = innerHeight;
  addEventListener('resize', () => { vh = innerHeight; }, { passive: true });
  requestAnimationFrame(() => setTimeout(() => root.classList.add('is-ready'), 60));

  /* ---------- toast ---------- */
  let toastT;
  const toast = html => {
    let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.innerHTML = html; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 4200);
  };

  /* ---------- nav ---------- */
  const nav = $('.nav');
  const nights = $$('[data-night]');
  let lastY = scrollY;
  function navFrame() {
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
  }
  const burger = $('.burger');
  if (burger) burger.addEventListener('click', () => {
    const open = root.classList.toggle('menu-open');
    burger.setAttribute('aria-expanded', open); burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    nav.classList.remove('is-hidden');
  });
  $$('.mmenu a').forEach(a => a.addEventListener('click', () => root.classList.remove('menu-open')));
  addEventListener('keydown', e => { if (e.key === 'Escape' && root.classList.contains('menu-open')) { root.classList.remove('menu-open'); burger && burger.setAttribute('aria-expanded', 'false'); } });

  /* ---------- reveal ---------- */
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); e.target.dispatchEvent(new CustomEvent('reveal')); } }), { rootMargin: '0px 0px -12% 0px' });
  $$('[data-reveal],[data-inview]').forEach(el => io.observe(el));

  /* ---------- counters ---------- */
  const fmtNum = (n, dec) => dec ? n.toFixed(dec) : Math.round(n).toLocaleString('en-GB');
  function countUp(el, to, dur = 1500) {
    const dec = (String(to).split('.')[1] || '').length, pre = el.dataset.prefix || '', t0 = performance.now();
    if (reduce) { el.textContent = pre + fmtNum(to, dec); return; }
    const f = n => { const t = clamp((n - t0) / dur, 0, 1); el.textContent = pre + fmtNum(to * ease(t), dec); if (t < 1) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }
  const cio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { cio.unobserve(e.target); countUp(e.target, +e.target.dataset.count); } }), { threshold: .5 });
  $$('[data-count]').forEach(el => cio.observe(el));

  /* ---------- star fields ---------- */
  const skies = $$('.sky__stars').map(cv => {
    const ctx = cv.getContext('2d');
    const o = { cv, ctx, stars: [], alpha: 1, visible: true, shoot: null, next: performance.now() + 3000, hzf: parseFloat(cv.dataset.hz || 0) };
    o.resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); o.w = w; o.h = h;
      const n = Math.round(w * h / 5200);
      o.stars = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h * .9, r: Math.random() < .08 ? 1.6 : Math.random() * 1.1 + .3, tw: Math.random() * 6.28, sp: .6 + Math.random() * 1.6 }));
    };
    o.resize();
    new IntersectionObserver(([e]) => o.visible = e.isIntersecting).observe(cv);
    return o;
  });
  addEventListener('resize', () => skies.forEach(s => s.resize()));
  function drawSkies(t) {
    for (const s of skies) {
      if (!s.visible) continue;
      const { ctx, w, h } = s;
      ctx.clearRect(0, 0, w, h);
      const hz = h * (1 - s.hzf);
      for (const st of s.stars) {
        if (st.y > hz - 6) continue;
        const tw = reduce ? .8 : .55 + .45 * Math.sin(t / 1000 * st.sp + st.tw);
        ctx.globalAlpha = s.alpha * tw * (st.r > 1.2 ? 1 : .75);
        ctx.fillStyle = '#F5F8FA';
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.283); ctx.fill();
      }
      // the occasional shooting star
      if (!reduce && s.alpha > .4) {
        if (!s.shoot && t > s.next) s.shoot = { x: Math.random() * w * .7 + w * .1, y: Math.random() * h * .3, t0: t };
        if (s.shoot) {
          const k = (t - s.shoot.t0) / 900;
          if (k > 1) { s.shoot = null; s.next = t + 5000 + Math.random() * 7000; }
          else {
            const x = s.shoot.x + k * 260, y = s.shoot.y + k * 110;
            const g = ctx.createLinearGradient(x - 90, y - 38, x, y);
            g.addColorStop(0, 'rgba(111,224,180,0)'); g.addColorStop(1, 'rgba(245,248,250,.9)');
            ctx.globalAlpha = s.alpha * Math.sin(k * Math.PI);
            ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 90, y - 38); ctx.lineTo(x, y); ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ---------- HERO: overnight time-lapse ---------- */
  const hero = $('.hero-night');
  const H = hero && (() => {
    const stage = $('.hero-night__stage', hero), sky = $('.sky', hero), sunI = $('.sun i', hero), clock = $('#clock'), log = $('#log'), bars = $('#uptime'), cue = $('.hero__cue', hero);
    const heroSky = skies.find(s => hero.contains(s.cv));
    const K = [
      [0, '#070824', '#0A0C2E', '#10124A'],
      [.45, '#06071F', '#0B0D35', '#171A6C'],
      [.78, '#0A0C36', '#1A1F86', '#2459D0'],
      [1, '#0E1044', '#2432B8', '#1C8BE0']
    ].map(k => [k[0], ...k.slice(1).map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)))]);
    const col = (p, i) => { let a = K[0], b = K[K.length - 1]; for (let j = 0; j < K.length - 1; j++) if (p >= K[j][0] && p <= K[j + 1][0]) { a = K[j]; b = K[j + 1]; break; } const t = (p - a[0]) / (b[0] - a[0] || 1); return `rgb(${a[i].map((v, k) => Math.round(lerp(v, b[i][k], t))).join(',')})`; };
    const ICON = {
      ok: '<svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="8" fill="rgba(61,184,141,.18)"/><path d="M5.5 9.2l2.3 2.3 4.7-5" stroke="#3DB88D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      todo: '<svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7.2" stroke="rgba(245,248,250,.4)" stroke-width="1.4" stroke-dasharray="2.5 2.5"/></svg>',
      run: '<svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="rgba(11,134,234,.35)" stroke-width="2"/><path d="M9 2a7 7 0 0 1 7 7" stroke="#0B86EA" stroke-width="2" stroke-linecap="round"/></svg>'
    };
    const EV = [
      [1380, 'Uptime check · site up in 0.4s', 'ok', 'monitored.'],
      [1560, 'Nightly backup started', 'run', 'backed up.'],
      [1564, 'Plugin updates applied (4)', 'ok', 'updated.'],
      [1571, 'Daily backup complete · 312 MB', 'ok', 'backed up.'],
      [1650, 'Malware scan · all clear', 'ok', 'secured.'],
      [1815, 'SSL certificate renewed', 'ok', 'secured.'],
      [1862, 'Cache warmed · pages in 0.8s', 'ok', 'hosted.'],
      [1920, 'Uptime check · all good', 'ok', 'monitored.']
    ];
    const words = $$('.swap > span', hero);
    let shownWord = 'handled.';
    const setWord = w => {
      if (w === shownWord) return;
      const cur = words.find(s => s.classList.contains('in')) || words[0];
      const nxt = words.find(s => s.textContent === w); if (!nxt) return;
      cur.classList.remove('in'); cur.classList.add('out'); cur.setAttribute('aria-hidden', 'true');
      nxt.classList.remove('out'); nxt.removeAttribute('aria-hidden'); void nxt.offsetWidth; nxt.classList.add('in');
      setTimeout(() => cur.classList.remove('out'), 650);
      shownWord = w;
    };
    words.forEach((s, i) => { if (i === 0) s.classList.add('in'); });
    if (bars) bars.innerHTML = '<b></b>'.repeat(36);
    const barEls = bars ? $$('b', bars) : [];
    let shown = -1, shownN = 0;
    const pad = n => String(n).padStart(2, '0');
    function render(p) {
      const mins = 1380 + p * 540, m = Math.floor(mins) % 1440;
      clock.firstChild.nodeValue = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
      const n = EV.filter(e => e[0] <= mins).length;
      const done = p > .985;
      const key = n + (done ? 100 : 0);
      if (key !== shown) {
        const t = e => `${pad(Math.floor(e[0] % 1440 / 60))}:${pad(e[0] % 60)}`;
        const items = EV.map((e, i) => {
          if (i >= n) return `<li class="todo">${ICON.todo}<span>${e[1].split(' · ')[0].replace('complete', 'due').replace('applied', 'scheduled').replace('renewed', 'renewal').replace('started', '')}</span><time>${t(e)}</time></li>`;
          const icon = i === 1 && n > 3 ? ICON.ok : ICON[e[2]];
          const label = i === 1 && n > 3 ? 'Nightly backup started' : e[1];
          return `<li class="${i === n - 1 && !done ? 'fresh' : ''} ${i === n - 1 && n > shownN ? 'just' : ''} ${i < n - (done ? 2 : 3) ? 'old' : ''}">${icon}<span>${label}</span><time>${t(e)}</time></li>`;
        });
        if (done) items.push(`<li class="done fresh just">${ICON.ok}<span>All done. Nothing for you to do.</span><time>08:00</time></li>`);
        else items.push(`<li class="todo">${ICON.todo}<span>Morning report</span><time>08:00</time></li>`);
        log.innerHTML = items.join('');
        shownN = n;
        shown = key;
      }
      setWord(p < .02 || done ? 'handled.' : (n ? EV[n - 1][3] : 'handled.'));
      barEls.forEach((b, i) => b.classList.toggle('on', i / 36 < p));
      // sky
      sky.style.setProperty('--c1', col(p, 1)); sky.style.setProperty('--c2', col(p, 2)); sky.style.setProperty('--c3', col(p, 3));
      const rise = smooth(.42, 1, p);
      stage.style.setProperty('--rise', `${lerp(100, 6, ease(rise))}%`);
      stage.style.setProperty('--halo', (smooth(.5, 1, p) * .95).toFixed(3));
      stage.style.setProperty('--glow', (.35 + smooth(.4, 1, p) * .65).toFixed(3));
      stage.style.setProperty('--refl', (smooth(.6, 1, p) * .8).toFixed(3));
      if (heroSky) heroSky.alpha = 1 - smooth(.62, 1, p) * .82;
      if (cue) cue.style.opacity = p > .08 ? 0 : 1;
    }
    let pTarget = 0, pNow = 0, last = performance.now();
    return {
      frame(now) {
        const dt = Math.min(100, now - last); last = now;
        const r = hero.getBoundingClientRect();
        pTarget = reduce ? 1 : clamp(-r.top / (r.height - vh), 0, 1);
        pNow = reduce ? 1 : lerp(pNow, pTarget, 1 - Math.exp(-dt / 70));
        if (Math.abs(pNow - pTarget) < .0005) pNow = pTarget;
        if (r.bottom > 0) render(pNow);
      }
    };
  })();

  /* ---------- month of care ---------- */
  const cal = $('#cal');
  if (cal) {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
    const y = now.getFullYear(), mo = now.getMonth(), today = now.getDate();
    const days = new Date(y, mo + 1, 0).getDate();
    const first = (new Date(y, mo, 1).getDay() + 6) % 7; // Monday first
    const EDITS = { 5: 'Opening hours updated', 12: 'New photos added to gallery', 19: 'Price list updated', 26: 'Christmas closing notice added' };
    const monthName = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    $('#calMonth').textContent = monthName;
    let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cal__dow">${d}</div>`).join('');
    for (let i = 0; i < first; i++) html += '<div class="day empty"></div>';
    let tues = 0, edits = 0, scans = 0;
    for (let d = 1; d <= days; d++) {
      const dow = new Date(y, mo, d).getDay();
      const past = d <= today;
      const dots = ['<i class="bk"></i>'];
      const tip = ['Backup at 02:00'];
      if (dow === 2) { dots.push('<i class="up"></i>'); tip.push('updates applied'); if (past) tues++; }
      if (dow === 0) { dots.push('<i class="sc"></i>'); tip.push('deep security scan'); if (past) scans++; }
      if (EDITS[d]) { dots.push('<i class="ed"></i>'); tip.push(EDITS[d].toLowerCase()); if (past) edits++; }
      html += `<div class="day ${d === today ? 'today' : ''} ${past ? '' : 'future'}" data-tip="${past ? '' : 'Scheduled: '}${tip.join(', ')}"><span class="d">${d}</span><span class="dots">${dots.join('')}</span></div>`;
    }
    cal.innerHTML = html;
    const set = (id, v) => { const el = $(id); if (el) el.dataset.count = v; };
    const minsToday = now.getHours() * 60 + now.getMinutes();
    set('#tBackups', today); set('#tChecks', (today - 1) * 1440 + minsToday); set('#tUpdates', tues); set('#tEdits', edits);
    $$('.tally [data-count]').forEach(el => cio.observe(el));
    const wrap = cal.closest('[data-inview]') || cal;
    const light = () => $$('.day:not(.empty)', cal).forEach((d, i) => setTimeout(() => d.classList.add('lit'), reduce ? 0 : 200 + i * 32));
    wrap.addEventListener('reveal', light, { once: true });
  }

  /* ---------- before / after ---------- */
  $$('.ba').forEach(ba => {
    const range = $('.ba__range', ba);
    const set = v => ba.style.setProperty('--split', v + '%');
    let touched = false;
    range.addEventListener('input', () => { touched = true; set(range.value); });
    ba.addEventListener('reveal', () => {
      if (reduce) return;
      const seq = [[50, 18, 900], [18, 80, 1300], [80, 50, 900]]; let i = 0;
      const run = () => {
        if (touched || i >= seq.length) return;
        const [a, b, d] = seq[i++], t0 = performance.now();
        const f = n => { if (touched) return; const t = clamp((n - t0) / d, 0, 1); const v = lerp(a, b, t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); set(v); range.value = v; if (t < 1) requestAnimationFrame(f); else setTimeout(run, 180); };
        requestAnimationFrame(f);
      };
      setTimeout(run, 400);
    }, { once: true });
  });

  /* ---------- work card hover scroll ---------- */
  const measureWork = () => $$('.wcard__view').forEach(v => v.style.setProperty('--vh', v.clientHeight + 'px'));
  addEventListener('load', measureWork); addEventListener('resize', measureWork);

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
      if (!reduce) price.animate([{ transform: 'translateY(12px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
    };
    $$('.seg button', est).forEach(b => b.addEventListener('click', () => { $$('.seg button', est).forEach(x => x.setAttribute('aria-pressed', x === b)); size = +b.dataset.size; update(); }));
    [shop, rescue].forEach(c => c.addEventListener('change', update));
  }

  /* ---------- FAQ ---------- */
  $$('.faq__q').forEach(q => q.addEventListener('click', () => {
    const item = q.closest('.faq__item'), open = item.classList.toggle('open');
    q.setAttribute('aria-expanded', open);
  }));

  /* ---------- timeline progress ---------- */
  const tls = $$('.timeline');
  function timelineFrame() {
    tls.forEach(tl => {
      const r = tl.getBoundingClientRect();
      const p = clamp((vh * .62 - r.top) / r.height, 0, 1);
      tl.style.setProperty('--tl', p.toFixed(3));
      $$('li', tl).forEach(li => { const lr = li.getBoundingClientRect(); li.classList.toggle('on', lr.top < vh * .62); });
    });
  }

  /* ---------- contact form (same behaviour as the live site) ---------- */
  const form = $('#contactForm');
  if (form) {
    let mode = 'project';
    const tierWrap = $('#f-tier-wrap'), msgLabel = $('#f-msg-label'), msg = $('#f-msg');
    const tabs = $$('.tabs button', form);
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
      let firstBad = null;
      checks.forEach(([id, ok]) => { const f = $('#' + id).closest('.field'); f.classList.toggle('bad', !ok); if (!ok && !firstBad) firstBad = $('#' + id); });
      if (firstBad) { firstBad.focus(); return; }
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

  /* ---------- main loop ---------- */
  function loop(t) {
    navFrame();
    H && H.frame(t);
    drawSkies(t);
    tls.length && timelineFrame();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
