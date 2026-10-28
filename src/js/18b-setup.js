/* First-run setup — osu!lazer's first-run wizard, shown the first time the client opens (and from Settings →
 * Maintenance → "Run first-run setup"): your name, bringing over a Web-Osu-Mania backup (lazer's "import from
 * osu!stable" page), your device, size and picture, scroll speed and background, and a skin. It isn't skippable,
 * but every page is quick; each choice applies at once (the previews are live) and stays editable in Settings. */

/** Render scale that keeps the playfield canvas at (at most) one pixel per CSS pixel — the cheapest setting
 *  that still looks sharp on a Chromebook's high-DPI panel. */
const lowEndRenderScale = () => clamp(Math.round(20 / (window.devicePixelRatio || 1)) / 20, 0.5, 1);

/** Performance or graphics (saved as setup.device: 'chromebook' / 'pc', the names earlier versions used). */
const SETUP_DEVICES = {
  chromebook: { label: 'Performance', sub: 'Smoothest everywhere: Performance mode on — no heavy effects in songs or menus', icon: 'bolt',
    // (the pictures and the playfield stay at full resolution: Picture quality and Renderer scale lower them, if wanted)
    values: () => ({ 'graphics.performanceMode': true, 'gameplay.video': false, 'graphics.menuBlur': 12, 'ui.parallax': false }) },
  pc: { label: 'Graphics', sub: 'Every effect, video and full sharpness', icon: 'sec-graphics',
    values: () => ({ 'graphics.performanceMode': false, 'graphics.particles': true, 'graphics.effects': true, 'gameplay.hitLighting': true, 'skin.effects': true, 'gameplay.comboEffects': true,
      'graphics.bgQuality': 'high', 'gameplay.video': true, 'graphics.renderScale': 1, 'graphics.menuBlur': 12, 'ui.parallax': true }) },
};

/** ChromeOS: Chromebooks get the lighter settings without having to know to ask for them. */
const IS_CHROMEBOOK = typeof navigator !== 'undefined' && /\bCrOS\b/.test(navigator.userAgent || '');

const SETUP_NOTE_STYLES = [['bars', 'Bars'], ['circles', 'Circles'], ['arrows', 'Arrows'], ['thickArrows', 'Thick'], ['diamonds', 'Diamonds']];

const Onboarding = {
  STEPS: [
    { id: 'welcome', title: 'Welcome!' },
    { id: 'account', title: 'You' },
    { id: 'wom', title: 'Coming from Web-Osu-Mania?', short: 'Import' },
    { id: 'device', title: 'Performance or graphics?', short: 'Quality' },
    { id: 'look', title: 'Make it yours', short: 'Appearance' },
    { id: 'gameplay', title: 'How notes move', short: 'Gameplay' },
    { id: 'skin', title: 'Pick a skin', short: 'Skin' },
  ],

  /** Runs the wizard. Resolves once it is finished or skipped. `again`: opened from Settings (name is kept).
   *  `account`: only the first page's question — have you played before? — after signing out on this device. */
  run({ again = false, account = false } = {}) {
    if (this.o) return this.done;
    this.done = new Promise(resolve => {
      this.resolve = resolve;
      this.again = again;
      this.accountOnly = account;
      this.acct = null; this.linked = false; this.nameVal = null; this.code = null; this.codeErr = null; this.helpOpen = false; this.got = null; this.busy = false; this.finishing = false;
      this.i = 0;
      // (closed before Finish after typing a code or getting one: this device is that player already — on to their page,
      // where what's kept for them is brought again — never "I'm new", which would rename them)
      const already = !again && !account && this.asksAccount && Account.linked() && !Account.signedOut();
      if (already) { this.acct = 'have'; this.linked = true; this.i = 1; }
      this.dir = 1;
      this.womAnswer = this.womDone = this.womStatus = null;
      this.animate = true;
      this.el = h('div.onboarding.setup', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Setup' });
      this.o = makeOverlay(this.el, { flags: ['onboarding', 'neru-cover'],
        dismissable: false,
        onKey: e => {
          if (e.key === 'Escape') return true; // closed with its own buttons only
          if (e.key === 'Enter' && !(e.target.closest && e.target.closest('button, input, select'))) { this.next(); return true; }
          return false;
        },
      });
      // (Neru beside it, sizing you up — a pose for each page — while the main menu's steps out: never two of her)
      this.neru = typeof NeruCameo !== 'undefined' ? NeruCameo.make('setup', 'nc-setup', { delay: 0 }) : null;
      if (this.neru) { this.o.el.insertBefore(this.neru, this.el); NeruCameo.beside(this.neru, this.el, this.o.el); }
      this.render();
      if (already) this.bringBack({ pause: false }).then(() => { if (this.o && this.step.id === 'account') { this.animate = false; this.render(); } });
    });
    return this.done;
  },

  /** The pages: without a server to ask, no "have you played before?" (the first page asks your name); after signing
   *  out, only that question and your code or name; a returning player whose settings came along only has the device's
   *  own page left (performance or graphics) — their look, gameplay and skin are theirs already. */
  get steps() {
    if (!this.asksAccount) return this.STEPS.filter(s => s.id !== 'account');
    if (this.accountOnly) return this.STEPS.slice(0, 2);
    if (this.acct === 'have' && !(this.got && !this.got.settings)) return this.STEPS.filter(s => /^(welcome|account|device)$/.test(s.id));
    return this.STEPS;
  },
  /** A page's heading, and its name on the button that leads to it. */
  titleOf(st) {
    if (st.id === 'welcome') return this.accountOnly ? 'Play as yourself' : 'Welcome to Ashtonk!mania';
    if (st.id === 'account') return this.acct === 'have' ? 'Welcome back' : 'Nice to meet you';
    return st.title;
  },
  shortOf(st) { return st.id === 'account' ? (this.acct === 'have' ? 'Your code' : this.acct === 'new' ? 'Your name' : '') : st.short; },
  get step() { return this.steps[this.i]; },
  get last() { return this.i === this.steps.length - 1; },
  /** The first page asks whether you've played before (your code) — wherever there's a server to ask. */
  get asksAccount() { return Multiplayer.available() && !this.again; },

  render() {
    this.stopPreview();
    const st = this.step;
    const body = h(`div.setup-body.setup-step-${st.id}${this.animate ? '.anim' : ''}`, { style: { '--dir': this.dir } }, ...[].concat(this['step_' + st.id]()));
    this.animate = false;
    const showNav = true;
    // lazer's WizardOverlay: the overlay header, the step, then sheared Back and a wide Next "(next step)" button
    const nx = this.steps[this.i + 1];
    this.nextBtn = showNav ? h('button.setup-next', { onclick: () => this.next() }, h('span', this.last ? 'Finish' : nx && this.shortOf(nx) ? `Next (${this.shortOf(nx)})` : 'Next')) : null;
    // (once this device is you, there's no going back to "have you played before?")
    const back = this.i > 0 && showNav && !(st.id === 'account' && this.linked);
    clearEl(this.el).append(
      h('div.setup-ovhead', h('div.setup-ovt', 'first-run setup'), h('div.setup-ovs', 'set up Ashtonk!mania to suit you')),
      h('div.setup-head',
        h('h2', this.titleOf(st)),
        this.i > 0 ? h('div.setup-progress', ...this.steps.slice(1).map((s, k) => h(`i${k + 1 === this.i ? '.on' : k + 1 < this.i ? '.past' : ''}`)))
          : null),
      body,
      h('div.setup-foot',
        back ? h('button.setup-back', { onclick: () => this.go(this.i - 1) }, h('span', icon('back'), 'Back')) : null,
        this.err = h('div.ob-err'),
        this.nextBtn));
    this.afterRender && this.afterRender();
    this.afterRender = null;
    this.neruPose();
  },
  /** Neru's pose for each page: hand on hip at the start, glad to see you back (a code) or a wag of her finger at a
   *  newcomer, a blank look at Web-Osu-Mania, on her phone while you pick performance or graphics, a wink at your
   *  colours, fists up for the gameplay, sunglasses on for the skin. */
  NERU: { welcome: 'sassy', wom: 'huh', device: 'phone', look: 'wink', gameplay: 'cheer', skin: 'cool' },
  neruPose() {
    const st = this.step, n = this.neru;
    if (!n || !st) return;
    const pose = st.id === 'account' ? (this.acct === 'have' ? 'happy' : 'point') : this.NERU[st.id] || 'sassy';
    if (n._want === pose) return;
    n._want = pose;
    // (her pictures may still be loading: the pose waits for them)
    const go = () => { if (n._want === pose && n._pose) n._pose(pose); else if (n.isConnected && n._want === pose) setTimeout(go, 150); };
    go();
  },

  async go(k) {
    if (k === this.i || k < 0 || k >= this.steps.length || this.busy) return;
    if (k > this.i && !(await this.commit())) return;
    this.dir = k > this.i ? 1 : -1;
    this.i = k;
    this.animate = true;
    UISounds.click();
    this.render();
  },
  next() {
    if (this.busy) return;
    if (this.last) this.finish();
    else this.go(this.i + 1);
  },
  /** Validate / save the current step before moving on. */
  async commit() {
    if (this.step.id === 'welcome' && this.asksAccount) {
      if (!this.acct) { this.err.textContent = 'Pick one first.'; return false; }
      return true;
    }
    if (this.step.id === 'account' && this.acct === 'have') {
      if (this.linked) return true;
      const typed = this.codeIn ? this.codeIn.value : '';
      if (!typed.trim()) { this.err.textContent = 'Type your code first.'; this.codeIn && this.codeIn.focus(); return false; }
      this.busy = true;
      this.nextBtn && this.nextBtn.classList.add('busy');
      try { await Account.link(typed); this.linked = true; }
      catch (e) { this.err.textContent = friendlyError(e); this.codeIn && this.codeIn.select(); return false; }
      finally { this.busy = false; this.nextBtn && this.nextBtn.classList.remove('busy'); }
      Toolbar.updateProfile();
      await this.bringBack();
      return true;
    }
    if (this.step.id === 'welcome' || this.step.id === 'account') {
      const n = this.nameEl.value.trim();
      if (!n) { this.err.textContent = 'Type a name first.'; this.nameEl.focus(); return false; }
      if (n !== ProfileManager.profile.name) await ProfileManager.setName(n);
      Toolbar.updateProfile();
    }
    return true;
  },
  /** Close and land on the main menu. */
  async finish() {
    if (this.finishing || !this.o) return; // (a tap on Finish while a choice is already finishing it)
    this.finishing = true;
    try { if (!(await this.commit())) return; } finally { if (this.o) this.finishing = false; }
    this.finishing = true;
    const p = ProfileManager.profile;
    const first = !p.onboarded;
    p.onboarded = true;
    await ProfileManager.save();
    await Settings.flush();
    Toolbar.updateProfile();
    this.stopPreview();
    UISounds.click();
    const o = this.o;
    this.o = null; this.finishing = false;
    if (!o) return;
    o.close();
    if (Screens.currentName !== 'home') Screens.go('home');
    if (first) Toast.show(`Welcome, ${p.name}!`, kbHint('Change anything later in Settings (Ctrl+O).', 'Change anything later in Settings.'));
    this.resolve();
  },

  // ─────────────────────────────── steps ───────────────────────────────
  logo(cls = '') { return h(`div.setup-logo${cls}`, h('span.lz-cookie-disc', h('span.lz-cookie-text', 'ashtonk!', h('small', 'mania')))); },

  step_welcome() {
    if (!this.asksAccount) return [this.logo(), h('p.setup-lead', 'What should we call you?'), this.nameInput()];
    // have you played before? — the next page takes your code (you: scores, rank, friends, settings and skin) or your name
    const choice = (v, ic, t, sub) => h(`button.setup-choice${this.acct === v ? '.on' : ''}`, { dataset: { id: v }, onclick: () => this.pickAccount(v) },
      h('span.setup-choice-ic', icon(ic)), h('span.setup-choice-t', t), h('span.setup-choice-s', sub), h('span.setup-check', icon('check')));
    return [this.logo(), h('p.setup-lead', 'Have you played Ashtonk!mania before?'),
      h('div.setup-choices.two', choice('have', 'lock', 'Yes, I have a code', 'Play as yourself — your scores, rank, friends, settings and skin'), choice('new', 'user-plus', 'No, I\'m new', 'Start fresh — you\'ll get a code of your own'))];
  },
  nameInput() {
    const p = ProfileManager.profile;
    this.nameEl = h('input.input.ob-name', { value: this.nameVal != null ? this.nameVal : p.onboarded || this.again ? p.name : '', placeholder: 'Your name', maxlength: 24, 'aria-label': 'Your name', autocomplete: 'nickname' });
    this.nameEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); this.next(); } });
    this.nameEl.addEventListener('input', () => { this.err.textContent = ''; this.nameVal = this.nameEl.value; });
    this.afterRender = () => setTimeout(() => this.nameEl && !this.nameEl.value && this.nameEl.focus(), 60);
    return this.nameEl;
  },
  /** Picked on the first page: on to the next, where your code or your name goes. */
  pickAccount(v) {
    if (this.busy) return;
    this.acct = v; this.err.textContent = '';
    this.go(this.i + 1);
    if (v === 'new' && !this.code && !this.codeBusy) this.makeCode();
  },
  /** Your code, made now (after signing out: you start over as a new player first). */
  async makeCode() {
    this.codeBusy = true;
    try {
      if (Account.signedOut()) Account.fresh();
      this.code = Account.code() || await Account.newCode();
    } catch (e) { this.codeErr = friendlyError(e); }
    finally { this.codeBusy = false; }
    if (this.codeWrap && this.codeWrap.isConnected) this.paintCode();
  },
  step_account() {
    if (this.acct === 'new') {
      this.codeWrap = h('div.setup-mycode');
      this.paintCode();
      return [h('p.setup-lead', 'What should we call you?'), h('div.setup-acct', this.nameInput(), this.codeWrap)];
    }
    // a returning player: your code — then what it brings (your settings, your skin) on its way here
    if (!this.linked) return [h('p.setup-lead', 'Type your code to play as yourself here.'), h('div.setup-acct', this.codeEntry())];
    this.restoreEl = h('div.setup-restore');
    this.paintRestore();
    return [h('p.setup-lead', `Playing as ${ProfileManager.profile.name}`), h('div.setup-acct', this.restoreEl)];
  },
  /** Your settings and skin, from the server, shown on this page as they come (`pause`: a moment to see what came
   *  before the setup moves on by itself). */
  async bringBack({ pause = true } = {}) {
    this.busy = true;
    this.got = null; this.restoreErr = null; this.restoreMsg = 'Bringing your settings…'; this.restoreFrac = null;
    this.animate = false; this.render();
    try {
      this.got = await Sync.restore((m, f) => { this.restoreMsg = m; this.restoreFrac = f == null ? null : f; this.paintRestore(); });
    } catch (e) {
      this.got = { settings: false, skin: '' };
      if (e.status !== 503 && e.status !== 404) this.restoreErr = friendlyError(e);
    }
    this.paintRestore();
    if (pause) await sleep(this.got.settings || this.got.skin ? 900 : 300);
    this.busy = false;
  },
  paintRestore() {
    const w = this.restoreEl;
    if (!w) return;
    if (!this.got) {
      const bar = this.restoreFrac != null ? h('div.setup-restore-bar', h('i', { style: { width: `${Math.round(this.restoreFrac * 100)}%` } })) : null;
      clearEl(w).append(...[h('div.setup-codewait', h('span.spinner'), this.restoreMsg || 'Bringing your settings…'), bar].filter(Boolean));
      return;
    }
    const line = (ok, text) => h(`div.setup-linked${ok ? '' : '.none'}`, icon(ok ? 'check' : 'info'), text);
    clearEl(w).append(...[
      line(true, this.got.scores ? `Your scores (${plural(this.got.scores, 'play')}), rank and friends` : 'Your scores, rank and friends'),
      this.got.settings ? line(true, 'Your settings') : line(false, (this.restoreErr ? `Your settings didn't come along (${noStop(this.restoreErr)})` : 'No settings were kept for you yet') + (this.accountOnly ? '' : ' — set them up on the next pages')),
      this.got.collections || this.got.favorites ? line(true, this.got.collections && this.got.favorites ? 'Your collections and favourites' : this.got.collections ? 'Your collections' : 'Your favourites') : null,
      this.got.skin ? line(true, `Your skin: ${this.got.skin}`) : this.got.skinErr ? line(false, `Your skin didn't come along (${noStop(this.got.skinErr)})`) : null].filter(Boolean));
  },
  /** Your code, new: shown big with Copy, and why to keep it safe. */
  paintCode() {
    const w = this.codeWrap;
    if (!w) return;
    if (this.code) {
      const copy = h('button.lp-copy', { title: 'Copy', 'aria-label': 'Copy your code', onclick: async () => { try { await navigator.clipboard.writeText(this.code); UISounds.click(); Toast.ok('Code copied', 'Paste it somewhere safe.'); } catch { /* it's on screen to copy by hand */ } } }, icon('copy'));
      clearEl(w).append(h('label.setup-lbl', 'Your code'),
        h('div.lp-code-row', h('div.lp-codebox', h('div.lp-code', this.code)), copy),
        h('p.setup-save', icon('warn'), h('span', h('b', 'Save it somewhere safe'), ` — a note on your phone, a screenshot, or write it down. It's how you play as yourself on another device, and nobody can get it back for you if it's lost. You can always see it again: ${Account.where()}.`)));
    } else if (this.codeErr) clearEl(w).append(h('p.setup-save.err', h('span', `Couldn't make your code just now (${noStop(this.codeErr)}). You can get it later: ${Account.where()}.`)));
    else clearEl(w).append(h('div.setup-codewait', h('span.spinner'), 'Making your code…'));
  },
  /** Type your code — and how to find it. */
  codeEntry() {
    this.codeIn = h('input.input.lp-code-in.setup-code-in', { placeholder: 'XXXX-XXXX-XXXX-XXXX', 'aria-label': 'Your code', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters', maxlength: 24 });
    this.codeIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); this.next(); } });
    Account.tidyInput(this.codeIn, () => { this.err.textContent = ''; });
    this.afterRender = () => setTimeout(() => this.codeIn && this.codeIn.focus(), 60);
    const help = h('div.setup-help', { hidden: !this.helpOpen },
      h('p', 'On a device you already play Ashtonk!mania on:'),
      h('ol',
        h('li', Mobile.touch ? 'Press and hold your name in the top bar.' : 'Right-click your name in the top bar (on a phone or tablet, press and hold it).'),
        h('li', 'Choose ', h('b', 'Your code'), '.'),
        h('li', 'It\'s under ', h('b', 'My code'), ': tap the dots to see it, or press the copy button and paste it here.')),
      h('p.muted', 'Can\'t get to that device and didn\'t save your code? It can\'t be recovered — pick "No, I\'m new" to start fresh.'));
    const toggle = h('button.setup-help-link', { onclick: () => {
      this.helpOpen = !this.helpOpen; help.hidden = !this.helpOpen; toggle.classList.toggle('open', this.helpOpen);
      // (on a phone it opens below the fold: the page scrolls to it — the page alone, not the setup around it)
      const body = help.closest('.setup-body');
      if (this.helpOpen && body) requestAnimationFrame(() => { const by = help.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom + 16; if (by > 0) body.scrollBy({ top: by, behavior: 'smooth' }); });
    } }, icon('question'), 'Where do I find my code?');
    toggle.classList.toggle('open', this.helpOpen);
    return [h('label.setup-lbl', 'Your code'), this.codeIn, toggle, help];
  },

  /** osu!lazer's "import from osu!stable" page, for Web-Osu-Mania: its backup brings keybinds, settings, beatmaps,
   *  scores and collections across in one go. */
  step_wom() {
    const yes = this.womAnswer === 'yes';
    const choice = (v, ic, t, sub) => h(`button.setup-choice${this.womAnswer === v ? '.on' : ''}`, { dataset: { id: v }, onclick: () => {
      UISounds.click(); this.womAnswer = v;
      if (v === 'no') { this.next(); return; }
      this.render();
    } }, h('span.setup-choice-ic', icon(ic)), h('span.setup-choice-t', t), h('span.setup-choice-s', sub), h('span.setup-check', icon('check')));
    const out = [
      // (once it's yes, the question makes room for the import steps: the page's title asks it too)
      yes ? null : h('p.setup-lead', 'Did you play Web-Osu-Mania before?'),
      h(`div.setup-choices.two${yes ? '.compact' : ''}`, choice('yes', 'upload', 'Yes', 'Bring my keybinds and beatmaps'), choice('no', 'user-plus', 'No', 'I\'m new here'))];
    if (yes) out.push(h('div.setup-wom',
      this.womDone
        ? h('div.setup-wom-done', icon('check'), h('span', `Imported ${this.womDone}. Your keybinds and settings are in place — check them on the next pages.`))
        : [h('ol.setup-wom-steps',
            h('li', 'In Web-Osu-Mania, open ', h('b', 'Settings → Backup & Restore'), '.'),
            h('li', 'Tick ', h('b', 'Settings & Keybinds'), ', ', h('b', 'Stored Beatmaps'), ' and ', h('b', 'Collections'), ' (scores too, if you like) and export. Songs in your collections are downloaded for you.'),
            h('li', 'Import the .zip it saves here.')),
          this.womStatus ? h('div.setup-wom-busy', h('span.spinner'), this.womStatus)
            : h('button.btn.primary.setup-wom-btn', { onclick: () => this.importWom() }, icon('upload'), 'Import my Web-Osu-Mania backup')]));
    return out;
  },
  async importWom() {
    const [f] = await pickFiles({ accept: '.zip', multiple: false });
    if (!f || !this.o) return;
    this.womStatus = 'Reading backup…'; this.render();
    try {
      const r = await WomImport.run(f, { onStatus: m => { if (m && this.o) { this.womStatus = m; const el = this.el.querySelector('.setup-wom-busy'); if (el) el.lastChild.textContent = m; } } });
      this.womDone = WomImport.summary(r);
      if (r.errors.length) Toast.err('Some of it couldn\'t be imported', r.errors.slice(0, 5).join('\n'));
      UISounds.play('check-on');
    } catch (e) { Toast.err('Couldn\'t import the backup', friendlyError(e)); }
    this.womStatus = null;
    if (this.o && this.step.id === 'wom') this.render();
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
        h('span.setup-choice-ic', icon(o.icon)), h('span.setup-choice-t', o.label), h('span.setup-choice-s', id === 'chromebook' && (IS_CHROMEBOOK || TOUCH_DEVICE) ? `Recommended on ${IS_CHROMEBOOK ? 'a Chromebook' : 'phones'}: ${o.sub.toLowerCase()}` : o.sub), h('span.setup-check', icon('check')))))];
  },

  step_look() {
    return [
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
      // the skin that comes with the game first, then Custom, then the player's own
      const others = SkinManager.skins.filter(s => s !== kori);
      const card = (id, name, sub, ic) => h(`button.setup-skinitem${cur === id ? '.on' : ''}`, { dataset: { id }, onclick: () => choose(id) },
        h('span.setup-skin-ic', icon(ic)), h('span.setup-skin-t', h('b', name), h('small', sub)), h('span.setup-check', icon('check')));
      clearEl(side).append(
        h('div.setup-skins',
          kori ? card(kori.id, 'Kori', 'The default skin', 'star') : null,
          card('default', 'Custom', 'Pick the note type, judgements and colour', 'brush'),
          ...others.map(s => card(s.id, s.name, 'Imported', 'brush')),
          h('button.setup-skinitem.import', { onclick: () => this.importSkins(paint, show) }, h('span.setup-skin-ic', icon('upload')), h('span.setup-skin-t', h('b', 'Import a skin'), h('small', '.osk file from osu!')))),
        ...(cur === 'default' ? [this.customSkinOptions(() => { paint(); show(); })] : []));
    };
    const offSkins = Bus.on('skins:changed', () => { if (this.step.id === 'skin') { paint(); show(); } });
    this.cleanup.push(offSkins);
    paint();
    this.afterRender = () => { this.preview = new SkinPreview(canvas, { scrollSpeed: true }); show(); };
    return [h('div.setup-split', pv, side)];
  },

  /** The Custom (built-in) skin's options: Web-Osu-Mania's note types, its colour, judgement sets and darker holds. */
  customSkinOptions(refresh) {
    const style = Settings.get('wom.style');
    const hueSlider = h('input.slider.setup-hue', { type: 'range', min: 0, max: 360, step: 1, value: Settings.get('wom.hue'), 'aria-label': 'Note colour' });
    hueSlider.addEventListener('change', () => { Settings.set('wom.hue', +hueSlider.value); refresh(); });
    hueSlider.addEventListener('keydown', e => e.stopPropagation());
    const t = h(`button.toggle${Settings.get('wom.darkerHolds') ? '.on' : ''}`, { role: 'switch', 'aria-label': 'Darker hold notes', onclick: () => {
      Settings.set('wom.darkerHolds', !Settings.get('wom.darkerHolds')); UISounds.click(); refresh(); } });
    const jud = h('select.select', { 'aria-label': 'Judgements', onchange: e => { Settings.set('wom.judgements', e.target.value); refresh(); } },
      ...WOM.JUDGEMENT_SETS.map(([v, l]) => h('option', { value: v, selected: v === Settings.get('wom.judgements') }, l)));
    return h('div.setup-custom',
      h('div.setup-label', 'Note type'),
      h('div.setup-seg', ...SETUP_NOTE_STYLES.map(([v, l]) => h(`button${style === v ? '.on' : ''}`, { onclick: () => { Settings.set('wom.style', v); UISounds.click(); refresh(); } }, l))),
      h('div.setup-label', 'Note colour'), hueSlider,
      h('div.setup-label', 'Judgements'), jud,
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
