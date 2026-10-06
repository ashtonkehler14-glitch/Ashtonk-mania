/* Song select — virtualized beatmap carousel, instant fuzzy search with filter syntax,
 * sorting & filters, live audio preview, beatmap info wedge and local leaderboard. */

// lazer's SortMode (in its order), then a few of our own
const SORTS = [
  ['artist', 'Artist'], ['creator', 'Author'], ['bpm', 'BPM'], ['added', 'Date Added'], ['ranked', 'Date Ranked'], ['submitted', 'Date Submitted'],
  ['stars', 'Difficulty'], ['lastPlayed', 'Last Played'], ['length', 'Length'], ['source', 'Source'], ['title', 'Title'],
  ['playCount', 'Play Count'], ['score', 'Best Score'], ['accuracy', 'Best Accuracy'],
];
// lazer's GroupMode (mania's "Variant" is its key count)
const GROUPS = [
  ['none', 'None'], ['artist', 'Artist'], ['creator', 'Author'], ['bpm', 'BPM'], ['collections', 'Collections'], ['added', 'Date Added'],
  ['ranked', 'Date Ranked'], ['stars', 'Difficulty'], ['favourites', 'Favourites'], ['lastPlayed', 'Last Played'], ['length', 'Length'],
  ['mine', 'My Maps'], ['rank', 'Rank Achieved'], ['status', 'Ranked Status'], ['source', 'Source'], ['title', 'Title'], ['keys', 'Key Count'],
];
const RANK_ORDER = ['XH', 'SS', 'SH', 'S', 'A', 'B', 'C', 'D', 'F'];
const STATUS_GROUP = { ranked: 0, approved: 0, qualified: 1, wip: 2, pending: 3, graveyard: 4, modified: 5, none: 6, loved: 7 };
/** A date as milliseconds (timestamps, ISO strings), 0 if there isn't one. */
const dateMs = v => !v ? 0 : typeof v === 'number' ? v : (Date.parse(v) || 0);
/** osu!lazer's BeatmapSetOnlineStatusPill: the set's online status in its colour (OsuColour.ForBeatmapSetOnlineStatus),
 *  bold black capitals (grey-green on the graveyard's black). A set with no known status shows no pill at all, as in
 *  lazer (its status is looked up online when the set has an online id — BeatmapStatus). */
const ONLINE_STATUS = {
  ranked: ['RANKED', '#b3ff66'], approved: ['APPROVED', '#b3ff66'], qualified: ['QUALIFIED', '#66ccff'], loved: ['LOVED', '#ff66ab'],
  pending: ['PENDING', '#ffd966'], wip: ['WIP', '#ff9966'], graveyard: ['GRAVEYARD', '#000000'], modified: ['MODIFIED', '#ff4500'], none: ['UNKNOWN', '#bc8f8f'],
};
function statusPill(status, cls = '') {
  const known = ONLINE_STATUS[String(status || 'none').toLowerCase()];
  if (!known || known === ONLINE_STATUS.none) return null;
  const [label, bg] = known;
  return h(`span.status-pill${cls}`, { style: { background: bg, color: status === 'graveyard' ? '#4d7365' : '#000' } }, label);
}

const SongSelect = {
  tab: 'songselect',
  query: '',
  selectedId: null, expandedSet: null,
  rows: [], pool: new Map(), ROW_SET: 72, ROW_DIFF: 45, ROW_GROUP: 54, ROW_GAP: 3, // (lazer's PanelBeatmapSet / PanelBeatmap / PanelGroup heights)

  enter(params = {}) {
    this.practiceMode = !!params.practice;
    this.mpPick = !!params.mpPick && Multiplayer.inRoom();
    if (params.mapId) this.selectedId = params.mapId;
    else if (!this.selectedId) this.selectedId = Settings.get('last.map');
    const el = h('div.ss.entering');
    this.el = el;
    setTimeout(() => el.classList.remove('entering'), 900);
    this.searchInput = h('input.input', { type: 'search', placeholder: 'type to search', title: 'Filters: keys=7 stars>4 bpm>180 od>8 length<120 ln>30', value: this.query, 'aria-label': 'Search beatmaps', spellcheck: 'false' });
    this.searchInput.addEventListener('input', () => { this.query = this.searchInput.value; this.rebuild(true); });
    this.searchInput.addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'Enter', 'F1', 'F2', 'F3', 'F4'].includes(e.key) || (e.key === 'Escape')) {
        if (e.key === 'Escape' && this.searchInput.value) { this.searchInput.value = ''; this.query = ''; this.rebuild(true); e.stopPropagation(); e.preventDefault(); return; }
        this.searchInput.blur();
      } else e.stopPropagation();
    });
    this.countEl = h('span.ss-count');
    const sel = (label, opts, cur, fn) => {
      const el = h('select.select', { 'aria-label': label, title: label }, ...opts.map(([v, l]) => h('option', { value: v, selected: cur === v }, l)));
      el.addEventListener('change', () => { UISounds.click(); fn(el.value); });
      return h('label.ss-sel', h('span', label), el);
    };
    const keysNow = (Settings.get('songselect.keys') || [])[0] || '';
    this.collSel = h('select.select', { 'aria-label': 'Collection' });
    this.fillCollections();
    this.collSel.addEventListener('change', () => { Settings.set('songselect.collection', this.collSel.value); UISounds.click(); this.rebuild(true); });
    // lazer's FilterControl: the search box (with "N matches" under what's typed), the star range and (where lazer
    // has "Show converts", which mania-only maps don't need) the key count, then Sort, Group and Collection
    const filters = h('div.ss-filter',
      h('div.ss-search', icon('search'), this.searchInput, this.countEl),
      h('div.ss-filter-row.ss-row2',
        this.starRange(),
        // every key count in your library (and the one picked, if it's no longer there), each on its own
        sel('Keys', [['', 'All'], ...[...new Set([...[...BeatmapManager.maps.values()].filter(m => !m.problems.length).map(m => m.keys), ...(keysNow ? [+keysNow] : [])])].sort((a, b) => a - b).map(k => [String(k), k + 'K'])], String(keysNow), v => { Settings.set('songselect.keys', v ? [+v] : []); this.rebuild(true); })),
      h('div.ss-filter-row.ss-row3',
        sel('Sort', SORTS, Settings.get('songselect.sort'), v => { Settings.set('songselect.sort', v); this.rebuild(); }),
        sel('Group', GROUPS, Settings.get('songselect.group'), v => { Settings.set('songselect.group', v); this.expandedGroup = undefined; this.rebuild(); }),
        h('label.ss-sel.ss-coll', h('span', 'Collection'), this.collSel)));

    // left info
    this.info = h('div.ss-info');
    // right carousel
    this.inner = h('div.carousel-inner');
    this.scroller = h('div.carousel-scroll', { tabindex: '-1' }, this.inner);
    this.scroller.addEventListener('scroll', () => {
      // the panels run past the right edge, so focusing one (a click) made the browser scroll the list sideways and
      // cut every panel's left edge off; the list only ever scrolls up and down
      if (this.scroller.scrollLeft) this.scroller.scrollLeft = 0;
      // while the list scrolls the panels follow the curve at once; otherwise (a panel opening) they ease along
      this.scroller.classList.add('scrolling');
      clearTimeout(this._scrollingT); this._scrollingT = setTimeout(() => this.scroller.classList.remove('scrolling'), 120);
      this.renderVisible();
      // panels fade out under the filter once the list is scrolled, instead of being cut off at its edge
      const sc = this.scroller, under = sc.scrollTop > 4;
      if (under !== sc.classList.contains('under')) sc.classList.toggle('under', under);
    }, { passive: true });
    // lazer's right-mouse absolute scroll: hold the right button beside the panels and the list jumps to that point
    // (top of the area = start of the list, bottom = end), following the pointer while held
    this.scroller.addEventListener('pointerdown', e => {
      if (e.button !== 2 || e.target.closest('.set-panel, .diff-panel')) return;
      const sc = this.scroller;
      const to = ev => { const r = sc.getBoundingClientRect(), f = clamp((ev.clientY - r.top) / r.height, 0, 1); sc.scrollTop = f * (sc.scrollHeight - sc.clientHeight); };
      const up = () => { sc.removeEventListener('pointermove', to); sc.removeEventListener('pointerup', up); sc.removeEventListener('pointercancel', up); };
      sc.setPointerCapture(e.pointerId);
      sc.addEventListener('pointermove', to); sc.addEventListener('pointerup', up); sc.addEventListener('pointercancel', up);
      to(e);
    });
    // (the viewport height, kept by a ResizeObserver: reading clientHeight right after re-rendering rows forced a layout)
    this._vh = 0;
    new ResizeObserver(es => { this._vh = es[0].contentRect.height; }).observe(this.scroller);
    this.carousel = h('div.carousel', this.scroller);
    this.emptyEl = h('div.ss-empty');
    this.carousel.appendChild(this.emptyEl);
    const right = h('div.ss-right', filters, this.carousel);

    // footer
    // lazer's FooterButtonMods: with mods on, a 30px bar stands on the Mods button — their icons, and the score
    // multiplier (red above 1, lime below) — and an orange UNRANKED badge beside it when they give no pp
    this.modIcons = h('span.fb-modicons'); this.modMult = h('b.fb-mult');
    this.modBar = h('span.fb-modbar', { onclick: e => e.stopPropagation() }, this.modIcons, this.modMult);
    this.unrankedEl = h('span.fb-unranked', { title: 'Performance points will not be granted due to active mods.', onclick: e => e.stopPropagation() }, h('b', 'UNRANKED'));
    this.playBtn = h('button.ss-cookie', { onclick: () => this.play(), title: 'Play (Enter)', 'aria-label': 'Play' },
      // lazer's OsuLogo at 40% (205px), centred 76px from the right and 36px from the bottom, hanging off the corner
      h('span.ss-logo', this.logoBeat = h('span.ss-logo-beat', h('span.lz-cookie-disc.lz-home-disc'), h('span.lz-ring', h('span.lz-cookie-text', 'ashtonk!', h('small', 'mania'))))));
    // lazer's ScreenFooterButtons: sheared 116×75 buttons standing up out of the footer, icon over the label and an
    // accent bar along the bottom (Mods Lime1, Random Blue1, Options Purple1)
    const fb = (label, color, ic, fn, key) => h('button.foot-btn', { style: { '--c': color }, onclick: fn, title: `${label} (${key})` }, h('span.fb-inner', icon(ic), h('span.fb-t', label)), h('i.fb-bar'));
    const footer = h('div.ss-footer',
      backButton(() => Screens.back()),
      this.modBtn = (() => { const b = fb('Mods', '#b2ff66', 'mods', () => this.openMods(), 'F1 · right-click to deselect all'); b.classList.add('fb-mods'); b.append(this.modBar, this.unrankedEl); b.addEventListener('contextmenu', e => { e.preventDefault(); if ((Settings.get('songselect.mods') || []).length) { UISounds.click(); Settings.set('songselect.mods', []); Bus.emit('mods:changed'); } }); return b; })(),
      (() => { const b = fb('Random', '#66ccff', 'shuffle', () => this.random(), 'F2 · right-click or Shift+F2 to rewind'); b.addEventListener('contextmenu', e => { e.preventDefault(); this.randomRewind(); }); return b; })(),
      this.optionsBtn = fb('Options', '#8c66ff', 'gear', e => this.options(e), 'F3'),
      h('div.grow'), this.practiceMode ? h('span.tag.goldtag', 'Practice') : null, this.mpPick ? h('span.tag.accent', 'Choose the match beatmap') : null, this.playBtn);

    el.append(h('div.ss-main', this.info, right), footer);
    this._lbKey = this._infoSet = this._infoMap = null; // (the leaderboard and wedges slide in each time the screen opens)
    this._unsub = [
      Bus.on('library:changed', () => this.rebuild(false, true)),
      // (the selected beatmap's user tags came in)
      Bus.on('tags', key => { const cur = BeatmapManager.maps.get(this.selectedId); if (cur && cur.hash === key) { this._lbKey = null; this.updateInfo(); } }),
      Bus.on('mods:changed', () => { this.renderMods(); this.updateInfo(); this.renderVisible(true); }), // (BPM, length and stars follow the mods)
      Bus.on('favorites:changed', () => this.rebuild(false, true)),
      Bus.on('collections:changed', () => { this.fillCollections(); this.rebuild(false, true); }),
      Bus.on('scores:changed', () => { this.rebuild(false, true); this.updateInfo(); }),
      // an online leaderboard arriving for the beatmap on show
      Bus.on('lb', d => { if (d.id) return; this._online = d; /* (one asked for by beatmap id is the beatmap overlay's) */ const m = this.selectedId && BeatmapManager.maps.get(this.selectedId); if (m && d.key === m.hash) { this._lbKey = null; this.updateInfo(); } }),
    ];
    this._ro = new ResizeObserver(() => this.renderVisible());
    this._ro.observe(this.scroller);
    this.renderMods();
    // (the list a frame after the screen: both in the same frame was the slow part of opening song select on a slow
    // device; the screen is still fading in, so the list joining a frame later doesn't show)
    requestAnimationFrame(() => requestAnimationFrame(() => { if (Screens.current !== this) return; this.rebuild(); this.scrollToSelected(false); }));
    this.beatLoop();
    return el;
  },
  /** The logo in the corner keeps lazer's beat: a 2% squeeze 60ms before each beat that eases out over two beats. */
  beatLoop() {
    cancelAnimationFrame(this._beatRaf);
    let last = -1;
    const tick = () => {
      this._beatRaf = requestAnimationFrame(tick);
      const tm = Music.meta && Music.meta.timing;
      if (!tm || !Music.playing || !this.logoBeat || !Settings.get('ui.animSpeed')) return;
      const t = Music.time + 60, i = Math.max(0, bsearchLE(tm, t, 'time')), tp = tm[i];
      const beat = Math.floor((t - tp.time) / tp.beatLength), key = i * 100000 + beat;
      if (key === last || t < tp.time || beat < 0) return;
      last = key;
      const L = tp.beatLength;
      this.logoBeat.getAnimations().forEach(a => a.cancel());
      this.logoBeat.animate([{ scale: 1, easing: 'cubic-bezier(.5, 1, .89, 1)' }, { scale: 0.98, offset: 60 / (60 + L * 2), easing: 'cubic-bezier(.22, 1, .36, 1)' }, { scale: 1 }], { duration: 60 + L * 2 });
    };
    this._beatRaf = requestAnimationFrame(tick);
  },
  leave() {
    cancelAnimationFrame(this._beatRaf);
    this.closeOptions();
    (this._unsub || []).forEach(f => f());
    this._ro && this._ro.disconnect();
    clearTimeout(this._previewT);
  },
  /** lazer's DifficultyRangeSlider: the star spectrum as a track, darkened outside the range, a Highlight1 frame round
   *  the range and a nub at each end in the colour of its star rating (grey from 8 stars; the top end is "∞" until
   *  it's moved). Drag either nub (the one nearer the pointer), or use the arrow keys on it. */
  starRange() {
    const LO_MAX = 10, HI_MAX = 10.1, MIN_RANGE = 0.1, NUB = 34.8;
    let lo = clamp(+Settings.get('songselect.starsMin') || 0, 0, LO_MAX), hi = clamp(+Settings.get('songselect.starsMax') || HI_MAX, 0, HI_MAX);
    const dimL = h('i.sr-dim.l'), dimR = h('i.sr-dim.r'), frame = h('i.sr-frame');
    const nub = upper => h('span.sr-nub', { tabindex: '0', role: 'slider', 'aria-label': upper ? 'Maximum star rating' : 'Minimum star rating' }, h('b'));
    const nLo = nub(false), nHi = nub(true);
    const track = h('div.sr-track', h('i.sr-spec'), dimL, dimR, frame, nHi, nLo);
    const el = h('div.ss-stars', h('span.sr-label', 'Star Rating'), track);
    const grey = v => { const c = starColour(v); if (v < 7.5) return c; const t = clamp((v - 7.5) / 0.5, 0, 1), p = x => [1, 3, 5].map(k => parseInt(x.slice(k, k + 2), 16)), a = p(c); return `rgb(${a.map(x => Math.round(lerp(x, 0x44, t))).join(',')})`; };
    const paint = () => {
      const W = track.clientWidth || 300, use = W - NUB;
      const xl = NUB / 2 + use * lo / LO_MAX, xh = NUB / 2 + use * hi / HI_MAX;
      nLo.style.left = `${xl - NUB / 2}px`; nHi.style.left = `${xh - NUB / 2}px`;
      dimL.style.width = `${xl}px`; dimR.style.left = `${xh}px`;
      frame.style.left = `${xl - NUB / 2}px`; frame.style.width = `${xh - xl + NUB}px`;
      for (const [n, v, top] of [[nLo, lo, false], [nHi, hi, true]]) {
        const inf = top && v >= HI_MAX;
        n.style.setProperty('--nc', inf ? '#444' : grey(v));
        n.style.color = inf || v >= 8 ? '#fff' : v < 6.5 ? 'rgba(0,0,0,.75)' : '#ffd966';
        n.firstChild.textContent = inf ? '∞' : v.toFixed(1);
        n.setAttribute('aria-valuenow', inf ? 'Infinity' : v.toFixed(1));
      }
    };
    let t;
    const commit = () => { Settings.set('songselect.starsMin', lo); Settings.set('songselect.starsMax', hi); clearTimeout(t); t = setTimeout(() => this.rebuild(true), 50); };
    const setLo = v => { lo = clamp(Math.round(v * 10) / 10, 0, LO_MAX); hi = Math.max(hi, Math.round((lo + MIN_RANGE) * 10) / 10); paint(); commit(); };
    const setHi = v => { hi = clamp(Math.round(v * 10) / 10, 0, HI_MAX); lo = Math.min(lo, Math.max(0, Math.round((hi - MIN_RANGE) * 10) / 10)); paint(); commit(); };
    const valueAt = (x, upper) => { const r = track.getBoundingClientRect(), W = track.clientWidth || r.width, k = r.width / W || 1; return ((x - r.left) / k - NUB / 2) / (W - NUB) * (upper ? HI_MAX : LO_MAX); };
    track.addEventListener('pointerdown', e => {
      if (e.button) return;
      e.preventDefault();
      // (the nub nearer the pointer: lazer splits the slider halfway between them)
      const r = nHi.getBoundingClientRect(), l = nLo.getBoundingClientRect();
      const upper = e.clientX > (l.left + r.left) / 2 + l.width / 2;
      const move = ev => upper ? setHi(valueAt(ev.clientX, true)) : setLo(valueAt(ev.clientX, false));
      const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up); el.classList.remove('drag'); };
      track.setPointerCapture(e.pointerId); el.classList.add('drag');
      track.addEventListener('pointermove', move); track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
      move(e); UISounds.click();
    });
    for (const [n, upper] of [[nLo, false], [nHi, true]]) n.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.1 : 0;
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      if (upper) setHi(hi + d); else setLo(lo + d);
    });
    // double-click a nub to put it back
    nLo.addEventListener('dblclick', () => setLo(0)); nHi.addEventListener('dblclick', () => setHi(HI_MAX));
    new ResizeObserver(paint).observe(track);
    requestAnimationFrame(paint);
    return el;
  },
  fillCollections() {
    clearEl(this.collSel);
    const cur = Settings.get('songselect.collection');
    this.collSel.append(h('option', { value: '' }, 'All collections'), ...Collections.list.map(c => h('option', { value: c.id, selected: c.id === cur }, `▸ ${c.name} (${c.hashes.length})`)));
  },
  renderMods() {
    if (!this.modBtn) return;
    const mods = Settings.get('songselect.mods') || [], mult = ModSystem.multiplier(mods);
    this.modBtn.classList.toggle('has-mods', mods.length > 0);
    this.modBtn.classList.toggle('unr', mods.length > 0 && !ModSystem.isRanked(mods));
    // (too many to fit: "N mods", as lazer's ModCountText)
    this.modIcons.replaceChildren(...(mods.length > 4 ? [h('span.fb-modcount', `${mods.length} mods`)] : mods.map(m => ModSystem.badge(m, true))));
    this.modIcons.title = mods.map(m => (MOD_BY_ID.get(m) || {}).name || m).join(', ');
    this.modMult.textContent = `${mult.toFixed(2)}x`;
    this.modMult.className = `fb-mult${mult > 1 ? ' up' : mult < 1 ? ' down' : ''}`;
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
  /** `stay`: a background change (library, favourites, collections, scores) — keep the list where the player has
   *  scrolled it instead of jumping back to the selected beatmap. */
  rebuild(keepScroll = false, stay = false) {
    if (!this.el) return;
    const pq = this.parseQuery(this.query.trim());
    const keys = Settings.get('songselect.keys') || [];
    const sMin = +Settings.get('songselect.starsMin') || 0, sMax = +Settings.get('songselect.starsMax') || 10.1;
    const collId = Settings.get('songselect.collection');
    const coll = collId ? Collections.get(collId) : null;
    const hidden = new Set(Settings.get('songselect.hidden') || []); // (lazer: difficulties you hid)
    const results = [];
    for (const set of BeatmapManager.sets) {
      const hay = `${set.artist} ${set.artistUnicode} ${set.title} ${set.titleUnicode} ${set.creator} ${set.source} ${set.tags}`;
      let setScore = 0;
      if (pq.words.length) {
        setScore = 1;
        for (const w of pq.words) {
          let best = wordScore(hay, w);
          for (const m of set.maps) best = Math.max(best, wordScore(m.version, w) * 0.9);
          if (!best) { setScore = 0; break; }
          setScore += best;
        }
        if (!setScore) continue;
      }
      const maps = set.maps.filter(m => {
        if (m.problems.length) return false; // difficulties that can't be played (other modes, missing audio…) aren't listed
        if (hidden.has(m.hash)) return false;
        if (pq.words.length && !pq.words.every(w => wordScore(hay + ' ' + m.version, w) > 0)) return false;
        if (keys.length && !keys.includes(m.keys)) return false;
        if (coll && !coll.hashes.includes(m.hash)) return false;
        if (!this.mapMatches(m, pq)) return false;
        // the star range (lazer's UserStarDifficulty: either end only once it's been moved)
        if (sMin > 0 && m.stars < sMin) return false;
        if (sMax < 10.1 && m.stars > sMax) return false;
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
      ranked: (a, b) => dateMs(b.set.rankedDate) - dateMs(a.set.rankedDate), submitted: (a, b) => dateMs(b.set.submittedDate) - dateMs(a.set.submittedDate),
      source: (a, b) => (a.set.source || '').localeCompare(b.set.source || ''),
      lastPlayed: (a, b) => agg(b, m => ScoreManager.lastPlayed(m.hash)) - agg(a, m => ScoreManager.lastPlayed(m.hash)),
      playCount: (a, b) => b.maps.reduce((x, m) => x + ScoreManager.playCount(m.hash), 0) - a.maps.reduce((x, m) => x + ScoreManager.playCount(m.hash), 0),
      score: (a, b) => agg(b, m => ScoreManager.best(m.hash)?.score || 0) - agg(a, m => ScoreManager.best(m.hash)?.score || 0),
      accuracy: (a, b) => agg(b, m => ScoreManager.best(m.hash)?.accuracy || 0) - agg(a, m => ScoreManager.best(m.hash)?.accuracy || 0),
    }[sort] || ((a, b) => a.set.title.localeCompare(b.set.title));
    results.sort((a, b) => (pq.words.length && sort === 'title' ? b.score - a.score : 0) || cmp(a, b) || a.set.title.localeCompare(b.set.title));
    // lazer (BeatmapCarouselFilterGrouping.ShouldGroupBeatmapsTogether): sorted or grouped by difficulty, or grouped
    // by rank achieved, every difficulty is its own panel (PanelBeatmapStandalone) — by difficulty, easiest first
    const group = Settings.get('songselect.group');
    this.standalone = sort === 'stars' || group === 'stars' || group === 'rank';
    if (this.standalone) {
      const flat = results.flatMap(r => r.maps.map(m => ({ set: r.set, maps: [m], score: r.score, std: true })));
      if (sort === 'stars') flat.sort((a, b) => a.maps[0].stars - b.maps[0].stars || a.set.title.localeCompare(b.set.title));
      results.length = 0; results.push(...flat);
    }
    this.results = results;
    this.makeGroups();
    const shown = this.groups ? this.groups.flatMap(g => g.items) : results;
    // ensure selection is visible
    const allVisible = new Map();
    for (const r of shown) for (const m of r.maps) allVisible.set(m.id, r);
    if (!this.selectedId || !allVisible.has(this.selectedId)) {
      const first = shown[0];
      // nothing matches: keep the current beatmap (as lazer does) so the wedge stays and clearing the search returns to it
      if (first) this.selectedId = this.pickDiff(first.maps).id;
      else if (this.selectedId && !BeatmapManager.maps.has(this.selectedId)) this.selectedId = null;
    }
    this.expandedSet = this.selectedId ? BeatmapManager.maps.get(this.selectedId)?.setId : null;
    if (this.groups) this.expandGroupOf(this.selectedId, true);
    this.layoutRows();
    // (the number of songs found — a song with several difficulties counts once)
    const nSongs = new Set(shown.map(r => r.set.id)).size;
    this.countEl.textContent = `${fmtInt(nSongs)} ${nSongs === 1 ? 'match' : 'matches'}`;
    this.renderEmpty();
    this.updateInfo();
    this.renderVisible(true);
    // the selected beatmap's song plays (arriving with nothing playing, or a filter that moved the selection)
    const sel = this.selectedId && BeatmapManager.maps.get(this.selectedId);
    if (sel && (!Music.meta || Music.meta.setId !== sel.setId || this.trackKey(sel) !== (Music.key || '').toLowerCase())) this.schedulePreview(sel);
    else if (sel) this.showBackground(sel);
    if (stay) return;
    if (!keepScroll) this.scrollToSelected(false); else this.scrollToSelected(true);
  },
  /** The difficulty a song opens on: the one you last played from it (remembered when a play starts; for plays from
   *  before that, the one with the latest score), else `fallback`, else its first playable one. */
  pickDiff(maps, fallback = null) {
    const ok = maps.filter(m => !m.problems.length), list = ok.length ? ok : maps;
    if (!list.length) return fallback;
    const memo = (Settings.get('songselect.lastDiff') || {})[list[0].setId];
    let pick = memo ? list.find(m => m.id === memo) : null;
    if (!pick) { let t = 0; for (const m of list) { const lp = ScoreManager.lastPlayed(m.hash); if (lp > t) { t = lp; pick = m; } } }
    return pick || (fallback && list.includes(fallback) ? fallback : list[0]);
  },
  /** lazer's grouping (BeatmapCarouselFilterGrouping): the sets, in their sorted order, under group headers. A set
   *  whose difficulties fall in different groups (difficulty, collections…) is listed in each, with the difficulties
   *  that belong there. */
  makeGroups() {
    const mode = Settings.get('songselect.group');
    this.groups = null;
    if (!mode || mode === 'none') return;
    const cx = { me: ((ProfileManager.profile || {}).name || '').toLowerCase(), coll: new Map() };
    if (mode === 'collections') Collections.list.forEach((c, i) => { for (const hh of c.hashes) { let l = cx.coll.get(hh); if (!l) cx.coll.set(hh, l = []); l.push({ key: 'c:' + c.id, order: i, title: c.name }); } });
    const byKey = new Map();
    for (const r of this.results) {
      const per = new Map();
      for (const m of r.maps) for (const d of this.groupDefs(mode, r.set, m, cx)) {
        let e = per.get(d.key);
        if (!e) per.set(d.key, e = { d, maps: [] });
        e.maps.push(m);
      }
      for (const [k, { d, maps }] of per) {
        let g = byKey.get(k);
        if (!g) byKey.set(k, g = { ...d, items: [] });
        g.items.push({ set: r.set, maps, score: r.score });
      }
    }
    this.groups = [...byKey.values()].sort((a, b) => a.order - b.order || String(a.title).localeCompare(String(b.title)));
  },
  /** The group(s) one difficulty goes in, for the given GroupMode (lazer's titles and ordering). */
  groupDefs(mode, set, m, cx) {
    const g = (order, title, extra) => [{ key: title, order, title, ...extra }];
    const alpha = name => {
      const c = String(name || '').trim().charAt(0).toUpperCase();
      return /[0-9]/.test(c) ? g(-Infinity, '0-9') : /[A-Z]/.test(c) ? g(c.charCodeAt(0) - 65, c) : g(Infinity, 'Other');
    };
    const byDate = t => {
      const d = (Date.now() - t) / 86400000;
      if (d < 1) return g(0, 'Today');
      if (d < 2) return g(1, 'Yesterday');
      if (d < 7) return g(2, 'Last week');
      if (d < 30) return g(3, 'Last month');
      for (let i = 60; i <= 150; i += 30) if (d < i) return g(i, `${i / 30 - 1} month${i === 60 ? '' : 's'} ago`);
      return g(151, 'Over 5 months ago');
    };
    switch (mode) {
      case 'artist': return alpha(set.artist);
      case 'creator': return alpha(set.creator);
      case 'title': return alpha(set.title);
      case 'added': return byDate(set.added || 0);
      case 'ranked': { const t = dateMs(set.rankedDate); if (!t) return g(0, 'Unranked'); const y = new Date(t).getFullYear(); return g(-y, String(y)); }
      case 'lastPlayed': { const t = ScoreManager.lastPlayed(m.hash); return t ? byDate(t) : g(Infinity, 'Never'); }
      case 'status': {
        let st = String(set.status || 'none').toLowerCase();
        if (st === 'approved') st = 'ranked';
        if (!(st in STATUS_GROUP)) st = 'none';
        return g(STATUS_GROUP[st], (ONLINE_STATUS[st] || ONLINE_STATUS.none)[0], { status: st });
      }
      case 'bpm': {
        const b = Math.round(m.bpm || 0);
        if (b < 60) return g(60, 'Under 60 BPM');
        for (let i = 70; i <= 300; i += 10) if (b < i) return g(i, `${i - 10} - ${i} BPM`);
        return g(301, 'Over 300 BPM');
      }
      case 'stars': {
        const s = Math.floor(m.stars || 0);
        return s === 0 ? g(0, 'Below 1 star', { stars: 0 }) : s < 15 ? g(s, `${s} star${s === 1 ? '' : 's'}`, { stars: s }) : g(15, 'Over 15 stars', { stars: 15 });
      }
      case 'length': {
        for (let i = 1; i < 6; i++) if (m.length <= i * 60000) return g(i, `${i} minute${i === 1 ? '' : 's'} or less`);
        return m.length <= 600000 ? g(10, '10 minutes or less') : g(11, 'Over 10 minutes');
      }
      case 'source': return set.source ? g(0, set.source) : g(1, 'Unsourced');
      case 'collections': return cx.coll.get(m.hash) || g(Infinity, 'Not in collection');
      case 'mine': return cx.me && String(set.creator || '').toLowerCase() === cx.me ? g(0, 'My maps') : [];
      case 'rank': { const b = ScoreManager.best(m.hash); return b ? g(RANK_ORDER.indexOf(b.grade), b.grade, { rank: b.grade }) : g(Infinity, 'Unplayed'); }
      case 'favourites': return Favorites.has(set.id) ? g(0, 'Favourites') : [];
      case 'keys': return g(m.keys, `${m.keys}K`);
    }
    return [];
  },
  /** Open the group that has this difficulty (unless the open one already does; `keepClosed`: and none is open
   *  because the player closed it). Says whether the open group changed. */
  expandGroupOf(id, keepClosed = false) {
    if (!this.groups) return false;
    const has = g => g && g.items.some(r => r.maps.some(m => m.id === id));
    const cur = this.groups.find(g => g.key === this.expandedGroup);
    if (has(cur) || (keepClosed && this.expandedGroup === null)) return false;
    const g = this.groups.find(has);
    const key = g ? g.key : null;
    if (key === this.expandedGroup) return false;
    this.expandedGroup = key;
    return true;
  },
  toggleGroup(key) {
    this.expandedGroup = this.expandedGroup === key ? null : key;
    UISounds.select(this.expandedGroup ? 'expand' : 'difficulty');
    this.layoutRows();
    this.renderVisible(true);
    const row = this.rows.find(r => r.type === 'group' && r.g.key === key);
    if (row) this.scrollToRow(row, true);
  },
  /** lazer's carousel spacing (BeatmapCarousel.GetSpacingBetweenPanels): collapsed beatmap sets overlap by 3px, as
   *  do group headers; difficulties sit 3px apart; the expanded set, and a group's first and last panel, get 6px. */
  gap(a, b) {
    const S = this.ROW_GAP;
    if ((a.type === 'group') !== (b.type === 'group')) return 2 * S;
    if (b.type === 'set' && b.open) return 2 * S;
    if ((a.type === 'std' && a.open) || (b.type === 'std' && b.open)) return 2 * S; // (room around the selected one)
    if (a.type === 'diff' && b.type === 'set') return 2 * S;
    if (a.type === 'diff' || b.type === 'diff') return S;
    return -S;
  },
  layoutRows() {
    const rows = [];
    const sets = list => {
      for (const r of list) {
        if (r.std) { rows.push({ type: 'std', r, m: r.maps[0], open: r.maps[0].id === this.selectedId, h: this.ROW_SET }); continue; }
        const open = r.set.id === this.expandedSet && (!this.groups || r.maps.some(m => m.id === this.selectedId));
        rows.push({ type: 'set', r, open, h: this.ROW_SET });
        if (open) for (const m of r.maps) rows.push({ type: 'diff', r, m, h: this.ROW_DIFF });
      }
    };
    if (this.groups) for (const g of this.groups) {
      const open = g.key === this.expandedGroup;
      rows.push({ type: 'group', g, open, h: this.ROW_GROUP });
      if (open) sets(g.items);
    }
    else sets(this.results);
    let y = 12;
    rows.forEach((row, i) => { if (i) y += this.gap(rows[i - 1], row); row.y = y; y += row.h; });
    this.rows = rows;
    this.totalH = y + 200;
    this.inner.style.height = this.totalH + 'px';
    this.pool = this.pool || new Map();
  },
  renderEmpty() {
    clearEl(this.emptyEl);
    const any = this.groups ? this.groups.length : this.results.length;
    this.emptyEl.style.display = any ? 'none' : '';
    if (any) return;
    if (!BeatmapManager.sets.length) {
      this.emptyEl.append(h('div.box', h('h2', 'Your library is empty'),
        h('p', 'Find beatmaps online and download them in one click, or drag & drop .osz files (or a folder of beatmaps) anywhere on this window.'),
        h('div.row.wrap', { style: { justifyContent: 'center', marginTop: '14px' } },
          h('button.btn.primary.ss-browse', { onclick: () => { UISounds.click(); Screens.go('explore'); } }, icon('search'), 'Browse online'),
          h('button.btn', { onclick: () => importViaPicker('.osz,.osu,.osk,.amr,.json') }, icon('upload'), 'Import files'),
          h('button.btn', { onclick: () => importViaPicker('', true) }, icon('folder'), 'Import folder'))));
    } else {
      // lazer's NoResultsPlaceholder: a bobbing ghost, "No matching beatmaps" and what to try
      const q = this.query.trim(), lo = +Settings.get('songselect.starsMin') || 0, hi = +Settings.get('songselect.starsMax') || 10.1;
      const link = (text, fn) => h('a.nr-link', { href: '#', onclick: e => { e.preventDefault(); UISounds.click(); fn(); } }, text);
      const tips = [];
      if (q) tips.push(['Try ', link('clearing', () => { this.query = ''; this.searchInput.value = ''; this.rebuild(true); }), ' your current search criteria.']);
      if (lo > 0 || hi < 10.1) tips.push(['Try ', link('removing', () => { Settings.set('songselect.starsMin', 0); Settings.set('songselect.starsMax', 10.1); Screens.go('songselect', { force: true }, { replace: true }); }), ` the ${lo.toFixed(1)} - ${hi < 10.1 ? hi.toFixed(1) : '∞'} star difficulty filter.`]);
      if (q) tips.push(['Try ', link('searching online', () => { ExplorerScreen.state.q = q; ExplorerScreen.results = []; Screens.go('explore'); }), ` for "${q}".`]);
      this.emptyEl.append(h('div.nr',
        h('span.nr-ghost', icon('ghost')),
        h('div.nr-t', 'No matching beatmaps'),
        h('div.nr-text', h('p', 'No beatmaps match your filter criteria!'), ...tips.map(t => h('p.nr-tip', h('i.nr-dot'), ...t)))));
    }
  },
  clearFilters() {
    this.query = ''; this.searchInput.value = '';
    Settings.set('songselect.keys', []); Settings.set('songselect.collection', ''); Settings.set('songselect.starsMin', 0); Settings.set('songselect.starsMax', 10.1);
    Screens.go('songselect', { force: true }, { replace: true });
  },
  renderVisible(force = false) {
    if (!this.rows) return;
    const st = this.scroller.scrollTop, vh = this._vh || this.scroller.clientHeight || 600;
    const from = st - 200, to = st + vh + 200;
    // lazer's carousel runs along a circle: a panel slides right the further it is from the middle of the list
    // (Carousel.offsetX: radius 3, in units of half the visible height)
    const half = vh / 2, arc = y => { const d = Math.abs(1 - (y - st) / half); return Math.round((3 - Math.sqrt(Math.max(0, 9 - d * d))) * half); };
    const needed = new Set();
    for (const row of this.rows) {
      if (row.y + row.h < from || row.y > to) continue;
      const key = row.type === 'group' ? 'g:' + row.g.key : row.type === 'set' ? 's:' + row.r.set.id : row.type === 'std' ? 'b:' + row.m.id : 'd:' + row.m.id;
      needed.add(key);
      let el = this.pool.get(key);
      if (!el || force) {
        const fresh = !el && !force;
        if (el) el.remove();
        el = this.renderRow(row);
        this.pool.set(key, el);
        // a set that just opened: its difficulties slide out from under its panel (lazer), rather than popping up
        // at their places while the panel is still moving there. (Placed before it joins the page, so it doesn't
        // first appear at the top and glide down from there.)
        if (fresh && row.type === 'diff' && row.m.setId === this._expandSet && performance.now() - this._expandAt < 450) {
          const hel = this.pool.get('s:' + row.m.setId);
          // (from where that panel is right now: it may still be gliding to its new place)
          const cur = hel && hel.isConnected ? new DOMMatrix(getComputedStyle(hel).transform).m42 : null;
          if (cur != null) {
            el._y = cur; el.style.transform = `translateY(${cur}px)`; el.classList.add('spawn');
            requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.remove('spawn'); this.renderVisible(); }));
          }
        }
        this.inner.appendChild(el);
      } else this.refreshRow(el, row);
      if (el._y !== row.y && !el.classList.contains('spawn')) { el._y = row.y; el.style.transform = `translateY(${row.y}px)`; }
      const x = arc(row.y + row.h / 2);
      if (el._x !== x) { el._x = x; el.style.translate = `${x}px 0`; }
    }
    for (const [k, el] of this.pool) {
      if (needed.has(k)) continue;
      this.pool.delete(k);
      // the set that just closed: its difficulties slide back up under its panel and fade, instead of vanishing
      const hel = el._setId && el._setId === this._collapseSet && performance.now() - this._expandAt < 450 && this.pool.get('s:' + el._setId);
      if (hel) { el.classList.add('spawn'); el.style.transform = hel.style.transform; setTimeout(() => el.remove(), 320); }
      else el.remove();
    }
  },
  /** A row that's already on screen only needs its selection state (and height) brought up to date. */
  refreshRow(el, row) {
    const hh = row.h + 'px';
    if (el.style.height !== hh) el.style.height = hh;
    const b = el.firstChild;
    if (!b) return;
    if (row.type === 'set' || row.type === 'group' || row.type === 'std') b.classList.toggle('expanded', row.open);
    else b.classList.toggle('selected', row.m.id === this.selectedId);
  },
  renderRow(row) {
    const wrap = h(`div.c-item${row.type === 'set' ? '.set' : row.type === 'group' ? '.grp' : ''}`, { style: { height: row.h + 'px' } });
    if (row.type === 'diff') wrap._setId = row.m.setId;
    if (row.type === 'group') {
      // lazer's PanelGroup: a dark panel with triangles, the title (a star rating, rank or status shown as such), the
      // number of sets in a pill on the right; open, a chevron slides out on the left and a Highlight1 glow lights it
      const g = row.g;
      const lead = g.rank ? rankPill(g.rank) : g.status ? statusPill(g.status) : null;
      const btn = h(`button.group-panel${row.open ? '.expanded' : ''}`, { onclick: () => this.toggleGroup(g.key), 'aria-expanded': String(!!row.open) },
        h('span.gp-chev', icon('chevron')),
        h('div.gp-body', g.stars != null ? h('span.gp-star', { style: { '--sc': starColour(g.stars) } }, icon('star', 'fill')) : null, lead || h('span.gp-t', g.title)),
        h('span.gp-count', fmtInt(g.items.length)));
      btn.addEventListener('pointerenter', () => UISounds.hover());
      wrap.appendChild(btn);
    } else if (row.type === 'std') {
      // lazer's PanelBeatmapStandalone: one difficulty with its set's background — title, artist, then the status,
      // [keys] difficulty "mapped by …", and the star rating; a strip in the difficulty's colour on the left
      const m = row.m, set = row.r.set, stars = this.modStars(m) ?? m.stars, best = ScoreManager.best(m.hash);
      const bg = h('div.sp-bg');
      BeatmapManager.thumbURL(set).then(u => { if (u) bg.style.backgroundImage = `url("${u}")`; });
      const btn = h(`button.set-panel.std-panel${row.open ? '.expanded' : ''}`, {
        style: { '--sc': starColour(stars) },
        onclick: () => { if (this.selectedId === m.id) this.play(); else { UISounds.select('difficulty'); this.select(m.id); } },
        oncontextmenu: e => { e.preventDefault(); this.select(m.id); this.options(e, m); },
      }, bg, h('span.sp-chev', icon('chevron')), h('div.sp-body',
        h('div.sp-t', set.title),
        h('div.sp-a', set.artist),
        h('div.std-line', statusPill(set.status, '.sm'), h('span.dp-k', `[${m.keys}K] `), h('span.dp-v', m.version), h('span.dp-s', `mapped by ${m.creator}`)),
        h('div.dp-bottom', best ? rankPill(best.grade) : null, starBadge(stars), h('span.dp-stars', { style: { '--p': `${clamp(stars / 10, 0, 1) * 100}%` } }, '★★★★★★★★★★'))));
      btn.addEventListener('pointerenter', () => UISounds.hover());
      wrap.appendChild(btn);
    } else if (row.type === 'set') {
      const { set, maps } = row.r;
      const broken = maps.every(m => m.problems.length);
      const bg = h('div.sp-bg');
      BeatmapManager.thumbURL(set).then(u => { if (u) bg.style.backgroundImage = `url("${u}")`; });
      const btn = h(`button.set-panel${row.open ? '.expanded' : ''}${broken ? '.broken' : ''}`, {
        onclick: () => {
          if (row.open) return;
          UISounds.select('expand');
          const pick = this.pickDiff(maps);
          this.select(pick.id);
        },
        oncontextmenu: e => { e.preventDefault(); this.options(e, maps[0]); },
      }, bg, h('span.sp-chev', icon('chevron')), h('div.sp-body',
        h('div.sp-t', set.title),
        h('div.sp-a', set.artist),
        h('div.sp-dots', statusPill(set.status, '.sm'), ...maps.slice(0, 18).map(m => h('i', { style: { '--sc': starColour(m.stars) }, title: `[${m.version}] ${m.stars.toFixed(2)}★ ${m.keys}K` })),
          maps.length > 18 ? h('span.sp-extra', `+${maps.length - 18}`) : null,
          broken ? h('span.tag.warn', 'Broken') : null)),
      Favorites.has(set.id) ? h('span.sp-fav', icon('heart', 'fill')) : null);
      btn.addEventListener('pointerenter', () => UISounds.hover());
      wrap.appendChild(btn);
    } else {
      const m = row.m;
      const best = ScoreManager.best(m.hash);
      const stars = this.modStars(m) ?? m.stars; // (with the selected speed mods, as lazer)
      // lazer's PanelBeatmap: a strip in the difficulty colour on the left, the colour tinting the panel, the local
      // rank, "[4K] name mapped by …", then the star rating pill and a star counter
      const sc = starColour(stars);
      const btn = h(`button.diff-panel${m.id === this.selectedId ? '.selected' : ''}${m.problems.length ? '.broken' : ''}`, {
        style: { '--sc': sc },
        onclick: () => { if (this.selectedId === m.id) this.play(); else { UISounds.select('difficulty'); this.select(m.id); } },
        oncontextmenu: e => { e.preventDefault(); this.select(m.id); this.options(e, m); },
        title: m.problems.length ? m.problems.join('\n') : '',
      }, h('div.dp-body',
        best ? rankPill(best.grade) : null,
        h('div.dp-main',
          h('div.dp-top', h('span.dp-k', `[${m.keys}K] `), h('span.dp-v', m.version), h('span.dp-s', `mapped by ${m.creator}`)),
          h('div.dp-bottom', starBadge(stars), h('span.dp-stars', { style: { '--p': `${clamp(stars / 10, 0, 1) * 100}%` } }, '★★★★★★★★★★'),
            m.problems.length ? h('span.dp-bad', m.problems[0]) : null))));
      btn.addEventListener('pointerenter', () => UISounds.hover());
      wrap.appendChild(btn);
    }
    return wrap;
  },
  select(id, { scroll = true } = {}) {
    const m = BeatmapManager.maps.get(id);
    if (!m) return;
    const setChanged = this.expandedSet !== m.setId;
    if (setChanged) { this._collapseSet = this.expandedSet; this._expandSet = m.setId; this._expandAt = performance.now(); }
    this.selectedId = id;
    this.expandedSet = m.setId;
    Settings.set('last.map', id);
    const regroup = this.expandGroupOf(id);
    this.layoutRows();
    // rows already on screen are updated in place (only their selection changes); new ones are built once, after
    // scrolling (rebuilding every visible row, twice, made each change of beatmap stutter on slow devices). Another
    // group opening rebuilds them: the same set can list other difficulties there.
    if (scroll) this.scrollToSelected(true, regroup); else this.renderVisible(regroup);
    this.updateInfo();
    // a difficulty can have its own song file (and background): the preview follows the difficulty, not just the set
    if (setChanged || !Music.meta || Music.meta.setId !== m.setId || this.trackKey(m) !== (Music.key || '').toLowerCase()) this.schedulePreview(m);
    else this.showBackground(m); // (another difficulty of the same set can have its own background)
  },
  scrollToSelected(smooth, force = false) {
    const row = this.rows.find(r => (r.type === 'diff' || r.type === 'std') && r.m.id === this.selectedId) || this.rows.find(r => r.type === 'set' && r.r.set.id === this.expandedSet);
    if (!row) { if (force) this.renderVisible(true); return; }
    this.scrollToRow(row, smooth, force);
  },
  scrollToRow(row, smooth, force = false) {
    const vh = this._vh || this.scroller.clientHeight || 600;
    const top = Math.max(0, row.y - vh / 2 + row.h / 2);
    this.scroller.scrollTo({ top, behavior: smooth && Settings.get('ui.animSpeed') > 0 ? 'smooth' : 'auto' });
    this.renderVisible(force);
  },
  // keyboard navigation
  /** The sets the arrow keys go through: those listed (with groups, the open group's). */
  navList() {
    if (!this.groups) return this.results || [];
    const g = this.groups.find(x => x.key === this.expandedGroup);
    return g ? g.items : [];
  },
  flatMaps() { return this.navList().flatMap(r => r.maps); },
  moveDiff(d) {
    const flat = this.flatMaps();
    if (!flat.length) return;
    const i = flat.findIndex(m => m.id === this.selectedId);
    const n = flat[clamp(i + d, 0, flat.length - 1)];
    if (n && n.id !== this.selectedId) { UISounds.select(n.setId === this.expandedSet ? 'difficulty' : 'expand'); this.select(n.id); }
  },
  moveSet(d) {
    const list = this.navList();
    if (!list.length) return;
    const i = list.findIndex(r => r.set.id === this.expandedSet);
    const r = list[clamp(i + d, 0, list.length - 1)];
    if (!r || r.set.id === this.expandedSet) return;
    const cur = BeatmapManager.maps.get(this.selectedId);
    // (the difficulty last played from that song; one never played opens on the one nearest the current star rating)
    const target = this.pickDiff(r.maps, cur ? r.maps.reduce((a, m) => Math.abs(m.stars - cur.stars) < Math.abs(a.stars - cur.stars) ? m : a, r.maps[0]) : null);
    UISounds.select('expand'); this.select(target.id);
  },
  /** lazer's random: a different beatmap set each time, going through every set before one comes up again; the
   *  picks are remembered so Shift+F2 / right-click can rewind them. */
  random() {
    const flat = (this.groups ? this.groups.flatMap(g => g.items) : this.results || []).flatMap(r => r.maps).filter(m => !m.problems.length);
    if (!flat.length) return;
    const cur = BeatmapManager.maps.get(this.selectedId);
    const seen = this._randSeen || (this._randSeen = new Set());
    if (cur) seen.add(cur.setId);
    let pool = flat.filter(m => !seen.has(m.setId));
    if (!pool.length) { seen.clear(); if (cur) seen.add(cur.setId); pool = flat.filter(m => !cur || m.setId !== cur.setId); }
    if (!pool.length) pool = flat;
    UISounds.select('random');
    const hist = this._randHist || (this._randHist = []);
    if (this.selectedId) { hist.push(this.selectedId); if (hist.length > 50) hist.shift(); }
    // (one set at random, then one of its difficulties, so big sets aren't picked more often)
    const sets = [...new Set(pool.map(m => m.setId))], setId = sets[Math.floor(Math.random() * sets.length)];
    const inSet = pool.filter(m => m.setId === setId);
    this.select(this.pickDiff(inSet, inSet[Math.floor(Math.random() * inSet.length)]).id);
  },
  randomRewind() {
    const hist = this._randHist || [];
    let id;
    while ((id = hist.pop()) && !BeatmapManager.maps.has(id));
    if (!id) return;
    UISounds.back();
    this.select(id);
  },
  onKey(e) {
    if (e.target === this.searchInput) return false;
    switch (e.key) {
      case 'ArrowDown': if (e.ctrlKey || e.metaKey) this.changeSpeed(-0.05); else this.moveDiff(1); return true;
      case 'ArrowUp': if (e.ctrlKey || e.metaKey) this.changeSpeed(0.05); else this.moveDiff(-1); return true;
      case 'ArrowRight': this.moveSet(1); return true;
      case 'ArrowLeft': this.moveSet(-1); return true;
      case 'PageDown': this.moveSet(5); return true;
      case 'PageUp': this.moveSet(-5); return true;
      case 'Enter': this.play(e.ctrlKey ? 'auto' : 'play'); return true;
      case 'F1': this.openMods(); return true;
      case 'F2': if (e.shiftKey) this.randomRewind(); else this.random(); return true;
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
  /** lazer's ModSpeedHotkeyHandler (Ctrl+↑ / ↓): the play speed 0.05× at a time — through Song Speed here, as this
   *  game's Double Time and Half Time are fixed speeds — and back to no speed mod at 1×. */
  changeSpeed(delta) {
    const mods = Settings.get('songselect.mods') || [];
    const target = clamp(Math.round((ModSystem.rate(mods) + delta) * 20) / 20, 0.5, 2);
    const rest = mods.filter(m => !['DT', 'NC', 'HT', 'DC', 'RT'].includes(m));
    if (Math.abs(target - 1) < 0.005) Settings.set('songselect.mods', rest);
    else { Settings.set('mods.config', { ...ModSystem.config(), rate: target }); Settings.set('songselect.mods', [...rest, 'RT']); }
    Bus.emit('mods:changed');
    OSD.show('Mod customisation', `Speed changed to ${target.toFixed(2)}x`, 'Ctrl+Up / Ctrl+Down');
  },
  /** Mod select; picking a beatmap for a multiplayer room greys out the mods a room doesn't allow (Auto). */
  openMods() { ModSelect.open(this.mpPick && Multiplayer.inRoom() ? { disabled: ['AT', 'CN', 'WU', 'WD', 'AS'], why: 'not available in multiplayer' } : {}); },
  onBack() {
    if (this.query) { this.query = ''; this.searchInput.value = ''; this.rebuild(true); return true; }
    return false;
  },

  // ── preview audio & background
  schedulePreview(m) {
    clearTimeout(this._previewT);
    this._previewT = setTimeout(() => this.preview(m), 60);
  },
  /** The selected difficulty's own background (each difficulty's [Events] can name a different picture). */
  async showBackground(m) {
    const tok = this._bgTok = {};
    const url = await BeatmapManager.bgURL(m).catch(() => null) || await BeatmapManager.thumbURL(BeatmapManager.setById.get(m.setId));
    if (tok === this._bgTok && this.selectedId === m.id && url !== Background.current) Background.set(url);
  },
  /** The same key the player gives a track (set / audio file), to tell whether this difficulty's song is playing. */
  trackKey(m) { return `${m.setId}/${m.audioFile || ''}`.toLowerCase(); },
  async preview(m) {
    this.showBackground(m);
    if (!Settings.get('audio.previewAudio') || m.problems.length) return;
    // a token per request: if the selection changes while this one is loading, it's dropped (otherwise a
    // slower earlier request could start the new song at the old song's preview point)
    const tok = this._previewTok = {};
    try {
      await AudioManager.resume();
      const blob = await BeatmapManager.getFile(m.setId, m.audioFile);
      if (tok !== this._previewTok || BeatmapManager.maps.get(this.selectedId)?.setId !== m.setId) return;
      if (!blob) return;
      await Music.open(blob, `${m.setId}/${m.audioFile}`, { setId: m.setId, mapId: m.id, timing: null });
      if (tok !== this._previewTok) return;
      const start = previewStart(m);
      Music.play(start, { fadeIn: 400 });
      Music.onEnded = () => { if (Screens.currentName === 'songselect' && Music.meta && Music.meta.setId === m.setId) Music.play(start, { fadeIn: 600 }); };
      MenuMusic.setCurrent(m);
      beatTiming(m).then(timing => { if (tok === this._previewTok && Music.meta && Music.meta.setId === m.setId) Music.meta.timing = timing; });
      // decode the full track in the background once the player lingers, so pressing Play starts quickly
      clearTimeout(this._warmT);
      this._warmT = setTimeout(() => { if (tok === this._previewTok) TrackCache.get(m.setId, m.audioFile).catch(() => {}); }, 900);
    } catch (e) { console.warn('preview failed', e); }
  },

  /** lazer shows the star rating with the selected speed mods: worked out in the background (the beatmap is parsed
   *  and rated once per map and speed), then the panel redraws. null until it's known, or when there's no speed change. */
  modStars(m) {
    const rate = ModSystem.rate(Settings.get('songselect.mods') || []);
    if (rate === 1) return null;
    const key = `${m.hash}|${rate}`, cache = this._srCache || (this._srCache = new Map());
    if (cache.has(key)) return cache.get(key);
    cache.set(key, null);
    // one map at a time, so a screenful of difficulties doesn't stall the frame
    this._srQ = (this._srQ || Promise.resolve()).then(async () => {
      // (skipped when the speed changed or the panel has scrolled away by the time its turn comes)
      if (ModSystem.rate(Settings.get('songselect.mods') || []) !== rate || (this.selectedId !== m.id && !this.pool.has('d:' + m.id))) { cache.delete(key); return; }
      const { notes } = await BeatmapManager.load(m.id);
      const v = DifficultyCalculator.calculate(notes, m.keys, rate);
      cache.set(key, v);
      if (Screens.current !== this) return;
      if (this.selectedId === m.id) this.updateInfo();
      // the difficulty panel on screen takes the new rating in place
      const el = this.pool.get('d:' + m.id), panel = el && el.querySelector('.diff-panel');
      if (panel) {
        panel.style.setProperty('--sc', starColour(v));
        const badge = panel.querySelector('.dp-bottom > :first-child'), bar = panel.querySelector('.dp-stars');
        if (badge) badge.replaceWith(starBadge(v));
        if (bar) bar.style.setProperty('--p', `${clamp(v / 10, 0, 1) * 100}%`);
      }
      await sleep(0);
    }).catch(() => { cache.delete(key); });
    return null;
  },
  updateInfo() {
    if (!this.info) return;
    clearEl(this.info);
    const m = this.selectedId && BeatmapManager.maps.get(this.selectedId);
    if (!m) { this.playBtn && (this.playBtn.disabled = true); return; }
    this.playBtn.disabled = m.problems.length > 0;
    const set = BeatmapManager.setById.get(m.setId);
    const fav = Favorites.has(set.id);
    const favBtn = h(`button.w-fav${fav ? '.on' : ''}`, { title: fav ? 'Remove from favourites' : 'Favourite', 'aria-label': 'Favourite', onclick: async () => { UISounds.click(); await Favorites.toggle(set.id); } }, icon('heart', fav ? 'fill' : ''));
    const collBtn = h('button.w-fav', { title: 'Add to collection', 'aria-label': 'Add to collection', onclick: e => this.collectionMenu(e, m) }, icon('folder'));
    const mods = Settings.get('songselect.mods') || [];
    const rate = ModSystem.rate(mods);
    const bpm = m.bpmMin !== m.bpmMax ? `${Math.round(m.bpmMin * rate)}–${Math.round(m.bpmMax * rate)}` : Math.round(m.bpm * rate);
    const st = (ic, label, v) => h('span.w-stat', { title: label }, icon(ic), String(v));
    // lazer's BeatmapTitleWedge: a sheared dark wedge over the (full-screen) beatmap background with the title, artist,
    // play count / favourite / length / BPM; then the DifficultyDisplay in the difficulty's colour
    const plays = ScoreManager.playCount(m.hash);
    // the wedges fade over only for another beatmap set / difficulty, not when something else redraws them (mods, a favourite)
    const sameSet = this._infoSet === m.setId, sameMap = this._infoMap === m.id;
    this._infoSet = m.setId; this._infoMap = m.id;
    const wedge = h(`div.wedge${sameSet ? '.still' : ''}`, h('div.w-body',
      h('div.w-top', statusPill((BeatmapManager.setById.get(m.setId) || {}).status), m.problems.length ? h('span.tag.warn', 'Unplayable') : null),
      h('div.w-title', m.title), h('div.w-artist', m.artist),
      h('div.w-stats', h('span.w-plays', { title: 'Your plays' }, icon('play', 'fill'), fmtInt(plays)), favBtn, collBtn,
        st('clock', 'Length', fmtTime(m.length / rate)), st('music', 'BPM', bpm))));
    const sc = starColour(m.stars), ink = m.stars >= 6.5 ? '#ffd966' : sc;
    const stat = (k, v, max, text) => h('div.wd-stat', { title: `${k}: ${text ?? v}` }, h('div.wd-bar', h('i', { style: { width: clamp(v / max * 100, 0, 100) + '%' } })), h('div.wd-k', k), h('div.wd-v', text ?? (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(1)) : v)));
    const objs = Math.max(1, m.objectCount || m.noteCount + m.lnCount);
    const diff = h(`div.wd${sameMap ? '.still' : ''}`, { style: { '--sc': sc, '--ink': ink } },
      h('div.wd-name', starBadge(this.modStars(m) ?? m.stars), h('b.wd-v', m.version), h('span.wd-by', ' mapped by '), h('b.wd-mapper', m.creator)),
      h('div.wd-box',
        h('div.wd-counts', stat('Notes', m.noteCount, objs, fmtInt(m.noteCount)), stat('Hold notes', m.lnCount, objs, fmtInt(m.lnCount))),
        h('div.wd-diffs', stat('Keys', m.keys, 10), stat('HP drain', m.hp, 10), stat('Accuracy', m.od, 10))));
    const problems = m.problems.length ? h('div.ss-problem', icon('info'), h('div', h('b', 'This difficulty can\'t be played'), h('div.muted', m.problems.join(' · ')))) : null;
    // lazer's BeatmapDetailsArea: a "Details | Ranking" WedgeSelector (text tabs, a 2px strip under the current one);
    // Ranking has the "Selected Mods" toggle and the Sort and Scope dropdowns on the right (scores here are all local)
    const tab = Settings.get('songselect.detailTab') === 'details' ? 'details' : 'ranking';
    const tabBtn = (id, label) => h(`button.lb-tab${tab === id ? '.on' : ''}`, { onclick: () => { if (tab === id) return; UISounds.click(); Settings.set('songselect.detailTab', id); this._lbKey = null; this.updateInfo(); } }, label);
    const lbSel = (label, opts, cur, fn) => {
      const el = h('select.select', { 'aria-label': label, title: label }, ...opts.map(([v, l, dis]) => h('option', { value: v, selected: cur === v, disabled: !!dis }, l)));
      el.addEventListener('change', () => { UISounds.click(); fn(el.value); });
      return h('label.ss-sel', h('span', label), el);
    };
    const modsOn = !!Settings.get('songselect.lbMods'), sortBy = Settings.get('songselect.lbSort') || 'score';
    const scope = ['global', 'friends'].includes(Settings.get('songselect.lbScope')) ? Settings.get('songselect.lbScope') : 'local';
    const head = h('div.lb-head', h('div.lb-tabs', tabBtn('details', 'Details'), tabBtn('ranking', 'Ranking')),
      tab === 'ranking' ? h('div.lb-ctl',
        h(`button.lb-modsel${modsOn ? '.on' : ''}`, { onclick: () => { UISounds.click(); Settings.set('songselect.lbMods', !modsOn); this._lbKey = null; this.updateInfo(); } }, 'Selected Mods'),
        lbSel('Sort', [['score', 'Score'], ['accuracy', 'Accuracy'], ['maxCombo', 'Max Combo'], ['misses', 'Misses'], ['date', 'Date']], sortBy, v => { Settings.set('songselect.lbSort', v); this._lbKey = null; this.updateInfo(); }),
        lbSel('Scope', [['local', 'Local'], ['global', 'Global'], ['country', 'Country', 1], ['friends', 'Friends'], ['team', 'Team', 1]], scope, v => { Settings.set('songselect.lbScope', v); this._lbKey = null; this.updateInfo(); })) : null);
    const lb = h(`div.lb.lb-${tab}`, head);
    if (tab === 'details') lb.append(this.metadataWedge(m, set));
    else if (scope !== 'local') lb.append(this.onlineBoard(m, scope, modsOn));
    else {
      const sel = [...(Settings.get('songselect.mods') || [])].filter(x => x !== 'AT').sort().join();
      const misses = s => (s.counts || [])[5] || 0;
      const order = { score: (a, b) => ScoreManager.value(b) - ScoreManager.value(a), accuracy: (a, b) => b.accuracy - a.accuracy || ScoreManager.value(b) - ScoreManager.value(a),
        maxCombo: (a, b) => b.maxCombo - a.maxCombo || ScoreManager.value(b) - ScoreManager.value(a), misses: (a, b) => misses(a) - misses(b) || ScoreManager.value(b) - ScoreManager.value(a), date: (a, b) => b.date - a.date }[sortBy] || ((a, b) => ScoreManager.value(b) - ScoreManager.value(a));
      const scores = ScoreManager.forMap(m.hash).filter(x => !modsOn || [...(x.mods || [])].sort().join() === sel).sort(order).slice(0, 25);
      // the rows slide in for a new beatmap or new scores, not when something else redraws the panel (a favourite click)
      const lbKey = m.id + '|' + scores.map(x => x.id).join(), same = this._lbKey === lbKey;
      this._lbKey = lbKey;
      const list = h(`div.lb-list${same ? '.still' : ''}`);
      const best = ScoreManager.best(m.hash);
      // lazer's MessagePlaceholder: an exclamation in a circle, then "No records yet!" (22px)
      if (!scores.length) list.append(h('div.lb-empty', h('span.lb-empty-i', '!'), 'No records yet!'));
      const who = ProfileManager.profile.name;
      scores.forEach((s, i) => list.append(this.lbScore(s, i, who, m)));
      lb.append(list);
    }
    this.info.append(...[wedge, diff, problems, lb].filter(Boolean));
  },

  /** lazer's BeatmapLeaderboardScore (50px, sheared): the "#1" rank (on a green gradient for your own scores), then
   *  the avatar, the time since ("3hrs") over the name, COMBO and ACCURACY (lime when perfect), and on the right the
   *  score with its mods over a gradient into the grade's colour, the grade letter in a 35px strip of it. Narrower
   *  leaderboards drop the rank, then stack the statistics, then hide them (as lazer's display modes do). */
  lbScore(s, i, who, m) {
    const own = s.online ? s.own : !s.player || s.player === who;
    const g = s.grade || 'D', letter = g === 'XH' || g === 'X' ? 'SS' : g === 'SH' ? 'S' : g;
    const stat = (k, v, perfect) => h('span.lbs-stat', h('i', k), h(`b${perfect ? '.perfect' : ''}`, v));
    const c = s.counts || [];
    const pp = s.passed ? ScoreManager.ppOf(s) : 0;
    const row = h(`button.lbs${own ? '.own' : ''}`, {
      style: { animationDelay: `${i * 25}ms`, '--rc': RANK_COLOURS[g] || '#3f3f3f', '--rt': RANK_INK[g] || '#fff' },
      title: `${s.player || who} · ${fmtScore(ScoreManager.value(s))} · ${fmtAcc(s.accuracy)} · ${fmtInt(s.maxCombo)}x${pp ? ` · ${fmtInt(pp)}pp` : ''}\n${new Date(s.date).toLocaleString()}`,
      onclick: () => { UISounds.click(); Screens.go('results', s.online ? { score: { ...s, mapHash: m.hash, title: m.title, artist: m.artist, version: m.version, creator: m.creator, keys: m.keys, stars: s.stars || m.stars, counts: s.counts || [0, 0, 0, 0, 0, 0], replayId: null }, fromList: true, watched: 'online' } : { score: s, fromList: true }, { transition: 'right' }); },
      oncontextmenu: e => { e.preventDefault(); this.lbMenu(e, s, m); },
    },
      h('span.lbs-rank', h('b', '#' + fmtInt(i + 1))),
      h('span.lbs-mid',
        h('span.lbs-av', own ? ProfileManager.avatarEl(50) : s.online ? Presence.avatarEl({ name: s.player, avatar: s.avatar }, 50) : h('div.avatar.avatar-mono', { style: { width: '50px', height: '50px', fontSize: '20px' } }, String(s.player || '?').slice(0, 1).toUpperCase())),
        h('span.lbs-user', h('span.lbs-date', shortAgo(s.date)), h('span.lbs-name', s.player || who)),
        h('span.lbs-stats', stat('COMBO', `${fmtInt(s.maxCombo)}x`, c.length && !c[5]), stat('ACCURACY', fmtAcc(s.accuracy), s.accuracy >= 1))),
      h('span.lbs-right',
        h('span.lbs-sc', h('span.lbs-score', fmtScore(ScoreManager.value(s))), (s.mods || []).length ? h('span.lbs-mods', ...s.mods.map(x => ModSystem.badge(x, true))) : null),
        h('span.lbs-grade', h('b', letter))));
    return row;
  },
  /** lazer's Global and Friends scopes: everyone's best on this beatmap from the server (yours lit as your own). */
  onlineBoard(m, scope, modsOn) {
    const d = this._online;
    const fresh = d && d.key === m.hash && d.scope === scope;
    if (!fresh || performance.now() - (this._onlineAsked || 0) > 30000 || this._onlineFor !== m.hash + scope) {
      if (this._onlineFor !== m.hash + scope || performance.now() - (this._onlineAsked || 0) > 2000) { this._onlineFor = m.hash + scope; this._onlineAsked = performance.now(); Presence.start(); Presence.send({ t: 'lb', key: m.hash, scope }); }
    }
    const list = h('div.lb-list');
    if (!Presence.ws) { list.append(h('div.lb-empty', h('span.lb-empty-i', '!'), 'Can\'t reach the server for online leaderboards.')); return list; }
    if (!fresh) { list.append(h('div.lb-empty.lb-loading', h('span.spinner'))); return list; }
    const sel = [...(Settings.get('songselect.mods') || [])].filter(x => x !== 'AT').sort().join();
    const me = Presence.pid(), who = ProfileManager.profile.name;
    const asScore = e => ({ id: 'o-' + e.pid, online: true, own: e.pid === me, player: e.pid === me ? who : e.name, avatar: e.avatar, score: e.score, scoreStd: e.score, accuracy: e.acc, maxCombo: e.combo,
      grade: e.grade, mods: e.mods || [], counts: e.counts && e.counts.length === 6 ? e.counts : null, pp: e.pp, srVersion: SR_VERSION, passed: true, date: e.date, rank: e.rank });
    const scores = d.scores.map(asScore).filter(x => !modsOn || [...x.mods].sort().join() === sel);
    if (!scores.length) list.append(h('div.lb-empty', h('span.lb-empty-i', '!'), scope === 'friends' ? 'None of your friends have set a score on this map yet.' : 'No records yet!'));
    scores.forEach((s, i) => list.append(this.lbScore(s, i, who, m)));
    // (lazer pins your personal best below the list when it isn't in it)
    if (d.you && d.you.rank > 50 && !modsOn) list.append(h('div.lb-sep', '…'), this.lbScore(asScore(d.you), d.you.rank - 1, who, m));
    return list;
  },
  /** lazer's leaderboard score menu: use these mods, watch the replay, delete. */
  lbMenu(e, s, m) {
    const items = [];
    const mods = (s.mods || []).filter(x => x !== 'AT');
    if (mods.length) items.push({ label: 'Use these mods', icon: 'mods', onClick: () => { Settings.set('songselect.mods', mods); Bus.emit('mods:changed'); } });
    if (s.replayId) items.push({ label: 'Watch replay', icon: 'play', onClick: async () => { const r = await ReplayManager.get(s.replayId); if (r) Game.launch({ mapId: m.id, mode: 'replay', replay: r, returnTo: { score: s, replay: r } }); else Toast.err('No replay available'); } });
    if (!s.online) items.push({ label: 'Delete', icon: 'trash', danger: true, onClick: async () => { if (await Dialog.confirm('Delete this score?', 'It goes from your scores, profile and pp for good.', { ok: 'Delete', danger: true })) { await ScoreManager.remove(s.id); } } });
    if (items.length) showMenu(e.clientX, e.clientY, items);
  },
  /** lazer's BeatmapMetadataWedge (the Details tab): Creator / Genre, Source / Language, Submitted / Ranked in three
   *  columns, then the user and mapper tags (clicking a tag searches for it); "-" where it isn't known. A beatmap from
   *  osu! also gets lazer's online panels — user rating, rating spread and points of failure — from its set's page. */
  metadataWedge(m, set) {
    const md = (label, value) => h('div.md', h('div.md-k', label), h('div.md-v', value || '-'));
    const name = (list, id) => { const e = (typeof list !== 'undefined' ? list : []).find(x => x[0] === id); return e && id ? e[1] : ''; };
    const date = t => t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const tags = String(m.tags || '').split(/\s+/).filter(Boolean).slice(0, 40);
    const tagEl = tags.length ? h('div.md-tags', ...tags.map(t => h('button.md-tag', { onclick: () => { UISounds.click(); this.searchInput.value = t; this.searchInput.dispatchEvent(new Event('input')); } }, t))) : '-';
    return h('div.md-wedge',
      h('div.md-grid',
        h('div.md-col', md('Creator', m.creator), md('Genre', name(typeof EXPLORE_GENRES !== 'undefined' ? EXPLORE_GENRES : [], set.genreId))),
        h('div.md-col', md('Source', m.source), md('Language', name(typeof EXPLORE_LANGUAGES !== 'undefined' ? EXPLORE_LANGUAGES : [], set.languageId))),
        h('div.md-col', md('Submitted', date(set.submittedDate)), md('Ranked', date(set.rankedDate)))),
      h('div.md', h('div.md-k', 'User tags'), h('div.md-v', (UserTags.ask(m.hash), UserTags.chips(m.hash)) || '-')),
      h('div.md', h('div.md-k', 'Mapper tags'), h('div.md-v', tagEl)),
      this.onlinePanels(m, set));
  },
  onlinePanels(m, set) {
    if (!(set.onlineId > 0) || typeof OnlineBeatmaps === 'undefined' || typeof ExplorerScreen === 'undefined') return null;
    const cache = this._onlineSets || (this._onlineSets = new Map()), got = cache.get(set.onlineId);
    if (got === undefined) {
      cache.set(set.onlineId, null);
      OnlineBeatmaps.getSet(set.onlineId).then(full => { cache.set(set.onlineId, full || false); const cur = BeatmapManager.maps.get(this.selectedId); if (cur && cur.setId === set.id) { this._lbKey = null; this.updateInfo(); } })
        .catch(() => cache.set(set.onlineId, false));
      return null;
    }
    if (!got) return null;
    const d = got.diffs.find(x => x.id === m.onlineId);
    const parts = [ExplorerScreen.ratingsBox(got), d ? ExplorerScreen.failBox(d) : null].filter(Boolean);
    return parts.length ? h('div.md-online', ...parts) : null;
  },
  collectionMenu(e, m) {
    const r = (e.currentTarget || e.target).getBoundingClientRect();
    // opened from a footer button the menu stands on it instead of covering the play button
    const up = r.top > innerHeight / 2;
    showMenu(r.left, up ? r.top - 6 : r.bottom + 4, [
      { header: 'Add to collection' },
      ...Collections.list.map(c => ({ label: c.name, icon: 'folder', checked: c.hashes.includes(m.hash), onClick: async () => { const on = await Collections.toggle(c.id, m.hash); Toast.show(on ? `Added to ${c.name}` : `Removed from ${c.name}`); } })),
      { sep: true },
      { label: 'Manage collections…', icon: 'edit', onClick: () => ManageCollections.open() },
      { label: 'New collection…', icon: 'plus', onClick: async () => { const n = await Dialog.prompt('New collection', '', { ok: 'Create', placeholder: 'e.g. LN practice' }); if (n) { const c = await Collections.create(n); await Collections.toggle(c.id, m.hash); Toast.ok(`Added to ${c.name}`); } } },
    ], { above: up });
  },
  options(e, m) {
    m = m || BeatmapManager.maps.get(this.selectedId);
    if (!m) return;
    const set = BeatmapManager.setById.get(m.setId);
    // from the footer (its button or F3) the menu stands on the Options button like lazer's footer popover; a
    // right-click on a panel opens it where you clicked
    const btn = this.optionsBtn && this.optionsBtn.isConnected && (!e || !e.clientX || e.currentTarget === this.optionsBtn) ? this.optionsBtn.getBoundingClientRect() : null;
    if (btn) { this.optionsPopover(m, set); return; }
    const x = e && e.clientX ? e.clientX : innerWidth / 2 - 110, y = e && e.clientY ? e.clientY - 10 : innerHeight - 320;
    showMenu(x, y, [
      { header: `${set.title} [${m.version}]` },
      { label: 'Play', icon: 'play', onClick: () => this.play() },
      { label: 'Practice', icon: 'flag', onClick: () => this.play('practice') },
      { label: 'Watch Auto', icon: 'film', onClick: () => this.play('auto') },
      { label: 'Edit', icon: 'editcircle', onClick: () => Screens.go('editor', { mapId: m.id }) },
      { sep: true },
      { label: Favorites.has(set.id) ? 'Remove from favourites' : 'Add to favourites', icon: 'heart', onClick: () => Favorites.toggle(set.id) },
      { label: 'Manage collections…', icon: 'folder', onClick: () => ManageCollections.open() },
      { sep: true },
      { label: 'Hide', icon: 'x', onClick: () => this.hideMap(m) },
      ...((Settings.get('songselect.hidden') || []).length ? [{ label: 'Restore all hidden', icon: 'retry', onClick: () => this.restoreHidden() }] : []),
      { label: 'Clear local scores', icon: 'trash', onClick: () => this.clearScores(m) },
      { sep: true },
      { label: 'Export .osz', icon: 'download', onClick: () => BeatmapManager.exportOsz(set.id) },
      { label: 'Delete beatmap set…', icon: 'trash', danger: true, onClick: () => this.deleteSet(set) },
    ]);
  },
  /** lazer's carousel "Hide": the difficulty leaves the list until "Restore all hidden". */
  hideMap(m) {
    const list = Settings.get('songselect.hidden') || [];
    if (!list.includes(m.hash)) Settings.set('songselect.hidden', [...list, m.hash]);
    Toast.show(`Hid ${m.version}`, 'Bring it back with "Restore all hidden" in the beatmap options.');
    this.rebuild(true);
  },
  restoreHidden() {
    const n = (Settings.get('songselect.hidden') || []).length;
    Settings.set('songselect.hidden', []);
    Toast.show(`Restored ${plural(n, 'hidden difficulty', 'hidden difficulties')}`);
    this.rebuild(true);
  },
  async clearScores(m) {
    if (!ScoreManager.forMap(m.hash).length) { Toast.show('No local scores on this difficulty'); return; }
    if (!(await Dialog.confirm('Clear local scores?', `Every score you've set on ${m.title} [${m.version}] goes for good.`, { ok: 'Clear', danger: true }))) return;
    const n = await ScoreManager.clearMap(m.hash);
    Toast.show(`Cleared ${plural(n, 'score', 'scores')}`);
    this._lbKey = null; this.updateInfo();
  },
  /** lazer's FooterButtonOptions popover: above the Options button, "General", "For all difficulties" and "For
   *  selected difficulty", each with 265 × 50 rounded buttons (17px icon at 15px, the label at 40px); 1–9 press them. */
  optionsPopover(m, set) {
    if (this._opts) { this.closeOptions(); return; } // (the button and F3 toggle it)
    const items = [];
    const head = (t, ctx) => h('div.op-head', h('b', t), ctx ? h('span', ctx) : null);
    const btn = (label, ic, fn, danger) => { const b = h(`button.op-btn${danger ? '.danger' : ''}`, { onclick: () => { UISounds.click(); setTimeout(() => this.closeOptions(), 50); fn(); } }, icon(ic), h('span', label)); items.push(b); return b; };
    const el = h('div.op-pop', { role: 'menu' },
      head('General'),
      btn('Manage collections', 'folder', () => ManageCollections.open()),
      head('For all difficulties', `${set.artist} - ${set.title}`),
      btn('Export .osz', 'download', () => BeatmapManager.exportOsz(set.id)),
      btn('Delete...', 'trash', () => this.deleteSet(set), true),
      head('For selected difficulty', m.version),
      btn('Play', 'play', () => this.play()),
      btn('Practice', 'flag', () => this.play('practice')),
      btn('Watch Auto', 'film', () => this.play('auto')),
      btn('Edit', 'editcircle', () => Screens.go('editor', { mapId: m.id })),
      btn(Favorites.has(set.id) ? 'Remove from favourites' : 'Add to favourites', 'heart', () => Favorites.toggle(set.id)),
      btn('Clear local scores', 'trash', () => this.clearScores(m)),
      btn('Hide', 'x', () => this.hideMap(m)),
      ...((Settings.get('songselect.hidden') || []).length ? [btn('Restore all hidden', 'retry', () => this.restoreHidden())] : []));
    $('#app').appendChild(el);
    const r = this.optionsBtn.getBoundingClientRect(), z = Zoom.z;
    el.style.left = `${Math.max(8, (r.left + r.width / 2) * z - el.offsetWidth / 2)}px`;
    el.style.top = `${r.top * z - el.offsetHeight - 14}px`;
    el.style.setProperty('--ax', `${(r.left + r.width / 2) * z - parseFloat(el.style.left)}px`);
    this.optionsBtn.classList.add('on');
    const away = ev => { if (!el.contains(ev.target) && !this.optionsBtn.contains(ev.target)) this.closeOptions(); };
    const keys = ev => {
      if (ev.key === 'Escape' || ev.key === 'F3') { ev.preventDefault(); ev.stopImmediatePropagation(); this.closeOptions(); return; }
      if (!ev.ctrlKey && /^Digit[1-9]$/.test(ev.code)) { const b = items[+ev.code.slice(5) - 1]; if (b) { ev.preventDefault(); ev.stopImmediatePropagation(); b.click(); } }
    };
    setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
    window.addEventListener('keydown', keys, true);
    this._opts = { el, off: () => { document.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', keys, true); } };
  },
  closeOptions() {
    if (!this._opts) return;
    this._opts.off(); this._opts.el.remove(); this._opts = null;
    if (this.optionsBtn) this.optionsBtn.classList.remove('on');
  },
  async deleteSet(set) {
    set = set || BeatmapManager.setById.get(BeatmapManager.maps.get(this.selectedId)?.setId);
    if (!set) return;
    if (await Dialog.confirm('Delete beatmap set?', `${set.artist} - ${set.title} (${plural(set.maps.length, 'difficulty', 'difficulties')}) will be removed from your library. Scores are kept.`, { ok: 'Delete', danger: true })) {
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
    if (this.mpPick && Multiplayer.inRoom()) {
      UISounds.click();
      Multiplayer.selectMap(m, Settings.get('songselect.mods') || []);
      Screens.go('multiplayer', {}, { replace: true });
      return;
    }
    UISounds.click();
    const mods = Settings.get('songselect.mods') || [];
    Game.launch({ mapId: m.id, mods: mode === 'auto' ? ModSystem.normalize([...mods.filter(x => !MOD_BY_ID.get('AT').incompatible.includes(x)), 'AT']) : mods, mode: mode === 'auto' ? 'play' : mode });
  },
};
