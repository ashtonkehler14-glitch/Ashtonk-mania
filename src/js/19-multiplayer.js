/* Online 1v1 multiplayer (osu!lazer-style room). Talks to the Worker's Durable Objects over a
 * WebSocket (/api/mp/room/<code>); see worker/multiplayer.js for the protocol and room rules. */

const Multiplayer = {
  ws: null, room: null, me: null, code: null, quick: false,
  chat: [], opp: null, lastResults: null, rtt: 80, _keep: 0,
  temp: new Set(),   // beatmap sets downloaded automatically for this room (removed again when leaving)
  fetch: null,       // {onlineSetId, progress, error, done} — the automatic download of the room's beatmap
  myDiffId: null,    // the difficulty (local map id) this player chose from the room's beatmap set

  available() { return /^https?:$/.test(location.protocol); },
  inRoom() { return !!(this.ws && this.room); },
  isHost() { return !!this.room && this.room.host === this.me; },
  opponent() { return this.room ? this.room.players.find(p => p.id !== this.me) || null : null; },
  self() { return this.room ? this.room.players.find(p => p.id === this.me) || null : null; },

  async api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Server error (${r.status})`);
    return d;
  },
  async create() { const { code } = await this.api('api/mp/new'); return this.connect(code, true); },
  join(code) { return this.connect(String(code).trim().toUpperCase(), false); },
  /** Quick match: host a waiting room or join the one someone else is waiting in. */
  async quickMatch() {
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { code, host } = await this.api('api/mp/quick', { not: last });
      try { await this.connect(code, host, true); return; } catch (e) { if (host) throw e; last = code; }
    }
    throw new Error('Couldn\'t find a match — try again.');
  },

  connect(code, create, quick = false) {
    this.leave(true);
    return new Promise((resolve, reject) => {
      const u = new URL(`api/mp/room/${encodeURIComponent(code)}`, location.href);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;
      try { ws = new WebSocket(u); } catch (e) { reject(e); return; }
      this.ws = ws; this.code = code; this.quick = quick; this.chat = []; this.lastResults = null; this.opp = null;
      let settled = false;
      const fail = msg => { if (!settled) { settled = true; reject(new Error(msg)); } };
      ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', name: ProfileManager.profile.name, create })); this.ping(); };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') { this.me = m.you; this.room = m.room; settled = true; resolve(); this.startKeepAlive(); this.autoFetch(); Bus.emit('mp:changed'); return; }
        if (m.t === 'error' && m.fatal) { fail(m.msg); return; }
        this.onMessage(m);
      };
      ws.onerror = () => fail('Couldn\'t reach the multiplayer server.');
      ws.onclose = () => {
        fail('Connection closed.');
        if (this.ws !== ws) return;
        const wasIn = !!this.room;
        this.ws = null; this.room = null; this.stopKeepAlive();
        if (wasIn) { Toast.err('Disconnected from the room'); Bus.emit('mp:changed'); if (Screens.currentName === 'multiplayer') MultiplayerScreen.render(); }
      };
    });
  },
  leave(silent = false) {
    this.stopKeepAlive();
    this.myDiffId = null; this.fetch = null;
    if (this.temp.size) this.cleanupTemp();
    if (this.quick && this.code && this.room && this.room.players.length < 2) this.api('api/mp/quick/cancel', { code: this.code }).catch(() => {});
    const ws = this.ws;
    this.ws = null; this.room = null; this.me = null; this.opp = null;
    if (ws) { try { ws.close(1000, 'leave'); } catch { /* already closed */ } }
    if (!silent) Bus.emit('mp:changed');
  },
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
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
        const hadOpp = !!this.opponent();
        const prevHash = this.room && this.room.map && this.room.map.hash;
        this.room = m.room;
        if ((m.room.map && m.room.map.hash) !== prevHash) this.myDiffId = null;
        this.syncHasMap();
        this.autoFetch();
        if (!hadOpp && this.opponent()) UISounds.click();
        Bus.emit('mp:changed');
        break;
      }
      case 'chat': this.chat.push(m); if (this.chat.length > 200) this.chat.shift(); Bus.emit('mp:chat', m); break;
      case 'pong': if (m.c === this._pingAt) this.rtt = performance.now() - m.c; break;
      case 'opp': this.opp = m; break;
      case 'start': this.launch(m); break;
      case 'results':
        this.lastResults = m.results;
        if (Screens.currentName === 'gameplay' && GameplayScreen.s && GameplayScreen.s.mp && !GameplayScreen.s.finished) {
          const won = m.results.winner === this.me;
          Toast.show(won ? 'Your opponent left — you win!' : 'Match ended', 'Finish the map or press Esc to return to the room.');
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
    if (!map || this.isHost() || this.localMap(map) || !(map.onlineSetId > 0)) return;
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
  selectMap(m, mods) {
    const set = BeatmapManager.setById.get(m.setId);
    this.send({ t: 'map', map: { hash: m.hash, title: m.title, artist: m.artist, version: m.version, creator: m.creator, keys: m.keys, stars: m.stars, length: m.length,
      onlineSetId: set && set.onlineId > 0 ? set.onlineId : -1, onlineId: m.onlineId > 0 ? m.onlineId : -1 }, mods: mods.filter(x => x !== 'AT'), modConfig: ModSystem.config() });
  },
  launch(m) {
    const local = this.localMap(m.map) && this.myMap();
    if (!local) { Toast.err('Missing beatmap', 'You need the beatmap to play this match.'); this.send({ t: 'quit' }); return; }
    this.opp = null;
    const startAt = performance.now() + m.delay - this.rtt / 2;
    Game.launch({ mapId: local.id, mods: m.mods, modConfig: m.modConfig ? { ...ModSystem.config(), ...m.modConfig } : null, mode: 'play', mp: { startAt } });
  },
  finish(score, forfeit = false) {
    this.send({ t: 'finish', result: { score: score.score, accuracy: score.accuracy, maxCombo: score.maxCombo, counts: score.counts, grade: score.grade, passed: score.passed, pp: score.pp, forfeit } });
  },
};

// Leaving the multiplayer area (anything but the room, song select, gameplay or results) leaves the room.
Bus.on('screen:changed', name => {
  if (Multiplayer.inRoom() && !['multiplayer', 'songselect', 'gameplay', 'results'].includes(name)) { Multiplayer.leave(); Toast.show('Left the multiplayer room'); }
});
Bus.on('library:changed', () => Multiplayer.inRoom() && Multiplayer.syncHasMap());

/** Beatmap search used inside a room (the "Search songs" tab and the "Search beatmaps" popup): your library or
 *  osu! beatmaps online. The host picks directly (online maps download first); other players suggest. */
function makeRoomSearch(defaultSrc = 'local', onDone = null) {
  let src = defaultSrc, tok = null, timer = 0;
  const input = h('input.input', { type: 'search', placeholder: 'Search title, artist, mapper…', 'aria-label': 'Search beatmaps', spellcheck: 'false' });
  const list = h('div.mp-sr-list');
  const srcBtn = (id, label) => h(`button.chip${src === id ? '.on' : ''}`, { dataset: { src: id }, onclick: () => {
    src = id; $$('[data-src]', el).forEach(b => b.classList.toggle('on', b.dataset.src === id)); run(true); input.focus();
  } }, label);
  const el = h('div.mp-tabpane', h('div.row', h('div.mp-sr-box', icon('search'), input), srcBtn('local', 'My beatmaps'), srcBtn('online', 'Online')), list);
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') run(true); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(), src === 'online' ? 450 : 80); });

  const row = (info, local, set, host) => {
    const label = host ? 'Pick' : 'Suggest';
    const act = h('button.btn.sm' + (host ? '.primary' : ''), { onclick: async () => {
      act.disabled = true;
      try {
        let m = local;
        if (!m && set) {
          act.textContent = 'Downloading…';
          await OnlineBeatmaps.downloadAndImport(set, p => { if (p != null) act.textContent = `${Math.round(p * 100)}%`; });
          m = [...BeatmapManager.maps.values()].find(x => x.onlineId === info.onlineId) || null;
        }
        if (host) {
          if (!m) throw new Error('That difficulty couldn\'t be found after downloading.');
          Multiplayer.selectMap(m, Settings.get('songselect.mods') || []);
          Toast.ok('Beatmap picked', `${m.title} [${m.version}]`);
        } else {
          const s = m && BeatmapManager.setById.get(m.setId);
          Multiplayer.send({ t: 'suggest', map: m ? { hash: m.hash, title: m.title, artist: m.artist, version: m.version, creator: m.creator, keys: m.keys, stars: m.stars, length: m.length,
            onlineSetId: s && s.onlineId > 0 ? s.onlineId : info.onlineSetId || -1, onlineId: m.onlineId > 0 ? m.onlineId : info.onlineId || -1 } : { ...info } });
          Toast.show('Suggested to the host', `${info.title} [${info.version}]`);
        }
        if (onDone) onDone();
      } catch (e) { Toast.err(host ? 'Couldn\'t pick that beatmap' : 'Couldn\'t suggest that beatmap', e.message); }
      act.disabled = false; act.textContent = label;
    } }, label);
    return h('div.mp-sr-row', h('span.dp-icon', { style: { '--sc': starColour(info.stars) } }, `${info.keys}K`),
      h('div.main', h('div.t', `${info.title}`, h('span.muted', ` · ${info.artist}`)), h('div.s', h('span', { style: { color: starColour(info.stars) } }, `★ ${info.stars.toFixed(2)}`), ` ${info.version}`, local ? '' : ' · online')),
      act);
  };

  async function run(now = false) {
    const q = input.value.trim(), host = Multiplayer.isHost();
    api.host = host;
    const t = tok = {};
    if (src === 'local') {
      clearEl(list);
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      // every word must appear (title, artist, mapper, tags or difficulty name); the difficulty name counts most
      const collect = fuzzy => {
        const rows = [];
        for (const set of BeatmapManager.sets) {
          const hay = `${set.artist} ${set.artistUnicode || ''} ${set.title} ${set.titleUnicode || ''} ${set.creator} ${set.tags || ''}`.toLowerCase();
          for (const m of set.maps) {
            if (m.problems.length) continue;
            const ver = m.version.toLowerCase();
            let score = 1;
            for (const w of words) {
              const f = ver.includes(w) ? 3 : hay.includes(w) ? 2 : fuzzy ? fuzzyScore(hay + ' ' + ver, w) : 0;
              if (!f) { score = 0; break; }
              score += f;
            }
            if (score) rows.push({ m, set, score });
          }
        }
        return rows;
      };
      let rows = collect(false);
      if (!rows.length && words.length) rows = collect(true);
      rows.sort((a, b) => (b.score - a.score) || (b.set.added - a.set.added) || (a.m.stars - b.m.stars));
      if (!rows.length) { list.append(h('div.mp-sr-empty', BeatmapManager.sets.length ? 'No matches in your library — try Online.' : 'Your library is empty — search Online.')); return; }
      for (const { m } of rows.slice(0, 60)) list.append(row({ title: m.title, artist: m.artist, version: m.version, creator: m.creator, stars: m.stars, keys: m.keys }, m, null, host));
      return;
    }
    if (!q && !now) { clearEl(list).append(h('div.mp-sr-empty', 'Type to search osu!mania beatmaps online.')); return; }
    clearEl(list).append(h('div.mp-sr-empty', h('span.spinner'), ' Searching…'));
    try {
      const res = await OnlineBeatmaps.search({ q, keys: [], status: 'any', page: 0, minStars: 0, maxStars: 99, sort: '' });
      if (t !== tok) return;
      clearEl(list);
      if (!res.sets.length) { list.append(h('div.mp-sr-empty', 'No beatmaps found.')); return; }
      for (const set of res.sets.slice(0, 25)) {
        const owned = BeatmapManager.sets.find(s => s.onlineId === set.id);
        list.append(h('div.mp-sr-set', `${set.artist} - ${set.title}`, h('span.muted', ` · mapped by ${set.creator}`), owned ? h('span.tag.accent', 'IN LIBRARY') : null));
        for (const d of set.diffs.slice(0, 8)) {
          const local = owned ? owned.maps.find(m => m.onlineId === d.id) || null : null;
          list.append(row({ title: set.title, artist: set.artist, version: d.version, creator: set.creator, stars: d.stars, keys: d.keys, onlineSetId: set.id, onlineId: d.id }, local, set, host));
        }
      }
    } catch (e) {
      if (t !== tok) return;
      clearEl(list).append(h('div.mp-sr-empty.err', e.message));
    }
  }
  const api = { el, input, run, host: null };
  return api;
}

const MultiplayerScreen = {
  tab: 'multiplayer',
  enter() {
    this.el = h('div.mp');
    this.body = h('div.mp-body');
    this.el.append(this.body, h('div.page-back', backButton(() => this.onBack() || Screens.back())));
    this._unsub = [Bus.on('mp:changed', () => this.render()), Bus.on('mp:chat', m => this.appendChat(m)), Bus.on('mp:fetch', () => this.updateFetch())];
    this.render();
    return this.el;
  },
  leave() { (this._unsub || []).forEach(f => f()); },
  onBack() {
    if (Multiplayer.inRoom()) {
      Dialog.confirm('Leave room?', 'You will leave this multiplayer room.', { ok: 'Leave' }).then(ok => { if (ok) { Multiplayer.leave(); } });
      return true;
    }
    return false;
  },
  onKey(e) { return false; },
  render() {
    if (!this.body) return;
    if (Multiplayer.inRoom()) { this.renderRoom(); return; }
    this.roomEl = null;
    clearEl(this.body);
    this.renderLobby();
  },

  // ── lobby: quick match / create / join
  renderLobby() {
    const status = h('div.mp-status');
    const busy = async (label, fn) => {
      clearEl(status).append(h('span.spinner'), label);
      $$('button', this.body).forEach(b => b.disabled = true);
      try { await fn(); } catch (e) { clearEl(status).append(h('span.mp-err', e.message)); $$('button', this.body).forEach(b => b.disabled = false); }
    };
    const code = h('input.input.mp-code', { placeholder: 'ROOM CODE', maxlength: 8, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Room code' });
    code.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') joinBtn.click(); });
    code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    const joinBtn = h('button.btn', { onclick: () => code.value.length >= 4 && busy('Joining room…', () => Multiplayer.join(code.value)) }, 'Join');
    const card = (ic, title, sub, ...rest) => h('div.mp-card', h('div.mp-card-ico', icon(ic)), h('div.mp-card-t', title), h('div.mp-card-s', sub), ...rest);
    const offline = !Multiplayer.available();
    this.body.append(h('div.mp-lobby',
      h('h1', 'Multiplayer'), h('div.mp-sub', 'Play the same beatmap head-to-head against one other player.'),
      offline ? h('div.mp-note', 'Multiplayer needs the online server — open the game from its web address (the Cloudflare deployment).') : null,
      h('div.mp-cards',
        card('shuffle', 'Quick match', 'Get paired with the next player who is looking for a match.',
          h('button.btn.primary', { disabled: offline, onclick: () => busy('Looking for an opponent…', () => Multiplayer.quickMatch()) }, 'Find match')),
        card('plus', 'Create room', 'Make a private room and send the code to a friend.',
          h('button.btn', { disabled: offline, onclick: () => busy('Creating room…', () => Multiplayer.create()) }, 'Create')),
        card('multi', 'Join room', 'Enter the code your friend gave you.',
          h('div.row', code, joinBtn))),
      status));
    if (offline) $$('button', this.body).forEach(b => b.disabled = true);
  },

  // ── room: the chat and beatmap search panels are built once per room and survive updates, so a
  //    half-typed message or search is never wiped when the other player readies up.
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
    // beatmap search
    this.search = makeRoomSearch('local');
    const search = this.search.el;
    const tabs = [['Chat', chat], ['Search songs', search]];
    const tabBar = h('div.mp-tabs', ...tabs.map(([name, pane], i) => h(`button.mp-tab${i === 0 ? '.on' : ''}`, { onclick: e => {
      $$('.mp-tab', tabBar).forEach(b => b.classList.toggle('on', b === e.currentTarget));
      tabs.forEach(([, p]) => { p.hidden = p !== pane; });
      UISounds.click();
      if (pane === search) { this.search.input.focus(); this.search.run(); }
    } }, name)));
    search.hidden = true;
    const side = h('div.mp-side', tabBar, chat, search);
    this.roomEl = h('div.mp-room', this.headEl, this.resEl, h('div.mp-grid', h('div.mp-left', this.mapEl, this.playersEl), side));
    this.body.append(this.roomEl, this.footEl);
    requestAnimationFrame(() => { if (this.chatList) this.chatList.scrollTop = this.chatList.scrollHeight; });
  },
  refreshRoom() {
    const r = Multiplayer.room, me = Multiplayer.self(), opp = Multiplayer.opponent(), host = Multiplayer.isHost();
    const copy = h('button.btn.sm', { onclick: () => { navigator.clipboard && navigator.clipboard.writeText(r.code); Toast.ok('Room code copied', r.code); } }, icon('save'), 'Copy code');
    clearEl(this.headEl).append(h('div', h('div.mp-room-label', Multiplayer.quick ? 'Quick match' : 'Room'), h('div.mp-room-code', r.code)), h('div.grow'), copy);

    // beatmap panel
    const map = r.map, local = map ? Multiplayer.localMap(map) : null;
    const bg = h('div.mp-map-bg');
    if (local) BeatmapManager.bgURL(local).then(u => u && (bg.style.backgroundImage = `url("${u}")`));
    else if (map && map.onlineSetId > 0) bg.style.backgroundImage = `url("${OnlineBeatmaps.coverURL(map.onlineSetId, 'cover')}")`;
    const mapInfo = map ? [h('div.mp-map-t', map.title), h('div.mp-map-a', map.artist), h('div.mp-map-d', starBadge(map.stars), h('span', map.version), h('span.keys-tag', `${map.keys}K`),
      ...(r.mods || []).map(m => ModSystem.badge(m, true)))] : [h('div.mp-map-t', 'No beatmap selected'), h('div.mp-map-a', host ? 'Pick one from song select or search for one.' : 'Waiting for the host to pick a beatmap — you can search and suggest one.')];
    const mapActions = h('div.mp-map-actions');
    if (host) mapActions.append(h('button.btn', { onclick: () => Screens.go('songselect', { mpPick: true }) }, icon('music'), map ? 'Change beatmap' : 'Select beatmap'));
    mapActions.append(h('button.btn', { onclick: () => this.openSearch() }, icon('search'), 'Search beatmaps'));
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
      const sel = h('select.select', { 'aria-label': 'Your difficulty' }, ...diffs.map(m => h('option', { value: m.id, selected: m.id === mine.id }, `${m.version} · ${m.keys}K · ★${m.stars.toFixed(2)}${m.id === local.id ? ' (room)' : ''}`)));
      sel.addEventListener('change', () => { UISounds.click(); Multiplayer.chooseDiff(sel.value); });
      sel.addEventListener('keydown', e => e.stopPropagation());
      diffPick = h('label.mp-diff', h('span', 'Your difficulty'), sel);
    }
    clearEl(this.mapEl).append(h('div.mp-map', bg, h('div.mp-map-body', ...mapInfo, diffPick, mapActions, status.childNodes.length ? status : null)));

    // players
    const slot = p => {
      if (!p) return h('div.mp-player.empty', h('div.mp-avatar', icon('user')), h('div.mp-pname', 'Waiting for an opponent…'), h('span.spinner'));
      const isMe = p.id === Multiplayer.me;
      const state = !r.map ? '' : !p.hasMap ? 'Missing beatmap' : p.ready ? 'Ready' : 'Not ready';
      return h(`div.mp-player${p.ready ? '.ready' : ''}`,
        isMe ? ProfileManager.avatarEl(44) : h('div.avatar.avatar-mono', { style: { width: '44px', height: '44px', fontSize: '20px' } }, (p.name || '?').slice(0, 1).toUpperCase()),
        h('div', h('div.mp-pname', p.name, isMe ? h('span.muted', ' (you)') : null, p.id === r.host ? h('span.mp-host', 'HOST') : null),
          r.map ? h('div.mp-pdiff', p.diff ? `${p.diff.version} · ★${p.diff.stars.toFixed(2)}` : `${r.map.version} · ★${r.map.stars.toFixed(2)}`) : null),
        h('span.grow'), state ? h(`span.mp-state${p.ready ? '.on' : !p.hasMap ? '.warn' : ''}`, state) : null);
    };
    clearEl(this.playersEl).append(h('div.mp-players', h('h3', 'Players'), slot(me), slot(opp)));

    clearEl(this.resEl);
    if (Multiplayer.lastResults) this.resEl.append(this.resultsPanel(Multiplayer.lastResults));

    const allReady = r.players.length === 2 && r.players.every(p => p.ready && p.hasMap);
    const readyBtn = h(`button.mp-ready${me && me.ready ? '.on' : ''}`, {
      disabled: !r.map || !me || !me.hasMap,
      onclick: () => { UISounds.click(); Multiplayer.send({ t: 'ready', ready: !(me && me.ready) }); },
    }, me && me.ready ? 'Not ready' : 'Ready');
    const startBtn = host ? h('button.mp-start', { disabled: !allReady, title: allReady ? '' : 'Both players must be ready', onclick: () => { UISounds.click(); Multiplayer.send({ t: 'start' }); } }, 'Start match') : null;
    clearEl(this.footEl).append(...[h('div.grow'), readyBtn, startBtn].filter(Boolean));
    // host/guest can change (Pick ↔ Suggest)
    if (this.search && !this.search.el.hidden && this.search.host !== host) this.search.run();
  },

  updateFetch() {
    const f = Multiplayer.fetch;
    if (this.fetchEl && f) this.fetchEl.textContent = ` Downloading the beatmap for this room… ${f.progress != null ? Math.round(f.progress * 100) + '%' : ''}`;
  },
  /** "Search beatmaps" popup (the beatmap provider): pick or suggest a song without leaving the room. */
  openSearch() {
    UISounds.click();
    let o;
    const search = makeRoomSearch('online', () => o && o.close());
    const card = h('div.dialog.mp-search-dlg', { role: 'dialog', 'aria-label': 'Search beatmaps' },
      h('div.row', h('h2', 'Search beatmaps'), h('span.grow'), h('button.icon-btn', { title: 'Close', onclick: () => o.close() }, icon('x'))),
      h('div.muted', { style: { marginBottom: '8px' } }, Multiplayer.isHost() ? 'Pick the beatmap for this room — online beatmaps are downloaded for everyone.' : 'Find a beatmap and suggest it to the host.'),
      search.el);
    o = makeOverlay(card, {});
    setTimeout(() => search.input.focus(), 60);
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
      el = h('div.mp-msg.suggest', h('b', m.name), h('span', 'suggested ', h('i', `${map.artist} - ${map.title} [${map.version}]`)), pick);
    } else el = m.from ? h('div.mp-msg', h('b', m.name), h('span', m.text)) : h('div.mp-msg.sys', m.text);
    this.chatList.append(el);
    if (scroll) this.chatList.scrollTop = this.chatList.scrollHeight;
  },
  resultsPanel(res) {
    const meId = Multiplayer.me;
    const verdict = res.winner === null ? 'Draw' : res.winner === meId ? 'You win!' : 'You lose';
    const row = x => h(`div.mp-res-row${x.id === res.winner ? '.win' : ''}`,
      x.pending ? h('span.grade', '—') : gradeEl(x.forfeit ? 'F' : x.grade || 'D'),
      h('div.main', h('div.t', x.name, x.id === meId ? h('span.muted', ' (you)') : null), h('div.s', x.forfeit ? (x.left ? 'left the match' : 'forfeited') : x.pending ? 'won by forfeit' : `${fmtAcc(x.accuracy)} · ${fmtInt(x.maxCombo)}x${x.pp ? ` · ${fmtInt(x.pp)}pp` : ''}${x.diff ? ` · ${x.diff.version}` : res.map ? ` · ${res.map.version}` : ''}`)),
      h('div.mp-res-score', fmtScore(x.score)));
    return h(`div.mp-results.${res.winner === null ? 'draw' : res.winner === meId ? 'won' : 'lost'}`,
      h('div.mp-verdict', verdict, h('button.icon-btn', { title: 'Dismiss', onclick: () => { Multiplayer.lastResults = null; clearEl(this.resEl); } }, icon('x'))),
      ...res.rows.map(row));
  },
};
