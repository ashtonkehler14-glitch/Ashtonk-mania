/* Main menu (osu!lazer's MainMenu + ButtonSystem + OsuLogo). The 512px logo waits in the middle of the screen with the
 * toolbar hidden; clicking it (or pressing any key) shrinks it to half size 228px left of centre and opens the button
 * bar around it: settings on its left; play (→ solo / multi → lounge / ranked play), edit and browse on its right.
 * Six idle seconds bring the big logo back. Behind it is lazer's triangle artwork in the colour of the playing song. */

const HomeScreen = {
  tab: 'home',
  menuState: 'initial',
  IDLE_MS: 6000, // lazer's GameIdleTracker(6000)
  // ButtonSystemState order: a button shows between its min and max state, contracts below and explodes above
  ORDER: { initial: 1, top: 2, play: 3, multi: 4, edit: 5, entering: 6 },
  enter() {
    this.logo = this.buildLogo();
    this.left = h('div.lz-left'); this.right = h('div.lz-right');
    this.buildButtons();
    this.area = h('div.lz-area', h('div.lz-area-bg'), this.left, this.right);
    this.flashL = h('div.msf.l'); this.flashR = h('div.msf.r');
    // lazer's SongTicker: the new song's title and artist at the top right for a few seconds
    this.ticker = h('div.lz-ticker', this.tkTitle = h('div.lz-tk-t'), this.tkArtist = h('div.lz-tk-a'));
    this.tip = h('div.lz-tipbox');
    const el = h('div.home.lz-menu', { dataset: { state: 'initial' } }, MenuTriangles.mount(), this.flashL, this.flashR,
      h('div.lz-stage', this.area, this.logo), this.ticker, h('div.lz-bottom', this.tip), NeruMascot.build(),
      this.fountainCv = h('canvas.lz-fountain'));
    this._parts = []; this._spewers = [];
    this.el = el;
    // coming back (from song select, the lounge…): lazer resumes the menu where you left it — the same row of buttons,
    // growing back out of the logo — instead of starting over at the big logo
    const resume = this._resume || (this._visited ? 'top' : null);
    this._resume = null;
    // (from "entering": the logo is already small in the bar, the bar fades back in and the buttons grow out)
    if (resume) { this.menuState = 'entering'; el.dataset.state = 'entering'; this.setState(resume); } else this.setState(Screens.history.length ? 'top' : 'initial', true);
    // the end of lazer's intro: the logo appears from nothing with a white flash and its impact ring (first visit only)
    if (!Screens.history.length && !this._introDone && Settings.get('ui.animSpeed')) {
      this._introDone = true;
      requestAnimationFrame(() => {
        this.hoverEl.animate([{ scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1 }], { duration: 600, easing: 'cubic-bezier(.16, 1, .3, 1)' });
        this.flash(0.6, 1500, 'cubic-bezier(.16, 1, .3, 1)');
        setTimeout(() => this.impact(), 120);
      });
    }
    this.startMenuMusic();
    this.showTip();
    this._idleAt = performance.now();
    this._poke = () => { this._idleAt = performance.now(); };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, this._poke, { passive: true });
    this._offMusic = Bus.on('music:changed', m => this.showTicker(m));
    this.loop();
    return el;
  },
  leave() {
    cancelAnimationFrame(this._raf); NeruMascot.stop(); MenuTriangles.stop();
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.removeEventListener(ev, this._poke);
    if (this._offMusic) this._offMusic();
    clearTimeout(this._tbT); $('#app').classList.remove('hide-toolbar');
  },

  /** The buttons, in lazer's flow order (left of the logo: settings, back; right: the multi, play, edit and top-level
   *  groups). [id, label, icon, colour, keys, min state, max state, padded side, action]. Colours are lazer's. */
  buttonDefs() {
    const solo = () => this.enterMode(() => Screens.go('songselect', {}, { transition: 'zoom' }));
    return {
      left: [
        ['settings', 'settings', 'gear', '#555555', ['KeyO', 'KeyS'], 'top', 'top', 'r', () => SettingsPanel.open()],
        ['back', 'back', 'backcircle', '#333a5e', [], 'play', 'edit', 'r', () => this.setState(this.menuState === 'multi' ? 'play' : 'top')],
      ],
      right: [
        ['lounge', 'lounge', 'couch', '#5e3fba', ['KeyL', 'KeyM'], 'multi', 'multi', 'l', () => this.enterMode(() => Screens.go('multiplayer'))],
        ['ranked', 'ranked play', 'crown', '#5e3fba', ['KeyR'], 'multi', 'multi', null, () => this.enterMode(() => Screens.go('multiplayer', { ranked: true }))],
        ['solo', 'solo', 'user', '#6644cc', ['KeyP'], 'play', 'play', 'l', solo],
        ['multi', 'multi', 'globe', '#5e3fba', ['KeyM'], 'play', 'play', null, () => this.setState('multi')],
        // lazer's DailyChallengeButton: (94, 63, 186), D
        ['daily', 'daily challenge', 'calendar', '#5e3fba', ['KeyD'], 'play', 'play', null, () => this.enterMode(() => Screens.go('daily'))],
        // where lazer has the beatmap and skin editors: everything for changing what's installed
        ['skins', 'skins', 'brush', '#eeaa00', ['KeyS'], 'edit', 'edit', 'l', () => this.enterMode(() => Screens.go('skins'))],
        ['import', 'import', 'upload', '#dca000', ['KeyI'], 'edit', 'edit', null, () => importViaPicker('.osz,.osk,.zip,.osu,.osr')],
        ['beatmaps', 'beatmaps', 'beatmap', '#eeaa00', ['KeyB', 'KeyE'], 'edit', 'edit', null, () => this.enterMode(() => Screens.go('beatmaps'))],
        ['collections', 'collections', 'folder', '#dca000', ['KeyC'], 'edit', 'edit', null, () => this.enterMode(() => Screens.go('collections'))],
        ['replays', 'replays', 'film', '#eeaa00', ['KeyR'], 'edit', 'edit', null, () => this.enterMode(() => Screens.go('replays'))],
        ['play', 'play', 'osulogo', '#6644cc', ['KeyP', 'KeyM', 'KeyL'], 'top', 'top', 'l', () => this.setState('play')],
        ['edit', 'edit', 'editcircle', '#eeaa00', ['KeyE'], 'top', 'top', null, () => this.setState('edit')],
        ['browse', 'browse', 'beatmap', '#a5cc00', ['KeyB', 'KeyD'], 'top', 'top', null, () => this.enterMode(() => Screens.go('explore'))],
      ],
    };
  },
  buildButtons() {
    this.btns = [];
    const d = this.buttonDefs();
    const mk = ([id, label, ic, color, keys, min, max, pad, fn]) => {
      const ico = h('span.lz-ico', h('span.lz-ico-b', icon(ic)));
      const b = h(`button.lz-btn.gone${pad ? '.p' + pad : ''}`, { style: { '--c': color, '--w': pad ? '160px' : '140px' }, dataset: { id }, 'aria-label': label, tabindex: -1 },
        h('span.lz-bg'), h('span.lz-inner', ico, h('span.lz-label', label)));
      Object.assign(b, { _keys: keys, _min: this.ORDER[min], _max: this.ORDER[max], _fn: fn, _ico: ico });
      b.addEventListener('click', () => this.trigger(b));
      b.addEventListener('pointerenter', () => this.hoverIn(b));
      b.addEventListener('pointerleave', () => this.hoverOut(b));
      b.addEventListener('pointerdown', () => b.classList.add('down'));
      this.btns.push(b);
      return b;
    };
    this.left.append(...d.left.map(mk));
    this.right.append(...d.right.map(mk));
    window.addEventListener('pointerup', () => this.btns && this.btns.forEach(b => b.classList.remove('down')));
  },
  /** lazer's MainMenuButton.trigger: the click sound, the action, and a white flash that fades over 800ms. */
  trigger(b) {
    if (!b.classList.contains('exp')) return;
    UISounds.click();
    const bg = b.firstChild;
    bg.classList.remove('flash'); void bg.offsetWidth; bg.classList.add('flash');
    b._fn();
  },
  /** Choosing something that leaves the menu: the bar folds away (lazer's EnteringMode) as the next screen opens. */
  enterMode(go) { this._resume = ['play', 'multi', 'edit'].includes(this.menuState) ? this.menuState : 'top'; this.setState('entering'); go(); },
  setState(state, instant = false) {
    const last = this.menuState;
    if (state === last && !instant) return;
    if (state !== 'initial') this._visited = true;
    this.menuState = state;
    this.el.dataset.state = state;
    this.el.classList.toggle('lz-instant', instant);
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => this.el && this.el.classList.remove('lz-instant')));
    const S = this.ORDER[state];
    // the bar fades in 150ms after the logo starts moving when coming from the big logo (lazer's delayed sequence)
    const delay = last === 'initial' && !instant ? 150 : 0;
    clearTimeout(this._stT);
    const apply = () => {
      for (const b of this.btns) {
        let st;
        if (state === 'initial') st = 'con';
        else if (state === 'entering') st = 'con1';
        else st = S >= b._min && S <= b._max ? 'exp' : S < b._min ? 'con' : 'xpl';
        this.btnState(b, st, instant);
      }
    };
    if (delay) this._stT = setTimeout(apply, delay); else apply();
    // lazer hides the toolbar while the big logo waits, and brings it back as the logo lands in the bar
    clearTimeout(this._tbT);
    if (state === 'initial') $('#app').classList.add('hide-toolbar');
    else if (last === 'initial' && !instant) this._tbT = setTimeout(() => $('#app').classList.remove('hide-toolbar'), 200);
    else $('#app').classList.remove('hide-toolbar');
    // the logo's impact ring as it lands in the bar
    if (last === 'initial' && (state === 'top' || state === 'play') && !instant) setTimeout(() => this.impact(), 200);
  },
  btnState(b, st, instant) {
    const cur = b._st;
    if (cur === st) return;
    b._st = st;
    clearTimeout(b._goneT);
    b.classList.remove('exp', 'con', 'con1', 'xpl');
    if (st === 'exp') {
      if (b.classList.contains('gone') && !instant) {
        b.classList.remove('gone');
        void b.offsetWidth; // start from nothing so the width grows out
      }
      b.classList.remove('gone');
      b.classList.add('exp');
      b.tabIndex = 0;
    } else {
      b.tabIndex = -1;
      if (b.classList.contains('gone') || instant) { b.classList.add(st, 'gone'); return; }
      b.classList.add(st);
      b._goneT = setTimeout(() => { if (b._st === st) b.classList.add('gone'); }, st === 'con1' ? 820 : st === 'xpl' ? 220 : 520);
    }
  },
  /** lazer's MainMenuButton hover: the button widens to 1.5× with an elastic spring, and its icon tips over and starts
   *  bouncing to the beat. */
  hoverIn(b) {
    if (!b.classList.contains('exp')) return;
    UISounds.hover();
    const ico = b._ico, until = clamp(this._nextBeatIn || 300, 60, 1000);
    this._rightward = !!this._rightward;
    ico.getAnimations().forEach(a => a.cancel());
    ico.firstChild.getAnimations().forEach(a => a.cancel());
    ico.animate([{ rotate: '0deg' }, { rotate: `${this._rightward ? -8 : 8}deg` }], { duration: until, easing: 'cubic-bezier(.37, 0, .63, 1)', fill: 'forwards' });
    ico.firstChild.animate([{ scale: '1 1' }, { scale: '1.2 1.08' }], { duration: until, easing: 'cubic-bezier(.5, 1, .89, 1)', fill: 'forwards' });
  },
  hoverOut(b) {
    const ico = b._ico, inner = ico.firstChild;
    const r = getComputedStyle(ico).rotate, s = getComputedStyle(inner).scale, t = getComputedStyle(inner).translate;
    ico.getAnimations().forEach(a => a.cancel()); inner.getAnimations().forEach(a => a.cancel());
    ico.animate([{ rotate: r === 'none' ? '0deg' : r }, { rotate: '0deg' }], { duration: 500, easing: 'cubic-bezier(.5, 1, .89, 1)' });
    inner.animate([{ scale: s === 'none' ? '1' : s, translate: t === 'none' ? '0 0' : t }, { scale: '1', translate: '0 0', offset: 0.4 }, { scale: '1', translate: '0 0' }], { duration: 500, easing: 'cubic-bezier(.5, 1, .89, 1)' });
  },
  /** On each beat the hovered button's icon swings to the other side over the beat and hops up 10px and back. */
  onBeat(beatLength) {
    this._rightward = !this._rightward;
    const b = this.el && this.btns.find(x => x.matches(':hover') && x.classList.contains('exp'));
    if (!b) return;
    const ico = b._ico, inner = ico.firstChild, half = beatLength / 2;
    const r = getComputedStyle(ico).rotate;
    ico.getAnimations().forEach(a => a.cancel()); inner.getAnimations().forEach(a => a.cancel());
    ico.animate([{ rotate: r === 'none' ? '0deg' : r }, { rotate: `${this._rightward ? 8 : -8}deg` }], { duration: half * 2, easing: 'cubic-bezier(.37, 0, .63, 1)', fill: 'forwards' });
    inner.animate([
      { translate: '0 0', scale: '1.2 1.08', easing: 'cubic-bezier(.5, 1, .89, 1)' },
      { translate: '0 -10px', scale: '1.2 1.2', offset: 0.5, easing: 'cubic-bezier(.11, 0, .5, 0)' },
      { translate: '0 0', scale: '1.2 1.08' }], { duration: half * 2, fill: 'forwards' });
  },
  /** lazer's MenuSideFlashes: the screen's edges light up with the music — both on each bar's first beat, or
   *  left and right in turn on every beat during kiai — as bright as the track is loud, fading over a beat. */
  sideFlash(beat, tp, kiai, amp) {
    if (!this.flashL || !Settings.get('ui.animSpeed')) return;
    const meter = tp.meter || 4;
    // kept soft: a glow that breathes with the music rather than a flash (capped well below full strength)
    const alpha = clamp((amp - 0.3) / 1.6, 0, kiai ? 0.36 : 0.28);
    if (alpha < 0.04) return;
    const rise = 140, dur = rise + tp.beatLength * 1.4;
    // (from wherever the last glow has faded to, so beats close together never pop)
    const flash = el => { const from = +getComputedStyle(el).opacity || 0; el.getAnimations().forEach(a => a.cancel()); el.animate([{ opacity: from, easing: 'cubic-bezier(.3, 0, .2, 1)' }, { opacity: alpha, offset: rise / dur, easing: 'cubic-bezier(.25, .6, .3, 1)' }, { opacity: 0 }], { duration: dur }); };
    if (kiai ? beat % 2 === 0 : beat % meter === 0) flash(this.flashL);
    if (kiai ? beat % 2 === 1 : beat % meter === 0) flash(this.flashR);
  },
  onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return false;
    if (/^F\d+$/.test(e.key)) return false;
    // lazer: any key at the big logo presses the logo
    if (this.menuState === 'initial' && !['Escape', 'Tab'].includes(e.key)) { this.logoClick(); return true; }
    if (e.code === 'KeyU') { UISounds.click(); Screens.go('profile'); return true; } // (listed under ? as a main menu key)
    if (e.key === 'Enter') {
      if (document.activeElement && document.activeElement.classList.contains('lz-btn')) document.activeElement.click();
      else this.logoClick();
      return true;
    }
    const hit = this.btns.find(b => b.classList.contains('exp') && b._keys.includes(e.code));
    if (hit) { this.trigger(hit); return true; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const btns = this.btns.filter(b => b.classList.contains('exp')), i = btns.indexOf(document.activeElement);
      const n = btns[clamp(i + (e.key === 'ArrowRight' ? 1 : -1), 0, btns.length - 1)];
      if (n) { n.focus(); UISounds.hover(); }
      return true;
    }
    return false;
  },
  onBack() {
    if (this.menuState === 'multi') { UISounds.back(); this.setState('play'); return true; }
    if (this.menuState === 'play' || this.menuState === 'edit') { UISounds.back(); this.setState('top'); return true; }
    if (this.menuState === 'top') { UISounds.back(); this.setState('initial'); return true; }
    return true;
  },
  /** The logo: from the big logo, open the bar; in the bar, press the first button of the row showing. */
  logoClick() {
    this.flash(0.4, 1500, 'cubic-bezier(.16, 1, .3, 1)');
    const first = { top: 'play', play: 'solo', multi: 'lounge', edit: 'skins' }[this.menuState];
    if (this.menuState === 'initial') { UISounds.click(); this.setState('top'); return; }
    const b = first && this.btns.find(x => x.dataset.id === first);
    if (b) this.trigger(b);
  },

  /** osu!lazer's OsuLogo, 512px at full size: the pink disc (Gray gradient #ff66ab → #cc5289 with outlined triangles
   *  drifting up) at 94%, the white ring and wordmark over it, the music visualiser around it, and the hover (1.1×,
   *  elastic), press (0.9×), drag (rubber band), beat (a 2% squeeze, a ripple, a white flash in kiai) and impact
   *  animations. */
  buildLogo() {
    this.vis = h('canvas.lz-vis');
    this.tris = h('canvas.lz-tris');
    this.flashEl = h('span.lz-flash');
    this.impactEl = h('span.lz-impact');
    this.ripple = h('span.lz-ripple', h('span.lz-ring'));
    this.beatEl = h('div.lz-lbt', this.vis,
      h('span.lz-cookie-disc.lz-home-disc', this.tris, this.flashEl),
      h('span.lz-ring', h('span.lz-cookie-text', 'ashtonk!', h('small', 'mania'))),
      this.impactEl);
    this.ampEl = h('div.lz-la', this.beatEl);
    this.bounceEl = h('div.lz-lb', this.ripple, this.ampEl);
    this.hoverEl = h('div.lz-lh', this.bounceEl);
    this.cookie = h('button.lz-cookie', { 'aria-label': 'osu! logo', onclick: e => { if (this._dragged) { this._dragged = false; return; } this.logoClick(); } });
    this.cookie.addEventListener('pointerenter', () => { UISounds.hover(); this.hoverEl.classList.add('hover'); });
    this.cookie.addEventListener('pointerleave', () => this.hoverEl.classList.remove('hover'));
    this.cookie.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.bounceEl.classList.add('down');
      const x0 = e.clientX, y0 = e.clientY, k = 1 / (this.menuState === 'initial' ? 1 : 0.5);
      this._dragged = false;
      const move = ev => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0, len = Math.hypot(dx, dy);
        if (len > 4) this._dragged = true;
        const f = len > 0 ? Math.pow(len, 0.6) / len : 0;
        this.bounceEl.style.translate = `${dx * f * k}px ${dy * f * k}px`;
        this.bounceEl.classList.add('drag');
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        this.bounceEl.classList.remove('down', 'drag'); this.bounceEl.style.translate = '';
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    return h('div.lz-logo', this.hoverEl, this.cookie);
  },
  flash(alpha, ms, easing) {
    this.flashEl.getAnimations().forEach(a => a.cancel());
    this.flashEl.animate([{ opacity: alpha }, { opacity: 0 }], { duration: ms, easing });
  },
  impact() {
    this.impactEl.getAnimations().forEach(a => a.cancel());
    this.impactEl.animate([{ opacity: 1, scale: 0.94 }, { opacity: 0, scale: 1.12 }], { duration: 250, easing: 'linear' });
  },
  /** One frame of the logo: lazer's LogoVisualisation (200 bars × 5 rounds around the disc, fed from the music's
   *  spectrum every 50ms and decaying smoothly), the cookie's triangles and the beat. */
  loop() {
    const freq = new Float32Array(200), N = 200;
    let indexOffset = 0, lastUpd = 0, lastBeat = -1, lastT = performance.now(), triY = null, vel = 0.5, amp = 1, visA = 0.5;
    const S = 512, R = S * 0.47, M = 300, CW = S * 0.94 + M * 2;
    const tris = [];
    const spawn = (randomY) => ({ x: Math.random(), y: randomY ? -260 / (S * 0.94) + Math.random() * (1 + 260 / (S * 0.94)) : 1, sp: Math.max(0.5, Math.max(0.1, 0.5 + 0.16 * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.sin(2 * Math.PI * Math.random()))) });
    for (let i = 0; i < 14; i++) tris.push(spawn(true));
    const bw = S * 0.94 * Math.sqrt(2 * (1 - Math.cos(2 * Math.PI / N))) / 2;
    const cosA = new Float32Array(N * 5), sinA = new Float32Array(N * 5);
    for (let j = 0; j < 5; j++) for (let i = 0; i < N; i++) { const a = (i / N * 360 + j * 72) * Math.PI / 180; cosA[j * N + i] = Math.cos(a); sinA[j * N + i] = Math.sin(a); }
    let frame = 0;
    const tick = now => {
      this._raf = requestAnimationFrame(tick);
      const cv = this.vis;
      if (!cv.isConnected) return;
      const dt = Math.min(100, now - lastT); lastT = now;
      // Performance (Chromebook) mode: the visualiser at half resolution, both canvases redrawn every other frame
      const lite = document.documentElement.classList.contains('perf'), draw = !lite || (++frame & 1) === 0;
      const an = AudioManager.analyser, playing = an && Music.playing;
      // ── amplitudes (lazer: every 50ms, the spectrum shifted 5 bars round each time; half as tall outside kiai)
      let peak = 0;
      if (now - lastUpd >= 50) {
        lastUpd = now;
        if (playing) {
          const d = this._fft || (this._fft = new Float32Array(an.frequencyBinCount));
          an.getFloatFrequencyData(d);
          const td = this._td || (this._td = new Float32Array(an.fftSize));
          an.getFloatTimeDomainData(td);
          for (let i = 0; i < td.length; i += 4) { const v = Math.abs(td[i]); if (v > peak) peak = v; }
          this._peak = peak;
          const kiaiMul = this._kiai ? 1 : 0.5;
          for (let i = 0; i < N; i++) {
            const db = d[(i + indexOffset) % N];
            const target = (db > -200 ? Math.pow(10, db / 20) * 2 : 0) * kiaiMul;
            if (target > freq[i]) freq[i] = target;
          }
        } else this._peak = 0;
        indexOffset = (indexOffset + 5) % N;
      }
      const decay = dt * 0.0024;
      for (let i = 0; i < N; i++) { freq[i] -= decay * (freq[i] + 0.03); if (freq[i] < 0) freq[i] = 0; }
      // ── visualiser canvas: logo-local units, the disc's edge at radius 0.47 × 512
      const dpr = lite ? 0.5 : 1;
      if (cv.width !== Math.round(CW * dpr)) { cv.width = cv.height = Math.round(CW * dpr); }
      const x = cv.getContext('2d');
      if (draw) {
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, CW, CW);
      x.globalCompositeOperation = 'lighter';
      x.fillStyle = 'rgba(255,255,255,0.2)';
      x.beginPath();
      const c = CW / 2;
      for (let k = 0; k < N * 5; k++) {
        const i = k % N, v = freq[i];
        if (v < 1 / 600) continue;
        const len = Math.min(M, 600 * v), co = cosA[k], si = sinA[k];
        const px = c + co * R, py = c + si * R, ox = -si * bw / 2, oy = co * bw / 2, ax = co * len, ay = si * len;
        x.moveTo(px - ox, py - oy); x.lineTo(px - ox + ax, py - oy + ay); x.lineTo(px + ox + ax, py + oy + ay); x.lineTo(px + ox, py + oy); x.closePath();
      }
      x.fill();
      }
      // ── the cookie's triangles (TrianglesV2: 14 outlines, 300 wide, drifting up at 50px/s × velocity)
      vel = playing ? vel + ((this._kiai ? 2 : 1) - vel) * (1 - Math.pow(0.995, dt)) : vel + (0.5 - vel) * (1 - Math.pow(0.9, dt));
      if (this._kick) { vel += this._kick; this._kick = 0; }
      const tc = this.tris, TS = lite ? 192 : 384;
      if (tc.width !== TS) { tc.width = tc.height = TS; this._triGrad = null; }
      const tx = tc.getContext('2d');
      const D = S * 0.94, sc = TS / D, triW = 300 * sc, triH = 260 * sc;
      const moved = dt / 1000 * vel * 50 / D;
      for (let i = tris.length - 1; i >= 0; i--) {
        const t = tris[i];
        t.y -= Math.max(0.5, t.sp) * moved;
        if (t.y + 260 / D < 0) tris.splice(i, 1);
      }
      while (tris.length < 14) tris.push(spawn(false));
      if (!this._triGrad) { const g = tx.createLinearGradient(0, 0, 0, TS); g.addColorStop(0, '#ff66ab'); g.addColorStop(1, '#b6346f'); this._triGrad = g; }
      if (draw) {
        tx.clearRect(0, 0, TS, TS);
        tx.strokeStyle = this._triGrad; tx.lineWidth = 0.009 * 260 * sc * 2.6; tx.lineJoin = 'round';
        tx.beginPath();
        for (const t of tris) {
          const lx = t.x * TS, ty = t.y * TS;
          tx.moveTo(lx + triW / 2, ty); tx.lineTo(lx + triW, ty + triH); tx.lineTo(lx, ty + triH); tx.closePath();
        }
        tx.stroke();
      }
      // ── beat (60ms early, as lazer's logo), from the playing track's red lines
      const tm = Music.meta && Music.meta.timing;
      if (tm && Music.playing) {
        const t = Music.time + 60, i = Math.max(0, bsearchLE(tm, t, 'time')), tp = tm[i];
        const beat = Math.floor((t - tp.time) / tp.beatLength), key = i * 100000 + beat;
        this._nextBeatIn = tp.time + (beat + 1) * tp.beatLength - 60 - Music.time;
        if (key !== lastBeat && t >= tp.time && beat >= 0) {
          lastBeat = key;
          const kp = tm.kiai && tm.kiai.length ? tm.kiai[Math.max(0, bsearchLE(tm.kiai, t, 'time'))] : null;
          const kiai = !!(kp && kp.on && t >= kp.time);
          // lazer's KiaiMenuFountains: stars burst from both bottom corners as kiai starts (not when joining mid-kiai)
          if (kiai && !this._kiai && Math.abs(t - kp.time) < 500 && !lite) this.shootFountains();
          this._kiai = kiai;
          const adj = Math.min(1, 0.4 + (this._peak || 0));
          this.logoBeat(tp.beatLength, adj, kiai);
          setTimeout(() => this.onBeat(tp.beatLength), 60);
          let a = 0; for (let j = 0; j < 8; j++) a = Math.max(a, freq[j] * 4);
          this.sideFlash(beat, tp, kiai, a);
        }
      } else { this._kiai = false; this._nextBeatIn = 300; if (now - (this._idleBeat || 0) > 600) { this._idleBeat = now; this.onBeat(600); } }
      this.drawFountains(now);
      // the logo's amplitude breathing: 4% smaller as the music gets loud (lazer's Damp(0.9))
      const target = 1 - Math.max(0, (this._peak || 0) - 0.4) * 0.04;
      amp = target + (amp - target) * Math.pow(0.9, dt);
      const ampS = amp.toFixed(3);
      if (ampS !== this._ampS) { this._ampS = ampS; this.ampEl.style.scale = ampS; } // (a style write only when it moves)
      // idle for a while: back to the big logo, as when the game opens
      if (this.menuState !== 'initial' && this.menuState !== 'entering' && now - this._idleAt > this.IDLE_MS && !Overlays.stack.length && !SettingsPanel.o && !NowPlaying.open) this.setState('initial');
    };
    this._raf = requestAnimationFrame(tick);
  },
  /** lazer's StarFountain: each corner fountain (250px in from the side) spews 240 stars a second for 0.8s, shot
   *  upwards at ~1400px/s with gravity pulling them back, the sideways push (toward the middle, straight up or
   *  outward, picked at random) easing from 500px/s to the other way over the burst; each star lives 0.3–1s, fades
   *  out, grows to ~2.2× and spins. Drawn additively. */
  shootFountains() {
    if (!Settings.get('ui.animSpeed')) return;
    const dir = Math.floor(Math.random() * 3) - 1, now = performance.now();
    const l = dir === -1 ? 1 : dir === 0 ? 0 : -1, r = -l;
    this._spewers = [{ side: 'l', dir: l, t0: now, n: 0 }, { side: 'r', dir: r, t0: now, n: 0 }];
  },
  starSprite() {
    if (this._star) return this._star;
    const c = document.createElement('canvas'); c.width = 68; c.height = 68;
    const x = c.getContext('2d');
    const path = () => { x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 9 : 21; x.lineTo(34 + Math.cos(a) * rr, 36 + Math.sin(a) * rr); } x.closePath(); };
    x.shadowColor = 'rgba(140, 220, 255, .9)'; x.shadowBlur = 10; x.fillStyle = '#fff'; path(); x.fill();
    x.shadowBlur = 0; path(); x.fill();
    return (this._star = c);
  },
  drawFountains(now) {
    const cv = this.fountainCv;
    if (!cv) return;
    const parts = this._parts, sp = this._spewers;
    if (!parts.length && !sp.length) { if (this._fountainDirty) { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); this._fountainDirty = false; } return; }
    const W = cv.clientWidth, H = cv.clientHeight, dpr = Zoom.dpr();
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const rnd = v => (Math.random() * 2 - 1) * v;
    for (let i = sp.length - 1; i >= 0; i--) {
      const f = sp[i], el = now - f.t0, want = Math.min(192, Math.floor(Math.min(el, 800) * 0.24));
      for (; f.n < want; f.n++) {
        const at = f.n / 0.24; // when this star was due
        parts.push({ x0: f.side === 'l' ? 250 : W - 250, born: f.t0 + at, D: 300 + Math.random() * 700,
          vx: f.dir * 500 * (1 - 2 * at / 800) + rnd(60), vy: -1400 + rnd(100), a0: rnd(4), a1: rnd(2), s1: 2.2 + rnd(0.4) });
      }
      if (el >= 800) sp.splice(i, 1);
    }
    const x = cv.getContext('2d'), star = this.starSprite();
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    x.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i], k = now - p.born;
      if (k < 0) continue;
      if (k >= p.D) { parts.splice(i, 1); continue; }
      const prog = k / p.D, sc = 1 + (p.s1 - 1) * prog;
      const px = p.x0 + p.vx * k / 1000, py = H + (p.vy + 800 * (p.D / 1000) * prog) * k / 1000;
      x.globalAlpha = 1 - prog;
      x.setTransform(dpr * sc, 0, 0, dpr * sc, px * dpr, py * dpr);
      x.rotate(p.a0 + (p.a1 - p.a0) * prog);
      x.drawImage(star, -17, -17, 34, 34);
    }
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.setTransform(1, 0, 0, 1, 0, 0);
    this._fountainDirty = true;
  },
  /** lazer's OsuLogo.OnNewBeat: a 2% squeeze over 60ms then out over two beats, a ripple of the ring growing 4% as it
   *  fades, and in kiai a white flash and a brighter visualiser; the triangles get a push. */
  logoBeat(beatLength, adj, kiai) {
    if (!Settings.get('ui.animSpeed')) return;
    const b = this.beatEl;
    b.getAnimations().forEach(a => a.cancel());
    b.animate([{ scale: 1, easing: 'cubic-bezier(.5, 1, .89, 1)' }, { scale: 1 - 0.02 * adj, offset: 60 / (60 + beatLength * 2), easing: 'cubic-bezier(.22, 1, .36, 1)' }, { scale: 1 }], { duration: 60 + beatLength * 2 });
    const a = +this.ampEl.style.scale || 1;
    this.ripple.getAnimations().forEach(x => x.cancel());
    this.ripple.animate([{ scale: a, opacity: 0.15 * adj }, { scale: a * (1 + 0.04 * adj), opacity: 0 }], { duration: beatLength, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    if (kiai && (+getComputedStyle(this.flashEl).opacity || 0) < 0.4) {
      this.flashEl.getAnimations().forEach(x => x.cancel());
      this.flashEl.animate([{ opacity: 0, easing: 'cubic-bezier(.5, 1, .89, 1)' }, { opacity: 0.2 * adj, offset: 60 / (60 + beatLength) }, { opacity: 0 }], { duration: 60 + beatLength });
      this.vis.getAnimations().forEach(x => x.cancel());
      this.vis.animate([{ opacity: 0.5, easing: 'cubic-bezier(.5, 1, .89, 1)' }, { opacity: 0.9 * adj, offset: 60 / (60 + beatLength) }, { opacity: 0.5 }], { duration: 60 + beatLength });
    }
    setTimeout(() => { this._kick = (this._kick || 0) + adj * (kiai ? 6 : 3); NeruMascot.beat(adj, kiai); }, 60);
  },
  /** lazer's SongTicker: fades in over 0.4s, stays 4s, fades out over 0.8s. */
  showTicker(m) {
    if (!m || !this.ticker || m.id === this._tickerFor) return;
    this._tickerFor = m.id;
    this.tkTitle.textContent = m.title; this.tkArtist.textContent = m.artist;
    this.ticker.getAnimations().forEach(a => a.cancel());
    this.ticker.animate([{ opacity: 0 }, { opacity: 1, offset: 400 / 5200 }, { opacity: 1, offset: 4400 / 5200 }, { opacity: 0 }], { duration: 5200 });
  },
  /** lazer's MenuTipDisplay: a tip at the bottom each time you come back to the menu — it pops in after 0.6s and
   *  fades out once there's been time to read it. */
  TIPS: [
    'Press Ctrl+O anywhere in the game to access settings!',
    'If you find the UI too large or small, try adjusting UI scaling in settings!',
    'Press F6 anywhere to see what\'s playing, skip songs or open the playlist!',
    'Scroll over the note in the top bar to change the volume from any screen!',
    'Press ? on any screen to see its keyboard shortcuts!',
    'Use F3 and F4 (or Ctrl − and Ctrl +) while playing to change your scroll speed!',
    'Press Tab while playing to show or hide the leaderboard!',
    'Get more options for a beatmap by right-clicking on its panel at song select!',
    'Press F2 at song select for a random beatmap; Shift+F2 goes back to the one before!',
    'Drop .osz, .osk and .osr files anywhere on the game to import them!',
    'Ranked Play lets you queue for rated 1v1 matches against players of your skill!',
    'Press Ctrl+B anywhere to browse for new beatmaps!',
  ],
  showTip() {
    if (Settings.get('ui.menuTips') === false || !this.tip) return;
    let i; do { i = Math.floor(Math.random() * this.TIPS.length); } while (this.TIPS.length > 1 && i === this._lastTip);
    this._lastTip = i;
    const tip = this.TIPS[i];
    clearEl(this.tip).append(h('div.lz-tip-t', icon('bulb'), h('b', 'Menu tip')), h('div.lz-tip-b', tip));
    const hold = 1000 + 80 * tip.length, total = 600 + 800 + hold + 2000;
    this.tip.getAnimations().forEach(a => a.cancel());
    this.tip.animate([
      { opacity: 0, scale: 0.9 }, { opacity: 0, scale: 0.9, offset: 600 / total, easing: 'cubic-bezier(.22, 1, .36, 1)' },
      { opacity: 1, scale: 1, offset: 1400 / total }, { opacity: 1, scale: 1, offset: (1400 + hold) / total, easing: 'cubic-bezier(.22, 1, .36, 1)' },
      { opacity: 0, scale: 1 }], { duration: total, fill: 'both' });
  },
  async startMenuMusic() {
    const id = Settings.get('last.map');
    let map = id && BeatmapManager.maps.get(id);
    if (!map || map.problems.length) { const all = BeatmapManager.playableMaps(); map = all[Math.floor(Math.random() * all.length)]; }
    if (!map) { Background.set(null); return; }
    const url = await BeatmapManager.bgURL(map) || await BeatmapManager.thumbURL(BeatmapManager.setById.get(map.setId));
    Background.set(url);
    if (Music.meta && Music.loaded && (Music.playing || MenuMusic.paused)) { Music.onEnded = () => MenuMusic.next(); return; }
    await MenuMusic.play(map);
  },
};

/** osu!lazer's main menu background (its default menu-background artwork): a still picture of triangles — a gradient
 *  from top to bottom, big solid triangles banked up both sides with soft shadows, faint outlined triangles across
 *  the middle, and a ring of small bright outlined triangles around the logo. lazer ships it in a few colours; here
 *  it takes the colour of the playing song's background, and crossfades to the next song's colour. Drawn once per
 *  colour (and size), never animated. Geometry is in a 2000×1125 frame, scaled to cover the screen. */
const MenuTriangles = {
  col: null, running: false,
  // up-pointing equilateral triangles [apex x, apex y, side]; `down` ones point down from a top edge [left x, top y, side]
  // (traced from lazer's menu-background artwork; the light wedges between them are gaps between solids)
  SOLID: [
    [160, -310, 600], [7, -76, 700], [272, 237, 256], [359, 175, 102], [530, -130, 240], [673, 15, 100],
    [-50, 453, 800], [98, 640, 400], [207, 557, 252], [137, 700, 600], [378, 842, 700], [478, 912, 100], [790, 1000, 95], [730, 1035, 150],
    [1666, -63, 260], [2025, -320, 600], [1950, -83, 500], [1963, 157, 400], [1958, 303, 1100], [1697, 410, 97], [1760, 450, 100],
    [1632, 620, 255], [1660, 735, 164], [1680, 782, 800], [1384, 925, 600],
  ],
  OUTLINE: [
    [730, 62, 196], [834, -45, 190], [957, -153, 221], [518, 8, 340], [460, 234, 190], [420, 460, 195], [505, 535, 200], [338, 530, 62],
    [482, 655, 315], [643, 807, 280], [767, 860, 140], [890, 1000, 170], [1300, -70, 220], [1448, -103, 393], [1519, 180, 260],
    [1651, 124, 198], [1507, 443, 130], [1570, 483, 170], [1523, 705, 165], [1462, 731, 340], [1290, 897, 330], [1148, 1053, 90],
  ],
  // the ring around the logo: [apex x, apex y, side]
  RING: [
    [833, 202, 64], [963, 200, 110], [1036, 167, 70], [740, 296, 170], [848, 324, 83], [803, 355, 136], [694, 497, 98], [748, 540, 98],
    [633, 601, 64], [737, 602, 158], [818, 678, 170], [882, 739, 64], [986, 853, 64],
    [1148, 280, 103], [1219, 264, 186], [1321, 363, 103], [1236, 477, 64], [1269, 497, 83], [1353, 583, 64], [1254, 600, 94],
    [1220, 617, 195], [1119, 712, 195],
  ],
  mount() {
    this.el = h('div.lz-tri', { 'aria-hidden': 'true' });
    this.running = true; this.col = null; this._drawn = null;
    if (!this._sub) this._sub = Bus.on('bg:changed', url => this.fromImage(url));
    this._ro = new ResizeObserver(() => { clearTimeout(this._rt); this._rt = setTimeout(() => this.render(true), 120); });
    this._ro.observe(this.el);
    this.fromImage(Background.current);
    return this.el;
  },
  stop() { this.running = false; if (this._ro) this._ro.disconnect(); this._ro = null; clearTimeout(this._rt); },
  /** Average colour of the background image → the picture's hue and saturation. */
  async fromImage(url) {
    let col = [326, 0.38];
    if (url) {
      try {
        const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; await img.decode();
        const c = document.createElement('canvas'); c.width = c.height = 12;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, 12, 12);
        const d = x.getImageData(0, 0, 12, 12).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { const w = 0.2 + Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w; }
        const [hh, ss] = rgbToHsl(r / n, g / n, b / n);
        col = [hh, clamp(ss * 1.1 + 0.08, 0.16, 0.62)];
      } catch (e) { /* unreadable image: lazer's own plum */ }
    }
    if (url !== Background.current && url) return;
    this.col = col;
    this.render();
  },
  /** Draw the picture in the current colour and fade it in over the last one. */
  render(resized = false) {
    const el = this.el;
    if (!el || !el.isConnected || !this.col) { if (el && !el.isConnected && this.running) requestAnimationFrame(() => this.running && this.render(resized)); return; }
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(el.clientWidth * dpr)), H = Math.max(1, Math.round(el.clientHeight * dpr));
    const key = `${this.col[0].toFixed(1)}|${this.col[1].toFixed(3)}|${W}x${H}`;
    if (key === this._drawn) return;
    this._drawn = key;
    const cv = h('canvas');
    cv.width = W; cv.height = H;
    this.paint(cv.getContext('2d'), W, H, this.col);
    const old = [...el.children];
    el.append(cv);
    if (!old.length || resized) { old.forEach(o => o.remove()); return; }
    cv.classList.add('in');
    requestAnimationFrame(() => requestAnimationFrame(() => cv.classList.remove('in')));
    setTimeout(() => old.forEach(o => o.remove()), 1000);
  },
  paint(x, W, H, [hue, sat]) {
    const k = Math.max(W / 2000, H / 1125), ox = (W - 2000 * k) / 2, oy = (H - 1125 * k) / 2;
    const S = v => (v * 100).toFixed(1) + '%', hsl = (h2, s2, l2, a = 1) => `hsla(${((h2 % 360) + 360) % 360} ${S(clamp(s2, 0, 1))} ${S(clamp(l2, 0, 1))} / ${a})`;
    // the gradient: lighter at the top, darker at the bottom
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, hsl(hue, sat, 0.205)); g.addColorStop(1, hsl(hue + 4, sat * 1.05, 0.095));
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.setTransform(k, 0, 0, k, ox, oy);
    const R3 = Math.sqrt(3) / 2;
    const up = (ax, ay, s) => { x.beginPath(); x.moveTo(ax, ay); x.lineTo(ax + s / 2, ay + s * R3); x.lineTo(ax - s / 2, ay + s * R3); x.closePath(); };
    // faint outlines first (they sit behind the solid banks)
    x.lineWidth = 2.2; x.lineJoin = 'miter';
    for (const [ax, ay, s] of this.OUTLINE) {
      const l = 0.16 - 0.07 * clamp((ay + s * R3 / 2) / 1125, 0, 1);
      x.strokeStyle = hsl(hue, sat * 1.05, l, 0.9); up(ax, ay, s); x.stroke();
    }
    // the solid banks, each a shade darker than the gradient behind it, with lazer's soft shadow
    // (one gradient for all of them, so overlapping triangles merge into one bank, as in lazer's picture)
    x.shadowColor = 'rgba(0, 0, 0, .3)'; x.shadowBlur = 16 * k;
    const sg = x.createLinearGradient(0, 0, 0, 1125);
    sg.addColorStop(0, hsl(hue, sat * 1.04, 0.152)); sg.addColorStop(1, hsl(hue + 3, sat * 1.04, 0.066));
    x.fillStyle = sg;
    x.beginPath();
    for (const [ax, ay, s] of this.SOLID) { x.moveTo(ax, ay); x.lineTo(ax + s / 2, ay + s * R3); x.lineTo(ax - s / 2, ay + s * R3); x.closePath(); }
    x.fill(); // (one shape: overlapping triangles merge, with no seams or shadows inside a bank)
    x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetY = 0;
    // the ring: bright outlines in two accent colours, top to bottom (lazer's orange → peach and pink → peach)
    const a1 = [hue + 48, 0.82, 0.62], a2 = [hue + 62, 0.95, 0.83], b1 = [hue - 8, 0.95, 0.74];
    x.lineWidth = 2.6;
    for (const [ax, ay, s] of this.RING) {
      const t = clamp((ay + s * 0.43 - 170) / 720, 0, 1), left = ax < 1000;
      const top = left ? a1 : b1, c = [top[0] + (a2[0] - top[0]) * t, top[1] + (a2[1] - top[1]) * t, top[2] + (a2[2] - top[2]) * t];
      x.strokeStyle = hsl(c[0], c[1], c[2]); up(ax, ay, s); x.stroke();
    }
    x.setTransform(1, 0, 0, 1, 0, 0);
  },
};
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s, l];
}

/** Where menu music / song-select previews start: the beatmap's PreviewTime, or 40% in (as osu! does) when
 *  the map doesn't set one. */
function previewStart(map) { return map.previewTime > 0 ? map.previewTime : Math.round((map.length || 0) * 0.4); }
/** Red-line timing for the menu beat pulse (parsed after playback has started). */
async function beatTiming(map) {
  const parsed = await BeatmapManager.load(map.id).catch(() => null);
  if (!parsed) return null;
  const out = BeatmapParser.timing(parsed.bm).red.map(r => ({ time: r.time, beatLength: r.beatLength, meter: r.meter || 4 }));
  // kiai sections (bit 1 of a timing point's effects), for the menu's side flashes
  out.kiai = (parsed.bm.timingPoints || []).map(t => ({ time: t.time, on: !!(t.effects & 1) })).sort((a, b) => a.time - b.time);
  return out;
}

/** Background music (main menu / everywhere outside gameplay) with previous / pause / next. */
const MenuMusic = {
  paused: false, current: null, history: [],
  async play(map, { fromPreview = true } = {}) {
    if (!map) return;
    const tok = this._tok = {};
    try {
      await AudioManager.resume();
      const blob = await BeatmapManager.getFile(map.setId, map.audioFile);
      if (tok !== this._tok) return; // another track was requested meanwhile
      if (!blob) throw new Error('missing audio');
      Music.stream(blob, `${map.setId}/${map.audioFile}`, { setId: map.setId, mapId: map.id, timing: null });
      Music.play(fromPreview ? previewStart(map) : 0, { fadeIn: 600 });
      Music.onEnded = () => this.next();
      this.paused = false;
      this.setCurrent(map);
      beatTiming(map).then(timing => { if (tok === this._tok && Music.meta && Music.meta.mapId === map.id) Music.meta.timing = timing; });
    } catch (e) { console.warn('menu music', e); }
  },
  setCurrent(map) { this.current = map; Toolbar.setNowPlaying(map); Bus.emit('music:changed', map); },
  toggle() {
    // nothing loaded yet (preview audio off, or the first track never started): play starts one
    if (!Music.loaded && !Music.playing) {
      const sel = Screens.currentName === 'songselect' && BeatmapManager.maps.get(SongSelect.selectedId);
      if (sel && !sel.problems.length) this.play(sel); else this.next();
      return;
    }
    if (Music.playing) { Music.pause(); this.paused = true; }
    else if (Music.loaded) { Music.play(Music.pausedPos, { fadeIn: 250 }); this.paused = false; }
    Bus.emit('music:changed', this.current);
  },
  /** Switching tracks also switches the selected beatmap when song select is open (like lazer). */
  async go(map, fromPreview) {
    if (!map) return;
    Settings.set('last.map', map.id);
    if (Screens.currentName === 'songselect') { SongSelect.select(map.id); return; }
    Background.set(await BeatmapManager.bgURL(map));
    this.play(map, { fromPreview });
  },
  /** Next track. With shuffle on (lazer's default) it's a shuffled run through every set, so a small library plays
   *  each song once before any repeats; with it off, the next set in the list. */
  async next() {
    const sets = this.playable();
    if (!sets.length) return;
    this.dir = 1;
    if (this.current) this.history.push(this.current.id);
    let set;
    if (Settings.get('audio.shuffle') === false) {
      const i = this.current ? sets.findIndex(s => s.id === this.current.setId) : -1;
      set = sets[(i + 1) % sets.length];
    } else {
      const have = new Set(sets.map(s => s.id));
      this.queue = (this.queue || []).filter(id => have.has(id) && (!this.current || id !== this.current.setId));
      if (!this.queue.length) {
        const ids = sets.map(s => s.id).filter(id => sets.length < 2 || !this.current || id !== this.current.setId);
        for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
        this.queue = ids;
      }
      set = BeatmapManager.setById.get(this.queue.shift());
    }
    this.go(set.maps.find(m => !m.problems.length), false);
  },
  /** lazer's MusicController.PreviousTrack: past 5 seconds in, back to the start of this one; otherwise the track
   *  before (the one played before it with shuffle on, the set above it in the list with shuffle off). */
  async prev() {
    if (Music.loaded && Music.time >= 5000) { if (Music.playing) Music.play(0, { fadeIn: 150 }); else Music.pausedPos = 0; Bus.emit('music:changed', this.current); return; }
    this.dir = -1;
    if (Settings.get('audio.shuffle') === false) {
      const sets = this.playable();
      if (!sets.length) return;
      const i = this.current ? sets.findIndex(s => s.id === this.current.setId) : 0;
      const set = sets[(i - 1 + sets.length) % sets.length];
      this.go(set.maps.find(m => !m.problems.length), false);
      return;
    }
    const id = this.history.pop();
    const map = id && BeatmapManager.maps.get(id);
    if (!map) { this.dir = 0; if (Music.loaded) Music.play(0, { fadeIn: 150 }); return; }
    this.go(map, false);
  },
  playable() { return BeatmapManager.sets.filter(s => s.maps.some(m => !m.problems.length)); },
};
