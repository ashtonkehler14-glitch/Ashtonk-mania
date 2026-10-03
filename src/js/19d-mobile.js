/* Phones and tablets. Menus as osu!lazer on Android plays them: the full interface in landscape (Zoom scales it) and a
 * prompt to turn an upright phone sideways. Gameplay as Friday Night Funkin' plays on phones: FNF's arrows, colours
 * and judgements, and the screen split into one full-height hitbox per column. And, straight away, a recommendation
 * to install the app (full screen, landscape, offline: manifest.webmanifest), since a browser tab plays worse. */

const Mobile = {
  get touch() { return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches; },
  get portrait() { return innerHeight > innerWidth; },
  get ios() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },
  /** FNF's note colours, by the way an arrow points (WOM.ARROWS angles): left purple, down cyan, up green, right red,
   *  and the diagonals of the extra-key modes. */
  FNF: { 270: '#c24b99', 180: '#00ffff', 0: '#12fa05', 90: '#f9393f', 315: '#ffd700', 45: '#ff7f00', 225: '#8b5cff', 135: '#2f7dff' },
  fnfColor(keys, i) { const a = (WOM.ARROWS[keys - 1] || [])[i]; return Mobile.FNF[a] || '#ffffff'; },

  /** Right after loading (before the first-run setup): recommend the app. */
  early() {
    if (!this.touch) return;
    if (!App.installed) this.showInstall();
    Bus.on('install:available', () => this.inst && this.paintInstall());
  },
  /** After the first-run setup. */
  init() {
    if (!this.touch) return;
    this.applyFnfDefaults();
    window.addEventListener('resize', () => this.sync());
    Bus.on('screen:changed', () => this.sync());
    this.sync();
  },
  /** Once per device: the custom skin set up as FNF (arrows, FNF colours for every key count, FNF judgements).
   *  Everything stays changeable in Settings → Skin. */
  applyFnfDefaults() {
    let done = false; try { done = localStorage.getItem('am.fnfMobile') === '1'; } catch {}
    if (done) return;
    try { localStorage.setItem('am.fnfMobile', '1'); } catch {}
    const dark = c => { const n = parseInt(c.slice(1), 16); const f = v => Math.round(v * 0.55).toString(16).padStart(2, '0'); return '#' + f(n >> 16 & 255) + f(n >> 8 & 255) + f(n & 255); };
    const custom = Array.from({ length: 18 }, (_, k) => Array.from({ length: k + 1 }, (_, i) => { const c = this.fnfColor(k + 1, i); return { tap: c, holdHead: c, hold: dark(c) }; }));
    SkinManager.select('default', { silent: true }).catch(() => Settings.set('skin.current', 'default'));
    Settings.set('wom.style', 'arrows');
    Settings.set('wom.judgements', 'fnf');
    Settings.set('wom.customColors', custom);
    Settings.set('wom.colorMode', 'custom');
  },
  /** Full screen, then landscape (browsers only lock the orientation of a full-screen page). */
  async goLandscape() {
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
    try { await screen.orientation.lock('landscape'); } catch {}
  },
  /** Upright on a phone: ask to rotate (gameplay itself is fine upright, so it's never interrupted). */
  sync() {
    const want = this.touch && this.portrait && !this._dismissed && !this.inst && Screens.currentName !== 'gameplay' && Math.min(innerWidth, innerHeight) < 700;
    if (!want) { if (this.rot) { this.rot.remove(); this.rot = null; } return; }
    if (this.rot) return;
    this.rot = h('div.mob-rotate', { role: 'dialog', 'aria-label': 'Rotate your device' },
      h('div.mob-rot-ic', h('i')),
      h('h2', 'Turn your device sideways'),
      h('p', 'Ashtonk!mania is laid out for landscape, like osu!lazer on Android.'),
      h('div.mob-rot-btns',
        document.documentElement.requestFullscreen || (screen.orientation && screen.orientation.lock) ? h('button.btn.primary', { onclick: () => this.goLandscape() }, 'Full screen & landscape') : null,
        h('button.btn', { onclick: () => { this._dismissed = true; this.sync(); } }, 'Stay upright')));
    document.body.append(this.rot);
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
    const close = () => { const e = this.inst; this.inst = null; if (e) { e.classList.add('out'); setTimeout(() => e.remove(), 250); } this.sync(); };
    const canPrompt = !!App.installPrompt;
    const how = canPrompt ? null
      : this.ios ? h('ol.mob-inst-how', h('li', 'Tap the Share button in Safari'), h('li', 'Choose "Add to Home Screen"'), h('li', 'Open Ashtonk!mania from your home screen'))
      : h('ol.mob-inst-how', h('li', 'Open your browser\'s ⋮ menu'), h('li', 'Choose "Install app" or "Add to Home screen"'), h('li', 'Open Ashtonk!mania from your home screen'));
    el.append(h('div.mob-inst-box',
      h('img', { src: 'icons/icon-192.png', alt: '' }),
      h('h2', 'Install the app to play'),
      h('p.mob-inst-warn', 'Playing in the browser isn\'t recommended on phones.'),
      h('p', 'In a browser tab the address bar, swipe gestures and browser timing get in the way. The app opens full screen and sideways, runs smoother and plays offline.'),
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
