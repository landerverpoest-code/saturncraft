// Where saved worlds live. One key-value store with a tiny interface so the world manager can run against IndexedDB in the
// browser and against an in-memory map in the tests (or when the browser has no IndexedDB, in which case nothing survives
// a reload and the title screen says so).
//
// A transaction callback receives { get, put, del, keys } (all promises) and may await them; the whole callback commits
// or aborts together, so a save that hits the storage quota leaves the old world untouched.
import { estimateBytes, quotaLevel } from './saveFormat.js';

const DB_NAME = 'saturncraft';
const STORE = 'worlds';

export class MemoryStorage {
  constructor({ quotaBytes = Infinity } = {}) {
    this.map = new Map();
    this.quotaBytes = quotaBytes;
    this.persistent = false;
    this.kind = 'memory';
  }

  usedBytes(extra = new Map(), gone = new Set()) {
    let n = 0;
    for (const [k, v] of this.map) if (!gone.has(k) && !extra.has(k)) n += estimateBytes(v);
    for (const v of extra.values()) n += estimateBytes(v);
    return n;
  }

  async txn(mode, fn) {
    const puts = new Map(), gone = new Set();
    const api = {
      get: async (k) => (puts.has(k) ? puts.get(k) : gone.has(k) ? null : this.map.has(k) ? this.map.get(k) : null),
      put: async (k, v) => { gone.delete(k); puts.set(k, v); },
      del: async (k) => { puts.delete(k); gone.add(k); },
      keys: async () => [...new Set([...this.map.keys(), ...puts.keys()])].filter((k) => !gone.has(k)),
    };
    const result = await fn(api);
    if (mode === 'readwrite') {
      if (puts.size && this.usedBytes(puts, gone) > this.quotaBytes) {
        const e = new Error('The storage quota was exceeded');
        e.name = 'QuotaExceededError';
        throw e;
      }
      for (const k of gone) this.map.delete(k);
      for (const [k, v] of puts) this.map.set(k, v);
    }
    return result;
  }

  async estimate() { return { usage: this.usedBytes(), quota: this.quotaBytes === Infinity ? 0 : this.quotaBytes }; }
}

export class IdbStorage {
  constructor() { this.persistent = true; this.kind = 'indexeddb'; }

  open() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('The world database is blocked by another tab'));
    });
  }

  async txn(mode, fn) {
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const s = t.objectStore(STORE);
        const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        const api = {
          get: async (k) => { const v = await req(s.get(k)); return v === undefined ? null : v; },
          put: (k, v) => { s.put(v, k); return Promise.resolve(); }, // errors surface through the transaction
          del: (k) => { s.delete(k); return Promise.resolve(); },
          keys: async () => (await req(s.getAllKeys())).map(String),
        };
        let result, failure = null, settled = false;
        const finish = (fnOk) => { if (!settled) { settled = true; fnOk(); } };
        t.oncomplete = () => finish(() => (failure ? reject(failure) : resolve(result)));
        t.onabort = () => finish(() => reject(failure || t.error || new Error('The world transaction was aborted')));
        t.onerror = () => { failure = failure || t.error; };
        Promise.resolve().then(() => fn(api)).then((r) => { result = r; }, (e) => { failure = e; try { t.abort(); } catch { /* already finished */ } });
      });
    } finally { db.close(); }
  }

  async estimate() { return browserEstimate(); }
}

/** { usage, quota } from the browser, or null. */
export async function browserEstimate() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage: usage || 0, quota: quota || 0 };
    }
  } catch { /* not available */ }
  return null;
}

let backend = null;
/** The store worlds are kept in: IndexedDB when the browser has it, otherwise memory. */
export function getStorage() {
  if (!backend) backend = typeof indexedDB !== 'undefined' ? new IdbStorage() : new MemoryStorage();
  return backend;
}
/** Swap the store (tests, or a fallback); null picks the default again. */
export function setStorage(b) { backend = b; }

/** { usage, quota, ratio, level } for the current store; level is 'ok' | 'warn' | 'critical' or null when unknown. */
export async function storageStatus(st = getStorage()) {
  const e = await st.estimate();
  if (!e) return null;
  return { usage: e.usage, quota: e.quota, ratio: e.quota > 0 ? e.usage / e.quota : 0, level: quotaLevel(e.usage, e.quota), persistent: st.persistent };
}
