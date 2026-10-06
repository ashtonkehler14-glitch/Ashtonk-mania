/* osu!lazer's skin editor (Ctrl+Shift+S, or Settings → Skin → Skin layout editor), for the gameplay HUD: the game
 * shrinks into the middle of the screen with Auto playing (the song loops), the HUD's components get boxes — drag
 * one to move it, its corner handle to scale it — the Components list on the left shows and hides them, and the
 * Settings on the right set the chosen one's scale and position. The layout is kept (`hud.layout`: each component's
 * offset as a fraction of the screen, its scale, and whether it's hidden) and every play uses it. */

const HUD_PARTS = [
  { id: 'score', name: 'Score, accuracy & pp', sel: '.hud-score', origin: 'top right' },
  { id: 'hp', name: 'Health display', sel: '.hud-hp, .hud-skinhp', origin: 'top left' },
  { id: 'progress', name: 'Song progress', sel: '.hud-sp, .hud-progress', origin: 'bottom center' },
  { id: 'error', name: 'Hit error meter', sel: '.hud-err', origin: 'bottom center', setting: 'gameplay.hitErrorMeter' },
  { id: 'jc', name: 'Judgement counter', sel: '.hud-jc', origin: 'center right', setting: 'gameplay.judgementCounter' },
  { id: 'lb', name: 'Leaderboard', sel: '.hud-lb, .hud-mp', origin: 'center left', setting: 'gameplay.leaderboard' },
];

const HudLayout = {
  override: null,
  get() { if (this.override) return this.override; const v = Settings.get('hud.layout'); return v && typeof v === 'object' ? v : {}; },
  els(hud, p) { return hud ? [...hud.children].filter(el => el.matches(p.sel)) : []; },
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
    const L = this.get(), W = hud.clientWidth || 1, H = hud.clientHeight || 1;
    for (const p of HUD_PARTS) {
      const c = L[p.id] || {};
      for (const el of this.els(hud, p)) {
        if (el.dataset.hlBase == null) { el.style.translate = ''; el.dataset.hlBase = getComputedStyle(el).translate || 'none'; }
        const [bx, by] = this.split(el.dataset.hlBase), dx = (c.x || 0) * W, dy = (c.y || 0) * H, s = c.s && c.s !== 1 ? c.s : 0;
        el.style.translate = dx || dy ? `calc(${bx} + ${dx.toFixed(1)}px) calc(${by} + ${dy.toFixed(1)}px)` : '';
        el.style.scale = s ? String(s) : '';
        el.style.transformOrigin = s ? p.origin : '';
        el.classList.toggle('hl-off', !!c.off);
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
    this.on = true; this.sel = null; this.undo = []; this.boxEls = new Map();
    UISounds.click();
    const btn = (label, ic, fn, cls = '') => h(`button.se-btn${cls}`, { onclick: () => { UISounds.click(); fn(); } }, icon(ic), h('span', label));
    this.listEl = h('div.se-list');
    this.setEl = h('div.se-set');
    this.boxesEl = h('div.se-boxes');
    this.boxesEl.addEventListener('pointerdown', e => { if (e.target === this.boxesEl) this.select(null); });
    this.el = h('div.se', { role: 'dialog', 'aria-label': 'Skin editor' },
      this.boxesEl,
      h('div.se-top', h('div.se-title', icon('brush'), h('b', 'Skin editor'), h('span', `Currently editing: ${SkinManager.current ? SkinManager.current.name : 'skin'} — gameplay HUD`)),
        h('div.se-acts', btn('Undo', 'back', () => this.undoStep()), btn('Reset all', 'retry', () => this.resetAll()), btn('Done', 'check', () => this.close(), '.primary'))),
      h('div.se-side.se-l', h('div.se-ph', 'Components'), this.listEl, h('p.se-hint', kbHint('Drag a component to move it, its corner to scale it. Ctrl+Z undoes, Esc closes.', 'Drag a component to move it, its corner to scale it.'))),
      h('div.se-side.se-r', h('div.se-ph', 'Settings'), this.setEl));
    document.body.append(this.el);
    document.body.classList.add('se-open');
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
    const g = GameplayScreen.el; if (g) { g.style.translate = ''; g.style.scale = ''; g.style.transformOrigin = ''; }
    UISounds.back();
    if (Screens.currentName === 'gameplay' && GameplayScreen.params && GameplayScreen.params.skinEditor) {
      Screens.go(this._from || 'home', {}, { replace: true });
    }
  },
  onKey(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.key !== 'Escape') return;
    const ctrl = e.ctrlKey || e.metaKey;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.key === 'Escape') { if (this.sel) this.select(null); else this.close(); return; }
    if (ctrl && e.shiftKey && e.code === 'KeyS') { this.close(); return; }
    if (ctrl && e.code === 'KeyZ') { this.undoStep(); return; }
    if ((e.code === 'Delete' || e.code === 'Backspace') && this.sel) { this.setPart(this.sel, { off: true }); return; }
  },

  // ── the layout
  layout() { return JSON.parse(JSON.stringify(HudLayout.get())); },
  commit(L) {
    this.undo.push(JSON.stringify(Settings.get('hud.layout') || {}));
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
    Settings.set('hud.layout', JSON.parse(prev));
    HudLayout.apply(GameplayScreen.hud);
    this.paintList(); this.paintSettings();
  },
  resetAll() { this.commit({}); Toast.show('HUD layout reset', 'Everything is back where the skin puts it.'); },
  /** A component shown by a setting (the judgement counter, hit error meter, leaderboard): turning it on builds it. */
  setShown(p, on) {
    if (p.setting) {
      if (on && Settings.get(p.setting) && !(this.layout()[p.id] || {}).off) return;
      if (on) { Settings.set(p.setting, true); this.setPart(p.id, { off: false }); }
      else this.setPart(p.id, { off: true });
      if (on && GameplayScreen.s) { GameplayScreen.buildHud(); }
      return;
    }
    this.setPart(p.id, { off: !on });
  },
  shown(p) { return !(this.layout()[p.id] || {}).off && (!p.setting || !!Settings.get(p.setting)); },
  select(id) { this.sel = id; this.paintList(); this.paintSettings(); },

  paintList() {
    clearEl(this.listEl).append(...HUD_PARTS.map(p => {
      const on = this.shown(p), na = on && this.present && !this.present.has(p.id);
      return h(`div.se-item${this.sel === p.id ? '.on' : ''}${on ? '' : '.off'}${na ? '.na' : ''}`, { onclick: () => { UISounds.click(); this.select(p.id); } },
        h('span', p.name, na ? h('small', p.id === 'hp' ? 'drawn by the skin on the stage' : 'not on screen right now') : null),
        h('button.se-eye', { title: on ? 'Hide' : 'Show', onclick: e => { e.stopPropagation(); UISounds.click(); this.setShown(p, !on); } }, icon(on ? 'check' : 'x')));
    }));
  },
  paintSettings() {
    const p = HUD_PARTS.find(x => x.id === this.sel);
    if (!p) { clearEl(this.setEl).append(h('p.se-none', 'Pick a component to change it.')); return; }
    const c = this.layout()[p.id] || {}, s = c.s || 1;
    const val = h('b', `${Math.round(s * 100)}%`);
    const sl = h('input.slider', { type: 'range', min: 0.3, max: 2.5, step: 0.05, value: s });
    const paint = () => sl.style.setProperty('--p', ((sl.value - 0.3) / 2.2 * 100) + '%');
    sl.addEventListener('input', () => {
      val.textContent = `${Math.round(sl.value * 100)}%`; paint();
      const L = this.layout(); L[p.id] = { ...(L[p.id] || {}), s: +sl.value }; HudLayout.override = L; HudLayout.apply(GameplayScreen.hud);
    });
    sl.addEventListener('change', () => this.setPart(p.id, { s: +sl.value }));
    paint();
    const hud = GameplayScreen.hud, W = hud ? hud.clientWidth : 1, H = hud ? hud.clientHeight : 1;
    clearEl(this.setEl).append(
      h('div.se-name', p.name),
      h('label.se-f', h('span', 'Scale', val), sl),
      h('div.se-f', h('span', 'Position'), h('div.se-pos', h('span', `X ${Math.round((c.x || 0) * W)}px`), h('span', `Y ${Math.round((c.y || 0) * H)}px`))),
      h('div.se-btns',
        h('button.btn.sm', { onclick: () => { UISounds.click(); this.setPart(p.id, { x: 0, y: 0 }); } }, icon('target'), 'Reset position'),
        h('button.btn.sm', { onclick: () => { UISounds.click(); this.setPart(p.id, { s: 1 }); } }, icon('retry'), 'Reset scale'),
        h('button.btn.sm', { onclick: () => { UISounds.click(); this.setShown(p, !this.shown(p)); } }, icon(this.shown(p) ? 'x' : 'check'), this.shown(p) ? 'Hide' : 'Show')));
  },

  // ── each frame: the game fits between the side panels, and the boxes follow the components
  frame() {
    const g = GameplayScreen.el, hud = GameplayScreen.hud;
    if (Screens.currentName !== 'gameplay' || !g || !document.body.contains(g)) { if (!this._gone) this._gone = performance.now(); else if (performance.now() - this._gone > 1500) this.close(); return; }
    this._gone = 0;
    // (the panels as the CSS lays them out: beside the game, narrower on a small screen, under it on a narrow one)
    const vw = window.innerWidth, vh = window.innerHeight, narrow = vw < 700, mid = !narrow && vw < 1000;
    const L = narrow ? 0 : mid ? 170 : 240, R = narrow ? 0 : mid ? 190 : 260, T = narrow || mid ? 48 : 56, B = narrow ? Math.round(vh * 0.42) : 0, pad = narrow ? 8 : 16;
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
    if (!hud) return;
    const seen = new Set();
    for (const p of HUD_PARTS) {
      const els = HudLayout.els(hud, p);
      let r = null;
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
      box.classList.toggle('off', !!(HudLayout.get()[p.id] || {}).off);
      const st = `left:${r.l.toFixed(1)}px;top:${r.t.toFixed(1)}px;width:${(r.r - r.l).toFixed(1)}px;height:${(r.b - r.t).toFixed(1)}px`;
      if (box._st !== st) { box._st = st; box.style.cssText = st; }
      box._r = r;
    }
    for (const [id, box] of this.boxEls) if (!seen.has(id)) { box.remove(); this.boxEls.delete(id); }
    const key = [...seen].join();
    if (key !== this._seenKey) { this._seenKey = key; this.present = seen; this.paintList(); }
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
