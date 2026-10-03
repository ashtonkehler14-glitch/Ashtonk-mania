/* Phones and tablets, the way osu!lazer on Android plays: the full interface in landscape (Zoom scales it), a prompt to
 * turn an upright phone sideways (with a one-tap full screen + landscape lock), and a nudge to install the app, which
 * opens full screen and landscape by itself (manifest.webmanifest). */

const Mobile = {
  get touch() { return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches; },
  get portrait() { return innerHeight > innerWidth; },
  get ios() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },
  init() {
    if (!this.touch) return;
    window.addEventListener('resize', () => this.sync());
    Bus.on('screen:changed', () => this.sync());
    Bus.on('install:available', () => this.offerInstall());
    this.sync();
    setTimeout(() => this.offerInstall(), 4000);
  },
  /** Full screen, then landscape (browsers only lock the orientation of a full-screen page). */
  async goLandscape() {
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
    try { await screen.orientation.lock('landscape'); } catch {}
  },
  /** Upright on a phone: ask to rotate (gameplay itself is fine upright, so it's never interrupted). */
  sync() {
    const want = this.touch && this.portrait && !this._dismissed && Screens.currentName !== 'gameplay' && Math.min(innerWidth, innerHeight) < 700;
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
  /** "Get the app": the browser's own install prompt where there is one; iPhones and iPads only add to the home
   *  screen by hand, so they're told how. Asked again a week after "Not now"; never once installed. */
  offerInstall() {
    if (!this.touch || App.installed || this.card || Screens.currentName === 'gameplay') return;
    let until = 0; try { until = +localStorage.getItem('am.installLater') || 0; } catch {}
    if (Date.now() < until) return;
    const canPrompt = !!App.installPrompt;
    if (!canPrompt && !this.ios && !/Android/.test(navigator.userAgent)) return;
    const how = canPrompt ? 'Full screen, landscape and offline, like the osu!lazer app.'
      : this.ios ? 'Tap Share, then "Add to Home Screen", to play full screen and offline.'
      : 'Open your browser\'s menu and choose "Install app" or "Add to Home screen" to play full screen and offline.';
    const close = later => {
      if (later) { try { localStorage.setItem('am.installLater', String(Date.now() + 7 * 86400e3)); } catch {} }
      const c = this.card; this.card = null;
      if (c) { c.classList.add('out'); setTimeout(() => c.remove(), 300); }
    };
    this.card = h('div.mob-install', { role: 'dialog', 'aria-label': 'Install the app' },
      h('img', { src: 'icons/icon-192.png', alt: '' }),
      h('div.mob-in-txt', h('b', 'Get the Ashtonk!mania app'), h('span', how)),
      h('div.mob-in-btns',
        canPrompt ? h('button.btn.primary', { onclick: async () => { const ok = await App.install(); close(!ok); } }, 'Install') : null,
        h('button.btn', { onclick: () => close(true) }, canPrompt ? 'Not now' : 'Got it')));
    (document.getElementById('app') || document.body).append(this.card); // (inside the app, so it scales with the rest)
  },
};

// from the very first screen (setup included): app-like touch behaviour; a long press is a hold in the game, never the
// browser's menu (text boxes keep theirs, for paste)
if (Mobile.touch) {
  document.documentElement.classList.add('touch');
  document.addEventListener('contextmenu', e => { if (!e.target.closest || !e.target.closest('input, textarea')) e.preventDefault(); });
}
