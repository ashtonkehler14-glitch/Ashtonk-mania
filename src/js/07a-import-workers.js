/* Installing beatmaps on the other cores: each difficulty is parsed, checked and star-rated in a background thread —
 * the game's own code (IMPORT_WORKER_SRC, put in the page by build.mjs) — several at once, so a set goes in quicker
 * and the game keeps every frame while it does. Where workers can't run (an old browser, the page opened as a file)
 * it's done on the page instead, a step at a time (BeatmapManager.breathe). */
const ImportWorkers = {
  pool: null, broken: false, seq: 0, waiting: new Map(),
  /** A difficulty still not read this long after its thread started on it has hung that thread (a broken file): it's
   *  given up on and the thread replaced, so the import goes on instead of waiting for ever. (A long beatmap takes a
   *  few seconds at most; each thread reads its difficulties one after another, and only the one it's on is timed.) */
  TIMEOUT: 60000,
  start() {
    if (this.pool || this.broken) return this.pool;
    try {
      if (typeof Worker === 'undefined' || typeof IMPORT_WORKER_SRC === 'undefined') throw new Error('no workers here');
      this._url = URL.createObjectURL(new Blob([IMPORT_WORKER_SRC], { type: 'text/javascript' }));
      const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
      this.pool = Array.from({ length: n }, () => this.make());
    } catch (e) { this.broken = true; this.pool = null; }
    return this.pool;
  },
  make() {
    const w = new Worker(this._url);
    w.queue = []; // (the ids it has, in the order it reads them)
    w.onmessage = e => this.done(e.data);
    w.onerror = e => { e.preventDefault && e.preventDefault(); this.fail(); };
    return w;
  },
  /** One difficulty's library info (inspectBeatmap) from its text, worked out in a background thread; null when there's
   *  no worker to do it (the caller does it itself). A difficulty that can't be read rejects, as parsing it would. */
  inspect(text, available) {
    const pool = this.start();
    if (!pool) return Promise.resolve(null);
    const w = pool.reduce((a, b) => a.queue.length <= b.queue.length ? a : b), id = ++this.seq, msg = { id, text, available };
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, w, msg, timer: 0 });
      this.send(w, id);
    });
  },
  send(w, id) {
    w.queue.push(id); w.postMessage(this.waiting.get(id).msg);
    if (w.queue.length === 1) this.arm(id);
  },
  arm(id) { const p = this.waiting.get(id); if (p) p.timer = setTimeout(() => this.stuck(id), this.TIMEOUT); },
  done(m) {
    const p = this.waiting.get(m.id);
    if (!p) return;
    this.waiting.delete(m.id); clearTimeout(p.timer);
    const q = p.w.queue, i = q.indexOf(m.id);
    if (i >= 0) q.splice(i, 1);
    if (i === 0 && q.length) this.arm(q[0]); // (the next one it starts on)
    if (m.ok) p.resolve(m.info);
    else p.reject(m.beatmapError ? new BeatmapError(m.error) : new Error(m.error));
  },
  /** A difficulty its thread never finished: that one can't be read; the thread is replaced, and the others it had go
   *  to the new one. */
  stuck(id) {
    const p = this.waiting.get(id);
    if (!p || !this.pool) return;
    const old = p.w, at = this.pool.indexOf(old);
    this.waiting.delete(id);
    p.reject(new BeatmapError('This difficulty took too long to read (the file may be damaged)'));
    try { old.terminate(); } catch { /* gone */ }
    if (at < 0) return;
    const w = this.pool[at] = this.make();
    for (const rest of old.queue) if (rest !== id && this.waiting.has(rest)) { this.waiting.get(rest).w = w; this.send(w, rest); }
    old.queue = [];
  },
  /** A worker that couldn't run its code: none from now on — what was waiting on them is done on the page. */
  fail() {
    this.broken = true;
    for (const w of this.pool || []) try { w.terminate(); } catch { /* gone */ }
    this.pool = null;
    for (const p of this.waiting.values()) { clearTimeout(p.timer); p.resolve(null); }
    this.waiting.clear();
  },
};
