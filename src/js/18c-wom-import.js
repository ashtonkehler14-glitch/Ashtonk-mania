/* Web-Osu-Mania backups — the .zip from WOM's Settings → Backup & Restore — brought into Ashtonk!mania:
 * the stored beatmaps (beatmapFiles/*.osz), settings and keybinds (settings.json), high scores (highScores.json)
 * and collections (collections.json, or the older savedBeatmapSets.json). WOM's .womr replays and custom sounds
 * have no counterpart here, so scores arrive without their replays. */

const WomImport = {
  /** Does this zip look like a WOM backup (rather than a beatmap or skin archive)? */
  looksLike(zip) {
    return zip.entries.some(e => /^(settings|highScores|collections|storedBeatmapSets|savedBeatmapSets)\.json$/.test(e.name) || /^beatmapFiles\/\d+/.test(e.name));
  },
  /** WOM's zustand stores are saved as {state, version}; older ones as the bare object. */
  state(text) { const o = JSON.parse(text); return o && typeof o === 'object' && 'state' in o ? o.state : o; },

  /** Import a backup file. Returns what came across: {sets, scores, settings, collections, skipped, errors}. */
  async run(file, { onStatus = () => {} } = {}) {
    const zip = new ZipReader(await file.arrayBuffer());
    if (!this.looksLike(zip)) throw new Error('This isn\'t a Web-Osu-Mania backup. In Web-Osu-Mania, open Settings → Backup & Restore and export one.');
    const out = { sets: [], scores: 0, settings: false, collections: 0, skipped: 0, errors: [] };
    const byName = new Map(zip.entries.map(e => [e.name, e]));
    const json = async name => byName.has(name) ? this.state(await zip.readText(byName.get(name))) : null;

    // beatmaps first: scores and collections point at them
    const osz = zip.entries.filter(e => /^beatmapFiles\/\d+.*\.osz$/i.test(e.name));
    const report = { sets: [], skins: [], replays: [], errors: [], warnings: [] };
    for (let i = 0; i < osz.length; i++) {
      const e = osz[i], setId = Number(/^beatmapFiles\/(\d+)/.exec(e.name)[1]);
      onStatus(`Importing beatmaps… ${i + 1}/${osz.length}`);
      try {
        const f = new File([await zip.read(e)], e.name.split('/').pop(), { type: 'application/zip' });
        const sets = await BeatmapManager.importOsz(f, report);
        for (const s of sets) if (!s.onlineId || s.onlineId < 0) { s.onlineId = setId; await DB.put('sets', { ...s, maps: undefined }); }
        out.sets.push(...sets);
      } catch (err) { out.errors.push(`${e.name.split('/').pop()}: ${friendlyError(err)}`); }
    }
    out.errors.push(...report.errors);
    if (out.sets.length) Bus.emit('library:changed');

    onStatus('Importing settings…');
    try { const st = await json('settings.json'); if (st) out.settings = this.applySettings(st); } catch (err) { out.errors.push(`settings.json: ${friendlyError(err)}`); }

    // collections before scores: their songs that aren't in the backup are downloaded, so scores can land on them too
    try {
      const cols = await json('collections.json');
      const saved = await json('savedBeatmapSets.json');
      const all = { ...(cols && typeof cols === 'object' ? cols : {}) };
      if (saved && Array.isArray(saved.savedBeatmapSets)) all.Saved = saved.savedBeatmapSets;
      out.collections = await this.importCollections(all, out, onStatus);
    } catch (err) { out.errors.push(`collections: ${friendlyError(err)}`); }

    onStatus('Importing scores…');
    try { const hs = await json('highScores.json'); if (hs) Object.assign(out, await this.importScores(hs.highScores || hs, out)); } catch (err) { out.errors.push(`highScores.json: ${friendlyError(err)}`); }
    onStatus(null);
    return out;
  },

  /** The WOM settings that mean the same thing here (volumes, scroll, background, offset, keys, a few toggles). */
  applySettings(w) {
    const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) ? clamp(v, lo, hi) : null;
    const set = (k, v) => { if (v !== null && v !== undefined) Settings.set(k, v); };
    set('audio.master', num(w.volume, 0, 1));
    set('audio.music', num(w.musicVolume, 0, 1));
    set('audio.effects', num(w.sfxVolume, 0, 1));
    set('audio.offset', num(w.audioOffset, -300, 300)); // (same sign: positive makes notes arrive later)
    set('gameplay.scrollSpeed', num(w.scrollSpeed, 1, 40) && Math.round(w.scrollSpeed)); // the same scale as WOM's
    set('gameplay.bgDim', num(w.backgroundDim, 0, 1));
    set('gameplay.bgBlur', num(w.backgroundBlur, 0, 1));
    if (typeof w.upscroll === 'boolean') set('gameplay.scrollDirection', w.upscroll ? 'up' : 'down');
    if (typeof w.show300g === 'boolean') set('gameplay.showMax', w.show300g);
    if (typeof w.showFpsCounter === 'boolean') set('graphics.showFps', w.showFpsCounter);
    if (typeof w.performanceMode === 'boolean') set('graphics.performanceMode', w.performanceMode);
    if (typeof w.preferMetadataInOriginalLanguage === 'boolean') set('ui.unicodeMetadata', w.preferMetadataInOriginalLanguage);
    // keybinds: WOM's keyModes[keyCount - 1][column] = [first key, second key] (KeyboardEvent.code, like ours)
    const km = w.keybinds && Array.isArray(w.keybinds.keyModes) ? w.keybinds.keyModes : null;
    if (km) {
      const binds = { ...Settings.get('input.keybinds') };
      km.forEach((cols, i) => {
        if (!Array.isArray(cols) || cols.length !== i + 1) return;
        const b = cols.map(c => (Array.isArray(c) ? c : [c]).filter(k => typeof k === 'string' && k).slice(0, 2));
        if (b.every(c => c.length)) binds[i + 1] = b;
      });
      Settings.set('input.keybinds', binds);
    }
    this.applySkin(w);
    return true;
  },

  /** WOM's skin — its note style, colours (one hue or a colour per column), judgement set and stage layout — so the
   *  game looks the way it did there: the matching Web-Osu-Mania skin is selected with the same options. */
  applySkin(w) {
    const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) ? clamp(v, lo, hi) : null;
    const set = (k, v) => { if (v !== null && v !== undefined) Settings.set(k, v); };
    const sk = w.skin && typeof w.skin === 'object' ? w.skin : {}, ui = w.ui && typeof w.ui === 'object' ? w.ui : {};
    const colors = sk.colors && typeof sk.colors === 'object' ? sk.colors : null;
    // (older backups kept the hue at the top level)
    set('wom.hue', num(colors && colors.simple ? colors.simple.hue : w.hue, 0, 360));
    if (colors && Array.isArray(colors.custom)) set('wom.customColors', colors.custom.map(k => Array.isArray(k) ? k.map(c => ({ tap: String(c && c.tap || ''), holdHead: String(c && c.holdHead || ''), hold: String(c && c.hold || '') })) : null));
    if (colors && (colors.mode === 'simple' || colors.mode === 'custom')) set('wom.colorMode', colors.mode);
    if (WOM.JUDGEMENT_SETS.some(j => j[0] === sk.judgementSet)) set('wom.judgements', sk.judgementSet);
    if (typeof w.darkerHoldNotes === 'boolean') set('wom.darkerHolds', w.darkerHoldNotes);
    set('wom.noteScale', num(w.noteScale, 0.3, 1.5));
    set('wom.hitPositionOffset', num(w.hitPositionOffset, 0, 600));
    set('wom.laneWidthAdjustment', num(w.laneWidthAdjustment, -50, 100));
    set('wom.laneSpacing', num(w.laneSpacing, 0, 100));
    set('wom.stagePosition', num(w.stagePosition, -1, 1));
    set('wom.stageOpacity', num(w.stageOpacity, 0, 1));
    set('wom.stageSidesOpacity', num(w.stageSidesOpacity, 0, 1));
    set('wom.noteOffset', num(w.noteOffset, -500, 500));
    set('wom.receptorOpacity', num(ui.receptorOpacity, 0, 1));
    if (typeof ui.receptorLighting === 'boolean') set('wom.receptorLighting', ui.receptorLighting);
    set('wom.hudY', num(ui.stageHudYPosition, 0, 1));
    if ([-1, 200, 300, 320].includes(ui.earlyLateThreshold)) set('wom.earlyLate', ui.earlyLateThreshold);
    const style = WOM.STYLES.some(s => s[0] === w.style) ? w.style : 'bars';
    SkinManager.select(`wom-${style}`).catch(() => {});
  },

  /** WOM mod names → ours (and the playback rate they imply). */
  mods(list) {
    const mods = [], names = { 'Easy': 'EZ', 'No Fail': 'NF', 'Half Time': 'HT', 'Hard Rock': 'HR', 'Sudden Death': 'SD', 'Perfect': 'PF', 'Perfect (SS)': 'PSS',
      'Double Time': 'DT', 'Autoplay': 'AT', 'Random': 'RD', 'Mirror': 'MR', 'Constant Speed': 'CS', 'Hold Off': 'NLN' };
    let rate = 1;
    for (const m of Array.isArray(list) ? list : []) {
      if (typeof m !== 'string') continue;
      if (names[m]) mods.push(names[m]);
      else if (m.startsWith('Accuracy Challenge')) mods.push('AC');
      else if (m.startsWith('Fade In')) mods.push('FI');
      else if (m.startsWith('Fade Out')) mods.push('HD');
      else if (m.startsWith('Percy')) mods.push('PC');
      else if (/Override/.test(m)) mods.push('DA');
      else if (m.startsWith('Song Speed')) { const r = parseFloat(m.split(':')[1]); if (r > 0) { rate = r; mods.push('RT'); } }
    }
    if (mods.includes('DT')) rate = 1.5;
    if (mods.includes('HT')) rate = 0.75;
    return { mods: [...new Set(mods)], rate };
  },

  /** highScores[setId][beatmapId] = [{timestamp, mods, results, replayId}] → scores on the matching difficulties. */
  async importScores(hs, out) {
    let scores = 0, skipped = 0;
    const have = new Set(ScoreManager.scores.map(s => s.id));
    for (const [setId, maps] of Object.entries(hs || {})) {
      for (const [mapId, list] of Object.entries(maps || {})) {
        const set = BeatmapManager.sets.find(s => s.onlineId === Number(setId));
        const map = BeatmapManager.sets.flatMap(s => s.maps).find(m => m.onlineId === Number(mapId)) || (set && set.maps.length === 1 ? set.maps[0] : null);
        for (const h of Array.isArray(list) ? list : [list]) {
          const r = h && h.results;
          if (!r) continue;
          if (!map) { skipped++; continue; }
          const id = `sc-wom-${h.replayId || h.timestamp || uid()}`;
          if (have.has(id)) continue;
          const counts = [r[320], r[300], r[200], r[100], r[50], r[0]].map(n => Math.max(0, Math.round(Number(n) || 0)));
          const acc = Number(r.accuracy) > 1 ? Number(r.accuracy) / 100 : Number(r.accuracy) || OsuMath.accuracy(counts);
          const { mods, rate } = this.mods(h.mods);
          const stars = map.stars || 0;
          const score = {
            id, mapHash: map.hash, mapId: map.id, setId: map.setId,
            title: map.title, artist: map.artist, version: map.version, creator: map.creator,
            keys: map.keys, stars, mods, rate, score: Math.round(Number(r.score) || 0), accuracy: acc, maxCombo: Math.round(Number(r.maxCombo) || 0),
            counts, grade: ScoreSystem.gradeFor(acc, false, mods, counts), passed: true, date: Number(h.timestamp) || Date.now(),
            player: ProfileManager.profile.name, replayId: null, imported: 'wom', srVersion: SR_VERSION,
          };
          score.pp = mods.includes('AT') ? 0 : OsuMath.pp(stars, counts, mods);
          await DB.put('scores', score);
          ScoreManager.scores.push(score); have.add(id);
          scores++;
        }
      }
    }
    if (scores) { ScoreManager.scores.sort((a, b) => a.date - b.date); ScoreManager._reindex(); Bus.emit('scores:changed'); }
    return { scores, skipped: out.skipped + skipped };
  },

  /** WOM collections hold online beatmap sets: any that aren't in the library yet are downloaded (from the same
   *  mirrors as the beatmap listing), then each collection is made here with the same name. */
  async importCollections(all, out, onStatus = () => {}) {
    const have = id => BeatmapManager.sets.find(s => s.onlineId === Number(id));
    const missing = new Map();
    for (const sets of Object.values(all)) if (Array.isArray(sets)) for (const ws of sets) {
      const id = Number(ws && ws.id);
      if (id > 0 && !have(id) && !missing.has(id)) missing.set(id, { id, title: String(ws.title || ''), artist: String(ws.artist || ''), creator: String(ws.creator || '') });
    }
    if (missing.size && navigator.onLine === false) out.errors.push(`${plural(missing.size, 'song')} from your collections couldn't be downloaded: you're offline`);
    else {
      let i = 0, failed = 0;
      for (const set of missing.values()) {
        onStatus(`Downloading songs from your collections… ${++i}/${missing.size}`);
        try { const r = await OnlineBeatmaps.downloadAndImport(set, null, { quiet: true }); out.sets.push(...r.sets); out.downloaded = (out.downloaded || 0) + 1; }
        catch (err) { failed++; if (failed <= 3) out.errors.push(`${set.artist} - ${set.title}: ${friendlyError(err)}`); }
      }
      if (failed > 3) out.errors.push(`…and ${failed - 3} more songs couldn't be downloaded`);
    }
    let n = 0;
    for (const [name, sets] of Object.entries(all)) {
      if (!Array.isArray(sets)) continue;
      const hashes = [];
      for (const ws of sets) { const local = ws && have(ws.id); if (local) hashes.push(...local.maps.map(m => m.hash)); }
      let c = Collections.list.find(x => x.name === name);
      if (!c) { if (!hashes.length && !sets.length) continue; c = await Collections.create(name); }
      c.hashes = [...new Set([...c.hashes, ...hashes])];
      n++;
    }
    if (n) await Collections.save();
    return n;
  },

  /** A short "what came across" line for toasts and the setup screen. */
  summary(r) {
    const parts = [];
    if (r.sets.length) parts.push(plural(r.sets.length, 'beatmap set') + (r.downloaded ? ` (${r.downloaded} downloaded for your collections)` : ''));
    if (r.scores) parts.push(plural(r.scores, 'score'));
    if (r.collections) parts.push(plural(r.collections, 'collection'));
    if (r.settings) parts.push('settings and keybinds');
    return parts.length ? parts.join(', ') : 'nothing new';
  },

  /** Pick a backup and import it, with the usual import pill and a toast. */
  async pickAndImport() {
    const [f] = await pickFiles({ accept: '.zip', multiple: false });
    if (f) return this.importFile(f);
    return null;
  },
  async importFile(f) {
    await AudioManager.resume();
    const pill = h('div.import-pill', h('span.spinner'), h('span', 'Reading backup…'));
    $('#app').appendChild(pill);
    try {
      const r = await this.run(f, { onStatus: m => { if (m) pill.lastChild.textContent = m; } });
      Toast.ok('Web-Osu-Mania backup imported', WomImport.summary(r) + (r.skipped ? ` (${plural(r.skipped, 'score')} for beatmaps that weren't in the backup were left out)` : ''));
      if (r.errors.length) Toast.err('Some of it couldn\'t be imported', r.errors.slice(0, 5).join('\n'));
      if (r.sets.length) App.keepStorage && App.keepStorage();
      return r;
    } catch (e) {
      Toast.err('Couldn\'t import the backup', friendlyError(e));
      return null;
    } finally { pill.remove(); }
  },
};
