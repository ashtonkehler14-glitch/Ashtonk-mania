/* Main menu (osu!lazer's ButtonSystem): the logo sits in the middle of the screen; clicking it (or pressing any key)
 * opens the slanted button bar — Settings to the left of the logo; Play (→ Solo / Multi), Edit (→ skins, importing
 * and the library) and Browse to its right. Fifteen idle seconds bring the big logo back. Behind it all is lazer's
 * triangle artwork, in the colour of the playing song's background. */

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
          if (kiai && Settings.get('ui.animSpeed')) this.cookie.animate([{ filter: 'brightness(1.12)' }, { filter: 'brightness(1)' }], { duration: tp.beatLength, easing: 'cubic-bezier(.25, .6, .3, 1)' });
        }
      } else if (now - pulseT > 600) { pulseT = now; this._kiai = false; this.onBeat(600); } // no beat to follow: sway at a steady pace
      // idle for a while: back to the big logo, as when the game opens
      if (this.menuState !== 'initial' && now - this._idleAt > this.IDLE_MS && !Overlays.stack.length && !SettingsPanel.o && !(NowPlaying.open)) this.setState('initial');
      const k = clamp((now - pulseT) / 260, 0, 1);
      this.cookie.style.transform = `scale(${1 + (this._kiai ? 0.045 : 0.035) * (1 - k) * (1 - k)})`;
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
