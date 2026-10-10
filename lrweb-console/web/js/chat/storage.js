// Key/value storage for the LRChat client. Values must be structured-cloneable.
// Two implementations with the same interface: an in-memory one (tests, previews) and IndexedDB (browser).
// Storage = { get(key), set(key, value), delete(key), keys(prefix) }, all async.

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

/** Map-backed storage. Values are cloned on the way in and out so callers cannot mutate stored state. */
export function memoryStorage() {
  const map = new Map();
  return {
    async get(key) {
      return clone(map.get(key));
    },
    async set(key, value) {
      map.set(key, clone(value));
    },
    async delete(key) {
      map.delete(key);
    },
    async keys(prefix = '') {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted', 'AbortError'));
});

/** IndexedDB-backed storage: one database, one object store named 'kv'. */
export function idbStorage(dbName = 'lrchat') {
  let dbPromise = null;
  const db = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName, 1);
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => { dbPromise = null; reject(open.error); };
        open.onblocked = () => { dbPromise = null; reject(new DOMException('Database blocked', 'InvalidStateError')); };
      });
    }
    return dbPromise;
  };
  const store = async (mode) => (await db()).transaction('kv', mode).objectStore('kv');

  return {
    async get(key) {
      const s = await store('readonly');
      return req2p(s.get(key));
    },
    async set(key, value) {
      const tx = (await db()).transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      await txDone(tx);
    },
    async delete(key) {
      const tx = (await db()).transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      await txDone(tx);
    },
    async keys(prefix = '') {
      const s = await store('readonly');
      // '￿' sorts after every realistic key character, so [prefix, prefix+'￿'] covers the prefix.
      const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
      return (await req2p(s.getAllKeys(range))).map(String).sort();
    },
  };
}
