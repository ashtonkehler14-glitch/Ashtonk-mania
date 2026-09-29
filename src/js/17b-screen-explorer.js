/* Beatmap Explorer — search osu!mania beatmaps online and download them straight into the library.
 * On the Cloudflare deployment it talks to the same-origin Worker (/api/search, /api/download/:id),
 * which uses the official osu! API (if configured) or public mirrors. When the page is not served
 * by the Worker (e.g. a local copy) it calls the mirrors directly, which works where they allow CORS. */

const OnlineBeatmaps = {
  apiAvailable: null,
  PAGE: 40,
  DIRECT_SEARCH: [
    p => `https://catboy.best/api/v2/search?q=${encodeURIComponent(p.q)}&mode=3&limit=40&offset=${p.page * 40}${p.status !== 'any' ? `&status=${({ ranked: 1, qualified: 3, loved: 4, pending: 0, graveyard: -2 })[p.status] ?? 1}` : ''}`,
    p => `https://api.nerinyan.moe/search?q=${encodeURIComponent(p.q)}&m=3&ps=40&p=${p.page}&s=${p.status === 'any' ? 'all' : p.status}${p.sort ? `&sort=${p.sort}` : ''}`,
  ],
  DIRECT_DOWNLOAD: [id => `https://catboy.best/d/${id}`, id => `https://api.nerinyan.moe/d/${id}?noVideo=true`, id => `https://osu.direct/api/d/${id}`],

  async checkApi() {
    if (this.apiAvailable !== null) return this.apiAvailable;
    if (!/^https?:/.test(location.protocol)) return (this.apiAvailable = false);
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      this.apiAvailable = r.ok && /json/.test(r.headers.get('content-type') || '');
    } catch (e) { this.apiAvailable = false; }
    return this.apiAvailable;
  },
  /** Mirror/osu! set → compact form (same shape as the Worker's normalizeSet). */
  normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = Number(raw.id ?? raw.beatmapset_id ?? raw.SetID);
    if (!id) return null;
    const diffs = (raw.beatmaps || raw.ChildrenBeatmaps || []).map(b => ({
      id: Number(b.id ?? b.BeatmapID ?? 0),
      mode: b.mode_int ?? (typeof b.mode === 'number' ? b.mode : b.mode === 'mania' ? 3 : b.Mode ?? (b.mode === undefined ? 3 : -1)),
      version: String(b.version ?? b.DiffName ?? 'Normal'), stars: Number(b.difficulty_rating ?? b.DifficultyRating ?? 0),
      keys: Math.round(Number(b.cs ?? b.CS ?? 4)), od: Number(b.accuracy ?? b.OD ?? 0), hp: Number(b.drain ?? b.HP ?? 0),
      bpm: Number(b.bpm ?? b.BPM ?? raw.bpm ?? 0), length: Number(b.total_length ?? b.TotalLength ?? 0),
      notes: Number(b.count_circles ?? 0), lns: Number(b.count_sliders ?? 0),
    })).filter(d => Number(d.mode) === 3).sort((a, b) => a.stars - b.stars);
    if (!diffs.length) return null;
    const st = raw.status ?? raw.ranked ?? raw.RankedStatus;
    const names = { '-2': 'graveyard', '-1': 'wip', 0: 'pending', 1: 'ranked', 2: 'approved', 3: 'qualified', 4: 'loved' };
    return {
      id, title: String(raw.title ?? raw.Title ?? ''), titleUnicode: String(raw.title_unicode ?? raw.title ?? ''),
      artist: String(raw.artist ?? raw.Artist ?? ''), artistUnicode: String(raw.artist_unicode ?? raw.artist ?? ''),
      creator: String(raw.creator ?? raw.Creator ?? ''), source: String(raw.source ?? ''),
      status: /^-?\d+$/.test(String(st)) ? (names[st] || 'pending') : String(st || 'pending'),
      playCount: Number(raw.play_count ?? raw.PlayCount ?? 0), favourites: Number(raw.favourite_count ?? raw.Favourites ?? 0),
      video: !!(raw.video ?? raw.HasVideo), nsfw: !!raw.nsfw, diffs,
    };
  },
  async search(p) {
    const params = new URLSearchParams({ q: p.q || '', status: p.status, page: String(p.page || 0) });
    if (p.keys.length) params.set('keys', p.keys.join(','));
    if (p.sort) params.set('sort', p.sort);
    if (p.minStars > 0) params.set('minStars', p.minStars);
    if (p.maxStars < 20) params.set('maxStars', p.maxStars);
    if (p.cursor) params.set('cursor', p.cursor);
    if (await this.checkApi()) {
      const r = await fetch('api/search?' + params);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ? `${d.error}\n${(d.errors || []).join('\n')}` : `Search failed (${r.status})`);
      return d;
    }
    const q = [p.q, p.keys.length === 1 ? `key=${p.keys[0]}` : '', p.minStars > 0 ? `stars>=${p.minStars}` : '', p.maxStars < 20 ? `stars<=${p.maxStars}` : ''].filter(Boolean).join(' ');
    const errors = [];
    for (const u of this.DIRECT_SEARCH) {
      try {
        const r = await fetch(u({ ...p, q }));
        if (!r.ok) { errors.push(`${new URL(u(p)).host}: HTTP ${r.status}`); continue; }
        const data = await r.json();
        const arr = Array.isArray(data) ? data : data.beatmapsets || data.data || [];
        const sets = arr.map(x => this.normalize(x)).filter(Boolean)
          .map(s => ({ ...s, diffs: s.diffs.filter(d => (!p.keys.length || p.keys.includes(d.keys)) && d.stars >= p.minStars && d.stars <= p.maxStars) }))
          .filter(s => s.diffs.length);
        return { sets, page: p.page, hasMore: arr.length >= 20, source: new URL(u(p)).host + ' (direct)' };
      } catch (e) { errors.push(`${new URL(u(p)).host}: ${e.message}`); }
    }
    throw new Error('Online search is unavailable here.\n' + errors.join('\n') +
      '\nTip: the explorer works fully on the Cloudflare deployment (it proxies the mirrors).');
  },
  /** Download an .osz with progress; returns a File. */
  async download(id, onProgress) {
    const urls = (await this.checkApi()) ? [`api/download/${id}`] : this.DIRECT_DOWNLOAD.map(f => f(id));
    let lastErr = null;
    for (const url of urls) {
      try {
        const r = await fetch(url);
        const ct = r.headers.get('content-type') || '';
        if (!r.ok || /json|html|text/.test(ct)) { lastErr = new Error(`HTTP ${r.status}`); continue; }
        const total = Number(r.headers.get('content-length')) || 0;
        const reader = r.body && r.body.getReader ? r.body.getReader() : null;
        let blob;
        if (reader) {
          const chunks = []; let got = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value); got += value.length;
            onProgress && onProgress(total ? got / total : null, got);
          }
          blob = new Blob(chunks);
        } else blob = await r.blob();
        if (blob.size < 200) { lastErr = new Error('Empty download'); continue; }
        return new File([blob], `${id}.osz`, { type: 'application/zip' });
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Download failed');
  },
  /** Download a set and import it into the library (remembering its online id). */
  async downloadAndImport(set, onProgress) {
    const file = await this.download(set.id, onProgress);
    const report = await BeatmapManager.importFiles([file]);
    if (!report.sets.length) throw new Error(report.errors.join('\n') || 'The archive had no playable difficulties.');
    for (const s of report.sets) if (!s.onlineId || s.onlineId < 0) { s.onlineId = set.id; await DB.put('sets', { ...s, maps: undefined }); }
    Toast.ok(`Downloaded ${set.artist} - ${set.title}`, `${report.sets.reduce((a, s) => a + s.maps.length, 0)} difficulties added to your library.`);
    Bus.emit('library:changed');
    return report;
  },
  coverURL(id, kind = 'card') { return `https://assets.ppy.sh/beatmaps/${id}/covers/${kind}.jpg`; },
  previewURL(id) { return `https://b.ppy.sh/preview/${id}.mp3`; },
};

class OnlineBeatmapProvider extends BeatmapProvider {
  get id() { return 'online'; }
  get name() { return 'osu! beatmaps (online)'; }
  get online() { return true; }
  async search(query, opts = {}) { return (await OnlineBeatmaps.search({ q: query, keys: [], status: 'ranked', page: 0, minStars: 0, maxStars: 99, ...opts })).sets; }
  async getBeatmap(id) { return (await this.search(String(id))).find(s => s.id === Number(id)) || null; }
  async downloadBeatmap(id, onProgress) { return OnlineBeatmaps.download(id, onProgress); }
  async getMetadata(id) { return this.getBeatmap(id); }
}
BeatmapProviders.register(new OnlineBeatmapProvider());

const EXPLORE_STATUSES = [['any', 'Any'], ['ranked', 'Ranked'], ['qualified', 'Qualified'], ['loved', 'Loved'], ['pending', 'Pending'], ['graveyard', 'Graveyard']];
const EXPLORE_SORTS = [['', 'Relevance'], ['title', 'Title'], ['artist', 'Artist'], ['difficulty', 'Difficulty'], ['ranked', 'Ranked'], ['rating', 'Rating'], ['plays', 'Plays'], ['favourites', 'Favourites']];

const ExplorerScreen = {
  tab: 'explore',
  state: { q: '', keys: [], status: 'ranked', sort: '', dir: 'desc', minStars: 0, maxStars: 20, hideOwned: false },
  results: [], page: 0, hasMore: false, loading: false, cursor: null,
  downloads: new Map(), // setId -> {progress, state:'downloading'|'done'|'error'}
  audio: null,

  enter() {
    const el = h('div.explorer');
    const st = this.state;
    this.searchInput = h('input.input.ex-search', { type: 'search', value: st.q, placeholder: 'Search osu!mania beatmaps — title, artist, mapper, tags…', 'aria-label': 'Search online beatmaps' });
    let t = 0;
    this.searchInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = this.searchInput.value.trim(); this.newSearch(); }, 420); });
    this.searchInput.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { clearTimeout(t); st.q = this.searchInput.value.trim(); this.newSearch(); } if (e.key === 'Escape') this.searchInput.blur(); });
    const chipRow = (label, items, isOn, onClick) => h('div.ex-filter', h('span.ex-flabel', label), h('div.ex-chips', ...items.map(([v, l]) => h(`button.ex-chip${isOn(v) ? '.on' : ''}`, { onclick: () => { onClick(v); UISounds.click(); this.renderFilters(); this.newSearch(); } }, l))));
    this.filters = h('div.ex-filters');
    this.renderFilters = () => {
      clearEl(this.filters).append(
        chipRow('Keys', [[0, 'Any'], ...Array.from({ length: 9 }, (_, i) => [i + 1, `${i + 1}K`]), [10, '10K']], v => v === 0 ? !st.keys.length : st.keys.includes(v), v => { st.keys = v === 0 ? [] : st.keys.includes(v) ? st.keys.filter(x => x !== v) : [...st.keys, v]; }),
        chipRow('Category', EXPLORE_STATUSES, v => st.status === v, v => { st.status = v; }),
        chipRow('Sort', EXPLORE_SORTS, v => st.sort === v, v => { if (st.sort === v && v) st.dir = st.dir === 'desc' ? 'asc' : 'desc'; st.sort = v; }),
        h('div.ex-filter', h('span.ex-flabel', 'Stars'), this.starSliders()),
        h('div.ex-filter', h('span.ex-flabel', 'Extra'), h('div.ex-chips', h(`button.ex-chip${st.hideOwned ? '.on' : ''}`, { onclick: () => { st.hideOwned = !st.hideOwned; UISounds.click(); this.renderFilters(); this.renderResults(); } }, 'Hide downloaded'))));
    };
    this.renderFilters();
    this.grid = h('div.ex-grid');
    this.status = h('div.ex-status');
    this.sentinel = h('div.ex-sentinel');
    const header = h('div.ex-header',
      h('div.ex-title', h('h1', 'Beatmap Explorer'), h('span.muted', 'osu!mania beatmaps, downloaded straight into your library')),
      h('div.ex-searchwrap', icon('search'), this.searchInput),
      this.filters);
    el.append(h('div.screen-body.ex-body', h('div.page', header, this.grid, this.status, this.sentinel)));
    this.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && this.hasMore && !this.loading) this.loadMore(); }, { rootMargin: '600px' });
    this.io.observe(this.sentinel);
    this._unsub = [Bus.on('library:changed', () => this.renderResults())];
    if (!this.results.length) this.newSearch(); else this.renderResults();
    return el;
  },
  leave() { this.io && this.io.disconnect(); (this._unsub || []).forEach(f => f()); this.stopPreview(); },
  starSliders() {
    const st = this.state;
    const mk = (key, label) => {
      const s = h('input.slider', { type: 'range', min: 0, max: 10, step: 0.5, value: key === 'minStars' ? st.minStars : Math.min(10, st.maxStars), 'aria-label': label });
      const upd = () => s.style.setProperty('--p', (s.value / 10 * 100) + '%');
      s.addEventListener('input', () => { upd(); v.textContent = this.starLabel(); });
      s.addEventListener('change', () => { st[key] = key === 'maxStars' && +s.value >= 10 ? 20 : +s.value; this.newSearch(); });
      s.addEventListener('keydown', e => e.stopPropagation());
      upd();
      return s;
    };
    const v = h('span.ex-starval', this.starLabel());
    return h('div.ex-stars', mk('minStars', 'Minimum stars'), mk('maxStars', 'Maximum stars'), v);
  },
  starLabel() { const st = this.state; return `${st.minStars.toFixed(1)}★ – ${st.maxStars >= 10 ? '∞' : st.maxStars.toFixed(1) + '★'}`; },
  sortParam() { const st = this.state; return st.sort ? `${st.sort}_${st.dir}` : ''; },
  async newSearch() { this.page = 0; this.results = []; this.cursor = null; this.hasMore = false; this.token = {}; this.renderResults(); await this.loadMore(); },
  async loadMore() {
    const tok = this.token || (this.token = {});
    this.loading = true; this.renderStatus();
    try {
      const st = this.state;
      const d = await OnlineBeatmaps.search({ q: st.q, keys: st.keys, status: st.status, sort: this.sortParam(), page: this.page, minStars: st.minStars, maxStars: st.maxStars, cursor: this.cursor });
      if (tok !== this.token) return;
      const seen = new Set(this.results.map(s => s.id));
      this.results.push(...d.sets.filter(s => !seen.has(s.id)));
      this.hasMore = !!d.hasMore && d.sets.length > 0;
      this.cursor = d.cursor || null;
      this.page++;
      this.source = d.source;
      this.error = null;
    } catch (e) {
      if (tok !== this.token) return;
      this.error = e.message; this.hasMore = false;
    } finally {
      if (tok === this.token) { this.loading = false; this.renderResults(); }
    }
  },
  owned(id) { return BeatmapManager.sets.find(s => s.onlineId === id) || null; },
  renderStatus() {
    clearEl(this.status);
    if (this.loading) this.status.append(h('div.ex-loading', h('span.spinner'), 'Searching…'));
    else if (this.error) this.status.append(h('div.panel.ex-error', h('b', 'Couldn\'t reach the beatmap servers'), h('pre', this.error)));
    else if (!this.results.length) this.status.append(h('div.empty', h('div.big', 'No beatmaps found'), 'Try a different search or loosen the filters.'));
    else this.status.append(h('div.muted.ex-source', `${this.results.length} set${this.results.length === 1 ? '' : 's'} · via ${this.source}${this.hasMore ? '' : ' · end of results'}`));
  },
  renderResults() {
    if (!this.grid) return;
    clearEl(this.grid);
    const list = this.state.hideOwned ? this.results.filter(s => !this.owned(s.id)) : this.results;
    for (const set of list) this.grid.append(this.card(set));
    this.renderStatus();
  },
  card(set) {
    const owned = this.owned(set.id);
    const dl = this.downloads.get(set.id);
    const cover = h('div.ex-cover');
    const img = new Image();
    img.onload = () => cover.style.backgroundImage = `url("${img.src}")`;
    img.src = OnlineBeatmaps.coverURL(set.id, 'card@2x');
    const keys = [...new Set(set.diffs.map(d => d.keys))].sort((a, b) => a - b);
    const maxStars = Math.max(...set.diffs.map(d => d.stars));
    const len = Math.max(...set.diffs.map(d => d.length));
    const title = Settings.get('ui.unicodeMetadata') && set.titleUnicode ? set.titleUnicode : set.title;
    const artist = Settings.get('ui.unicodeMetadata') && set.artistUnicode ? set.artistUnicode : set.artist;
    const playBtn = h('button.ex-play', { title: 'Preview', 'aria-label': 'Preview', onclick: e => { e.stopPropagation(); this.togglePreview(set.id, playBtn); } }, icon(this.previewId === set.id ? 'pause' : 'play'));
    let action;
    if (owned) action = h('button.btn.sm.primary', { onclick: () => Screens.go('songselect', { mapId: (owned.maps.find(m => !m.problems.length) || owned.maps[0]).id }) }, icon('play'), 'Play');
    else if (dl && dl.state === 'downloading') action = h('div.ex-progress', { style: { '--p': ((dl.progress || 0) * 100).toFixed(0) + '%' } }, h('span', dl.progress != null ? `${Math.round(dl.progress * 100)}%` : fmtBytes(dl.bytes || 0)));
    else action = h('button.btn.sm', { onclick: () => this.download(set) }, icon('download'), dl && dl.state === 'error' ? 'Retry' : 'Download');
    const card = h('div.ex-card', { dataset: { id: set.id } },
      cover, h('div.ex-shade'),
      h('div.ex-left', playBtn),
      h('div.ex-info',
        h('div.ex-top', h(`span.ex-statuspill.st-${set.status}`, set.status.toUpperCase()), set.video ? h('span.tag', 'VIDEO') : null, owned ? h('span.tag.accent', 'IN LIBRARY') : null),
        h('div.ex-t', title), h('div.ex-a', `by ${artist}`),
        h('div.ex-m', 'mapped by ', h('b', set.creator)),
        h('div.ex-meta', icon('play'), fmtInt(set.playCount), icon('heart'), fmtInt(set.favourites), icon('clock'), fmtTime(len * 1000), keys.map(k => h('span.keys-tag', `${k}K`))),
        h('div.ex-diffs', ...set.diffs.slice(0, 16).map(d => h('i', { style: { '--sc': starColour(d.stars) }, title: `[${d.version}] ${d.stars.toFixed(2)}★ ${d.keys}K` })),
          set.diffs.length > 16 ? h('span.muted', `+${set.diffs.length - 16}`) : null, h('span.ex-maxstar', starBadge(maxStars)))),
      h('div.ex-action', action));
    card.addEventListener('pointerenter', () => UISounds.hover());
    return card;
  },
  async download(set) {
    if (this.downloads.get(set.id)?.state === 'downloading') return;
    const state = { state: 'downloading', progress: 0, bytes: 0 };
    this.downloads.set(set.id, state);
    this.refreshCard(set);
    try {
      let lastPaint = 0;
      await OnlineBeatmaps.downloadAndImport(set, (p, bytes) => {
        state.progress = p; state.bytes = bytes;
        const now = performance.now();
        if (now - lastPaint > 120) { lastPaint = now; this.refreshCard(set); }
      });
      state.state = 'done';
    } catch (e) {
      state.state = 'error';
      Toast.err(`Couldn't download ${set.title}`, e.message);
    }
    this.refreshCard(set);
  },
  refreshCard(set) {
    const old = this.grid && this.grid.querySelector(`.ex-card[data-id="${set.id}"]`);
    if (old) old.replaceWith(this.card(set));
  },
  togglePreview(id) {
    if (this.previewId === id) { this.stopPreview(); this.renderResults(); return; }
    this.stopPreview();
    AudioManager.resume();
    if (Music.playing) { Music.pause(); this._resumeMusic = true; }
    const a = new Audio(OnlineBeatmaps.previewURL(id));
    a.volume = clamp(Settings.get('audio.master') * Settings.get('audio.music'), 0, 1);
    a.play().catch(() => Toast.err('Preview unavailable'));
    a.onended = () => { this.stopPreview(); this.renderResults(); };
    this.audio = a; this.previewId = id;
    this.renderResults();
  },
  stopPreview() {
    if (this.audio) { this.audio.pause(); this.audio = null; }
    this.previewId = null;
    if (this._resumeMusic && Music.buffer && !Music.playing) Music.play(Music.pausedPos, { fadeIn: 300 });
    this._resumeMusic = false;
  },
};
