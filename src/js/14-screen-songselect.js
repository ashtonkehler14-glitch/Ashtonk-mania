/* Song select — virtualized beatmap carousel, instant fuzzy search with filter syntax,
 * sorting & filters, live audio preview, beatmap info wedge and local leaderboard. */

const SORTS = [
  ['title', 'Title'], ['artist', 'Artist'], ['creator', 'Mapper'], ['stars', 'Star rating'], ['od', 'Difficulty (OD)'],
  ['bpm', 'BPM'], ['length', 'Length'], ['added', 'Date added'], ['lastPlayed', 'Last played'], ['playCount', 'Play count'],
  ['score', 'Best score'], ['accuracy', 'Best accuracy'],
];
const STATUS_FILTERS = [
  ['all', 'All'], ['favorites', 'Favorites'], ['recent', 'Recent'], ['played', 'Played'], ['unplayed', 'Unplayed'],
  ['passed', 'Passed'], ['failed', 'Failed'], ['pb', 'Has PB'], ['mods', 'Passed with current mods'],
];
const STAR_RANGES = [['', 'Any ★'], ['0-2', '0 – 2★'], ['2-3.5', '2 – 3.5★'], ['3.5-5', '3.5 – 5★'], ['5-6.5', '5 – 6.5★'], ['6.5-99', '6.5★ +']];
const BPM_RANGES = [['', 'Any BPM'], ['0-120', '< 120'], ['120-160', '120 – 160'], ['160-200', '160 – 200'], ['200-9999', '200 +']];

const SongSelect = {
  tab: 'songselect',
  query: '', starRange: '', bpmRange: '',
  selectedId: null, expandedSet: null,
  rows: [], ROW_SET: 92, ROW_DIFF: 64,

  enter(params = {}) {
    this.practiceMode = !!params.practice;
    if (params.mapId) this.selectedId = params.mapId;
    else if (!this.selectedId) this.selectedId = Settings.get('last.map');
    const el = h('div.ss');
    this.el = el;
    this.searchInput = h('input.input', { type: 'search', placeholder: 'Search title, artist, mapper, tags…  (try: keys=7 stars>4 bpm>180)', value: this.query, 'aria-label': 'Search beatmaps', spellcheck: 'false' });
    this.searchInput.addEventListener('input', () => { this.query = this.searchInput.value; this.rebuild(true); });
    this.searchInput.addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'Enter', 'F1', 'F2', 'F3', 'F4'].includes(e.key) || (e.key === 'Escape')) {
        if (e.key === 'Escape' && this.searchInput.value) { this.searchInput.value = ''; this.query = ''; this.rebuild(true); e.stopPropagation(); e.preventDefault(); return; }
        this.searchInput.blur();
      } else e.stopPropagation();
    });
    this.countEl = h('span.ss-count');
    const sortSel = h('select.select', { 'aria-label': 'Sort by', title: 'Sort by' }, ...SORTS.map(([v, l]) => h('option', { value: v, selected: Settings.get('songselect.sort') === v }, 'Sort: ' + l)));
    sortSel.addEventListener('change', () => { Settings.set('songselect.sort', sortSel.value); UISounds.click(); this.rebuild(); });
    const statusSel = h('select.select', { 'aria-label': 'Filter', title: 'Filter' }, ...STATUS_FILTERS.map(([v, l]) => h('option', { value: v, selected: Settings.get('songselect.filter') === v }, l)));
    statusSel.addEventListener('change', () => { Settings.set('songselect.filter', statusSel.value); UISounds.click(); this.rebuild(true); });
    const starSel = h('select.select', { 'aria-label': 'Star range' }, ...STAR_RANGES.map(([v, l]) => h('option', { value: v, selected: this.starRange === v }, l)));
    starSel.addEventListener('change', () => { this.starRange = starSel.value; this.rebuild(true); });
    const bpmSel = h('select.select', { 'aria-label': 'BPM range' }, ...BPM_RANGES.map(([v, l]) => h('option', { value: v, selected: this.bpmRange === v }, l)));
    bpmSel.addEventListener('change', () => { this.bpmRange = bpmSel.value; this.rebuild(true); });
    this.collSel = h('select.select', { 'aria-label': 'Collection' });
    this.fillCollections();
    this.collSel.addEventListener('change', () => { Settings.set('songselect.collection', this.collSel.value); UISounds.click(); this.rebuild(true); });
    const keyChips = h('div.row', { style: { gap: '5px' } });
    this.keyChips = keyChips;
    this.renderKeyChips();

    const top = h('div.ss-top',
      h('div.ss-search', icon('search'), this.searchInput), sortSel, statusSel, this.countEl);
    const filters = h('div.ss-filters', keyChips, starSel, bpmSel, this.collSel);

    // left info
    this.info = h('div.ss-info');
    // right carousel
    this.inner = h('div.carousel-inner');
    this.scroller = h('div.carousel-scroll', { tabindex: '-1' }, this.inner);
    this.scroller.addEventListener('scroll', () => this.renderVisible(), { passive: true });
    this.carousel = h('div.carousel', this.scroller);
    this.emptyEl = h('div.ss-empty');
    this.carousel.appendChild(this.emptyEl);

    // footer
    this.modsOn = h('div.mods-on');
    this.pbEl = h('div.muted', { style: { fontSize: '.85rem' } });
    this.playBtn = h('button.ss-cookie', { onclick: () => this.play(), title: 'Play (Enter)', 'aria-label': 'Play' },
      h('span.ring'), h('span.face', icon('play', 'fill')));
    const fb = (label, ic, color, fn, key) => h('button.foot-btn', { style: { '--c': color }, onclick: fn, title: `${label} (${key})` }, h('span.fb-inner', icon(ic), label, h('span.kbd', key)));
    const footer = h('div.ss-footer',
      backButton(() => Screens.back()),
      fb('Mods', 'mods', '#ffcc22', () => ModSelect.open(), 'F1'),
      fb('Random', 'shuffle', '#88dd44', () => this.random(), 'F2'),
      fb('Options', 'list', '#aa77ff', e => this.options(e), 'F3'),
      fb('Practice', 'flag', '#66ccff', () => this.play('practice'), 'F4'),
      this.modsOn, h('div.grow'), this.practiceMode ? h('span.tag.goldtag', 'PRACTICE MODE') : null, this.pbEl, this.playBtn);

    el.append(top, filters, h('div.ss-main', this.info, this.carousel), footer);
    this._unsub = [
      Bus.on('library:changed', () => this.rebuild()),
      Bus.on('mods:changed', () => this.renderMods()),
      Bus.on('favorites:changed', () => this.rebuild()),
      Bus.on('collections:changed', () => { this.fillCollections(); this.rebuild(); }),
      Bus.on('scores:changed', () => { this.rebuild(); this.updateInfo(); }),
    ];
    this._ro = new ResizeObserver(() => this.renderVisible());
    this._ro.observe(this.scroller);
    this.renderMods();
    requestAnimationFrame(() => { this.rebuild(); this.scrollToSelected(false); });
    return el;
  },
  leave() {
    (this._unsub || []).forEach(f => f());
    this._ro && this._ro.disconnect();
    clearTimeout(this._previewT);
  },
  fillCollections() {
    clearEl(this.collSel);
    const cur = Settings.get('songselect.collection');
    this.collSel.append(h('option', { value: '' }, 'All collections'), ...Collections.list.map(c => h('option', { value: c.id, selected: c.id === cur }, `▸ ${c.name} (${c.hashes.length})`)));
  },
  renderKeyChips() {
    const keys = Settings.get('songselect.keys') || [];
    clearEl(this.keyChips);
    for (let k = 1; k <= 9; k++) {
      const on = keys.includes(k);
      this.keyChips.append(h(`button.chip${on ? '.on' : ''}`, {
        title: k === 9 ? '9K and above' : `${k}K`,
        onclick: () => {
          const cur = Settings.get('songselect.keys') || [];
          Settings.set('songselect.keys', cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]);
          UISounds.click(); this.renderKeyChips(); this.rebuild(true);
        },
      }, k === 9 ? '9K+' : `${k}K`));
    }
  },
  renderMods() {
    if (!this.modsOn) return;
    const mods = Settings.get('songselect.mods') || [];
    clearEl(this.modsOn).append(...mods.map(m => ModSystem.badge(m)));
    if (mods.length) this.modsOn.append(h('span.muted', { style: { fontSize: '.8rem', marginLeft: '4px' } }, `${ModSystem.multiplier(mods).toFixed(2)}×`));
  },

  // ── filtering & sorting
  parseQuery(q) {
    const conds = [], words = [];
    const re = /(keys|key|k|stars|star|sr|bpm|length|len|od|hp|ln|lns|played|notes|creator|mapper|artist|title)\s*(<=|>=|=|<|>|:)\s*("[^"]*"|\S+)/gi;
    let rest = q.replace(re, (_, k, op, v) => { conds.push({ k: k.toLowerCase(), op, v: v.replace(/"/g, '').toLowerCase() }); return ' '; });
    for (const w of rest.toLowerCase().split(/\s+/)) if (w) words.push(w);
    return { conds, words };
  },
  mapMatches(m, pq) {
    for (const c of pq.conds) {
      const num = parseFloat(c.v);
      let val;
      switch (c.k) {
        case 'keys': case 'key': case 'k': val = m.keys; break;
        case 'stars': case 'star': case 'sr': val = m.stars; break;
        case 'bpm': val = m.bpm; break;
        case 'length': case 'len': val = m.length / 1000; break;
        case 'od': val = m.od; break;
        case 'hp': val = m.hp; break;
        case 'ln': case 'lns': val = m.lnRatio * 100; break;
        case 'notes': val = m.objectCount; break;
        case 'played': val = ScoreManager.playCount(m.hash); break;
        case 'creator': case 'mapper': if (!m.creator.toLowerCase().includes(c.v)) return false; continue;
        case 'artist': if (!(m.artist + ' ' + m.artistUnicode).toLowerCase().includes(c.v)) return false; continue;
        case 'title': if (!(m.title + ' ' + m.titleUnicode).toLowerCase().includes(c.v)) return false; continue;
      }
      if (!isFinite(num)) continue;
      const ok = c.op === '<' ? val < num : c.op === '>' ? val > num : c.op === '<=' ? val <= num : c.op === '>=' ? val >= num : Math.abs(val - num) < (c.k.startsWith('st') || c.k === 'sr' ? 0.5 : 0.5001);
      if (!ok) return false;
    }
    return true;
  },
  rebuild(keepScroll = false) {
    if (!this.el) return;
    const pq = this.parseQuery(this.query.trim());
    const keys = Settings.get('songselect.keys') || [];
    const status = Settings.get('songselect.filter');
    const collId = Settings.get('songselect.collection');
    const coll = collId ? Collections.get(collId) : null;
    const mods = Settings.get('songselect.mods') || [];
    const [smin, smax] = this.starRange ? this.starRange.split('-').map(Number) : [0, 1e9];
    const [bmin, bmax] = this.bpmRange ? this.bpmRange.split('-').map(Number) : [0, 1e9];
    const weekAgo = Date.now() - 7 * 86400000;
    const results = [];
    for (const set of BeatmapManager.sets) {
      if (status === 'favorites' && !Favorites.has(set.id)) continue;
      const hay = `${set.artist} ${set.artistUnicode} ${set.title} ${set.titleUnicode} ${set.creator} ${set.source} ${set.tags}`;
      let setScore = 0;
      if (pq.words.length) {
        setScore = 1;
        for (const w of pq.words) {
          let best = fuzzyScore(hay, w);
          for (const m of set.maps) best = Math.max(best, fuzzyScore(m.version, w) * 0.9);
          if (!best) { setScore = 0; break; }
          setScore += best;
        }
        if (!setScore) continue;
      }
      const maps = set.maps.filter(m => {
        if (pq.words.length && !pq.words.every(w => fuzzyScore(hay + ' ' + m.version, w) > 0)) return false;
        if (keys.length && !keys.some(k => k === 9 ? m.keys >= 9 : m.keys === k)) return false;
        if (m.stars < smin || m.stars >= smax) return false;
        if (this.bpmRange && (m.bpm < bmin || m.bpm >= bmax)) return false;
        if (coll && !coll.hashes.includes(m.hash)) return false;
        if (!this.mapMatches(m, pq)) return false;
        if (status !== 'all' && status !== 'favorites') {
          const pc = ScoreManager.playCount(m.hash), best = ScoreManager.best(m.hash);
          if (status === 'played' && !pc) return false;
          if (status === 'unplayed' && pc) return false;
          if (status === 'passed' && !best) return false;
          if (status === 'failed' && (!pc || best)) return false;
          if (status === 'pb' && !best) return false;
          if (status === 'recent' && ScoreManager.lastPlayed(m.hash) < weekAgo) return false;
          if (status === 'mods' && !ScoreManager.forMap(m.hash).some(s => s.passed && ModSystem.label(s.mods) === ModSystem.label(mods))) return false;
        }
        return true;
      });
      if (!maps.length) continue;
      results.push({ set, maps, score: setScore });
    }
    const sort = Settings.get('songselect.sort');
    const agg = (r, f, mode = 'max') => r.maps.reduce((a, m) => mode === 'max' ? Math.max(a, f(m)) : Math.min(a, f(m)), mode === 'max' ? -Infinity : Infinity);
    const cmp = {
      title: (a, b) => a.set.title.localeCompare(b.set.title), artist: (a, b) => a.set.artist.localeCompare(b.set.artist) || a.set.title.localeCompare(b.set.title),
      creator: (a, b) => a.set.creator.localeCompare(b.set.creator), stars: (a, b) => agg(a, m => m.stars) - agg(b, m => m.stars),
      od: (a, b) => agg(a, m => m.od) - agg(b, m => m.od), bpm: (a, b) => agg(a, m => m.bpm) - agg(b, m => m.bpm),
      length: (a, b) => agg(a, m => m.length) - agg(b, m => m.length), added: (a, b) => b.set.added - a.set.added,
      lastPlayed: (a, b) => agg(b, m => ScoreManager.lastPlayed(m.hash)) - agg(a, m => ScoreManager.lastPlayed(m.hash)),
      playCount: (a, b) => b.maps.reduce((x, m) => x + ScoreManager.playCount(m.hash), 0) - a.maps.reduce((x, m) => x + ScoreManager.playCount(m.hash), 0),
      score: (a, b) => agg(b, m => ScoreManager.best(m.hash)?.score || 0) - agg(a, m => ScoreManager.best(m.hash)?.score || 0),
      accuracy: (a, b) => agg(b, m => ScoreManager.best(m.hash)?.accuracy || 0) - agg(a, m => ScoreManager.best(m.hash)?.accuracy || 0),
    }[sort] || ((a, b) => a.set.title.localeCompare(b.set.title));
    results.sort((a, b) => (pq.words.length && sort === 'title' ? b.score - a.score : 0) || cmp(a, b) || a.set.title.localeCompare(b.set.title));
    this.results = results;
    // ensure selection is visible
    const allVisible = new Map();
    for (const r of results) for (const m of r.maps) allVisible.set(m.id, r);
    if (!this.selectedId || !allVisible.has(this.selectedId)) {
      const first = results[0];
      this.selectedId = first ? (first.maps.find(m => !m.problems.length) || first.maps[0]).id : null;
    }
    this.expandedSet = this.selectedId ? BeatmapManager.maps.get(this.selectedId)?.setId : null;
    this.layoutRows();
    const nDiffs = results.reduce((a, r) => a + r.maps.length, 0);
    this.countEl.textContent = `${results.length} set${results.length === 1 ? '' : 's'} · ${nDiffs} difficult${nDiffs === 1 ? 'y' : 'ies'}`;
    this.renderEmpty();
    this.updateInfo();
    this.renderVisible(true);
    if (!keepScroll) this.scrollToSelected(false); else this.scrollToSelected(true);
  },
  layoutRows() {
    const rows = [];
    let y = 12;
    for (const r of this.results) {
      rows.push({ type: 'set', r, y, h: this.ROW_SET });
      y += this.ROW_SET;
      if (r.set.id === this.expandedSet) {
        for (const m of r.maps) { rows.push({ type: 'diff', r, m, y, h: this.ROW_DIFF }); y += this.ROW_DIFF; }
        y += 8;
      }
    }
    this.rows = rows;
    this.totalH = y + 200;
    this.inner.style.height = this.totalH + 'px';
    this.pool = this.pool || new Map();
  },
  renderEmpty() {
    clearEl(this.emptyEl);
    this.emptyEl.style.display = this.results.length ? 'none' : '';
    if (this.results.length) return;
    if (!BeatmapManager.sets.length) {
      this.emptyEl.append(h('div.box', h('h2', 'Your library is empty'),
        h('p', 'Drag & drop .osz files (or a folder of beatmaps) anywhere on this window, or import them here.'),
        h('div.row', { style: { justifyContent: 'center', marginTop: '14px' } },
          h('button.btn.primary', { onclick: () => importViaPicker('.osz,.osu,.osk,.amr,.json') }, icon('upload'), 'Import files'),
          h('button.btn', { onclick: () => importViaPicker('', true) }, icon('folder'), 'Import folder'))));
    } else {
      this.emptyEl.append(h('div.box', h('h2', 'No matches'), h('p', 'Nothing matches your search and filters.'),
        h('button.btn', { onclick: () => this.clearFilters() }, 'Clear filters')));
    }
  },
  clearFilters() {
    this.query = ''; this.searchInput.value = ''; this.starRange = ''; this.bpmRange = '';
    Settings.set('songselect.keys', []); Settings.set('songselect.filter', 'all'); Settings.set('songselect.collection', '');
    Screens.go('songselect', { force: true }, { replace: true });
  },
  renderVisible(force = false) {
    if (!this.rows) return;
    const st = this.scroller.scrollTop, vh = this.scroller.clientHeight || 600;
    const from = st - 200, to = st + vh + 200;
    const center = st + vh / 2;
    const needed = new Set();
    for (const row of this.rows) {
      if (row.y + row.h < from || row.y > to) continue;
      const key = row.type === 'set' ? 's:' + row.r.set.id : 'd:' + row.m.id;
      needed.add(key);
      let el = this.pool.get(key);
      if (!el || force) {
        if (el) el.remove();
        el = this.renderRow(row);
        this.pool.set(key, el);
        this.inner.appendChild(el);
      }
      const d = (row.y + row.h / 2 - center) / vh;
      el.style.transform = `translate(${Math.round(d * d * 70)}px, ${row.y}px)`;
    }
    for (const [k, el] of this.pool) if (!needed.has(k)) { el.remove(); this.pool.delete(k); }
  },
  renderRow(row) {
    const wrap = h('div.c-item', { style: { height: row.h + 'px' } });
    if (row.type === 'set') {
      const { set, maps } = row.r;
      const broken = maps.every(m => m.problems.length);
      const bg = h('div.sp-bg');
      BeatmapManager.thumbURL(set).then(u => { if (u) bg.style.backgroundImage = `url("${u}")`; });
      const btn = h(`button.set-panel${set.id === this.expandedSet ? '.expanded' : ''}${broken ? '.broken' : ''}`, {
        onclick: () => {
          UISounds.click();
          if (this.expandedSet === set.id) return;
          const pick = maps.find(m => !m.problems.length) || maps[0];
          this.select(pick.id);
        },
        oncontextmenu: e => { e.preventDefault(); this.options(e, maps[0]); },
      }, bg, h('div.sp-body',
        h('div.sp-t', set.title),
        h('div.sp-a', `${set.artist} · mapped by ${set.creator}`),
        h('div.sp-dots', ...maps.slice(0, 18).map(m => h('i', { style: { '--sc': starColour(m.stars) }, title: `[${m.version}] ${m.stars.toFixed(2)}★ ${m.keys}K` })),
          maps.length > 18 ? h('span.muted', { style: { fontSize: '.72rem' } }, `+${maps.length - 18}`) : null,
          broken ? h('span.tag.warn', 'Broken') : null)),
      Favorites.has(set.id) ? h('span.sp-fav', icon('heart', 'fill')) : null);
      btn.addEventListener('pointerenter', () => UISounds.hover());
      wrap.appendChild(btn);
    } else {
      const m = row.m;
      const best = ScoreManager.best(m.hash);
      const btn = h(`button.diff-panel${m.id === this.selectedId ? '.selected' : ''}${m.problems.length ? '.broken' : ''}`, {
        style: { '--sc': starColour(m.stars) },
        onclick: () => { if (this.selectedId === m.id) this.play(); else { UISounds.click(); this.select(m.id); } },
        oncontextmenu: e => { e.preventDefault(); this.select(m.id); this.options(e, m); },
        title: m.problems.length ? m.problems.join('\n') : '',
      }, h('span.dp-icon', { style: { '--sc': starColour(m.stars) }, title: `${m.stars.toFixed(2)}★` }, `${m.keys}K`),
      best ? gradeEl(best.grade) : h('span', { style: { width: '34px' } }),
      h('div.dp-main', h('div.dp-v', m.version), h('div.dp-s', h('span', `${m.keys}K`), h('span', `${Math.round(m.bpm)} BPM`), h('span', fmtTime(m.length)), m.lnCount ? h('span', `${Math.round(m.lnRatio * 100)}% LN`) : null,
        m.problems.length ? h('span', { style: { color: '#ff9aa6' } }, '⚠ ' + m.problems[0]) : null)),
      starBadge(m.stars));
      btn.addEventListener('pointerenter', () => UISounds.hover());
      wrap.appendChild(btn);
    }
    return wrap;
  },
  select(id, { scroll = true } = {}) {
    const m = BeatmapManager.maps.get(id);
    if (!m) return;
    const setChanged = this.expandedSet !== m.setId;
    this.selectedId = id;
    this.expandedSet = m.setId;
    Settings.set('last.map', id);
    this.layoutRows();
    this.renderVisible(true);
    if (scroll) this.scrollToSelected(true);
    this.updateInfo();
    if (setChanged || !Music.meta || Music.meta.setId !== m.setId) this.schedulePreview(m);
  },
  scrollToSelected(smooth) {
    const row = this.rows.find(r => r.type === 'diff' && r.m.id === this.selectedId) || this.rows.find(r => r.type === 'set' && r.r.set.id === this.expandedSet);
    if (!row) return;
    const vh = this.scroller.clientHeight || 600;
    const top = Math.max(0, row.y - vh / 2 + row.h / 2);
    this.scroller.scrollTo({ top, behavior: smooth && Settings.get('ui.animSpeed') > 0 ? 'smooth' : 'auto' });
    this.renderVisible();
  },
  // keyboard navigation
  flatMaps() { return this.results ? this.results.flatMap(r => r.maps) : []; },
  moveDiff(d) {
    const flat = this.flatMaps();
    if (!flat.length) return;
    const i = flat.findIndex(m => m.id === this.selectedId);
    const n = flat[clamp(i + d, 0, flat.length - 1)];
    if (n && n.id !== this.selectedId) { UISounds.hover(); this.select(n.id); }
  },
  moveSet(d) {
    if (!this.results || !this.results.length) return;
    const i = this.results.findIndex(r => r.set.id === this.expandedSet);
    const r = this.results[clamp(i + d, 0, this.results.length - 1)];
    if (!r || r.set.id === this.expandedSet) return;
    const cur = BeatmapManager.maps.get(this.selectedId);
    const target = cur ? r.maps.reduce((a, m) => Math.abs(m.stars - cur.stars) < Math.abs(a.stars - cur.stars) ? m : a, r.maps[0]) : r.maps[0];
    UISounds.click(); this.select(target.id);
  },
  random() {
    const flat = this.flatMaps().filter(m => !m.problems.length);
    if (!flat.length) return;
    UISounds.click();
    this.select(flat[Math.floor(Math.random() * flat.length)].id);
  },
  onKey(e) {
    if (e.target === this.searchInput) return false;
    switch (e.key) {
      case 'ArrowDown': this.moveDiff(1); return true;
      case 'ArrowUp': this.moveDiff(-1); return true;
      case 'ArrowRight': this.moveSet(1); return true;
      case 'ArrowLeft': this.moveSet(-1); return true;
      case 'PageDown': this.moveSet(5); return true;
      case 'PageUp': this.moveSet(-5); return true;
      case 'Enter': this.play(e.ctrlKey ? 'auto' : 'play'); return true;
      case 'F1': ModSelect.open(); return true;
      case 'F2': this.random(); return true;
      case 'F3': this.options(); return true;
      case 'F4': this.play('practice'); return true;
      case 'Delete': if (e.shiftKey) { this.deleteSet(); return true; } return false;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
      this.searchInput.focus();
      return false; // let the character go into the box
    }
    if (e.key === 'Backspace' && this.query) { this.searchInput.focus(); return false; }
    return false;
  },
  onBack() {
    if (this.query) { this.query = ''; this.searchInput.value = ''; this.rebuild(true); return true; }
    return false;
  },

  // ── preview audio & background
  schedulePreview(m) {
    clearTimeout(this._previewT);
    this._previewT = setTimeout(() => this.preview(m), 180);
  },
  async preview(m) {
    const url = await BeatmapManager.bgURL(m) || await BeatmapManager.thumbURL(BeatmapManager.setById.get(m.setId));
    if (this.selectedId === m.id || BeatmapManager.maps.get(this.selectedId)?.setId === m.setId) Background.set(url);
    if (!Settings.get('audio.previewAudio') || m.problems.length) return;
    try {
      await AudioManager.resume();
      const buf = await TrackCache.get(m.setId, m.audioFile);
      if (BeatmapManager.maps.get(this.selectedId)?.setId !== m.setId) return;
      const parsed = await BeatmapManager.load(m.id).catch(() => null);
      const timing = parsed ? BeatmapParser.timing(parsed.bm).red.map(r => ({ time: r.time, beatLength: r.beatLength })) : null;
      if (Music.playing) Music.stop(250);
      await Music.load(buf, `${m.setId}/${m.audioFile}`, { setId: m.setId, mapId: m.id, timing });
      await Music.setRate(1, false);
      const start = m.previewTime >= 0 ? m.previewTime : Math.round(buf.duration * 400);
      Music.play(start, { fadeIn: 600 });
      Music.onEnded = () => { if (Screens.currentName === 'songselect') Music.play(start, { fadeIn: 600 }); };
      Toolbar.setNowPlaying(m);
    } catch (e) { console.warn('preview failed', e); }
  },

  updateInfo() {
    if (!this.info) return;
    clearEl(this.info);
    const m = this.selectedId && BeatmapManager.maps.get(this.selectedId);
    if (!m) { this.playBtn && (this.playBtn.disabled = true); this.pbEl.textContent = ''; return; }
    this.playBtn.disabled = m.problems.length > 0;
    const set = BeatmapManager.setById.get(m.setId);
    const bg = h('div.w-bg');
    BeatmapManager.bgURL(m).then(u => { if (u) bg.style.backgroundImage = `url("${u}")`; else BeatmapManager.thumbURL(set).then(t => t && (bg.style.backgroundImage = `url("${t}")`)); });
    const fav = Favorites.has(set.id);
    const favBtn = h(`button.icon-btn${fav ? '.on' : ''}`, { title: fav ? 'Unfavorite' : 'Favorite', 'aria-label': 'Favorite', onclick: async () => { UISounds.click(); await Favorites.toggle(set.id); } }, icon('heart', fav ? 'fill' : ''));
    const collBtn = h('button.icon-btn', { title: 'Add to collection', 'aria-label': 'Add to collection', onclick: e => this.collectionMenu(e, m) }, icon('folder'));
    const wedge = h('div.wedge', bg, h('div.w-body',
      h('div.w-top', h('span.keys-tag', `${m.keys}K`), m.lnCount ? h('span.tag', `${Math.round(m.lnRatio * 100)}% LN`) : null,
        set.storyboard ? h('span.tag', { title: 'Storyboards are detected but not rendered' }, 'Storyboard') : null,
        m.warnings.length ? h('span.tag.warn', { title: m.warnings.join('\n') }, '⚠') : null, h('span.grow'), collBtn, favBtn),
      h('div.w-title', m.title), h('div.w-artist', m.artist),
      h('div.w-diff', starBadge(m.stars), h('span', `[${m.version}]`)),
      h('div.w-mapper', 'mapped by ', h('b', m.creator), m.source ? ` · ${m.source}` : '')));
    const bpm = m.bpmMin !== m.bpmMax ? `${Math.round(m.bpmMin)}–${Math.round(m.bpmMax)}` : Math.round(m.bpm);
    const mods = Settings.get('songselect.mods') || [];
    const rate = ModSystem.rate(mods);
    const strip = h('div.stat-strip',
      ...[['Length', fmtTime(m.length / rate)], ['BPM', rate !== 1 ? Math.round(m.bpm * rate) : bpm], ['Notes', fmtInt(m.noteCount)], ['Long notes', fmtInt(m.lnCount)], ['Keys', m.keys + 'K'], ['NPS', (m.nps * rate).toFixed(1)]]
        .map(([k, v]) => h('div.stat', h('div.k', k), h('div.v', String(v)))));
    const bar = (label, v, max = 10) => [h('span.muted', label), h('div.bar', h('i', { style: { width: clamp(v / max * 100, 0, 100) + '%' } })), h('span.num', v.toFixed(1))];
    const diffbars = h('div.panel.diffbars', ...bar('Overall difficulty', m.od), ...bar('HP drain', m.hp), ...bar('Star rating', m.stars));
    const problems = m.problems.length ? h('div.panel', { style: { padding: '12px 14px', borderColor: 'rgba(255,74,92,.4)' } },
      h('b', { style: { color: '#ffb3bb' } }, 'This difficulty can\'t be played'), h('div.muted', { style: { fontSize: '.85rem', marginTop: '4px' } }, m.problems.join(' · '))) : null;
    const lb = h('div.panel.lb', h('div.lb-head', icon('list'), 'Local scores', h('span.grow'), h('span', `${ScoreManager.playCount(m.hash)} plays`)));
    const list = h('div.lb-list');
    const scores = ScoreManager.forMap(m.hash).slice(0, 25);
    const best = ScoreManager.best(m.hash);
    if (!scores.length) list.append(h('div.empty', { style: { padding: '20px' } }, 'No scores yet. Be the first!'));
    scores.forEach((s, i) => {
      const row = h(`button.lb-row${best && s.id === best.id ? '.pb' : ''}`, { style: { animationDelay: `${i * 25}ms` }, onclick: () => { UISounds.click(); Screens.go('results', { score: s, fromList: true }, { transition: 'right' }); } },
        h('span.rank', String(i + 1)), gradeEl(s.grade),
        h('div.main', h('div.sc', fmtScore(s.score)), h('div.meta', `${fmtAcc(s.accuracy)} · ${fmtInt(s.maxCombo)}x · ${s.passed ? fmtInt(ScoreManager.ppOf(s)) + 'pp' : 'failed'} · ${fmtDate(s.date)}`)),
        h('span.row', { style: { gap: '3px' } }, ...(s.mods || []).map(x => ModSystem.badge(x, true)), s.replayId ? icon('film') : null));
      list.append(row);
    });
    lb.append(list);
    this.info.append(...[wedge, strip, diffbars, problems, lb].filter(Boolean));
    this.pbEl.textContent = best ? `PB ${fmtScore(best.score)} · ${fmtAcc(best.accuracy)}` : '';
  },

  collectionMenu(e, m) {
    const r = (e.currentTarget || e.target).getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { header: 'Add to collection' },
      ...Collections.list.map(c => ({ label: c.name, icon: 'folder', checked: c.hashes.includes(m.hash), onClick: async () => { const on = await Collections.toggle(c.id, m.hash); Toast.show(on ? `Added to ${c.name}` : `Removed from ${c.name}`); } })),
      { sep: true },
      { label: 'New collection…', icon: 'plus', onClick: async () => { const n = await Dialog.prompt('New collection', '', { ok: 'Create' }); if (n) { const c = await Collections.create(n); await Collections.toggle(c.id, m.hash); Toast.ok(`Added to ${c.name}`); } } },
    ]);
  },
  options(e, m) {
    m = m || BeatmapManager.maps.get(this.selectedId);
    if (!m) return;
    const set = BeatmapManager.setById.get(m.setId);
    const x = e && e.clientX ? e.clientX : innerWidth / 2 - 110, y = e && e.clientY ? e.clientY - 10 : innerHeight - 320;
    showMenu(x, y, [
      { header: `${set.title} [${m.version}]` },
      { label: 'Play', icon: 'play', onClick: () => this.play() },
      { label: 'Practice', icon: 'flag', onClick: () => this.play('practice') },
      { label: 'Watch Auto', icon: 'film', onClick: () => this.play('auto') },
      { sep: true },
      { label: Favorites.has(set.id) ? 'Remove from favorites' : 'Add to favorites', icon: 'heart', onClick: () => Favorites.toggle(set.id) },
      { label: 'Manage collections…', icon: 'folder', onClick: () => this.collectionMenu({ target: this.playBtn }, m) },
      { sep: true },
      { label: 'Export .osz', icon: 'download', onClick: () => BeatmapManager.exportOsz(set.id) },
      { label: 'Delete beatmap set…', icon: 'trash', onClick: () => this.deleteSet(set) },
    ]);
  },
  async deleteSet(set) {
    set = set || BeatmapManager.setById.get(BeatmapManager.maps.get(this.selectedId)?.setId);
    if (!set) return;
    if (await Dialog.confirm('Delete beatmap set?', `${set.artist} - ${set.title} (${set.maps.length} difficulties) will be removed from your library. Scores are kept.`, { ok: 'Delete', danger: true })) {
      if (Music.meta && Music.meta.setId === set.id) Music.stop(200);
      await BeatmapManager.removeSet(set.id);
      Toast.show('Beatmap set deleted');
    }
  },
  play(mode = 'play') {
    if (mode === 'play' && this.practiceMode) mode = 'practice';
    const m = BeatmapManager.maps.get(this.selectedId);
    if (!m) return;
    if (m.problems.length) { Toast.err('Can\'t play this difficulty', m.problems.join('\n')); return; }
    UISounds.click();
    const mods = Settings.get('songselect.mods') || [];
    Game.launch({ mapId: m.id, mods: mode === 'auto' ? ModSystem.normalize([...mods.filter(x => !MOD_BY_ID.get('AT').incompatible.includes(x)), 'AT']) : mods, mode: mode === 'auto' ? 'play' : mode });
  },
};
