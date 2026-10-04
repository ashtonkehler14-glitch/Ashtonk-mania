/* Phones and tablets. Menus: held sideways, the full interface as osu!lazer on Android shows it (Zoom scales it);
 * held upright, the portrait layout. Gameplay laid out and played as Friday Night Funkin' is on phones (the renderer's
 * touch layout, and the screen split into one full-height hitbox per column), in whatever skin is chosen. And, straight
 * away, a recommendation to install the app (full screen, offline, turning either way: manifest.webmanifest), since a
 * browser tab plays worse. */

const Mobile = {
  get touch() { return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches; },
  get portrait() { return innerHeight > innerWidth; },
  get ios() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },

  /** Right after loading (before the first-run setup): recommend the app. */
  early() {
    if (!this.touch) return;
    Orientation.init();
    let quiet = false; try { quiet = localStorage.getItem('am.noInstallPrompt') === '1'; } catch { /* private mode */ }
    if (!App.installed && !quiet) this.showInstall();
    Bus.on('install:available', () => this.inst && this.paintInstall());
  },
  /** After the first-run setup. */
  init() {
    if (!this.touch) return;
    this.undoFnfSkin();
  },
  /** An earlier version set the custom skin up as FNF's on phones (arrows, FNF colours and judgements): put back the
   *  skin's own defaults, once. The FNF part is how gameplay is laid out and played (ManiaRenderer, hitboxes), not a skin. */
  undoFnfSkin() {
    let was = false; try { was = localStorage.getItem('am.fnfMobile') === '1'; localStorage.removeItem('am.fnfMobile'); } catch {}
    if (!was) return;
    if (Settings.get('wom.style') === 'arrows') Settings.set('wom.style', 'bars');
    if (Settings.get('wom.judgements') === 'fnf') Settings.set('wom.judgements', 'azureSnowfall');
    if (Settings.get('wom.colorMode') === 'custom') Settings.set('wom.colorMode', 'simple');
    Settings.set('wom.customColors', null);
  },
  /** "Install the app": every time the game opens in a phone's browser. The browser's own install prompt where there is
   *  one; iPhones and iPads only add to the home screen by hand, so they're told how. */
  showInstall() {
    if (this.inst) return;
    this.inst = h('div.mob-inst', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Install the app' });
    this.paintInstall();
    document.body.append(this.inst);
  },
  paintInstall() {
    const el = this.inst;
    if (!el) return;
    clearEl(el);
    const close = () => { const e = this.inst; this.inst = null; if (e) { e.classList.add('out'); setTimeout(() => e.remove(), 250); } };
    const canPrompt = !!App.installPrompt;
    const how = canPrompt ? null
      : this.ios ? h('ol.mob-inst-how', h('li', 'Tap the Share button in Safari'), h('li', 'Choose "Add to Home Screen"'), h('li', 'Open Ashtonk!mania from your home screen'))
      : h('ol.mob-inst-how', h('li', 'Open your browser\'s ⋮ menu'), h('li', 'Choose "Install app" or "Add to Home screen"'), h('li', 'Open Ashtonk!mania from your home screen'));
    el.append(h('div.mob-inst-box',
      h('img', { src: 'icons/icon-192.png', alt: '' }),
      h('h2', 'Downloading the app is recommended'),
      h('p.mob-inst-warn', 'Playing in the browser isn\'t recommended on phones.'),
      h('p', 'In a browser tab the address bar, swipe gestures and browser timing get in the way. The app opens full screen, turns either way, runs smoother and plays offline.'),
      how,
      h('div.mob-inst-btns',
        canPrompt ? h('button.btn.primary', { onclick: async () => { if (await App.install()) close(); } }, icon('download'), 'Download the app') : null,
        h('button.mob-inst-skip', { onclick: close }, 'Continue on the website (not recommended)')),
      h('label.mob-inst-quiet', h('input', { type: 'checkbox', onchange: e => { try { e.target.checked ? localStorage.setItem('am.noInstallPrompt', '1') : localStorage.removeItem('am.noInstallPrompt'); } catch { /* private mode */ } } }), 'Don\'t remind me again')));
  },
};

// from the very first screen (setup included): app-like touch behaviour; a long press is a hold in the game, never the
// browser's menu (text boxes keep theirs, for paste)
if (Mobile.touch) {
  document.documentElement.classList.add('touch');
  document.addEventListener('contextmenu', e => { if (!e.target.closest || !e.target.closest('input, textarea')) e.preventDefault(); });
}

/** The phone's keyboard, as an app handles it: it opens over the game (nothing is squeezed or re-laid out — the
 *  viewport's interactive-widget=overlays-content), and the whole screen slides up just enough to keep the box you're
 *  typing in visible above it, sliding back down when it closes. */
const Keyboard = {
  pan: 0,
  init() {
    const vv = window.visualViewport;
    if (!vv || !Mobile.touch) return;
    const upd = () => {
      const a = document.activeElement, typing = a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && !/^(checkbox|radio|range|button|file|color)$/.test(a.type);
      const covered = innerHeight - (vv.height + vv.offsetTop); // (how much of the page the keyboard is over)
      let pan = 0;
      if (typing && covered > 80) {
        const r = a.getBoundingClientRect(), limit = vv.offsetTop + vv.height - 10;
        pan = Math.max(0, Math.min(covered, this.pan + r.bottom - limit));
      }
      if (Math.abs(pan - this.pan) < 1) return;
      this.pan = pan;
      document.documentElement.style.setProperty('--kb-pan', `${Math.round(pan)}px`);
      document.documentElement.classList.toggle('kb-open', pan > 0);
    };
    vv.addEventListener('resize', upd); vv.addEventListener('scroll', upd);
    document.addEventListener('focusin', () => setTimeout(upd, 60));
    document.addEventListener('focusout', () => setTimeout(upd, 60));
    // (the browser mustn't scroll the page itself to the box: it's panned here instead)
    window.addEventListener('scroll', () => { if (scrollY) scrollTo(0, 0); });
  },
};
if (Mobile.touch) Keyboard.init();

/** Which way the phone is held, as lazer's mobile app: the game is used sideways, and gameplay alone is upright.
 *  The screen is locked that way where the browser allows it (the installed app, or fullscreen); otherwise a prompt
 *  covers the screen until the phone is turned (gameplay waits paused meanwhile). */
const Orientation = {
  el: null,
  wanted() { return typeof Screens !== 'undefined' && Screens.currentName === 'gameplay' ? 'portrait' : 'landscape'; },
  lock(kind) { try { const o = screen.orientation; o && o.lock && o.lock(kind).catch(() => {}); } catch { /* not supported */ } this.update(); },
  init() {
    if (this.el || !Mobile.touch) return;
    this.el = h('div.rot-prompt', { hidden: true, role: 'alert' }, h('div.rot-ph'), h('b'), h('span'));
    document.body.append(this.el);
    window.addEventListener('resize', () => this.update());
    document.addEventListener('fullscreenchange', () => this.lock(this.wanted()));
    const hook = () => { if (typeof Bus === 'undefined') return setTimeout(hook, 200); Bus.on('screen:changed', () => this.update()); };
    hook();
    this.lock('landscape');
  },
  update() {
    if (!this.el) return;
    const want = this.wanted(), wrong = want === 'portrait' ? !Mobile.portrait : Mobile.portrait;
    this.el.hidden = !wrong;
    this.el.classList.toggle('to-up', want === 'portrait');
    this.el.querySelector('b').textContent = want === 'portrait' ? 'Turn your device upright' : 'Turn your device sideways';
    this.el.querySelector('span').textContent = want === 'portrait' ? 'Gameplay is played upright.' : 'The game is used sideways — only gameplay is upright.';
  },
};

// ── phones on the website (not the installed app) ─────────────────────────────
if (Mobile.touch) {
  /** The keyboard opens only when you tap a text box yourself: a box the game focuses on its own (song select's
   *  search, the settings' search, the chat…) stays unfocused on a phone unless your tap was on or around it. */
  let lastDown = null, lastAt = 0;
  document.addEventListener('pointerdown', e => { lastDown = e.target; lastAt = performance.now(); }, true);
  const typable = el => (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|file|color)$/.test(el.type)));
  for (const P of [HTMLInputElement.prototype, HTMLTextAreaElement.prototype]) {
    const focus = P.focus;
    P.focus = function (...a) {
      if (typable(this) && !(lastDown && performance.now() - lastAt < 800 && (lastDown === this || (lastDown.contains && lastDown.contains(this)) || (this.closest && lastDown.closest && this.parentElement && this.parentElement.contains(lastDown))))) return;
      return focus.apply(this, a);
    };
  }
  /** The website goes fullscreen on your first tap (and again after you leave it), with the screen's turn locked the
   *  way the game wants it (sideways; upright in gameplay). The installed app is fullscreen already. */
  const full = () => {
    if (App.installed || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    if (document.querySelector('.mob-inst')) return; // (not while the install prompt is up)
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => Orientation.lock(Orientation.wanted()), () => {});
  };
  document.addEventListener('pointerup', full, true);
}
