/* First-run setup — an osu!lazer-style wizard shown the first time the client opens (and from Settings →
 * Maintenance → "Run first-run setup"). It asks who the player is, how much osu! they've played, what they're
 * playing on, how the game should look and feel, and which skin to use. Every choice applies immediately
 * (the previews are live) and stays editable in Settings. */

const SETUP_EXPERIENCE = {
  new: { label: 'I\'m new', sub: 'Never played osu!mania or a key-based rhythm game.', icon: 'sparkle',
    tip: 'Notes fall slower and an input display shows your keys. Speed up as you get better!',
    values: { 'gameplay.scrollSpeed': 16, 'gameplay.hitErrorBar': false, 'input.keyOverlay': true, 'gameplay.judgementCounter': false, 'gameplay.kpsCounter': false, 'ui.allSettings': false } },
  some: { label: 'A little', sub: 'Played osu!mania, Quaver, Etterna or similar casually.', icon: 'music',
    tip: 'Standard settings — a comfortable scroll speed and a clean HUD.',
    values: { 'gameplay.scrollSpeed': 22, 'gameplay.hitErrorBar': false, 'input.keyOverlay': false, 'gameplay.judgementCounter': false, 'gameplay.kpsCounter': false, 'ui.allSettings': false } },
  pro: { label: 'osu! veteran', sub: 'I know my scroll speed, my skin and my keybinds.', icon: 'star',
    tip: 'Hit error bar, judgement and KPS counters on, and every advanced setting unlocked.',
    values: { 'gameplay.scrollSpeed': 28, 'gameplay.hitErrorBar': true, 'input.keyOverlay': false, 'gameplay.judgementCounter': true, 'gameplay.kpsCounter': true, 'ui.allSettings': true } },
};

/** Render scale that keeps the playfield canvas at (at most) one pixel per CSS pixel — the cheapest setting
 *  that still looks sharp on a Chromebook's high-DPI panel. */
const lowEndRenderScale = () => clamp(Math.round(20 / (window.devicePixelRatio || 1)) / 20, 0.5, 1);

const SETUP_DEVICES = {
  high: { label: 'Good PC', sub: 'Gaming PC or a fast laptop. Everything on.', icon: 'sparkle',
    values: () => ({ 'graphics.performanceMode': false, 'graphics.particles': true, 'graphics.effects': true, 'gameplay.hitLighting': true, 'skin.effects': true, 'gameplay.comboEffects': true,
      'graphics.bgQuality': 'high', 'gameplay.video': true, 'graphics.renderScale': 1, 'graphics.menuBlur': 12, 'ui.parallax': true }) },
  mid: { label: 'Normal laptop', sub: 'Most laptops. Particles and videos off, the rest on.', icon: 'gear',
    values: () => ({ 'graphics.performanceMode': false, 'graphics.particles': false, 'graphics.effects': true, 'gameplay.hitLighting': true, 'skin.effects': true, 'gameplay.comboEffects': true,
      'graphics.bgQuality': 'high', 'gameplay.video': false, 'graphics.renderScale': 1, 'graphics.menuBlur': 8, 'ui.parallax': true }) },
  low: { label: 'Chromebook / slow PC', sub: 'School Chromebooks and older laptops. Smoothness first.', icon: 'target',
    values: () => ({ 'graphics.performanceMode': true, 'graphics.bgQuality': 'low', 'gameplay.video': false, 'graphics.renderScale': lowEndRenderScale(),
      'graphics.menuBlur': 0, 'ui.parallax': false }) },
};

const SETUP_THEMES = [['lazer', '#ff66ab', 'osu! pink'], ['kori', '#aa88ff', 'Kori purple'], ['neru', '#ffcf3a', 'Neru yellow'], ['teto', '#ff4d6a', 'Teto red'], ['miku', '#39c5bb', 'Miku teal'], ['midnight', '#66ccff', 'Midnight blue']];

const Onboarding = {
  STEPS: [
    { id: 'welcome', title: 'Welcome', sub: 'Let\'s get you set up — it only takes a minute.' },
    { id: 'experience', title: 'Your experience', sub: 'Have you played osu! before?' },
    { id: 'device', title: 'Your device', sub: 'What are you playing on?' },
    { id: 'look', title: 'Personalise', sub: 'Make it yours.' },
    { id: 'gameplay', title: 'Gameplay', sub: 'Scroll speed, background and keys — try them live.' },
    { id: 'skin', title: 'Skin', sub: 'Pick how the notes look, or bring your own.' },
    { id: 'done', title: 'All set', sub: 'You\'re ready to play.' },
  ],

  /** Runs the wizard. Resolves once it is finished or skipped. `again`: opened from Settings (name is kept). */
  run({ again = false } = {}) {
    if (this.o) return this.done;
    this.done = new Promise(resolve => {
      this.resolve = resolve;
      this.again = again;
      this.i = 0;
      this.dir = 1;
      this.choice = { exp: null, device: null };
      this.bench = null;
      this.animate = true;
      this.el = h('div.onboarding.setup', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'First-run setup' });
      this.o = makeOverlay(this.el, {
        dismissable: false,
        onKey: e => {
          if (this.capture) return true;
          if (e.key === 'Escape') return true; // the wizard is closed with its own buttons only
          if (e.key === 'Enter' && !(e.target.closest && e.target.closest('button, input, select'))) { this.next(); return true; }
          return false;
        },
      });
      this.render();
    });
    return this.done;
  },

  get step() { return this.STEPS[this.i]; },

  render() {
    this.stopPreview();
    const st = this.step;
    const last = this.i === this.STEPS.length - 1;
    const nextStep = this.STEPS[this.i + 1];
    const body = h(`div.setup-body.setup-step-${st.id}${this.animate ? '.anim' : ''}`, { style: { '--dir': this.dir } }, ...[].concat(this['step_' + st.id]()));
    this.animate = false;
    this.nextBtn = h('button.btn.primary.setup-next', { onclick: () => this.next() },
      last ? 'Let\'s play!' : `Next${nextStep ? ': ' + nextStep.title : ''}`, icon(last ? 'play' : 'chevron'));
    clearEl(this.el).append(
      h('div.setup-head',
        h('div.setup-kicker', this.again ? 'Setup' : 'First-run setup', h('span', `Step ${this.i + 1} of ${this.STEPS.length}`)),
        h('div.setup-title', h('h2', st.title), h('div.setup-sub', st.sub)),
        h('div.setup-progress', ...this.STEPS.map((s, k) => h(`button.setup-dot${k === this.i ? '.on' : k < this.i ? '.past' : ''}`, {
          title: s.title, 'aria-label': s.title, disabled: k > this.i && !this.canLeave(), onclick: () => this.go(k) })))),
      body,
      h('div.setup-foot',
        this.i > 0 ? h('button.btn.ghost', { onclick: () => this.go(this.i - 1) }, icon('back'), 'Back') : null,
        this.i > 0 && !last ? h('button.btn.ghost.ob-skip', { onclick: () => this.finish(true) }, 'Skip the rest') : null,
        h('span.grow'),
        this.err = h('div.ob-err'),
        this.nextBtn));
    this.afterRender && this.afterRender();
    this.afterRender = null;
  },

  canLeave() {
    if (this.step.id === 'welcome') return !!(this.nameEl && this.nameEl.value.trim());
    return true;
  },
  async go(k) {
    if (k === this.i || k < 0 || k >= this.STEPS.length) return;
    if (k > this.i && !(await this.commit())) return;
    this.dir = k > this.i ? 1 : -1;
    this.i = k;
    this.animate = true;
    UISounds.click();
    this.render();
  },
  next() {
    if (this.i === this.STEPS.length - 1) this.finish(false);
    else this.go(this.i + 1);
  },
  /** Validate / save the current step before moving on. */
  async commit() {
    if (this.step.id === 'welcome') {
      const n = this.nameEl.value.trim();
      if (!n) { this.err.textContent = 'Pick a name — it shows on your scores, replays and profile.'; this.nameEl.focus(); return false; }
      if (n !== ProfileManager.profile.name) await ProfileManager.setName(n);
      Toolbar.updateProfile();
    }
    return true;
  },
  async finish(skipped) {
    if (!(await this.commit())) return;
    const p = ProfileManager.profile;
    const first = !p.onboarded;
    p.onboarded = true;
    await ProfileManager.save();
    await Settings.flush();
    Toolbar.updateProfile();
    this.stopPreview();
    UISounds.click();
    const o = this.o;
    this.o = null;
    o.close();
    if (first) Toast.show(`Welcome, ${p.name}!`, skipped ? 'You can run the setup again from Settings → Maintenance.' : 'Your plays earn pp — check your profile after a few maps.');
    const then = this.then; this.then = null;
    this.resolve();
    if (then) then();
  },

  // ─────────────────────────────── steps ───────────────────────────────
  step_welcome() {
    const p = ProfileManager.profile;
    this.nameEl = h('input.input.ob-name', { value: p.onboarded || this.again ? p.name : '', placeholder: 'Your name', maxlength: 24, 'aria-label': 'Your name', autocomplete: 'nickname' });
    this.nameEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); this.next(); } });
    this.nameEl.addEventListener('input', () => { this.err.textContent = ''; });
    this.afterRender = () => setTimeout(() => this.nameEl && this.nameEl.focus(), 60);
    return [
      h('div.setup-logo', h('span.lz-cookie-disc', h('span.lz-cookie-text', 'ashtonk!', h('small', 'mania')))),
      h('div.setup-hello', 'Welcome to Ashtonk!mania'),
      h('p.setup-lead', 'A free osu!mania-style rhythm game that runs right in your browser. We\'ll ask a few quick questions to tune the game to you and your device.'),
      h('label.setup-label', 'What should we call you?'),
      this.nameEl,
      h('p.setup-note', 'Your name appears on your scores, replays, profile and in multiplayer rooms.'),
    ];
  },

  choiceCards(options, current, onPick, extra = () => null) {
    return h('div.setup-choices', ...Object.entries(options).map(([id, o]) =>
      h(`button.setup-choice${current === id ? '.on' : ''}`, { dataset: { id }, onclick: () => onPick(id) },
        h('span.setup-choice-ic', icon(o.icon)),
        h('span.setup-choice-t', o.label),
        h('span.setup-choice-s', o.sub),
        extra(id),
        h('span.setup-check', icon('check')))));
  },

  step_experience() {
    const cur = this.choice.exp;
    const pick = id => {
      this.choice.exp = id;
      for (const [k, v] of Object.entries(SETUP_EXPERIENCE[id].values)) Settings.set(k, v);
      UISounds.play('check-on');
      this.render();
    };
    return [
      this.choiceCards(SETUP_EXPERIENCE, cur, pick),
      h('div.setup-tip', icon('info'), cur ? SETUP_EXPERIENCE[cur].tip : 'Pick one — this sets sensible defaults you can fine-tune on the next pages.'),
      cur === 'pro' ? h('div.setup-tip.alt', icon('upload'), 'Coming from osu!? Drag your .osz beatmaps and .osk skins anywhere onto this window — you can also import skins in a couple of steps.') : null,
      h('div.setup-keys-help',
        h('div.setup-mini-t', 'How to play'),
        h('div.setup-howto',
          h('div', h('b', '1'), 'Notes fall down the lanes toward the line at the bottom.'),
          h('div', h('b', '2'), h('span', 'Press the lane\'s key (', h('kbd', 'D'), h('kbd', 'F'), h('kbd', 'J'), h('kbd', 'K'), ' for 4 keys) as each note reaches the line.')),
          h('div', h('b', '3'), 'Hold the key through long notes, and let go at the end.'))),
    ];
  },

  step_device() {
    const cur = this.choice.device;
    const rec = this.recommendDevice();
    const pick = id => {
      this.choice.device = id;
      for (const [k, v] of Object.entries(SETUP_DEVICES[id].values())) Settings.set(k, v);
      UISounds.play('check-on');
      this.render();
    };
    const detected = h('div.setup-detect');
    const paintDetect = () => {
      const b = this.bench;
      clearEl(detected).append(icon('chart'), h('span',
        h('b', 'Detected: '),
        [this.isChromebook() ? 'ChromeOS' : null,
          navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} CPU threads` : null,
          navigator.deviceMemory ? `${navigator.deviceMemory} GB+ memory` : null,
          b ? `~${Math.round(b.fps)} fps in the browser` : 'measuring frame rate…'].filter(Boolean).join(' · ')));
    };
    paintDetect();
    if (!this.bench) this.benchmark().then(() => { if (this.step.id === 'device') this.render(); });
    return [
      this.choiceCards(SETUP_DEVICES, cur, pick, id => id === rec ? h('span.setup-rec', 'Recommended') : null),
      detected,
      cur ? h('div.setup-changes', h('div.setup-mini-t', 'What this sets'), h('div.setup-sums.left', ...this.describeDevice(cur).map(t => h('span.setup-sum', icon('check'), t)))) : null,
      h('div.setup-tip', icon('info'), cur === 'low'
        ? 'Performance mode is on: no particles, hit lighting or menu blur, a lighter background and a render scale that fits your screen. The game will feel much smoother.'
        : cur ? 'You can switch individual effects in Settings → Graphics at any time.' : 'Not sure? Go with the recommended option — you can always change it.'),
    ];
  },

  describeDevice(id) {
    const v = SETUP_DEVICES[id].values();
    const perf = v['graphics.performanceMode'];
    return [
      perf ? 'Performance mode on' : null,
      perf || !v['graphics.particles'] ? 'Particles off' : 'Particles on',
      perf ? 'Hit lighting off' : 'Hit lighting on',
      v['gameplay.video'] ? 'Background videos on' : 'Background videos off',
      v['graphics.bgQuality'] === 'low' ? 'Light backgrounds' : 'Full-quality backgrounds',
      v['graphics.menuBlur'] ? `Menu blur ${v['graphics.menuBlur']}px` : 'Menu blur off',
      `Render scale ${Math.round(v['graphics.renderScale'] * 100)}%`,
      v['ui.parallax'] ? 'Parallax on' : 'Parallax off',
    ].filter(Boolean);
  },

  step_look() {
    const theme = Settings.get('ui.theme');
    const scale = Settings.get('ui.scale');
    const toggle = (k, label, sub) => {
      const t = h(`button.toggle${Settings.get(k) ? '.on' : ''}`, { role: 'switch', 'aria-checked': String(!!Settings.get(k)), 'aria-label': label, onclick: () => {
        const v = !Settings.get(k); Settings.set(k, v); t.classList.toggle('on', v); t.setAttribute('aria-checked', String(v)); UISounds.play(v ? 'check-on' : 'check-off');
      } });
      return h('div.setup-row', h('div', h('div.setup-row-t', label), sub ? h('div.setup-row-s', sub) : null), t);
    };
    const avatar = ProfileManager.avatarEl(64);
    return [
      h('div.setup-grid2',
        h('div.setup-card',
          h('div.setup-mini-t', 'Accent colour'),
          h('div.setup-swatches', ...SETUP_THEMES.map(([id, c, name]) => h(`button.setup-swatch${theme === id ? '.on' : ''}`, {
            style: { '--c': c }, title: name, 'aria-label': name, onclick: () => { Settings.set('ui.theme', id); UISounds.click(); this.render(); } }, h('i'), h('span', name)))),
          h('div.setup-mini-t', { style: { marginTop: '18px' } }, 'Interface size'),
          h('div.setup-seg', ...[[0.9, 'Small'], [1, 'Normal'], [1.15, 'Large'], [1.3, 'Huge']].map(([v, l]) =>
            h(`button${Math.abs(scale - v) < 0.01 ? '.on' : ''}`, { onclick: () => { Settings.set('ui.scale', v); UISounds.click(); this.render(); } }, l)))),
        h('div.setup-card',
          h('div.setup-mini-t', 'Profile'),
          h('div.setup-profile', avatar,
            h('div', h('div.setup-row-t', ProfileManager.profile.name || 'Player'),
              h('div.row', { style: { gap: '6px', marginTop: '6px' } },
                h('button.btn.sm', { onclick: async () => { const [f] = await pickFiles({ accept: 'image/*', multiple: false }); if (f) { await ProfileManager.setAvatar('custom', f); Toolbar.updateProfile(); this.render(); } } }, icon('upload'), 'Upload picture'),
                ProfileManager.profile.avatar === 'custom' ? h('button.btn.sm.ghost', { onclick: async () => { await ProfileManager.setAvatar('default'); Toolbar.updateProfile(); this.render(); } }, 'Remove') : null))),
          // (performance mode forces interface sounds off, so the switch would do nothing there)
          Settings.values['graphics.performanceMode'] ? null : toggle('audio.uiSounds', 'Interface sounds', 'Clicks and whooshes in the menus.'),
          toggle('ui.parallax', 'Background parallax', 'The menu background follows your mouse.'),
          toggle('ui.unicodeMetadata', 'Original-language titles', 'Show song names like 夜に駆ける instead of Yoru ni Kakeru.')),
        h('div.setup-card.wide',
          h('div.setup-mini-t', 'Volume'),
          h('div.setup-vols',
            this.slider('audio.master', 'Master', 0, 1, 0.01, v => `${Math.round(v * 100)}%`),
            this.slider('audio.music', 'Music', 0, 1, 0.01, v => `${Math.round(v * 100)}%`),
            this.slider('audio.effects', 'Effects', 0, 1, 0.01, v => `${Math.round(v * 100)}%`)))),
    ];
  },

  step_gameplay() {
    const fmtSpeed = v => `${v} · ${Math.round(11485 / v)}ms`;
    const bg = h('div.setup-pv-bg', { style: { backgroundImage: `url("${this.previewArt()}")` } });
    const dim = h('div.setup-pv-dim');
    const canvas = h('canvas');
    const pv = h('div.setup-pv', bg, dim, canvas, h('div.setup-pv-label', 'Live preview'));
    const applyBg = () => {
      const w = pv.clientWidth || 360;
      bg.style.filter = `blur(${(Settings.get('gameplay.bgBlur') * 50 * w / 1920 * 2.2).toFixed(1)}px)`;
      dim.style.opacity = Settings.get('gameplay.bgDim');
    };
    const slider = (...a) => this.slider(...a);
    const dirSeg = h('div.setup-seg', ...[['down', 'Downscroll'], ['up', 'Upscroll']].map(([v, l]) =>
      h(`button${Settings.get('gameplay.scrollDirection') === v ? '.on' : ''}`, { onclick: e => {
        Settings.set('gameplay.scrollDirection', v); UISounds.click();
        for (const b of e.currentTarget.parentNode.children) b.classList.toggle('on', b === e.currentTarget);
        this.preview && this.preview.renderer.resize(true);
      } }, l)));
    const offset = h('b', `${Settings.get('audio.offset')}ms`);
    const offOff = Bus.on('settings:changed', k => { if (k === 'audio.offset') offset.textContent = `${Settings.get('audio.offset')}ms`; });
    this.cleanup.push(offOff);
    this.afterRender = () => {
      applyBg();
      this.preview = new SkinPreview(canvas, { scrollSpeed: true });
      requestAnimationFrame(() => this.preview && this.preview.show(SkinManager.current, 4));
    };
    return [
      h('div.setup-split',
        pv,
        h('div.setup-card.setup-controls',
          slider('gameplay.scrollSpeed', 'Scroll speed', 1, 40, 1, fmtSpeed),
          h('div.setup-hint', 'Higher = notes move faster and appear later. Most players use 18–30.'),
          h('div.row', { style: { gap: '10px', alignItems: 'center', margin: '4px 0 10px' } }, h('span.setup-row-t', 'Direction'), h('span.grow'), dirSeg),
          slider('gameplay.bgDim', 'Background dim', 0, 1, 0.01, v => `${Math.round(v * 100)}%`, applyBg),
          slider('gameplay.bgBlur', 'Background blur', 0, 1, 0.05, v => `${Math.round(v * 100)}%`, applyBg),
          h('div.setup-mini-t', { style: { marginTop: '12px' } }, 'Your keys (4K)'),
          this.keybindRow(4),
          h('div.setup-row.compact', h('div', h('div.setup-row-t', 'Audio offset ', offset), h('div.setup-row-s', 'Tap along to measure your headphones\' delay.')),
            h('button.btn.sm', { onclick: () => Calibration.open() }, icon('clock'), 'Calibrate')))),
    ];
  },

  slider(k, label, min, max, step, fmt, after) {
    const s = h('input.slider', { type: 'range', min, max, step, value: Settings.get(k), 'aria-label': label });
    const v = h('span.val');
    const upd = () => { const x = parseFloat(s.value); v.textContent = fmt(x); s.style.setProperty('--p', ((x - min) / (max - min) * 100) + '%'); };
    s.addEventListener('input', () => { Settings.set(k, parseFloat(s.value)); upd(); after && after(); });
    s.addEventListener('keydown', e => e.stopPropagation());
    upd();
    return h('div.setup-slider', h('div.row', h('span.setup-row-t', label), h('span.grow'), v), s);
  },

  keybindRow(keys) {
    const row = h('div.setup-keys');
    const paint = () => {
      const binds = Settings.keybinds(keys);
      clearEl(row).append(...binds.map((b, i) => h(`button.setup-key${this.capture && this.capture.col === i ? '.wait' : ''}`, {
        title: 'Click, then press a key', onclick: () => startCapture(i) }, this.capture && this.capture.col === i ? '…' : keyLabel(b[0]))));
    };
    const startCapture = col => {
      stopCapture();
      const onKey = e => {
        e.preventDefault(); e.stopPropagation();
        if (e.code !== 'Escape') {
          const binds = Settings.keybinds(keys);
          // a key can only drive one lane: swap it with the lane that had it
          const other = binds.findIndex((b, j) => j !== col && b[0] === e.code);
          if (other >= 0) binds[other] = [binds[col][0]];
          binds[col] = [e.code];
          Settings.setKeybinds(keys, binds);
          UISounds.play('check-on');
        }
        stopCapture();
      };
      window.addEventListener('keydown', onKey, true);
      this.capture = { col, off: () => window.removeEventListener('keydown', onKey, true) };
      paint();
    };
    const stopCapture = () => { if (this.capture) { this.capture.off(); this.capture = null; } paint(); };
    this.cleanup.push(() => { if (this.capture) { this.capture.off(); this.capture = null; } });
    paint();
    return h('div', row, h('div.setup-hint', 'Click a key to change it. Other key counts (1K–10K) are in Settings → Input.'));
  },

  step_skin() {
    const list = h('div.setup-skins');
    const canvas = h('canvas');
    const pv = h('div.setup-pv.skin', canvas);
    const styleRow = h('div');
    const paint = () => {
      const cur = SkinManager.current.id;
      clearEl(list).append(...SkinManager.list().map(s => h(`button.setup-skinitem${s.id === cur ? '.on' : ''}`, { onclick: async () => {
        await SkinManager.select(s.id, { silent: true }); UISounds.click(); paint(); show();
      } }, h('span.setup-skin-ic', icon('brush')), h('span.setup-skin-t', h('b', s.name), h('small', s.builtin ? 'Built in · follows your accent colour' : `by ${s.author || 'unknown'}`)), h('span.setup-check', icon('check')))),
      h('button.setup-skinitem.import', { onclick: () => this.importSkins(paint, show) }, h('span.setup-skin-ic', icon('upload')), h('span.setup-skin-t', h('b', 'Import a skin…'), h('small', '.osk files from osu! — or drag them onto the window'))));
      clearEl(styleRow);
      if (SkinManager.current.builtin) {
        const ns = Settings.get('skin.noteStyle');
        styleRow.append(h('div.setup-mini-t', { style: { marginTop: '14px' } }, 'Note style'),
          h('div.setup-seg', ...[['bars', 'Bars'], ['circles', 'Circles'], ['diamonds', 'Diamonds'], ['arrows', 'Arrows']].map(([v, l]) =>
            h(`button${ns === v ? '.on' : ''}`, { onclick: () => { Settings.set('skin.noteStyle', v); UISounds.click(); paint(); show(); } }, l))));
      }
    };
    const show = () => { if (this.preview) requestAnimationFrame(() => this.preview && this.preview.show(SkinManager.current, 4)); };
    const offSkins = Bus.on('skins:changed', () => { if (this.step.id === 'skin') { paint(); show(); } });
    this.cleanup.push(offSkins);
    paint();
    this.afterRender = () => { this.preview = new SkinPreview(canvas, { scrollSpeed: true }); show(); };
    return [h('div.setup-split', pv, h('div.setup-card', h('div.setup-mini-t', 'Installed skins'), list, styleRow))];
  },

  async importSkins(paint, show) {
    const files = await pickFiles({ accept: '.osk,.zip', multiple: true });
    if (!files.length) return;
    let last = null;
    for (const f of files) {
      try { last = await SkinManager.importOsk(f); Toast.ok('Skin imported', last.name); }
      catch (e) { Toast.err(`Couldn't import ${f.name}`, e.message); }
    }
    if (last) await SkinManager.select(last.id, { silent: true });
    if (this.step.id === 'skin') { paint(); show(); }
  },

  step_done() {
    const exp = SETUP_EXPERIENCE[this.choice.exp], dev = SETUP_DEVICES[this.choice.device];
    const n = BeatmapManager.maps.size;
    const chip = (ic, t) => h('span.setup-sum', icon(ic), t);
    const go = (fn) => { this.then = fn; this.finish(false); };
    return [
      h('div.setup-logo.small', h('span.lz-cookie-disc', h('span.lz-cookie-text', 'ashtonk!', h('small', 'mania')))),
      h('div.setup-hello', `You're all set, ${ProfileManager.profile.name || 'Player'}!`),
      h('div.setup-sums',
        exp ? chip('star', exp.label) : null, dev ? chip('gear', dev.label) : null,
        chip('target', `Scroll speed ${Settings.get('gameplay.scrollSpeed')}`), chip('brush', SkinManager.current.name),
        chip('sparkle', `Dim ${Math.round(Settings.get('gameplay.bgDim') * 100)}% · blur ${Math.round(Settings.get('gameplay.bgBlur') * 100)}%`)),
      h('p.setup-lead', n ? `You have ${n} difficult${n === 1 ? 'y' : 'ies'} in your library.` : 'Your library is empty — grab some beatmaps to start playing.'),
      h('div.setup-next-actions',
        h('button.setup-action', { onclick: () => go(() => Screens.go('explore')) }, icon('search'), h('b', 'Browse beatmaps'), h('small', 'Search and download osu!mania maps')),
        h('button.setup-action', { onclick: async () => { const files = await pickFiles({ accept: '.osz,.osk,.zip,.osr', multiple: true }); if (files.length) go(() => App.importFiles(files)); } }, icon('upload'), h('b', 'Import files'), h('small', '.osz beatmaps, .osk skins, .osr replays')),
        h('button.setup-action', { onclick: () => go(() => Screens.go(n ? 'songselect' : 'explore')) }, icon('play'), h('b', n ? 'Play now' : 'Start'), h('small', n ? 'Jump into song select' : 'Find your first map'))),
      h('p.setup-note', 'Everything here can be changed later in Settings (Ctrl+O). Run this setup again from Settings → Maintenance.'),
    ];
  },

  // ─────────────────────────────── helpers ───────────────────────────────
  cleanup: [],
  stopPreview() {
    if (this.preview) { this.preview.stop(); this.preview = null; }
    for (const f of this.cleanup.splice(0)) try { f(); } catch { /* ignore */ }
  },
  isChromebook() { return /\bCrOS\b/.test(navigator.userAgent); },
  recommendDevice() {
    const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 8;
    const fps = this.bench ? this.bench.fps : 60;
    if (this.isChromebook() || cores <= 4 || mem <= 4 || fps < 50) return 'low';
    if (cores <= 8 || mem <= 8) return 'mid';
    return 'high';
  },
  /** ~0.7s frame-time sample: a quick hint of how smooth the browser runs on this machine. */
  benchmark() {
    if (this._benchP) return this._benchP;
    this._benchP = new Promise(resolve => {
      const times = [];
      let last = 0;
      const t0 = performance.now();
      const f = t => {
        if (last) times.push(t - last);
        last = t;
        if (t - t0 < 700) requestAnimationFrame(f);
        else {
          times.sort((a, b) => a - b);
          const med = times[Math.floor(times.length / 2)] || 16.7;
          this.bench = { fps: Math.min(1000 / med, 360) };
          resolve(this.bench);
        }
      };
      requestAnimationFrame(f);
    });
    return this._benchP;
  },
  /** A generated "beatmap background" for the gameplay preview, so dim and blur are visible even before any
   *  beatmap is installed. Cached as a data URL. */
  previewArt() {
    if (this._art) return this._art;
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 640, 360);
    g.addColorStop(0, '#2b1055'); g.addColorStop(0.55, '#7a2d8c'); g.addColorStop(1, '#ff6a88');
    x.fillStyle = g; x.fillRect(0, 0, 640, 360);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 26; i++) {
      const r = 8 + rnd() * 46;
      x.fillStyle = `hsla(${280 + rnd() * 80}, 90%, ${60 + rnd() * 25}%, ${0.25 + rnd() * 0.5})`;
      x.beginPath(); x.arc(rnd() * 640, rnd() * 360, r, 0, Math.PI * 2); x.fill();
    }
    x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 3;
    for (let i = 0; i < 7; i++) { x.beginPath(); x.moveTo(-40 + i * 110, 360); x.lineTo(120 + i * 110, 0); x.stroke(); }
    x.fillStyle = '#fff'; x.font = '700 54px sans-serif'; x.textAlign = 'center';
    x.fillText('ashtonk!mania', 320, 200);
    this._art = c.toDataURL('image/jpeg', 0.85);
    return this._art;
  },
};
