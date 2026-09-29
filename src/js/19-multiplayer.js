/* Online 1v1 multiplayer (osu!lazer-style room). Talks to the Worker's Durable Objects over a
 * WebSocket (/api/mp/room/<code>); see worker/multiplayer.js for the protocol and room rules. */

const Multiplayer = {
  ws: null, room: null, me: null, code: null, quick: false,
  chat: [], opp: null, lastResults: null, rtt: 80, _keep: 0,

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
        if (m.t === 'welcome') { this.me = m.you; this.room = m.room; settled = true; resolve(); this.startKeepAlive(); Bus.emit('mp:changed'); return; }
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
        this.room = m.room;
        this.syncHasMap();
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
    const local = this.localMap(m.map);
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

const MultiplayerScreen = {
  tab: 'multiplayer',
  enter() {
    this.el = h('div.mp');
    this.body = h('div.mp-body');
    this.el.append(this.body, h('div.page-back', backButton(() => this.onBack() || Screens.back())));
    this._unsub = [Bus.on('mp:changed', () => this.render()), Bus.on('mp:chat', m => this.appendChat(m))];
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
    clearEl(this.body);
    if (Multiplayer.inRoom()) this.renderRoom(); else this.renderLobby();
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

  // ── room
  renderRoom() {
    const r = Multiplayer.room, me = Multiplayer.self(), opp = Multiplayer.opponent(), host = Multiplayer.isHost();
    const copy = h('button.btn.sm', { onclick: () => { navigator.clipboard && navigator.clipboard.writeText(r.code); Toast.ok('Room code copied', r.code); } }, icon('save'), 'Copy code');
    const head = h('div.mp-head', h('div', h('div.mp-room-label', Multiplayer.quick ? 'Quick match' : 'Room'), h('div.mp-room-code', r.code)), h('div.grow'), copy);

    // beatmap panel
    const map = r.map, local = map ? Multiplayer.localMap(map) : null;
    const bg = h('div.mp-map-bg');
    if (local) BeatmapManager.bgURL(local).then(u => u && (bg.style.backgroundImage = `url("${u}")`));
    else if (map && map.onlineSetId > 0) bg.style.backgroundImage = `url("${OnlineBeatmaps.coverURL(map.onlineSetId, 'cover')}")`;
    const mapInfo = map ? [h('div.mp-map-t', map.title), h('div.mp-map-a', map.artist), h('div.mp-map-d', starBadge(map.stars), h('span', map.version), h('span.keys-tag', `${map.keys}K`),
      ...(r.mods || []).map(m => ModSystem.badge(m, true)))] : [h('div.mp-map-t', 'No beatmap selected'), h('div.mp-map-a', host ? 'Pick one to play.' : 'Waiting for the host to pick a beatmap.')];
    const mapActions = h('div.mp-map-actions');
    if (host) mapActions.append(h('button.btn', { onclick: () => Screens.go('songselect', { mpPick: true }) }, icon('music'), map ? 'Change beatmap' : 'Select beatmap'));
    else if (map && !local) {
      if (map.onlineSetId > 0) {
        const dl = h('button.btn.primary', { onclick: async () => {
          dl.disabled = true; dl.textContent = 'Downloading…';
          try { await OnlineBeatmaps.downloadAndImport({ id: map.onlineSetId, title: map.title, artist: map.artist }, p => { if (p != null) dl.textContent = `Downloading… ${Math.round(p * 100)}%`; }); }
          catch (e) { Toast.err('Download failed', e.message); dl.disabled = false; dl.textContent = 'Download beatmap'; }
        } }, icon('download'), 'Download beatmap');
        mapActions.append(dl);
      } else mapActions.append(h('span.mp-warn', 'You don\'t have this beatmap and it has no online ID — import it to play.'));
    }
    const mapPanel = h('div.mp-map', bg, h('div.mp-map-body', ...mapInfo, mapActions));

    // players
    const slot = p => {
      if (!p) return h('div.mp-player.empty', h('div.mp-avatar', icon('user')), h('div.mp-pname', 'Waiting for an opponent…'), h('span.spinner'));
      const isMe = p.id === Multiplayer.me;
      const state = !r.map ? '' : !p.hasMap ? 'Missing beatmap' : p.ready ? 'Ready' : 'Not ready';
      return h(`div.mp-player${p.ready ? '.ready' : ''}`,
        isMe ? ProfileManager.avatarEl(44) : h('div.avatar.avatar-mono', { style: { width: '44px', height: '44px', fontSize: '20px' } }, (p.name || '?').slice(0, 1).toUpperCase()),
        h('div.mp-pname', p.name, isMe ? h('span.muted', ' (you)') : null, p.id === r.host ? h('span.mp-host', 'HOST') : null),
        h('span.grow'), state ? h(`span.mp-state${p.ready ? '.on' : !p.hasMap ? '.warn' : ''}`, state) : null);
    };
    const players = h('div.mp-players', h('h3', 'Players'), slot(me), slot(opp));

    // chat
    this.chatList = h('div.mp-chat-list');
    for (const m of Multiplayer.chat) this.appendChat(m, false);
    const input = h('input.input', { placeholder: 'Type a message…', maxlength: 300, 'aria-label': 'Chat message' });
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && input.value.trim()) { Multiplayer.send({ t: 'chat', text: input.value }); input.value = ''; } if (e.key === 'Escape') input.blur(); });
    const chat = h('div.mp-chat', h('h3', 'Chat'), this.chatList, input);

    // results of the last match
    const res = Multiplayer.lastResults ? this.resultsPanel(Multiplayer.lastResults) : null;

    // footer: ready / start
    const allReady = r.players.length === 2 && r.players.every(p => p.ready && p.hasMap);
    const readyBtn = h(`button.mp-ready${me && me.ready ? '.on' : ''}`, {
      disabled: !r.map || !me || !me.hasMap,
      onclick: () => { UISounds.click(); Multiplayer.send({ t: 'ready', ready: !(me && me.ready) }); },
    }, me && me.ready ? 'Not ready' : 'Ready');
    const startBtn = host ? h('button.mp-start', { disabled: !allReady, title: allReady ? '' : 'Both players must be ready', onclick: () => { UISounds.click(); Multiplayer.send({ t: 'start' }); } }, 'Start match') : null;
    const footer = h('div.mp-footer', h('div.grow'), readyBtn, startBtn);

    this.body.append(h('div.mp-room', head, res, h('div.mp-grid', h('div.mp-left', mapPanel, players), chat)), footer);
    requestAnimationFrame(() => { if (this.chatList) this.chatList.scrollTop = this.chatList.scrollHeight; });
  },
  appendChat(m, scroll = true) {
    if (!this.chatList || !this.chatList.isConnected && scroll) return;
    this.chatList.append(m.from ? h('div.mp-msg', h('b', m.name), h('span', m.text)) : h('div.mp-msg.sys', m.text));
    if (scroll) this.chatList.scrollTop = this.chatList.scrollHeight;
  },
  resultsPanel(res) {
    const meId = Multiplayer.me;
    const verdict = res.winner === null ? 'Draw' : res.winner === meId ? 'You win!' : 'You lose';
    const row = x => h(`div.mp-res-row${x.id === res.winner ? '.win' : ''}`,
      gradeEl(x.forfeit ? 'F' : x.grade || 'D'),
      h('div.main', h('div.t', x.name, x.id === meId ? h('span.muted', ' (you)') : null), h('div.s', x.forfeit ? (x.left ? 'left the match' : 'forfeited') : `${fmtAcc(x.accuracy)} · ${fmtInt(x.maxCombo)}x${x.pp ? ` · ${fmtInt(x.pp)}pp` : ''}`)),
      h('div.mp-res-score', fmtScore(x.score)));
    return h(`div.mp-results.${res.winner === null ? 'draw' : res.winner === meId ? 'won' : 'lost'}`,
      h('div.mp-verdict', verdict, h('button.icon-btn', { title: 'Dismiss', onclick: () => { Multiplayer.lastResults = null; this.render(); } }, icon('x'))),
      ...res.rows.map(row));
  },
};
