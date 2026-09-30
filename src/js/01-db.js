/* BeatmapDatabase / persistent storage — IndexedDB wrapper.
 * Stores:
 *   sets      beatmap sets (metadata + list of difficulty ids)
 *   maps      difficulties (metadata, stats, star rating, hash)
 *   files     binary blobs keyed "<owner>/<path>" (beatmap audio/bg/samples, skin assets)
 *   scores    every finished play (passed or failed)
 *   replays   saved replays
 *   skins     installed skins (parsed skin.ini + asset index)
 *   kv        settings, profile, favorites, collections, misc  */

/** Key paths of the stores that key their records by `id` (the rest take explicit keys). */
const DB_KEYPATH = { sets: 'id', maps: 'id', scores: 'id', replays: 'id', skins: 'id' };

/** In-memory stand-in used when IndexedDB can't be opened (storage blocked, some private windows):
 *  everything still works for the session, nothing is saved. Records are copied like IndexedDB does. */
const MemoryDB = {
  stores: new Map(),
  s(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); },
  copy(v) { try { return typeof structuredClone === 'function' ? structuredClone(v) : v; } catch (e) { return v; } },
  keyOf(store, value, key) { return key !== undefined ? key : value[DB_KEYPATH[store]]; },
  sortedKeys(m) { return [...m.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); },
  withPrefix(m, prefix) { return this.sortedKeys(m).filter(k => typeof k === 'string' && k.startsWith(prefix)); },
};

const DB = {
  name: 'ashtonk-mania',
  version: 1,
  db: null,
  /** Set (to the reason) when IndexedDB is unavailable and data only lives in memory for this session. */
  memory: null,
  _opening: null,

  open() {
    if (this.db || this.memory) return Promise.resolve(this.db);
    if (this._opening) return this._opening;
    const fallback = (why) => {
      console.warn('IndexedDB unavailable, keeping data in memory:', why);
      this.memory = (why && why.message) || String(why || 'unavailable');
      return null;
    };
    return (this._opening = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(this.name, this.version); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sets')) db.createObjectStore('sets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('maps')) {
          const s = db.createObjectStore('maps', { keyPath: 'id' });
          s.createIndex('setId', 'setId'); s.createIndex('hash', 'hash');
        }
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        if (!db.objectStoreNames.contains('scores')) {
          const s = db.createObjectStore('scores', { keyPath: 'id' });
          s.createIndex('mapHash', 'mapHash'); s.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('replays')) {
          const s = db.createObjectStore('replays', { keyPath: 'id' });
          s.createIndex('mapHash', 'mapHash');
        }
        if (!db.objectStoreNames.contains('skins')) db.createObjectStore('skins', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => {
        const db = req.result;
        this.db = db;
        // another tab upgrading, or the browser closing the connection (e.g. storage cleared): reopen on next use
        db.onversionchange = () => { db.close(); if (this.db === db) this.db = null; };
        db.onclose = () => { if (this.db === db) this.db = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn('IndexedDB upgrade blocked by another tab');
    }).then(db => db, e => (this.db ? this.db : fallback(e))).finally(() => { this._opening = null; }));
  },

  _req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  /** A transaction, reopening the database once if the browser closed the connection in the meantime. */
  async _tx(names, mode = 'readonly') {
    await this.open();
    try { return this.db.transaction(names, mode); }
    catch (e) {
      if (e.name !== 'InvalidStateError' || !this.db) throw e;
      this.db = null; await this.open();
      return this.db.transaction(names, mode);
    }
  },
  async _store(name, mode) { return (await this._tx(name, mode)).objectStore(name); },
  async _mem() { await this.open(); return this.memory ? MemoryDB : null; },

  async get(store, key) {
    const M = await this._mem(); if (M) return M.copy(M.s(store).get(key));
    return this._req((await this._store(store)).get(key));
  },
  async getAll(store) {
    const M = await this._mem(); if (M) { const m = M.s(store); return M.sortedKeys(m).map(k => M.copy(m.get(k))); }
    return this._req((await this._store(store)).getAll());
  },
  async getAllKeys(store) {
    const M = await this._mem(); if (M) return M.sortedKeys(M.s(store));
    return this._req((await this._store(store)).getAllKeys());
  },
  async byIndex(store, index, value) {
    const M = await this._mem(); if (M) return [...M.s(store).values()].filter(v => v && v[index] === value).map(v => M.copy(v));
    return this._req((await this._store(store)).index(index).getAll(value));
  },
  async put(store, value, key) {
    const M = await this._mem(); if (M) { const k = M.keyOf(store, value, key); M.s(store).set(k, M.copy(value)); return k; }
    const s = await this._store(store, 'readwrite');
    return this._req(key === undefined ? s.put(value) : s.put(value, key));
  },
  async del(store, key) {
    const M = await this._mem(); if (M) { M.s(store).delete(key); return; }
    return this._req((await this._store(store, 'readwrite')).delete(key));
  },
  async clear(store) {
    const M = await this._mem(); if (M) { M.s(store).clear(); return; }
    return this._req((await this._store(store, 'readwrite')).clear());
  },

  /** Put many records in one transaction. items: [{store, value, key?}] */
  async putMany(items) {
    const M = await this._mem();
    if (M) { for (const it of items) M.s(it.store).set(M.keyOf(it.store, it.value, it.key), M.copy(it.value)); return; }
    const stores = [...new Set(items.map(i => i.store))];
    const tx = await this._tx(stores, 'readwrite');
    return new Promise((resolve, reject) => {
      for (const it of items) {
        const s = tx.objectStore(it.store);
        if (it.key === undefined) s.put(it.value); else s.put(it.value, it.key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted (storage full?)', 'QuotaExceededError'));
    });
  },

  /** Delete every key in `store` that starts with prefix (used for per-set / per-skin file blobs). */
  async delPrefix(store, prefix) {
    const M = await this._mem(); if (M) { const m = M.s(store); for (const k of M.withPrefix(m, prefix)) m.delete(k); return; }
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
    return this._req((await this._store(store, 'readwrite')).delete(range));
  },
  async keysWithPrefix(store, prefix) {
    const M = await this._mem(); if (M) return M.withPrefix(M.s(store), prefix);
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
    return this._req((await this._store(store)).getAllKeys(range));
  },

  async kvGet(key, fallback) { const v = await this.get('kv', key); return v === undefined ? fallback : v; },
  kvSet(key, value) { return this.put('kv', value, key); },

  async estimate() {
    if (navigator.storage && navigator.storage.estimate) {
      try { return await navigator.storage.estimate(); } catch (e) { /* ignore */ }
    }
    return null;
  },
  async persist() {
    if (navigator.storage && navigator.storage.persist) {
      try { return await navigator.storage.persist(); } catch (e) { /* ignore */ }
    }
    return false;
  },
};
