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
    this.noZoom();
    Orientation.init();
    let quiet = false; try { quiet = localStorage.getItem('am.noInstallPrompt') === '1'; } catch { /* private mode */ }
    if (!App.installed && !quiet) this.showInstall();
    Bus.on('install:available', () => this.inst && this.paintInstall());
  },
  /** No zooming the page on a phone or tablet, in the app or the browser: pinching (iOS ignores the viewport's
   *  user-scalable=no, so its gestures are stopped here) and double-tapping. */
  noZoom() {
    const stop = e => { if (e.cancelable) e.preventDefault(); };
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, stop, { passive: false });
    document.addEventListener('touchmove', e => { if (e.touches.length > 1 || (typeof e.scale === 'number' && e.scale !== 1)) stop(e); }, { passive: false });
    // (double-tap zoom: touch-action: manipulation on the page)
    document.documentElement.classList.add('no-zoom');
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
    // (always an Install button: the browser's own install where it offers one; otherwise how to do it from its menu,
    // which is all iPhones allow)
    const how = h('ol.mob-inst-how', { hidden: true }, ...(this.ios
      ? [h('li', 'Tap the Share button in Safari'), h('li', 'Choose "Add to Home Screen"'), h('li', 'Open Ashtonk!mania from your home screen')]
      : [h('li', 'Open your browser\'s ⋮ menu'), h('li', 'Choose "Install app" (or "Add to Home screen")'), h('li', 'Open Ashtonk!mania from your home screen')]));
    const install = async () => {
      if (App.installPrompt) { if (await App.install()) close(); return; }
      how.hidden = false; // (no one-tap install here: the steps)
    };
    el.append(h('div.mob-inst-box',
      h('img', { src: 'icons/icon-192.png', alt: '' }),
      h('h2', 'Downloading the app is recommended'),
      h('p.mob-inst-warn', 'Playing in the browser isn\'t recommended on phones.'),
      h('p', 'In a browser tab the address bar, swipe gestures and browser timing get in the way. The app opens full screen, runs smoother and plays offline.'),
      how,
      h('div.mob-inst-btns',
        h('button.btn.primary', { onclick: install }, icon('download'), canPrompt || !this.ios ? 'Install the app' : 'How to install'),
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

/** The phone's keyboard, as Android shows it for an app held sideways: it opens over the game (nothing is squeezed or
 *  re-laid out — the viewport's interactive-widget=overlays-content), and a large bar just above it shows what you're
 *  typing (the box itself may be small at the menus' scale, or under the keyboard). Where the browser can't say how
 *  tall the keyboard is, the bar sits along the top of the screen instead. */
const Keyboard = {
  height: 0,
  typing() {
    const a = document.activeElement;
    return a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|file|color|hidden)$/.test(a.type))) && !a.readOnly && !a.disabled ? a : null;
  },
  init() {
    if (!Mobile.touch) return;
    const vk = navigator.virtualKeyboard, vv = window.visualViewport;
    if (vk) { try { vk.overlaysContent = true; } catch { /* not allowed */ } vk.addEventListener('geometrychange', () => { this.vkH = vk.boundingRect ? vk.boundingRect.height : 0; this.upd(); }); }
    if (vv) { vv.addEventListener('resize', () => this.upd()); vv.addEventListener('scroll', () => this.upd()); }
    document.addEventListener('focusin', () => setTimeout(() => this.upd(), 30));
    document.addEventListener('focusout', () => setTimeout(() => this.upd(), 30));
    for (const ev of ['input', 'selectionchange', 'keyup']) document.addEventListener(ev, () => { if (this.bar && !this.bar.hidden) this.paint(); });
    // (the browser mustn't scroll the page itself to the box: the bar shows it instead)
    window.addEventListener('scroll', () => { if (scrollY) scrollTo(0, 0); });
  },
  build() {
    this.label = h('span.kb-label'); this.text = h('span.kb-text');
    this.bar = h('div.kb-bar', { hidden: true }, this.label, h('div.kb-field', this.text),
      h('button.kb-done', { 'aria-label': 'Done', onclick: () => { const a = this.typing(); if (a) a.blur(); } }, icon('check')));
    // (touching the bar keeps the box focused — and the keyboard up — except on the done button)
    this.bar.addEventListener('pointerdown', e => { if (!e.target.closest('.kb-done')) e.preventDefault(); });
    document.body.append(this.bar);
  },
  upd() {
    const a = this.typing();
    const vvH = window.visualViewport ? Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop) : 0;
    this.height = Math.max(this.vkH || 0, vvH > 60 ? vvH : 0);
    // the keyboard put away (the phone's back button) with the box still focused: typing is over — the box lets go
    // and the bar goes, instead of the bar jumping to the top of the screen
    if (a && this.height > 0) this._seen = a;
    else if (a && this._seen === a && !this.height) { this._seen = null; a.blur(); return; }
    if (!a) { this._seen = null; if (this.bar) this.bar.hidden = true; document.documentElement.classList.remove('kb-open'); return; }
    if (!this.bar) this.build();
    this.bar.hidden = false;
    this.bar.classList.toggle('top', !this.height);
    this.bar.style.bottom = this.height ? `${Math.round(this.height)}px` : '';
    document.documentElement.classList.add('kb-open');
    this.paint();
  },
  paint() {
    const a = this.typing();
    if (!a || !this.bar) return;
    const lab = a.getAttribute('aria-label') || a.placeholder || (a.labels && a.labels[0] && a.labels[0].textContent) || '';
    this.label.textContent = lab.length > 28 ? lab.slice(0, 27) + '…' : lab;
    this.label.hidden = !lab;
    let v = a.value || '';
    if (a.type === 'password') v = '•'.repeat(v.length);
    const at = Math.min(v.length, a.selectionStart == null ? v.length : a.selectionStart), end = Math.min(v.length, a.selectionEnd == null ? at : a.selectionEnd);
    const caret = h('i.kb-caret');
    if (!v) this.text.replaceChildren(caret, h('span.kb-ph', a.placeholder || ''));
    else this.text.replaceChildren(v.slice(0, at), ...(end > at ? [h('span.kb-sel', v.slice(at, end))] : [caret]), v.slice(end));
    // (long text: keep the caret in view)
    const f = this.text.parentNode, c = this.text.querySelector('.kb-caret, .kb-sel');
    if (c) { const x = c.offsetLeft; if (x < f.scrollLeft + 20 || x > f.scrollLeft + f.clientWidth - 20) f.scrollLeft = Math.max(0, x - f.clientWidth * 0.7); }
  },
};
if (Mobile.touch) Keyboard.init();

/** Which way the phone is held, as lazer's mobile app: the game is used sideways, and gameplay alone is upright.
 *  The screen is locked that way where the browser allows it (the installed app, or fullscreen); otherwise a prompt
 *  covers the screen until the phone is turned (gameplay waits paused meanwhile). */
const Orientation = {
  el: null,
  /** The menus are used sideways; gameplay either way up — upright (as lazer's app) or sideways, as you hold it. */
  wanted() { return typeof Screens !== 'undefined' && Screens.currentName === 'gameplay' ? 'any' : 'landscape'; },
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
    const want = this.wanted(), wrong = want === 'any' ? false : want === 'portrait' ? !Mobile.portrait : Mobile.portrait;
    this.el.hidden = !wrong;
    this.el.classList.toggle('to-up', want === 'portrait');
    this.el.querySelector('b').textContent = want === 'portrait' ? 'Turn your device upright' : 'Turn your device sideways';
    this.el.querySelector('span').textContent = want === 'portrait' ? 'Gameplay is played upright.' : 'The menus are used sideways — songs play either way up.';
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
  // (outside fullscreen the browser leaves a black strip by the camera cutout, so a tap in the menus puts it back when
  // it was lost — but never during a song: each time a page goes fullscreen the browser shows its own "to exit full
  // screen…" notice, which no page can hide, and it covered the song)
  const full = () => {
    if (App.installed || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    if (document.querySelector('.mob-inst')) return; // (not while the install prompt is up)
    if (typeof Screens !== 'undefined' && Screens.currentName === 'gameplay') return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => Orientation.lock(Orientation.wanted()), () => {});
  };
  document.addEventListener('pointerup', full, true);
}
