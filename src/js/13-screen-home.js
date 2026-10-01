/* Main menu (osu!lazer's ButtonSystem): the logo sits in the middle of the screen; clicking it (or pressing any key)
 * opens the slanted button bar — Settings to the left of the logo; Play (→ Solo / Multi), Edit (→ skins, importing
 * and the library) and Browse to its right. Fifteen idle seconds bring the big logo back. Behind it all, lazer's
 * triangles drift upwards in the colour of the playing song's background. */

const HomeScreen = {
  tab: 'home',
  menuState: 'initial',
  IDLE_MS: 15000,
  enter() {
    this.logo = this.buildLogo();
    this.leftBtns = h('div.lz-buttons.lz-left');
    this.rightBtns = h('div.lz-buttons.lz-right');
    this.bar = h('div.lz-bar', h('div.lz-logo-slot', this.logo), this.leftBtns, this.rightBtns);
    this.flashL = h('div.msf.l'); this.flashR = h('div.msf.r');
    const el = h('div.home.lz-menu', { dataset: { state: 'initial' } }, MenuTriangles.mount(), this.flashL, this.flashR, h('div.lz-stage', this.bar), NeruMascot.build());
    this.el = el;
    this.setState(Screens.history.length ? 'top' : 'initial', true);
    this.startMenuMusic();
    this._idleAt = performance.now();
    this._poke = () => { this._idleAt = performance.now(); };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, this._poke, { passive: true });
    this.loop();
    return el;
  },
  leave() {
    cancelAnimationFrame(this._raf); NeruMascot.stop(); MenuTriangles.stop();
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.removeEventListener(ev, this._poke);
  },

  /** Button definitions (colours are osu!lazer's main-menu colours). */
  menuButtons(state) {
    const back = ['Back', 'back', '#555555', () => this.setState('top'), 'Esc'];
    if (state === 'play') return {
      left: [back],
      right: [
        ['Solo', 'user', '#6644cc', () => Screens.go('songselect', {}, { transition: 'zoom' }), 'S'],
        ['Multi', 'multi', '#5e3fba', () => Screens.go('multiplayer'), 'M'],
      ],
    };
    // where lazer has Edit (beatmap / skin editor): everything for changing what's installed
    if (state === 'edit') return {
      left: [back],
      right: [
        ['Skins', 'brush', '#eeaa00', () => Screens.go('skins'), 'S'],
        ['Import', 'upload', '#dca000', () => importViaPicker('.osz,.osk,.zip,.osu,.osr'), 'I'],
        ['Beatmaps', 'music', '#eeaa00', () => Screens.go('beatmaps'), 'B'],
        ['Collections', 'folder', '#dca000', () => Screens.go('collections'), 'C'],
        ['Replays', 'film', '#eeaa00', () => Screens.go('replays'), 'R'],
      ],
    };
    return {
      left: [['Settings', 'gear', '#555555', () => SettingsPanel.open(), 'O']],
      right: [
        ['Play', 'play', '#6644cc', () => this.setState('play'), 'P'],
        ['Edit', 'edit', '#eeaa00', () => this.setState('edit'), 'E'],
        ['Browse', 'download', '#a5cc00', () => Screens.go('explore'), 'B'],
      ],
    };
  },
  setState(state, instant = false) {
    this.menuState = state;
    this.el.dataset.state = state;
    this.el.classList.toggle('lz-instant', instant);
    const mk = ([label, ic, color, fn, key]) => {
      const b = h('button.lz-btn', { style: { '--c': color }, 'aria-label': label, title: key ? `${label} (${key})` : label, onclick: () => { UISounds.click(); fn(); } },
        h('span.lz-inner', h('span.lz-ico', icon(ic)), h('span.lz-label', label)));
      b.addEventListener('pointerenter', () => UISounds.hover());
      return b;
    };
    const d = this.menuButtons(state);
    clearEl(this.leftBtns).append(...d.left.map(mk));
    clearEl(this.rightBtns).append(...d.right.map(mk));
  },
  /** lazer's MainMenuButton: the hovered button's icon sways from side to side and bounces with the beat. */
  onBeat(len) {
    this._beatN = (this._beatN || 0) ^ 1;
    const b = this.el && this.el.querySelector('.lz-btn:hover');
    if (!b) return;
    const ico = b.querySelector('.lz-ico');
    ico.style.setProperty('--bt', `${Math.round(clamp(len, 250, 900))}ms`);
    ico.classList.toggle('bl', !this._beatN); ico.classList.toggle('br', !!this._beatN);
    ico.classList.remove('bounce'); void ico.offsetWidth; ico.classList.add('bounce');
  },
  /** lazer's MenuSideFlashes: the screen's edges light up with the music — both on each bar's first beat, or
   *  left and right in turn on every beat during kiai — as bright as the track is loud, fading over a beat. */
  sideFlash(beat, tp, kiai, amp) {
    if (!this.flashL || !Settings.get('ui.animSpeed')) return;
    const meter = tp.meter || 4;
    const alpha = clamp((amp - 0.25) / (kiai ? 0.94 : 1.36), 0, 1);
    if (alpha < 0.03) return;
    const dur = 80 + tp.beatLength;
    const flash = el => el.animate([{ opacity: 0, easing: 'linear' }, { opacity: alpha, offset: 80 / dur, easing: 'ease-in' }, { opacity: 0 }], { duration: dur });
    if (kiai ? beat % 2 === 0 : beat % meter === 0) flash(this.flashL);
    if (kiai ? beat % 2 === 1 : beat % meter === 0) flash(this.flashR);
  },
  onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (this.menuState === 'initial' && !['Escape', 'Tab', 'Shift'].includes(e.key)) { UISounds.click(); this.setState('top'); return true; }
    if (e.code === 'KeyU') { UISounds.click(); Screens.go('profile'); return true; } // (listed under ? as a main menu key)
    const d = this.menuButtons(this.menuState);
    const hit = [...d.left, ...d.right].find(b => b[4] && b[4].length === 1 && e.code === 'Key' + b[4]);
    if (hit) { UISounds.click(); hit[3](); return true; }
    if (e.key === 'Enter') {
      if (document.activeElement && document.activeElement.classList.contains('lz-btn')) document.activeElement.click();
      else { UISounds.click(); if (this.menuState === 'top') this.setState('play'); else Screens.go('songselect', {}, { transition: 'zoom' }); }
      return true;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const btns = $$('.lz-btn', this.el), i = btns.indexOf(document.activeElement);
      const n = btns[clamp(i + (e.key === 'ArrowRight' ? 1 : -1), 0, btns.length - 1)];
      if (n) { n.focus(); UISounds.hover(); }
      return true;
    }
    return false;
  },
  onBack() {
    if (this.menuState === 'play' || this.menuState === 'edit') { UISounds.back(); this.setState('top'); return true; }
    if (this.menuState === 'top') { UISounds.back(); this.setState('initial'); return true; }
    return true;
  },

  buildLogo() {
    this.vis = h('canvas.lz-vis');
    this.cookie = h('button.lz-cookie', { 'aria-label': 'Play', title: 'Play',
      onclick: () => {
        UISounds.click();
        if (this.menuState === 'initial') this.setState('top');
        else if (this.menuState === 'top') this.setState('play');
        else Screens.go('songselect', {}, { transition: 'zoom' });
      } },
      h('span.lz-cookie-disc', h('span.lz-cookie-text', 'ashtonk!', h('small', 'mania'))));
    this.cookie.addEventListener('pointerenter', () => UISounds.hover());
    return h('div.lz-logo', this.vis, this.cookie);
  },
  /** Logo visualiser (radial FFT bars) + beat pulse from the playing track's timing points. */
  loop() {
    const amps = new Float32Array(64);
    let lastBeat = -1, pulseT = 0;
    const tick = now => {
      this._raf = requestAnimationFrame(tick);
      const cv = this.vis;
      if (!cv.isConnected) return;
      const r = cv.getBoundingClientRect();
      const dpr = devicePixelRatio || 1;
      const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const x = cv.getContext('2d');
      x.clearRect(0, 0, W, H);
      const an = AudioManager.analyser;
      if (an && Music.playing) {
        const d = this._fft || (this._fft = new Uint8Array(an.frequencyBinCount));
        an.getByteFrequencyData(d);
        for (let i = 0; i < amps.length; i++) amps[i] = Math.max(amps[i] * 0.86, d[i + 2] / 255);
      } else for (let i = 0; i < amps.length; i++) amps[i] *= 0.9;
      const cx = W / 2, cy = H / 2, inner = W * 0.285, maxLen = W * 0.21;
      const rot = now / 9000;
      x.fillStyle = 'rgba(255,255,255,0.2)';
      const bars = 200, bw = Math.max(1.5, inner * Math.PI * 2 / bars * 0.55);
      for (let i = 0; i < bars; i++) {
        const a = rot + i / bars * Math.PI * 2;
        const v = amps[(i * 7) % amps.length];
        const len = v * v * maxLen;
        if (len < 1) continue;
        x.save(); x.translate(cx, cy); x.rotate(a); x.fillRect(inner, -bw / 2, len, bw); x.restore();
      }
      // beat pulse
      const tm = Music.meta && Music.meta.timing;
      if (tm && Music.playing) {
        const t = Music.time, i = Math.max(0, bsearchLE(tm, t, 'time')), tp = tm[i];
        const beat = Math.floor((t - tp.time) / tp.beatLength), key = i * 100000 + beat;
        if (key !== lastBeat && t >= tp.time) {
          lastBeat = key; pulseT = now; this.onBeat(tp.beatLength);
          const kp = tm.kiai && tm.kiai.length ? tm.kiai[Math.max(0, bsearchLE(tm.kiai, t, 'time'))] : null;
          let amp = 0; for (let j = 0; j < 8; j++) amp = Math.max(amp, amps[j]);
          const kiai = !!(kp && kp.on && t >= kp.time);
          this.sideFlash(beat, tp, kiai, amp);
          // (lazer's logo pulses harder and flashes on each beat during kiai)
          this._kiai = kiai;
          if (kiai && Settings.get('ui.animSpeed')) this.cookie.animate([{ filter: 'brightness(1.3)' }, { filter: 'brightness(1)' }], { duration: tp.beatLength, easing: 'ease-in' });
        }
      } else if (now - pulseT > 600) { pulseT = now; this._kiai = false; this.onBeat(600); } // no beat to follow: sway at a steady pace
      // idle for a while: back to the big logo, as when the game opens
      if (this.menuState !== 'initial' && now - this._idleAt > this.IDLE_MS && !Overlays.stack.length && !SettingsPanel.o && !(NowPlaying.open)) this.setState('initial');
      const k = clamp((now - pulseT) / 260, 0, 1);
      this.cookie.style.transform = `scale(${1 + (this._kiai ? 0.055 : 0.035) * (1 - k) * (1 - k)})`;
    };
    this._raf = requestAnimationFrame(tick);
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

/** osu!lazer's triangles behind the main menu: triangles in shades of one colour drift upwards, and the colour
 *  follows the playing song's background (its average colour, saturated a little), fading over a second when the
 *  song changes. Drawn at half resolution, 30 times a second, and only while the menu is on screen. */
const MenuTriangles = {
  tris: [], col: [250, 0.45, 0.36], target: [250, 0.45, 0.36], running: false,
  mount() {
    this.cv = h('canvas.lz-tri', { 'aria-hidden': 'true' });
    this.running = true; this._last = 0;
    if (!this._sub) this._sub = Bus.on('bg:changed', url => this.fromImage(url));
    this.fromImage(Background.current);
    const tick = now => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(tick);
      if (now - this._last < 33 || document.hidden) return;
      const dt = Math.min(100, now - (this._last || now)); this._last = now;
      this.draw(dt);
    };
    this._raf = requestAnimationFrame(tick);
    return this.cv;
  },
  stop() { this.running = false; cancelAnimationFrame(this._raf); },
  /** Average colour of the background image → the triangles' hue and saturation. */
  async fromImage(url) {
    if (!url) { this.target = [250, 0.45, 0.36]; return; }
    try {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = 12;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, 12, 12);
      const d = x.getImageData(0, 0, 12, 12).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const w = 0.2 + Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w; }
      const [hh, ss] = rgbToHsl(r / n, g / n, b / n);
      if (Background.current === url) this.target = [hh, clamp(ss * 1.25 + 0.1, 0.18, 0.75), 0.36];
    } catch (e) { /* unreadable image: keep the colour */ }
  },
  draw(dt) {
    const cv = this.cv;
    if (!cv || !cv.isConnected) return;
    const W = Math.max(1, Math.round(cv.clientWidth / 2)), H = Math.max(1, Math.round(cv.clientHeight / 2));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; this.tris = []; this._seeded = false; }
    // ease the colour towards the song's (hue the short way round the wheel)
    const k = Math.min(1, dt / 900), c = this.col, t = this.target;
    let dh = ((t[0] - c[0] + 540) % 360) - 180;
    c[0] = (c[0] + dh * k + 360) % 360; c[1] += (t[1] - c[1]) * k; c[2] += (t[2] - c[2]) * k;
    const want = Settings.get('graphics.performanceMode') ? 26 : 60;
    while (this.tris.length < want) this.tris.push(this.spawn(W, H, !this._seeded)); // (the first fill covers the screen)
    this._seeded = true;
    const x = cv.getContext('2d');
    x.fillStyle = `hsl(${c[0].toFixed(1)} ${(c[1] * 100 * 0.7).toFixed(1)}% ${(c[2] * 100 * 0.42).toFixed(1)}%)`;
    x.fillRect(0, 0, W, H);
    for (const tr of this.tris) {
      tr.y -= tr.v * dt;
      const s = tr.s;
      if (tr.y + s < 0) Object.assign(tr, this.spawn(W, H, false));
      x.fillStyle = `hsl(${c[0].toFixed(1)} ${(c[1] * 100).toFixed(1)}% ${(c[2] * 100 * tr.l).toFixed(1)}% / ${tr.a})`;
      x.beginPath(); x.moveTo(tr.x, tr.y); x.lineTo(tr.x + s * 0.577, tr.y + s); x.lineTo(tr.x - s * 0.577, tr.y + s); x.closePath(); x.fill();
    }
  },
  spawn(W, H, anywhere) {
    const s = (18 + Math.random() ** 2 * 110) * Math.max(0.6, H / 540);
    return { x: Math.random() * W, y: anywhere ? Math.random() * H : H + Math.random() * 40, s, v: (0.004 + 0.016 * (1 - s / 160)) * Math.max(0.6, H / 540), l: 0.55 + Math.random() * 0.9, a: (0.35 + Math.random() * 0.5).toFixed(2) };
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
  /** Next track: a shuffled run through every set, so a small library plays each song once before any repeats
   *  (picking at random kept landing on the same one or two). */
  async next() {
    const sets = BeatmapManager.sets.filter(s => s.maps.some(m => !m.problems.length));
    if (!sets.length) return;
    if (this.current) this.history.push(this.current.id);
    const have = new Set(sets.map(s => s.id));
    this.queue = (this.queue || []).filter(id => have.has(id) && (!this.current || id !== this.current.setId));
    if (!this.queue.length) {
      const ids = sets.map(s => s.id).filter(id => sets.length < 2 || !this.current || id !== this.current.setId);
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      this.queue = ids;
    }
    const set = BeatmapManager.setById.get(this.queue.shift());
    this.go(set.maps.find(m => !m.problems.length), false);
  },
  async prev() {
    if (Music.playing && Music.time > 4000) { Music.play(0, { fadeIn: 150 }); return; }
    const id = this.history.pop();
    const map = id && BeatmapManager.maps.get(id);
    if (!map) { if (Music.loaded) Music.play(0, { fadeIn: 150 }); return; }
    this.go(map, false);
  },
};
