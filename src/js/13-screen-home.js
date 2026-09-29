/* Main menu (osu!lazer style): the logo sits in the middle of the screen; clicking it (or pressing
 * any key) opens a slanted button bar — Play → Solo / Multiplayer / Practice. Music keeps playing
 * in the background and can be controlled from the toolbar's now-playing panel. */

const HomeScreen = {
  tab: 'home',
  menuState: 'initial',
  enter() {
    this.logo = this.buildLogo();
    this.leftBtns = h('div.lz-buttons.lz-left');
    this.rightBtns = h('div.lz-buttons.lz-right');
    this.bar = h('div.lz-bar', h('div.lz-logo-slot', this.logo), this.leftBtns, this.rightBtns);
    const el = h('div.home.lz-menu', { dataset: { state: 'initial' } }, h('div.lz-stage', this.bar));
    this.el = el;
    this.setState(Screens.history.length ? 'top' : 'initial', true);
    this.startMenuMusic();
    this.loop();
    return el;
  },
  leave() { cancelAnimationFrame(this._raf); },

  /** Button definitions (colours are osu!lazer's main-menu colours). */
  menuButtons(state) {
    if (state === 'play') return {
      left: [['Back', 'back', '#555555', () => this.setState('top'), 'Esc']],
      right: [
        ['Solo', 'user', '#6644cc', () => Screens.go('songselect', {}, { transition: 'zoom' }), 'S'],
        ['Multi', 'multi', '#5e3fba', () => Screens.go('multiplayer'), 'M'],
        ['Practice', 'flag', '#5e3fba', () => Screens.go('songselect', { practice: true }, { transition: 'zoom' }), 'P'],
      ],
    };
    return {
      left: [],
      right: [
        ['Settings', 'gear', '#555555', () => SettingsPanel.open(), 'O'],
        ['Play', 'play', '#6644cc', () => this.setState('play'), 'P'],
        ['Browse', 'download', '#a5cc00', () => Screens.go('explore'), 'B'],
        ['Profile', 'user', '#ee3399', () => Screens.go('profile'), 'U'],
      ],
    };
  },
  setState(state, instant = false) {
    this.menuState = state;
    this.el.dataset.state = state;
    this.el.classList.toggle('lz-instant', instant);
    const mk = ([label, ic, color, fn, key]) => {
      const b = h('button.lz-btn', { style: { '--c': color }, 'aria-label': label, title: key ? `${label} (${key})` : label, onclick: () => { UISounds.click(); fn(); } },
        h('span.lz-inner', icon(ic), h('span.lz-label', label)));
      b.addEventListener('pointerenter', () => UISounds.hover());
      return b;
    };
    const d = this.menuButtons(state);
    clearEl(this.leftBtns).append(...d.left.map(mk));
    clearEl(this.rightBtns).append(...d.right.map(mk));
  },
  onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (this.menuState === 'initial' && !['Escape', 'Tab', 'Shift'].includes(e.key)) { UISounds.click(); this.setState('top'); return true; }
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
    if (this.menuState === 'play') { UISounds.back(); this.setState('top'); return true; }
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
        if (key !== lastBeat && t >= tp.time) { lastBeat = key; pulseT = now; }
      }
      const k = clamp((now - pulseT) / 260, 0, 1);
      this.cookie.style.transform = `scale(${1 + 0.035 * (1 - k) * (1 - k)})`;
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

/** Where menu music / song-select previews start: the beatmap's PreviewTime, or 40% in (as osu! does) when
 *  the map doesn't set one. */
function previewStart(map) { return map.previewTime > 0 ? map.previewTime : Math.round((map.length || 0) * 0.4); }
/** Red-line timing for the menu beat pulse (parsed after playback has started). */
async function beatTiming(map) {
  const parsed = await BeatmapManager.load(map.id).catch(() => null);
  return parsed ? BeatmapParser.timing(parsed.bm).red.map(r => ({ time: r.time, beatLength: r.beatLength })) : null;
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
  async next() {
    const sets = BeatmapManager.sets.filter(s => s.maps.some(m => !m.problems.length));
    if (!sets.length) return;
    if (this.current) this.history.push(this.current.id);
    const pool = sets.length > 1 && this.current ? sets.filter(s => s.id !== this.current.setId) : sets;
    const set = pool[Math.floor(Math.random() * pool.length)];
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
