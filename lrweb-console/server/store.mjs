// Tiny JSON-file document store: in-memory collections, debounced atomic writes. Zero dependencies.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PREFIX = {
  servers: 'srv', clients: 'cli', sites: 'sit', jobs: 'job', invoices: 'inv', subscriptions: 'sub', events: 'evt',
  users: 'usr', sessions: 'ses', pools: 'lbp', chatKeys: 'key', chatMessages: 'msg', chatMailbox: 'mbx', audit: 'aud',
};

export function createStore({ dir, memory = false, debounceMs = 150 } = {}) {
  const file = dir ? join(dir, 'state.json') : '';
  /** @type {Record<string, any[]>} */
  let db = {
    servers: [], clients: [], sites: [], jobs: [], invoices: [], subscriptions: [], events: [],
    users: [], sessions: [], pools: [], chatKeys: [], chatMessages: [], chatMailbox: [], audit: [], meta: {},
  };
  let timer = null;

  if (!memory && file) {
    try {
      db = { ...db, ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch {
      /* first run or unreadable file: start empty */
    }
  }

  const clone = (v) => (v === undefined ? v : structuredClone(v));
  const coll = (name) => (db[name] ??= []);

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (memory || !file) return;
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
    renameSync(tmp, file);
  }
  function touch() {
    if (memory || !file) return;
    clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
    timer.unref?.();
  }
  if (!memory) process.on('exit', () => { try { flush(); } catch { /* ignore */ } });

  return {
    /** Newid helper, e.g. newId('servers') -> "srv_a1b2c3d4" */
    newId: (name) => `${PREFIX[name] ?? 'doc'}_${randomBytes(4).toString('hex')}`,
    all: (name) => clone(coll(name)),
    get: (name, id) => clone(coll(name).find((d) => d.id === id)),
    find: (name, pred) => clone(coll(name).filter(pred)),
    findOne: (name, pred) => clone(coll(name).find(pred)),
    insert(name, doc) {
      const row = { ...doc, id: doc.id ?? `${PREFIX[name] ?? 'doc'}_${randomBytes(4).toString('hex')}` };
      coll(name).push(row);
      touch();
      return clone(row);
    },
    update(name, id, patch) {
      const row = coll(name).find((d) => d.id === id);
      if (!row) return undefined;
      Object.assign(row, typeof patch === 'function' ? patch(row) : patch);
      touch();
      return clone(row);
    },
    remove(name, id) {
      const list = coll(name);
      const i = list.findIndex((d) => d.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      touch();
      return true;
    },
    meta: {
      get: (k) => db.meta[k],
      set(k, v) { db.meta[k] = v; touch(); },
    },
    flush,
  };
}
