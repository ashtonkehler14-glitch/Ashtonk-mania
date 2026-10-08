/* AudioManager + TimingEngine clock.
 *  The Web Audio clock is the single source of truth for gameplay time. Output timestamps
 *  (AudioContext.getOutputTimestamp) map the audio clock onto performance.now(), which lets us
 *  (a) interpolate smoothly between audio callbacks for rendering at any refresh rate and
 *  (b) convert input event timestamps into exact song positions for judgement. */

const AudioManager = {
  ctx: null, master: null, musicBus: null, fxBus: null, uiBus: null,
  _offset: null,      // smoothed (contextTime - performance.now()/1000)

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    // (iOS: the page's sound follows the ring/silent switch unless it says it's media — on a phone set to silent the
    // game played without a sound. The Audio Session API, Safari 16.4+; elsewhere there's nothing to set)
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not settable */ }
    this.ctx = new AC({ latencyHint: 'interactive' });
    // the browser can suspend audio on its own (another app takes the output, Safari's "interrupted"): gameplay pauses
    this.ctx.onstatechange = () => Bus.emit('audio:state', this.ctx.state);
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512; this.analyser.smoothingTimeConstant = 0; // (256 bins sampled raw, as lazer's BASS FFT512)
    // music → analyser → duck (a low-pass plus a little volume) → master: lazer muffles the music behind a dialog
    this.duckFilter = this.ctx.createBiquadFilter(); this.duckFilter.type = 'lowpass'; this.duckFilter.frequency.value = 22000;
    this.duckGain = this.ctx.createGain();
    // (one more volume between the music and everything after it, for mods that turn the music down — Muted)
    this.modGain = this.ctx.createGain();
    this.musicBus.connect(this.modGain); this.modGain.connect(this.analyser);
    this.analyser.connect(this.duckFilter); this.duckFilter.connect(this.duckGain); this.duckGain.connect(this.master);
    this.fxBus = this.ctx.createGain(); this.fxBus.connect(this.master);
    this.uiBus = this.ctx.createGain(); this.uiBus.connect(this.fxBus);
    this.applyVolumes();
    return this.ctx;
  },
  /** Muffle (or un-muffle) the music while a dialog is up, as lazer does; counted, so nested dialogs work. */
  _ducks: 0,
  duck(on) {
    this._ducks = Math.max(0, this._ducks + (on ? 1 : -1));
    if (!this.ctx) return;
    const t = this.ctx.currentTime, d = this._ducks > 0;
    this.duckFilter.frequency.cancelScheduledValues(t); this.duckGain.gain.cancelScheduledValues(t);
    this.duckFilter.frequency.setTargetAtTime(d ? 800 : 22000, t, d ? 0.04 : 0.08);
    this.duckGain.gain.setTargetAtTime(d ? 0.75 : 1, t, 0.06);
  },
  resume() { this.init(); if (this.ctx.state !== 'running') return this.ctx.resume().catch(() => {}); return Promise.resolve(); },
  /** Leaving the site (another tab, minimised) fades everything out; coming back fades it in again. */
  away: false,
  setAway(away) {
    if (this.away === away) return;
    this.away = away;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.setTargetAtTime(away ? 0 : Settings.get('audio.master'), t, away ? 0.12 : 0.25);
  },
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.away ? 0 : Settings.get('audio.master'), t, 0.02);
    this.musicBus.gain.setTargetAtTime(Settings.get('audio.music'), t, 0.02);
    this.fxBus.gain.setTargetAtTime(Settings.get('audio.effects'), t, 0.02);
    this.uiBus.gain.setTargetAtTime(Settings.get('audio.ui'), t, 0.02);
  },

  /** High precision "what the listener hears" on the audio clock, in seconds: now, or at a given performance.now()
   *  time (`atPerfMs`, e.g. the frame's vsync timestamp). */
  now(atPerfMs) {
    if (!this.ctx) return (atPerfMs ?? performance.now()) / 1000;
    this._sync();
    return (atPerfMs ?? performance.now()) / 1000 + this._offset;
  },
  /** The audio clock's offset from performance.now() (seconds), read from the output timestamp at most every 4 ms.
   *  The raw reading is only refreshed when the audio thread runs, so it jitters by a few ms from read to read; it's
   *  eased in over about a second (the two clocks drift apart by microseconds per second) instead of being followed,
   *  so notes move by exactly the time between frames. A big jump (a seek, a stall, the device changing) is taken at once. */
  _sampledAt: -1e9,
  _sync() {
    const ctx = this.ctx, p = performance.now();
    const dt = p - this._sampledAt;
    if (this._offset !== null && dt < 4) return;
    this._sampledAt = p;
    let raw = null;
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) raw = ts.contextTime - ts.performanceTime / 1000;
    }
    if (raw === null) raw = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) - p / 1000;
    // a big difference is only taken at once when it lasts (a quarter of a second): phones' output timestamps (Android
    // above all) now and then report one stale or early reading tens of ms off, and following it made the notes skip
    if (this._offset === null || ctx.state !== 'running') { this._offset = raw; this._farSince = 0; }
    else if (Math.abs(raw - this._offset) > 0.05) {
      if (!this._farSince) this._farSince = p;
      else if (p - this._farSince > 250) { this._offset = raw; this._farSince = 0; }
    } else { this._farSince = 0; this._offset += (raw - this._offset) * (1 - Math.exp(-Math.min(dt, 250) / 1000)); }
  },
  /** Convert a performance.now()-based timestamp (e.g. KeyboardEvent.timeStamp) onto the audio clock. */
  perfToCtx(perfMs) { if (!this.ctx) return perfMs / 1000; this._sync(); return perfMs / 1000 + this._offset; },

  decode(arrayBuffer) {
    this.init();
    const copy = arrayBuffer.slice(0);
    return new Promise((res, rej) => {
      const p = this.ctx.decodeAudioData(copy, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  },

  /** The music's volume for a mod (0–1), eased over `ms` (lazer eases Muted's changes over 500ms). */
  modVolume(v, ms = 500) {
    if (!this.modGain) return;
    const t = this.ctx.currentTime;
    this.modGain.gain.cancelScheduledValues(t);
    if (ms <= 0) this.modGain.gain.setValueAtTime(v, t); else this.modGain.gain.setTargetAtTime(v, t, ms / 4000);
  },
  /** Play a one-shot buffer on a bus. */
  play(buffer, { volume = 1, bus = 'fx', when = 0, rate = 1, pan = 0 } = {}) {
    if (!buffer || !this.ctx || this.ctx.state !== 'running') return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = volume;
    let node = src;
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; src.connect(p); node = p; }
    node.connect(g); g.connect(bus === 'ui' ? this.uiBus : bus === 'music' ? this.musicBus : this.fxBus);
    src.start(when || 0);
    return src;
  },

  /** Synthesized fallback sounds for the default skin (used only when no skin sound exists). */
  _synthCache: new Map(),
  synth(name) {
    this.init();
    if (this._synthCache.has(name)) return this._synthCache.get(name);
    const sr = this.ctx.sampleRate;
    const make = (dur, fn) => {
      const b = this.ctx.createBuffer(1, Math.max(1, Math.floor(sr * dur)), sr);
      const d = b.getChannelData(0);
      let seed = 1;
      const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };
      for (let i = 0; i < d.length; i++) d[i] = fn(i / sr, noise);
      return b;
    };
    let buf = null;
    const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
    if (/hitnormal/.test(name)) buf = make(0.09, (t, n) => (Math.sin(2 * Math.PI * 1800 * t) * 0.25 + n() * 0.35) * env(t, 0.001, 0.012) * 0.6);
    else if (/hitwhistle/.test(name)) buf = make(0.25, t => Math.sin(2 * Math.PI * (2200 + 300 * t) * t) * env(t, 0.005, 0.08) * 0.25);
    else if (/hitfinish/.test(name)) buf = make(0.6, (t, n) => (n() * 0.5 + Math.sin(2 * Math.PI * 520 * t) * 0.2) * env(t, 0.002, 0.18) * 0.35);
    else if (/hitclap/.test(name)) buf = make(0.15, (t, n) => n() * env(t, 0.001, 0.03) * 0.4);
    else if (name === 'combobreak') buf = make(0.35, t => Math.sin(2 * Math.PI * (420 - 500 * t) * t) * env(t, 0.005, 0.1) * 0.35);
    else if (name === 'click-short') buf = make(0.03, t => Math.sin(2 * Math.PI * 3200 * t) * env(t, 0.0005, 0.006) * 0.18);
    else if (name === 'click-short-confirm' || name === 'menuclick' || name === 'menuhit') buf = make(0.12, t => (Math.sin(2 * Math.PI * 880 * t) + Math.sin(2 * Math.PI * 1320 * t) * 0.5) * env(t, 0.002, 0.03) * 0.22);
    else if (name === 'menuback' || name === 'click-close') buf = make(0.12, t => Math.sin(2 * Math.PI * (900 - 2400 * t) * t) * env(t, 0.002, 0.035) * 0.22);
    // lazer's overlay-big-pop-in / -out: a soft whoosh, rising as an overlay's waves sweep up, falling as they drop
    else if (name === 'overlay-big-pop-in' || name === 'overlay-big-pop-out') {
      const up = name.endsWith('in'); let lp = 0;
      buf = make(0.32, (t, n) => { const f = up ? 0.04 + 0.5 * (t / 0.32) : 0.5 - 0.46 * (t / 0.32); lp += f * (n() - lp); return lp * env(t, up ? 0.06 : 0.01, up ? 0.09 : 0.07) * 0.9; });
    }
    // song select (lazer's select-expand / select-difficulty / select-random)
    else if (name === 'select-expand') buf = make(0.13, t => Math.sin(2 * Math.PI * (520 + 1500 * t) * t) * env(t, 0.003, 0.035) * 0.2);
    else if (name === 'select-difficulty') buf = make(0.07, t => (Math.sin(2 * Math.PI * 1250 * t) + Math.sin(2 * Math.PI * 1875 * t) * 0.3) * env(t, 0.001, 0.014) * 0.2);
    else if (name === 'select-random') buf = make(0.24, (t, n) => (n() * 0.35 + Math.sin(2 * Math.PI * (300 + 2200 * t) * t) * 0.45) * env(t, 0.012, 0.06) * 0.22);
    // results (lazer's score-tick while the accuracy circle fills, and the rank impact)
    else if (name === 'metronome-hi' || name === 'metronome-lo') { const f = name === 'metronome-hi' ? 1760 : 1320; buf = make(0.06, t => Math.sin(2 * Math.PI * f * t) * env(t, 0.0005, 0.015) * 0.35); }
    else if (name === 'score-tick') buf = make(0.03, t => Math.sin(2 * Math.PI * 2400 * t) * env(t, 0.0005, 0.006) * 0.12);
    else if (name === 'rank-impact-pass') buf = make(0.9, (t, n) => (Math.sin(2 * Math.PI * 70 * t) * env(t, 0.002, 0.12) * 0.6 + n() * env(t, 0.001, 0.05) * 0.25 + (Math.sin(2 * Math.PI * 1320 * t) + Math.sin(2 * Math.PI * 1980 * t) * 0.6) * env(t, 0.01, 0.35) * 0.12) * 0.5);
    else if (name === 'rank-impact-fail') buf = make(0.6, (t, n) => (Math.sin(2 * Math.PI * (90 - 40 * t) * t) * env(t, 0.002, 0.15) * 0.6 + n() * env(t, 0.001, 0.04) * 0.2) * 0.5);
    // lazer's UI/dialog-dangerous-tick (pitched up as the hold fills) and dialog-dangerous-select
    else if (name === 'dialog-dangerous-tick') buf = make(0.04, t => Math.sin(2 * Math.PI * 1100 * t) * env(t, 0.0005, 0.008) * 0.25);
    else if (name === 'dialog-dangerous-select') buf = make(0.5, (t, n) => (Math.sin(2 * Math.PI * (160 - 80 * t) * t) * env(t, 0.002, 0.12) * 0.6 + n() * env(t, 0.001, 0.03) * 0.25 + Math.sin(2 * Math.PI * 1760 * t) * env(t, 0.003, 0.08) * 0.1) * 0.5);
    // lazer's MedalSplash/medal-get: a bright rising chord over a soft swell
    else if (name === 'medal-get') buf = make(1.8, (t, n) => ([523, 784, 1047, 1568].reduce((a, f, k) => a + (t > k * 0.09 ? Math.sin(2 * Math.PI * f * t) * env(t - k * 0.09, 0.01, 0.7) : 0), 0) * 0.09 + n() * env(t, 0.3, 0.4) * 0.03));
    else if (name === 'check-on') buf = make(0.08, t => Math.sin(2 * Math.PI * 1500 * t) * env(t, 0.001, 0.02) * 0.2);
    else if (name === 'check-off') buf = make(0.08, t => Math.sin(2 * Math.PI * 1000 * t) * env(t, 0.001, 0.02) * 0.2);
    else if (name === 'failsound') buf = make(1.4, t => Math.sin(2 * Math.PI * (330 - 160 * t) * t) * env(t, 0.01, 0.5) * 0.3);
    else if (name === 'sectionpass' || name === 'applause') buf = make(0.7, t => (Math.sin(2 * Math.PI * 660 * t) * (t < 0.15 ? 1 : 0) + Math.sin(2 * Math.PI * 990 * t) * (t >= 0.15 ? 1 : 0)) * env(t, 0.005, 0.2) * 0.2);
    else if (name === 'sectionfail') buf = make(0.6, t => Math.sin(2 * Math.PI * (400 - 200 * t) * t) * env(t, 0.005, 0.2) * 0.2);
    // Ranked Play (lazer's Multiplayer/Matchmaking/Ranked samples, synthesized)
    else if (name === 'rp-stage') buf = make(0.55, (t, n) => (n() * 0.35 * env(t, 0.09, 0.12) + Math.sin(2 * Math.PI * (180 + 700 * t) * t) * 0.25 * env(t, 0.02, 0.22)) * 0.4);
    else if (name === 'rp-card') buf = make(0.14, (t, n) => (n() * env(t, 0.002, 0.025) * 0.3 + Math.sin(2 * Math.PI * 1500 * t) * env(t, 0.001, 0.02) * 0.12) * 0.7);
    else if (name === 'rp-discard') buf = make(0.3, (t, n) => n() * env(t, 0.01, 0.07) * 0.28 * (1 - t / 0.3));
    else if (name === 'rp-play') buf = make(0.45, (t, n) => (Math.sin(2 * Math.PI * (150 - 90 * t) * t) * env(t, 0.002, 0.12) * 0.6 + n() * env(t, 0.001, 0.03) * 0.2) * 0.6);
    else if (name === 'rp-tick') buf = make(0.06, t => Math.sin(2 * Math.PI * 2100 * t) * env(t, 0.0005, 0.012) * 0.25);
    else if (name === 'rp-vs') buf = make(1.1, (t, n) => (Math.sin(2 * Math.PI * 60 * t) * env(t, 0.003, 0.25) * 0.7 + n() * env(t, 0.002, 0.08) * 0.25 + Math.sin(2 * Math.PI * 1760 * t) * env(t, 0.05, 0.4) * 0.06) * 0.55);
    else if (name === 'rp-impact') buf = make(0.8, (t, n) => (Math.sin(2 * Math.PI * 80 * t) * env(t, 0.002, 0.14) * 0.6 + (Math.sin(2 * Math.PI * 1320 * t) + Math.sin(2 * Math.PI * 1980 * t) * 0.6) * env(t, 0.01, 0.3) * 0.1 + n() * env(t, 0.001, 0.04) * 0.2) * 0.5);
    else if (name === 'rp-score') buf = make(0.5, t => Math.sin(2 * Math.PI * (520 + 380 * t) * t) * env(t, 0.02, 0.18) * 0.16);
    else if (name === 'rp-dmg') buf = make(0.35, (t, n) => (n() * env(t, 0.001, 0.05) * 0.4 + Math.sin(2 * Math.PI * (110 - 40 * t) * t) * env(t, 0.002, 0.1) * 0.5) * 0.55);
    else if (name === 'rp-mult') buf = make(0.28, t => (Math.sin(2 * Math.PI * 1250 * t) + Math.sin(2 * Math.PI * 1875 * t) * 0.5) * env(t, 0.002, 0.08) * 0.2);
    else if (name === 'rp-hit') buf = make(0.7, (t, n) => (Math.sin(2 * Math.PI * (90 - 50 * t) * t) * env(t, 0.002, 0.2) * 0.75 + n() * env(t, 0.001, 0.06) * 0.35) * 0.6);
    else if (name === 'rp-win') buf = make(0.7, t => [660, 880, 1320].reduce((a, f, k) => a + (t > k * 0.08 ? Math.sin(2 * Math.PI * f * t) * env(t - k * 0.08, 0.005, 0.2) : 0), 0) * 0.13);
    else if (name === 'rp-lose') buf = make(0.7, t => Math.sin(2 * Math.PI * (440 - 220 * t) * t) * env(t, 0.01, 0.25) * 0.2);
    else if (name === 'rp-victory') buf = make(1.6, t => [523, 659, 784, 1047].reduce((a, f, k) => a + (t > k * 0.12 ? Math.sin(2 * Math.PI * f * t) * env(t - k * 0.12, 0.01, 0.5) : 0), 0) * 0.1);
    else if (name === 'rp-defeat') buf = make(1.3, t => (Math.sin(2 * Math.PI * (300 - 120 * t) * t) + Math.sin(2 * Math.PI * (200 - 80 * t) * t) * 0.6) * env(t, 0.02, 0.45) * 0.16);
    else if (name === 'rp-enqueue') buf = make(0.3, t => (Math.sin(2 * Math.PI * 880 * t) * (t < 0.1 ? 1 : 0) + Math.sin(2 * Math.PI * 1320 * t) * (t >= 0.1 ? 1 : 0)) * env(t, 0.003, 0.08) * 0.18);
    else if (name === 'rp-found') buf = make(0.9, t => [784, 1047, 1319].reduce((a, f, k) => a + (t > k * 0.11 ? Math.sin(2 * Math.PI * f * t) * env(t - k * 0.11, 0.004, 0.18) : 0), 0) * 0.14);
    else if (/^count[123]s$|^gos$/.test(name)) buf = make(0.15, t => Math.sin(2 * Math.PI * (name === 'gos' ? 1320 : 880) * t) * env(t, 0.002, 0.05) * 0.25);
    this._synthCache.set(name, buf);
    return buf;
  },
};

/** Pitch-preserving time stretch (WSOLA). Used for DT/HT and practice speeds when "preserve pitch" is on. */
const TimeStretch = {
  cache: new Map(), // key -> AudioBuffer (small LRU)
  async stretch(buffer, rate, key, onProgress) {
    const ck = `${key}|${rate}`;
    if (this.cache.has(ck)) { const b = this.cache.get(ck); this.cache.delete(ck); this.cache.set(ck, b); return b; }
    const sr = buffer.sampleRate, chs = buffer.numberOfChannels, len = buffer.length;
    const N = Math.round(sr * 0.046) & ~1, Hs = N >> 1, tol = Math.round(sr * 0.012);
    const inp = []; for (let c = 0; c < chs; c++) inp.push(buffer.getChannelData(c));
    const mono = new Float32Array(len);
    for (let c = 0; c < chs; c++) { const d = inp[c]; for (let i = 0; i < len; i++) mono[i] += d[i] / chs; }
    const outLen = Math.ceil(len / rate) + N;
    const out = []; for (let c = 0; c < chs; c++) out.push(new Float32Array(outLen));
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    let prev = 0, k = 0, lastYield = performance.now();
    const frames = Math.floor((outLen - N) / Hs);
    for (; k < frames; k++) {
      const outPos = k * Hs;
      const nominal = Math.round(outPos * rate);
      if (nominal + N + tol >= len) break;
      let best = nominal;
      if (k > 0) {
        const target = prev + Hs;
        let bestC = -Infinity;
        const lo = Math.max(0, nominal - tol), hi = nominal + tol;
        for (let cand = lo; cand <= hi; cand += 8) {
          let c = 0; for (let i = 0; i < Hs; i += 8) c += mono[target + i] * mono[cand + i];
          if (c > bestC) { bestC = c; best = cand; }
        }
        const b0 = best; bestC = -Infinity;
        for (let cand = Math.max(0, b0 - 7); cand <= b0 + 7; cand++) {
          let c = 0; for (let i = 0; i < Hs; i += 2) c += mono[target + i] * mono[cand + i];
          if (c > bestC) { bestC = c; best = cand; }
        }
      }
      for (let c = 0; c < chs; c++) {
        const s = inp[c], o = out[c];
        for (let i = 0; i < N; i++) o[outPos + i] += s[best + i] * win[i];
      }
      prev = best;
      if (performance.now() - lastYield > 30) {
        onProgress && onProgress(k / frames);
        await new Promise(r => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }
    const res = AudioManager.ctx.createBuffer(chs, outLen, sr);
    for (let c = 0; c < chs; c++) res.copyToChannel ? res.copyToChannel(out[c], 0) : res.getChannelData(c).set(out[c]);
    this.cache.set(ck, res);
    while (this.cache.size > 3) this.cache.delete(this.cache.keys().next().value);
    return res;
  },
};

/** Music track playback with an exact song-position clock (ms). */
const Music = {
  buffer: null, stretched: null, key: null,
  source: null, gain: null,
  rate: 1, preservePitch: false,
  startCtx: 0, startPos: 0, pausedPos: 0,
  playing: false, loop: false, loopStart: 0,
  meta: null,            // {setId, mapId, timing} of the currently loaded track (for UI beat sync)
  onEnded: null,
  // Menus and song select *stream* the track through an <audio> element (starts instantly, no full decode);
  // gameplay loads a decoded buffer for a sample-accurate clock. `el` is set while streaming.
  el: null, elNode: null, elUrl: null,

  /** Something is loaded and can be (re)played. */
  get loaded() { return !!(this.buffer || this.el); },
  async load(buffer, key, meta) {
    AudioManager.init();
    if (this.key !== key || this.el) this.stop(0);
    this._dropStream();
    this.buffer = buffer; this.key = key; this.meta = meta || null;
    this.stretched = null;
  },
  /** Open a track for menus / song select: streamed through an <audio> element on computers; on phones decoded and
   *  played through Web Audio instead — an <audio> element there puts a "Media output" player in the notifications. */
  async open(blob, key, meta) {
    if (!(typeof Mobile !== 'undefined' && Mobile.touch)) { this.stream(blob, key, meta); return; }
    AudioManager.init();
    const [setId, ...rest] = key.split('/');
    const buf = await TrackCache.get(setId, rest.join('/')).catch(() => null) || await AudioManager.decode(await blob.arrayBuffer());
    await this.load(buf, key, meta);
  },
  /** Stream a track (Blob) for menus / previews: playback starts as soon as the first bytes are read. */
  stream(blob, key, meta) {
    AudioManager.init();
    this.stop(0);
    this._dropStream();
    const el = this._audioEl || (this._audioEl = new Audio());
    el.preload = 'auto';
    if (!this.elNode) {
      this.elNode = AudioManager.ctx.createMediaElementSource(el);
      this.elGain = AudioManager.ctx.createGain();
      this.elNode.connect(this.elGain); this.elGain.connect(AudioManager.musicBus);
    }
    this.elUrl = URL.createObjectURL(blob);
    el.src = this.elUrl;
    el.onended = () => { if (this.el === el && this.playing) { this.playing = false; this.pausedPos = this.duration; this.onEnded && this.onEnded(); } };
    this.el = el; this.buffer = null; this.stretched = null; this.key = key; this.meta = meta || null;
    this.rate = 1; this.pausedPos = 0;
  },
  /** Nothing loaded any more (its beatmap set was deleted). */
  unload() { this.stop(0); this._dropStream(); this.buffer = null; this.stretched = null; this.key = null; this.meta = null; this.pausedPos = 0; },
  _dropStream() {
    if (!this.el) return;
    this.el.pause(); this.el.onended = null;
    this.el.removeAttribute('src'); this.el.load();
    if (this.elUrl) URL.revokeObjectURL(this.elUrl);
    this.el = null; this.elUrl = null;
  },
  get duration() {
    if (this.el) return isFinite(this.el.duration) ? this.el.duration * 1000 : 0;
    return this.buffer ? this.buffer.duration * 1000 : 0;
  },

  /** Prepare playback rate. preservePitch -> WSOLA-stretched buffer, otherwise resampling (pitch shifts). */
  async setRate(rate, preservePitch, onProgress) {
    this.rate = rate; this.preservePitch = preservePitch && Math.abs(rate - 1) > 1e-3;
    this.stretched = this.preservePitch ? await TimeStretch.stretch(this.buffer, rate, this.key, onProgress) : null;
  },

  /** Change the playback rate while playing (Wind Up / Wind Down): the song position carries on from where it is,
   *  at the new rate from now on (pitch follows — a buffer played as it is, not a time-stretched one). */
  rampTo(rate) {
    if (Math.abs(rate - this.rate) < 1e-4) return;
    if (!this.playing || !this.source || this.stretched) { if (!this.playing) this.rate = rate; return; }
    const ctx = AudioManager.ctx, t = ctx.currentTime, pos = this.timeAtCtx(t);
    this.source.playbackRate.setValueAtTime(rate, t);
    if (pos < 0) return; // (in the lead-in the start is already scheduled at the old rate; the ramp only begins at the first note anyway)
    this.startCtx = t; this.startPos = pos;
    this.rate = rate;
  },
  /** Current song position in ms (can be negative during lead-in). */
  get time() { return this.timeAt(); },
  /** Song position (ms) heard at a performance.now() time (default: now). */
  timeAt(perfMs) {
    if (!this.playing) return this.pausedPos;
    if (this.el) return this.el.currentTime * 1000;
    return this.startPos + (AudioManager.now(perfMs) - this.startCtx) * 1000 * this.rate;
  },
  /** Bumped whenever the position jumps (play, seek, pause, stop): a smoothed clock following this one starts over. */
  gen: 0,
  /** Song position at a given audio-clock time (seconds). */
  timeAtCtx(ctxT) { return this.playing ? this.startPos + (ctxT - this.startCtx) * 1000 * this.rate : this.pausedPos; },

  /** Start playing at song position `pos` ms (negative = delay). */
  play(pos = 0, { fadeIn = 0, volume = 1, loop = false } = {}) {
    if (this.el) return this._playStream(pos, fadeIn, volume, loop);
    if (!this.buffer) return;
    AudioManager.init();
    this._kill();
    const ctx = AudioManager.ctx;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = this.stretched || this.buffer;
    src.playbackRate.value = this.stretched ? 1 : this.rate;
    src.connect(g); g.connect(AudioManager.musicBus);
    const ctxNow = ctx.currentTime;
    const lead = 0.03; // schedule slightly ahead so the start time is exact
    const when = ctxNow + lead + Math.max(0, -pos / 1000 / this.rate);
    const bufPos = Math.max(0, pos) / 1000 / (this.stretched ? this.rate : 1);
    if (fadeIn > 0) { g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(volume, when + fadeIn / 1000); }
    else g.gain.value = volume;
    if (loop) { src.loop = true; src.loopStart = 0; src.loopEnd = src.buffer.duration; }
    src.start(when, Math.min(bufPos, src.buffer.duration));
    // map: song position `max(pos,0)` is heard at audio time `when`
    this.startCtx = when; this.startPos = Math.max(0, pos);
    if (pos < 0) { this.startPos = pos; this.startCtx = ctxNow + lead; }
    this.source = src; this.gain = g; this.playing = true; this.loop = loop; this.gen++;
    src.onended = () => { if (this.source === src) { this.playing = false; this.pausedPos = this.duration; this.onEnded && this.onEnded(); } };
  },
  _playStream(pos, fadeIn, volume, loop) {
    const el = this.el, g = this.elGain, t = AudioManager.ctx.currentTime;
    const seek = () => { try { el.currentTime = Math.max(0, pos) / 1000; } catch (e) { /* not seekable yet */ } };
    if (el.readyState >= 1) seek(); else el.addEventListener('loadedmetadata', seek, { once: true });
    el.loop = loop;
    g.gain.cancelScheduledValues(t);
    if (fadeIn > 0) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(volume, t + fadeIn / 1000); } else g.gain.setValueAtTime(volume, t);
    this.playing = true; this.loop = loop; this.gain = g; this.source = null;
    el.play().catch(() => { if (this.el === el) this.playing = false; });
  },
  pause() {
    if (!this.playing) return;
    this.pausedPos = this.time; this.gen++;
    if (this.el) { this.el.pause(); this.playing = false; return; }
    this._kill();
    this.playing = false;
  },
  stop(fadeOut = 0) {
    if (this.el) {
      const el = this.el, g = this.elGain;
      this.playing = false;
      if (fadeOut > 0 && g) {
        const t = AudioManager.ctx.currentTime;
        g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + fadeOut / 1000);
        setTimeout(() => { if (this.el === el && !this.playing) el.pause(); }, fadeOut + 20);
      } else el.pause();
      return;
    }
    const src = this.source, g = this.gain;
    this.source = null; this.gain = null; this.playing = false; this.gen++;
    if (!src) return;
    src.onended = null;
    if (fadeOut > 0 && g) {
      const t = AudioManager.ctx.currentTime;
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + fadeOut / 1000);
      try { src.stop(t + fadeOut / 1000 + 0.02); } catch (e) { /* ignore */ }
    } else { try { src.stop(); } catch (e) { /* ignore */ } }
  },
  _kill() { this.stop(0); },
  setVolume(v, ms = 150) {
    if (this.el && this.elGain) this.gain = this.elGain;
    if (!this.gain) return;
    const t = AudioManager.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t); this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(v, t + ms / 1000);
  },
};

/** Loads & caches decoded beatmap audio (small LRU so browsing song select stays fast). */
const TrackCache = {
  map: new Map(),
  async get(setId, audioFile) {
    const key = `${setId}/${audioFile}`.toLowerCase();
    if (this.map.has(key)) { const v = this.map.get(key); this.map.delete(key); this.map.set(key, v); return v; }
    const p = (async () => {
      const blob = await BeatmapManager.getFile(setId, audioFile);
      if (!blob) throw new Error(`Missing audio: ${audioFile}`);
      return AudioManager.decode(await blob.arrayBuffer()).catch(e => {
        throw new Error(`Can't play the song's audio (${audioFile}): ${friendlyError(e)}`);
      });
    })();
    this.map.set(key, p);
    p.catch(() => this.map.delete(key));
    while (this.map.size > 4) this.map.delete(this.map.keys().next().value);
    return p;
  },
};

/** A beatmap's online song preview. On computers an <audio> element; on phones fetched (directly, else through the
 *  game server) and played through Web Audio, so Android doesn't show a "Media output" player in the notifications.
 *  Used like an Audio: volume, play(), pause(), onended. */
function previewPlayer(url) {
  if (!(typeof Mobile !== 'undefined' && Mobile.touch)) return new Audio(url);
  const p = { volume: 1, onended: null, _stopped: false, _src: null,
    async play() {
      AudioManager.init();
      const get = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`preview ${r.status}`); return r.arrayBuffer(); };
      const data = await get(url).catch(() => get('api/downloadBeatmap?destinationUrl=' + encodeURIComponent(url)));
      const buf = await AudioManager.decode(data);
      if (p._stopped) return;
      const ctx = AudioManager.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; g.gain.value = p.volume; src.connect(g); g.connect(ctx.destination);
      src.onended = () => { if (!p._stopped && p.onended) p.onended(); };
      src.start(); p._src = src;
    },
    pause() { p._stopped = true; try { p._src && p._src.stop(); } catch { /* not started */ } },
    removeAttribute() {},
  };
  return p;
}

/** UI sound effects (hover/click/back…) taken from the active skin when present. */
const UISounds = {
  buffers: new Map(),
  reset() { this.buffers.clear(); },
  /** Skins name UI sounds differently across versions; try each alias in the skin before the synthesized default. */
  ALIASES: {
    'click-short': ['click-short', 'menu-freeplay-hover'],
    'click-short-confirm': ['click-short-confirm', 'menuclick', 'menuhit'],
    'menuback': ['menuback', 'back-button-click', 'menu-back-click', 'click-close'],
  },
  async _get(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    const p = (async () => {
      const skin = SkinManager.current;
      if (skin && !skin.builtin) {
        for (const alias of this.ALIASES[name] || [name]) {
          if (skin.has(alias)) { const b = await skin.sound(alias).catch(() => null); if (b) return b; }
        }
      }
      return SkinManager.sample(name).catch(() => null);
    })();
    this.buffers.set(name, p);
    return p;
  },
  async play(name, vol = 1, rate = 1) {
    if (!Settings.get('audio.uiSounds') || !AudioManager.ctx || AudioManager.ctx.state !== 'running') return;
    const b = await this._get(name);
    if (b) AudioManager.play(b, { bus: 'ui', volume: vol, rate });
  },
  // (lazer's HoverSounds: each one pitched a little differently, 98–102%, so a row of them doesn't sound mechanical)
  hover() { const now = performance.now(); if (now - (this._lh || 0) < 40) return; this._lh = now; this.play('click-short', 0.6, 0.98 + Math.random() * 0.04); },
  click() { this.play('click-short-confirm'); },
  back() { this.play('menuback'); },
  /** Song select: a beatmap set opening ('expand'), another difficulty ('difficulty') or a random pick ('random'). */
  /** lazer's HoverClickSounds on everything clickable: a hover sound as the pointer comes onto a button, tab, menu item
   *  or list entry (not for touch, and not in a song). */
  initHover() {
    const SEL = '.btn, .pm-btn, .menu button, .ov-tab, .sp-nb, .side-item, .mod-p, .lz-back, .sh-btn, .res-ab, .ss-foot button, .icon-btn, .pf-score, .setup-choice, .sk-step';
    document.addEventListener('pointerover', e => {
      if (e.pointerType === 'touch') return;
      const b = e.target.closest && e.target.closest(SEL);
      if (!b || b.disabled || b.contains(e.relatedTarget) || document.getElementById('app').classList.contains('in-game')) return;
      this.hover();
    }, { passive: true });
  },
  select(kind) { const now = performance.now(); if (now - (this._ls || 0) < 45) return; this._ls = now; this.play('select-' + kind); }, // (an arrow key held down doesn't pile them up)
};
