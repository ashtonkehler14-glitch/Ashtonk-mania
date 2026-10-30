/* osu!lazer's RankingsOverlay (Green colour scheme), performance rankings: everyone who has played, by their total pp.
 * lazer's PerformanceTable — 32px rows 3px apart on Background4 (Background3 under the pointer), the rank, the player,
 * then Play Count, Performance (the one picked out in white) and SS / S / A counts in Foreground1. Each
 * player's totals come from their own game (the same pp the profile shows), sent whenever they change. */

const Rankings = {
  /** Tell the server this player's totals (on connecting, and after every play). */
  // (only the profile: pp, rankings and leaderboards are the server's own, from plays it judged — Verified)
  // (everyone's profile is public: it goes up on connecting, and again after a play or a change to it)
  report() {
    if (!Presence.ws) return;
    Presence.send({ t: 'stats', profile: ProfileScreen.summary() });
  },
  reportSoon() { clearTimeout(this._rt); this._rt = setTimeout(() => this.report(), 2000); },
};
for (const ev of ['scores:changed', 'profile:changed', 'library:changed']) Bus.on(ev, () => Rankings.reportSoon()); // (library: ranked statuses arriving change what counts)

/** Online scores: a passed play goes to the game server as it finished — its score, accuracy, grade and pp, taken as
 *  they are (acceptPlay, src/js/09c-verify.js) — with the beatmap file, whose hash is the beatmap's id; that's what the
 *  rankings, the leaderboards and the daily challenge show. Signed with this player's secret key (Presence.key). */
const Verified = {
  /** What's sent of a play: its result (`score`) — or, without one, its key presses, for the server to judge. */
  what({ score, mods, modConfig, seed, events }) { return score ? { result: this.result(score) } : { play: { mods, modConfig, seed, events: [...(events || [])] } }; },
  /** A play's result, as the server takes it. */
  result(sc) {
    return { score: sc.scoreStd != null ? sc.scoreStd : sc.score, accuracy: sc.accuracy, maxCombo: sc.maxCombo, counts: sc.counts, grade: sc.grade,
      stars: sc.stars, pp: sc.pp, mods: sc.mods || [], ...(sc.modConfig ? { modConfig: sc.modConfig } : {}), keys: sc.keys, rate: sc.rate || 1, unstableRate: sc.unstableRate || 0, failed: !sc.passed, date: sc.date || 0 };
  },
  /** The beatmap file, base64, as the server hashes it. */
  async file(rec) {
    const blob = await BeatmapManager.getFile(rec.setId, rec.osuPath).catch(() => null);
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
  /** A multiplayer play, to the room to be judged — the match is decided by that, not by the result sent with 'finish'.
   *  The room waits 20 s for it, so a play that can't go out (the network dropped as the song ended) keeps trying
   *  until then — at once when the network is back — instead of giving up after a few seconds. */
  async room({ rec, score, mods, modConfig, seed, events }) {
    const code = Multiplayer.room && Multiplayer.room.code, token = Multiplayer.token;
    if (!code || !token) return;
    const osu = await this.file(rec);
    if (!osu) return;
    const body = JSON.stringify({ id: Multiplayer.me, token, osu, ...this.what({ score, mods, modConfig, seed, events }) }), until = Date.now() + 22000;
    for (let i = 0; Date.now() < until && Multiplayer.code === code; i++) {
      try {
        const r = await fetch(Host.api(`api/mp/room/${code}/verify`), { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: timeoutSignal(15000) });
        if (r.ok || r.status === 422 || r.status === 403) return;
      } catch { /* network: try again */ }
      await new Promise(res => { const t = setTimeout(done, Math.min(4000, 1000 * (i + 1))); function done() { clearTimeout(t); removeEventListener('online', done); res(); } addEventListener('online', done); });
    }
  },
  async submit({ rec, score, mods, modConfig, seed, events, daily = null, background = false, patience = 120000 }) {
    if (!Multiplayer.available() || !Presence.pid()) return null; // (signed out: no scores go up)
    if (!background) this._lastOwn = Date.now(); // (a play just finished: the catch-up below waits its turn)
    const sent = Date.now(); // (which play an answer is for: the results screen only shows its own play's rank)
    const osu = await this.file(rec);
    if (!osu) return null;
    const body = JSON.stringify({ pid: Presence.pid(), key: Presence.key(), osu, ...this.what({ score, mods, modConfig, seed, events }), daily });
    // (a play that can't go out — the network dropped as the song ended — is tried again for two minutes, at once when
    // the network is back, instead of never reaching the leaderboards and rankings. The server keeps each player's best
    // and turns down a second score within seconds, so one that did arrive isn't counted twice)
    const until = Date.now() + patience;
    let r = null;
    for (let i = 0; !r; i++) {
      // (429: another score of yours went up seconds ago — the server takes one every few seconds — so this one waits)
      try { r = await fetch(Host.api('api/mp/score'), { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: timeoutSignal(30000) }); if ((r.status >= 500 || r.status === 429) && Date.now() < until) r = null; } catch (e) { if (Date.now() >= until) { console.warn('score not sent', e); if (daily) Toast.err('Your daily challenge score wasn\'t sent', 'Check your connection.'); return null; } }
      if (!r) await new Promise(res => { const t = setTimeout(done, Math.min(15000, 1000 * 2 ** i)); function done() { clearTimeout(t); removeEventListener('online', done); res(); } addEventListener('online', done); });
    }
    try {
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || !d.ok) {
        console.warn('score not counted online:', d && d.error);
        if (background) return { ok: false, error: (d && d.error) || `The server answered ${r.status}.` }; // (the catch-up says why)
        if (daily) Toast.err('Your daily challenge score wasn\'t counted', (d && d.error) || 'The server couldn\'t check the play — try again.');
        return null;
      }
      if (daily && d.daily === 'day') Toast.err('Your daily challenge score wasn\'t counted', 'The daily challenge changed to a new day while you played.');
      else if (daily && d.daily === 'map') Toast.err('Your daily challenge score wasn\'t counted', 'That isn\'t today\'s daily challenge beatmap.');
      if (background) return d;
      this.last = { d, at: Date.now(), sent };
      Bus.emit('verified', d, sent);
      return d;
    } catch (e) { console.warn('score not counted online', e); return null; }
  },
  /** Your best plays the server doesn't have — set offline, in multiplayer, on your other device, or ones that didn't
   *  get through — go up together, straight away (never during a song), so the pp and best performance the rankings and
   *  other players see are the ones on your profile: on coming online, and when your profile shows some not counted
   *  yet. What the server has is the truth: a play it doesn't have at its pp goes up again (once a session) — a "sent"
   *  note kept here used to stop that, and plays an older server had taken at 0pp stayed "not counted" for good. What it
   *  said about one it didn't count is kept (`verdicts`), for the profile to say why. */
  VERDICT_KEY: 'am.ppVerdicts',
  // (plays, and beatmap file bytes, in one request: the server reads each one's file, and a big lot ran over the time it's
  // given — every try failed the same way, and the plays were never counted)
  BATCH: 8, BATCH_BYTES: 2e6,
  // (a lot tried again this long apart, more each time; one at a time, each given this long to get there)
  RETRY_MS: 3500, ONE_MS: 20000,
  /** The server's own list of your best plays, as it last said: Map(mapHash → pp) — or null before it's been asked. It's
   *  what "counted" means: the profile's "Not counted yet" goes by it, as the catch-up does (the best plays the server
   *  shows on your profile can leave some of them out — ones osu! wasn't asked about yet — and those used to sit there,
   *  "going up now", for good: the catch-up saw them on the server and sent nothing). */
  onServer: null,
  /** Below this the server doesn't keep a play (it keeps each player's best few hundred): not "not counted", just not
   *  among them. */
  floor: 0,
  /** What the server last said about plays it didn't count: { [mapHash]: { pp, got?, err?, at } }. */
  verdicts() { try { return JSON.parse(localStorage.getItem(this.VERDICT_KEY) || '{}') || {}; } catch { return {}; } },
  /** Whether the server has the best play on `mapHash` at `pp` (as it last said). */
  counted(mapHash, pp) { return !!this.onServer && (this.onServer.get(mapHash) || 0) >= pp - 0.5; },
  /** Why a best play (on `mapHash`, worth `pp` here) isn't on the server yet, in a few words — or null (on its way). */
  why(mapHash, pp) {
    if (this._sending && this._sending.has(mapHash)) return 'sending…';
    if (this._unsent && this._unsent.has(mapHash)) return 'couldn\'t reach the server — trying again in a minute';
    const v = this.verdicts()[mapHash];
    if (!v || Math.abs(v.pp - pp) > 0.01) return null;
    if (v.err) return `turned down: ${String(v.err).replace(/\.$/, '').toLowerCase()}`;
    if (v.got != null && v.got < pp - 0.5) return v.got > 0 ? `counted as ${fmtInt(v.got)}pp` : 'not ranked on osu!';
    return null;
  },
  /** Whether a catch-up is going on right now. */
  busy() { return !!this._catching; },
  async catchUp() {
    if (this._catching || !Multiplayer.available() || !Presence.pid() || !Presence.ws) return;
    this._catching = true;
    const tried = this._tried || (this._tried = new Set()); // (this session: not sent again and again)
    try { localStorage.removeItem('am.ppSent'); } catch { /* (the old "sent" notes: no longer trusted) */ }
    let changed = false;
    try {
      const server = await new Promise(res => { const off = Bus.on('myBests', m => { off(); clearTimeout(t); res(m); }), t = setTimeout(() => { off(); res(null); }, 15000); Presence.send({ t: 'myBests' }); });
      if (!server) { this.retry(); return; }
      const have = this.onServer, floor = this.floor;
      const verdicts = this.verdicts();
      const id = (s, pp) => `${s.mapHash}:${pp.toFixed(2)}`;
      // (one the server last counted lower — osu! doesn't list the beatmap as ranked — isn't sent again for a day)
      const lower = (s, pp) => { const v = verdicts[s.mapHash]; return v && !v.err && v.got != null && Math.abs(v.pp - pp) < 0.01 && Date.now() - v.at < 864e5; };
      // (one an admin took off: it stays off — never sent again; a better play since is another one)
      const removed = (s, pp) => { const v = verdicts[s.mapHash]; return v && v.removed && Math.abs(v.pp - pp) < 0.01; };
      const todo = ScoreManager.bestPpPerMap().slice(0, 100).filter(({ score: s, pp }) => pp > floor && !((have.get(s.mapHash) || 0) >= pp - 0.5)
        && !lower(s, pp) && !removed(s, pp) && !tried.has(id(s, pp)) && !(this._unsent && this._unsent.has(s.mapHash))); // (one that didn't get there: at the retry)
      this._sending = new Set(todo.map(x => x.score.mapHash));
      if (todo.length) Bus.emit('verified:verdicts');
      let any = false;
      for (let i = 0; i < todo.length;) {
        // (never during a song, nor right after one, whose own score goes up first)
        while (Screens.currentName === 'gameplay' || Date.now() - (this._lastOwn || 0) < 8000) await sleep(2000);
        if (!Presence.pid()) break;
        const batch = [];
        for (let bytes = 0; i < todo.length && batch.length < this.BATCH && bytes < this.BATCH_BYTES; i++) {
          const { score: s, pp } = todo[i], rec = BeatmapManager.mapByHash(s.mapHash), osu = rec ? await this.file(rec) : null;
          tried.add(id(s, pp));
          if (osu) batch.push({ s, pp, rec, osu });
          else { verdicts[s.mapHash] = { pp, err: 'The beatmap isn\'t in your library to send.', at: Date.now() }; this._sending.delete(s.mapHash); changed = true; }
        }
        if (!batch.length) continue;
        let got = await this.batch(batch);
        // (a server from before plays went up together — or a lot it couldn't take, every try: one at a time)
        if (got === null || !got.some(Boolean)) { got = []; for (const b of batch) { got.push(await this.submit({ rec: b.rec, score: { ...b.s, pp: b.pp }, background: true, patience: this.ONE_MS })); await sleep(3200); } }
        batch.forEach((b, k) => {
          const r = got[k], h = b.s.mapHash;
          this._sending.delete(h);
          changed = true;
          // (didn't get there: said so beside it, and tried again in a minute)
          if (!r) { tried.delete(id(b.s, b.pp)); (this._unsent ||= new Set()).add(h); return; }
          if (this._unsent) this._unsent.delete(h);
          if (r.ok) { any = true; this.onServer.set(h, Math.max(this.onServer.get(h) || 0, Number(r.pp) || 0)); if (Number(r.pp) >= b.pp - 0.5) delete verdicts[h]; else verdicts[h] = { pp: b.pp, got: Number(r.pp) || 0, at: Date.now() }; }
          else verdicts[h] = { pp: b.pp, err: r.error || 'The server couldn\'t take it.', removed: !!r.removed || undefined, at: Date.now() };
        });
        try { localStorage.setItem(this.VERDICT_KEY, JSON.stringify(verdicts)); } catch { /* full */ }
        if (i < todo.length) await sleep(3200); // (the server takes one lot every few seconds from each player)
      }
      if (any) { Presence.send({ t: 'rankings' }); Presence.send({ t: 'profile', pid: Presence.pid() }); Presence.send({ t: 'myBests' }); } // (your place, profile and best plays, with them counted)
    } catch (e) { console.warn('catch-up', e); }
    finally {
      this._catching = false;
      if (this._sending && this._sending.size) changed = true;
      this._sending = null;
      if (this._unsent && this._unsent.size) this.retry();
      if (changed) Bus.emit('verified:verdicts'); // (the profile says why the ones left weren't counted)
    }
  },
  /** The catch-up again in a minute (plays that didn't get there, or the server didn't answer) — not sooner, however
   *  often the profile asks, so a server that can't be reached isn't asked again and again. */
  retry() {
    if (this._retryT) return;
    this._retryT = setTimeout(() => { this._retryT = null; this._unsent = null; this.catchUp(); }, 60000);
  },
  /** Plays sent together ([{ s, pp, osu }]): the server's answer for each — { ok, pp } or { error }; none for one that
   *  didn't get there — or null from a server too old to take them together. */
  async batch(plays) {
    const body = JSON.stringify({ pid: Presence.pid(), key: Presence.key(), plays: plays.map(p => ({ osu: p.osu, result: this.result({ ...p.s, pp: p.pp }) })) });
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(Host.api('api/mp/scores'), { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: timeoutSignal(60000) });
        if (r.status === 404 || r.status === 405) return null;
        if (r.status !== 429 && r.status < 500) {
          const d = await r.json().catch(() => null);
          // (the whole lot turned down — not signed in as you, too big: each says so)
          return d && d.ok && Array.isArray(d.results) ? d.results : plays.map(() => ({ ok: false, error: (d && d.error) || `The server answered ${r.status}.` }));
        }
      } catch { /* the network: again in a moment */ }
      await sleep(this.RETRY_MS * (i + 1));
    }
    return [];
  },
};

const RankingsScreen = {
  data: null,
  enter() {
    Presence.start();
    this.mode = 'performance'; // (by total pp)
    const { el, page } = pageShell('rankings', 'find out who\'s the best right now', [], { icon: 'trophy', hue: 'green', wide: true });
    this.page = page;
    this._unsub = [Bus.on('rankings', d => { if ((d.mode || 'performance') !== this.mode) return; this.data = d; this.render(); }), Bus.on('presence:changed', () => { if (!this.data) { this.ask(); this.render(); } })];
    this.ask();
    this._tick = setInterval(() => this.ask(), 30000);
    this.render();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); clearInterval(this._tick); },
  ask() { Rankings.report(); Presence.send({ t: 'rankings', mode: this.mode || 'performance' }); },
  render() {
    if (!this.page) return;
    const d = this.data;
    if (!d) { clearEl(this.page).append(!Presence.ws ? offlineState('The rankings') : h('div.rk-empty', h('span.spinner'), 'Loading rankings…')); return; }
    if (!d.list.length) { clearEl(this.page).append(stateCard('trophy', 'Nobody is ranked yet', 'Pass a ranked beatmap to get on the board!', { cls: '.plain', neru: true })); return; }
    const me = Presence.pid();
    const head = h('div.rk-row.rk-head', h('span'), h('span'), h('span', 'Play Count'), h('span.hl', 'Performance'), h('span.g', 'SS'), h('span.g', 'S'), h('span.g', 'A'));
    const row = r => {
      const u = { pid: r.pid, name: r.name, avatar: r.avatar, online: !!r.online, id: r.online ? (Presence.players.find(p => p.pid === r.pid) || {}).id : null };
      const el = h(`div.rk-row${r.pid === me ? '.me' : ''}`,
        h('span.rk-rank', `#${fmtInt(r.rank)}`),
        h('span.rk-user', Presence.avatarEl(r, 22), fxName(h('span.rk-name', r.name), r.role), roleBadge(r.role), r.online ? h('span.rk-on', { title: 'Online' }) : null),
        h('span', fmtInt(r.plays)), h('span.hl', `${fmtInt(Math.round(r.pp))}pp`),
        h('span', fmtInt(r.ss || 0)), h('span', fmtInt(r.s || 0)), h('span', fmtInt(r.a || 0)));
      // (lazer: a player opens their profile; right-click for the rest)
      el.classList.add('click');
      el.onclick = () => { UISounds.click(); UserPanels.profile(u); };
      if (r.pid !== me) el.oncontextmenu = e => { e.preventDefault(); UserPanels.openMenu(u, e.clientX, e.clientY); };
      return el;
    };
    const mine = d.you && d.you.rank > 50 ? [h('div.rk-sep', '…'), row(d.you)] : [];
    clearEl(this.page).append(h('div.rk-table', head, ...d.list.map(row), ...mine),
      h('div.rk-foot', `${fmtInt(d.total)} ranked player${d.total === 1 ? '' : 's'}`));
    // (you're #1: Neru peeks up, sunglasses on — once a session)
    if (d.list[0] && d.list[0].pid === me && d.total > 1 && typeof NeruEggs !== 'undefined') NeruEggs.topOfTheBoard();
  },
};
// (the server's list of your best plays, whenever it says: what's counted — see Verified.onServer)
Bus.on('myBests', m => {
  const have = new Map(Array.isArray(m && m.list) ? m.list : []), keep = (m && m.keep) || 200;
  Verified.onServer = have; Verified.floor = have.size >= keep ? Math.min(...have.values()) : 0;
  Bus.emit('verified:verdicts');
});
