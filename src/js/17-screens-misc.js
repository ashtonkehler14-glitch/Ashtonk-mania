/* Beatmaps library, Collections, Profile (with statistics), Replays and Skins screens. */

/** A page laid out like an osu!lazer overlay (OverlayHeader): a title band in the overlay's Dark5 with its icon and
 *  lowercase title, the actions on the right, optional tabs on Dark4 underneath, then the body in Background5.
 *  `hue` picks the overlay colour scheme (lazer: Blue 200, Pink 333, Plum 320, Orange 45, Aquamarine 160, …). */
const OVERLAY_HUES = { red: 0, orange: 45, lime: 90, green: 125, aquamarine: 160, blue: 200, purple: 255, plum: 320, pink: 333 };
function overlayHeader(title, { icon: ic = 'star', sub = null, actions = [], tabs = null } = {}) {
  return h('div.ov-head',
    h('div.ov-titlebar', h('div.ov-inner',
      h('span.ov-icon', icon(ic)), h('h1', title), sub ? h('span.ov-sub', sub) : null, h('div.grow'), ...actions)),
    tabs ? h('div.ov-tabs', h('div.ov-inner', tabs)) : null);
}
function pageShell(title, sub, actions = [], { icon: ic = 'star', hue = 'purple', tabs = null, wide = false } = {}) {
  const body = h('div.screen-body');
  const page = h('div.page');
  body.append(overlayHeader(title, { icon: ic, sub, actions, tabs }), h('div.ov-content', page));
  const el = h(`div.ov${wide ? '.ov-wide' : ''}`, { style: { '--o-h': OVERLAY_HUES[hue] ?? hue } }, body, h('div.page-back', backButton(() => Screens.back())));
  return { el, page };
}

async function importViaPicker(accept, directory = false) {
  const files = await pickFiles({ accept, multiple: true, directory });
  if (files.length) await App.importFiles(files);
}

// ─────────────────────────────── Beatmaps ───────────────────────────────
const BeatmapsScreen = {
  q: '',
  enter() {
    const { el, page } = pageShell('Beatmap library', null, [
      h('button.btn', { onclick: () => importViaPicker('', true) }, icon('folder'), 'Import folder'),
      h('button.btn.primary', { onclick: () => importViaPicker('.osz,.osu,.osk,.osr,.amr,.json,.mp3,.ogg,.wav,.jpg,.jpeg,.png') }, icon('upload'), 'Import files'),
    ], { icon: 'music', hue: 'blue' });
    this.page = page;
    this.summary = h('div.lib-summary');
    const search = h('input.input', { placeholder: 'Filter library…', value: this.q, style: { flex: '1', maxWidth: '420px' } });
    search.addEventListener('input', () => { this.q = search.value.toLowerCase(); this.renderList(); });
    search.addEventListener('keydown', e => e.stopPropagation());
    this.list = h('div.list');
    this.report = h('div');
    page.append(this.report, h('div.row', { style: { margin: '0 0 12px' } }, search, h('span.grow'), this.summary), this.list);
    this._unsub = [Bus.on('library:changed', () => this.refresh()), Bus.on('import:report', () => this.renderReport())];
    this.refresh();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); },
  async refresh() { this.renderSummary(); this.renderList(); this.renderReport(); },
  async renderSummary() {
    const maps = [...BeatmapManager.maps.values()];
    const broken = maps.filter(m => m.problems.length).length;
    const est = await DB.estimate();
    clearEl(this.summary).append(`${plural(BeatmapManager.sets.length, 'set')} · ${plural(maps.length, 'difficulty', 'difficulties')}${broken ? ` · ${broken} unplayable` : ''}${est ? ` · ${fmtBytes(est.usage || 0)} used` : ''}`);
  },
  renderReport() {
    clearEl(this.report);
    const r = App.lastReport;
    if (!r) return;
    const lines = [...r.errors.map(e => '✖ ' + e), ...r.warnings.map(w => '⚠ ' + w)];
    if (!lines.length) return;
    this.report.append(h('div.panel', { style: { padding: '14px 16px', marginBottom: '14px', borderColor: 'rgba(255,74,92,.35)' } },
      h('div.row', h('b', 'Last import: problems found'), h('span.grow'), h('button.btn.sm.ghost', { onclick: () => { App.lastReport = null; this.renderReport(); } }, 'Dismiss')),
      h('div.muted', { style: { fontSize: '.84rem', whiteSpace: 'pre-line', marginTop: '6px', maxHeight: '160px', overflow: 'auto' } }, lines.join('\n'))));
  },
  renderList() {
    clearEl(this.list);
    const sets = BeatmapManager.sets.filter(s => !this.q || `${s.artist} ${s.title} ${s.creator} ${s.tags}`.toLowerCase().includes(this.q))
      .sort((a, b) => b.added - a.added);
    if (!sets.length) {
      this.list.append(h('div.empty', h('div.big', BeatmapManager.sets.length ? 'No matches' : 'No beatmaps yet'),
        'Drop .osz archives or beatmap folders anywhere on the window.'));
      return;
    }
    for (const set of sets.slice(0, 400)) {
      const thumb = h('div.mini-thumb', { style: { width: '84px', height: '52px' } });
      BeatmapManager.thumbURL(set).then(u => u && (thumb.style.backgroundImage = `url("${u}")`));
      const broken = set.maps.filter(m => m.problems.length);
      const details = h('div', { hidden: true, style: { width: '100%', paddingTop: '8px' } },
        h('table.table', h('tr', h('th', 'Difficulty'), h('th', 'Keys'), h('th', 'Stars'), h('th', 'Notes / LNs'), h('th', 'Length'), h('th', 'Status')),
          ...set.maps.map(m => h('tr', h('td', m.version), h('td', m.keys + 'K'), h('td', m.stars.toFixed(2)), h('td', `${m.noteCount} / ${m.lnCount}`), h('td', fmtTime(m.length)),
            h('td', m.problems.length ? h('span', { style: { color: '#ffb3bb' } }, m.problems.join('; ')) : m.warnings.length ? h('span.muted', m.warnings.join('; ')) : h('span', { style: { color: 'var(--good)' } }, 'OK'))))),
        h('div.muted', { style: { fontSize: '.78rem', marginTop: '6px' } }, `Files stored: ${Object.keys(set.fileIndex).length}${set.storyboard ? ' · storyboard' : ''}${set.video ? ' · video skipped' : ''} · source: ${set.sourceName || '—'}`));
      const row = h('div.list-row', { style: { flexWrap: 'wrap' } },
        thumb,
        h('div.main', h('div.t', `${set.artist} — ${set.title}`), h('div.s', `mapped by ${set.creator} · ${plural(set.maps.length, 'difficulty', 'difficulties')} · ${[...new Set(set.maps.map(m => m.keys))].sort((a, b) => a - b).map(k => k + 'K').join(', ')} · added ${fmtDate(set.added)}`)),
        broken.length ? h('span.tag.warn', { title: broken.map(m => `[${m.version}] ${m.problems.join('; ')}`).join('\n') }, `${broken.length} unplayable`) : null,
        Favorites.has(set.id) ? h('span.gold', icon('heart', 'fill')) : null,
        h('button.btn.sm', { onclick: () => Screens.go('songselect', { mapId: (set.maps.find(m => !m.problems.length) || set.maps[0]).id }) }, icon('play'), 'Open'),
        h('button.icon-btn', { title: 'Details', onclick: () => { details.hidden = !details.hidden; } }, icon('info')),
        h('button.icon-btn', { title: 'Export .osz', onclick: () => BeatmapManager.exportOsz(set.id) }, icon('download')),
        h('button.icon-btn', { title: 'Delete', onclick: () => SongSelect.deleteSet(set) }, icon('trash')),
        details);
      this.list.append(row);
    }
  },
};

// ─────────────────────────────── Collections ───────────────────────────────
const CollectionsScreen = {
  sel: null,
  enter() {
    const { el, page } = pageShell('Collections', null, [
      h('button.btn.primary', { onclick: async () => { const n = await Dialog.prompt('New collection', '', { ok: 'Create', placeholder: 'e.g. LN practice' }); if (n) { const c = await Collections.create(n); this.sel = c.id; this.render(); } } }, icon('plus'), 'New collection')], { icon: 'folder', hue: 'aquamarine' });
    this.side = h('div.side-list'); this.main = h('div');
    page.append(h('div.split', this.side, this.main));
    this._unsub = [Bus.on('collections:changed', () => this.render()), Bus.on('library:changed', () => this.render())];
    this.render();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); },
  render() {
    if (!this.sel || !Collections.get(this.sel)) this.sel = Collections.list[0]?.id || null;
    clearEl(this.side);
    for (const c of Collections.list) {
      this.side.append(h(`button.side-item${c.id === this.sel ? '.active' : ''}`, { onclick: () => { this.sel = c.id; UISounds.click(); this.render(); } },
        icon('folder'), c.name, h('span.cnt', String(c.hashes.length))));
    }
    const favCount = BeatmapManager.sets.filter(s => Favorites.has(s.id)).length;
    if (favCount) this.side.append(h('div.muted', { style: { fontSize: '.8rem', padding: '10px 4px' } }, `♥ ${favCount} favourite set${favCount === 1 ? '' : 's'} — filter them in song select.`));
    clearEl(this.main);
    const c = Collections.get(this.sel);
    if (!c) { this.main.append(h('div.empty', h('div.big', 'No collections'), 'Create one to start organizing.')); return; }
    this.main.append(h('div.row', { style: { marginBottom: '14px' } }, h('h2', { style: { margin: 0, fontWeight: 900 } }, c.name), h('span.grow'),
      h('button.btn', { disabled: !c.hashes.length, onclick: () => { Settings.set('songselect.collection', c.id); Screens.go('songselect'); } }, icon('play'), 'Play from collection'),
      h('button.btn.ghost', { onclick: async () => { const n = await Dialog.prompt('Rename collection', c.name); if (n) Collections.rename(c.id, n); } }, icon('edit'), 'Rename'),
      h('button.btn.danger', { title: 'Delete collection', 'aria-label': 'Delete collection', onclick: async () => { if (await Dialog.confirm('Delete collection?', `"${c.name}" will be deleted. Beatmaps are not affected.`, { ok: 'Delete', danger: true })) Collections.remove(c.id); } }, icon('trash'))));
    const list = h('div.list');
    if (!c.hashes.length) list.append(h('div.empty', h('div.big', 'Empty collection'), 'In song select, use the folder button or F3 → "Manage collections" to add difficulties.'));
    for (const hash of c.hashes) {
      const m = BeatmapManager.mapByHash(hash);
      const best = ScoreManager.best(hash);
      // the set's picture (like the Beatmaps page) instead of an empty slot where a grade goes; your grade by the title
      const thumb = h('div.mini-thumb', { style: { width: '68px', height: '42px' } });
      if (m) BeatmapManager.thumbURL(BeatmapManager.setById.get(m.setId)).then(u => u && (thumb.style.backgroundImage = `url("${u}")`));
      list.append(h('div.list-row', thumb,
        h('div.main', h('div.t', m ? `${m.artist} — ${m.title}` : 'Missing beatmap', best ? h('span', { style: { marginLeft: '8px', verticalAlign: '2px' } }, rankPill(best.grade)) : null), h('div.s', m ? `[${m.version}] · ${m.keys}K · ${m.creator}` : `hash ${hash.slice(0, 12)}… (not in library)`)),
        m ? starBadge(m.stars) : null,
        m ? h('button.btn.sm', { onclick: () => Screens.go('songselect', { mapId: m.id }) }, icon('play'), 'Open') : null,
        h('button.icon-btn', { title: 'Remove from collection', onclick: () => Collections.toggle(c.id, hash) }, icon('x'))));
    }
    this.main.append(list);
  },
};

/** lazer's ManageCollectionsDialog (song select → Manage collections): a rounded panel at half the screen's width and
 *  80% of its height, popping in; "Manage collections" over a search box, then each collection as a pill-shaped text box
 *  you rename in place, its beatmap count, and a red delete button (asking first when it isn't empty) — and a last
 *  "Create a new collection" box that makes one as you type. */
const ManageCollections = {
  open() {
    if (this.o) return;
    UISounds.play('select-expand');
    const search = h('input.mc-search', { placeholder: 'Search collections...', 'aria-label': 'Search collections', spellcheck: 'false' });
    const list = h('div.mc-list');
    const close = h('button.mc-close', { 'aria-label': 'Close', onclick: () => { UISounds.back(); this.o.close(); } }, icon('x'));
    const panel = h('div.mc-dialog', { role: 'dialog', 'aria-modal': 'true' },
      h('div.mc-head', h('h2', 'Manage collections'), close),
      h('div.mc-searchrow', icon('search'), search),
      list);
    const row = c => {
      const name = h('input.mc-name', { value: c.name, maxlength: 60, 'aria-label': 'Collection name', spellcheck: 'false' });
      // (renamed as you type, as lazer's text box does)
      let t = 0;
      name.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { if (name.value.trim() && name.value !== c.name) Collections.rename(c.id, name.value); }, 250); });
      name.addEventListener('change', () => { clearTimeout(t); if (name.value.trim() && name.value !== c.name) Collections.rename(c.id, name.value); else if (!name.value.trim()) name.value = c.name; });
      name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
      const n = c.hashes.length;
      const del = h('button.mc-del', { title: 'Delete collection', 'aria-label': 'Delete collection', onclick: async () => {
        // (lazer asks only when there's something in it)
        if (n && !await Dialog.confirm('Confirm deletion of', `${c.name} (${n} beatmap${n === 1 ? '' : 's'})`, { ok: 'Yes. Go for it.', cancel: 'No! Abort mission!', danger: true })) return;
        UISounds.play('check-off'); Collections.remove(c.id);
      } }, icon('x'));
      return h('div.mc-item', { dataset: { id: c.id } },
        h('div.mc-pill', name, h('span.mc-count', `${fmtInt(n)} beatmap${n === 1 ? '' : 's'}`),
          h('button.mc-go', { title: 'Show in song select', 'aria-label': 'Show in song select', disabled: !n, onclick: () => { Settings.set('songselect.collection', c.id); this.o.close(); if (Screens.currentName === 'songselect') SongSelect.rebuild(true); else Screens.go('songselect'); } }, icon('play'))),
        del);
    };
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const keep = document.activeElement && list.contains(document.activeElement) ? document.activeElement.closest('.mc-item')?.dataset.id : null;
      clearEl(list);
      for (const c of Collections.list) if (!q || c.name.toLowerCase().includes(q)) list.append(row(c));
      // the last row: typing in it creates the collection, and the cursor carries on in its new box
      const fresh = h('input.mc-name', { placeholder: 'Create a new collection', maxlength: 60, 'aria-label': 'Create a new collection', spellcheck: 'false' });
      fresh.addEventListener('input', async () => {
        if (!fresh.value.trim() || fresh._busy) return;
        fresh._busy = true;
        const c = await Collections.create(fresh.value);
        // (whatever was typed while it was being made carries over)
        const box = list.querySelector(`.mc-item[data-id="${c.id}"] .mc-name`);
        if (box) { box.value = fresh.value; box.focus(); box.setSelectionRange(box.value.length, box.value.length); if (fresh.value !== c.name) box.dispatchEvent(new Event('input')); }
      });
      list.append(h('div.mc-item.new', h('div.mc-pill', fresh), h('span.mc-del-gap')));
      if (keep) { const b = list.querySelector(`.mc-item[data-id="${keep}"] .mc-name`); if (b) b.focus(); }
    };
    search.addEventListener('input', render);
    const off = Bus.on('collections:changed', () => { if (!list.contains(document.activeElement) || !document.activeElement.matches('.mc-name') || document.activeElement.closest('.new')) render(); });
    this.o = makeOverlay(panel, { onClose: () => { off(); this.o = null; UISounds.play('click-close'); }, onKey: e => { if (e.key === 'Escape') { UISounds.back(); this.o.close(); return true; } } });
    render();
    setTimeout(() => search.focus({ preventScroll: true }), 50);
  },
};

// ─────────────────────────────── Profile (osu!lazer user profile layout; includes statistics) ───────────────────────────────
const ProfileScreen = {
  /** Your profile, or (params.pid) another player's — lazer's UserProfileOverlay either way; theirs comes from the
   *  server (what their game last shared). */
  enter(params = {}) {
    const other = params.pid && params.pid !== (typeof Presence !== 'undefined' && Presence.pid());
    this.remote = other ? { pid: params.pid, name: params.name, avatar: params.avatar, data: null } : null;
    const { el, page } = pageShell(other ? `${params.name || 'player'}'s profile` : 'Profile', null, [], { icon: 'user', hue: 'pink', wide: true });
    this.page = page;
    this._unsub = [Bus.on('profile:changed', () => { if (!this.remote) this.render(); }), Bus.on('scores:changed', () => { if (!this.remote) this.render(); }),
      Bus.on('profile:remote', m => { if (this.remote && m.pid === this.remote.pid) {
        if (m.data) m.data = { ...m.data, pp: m.verified ? m.verified.pp : m.data.pp || 0, top: m.data.top && m.data.top.length ? m.data.top : m.top || [] }; /* (pp: the server's standing for them) */
        // a player whose game hasn't sent its profile yet: what the server knows of them (rank, pp, accuracy, play
        // count, ranks) — a profile is never "not shared"
        else { const v = m.verified || {}; m.data = { name: m.name || this.remote.name, pp: v.pp || 0, avgAcc: v.acc || 0, plays: v.plays || 0, grades: { SS: v.ss || 0, S: v.s || 0, A: v.a || 0 }, top: m.top || [] }; } Object.assign(this.remote, { data: m.data, missing: !m.data, rank: m.rank, daily: m.daily, online: m.online, id: m.id, status: m.status, avatar: m.avatar || this.remote.avatar, name: (m.data && m.data.name) || m.name || this.remote.name }); this.render(); } }),
      Bus.on('presence:changed', () => { if (this.remote && !this.remote.data && !this.remote.missing) Presence.send({ t: 'profile', pid: this.remote.pid }); }),
      Bus.on('rankings', d => { if (this.remote) return; this.globalRank = d.you ? d.you.rank : null; this.paintGlobal(); }), Bus.on('daily', () => this.paintDaily())];
    this.render();
    if (this.remote) { Presence.start(); Presence.send({ t: 'profile', pid: this.remote.pid }); }
    else if (typeof Rankings !== 'undefined') { Rankings.report(); Presence.send({ t: 'rankings' }); Daily.ask(); }
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); },
  /** lazer's DailyChallengeStatsDisplay: "Daily Challenge" and the days played in the colour of their tier; the
   *  tooltip has the streaks. Hidden until you've played one. */
  paintDaily() {
    const el = this.dailyEl, v = this.remote ? this.remote.daily : Daily.data && Daily.data.stats;
    if (!el || !el.isConnected) return;
    el.hidden = !(v && v.plays);
    if (el.hidden) return;
    const tier = n => n >= 360 ? 'lustrous' : n >= 240 ? 'radiant' : n >= 120 ? 'rhodium' : n >= 60 ? 'platinum' : n >= 30 ? 'gold' : n >= 10 ? 'silver' : n >= 5 ? 'bronze' : 'iron';
    const d = n => `${fmtInt(n)}d`;
    clearEl(el).append(h('span.pf-daily-t', 'Daily Challenge'), h(`b.tier-${tier(Math.floor(v.plays / 3))}`, d(v.plays)),
      h('div.pf-daily-tip',
        h('div', h('span', 'Total participation'), h(`b.tier-${tier(Math.floor(v.plays / 3))}`, d(v.plays))),
        h('div', h('span', 'Current daily streak'), h(`b.tier-${tier(v.current)}`, d(v.current))),
        h('div', h('span', 'Best daily streak'), h(`b.tier-${tier(v.best)}`, d(v.best)))));
  },
  paintGlobal() { const b = this.globalEl && this.globalEl.querySelector('b'); if (b) b.textContent = this.globalRank ? `#${fmtInt(this.globalRank)}` : '—'; },
  /** Everything the profile shows, from this browser's scores — also sent up so other players can open it. */
  localData() {
    const p = ProfileManager.profile, xp = ProfileManager.xpInfo(), st = StatisticsManager.compute();
    const bestPerMap = new Map();
    for (const s of ScoreManager.scores) if (s.passed && (!bestPerMap.has(s.mapHash) || ScoreManager.value(bestPerMap.get(s.mapHash)) < ScoreManager.value(s))) bestPerMap.set(s.mapHash, s);
    const lite = (s, pp) => ({ title: s.title, artist: s.artist, version: s.version, creator: s.creator, grade: s.grade, accuracy: s.accuracy, mods: s.mods || [], date: s.date, pp, _s: s,
      // (enough for other players to open it on the results screen)
      score: Math.round(ScoreManager.value(s) || 0), maxCombo: s.maxCombo, counts: s.counts, keys: s.keys, stars: s.stars, mapHash: s.mapHash, passed: s.passed, ranked: ScoreManager.isRanked(s) });
    const day = 86400000, g = st.grades || {};
    return {
      name: p.name, created: p.created, plays: st.plays, playtime: st.playtime, passed: st.passed, avgAcc: st.avgAcc, notes: st.notes, highestCombo: st.highestCombo,
      rankedScore: [...bestPerMap.values()].reduce((a, s) => a + s.score, 0), pp: ScoreManager.totalPp().total,
      grades: { XH: g.XH || 0, SS: g.SS || 0, SH: g.SH || 0, S: g.S || 0, A: g.A || 0 },
      level: xp.level, xpInto: xp.into, xpNeed: xp.need, xpProgress: xp.progress,
      top: ScoreManager.bestPpPerMap().slice(0, 20).map(tp => lite(tp.score, tp.pp)),
      recent: ScoreManager.recent(10).map(s => lite(s, s.passed ? ScoreManager.ppOf(s) : null)),
      medals: Medals.unlocked(),
      ppHist: ScoreManager.ppHistory().slice(-60).map(x => ({ y: Math.round(x.pp), tip: `${fmtInt(x.pp)}pp after ${x.title} [${x.version}] · ${new Date(x.date).toLocaleDateString(undefined, { dateStyle: 'medium' })}` })),
      perDay: st.perDay.map(d => ({ label: new Date(d.day * day).toLocaleDateString([], { month: 'short', day: 'numeric' }), value: d.plays, tip: `${new Date(d.day * day).toLocaleDateString(undefined, { dateStyle: 'medium' })}: ${d.plays} play${d.plays === 1 ? '' : 's'}` })),
    };
  },
  /** The same, for sending: without the local score objects. */
  summary() {
    const d = this.localData(), strip = a => a.map(({ _s, ...x }) => x);
    return { ...d, top: strip(d.top), recent: strip(d.recent) };
  },
  render() {
    const page = this.page;
    clearEl(page);
    if (this.remote) {
      const d = this.remote.data;
      if (!d) { page.append(h('div.rk-empty', Presence.ws ? h('span.spinner') : null, Presence.ws ? 'Loading profile…' : 'Profiles need the online server — trying to connect…')); return; }
      this.renderData(page, d, false);
      return;
    }
    this.renderData(page, this.localData(), true);
  },
  renderData(page, d, own) {
    const p = own ? ProfileManager.profile : { name: d.name || (this.remote && this.remote.name) || 'Player', created: d.created };
    const xp = { level: d.level || 1, into: d.xpInto || 0, need: d.xpNeed || 1, progress: clamp(d.xpProgress || 0, 0, 1) };
    const st = { plays: d.plays || 0, playtime: d.playtime || 0, passed: d.passed || 0, avgAcc: d.avgAcc || 0, notes: d.notes || 0, highestCombo: d.highestCombo || 0, grades: d.grades || {} };
    const rankedScore = d.rankedScore || 0, pp = { total: d.pp || 0 };
    const avatar = own ? ProfileManager.avatarEl(120) : Presence.avatarEl({ name: p.name, avatar: this.remote.avatar || d.avatar }, 120);
    avatar.classList.add('pf-avatar');
    if (own) { avatar.title = 'Change avatar'; avatar.addEventListener('click', () => AvatarPicker.open()); }
    // osu!lazer's UserProfileOverlay: the cover (here the background of the top pp play) with the avatar and name,
    // a strip with play count / time and the level badge, then the detail area: performance and accuracy, rank
    // counts as rank pills, the stat list; then a section tab bar and the sections themselves.
    const cover = h('div.pf-cover');
    if (own) {
      const top1 = (d.top || []).map(t => BeatmapManager.mapByHash(t._s.mapHash)).find(Boolean);
      const last = ScoreManager.recent(1)[0], lastMap = top1 || (last && BeatmapManager.mapByHash(last.mapHash));
      if (lastMap) BeatmapManager.bgURL(lastMap).then(u => { if (u) { cover.style.backgroundImage = `url("${u}")`; cover.classList.add('img'); } }).catch(() => {});
    }
    const u = this.remote ? { pid: this.remote.pid, name: p.name, avatar: this.remote.avatar, online: !!this.remote.online, id: this.remote.id, status: this.remote.status } : null;
    const top = h('div.pf-top', cover, h('div.pf-top-in',
      avatar,
      h('div.pf-id',
        h('div.pf-name', p.name, own ? h('button.icon-btn', { title: 'Rename', 'aria-label': 'Rename', onclick: async () => { const n = await Dialog.prompt('Username', p.name); if (n) ProfileManager.setName(n); } }, icon('edit')) : null),
        h('div.pf-tags', h('span.pf-tag', 'osu!mania'), p.created ? h('span.pf-since', `Playing since ${new Date(p.created).toLocaleDateString([], { year: 'numeric', month: 'long' })}`) : null,
          u ? h('span.pf-online', UserPanels.statusIcon(u), UserPanels.statusText(u)) : null)),
      u ? h('div.pf-acts', ...UserPanels.menuItems(u).filter(it => !it.sep && it.label !== 'View profile').map(it => h(`button.btn.sm${it.danger ? '.danger' : ''}`, { onclick: () => { UISounds.click(); it.onClick && it.onClick(); setTimeout(() => this.render(), 300); } }, it.icon ? icon(it.icon) : null, it.label))) : null));
    const centre = h('div.pf-centre',
      h('span.pf-chip', { title: 'Play count' }, icon('play', 'fill'), fmtInt(st.plays)),
      h('span.pf-chip', { title: 'Play time' }, icon('clock'), fmtDuration(st.playtime)),
      this.dailyEl = h('div.pf-daily', { hidden: true }),
      h('div.grow'),
      h('div.pf-level', { title: `${fmtInt(xp.into)} / ${fmtInt(xp.need)} XP` },
        h('div.pf-hex', h('span', String(xp.level))),
        h('div.pf-lvl', h('div.pf-lvl-bar', h('i', { style: { width: (xp.progress * 100).toFixed(1) + '%' } })), h('span', `${Math.floor(xp.progress * 100)}%`))));
    const grades = st.grades || {};
    const rank = g => h('div.pf-rank', rankPill(g), h('span', fmtInt(grades[g] || 0)));
    const dl = (k, v) => h('div.pf-dl', h('span', k), h('b', v));
    const globalRank = own ? this.globalRank : this.remote.rank;
    const detail = h('div.pf-detail',
      h('div.pf-detail-l',
        h('div.pf-bigs',
          // lazer's Global Ranking: the place in the rankings (from the server; — until it answers or offline)
          this.globalEl = h('div.pf-big.pf-global', { title: 'Place in the rankings, by performance', onclick: () => Screens.go('rankings') }, h('span', 'Global Ranking'), h('b', globalRank ? `#${fmtInt(globalRank)}` : '—')),
          h('div.pf-big', { title: 'The best play on each beatmap: the top one counts in full, each next one 95% as much as the one before' }, h('span', 'Performance'), h('b', fmtInt(pp.total) + 'pp'))),
        h('div.pf-ranks', rank('XH'), rank('SS'), rank('SH'), rank('S'), rank('A'))),
      h('div.pf-detail-r',
        dl('Ranked score', fmtInt(rankedScore)), dl('Play count', fmtInt(st.plays)),
        dl('Play time', fmtDuration(st.playtime)), dl('Total hits', fmtInt(st.notes)), dl('Maximum combo', fmtInt(st.highestCombo) + 'x')));
    // sections, with lazer's sticky tab bar
    const secs = [];
    const section = (id, title, ...kids) => { const el = h('section.pf-sec', { dataset: { sec: id } }, h('h2', title), ...kids); secs.push([id, title, el]); return el; };
    const sub = (title, count, ...kids) => h('div.pf-subsec', h('h3', title, count != null ? h('span.pf-count', fmtInt(count)) : null), ...kids);
    const ppHist = d.ppHist || [], perDay = d.perDay || [];
    const hist = section('historical', 'Historical',
      ppHist.length > 1 ? sub('Performance', null, h('div.pf-chart', Charts.line(ppHist, { fmtY: v => Math.round(v) + 'pp', yMin: 0, height: 160, dots: false }))) : null,
      st.plays && perDay.length ? sub('Play history', null, h('div.pf-chart', Charts.bars(perDay))) : h('div.pf-empty', 'Nothing here yet.'));
    const row = (x, i, weighted) => this.scoreRow(x._s || { ...x, remote: true }, x.pp == null ? null : fmtInt(x.pp), weighted ? `weighted ${Math.round(Math.pow(0.95, i) * 100)}%` : null, weighted ? fmtInt(x.pp * Math.pow(0.95, i)) : null);
    const topPlays = d.top || [];
    const ranks = section('ranks', 'Ranks',
      sub('Best performance', topPlays.length, topPlays.length
        ? h('div.pf-scores', ...topPlays.map((x, i) => row(x, i, true)))
        : h('div.pf-empty', own ? 'No performance records. Pass a map to earn pp.' : 'No performance records yet.')));
    const got = d.medals || {};
    const medals = section('medals', 'Medals', sub('Medals', Medals.all.filter(m => got[m.id]).length, ...Medals.section(got)));
    const recent = d.recent || [];
    const rec = section('recent', 'Recent',
      sub('Recent plays', recent.length, recent.length
        ? h('div.pf-scores', ...recent.map((x, i) => row(x, i, false)))
        : h('div.pf-empty', 'No recent plays.')));
    let pinned = null; // (a clicked tab stays lit until you scroll yourself, even if its section can't reach the top)
    const tabs = h('div.pf-tabs', ...secs.map(([id, title, el]) => h('button.ov-tab', { onclick: () => { UISounds.click(); pinned = id; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); [...tabs.children].forEach((b, i) => b.classList.toggle('on', secs[i][0] === id)); } }, title.toLowerCase())));
    page.append(h('div.pf-header', top, centre, detail), tabs, hist, ranks, medals, rec);
    this.paintDaily();
    // lazer lights the tab of the section you're reading
    requestAnimationFrame(() => {
      let sc = tabs.parentElement;
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
      if (!sc) return;
      const sync = () => {
        if (!tabs.isConnected) { sc.removeEventListener('scroll', sync); return; }
        if (pinned) return;
        const line = tabs.getBoundingClientRect().bottom + 60;
        let cur = secs[0][0];
        for (const [id, , el] of secs) if (el.getBoundingClientRect().top < line) cur = id;
        if (sc.scrollTop > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) cur = secs[secs.length - 1][0];
        [...tabs.children].forEach((b, i) => b.classList.toggle('on', secs[i][0] === cur));
      };
      sc.addEventListener('scroll', sync, { passive: true });
      const unpin = () => { if (pinned) { pinned = null; sync(); } };
      sc.addEventListener('wheel', unpin, { passive: true });
      sc.addEventListener('pointerdown', e => { if (!e.target.closest('.pf-tabs')) unpin(); });
      sync();
    });
  },
  /** lazer's DrawableProfileScore: rank pill, title / artist, difficulty and date, mods, accuracy, and the pp in a
   *  sheared block on the right (with the weighting for best performance). */
  scoreRow(s, pp, weight = null, weighted = null) {
    return h(`button.pf-score${s.remote ? '.remote' : ''}`, { onclick: () => {
      UISounds.click();
      if (!s.remote) { Screens.go('results', { score: s, fromList: true }); return; }
      const r = this.remote || {};
      Screens.go('results', { score: { ...s, scoreStd: s.score, online: true, player: r.name, avatar: r.avatar, counts: s.counts || [0, 0, 0, 0, 0, 0], passed: s.passed !== false && s.grade !== 'F', replayId: null }, fromList: true, watched: 'online' }, { transition: 'right' });
    } },
      rankPill(s.grade),
      h('div.main', h('div.t', s.title, h('span.a', ` by ${s.artist || ''}`)), h('div.s', h('span.v', s.version), h('span.d', fmtDate(s.date)))),
      h('span.pf-mods', ...(s.mods || []).map(m => ModSystem.badge(m, true))),
      h('div.pf-acc', fmtAcc(s.accuracy)),
      weight ? h('div.pf-weight', h('b', `${weighted}pp`), h('span', weight)) : null,
      h(`div.pf-ppblock${pp == null ? '.failed' : ''}`, pp == null ? h('span', 'failed') : h('span', pp, h('small', 'pp'))));
  },
};

// ─────────────────────────────── Replays ───────────────────────────────
const ReplaysScreen = {
  enter() {
    const { el, page } = pageShell('Replays', null, [
      h('button.btn', { onclick: () => importViaPicker('.osr,.amr,.json') }, icon('upload'), 'Import replay')], { icon: 'film', hue: 'plum' });
    this.list = h('div.list');
    page.append(this.list);
    this._unsub = [Bus.on('replays:changed', () => this.render())];
    this.render();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); },
  render() {
    clearEl(this.list);
    if (!ReplayManager.list.length) { this.list.append(h('div.empty', h('div.big', 'No replays saved'), 'Replays of personal bests are saved automatically (configurable in Settings → Maintenance). You can also save any play from the results screen.')); return; }
    // (lazer's DrawableProfileScore, as on the profile: rank pill, title by artist, difficulty · player · date, mods,
    // accuracy — and the replay's buttons in the slanted block where the pp would be)
    const rows = h('div.pf-scores.rp-list');
    for (const r of ReplayManager.list) {
      const map = BeatmapManager.mapByHash(r.mapHash);
      const sm = r.summary || {};
      const watch = () => { if (map) { UISounds.click(); Game.launch({ mapId: map.id, mode: 'replay', replay: r }); } };
      const act = (ic, title, f, cls = '') => h(`button.rp-act${cls}`, { title, 'aria-label': title, disabled: !map && cls !== '.del' && ic !== 'download', onclick: e => { e.stopPropagation(); f(e); } }, icon(ic));
      rows.append(h(`div.pf-score.rp-row${map ? '' : '.missing'}`, { role: 'button', tabindex: 0, title: map ? 'Watch replay' : 'This beatmap isn\'t in your library', onclick: watch, onkeydown: e => { if (e.key === 'Enter') watch(); } },
        rankPill(sm.grade || 'D'),
        h('div.main', h('div.t', r.title, h('span.a', ` by ${r.artist || ''}`)),
          h('div.s', h('span.v', r.version), h('span.p', r.player || 'Player'), h('span.d', fmtDateTime(r.date)), map ? null : h('span.x', 'beatmap missing'))),
        h('span.pf-mods', ...(r.mods || []).map(m => ModSystem.badge(m, true))),
        h('div.rp-combo', `${fmtInt(sm.maxCombo || 0)}x`),
        h('div.pf-acc', fmtAcc(sm.accuracy || 0)),
        h('div.pf-ppblock.rp-acts',
          h('span.rp-btns',
            act('play', 'Watch', watch),
            act('download', 'Export .osr (opens in osu!lazer)', () => Osr.exportReplay(r)),
            act('save', 'Export .amr (this game\'s own format)', () => ReplayManager.export(r)),
            act('trash', 'Delete', async () => { if (await Dialog.confirm('Delete replay?', `${r.title} [${r.version}] by ${r.player}`, { ok: 'Delete', danger: true })) ReplayManager.remove(r.id); }, '.del')))));
    }
    this.list.append(rows);
  },
};

// ─────────────────────────────── Skins ───────────────────────────────
class SkinPreview {
  /** scrollSpeed: scroll at the player's scroll speed setting instead of a fixed demo speed. */
  constructor(canvas, { scrollSpeed = false } = {}) { this.canvas = canvas; this.renderer = new ManiaRenderer(canvas); this.running = false; this.useSpeed = scrollSpeed; }
  async show(skin, keys) {
    this.token = {};
    const tok = this.token;
    // (the previous skin may be unloaded while the new one loads: stop drawing its health bar now)
    if (this.hpBar) { this.hpBar.el.remove(); this.hpBar = null; }
    const layout = await skin.mania(keys);
    if (tok !== this.token) return;
    this.keys = keys;
    this.renderer.setLayout(layout);
    // show the health bar the way gameplay will: the skin's own bar in the corner, the skin's or the slim bar beside
    // the stage (the osu!lazer bar lives in the gameplay HUD, so the preview shows none for it)
    const hm = healthModeFor(layout);
    this.renderer.healthMode = hm === 'stage' || hm === 'skinstage' ? hm : null;
    if (hm === 'skin' && this.canvas.parentElement) { this.hpBar = new SkinHealthBar(layout); this.canvas.parentElement.append(this.hpBar.el); }
    // demo pattern: stairs, chords, jacks and long notes
    const notes = [];
    let t = 800;
    for (let bar = 0; bar < 6; bar++) {
      for (let i = 0; i < keys; i++) notes.push({ col: i, time: t + i * 110, end: t + i * 110, isLN: false });
      t += keys * 110 + 150;
      notes.push({ col: 0, time: t, end: t + 700, isLN: true }, { col: keys - 1, time: t + 200, end: t + 900, isLN: true });
      if (keys > 2) notes.push({ col: Math.floor(keys / 2), time: t + 350, end: t + 350, isLN: false }, { col: Math.floor(keys / 2) - (keys > 3 ? 1 : 0), time: t + 350, end: t + 350, isLN: false });
      t += 1100;
    }
    notes.sort((a, b) => a.time - b.time || a.col - b.col);
    const fixed = [];
    const last = new Array(keys).fill(-1e9);
    for (const n of notes) { if (n.time <= last[n.col] + 30) continue; last[n.col] = n.end; fixed.push(n); }
    this.notes = fixed; this.end = t + 500;
    this.reset();
    if (!this.running) { this.running = true; this.loop(); }
  }
  reset() {
    this.engine = new GameplayEngine({ notes: this.notes, keys: this.keys, windows: timingWindows({ od: 8 }), noFail: true });
    this.engine.onEvent(e => { if (e.type === 'judgement') this.renderer.onJudgement(e, performance.now()); });
    this.feed = generateAutoInputs(this.engine.notes, this.keys);
    this.fi = 0; this.held = new Array(this.keys).fill(false); this.t0 = performance.now();
  }
  loop() {
    const frame = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(frame);
      if (!this.engine) return;
      const now = performance.now() - this.t0;
      if (now > this.end) { this.reset(); return; }
      while (this.fi < this.feed.length && this.feed[this.fi][0] <= now) {
        const [tt, c, d] = this.feed[this.fi++];
        this.held[c] = !!d; if (!d) this.renderer.onRelease(c, performance.now());
        this.engine.input(c, !!d, tt);
      }
      this.engine.advance(now);
      this.renderer.render({ now, posNow: now, scroll: { pos: t => t, posAt: t => t }, pxPerMs: (this.useSpeed ? this.renderer.scrollLength : this.renderer.hitY) / (this.useSpeed ? 11485 / Settings.get('gameplay.scrollSpeed') : 520), engine: this.engine, held: this.held, hidden: null, realNow: performance.now() });
      // (Auto never loses health: the demo bar rises and falls so the skin's low-health look shows too)
      if (this.hpBar) this.hpBar.update(0.6 + 0.4 * Math.cos(now / 1800), performance.now());
    };
    frame();
  }
  stop() { this.running = false; cancelAnimationFrame(this._raf); if (this.hpBar) { this.hpBar.el.remove(); this.hpBar = null; } }
}

const SkinsScreen = {
  sel: null, keys: 4,
  enter() {
    const { el, page } = pageShell('Skins', null, [
      h('button.btn.primary', { onclick: () => importViaPicker('.osk') }, icon('upload'), 'Import .osk')], { icon: 'brush', hue: 'orange' });
    this.sel = this.sel || SkinManager.current.id;
    this.side = h('div.side-list'); this.main = h('div');
    page.append(h('div.split', this.side, this.main));
    this._unsub = [Bus.on('skins:changed', () => this.render()), Bus.on('skin:changed', () => this.render()),
      // customising the Custom skin redraws the preview (debounced: sliders send many changes)
      Bus.on('settings:changed', k => { if (!(k.startsWith('skin.c.') || k.startsWith('wom.') || ['skin.noteStyle', 'skin.hue', 'skin.darkerHolds', 'ui.theme'].includes(k)) || !this.preview || !this.previewSkin) return;
        clearTimeout(this._pvT); this._pvT = setTimeout(() => { this.previewSkin.layoutCache.clear(); this.preview.show(this.previewSkin, this.keys); }, 120); })];
    this.render();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); if (this._customOff) { this._customOff(); this._customOff = null; } this.preview && this.preview.stop(); },
  CUSTOM_KEYS: ['skin.noteStyle', 'skin.c.palette', 'skin.hue', 'skin.c.pattern', 'skin.c.noteSize', 'skin.c.round', 'skin.c.receptor', 'skin.c.keyArea', 'skin.c.hold', 'skin.darkerHolds', 'skin.c.glow', 'skin.c.lines', 'skin.c.border'],
  WOM_KEYS: ['wom.style', 'wom.hue', 'wom.judgements', 'wom.darkerHolds'],
  /** The Custom skin's options next to its preview (the same controls as in Settings → Skin): note type, colour,
   *  judgement set, darker holds. */
  customPanel(wom = false) {
    const box = h('div.sk-custom'), keys = wom ? this.WOM_KEYS : this.CUSTOM_KEYS;
    // (a WOM skin being looked at isn't necessarily the one in use, so its rows show whatever is selected)
    const rowOf = d => !wom ? d : { ...d, when: undefined };
    const paint = () => clearEl(box).append(h('div.sk-custom-h', icon('brush'), 'Customise', h('button.btn.sm.ghost', { onclick: () => { for (const k of keys) { const d = Settings.schema.get(k); if (d) Settings.set(k, structuredClone(d.d)); } UISounds.click(); paint(); } }, 'Reset')),
      h('div.settings-panel.sk-custom-rows', ...keys.map(k => Settings.schema.get(k)).filter(Boolean).map(d => SettingsPanel.row(rowOf(d)))));
    paint();
    // rows that depend on another one (the Custom hue on its palette, WOM's hue on its colour mode)
    if (this._customOff) this._customOff();
    this._customOff = Bus.on('settings:changed', k => { if ((k === 'skin.c.palette' || k === 'wom.colorMode') && box.isConnected) paint(); });
    return box;
  },
  render() {
    const list = SkinManager.list();
    if (!list.some(s => s.id === this.sel)) this.sel = SkinManager.current.id;
    clearEl(this.side);
    for (const s of list) {
      this.side.append(h(`button.side-item${s.id === this.sel ? '.active' : ''}`, { onclick: () => { this.sel = s.id; UISounds.click(); this.render(); } },
        icon('brush'), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.name),
        s.id === SkinManager.current.id ? h('span.cnt', { style: { color: 'var(--accent)' } }, 'in use') : null));
    }
    const meta = list.find(s => s.id === this.sel);
    const skin = SkinManager.instance(meta.id);
    clearEl(this.main);
    const supported = skin.supportedKeys(), borrowed = skin.builtin ? [] : skin.borrowedKeys();
    if (!supported.includes(this.keys) && !borrowed.includes(this.keys)) this.keys = supported.includes(4) ? 4 : supported.includes(7) ? 7 : (supported[0] || 4);
    const canvas = h('canvas');
    const pv = h('div.skin-preview', canvas);
    const inUse = SkinManager.current.id === meta.id;
    this.main.append(
      h('div.row', { style: { marginBottom: '12px', flexWrap: 'wrap' } }, h('h2', { style: { margin: 0, fontWeight: 900 } }, skin.name), h('span.grow'),
        h(`button.btn${inUse ? '' : '.primary'}`, { disabled: inUse, onclick: async () => { await SkinManager.select(meta.id); Toast.ok('Skin selected', skin.name); } }, inUse ? 'Selected' : 'Use this skin'),
        !meta.builtin ? h('button.btn.ghost', { onclick: () => SkinManager.exportOsk(meta.id) }, icon('download'), 'Export') : null,
        !meta.builtin ? h('button.btn.danger', { title: 'Delete skin', 'aria-label': 'Delete skin', onclick: async () => { if (await Dialog.confirm('Delete skin?', `${skin.name} will be removed.`, { ok: 'Delete', danger: true })) { await SkinManager.remove(meta.id); this.sel = SkinManager.current.id; } } }, icon('trash')) : null),
      h('div.sk-keys', h('span.muted', 'Preview'),
        h('button.sk-step', { 'aria-label': 'Fewer keys', disabled: this.keys <= 1, onclick: () => { this.keys = Math.max(1, this.keys - 1); this.render(); } }, icon('back')),
        h('span.sk-k', `${this.keys}K`),
        h('button.sk-step', { 'aria-label': 'More keys', disabled: this.keys >= MAX_KEYS, onclick: () => { this.keys = Math.min(MAX_KEYS, this.keys + 1); this.render(); } }, icon('chevron')),
        h('span.muted.sk-khint', meta.builtin ? '' : borrowed.includes(this.keys) ? "built from the skin's 4K layout" : supported.includes(this.keys) ? 'configured in skin.ini' : 'fallback layout')),
      meta.builtin ? h('div.sk-custom-wrap', pv, this.customPanel(true)) : pv,
      h('div.muted', { style: { marginTop: '10px', fontSize: '.85rem' } }, `by ${skin.author || 'unknown'}`));
    this.preview && this.preview.stop();
    this.preview = new SkinPreview(canvas);
    this.previewSkin = skin;
    requestAnimationFrame(() => this.preview.show(skin, this.keys));
  },
};

// ─────────────────────────────── What's new ───────────────────────────────
/** Updates, newest first. Returning players see the newest entries they haven't seen once, after the game loads
 *  (osu!lazer shows its changelog after an update); new players start with everything marked as seen. */
// What's new: only what a player will notice, in a few words each (no behind-the-scenes changes)
const CHANGELOG = [
  { id: '2026.10.5', title: 'Playlists', sections: [
    { icon: 'list', title: 'Playlists', items: ['New on the Play menu, like lazer: put up a list of up to 20 beatmaps for an hour to two weeks', 'Everyone can play them until it closes; each beatmap has its own leaderboard, and the playlist ranks everyone by their total'] },
    { icon: 'user', title: 'Your status', items: ['Right-click your name in the top bar: Online, Do not disturb (no invites or pop-ups) or Appear offline (nobody sees you online or can spectate you), like lazer'] },
    { icon: 'film', title: 'Spectating', items: ['Spectate anyone who\'s online, not just friends', 'Watching someone in the menus is live: their screen at their size, their scrolling and their cursor', 'Esc stops spectating, and your keys don\'t touch your own menus while you watch'] },
    { icon: 'film', title: 'Storyboards', items: ['Beatmaps\' storyboards now play behind the stage, like lazer (Settings → Gameplay → Storyboard / video)', 'Beatmaps imported before this need importing again to bring their storyboard pictures in'] },
    { icon: 'chat', title: 'Multiplayer', items: ['The room\'s chat shows in the corner during a match, like lazer', 'Chat commands: /me, /np (shares what you\'re listening to or playing) and /help', 'Storyboards wait for their outro at the end of a song, with Skip outro'] },
    { icon: 'mods', title: 'Mods', items: ['Cinema: Auto with only the background showing', 'Wind Up and Wind Down (Fun): the song speeds up to 1.5× or slows to 0.75× as it plays'] },
    { icon: 'trophy', title: 'Online', items: ['The beatmap page in the listing shows each difficulty\'s global ranking, even before you download it', 'After a play, the results show where it ranks globally on that beatmap', 'Only ranked beatmaps count toward pp, in your profile and the rankings', 'Rankings no longer show accuracy', 'Rooms survive the server restarting', 'Your background dim and blur are kept'] },
  ] },
  { id: '2026.10.4', title: 'Fair play', sections: [
    { icon: 'trophy', title: 'Online', items: ['Scores, pp, rankings and the daily challenge are now worked out by the server from your key presses, so nobody can post a fake score', 'Multiplayer results are checked by the server too', 'Everyone\'s profile is public: open anyone\'s from the rankings, leaderboards or the online list', 'Click another player\'s score to see it on the results screen', 'Changing your name updates it on all your scores and replays'] },
    { icon: 'mods', title: 'New mods', items: ['Flashlight: only the part of the stage near the receptors can be seen, and it shrinks as your combo grows', 'Cover: cover part of the stage from the top or the bottom', 'Muted (in the new Fun column): the music fades as your combo builds, with a metronome'] },
    { icon: 'mania', title: 'Gameplay', items: ['Bar lines across the stage at every bar, like lazer (Settings → Gameplay)', 'Change the offset or background dim from the pause screen'] },
    { icon: 'sparkle', title: 'Nicer', items: ['lazer\'s Manage collections window in song select (rename right in the list, type to make a new one)', 'Replays look like lazer\'s score rows', 'First-run setup asks Performance or Graphics', 'The game no longer goes fullscreen by itself on a computer'] },
    { icon: 'keyboard', title: 'Phones', items: ['A big typing bar above the keyboard, so you always see what you type', 'Tap to resume after turning the phone or switching apps', 'One Esc pauses, and the game keeps your keys while you play'] },
  ] },
  { id: '2026.10.3', title: 'Little things', sections: [
    { icon: 'sparkle', title: 'Nicer', items: ['A lazer-style skip button', 'The hit distribution on results reads like lazer\'s', 'Clicking the music button keeps now playing open', 'Song select keeps your beatmap when a search finds nothing', 'Long song titles fit everywhere', 'Open Settings and just type to search it', 'The song list no longer slides sideways when you click a beatmap', 'Watching a replay from the Replays page starts right away', 'Star ratings follow speed mods like DT', 'Song select plays the song straight away, even right after an import', 'The song list curves as you scroll, like lazer', 'Song select and results have lazer\'s sounds', 'The main menu\'s edges flash with the beat', 'A "hold for menu" button while playing, like lazer'] },
  ] },
  { id: '2026.10.2', title: 'Polish', sections: [
    { icon: 'upload', title: 'New', items: ['Bring over your Web-Osu-Mania backup — keybinds, beatmaps, scores, and every song in your collections'] },
    { icon: 'trophy', title: 'Ranked Play', items: ['No more rating: pick Beginner, Intermediate or Advanced and the cards suit you both', 'A cleaner waiting screen', 'Hands of five, and a reroll every round', 'Leaving a song gives that round to your opponent', 'Running out of health in multiplayer works like lazer: you fail but play on'] },
    { icon: 'sparkle', title: 'Nicer', items: ['A cleaner beatmap info page', 'The beatmap listing no longer flickers while you scroll', 'Volume controls moved to the left, like lazer', 'Top bar buttons close what they opened', 'Online players and rooms stay up to date', 'Skin health bars sit beside the stage', 'Skins look right at every key count', 'Results open like lazer: click the score for statistics'] },
  ] },
  { id: '2026.10.1', title: 'The lazer update', sections: [
    { icon: 'home', title: 'Main menu', items: ['A new lazer-style main menu', 'Background triangles take the colour of the song'] },
    { icon: 'bell', title: 'Top bar', items: ['Notifications, a clock and a now playing panel', 'Scroll on the menu to change the volume'] },
    { icon: 'download', title: 'Beatmap listing', items: ['New beatmap cards; click one for its info page'] },
    { icon: 'multi', title: 'Multiplayer', items: ['Ranked Play: 1v1 with beatmap cards', 'Create a Regular or Ranked room, public or private', 'Open rooms are listed in the lobby'] },
    { icon: 'brush', title: 'Skins', items: ['A better-looking Custom skin you can customise'] },
    { icon: 'mods', title: 'Everything else', items: ['Mod icons', 'Looks the same at every resolution'] },
  ] },
];
const WhatsNew = {
  latest() { return CHANGELOG[0].id; },
  /** After the game loads: a returning player gets the entries they haven't seen yet. */
  async maybeShow() {
    const seen = await DB.kvGet('changelog.seen', null).catch(() => null);
    if (seen === this.latest()) return;
    await DB.kvSet('changelog.seen', this.latest()).catch(() => {});
    if (!seen && !ProfileManager.profile.onboarded) return; // brand new: nothing to catch up on
    const i = CHANGELOG.findIndex(e => e.id === seen);
    this.show(i < 0 ? CHANGELOG.slice(0, 1) : CHANGELOG.slice(0, i));
  },
  show(entries = CHANGELOG) {
    const el = h('div.cl', { role: 'dialog', 'aria-label': 'What\'s new' },
      h('div.cl-head', h('div.cl-hicon', icon('sparkle')), h('div', h('div.cl-title', 'changelog'), h('div.cl-sub', 'what\'s new in Ashtonk!mania')),
        h('button.icon-btn.cl-x', { title: 'Close', 'aria-label': 'Close', onclick: () => o.close() }, icon('x'))),
      h('div.cl-body', ...entries.map(e => h('div.cl-entry',
        h('div.cl-ver', h('span.cl-pill', e.id), h('b', e.title)),
        ...e.sections.map((sec, si) => h('div.cl-sec', { style: { animationDelay: `${si * 60}ms` } }, h('div.cl-sech', icon(sec.icon), sec.title),
          h('ul', ...sec.items.map(t => h('li', t)))))))),
      h('div.cl-foot', h('button.btn.primary', { onclick: () => o.close() }, 'Let\'s go!')));
    const o = makeOverlay(el);
    UISounds.play('check-on');
    return o;
  },
};
