/* BeatmapManager — library, importing (.osz / .osu / folders / drag & drop), validation, file access.
 * Also: BeatmapProvider architecture (local provider now; online providers can plug in later). */

const BeatmapManager = {
  sets: [],                 // set records
  maps: new Map(),          // id -> map record
  setById: new Map(),

  async init() {
    const [sets, maps] = await Promise.all([DB.getAll('sets'), DB.getAll('maps')]);
    this.sets = sets; this.setById = new Map(sets.map(s => [s.id, s]));
    this.maps = new Map(maps.map(m => [m.id, m]));
    for (const s of this.sets) s.maps = s.mapIds.map(id => this.maps.get(id)).filter(Boolean).sort((a, b) => a.stars - b.stars);
  },
  /** Recalculate star ratings stored by older versions (runs in the background after boot). */
  async migrateStarRatings() {
    const stale = [...this.maps.values()].filter(m => m.srVersion !== SR_VERSION && !m.problems.length);
    if (!stale.length) return 0;
    for (const m of stale) {
      try {
        const { bm, notes } = await this.load(m.id);
        m.stars = DifficultyCalculator.calculate(notes, m.keys, 1);
        m.breaks = bm.events.breaks;
        m.srVersion = SR_VERSION;
        await DB.put('maps', m);
      } catch (e) { m.srVersion = SR_VERSION; }
      await sleep(0);
    }
    for (const s of this.sets) s.maps.sort((a, b) => a.stars - b.stars);
    Bus.emit('library:changed');
    return stale.length;
  },
  /** Remove difficulties stored by older versions that can't be played (and sets left with none). */
  async pruneUnplayable() {
    const bad = [...this.maps.values()].filter(m => m.problems && m.problems.length);
    if (!bad.length) return 0;
    for (const m of bad) { await DB.del('maps', m.id); this.maps.delete(m.id); }
    for (const s of [...this.sets]) {
      const keep = s.mapIds.filter(id => this.maps.has(id));
      if (!keep.length) { await this.removeSet(s.id); continue; }
      if (keep.length !== s.mapIds.length) { s.mapIds = keep; s.maps = keep.map(id => this.maps.get(id)).sort((a, b) => a.stars - b.stars); await DB.put('sets', { ...s, maps: undefined }); }
    }
    Bus.emit('library:changed');
    return bad.length;
  },
  playableMaps() { return [...this.maps.values()].filter(m => !m.problems.length); },
  mapByHash(hash) { for (const m of this.maps.values()) if (m.hash === hash) return m; return null; },

  async getFile(setId, path) {
    const set = this.setById.get(setId);
    if (!set) return null;
    const real = set.fileIndex[normPath(path).toLowerCase()];
    return real ? DB.get('files', `${setId}/${real}`) : null;
  },
  hasFile(setId, path) { const s = this.setById.get(setId); return !!(s && path && s.fileIndex[normPath(path).toLowerCase()]); },
  /** Song cards' pictures: sharp on big and high-density screens (they were 640px wide, which looked soft). */
  THUMB_W: 1280, THUMB_Q: 0.9, THUMB_V: 2,
  /** A set's card picture (1280px, kept with the set): sharp on any card. (A smaller copy made on the fly for
   *  cards was blurry stretched over one, and making it — on the main thread, every session — cost more than the
   *  browser decoding the stored picture, which it does off the main thread.) */
  async thumbURL(set) {
    if (set && set.thumbV !== this.THUMB_V) this.upgradeThumb(set);
    if (!set || !set.thumb) return null;
    const cached = BlobURLs.map.get(`thumb:${set.id}`);
    if (cached) return cached;
    const b = await DB.get('files', `${set.id}/__thumb.jpg`);
    return BlobURLs.get(`thumb:${set.id}`, b);
  },
  async bgURL(map) {
    if (!map || !map.bgFile) return null;
    const key = `bg:${map.setId}/${map.bgFile}`;
    if (BlobURLs.map.has(key)) return BlobURLs.map.get(key);
    const b = await this.getFile(map.setId, map.bgFile);
    return BlobURLs.get(key, b);
  },
  /** Remake an older, smaller card picture at today's size — one set at a time, as its card is shown, and only when
   *  the browser has a moment to spare (never in the middle of scrolling a list). */
  upgradeThumb(set) {
    if (set._thumbUp) return;
    set._thumbUp = true;
    this._thumbQ = (this._thumbQ || Promise.resolve()).then(() => new Promise(r => whenIdle(r))).then(async () => {
      if (set.thumbV === this.THUMB_V || this.setById.get(set.id) !== set) return;
      const m = (set.maps || []).find(x => x.bgFile && this.hasFile(set.id, x.bgFile));
      const b = m && await this.getFile(set.id, m.bgFile).catch(() => null);
      const t = b && await makeThumbnail(b, this.THUMB_W, this.THUMB_Q).catch(() => null);
      if (this.setById.get(set.id) !== set) return;
      if (t) { await DB.put('files', t, `${set.id}/__thumb.jpg`); set.thumb = true; BlobURLs.drop(`thumb:${set.id}`); }
      set.thumbV = this.THUMB_V;
      await DB.put('sets', { ...set, maps: undefined, _thumbUp: undefined });
      if (t) Bus.emit('thumb:changed', set.id);
    }).catch(() => {});
  },
  /** A small copy of this difficulty's own background (low background quality): made once per picture, so a
   *  difficulty with a different background from the rest of its set still shows its own. */
  async bgThumbURL(map) {
    if (!map || !map.bgFile) return this.thumbURL(this.setById.get(map && map.setId));
    const key = `bgthumb:${map.setId}/${map.bgFile}`;
    if (BlobURLs.map.has(key)) return BlobURLs.map.get(key);
    const b = await this.getFile(map.setId, map.bgFile);
    const t = b && await makeThumbnail(b, this.THUMB_W, this.THUMB_Q).catch(() => null);
    return t ? BlobURLs.get(key, t) : this.thumbURL(this.setById.get(map.setId));
  },

  /** Load and parse a difficulty for gameplay. */
  async load(mapId) {
    const rec = this.maps.get(mapId);
    if (!rec) throw new Error('Beatmap not found');
    const blob = await this.getFile(rec.setId, rec.osuPath);
    if (!blob) throw new Error('Beatmap file missing from storage');
    const bm = BeatmapParser.parse(decodeIniText(new Uint8Array(await blob.arrayBuffer()))); // (as it was read at import)
    return { rec, set: this.setById.get(rec.setId), bm, notes: BeatmapParser.toManiaNotes(bm) };
  },

  // ─────────────────────────────── importing ───────────────────────────────
  /** Import anything the user dropped / picked. Returns a report. */
  async importFiles(files) {
    const report = { sets: [], skins: [], replays: [], errors: [], warnings: [], data: false };
    const loose = [];
    // "Importing <name> (3/12)…" while a batch of archives goes in
    const archives = [...files].filter(f => ['osz', 'zip', 'osk'].includes(fileExt(f.name))).length;
    let nth = 0;
    const status = (what, f) => { nth++; Bus.emit('import:status', `Importing ${what}${f.name.replace(/\.(osz|osk|zip)$/i, '')}${archives > 1 ? ` (${nth}/${archives})` : ''}…`); };
    for (const f of files) {
      const name = f.relPath || f.webkitRelativePath || f.name;
      const ext = fileExt(f.name);
      try {
        if (ext === 'osz') { status('', f); report.sets.push(...await this.importOsz(f, report)); }
        else if (ext === 'osk') { status('skin ', f); report.skins.push(await SkinManager.importOsk(f)); }
        else if (ext === 'amr') { report.replays.push(await ReplayManager.importFile(f)); }
        else if (ext === 'osr') { status('replay ', f); report.replays.push(await Osr.importFile(f)); } // (osu!lazer / osu!stable replays)
        else if (ext === 'zip' && WomImport.looksLike(new ZipReader(await f.arrayBuffer()))) {
          // a Web-Osu-Mania backup (beatmaps, settings, scores and collections)
          const r = await WomImport.run(f, { onStatus: m => Bus.emit('import:status', m) });
          report.sets.push(...r.sets); report.errors.push(...r.errors); report.wom = r;
        }
        else if (ext === 'zip') { status('', f); report.sets.push(...await this.importOsz(f, report)); }
        else if (ext === 'json' && !name.includes('/')) {
          const obj = JSON.parse(await f.text());
          if (obj && obj.app === APP_NAME && obj.kind === 'replay') report.replays.push(await ReplayManager.importObject(obj));
          else if (obj && obj.app === APP_NAME) { await DataManager.importAll(obj); report.data = true; }
          else report.errors.push(`${f.name}: not an ${APP_NAME} data file`);
        }
        else loose.push({ path: normPath(name), file: f });
      } catch (e) {
        console.warn(e); report.errors.push(`${f.name}: ${friendlyError(e)}`);
      }
    }
    // Loose files / folders: group by directory that contains .osu files
    if (loose.length) {
      const dirs = new Map();
      for (const l of loose) {
        const i = l.path.lastIndexOf('/');
        const dir = i < 0 ? '' : l.path.slice(0, i);
        if (!dirs.has(dir)) dirs.set(dir, []);
        dirs.get(dir).push(l);
      }
      // attach files in sub-folders (e.g. sb/, samples/) to the nearest ancestor that has .osu files
      const osuDirs = [...dirs.keys()].filter(d => dirs.get(d).some(l => l.path.toLowerCase().endsWith('.osu')));
      const groups = new Map(osuDirs.map(d => [d, []]));
      for (const l of loose) {
        const owner = osuDirs.filter(d => d === '' || l.path.startsWith(d + '/')).sort((a, b) => b.length - a.length)[0];
        if (owner !== undefined) groups.get(owner).push(l);
      }
      if (!osuDirs.length) report.errors.push(`No .osu, .osz or .osk files found among ${loose.length} file(s)`);
      for (const [dir, list] of groups) {
        const entries = list.map(l => ({
          name: dir ? l.path.slice(dir.length + 1) : l.path,
          size: l.file.size,
          read: async () => new Uint8Array(await l.file.arrayBuffer()),
        }));
        try {
          Bus.emit('import:status', `Importing folder ${dir || '(files)'}…`);
          report.sets.push(...await this._importEntries(entries, dir.split('/').pop() || 'Imported files', report));
        } catch (e) { report.errors.push(`${dir || 'files'}: ${friendlyError(e)}`); }
      }
    }
    Bus.emit('import:status', null);
    if (report.sets.length) Bus.emit('library:changed');
    return report;
  },

  async importOsz(file, report) {
    let zip;
    try { zip = new ZipReader(await file.arrayBuffer()); }
    catch (e) { throw new Error(`Corrupt archive (${e.message})`); }
    const entries = zip.entries.map(e => ({ name: e.name, size: e.usize, read: () => zip.read(e) }))
      .filter(e => !/(^|\/)(__macosx|\.ds_store|thumbs\.db)/i.test(e.name));
    const base = file.name.replace(/\.(osz|zip)$/i, '');
    // an archive with everything inside a folder (a zipped song folder, or a .zip of several): each folder that has
    // difficulties is a beatmap folder of its own, its files' paths taken from there (the audio and background
    // names in the .osu files are relative to it — read from the archive's top they were all "missing")
    const dirOf = n => n.includes('/') ? n.slice(0, n.lastIndexOf('/')) : '';
    const dirs = [...new Set(entries.filter(e => /\.osu$/i.test(e.name)).map(e => dirOf(e.name)))];
    if (!dirs.length || dirs.includes('')) return this._importEntries(entries, base, report);
    const out = [];
    for (const d of dirs) {
      const sub = entries.filter(e => e.name.startsWith(d + '/')).map(e => ({ ...e, name: e.name.slice(d.length + 1) }));
      try { out.push(...await this._importEntries(sub, dirs.length > 1 ? d.split('/').pop() : base, report)); }
      catch (e) { if (dirs.length === 1) throw e; if (report) report.errors.push(`${base} / ${d}: ${friendlyError(e)}`); }
    }
    return out;
  },

  /** Core import: entries = [{name, size, read()}] relative to the beatmap folder. */
  async _importEntries(entries, sourceName, report) {
    entries = entries.filter(e => !/(^|\/)(__macosx|\.ds_store|thumbs\.db)/i.test(e.name));
    const osuEntries = entries.filter(e => e.name.toLowerCase().endsWith('.osu'));
    if (!osuEntries.length) throw new Error('No .osu difficulties found');
    const lowerIndex = new Map(entries.map(e => [e.name.toLowerCase(), e]));
    const available = new Set(lowerIndex.keys());
    const parsed = [];
    for (const e of osuEntries) {
      try {
        const bytes = await e.read();
        // (UTF-8 as osu! writes them; UTF-16 from Windows Notepad and Latin-1 from old editors are read too)
        const text = decodeIniText(bytes);
        const bm = BeatmapParser.parse(text);
        parsed.push({ entry: e, text, bm, hash: await hashHex(bytes) });
      } catch (err) {
        report && report.errors.push(`${sourceName} / ${e.name}: ${err instanceof BeatmapError ? err.message : 'Invalid .osu file (' + err.message + ')'}`);
      }
    }
    if (!parsed.length) throw new Error('No readable difficulties');
    // Group difficulties into sets (usually one per archive, but folders may mix)
    const bySet = new Map();
    for (const p of parsed) {
      const md = p.bm.metadata;
      const onlineId = parseInt(md.BeatmapSetID || '-1', 10);
      const keySrc = onlineId > 0 ? `osu-${onlineId}` : `${md.Artist || ''}|${md.Title || ''}|${md.Creator || ''}`.toLowerCase();
      if (!bySet.has(keySrc)) bySet.set(keySrc, []);
      bySet.get(keySrc).push(p);
    }
    const out = [];
    for (const [keySrc, diffs] of bySet) out.push(await this._storeSet(keySrc, diffs, entries, lowerIndex, available, sourceName, report));
    return out;
  },

  async _storeSet(keySrc, diffs, entries, lowerIndex, available, sourceName, report) {
    const setId = 'set-' + (await hashHex(keySrc)).slice(0, 16);
    const existing = this.setById.get(setId);
    const md = diffs[0].bm.metadata;
    // which files do we keep? .osu, audio, backgrounds, samples, skip video & big storyboards
    const needed = new Set();
    let storyboard = false, video = false;
    for (const d of diffs) {
      needed.add(d.entry.name.toLowerCase());
      if (d.bm.audioFile) needed.add(d.bm.audioFile.toLowerCase());
      if (d.bm.events.background) needed.add(d.bm.events.background.file.toLowerCase());
      if (d.bm.events.storyboard) storyboard = true;
      if (d.bm.events.video) {
        video = true;
        const vf = d.bm.events.video.file;
        if (vf && /\.(mp4|webm|m4v|mov)$/i.test(vf) && Settings.get('gameplay.videoImport')) {
          const ve = lowerIndex.get(vf.toLowerCase());
          if (ve && ve.size < 120e6) needed.add(vf.toLowerCase());
        }
      }
      for (const ho of d.bm.hitObjects) { const f = ho.sample && ho.sample[4]; if (f) needed.add(normPath(f).toLowerCase()); }
    }
    let skinBytes = 0;
    for (const e of entries) {
      const n = e.name.toLowerCase(), ext = fileExt(n);
      if (ext === 'osb') storyboard = true;
      if (['wav', 'ogg', 'mp3'].includes(ext) && !n.includes('/') && e.size < 2e6) needed.add(n);
      // the beatmap's own skin pictures (osu!'s names, beside the .osu files), used over your skin as lazer does
      if (BEATMAP_SKIN_FILE.test(n) && !/@2x\./.test(n) && e.size < 4e6 && (skinBytes += e.size) < 24e6) needed.add(n);
    }
    // the storyboard: the .osb and the pictures it (and each difficulty's own [Events]) uses, up to 40MB of them
    if (storyboard) {
      try {
        const texts = diffs.map(d => d.text || '');
        for (const e of entries) if (fileExt(e.name.toLowerCase()) === 'osb' && e.size < 8e6) { needed.add(e.name.toLowerCase()); texts.unshift(new TextDecoder().decode(await e.read())); }
        let total = 0;
        for (const f of Storyboard.files(texts)) {
          const e = lowerIndex.get(f);
          if (!e || !/\.(png|jpe?g|gif|webp|bmp)$/i.test(f) || needed.has(f)) continue;
          if ((total += e.size) > 40e6) break;
          needed.add(f);
        }
      } catch (e) { console.warn('storyboard files', e); }
    }
    const fileIndex = existing ? { ...existing.fileIndex } : {};
    const items = [];
    for (const n of needed) {
      const e = lowerIndex.get(n);
      if (!e) continue;
      const data = await e.read();
      items.push({ store: 'files', key: `${setId}/${e.name}`, value: new Blob([data], { type: mimeFor(e.name) }) });
      fileIndex[n] = e.name;
      if (items.length >= 20) await DB.putMany(items.splice(0));
    }
    if (items.length) await DB.putMany(items);

    // difficulties
    const mapRecords = [];
    for (const d of diffs) {
      const { bm } = d;
      const v = validateBeatmap(bm, available);
      let stats = null;
      if (!v.problems.length) {
        try { stats = BeatmapParser.analyse(bm); } catch (e) { v.problems.push(e.message); }
      }
      const m = bm.metadata;
      const rec = {
        id: 'map-' + d.hash.slice(0, 16), hash: d.hash, setId,
        onlineId: parseInt(m.BeatmapID || '-1', 10),
        title: m.Title || 'Unknown title', titleUnicode: m.TitleUnicode || m.Title || '',
        artist: m.Artist || 'Unknown artist', artistUnicode: m.ArtistUnicode || m.Artist || '',
        creator: m.Creator || 'Unknown', version: m.Version || 'Normal', source: m.Source || '', tags: m.Tags || '',
        osuPath: d.entry.name, audioFile: bm.audioFile, bgFile: bm.events.background ? bm.events.background.file : null,
        previewTime: bm.previewTime, mode: bm.mode, keys: BeatmapParser.keyCount(bm),
        od: bm.od, hp: bm.hp, problems: v.problems, warnings: v.warnings, srVersion: SR_VERSION,
        breaks: bm.events.breaks,
        added: existing?.added || Date.now(),
        ...(stats || { stars: 0, bpm: 0, bpmMin: 0, bpmMax: 0, length: 0, drainLength: 0, noteCount: 0, lnCount: 0, objectCount: 0, lnRatio: 0, nps: 0, firstNote: 0, lastNote: 0 }),
      };
      // difficulties that can't be played (other game modes, missing audio…) aren't kept at all
      if (v.problems.length) { if (report) report.warnings.push(`${rec.artist} - ${rec.title} [${rec.version}]: ${v.problems.join('; ')}`); continue; }
      mapRecords.push(rec);
    }
    if (!mapRecords.length && !existing) {
      await DB.delPrefix('files', `${setId}/`);
      throw new Error(`${md.Title || sourceName}: no playable osu!mania difficulties`);
    }
    // thumbnail from first background available
    let thumb = existing?.thumb || false;
    const bgRec = mapRecords.find(r => r.bgFile && fileIndex[r.bgFile.toLowerCase()]);
    if (bgRec && !thumb) {
      try {
        const e = lowerIndex.get(bgRec.bgFile.toLowerCase());
        const t = await makeThumbnail(new Blob([await e.read()]), this.THUMB_W, this.THUMB_Q);
        if (t) { await DB.put('files', t, `${setId}/__thumb.jpg`); thumb = true; }
      } catch (e) { /* ignore */ }
    }
    const mapIds = new Set(existing ? existing.mapIds : []);
    for (const r of mapRecords) mapIds.add(r.id);
    const set = {
      id: setId, onlineId: parseInt(md.BeatmapSetID || '-1', 10),
      title: md.Title || 'Unknown title', titleUnicode: md.TitleUnicode || md.Title || '',
      artist: md.Artist || 'Unknown artist', artistUnicode: md.ArtistUnicode || md.Artist || '',
      creator: md.Creator || 'Unknown', source: md.Source || '', tags: md.Tags || '',
      mapIds: [...mapIds], fileIndex, thumb, thumbV: existing && existing.thumb ? existing.thumbV : this.THUMB_V, storyboard, video,
      added: existing?.added || Date.now(), sourceName,
    };
    await DB.putMany([{ store: 'sets', value: set }, ...mapRecords.map(r => ({ store: 'maps', value: r }))]);
    for (const r of mapRecords) this.maps.set(r.id, r);
    set.maps = set.mapIds.map(id => this.maps.get(id)).filter(Boolean).sort((a, b) => a.stars - b.stars);
    if (existing) this.sets[this.sets.indexOf(existing)] = set; else this.sets.push(set);
    this.setById.set(setId, set);
    BlobURLs.drop(`thumb:${setId}`); BlobURLs.drop(`bg:${setId}/`);
    return set;
  },

  /** The editor's Save: this difficulty's .osu replaced by `text` and read in again, beside the set's other files
   *  (its hash — and so its id — change; the old record goes). Returns the new difficulty. */
  /** An edited difficulty back into the library (from the editor): the set's other files as they are, this .osu
   *  replaced. opts.others: other difficulties rewritten with it ([{id, osuPath, text}] — lazer's set-wide details),
   *  opts.extra: files added to the set or replaced ([{name, data}] — a new background). The set moves with its
   *  details (its id comes from them): an old set left empty goes. */
  async saveDifficulty(rec, text, opts = {}) {
    const set = this.setById.get(rec.setId);
    if (!set) throw new Error('That beatmap set is no longer in your library.');
    const others = opts.others || [], extra = opts.extra || [];
    const osuLow = normPath(rec.osuPath).toLowerCase(), entries = [];
    const extraLow = new Set(extra.map(x => normPath(x.name).toLowerCase()));
    for (const [low, real] of Object.entries(set.fileIndex || {})) {
      if (low === osuLow || low.endsWith('.osu') || real.startsWith('__') || extraLow.has(low)) continue;
      entries.push({ name: real, size: 0, read: async () => { const b = await DB.get('files', `${set.id}/${real}`); return new Uint8Array(b ? await b.arrayBuffer() : 0); } });
    }
    for (const x of extra) entries.push({ name: x.name, size: x.data.length, read: async () => x.data });
    const bytes = new TextEncoder().encode(text);
    entries.push({ name: rec.osuPath, size: bytes.length, read: async () => bytes });
    for (const o of others) { const ob = new TextEncoder().encode(o.text); entries.push({ name: o.osuPath, size: ob.length, read: async () => ob }); }
    const gone = [rec.id, ...others.map(o => o.id)];
    for (const id of gone) { await DB.del('maps', id); this.maps.delete(id); }
    set.mapIds = set.mapIds.filter(x => !gone.includes(x));
    const report = { errors: [], warnings: [] };
    const sets = await this._importEntries(entries, set.sourceName || 'editor', report);
    if (report.errors.length) throw new Error(report.errors[0]);
    const out = sets[0] && sets[0].maps.find(m => normPath(m.osuPath).toLowerCase() === osuLow);
    if (out && set.onlineId > 0) { const s2 = this.setById.get(out.setId); if (s2 && !(s2.onlineId > 0)) s2.onlineId = set.onlineId; }
    if (out && out.setId !== set.id && !set.mapIds.length) await this.removeSet(set.id);
    Bus.emit('library:changed');
    return out || null;
  },
  async removeSet(setId) {
    const set = this.setById.get(setId);
    if (!set) return;
    for (const id of set.mapIds) { await DB.del('maps', id); this.maps.delete(id); }
    await DB.del('sets', setId);
    await DB.delPrefix('files', `${setId}/`);
    this.sets = this.sets.filter(s => s !== set);
    this.setById.delete(setId);
    BlobURLs.drop(`thumb:${setId}`); BlobURLs.drop(`bg:${setId}/`);
    Bus.emit('library:changed');
  },
  async clearAll() {
    await DB.clear('sets'); await DB.clear('maps');
    const keys = await DB.getAllKeys('files');
    for (const k of keys) if (!String(k).startsWith('skin:')) await DB.del('files', k);
    this.sets = []; this.maps.clear(); this.setById.clear();
    Bus.emit('library:changed');
  },
  async exportOsz(setId) {
    const set = this.setById.get(setId);
    if (!set) return;
    const files = [];
    for (const real of Object.values(set.fileIndex)) {
      const b = await DB.get('files', `${setId}/${real}`);
      if (b) files.push({ name: real, data: new Uint8Array(await b.arrayBuffer()) });
    }
    downloadBlob(writeZip(files), `${set.artist} - ${set.title}.osz`.replace(/[\\/:*?"<>|]/g, '_'));
  },
};

/** Walk a DataTransfer (supports dropped folders via webkitGetAsEntry). */
async function filesFromDataTransfer(dt) {
  const out = [];
  const items = dt.items ? Array.from(dt.items) : [];
  const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return Array.from(dt.files || []);
  const walk = async (entry, path) => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      f.relPath = path + f.name;
      out.push(f);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, path + entry.name + '/');
      } while (batch.length);
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

// ─────────────────────────────── Providers ───────────────────────────────
/** BeatmapProvider interface. Online providers (mirrors, APIs) can implement this later;
 *  the core game only ever depends on the LocalBeatmapProvider. */
class BeatmapProvider {
  get id() { return 'abstract'; }
  get name() { return 'Provider'; }
  get online() { return false; }
  /** @returns {Promise<Array<{id, title, artist, creator, difficulties}>>} */
  async search(query, options) { throw new Error('not implemented'); }
  async getBeatmap(id) { throw new Error('not implemented'); }
  /** @returns {Promise<Blob>} an .osz archive */
  async downloadBeatmap(id, onProgress) { throw new Error('not implemented'); }
  async getMetadata(id) { throw new Error('not implemented'); }
}
class LocalBeatmapProvider extends BeatmapProvider {
  get id() { return 'local'; }
  get name() { return 'Local library'; }
  async search(query) {
    const q = (query || '').toLowerCase();
    return BeatmapManager.sets.filter(s => !q || q.split(/\s+/).every(w => wordScore(`${s.artist} ${s.title} ${s.creator} ${s.tags}`, w) > 0))
      .map(s => ({ id: s.id, title: s.title, artist: s.artist, creator: s.creator, difficulties: s.maps.map(m => m.version) }));
  }
  async getBeatmap(id) { return BeatmapManager.maps.get(id) || null; }
  async downloadBeatmap(id) {
    const set = BeatmapManager.setById.get(id);
    if (!set) throw new Error('Unknown set');
    const files = [];
    for (const real of Object.values(set.fileIndex)) {
      const b = await DB.get('files', `${id}/${real}`);
      if (b) files.push({ name: real, data: new Uint8Array(await b.arrayBuffer()) });
    }
    return writeZip(files);
  }
  async getMetadata(id) { const s = BeatmapManager.setById.get(id); return s ? { ...s, maps: undefined } : null; }
}
const BeatmapProviders = {
  list: [new LocalBeatmapProvider()],
  register(p) { if (!(p instanceof BeatmapProvider)) throw new Error('Provider must extend BeatmapProvider'); this.list.push(p); },
  get(id) { return this.list.find(p => p.id === id); },
};
