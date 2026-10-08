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
    // (once a visit: not again on every reload — and never over a multiplayer match the reload is taking you back into)
    let quiet = false, again = false;
    try {
      quiet = localStorage.getItem('am.noInstallPrompt') === '1';
      const r = JSON.parse(sessionStorage.getItem('mp.rejoin') || 'null');
      again = sessionStorage.getItem('am.instShown') === '1' || !!(r && Date.now() - r.at < 60000);
      sessionStorage.setItem('am.instShown', '1');
    } catch { /* private mode */ }
    if (!App.installed && !quiet && !again) this.showInstall();
    Bus.on('install:available', () => this.inst && this.paintInstall());
  },
  /** No zooming the page on a phone or tablet, in the app or the browser: pinching (iOS ignores the viewport's
   *  user-scalable=no, so its gestures are stopped here) and double-tapping. */
  noZoom() {
    const stop = e => { if (e.cancelable) e.preventDefault(); };
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, stop, { passive: false });
    document.addEventListener('touchmove', e => { if (e.touches.length > 1 || (typeof e.scale === 'number' && e.scale !== 1)) stop(e); }, { passive: false });
    // two fingers up or down change the volume (as the mouse wheel does on a computer) — not mid-song, where two
    // fingers are two keys
    let vol = null;
    document.addEventListener('touchstart', e => {
      const playing = Screens.currentName === 'gameplay' && GameplayScreen.s && GameplayScreen.s.running && GameplayScreen.s.mode === 'play';
      vol = e.touches.length === 2 && !playing && !(e.target.closest && e.target.closest('input, textarea, .se, .editor')) ? { y: (e.touches[0].clientY + e.touches[1].clientY) / 2, acc: 0 } : null;
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!vol || e.touches.length !== 2) return;
      const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      vol.acc += vol.y - y; vol.y = y;
      // (one step — 5% — for every 24px the fingers move; up is louder)
      while (Math.abs(vol.acc) >= 24) { const d = Math.sign(vol.acc); vol.acc -= d * 24; VolumeOverlay.adjust(VolumeOverlay.sel || 'master', d * 0.05); }
      if (e.cancelable) e.preventDefault(); // (the page doesn't scroll under it)
    }, { passive: false });
    document.addEventListener('touchend', e => { if (e.touches.length < 2) vol = null; }, { passive: true });
    // (double-tap zoom: touch-action: manipulation on the page)
    document.documentElement.classList.add('no-zoom');
  },
  /** After the first-run setup. */
  init() {
    if (!this.touch) return;
    this.undoFnfSkin();
    this.backKey();
  },
  /** The phone's own Back (button or swipe) works as Esc does, like lazer on Android: closes what's open, pauses a
   *  play, goes back a screen — instead of leaving the game. At the main menu's big logo with nothing open, it
   *  leaves as usual. */
  backKey() {
    const mark = () => { try { history.pushState({ amBack: 1 }, ''); } catch {} };
    const atRoot = () => Screens.currentName === 'home' && HomeScreen.menuState === 'initial' && !Overlays.top() && !(typeof SettingsPanel !== 'undefined' && SettingsPanel.o);
    mark();
    addEventListener('popstate', () => {
      if (atRoot()) { history.back(); return; }
      mark();
      const t = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
      if (t.blur && /^(INPUT|TEXTAREA)$/.test(t.tagName)) t.blur(); // (Back puts the keyboard away first, as on Android)
      else t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    });
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
    // a phone keyboard's Enter / Send that doesn't arrive as an Enter key (a line break, or key "Unidentified" with
    // keyCode 13): sent on to a chat box as one, so the message goes
    document.addEventListener('beforeinput', e => { const a = e.target; if (e.inputType === 'insertLineBreak' && this.sends(a)) { e.preventDefault(); this.enter(a); } }, true);
    document.addEventListener('keydown', e => { if (e.isTrusted && e.keyCode === 13 && e.key !== 'Enter' && this.sends(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); this.enter(e.target); } }, true);
    // a chat message sent (the box emptied by its Enter): the keyboard goes away, as in a messaging app — it comes back
    // with a tap on the box for the next one (a message that couldn't go keeps its text, and the keyboard)
    document.addEventListener('keydown', e => { if (e.key === 'Enter' && this.sends(e.target)) this.afterSend(e.target); }, true); // (capture: before the box's own handler empties it)
    // (the browser mustn't scroll the page itself to the box: the bar shows it instead)
    window.addEventListener('scroll', () => { if (scrollY) scrollTo(0, 0); });
  },
  build() {
    this.label = h('span.kb-label'); this.text = h('span.kb-text');
    this.doneBtn = h('button.kb-done', { 'aria-label': 'Done', onclick: () => {
      const a = this.typing();
      // a chat box: the button sends, as Enter does (and the keyboard then goes away)
      if (a && this.sends(a)) { if (a.value.trim()) this.enter(a); return; }
      if (a) a.blur();
    } }, icon('check'));
    this.count = h('span.kb-count');
    this.bar = h('div.kb-bar', { hidden: true }, this.label, h('div.kb-field', this.text), this.count, this.doneBtn);
    // (touching the bar keeps the box focused — and the keyboard up — except on the done button, unless it sends)
    this.bar.addEventListener('pointerdown', e => { const a = this.typing(); if (!e.target.closest('.kb-done') || (a && this.sends(a))) e.preventDefault(); });
    document.body.append(this.bar);
  },
  /** A chat box: its keyboard key and the bar's button send the message. */
  sends(a) { return !!a && (a.enterKeyHint === 'send' || a.getAttribute('aria-label') === 'Chat message'); },
  afterSend(a) {
    const had = a.value;
    setTimeout(() => { if (had.trim() && !a.value && document.activeElement === a) a.blur(); }, 0);
  },
  /** Enter, as the box's own handler listens for it (some phone keyboards don't send a proper one). */
  enter(a) { a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); },
  upd() {
    const a = this.typing();
    if (a && this.sends(a) && a.enterKeyHint !== 'send') a.enterKeyHint = 'send';

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
    // (a chat box: the button is Send)
    const send = this.sends(a);
    if (this.doneBtn._send !== send) { this.doneBtn._send = send; this.doneBtn.setAttribute('aria-label', send ? 'Send' : 'Done'); this.doneBtn.replaceChildren(icon(send ? 'send' : 'check')); }
    this.bar.classList.toggle('kb-chat', send);
    this.doneBtn.classList.toggle('off', send && !(a.value || '').trim()); // (nothing to send yet)
    // where the message goes (the chat's channel or the player), else what the box is for
    const lab = a.dataset.kbLabel || a.getAttribute('aria-label') || a.placeholder || (a.labels && a.labels[0] && a.labels[0].textContent) || '';
    // (the characters left, once it's getting close to the box's limit)
    const max = a.maxLength > 0 ? a.maxLength : 0, left = max - (a.value || '').length;
    this.count.textContent = max && left <= 50 ? String(left) : '';
    this.count.classList.toggle('low', max > 0 && left <= 10);
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

// ── phones and tablets (the website and the installed app) ─────────────────────
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
  /** The game goes fullscreen on your first tap (and again after you leave it), with the screen's turn locked the
   *  way the game wants it (sideways; upright in gameplay). The installed app too: it opens fullscreen, but the phone's
   *  own panels (Samsung's pull-down, the edge panel) take it out of that, and it came back with the status bar and a
   *  black strip by the camera — now the next tap puts it back. */
  // (outside fullscreen the browser leaves a black strip by the camera cutout, so a tap in the menus puts it back when
  // it was lost — but never during a song: each time a page goes fullscreen the browser shows its own "to exit full
  // screen…" notice, which no page can hide, and it covered the song)
  const full = () => {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    if (document.querySelector('.mob-inst')) return; // (not while the install prompt is up)
    if (typeof Screens !== 'undefined' && Screens.currentName === 'gameplay') return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => Orientation.lock(Orientation.wanted()), () => {});
  };
  document.addEventListener('pointerup', full, true);
  // (back from the phone's own panels or another app: the layout is fitted to the whole screen again — the browser
  // reports the new size late, after the bars have gone — and the next tap restores fullscreen)
  const refit = () => { for (const ms of [0, 250, 700]) setTimeout(() => window.dispatchEvent(new Event('resize')), ms); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refit(); });
  window.addEventListener('focus', refit);
  document.addEventListener('fullscreenchange', refit);
}
