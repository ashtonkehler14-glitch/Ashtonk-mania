/* Gameplay screen: owns a play session.
 *  TimingEngine: song time = Music.time (audio clock) − audio offset.
 *  InputManager: keyboard events are timestamped with KeyboardEvent.timeStamp and mapped onto the
 *                audio clock, so judgement never depends on frame timing.
 *  Rendering follows the clock at whatever refresh rate the display runs (optional limiter). */

const Game = {
  /** Launch gameplay. opts: {mapId, mods, mode: 'play'|'practice'|'replay', replay} */
  launch(opts) {
    PlayScreen.enter();
    // (a search box still focused would keep the phone's keyboard up over the song)
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (opts.mode !== 'replay') this.rememberDiff(opts.mapId);
    Screens.go('gameplay', { ...opts, force: true }, { transition: 'zoom' });
  },
  /** Song select opens each song on the difficulty last played from it. */
  rememberDiff(mapId) {
    const m = mapId && BeatmapManager.maps.get(mapId);
    if (!m) return;
    const memo = { ...(Settings.get('songselect.lastDiff') || {}) };
    delete memo[m.setId]; memo[m.setId] = m.id; // (newest last, so the oldest go first once there are a lot)
    const keys = Object.keys(memo);
    for (let i = 0; i < keys.length - 5000; i++) delete memo[keys[i]];
    Settings.set('songselect.lastDiff', memo);
  },
};

/** Gameplay fills the screen: fullscreen while playing (the setting, on by default). On phones and tablets, as in
 *  lazer's mobile app, the game is used sideways and only gameplay is upright: the screen turns upright for the song
 *  and back sideways after (where the browser lets it lock the turn; otherwise Orientation asks — see 19d-mobile).
 *  Leave fullscreen mid-song (the browser's bar swiped back, Esc) and a tap or click on the game puts it back. */
/** The screen stays on while playing (a song with few notes would otherwise let a phone dim and lock). */
const WakeLock = {
  lock: null,
  async hold() {
    if (!('wakeLock' in navigator) || this.lock) return;
    try { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); } catch { /* not allowed */ }
    if (!this._vis) { this._vis = () => { if (document.visibilityState === 'visible' && Screens.currentName === 'gameplay') this.hold(); }; document.addEventListener('visibilitychange', this._vis); }
  },
  release() { const l = this.lock; this.lock = null; if (l) l.release().catch(() => {}); },
};

const PlayScreen = {
  want() { return Settings.get('input.fullscreenOnPlay') || (typeof Mobile !== 'undefined' && Mobile.touch); },
  enter() {
    const el = document.documentElement;
    // (fullscreen keeps Esc for the game — the Keyboard Lock API: one press pauses, holding it leaves fullscreen)
    const keys = () => { try { navigator.keyboard && navigator.keyboard.lock && navigator.keyboard.lock(['Escape']).catch(() => {}); } catch { /* not supported */ } };
    if (document.fullscreenElement) keys();
    if (this.want() && !document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).then(() => { keys(); this.lock(); }, () => {});
    else this.lock();
  },
  lock() { clearTimeout(this._unT); if (typeof Orientation !== 'undefined') Orientation.lock('portrait'); },
  unlock() {
    // (a retry comes straight back to gameplay: don't turn the screen in between)
    clearTimeout(this._unT);
    this._unT = setTimeout(() => { if (Screens.currentName !== 'gameplay' && typeof Orientation !== 'undefined') Orientation.lock('landscape'); }, 500);
  },
  /** On the gameplay screen: a tap or click (a gesture the browser accepts for fullscreen) restores it. */
  attach(el) {
    const back = () => { if (this.want() && !document.fullscreenElement && Screens.currentName === 'gameplay') this.enter(); };
    for (const t of ['pointerup', 'touchend']) el.addEventListener(t, back, { passive: true });
  },
};

/** A blurred copy of an image (blob URL), cached. `amount` 0–1 ≈ osu!lazer's blur (up to 25px at 1080p). */
const _blurCache = new Map();
function blurredImage(url, amount) {
  const key = url + '|' + amount;
  if (_blurCache.has(key)) return _blurCache.get(key);
  const p = (async () => {
    const img = new Image(); img.src = url; await img.decode();
    const scale = Math.min(1, 960 / Math.max(1, img.naturalWidth)); // blurred anyway: half-ish resolution is plenty
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), hh = Math.max(1, Math.round(img.naturalHeight * scale));
    const px = amount * 25 * (w / 1920) * 2;
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    const x = c.getContext('2d');
    x.filter = `blur(${px.toFixed(1)}px)`;
    const pad = px * 3; // draw oversized so the edges don't fade to transparent
    x.drawImage(img, -pad, -pad, w + pad * 2, hh + pad * 2);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    return URL.createObjectURL(blob);
  })();
  _blurCache.set(key, p);
  while (_blurCache.size > 6) { const k = _blurCache.keys().next().value; _blurCache.get(k).then(u => URL.revokeObjectURL(u)).catch(() => {}); _blurCache.delete(k); }
  return p;
}

/** Gamepads are only polled while one is actually connected (navigator.getGamepads() isn't free). */
const GamepadWatch = {
  connected: 0,
  init() {
    addEventListener('gamepadconnected', () => { this.connected++; });
    addEventListener('gamepaddisconnected', () => { this.connected = Math.max(0, this.connected - 1); });
  },
};
GamepadWatch.init();

const PRACTICE_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const REPLAY_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2];
const FAIL_WIND_DOWN = 1.2; // seconds the song takes to wind down after a fail

/** Which health bar a play shows: the skin's own (top left, or beside the stage), osu!lazer's, the slim stage bar,
 *  or none. A skin without scorebar images gets the osu!lazer bar. */
function healthModeFor(layout) {
  if (!Settings.get('gameplay.showHealth')) return null;
  const hs = Settings.get('gameplay.healthStyle');
  if (hs === 'stage') return 'stage';
  if ((hs === 'skin' || hs === 'skinstage') && layout && layout.tex.scorebarColour) return hs;
  return 'lazer';
}

/** The skin's own health bar, as osu!lazer draws it (LegacyHealthDisplay): scorebar-bg in the top-left corner,
 *  scorebar-colour cut to the current health and eased towards it, and the ki / marker sprite riding the end of
 *  the fill (it bulges when health goes up). Legacy HUD art is authored for a 768-pixel-tall screen. */
class SkinHealthBar {
  constructor(L) {
    const t = L.tex;
    this.bg = t.scorebarBg || null; this.fill = t.scorebarColour; this.marker = t.scorebarMarker || null;
    this.ki = t.scorebarKi || []; this.newStyle = !!this.marker;
    // fill offset inside the background: (3, 10) or (7.5, 7.8) stable units × 1.6
    this.fx = this.bg ? (this.newStyle ? 12 : 4.8) : 0; this.fy = this.bg ? (this.newStyle ? 12.48 : 16) : 0;
    const marks = [this.marker, ...this.ki].filter(Boolean);
    this.pad = marks.length ? Math.max(...marks.map(m => Math.max(m.w, m.h))) * 0.7 : 0;
    this.el = h('canvas.hud-skinhp');
    this.shown = 1; this.value = 1; this.t = 0; this.bulgeT = -1e9; this.drawn = null; this.size = 0;
  }
  /** The container's height, kept by a ResizeObserver: reading clientHeight every frame forced a layout per frame. */
  _height() {
    const p = this.el.parentElement;
    if (!p) return innerHeight;
    if (this._ro !== p) {
      this._ro = p; this._ph = p.clientHeight;
      new ResizeObserver(es => { if (this._ro === p) this._ph = es[0].contentRect.height; }).observe(p);
    }
    return this._ph || innerHeight;
  }
  resize() {
    const H = this._height();
    const u = H / 768, dpr = Zoom.dpr();
    const w = Math.max(this.bg ? this.bg.w : 0, this.fx + this.fill.w) + this.pad, hh = Math.max(this.bg ? this.bg.h : 0, this.fy + this.fill.h) + this.pad;
    this.u = u; this.k = u * dpr;
    this.el.width = Math.ceil(w * this.k); this.el.height = Math.ceil(hh * this.k);
    this.el.style.width = (w * u) + 'px'; this.el.style.height = (hh * u) + 'px';
    this.size = H; this.drawn = null;
  }
  update(v, now) {
    v = clamp(v, 0, 1);
    if (!this.size || Math.abs(this._height() - this.size) > 1) this.resize();
    const dt = clamp(now - (this.t || now), 0, 200); this.t = now;
    if (v > this.value + 1e-6) this.bulgeT = now; // HealthChanged(increase): the marker bulges
    this.value = v;
    // osu!lazer: fill width = ValueAt(elapsed, width, target, 0, 200, OutQuint)
    const p = 1 - Math.pow(1 - dt / 200, 5);
    this.shown += (v - this.shown) * p;
    if (Math.abs(this.shown - v) < 1e-4) this.shown = v;
    const bulging = now - this.bulgeT < 160, animated = this.fill.frames.length > 1;
    const key = Math.round(this.shown * this.fill.w * this.k * 2);
    if (key === this.drawn && !bulging && !animated) return;
    this.drawn = key;
    // (a skin unloaded mid-draw leaves closed images behind: stop drawing instead of throwing every frame)
    try { this.draw(now); } catch (e) { this.update = () => {}; console.warn('health bar', e); }
  }
  draw(now) {
    const c = this.el.getContext('2d'), hp = this.shown;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.el.width, this.el.height);
    c.setTransform(this.k, 0, 0, this.k, 0, 0);
    if (this.bg) c.drawImage(this.bg.img, 0, 0, this.bg.w, this.bg.h);
    const f = this.fill.frameAt(now), fw = this.fill.w * hp;
    if (fw > 0.01) {
      c.drawImage(f, 0, 0, f.width * hp, f.height, this.fx, this.fy, fw, this.fill.h);
      // new-style fills darken below half health and turn red below 20% (LegacyHealthDisplay.getFillColour)
      if (this.newStyle && hp < 0.5) {
        c.save();
        c.globalCompositeOperation = 'source-atop';
        c.globalAlpha = hp < 0.2 ? 1 : (0.5 - hp) / 0.5;
        c.fillStyle = hp < 0.2 ? `rgb(${Math.round(255 * (0.2 - hp) / 0.2)},0,0)` : '#000';
        c.fillRect(this.fx, this.fy, fw, this.fill.h);
        c.restore();
      }
    }
    const m = this.newStyle ? this.marker : (hp < 0.2 ? this.ki[2] : hp < 0.5 ? this.ki[1] : this.ki[0]) || this.ki[0];
    if (m) {
      const el = now - this.bulgeT, sc = el < 150 ? 1.2 - 0.4 * (el / 150) : this.bulgeT > 0 ? 0.8 : 1;
      const mw = m.w * sc, mh = m.h * sc, mx = this.fx + fw, my = this.fy + (this.newStyle ? this.fill.h / 2 : 0);
      if (this.newStyle && hp >= 0.5) c.globalCompositeOperation = 'lighter';
      c.drawImage(m.frameAt(now), mx - mw / 2, my - mh / 2, mw, mh);
      c.globalCompositeOperation = 'source-over';
    }
  }
}

const PlayerLoaderStatics = { battery: false };

const GameplayScreen = {
  inGame: true, transient: true, tab: 'songselect',
  s: null, // session

  enter(params) {
    const el = h('div.gameplay');
    this.el = el; this.speedEl = null;
    this.bgEl = h('div.gp-bg'); this.dimEl = h('div.gp-dim');
    this.videoEl = h('video.gp-video', { muted: true, playsinline: true, preload: 'auto' }); this.videoEl.muted = true;
    this.canvas = h('canvas.gp-canvas');
    this.breakEl = h('div.gp-break', { hidden: true });
    this.hud = h('div.gp-hud');
    this.failEl = h('div.gp-fail');
    el.append(this.bgEl, this.videoEl, this.dimEl, this.canvas, this.failEl, this.breakEl, this.hud);
    PlayScreen.attach(el);
    PlayScreen.lock(); // (also on a retry, which doesn't go through Game.launch)
    WakeLock.hold();
    // the keyboard is the game's: nothing else keeps focus (the button that started the song took Space and Enter)
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
    el.tabIndex = -1; requestAnimationFrame(() => { if (el.isConnected) el.focus({ preventScroll: true }); });
    el.addEventListener('pointerdown', () => { if (document.activeElement !== el && !(document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) el.focus({ preventScroll: true }); });
    this._orient = () => { if (typeof Mobile !== 'undefined' && Mobile.touch && !Mobile.portrait && this.s && this.s.running && !this.s.mp && !this.s.replay && !this.s.spectate) this.tapToResume(); };
    window.addEventListener('resize', this._orient);
    this.renderer = new ManiaRenderer(this.canvas, { crop: true });
    this.params = params;
    this._tok = {};
    if (!params.quick) this.retryCount = 0;
    this.bgRec = BeatmapManager.maps.get(params.mapId) || null;
    el.classList.add('loading');
    this.loaderGone = false; this.loaderHold = false; this.loaderSkip = false;
    this.loaderEl = this.buildLoader(params);
    el.append(this.loaderEl);
    this.holdEl = h('div.hold-retry', h('span', icon('retry'), 'Hold R to retry'), h('i'));
    el.append(this.holdEl);
    if (this.bgRec) this.applyBackground();
    Toast.clear(); // don't leave menu notifications over the score and combo
    this._keydown = e => this.onKeyDown(e);
    this._keyup = e => this.onKeyUp(e);
    // losing focus pauses a solo play; a match can't pause, but keys held down would never see their keyup — let them go
    this._blur = () => { if (this.s && this.s.running) { if (this.s.spectate) return; if (!this.s.mp) { if (this.phone()) this.tapToResume(); else this.pause(); } else this.releaseAll(); } };
    // leaving fullscreen mid-song pauses it (on a computer the browser takes the Esc that leaves it): the pause menu,
    // or on a phone a tap to go back
    this._fsc = () => {
      const s = this.s;
      if (document.fullscreenElement || !PlayScreen.want() || App.installed || !s || !s.running || s.mp || s.spectate || s.replay) return;
      if (this.phone()) this.tapToResume(); else this.pause();
    };
    document.addEventListener('fullscreenchange', this._fsc);
    // spectating: coming back to the tab goes straight back to the live play (no pause menu)
    this._vis = () => { if (document.visibilityState === 'visible' && this.s && this.s.spectate) Spectate.catchUp(this, this.s); };
    document.addEventListener('visibilitychange', this._vis);
    window.addEventListener('keydown', this._keydown, true);
    window.addEventListener('keyup', this._keyup, true);
    // touch screens: each finger presses the column under it (sliding across moves it), as on osu!lazer mobile
    this._touches = new Map();
    this._touch = e => this.onTouch(e);
    for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) el.addEventListener(t, this._touch, { passive: false });
    window.addEventListener('blur', this._blur);
    this._audioSub = Bus.on('audio:state', st => { if (st !== 'running') this._blur(); });
    this._mm = e => {
      if (e.pointerType === 'touch') return; // (fingers playing aren't a cursor to show)
      if (!el.classList.contains('show-cursor') && this.replayBar && this.s) this.updateReplayBar(this.gameTime(), true); // it's about to fade in
      el.classList.add('show-cursor'); clearTimeout(this._mmT); this._mmT = setTimeout(() => el.classList.remove('show-cursor'), 1500);
    };
    el.addEventListener('pointermove', this._mm);
    // lazer: the middle mouse button pauses (and, on the pause screen, continues)
    el.addEventListener('pointerdown', e => {
      if (e.button !== 1 || !this.s || this.s.mp || this.s.replay) return;
      e.preventDefault();
      if (this.pauseEl && !this.s.failed && this.pauseEl.querySelector('.pm-btn.primary')) this.resume(); else if (!this.pauseEl) this.pause();
    });
    this._settingsSub = Bus.on('settings:changed', k => { if (this.s && k !== 'gameplay.scrollSpeed' && (k.startsWith('gameplay.') || k.startsWith('skin.') || k.startsWith('wom.') || k === 'graphics.renderScale' || k === '*')) { this.renderer.resize(true); this.applyBackground(); const rp = this.hud && this.hud.querySelector('.hud-replay'); if (rp) rp.classList.toggle('low', this.renderer.up); }
      if (k === 'debug.overlay' && this.debugEl) this.debugEl.hidden = !Settings.get('debug.overlay'); });
    requestAnimationFrame(() => this.start(params).catch(e => { console.error(e); Toast.err('Couldn\'t start the beatmap', friendlyError(e)); Screens.go('songselect', {}, { replace: true }); }));
    return el;
  },
  leave() {
    document.title = APP_NAME;
    if (this.s && Spectate.host.s === this.s) Spectate.hostEnd(this.s, !this.s.finished); // (watchers: the play ended)
    if (this._asPending) { const msg = this._asPending; this._asPending = null; setTimeout(() => Toast.show('Lowered the resolution to keep up', msg), 600); }
    this._tok = null;
    this.renderer && this.renderer.dispose();
    clearTimeout(this._retryHold);
    window.removeEventListener('keydown', this._keydown, true);
    if (this.videoEl) { this.videoEl.pause(); this.videoEl.removeAttribute('src'); this.videoEl.load(); }
    if (this._videoURL) { URL.revokeObjectURL(this._videoURL); this._videoURL = null; }
    window.removeEventListener('keyup', this._keyup, true);
    window.removeEventListener('blur', this._blur);
    if (this.el && this._touch) for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) this.el.removeEventListener(t, this._touch);
    document.removeEventListener('visibilitychange', this._vis);
    window.removeEventListener('resize', this._orient);
    document.removeEventListener('fullscreenchange', this._fsc);
    this.tapEl && this.tapEl.remove(); this.tapEl = null;
    WakeLock.release();
    try { navigator.keyboard && navigator.keyboard.unlock && navigator.keyboard.unlock(); } catch { /* not supported */ }
    PlayScreen.unlock();
    this._audioSub && this._audioSub();
    cancelAnimationFrame(this._raf);
    this._settingsSub && this._settingsSub();
    if (this.s) { this.s.running = false; this.s = null; }
    Music.stop(150);
    this.closePause();
  },
  onBack() {
    if (this.s && this.s.spectate) { Spectate.stop(); return true; } // (Esc while spectating stops watching)
    if (!this.loaderGone) { if (!this.params.mp) this.quit(); return true; }
    if (this.s && this.s.mp) { this.mpQuit(); return true; }
    if (this.s) {
      if (this.s.running) this.pause();
      else if (this.pauseEl && !this.s.failed) this.resume();
      else if (this.replayBar && !this.s.finished) this.showPause('Paused'); // paused from the replay controls
    }
    return true;
  },

  async start(p) {
    const tok = this._tok;
    this.loaderStatus('Loading beatmap…', 0.1);
    const loaded = await BeatmapManager.load(p.mapId);
    if (this._tok !== tok) return;
    const { rec, bm } = loaded;
    if (bm.epilepsyWarning && !p.quick) this.loaderDisclaimer('This beatmap contains scenes with rapidly flashing colours', 'Please take caution if you are affected by epilepsy.');
    const keys = BeatmapParser.keyCount(bm);
    const replay = p.replay || null;
    const mods = replay ? replay.mods : ModSystem.normalize(p.mods || []);
    const practice = p.mode === 'practice';
    const auto = mods.includes('AT');
    const modConfig = replay ? (replay.modConfig || {}) : (p.modConfig || ModSystem.config());
    let rate = replay ? replay.rate : ModSystem.rate(mods, modConfig);
    if (practice) rate = Settings.get('practice.speed') || 1;
    const preserve = (practice || !ModSystem.pitchShift(mods)) && Settings.get('audio.preservePitch');
    const skin = SkinManager.current;
    this.loaderStatus('Loading audio…', 0.3);
    const [layout, buffer] = await Promise.all([skin.mania(keys), TrackCache.get(rec.setId, rec.audioFile)]);
    if (this._tok !== tok) return;
    Music.stop(0);
    this.loaderStatus('Decoding audio…', 0.6);
    await Music.load(buffer, `${rec.setId}/${rec.audioFile}`, { setId: rec.setId, mapId: rec.id });
    if (this._tok !== tok) return;
    await Music.setRate(rate, preserve, f => this.loaderStatus(`Preparing audio… ${Math.round(f * 100)}%`, 0.7 + f * 0.25));
    if (this._tok !== tok) return;
    this.renderer.setLayout(layout);
    this.initAutoScale();
    // health bar: the skin's own scorebar when it has one (and that's the chosen style), else osu!lazer's in the HUD
    this.healthMode = healthModeFor(layout);
    // (phones: the stage spans the upright screen, so a bar beside it would be off-screen — lazer's bar at the top)
    if (typeof Mobile !== 'undefined' && Mobile.touch && (this.healthMode === 'stage' || this.healthMode === 'skinstage' || this.healthMode === 'skin')) this.healthMode = 'lazer';
    // the canvas draws the slim stage bar and the skin's bar beside the stage; the other two are part of the HUD
    this.renderer.healthMode = this.healthMode === 'stage' || this.healthMode === 'skinstage' ? this.healthMode : null;
    this.renderer.resize(true); // (the canvas is cropped to what's drawn beside the stage, the health bar among it)
    this.renderer.coverage = (mods.includes('HD') || mods.includes('FI')) ? modConfig.cover : 0.5;

    const seed = replay ? replay.seed : (Math.random() * 2 ** 31) | 0;
    const redTiming = BeatmapParser.timing(bm);
    const baseNotes = prepareNotes(loaded.notes, keys, mods, seed, { red: redTiming.red });
    // replays keep the judging rules they were recorded with (older ones predate the rules field: rules 1)
    const rules = replay ? (replay.rules || 1) : RULES;
    const windows = replay ? replay.windows : timingWindows({ od: bm.od, mods, mode: Settings.get('gameplay.judgementMode'), customOD: Settings.get('gameplay.customOD'), customMs: Settings.get('gameplay.windowsMs'), odOverride: modConfig.od, rules });
    const accuracyMode = replay ? replay.accuracyMode : Settings.get('gameplay.accuracyMode');
    const scrollMode = mods.includes('CS') ? 'constant' : Settings.get('gameplay.scrollMode');
    const scroll = new ScrollMap(BeatmapParser.scrollSegments(bm, { useSV: scrollMode !== 'constant', useBPM: scrollMode === 'sv' }));
    const endTime = baseNotes.length ? Math.max(...baseNotes.map(n => n.end)) : 0;

    const s = this.s = {
      rec, bm, keys, mods, rate, preserve, practice, auto, replay, seed, windows, accuracyMode, layout, scroll, baseNotes, modConfig, rules, speed: 1,
      endTime, redTiming, bars: Settings.get('gameplay.barLines') ? BeatmapParser.barLines(BeatmapParser.timing(bm).red, endTime) : null,
      firstNote: baseNotes.length ? baseNotes[0].time : 0,
      held: new Array(keys).fill(false), keyMap: new Map(), keyLabels: [], down: Array.from({ length: keys }, () => new Set()),
      events: [], running: false, finished: false, failed: false, startedReal: performance.now(), playedReal: 0,
      mode: replay ? 'replay' : auto ? 'auto' : practice ? 'practice' : 'play',
      loopA: null, loopB: null, speed: rate, mp: p.mp || null, mapOffset: MapOffsets.get(rec.hash), spectate: p.spectate || null,
      debug: { inputs: 0, lastErr: null },
      hidden: mods.includes('HD') ? 'HD' : mods.includes('FI') ? 'FI' : null, percy: mods.includes('PC') ? modConfig.percy : 0,
      flashlight: mods.includes('FL') ? clamp(Number(modConfig.flSize) || 1, 0.5, 1.5) : 0,
    };
    Settings.keybinds(keys).forEach((codes, col) => { codes.forEach(c => s.keyMap.set(c, col)); s.keyLabels[col] = keyLabel(codes[0]); });
    this.newEngine(practice ? null : undefined);
    if (auto || replay) {
      s.feed = replay ? replay.events : generateAutoInputs(s.engine.notes, keys).flat();
      s.feedIdx = 0;
    }
    this.applyBackground();
    this.buildHud();
    const leadIn = Math.max(Settings.get('gameplay.leadIn'), bm.audioLeadIn) * rate;
    const startPos = Math.min(0, s.firstNote - leadIn);
    s.skipTarget = s.firstNote - leadIn;
    s.startPos = startPos;
    s.stars = rate === 1 && rec.srVersion === SR_VERSION && !convertsNotes(mods) ? rec.stars : DifficultyCalculator.calculate(baseNotes, keys, rate);
    // the loader shows the beatmap's rating until now; with a rate or note-changing mod it becomes the played one (as lazer)
    if (this.plStars && Math.abs(s.stars - (rec.stars || 0)) >= 0.005) { const b = starBadge(s.stars); this.plStars.replaceWith(b); this.plStars = b; }
    Toolbar.setNowPlaying(rec);
    document.title = `${APP_NAME} - ${rec.artist} - ${rec.title} [${rec.version}]`; // (as osu! titles its window while playing)
    Music.onEnded = null;
    const mpWait = s.mp ? this.mpWait(s) : null; // the synchronised countdown runs under the loader
    await this.loaderFinish(tok);
    if (this._tok !== tok || this.s !== s) return;
    if (mpWait) { await mpWait; if (this.s !== s) return; }
    else { await this.waitUpright(); if (this._tok !== tok || this.s !== s) return; }
    Music.play(startPos, { fadeIn: startPos >= 0 ? 150 : 0 });
    s.running = true;
    this.lastRender = 0;
    this.loop();
    // someone may be spectating: announce the play (its inputs are streamed only while they watch)
    if (s.mode === 'play') Spectate.hostStart(s);
    Presence.pushStatus();
  },

  // ─────────────────────────────── player loader ───────────────────────────────
  /** osu!lazer's player loader: beatmap info, mods and loading progress in the middle, quick visual and audio
   *  settings on the right (hovering them holds the loader, as in lazer). */
  buildLoader(p) {
    const rec = this.bgRec;
    const mods = p.replay ? p.replay.mods : ModSystem.normalize(p.mods || []);
    const cover = h('div.pl-cover');
    if (rec) BeatmapManager.bgURL(rec).then(u => { if (u) { cover.style.backgroundImage = `url("${u}")`; cover.classList.add('on'); } }).catch(() => {});
    this.plStatus = h('span', 'Loading…');
    this.plBar = h('i');
    // lazer's BeatmapMetadataDisplay: the logo, the title and artist in italics, a 300×60 cover strip that shows the
    // loading state, the difficulty with its star rating, a Source / Mapper grid and the mods, all centred
    const title = rec ? (Settings.get('ui.unicodeMetadata') && rec.titleUnicode ? rec.titleUnicode : rec.title) : 'Loading…';
    const artist = rec ? (Settings.get('ui.unicodeMetadata') && rec.artistUnicode ? rec.artistUnicode : rec.artist) : '';
    const line = (k, v) => v ? [h('span.pl-mk', k), h('span.pl-mv', v)] : [];
    const card = h('div.pl-card',
      h('div.pl-logo', h('span.lz-cookie-disc', h('span.lz-cookie-text', 'ashtonk!', h('small', 'mania')))),
      h('div.pl-t', { title }, title), h('div.pl-a', artist),
      h('div.pl-thumb', cover, h('div.pl-load', h('span.spinner'), this.plStatus), h('div.pl-bar', this.plBar)),
      rec ? h('div.pl-d', h('div.pl-v', rec.version), h('div.pl-sr', this.plStars = starBadge(rec.stars || 0))) : null,
      rec ? h('div.pl-meta', ...line('Source', rec.source), ...line('Mapper', rec.creator)) : null,
      mods.length ? h('div.pl-mods', ...mods.map(m => ModSystem.badge(m))) : null);
    // the loader waits while you're using its settings — only for a pointer that moves there: one that happens to
    // sit where the panel appears (Watch on the Replays page is right under it) kept the loader up forever
    const settings = h('div.pl-settings', { onpointermove: () => { if (!this.loaderHold) { this.loaderHold = true; this.applyBackground(); } }, onpointerleave: () => { this.loaderHold = false; this.applyBackground(); } },
      ...this.playerSettings(rec, !p.replay));
    const el = h('div.gp-loader', card, settings,
      p.mp ? h('div.pl-hint', 'Get ready!') : null);
    this.loaderT0 = performance.now(); this.loaderExtra = 0;
    if (!p.replay && !p.mp) setTimeout(() => this.batteryCheck(), 400);
    // lazer's PlayerLoader: a game too quiet to hear gets a notification that puts the volume back when clicked
    const quiet = Settings.get('audio.master') <= 0.01 || Settings.get('audio.music') <= 0.01;
    if (quiet && !p.mp) setTimeout(() => Toast.show('Your game volume is too low to hear anything!', 'Click here to restore it.', { timeout: 6000, onClick: () => { Settings.reset('audio.master'); Settings.reset('audio.music'); VolumeOverlay.show('master'); } }), 400); // (after the menu's toasts are cleared)
    return el;
  },
  /** lazer's PlayerSettingsOverlay groups — Visual Settings and (playing, not watching) Audio Settings with the
   *  beatmap's offset: on the loader, and on the pause screen to fix things mid-song. */
  playerSettings(rec, offset) {
    return [h('div.pl-group', h('div.pl-gt', 'Visual Settings', icon('list')),
      this.loaderSlider('gameplay.bgDim', 'Background dim', 0, 1, 0.01, v => `${Math.round(v * 100)}%`, () => this.applyBackground()),
      this.loaderSlider('gameplay.bgBlur', 'Background blur', 0, 1, 0.05, v => `${Math.round(v * 100)}%`, () => this.applyBackground()),
      this.loaderSlider('gameplay.scrollSpeed', 'Scroll speed', 1, 40, 1, v => `${v}`)),
      rec && offset ? this.loaderOffset(rec) : null].filter(Boolean);
  },
  loaderSlider(k, label, min, max, step, fmt, after) {
    const inp = h('input.slider', { type: 'range', min, max, step, value: Settings.get(k), 'aria-label': label });
    const v = h('b');
    const upd = () => { const x = parseFloat(inp.value); v.textContent = fmt(x); inp.style.setProperty('--p', ((x - min) / (max - min) * 100) + '%'); };
    inp.addEventListener('input', () => { Settings.set(k, parseFloat(inp.value)); upd(); after && after(); });
    inp.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
    upd();
    return h('label.pl-slider', h('span', label, v), inp);
  },
  /** Per-beatmap offset, with lazer's "calibrate using last play" when the last play here was early or late. */
  loaderOffset(rec) {
    const box = h('div.pl-group');
    const paint = () => {
      const cur = MapOffsets.get(rec.hash), sug = MapOffsets.suggestion(rec.hash);
      const inp = h('input.slider', { type: 'range', min: -100, max: 100, step: 1, value: clamp(cur, -100, 100), 'aria-label': 'Beatmap offset' });
      const v = h('b', `${cur > 0 ? '+' : ''}${cur}ms`);
      const upd = () => inp.style.setProperty('--p', ((parseFloat(inp.value) + 100) / 2) + '%');
      inp.addEventListener('input', () => { const x = parseInt(inp.value, 10); v.textContent = `${x > 0 ? '+' : ''}${x}ms`; upd(); });
      inp.addEventListener('change', () => { MapOffsets.set(rec.hash, parseInt(inp.value, 10)); if (this.s) this.s.mapOffset = MapOffsets.get(rec.hash); });
      inp.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
      upd();
      clearEl(box).append(...[h('div.pl-gt', 'Audio Settings', icon('list')),
        h('label.pl-slider', h('span', 'Beatmap offset', v), inp),
        sug != null ? h('button.btn.sm.pl-calib', { onclick: async () => {
          await MapOffsets.set(rec.hash, cur + sug); MapOffsets.last = null;
          if (this.s) this.s.mapOffset = MapOffsets.get(rec.hash);
          UISounds.click(); paint();
        } }, icon('clock'), `Calibrate using last play (${sug > 0 ? '+' : ''}${sug}ms)`) : null,
        h('div.pl-note', `Global offset ${Settings.get('audio.offset')}ms · positive if you hit late`)].filter(Boolean));
    };
    paint();
    return box;
  },
  loaderStatus(text, frac) {
    if (this.plStatus) this.plStatus.textContent = text;
    if (this.plBar && frac != null) this.plBar.style.width = (clamp(frac, 0, 1) * 100).toFixed(0) + '%';
  },
  /** Keep the loader up for a moment (shorter on retries) and while the player is in its settings. */
  /** lazer's PlayerLoaderDisclaimer, in a stack at the loader's top left: an orange bar beside a bold title and its
   *  text on a faint panel. Each one holds the loader half a second longer. */
  loaderDisclaimer(title, text) {
    let box = this.loaderEl.querySelector('.pl-disclaimers');
    if (!box) { box = h('div.pl-disclaimers'); this.loaderEl.append(box); }
    box.append(h('div.pl-disc', h('i'), h('div', h('b', title), h('span', text))));
    this.loaderExtra = (this.loaderExtra || 0) + 500;
  },
  /** lazer: low on battery (25% or less, not charging) gets a notification, once a session. */
  batteryCheck() {
    if (PlayerLoaderStatics.battery || !navigator.getBattery) return;
    navigator.getBattery().then(b => {
      if (PlayerLoaderStatics.battery || b.charging || b.level > 0.25) return;
      PlayerLoaderStatics.battery = true;
      Toast.show('Your battery level is low!', 'Charge your device to prevent interruptions during gameplay.', { timeout: 6000 });
    }).catch(() => {});
  },
  async loaderFinish(tok) {
    const p = this.params, s = this.s;
    const min = p.quick ? 350 : 3500 + (this.loaderExtra || 0); // time to read the map info and adjust the settings before it starts
    this.loaderStatus('Ready!', 1);
    this.loaderEl.classList.add('ready');
    if (s && s.mp) {
      // everyone starts together: no holding or skipping — the loader leaves 1.5s before the synchronised start
      while (this._tok === tok && s.mp.startAt - performance.now() > 1500) {
        this.loaderStatus(`Match starts in ${Math.ceil((s.mp.startAt - performance.now()) / 1000)}…`, 1);
        await sleep(100);
      }
    } else {
      while (this._tok === tok && !this.loaderSkip && (performance.now() - this.loaderT0 < min || this.loaderHold)) await sleep(50);
    }
    if (this._tok !== tok) return;
    const el = this.loaderEl;
    el.classList.add('out');
    this.el.classList.remove('loading');
    this.loaderGone = true;
    this.applyBackground(); // (from the menus' 25% to your gameplay dim and blur)
    setTimeout(() => el.remove(), 500);
  },

  newEngine(fromTime) {
    const s = this.s;
    let notes = s.baseNotes;
    if (fromTime != null) notes = notes.filter(n => n.time >= fromTime && (s.loopB == null || n.time <= s.loopB));
    s.engine = new GameplayEngine({ notes, keys: s.keys, windows: s.windows, rate: s.rate, mods: s.mods, hp: s.bm.hp, accuracyMode: s.accuracyMode, noFail: s.practice || !!s.mp || !!(s.replay && s.replay.noFail),
      breaks: s.mods.includes('IN') ? [] : s.bm.events.breaks, modConfig: s.modConfig, rules: s.rules }); // (Invert has no breaks)
    s.engine.onEvent(e => this.onEngineEvent(e));
    s.held.fill(false);
  },

  applyBackground() {
    const s = this.s, rec = s ? s.rec : this.bgRec;
    if (!rec) return;
    const show = Settings.get('gameplay.showBackground');
    // the loader keeps the menus' look (25% dim and blur); your dim and blur take over when the song starts — or
    // while you're adjusting them on the loader, as a preview (lazer)
    const menuLook = !this.loaderGone && !this.loaderHold;
    this.baseDim = menuLook ? Background.MENU_DIM : show ? Settings.get('gameplay.bgDim') : 1;
    this.dimEl.style.opacity = this.baseDim;
    const blur = menuLook ? Background.MENU_BLUR : Settings.get('gameplay.bgBlur');
    const tok = this._bgTok = {};
    (Settings.get('graphics.bgQuality') === 'low' ? BeatmapManager.bgThumbURL(rec) : BeatmapManager.bgURL(rec)).then(async u => {
      // the blur is baked into a copy of the image once, so the GPU doesn't re-blur it every frame
      if (u && blur > 0) u = await blurredImage(u, blur).catch(() => u);
      if (this._bgTok === tok && this._tok) this.bgEl.style.backgroundImage = show && u ? `url("${u}")` : 'none';
    });
    if (s) this.loadVideo();
  },
  /** Background video (mp4/webm stored at import) kept in sync with the audio clock. */
  async loadVideo() {
    const s = this.s, v = s.bm.events.video;
    if (!v || !Settings.get('gameplay.video') || !Settings.get('gameplay.showBackground') || this._videoURL) return;
    const blob = await BeatmapManager.getFile(s.rec.setId, v.file || v);
    if (!blob || this.s !== s) return;
    this._videoURL = URL.createObjectURL(blob);
    this.videoEl.src = this._videoURL;
    this.videoOffset = v.offset || 0;
    this.videoEl.classList.add('on');
  },
  syncVideo(now) {
    const vid = this.videoEl, s = this.s;
    if (!this._videoURL || !vid) return;
    const target = (now - this.videoOffset) / 1000;
    if (target < 0 || !s.running) { if (!vid.paused) vid.pause(); if (target < 0 && vid.currentTime !== 0) vid.currentTime = 0; return; }
    if (vid.playbackRate !== s.rate) vid.playbackRate = s.rate;
    if (vid.paused) { vid.currentTime = target; vid.play().catch(() => {}); return; }
    if (Math.abs(vid.currentTime - target) > 0.12) vid.currentTime = target;
  },

  buildHud() {
    const s = this.s;
    clearEl(this.hud);
    this._pq = this._pieQ = this._lead = this._canSkip = this._inBreak = this._progT = this._ppJudged = this._scT = undefined; this._lastSc = this._lastAcc = this._lastTT = undefined;
    this.scoreEl = h('div.sc', '0'); this.accEl = h('div.acc', '100.00%');
    this.progEl = h('i');
    this.pieEl = h('div.hud-pie', { title: 'Song progress' });
    this.ppEl = h('div.hud-pp');
    const pd = Settings.get('gameplay.progressDisplay');
    this.hud.append(
      h('div.hud-progress', { style: { display: pd === 'bar' || pd === 'both' ? '' : 'none' } }, this.progEl),
      // one right-aligned stack (score, accuracy, pp, mods) so nothing can overlap whatever each line holds
      h('div.hud-score', this.scoreEl, h('div.hud-accrow', (pd === 'pie' || pd === 'both') ? this.pieEl : null, this.accEl), this.ppEl,
        s.mods.length ? h('div.hud-mods', ...s.mods.map(m => modIcon(m, 42))) : null),
      // touch screens have no Escape key: a pause button only shows for coarse pointers
      s.mode === 'play' ? h('button.hud-touch-pause', { 'aria-label': 'Pause', onclick: e => { e.stopPropagation(); this.onBack(); } }, h('i'), h('i')) : null,
      !Mobile.touch && !s.spectate ? this.holdForMenu() : null,
    );
    // osu!lazer's hit error meter, bottom centre (mania's legacy and default layouts both have it)
    this.errMeter = null;
    if (Settings.get('gameplay.hitErrorMeter') && s.engine) { this.errMeter = new HitErrorMeter(s.engine.W); this.hud.append(this.errMeter.canvas); }
    // touch screens play as FNF does on phones: the screen split into one full-height hitbox per column, lighting up
    // while it's held
    this.hitbox = null;
    if (s.mode === 'play' && typeof Mobile !== 'undefined' && Mobile.touch) {
      const K = s.down.length;
      this.hitbox = h('div.fnf-hitbox', ...Array.from({ length: K }, () => h('i')));
      this.hud.append(this.hitbox);
    }
    if (s.mode === 'replay' || s.mode === 'auto') {
      this.hud.append(h('div.hud-replay', { class: Settings.get('gameplay.scrollDirection') === 'up' ? 'low' : '' }, h('span.dot'), s.mode === 'auto' ? 'AUTO' : `REPLAY · ${s.replay.player || 'Player'}`));
    }
    // osu!lazer's judgement counter (off unless turned on): each judgement's count, rolling up, over its name
    this.jc = null;
    if (Settings.get('gameplay.judgementCounter')) {
      const items = JUDGEMENT_COUNTER.map(([j, name, colour]) => { const n = h('span.jc-n', '0'); return { j, n, shown: 0, el: h('div.jc-item', { style: { '--jc': colour } }, n, h('span.jc-name', name)) }; });
      this.jc = { items, el: h(`div.hud-jc.${Settings.get('gameplay.judgementCounterFlow') === 'horizontal' ? 'h' : 'v'}`, ...items.map(i => i.el)) };
      this.hud.append(this.jc.el);
    }
    if (s.mp) { this.mpBoard = h('div.hud-mp'); this.hud.append(this.mpBoard); this._mpSent = 0; this._mpRows = null; this.mpTeams = null; this._mpT = 0; this._mpDrawn = 0; }
    else this.buildLeaderboard();
    this.board().classList.toggle('lb-off', !Settings.get('gameplay.leaderboard'));
    // osu!lazer-style health bar (top left): the fill eases to the new value, and a red trail shows what a miss took
    this.hpEl = this._hpQ = this._hpLow = null;
    this.skinHp = null;
    if (this.healthMode === 'skin') {
      this.skinHp = new SkinHealthBar(s.layout);
      this.hud.append(this.skinHp.el);
    }
    if (this.healthMode === 'lazer') {
      this.hpFill = h('i.hp-fill'); this.hpTrail = h('i.hp-trail');
      this.hpEl = h('div.hud-hp', h('div.hp-track', this.hpTrail, this.hpFill));
      this.hud.append(this.hpEl);
    }
    // lazer's skip overlay: a big button with moving chevrons and a bar for how long the intro can still be skipped
    this.skipBtn = h('button.hud-skip', { onclick: () => this.skip(), style: { display: 'none' } },
      h('span.sk-label', 'Skip'), h('span.sk-chev', icon('chevron'), icon('chevron'), icon('chevron')), h('span.kbd', 'Space'), h('i.sk-bar'));
    this.hud.append(this.skipBtn);
    // score and accuracy in the skin's own number font, when it has one
    this._scoreDigits = this._accDigits = null;
    const sf = s.layout && s.layout.scoreFont;
    if (sf) {
      const swap = el => { const d = skinDigits(sf, Math.round(parseFloat(getComputedStyle(el).fontSize) || 32) * 0.92); el.classList.add('skinned'); el.replaceChildren(d.el); return d; };
      requestAnimationFrame(() => { if (this.s !== s) return; this._scoreDigits = swap(this.scoreEl); this._accDigits = swap(this.accEl); this._lastSc = this._lastAcc = undefined; });
    }
    if (s.practice) this.buildPracticeBar();
    this.replayBar = null;
    if (s.feed && !s.practice && !s.mp && !s.spectate) this.buildReplayBar(); // (no seeking ahead of a live play)
    this.debugEl = h('div.debug-overlay', { hidden: !Settings.get('debug.overlay') });
    this.el.appendChild(this.debugEl);
  },

  // ─────────────────────────────── main loop ───────────────────────────────
  /** Global audio offset plus this beatmap's own offset, in ms. */
  offsetMs() { return Settings.get('audio.offset') + (this.s ? this.s.mapOffset || 0 : 0); },
  /** Song time (ms, offsets applied) heard at a performance.now() time (default: now). */
  gameTime(at) {
    if (!this.s) return 0; // (a control clicked while the screen is leaving)
    // after a fail the song winds down (1.2 s ramp to 30% speed, then stops): the playfield slows with it and
    // stays put, instead of running on at full speed and then jumping back once the music is stopped
    const f = this.s.failClock;
    if (f) { const e = clamp(((at ?? performance.now()) - f.real) / 1000, 0, FAIL_WIND_DOWN); return f.t + this.s.rate * 1000 * (e - 0.35 * e * e / FAIL_WIND_DOWN); }
    return Music.timeAt(at) - this.offsetMs() * this.s.rate;
  },
  /** The playfield's clock for the frame shown at `ts` (the frame's vsync timestamp). Notes are placed by the time
   *  between frames, not by when the frame's code happened to run, so they move by exactly the same distance every
   *  refresh; the clock is phase-locked to the audio and drifts back to it gently (or jumps after a seek or a stall). */
  /** osu!lazer's InterpolatingFramedClock (osu-framework), the clock its playfield scrolls by: each frame it moves on
   *  by the real time since the last frame × the playback rate, then eases towards the audio's position with a 50 ms
   *  half-life (DampContinuously); it only jumps to the audio if it's more than two 60 Hz frames (33 ms) out, and it
   *  never runs backwards while the song plays forwards. */
  frameTime(ts) {
    const truth = this.gameTime(ts), c = this._vc, s = this.s, rate = s.rate || 1;
    if (!c || c.gen !== Music.gen || !Music.playing || s.failClock || !(ts > c.ts) || ts - c.ts > 250 || c.off !== this.offsetMs()) {
      this._vc = { ts, t: truth, gen: Music.gen, off: this.offsetMs() };
      return truth;
    }
    const dt = ts - c.ts, last = c.t;
    let t = last + dt * rate;
    t = truth + (t - truth) * Math.pow(0.5, dt / 50);           // DampContinuously(current, source, 50, elapsed)
    if (Math.abs(truth - t) > (1000 / 60) * 2 * rate) t = truth;  // AllowableErrorMilliseconds
    c.t = Math.max(last, t); c.ts = ts;                           // (never backwards)
    return c.t;
  },
  loop() {
    // one frame description, reused every frame (no garbage for the collector to pause on mid-song)
    const g = this._frame = { now: 0, posNow: 0, scroll: null, pxPerMs: 0, engine: null, held: null, hidden: null, realNow: 0, keyLabels: null, percy: 0, bars: null, flashlight: 0 };
    this._vc = null; this._due = 0; this._refresh = 1000 / 60; this._lastTs = 0;
    const frame = ts => {
      this._raf = requestAnimationFrame(frame);
      const s = this.s;
      if (!s) return;
      const realNow = ts > 0 ? ts : performance.now();
      // the display's refresh interval, for the frame limiter
      if (this._lastTs && realNow > this._lastTs) this._refresh += (clamp(realNow - this._lastTs, 2, 50) - this._refresh) * 0.1;
      this._lastTs = realNow;
      const now = this.frameTime(realNow);
      const eng = s.engine;
      if (s.spectate) Spectate.tick(this, s, now); else if (Spectate.host.s === s) Spectate.hostTick(s, now);
      if (s.running) {
        // replay / auto input feed (exact recorded times)
        if (s.feed) {
          const ev = s.feed;
          while (s.feedIdx < ev.length && ev[s.feedIdx] <= now) {
            const t = ev[s.feedIdx], col = ev[s.feedIdx + 1], down = ev[s.feedIdx + 2] === 1;
            s.feedIdx += 3;
            s.held[col] = down;
            if (!down) this.renderer.onRelease(col, realNow);
            eng.input(col, down, t);
            if (s.mp) s.events.push(t, col, down ? 1 : 0); // (a multiplayer play is judged from these, however its keys came in)
          }
          eng.advance(now);
        } else {
          const grace = 30 * s.rate;
          if (now - grace > eng.lastTime) eng.advance(now - grace);
        }
        this.checkEnd(now);
        this.updatePractice(now);
      }
      if (this.replayBar) this.updateReplayBar(now);
      const lim = Settings.get('graphics.fpsLimit');
      // (a limit at or above the screen's refresh rate is no limit: counting it out frame by frame only drifted against
      // the real refresh and dropped a frame every so often — a hitch on a "locked 60")
      if (lim > 0 && 1000 / lim > this._refresh * 1.04) {
        // frames are due every 1/limit s, counted from when the last one was due (not drawn), and drawn on the first
        // refresh that reaches it: the average rate is the limit, and a limit at or above the refresh rate never
        // drops a frame because of timing jitter
        const iv = 1000 / lim;
        if (this._due && realNow < this._due - this._refresh / 2) return;
        this._due = this._due && this._due > realNow - iv ? this._due + iv : realNow + iv;
      }
      if (s.running) this.adaptResolution(realNow - this.lastRender, realNow, lim);
      this.lastRender = realNow;
      const timeRange = 11485 / Settings.get('gameplay.scrollSpeed');
      g.now = now; g.posNow = s.scroll.pos(now); g.scroll = s.scroll; g.pxPerMs = this.renderer.scrollLength / (timeRange * s.rate);
      g.engine = eng; g.held = s.held; g.realNow = realNow; g.keyLabels = s.keyLabels;
      g.hidden = s.hidden; g.percy = s.percy; g.bars = s.bars; g.flashlight = s.flashlight;
      this.renderer.render(g);
      this.updateHud(now);
      if (this.errMeter) this.errMeter.draw(realNow);
      this.updateBreak(now);
      this.syncVideo(now);
      if (s.running && !s.feed && GamepadWatch.connected) this.pollGamepad();
      if (!this.debugEl.hidden) this.updateDebug(now, realNow);
      FPS.frame(realNow);
    };
    frame(performance.now());
  },

  // ─────────────────────────────── automatic resolution ───────────────────────────────
  /** Slow devices: most of a frame's cost is the canvas's pixel count (profiled on a throttled Chromebook-sized
   *  run: 75% resolution took 31 fps to 47). While playing, every 2 s the median frame time is checked; two slow
   *  windows in a row (under ~45 fps, or the FPS limit) lower the playfield's resolution by 10%, down to 60%.
   *  The device remembers it, and after a play that ran smoothly it starts 5% higher next time. */
  AUTO_SCALE_MIN: 0.6,
  initAutoScale() {
    const on = Settings.get('graphics.autoScale');
    this._as = { on, scale: on ? clamp(Settings.get('perf.autoScale') || 1, this.AUTO_SCALE_MIN, 1) : 1, times: [], t0: 0, bad: 0, smooth: 0, windows: 0 };
    this.renderer.autoScale = this._as.scale;
  },
  adaptResolution(dt, realNow, lim) {
    const a = this._as;
    if (!a || !a.on || document.hidden || !(dt > 0) || dt > 250) return; // (skip pauses, tab switches, hitches)
    a.times.push(dt);
    if (!a.t0) a.t0 = realNow;
    if (realNow - a.t0 < 2000) return;
    const t = a.times.sort((x, y) => x - y), med = t[t.length >> 1];
    a.times.length = 0; a.t0 = realNow; a.windows++;
    const target = lim > 0 ? Math.max(1000 / lim, 16.7) : 16.7;
    a.bad = med > target * 1.33 ? a.bad + 1 : 0;           // slower than ~45 fps
    if (med < target * 1.08) a.smooth++;                    // comfortably at full speed
    if (a.bad >= 2 && a.scale > this.AUTO_SCALE_MIN + 1e-6) {
      a.bad = 0;
      a.scale = Math.max(this.AUTO_SCALE_MIN, Math.round((a.scale - 0.1) * 100) / 100);
      this.renderer.autoScale = a.scale;
      this.renderer.resize(true);
      Settings.set('perf.autoScale', a.scale);
      // (told after the play, not in the middle of it: lazer holds notifications back while you play)
      if (!this._asToast) { this._asToast = true; this._asPending = `Playfield at ${Math.round(a.scale * 100)}% · Settings → Graphics → Automatic resolution`; }
    }
  },
  /** End of a play: if it ran smoothly all the way, try a little higher next time. */
  settleAutoScale() {
    const a = this._as;
    if (!a || !a.on || a.windows < 5 || a.scale >= 1) return;
    if (a.smooth >= a.windows - 1) Settings.set('perf.autoScale', Math.min(1, Math.round((a.scale + 0.05) * 100) / 100));
  },

  updateHud(now) {
    const s = this.s, e = s.engine;
    if (this.jc) {
      // lazer's RollingCounter: each number runs up to its count instead of jumping
      const c = e.score.counts;
      for (const it of this.jc.items) {
        const target = c[it.j] || 0;
        if (it.shown === target) continue;
        it.shown = target - it.shown > 1 ? it.shown + Math.max(1, Math.ceil((target - it.shown) * 0.25)) : target;
        if (it.shown > target) it.shown = target;
        setText(it.n, String(it.shown));
      }
    }
    // multiplayer, as in osu!lazer: running out of health fails the score (F, no pp) but you play on to the end,
    // and your score still counts for the match
    if (s.mp && !s.mpFailed && e.health.value <= 0) {
      s.mpFailed = true;
      this.hud.append(h('div.hud-mpfailed', 'Failed'));
    }
    // score / accuracy text at most ~20× a second: on dense charts they change every frame, and each text
    // change costs a style + layout pass
    const wall0 = performance.now();
    if (!(wall0 - (this._scT || 0) < 50)) {
      this._scT = wall0;
      const sc = e.score.scoreStd;
      if (sc !== this._lastSc) { this._lastSc = sc; if (this._scoreDigits) this._scoreDigits.set(fmtScore(sc)); else setText(this.scoreEl, fmtScore(sc)); }
      const acc = e.score.accuracy;
      if (acc !== this._lastAcc) { this._lastAcc = acc; if (this._accDigits) this._accDigits.set(fmtAcc(acc)); else setText(this.accEl, fmtAcc(acc)); }
    }
    const dur = s.endTime;
    const p = clamp((now - s.firstNote) / Math.max(1, dur - s.firstNote), 0, 1);
    // progress bar + osu!-style pie (green while counting down to the first note); DOM writes only when
    // the value moves by a visible step, so the HUD doesn't force a style pass every frame
    const lead = now < s.firstNote;
    const pieP = lead ? clamp(1 - (s.firstNote - now) / Math.max(1, s.firstNote - Math.min(0, s.startPos)), 0, 1) : p;
    // (progress and pie at most 4× a second — each write restyles the HUD, and they move slowly anyway)
    const wall = performance.now();
    if (lead !== this._lead || !(wall - (this._progT || 0) < 250)) {
      this._progT = wall;
      const pq = Math.round(p * 400), pieQ = Math.round(pieP * 200);
      if (pq !== this._pq) { this._pq = pq; this.progEl.style.transform = `scaleX(${pq / 400})`; }
      if (pieQ !== this._pieQ || lead !== this._lead) {
        this._pieQ = pieQ;
        this.pieEl.style.setProperty('--p', (pieQ / 2) + '%');
        if (lead !== this._lead) { this._lead = lead; this.pieEl.classList.toggle('lead', lead); }
      }
    }
    if (Settings.get('gameplay.showPp') && s.mode !== 'auto') {
      // live pp only changes when a note is judged
      if (e.score.judged !== this._ppJudged) {
        this._ppJudged = e.score.judged;
        const t = String(Math.round(this.livePp(e))); // (the "pp" is a smaller suffix drawn by CSS, as lazer's counter)
        setText(this.ppEl, t);
      }
    } else if (this.ppEl.textContent) this.ppEl.textContent = '';
    const canSkip = s.running && now < s.skipTarget - 1500 * s.rate && !s.practice;
    if (canSkip !== this._canSkip) { this._canSkip = canSkip; this.skipBtn.style.display = canSkip ? '' : 'none'; this._skipFrom = now; }
    if (canSkip) {
      const end = s.skipTarget - 1500 * s.rate, left = clamp((end - now) / Math.max(1, end - this._skipFrom), 0, 1);
      this.skipBtn.style.setProperty('--left', left.toFixed(3));
    }
    if (s.mp) this.updateMp(e); else this.updateLeaderboard();
    if (this.skinHp) this.skinHp.update(e.health.value, performance.now());
    if (this.hpEl) {
      const q = Math.round(clamp(e.health.value, 0, 1) * 400);
      if (q !== this._hpQ) {
        this._hpQ = q;
        this.hpEl.style.setProperty('--hp', q / 400);
        const low = q < 120;
        if (low !== this._hpLow) { this._hpLow = low; this.hpEl.classList.toggle('low', low); }
      }
    }
  },
  /** osu!lazer-style in-game leaderboard: this map's local top scores with your live score climbing through them. */
  buildLeaderboard() {
    const s = this.s;
    this.lbEl = h('div.hud-mp.hud-lb'); this.hud.append(this.lbEl);
    this._lbJudged = -1; this._lbMe = null;
    if (s.mode === 'auto' || s.practice) return;
    const skip = s.replay && s.replay.scoreId;
    // (as lazer's: the board follows song select's scope — Global / Friends from the server when it has them)
    const scope = Settings.get('songselect.lbScope'), on = typeof SongSelect !== 'undefined' && SongSelect._online;
    const online = (scope === 'global' || scope === 'friends') && on && on.key === s.rec.hash && on.scope === scope && s.mode !== 'replay';
    const rows = online
      ? on.scores.slice(0, 6).map(x => ({ name: x.pid === Presence.pid() ? ProfileManager.profile.name : x.name, avatar: x.avatar, own: x.pid === Presence.pid(), acc: x.acc, combo: x.combo, score: x.score }))
      : ScoreManager.forMap(s.rec.hash).filter(x => x.id !== skip && x.passed).slice(0, 6).map(x => ({ name: x.player || ProfileManager.profile.name, own: !x.player || x.player === ProfileManager.profile.name, acc: x.accuracy, combo: x.maxCombo, score: ScoreManager.value(x) }));
    // nothing to climb past on a first play: no board (a lone "#1 you" row is just clutter, and lazer shows none)
    if (!rows.length) { this.lbEl.classList.add('lb-empty'); return; }
    const mk = (x, me) => {
      const r = this.lbPanel(x.name, x.own ? ProfileManager.avatarEl(38) : Presence.avatarEl({ name: x.name, avatar: x.avatar }, 38), me);
      r.sub.textContent = fmtAcc(x.acc); r.combo.textContent = `${fmtInt(x.combo)}x`; r.sc.textContent = fmtScore(x.score);
      this.lbEl.append(r.el); return r;
    };
    this._lbRows = rows.map(x => Object.assign(mk(x, false), { score: x.score }));
    const myName = s.mode === 'replay' ? (s.replay.player || 'Player') : ProfileManager.profile.name;
    this._lbMe = mk({ name: myName, own: s.mode !== 'replay', acc: 1, combo: 0, score: 0 }, true);
    this.updateLeaderboard(true);
  },
  updateLeaderboard(force) {
    const me = this._lbMe;
    if (!me) return;
    const e = this.s.engine;
    // (in step with the score and accuracy at the top right: it changes only when a note is judged, and is redrawn at
    // most ~10× a second — on a dense chart every frame's text and reordering cost a layout pass)
    if (!force && e.score.judged === this._lbJudged) return;
    const wall = performance.now();
    if (!force && wall - (this._lbT || 0) < 100) return;
    this._lbT = wall;
    this._lbJudged = e.score.judged;
    const sc = ScoreManager.value(e.score);
    // ties go to the score that was set first
    const above = this._lbRows.filter(r => r.score >= sc).length;
    if (me._pos !== above + 1) {
      me._pos = above + 1; setText(me.pos, `#${above + 1}`); me.el.style.order = above * 2 + 1; me.el.classList.toggle('first', above === 0);
      this._lbRows.forEach((r, i) => { const p = i + 1 + (i >= above ? 1 : 0); setText(r.pos, `#${p}`); r.el.style.order = i * 2 + (i >= above ? 2 : 0); r.el.classList.toggle('first', p === 1); });
    }
    const sub = fmtAcc(e.score.judged ? e.score.accuracy : 1), cmb = `${fmtInt(e.score.combo)}x`, st = fmtScore(sc);
    if (me._sub !== sub) { me._sub = sub; setText(me.sub, String(sub)); }
    if (me._cmb !== cmb) { me._cmb = cmb; setText(me.combo, cmb); }
    if (me._st !== st) { me._st = st; setText(me.sc, String(st)); }
  },
  /** lazer's HoldForMenuButton (mouse): a 60px circle in the bottom-right corner, unseen until the pointer is over it
   *  ("hold for menu" slides in beside it); held down, a ring fills over 200 ms and then the menu opens. */
  holdForMenu() {
    const ring = h('i.hfm-ring'), btn = h('span.hfm-btn', ring, h('i.hfm-dot'), icon('x'));
    const el = h('div.hud-hfm', h('span.hfm-t', 'hold for menu'), btn);
    let t0 = 0, raf = 0;
    const stop = () => { cancelAnimationFrame(raf); t0 = 0; el.style.setProperty('--p', 0); };
    const step = () => {
      const p = clamp((performance.now() - t0) / 200, 0, 1);
      el.style.setProperty('--p', p.toFixed(3));
      if (p >= 1) { stop(); this.onBack(); return; }
      raf = requestAnimationFrame(step);
    };
    btn.addEventListener('pointerdown', e => { if (e.button) return; e.stopPropagation(); e.preventDefault(); t0 = performance.now(); raf = requestAnimationFrame(step); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
    return el;
  },
  /** lazer's DrawableGameplayLeaderboardScore: a 38px sheared panel — the place on the left, the avatar on the seam,
   *  then the name and accuracy over the score and combo; lime for first place, orange for you (or team colours). */
  lbPanel(name, avatar, me, team = '') {
    const r = { pos: h('b.pos'), sub: h('span.acc'), sc: h('span.sc'), combo: h('span.cmb') };
    r.el = h(`div.hud-mp-row${me ? '.me' : ''}${team ? '.' + team : ''}`,
      h('span.mpl-left', r.pos), h('span.mpl-av', avatar),
      h('div.mpl-right', h('div.mpl-l1', h('b.nm', name), r.sub), h('div.mpl-l2', r.sc, r.combo)));
    return r;
  },
  /** The board Tab toggles: the multiplayer standings, or the local leaderboard. */
  board() { return this.mpBoard && this.s.mp ? this.mpBoard : this.lbEl; },
  toggleLeaderboard() {
    const on = !Settings.get('gameplay.leaderboard');
    Settings.set('gameplay.leaderboard', on);
    this.board().classList.toggle('lb-off', !on);
    OSD.show('Leaderboard', on ? 'shown' : 'hidden', 'Tab');
  },
  /** Multiplayer: send our live score (4×/s) and show everyone in the match, ranked by the room's win condition
   *  (osu!lazer-style board). Team Versus adds lazer's red-vs-blue totals at the top. */
  updateMp(e) {
    const t = performance.now(), s = this.s, room = Multiplayer.room;
    // (Ranked Play compares lazer's standardised score: it decides the damage)
    const sc = e.score.scoreStd;
    if (t - this._mpSent > 250 && s.running) {
      this._mpSent = t;
      this._myPp = s.mpFailed ? 0 : this.livePp(e);
      Multiplayer.send({ t: 'score', score: sc, acc: e.score.accuracy, combo: e.score.combo, maxCombo: e.score.maxCombo, hp: e.health.value, pp: this._myPp });
    }
    const set = (room && room.settings) || {}, win = set.win || 'pp', teams = set.type === 'teams';
    const pick = v => win === 'score' ? v.score : win === 'accuracy' ? v.acc : win === 'combo' ? v.maxCombo : v.pp;
    const fmt = v => win === 'score' ? fmtScore(v) : win === 'accuracy' ? fmtAcc(v) : win === 'combo' ? `${fmtInt(v)}x` : `${Math.round(v)}pp`;
    if (!this._mpRows) {
      const ids = (s.mp.players && s.mp.players.length ? s.mp.players : room ? room.players.map(p => p.id) : [Multiplayer.me]);
      this._mpRows = ids.map(id => {
        const me = id === Multiplayer.me, p = room && room.players.find(x => x.id === id);
        const team = teams && p ? p.team : null;
        // lazer's DrawableGameplayLeaderboardScore: a 38px sheared panel — the place on the left, the avatar on the
        // seam, then the name and accuracy over the score and combo; lime for first place, orange for you
        const r = { id, me, team, ...this.lbPanel(me ? ProfileManager.profile.name : p ? p.name : 'Player', me ? ProfileManager.avatarEl(38) : Presence.avatarEl(p || { name: 'Player' }, 38), me, team === 0 ? 'red' : team === 1 ? 'blue' : ''), shown: null };
        return r;
      });
      this.mpBoard.append(...this._mpRows.map(r => r.el));
      if (teams) {
        this.mpTeams = { red: h('span.tv-n'), blue: h('span.tv-n'), bar: h('i'), diff: h('span.tv-diff') };
        this.hud.append(h('div.hud-teams', h('div.tv-side.red', h('span.tv-l', 'Red'), this.mpTeams.red), h('div.tv-mid', h('div.tv-bar', this.mpTeams.bar), this.mpTeams.diff), h('div.tv-side.blue', this.mpTeams.blue, h('span.tv-l', 'Blue'))));
      }
    }
    // everyone else's numbers arrive 4×/s: ease what's shown towards them so they count up smoothly
    const k = Math.min(1, (t - (this._mpT || t)) / 180);
    this._mpT = t;
    for (const r of this._mpRows) {
      const v = r.me ? { pp: this._myPp || 0, score: sc, acc: e.score.accuracy, maxCombo: e.score.maxCombo, combo: e.score.combo } : Multiplayer.opps.get(r.id) || { pp: 0, score: 0, acc: 1, maxCombo: 0 };
      const target = pick(v) || 0;
      r.shown = r.shown == null || r.me ? target : r.shown + (target - r.shown) * k;
      r.v = v;
    }
    if (t - (this._mpDrawn || 0) < 100) return;
    this._mpDrawn = t;
    const order = [...this._mpRows].sort((a, b) => (b.shown - a.shown) || ((b.v.score || 0) - (a.v.score || 0)));
    order.forEach((r, i) => {
      // (a player whose connection dropped keeps their place while they reconnect)
      const away = !r.me && !!(room && (room.players.find(p => p.id === r.id) || {}).away);
      if (away !== r._away) { r._away = away; r.el.classList.toggle('away', away); }
      const pos = i + 1, sub = away ? 'reconnecting…' : fmtAcc(r.v.acc ?? 1), st = fmt(r.shown), cmb = `${fmtInt(r.v.combo ?? r.v.maxCombo ?? 0)}x`;
      if (r._pos !== pos) { r._pos = pos; setText(r.pos, `#${pos}`); r.el.style.order = pos; r.el.classList.toggle('first', pos === 1); }
      if (r._sub !== sub) { r._sub = sub; setText(r.sub, String(sub)); }
      if (r._st !== st) { r._st = st; setText(r.sc, String(st)); }
      if (r._cmb !== cmb) { r._cmb = cmb; setText(r.combo, cmb); }
    });
    if (this.mpTeams) {
      const tot = team => { const v = this._mpRows.filter(r => r.team === team).map(r => r.shown); return !v.length ? 0 : win === 'accuracy' ? v.reduce((a, b) => a + b, 0) / v.length : v.reduce((a, b) => a + b, 0); };
      const red = tot(0), blue = tot(1), T = this.mpTeams;
      T.red.textContent = fmt(red); T.blue.textContent = fmt(blue);
      const f = red + blue > 0 ? red / (red + blue) : 0.5;
      T.bar.style.transform = `scaleX(${f.toFixed(3)})`;
      T.diff.textContent = red === blue ? '' : `${red > blue ? '◀' : ''} ${fmt(Math.abs(red - blue))} ${blue > red ? '▶' : ''}`;
    }
  },
  /** Wait for the synchronised start; everyone begins at the same moment. */
  async mpWait(s) {
    const el = h('div.mp-countdown');
    this.el.appendChild(el);
    while (this.s === s) {
      const left = s.mp.startAt - performance.now();
      if (left <= 0) break;
      const txt = left > 3000 ? 'Get ready…' : String(Math.ceil(left / 1000));
      if (txt !== el.textContent && left <= 3000) SkinManager.skinOnly(`count${txt}s`);
      el.textContent = txt;
      await sleep(Math.min(100, left));
    }
    el.remove();
  },
  async mpQuit() {
    const s = this.s;
    if (!s || s.finished) { Screens.go('multiplayer', {}, { replace: true }); return; }
    // Ranked Play (as lazer): leaving the song scores 0 for this round — your opponent plays on, and you take the damage
    const ranked = Multiplayer.isRP(), opp = ranked && Multiplayer.opponent();
    const ok = ranked ? await Dialog.confirm('Leave the song?', `You'll score 0 this round and take the damage while ${opp ? opp.name : 'your opponent'} plays on. The match carries on afterwards.`, { ok: 'Leave song', danger: true })
      : await Dialog.confirm('Quit match?', 'Quitting counts as a loss.', { ok: 'Quit', danger: true });
    if (!ok || this.s !== s) return;
    Multiplayer.send({ t: 'quit' });
    s.finished = true; s.running = false;
    Music.stop(150);
    Screens.go('multiplayer', {}, { replace: true });
  },

  changeScrollSpeed(d) {
    const v = clamp(Settings.get('gameplay.scrollSpeed') + d, 1, 40);
    Settings.set('gameplay.scrollSpeed', v);
    OSD.show('Scroll speed', `${Math.round(11485 / v)}ms (speed ${v.toFixed(1)})`, 'F3 / F4');
  },
  /** lazer's BeatmapOffsetControl hotkeys (− / +): this beatmap's offset 1ms at a time, while that can't change a
   *  judgement — paused, or before the first note. */
  nudgeMapOffset(d) {
    const s = this.s;
    if (!s || s.mp || s.replay) return false;
    if (s.running && this.gameTime() >= s.firstNote) { OSD.show('Beatmap offset', 'locked while playing', 'pause to change it'); return true; }
    const v = clamp((s.mapOffset || 0) + d, -300, 300);
    MapOffsets.set(s.rec.hash, v);
    s.mapOffset = v;
    OSD.show('Beatmap offset', `${v > 0 ? '+' : ''}${v}ms`, '- / +');
    return true;
  },

  /** Live pp: the pp this play is worth if the rest of the map is played at the current accuracy. */
  livePp(e) {
    const c = e.score.counts, judged = e.score.judged, total = e.totalJudgements;
    if (!judged) return 0;
    const scaled = c.map(x => x * total / judged);
    return OsuMath.pp(this.s.stars, scaled, this.s.mods);
  },
  updateDebug(now, realNow) {
    const s = this.s, e = s.engine;
    const tp = s.redTiming.red[Math.max(0, bsearchLE(s.redTiming.red, now, 'time'))];
    const active = e.columns.reduce((a, c, i) => a + Math.max(0, Math.min(c.length, e.ptr[i] + 30) - e.ptr[i]), 0);
    const mem = performance.memory ? fmtBytes(performance.memory.usedJSHeapSize) : 'n/a';
    const W = e.W.map(w => (w / s.rate).toFixed(1));
    this.debugEl.textContent =
`ASHTONK!MANIA DEBUG
FPS          ${FPS.fps.toFixed(0)} (${FPS.frameMs.toFixed(2)}ms)
Audio time   ${(AudioManager.ctx.currentTime * 1000).toFixed(1)}ms  [${AudioManager.ctx.state}]
Out latency  ${((AudioManager.ctx.outputLatency || AudioManager.ctx.baseLatency || 0) * 1000).toFixed(1)}ms
Song pos     ${Music.time.toFixed(1)}ms
Game time    ${now.toFixed(1)}ms  (offset ${Settings.get('audio.offset')}+${s.mapOffset || 0}ms, rate ${s.rate}x)
Last error   ${s.debug.lastErr == null ? '—' : s.debug.lastErr.toFixed(2) + 'ms'}
BPM          ${tp ? (60000 / tp.beatLength).toFixed(2) : '—'}
Scroll vel   ${s.scroll.velAt(now).toFixed(3)}x
Active notes ${active}  (remaining judgements ${e.remaining})
Input events ${e.inputCount}  recorded ${s.events.length / 3}
Windows ms   ${W.join(' / ')}
Health       ${(e.health.value * 100).toFixed(1)}%
Memory       ${mem}
Skin         ${SkinManager.current.name} (${s.layout.from4K ? 'skin.ini [Mania] 4K, patterned to ' + s.keys + 'K' : s.layout.fromSkinIni ? 'skin.ini [Mania] ' + s.keys + 'K' : 'defaults'})`;
  },

  checkEnd(now) {
    const s = this.s, e = s.engine;
    if (s.finished) return;
    if (e.health.failed && !s.practice) { this.fail(now); return; }
    const done = e.finished && now > s.endTime + 400 * s.rate;
    const audioDone = !Music.playing && Music.pausedPos >= Music.duration - 5 && now > 0;
    if (s.practice) return;
    if (done || (audioDone && now > s.endTime)) {
      this.complete();
    }
  },

  // ─────────────────────────────── input ───────────────────────────────
  inputTime(e) {
    const s = this.s;
    const ctxT = AudioManager.perfToCtx(e.timeStamp || performance.now());
    return Music.timeAtCtx(ctxT) - this.offsetMs() * s.rate - Settings.get('input.latency') * s.rate;
  },
  onKeyDown(e) {
    if (Screens.current !== this) return;
    const s = this.s;
    if (Overlays.top()) return;
    if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) this.onBack(); return; }
    if (!s || !this.loaderGone) {
      if (!this.loaderGone && (e.code === 'Space' || e.code === 'Enter') && !(e.target.closest && e.target.closest('input, button'))) { e.preventDefault(); this.loaderSkip = true; }
      return;
    }
    // quick exit (lazer: hold Ctrl+`): back to song select after half a second
    if ((e.ctrlKey || e.metaKey) && e.code === 'Backquote') {
      e.preventDefault();
      if (!e.repeat) { clearTimeout(this._exitHold); this.holdEl.classList.add('on'); this._exitHold = setTimeout(() => { this.holdEl.classList.remove('on'); if (s.mp) this.mpQuit(); else this.quit(); }, 500); }
      return;
    }
    // retry: hold R (or `) for half a second — never instant. Ctrl+R counts as holding R (and doesn't reload the
    // page). An R bound to a lane stays a lane key.
    if (this.isRetryKey(e)) {
      e.preventDefault();
      if (!s.mp && !e.repeat) { clearTimeout(this._retryHold); this.holdEl.classList.add('on'); this._retryHold = setTimeout(() => this.retry(), 500); }
      return;
    }
    if (e.code === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !this.pauseEl) { e.preventDefault(); if (!e.repeat) this.toggleLeaderboard(); return; }
    if (e.shiftKey && e.code === 'Tab') { e.preventDefault(); this.hud.classList.toggle('hidden-hud'); OSD.show('HUD', this.hud.classList.contains('hidden-hud') ? 'hidden (hold Ctrl to peek)' : 'shown', 'Shift+Tab'); return; }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') return; // global debug toggle
    // scroll speed while playing: F3 / F4 (osu!stable) or Ctrl − / Ctrl + (osu!lazer)
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.code === 'F3' || e.code === 'F4' || (ctrl && ['Minus', 'Equal', 'NumpadSubtract', 'NumpadAdd'].includes(e.code))) {
      e.preventDefault(); e.stopPropagation();
      this.changeScrollSpeed(e.code === 'F4' || e.code === 'Equal' || e.code === 'NumpadAdd' ? 1 : -1);
      return;
    }
    // lazer: − / + nudge the beatmap's offset (unless they're lane keys)
    if (!ctrl && !e.altKey && !s.practice && ['Minus', 'Equal', 'NumpadSubtract', 'NumpadAdd'].includes(e.code) && !s.keyMap.has(e.code)) {
      e.preventDefault(); e.stopPropagation();
      this.nudgeMapOffset(e.code === 'Equal' || e.code === 'NumpadAdd' ? 1 : -1);
      return;
    }
    // lazer's HoldForHUD: with the HUD hidden (Shift+Tab), holding Ctrl shows it
    if ((e.key === 'Control') && this.hud.classList.contains('hidden-hud')) this.hud.classList.add('peek');
    if (s.practice && this.practiceKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
    if (this.replayBar && this.replayKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
    const col = s.keyMap.get(e.code);
    if (col !== undefined) {
      e.preventDefault(); e.stopPropagation();
      if (e.repeat || !s.running || s.feed) return;
      this.keyDown(col, e.code, this.inputTime(e));
      return;
    }
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); this.skip(); return; }
    if (e.code === 'F11') return;
    if (s.running && !e.ctrlKey && !e.metaKey && !e.altKey && e.code !== 'Tab') e.preventDefault();
  },
  onTouch(e) {
    const s = this.s;
    if (!s || Screens.current !== this) return;
    if (e.target.closest && e.target.closest('button, .pause-menu, .replay-bar, .gp-skip, a, input')) return; // (buttons work as buttons)
    e.preventDefault();
    if (s.feed) return;
    const t = this.inputTime(e);
    for (const tc of e.changedTouches) {
      const id = 'touch' + tc.identifier, was = this._touches.get(id);
      if (e.type === 'touchend' || e.type === 'touchcancel') {
        if (was != null) { this._touches.delete(id); if (s.running) this.keyUp(was, id, t); else { s.down[was].delete(id); s.held[was] = s.down[was].size > 0; } }
        continue;
      }
      const K = s.down.length;
      const col = this.hitbox ? Math.max(0, Math.min(K - 1, Math.floor(tc.clientX / innerWidth * K))) : this.renderer.columnAt(tc.clientX, was ?? -1);
      if (col < 0 || col === was) continue;
      if (was != null) this.keyUp(was, id, t);
      this._touches.set(id, col);
      if (s.running) this.keyDown(col, id, t);
    }
    if (this.hitbox) { const kids = this.hitbox.children; for (let i = 0; i < kids.length; i++) { const on = s.down[i].size > 0; if (kids[i]._on !== on) { kids[i]._on = on; kids[i].classList.toggle('on', on); } } }
  },
  isRetryKey(e) { return e.code === 'Backquote' || (e.code === 'KeyR' && !(this.s && this.s.keyMap.has('KeyR'))); },
  onKeyUp(e) {
    if (Screens.current !== this) return;
    const s = this.s;
    if (this.isRetryKey(e)) { clearTimeout(this._retryHold); clearTimeout(this._exitHold); this.holdEl && this.holdEl.classList.remove('on'); }
    if (e.key === 'Control' && this.hud) this.hud.classList.remove('peek');
    if (!s) return;
    const col = s.keyMap.get(e.code);
    if (col === undefined) return;
    e.preventDefault(); e.stopPropagation();
    if (!s.running || s.feed) { s.held[col] = false; s.down[col].clear(); return; }
    this.keyUp(col, e.code, this.inputTime(e));
  },
  /** Two keys can be bound to one column: it's pressed when the first goes down and released when the last comes up. */
  keyDown(col, code, t) {
    const d = this.s.down[col];
    if (d.has(code)) return;
    d.add(code);
    if (d.size === 1) this.press(col, true, t);
  },
  keyUp(col, code, t) {
    const d = this.s.down[col];
    if (!d.delete(code)) return;
    if (d.size === 0) this.press(col, false, t);
  },
  press(col, down, t) {
    const s = this.s, eng = s.engine;
    if (s.held[col] === down) return;
    t = Math.round(t * 100) / 100;
    if (t < eng.lastTime) t = eng.lastTime; // keeps live play and replay playback bit-identical
    s.held[col] = down;
    if (!down) this.renderer.onRelease(col, performance.now());
    if (!s.practice) s.events.push(t, col, down ? 1 : 0);
    eng.input(col, down, t);
  },
  releaseAll() {
    const s = this.s;
    if (!s) return;
    const t = this.gameTime();
    for (let c = 0; c < s.keys; c++) if (s.held[c] && !s.feed) this.press(c, false, t);
    if (s.feed) s.held.fill(false);
    s.down.forEach(d => d.clear());
  },

  onEngineEvent(e) {
    if (this._resim) return; // seeking a replay: re-judging up to the new time, no effects or sounds
    const s = this.s;
    const realNow = performance.now();
    if (e.type === 'judgement') {
      this.renderer.onJudgement(e, realNow);
      if (this.errMeter) this.errMeter.add(e.err, e.j, realNow);
      if (e.err != null) s.debug.lastErr = e.err / s.rate;
      if (e.j === J.MISS && s.engine.score.comboBreaks && this._lastCombo >= 20) SkinManager.sample('combobreak').then(b => b && AudioManager.play(b));
      this._lastCombo = s.engine.score.combo;
    } else if (e.type === 'earlyRelease' && e.broke) {
      if (this._lastCombo >= 20) SkinManager.sample('combobreak').then(b => b && AudioManager.play(b));
      this._lastCombo = 0;
    }
  },

  skip() {
    const s = this.s;
    if (!s || !s.running) return;
    const now = this.gameTime();
    if (now >= s.skipTarget - 1000 * s.rate) return;
    if (s.mp) {
      // multiplayer: everyone has to vote before the intro is skipped
      if (s.skipVoted) return;
      s.skipVoted = true;
      UISounds.click();
      Multiplayer.send({ t: 'skip' });
      this.mpSkipVotes({ votes: 1, total: Math.max(2, (Multiplayer.room && Multiplayer.room.players.length) || 2) });
      return;
    }
    UISounds.click();
    Music.play(s.skipTarget + this.offsetMs() * s.rate);
  },
  /** Multiplayer: show how many players want to skip. */
  mpSkipVotes(m) {
    if (!this.s || !this.s.mp || !this.skipBtn) return;
    const label = this.skipBtn.querySelector('.skip-votes') || this.skipBtn.appendChild(h('span.skip-votes'));
    label.textContent = ` ${m.votes}/${m.total}`;
    this.skipBtn.classList.toggle('voted', !!this.s.skipVoted);
  },
  /** Multiplayer: everyone voted — skip the intro now. */
  mpSkip() {
    const s = this.s;
    if (!s || !s.mp || !s.running) return;
    const now = this.gameTime();
    if (now >= s.skipTarget - 1000 * s.rate) return;
    UISounds.click();
    Music.play(s.skipTarget + this.offsetMs() * s.rate);
  },

  // ─────────────────────────────── pause / fail / complete ───────────────────────────────
  phone() { return typeof Mobile !== 'undefined' && Mobile.touch; },
  /** Phones: the song stops where it is, and instead of the pause menu, lazer's "click to resume": a tap anywhere
   *  (once the phone is held upright again — the turn prompt covers it till then) goes back to fullscreen and on.
   *  Used when the phone is turned, fullscreen is left or another app comes up. */
  tapToResume() {
    const s = this.s;
    if (!s || !s.running || s.finished) return;
    this.pause({ quiet: true });
    if (this.tapEl) this.tapEl.remove();
    const el = this.tapEl = h('div.gp-tap', { role: 'button', 'aria-label': 'Tap to resume' }, h('div.gp-tap-ring', h('i')), h('b', 'Tap to resume'), h('span', 'The song is paused.'));
    el.addEventListener('pointerup', e => {
      e.stopPropagation();
      if (this.tapEl !== el) return;
      el.remove(); this.tapEl = null;
      PlayScreen.enter();
      UISounds.click();
      this.resume();
    });
    this.el.append(el);
  },
  pause({ quiet = false } = {}) {
    const s = this.s;
    if (!s || !s.running || s.finished) return;
    this.releaseAll();
    s.running = false;
    Music.pause();
    if (Spectate.host.s === s) Spectate.hostPause(true, this.gameTime()); // (whoever's watching sees the pause too)
    SkinManager.sample('pause-loop').then(() => {});
    if (!quiet) this.showPause('Paused');
  },
  showPause(title, failed = false) {
    this.closePause();
    const s = this.s;
    const btns = [];
    // osu!lazer's GameplayMenuOverlay: wide slanted colour buttons (DialogButton) — continue green, retry yellow,
    // quit red — with the skin's pause-menu sounds (hover and clicks) when it has them
    const btn = (label, colour, fn, cls = '') => h(`button.pm-btn${cls}`, { style: { '--c': colour }, onclick: fn }, h('span.pm-band'), h('span.pm-label', label));
    if (!failed) btns.push(btn('Continue', '#88b300', () => { SkinManager.skinOnly('pause-continue-click'); this.resume(); }, '.primary'));
    btns.push(btn('Retry', '#eeaa00', () => { SkinManager.skinOnly('pause-retry-click'); this.retry(); }));
    btns.push(btn('Quit', '#aa1b27', () => { SkinManager.skinOnly('pause-back-click'); this.quit(); }, '.danger'));
    for (const b of btns) b.addEventListener('pointerenter', () => SkinManager.skinOnly('pause-hover', 0.7));
    // lazer's layout: the yellow 48px title centred in the space above the buttons, the buttons (80px tall, 80% of the
    // width), and "Retry count / Song progress / Accuracy" centred in the space below
    let prog = null;
    try { const now = this.gameTime(); if (s.endTime > s.firstNote) prog = Math.round(clamp((now - s.firstNote) / (s.endTime - s.firstNote), 0, 1) * 100); } catch { prog = null; }
    const el = h('div.pause-menu', h('div.pause-box',
      h('div.pm-head', h(`h2${failed ? '.failed' : ''}`, title.toLowerCase())),
      h('div.pm-buttons', ...btns),
      h('div.pm-info',
        h('div', 'Retry count: ', h('b', String(this.retryCount || 0))),
        prog != null ? h('div', 'Song progress: ', h('b', `${prog}%`)) : null,
        h('div', 'Accuracy: ', h('b', fmtAcc(s.engine.score.accuracy))))));
    if (failed && this.failedScore) el.append(this.failFooter());
    // (lazer's player settings, top right: change the offset or the background without leaving the song)
    else if (!failed && !s.mp && s.rec) {
      // (the groups fold up on their headers as lazer's do; Visual starts folded so the panel clears the buttons)
      const groups = this.playerSettings(s.rec, s.mode === 'play');
      for (const g of groups) { const t = g.querySelector('.pl-gt'); t.setAttribute('role', 'button'); t.onclick = () => { UISounds.click(); g.classList.toggle('collapsed'); }; }
      if (groups.length > 1) groups[0].classList.add('collapsed');
      const panel = h('div.pl-settings.pm-settings', ...groups);
      panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); document.activeElement && document.activeElement.blur(); this.resume(); } });
      el.append(panel);
    }
    this.pauseEl = el;
    this.el.appendChild(el);
    this.el.classList.add('show-cursor');
    const first = el.querySelector('button'); first && first.focus();
    el.addEventListener('keydown', ev => {
      const b = $$('button', el), i = b.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown') { b[(i + 1) % b.length].focus(); ev.preventDefault(); ev.stopPropagation(); }
      if (ev.key === 'ArrowUp') { b[(i - 1 + b.length) % b.length].focus(); ev.preventDefault(); ev.stopPropagation(); }
    });
  },
  /** lazer's FailOverlay footer: a #333 bar along the bottom with SaveFailedScoreButton — grey "save score"
   *  (download), yellow while saving, then green "watch replay" with a tick — and, our own, the failed play's results. */
  failFooter() {
    const score = this.failedScore, replay = this.failedReplay;
    const save = h('button.res-ab.wide.pm-save', { 'aria-label': 'Save score' }, h('span.pm-save-i', icon('download')), h('span.pm-save-ok', icon('check')));
    const paint = st => {
      save.dataset.state = st;
      save.title = st === 'saved' ? 'watch replay' : st === 'saving' ? 'importing score' : replay ? 'save score' : 'replay unavailable';
      save.disabled = st === 'saving' || (!replay && st !== 'saved');
      save.firstChild.replaceChildren(icon(st === 'saved' ? 'play' : 'download'));
    };
    paint(score.replayId ? 'saved' : 'idle');
    save.onclick = async () => {
      UISounds.click();
      if (save.dataset.state === 'saved') {
        const r = replay || await ReplayManager.get(score.replayId);
        if (r) Game.launch({ mapId: this.params.mapId, mode: 'replay', replay: r, returnTo: { score, replay: r } });
        return;
      }
      if (!replay) return;
      paint('saving');
      try { if (!ScoreManager.scores.includes(score)) await ScoreManager.add(score); await ReplayManager.save(replay); score.replayId = replay.id; paint('saved'); } catch (e) { console.error(e); paint('idle'); }
    };
    const results = h('button.res-ab', { onclick: () => { UISounds.click(); Screens.go('results', { score, replay }, { replace: true }); }, title: 'view results', 'aria-label': 'View results' }, icon('chart'));
    return h('div.pm-foot', save, results);
  },
  closePause() { if (this.pauseEl) { this.pauseEl.remove(); this.pauseEl = null; } this.el && this.el.classList.remove('show-cursor'); },
  /** Phones held upright wait here until turned sideways (there's no upright gameplay). */
  /** Phones held sideways wait here until turned upright (gameplay on a phone is upright, as in lazer's app). */
  waitUpright() {
    const sideways = () => typeof Mobile !== 'undefined' && Mobile.touch && !Mobile.portrait;
    if (!sideways()) return Promise.resolve();
    return new Promise(res => { const f = () => { if (!sideways() || Screens.currentName !== 'gameplay') { window.removeEventListener('resize', f); res(); } }; window.addEventListener('resize', f); });
  },
  resume() {
    const s = this.s;
    if (!s || s.running || s.failed || s.finished) return;
    if (typeof Mobile !== 'undefined' && Mobile.touch && !Mobile.portrait && !s.mp) return; // (turn upright first)
    if (this.tapEl) { this.tapEl.remove(); this.tapEl = null; }
    this.closePause();
    const delay = s.feed ? 0 : Settings.get('gameplay.unpauseDelay'); // (no countdown when watching)
    if (Spectate.host.s === s) Spectate.hostPause(false, this.gameTime());
    if (delay <= 0) { s.running = true; Music.play(Music.pausedPos); return; }
    const steps = 3, stepMs = delay / steps;
    const cd = h('div.countdown', '3');
    this.el.appendChild(cd);
    SkinManager.skinOnly('count3s');
    let n = steps;
    const step = () => {
      if (!this.s || this.s !== s) { cd.remove(); return; }
      n--;
      if (n <= 0) { cd.remove(); SkinManager.skinOnly('gos'); s.running = true; Music.play(Music.pausedPos); return; }
      SkinManager.skinOnly(`count${n}s`);
      cd.textContent = String(n);
      this._cdT = setTimeout(step, stepMs);
    };
    this._cdT = setTimeout(step, stepMs);
  },
  retry() {
    clearTimeout(this._cdT);
    clearTimeout(this._retryHold);
    const p = this.params;
    this.retryCount = (this.retryCount || 0) + 1;
    Screens.go('gameplay', { ...p, force: true, quick: true }, { replace: true });
  },
  quit() {
    clearTimeout(this._cdT);
    if (this.params.replay && this.params.returnTo) { Screens.go('results', this.params.returnTo, { replace: true }); return; }
    Screens.go('songselect', { mapId: this.params.mapId }, { replace: true });
  },
  async fail(now) {
    const s = this.s;
    s.failClock = { real: performance.now(), t: this.gameTime() };
    s.running = false; s.failed = true; s.finished = true;
    this.releaseAll();
    this.failEl.classList.add('on');
    this.el.classList.add('failing'); // the stage sinks and dims (osu!lazer's fail animation)
    const src = Music.source;
    if (src) {
      const t = AudioManager.ctx.currentTime, r = src.playbackRate.value;
      src.playbackRate.setValueAtTime(r, t);
      src.playbackRate.linearRampToValueAtTime(r * 0.3, t + FAIL_WIND_DOWN);
      Music.setVolume(0, FAIL_WIND_DOWN * 1000);
      setTimeout(() => { if (Music.source === src) Music.stop(0); }, FAIL_WIND_DOWN * 1000 + 100);
    }
    SkinManager.sample('failsound').then(b => b && AudioManager.play(b));
    if (s.mode === 'play') {
      const { score } = await this.saveScore(false, { store: false }); // (not kept: only a play you finish is recorded)
      this.failedScore = score; this.failedReplay = this._unsavedReplay;
      if (s.mp) { Multiplayer.finish(score); Verified.room({ rec: s.rec, mods: s.mods, modConfig: s.modConfig, seed: s.seed, events: s.events }); setTimeout(() => { if (this.s === s) this.mpAfter(score, this.failedReplay); }, 1600); return; }
    }
    if (Settings.get('gameplay.retryOnFail') && s.mode === 'play') { setTimeout(() => { if (this.s === s) this.retry(); }, 1400); return; }
    setTimeout(() => { if (this.s === s) this.showPause('Failed', true); }, 900);
  },
  /** After a multiplayer song: lazer's results for everyone in the match (a regular room), or back to the room
   *  (Quick Play and Ranked Play show their standings there). */
  mpAfter(score, replay) {
    const r = Multiplayer.room;
    if (r && !r.rp && !r.qp) Screens.go('results', { score, replay, fresh: true, mp: true }, { replace: true, transition: 'zoom' });
    else Screens.go('multiplayer', {}, { replace: true });
  },
  async complete() {
    const s = this.s;
    if (!s || s.finished) return;
    // every note left is judged first (unhit ones are misses): however this is reached, a play can't end early with a clean score
    s.engine.advance(Infinity);
    s.finished = true; s.running = false;
    this.settleAutoScale();
    this.releaseAll();
    const summary = s.engine.summary();
    if (s.mode === 'play') {
      MapOffsets.last = { hash: s.rec.hash, mean: summary.meanError || 0, hits: s.engine.hitErrors.filter(e => !e.tail).length };
      // (a multiplayer play that ran out of health is a failed score: shown to the room, not recorded)
      const { score, replay } = await this.saveScore(!s.mpFailed, { store: !s.mpFailed });
      try { Medals.check(score, { mp: !!s.mp, daily: !!(this.params.daily && score.passed) }); } catch (e) { console.warn('medals', e); }
      // lazer's global leaderboard: a passed play goes up (the server keeps your best)
      if (score.passed && !s.mods.includes('AT') && s.mode === 'play' && !s.practice) Verified.submit({ rec: s.rec, mods: s.mods, modConfig: s.modConfig, seed: s.seed, events: s.events, daily: this.params.daily ? { day: this.params.daily.day } : null });
      if (s.mp) { Multiplayer.finish(score); Verified.room({ rec: s.rec, mods: s.mods, modConfig: s.modConfig, seed: s.seed, events: s.events }); setTimeout(() => { if (this.s === s) this.mpAfter(score, replay); }, 900); return; }
      setTimeout(() => { if (this.s === s) Screens.go('results', { score, replay, fresh: true }, { replace: true, transition: 'zoom' }); }, 600);
    } else {
      const score = this.buildScore(true, summary);
      setTimeout(() => { if (this.s === s) Screens.go('results', { score, replay: s.mode === 'replay' ? s.replay : null, fresh: false, watched: s.mode }, { replace: true, transition: 'zoom' }); }, 600);
    }
  },
  buildScore(passed, summary) {
    const s = this.s;
    const grade = ScoreSystem.gradeFor(summary.accuracy, !passed, s.mods, summary.counts);
    const stars = s.stars;
    const pp = passed && !s.mods.includes('AT') ? OsuMath.pp(stars, summary.counts, s.mods) : 0;
    return {
      id: 'sc-' + uid(), mapHash: s.rec.hash, mapId: s.rec.id, setId: s.rec.setId,
      title: s.rec.title, artist: s.rec.artist, version: s.rec.version, creator: s.rec.creator,
      keys: s.keys, stars, pp,
      mods: s.mods, rate: s.rate, score: summary.score, scoreStd: summary.scoreStd, accuracy: summary.accuracy, maxCombo: summary.maxCombo,
      counts: summary.counts, grade, passed, date: Date.now(),
      duration: Math.round(performance.now() - s.startedReal), player: s.replay ? s.replay.player : ProfileManager.profile.name, own: !s.replay,
      meanError: summary.meanError, unstableRate: summary.unstableRate, early: summary.early, late: summary.late,
      hitErrors: summary.hitErrors, totalJudgements: summary.totalJudgements, accuracyMode: s.accuracyMode,
      windows: s.windows, od: s.bm.od, replayId: null, modConfig: s.modConfig,
      healthTimeline: s.engine.health.timeline, srVersion: SR_VERSION,
    };
  },
  /** Build the play's score and replay; `store` keeps the score (a failed play isn't kept unless you save it from the
   *  fail screen, as lazer's SaveFailedScoreButton). */
  async saveScore(passed, { store = true } = {}) {
    const s = this.s;
    const summary = s.engine.summary();
    const score = this.buildScore(passed, summary);
    const replay = ReplayManager.build({
      map: s.rec, mods: s.mods, rate: s.rate, seed: s.seed, windows: s.windows, accuracyMode: s.accuracyMode, hp: s.bm.hp, keys: s.keys, modConfig: s.modConfig,
      events: s.events, summary: { ...summary, grade: score.grade }, scoreId: score.id, player: score.player, own: score.own, duration: score.duration, noFail: !!s.mp, rules: s.rules,
    });
    if (!store) { this._unsavedReplay = replay; return { score, replay }; }
    await ScoreManager.add(score);
    const mode = Settings.get('replays.autosave');
    if ((mode === 'all' && passed) || (mode === 'pb' && score.isPB)) {
      await ReplayManager.save(replay);
      score.replayId = replay.id;
    }
    this._unsavedReplay = replay;
    return { score, replay };
  },

  // ─────────────────────────────── breaks ───────────────────────────────
  /** Break overlay between distant notes (gaps of at least the minimum break length). */
  updateBreak(now) {
    const s = this.s;
    if (!s.running || s.practice) { if (this._inBreak) { this._inBreak = false; this.breakEl.classList.remove('show'); } return; }
    if (!s.gaps) {
      const minGap = Settings.get('gameplay.breakMin');
      const times = s.baseNotes.map(n => [n.time, n.end]).sort((a, b) => a[0] - b[0]);
      s.gaps = [];
      let lastEnd = times.length ? times[0][1] : 0;
      for (let i = 1; i < times.length; i++) {
        if (times[i][0] - lastEnd >= minGap * s.rate) s.gaps.push([lastEnd, times[i][0]]);
        lastEnd = Math.max(lastEnd, times[i][1]);
      }
    }
    const g = s.gaps.find(([a, b]) => now > a + 800 * s.rate && now < b - 800 * s.rate);
    if (!!g !== this._inBreak) {
      this._inBreak = !!g;
      // the skin's section sounds (osu!): how you're doing as the break starts
      if (g) SkinManager.skinOnly(s.engine.health.value >= 0.5 ? 'sectionpass' : 'sectionfail', 0.7);
      if (g) {
        // osu!lazer-style: countdown, a bar shrinking to the centre, and your current accuracy / rank
        const e = s.engine, grade = ScoreSystem.gradeFor(e.score.accuracy, false, s.mods, e.score.counts);
        this.brkCount = h('div.brk-count'); this.brkBar = h('i');
        clearEl(this.breakEl).append(this.brkCount, h('div.brk-bar', h('span.brk-arrow.l', '›'), h('div.brk-track', this.brkBar), h('span.brk-arrow.r', '‹')),
          h('div.brk-info', h('div', h('span', 'Accuracy'), h('b', fmtAcc(e.score.accuracy))), h('div', h('span', 'Rank'), gradeEl(grade))));
        this._brkLeft = this._brkQ = null;
      }
      this.breakEl.classList.toggle('show', !!g);
      this.breakEl.hidden = false;
      if (Settings.get('gameplay.lightenBreaks')) this.dimEl.style.opacity = g ? this.baseDim * 0.55 : this.baseDim;
    }
    if (!g) return;
    const left = Math.max(0, Math.ceil((g[1] - 800 * s.rate - now) / 1000 / s.rate));
    if (left !== this._brkLeft) { this._brkLeft = left; setText(this.brkCount, String(left)); }
    const rem = clamp((g[1] - 800 * s.rate - now) / (g[1] - g[0] - 1600 * s.rate), 0, 1);
    const q = Math.round(rem * 300);
    if (q !== this._brkQ) { this._brkQ = q; this.brkBar.style.transform = `scaleX(${q / 300})`; }
  },

  // ─────────────────────────────── gamepad ───────────────────────────────
  /** Gamepads: buttons are bound like keys ("Pad0", "Pad1", …) in the key configuration. */
  pollGamepad() {
    if (!navigator.getGamepads) return;
    const s = this.s;
    const pads = [...navigator.getGamepads()].filter(Boolean);
    if (!pads.length) return;
    this._padState = this._padState || {};
    for (const gp of pads) {
      gp.buttons.forEach((b, i) => {
        const code = `Pad${i}`, prev = !!this._padState[code], now = !!b.pressed;
        if (now === prev) return;
        this._padState[code] = now;
        const col = s.keyMap.get(code);
        if (col === undefined) return;
        const t = Music.timeAtCtx(AudioManager.perfToCtx(gp.timestamp || performance.now())) - this.offsetMs() * s.rate - Settings.get('input.latency') * s.rate;
        if (now) this.keyDown(col, code, t); else this.keyUp(col, code, t);
      });
    }
  },

  // ─────────────────────────────── watching replays ───────────────────────────────
  /** osu!lazer's replay player controls, for replays and Auto: pause, seek anywhere (the replay is re-judged
   *  up to that point, so the score is exactly what it was there) and playback speed. */
  buildReplayBar() {
    const s = this.s;
    const tl = h('div.rp-timeline', { title: 'Click or drag to seek' });
    const cv = h('canvas');
    // (fill and playhead move with transforms only, so updating them never re-lays out the page)
    this.rpFill = h('div.rp-fill'); this.rpHead = h('div.rp-headwrap', h('div.rp-head'));
    tl.append(cv, this.rpFill, this.rpHead);
    const span = () => ({ a: Math.min(0, s.startPos), b: s.endTime });
    const at = ev => { const r = tl.getBoundingClientRect(), { a, b } = span(); return a + clamp((ev.clientX - r.left) / r.width, 0, 1) * (b - a); };
    let drag = false, lastSeek = 0;
    tl.addEventListener('pointerdown', ev => { drag = true; tl.setPointerCapture(ev.pointerId); this.replaySeek(at(ev)); lastSeek = performance.now(); });
    tl.addEventListener('pointermove', ev => { if (drag && performance.now() - lastSeek > 90) { lastSeek = performance.now(); this.replaySeek(at(ev)); } });
    tl.addEventListener('pointerup', ev => { if (drag) { drag = false; this.replaySeek(at(ev)); } });
    tl.addEventListener('pointercancel', () => { drag = false; });
    this.rpPlay = h('button.btn.sm.rp-play', { onclick: () => this.replayToggle(), title: 'Pause / play (Space)' }, icon('pause'));
    this.rpTime = h('span.rp-time');
    this.rpSpeeds = REPLAY_SPEEDS.map(k => h(`button.chip${k === 1 ? '.on' : ''}`, { onclick: () => this.replaySpeed(k) }, `${k}×`));
    this._rpHover = false;
    // (on the side the notes come from, so it never covers the judgement line you're watching)
    const bar = h(`div.replay-bar${Settings.get('gameplay.scrollDirection') === 'up' ? '' : '.top'}`, { onpointerenter: () => { this._rpHover = true; }, onpointerleave: () => { this._rpHover = false; } },
      tl,
      h('div.rp-controls',
        this.rpPlay,
        h('button.btn.sm', { onclick: () => this.replaySeek(this.gameTime() - 5000 * s.rate), title: 'Back 5 seconds (←)' }, '−5s'),
        h('button.btn.sm', { onclick: () => this.replaySeek(this.gameTime() + 5000 * s.rate), title: 'Forward 5 seconds (→)' }, '+5s'),
        this.rpTime,
        h('span.grow'),
        h('span.muted.rp-label', 'Speed'),
        h('div.speed-group', ...this.rpSpeeds)));
    this.replayBar = bar;
    this.hud.append(bar);
    // note density along the timeline
    requestAnimationFrame(() => {
      if (!cv.isConnected) return;
      const dpr = Zoom.dpr();
      cv.width = Math.max(1, cv.clientWidth * dpr); cv.height = Math.max(1, cv.clientHeight * dpr);
      const x = cv.getContext('2d'), { a, b } = span();
      const bins = new Array(Math.max(10, Math.floor(cv.width / (3 * dpr)))).fill(0);
      for (const n of s.baseNotes) bins[clamp(Math.floor((n.time - a) / (b - a) * bins.length), 0, bins.length - 1)]++;
      const max = Math.max(...bins, 1), bw = cv.width / bins.length;
      bins.forEach((v, i) => { const hh = v / max * cv.height * 0.85; x.fillStyle = `rgba(255,255,255,${0.12 + 0.3 * v / max})`; x.fillRect(i * bw, cv.height - hh, Math.max(1, bw - dpr), hh); });
    });
    this._rpT = 0;
  },
  updateReplayBar(now, force = false) {
    const s = this.s;
    if (!this.replayBar || !s) return;
    const wall = performance.now();
    if (!force && wall - this._rpT < 100) return;
    // hidden (no mouse movement, playing, not hovered): nothing to update
    if (!force && s.running && !this.el.classList.contains('show-cursor') && !this._rpHover) return;
    this._rpT = wall;
    const a = Math.min(0, s.startPos), p = clamp((now - a) / Math.max(1, s.endTime - a), 0, 1);
    this.rpFill.style.transform = `scaleX(${p})`;
    this.rpHead.style.transform = `translateX(${p * 100}%)`;
    const t = `${fmtTime(Math.max(0, now / s.rate))} / ${fmtTime(s.endTime / s.rate)}`;
    setText(this.rpTime, t);
    const ic = s.running ? 'pause' : 'play';
    if (this.rpPlay.dataset.ic !== ic) { this.rpPlay.dataset.ic = ic; this.rpPlay.replaceChildren(icon(ic)); }
    this.replayBar.classList.toggle('paused', !s.running);
  },
  replayKey(e) {
    const s = this.s;
    switch (e.code) {
      case 'Space':
        if (e.repeat) return true;
        if (s.running && this.gameTime() < s.skipTarget - 1000 * s.rate) this.skip(); else this.replayToggle();
        return true;
      case 'ArrowLeft': this.replaySeek(this.gameTime() - 5000 * s.rate); return true;
      case 'ArrowRight': this.replaySeek(this.gameTime() + 5000 * s.rate); return true;
      case 'ArrowDown': case 'ArrowUp': {
        if (e.repeat) return true;
        const i = REPLAY_SPEEDS.indexOf(s.speed) + (e.code === 'ArrowUp' ? 1 : -1);
        if (i >= 0 && i < REPLAY_SPEEDS.length) this.replaySpeed(REPLAY_SPEEDS[i]);
        return true;
      }
    }
    return false;
  },
  replayToggle() {
    const s = this.s;
    if (!s || s.finished || s.failed || this.pauseEl || s.changingSpeed) return;
    if (s.running) { s.running = false; Music.pause(); }
    else { s.running = true; Music.play(Music.pausedPos); }
    UISounds.click();
    this.updateReplayBar(this.gameTime(), true);
  },
  /** Jump to song time `t`: a fresh engine re-judges the recorded inputs up to `t` (deterministic, so the
   *  score, combo and health are exactly what they were there), then the song carries on from `t`. */
  replaySeek(t) {
    const s = this.s;
    if (!s || !s.feed || s.finished || s.changingSpeed) return;
    t = clamp(t, Math.min(0, s.startPos), s.endTime + 300 * s.rate);
    this._resim = true;
    try {
      this.newEngine();
      const eng = s.engine, ev = s.feed;
      let i = 0;
      for (; i < ev.length && ev[i] <= t; i += 3) { s.held[ev[i + 1]] = ev[i + 2] === 1; eng.input(ev[i + 1], ev[i + 2] === 1, ev[i]); }
      eng.advance(t);
      s.feedIdx = i;
      this._lastCombo = eng.score.combo;
    } finally { this._resim = false; }
    if (this.errMeter) this.errMeter.clear();
    this._ppJudged = this._lastSc = this._lastAcc = undefined;
    const pos = t + this.offsetMs() * s.rate;
    if (s.running) Music.play(pos); else Music.pausedPos = pos;
    this.updateReplayBar(t, true);
  },
  /** Playback speed while watching (the recorded inputs stay on the song's clock, so they stay in sync). */
  async replaySpeed(k) {
    const s = this.s;
    if (!s || s.speed === k || s.changingSpeed || s.finished) return;
    const pos = Music.time, wasRunning = s.running;
    s.changingSpeed = true;
    s.running = false; Music.pause();
    s.speed = k;
    this.rpSpeeds.forEach((b, i) => b.classList.toggle('on', REPLAY_SPEEDS[i] === k));
    // back at 1× the play's own audio is used again (time-stretched for DT / HT with "keep pitch"); other speeds
    // just play faster or slower, so switching is instant
    const slow = k === 1 && s.preserve;
    const msg = slow ? h('div.hud-center-msg', 'Changing speed…') : null;
    if (msg) this.hud.append(msg);
    try { await Music.setRate(s.rate * k, k === 1 && s.preserve, f => { if (msg) msg.textContent = `Changing speed… ${Math.round(f * 100)}%`; }); }
    finally { msg && msg.remove(); s.changingSpeed = false; }
    if (this.s !== s) return;
    Music.pausedPos = pos;
    if (wasRunning) { s.running = true; Music.play(pos); }
    OSD.show('Playback speed', `${k}x`, 'Up / Down');
    this.updateReplayBar(this.gameTime(), true);
  },

  // ─────────────────────────────── practice ───────────────────────────────
  buildPracticeBar() {
    const s = this.s;
    const tl = h('div.pr-timeline');
    const cv = h('canvas');
    this.prLoop = h('div.pr-loop', { style: { display: 'none' } });
    this.prHead = h('div.pr-head');
    tl.append(cv, this.prLoop, this.prHead);
    tl.addEventListener('pointerdown', ev => {
      const r = tl.getBoundingClientRect();
      const t = (ev.clientX - r.left) / r.width * s.endTime;
      this.practiceSeek(t);
    });
    const speedBtns = PRACTICE_SPEEDS.map(sp => h(`button.chip${Math.abs(sp - s.rate) < 1e-3 ? '.on' : ''}`, { onclick: () => this.practiceSpeed(sp) }, `${Math.round(sp * 100)}%`));
    this.prOffset = h('span.muted');
    this.prInfo = h('span.muted');
    const bar = h('div.practice-bar',
      tl,
      h('div.pr-controls',
        h('span', { style: { fontWeight: 900, color: 'var(--gold)' } }, 'PRACTICE'),
        h('button.btn.sm', { onclick: () => this.setLoop('A'), title: 'Set loop start ( [ )' }, 'Set A ', h('span.kbd', '[')),
        h('button.btn.sm', { onclick: () => this.setLoop('B'), title: 'Set loop end ( ] )' }, 'Set B ', h('span.kbd', ']')),
        h('button.btn.sm', { onclick: () => this.setLoop('clear'), title: 'Clear loop ( \\ )' }, 'Clear'),
        h('button.btn.sm', { onclick: () => this.restartSection(), title: 'Restart section (Backspace)' }, icon('retry'), 'Restart ', h('span.kbd', '⌫')),
        h('div.speed-group', ...speedBtns),
        // (the offset nudge stays together: − offset +)
        h('span.pr-offset', h('button.btn.sm', { onclick: () => this.nudgeOffset(-5), title: 'Offset −5ms ( - )' }, '−'),
          this.prOffset,
          h('button.btn.sm', { onclick: () => this.nudgeOffset(5), title: 'Offset +5ms ( = )' }, '+')),
        h('span.grow'), this.prInfo));
    this.practiceBar = bar;
    this.hud.append(bar);
    this.placePracticeBar();
    this._prResize = () => this.placePracticeBar();
    window.addEventListener('resize', this._prResize);
    // density graph
    requestAnimationFrame(() => {
      const dpr = Zoom.dpr();
      cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
      const x = cv.getContext('2d');
      const bins = new Array(Math.max(10, Math.floor(cv.width / (3 * dpr)))).fill(0);
      for (const n of s.baseNotes) bins[Math.min(bins.length - 1, Math.floor(n.time / s.endTime * bins.length))]++;
      const max = Math.max(...bins, 1);
      const bw = cv.width / bins.length;
      bins.forEach((v, i) => {
        const hh = v / max * cv.height * 0.9;
        x.fillStyle = `rgba(176,124,255,${0.35 + 0.5 * v / max})`;
        x.fillRect(i * bw, cv.height - hh, Math.max(1, bw - dpr), hh);
      });
    });
    this.updatePracticeLabels();
  },
  /** Dock the practice tools beside the stage when there is room, so they never cover the receptors. */
  placePracticeBar() {
    const bar = this.practiceBar, r = this.renderer;
    if (!bar || !bar.isConnected) { window.removeEventListener('resize', this._prResize); return; }
    r.resize();
    const ratio = this.canvas.clientWidth / Math.max(1, r.W);
    const left = r.stageX * ratio;
    // beside the stage when it fits (a narrower panel just wraps into more rows); otherwise at the end of the screen
    // away from the receptors (the top for downscroll), never over them
    const docked = left >= 200;
    bar.classList.toggle('docked', docked);
    bar.classList.toggle('top', !docked && Settings.get('gameplay.scrollDirection') !== 'up');
    bar.style.width = docked ? Math.min(480, left - 24) + 'px' : '';
  },
  updatePracticeLabels() {
    if (!this.prOffset) return;
    this.prOffset.textContent = `offset ${Settings.get('audio.offset')}ms`;
    const s = this.s;
    if (!s) return;
    this.prInfo.textContent = s.loopA != null || s.loopB != null ? `loop ${fmtTime(s.loopA ?? 0)} → ${fmtTime(s.loopB ?? s.endTime)}` : 'click the timeline to seek';
    if (s.loopA != null || s.loopB != null) {
      const a = (s.loopA ?? 0) / s.endTime * 100, b = (s.loopB ?? s.endTime) / s.endTime * 100;
      Object.assign(this.prLoop.style, { display: '', left: a + '%', width: Math.max(0.3, b - a) + '%' });
    } else this.prLoop.style.display = 'none';
  },
  updatePractice(now) {
    const s = this.s;
    if (!s.practice || !this.prHead) return;
    this.prHead.style.left = clamp(now / s.endTime * 100, 0, 100) + '%';
    this.practiceBar.classList.toggle('dim', s.held.some(Boolean));
    if (s.loopB != null && now > s.loopB + 400 * s.rate) this.restartSection();
    if (s.loopB == null && now > s.endTime + 1000 * s.rate) this.practiceSeek(s.loopA ?? 0);
  },
  practiceKey(e) {
    const s = this.s;
    if (s.keyMap.has(e.code)) return false;
    switch (e.code) {
      case 'BracketLeft': this.setLoop('A'); return true;
      case 'BracketRight': this.setLoop('B'); return true;
      case 'Backslash': this.setLoop('clear'); return true;
      case 'Backspace': this.restartSection(); return true;
      case 'Minus': this.nudgeOffset(-5); return true;
      case 'Equal': this.nudgeOffset(5); return true;
      case 'ArrowLeft': this.practiceSeek(this.gameTime() - 5000 * s.rate); return true;
      case 'ArrowRight': this.practiceSeek(this.gameTime() + 5000 * s.rate); return true;
    }
    return false;
  },
  setLoop(which) {
    if (!this.s) return; // (the practice bar can still be clicked while the screen fades out)
    const s = this.s, t = this.gameTime();
    if (which === 'A') { s.loopA = clamp(t, 0, s.endTime); if (s.loopB != null && s.loopB <= s.loopA) s.loopB = null; }
    else if (which === 'B') { s.loopB = clamp(t, 0, s.endTime); if (s.loopA != null && s.loopA >= s.loopB) s.loopA = null; }
    else { s.loopA = null; s.loopB = null; }
    UISounds.click();
    this.updatePracticeLabels();
  },
  restartSection() { if (this.s) this.practiceSeek(this.s.loopA ?? 0); },
  practiceSeek(t) {
    const s = this.s;
    if (!s) return;
    t = clamp(t, 0, s.endTime);
    const lead = 1200 * s.rate;
    this.newEngine(t);
    s.running = true;
    this.closePause();
    Music.play(t - lead + this.offsetMs() * s.rate);
  },
  async practiceSpeed(sp) {
    const s = this.s;
    if (!s) return;
    const pos = this.gameTime();
    Settings.set('practice.speed', sp);
    Music.stop(0);
    s.running = false;
    const msg = h('div.hud-center-msg', 'Changing speed…');
    this.hud.append(msg);
    await Music.setRate(sp, Settings.get('audio.preservePitch'), f => msg.textContent = `Changing speed… ${Math.round(f * 100)}%`);
    msg.remove();
    s.rate = sp;
    $$('.speed-group .chip', this.practiceBar).forEach((b, i) => b.classList.toggle('on', Math.abs(PRACTICE_SPEEDS[i] - sp) < 1e-3));
    this.practiceSeek(s.loopA != null && pos < s.loopA ? s.loopA : Math.max(0, pos));
  },
  nudgeOffset(d) {
    Settings.set('audio.offset', clamp(Settings.get('audio.offset') + d, -300, 300));
    this.updatePracticeLabels();
  },
};

/** osu!lazer's hit error meter for mania (LegacyBarHitErrorMeter, bottom centre of the screen): each judgement's
 *  window as a colour bar 1.6 units per ms wide (the widest underneath), a white centre line, every hit's error as a
 *  3-unit additive line in its result's colour fading from 40% over ten seconds, and a white arrow easing (800ms)
 *  towards the floating average of the last hits. Drawn on a small canvas of its own. */
class HitErrorMeter {
  constructor(windows) {
    this.W = windows.slice(0, 5); // map-time windows: MAX, 300, 200, 100, 50
    this.max = Math.max(1, this.W[4]);
    this.w = this.max * 1.6; this.h = 3 * 4 * 1.6;
    this.lines = []; this.floating = 0; this.arrow = { from: 0, to: 0, t0: 0 };
    this.canvas = h('canvas.hud-err', { 'aria-hidden': 'true' });
    this.ctx = this.canvas.getContext('2d');
    this.dirty = true; this._dpr = 0;
  }
  add(err, j, now) {
    if (j === J.MISS || err == null) return;
    const rel = clamp(err / this.max / 2, -0.5, 0.5);
    this.lines.push({ x: rel, c: JUDGEMENT_COUNTER[j][2], t: now });
    if (this.lines.length > 400) this.lines.splice(0, this.lines.length - 400);
    this.floating = this.floating * 0.8 + rel * 0.2;
    this.arrow = { from: this.arrowAt(now), to: this.floating, t0: now };
    this.dirty = true;
  }
  clear() { this.lines.length = 0; this.dirty = true; }
  arrowAt(now) { const a = this.arrow, p = clamp((now - a.t0) / 800, 0, 1); return a.from + (a.to - a.from) * (1 - (1 - p) * (1 - p)); }
  draw(now) {
    const dpr = (window.devicePixelRatio || 1) / (Zoom.z || 1);
    if (dpr !== this._dpr) { this._dpr = dpr; this.canvas.width = Math.ceil(this.w * dpr); this.canvas.height = Math.ceil(this.h * dpr); this.canvas.style.width = this.w + 'px'; this.canvas.style.height = this.h + 'px'; this.dirty = true; }
    // (lines fade for ten seconds and the arrow eases for 0.8: redrawn only while something is changing)
    while (this.lines.length && now - this.lines[0].t > 10000) this.lines.shift();
    if (!this.dirty && !this.lines.length && now - this.arrow.t0 > 800) return;
    this.dirty = false;
    const c = this.ctx, W = this.w, H = this.h, cx = W / 2;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 0.6; c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.globalAlpha = 1;
    const bh = 3 * 1.6, by = (H - bh) / 2;
    for (let j = 4; j >= 0; j--) { const bw = this.W[j] * 1.6; c.fillStyle = JUDGEMENT_COUNTER[j][2]; c.fillRect(cx - bw / 2, by, bw, bh); }
    c.fillStyle = '#fff'; c.fillRect(cx - 0.75, 0, 1.5, H);
    c.globalCompositeOperation = 'lighter';
    for (const l of this.lines) { const a = 0.4 * (1 - (now - l.t) / 10000); if (a <= 0) continue; c.globalAlpha = a; c.fillStyle = l.c; c.fillRect(cx + l.x * W - 1.5, 0, 3, H); }
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    const ax = cx + this.arrowAt(now) * W, aw = 17 * 0.6, ah = 8 * 0.6;
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(ax - aw / 2, 0); c.lineTo(ax + aw / 2, 0); c.lineTo(ax, ah); c.closePath(); c.fill();
  }
}

/** The judgement counter's rows: osu!lazer's names and HitResult colours (OsuColour.ForHitResult) for mania. */
const JUDGEMENT_COUNTER = [[J.MARV, 'Perfect', '#99eeff'], [J.PERF, 'Great', '#66ccff'], [J.GREAT, 'Good', '#b3d944'], [J.GOOD, 'Ok', '#88b300'], [J.BAD, 'Meh', '#ffcc22'], [J.MISS, 'Miss', '#ed1121']];

/** osu!lazer's FPSCounter (osu.Game/Graphics/UserInterface/FPSCounter.cs), bottom right: the frame time on top
 *  (here: how long each frame keeps the browser busy, measured once the frame has been drawn — the browser has no
 *  separate update thread) and the frame rate under it, each tinted red → orange → lime by how close it is to the
 *  target (the display's refresh rate, or the frame limiter). Values are damped with a 100 ms half-life; a spike shows
 *  at once and brightens the counter, which dims to 70% after two quiet seconds. Hovering it shows the details. */
const FPS = {
  last: 0, fps: 0, frameMs: 0, // (also read by the debug overlays)
  shownFps: 0, shownMs: 0, aim: 60, deltas: [], stamps: [], lastText: 0, shownAt: 0, displayed: false, hovered: false,
  colour(r) {
    const lerp = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * clamp(t, 0, 1)));
    const RED = [237, 17, 33], ORANGE2 = [235, 194, 71], LIME0 = [204, 255, 153];
    const c = r < 0.5 ? lerp(RED, ORANGE2, r / 0.5) : lerp(ORANGE2, LIME0, (r - 0.5) / 0.4);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  },
  build(el) {
    this.el = el;
    this.msEl = h('span.fc-ms'); this.fpsEl = h('span.fc-fps');
    this.tipEl = h('div.fc-tip');
    clearEl(el).append(h('div.fc-main', h('div.fc-bg'), h('div.fc-counters', this.msEl, this.fpsEl)), this.tipEl);
    el.addEventListener('pointerenter', () => { this.hovered = true; el.classList.add('hover'); this.request(); });
    el.addEventListener('pointerleave', () => { this.hovered = false; el.classList.remove('hover'); this.request(); });
    // the frame's work, measured after it has been drawn (a message posted during the frame runs after rendering)
    this.mc = new MessageChannel();
    this.mc.port1.onmessage = e => { this.work = performance.now() - e.data; };
  },
  request() { this.shownAt = performance.now(); if (!this.displayed) { this.displayed = true; this.el.classList.add('shown'); } },
  frame(now) {
    const el = $('#fps-counter');
    const on = Settings.get('graphics.showFps');
    if (!on) { if (el && !el.hidden) { el.hidden = true; this.displayed = false; el.classList.remove('shown'); } this.last = now; return; }
    if (!this.el) this.build(el);
    if (el.hidden) { el.hidden = false; this.request(); }
    this.mc.port2.postMessage(now);
    if (this.last && now > this.last) {
      const dt = now - this.last;
      if (dt > 10000) { this.last = now; return; } // (the tab was in the background)
      // the target: the display's refresh rate (the quickest frames seen lately), or the frame limiter below it
      this.deltas.push(dt); if (this.deltas.length > 120) this.deltas.shift();
      const sorted = [...this.deltas].sort((a, b) => a - b), refresh = 1000 / sorted[Math.floor(sorted.length * 0.1)];
      const lim = Settings.get('graphics.fpsLimit');
      const aim = Math.round(lim > 0 ? Math.min(lim, refresh) : refresh);
      const aimChanged = Math.abs(aim - this.aim) > 2;
      if (aimChanged) this.aim = aim;
      // frames in the last second (lazer's FramesPerSecond)
      this.stamps.push(now); while (this.stamps.length && now - this.stamps[0] > 1000) this.stamps.shift();
      this.fps = this.stamps.length * 1000 / Math.max(250, now - this.stamps[0] || 1000);
      const work = Math.max(0.1, this.work || dt * 0.2);
      this.frameMs = work;
      const damp = (cur, target, half, el2) => target + (cur - target) * Math.pow(0.5, el2 / half);
      const updateSpike = this.shownMs < 20 && work > 20, drawSpike = this.shownFps > 1000 / 20 && dt > 20;
      this.shownMs = damp(this.shownMs, work, updateSpike ? 1e-9 : 100, work);
      this.shownFps = drawSpike ? 1000 / dt : damp(this.shownFps || this.fps, this.fps, 100, dt);
      if (now - this.lastText > 10) {
        this.lastText = now;
        setText(this.msEl, `${Math.max(1, Math.round(this.shownMs))} ms`); // (whole numbers only)
        setText(this.fpsEl, `${Math.round(this.shownFps).toLocaleString('en-US')} fps`);
        const cf = this.colour(this.shownFps / this.aim), cm = this.colour((1000 / this.shownMs) / this.aim);
        if (cf !== this._cf) { this._cf = cf; this.fpsEl.style.color = cf; }
        if (cm !== this._cm) { this._cm = cm; this.msEl.style.color = cm; }
        if (this.hovered) setText(this.tipEl, `Draw ${Math.round(this.fps)} fps · Frame ${Math.round(this.shownMs)} ms · Target ${this.aim} Hz`);
      }
      const significant = aimChanged || drawSpike || updateSpike || this.shownFps < this.aim * 0.8 || 1000 / this.shownMs < this.aim * 0.8;
      if (significant) this.request();
      else if (this.displayed && performance.now() - this.shownAt > 2000 && !this.hovered) { this.displayed = false; el.classList.remove('shown'); }
    }
    this.last = now;
  },
};
