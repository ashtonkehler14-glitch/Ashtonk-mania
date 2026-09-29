/* Home screen — client-style main menu with live logo, quick actions and recent activity. */

const GREETINGS = ['Ready to play?', 'Welcome back.', "Let's rhythm.", 'Keys warmed up?', 'One more map.', 'Chase that SS.', 'Stay on beat.', 'Long notes, long vibes.'];
const NERU_GREETINGS = ['Neru approves of your combo. ✦', 'Somewhere, a yellow phone buzzes. ✦', 'Neru says: less texting, more tapping. ✦'];
const LOADING_NERU = ['Neru is checking her messages…', 'Polishing the yellow bits…', 'Neru pressed "load". Probably.'];

const HomeScreen = {
  tab: 'home',
  listTab: 'recent',
  enter() {
    const greetEl = h('div.greet');
    const cookie = this.buildCookie();
    const tile = (cls, title, sub, ic, onClick, key) => {
      const b = h(`button.home-tile${cls ? '.' + cls : ''}`, { onclick: () => { UISounds.click(); onClick(); } },
        h('span.ht-ico', icon(ic)), h('span.ht-t', title), h('span.ht-s', sub, key ? [' · ', h('span.kbd', key)] : null));
      b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); b.style.setProperty('--mx', `${e.clientX - r.left}px`); b.style.setProperty('--my', `${e.clientY - r.top}px`); });
      b.addEventListener('pointerenter', () => UISounds.hover());
      return b;
    };
    const nMaps = BeatmapManager.playableMaps().length;
    const logo = h('div.logo', h('span.l1', 'Ashtonk'), this.bang = h('span.bang', '!'), h('span.l2', 'mania'));
    this.bang.addEventListener('click', () => this.bangClick());
    const left = h('div.home-left',
      h('div.home-hero', cookie, h('div.home-title', logo, greetEl)),
      h('div.home-actions',
        tile('play', 'Play', nMaps ? `${nMaps} difficult${nMaps === 1 ? 'y' : 'ies'} ready` : 'Import a beatmap to start', 'play', () => Screens.go('songselect', {}, { transition: 'zoom' }), 'P'),
        tile('', 'Beatmaps', 'Import & manage', 'music', () => Screens.go('beatmaps'), 'B'),
        tile('', 'Collections', `${Collections.list.length} collection${Collections.list.length === 1 ? '' : 's'}`, 'folder', () => Screens.go('collections'), 'C'),
        tile('', 'Profile', ProfileManager.profile.name, 'user', () => Screens.go('profile'), 'U'),
        tile('', 'Statistics', `${ScoreManager.scores.length} plays`, 'chart', () => Screens.go('stats'), 'T'),
        tile('', 'Skins', SkinManager.current.name, 'brush', () => Screens.go('skins'), 'K'),
        tile('', 'Replays', `${ReplayManager.list.length} saved`, 'film', () => Screens.go('replays'), 'R'),
        tile('', 'Settings', 'Gameplay, audio, keys', 'gear', () => SettingsPanel.open(), 'O'),
      ));
    const right = h('div.home-right', this.buildContinue(), this.buildLists());
    const el = h('div.home', h('div.home-grid', left, right));
    this.greetEl = greetEl;
    this.rotateGreeting(true);
    this._gt = setInterval(() => this.rotateGreeting(), 9000);
    this._unsub = [Bus.on('scores:changed', () => this.refreshLists()), Bus.on('favorites:changed', () => this.refreshLists())];
    this.startMenuMusic();
    this.loop();
    // rare UI animation: a golden spark drifts over the logo (~1 in 25 visits)
    if (Math.random() < 0.04) setTimeout(() => neruSparkBurst(logo, 5), 1200);
    return el;
  },
  leave() {
    clearInterval(this._gt); cancelAnimationFrame(this._raf);
    (this._unsub || []).forEach(f => f());
  },
  onKey(e) {
    const k = e.code;
    const map = { KeyP: () => Screens.go('songselect', {}, { transition: 'zoom' }), Enter: () => Screens.go('songselect', {}, { transition: 'zoom' }), KeyB: () => Screens.go('beatmaps'),
      KeyC: () => Screens.go('collections'), KeyU: () => Screens.go('profile'), KeyT: () => Screens.go('stats'), KeyK: () => Screens.go('skins'), KeyR: () => Screens.go('replays') };
    if (map[k] && !e.ctrlKey && !e.metaKey && !e.altKey) { UISounds.click(); map[k](); return true; }
    return false;
  },
  onBack() { return true; },
  rotateGreeting(first = false) {
    if (!this.greetEl) return;
    if (!Settings.get('ui.homeMessages')) { this.greetEl.textContent = ''; return; }
    const rare = Math.random() < 0.06;
    const pool = rare ? NERU_GREETINGS : GREETINGS;
    let msg = pool[Math.floor(Math.random() * pool.length)];
    if (first) {
      const hr = new Date().getHours();
      msg = ScoreManager.scores.length ? (hr < 5 ? 'Late-night session?' : 'Welcome back, ' + ProfileManager.profile.name + '.') : 'Welcome to Ashtonk!mania.';
    }
    this.greetEl.style.opacity = 0;
    setTimeout(() => { this.greetEl.textContent = msg; this.greetEl.classList.toggle('neru', rare && !first); this.greetEl.style.opacity = 1; }, first ? 0 : 250);
  },
  bangClicks: 0,
  bangClick() {
    this.bangClicks++;
    this.bang.style.transform = `rotate(${this.bangClicks * 25}deg)`;
    if (this.bangClicks === 7) {
      this.bangClicks = 0;
      neruSparkBurst(this.bang, 14);
      UISounds.play('neru-chime');
      Toast.show('✦ You found a yellow secret', 'Try typing "neru" anywhere outside gameplay.', { type: 'neru' });
    }
  },
  buildCookie() {
    const bars = h('div.bars', h('i'), h('i'), h('i'), h('i'));
    this.pulse = h('div.pulse');
    this.bars = $$('i', bars);
    const c = h('button.cookie', { title: 'Play', 'aria-label': 'Play', onclick: () => { UISounds.click(); Screens.go('songselect', {}, { transition: 'zoom' }); } },
      h('div.ring'), h('div.face', bars), this.pulse);
    c.addEventListener('pointerenter', () => UISounds.hover());
    return c;
  },
  lastBeat: -1,
  loop() {
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      const an = AudioManager.analyser;
      if (an && Music.playing) {
        const d = this._fft || (this._fft = new Uint8Array(an.frequencyBinCount));
        an.getByteFrequencyData(d);
        const bands = [[1, 4], [4, 10], [10, 24], [24, 60]];
        bands.forEach(([a, b], i) => {
          let s = 0; for (let k = a; k < b; k++) s += d[k]; s /= (b - a) * 255;
          this.bars[i].style.transform = `scaleY(${0.25 + s * 0.95})`;
        });
      } else this.bars.forEach((b, i) => b.style.transform = `scaleY(${0.35 + 0.1 * Math.sin(performance.now() / 500 + i)})`);
      // beat pulse from the track's timing points
      const tm = Music.meta && Music.meta.timing;
      if (tm && Music.playing) {
        const t = Music.time;
        const i = Math.max(0, bsearchLE(tm, t, 'time'));
        const tp = tm[i];
        const beat = Math.floor((t - tp.time) / tp.beatLength);
        const key = i * 100000 + beat;
        if (key !== this.lastBeat && t >= tp.time) {
          this.lastBeat = key;
          this.pulse.classList.remove('go'); void this.pulse.offsetWidth; this.pulse.classList.add('go');
        }
      }
    };
    tick();
  },
  async startMenuMusic() {
    const id = Settings.get('last.map');
    let map = id && BeatmapManager.maps.get(id);
    if (!map || map.problems.length) { const all = BeatmapManager.playableMaps(); map = all[Math.floor(Math.random() * all.length)]; }
    if (!map) { Background.set(null); return; }
    const url = await BeatmapManager.bgURL(map) || await BeatmapManager.thumbURL(BeatmapManager.setById.get(map.setId));
    Background.set(url);
    if (Music.playing && Music.meta && Music.meta.setId === map.setId) return;
    await MenuMusic.play(map);
  },
  buildContinue() {
    const id = Settings.get('last.map');
    const map = id && BeatmapManager.maps.get(id);
    const card = h('div.panel.glass.home-card', h('h3', icon('play'), 'Continue playing', h('span.grow'), this.npControls()));
    if (!map) {
      card.append(h('div.empty', { style: { padding: '26px 10px' } }, h('div.big', 'Nothing played yet'), 'Drag an .osz onto the window, or open ', h('button.btn.sm', { onclick: () => Screens.go('beatmaps') }, 'Beatmaps')));
      return card;
    }
    const bg = h('div.cv-bg');
    BeatmapManager.bgURL(map).then(u => { if (u) bg.style.backgroundImage = `url("${u}")`; });
    const best = ScoreManager.best(map.hash);
    card.append(h('button.continue', { onclick: () => { UISounds.click(); Screens.go('songselect', { mapId: map.id }, { transition: 'zoom' }); } },
      bg, h('div.cv-body', h('div.cv-title', map.title), h('div.cv-sub', `${map.artist} · [${map.version}] · ${map.keys}K`),
        h('div.row', starBadge(map.stars), best ? h('span.muted', `Best ${fmtAcc(best.accuracy)}`) : h('span.muted', 'Not played yet'))),
      h('span.cv-play', icon('play'))));
    return card;
  },
  npControls() {
    return h('span.row', { style: { gap: '2px' } },
      h('button.icon-btn', { title: 'Quick play — a random beatmap', 'aria-label': 'Quick play', onclick: () => this.quickPlay() }, icon('shuffle')),
      h('button.icon-btn', { title: 'Previous track', 'aria-label': 'Previous track', onclick: () => MenuMusic.prev() }, icon('back')),
      h('button.icon-btn', { title: 'Pause / resume music', 'aria-label': 'Pause music', onclick: () => MenuMusic.toggle() }, icon('pause')),
      h('button.icon-btn', { title: 'Next track', 'aria-label': 'Next track', onclick: () => MenuMusic.next() }, icon('chevron')));
  },
  quickPlay() {
    const maps = BeatmapManager.playableMaps();
    if (!maps.length) { Toast.show('No playable beatmaps yet', 'Import an .osz to get started.'); return; }
    const m = maps[Math.floor(Math.random() * maps.length)];
    UISounds.click();
    Settings.set('last.map', m.id);
    Game.launch({ mapId: m.id, mods: Settings.get('songselect.mods') || [], mode: 'play' });
  },
  buildLists() {
    const card = h('div.panel.glass.home-card', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' } });
    this.listCard = card;
    this.refreshLists();
    return card;
  },
  refreshLists() {
    const card = this.listCard;
    if (!card) return;
    clearEl(card);
    const tabs = [['recent', 'Recent scores'], ['favorites', 'Favorites'], ['added', 'Recently added'], ['played', 'Recently played']];
    card.append(h('div.home-tabs', ...tabs.map(([id, l]) => h(`button.chip${this.listTab === id ? '.on' : ''}`, { onclick: () => { this.listTab = id; UISounds.click(); this.refreshLists(); } }, l))));
    const list = h('div.mini-list', { style: { overflow: 'auto', flex: '1', minHeight: '0' } });
    card.append(list);
    let items = [];
    if (this.listTab === 'recent') {
      items = ScoreManager.recent(12).map(s => ({ map: BeatmapManager.mapByHash(s.mapHash), s }));
    } else if (this.listTab === 'favorites') {
      items = BeatmapManager.sets.filter(s => Favorites.has(s.id)).map(set => ({ map: set.maps[set.maps.length - 1], set }));
    } else if (this.listTab === 'added') {
      items = [...BeatmapManager.sets].sort((a, b) => b.added - a.added).slice(0, 12).map(set => ({ map: set.maps[set.maps.length - 1], set }));
    } else {
      const seen = new Set();
      for (const s of ScoreManager.recent(80)) { if (seen.has(s.mapHash)) continue; seen.add(s.mapHash); const m = BeatmapManager.mapByHash(s.mapHash); if (m) items.push({ map: m, s: ScoreManager.best(s.mapHash) || s, last: s.date }); if (items.length >= 12) break; }
    }
    items = items.filter(i => i.map || i.s);
    if (!items.length) {
      list.append(h('div.empty', { style: { padding: '30px 10px' } }, {
        recent: 'No scores yet — go set some!', favorites: 'Favorite a beatmap with ♥ in song select.', added: 'No beatmaps imported yet.', played: 'Nothing played yet.',
      }[this.listTab]));
      return;
    }
    for (const it of items) {
      const m = it.map, s = it.s;
      const thumb = h('div.mini-thumb');
      if (m) BeatmapManager.thumbURL(BeatmapManager.setById.get(m.setId)).then(u => { if (u) thumb.style.backgroundImage = `url("${u}")`; });
      const title = m ? m.title : s.title, sub = m ? `${m.artist} · [${m.version}]` : `${s.artist} · [${s.version}]`;
      const side = s ? h('div.mini-side', gradeEl(s.grade), h('div', fmtAcc(s.accuracy)), h('div.muted', fmtDate(it.last || s.date)))
        : h('div.mini-side', starBadge(m.stars), h('div.muted', `${m.keys}K`));
      const b = h('button.mini-item', { onclick: () => { if (m) { UISounds.click(); Screens.go('songselect', { mapId: m.id }, { transition: 'zoom' }); } } },
        thumb, h('div.mini-main', h('div.t', title), h('div.s', sub, s && s.mods && s.mods.length ? ' · +' + s.mods.join('') : '')), side);
      b.addEventListener('pointerenter', () => UISounds.hover());
      list.append(b);
    }
  },
};

/** Menu music: plays beatmap tracks on the home screen. */
const MenuMusic = {
  paused: false,
  async play(map, { fromPreview = true } = {}) {
    if (!map) return;
    try {
      await AudioManager.resume();
      const buf = await TrackCache.get(map.setId, map.audioFile);
      const parsed = await BeatmapManager.load(map.id).catch(() => null);
      const timing = parsed ? BeatmapParser.timing(parsed.bm).red.map(r => ({ time: r.time, beatLength: r.beatLength })) : null;
      await Music.load(buf, `${map.setId}/${map.audioFile}`, { setId: map.setId, mapId: map.id, timing });
      await Music.setRate(1, false);
      const start = fromPreview && map.previewTime > 0 ? map.previewTime : 0;
      Music.play(start, { fadeIn: 800 });
      Music.onEnded = () => this.next();
      this.paused = false;
      Toolbar.setNowPlaying(map);
    } catch (e) { console.warn('menu music', e); }
  },
  toggle() {
    if (Music.playing) { Music.pause(); this.paused = true; }
    else if (Music.buffer) { Music.play(Music.pausedPos, { fadeIn: 300 }); this.paused = false; }
  },
  history: [],
  async next() {
    const all = BeatmapManager.sets.filter(s => s.maps.some(m => !m.problems.length));
    if (!all.length) return;
    if (Music.meta) this.history.push(Music.meta.mapId);
    const set = all[Math.floor(Math.random() * all.length)];
    const map = set.maps.find(m => !m.problems.length);
    Settings.set('last.map', map.id);
    const url = await BeatmapManager.bgURL(map);
    Background.set(url);
    this.play(map, { fromPreview: false });
  },
  async prev() {
    const id = this.history.pop();
    const map = id && BeatmapManager.maps.get(id);
    if (!map) { if (Music.buffer) Music.play(0, { fadeIn: 200 }); return; }
    Background.set(await BeatmapManager.bgURL(map));
    this.play(map, { fromPreview: false });
  },
};

function neruSparkBurst(anchorEl, n = 10) {
  const r = anchorEl.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const s = h('div.neru-spark', '✦');
    const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 90;
    s.style.left = r.left + r.width / 2 + 'px'; s.style.top = r.top + r.height / 2 + 'px';
    s.style.setProperty('--dx', Math.cos(a) * d + 'px'); s.style.setProperty('--dy', Math.sin(a) * d + 'px');
    s.style.fontSize = 12 + Math.random() * 16 + 'px';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1200);
  }
}
