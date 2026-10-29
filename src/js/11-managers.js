/* ScoreManager, ReplayManager, StatisticsManager, ProfileManager, CollectionManager, Favorites, DataManager. */

const ScoreManager = {
  scores: [],                // all, newest last — without HEAVY
  byHash: new Map(),         // mapHash -> scores[]
  /** What a play keeps apart, read only when its results show: the hit-by-hit timing and the health over time — in
   *  storage of its own (kv `timing/<id>`), not with the play. Read with every play, they took hundreds of KB of
   *  memory each (a long-time player's thousands of plays: enough to close the tab on a phone), and reading them at
   *  every start took seconds on a Chromebook. */
  HEAVY: ['hitErrors', 'healthTimeline'],
  light(s) { const { hitErrors, healthTimeline, ...rest } = s; return rest; },
  timingKey: id => `timing/${id}`,
  /** A play as stored: the play itself, and its HEAVY parts (if it has them) kept apart. */
  stored(s) {
    const items = [{ store: 'scores', value: this.light(s) }];
    if (s.hitErrors || s.healthTimeline) items.push({ store: 'kv', key: this.timingKey(s.id), value: { hitErrors: s.hitErrors || null, healthTimeline: s.healthTimeline || null } });
    return items;
  },
  async init() {
    const list = [], old = [];
    await DB.each('scores', s => { if (s.hitErrors || s.healthTimeline) old.push(s.id); list.push(this.light(s)); });
    this.scores = list.sort((a, b) => a.date - b.date);
    this._reindex();
    // (plays stored with their timing, as before: it's moved apart once, in the background — once the game has
    // started, not competing with it)
    if (old.length) setTimeout(() => whenIdle(() => this.moveTiming(old).catch(e => console.warn('timing not moved', e))), 20000);
  },
  async moveTiming(ids) {
    for (let i = 0; i < ids.length; i += 10) {
      // (a few at a time between frames — each is a lot to read and write — and never during a song)
      while (typeof Screens !== 'undefined' && Screens.currentName === 'gameplay') await sleep(2000);
      const got = await DB.getMany('scores', ids.slice(i, i + 10)), here = new Set(this.scores.map(s => s.id));
      // (not one deleted meanwhile: written back, it would be there again)
      const part = got.filter(s => s && (s.hitErrors || s.healthTimeline) && here.has(s.id));
      if (part.length) await DB.putMany(part.flatMap(s => this.stored(s)));
      await new Promise(r => whenIdle(r));
    }
  },
  /** A play's HEAVY parts, as stored (null when it has none: played before they were kept, or on another device). */
  async heavy(s) {
    if (!s || !s.id || this.HEAVY.some(k => k in s)) return null;
    const t = await DB.kvGet(this.timingKey(s.id), null).catch(() => null) || await DB.get('scores', s.id).catch(() => null); // (not moved apart yet)
    return t && t.hitErrors ? { hitErrors: t.hitErrors, healthTimeline: t.healthTimeline } : null;
  },
  /** Plays from here written back (renamed, a replay linked to one): what's stored of them, with these changes. */
  async putBack(list) {
    for (let i = 0; i < list.length; i += 100) {
      const part = list.slice(i, i + 100), stored = await DB.getMany('scores', part.map(s => s.id));
      await DB.putMany(part.flatMap((s, j) => this.stored(stored[j] ? { ...stored[j], ...s } : s)));
    }
  },
  _reindex() {
    this.byHash.clear();
    for (const s of this.scores) {
      if (!this.byHash.has(s.mapHash)) this.byHash.set(s.mapHash, []);
      this.byHash.get(s.mapHash).push(s);
    }
  },
  /** The score shown and compared: osu!lazer's standardised score (scores saved before it was recorded keep their
   *  classic ScoreV1 score). Works on saved scores and live ones. */
  value(s) { return s.scoreStd != null ? s.scoreStd : s.score; },
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
  /** As in osu!, only plays on ranked (or approved) beatmaps count toward your pp — loved, qualified, pending and
   *  graveyard ones, and beatmaps that aren't online, don't. The status the set had when the score was set, else
   *  the one looked up for it now. */
  isRanked(s) {
    let st = s && s.status;
    if (!st && typeof BeatmapManager !== 'undefined') { const m = BeatmapManager.mapByHash(s.mapHash), set = m && BeatmapManager.setById.get(m.setId); st = set && set.status; }
    st = String(st || '').toLowerCase();
    return st === 'ranked' || st === 'approved';
  },
  /** Best pp per beatmap (osu! counts one score per map toward the total; ranked beatmaps only). Scores from an imported
   *  backup are left out unless asked for (`imported`): they can't count on the rankings — there's no replay of them for
   *  the server to judge — so your total here is the one the rankings have for you. */
  bestPpPerMap(scores = this.scores, { imported = false } = {}) {
    const best = new Map();
    for (const s of scores) {
      if (!this.isRanked(s) || (!imported && s.imported)) continue;
      const pp = this.ppOf(s);
      if (pp > 0 && (!best.has(s.mapHash) || best.get(s.mapHash).pp < pp)) best.set(s.mapHash, { pp, score: s });
    }
    return [...best.values()].sort((a, b) => b.pp - a.pp);
  },
  totalPp(scores = this.scores) { return OsuMath.totalPp(this.bestPpPerMap(scores).map(x => x.pp)); },
  /** Your best plays from imported backups (Web-Osu-Mania's, or an Ashtonk!mania backup) that would give pp. */
  importedBest() { return this.bestPpPerMap(this.scores.filter(s => s.imported), { imported: true }); },
  async add(score) {
    const prev = this.best(score.mapHash);
    score.isPB = score.passed && (!prev || this.value(score) > this.value(prev));
    score.prevBest = prev ? { score: prev.score, scoreStd: prev.scoreStd, accuracy: prev.accuracy, grade: prev.grade, pp: this.ppOf(prev) } : null;
    score.totalPpBefore = this.totalPp().total;
    await DB.putMany(this.stored(score));
    // (kept here without its HEAVY parts — the results showing it have them)
    const lite = this.light(score);
    this.scores.push(lite);
    this._reindex();
    score.totalPpAfter = lite.totalPpAfter = this.totalPp().total;
    await DB.put('scores', this.light(score));
    Bus.emit('scores:changed');
    return score;
  },
  /** Your plays from your other devices (Sync.pullScores): each once, without a replay or the hit-by-hit timing (they
   *  stay on the device it was played on). Resolves to how many were new here. */
  /** A play as it can be taken in (from your other devices, a backup): an id, its beatmap, its judgement counts, when,
   *  and what it scored — a damaged one would put NaN into your stats or break your profile. */
  valid(x) {
    const num = v => typeof v === 'number' && Number.isFinite(v);
    return !!x && typeof x === 'object' && typeof x.id === 'string' && !!x.id && typeof x.mapHash === 'string' && Array.isArray(x.counts) && x.counts.every(num)
      && num(x.date) && num(x.accuracy) && num(x.score);
  },
  async addSynced(list) {
    const have = new Set(this.scores.map(s => s.id)), add = [];
    for (const x of list) {
      if (!this.valid(x) || have.has(x.id)) continue;
      const m = typeof BeatmapManager !== 'undefined' ? BeatmapManager.mapByHash(x.mapHash) : null;
      add.push({ ...x, own: true, synced: true, replayId: null, mapId: m ? m.id : null, setId: m ? m.setId : null });
      have.add(x.id);
    }
    if (!add.length) return 0;
    await DB.putMany(add.map(value => ({ store: 'scores', value })));
    this.scores.push(...add);
    this.scores.sort((a, b) => a.date - b.date);
    this._reindex();
    Bus.emit('scores:changed');
    return add.length;
  },
  /** lazer's "Clear local scores": every score on one difficulty, gone. */
  async clearMap(hash) {
    const gone = this.scores.filter(s => s.mapHash === hash);
    for (const s of gone) { await DB.del('scores', s.id); await DB.del('kv', this.timingKey(s.id)); }
    this.scores = this.scores.filter(s => s.mapHash !== hash); this._reindex(); Bus.emit('scores:changed');
    return gone.length;
  },
  async remove(id) {
    await DB.del('scores', id); await DB.del('kv', this.timingKey(id));
    this.scores = this.scores.filter(s => s.id !== id); this._reindex(); Bus.emit('scores:changed');
  },
  async clear() { await DB.clear('scores'); await DB.delPrefix('kv', this.timingKey('')); this.scores = []; this._reindex(); Bus.emit('scores:changed'); },
};

const ReplayManager = {
  list: [],                  // newest first — without their key presses (read when one's watched or exported: get)
  light(r) { const { events, ...rest } = r; return rest; },
  async init() {
    const list = [];
    await DB.each('replays', r => list.push(this.light(r)));
    this.list = list.sort((a, b) => b.date - a.date);
  },
  build({ map, mods, rate, seed, windows, accuracyMode, hp, keys, events, summary, scoreId, player, own, duration, modConfig = {}, noFail = false, rules = RULES }) {
    return {
      app: APP_NAME, kind: 'replay', format: 1, id: 'rp-' + uid(), date: Date.now(),
      mapHash: map.hash, mapId: map.id, title: map.title, artist: map.artist, version: map.version, creator: map.creator,
      keys, mods, rate, seed, windows, accuracyMode, hp, player, own: !!own, duration, modConfig, noFail,
      rules, // judging rules (see 09-gameplay.js); replays without it were recorded under rules 1
      events, // flat [t, col, down, t, col, down, ...] in song ms
      summary: { score: summary.score, scoreStd: summary.scoreStd, accuracy: summary.accuracy, maxCombo: summary.maxCombo, counts: summary.counts, grade: summary.grade },
      scoreId: scoreId || null,
    };
  },
  async save(rep) {
    await DB.put('replays', rep);
    this.list = [this.light(rep), ...this.list.filter(r => r.id !== rep.id)];
    if (rep.scoreId) {
      const s = ScoreManager.scores.find(x => x.id === rep.scoreId);
      if (s && s.replayId !== rep.id) { s.replayId = rep.id; await ScoreManager.putBack([s]); }
    }
    Bus.emit('replays:changed');
    return rep;
  },
  async get(id) { return DB.get('replays', id); },
  async remove(id) { await DB.del('replays', id); this.list = this.list.filter(r => r.id !== id); Bus.emit('replays:changed'); },
  async clear() { await DB.clear('replays'); this.list = []; Bus.emit('replays:changed'); },
  export(rep) { downloadJSON(rep, `${rep.artist} - ${rep.title} [${rep.version}] (${new Date(rep.date).toISOString().slice(0, 10)}).amr`.replace(/[\\/:*?"<>|]/g, '_')); },
  /** A replay that can be watched (from a file or a backup). */
  ok(obj) { try { this.validate(obj); return !!obj.id; } catch { return false; } },
  validate(obj) {
    if (!obj || obj.app !== APP_NAME || obj.kind !== 'replay' || !Array.isArray(obj.events) || obj.events.length % 3 !== 0) throw new Error('Not a valid Ashtonk!mania replay');
    if (!Array.isArray(obj.windows) || obj.windows.length !== 6) throw new Error('Replay is missing timing windows');
    return obj;
  },
  async importFile(f) {
    let obj;
    try { obj = JSON.parse(await f.text()); } catch { throw new Error('Not a valid Ashtonk!mania replay'); } // (damaged, or not one at all)
    return this.importObject(obj);
  },
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
  /** Favourites from your other device (Sync.restore) added to these — a set's id is the same on every device (made
   *  from its osu! id, or its artist, title and mapper), so one not here yet is a favourite once it's imported.
   *  Resolves to how many were new. */
  async merge(list) {
    let n = 0;
    for (const id of list) if (typeof id === 'string' && /^set-[0-9a-f]{16}$/.test(id) && !this.set.has(id)) { this.set.add(id); n++; }
    if (n) { await DB.kvSet('favorites', [...this.set]); Bus.emit('favorites:changed'); }
    return n;
  },
  /** Your favourites as your other devices left them (Sync.pull): these in place of the ones here. */
  async replaceAll(list) {
    const next = new Set(list.filter(id => typeof id === 'string' && /^set-[0-9a-f]{16}$/.test(id)));
    if (next.size === this.set.size && [...next].every(id => this.set.has(id))) return 0;
    this.set = next; await DB.kvSet('favorites', [...this.set]); Bus.emit('favorites:changed');
    return 1;
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
  /** Your offsets as your other devices have them (Sync): in place of these (`replace`), or added to them. */
  async applyKept(obj, replace = false) {
    const clean = {};
    for (const [h, v] of Object.entries(obj || {})) if (typeof h === 'string' && h.length <= 64 && Number.isFinite(+v) && +v) clean[h] = clamp(Math.round(+v), -300, 300);
    const next = replace ? clean : { ...clean, ...this.map };
    if (JSON.stringify(next) === JSON.stringify(this.map)) return;
    this.map = next;
    await DB.kvSet('map.offsets', this.map);
    Bus.emit('mapoffset:changed', null, 0);
  },
  /** The offset change the last play on `hash` suggests (its mean hit error), or null if there isn't enough data. */
  suggestion(hash, { sure = false } = {}) {
    const l = this.last;
    if (!l || l.hash !== hash || l.hits < 30 || Math.abs(l.mean) < 2) return null;
    // `sure` (the results screen's nudge): only an offset the play really shows — at least 5 ms, and well beyond what
    // the scatter of the hits alone would give (twice the mean's standard error): a 2 ms "late" on a play with a wide
    // spread is just noise, and following it moves the offset back and forth
    if (sure && (Math.abs(l.mean) < 5 || (l.sd && Math.abs(l.mean) < 2 * l.sd / Math.sqrt(l.hits)))) return null;
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
  /** Your collections as your other devices left them (Sync.pull): in place of these (each keeps its id here when its
   *  name is the same). Resolves to 1 if anything changed. */
  async replaceAll(list) {
    const next = [];
    for (const r of list) {
      if (!r || typeof r.name !== 'string' || !r.name.trim() || !Array.isArray(r.hashes) || next.some(x => x.name === r.name)) continue;
      const was = this.list.find(x => x.name === r.name);
      next.push({ id: was ? was.id : uid(), name: r.name.slice(0, 60), hashes: [...new Set(r.hashes.filter(x => typeof x === 'string' && x.length <= 64))], created: was ? was.created : Date.now() });
    }
    const sig = l => JSON.stringify(l.map(x => [x.name, x.hashes]));
    if (sig(next) === sig(this.list)) return 0;
    this.list = next; await this.save();
    return 1;
  },
  /** Collections from your other device (Sync.restore): one with the same name here gets their beatmaps too, the
   *  others are added. Resolves to how many changed. */
  async merge(list) {
    let n = 0;
    for (const r of list) {
      if (!r || typeof r.name !== 'string' || !r.name.trim() || !Array.isArray(r.hashes)) continue;
      const hashes = r.hashes.filter(x => typeof x === 'string' && x.length <= 64), c = this.list.find(x => x.name === r.name);
      if (c) { const was = c.hashes.length; c.hashes = [...new Set([...c.hashes, ...hashes])]; if (c.hashes.length !== was) n++; }
      else { this.list.push({ id: uid(), name: r.name.slice(0, 60), hashes: [...new Set(hashes)], created: Date.now() }); n++; }
    }
    if (n) await this.save();
    return n;
  },
};

const ProfileManager = {
  profile: null,
  async init() {
    this.profile = await DB.kvGet('profile', null);
    if (!this.profile) {
      // (the game's data gone — Reset everything, or cleared by the browser — but this device still the same player
      // online: still called what you were, or the next connection would tell the server you're "Player" now)
      let name = 'Player';
      try { if (localStorage.getItem('am.pid')) name = localStorage.getItem('am.name') || name; } catch { /* private mode */ }
      this.profile = { name, avatar: 'default', created: Date.now(), banner: 'kori', onboarded: false };
      await this.save();
    }
    await this.loadAvatar();
  },
  async save() {
    await DB.kvSet('profile', this.profile);
    try { localStorage.setItem('am.name', this.profile.name); } catch { /* private mode */ }
    Bus.emit('profile:changed');
  },
  async setName(n) {
    const old = this.profile.name;
    this.profile.name = n.trim().slice(0, 24) || 'Player';
    await this.save();
    if (old !== this.profile.name) await this.syncPlays(old);
  },
  /** Your own scores and replays carry your current name (and so your current picture) — after a rename, and at every
   *  start for plays made under any earlier name. Every score here is yours (only your plays, and your Web-Osu-Mania
   *  backup's, are kept); a replay is yours when it was recorded here (own) or belongs to one of your scores — an
   *  imported replay of someone else keeps their name. */
  async syncPlays(old = null) {
    const name = this.profile.name, scores = new Set(ScoreManager.scores), ids = new Set(ScoreManager.scores.map(x => x.id));
    const mine = x => x && x.own !== false && (x.own || scores.has(x) || (x.scoreId && ids.has(x.scoreId)) || (old != null && x.player === old));
    let n = 0;
    // (written together: one at a time, a rename with thousands of scores took seconds)
    const changed = [];
    for (const sc of ScoreManager.scores) if (mine(sc) && sc.player !== name) { sc.player = name; sc.own = true; changed.push(sc); n++; }
    await ScoreManager.putBack(changed);
    for (const r of ReplayManager.list) if (mine(r) && r.player !== name) { const full = await DB.get('replays', r.id); if (full) { full.player = name; full.own = true; await DB.put('replays', full); } r.player = name; r.own = true; n++; }
    if (n) { Bus.emit('scores:changed'); Bus.emit('replays:changed'); }
  },
  async setAvatar(kind, blob) {
    this.profile.avatar = kind; this.profile.avatarSig = kind === 'custom' ? `here:${Date.now()}` : null;
    if (kind === 'custom' && blob) { const t = await makeThumbnail(blob, 512, 0.9); await DB.put('files', t || blob, 'profile/avatar'); }
    await this.loadAvatar(); await this.save();
  },
  /** Your uploaded picture as it goes to your other devices (Sync): the 512 px one, or a smaller copy if it's big. */
  async avatarData() {
    const b = await DB.get('files', 'profile/avatar');
    if (!b) return '';
    const small = b.size > 300000 ? await makeThumbnail(b, 256, 0.85) : b;
    return blobToDataURL(small || b);
  },
  /** Your name and picture as your other devices have them (Sync). */
  async applyKept(p) {
    let changed = false;
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 24) : '';
    if (name && name !== this.profile.name) { this.profile.name = name; changed = true; }
    const a = typeof p.avatar === 'string' ? p.avatar : '';
    if (a.startsWith('data:image/') && a.length < 1500000) {
      // (the same picture as last time isn't put in again)
      const sig = a.length + ':' + a.slice(-48);
      if (this.profile.avatar !== 'custom' || this.profile.avatarSig !== sig) {
        const blob = await (await fetch(a)).blob().catch(() => null);
        if (blob) { await DB.put('files', blob, 'profile/avatar'); this.profile.avatar = 'custom'; this.profile.avatarSig = sig; await this.loadAvatar(); changed = true; }
      }
    } else if ((a === 'default' || /^(preset|file):[\w .()-]{1,64}$/.test(a)) && a !== this.profile.avatar) {
      this.profile.avatar = a; await this.loadAvatar(); changed = true;
    }
    if (!changed) return;
    await this.save();
    await this.syncPlays();
    if (typeof Toolbar !== 'undefined') Toolbar.updateProfile();
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
    else if (a.startsWith('file:')) this.avatarURL = Host.asset('avatars/' + encodeURIComponent(a.slice(5)));
    this.sharedAvatar = await this.makeSharedAvatar().catch(() => '');
    // (a room's first message — your name and picture with it — has to fit what a room takes: see roomAvatar)
    this.roomAvatar = this.sharedAvatar.length <= this.ROOM_AVATAR_MAX ? this.sharedAvatar : await this.makeSharedAvatar(this.ROOM_AVATAR_MAX).catch(() => '');
  },
  /** What other players see: the preset / public picture's id, or a copy of an uploaded picture — 256 px (the size
   *  of the bundled ones), sharp on profiles and high-density screens; a little more compressed, or smaller, only if it
   *  has to be to fit what the server takes. */
  sharedAvatar: '',
  AVATAR_MAX: 24000, // (the server's limit, worker/multiplayer.js cleanAvatar)
  /** The picture sent when joining a room: a smaller copy if need be. A room's server turned away anything over 16 KB
   *  without a word, so a join with a big picture never heard back (MP-RT) — players with their own picture couldn't
   *  get into a room at all. */
  roomAvatar: '',
  ROOM_AVATAR_MAX: 12000,
  async makeSharedAvatar(max = this.AVATAR_MAX) {
    const a = this.profile.avatar || 'default';
    if (a.startsWith('preset:') || a.startsWith('file:')) return a;
    if (a !== 'custom' || !this.avatarURL) return '';
    const img = new Image(); img.src = this.avatarURL; await img.decode();
    const sz = Math.min(img.naturalWidth, img.naturalHeight);
    for (const [px, q] of [[256, 0.86], [256, 0.74], [256, 0.62], [192, 0.75], [160, 0.75], [128, 0.75], [96, 0.75], [64, 0.8]]) {
      const c = document.createElement('canvas'); c.width = c.height = px;
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
      x.drawImage(img, (img.naturalWidth - sz) / 2, (img.naturalHeight - sz) / 2, sz, sz, 0, 0, px, px);
      const webp = c.toDataURL('image/webp', q), url = webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', q);
      if (url.length <= max) return url;
    }
    return '';
  },
  /** Avatar element (custom image or monogram). */
  avatarEl(size = 40) {
    const p = this.profile;
    const el = h('div.avatar', { style: { width: size + 'px', height: size + 'px' } });
    if (p.avatar !== 'default' && this.avatarURL) {
      el.style.backgroundImage = `url("${this.avatarURL}")`;
      // (Teto's or Miku's picture, big enough to see: Neru's drawn on it — but not on Teto's for a player with the Teto
      // role, whose picture is shown at its best: see roleFx)
      const tetoRole = /^preset:teto/.test(p.avatar) && typeof Presence !== 'undefined' && roleFx(Presence.role) === 'teto';
      if (size >= 48 && typeof NeruEggs !== 'undefined' && !tetoRole) NeruEggs.doodle(el, p.avatar);
    } else { el.classList.add('avatar-mono'); el.textContent = (p.name || 'A').slice(0, 1).toUpperCase(); el.style.fontSize = size * 0.45 + 'px'; }
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
  /** Export all data: one JSON file, written a part at a time with each play and replay on a line of its own — a
   *  long-time player's plays (with their timing) and replays come to hundreds of MB: as one string, more than a phone
   *  can hold, and past 512 MB more than any browser can. importFile reads it back the same way. */
  async exportAll() {
    const head = {
      app: APP_NAME, kind: 'backup', version: APP_VERSION, date: Date.now(),
      pid: typeof Presence !== 'undefined' ? Presence.pid() : '', // (whose save it is: no hint about codes on the same player's device)
      settings: Settings.export(), profile: ProfileManager.profile, favorites: [...Favorites.set], collections: Collections.list,
      note: 'Beatmap and skin files are not included; re-import your .osz/.osk files after restoring.',
    };
    const parts = [JSON.stringify(head).slice(0, -1)];
    for (const store of ['scores', 'replays']) {
      parts.push(`,"${store}":[`);
      let n = 0;
      // (a hundred at a time into the file's parts — the browser keeps those, not this page — each play with its
      // timing)
      await DB.eachBatch(store, async list => {
        if (store === 'scores') {
          const t = await DB.getMany('kv', list.map(s => ScoreManager.timingKey(s.id)));
          list = list.map((s, i) => t[i] && t[i].hitErrors ? { ...s, hitErrors: t[i].hitErrors, healthTimeline: t[i].healthTimeline } : s);
        }
        parts.push(new Blob([list.map((x, i) => (n + i ? ',\n' : '\n') + JSON.stringify(x)).join('')]));
        n += list.length;
      });
      parts.push('\n]');
    }
    parts.push('}');
    downloadBlob(new Blob(parts, { type: 'application/json' }), `ashtonk-mania-backup-${new Date().toISOString().slice(0, 10)}.json`);
  },
  /** A data file: a backup that Export all data wrote a line at a time is read that way (a part at a time — see
   *  exportAll), anything else whole. */
  async importFile(f) {
    // (a browser that can't read a file a part at a time reads it whole, as before)
    if (typeof TextDecoderStream === 'undefined' || !f.stream) { let obj = null; try { obj = JSON.parse(await f.text()); } catch { /* below */ } return this.importAll(obj); }
    const rd = f.stream().pipeThrough(new TextDecoderStream()).getReader();
    let buf = '', head = null;
    // (its first line: everything but the plays and replays)
    for (;;) {
      const i = buf.indexOf('\n');
      if (i >= 0) { if (buf.slice(0, i).endsWith(',"scores":[')) { head = buf.slice(0, i); buf = buf.slice(i + 1); } break; }
      const { done, value } = await rd.read();
      if (done || buf.length > 16e6) break;
      buf += value;
    }
    if (!head) {
      rd.cancel().catch(() => {});
      let obj = null;
      try { obj = JSON.parse(await f.text()); } catch { /* below */ }
      return this.importAll(obj);
    }
    const obj = JSON.parse(head.slice(0, -',"scores":['.length) + '}');
    if (!obj || obj.app !== APP_NAME) throw new Error('Not an Ashtonk!mania data file');
    await this.importHead(obj);
    let store = 'scores', batch = [], scores = 0;
    const flush = async () => { if (batch.length) { await DB.putMany(batch); batch = []; } };
    const line = async l => {
      if (l.startsWith('],"replays":[')) { await flush(); store = 'replays'; return; }
      if (!l.startsWith('{')) return;
      const v = JSON.parse(l.endsWith(',') ? l.slice(0, -1) : l);
      if (!(store === 'scores' ? ScoreManager.valid(v) : ReplayManager.ok(v))) return;
      batch.push(...(store === 'scores' ? ScoreManager.stored(this.imported(v)) : [{ store, value: v }]));
      if (store === 'scores') scores++;
      if (batch.length >= 100) await flush();
    };
    for (;;) {
      for (let i; (i = buf.indexOf('\n')) >= 0;) { await line(buf.slice(0, i)); buf = buf.slice(i + 1); }
      const { done, value } = await rd.read();
      if (done) break;
      buf += value;
    }
    await line(buf);
    await flush();
    await this.importDone(obj, scores);
  },
  // (a backup's scores are marked as imported: they're yours to look at here, but never go online — the rankings and
  // leaderboards only take plays the server judged as they were played)
  imported(s) { return { ...s, imported: s.imported || 'backup' }; },
  exportSettings() {
    downloadJSON({ app: APP_NAME, kind: 'settings', version: APP_VERSION, date: Date.now(), settings: Settings.export() }, 'ashtonk-mania-settings.json');
  },
  async importAll(obj) {
    if (!obj || obj.app !== APP_NAME) throw new Error('Not an Ashtonk!mania data file');
    await this.importHead(obj);
    if (obj.kind === 'settings') return;
    const scores = Array.isArray(obj.scores) ? obj.scores.filter(s => ScoreManager.valid(s)) : [];
    await DB.putMany(scores.flatMap(s => ScoreManager.stored(this.imported(s))));
    if (Array.isArray(obj.replays)) await DB.putMany(obj.replays.filter(r => ReplayManager.ok(r)).map(r => ({ store: 'replays', value: r })));
    await this.importDone(obj, scores.length);
  },
  /** A data file's settings — and, for a backup, profile, favourites and collections. */
  async importHead(obj) {
    if (obj.settings) await Settings.import(obj.settings);
    if (obj.kind === 'settings') return;
    if (obj.profile) {
      ProfileManager.profile = { ...ProfileManager.profile, ...obj.profile };
      await ProfileManager.save();
    }
    if (Array.isArray(obj.favorites)) { for (const f of obj.favorites) Favorites.set.add(f); await DB.kvSet('favorites', [...Favorites.set]); }
    if (Array.isArray(obj.collections)) {
      for (const c of obj.collections) {
        const ex = Collections.list.find(x => x.id === c.id || x.name === c.name);
        if (ex) ex.hashes = [...new Set([...ex.hashes, ...(c.hashes || [])])]; else Collections.list.push(c);
      }
      await Collections.save();
    }
  },
  /** A backup's plays and replays are in: the game takes them up. `scores`: how many plays it had. */
  async importDone(obj, scores) {
    await ScoreManager.init(); await ReplayManager.init();
    Bus.emit('scores:changed'); Bus.emit('replays:changed'); Bus.emit('favorites:changed');
    // (a save from another device: typing your code here keeps you one player online, not one for each device)
    const same = obj.pid && typeof Presence !== 'undefined' && obj.pid === Presence.pid();
    if (scores && typeof Account !== 'undefined' && !same && Multiplayer.available())
      setTimeout(() => Toast.show('Playing on more than one device?', `Get your code on your other device (${Account.where()}) and type it here under Use a code, so you're one player on the rankings — not one for each device.`, { timeout: 12000 }), 1200);
  },
  async resetEverything() {
    // (what was sent from here is forgotten too: a device playing through a code gets everything kept for you back
    // from the setup that follows)
    try { ['am.setSent', 'am.setDirty', 'am.skinSent', 'am.skinBig', 'am.scPulled'].forEach(k => localStorage.removeItem(k)); } catch { /* private mode */ }
    DB.db && DB.db.close(); DB.db = null;
    await new Promise(r => { const q = indexedDB.deleteDatabase(DB.name); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    location.reload();
  },
};
