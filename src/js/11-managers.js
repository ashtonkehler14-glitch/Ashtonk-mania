/* ScoreManager, ReplayManager, StatisticsManager, ProfileManager, CollectionManager, Favorites, DataManager. */

const ScoreManager = {
  scores: [],                // all, newest last
  byHash: new Map(),         // mapHash -> scores[]
  async init() {
    this.scores = (await DB.getAll('scores')).sort((a, b) => a.date - b.date);
    this._reindex();
  },
  _reindex() {
    this.byHash.clear();
    for (const s of this.scores) {
      if (!this.byHash.has(s.mapHash)) this.byHash.set(s.mapHash, []);
      this.byHash.get(s.mapHash).push(s);
    }
  },
  forMap(hash) { return (this.byHash.get(hash) || []).slice().sort((a, b) => b.score - a.score || b.accuracy - a.accuracy); },
  best(hash) { const l = this.forMap(hash).filter(s => s.passed); return l[0] || null; },
  playCount(hash) { return (this.byHash.get(hash) || []).length; },
  lastPlayed(hash) { const l = this.byHash.get(hash); return l && l.length ? l[l.length - 1].date : 0; },
  recent(n = 20) { return this.scores.slice(-n).reverse(); },
  async add(score) {
    const prev = this.best(score.mapHash);
    score.isPB = score.passed && (!prev || score.score > prev.score);
    score.prevBest = prev ? { score: prev.score, accuracy: prev.accuracy, grade: prev.grade } : null;
    await DB.put('scores', score);
    this.scores.push(score);
    this._reindex();
    Bus.emit('scores:changed');
    return score;
  },
  async remove(id) {
    await DB.del('scores', id);
    this.scores = this.scores.filter(s => s.id !== id); this._reindex(); Bus.emit('scores:changed');
  },
  async clear() { await DB.clear('scores'); this.scores = []; this._reindex(); Bus.emit('scores:changed'); },
};

const ReplayManager = {
  list: [],
  async init() { this.list = (await DB.getAll('replays')).sort((a, b) => b.date - a.date); },
  build({ map, mods, rate, seed, windows, accuracyMode, hp, keys, events, summary, scoreId, player, duration }) {
    return {
      app: APP_NAME, kind: 'replay', format: 1, id: 'rp-' + uid(), date: Date.now(),
      mapHash: map.hash, mapId: map.id, title: map.title, artist: map.artist, version: map.version, creator: map.creator,
      keys, mods, rate, seed, windows, accuracyMode, hp, player, duration,
      events, // flat [t, col, down, t, col, down, ...] in song ms
      summary: { score: summary.score, accuracy: summary.accuracy, maxCombo: summary.maxCombo, counts: summary.counts, grade: summary.grade },
      scoreId: scoreId || null,
    };
  },
  async save(rep) {
    await DB.put('replays', rep);
    this.list = [rep, ...this.list.filter(r => r.id !== rep.id)];
    if (rep.scoreId) {
      const s = ScoreManager.scores.find(x => x.id === rep.scoreId);
      if (s && s.replayId !== rep.id) { s.replayId = rep.id; await DB.put('scores', s); }
    }
    Bus.emit('replays:changed');
    return rep;
  },
  async get(id) { return DB.get('replays', id); },
  async remove(id) { await DB.del('replays', id); this.list = this.list.filter(r => r.id !== id); Bus.emit('replays:changed'); },
  async clear() { await DB.clear('replays'); this.list = []; Bus.emit('replays:changed'); },
  export(rep) { downloadJSON(rep, `${rep.artist} - ${rep.title} [${rep.version}] (${new Date(rep.date).toISOString().slice(0, 10)}).amr`.replace(/[\\/:*?"<>|]/g, '_')); },
  validate(obj) {
    if (!obj || obj.app !== APP_NAME || obj.kind !== 'replay' || !Array.isArray(obj.events) || obj.events.length % 3 !== 0) throw new Error('Not a valid Ashtonk!mania replay');
    if (!Array.isArray(obj.windows) || obj.windows.length !== 6) throw new Error('Replay is missing timing windows');
    return obj;
  },
  async importFile(f) { return this.importObject(JSON.parse(await f.text())); },
  async importObject(obj) { this.validate(obj); return this.save({ ...obj, imported: true }); },
};

const Favorites = {
  set: new Set(),
  async init() { this.set = new Set(await DB.kvGet('favorites', [])); },
  has(setId) { return this.set.has(setId); },
  async toggle(setId) {
    if (this.set.has(setId)) this.set.delete(setId); else this.set.add(setId);
    await DB.kvSet('favorites', [...this.set]);
    Bus.emit('favorites:changed', setId);
    return this.set.has(setId);
  },
};

const Collections = {
  list: [],
  async init() {
    this.list = await DB.kvGet('collections', null);
    if (!this.list) { this.list = [{ id: uid(), name: 'Practice', hashes: [], created: Date.now() }]; await this.save(); }
  },
  async save() { await DB.kvSet('collections', this.list); Bus.emit('collections:changed'); },
  async create(name) { const c = { id: uid(), name: name.trim() || 'New collection', hashes: [], created: Date.now() }; this.list.push(c); await this.save(); return c; },
  async rename(id, name) { const c = this.get(id); if (c) { c.name = name.trim() || c.name; await this.save(); } },
  async remove(id) { this.list = this.list.filter(c => c.id !== id); await this.save(); },
  get(id) { return this.list.find(c => c.id === id); },
  has(id, hash) { const c = this.get(id); return !!(c && c.hashes.includes(hash)); },
  async toggle(id, hash) {
    const c = this.get(id); if (!c) return;
    if (c.hashes.includes(hash)) c.hashes = c.hashes.filter(x => x !== hash); else c.hashes.push(hash);
    await this.save();
    return c.hashes.includes(hash);
  },
  containing(hash) { return this.list.filter(c => c.hashes.includes(hash)); },
};

const ProfileManager = {
  profile: null,
  async init() {
    this.profile = await DB.kvGet('profile', null);
    if (!this.profile) { this.profile = { name: 'Ashton', avatar: 'default', created: Date.now(), banner: 'kori' }; await this.save(); }
    await this.loadAvatar();
  },
  async save() { await DB.kvSet('profile', this.profile); Bus.emit('profile:changed'); },
  async setName(n) { this.profile.name = n.trim().slice(0, 24) || 'Ashton'; await this.save(); },
  async setAvatar(kind, blob) {
    this.profile.avatar = kind;
    if (kind === 'custom' && blob) { const t = await makeThumbnail(blob, 256); await DB.put('files', t || blob, 'profile/avatar'); }
    await this.save(); await this.loadAvatar();
  },
  avatarURL: null,
  async loadAvatar() {
    if (this.avatarURL && this.avatarURL.startsWith('blob:')) URL.revokeObjectURL(this.avatarURL);
    this.avatarURL = null;
    if (this.profile.avatar === 'custom') {
      const b = await DB.get('files', 'profile/avatar');
      if (b) this.avatarURL = URL.createObjectURL(b);
    }
  },
  /** Avatar element (custom image, Neru-inspired motif, or monogram). */
  avatarEl(size = 40) {
    const p = this.profile;
    const el = h('div.avatar', { style: { width: size + 'px', height: size + 'px' } });
    if (p.avatar === 'custom' && this.avatarURL) el.style.backgroundImage = `url("${this.avatarURL}")`;
    else if (p.avatar === 'neru') { el.classList.add('avatar-neru'); el.innerHTML = NERU_AVATAR_SVG; }
    else { el.classList.add('avatar-mono'); el.textContent = (p.name || 'A').slice(0, 1).toUpperCase(); el.style.fontSize = size * 0.45 + 'px'; }
    return el;
  },
  /** XP & level derived from local scores. */
  xpInfo() {
    let xp = 0;
    for (const s of ScoreManager.scores) {
      const hits = s.counts ? s.counts.slice(0, 5).reduce((a, b) => a + b, 0) : 0;
      xp += Math.round(hits * 0.5 + (s.passed ? 50 + s.accuracy * 100 * Math.max(1, s.stars || 1) : 10));
    }
    let level = 1, need = 500, acc = 0;
    while (xp >= acc + need) { acc += need; level++; need = Math.round(500 * Math.pow(level, 1.35)); }
    return { xp, level, into: xp - acc, need, progress: (xp - acc) / need };
  },
};

const NERU_AVATAR_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="nrg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe98a"/><stop offset="1" stop-color="#f2b705"/></linearGradient></defs>
<rect width="64" height="64" rx="32" fill="#1a1024"/><path d="M14 40c0-12 8-22 19-22s18 9 18 20c-4-5-9-8-15-8-8 0-15 4-22 10z" fill="url(#nrg)"/>
<path d="M49 22c6 2 10 8 9 16-3-4-6-6-10-7z" fill="url(#nrg)"/><circle cx="26" cy="42" r="2.3" fill="#2a1a3a"/><circle cx="38" cy="42" r="2.3" fill="#2a1a3a"/>
<rect x="40" y="46" width="8" height="12" rx="1.5" fill="#b07cff"/><rect x="41.5" y="48" width="5" height="6" rx="1" fill="#1a1024"/>
<path d="M52 12l1.4 3 3 1.4-3 1.4-1.4 3-1.4-3-3-1.4 3-1.4z" fill="#ffe98a"/></svg>`;

const StatisticsManager = {
  compute() {
    const sc = ScoreManager.scores;
    const passed = sc.filter(s => s.passed);
    const st = {
      plays: sc.length, passed: passed.length, failed: sc.filter(s => !s.passed).length,
      playtime: sc.reduce((a, s) => a + (s.duration || 0), 0),
      notes: sc.reduce((a, s) => a + (s.counts ? s.counts.slice(0, 5).reduce((x, y) => x + y, 0) : 0), 0),
      misses: sc.reduce((a, s) => a + (s.counts ? s.counts[5] : 0), 0),
      avgAcc: passed.length ? passed.reduce((a, s) => a + s.accuracy, 0) / passed.length : 0,
      highestScore: sc.reduce((a, s) => Math.max(a, s.score), 0),
      highestCombo: sc.reduce((a, s) => Math.max(a, s.maxCombo), 0),
      bestGrade: null, grades: {}, keyModes: {}, perDay: [], accTrend: [], judgements: [0, 0, 0, 0, 0, 0],
    };
    const order = ['XH', 'SS', 'SH', 'S', 'A', 'B', 'C', 'D', 'F'];
    for (const s of sc) {
      st.grades[s.grade] = (st.grades[s.grade] || 0) + 1;
      const k = st.keyModes[s.keys] || (st.keyModes[s.keys] = { plays: 0, passed: 0, accSum: 0, best: 0, playtime: 0 });
      k.plays++; k.playtime += s.duration || 0;
      if (s.passed) { k.passed++; k.accSum += s.accuracy; k.best = Math.max(k.best, s.score); }
      if (s.counts) s.counts.forEach((c, i) => st.judgements[i] += c);
    }
    for (const g of order) if (st.grades[g] && g !== 'F') { st.bestGrade = g; break; }
    const day = 86400000, today = Math.floor(Date.now() / day);
    for (let d = 29; d >= 0; d--) st.perDay.push({ day: today - d, plays: 0 });
    for (const s of sc) { const idx = Math.floor(s.date / day) - (today - 29); if (idx >= 0 && idx < 30) st.perDay[idx].plays++; }
    st.accTrend = passed.slice(-60).map(s => ({ date: s.date, acc: s.accuracy, title: s.title, version: s.version }));
    return st;
  },
};

const DataManager = {
  async exportAll() {
    const obj = {
      app: APP_NAME, kind: 'backup', version: APP_VERSION, date: Date.now(),
      settings: Settings.export(), profile: ProfileManager.profile, favorites: [...Favorites.set],
      collections: Collections.list, scores: await DB.getAll('scores'), replays: await DB.getAll('replays'),
      note: 'Beatmap and skin files are not included; re-import your .osz/.osk files after restoring.',
    };
    downloadJSON(obj, `ashtonk-mania-backup-${new Date().toISOString().slice(0, 10)}.json`);
  },
  exportSettings() {
    downloadJSON({ app: APP_NAME, kind: 'settings', version: APP_VERSION, date: Date.now(), settings: Settings.export() }, 'ashtonk-mania-settings.json');
  },
  async importAll(obj) {
    if (!obj || obj.app !== APP_NAME) throw new Error('Not an Ashtonk!mania data file');
    if (obj.settings) await Settings.import(obj.settings);
    if (obj.kind === 'settings') return;
    if (obj.profile) { ProfileManager.profile = { ...ProfileManager.profile, ...obj.profile }; await ProfileManager.save(); }
    if (Array.isArray(obj.favorites)) { for (const f of obj.favorites) Favorites.set.add(f); await DB.kvSet('favorites', [...Favorites.set]); }
    if (Array.isArray(obj.collections)) {
      for (const c of obj.collections) {
        const ex = Collections.list.find(x => x.id === c.id || x.name === c.name);
        if (ex) ex.hashes = [...new Set([...ex.hashes, ...(c.hashes || [])])]; else Collections.list.push(c);
      }
      await Collections.save();
    }
    if (Array.isArray(obj.scores)) await DB.putMany(obj.scores.filter(s => s && s.id).map(s => ({ store: 'scores', value: s })));
    if (Array.isArray(obj.replays)) await DB.putMany(obj.replays.filter(r => r && r.id).map(r => ({ store: 'replays', value: r })));
    await ScoreManager.init(); await ReplayManager.init();
    Bus.emit('scores:changed'); Bus.emit('replays:changed'); Bus.emit('favorites:changed');
  },
  async resetEverything() {
    DB.db && DB.db.close(); DB.db = null;
    await new Promise(r => { const q = indexedDB.deleteDatabase(DB.name); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    location.reload();
  },
};
