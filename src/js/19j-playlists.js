/* osu!lazer's playlists: a player puts up a list of beatmaps for a while (an hour to two weeks); everyone can play
 * them as often as they like until it closes, each beatmap keeping everyone's best score, and the playlist an overall
 * board of their totals. Reached from Play on the main menu. The server keeps the playlists and the scores, which —
 * as everywhere — are the plays it judged itself (Verified, with `playlist`). */

const Playlists = {
  list: null, // the latest list (cards)
  cur: null,  // the playlist open on screen, in full
  _skew: 0,   // the server's clock minus ours
  on(m) {
    if (typeof m.now === 'number') this._skew = m.now - Date.now();
    if (m.t === 'plList') this.list = m.list || [];
    else if (m.t === 'pl') {
      if (m.gone) { if (this.cur && this.cur.id === m.id) { this.cur = null; Toast.show('That playlist is gone', 'It closed a while ago.'); } }
      else if (!this.cur || this.cur.id === m.id || m.made) this.cur = m;
      if (m.made) { PlaylistsScreen.openId = m.id; UISounds.play('check-on'); Toast.ok('Playlist created', 'It\'s listed for everyone now.'); }
    }
    Bus.emit('playlists', m);
  },
  ask(id) { Presence.start(); Presence.send(id ? { t: 'pl', id } : { t: 'plList' }); },
  /** ms until it closes (≤ 0: closed). */
  left(p) { return p.ends - (Date.now() + this._skew); },
  open(p) { return this.left(p) > 0; },
};

/** "2d 4h", "3h 12m", "12m 5s" */
function plDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), hh = Math.floor(s / 3600) % 24, mm = Math.floor(s / 60) % 60;
  return d ? `${d}d ${hh}h` : hh ? `${hh}h ${mm}m` : `${mm}m ${s % 60}s`;
}

const PlaylistsScreen = {
  tab: 'active', // lazer's RoomStatusFilter: open / ended / mine
  enter(params = {}) {
    if (params.id) { this.openId = params.id; Playlists.cur = null; } else if (!Playlists.cur) this.openId = null;
    this.tabsEl = h('div.dash-tabs');
    const create = h('button.btn.primary.pls-create', { onclick: () => this.create() }, icon('plus'), 'Create playlist');
    const { el, page } = pageShell('playlists', 'play beatmaps put up by other players — set your best on each before they close', [create], { icon: 'list', hue: 'green', tabs: this.tabsEl, wide: true });
    this.page = page;
    this._unsub = [Bus.on('playlists', () => this.render()), Bus.on('library:changed', () => this.render()),
      Bus.on('presence:changed', () => { if (!Playlists.list) Playlists.ask(); })];
    Playlists.ask(); if (this.openId) Playlists.ask(this.openId);
    this._tick = setInterval(() => this.tickTimes(), 1000);
    this._poll = setInterval(() => { Playlists.ask(); if (this.openId) Playlists.ask(this.openId); }, 20000);
    this.render();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); clearInterval(this._tick); clearInterval(this._poll); },
  onKey(e) {
    if (e.key === 'Escape' && this.openId) { UISounds.back(); this.openId = null; this.render(); return true; }
    return false;
  },
  tickTimes() {
    for (const el of this.page ? this.page.querySelectorAll('[data-ends]') : []) {
      const l = +el.dataset.ends - (Date.now() + Playlists._skew);
      const t = l > 0 ? `${el.dataset.pre || ''}${plDuration(l)}` : 'Ended';
      if (el.textContent !== t) el.textContent = t;
    }
  },
  render() {
    if (!this.page) return;
    clearEl(this.tabsEl).append(...[['active', 'open'], ['ended', 'ended'], ['mine', 'mine']].map(([k, l]) =>
      h(`button.ov-tab${this.tab === k && !this.openId ? '.on' : ''}`, { onclick: () => { UISounds.click(); this.tab = k; this.openId = null; this.render(); } }, l)));
    if (this.openId) return this.renderOne();
    const L = Playlists.list;
    if (!L) { clearEl(this.page).append(h('div.rk-empty', Presence.ws ? h('span.spinner') : null, Presence.ws ? 'Loading playlists…' : 'Playlists need the online server — trying to connect…')); return; }
    const me = Presence.pid();
    const shown = L.filter(p => this.tab === 'mine' ? p.host.pid === me : this.tab === 'ended' ? !Playlists.open(p) : Playlists.open(p));
    const card = p => {
      const bg = h('div.mp-rbg');
      if (p.cover > 0) bg.style.backgroundImage = `url("${OnlineBeatmaps.coverURL(p.cover, 'card')}")`;
      const open = Playlists.open(p);
      const row = h(`button.mp-room-row.pls-card${open ? '' : '.ended'}`, { onclick: () => { UISounds.click(); this.openId = p.id; Playlists.cur = null; Playlists.ask(p.id); this.render(); } },
        bg, h('div.mp-rshade'),
        h(`span.mp-rstate${open ? '.on' : ''}`, { dataset: open ? { ends: p.ends, pre: 'Ends in ' } : {} }, open ? `Ends in ${plDuration(Playlists.left(p))}` : 'Ended'),
        h('div.mp-rbody', h('div.mp-rname', p.name),
          h('div.mp-rmap', starBadge(p.minStars), p.maxStars > p.minStars ? [h('span', '–'), starBadge(p.maxStars)] : null,
            h('span', `${p.items} beatmap${p.items === 1 ? '' : 's'}`), ...p.keys.map(k => h('span.keys-tag', `${k}K`))),
          h('div.mp-rmeta', h('span', `hosted by ${p.host.name}`), h('span', `${fmtInt(p.players)} player${p.players === 1 ? '' : 's'}`))),
        h('div.mp-rplayers', Presence.avatarEl(p.host, 32)),
        h('span.mp-rjoin', 'View'));
      row.addEventListener('pointerenter', () => UISounds.hover());
      return row;
    };
    clearEl(this.page).append(shown.length ? h('div.mp-rooms.pls-list', ...shown.map(card))
      : h('div.rk-empty', this.tab === 'mine' ? 'You haven\'t made a playlist yet. Create one from the button up top.' : this.tab === 'ended' ? 'No playlists have ended lately.' : 'No playlists are open right now. Create one and everyone can play it!'));
  },
  /** One playlist: its beatmaps on the left (each with its best scores), everyone's totals on the right. */
  renderOne() {
    const p = Playlists.cur;
    if (!p || p.id !== this.openId) { clearEl(this.page).append(h('div.rk-empty', h('span.spinner'), 'Loading the playlist…')); return; }
    const open = Playlists.open(p), me = Presence.pid(), mods = (Settings.get('songselect.mods') || []).filter(x => x !== 'AT' && x !== 'CN');
    const back = h('button.btn.sm.pls-back', { onclick: () => { UISounds.back(); this.openId = null; this.render(); } }, icon('back'), 'All playlists');
    const head = h('div.pls-head',
      h('div.pls-head-l', h('div.pls-name', p.name),
        h('div.pls-by', Presence.avatarEl(p.host, 20), 'hosted by ', h('b', p.host.name), h('span.pls-dot', '·'), `${p.items.length} beatmap${p.items.length === 1 ? '' : 's'}`)),
      h('div.pls-head-r',
        h(`div.pls-time${open ? '' : '.ended'}`, h('span', open ? 'Closes in' : 'Closed'), h('b', open ? { dataset: { ends: p.ends } } : {}, open ? plDuration(Playlists.left(p)) : new Date(p.ends).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))),
        open && p.host.pid === me ? h('button.btn.sm.danger', { onclick: async () => { if (await Dialog.confirm('Close this playlist?', 'Nobody can set scores on it after that. The scores stay.', { ok: 'Close it', danger: true })) Presence.send({ t: 'plClose', id: p.id }); } }, 'Close') : null,
        open ? h('button.btn.dc-mods', { onclick: () => { UISounds.click(); ModSelect.open({ disabled: ['AT', 'CN', 'WU', 'WD', 'AS'], onClose: () => this.render() }); } }, icon('mods'), mods.length ? mods.join(' ') : 'Mods') : null));
    const items = p.items.map((it, i) => this.itemRow(p, it, i, open, mods));
    const row = s => h(`div.rk-row.pls-brow.click${s.pid === me ? '.me' : ''}`, { onclick: () => { UISounds.click(); UserPanels.profile({ pid: s.pid, name: s.name, avatar: s.avatar }); } },
      h('span.rk-rank', `#${s.rank}`), h('span.rk-user', Presence.avatarEl(s, 22), h('span.rk-name', s.name)),
      h('span.hl', fmtInt(s.score)), h('span', `${s.done}/${p.items.length}`));
    const board = h('div.pls-board', h('h3.dc-h', 'Overall', h('span', ` ${fmtInt(p.board.length)} player${p.board.length === 1 ? '' : 's'}`)),
      p.board.length ? h('div.rk-table', h('div.rk-row.rk-head.pls-brow', h('span'), h('span'), h('span.hl', 'Total score'), h('span', 'Played')), ...p.board.map(row),
        ...(p.you && p.you.rank > 50 ? [h('div.rk-sep', '…'), row(p.you)] : [])) : h('div.rk-empty', 'No scores yet. Be the first!'));
    clearEl(this.page).append(back, head, h('div.pls-cols', h('div.pls-items', ...items), board));
    this.tickTimes();
  },
  itemRow(p, it, i, open, mods) {
    const local = Multiplayer.localMap(it), f = this.fetch && this.fetch.hash === it.hash ? this.fetch : null;
    const cover = h('div.pls-cover');
    if (it.onlineSetId > 0) OnlineBeatmaps.loadCover(cover, it.onlineSetId, ['list@2x', 'list', 'card']);
    const exp = this.expanded === it.hash;
    const play = open ? h('button.btn.sm.primary.pls-play', { disabled: !!(f && !f.error) || (!local && !(it.onlineSetId > 0)), onclick: e => { e.stopPropagation(); this.play(p, it); } },
      local ? 'Play' : f && !f.error ? `${Math.round((f.progress || 0) * 100)}%` : it.onlineSetId > 0 ? 'Download' : 'Not online') : null;
    const top = exp ? h('div.pls-top', it.top.length ? it.top.map(s => h('div.pls-top-row', h('span.rk-rank', `#${s.rank}`), Presence.avatarEl(s, 18), h('span.rk-name', s.name),
      h('span.pls-top-sc', fmtInt(s.score)), h('span', fmtAcc(s.acc)), rankPill(s.grade), h('span.dc-mods-col', (s.mods || []).join(' ')))) : h('div.muted', 'No scores on this one yet.')) : null;
    return h(`div.pls-item${exp ? '.open' : ''}`, { onclick: () => { UISounds.click(); this.expanded = exp ? null : it.hash; this.render(); } },
      h('div.pls-item-main', h('span.pls-num', String(i + 1)), cover,
        h('div.pls-item-t', h('div.pls-item-title', it.title, h('span', ` ${it.artist}`)),
          h('div.pls-item-meta', starBadge(it.stars), h('span.keys-tag', `${it.keys}K`), h('span', it.version), it.creator ? h('span.muted', `mapped by ${it.creator}`) : null)),
        h('div.pls-item-you', it.you ? [h('b', fmtInt(it.you.score)), h('span', `#${it.you.rank} of ${it.plays}`)] : h('span.muted', it.plays ? `${it.plays} played` : 'unplayed')),
        play),
      top);
  },
  async play(p, it) {
    UISounds.click();
    let local = Multiplayer.localMap(it);
    if (!local) {
      const f = this.fetch = { hash: it.hash, progress: 0 };
      this.render();
      let last = 0;
      try {
        await OnlineBeatmaps.downloadAndImport({ id: it.onlineSetId, title: it.title, artist: it.artist }, x => { f.progress = x; if (performance.now() - last > 200) { last = performance.now(); this.render(); } }, { quiet: true });
      } catch (e) { f.error = e.message; Toast.err('Couldn\'t download the beatmap', friendlyError(e)); this.render(); return; }
      this.fetch = null;
      local = Multiplayer.localMap(it);
      this.render();
      if (!local) { Toast.err('Couldn\'t find that difficulty', 'The set downloaded, but this version of the difficulty isn\'t in it.'); return; }
      if (Screens.currentName !== 'playlists') return;
    }
    if (local.hash !== it.hash) Toast.show('A different version of this difficulty', 'Yours isn\'t the same file as the playlist\'s, so the score won\'t count. Re-download the set to update it.');
    Game.launch({ mapId: local.id, mods: (Settings.get('songselect.mods') || []).filter(x => x !== 'AT' && x !== 'CN'), playlist: { id: p.id } });
  },

  /** lazer's playlist creation: a name, how long it stays open, and the beatmaps (from your library — ones that are
   *  online, so everyone else can download them). */
  create() {
    if (!Presence.ws) { Toast.err('Not connected', 'Playlists need the online server.'); return; }
    UISounds.click();
    const st = { name: `${ProfileManager.profile.name}'s playlist`, hours: 24, picked: [], q: '' };
    const sel = BeatmapManager.maps.get(SongSelect.selectedId) || null;
    const all = [...BeatmapManager.maps.values()].filter(m => { const set = BeatmapManager.setById.get(m.setId); return set && set.onlineId > 0; })
      .sort((a, b) => a.title.localeCompare(b.title) || a.stars - b.stars);
    if (sel && all.includes(sel)) st.picked.push(sel);
    const name = h('input.input.pls-in', { value: st.name, maxlength: 60, oninput: e => { st.name = e.target.value; }, onkeydown: e => e.stopPropagation() });
    const durs = [[1, '1 hour'], [3, '3 hours'], [6, '6 hours'], [12, '12 hours'], [24, '1 day'], [72, '3 days'], [168, '1 week'], [336, '2 weeks']];
    const dur = h('select.input.pls-in', { onchange: e => { st.hours = +e.target.value; } }, ...durs.map(([v, l]) => h('option', { value: v, selected: v === st.hours }, l)));
    const search = h('input.input.pls-in', { type: 'search', placeholder: 'search your beatmaps', oninput: e => { st.q = e.target.value.toLowerCase(); paint(); }, onkeydown: e => e.stopPropagation() });
    const listEl = h('div.pls-pick'), count = h('div.pls-count');
    const paint = () => {
      const words = st.q.split(/\s+/).filter(Boolean);
      const shown = all.filter(m => { const t = `${m.artist} ${m.title} ${m.version} ${m.creator}`.toLowerCase(); return words.every(w => t.includes(w)); }).slice(0, 200);
      clearEl(listEl).append(...(shown.length ? shown.map(m => {
        const on = st.picked.includes(m);
        return h(`button.pls-pick-row${on ? '.on' : ''}`, { onclick: () => {
          UISounds.click();
          if (on) st.picked = st.picked.filter(x => x !== m);
          else if (st.picked.length < 20) st.picked.push(m); else Toast.show('That\'s 20', 'A playlist holds up to 20 beatmaps.');
          paint();
        } }, h('span.pls-check', on ? icon('check') : null), starBadge(m.stars), h('span.keys-tag', `${m.keys}K`), h('span.pls-pick-t', `${m.artist} - ${m.title} `, h('b', `[${m.version}]`)));
      }) : [h('div.muted.pls-none', all.length ? 'Nothing matches.' : 'Only beatmaps from osu! can go in a playlist (so everyone can download them) — get some from the beatmap listing first.')]));
      count.textContent = `${st.picked.length} of 20 picked`;
    };
    paint();
    const body = h('div.pls-form', h('label', 'Name'), name, h('label', 'Open for'), dur, h('label', 'Beatmaps'), search, listEl, count);
    Dialog.popup('Create a playlist', body, [
      { label: 'Create', colour: '#ff66aa', onClick: () => {
        if (!st.picked.length) { Toast.err('Pick at least one beatmap'); return; }
        Presence.send({ t: 'plCreate', name: st.name, hours: st.hours, items: st.picked.map(m => {
          const set = BeatmapManager.setById.get(m.setId);
          return { hash: m.hash, onlineId: m.onlineId, onlineSetId: set ? set.onlineId : 0, keys: m.keys, title: m.title, artist: m.artist, version: m.version, creator: m.creator, stars: m.stars, length: m.length };
        }) });
        this.tab = 'mine'; this.openId = null;
      } },
      { label: 'Cancel', colour: '#66ccff', cls: 'cancel', cancel: true },
    ], { icon: 'list' });
    setTimeout(() => name.focus(), 30);
  },
};
