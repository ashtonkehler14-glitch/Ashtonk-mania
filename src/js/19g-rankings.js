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
      stars: sc.stars, pp: sc.pp, mods: sc.mods || [], keys: sc.keys, rate: sc.rate || 1, unstableRate: sc.unstableRate || 0, failed: !sc.passed };
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
  async submit({ rec, score, mods, modConfig, seed, events, daily = null, background = false }) {
    if (!Multiplayer.available() || !Presence.pid()) return null; // (signed out: no scores go up)
    if (!background) this._lastOwn = Date.now(); // (a play just finished: the catch-up below waits its turn)
    const sent = Date.now(); // (which play an answer is for: the results screen only shows its own play's rank)
    const osu = await this.file(rec);
    if (!osu) return null;
    const body = JSON.stringify({ pid: Presence.pid(), key: Presence.key(), osu, ...this.what({ score, mods, modConfig, seed, events }), daily });
    // (a play that can't go out — the network dropped as the song ended — is tried again for two minutes, at once when
    // the network is back, instead of never reaching the leaderboards and rankings. The server keeps each player's best
    // and turns down a second score within seconds, so one that did arrive isn't counted twice)
    const until = Date.now() + 120000;
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
  /** Your best plays the server doesn't have — set offline, in multiplayer, or ones that didn't get through — go up
   *  again, a few seconds apart, in the background (never during a song), so the pp and best performance the rankings
   *  and other players see are the ones on your profile. Once a session, after coming online; a play already sent
   *  isn't sent again. */
  SENT_KEY: 'am.ppSent',
  async catchUp() {
    if (this._catching || !Multiplayer.available() || !Presence.pid() || !Presence.ws) return;
    this._catching = true;
    try {
      const server = await new Promise(res => { const off = Bus.on('myBests', m => { off(); clearTimeout(t); res(m); }), t = setTimeout(() => { off(); res(null); }, 15000); Presence.send({ t: 'myBests' }); });
      if (!server) return;
      const have = new Map(server.list || []), keep = server.keep || 200;
      const floor = have.size >= keep ? Math.min(...have.values()) : 0; // (the server keeps each player's best `keep`)
      let sent = {}; try { sent = JSON.parse(localStorage.getItem(this.SENT_KEY) || '{}') || {}; } catch { /* none */ }
      const todo = ScoreManager.bestPpPerMap().slice(0, 100).filter(({ score: s, pp }) => !s.synced && pp > floor
        && !((have.get(s.mapHash) || 0) >= pp - 0.5) && !(Math.abs((sent[s.mapHash] || -1) - pp) < 0.01));
      for (const { score: s, pp } of todo) {
        // (never during a song, nor right after one, whose own score goes up first)
        while (Screens.currentName === 'gameplay' || Date.now() - (this._lastOwn || 0) < 8000) await sleep(5000);
        if (!Presence.pid()) break;
        const rec = BeatmapManager.mapByHash(s.mapHash);
        if (!rec) continue;
        await this.submit({ rec, score: { ...s, pp }, background: true });
        sent[s.mapHash] = pp;
        try { localStorage.setItem(this.SENT_KEY, JSON.stringify(sent)); } catch { /* full */ }
        await sleep(4000); // (the server takes one score every few seconds from each player)
      }
      if (todo.length) { Presence.send({ t: 'rankings' }); Presence.send({ t: 'profile', pid: Presence.pid() }); } // (your place and profile, with them counted)
    } catch (e) { console.warn('catch-up', e); }
    finally { this._catching = false; }
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
        h('span.rk-user', Presence.avatarEl(r, 22), h('span.rk-name', r.name), r.online ? h('span.rk-on', { title: 'Online' }) : null),
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
