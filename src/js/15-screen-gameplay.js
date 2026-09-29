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
    this.hud.append(h('div.hud-center-msg', { style: { fontSize: '1.4rem' } }, 'Preparing stage…'));
    this.renderer = new ManiaRenderer(this.canvas);
    this.params = params;
    this._keydown = e => this.onKeyDown(e);
    this._keyup = e => this.onKeyUp(e);
    this._blur = () => { if (this.s && this.s.running && !this.s.mp) this.pause(); };
    window.addEventListener('keydown', this._keydown, true);
    window.addEventListener('keyup', this._keyup, true);
    window.addEventListener('blur', this._blur);
    this._mm = () => { el.classList.add('show-cursor'); clearTimeout(this._mmT); this._mmT = setTimeout(() => el.classList.remove('show-cursor'), 1500); };
    el.addEventListener('pointermove', this._mm);
    this._settingsSub = Bus.on('settings:changed', k => { if (this.s && k !== 'gameplay.scrollSpeed' && (k.startsWith('gameplay.') || k.startsWith('skin.') || k === 'graphics.renderScale' || k === '*')) { this.renderer.resize(true); this.applyBackground(); }
      if (k === 'debug.overlay' && this.debugEl) this.debugEl.hidden = !Settings.get('debug.overlay'); });
    requestAnimationFrame(() => this.start(params).catch(e => { console.error(e); Toast.err('Could not start the beatmap', e.message); Screens.go('songselect', {}, { replace: true }); }));
    return el;
  },
  leave() {
    window.removeEventListener('keydown', this._keydown, true);
    if (this.videoEl) { this.videoEl.pause(); this.videoEl.removeAttribute('src'); this.videoEl.load(); }
    if (this._videoURL) { URL.revokeObjectURL(this._videoURL); this._videoURL = null; }
    window.removeEventListener('keyup', this._keyup, true);
    window.removeEventListener('blur', this._blur);
    cancelAnimationFrame(this._raf);
    this._settingsSub && this._settingsSub();
    if (this.s) { this.s.running = false; this.s = null; }
    Music.stop(150);
    this.closePause();
  },
  onBack() {
    if (this.s && this.s.mp) { this.mpQuit(); return true; }
    if (this.s) { if (this.s.running) this.pause(); else if (this.pauseEl && !this.s.failed) this.resume(); }
    return true;
  },

  async start(p) {
    const loaded = await BeatmapManager.load(p.mapId);
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
    const [layout, buffer] = await Promise.all([skin.mania(keys), TrackCache.get(rec.setId, rec.audioFile)]);
    Music.stop(0);
    await Music.load(buffer, `${rec.setId}/${rec.audioFile}`, { setId: rec.setId, mapId: rec.id });
    const msgEl = this.hud.querySelector('.hud-center-msg');
    await Music.setRate(rate, preserve, f => { if (msgEl) msgEl.textContent = `Preparing audio… ${Math.round(f * 100)}%`; });
    this.renderer.setLayout(layout);
    this.renderer.coverage = (mods.includes('HD') || mods.includes('FI')) ? modConfig.cover : 0.5;

    const seed = replay ? replay.seed : (Math.random() * 2 ** 31) | 0;
    const baseNotes = prepareNotes(loaded.notes, keys, mods, seed);
    const windows = replay ? replay.windows : timingWindows({ od: bm.od, mods, mode: Settings.get('gameplay.judgementMode'), customOD: Settings.get('gameplay.customOD'), customMs: Settings.get('gameplay.windowsMs'), odOverride: modConfig.od });
    const accuracyMode = replay ? replay.accuracyMode : Settings.get('gameplay.accuracyMode');
    const scrollMode = mods.includes('CS') ? 'constant' : Settings.get('gameplay.scrollMode');
    const scroll = new ScrollMap(BeatmapParser.scrollSegments(bm, { useSV: scrollMode !== 'constant', useBPM: scrollMode === 'sv' }));
    const endTime = baseNotes.length ? Math.max(...baseNotes.map(n => n.end)) : 0;
    const redTiming = BeatmapParser.timing(bm);

    const s = this.s = {
      rec, bm, keys, mods, rate, practice, auto, replay, seed, windows, accuracyMode, layout, scroll, baseNotes, modConfig,
      barlines: BeatmapParser.barlines(bm, endTime), barIdx: 0, endTime, redTiming,
      firstNote: baseNotes.length ? baseNotes[0].time : 0,
      held: new Array(keys).fill(false), keyMap: new Map(), keyLabels: [],
      events: [], running: false, finished: false, failed: false, startedReal: performance.now(), playedReal: 0,
      mode: replay ? 'replay' : auto ? 'auto' : practice ? 'practice' : 'play',
      loopA: null, loopB: null, speed: rate, mp: p.mp || null,
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
    if (s.mp) { await this.mpWait(s); if (this.s !== s) return; }
    Music.play(startPos, { fadeIn: startPos >= 0 ? 150 : 0 });
    s.running = true;
    this.lastRender = 0;
    this.loop();
  },

  newEngine(fromTime) {
    const s = this.s;
    let notes = s.baseNotes;
    if (fromTime != null) notes = notes.filter(n => n.time >= fromTime && (s.loopB == null || n.time <= s.loopB));
    s.engine = new GameplayEngine({ notes, keys: s.keys, windows: s.windows, rate: s.rate, mods: s.mods, hp: s.bm.hp, accuracyMode: s.accuracyMode, noFail: s.practice,
      breaks: s.bm.events.breaks, modConfig: s.modConfig });
    s.engine.onEvent(e => this.onEngineEvent(e));
    s.held.fill(false);
    s.barIdx = 0;
  },

  applyBackground() {
    const s = this.s;
    if (!s) return;
    const show = Settings.get('gameplay.showBackground');
    this.baseDim = show ? Settings.get('gameplay.bgDim') : 1;
    this.dimEl.style.opacity = this.baseDim;
    const set = BeatmapManager.setById.get(s.rec.setId);
    const blur = Settings.get('gameplay.bgBlur');
    (Settings.get('graphics.bgQuality') === 'low' ? BeatmapManager.thumbURL(set) : BeatmapManager.bgURL(s.rec)).then(async u => {
      // the blur is baked into a copy of the image once, so the GPU doesn't re-blur it every frame
      if (u && blur > 0) u = await blurredImage(u, blur).catch(() => u);
      if (this.s === s) this.bgEl.style.backgroundImage = show && u ? `url("${u}")` : 'none';
    });
    this.loadVideo();
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
    this._pq = this._pieQ = this._lead = this._canSkip = this._inBreak = undefined; this._lastSc = this._lastAcc = this._lastTT = undefined;
    this.scoreEl = h('div.sc', '0'); this.accEl = h('div.acc', '100.00%'); this.paceEl = h('div.pace');
    this.progEl = h('i');
    this.pieEl = h('div.hud-pie', { title: 'Song progress' });
    this.ppEl = h('div.hud-pp');
    this.kpsEl = h('div.hud-kps');
    const pd = Settings.get('gameplay.progressDisplay');
    this.hud.append(
      h('div.hud-progress', { style: { display: pd === 'bar' || pd === 'both' ? '' : 'none' } }, this.progEl),
      h('div.hud-score', this.scoreEl, h('div.hud-accrow', (pd === 'pie' || pd === 'both') ? this.pieEl : null, this.accEl), this.ppEl, this.paceEl, this.kpsEl),
      h('div.hud-mods', ...s.mods.map(m => ModSystem.badge(m))),
    );
    if (s.mode === 'replay' || s.mode === 'auto') {
      this.hud.append(h('div.hud-replay', h('span.dot'), s.mode === 'auto' ? 'AUTO' : `REPLAY · ${s.replay.player || 'Player'}`));
    }
    if (s.mp) { this.mpBoard = h('div.hud-mp'); this.hud.append(this.mpBoard); this._mpSent = 0; this._mpRows = null; this._oppShown = null; this._mpT = 0; this._mpDrawn = 0; }
    this.skipBtn = h('button.btn.hud-skip', { onclick: () => this.skip(), style: { display: 'none' } }, icon('skip'), 'Skip', h('span.kbd', 'Space'));
    this.hud.append(this.skipBtn);
    if (s.practice) this.buildPracticeBar();
    this.debugEl = h('div.debug-overlay', { hidden: !Settings.get('debug.overlay') });
    this.el.appendChild(this.debugEl);
  },

  // ─────────────────────────────── main loop ───────────────────────────────
  gameTime() { return Music.time - Settings.get('audio.offset') * this.s.rate; },
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
      const lim = Settings.get('graphics.fpsLimit');
      if (lim > 0 && realNow - this.lastRender < 1000 / lim - 0.6) return;
      this.lastRender = realNow;
      const L = s.layout;
      const timeRange = 11485 / Settings.get('gameplay.scrollSpeed');
      this.renderer.render({
        now, posNow: s.scroll.pos(now), scroll: s.scroll, pxPerMs: this.renderer.hitY / (timeRange * s.rate) * 1,
        engine: eng, held: s.held, barlines: s.barlines, get barIdx() { return s.barIdx; }, set barIdx(v) { s.barIdx = v; },
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
    const sc = e.score.score;
    if (sc !== this._lastSc) { this._lastSc = sc; this.scoreEl.textContent = fmtScore(sc); }
    const acc = e.score.accuracy;
    if (acc !== this._lastAcc) { this._lastAcc = acc; this.accEl.textContent = fmtAcc(acc); }
    const dur = s.endTime;
    const p = clamp((now - s.firstNote) / Math.max(1, dur - s.firstNote), 0, 1);
    // progress bar + osu!-style pie (green while counting down to the first note); DOM writes only when
    // the value moves by a visible step, so the HUD doesn't force a style pass every frame
    const lead = now < s.firstNote;
    const pieP = lead ? clamp(1 - (s.firstNote - now) / Math.max(1, s.firstNote - Math.min(0, s.startPos)), 0, 1) : p;
    const pq = Math.round(p * 400), pieQ = Math.round(pieP * 200);
    if (pq !== this._pq) { this._pq = pq; this.progEl.style.transform = `scaleX(${pq / 400})`; }
    if (pieQ !== this._pieQ || lead !== this._lead) {
      this._pieQ = pieQ;
      this.pieEl.style.setProperty('--p', (pieQ / 2) + '%');
      if (lead !== this._lead) { this._lead = lead; this.pieEl.classList.toggle('lead', lead); }
    }
    if (Settings.get('gameplay.showPp') && s.mode !== 'auto') {
      const pp = this.livePp(e);
      const t = `${Math.round(pp)}pp`;
      if (this.ppEl.textContent !== t) this.ppEl.textContent = t;
    } else if (this.ppEl.textContent) this.ppEl.textContent = '';
    if (Settings.get('gameplay.kpsCounter')) {
      const cutoff = performance.now() - 1000;
      while (this._kps && this._kps.length && this._kps[0] < cutoff) this._kps.shift();
      const t = `${(this._kps || []).length} KPS`;
      if (this.kpsEl.textContent !== t) this.kpsEl.textContent = t;
    }
    const canSkip = s.running && now < s.skipTarget - 1500 * s.rate && !s.practice;
    if (canSkip !== this._canSkip) { this._canSkip = canSkip; this.skipBtn.style.display = canSkip ? '' : 'none'; }
    if (s.mp) this.updateMp(e);
    const pb = this._pb === undefined ? (this._pb = ScoreManager.best(s.rec.hash)) : this._pb;
    if (pb && s.mode === 'play') {
      const t = `PB ${fmtAcc(pb.accuracy)}`;
      if (this.paceEl.textContent !== t) this.paceEl.textContent = t;
    }
  },
  /** Multiplayer: send our live score (4×/s) and show both players, highest first (osu!lazer-style board). */
  updateMp(e) {
    const t = performance.now();
    if (t - this._mpSent > 250 && this.s.running) {
      this._mpSent = t;
      Multiplayer.send({ t: 'score', score: e.score.score, acc: e.score.accuracy, combo: e.score.combo, hp: e.health.value });
    }
    // the opponent's score arrives 4×/s; ease the displayed value towards it so it counts up smoothly
    const o = Multiplayer.opp;
    const target = o ? o.score : 0;
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
    const vals = [[e.score.score, e.score.accuracy, e.score.combo], [Math.round(this._oppShown), o ? o.acc : 1, o ? o.combo : 0]];
    const first = vals[1] && this._mpRows[1] && vals[1][0] > vals[0][0] ? 1 : 0;
    this._mpRows.forEach((r, i) => {
      const [sc, acc, combo] = vals[i];
      const pos = i === first ? 1 : 2;
      const sub = `${fmtAcc(acc)} · ${fmtInt(combo)}x`, st = fmtScore(sc);
      if (r._pos !== pos) { r._pos = pos; r.pos.textContent = pos; r.el.style.order = pos; }
      if (r._sub !== sub) { r._sub = sub; r.sub.textContent = sub; }
      if (r._st !== st) { r._st = st; r.sc.textContent = st; }
    });
  },
  /** Wait for the synchronised start; everyone begins at the same moment. */
  async mpWait(s) {
    const el = h('div.mp-countdown');
    this.el.appendChild(el);
    while (this.s === s) {
      const left = s.mp.startAt - performance.now();
      if (left <= 0) break;
      el.textContent = left > 3000 ? 'Get ready…' : String(Math.ceil(left / 1000));
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
Game time    ${now.toFixed(1)}ms  (offset ${Settings.get('audio.offset')}ms, rate ${s.rate}x)
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
    return Music.timeAtCtx(ctxT) - Settings.get('audio.offset') * s.rate - Settings.get('input.latency') * s.rate;
  },
  onKeyDown(e) {
    if (Screens.current !== this) return;
    const s = this.s;
    if (Overlays.top()) return;
    if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) this.onBack(); return; }
    if (!s) return;
    if (e.code === 'Backquote' && !e.repeat && !s.mp) { e.preventDefault(); this._retryHold = setTimeout(() => this.retry(), 450); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyR') { e.preventDefault(); if (!s.mp) this.retry(); return; }
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
    const col = s.keyMap.get(e.code);
    if (col !== undefined) {
      e.preventDefault(); e.stopPropagation();
      if (e.repeat || !s.running || s.feed) return;
      this.press(col, true, this.inputTime(e));
      return;
    }
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); this.skip(); return; }
    if (e.code === 'F11') return;
    if (s.running && !e.ctrlKey && !e.metaKey && !e.altKey && e.code !== 'Tab') e.preventDefault();
  },
  onKeyUp(e) {
    if (Screens.current !== this) return;
    const s = this.s;
    if (e.code === 'Backquote') clearTimeout(this._retryHold);
    if (!s) return;
    const col = s.keyMap.get(e.code);
    if (col === undefined) return;
    e.preventDefault(); e.stopPropagation();
    if (!s.running || s.feed) { s.held[col] = false; return; }
    this.press(col, false, this.inputTime(e));
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
  },

  onEngineEvent(e) {
    const s = this.s;
    const realNow = performance.now();
    if (e.type === 'judgement') {
      this.renderer.onJudgement(e, realNow);
      if (e.err != null) s.debug.lastErr = e.err / s.rate;
      if (e.j === J.MISS && s.engine.score.comboBreaks && this._lastCombo >= 20) SkinManager.sample('combobreak').then(b => b && AudioManager.play(b));
      this._lastCombo = s.engine.score.combo;
    } else if (e.type === 'press') {
      (this._kps || (this._kps = [])).push(realNow);
    } else if (e.type === 'earlyRelease') {
      if (this._lastCombo >= 20) SkinManager.sample('combobreak').then(b => b && AudioManager.play(b));
      this._lastCombo = 0;
    }
  },

  skip() {
    const s = this.s;
    if (!s || !s.running) return;
    const now = this.gameTime();
    if (now >= s.skipTarget - 1000 * s.rate) return;
    UISounds.click();
    Music.play(s.skipTarget + Settings.get('audio.offset') * s.rate);
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
    if (!failed) btns.push(h('button.btn.primary', { onclick: () => this.resume() }, icon('play'), 'Continue'));
    btns.push(h('button.btn', { onclick: () => this.retry() }, icon('retry'), 'Retry'));
    if (failed && this.failedScore) btns.push(h('button.btn', { onclick: () => Screens.go('results', { score: this.failedScore, replay: this.failedReplay }, { replace: true }) }, icon('chart'), 'View results'));
    btns.push(h('button.btn.danger', { onclick: () => this.quit() }, icon('back'), 'Quit'));
    const el = h('div.pause-menu', h('div.pause-box', h(`h2${failed ? '.failed' : ''}`, title), ...btns,
      h('div.pb-sub', failed ? `${fmtAcc(s.engine.score.accuracy)} · ${fmtInt(s.engine.score.maxCombo)}x` : `${s.rec.title} [${s.rec.version}]`)));
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
    const delay = Settings.get('gameplay.unpauseDelay');
    if (delay <= 0) { s.running = true; Music.play(Music.pausedPos); return; }
    const steps = 3, stepMs = delay / steps;
    const cd = h('div.countdown', '3');
    this.el.appendChild(cd);
    let n = steps;
    const step = () => {
      if (!this.s || this.s !== s) { cd.remove(); return; }
      n--;
      if (n <= 0) { cd.remove(); s.running = true; Music.play(Music.pausedPos); return; }
      cd.textContent = String(n);
      this._cdT = setTimeout(step, stepMs);
    };
    this._cdT = setTimeout(step, stepMs);
  },
  retry() {
    clearTimeout(this._cdT);
    const p = this.params;
    Screens.go('gameplay', { ...p, force: true }, { replace: true });
  },
  quit() {
    clearTimeout(this._cdT);
    const s = this.s;
    if (s && s.mode === 'replay' && this.params.returnTo) { Screens.go('results', this.params.returnTo, { replace: true }); return; }
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
    const pp = passed && !s.mods.includes('AT') ? OsuMath.pp(stars, summary.counts, s.mods) : 0;
    return {
      id: 'sc-' + uid(), mapHash: s.rec.hash, mapId: s.rec.id, setId: s.rec.setId,
      title: s.rec.title, artist: s.rec.artist, version: s.rec.version, creator: s.rec.creator,
      keys: s.keys, stars, pp,
      mods: s.mods, rate: s.rate, score: summary.score, accuracy: summary.accuracy, maxCombo: summary.maxCombo,
      counts: summary.counts, grade, passed, date: Date.now(),
      duration: Math.round(performance.now() - s.startedReal), player: s.replay ? s.replay.player : ProfileManager.profile.name,
      meanError: summary.meanError, unstableRate: summary.unstableRate, early: summary.early, late: summary.late,
      hitErrors: summary.hitErrors, totalJudgements: summary.totalJudgements, accuracyMode: s.accuracyMode,
      windows: s.windows, od: s.bm.od, replayId: null, modConfig: s.modConfig,
      healthTimeline: s.engine.health.timeline, srVersion: SR_VERSION,
    };
  },
  async saveScore(passed) {
    const s = this.s;
    const summary = s.engine.summary();
    const score = this.buildScore(passed, summary);
    const replay = ReplayManager.build({
      map: s.rec, mods: s.mods, rate: s.rate, seed: s.seed, windows: s.windows, accuracyMode: s.accuracyMode, hp: s.bm.hp, keys: s.keys, modConfig: s.modConfig,
      events: s.events, summary: { ...summary, grade: score.grade }, scoreId: score.id, player: score.player, duration: score.duration,
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
        const t = Music.timeAtCtx(AudioManager.perfToCtx(gp.timestamp || performance.now())) - Settings.get('audio.offset') * s.rate - Settings.get('input.latency') * s.rate;
        this.press(col, now, t);
      });
    }
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
    Music.play(t - lead + Settings.get('audio.offset') * s.rate);
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
