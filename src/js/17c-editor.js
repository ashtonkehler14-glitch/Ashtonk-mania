/* osu!lazer's beatmap editor, for mania: the Compose screen — a playfield scrolling with the song, where notes and
 * hold notes are placed, moved and deleted, snapped to the beat divisor (lines coloured as lazer colours them);
 * the song plays (at 25–100% speed) and a timeline along the bottom seeks; undo / redo; Save writes the difficulty
 * back into your library (its file changes, so it gets a new id) and Test plays it from the editor, coming back
 * after. Timing and metadata (lazer's Timing and Setup screens) are kept as they are. */

const EDIT_DIVISORS = [1, 2, 3, 4, 6, 8, 12, 16];
/** lazer's BindableBeatDivisor.GetColourFor: the colour of a tick by the smallest divisor it falls on. */
function snapColour(d) {
  return { 1: '#ffffff', 2: '#ed1121', 3: '#8866ee', 4: '#66ccff', 6: '#eedd00', 8: '#eedd00', 12: '#888888', 16: '#888888' }[d] || '#888888';
}

const EditorScreen = {
  inGame: true, transient: true, tab: 'songselect',
  enter(p = {}) {
    const el = h('div.editor');
    this.el = el;
    this.tool = 'select'; this.divisor = Settings.get('editor.divisor') || 4; this.zoom = 0.45; this.rateK = 1;
    this.sel = new Set(); this.undo = []; this.redo = []; this.dirty = false; this.pos = p.pos || 0; this.hover = null;
    el.append(h('div.ed-loading', h('span.spinner'), 'Loading the editor…'));
    this.load(p.mapId).catch(e => { Toast.err('Couldn\'t open the editor', friendlyError(e)); Screens.go('songselect', {}, { replace: true }); });
    return el;
  },
  leave() {
    cancelAnimationFrame(this._raf); this._raf = 0;
    window.removeEventListener('keydown', this._key, true);
    if (Music.playing) Music.pause();
    if (this._ro) this._ro.disconnect();
  },
  /** Nothing to edit yet: pick a difficulty in song select, or start a new beatmap from a song. */
  empty() {
    clearEl(this.el).append(h('div.ed-empty',
      h('h2', 'Beatmap editor'), h('p', 'Choose a difficulty to edit in song select, or start a new beatmap from a song file.'),
      h('div.ed-empty-b',
        h('button.btn.primary', { onclick: () => this.newBeatmap() }, icon('music'), 'New beatmap from a song…'),
        h('button.btn', { onclick: () => Screens.go('songselect', {}, { replace: true }) }, icon('beatmap'), 'Song select'),
        h('button.btn', { onclick: () => Screens.go('home', {}, { replace: true }) }, icon('back'), 'Back'))));
  },
  /** lazer: a brand new beatmap from a song file — a set with one 4K difficulty at 120 BPM (set the real timing on
   *  the Timing screen) and a single note, opened here. */
  async newBeatmap() {
    const [file] = await pickFiles({ accept: 'audio/*,.mp3,.ogg,.wav', multiple: false });
    if (!file) return;
    const base = file.name.replace(/\.[^.]+$/, '').trim() || 'New song';
    const [artist, title] = base.includes(' - ') ? base.split(' - ', 2) : ['Unknown artist', base];
    const audioName = 'audio' + (file.name.match(/\.[^.]+$/) || ['.mp3'])[0].toLowerCase();
    const creator = ProfileManager.profile.name || 'Mapper';
    const text = `osu file format v14\n\n[General]\nAudioFilename: ${audioName}\nAudioLeadIn: 0\nPreviewTime: -1\nCountdown: 0\nSampleSet: Soft\nStackLeniency: 0.7\nMode: 3\nLetterboxInBreaks: 0\nSpecialStyle: 0\nWidescreenStoryboard: 1\n\n` +
      `[Editor]\nDistanceSpacing: 1\nBeatDivisor: 4\nGridSize: 4\nTimelineZoom: 1\n\n` +
      `[Metadata]\nTitle:${title}\nTitleUnicode:${title}\nArtist:${artist}\nArtistUnicode:${artist}\nCreator:${creator}\nVersion:Normal\nSource:\nTags:\nBeatmapID:0\nBeatmapSetID:-1\n\n` +
      `[Difficulty]\nHPDrainRate:7\nCircleSize:4\nOverallDifficulty:7\nApproachRate:5\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[Events]\n//Background and Video events\n//Break Periods\n//Storyboard Layer 0 (Background)\n\n` +
      `[TimingPoints]\n0,500,4,1,0,100,1,0\n\n[HitObjects]\n64,192,2000,1,0,0:0:0:0:\n`;
    const bytes = new TextEncoder().encode(text), audio = new Uint8Array(await file.arrayBuffer());
    const osuName = `${artist} - ${title} (${creator}) [Normal].osu`.replace(/[\\/:*?"<>|]/g, '');
    try {
      const report = { errors: [], warnings: [] };
      const sets = await BeatmapManager._importEntries([{ name: audioName, size: audio.length, read: async () => audio }, { name: osuName, size: bytes.length, read: async () => bytes }], base, report);
      const m = sets[0] && sets[0].maps[0];
      if (!m) throw new Error(report.errors[0] || report.warnings[0] || 'The song couldn\'t be read.');
      Bus.emit('library:changed');
      Toast.ok('New beatmap', 'Set its timing on the Timing screen first: it starts at 120 BPM.');
      if (Screens.current === this) this.reopen(m.id); else Screens.go('editor', { mapId: m.id });
    } catch (e) { Toast.err('Couldn\'t make a beatmap from that file', friendlyError(e)); }
  },
  /** Open another difficulty here (the new one just made). */
  reopen(mapId) {
    this.leave();
    this.sel = new Set(); this.undo = []; this.redo = []; this.dirty = false; this.pos = 0; this.hover = null; this._ctx = null; this._tlCtx = null; this._tlImg = null;
    clearEl(this.el).append(h('div.ed-loading', h('span.spinner'), 'Loading the editor…'));
    SongSelect.selectedId = mapId;
    this.load(mapId).catch(e => Toast.err('Couldn\'t open the difficulty', friendlyError(e)));
  },
  async load(mapId) {
    const rec = BeatmapManager.maps.get(mapId) || BeatmapManager.maps.get(SongSelect.selectedId);
    if (!rec) { this.empty(); return; }
    const { bm, notes } = await BeatmapManager.load(rec.id);
    const blob = await BeatmapManager.getFile(rec.setId, rec.osuPath);
    this.rec = rec; this.bm = bm; this.text = await blob.text(); this.keys = BeatmapParser.keyCount(bm);
    this.red = bm.timingPoints.filter(t => t.uninherited);
    if (!this.red.length) this.red = [{ time: 0, beatLength: 500, meter: 4, uninherited: true }];
    this.notes = notes.map(n => ({ t: Math.round(n.time), col: n.col, end: n.isLN ? Math.round(n.end) : null }));
    // lazer's Setup and Timing screens: the song's details and difficulty settings, and its timing points
    const md = bm.metadata || {}, df = bm.difficulty || {};
    this.meta = { Title: md.Title || '', TitleUnicode: md.TitleUnicode || md.Title || '', Artist: md.Artist || '', ArtistUnicode: md.ArtistUnicode || md.Artist || '',
      Creator: md.Creator || '', Version: md.Version || 'Normal', Source: md.Source || '', Tags: md.Tags || '' };
    this.diffSet = { hp: +(df.HPDrainRate ?? 5), od: +(df.OverallDifficulty ?? 5) };
    this.red = this.red.map(r => ({ ...r }));
    this.green = bm.timingPoints.filter(t => !t.uninherited).map(t => ({ ...t }));
    // lazer's bookmarks ([Editor] Bookmarks) and the song select preview point ([General] PreviewTime)
    const bk = /^Bookmarks[ \t]*:(.*)$/m.exec(this.text);
    this.bookmarks = bk ? bk[1].split(',').map(x => parseInt(x, 10)).filter(x => Number.isFinite(x) && x >= 0).sort((a, b) => a - b) : [];
    this.preview = Number.isFinite(bm.previewTime) && bm.previewTime >= 0 ? bm.previewTime : -1;
    this.tabName = 'compose';
    const buffer = await TrackCache.get(rec.setId, rec.audioFile);
    await Music.load(buffer, `${rec.setId}/${rec.audioFile}`, { setId: rec.setId, mapId: rec.id });
    await Music.setRate(1, false);
    this.duration = Music.duration || (this.notes.length ? this.notes[this.notes.length - 1].t + 2000 : 60000);
    // the song's waveform for the timeline (lazer shows it behind the timeline): the loudest sample in each slice
    try {
      const ch = buffer.getChannelData(0), N = 600, step = Math.max(1, Math.floor(ch.length / N)), peaks = new Float32Array(N);
      for (let i = 0; i < N; i++) { let m = 0; const a = i * step, b = Math.min(ch.length, a + step); for (let j = a; j < b; j += 16) { const v = Math.abs(ch[j]); if (v > m) m = v; } peaks[i] = m; }
      this.peaks = peaks;
    } catch { this.peaks = null; }
    if (Screens.current !== this) return;
    this.build();
  },

  // ── layout
  build() {
    const el = this.el;
    clearEl(el);
    const r = this.rec;
    this.fileBtn = h('button.ed-menu', { onclick: e => this.fileMenu(e) }, 'file');
    this.editBtn = h('button.ed-menu', { onclick: e => this.editMenu(e) }, 'edit');
    this.tabsEl = h('div.ed-tabs', ...['setup', 'compose', 'timing', 'verify'].map(t => h(`button.ed-tab${t === this.tabName ? '.on' : ''}`, { dataset: { t }, onclick: () => this.showTab(t) }, t)));
    const top = h('div.ed-top', this.fileBtn, this.editBtn, this.tabsEl,
      h('div.ed-title', h('b', `${r.artist} - ${r.title}`), h('span', ` [${r.version}]`)), this.dirtyEl = h('span.ed-dirty', { hidden: true }, 'unsaved'));
    const tool = (id, ic, label, key) => h(`button.ed-tool${this.tool === id ? '.on' : ''}`, { dataset: { tool: id }, title: `${label} (${key})`, onclick: () => this.setTool(id) }, icon(ic), h('span', label), h('kbd', key));
    this.toolsEl = h('div.ed-tools', h('div.ed-ph', 'Toolbox'), tool('select', 'target', 'Select', '1'), tool('note', 'plus', 'Note', '2'), tool('hold', 'bars', 'Hold note', '3'));
    this.divEl = h('div.ed-div');
    this.canvas = h('canvas.ed-canvas');
    this.stage = h('div.ed-stage', this.canvas);
    this.timeEl = h('div.ed-time'); this.bpmEl = h('div.ed-bpm');
    this.tl = h('canvas.ed-tl');
    this.playBtn = h('button.ed-play', { onclick: () => this.togglePlay(), title: 'Play / pause (Space)' }, icon('play'));
    const rates = [0.25, 0.5, 0.75, 1].map(k => h(`button.ed-rate${k === this.rateK ? '.on' : ''}`, { onclick: () => this.setRate(k) }, `${k * 100}%`));
    this.ratesEl = h('div.ed-rates', ...rates);
    const bottom = h('div.ed-bottom', h('div.ed-clock', this.timeEl, this.bpmEl), h('div.ed-tlwrap', this.tl), h('div.ed-ctl', this.playBtn, this.ratesEl));
    this.pageEl = h('div.ed-page', { hidden: true });
    el.append(top, this.pageEl, h('div.ed-main', h('div.ed-left', this.toolsEl), this.stage, h('div.ed-right', h('div.ed-ph', 'Beat snap'), this.divEl,
      h('div.ed-help', h('div', h('kbd', 'Right click'), ' delete'), h('div', h('kbd', 'Ctrl+Z'), ' undo'), h('div', h('kbd', 'Wheel'), ' seek'), h('div', h('kbd', 'Ctrl+Wheel'), ' zoom'), h('div', h('kbd', 'Shift+Wheel'), ' snap'), h('div', h('kbd', 'Ctrl+S'), ' save')))), bottom);
    this.paintDivisor();
    this.bindStage();
    this._key = e => this.onKey(e);
    window.addEventListener('keydown', this._key, true);
    this._ro = new ResizeObserver(() => this.size()); this._ro.observe(this.stage); this._ro.observe(this.tl);
    this.size();
    const loop = () => { this._raf = requestAnimationFrame(loop); this.draw(); };
    this._raf = requestAnimationFrame(loop);
  },
  size() {
    const k = Math.min(2, Zoom.dpr());
    for (const c of [this.canvas, this.tl]) { const w = Math.round(c.clientWidth * k), hh = Math.round(c.clientHeight * k); if (w && hh && (c.width !== w || c.height !== hh)) { c.width = w; c.height = hh; } }
    this._k = k; this._tlDirty = true;
  },
  paintDivisor() {
    clearEl(this.divEl).append(...EDIT_DIVISORS.map(d => h(`button.ed-dv${d === this.divisor ? '.on' : ''}`, { style: { '--c': snapColour(d) }, onclick: () => this.setDivisor(d) }, `1/${d}`)));
  },
  /** lazer's editor screens: Setup (details and difficulty), Compose (the notes) and Timing (BPM and offset). */
  showTab(t) {
    this.tabName = t; UISounds.click();
    for (const b of this.tabsEl.children) b.classList.toggle('on', b.dataset.t === t);
    if (t === 'compose') { this.pageEl.hidden = true; return; }
    if (Music.playing && t === 'setup') this.togglePlay();
    this.pageEl.hidden = false;
    clearEl(this.pageEl).append(t === 'setup' ? this.setupPage() : t === 'verify' ? this.verifyPage() : this.timingPage());
  },
  setupPage() {
    const field = (label, key, hint) => {
      const inp = h('input.input', { value: this.meta[key], maxlength: key === 'Tags' ? 1000 : 200, oninput: () => { this.meta[key] = inp.value.replace(/[\r\n]/g, ' '); this.setDirty(true); } });
      inp.addEventListener('keydown', e => e.stopPropagation());
      return h('label.ed-f', h('span', label), inp, hint ? h('small', hint) : null);
    };
    const slider = (label, key) => {
      const v = h('b', String(this.diffSet[key]));
      const inp = h('input.slider', { type: 'range', min: 0, max: 10, step: 0.1, value: this.diffSet[key] });
      const paint = () => inp.style.setProperty('--p', (inp.value * 10) + '%');
      inp.addEventListener('input', () => { this.diffSet[key] = +inp.value; v.textContent = (+inp.value).toFixed(1); paint(); this.setDirty(true); });
      paint();
      return h('label.ed-f', h('span', label, v), inp);
    };
    const keys = h('select.select', { onchange: () => {
      const k = +keys.value;
      if (this.notes.some(n => n.col >= k)) { Toast.err('Notes are in the columns that would go', `Move or delete the notes in columns ${k + 1}–${this.keys} first.`); keys.value = this.keys; return; }
      this.keys = k; this.setDirty(true);
    } }, ...Array.from({ length: 10 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === this.keys }, `${i + 1}K`)));
    keys.addEventListener('keydown', e => e.stopPropagation());
    return h('div.ed-form',
      h('h2', 'Beatmap setup'),
      h('div.ed-sec', h('h3', 'Metadata'),
        h('div.ed-row', field('Artist', 'Artist'), field('Artist (original language)', 'ArtistUnicode')),
        h('div.ed-row', field('Title', 'Title'), field('Title (original language)', 'TitleUnicode')),
        h('div.ed-row', field('Creator', 'Creator'), field('Difficulty name', 'Version')),
        h('div.ed-row', field('Source', 'Source'), field('Tags', 'Tags', 'separated by spaces'))),
      h('div.ed-sec', h('h3', 'Difficulty'),
        h('label.ed-f', h('span', 'Key count'), keys),
        h('div.ed-row', slider('HP drain', 'hp'), slider('Accuracy (OD)', 'od'))),
      h('div.ed-sec', h('h3', 'Difficulties'), h('p.muted', 'A new difficulty in this set, with this one\'s song, timing and details: a copy of its notes, or blank.'),
        h('button.btn.primary', { onclick: () => this.newDifficulty() }, icon('plus'), 'Create new difficulty')));
  },
  timingPage() {
    const wrap = h('div.ed-form');
    const paint = () => {
      const now = Math.round(this.now());
      const row = (r, i) => {
        const t = h('input.input.ed-num', { type: 'number', value: Math.round(r.time), step: 1 });
        const bpm = h('input.input.ed-num', { type: 'number', value: +(60000 / r.beatLength).toFixed(3), step: 0.001, min: 1 });
        const meter = h('select.select', ...[3, 4, 5, 6, 7].map(m => h('option', { value: m, selected: (r.meter || 4) === m }, `${m}/4`)));
        for (const x of [t, bpm, meter]) x.addEventListener('keydown', e => e.stopPropagation());
        t.addEventListener('change', () => { r.time = Math.round(+t.value || 0); this.red.sort((a, b) => a.time - b.time); this.setDirty(true); paint(); });
        bpm.addEventListener('change', () => { const b = +bpm.value; if (b > 0) { r.beatLength = 60000 / b; this.setDirty(true); } });
        meter.addEventListener('change', () => { r.meter = +meter.value; this.setDirty(true); });
        return h(`div.ed-tp${this.redAt(now) === r ? '.cur' : ''}`, h('span.ed-tpn', `#${i + 1}`), h('label', 'Time (ms)', t), h('label', 'BPM', bpm), h('label', 'Meter', meter),
          h('button.btn.sm', { title: 'Seek here', onclick: () => { this.seek(r.time); paint(); } }, icon('target')),
          h('button.btn.sm', { title: 'Move to the current time', onclick: () => { r.time = now; this.red.sort((a, b) => a.time - b.time); this.setDirty(true); paint(); } }, icon('clock')),
          this.red.length > 1 ? h('button.btn.sm.danger', { title: 'Delete', onclick: () => { this.red = this.red.filter(x => x !== r); this.setDirty(true); paint(); } }, icon('trash')) : null);
      };
      clearEl(wrap).append(h('h2', 'Timing'), h('p.muted', 'Red lines: where the beat starts and its tempo. Notes stay where they are when the timing changes.'),
        h('div.ed-tps', ...this.red.map(row)),
        h('button.btn.primary', { onclick: () => { const now = Math.round(this.now()), r = this.redAt(now); this.red.push({ time: now, beatLength: r.beatLength, meter: r.meter || 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 }); this.red.sort((a, b) => a.time - b.time); this.setDirty(true); paint(); } },
          icon('plus'), `Add a timing point at ${fmtTime(Math.max(0, now))}`),
        h('h3.ed-h3', 'Kiai time'),
        h('p.muted', 'The song\'s chorus: the playfield glows. It starts and stops on an effect point.'),
        h('div.ed-tps', ...this.kiaiRanges().map(([a, b]) => h('div.ed-kiai', h('span', icon('sparkle'), `${fmtTime(Math.max(0, a))} – ${fmtTime(Math.max(0, b))}`),
          h('button.btn.sm', { title: 'Seek here', onclick: () => { this.seek(a); paint(); } }, icon('target')),
          h('button.btn.sm.danger', { title: 'Remove', onclick: () => { for (const p of [...this.red, ...this.green]) if (p.time >= a - 1 && p.time < b) p.effects = (p.effects || 0) & ~1; this.setDirty(true); paint(); } }, icon('trash'))))),
        h('div.ed-row2', h('button.btn', { onclick: () => { this.toggleKiai(); paint(); } }, icon('sparkle'), `${this.kiaiAt(this.snap(now)) ? 'End' : 'Start'} kiai at ${fmtTime(Math.max(0, this.snap(now)))}`),
          h('button.btn', { onclick: () => { this.setPreview(); paint(); } }, icon('music'), this.preview >= 0 ? `Preview point: ${fmtTime(this.preview)} — set to now` : 'Set the preview point to now')));
    };
    paint();
    return wrap;
  },
  async newDifficulty() {
    const name = (await Dialog.prompt('New difficulty', '', { ok: 'Create', placeholder: 'Difficulty name' }) || '').trim();
    if (!name) return;
    const set = BeatmapManager.setById.get(this.rec.setId);
    if (set && set.maps.some(m => m.version.toLowerCase() === name.toLowerCase())) { Toast.err('That difficulty name is taken', 'Pick another name.'); return; }
    // lazer: a copy of this difficulty's notes, or a blank one (here with a single note: a difficulty needs one to be kept)
    const copy = await new Promise(res => {
      let v = null;
      Dialog.popup(`Create "${name}"`, 'Start from this difficulty\'s notes, or from scratch?', [
        { label: 'Copy this difficulty', colour: '#ff66aa', onClick: () => { v = true; } },
        { label: 'Start blank', colour: '#66ccff', onClick: () => { v = false; } },
      ], { icon: 'plus', onClose: () => res(v) });
    });
    if (copy == null) return;
    if (this.dirty && !(await this.save())) return;
    const clean = x => String(x).replace(/[\\/:*?"<>|]/g, '').trim();
    const file = `${clean(this.meta.Artist)} - ${clean(this.meta.Title)} (${clean(this.meta.Creator)}) [${clean(name)}].osu`;
    const text = this.serialize({ Version: name, notes: copy ? this.notes : [{ t: Math.round(this.red[0].time + this.red[0].beatLength * 4), col: 0, end: null }] });
    try {
      const rec = await BeatmapManager.saveDifficulty({ id: '__new', setId: this.rec.setId, osuPath: file }, text);
      if (!rec) throw new Error('The new difficulty couldn\'t be read back.');
      Toast.ok(`Created ${name}`, copy ? 'A copy of the difficulty you were editing.' : 'A blank difficulty with one note to start from.');
      this.reopen(rec.id);
    } catch (e) { Toast.err('Couldn\'t create the difficulty', friendlyError(e)); }
  },
  // ── bookmarks, preview point, kiai (lazer: Ctrl+B / Ctrl+Shift+B, Ctrl+Alt+←/→; Edit › Set preview point; effect points)
  toggleBookmark(remove) {
    const t = this.snap(this.now());
    if (remove) {
      if (!this.bookmarks.length) return;
      // (lazer: removes the closest one)
      let best = this.bookmarks[0]; for (const b of this.bookmarks) if (Math.abs(b - t) < Math.abs(best - t)) best = b;
      this.bookmarks = this.bookmarks.filter(b => b !== best);
      Toast.show('Bookmark removed', fmtTime(best));
    } else {
      if (this.bookmarks.some(b => Math.abs(b - t) < 2)) return;
      this.bookmarks = [...this.bookmarks, t].sort((a, b) => a - b);
      Toast.show('Bookmark added', fmtTime(Math.max(0, t)));
    }
    this.setDirty(true);
  },
  jumpBookmark(dir) {
    const now = this.now(), list = dir > 0 ? this.bookmarks.filter(b => b > now + 1) : this.bookmarks.filter(b => b < now - 1);
    if (list.length) this.seek(dir > 0 ? list[0] : list[list.length - 1]);
  },
  setPreview() {
    this.preview = Math.max(0, Math.round(this.now()));
    this.setDirty(true);
    Toast.show('Preview point set', `Song select plays the song from ${fmtTime(this.preview)}.`);
  },
  /** Every timing point (red and green) in order: the last one at or before a time decides its effects. */
  points() { return [...this.red.map(r => ({ p: r, u: 1 })), ...this.green.map(g => ({ p: g, u: 0 }))].sort((a, b) => a.p.time - b.p.time || b.u - a.u); },
  kiaiAt(t) { let on = false; for (const { p } of this.points()) { if (p.time <= t + 1) on = !!((p.effects || 0) & 1); else break; } return on; },
  /** The kiai sections: [start, end] pairs (the end is the song's end when it doesn't stop). */
  kiaiRanges() {
    const out = []; let from = null;
    for (const { p } of this.points()) {
      const on = !!((p.effects || 0) & 1);
      if (on && from == null) from = p.time; else if (!on && from != null) { if (p.time > from) out.push([from, p.time]); from = null; }
    }
    if (from != null) out.push([from, this.duration]);
    return out;
  },
  /** Kiai starts (or stops) here: an effect point at the snapped time — an existing point there changes, or a green
   *  line is added (keeping the scroll speed it's in). */
  toggleKiai(t = this.snap(this.now())) {
    t = Math.max(0, Math.round(t));
    const on = !this.kiaiAt(t), at = [...this.red, ...this.green].filter(p => Math.abs(p.time - t) < 1);
    if (at.length) for (const p of at) p.effects = on ? ((p.effects || 0) | 1) : ((p.effects || 0) & ~1);
    else {
      const r = this.redAt(t), g = this.green.filter(x => x.time <= t && x.time >= r.time).pop(), base = g || r;
      this.green.push({ time: t, beatLength: g ? g.beatLength : -100, meter: r.meter || 4, sampleSet: base.sampleSet ?? 1, sampleIndex: base.sampleIndex ?? 0, volume: base.volume ?? 100, uninherited: false, effects: ((base.effects || 0) & ~1) | (on ? 1 : 0) });
      this.green.sort((a, b) => a.time - b.time);
    }
    this.setDirty(true);
    Toast.show(on ? 'Kiai starts here' : 'Kiai ends here', fmtTime(t));
  },

  /** lazer's Verify screen: the checks the beatmap must pass to be ranked (the ones that apply to mania), each a
   *  problem, a warning or negligible; clicking one goes to it. */
  issues() {
    const out = [], P = (sev, cat, text, t = null, notes = null) => out.push({ sev, cat, text, t, notes });
    const N = this.notes;
    if (!N.length) P('problem', 'Compose', 'There are no notes.');
    // concurrent / overlapping notes in a column, zero-length and too short hold notes
    const cols = Array.from({ length: this.keys }, () => []);
    for (const n of N) if (cols[n.col]) cols[n.col].push(n);
    for (const c of cols) for (let i = 1; i < c.length; i++) {
      const a = c[i - 1], b = c[i];
      if (b.t <= (a.end ?? a.t)) P('problem', 'Compose', `${a.end != null ? 'A note is inside a hold note' : 'Two notes at the same time'} in column ${b.col + 1}.`, b.t, [a, b]);
    }
    for (const n of N) if (n.end != null && n.end - n.t <= 0) P('problem', 'Compose', 'A hold note has no length.', n.t, [n]);
    // unsnapped (lazer's CheckUnsnappedObjects: off every 1/16 and 1/12 tick by 2ms or more is a problem, 1ms negligible)
    const off = t => { const r = this.redAt(t); let m = Infinity; for (const d of [16, 12]) { const b = r.beatLength / d; if (b > 0) m = Math.min(m, Math.abs(t - (r.time + Math.round((t - r.time) / b) * b))); } return m; };
    for (const n of N) for (const [t, what] of [[n.t, 'A note'], ...(n.end != null ? [[n.end, 'A hold note\'s end']] : [])]) {
      const o = off(t);
      if (o >= 2) P('problem', 'Timing', `${what} is unsnapped by ${Math.round(o)}ms.`, t, [n]);
      else if (o >= 1) P('negligible', 'Timing', `${what} is unsnapped by ${Math.round(o)}ms.`, t, [n]);
    }
    if (N.length && N[0].t < this.red[0].time) P('problem', 'Timing', 'A note is before the first timing point.', N[0].t, [N[0]]);
    const late = N.filter(n => (n.end ?? n.t) > this.duration + 1);
    if (late.length) P('problem', 'Compose', `${plural(late.length, 'note is', 'notes are')} after the song ends.`, late[0].t, late);
    // drain time (lazer's CheckDrainLength: under 30 seconds)
    if (N.length) { const len = Math.max(...N.map(n => n.end ?? n.t)) - N[0].t; if (len < 30000) P('problem', 'Compose', `The drain time is only ${fmtTime(len)} — a beatmap needs at least 30 seconds.`); }
    // audio and resources
    if (!this.rec.bgFile) P('problem', 'Resources', 'There is no background image.');
    if (this.preview < 0) P('warning', 'Audio', 'There is no preview point (song select would play the song from the middle).');
    // metadata (lazer's CheckMetadata…: empty fields, and unicode in the romanised ones)
    if (!this.meta.Title.trim()) P('problem', 'Metadata', 'The title is empty.');
    if (!this.meta.Artist.trim()) P('problem', 'Metadata', 'The artist is empty.');
    if (!this.meta.Creator.trim()) P('warning', 'Metadata', 'The creator is empty.');
    for (const k of ['Title', 'Artist']) if (/[^\x20-\x7e]/.test(this.meta[k])) P('problem', 'Metadata', `The romanised ${k.toLowerCase()} has non-romanised characters (they go in the original language field).`);
    if (!this.meta.Tags.trim()) P('negligible', 'Metadata', 'There are no tags (they help people find the beatmap).');
    const rank = { problem: 0, warning: 1, negligible: 2 };
    return out.sort((a, b) => rank[a.sev] - rank[b.sev] || (a.t ?? -1) - (b.t ?? -1));
  },
  verifyPage() {
    const wrap = h('div.ed-form.ed-verify');
    this.vShow = this.vShow || { problem: true, warning: true, negligible: false };
    const NAMES = { problem: 'Problem', warning: 'Warning', negligible: 'Negligible' };
    const paint = () => {
      const all = this.issues(), list = all.filter(i => this.vShow[i.sev]);
      const counts = { problem: 0, warning: 0, negligible: 0 }; for (const i of all) counts[i.sev]++;
      const row = i => h(`button.ed-issue.${i.sev}`, { disabled: i.t == null, onclick: () => {
        UISounds.click(); this.sel = new Set(i.notes || []); this.seek(i.t); this.showTab('compose');
      } }, h('span.ed-isev', NAMES[i.sev]), h('span.ed-itime', i.t == null ? '' : fmtTime(Math.max(0, i.t))), h('span.ed-imsg', i.text), h('span.ed-icat', i.cat));
      clearEl(wrap).append(h('h2', 'Verify'),
        h('div.ed-vfilters', ...Object.keys(NAMES).map(k => h(`button.ed-vf.${k}${this.vShow[k] ? '.on' : ''}`, { onclick: () => { this.vShow[k] = !this.vShow[k]; UISounds.click(); paint(); } }, NAMES[k], h('b', String(counts[k]))))),
        list.length ? h('div.ed-issues', h('div.ed-issue.head', h('span', 'Type'), h('span', 'Time'), h('span', 'Message'), h('span', 'Category')), ...list.slice(0, 300).map(row))
          : h('div.ed-noissue', icon('check'), all.length ? 'Nothing to show with these filters.' : 'No issues found — this beatmap is ready to be played.'));
    };
    paint();
    return wrap;
  },
  setDivisor(d) { this.divisor = d; Settings.set('editor.divisor', d); this.paintDivisor(); },
  setTool(t) { this.tool = t; for (const b of this.toolsEl.querySelectorAll('.ed-tool')) b.classList.toggle('on', b.dataset.tool === t); UISounds.click(); },
  async setRate(k) {
    const was = Music.playing, at = this.now();
    if (was) Music.pause();
    this.rateK = k; await Music.setRate(k, false);
    for (const b of this.ratesEl.children) b.classList.toggle('on', b.textContent === `${k * 100}%`);
    this.pos = at; if (was) Music.play(at);
  },

  // ── time
  now() { return Music.playing ? Music.time : this.pos; },
  redAt(t) { let r = this.red[0]; for (const x of this.red) { if (x.time <= t + 1) r = x; else break; } return r; },
  snap(t) { const r = this.redAt(t), b = r.beatLength / this.divisor; return Math.round(r.time + Math.round((t - r.time) / b) * b); },
  step(dir) {
    const t = this.now(), r = this.redAt(t), b = r.beatLength / this.divisor;
    const s = this.snap(t);
    let n = Math.abs(s - t) > 2 && Math.sign(s - t) === dir ? s : Math.round(s + dir * b);
    this.seek(n);
  },
  seek(t) {
    t = clamp(t, Math.min(0, this.red[0].time), this.duration);
    if (Music.playing) Music.play(t); else this.pos = t;
  },
  togglePlay() {
    if (Music.playing) { this.pos = Music.time; Music.pause(); }
    else { if (this.pos >= this.duration - 50) this.pos = 0; Music.play(this.pos); }
    clearEl(this.playBtn).append(icon(Music.playing ? 'pause' : 'play'));
  },

  // ── geometry
  geo() {
    const c = this.canvas, k = this._k || 1, W = c.width / k, H = c.height / k;
    const cw = Math.min(64, Math.max(28, (W * 0.5) / this.keys)), x0 = Math.round(W / 2 - cw * this.keys / 2), hitY = Math.round(H * 0.82);
    return { W, H, cw, x0, hitY, px: this.zoom };
  },
  yOf(t, g, now) { return g.hitY - (t - now) * g.px; },
  tOf(y, g, now) { return now + (g.hitY - y) / g.px; },
  at(ev) {
    const r = this.canvas.getBoundingClientRect(), g = this.geo(), x = (ev.clientX - r.left) * (g.W / r.width), y = (ev.clientY - r.top) * (g.H / r.height);
    const col = Math.floor((x - g.x0) / g.cw), t = this.tOf(y, g, this.now());
    return { col, t, x, y, inside: col >= 0 && col < this.keys };
  },
  noteAt(a) {
    const g = this.geo(), now = this.now(), tol = 9 / g.px;
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      if (n.col !== a.col) continue;
      if (n.end != null ? a.t >= n.t - tol && a.t <= n.end + tol : Math.abs(a.t - n.t) <= tol) return n;
    }
    return null;
  },

  // ── editing
  commit() {
    this.undo.push(JSON.stringify(this.notes)); if (this.undo.length > 200) this.undo.shift();
    this.redo = []; this.setDirty(true);
  },
  setDirty(v) { this.dirty = v; if (this.dirtyEl) this.dirtyEl.hidden = !v; this._tlDirty = true; },
  sortNotes() { this.notes.sort((a, b) => a.t - b.t || a.col - b.col); },
  clash(col, t, end, except) { return this.notes.some(n => n !== except && !(except instanceof Set && except.has(n)) && n.col === col && !((end ?? t) < n.t || t > (n.end ?? n.t))); },
  add(col, t, end = null) {
    if (col < 0 || col >= this.keys || this.clash(col, t, end)) return null;
    this.commit();
    const n = { t, col, end }; this.notes.push(n); this.sortNotes();
    UISounds.play('check-on');
    return n;
  },
  remove(list) {
    if (!list.length) return;
    this.commit();
    const s = new Set(list);
    this.notes = this.notes.filter(n => !s.has(n)); for (const n of list) this.sel.delete(n);
    UISounds.play('check-off');
  },
  undoStep(back) {
    const from = back ? this.undo : this.redo, to = back ? this.redo : this.undo;
    if (!from.length) return;
    to.push(JSON.stringify(this.notes));
    this.notes = JSON.parse(from.pop()); this.sel.clear(); this.setDirty(true);
  },
  bindStage() {
    const c = this.canvas;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointermove', e => { if (!this._drag) this.hover = this.at(e); else this.dragMove(e); });
    c.addEventListener('pointerleave', () => { this.hover = null; });
    c.addEventListener('pointerdown', e => {
      const a = this.at(e);
      if (e.button === 2) { const n = this.noteAt(a); if (n) this.remove(this.sel.has(n) ? [...this.sel] : [n]); return; }
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      const hit = a.inside ? this.noteAt(a) : null;
      if (this.tool === 'select' || hit) {
        if (hit) {
          if (e.shiftKey || e.ctrlKey) { this.sel.has(hit) ? this.sel.delete(hit) : this.sel.add(hit); }
          else if (!this.sel.has(hit)) { this.sel.clear(); this.sel.add(hit); }
          // dragging the selection: by whole snaps and columns
          this._drag = { kind: 'move', from: a, base: [...this.sel].map(n => ({ n, t: n.t, col: n.col, end: n.end })), moved: false };
        } else { if (!e.shiftKey) this.sel.clear(); this._drag = { kind: 'box', from: a, to: a }; }
        return;
      }
      if (!a.inside) return;
      const t = this.snap(a.t);
      if (this.tool === 'note') { this.add(a.col, t); return; }
      if (this.tool === 'hold') this._drag = { kind: 'hold', col: a.col, t, end: t };
    });
    c.addEventListener('pointerup', () => this.dragEnd());
    c.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey) { this.zoom = clamp(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.1, 2.5); return; }
      if (e.shiftKey) { const i = EDIT_DIVISORS.indexOf(this.divisor); this.setDivisor(EDIT_DIVISORS[clamp(i + (e.deltaY > 0 ? -1 : 1), 0, EDIT_DIVISORS.length - 1)]); return; }
      this.step(e.deltaY > 0 ? -1 : 1);
    }, { passive: false });
    // the timeline: click or drag to seek
    const seekTl = e => { const r = this.tl.getBoundingClientRect(); this.seek(clamp((e.clientX - r.left) / r.width, 0, 1) * this.duration); };
    this.tl.addEventListener('pointerdown', e => { this.tl.setPointerCapture(e.pointerId); seekTl(e); this._tlDrag = true; });
    this.tl.addEventListener('pointermove', e => { if (this._tlDrag) seekTl(e); });
    this.tl.addEventListener('pointerup', () => { this._tlDrag = false; });
  },
  dragMove(e) {
    const d = this._drag, a = this.at(e);
    if (d.kind === 'hold') { d.end = Math.max(d.t, this.snap(a.t)); return; }
    if (d.kind === 'box') { d.to = a; return; }
    if (d.kind === 'move') {
      const dt = this.snap(d.from.t + (a.t - d.from.t)) - this.snap(d.from.t), dc = a.col - d.from.col;
      const ok = d.base.every(b => b.col + dc >= 0 && b.col + dc < this.keys);
      if (!ok || (!dt && !dc)) return;
      const moved = new Set(d.base.map(b => b.n));
      if (d.base.some(b => this.clash(b.col + dc, b.t + dt, b.end != null ? b.end + dt : null, moved))) return;
      if (!d.moved) { this.commit(); d.moved = true; }
      for (const b of d.base) { b.n.t = b.t + dt; b.n.col = b.col + dc; b.n.end = b.end != null ? b.end + dt : null; }
      this.sortNotes(); this.setDirty(true);
    }
  },
  dragEnd() {
    const d = this._drag; this._drag = null;
    if (!d) return;
    if (d.kind === 'hold') {
      if (d.end - d.t >= 10) this.add(d.col, d.t, d.end); else this.add(d.col, d.t);
    } else if (d.kind === 'box') {
      const t0 = Math.min(d.from.t, d.to.t), t1 = Math.max(d.from.t, d.to.t), c0 = Math.min(d.from.col, d.to.col), c1 = Math.max(d.from.col, d.to.col);
      if (Math.abs(d.from.y - d.to.y) > 4 || Math.abs(d.from.x - d.to.x) > 4) for (const n of this.notes) if (n.col >= c0 && n.col <= c1 && (n.end ?? n.t) >= t0 && n.t <= t1) this.sel.add(n);
    }
  },

  // ── drawing
  draw() {
    const c = this.canvas;
    if (!c || !c.width) return;
    const k = this._k || 1, ctx = this._ctx || (this._ctx = c.getContext('2d'));
    const g = this.geo(), now = this.now(), { W, H, cw, x0, hitY } = g;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = '#16151b'; ctx.fillRect(0, 0, W, H);
    const tTop = this.tOf(0, g, now), tBot = this.tOf(H, g, now);
    // the stage
    ctx.fillStyle = '#0b0b0f'; ctx.fillRect(x0, 0, cw * this.keys, H);
    ctx.fillStyle = 'rgba(255,255,255,.06)'; for (let i = 1; i < this.keys; i++) ctx.fillRect(x0 + i * cw, 0, 1, H);
    // beat snap lines (lazer's colours: 1/1 white, 1/2 red, 1/3 purple, 1/4 blue, 1/6 & 1/8 yellow, finer grey)
    for (let ri = 0; ri < this.red.length; ri++) {
      const r = this.red[ri], next = this.red[ri + 1] ? this.red[ri + 1].time : Infinity, b = r.beatLength / this.divisor, meter = r.meter > 0 ? r.meter : 4;
      if (!(b > 1)) continue;
      const from = Math.max(r.time, tBot), to = Math.min(next, tTop);
      if (from > to) continue;
      let i = Math.ceil((from - r.time) / b - 1e-6);
      for (let t = r.time + i * b; t <= to && t < next; i++, t = r.time + i * b) {
        let d = 1; for (const x of EDIT_DIVISORS) if (x <= this.divisor && Math.abs((i * x / this.divisor) - Math.round(i * x / this.divisor)) < 1e-6) { d = x; break; }
        const bar = i % (this.divisor * meter) === 0;
        ctx.globalAlpha = d === 1 ? (bar ? 0.9 : 0.55) : 0.35;
        ctx.fillStyle = snapColour(d);
        ctx.fillRect(x0, Math.round(this.yOf(t, g, now)) - (bar ? 1 : 0), cw * this.keys, bar ? 3 : d === 1 ? 2 : 1);
      }
    }
    ctx.globalAlpha = 1;
    // notes
    const noteH = 14, pad = 3;
    for (const n of this.notes) {
      const end = n.end ?? n.t;
      if (end < tBot - 50 || n.t > tTop + 50) continue;
      const x = x0 + n.col * cw + pad, w = cw - pad * 2, y = this.yOf(n.t, g, now), sel = this.sel.has(n);
      if (n.end != null) {
        const ye = this.yOf(n.end, g, now);
        ctx.fillStyle = sel ? 'rgba(255, 204, 34, .55)' : 'rgba(150, 70, 255, .55)';
        ctx.fillRect(x + w * 0.15, ye, w * 0.7, y - ye);
        ctx.fillStyle = sel ? '#ffcc22' : '#7d3cff'; this.rr(ctx, x, ye - noteH / 2, w, noteH, 4); ctx.fill();
      }
      ctx.fillStyle = sel ? '#ffcc22' : '#9a4dff';
      this.rr(ctx, x, y - noteH / 2, w, noteH, 4); ctx.fill();
      if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    // what the tool would place
    const hv = this.hover, d = this._drag;
    if (d && d.kind === 'hold') {
      const x = x0 + d.col * cw + pad, w = cw - pad * 2, y = this.yOf(d.t, g, now), ye = this.yOf(d.end, g, now);
      ctx.globalAlpha = 0.6; ctx.fillStyle = '#9a4dff'; ctx.fillRect(x + w * 0.15, ye, w * 0.7, y - ye); this.rr(ctx, x, y - noteH / 2, w, noteH, 4); ctx.fill(); this.rr(ctx, x, ye - noteH / 2, w, noteH, 4); ctx.fill(); ctx.globalAlpha = 1;
    } else if (hv && hv.inside && this.tool !== 'select' && !d) {
      const t = this.snap(hv.t), x = x0 + hv.col * cw + pad, w = cw - pad * 2;
      ctx.globalAlpha = 0.4; ctx.fillStyle = '#c9a6ff'; this.rr(ctx, x, this.yOf(t, g, now) - noteH / 2, w, noteH, 4); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (d && d.kind === 'box') {
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
      const y0 = this.yOf(d.from.t, g, now), y1 = this.yOf(d.to.t, g, now);
      ctx.fillRect(Math.min(d.from.x, d.to.x), Math.min(y0, y1), Math.abs(d.to.x - d.from.x), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(d.from.x, d.to.x), Math.min(y0, y1), Math.abs(d.to.x - d.from.x), Math.abs(y1 - y0));
    }
    // the hit line
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x0 - 6, hitY - 1, cw * this.keys + 12, 2);
    // clock and BPM
    const tt = Math.max(0, now), mm = Math.floor(tt / 60000), ss = Math.floor(tt / 1000) % 60, ms = Math.floor(tt) % 1000;
    const ts = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ms).padStart(3, '0')}`;
    if (this.timeEl.textContent !== ts) this.timeEl.textContent = ts;
    const bpm = `${Math.round(60000 / this.redAt(now).beatLength)} BPM`;
    if (this.bpmEl.textContent !== bpm) this.bpmEl.textContent = bpm;
    if (Music.playing && now >= this.duration) { this.pos = this.duration; Music.pause(); clearEl(this.playBtn).append(icon('play')); }
    this.drawTimeline(now);
  },
  rr(ctx, x, y, w, hh, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, hh, r) : ctx.rect(x, y, w, hh); },
  /** lazer's summary timeline: where the notes are across the song, and where you are. */
  drawTimeline(now) {
    const c = this.tl, k = this._k || 1;
    if (!c.width) return;
    const ctx = this._tlCtx || (this._tlCtx = c.getContext('2d')), W = c.width / k, H = c.height / k;
    if (this._tlDirty || !this._tlImg) {
      this._tlDirty = false;
      const off = this._tlImg || (this._tlImg = document.createElement('canvas'));
      off.width = c.width; off.height = c.height;
      const o = off.getContext('2d'); o.setTransform(k, 0, 0, k, 0, 0);
      o.fillStyle = 'rgba(255,255,255,.06)'; o.fillRect(0, H / 2 - 1, W, 2);
      if (this.peaks) {
        // (the waveform spans the buffer; the timeline spans the song — the same length)
        o.fillStyle = 'rgba(102, 204, 255, .22)';
        const P = this.peaks, n = P.length;
        for (let i = 0; i < n; i++) { const x = i / n * W, hh = Math.max(1, P[i] * (H - 4)); o.fillRect(x, H / 2 - hh / 2, Math.max(1, W / n), hh); }
      }
      const N = Math.max(1, Math.floor(W / 3)), bins = new Array(N).fill(0);
      for (const n of this.notes) bins[clamp(Math.floor(n.t / this.duration * N), 0, N - 1)]++;
      const max = Math.max(1, ...bins);
      o.fillStyle = 'rgba(154, 77, 255, .8)';
      bins.forEach((v, i) => { if (v) { const hh = Math.max(2, v / max * (H - 8)); o.fillRect(i * 3, H / 2 - hh / 2, 2, hh); } });
      for (const r of this.red) { o.fillStyle = '#ed1121'; o.fillRect(r.time / this.duration * W, 0, 1.5, 6); }
      // (lazer's summary timeline parts: kiai sections, bookmarks and the preview point)
      o.fillStyle = 'rgba(255, 153, 34, .75)';
      for (const [a, b] of this.kiaiRanges()) o.fillRect(a / this.duration * W, H - 3, Math.max(1.5, (b - a) / this.duration * W), 3);
      o.fillStyle = '#4080ff';
      for (const b of this.bookmarks) o.fillRect(b / this.duration * W, H - 10, 1.5, 7);
      if (this.preview >= 0) { o.fillStyle = '#88b300'; o.fillRect(this.preview / this.duration * W - 0.75, 0, 1.5, H); }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(this._tlImg, 0, 0);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const x = clamp(now / this.duration, 0, 1) * W;
    ctx.fillStyle = '#ffcc22'; ctx.fillRect(x - 1, 0, 2, H);
  },

  // ── keys
  onKey(e) {
    if (Screens.current !== this || Overlays.top()) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const ctrl = e.ctrlKey || e.metaKey, stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.code === 'Space') { stop(); this.togglePlay(); return; }
    if (ctrl && e.code === 'KeyS') { stop(); this.save(); return; }
    if (ctrl && e.code === 'KeyZ') { stop(); this.undoStep(!e.shiftKey); return; }
    if (ctrl && e.code === 'KeyY') { stop(); this.undoStep(false); return; }
    if (ctrl && e.code === 'KeyB') { stop(); this.toggleBookmark(e.shiftKey); return; }
    if (ctrl && e.altKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { stop(); this.jumpBookmark(e.code === 'ArrowRight' ? 1 : -1); return; }
    if (ctrl && e.code === 'KeyA') { stop(); this.notes.forEach(n => this.sel.add(n)); return; }
    // lazer: copy, cut and paste (at the current time, snapped)
    if (ctrl && (e.code === 'KeyC' || e.code === 'KeyX')) {
      stop();
      const list = [...this.sel]; if (!list.length) return;
      const t0 = Math.min(...list.map(n => n.t));
      this.clip = list.map(n => ({ dt: n.t - t0, col: n.col, len: n.end != null ? n.end - n.t : null }));
      if (e.code === 'KeyX') this.remove(list); else Toast.show(`Copied ${plural(list.length, 'note', 'notes')}`);
      return;
    }
    if (ctrl && e.code === 'KeyV') {
      stop();
      if (!this.clip || !this.clip.length) return;
      const at = this.snap(this.now()), made = [];
      this.commit();
      for (const c of this.clip) { const t = at + c.dt, end = c.len != null ? t + c.len : null; if (c.col < this.keys && !this.clash(c.col, t, end)) { const n = { t, col: c.col, end }; this.notes.push(n); made.push(n); } }
      this.sortNotes(); this.sel = new Set(made);
      return;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') { stop(); this.remove([...this.sel]); return; }
    if (e.code === 'Digit1') { stop(); this.setTool('select'); return; }
    if (e.code === 'Digit2') { stop(); this.setTool('note'); return; }
    if (e.code === 'Digit3') { stop(); this.setTool('hold'); return; }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { stop(); this.step(e.code === 'ArrowUp' ? 1 : -1); return; }
    if (e.code === 'Home') { stop(); this.seek(0); return; }
    if (e.code === 'End') { stop(); this.seek(this.notes.length ? this.notes[this.notes.length - 1].t : this.duration); return; }
    if (e.code === 'F5' || (ctrl && e.code === 'Enter')) { stop(); this.test(); return; }
    if (e.code === 'Escape') { stop(); this.exit(); }
  },
  onBack() { this.exit(); return true; },

  // ── file
  fileMenu() {
    const r = this.fileBtn.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { label: 'Save (Ctrl+S)', icon: 'save', onClick: () => this.save() },
      { label: 'Test (F5)', icon: 'play', onClick: () => this.test() },
      { label: 'New beatmap from a song…', icon: 'music', onClick: () => this.newBeatmap() },
      { sep: true },
      { label: 'Exit', icon: 'back', onClick: () => this.exit() },
    ]);
  },
  /** lazer's Edit menu. */
  editMenu() {
    const r = this.editBtn.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { label: 'Undo (Ctrl+Z)', icon: 'back', onClick: () => this.undoStep(true) },
      { label: 'Redo (Ctrl+Y)', icon: 'retry', onClick: () => this.undoStep(false) },
      { sep: true },
      { label: 'Set preview point to current time', icon: 'music', onClick: () => this.setPreview() },
      { label: 'Add bookmark (Ctrl+B)', icon: 'flag', onClick: () => this.toggleBookmark(false) },
      { label: 'Remove closest bookmark (Ctrl+Shift+B)', icon: 'trash', onClick: () => this.toggleBookmark(true) },
      { label: this.kiaiAt(this.snap(this.now())) ? 'End kiai here' : 'Start kiai here', icon: 'sparkle', onClick: () => this.toggleKiai() },
    ]);
  },
  /** The difficulty as an .osu file: the original, with its [Metadata], [Difficulty], [TimingPoints] and
   *  [HitObjects] written from the editor (`over`: a new difficulty's name and notes). */
  serialize(over = {}) {
    const notes = over.notes || this.notes, meta = { ...this.meta, ...(over.Version ? { Version: over.Version } : {}) };
    const hit = notes.map(n => {
      const x = Math.floor((n.col + 0.5) * 512 / this.keys);
      return n.end != null ? `${x},192,${n.t},128,0,${n.end}:0:0:0:0:` : `${x},192,${n.t},1,0,0:0:0:0:`;
    });
    const tp = [...this.red.map(r => ({ ...r, u: 1 })), ...this.green.map(g => ({ ...g, u: 0 }))].sort((a, b) => a.time - b.time || b.u - a.u)
      .map(p => `${Math.round(p.time)},${p.beatLength},${p.meter || 4},${p.sampleSet ?? 1},${p.sampleIndex ?? 0},${p.volume ?? 100},${p.u},${p.effects || 0}`);
    let text = this.text.replace(/\r\n/g, '\n');
    text = EditorScreen.setKeys(text, 'Metadata', meta);
    text = EditorScreen.setKeys(text, 'Difficulty', { HPDrainRate: +this.diffSet.hp.toFixed(1), OverallDifficulty: +this.diffSet.od.toFixed(1), CircleSize: this.keys });
    text = EditorScreen.setKeys(text, 'General', { PreviewTime: Math.round(this.preview) });
    if (this.bookmarks.length || /^\[Editor\]/m.test(text)) {
      // (osu! keeps [Editor] between [General] and [Metadata])
      if (!/^\[Editor\]/m.test(text)) text = /^\[Metadata\]/m.test(text) ? text.replace(/^\[Metadata\]/m, '[Editor]\n\n[Metadata]') : text;
      text = EditorScreen.setKeys(text, 'Editor', { Bookmarks: this.bookmarks.map(Math.round).join(',') });
    }
    text = EditorScreen.setSection(text, 'TimingPoints', tp);
    text = EditorScreen.setSection(text, 'HitObjects', hit);
    return text.replace(/\n{3,}/g, '\n\n');
  },
  /** An .osu section's lines replaced (added at the end when there isn't one). */
  setSection(text, name, lines) {
    const re = new RegExp(`^\\[${name}\\][ \\t]*$`, 'm'), m = re.exec(text);
    if (!m) return `${text.trimEnd()}\n\n[${name}]\n${lines.join('\n')}\n`;
    const start = m.index + m[0].length, rest = text.slice(start), next = rest.search(/^\[/m);
    const end = next < 0 ? text.length : start + next;
    return `${text.slice(0, m.index)}[${name}]\n${lines.join('\n')}\n${next < 0 ? '' : '\n'}${text.slice(end)}`;
  },
  /** key:value lines in an .osu section set (each replaced where it is, or added). */
  setKeys(text, name, obj) {
    const re = new RegExp(`^\\[${name}\\][ \\t]*$`, 'm'), m = re.exec(text);
    if (!m) return EditorScreen.setSection(text, name, Object.entries(obj).map(([k, v]) => `${k}:${v}`));
    const start = m.index + m[0].length, rest = text.slice(start), next = rest.search(/^\[/m);
    let body = next < 0 ? rest : rest.slice(0, next);
    for (const [k, v] of Object.entries(obj)) {
      const kr = new RegExp(`^${k}[ \\t]*:.*$`, 'm');
      if (kr.test(body)) body = body.replace(kr, `${k}:${v}`); else body = body.replace(/\s*$/, `\n${k}:${v}\n`);
    }
    return text.slice(0, start) + body.replace(/\s*$/, '\n\n') + (next < 0 ? '' : rest.slice(next));
  },
  async save() {
    if (this._saving) return false;
    this._saving = true;
    try {
      const text = this.serialize();
      const rec = await BeatmapManager.saveDifficulty(this.rec, text);
      if (!rec) throw new Error('The saved difficulty couldn\'t be read back.');
      this.rec = rec; this.text = text; this.setDirty(false);
      Settings.set('last.map', rec.id); SongSelect.selectedId = rec.id;
      Toast.ok('Beatmap saved', `${rec.version}: ${plural(this.notes.length, 'note', 'notes')}`);
      return true;
    } catch (e) { Toast.err('Couldn\'t save', friendlyError(e)); return false; } finally { this._saving = false; }
  },
  async test() {
    if (this.dirty && !(await this.save())) return;
    if (Music.playing) Music.pause();
    UISounds.click();
    Game.launch({ mapId: this.rec.id, mode: 'play', mods: [], editor: { mapId: this.rec.id, pos: this.now() } });
  },
  async exit() {
    if (this.dirty) {
      const choice = await new Promise(res => {
        let v = 'cancel';
        Dialog.popup('Save your changes?', 'You have changes that haven\'t been saved.', [
          { label: 'Save and exit', colour: '#ff66aa', onClick: () => { v = 'save'; } },
          { label: 'Exit without saving', colour: '#cc3333', cls: 'ok.danger', onClick: () => { v = 'discard'; } },
          { label: 'Keep editing', colour: '#66ccff', cls: 'cancel', cancel: true },
        ], { icon: 'save', onClose: () => res(v) });
      });
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await this.save())) return;
    }
    Screens.go('songselect', { mapId: this.rec.id }, { replace: true });
  },
};
