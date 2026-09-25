#!/usr/bin/env python3
"""Builds the LRWeb pages from shared partials. Run: python3 lrweb/_src/build.py"""
import os
OUT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

# ---------------------------------------------------------------- icons
ARROW = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
CHECK = '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="currentColor" opacity=".16"/><path d="M5.5 9.2l2.3 2.3 4.7-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
CROSS = '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="#5A6478" opacity=".12"/><path d="M6.2 6.2l5.6 5.6M11.8 6.2l-5.6 5.6" stroke="#5A6478" stroke-width="1.8" stroke-linecap="round"/></svg>'
TICK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
LOCK = '<svg viewBox="0 0 10 12" fill="none" aria-hidden="true"><rect x="1" y="5" width="8" height="6" rx="1.5" stroke="#3DB88D" stroke-width="1.4"/><path d="M3 5V3.5a2 2 0 0 1 4 0V5" stroke="#3DB88D" stroke-width="1.4"/></svg>'
IC = {
  'server': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  'refresh': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/></svg>',
  'db': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  'shield': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l8 4v5c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V7l8-4z"/><path d="M9 12l2 2 4-4" stroke-linecap="round"/></svg>',
  'pulse': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg>',
  'lock': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  'bolt': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  'edit': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>',
  'chat': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 6h16v11H8l-4 4V6z"/><path d="M8 10h8M8 13h5" stroke-linecap="round"/></svg>',
  'move': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h13l-3-3M20 17H7l3 3"/></svg>',
  'test': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 11l2.5 2.5L16 8"/></svg>',
  'globe': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>',
  'mail': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  'browser': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>',
  'wrench': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M14.5 5.5a4 4 0 0 0 5 5L12 18l-3 3-3-3 3-3 7.5-7.5a4 4 0 0 1-2-2z"/></svg>',
  'speed': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/></svg>',
}

# ---------------------------------------------------------------- plain-English jargon tips
GLOSS = {
  'hosting': 'The computer that stores your website and shows it to visitors, day and night.',
  'updates': 'Like servicing a car: small fixes from the makers that keep your site safe and working.',
  'plugins': 'Add-ons that give a website extra features, like a booking form or a gallery.',
  'backups': 'Spare copies of your whole website, so nothing is ever lost for good.',
  'off-site': 'Kept on a different computer in a different place, so one problem can’t take out both.',
  'SSL': 'The little padlock next to your web address. It keeps what visitors type private.',
  'uptime': 'The time your website is switched on and working. 99.9% means under 9 hours off in a whole year.',
  'monitoring': 'A robot that visits your site every minute and phones us if it doesn’t answer.',
  'malware': 'Nasty software that hackers try to sneak onto websites. We scan for it and keep it out.',
  'firewall': 'A bouncer for your website that turns away suspicious visitors.',
  'cache': 'A ready-made copy of each page, so it appears instantly instead of being built every time.',
  'migration': 'Moving your website from one host to another. We do all of it for you.',
  'DNS': 'The internet’s address book. It tells browsers where to find your website.',
  'domain': 'Your web address, like yourbusiness.co.uk. It stays in your name.',
  'care plan': 'A monthly fee that covers hosting, updates, backups, security and help from us.',
  'performance': 'How quickly your pages appear. Faster sites keep visitors and rank better on Google.',
  'e-commerce': 'Selling things on your website, with a basket and card payments.',
  'VAT': 'We aren’t VAT registered, so the price you see is the price you pay.',
}
def J(term, key=None, label=None):
    tip = GLOSS[key or term]
    return f'<button type="button" class="jg" data-tip="{tip}">{label or term}</button>'

# ---------------------------------------------------------------- pricing constants (single place to change)
BUILD_FROM = '£299'      # headline "websites from" figure (new sites and redesigns)
# website builds: one list drives the pricing page, the estimator and the services page
# (name, price range, short line, who it's for, what's included, tag)
BUILDS = [
  ('Starter', '£299–£499', '1 to 3 pages', 'A smart, fast site to get you online properly, or a tidy redesign of the one you have. Perfect for sole traders, trades, tutors and clubs.',
   ['Up to 3 pages, new or redesigned', 'Works beautifully on phones', 'Contact form &amp; map', 'Google Business setup help', 'Two revision rounds'], 'Best for getting started'),
  ('Standard', '£599–£999', '4 to 8 pages', 'A fuller site for established businesses: more pages, more polish and room to grow.',
   ['Up to 8 pages', '2 to 3 homepage design options', 'Copywriting included', 'Photo sourcing &amp; optimisation', 'Basic search visibility setup'], 'Most popular'),
  ('Larger', '£1,199–£1,999', 'shops, bookings, 9+ pages', 'For online shops, booking systems and bigger rebuilds with more moving parts.',
   ['Online shop or booking system', 'Card payments set up', 'Content moved from your old site', 'Up to 15 pages', 'Training session included'], ''),
  ('Bespoke', 'From £2,000', 'quoted to fit', 'Membership areas, custom features and anything unusual. We scope it with you and fix the price in writing.',
   ['Custom functionality', 'Integrations with your other tools', 'Phased delivery if it helps cash flow', 'Written scope and fixed price'], ''),
]
PER_DAY = {'29': '95p', '49': '£1.61', '89': '£2.93'}   # price × 12 ÷ 365

# ---------------------------------------------------------------- work data
WORK = [
  ('smith-and-sons', 'Smith &amp; Sons', 'Plumbing &amp; heating', 'West Berkshire', 'smithandsons.co.uk',
   'The finished version of the rescue on our homepage. Emergency callout bar, instant price guide, area checker and online booking.',
   ['Trades', 'Booking', 'Price guide']),
  ('crumb-and-kiln', 'Crumb &amp; Kiln', 'Bakery &amp; café', 'Bristol', 'crumbandkiln.co.uk',
   'A bake board that updates with the real time of day, click-and-collect ordering and a shop that knows when it’s open.',
   ['Café', 'Online orders', 'Opening hours']),
  ('northside-barber', 'Northside Barber Co.', 'Barbershop', 'Manchester', 'northsidebarber.co.uk',
   'Pick a barber, pick a slot, done. Plus a price board that reads like the one on the wall.',
   ['Salon', 'Bookings', 'Price list']),
  ('petal-and-stem', 'Petal &amp; Stem', 'Florist', 'Hackney, London', 'petalandstem.london',
   'A bouquet builder that prices as you pick, a flower subscription and a delivery postcode checker.',
   ['Shop', 'E-commerce', 'Subscriptions']),
  ('volt-strength', 'VOLT Strength Club', 'Independent gym', 'Leeds', 'voltstrength.club',
   'Live class timetable, a membership quiz and plans you can join from your phone.',
   ['Sports club', 'Timetable', 'Memberships']),
  ('tidewater', 'Tidewater', 'Seafood restaurant', 'St Ives, Cornwall', 'tidewaterstives.co.uk',
   'Menus that change with the catch, table bookings and a harbour that sets as you scroll.',
   ['Restaurant', 'Reservations', 'Menus']),
  ('form-and-field', 'Form &amp; Field', 'Architecture practice', 'Edinburgh', 'formandfield.studio',
   'A calm, precise portfolio where the drawings draw themselves.',
   ['Studio', 'Portfolio', 'Projects']),
]

def wcard(w, wide=False, dark=False):
    slug, name, typ, place, url, desc, tags = w
    tags_html = ''.join(f'<li>{t}</li>' for t in tags)
    frame = f'''<div class="wcard__frame"><div class="wcard__bar"><i></i><i></i><i></i><span>{url}</span></div><div class="wcard__view"><img src="assets/work/thumb/{slug}.jpg" srcset="assets/work/thumb/{slug}.jpg 800w, assets/work/{slug}.jpg 1200w" sizes="(max-width:760px) 92vw, 560px" alt="{name} example website" loading="lazy" decoding="async" width="1200" height="2250"></div></div>'''
    info = f'''<div><div class="wcard__meta"><div><h3>{name}</h3><p>{typ} · {place}</p></div><span class="wcard__type">Example site</span></div>{'<p style="margin-top:14px">' + desc + '</p>' if wide else ''}<ul class="tags">{tags_html}</ul>{'<p style="margin-top:22px"><span class="link">Open the site ' + ARROW + '</span></p>' if wide else ''}</div>'''
    cls = 'wcard wcard--wide' if wide else 'wcard'
    return f'<a class="{cls}" href="work/{slug}/index.html" data-reveal>{frame}{info}</a>'

# ---------------------------------------------------------------- partials
CUR = ' aria-current="page"'
HID = ' aria-hidden="true"'
NAV_ITEMS = [('services.html', 'What we do'), ('work.html', 'Work'), ('pricing.html', 'Pricing'), ('about.html', 'About'), ('referrals.html', 'Referrals')]

def head(title, desc, canonical):
    return f'''<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="https://lrweb.uk/{canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="LRWeb">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="https://lrweb.uk/assets/img/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#070824">
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
<link rel="preload" href="assets/fonts/font-03.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/font-15.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/css/fonts.css">
<link rel="stylesheet" href="assets/css/site.css">
<script>(function(d){{d.classList.add('js');try{{if(sessionStorage.getItem('lr-pt')){{d.classList.add('pt-in');sessionStorage.removeItem('lr-pt')}}}}catch(e){{}}}})(document.documentElement)</script>
'''

SCHEMA = '''<script type="application/ld+json">
{"@context":"https://schema.org","@type":["ProfessionalService","Organization"],"@id":"https://lrweb.uk/#organization","name":"LRWeb","legalName":"LRWeb Ltd","url":"https://lrweb.uk/","slogan":"Your website, handled.",
"description":"LRWeb builds websites for small UK businesses and local organisations, then hosts, maintains, secures and supports them on a monthly care plan.",
"email":"hello@lrweb.uk","telephone":"07485585802","identifier":"17458216","logo":"https://lrweb.uk/assets/img/logo-light.png",
"address":{"@type":"PostalAddress","streetAddress":"1 Pillarbox Cottages Winding Wood, Kintbury","addressLocality":"Hungerford","postalCode":"RG17 9RN","addressRegion":"Berkshire","addressCountry":"GB"},
"founder":[{"@type":"Person","name":"Luke Harris-Platt","jobTitle":"Co-founder"},{"@type":"Person","name":"Ralph Ogilvy","jobTitle":"Co-founder"}],
"areaServed":{"@type":"Country","name":"United Kingdom"},"priceRange":"££"}
</script>'''

def nav(active):
    links = ''.join(f'<a href="{h}"{CUR if h == active else ""}>{t}</a>' for h, t in NAV_ITEMS)
    mlinks = f'<a href="index.html"{CUR if active == "index.html" else ""}>Home</a>' + ''.join(f'<a href="{h}"{CUR if h == active else ""}>{t}</a>' for h, t in NAV_ITEMS) + f'<a href="contact.html"{CUR if active == "contact.html" else ""}>Get in touch</a>'
    return f'''</head>
<body>
<div class="curtain" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
<a class="skip" href="#main">Skip to content</a>
<header class="nav">
  <div class="nav__in">
    <a href="index.html" class="nav__logo" aria-label="LRWeb home"><img class="for-dark" src="assets/img/logo-light.png" alt="LRWeb" width="300" height="69"><img class="for-light" src="assets/img/logo-dark.png" alt="" width="300" height="69"></a>
    <nav class="nav__links" aria-label="Main">{links}<a href="contact.html" class="btn btn-primary">Get in touch</a></nav>
    <button class="burger" aria-label="Open menu" aria-expanded="false" aria-controls="mmenu"><span></span></button>
  </div>
</header>
<div class="mmenu" id="mmenu"><nav aria-label="Mobile">{mlinks}</nav><p class="mmenu__foot"><a href="mailto:hello@lrweb.uk">hello@lrweb.uk</a> · read by Luke or Ralph</p><div class="mmenu__sun" aria-hidden="true"></div></div>
<main id="main">
'''

def sky(prog=.86, hz=.14, sunx=.8, sunr=.36, aurora=.8):
    return f'<canvas class="sky-gl" data-prog="{prog}" data-hz="{hz}" data-sunx="{sunx}" data-sunr="{sunr}" data-aurora="{aurora}" aria-hidden="true"></canvas>'

TRUST = f'''<ul class="trust">
  <li>{TICK}Registered in England &amp; Wales · 17458216</li><li>{TICK}Public liability insured</li><li>{TICK}Not VAT registered, no hidden tax</li><li>{TICK}30 days’ notice, no lock-in</li><li>{TICK}Two named humans, no ticket system</li>
</ul>'''

def cta(title, text, button='Start a conversation'):
    return f'''<section class="cta" data-night aria-labelledby="cta-h">
  {sky(prog=.8, hz=.16, sunx=.5, sunr=.3, aurora=.9)}
  <div class="container cta__in">
    <h2 id="cta-h" data-split>{title}</h2>
    <p data-reveal style="--d:1">{text}</p>
    <a href="contact.html" class="btn btn-primary" data-reveal style="--d:2">{button} {ARROW}</a>
    {TRUST}
    <p class="mail"><a href="mailto:hello@lrweb.uk">hello@lrweb.uk</a> · read by Luke or Ralph, not a ticket system</p>
  </div>
</section>
'''

FOOT = f'''</main>
<footer class="foot" data-night>
  <div class="container">
    <div class="foot__grid">
      <div class="foot__brand">
        <img src="assets/img/logo-light.png" alt="LRWeb" width="300" height="69" loading="lazy">
        <p>A small UK web studio that builds websites and then looks after them properly.</p>
        <span class="status"><i></i>All client sites monitored 24/7</span>
      </div>
      <div><h4>LRWeb</h4><ul><li><a href="services.html">What we do</a></li><li><a href="work.html">Example sites</a></li><li><a href="pricing.html">Pricing</a></li><li><a href="about.html">About</a></li><li><a href="referrals.html">Referrals</a></li></ul></div>
      <div><h4>Get in touch</h4><ul><li><a href="contact.html">Start a conversation</a></li><li><a href="mailto:hello@lrweb.uk">hello@lrweb.uk</a></li><li><a href="mailto:support@lrweb.uk">support@lrweb.uk</a> <span style="opacity:.6">(clients)</span></li><li><a href="privacy.html">Privacy policy</a></li><li><a href="terms.html">Terms of service</a></li></ul></div>
    </div>
    <div class="foot__legal">
      <p>LRWeb Ltd is a company registered in England &amp; Wales, company number 17458216, registered office: 1 Pillarbox Cottages Winding Wood, Kintbury, Hungerford, England RG17 9RN. LRWeb is a trading name of LRWeb Ltd. Not registered for VAT, so no VAT is added to the prices shown. If we must register, VAT is added on 30 days notice. Full <a href="terms.html#business-information">business information</a>, <a href="terms.html">terms of service</a> and <a href="privacy.html">privacy policy</a>.</p>
      <div class="foot__bottom"><span>© <span data-year>2026</span> LRWeb · lrweb.uk</span><span>Type “panic” anywhere. Go on.</span></div>
    </div>
  </div>
  <div class="foot__mark" aria-hidden="true">LRWeb</div>
</footer>
<script src="assets/js/vendor/gsap.min.js" defer></script>
<script src="assets/js/vendor/ScrollTrigger.min.js" defer></script>
<script src="assets/js/vendor/lenis.min.js" defer></script>
<script src="assets/js/sky.js" defer></script>
<script src="assets/js/site.js" defer></script>
</body>
</html>
'''

def phero(crumb, title, lead, extra=''):
    return f'''<section class="phero" data-night>
  {sky()}
  <div class="container">
    <p class="crumbs load-in"><a href="index.html">Home</a> / {crumb}</p>
    <h1 data-split data-now>{title}</h1>
    <p class="lead load-in d2">{lead}</p>
    {extra}
  </div>
</section>
'''

# ---------------------------------------------------------------- shared blocks
def plan_card(key, name, forwho, price, items, hot=False, d=0):
    lis = ''.join(f'<li>{CHECK}<span>{x}</span></li>' for x in items)
    tag = '<span class="plan__tag">Most popular</span>' if hot else ''
    cls = 'plan plan--hot on-dark' if hot else 'plan'
    btn = 'btn-primary' if hot else 'btn-outline'
    return f"""<article class="{cls}" data-reveal style="--d:{d}"><span class="glare"></span>{tag}
    <h3>{name}</h3><p class="for">{forwho}</p>
    <div class="price"><span class="price__cur">£</span><span class="price__n">{price}</span><small>/month</small></div>
    <p class="perday"><b>About {PER_DAY[price]} a day.</b> No contract, no VAT to add.</p>
    <ul>{lis}</ul>
    <a href="contact.html?plan={key}" class="btn {btn}">Choose {name}</a>
  </article>"""

PLANS = '<div class="plans">' + plan_card('essential', 'Essential', 'For brochure sites that need to just work', '29',
    [f'Managed UK-focused {J("hosting")}', f'Core, theme &amp; {J("plugins", label="plugin")} {J("updates")}', f'Daily {J("off-site")} {J("backups")}', f'{J("uptime", label="Uptime")} &amp; security {J("monitoring")}', f'{J("SSL")} certificate included', 'Email support']) + \
  plan_card('plus', 'Plus', 'For businesses whose website earns its keep', '49',
    ['Everything in Essential', 'Monthly content edits included', f'{J("performance", label="Performance")} optimisation', 'Priority support', 'Quarterly site health review'], hot=True, d=1) + \
  plan_card('pro', 'Pro', 'For shops, bookings and busier sites', '89',
    ['Everything in Plus', f'{J("e-commerce", label="E-commerce")} &amp; booking support', 'More included edit time', 'Same-day response target', 'Monthly performance report'], d=2) + '</div>'

EVERY_PLAN = ['Hosting', 'Updates', 'Nightly backups', 'Security', '24/7 monitoring', 'SSL padlock', 'Free migration', 'Real humans', 'No contract']
EVERY_HTML = '<ul class="every" data-reveal><li class="every__h">In every plan</li>' + ''.join(f'<li>{TICK}{x}</li>' for x in EVERY_PLAN) + '</ul>'

RECEIPT_ITEMS = [('Hosting on fast, secure servers', 'hosting'), ('Software &amp; plugin updates, tested first', 'updates'), ('A backup every night at 02:00', 'backups'),
                 ('Security scans &amp; firewall', 'firewall'), ('Uptime checks, every minute, 24/7', 'uptime'), ('SSL padlock, renewed for you', 'SSL'),
                 ('Moving your old site to us', 'migration'), ('Two humans who know your site', None)]
def receipt(ident='rc'):
    rows = ''.join(f'<li style="--i:{i}"><span>{t}</span><i></i><b>incl.</b></li>' for i, (t, k) in enumerate(RECEIPT_ITEMS))
    return f"""<div class="receipt" data-inview aria-label="Itemised: what the £29 Essential plan includes">
  <div class="receipt__slot" aria-hidden="true"></div>
  <div class="receipt__feed"><div class="receipt__paper">
    <div class="rc-head"><img src="assets/img/logo-dark.png" alt="LRWeb" width="300" height="69" loading="lazy"><span>Essential care<br>monthly · itemised</span></div>
    <ul class="rc-list">{rows}</ul>
    <div class="rc-sum"><span>Subtotal</span><b>£29.00</b></div>
    <div class="rc-sum"><span>VAT</span><b>£0.00</b></div>
    <div class="rc-sum rc-total"><span>Total per month</span><b>£29.00</b></div>
    <p class="rc-foot">That’s about 95p a day.<br>Leave any time with 30 days’ notice.</p>
    <div class="rc-code" aria-hidden="true"></div>
    <span class="rc-stamp" aria-hidden="true">Great<br>value</span>
  </div></div>
</div>"""

ESTIMATOR = f'''<div class="est" id="est" data-reveal>
  <div class="est__l">
    <h3>Rough idea in ten seconds</h3>
    <p>Honest ballparks, not a sales funnel. Your actual quote is always a fixed figure in writing.</p>
    <p class="est__q">How big is your site?</p>
    <div class="seg" role="group" aria-label="Site size"><button aria-pressed="true" data-size="0">1 to 3 pages</button><button aria-pressed="false" data-size="1">4 to 8 pages</button><button aria-pressed="false" data-size="2">9 or more</button></div>
    <p class="est__q">Anything extra?</p>
    <label class="check"><input type="checkbox" id="estShop"> Online shop or booking system</label>
    <label class="check"><input type="checkbox" id="estRescue"> Rescuing an existing site</label>
  </div>
  <div class="est__r" aria-live="polite">
    <div class="corner-sun" aria-hidden="true"></div>
    <span>Likely range</span>
    <div class="est__price" id="estPrice">£299 to £499</div>
    <p class="est__plan" id="estPlan">Starter build · care from £29/mo</p>
    <div class="est__meter" aria-hidden="true"><i id="estMeter"></i></div>
    <a href="contact.html" class="btn btn-primary">Get an exact quote {ARROW}</a>
  </div>
</div>'''

PIN = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15z" fill="currentColor" opacity=".18" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="6.5" r="1.8" fill="currentColor"/></svg>'
PEOPLE = f'''<div class="people">
  <article class="person" data-reveal>
    <div class="person__mark person__mark--l" aria-hidden="true"><span>L</span></div>
    <div><h3>Luke</h3><p class="role">Co-founder · builds &amp; looks after the sites</p><p class="where">{PIN}Wokingham, Berkshire</p><p>Handles the design, development and day-to-day care. Believes a website should load fast, read clearly, and never make its owner feel stupid. Allergic to jargon.</p></div>
  </article>
  <article class="person person--r" data-reveal style="--d:1">
    <div class="person__mark person__mark--r" aria-hidden="true"><span>R</span></div>
    <div><h3>Ralph</h3><p class="role">Co-founder · keeps everything running</p><p class="where">{PIN}Hungerford &amp; Kintbury, Berkshire</p><p>Handles the operations side, making sure the hosting hums, the backups happen, and clients always know where things stand. The reason invoices arrive on time.</p></div>
  </article>
</div>'''

# Berkshire, roughly to scale: x = (lon + 1.62) * 700, y = (51.6 - lat) * 1120
TOWNS = [('Newbury', 208, 223, ''), ('Reading', 449, 163, ''), ('Bracknell', 608, 206, 's'), ('Maidenhead', 631, 87, 's'), ('Windsor', 711, 131, 's')]
def locmap():
    towns = ''.join(f'<g class="lm-town{" " + c if c else ""}" transform="translate({x} {y})"><circle r="3"/><text x="{-8 if c == "l" else 8}" y="4"{" text-anchor=" + chr(34) + "end" + chr(34) if c == "l" else ""}>{n}</text></g>' for n, x, y, c in TOWNS)
    return f"""<div class="locmap" data-inview><div class="lm-in">
  <svg viewBox="0 10 780 300" role="img" aria-label="Map of Berkshire: Ralph is in Hungerford and Kintbury in the west, Luke is in Wokingham in the east. Between them they cover the county, and they work with clients across the UK.">
    <defs>
      <linearGradient id="lmLink" x1="0" x2="1"><stop offset="0" stop-color="#3DB88D"/><stop offset=".55" stop-color="#0B86EA"/><stop offset="1" stop-color="#3F4DE6"/></linearGradient>
      <radialGradient id="lmGlowG"><stop offset="0" stop-color="#3DB88D" stop-opacity=".45"/><stop offset="1" stop-color="#3DB88D" stop-opacity="0"/></radialGradient>
      <radialGradient id="lmGlowB"><stop offset="0" stop-color="#0B86EA" stop-opacity=".45"/><stop offset="1" stop-color="#0B86EA" stop-opacity="0"/></radialGradient>
      <pattern id="lmDots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="rgba(245,248,250,.12)"/></pattern>
    </defs>
    <path class="lm-county" d="M22 150 C40 118 92 112 150 124 C215 104 262 96 318 88 C352 70 392 96 430 118 C470 100 498 58 548 34 C600 20 650 50 700 88 C738 104 766 120 764 148 C756 178 720 196 690 214 C660 240 640 262 600 268 C556 276 520 248 480 244 C430 252 380 262 330 256 C270 262 220 272 160 266 C110 262 60 252 36 226 C18 204 12 176 22 150Z"/>
    <path class="lm-county-dots" d="M22 150 C40 118 92 112 150 124 C215 104 262 96 318 88 C352 70 392 96 430 118 C470 100 498 58 548 34 C600 20 650 50 700 88 C738 104 766 120 764 148 C756 178 720 196 690 214 C660 240 640 262 600 268 C556 276 520 248 480 244 C430 252 380 262 330 256 C270 262 220 272 160 266 C110 262 60 252 36 226 C18 204 12 176 22 150Z" fill="url(#lmDots)"/>
    <path class="lm-river" d="M336 90 C352 110 360 124 371 129 C400 140 430 150 455 155 C475 158 488 146 497 140 C505 110 498 84 504 67 C530 44 570 30 595 34 C615 50 630 76 644 90 C670 110 695 122 714 127"/>
    <path class="lm-river" d="M74 208 C100 222 112 226 122 226 C160 226 185 224 208 223 C230 221 240 219 251 219 C320 214 400 190 455 160"/>
    <path class="lm-m4" d="M49 157 C80 166 95 172 105 174 C150 184 180 190 210 190 L336 190 C390 196 420 210 448 213 C480 212 505 204 525 196 C560 170 600 136 623 123 C660 112 690 112 714 112"/>
    <text class="lm-road" x="300" y="184">M4</text>
    {towns}
    <path class="lm-link" pathLength="1" d="M122 226 C250 300 430 300 550 212"/>
    <g class="lm-pin lm-pin--r" transform="translate(122 226)"><circle r="46" fill="url(#lmGlowG)" class="lm-halo"/><circle r="9" class="lm-ring"/><circle r="6"/></g>
    <g class="lm-pin lm-pin--l" transform="translate(550 212)"><circle r="46" fill="url(#lmGlowB)" class="lm-halo"/><circle r="9" class="lm-ring"/><circle r="6"/></g>
  </svg>
  <div class="lm-tag lm-tag--r" style="--x:15.6%;--y:72%"><b>Ralph</b><span>Hungerford &amp; Kintbury</span></div>
  <div class="lm-tag lm-tag--l" style="--x:70.5%;--y:67.3%"><b>Luke</b><span>Wokingham</span></div></div>
  <div class="lm-uk"><span class="lm-uk__dot"></span><b>And the rest of the UK</b><span>Email, phone and video calls work just as well from Cornwall to Caithness.</span></div>
</div>"""

RULES = '''<div class="rules">
  <div class="rule" data-reveal><span class="n">Rule 01</span><h3>Plain English, always</h3><p>If we can’t explain something without jargon, we don’t understand it well enough. You’ll never get an email from us you need to Google.</p></div>
  <div class="rule" data-reveal style="--d:1"><span class="n">Rule 02</span><h3>Few clients, done well</h3><p>We cap our client list deliberately. When we’re full, we say so and start a waiting list. Quality doesn’t survive a hundred clients.</p></div>
  <div class="rule" data-reveal style="--d:2"><span class="n">Rule 03</span><h3>No upsells, no nonsense</h3><p>If you don’t need something, we’ll tell you. The plan you’re on should be the cheapest one that genuinely does the job.</p></div>
</div>'''

def ticket(big=False):
    link = '' if big else f'<a class="link" href="referrals.html">How referrals work {ARROW}</a>'
    return f"""<div class="ticketwrap{' ticketwrap--big' if big else ''}">
  <div class="ticket-shadow"><div class="ticket" data-inview>
    <div class="ticket__main">
      <div class="ticket__aur" aria-hidden="true"></div>
      <p class="ticket__kick"><img src="assets/img/favicon.svg" alt="" width="18" height="18">LRWeb · referral pass · admit one</p>
      <h3 class="ticket__h">Send a friend our way.<br>Get paid for it.</h3>
      <div class="ticket__amt" aria-live="polite"><span class="ticket__cur">£</span><span class="ticket__n" id="tkAmt{'B' if big else ''}">50</span></div>
      <div class="ticket__tog" role="group" aria-label="What your friend signs up for">
        <button type="button" aria-pressed="true" data-amt="50">Website + care plan</button><button type="button" aria-pressed="false" data-amt="20">Care plan only</button>
      </div>
      <dl class="ticket__meta"><div><dt>Paid by</dt><dd>Bank transfer</dd></div><div><dt>Limit</dt><dd>None at all</dd></div><div><dt>Paperwork</dt><dd>Just your name</dd></div></dl>
    </div>
    <div class="ticket__stub">
      <span class="ticket__small">Paid within</span><b class="ticket__days">7</b><span class="ticket__small">days, once they’ve stayed 30</span>
      <div class="ticket__code" aria-hidden="true"></div>
      <span class="ticket__no">No. 000001</span>
    </div>
    <span class="ticket__foil" aria-hidden="true"></span>
  </div></div>
  <div class="ticket__side">
    <p class="kicker">Referrals</p>
    <h3>Know someone whose website needs rescuing?</h3>
    <p>Tell them to mention your name when they get in touch. Once they’ve signed up and stayed for 30 days, we send you real money. Not vouchers, not credit.</p>
    {link}
  </div>
</div>"""

REF_STEPS = [('You mention us', 'Tell a friend, a client, your cousin with the dodgy website.'), ('They say your name', 'When they first get in touch. That’s the only paperwork.'), ('They stay 30 days', 'Once they’ve paid and stuck around for a month…'), ('You get paid', '£20 or £50 lands in your bank within 7 days.')]
def ref_route():
    items = ''.join(f'<li style="--i:{i}"><span class="rr__dot">{i + 1}</span><b>{t}</b><span>{d}</span></li>' for i, (t, d) in enumerate(REF_STEPS))
    return f'<div class="rroute" data-inview><div class="rroute__track" aria-hidden="true"><i></i><span class="rroute__coin">£</span></div><ol>{items}</ol></div>'

FAQ = [
  ('Am I locked into a contract?', 'No. Care plans are monthly rolling. We just ask for 30 days’ notice if you want to leave. We’d rather keep clients by being good than by being contractual.'),
  ('Who owns the website?', 'You do. The design, the content, the domain: all yours. By default the domain is registered in your name; if you ask us to hold it in ours instead, you can transfer it at any time. If you ever leave, we’ll hand everything over tidily and help you move. No hostage situations.'),
  ('What counts as a “small edit”?', 'Things like updating prices, opening hours, swapping photos, tweaking wording, or adding a news post. Bigger jobs (new pages, redesigned sections, new features) get a simple quote first, billed at £60/hour with no VAT to add while we are not VAT registered.'),
  ('Can you take over my existing website?', 'Almost certainly. We migrate it to our hosting (free with any care plan), give it a health check, and take it from there. If it’s in a bad way, we’ll tell you honestly whether it’s worth rescuing or rebuilding.'),
  ('How do payments work?', 'Builds: 50% deposit to start, 50% at launch. Care plans: monthly by bank transfer or card. Invoices are itemised and boring, exactly as invoices should be.'),
  ('What if my site goes down at the weekend?', 'Our monitoring pings your site around the clock, so we usually know before you do. Genuine emergencies get dealt with as emergencies, whatever day it is.'),
  ('Do you do discounts?', 'We keep prices fair instead. If budget is tight, we’ll trim the scope rather than the quality. A smaller site done properly beats a big one done cheaply.'),
]
def faq_html(items):
    out = '<div class="faq">'
    for i, (q, a) in enumerate(items):
        out += f'<div class="faq__item" data-reveal><button class="faq__q" type="button" aria-expanded="false" aria-controls="fa{i}">{q}<i aria-hidden="true"></i></button><div class="faq__a" id="fa{i}" role="region"><div><p>{a}</p></div></div></div>'
    return out + '</div>'

CARE_ITEMS = ['Managed hosting on renewable energy', 'Software updates, tested', 'Daily off-site backups', 'Security monitoring', 'Uptime monitoring', 'SSL certificates renewed', 'Performance care', 'Small content edits', 'Real support from us']

GAPCHART = '''<div class="gapchart" data-inview>
  <div class="gc-y" aria-hidden="true"><span>Looks after you more</span></div>
  <div class="gc-plot">
    <div class="gc-zone" aria-hidden="true"><span>The gap</span></div>
    <div class="gc-b gc-b--cheap"><i></i><b>Bargain hosting</b><span>About £3 a month. You do everything.</span></div>
    <div class="gc-b gc-b--diy"><i></i><b>DIY website builders</b><span>Roughly £10 to £30 a month, plus your evenings.</span></div>
    <div class="gc-b gc-b--agency"><i></i><b>Big agency</b><span>£10k and up. You’re their smallest client.</span></div>
    <div class="gc-b gc-b--us"><i></i><b>LRWeb</b><span>From £29 a month. Fully looked after.</span></div>
  </div>
  <div class="gc-x" aria-hidden="true"><span>Cheaper</span><span>Costs more</span></div>
</div>'''

# ================================================================= HOME
def home():
    verbs = ['handled.', 'monitored.', 'backed up.', 'updated.', 'secured.', 'hosted.']
    swap = ''.join(f'<span{"" if i == 0 else HID}>{v}</span>' for i, v in enumerate(verbs))
    who = ['plumbers', 'electricians', 'tutors', 'churches', 'cafés', 'charities', 'sports clubs', 'salons', 'builders', 'accountants', 'florists', 'dog groomers']
    who_html = ''.join(f'<span>{w}</span>' for w in who * 2)
    care_list = ''.join(f'<li>{CHECK}{c}</li>' for c in CARE_ITEMS)
    SHIELD = '<svg viewBox="0 0 18 18" fill="none"><path d="M9 2l6 2.6v4c0 3.6-2.6 6-6 7-3.4-1-6-3.4-6-7v-4L9 2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.3 9.2l1.9 1.9 3.6-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    OKI = '<svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="8" fill="#3DB88D"/><path d="M5.5 9.2l2.3 2.3 4.7-5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    steps = [
      ('01', 'We talk.', 'You tell us about your business, what you like, what you hate, and what the website needs to do. We listen more than we talk.', ['Plain English', 'No buzzwords', 'Fixed written quote']),
      ('02', 'We design it.', 'You see two or three real design directions for your homepage. Not mood boards, actual designs. You pick one and tell us what to change.', ['2–3 homepage options', 'Feedback in normal English']),
      ('03', 'We build it.', 'We build the full site, write or polish the copy, sort the photos, and handle all the technical setup. Two rounds of revisions are included.', ['Copy &amp; photos', 'Two revision rounds', 'Launch &amp; handover']),
      ('04', 'Then we look after it.', 'Your site moves onto a care plan. Hosting, updates, backups and support, handled monthly and indefinitely by the people who built it.', ['Nightly backups', 'Tested updates', '24/7 monitoring', 'Real support']),
    ]
    steps_html = ''.join(f'<article class="sstep{" is-on" if i == 0 else ""}" data-step="{i}"><span class="n">{n} / 04</span><h2>{t}</h2><p>{d}</p><ul>{"".join(f"<li>{c}</li>" for c in chips)}</ul></article>' for i, (n, t, d, chips) in enumerate(steps))
    KEYROWS = [[1]*14, [1]*13 + [1.6], [1.6] + [1]*13, [1.9] + [1]*11 + [1.9], [2.4] + [1]*10 + [2.4], [1, 1, 1, 1.3, 5.6, 1.3, 1, 1, 1, 1]]
    keys = ''.join('<span>' + ''.join(f'<i style="flex:{w}"></i>' if w != 1 else '<i></i>' for w in r) + '</span>' for r in KEYROWS)
    carousel = ''.join(f'<a class="ccard" href="work/{w[0]}/index.html" draggable="false" aria-label="{w[1]}, {w[2]} example site"><div class="ccard__frame"><div class="ccard__bar"><i></i><i></i><i></i><span>{w[4]}</span></div><div class="ccard__view"><img src="assets/work/thumb/{w[0]}.jpg" alt="" loading="lazy" decoding="async" draggable="false" width="800" height="1500"></div></div><div class="ccard__meta"><b>{w[1]}</b><span>{w[2]} · {w[3]}</span></div></a>' for w in WORK)
    dots = ''.join('<i></i>' for _ in WORK)
    return head('Managed Websites &amp; Hosting for Small UK Businesses | LRWeb',
                'LRWeb builds websites for small UK businesses, then hosts, updates, backs up and looks after them. Care plans from £29 a month. Two named humans, no jargon.', '') + SCHEMA + nav('index.html') + f"""
<!-- ============ HERO: one night of care, fast-forwarded ============ -->
<section class="hero-night on-dark" data-night aria-label="Your website, handled">
  <div class="hero-night__stage">
    <canvas class="sky-gl" id="heroSky" data-prog="0" data-hz=".17" data-sunx=".74" data-sunr=".24" data-aurora="1" aria-hidden="true"></canvas>
    <div class="veil" aria-hidden="true"></div>
    <div class="container">
      <div>
        <p class="kicker load-in">Managed websites for small UK businesses</p>
        <h1><span class="w"><span>Your</span></span> <span class="w"><span>website,</span></span><br><span class="w"><span class="swap">{swap}</span></span></h1>
        <p class="hero__sub load-in d2">We build it, host it, update it, back it up, and answer when something looks odd. You get on with running your business. That’s the whole arrangement.</p>
        <div class="hero__ctas load-in d3"><a href="contact.html" class="btn btn-primary">Start a conversation {ARROW}</a><a href="pricing.html" class="btn btn-ghost">See plans</a></div>
        <div class="ticks load-in d4"><span>{TICK}No long contracts</span><span>{TICK}Two named humans</span><span>{TICK}Replies within a day</span><span>{TICK}100% renewable energy</span></div>
      </div>
      <div class="console" role="img" aria-label="An example care log: overnight backups, updates and security checks completed while you sleep">
        <div class="console__bar"><i></i><i></i><i></i><span>{LOCK}yourbusiness.co.uk · looked after by LRWeb</span></div>
        <div class="console__top"><div class="clock" id="clock"><span class="clock__t">23:00</span><small>Tonight, while you sleep</small></div><span class="state"><i></i>All good</span></div>
        <ol class="log" id="log"></ol>
        <div class="uptime"><div class="uptime__bars" id="uptime"></div><div class="uptime__meta"><span>23:00</span><span>checked every minute</span><span>08:00</span></div></div>
      </div>
    </div>
    <div class="hero__progress" aria-hidden="true"><span>23:00</span><i><b id="heroBar"></b></i><span>08:00</span></div>
    <p class="hero__cue" aria-hidden="true"><i></i>Scroll to fast-forward the night</p>
  </div>
</section>

<div class="who" aria-label="Who we work with"><div class="who__row">{who_html}</div></div>

<!-- ============ STORY: a site, start to finish ============ -->
<section class="story" data-night aria-label="How it works">
  <div class="story__stage">
    <div class="container story__grid">
      <div class="story__text">
        <p class="kicker">How it works</p>
        <div class="story__steps">{steps_html}</div>
        <div class="story__bar" aria-hidden="true"><i><b></b></i><i><b></b></i><i><b></b></i><i><b></b></i></div>
      </div>
      <div class="story__scene" aria-hidden="true">
        <div class="story__glow"></div>
        <div class="lap">
          <div class="lap__shadow"></div>
          <div class="lap__base">
            <div class="lap__deck"><div class="lap__keys">{keys}</div><div class="lap__pad"></div><i class="lap__spk l"></i><i class="lap__spk r"></i><div class="lap__spill"></div><div class="lap__hinge"></div></div>
            <div class="lap__front"><i></i></div>
          </div>
          <div class="lap__lid">
            <div class="lap__cover"><img src="assets/img/favicon.svg" alt=""></div>
            <div class="lap__face"><i class="lap__cam"></i><span class="lap__brand">LRWeb</span><div class="lap__display">
              <div class="lap__boot"><img src="assets/img/favicon.svg" alt=""></div>
              <div class="wire"><div class="wire__nav"><i style="width:22%"></i><i style="width:40%"></i></div><div class="wire__hero"><div class="lines"><i class="big"></i><i class="big" style="width:70%"></i><i style="width:90%"></i><i style="width:60%"></i><b></b></div><div class="wire__img"></div></div><div class="wire__cards"><i></i><i></i><i></i></div></div>
              <div class="lap__site"><img src="assets/work/smith-and-sons-hero.jpg" alt="" width="1440" height="900" loading="lazy" decoding="async"></div>
              <div class="lap__toasts"><div>{OKI}Backup complete<time>02:11</time></div><div>{OKI}Updates applied<time>02:04</time></div><div>{OKI}Security scan: all clear<time>03:30</time></div></div>
              <span class="lap__glass"></span>
            </div></div>
            <div class="lap__top"></div>
          </div>
        </div>
        <div class="chip3 a"><i style="background:#E9F8F1;color:#1F7A5C">{SHIELD}</i><div>Kept safe<small>Scanned &amp; guarded</small></div></div>
        <div class="chip3 b"><i style="background:#E8F3FD;color:#0A6FC2">{IC['db']}</i><div>Backed up nightly<small>Stored off-site</small></div></div>
        <div class="chip3 c"><i style="background:#EEF0FE;color:#3F4DE6">{IC['pulse']}</i><div>Up &amp; running<small>Checked every minute</small></div></div>
        <div class="chip3 d"><i style="background:#E9F8F1;color:#1F7A5C">{IC['chat']}</i><div>Luke replied<small>“Done, all sorted!”</small></div></div>
      </div>
    </div>
  </div>
</section>

<!-- ============ TWO JOBS ============ -->
<section class="sec" id="what">
  <div class="container">
    <div class="sec-head">
      <p class="kicker" data-reveal>What we do</p>
      <h2 data-split>Two jobs. We build your website, then we look after it for good.</h2>
      <p class="lead" data-reveal>Most web designers hand over the keys and disappear. We stay. You can have either job or both, and you’ll always be dealing with the same two people.</p>
    </div>
    <div class="jobs">
      <article class="job job--build" data-reveal>
        <div class="bscene" aria-hidden="true">
          <div class="bs-win">
            <div class="bs-bar"><i></i><i></i><i></i><span class="bs-url">yourbusiness.co.uk</span><span class="bs-opt">Design <b>A</b></span></div>
            <div class="bs-page">
              <div class="bs-nav"><i class="bs-logo"></i><span><i></i><i></i><i></i></span><em></em></div>
              <div class="bs-hero"><div class="bs-copy"><i class="bs-h"></i><i class="bs-h bs-s"></i><i class="bs-t"></i><i class="bs-t bs-s"></i><b class="bs-btn"></b></div><div class="bs-img"><span></span></div></div>
              <div class="bs-cards"><i></i><i></i><i></i></div>
            </div>
            <svg class="bs-cursor" viewBox="0 0 20 20"><path d="M3 2l13 7-6 1.5L7 17z" fill="#fff" stroke="#070824" stroke-width="1.4" stroke-linejoin="round"/></svg>
            <span class="bs-stamp">Live</span>
          </div>
          <div class="bs-steps"><span>Chat</span><span>Design</span><span>Build</span><span>Launch</span></div>
        </div>
        <span class="job__tag">Job one · the project</span>
        <h3>We design &amp; build it</h3>
        <p>A website that looks the part, works on every phone, and tells customers exactly what they need to know. One fixed price, agreed in writing before we start.</p>
        <ul class="job__list">
          <li><span class="n">01</span><b>Brand new websites</b><span>Designed around what your customers actually need to find.</span></li>
          <li><span class="n">02</span><b>Redesigns &amp; rescues</b><span>Keeping what works, quietly retiring what doesn’t.</span></li>
          <li><span class="n">03</span><b>Speeding up old sites</b><span>Same site, new engine: quicker, safer and phone-friendly.</span></li>
        </ul>
        <div class="job__foot"><span class="from">Websites from <b>{BUILD_FROM}</b></span><a class="link" href="services.html#build">How a build works {ARROW}</a></div>
      </article>
      <article class="job job--care on-dark" data-reveal style="--d:1">
        <div class="cscene" aria-hidden="true">
          <svg class="cs-orbit" viewBox="0 0 400 200" preserveAspectRatio="none"><ellipse cx="200" cy="100" rx="182" ry="62"/><ellipse class="cs-orbit__glow" cx="200" cy="100" rx="182" ry="62" pathLength="1"/></svg>
          <div class="cs-site"><div class="cs-bar"><i></i><i></i><i></i></div><div class="cs-body"><span class="cs-dot"></span><b>yourbusiness.co.uk</b><small class="cs-msg">Everything’s fine</small></div></div>
          <span class="cs-sat" style="--a:0deg;--c:#3DB88D" data-msg="Backup saved at 02:00">{IC['db']}</span>
          <span class="cs-sat" style="--a:60deg;--c:#0B86EA" data-msg="Updates tested &amp; applied">{IC['refresh']}</span>
          <span class="cs-sat" style="--a:120deg;--c:#3F4DE6" data-msg="Security scan: all clear">{IC['shield']}</span>
          <span class="cs-sat" style="--a:180deg;--c:#3DB88D" data-msg="Up and running, checked 1 min ago">{IC['pulse']}</span>
          <span class="cs-sat" style="--a:240deg;--c:#0B86EA" data-msg="Padlock renewed for another year">{IC['lock']}</span>
          <span class="cs-sat" style="--a:300deg;--c:#3F4DE6" data-msg="Luke: “Done, all sorted!”">{IC['chat']}</span>
        </div>
        <div class="corner-sun" aria-hidden="true"></div>
        <span class="job__tag">Job two · for as long as you like</span>
        <h3>We look after it</h3>
        <p>Your website becomes our responsibility, for a flat monthly fee. Most of this happens quietly while you sleep. You’ll mostly notice nothing, and that’s the point.</p>
        <ul class="care-list">{care_list}</ul>
        <div class="job__foot"><span class="from">Care plans from <b>£29</b>/month</span><a class="link" href="pricing.html">See plans {ARROW}</a></div>
      </article>
    </div>
  </div>
</section>

<!-- ============ A MONTH OF CARE ============ -->
<section class="sec sec--white">
  <div class="container">
    <div class="month">
      <div class="cal" data-inview>
        <div class="cal__play" aria-hidden="true"></div>
        <div class="cal__head"><b id="calMonth">This month</b><span>yourbusiness.co.uk · care log</span></div>
        <div class="cal__grid" id="cal"></div>
        <div class="legend"><span><i style="background:#3DB88D"></i>Nightly backup</span><span><i style="background:#0B86EA"></i>Updates applied</span><span><i style="background:#3F4DE6"></i>Deep security scan</span><span><i style="background:#F2B94B"></i>A change you asked for</span></div>
        <p class="cal__tip">Tap or hover any day to see what happened.</p>
      </div>
      <div>
        <p class="kicker" data-reveal>What looking after a website actually means</p>
        <h2 data-split>A month of looking after your site.</h2>
        <p class="lead" data-reveal style="margin:20px 0 26px">A website isn’t a thing you buy once, like a sign. It’s more like a van: it needs regular servicing to stay safe and reliable. We do all of it, mostly at unsociable hours, so it never gets in your way.</p>
        <ul class="tally" data-reveal>
          <li><b data-odo id="tBackups">0</b><span>nightly {J('backups')} so far this month</span></li>
          <li><b data-odo id="tChecks">0</b><span>times we’ve checked your site is up</span></li>
          <li><b data-odo id="tUpdates">0</b><span>rounds of tested {J('updates')}</span></li>
          <li><b>0</b><span>things you had to do</span></li>
        </ul>
      </div>
    </div>
    <div class="facts">
      <div class="fact" data-reveal><b><span data-odo data-to="99.9">0</span><em>%</em></b><span>{J('uptime', label='uptime')} target, checked every minute by independent {J('monitoring')}</span></div>
      <div class="fact" data-reveal style="--d:1"><b>24/7</b><span>alerts go straight to our phones, not a dashboard nobody reads</span></div>
      <div class="fact" data-reveal style="--d:2"><b>02:00</b><span>nightly backups, encrypted and stored away from the server</span></div>
      <div class="fact" data-reveal style="--d:3"><b><span data-odo data-to="20">0</span></b><span>client cap, on purpose, so every site gets proper attention</span></div>
    </div>
  </div>
</section>

<!-- ============ BEFORE / AFTER ============ -->
<section class="sec">
  <div class="container">
    <div class="sec-head">
      <p class="kicker" data-reveal>The difference</p>
      <h2 data-split>Drag the handle. This is the job we do.</h2>
      <p class="lead" data-reveal>Every town has websites stuck in 2009, and behind each one is a good business that deserves better. Slide to see what a rescue looks like.</p>
    </div>
    <div class="ba" data-inview data-reveal>
      <div class="ba__pane ba__old" aria-hidden="true">
        <div class="marq"><span>!!! WELCOME TO OUR WEB SITE !!! BEST PRICES IN TOWN !!! CALL NOW !!!</span></div>
        <h4>J. Smith &amp; Sons Plumbing Est. 1987</h4>
        <p class="nav98">Home | About_Us | Services | Gallery (broken) | Contact!!</p>
        <p>Welcome to the offical home page of J Smith and Sons. We are a family run busines serving the local area. Please bare with us while the site is under construction.</p>
        <p>Click here to download our price list (Word 97 document, 14MB)</p>
        <div class="uc"><span>UNDER CONSTRUCTION</span></div>
        <p class="foot98">Best viewed in Internet Explorer 6 · Last updated March 2014 · Visitors: <span class="counter">000042</span></p>
      </div>
      <div class="ba__pane ba__new"><picture><source media="(max-width:760px)" srcset="assets/work/smith-and-sons-mobile.jpg"><img src="assets/work/smith-and-sons-hero.jpg" alt="The rebuilt Smith &amp; Sons website, with a clear emergency number, prices and online booking" loading="lazy" decoding="async" width="1440" height="900"></picture></div>
      <div class="ba__handle" aria-hidden="true"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6"/></svg></span></div>
      <span class="ba__hint" aria-hidden="true">Drag me</span>
      <span class="ba__tag ba__tag--l">Before</span><span class="ba__tag ba__tag--r">After LRWeb</span>
      <input class="ba__range" type="range" min="0" max="100" value="50" step="0.1" aria-label="Compare the old and new website">
    </div>
    <div class="ba-foot"><span>Same family business. Same phone number. A website they’re proud to share.</span><a class="link" href="work/smith-and-sons/index.html">Open the finished site {ARROW}</a></div>
  </div>
</section>

<!-- ============ THE GAP ============ -->
<section class="sec sec--white">
  <div class="container">
    <div class="sec-head">
      <p class="kicker" data-reveal>Honestly, though</p>
      <h2 data-split>There’s a gap between £3 hosting and £10k agencies. We live in it.</h2>
      <p class="lead" data-reveal>Small businesses usually get offered two bad options: cheap and on your own, or looked after at a price only big companies can pay. Here’s where everyone sits.</p>
    </div>
    {GAPCHART}
    <div class="gap-grid">
      <div class="gap" data-reveal><span class="who-label">Bargain hosting</span><h3>£3 a month, and silence.</h3><ul><li>{CROSS}A control panel you’ll never want to log into</li><li>{CROSS}Support chat staffed by a bot named something friendly</li><li>{CROSS}Updates, backups and security are your problem</li></ul><p class="verdict">Fine, until it isn’t.</p></div>
      <div class="gap gap--us" data-reveal style="--d:1"><span class="who-label">LRWeb</span><h3>One price. Two humans. Zero drama.</h3><ul style="color:#3DB88D"><li>{CHECK}<span style="color:rgba(245,248,250,.86)">Built, hosted and cared for by the same people</span></li><li>{CHECK}<span style="color:rgba(245,248,250,.86)">Email answered by someone who knows your site by name</span></li><li>{CHECK}<span style="color:rgba(245,248,250,.86)">Updates, backups and monitoring just quietly happen</span></li></ul><p class="verdict">From £29/month. <a href="pricing.html" style="color:#6FE0B4;font-weight:600">See plans</a></p></div>
      <div class="gap" data-reveal style="--d:2"><span class="who-label">Big agency</span><h3>Lovely work, eye-watering invoices.</h3><ul><li>{CROSS}Five figures before anything exists</li><li>{CROSS}An account manager between you and anyone technical</li><li>{CROSS}You’ll always be their smallest client</li></ul><p class="verdict">Great for PLCs, overkill for you.</p></div>
    </div>
  </div>
</section>

<!-- ============ EXAMPLE SITES ============ -->
<section class="sec sec--night on-dark" data-night style="overflow:hidden">
  <div class="container">
    <div class="sec-head">
      <p class="kicker" data-reveal>Example sites</p>
      <h2 data-split>The kind of site your business could have.</h2>
      <p class="lead" data-reveal>We designed these example sites for the sorts of businesses we look after: trades, cafés, salons, shops and clubs. Spin through them, then tap one to have a go.</p>
    </div>
  </div>
  <div class="carousel" id="carousel" data-reveal><div class="carousel__ring">{carousel}</div></div>
  <div class="carousel__ui"><button type="button" data-dir="-1" aria-label="Previous example site"><svg viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4L3 8l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="carousel__dots">{dots}</div><button type="button" data-dir="1" aria-label="Next example site"><svg viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
  <p class="carousel__hint">Swipe or drag to spin · <a class="link" href="work.html">See them all {ARROW}</a></p>
</section>

<!-- ============ PRICING ============ -->
<section class="sec" id="pricing">
  <div class="container">
    <div class="sec-head center">
      <p class="kicker" data-reveal>Pricing</p>
      <h2 data-split>Simple plans. No surprises on the invoice.</h2>
      <p class="lead" data-reveal>One monthly price covers everything below. No contracts, no VAT to add, no “setup fees”, and you can leave with 30 days’ notice.</p>
    </div>
    {EVERY_HTML}
    {PLANS}
    <div class="launch" data-reveal>
      <div class="launch__badge"><span>From</span><b>{BUILD_FROM}</b></div>
      <div><h3>Need a website first? New sites and redesigns from {BUILD_FROM}.</h3><p>A smart, fast site of up to three pages, designed and built for you at a fixed price agreed in writing. Bigger sites, shops and bookings are priced up front too.</p></div>
      <a class="btn btn-primary" href="pricing.html#builds">See website prices {ARROW}</a>
    </div>
    <p class="price-note" data-reveal><small>All prices are the total you pay. We are not registered for VAT, so no VAT is added. If we ever must register, VAT is added on 30 days’ notice.</small></p>
  </div>
</section>

<!-- ============ PEOPLE ============ -->
<section class="sec sec--white">
  <div class="container">
    <div class="sec-head">
      <p class="kicker" data-reveal>Who you’ll be dealing with</p>
      <h2 data-split>Two named humans. Both in Berkshire.</h2>
      <p class="lead" data-reveal>LRWeb is Luke and Ralph. We find most of our clients close to home, from Hungerford to Wokingham, and we look after businesses right across the UK too.</p>
    </div>
    {PEOPLE}
    {locmap()}
    <p style="margin-top:36px" data-reveal><a class="link" href="about.html">More about us {ARROW}</a></p>
  </div>
</section>

<section class="sec sec--ref">
  <div class="container">{ticket()}</div>
</section>

""" + cta('Stop worrying about your website. Start ignoring it.', 'Tell us what you need: a new site, a rescue job, or just someone reliable to take over the hosting. We’ll reply like humans, with a straight answer and a clear price.') + FOOT

# ================================================================= SERVICES
def services():
    OKs = '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#3DB88D"/><path d="M4.8 8.2l2 2 4.2-4.4" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    vis = {
      'server': '<div class="v-rack"><div class="v-unit"><i></i><i></i><i></i><b></b></div><div class="v-unit"><i></i><i></i><i></i><b></b></div><div class="v-unit"><i></i><i></i><i></i><b></b></div><span class="v-leaf"><svg viewBox="0 0 16 16"><path d="M13 3C6 3 3 6.5 3 11c0 .8.1 1.4.3 2C5 8.5 8 7 11 6.5 8.5 8 6.5 10 5 13.5c4.5.5 8-2.5 8-10.5z" fill="currentColor"/></svg>100% renewable energy</span></div>',
      'refresh': '<ul class="v-upd">' + ''.join(f'<li style="--i:{i}"><span>{n}</span><em><s>{a}</s><b>{b}</b></em>{OKs}</li>' for i, (n, a, b) in enumerate([('WordPress', '6.5', '6.6'), ('Booking form', '2.3', '2.4'), ('Photo gallery', '1.8', '1.9'), ('Contact form', '5.1', '5.2')])) + '</ul><p class="v-note">Tested on a copy of your site first</p>',
      'db': '<div class="v-snaps">' + ''.join(f'<span style="--i:{i}"><b>{d}</b><small>02:00</small></span>' for i, d in enumerate(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])) + '</div><div class="v-restore"><span>Something gone wrong?</span><b>Restore any day</b></div>',
      'shield': '<div class="v-shield"><svg viewBox="0 0 120 140"><defs><linearGradient id="shG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3DB88D"/><stop offset=".55" stop-color="#0B86EA"/><stop offset="1" stop-color="#3F4DE6"/></linearGradient></defs><path d="M60 6l48 18v36c0 34-22 60-48 72C34 120 12 94 12 60V24z" fill="url(#shG)"/><path d="M40 70l14 14 28-30" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>' + ''.join(f'<i style="--i:{i}"></i>' for i in range(6)) + '</div><p class="v-note">Suspicious visitors turned away, day and night</p>',
      'pulse': '<div class="v-up"><svg viewBox="0 0 300 90" preserveAspectRatio="none"><path class="v-up__l" pathLength="1" d="M0 60 C20 58 30 40 50 44 S80 62 100 50 130 30 150 38 180 56 200 46 230 28 250 34 280 48 300 40"/></svg><div class="v-up__pings">' + ''.join(f'<i style="--n:{k}"></i>' for k in range(12)) + '</div><p><span class="v-dot"></span>Up · checked 1 minute ago</p></div>',
      'lock': '<div class="v-ssl"><div class="v-addr"><svg viewBox="0 0 10 12" fill="none"><rect x="1" y="5" width="8" height="6" rx="1.5" fill="#3DB88D"/><path d="M3 5V3.5a2 2 0 0 1 4 0V5" stroke="#3DB88D" stroke-width="1.4"/></svg><span>https://</span>yourbusiness.co.uk</div><div class="v-ring"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" /><circle class="v-ring__p" cx="40" cy="40" r="34" pathLength="1"/></svg><b>Auto</b><small>renews</small></div></div>',
      'speed': '<div class="v-gauge"><svg viewBox="0 0 200 120"><defs><linearGradient id="gaG" x1="0" x2="1"><stop offset="0" stop-color="#3DB88D"/><stop offset=".55" stop-color="#0B86EA"/><stop offset="1" stop-color="#3F4DE6"/></linearGradient></defs><path d="M20 110a80 80 0 0 1 160 0" fill="none" stroke="rgba(22,32,58,.08)" stroke-width="16" stroke-linecap="round"/><path class="v-gauge__arc" pathLength="1" d="M20 110a80 80 0 0 1 160 0" fill="none" stroke="url(#gaG)" stroke-width="16" stroke-linecap="round"/><g class="v-gauge__n"><path d="M100 110L100 42" stroke="#16203A" stroke-width="4" stroke-linecap="round"/><circle cx="100" cy="110" r="8" fill="#16203A"/></g></svg><p><b>0.8s</b> example page load</p></div>',
      'edit': '<div class="v-chat"><p class="v-me">Can you change our Saturday hours to 9 till 1?</p><p class="v-typing"><i></i><i></i><i></i></p><p class="v-them"><b>Luke</b>Done! It’s live now. Anything else?</p></div>',
      'chat': '<div class="v-mail"><div class="v-mail__h"><span class="v-av">R</span><div><b>Ralph at LRWeb</b><small>Re: quick question about my site</small></div><time>09:12</time></div><p>Morning! Good question. Short answer: yes, and it won’t cost you anything extra. I’ve made the change, have a look and let me know what you think.</p></div>',
    }
    care = [
      ('server', '', 'Managed hosting', 'Fast, secure servers we run ourselves, powered by 100% renewable energy.', 'Hosting is the computer that stores your website and shows it to everyone who visits. We run it, watch it and keep it quick.'),
      ('refresh', '', 'Software updates', 'WordPress core, themes and plugins tested and applied.', 'Websites need regular updates, like a phone does. We test each one on a copy of your site before it goes anywhere near the real thing.'),
      ('db', 'g', 'Daily backups', 'Stored off-site, separate from the server, restorable on request.', 'Every night we save a complete spare copy of your site somewhere else. If anything ever goes wrong, we can put it back.'),
      ('shield', 'g', 'Security monitoring', 'Malware scanning, firewall rules, login protection.', 'We scan for anything nasty and turn away suspicious visitors, so hackers find your site a lot less interesting than the next one.'),
      ('pulse', 'i', 'Uptime monitoring', 'We usually know your site is down before you do.', 'A robot checks your website every single minute. If it stops answering, our phones buzz, whatever the time.'),
      ('lock', 'i', 'SSL certificates', 'Renewed automatically, padlock always on.', 'The padlock next to your web address tells visitors it’s safe to fill in your forms. It needs renewing, so we do that for you.'),
      ('speed', '', 'Performance care', 'Caching, image optimisation and speed tuning.', 'Slow websites lose customers. We shrink images and keep ready-made copies of your pages so they appear in a blink.'),
      ('edit', 'g', 'Small content edits', 'Prices, hours, photos, wording. Just email us.', 'New prices, holiday hours, a fresh photo. Send us an email in normal words and we’ll make the change.'),
      ('chat', 'i', 'Real support', 'Questions answered by the people who built your site.', 'No call centre, no ticket numbers, no chatbot. You email Luke or Ralph, and one of us replies.'),
    ]
    items = ''.join(f'<button type="button" class="ctrl__item" role="tab" id="ct{i}" aria-controls="cp{i}" aria-selected="{"true" if i == 0 else "false"}"><span class="svc__ic {c}">{IC[ic]}</span><span><b>{t}</b><small>{d}</small></span></button>' for i, (ic, c, t, d, p) in enumerate(care))
    panels = ''.join(f'<div class="cp{" on" if i == 0 else ""}" role="tabpanel" id="cp{i}" aria-labelledby="ct{i}"{"" if i == 0 else " hidden"}><div class="cp__vis" aria-hidden="true">{vis[ic]}</div><div class="cp__txt"><p class="cp__k">In plain English</p><h3>{t}</h3><p>{p}</p></div></div>' for i, (ic, c, t, d, p) in enumerate(care))
    migrate = [('Full site migration', 'Files, database, email records and domain settings.'), ('Pre-switch testing', 'We check every page before anything goes live.'), (f'{J("DNS")} handled for you', 'No fiddling with registrar control panels.'), ('Old host cancellation help', 'We’ll even draft the goodbye email.')]
    mig_html = ''.join(f'<li>{CHECK}<div><b>{t}</b><br><span>{d}</span></div></li>' for t, d in migrate)
    builds = [('browser', '', 'Brand new websites', 'For businesses starting from nothing or nearly nothing. Designed around what your customers actually need to find, built fast and tidy.', f'From {BUILD_FROM}'),
              ('refresh', 'g', 'Redesigns &amp; rescues', 'Your current site exists but it isn’t doing you any favours. We rebuild it properly, keeping what works and quietly retiring what doesn’t.', f'From {BUILD_FROM}'),
              ('speed', 'i', 'Speeding up old sites', 'Old site, new engine. We bring ageing websites up to date: phone-friendly, quick to load, secure, and easier to update.', 'Fixed quote')]
    b_html = ''.join(f'<div class="svc svc--build" data-reveal style="--d:{i}"><div class="svc__ic {c}">{IC[ic]}</div><h3>{t}</h3><p>{d}</p><span class="svc__price">{pr}</span></div>' for i, (ic, c, t, d, pr) in enumerate(builds))
    steps = [('The conversation', 'You tell us about your business, what you like, what you hate, and what the website needs to do. We listen more than we talk.'),
             ('A clear quote', 'Fixed price, written down, with exactly what’s included. A 50% deposit secures your slot and work begins.'),
             ('Design options', 'You see two or three real design directions for your homepage: not mood boards, actual designs. You pick one and tell us what to change.'),
             ('The build', 'We build the full site, write or polish the copy, sort the photos, and handle all the technical setup. Two rounds of revisions are included.'),
             ('Launch &amp; handover', 'Final balance settled, site goes live, then it moves onto a care plan as stated in your quote, after any included hosting period ends. You get a plain-English guide to what you own and how it works.')]
    tl = ''.join(f'<li><span class="n">0{i+1}</span><div><h3>{t}</h3><p>{d}</p></div></li>' for i, (t, d) in enumerate(steps))
    nope = ['social media management', '“SEO packages” with mystery deliverables', 'logo design by committee', '£99 websites', 'jargon']
    nope_html = ''.join(f'<li style="--d:{i}">{n}</li>' for i, n in enumerate(nope))
    return head('What We Do: Managed Hosting, Care Plans &amp; Website Builds | LRWeb',
                'Two jobs: build your website well, then look after it. Managed hosting, updates, backups, security and support, plus fixed-price website builds.', 'services') + nav('services.html') + phero('What we do', 'We build websites. Then we stick around.', 'Everything we do fits into two jobs: making your website, and looking after it for as long as you want us to. Here’s exactly what that involves, in plain English.', f'<div class="phero__chips load-in d3"><a href="#care">{IC["shield"]}Looking after it</a><a href="#build">{IC["browser"]}Building it</a><a href="#switch">{IC["move"]}Moving to us</a></div>') + f'''
<section class="sec" id="care">
  <div class="container">
    <div class="sec-head">
      <p class="kicker" data-reveal>Job two · the looking-after bit</p>
      <h2 data-split>Nine things we do, so you never have to.</h2>
      <p class="lead" data-reveal>This is the heart of LRWeb. For one flat monthly fee your website becomes our responsibility. Tap any item to see what it actually means.</p>
    </div>
    <div class="ctrl" data-reveal>
      <div class="ctrl__list" role="tablist" aria-label="What a care plan includes">{items}</div>
      <div class="ctrl__stage"><div class="ctrl__glow" aria-hidden="true"></div>{panels}</div>
    </div>
  </div>
</section>

<section class="sec sec--white" id="switch">
  <div class="container split split--center">
    <div>
      <p class="kicker" data-reveal>Moving an existing site to us</p>
      <h2 data-split>Switching hosts, minus the headache.</h2>
      <p class="lead" data-reveal style="margin-top:20px">Already have a website hosted somewhere you’d rather not be? We move it carefully, test everything, then switch over with no downtime worth mentioning.</p>
      <p class="note" data-reveal>{TICK} Moving is free when you join a care plan</p>
      <div class="mig" data-inview aria-hidden="true">
        <div class="mig__box mig__old"><b>Old host</b><small>slow · no backups</small></div>
        <div class="mig__road"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><span class="mig__van">{IC["move"]}</span></div>
        <div class="mig__box mig__new"><b>LRWeb</b><small>looked after</small></div>
      </div>
    </div>
    <ul class="checklist" data-reveal style="--d:1">{mig_html}</ul>
  </div>
</section>

<section class="sec" id="build">
  <div class="container">
    <div class="sec-head">
      <p class="kicker" data-reveal>Job one · the project bit</p>
      <h2 data-split>Design &amp; build work</h2>
      <p class="lead" data-reveal>One-off projects with a clear price, a clear scope, and a finish line. Hosting is included as stated in your quote or package.</p>
    </div>
    <div class="svc-grid svc-grid--3">{b_html}</div>
  </div>
</section>

<section class="sec sec--white">
  <div class="container split">
    <div class="sticky-col">
      <p class="kicker" data-reveal>How a build runs</p>
      <h2 data-split>From first email to launch.</h2>
      <p class="lead" data-reveal style="margin-top:20px">Five steps, a fixed price, and you always know what happens next.</p>
      <p style="margin-top:26px" data-reveal><a class="btn btn-primary" href="contact.html">Start a conversation {ARROW}</a></p>
    </div>
    <ol class="timeline">{tl}</ol>
  </div>
</section>

<section class="sec">
  <div class="container">
    <div class="sec-head">
      <p class="kicker" data-reveal>What we don’t do</p>
      <h2 data-split>A short list, kept on purpose.</h2>
      <p class="lead" data-reveal>We’d rather be excellent at websites than mediocre at everything.</p>
    </div>
    <ul class="nope" data-inview>{nope_html}</ul>
  </div>
</section>
''' + cta('Sounds like what you need?', 'Tell us about your website: the one you have, or the one you wish you had. We’ll come back with a straight answer.') + FOOT

# ================================================================= PRICING
def pricing():
    TK = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    b_html = ''.join(f'<article class="build{" build--launch on-dark" if i == 0 else ""}" data-reveal style="--d:{i}">{"<span class=" + chr(34) + "build__tag" + chr(34) + ">" + tag + "</span>" if tag else ""}<h3>{n}</h3><div class="range">{r}</div><p class="build__cond">{cond}</p><p>{d}</p><ul>{"".join(f"<li>{TK}{x}</li>" for x in l)}</ul></article>' for i, (n, r, cond, d, l, tag) in enumerate(BUILDS))
    incl = ['New sites and redesigns priced the same way', '50% deposit, balance at launch', 'Two revision rounds included', 'You own everything', 'Hosted on 100% renewable energy', 'Your quote states any hosting period included']
    incl_html = ''.join(f'<li>{TICK}{x}</li>' for x in incl)
    why = [('Two people, no overheads', 'No office, no sales team, no account managers. What you pay goes into your website, not into someone’s commission.'),
           ('Proven foundations', 'Every site starts from building blocks we’ve already tested for speed, security and phones. You pay for what’s unique to your business, not for reinventing the basics.'),
           ('We earn our keep over years', 'We’d rather look after your site for years than charge a fortune up front. Builds are priced low; care plans are how we make our living.'),
           ('Fixed, written, all-in', 'No VAT to add, no setup fees, no surprise extras. The number in your quote is the number you pay.')]
    why_html = ''.join(f'<div class="why__item" data-reveal style="--d:{i}"><span class="why__n">0{i + 1}</span><h3>{t}</h3><p>{d}</p></div>' for i, (t, d) in enumerate(why))
    spend = [('Design options &amp; your feedback', 25, '#3DB88D'), ('Building &amp; testing on every device', 35, '#0B86EA'), ('Words, photos &amp; search setup', 20, '#3F4DE6'), ('Launch, handover &amp; training', 20, '#12018D')]
    spend_bar = ''.join(f'<i style="--w:{p}%;--c:{c};--d:{k}"><span>{p}%</span></i>' for k, (t, p, c) in enumerate(spend))
    spend_key = ''.join(f'<li><i style="background:{c}"></i><b>£{round(599 * p / 100)}</b><span>{t}</span></li>' for t, p, c in spend)
    return head('Pricing: Care Plans from £29/mo, Websites from ' + BUILD_FROM + ' | LRWeb',
                'Clear prices, clear scope. Website care plans from £29 a month covering hosting, updates, backups and support, plus fixed-price websites from ' + BUILD_FROM + '.', 'pricing') + nav('pricing.html') + phero('Pricing', 'Clear prices. Clear scope. No surprises.', 'Two things to price: the monthly care plan that keeps your site healthy, and the one-off cost of building or rebuilding it. Everything is the total you pay, with nothing hidden.') + f'''
<section class="sec">
  <div class="container">
    <div class="sec-head">
      <p class="kicker" data-reveal>Monthly</p>
      <h2 data-split>Care plans</h2>
      <p class="lead" data-reveal>Every plan includes hosting, updates, backups, monitoring and a real person at hello@lrweb.uk. Monthly rolling, no long contracts.</p>
    </div>
    {EVERY_HTML}
    {PLANS}
    <p class="price-note" data-reveal>Prices shown are the total amount payable per month. We are not registered for VAT, so no VAT is added. If we must register, VAT is added on 30 days’ notice. Plans roll monthly and you can cancel with 30 days’ notice. <a href="terms.html">Full terms</a>.</p>
  </div>
</section>

<section class="sec sec--white">
  <div class="container deal2">
    {receipt()}
    <div>
      <p class="kicker" data-reveal>Is it good value?</p>
      <h2 data-split>About 95p a day for a website you never have to think about.</h2>
      <div class="vs" data-reveal>
        <div class="vs__row"><b>Doing it yourself</b><p>Cheap hosting, then your evenings: updates, backups, the 11pm panic when the site won’t load. Your time is worth more than that.</p></div>
        <div class="vs__row"><b>A big agency</b><p>Brilliant work, five-figure invoices, and an account manager between you and anyone technical.</p></div>
        <div class="vs__row vs__row--us"><b>LRWeb</b><p>Everything on this receipt, done by the two people who built your site, for one flat price. Leave whenever you like.</p></div>
      </div>
    </div>
  </div>
</section>

<section class="sec" id="builds">
  <div class="container">
    <div class="sec-head">
      <p class="kicker" data-reveal>One-off</p>
      <h2 data-split>Website builds</h2>
      <p class="lead" data-reveal>Fixed quotes based on size and complexity. These ranges cover most projects; yours gets an exact figure in writing before anything starts.</p>
    </div>
    <div class="builds builds--4">{b_html}</div>
    <ul class="incl" data-reveal>{incl_html}</ul>
    <p class="price-note" data-reveal>Build prices are the total amount payable. We are not registered for VAT, so no VAT is added. If we must register, VAT is added on 30 days’ notice. Ranges are indicative; your written quote is a fixed price for a fixed scope. After launch, sites move onto a care plan from £29 a month. <a href="terms.html">Full terms</a>.</p>
    <div style="margin-top:56px">{ESTIMATOR}</div>
  </div>
</section>

<section class="sec sec--white" id="why">
  <div class="container">
    <div class="sec-head">
      <p class="kicker" data-reveal>Why these prices</p>
      <h2 data-split>Honest prices, and the reasons behind them.</h2>
      <p class="lead" data-reveal>Cheap websites usually cut corners. Ours don’t. Here’s how we keep the price down anyway, and where your money actually goes.</p>
    </div>
    <div class="why">{why_html}</div>
    <div class="spend" data-inview>
      <div class="spend__head"><b>Where a £599 Standard build goes</b><span>Roughly, for a typical project</span></div>
      <div class="spend__bar" aria-hidden="true">{spend_bar}</div>
      <ul class="spend__key">{spend_key}</ul>
    </div>
  </div>
</section>

<section class="sec">
  <div class="container">
    <div class="sec-head center">
      <p class="kicker" data-reveal>Questions</p>
      <h2 data-split>The things people actually ask</h2>
    </div>
    {faq_html(FAQ)}
  </div>
</section>
''' + cta('Want an exact number?', 'Tell us what you’re after and we’ll send a fixed quote in writing. No phone-call ambush, no “book a strategy session”.') + FOOT

# ================================================================= ABOUT
def about():
    return head('About LRWeb: Small on Purpose, Personal by Design',
                'LRWeb is two people, Luke and Ralph, with a careful client list and a strong opinion that websites should be looked after by humans you can name.', 'about') + nav('about.html') + phero('About', 'Small on purpose. Personal by design.', 'LRWeb is two people, a careful client list, and a strong opinion that websites should be looked after by humans you can name.') + f'''
<section class="sec">
  <div class="container split">
    <div><p class="kicker" data-reveal>The short version</p><h2 data-split>Most small organisations get a rotten deal on websites.</h2></div>
    <div data-reveal style="--d:1">
      <p class="lead" style="max-width:none">The cheap end sells you “space on a server” and disappears. The agency end charges five figures and assigns you an account manager. In between is a gap: people who want a good website, looked after properly, by someone who answers emails.</p>
      <p class="lead" style="max-width:none;margin-top:18px">That’s us. We build websites, then we take responsibility for them: hosting, updates, security, backups, edits, the lot. We deliberately keep the client list small so every site gets real attention from people who actually remember building it.</p>
    </div>
  </div>
</section>

<section class="sec sec--white">
  <div class="container">
    <div class="sec-head"><p class="kicker" data-reveal>The two of us</p><h2 data-split>Luke and Ralph. Both in Berkshire.</h2><p class="lead" data-reveal>Ralph is out west in Hungerford and Kintbury, Luke is over in Wokingham. We find a lot of our clients close to home, and we look after businesses right across the UK too.</p></div>
    {PEOPLE}
    {locmap()}
  </div>
</section>

<section class="sec">
  <div class="container">
    <div class="sec-head"><p class="kicker" data-reveal>How we work</p><h2 data-split>Three rules we don’t break.</h2></div>
    {RULES}
  </div>
</section>

<section class="sec sec--white">
  <div class="container">
    <div class="sec-head"><p class="kicker" data-reveal>Transparency</p><h2 data-split>Where your website actually lives.</h2><p class="lead" data-reveal>Most hosts keep this vague. We’d rather you knew.</p></div>
    <div class="infra" data-reveal>
      <svg class="map" viewBox="0 0 520 380" aria-label="Diagram: your visitors in the UK reach your website on EU servers in Germany through Cloudflare, with backups stored separately">
        <defs><linearGradient id="routeGrad" x1="0" x2="1"><stop offset="0" stop-color="#3DB88D"/><stop offset=".55" stop-color="#0B86EA"/><stop offset="1" stop-color="#3F4DE6"/></linearGradient></defs>
        <g fill="rgba(245,248,250,.07)" stroke="rgba(245,248,250,.18)" stroke-width="1.2">
          <path d="M92 70l18-14 20 6 6 22-10 16 14 18-4 22 18 22-6 30-22 10-34-4-12-18 16-16-20-10 8-24-14-20 14-18z"/>
          <path d="M58 132l14-8 10 12-6 16-14 2-8-12z"/>
          <path d="M300 110l40-16 44 8 20 30-8 40 20 34-18 40-50 10-40-14-20-36 10-30-14-34z"/>
          <path d="M250 160l30 6 6 30-26 12-20-18z"/>
        </g>
        <text x="100" y="300" fill="rgba(245,248,250,.55)" font-family="IBM Plex Mono" font-size="12">UK · your visitors</text>
        <text x="330" y="290" fill="rgba(245,248,250,.55)" font-family="IBM Plex Mono" font-size="12">Germany · EU data centre</text>
        <path id="r1" class="route" d="M130 170 C200 120 280 120 350 170"/>
        <path class="route" d="M350 190 C300 250 230 260 190 240" style="animation-direction:reverse;opacity:.6"/>
        <circle r="4" class="packet"><animateMotion dur="2.4s" repeatCount="indefinite"><mpath href="#r1"/></animateMotion></circle>
        <circle cx="130" cy="170" r="8" fill="#3DB88D"/><circle cx="130" cy="170" r="16" fill="none" stroke="#3DB88D" opacity=".4"><animate attributeName="r" values="8;22;8" dur="2.6s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;0;.6" dur="2.6s" repeatCount="indefinite"/></circle>
        <rect x="336" y="156" width="28" height="30" rx="5" fill="#0B86EA"/><path d="M342 166h16M342 172h16M342 178h10" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <g transform="translate(222 70)"><rect x="-44" y="-16" width="88" height="32" rx="16" fill="rgba(245,248,250,.08)" stroke="rgba(245,248,250,.2)"/><text x="0" y="5" text-anchor="middle" fill="#fff" font-family="Instrument Sans" font-size="13" font-weight="600">Cloudflare</text></g>
        <g transform="translate(190 240)"><rect x="-38" y="-14" width="76" height="28" rx="14" fill="rgba(61,184,141,.14)" stroke="rgba(61,184,141,.4)"/><text x="0" y="5" text-anchor="middle" fill="#6FE0B4" font-family="Instrument Sans" font-size="12" font-weight="600">Backups</text></g>
      </svg>
      <dl>
        <div><dt>Germany · DE</dt><dd>Your website &amp; server<span>Netcup’s EU data centres: fast connections to the UK, strict privacy law</span></dd></div>
        <div><dt>Renewable</dt><dd>100% green energy<span>Our data centres run entirely on renewable power</span></dd></div>
        <div><dt>EU</dt><dd>Daily backups<span>Stored completely separately from the server, encrypted</span></dd></div>
        <div><dt>Global edge</dt><dd>{J('DNS')} &amp; protection<span>Cloudflare keeps things fast and shrugs off attacks</span></dd></div>
        <div><dt>24/7</dt><dd>Monitoring<span>Independent checks every minute, alerts straight to us</span></dd></div>
      </dl>
    </div>
    <div class="roadmap" data-reveal>
      <span class="roadmap__tag">On the roadmap</span>
      <p><b>We may move hosting to London.</b> We’re looking at Leaseweb’s LON-01 data centre in Slough, which Leaseweb publishes as 100% renewable. It would put your website even closer to UK visitors. If we go ahead, every client gets 30 days’ notice first, with the new location and energy details.</p>
    </div>
  </div>
</section>
''' + cta('Like the sound of us?', 'We like the sound of people who read About pages. Get in touch and tell us what you’re working on.') + FOOT

# ================================================================= WORK
def work():
    cards = wcard(WORK[0], wide=True) + ''.join(wcard(w) for w in WORK[1:])
    return head('Example Sites | LRWeb', 'Example websites designed by LRWeb for the kinds of small businesses we look after: trades, cafés, salons, shops, clubs and restaurants.', 'work') + nav('work.html') + phero('Work', 'The kind of site your business could have.', 'We designed these example sites for the sorts of businesses we work with. Each one has its own look and does something useful: bookings, ordering, price guides, timetables. Click through and have a play.') + f'''
<section class="sec">
  <div class="container">
    <div class="work-grid work-grid--all">{cards}</div>
    <p class="aside" style="margin-top:40px;text-align:center" data-reveal>These are example businesses, so the names, people and reviews on them are made up. Bookings and baskets are demos.</p>
  </div>
</section>
''' + cta('Want one like these?', 'Tell us about your business and what the website needs to do. You’ll see real design options early, and a fixed price before anything starts.') + FOOT

# ================================================================= REFERRALS
def referrals():
    deal = [('01', 'Name us at signup', 'Your friend mentions your name when they get in touch. That’s all the paperwork there is.'),
            ('02', 'They stay 30 days', 'The reward becomes payable once the referred client has paid and remained active for 30 days.'),
            ('03', 'Paid within 7 days', 'Once eligible, your reward lands by bank transfer within about a week. No vouchers, no credit, actual money.'),
            ('04', 'No limit', 'Refer two people, get paid twice. Refer ten, we’ll probably also buy you lunch.')]
    d_html = ''.join(f'<div class="rule" data-reveal style="--d:{i}"><span class="n">{n}</span><h3>{t}</h3><p>{d}</p></div>' for i, (n, t, d) in enumerate(deal))
    terms = [
      ('Who runs the scheme.', 'The scheme is operated by LRWeb Ltd, a company registered in England &amp; Wales (company number 17458216), registered office 1 Pillarbox Cottages Winding Wood, Kintbury, Hungerford, England RG17 9RN.'),
      ('Who can take part.', 'Anyone aged 18 or over. You don’t have to be a client of ours.'),
      ('Who counts as a referral.', 'Someone who isn’t already a client and isn’t already in conversation with us about a project. Your name has to be given when they first get in touch. We can’t apply it retrospectively.'),
      ('What’s payable.', '£20 when your referral starts a care plan. £50 when they commission a website build and start a care plan. One reward per referred client.'),
      ('When it’s payable.', 'Once the referred client has paid their first invoice and has been active for 30 days. If they cancel or don’t pay within that window, no reward is due.'),
      ('How it’s paid.', 'By bank transfer, within 7 days of becoming eligible. We’ll need your account details to pay you, and we’ll use them for nothing else.'),
      ('No self-referral.', 'You can’t refer yourself, a business you own or control, or a second business at the same organisation you’ve already been paid for.'),
      ('Tax.', 'The reward is a payment to you, paid gross. If you need to declare it to HMRC, that’s yours to handle. We don’t deduct tax and we don’t give tax advice.'),
      ('Conflicts of interest.', 'If you’re an employee, trustee, governor or officer of the organisation you’re referring, please tell us. Plenty of organisations have rules about accepting payments connected to a supplier decision, and we’d rather donate the reward to the organisation, or drop it entirely, than put you in an awkward position.'),
      ('No limit.', 'Refer two people, get paid twice. There’s no cap.'),
      ('Changes.', 'We may change or withdraw the scheme at any time by updating this page. Any referral already made under the previous terms will be honoured on those terms.'),
      ('Decisions.', 'Where eligibility isn’t clear cut, we’ll decide reasonably and explain why. Our terms of service and privacy policy apply to this scheme too.'),
    ]
    t_html = ''.join(f'<p><b>{a}</b> {b}</p>' for a, b in terms)
    return head('Referrals: Get Paid for Recommending Us | LRWeb', 'Refer someone to LRWeb. When they sign up and stay 30 days, you get £20 for a hosting referral or £50 for design plus hosting, paid by bank transfer.', 'referrals') + nav('referrals.html') + phero('Referrals', 'Good clients know good clients.', 'Most of our work comes from word of mouth. If you send someone our way, we’d like to say thank you properly.') + f'''
<section class="sec sec--ref">
  <div class="container">
    {ticket(big=True)}
  </div>
</section>
<section class="sec">
  <div class="container">
    <div class="sec-head"><p class="kicker" data-reveal>The deal, in one breath</p><h2 data-split>Refer someone, they stick around for 30 days, you get paid within a week.</h2></div>
    {ref_route()}
  </div>
</section>
<section class="sec sec--white">
  <div class="container">
    <div class="sec-head"><p class="kicker" data-reveal>The small print</p><h2 data-split>Scheme terms</h2><p class="aside" data-reveal style="margin-top:14px">Version 2.0 · last updated 13 September 2026</p></div>
    <div class="terms" data-reveal>{t_html}</div>
  </div>
</section>
''' + cta('Got someone in mind?', 'Tell them to email us and drop your name in. Or introduce us directly, whatever’s easiest.') + FOOT

# ================================================================= CONTACT
def contact():
    nxt = [('We read it properly', 'Your enquiry goes to our inbox, not a CRM black hole. We aim to reply within one working day.'),
           ('A real conversation', 'We ask a few sensible questions by email or a quick call, whichever you prefer.'),
           ('A written quote', 'Fixed price, clear scope, no pressure. Take your time deciding.'),
           ('Work begins', 'For builds: 50% deposit secures your slot. For hosting: we start the migration straight away.')]
    n_html = ''.join(f'<li data-reveal style="--d:{i}"><span class="n">0{i+1}</span><div><h3>{t}</h3><p>{d}</p></div></li>' for i, (t, d) in enumerate(nxt))
    return head('Contact LRWeb: Tell Us What You Need', 'Tell us about your website. New project? hello@lrweb.uk. Existing client? support@lrweb.uk. Read by Luke and Ralph, no ticket numbers, no chatbots.', 'contact') + nav('contact.html') + phero('Contact', 'Tell us what you need. We’ll reply like humans.', 'Read by Luke and Ralph. No ticket numbers, no chatbots.') + f'''
<section class="sec">
  <div class="container contact">
    <div>
      <p class="kicker" data-reveal>What happens next</p>
      <ol class="next">{n_html}</ol>
      <div class="mails" data-reveal>
        <a href="mailto:hello@lrweb.uk">hello@lrweb.uk <span>New projects</span></a>
        <a href="mailto:support@lrweb.uk">support@lrweb.uk <span>Existing clients</span></a>
      </div>
    </div>
    <div>
      <form class="form" id="contactForm" data-endpoint="/api/contact" novalidate data-reveal>
        <div class="tabs" role="tablist" aria-label="Enquiry type"><button type="button" role="tab" aria-selected="true" data-tab="project">New website / redesign</button><button type="button" role="tab" aria-selected="false" data-tab="hosting">Hosting &amp; care</button></div>
        <div class="fields">
          <div class="field"><label for="f-name">Your name</label><input id="f-name" name="name" autocomplete="name" required><span class="err">Please add your name.</span></div>
          <div class="field"><label for="f-biz">Business / organisation</label><input id="f-biz" name="organisation" autocomplete="organization"></div>
          <div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" autocomplete="email" required><span class="err">Please add a valid email address.</span></div>
          <div class="field"><label for="f-url">Current website (if you have one)</label><input id="f-url" name="website" inputmode="url" placeholder="yourbusiness.co.uk"></div>
          <div class="field full" id="f-tier-wrap" hidden><label for="f-tier">Which plan looks right?</label><select id="f-tier" name="plan"><option>Not sure yet</option><option>Essential, £29/mo</option><option>Plus, £49/mo</option><option>Pro, £89/mo</option></select></div>
          <div class="field full"><label for="f-msg" id="f-msg-label">Tell us about the project</label><textarea id="f-msg" name="message" required placeholder="What does the website need to do? Any sites you like the look of? Rough timeline?"></textarea><span class="err">Please add a few words about what you need.</span></div>
          <input class="hp" id="f-hp" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        </div>
        <div class="form__foot"><small>We use what you send us only to reply to your enquiry and discuss the work. No mailing lists, and we don’t pass your details to anyone else. See our <a href="privacy.html" style="text-decoration:underline">privacy policy</a>.</small><button type="submit" class="btn btn-primary">Send enquiry {ARROW}</button></div>
      </form>
      <div class="form form-ok" id="formOk" hidden><div class="tick">{TICK}</div><h3 tabindex="-1">Thanks, your enquiry is on its way.</h3><p>We read every message ourselves and aim to reply within one working day. In the meantime, support@lrweb.uk is there for existing clients.</p></div>
    </div>
  </div>
</section>
''' + FOOT


# ================================================================= 404 (served at any path, so every link is made absolute)
def notfound():
    import re
    page = head('Page not found | LRWeb', 'That page has drifted off. Head back to LRWeb.', '404') + nav('') + phero('404', 'This page has sailed off into the night.', 'The link may be old, or the page may have moved. Everything else is right where you left it.', f'<p class="load-in d3" style="margin-top:30px;display:flex;gap:12px;flex-wrap:wrap"><a class="btn btn-primary" href="index.html">Back to the homepage {ARROW}</a><a class="btn btn-ghost" href="contact.html">Tell us what you were after</a></p>') + FOOT
    page = page.replace('<link rel="canonical" href="https://lrweb.uk/404">', '<meta name="robots" content="noindex">')
    return re.sub(r'(href|src)="(?!https?:|mailto:|tel:|#|/|data:)', r'\1="/', page)

# ================================================================= LEGAL (ported word for word from lrweb.uk, em dashes swapped for plain punctuation)
import re as _re
LEGAL_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'legal')
def _undash(h):
    h = h.replace('</b> \u2014 ', '</b>: ')
    h = _re.sub(r' \u2014 ([^\u2014<]{2,140}?) \u2014 ', r' (\1) ', h)
    for a, b in [('LRWeb \u2014 a trading', 'LRWeb, a trading'), ('we will \u2014 but', 'we will, but'), ('permission \u2014 except', 'permission, except')]:
        h = h.replace(a, b)
    h = h.replace('youth group) tell us', 'youth group), tell us')
    return h.replace(' \u2014 ', ': ').replace('\u2014', ',')
def legal(slug, title, crumb, lead):
    body = open(os.path.join(LEGAL_SRC, slug + '.html'), encoding='utf-8').read()
    body = _undash(body).replace('href="/privacy"', 'href="privacy.html"').replace('href="/terms"', 'href="terms.html"')
    body = body.replace(' class="reveal"', '').replace(' reveal"', '"')
    body = _re.sub(r'<button type="button" onclick="window.print\(\)"[^>]*>Print</button>', '<button type="button" class="legal__print" data-print>Print or save as PDF</button>', body)
    body = _re.sub(r'<span style="display:inline-block;margin-left:8px;[^"]*">', '<span class="legal__pill">', body)
    body = body.replace('<p class="updated">// ', '<p class="updated">')
    ids = []
    def h2(m):
        txt = m.group(2); attrs = m.group(1) or ''
        idm = _re.search(r'id="([^"]+)"', attrs)
        hid = idm.group(1) if idm else 's' + _re.match(r'(\d+)', txt).group(1)
        ids.append((hid, txt))
        return f'<h2 id="{hid}">{txt}</h2>'
    body = _re.sub(r'<h2([^>]*)>(.*?)</h2>', h2, body)
    toc = ''.join(f'<li><a href="#{i}">{t}</a></li>' for i, t in ids)
    return head(f'{title} | LRWeb', lead, slug) + nav('') + phero(crumb, title, lead) + f'''
<section class="sec">
  <div class="container legalwrap">
    <aside class="toc" aria-label="On this page"><p>On this page</p><ol>{toc}</ol></aside>
    <article class="legal">{body}</article>
  </div>
</section>
''' + FOOT

PAGES = {'404.html': notfound, 'index.html': home, 'services.html': services, 'pricing.html': pricing, 'about.html': about, 'work.html': work, 'referrals.html': referrals, 'contact.html': contact,
         'privacy.html': lambda: legal('privacy', 'Privacy policy', 'Privacy', 'The plain-English version of how we handle your data. Short, because we don’t collect much.'),
         'terms.html': lambda: legal('terms', 'Terms of service', 'Terms', 'The ground rules for working with us, without the legalese fog.')}
for name, fn in PAGES.items():
    with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n') as f:
        f.write(fn())
    print('wrote', name)
