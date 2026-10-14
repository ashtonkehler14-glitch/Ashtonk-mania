/* Installing beatmaps on the other cores: each difficulty is parsed, checked and star-rated in a background thread —
 * the game's own code (IMPORT_WORKER_SRC, put in the page by build.mjs) — several at once, so a set goes in quicker
 * and the game keeps every frame while it does. Where workers can't run (an old browser, the page opened as a file)
 * it's done on the page instead, a step at a time (BeatmapManager.breathe). */
const ImportWorkers = {
  pool: null, broken: false, seq: 0, waiting: new Map(),
  start() {
    if (this.pool || this.broken) return this.pool;
    try {
      if (typeof Worker === 'undefined' || typeof IMPORT_WORKER_SRC === 'undefined') throw new Error('no workers here');
      const url = URL.createObjectURL(new Blob([IMPORT_WORKER_SRC], { type: 'text/javascript' }));
      const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
      this.pool = Array.from({ length: n }, () => {
        const w = new Worker(url);
        w.busy = 0;
        w.onmessage = e => this.done(e.data);
        w.onerror = e => { e.preventDefault && e.preventDefault(); this.fail(); };
        return w;
      });
    } catch (e) { this.broken = true; this.pool = null; }
    return this.pool;
  },
  /** One difficulty's library info (inspectBeatmap) from its text, worked out in a background thread; null when there's
   *  no worker to do it (the caller does it itself). A difficulty that can't be read rejects, as parsing it would. */
  inspect(text, available) {
    const pool = this.start();
    if (!pool) return Promise.resolve(null);
    const w = pool.reduce((a, b) => a.busy <= b.busy ? a : b), id = ++this.seq;
    w.busy++;
    return new Promise((resolve, reject) => { this.waiting.set(id, { resolve, reject, w }); w.postMessage({ id, text, available }); });
  },
  done(m) {
    const p = this.waiting.get(m.id);
    if (!p) return;
    this.waiting.delete(m.id); p.w.busy--;
    if (m.ok) p.resolve(m.info);
    else p.reject(m.beatmapError ? new BeatmapError(m.error) : new Error(m.error));
  },
  /** A worker that couldn't run its code: none from now on — what was waiting on them is done on the page. */
  fail() {
    this.broken = true;
    for (const w of this.pool || []) try { w.terminate(); } catch { /* gone */ }
    this.pool = null;
    for (const p of this.waiting.values()) p.resolve(null);
    this.waiting.clear();
  },
};
