/* Online players, friends and spectating.
 * - OnlinePanel: lazer's "currently online" list (a top bar button): everyone online, what they're doing, with Add
 *   friend, Spectate and Invite. Friends come first, and a Friends tab keeps them even while they're offline.
 * - Friends: kept in this browser, by each player's public id (Presence's pid), so a renamed friend stays a friend.
 * - Spectate: lazer's spectating. Spectate someone and you're on their Spectator Mode screen; each song they play, their
 *   game streams its key presses through the presence server — only while someone is watching — and the watcher's game
 *   plays them back like a replay, a moment behind (so a hiccup in the stream doesn't stop the playback). */

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
    // (each friend's picture: the server's, else the last one seen here — shown while they're offline too)
    const had = new Map(this.list().map(f => [f.pid, f.avatar]));
    this.server = (m.list || []).map(f => ({ pid: f.pid, name: f.name, avatar: (typeof f.avatar === 'string' && f.avatar) || had.get(f.pid) || '' }));
    LastSeen.merge((m.list || []).filter(f => f.seen > 0 && !f.online).map(f => [f.pid, f.seen])); // (the server saw them go)
    this.requests = m.requests || [];
    for (const f of this.server) this.sent.delete(f.pid);
    try { localStorage.setItem(this.KEY, JSON.stringify(this.server)); } catch { /* private mode */ }
    Bus.emit('friends:changed');
  },
  /** Friends online now: a new picture of theirs is kept for when they go offline. */
  remember(players) {
    if (!this.server) return;
    let changed = false;
    for (const p of players) { const f = p.pid && p.avatar && this.server.find(x => x.pid === p.pid); if (f && f.avatar !== p.avatar) { f.avatar = p.avatar; changed = true; } }
    if (changed) try { localStorage.setItem(this.KEY, JSON.stringify(this.server)); } catch { /* private mode */ }
  },
  /** The heart: send a request (or accept theirs), or — already friends — remove them. */
  async toggle(p) {
    if (!p || !p.pid) return;
    if (this.has(p.pid)) {
      if (!(await Dialog.confirm(`Remove ${p.name} from your friends?`, 'You won\'t be able to invite each other to rooms until you\'re friends again.', { ok: 'Remove', danger: true }))) return;
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
    // (in a song, or set to Do not disturb: a quiet note instead of a question)
    if (Screens.currentName === 'gameplay' || Settings.get('online.status') === 'dnd') { Toast.show(`${from.name} sent you a friend request`, 'Answer it from the online users list.', { hold: true }); return; }
    UISounds.play('check-on');
    const ok = await Dialog.confirm(`${from.name} wants to be friends`, 'Friends can invite each other to rooms and chat.', { ok: 'Accept', cancel: 'Not now' });
    if (ok) this.answer(from.pid, true);
  },
};

const SPEC_DELAY = 600; // ms of song time the watcher stays behind the player (key presses stream 20 times a second)

/** lazer's spectating (SoloSpectatorScreen): Spectate someone and you're on their Spectator Mode screen — who they are,
 *  the beatmap they're playing and Start Watching. Their play starts by itself once that beatmap is in your library (a
 *  moment behind theirs, played from their key presses) and ends as theirs does: their results (no retry: it's their
 *  play), or their fail. Their next song takes you back to the screen, and it starts too. Leaving the screen stops
 *  watching. From your multiplayer room, Spectate goes straight into their song and back to the room after. */
const Spectate = {
  target: null, // { id, name, pid, avatar, room }: who we're watching (room: from a multiplayer room)
  cur: null,    // their play now: { id, name, head, feed, at, ready, ended, quit, started }
  host: { watchers: 0, s: null, sent: 0, lastSend: 0 },

  // ── watching
  watch(p) {
    if (!p || !Presence.ws) { Toast.err('Can\'t spectate right now', 'You\'re not connected to the online service.'); return; }
    if (Screens.currentName === 'gameplay' && !this.watchingNow()) { Toast.err('You\'re playing', 'Finish your song first.'); return; }
    if (this.target && this.target.id !== p.id) Presence.send({ t: 'unwatch', to: this.target.id });
    const room = Multiplayer.inRoom();
    this.target = { id: p.id, name: p.name, pid: p.pid || '', avatar: p.avatar || '', room };
    this.cur = null; this.set = null;
    Presence.send({ t: 'watch', to: p.id });
    if (!room) Screens.go('spectator');
    Presence.pushStatus();
  },
  stop({ quiet = false } = {}) {
    const t = this.target;
    if (!t) return;
    Presence.send({ t: 'unwatch', to: t.id });
    this.target = null; this.cur = null; this.set = null;
    if (t.room && Multiplayer.inRoom() && this.watchingNow()) Screens.go('multiplayer', {}, { replace: true }); // (watching from a room: back to it)
    if (!quiet) Toast.show('Stopped spectating', t.name);
    Presence.pushStatus();
  },
  /** Back online (under a new id): watch them again. */
  relink() {
    const t = this.target;
    if (!t || !t.lost) return;
    const p = Presence.players.find(x => x.pid === t.pid && x.id !== t.id);
    if (p) this.watch(p);
  },
  watchingNow() { return Screens.currentName === 'gameplay' && !!(GameplayScreen.s && GameplayScreen.s.spectate); },
  onResults() { return Screens.currentName === 'results' && !!(ResultsScreen.p && ResultsScreen.p.spectated); },
  on(m) {
    if (m.t === 'spectators') { this.onSpectators(m); return; }
    const t = this.target;
    if (!t || m.id !== t.id) return;
    if (m.t === 'specWait') {
      if (t.room) { this.stop({ quiet: true }); Toast.show(`${t.name} isn't playing right now`); return; }
      this.cur = null; SpectatorScreen.paint();
      return;
    }
    if (m.t === 'specStart') { this.start(m); return; }
    if (m.t === 'specFrames') {
      const c = this.cur;
      if (!c || c.id !== m.id) return;
      if (m.reset) c.feed.length = 0;
      for (const x of m.ev || []) c.feed.push(x);
      c.at = Math.max(c.at, m.at || 0);
      if (m.last) c.ready = true;
      // (what they did — a skip, a pause, their pause menu, a fail: it happens here as playback gets there)
      if (m.act && typeof m.act === 'object') c.acts.push(m.act);
      return;
    }
    if (m.t !== 'specEnd') return;
    const c = this.cur;
    if (m.gone) {
      // (gone from the online list — often only their page reloading, or a moment without signal: they come back under a
      // new id and watching carries on)
      this.cur = null;
      if (t.room || !t.pid) { this.stop({ quiet: true }); Toast.show(`${t.name} went offline`, 'Stopped spectating.'); return; }
      t.lost = true;
      if (this.watchingNow() || this.onResults()) this.toScreen();
      SpectatorScreen.paint();
      this.relink();
      return;
    }
    if (c) { c.ended = true; c.quit = !!m.quit; }
    // watching from a multiplayer room: their song is over, so is watching — back to the room (once the play you're
    // shown has caught up with its end, a moment behind theirs)
    if (t.room) {
      if (!this.watchingNow() || m.quit) { this.stop({ quiet: true }); return; }
      setTimeout(() => { if (this.cur === c && this.target === t) this.stop({ quiet: true }); }, SPEC_DELAY + 2500);
      return;
    }
    // (lazer: their quitting takes you back to the screen at once; a song they finish, or fail, plays out here first)
    if (m.quit && this.watchingNow()) this.toScreen();
    SpectatorScreen.paint();
  },
  start(m) {
    const t = this.target;
    if (Screens.currentName === 'gameplay' && !this.watchingNow()) return; // (never takes over your own play)
    t.lost = false;
    this.cur = { id: m.id, name: m.name, head: m.head, feed: (m.ev || []).slice(), at: m.at || 0, ready: !!m.hist, ended: false, quit: false, started: false, acts: [] };
    if (t.room) {
      if (!this.findMap(m.head)) { this.stop({ quiet: true }); Toast.err(`Can't spectate ${m.name}`, 'You haven\'t got this beatmap yet.'); return; }
      this.tryStart();
      return;
    }
    // (lazer: a new play of theirs takes you from the one you were watching, or its results, back to the screen — which
    // starts it; their fail, still to come here or only just shown, first gets a moment to be seen)
    if (this.watchingNow() || this.onResults()) {
      const hold = this.failHold(), cur = this.cur;
      clearTimeout(this._holdT);
      if (hold > 0) this._holdT = setTimeout(() => { if (this.cur === cur) this.toScreen(); }, hold);
      else this.toScreen();
      return;
    }
    SpectatorScreen.paint();
    this.autoDownload();
    this.tryStart();
  },
  /** How long their fail, on the play you're watching, still needs to be seen: on its way (played here a moment behind
   *  theirs), or only just shown. */
  failHold() {
    const s = GameplayScreen.s, c = s && s.spectate;
    if (!this.watchingNow() || !c) return 0;
    if (c.acts && c.acts.some(a => a.k === 'fail')) return SPEC_DELAY + 2600;
    return s.failClock ? Math.max(0, 2400 - (performance.now() - s.failClock.real)) : 0;
  },
  findMap(head) { return BeatmapManager.mapByHash(head.mapHash) || (head.onlineId > 0 ? [...BeatmapManager.maps.values()].find(x => x.onlineId === head.onlineId) : null); },
  /** Can Start Watching start their play? They're mid-song, and it's in your library. */
  canStart() { const c = this.cur; return !!(c && !c.ended && this.findMap(c.head)); },
  /** lazer's scheduleStart: their play starts from the Spectator Mode screen (or straight from the room) as soon as the
   *  beatmap's in your library; Start Watching starts it again after you've left it. */
  tryStart(again = false) {
    const c = this.cur, t = this.target;
    if (!t || !this.canStart() || (c.started && !again)) return;
    if (Screens.currentName !== (t.room ? 'multiplayer' : 'spectator') || Screens.busy) return;
    const map = this.findMap(c.head);
    c.started = true;
    Object.assign(c, { synced: false, buffering: false, lag: 0, msg: null, paused: false }); // (a fresh run of the same play)
    this._launching = true;
    Game.launch({ mapId: map.id, mode: 'replay', replay: { ...c.head, events: c.feed, player: c.name, mapId: map.id, summary: null }, spectate: c, back: t.room ? null : { name: 'spectator' } });
  },
  /** Back to the Spectator Mode screen (from their play or its results). */
  toScreen() {
    if (Screens.currentName === 'spectator') { SpectatorScreen.paint(); return; }
    const go = (n = 0) => {
      const t = this.target;
      if (!t || t.room || !(this.watchingNow() || this.onResults())) return;
      if (Screens.busy) { if (n < 30) setTimeout(() => go(n + 1), 100); return; }
      Screens.go('spectator', {}, { replace: true });
    };
    go();
  },
  /** Esc, or Quit on their fail screen: lazer's spectator player goes back to the Spectator Mode screen — their play
   *  goes on, and Start Watching picks it up again. (From a room: back to the room.) */
  leavePlay() {
    const t = this.target;
    if (!t || t.room) { if (t) this.stop(); else Screens.go(Multiplayer.inRoom() ? 'multiplayer' : 'home', {}, { replace: true }); return; }
    this.toScreen();
  },
  /** lazer's "Automatically download missing beatmaps" (off unless you turn it on). */
  autoDownload() { const c = this.cur; if (c && !c.ended && Settings.get('online.autoDownload') && !this.findMap(c.head)) this.download(); },
  download() {
    const c = this.cur, id = c && c.head.onlineSetId;
    if (!(id > 0) || this.findMap(c.head)) return;
    const st = ExplorerScreen.downloads.get(id);
    if (st && st.state === 'downloading') return;
    const set = this.set && this.set.id === id ? this.set : { id, title: c.head.title, artist: c.head.artist, creator: c.head.creator, diffs: [] };
    ExplorerScreen.download(set).finally(() => SpectatorScreen.paint());
    SpectatorScreen.paint();
  },

  /** Called by the watcher's gameplay every frame: start a little behind the player, and wait for the stream
   *  whenever playback catches up with it. */
  tick(screen, s, now) {
    const c = s.spectate;
    if (!c) return;
    if (c.synced && c.acts && c.acts.length) this.acts(screen, s, c, now);
    if (s.finished || c.quit || c.paused) return;
    if (!c.synced) {
      if (!c.ready) { if (s.running) this.buffer(screen, s, true); return; }
      c.synced = true;
      const target = c.at - SPEC_DELAY * s.rate;
      if (target > now + 1000) { screen.replaySeek(target); c.acts = c.acts.filter(a => (+a.t || 0) >= target); } // (what they did before here is long done)
      if (c.buffering) this.buffer(screen, s, false);
      return;
    }
    if (c.ended) { if (c.buffering) this.buffer(screen, s, false); return; }
    // (each time playback has to wait for the stream — their pause, or a patchy connection — it carries on a little
    // further behind, up to 3s more, so it settles into smooth playback instead of stopping again and again)
    if (s.running && now > c.at - 150 * s.rate) { c.lag = Math.min(3000, (c.lag || 0) + 400); this.buffer(screen, s, true); }
    else if (c.buffering && c.at - now > (SPEC_DELAY * 0.6 + (c.lag || 0)) * s.rate) this.buffer(screen, s, false);
  },
  /** What they did, played here as playback reaches the moment they did it (`t`, song time): their skip (the intro, or
   *  a storyboard's outro); their pause — their pause menu, the button they're on lit up as they go (`sel`) — and
   *  carrying on; their fail (the fail menu, the same). A pause or fail also stops playback that's caught up with them
   *  — it's waiting right there. */
  acts(screen, s, c, now) {
    while (c.acts.length) {
      const a = c.acts[0], k = a.k;
      const due = k === 'sel' || k === 'resume' || now >= (+a.t || 0) - 30 * s.rate || (c.buffering && (k === 'pause' || k === 'fail'));
      if (!due) return;
      c.acts.shift();
      if (k === 'skip' || k === 'outro') screen.specSkip(s, k === 'outro');
      else if (k === 'pause' && !s.finished && !c.paused) {
        if (c.buffering) this.buffer(screen, s, false);
        s.running = false; Music.pause(); c.paused = true; c.sel = null;
        screen.showPause('Paused');
      } else if (k === 'resume' && c.paused) {
        c.paused = false; screen.closePause();
        if (!s.finished) { s.running = true; Music.play(Music.pausedPos); }
      } else if (k === 'fail' && !s.finished) {
        if (c.buffering) this.buffer(screen, s, false);
        c.paused = false; c.sel = null; screen.closePause(); screen.fail(screen.gameTime());
      } else if (k === 'sel') {
        c.sel = String(a.sel || '');
        if (screen.pauseEl) for (const b of screen.pauseEl.querySelectorAll('.pm-btn.theirs')) b.classList.toggle('spec-sel', b.dataset.k === c.sel);
      }
    }
  },
  /** Back in the tab after a while: straight back to the live play (a couple of seconds behind it). */
  catchUp(screen, s) {
    const c = s.spectate;
    if (!c || !c.synced || c.ended || s.finished || screen.pauseEl || c.paused) return;
    if (AudioManager.ctx && AudioManager.ctx.state !== 'running') AudioManager.resume();
    const target = c.at - SPEC_DELAY * s.rate, now = screen.gameTime();
    if (target - now > 1500 * s.rate || now > c.at) screen.replaySeek(Math.max(0, target));
    if (!s.running && !c.buffering) { s.running = true; Music.play(Music.pausedPos); }
  },
  buffer(screen, s, on) {
    const c = s.spectate;
    if (!!c.buffering === on) return;
    c.buffering = on;
    if (on) { s.running = false; Music.pause(); c.msg = h('div.hud-center-msg.spec-wait', `Waiting for ${c.name}…`); screen.hud.append(c.msg); }
    else { if (c.msg) { c.msg.remove(); c.msg = null; } s.running = true; Music.play(Music.pausedPos); }
  },
  /** lazer's SpectatorPlayer message, top centre: "Watching (them) play (song) live". */
  liveEl(s) {
    const c = s.spectate, title = Settings.get('ui.unicodeMetadata') && s.rec.titleUnicode ? s.rec.titleUnicode : s.rec.title;
    return h('div.spec-live', h('span.spec-live-t', 'Watching ', h('b', c.name), ' play ', h('b', title), h('b.spec-live-l', ' live')));
  },

  /** You stop watching when you go and do something of your own: anything but the Spectator Mode screen, their play
   *  and its results. */
  onScreen(name) {
    const t = this.target;
    if (!t) return;
    if (name === 'gameplay') { if (this._launching) { this._launching = false; return; } this.stop({ quiet: true }); return; }
    if (!t.room && (name === 'spectator' || this.onResults())) return;
    this.stop({ quiet: true });
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
    if (t - H.lastSend < 50) return; // (20 times a second: watchers stay close behind)
    H.lastSend = t;
    const ev = s.events.slice(H.sent).map(x => Math.round(x * 100) / 100);
    H.sent = s.events.length;
    Presence.send({ t: 'frames', ev, at: now });
  },
  /** What you just did (`k`: skip, outro, pause, resume, fail, or sel — the pause menu button you're on), at `t` in the
   *  song, for anyone watching: it happens in their play too, as it gets there. Played so far goes first. */
  hostAct(s, k, t, extra = {}) {
    const H = this.host;
    if (H.s !== s || !H.watchers || !Presence.ws) return;
    if (k === 'sel') { if (H.sel === extra.sel) return; H.sel = extra.sel; } else H.sel = null;
    const ev = s.events.slice(H.sent).map(x => Math.round(x * 100) / 100), at = t == null ? this.songTime(s) : t;
    H.sent = s.events.length; H.lastSend = performance.now();
    // (a pause or fail: what's to be played reaches a little past it, so playback there gets right up to it)
    Presence.send({ t: 'frames', ev, at: k === 'pause' || k === 'fail' ? at + 400 : at, act: { k, t: Math.round(at), ...extra } });
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
    for (const n of names) if (!prev.includes(n) && Screens.currentName !== 'gameplay' && Settings.get('online.status') !== 'dnd') Toast.show(`${n} is spectating you`);
    const hud = Screens.currentName === 'gameplay' && GameplayScreen.hud;
    if (this.watchEl && (!hud || !names.length || !hud.contains(this.watchEl))) { this.watchEl.remove(); this.watchEl = null; }
    if (!hud || !names.length) return;
    if (!this.watchEl) { this.watchEl = h('div.spec-list'); hud.append(this.watchEl); }
    clearEl(this.watchEl).append(h('div.spec-list-h', `Spectators (${names.length})`), ...names.slice(0, 10).map(n => h('div.spec-list-n', n)), names.length > 10 ? h('div.spec-list-n.more', `and ${names.length - 10} more`) : null);
  },
};

/** lazer's SoloSpectatorScreen: a box in the middle of the screen — "Spectator Mode"; the player's card, an arrow, and
 *  the beatmap they're playing (a beatmap card, with its download when it isn't in your library); "Automatically
 *  download missing beatmaps"; and Start Watching, once they're playing and the beatmap's here (their play also starts
 *  by itself then). Back stops watching. */
const SpectatorScreen = {
  enter() {
    this.box = h('div.spm-box');
    const el = h('div.spm', h('div.spm-dim'), this.box, h('div.page-back', backButton(() => Screens.back())));
    this._unsub = [
      Bus.on('library:changed', () => { this.paintMap(); setTimeout(() => Spectate.tryStart(), 0); }),
      Bus.on('presence:changed', () => this.paintUser()),
    ];
    this._tick = setInterval(() => this.paintProgress(), 250);
    this.render();
    Spectate.autoDownload();
    this.startSoon();
    return el;
  },
  refresh() { this.render(); Spectate.autoDownload(); this.startSoon(); },
  /** Who you're watching and what they're playing, again (their play started or ended, they went or came back). */
  paint() { this.paintUser(); this.paintMap(); },
  /** (a moment on the screen first, as lazer's player loader takes over from it) */
  startSoon() { clearTimeout(this._startT); this._startT = setTimeout(() => Spectate.tryStart(), 350); },
  leave() { (this._unsub || []).forEach(f => f()); this._unsub = []; clearInterval(this._tick); clearTimeout(this._startT); this.box = null; },
  render() {
    const box = this.box;
    if (!box) return;
    this.userEl = h('div.spm-user');
    this.mapEl = h('div.spm-map');
    this.btn = h('button.spm-watch', { onclick: () => { UISounds.click(); Spectate.tryStart(true); } }, 'Start Watching');
    clearEl(box).append(
      h('div.spm-t', 'Spectator Mode'),
      h('div.spm-row', this.userEl, h('span.spm-arrow', icon('back')), this.mapEl),
      this.autoRow(),
      this.btn);
    this.paintUser(); this.paintMap();
  },
  /** lazer's UserGridPanel of who you're watching (offline: as the online list shows someone who's gone). */
  paintUser() {
    const t = Spectate.target;
    if (!this.userEl || !t) return;
    const p = Presence.players.find(x => x.id === t.id) || (t.pid && Presence.players.find(x => x.pid === t.pid));
    const u = p && !t.lost ? { ...p, online: true } : { id: null, pid: t.pid, name: t.name, avatar: t.avatar, online: false };
    const sig = JSON.stringify([u.id, u.name, u.avatar, u.status, u.song, u.online]);
    if (sig === this._userSig && this.userEl.firstChild) return;
    this._userSig = sig;
    clearEl(this.userEl).append(UserPanels.card(u));
  },
  /** Their beatmap's card — or, between songs, what you're waiting for. */
  paintMap() {
    const el = this.mapEl, t = Spectate.target, c = Spectate.cur;
    if (!el || !this.btn) return;
    this.btn.disabled = !Spectate.canStart();
    if (!t) { clearEl(el); return; }
    if (!c) {
      clearEl(el).append(h('div.spm-idle', t.lost ? [h('span.spinner'), h('span', `${t.name} went offline — waiting for them to come back…`)] : [icon('clock'), h('span', `Waiting for ${t.name} to play…`)]));
      this._mapSig = null;
      return;
    }
    const st = c.head.onlineSetId > 0 ? ExplorerScreen.downloads.get(c.head.onlineSetId) : null;
    this._mapSig = this.mapSig(c);
    clearEl(el).append(this.card(c, st));
  },
  mapSig(c) { const st = c && c.head.onlineSetId > 0 ? ExplorerScreen.downloads.get(c.head.onlineSetId) : null; return c ? [c.head.mapHash, !!Spectate.findMap(c.head), st ? st.state : '', c.ended].join() : ''; },
  /** A download's progress, as it goes (the card is built again only when its state changes). */
  paintProgress() {
    const c = Spectate.cur;
    if (!c || !this.mapEl) return;
    if (this.mapSig(c) !== this._mapSig) { this.paintMap(); return; }
    const st = c.head.onlineSetId > 0 ? ExplorerScreen.downloads.get(c.head.onlineSetId) : null;
    if (st && st.state === 'downloading') for (const x of this.mapEl.querySelectorAll('.ex-thumbprog, .ex-side-btn.busy')) x.style.setProperty('--p', `${Math.round((st.progress || 0) * 100)}%`);
  },
  /** lazer's BeatmapCardNormal of the beatmap they're playing: its cover, title, artist and mapper, the difficulty — and
   *  on the right, Download (with its progress) when it isn't in your library. Clicked, the beatmap's page. */
  card(c, st) {
    const head = c.head, sid = head.onlineSetId > 0 ? head.onlineSetId : 0, local = Spectate.findMap(head), busy = st && st.state === 'downloading';
    const thumb = h('div.ex-thumb'), bg = h('div.ex-cardbg');
    const shown = el => () => el.classList.add('loaded');
    if (sid) { OnlineBeatmaps.loadCover(thumb, sid, ['list@2x', 'list', 'card'], shown(thumb), null, () => noPicture(thumb)); OnlineBeatmaps.loadCover(bg, sid, ['card@2x', 'card', 'cover'], shown(bg)); }
    else if (local) BeatmapManager.bgURL(local).then(u => { if (!u) { noPicture(thumb); return; } for (const x of [thumb, bg]) { x.style.backgroundImage = `url("${u}")`; x.classList.add('loaded'); } }).catch(() => noPicture(thumb));
    else noPicture(thumb);
    const pct = `${Math.round(((st && st.progress) || 0) * 100)}%`;
    const side = local ? null : busy ? h('div.ex-side-btn.busy', { title: 'Downloading…', style: { '--p': pct } }, h('span.spinner'))
      : sid ? h('button.ex-side-btn.dl', { title: 'Download', 'aria-label': 'Download', onclick: e => { e.stopPropagation(); UISounds.click(); Spectate.download(); } }, icon('download')) : null;
    const card = h(`div.ex-card.spm-card${local ? '.owned' : ''}`, { role: 'button', tabindex: '0', 'aria-label': `${head.artist} - ${head.title}`,
      onclick: () => { if (!sid) return; UISounds.click(); OnlineBeatmaps.getSet(sid).then(set => { if (set && Screens.currentName === 'spectator') ExplorerScreen.openSet(set); }).catch(() => {}); } },
      bg, h('div.ex-cardshade'),
      h('div.ex-thumbwrap', thumb, busy ? h('div.ex-thumbprog', { style: { '--p': pct } }) : null),
      h('div.ex-cb',
        h('div.ex-cb-top', h('div.ex-titles', h('div.ex-t', { title: head.title }, h('span.ex-tt', head.title)), h('div.ex-a', { title: head.artist }, head.artist))),
        h('div.ex-m', 'mapped by ', h('b', head.creator || '—')),
        h('div.ex-foot', local && local.stars ? starBadge(local.stars) : null, h('span.ex-keys', `${head.keys}K`), h('span.spm-v', head.version), h('span.grow'),
          local ? h('span.ex-owned', { title: 'In your library' }, icon('check')) : !sid ? h('span.spm-miss', 'Not in your library') : null)),
      side ? h('div.ex-side', side) : null);
    return card;
  },
  /** lazer's SettingsCheckbox for "Automatically download missing beatmaps" (Settings → Online, off unless turned on). */
  autoRow() {
    const on = () => !!Settings.get('online.autoDownload');
    const t = h(`span.toggle${on() ? '.on' : ''}`, { role: 'switch', 'aria-checked': String(on()) });
    const row = h('button.spm-auto', { 'aria-label': 'Automatically download missing beatmaps', onclick: () => {
      const v = !on();
      Settings.set('online.autoDownload', v);
      t.classList.toggle('on', v); t.setAttribute('aria-checked', String(v));
      UISounds.play(v ? 'check-on' : 'check-off');
      if (v) Spectate.autoDownload();
    } }, h('span', 'Automatically download missing beatmaps'), t);
    return row;
  },
};

/** When each friend was last seen online (kept in this browser), for "Last seen …" and lazer's "Last visit" sort. */
const LastSeen = {
  KEY: 'am.lastSeen',
  map() { try { return JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch { return {}; } },
  get(pid) { return this.map()[pid] || 0; },
  /** When the server last saw them, where that's later than what this browser knows. */
  merge(pairs) {
    const m = this.map(); let changed = false;
    for (const [p, t] of pairs) if (p && t > (m[p] || 0) && t <= Date.now() + 60000) { m[p] = t; changed = true; }
    if (changed) try { localStorage.setItem(this.KEY, JSON.stringify(m)); } catch { /* private mode */ }
  },
  touch(pids) {
    const m = this.map(), t = Date.now();
    let changed = false;
    for (const p of pids) if (p && (!m[p] || t - m[p] > 30000)) { m[p] = t; changed = true; }
    if (changed) try { localStorage.setItem(this.KEY, JSON.stringify(m)); } catch { /* private mode */ }
  },
};

/** osu!lazer's user panels (osu.Game/Users): UserGridPanel (a 120px card), UserListPanel (a 40px row) and
 *  UserBrickPanel (a name pill), with ExtendedUserPanel's status icon and message, and UserPanel's context menu —
 *  here also behind a ⋯ button. `u`: { id (online connection), pid, name, avatar, status, song, online }. */
const UserPanels = {
  /** lazer's status colours: offline black, online green, and the activity's colour while doing something. */
  statusColour(u) {
    if (!u.online) return '#000';
    return { playing: '#44aadd', watching: '#8866ee', room: '#eeaa00', ranked: '#ff66ab' }[u.status] || '#88b300';
  },
  statusText(u) {
    if (!u.online) return 'Offline';
    if (u.status === 'playing') return u.song ? `Playing ${u.song.artist} - ${u.song.title} [${u.song.version}]` : 'Playing';
    return { room: 'In a multiplayer room', ranked: 'In a Ranked Play match', watching: 'Spectating' }[u.status] || 'Online';
  },
  lastSeen(u) {
    if (u.online) return null;
    const t = LastSeen.get(u.pid);
    return t ? `Last seen ${Notifications.ago(t)}` : null;
  },
  statusIcon(u) { return h('span.up-status', { style: { '--sc': this.statusColour(u) } }); },
  statusMsg(u, right = false) {
    const ls = this.lastSeen(u);
    return h(`div.up-msg${right ? '.r' : ''}`, ls ? h('small', ls) : null, h('span', { title: u.song ? `${u.song.artist} - ${u.song.title} [${u.song.version}] · ★${(u.song.stars || 0).toFixed(2)}` : '' }, this.statusText(u)));
  },
  cover(u) {
    const a = typeof u.avatar === 'string' ? u.avatar : '';
    const url = a.startsWith('preset:') ? AvatarPresets.url(a.slice(7)) : a.startsWith('file:') ? Host.asset('avatars/' + encodeURIComponent(a.slice(5))) : a.startsWith('data:image/') ? a : null;
    return h('div.up-cover', url ? { style: { backgroundImage: `url("${url}")` } } : {});
  },
  canSpectate(u) { return !!(u.online && u.id && u.id !== Presence.me); }, // (anyone online, in a song or in the menus)
  canInvite(u) { return u.online && u.id && u.id !== Presence.me && Friends.has(u.pid) && Multiplayer.inRoom() && u.status === 'menu'; },
  /** UserPanel.ContextMenuItems: View profile first, then what you can do with them. */
  menuItems(u) {
    const me = u.id && u.id === Presence.me, items = [{ label: 'View profile', icon: 'user', onClick: () => this.profile(u) }];
    if (me) return items;
    if (this.canSpectate(u)) items.push({ label: 'Spectate', icon: 'film', onClick: () => Spectate.watch(u) });
    if (u.online && u.pid && Friends.has(u.pid)) items.push({ label: 'Send message', icon: 'chat', onClick: () => Chat.message(u) });
    if (this.canInvite(u)) items.push({ label: 'Invite to room', icon: 'multi', onClick: () => { Presence.invite(u.id); Toast.ok('Invited', u.name); } });
    if (Friends.has(u.pid)) items.push({ sep: true }, { label: 'Remove friend', icon: 'x', danger: true, onClick: () => Friends.toggle(u) });
    else if (Friends.incoming(u.pid)) items.push({ sep: true }, { label: 'Accept friend request', icon: 'heart', onClick: () => Friends.answer(u.pid, true) });
    else if (Friends.requested(u.pid)) items.push({ sep: true }, { label: 'Friend request sent', icon: 'check', onClick: () => {} });
    else if (u.online && u.id) items.push({ sep: true }, { label: 'Add friend', icon: 'plus', onClick: () => Friends.toggle(u) });
    return items;
  },
  openMenu(u, x, y) { showMenu(x, y, this.menuItems(u)); },
  moreBtn(u) {
    return h('button.up-more', { title: 'More', 'aria-label': `More options for ${u.name}`, onclick: e => { e.stopPropagation(); UISounds.click(); const r = e.currentTarget.getBoundingClientRect(); this.openMenu(u, r.right - 160, r.bottom + 4); } }, h('i'), h('i'), h('i'));
  },
  wire(el, u) {
    el.dataset.pid = u.pid || ''; el.dataset.name = u.name;
    el.addEventListener('click', () => { UISounds.click(); this.profile(u); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); this.openMenu(u, e.clientX, e.clientY); });
    el.addEventListener('pointerenter', () => UISounds.hover());
    return el;
  },
  /** UserGridPanel: 120px tall, 10px padding; a 60px avatar (6px corners), the name beside it, the status along the bottom. */
  card(u) {
    const me = u.id && u.id === Presence.me;
    return this.wire(h(`div.up.up-card${u.online ? '' : '.off'}`, this.cover(u),
      h('div.up-grid',
        Presence.avatarEl(u, 60),
        h('div.up-who', h('div.up-name', u.name, me ? h('span.up-you', 'you') : null, Friends.has(u.pid) && !me ? h('span.up-fr', icon('heart', 'fill')) : null)),
        h('div.up-iconcell', this.statusIcon(u)),
        this.statusMsg(u)),
      me ? null : this.moreBtn(u)), u);
  },
  /** UserListPanel: a 40px row, the cover over its right half, the status on the right. */
  row(u) {
    const me = u.id && u.id === Presence.me;
    return this.wire(h(`div.up.up-list${u.online ? '' : '.off'}`, this.cover(u),
      h('div.up-l', Presence.avatarEl(u, 40), h('div.up-name', u.name, me ? h('span.up-you', 'you') : null)),
      h('div.up-r', this.statusIcon(u), this.statusMsg(u, true), me ? null : this.moreBtn(u))), u);
  },
  /** UserBrickPanel: a 4×13 colour bar and the name in 13px bold. */
  brick(u) { return this.wire(h(`div.up.up-brick${u.online ? '' : '.off'}`, h('span.up-bar', { style: { background: this.statusColour(u) === '#000' ? '#555' : this.statusColour(u) } }), h('span', u.name)), u); },
  panel(u, style) { return style === 'list' ? this.row(u) : style === 'brick' ? this.brick(u) : this.card(u); },
  /** A player's profile (lazer opens UserProfileOverlay): their card, what they're doing, and what you can do. */
  /** lazer's user profile: the full profile page (theirs from the server); the small card below is for players
   *  without a public id. */
  profile(u) {
    if (u.pid) { const mine = u.pid === Presence.pid(); Screens.go('profile', mine ? { force: true } : { pid: u.pid, name: u.name, avatar: u.avatar, force: true }); return; }
    this.profileCard(u);
  },
  profileCard(u) {
    const friend = Friends.has(u.pid), me = u.id && u.id === Presence.me;
    const acts = [];
    if (this.canSpectate(u)) acts.push({ label: 'Spectate', primary: true, onClick: () => Spectate.watch(u) });
    if (this.canInvite(u)) acts.push({ label: 'Invite to room', primary: !acts.length, onClick: () => { Presence.invite(u.id); Toast.ok('Invited', u.name); } });
    if (!me && !friend && u.online && u.id) acts.push(Friends.incoming(u.pid) ? { label: 'Accept friend request', primary: true, onClick: () => Friends.answer(u.pid, true) }
      : Friends.requested(u.pid) ? { label: 'Friend request sent', close: false } : { label: 'Add friend', primary: !acts.length, onClick: () => Friends.toggle(u) });
    acts.push({ label: 'Close' });
    const body = h('div.up-profile',
      h('div.up-ph', this.cover(u), Presence.avatarEl(u, 84), h('div', h('h3', u.name), h('div.up-ph-st', this.statusIcon(u), this.statusMsg(u)))),
      h('div.up-ph-rows',
        h('div', h('span', 'Status'), h('b', this.statusText(u))),
        friend ? h('div', h('span', 'Friend'), h('b', 'Yes — you can invite each other')) : !me ? h('div', h('span', 'Friend'), h('b', Friends.requested(u.pid) ? 'Request sent' : 'No')) : null,
        u.watchers ? h('div', h('span', 'Spectators'), h('b', String(u.watchers))) : null),
      friend && !me ? h('button.up-unfriend', { onclick: () => { o.close(); Friends.toggle(u); } }, 'Remove friend…') : null);
    const o = Dialog.custom(me ? 'Your profile' : `${u.name}'s profile`, body, acts);
  },
};

/** osu!lazer's Dashboard overlay (DashboardOverlay): "friends" — FriendDisplay: All / Online / Offline stream
 *  control, a search box, the sort tabs and display-style buttons, then the panels — and "currently online". */
const DashboardScreen = {
  tab: 'friends', filter: 'all', query: '',
  sort() { return Settings.get('ui.dashSort') || 'lastVisit'; },
  style() { return Settings.get('ui.dashStyle') || 'card'; },
  enter(params = {}) {
    if (params.tab) this.tab = params.tab;
    Presence.start(); Presence.refresh();
    this.tabsEl = h('div.dash-tabs');
    const { el, page } = pageShell('dashboard', 'view your friends and who\'s online', [], { icon: 'social', hue: 'purple', tabs: this.tabsEl, wide: true });
    this.page = page;
    page.classList.add('dash-page'); el.querySelector('.screen-body').classList.add('dash-screen'); // (its panel reaches the bottom)
    const r = () => this.render();
    this._unsub = [Bus.on('presence:changed', r), Bus.on('friends:changed', r), Bus.on('mp:changed', r)];
    this._tick = setInterval(() => Presence.refresh(), 10000);
    this.render();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); clearInterval(this._tick); },
  users() {
    const online = Presence.players || [];
    LastSeen.touch(online.filter(p => Friends.has(p.pid)).map(p => p.pid));
    return online.map(p => ({ ...p, online: true }));
  },
  render() {
    if (!this.page) return;
    const keepFocus = document.activeElement && document.activeElement.classList.contains('dash-search');
    clearEl(this.tabsEl).append(...[['friends', 'friends'], ['online', 'currently online']].map(([k, l]) =>
      h(`button.ov-tab${this.tab === k ? '.on' : ''}`, { onclick: () => { UISounds.click(); this._fade = true; this.tab = k; this.render(); } }, l)));
    const online = this.users();
    const search = h('input.input.dash-search', { type: 'search', placeholder: 'type to search', value: this.query, oninput: e => { this.query = e.target.value; this.renderList(); }, onkeydown: e => searchBoxKey(e, () => { this.query = ''; this.renderList(); }) });
    const style = this.style();
    const styleBtns = h('div.dash-styles', ...[['card', 'Card'], ['list', 'List'], ['brick', 'Brick']].map(([k, l]) =>
      h(`button.dash-style${style === k ? '.on' : ''}`, { title: l, 'aria-label': `${l} view`, onclick: () => { UISounds.click(); this._fade = true; Settings.set('ui.dashStyle', k); this.render(); } }, h(`span.dsi.${k}`))));
    const sorts = h('div.dash-sorts', h('span.dash-sl', 'Sort by'), ...[['lastVisit', 'Last visit'], ['username', 'Username']].map(([k, l]) =>
      h(`button.dash-sort${this.sort() === k ? '.on' : ''}`, { onclick: () => { UISounds.click(); this._fade = true; Settings.set('ui.dashSort', k); this.render(); } }, l)));
    this.listEl = h('div.dash-list');
    if (this.tab === 'friends') {
      const friends = Friends.list().map(f => { const p = online.find(x => x.pid === f.pid); return p || { ...f, online: false, status: 'offline' }; });
      const counts = { all: friends.length, online: friends.filter(f => f.online).length, offline: friends.filter(f => !f.online).length };
      const stream = h('div.dash-stream', ...[['all', 'All', '#fff'], ['online', 'Online', '#b3d944'], ['offline', 'Offline', '#000']].map(([k, l, c]) =>
        h(`button.dash-si${this.filter === k ? '.on' : ''}`, { style: { '--bar': c }, onclick: () => { UISounds.click(); this._fade = true; this.filter = k; this.render(); } }, h('b', l), h('span', String(counts[k])), h('i'))));
      const reqs = Friends.requests;
      clearEl(this.page).append(
        h('div.dash-streamwrap', stream),
        h('div.dash-body',
          reqs.length ? h('div.dash-reqs', h('div.dash-h', `Friend requests (${reqs.length})`), ...reqs.map(r => h('div.up.up-list.fr-req', h('div.up-l', Presence.avatarEl(r, 40), h('div.up-name', r.name), h('span.up-sub', 'wants to be friends')),
            h('div.up-r', h('button.btn.sm.primary', { onclick: () => { UISounds.click(); Friends.answer(r.pid, true); } }, 'Accept'), h('button.btn.sm', { onclick: () => { UISounds.click(); Friends.answer(r.pid, false); } }, 'Decline'))))) : null,
          h('div.dash-bar', search, h('div.grow'), sorts, styleBtns),
          this.listEl));
      this._source = () => friends.filter(f => this.filter === 'all' || (this.filter === 'online') === f.online);
    } else {
      clearEl(this.page).append(h('div.dash-body', h('div.dash-bar', search, h('div.grow'), sorts, styleBtns), this.listEl));
      this._source = () => online;
    }
    this.renderList();
    if (keepFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
  },
  renderList() {
    if (!this.listEl) return;
    const q = this.query.trim().toLowerCase();
    let list = this._source().filter(u => !q || u.name.toLowerCase().includes(q));
    const sort = this.sort();
    list = list.sort((a, b) => sort === 'username' ? a.name.localeCompare(b.name)
      : (b.online - a.online) || ((b.online ? Date.now() : LastSeen.get(b.pid)) - (a.online ? Date.now() : LastSeen.get(a.pid))) || a.name.localeCompare(b.name));
    const style = this.style();
    // (a new view — tab, filter, sort or style — fades in as lazer's lists do; presence updates just redraw)
    this.listEl.className = `dash-list s-${style}${this._fade ? ' fade' : ''}`; this._fade = false;
    if (!Presence.ws) { clearEl(this.listEl).append(offlineState('Your friends and who\'s online')); return; }
    clearEl(this.listEl).append(...(list.length ? list.map(u => UserPanels.panel(u, style))
      : [this.tab !== 'friends' ? stateCard('social', 'Nobody is online right now', 'Players show up here while they\'re playing.', { cls: '.plain', neru: true })
        : Friends.list().length ? stateCard('search', 'Nobody here', q ? 'None of your friends match that search.' : 'None of your friends are in this list.', { cls: '.plain' })
        : stateCard('social', 'No friends yet', 'Find people under "currently online" and add them from the\u00a0⋯\u00a0menu.', { cls: '.plain', neru: true })]));
  },
};

/** The top bar's button: opens (or closes) the dashboard. */
const OnlinePanel = {
  isOpen() { return Screens.currentName === 'dashboard'; },
  toggle() { if (this.isOpen()) Screens.back(); else Screens.go('dashboard'); },
  close() {},
};

// (spectating ends when you go and do something of your own)
Bus.on('screen:changed', name => Spectate.onScreen(name));

// (someone you were watching back online: watching picks up again)
Bus.on('presence:changed', () => Spectate.relink());
