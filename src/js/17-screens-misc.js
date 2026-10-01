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
      h('button.btn.primary', { onclick: () => importViaPicker('.osz,.osu,.osk,.amr,.json,.mp3,.ogg,.wav,.jpg,.jpeg,.png') }, icon('upload'), 'Import files'),
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
        h('div.muted', { style: { fontSize: '.78rem', marginTop: '6px' } }, `Files stored: ${Object.keys(set.fileIndex).length}${set.storyboard ? ' · storyboard detected (not rendered)' : ''}${set.video ? ' · video skipped' : ''} · source: ${set.sourceName || '—'}`));
      const row = h('div.list-row', { style: { flexWrap: 'wrap' } },
        thumb,
        h('div.main', h('div.t', `${set.artist} — ${set.title}`), h('div.s', `mapped by ${set.creator} · ${set.maps.length} difficult${set.maps.length === 1 ? 'y' : 'ies'} · ${[...new Set(set.maps.map(m => m.keys + 'K'))].join(', ')} · added ${fmtDate(set.added)}`)),
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
      h('button.btn.danger', { onclick: async () => { if (await Dialog.confirm('Delete collection?', `"${c.name}" will be deleted. Beatmaps are not affected.`, { ok: 'Delete', danger: true })) Collections.remove(c.id); } }, icon('trash'))));
    const list = h('div.list');
    if (!c.hashes.length) list.append(h('div.empty', h('div.big', 'Empty collection'), 'In song select, use the folder button or F3 → "Manage collections" to add difficulties.'));
    for (const hash of c.hashes) {
      const m = BeatmapManager.mapByHash(hash);
      const best = ScoreManager.best(hash);
      list.append(h('div.list-row', best ? gradeEl(best.grade) : h('span', { style: { width: '40px' } }),
        h('div.main', h('div.t', m ? `${m.artist} — ${m.title}` : 'Missing beatmap'), h('div.s', m ? `[${m.version}] · ${m.keys}K · ${m.creator}` : `hash ${hash.slice(0, 12)}… (not in library)`)),
        m ? starBadge(m.stars) : null,
        m ? h('button.btn.sm', { onclick: () => Screens.go('songselect', { mapId: m.id }) }, icon('play'), 'Open') : null,
        h('button.icon-btn', { title: 'Remove from collection', onclick: () => Collections.toggle(c.id, hash) }, icon('x'))));
    }
    this.main.append(list);
  },
};

// ─────────────────────────────── Profile (osu!lazer user profile layout; includes statistics) ───────────────────────────────
const ProfileScreen = {
  enter() {
    const { el, page } = pageShell('Profile', null, [], { icon: 'user', hue: 'pink', wide: true });
    this.page = page;
    this._unsub = [Bus.on('profile:changed', () => this.render()), Bus.on('scores:changed', () => this.render())];
    this.render();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); },
  render() {
    const page = this.page;
    clearEl(page);
    const p = ProfileManager.profile;
    const xp = ProfileManager.xpInfo();
    const st = StatisticsManager.compute();
    const bestPerMap = new Map();
    for (const s of ScoreManager.scores) if (s.passed && (!bestPerMap.has(s.mapHash) || ScoreManager.value(bestPerMap.get(s.mapHash)) < ScoreManager.value(s))) bestPerMap.set(s.mapHash, s);
    const rankedScore = [...bestPerMap.values()].reduce((a, s) => a + s.score, 0);
    const pp = ScoreManager.totalPp();
    const topPlays = ScoreManager.bestPpPerMap();
    const avatar = ProfileManager.avatarEl(120);
    avatar.classList.add('pf-avatar');
    avatar.title = 'Change avatar';
    avatar.addEventListener('click', () => AvatarPicker.open());
    // osu!lazer's UserProfileOverlay: the cover (here the background of your latest play) with the avatar and name,
    // a strip with play count / time and the level badge, then the detail area: performance and accuracy, rank
    // counts as rank pills, the stat list; then a section tab bar and the sections themselves.
    const cover = h('div.pf-cover');
    const last = ScoreManager.recent(1)[0], lastMap = last && BeatmapManager.mapByHash(last.mapHash);
    if (lastMap) BeatmapManager.bgURL(lastMap).then(u => { if (u) { cover.style.backgroundImage = `url("${u}")`; cover.classList.add('img'); } }).catch(() => {});
    const top = h('div.pf-top', cover, h('div.pf-top-in',
      avatar,
      h('div.pf-id',
        h('div.pf-name', p.name, h('button.icon-btn', { title: 'Rename', 'aria-label': 'Rename', onclick: async () => { const n = await Dialog.prompt('Username', p.name); if (n) ProfileManager.setName(n); } }, icon('edit'))),
        h('div.pf-tags', h('span.pf-tag', 'osu!mania'), h('span.pf-since', `Playing since ${new Date(p.created).toLocaleDateString([], { year: 'numeric', month: 'long' })}`)))));
    const centre = h('div.pf-centre',
      h('span.pf-chip', { title: 'Play count' }, icon('play', 'fill'), fmtInt(st.plays)),
      h('span.pf-chip', { title: 'Play time' }, icon('clock'), fmtDuration(st.playtime)),
      h('div.grow'),
      h('div.pf-level', { title: `${fmtInt(xp.into)} / ${fmtInt(xp.need)} XP` },
        h('div.pf-hex', h('span', String(xp.level))),
        h('div.pf-lvl', h('div.pf-lvl-bar', h('i', { style: { width: (xp.progress * 100).toFixed(1) + '%' } })), h('span', `${Math.floor(xp.progress * 100)}%`))));
    const grades = st.grades || {};
    const rank = g => h('div.pf-rank', rankPill(g), h('span', fmtInt(grades[g] || 0)));
    const dl = (k, v) => h('div.pf-dl', h('span', k), h('b', v));
    const detail = h('div.pf-detail',
      h('div.pf-detail-l',
        h('div.pf-bigs',
          h('div.pf-big', { title: `${fmtInt(pp.weighted)}pp from top plays (weighted 0.95ⁿ) + ${fmtInt(pp.bonus)}pp bonus` }, h('span', 'Performance'), h('b', fmtInt(pp.total) + 'pp')),
          h('div.pf-big', h('span', 'Hit accuracy'), h('b', st.passed ? fmtAcc(st.avgAcc) : '—'))),
        h('div.pf-ranks', rank('XH'), rank('SS'), rank('SH'), rank('S'), rank('A'))),
      h('div.pf-detail-r',
        dl('Ranked score', fmtInt(rankedScore)), dl('Hit accuracy', st.passed ? fmtAcc(st.avgAcc) : '—'), dl('Play count', fmtInt(st.plays)),
        dl('Play time', fmtDuration(st.playtime)), dl('Total hits', fmtInt(st.notes)), dl('Maximum combo', fmtInt(st.highestCombo) + 'x')));
    // sections, with lazer's sticky tab bar
    const secs = [];
    const section = (id, title, ...kids) => { const el = h('section.pf-sec', { dataset: { sec: id } }, h('h2', title), ...kids); secs.push([id, title, el]); return el; };
    const sub = (title, count, ...kids) => h('div.pf-subsec', h('h3', title, count != null ? h('span.pf-count', fmtInt(count)) : null), ...kids);
    const ppHist = ScoreManager.ppHistory();
    const day = 86400000;
    const hist = section('historical', 'Historical',
      ppHist.length > 1 ? sub('Performance', null, h('div.pf-chart', Charts.line(ppHist.slice(-120).map(x => ({ y: x.pp, tip: `${fmtInt(x.pp)}pp after ${x.title} [${x.version}] · ${new Date(x.date).toLocaleDateString()}` })), { fmtY: v => Math.round(v) + 'pp', yMin: 0, height: 160, dots: false }))) : null,
      st.plays ? sub('Play history', null, h('div.pf-chart', Charts.bars(st.perDay.map(d => ({ label: new Date(d.day * day).toLocaleDateString([], { month: 'short', day: 'numeric' }), value: d.plays, tip: `${new Date(d.day * day).toLocaleDateString()}: ${d.plays} play${d.plays === 1 ? '' : 's'}` }))))) : h('div.pf-empty', 'Nothing here yet. Play something!'));
    const ranks = section('ranks', 'Ranks',
      sub('Best performance', topPlays.length, topPlays.length
        ? h('div.pf-scores', ...topPlays.slice(0, 20).map((tp, i) => this.scoreRow(tp.score, fmtInt(tp.pp), `weighted ${Math.round(Math.pow(0.95, i) * 100)}%`, fmtInt(tp.pp * Math.pow(0.95, i)))))
        : h('div.pf-empty', 'No performance records. Pass a map to earn pp.')));
    const recent = ScoreManager.recent(10);
    const rec = section('recent', 'Recent',
      sub('Recent plays', recent.length, recent.length
        ? h('div.pf-scores', ...recent.map(s => this.scoreRow(s, s.passed ? fmtInt(ScoreManager.ppOf(s)) : null)))
        : h('div.pf-empty', 'No recent plays.')));
    let pinned = null; // (a clicked tab stays lit until you scroll yourself, even if its section can't reach the top)
    const tabs = h('div.pf-tabs', ...secs.map(([id, title, el]) => h('button.ov-tab', { onclick: () => { UISounds.click(); pinned = id; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); [...tabs.children].forEach((b, i) => b.classList.toggle('on', secs[i][0] === id)); } }, title.toLowerCase())));
    page.append(h('div.pf-header', top, centre, detail), tabs, hist, ranks, rec);
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
    return h('button.pf-score', { onclick: () => Screens.go('results', { score: s, fromList: true }) },
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
      h('button.btn', { onclick: () => importViaPicker('.amr,.json') }, icon('upload'), 'Import .amr')], { icon: 'film', hue: 'plum' });
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
    for (const r of ReplayManager.list) {
      const map = BeatmapManager.mapByHash(r.mapHash);
      const sm = r.summary || {};
      this.list.append(h('div.list-row', gradeEl(sm.grade || 'D'),
        h('div.main', h('div.t', `${r.title} [${r.version}]`), h('div.s', `${r.artist} · by ${r.player} · ${fmtScore(ScoreManager.value(sm) || 0)} · ${fmtAcc(sm.accuracy || 0)} · ${fmtInt(sm.maxCombo || 0)}x · ${fmtDateTime(r.date)}${map ? '' : ' · beatmap missing'}`)),
        h('span.row', { style: { gap: '3px' } }, ...(r.mods || []).map(m => ModSystem.badge(m, true))),
        h('button.btn.sm', { disabled: !map, onclick: () => Game.launch({ mapId: map.id, mode: 'replay', replay: r }) }, icon('play'), 'Watch'),
        h('button.icon-btn', { title: 'Export .amr', onclick: () => ReplayManager.export(r) }, icon('download')),
        h('button.icon-btn', { title: 'Delete', onclick: async () => { if (await Dialog.confirm('Delete replay?', `${r.title} [${r.version}] by ${r.player}`, { ok: 'Delete', danger: true })) ReplayManager.remove(r.id); } }, icon('trash'))));
    }
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
      Bus.on('settings:changed', k => { if (!(k.startsWith('skin.c.') || ['skin.noteStyle', 'skin.hue', 'skin.darkerHolds', 'ui.theme'].includes(k)) || !this.preview || !this.previewSkin) return;
        clearTimeout(this._pvT); this._pvT = setTimeout(() => { this.previewSkin.layoutCache.clear(); this.preview.show(this.previewSkin, this.keys); }, 120); })];
    this.render();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); if (this._customOff) { this._customOff(); this._customOff = null; } this.preview && this.preview.stop(); },
  CUSTOM_KEYS: ['skin.noteStyle', 'skin.c.palette', 'skin.hue', 'skin.c.pattern', 'skin.c.noteSize', 'skin.c.round', 'skin.c.receptor', 'skin.c.keyArea', 'skin.c.hold', 'skin.darkerHolds', 'skin.c.glow', 'skin.c.lines', 'skin.c.border'],
  /** The Custom skin's options next to its preview (the same controls as in Settings → Skin). */
  customPanel() {
    const box = h('div.sk-custom');
    const paint = () => clearEl(box).append(h('div.sk-custom-h', icon('brush'), 'Customise', h('button.btn.sm.ghost', { onclick: () => { for (const k of this.CUSTOM_KEYS) { const d = Settings.schema.get(k); if (d) Settings.set(k, structuredClone(d.d)); } UISounds.click(); paint(); } }, 'Reset')),
      h('div.settings-panel.sk-custom-rows', ...this.CUSTOM_KEYS.map(k => Settings.schema.get(k)).filter(Boolean).map(d => SettingsPanel.row(d))));
    paint();
    // the Custom hue row only shows with the "Custom hue" palette
    if (this._customOff) this._customOff();
    this._customOff = Bus.on('settings:changed', k => { if (k === 'skin.c.palette' && box.isConnected) paint(); });
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
        !meta.builtin ? h('button.btn.danger', { onclick: async () => { if (await Dialog.confirm('Delete skin?', `${skin.name} will be removed.`, { ok: 'Delete', danger: true })) { await SkinManager.remove(meta.id); this.sel = SkinManager.current.id; } } }, icon('trash')) : null),
      h('div.sk-keys', h('span.muted', 'Preview'),
        h('button.sk-step', { 'aria-label': 'Fewer keys', disabled: this.keys <= 1, onclick: () => { this.keys = Math.max(1, this.keys - 1); this.render(); } }, icon('back')),
        h('span.sk-k', `${this.keys}K`),
        h('button.sk-step', { 'aria-label': 'More keys', disabled: this.keys >= MAX_KEYS, onclick: () => { this.keys = Math.min(MAX_KEYS, this.keys + 1); this.render(); } }, icon('chevron')),
        h('span.muted.sk-khint', meta.builtin ? '' : borrowed.includes(this.keys) ? "built from the skin's 4K layout" : supported.includes(this.keys) ? 'configured in skin.ini' : 'fallback layout')),
      meta.builtin ? h('div.sk-custom-wrap', pv, this.customPanel()) : pv,
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
  { id: '2026.10.3', title: 'Little things', sections: [
    { icon: 'sparkle', title: 'Nicer', items: ['A lazer-style skip button', 'The hit distribution on results reads like lazer\'s', 'Clicking the music button keeps now playing open', 'Song select keeps your beatmap when a search finds nothing', 'Long song titles fit everywhere', 'Open Settings and just type to search it', 'The song list no longer slides sideways when you click a beatmap', 'Watching a replay from the Replays page starts right away', 'Star ratings follow speed mods like DT'] },
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
