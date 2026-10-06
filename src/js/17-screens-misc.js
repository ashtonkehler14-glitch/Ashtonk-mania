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
      h('button.btn', { onclick: () => Screens.go('collections') }, icon('folder'), 'Collections'),
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
  leave() { (this._unsub || []).forEach(f => f()); if (this._io) this._io.disconnect(); },
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
    // rows go in a page at a time as the list scrolls (all of a big library at once froze the screen opening), each
    // with its picture once it's near the screen, and its table of difficulties built only when it's opened
    this._sets = sets; this._shown = 0;
    if (this._io) this._io.disconnect();
    const more = h('div.lib-more');
    this.list.append(more);
    this._io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) this.moreRows(more); }, { rootMargin: '600px' });
    this._io.observe(more);
    this.moreRows(more);
  },
  moreRows(more) {
    const sets = this._sets || [], from = this._shown, to = Math.min(sets.length, from + 40);
    if (from >= to) { more.remove(); if (this._io) this._io.disconnect(); return; }
    this._shown = to;
    const frag = document.createDocumentFragment();
    for (const set of sets.slice(from, to)) frag.append(this.row(set));
    more.before(frag);
  },
  row(set) {
    const thumb = h('div.mini-thumb', { style: { width: '84px', height: '52px' } });
    BeatmapManager.thumbURL(set, true).then(u => u && (thumb.style.backgroundImage = `url("${u}")`));
    const broken = set.maps.filter(m => m.problems.length);
    const details = h('div', { hidden: true, style: { width: '100%', paddingTop: '8px' } });
    const fill = () => {
      if (details.firstChild) return;
      details.append(h('table.table', h('tr', h('th', 'Difficulty'), h('th', 'Keys'), h('th', 'Stars'), h('th', 'Notes / LNs'), h('th', 'Length'), h('th', 'Status')),
          ...set.maps.map(m => h('tr', h('td', m.version), h('td', m.keys + 'K'), h('td', m.stars.toFixed(2)), h('td', `${m.noteCount} / ${m.lnCount}`), h('td', fmtTime(m.length)),
            h('td', m.problems.length ? h('span', { style: { color: '#ffb3bb' } }, m.problems.join('; ')) : m.warnings.length ? h('span.muted', m.warnings.join('; ')) : h('span', { style: { color: 'var(--good)' } }, 'OK'))))),
        h('div.muted', { style: { fontSize: '.78rem', marginTop: '6px' } }, `Files stored: ${Object.keys(set.fileIndex).length}${set.storyboard ? ' · storyboard' : ''}${set.video ? ' · video skipped' : ''} · source: ${set.sourceName || '—'}`));
    };
    return h('div.list-row.lib-row', { style: { flexWrap: 'wrap' } },
      thumb,
      h('div.main', h('div.t', `${set.artist} — ${set.title}`), h('div.s', `mapped by ${set.creator} · ${plural(set.maps.length, 'difficulty', 'difficulties')} · ${[...new Set(set.maps.map(m => m.keys))].sort((a, b) => a - b).map(k => k + 'K').join(', ')} · added ${fmtDate(set.added)}`)),
      broken.length ? h('span.tag.warn', { title: broken.map(m => `[${m.version}] ${m.problems.join('; ')}`).join('\n') }, `${broken.length} unplayable`) : null,
      Favorites.has(set.id) ? h('span.gold', icon('heart', 'fill')) : null,
      h('button.btn.sm', { onclick: () => Screens.go('songselect', { mapId: (set.maps.find(m => !m.problems.length) || set.maps[0]).id }) }, icon('play'), 'Open'),
      h('button.icon-btn', { title: 'Details', onclick: () => { fill(); details.hidden = !details.hidden; } }, icon('info')),
      h('button.icon-btn', { title: 'Extract (.osz)', 'aria-label': 'Extract (.osz)', onclick: () => BeatmapManager.exportOsz(set.id) }, icon('download')),
      h('button.icon-btn', { title: 'Delete', onclick: () => SongSelect.deleteSet(set) }, icon('trash')),
      details);
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
    if (!c.hashes.length) list.append(h('div.empty', h('div.big', 'Empty collection'), kbHint('In song select, use the folder button or F3 → "Manage collections" to add difficulties.', 'In song select, use the folder button to add difficulties.')));
    for (const hash of c.hashes) {
      const m = BeatmapManager.mapByHash(hash);
      const best = ScoreManager.best(hash);
      // the set's picture (like the Beatmaps page) instead of an empty slot where a grade goes; your grade by the title
      const thumb = h('div.mini-thumb', { style: { width: '68px', height: '42px' } });
      if (m) BeatmapManager.thumbURL(BeatmapManager.setById.get(m.setId), true).then(u => u && (thumb.style.backgroundImage = `url("${u}")`));
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
  keepParams: true,
  /** Your profile, or (params.pid) another player's — lazer's UserProfileOverlay either way; theirs comes from the
   *  server (what their game last shared). */
  enter(params = {}) {
    const other = params.pid && params.pid !== (typeof Presence !== 'undefined' && Presence.pid());
    // (coming back from one of their scores: what was already loaded shows straight away, then is brought up to date)
    this.remote = other ? (params.cache && params.cache.pid === params.pid ? params.cache : { pid: params.pid, name: params.name, avatar: params.avatar, data: null }) : null;
    const { el, page } = pageShell(other ? `${params.name || 'player'}'s profile` : 'Profile', null, [], { icon: 'user', hue: 'pink', wide: true });
    this.page = page;
    this._unsub = [Bus.on('profile:changed', () => { if (!this.remote) this.render(); }), Bus.on('scores:changed', () => { if (!this.remote) this.render(); }),
      Bus.on('profile:remote', m => {
        // (your own profile: the server's list of your first places)
        if (!this.remote && m.pid === Presence.pid()) { this.ownFirsts = { list: (m.firsts || []).filter(x => x && x.title), count: m.firstCount || 0 }; /* (one without its song's name isn't listed) */ this.render(); return; }
        if (this.remote && m.pid === this.remote.pid) { this.remote.firsts = { list: (m.firsts || []).filter(x => x && x.title), count: m.firstCount || 0 };
        if (m.data) m.data = { ...m.data, pp: m.verified ? m.verified.pp : m.data.pp || 0, top: m.data.top && m.data.top.length ? m.data.top : m.top || [] }; /* (pp: the server's standing for them) */
        // a player whose game hasn't sent its profile yet: what the server knows of them (rank, pp, accuracy, play
        // count, ranks) — a profile is never "not shared"
        else { const v = m.verified || {}; m.data = { name: m.name || this.remote.name, pp: v.pp || 0, avgAcc: v.acc || 0, plays: v.plays || 0, grades: { SS: v.ss || 0, S: v.s || 0, A: v.a || 0 }, top: m.top || [] }; } Object.assign(this.remote, { ppInfo: m.verified || null, data: m.data, missing: !m.data, rank: m.rank, daily: m.daily, online: m.online, id: m.id, status: m.status, avatar: m.avatar || this.remote.avatar, name: (m.data && m.data.name) || m.name || this.remote.name }); this.render(); } }),
      Bus.on('presence:changed', () => { if (this.remote && !this.remote.data && !this.remote.missing) Presence.send({ t: 'profile', pid: this.remote.pid }); }),
      Bus.on('rankings', d => { if (this.remote || d.mode === 'score') return; this.globalRank = d.you ? d.you.rank : null; this.paintGlobal(); }), Bus.on('daily', () => this.paintDaily())];
    this.render();
    if (params.scroll) requestAnimationFrame(() => { const sc = this.scroller(); if (sc) sc.scrollTop = params.scroll; });
    if (this.remote) { Presence.start(); Presence.send({ t: 'profile', pid: this.remote.pid }); }
    else if (typeof Rankings !== 'undefined') { Rankings.report(); Presence.send({ t: 'rankings' }); Daily.ask(); if (Presence.pid()) Presence.send({ t: 'profile', pid: Presence.pid() }); }
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
  mostRow(x, own) {
    const cover = h('div.pf-most-cover');
    if (x.onlineSetId > 0) OnlineBeatmaps.loadCover(cover, x.onlineSetId, ['list@2x', 'list', 'card']);
    else if (own) { const m = BeatmapManager.mapByHash(x.mapHash); if (m) BeatmapManager.bgThumbURL(m).then(u => { if (u) cover.style.backgroundImage = `url("${u}")`; }).catch(() => {}); }
    const local = own && BeatmapManager.mapByHash(x.mapHash);
    return h(`div.pf-most-row${local ? '.click' : ''}`, { onclick: local ? () => { UISounds.click(); Screens.go('songselect', { mapId: local.id }); } : null },
      cover,
      h('div.pf-most-t', h('div.pf-most-title', x.title, h('span', ` by ${x.artist}`)), h('div.pf-most-meta', starBadge(x.stars || 0), h('span.keys-tag', `${x.keys}K`), h('span', x.version), x.creator ? h('span.muted', `mapped by ${x.creator}`) : null)),
      h('div.pf-most-n', icon('play'), h('b', fmtInt(x.count))));
  },
  /** lazer's profile Beatmaps section: your favourite beatmaps, and the ones you made (in the editor, under your name). */
  beatmapLists() {
    const lite = set => {
      const maps = set.mapIds.map(id => BeatmapManager.maps.get(id)).filter(Boolean), stars = maps.map(m => m.stars || 0);
      return { title: set.title, artist: set.artist, creator: set.creator, status: set.status || '', onlineSetId: set.onlineId > 0 ? set.onlineId : 0, setId: set.id,
        diffs: maps.length, keys: [...new Set(maps.map(m => m.keys))].sort((a, b) => a - b), lo: stars.length ? Math.min(...stars) : 0, hi: stars.length ? Math.max(...stars) : 0 };
    };
    const me = (ProfileManager.profile.name || '').trim().toLowerCase();
    return {
      favourites: [...Favorites.set].map(id => BeatmapManager.setById.get(id)).filter(Boolean).slice(0, 50).map(lite),
      made: me ? BeatmapManager.sets.filter(st => (st.creator || '').trim().toLowerCase() === me).slice(0, 50).map(lite) : [],
    };
  },
  /** lazer's BeatmapCard: the cover, the title and artist, the mapper, the status and the difficulties. */
  beatmapCard(x, own) {
    const cover = h('div.pf-bc-cover');
    if (x.onlineSetId > 0) OnlineBeatmaps.loadCover(cover, x.onlineSetId, ['card@2x', 'card', 'cover']);
    else if (own) { const st = BeatmapManager.setById.get(x.setId); if (st) BeatmapManager.thumbURL(st, true).then(u => { if (u) cover.style.backgroundImage = `url("${u}")`; }).catch(() => {}); }
    const local = own && BeatmapManager.setById.get(x.setId);
    const open = () => {
      UISounds.click();
      if (local && local.mapIds.length) Screens.go('songselect', { mapId: local.mapIds[0] });
      else if (x.onlineSetId > 0) OnlineBeatmaps.getSet(x.onlineSetId).then(full => full && ExplorerScreen.openSet(full)).catch(() => {});
    };
    return h(`div.pf-bc${local || x.onlineSetId > 0 ? '.click' : ''}`, { onclick: open },
      cover,
      h('div.pf-bc-in',
        h('div.pf-bc-title', x.title), h('div.pf-bc-artist', `by ${x.artist}`),
        h('div.pf-bc-meta', x.creator ? h('span', 'mapped by ', h('b', x.creator)) : null),
        h('div.pf-bc-foot', statusPill(x.status) || h('span.pf-bc-local', 'local'), starBadge(x.lo || 0), x.hi > x.lo + 0.05 ? h('span.muted', `– ${(x.hi || 0).toFixed(2)}`) : null,
          h('span.muted', `${x.diffs} diff${x.diffs === 1 ? '' : 's'} · ${(x.keys || []).map(k => k + 'K').join(' ')}`))));
  },
  /** lazer's "Most played beatmaps": your plays counted per difficulty, the most first. */
  mostPlayed() {
    const by = new Map();
    for (const s of ScoreManager.scores) { const e = by.get(s.mapHash); if (e) { e.count++; if (s.date > e.last) e.last = s.date; } else by.set(s.mapHash, { s, count: 1, last: s.date }); }
    return [...by.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 10).map(({ s, count }) => {
      const m = BeatmapManager.mapByHash(s.mapHash), set = m && BeatmapManager.setById.get(m.setId);
      return { title: s.title, artist: s.artist, version: s.version, creator: s.creator, stars: s.stars, keys: s.keys, count, mapHash: s.mapHash, onlineSetId: set && set.onlineId > 0 ? set.onlineId : 0 };
    });
  },
  paintGlobal() { const b = this.globalEl && this.globalEl.querySelector('b'); if (b) b.textContent = this.globalRank ? `#${fmtInt(this.globalRank)}` : '—'; },
  /** Everything the profile shows, from this browser's scores — also sent up so other players can open it. */
  localData() {
    const p = ProfileManager.profile, xp = ProfileManager.xpInfo(), st = StatisticsManager.compute();
    const bestPerMap = new Map();
    for (const s of ScoreManager.scores) if (s.passed && (!bestPerMap.has(s.mapHash) || ScoreManager.value(bestPerMap.get(s.mapHash)) < ScoreManager.value(s))) bestPerMap.set(s.mapHash, s);
    const lite = (s, pp) => ({ title: s.title, artist: s.artist, version: s.version, creator: s.creator, grade: s.grade, accuracy: s.accuracy, mods: s.mods || [], date: s.date, pp, _s: s,
      // (enough for other players to open it on the results screen)
      score: Math.round(ScoreManager.value(s) || 0), maxCombo: s.maxCombo, counts: s.counts, keys: s.keys, stars: s.stars, mapHash: s.mapHash, passed: s.passed, ranked: ScoreManager.isRanked(s),
      ...(() => { const m = BeatmapManager.mapByHash(s.mapHash), st = m && BeatmapManager.setById.get(m.setId); return { onlineId: m && m.onlineId > 0 ? m.onlineId : undefined, onlineSetId: st && st.onlineId > 0 ? st.onlineId : undefined }; })() });
    const day = 86400000, g = st.grades || {};
    return {
      name: p.name, created: p.created, plays: st.plays, playtime: st.playtime, passed: st.passed, avgAcc: st.avgAcc, notes: st.notes, highestCombo: st.highestCombo,
      rankedScore: [...bestPerMap.values()].filter(s => ScoreManager.isRanked(s)).reduce((a, s) => a + (s.score || 0), 0), pp: ScoreManager.totalPp().total,
      grades: { XH: g.XH || 0, SS: g.SS || 0, SH: g.SH || 0, S: g.S || 0, A: g.A || 0 },
      level: xp.level, xpInto: xp.into, xpNeed: xp.need, xpProgress: xp.progress,
      // (50: the server checks each of them is on a ranked beatmap, by its osu! ids, before it counts toward the rankings)
      top: ScoreManager.bestPpPerMap().slice(0, 50).map(tp => lite(tp.score, tp.pp)),
      rankedPlays: ScoreManager.bestPpPerMap().length,
      recent: ScoreManager.recent(10).map(s => lite(s, s.passed ? ScoreManager.ppOf(s) : null)),
      mostPlayed: this.mostPlayed(),
      ...this.beatmapLists(),
      medals: Medals.unlocked(),
      ppHist: ScoreManager.ppHistory().slice(-60).map(x => ({ y: Math.round(x.pp), tip: `${fmtInt(x.pp)}pp after ${x.title} [${x.version}] · ${new Date(x.date).toLocaleDateString(undefined, { dateStyle: 'medium' })}` })),
      perDay: st.perDay.map(d => ({ label: new Date(d.day * day).toLocaleDateString([], { month: 'short', day: 'numeric' }), value: d.plays, tip: `${new Date(d.day * day).toLocaleDateString(undefined, { dateStyle: 'medium' })}: ${d.plays} play${d.plays === 1 ? '' : 's'}` })),
    };
  },
  /** The same, for sending: without the local score objects. */
  summary() {
    const d = this.localData(), strip = a => a.map(({ _s, ...x }) => x);
    // (20 of each beatmap list: the profile has to fit what the server keeps)
    return { ...d, top: strip(d.top), recent: strip(d.recent), favourites: (d.favourites || []).slice(0, 20), made: (d.made || []).slice(0, 20) };
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
    const pp = { total: d.pp || 0 };
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
        dl('Play count', fmtInt(st.plays)),
        dl('Play time', fmtDuration(st.playtime)), dl('Total hits', fmtInt(st.notes)), dl('Maximum combo', fmtInt(st.highestCombo) + 'x')));
    // sections, with lazer's sticky tab bar
    const secs = [];
    const section = (id, title, ...kids) => { const el = h('section.pf-sec', { dataset: { sec: id } }, h('h2', title), ...kids); secs.push([id, title, el]); return el; };
    const sub = (title, count, ...kids) => h('div.pf-subsec', h('h3', title, count != null ? h('span.pf-count', fmtInt(count)) : null), ...kids);
    const ppHist = d.ppHist || [], perDay = d.perDay || [];
    const hist = section('historical', 'Historical',
      ppHist.length > 1 ? sub('Performance', null, h('div.pf-chart', Charts.line(ppHist, { fmtY: v => Math.round(v) + 'pp', yMin: 0, height: 160, dots: false }))) : null,
      st.plays && perDay.length ? sub('Play history', null, h('div.pf-chart', Charts.bars(perDay))) : h('div.pf-empty', 'Nothing here yet.'),
      (d.mostPlayed || []).length ? sub('Most played beatmaps', d.mostPlayed.length, h('div.pf-most', ...d.mostPlayed.map(x => this.mostRow(x, own)))) : null);
    const row = (x, i, weighted) => this.scoreRow(x._s || { ...x, remote: true }, x.pp == null ? null : fmtInt(x.pp), weighted ? `weighted ${Math.round(Math.pow(0.95, i) * 100)}%` : null, weighted ? fmtInt(x.pp * Math.pow(0.95, i)) : null);
    // lazer's ProfileShowMoreButton: a list starts with 5 and grows by 10 with each "show more"
    const more = (items, mk, first = 5) => {
      const box = h('div.pf-scores');
      let shown = 0;
      const btn = h('button.pf-more', { onclick: () => { UISounds.click(); grow(10); } }, h('span', 'show more'), icon('down'));
      const grow = n => { const next = items.slice(shown, shown + n); next.forEach((x, i) => box.insertBefore(mk(x, shown + i), btn.parentNode === box ? btn : null)); shown += next.length; if (shown >= items.length) btn.remove(); };
      box.append(btn); grow(first);
      return box;
    };
    const topPlays = d.top || [];
    // how the total is made, as osu! adds it up for lazer: the best play on each ranked beatmap, each weighted 95% of
    // the one above it (100%, 95%, 90.25%…), plus the bonus for how many ranked plays there are
    const info = own ? { pp: d.pp || 0, n: ScoreManager.bestPpPerMap().length } : this.remote && this.remote.ppInfo;
    const n = info ? info.n || 0 : 0, bonus = OsuMath.bonusPp(n), total = info ? info.pp || 0 : d.pp || 0;
    const calc = topPlays.length && total > 0 ? h('div.pf-ppcalc',
      h('div.pf-ppc', h('small', 'best plays, weighted'), h('b', `${fmtInt(Math.max(0, total - bonus))}pp`)),
      h('span.pf-ppop', '+'),
      h('div.pf-ppc', h('small', `bonus · ${fmtInt(n)} ranked play${n === 1 ? '' : 's'}`), h('b', `${fmtInt(bonus)}pp`)),
      h('span.pf-ppop', '='),
      h('div.pf-ppc.total', h('small', 'total'), h('b', `${fmtInt(total)}pp`)),
      h('div.pf-ppnote', icon('check'), 'Only plays on ranked beatmaps count — checked on osu! by the server. Each play is weighted 95% of the one above it (100%, 95%, 90%…).')) : null;
    const ranks = section('ranks', 'Ranks',
      sub('Best performance', topPlays.length, calc, topPlays.length
        ? more(topPlays, (x, i) => row(x, i, true))
        : h('div.pf-empty', own ? 'No performance records. Pass a map to earn pp.' : 'No performance records yet.')),
      // lazer: the beatmaps they're #1 on, on the global leaderboards
      (f => sub('First place ranks', f.count, f.list.length ? more(f.list, (x, i) => row(x, i, false)) : h('div.pf-empty', own ? 'Not #1 on any beatmap yet.' : 'No first place ranks yet.')))((own ? this.ownFirsts : this.remote && this.remote.firsts) || { list: [], count: 0 }));
    const got = d.medals || {};
    const favs = d.favourites || [], made = d.made || [];
    const cards = list => (b => { b.className = 'pf-bcs'; return b; })(more(list, x => this.beatmapCard(x, own), 6));
    const maps = section('beatmaps', 'Beatmaps',
      sub('Favourite beatmaps', favs.length, favs.length ? cards(favs) : h('div.pf-empty', own ? 'No favourites yet — the heart on a beatmap in song select adds it here.' : 'No favourite beatmaps.')),
      sub('Created beatmaps', made.length, made.length ? cards(made) : h('div.pf-empty', own ? 'Nothing yet — beatmaps you make in the editor show here.' : 'No beatmaps yet.')));
    const medals = section('medals', 'Medals', sub('Medals', Medals.all.filter(m => got[m.id]).length, ...Medals.section(got)));
    const recent = d.recent || [];
    // lazer's Recent activity: what happened, newest first — medals unlocked, #1 ranks achieved
    const firsts = ((own ? this.ownFirsts : this.remote && this.remote.firsts) || { list: [] }).list || [];
    const acts = [
      ...Object.entries(got).filter(([, t]) => t).map(([id, t]) => { const m = Medals.all.find(x => x.id === id); return m && { at: +t, ic: m.icon, el: h('span', 'Unlocked the ', h('b', `"${m.name}"`), ' medal!') }; }),
      ...firsts.filter(x => x.date).map(x => ({ at: x.date, ic: 'crown', el: h('span', 'Achieved rank ', h('b.pf-act-rank', '#1'), ' on ', h('b', `${x.artist ? x.artist + ' - ' : ''}${x.title} [${x.version}]`)) })),
    ].filter(Boolean).sort((a, b) => b.at - a.at).slice(0, 50);
    const actRow = a => h('div.pf-act', h('span.pf-act-i', icon(a.ic)), a.el, h('span.pf-act-t', { title: new Date(a.at).toLocaleString() }, shortAgo(a.at)));
    const rec = section('recent', 'Recent',
      sub('Recent activity', null, acts.length ? (b => { b.className = 'pf-acts'; return b; })(more(acts, actRow, 6)) : h('div.pf-empty', 'No recent activity.')),
      sub('Recent plays', recent.length, recent.length
        ? more(recent, (x, i) => row(x, i, false))
        : h('div.pf-empty', 'No recent plays.')));
    let pinned = null; // (a clicked tab stays lit until you scroll yourself, even if its section can't reach the top)
    const tabs = h('div.pf-tabs', ...secs.map(([id, title, el]) => h('button.ov-tab', { onclick: () => { UISounds.click(); pinned = id; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); const sc = el.closest('.screen-body'); if (sc) settleOn(sc, () => el.scrollIntoView({ block: 'start' })); [...tabs.children].forEach((b, i) => b.classList.toggle('on', secs[i][0] === id)); } }, title.toLowerCase())));
    page.append(h('div.pf-header', top, centre, detail), tabs, hist, ranks, maps, medals, rec);
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
  scroller() { let sc = this.page; while (sc && sc !== document.body && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement; return sc && sc !== document.body ? sc : null; },
  /** Where to come back to: this profile, at this scroll position. */
  backParams() {
    const sc = this.scroller(), scroll = sc ? sc.scrollTop : 0, r = this.remote;
    return r ? { pid: r.pid, name: r.name, avatar: r.avatar, cache: r, scroll, force: true } : { scroll, force: true };
  },
  /** lazer's DrawableProfileScore: rank pill, title / artist, difficulty and date, mods, accuracy, and the pp in a
   *  sheared block on the right (with the weighting for best performance). */
  scoreRow(s, pp, weight = null, weighted = null) {
    return h(`button.pf-score${s.remote ? '.remote' : ''}`, { onclick: () => {
      UISounds.click();
      // (back from the score comes back here — this profile, scrolled where it was — not to song select)
      const back = { name: 'profile', params: this.backParams() };
      if (!s.remote) { Screens.go('results', { score: s, fromList: true, back }, { transition: 'right' }); return; }
      const r = this.remote || {};
      Screens.go('results', { score: { ...s, scoreStd: s.score, online: true, player: r.name, avatar: r.avatar, counts: s.counts || [0, 0, 0, 0, 0, 0], passed: s.passed !== false && s.grade !== 'F', replayId: null }, fromList: true, watched: 'online', back }, { transition: 'right' });
    } },
      rankPill(s.grade),
      h('div.main', h('div.t', s.title, h('span.a', ` by ${s.artist || ''}`)), h('div.s', h('span.v', s.version), h('span.d', fmtDate(s.date)))),
      h('span.pf-mods', ...(s.mods || []).map(m => ModSystem.badge(m, true))),
      // (no accuracy here: next to the weighting it read as the play's weight)
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
      const watch = () => { if (map) { UISounds.click(); Game.launch({ mapId: map.id, mode: 'replay', replay: r, back: { name: 'replays' } }); } };
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
    this._entering = true;
    this.side = h('div.side-list'); this.main = h('div');
    page.append(h('div.split', this.side, this.main));
    const onResize = () => { cancelAnimationFrame(this._fitRaf); this._fitRaf = requestAnimationFrame(() => this.fit()); };
    window.addEventListener('resize', onResize);
    this._unsub = [() => window.removeEventListener('resize', onResize), Bus.on('skins:changed', () => this.render()), Bus.on('skin:changed', () => this.render()),
      // customising the Custom skin redraws the preview (debounced: sliders send many changes)
      Bus.on('settings:changed', k => { if (!(k.startsWith('skin.c.') || k.startsWith('wom.') || ['skin.noteStyle', 'skin.hue', 'skin.darkerHolds', 'ui.theme'].includes(k)) || !this.preview || !this.previewSkin) return;
        clearTimeout(this._pvT); this._pvT = setTimeout(() => { this.previewSkin.layoutCache.clear(); this.preview.show(this.previewSkin, this.keys); }, 120); })];
    this.render();
    return el;
  },
  /** The preview fits under the header on a short screen (a phone held sideways) instead of running off the
   *  bottom, where its receptors were out of sight. */
  fit() {
    const pv = this._pv;
    if (!pv || !pv.isConnected) return;
    pv.style.height = ''; pv.parentElement.style.removeProperty('--sk-pv-h');
    const r = pv.getBoundingClientRect(), css = pv.offsetHeight, k = css ? r.height / css : 1;
    const room = (window.innerHeight - r.top - 12) / k;
    if (room < css) { const hh = Math.max(200, Math.floor(room)) + 'px'; pv.style.height = hh; pv.parentElement.style.setProperty('--sk-pv-h', hh); }
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
        // lazer's skin editor: move, scale and hide what's on screen while Auto plays (it edits the skin in use)
        h('button.btn.sk-edit', { title: 'Edit this skin\'s layout (Ctrl+Shift+S)', onclick: async () => { if (!inUse) await SkinManager.select(meta.id); SkinEditor.open(); } }, icon('edit'), 'Edit skin'),
        !meta.builtin ? h('button.btn.ghost', { onclick: () => SkinManager.exportOsk(meta.id) }, icon('download'), 'Export') : null,
        !meta.builtin ? h('button.btn.danger', { title: 'Delete skin', 'aria-label': 'Delete skin', onclick: async () => { if (await Dialog.confirm('Delete skin?', `${skin.name} will be removed.`, { ok: 'Delete', danger: true })) { await SkinManager.remove(meta.id); this.sel = SkinManager.current.id; } } }, icon('trash')) : null),
      h('div.sk-keys', h('span.muted', 'Preview'),
        h('button.sk-step', { 'aria-label': 'Fewer keys', disabled: this.keys <= 1, onclick: () => { this.keys = Math.max(1, this.keys - 1); this.render(); } }, icon('back')),
        h('span.sk-k', `${this.keys}K`),
        h('button.sk-step', { 'aria-label': 'More keys', disabled: this.keys >= MAX_KEYS, onclick: () => { this.keys = Math.min(MAX_KEYS, this.keys + 1); this.render(); } }, icon('chevron')),
        h('span.muted.sk-khint', meta.builtin ? '' : borrowed.includes(this.keys) ? "built from the skin's 4K layout" : supported.includes(this.keys) ? 'configured in skin.ini' : 'fallback layout')),
      meta.builtin ? h('div.sk-custom-wrap', pv, this.customPanel(true)) : pv,
      h('div.muted', { style: { marginTop: '10px', fontSize: '.85rem' } }, `by ${skin.author || 'unknown'}`));
    // (again once the screen's entrance animation has settled: it moves the page while it plays)
    this._pv = pv; requestAnimationFrame(() => this.fit()); clearTimeout(this._fitT); this._fitT = setTimeout(() => this.fit(), 500);
    this.preview && this.preview.stop();
    const pv1 = this.preview = new SkinPreview(canvas);
    this.previewSkin = skin;
    // (opening the screen: the preview starts once the screen has come in — loading the skin during the entrance cost
    // slow devices a dropped frame or two; picking another skin shows it straight away)
    const go = () => { if (this.preview === pv1) pv1.show(skin, this.keys); };
    if (this._entering) { this._entering = false; setTimeout(() => whenIdle(go), 250); } else requestAnimationFrame(go);
  },
};

// ─────────────────────────────── What's new ───────────────────────────────
/** Updates, newest first. Returning players see the newest entries they haven't seen once, after the game loads
 *  (osu!lazer shows its changelog after an update); new players start with everything marked as seen. */
// What's new: only what a player will notice, in a few words each (no behind-the-scenes changes)
const CHANGELOG = [
  { id: '2026.10.6', title: 'Smooth on every device', sections: [
    { icon: 'sparkle', title: 'Performance', items: ['The main menu, the beatmap listing and every screen run much lighter on slow devices (Chromebooks): no more freezes opening the beatmap library, a big library shows a page at a time, and pictures are made away from the main thread', 'On a slow device the menus switch to lighter effects by themselves, and remember it next time — Performance mode only lightens gameplay now, so the menus keep their looks', 'Gameplay lowers its resolution by itself when it stutters, not only when it\'s slow overall', 'With a panel open over the main menu, the logo pauses its beat bounce so the panel stays smooth'] },
    { icon: 'edit', title: 'Main menu', items: ['Edit → Beatmap: import beatmaps, extract them as .osz and edit your collections', 'Edit → Skin: preview and import skins, and Edit skin to change the layout of the one you use'] },
    { icon: 'user', title: 'Pictures and rankings', items: ['Sharper song cards and profile pictures', 'Ranked score is gone: rankings and profiles are by pp only', 'Total pp is worked out exactly as lazer does: your best play on each ranked beatmap, the top 1000 weighted 95% each step down, plus lazer\'s bonus pp for how many you\'ve set', 'Only ranked beatmaps count, checked by the server: the plays on every profile are looked up on osu!, and a game\'s own pp total is no longer taken on trust', 'Profiles show how the total adds up: the best plays, each weighted 95% of the one above it (as in lazer: 100%, 95%, 90%…), plus the bonus for how many ranked plays — and other players\' profiles list only the plays checked to be ranked', 'Nobody drops off the rankings when the rules change: everyone is re-checked in the background, online or not'] },
    { icon: 'chat', title: 'Phones', items: ['Sending a chat message puts the keyboard away, and the typing bar shows where your message goes', 'The installed app goes properly fullscreen on your first tap, and back to fullscreen after the phone\'s own panels (like Samsung\'s pull-down) — no more status bar or black strip by the camera', 'Playing sideways on a phone shows the skin\'s own health bar beside the stage, as on a computer (upright keeps the bar along the top)', 'The phone\'s Back button or swipe works like Esc, as in lazer on Android: it closes what\'s open, pauses a song and goes back a screen, instead of leaving the game', 'The pause menu is no longer covered by the replay controls when watching Auto or a replay', 'The install-the-app box fits a phone held sideways, Don\'t remind me again included', 'Hints and messages no longer tell you to press keys (Ctrl+O, F3, Esc…) on a phone, where there are none'] },
    { icon: 'film', title: 'Spectating', items: ['Watching someone play stays much closer to them: about half a second behind instead of a second and a half', 'Watching a player on a phone or tablet shows their taps instead of a mouse pointer', 'The pointer of the player you watch keeps its real shape (it was squashed)'] },
    { icon: 'brush', title: 'Skins', items: ['The skin preview fits the screen on a phone held sideways, so you can see notes reach the keys', 'On a narrow screen the Customise panel puts each control under its name instead of squeezing the text'] },
    { icon: 'edit', title: 'Editor', items: ['Opening the editor while its song plays in the menu stops it where it is, as lazer does (it kept running under a paused play button)'] },
    { icon: 'sparkle', title: 'Animations', items: ['Menus unroll as they open and fade as they close, like lazer\'s', 'Tooltips trail the pointer and fade in and out as in lazer', 'Buttons squeeze while held, spring back when let go and flash when clicked (lazer\'s OsuButton)', 'Settings switches are lazer\'s: a pill that springs out and fills when turned on', 'Mod select\'s columns fly in one after another from above and below, and a mod\'s switch widens as it turns on', 'Song select: the selected difficulty\'s glow pulses with the music (the open set\'s every other beat), and it flashes as the song starts', 'The loading screen comes in and goes out as lazer\'s: the song details grow in from 70% and shrink away, the side panels slide in and out', 'Notifications slide in with a flash and can be dragged: throw one left to get rid of it, let go and it springs back', 'Tabs (profile, dashboard, rankings) have lazer\'s springy underline', 'Pop-up questions bounce open and shrink away like lazer\'s', 'The pause menu\'s buttons narrow while held and flash when picked', 'A soft hover sound on every button, tab and list entry, each a touch different in pitch, as in lazer', 'Song select: the star rating runs to its new value (with its colour) when the difficulty or mods change, and the difficulty bars slide to theirs', 'Results: the timing distribution\'s bars grow up into place when the statistics open', 'Loading spinners are lazer\'s: a broken circle that pops in and turns a quarter at a time', 'Beatmap listing: a new search dims the old results until the new ones fade in, instead of blanking the page', 'The multiplayer lounge slides in like the other overlays', 'Settings: a row glows up from the bottom as you flip a switch or let go of a slider (lazer\'s commit flash), and the slider\'s nub brightens under the pointer', 'Dashboard: the list of players fades in when you change tab, filter, sort or view', 'Text boxes: letters you delete drop out of the box and fade, as in lazer']},
    { icon: 'online', title: 'Spectating and chat', items: ['Spectating a song you don\'t have: their play shows straight away while it downloads, and the music, background and video come in where the play is once it\'s installed', '#lobby chat no longer empties when you lose connection or the server restarts, and your chats are kept when you reload', 'Getting back online after a dropped connection no longer tells you each of your friends just came online', 'Being spectated no longer makes your song stutter as it starts', 'Friends\' "Last seen" is when they actually went offline (the server keeps it), and times read right: an hour and a half is "1h ago", long ago reads in months and years', 'Daily challenge scores on older beatmaps count now, and if one ever isn\'t counted the game tells you why', 'Performance mode now means the whole game at its lightest: no menu animations, blur, glass, glow, parallax or moving visualiser, and no blurred backgrounds to prepare (the setup\'s Performance choice still keeps the menus looking their best)', 'Beatmap listing on the slowest devices: one small picture per song instead of two big ones, fewer loaded ahead, and flat cards', 'Team Versus from the lounge: Create room asks Head to Head or Team Versus (red against blue), and the lounge shows each room\'s match type and what wins it'] },
    { icon: 'list', title: 'Fixes', items: ['Profiles no longer list first places with no song name (empty "by" rows)', 'No menu button in the corner when a song starts on a computer (Esc pauses)', 'Beatmap listing: songs stay on screen however fast you scroll — the list keeps two screens of songs ready either way and loads covers five screens ahead', 'Settings switches that are on no longer show a box around them'] },
    { icon: 'sparkle', title: 'Icons', items: ['Every icon is lazer\'s own now: the top bar, main menu, settings sections and song select use lazer\'s icon set, and everything else uses the same Font Awesome icons lazer does (retry, collections, favourites, close…)'] },
    { icon: 'music', title: 'Song select', items: ['The leaderboard starts on Global, as in lazer (Local is still a tap away under Scope)'] },
    { icon: 'list', title: 'Smoother menus', items: ['Back from a score opened on a profile goes back to that profile (where you were on it), not to song select', 'A score on a beatmap you don\'t have shows that beatmap\'s cover instead of the song you\'re listening to — and a Download button to get it', 'Someone else\'s score shows the pp their profile lists', 'Profiles no longer show accuracy beside each play, where it looked like the play\'s weighting', 'Back after a daily challenge play, or a replay watched from Replays, goes back there; retrying a daily challenge play still counts for it', 'Fixed a crash: retrying from the results screen and then pressing Back could reopen an empty results screen', 'Back to a player\'s profile reopens theirs, not yours', 'The beatmap listing has a back button like every other page, and lines up with them'] },
    { icon: 'calendar', title: 'Daily challenge', items: ['A new daily challenge starts at midnight US Central time'] },
    { icon: 'sparkle', title: 'Changelog', items: ['After an update, this shows just what\'s new in it (every update is still in Settings → What\'s new)'] },
  ] },
  { id: '2026.10.5', title: 'Editors', sections: [
    { icon: 'edit', title: 'Beatmap editor', items: ['New, like lazer\'s Compose screen: place notes and hold notes snapped to the beat (1/1 to 1/16, coloured as in lazer), move, select and delete them', 'Play the song at 25–100% speed, seek on the timeline, undo and redo', 'Save into your library and Test (F5) — you come back to the editor after', 'Open it from Edit in song select\'s beatmap options', 'Setup: the song\'s details, key count, HP and OD, and Create new difficulty (a copy, or blank)', 'Timing: add, move and change timing points (BPM and meter)', 'Copy, cut and paste notes (Ctrl+C / X / V)', 'New beatmap from a song: pick a song file and start mapping', 'The song\'s waveform behind the timeline', 'Verify: lazer\'s checks (overlapping and unsnapped notes, drain time, background, preview point, metadata) — click one to go to it', 'Bookmarks (Ctrl+B, Ctrl+Shift+B, jump with Ctrl+Alt+← / →), kiai time and the preview point, shown on the timeline', 'Timing: tap along to the song (T) to find its BPM and offset, a metronome, and ±1 / ±10 ms nudges', 'Setup: choose the background; the title, artist and other details change for every difficulty in the set (they no longer split it in two)', 'File › Export package (.osz)', 'Flip (Ctrl+H) and reverse (Ctrl+J) the selected notes, move them between columns with ← / →', 'Ctrl+Shift+C copies a timestamp; timestamps in chat are links that take the editor there'] },
    { icon: 'brush', title: 'Skin editor', items: ['New, like lazer\'s (Ctrl+Shift+S, or Settings → Skin → Skin layout editor): the game shrinks with Auto playing, and you drag the score, health, progress, hit error meter, judgement counter and leaderboard where you want them', 'Drag a corner to scale one, hide the ones you don\'t want, undo with Ctrl+Z — every play uses your layout', 'Skins (main menu → Edit → Skin) has Edit skin, which opens it on the skin you use'] },
    { icon: 'list', title: 'User tags', items: ['New, like lazer: after passing a beatmap, vote on what it is (jumpstream, long notes, technical…) on the results screen', 'Song select shows the tags players voted for in the beatmap\'s details'] },
    { icon: 'sparkle', title: 'Screenshots', items: ['F12 saves a screenshot, like lazer — click the notification to see it (in the menus the browser asks to capture the tab the first time)'] },
    { icon: 'music', title: 'Song select', items: ['Beatmap options: Hide a difficulty, Restore all hidden and Clear local scores, like lazer', 'Details show the user rating and points of failure for beatmaps from osu!'] },
    { icon: 'user', title: 'Your status', items: ['Right-click your name in the top bar: Online, Do not disturb (no invites or pop-ups) or Appear offline (nobody sees you online or can spectate you), like lazer'] },
    { icon: 'film', title: 'Spectating', items: ['Spectate anyone who\'s online, not just friends', 'Watching someone in the menus is live: their screen at their size, their scrolling and their cursor', 'Esc stops spectating, and your keys don\'t touch your own menus while you watch'] },
    { icon: 'film', title: 'Storyboards', items: ['Beatmaps\' storyboards now play behind the stage, like lazer (Settings → Gameplay → Storyboard / video)', 'Beatmaps imported before this need importing again to bring their storyboard pictures in'] },
    { icon: 'chat', title: 'Multiplayer', items: ['The room\'s chat shows in the corner during a match, like lazer', 'Room settings: Auto start (the match starts with whoever is ready when the countdown ends) and Auto skip', 'Chat commands: /me, /np (shares what you\'re listening to or playing) and /help', 'Storyboards wait for their outro at the end of a song, with Skip outro'] },
    { icon: 'mods', title: 'Mods', items: ['Cinema: Auto with only the background showing', 'Wind Up and Wind Down (Fun): the song speeds up to 1.5× or slows to 0.75× as it plays', 'Adaptive Speed (Fun): hit early and the song speeds up, late or miss and it slows down'] },
    { icon: 'trophy', title: 'Online', items: ['The beatmap page in the listing shows each difficulty\'s global ranking, even before you download it', 'After a play, the results show where it ranks globally on that beatmap', 'Only ranked beatmaps count toward pp, in your profile and the rankings', 'Rankings no longer show accuracy', 'Rooms survive the server restarting', 'Your background dim and blur are kept', 'A hitch while playing can no longer make the server turn your play down', 'Players who leave the game open and walk away now show as offline after 10 minutes (back the moment they press a key), instead of looking online', 'No more pinch or double-tap zooming on phones and tablets (in the app and the browser)', 'Text boxes no longer get a yellow outline when you type in them', 'The main menu\'s Edit has Beatmap (import beatmaps, extract them as .osz and edit collections) and Skin (preview and import skins, and Edit skin to change the layout of the one you use)', 'Playlists are gone', 'pp counts only ranked beatmaps — and now finds out reliably which of yours are ranked: beatmaps whose files don\'t say which set they\'re from are looked up by their file, and a lookup that failed is tried again (before, it could leave a ranked beatmap giving 0pp for good)', 'Profiles\' best performance lists only plays on ranked beatmaps', 'Settings → Gameplay → HUD overlay visibility mode, like lazer: Always, Hide during gameplay (shown before the first note, in breaks and when paused) or Never; hold Ctrl to peek', 'Song select\'s "N matches" counts songs, not each difficulty', 'Overlays (rankings, profile, beatmap listing, …) open with lazer\'s coloured waves sweeping up', 'Phones: chat messages send — the keyboard\'s Send key and the bar\'s button (it was only closing the keyboard)', 'Phones: two fingers up or down change the volume (not mid-song)', 'Song select groups by key count by default', 'Profiles have lazer\'s Beatmaps section: favourite beatmaps and the ones you made in the editor, as cards', 'Multiplayer: players who\'ve finished the song show as finished, with their score, straight away — not "still playing" until everyone\'s play has been checked', 'Settings → User Interface → Main Menu → Background source, like lazer: the triangles (Skin) or the playing song\'s background (Beatmap)', 'Profiles: score lists start with five and grow with "show more", and Recent has lazer\'s activity feed (medals unlocked, #1 ranks achieved)'] },
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
    this.show(CHANGELOG.slice(0, 1)); // (only the latest update — the whole history is in Settings)
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
