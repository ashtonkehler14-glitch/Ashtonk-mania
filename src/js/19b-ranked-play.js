/* Ranked Play — osu!lazer's 1v1 card mode on the client: your rating, the queue, and the match screen (lazer's
 * RankedPlayScreen: the two corner pieces with life, the stage display and its timer, the intro, the discard and pick
 * phases with hands of beatmap cards — the opponent's hand replayed as they handle it — gameplay warmup, the results
 * with the damage, and the end screen with the new ratings). The rules themselves are the server's: worker/ranked-play.js. */

/** lazer's two colour schemes (RankedPlayColourScheme): you are blue, your opponent red. */
const RP_BLUE = { primary: '#5ebfff', darker: '#4382ff', darkest: '#5c55ff', surface: '#33303d', border: '#514c5e' };
const RP_RED = { primary: '#ff8198', darker: '#f94d92', darkest: '#b6104d', surface: '#242023', border: '#403b3f' };
const RP_LIFE = 1000000;

/** A lasting id for this browser: the queue knows you by it (bans; you're never matched with yourself), and a dropped
 *  connection rejoins a match as the same player. */
function clientId() {
  try { let c = localStorage.getItem('am.cid'); if (!c) { c = uid() + uid(); localStorage.setItem('am.cid', c); } return c; }
  catch { return clientId._mem || (clientId._mem = uid() + uid()); }
}

/** Your Ranked Play rating, one per key count (lazer's 4K and 7K pools), kept on this device. A new player starts where
 *  lazer would put them from their pp (−4000 + 600·ln(pp + 4000)); matches from the queue then move it (OpenSkill,
 *  worked out by the server). Also the history of recent matches. */
const RankedRating = {
  KEY: 'am.rp.ratings',
  _read() { try { return JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch { return this._mem || (this._mem = {}); } },
  _write(d) { this._mem = d; try { localStorage.setItem(this.KEY, JSON.stringify(d)); } catch { /* private mode: kept for this session */ } },
  initial(keys) {
    const pp = ScoreManager.totalPp(ScoreManager.scores.filter(s => s.keys === keys)).total || 0;
    return clamp(-4000 + 600 * Math.log(pp + 4000), 0, 5000);
  },
  get(keys) { const p = this._read()[keys]; return p && Number.isFinite(p.mu) ? p : { mu: this.initial(keys), sigma: 150, played: 0, won: 0, fresh: true }; },
  rating(keys) { return Math.round(this.get(keys).mu); },
  /** What a room needs to know about you (sent in every hello). */
  hello() { const r = k => { const p = this.get(k); return { mu: p.mu, sigma: p.sigma }; }; return { cid: clientId(), ratings: { 4: r(4), 7: r(7) } }; },
  /** A finished match: the new rating when it was rated, and a line in the history either way (once per match). */
  record(m) {
    const d = this._read();
    if ((d.history || []).some(x => x.id === m.id)) return;
    if (m.rated && Number.isFinite(m.muAfter)) {
      const p = this.get(m.keys);
      d[m.keys] = { mu: m.muAfter, sigma: m.sigmaAfter, played: (p.played || 0) + 1, won: (p.won || 0) + (m.result === 'win' ? 1 : 0) };
    }
    d.history = [m, ...(d.history || [])].slice(0, 20);
    this._write(d);
    Bus.emit('rp:rating');
  },
  history() { return this._read().history || []; },
};

/** The Ranked Play queue (lazer's ScreenQueue / QueueController): searching, the "match found" offer to accept, then
 *  off to the match. It polls the Worker every 1.5 s and keeps going while you look around the rest of the game. */
const RankQueue = {
  st: null, // { keys, ticket, status, queued, waited, since, opponent, left, accepted, opponentAccepted, room, banned }
  get active() { return !!this.st; },
  async api(path, body) { return Multiplayer.api('api/mp/rq/' + path, body); },
  async start(keys) {
    if (this.st || Multiplayer.inRoom()) return;
    keys = keys === 7 ? 7 : 4;
    this.st = { keys, status: 'joining', since: performance.now() };
    Bus.emit('rq:changed');
    try {
      const r = await this.api('join', { ...RankedRating.hello(), name: ProfileManager.profile.name, avatar: ProfileManager.sharedAvatar || '', keys, rating: RankedRating.rating(keys) });
      if (!this.st) { if (r.ticket) this.api('leave', { ticket: r.ticket }).catch(() => {}); return; }
      if (r.status === 'banned') { this.st = null; Toast.err('You can\'t queue right now', `You left or declined a match. Try again in ${Math.ceil(r.left / 1000)}s.`); Bus.emit('rq:changed'); return; }
      this.apply(r);
      UISounds.play('rp-enqueue');
      this.loop();
    } catch (e) { this.st = null; Toast.err('Couldn\'t join the queue', friendlyError(e)); Bus.emit('rq:changed'); }
  },
  loop() {
    clearTimeout(this._t);
    this._t = setTimeout(async () => {
      const st = this.st;
      if (!st || !st.ticket) return;
      try { const r = await this.api('poll', { ticket: st.ticket }); if (this.st === st) this.apply(r); } catch { /* a missed poll: try again */ }
      if (this.st === st) this.loop();
    }, 1500);
  },
  apply(r) {
    const st = this.st, was = st.status;
    Object.assign(st, r);
    if (r.status === 'none') { this.st = null; if (was === 'found' || was === 'accepted') Toast.show('The match fell through', 'Your opponent didn\'t accept. Queue again to keep searching.'); Bus.emit('rq:changed'); this.closeOffer(); return; }
    if (r.status === 'found' && was !== 'found') { UISounds.play('rp-found'); this.offer(); }
    if (r.status === 'search' && was === 'found') { this.closeOffer(); Toast.show('Back to searching', 'Your opponent didn\'t accept the match.'); }
    if (r.status === 'ready') { this.go(r); return; }
    Bus.emit('rq:changed');
  },
  async accept() { if (!this.st || this.st.status !== 'found') return; UISounds.click(); this.st.accepted = true; Bus.emit('rq:changed'); try { this.apply(await this.api('accept', { ticket: this.st.ticket })); } catch { /* the poll catches up */ } },
  async decline() { const st = this.st; if (!st) return; this.st = null; clearTimeout(this._t); this.closeOffer(); Bus.emit('rq:changed'); if (st.ticket) this.api('decline', { ticket: st.ticket }).catch(() => {}); },
  stop() { this.decline(); },
  /** Both accepted: into the match's room (whoever gets there first opens it). */
  async go(r) {
    const st = this.st;
    clearTimeout(this._t); this.st = null; this.closeOffer();
    Bus.emit('rq:changed');
    try {
      if (Screens.currentName !== 'multiplayer') await Screens.go('multiplayer');
      await Multiplayer.connect(r.room, true, false, false, { mode: 'rp', rated: true, keys: st.keys, ...RankedRating.hello() });
    } catch (e) { Toast.err('Couldn\'t join the match', friendlyError(e)); }
  },
  /** lazer's "Match found!" offer: the opponent, 30 seconds to accept. Shown over any screen but gameplay. */
  offer() {
    this.closeOffer();
    const st = this.st;
    if (Screens.currentName === 'gameplay') { Toast.show('Ranked Play: match found!', 'Finish up — accept it from the multiplayer screen within 30 seconds.'); return; }
    const body = h('div.rq-offer');
    const paint = () => {
      const s = this.st;
      if (!s || s.status !== 'found') return;
      const o = s.opponent || { name: 'Opponent', rating: 0 };
      clearEl(body).append(
        h('div.rq-vs', h('div.rq-p', ProfileManager.avatarEl(64), h('b', ProfileManager.profile.name), h('span', `Rating ${fmtInt(RankedRating.rating(s.keys))}`)),
          h('div.rq-x', 'VS'),
          h('div.rq-p', Presence.avatarEl(o, 64), h('b', o.name), h('span', `Rating ${fmtInt(o.rating)}`))),
        h('div.rq-bar', h('i', { style: { transform: `scaleX(${clamp((s.left || 0) / 30000, 0, 1).toFixed(3)})` } })),
        h('div.rq-note', s.accepted ? (s.opponentAccepted ? 'Good luck!' : 'Waiting for your opponent…') : `${s.keys}K Ranked Play · accept within ${Math.ceil((s.left || 0) / 1000)}s`));
    };
    paint();
    const o = Dialog.custom('Match found!', body, [
      { label: 'Decline', onClick: () => this.decline() },
      { label: 'Accept', primary: true, close: false, onClick: () => { this.accept(); o.el && o.el.querySelectorAll('.actions button').forEach(b => { b.disabled = true; }); } }]);
    const off = Bus.on('rq:changed', paint);
    const close = o.close; o.close = () => { off(); close(); if (this._offer === o) this._offer = null; };
    this._offer = o;
  },
  closeOffer() { if (this._offer) { const o = this._offer; this._offer = null; o.close(); } },
  /** Elapsed search time as m:ss. */
  waited() { return this.st ? fmtTime(performance.now() - this.st.since) : '0:00'; },
};

/** The deck for a match, drawn up by the dealer's client (`targets`: the server's star ratings, one per card): ranked
 *  beatmaps for the key count from the online listing, each target taking the closest one not yet used (one card per
 *  beatmap set where it can). Without enough online, the player's own library fills in. */
async function buildRankedDeck(m) {
  const keys = m.keys === 7 ? 7 : 4, targets = (Array.isArray(m.targets) ? m.targets : []).map(Number).filter(Number.isFinite).slice(0, 50);
  if (!targets.length) return;
  const sorted = [...targets].sort((a, b) => a - b), lo = Math.max(0, sorted[0] - 0.35), hi = sorted[sorted.length - 1] + 0.35;
  const cand = [], seen = new Set();
  try {
    const one = p => OnlineBeatmaps.search({ q: '', status: 'ranked', keys: [keys], minStars: lo, maxStars: hi, page: p, nsfw: false }).catch(() => ({ sets: [] }));
    const pages = await Promise.race([Promise.all([0, 1, 2, 3].map(one)), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 9000))]);
    for (const d of pages) for (const set of d.sets || []) {
      if (seen.has(set.id)) continue;
      seen.add(set.id);
      for (const x of set.diffs || []) if (x.keys === keys && x.id > 0) cand.push({ hash: '', title: set.title, artist: set.artist, version: x.version, creator: set.creator, keys, stars: x.stars, length: (x.length || 0) * 1000, onlineSetId: set.id, onlineId: x.id, group: 's' + set.id });
    }
  } catch (e) { console.warn('Ranked Play deck: online search failed', e); }
  if (cand.length < targets.length) {
    for (const x of BeatmapManager.maps.values()) {
      if (x.keys !== keys || x.problems.length) continue;
      const set = BeatmapManager.setById.get(x.setId), osid = set && set.onlineId > 0 ? set.onlineId : -1;
      if (osid > 0 && cand.some(c => c.onlineId === x.onlineId && x.onlineId > 0)) continue;
      cand.push({ hash: x.hash, title: x.title, artist: x.artist, version: x.version, creator: x.creator, keys, stars: x.stars, length: x.length, onlineSetId: osid, onlineId: x.onlineId > 0 ? x.onlineId : -1, group: osid > 0 ? 's' + osid : 'l' + x.setId });
    }
  }
  if (!cand.length) return;
  const used = new Set(), groups = new Set(), deck = [];
  for (const t of targets) {
    let best = null, bd = Infinity;
    for (const c of cand) {
      if (used.has(c)) continue;
      const d = Math.abs(c.stars - t) + (groups.has(c.group) ? 0.75 : 0);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) break;
    used.add(best); groups.add(best.group); deck.push(best);
  }
  // a tiny library (offline): the same beatmaps more than once, so there are still cards to play
  for (let i = 0; deck.length < Math.min(12, targets.length); i++) deck.push(deck[i % Math.max(1, deck.length)]);
  const g = Multiplayer.room && Multiplayer.room.rp;
  if (g && g.stage === 'deal') Multiplayer.send({ t: 'pool', maps: deck.map(({ group, ...c }) => c) });
}

/** The match screen. Mounted inside the multiplayer screen whenever the room is a Ranked Play match. */
const RankedMatch = {
  root: null, scr: null,
  get g() { return Multiplayer.room && Multiplayer.room.rp; },
  me() { return Multiplayer.me; },
  oppId() { const g = this.g; return g ? Object.keys(g.users).find(id => id !== Multiplayer.me) || null : null; },
  player(id) { return Multiplayer.room ? Multiplayer.room.players.find(p => p.id === id) || null : null; },
  name(id) { const p = this.player(id); return id === Multiplayer.me ? ProfileManager.profile.name : p ? p.name : (this._names && this._names[id]) || 'Opponent'; },
  avatar(id, size) { return id === Multiplayer.me ? ProfileManager.avatarEl(size) : Presence.avatarEl(this.player(id) || { name: this.name(id) }, size); },

  mount(scr) {
    this.scr = scr;
    if (!this.root || !this.root.isConnected) this.build();
    this.update();
  },
  build() {
    const s = this.scr;
    clearEl(s.body);
    s.roomEl = null;
    this.root = h('div.rkm');
    this.bg = h('div.rkm-bg'); this.bgMap = h('div.rkm-bgmap');
    this.top = h('div.rkm-top');
    this.cornerMe = h('div.rkm-corner.me'); this.cornerOpp = h('div.rkm-corner.opp');
    this.main = h('div.rkm-main');
    this.ov = h('div.rkm-ov');
    this.chat = this.buildChat();
    const leave = h('button.rkm-leave', { title: 'Leave the match', 'aria-label': 'Leave the match', onclick: () => this.confirmLeave() }, icon('back'), h('span', 'Leave'));
    this.root.append(this.bg, this.bgMap, this.main, this.top, this.cornerMe, this.cornerOpp, this.chat, leave, this.ov);
    s.el.appendChild(this.root);
    s.el.classList.add('rkm-on');
    $('#app').classList.add('hide-toolbar');
    this._key = null; this._cornerKey = null; this._lastStage = null; this._names = {};
    this._subs = [
      Bus.on('mp:chat', m => this.addChat(m)),
      Bus.on('rp:hand', m => this.onHand(m)),
      Bus.on('mp:fetch', () => this.paintCorners(true)),
    ];
    const loop = () => { this._raf = requestAnimationFrame(loop); this.tick(); };
    loop();
  },
  unmount() {
    if (!this.root) return;
    cancelAnimationFrame(this._raf);
    (this._subs || []).forEach(f => f()); this._subs = [];
    this.stopPreview();
    this.root.remove(); this.root = null;
    if (this.scr && this.scr.el) this.scr.el.classList.remove('rkm-on');
    $('#app').classList.remove('hide-toolbar');
    clearTimeout(this._handT);
  },
  /** Leaving: during a match it loses the match (and, from the queue, a while out of it). */
  async confirmLeave() {
    const g = this.g;
    const live = g && !['ended'].includes(g.stage) && !(g.stage === 'waitjoin' && !g.rated);
    if (live) {
      const ok = await Dialog.confirm('Leave the match?', g.stage === 'waitjoin' || g.stage === 'deal' ? 'The match hasn\'t started yet — leaving now doesn\'t count as a loss.' : `Leaving now loses the match${g.rated ? ' and keeps you out of the queue for 10 minutes' : ''}.`, { ok: 'Leave', danger: true });
      if (!ok) return;
    }
    Multiplayer.leave();
  },

  // ── updates
  update() {
    const g = this.g, r = Multiplayer.room;
    if (!g || !this.root) return;
    for (const p of r.players) this._names[p.id] = p.name;
    if (g.left > 0) { this.endAt = performance.now() + g.left - Multiplayer.rtt / 2; this.len = g.len || g.left; } else { this.endAt = 0; this.len = 0; }
    this.root.dataset.stage = g.stage;
    const opp = this.oppId();
    const key = `${r.code}|${g.stage}|${g.round}|${g.active}|${opp || ''}`;
    const fresh = key !== this._key;
    if (fresh) {
      const prev = this._lastStage;
      this._key = key; this._lastStage = g.stage;
      this.stopPreview();
      this.renderStage(g, prev);
      this.stageOverlay(g, prev);
    } else this.refreshStage(g);
    this.paintTop(g);
    this.paintCorners();
    this.chat.classList.toggle('hidden', g.stage === 'deal' || (g.stage === 'warmup' && g.round === 1) || g.stage === 'waitjoin');
    // the end of a match goes into your history (and moves your rating if it was rated)
    if (g.stage === 'ended' && g.round > 0 && !this._recorded) this.recordEnd(g);
    if (g.stage !== 'ended') this._recorded = false;
  },
  recordEnd(g) {
    this._recorded = true;
    const me = g.users[Multiplayer.me], oppId = this.oppId(), o = oppId ? g.users[oppId] : null;
    if (!me) return;
    const result = g.winner === Multiplayer.me ? 'win' : g.winner ? 'loss' : 'draw';
    RankedRating.record({ id: `${Multiplayer.room.code}-${g.round}`, at: Date.now(), keys: g.keys, rated: g.rated, result, rounds: g.round,
      me: { life: me.life, won: me.won, before: me.rating, after: me.ratingAfter }, muAfter: me.muAfter, sigmaAfter: me.sigmaAfter,
      opp: o ? { name: this.name(oppId), avatar: (this.player(oppId) || {}).avatar || '', life: o.life, won: o.won, before: o.rating, after: o.ratingAfter } : null });
  },
  /** Every frame: the stage timer and its bar (and the warning sounds as it runs out). */
  tick() {
    const g = this.g;
    if (!g || !this.timerEl) return;
    const left = this.endAt ? Math.max(0, this.endAt - performance.now()) : 0;
    const txt = this.endAt ? `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}.${String(Math.floor(left % 1000)).padStart(3, '0')}` : '';
    if (txt !== this._tt) { this._tt = txt; this.timerEl.textContent = txt; }
    const p = this.endAt && this.len ? clamp(left / this.len, 0, 1) : 0;
    const q = Math.round(p * 500);
    if (q !== this._tq) { this._tq = q; this.timerBar.style.transform = `scaleX(${q / 500})`; }
    // lazer warns when the discard or your own pick is about to run out: the timer turns red, then ticks each second
    const warn = !!this.endAt && left > 0 && left <= 10000 && (g.stage === 'discard' && !g.users[Multiplayer.me]?.discarded || (g.stage === 'pick' && g.active === Multiplayer.me));
    if (warn !== this._warn) { this._warn = warn; this.top.classList.toggle('warn', warn); }
    if (warn && left <= 4000) { const sec = Math.ceil(left / 1000); if (sec !== this._tickSec) { this._tickSec = sec; UISounds.play('rp-tick'); } }
    if (this.countEl && g.stage === 'ready' && g.countdown) { const n = Math.ceil(left / 1000); if (n !== this._cd) { this._cd = n; this.countEl.textContent = n > 0 ? n : 'Go!'; } }
    if (this._intro) this.tickIntro();
  },

  // ── the frame: stage display, corner pieces, chat
  paintTop(g) {
    if (!this.timerEl) {
      this.headEl = h('div.rkm-head'); this.timerEl = h('span.rkm-timer'); this.timerBar = h('i'); this.capEl = h('div.rkm-cap');
      this.multEl = h('div.rkm-round');
      this.top.append(h('div.rkm-headbox', this.headEl, h('div.rkm-tbar', this.timerBar), this.timerEl), this.capEl, this.multEl);
    }
    const H = { waitjoin: '', deal: '', warmup: '', discard: 'Discard Phase', discarded: 'Discard Phase', pick: 'Pick Phase', picked: 'Pick Phase', ready: 'Gameplay', playing: 'Gameplay', results: 'Results', ended: 'Results' };
    const head = H[g.stage] || '';
    if (this.headEl.textContent !== head) this.headEl.textContent = head;
    this.top.classList.toggle('none', !head);
    const cap = this.caption(g);
    if (this.capEl.textContent !== cap) this.capEl.textContent = cap;
    const round = g.round > 0 && !['ended', 'waitjoin', 'deal'].includes(g.stage) ? `Round ${g.round} · ×${+g.mult.toFixed(1)} round damage${g.rated ? '' : ' · unrated'}` : '';
    if (this.multEl.textContent !== round) this.multEl.textContent = round;
  },
  caption(g) {
    const me = Multiplayer.me, mine = g.active === me;
    switch (g.stage) {
      case 'discard': return g.users[me] && g.users[me].discarded ? (this._waitCap ? 'Waiting for your opponent...' : '') : 'Replace cards from your hand';
      case 'pick': return mine ? 'It\'s your turn to play a card!' : 'Waiting for your opponent...';
      case 'picked': return !Multiplayer.localMap() ? 'Getting the beatmap…' : 'Waiting for your opponent to get the beatmap…';
      case 'ready': return g.countdown ? 'Get ready!' : !Multiplayer.localMap() ? 'Getting the beatmap…' : 'Waiting for your opponent…';
      case 'playing': return 'Gameplay is in progress...';
    }
    return '';
  },
  paintCorners(force = false) {
    const g = this.g;
    if (!g) return;
    const opp = this.oppId();
    const f = Multiplayer.fetch;
    const sig = JSON.stringify([g.users, opp, g.stage, (Multiplayer.room.players || []).map(p => [p.id, p.hasMap, p.away]), f && [f.progress, f.error], g.mult]);
    if (!force && sig === this._cornerKey) return;
    this._cornerKey = sig;
    this.corner(this.cornerMe, Multiplayer.me, RP_BLUE);
    this.corner(this.cornerOpp, opp, RP_RED);
  },
  corner(el, id, sc) {
    const g = this.g;
    const u = id && g.users[id];
    el.style.setProperty('--p', sc.primary); el.style.setProperty('--pd', sc.darker); el.style.setProperty('--pk', sc.darkest); el.style.setProperty('--sf', sc.surface); el.style.setProperty('--sb', sc.border);
    if (!u) { clearEl(el).append(h('div.rkm-av.empty', icon('user')), h('div.rkm-cinfo', h('div.rkm-name', id ? this.name(id) : 'Waiting for an opponent…'))); el._built = null; return; }
    if (el._built !== id) {
      el._built = id;
      el._life = null;
      el.hp = h('i.rkm-hpfill'); el.hpTxt = h('span.rkm-hptxt'); el.multTxt = h('span.rkm-mult'); el.stand = h('span.rkm-stand', 'Last Stand!');
      el.state = h('span.rkm-state'); el.won = h('span.rkm-won');
      el.av = h('div.rkm-av', this.avatar(id, 72));
      clearEl(el).append(el.av, h('div.rkm-cinfo',
        h('div.rkm-row', el.multTxt, el.stand),
        h('div.rkm-hp', h('div.rkm-hptrack', el.hp), h('span.rkm-heart', '♥'), el.hpTxt),
        h('div.rkm-row', h('span.rkm-name', this.name(id)), el.won, el.state)));
    }
    // the bar eases to the new life; the number follows it (a hit can also arrive mid-results, animated there)
    const life = u.life;
    if (el._life == null || (this.g.stage !== 'results' || !this._resultsHeld)) this.setLife(el, life, el._life != null && el._life !== life);
    el.multTxt.textContent = `${+(g.mult + u.mult).toFixed(1)}x damage`;
    el.won.textContent = u.won ? `${u.won} round${u.won === 1 ? '' : 's'} won` : '';
    el.classList.toggle('dead', life <= 0);
    el.classList.toggle('low', life > 0 && life < RP_LIFE * 0.3);
    el.classList.toggle('active', g.active === id && ['pick', 'picked'].includes(g.stage));
    // beatmap state while it's being fetched (as lazer's "Downloading… (45%)")
    const p = this.player(id);
    let st = '';
    if (p && p.away) st = 'Reconnecting…';
    else if (['picked', 'ready'].includes(g.stage) && p && !p.hasMap) {
      if (id === Multiplayer.me) { const f = Multiplayer.fetch; st = f && f.error ? 'Download failed' : f && f.progress != null ? `Downloading... (${Math.round(f.progress * 100)}%)` : Multiplayer.localMap() ? 'Importing...' : 'Missing Beatmap'; }
      else st = 'Downloading...';
    } else if (g.stage === 'ready' && g.users[id] && g.users[id].ready) st = 'Ready';
    el.state.textContent = st;
  },
  setLife(el, life, animate) {
    const prev = el._life;
    el._life = life;
    el.hp.style.transform = `scaleX(${clamp(life / RP_LIFE, 0, 1)})`;
    el.hp.classList.toggle('anim', !!animate);
    if (!animate) { el.hpTxt.textContent = fmtInt(life); }
    else countUp(el.hpTxt, prev ?? life, life, 900);
    if (life === 1 && prev !== 1) { el.stand.classList.remove('show'); void el.stand.offsetWidth; el.stand.classList.add('show'); }
    if (animate && prev != null && life < prev) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
  },
  buildChat() {
    this.chatList = h('div.rkm-chatlist');
    for (const m of Multiplayer.chat.slice(-30)) this.chatList.append(this.chatLine(m));
    const input = h('input.input', { placeholder: 'Chat with your opponent…', maxlength: 300, 'aria-label': 'Chat message' });
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && input.value.trim()) { Multiplayer.send({ t: 'chat', text: input.value }); input.value = ''; } if (e.key === 'Escape') input.blur(); });
    const box = h('div.rkm-chat', this.chatList, input);
    requestAnimationFrame(() => { this.chatList.scrollTop = this.chatList.scrollHeight; });
    return box;
  },
  chatLine(m) { return m.from ? h(`div.rkm-msg${m.from === Multiplayer.me ? '.me' : ''}`, h('b', m.name), h('span', m.text)) : h('div.rkm-msg.sys', m.text); },
  addChat(m) {
    if (!this.chatList) return;
    this.chatList.append(this.chatLine(m));
    while (this.chatList.childNodes.length > 60) this.chatList.firstChild.remove();
    this.chatList.scrollTop = this.chatList.scrollHeight;
  },

  // ── stage overlay (lazer's RankedPlayStageOverlay): the stage's name, big, for a moment
  stageOverlay(g, prev) {
    const show = (g.stage === 'discard') || (g.stage === 'pick' && prev !== 'pick');
    if (!show) return;
    const mine = g.active === Multiplayer.me, picking = g.stage === 'pick';
    const sc = picking && !mine ? RP_RED : RP_BLUE;
    const el = h('div.rkm-banner', { style: { '--p': sc.primary, '--sf': sc.surface } },
      h('div.rkm-banner-box', h('span', picking ? 'Pick Phase' : 'Discard Phase')),
      picking ? h('div.rkm-banner-who', h('span.rkm-banner-av', this.avatar(g.active, 32)), h('span', `${this.name(g.active)}'s pick`)) : null);
    this.ov.append(el);
    UISounds.play('rp-stage');
    AudioManager.duck(true); setTimeout(() => AudioManager.duck(false), 1500);
    setTimeout(() => el.classList.add('out'), 1500);
    setTimeout(() => el.remove(), 2100);
  },

  // ── the stages
  renderStage(g, prev) {
    this._intro = null; this.countEl = null; this._waitCap = false; this._resultsHeld = false;
    clearTimeout(this._capT);
    const st = g.stage;
    this.root.classList.toggle('no-corners', st === 'deal' || (st === 'warmup' && g.round === 1) || st === 'results' || st === 'waitjoin');
    const m = h(`div.rkm-stage.st-${st}`);
    clearEl(this.main).append(m);
    this.stageEl = m;
    if (st === 'waitjoin') this.renderWait(m, g);
    else if (st === 'deal' || st === 'warmup') this.renderIntro(m, g, prev);
    else if (st === 'discard' || st === 'discarded') this.renderDiscard(m, g);
    else if (st === 'pick' || st === 'picked') this.renderPick(m, g);
    else if (st === 'ready') this.renderWarmup(m, g);
    else if (st === 'playing') this.renderPlaying(m, g);
    else if (st === 'results') this.renderResults(m, g);
    else if (st === 'ended') this.renderEnded(m, g);
  },
  refreshStage(g) {
    const st = g.stage;
    if (st === 'discard' || st === 'discarded') this.refreshDiscard(g);
    else if (st === 'pick' || st === 'picked') this.refreshPick(g);
    else if (st === 'ready') this.refreshWarmup(g);
    else if (st === 'waitjoin') this.renderStage(g, st);
    else if (st === 'deal' || st === 'warmup') { if (this._intro) this._intro.stars = g.stars; }
    else if (st === 'playing') this.refreshPlaying(g);
  },

  /** Before the match: a duel waits for the friend (code and invite); a queue match for the other player to arrive. */
  renderWait(m, g) {
    const r = Multiplayer.room, opp = this.oppId();
    if (g.rated) { m.append(h('div.rkm-wait', h('span.spinner'), h('div', 'Waiting for your opponent to join…'))); return; }
    const pub = !(r.settings && r.settings.public === false);
    m.append(h('div.rkm-duel',
      h('div.rkm-duel-t', `${g.keys}K Ranked Play duel`), h('div.rkm-duel-s', 'Unrated · the cards are dealt around the lower of your two ratings'),
      h('div.rkm-duel-vs', h('div.rkm-duel-p', this.avatar(Multiplayer.me, 84), h('b', ProfileManager.profile.name), h('span', `Rating ${fmtInt(g.users[Multiplayer.me] ? g.users[Multiplayer.me].rating : RankedRating.rating(g.keys))}`)),
        h('div.rkm-duel-x', 'VS'),
        opp ? h('div.rkm-duel-p', this.avatar(opp, 84), h('b', this.name(opp))) : h('div.rkm-duel-p.searching', h('div.rkm-duel-ping', h('i'), h('i'), icon('user')), h('b', 'Waiting…'), h('span', 'for someone to join'))),
      h('div.rkm-duel-l', pub ? 'Listed under Open rooms — or share the code' : 'Private — share the code'),
      h('div.rkm-code', h('span', r.code),
        h('button.icon-btn', { title: 'Copy code', 'aria-label': 'Copy code', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(r.code); UISounds.click(); Toast.ok('Room code copied', r.code); } }, icon('copy')),
        h('button.btn.sm.primary.mp-invite', { onclick: () => { UISounds.click(); Presence.openInvite(); } }, icon('multi'), 'Invite'))));
  },

  /** Round 1's intro (lazer's IntroScreen): the two players face off (VsSequence), then the deck's star rating is
   *  "refined" and lands (StarRatingSequence). */
  renderIntro(m, g, prev) {
    if (prev === 'deal' && g.stage === 'warmup' && this._introEl) { m.replaceWith(this._introEl); this.stageEl = this._introEl; this._intro = this._introState; this._intro.stars = g.stars; return; }
    const me = Multiplayer.me, opp = this.oppId();
    const side = (id, cls, sc) => h(`div.rki-side.${cls}`, { style: { '--p': sc.primary, '--pd': sc.darker } },
      h('div.rki-av', this.avatar(id, 132)), h('div.rki-name', id ? this.name(id) : '…'),
      h('div.rki-rt', g.rated ? `Rating: ${fmtInt(id && g.users[id] ? g.users[id].rating : 0)}` : 'Unrated duel'));
    const star = h('div.rki-stars', '~0.00'), title = h('div.rki-st', 'Refining star difficulty range...'), sub = h('div.rki-sub', 'Difficulty range is calculated to suit the two players.');
    const after = h('div.rki-after', 'There\'s always a chance that you get maps outside this range');
    const rki = h('div.rki',
      h('div.rki-vs', side(me, 'l', RP_BLUE), h('div.rki-x', 'VS'), side(opp, 'r', RP_RED)),
      h('div.rki-sr', title, star, sub, after));
    m.append(rki);
    this._introEl = m;
    this._intro = this._introState = { t0: performance.now(), rki, star, title, after, sub, stars: g.stars, landed: false };
    UISounds.play('rp-vs');
  },
  tickIntro() {
    const it = this._intro, el = it && it.rki;
    if (!it || !el || !el.isConnected) return;
    const t = performance.now() - it.t0;
    el.classList.toggle('sr', t > 4200);
    if (t < 4200) return;
    if (!it.landed) {
      // the number flickers through candidates until the deck is in and it has had a couple of seconds
      if (it.stars > 0 && t > 6800) {
        it.landed = true;
        it.star.textContent = `~${it.stars.toFixed(2)}`;
        it.star.style.color = starColour(it.stars);
        it.title.textContent = 'Star rating has been decided!';
        el.classList.add('landed');
        UISounds.play('rp-impact');
      } else if (!(t - (it.last || 0) < 70)) {
        it.last = t;
        const v = 1 + Math.random() * 7;
        it.star.textContent = `~${v.toFixed(2)}`; it.star.style.color = starColour(v);
      }
    }
  },

  /** A card: the beatmap's cover, star rating and key count, title, artist, difficulty, length and mapper, framed in
   *  the star rating's colour (lazer's RankedPlayCard), with a back for cards you can't see. */
  card(m, i, { back = false } = {}) {
    const el = h(`div.rkc${back ? '.back' : ''}`, { dataset: { i: String(i) } });
    if (back || !m) { el.append(h('div.rkc-in', h('div.rkc-backside', h('div.rkc-logo', h('span', 'ashtonk!'), h('small', 'ranked play'))))); return el; }
    const sc = starColour(m.stars || 0), local = Multiplayer.localMap(m);
    el.style.setProperty('--sc', sc);
    const cover = h('div.rkc-cover');
    if (m.onlineSetId > 0) cover.style.backgroundImage = `url("${OnlineBeatmaps.coverURL(m.onlineSetId, 'card')}")`;
    else if (local) BeatmapManager.bgURL(local).then(u => u && (cover.style.backgroundImage = `url("${u}")`)).catch(() => {});
    const len = m.length > 0 ? fmtTime(m.length) : '';
    el.append(h('div.rkc-in',
      h('div.rkc-face',
        cover,
        h('div.rkc-top', starBadge(m.stars || 0), h('span.rkc-keys', `${m.keys}K`)),
        h('div.rkc-body',
          h('div.rkc-t', { title: m.title }, m.title), h('div.rkc-a', m.artist), h('div.rkc-v', m.version),
          h('div.rkc-meta', len ? h('span', icon('clock'), len) : null, m.creator ? h('span', icon('user'), m.creator) : null))),
      h('div.rkc-backside', h('div.rkc-logo', h('span', 'ashtonk!'), h('small', 'ranked play')))));
    return el;
  },
  /** A hand of cards fanned out on an arc (lazer's HandOfCards); `top` hands hang upside down from the top. */
  hand(ids, cards, { top = false, back = false, interactive = false, sel = -1, onPick = null, onHover = null, onPlay = null } = {}) {
    const wrap = h(`div.rkh${top ? '.top' : ''}${interactive ? '.live' : ''}`);
    const n = ids.length;
    ids.forEach((id, k) => {
      const off = k - (n - 1) / 2;
      const slot = h('div.rkh-slot', { dataset: { i: String(id) }, style: { '--x': off.toFixed(2), '--r': (off * 4).toFixed(2) + 'deg', '--y': (off * off * 6).toFixed(1) + 'px', '--d': (k * 50) + 'ms', zIndex: String(10 + k) } },
        this.card(cards[id], id, { back }));
      if (interactive) {
        slot.addEventListener('pointerenter', () => { slot.classList.add('hover'); onHover && onHover(id); UISounds.hover(); });
        slot.addEventListener('pointerleave', () => { slot.classList.remove('hover'); onHover && onHover(null); });
        slot.addEventListener('click', () => onPick && onPick(id));
        if (onPlay) slot.append(h('button.rkh-play', { onclick: e => { e.stopPropagation(); onPlay(id); } }, icon('play'), 'Play'));
      } else if (!back) {
        slot.addEventListener('pointerenter', () => slot.classList.add('hover'));
        slot.addEventListener('pointerleave', () => slot.classList.remove('hover'));
      }
      if (id === sel) slot.classList.add('sel');
      wrap.append(slot);
    });
    return wrap;
  },

  /** Discard phase (round 1): pick any cards to replace, once — "Keep cards" or "Replace N cards". */
  renderDiscard(m, g) {
    const me = g.users[Multiplayer.me];
    this._discardSel = new Set();
    this._handSig = null;
    m.append(
      this._oppTag = h('div.rkm-opptag'),
      h('div.rkd-explain', h('p', 'These are your cards for this match!'), h('p', 'When it’s your turn, you can play a card to go head-to-head against your opponent!')),
      this._discardRow = h('div.rkd-row'),
      this._discardBtn = h('button.rkd-btn', { onclick: () => this.submitDiscard() }));
    this.refreshDiscard(g);
    if (me && me.discarded) this._discardBtn.hidden = true;
  },
  refreshDiscard(g) {
    const me = g.users[Multiplayer.me], opp = this.oppId();
    if (!me || !this._discardRow) return;
    const sig = me.hand.join(',') + '|' + me.discarded + '|' + g.stage;
    if (sig !== this._handSig) {
      const prev = this._handIds || [];
      this._handSig = sig; this._handIds = [...me.hand];
      const done = me.discarded || g.stage === 'discarded';
      clearEl(this._discardRow).append(...me.hand.map((id, k) => {
        const c = this.card(g.cards[id], id);
        const slot = h('div.rkd-slot', { style: { '--d': (k * 60) + 'ms' } }, c);
        if (prev.length && !prev.includes(id)) { slot.classList.add('new'); UISounds.play('rp-card'); }
        if (!done) {
          slot.classList.add('live');
          slot.addEventListener('click', () => { const s = this._discardSel; s.has(id) ? s.delete(id) : s.add(id); slot.classList.toggle('marked', s.has(id)); UISounds.play(s.has(id) ? 'check-on' : 'check-off'); this.paintDiscardBtn(); });
          slot.addEventListener('pointerenter', () => this.previewCard(g.cards[id]));
          slot.addEventListener('pointerleave', () => this.stopPreview());
          slot.append(h('span.rkd-mark', icon('retry'), 'Replace'));
        }
        return slot;
      }));
      this.paintDiscardBtn();
      this._discardBtn.hidden = done;
    }
    // (lazer's discard screen is just your cards: your opponent is a line of status)
    const ou = opp && g.users[opp];
    if (this._oppTag) {
      const t = !ou || g.stage !== 'discard' ? '' : ou.discarded ? `${this.name(opp)} has chosen` : `${this.name(opp)} is choosing…`;
      if (this._oppTag.textContent !== t) this._oppTag.textContent = t;
      this._oppTag.hidden = !t;
    }
  },
  paintDiscardBtn() {
    const n = this._discardSel ? this._discardSel.size : 0;
    this._discardBtn.textContent = n ? `Replace ${n} card${n === 1 ? '' : 's'}` : 'Keep cards';
    this._discardBtn.classList.toggle('replace', n > 0);
  },
  submitDiscard() {
    const g = this.g;
    if (!g || g.stage !== 'discard') return;
    const cards = [...(this._discardSel || [])];
    UISounds.play(cards.length ? 'rp-discard' : 'click-short-confirm');
    Multiplayer.send({ t: 'discard', cards });
    this._discardBtn.hidden = true;
    $$('.rkd-slot', this._discardRow).forEach(s => { s.classList.remove('live'); if (s.classList.contains('marked')) s.classList.add('gone'); });
    this.stopPreview();
    // (as lazer: "waiting for your opponent" only once the swap's animation has had its moment)
    this._capT = setTimeout(() => { this._waitCap = true; const gg = this.g; if (gg) this.paintTop(gg); }, 3200);
  },

  /** Pick phase: on your turn, select a card from your hand and Play it; on theirs, watch their hand as they handle it. */
  renderPick(m, g) {
    const mine = g.active === Multiplayer.me;
    this._sel = -1; this._hover = null; this._pickSig = null; this._oppSig = null;
    this.center = h('div.rkp-center');
    this.oppHandEl = h('div.rkm-opphand');
    this.myHandEl = h('div.rkm-myhand');
    m.append(this.oppHandEl, this.center, this.myHandEl);
    m.classList.toggle('mine', mine);
    this.refreshPick(g);
  },
  refreshPick(g) {
    const me = g.users[Multiplayer.me], opp = this.oppId(), ou = opp && g.users[opp];
    if (!me || !this.myHandEl) return;
    const mine = g.active === Multiplayer.me, played = g.played;
    const myIds = me.hand.filter(id => !(mine && id === played && g.stage === 'picked'));
    const sig = myIds.join(',') + '|' + g.stage + '|' + mine;
    if (sig !== this._pickSig) {
      this._pickSig = sig;
      const live = mine && g.stage === 'pick';
      clearEl(this.myHandEl).append(this.hand(myIds, g.cards, {
        interactive: live, sel: this._sel,
        onHover: id => { this._hover = id; this.sendHand(); if (id != null) this.previewCard(g.cards[id]); else this.stopPreview(); },
        onPick: id => { if (this._sel === id) { this.playCard(id); return; } this._sel = id; $$('.rkh-slot', this.myHandEl).forEach(s => s.classList.toggle('sel', +s.dataset.i === id)); UISounds.play('select-difficulty'); this.sendHand(true); },
        onPlay: id => this.playCard(id),
      }));
    }
    if (ou) {
      const oppIds = ou.hand.filter(id => !(!mine && id === played && g.stage === 'picked'));
      const osig = oppIds.join(',') + '|' + g.stage;
      if (osig !== this._oppSig) { this._oppSig = osig; clearEl(this.oppHandEl).append(this.hand(oppIds, {}, { top: true, back: true })); }
    }
    // the played card: centre stage, turned face up
    if (g.stage === 'picked' && played >= 0 && !this.center.firstChild) {
      const c = this.card(g.cards[played], played);
      c.classList.add('played', mine ? 'from-me' : 'from-opp');
      this.center.append(c, h('div.rkp-who', `${mine ? 'You' : this.name(g.active)} played`));
      UISounds.play('rp-play');
      this.stopPreview();
    }
  },
  /** lazer's hand replay: your hovered and selected card, sent as they change, so your opponent sees your hand move. */
  sendHand(now = false) {
    const g = this.g;
    if (!g || g.stage !== 'pick' || g.active !== Multiplayer.me) return;
    const send = () => { this._handT = 0; Multiplayer.send({ t: 'hand', hover: this._hover ?? -1, sel: this._sel }); };
    if (now) { clearTimeout(this._handT); send(); return; }
    if (!this._handT) this._handT = setTimeout(send, 90);
  },
  onHand(m) {
    if (!this.oppHandEl || m.id !== this.oppId()) return;
    $$('.rkh-slot', this.oppHandEl).forEach(s => { const i = +s.dataset.i; s.classList.toggle('hover', i === m.hover); s.classList.toggle('sel', i === m.sel); });
  },
  playCard(id) {
    const g = this.g;
    if (!g || g.stage !== 'pick' || g.active !== Multiplayer.me) return;
    Multiplayer.send({ t: 'play', card: id });
    $$('.rkh-slot', this.myHandEl).forEach(s => s.classList.add(+s.dataset.i === id ? 'playing' : 'dimmed'));
    this.stopPreview();
  },

  /** Gameplay warmup (lazer's GameplayWarmupScreen): the card beside the beatmap's details, its song playing from the
   *  preview point; you're ready as soon as you have it, and once both are, a 10 second countdown starts the song. */
  renderWarmup(m, g) {
    const map = Multiplayer.room.map, card = map ? this.card(map, g.played) : null;
    const local = Multiplayer.localMap();
    const mine = g.active === Multiplayer.me;
    this.countEl = h('div.rkw-count');
    const stat = (ic, v, t) => v ? h('span.rkw-stat', { title: t }, icon(ic), v) : null;
    m.append(h('div.rkw',
      h('div.rkw-card', card),
      h('div.rkw-sep'),
      h('div.rkw-details',
        h('div.rkw-wedge.title', h('div.rkw-t', map ? map.title : ''), h('div.rkw-a', map ? map.artist : ''),
          h('div.rkw-stats', stat('clock', map && map.length > 0 ? fmtTime(map.length) : '', 'Length'), stat('target', local && local.bpm ? String(Math.round(local.bpm)) + ' BPM' : '', 'BPM'))),
        h('div.rkw-wedge.diff', { style: { '--sc': starColour(map ? map.stars : 0) } }, starBadge(map ? map.stars : 0), h('div.rkw-v', map ? map.version : ''), h('div.rkw-by', 'mapped by ', h('b', map ? map.creator : '')), h('span.keys-tag', `${map ? map.keys : g.keys}K`)),
        h('div.rkw-wedge.meta', h('div', h('span', 'Played by'), h('b', mine ? 'You' : this.name(g.active))), h('div', h('span', 'Round'), h('b', String(g.round))), h('div', h('span', 'Round damage'), h('b', `×${+g.mult.toFixed(1)}`))))),
      this.countEl);
    this._warmReady = false;
    this.refreshWarmup(g);
    // the background shows the beatmap, and its song plays from the preview point
    const bgUrl = local ? BeatmapManager.bgURL(local) : Promise.resolve(map && map.onlineSetId > 0 ? OnlineBeatmaps.coverURL(map.onlineSetId, 'cover') : null);
    this.bgMap.classList.remove('on');
    bgUrl.then(u => { if (u && this.bgMap) { this.bgMap.style.backgroundImage = `url("${u}")`; this.bgMap.classList.add('on'); } }).catch(() => {});
    if (local && Settings.get('audio.previewAudio')) this.playMapPreview(local);
  },
  refreshWarmup(g) {
    const me = g.users[Multiplayer.me];
    // ready as soon as the beatmap is here (lazer readies you when the screen has loaded it)
    if (me && !me.ready && !this._warmReady && Multiplayer.localMap() && (Multiplayer.self() || {}).hasMap) { this._warmReady = true; Multiplayer.send({ t: 'rpready', ready: true }); }
    if (this.countEl) this.countEl.classList.toggle('on', !!g.countdown);
  },
  async playMapPreview(local) {
    try {
      const blob = await BeatmapManager.getFile(local.setId, local.audioFile);
      if (!blob || !this.g || this.g.stage !== 'ready') return;
      Music.stream(blob, `${local.setId}/${local.audioFile}`, { setId: local.setId, mapId: local.id, timing: null });
      Music.play(previewStart(local), { fadeIn: 600 });
    } catch (e) { /* no preview: the warmup goes on in silence */ }
  },

  /** Your song is done (or you left it) and your opponent is still playing: their live score as it comes in. */
  renderPlaying(m, g) {
    this._liveEl = h('div.rkm-live');
    m.append(h('div.rkm-wait', h('span.spinner'), h('div', 'Gameplay is in progress...')), this._liveEl);
    this.refreshPlaying(g);
  },
  refreshPlaying() {
    if (!this._liveEl) return;
    const opp = this.oppId(), o = opp && Multiplayer.opps.get(opp);
    clearEl(this._liveEl).append(o ? h('div', h('span', this.name(opp)), h('b', fmtScore(o.score || 0)), h('small', `${fmtAcc(o.acc ?? 1)} · ${fmtInt(o.combo || 0)}x`)) : null);
  },

  /** The round's results (lazer's ResultsScreen): both scores count up side by side, then the loser takes the damage —
   *  the score difference, then the multiplier and the bonus added on, the life bar draining with a shake. */
  renderResults(m, g) {
    const res = g.results;
    if (!res) { m.append(h('div.rkm-wait', h('span.spinner'), h('div', 'Working out the round…'))); return; }
    const me = Multiplayer.me, opp = this.oppId(), ids = [me, opp].filter(Boolean);
    const max = Math.max(1, ...ids.map(id => res.scores[id] || 0));
    const loser = res.winner ? ids.find(id => id !== res.winner) : null;
    const col = (id, sc) => {
      const u = g.users[id], score = res.scores[id] || 0, d = res.dmg && res.dmg[id];
      const scoreEl = h('div.rkr-score', '0'), hp = h('i.rkr-hpfill'), hpTxt = h('span.rkr-hptxt'), dmgEl = h('div.rkr-dmg');
      const oldLife = d ? d.oldLife : u.life;
      hp.style.transform = `scaleX(${clamp(oldLife / RP_LIFE, 0, 1)})`; hpTxt.textContent = fmtInt(oldLife);
      const el = h(`div.rkr-col${id === res.winner ? '.win' : ''}`, { style: { '--p': sc.primary, '--pd': sc.darker, '--sf': sc.surface } },
        h('div.rkr-who', this.avatar(id, 56), h('div', h('b', this.name(id)), h('span', res.quit && res.quit[id] ? 'left the song' : `${res.accuracy && res.accuracy[id] != null ? fmtAcc(res.accuracy[id]) : ''}${res.maxCombo && res.maxCombo[id] != null ? ` · ${fmtInt(res.maxCombo[id])}x` : ''}`)),
          res.grade && res.grade[id] && !(res.quit && res.quit[id]) ? rankPill(res.grade[id]) : null),
        scoreEl,
        h('div.rkr-bar', h('i', { style: { '--w': (score / max).toFixed(4) } })),
        h('div.rkr-hp', h('div.rkr-hptrack', hp), hpTxt),
        dmgEl);
      return { el, scoreEl, hp, hpTxt, dmgEl, score, d, id };
    };
    const cols = ids.map(id => col(id, id === me ? RP_BLUE : RP_RED));
    const card = res.card >= 0 && g.cards[res.card] ? this.card(g.cards[res.card], res.card) : null;
    const verdict = h('div.rkr-verdict', !res.winner ? 'Draw — no damage' : res.winner === me ? 'You win the round!' : `${this.name(res.winner)} wins the round`);
    const breakdown = h('div.rkr-break');
    m.append(h('div.rkr', h('div.rkr-round', `Round ${res.round}`), card ? h('div.rkr-card', card) : null, h('div.rkr-cols', ...cols.map(c => c.el)), verdict, breakdown));
    this._resultsHeld = true;
    // 1. the scores count up together
    for (const c of cols) countUp(c.scoreEl, 0, c.score, 2000, fmtScore);
    m.querySelectorAll('.rkr-bar i').forEach(b => requestAnimationFrame(() => b.classList.add('go')));
    UISounds.play('rp-score');
    const tok = this._resTok = {};
    const later = (ms, fn) => setTimeout(() => { if (this._resTok === tok && this.root) fn(); }, ms);
    later(2200, () => { verdict.classList.add('show'); UISounds.play(res.winner === me ? 'rp-win' : res.winner ? 'rp-lose' : 'click-short'); });
    // 2. the damage: the difference, then each extra (×multiplier, +bonus) landing on the number, then the life bar
    const L = loser && cols.find(c => c.id === loser);
    if (L && L.d && L.d.damage > 0) {
      const d = L.d, steps = [];
      if (Math.abs(d.multiplier - 1) > 1e-9) steps.push([Math.ceil(d.directDamage * d.multiplier) - d.directDamage, `×${+d.multiplier.toFixed(1)}`, 'multiplier']);
      if (d.bonusDamage) steps.push([d.bonusDamage, `+${fmtInt(d.bonusDamage)}`, 'bonus']);
      let shown = d.directDamage, t = 2900;
      later(t, () => { L.dmgEl.classList.add('show'); L.dmgEl.textContent = `−${fmtInt(shown)}`; breakdown.replaceChildren(h('span', 'Damage'), h('b', fmtInt(shown))); UISounds.play('rp-dmg'); });
      steps.forEach(([add, label, src], k) => {
        t += 1100;
        later(t, () => {
          const from = shown; shown += add;
          breakdown.replaceChildren(h('span', 'Damage'), h('b.pop', fmtInt(shown)), h('em', h('i', label), ` ${src}`));
          countUp(L.dmgEl, from, shown, 350, v => `−${fmtInt(v)}`);
          UISounds.play('rp-mult');
        });
      });
      t += 1100;
      later(t, () => {
        L.hp.classList.add('anim'); L.hp.style.transform = `scaleX(${clamp(d.newLife / RP_LIFE, 0, 1)})`;
        countUp(L.hpTxt, d.oldLife, d.newLife, 900);
        L.el.classList.add('hit');
        UISounds.play('rp-hit');
        if (d.newLife === 1) L.el.append(h('div.rkr-stand', 'Last Stand!'));
        if (d.newLife <= 0) L.el.append(h('div.rkr-ko', 'Defeated'));
        this._resultsHeld = false;
      });
    } else later(2600, () => { this._resultsHeld = false; });
  },

  /** The end of the match (lazer's EndedScreen): victory, defeat or a draw, and the ratings. */
  renderEnded(m, g) {
    const me = Multiplayer.me, opp = this.oppId(), u = g.users[me], o = opp && g.users[opp];
    const res = g.round === 0 ? 'none' : g.winner === me ? 'win' : g.winner ? 'loss' : 'draw';
    const title = { win: 'VICTORY', loss: 'DEFEAT', draw: 'DRAW', none: 'MATCH OVER' }[res];
    const delta = x => { const d = x.ratingAfter - x.rating; return h(`span.rke-d${d > 0 ? '.up' : d < 0 ? '.down' : ''}`, d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0'); };
    const rating = (label, x) => x ? h('div.rke-rating', h('span', label), h('b', fmtInt(x.ratingAfter)), g.rated ? delta(x) : null) : null;
    const lifeRow = (id, x) => x ? h('div.rke-row', this.avatar(id, 32), h('b', this.name(id)), h('span', `${fmtInt(x.life)} life`), h('span', `${x.won} round${x.won === 1 ? '' : 's'} won`)) : null;
    m.append(h(`div.rke.${res}`,
      h('div.rke-title', title),
      g.round === 0 ? h('div.rke-sub', 'The match ended before it began — nothing is counted.') : g.rated ? h('div.rke-ratings', rating('Your Rating: ', u), rating('Opponent Rating: ', o)) : h('div.rke-sub', 'Unrated duel'),
      g.round ? h('div.rke-rows', lifeRow(me, u), lifeRow(opp, o)) : null,
      h('div.rke-btns',
        h('button.rke-btn.quit', { onclick: () => { UISounds.back(); Multiplayer.leave(); } }, 'Quit'),
        h('button.rke-btn.again', { onclick: () => { UISounds.click(); const keys = g.keys, rated = g.rated; Multiplayer.leave(); if (rated) RankQueue.start(keys); else MultiplayerScreen.openCreate({ ranked: true, keys }); } }, g.rated ? 'Play Again' : 'New duel'))));
    if (res === 'win') UISounds.play('rp-victory'); else if (res === 'loss') UISounds.play('rp-defeat');
  },

  // ── song previews while handling cards (lazer plays the hovered card's song)
  previewCard(m) {
    clearTimeout(this._pvT);
    if (!m || !(m.onlineSetId > 0) || !Settings.get('audio.previewAudio')) return;
    if (this._pvId === m.onlineSetId && this._pv) return;
    this._pvT = setTimeout(() => {
      this.stopPreview(true);
      const a = new Audio(OnlineBeatmaps.previewURL(m.onlineSetId));
      a.volume = clamp(Settings.get('audio.master') * Settings.get('audio.music'), 0, 1) * 0.8;
      a.play().catch(() => {});
      this._pv = a; this._pvId = m.onlineSetId;
      if (Music.playing) { Music.setVolume(0.15, 300); this._pvDucked = true; }
    }, 350);
  },
  stopPreview(keepDuck = false) {
    clearTimeout(this._pvT);
    if (this._pv) { this._pv.pause(); this._pv.removeAttribute('src'); this._pv = null; this._pvId = null; }
    if (!keepDuck && this._pvDucked) { this._pvDucked = false; Music.setVolume(1, 400); }
  },
};

/** Count a number up (or down) in an element over `ms`, with lazer's ease-out. */
function countUp(el, from, to, ms, fmt = fmtInt) {
  const t0 = performance.now();
  const tok = el._countTok = {};
  const step = () => {
    if (el._countTok !== tok) return;
    const p = clamp((performance.now() - t0) / ms, 0, 1), e = 1 - Math.pow(1 - p, 4);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(step);
  };
  step();
}

/** The lobby's Ranked Play panel (lazer's queue screen): key count, your rating, Begin queueing / Stop queueing with
 *  the time searching and how many are queued, and your recent matches. */
function rankedQueuePanel() {
  const el = h('div.rq');
  const paint = () => {
    if (!el.isConnected && el._painted) { off(); off2(); clearInterval(t); return; }
    el._painted = true;
    const st = RankQueue.st, keys = st ? st.keys : (Settings.get('mp.qpKeys') === 7 ? 7 : 4), p = RankedRating.get(keys);
    const searching = st && ['joining', 'search'].includes(st.status), found = st && st.status === 'found';
    const hist = RankedRating.history().slice(0, 4);
    clearEl(el).append(
      h('div.rq-head', h('div.rq-ico', icon('trophy')), h('div', h('div.rq-t', 'Ranked Play'), h('div.rq-s', '1v1 · beatmap cards · 1,000,000 life · lazer\'s rules')),
        h('div.grow'),
        h('div.qp-keys', ...[4, 7].map(k => h(`button.qp-key${keys === k ? '.on' : ''}`, { disabled: !!st, onclick: () => { UISounds.click(); Settings.set('mp.qpKeys', k); paint(); } }, `${k}K`)))),
      h('div.rq-body',
        h('div.rq-rating', h('span', `Your ${keys}K rating`), h('b', fmtInt(Math.round(p.mu))), h('small', p.fresh ? 'from your pp — play a match to settle it' : `${p.played} match${p.played === 1 ? '' : 'es'} · ${p.won} won`)),
        h('div.grow'),
        searching ? h('div.rq-search', h('span.spinner'), h('div', h('b', 'Searching for a match...'), h('span', `${RankQueue.waited()}${st.queued ? ` · ${st.queued} queued` : ''}`)))
          : found ? h('div.rq-search', icon('check'), h('div', h('b', 'Match found!'), h('span', st.accepted ? 'Waiting for your opponent…' : 'Accept it to play'))) : null,
        st ? (found && !st.accepted ? h('button.rq-btn.go', { onclick: () => RankQueue.accept() }, 'Accept') : h('button.rq-btn.stop', { onclick: () => { UISounds.back(); RankQueue.stop(); } }, 'Stop queueing'))
          : h('button.rq-btn.go', { disabled: !Multiplayer.available(), onclick: () => { UISounds.click(); RankQueue.start(keys); } }, 'Begin queueing')),
      hist.length ? h('div.rq-hist', h('div.rq-hl', 'Recent matches'), ...hist.map(m => h(`div.rq-match.${m.result}`,
        h('span.rq-res', m.result === 'win' ? 'Won' : m.result === 'loss' ? 'Lost' : 'Draw'),
        h('span.rq-opp', 'vs ', h('b', m.opp ? m.opp.name : '—')),
        h('span.rq-life', `${fmtInt(m.me.life)} : ${fmtInt(m.opp ? m.opp.life : 0)}`),
        h('span.rq-won', `${m.me.won}–${m.opp ? m.opp.won : 0}`),
        h('span.rq-rd', m.rated ? (m.me.after - m.me.before >= 0 ? `+${m.me.after - m.me.before}` : `−${m.me.before - m.me.after}`) : 'duel'),
        h('span.rq-when', `${m.keys}K · ${fmtDateShort(m.at)}`)))) : null);
  };
  const off = Bus.on('rq:changed', paint), off2 = Bus.on('rp:rating', paint);
  const t = setInterval(() => { if (!el.isConnected) { off(); off2(); clearInterval(t); return; } if (RankQueue.st && RankQueue.st.status === 'search') paint(); }, 1000);
  paint();
  return el;
}
const fmtDateShort = t => { try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } };
