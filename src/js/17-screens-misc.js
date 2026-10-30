/* Beatmaps library, Collections, Profile (with statistics), Replays and Skins screens. */

/** A page laid out like an osu!lazer overlay (OverlayHeader): a title band in the overlay's Dark5 with its icon and
 *  lowercase title, the actions on the right, optional tabs on Dark4 underneath, then the body in Background5.
 *  `hue` picks the overlay colour scheme (lazer: Blue 200, Pink 333, Plum 320, Orange 45, Aquamarine 160, …). */
const OVERLAY_HUES = { red: 0, orange: 45, lime: 90, green: 125, aquamarine: 160, blue: 200, purple: 255, plum: 320, pink: 333 };
/** lazer's OverlayHeader: its icon and title on the title bar (the description is only the title's tooltip, as lazer
 *  keeps it for the toolbar's), then the tabs. */
function overlayHeader(title, { icon: ic = 'star', sub = null, actions = [], tabs = null } = {}) {
  return h('div.ov-head',
    h('div.ov-titlebar', h('div.ov-inner',
      h('span.ov-icon', icon(ic)), h('h1', sub ? { title: sub } : {}, title), h('div.grow'), ...actions)),
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
/** The beatmaps you have on your other devices — the ones installed there, and the ones your plays are on — that this
 *  one hasn't got: pick the ones to install (all, or a few), and they download three at a time. */
const AccountBeatmaps = {
  /** What can be installed: your account's list, then the beatmaps your plays are on, each once. */
  list() {
    if (typeof Sync === 'undefined' || !Account.linked() || Account.signedOut()) return [];
    const out = new Map();
    for (const s of [...Sync.accountMissing(), ...Sync.missingSets()]) if (s.id > 0 && !out.has(s.id)) out.set(s.id, s);
    return [...out.values()];
  },
  open() {
    const all = this.list();
    if (!all.length) { Toast.show('You have them all', 'Every beatmap from your other devices is on this one too.'); return; }
    const picked = new Set(), cards = new Map();
    const count = h('span.ab-count'), q = h('input.input.ab-q', { placeholder: 'Search your beatmaps…', 'aria-label': 'Search your beatmaps' });
    const go = h('button.btn.primary.ab-go', { onclick: () => { if (!picked.size) return; const sets = all.filter(s => picked.has(s.id)); o.close(); Sync.getSets(sets); } });
    const allBtn = h('button.btn.sm.ab-all', { onclick: () => { UISounds.click(); const shown = all.filter(s => !cards.get(s.id).hidden); const every = shown.every(s => picked.has(s.id)); for (const s of shown) (every ? picked.delete(s.id) : picked.add(s.id)); paint(); } });
    const grid = h('div.ab-grid');
    const paint = () => {
      for (const [id, el] of cards) el.classList.toggle('on', picked.has(id));
      const shown = all.filter(s => !cards.get(s.id).hidden);
      allBtn.textContent = shown.length && shown.every(s => picked.has(s.id)) ? 'Select none' : 'Select all';
      count.textContent = picked.size ? `${fmtInt(picked.size)} of ${fmtInt(all.length)} picked` : `${fmtInt(all.length)} beatmap${all.length === 1 ? '' : 's'}`;
      go.disabled = !picked.size; go.textContent = picked.size ? `Install ${fmtInt(picked.size)}` : 'Install';
    };
    // (each a little card: its cover, title, artist and mapper; click to pick it — covers load as they come on screen)
    const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); const id = Number(e.target.dataset.id), img = e.target.querySelector('.ab-img'); OnlineBeatmaps.loadCover(img, id, ['list@2x', 'list'], () => img.classList.add('loaded')); } }, { root: grid, rootMargin: '200px' });
    for (const s of all) {
      const el = h('button.ab-card', { dataset: { id: String(s.id) }, 'aria-pressed': 'false', onclick: () => { UISounds.click(); if (picked.has(s.id)) picked.delete(s.id); else picked.add(s.id); el.setAttribute('aria-pressed', String(picked.has(s.id))); paint(); } },
        // (a tinted square with a note until its cover comes — or for good, offline)
        h('span.ab-thumb', { style: { '--ab-h': (s.id * 47) % 360 } }, icon('music'), h('i.ab-img')), h('span.ab-txt', h('b', s.title || `Beatmap ${s.id}`), h('span', s.artist || ''), s.creator ? h('small', `mapped by ${s.creator}`) : null), h('span.ab-check', icon('check')));
      cards.set(s.id, el); grid.append(el); io.observe(el);
    }
    q.addEventListener('input', () => { const t = q.value.trim().toLowerCase(); for (const s of all) cards.get(s.id).hidden = !!t && !`${s.title} ${s.artist} ${s.creator}`.toLowerCase().includes(t); paint(); });
    q.addEventListener('keydown', typingKeys);
    const body = h('div.ab', h('p.ab-sub', 'On your other devices and not on this one. Pick the ones you want here.'), h('div.ab-bar', q, allBtn), grid,
      h('div.ab-foot', count, h('span.grow'), h('button.btn.ghost', { onclick: () => o.close() }, 'Close'), go));
    const o = Dialog.custom('Your beatmaps', body);
    const close = o.close; o.close = () => { io.disconnect(); close(); };
    paint();
    setTimeout(() => q.focus({ preventScroll: true }), 60);
  },
};

/** A beatmap card's square for a set with no background picture: a note in it, rather than an empty square that looks
 *  like a picture still loading. */
function noPicture(thumb) { thumb.classList.add('ex-nopic', 'loaded'); thumb.append(icon('music')); }

const BeatmapsScreen = {
  q: '',
  enter() {
    this.mineBtn = h('button.btn.lib-mine', { onclick: () => AccountBeatmaps.open() });
    const { el, page } = pageShell('Beatmap library', null, [
      this.mineBtn,
      h('button.btn', { onclick: () => Screens.go('collections') }, icon('folder'), 'Collections'),
      h('button.btn', { onclick: () => importViaPicker('', true) }, icon('folder'), 'Import folder'),
      h('button.btn.primary', { onclick: () => importViaPicker('.osz,.osu,.osk,.osr,.amr,.json,.mp3,.ogg,.wav,.jpg,.jpeg,.png') }, icon('upload'), 'Import files'),
    ], { icon: 'music', hue: 'blue' });
    this.page = page;
    this.summary = h('div.lib-summary');
    const search = h('input.input', { type: 'search', placeholder: 'type to search', 'aria-label': 'Search your beatmaps', value: this.q });
    search.addEventListener('input', () => { this.q = search.value.toLowerCase(); this.renderList(); });
    search.addEventListener('keydown', e => searchBoxKey(e, () => { this.q = ''; this.renderList(); }));
    this.list = h('div.ex-grid.lib-grid', { style: { '--o-h': OVERLAY_HUES.blue } });
    this.report = h('div');
    // while the list scrolls, the cards passing under the pointer don't react to it (as in the beatmap listing); they
    // do again a moment after it stops
    const shield = h('div.lib-shield');
    page.classList.add('lib-page');
    // (the magnifier in the box, as the other search boxes have)
    page.append(this.report, h('div.row', { style: { margin: '0 0 12px' } }, h('label.lib-search', icon('search'), search), h('span.grow'), this.summary), this.list, shield);
    let still = 0;
    const sc = this._scroller = el.querySelector('.screen-body');
    sc.classList.add('lib-body');
    // (as in the beatmap listing: cards stop reacting to the pointer while the list moves — see ExplorerScreen.frame)
    const grid = this.list, moving = on => { shield.classList.toggle('on', on); grid.classList.toggle('moving', on); };
    sc.addEventListener('scroll', () => { if (!still) moving(true); clearTimeout(still); still = setTimeout(() => { still = 0; moving(false); }, 160); this.schedule(); }, { passive: true });
    // (the list's columns, row height and where it starts are measured again only when something changes size: the
    // window, the import report above it — never while it scrolls)
    this._ro = new ResizeObserver(es => { const g = es.find(e => e.target === this.list); if (es.some(e => e.target !== this.list) || (g && g.contentRect.width !== this._gw)) { if (g) this._gw = g.contentRect.width; this._mDirty = true; this.schedule(); } });
    for (const t of [sc, this.report, this.list]) this._ro.observe(t);
    this._cards = new Map(); this._details = new Map(); this._open = new Set();
    this._unsub = [Bus.on('library:changed', () => this.refresh()), Bus.on('import:report', () => this.renderReport()), Bus.on('accountsets:changed', () => this.refresh()), Bus.on('scores:changed', () => this.paintMine())];
    this.refresh();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); this._ro && this._ro.disconnect(); cancelAnimationFrame(this._fr); this._fr = 0; },
  async refresh() {
    // (the cards are built again: a set's difficulties, favourite or status can have changed)
    this._cards = new Map(); this._details = new Map();
    this.paintMine(); this.renderSummary(); this.renderList(); this.renderReport();
  },
  /** "Your beatmaps (n)": the ones on your other devices that aren't here — shown only when there are any. */
  paintMine() {
    if (!this.mineBtn) return;
    const n = AccountBeatmaps.list().length;
    this.mineBtn.hidden = !n;
    clearEl(this.mineBtn).append(icon('download'), 'Your beatmaps', h('span.lib-mine-n', fmtInt(n)));
  },
  async renderSummary() {
    const maps = [...BeatmapManager.maps.values()];
    const broken = maps.filter(m => m.problems.length).length;
    const est = await DB.estimate();
    clearEl(this.summary).append(`${plural(BeatmapManager.sets.length, 'set')} · ${plural(maps.length, 'difficulty', 'difficulties')}${broken ? ` · ${broken} unplayable` : ''}${est ? ` · game storage ${fmtBytes(est.usage || 0)}` : ''}`);
    // (the whole game's storage, not the beatmaps' alone: an empty library still has skins and the like)
    this.summary.title = est ? 'Everything the game keeps on this device: beatmaps, skins, replays and the rest' : '';
  },
  renderReport() {
    clearEl(this.report);
    const r = App.lastReport;
    if (!r) return;
    const lines = [...r.errors.map(e => h('li.err', e)), ...r.warnings.map(w => h('li', w))];
    if (!lines.length) return;
    // (one calm notice: a warning icon in the import's colour, what went wrong as a list, and a close button)
    this.report.append(h(`div.lib-report${r.errors.length ? '.has-err' : ''}`,
      h('div.lib-report-ico', icon('warn')),
      h('div.lib-report-body', h('b', 'Last import: problems found'), h('ul', ...lines)),
      h('button.lib-report-x', { title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => { UISounds.click(); App.lastReport = null; this.renderReport(); } }, icon('x'))));
  },
  renderList() {
    clearEl(this.list);
    this.list.style.paddingTop = this.list.style.paddingBottom = '';
    const sets = BeatmapManager.sets.filter(s => !this.q || `${s.artist} ${s.title} ${s.creator} ${s.tags}`.toLowerCase().includes(this.q))
      .sort((a, b) => b.added - a.added);
    this._sets = sets; this._range = null;
    if (!sets.length) {
      const mine = AccountBeatmaps.list().length;
      this.list.append(BeatmapManager.sets.length ? stateCard('search', 'No matches', 'Nothing in your library matches that search.', { cls: '.plain', neru: true })
        : mine ? stateCard('beatmap', 'No beatmaps on this device yet', `You have ${plural(mine, 'beatmap')} on your other devices.`, { cls: '.plain', neru: true, action: h('button.btn.primary.off-act', { onclick: () => { UISounds.click(); AccountBeatmaps.open(); } }, icon('download'), 'Show your beatmaps') })
        : stateCard('beatmap', 'No beatmaps yet', kbHint('Drop .osz archives or beatmap folders anywhere on the window, or get some from the beatmap listing.', 'Import .osz files from your device, or get some from the beatmap listing.'), { cls: '.plain', neru: true, action: h('button.btn.primary.off-act', { onclick: () => { UISounds.click(); Screens.go('explore'); } }, icon('search'), 'Browse online') }));
      return;
    }
    this._mDirty = true;
    this.renderWindow();
    // (once more after layout: the columns and the row height are only known then)
    requestAnimationFrame(() => requestAnimationFrame(() => { this._mDirty = true; this.renderWindow(); }));
  },
  schedule() { if (!this._fr) this._fr = requestAnimationFrame(() => { this._fr = 0; this.renderWindow(); }); },
  /** The grid's columns, the distance from one row of cards to the next (with the gap), where it starts in the list and
   *  how much of it shows. */
  measure() {
    const grid = this.list, sc = this._scroller, cs = getComputedStyle(grid);
    const cols = Math.max(1, cs.gridTemplateColumns.split(' ').filter(Boolean).length), gap = parseFloat(cs.rowGap) || 0;
    const card = grid.querySelector(':scope > .lib-card');
    let top = 0;
    for (let e = grid; e && e !== sc; e = e.offsetParent) { top += e.offsetTop; if (e.offsetParent && !sc.contains(e.offsetParent) && e.offsetParent !== sc) { top -= sc.offsetTop; break; } }
    this._mDirty = !(card && card.offsetHeight && sc.clientHeight); // (not laid out yet: asked again)
    return { cols, gap, rowH: ((card && card.offsetHeight) || 100) + gap, top, vh: sc.clientHeight || innerHeight };
  },
  /** Where each row of cards starts — and the tables of difficulties opened under them, in between. */
  layout() {
    const sets = this._sets || [], { cols, rowH, gap } = this._m, rows = [];
    let y = 0;
    for (let i = 0; i < sets.length; i += cols) {
      const row = { i, y, open: [] };
      y += rowH;
      for (const set of sets.slice(i, i + cols)) {
        if (!this._open.has(set.id)) continue;
        const d = this._details.get(set.id);
        row.open.push(set); y += (d && d._h ? d._h : 46 + 37 * (set.maps.length + 1)) + gap;
      }
      rows.push(row);
    }
    this._rows = rows; this._end = y;
  },
  /** Only the cards near the screen are in the page; the rest of the list is just space above and below them. What's
   *  on screen (and a little either side) goes in at once; a few screens either side join a couple of rows at a time
   *  while nothing else is going on, so scrolling through them costs nothing more; past that they're let go. A library
   *  of thousands scrolls as lightly as one of a hundred — every card ever scrolled past used to stay in the page, and
   *  each one made every frame of scrolling a little heavier. */
  renderWindow(grow = false) {
    const grid = this.list, sets = this._sets || [], sc = this._scroller;
    if (!grid || !sc || !sets.length || !grid.isConnected) return;
    if (this._mDirty !== false || !this._m) { const c = this._m && this._m.cols; this._m = this.measure(); this._layoutDirty = true; if (c !== this._m.cols) this._range = null; }
    if (this._layoutDirty) { this._layoutDirty = false; this.layout(); }
    const { cols, top, vh } = this._m, rows = this._rows;
    let from = 0, to = rows.length;
    if (sets.length > cols * 12) {
      const lite = document.documentElement.classList.contains('perf') || document.documentElement.classList.contains('slow');
      const st = sc.scrollTop - top;
      const after = y => { let lo = 0, hi = rows.length; while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m].y < y) lo = m + 1; else hi = m; } return lo; };
      const band = k => { const a = Math.max(0, after(st - vh * k) - 1); return [a, Math.max(a + 1, after(st + vh + vh * k))]; };
      const show = band(0.5), keep = band(lite ? 3 : 4), drop = band(lite ? 5 : 6);
      const cur = this._range;
      // (jumped somewhere else — the scrollbar dragged, a search: what's in the page now is no help)
      if (!cur || cur[1] <= show[0] || cur[0] >= show[1] || cur[1] > rows.length) [from, to] = show;
      else { from = Math.max(drop[0], Math.min(cur[0], show[0])); to = Math.min(drop[1], Math.max(cur[1], show[1])); }
      // (a row or two more either side each time the page has a moment, up to a few screens)
      if (grow) { const n = lite ? 1 : 2; from = Math.max(keep[0], from - n); to = Math.min(keep[1], to + n); }
      if (from > keep[0] || to < keep[1]) { if (!this._growing) { this._growing = true; whenIdle(() => { this._growing = false; if (Screens.current === this) this.renderWindow(true); }); } }
    }
    this._range = [from, to];
    const pt = from ? `${rows[from].y}px` : '', pb = to < rows.length ? `${this._end - rows[to].y}px` : '';
    if (grid.style.paddingTop !== pt) grid.style.paddingTop = pt;
    if (grid.style.paddingBottom !== pb) grid.style.paddingBottom = pb;
    const shown = [];
    for (let r = from; r < to; r++) {
      for (const set of sets.slice(rows[r].i, rows[r].i + cols)) shown.push(this.cardEl(set));
      for (const set of rows[r].open) shown.push(this.detailsEl(set));
    }
    // change only what differs: the cards that left go, the ones that came in are put in their places
    const want = new Set(shown);
    for (const k of [...grid.children]) if (!want.has(k)) k.remove();
    let at = grid.firstElementChild;
    for (const c of shown) {
      if (c === at) { at = at.nextElementSibling; continue; }
      grid.insertBefore(c, at);
    }
  },
  /** A set's card, built the first time it comes near the screen (and kept for when it comes back). */
  cardEl(set) {
    let c = this._cards.get(set.id);
    if (!c) { c = this.row(set); this._cards.set(set.id, c); }
    c.classList.toggle('open', this._open.has(set.id));
    return c;
  },
  /** Its table of difficulties, under the row it's in. */
  detailsEl(set) {
    let d = this._details.get(set.id);
    if (d) return d;
    const maps = [...set.maps].sort((a, b) => a.keys - b.keys || a.stars - b.stars);
    d = h('div.lib-details',
      h('table.table', h('tr', h('th', 'Difficulty'), h('th', 'Keys'), h('th', 'Stars'), h('th', 'Notes / LNs'), h('th', 'Length'), h('th', 'Status')),
        ...maps.map(m => h('tr', h('td', m.version), h('td', m.keys + 'K'), h('td', h('span.lib-star', { style: { '--sc': starColour(m.stars) } }, icon('star'), m.stars.toFixed(2))), h('td', `${m.noteCount} / ${m.lnCount}`), h('td', fmtTime(m.length)),
          h('td', m.problems.length ? h('span', { style: { color: '#ffb3bb' } }, m.problems.join('; ')) : m.warnings.length ? h('span.muted', m.warnings.join('; ')) : h('span', { style: { color: 'var(--good)' } }, 'OK'))))),
      h('div.muted.lib-files', `Added ${fmtDate(set.added)} · files stored: ${Object.keys(set.fileIndex).length}${set.storyboard ? ' · storyboard' : ''}${set.video ? ' · video skipped' : ''} · source: ${set.sourceName || '—'}`));
    // (its height, once it's laid out, for the space it takes when it's scrolled away)
    new ResizeObserver(es => { const hh = es[0].borderBoxSize?.[0]?.blockSize ?? es[0].contentRect.height; if (hh && Math.abs(hh - (d._h || 0)) > 0.5) { d._h = hh; this._layoutDirty = true; this.schedule(); } }).observe(d);
    this._details.set(set.id, d);
    return d;
  },
  /** A card clicked (or Enter on it): its difficulties open underneath, across the whole row — or close. */
  toggle(set) {
    UISounds.click();
    if (this._open.has(set.id)) this._open.delete(set.id);
    else { this._open.add(set.id); const d = this.detailsEl(set); d.classList.add('lib-in'); setTimeout(() => d.classList.remove('lib-in'), 400); }
    this._layoutDirty = true;
    this.renderWindow();
  },
  /** Pictures that came in, put on their cards together a few times a second: one at a time, each redrew the whole
   *  list again — over and over while a page of rows was loading on a slow device. */
  showThumb(els, u) {
    (this._thumbs || (this._thumbs = [])).push([els, u]);
    if (!this._thumbT) this._thumbT = setTimeout(() => {
      this._thumbT = 0;
      for (const [list, url] of this._thumbs.splice(0)) for (const el of list) { el.style.backgroundImage = `url("${url}")`; el.classList.add('loaded'); PicWait.done(el); }
    }, 100);
  },
  /** One beatmap set as lazer's beatmap card (as in the beatmap listing): the cover faded behind, its picture on the
   *  left, title, artist and mapper, the difficulties as coloured bars, and Play / Extract / Delete sliding in on the
   *  right on hover. Clicking it opens its difficulties underneath, across the whole row. */
  row(set) {
    const thumb = h('div.ex-thumb'), bg = h('div.ex-cardbg');
    PicWait.add(thumb); // (the wheel waits for it — see PicWait)
    BeatmapManager.thumbURL(set).then(u => { if (u) this.showThumb([thumb, bg], u); else { PicWait.done(thumb); noPicture(thumb); } }, () => PicWait.done(thumb));
    const maps = [...set.maps].sort((a, b) => a.keys - b.keys || a.stars - b.stars);
    const broken = maps.filter(m => m.problems.length);
    const keys = [...new Set(maps.map(m => m.keys))].sort((a, b) => a - b);
    const len = Math.max(0, ...maps.map(m => m.length || 0));
    const title = Settings.get('ui.unicodeMetadata') && set.titleUnicode ? set.titleUnicode : set.title;
    const artist = Settings.get('ui.unicodeMetadata') && set.artistUnicode ? set.artistUnicode : set.artist;
    const playable = maps.find(m => !m.problems.length) || maps[0];
    const spectrum = maps.length > 10
      ? h('span.ex-spec-more', h('i', { style: { '--sc': starColour(Math.max(...maps.map(m => m.stars))) } }), `${maps.length}`)
      : h('span.ex-spec', ...maps.map(m => h('i', { style: { '--sc': m.problems.length ? '#555' : starColour(m.stars) }, title: `[${m.version}] ${m.stars.toFixed(2)}★ ${m.keys}K` })));
    const toggle = () => this.toggle(set);
    const side = (cls, ic, label, fn) => h(`button.ex-side-btn${cls}`, { title: label, 'aria-label': label, onclick: e => { e.stopPropagation(); e.currentTarget.blur(); fn(); } }, icon(ic));
    const card = h('div.ex-card.lib-card', { tabindex: '0', role: 'button', 'aria-label': `${artist} - ${title}`, onclick: toggle,
      onkeydown: e => { if (e.key === 'Enter') { e.stopPropagation(); toggle(); } } },
      bg, h('div.ex-cardshade'),
      h('div.ex-thumbwrap', thumb),
      h('div.ex-cb',
        h('div.ex-cb-top', h('div.ex-titles', h('div.ex-t', { title }, h('span.ex-tt', title)), h('div.ex-a', { title: artist }, artist)),
          Favorites.has(set.id) ? h('span.lib-fav', { title: 'Favourite' }, icon('heart', 'fill')) : null),
        h('div.ex-m', 'mapped by ', h('b', set.creator)),
        h('div.ex-foot',
          broken.length ? h('span.ex-statuspill.lib-broken', { title: broken.map(m => `[${m.version}] ${m.problems.join('; ')}`).join('\n') }, `${broken.length} UNPLAYABLE`) : null,
          spectrum,
          h('span.ex-keys', keys.length > 3 ? `${keys[0]}–${keys[keys.length - 1]}K` : keys.map(k => k + 'K').join(' ')),
          h('span.grow'),
          h('span.ex-length', flatIcon('clock', 0.6), fmtTime(len)))),
      h('div.ex-side',
        side('.play', 'play', 'Play', () => Screens.go('songselect', { mapId: playable.id })),
        side('', 'download', 'Extract (.osz)', () => BeatmapManager.exportOsz(set.id)),
        side('.del', 'trash', 'Delete', () => SongSelect.deleteSet(set))));
    card.addEventListener('pointerenter', () => UISounds.hover());
    return card;
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
    // (opened on the first collection with beatmaps in it, not an empty one, when none was picked yet)
    if (!this.sel || !Collections.get(this.sel)) this.sel = (Collections.list.find(c => c.hashes.length) || Collections.list[0])?.id || null;
    clearEl(this.side);
    for (const c of Collections.list) {
      this.side.append(h(`button.side-item${c.id === this.sel ? '.active' : ''}`, { onclick: () => { this.sel = c.id; UISounds.click(); this.render(); } },
        icon('folder'), c.name, h('span.cnt', String(c.hashes.length))));
    }
    const favCount = BeatmapManager.sets.filter(s => Favorites.has(s.id)).length;
    if (favCount) this.side.append(h('div.muted', { style: { fontSize: '.8rem', padding: '10px 4px' } }, `♥ ${favCount} favourite set${favCount === 1 ? '' : 's'} — filter them in song select.`));
    clearEl(this.main);
    const c = Collections.get(this.sel);
    if (!c) { this.main.append(stateCard('folder', 'No collections', 'Create one to start organizing.', { cls: '.plain', neru: true })); return; }
    this.main.append(h('div.row', { style: { marginBottom: '14px' } }, h('h2', { style: { margin: 0, fontWeight: 900 } }, c.name), h('span.grow'),
      h('button.btn', { disabled: !c.hashes.length, onclick: () => { Settings.set('songselect.collection', c.id); Screens.go('songselect'); } }, icon('play'), 'Play from collection'),
      h('button.btn.ghost', { onclick: async () => { const n = await Dialog.prompt('Rename collection', c.name); if (n) Collections.rename(c.id, n); } }, icon('edit'), 'Rename'),
      h('button.btn.danger', { title: 'Delete collection', 'aria-label': 'Delete collection', onclick: async () => { if (await Dialog.confirm('Delete collection?', `"${c.name}" will be deleted. Beatmaps are not affected.`, { ok: 'Delete', danger: true })) Collections.remove(c.id); } }, icon('trash'))));
    const list = h(`div${c.hashes.length ? '.ex-grid.lib-grid.coll-grid' : ''}`);
    if (!c.hashes.length) list.append(stateCard('folder', 'Empty collection', kbHint('In song select, right-click a difficulty → "Add to collection…", or use the folder button.', 'In song select, use the folder button to add difficulties.'), { cls: '.plain', neru: true }));
    // each difficulty as lazer's beatmap card (the library's): the set's picture faded behind, title and artist, the
    // difficulty with its star rating, your grade, and Play / Remove sliding in on hover
    for (const hash of c.hashes) {
      const m = BeatmapManager.mapByHash(hash), set = m && BeatmapManager.setById.get(m.setId);
      const best = ScoreManager.best(hash);
      const thumb = h('div.ex-thumb'), bg = h('div.ex-cardbg');
      if (set) { PicWait.add(thumb); BeatmapManager.thumbURL(set).then(u => { PicWait.done(thumb); if (!u) return noPicture(thumb); for (const el of [thumb, bg]) { el.style.backgroundImage = `url("${u}")`; el.classList.add('loaded'); } }, () => PicWait.done(thumb)); }
      else noPicture(thumb);
      const side = (cls, ic, label, fn) => h(`button.ex-side-btn${cls}`, { title: label, 'aria-label': label, onclick: e => { e.stopPropagation(); fn(); } }, icon(ic));
      const open = () => m && Screens.go('songselect', { mapId: m.id });
      list.append(h(`div.ex-card.lib-card${m ? '' : '.missing'}`, { tabindex: '0', role: 'button', onclick: open, onkeydown: e => { if (e.key === 'Enter') { e.stopPropagation(); open(); } } },
        bg, h('div.ex-cardshade'), h('div.ex-thumbwrap', thumb),
        h('div.ex-cb',
          h('div.ex-cb-top', h('div.ex-titles', h('div.ex-t', h('span.ex-tt', m ? m.title : 'Missing beatmap')), h('div.ex-a', m ? m.artist : `not in your library (${hash.slice(0, 10)}…)`)),
            best ? rankPill(best.grade) : null),
          m ? h('div.ex-m', h('b', m.version), ' mapped by ', h('b', m.creator)) : null,
          m ? h('div.ex-foot', starBadge(m.stars), h('span.ex-keys', m.keys + 'K'), h('span.grow'), h('span.ex-length', flatIcon('clock', 0.6), fmtTime(m.length))) : null),
        h('div.ex-side',
          m ? side('.play', 'play', 'Play', open) : null,
          side('.del', 'x', 'Remove from collection', () => Collections.toggle(c.id, hash)))));
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
    search.addEventListener('keydown', e => { if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ''; render(); } }); // (lazer: Esc clears the search first)
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
    const { el, page } = pageShell('player info', null, [], { icon: 'user', hue: 'pink', wide: true }); // (lazer's UserProfileHeader title, yours or anyone's)
    this.page = page;
    this._unsub = [Bus.on('profile:changed', () => { if (!this.remote) this.render(); }), Bus.on('scores:changed', () => { if (!this.remote) this.render(); }),
      Bus.on('verified:verdicts', () => { if (!this.remote) this.render(); }), // (the catch-up's answers: why a play wasn't counted)
      Bus.on('profile:remote', m => {
        // (your own profile: the server's list of your first places)
        if (!this.remote && m.pid === Presence.pid()) {
          this.ownFirsts = { list: (m.firsts || []).filter(x => x && x.title), count: m.firstCount || 0 }; /* (one without its song's name isn't listed) */
          this.ownRole = m.role || null;
          // (and your pp and best plays as the server has them — what everyone else sees on your profile)
          const v = m.verified;
          this.ownServer = { pid: m.pid, pp: v ? v.pp || 0 : 0, top: (v && v.src === 'profile' && m.data && m.data.top && m.data.top.length ? m.data.top : m.top) || [] };
          this.render(); return;
        }
        if (this.remote && m.pid === this.remote.pid) { this.remote.firsts = { list: (m.firsts || []).filter(x => x && x.title), count: m.firstCount || 0 }; this.remote.role = m.role || null;
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
  paintGlobal() { const b = this.globalEl && this.globalEl.querySelector('b'); if (b) b.textContent = this.globalRank ? `#${fmtInt(this.globalRank)}` : '—'; },
  /** Everything the profile shows, from this browser's scores — also sent up so other players can open it. */
  localData() {
    const p = ProfileManager.profile, xp = ProfileManager.xpInfo(), st = StatisticsManager.compute();
    const bestPerMap = new Map();
    for (const s of ScoreManager.scores) if (s.passed && (!bestPerMap.has(s.mapHash) || ScoreManager.value(bestPerMap.get(s.mapHash)) < ScoreManager.value(s))) bestPerMap.set(s.mapHash, s);
    const lite = (s, pp) => ({ title: s.title, artist: s.artist, version: s.version, creator: s.creator, grade: s.grade, accuracy: s.accuracy, mods: s.mods || [], date: s.date, pp, _s: s,
      // (enough for other players to open it on the results screen)
      score: Math.round(ScoreManager.value(s) || 0), maxCombo: s.maxCombo, counts: s.counts, keys: s.keys, stars: s.stars, mapHash: s.mapHash, passed: s.passed, ranked: ScoreManager.isRanked(s),
      // (a play from your other device, on a beatmap this one doesn't have: the ids it came with)
      ...(() => { const m = BeatmapManager.mapByHash(s.mapHash), st = m && BeatmapManager.setById.get(m.setId); return { onlineId: m && m.onlineId > 0 ? m.onlineId : s.onlineId > 0 ? s.onlineId : undefined, onlineSetId: st && st.onlineId > 0 ? st.onlineId : s.onlineSetId > 0 ? s.onlineSetId : undefined }; })() });
    const g = st.grades || {}, best = ScoreManager.bestPpPerMap();
    return {
      name: p.name, created: p.created, plays: st.plays, playtime: st.playtime, passed: st.passed, avgAcc: st.avgAcc, notes: st.notes, highestCombo: st.highestCombo,
      rankedScore: [...bestPerMap.values()].filter(s => ScoreManager.isRanked(s)).reduce((a, s) => a + (s.score || 0), 0), pp: ScoreManager.totalPp().total,
      grades: { XH: g.XH || 0, SS: g.SS || 0, SH: g.SH || 0, S: g.S || 0, A: g.A || 0 },
      level: xp.level, xpInto: xp.into, xpNeed: xp.need, xpProgress: xp.progress,
      // (50: the server checks each of them is on a ranked beatmap, by its osu! ids, before it counts toward the rankings)
      top: best.slice(0, 50).map(tp => lite(tp.score, tp.pp)),
      // (your imported backups' best plays: shown on your profile apart from the rest — they can't count on the rankings)
      importedTop: ScoreManager.importedBest().slice(0, 50).map(tp => lite(tp.score, tp.pp)),
      rankedPlays: best.length,
      recent: ScoreManager.recent(10).map(s => lite(s, s.passed ? ScoreManager.ppOf(s) : null)),
      medals: Medals.unlocked(),
      // (only what the profile shows: the pp history, plays per day, most played and beatmap lists it used to have
      // were still worked out — dates formatted one by one — every time it opened, and sent with it)
    };
  },
  /** The same, for sending: without the local score objects. */
  summary() {
    // (imported scores — a backup, a Web-Osu-Mania save — stay on this device: others never see them)
    const d = this.localData(), strip = a => a.filter(x => !(x._s && x._s.imported)).map(({ _s, ...x }) => x);
    return { ...d, top: strip(d.top), recent: strip(d.recent), importedTop: undefined };
  },
  render() {
    const page = this.page;
    clearEl(page);
    if (this.remote) {
      const d = this.remote.data;
      if (!d) { page.append(!Presence.ws ? offlineState('This profile') : h('div.rk-empty', h('span.spinner'), 'Loading profile…')); return; }
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
    // your own profile online: the server's pp and best plays (exactly what others see); plays of yours it hasn't
    // counted yet are listed apart, below
    const srv = own && this.ownServer && this.ownServer.pid === Presence.pid() && Presence.ws ? this.ownServer : null;
    let topPlays = d.top || [], pending = [];
    if (srv) {
      const mine = new Map((d.top || []).map(x => [x._s.mapHash, x]));
      topPlays = srv.top.map(x => { const k = x.key || x.mapHash, l = k && mine.get(k); return l ? { ...l, pp: x.pp } : x; });
      pp.total = srv.pp;
      const got = new Map(srv.top.map(x => [x.key || x.mapHash, x.pp || 0])), shown = x => got.get(x._s.mapHash) >= x.pp - 0.5;
      // (counted: on the server's own list of your best plays, as the catch-up goes by — the ones it shows on your
      // profile can leave some out, and those are listed with the rest here; one below the least it keeps isn't "not
      // counted", just not among them)
      const extra = (d.top || []).filter(x => !shown(x) && Verified.counted(x._s.mapHash, x.pp));
      if (extra.length) topPlays = [...topPlays, ...extra].sort((a, b) => b.pp - a.pp);
      pending = (d.top || []).filter(x => !shown(x) && !Verified.counted(x._s.mapHash, x.pp) && !(x.pp <= Verified.floor));
      // (plays the server doesn't have yet: sent now — not waited on)
      if (pending.length) Verified.catchUp();
    }
    const avatar = own ? ProfileManager.avatarEl(120) : Presence.avatarEl({ name: p.name, avatar: this.remote.avatar || d.avatar }, 120);
    avatar.classList.add('pf-avatar');
    if (own) { avatar.title = 'Change avatar'; avatar.addEventListener('click', () => AvatarPicker.open()); }
    // osu!lazer's UserProfileOverlay: the cover (here the background of the top pp play) with the avatar and name,
    // a strip with play count / time and the level badge, then the detail area: performance and accuracy, rank
    // counts as rank pills, the stat list; then a section tab bar and the sections themselves.
    const cover = h('div.pf-cover');
    // (behind it all: the background of the best play — the one at the top of Best performance — from its beatmap if
    // it's on this device, else that beatmap set's cover from osu!, so it's the same on every device and for everyone
    // looking; with no best play, your latest play's)
    const setCover = u => { if (u) { cover.style.backgroundImage = `url("${u}")`; cover.classList.add('img'); } };
    const hashOf = x => x && (x._s ? x._s.mapHash : x.key || x.mapHash);
    const setOf = x => { if (!x) return 0; const sc = x._s || (own && ScoreManager.scores.find(y => y.mapHash === hashOf(x))); return (sc && sc.onlineSetId > 0 && sc.onlineSetId) || (x.onlineSetId > 0 && x.onlineSetId) || 0; };
    const best = topPlays[0], bestMap = best && BeatmapManager.mapByHash(hashOf(best)), bestSet = setOf(best);
    const online = () => { if (bestSet) setCover(OnlineBeatmaps.coverURL(bestSet, 'cover@2x')); };
    if (bestMap) BeatmapManager.bgURL(bestMap).then(u => u ? setCover(u) : online()).catch(online);
    else if (bestSet) online();
    else if (own) { const last = ScoreManager.recent(1)[0], m = last && BeatmapManager.mapByHash(last.mapHash); if (m) BeatmapManager.bgURL(m).then(setCover).catch(() => {}); }
    const u = this.remote ? { pid: this.remote.pid, name: p.name, avatar: this.remote.avatar, online: !!this.remote.online, id: this.remote.id, status: this.remote.status } : null;
    // (a role's effects: Neru's gold round the picture and on the name — see roleFx)
    const role = this.remote ? this.remote.role : (this.ownRole || (typeof Presence !== 'undefined' && Presence.role) || null), fx = roleFx(role);
    const top = h(`div.pf-top${fx ? `.fx-${fx}` : ''}`, { style: fx ? { '--rc': /^#[0-9a-f]{6}$/i.test(role.colour || '') ? role.colour : '#ffcc22' } : {} }, cover, h('div.pf-top-in',
      fxAvatar(avatar, role),
      h('div.pf-id',
        h('div.pf-name', fxName(h('span.pf-nm', p.name), role), own ? h('button.icon-btn', { title: 'Rename', 'aria-label': 'Rename', onclick: async () => { const n = await Dialog.prompt('Username', p.name); if (n) { await ProfileManager.setName(n); Toolbar.updateProfile(); } } }, icon('edit')) : null,
          // (your code: play as yourself on another device)
          own && Multiplayer.available() ? h('button.btn.sm.pf-signin', { onclick: () => CodePanel.open(Account.signedOut() ? { use: true } : {}) }, icon('lock'), Account.signedOut() ? 'Signed out · Use your code' : 'Your code') : null),
        h('div.pf-tags', roleBadge(this.remote ? this.remote.role : this.ownRole), h('span.pf-tag', 'osu!mania'), p.created ? h('span.pf-since', `Playing since ${new Date(p.created).toLocaleDateString([], { year: 'numeric', month: 'long' })}`) : null,
          u ? h('span.pf-online', UserPanels.statusIcon(u), UserPanels.statusText(u)) : null)),
      // (their actions as buttons; reporting them and an admin's tools under ⋯)
      u ? (() => { const all = UserPanels.menuItems(u), more = all.filter(it => it.more || it.staff);
        return h('div.pf-acts', ...all.filter(it => !it.sep && !it.header && !it.more && !it.staff && it.label !== 'View profile').map(it => h(`button.btn.sm${it.danger ? '.danger' : ''}`, { onclick: () => { UISounds.click(); it.onClick && it.onClick(); setTimeout(() => this.render(), 300); } }, it.icon ? icon(it.icon) : null, it.label)),
          more.length ? h('button.btn.sm.pf-acts-more', { title: 'More', 'aria-label': 'More', onclick: e => { UISounds.click(); const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, all.filter(it => it.more || it.staff || (it.header && more.some(m => m.staff)))); } }, icon('bars')) : null); })() : null));
    // (play count and time aren't repeated here: they're in the stat list below)
    const centre = h('div.pf-centre',
      this.dailyEl = h('div.pf-daily', { hidden: true }),
      h('div.grow'),
      h('div.pf-level', { title: `${fmtInt(xp.into)} / ${fmtInt(xp.need)} XP` },
        h('div.pf-hex', h('span', String(xp.level))),
        h('div.pf-lvl', h('div.pf-lvl-bar', h('i', { style: { width: (xp.progress * 100).toFixed(1) + '%' } })), h('span', `${Math.floor(xp.progress * 100)}%`))));
    const grades = st.grades || {};
    // SS, S and A (the Hidden silver ones counted in): three pills, not five near-identical ones
    const rank = (g, ...also) => h('div.pf-rank', rankPill(g), h('span', fmtInt([g, ...also].reduce((n, x) => n + (grades[x] || 0), 0))));
    const dl = (k, v) => h('div.pf-dl', h('span', k), h('b', v));
    const globalRank = own ? this.globalRank : this.remote.rank;
    const detail = h('div.pf-detail',
      h('div.pf-detail-l',
        h('div.pf-bigs',
          // lazer's Global Ranking: the place in the rankings (from the server; — until it answers or offline)
          this.globalEl = h('div.pf-big.pf-global', { title: 'Place in the rankings, by performance', onclick: () => Screens.go('rankings') }, h('span', 'Global Ranking'), h('b', globalRank ? `#${fmtInt(globalRank)}` : '—')),
          h('div.pf-big', { title: 'The best play on each beatmap: the top one counts in full, each next one 95% as much as the one before' }, h('span', 'Performance'), h('b', fmtInt(pp.total) + 'pp'))),
        h('div.pf-ranks', rank('SS', 'XH', 'X'), rank('S', 'SH'), rank('A'))),
      h('div.pf-detail-r',
        dl('Play count', fmtInt(st.plays)),
        dl('Play time', fmtDuration(st.playtime)), dl('Total hits', fmtInt(st.notes)), dl('Maximum combo', fmtInt(st.highestCombo) + 'x')));
    // sections, with lazer's sticky tab bar
    const secs = [];
    // (a section with nothing in it is left out, tab and all: no wall of "nothing here yet")
    const section = (id, title, ...kids) => { kids = kids.filter(Boolean); if (!kids.length) return null; const el = h('section.pf-sec', { dataset: { sec: id } }, h('h2', title), ...kids); secs.push([id, title, el]); return el; };
    const sub = (title, count, ...kids) => h('div.pf-subsec', h('h3', title, count ? h('span.pf-count', typeof count === 'number' ? fmtInt(count) : count) : null), ...kids);
    // (a pass of yours on a beatmap that isn't ranked on osu! gives no pp: a dash, not a "0pp" that reads as a bad play)
    const noPp = x => x._s && x._s.passed && !ScoreManager.isRanked(x._s);
    const row = (x, i, weighted) => this.scoreRow(x._s || { ...x, remote: true }, !weighted && noPp(x) ? false : x.pp == null ? null : fmtInt(x.pp), weighted ? `weighted ${Math.round(Math.pow(0.95, i) * 100)}%` : null, weighted ? fmtInt(x.pp * Math.pow(0.95, i)) : null);
    // lazer's ProfileShowMoreButton: a list starts with 5 and grows by 10 with each "show more"
    const more = (items, mk, first = 5) => {
      const box = h('div.pf-scores');
      let shown = 0;
      const btn = h('button.pf-more', { onclick: () => { UISounds.click(); grow(10); } }, h('span', 'show more'), icon('down'));
      const grow = n => { const next = items.slice(shown, shown + n); next.forEach((x, i) => box.insertBefore(mk(x, shown + i), btn.parentNode === box ? btn : null)); shown += next.length; if (shown >= items.length) btn.remove(); };
      box.append(btn); grow(first);
      return box;
    };
    const ranks = () => section('ranks', 'Ranks',
      sub('Best performance', topPlays.length, topPlays.length
        ? more(topPlays, (x, i) => row(x, i, true))
        : h('div.pf-empty', !own ? 'No performance records yet.'
          // (plays on beatmaps that aren't ranked on osu! — your own, or from a file — give pp in the results but never count here)
          : ScoreManager.scores.some(x => x.passed) ? 'No performance records yet: only plays on beatmaps ranked on osu! count here — find some in the beatmap listing.' : 'No performance records. Pass a ranked beatmap to earn pp.')),
      pending.length ? sub('Not counted yet', pending.length,
        // (each says why the server hasn't got it — turned down, or not ranked on osu! — once it's been asked)
        h('div.pf-note', !Presence.ws ? 'These go up to the server as soon as you\'re online.'
          : !Verified.busy() && pending.every(x => Verified.why(x._s.mapHash, x.pp)) ? 'Not counted — why is beside each one.'
          : 'Going up to the server now — they count in a moment.'),
        more(pending, x => this.scoreRow(x._s, fmtInt(x.pp), null, null, Verified.why(x._s.mapHash, x.pp)))) : null,
      own && d.importedTop && d.importedTop.length ? sub('From imported backups', d.importedTop.length,
        h('div.pf-note', 'Not counted in your pp or on the rankings: there\'s no replay of these for the server to check. Play them again here to count them.'),
        more(d.importedTop, x => row(x, 0, false))) : null);
    const got = d.medals || {};
    const medals = () => section('medals', 'Medals', sub('Unlocked', `${fmtInt(Medals.all.filter(m => got[m.id]).length)} / ${fmtInt(Medals.all.length)}`, ...Medals.section(got)));
    const recent = d.recent || [];
    const rec = () => section('recent', 'Recent',
      recent.length ? sub('Recent plays', recent.length, more(recent, (x, i) => row(x, i, false))) : null);
    // kept simple: your best plays, what you played lately and your medals
    const sections = [ranks(), rec(), medals()].filter(Boolean);
    let pinned = null; // (a clicked tab stays lit until you scroll yourself, even if its section can't reach the top)
    const tabs = h('div.pf-tabs', ...secs.map(([id, title, el]) => h('button.ov-tab', { onclick: () => { UISounds.click(); pinned = id; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); const sc = el.closest('.screen-body'); if (sc) settleOn(sc, () => el.scrollIntoView({ block: 'start' })); [...tabs.children].forEach((b, i) => b.classList.toggle('on', secs[i][0] === id)); } }, title.toLowerCase())));
    // (the level and daily challenge sit at the cover's bottom right, beside the name: one block, not a strip of its own)
    top.querySelector('.pf-top-in').append(centre);
    page.append(h('div.pf-header', top, detail), tabs, ...sections);
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
  scoreRow(s, pp, weight = null, weighted = null, note = null) {
    return h(`button.pf-score${s.remote ? '.remote' : ''}`, { onclick: () => {
      UISounds.click();
      // (back from the score comes back here — this profile, scrolled where it was — not to song select)
      const back = { name: 'profile', params: this.backParams() };
      if (!s.remote) { Screens.go('results', { score: s, fromList: true, browse: true, back }, { transition: 'right' }); return; }
      const r = this.remote || {};
      Screens.go('results', { score: { ...s, scoreStd: s.score, online: true, player: r.name, avatar: r.avatar, counts: s.counts || [0, 0, 0, 0, 0, 0], passed: s.passed !== false && s.grade !== 'F', replayId: null }, fromList: true, browse: true, watched: 'online', back }, { transition: 'right' });
    } },
      rankPill(s.grade),
      h('div.main', h('div.t', s.title, h('span.a', ` by ${s.artist || ''}`)), h('div.s', h('span.v', s.version), h('span.d', fmtDate(s.date)))),
      h('span.pf-mods', ...(s.mods || []).map(m => ModSystem.badge(m, true))),
      // (no accuracy here: next to the weighting it read as the play's weight)
      weight ? h('div.pf-weight', h('b', `${weighted}pp`), h('span', weight)) : note ? h('div.pf-weight.pf-why', h('span', note)) : null,
      pp === false ? h('div.pf-ppblock.nopp', { title: 'No pp: the beatmap isn\'t ranked on osu!' }, h('span', '–'))
        : h(`div.pf-ppblock${pp == null ? '.failed' : ''}`, pp == null ? h('span', 'failed') : h('span', pp, h('small', 'pp'))));
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
    if (!ReplayManager.list.length) { this.list.append(stateCard('film', 'No replays saved', 'Replays of personal bests are saved automatically (configurable in Settings → Maintenance). You can also save any play from the results screen.', { cls: '.plain', neru: true })); return; }
    // (lazer's DrawableProfileScore, as on the profile: rank pill, title by artist, difficulty · player · date, mods,
    // accuracy — and the replay's buttons in the slanted block where the pp would be)
    const rows = h('div.pf-scores.rp-list');
    const row = r => {
      const map = BeatmapManager.mapByHash(r.mapHash);
      const sm = r.summary || {};
      // (the list has each replay without its key presses: the whole one is read to watch or export it)
      const full = async () => { const x = await ReplayManager.get(r.id); if (!x) Toast.err('No replay available'); return x; };
      const watch = async () => { if (!map) return; UISounds.click(); const x = await full(); if (x) Game.launch({ mapId: map.id, mode: 'replay', replay: x, back: { name: 'replays' } }); };
      const act = (ic, title, f, cls = '') => h(`button.rp-act${cls}`, { title, 'aria-label': title, disabled: !map && cls !== '.del' && ic !== 'download', onclick: e => { e.stopPropagation(); f(e); } }, icon(ic));
      return h(`div.pf-score.rp-row${map ? '' : '.missing'}`, { role: 'button', tabindex: 0, title: map ? 'Watch replay' : 'This beatmap isn\'t in your library', onclick: watch, onkeydown: e => { if (e.key === 'Enter') watch(); } },
        rankPill(sm.grade || 'D'),
        h('div.main', h('div.t', r.title, h('span.a', ` by ${r.artist || ''}`)),
          h('div.s', h('span.v', r.version), h('span.p', r.player || 'Player'), h('span.d', fmtDateTime(r.date)), map ? null : h('span.x', 'beatmap missing'))),
        h('span.pf-mods', ...(r.mods || []).map(m => ModSystem.badge(m, true))),
        h('div.rp-combo', `${fmtInt(sm.maxCombo || 0)}x`),
        h('div.pf-acc', fmtAcc(sm.accuracy || 0)),
        h('div.pf-ppblock.rp-acts',
          h('span.rp-btns',
            act('play', 'Watch', watch),
            act('download', 'Export .osr (opens in osu!lazer)', async () => { const x = await full(); if (x) Osr.exportReplay(x); }),
            act('save', 'Export .amr (this game\'s own format)', async () => { const x = await full(); if (x) ReplayManager.export(x); }),
            act('trash', 'Delete', async () => { if (await Dialog.confirm('Delete replay?', `${r.title} [${r.version}] by ${r.player}`, { ok: 'Delete', danger: true })) ReplayManager.remove(r.id); }, '.del'))));
    };
    // (the first screenful straight away, the rest a part at a time: hundreds of rows at once froze the page)
    const list = ReplayManager.list;
    rows.append(...list.slice(0, 30).map(row));
    this.list.append(rows);
    let at = 30;
    const more = () => {
      if (!rows.isConnected || at >= list.length) return;
      const part = document.createDocumentFragment();
      for (const r of list.slice(at, at + 30)) part.append(row(r));
      at += 30; rows.append(part); whenIdle(more);
    };
    whenIdle(more);
  },
};

// ─────────────────────────────── Skins ───────────────────────────────
class SkinPreview {
  /** scrollSpeed: scroll at the player's scroll speed setting instead of a fixed demo speed. */
  constructor(canvas, { scrollSpeed = false } = {}) {
    this.canvas = canvas; this.renderer = new ManiaRenderer(canvas, { touch: false }); this.running = false; this.useSpeed = scrollSpeed;
    // (not drawn while it's out of sight — scrolled away, or the page it's on hidden: on a slow computer it was a third of
    // the time the menus took, drawing for nobody)
    this.seen = true;
    if (typeof IntersectionObserver === 'function') { this._io = new IntersectionObserver(es => { for (const e of es) this.seen = e.isIntersecting; }); this._io.observe(canvas); }
  }
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
    this.engine = new GameplayEngine({ notes: this.notes, keys: this.keys, windows: timingWindows({ od: 8 }), noFail: true, hpMult: 1 });
    this.engine.onEvent(e => { if (e.type === 'judgement') this.renderer.onJudgement(e, performance.now()); });
    this.feed = generateAutoInputs(this.engine.notes, this.keys);
    this.fi = 0; this.held = new Array(this.keys).fill(false); this.t0 = performance.now();
  }
  loop() {
    const frame = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(frame);
      if (!this.engine) return;
      // (Performance mode, or a computer found slow: drawn at 30fps — it's a picture of the skin, not a play to keep up
      // with)
      const real = performance.now();
      if (!this.seen) { this.t0 += real - (this._drawn || real); this._drawn = real; return; }
      if (real - (this._drawn || 0) < 31 && (Settings.get('graphics.performanceMode') || document.documentElement.classList.contains('slow'))) return;
      this._drawn = real;
      const now = real - this.t0;
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
  stop() { this.running = false; cancelAnimationFrame(this._raf); if (this._io) { this._io.disconnect(); this._io = null; } if (this.hpBar) { this.hpBar.el.remove(); this.hpBar = null; } }
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
    const paint = () => clearEl(box).append(h('div.sk-custom-h', icon('brush'), 'Customise', h('button.btn.sm.ghost', { onclick: () => { for (const k of keys) { const d = Settings.schema.get(k); if (d) Settings.set(k, copyData(d.d)); } UISounds.click(); paint(); } }, 'Reset')),
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
    // (another skin picked: the key count it's made for if it can't show this one; every skin previews 1K–18K)
    if (this._kFor !== meta.id) { this._kFor = meta.id; if (!supported.includes(this.keys) && !borrowed.includes(this.keys)) this.keys = supported.includes(4) ? 4 : supported.includes(7) ? 7 : (supported[0] || 4); }
    const kHint = k => meta.builtin ? '' : borrowed.includes(k) ? 'built from the skin\'s 4K layout' : supported.includes(k) ? 'from the skin\'s skin.ini' : 'default layout';
    const hint = h('span.muted.sk-khint', kHint(this.keys));
    // 1K to 18K, one tap each (a dot: set up in the skin itself); the preview changes without the page being rebuilt
    const chips = h('div.sk-kchips', { role: 'tablist', 'aria-label': 'Key count' }, ...Array.from({ length: MAX_KEYS }, (_, i) => i + 1).map(k =>
      h(`button.sk-kc${k === this.keys ? '.on' : ''}${!meta.builtin && supported.includes(k) ? '.own' : ''}`, { role: 'tab', 'aria-selected': String(k === this.keys), dataset: { k },
        onclick: e => { if (k === this.keys) return; UISounds.click(); this.keys = k; for (const b of chips.children) { const on = +b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
          hint.textContent = kHint(k); centre(e.currentTarget, true); if (this.preview) this.preview.show(skin, k); } }, `${k}K`)));
    // (on a narrow screen the row scrolls: its ends fade where more key counts are past them, and it starts on the one picked)
    let centred = false;
    function centre(chip, smooth) { const a = chip.getBoundingClientRect(), b = chips.getBoundingClientRect(); chips.scrollTo({ left: chips.scrollLeft + a.left - b.left - (b.width - a.width) / 2, behavior: smooth ? 'smooth' : 'instant' }); }
    const edges = () => {
      const on = chips.querySelector('.on');
      if (!centred && on && chips.clientWidth) { centred = true; centre(on); }
      chips.classList.toggle('more-l', chips.scrollLeft > 1);
      chips.classList.toggle('more-r', chips.scrollLeft + chips.clientWidth < chips.scrollWidth - 1);
    };
    chips.addEventListener('scroll', edges, { passive: true });
    new ResizeObserver(edges).observe(chips);
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
      h('div.sk-keys.with-chips', h('span.muted.sk-kl', 'Preview'), chips, hint),
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
  { id: '2026.10.31', title: 'Rooms and scores', sections: [
    { icon: 'multi', title: 'Rooms', items: ['A song queue: line songs up to play one after another (the host\'s, or everyone\'s)', 'Speed mods can be each player\'s own (a room setting)', 'Spectating in a room, switch to another player without going back', 'Click a score in a room\'s results to see its card', 'Invite a friend who\'s in the middle of a song: they get the invite as soon as it ends'] },
    { icon: 'trophy', title: 'Scores', items: ['Other players\' scores show their star rating and every judgement, not zeros', 'As in osu!lazer, Difficulty Adjust, Constant Speed, Hold Off, Invert, Song Speed and Percy give no pp or leaderboard scores (rooms still have them) — nor Hidden, Fade In, Cover or Flashlight changed from how they come'] },
    { icon: 'brush', title: 'Skin editor', items: ['Receptor opacity'] },
    { icon: 'sparkle', title: 'Menus', items: ['The back button is in the same place on every screen, phones too', 'Esc closes a dialog even while you\'re typing in it', 'On a phone held sideways, pop-ups fit the screen'] },
  ] },
  { id: '2026.10.30b', title: 'Settings and menus', sections: [
    { icon: 'gear', title: 'Settings', items: ['Scroll speed is back in Settings → Gameplay → Scrolling', 'Notes always follow the beatmap\'s speed changes (SV and BPM), as in osu!mania — the setting for it is gone'] },
    { icon: 'sparkle', title: 'Menus', items: ['Practice tools in tidy groups — loop, speed and offset', 'The results screen\'s buttons say what they do'] },
    { icon: 'trophy', title: 'Ranked Play', items: ['A card you play is gone for good — no song is ever in a deck twice, so it can\'t come back and you and your opponent never hold the same one'] },
  ] },
  { id: '2026.10.30', title: 'Ranked Play', sections: [
    { icon: 'trophy', title: 'Ranked Play', items: ['Open a duel with Fair or Regular cards: Fair gives each of you your own difficulty near your pick; Regular picks one star rating between your two picks, and you both play the same difficulties', 'The lounge shows which kind each duel is'] },
  ] },
  { id: '2026.10.29c', title: 'Ranked Play', sections: [
    { icon: 'trophy', title: 'Ranked Play', items: ['Each card you play is replaced from the deck, so your hand stays full', 'No "star rating has been decided" after you both pick', 'The star rating slider fills up to where you put it', 'Songs come at random from the online listing, not your own library'] },
    { icon: 'film', title: 'Spectating', items: ['Spectate someone in Ranked Play and see the whole match as they do: their cards, their picks, each round\'s results, and their songs live'] },
    { icon: 'user', title: 'Multiplayer', items: ['On school networks, nothing is lost when the network drops a message, and a connection that keeps getting cut off switches over by itself'] },
    { icon: 'sparkle', title: 'Smoother', items: ['The main menu takes about a third less of a slow computer\'s time while music plays — the logo\'s visualiser and triangles are drawn in the background'] },
  ] },
  { id: '2026.10.29b', title: 'Ranked Play, spectating and Neru', sections: [
    { icon: 'trophy', title: 'Ranked Play', items: ['Each player gets their own difficulty of the song, near the star rating they chose — both the same length', 'Your cards show only your own star rating', 'No song plays behind the Ranked Play lounge and matches'] },
    { icon: 'film', title: 'Spectating', items: ['Skips happen only when the player you\'re watching skips', 'Their pause and fail menus show, with what they\'re choosing'] },
    { icon: 'heart', title: 'Neru', items: ['Neru keeps her animations in Performance mode', 'The crown on her picture sits where it should again', 'The Neru role gets a gold, Neru-style profile and Ranked look', 'The Teto role gets a red, Teto-style one', 'Clicked over and over by a Teto or Miku fan, she gets angry half the time — otherwise a thought or a photo', 'On a phone, she no longer stands over the other scores on the results screen'] },
    { icon: 'sparkle', title: 'Smoother', items: ['Menus pulse no faster than a steady beat on very fast songs', 'Lists scroll smoothly and at a good speed, even on slow computers', 'Scrolling waits for pictures to load instead of racing past them', 'The beatmap listing and the menus run much more smoothly on slow computers', 'Scroll speed is set on the screen before each song (and F3 / F4)'] },
    { icon: 'sparkle', title: 'More like lazer', items: ['The toolbar\'s changelog button opens the whole changelog as a page, as in lazer'] },
    { icon: 'user', title: 'Fixes', items: ['A second tab (or the installed app) no longer leaves you a guest and yourself at once — which stopped some players joining multiplayer', 'Players with their own profile picture can get into rooms again (MP-RT)', 'Multiplayer works on school Chromebooks and networks that block its connection — it goes over normal web requests instead', 'Leftovers from an old player id are cleared before connecting', 'When multiplayer can\'t connect, an error code says exactly why — Copy details puts it all in a message'] },
  ] },
  { id: '2026.10.29', title: 'Neru', sections: [
    { icon: 'heart', title: 'Neru', items: ['A few more Neru secrets to find on the main menu'] },
  ] },
  { id: '2026.10.28n', title: 'Ranked Play', sections: [
    { icon: 'trophy', title: 'Ranked Play', items: ['Leave a song and the score you had so far counts for the round, instead of 0', 'Once your song is over, Spectate your opponent as they play on'] },
  ] },
  { id: '2026.10.28m', title: 'Mod multipliers and smoother menus', sections: [
    { icon: 'sparkle', title: 'Mods', items: ['Score multipliers match lazer\'s: Half Time and Daycore 0.30x, key mods 0.90x, Wind Up, Wind Down and Adaptive Speed 0.50x, and Song Speed below 1× counts as Half Time at that speed'] },
    { icon: 'bolt', title: 'Performance', items: ['After a song, the menus no longer keep your computer busy in the background', 'Scrolling the settings is smoother'] },
  ] },
  { id: '2026.10.28l', title: 'Phones and performance', sections: [
    { icon: 'sparkle', title: 'Phones', items: ['Landscape (expanded columns) as lazer\'s looks on a phone: wider columns a hairline apart, the same size whatever the skin (a skin with wide columns no longer fills the screen)'] },
    { icon: 'bolt', title: 'Performance mode', items: ['Performance mode shows song pictures at a lower resolution too — the separate Picture quality option is gone', 'Picking Performance in first-run setup also turns on Automatic resolution'] },
    { icon: 'sparkle', title: 'More like lazer', items: ['Page titles as in lazer: just the name ("player info", "multiplayer · lounge"), with what the page is for when you hover it'] },
  ] },
  { id: '2026.10.28k', title: 'Results and song select', sections: [
    { icon: 'trophy', title: 'Results', items: ['Every score on the beatmap sits in a row beside yours, as in lazer: scroll, drag or use ← / → to look through them, yours and the online ones, and click one to open it', 'In multiplayer, your score sits in the middle with everyone else\'s either side, as in lazer'] },
    { icon: 'sparkle', title: 'Song select', items: ['Typing a search no longer starts playing a song — it plays once you pick a beatmap', 'A long list of scores no longer cuts off the grades at the top of the list', 'Your own score is no longer highlighted on the online boards'] },
  ] },
  { id: '2026.10.28j', title: 'HTML file', sections: [
    { icon: 'download', title: 'Saved as an HTML file', items: ['Save the game as an HTML file while you have a code and the file opens as you the first time — your scores, settings, collections, favourites and skin come with it, no code to type (it works once, within a day)'] },
  ] },
  { id: '2026.10.28i', title: 'Polish', sections: [
    { icon: 'sparkle', title: 'Polish', items: ['On a phone with wide columns, the chat during a multiplayer song only shows new messages, so it stays off your notes', 'Neru no longer pops up over the back button after a match', 'The Spectator Mode screen fits a phone held sideways', 'In Ranked Play, Neru steps down into the corner while a round\'s results are shown', 'Duels in the Ranked Play lounge no longer show a rating (they\'re unrated)', 'The end of a Ranked Play match counts the rounds played to the end, not one cut short', 'On a smaller screen, Neru steps aside during the countdown instead of standing in front of the beatmap card', 'Playing in Portrait: Neru no longer covers your results, and the buttons at the bottom sit clear of the back button', 'A box with more to read than fits (How Ranked Play works on a phone) fades at the edge, so you can tell it scrolls'] },
  ] },
  { id: '2026.10.28g', title: 'Song select', sections: [
    { icon: 'sparkle', title: 'Song select', items: ['The scores on a beatmap look as in lazer: they lean as a column, each a step in from the one below, with "MAX COMBO" and a bigger grade', 'Your own scores are only lit up on the online boards'] },
  ] },
  { id: '2026.10.28f', title: 'Spectating, as in lazer', sections: [
    { icon: 'film', title: 'Spectating', items: ['Spectate someone and you get lazer\'s Spectator Mode screen: who you\'re watching, the beatmap they\'re playing, and Start Watching', 'Their song starts by itself once you have the beatmap — download it from the card, or turn on "Automatically download missing beatmaps"', 'While watching: "Watching (them) play (song) live" at the top, and their results at the end (no retry — it\'s their play)', 'Esc takes you back to the Spectator Mode screen; their next song starts there too', 'Their screen is no longer copied onto yours between songs'] },
  ] },
  { id: '2026.10.28e', title: 'Phones', sections: [
    { icon: 'sparkle', title: 'Phones', items: ['First-run setup asks how you want to play on a phone — Portrait, Landscape or Landscape (expanded) — with a picture of each', 'Signing in to your account on a phone asks it first', 'In Portrait and Landscape (expanded), only a tap on a lane hits a note — a tap beside the stage does nothing'] },
  ] },
  { id: '2026.10.28d', title: 'Fairer Ranked Play', sections: [
    { icon: 'trophy', title: 'Fairer Ranked Play', items: ['Both players play by the same rules: the beatmap\'s timing, the same accuracy and the same scrolling, whatever your settings', 'Opening hands are dealt in matched pairs, so neither of you starts with the harder cards', 'One song does at most 500,000 damage, so one bad song can\'t decide the match', 'The cards lean towards the lower of the two star ratings chosen', 'No gimmick or joke beatmaps, and nothing under 45 seconds or over 6 minutes', '"How it works" in the Ranked Play lounge explains the rules', 'Neru watches your matches (when she\'s on) and has something to say about them'] },
  ] },
  { id: '2026.10.28c', title: 'Multiplayer', sections: [
    { icon: 'multi', title: 'Multiplayer', items: ['The playfield shows during the countdown before a match', 'Team Versus results show both teams\' totals in their colours', 'On a phone, a new chat message pops up when the chat is off the screen', 'Neru no longer peeks up over the back button', 'Quit a match early: you show as quit, and the room says the match is still going', '"Quit match?" no longer stays up over the results if the song ends first'] },
  ] },
  { id: '2026.10.28b', title: 'Look and feel', sections: [
    { icon: 'sparkle', title: 'Look and feel', items: ['Long windows, like Keyboard shortcuts, scroll inside and keep their Close button in view', 'First-run setup: the Web-Osu-Mania question looks like the others'] },
  ] },
  { id: '2026.10.28', title: 'Multiplayer', sections: [
    { icon: 'multi', title: 'Multiplayer', items: ['Not the host? Recommend a beatmap from your own library', 'The host changes speed mods (DT, HT…) without a vote', 'Room buttons no longer wrap, and difficulties don\'t say the key count twice'] },
  ] },
  { id: '2026.10.27d', title: 'Lighter menus', sections: [
    { icon: 'sparkle', title: 'Lighter menus', items: ['Song select uses far less of your computer while you sit on it, with performance mode off too', 'Stepping through songs and typing a search are lighter, looking the same', 'Browse and your library scroll more smoothly on slow computers'] },
  ] },
  { id: '2026.10.27c', title: 'Fixes', sections: [
    { icon: 'sparkle', title: 'Fixes', items: ['Notes scroll without the little hitches every few seconds', 'Percy skins: long notes are cut short by the same amount, like in osu!', 'Skins that hide the health bar with empty images hide it, instead of getting another bar', 'Updating the HTML file checks the new version saved properly before restarting, instead of opening a blank page'] },
    { icon: 'heart', title: 'Neru', items: ['Playing as Miku or Teto, single clicks don\'t set her off: the leek, the baguette or a picture comes when she\'d get angry', 'She only twirls in Neru mode', 'The thought bubble goes before she changes back'] },
  ] },
  { id: '2026.10.27b', title: 'Fixes', sections: [
    { icon: 'download', title: 'Fixes', items: ['Updating the HTML file updates the file you\'re playing, instead of restarting into the old version and asking again', 'Pictures and songs stay at full resolution: lower them in Settings → Graphics (Picture quality, Renderer scale, Automatic resolution)'] },
  ] },
  { id: '2026.10.27', title: 'Smoother menus', sections: [
    { icon: 'sparkle', title: 'Performance mode', items: ['Song select stutters far less on slow computers: stepping through songs, scrolling the list and opening it', 'A song\'s preview starts once you stop on it, so flicking past songs stays smooth', 'The main menu\'s buttons hover without a hitch'] },
    { icon: 'heart', title: 'Neru', items: ['Clicking Neru over and over sets her off after the same number of clicks every time', 'Once she\'s going, more clicks can\'t cut her short', 'Playing as Neru, she twirls instead'] },
  ] },
  { id: '2026.10.22d', title: 'Look and feel', sections: [
    { icon: 'sparkle', title: 'Look and feel', items: ['Phones play whichever way you hold them, unless you pick one', 'A bigger results card on a phone held sideways', 'Tablets: two beatmaps a row in the listing, and song select\'s filters fit', 'Chat opens taller on phones and tablets, and the skin editor gives the game more room', 'Held upright, the leaderboard fades while you play so notes under it show', 'Beatmaps without a picture show a note, not an empty square', 'An empty library has a Browse online button'] },
  ] },
  { id: '2026.10.22c', title: 'Scores fix', sections: [
    { icon: 'trophy', title: 'Scores fix', items: ['Plays stuck on "Not counted yet" now count', 'Plays that can\'t reach the server say so and try again'] },
  ] },
  { id: '2026.10.22b', title: 'Neru touch-ups', sections: [
    { icon: 'heart', title: 'Neru touch-ups', items: ['She blushes after headpats', 'Clicked a lot, she spins as often as she gets mad', 'Searching Miku or Teto shows the one you searched', 'Changing songs no longer sits her at her desk'] },
  ] },
  { id: '2026.10.22', title: 'Phones and fixes', sections: [
    { icon: 'sparkle', title: 'Phones and fixes', items: ['Mobile layout setting: Portrait, Landscape or Landscape (expanded columns)', 'Updating the HTML file no longer leaves an empty file', 'Copies of the game without a multiplayer server say so', 'Menus run smoother in performance mode'] },
  ] },
  { id: '2026.10.21', title: 'Neru update', sections: [
    { icon: 'sparkle', title: 'Neru update', items: ['Neru all around the game, with seasons and secrets to find', 'Only the hard medals are left (and Neru\'s secret ones)', 'Plays count online straight away', 'Rooms that can\'t be created say why'] },
  ] },
  { id: '2026.10.20c', title: 'Skins update', sections: [
    { icon: 'brush', title: 'Skins update', items: ['Preview any skin from 1K to 18K', 'A cleaner skin editor that shows hidden parts too', 'A few Neru secrets to find'] },
  ] },
  { id: '2026.10.20b', title: 'Account update', sections: [
    { icon: 'lock', title: 'Account update', items: ['Changes show on all your devices', 'Install the beatmaps you had on a new device', 'Your profile pp matches the rankings'] },
  ] },
  { id: '2026.10.20', title: 'Neru update', sections: [
    { icon: 'heart', title: 'Neru update', items: ['Adds Neru to the results screen and other miscellaneous screens'] },
  ] },
  { id: '2026.10.17', title: 'Your code', sections: [
    { icon: 'lock', title: 'Your code', items: ['Play as yourself on any device with your code', 'Your settings, skin and scores come with you', 'Lots of fixes for phones, gameplay and multiplayer'] },
  ] },
  { id: '2026.10.16', title: 'Smoother spectating', sections: [
    { icon: 'film', title: 'Smoother spectating', items: ['Watching someone is smoother', 'Downloads start sooner'] },
  ] },
  { id: '2026.10.15', title: 'Play from a file', sections: [
    { icon: 'download', title: 'Play from a file', items: ['Save the game as one HTML file and play it anywhere'] },
  ] },
  { id: '2026.10.14', title: 'Quicker installs', sections: [
    { icon: 'download', title: 'Quicker installs', items: ['Beatmaps install faster without lag'] },
  ] },
  { id: '2026.10.9', title: 'Touch-ups', sections: [
    { icon: 'sparkle', title: 'Touch-ups', items: ['Small fixes across the game'] },
  ] },
  { id: '2026.10.8', title: 'Phones and downloads', sections: [
    { icon: 'download', title: 'Phones and downloads', items: ['Download beatmaps without video', 'Better on phones and tablets'] },
  ] },
  { id: '2026.10.7', title: 'Cleaner pages', sections: [
    { icon: 'multi', title: 'Cleaner pages', items: ['Multiplayer rooms look like lazer\'s', 'Beatmap skins', 'Cleaner profiles'] },
  ] },
  { id: '2026.10.6', title: 'Smooth on every device', sections: [
    { icon: 'sparkle', title: 'Smooth on every device', items: ['Every screen runs smoother', 'Icons are lazer\'s own'] },
  ] },
  { id: '2026.10.5', title: 'Skin editor', sections: [
    { icon: 'brush', title: 'Skin editor', items: ['New skin editor', 'User tags, screenshots (F12) and storyboards'] },
  ] },
  { id: '2026.10.4', title: 'Fair play', sections: [
    { icon: 'trophy', title: 'Fair play', items: ['Scores and pp are checked by the server', 'New mods'] },
  ] },
  { id: '2026.10.3', title: 'Little things', sections: [
    { icon: 'sparkle', title: 'Little things', items: ['Small polish'] },
  ] },
  { id: '2026.10.2', title: 'Polish', sections: [
    { icon: 'upload', title: 'Polish', items: ['Import your Web-Osu-Mania backup', 'Simpler Ranked Play'] },
  ] },
  { id: '2026.10.1', title: 'The lazer update', sections: [
    { icon: 'home', title: 'The lazer update', items: ['The game looks like osu!lazer', 'Ranked Play and multiplayer rooms'] },
  ] },
];
const WhatsNew = {
  latest() { return CHANGELOG[0].id; },
  /** How many lines the latest entry has: it can grow after it's been seen (fixes land the same day), and then it
   *  shows again — a reworded line doesn't count. */
  lines() { return CHANGELOG[0].sections.reduce((a, sec) => a + sec.items.length, 0); },
  /** (as of now, nothing in the changelog is news — after the first-run setup too) */
  async markSeen() {
    await DB.kvSet('changelog.seen', this.latest()).catch(() => {});
    await DB.kvSet('changelog.seenLines', this.lines()).catch(() => {});
  },
  /** After the game loads: a returning player gets the entries they haven't seen yet. */
  async maybeShow() {
    const seen = await DB.kvGet('changelog.seen', null).catch(() => null);
    const seenLines = await DB.kvGet('changelog.seenLines', null).catch(() => null);
    if (seen === this.latest() && seenLines >= this.lines()) return;
    // (the game reopened straight into a song — a multiplayer match it was reloaded in: after the song, not over it)
    if (typeof Screens !== 'undefined' && Screens.currentName === 'gameplay') {
      const off = Bus.on('screen:changed', () => { if (Screens.currentName !== 'gameplay') { off(); setTimeout(() => this.maybeShow(), 1200); } });
      return;
    }
    await this.markSeen();
    if (!seen && !ProfileManager.profile.onboarded) return; // brand new: nothing to catch up on
    // (every update since the one you saw — up to three; the whole history is in Settings)
    const at = CHANGELOG.findIndex(e => e.id === seen);
    this.show(CHANGELOG.slice(0, at > 0 ? Math.min(at, 3) : 1));
  },
  show(entries = CHANGELOG) {
    const el = h('div.cl', { role: 'dialog', 'aria-label': 'What\'s new' },
      h('div.cl-head', h('div.cl-hicon', icon('sparkle')), h('div', h('div.cl-title', 'changelog'), h('div.cl-sub', 'what\'s new in Ashtonk!mania')),
        h('button.icon-btn.cl-x', { title: 'Close', 'aria-label': 'Close', onclick: () => o.close() }, icon('x'))),
      h('div.cl-body', ...entries.map(e => h('div.cl-entry',
        h('div.cl-ver', h('span.cl-pill', e.id.replace(/[a-z]$/, '')), h('b', e.title)),
        // (a section named like its update isn't headed again: just its lines)
        ...e.sections.map((sec, si) => h(`div.cl-sec${sec.title === e.title ? '.plain' : ''}`, { style: { animationDelay: `${si * 60}ms` } }, sec.title === e.title ? null : h('div.cl-sech', icon(sec.icon), sec.title),
          h('ul', ...sec.items.map(t => h('li', t)))))))),
      // (and the whole changelog, as the toolbar opens it)
      h('div.cl-foot', h('button.btn.ghost.cl-all', { onclick: () => { o.close(); Screens.go('changelog'); } }, 'All updates'), h('button.btn.primary', { onclick: () => o.close() }, 'Let\'s go!')));
    const o = makeOverlay(el, { flags: ['cl', 'neru-cover'] });
    // (Neru beside it, on her phone — reading it too; behind the dialog, so she never covers a line of it)
    const neru = typeof NeruCameo !== 'undefined' && NeruCameo.make('news', 'nc-news', { delay: 0 });
    if (neru) { o.el.insertBefore(neru, el); NeruCameo.beside(neru, el, o.el); }
    UISounds.play('check-on');
    return o;
  },
};

/** The toolbar's changelog: lazer's ChangelogOverlay, its listing — every update under the day it came out, the build
 *  centred over its changes, which are grouped under bold category titles with a bullet each. (The popup above is
 *  for what's new since you last played.) */
const ChangelogScreen = {
  enter() {
    const tabs = h('button.ov-tab.on', { type: 'button' }, 'listing');
    const { el, page } = pageShell('changelog', 'track recent dev updates in Ashtonk!mania', [], { icon: 'sparkle', hue: 'purple', tabs });
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    // (an update's id is its day — "2026.10.29", with a letter after it for a second one that day)
    const day = id => { const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(id); return m ? `${+m[3]} ${MONTHS[m[2] - 1] || ''} ${m[1]}` : id; };
    const list = h('div.chl');
    let last = null;
    for (const e of CHANGELOG) {
      const d = day(e.id);
      if (d !== last) { last = d; list.append(h('div.chl-date', d)); } else list.append(h('div.chl-sep'));
      list.append(h('div.chl-build',
        h('div.chl-ver', h('span.chl-stream', APP_NAME), h('span.chl-num', e.id)),
        h('div.chl-title', e.title),
        // (a section named like its update isn't headed again, as in the popup)
        ...e.sections.map(sec => h('div.chl-cat',
          sec.title === e.title ? null : h('div.chl-cath', sec.title),
          ...sec.items.map(t => h('div.chl-entry', h('span.chl-dot', '●'), h('span', t)))))));
    }
    page.append(list);
    return el;
  },
};
