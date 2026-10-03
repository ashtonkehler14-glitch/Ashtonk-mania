/* Online players, friends and spectating.
 * - OnlinePanel: lazer's "currently online" list (a top bar button): everyone online, what they're doing, with Add
 *   friend, Spectate and Invite. Friends come first, and a Friends tab keeps them even while they're offline.
 * - Friends: kept in this browser, by each player's public id (Presence's pid), so a renamed friend stays a friend.
 * - Spectate: watch someone's play live. Their game streams its key presses through the presence server — only while
 *   someone is watching — and the watcher's game plays them back like a replay, a couple of seconds behind (so a
 *   hiccup in the stream doesn't stop the playback). Watching someone follows them from song to song. */

/** Friends are mutual: a request, which the other player accepts. The server keeps them (by public id), so they're
 *  the same in every tab; a copy is kept here to show them while offline. */
const Friends = {
  KEY: 'am.friends',
  server: null, requests: [], sent: new Set(),
  list() {
    if (this.server) return this.server;
    try { const l = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(l) ? l.filter(f => f && f.pid) : []; } catch { return []; }
  },
  has(pid) { return !!pid && this.list().some(f => f.pid === pid); },
  requested(pid) { return this.sent.has(pid); },
  incoming(pid) { return this.requests.some(r => r.pid === pid); },
  /** The server's list (on connecting, and whenever it changes). */
  sync(m) {
    this.server = (m.list || []).map(f => ({ pid: f.pid, name: f.name }));
    this.requests = m.requests || [];
    for (const f of this.server) this.sent.delete(f.pid);
    try { localStorage.setItem(this.KEY, JSON.stringify(this.server)); } catch { /* private mode */ }
    Bus.emit('friends:changed');
  },
  /** The heart: send a request (or accept theirs), or — already friends — remove them. */
  async toggle(p) {
    if (!p || !p.pid) return;
    if (this.has(p.pid)) {
      if (!(await Dialog.confirm(`Remove ${p.name} from your friends?`, 'You won\'t be able to invite or spectate each other until you\'re friends again.', { ok: 'Remove', danger: true }))) return;
      Presence.send({ t: 'unfriend', pid: p.pid });
      return;
    }
    if (this.incoming(p.pid)) { this.answer(p.pid, true); return; }
    if (!p.id) return;
    Presence.send({ t: 'friendReq', to: p.id });
    this.sent.add(p.pid); Bus.emit('friends:changed');
  },
  answer(pid, yes) { Presence.send({ t: 'friendAnswer', pid, yes }); this.requests = this.requests.filter(r => r.pid !== pid); Bus.emit('friends:changed'); },
  /** A friend request arrived: asked straight away (or once the current song is over). */
  async onRequest(m) {
    const from = m.from || {};
    if (Screens.currentName === 'gameplay') { Toast.show(`${from.name} sent you a friend request`, 'Answer it from the online users list.'); return; }
    UISounds.play('check-on');
    const ok = await Dialog.confirm(`${from.name} wants to be friends`, 'Friends can invite each other to rooms and spectate each other\'s plays.', { ok: 'Accept', cancel: 'Not now' });
    if (ok) this.answer(from.pid, true);
  },
};

const SPEC_DELAY = 2500; // ms of song time the watcher stays behind the player

const Spectate = {
  target: null, // { id, name }: who we're watching (we follow them from play to play)
  cur: null,    // the play being watched: { id, name, head, feed, at, ready, ended, quit }
  host: { watchers: 0, s: null, sent: 0, lastSend: 0 },

  // ── watching
  watch(p) {
    if (!p || !Presence.ws) { Toast.err('Can\'t spectate right now', 'You\'re not connected to the online service.'); return; }
    if (!Friends.has(p.pid)) { Toast.show('Friends only', `Add ${p.name} as a friend to spectate them.`); return; }
    if (p.status !== 'playing') { Toast.show(`${p.name} isn't playing right now`, 'You can spectate someone while they\'re playing a beatmap.'); return; }
    if (Multiplayer.inRoom() && Screens.currentName === 'gameplay' && !this.watchingNow()) { Toast.err('You\'re playing', 'Finish your song first.'); return; }
    if (this.target && this.target.id !== p.id) Presence.send({ t: 'unwatch', to: this.target.id });
    this.target = { id: p.id, name: p.name };
    this.cur = null;
    Presence.send({ t: 'watch', to: p.id });
    this.paintPill();
    Presence.pushStatus();
  },
  stop({ quiet = false } = {}) {
    if (!this.target) return;
    Presence.send({ t: 'unwatch', to: this.target.id });
    const name = this.target.name;
    this.target = null; this.cur = null;
    this.paintPill();
    if (this.watchingNow()) Screens.go('home');
    if (!quiet) Toast.show('Stopped spectating', name);
    Presence.pushStatus();
  },
  watchingNow() { return Screens.currentName === 'gameplay' && !!(GameplayScreen.s && GameplayScreen.s.spectate); },
  on(m) {
    if (m.t === 'spectators') { this.onSpectators(m); return; }
    if (!this.target || m.id !== this.target.id) return;
    if (m.t === 'specWait') { this.paintPill(`waiting for ${m.name} to play…`); return; }
    if (m.t === 'specStart') { this.start(m); return; }
    if (m.t === 'specFrames') {
      const c = this.cur;
      if (!c || c.id !== m.id) return;
      if (m.reset) c.feed.length = 0;
      for (const x of m.ev || []) c.feed.push(x);
      c.at = Math.max(c.at, m.at || 0);
      if (m.last) c.ready = true;
      return;
    }
    if (m.t === 'specEnd') {
      if (m.gone) { const n = this.target.name; this.target = null; this.cur = null; this.paintPill(); if (this.watchingNow()) Screens.go('home'); Toast.show(`${n} went offline`, 'Stopped spectating.'); Presence.pushStatus(); return; }
      if (this.cur) { this.cur.ended = true; this.cur.quit = !!m.quit; }
      if (m.quit && this.watchingNow()) { Toast.show(`${this.target.name} quit the song`, 'Waiting for their next one…'); Screens.go('home'); }
      this.paintPill(`waiting for ${this.target.name}'s next song…`);
    }
  },
  async start(m) {
    // (never takes over your own play)
    if (Screens.currentName === 'gameplay' && !this.watchingNow()) { Toast.show(`${m.name} started a song`, 'Finish yours, then spectate again from the online list.'); return; }
    const c = this.cur = { id: m.id, name: m.name, head: m.head, feed: (m.ev || []).slice(), at: m.at || 0, ready: !!m.hist, ended: false, quit: false };
    this.paintPill(`${m.head.artist} - ${m.head.title} [${m.head.version}]`);
    let map = BeatmapManager.mapByHash(m.head.mapHash) || (m.head.onlineId > 0 ? [...BeatmapManager.maps.values()].find(x => x.onlineId === m.head.onlineId) : null);
    if (!map && m.head.onlineSetId > 0) {
      Toast.show(`Getting the beatmap ${m.name} is playing…`, `${m.head.artist} - ${m.head.title}`);
      try { await OnlineBeatmaps.downloadAndImport({ id: m.head.onlineSetId, title: m.head.title, artist: m.head.artist }, null, { quiet: true }); } catch (e) { Toast.err('Couldn\'t download the beatmap', friendlyError(e)); }
      if (this.cur !== c) return;
      map = BeatmapManager.mapByHash(m.head.mapHash) || (m.head.onlineId > 0 ? [...BeatmapManager.maps.values()].find(x => x.onlineId === m.head.onlineId) : null);
    }
    if (!map) { Toast.err(`Can't spectate ${m.name}'s song`, 'That beatmap isn\'t in your library and couldn\'t be downloaded.'); return; }
    if (this.cur !== c) return;
    const replay = { ...m.head, events: c.feed, player: m.name, mapId: map.id, summary: null };
    Game.launch({ mapId: map.id, mode: 'replay', replay, spectate: c });
  },

  /** Called by the watcher's gameplay every frame: start a little behind the player, and wait for the stream
   *  whenever playback catches up with it. */
  tick(screen, s, now) {
    const c = s.spectate;
    if (!c || s.finished) return;
    if (c.quit) return;
    if (!c.synced) {
      if (!c.ready) { if (s.running) this.buffer(screen, s, true); return; }
      c.synced = true;
      const target = c.at - SPEC_DELAY * s.rate;
      if (target > now + 1000) screen.replaySeek(target);
      if (c.buffering) this.buffer(screen, s, false);
      return;
    }
    if (c.ended) { if (c.buffering) this.buffer(screen, s, false); return; }
    if (s.running && now > c.at - 150 * s.rate) this.buffer(screen, s, true);
    else if (c.buffering && c.at - now > SPEC_DELAY * 0.6 * s.rate) this.buffer(screen, s, false);
  },
  buffer(screen, s, on) {
    const c = s.spectate;
    if (!!c.buffering === on) return;
    c.buffering = on;
    if (on) { s.running = false; Music.pause(); c.msg = h('div.hud-center-msg.spec-wait', `Waiting for ${c.name}…`); screen.hud.append(c.msg); }
    else { if (c.msg) { c.msg.remove(); c.msg = null; } s.running = true; Music.play(Music.pausedPos); }
  },

  // ── being watched: stream this play's inputs while anyone watches
  onSpectators(m) {
    const H = this.host;
    H.watchers = m.n || 0;
    this.paintWatchers(m.names || []);
    if (m.full && H.s && GameplayScreen.s === H.s && !H.s.finished) this.upload(H.s);
  },
  /** Everything so far, in chunks (the first resets what the server kept, the last says it's complete). */
  upload(s) {
    const H = this.host, ev = s.events.map(x => Math.round(x * 100) / 100), CH = 3000;
    const at = this.songTime(s);
    if (!ev.length) Presence.send({ t: 'frames', ev: [], at, reset: true, last: true });
    for (let i = 0; i < ev.length; i += CH) Presence.send({ t: 'frames', ev: ev.slice(i, i + CH), at, reset: i === 0, last: i + CH >= ev.length });
    H.sent = s.events.length; H.lastSend = performance.now();
  },
  songTime(s) { return GameplayScreen.s === s && GameplayScreen._vc ? GameplayScreen._vc.t : 0; },
  hostStart(s) {
    const H = this.host;
    H.s = s; H.sent = 0; H.lastSend = 0;
    this.watchEl = null; this.paintWatchers(this._names || []); // (the new play's HUD shows who's still watching)
    if (!Presence.ws) return;
    const set = BeatmapManager.setById.get(s.rec.setId);
    Presence.send({ t: 'play', head: {
      mapHash: s.rec.hash, onlineId: s.rec.onlineId > 0 ? s.rec.onlineId : -1, onlineSetId: set && set.onlineId > 0 ? set.onlineId : -1,
      title: s.rec.title, artist: s.rec.artist, version: s.rec.version, creator: s.rec.creator,
      keys: s.keys, mods: s.mods, rate: s.rate, seed: s.seed, windows: s.windows, accuracyMode: s.accuracyMode, hp: s.bm.hp,
      modConfig: s.modConfig, noFail: !!s.mp, rules: s.rules, player: ProfileManager.profile.name,
    } });
  },
  hostTick(s, now) {
    const H = this.host;
    if (H.s !== s || !H.watchers || s.finished) return;
    const t = performance.now();
    if (t - H.lastSend < 400) return;
    H.lastSend = t;
    const ev = s.events.slice(H.sent).map(x => Math.round(x * 100) / 100);
    H.sent = s.events.length;
    Presence.send({ t: 'frames', ev, at: now });
  },
  hostEnd(s, quit) {
    const H = this.host;
    if (H.s !== s) return;
    if (H.watchers && !quit) { const ev = s.events.slice(H.sent).map(x => Math.round(x * 100) / 100); H.sent = s.events.length; Presence.send({ t: 'frames', ev, at: s.endTime + 5000 }); }
    H.s = null;
    Presence.send({ t: 'playEnd', quit: !!quit });
  },

  /** lazer's spectator list on the HUD: who's watching you play. */
  paintWatchers(names) {
    const prev = this._names || [];
    this._names = names;
    for (const n of names) if (!prev.includes(n) && Screens.currentName !== 'gameplay') Toast.show(`${n} is spectating you`);
    const hud = Screens.currentName === 'gameplay' && GameplayScreen.hud;
    if (this.watchEl && (!hud || !names.length || !hud.contains(this.watchEl))) { this.watchEl.remove(); this.watchEl = null; }
    if (!hud || !names.length) return;
    if (!this.watchEl) { this.watchEl = h('div.spec-list'); hud.append(this.watchEl); }
    clearEl(this.watchEl).append(h('div.spec-list-h', `Spectators (${names.length})`), ...names.slice(0, 10).map(n => h('div.spec-list-n', n)), names.length > 10 ? h('div.spec-list-n.more', `and ${names.length - 10} more`) : null);
  },
  /** The "Spectating …" pill: who you're watching, with Stop. */
  paintPill(sub) {
    if (!this.target) { if (this.pill) { this.pill.remove(); this.pill = null; } return; }
    if (!this.pill) { this.pill = h('div.spec-pill'); $('#app').appendChild(this.pill); }
    clearEl(this.pill).append(icon('film'), h('div.spec-pill-t', h('b', `Spectating ${this.target.name}`), sub ? h('small', sub) : null),
      h('button.btn.sm', { onclick: () => { UISounds.click(); this.stop(); } }, 'Stop'));
  },
};

/** lazer's online users list (here a panel from the top bar): who's online right now, and your friends. */
const OnlinePanel = {
  el: null, tab: 'online',
  isOpen() { return !!(this.el && this.el.classList.contains('open')); },
  toggle() { this.isOpen() ? this.close() : this.open(); },
  open() {
    if (!this.el) {
      this.listEl = h('div.ol-list');
      this.tabsEl = h('div.ol-tabs');
      this.el = h('div.ol-panel', { role: 'dialog', 'aria-label': 'Online players' },
        h('div.nf-head', h('div.nf-title', 'ONLINE', this.countEl = h('span.nf-count'))), this.tabsEl, this.listEl);
      $('#app').appendChild(this.el);
      document.addEventListener('pointerdown', e => { if (this.isOpen() && !this.el.contains(e.target) && !e.target.closest('.tb-btn') && !e.target.closest('.dialog')) this.close(); }, true);
      window.addEventListener('keydown', e => { if (e.key === 'Escape' && this.isOpen()) { e.preventDefault(); e.stopImmediatePropagation(); UISounds.back(); this.close(); } }, true);
      Bus.on('screen:changed', () => this.close());
      Bus.on('presence:changed', () => this.isOpen() && this.render());
      Bus.on('friends:changed', () => this.isOpen() && this.render());
      Bus.on('mp:changed', () => this.isOpen() && this.render());
    }
    if (typeof Notifications !== 'undefined') Notifications.close();
    Presence.start(); Presence.refresh();
    this.render();
    this.el.classList.add('open');
    Toolbar.sync();
  },
  close() { if (this.el) this.el.classList.remove('open'); if (typeof Toolbar !== 'undefined') Toolbar.sync(); },
  statusText(p) {
    if (p.status === 'playing') return p.song ? `Playing ${p.song.artist} - ${p.song.title} [${p.song.version}]` : 'Playing';
    return { room: 'In a multiplayer room', watching: 'Spectating', menu: 'In the menus' }[p.status] || 'Online';
  },
  row(p, online) {
    const friend = Friends.has(p.pid), me = p.id === Presence.me;
    const asked = !friend && Friends.requested(p.pid), theyAsked = !friend && Friends.incoming(p.pid);
    const canInvite = online && !me && friend && Multiplayer.inRoom() && p.status === 'menu';
    const watching = Spectate.target && Spectate.target.id === p.id;
    return h(`div.ol-row${online ? '' : '.off'}${friend ? '.friend' : ''}`,
      Presence.avatarEl(p, 40),
      h('div.ol-who', h('b', p.name, me ? h('span.muted', ' (you)') : null, friend ? h('span.ol-fr', icon('heart', 'fill')) : null),
        h('small', online ? this.statusText(p) : 'Offline'), online && p.watchers ? h('small.ol-watch', `${p.watchers} watching`) : null),
      h('div.ol-acts',
        !me && p.pid && !asked && (friend || online) ? h(`button.icon-btn.ol-friend${friend ? '.on' : ''}${theyAsked ? '.ask' : ''}`, { title: friend ? 'Remove friend' : theyAsked ? 'Accept their friend request' : 'Send a friend request', 'aria-label': friend ? 'Remove friend' : 'Add friend', onclick: () => { UISounds.click(); Friends.toggle(p); } }, icon(friend || theyAsked ? 'heart' : 'plus', friend ? 'fill' : '')) : null,
        asked ? h('span.ol-asked', 'Request sent') : null,
        online && !me && friend && (p.status === 'playing' || watching) ? h(`button.btn.sm${watching ? '.primary' : ''}.ol-spec`, { title: 'Watch them play', onclick: () => { UISounds.click(); if (watching) Spectate.stop(); else { Spectate.watch(p); this.close(); } } }, icon('film'), watching ? 'Watching' : 'Spectate') : null,
        canInvite ? h('button.btn.sm', { onclick: () => { UISounds.click(); Presence.invite(p.id); Toast.ok('Invited', p.name); } }, 'Invite') : null));
  },
  render() {
    if (!this.el) return;
    const online = Presence.players || [];
    const friends = Friends.list();
    clearEl(this.tabsEl).append(...[['online', `Online (${online.length})`], ['friends', `Friends (${friends.length})${Friends.requests.length ? ` · ${Friends.requests.length} new` : ''}`]].map(([k, l]) =>
      h(`button.ol-tab${this.tab === k ? '.on' : ''}`, { onclick: () => { UISounds.click(); this.tab = k; this.render(); } }, l)));
    this.countEl.textContent = String(online.length);
    let rows;
    if (!Presence.ws) rows = [h('div.inv-empty', Multiplayer.available() ? 'Connecting to the online service…' : 'Online play needs the game\'s server (open the game from its website).')];
    else if (this.tab === 'online') {
      const sorted = [...online].sort((a, b) => (b.id === Presence.me) - (a.id === Presence.me) || Friends.has(b.pid) - Friends.has(a.pid) || a.name.localeCompare(b.name));
      rows = sorted.length ? sorted.map(p => this.row(p, true)) : [h('div.inv-empty', 'Nobody is online right now.')];
    } else {
      // online friends first, then the rest (by name)
      const list = friends.map(f => ({ f, p: online.find(x => x.pid === f.pid) })).sort((a, b) => !!b.p - !!a.p || a.f.name.localeCompare(b.f.name));
      const reqs = Friends.requests.map(r => h('div.ol-row.req', Presence.avatarEl({ name: r.name }, 40),
        h('div.ol-who', h('b', r.name), h('small', 'wants to be friends')),
        h('div.ol-acts', h('button.btn.sm.primary', { onclick: () => { UISounds.click(); Friends.answer(r.pid, true); } }, 'Accept'), h('button.btn.sm', { onclick: () => { UISounds.click(); Friends.answer(r.pid, false); } }, 'Decline'))));
      rows = [...(reqs.length ? [h('div.ol-sec', 'Friend requests'), ...reqs, h('div.ol-sec', 'Friends')] : [])];
      rows.push(...(list.length ? list.map(({ f, p }) => p ? this.row(p, true) : this.row({ ...f, id: null }, false))
        : [h('div.inv-empty', 'No friends yet — press + next to someone online to send them a friend request.')]));
    }
    clearEl(this.listEl).append(...rows);
  },
};
