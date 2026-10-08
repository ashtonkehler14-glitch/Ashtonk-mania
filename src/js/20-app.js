/* Application — boot sequence, global input routing, drag & drop importing. */

/** Version of public/skins/kori.osk: 2 added its health bar (scorebar-bg / scorebar-colour). */
const BUNDLED_KORI_VERSION = 2;

const App = {
  lastReport: null,
  async boot() {
    const status = $('.load-status');
    const say = (msg) => { status.textContent = msg; };
    // each step on its own, so one broken record can't leave the rest of the library unloaded
    const failed = [];
    const step = async (label, fn) => { try { await fn(); } catch (e) { console.error(label, e); failed.push(label); } };
    say('Opening library…');
    await step('storage', () => DB.open());
    await step('settings', () => Settings.load());
    say('Loading skin…');
    await step('skins', () => SkinManager.init());
    if (!SkinManager.current) { SkinManager.defaultSkin = SkinManager.defaultSkin || new DefaultSkin(); SkinManager.current = SkinManager.defaultSkin; }
    await step('the bundled skin', () => this.installBundledSkin(say));
    say('Loading beatmaps…');
    await step('beatmaps', () => BeatmapManager.init());
    await BeatmapManager.pruneUnplayable().catch(e => console.warn('prune', e)); // older versions kept them
    await Multiplayer.cleanupTemp().catch(() => {}); // beatmaps installed only for a room that wasn't left cleanly
    await Promise.all([['scores', ScoreManager], ['replays', ReplayManager], ['favourites', Favorites], ['collections', Collections], ['profile', ProfileManager], ['beatmap offsets', MapOffsets]]
      .map(([label, m]) => step(label, () => m.init())));
    await ProfileManager.syncPlays().catch(e => console.warn('plays under an earlier name', e)); // (renamed before this was done)
    say('Preparing stage…');
    AudioManager.init();
    Zoom.init();
    Toolbar.build();
    Tooltip.init();
    UISounds.initHover();
    FallingText.init();
    Screens.register('home', HomeScreen);
    Screens.register('songselect', SongSelect);
    Screens.register('gameplay', GameplayScreen);
    Screens.register('results', ResultsScreen);
    Screens.register('beatmaps', BeatmapsScreen);
    Screens.register('explore', ExplorerScreen);
    Screens.register('dashboard', DashboardScreen);
    Screens.register('rankings', RankingsScreen);
    Screens.register('daily', DailyScreen);
    Screens.register('editor', EditorScreen);
    Screens.register('multiplayer', MultiplayerScreen);
    Screens.register('collections', CollectionsScreen);
    Screens.register('profile', ProfileScreen);
    Screens.register('stats', ProfileScreen);
    Screens.register('replays', ReplaysScreen);
    Screens.register('skins', SkinsScreen);
    this.bindGlobal();
    VolumeOverlay.bind();
    LazerCursor.init();
    MediaKeys.init();
    window.AshtonkMania = { MapOffsets, Onboarding, Presence, NeruMascot, App, DB, Settings, ProfileManager, OsuMath, ExplorerScreen, OnlineBeatmaps, BeatmapManager, SkinManager, ScoreManager, ReplayManager, Music, AudioManager, Screens, GameplayScreen, Game, SongSelect, BeatmapParser, Collections, Favorites, SettingsPanel, ModSelect, MenuMusic, NowPlaying, Multiplayer, MultiplayerScreen, Zoom, healthModeFor, SkinHealthBar, friendlyError, AvatarPresets, Toast, Background, Spectate, Friends, OnlinePanel, DashboardScreen, UserPanels, Osr, Mobile, Dialog, Chat, Rankings, RankingsScreen, Daily, DailyScreen, Medals, ProfileScreen, Bus, ManageCollections, MpResults, EditorScreen, SkinEditor, HudLayout, Screenshot, UserTags };
    try { await Screens.go('home'); }
    catch (e) { console.error(e); Toast.err('The main menu failed to load', e.message); }
    await sleep(250);
    $('#loading-screen').classList.add('done');
    setTimeout(() => $('#loading-screen').classList.add('gone'), 1000); // after the fade: stop its logo animation
    if (DB.memory) Toast.show('Storage is blocked', 'This browser isn\'t letting the game save anything here (private window or blocked site data?). You can play, but beatmaps, scores and settings are lost when the tab closes.', { type: 'err', timeout: 20000 });
    else if (failed.length) Toast.err('Some saved data couldn\'t be loaded', `Problem with: ${failed.join(', ')}. Everything else works; Settings → Maintenance can export or reset your data.`);
    this.globalLoop();
    this.initPWA();
    Mobile.early(); // (on a phone: recommend the app before anything else)
    this.installExtraSkins(); // (in the background: the menu doesn't wait for it)
    const returning = !!ProfileManager.profile.onboarded;
    if (!returning) { await Onboarding.run(); DB.kvSet('changelog.seen', WhatsNew.latest()).catch(() => {}); }
    else setTimeout(() => WhatsNew.maybeShow(), 1200);
    Mobile.init();
    try { Medals.backfill(); } catch (e) { console.warn('medals', e); }
    // (the online status of imported beatmaps, in the background once the game has settled)
    setTimeout(() => BeatmapStatus.sync(), 6000);
    Bus.on('library:changed', () => { clearTimeout(this._bsT); this._bsT = setTimeout(() => BeatmapStatus.sync(), 3000); });
    Multiplayer.joinFromLink();
    Multiplayer.resume(); // (the page was reloaded in a room: back into it)
    Presence.start();
    setTimeout(() => BeatmapManager.migrateStarRatings().catch(e => console.warn('SR migration', e))
      .then(() => BeatmapManager.addConverts()).catch(e => console.warn('converts', e)), 1500);
    Bus.on('profile:changed', () => Toolbar.updateProfile());
    Bus.on('skin:changed', s => OSD.show('Skin', s.name, this._skinKey || ''));
  },

  /** Kori 3.0 ships with the client (public/skins/kori.osk, mania assets only) and is installed and selected
   *  on first launch. A skin dropped in as skins/default.osk takes priority. Runs once per browser; deleting
   *  Kori afterwards is respected. Needs http(s) — browsers block fetch() from file://. */
  async installBundledSkin(say) {
    if (!/^https?:/.test(location.protocol)) return;
    if (await DB.kvGet('bundled.kori', false)) { await this.upgradeBundledSkin(); return; }
    const existing = SkinManager.skins.find(sk => /kori/i.test(sk.name));
    if (existing) {
      await DB.kvSet('bundled.kori', true);
      if (SkinManager.current.builtin) await SkinManager.select(existing.id, { silent: true });
      return;
    }
    for (const name of ['skins/default.osk', 'skins/kori.osk', 'public/skins/kori.osk', 'skins/Kori 3.0.osk']) {
      try {
        const r = await fetch(encodeURI(name), { cache: 'no-cache' });
        if (!r.ok) continue;
        const blob = await r.blob();
        if (blob.size < 1000 || !/zip|octet|osk/i.test(r.headers.get('content-type') || 'zip')) continue;
        say('Installing Kori 3.0…');
        const meta = await SkinManager.importOsk(new File([blob], name.split('/').pop()));
        if (SkinManager.current.builtin || name === 'skins/default.osk') await SkinManager.select(meta.id, { silent: true });
        await DB.kvSet('bundled.kori', true);
        await DB.kvSet('bundled.kori.v', BUNDLED_KORI_VERSION);
        return;
      } catch (e) { /* not bundled */ }
    }
  },

  /** Other skins that ship with the game (installed once, not selected; deleting one is respected). */
  // v: bump when the shipped copy changes; installed copies then get its skin.ini (v2: Chemuss 4K hit position 448)
  // (none any more: Chemuss no longer comes with the game — it can still be imported like any skin)
  EXTRA_SKINS: [],
  async installExtraSkins() {
    if (!/^https?:/.test(location.protocol)) return;
    for (const x of this.EXTRA_SKINS) {
      try {
        if (await DB.kvGet(`bundled.${x.key}`, false)) {
          if ((await DB.kvGet(`bundled.${x.key}.v`, 1)) >= x.v) continue;
          const meta = SkinManager.skins.find(sk => x.match.test(sk.name));
          if (meta) {
            const r = await fetch(x.file, { cache: 'no-cache' });
            if (!r.ok) continue;
            const zip = new ZipReader(await r.arrayBuffer());
            const ini = zip.entries.filter(e => /(^|\/)skin\.ini$/i.test(e.name)).sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
            if (ini) await SkinManager.updateIni(meta.id, decodeIniText(await zip.read(ini)));
          }
          await DB.kvSet(`bundled.${x.key}.v`, x.v);
          continue;
        }
        if (!SkinManager.skins.some(sk => x.match.test(sk.name))) {
          const r = await fetch(x.file, { cache: 'no-cache' });
          if (!r.ok) continue; // try again next launch
          const blob = await r.blob();
          if (blob.size < 1000) continue;
          await SkinManager.importOsk(new File([blob], x.file.split('/').pop()));
        }
        await DB.kvSet(`bundled.${x.key}`, true);
        await DB.kvSet(`bundled.${x.key}.v`, x.v);
      } catch (e) { console.warn('bundled skin', x.key, e); }
    }
  },

  /** Copies of the bundled Kori installed before version 2 lack its health bar (scorebar-*): add those files once. */
  async upgradeBundledSkin() {
    if ((await DB.kvGet('bundled.kori.v', 1)) >= BUNDLED_KORI_VERSION) return;
    try {
      const kori = SkinManager.skins.find(sk => (sk.source === 'kori.osk' || /kori 3\.0$/i.test(sk.name || '')) && !sk.files.some(f => /^scorebar-colour/i.test(f)));
      if (kori) {
        const r = await fetch('skins/kori.osk', { cache: 'no-cache' });
        if (!r.ok) return; // try again next launch
        const zip = new ZipReader(await r.arrayBuffer());
        const files = [];
        for (const e of zip.entries) if (/^scorebar-[^/]+\.png$/i.test(e.name)) files.push({ rel: e.name, data: await zip.read(e) });
        await SkinManager.addFiles(kori.id, files);
      }
      await DB.kvSet('bundled.kori.v', BUNDLED_KORI_VERSION);
    } catch (e) { /* offline or blocked: try again next launch */ }
  },

  bindGlobal() {
    // anything that slips through: log it and tell the player (at most every 10 s, and never mid-play)
    let lastErr = -1e9;
    const report = err => {
      const e = err && (err instanceof Error || err.message) ? err : new Error(String(err));
      if (/ResizeObserver loop|^Script error\.?$|play\(\) request was interrupted/i.test(e.message || '') || /^(AbortError|NotAllowedError)$/.test(e.name)) return;
      console.error(e);
      const now = performance.now();
      if (now - lastErr < 10000 || (Screens.current === GameplayScreen && GameplayScreen.s && GameplayScreen.s.running)) return;
      lastErr = now;
      Toast.err('Something went wrong', friendlyError(e));
    };
    window.addEventListener('error', ev => { if (ev.error || ev.message) report(ev.error || ev.message); });
    window.addEventListener('unhandledrejection', ev => report(ev.reason));
    const resume = () => AudioManager.resume();
    window.addEventListener('pointerdown', resume, { capture: true });
    window.addEventListener('keydown', resume, { capture: true });
    window.addEventListener('pointermove', e => Background.parallax(e), { passive: true });
    window.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
    // hiding the tab pauses a solo play (a match keeps going, like losing focus)
    document.addEventListener('visibilitychange', () => { if (document.hidden && Screens.current === GameplayScreen && GameplayScreen._blur) GameplayScreen._blur(); });
    // the music fades out as you leave the site (another tab, minimised) and back in when you return
    document.addEventListener('visibilitychange', () => AudioManager.setAway(document.hidden));
    // hover sounds for all buttons
    document.addEventListener('pointerover', e => { const b = e.target.closest && e.target.closest('.btn, .chip, .tb-btn, .side-item, .lb-row, .lbs, .list-row button, .foot-btn, .ss-cookie, .menu button, .pd-btn, .pm-btn, .mp-cr-card, .sp-nav button'); if (b && !b.contains(e.relatedTarget)) UISounds.hover(); });
    // drag & drop
    let depth = 0;
    const ov = $('#drop-overlay');
    const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; ov.classList.add('show'); });
    window.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) ov.classList.remove('show'); });
    window.addEventListener('drop', async e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; ov.classList.remove('show');
      if (Screens.current === GameplayScreen && GameplayScreen.s && GameplayScreen.s.running) { Toast.show('Finish or pause your play before importing'); return; }
      const files = await filesFromDataTransfer(e.dataTransfer);
      this.importFiles(files);
    });
  },

  onKey(e) {
    const top = Overlays.top();
    if (top) {
      if (top.onKey && top.onKey(e)) { e.preventDefault(); return; }
      if (e.key === 'Escape') { e.preventDefault(); top.close(); return; }
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
    }
    // global shortcuts
    // (not in the middle of your own song, as lazer: the settings would take the keys while the notes kept coming —
    // paused, or watching Auto or a replay, they open)
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO') {
      e.preventDefault();
      const s = Screens.current === GameplayScreen && GameplayScreen.s;
      if (!(s && s.running && s.mode === 'play' && !s.mods.includes('AT'))) SettingsPanel.toggle();
      return;
    }
    // lazer's Ctrl+Shift+S: the skin editor (not while playing for real)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyS' && !(Screens.currentName === 'gameplay' && GameplayScreen.s && GameplayScreen.s.mp)) { e.preventDefault(); SkinEditor.toggle(); return; }
    // lazer's F12: a screenshot
    if (e.code === 'F12' && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); Screenshot.take(); return; }
    // lazer's Ctrl+F11: show / hide the FPS counter
    if ((e.ctrlKey || e.metaKey) && e.code === 'F11') { e.preventDefault(); Settings.set('graphics.showFps', !Settings.get('graphics.showFps')); return; }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') { e.preventDefault(); const v = !Settings.get('debug.overlay'); Settings.set('debug.overlay', v); OSD.show('Debug overlay', v ? 'shown' : 'hidden', 'Ctrl+Shift+D'); return; }
    if (e.altKey && e.code === 'Enter') { e.preventDefault(); toggleFullscreen(); return; }
    // lazer: Alt+↑/↓ change the volume (the meter you're on), Alt+←/→ move between the meters
    if (e.altKey && !e.ctrlKey && !e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && !(Screens.current === GameplayScreen && Settings.get('input.noWheelVolumeInGame'))) {
      e.preventDefault();
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') VolumeOverlay.adjust(VolumeOverlay.sel, e.code === 'ArrowUp' ? 0.05 : -0.05);
      else { const order = ['effects', 'master', 'music'], i = order.indexOf(VolumeOverlay.sel); VolumeOverlay.show(order[clamp(i + (e.code === 'ArrowRight' ? 1 : -1), 0, 2)]); }
      return;
    }
    // lazer: Ctrl+Shift+R a random skin, Ctrl+Shift+E / T the previous / next one
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && ['KeyR', 'KeyE', 'KeyT'].includes(e.code) && Screens.current !== GameplayScreen) {
      e.preventDefault();
      const list = SkinManager.list(), cur = list.findIndex(x => x.id === (SkinManager.current && SkinManager.current.id));
      if (list.length < 2) return;
      let i;
      if (e.code === 'KeyR') { do { i = Math.floor(Math.random() * list.length); } while (i === cur); }
      else i = (cur + (e.code === 'KeyT' ? 1 : -1) + list.length) % list.length;
      this._skinKey = e.code === 'KeyR' ? 'Ctrl+Shift+R' : 'Ctrl+Shift+E / Ctrl+Shift+T';
      SkinManager.select(list[i].id).finally(() => { this._skinKey = ''; });
      return;
    }
    // lazer: Ctrl+P opens (or closes) your profile
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyP' && Screens.current !== GameplayScreen) { e.preventDefault(); if (Screens.currentName === 'profile') Screens.back(); else Screens.go('profile'); return; }
    if (Screens.current === GameplayScreen) return; // gameplay handles its own input (capture listener)
    if (top) return;
    if (!(e.target.closest && e.target.closest('input, textarea, select')) && Toolbar.hotkey(e)) { e.preventDefault(); return; }
    const inField = e.target.closest && e.target.closest('input, textarea, select');
    if (e.key === '?' && !inField && !e.ctrlKey && !e.altKey) { e.preventDefault(); Shortcuts.open(); return; }
    if (Screens.current && Screens.current.onKey && Screens.current.onKey(e)) { e.preventDefault(); return; }
    if (inField) return;
    if (e.key === 'Escape') { e.preventDefault(); Screens.back(); return; }
  },

  async importFiles(files) {
    if (!files || !files.length) return;
    await AudioManager.resume();
    const pill = h('div.import-pill', h('span.spinner'), h('span', 'Importing…'));
    $('#app').appendChild(pill);
    const off = Bus.on('import:status', m => { if (m) pill.lastChild.textContent = m; });
    let report;
    try { report = await BeatmapManager.importFiles(files); }
    catch (e) { report = { sets: [], skins: [], replays: [], errors: [friendlyError(e)], warnings: [] }; }
    finally { off(); pill.remove(); }
    this.lastReport = report;
    Bus.emit('import:report', report);
    const parts = [];
    if (report.sets.length) parts.push(`${plural(report.sets.length, 'beatmap set')} (${plural(report.sets.reduce((a, s) => a + s.maps.length, 0), 'difficulty', 'difficulties')})`);
    if (report.skins.length) parts.push(`skin ${report.skins.map(s => s.name).join(', ')}`);
    if (report.replays.length) parts.push(`${report.replays.length} replay${report.replays.length === 1 ? '' : 's'}`);
    if (report.data) parts.push('data backup');
    if (report.wom) parts.push(`a Web-Osu-Mania backup (${WomImport.summary(report.wom)})`);
    if (parts.length) Toast.ok('Imported ' + parts.join(', '));
    if (report.errors.length) Toast.err(`Import problem${report.errors.length === 1 ? '' : 's'}`, report.errors.slice(0, 6).join('\n') + (report.errors.length > 6 ? `\n…and ${report.errors.length - 6} more` : ''));
    if (report.sets.length || report.skins.length) this.keepStorage();
    if (report.skins.length) await SkinManager.select(report.skins[report.skins.length - 1].id);
    if (report.data) Toolbar.updateProfile();
    const firstSet = report.sets.find(s => s.maps.some(m => !m.problems.length));
    if (firstSet) {
      const map = firstSet.maps.find(m => !m.problems.length);
      SongSelect.selectedId = map.id;
      Settings.set('last.map', map.id);
      if (Screens.currentName === 'songselect') SongSelect.select(map.id);
      else if (Screens.currentName === 'home') Screens.go('songselect', { mapId: map.id }, { transition: 'zoom' });
    }
    return report;
  },

  /** Installable, offline-capable app: the service worker (public/sw.js) keeps the game for offline play,
   *  the manifest lets browsers install it, and the installed app opens .osz / .osk / .amr files directly. */
  installPrompt: null,
  initPWA() {
    if ('serviceWorker' in navigator && window.isSecureContext && /^https?:/.test(location.protocol))
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker', e));
    if (window.__bip) this.installPrompt = window.__bip; // (it came before boot)
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); this.installPrompt = e; Bus.emit('install:available', true); });
    window.addEventListener('appinstalled', () => { this.installPrompt = null; Bus.emit('install:available', false); Toast.ok('Ashtonk!mania installed', 'Open it from your apps — it works offline too.'); });
    if ('launchQueue' in window) window.launchQueue.setConsumer(async params => {
      if (!params.files || !params.files.length) return;
      const files = await Promise.all(params.files.map(f => f.getFile()));
      this.importFiles(files);
    });
  },
  get installed() { return ['fullscreen', 'standalone', 'minimal-ui'].some(m => window.matchMedia && matchMedia(`(display-mode: ${m})`).matches); },
  async install() {
    const p = this.installPrompt;
    if (!p) return false;
    this.installPrompt = null;
    p.prompt();
    const r = await p.userChoice.catch(() => null);
    Bus.emit('install:available', false);
    return !!(r && r.outcome === 'accepted');
  },

  /** Once there's a library worth keeping, ask the browser not to evict it when disk space runs low
   *  (Chrome decides silently; Firefox asks once). */
  async keepStorage() {
    try {
      if (DB.memory || !navigator.storage || !navigator.storage.persisted || await navigator.storage.persisted()) return;
      if (await DB.kvGet('storage.persistAsked', false)) return;
      await DB.kvSet('storage.persistAsked', true);
      await DB.persist();
    } catch (e) { /* not supported */ }
  },

  globalLoop() {
    const dbg = h('div.debug-overlay', { hidden: true });
    $('#app').appendChild(dbg);
    let lastDbg = 0;
    const tick = now => {
      requestAnimationFrame(tick);
      // (only write `hidden` when it changes: an attribute write every frame forces a style pass every frame)
      if (Screens.current === GameplayScreen) { if (!dbg.hidden) dbg.hidden = true; return; }
      FPS.frame(now);
      const on = Settings.get('debug.overlay');
      if (dbg.hidden === on) dbg.hidden = !on;
      if (on && now - lastDbg > 250) {
        lastDbg = now;
        const ctx = AudioManager.ctx;
        dbg.textContent =
`ASHTONK!MANIA DEBUG  (Ctrl+Shift+D)
Screen       ${Screens.currentName}
FPS          ${FPS.fps.toFixed(0)} (${FPS.frameMs.toFixed(2)}ms)
Audio        ${ctx ? ctx.state : 'n/a'} · ${ctx ? ctx.sampleRate + 'Hz' : ''} · out ${ctx ? ((ctx.outputLatency || ctx.baseLatency || 0) * 1000).toFixed(1) : 0}ms
Music        ${Music.playing ? 'playing' : 'stopped'} @ ${Music.time.toFixed(0)}ms / ${Music.duration.toFixed(0)}ms
Library      ${BeatmapManager.sets.length} sets · ${BeatmapManager.maps.size} diffs
Scores       ${ScoreManager.scores.length} · replays ${ReplayManager.list.length}
Skin         ${SkinManager.current.name}${SkinManager.prefer2x() ? ' (@2x)' : ''}
DPR          ${devicePixelRatio} · ${innerWidth}×${innerHeight}
Memory       ${performance.memory ? fmtBytes(performance.memory.usedJSHeapSize) : 'n/a'}`;
      }
    };
    requestAnimationFrame(tick);
  },
};

window.addEventListener('DOMContentLoaded', () => App.boot());

/** Media keys and the system's media controls (lazer's MusicController hotkeys): play / pause, next and previous
 *  track for the menu music, with the song's title, artist and background shown by the OS. Ignored in game. */
const MediaKeys = {
  init() {
    if (!('mediaSession' in navigator)) return;
    // (phones: no system media player for the game — it showed as a "Media output" notification)
    if (typeof Mobile !== 'undefined' && Mobile.touch) return;
    const ms = navigator.mediaSession;
    const set = (action, fn) => { try { ms.setActionHandler(action, () => { if (Screens.current !== GameplayScreen) fn(); }); } catch { /* not supported */ } };
    // (lazer's MusicKeyBindingHandler shows each one on the on-screen display)
    set('play', () => { if (!Music.playing) { MenuMusic.toggle(); OSD.show('Music playback', 'Play track'); } });
    set('pause', () => { if (Music.playing) { MenuMusic.toggle(); OSD.show('Music playback', 'Pause track'); } });
    set('nexttrack', () => { MenuMusic.next(); OSD.show('Music playback', 'Next track'); });
    set('previoustrack', () => { const restart = Music.loaded && Music.time >= 5000; MenuMusic.prev(); OSD.show('Music playback', restart ? 'Restart track' : 'Previous track'); });
    Bus.on('music:changed', async m => {
      if (!m || typeof MediaMetadata === 'undefined') return;
      const url = await BeatmapManager.bgURL(m).catch(() => null);
      try { ms.metadata = new MediaMetadata({ title: m.title, artist: m.artist, album: APP_NAME, artwork: url ? [{ src: url }] : [] }); } catch { /* ignore */ }
    });
  },
};

// lazer: the mouse's back button goes back (closes the top panel, or leaves the screen)
window.addEventListener('mouseup', e => {
  if (e.button !== 3) return;
  e.preventDefault();
  const top = Overlays.top();
  if (top) { top.close(); return; }
  if (SettingsPanel.o) { SettingsPanel.close(); return; }
  if (Screens.current === GameplayScreen) { GameplayScreen.onBack(); return; }
  if (Screens.currentName !== 'home' || HomeScreen.menuState !== 'initial') Screens.back();
});

