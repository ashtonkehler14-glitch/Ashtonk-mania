/* osu!lazer's daily challenge: one beatmap for everyone each day (UTC), with a leaderboard of each player's best score
 * on it, reached from the Play menu. The server keeps the day's beatmap and scores; the first player of the day to
 * open it picks the beatmap (a ranked 4K beatmap of 3.5–5.5 stars from the online listing, at random) for everyone. */

const Daily = {
  data: null,
  on(m) {
    // lazer's NewDailyChallengeNotification, once a day
    if (m.map) { let seen = null; try { seen = localStorage.getItem('am.dailySeen'); } catch {}
      if (seen !== m.day) { try { localStorage.setItem('am.dailySeen', m.day); } catch {}
        if (seen !== null || this.data) Toast.show('Today\'s daily challenge is now live!', 'Click here to play.', { timeout: 8000, onClick: () => Screens.go('daily') }); } }
    this.data = m;
    if (!m.map && !this._proposing) this.propose();
    Bus.emit('daily', m);
  },
  ask() { Presence.start(); Presence.send({ t: 'daily' }); },
  async propose() {
    this._proposing = true;
    try {
      const d = await OnlineBeatmaps.searchPages({ q: '', status: 'ranked', keys: [4], minStars: 3.5, maxStars: 5.5, nsfw: false }, 2, 9000);
      const cand = [];
      for (const set of d.sets || []) for (const x of set.diffs || []) {
        if (x.keys === 4 && x.id > 0 && x.stars >= 3.5 && x.stars <= 5.5) cand.push({ onlineSetId: set.id, onlineId: x.id, keys: 4, title: set.title, artist: set.artist, version: x.version, creator: set.creator, stars: x.stars, length: (x.length || 0) * 1000 });
      }
      if (cand.length) Presence.send({ t: 'dailyPropose', map: cand[Math.floor(Math.random() * cand.length)] });
    } catch (e) { console.warn('daily challenge: no beatmap to propose', e); }
    setTimeout(() => { this._proposing = false; }, 15000);
  },
  // (a passed play of the day's beatmap counts once the server has judged it — Verified, with `daily`)
};

const DailyScreen = {
  enter() {
    const { el, page } = pageShell('daily challenge', 'a new beatmap every day — set your best score on it', [], { icon: 'calendar', hue: 'plum', wide: true });
    this.page = page;
    this._unsub = [Bus.on('daily', () => this.render()), Bus.on('library:changed', () => this.render()), Bus.on('presence:changed', () => { if (!Daily.data) Daily.ask(); })];
    Daily.ask();
    this._tick = setInterval(() => this.tickTime(), 1000);
    this._poll = setInterval(() => Daily.ask(), 30000);
    this.render();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); clearInterval(this._tick); clearInterval(this._poll); },
  tickTime() {
    const d = Daily.data;
    if (!d || !this.timeEl) return;
    const left = Math.max(0, d.endsAt - Date.now());
    const s = Math.floor(left / 1000), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
    this.timeEl.textContent = `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    if (this.timeBar) this.timeBar.style.transform = `scaleX(${(left / 86400000).toFixed(4)})`;
    if (left <= 0 && !this._rolled) { this._rolled = true; setTimeout(() => { this._rolled = false; Daily.ask(); }, 1500); }
  },
  render() {
    if (!this.page) return;
    const d = Daily.data;
    if (!d || !d.map) {
      this.timeEl = null; this.cardEl = null;
      clearEl(this.page).append(h('div.rk-empty', Presence.ws ? h('span.spinner') : null, !Presence.ws ? 'The daily challenge needs the online server — trying to connect…' : d ? 'Picking today\'s beatmap…' : 'Loading the daily challenge…'));
      return;
    }
    const m = d.map, local = Multiplayer.localMap(m), f = this.fetch && this.fetch.id === m.onlineSetId ? this.fetch : null;
    const mods = (Settings.get('songselect.mods') || []).filter(x => x !== 'AT');
    // (the card is rebuilt only when it changes: a new score on the board leaves it, and its fade-in, alone)
    const key = JSON.stringify([m, !!local, f && [Math.round((f.progress || 0) * 100), f.error], mods]);
    if (key !== this._cardKey || !this.cardEl) { this._cardKey = key; this.cardEl = this.buildCard(m, local, f, mods); }
    const me = Presence.pid();
    const row = s => h(`div.rk-row.dc-row.click${s.pid === me ? '.me' : ''}`, { onclick: () => { UISounds.click(); UserPanels.profile({ pid: s.pid, name: s.name, avatar: s.avatar }); } },
      h('span.rk-rank', `#${s.rank}`),
      h('span.rk-user', Presence.avatarEl(s, 22), h('span.rk-name', s.name)),
      h('span.hl', fmtInt(s.score)), h('span', fmtAcc(s.acc)), h('span', `${fmtInt(s.combo)}x`),
      h('span', rankPill(s.grade)), h('span.dc-mods-col', (s.mods || []).join(' ') || '—'));
    const board = d.scores.length
      ? h('div.rk-table.dc-table', h('div.rk-row.rk-head.dc-row', h('span'), h('span'), h('span.hl', 'Score'), h('span', 'Accuracy'), h('span', 'Max Combo'), h('span', 'Rank'), h('span', 'Mods')),
        ...d.scores.map(row), ...(d.you && d.you.rank > 50 ? [h('div.rk-sep', '…'), row(d.you)] : []))
      : h('div.rk-empty', 'No scores yet today. Be the first!');
    const head = h('h3.dc-h', 'Leaderboard', h('span', ` ${fmtInt(d.total)} player${d.total === 1 ? '' : 's'}`));
    const cols = h('div.dc-cols', h('div.dc-main', head, board), this.side(d));
    if (this.cardEl.parentNode === this.page) { while (this.cardEl.nextSibling) this.cardEl.nextSibling.remove(); this.page.append(cols); }
    else clearEl(this.page).append(this.cardEl, cols);
    this.tickTime();
  },
  /** lazer's daily challenge side panels: total passes, the score breakdown (scores per 100,000, yours lit) and the
   *  event feed (the newest scores and where they placed). */
  side(d) {
    const bins = d.bins || [], max = Math.max(1, ...bins), mine = d.you ? Math.min(10, Math.floor(d.you.score / 100000)) : -1;
    const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`; };
    return h('div.dc-side',
      h('div.dc-panel', h('div.dc-ph', 'Total passes'), h('div.dc-big', fmtInt(d.total || 0))),
      bins.length ? h('div.dc-panel', h('div.dc-ph', 'Score breakdown'),
        h('div.dc-bins', ...bins.map((n, i) => h(`div.dc-bin${i === mine ? '.mine' : ''}`, { title: `${i === 10 ? '1,000,000' : `${fmtInt(i * 100000)}–${fmtInt(i * 100000 + 99999)}`}: ${fmtInt(n)}` },
          h('span.dc-bn', n ? fmtCompact(n) : ''), h('i', { style: { height: (n / max * 100).toFixed(1) + '%' } }), h('span.dc-bl', i === 10 ? '1M' : `${i * 100}k`))))) : null,
      d.recent && d.recent.length ? h('div.dc-panel', h('div.dc-ph', 'Event feed'),
        ...d.recent.map(r => h('div.dc-ev', Presence.avatarEl(r, 18), h('span', h('b', r.name), ' got ', h('b', `#${fmtInt(r.rank)}`), ` with ${fmtInt(r.score)}`), h('span.muted.dc-ago', ago(r.at))))) : null);
  },
  buildCard(m, local, f, mods) {
    const cover = h('div.dc-cover');
    OnlineBeatmaps.loadCover(cover, m.onlineSetId, ['cover@2x', 'cover', 'card@2x', 'card']);
    const play = h('button.dc-play', { disabled: !!(f && !f.error), onclick: () => this.play() },
      local ? 'Play' : f && !f.error ? `Downloading… ${Math.round((f.progress || 0) * 100)}%` : 'Download & play');
    this.timeEl = h('b'); this.timeBar = h('i');
    return h('div.dc-card', cover,
      h('div.dc-info',
        h('div.dc-kicker', 'Today\'s beatmap'),
        h('div.dc-title', m.title), h('div.dc-artist', m.artist),
        h('div.dc-meta', starBadge(m.stars || 0), h('span.dc-ver', m.version), h('span.dc-keys', `${m.keys}K`), m.length ? h('span', icon('clock'), fmtTime(m.length)) : null, m.creator ? h('span.dc-by', 'mapped by ', h('b', m.creator)) : null),
        h('div.dc-time', h('span', 'Time remaining'), this.timeEl, h('div.dc-tbar', this.timeBar)),
        h('div.dc-actions',
          h('button.btn.dc-mods', { onclick: () => { UISounds.click(); ModSelect.open({ disabled: ['AT', 'CN', 'WU', 'WD', 'AS'], onClose: () => this.render() }); } }, icon('mods'), mods.length ? mods.join(' ') : 'Mods'),
          play)));
  },
  async play() {
    const d = Daily.data, m = d && d.map;
    if (!m) return;
    UISounds.click();
    let local = Multiplayer.localMap(m);
    if (!local) {
      const f = this.fetch = { id: m.onlineSetId, progress: 0 };
      this.render();
      let last = 0;
      try {
        await OnlineBeatmaps.downloadAndImport({ id: m.onlineSetId, title: m.title, artist: m.artist }, p => { f.progress = p; if (performance.now() - last > 200) { last = performance.now(); this.render(); } }, { quiet: true });
      } catch (e) { f.error = e.message; Toast.err('Couldn\'t download the beatmap', friendlyError(e)); this.render(); return; }
      this.fetch = null;
      local = Multiplayer.localMap(m);
      this.render();
      if (!local) { Toast.err('Couldn\'t find the daily beatmap', 'It downloaded, but that difficulty isn\'t in the set.'); return; }
      if (Screens.currentName !== 'daily') return;
    }
    Game.launch({ mapId: local.id, mods: (Settings.get('songselect.mods') || []).filter(x => x !== 'AT'), daily: { day: d.day, onlineId: m.onlineId } });
  },
};
