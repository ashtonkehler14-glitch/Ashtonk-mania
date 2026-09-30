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
  /** The score shown and compared: osu!lazer's standardised score when that's the chosen display (scores set
   *  before it existed keep their classic one), else the classic ScoreV1 score. Works on saved scores and live ones. */
  value(s) { return Settings.get('gameplay.scoring') === 'standardised' && s.scoreStd != null ? s.scoreStd : s.score; },
  forMap(hash) { return (this.byHash.get(hash) || []).slice().sort((a, b) => this.value(b) - this.value(a) || b.accuracy - a.accuracy); },
  best(hash) { const l = this.forMap(hash).filter(s => s.passed); return l[0] || null; },
  playCount(hash) { return (this.byHash.get(hash) || []).length; },
  lastPlayed(hash) { const l = this.byHash.get(hash); return l && l.length ? l[l.length - 1].date : 0; },
  recent(n = 20) { return this.scores.slice(-n).reverse(); },
  /** pp of a score (osu!mania formula). Older scores without stored pp are computed on demand. */
  ppOf(s) {
    if (!s || !s.passed || (s.mods || []).includes('AT')) return 0;
    if (typeof s.pp === 'number' && s.srVersion === SR_VERSION) return s.pp;
    const m = typeof BeatmapManager !== 'undefined' ? BeatmapManager.mapByHash(s.mapHash) : null;
    const stars = (s.rate || 1) === 1 && m && m.srVersion === SR_VERSION ? m.stars : (s.stars || 0);
    return OsuMath.pp(stars, s.counts || [0, 0, 0, 0, 0, 0], s.mods || []);
  },
  /** Best pp per beatmap (osu! counts one score per map toward the total). */
  bestPpPerMap(scores = this.scores) {
    const best = new Map();
    for (const s of scores) {
      const pp = this.ppOf(s);
      if (pp > 0 && (!best.has(s.mapHash) || best.get(s.mapHash).pp < pp)) best.set(s.mapHash, { pp, score: s });
    }
    return [...best.values()].sort((a, b) => b.pp - a.pp);
  },
  totalPp(scores = this.scores) { return OsuMath.totalPp(this.bestPpPerMap(scores).map(x => x.pp)); },
  /** Total pp after each play, for the profile/statistics history graph. */
  ppHistory() {
    const out = [], best = new Map();
    for (const s of this.scores) {
      const pp = this.ppOf(s);
      if (pp > (best.get(s.mapHash) || 0)) best.set(s.mapHash, pp);
      else if (!pp) continue;
      out.push({ date: s.date, pp: OsuMath.totalPp([...best.values()]).total, title: s.title, version: s.version });
    }
    return out;
  },
  async add(score) {
    const prev = this.best(score.mapHash);
    score.isPB = score.passed && (!prev || this.value(score) > this.value(prev));
    score.prevBest = prev ? { score: prev.score, scoreStd: prev.scoreStd, accuracy: prev.accuracy, grade: prev.grade, pp: this.ppOf(prev) } : null;
    score.totalPpBefore = this.totalPp().total;
    await DB.put('scores', score);
    this.scores.push(score);
    this._reindex();
    score.totalPpAfter = this.totalPp().total;
    await DB.put('scores', score);
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
  build({ map, mods, rate, seed, windows, accuracyMode, hp, keys, events, summary, scoreId, player, duration, modConfig = {}, noFail = false, rules = RULES }) {
    return {
      app: APP_NAME, kind: 'replay', format: 1, id: 'rp-' + uid(), date: Date.now(),
      mapHash: map.hash, mapId: map.id, title: map.title, artist: map.artist, version: map.version, creator: map.creator,
      keys, mods, rate, seed, windows, accuracyMode, hp, player, duration, modConfig, noFail,
      rules, // judging rules (see 09-gameplay.js); replays without it were recorded under rules 1
      events, // flat [t, col, down, t, col, down, ...] in song ms
      summary: { score: summary.score, scoreStd: summary.scoreStd, accuracy: summary.accuracy, maxCombo: summary.maxCombo, counts: summary.counts, grade: summary.grade },
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

/** Per-beatmap offset (osu!lazer's "beatmap offset"), added to the global audio offset for one difficulty.
 *  Positive = you hit late on this map (its notes arrive later). */
const MapOffsets = {
  map: {},
  last: null, // { hash, mean, hits } — the most recent finished play, for "calibrate using last play"
  async init() { const m = await DB.kvGet('map.offsets', {}); this.map = m && typeof m === 'object' ? m : {}; },
  get(hash) { return (hash && this.map[hash]) || 0; },
  async set(hash, ms) {
    if (!hash) return;
    ms = clamp(Math.round(ms), -300, 300);
    if (ms) this.map[hash] = ms; else delete this.map[hash];
    Bus.emit('mapoffset:changed', hash, ms);
    await DB.kvSet('map.offsets', this.map);
  },
  /** The offset change the last play on `hash` suggests (its mean hit error), or null if there isn't enough data. */
  suggestion(hash) {
    const l = this.last;
    if (!l || l.hash !== hash || l.hits < 30 || Math.abs(l.mean) < 2) return null;
    return Math.round(l.mean);
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
    if (!this.profile) { this.profile = { name: 'Player', avatar: 'default', created: Date.now(), banner: 'kori', onboarded: false }; await this.save(); }
    await this.loadAvatar();
  },
  async save() { await DB.kvSet('profile', this.profile); Bus.emit('profile:changed'); },
  async setName(n) { this.profile.name = n.trim().slice(0, 24) || 'Player'; await this.save(); },
  async setAvatar(kind, blob) {
    this.profile.avatar = kind;
    if (kind === 'custom' && blob) { const t = await makeThumbnail(blob, 256); await DB.put('files', t || blob, 'profile/avatar'); }
    await this.loadAvatar(); await this.save();
  },
  avatarURL: null,
  async loadAvatar() {
    if (this.avatarURL && this.avatarURL.startsWith('blob:')) URL.revokeObjectURL(this.avatarURL);
    this.avatarURL = null;
    const a = this.profile.avatar || 'default';
    if (a === 'custom') {
      const b = await DB.get('files', 'profile/avatar');
      if (b) this.avatarURL = URL.createObjectURL(b);
    } else if (a.startsWith('preset:')) this.avatarURL = AvatarPresets.url(a.slice(7));
    else if (a.startsWith('file:')) this.avatarURL = 'avatars/' + encodeURIComponent(a.slice(5));
    this.sharedAvatar = await this.makeSharedAvatar().catch(() => '');
  },
  /** What other players see: the preset / public picture's id, or a small copy of an uploaded picture (64 px). */
  sharedAvatar: '',
  async makeSharedAvatar() {
    const a = this.profile.avatar || 'default';
    if (a.startsWith('preset:') || a.startsWith('file:')) return a;
    if (a !== 'custom' || !this.avatarURL) return '';
    const img = new Image(); img.src = this.avatarURL; await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), sz = Math.min(img.naturalWidth, img.naturalHeight);
    x.drawImage(img, (img.naturalWidth - sz) / 2, (img.naturalHeight - sz) / 2, sz, sz, 0, 0, 64, 64);
    return c.toDataURL('image/jpeg', 0.8);
  },
  /** Avatar element (custom image or monogram). */
  avatarEl(size = 40) {
    const p = this.profile;
    const el = h('div.avatar', { style: { width: size + 'px', height: size + 'px' } });
    if (p.avatar !== 'default' && this.avatarURL) el.style.backgroundImage = `url("${this.avatarURL}")`;
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
