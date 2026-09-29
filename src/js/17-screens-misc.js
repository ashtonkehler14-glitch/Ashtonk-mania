/* Beatmaps library, Collections, Profile, Statistics, Replays and Skins screens. */

function pageShell(title, sub, actions = []) {
  const body = h('div.screen-body');
  const page = h('div.page');
  page.append(h('div.screen-title', h('div', h('h1', title), sub ? h('div.sub', sub) : null), h('div.grow'), ...actions));
  body.append(page);
  return { el: h('div', body), page };
}

async function importViaPicker(accept, directory = false) {
  const files = await pickFiles({ accept, multiple: true, directory });
  if (files.length) await App.importFiles(files);
}

// ─────────────────────────────── Beatmaps ───────────────────────────────
const BeatmapsScreen = {
  q: '',
  enter() {
    const { el, page } = pageShell('Beatmaps', 'Import, validate and manage your local library', [
      h('button.btn', { onclick: () => importViaPicker('', true) }, icon('folder'), 'Import folder'),
      h('button.btn.primary', { onclick: () => importViaPicker('.osz,.osu,.osk,.amr,.json,.mp3,.ogg,.wav,.jpg,.jpeg,.png') }, icon('upload'), 'Import files'),
    ]);
    this.page = page;
    this.summary = h('div.stats-grid');
    const search = h('input.input', { placeholder: 'Filter library…', value: this.q, style: { flex: '1', maxWidth: '420px' } });
    search.addEventListener('input', () => { this.q = search.value.toLowerCase(); this.renderList(); });
    search.addEventListener('keydown', e => e.stopPropagation());
    this.list = h('div.list');
    this.report = h('div');
    page.append(this.summary, h('div', { style: { height: '18px' } }), this.report,
      h('div.row', { style: { margin: '6px 0 12px' } }, search, h('span.grow'),
        h('span.muted', { style: { fontSize: '.8rem' } }, 'Providers: ', BeatmapProviders.list.map(p => p.name).join(', '))),
      this.list);
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
    const card = (k, v, sub) => h('div.panel.big-stat', h('div.k', k), h('div.v', v), sub ? h('div.sub', sub) : null);
    const keyModes = [...new Set(maps.map(m => m.keys))].sort((a, b) => a - b).map(k => k + 'K').join(' · ') || '—';
    clearEl(this.summary).append(
      card('Beatmap sets', fmtInt(BeatmapManager.sets.length)), card('Difficulties', fmtInt(maps.length), keyModes),
      card('Unplayable', fmtInt(broken), broken ? 'see details below' : 'all good'),
      card('Storage used', est ? fmtBytes(est.usage || 0) : 'n/a', est && est.quota ? `of ${fmtBytes(est.quota)} available` : ''));
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
    const { el, page } = pageShell('Collections', 'Group difficulties however you like', [
      h('button.btn.primary', { onclick: async () => { const n = await Dialog.prompt('New collection', '', { ok: 'Create', placeholder: 'e.g. LN practice, Neru ✦' }); if (n) { const c = await Collections.create(n); this.sel = c.id; } } }, icon('plus'), 'New collection')]);
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
    this.side.append(h('div.muted', { style: { fontSize: '.8rem', padding: '10px 4px' } }, `♥ ${favCount} favorite set${favCount === 1 ? '' : 's'} — filter them in song select.`));
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

// ─────────────────────────────── Profile ───────────────────────────────
const ProfileScreen = {
  enter() {
    const { el, page } = pageShell('Profile', null);
    this.page = page;
    this._unsub = [Bus.on('profile:changed', () => this.render()), Bus.on('scores:changed', () => this.render())];
    this.render();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); },
  render() {
    const page = this.page;
    while (page.children.length > 1) page.lastChild.remove();
    page.firstChild.style.display = 'none';
    const p = ProfileManager.profile;
    const xp = ProfileManager.xpInfo();
    const st = StatisticsManager.compute();
    const bestPerMap = new Map();
    for (const s of ScoreManager.scores) if (s.passed && (!bestPerMap.has(s.mapHash) || bestPerMap.get(s.mapHash).score < s.score)) bestPerMap.set(s.mapHash, s);
    const totalScore = [...bestPerMap.values()].reduce((a, s) => a + s.score, 0);
    const banner = h(`div.profile-banner${p.banner === 'neru' ? '.neru' : ''}`,
      ProfileManager.avatarEl(110),
      h('div', { style: { flex: '1', minWidth: '260px' } },
        h('div.pname', p.name, h('button.icon-btn', { title: 'Rename', onclick: async () => { const n = await Dialog.prompt('Profile name', p.name); if (n) ProfileManager.setName(n); } }, icon('edit')),
          p.banner === 'neru' ? h('span.gold', { title: 'Neru theme' }, '✦') : null),
        h('div.plevel', h('div.lvl-badge', String(xp.level)), h('div', h('div.xp-bar', h('i', { style: { width: (xp.progress * 100).toFixed(1) + '%' } })),
          h('div.muted', { style: { fontSize: '.8rem', marginTop: '4px' } }, `${fmtInt(xp.into)} / ${fmtInt(xp.need)} XP to level ${xp.level + 1} · ${fmtInt(xp.xp)} XP total`))),
        h('div.muted', { style: { marginTop: '8px', fontSize: '.85rem' } }, `Local player since ${new Date(p.created).toLocaleDateString()}`)));
    const card = (k, v, sub) => h('div.panel.big-stat', h('div.k', k), h('div.v', v), sub ? h('div.sub', sub) : null);
    const stats = h('div.stats-grid', { style: { marginTop: '16px' } },
      card('Total score', fmtInt(totalScore), 'sum of best scores'), card('Accuracy', st.passed ? fmtAcc(st.avgAcc) : '—', 'average of passes'),
      card('Play count', fmtInt(st.plays), `${st.passed} passed · ${st.failed} failed`), card('Play time', fmtDuration(st.playtime)),
      card('Highest combo', fmtInt(st.highestCombo) + 'x'), card('Best grade', st.bestGrade ? gradeEl(st.bestGrade) : '—'));
    // customisation
    const avatarOpts = [['default', 'Monogram'], ['neru', 'Neru ✦'], ['custom', 'Custom image']];
    const picker = h('div.avatar-picker', ...avatarOpts.map(([k, label]) => {
      const prev = k === 'default' ? h('div.avatar.avatar-mono', { style: { width: '56px', height: '56px', fontSize: '24px' } }, p.name.slice(0, 1).toUpperCase())
        : k === 'neru' ? h('div.avatar.avatar-neru', { style: { width: '56px', height: '56px' }, html: NERU_AVATAR_SVG })
          : h('div.avatar', { style: { width: '56px', height: '56px', backgroundImage: ProfileManager.avatarURL ? `url("${ProfileManager.avatarURL}")` : '' } }, ProfileManager.avatarURL ? null : icon('upload'));
      return h(`button.avatar-opt${p.avatar === k ? '.on' : ''}`, { title: label, onclick: async () => {
        if (k === 'custom') { const [f] = await pickFiles({ accept: 'image/*', multiple: false }); if (f) await ProfileManager.setAvatar('custom', f); }
        else await ProfileManager.setAvatar(k);
        if (k === 'neru') neruSparkBurst(document.querySelector('.profile-banner .avatar'), 8);
        Toolbar.updateProfile();
      } }, prev, h('div.muted', { style: { fontSize: '.7rem', marginTop: '4px' } }, label));
    }));
    const bannerSel = h('div.row', ...[['kori', 'Kori'], ['neru', 'Neru ✦']].map(([k, l]) => h(`button.chip${p.banner === k ? '.on' : ''}`, { onclick: async () => { p.banner = k; await ProfileManager.save(); } }, l)));
    const custom = h('div.panel', { style: { padding: '16px', marginTop: '16px' } }, h('div.sp-group', { style: { marginTop: 0 } }, 'Avatar'), picker,
      h('div.sp-group', 'Profile theme'), bannerSel);
    // lists
    const recent = h('div.panel', { style: { padding: '16px' } }, h('div.sp-group', { style: { marginTop: 0 } }, 'Recent plays'), this.scoreList(ScoreManager.recent(10)));
    const pbs = h('div.panel', { style: { padding: '16px' } }, h('div.sp-group', { style: { marginTop: 0 } }, 'Personal bests'), this.scoreList([...bestPerMap.values()].sort((a, b) => b.score * (b.stars || 1) - a.score * (a.stars || 1)).slice(0, 10)));
    const favs = BeatmapManager.sets.filter(s => Favorites.has(s.id));
    const favPanel = h('div.panel', { style: { padding: '16px', marginTop: '16px' } }, h('div.sp-group', { style: { marginTop: 0 } }, `Favorites (${favs.length})`),
      favs.length ? h('div.list', ...favs.slice(0, 12).map(s => h('div.list-row', h('div.main', h('div.t', `${s.artist} — ${s.title}`), h('div.s', `${s.maps.length} difficulties · ${s.creator}`)),
        h('button.btn.sm', { onclick: () => Screens.go('songselect', { mapId: s.maps[0].id }) }, icon('play'), 'Open')))) : h('div.muted', 'No favorites yet.'));
    page.append(banner, stats, custom, h('div.chart-row', recent, pbs), favPanel);
  },
  scoreList(scores) {
    if (!scores.length) return h('div.muted', 'Nothing here yet.');
    return h('div.list', ...scores.map(s => h('button.list-row', { style: { textAlign: 'left', width: '100%' }, onclick: () => Screens.go('results', { score: s, fromList: true }) },
      gradeEl(s.grade), h('div.main', h('div.t', `${s.title} [${s.version}]`), h('div.s', `${fmtScore(s.score)} · ${fmtAcc(s.accuracy)} · ${fmtInt(s.maxCombo)}x${s.mods.length ? ' · +' + s.mods.join('') : ''} · ${fmtDate(s.date)}`)))));
  },
};

// ─────────────────────────────── Statistics ───────────────────────────────
const StatsScreen = {
  enter() {
    const { el, page } = pageShell('Statistics', 'Everything you have played, locally tracked');
    const st = StatisticsManager.compute();
    const card = (k, v, sub) => h('div.panel.big-stat', h('div.k', k), h('div.v', v), sub ? h('div.sub', sub) : null);
    page.append(h('div.stats-grid',
      card('Total plays', fmtInt(st.plays)), card('Play time', fmtDuration(st.playtime)), card('Notes hit', fmtInt(st.notes)),
      card('Misses', fmtInt(st.misses)), card('Average accuracy', st.passed ? fmtAcc(st.avgAcc) : '—'), card('Highest score', fmtInt(st.highestScore)),
      card('Highest combo', fmtInt(st.highestCombo) + 'x'), card('Best grade', st.bestGrade ? gradeEl(st.bestGrade) : '—'),
      card('Maps passed', fmtInt(st.passed)), card('Maps failed', fmtInt(st.failed))));
    if (!st.plays) { page.append(h('div.empty', h('div.big', 'No plays yet'), 'Your graphs will appear here after your first play.')); return el; }
    const day = 86400000;
    const perDay = Charts.bars(st.perDay.map(d => ({ label: new Date(d.day * day).toLocaleDateString([], { month: 'short', day: 'numeric' }), value: d.plays, tip: `${new Date(d.day * day).toLocaleDateString()}: ${d.plays} play${d.plays === 1 ? '' : 's'}` })));
    const accTrend = st.accTrend.length ? Charts.line(st.accTrend.map(a => ({ y: a.acc * 100, tip: `${a.title} [${a.version}] · ${(a.acc * 100).toFixed(2)}% · ${new Date(a.date).toLocaleDateString()}` })), { fmtY: v => v.toFixed(1) + '%' }) : h('div.muted', 'Pass a map to see your accuracy trend.');
    page.append(h('div.chart-row',
      h('div.panel.chart-card', h('h3', 'Plays per day (last 30 days)'), perDay),
      h('div.panel.chart-card', h('h3', 'Accuracy trend (last 60 passes)'), accTrend)));
    const gradeOrder = ['XH', 'SS', 'SH', 'S', 'A', 'B', 'C', 'D', 'F'];
    const gradeData = gradeOrder.filter(g => st.grades[g]).map(g => ({ label: g === 'XH' ? 'SS·H' : g === 'SH' ? 'S·H' : g, value: st.grades[g], tip: `${g}: ${st.grades[g]} play${st.grades[g] === 1 ? '' : 's'}` }));
    const judgeData = JUDGEMENTS.map((j, i) => ({ label: j.short, value: st.judgements[i], color: j.color, tip: `${j.name}: ${fmtInt(st.judgements[i])}` }));
    page.append(h('div.chart-row',
      h('div.panel.chart-card', h('h3', 'Grade distribution'), Charts.bars(gradeData)),
      h('div.panel.chart-card', h('h3', 'Lifetime judgements'), Charts.bars(judgeData), h('div.chart-legend', ...JUDGEMENTS.map(j => h('span', { style: { '--c': j.color } }, j.name))))));
    const keys = Object.keys(st.keyModes).map(Number).sort((a, b) => a - b);
    page.append(h('div.panel.chart-card', { style: { marginTop: '16px' } }, h('h3', 'Key modes'),
      h('table.table', h('tr', h('th', 'Mode'), h('th', 'Plays'), h('th', 'Passed'), h('th', 'Average accuracy'), h('th', 'Best score'), h('th', 'Play time')),
        ...keys.map(k => { const m = st.keyModes[k]; return h('tr', h('td', h('span.keys-tag', k + 'K')), h('td', fmtInt(m.plays)), h('td', fmtInt(m.passed)), h('td', m.passed ? fmtAcc(m.accSum / m.passed) : '—'), h('td', fmtInt(m.best)), h('td', fmtDuration(m.playtime))); }))));
    return el;
  },
};

// ─────────────────────────────── Replays ───────────────────────────────
const ReplaysScreen = {
  enter() {
    const { el, page } = pageShell('Replays', 'Saved local replays — deterministic re-simulation of your inputs', [
      h('button.btn', { onclick: () => importViaPicker('.amr,.json') }, icon('upload'), 'Import .amr')]);
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
        h('div.main', h('div.t', `${r.title} [${r.version}]`), h('div.s', `${r.artist} · by ${r.player} · ${fmtScore(sm.score || 0)} · ${fmtAcc(sm.accuracy || 0)} · ${fmtInt(sm.maxCombo || 0)}x · ${new Date(r.date).toLocaleString()}${map ? '' : ' · beatmap missing'}`)),
        h('span.row', { style: { gap: '3px' } }, ...(r.mods || []).map(m => ModSystem.badge(m, true))),
        h('button.btn.sm', { disabled: !map, onclick: () => Game.launch({ mapId: map.id, mode: 'replay', replay: r }) }, icon('play'), 'Watch'),
        h('button.icon-btn', { title: 'Export .amr', onclick: () => ReplayManager.export(r) }, icon('download')),
        h('button.icon-btn', { title: 'Delete', onclick: async () => { if (await Dialog.confirm('Delete replay?', `${r.title} [${r.version}] by ${r.player}`, { ok: 'Delete', danger: true })) ReplayManager.remove(r.id); } }, icon('trash'))));
    }
  },
};

// ─────────────────────────────── Skins ───────────────────────────────
class SkinPreview {
  constructor(canvas) { this.canvas = canvas; this.renderer = new ManiaRenderer(canvas); this.running = false; }
  async show(skin, keys) {
    this.token = {};
    const tok = this.token;
    const layout = await skin.mania(keys);
    if (tok !== this.token) return;
    this.keys = keys;
    this.renderer.setLayout(layout);
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
      this.renderer.render({ now, posNow: now, scroll: { pos: t => t, posAt: t => t }, pxPerMs: this.renderer.hitY / 520, engine: this.engine, held: this.held, barlines: null, hidden: null, realNow: performance.now() });
    };
    frame();
  }
  stop() { this.running = false; cancelAnimationFrame(this._raf); }
}

const SkinsScreen = {
  sel: null, keys: 4,
  enter() {
    const { el, page } = pageShell('Skins', 'Import .osk skins — skin.ini [Mania] layouts are applied per key count', [
      h('button.btn.primary', { onclick: () => importViaPicker('.osk') }, icon('upload'), 'Import .osk')]);
    this.sel = this.sel || SkinManager.current.id;
    this.side = h('div.side-list'); this.main = h('div');
    page.append(h('div.split', this.side, this.main));
    this._unsub = [Bus.on('skins:changed', () => this.render()), Bus.on('skin:changed', () => this.render())];
    this.render();
    return el;
  },
  leave() { (this._unsub || []).forEach(f => f()); this.preview && this.preview.stop(); },
  render() {
    const list = SkinManager.list();
    if (!list.some(s => s.id === this.sel)) this.sel = SkinManager.current.id;
    clearEl(this.side);
    for (const s of list) {
      this.side.append(h(`button.side-item${s.id === this.sel ? '.active' : ''}`, { onclick: () => { this.sel = s.id; UISounds.click(); this.render(); } },
        icon('brush'), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.name),
        s.id === SkinManager.current.id ? h('span.cnt', { style: { color: 'var(--accent)' } }, 'in use') : null));
    }
    this.side.append(h('div.muted', { style: { fontSize: '.8rem', padding: '10px 4px', lineHeight: 1.5 } }, 'Tip: drag Kori 3.0.osk (or any .osk) onto the window. The newest imported skin is selected automatically.'));
    const meta = list.find(s => s.id === this.sel);
    const skin = SkinManager.instance(meta.id);
    clearEl(this.main);
    const supported = skin.supportedKeys();
    if (!supported.includes(this.keys)) this.keys = supported.includes(4) ? 4 : supported.includes(7) ? 7 : (supported[0] || 4);
    const canvas = h('canvas');
    const pv = h('div.skin-preview', canvas);
    const kv = (k, v) => h('div.stat', h('div.k', k), h('div.v', { style: { fontSize: '.95rem' } }, v));
    const assets = [...new Set((meta.files || []).filter(f => /mania|lighting|^hit|score-|combo-/i.test(f)).map(f => f.replace(/@2x(\.\w+)$/i, '$1')))]
      .sort((a, b) => (/^mania\//i.test(b) - /^mania\//i.test(a)) || a.localeCompare(b));
    const inUse = SkinManager.current.id === meta.id;
    this.main.append(
      h('div.row', { style: { marginBottom: '12px', flexWrap: 'wrap' } }, h('h2', { style: { margin: 0, fontWeight: 900 } }, skin.name), h('span.grow'),
        h(`button.btn${inUse ? '' : '.primary'}`, { disabled: inUse, onclick: async () => { await SkinManager.select(meta.id); Toast.ok('Skin selected', skin.name); } }, inUse ? 'Selected' : 'Use this skin'),
        !meta.builtin ? h('button.btn.ghost', { onclick: () => SkinManager.exportOsk(meta.id) }, icon('download'), 'Export') : null,
        !meta.builtin ? h('button.btn.danger', { onclick: async () => { if (await Dialog.confirm('Delete skin?', `${skin.name} will be removed.`, { ok: 'Delete', danger: true })) { await SkinManager.remove(meta.id); this.sel = SkinManager.current.id; } } }, icon('trash')) : null),
      h('div.row.wrap', { style: { marginBottom: '10px', gap: '6px' } }, h('span.muted', 'Preview:'),
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => h(`button.chip${k === this.keys ? '.on' : ''}`, { title: supported.includes(k) ? 'Configured in skin.ini' : 'Uses fallback layout', style: supported.includes(k) ? {} : { opacity: 0.55 }, onclick: () => { this.keys = k; this.render(); } }, `${k}K`))),
      pv,
      h('div.skin-meta', kv('Name', skin.name), kv('Author', skin.author), kv('Version', String(skin.version)),
        kv('Key modes (skin.ini)', meta.builtin ? '1K – 10K (generated)' : (supported.length ? supported.map(k => k + 'K').join(' ') : 'none — defaults')),
        kv('Files', meta.builtin ? 'procedural' : String((meta.files || []).length)), kv('Mania assets', meta.builtin ? 'procedural' : String(assets.length))),
      !meta.builtin ? h('div.panel', { style: { padding: '14px' } }, h('div.sp-group', { style: { marginTop: 0 } }, 'Detected mania / judgement assets'),
        h('div.asset-list', ...assets.slice(0, 400).map(a => h('span.tag', a)), assets.length > 400 ? h('span.muted', `+${assets.length - 400} more`) : null,
          !assets.length ? h('span.muted', 'No mania-specific assets found; defaults are used.') : null)) : null);
    this.preview && this.preview.stop();
    this.preview = new SkinPreview(canvas);
    requestAnimationFrame(() => this.preview.show(skin, this.keys));
  },
};
