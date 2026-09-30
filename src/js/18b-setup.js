/* First-run setup — a short, friendly wizard shown the first time the client opens (and from Settings →
 * Maintenance → "Run first-run setup"). Name first, then the player chooses whether to set things up at all:
 * device, accent colour and size, scroll speed and background, and a skin. Every choice applies immediately
 * (the previews are live) and stays editable in Settings. */

/** Render scale that keeps the playfield canvas at (at most) one pixel per CSS pixel — the cheapest setting
 *  that still looks sharp on a Chromebook's high-DPI panel. */
const lowEndRenderScale = () => clamp(Math.round(20 / (window.devicePixelRatio || 1)) / 20, 0.5, 1);

const SETUP_DEVICES = {
  pc: { label: 'PC', sub: 'Desktop or gaming laptop', icon: 'pc',
    values: () => ({ 'graphics.performanceMode': false, 'graphics.particles': true, 'graphics.effects': true, 'gameplay.hitLighting': true, 'skin.effects': true, 'gameplay.comboEffects': true,
      'graphics.bgQuality': 'high', 'gameplay.video': true, 'graphics.renderScale': 1, 'graphics.menuBlur': 12, 'ui.parallax': true }) },
  chromebook: { label: 'Chromebook', sub: 'School Chromebook or older laptop', icon: 'laptop',
    values: () => ({ 'graphics.performanceMode': true, 'graphics.bgQuality': 'low', 'gameplay.video': false, 'graphics.renderScale': lowEndRenderScale(),
      'graphics.menuBlur': 0, 'ui.parallax': false }) },
};

const SETUP_THEMES = [['kori', '#aa88ff', 'Kori'], ['neru', '#ffcf3a', 'Neru'], ['teto', '#ff4d6a', 'Teto'], ['miku', '#39c5bb', 'Miku']];
const SETUP_NOTE_STYLES = [['bars', 'Bars'], ['circles', 'Circles'], ['diamonds', 'Diamonds'], ['arrows', 'Arrows']];

const Onboarding = {
  STEPS: [
    { id: 'welcome', title: 'Welcome!' },
    { id: 'ask', title: 'Set up the game?' },
    { id: 'device', title: 'What are you playing on?', short: 'Device' },
    { id: 'look', title: 'Make it yours', short: 'Appearance' },
    { id: 'gameplay', title: 'How notes move', short: 'Gameplay' },
    { id: 'skin', title: 'Pick a skin', short: 'Skin' },
  ],

  /** Runs the wizard. Resolves once it is finished or skipped. `again`: opened from Settings (name is kept). */
  run({ again = false } = {}) {
    if (this.o) return this.done;
    this.done = new Promise(resolve => {
      this.resolve = resolve;
      this.again = again;
      this.i = 0;
      this.dir = 1;
      this.animate = true;
      this.el = h('div.onboarding.setup', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Setup' });
      this.o = makeOverlay(this.el, {
        dismissable: false,
        onKey: e => {
          if (e.key === 'Escape') return true; // closed with its own buttons only
          if (e.key === 'Enter' && this.step.id !== 'ask' && !(e.target.closest && e.target.closest('button, input, select'))) { this.next(); return true; }
          return false;
        },
      });
      this.render();
    });
    return this.done;
  },

  get step() { return this.STEPS[this.i]; },
  get last() { return this.i === this.STEPS.length - 1; },

  render() {
    this.stopPreview();
    const st = this.step;
    const body = h(`div.setup-body.setup-step-${st.id}${this.animate ? '.anim' : ''}`, { style: { '--dir': this.dir } }, ...[].concat(this['step_' + st.id]()));
    this.animate = false;
    const showNav = st.id !== 'ask';
    // lazer's WizardOverlay: the overlay header, the step, then sheared Back and a wide Next "(next step)" button
    const nx = this.STEPS[this.i + 1];
    this.nextBtn = showNav ? h('button.setup-next', { onclick: () => this.next() }, h('span', this.last ? 'Finish' : nx && nx.short ? `Next (${nx.short})` : 'Next')) : null;
    clearEl(this.el).append(
      h('div.setup-ovhead', h('div.setup-ovt', 'first-run setup'), h('div.setup-ovs', 'set up Ashtonk!mania to suit you')),
      h('div.setup-head',
        h('h2', st.id === 'welcome' ? 'Welcome to Ashtonk!mania' : st.title),
        this.i > 1 ? h('div.setup-progress', ...this.STEPS.slice(2).map((s, k) => h(`i${k + 2 === this.i ? '.on' : k + 2 < this.i ? '.past' : ''}`)))
          : null),
      body,
      h('div.setup-foot',
        this.i > 0 && showNav ? h('button.setup-back', { onclick: () => this.go(this.i === 2 ? 1 : this.i - 1) }, h('span', icon('back'), 'Back')) : null,
        this.err = h('div.ob-err'),
        this.nextBtn));
    this.afterRender && this.afterRender();
    this.afterRender = null;
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
    if (this.last) this.finish();
    else this.go(this.i + 1);
  },
  /** Validate / save the current step before moving on. */
  async commit() {
    if (this.step.id === 'welcome') {
      const n = this.nameEl.value.trim();
      if (!n) { this.err.textContent = 'Type a name first.'; this.nameEl.focus(); return false; }
      if (n !== ProfileManager.profile.name) await ProfileManager.setName(n);
      Toolbar.updateProfile();
    }
    return true;
  },
  /** Close and land on the main menu. */
  async finish() {
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
    if (Screens.currentName !== 'home') Screens.go('home');
    if (first) Toast.show(`Welcome, ${p.name}!`, 'Change anything later in Settings (Ctrl+O).');
    this.resolve();
  },

  // ─────────────────────────────── steps ───────────────────────────────
  logo(cls = '') { return h(`div.setup-logo${cls}`, h('span.lz-cookie-disc', h('span.lz-cookie-text', 'ashtonk!', h('small', 'mania')))); },

  step_welcome() {
    const p = ProfileManager.profile;
    this.nameEl = h('input.input.ob-name', { value: p.onboarded || this.again ? p.name : '', placeholder: 'Your name', maxlength: 24, 'aria-label': 'Your name', autocomplete: 'nickname' });
    this.nameEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); this.next(); } });
    this.nameEl.addEventListener('input', () => { this.err.textContent = ''; });
    this.afterRender = () => setTimeout(() => this.nameEl && this.nameEl.focus(), 60);
    return [this.logo(), h('p.setup-lead', 'What should we call you?'), this.nameEl];
  },

  step_ask() {
    return [
      this.logo('.small'),
      h('p.setup-lead', `Hi ${ProfileManager.profile.name}! Want to set up the game now? It takes about 30 seconds.`),
      h('div.setup-choices.two',
        h('button.setup-choice.primary', { onclick: () => this.go(2) }, h('span.setup-choice-ic', icon('sparkle')), h('span.setup-choice-t', 'Set it up'), h('span.setup-choice-s', 'Pick your device, colours, speed and skin')),
        h('button.setup-choice.ob-skip', { onclick: () => this.finish() }, h('span.setup-choice-ic', icon('play')), h('span.setup-choice-t', 'Skip'), h('span.setup-choice-s', 'Use the default settings'))),
    ];
  },

  step_device() {
    const cur = Settings.values['setup.device'];
    const pick = id => {
      for (const [k, v] of Object.entries(SETUP_DEVICES[id].values())) Settings.set(k, v);
      Settings.set('setup.device', id);
      UISounds.play('check-on');
      this.render();
      setTimeout(() => { if (this.o && this.step.id === 'device') this.next(); }, 350);
    };
    return [h('div.setup-choices.two', ...Object.entries(SETUP_DEVICES).map(([id, o]) =>
      h(`button.setup-choice${cur === id ? '.on' : ''}`, { dataset: { id }, onclick: () => pick(id) },
        h('span.setup-choice-ic', icon(o.icon)), h('span.setup-choice-t', o.label), h('span.setup-choice-s', o.sub), h('span.setup-check', icon('check')))))];
  },

  step_look() {
    const theme = Settings.get('ui.theme');
    return [
      h('div.setup-label', 'Colour'),
      h('div.setup-swatches', ...SETUP_THEMES.map(([id, c, name]) => h(`button.setup-swatch${theme === id ? '.on' : ''}`, {
        style: { '--c': c }, 'aria-label': name, onclick: () => { Settings.set('ui.theme', id); UISounds.click(); this.render(); } }, h('i'), h('span', name)))),
      h('div.setup-label', 'Size'),
      this.slider('ui.scale', 'Interface size', 0.75, 1.5, 0.05, v => `${Math.round(v * 100)}%`, null, 'change'),
      h('div.setup-label', 'Profile picture'),
      h('div.setup-pfp', ProfileManager.avatarEl(56), h('button.btn.sm.setup-pfp-btn', { onclick: () => {
        const off = Bus.on('avatar:changed', () => { off(); if (this.o && this.step.id === 'look') this.render(); });
        AvatarPicker.open();
      } }, icon('user'), 'Choose a picture')),
    ];
  },

  step_gameplay() {
    const bg = h('div.setup-pv-bg', { style: { backgroundImage: `url("${this.previewArt()}")` } });
    const dim = h('div.setup-pv-dim');
    const canvas = h('canvas');
    const pv = h('div.setup-pv', bg, dim, canvas);
    const applyBg = () => {
      const w = pv.clientWidth || 360;
      bg.style.filter = `blur(${(Settings.get('gameplay.bgBlur') * 50 * w / 1920 * 2.2).toFixed(1)}px)`;
      dim.style.opacity = Settings.get('gameplay.bgDim');
    };
    const dirSeg = h('div.setup-seg', ...[['down', 'Down'], ['up', 'Up']].map(([v, l]) =>
      h(`button${Settings.get('gameplay.scrollDirection') === v ? '.on' : ''}`, { onclick: e => {
        Settings.set('gameplay.scrollDirection', v); UISounds.click();
        for (const b of e.currentTarget.parentNode.children) b.classList.toggle('on', b === e.currentTarget);
        this.preview && this.preview.renderer.resize(true);
      } }, l)));
    this.afterRender = () => {
      applyBg();
      this.preview = new SkinPreview(canvas, { scrollSpeed: true });
      requestAnimationFrame(() => this.preview && this.preview.show(SkinManager.current, 4));
    };
    return [h('div.setup-split', pv,
      h('div.setup-controls',
        this.slider('gameplay.scrollSpeed', 'Scroll speed', 1, 40, 1, v => String(v)),
        h('div.setup-hint', 'Higher is faster. 22 is a good start.'),
        this.slider('gameplay.bgDim', 'Background dim', 0, 1, 0.01, v => `${Math.round(v * 100)}%`, applyBg),
        this.slider('gameplay.bgBlur', 'Background blur', 0, 1, 0.05, v => `${Math.round(v * 100)}%`, applyBg),
        h('div.setup-slider', h('div.row', h('span.setup-row-t', 'Notes fall'), h('span.grow'), dirSeg))))];
  },

  step_skin() {
    const canvas = h('canvas');
    const pv = h('div.setup-pv.skin', canvas);
    const side = h('div.setup-controls');
    const show = () => { if (this.preview) requestAnimationFrame(() => this.preview && this.preview.show(SkinManager.current, 4)); };
    const choose = async id => {
      if (this.preview) this.preview.renderer.layout = null; // the old skin's images are freed on switch
      await SkinManager.select(id, { silent: true }); UISounds.click(); paint(); show(); };
    const paint = () => {
      const cur = SkinManager.current.id;
      const kori = SkinManager.skins.find(s => /kori/i.test(s.name));
      // the skins that come with the game first (Kori, then Chemuss), then Custom, then the player's own
      const chemuss = SkinManager.skins.find(s => /chemuss/i.test(s.name));
      const others = SkinManager.skins.filter(s => s !== kori && s !== chemuss);
      const card = (id, name, sub, ic) => h(`button.setup-skinitem${cur === id ? '.on' : ''}`, { dataset: { id }, onclick: () => choose(id) },
        h('span.setup-skin-ic', icon(ic)), h('span.setup-skin-t', h('b', name), h('small', sub)), h('span.setup-check', icon('check')));
      clearEl(side).append(
        h('div.setup-skins',
          kori ? card(kori.id, 'Kori', 'The default skin', 'sparkle') : null,
          chemuss ? card(chemuss.id, 'Chemuss mixed edit', 'Orb notes, made for 4K', 'sparkle') : null,
          card('default', 'Custom', 'Choose the note shape and colour', 'brush'),
          ...others.map(s => card(s.id, s.name, 'Imported', 'brush')),
          h('button.setup-skinitem.import', { onclick: () => this.importSkins(paint, show) }, h('span.setup-skin-ic', icon('upload')), h('span.setup-skin-t', h('b', 'Import a skin'), h('small', '.osk file from osu!')))),
        cur === 'default' ? this.customSkinOptions(() => { paint(); show(); }) : null);
    };
    const offSkins = Bus.on('skins:changed', () => { if (this.step.id === 'skin') { paint(); show(); } });
    this.cleanup.push(offSkins);
    paint();
    this.afterRender = () => { this.preview = new SkinPreview(canvas, { scrollSpeed: true }); show(); };
    return [h('div.setup-split', pv, side)];
  },

  /** The Custom (built-in) skin's options — Web-Osu-Mania's note styles and single-hue colouring. */
  customSkinOptions(refresh) {
    const style = Settings.get('skin.noteStyle'), hue = Settings.get('skin.hue');
    const hueSlider = h('input.slider.setup-hue', { type: 'range', min: 0, max: 360, step: 1, value: hue < 0 ? 270 : hue, 'aria-label': 'Note colour' });
    hueSlider.addEventListener('change', () => { Settings.set('skin.hue', +hueSlider.value); refresh(); });
    hueSlider.addEventListener('keydown', e => e.stopPropagation());
    const t = h(`button.toggle${Settings.get('skin.darkerHolds') ? '.on' : ''}`, { role: 'switch', 'aria-label': 'Darker hold notes', onclick: () => {
      Settings.set('skin.darkerHolds', !Settings.get('skin.darkerHolds')); UISounds.click(); refresh(); } });
    return h('div.setup-custom',
      h('div.setup-label', 'Note shape'),
      h('div.setup-seg', ...SETUP_NOTE_STYLES.map(([v, l]) => h(`button${style === v ? '.on' : ''}`, { onclick: () => { Settings.set('skin.noteStyle', v); UISounds.click(); refresh(); } }, l))),
      h('div.setup-label', 'Note colour'),
      h('div.setup-seg', h(`button${hue < 0 ? '.on' : ''}`, { onclick: () => { Settings.set('skin.hue', -1); UISounds.click(); refresh(); } }, 'Match my colour'),
        h(`button${hue >= 0 ? '.on' : ''}`, { onclick: () => { Settings.set('skin.hue', +hueSlider.value); UISounds.click(); refresh(); } }, 'Pick a colour')),
      hue >= 0 ? hueSlider : null,
      h('div.setup-row', h('span.setup-row-t', 'Darker hold notes'), t));
  },

  async importSkins(paint, show) {
    const files = await pickFiles({ accept: '.osk,.zip', multiple: true });
    if (!files.length) return;
    let last = null;
    for (const f of files) {
      try { last = await SkinManager.importOsk(f); Toast.ok('Skin imported', last.name); }
      catch (e) { Toast.err(`Couldn't import ${f.name}`, friendlyError(e)); }
    }
    if (last) { if (this.preview) this.preview.renderer.layout = null; await SkinManager.select(last.id, { silent: true }); }
    if (this.step.id === 'skin') { paint(); show(); }
  },

  // ─────────────────────────────── helpers ───────────────────────────────
  slider(k, label, min, max, step, fmt, after, evt = 'input') {
    const s = h('input.slider', { type: 'range', min, max, step, value: Settings.get(k), 'aria-label': label });
    const v = h('span.val');
    const upd = () => { const x = parseFloat(s.value); v.textContent = fmt(x); s.style.setProperty('--p', ((x - min) / (max - min) * 100) + '%'); };
    s.addEventListener('input', () => { if (evt === 'input') Settings.set(k, parseFloat(s.value)); upd(); after && after(); });
    if (evt === 'change') s.addEventListener('change', () => Settings.set(k, parseFloat(s.value)));
    s.addEventListener('keydown', e => e.stopPropagation());
    upd();
    return h('div.setup-slider', h('div.row', h('span.setup-row-t', label), h('span.grow'), v), s);
  },
  cleanup: [],
  stopPreview() {
    if (this.preview) { this.preview.stop(); this.preview = null; }
    for (const f of this.cleanup.splice(0)) try { f(); } catch { /* ignore */ }
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
