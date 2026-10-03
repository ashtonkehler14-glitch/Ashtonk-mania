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
    if (!App.installed) this.showInstall();
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
      h('h2', 'Install the app to play'),
      h('p.mob-inst-warn', 'Playing in the browser isn\'t recommended on phones.'),
      h('p', 'In a browser tab the address bar, swipe gestures and browser timing get in the way. The app opens full screen, turns either way, runs smoother and plays offline.'),
      how,
      h('div.mob-inst-btns',
        canPrompt ? h('button.btn.primary', { onclick: async () => { if (await App.install()) close(); } }, 'Install the app') : null,
        h('button.mob-inst-skip', { onclick: close }, 'Continue in the browser (not recommended)'))));
  },
};

// from the very first screen (setup included): app-like touch behaviour; a long press is a hold in the game, never the
// browser's menu (text boxes keep theirs, for paste)
if (Mobile.touch) {
  document.documentElement.classList.add('touch');
  document.addEventListener('contextmenu', e => { if (!e.target.closest || !e.target.closest('input, textarea')) e.preventDefault(); });
}
