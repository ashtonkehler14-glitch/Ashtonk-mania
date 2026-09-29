/* BeatmapDatabase / persistent storage — IndexedDB wrapper.
 * Stores:
 *   sets      beatmap sets (metadata + list of difficulty ids)
 *   maps      difficulties (metadata, stats, star rating, hash)
 *   files     binary blobs keyed "<owner>/<path>" (beatmap audio/bg/samples, skin assets)
 *   scores    every finished play (passed or failed)
 *   replays   saved replays
 *   skins     installed skins (parsed skin.ini + asset index)
 *   kv        settings, profile, favorites, collections, misc  */

const DB = {
  name: 'ashtonk-mania',
  version: 1,
  db: null,

  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
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
        this.db = req.result;
        this.db.onversionchange = () => { this.db.close(); this.db = null; };
        resolve(this.db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn('IndexedDB upgrade blocked by another tab');
    });
  },

  _req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  _store(name, mode = 'readonly') { return this.db.transaction(name, mode).objectStore(name); },

  async get(store, key) { await this.open(); return this._req(this._store(store).get(key)); },
  async getAll(store) { await this.open(); return this._req(this._store(store).getAll()); },
  async getAllKeys(store) { await this.open(); return this._req(this._store(store).getAllKeys()); },
  async byIndex(store, index, value) { await this.open(); return this._req(this._store(store).index(index).getAll(value)); },
  async put(store, value, key) { await this.open(); return this._req(key === undefined ? this._store(store, 'readwrite').put(value) : this._store(store, 'readwrite').put(value, key)); },
  async del(store, key) { await this.open(); return this._req(this._store(store, 'readwrite').delete(key)); },
  async clear(store) { await this.open(); return this._req(this._store(store, 'readwrite').clear()); },

  /** Put many records in one transaction. items: [{store, value, key?}] */
  async putMany(items) {
    await this.open();
    const stores = [...new Set(items.map(i => i.store))];
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, 'readwrite');
      for (const it of items) {
        const s = tx.objectStore(it.store);
        if (it.key === undefined) s.put(it.value); else s.put(it.value, it.key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted (storage quota?)'));
    });
  },

  /** Delete every key in `store` that starts with prefix (used for per-set / per-skin file blobs). */
  async delPrefix(store, prefix) {
    await this.open();
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    return this._req(this._store(store, 'readwrite').delete(range));
  },
  async keysWithPrefix(store, prefix) {
    await this.open();
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    return this._req(this._store(store).getAllKeys(range));
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
