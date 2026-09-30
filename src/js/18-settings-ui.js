/* Settings panel (schema-driven), key configuration, offset calibration and the mod select overlay. */

const SECTION_ICONS = { Gameplay: 'target', Audio: 'volume', Graphics: 'sparkle', Input: 'keyboard', Interface: 'home', Skin: 'brush', Maintenance: 'database' };

/** The settings shown by default; everything else sits behind "Show all settings" (search always finds it). */
const ESSENTIAL_SETTINGS = new Set([
  'gameplay.scrollSpeed', 'gameplay.scrollDirection', 'gameplay.scrollMode', 'gameplay.laneWidth', 'gameplay.bgDim', 'gameplay.bgBlur', 'gameplay.progressDisplay', 'gameplay.showPp', 'gameplay.healthStyle',
  'audio.master', 'audio.music', 'audio.effects', 'audio.offset',
  'graphics.fpsLimit', 'graphics.showFps', 'graphics.performanceMode',
  'input.keybinds', 'ui.scale', 'ui.theme', 'ui.mascot', 'ui.mascotImage', 'skin.current', 'data',
]);

const SettingsPanel = {
  o: null,
  toggle() { this.o ? this.close() : this.open(); },
  open(section) {
    if (this.o) { if (section) this.scrollTo(section); return; }
    UISounds.click();
    const nav = h('div.sp-nav');
    const search = h('input.input.sp-search', { type: 'search', placeholder: 'Search settings…', 'aria-label': 'Search settings' });
    const scroll = h('div.sp-scroll');
    const panel = h('div.settings-panel', { role: 'dialog', 'aria-label': 'Settings' }, nav,
      h('div.sp-main', h('div.sp-head', h('div.row', h('h2', 'Settings'), h('span.grow'), h('button.icon-btn', { title: 'Close (Esc)', onclick: () => this.close() }, icon('x'))),
        search), scroll));
    this.scrollEl = scroll; this.nav = nav;
    this.build('');
    search.addEventListener('input', () => this.build(search.value.trim().toLowerCase()));
    search.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
    scroll.addEventListener('scroll', () => this.syncNav());
    this.o = makeOverlay(panel, { onClose: () => { this.o = null; KeyConfig.stop(); } });
    if (section) requestAnimationFrame(() => this.scrollTo(section));
  },
  close() { if (this.o) { UISounds.back(); this.o.close(); } },
  scrollTo(sec) {
    const el = this.scrollEl && this.scrollEl.querySelector(`[data-section="${sec}"]`);
    if (el) this.scrollEl.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
  },
  syncNav() {
    const secs = $$('.sp-section', this.scrollEl);
    let cur = secs[0]?.dataset.section;
    for (const s of secs) if (s.offsetTop - this.scrollEl.scrollTop < 80) cur = s.dataset.section;
    $$('[data-sec]', this.nav).forEach(b => b.classList.toggle('active', b.dataset.sec === cur));
  },
  build(q) {
    this.q = q;
    const scroll = this.scrollEl;
    clearEl(scroll);
    const all = !!Settings.get('ui.allSettings') || !!q;
    const bySec = new Map();
    let hiddenCount = 0;
    for (const it of SETTINGS_SCHEMA) {
      if (!it.s) continue;
      if (q && !(`${it.s} ${it.g} ${it.l} ${it.hint || ''}`.toLowerCase().includes(q))) continue;
      if (!all && !ESSENTIAL_SETTINGS.has(it.k)) { hiddenCount++; continue; }
      if (!bySec.has(it.s)) bySec.set(it.s, new Map());
      const g = bySec.get(it.s);
      if (!g.has(it.g)) g.set(it.g, []);
      g.get(it.g).push(it);
    }
    for (const [sec, groups] of bySec) {
      const secEl = h('div.sp-section', { dataset: { section: sec } }, h('h3', icon(SECTION_ICONS[sec] || 'gear'), sec));
      for (const [g, items] of groups) {
        secEl.append(h('div.sp-group', g));
        for (const it of items) secEl.append(this.row(it));
      }
      scroll.append(secEl);
    }
    if (!bySec.size) scroll.append(h('div.empty', 'No settings match your search.'));
    if (!q) {
      const more = !!Settings.get('ui.allSettings');
      scroll.append(h('button.btn.sp-more', { onclick: () => { Settings.set('ui.allSettings', !more); UISounds.click(); this.build(''); } },
        more ? 'Show fewer settings' : `Show all settings (${hiddenCount} more)`));
    }
    scroll.append(h('div.sp-footer', `${APP_NAME} v${APP_VERSION}`));
    clearEl(this.nav).append(...[...bySec.keys()].map(sec => h('button.icon-btn', { title: sec, 'aria-label': sec, dataset: { sec }, onclick: () => this.scrollTo(sec) }, icon(SECTION_ICONS[sec] || 'gear'))));
    this.syncNav();
  },
  row(it) {
    const val = () => Settings.get(it.k);
    const isDefault = () => JSON.stringify(Settings.get(it.k)) === JSON.stringify(it.d);
    const reset = h('button.icon-btn.reset', { title: 'Reset to default', onclick: () => { Settings.set(it.k, structuredClone(it.d)); rebuild(); } }, icon('retry'));
    const updReset = () => reset.classList.toggle('show', !isDefault());
    const lbl = h('div.lbl', it.l, it.hint ? h('div.hint', it.hint) : null);
    let row;
    const rebuild = () => { const n = this.row(it); row.replaceWith(n); };
    if (it.when && !it.when()) return h('div', { hidden: true });
    switch (it.t) {
      case 'bool': {
        const t = h(`button.toggle${val() ? '.on' : ''}`, { role: 'switch', 'aria-checked': String(!!val()), 'aria-label': it.l, onclick: () => {
          const v = !val(); Settings.set(it.k, v); t.classList.toggle('on', v); t.setAttribute('aria-checked', String(v)); UISounds.play(v ? 'check-on' : 'check-off'); updReset();
        } });
        row = h('div.set-row', lbl, h('div.ctl', reset, t));
        break;
      }
      case 'range': {
        const s = h('input.slider', { type: 'range', min: it.min, max: it.max, step: it.step, value: val(), 'aria-label': it.l });
        const v = h('span.val');
        const upd = () => { const x = parseFloat(s.value); v.textContent = it.fmt ? it.fmt(x) : x; s.style.setProperty('--p', ((x - it.min) / (it.max - it.min) * 100) + '%'); };
        s.addEventListener('input', () => { Settings.set(it.k, parseFloat(s.value)); upd(); updReset(); });
        s.addEventListener('keydown', e => e.stopPropagation());
        upd();
        row = h('div.set-row.col', h('div.row', lbl, v, reset), h('div.ctl', s,
          it.calibrate ? h('button.btn.sm', { onclick: () => Calibration.open() }, 'Calibrate') : null));
        break;
      }
      case 'select': {
        const sel = h('select.select', { 'aria-label': it.l }, ...it.o.map(([k, l]) => h('option', { value: k, selected: String(val()) === String(k) }, l)));
        sel.addEventListener('change', () => {
          Settings.set(it.k, it.num ? Number(sel.value) : sel.value); UISounds.click(); updReset();
          if (SETTINGS_SCHEMA.some(x => x.when && x.s === it.s)) { const st = this.scrollEl.scrollTop; this.build(this.q || ''); this.scrollEl.scrollTop = st; }
        });
        row = h('div.set-row', lbl, h('div.ctl', reset, sel));
        break;
      }
      case 'text': {
        const inp = h('input.input', { value: val(), style: { width: '100%' } });
        inp.addEventListener('change', () => { Settings.set(it.k, inp.value); updReset(); });
        inp.addEventListener('keydown', e => e.stopPropagation());
        row = h('div.set-row.col', h('div.row', lbl, reset), h('div.ctl', inp));
        break;
      }
      case 'keybinds': row = h('div.set-row.col', lbl, KeyConfig.build()); break;
      case 'skin': {
        const sel = h('select.select', { 'aria-label': 'Skin' }, ...SkinManager.list().map(s => h('option', { value: s.id, selected: s.id === SkinManager.current.id }, s.name)));
        sel.addEventListener('change', async () => { await SkinManager.select(sel.value); Toast.ok('Skin selected', SkinManager.current.name); });
        row = h('div.set-row', lbl, h('div.ctl', sel, h('button.btn.sm', { onclick: () => { this.close(); Screens.go('skins'); } }, 'Browse')));
        break;
      }
      case 'data': row = h('div.set-row.col', lbl, DataPanel.build()); break;
      case 'mascot': row = h('div.set-row', lbl, h('div.ctl',
        h('button.btn.sm', { onclick: async () => { const [f] = await pickFiles({ accept: 'image/*', multiple: false }); if (f) { await NeruMascot.setImage(f); Toast.ok('Main menu character updated'); } } }, icon('upload'), 'Choose image'),
        h('button.btn.sm.ghost', { onclick: async () => { await NeruMascot.setImage(null); Toast.show('Main menu character reset'); } }, 'Reset'))); break;
      default: row = h('div');
    }
    updReset();
    return row;
  },
};

// ─────────────────────────────── Key configuration ───────────────────────────────
const KeyConfig = {
  keys: 4, listening: null, addMode: false, root: null,
  build() {
    const root = h('div.keycfg');
    this.root = root;
    this.render();
    return root;
  },
  stop() {
    if (this._kd) { window.removeEventListener('keydown', this._kd, true); window.removeEventListener('keyup', this._ku, true); this._kd = null; }
    this.listening = null;
  },
  render() {
    const root = this.root;
    if (!root) return;
    clearEl(root);
    const binds = Settings.keybinds(this.keys);
    // conflicts: same code used by more than one lane
    const count = new Map();
    binds.forEach(codes => codes.forEach(c => count.set(c, (count.get(c) || 0) + 1)));
    const conflicts = new Set([...count].filter(([, n]) => n > 1).map(([c]) => c));
    const types = maniaColumnTypes(this.keys);
    root.append(h('div.keycfg-modes', ...Array.from({ length: MAX_KEYS }, (_, i) => i + 1).map(k => h(`button.chip${k === this.keys ? '.on' : ''}`, { onclick: () => { this.keys = k; this.listening = null; this.render(); } }, `${k}K`))));
    const lanes = h('div.keycfg-lanes');
    binds.forEach((codes, i) => {
      const lane = h(`button.lane-key${this.listening === i ? '.listening' : ''}${codes.some(c => conflicts.has(c)) ? '.conflict' : ''}${types[i] === 'S' ? '.special' : ''}`, {
        dataset: { lane: i }, title: 'Click: rebind · Right-click / Shift+click: add an extra key',
        onclick: e => { this.listen(i, e.shiftKey); },
        oncontextmenu: e => { e.preventDefault(); this.listen(i, true); },
      }, h('span.ln', String(i + 1)), this.listening === i ? '…' : keyLabel(codes[0]), codes.length > 1 ? h('span.alt', codes.slice(1).map(keyLabel).join(' ')) : null);
      lanes.append(lane);
    });
    root.append(lanes);
    let help = this.listening !== null
      ? `Press a key for lane ${this.listening + 1}${this.addMode ? ' (adding an extra binding)' : ''} · Backspace clears extras · Esc cancels`
      : 'Click a lane, then press a key. Shift+click or right-click to add multiple keys to one lane.';
    const warn = conflicts.size ? `Conflict: ${[...conflicts].map(keyLabel).join(', ')} bound to multiple lanes.` : '';
    root.append(h(`div.keycfg-help${warn ? '.warn' : ''}`, warn || help));
    root.append(h('div.row', { style: { justifyContent: 'center' } },
      h('button.btn.sm', { onclick: () => { Settings.setKeybinds(this.keys, structuredClone(DEFAULT_KEYBINDS[this.keys])); this.render(); } }, `Reset ${this.keys}K`),
      h('button.btn.sm.ghost', { onclick: async () => { if (await Dialog.confirm('Reset all keybinds?', 'Every key mode goes back to its default layout.')) { Settings.set('input.keybinds', structuredClone(DEFAULT_KEYBINDS)); this.render(); } } }, 'Reset all')));
    this.attach();
  },
  listen(i, add) { this.listening = i; this.addMode = add; UISounds.click(); this.render(); this.pollPad(); },
  /** While a lane is listening, a gamepad button press is captured as that lane's binding ("Pad<n>"). */
  pollPad() {
    if (!navigator.getGamepads || this._padRaf) return;
    const base = {};
    const tick = () => {
      this._padRaf = null;
      if (this.listening === null || !this.root || !this.root.isConnected) return;
      for (const gp of [...navigator.getGamepads()].filter(Boolean)) {
        for (let i = 0; i < gp.buttons.length; i++) {
          const k = gp.index + ':' + i, pressed = gp.buttons[i].pressed;
          if (base[k] === undefined) { base[k] = pressed; continue; }
          if (pressed && !base[k]) { this._kd({ code: `Pad${i}`, preventDefault() {}, stopPropagation() {} }); base[k] = pressed; return this.listening !== null && this.pollPad(); }
          base[k] = pressed;
        }
      }
      this._padRaf = requestAnimationFrame(tick);
    };
    this._padRaf = requestAnimationFrame(tick);
  },
  attach() {
    if (this._kd) return;
    this._kd = e => {
      if (!this.root || !this.root.isConnected) { this.stop(); return; }
      const binds = Settings.keybinds(this.keys);
      // visualization
      binds.forEach((codes, i) => { if (codes.includes(e.code)) this.root.querySelector(`[data-lane="${i}"]`)?.classList.add('pressed'); });
      if (this.listening === null) return;
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') { this.listening = null; this.render(); return; }
      const lane = this.listening;
      if (e.code === 'Backspace') { binds[lane] = binds[lane].slice(0, 1); }
      else if (e.code === 'Backquote') { Toast.show('That key is reserved', 'Hold ` to quick-retry during gameplay.'); return; }
      else if (this.addMode) { if (!binds[lane].includes(e.code)) binds[lane].push(e.code); }
      else binds[lane] = [e.code, ...binds[lane].slice(1).filter(c => c !== e.code)];
      Settings.setKeybinds(this.keys, binds);
      UISounds.play('check-on');
      this.listening = lane + 1 < this.keys && !this.addMode ? lane + 1 : null;
      this.render();
    };
    this._ku = e => {
      if (!this.root) return;
      const binds = Settings.keybinds(this.keys);
      binds.forEach((codes, i) => { if (codes.includes(e.code)) this.root.querySelector(`[data-lane="${i}"]`)?.classList.remove('pressed'); });
    };
    window.addEventListener('keydown', this._kd, true);
    window.addEventListener('keyup', this._ku, true);
  },
};

// ─────────────────────────────── Offset calibration ───────────────────────────────
const Calibration = {
  open() {
    AudioManager.resume();
    const beat = h('div.calib-beat', 'TAP');
    const info = h('div.muted', 'Tap Space (or click) in time with the clicks. 16 taps are averaged.');
    const res = h('div', { style: { fontWeight: 900, fontSize: '1.2rem', minHeight: '1.5em' } });
    const body = h('div.calib', beat, info, res);
    const BPM = 120, period = 60 / BPM;
    const ctx = AudioManager.ctx;
    const click = AudioManager.synth('click-short-confirm');
    const start = ctx.currentTime + 0.5;
    let n = 0, stopped = false;
    const errs = [];
    const schedule = () => {
      if (stopped) return;
      while (start + n * period < ctx.currentTime + 0.3) {
        AudioManager.play(click, { when: start + n * period, volume: 1.2 });
        const tBeat = start + n * period;
        setTimeout(() => { beat.classList.add('on'); setTimeout(() => beat.classList.remove('on'), 90); }, Math.max(0, (tBeat - AudioManager.now()) * 1000));
        n++;
      }
      setTimeout(schedule, 60);
    };
    schedule();
    const tap = ts => {
      const t = AudioManager.perfToCtx(ts);
      const k = Math.round((t - start) / period);
      if (k < 1) return;
      errs.push((t - (start + k * period)) * 1000);
      const recent = errs.slice(-16);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      res.textContent = `${recent.length} taps · average ${mean >= 0 ? '+' : ''}${mean.toFixed(1)}ms`;
      this.suggest = Math.round(mean);
    };
    const kd = e => { if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) tap(e.timeStamp); } };
    window.addEventListener('keydown', kd, true);
    beat.addEventListener('pointerdown', e => tap(e.timeStamp));
    const o = Dialog.custom('Audio offset calibration', body, [
      { label: 'Cancel' },
      { label: 'Apply', primary: true, onClick: () => { if (this.suggest != null) { Settings.set('audio.offset', clamp(this.suggest, -300, 300)); Toast.ok('Offset applied', `${this.suggest}ms`); if (SettingsPanel.o) SettingsPanel.build(''); } } },
    ]);
    const origClose = o.close;
    o.close = () => { stopped = true; window.removeEventListener('keydown', kd, true); origClose(); };
  },
};

// ─────────────────────────────── Data management ───────────────────────────────
const DataPanel = {
  build() {
    const info = h('div.muted', { style: { fontSize: '.8rem' } }, 'Calculating storage…');
    DB.estimate().then(e => { info.textContent = e ? `Using ${fmtBytes(e.usage || 0)} of ${fmtBytes(e.quota || 0)} browser storage.` : 'Storage estimate unavailable.'; });
    const btn = (label, ic, fn, cls = '') => h(`button.btn.sm${cls}`, { onclick: fn }, icon(ic), label);
    const confirmClear = async (what, fn) => { if (await Dialog.confirm(`Clear ${what}?`, 'This cannot be undone.', { ok: 'Clear', danger: true })) { await fn(); Toast.ok(`${what[0].toUpperCase() + what.slice(1)} cleared`); } };
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, info,
      h('div.row.wrap',
        btn('Export all data', 'download', () => DataManager.exportAll()),
        btn('Import data', 'upload', () => importViaPicker('.json')),
        btn('Export settings', 'download', () => DataManager.exportSettings()),
        btn('Import settings', 'upload', async () => { const [f] = await pickFiles({ accept: '.json', multiple: false }); if (!f) return; try { const o = JSON.parse(await f.text()); await DataManager.importAll({ ...o, kind: 'settings' }); Toast.ok('Settings imported'); SettingsPanel.o && SettingsPanel.build(''); } catch (e) { Toast.err('Import failed', e.message); } }),
        btn('Keep data persistent', 'save', async () => { const ok = await DB.persist(); Toast.show(ok ? 'Storage marked persistent' : 'The browser declined persistent storage'); }),
        btn('Run first-run setup', 'sparkle', () => { SettingsPanel.close && SettingsPanel.close(); Onboarding.run({ again: true }); }),
        App.installPrompt ? btn('Install as an app', 'download', async () => { await App.install(); SettingsPanel.o && SettingsPanel.build(''); }, '.primary') : null),
      App.installed ? null : h('div.muted', { style: { fontSize: '.8rem' } }, 'Tip: install Ashtonk!mania as an app (the install icon in the address bar, or the button above when the browser offers it) for its own full-screen window. Once opened, it plays offline, and the installed app opens .osz / .osk files directly.'),
      h('div.row.wrap',
        btn('Clear scores', 'trash', () => confirmClear('scores', () => ScoreManager.clear()), '.danger'),
        btn('Clear replays', 'trash', () => confirmClear('replays', () => ReplayManager.clear()), '.danger'),
        btn('Clear beatmaps', 'trash', () => confirmClear('beatmaps', async () => { Music.stop(100); await BeatmapManager.clearAll(); }), '.danger'),
        btn('Reset everything', 'x', async () => { if (await Dialog.confirm('Reset everything?', 'Deletes all beatmaps, skins, scores, replays, collections and settings. The page will reload.', { ok: 'Reset', danger: true })) DataManager.resetEverything(); }, '.danger')));
  },
};

// ─────────────────────────────── Mod select ───────────────────────────────
const ModSelect = {
  o: null,
  open() {
    if (this.o) { this.close(); return; }
    UISounds.click();
    const sheet = h('div.modsel', { role: 'dialog', 'aria-label': 'Mod select' });
    this.sheet = sheet;
    this.render();
    this.o = makeOverlay(sheet, {
      onClose: () => { this.o = null; Bus.emit('mods:changed'); },
      onKey: e => {
        if (e.key === 'F1' || e.key === 'Enter') { this.close(); return true; }
        if (e.key === 'Backspace') { Settings.set('songselect.mods', []); this.render(); return true; }
        const m = MODS.find(x => x.key === e.code);
        if (m && !e.ctrlKey && !e.metaKey) { this.toggle(m.id); return true; }
        return false;
      },
    });
  },
  close() { if (this.o) this.o.close(); },
  toggle(id) {
    const cur = Settings.get('songselect.mods') || [];
    const next = ModSystem.toggle(cur, id);
    Settings.set('songselect.mods', next);
    UISounds.play(next.includes(id) ? 'check-on' : 'check-off');
    this.render();
    Bus.emit('mods:changed');
  },
  /** osu!lazer mod type colours. */
  GROUP_COLOURS: { reduction: '#b2ff66', increase: '#ff6666', conversion: '#8c66ff', automation: '#66ccff', fun: '#ff66ab' },
  render() {
    const sheet = this.sheet;
    const scrollX = this.colsEl ? this.colsEl.scrollLeft : 0;
    clearEl(sheet);
    const cur = Settings.get('songselect.mods') || [];
    const mult = ModSystem.multiplier(cur), rate = ModSystem.rate(cur);
    const setMods = v => { Settings.set('songselect.mods', v); this.render(); Bus.emit('mods:changed'); };
    sheet.append(h('div.modsel-head',
      h('div', h('h2', 'Mod Select'), h('div.modsel-sub', 'Mods change the way the game plays. Some affect your score multiplier.')),
      h('span.grow'),
      rate !== 1 ? h('div.modsel-stat', h('span', 'Speed'), h('b', `${rate}×`)) : null,
      h(`div.modsel-stat${mult > 1 ? '.up' : mult < 1 ? '.down' : ''}`, h('span', 'Score multiplier'), h('b', `${mult.toFixed(2)}×`))));
    const cols = h('div.modsel-cols');
    for (const [gid, gname] of MOD_GROUPS) {
      const mods = MODS.filter(x => x.group === gid);
      const n = mods.filter(m => cur.includes(m.id)).length;
      const col = h('div.modcol', { style: { '--c': this.GROUP_COLOURS[gid] || '#aaa' } },
        h('div.modcol-h', h('span', gname), n ? h('span.modcol-n', String(n)) : null));
      const list = h('div.modcol-list');
      for (const m of mods) {
        const on = cur.includes(m.id);
        const blocked = !on && cur.some(x => m.incompatible.includes(x) || (MOD_BY_ID.get(x)?.incompatible || []).includes(m.id));
        const panel = h(`button.mod-p${on ? '.on' : ''}${blocked ? '.blocked' : ''}`, {
          'aria-pressed': String(on), onclick: () => this.toggle(m.id),
          title: `${m.name} (${keyLabel(m.key)}) · ${m.mult.toFixed(2)}×${blocked ? ` · replaces ${cur.filter(x => m.incompatible.includes(x) || (MOD_BY_ID.get(x)?.incompatible || []).includes(m.id)).join(', ')}` : ''}`,
        }, h('span.mod-ac', h('span', m.id)), h('span.mod-txt', h('b', m.name), h('span', m.desc)));
        panel.addEventListener('pointerenter', () => UISounds.hover());
        list.append(panel);
      }
      col.append(list);
      cols.append(col);
      // fade the bottom edge while there are more mods below (so a cut-off row reads as "scroll for more")
      const edge = () => list.classList.toggle('more', list.scrollHeight - list.scrollTop - list.clientHeight > 4);
      list.addEventListener('scroll', edge, { passive: true });
      requestAnimationFrame(edge);
    }
    const cfgMods = cur.filter(id => MOD_BY_ID.get(id)?.config);
    if (cfgMods.length) cols.append(this.configPanel(cfgMods));
    this.colsEl = cols;
    sheet.append(cols, h('div.modsel-foot',
      backButton(() => this.close()),
      h('button.btn', { disabled: !cur.length, onclick: () => setMods([]) }, 'Deselect all'),
      h('span.grow'),
      h('span.modsel-hint', 'Tip: every mod has a letter shortcut (hover to see it) · Backspace clears'),
      h('button.btn.primary', { onclick: () => this.close() }, 'Done')));
    cols.scrollLeft = scrollX;
  },
  /** Sliders for mods with settings (Accuracy Challenge, Difficulty Adjust, Song Speed, Hidden/Fade In, Percy). */
  configPanel(ids) {
    const cfg = ModSystem.config();
    const set = (k, v) => { Settings.set('mods.config', { ...ModSystem.config(), [k]: v }); Bus.emit('mods:changed'); };
    const slider = (label, k, min, max, step, fmt) => {
      const s = h('input.slider', { type: 'range', min, max, step, value: cfg[k] });
      const val = h('span.val', fmt(+cfg[k]));
      const upd = () => { s.style.setProperty('--p', ((s.value - min) / (max - min) * 100) + '%'); val.textContent = fmt(+s.value); };
      s.addEventListener('input', () => { upd(); set(k, +s.value); });
      s.addEventListener('keydown', e => e.stopPropagation());
      upd();
      return h('div.set-row.col', h('div.row', h('div.lbl', label), val), h('div.ctl', s));
    };
    const rows = [];
    if (ids.includes('AC')) rows.push(slider('Accuracy Challenge — minimum accuracy', 'acc', 0.6, 0.99, 0.01, v => `${Math.round(v * 100)}%`));
    if (ids.includes('DA')) rows.push(slider('Difficulty Adjust — overall difficulty (OD)', 'od', 0, 10, 0.1, v => v.toFixed(1)), slider('Difficulty Adjust — HP drain', 'hp', 0, 10, 0.1, v => v.toFixed(1)));
    if (ids.includes('RT')) rows.push(slider('Song Speed — playback rate', 'rate', 0.5, 2, 0.05, v => `${v.toFixed(2)}×`));
    if (ids.includes('HD') || ids.includes('FI')) rows.push(slider(`${ids.includes('HD') ? 'Hidden' : 'Fade In'} — lane coverage`, 'cover', 0.1, 0.9, 0.05, v => `${Math.round(v * 100)}%`));
    if (ids.includes('PC')) rows.push(slider('Percy — long note tail cut-off', 'percy', 0, 500, 10, v => `${v}ms`));
    return h('div.modcol.mod-config', { style: { '--c': '#ffcc22' } }, h('div.modcol-h', h('span', 'Customise')), h('div.modcol-list', ...rows));
  },
};

