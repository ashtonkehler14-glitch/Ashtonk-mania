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

const SPEC_DELAY = 1500; // ms of song time the watcher stays behind the player (enough for the stream's chunks)

const Spectate = {
  target: null, // { id, name }: who we're watching (we follow them from play to play)
  cur: null,    // the play being watched: { id, name, head, feed, at, ready, ended, quit }
  host: { watchers: 0, s: null, sent: 0, lastSend: 0 },

  // ── watching
  watch(p) {
    if (!p || !Presence.ws) { Toast.err('Can\'t spectate right now', 'You\'re not connected to the online service.'); return; }
    if (!Friends.has(p.pid)) { Toast.show('Friends only', `Add ${p.name} as a friend to spectate them.`); return; }
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
    this.showRk(null);
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
    if (m.t === 'specRk') { this.onMirror(m); return; }
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
    if (m.t === 'specPause') {
      const c = this.cur;
      if (!c || c.id !== m.id) return;
      c.pause = m.paused ? m.at : null;
      if (!m.paused && c.pauseShown && this.watchingNow()) this.hidePause(GameplayScreen, GameplayScreen.s);
      return;
    }
    if (m.t === 'specEnd') {
      if (m.gone) { const n = this.target.name; this.target = null; this.cur = null; this.showRk(null); this.paintPill(); if (this.watchingNow()) Screens.go('home'); Toast.show(`${n} went offline`, 'Stopped spectating.'); Presence.pushStatus(); return; }
      if (this.cur) { this.cur.ended = true; this.cur.quit = !!m.quit; this.showRk(this._rk); }
      if (m.quit && this.watchingNow()) { Toast.show(`${this.target.name} quit the song`, 'Waiting for their next one…'); Screens.go('home'); }
      this.paintPill(`waiting for ${this.target.name}'s next song…`);
    }
  },
  async start(m) {
    // (never takes over your own play)
    if (Screens.currentName === 'gameplay' && !this.watchingNow()) { Toast.show(`${m.name} started a song`, 'Finish yours, then spectate again from the online list.'); return; }
    const c = this.cur = { id: m.id, name: m.name, head: m.head, feed: (m.ev || []).slice(), at: m.at || 0, ready: !!m.hist, ended: false, quit: false, pause: m.paused ?? null };
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
    this._launching = true;
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
    // the player paused: once playback reaches that moment, the watcher sees the pause screen too
    if (c.pause != null) {
      if (!c.pauseShown && now >= c.pause - 20 * s.rate) this.showPause(screen, s);
      if (c.pauseShown || now >= c.pause - 400 * s.rate) return; // (waiting at the pause isn't "waiting for the stream")
    }
    if (c.ended) { if (c.buffering) this.buffer(screen, s, false); return; }
    if (s.running && now > c.at - 150 * s.rate) this.buffer(screen, s, true);
    else if (c.buffering && c.at - now > SPEC_DELAY * 0.6 * s.rate) this.buffer(screen, s, false);
  },
  showPause(screen, s) {
    const c = s.spectate;
    if (c.buffering) this.buffer(screen, s, false);
    c.pauseShown = true;
    s.running = false; Music.pause();
    // the pause menu as the player sees it, without its buttons (it's theirs): just a way to stop watching
    c.pauseEl = h('div.pause-menu.spec-pause', h('div.pause-box',
      h('div.pm-head', h('h2', 'paused')),
      h('div.spec-pause-sub', `${c.name} paused the game — it carries on when they continue.`),
      h('div.pm-buttons', h('button.pm-btn.danger', { style: { '--c': '#aa1b27' }, onclick: () => { UISounds.click(); this.stop(); } }, h('span.pm-band'), h('span.pm-label', 'Stop spectating')))));
    screen.el.appendChild(c.pauseEl);
    screen.el.classList.add('show-cursor');
    this.showRk(this._rk);
  },
  hidePause(screen, s) {
    const c = s && s.spectate;
    if (!c || !c.pauseShown) return;
    c.pauseShown = false;
    if (c.pauseEl) { c.pauseEl.remove(); c.pauseEl = null; }
    screen.el.classList.remove('show-cursor');
    s.running = true; Music.play(Music.pausedPos);
    this.showRk(this._rk);
  },
  /** Back in the tab after a while: straight back to the live play (a couple of seconds behind it). */
  catchUp(screen, s) {
    const c = s.spectate;
    if (!c || !c.synced || c.ended || c.pauseShown || s.finished) return;
    if (AudioManager.ctx && AudioManager.ctx.state !== 'running') AudioManager.resume();
    const target = c.at - SPEC_DELAY * s.rate, now = screen.gameTime();
    if (target - now > 1500 * s.rate || now > c.at) screen.replaySeek(Math.max(0, target));
    if (!s.running && !c.buffering) { s.running = true; Music.play(Music.pausedPos); }
  },
  hostPause(paused, at) { if (Presence.ws) Presence.send({ t: 'pause', paused, at }); },
  buffer(screen, s, on) {
    const c = s.spectate;
    if (!!c.buffering === on) return;
    c.buffering = on;
    if (on) { s.running = false; Music.pause(); c.msg = h('div.hud-center-msg.spec-wait', `Waiting for ${c.name}…`); screen.hud.append(c.msg); }
    else { if (c.msg) { c.msg.remove(); c.msg = null; } s.running = true; Music.play(Music.pausedPos); }
    this.showRk(this._rk); // (their screen over the song while it waits on them; gone when it carries on)
  },

  /** You stop watching when you go and do something of your own: your own play, or any screen other than the one
   *  you're shown while watching (home between songs, the watched play and its results). */
  onScreen(name) {
    if (!this.target) return;
    if (name === 'gameplay') { if (this.rkEl) { this.rkEl.remove(); this.rkEl = null; } if (this._launching) { this._launching = false; return; } this.stop({ quiet: true }); return; }
    if (name !== 'home' && name !== 'results') { this.stop({ quiet: true }); return; }
    if (this._rk) this.showRk(this._rk); // (back from their song: their Ranked Play screen again)
  },

  /** A friend's Ranked Play screen (their picks, cards, timer and results between songs), shown read-only over the
   *  game while you watch them; their songs play as usual spectating. Their page is copied as HTML, so it's cleaned
   *  first: no scripts, event handlers, frames or links, and only https/data images. */
  /** Watching their song but it can't go on (they failed, paused or stopped, so no more key presses come): their
   *  screen is shown over it. */
  stalled() { const c = this.cur; return !!(c && (c.buffering || c.pauseShown || c.ended)); },
  showRk(html) {
    this._rk = html || null;
    if (!html || !this.target || (this.watchingNow() && !this.stalled())) { if (this.rkEl) { this.rkEl.remove(); this.rkEl = null; } return; }
    if (!this.rkEl) {
      this.rkView = h('div.spec-rk-view');
      this.rkEl = h('div.spec-rk', this.rkView, h('div.spec-rk-bar', icon('film'), h('span', `Spectating ${this.target.name}`), h('button.btn.sm', { onclick: () => { UISounds.click(); this.stop(); } }, 'Stop spectating')));
      ($('#app') || document.body).appendChild(this.rkEl);
    }
    const t = document.createElement('template');
    t.innerHTML = html;
    const ok = u => /^(https:|data:image\/)/i.test(u.trim());
    for (const el of t.content.querySelectorAll('*')) {
      if (/^(SCRIPT|IFRAME|OBJECT|EMBED|LINK|META|FORM|BASE|STYLE|TEMPLATE)$/.test(el.tagName)) { el.remove(); continue; }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        if (n.startsWith('on') || n === 'href' || n === 'srcdoc' || n === 'formaction' || n === 'action' || n === 'xlink:href') el.removeAttribute(a.name);
        else if ((n === 'src' || n === 'srcset') && !ok(a.value)) el.removeAttribute(a.name);
        else if (n === 'style' && /url\(\s*['"]?\s*(?!https:|data:image\/)/i.test(a.value)) el.setAttribute('style', a.value.replace(/url\([^)]*\)/gi, 'none'));
        else if (n === 'style' && /expression|javascript:/i.test(a.value)) el.removeAttribute('style');
      }
    }
    this.rkView.replaceChildren(t.content);
  },
  /** A piece of the player's screen (compressed, in chunks): put together, unpacked and shown. */
  async onMirror(m) {
    if (m.z == null) { this._mirIn = null; this.showRk(m.html || null); return; }
    let r = this._mirIn;
    if (!r || r.seq !== m.seq) r = this._mirIn = { seq: m.seq, parts: m.parts, z: [] };
    r.z[m.part] = m.z;
    for (let i = 0; i < r.parts; i++) if (r.z[i] == null) return;
    this._mirIn = null;
    try {
      const bin = Uint8Array.from(atob(r.z.join('')), ch => ch.charCodeAt(0));
      const html = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      if (this._mirShown != null && m.seq < this._mirShown) return; // (an older screen unpacked late)
      this._mirShown = m.seq;
      this.showRk(html);
    } catch (e) { console.warn('spectate: a screen that couldn\'t be unpacked', e); }
  },
  /** While anyone watches: everything you see, whenever you're not in the middle of a song (your fail and pause
   *  screens, results, menus, Ranked Play between songs) — copied as it changes, at most 4 times a second, so the
   *  watchers see what you're doing. Mid-song they watch the song itself, played back from your key presses. */
  mirrorTick() {
    const H = this.host;
    if (!H.watchers || !Presence.ws) { if (this._mirOn) { this._mirOn = false; this._mirHtml = null; Presence.send({ t: 'rkview', html: null }); } return; }
    const G = typeof GameplayScreen !== 'undefined' ? GameplayScreen : null, s = G && G.s;
    const live = Screens.currentName === 'gameplay' && s && s.running && !s.failed && !s.finished;
    if (live) { if (this._mirOn) { this._mirOn = false; this._mirHtml = null; Presence.send({ t: 'rkview', html: null }); } return; }
    const app = $('#app'), html = app ? this.mirrorHtml(app) : null;
    if (!html || html === this._mirHtml) return;
    this._mirHtml = html; this._mirOn = true;
    this.sendMirror(html);
  },
  /** The screen as HTML, without what's only yours (the spectating panel, the cursor). */
  mirrorHtml(app) {
    const c = app.cloneNode(true);
    for (const el of c.querySelectorAll('.spec-rk, .cursor, #cursor, .kb-bar')) el.remove();
    for (const el of c.querySelectorAll('input, textarea')) { const src = el.id && app.querySelector('#' + CSS.escape(el.id)); el.setAttribute('value', el.value || (src && src.value) || ''); }
    return c.innerHTML;
  },
  async sendMirror(html) {
    const seq = this._mirSeq = (this._mirSeq || 0) + 1;
    try {
      const buf = new Uint8Array(await new Response(new Blob([html]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
      if (seq !== this._mirSeq) return; // (a newer screen is on its way)
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      const z = btoa(bin), CH = 60000, parts = Math.max(1, Math.ceil(z.length / CH));
      if (parts > 40) return; // (a screen too big to send: the last one stays)
      for (let i = 0; i < parts; i++) Presence.send({ t: 'rkview', seq, part: i, parts, z: z.slice(i * CH, (i + 1) * CH) });
    } catch (e) { console.warn('spectate: couldn\'t send the screen', e); }
  },
  /** Your Ranked Play screen, sent to your spectators as it changes (at most 4 times a second). */
  hostRk(root, force = false) {
    // (now part of the whole-screen mirror)
    if (force) this.mirrorTick();
  },

  // ── being watched: stream this play's inputs while anyone watches
  onSpectators(m) {
    const H = this.host;
    H.watchers = m.n || 0;
    this.paintWatchers(m.names || []);
    if (typeof RankedMatch !== 'undefined' && RankedMatch.root) this.hostRk(RankedMatch.root, true);
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

/** When each friend was last seen online (kept in this browser), for "Last seen …" and lazer's "Last visit" sort. */
const LastSeen = {
  KEY: 'am.lastSeen',
  map() { try { return JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch { return {}; } },
  get(pid) { return this.map()[pid] || 0; },
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
    const url = a.startsWith('preset:') ? AvatarPresets.url(a.slice(7)) : a.startsWith('file:') ? 'avatars/' + encodeURIComponent(a.slice(5)) : a.startsWith('data:image/') ? a : null;
    return h('div.up-cover', url ? { style: { backgroundImage: `url("${url}")` } } : {});
  },
  canSpectate(u) { return u.online && u.id && u.id !== Presence.me && Friends.has(u.pid) && (u.status === 'playing' || u.status === 'ranked'); },
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
        friend ? h('div', h('span', 'Friend'), h('b', 'Yes — you can invite and spectate each other')) : !me ? h('div', h('span', 'Friend'), h('b', Friends.requested(u.pid) ? 'Request sent' : 'No')) : null,
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
      h(`button.ov-tab${this.tab === k ? '.on' : ''}`, { onclick: () => { UISounds.click(); this.tab = k; this.render(); } }, l)));
    const online = this.users();
    const search = h('input.input.dash-search', { type: 'search', placeholder: 'type to search', value: this.query, oninput: e => { this.query = e.target.value; this.renderList(); }, onkeydown: e => e.stopPropagation() });
    const style = this.style();
    const styleBtns = h('div.dash-styles', ...[['card', 'Card'], ['list', 'List'], ['brick', 'Brick']].map(([k, l]) =>
      h(`button.dash-style${style === k ? '.on' : ''}`, { title: l, 'aria-label': `${l} view`, onclick: () => { UISounds.click(); Settings.set('ui.dashStyle', k); this.render(); } }, h(`span.dsi.${k}`))));
    const sorts = h('div.dash-sorts', h('span.dash-sl', 'Sort by'), ...[['lastVisit', 'Last visit'], ['username', 'Username']].map(([k, l]) =>
      h(`button.dash-sort${this.sort() === k ? '.on' : ''}`, { onclick: () => { UISounds.click(); Settings.set('ui.dashSort', k); this.render(); } }, l)));
    this.listEl = h('div.dash-list');
    if (this.tab === 'friends') {
      const friends = Friends.list().map(f => { const p = online.find(x => x.pid === f.pid); return p || { ...f, online: false, status: 'offline' }; });
      const counts = { all: friends.length, online: friends.filter(f => f.online).length, offline: friends.filter(f => !f.online).length };
      const stream = h('div.dash-stream', ...[['all', 'All', '#fff'], ['online', 'Online', '#b3d944'], ['offline', 'Offline', '#000']].map(([k, l, c]) =>
        h(`button.dash-si${this.filter === k ? '.on' : ''}`, { style: { '--bar': c }, onclick: () => { UISounds.click(); this.filter = k; this.render(); } }, h('b', l), h('span', String(counts[k])), h('i'))));
      const reqs = Friends.requests;
      clearEl(this.page).append(
        h('div.dash-streamwrap', stream),
        h('div.dash-body',
          reqs.length ? h('div.dash-reqs', h('div.dash-h', `Friend requests (${reqs.length})`), ...reqs.map(r => h('div.up.up-list.fr-req', h('div.up-l', Presence.avatarEl({ name: r.name }, 40), h('div.up-name', r.name), h('span.up-sub', 'wants to be friends')),
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
    this.listEl.className = `dash-list s-${style}`;
    if (!Presence.ws) { clearEl(this.listEl).append(h('div.dash-empty', Multiplayer.available() ? 'Connecting to the online service…' : 'Online play needs the game\'s server (open the game from its website).')); return; }
    clearEl(this.listEl).append(...(list.length ? list.map(u => UserPanels.panel(u, style))
      : [h('div.dash-empty', this.tab === 'friends' ? (Friends.list().length ? 'Nobody here.' : 'No friends yet — find people under "currently online" and add them from the ⋯ menu.') : 'Nobody is online right now.')]));
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

// (being watched: your screen goes to your spectators as it changes — nothing happens while nobody watches)
setInterval(() => { try { Spectate.mirrorTick(); } catch (e) { /* the next tick tries again */ } }, 250);
