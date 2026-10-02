/* Settings panel (schema-driven), key configuration, offset calibration and the mod select overlay. */

const SECTION_ICONS = { Gameplay: 'target', Audio: 'volume', Graphics: 'sparkle', Input: 'keyboard', 'User Interface': 'home', Skin: 'brush', Maintenance: 'database' };

/** The settings shown by default; everything else sits behind "Show all settings" (search always finds it). */
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
      h('div.sp-main', h('div.sp-head', h('div.row', h('div', h('h2', 'settings'), h('div.sub', `change the way ${APP_NAME} behaves`)), h('span.grow'), h('button.icon-btn', { title: 'Close (Esc)', onclick: () => this.close() }, icon('x'))),
        h('div.sp-searchbox', icon('search'), search)), scroll));
    this.scrollEl = scroll; this.nav = nav;
    this.build('');
    search.addEventListener('input', () => this.build(search.value.trim().toLowerCase()));
    search.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
    scroll.addEventListener('scroll', () => this.syncNav());
    // picking another skin shows or hides the Custom skin's options
    const offSkin = Bus.on('skin:changed', () => { if (this.o && this.scrollEl) { const st = this.scrollEl.scrollTop; this.build(this.q || ''); this.scrollEl.scrollTop = st; } });
    this.o = makeOverlay(panel, { onClose: () => { offSkin(); this.o = null; KeyConfig.stop(); window.removeEventListener('keydown', this._type, true); Toolbar.sync(); } });
    Toolbar.sync();
    requestAnimationFrame(() => { if (section) this.scrollTo(section); else this.syncNav(); });
    // like lazer, the search box has focus as soon as the panel opens, and typing anywhere else in it goes there too
    // (it used to fall through to whatever screen was behind, e.g. song select's search)
    search.focus({ preventScroll: true });
    this._type = e => {
      const t = e.target;
      if (Overlays.top() !== this.o || t === search || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ' || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable || KeyConfig.listening) return;
      search.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', this._type, true);
  },
  close() { if (this.o) { UISounds.back(); this.o.close(); } },
  scrollTo(sec) {
    const sc = this.scrollEl, el = sc && sc.querySelector(`[data-section="${sec}"]`);
    // measured on screen (offsetTop counts from the panel, not the list, and overshot past the section's heading)
    if (el) sc.scrollTo({ top: sc.scrollTop + (el.getBoundingClientRect().top - sc.getBoundingClientRect().top) * Zoom.z - 8, behavior: 'smooth' });
  },
  /** Highlight the section being read. (Measured on screen: before the panel is shown every section sits at 0,
   *  which used to light up the last icon.) */
  syncNav() {
    const el = this.scrollEl, secs = $$('.sp-section', el);
    let cur = secs[0]?.dataset.section;
    if (el.isConnected && el.clientHeight) {
      const top = el.getBoundingClientRect().top;
      for (const s of secs) if (s.getBoundingClientRect().top - top < 80) cur = s.dataset.section;
    }
    $$('[data-sec]', this.nav).forEach(b => b.classList.toggle('active', b.dataset.sec === cur));
  },
  build(q) {
    this.q = q;
    const scroll = this.scrollEl;
    clearEl(scroll);
    const bySec = new Map();
    for (const it of SETTINGS_SCHEMA) {
      if (!it.s || it.x) continue; // (x: kept working at its value, but no longer offered in the panel)
      if (it.when && !it.when()) continue; // (options that don't apply right now, and their heading, aren't shown)
      if (q && !(`${it.s} ${it.g} ${it.l} ${it.hint || ''}`.toLowerCase().includes(q))) continue;
      if (!bySec.has(it.s)) bySec.set(it.s, new Map());
      const g = bySec.get(it.s);
      if (!g.has(it.g)) g.set(it.g, []);
      g.get(it.g).push(it);
    }
    for (const [sec, groups] of bySec) {
      const secEl = h('div.sp-section', { dataset: { section: sec } }, h('h3', sec));
      for (const [g, items] of groups) {
        secEl.append(h('div.sp-group', g));
        for (const it of items) secEl.append(this.row(it));
      }
      scroll.append(secEl);
    }
    if (!bySec.size) scroll.append(h('div.empty', 'No settings match your search.'));
    scroll.append(h('div.sp-footer', `${APP_NAME} v${APP_VERSION} · ${WhatsNew.latest()}`, h('button.btn.sm.ghost', { onclick: () => WhatsNew.show() }, icon('sparkle'), 'What\'s new')));
    clearEl(this.nav).append(...[...bySec.keys()].map(sec => h('button.sp-nb', { 'aria-label': sec, dataset: { sec }, onclick: () => { UISounds.click(); this.scrollTo(sec); } }, h('span.sp-nb-ind'), icon(SECTION_ICONS[sec] || 'gear'), h('span', sec.toLowerCase()))));
    this.syncNav();
  },
  /** One setting as osu!lazer's form controls (SettingsItemV2): a rounded box with the caption inside, the control on
   *  the right (switch), right half (slider) or underneath (dropdown / text), and the slim revert-to-default pill just
   *  outside the box on the right when the value isn't the default. */
  row(it) {
    const val = () => Settings.get(it.k);
    const isDefault = () => JSON.stringify(Settings.get(it.k)) === JSON.stringify(it.d);
    const reset = h('button.reset', { title: 'Revert to default', 'aria-label': `Revert ${it.l} to default`, onclick: e => { e.stopPropagation(); Settings.set(it.k, structuredClone(it.d)); UISounds.click(); rebuild(); } });
    const updReset = () => reset.classList.toggle('show', !isDefault());
    const cap = h('div.lbl', it.l, it.hint ? h('div.hint', it.hint) : null);
    let row;
    const rebuild = () => { const n = this.row(it); row.replaceWith(n); };
    const form = (cls, ...kids) => h(`div.set-row.form.${cls}`, ...kids, reset);
    if (it.when && !it.when()) return h('div', { hidden: true });
    switch (it.t) {
      case 'bool': {
        const t = h(`button.toggle${val() ? '.on' : ''}`, { role: 'switch', 'aria-checked': String(!!val()), 'aria-label': it.l, onclick: e => {
          e.stopPropagation();
          const v = !val(); Settings.set(it.k, v); t.classList.toggle('on', v); t.setAttribute('aria-checked', String(v)); UISounds.play(v ? 'check-on' : 'check-off'); updReset();
        } });
        row = form('fbool', cap, t);
        row.addEventListener('click', () => t.click());
        break;
      }
      case 'range': {
        const s = h('input.slider', { type: 'range', min: it.min, max: it.max, step: it.step, value: val(), 'aria-label': it.l });
        const v = h('div.val');
        const upd = () => { const x = parseFloat(s.value); v.textContent = it.fmt ? it.fmt(x) : x; s.style.setProperty('--p', ((x - it.min) / (it.max - it.min) * 100) + '%'); };
        s.addEventListener('input', () => { Settings.set(it.k, parseFloat(s.value)); upd(); updReset(); });
        s.addEventListener('keydown', e => e.stopPropagation());
        upd();
        row = form('frange', h('div.fleft', cap, v,
          it.calibrate ? h('button.btn.sm.fcal', { onclick: () => Calibration.open() }, 'Calibrate') : null), h('div.fright', s));
        break;
      }
      case 'select': {
        const sel = h('select.select', { 'aria-label': it.l }, ...it.o.map(([k, l]) => h('option', { value: k, selected: String(val()) === String(k) }, l)));
        sel.addEventListener('change', () => {
          Settings.set(it.k, it.num ? Number(sel.value) : sel.value); UISounds.click(); updReset();
          if (SETTINGS_SCHEMA.some(x => x.when && x.s === it.s)) { const st = this.scrollEl.scrollTop; this.build(this.q || ''); this.scrollEl.scrollTop = st; }
        });
        row = form('fsel', cap, sel);
        break;
      }
      case 'text': {
        const inp = h('input.input', { value: val() });
        inp.addEventListener('change', () => { Settings.set(it.k, inp.value); updReset(); });
        inp.addEventListener('keydown', e => e.stopPropagation());
        row = form('fsel', cap, inp);
        break;
      }
      case 'keybinds': row = form('fwide', cap, KeyConfig.build()); break;
      case 'skin': {
        const sel = h('select.select', { 'aria-label': 'Skin' }, ...SkinManager.list().map(s => h('option', { value: s.id, selected: s.id === SkinManager.current.id }, s.name)));
        sel.addEventListener('change', async () => { await SkinManager.select(sel.value); Toast.ok('Skin selected', SkinManager.current.name); });
        row = form('fsel', cap, h('div.fline', sel, h('button.btn.sm', { onclick: () => { this.close(); Screens.go('skins'); } }, 'Browse')));
        break;
      }
      case 'data': row = form('fwide', cap, DataPanel.build()); break;
      case 'shortcuts': row = form('fbool', cap, h('button.btn.sm', { onclick: () => Shortcuts.open() }, icon('keyboard'), 'Show all')); break;
      case 'mascot': row = form('fwide', cap, h('div.fline',
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
    // one compact key-count stepper (as on the Skins page) instead of eighteen chips
    const go = k => { this.keys = clamp(k, 1, MAX_KEYS); this.listening = null; UISounds.click(); this.render(); };
    root.append(h('div.sk-keys.keycfg-modes',
      h('button.sk-step', { 'aria-label': 'Fewer keys', disabled: this.keys <= 1, onclick: () => go(this.keys - 1) }, icon('back')),
      h('span.sk-k', `${this.keys}K`),
      h('button.sk-step', { 'aria-label': 'More keys', disabled: this.keys >= MAX_KEYS, onclick: () => go(this.keys + 1) }, icon('chevron'))));
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

// ─────────────────────────────── Keyboard shortcuts ───────────────────────────────
/** Every shortcut in one place (press ? anywhere outside a text field, or Settings → Input). */
const Shortcuts = {
  // keys: each entry is a key cap; "~text" is plain text between them
  GROUPS: [
    ['Anywhere', [
      [['Ctrl', 'O'], 'Settings'], [['Esc'], 'Back / close'], [['Alt', 'Enter'], 'Fullscreen'],
      [['Alt', '~+ mouse wheel'], 'Volume (add Shift: music, Ctrl: effects)'], [['Alt', '↑', '↓'], 'Volume'], [['Alt', '←', '→'], 'Effects / master / music'],
      [['Alt', 'Home'], 'Main menu'], [['Ctrl', 'B'], 'Beatmap listing'], [['Ctrl', 'N'], 'Notifications'], [['Ctrl', 'P'], 'Profile'], [['F6'], 'Now playing'],
      [['Ctrl', 'Shift', 'R'], 'Random skin'], [['Ctrl', 'Shift', 'E', 'T'], 'Previous / next skin'], [['Mouse back button'], 'Back'], [['Ctrl', 'Shift', 'D'], 'Debug overlay'], [['?'], 'This list']]],
    ['Main menu', [
      [['~any key'], 'Open the menu from the big logo'], [['P'], 'Play'], [['P', 'M'], 'Solo, Multi (after Play)'], [['L', 'R'], 'Lounge, Ranked Play (after Multi)'], [['E'], 'Edit'], [['S', 'I', 'B', 'C', 'R'], 'Skins, Import, Beatmaps, Collections, Replays (after Edit)'], [['B'], 'Browse beatmaps online'],
      [['U'], 'Profile'], [['O'], 'Settings'], [['←', '→', 'Enter'], 'Move and press']]],
    ['Song select', [
      [['~type'], 'Search — filters: keys=7 stars>4 bpm>180 od>8 length<120 ln>30'], [['↑', '↓'], 'Difficulty'], [['←', '→'], 'Beatmap set'],
      [['PgUp', 'PgDn'], 'Jump 5 sets'], [['Enter'], 'Play'], [['Ctrl', 'Enter'], 'Watch Auto'], [['F1'], 'Mods (each has a letter; Backspace clears)'],
      [['Ctrl', '↑', '↓'], 'Play speed ±0.05× (Song Speed)'], [['F2'], 'Random'], [['Shift', 'F2'], 'Back to the previous random pick'], [['F3'], 'Options'], [['F4'], 'Practice'], [['Shift', 'Delete'], 'Delete the set'], [['Right mouse'], 'Hold beside the list to scroll to that point']]],
    ['Playing', [
      [['~your lane keys'], 'Settings → Input → Key configuration'], [['Esc'], 'Pause'], [['~hold', 'R', '~or', '`'], 'Retry'],
      [['Space'], 'Skip the intro'], [['Tab'], 'Leaderboard on / off'], [['Shift', 'Tab'], 'Hide the HUD'], [['F3', 'F4', '~or', 'Ctrl', '−', '+'], 'Scroll speed'],
      [['−', '+'], 'Beatmap offset ∓1 ms (before the first note or paused)'], [['~hold', 'Ctrl', '`'], 'Quit'], [['Middle mouse'], 'Pause'], [['~hold', 'Ctrl'], 'Show the hidden HUD']]],
    ['Practice', [
      [['[', ']'], 'Loop start / end'], [['\\'], 'Clear the loop'], [['Backspace'], 'Restart the section'], [['−', '='], 'Audio offset −5 / +5 ms'], [['←', '→'], 'Seek 5 seconds']]],
    ['Watching a replay or Auto', [
      [['Space'], 'Pause / play'], [['←', '→'], 'Seek 5 seconds'], [['↓', '↑'], 'Playback speed'], [['Esc'], 'Pause menu']]],
    ['Results', [
      [['R', 'Enter', 'Space'], 'Retry'], [['Esc'], 'Back to song select']]],
  ],
  open() {
    if (this.o) return;
    UISounds.click();
    const keys = list => h('span.sc-keys', ...list.map(k => k[0] === '~' ? h('span.muted', k.slice(1)) : h('span.kbd', k)));
    const body = h('div.shortcuts', ...this.GROUPS.map(([title, rows]) => h('div.sc-group', h('h3', title),
      ...rows.map(([k, what]) => h('div.sc-row', keys(k), h('span.sc-what', what))))));
    this.o = Dialog.custom('Keyboard shortcuts', body, [{ label: 'Close', primary: true }]);
    const close = this.o.close;
    this.o.close = () => { this.o = null; close(); };
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
        btn('Import Web-Osu-Mania backup', 'upload', () => WomImport.pickAndImport()),
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
    if (this.o && this.sheet) this.render(); // (also callable with the panel closed)
    Bus.emit('mods:changed');
  },
  /** osu!lazer mod type colours. */
  GROUP_COLOURS: { reduction: '#b2ff66', increase: '#ff6666', conversion: '#8c66ff', automation: '#66ccff', fun: '#ff66ab' },
  render() {
    const sheet = this.sheet;
    const scrollX = this.colsEl ? this.colsEl.scrollLeft : 0;
    // each toggle redraws the sheet: keep every column where it was scrolled (it used to jump back to the top)
    const tops = this.colsEl ? [...this.colsEl.querySelectorAll('.modcol-list')].map(l => l.scrollTop) : [];
    const hadCfg = !!(this.colsEl && this.colsEl.querySelector('.mod-config'));
    clearEl(sheet);
    const cur = Settings.get('songselect.mods') || [];
    const mult = ModSystem.multiplier(cur), rate = ModSystem.rate(cur);
    const setMods = v => { Settings.set('songselect.mods', v); this.render(); Bus.emit('mods:changed'); };
    sheet.append(h('div.modsel-head',
      h('div', h('h2', 'Mod Select'), h('div.modsel-sub', 'Mods provide different ways to enjoy gameplay. Some have an effect on the score you can achieve during ranked play. Others are just for fun.')),
      h('span.grow')));
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
        }, h('span.mod-ac', modIcon(m.id, 44)), h('span.mod-txt', h('b', m.name, h('small.mod-id', m.id)), h('span', m.desc)));
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
    // lazer's footer: the back button, a 200px sheared "Deselect all" (Backspace), and at the right the speed and score
    // multiplier in a sheared two-part box (ModFooterInformationDisplay)
    const info = (label, value, cls = '') => h(`div.ms-info${cls}`, h('span.ms-info-l', h('i', label)), h('span.ms-info-r', h('i', value)));
    sheet.append(cols, h('div.modsel-foot',
      backButton(() => this.close()),
      h('button.sh-btn.ms-deselect', { disabled: !cur.length, title: 'Backspace', onclick: () => { UISounds.click(); setMods([]); } }, h('span', 'Deselect all')),
      h('span.grow'),
      rate !== 1 ? info('Speed', `${rate}x`) : null,
      info('Score multiplier', `${mult.toFixed(2)}x`, mult > 1 ? '.up' : mult < 1 ? '.down' : '')));
    cols.scrollLeft = scrollX;
    [...cols.querySelectorAll('.modcol-list')].forEach((l, i) => { if (tops[i]) l.scrollTop = tops[i]; });
    // the Customise column is added past the right edge on smaller screens: bring it into view when it appears
    if (cfgMods.length && !hadCfg) requestAnimationFrame(() => { if (cols.scrollWidth > cols.clientWidth) cols.scrollTo({ left: cols.scrollWidth, behavior: Settings.get('ui.animSpeed') > 0 ? 'smooth' : 'auto' }); });
    // lazer's columns scroll sideways with the wheel when they don't all fit (a column with more mods still scrolls itself)
    cols.addEventListener('wheel', e => {
      if (cols.scrollWidth <= cols.clientWidth + 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const list = e.target.closest && e.target.closest('.modcol-list');
      if (list && list.scrollHeight > list.clientHeight + 1) return;
      cols.scrollLeft += e.deltaY; e.preventDefault();
    }, { passive: false });
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

