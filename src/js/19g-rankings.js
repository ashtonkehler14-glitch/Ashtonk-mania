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

/** Online scores: a passed play goes to the game server as the beatmap file and the key presses — never as a score.
 *  The server checks the file against the beatmap's id, plays the key presses through the game's own judging
 *  (src/js/09c-verify.js) and works out the score, accuracy, grade and pp itself; that's what the rankings, the
 *  leaderboards and the daily challenge show. Signed with this player's secret key (Presence.key). */
const Verified = {
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
  async room({ rec, mods, modConfig, seed, events }) {
    const code = Multiplayer.room && Multiplayer.room.code, token = Multiplayer.token;
    if (!code || !token) return;
    const osu = await this.file(rec);
    if (!osu) return;
    const body = JSON.stringify({ id: Multiplayer.me, token, osu, play: { mods, modConfig, seed, events: [...events] } }), until = Date.now() + 22000;
    for (let i = 0; Date.now() < until && Multiplayer.code === code; i++) {
      try {
        const r = await fetch(`api/mp/room/${code}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        if (r.ok || r.status === 422 || r.status === 403) return;
      } catch { /* network: try again */ }
      await new Promise(res => { const t = setTimeout(done, Math.min(4000, 1000 * (i + 1))); function done() { clearTimeout(t); removeEventListener('online', done); res(); } addEventListener('online', done); });
    }
  },
  async submit({ rec, mods, modConfig, seed, events, daily = null }) {
    if (!Multiplayer.available()) return null;
    const osu = await this.file(rec);
    if (!osu) return null;
    const body = JSON.stringify({ pid: Presence.pid(), key: Presence.key(), osu, play: { mods, modConfig, seed, events: [...events] }, daily });
    // (a play that can't go out — the network dropped as the song ended — is tried again for two minutes, at once when
    // the network is back, instead of never reaching the leaderboards and rankings. The server keeps each player's best
    // and turns down a second score within seconds, so one that did arrive isn't counted twice)
    const until = Date.now() + 120000;
    let r = null;
    for (let i = 0; !r; i++) {
      try { r = await fetch('api/mp/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body }); if (r.status >= 500 && Date.now() < until) r = null; } catch (e) { if (Date.now() >= until) { console.warn('score not sent', e); if (daily) Toast.err('Your daily challenge score wasn\'t sent', 'Check your connection.'); return null; } }
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
      this.last = { d, at: Date.now() };
      Bus.emit('verified', d);
      return d;
    } catch (e) { console.warn('score not counted online', e); return null; }
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
    if (!d.list.length) { clearEl(this.page).append(h('div.rk-empty', 'Nobody is ranked yet. Pass a beatmap to get on the board!')); return; }
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
  },
};
