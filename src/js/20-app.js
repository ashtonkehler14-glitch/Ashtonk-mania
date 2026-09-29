/* Application — boot sequence, global input routing, drag & drop importing. */

const App = {
  lastReport: null,
  async boot() {
    const status = $('.load-status');
    const say = (msg) => { status.textContent = msg; };
    try {
      say('Opening library…');
      await DB.open();
      await Settings.load();
      say('Loading skin…');
      await SkinManager.init();
      await this.installBundledSkin(say);
      say('Loading beatmaps…');
      await BeatmapManager.init();
      await Promise.all([ScoreManager.init(), ReplayManager.init(), Favorites.init(), Collections.init(), ProfileManager.init()]);
      say('Preparing stage…');
    } catch (e) {
      console.error(e);
      status.textContent = 'Storage unavailable: ' + e.message + ' — running without persistence.';
      await sleep(1500);
    }
    AudioManager.init();
    Zoom.init();
    Toolbar.build();
    Screens.register('home', HomeScreen);
    Screens.register('songselect', SongSelect);
    Screens.register('gameplay', GameplayScreen);
    Screens.register('results', ResultsScreen);
    Screens.register('beatmaps', BeatmapsScreen);
    Screens.register('explore', ExplorerScreen);
    Screens.register('multiplayer', MultiplayerScreen);
    Screens.register('collections', CollectionsScreen);
    Screens.register('profile', ProfileScreen);
    Screens.register('stats', ProfileScreen);
    Screens.register('replays', ReplaysScreen);
    Screens.register('skins', SkinsScreen);
    this.bindGlobal();
    VolumeOverlay.bind();
    window.AshtonkMania = { App, DB, Settings, ProfileManager, OsuMath, ExplorerScreen, OnlineBeatmaps, BeatmapManager, SkinManager, ScoreManager, ReplayManager, Music, AudioManager, Screens, GameplayScreen, SongSelect, BeatmapParser, Collections, Favorites, SettingsPanel, ModSelect, MenuMusic, NowPlaying, Multiplayer, MultiplayerScreen, Zoom };
    await Screens.go('home');
    await sleep(250);
    $('#loading-screen').classList.add('done');
    this.globalLoop();
    if (!ProfileManager.profile.onboarded) await Onboarding.run();
    setTimeout(() => BeatmapManager.migrateStarRatings().catch(e => console.warn('SR migration', e)), 1500);
    Bus.on('profile:changed', () => Toolbar.updateProfile());
    Bus.on('skin:changed', s => Toast.show('Skin changed', s.name));
  },

  /** Kori 3.0 ships with the client (public/skins/kori.osk, mania assets only) and is installed and selected
   *  on first launch. A skin dropped in as skins/default.osk takes priority. Runs once per browser; deleting
   *  Kori afterwards is respected. Needs http(s) — browsers block fetch() from file://. */
  async installBundledSkin(say) {
    if (!/^https?:/.test(location.protocol)) return;
    if (await DB.kvGet('bundled.kori', false)) return;
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
        return;
      } catch (e) { /* not bundled */ }
    }
  },

  bindGlobal() {
    const resume = () => AudioManager.resume();
    window.addEventListener('pointerdown', resume, { capture: true });
    window.addEventListener('keydown', resume, { capture: true });
    window.addEventListener('pointermove', e => Background.parallax(e), { passive: true });
    window.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && Screens.current === GameplayScreen) GameplayScreen.pause(); });
    // hover sounds for all buttons
    document.addEventListener('pointerover', e => { const b = e.target.closest && e.target.closest('.btn, .chip, .tb-btn, .side-item, .lb-row, .list-row button'); if (b && !b.contains(e.relatedTarget)) UISounds.hover(); });
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
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO') { e.preventDefault(); SettingsPanel.toggle(); return; }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') { e.preventDefault(); const v = !Settings.get('debug.overlay'); Settings.set('debug.overlay', v); Toast.show(v ? 'Debug overlay enabled' : 'Debug overlay disabled', 'Ctrl+Shift+D'); return; }
    if (e.altKey && e.code === 'Enter') { e.preventDefault(); toggleFullscreen(); return; }
    if (Screens.current === GameplayScreen) return; // gameplay handles its own input (capture listener)
    if (top) return;
    const inField = e.target.closest && e.target.closest('input, textarea, select');
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
    catch (e) { report = { sets: [], skins: [], replays: [], errors: [e.message], warnings: [] }; }
    finally { off(); pill.remove(); }
    this.lastReport = report;
    Bus.emit('import:report', report);
    const parts = [];
    if (report.sets.length) parts.push(`${report.sets.length} beatmap set${report.sets.length === 1 ? '' : 's'} (${report.sets.reduce((a, s) => a + s.maps.length, 0)} difficulties)`);
    if (report.skins.length) parts.push(`skin ${report.skins.map(s => s.name).join(', ')}`);
    if (report.replays.length) parts.push(`${report.replays.length} replay${report.replays.length === 1 ? '' : 's'}`);
    if (report.data) parts.push('data backup');
    if (parts.length) Toast.ok('Imported ' + parts.join(', '), report.warnings.length ? `${report.warnings.length} difficult${report.warnings.length === 1 ? 'y' : 'ies'} can't be played — see Beatmaps.` : '');
    if (report.errors.length) Toast.err(`Import problem${report.errors.length === 1 ? '' : 's'}`, report.errors.slice(0, 6).join('\n') + (report.errors.length > 6 ? `\n…and ${report.errors.length - 6} more` : ''));
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
