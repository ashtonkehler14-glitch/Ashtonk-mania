/* osu!lazer's skin editor (Ctrl+Shift+S, or Settings → Skin → Skin layout editor), for the gameplay HUD: the game
 * shrinks into the middle of the screen with Auto playing (the song loops), the HUD's components get boxes — drag
 * one to move it, its corner handle to scale it — the Components list on the left shows and hides them, and the
 * Settings on the right set the chosen one's scale and position. The layout is kept (`hud.layout`: each component's
 * offset as a fraction of the screen, its scale, and whether it's hidden) and every play uses it. */

const HUD_PARTS = [
  // (score, accuracy, pp and mods are placed and sized each on its own, as lazer's separate HUD components)
  { id: 'sc', name: 'Score', icon: 'trophy', sel: '.hud-score > .sc', origin: 'top right' },
  { id: 'acc', name: 'Accuracy', icon: 'target', sel: '.hud-score > .hud-accrow', origin: 'top right' },
  { id: 'pp', name: 'Performance (pp)', icon: 'chart', sel: '.hud-score > .hud-pp', origin: 'top right' },
  { id: 'mods', name: 'Mods', icon: 'mods', sel: '.hud-score > .hud-mods', origin: 'top right' },
  // (drawn with the stage, on the canvas, at the skin's ComboPosition: moved and sized from there)
  { id: 'combo', name: 'Combo counter', icon: 'bolt', canvas: true, origin: 'center center' },
  { id: 'hp', name: 'Health display', icon: 'heart', sel: '.hud-hp, .hud-skinhp', origin: 'top left' },
  { id: 'progress', name: 'Song progress', icon: 'clock', sel: '.hud-sp, .hud-progress', origin: 'bottom center' },
  { id: 'error', name: 'Hit error meter', icon: 'bars', sel: '.hud-err', origin: 'bottom center', setting: 'gameplay.hitErrorMeter' },
  { id: 'jc', name: 'Judgement counter', icon: 'list', sel: '.hud-jc', origin: 'center right', setting: 'gameplay.judgementCounter' },
  { id: 'lb', name: 'Leaderboard', icon: 'crown', sel: '.hud-lb, .hud-mp', origin: 'center left', setting: 'gameplay.leaderboard' },
  { id: 'badge', name: 'Auto / replay badge', icon: 'film', sel: '.hud-replay', origin: 'top center' },
];

const HudLayout = {
  override: null,
  get() {
    if (this.override) return this.override;
    let v = Settings.get('hud.layout');
    if (!v || typeof v !== 'object') return {};
    // (a layout from when score, accuracy, pp and mods moved as one block: each of the four takes its place)
    if (v.score) { const c = v.score; v = { sc: c, acc: c, pp: c, mods: c, ...v }; delete v.score; Settings.set('hud.layout', v); }
    return v;
  },
  /** One part's elements on the HUD (not one inside another that's already in the list). */
  els(hud, p) {
    if (!hud || !p.sel) return [];
    const all = [...hud.querySelectorAll(p.sel)];
    return all.length > 1 ? all.filter(el => !all.some(o => o !== el && o.contains(el))) : all;
  },
  /** The combo counter's place, size and visibility ({ x, y, s, off }), for the stage renderer. */
  // (read every frame by the stage renderer: the setting as it's kept, not a fresh copy of it each time)
  combo() { const v = this.override || Settings.values['hud.layout']; return (v && typeof v === 'object' && v.combo) || null; },
  /** "x y" from a computed `translate` (the CSS one the element already has: the offset goes on top of it). */
  split(t) {
    if (!t || t === 'none') return ['0px', '0px'];
    const out = []; let d = 0, cur = '';
    for (const ch of t) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ' ' && !d) { if (cur) out.push(cur); cur = ''; } else cur += ch; }
    if (cur) out.push(cur);
    return [out[0] || '0px', out[1] || '0px'];
  },
  apply(hud) {
    if (!hud) return;
    const L = this.get(), W = hud.clientWidth || 1, H = hud.clientHeight || 1, editing = typeof SkinEditor !== 'undefined' && SkinEditor.on;
    for (const p of HUD_PARTS) {
      const c = L[p.id] || {}, off = !!c.off || (editing && !!p.setting && !Settings.get(p.setting));
      for (const el of this.els(hud, p)) {
        if (el.dataset.hlBase == null) { el.style.translate = ''; el.dataset.hlBase = getComputedStyle(el).translate || 'none'; }
        const [bx, by] = this.split(el.dataset.hlBase), dx = (c.x || 0) * W, dy = (c.y || 0) * H, s = c.s && c.s !== 1 ? c.s : 0;
        el.style.translate = dx || dy ? `calc(${bx} + ${dx.toFixed(1)}px) calc(${by} + ${dy.toFixed(1)}px)` : '';
        el.style.scale = s ? String(s) : '';
        el.style.transformOrigin = s ? p.origin : '';
        el.classList.toggle('hl-off', off);
        el.dataset.hl = p.id;
      }
    }
  },
  /** Kept up to date as the screen changes size (the offsets are fractions of it). */
  watch(hud) {
    if (this._ro) this._ro.disconnect();
    this._ro = new ResizeObserver(() => this.apply(hud));
    this._ro.observe(hud);
    this.apply(hud);
  },
};

const SkinEditor = {
  on: false,
  toggle() { this.on ? this.close() : this.open(); },
  /** From the menus: Auto plays the selected beatmap (or any) to edit over; in gameplay: right there. */
  open() {
    if (this.on) return;
    if (Screens.currentName === 'gameplay' && GameplayScreen.s) { this.attach(); return; }
    const m = BeatmapManager.maps.get(SongSelect.selectedId) || BeatmapManager.maps.get(Settings.get('last.map')) || BeatmapManager.maps.values().next().value;
    if (!m) { Toast.err('The skin editor needs a beatmap', 'Import one first: you edit the HUD while Auto plays it.'); return; }
    if (typeof Overlays !== 'undefined') while (Overlays.top()) Overlays.top().close();
    this._from = Screens.currentName && Screens.currentName !== 'gameplay' ? Screens.currentName : 'home';
    Game.launch({ mapId: m.id, mods: ['AT'], mode: 'play', skinEditor: true, quick: true });
  },
  attach() {
    if (this.on) return;
    this.on = true; this.sel = null; this.undo = []; this.boxEls = new Map(); this._hitEl = null;
    { const r = GameplayScreen.renderer; if (r) r.resize(true); } // (the stage uncropped while editing: see ManiaRenderer.resize)
    UISounds.click();
    const btn = (label, ic, fn, cls = '') => h(`button.se-btn${cls}`, { title: label, onclick: () => { UISounds.click(); fn(); } }, icon(ic), h('span', label));
    this.stageEl = h('div.se-list');
    this.listEl = h('div.se-list');
    this.countEl = h('span.se-cnt');
    this.setEl = h('div.se-set');
    this.boxesEl = h('div.se-boxes');
    this.boxesEl.addEventListener('pointerdown', e => { if (e.target === this.boxesEl) this.select(null); });
    this.undoBtn = btn('Undo', 'back', () => this.undoStep());
    this.el = h('div.se', { role: 'dialog', 'aria-label': 'Skin editor' },
      this.boxesEl,
      h('div.se-top',
        h('div.se-title', h('span.se-logo', icon('brush')), h('div.se-tt', h('b', 'Skin editor'), h('span', h('i', SkinManager.current ? SkinManager.current.name : 'Skin'), ' · gameplay HUD'))),
        h('div.se-acts', this.undoBtn, btn('Reset all', 'retry', () => this.resetAll()), btn('Done', 'check', () => this.close(), '.primary'))),
      h('div.se-side.se-l',
        h('div.se-ph', 'Stage'), this.stageEl,
        h('div.se-ph', 'HUD', this.countEl), this.listEl,
        h('p.se-hint', kbHint('Drag to move · corner to scale · arrow keys nudge (Shift: 10px) · Delete hides · Ctrl+Z undoes · Esc closes', 'Drag to move, the corner to scale. Tap the eye to show or hide.'))),
      this.rEl = h('div.se-side.se-r', h('div.se-ph', 'Settings'), this.setEl));
    document.body.append(this.el);
    document.body.classList.add('se-open');
    // (every component, the ones turned off too — dimmed — so each can be placed before it's turned on)
    if (!GameplayScreen._hudAll) GameplayScreen.buildHud(); else HudLayout.apply(GameplayScreen.hud);
    this._key = e => this.onKey(e);
    window.addEventListener('keydown', this._key, true);
    this.paintList(); this.paintSettings();
    // (the boxes follow the HUD 15 times a second — each look at where things are makes the browser lay the page out
    // again — and every frame while one is being dragged)
    let n = 0;
    const loop = () => { if (!this.on) return; this._raf = requestAnimationFrame(loop); if (this._dragging || (n++ & 3) === 0) this.frame(); };
    this._raf = requestAnimationFrame(loop);
  },
  close() {
    if (!this.on) return;
    this.on = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._key, true);
    if (this.el) this.el.remove();
    document.body.classList.remove('se-open');
    { const r = GameplayScreen.renderer; if (r) r.resize(true); }
    const g = GameplayScreen.el; if (g) { g.style.translate = ''; g.style.scale = ''; g.style.transformOrigin = ''; }
    UISounds.back();
    if (Screens.currentName === 'gameplay' && GameplayScreen.params && GameplayScreen.params.skinEditor) {
      Screens.go(this._from || 'home', {}, { replace: true });
    } else if (Screens.currentName === 'gameplay' && GameplayScreen.s && GameplayScreen._hudAll) GameplayScreen.buildHud(); // (what's turned off goes again)
  },
  onKey(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.key !== 'Escape') return;
    const ctrl = e.ctrlKey || e.metaKey;
    // (the browser's own keys still work: reload, fullscreen, a new tab, closing it)
    if (/^F(5|11)$/.test(e.key) || (ctrl && !e.shiftKey && /^Key[RTWL]$/.test(e.code))) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat && !/^Arrow/.test(e.key)) return;
    if (e.key === 'Escape') { if (this.sel) this.select(null); else this.close(); return; }
    if (ctrl && e.shiftKey && e.code === 'KeyS') { this.close(); return; }
    if (ctrl && e.code === 'KeyZ') { this.undoStep(); return; }
    const p = HUD_PARTS.find(x => x.id === this.sel);
    if ((e.code === 'Delete' || e.code === 'Backspace') && p) { this.setShown(p, false); return; }
    // (arrow keys nudge the chosen component a pixel at a time, ten with Shift; the hit position too)
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d && p) { const hud = GameplayScreen.hud, n = e.shiftKey ? 10 : 1, c = this.layout()[p.id] || {}; this.setPart(p.id, { x: (c.x || 0) + d[0] * n / (hud.clientWidth || 1), y: (c.y || 0) + d[1] * n / (hud.clientHeight || 1) }); return; }
    const sd = this.stageDef(this.sel);
    if (d && sd && d[1]) this.setStage(sd, this.stageVal(sd) + d[1] * (sd.upMore ? -1 : 1) * (e.shiftKey ? 10 : 1));
  },

  // ── the layout
  layout() { return JSON.parse(JSON.stringify(HudLayout.get())); },
  /** What undo goes back to: the HUD layout and the hit position together. */
  snapshot() { return JSON.stringify({ layout: Settings.get('hud.layout') || {}, stage: Object.fromEntries(this.STAGE.map(d => [d.key, this.stageVal(d)])) }); },
  commit(L) {
    this.undo.push(this.snapshot());
    if (this.undo.length > 100) this.undo.shift();
    for (const k of Object.keys(L)) { const c = L[k]; if (!c.x && !c.y && (!c.s || c.s === 1) && !c.off) delete L[k]; }
    Settings.set('hud.layout', L);
    HudLayout.override = null;
    HudLayout.apply(GameplayScreen.hud);
    this.paintList(); this.paintSettings();
  },
  setPart(id, patch) { const L = this.layout(); L[id] = { ...(L[id] || {}), ...patch }; this.commit(L); },
  undoStep() {
    const prev = this.undo.pop();
    if (prev == null) return;
    const snap = JSON.parse(prev);
    Settings.set('hud.layout', snap.layout || {});
    for (const d of this.STAGE) { const v = (snap.stage || {})[d.key] ?? (d.def || 0); if (this.stageVal(d) !== v) Settings.set(d.key, v); }
    HudLayout.apply(GameplayScreen.hud);
    this.paintList(); this.paintSettings();
  },
  resetAll() {
    this.commit({});
    for (const d of this.STAGE) if (this.stageVal(d) !== (d.def || 0)) Settings.set(d.key, d.def || 0);
    this.paintList(); this.paintSettings();
    Toast.show('HUD layout reset', 'Everything is back where the skin puts it, the hit position, note offset and receptors too.');
  },

  // ── the stage: where notes are judged (the hit position — the receptors, from the skin's own HitPosition, moved up
  // or down) and where they're drawn against it (the note offset)
  STAGE: [
    { id: 'hitpos', key: 'gameplay.hitPositionOffset', name: 'Hit position', icon: 'keyboard', min: -120, max: 60, unit: '', redraw: true,
      note: 'Where the notes are judged — the receptors. Drag the line on the stage, or slide it here: up is negative, down is positive.' },
    { id: 'noteoff', key: 'gameplay.noteOffset', name: 'Note offset', icon: 'mania', min: -40, max: 40, unit: 'px',
      note: 'Where the notes are drawn against the receptors (only how they look — the timing stays the same). Negative draws them higher, positive lower.' },
    // (a percentage, 100 as the skin draws them: up the arrow keys for more)
    { id: 'keyalpha', key: 'skin.receptorAlpha', name: 'Receptor opacity', label: 'Opacity', icon: 'eye', min: 0, max: 100, unit: '%', def: 100, redraw: true, upMore: true, pct: true,
      note: 'How see-through the receptors (the keys at the bottom of each column) are — 0% hides them. Any skin.' },
  ],
  get HIT() { return this.STAGE[0]; },
  stageDef(id) { return this.STAGE.find(d => d.id === id); },
  stageVal(d) { const v = Settings.get(d.key); return v == null ? d.def || 0 : v; },
  hitOffset() { return this.stageVal(this.HIT); },
  /** Live while dragging or sliding (the stage drawn again at once); saved when you let go. */
  preview(d, v) {
    v = clamp(Math.round(v), d.min, d.max);
    if (Settings.values[d.key] === v) return v;
    Settings.values[d.key] = v;
    const r = GameplayScreen.renderer; if (r && d.redraw) r.resize(true);
    return v;
  },
  previewHit(v) { return this.preview(this.HIT, v); },
  setStage(d, v, before) {
    v = clamp(Math.round(v), d.min, d.max);
    this.undo.push(before ?? this.snapshot());
    Settings.values[d.key] = before != null ? (JSON.parse(before).stage || {})[d.key] ?? (d.def || 0) : this.stageVal(d); // (so the change below is seen)
    Settings.set(d.key, v);
    this.paintList(); this.paintSettings();
  },
  setHit(v, before) { this.setStage(this.HIT, v, before); },
  /** The chosen component's header: its icon and name, and (for one on the HUD) a switch to show or hide it. */
  head(item, sw = null) { return h('div.se-head', h('span.se-ic', icon(item.icon || 'brush')), h('div.se-name', item.name), sw); },
  stagePanel(d) {
    const fnf = d === this.HIT && GameplayScreen.renderer && GameplayScreen.renderer.fnf; // (FNF's receptors stay where they are)
    const v0 = this.stageVal(d);
    const fmt = v => d.pct ? `${v}%` : `${v > 0 ? '+' : ''}${v}${d.unit}`, def = d.def || 0;
    const val = h('b', fmt(v0));
    const sl = h('input.slider', { type: 'range', min: d.min, max: d.max, step: 1, value: v0, disabled: fnf, 'aria-label': d.name });
    const paint = () => sl.style.setProperty('--p', ((sl.value - d.min) / (d.max - d.min) * 100) + '%');
    let before = null;
    sl.addEventListener('pointerdown', () => { before = this.snapshot(); });
    sl.addEventListener('input', () => { if (before == null) before = this.snapshot(); const v = this.preview(d, +sl.value); val.textContent = fmt(v); paint(); });
    sl.addEventListener('change', () => { this.setStage(d, +sl.value, before); before = null; });
    paint();
    return [
      this.head(d),
      h('p.se-note', fnf ? 'This skin style puts its receptors in a fixed place.' : d.note),
      h('label.se-f', h('span', d.label || 'Offset', val), sl, h('span.se-scale', h('i', fmt(d.min)), h('i', d.pct ? '50%' : '0'), h('i', fmt(d.max)))),
      h('div.se-btns', h('button.btn.sm', { disabled: v0 === def, onclick: () => { UISounds.click(); this.setStage(d, def); } }, icon('retry'), d.redraw ? 'Back to the skin\'s' : 'Reset'))];
  },
  /** Show or hide a component. One with a setting of its own (the hit error meter, judgement counter, leaderboard)
   *  turns that on when shown; hidden, it stays on with the component hidden. */
  setShown(p, on) {
    if (on && p.setting && !Settings.get(p.setting)) Settings.set(p.setting, true);
    this.setPart(p.id, { off: !on });
  },
  shown(p) { return !(this.layout()[p.id] || {}).off && (!p.setting || !!Settings.get(p.setting)); },
  select(id) {
    if (this.sel === id) return;
    this.sel = id; this.paintList(); this.paintSettings();
    // (the chosen one in view in the list)
    // (with its settings open under it, at the top: the settings below it in view too)
    const it = id && this.el && this.el.querySelector(`.se-item[data-id="${id}"]`); if (it) it.scrollIntoView({ block: this._short ? 'start' : 'nearest' });
  },

  paintList() {
    if (this.undoBtn) this.undoBtn.disabled = !this.undo.length;
    clearEl(this.stageEl).append(...this.STAGE.map(d => { const v = this.stageVal(d); return h(`div.se-item.se-stage${this.sel === d.id ? '.on' : ''}`, { dataset: { id: d.id }, onclick: () => { UISounds.click(); this.select(d.id); } },
      h('span.se-ic', icon(d.icon)), h('span.se-nm', d.name, h('small', v === (d.def || 0) ? 'as the skin has it' : d.pct ? `${v}%` : `moved ${v > 0 ? '+' : ''}${v}${d.unit}`))); }));
    let n = 0;
    clearEl(this.listEl).append(...HUD_PARTS.map(p => {
      const on = this.shown(p), na = on && this.present && !this.present.has(p.id);
      if (on) n++;
      return h(`div.se-item${this.sel === p.id ? '.on' : ''}${on ? '' : '.off'}${na ? '.na' : ''}`, { dataset: { id: p.id }, onclick: () => { UISounds.click(); this.select(p.id); } },
        h('span.se-ic', icon(p.icon)),
        h('span.se-nm', p.name, !on ? h('small', 'hidden') : na ? h('small', p.id === 'hp' ? 'drawn by the skin on the stage' : 'not on screen right now') : null),
        h('button.se-eye', { title: on ? 'Hide' : 'Show', 'aria-label': `${on ? 'Hide' : 'Show'} ${p.name}`, 'aria-pressed': String(on), onclick: e => { e.stopPropagation(); UISounds.play(on ? 'check-off' : 'check-on'); this.setShown(p, !on); } }, icon(on ? 'eye' : 'eye-slash')));
    }));
    this.countEl.textContent = `${n} of ${HUD_PARTS.length} shown`;
    this.placeSettings();
  },
  /** A phone held sideways: no room for a settings panel as well — the chosen one's settings open under it in the list,
   *  and the game gets that room. */
  short() { return innerHeight <= 500 && innerWidth >= 700; },
  placeSettings() {
    if (!this.el) return;
    const short = this._short = this.short();
    this.el.classList.toggle('se-short', short);
    const it = short && this.sel && this.el.querySelector(`.se-l .se-item[data-id="${this.sel}"]`);
    if (it) it.after(this.setEl);
    else if (short) this.setEl.remove();
    else if (this.setEl.parentElement !== this.rEl) this.rEl.append(this.setEl);
  },
  paintSettings() {
    const sd = this.stageDef(this.sel);
    if (sd) { clearEl(this.setEl).append(...this.stagePanel(sd)); return; }
    const p = HUD_PARTS.find(x => x.id === this.sel);
    if (!p) { clearEl(this.setEl).append(h('div.se-empty', h('span.se-empty-ic', icon('target')), h('b', 'Nothing selected'), h('p', Mobile.touch ? 'Tap a component on the screen or in the list to move, scale or hide it.' : 'Click a component on the screen or in the list to move, scale or hide it.'))); return; }
    const c = this.layout()[p.id] || {}, s = c.s || 1, on = this.shown(p);
    const val = h('b', `${Math.round(s * 100)}%`);
    const sl = h('input.slider', { type: 'range', min: 0.3, max: 2.5, step: 0.05, value: s, 'aria-label': 'Scale' });
    const paint = () => sl.style.setProperty('--p', ((sl.value - 0.3) / 2.2 * 100) + '%');
    sl.addEventListener('input', () => {
      val.textContent = `${Math.round(sl.value * 100)}%`; paint();
      const L = this.layout(); L[p.id] = { ...(L[p.id] || {}), s: +sl.value }; HudLayout.override = L; HudLayout.apply(GameplayScreen.hud);
    });
    sl.addEventListener('change', () => { HudLayout.override = null; this.setPart(p.id, { s: +sl.value }); });
    paint();
    const hud = GameplayScreen.hud, W = hud ? hud.clientWidth || 1 : 1, H = hud ? hud.clientHeight || 1 : 1;
    // (the position as pixels from where the skin puts it: typed, or nudged with the arrow keys)
    const num = (axis, v, size) => {
      const inp = h('input.se-num', { type: 'number', step: 1, value: Math.round(v * size), 'aria-label': `${axis} offset` });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('change', () => { const n = parseFloat(inp.value); if (isFinite(n)) this.setPart(p.id, { [axis.toLowerCase()]: clamp(n, -size, size) / size }); });
      return h('label.se-xy-f', h('span', axis), inp, h('i', 'px'));
    };
    const sw = h(`button.se-switch${on ? '.on' : ''}`, { role: 'switch', 'aria-checked': String(on), title: on ? 'Hide' : 'Show', onclick: () => { UISounds.play(on ? 'check-off' : 'check-on'); this.setShown(p, !on); } }, h('i'));
    clearEl(this.setEl).append(
      this.head(p, sw),
      on ? null : h('p.se-note.se-hid', icon('eye-slash'), h('span', 'Hidden while you play — it shows dimmed here so you can still place it.')),
      h('label.se-f', h('span', 'Scale', val), sl, h('span.se-scale', h('i', '30%'), h('i', '100%'), h('i', '250%'))),
      h('div.se-f', h('span', 'Position'), h('div.se-xy', num('X', c.x || 0, W), num('Y', c.y || 0, H))),
      h('div.se-btns.se-row',
        h('button.btn.sm', { disabled: !c.x && !c.y, onclick: () => { UISounds.click(); this.setPart(p.id, { x: 0, y: 0 }); } }, icon('target'), 'Reset position'),
        h('button.btn.sm', { disabled: !c.s || c.s === 1, onclick: () => { UISounds.click(); this.setPart(p.id, { s: 1 }); } }, icon('retry'), 'Reset scale')));
  },

  // ── each frame: the game fits between the side panels, and the boxes follow the components
  frame() {
    const g = GameplayScreen.el, hud = GameplayScreen.hud;
    if (Screens.currentName !== 'gameplay' || !g || !document.body.contains(g)) { if (!this._gone) this._gone = performance.now(); else if (performance.now() - this._gone > 1500) this.close(); return; }
    this._gone = 0;
    // (the panels as the CSS lays them out: beside the game, narrower on a small screen, under it on a narrow one)
    const vw = window.innerWidth, vh = window.innerHeight, narrow = vw < 700, mid = !narrow && vw < 1000;
    if (this.short() !== this._short) this.placeSettings(); // (turned, or the window resized)
    const L = narrow ? 0 : this._short ? 236 : mid ? 180 : 248, R = narrow || this._short ? 0 : mid ? 196 : 268, T = narrow || mid ? 48 : 56, B = narrow ? Math.round(vh * 0.42) : 0, pad = narrow ? 8 : 16;
    const k = Math.min((vw - L - R - pad * 2) / vw, (vh - T - B - pad * 2) / vh);
    if (k > 0.2) {
      // (in the screen's own pixels: the page itself may be scaled, by z)
      const par = g.parentElement, pr = par.getBoundingClientRect(), z = par.offsetWidth ? pr.width / par.offsetWidth : 1;
      const x = L + pad + ((vw - L - R - pad * 2) - vw * k) / 2, y = T + pad + Math.max(0, ((vh - T - B - pad * 2) - vh * k) / 2);
      // (the translate and scale properties: the screen's own transition animates its transform)
      const tr = `${((x - pr.left) / (z || 1)).toFixed(1)}px ${((y - pr.top) / (z || 1)).toFixed(1)}px`, sc = k.toFixed(4);
      if (g.style.translate !== tr || g.style.scale !== sc) { g.style.transformOrigin = '0 0'; g.style.translate = tr; g.style.scale = sc; }
      this._k = k;
    }
    this.hitBox();
    if (!hud) return;
    const seen = new Set();
    for (const p of HUD_PARTS) {
      const els = HudLayout.els(hud, p);
      let r = p.canvas ? this.canvasRect(p) : null;
      for (const el of els) {
        const b0 = el.getBoundingClientRect();
        if (!b0.width && !b0.height) continue;
        // (a thin one — a bar drawn by its children — still gets a box you can grab)
        const padY = Math.max(0, (12 - b0.height) / 2), padX = Math.max(0, (12 - b0.width) / 2);
        const b = { left: b0.left - padX, right: b0.right + padX, top: b0.top - padY, bottom: b0.bottom + padY };
        r = r ? { l: Math.min(r.l, b.left), t: Math.min(r.t, b.top), r: Math.max(r.r, b.right), b: Math.max(r.b, b.bottom) } : { l: b.left, t: b.top, r: b.right, b: b.bottom };
      }
      if (!r) continue;
      seen.add(p.id);
      let box = this.boxEls.get(p.id);
      if (!box) { box = this.makeBox(p); this.boxEls.set(p.id, box); this.boxesEl.append(box); }
      box.classList.toggle('on', this.sel === p.id);
      box.classList.toggle('off', !!(HudLayout.get()[p.id] || {}).off || (!!p.setting && !Settings.get(p.setting)));
      const st = `left:${r.l.toFixed(1)}px;top:${r.t.toFixed(1)}px;width:${(r.r - r.l).toFixed(1)}px;height:${(r.b - r.t).toFixed(1)}px`;
      if (box._st !== st) { box._st = st; box.style.cssText = st; }
      box._r = r;
      // (the name tag on the side facing the middle: one by the right edge was cut off under the Settings panel)
      box.classList.toggle('lr', r.l + r.r > window.innerWidth);
    }
    for (const [id, box] of this.boxEls) if (!seen.has(id)) { box.remove(); this.boxEls.delete(id); }
    const key = [...seen].join();
    if (key !== this._seenKey) { this._seenKey = key; this.present = seen; this.paintList(); }
  },
  /** Where a part drawn on the stage canvas (the combo counter) is on screen, from where it was last drawn. */
  canvasRect(p) {
    const rr = GameplayScreen.renderer, cv = rr && rr.canvas, b = p.id === 'combo' && rr && rr._cmbRect;
    if (!b || !cv || !cv.isConnected) return null;
    const cr = cv.getBoundingClientRect();
    if (!cr.width || !cr.height) return null;
    const kx = cr.width / cv.width, ky = cr.height / cv.height, x = b.x - (rr.cropX || 0);
    const pad = 4;
    return { l: cr.left + x * kx - pad, t: cr.top + b.y * ky - pad, r: cr.left + (x + b.w) * kx + pad, b: cr.top + (b.y + b.h) * ky + pad };
  },
  /** The judgement line on the stage, as a thin box you drag up and down. */
  hitBox() {
    const r = GameplayScreen.renderer, cv = r && r.canvas;
    if (!r || !cv || !cv.isConnected || !r.H || r.fnf) { if (this._hitEl) { this._hitEl.remove(); this._hitEl = null; } return; }
    const cr = cv.getBoundingClientRect();
    if (!cr.height) return;
    const k = cr.height / r.H, yPx = (r.up ? r.H - r.hitY : r.hitY) * k;
    const x0 = cr.left + ((r.stageX - (r.cropX || 0)) * cr.width / cv.width), w = r.stageW * cr.width / cv.width;
    if (!this._hitEl) {
      const box = this._hitEl = h('div.se-box.se-hitline', h('span.se-label', this.HIT.name));
      box.addEventListener('pointerdown', e => {
        if (e.button) return;
        e.preventDefault(); e.stopPropagation();
        this.select(this.HIT.id);
        box.setPointerCapture(e.pointerId);
        const rr = GameplayScreen.renderer, rect = rr.canvas.getBoundingClientRect(), unit = rr.s * rect.height / rr.H; // (screen px per skin unit)
        const before = this.snapshot(), v0 = this.hitOffset(), y0 = e.clientY;
        let v = v0;
        const move = ev => { v = this.previewHit(v0 + (ev.clientY - y0) / unit * (rr.up ? -1 : 1)); this._dragging = true; this.frame(); };
        const up = () => {
          this._dragging = false;
          box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up);
          if (v !== v0) this.setHit(v, before); else this.paintSettings();
        };
        box.addEventListener('pointermove', move); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
      });
      this.boxesEl.append(this._hitEl);
    }
    this._hitEl.classList.toggle('on', this.sel === this.HIT.id);
    const st = `left:${x0.toFixed(1)}px;top:${(cr.top + yPx - 7).toFixed(1)}px;width:${w.toFixed(1)}px;height:14px`;
    if (this._hitEl._st !== st) { this._hitEl._st = st; this._hitEl.style.cssText = st; }
  },
  makeBox(p) {
    const handle = h('i.se-handle');
    const box = h('div.se-box', h('span.se-label', p.name), handle);
    box.addEventListener('pointerdown', e => {
      if (e.button) return;
      e.preventDefault(); e.stopPropagation();
      this.select(p.id);
      box.setPointerCapture(e.pointerId);
      const hud = GameplayScreen.hud, hr = hud.getBoundingClientRect(), L0 = this.layout(), c0 = { ...(L0[p.id] || {}) };
      const scaling = e.target === handle, r = box._r;
      // (scaling is about the component's anchor: the corner it sits from)
      const [ox, oy] = p.origin.split(' ');
      const ax = ox === 'right' ? r.r : ox === 'left' ? r.l : (r.l + r.r) / 2, ay = oy === 'bottom' ? r.b : oy === 'top' ? r.t : (r.t + r.b) / 2;
      const d0 = Math.hypot(e.clientX - ax, e.clientY - ay) || 1, x0 = e.clientX, y0 = e.clientY;
      let moved = false;
      const move = ev => {
        const L = this.layout(), c = { ...c0 };
        if (scaling) c.s = clamp(Math.round((c0.s || 1) * Math.hypot(ev.clientX - ax, ev.clientY - ay) / d0 * 20) / 20, 0.3, 2.5);
        else { c.x = (c0.x || 0) + (ev.clientX - x0) / hr.width; c.y = (c0.y || 0) + (ev.clientY - y0) / hr.height; }
        moved = moved || Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 2;
        L[p.id] = c; HudLayout.override = L; HudLayout.apply(hud);
      };
      const up = () => {
        this._dragging = false;
        box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up);
        const L = HudLayout.override; HudLayout.override = null;
        if (moved && L) this.commit(L); else HudLayout.apply(hud);
      };
      this._dragging = true;
      box.addEventListener('pointermove', move); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
    });
    return box;
  },
};
