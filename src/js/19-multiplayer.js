/* Online multiplayer (osu!lazer-style rooms of up to 8, Head to Head or Team Versus, and Quick Play). Talks to the
 * Worker's Durable Objects over a WebSocket (/api/mp/room/<code>); see worker/multiplayer.js for the protocol and rules.
 * Ranked Play's queue and match screen are in 19b-ranked-play.js. */

/** Mods that change the song's speed: in multiplayer they apply to the whole room, once everyone accepts. */
const MP_SPEED_MODS = ['DT', 'NC', 'HT', 'DC', 'RT'];

const Multiplayer = {
  ws: null, room: null, me: null, code: null, quick: false,
  chat: [], opps: new Map(), lastResults: null, rtt: 80, _keep: 0,
  qpEndAt: 0,        // when the current Quick Play phase ends (performance.now() time)
  temp: new Set(),   // beatmap sets downloaded automatically for this room (removed again when leaving)
  fetch: null,       // {onlineSetId, progress, error, done} — the automatic download of the room's beatmap
  myDiffId: null,    // the difficulty (local map id) this player chose from the room's beatmap set

  available() { return /^https?:$/.test(location.protocol); },
  // (while reconnecting after a dropped connection the room stays on screen)
  inRoom() { return !!(this.room && (this.ws || this.reconnecting)); },
  isHost() { return !!this.room && this.room.host === this.me; },
  opponent() { return this.room ? this.room.players.find(p => p.id !== this.me) || null : null; },
  isQP() { return !!(this.room && this.room.qp); },
  isRP() { return !!(this.room && this.room.rp); },
  /** A player's usual star rating (the median of their recent passed plays), so Quick Play pools suit the lobby. */
  skillSR() {
    const stars = ScoreManager.recent(30).filter(s => s.passed).map(s => { const m = BeatmapManager.mapByHash(s.mapHash); return m ? m.stars : 0; }).filter(x => x > 0).sort((a, b) => a - b);
    return stars.length ? stars[Math.floor(stars.length / 2)] : 2.5;
  },
  self() { return this.room ? this.room.players.find(p => p.id === this.me) || null : null; },

  async api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Server error (${r.status})`);
    return d;
  },
  /** Open a room: regular (osu!-style head to head, up to 16) or a Ranked Play duel (1v1, unrated), public or private. */
  async create({ ranked = false, isPublic = true, keys = 4 } = {}) {
    const { code } = await this.api('api/mp/new');
    return this.connect(code, true, false, false, ranked ? { mode: 'rp', keys, public: isPublic, ...RankedRating.hello() } : { public: isPublic, cid: clientId() });
  },
  join(code, want) { return this.connect(String(code).trim().toUpperCase(), false, false, false, { ...RankedRating.hello(), ...(want ? { want } : {}) }); },

  connect(code, create, quick = false, rejoin = false, opts = {}) {
    if (!rejoin) this.leave(true);
    return new Promise((resolve, reject) => {
      const u = new URL(`api/mp/room/${encodeURIComponent(code)}`, location.href);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;
      try { ws = new WebSocket(u); } catch (e) { reject(e); return; }
      this.ws = ws; this.code = code; this.quick = quick; this.opps = new Map(); this.opts = opts;
      if (!rejoin) { this.chat = []; this.lastResults = null; }
      let settled = false;
      const fail = msg => { if (!settled) { settled = true; reject(new Error(msg)); } };
      ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', name: ProfileManager.profile.name, avatar: ProfileManager.sharedAvatar || '', create, sr: this.skillSR(), ...opts })); this.ping(); };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') { this.me = m.you; this.room = m.room; this.qpClock(m.room); settled = true; resolve(); this.startKeepAlive(); this.autoFetch(); this.flushOutbox(); Bus.emit('mp:changed'); return; }
        if (m.t === 'error' && m.fatal) { fail(m.msg); return; }
        this.onMessage(m);
      };
      ws.onerror = () => fail('Couldn\'t reach the multiplayer server.');
      ws.onclose = () => {
        fail('Connection closed.');
        if (this.ws !== ws) return; // left on purpose
        const wasIn = !!this.room;
        this.ws = null; this.stopKeepAlive();
        // dropped: quietly keep trying to get back in (the only notice is "Reconnected")
        if (wasIn) { this.startReconnect(); Bus.emit('mp:changed'); }
      };
    });
  },
  /** Rejoin the room after the connection dropped, retrying with backoff until it works or the player leaves.
   *  The server sees a fresh join, so this player's beatmap, difficulty and mods are sent again afterwards. */
  startReconnect() {
    if (this.reconnecting) return;
    const me = this.self();
    const rc = this.reconnecting = { code: this.code, quick: this.quick, opts: this.opts || {}, tries: 0, create: false, mods: (me && me.mods) || [], diff: this.myDiffId, timer: 0 };
    const attempt = async () => {
      if (this.reconnecting !== rc) return;
      try {
        await this.connect(rc.code, rc.create, rc.quick, true, rc.opts);
        if (this.reconnecting !== rc) return;
        this.reconnecting = null;
        this.syncHasMap();
        if (rc.mods.length) this.send({ t: 'mods', mods: rc.mods });
        if (rc.diff) this.chooseDiff(rc.diff);
        Toast.ok('Reconnected to the room', rc.code);
        Bus.emit('mp:changed');
      } catch (e) {
        if (this.reconnecting !== rc) return;
        // a Quick Play round moved on without us: there's no way back in
        if (/already started|full/i.test(e.message) && (rc.opts.mode === 'qp' || rc.opts.mode === 'rp' || this.isRPCode === rc.code)) { this.leave(); Toast.err(`Lost the ${rc.opts.mode === 'qp' ? 'Quick Play' : 'Ranked Play'} match`, 'The connection dropped for too long and the match went on without you.'); return; }
        if (/not found/i.test(e.message)) rc.create = true; // everyone left meanwhile: open it again under the same code
        rc.tries++;
        rc.timer = setTimeout(attempt, Math.min(10000, 1000 * 2 ** Math.min(rc.tries, 4)));
      }
    };
    rc.timer = setTimeout(attempt, 600);
  },
  leave(silent = false) {
    if (this.reconnecting) { clearTimeout(this.reconnecting.timer); this.reconnecting = null; }
    this.stopKeepAlive();
    this.myDiffId = null; this.fetch = null; this._outbox = null;
    if (this.temp.size) this.cleanupTemp();
    if (this.quick && this.code && this.room && this.room.players.length < 2) this.api('api/mp/quick/cancel', { code: this.code }).catch(() => {});
    const ws = this.ws;
    // the room list may still carry the room we just left for a moment: the lobby hides it if we were alone in it
    if (this.room) this.lastLeft = { code: this.room.code, alone: this.room.players.length <= 1, at: Date.now() };
    this.ws = null; this.room = null; this.me = null; this.opps = new Map();
    if (ws) { try { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'bye' })); ws.close(1000, 'leave'); } catch { /* already closed */ } }
    if (!silent) Bus.emit('mp:changed');
  },
  /** Send to the room. A play's result (finish / quit) that can't go out because the connection has dropped waits
   *  and goes out once it's back: the room keeps your place in the match while you reconnect. */
  send(m) {
    if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(m)); return; }
    if (m && (m.t === 'finish' || m.t === 'quit') && (this.reconnecting || this.ws)) this._outbox = m;
  },
  flushOutbox() { const m = this._outbox; this._outbox = null; if (m) this.send(m); },
  ping() { this._pingAt = performance.now(); this.send({ t: 'ping', c: this._pingAt }); },
  startKeepAlive() {
    this.stopKeepAlive();
    this._keep = setInterval(() => {
      this.ping();
      if (this.quick && this.room && this.room.players.length < 2) this.api('api/mp/quick/keep', { code: this.code }).catch(() => {});
    }, 15000);
  },
  stopKeepAlive() { clearInterval(this._keep); this._keep = 0; },

  onMessage(m) {
    switch (m.t) {
      case 'room': {
        const had = this.room ? this.room.players.length : 0;
        if (m.room.rp) this.isRPCode = m.room.code;
        const key = map => map ? map.hash || 'o' + map.onlineId : null, prev = key(this.room && this.room.map);
        this.room = m.room;
        this.qpClock(m.room);
        if (key(m.room.map) !== prev) this.myDiffId = null;
        this.syncHasMap();
        this.autoFetch();
        if (m.room.players.length > had && had) UISounds.click();
        Bus.emit('mp:changed');
        break;
      }
      case 'chat': this.chat.push(m); if (this.chat.length > 200) this.chat.shift(); Bus.emit('mp:chat', m); break;
      case 'pong': if (m.c === this._pingAt) this.rtt = performance.now() - m.c; break;
      case 'opp': this.opps.set(m.id, m); break;
      case 'qpPool': this.buildPool(m); break;
      case 'rpDeck': buildRankedDeck(m).catch(e => console.warn('Ranked Play deck', e)); break;
      case 'hand': Bus.emit('rp:hand', m); break;
      case 'start': this.launch(m); break;
      case 'skipvote': if (typeof GameplayScreen !== 'undefined') GameplayScreen.mpSkipVotes(m); break;
      case 'skip': if (typeof GameplayScreen !== 'undefined') GameplayScreen.mpSkip(); break;
      case 'results':
        this.lastResults = m.results;
        if (Screens.currentName === 'gameplay' && GameplayScreen.s && GameplayScreen.s.mp && !GameplayScreen.s.finished) {
          const won = m.results.winner === this.me;
          if (this.isRP()) Toast.show('Your opponent left the match', 'The round is yours. Finish the map or press Esc to see the results.');
          else Toast.show(won ? 'Everyone else left — you win!' : 'Match ended', 'Finish the map or press Esc to return to the room.');
        }
        Bus.emit('mp:changed');
        break;
      case 'error': Toast.err(m.msg); break;
    }
  },

  /** The room's beatmap in the local library (by hash, else by osu! beatmap id). */
  localMap(map = this.room && this.room.map) {
    if (!map) return null;
    const byHash = BeatmapManager.mapByHash(map.hash);
    if (byHash && !byHash.problems.length) return byHash;
    if (map.onlineId > 0) for (const m of BeatmapManager.maps.values()) if (m.onlineId === map.onlineId && !m.problems.length) return m;
    return null;
  },
  /** The difficulty this player will play: their own pick from the room's set, else the host's. */
  myMap() {
    const local = this.localMap();
    if (!local) return null;
    const d = this.myDiffId && BeatmapManager.maps.get(this.myDiffId);
    return d && d.setId === local.setId && !d.problems.length ? d : local;
  },
  chooseDiff(mapId) {
    const d = BeatmapManager.maps.get(mapId), local = this.localMap();
    if (!d || !local || d.setId !== local.setId) return;
    this.myDiffId = d.id === local.id ? null : d.id;
    this.send({ t: 'diff', diff: this.myDiffId ? { version: d.version, stars: d.stars, keys: d.keys } : null });
    Bus.emit('mp:changed');
  },

  /** Download the room's beatmap straight away when this player doesn't have it. It's installed only for the
   *  room: `cleanupTemp()` removes it when they leave (unless they choose to keep it). */
  autoFetch() {
    const map = this.room && this.room.map;
    if (!map || (this.isHost() && !this.isQP() && !this.isRP()) || this.localMap(map) || !(map.onlineSetId > 0)) return;
    if (this.fetch && this.fetch.onlineSetId === map.onlineSetId && !this.fetch.error) return;
    const f = this.fetch = { onlineSetId: map.onlineSetId, progress: 0 };
    const before = new Set(BeatmapManager.sets.map(x => x.id));
    let last = 0;
    OnlineBeatmaps.downloadAndImport({ id: map.onlineSetId, title: map.title, artist: map.artist }, p => {
      f.progress = p;
      if (performance.now() - last > 150) { last = performance.now(); Bus.emit('mp:fetch', f); }
    }, { quiet: true }).then(report => {
      for (const set of report.sets) if (!before.has(set.id)) this.temp.add(set.id);
      this.saveTemp();
      f.done = true;
      if (this.fetch === f) Bus.emit('mp:changed');
    }).catch(e => { f.error = e.message; if (this.fetch === f) Bus.emit('mp:changed'); });
  },
  isTemp(map = this.room && this.room.map) { const l = this.localMap(map); return !!(l && this.temp.has(l.setId)); },
  keepTemp() { const l = this.localMap(); if (l) { this.temp.delete(l.setId); this.saveTemp(); Toast.ok('Kept in your library', `${l.artist} - ${l.title}`); Bus.emit('mp:changed'); } },
  saveTemp() { DB.kvSet('mp.tempSets', [...this.temp]).catch(() => {}); },
  /** Remove beatmaps that were only installed for a room (also run at startup, in case the tab was closed). */
  async cleanupTemp() {
    const ids = new Set([...this.temp, ...(await DB.kvGet('mp.tempSets', []).catch(() => []))]);
    this.temp.clear();
    await DB.kvSet('mp.tempSets', []).catch(() => {});
    for (const id of ids) {
      if (!BeatmapManager.setById.has(id)) continue;
      if (Music.meta && Music.meta.setId === id) Music.stop(0);
      await BeatmapManager.removeSet(id).catch(e => console.warn('temp cleanup', e));
    }
  },
  syncHasMap() {
    const me = this.self();
    if (!me || !this.room.map) return;
    const has = !!this.localMap();
    if (has !== me.hasMap) this.send({ t: 'hasMap', has });
  },
  /** This player's own mods; a speed mod (DT, HT…) in the list is proposed to the room instead. */
  setMods(list) {
    const speed = list.filter(x => MP_SPEED_MODS.includes(x)).slice(0, 1);
    this.send({ t: 'mods', mods: list.filter(x => !MP_SPEED_MODS.includes(x) && x !== 'AT') });
    const r = this.room, cur = r ? r.mods || [] : [];
    const pending = r && r.vote ? r.vote.mods : null;
    const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
    if (!same(speed, cur) && !(pending && same(speed, pending))) this.send({ t: 'rate', mods: speed, modConfig: ModSystem.config() });
  },
  vote(yes) { this.send({ t: 'vote', yes }); },
  selectMap(m, mods) {
    const set = BeatmapManager.setById.get(m.setId);
    this.send({ t: 'map', map: { hash: m.hash, title: m.title, artist: m.artist, version: m.version, creator: m.creator, keys: m.keys, stars: m.stars, length: m.length,
      onlineSetId: set && set.onlineId > 0 ? set.onlineId : -1, onlineId: m.onlineId > 0 ? m.onlineId : -1 }, mods: mods.filter(x => x !== 'AT'), modConfig: ModSystem.config() });
  },
  launch(m) {
    if (Array.isArray(m.players) && !m.players.includes(this.me)) { Toast.show('Sitting this round out', 'You didn\'t have the beatmap in time — you\'re back in next round.'); return; }
    const local = this.localMap(m.map) && this.myMap();
    if (!local) { Toast.err('Missing beatmap', 'You need the beatmap to play this match.'); this.send({ t: 'quit' }); return; }
    this.opps = new Map();
    const startAt = performance.now() + m.delay - this.rtt / 2;
    // the room's speed mod (everyone accepted it) plus this player's own mods
    const mods = ModSystem.normalize([...(m.mods || []), ...((m.playerMods && m.playerMods[this.me]) || [])]);
    Game.launch({ mapId: local.id, mods, modConfig: m.modConfig ? { ...ModSystem.config(), ...m.modConfig } : null, mode: 'play', mp: { startAt, players: m.players || null, rp: this.isRP() } });
  },
  qpClock(room) { const g = room && (room.qp || room.rp); this.qpEndAt = g && g.left ? performance.now() + g.left - this.rtt / 2 : 0; },
  /** Quick Play host: this round's pool — ranked maps for the lobby's key count around its typical star rating from
   *  the online listing, topped up from this player's own library (offline, or when the search finds too few). */
  async buildPool(m) {
    // Ranked Play sends the deck's star range (between both players' levels); Quick Play a typical star rating
    const keys = m.keys === 7 ? 7 : 4, sr = m.sr > 0 ? m.sr : this.skillSR(), want = clamp(m.count || 5, 1, 20);
    const lo = m.lo > 0 ? m.lo : Math.max(0, sr - 0.75), hi = m.hi > 0 ? m.hi : sr + 0.75, pool = [], seen = new Set();
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    try {
      // (a different order each time — newest, most played, most favourited, best rated — so rounds vary)
      const sorts = [null, 'plays_desc', 'favourites_desc', 'rating_desc'];
      const d = await OnlineBeatmaps.searchPages({ q: '', status: 'ranked', keys: [keys], minStars: lo, maxStars: hi, nsfw: false, sort: sorts[Math.floor(Math.random() * sorts.length)] }, want > 8 ? 2 : 1, 8000);
      for (const set of shuffle([...(d.sets || [])])) {
        const diffs = set.diffs.filter(x => x.keys === keys && x.stars >= lo && x.stars <= hi && x.id > 0);
        if (!diffs.length || seen.has(set.id)) continue;
        seen.add(set.id);
        const x = diffs[Math.floor(Math.random() * diffs.length)];
        pool.push({ hash: '', title: set.title, artist: set.artist, version: x.version, creator: set.creator, keys, stars: x.stars, length: (x.length || 0) * 1000, onlineSetId: set.id, onlineId: x.id });
        if (pool.length >= want) break;
      }
    } catch (e) { console.warn('Quick Play pool: online search failed', e); }
    if (pool.length < Math.min(3, want)) {
      const local = [...BeatmapManager.maps.values()].filter(x => x.keys === keys && !x.problems.length).sort((a, b) => Math.abs(a.stars - sr) - Math.abs(b.stars - sr));
      for (const x of shuffle(local.slice(0, Math.max(12, want + 4)))) {
        const set = BeatmapManager.setById.get(x.setId);
        const onlineSetId = set && set.onlineId > 0 ? set.onlineId : -1;
        if (seen.has(onlineSetId > 0 ? onlineSetId : 'l' + x.setId)) continue;
        seen.add(onlineSetId > 0 ? onlineSetId : 'l' + x.setId);
        pool.push({ hash: x.hash, title: x.title, artist: x.artist, version: x.version, creator: x.creator, keys, stars: x.stars, length: x.length, onlineSetId, onlineId: x.onlineId > 0 ? x.onlineId : -1 });
        if (pool.length >= want) break;
      }
    }
    const g = this.room && (this.room.qp || this.room.rp);
    if (pool.length && g && g.round === m.round) this.send({ t: 'pool', maps: pool });
  },
  pick(i) { this.send({ t: 'pick', i }); },
  setSettings(o) { this.send({ t: 'settings', settings: o }); },
  setTeam(t) { this.send({ t: 'team', team: t }); },
  /** Invite link for the current room: opening it joins the room directly. */
  inviteLink() {
    const u = new URL(location.href);
    u.search = ''; u.hash = '';
    u.searchParams.set('join', this.room.code);
    return u.toString();
  },
  async invite() {
    const link = this.inviteLink(), text = `Join my Ashtonk!mania room (${this.room.code})`;
    // the share sheet where there is one (phones, some desktops), otherwise copy the link
    if (navigator.share) { try { await navigator.share({ title: 'Ashtonk!mania', text, url: link }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(link); Toast.ok('Invite link copied', 'Send it to your friend — opening it joins this room.'); }
    catch { Dialog.prompt('Invite link', link, { ok: 'Done' }); }
  },
  /** Opened from an invite link (?join=CODE): join that room once the game has started. */
  async joinFromLink() {
    const code = new URLSearchParams(location.search).get('join');
    if (!code) return;
    const u = new URL(location.href); u.searchParams.delete('join'); history.replaceState(null, '', u);
    if (!/^[A-Za-z0-9]{4,8}$/.test(code) || !this.available()) return;
    await Screens.go('multiplayer');
    try { await this.join(code); Toast.ok('Joined the room', code.toUpperCase()); }
    catch (e) { Toast.err('Couldn\'t join the room', friendlyError(e)); }
  },
  /** (Ranked Play's damage is worked out on lazer's standardised score.) */
  finish(score, forfeit = false) {
    this.send({ t: 'finish', result: { score: score.scoreStd ?? score.score, accuracy: score.accuracy, maxCombo: score.maxCombo, counts: score.counts, grade: score.grade, passed: score.passed, pp: score.pp, forfeit } });
  },
};

/** Who's online, for invites: one WebSocket to the Worker (/api/mp/presence) for the whole session, which
 *  reconnects on its own. Players show as in the menus, in a room or playing. */
const Presence = {
  ws: null, me: null, players: [], retry: 0, started: false,
  start() {
    if (this.started || !Multiplayer.available()) return;
    this.started = true;
    // only where the Worker serves multiplayer (a plain static copy has no /api)
    fetch('api/health', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => { if (d && d.multiplayer) this.connect(); }).catch(() => {});
    const push = () => this.pushStatus();
    Bus.on('mp:changed', push); Bus.on('profile:changed', push); Bus.on('screen:changed', push);
  },
  status() { return Screens.currentName === 'gameplay' ? 'playing' : Multiplayer.inRoom() ? 'room' : 'menu'; },
  connect() {
    const u = new URL('api/mp/presence', location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try { ws = new WebSocket(u); } catch { this.later(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this._sent = this.status(); this._name = ProfileManager.profile.name; this._av = ProfileManager.sharedAvatar || '';
      // cid: this tab, so a reconnect replaces its old entry instead of leaving a ghost behind
      if (!this.cid) this.cid = Math.random().toString(36).slice(2, 12);
      ws.send(JSON.stringify({ t: 'hello', name: this._name, status: this._sent, avatar: this._av, cid: this.cid }));
      // every 10 s: tells the server we're still here (silent players drop off the list) and, while someone's
      // looking at who's online, asks for the list again
      clearInterval(this._ping); this._ping = setInterval(() => this.send({ t: this.watching() ? 'list' : 'ping' }), 10000);
    };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') this.me = m.you;
      else if (m.t === 'online') { this.players = Array.isArray(m.players) ? m.players : []; Bus.emit('presence:changed'); }
      else if (m.t === 'invite') this.onInvite(m);
      else if (m.t === 'invited') Bus.emit('presence:invited', m.to);
      else if (m.t === 'error') Toast.err(m.msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null; this.players = []; clearInterval(this._ping);
      Bus.emit('presence:changed');
      this.later();
    };
  },
  later() { clearTimeout(this._t); this._t = setTimeout(() => this.connect(), Math.min(60000, 2000 * 2 ** this.retry++)); },
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
  pushStatus() {
    const st = this.status(), name = ProfileManager.profile.name, av = ProfileManager.sharedAvatar || '';
    if (st === this._sent && name === this._name && av === this._av) return;
    this._sent = st; this._name = name; this._av = av;
    this.send({ t: 'status', status: st, name, avatar: av });
  },
  others() { return this.players.filter(p => p.id !== this.me); },
  /** Is a list of online players on screen (the invite dialog)? */
  watching() { return !!document.querySelector('.inv-list'); },
  refresh() { this.send({ t: 'list' }); },
  /** A player's picture: their chosen preset / uploaded thumbnail when they share one, else their initial. */
  avatarEl(p, size = 44) {
    const a = p && typeof p.avatar === 'string' ? p.avatar : '';
    const url = a.startsWith('preset:') ? AvatarPresets.url(a.slice(7)) : a.startsWith('file:') ? 'avatars/' + encodeURIComponent(a.slice(5)) : a.startsWith('data:image/') ? a : null;
    if (url) return h('img.avatar', { src: url, alt: '', style: { width: size + 'px', height: size + 'px' }, onerror: e => e.target.replaceWith(this.avatarEl({ name: p.name }, size)) });
    return h('div.avatar.avatar-mono', { style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.45) + 'px' } }, (p && p.name || '?').slice(0, 1).toUpperCase());
  },
  invite(id) { if (Multiplayer.inRoom()) this.send({ t: 'invite', to: id, code: Multiplayer.room.code }); },
  async onInvite(m) {
    const from = m.from && m.from.name || 'Someone';
    if (Multiplayer.inRoom() && Multiplayer.room.code === m.code) return;
    if (Screens.currentName === 'gameplay') {
      // nothing pops up mid-play (as lazer holds notifications back): the invite is asked once the play is over
      this._pendingInvite = { m, at: Date.now() };
      if (!this._inviteOff) this._inviteOff = Bus.on('screen:changed', name => {
        const p = this._pendingInvite;
        if (name === 'gameplay' || !p) return;
        this._pendingInvite = null;
        if (Date.now() - p.at < 5 * 60000) setTimeout(() => this.onInvite(p.m), 700);
      });
      return;
    }
    UISounds.play('check-on');
    const ok = await Dialog.confirm(`${from} invited you!`, `Join their multiplayer room (${m.code})?${Multiplayer.inRoom() ? ' You\'ll leave your current room.' : ''}`, { ok: 'Join', cancel: 'Not now' });
    if (!ok) return;
    try { await Multiplayer.join(m.code); if (Screens.currentName !== 'multiplayer') await Screens.go('multiplayer'); Toast.ok('Joined the room', m.code); }
    catch (e) { Toast.err('Couldn\'t join the room', friendlyError(e)); }
  },
  /** The room's Invite button: invite someone who's online, or share a link. */
  openInvite() {
    if (!Multiplayer.inRoom()) return;
    this.refresh();
    const invited = new Set();
    const list = h('div.inv-list');
    const paint = () => {
      const others = this.others();
      clearEl(list).append(...(others.length ? others.map(p => {
        const busy = p.status === 'playing' || p.status === 'room'; // (already in a room: can't be invited)
        const done = invited.has(p.id);
        return h('div.inv-row', h('span.inv-av', (p.name || '?').slice(0, 1).toUpperCase()),
          h('div.inv-who', h('b', p.name), h('small', p.status === 'playing' ? 'Playing' : p.status === 'room' ? 'In a room' : 'Online')),
          h(`button.btn.sm${done || busy ? '' : '.primary'}`, { disabled: done || busy, title: busy ? 'Already in a room' : '', onclick: () => { this.invite(p.id); invited.add(p.id); UISounds.click(); paint(); } }, done ? 'Invited' : busy ? 'In a room' : 'Invite'));
      }) : [h('div.inv-empty', this.ws ? 'Nobody else is online right now.' : 'Connecting…')]));
    };
    paint();
    const off = Bus.on('presence:changed', paint);
    const o = Dialog.custom(`Invite to room ${Multiplayer.room.code}`, h('div.inv',
      h('div.inv-label', 'Online players'), list,
      h('div.inv-label', 'Or send a link'),
      h('button.btn.inv-link', { onclick: () => { Multiplayer.invite(); } }, icon('upload'), 'Copy invite link')), [{ label: 'Done' }]);
    const close = o.close; o.close = () => { off(); close(); };
  },
};

// Closing (or reloading) the tab is leaving on purpose: the room is told at once, rather than waiting for a dropped
// connection to come back. (A page frozen into the back/forward cache just drops, and reconnects if it's restored.)
addEventListener('pagehide', e => {
  const ws = Multiplayer.ws;
  if (e.persisted || !ws) return;
  try { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'bye' })); } catch { /* closing */ }
});

// In a room, other menus (profile, skins, collections…) keep you in it, and going back or home from them returns to
// the room. Heading home from the room itself asks first; only "Leave" (or confirming that) leaves.
Screens.redirect = (name, from) => {
  if (name !== 'home' || !Multiplayer.inRoom()) return name;
  if (from !== 'multiplayer') return 'multiplayer';
  if (Multiplayer.isRP()) { RankedMatch.confirmLeave(); return null; }
  Dialog.confirm('Leave room?', 'You will leave this multiplayer room.', { ok: 'Leave' }).then(ok => { if (ok) { Multiplayer.leave(); Screens.go('home', { noRedirect: true }); } });
  return null;
};
Bus.on('library:changed', () => Multiplayer.inRoom() && Multiplayer.syncHasMap());

const MultiplayerScreen = {
  tab: 'multiplayer',
  enter(params = {}) {
    // two lounges: the multiplayer lounge (regular rooms) and the Ranked Play lounge (1v1 card duels, no rating)
    this.mode = params.ranked ? 'ranked' : 'lounge';
    this.el = h('div.mp.ov', { style: { '--o-h': OVERLAY_HUES.plum } });
    this.body = h('div.mp-body');
    this.el.append(this.body, h('div.page-back', backButton(() => this.onBack() || Screens.back())));
    this._unsub = [Bus.on('mp:changed', () => this.render()), Bus.on('mp:chat', m => this.appendChat(m)), Bus.on('mp:fetch', () => { this.updateFetch(); if (Multiplayer.isQP() && Multiplayer.room.qp.phase === 'load') this.qpUpdate(Multiplayer.room); })];
    this._qpInt = setInterval(() => this.qpTick(), 250);
    this.render();
    return this.el;
  },
  leave() { (this._unsub || []).forEach(f => f()); clearInterval(this._qpInt); this._qpRoll = null; RankedMatch.unmount(); },
  onBack() {
    if (Multiplayer.inRoom() && Multiplayer.isRP()) { RankedMatch.confirmLeave(); return true; }
    if (Multiplayer.inRoom()) {
      Dialog.confirm('Leave room?', 'You will leave this multiplayer room.', { ok: 'Leave' }).then(ok => { if (ok) { Multiplayer.leave(); } });
      return true;
    }
    return false;
  },
  onKey(e) { return false; },
  render() {
    if (!this.body) return;
    // a Ranked Play match takes the whole screen (lazer's RankedPlayScreen)
    // (a room's kind decides which lounge you return to when you leave it)
    if (Multiplayer.inRoom() && Multiplayer.isRP()) { this.mode = 'ranked'; RankedMatch.mount(this); return; }
    RankedMatch.unmount();
    if (Multiplayer.inRoom()) { this.mode = 'lounge'; this.renderRoom(); return; }
    this.roomEl = null;
    clearEl(this.body);
    this.renderLobby();
  },

  // ── lobby (osu!lazer's lounge): create a room or join one by code; every public room is listed underneath
  renderLobby() {
    const status = h('div.mp-status');
    const busy = async (label, fn) => {
      clearEl(status).append(h('span.spinner'), label);
      $$('button', this.body).forEach(b => b.disabled = true);
      try { await fn(); } catch (e) { clearEl(status).append(h('span.mp-err', e.message)); $$('button', this.body).forEach(b => b.disabled = false); }
    };
    this._busy = busy;
    const code = h('input.input.mp-code', { placeholder: 'ROOM CODE', maxlength: 8, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Room code' });
    code.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') joinBtn.click(); });
    code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    const ranked = this.mode === 'ranked';
    // a room code only opens a room of this lounge's kind (Ranked Play rooms aren't reachable from the lounge)
    const joinBtn = h('button.btn.mp-join', { onclick: () => code.value.length >= 4 && busy('Joining room…', () => this.joinHere(code.value)) }, 'Join');
    const offline = !Multiplayer.available();
    this.body.append(overlayHeader(ranked ? 'Ranked Play' : 'Multiplayer', { icon: ranked ? 'crown' : 'multi' }), h('div.mp-lobby',
      offline ? h('div.mp-note', 'Multiplayer needs the online server — open the game from its web address (the Cloudflare deployment).') : null,
      h('div.mp-lounge-bar',
        h('button.mp-create', { disabled: offline, onclick: () => { UISounds.click(); this.openCreate({ ranked }); } }, h('span', ranked ? 'Create duel' : 'Create room')),
        h('div.mp-joinbox', icon('multi'), code, joinBtn)),
      status,
      h('div.mp-sec-t', 'Open rooms', h('span', 'click one to join'),
        h('input.input.mp-search', { type: 'search', placeholder: 'type to search', 'aria-label': 'Search rooms', value: this._roomQuery || '',
          oninput: e => { this._roomQuery = e.target.value; this.filterRooms(); }, onkeydown: e => e.stopPropagation() })),
      this.roomsEl = h('div.mp-roomlist', h('div.mp-rooms-empty', h('span.spinner'), 'Looking for open rooms…'))));
    this._roomsSig = null; this._roomRows = null; // (a fresh list for this lounge)
    if (offline) $$('button', this.body).forEach(b => b.disabled = true);
    else setTimeout(() => this.pollRooms(), 30); // (once the lobby is on the page: the screen is still being built here)
  },
  /** Create room: regular or a Ranked Play duel, then public or private — nothing else to set (rooms play by osu!'s
   *  rules; a duel is lazer's Ranked Play with a friend, unrated). */
  /** Create a room in this lounge: the multiplayer lounge makes a regular room (head to head, up to 16); the Ranked
   *  Play lounge makes a 1v1 duel (pick 4K or 7K). Either can be public (listed) or private (code only). */
  openCreate(pre = {}) {
    const st = { ranked: !!pre.ranked, isPublic: true, keys: pre.keys === 7 || (!pre.keys && Settings.get('mp.qpKeys') === 7) ? 7 : 4 };
    const body = h('div.mp-cr');
    const choice = (cls, key, v, ic, title, sub) => h(`button.mp-cr-card.${cls}${st[key] === v ? '.on' : ''}`, { dataset: { v: String(v) }, onclick: () => { UISounds.click(); st[key] = v; paint(); } },
      h('div.mp-cr-ico', icon(ic)), h('div', h('b', title), h('span', sub)));
    const paint = () => clearEl(body).append(...[
      st.ranked ? h('div.mp-cr-l', 'Key count') : null,
      st.ranked ? h('div.mp-cr-keys', h('div.qp-keys', ...[4, 7].map(k => h(`button.qp-key${st.keys === k ? '.on' : ''}`, { onclick: () => { UISounds.click(); st.keys = k; Settings.set('mp.qpKeys', k); paint(); } }, `${k}K`)))) : null,
      h('div.mp-cr-l', 'Who can join'),
      h('div.mp-cr-row', choice('vis', 'isPublic', true, 'globe', 'Public', `Listed in the ${st.ranked ? 'Ranked Play' : 'multiplayer'} lounge for anyone to join.`),
        choice('vis', 'isPublic', false, 'lock', 'Private', 'Only people with the room code (or an invite) can join.'))].filter(Boolean));
    paint();
    const o = Dialog.custom(st.ranked ? 'Create a Ranked Play duel' : 'Create room', body, [
      { label: 'Cancel' },
      { label: 'Create', primary: true, onClick: () => this._busy('Creating room…', () => Multiplayer.create(st)) }]);
    return o;
  },
  /** Join by code, but only a room of this lounge's kind: Ranked Play rooms open from Ranked Play, others from the lounge. */
  async joinHere(code) {
    await Multiplayer.join(code, this.mode === 'ranked' ? 'rp' : 'room');
    const ranked = Multiplayer.isRP();
    if (ranked !== (this.mode === 'ranked')) {
      Multiplayer.leave();
      throw new Error(ranked ? 'That\'s a Ranked Play room — join it from Ranked Play on the main menu.' : 'That\'s a regular room — join it from the multiplayer lounge.');
    }
  },
  /** lazer's lounge search box: rooms whose name, host or beatmap don't match are hidden. */
  filterRooms() {
    const q = (this._roomQuery || '').trim().toLowerCase();
    let shown = 0;
    for (const { row } of (this._roomRows || new Map()).values()) { row.hidden = !!q && !q.split(/\s+/).every(w => row._name.includes(w)); if (!row.hidden) shown++; }
    if (this.roomsEl) this.roomsEl.classList.toggle('no-match', !!q && !shown && !!(this._roomRows && this._roomRows.size));
  },
  /** lazer's lounge: the open custom rooms, refreshed every few seconds while the lobby is on screen. */
  async pollRooms() {
    clearTimeout(this._roomsT);
    const el = this.roomsEl;
    if (!el || !el.isConnected || Multiplayer.inRoom()) return;
    let rooms = null;
    try { const r = await fetch('api/mp/rooms', { cache: 'no-store' }); rooms = r.ok ? (await r.json()).rooms : null; } catch { rooms = null; }
    if (!el.isConnected || Multiplayer.inRoom()) return;
    const left = Multiplayer.lastLeft;
    if (rooms && left && left.alone && Date.now() - left.at < 60000) rooms = rooms.filter(r => !(r.code === left.code && r.players <= 1));
    // rows that haven't changed since the last poll (every 3s) are kept as they are: rebuilding them replayed their
    // slide-in and reloaded their covers, so the whole list blinked
    const prevRows = this._roomRows || new Map(), nextRows = new Map();
    const sigOf = r => JSON.stringify([r.name, r.players, r.size, r.state, r.ranked, r.keys, r.rating, r.host, r.avatar, r.map && [r.map.onlineSetId, r.map.title, r.map.version, r.map.stars]]);
    const listSig = rooms ? rooms.map(r => r.code + sigOf(r)).join('|') : 'x';
    if (listSig === this._roomsSig && el.isConnected && el.childNodes.length) { this._roomsT = setTimeout(() => this.pollRooms(), 3000); return; }
    this._roomsSig = listSig;
    // each lounge lists only its own kind of room
    if (rooms) rooms = rooms.filter(r => !!r.ranked === (this.mode === 'ranked'));
    clearEl(el).append(...(rooms && rooms.length ? rooms.map(r => {
      const sig = sigOf(r), old = prevRows.get(r.code);
      if (old && old.sig === sig) { nextRows.set(r.code, old); old.row.disabled = r.players >= r.size || r.state === 'playing'; return old.row; }
      const bg = h('div.mp-rbg');
      if (r.map && r.map.onlineSetId > 0) bg.style.backgroundImage = `url("${OnlineBeatmaps.coverURL(r.map.onlineSetId, 'card')}")`;
      const full = r.players >= r.size, playing = r.state === 'playing';
      const row = h(`button.mp-room-row${playing ? '.playing' : ''}`, { disabled: full || playing, onclick: async () => {
        UISounds.click(); row.disabled = true;
        try { await this.joinHere(r.code); } catch (e) { Toast.err('Couldn\'t join', friendlyError(e)); row.disabled = false; this.pollRooms(); }
      } }, bg, h('div.mp-rshade'),
        h(`span.mp-rstate${playing ? '.on' : ''}${r.ranked ? '.ranked' : ''}`, r.ranked ? (playing ? 'Ranked Play · playing' : 'Ranked Play') : playing ? 'Playing' : 'Open'),
        h('div.mp-rbody', h('div.mp-rname', r.name),
          r.ranked ? h('div.mp-rmap', h('span', `1v1 Ranked Play duel · ${r.keys || 4}K${r.rating ? ` · host rating ${fmtInt(r.rating)}` : ''}`))
            : h('div.mp-rmap', r.map ? [starBadge(r.map.stars), h('span', `${r.map.artist} - ${r.map.title} [${r.map.version}]`), h('span.keys-tag', `${r.map.keys}K`)] : h('span.muted', 'No beatmap picked yet')),
          h('div.mp-rmeta', h('span', r.ranked ? 'Beatmap cards · 1,000,000 life · unrated' : 'Head to Head · highest score wins'))),
        h('div.mp-rplayers', Presence.avatarEl({ name: r.host, avatar: r.avatar }, 32), h('b', `${r.players}/${r.size}`)),
        h('span.mp-rjoin', full ? 'Full' : playing ? 'In a match' : 'Join'));
      row.addEventListener('pointerenter', () => UISounds.hover());
      // (the slide-in class goes once it has played: moving a row back in would otherwise replay it)
      row.classList.add('anim'); row.addEventListener('animationend', () => row.classList.remove('anim'), { once: true });
      row._name = `${r.name} ${r.host || ''} ${r.map ? `${r.map.artist} ${r.map.title} ${r.map.version}` : ''}`.toLowerCase();
      nextRows.set(r.code, { sig, row });
      return row;
    }) : [h('div.mp-rooms-empty', rooms ? (this.mode === 'ranked' ? 'No duels open right now — create one and it shows up here for everyone.' : 'No open rooms right now — create one and it shows up here for everyone.') : 'Can\'t reach the multiplayer server right now — trying again…')]));
    this._roomRows = nextRows;
    this.filterRooms();
    this._roomsT = setTimeout(() => this.pollRooms(), 3000);
  },

  // ── room: the chat panel is built once per room and survives updates, so a half-typed message is
  //    never wiped when the other player readies up.
  renderRoom() {
    const r = Multiplayer.room;
    if (!this.roomEl || !this.roomEl.isConnected || this.roomCode !== r.code) this.buildRoom();
    this.refreshRoom();
  },
  buildRoom() {
    const r = Multiplayer.room;
    this.roomCode = r.code;
    clearEl(this.body);
    this.headEl = h('div.mp-head'); this.resEl = h('div'); this.mapEl = h('div'); this.playersEl = h('div'); this.footEl = h('div.mp-footer');
    // chat
    this.chatList = h('div.mp-chat-list');
    for (const m of Multiplayer.chat) this.appendChat(m, false);
    const input = h('input.input', { placeholder: 'Type a message…', maxlength: 300, 'aria-label': 'Chat message' });
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && input.value.trim()) { Multiplayer.send({ t: 'chat', text: input.value }); input.value = ''; } if (e.key === 'Escape') input.blur(); });
    const chat = h('div.mp-tabpane', this.chatList, input);
    const side = h('div.mp-side', h('div.mp-tabs', h('span.mp-tab.on', 'Chat')), chat);
    this.roomEl = h('div.mp-room', this.headEl, this.resEl, h('div.mp-grid', h('div.mp-left', this.mapEl, this.playersEl), side));
    this.body.append(this.roomEl, this.footEl);
    requestAnimationFrame(() => { if (this.chatList) this.chatList.scrollTop = this.chatList.scrollHeight; });
  },
  refreshRoom() {
    if (Multiplayer.isQP()) { this.refreshQP(); return; }
    this._qpKey = null;
    const r = Multiplayer.room, me = Multiplayer.self(), host = Multiplayer.isHost();
    const st = r.settings || { type: 'h2h', win: 'pp', size: 2, queue: 'host' };
    const copy = h('button.btn.sm', { onclick: () => { navigator.clipboard && navigator.clipboard.writeText(r.code); Toast.ok('Room code copied', r.code); } }, icon('copy'), 'Copy code');
    const invite = h('button.btn.sm.primary.mp-invite', { title: 'Invite someone who\'s online, or share a link', onclick: () => { UISounds.click(); Presence.openInvite(); } }, icon('multi'), 'Invite');
    const reconnecting = Multiplayer.reconnecting ? h('span.mp-reconnecting', h('span.spinner'), 'Reconnecting…') : null;
    // the room's rules at a glance (lazer's match settings); the host can change them
    const WIN = { pp: 'pp', score: 'Score', accuracy: 'Accuracy', combo: 'Max combo' };
    const rules = h('div.mp-rules',
      h('span.mp-rule', icon('user'), 'Head to Head'),
      h('span.mp-rule', icon('trophy'), `Highest ${WIN[st.win] || 'score'} wins`),
      h('span.mp-rule', `${r.players.length}/${st.size} players`),
      h('span.mp-rule', icon(st.public === false ? 'lock' : 'globe'), st.public === false ? 'Private' : 'Public'));
    clearEl(this.headEl).append(...[h('div', h('div.mp-room-label', Multiplayer.quick ? 'Quick 1v1' : 'Room'), h('div.mp-room-code', r.code)), reconnecting, rules, h('div.grow'), invite, copy].filter(Boolean));

    // beatmap panel
    const map = r.map, local = map ? Multiplayer.localMap(map) : null;
    const bg = h('div.mp-map-bg');
    if (local) BeatmapManager.bgURL(local).then(u => u && (bg.style.backgroundImage = `url("${u}")`));
    else if (map && map.onlineSetId > 0) bg.style.backgroundImage = `url("${OnlineBeatmaps.coverURL(map.onlineSetId, 'cover')}")`;
    const mapInfo = map ? [h('div.mp-map-t', map.title), h('div.mp-map-a', map.artist), h('div.mp-map-d', starBadge(map.stars), h('span', map.version), h('span.keys-tag', `${map.keys}K`),
      ...(r.mods || []).map(m => ModSystem.badge(m, true)))] : [h('div.mp-map-t', 'No beatmap selected'), h('div.mp-map-a', host ? 'Pick one from song select or search beatmaps.' : 'Waiting for the host to pick a beatmap — you can search beatmaps and recommend one.')];
    const mapActions = h('div.mp-map-actions');
    if (host) mapActions.append(h('button.btn', { onclick: () => Screens.go('songselect', { mpPick: true }) }, icon('music'), map ? 'Change beatmap' : 'Select beatmap'));
    // the real Browse screen (Beatmap Explorer), in "pick for this room" mode
    mapActions.append(h('button.btn', { onclick: () => Screens.go('explore', { mpPick: true }) }, icon('search'), 'Search beatmaps'));
    const status = h('div.mp-map-status');
    this.fetchEl = null;
    if (map && !local) {
      const f = Multiplayer.fetch;
      if (!(map.onlineSetId > 0)) status.append(h('span.mp-warn', 'You don\'t have this beatmap and it has no online ID — import it to play.'));
      else if (f && f.onlineSetId === map.onlineSetId && f.error) status.append(h('span.mp-warn', `Download failed: ${f.error}`), h('button.btn.sm', { onclick: () => { Multiplayer.fetch = null; Multiplayer.autoFetch(); this.refreshRoom(); } }, 'Retry'));
      else { this.fetchEl = h('span'); status.append(h('span.spinner'), this.fetchEl); this.updateFetch(); }
    } else if (local && Multiplayer.isTemp(map)) {
      status.append(h('span.mp-temp', 'Installed for this room — removed when you leave'), h('button.btn.sm', { onclick: () => Multiplayer.keepTemp() }, 'Keep'));
    }
    // each player chooses their own difficulty from the room's beatmap set
    let diffPick = null;
    if (local) {
      const set = BeatmapManager.setById.get(local.setId);
      const diffs = set ? set.maps.filter(m => !m.problems.length).sort((a, b) => a.stars - b.stars) : [local];
      const mine = Multiplayer.myMap() || local;
      // a set with a single difficulty has nothing to choose (the picker would only look like it does something)
      if (diffs.length > 1) {
        const sel = h('select.select', { 'aria-label': 'Your difficulty' }, ...diffs.map(m => h('option', { value: m.id, selected: m.id === mine.id }, `${m.version} · ${m.keys}K · ★${m.stars.toFixed(2)}${m.id === local.id ? ' (room)' : ''}`)));
        sel.addEventListener('change', () => { UISounds.click(); Multiplayer.chooseDiff(sel.value); });
        sel.addEventListener('keydown', e => e.stopPropagation());
        diffPick = h('label.mp-diff', h('span', 'Your difficulty'), sel);
      }
    }
    // mods: the room's speed (DT, HT… — everyone must accept) and this player's own mods
    const myMods = (me && me.mods) || [];
    const badges = (list, none) => list.length ? list.map(m => ModSystem.badge(m, true)) : [h('span.mp-none', none)];
    const modsRow = h('div.mp-mods',
      h('div.mp-modline', h('span.mp-modlabel', 'Speed'), ...badges(r.mods || [], 'Normal')),
      h('div.mp-modline', h('span.mp-modlabel', 'Your mods'), ...badges(myMods, 'None')),
      h('span.grow'),
      h('button.btn.sm.mp-mods-btn', { onclick: () => this.openMods() }, icon('mods'), 'Mods'));
    let voteEl = null;
    if (r.vote) {
      const by = r.players.find(p => p.id === r.vote.by), what = r.vote.mods.length ? r.vote.mods.join('') : 'no speed mods';
      const mine = r.vote.yes.includes(Multiplayer.me);
      const vkey = JSON.stringify([r.vote.by, r.vote.mods]), vseen = this._voteSeen === vkey; this._voteSeen = vkey;
      voteEl = h(`div.mp-vote${vseen ? '.still' : ''}`, icon('mods'),
        mine ? h('span', `Waiting for everyone to accept ${what} (${r.vote.yes.length}/${r.players.length})`)
          : h('span', h('b', by ? by.name : 'Someone'), ` wants to play with ${what}`),
        h('span.grow'),
        mine ? null : h('button.btn.sm.primary.mp-accept', { onclick: () => { UISounds.click(); Multiplayer.vote(true); } }, 'Accept'),
        mine ? null : h('button.btn.sm.mp-decline', { onclick: () => { UISounds.click(); Multiplayer.vote(false); } }, 'Decline'));
    }
    clearEl(this.mapEl).append(h('div.mp-map', bg, h('div.mp-map-body', ...mapInfo, diffPick, modsRow, voteEl, mapActions, status.childNodes.length ? status : null)));

    // players
    const slot = p => {
      if (!p) return h('div.mp-player.empty', h('div.mp-avatar', icon('user')), h('div.mp-pname', r.players.length < 2 ? 'Waiting for an opponent…' : `${st.size - r.players.length} open slot${st.size - r.players.length > 1 ? 's' : ''}`), r.players.length < 2 ? h('span.spinner') : null);
      const isMe = p.id === Multiplayer.me;
      const state = !r.map ? '' : !p.hasMap ? 'Missing beatmap' : p.ready ? 'Ready' : 'Not ready';
      return h(`div.mp-player${p.ready ? '.ready' : ''}${p.team === 0 ? '.red' : p.team === 1 ? '.blue' : ''}`,
        isMe ? ProfileManager.avatarEl(44) : Presence.avatarEl(p, 44),
        h('div', h('div.mp-pname', p.name, isMe ? h('span.muted', ' (you)') : null, p.id === r.host ? h('span.mp-host', 'HOST') : null),
          r.map ? h('div.mp-pdiff', p.diff ? `${p.diff.version} · ★${p.diff.stars.toFixed(2)}` : `${r.map.version} · ★${r.map.stars.toFixed(2)}`,
            ...(p.mods || []).map(m => ModSystem.badge(m, true))) : null),
        h('span.grow'), state ? h(`span.mp-state${p.ready ? '.on' : !p.hasMap ? '.warn' : ''}`, state) : null);
    };
    const open = r.players.length < st.size ? slot(null) : null;
    if (st.type === 'teams') {
      // Team Versus: red and blue lists, each with a button to move over
      const team = t => {
        const list = r.players.filter(p => p.team === t);
        const mine = me && me.team === t;
        return h(`div.mp-team.${t ? 'blue' : 'red'}`, h('div.mp-team-h', h('span', t ? 'Blue team' : 'Red team'), h('span.muted', `${list.length}`), h('span.grow'),
          mine || !me ? null : h('button.btn.sm.mp-team-join', { onclick: () => { UISounds.click(); Multiplayer.setTeam(t); } }, 'Join')), ...list.map(slot));
      };
      clearEl(this.playersEl).append(h('div.mp-players', h('h3', 'Players'), h('div.mp-teams', team(0), team(1)), open));
    } else clearEl(this.playersEl).append(h('div.mp-players', h('h3', 'Players'), ...r.players.map(slot), open));

    clearEl(this.resEl);
    if (Multiplayer.lastResults) this.resEl.append(this.resultsPanel(Multiplayer.lastResults));

    const allReady = r.players.length >= 2 && r.players.every(p => p.ready && p.hasMap);
    const readyBtn = h(`button.mp-ready${me && me.ready ? '.on' : ''}`, {
      disabled: !r.map || !me || !me.hasMap,
      onclick: () => { UISounds.click(); Multiplayer.send({ t: 'ready', ready: !(me && me.ready) }); },
    }, me && me.ready ? 'Not ready' : 'Ready');
    const startBtn = host ? h('button.mp-start', { disabled: !allReady || !!r.vote, title: r.vote ? 'Everyone has to accept or decline the speed mod first' : allReady ? '' : 'Everyone must be ready', onclick: () => { UISounds.click(); Multiplayer.send({ t: 'start' }); } }, 'Start match') : null;
    clearEl(this.footEl).append(...[h('div.grow'), readyBtn, startBtn].filter(Boolean));
  },

  /** The mod select, for this player's mods in the room; a speed mod picked there is proposed to the room. */
  openMods() {
    const r = Multiplayer.room, me = Multiplayer.self();
    if (!r) return;
    Settings.set('songselect.mods', ModSystem.normalize([...(r.mods || []), ...((me && me.mods) || [])]));
    const off = Bus.on('mods:changed', () => { off(); if (Multiplayer.inRoom()) Multiplayer.setMods(Settings.get('songselect.mods') || []); });
    ModSelect.open();
  },
  updateFetch() {
    const f = Multiplayer.fetch;
    if (this.fetchEl && f) this.fetchEl.textContent = ` Downloading the beatmap for this room… ${f.progress != null ? Math.round(f.progress * 100) + '%' : ''}`;
  },
  appendChat(m, scroll = true) {
    if (!this.chatList || !this.chatList.isConnected && scroll) return;
    let el;
    if (m.suggest) {
      const map = m.suggest;
      const pick = Multiplayer.isHost() ? h('button.btn.sm.primary', { onclick: async () => {
        pick.disabled = true;
        try {
          let local = Multiplayer.localMap(map);
          if (!local && map.onlineSetId > 0) { pick.textContent = 'Downloading…'; await OnlineBeatmaps.downloadAndImport({ id: map.onlineSetId, title: map.title, artist: map.artist }); local = Multiplayer.localMap(map); }
          if (!local) throw new Error('Beatmap not available.');
          Multiplayer.selectMap(local, Settings.get('songselect.mods') || []);
        } catch (e) { Toast.err('Couldn\'t pick that beatmap', e.message); }
        pick.disabled = false; pick.textContent = 'Pick';
      } }, 'Pick') : null;
      el = h('div.mp-msg.suggest', h('b', m.name), h('span', 'recommended ', h('i', `${map.artist} - ${map.title} [${map.version}]`)), pick);
    } else el = m.from ? h('div.mp-msg', h('b', m.name), h('span', m.text)) : h('div.mp-msg.sys', m.text);
    this.chatList.append(el);
    if (scroll) this.chatList.scrollTop = this.chatList.scrollHeight;
  },
  resultsPanel(res) {
    const meId = Multiplayer.me, mine = res.rows.find(x => x.id === meId);
    const WIN = { pp: 'pp', score: 'score', accuracy: 'accuracy', combo: 'max combo' };
    const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
    let verdict, cls;
    if (res.teams) {
      const my = mine ? mine.team : null;
      verdict = res.winnerTeam === null ? 'Draw' : res.winnerTeam === my ? 'Your team wins!' : my == null ? `${res.winnerTeam ? 'Blue' : 'Red'} team wins` : 'Your team lost';
      cls = res.winnerTeam === null ? 'draw' : res.winnerTeam === my ? 'won' : 'lost';
    } else if (res.rows.length > 2 && mine) {
      verdict = mine.place === 1 && res.winner === meId ? 'You win!' : `You placed ${ord(mine.place)}`;
      cls = mine.place === 1 ? 'won' : mine.place <= Math.ceil(res.rows.length / 2) ? 'draw' : 'lost';
    } else {
      verdict = res.winner === null ? 'Draw' : res.winner === meId ? 'You win!' : 'You lose';
      cls = res.winner === null ? 'draw' : res.winner === meId ? 'won' : 'lost';
    }
    const val = x => res.win === 'score' ? fmtScore(x.score) : res.win === 'accuracy' ? fmtAcc(x.accuracy) : res.win === 'combo' ? `${fmtInt(x.maxCombo)}x` : `${fmtInt(x.pp || 0)}pp`;
    const row = x => h(`div.mp-res-row${x.id === res.winner || (res.teams && x.team === res.winnerTeam) ? '.win' : ''}${x.team === 0 ? '.red' : x.team === 1 ? '.blue' : ''}`,
      res.rows.length > 2 || res.teams ? h('span.mp-res-place', `#${x.place || '–'}`) : null,
      x.pending ? h('span.grade', '—') : rankPill(x.forfeit ? 'F' : x.grade || 'D'),
      h('div.main', h('div.t', x.name, x.id === meId ? h('span.muted', ' (you)') : null), h('div.s', x.forfeit ? (x.left ? 'left the match' : 'forfeited') : x.pending ? 'won by forfeit' : `${fmtScore(x.score)} · ${fmtAcc(x.accuracy)} · ${fmtInt(x.maxCombo)}x${x.diff ? ` · ${x.diff.version}` : res.map ? ` · ${res.map.version}` : ''}`)),
      x.points != null ? h('span.mp-res-pts', `+${x.points}`) : null,
      h('div.mp-res-score', val(x)));
    const fmtT = v => res.win === 'score' ? fmtScore(v) : res.win === 'accuracy' ? fmtAcc(v) : res.win === 'combo' ? `${fmtInt(v)}x` : `${fmtInt(v)}pp`;
    const teamBar = res.teams ? h('div.mp-res-teams', h('span.red', 'Red ', h('b', fmtT(res.teams[0].total))), h('span.muted', `by ${WIN[res.win] || 'pp'}`), h('span.blue', h('b', fmtT(res.teams[1].total)), ' Blue')) : null;
    // the room re-renders on every update: the panel slides in the first time it shows these results, then stays put
    const seen = this._resSeen === res; this._resSeen = res;
    return h(`div.mp-results.${cls}${seen ? '.still' : ''}`,
      h('div.mp-verdict', verdict, h('button.icon-btn', { title: 'Dismiss', onclick: () => { Multiplayer.lastResults = null; clearEl(this.resEl); } }, icon('x'))),
      teamBar, ...res.rows.map(row));
  },

  /** Match settings (osu!lazer's MatchSettingsOverlay, host only): match type, win condition, room size, queue mode.
   *  Every change goes to the room straight away. */
  openSettings() {
    const r = Multiplayer.room;
    if (!r) return;
    const body = h('div.mp-set');
    const seg = (label, key, opts) => {
      const cur = (Multiplayer.room.settings || {})[key];
      return h('div.mp-set-row', h('div.mp-set-l', label), h('div.mp-seg', ...opts.map(([v, t, sub]) => h(`button.mp-seg-b${cur === v ? '.on' : ''}`, {
        onclick: () => { UISounds.click(); Multiplayer.setSettings({ [key]: v }); } }, h('b', t), sub ? h('small', sub) : null))));
    };
    const paint = () => {
      if (!Multiplayer.room) return;
      const st = Multiplayer.room.settings || {};
      const size = h('select.select', { 'aria-label': 'Room size' }, ...[2, 3, 4, 5, 6, 7, 8].map(n => h('option', { value: n, selected: n === st.size, disabled: n < Multiplayer.room.players.length }, `${n} players`)));
      size.addEventListener('change', () => { UISounds.click(); Multiplayer.setSettings({ size: +size.value }); });
      size.addEventListener('keydown', e => e.stopPropagation());
      clearEl(body).append(
        seg('Match type', 'type', [['h2h', 'Head to Head', 'everyone for themselves'], ['teams', 'Team Versus', 'red vs blue, totals win']]),
        seg('Win condition', 'win', [['pp', 'pp', 'fair across difficulties'], ['score', 'Score'], ['accuracy', 'Accuracy'], ['combo', 'Max combo']]),
        seg('Queue mode', 'queue', [['host', 'Host picks'], ['rotate', 'Host rotates', 'after each match']]),
        seg('Visibility', 'public', [[true, 'Public', 'listed in the lobby'], [false, 'Private', 'join with the code']]),
        h('div.mp-set-row', h('div.mp-set-l', 'Room size'), size));
    };
    paint();
    const off = Bus.on('mp:changed', paint);
    const o = Dialog.custom('Match settings', body, [{ label: 'Done' }]);
    const close = o.close; o.close = () => { off(); close(); };
  },

  // ── Quick Play: one screen that follows the round (lobby → pool → pick → roulette → load → play → standings)
  refreshQP() {
    const r = Multiplayer.room, q = r.qp;
    const PH = { gather: 'Waiting for players', pool: 'Preparing beatmaps', pick: 'Pick a beatmap', reveal: 'Rolling…', load: 'Getting ready', playing: 'Match in progress', standings: 'Round results', final: 'Final standings' };
    this.qpTimer = h('span.qp-timer');
    const reconnecting = Multiplayer.reconnecting ? h('span.mp-reconnecting', h('span.spinner'), 'Reconnecting…') : null;
    clearEl(this.headEl).append(...[h('div', h('div.mp-room-label', `Quick Play · ${q.keys}K`), h('div.mp-room-code.qp-round', q.phase === 'gather' ? 'Lobby' : q.phase === 'final' ? 'Finished' : `Round ${q.round} / ${q.rounds}`)),
      reconnecting, h('div.grow'), h('div.qp-phase', PH[q.phase] || '', this.qpTimer)].filter(Boolean));
    const key = `${q.round}|${q.phase}`;
    if (this._qpKey !== key || !this.qpStage || !this.qpStage.isConnected) {
      this._qpKey = key;
      this.qpStage = h(`div.qp-stage.${q.phase}`);
      clearEl(this.mapEl).append(this.qpStage);
      this.qpBuild(r);
    } else this.qpUpdate(r);
    // standings, with this round's points while its results are up
    const res = Multiplayer.lastResults && Multiplayer.lastResults.qp && Multiplayer.lastResults.qp.round === q.round ? Multiplayer.lastResults : null;
    const gained = res && (q.phase === 'standings' || q.phase === 'final') ? Object.fromEntries(res.rows.map(x => [x.id, x.points])) : {};
    const list = r.players.map(p => ({ ...p, points: q.points[p.id] || 0 })).sort((a, b) => b.points - a.points);
    clearEl(this.playersEl).append(h('div.mp-players.qp-standings', h('h3', 'Standings'), ...list.map((p, i) => h(`div.qp-st-row${p.id === Multiplayer.me ? '.me' : ''}`,
      h('span.qp-st-pos', `#${i + 1}`), h('span.qp-av.pic', Presence.avatarEl(p, 22)), h('span.qp-st-name', p.name, p.id === Multiplayer.me ? h('span.muted', ' (you)') : null),
      gained[p.id] != null ? h('span.qp-st-gain', `+${gained[p.id]}`) : null, h('span.qp-st-pts', `${p.points}`, h('small', ' pts'))))));
    clearEl(this.resEl);
    if (res && q.phase === 'standings') this.resEl.append(this.resultsPanel(res));
    const again = h('button.mp-start.qp-again', { onclick: () => { UISounds.click(); Multiplayer.leave(true); this.render(); } }, 'Back to the lobby');
    const leave = h('button.mp-ready.on', { onclick: () => { UISounds.click(); Multiplayer.leave(); } }, 'Leave');
    clearEl(this.footEl).append(...(q.phase === 'final' ? [h('div.grow'), leave, again] : [h('div.qp-foot-note', q.phase === 'gather' ? 'The first round starts once enough players are in.' : 'Leaving forfeits the rest of the match.'), h('div.grow')]));
    this.qpTick();
  },
  /** The per-second countdown in the header (and the pick timer bar). */
  qpTick() {
    const left = Math.max(0, (Multiplayer.qpEndAt - performance.now()) / 1000);
    if (this.qpTimer && this.qpTimer.isConnected) this.qpTimer.textContent = Multiplayer.qpEndAt && left > 0 ? `${Math.ceil(left)}s` : '';
  },
  qpCard(m, i) {
    const local = Multiplayer.localMap(m);
    const bg = h('div.qp-card-bg');
    if (m.onlineSetId > 0) bg.style.backgroundImage = `url("${OnlineBeatmaps.coverURL(m.onlineSetId, 'cover')}")`;
    else if (local) BeatmapManager.bgURL(local).then(u => u && (bg.style.backgroundImage = `url("${u}")`));
    const len = m.length > 0 ? `${Math.floor(m.length / 60000)}:${String(Math.floor(m.length / 1000) % 60).padStart(2, '0')}` : '';
    return h('button.qp-card', { 'data-i': i, onclick: () => { const q = Multiplayer.room && Multiplayer.room.qp; if (q && q.phase === 'pick') { UISounds.click(); Multiplayer.pick(i); } } }, bg,
      h('div.qp-card-body', h('div.qp-card-top', starBadge(m.stars), h('span.keys-tag', `${m.keys}K`), len ? h('span.qp-len', len) : null),
        h('div.qp-card-t', m.title), h('div.qp-card-a', m.artist), h('div.qp-card-v', m.version)),
      h('div.qp-pickers'));
  },
  qpBuild(r) {
    const q = r.qp, st = this.qpStage;
    if (q.phase === 'pick' || q.phase === 'reveal') {
      this.qpCards = (q.pool || []).map((m, i) => this.qpCard(m, i));
      st.append(h('div.qp-hint', q.phase === 'pick' ? 'Pick the beatmap you want to play — a roulette chooses between everyone\'s picks.' : 'Rolling between everyone\'s picks…'), h('div.qp-grid', ...this.qpCards));
      this.qpUpdate(r);
      if (q.phase === 'reveal') this.qpRoulette(q);
      return;
    }
    this.qpUpdate(r);
  },
  qpUpdate(r) {
    const q = r.qp, st = this.qpStage, me = Multiplayer.me;
    if (q.phase === 'pick' || q.phase === 'reveal') {
      (this.qpCards || []).forEach((c, i) => {
        const who = r.players.filter(p => q.picks[p.id] === i);
        c.classList.toggle('mine', q.picks[me] === i);
        c.classList.toggle('picked', who.length > 0);
        clearEl(c.querySelector('.qp-pickers')).append(...who.map(p => h('span.qp-av.pic', { title: p.name }, Presence.avatarEl(p, 22))));
      });
      return;
    }
    const n = r.players.length;
    const avatars = h('div.qp-avatars', ...r.players.map(p => h(`span.qp-av.lg.pic${p.id === me ? '.me' : ''}`, { title: p.name }, Presence.avatarEl(p, 46))));
    if (q.phase === 'gather') {
      clearEl(st).append(h('div.qp-big', h('span.spinner'), n < 2 ? 'Looking for players…' : 'Starting soon'),
        h('div.qp-sub', `${n} of 8 in the lobby${n < 2 ? ' — the countdown starts when someone else joins' : ''}`), avatars);
    } else if (q.phase === 'pool') {
      clearEl(st).append(h('div.qp-big', h('span.spinner'), 'Preparing beatmaps…'), h('div.qp-sub', `${(r.players.find(p => p.id === r.host) || {}).name || 'The host'} is finding ${q.keys}K maps that suit the lobby`));
    } else if (q.phase === 'load' || q.phase === 'playing') {
      const m = r.map, card = m ? this.qpCard(m, q.chosen) : null;
      if (card) card.classList.add('chosen', 'wide');
      const f = Multiplayer.fetch;
      const mineTxt = !m ? '' : Multiplayer.localMap(m) ? 'Ready' : f && f.error ? `Download failed: ${f.error}` : f && f.progress != null ? `Downloading… ${Math.round(f.progress * 100)}%` : 'Getting the beatmap…';
      clearEl(st).append(card, q.phase === 'playing' ? h('div.qp-big', 'Match in progress') : h('div.qp-sub', mineTxt),
        h('div.qp-load', ...r.players.map(p => h(`div.qp-load-row${p.hasMap ? '.ok' : ''}`, h('span.qp-av.pic', Presence.avatarEl(p, 22)), h('span', p.name), h('span.grow'), h('span.qp-load-st', q.phase === 'playing' ? (p.playing ? 'Playing' : 'Sitting out') : p.hasMap ? 'Ready' : 'Downloading…')))));
    } else if (q.phase === 'standings') {
      clearEl(st).append(h('div.qp-big', q.round >= q.rounds ? 'Last round done!' : `Round ${q.round} done`), h('div.qp-sub', q.round >= q.rounds ? 'Final standings in a moment…' : 'The next round starts in a moment.'));
    } else if (q.phase === 'final') {
      const list = r.players.map(p => ({ ...p, points: q.points[p.id] || 0 })).sort((a, b) => b.points - a.points);
      const myPlace = list.findIndex(p => p.id === me) + 1;
      const step = (p, place) => p ? h(`div.qp-podium-step.p${place}${p.id === me ? '.me' : ''}`, h('span.qp-av.lg.pic', Presence.avatarEl(p, 46)), h('b', p.name), h('span', `${p.points} pts`), h('div.qp-podium-block', `${place}`)) : h('div.qp-podium-step.empty');
      clearEl(st).append(h('div.qp-big', myPlace === 1 ? 'You won Quick Play!' : myPlace ? `You finished #${myPlace}` : 'Quick Play is over'),
        h('div.qp-podium', step(list[1], 2), step(list[0], 1), step(list[2], 3)));
    }
  },
  /** lazer's roulette: the highlight runs across the picked maps, slowing down until it lands on the chosen one. */
  qpRoulette(q) {
    const cards = this.qpCards || [];
    const cand = [...new Set(Object.values(q.picks))].sort((a, b) => a - b);
    const list = cand.length ? cand : cards.map((_, i) => i);
    const steps = list.length > 1 ? 16 + list.length : 1;
    const at = list.indexOf(q.chosen), start = ((at - (steps - 1)) % list.length + list.length * 64) % list.length;
    let n = 0;
    const tok = this._qpRoll = {};
    const step = () => {
      if (this._qpRoll !== tok || !cards.length || !cards[0].isConnected) return;
      const i = list[(start + n) % list.length];
      cards.forEach((c, k) => c.classList.toggle('hl', k === i));
      if (++n < steps) { UISounds.hover(); setTimeout(step, 55 + 360 * (n / steps) ** 2.4); }
      else { cards[q.chosen] && cards[q.chosen].classList.add('chosen'); UISounds.play('check-on'); }
    };
    step();
  },
};

