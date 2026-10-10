// Plain-English explanations for unavoidable jargon, shown as a tap/hover/focus tooltip (like the LRWeb website's jargon tips).
import { h, uid } from '../core/dom.js';

export const GLOSSARY = {
  server: 'A computer that stays switched on all day, holding websites so visitors can load them.',
  'load balancer': 'A traffic director. It spreads visitors across several servers so no single one gets overloaded, and it skips any server that is down.',
  failover: 'Automatically sending visitors to a spare server when the main one has a problem.',
  standby: 'A spare server that only takes visitors when the main servers are unavailable.',
  'health check': 'A quick test, repeated every few seconds, that asks each server "are you OK?".',
  draining: 'Sending a server no new visitors while it finishes what it is doing, so you can safely work on it.',
  weight: 'How big a share of visitors a server gets. A server with weight 2 gets twice as many as one with weight 1.',
  'sticky sessions': 'Keeping a visitor on the same server for their whole visit, so things like shopping baskets are not lost.',
  'round robin': 'Taking turns: server 1, then 2, then 3, then back to 1.',
  'least connections': 'Sending the next visitor to whichever server is the least busy right now.',
  'ip hash': 'Always sending the same visitor to the same server, based on their internet address.',
  'random two': 'Picking two servers at random and sending the visitor to the less busy of the two. Simple and surprisingly even.',
  upstream: 'The list of servers that a load balancer sends visitors to.',
  nginx: 'The software on a server that receives visitors and hands them to the right website.',
  migration: 'Moving a website from one server to another, with all its files and data.',
  cutover: 'The moment visitors start going to the new server instead of the old one.',
  runbook: 'A step-by-step checklist of commands to run, in order.',
  ssl: 'The padlock in the browser. It scrambles traffic between a visitor and the site so nobody can snoop.',
  dns: 'The internet\'s address book. It tells browsers which server a web address lives on.',
  cloudpanel: 'The control panel installed on each server. It creates websites, databases and padlock certificates.',
  'end-to-end encryption': 'Messages are scrambled on your device and only unscrambled on the other person\'s device. Not even this server can read them.',
  passphrase: 'Your secret chat password. It never leaves your device. If you forget it, it cannot be reset, and your old chat history is lost.',
  'safety number': 'A long number made from both people\'s keys. If you both see the same number, nobody is listening in. Compare it over the phone or in person.',
  'key rotation': 'Swapping the lock on your messages for a fresh one every few days, so old messages stay safe even if a key is ever stolen.',
  vault: 'Your private, locked storage for chat keys and history on this device.',
  'one-time password': 'A temporary password shown once. The person must choose their own the first time they sign in.',
  mrr: 'Monthly recurring revenue: what the care plans bring in each month.',
  'care plan': 'LRWeb\'s monthly plan: hosting, updates, backups, security and real people to help.',
  ttl: 'How long other computers remember a website\'s address. Lower it a day before a move so the switch to the new server is quick.',
  ssh: 'A secure way for one computer to log in to another. LRWeb uses it to run commands on your servers.',
  "let's encrypt": 'A free service that issues the padlock certificates (SSL) for websites and renews them automatically.',
  'reverse proxy': 'A front door that passes visitors on to another server or app sitting behind it.',
  'environment variable': 'A setting handed to the program when it starts. It is how secrets such as passwords are supplied without being saved in files.',
  'admin token': 'One long secret code that works like a master password for the whole console. Your own sign-in is safer, because it is personal and can be switched off.',
  simulated: 'This screen is showing practice data. Nothing is being changed on any real server.',
};

let tip = null;
let hideTimer;

function hide() {
  clearTimeout(hideTimer);
  tip?.remove();
  tip = null;
}

function show(anchor, text) {
  hide();
  tip = h('div', { class: 'glass glass--thick term-tip', role: 'tooltip' }, text);
  document.body.append(tip);
  const r = anchor.getBoundingClientRect();
  const w = tip.offsetWidth;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const below = r.bottom + 8 + tip.offsetHeight < innerHeight;
  tip.style.left = `${left}px`;
  tip.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - tip.offsetHeight)}px`;
}

/**
 * Term('load balancer') -> inline term with a dotted underline and a plain-English tooltip.
 * Term('load balancer', 'traffic director') shows custom label text. Unknown keys render as plain text.
 */
export function Term(key, label) {
  const text = GLOSSARY[key.toLowerCase()];
  if (!text) return document.createTextNode(label ?? key);
  const id = uid('term');
  const el = h('button', {
    type: 'button', class: 'term', 'aria-describedby': id,
    onmouseenter: () => show(el, text), onmouseleave: () => { hideTimer = setTimeout(hide, 120); },
    onfocus: () => show(el, text), onblur: hide,
    onclick: (e) => { e.preventDefault(); tip ? hide() : show(el, text); },
    onkeydown: (e) => { if (e.key === 'Escape') hide(); },
  }, label ?? key);
  return el;
}

addEventListener('scroll', hide, { passive: true, capture: true });
addEventListener('resize', hide);
