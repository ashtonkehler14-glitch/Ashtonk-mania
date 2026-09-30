/* Gameplay screen: owns a play session.
 *  TimingEngine: song time = Music.time (audio clock) − audio offset.
 *  InputManager: keyboard events are timestamped with KeyboardEvent.timeStamp and mapped onto the
 *                audio clock, so judgement never depends on frame timing.
 *  Rendering follows the clock at whatever refresh rate the display runs (optional limiter). */

const Game = {
  /** Launch gameplay. opts: {mapId, mods, mode: 'play'|'practice'|'replay', replay} */
  launch(opts) {
    if (Settings.get('input.fullscreenOnPlay') && !document.fullscreenElement) toggleFullscreen(true);
    Screens.go('gameplay', { ...opts, force: true }, { transition: 'zoom' });
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
  resize() {
    const H = (this.el.parentElement && this.el.parentElement.clientHeight) || innerHeight;
    const u = H / 768, dpr = Zoom.dpr();
    const w = Math.max(this.bg ? this.bg.w : 0, this.fx + this.fill.w) + this.pad, hh = Math.max(this.bg ? this.bg.h : 0, this.fy + this.fill.h) + this.pad;
    this.u = u; this.k = u * dpr;
    this.el.width = Math.ceil(w * this.k); this.el.height = Math.ceil(hh * this.k);
    this.el.style.width = (w * u) + 'px'; this.el.style.height = (hh * u) + 'px';
    this.size = H; this.drawn = null;
  }
  update(v, now) {
    v = clamp(v, 0, 1);
    if (!this.size || Math.abs(((this.el.parentElement && this.el.parentElement.clientHeight) || innerHeight) - this.size) > 1) this.resize();
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
    this.draw(now);
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
    this._keydown = e => this.onKeyDown(e);
    this._keyup = e => this.onKeyUp(e);
    // losing focus pauses a solo play; a match can't pause, but keys held down would never see their keyup — let them go
    this._blur = () => { if (this.s && this.s.running) { if (!this.s.mp) this.pause(); else this.releaseAll(); } };
    window.addEventListener('keydown', this._keydown, true);
    window.addEventListener('keyup', this._keyup, true);
    window.addEventListener('blur', this._blur);
    this._audioSub = Bus.on('audio:state', st => { if (st !== 'running') this._blur(); });
    this._mm = () => { el.classList.add('show-cursor'); clearTimeout(this._mmT); this._mmT = setTimeout(() => el.classList.remove('show-cursor'), 1500); };
    el.addEventListener('pointermove', this._mm);
    this._settingsSub = Bus.on('settings:changed', k => { if (this.s && k !== 'gameplay.scrollSpeed' && (k.startsWith('gameplay.') || k.startsWith('skin.') || k === 'graphics.renderScale' || k === '*')) { this.renderer.resize(true); this.applyBackground(); }
      if (k === 'debug.overlay' && this.debugEl) this.debugEl.hidden = !Settings.get('debug.overlay'); });
    requestAnimationFrame(() => this.start(params).catch(e => { console.error(e); Toast.err('Could not start the beatmap', friendlyError(e)); Screens.go('songselect', {}, { replace: true }); }));
    return el;
  },
  leave() {
    this._tok = null;
    this.renderer && this.renderer.dispose();
    clearTimeout(this._retryHold);
    window.removeEventListener('keydown', this._keydown, true);
    if (this.videoEl) { this.videoEl.pause(); this.videoEl.removeAttribute('src'); this.videoEl.load(); }
    if (this._videoURL) { URL.revokeObjectURL(this._videoURL); this._videoURL = null; }
    window.removeEventListener('keyup', this._keyup, true);
    window.removeEventListener('blur', this._blur);
    this._audioSub && this._audioSub();
    cancelAnimationFrame(this._raf);
    this._settingsSub && this._settingsSub();
    if (this.s) { this.s.running = false; this.s = null; }
    Music.stop(150);
    this.closePause();
  },
  onBack() {
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
    // health bar: the skin's own scorebar when it has one (and that's the chosen style), else osu!lazer's in the HUD
    this.healthMode = healthModeFor(layout);
    // the canvas draws the slim stage bar and the skin's bar beside the stage; the other two are part of the HUD
    this.renderer.healthMode = this.healthMode === 'stage' || this.healthMode === 'skinstage' ? this.healthMode : null;
    this.renderer.coverage = (mods.includes('HD') || mods.includes('FI')) ? modConfig.cover : 0.5;

    const seed = replay ? replay.seed : (Math.random() * 2 ** 31) | 0;
    const baseNotes = prepareNotes(loaded.notes, keys, mods, seed);
    // replays keep the judging rules they were recorded with (older ones predate the rules field: rules 1)
    const rules = replay ? (replay.rules || 1) : RULES;
    const windows = replay ? replay.windows : timingWindows({ od: bm.od, mods, mode: Settings.get('gameplay.judgementMode'), customOD: Settings.get('gameplay.customOD'), customMs: Settings.get('gameplay.windowsMs'), odOverride: modConfig.od, rules });
    const accuracyMode = replay ? replay.accuracyMode : Settings.get('gameplay.accuracyMode');
    const scrollMode = mods.includes('CS') ? 'constant' : Settings.get('gameplay.scrollMode');
    const scroll = new ScrollMap(BeatmapParser.scrollSegments(bm, { useSV: scrollMode !== 'constant', useBPM: scrollMode === 'sv' }));
    const endTime = baseNotes.length ? Math.max(...baseNotes.map(n => n.end)) : 0;
    const redTiming = BeatmapParser.timing(bm);

    const s = this.s = {
      rec, bm, keys, mods, rate, preserve, practice, auto, replay, seed, windows, accuracyMode, layout, scroll, baseNotes, modConfig, rules, speed: 1,
      endTime, redTiming,
      firstNote: baseNotes.length ? baseNotes[0].time : 0,
      held: new Array(keys).fill(false), keyMap: new Map(), keyLabels: [], down: Array.from({ length: keys }, () => new Set()),
      events: [], running: false, finished: false, failed: false, startedReal: performance.now(), playedReal: 0,
      mode: replay ? 'replay' : auto ? 'auto' : practice ? 'practice' : 'play',
      loopA: null, loopB: null, speed: rate, mp: p.mp || null, mapOffset: MapOffsets.get(rec.hash),
      debug: { inputs: 0, lastErr: null },
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
    s.stars = rate === 1 && rec.srVersion === SR_VERSION ? rec.stars : DifficultyCalculator.calculate(baseNotes, keys, rate);
    Toolbar.setNowPlaying(rec);
    Music.onEnded = null;
    const mpWait = s.mp ? this.mpWait(s) : null; // the synchronised countdown runs under the loader
    await this.loaderFinish(tok);
    if (this._tok !== tok || this.s !== s) return;
    if (mpWait) { await mpWait; if (this.s !== s) return; }
    Music.play(startPos, { fadeIn: startPos >= 0 ? 150 : 0 });
    s.running = true;
    this.lastRender = 0;
    this.loop();
  },

  // ─────────────────────────────── player loader ───────────────────────────────
  /** osu!lazer's player loader: beatmap info, mods and loading progress in the middle, quick visual and audio
   *  settings on the right (hovering them holds the loader, as in lazer). */
  buildLoader(p) {
    const rec = this.bgRec;
    const mods = p.replay ? p.replay.mods : ModSystem.normalize(p.mods || []);
    const rate = p.replay ? p.replay.rate : p.mode === 'practice' ? (Settings.get('practice.speed') || 1) : ModSystem.rate(mods, p.modConfig || ModSystem.config());
    const cover = h('div.pl-cover');
    if (rec) BeatmapManager.bgURL(rec).then(u => { if (u) { cover.style.backgroundImage = `url("${u}")`; cover.classList.add('on'); } }).catch(() => {});
    this.plStatus = h('span', 'Loading…');
    this.plBar = h('i');
    const tag = p.replay ? h('span.pl-tag', icon('play'), `Replay · ${p.replay.player || 'Player'}`)
      : mods.includes('AT') ? h('span.pl-tag', icon('play'), 'Autoplay')
      : p.mode === 'practice' ? h('span.pl-tag', icon('target'), 'Practice')
      : p.mp ? h('span.pl-tag', icon('multi'), 'Multiplayer') : null;
    const card = h('div.pl-card',
      cover, h('div.pl-cover-shade'),
      h('div.pl-info',
        h('div.pl-tags', tag, this.retryCount ? h('span.pl-tag.retry', icon('retry'), `Retry #${this.retryCount}`) : null),
        h('div.pl-t', rec ? (Settings.get('ui.unicodeMetadata') && rec.titleUnicode ? rec.titleUnicode : rec.title) : 'Loading…'),
        h('div.pl-a', rec ? (Settings.get('ui.unicodeMetadata') && rec.artistUnicode ? rec.artistUnicode : rec.artist) : ''),
        rec ? h('div.pl-d', h('b', rec.version), starBadge(rec.stars || 0), h('span.keys-tag', `${rec.keys}K`)) : null,
        rec ? h('div.pl-m', 'mapped by ', h('b', rec.creator)) : null,
        rec ? h('div.pl-stats',
          h('span', icon('clock'), fmtTime((rec.length || 0) / rate)),
          rec.bpm ? h('span', icon('music'), `${Math.round(rec.bpm * rate)} BPM`) : null,
          rate !== 1 ? h('span', icon('sparkle'), `${+rate.toFixed(2)}× speed`) : null,
          h('span', icon('target'), `${fmtInt((rec.noteCount || 0) + (rec.lnCount || 0))} notes`)) : null,
        mods.length ? h('div.pl-mods', ...mods.map(m => ModSystem.badge(m))) : null),
      h('div.pl-load', h('span.spinner'), this.plStatus, h('div.pl-bar', this.plBar)));
    const settings = h('div.pl-settings', { onpointerenter: () => { this.loaderHold = true; }, onpointerleave: () => { this.loaderHold = false; } },
      h('div.pl-group', h('div.pl-gt', 'Visual settings'),
        this.loaderSlider('gameplay.bgDim', 'Background dim', 0, 1, 0.01, v => `${Math.round(v * 100)}%`, () => this.applyBackground()),
        this.loaderSlider('gameplay.bgBlur', 'Background blur', 0, 1, 0.05, v => `${Math.round(v * 100)}%`, () => this.applyBackground()),
        this.loaderSlider('gameplay.scrollSpeed', 'Scroll speed', 1, 40, 1, v => `${v}`)),
      rec && !p.replay ? this.loaderOffset(rec) : null);
    const el = h('div.gp-loader', card, settings,
      h('div.pl-hint', p.mp ? 'Get ready!' : h('span', h('span.kbd', 'Space'), ' start now · ', h('span.kbd', 'Esc'), ' back')));
    this.loaderT0 = performance.now();
    return el;
  },
  loaderSlider(k, label, min, max, step, fmt, after) {
    const inp = h('input.slider', { type: 'range', min, max, step, value: Settings.get(k), 'aria-label': label });
    const v = h('b');
    const upd = () => { const x = parseFloat(inp.value); v.textContent = fmt(x); inp.style.setProperty('--p', ((x - min) / (max - min) * 100) + '%'); };
    inp.addEventListener('input', () => { Settings.set(k, parseFloat(inp.value)); upd(); after && after(); });
    inp.addEventListener('keydown', e => e.stopPropagation());
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
      inp.addEventListener('keydown', e => e.stopPropagation());
      upd();
      clearEl(box).append(...[h('div.pl-gt', 'Audio settings'),
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
  async loaderFinish(tok) {
    const p = this.params, s = this.s;
    const min = p.quick ? 350 : 1600;
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
    setTimeout(() => el.remove(), 500);
  },

  newEngine(fromTime) {
    const s = this.s;
    let notes = s.baseNotes;
    if (fromTime != null) notes = notes.filter(n => n.time >= fromTime && (s.loopB == null || n.time <= s.loopB));
    s.engine = new GameplayEngine({ notes, keys: s.keys, windows: s.windows, rate: s.rate, mods: s.mods, hp: s.bm.hp, accuracyMode: s.accuracyMode, noFail: s.practice || !!s.mp || !!(s.replay && s.replay.noFail),
      breaks: s.bm.events.breaks, modConfig: s.modConfig, rules: s.rules });
    s.engine.onEvent(e => this.onEngineEvent(e));
    s.held.fill(false);
  },

  applyBackground() {
    const s = this.s, rec = s ? s.rec : this.bgRec;
    if (!rec) return;
    const show = Settings.get('gameplay.showBackground');
    this.baseDim = show ? Settings.get('gameplay.bgDim') : 1;
    this.dimEl.style.opacity = this.baseDim;
    const set = BeatmapManager.setById.get(rec.setId);
    const blur = Settings.get('gameplay.bgBlur');
    const tok = this._bgTok = {};
    (Settings.get('graphics.bgQuality') === 'low' ? BeatmapManager.thumbURL(set) : BeatmapManager.bgURL(rec)).then(async u => {
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
    vid.playbackRate = s.rate;
    if (vid.paused) { vid.currentTime = target; vid.play().catch(() => {}); return; }
    if (Math.abs(vid.currentTime - target) > 0.12) vid.currentTime = target;
  },

  buildHud() {
    const s = this.s;
    clearEl(this.hud);
    this._pq = this._pieQ = this._lead = this._canSkip = this._inBreak = this._progT = this._ppJudged = this._scT = undefined; this._lastSc = this._lastAcc = this._lastTT = undefined;
    this.scoreEl = h('div.sc', '0'); this.accEl = h('div.acc', '100.00%'); this.paceEl = h('div.pace');
    this.progEl = h('i');
    this.pieEl = h('div.hud-pie', { title: 'Song progress' });
    this.ppEl = h('div.hud-pp');
    const pd = Settings.get('gameplay.progressDisplay');
    this.hud.append(
      h('div.hud-progress', { style: { display: pd === 'bar' || pd === 'both' ? '' : 'none' } }, this.progEl),
      h('div.hud-score', this.scoreEl, h('div.hud-accrow', (pd === 'pie' || pd === 'both') ? this.pieEl : null, this.accEl), this.ppEl, this.paceEl),
      h('div.hud-mods', ...s.mods.map(m => ModSystem.badge(m))),
    );
    if (s.mode === 'replay' || s.mode === 'auto') {
      this.hud.append(h('div.hud-replay', h('span.dot'), s.mode === 'auto' ? 'AUTO' : `REPLAY · ${s.replay.player || 'Player'}`));
    }
    if (s.mp) { this.mpBoard = h('div.hud-mp'); this.hud.append(this.mpBoard); this._mpSent = 0; this._mpRows = null; this._oppShown = null; this._mpT = 0; this._mpDrawn = 0; }
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
    this.skipBtn = h('button.btn.hud-skip', { onclick: () => this.skip(), style: { display: 'none' } }, icon('skip'), 'Skip', h('span.kbd', 'Space'));
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
    if (s.feed && !s.practice && !s.mp) this.buildReplayBar();
    this.debugEl = h('div.debug-overlay', { hidden: !Settings.get('debug.overlay') });
    this.el.appendChild(this.debugEl);
  },

  // ─────────────────────────────── main loop ───────────────────────────────
  /** Global audio offset plus this beatmap's own offset, in ms. */
  offsetMs() { return Settings.get('audio.offset') + (this.s ? this.s.mapOffset || 0 : 0); },
  gameTime() { return Music.time - this.offsetMs() * this.s.rate; },
  loop() {
    const frame = () => {
      this._raf = requestAnimationFrame(frame);
      const s = this.s;
      if (!s) return;
      const realNow = performance.now();
      const now = this.gameTime();
      const eng = s.engine;
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
      if (lim > 0 && realNow - this.lastRender < 1000 / lim - 0.6) return;
      this.lastRender = realNow;
      const L = s.layout;
      const timeRange = 11485 / Settings.get('gameplay.scrollSpeed');
      this.renderer.render({
        now, posNow: s.scroll.pos(now), scroll: s.scroll, pxPerMs: this.renderer.scrollLength / (timeRange * s.rate),
        engine: eng, held: s.held,
        hidden: s.mods.includes('HD') ? 'HD' : s.mods.includes('FI') ? 'FI' : null, realNow, keyLabels: s.keyLabels,
        percy: s.mods.includes('PC') ? s.modConfig.percy : 0,
      });
      this.updateHud(now);
      this.updateBreak(now);
      this.syncVideo(now);
      if (s.running && !s.feed && GamepadWatch.connected) this.pollGamepad();
      if (!this.debugEl.hidden) this.updateDebug(now, realNow);
      FPS.frame(realNow);
      void L;
    };
    frame();
  },

  updateHud(now) {
    const s = this.s, e = s.engine;
    // multiplayer: health can reach 0 without failing — from then on score and pp count half
    if (s.mp && !s.mpDied && e.health.value <= 0) {
      s.mpDied = true;
      this.hud.append(h('div.hud-mpdied', 'Health reached 0 — score and pp halved'));
    }
    // score / accuracy text at most ~20× a second: on dense charts they change every frame, and each text
    // change costs a style + layout pass
    const wall0 = performance.now();
    if (!(wall0 - (this._scT || 0) < 50)) {
      this._scT = wall0;
      const sc = Math.round((s.mp ? e.score.score : ScoreManager.value(e.score)) * this.mpFactor());
      if (sc !== this._lastSc) { this._lastSc = sc; if (this._scoreDigits) this._scoreDigits.set(fmtScore(sc)); else this.scoreEl.textContent = fmtScore(sc); }
      const acc = e.score.accuracy;
      if (acc !== this._lastAcc) { this._lastAcc = acc; if (this._accDigits) this._accDigits.set(fmtAcc(acc)); else this.accEl.textContent = fmtAcc(acc); }
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
        const t = `${Math.round(this.livePp(e))}pp`;
        if (this.ppEl.textContent !== t) this.ppEl.textContent = t;
      }
    } else if (this.ppEl.textContent) this.ppEl.textContent = '';
    const canSkip = s.running && now < s.skipTarget - 1500 * s.rate && !s.practice;
    if (canSkip !== this._canSkip) { this._canSkip = canSkip; this.skipBtn.style.display = canSkip ? '' : 'none'; }
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
    const pb = this._pb === undefined ? (this._pb = ScoreManager.best(s.rec.hash)) : this._pb;
    if (pb && s.mode === 'play') {
      const t = `PB ${fmtAcc(pb.accuracy)}`;
      if (this.paceEl.textContent !== t) this.paceEl.textContent = t;
    }
  },
  /** osu!lazer-style in-game leaderboard: this map's local top scores with your live score climbing through them. */
  buildLeaderboard() {
    const s = this.s;
    this.lbEl = h('div.hud-mp.hud-lb'); this.hud.append(this.lbEl);
    this._lbT = 0; this._lbMe = null;
    if (s.mode === 'auto' || s.practice) return;
    const skip = s.replay && s.replay.scoreId;
    const rows = ScoreManager.forMap(s.rec.hash).filter(x => x.id !== skip && x.passed).slice(0, 6);
    const mk = (name, sub, sc, me) => {
      const r = { pos: h('span.pos'), sub: h('span', sub), sc: h('span.sc', sc) };
      r.el = h(`div.hud-mp-row${me ? '.me' : ''}`, r.pos, h('div.nm', h('b', name), r.sub), r.sc);
      this.lbEl.append(r.el); return r;
    };
    this._lbRows = rows.map(x => Object.assign(mk(x.player || ProfileManager.profile.name, `${fmtAcc(x.accuracy)} · ${fmtInt(x.maxCombo)}x${x.mods && x.mods.length ? ' · ' + x.mods.join('') : ''}`, fmtScore(ScoreManager.value(x))), { score: ScoreManager.value(x) }));
    this._lbMe = mk(s.mode === 'replay' ? (s.replay.player || 'Player') : ProfileManager.profile.name, '', '0', true);
    this.updateLeaderboard(true);
  },
  updateLeaderboard(force) {
    const me = this._lbMe;
    if (!me) return;
    const t = performance.now();
    if (!force && t - this._lbT < 150) return;
    this._lbT = t;
    const e = this.s.engine, sc = ScoreManager.value(e.score);
    // ties go to the score that was set first
    const above = this._lbRows.filter(r => r.score >= sc).length;
    if (me._pos !== above + 1) {
      me._pos = above + 1; me.pos.textContent = above + 1; me.el.style.order = above * 2 + 1;
      this._lbRows.forEach((r, i) => { const p = i + 1 + (i >= above ? 1 : 0); r.pos.textContent = p; r.el.style.order = i * 2 + (i >= above ? 2 : 0); });
    }
    const sub = `${fmtAcc(e.score.accuracy)} · ${fmtInt(e.score.combo)}x`, st = fmtScore(sc);
    if (me._sub !== sub) { me._sub = sub; me.sub.textContent = sub; }
    if (me._st !== st) { me._st = st; me.sc.textContent = st; }
  },
  /** The board Tab toggles: the multiplayer standings, or the local leaderboard. */
  board() { return this.mpBoard && this.s.mp ? this.mpBoard : this.lbEl; },
  toggleLeaderboard() {
    const on = !Settings.get('gameplay.leaderboard');
    Settings.set('gameplay.leaderboard', on);
    this.board().classList.toggle('lb-off', !on);
    Toast.show(on ? 'Leaderboard shown' : 'Leaderboard hidden', 'Tab');
  },
  /** Multiplayer: send our live score (4×/s) and show both players, highest first (osu!lazer-style board). */
  updateMp(e) {
    const t = performance.now();
    if (t - this._mpSent > 250 && this.s.running) {
      this._mpSent = t;
      this._myPp = this.livePp(e) * this.mpFactor();
      Multiplayer.send({ t: 'score', score: Math.round(e.score.score * this.mpFactor()), acc: e.score.accuracy, combo: e.score.combo, hp: e.health.value, pp: this._myPp });
    }
    // the opponent's score arrives 4×/s; ease the displayed value towards it so it counts up smoothly
    const o = Multiplayer.opp;
    // matches are won on pp, so the board ranks and shows live pp (score underneath)
    const target = o ? (o.pp || 0) : 0;
    this._oppShown = this._oppShown == null ? target : this._oppShown + (target - this._oppShown) * Math.min(1, (t - (this._mpT || t)) / 180);
    this._mpT = t;
    if (t - (this._mpDrawn || 0) < 100) return;
    this._mpDrawn = t;
    if (!this._mpRows) {
      const opp = Multiplayer.opponent();
      const mk = (name, me) => { const r = { pos: h('span.pos'), sub: h('span'), sc: h('span.sc') }; r.el = h(`div.hud-mp-row${me ? '.me' : ''}`, r.pos, h('div.nm', h('b', name), r.sub), r.sc); return r; };
      this._mpRows = [mk(ProfileManager.profile.name, true), opp ? mk(opp.name, false) : null].filter(Boolean);
      this.mpBoard.append(...this._mpRows.map(r => r.el));
    }
    const vals = [[this._myPp || 0, Math.round(e.score.score * this.mpFactor()), e.score.accuracy], [this._oppShown, o ? o.score : 0, o ? o.acc : 1]];
    const first = vals[1] && this._mpRows[1] && (vals[1][0] > vals[0][0] || (vals[1][0] === vals[0][0] && vals[1][1] > vals[0][1])) ? 1 : 0;
    this._mpRows.forEach((r, i) => {
      const [pp, sc, acc] = vals[i];
      const pos = i === first ? 1 : 2;
      const sub = `${fmtScore(sc)} · ${fmtAcc(acc)}`, st = `${Math.round(pp)}pp`;
      if (r._pos !== pos) { r._pos = pos; r.pos.textContent = pos; r.el.style.order = pos; }
      if (r._sub !== sub) { r._sub = sub; r.sub.textContent = sub; }
      if (r._st !== st) { r._st = st; r.sc.textContent = st; }
    });
  },
  /** Score / pp multiplier for the "can't die in multiplayer" rule. */
  mpFactor() { return this.s && this.s.mpDied ? 0.5 : 1; },
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
    if (!(await Dialog.confirm('Quit match?', 'Quitting counts as a loss.', { ok: 'Quit', danger: true }))) return;
    if (this.s !== s) return;
    Multiplayer.send({ t: 'quit' });
    s.finished = true; s.running = false;
    Screens.go('multiplayer', {}, { replace: true });
  },

  changeScrollSpeed(d) {
    const v = clamp(Settings.get('gameplay.scrollSpeed') + d, 1, 40);
    Settings.set('gameplay.scrollSpeed', v);
    if (!this.speedEl) { this.speedEl = h('div.gp-speed'); this.el.appendChild(this.speedEl); }
    this.speedEl.textContent = `Scroll speed ${v} (${Math.round(11485 / v)}ms)`;
    this.speedEl.classList.remove('show'); void this.speedEl.offsetWidth; this.speedEl.classList.add('show');
    clearTimeout(this._speedT); this._speedT = setTimeout(() => this.speedEl && this.speedEl.classList.remove('show'), 1200);
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
Skin         ${SkinManager.current.name} (${s.layout.fromSkinIni ? 'skin.ini [Mania] ' + s.keys + 'K' : 'defaults'})`;
  },

  checkEnd(now) {
    const s = this.s, e = s.engine;
    if (s.finished) return;
    if (e.health.failed && !s.practice) { this.fail(now); return; }
    const done = e.finished && now > s.endTime + 400 * s.rate;
    const audioDone = !Music.playing && Music.pausedPos >= Music.duration - 5 && now > 0;
    if (s.practice) return;
    if (done || (audioDone && now > s.endTime)) {
      e.advance(Infinity);
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
    // retry: hold R (or `) for half a second — never instant. Ctrl+R counts as holding R (and doesn't reload the
    // page). An R bound to a lane stays a lane key.
    if (this.isRetryKey(e)) {
      e.preventDefault();
      if (!s.mp && !e.repeat) { clearTimeout(this._retryHold); this.holdEl.classList.add('on'); this._retryHold = setTimeout(() => this.retry(), 500); }
      return;
    }
    if (e.code === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !this.pauseEl) { e.preventDefault(); if (!e.repeat) this.toggleLeaderboard(); return; }
    if (e.shiftKey && e.code === 'Tab') { e.preventDefault(); this.hud.classList.toggle('hidden-hud'); Toast.show(this.hud.classList.contains('hidden-hud') ? 'HUD hidden' : 'HUD shown', 'Shift+Tab'); return; }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') return; // global debug toggle
    // scroll speed while playing: F3 / F4 (osu!stable) or Ctrl − / Ctrl + (osu!lazer)
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.code === 'F3' || e.code === 'F4' || (ctrl && ['Minus', 'Equal', 'NumpadSubtract', 'NumpadAdd'].includes(e.code))) {
      e.preventDefault(); e.stopPropagation();
      this.changeScrollSpeed(e.code === 'F4' || e.code === 'Equal' || e.code === 'NumpadAdd' ? 1 : -1);
      return;
    }
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
  isRetryKey(e) { return e.code === 'Backquote' || (e.code === 'KeyR' && !(this.s && this.s.keyMap.has('KeyR'))); },
  onKeyUp(e) {
    if (Screens.current !== this) return;
    const s = this.s;
    if (this.isRetryKey(e)) { clearTimeout(this._retryHold); this.holdEl && this.holdEl.classList.remove('on'); }
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
  pause() {
    const s = this.s;
    if (!s || !s.running || s.finished) return;
    this.releaseAll();
    s.running = false;
    Music.pause();
    SkinManager.sample('pause-loop').then(() => {});
    this.showPause('Paused');
  },
  showPause(title, failed = false) {
    this.closePause();
    const s = this.s;
    const btns = [];
    // the skin's pause-menu sounds (hover and clicks), when it has them
    if (!failed) btns.push(h('button.btn.primary', { onclick: () => { SkinManager.skinOnly('pause-continue-click'); this.resume(); } }, icon('play'), 'Continue'));
    btns.push(h('button.btn', { onclick: () => { SkinManager.skinOnly('pause-retry-click'); this.retry(); } }, icon('retry'), 'Retry'));
    if (failed && this.failedScore) btns.push(h('button.btn', { onclick: () => Screens.go('results', { score: this.failedScore, replay: this.failedReplay }, { replace: true }) }, icon('chart'), 'View results'));
    btns.push(h('button.btn.danger', { onclick: () => { SkinManager.skinOnly('pause-back-click'); this.quit(); } }, icon('back'), 'Quit'));
    for (const b of btns) b.addEventListener('pointerenter', () => SkinManager.skinOnly('pause-hover', 0.7));
    const el = h('div.pause-menu', h('div.pause-box', h(`h2${failed ? '.failed' : ''}`, title), ...btns,
      h('div.pb-sub', failed ? `${fmtAcc(s.engine.score.accuracy)} · ${fmtInt(s.engine.score.maxCombo)}x` : `${s.rec.title} [${s.rec.version}]`),
      this.retryCount ? h('div.pb-retries', `You've retried ${this.retryCount} time${this.retryCount === 1 ? '' : 's'}`) : null,
      s.mp ? null : h('div.pb-keys', 'hold ', h('span.kbd', 'R'), ' to retry', failed ? null : [' · ', h('span.kbd', 'Esc'), ' continue'])));
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
  closePause() { if (this.pauseEl) { this.pauseEl.remove(); this.pauseEl = null; } this.el && this.el.classList.remove('show-cursor'); },
  resume() {
    const s = this.s;
    if (!s || s.running || s.failed || s.finished) return;
    this.closePause();
    const delay = s.feed ? 0 : Settings.get('gameplay.unpauseDelay'); // (no countdown when watching)
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
    s.running = false; s.failed = true; s.finished = true;
    this.releaseAll();
    this.failEl.classList.add('on');
    const src = Music.source;
    if (src) {
      const t = AudioManager.ctx.currentTime;
      src.playbackRate.setValueAtTime(src.playbackRate.value, t);
      src.playbackRate.linearRampToValueAtTime(0.3, t + 1.2);
      Music.setVolume(0, 1200);
      setTimeout(() => Music.stop(0), 1300);
    }
    SkinManager.sample('failsound').then(b => b && AudioManager.play(b));
    if (s.mode === 'play') {
      const { score } = await this.saveScore(false, now);
      this.failedScore = score; this.failedReplay = this._unsavedReplay;
      if (s.mp) { Multiplayer.finish(score); setTimeout(() => { if (this.s === s) Screens.go('multiplayer', {}, { replace: true }); }, 1600); return; }
    }
    if (Settings.get('gameplay.retryOnFail') && s.mode === 'play') { setTimeout(() => { if (this.s === s) this.retry(); }, 1400); return; }
    setTimeout(() => { if (this.s === s) this.showPause('Failed', true); }, 900);
  },
  async complete() {
    const s = this.s;
    s.finished = true; s.running = false;
    this.releaseAll();
    const summary = s.engine.summary();
    if (s.mode === 'play') {
      MapOffsets.last = { hash: s.rec.hash, mean: summary.meanError || 0, hits: s.engine.hitErrors.filter(e => !e.tail).length };
      const { score, replay } = await this.saveScore(true);
      if (s.mp) { Multiplayer.finish(score); setTimeout(() => { if (this.s === s) Screens.go('multiplayer', {}, { replace: true }); }, 900); return; }
      setTimeout(() => { if (this.s === s) Screens.go('results', { score, replay, fresh: true }, { replace: true, transition: 'zoom' }); }, 600);
    } else {
      const score = this.buildScore(true, summary);
      setTimeout(() => { if (this.s === s) Screens.go('results', { score, replay: s.mode === 'replay' ? s.replay : null, fresh: false, watched: s.mode }, { replace: true, transition: 'zoom' }); }, 600);
    }
  },
  buildScore(passed, summary) {
    const s = this.s;
    const grade = ScoreSystem.gradeFor(summary.accuracy, !passed, s.mods, summary.counts);
    const stars = s.rate === 1 && s.rec.srVersion === SR_VERSION ? s.rec.stars : DifficultyCalculator.calculate(s.baseNotes, s.keys, s.rate);
    const pp = (passed && !s.mods.includes('AT') ? OsuMath.pp(stars, summary.counts, s.mods) : 0) * this.mpFactor();
    if (s.mpDied) summary = { ...summary, score: Math.round(summary.score * 0.5), scoreStd: Math.round(summary.scoreStd * 0.5) };
    return {
      id: 'sc-' + uid(), mapHash: s.rec.hash, mapId: s.rec.id, setId: s.rec.setId,
      title: s.rec.title, artist: s.rec.artist, version: s.rec.version, creator: s.rec.creator,
      keys: s.keys, stars, pp,
      mods: s.mods, rate: s.rate, score: summary.score, scoreStd: summary.scoreStd, accuracy: summary.accuracy, maxCombo: summary.maxCombo,
      counts: summary.counts, grade, passed, date: Date.now(),
      duration: Math.round(performance.now() - s.startedReal), player: s.replay ? s.replay.player : ProfileManager.profile.name,
      meanError: summary.meanError, unstableRate: summary.unstableRate, early: summary.early, late: summary.late,
      hitErrors: summary.hitErrors, totalJudgements: summary.totalJudgements, accuracyMode: s.accuracyMode,
      windows: s.windows, od: s.bm.od, replayId: null, modConfig: s.modConfig,
      healthTimeline: s.engine.health.timeline, srVersion: SR_VERSION, healthPenalty: !!s.mpDied,
    };
  },
  async saveScore(passed) {
    const s = this.s;
    const summary = s.engine.summary();
    const score = this.buildScore(passed, summary);
    const replay = ReplayManager.build({
      map: s.rec, mods: s.mods, rate: s.rate, seed: s.seed, windows: s.windows, accuracyMode: s.accuracyMode, hp: s.bm.hp, keys: s.keys, modConfig: s.modConfig,
      events: s.events, summary: { ...summary, grade: score.grade }, scoreId: score.id, player: score.player, duration: score.duration, noFail: !!s.mp, rules: s.rules,
    });
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
    if (left !== this._brkLeft) { this._brkLeft = left; this.brkCount.textContent = left; }
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
    this.rpFill = h('div.rp-fill'); this.rpHead = h('div.rp-head');
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
    const bar = h('div.replay-bar',
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
    this._rpT = wall;
    const a = Math.min(0, s.startPos), p = clamp((now - a) / Math.max(1, s.endTime - a), 0, 1);
    this.rpFill.style.transform = `scaleX(${p})`;
    this.rpHead.style.left = (p * 100) + '%';
    const t = `${fmtTime(Math.max(0, now / s.rate))} / ${fmtTime(s.endTime / s.rate)}`;
    if (this.rpTime.textContent !== t) this.rpTime.textContent = t;
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
    Toast.show(`Playback speed ${k}×`);
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
        h('button.btn.sm', { onclick: () => this.nudgeOffset(-5), title: 'Offset −5ms ( - )' }, '−'),
        this.prOffset,
        h('button.btn.sm', { onclick: () => this.nudgeOffset(5), title: 'Offset +5ms ( = )' }, '+'),
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
    const docked = left >= 330;
    bar.classList.toggle('docked', docked);
    bar.style.width = docked ? Math.min(480, left - 32) + 'px' : '';
  },
  updatePracticeLabels() {
    if (!this.prOffset) return;
    this.prOffset.textContent = `offset ${Settings.get('audio.offset')}ms`;
    const s = this.s;
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
    const s = this.s, t = this.gameTime();
    if (which === 'A') { s.loopA = clamp(t, 0, s.endTime); if (s.loopB != null && s.loopB <= s.loopA) s.loopB = null; }
    else if (which === 'B') { s.loopB = clamp(t, 0, s.endTime); if (s.loopA != null && s.loopA >= s.loopB) s.loopA = null; }
    else { s.loopA = null; s.loopB = null; }
    UISounds.click();
    this.updatePracticeLabels();
  },
  restartSection() { this.practiceSeek(this.s.loopA ?? 0); },
  practiceSeek(t) {
    const s = this.s;
    t = clamp(t, 0, s.endTime);
    const lead = 1200 * s.rate;
    this.newEngine(t);
    s.running = true;
    this.closePause();
    Music.play(t - lead + this.offsetMs() * s.rate);
  },
  async practiceSpeed(sp) {
    const s = this.s;
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

/** Global frame statistics (FPS counter + debug). */
const FPS = {
  last: 0, fps: 0, frameMs: 0, acc: 0, n: 0,
  frame(now) {
    if (this.last) {
      const dt = now - this.last;
      this.frameMs = this.frameMs * 0.9 + dt * 0.1;
      this.acc += dt; this.n++;
      if (this.acc >= 500) {
        this.fps = this.n * 1000 / this.acc; this.acc = 0; this.n = 0;
        const el = $('#fps-counter');
        if (Settings.get('graphics.showFps')) {
          // osu!lazer style: big fps number + frame time, tinted by how healthy the frame rate is
          if (!this.fpsEl) { this.fpsEl = h('b'); this.msEl = h('i'); clearEl(el).append(h('span.fc-fps', this.fpsEl, h('small', 'fps')), this.msEl); }
          el.hidden = false;
          this.fpsEl.textContent = this.fps.toFixed(0);
          this.msEl.textContent = `${this.frameMs.toFixed(1)}ms`;
          const lvl = this.fps >= 55 ? 'good' : this.fps >= 30 ? 'ok' : 'bad';
          if (el.dataset.lvl !== lvl) el.dataset.lvl = lvl;
        } else if (!el.hidden) el.hidden = true;
      }
    }
    this.last = now;
  },
};
