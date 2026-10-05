/* Beatmap Explorer — browse osu!mania beatmaps online and download them straight into the library.
 * The list comes from osu! itself, exactly as on Web-Osu-Mania's home screen: the game's server (/api/getBeatmaps)
 * asks the osu! API's beatmap search. The mirrors (catboy.best, NeriNyan, …) are only used to download a set. */

const OnlineBeatmaps = {
  apiAvailable: null,
  PAGE: 40,
  // Web-Osu-Mania's BEATMAP_API_PROVIDERS, exactly ($setId = the beatmap set number)
  DOWNLOAD_PROVIDERS: {
    mino: 'https://catboy.best/d/$setId', nerinyan: 'https://api.nerinyan.moe/d/$setId',
    sayobot: 'https://dl.sayobot.cn/beatmaps/download/$setId', osudirect: 'https://osu.direct/api/d/$setId',
    nekoha: 'https://mirror.nekoha.moe/api4/download/$setId',
  },
  PREVIEW_PROVIDERS: { official: 'https://b.ppy.sh/preview/$setId.mp3', beatconnect: 'https://beatconnect.io/preview/$setId.mp3', sayobot: 'https://cdnx.sayobot.cn:25225/preview/$setId.mp3' },
  COVER_PROVIDERS: { official: 'https://assets.ppy.sh/beatmaps/$setId/covers/$kind.jpg', sayobot: 'https://a.sayobot.cn/beatmaps/$setId/covers/cover.webp' },
  _covers: new Map(),
  fill(tpl, id, kind = 'cover') { return String(tpl).split('$setId').join(id).split('$kind').join(kind); },
  /** Where to download a set from, as Web-Osu-Mania's getBeatmapSet: the chosen provider's URL — through the game's
   *  server (/api/downloadBeatmap?destinationUrl=…) when "proxy downloads" is on, straight from the browser otherwise —
   *  then (unlike WOM, so one provider being down doesn't stop you) the other providers directly. */
  downloadURLs(id, viaServer) {
    const choice = Settings.get('online.downloadSource') in this.DOWNLOAD_PROVIDERS || Settings.get('online.downloadSource') === 'custom' ? Settings.get('online.downloadSource') : 'mino';
    const customTpl = (Settings.get('online.customDownload') || '').trim();
    const primary = choice === 'custom' && customTpl.includes('$setId') ? this.fill(customTpl, id) : this.fill(this.DOWNLOAD_PROVIDERS[choice in this.DOWNLOAD_PROVIDERS ? choice : 'mino'], id);
    const others = Object.keys(this.DOWNLOAD_PROVIDERS).filter(k => k !== choice).map(k => this.fill(this.DOWNLOAD_PROVIDERS[k], id));
    const first = viaServer && choice !== 'custom' ? `api/downloadBeatmap?destinationUrl=${encodeURIComponent(primary)}` : primary;
    return [...new Set([first, ...(first !== primary ? [primary] : []), ...others])];
  },
  /** Web-Osu-Mania's messages for a provider's answer. */
  downloadError(status, retryAfter) {
    return ({
      400: 'Invalid beatmap set ID.',
      404: 'Beatmap does not exist on the current beatmap provider, please switch to another provider in the settings.',
      410: 'Beatmap is not available on the current beatmap provider, please switch to another provider in the settings.',
      429: `The beatmap provider is experiencing too many requests, please try again ${retryAfter ? `after ${retryAfter} seconds` : 'later'} or switch to another provider in the settings.`,
      500: 'The beatmap provider ran into an error, try again later or switch to another provider in the settings.',
      503: 'The beatmap provider is currently unavailable, try again later or switch to another provider in the settings.',
      504: 'Download request timed out.',
    })[status] || 'An unknown error occurred while trying to download the beatmap, try again later or try switching to another beatmap provider in the settings.';
  },

  async checkApi() {
    if (this.apiAvailable !== null) return this.apiAvailable;
    if (!/^https?:/.test(location.protocol)) return (this.apiAvailable = false);
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      this.apiAvailable = r.ok && /json/.test(r.headers.get('content-type') || '');
    } catch (e) { this.apiAvailable = false; }
    return this.apiAvailable;
  },
  /** An osu! API beatmap set → the explorer's compact form (mania difficulties only, easiest first). */
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
      // (the set's own page has where players quit or failed, 100 points across the song)
      failtimes: b.failtimes && Array.isArray(b.failtimes.fail) ? { fail: b.failtimes.fail.map(Number), exit: (b.failtimes.exit || []).map(Number) } : null,
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
      rankedDate: raw.ranked_date ?? raw.RankedDate ?? raw.approved_date ?? null, submittedDate: raw.submitted_date ?? raw.SubmittedDate ?? null, lastUpdated: raw.last_updated ?? raw.LastUpdate ?? null, rating: Number(raw.rating ?? raw.Rating ?? 0) || this.ratingOf(raw.ratings),
      ratings: Array.isArray(raw.ratings) && raw.ratings.length >= 11 ? raw.ratings.map(Number) : null,
      tags: String(raw.tags ?? raw.Tags ?? ''), description: raw.description && typeof raw.description === 'object' ? String(raw.description.description || '') : '',
      genreId: raw.genre_id ?? raw.genre?.id ?? null, languageId: raw.language_id ?? raw.language?.id ?? null,
    };
  },
  /** Average rating from vote counts (index = score), for sources that don't send the average. */
  ratingOf(v) {
    if (!Array.isArray(v)) return 0;
    let n = 0, sum = 0;
    v.forEach((c, i) => { if (i > 0) { n += +c || 0; sum += i * (+c || 0); } });
    return n ? sum / n : 0;
  },
  /** One page of beatmap sets, asked for exactly as Web-Osu-Mania's getBeatmapSets() asks (src/lib/osuApi.ts): the
   *  star and key filters written into the search text, m=3, the sort only when it isn't the default (osu! then picks
   *  relevance for a text search), the category only when it isn't "Has leaderboard", and osu!'s cursor for the next
   *  page. Each set shows its difficulties that match the keys and stars, easiest first (WOM's useFilteredBeatmaps). */
  async search(p) {
    p = { status: 'leaderboard', keys: [], minStars: 0, maxStars: 20, nsfw: true, ...p };
    if (navigator.onLine === false) throw new Error('You\'re offline. Connect to the internet to browse and download beatmaps — this page searches again by itself once you\'re back online.');
    if (!await this.checkApi()) throw new Error('Browsing beatmaps needs the game\'s server, which asks osu! for them. Open the game from its website to browse, or drag .osz files onto the window to add songs.');
    const lo = p.minStars > 0 ? p.minStars : null, hi = p.maxStars < 20 ? p.maxStars : null;
    const q = [lo !== null && `stars>=${lo}`, hi !== null && `stars<=${hi}`, p.keys.map(k => `key=${k}`).join(' '), p.q].filter(Boolean).join(' ');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('m', '3'); // 3 = mania
    if (p.sort) params.set('sort', p.sort);
    if (p.cursor) params.set('cursor_string', p.cursor);
    if (p.status !== 'leaderboard') params.set('s', p.status);
    params.set('nsfw', String(p.nsfw !== false));
    if (p.genre) params.set('g', p.genre);
    if (p.language) params.set('l', p.language);
    const d = await this.api('api/getBeatmaps?' + params);
    const sets = (d.beatmapsets || []).map(x => this.normalize(x)).filter(Boolean)
      .map(s => ({ ...s, diffs: s.diffs.filter(x => (!p.keys.length || p.keys.includes(x.keys)) && (lo === null || x.stars >= lo) && (hi === null || x.stars <= hi)) }))
      .filter(s => s.diffs.length);
    return { sets, cursor: d.cursor_string || null, hasMore: !!d.cursor_string, total: d.total ?? null };
  },
  /** Several pages of one search, one after another (osu! pages with a cursor), as many as arrive within `ms`. */
  async searchPages(p, n, ms = 8000) {
    const end = Date.now() + ms, sets = [];
    let cursor = null;
    for (let i = 0; i < n; i++) {
      const left = end - Date.now();
      if (left <= 0) break;
      const d = await Promise.race([this.search({ ...p, cursor }), new Promise(r => setTimeout(() => r(null), left))]).catch(() => null);
      if (!d) break;
      sets.push(...d.sets);
      if (!(cursor = d.cursor)) break;
    }
    return { sets };
  },
  /** One beatmap set by its osu! id (Web-Osu-Mania's getBeatmapSet). */
  async getSet(id) {
    if (!await this.checkApi()) return null;
    return this.normalize(await this.api(`api/getBeatmap?beatmapSetId=${encodeURIComponent(id)}`));
  },
  /** GET from the game's server; a failure reads as WOM shows it ("Code 429: The site is being rate-limited…"). */
  async api(url) {
    let r;
    try { r = await fetch(url); } catch (e) { throw new Error('Couldn\'t reach the game\'s server. Check your connection and try again.'); }
    if (!r.ok) {
      let msg = `Code ${r.status}`;
      try { const t = (await r.text()).trim(); if (t && !/^\s*</.test(t)) msg += `: ${t.slice(0, 300)}`; } catch { /* no body */ }
      throw Object.assign(new Error(msg), { status: r.status });
    }
    return r.json();
  },
  /** Download an .osz with progress; returns a File. */
  async download(id, onProgress) {
    const viaServer = Settings.get('online.proxyDownloads') && await this.checkApi();
    const urls = this.downloadURLs(id, viaServer);
    let lastErr = null, firstErr = null; // (the chosen provider's error is the one shown, as WOM shows it)
    for (const url of urls) {
      // a mirror that never answers (or stalls part-way) used to hold the download — and a whole collection
      // import — forever: no answer in 25 s, or no data for 30 s, moves on to the next source
      const ctl = new AbortController();
      let timer = setTimeout(() => ctl.abort(), 25000);
      const kick = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), 30000); };
      try {
        const r = await fetch(url, { signal: ctl.signal });
        const ct = r.headers.get('content-type') || '';
        if (!r.ok || !r.body || /json|html|text/.test(ct)) { lastErr = new Error(this.downloadError(r.ok ? 0 : r.status, r.headers.get('Retry-After'))); firstErr = firstErr || lastErr; continue; }
        kick();
        const total = Number(r.headers.get('content-length')) || 0;
        const reader = r.body && r.body.getReader ? r.body.getReader() : null;
        let blob;
        if (reader) {
          const chunks = []; let got = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            kick();
            chunks.push(value); got += value.length;
            onProgress && onProgress(total ? got / total : null, got);
          }
          blob = new Blob(chunks);
        } else blob = await r.blob();
        if (blob.size < 200) { lastErr = new Error('Empty download'); continue; }
        return new File([blob], `${id}.osz`, { type: 'application/zip' });
      } catch (e) { lastErr = ctl.signal.aborted ? new Error(this.downloadError(504)) : e; firstErr = firstErr || lastErr; }
      finally { clearTimeout(timer); }
    }
    throw firstErr || lastErr || new Error('Download failed');
  },
  /** Download a set and import it into the library (remembering its online id). */
  async downloadAndImport(set, onProgress, { quiet = false } = {}) {
    const file = await this.download(set.id, onProgress);
    // (downloads can run side by side; adding them to the library goes one at a time)
    const run = (this._importQ || Promise.resolve()).then(() => BeatmapManager.importFiles([file]));
    this._importQ = run.catch(() => {});
    const report = await run;
    if (!report.sets.length) throw new Error(report.errors.join('\n') || 'The archive had no playable difficulties.');
    // (the online id and status, for the status pill lazer shows on a set: RANKED, LOVED, …)
    for (const s of report.sets) {
      if (!s.onlineId || s.onlineId < 0) s.onlineId = set.id;
      Object.assign(s, { status: set.status || s.status, genreId: set.genreId ?? s.genreId, languageId: set.languageId ?? s.languageId, rankedDate: set.rankedDate || s.rankedDate, submittedDate: set.submittedDate || s.submittedDate });
      await DB.put('sets', { ...s, maps: undefined });
    }
    if (!quiet) Toast.ok(`Downloaded ${set.artist} - ${set.title}`, `${plural(report.sets.reduce((a, s) => a + s.maps.length, 0), 'difficulty', 'difficulties')} added to your library.`);
    Bus.emit('library:changed');
    return report;
  },
  coverURL(id, kind = 'card') {
    const src = Settings.get('online.coverSource');
    const tpl = src === 'custom' && Settings.get('online.customCover') ? Settings.get('online.customCover').trim() : this.COVER_PROVIDERS[src] || this.COVER_PROVIDERS.official;
    return this.fill(tpl, id, kind);
  },
  /** Load a set's cover into `el` as its background, trying each size in turn (older sets lack the @2x ones). */
  loadCover(el, id, kinds, done) {
    const urls = [...new Set(kinds.map(k => this.coverURL(id, k)))]; // (sources with one cover size give one URL)
    // a cover that has loaded before goes straight in, so rebuilt cards don't fade in again
    const known = this._covers.get(urls.join('|'));
    if (known) { el.style.transition = 'none'; el.style.backgroundImage = `url("${known}")`; done && done(null); return; }
    const next = i => {
      if (i >= urls.length) return;
      const img = new Image();
      // (decoded off the main thread before it's shown, so a card scrolling in doesn't stall a frame decoding it)
      img.onload = () => { const show = () => { this._covers.set(urls.join('|'), img.src); el.style.backgroundImage = `url("${img.src}")`; done && done(img); }; (img.decode ? img.decode() : Promise.resolve()).then(show, show); };
      img.onerror = () => next(i + 1);
      img.src = urls[i];
    };
    next(0);
  },
  previewURL(id) {
    const src = Settings.get('online.previewSource');
    const tpl = src === 'custom' && Settings.get('online.customPreview') ? Settings.get('online.customPreview').trim() : this.PREVIEW_PROVIDERS[src] || this.PREVIEW_PROVIDERS.official;
    return this.fill(tpl, id);
  },
};

class OnlineBeatmapProvider extends BeatmapProvider {
  get id() { return 'online'; }
  get name() { return 'osu! beatmaps (online)'; }
  get online() { return true; }
  async search(query, opts = {}) { return (await OnlineBeatmaps.search({ q: query, keys: [], status: 'ranked', page: 0, minStars: 0, maxStars: 99, ...opts })).sets; }
  async getBeatmap(id) { return OnlineBeatmaps.getSet(id); }
  async downloadBeatmap(id, onProgress) { return OnlineBeatmaps.download(id, onProgress); }
  async getMetadata(id) { return this.getBeatmap(id); }
}
BeatmapProviders.register(new OnlineBeatmapProvider());

// Categories and sorting as on osu! and Web-Osu-Mania: "Has leaderboard", newest ranked first by default.
const EXPLORE_STATUSES = [['any', 'Any'], ['leaderboard', 'Has leaderboard'], ['ranked', 'Ranked'], ['qualified', 'Qualified'], ['loved', 'Loved'], ['pending', 'Pending'], ['wip', 'WIP'], ['graveyard', 'Graveyard']];
const EXPLORE_SORTS = [['title', 'Title'], ['artist', 'Artist'], ['difficulty', 'Difficulty'], ['ranked', 'Ranked'], ['rating', 'Rating'], ['plays', 'Plays'], ['favourites', 'Favourites'], ['relevance', 'Relevance']];
// osu!'s genre and language ids, in the order osu! (and Web-Osu-Mania) list them
const EXPLORE_GENRES = [[0, 'Any'], [1, 'Unspecified'], [2, 'Video Game'], [3, 'Anime'], [4, 'Rock'], [5, 'Pop'], [6, 'Other'], [7, 'Novelty'], [9, 'Hip Hop'], [10, 'Electronic'], [11, 'Metal'], [12, 'Classical'], [13, 'Folk'], [14, 'Jazz']];
const EXPLORE_LANGUAGES = [[0, 'Any'], [2, 'English'], [4, 'Chinese'], [7, 'French'], [8, 'German'], [11, 'Italian'], [3, 'Japanese'], [6, 'Korean'], [10, 'Spanish'], [9, 'Swedish'], [12, 'Russian'], [13, 'Polish'], [5, 'Instrumental'], [1, 'Unspecified'], [14, 'Other']];
const EXPLORE_DEFAULTS = { q: '', keys: [], status: 'leaderboard', sort: 'ranked', dir: 'desc', minStars: 0, maxStars: 20, hideOwned: false, genre: 0, language: 0, nsfw: true, more: false };
/** "Anime · Japanese" from osu!'s genre / language ids (sources that don't send them give ''). */
function genreLanguage(set) {
  const g = set.genreId > 1 ? (EXPLORE_GENRES.find(([v]) => v === set.genreId) || [])[1] : null;
  const l = set.languageId > 1 ? (EXPLORE_LANGUAGES.find(([v]) => v === set.languageId) || [])[1] : null;
  return [g, l].filter(Boolean).join(' · ');
}
const ExplorerScreen = {
  tab: 'explore',
  state: { ...EXPLORE_DEFAULTS },
  results: [], page: 0, hasMore: false, loading: false, cursor: null,
  downloads: new Map(), // setId -> {progress, state:'downloading'|'done'|'error'}
  audio: null,

  enter(params = {}) {
    const el = h('div.explorer.ov', { style: { '--o-h': OVERLAY_HUES.blue } });
    const st = this.state;
    // opened from a multiplayer room: every card picks (host) or suggests (other players) a difficulty for the room
    this.mpPick = !!params.mpPick && typeof Multiplayer !== 'undefined' && Multiplayer.inRoom();
    this.searchInput = h('input.input.ex-search', { type: 'search', value: st.q, placeholder: 'Search osu!mania beatmaps — title, artist, mapper, tags…', 'aria-label': 'Search online beatmaps' });
    let t = 0;
    this.searchInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = this.searchInput.value.trim(); this.newSearch(); }, 420); });
    this.searchInput.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { clearTimeout(t); st.q = this.searchInput.value.trim(); this.newSearch(); } if (e.key === 'Escape') this.searchInput.blur(); });
    const chipRow = (label, items, isOn, onClick) => h('div.ex-filter', h('span.ex-flabel', label), h('div.ex-chips', ...items.map(([v, l]) => h(`button.ex-chip${isOn(v) ? '.on' : ''}`, { onclick: () => { onClick(v); UISounds.click(); this.renderFilters(); this.newSearch(); } }, l))));
    this.filters = h('div.ex-filters');
    this.renderFilters = () => {
      clearEl(this.filters).append(...[
        // the same filters as Web-Osu-Mania's home screen: key counts 1–18, category, sort, stars, genre, language, NSFW
        // the common key counts; the rest (1–18, as on Web-Osu-Mania) and the rarer filters are under "More filters"
        chipRow('Keys', [[0, 'Any'], ...Array.from({ length: 18 }, (_, i) => [i + 1, `${i + 1}K`])], v => v === 0 ? !st.keys.length : st.keys.includes(v), v => { st.keys = v === 0 ? [] : st.keys.includes(v) ? st.keys.filter(x => x !== v) : [...st.keys, v].sort((a, b) => a - b); }),
        chipRow('Category', EXPLORE_STATUSES, v => st.status === v, v => { st.status = v; }),
        // clicking a sort picks it newest/highest first; clicking it again flips the direction (as on WOM and osu!)
        chipRow('Sort', EXPLORE_SORTS.filter(([v]) => v !== 'relevance' || st.q).map(([v, l]) => [v, st.sort === v ? `${l} ${st.dir === 'desc' ? '↓' : '↑'}` : l]),
          v => st.sort === v, v => { if (st.sort === v) st.dir = st.dir === 'desc' ? 'asc' : 'desc'; else { st.sort = v; st.dir = 'desc'; } }),
        st.more || st.minStars > 0 || st.maxStars < 20 ? h('div.ex-filter', h('span.ex-flabel', 'Stars'), this.starSliders()) : null,
        st.more ? chipRow('Genre', EXPLORE_GENRES, v => st.genre === v, v => { st.genre = v; }) : null,
        st.more ? chipRow('Language', EXPLORE_LANGUAGES, v => st.language === v, v => { st.language = v; }) : null,
        st.more ? chipRow('Explicit', [[true, 'Show'], [false, 'Hide']], v => st.nsfw === v, v => { st.nsfw = v; }) : null,
        h('div.ex-filter', h('span.ex-flabel', ''), h('div.ex-chips',
          h(`button.ex-chip${st.hideOwned ? '.on' : ''}`, { onclick: () => { st.hideOwned = !st.hideOwned; UISounds.click(); this.renderFilters(); this.renderResults(); } }, 'Hide downloaded'),
          h(`button.ex-chip${st.more ? '.on' : ''}`, { onclick: () => { st.more = !st.more; UISounds.click(); this.renderFilters(); } }, st.more ? 'Fewer filters' : 'More filters'),
          this.filtersChanged() ? h('button.ex-chip.ex-reset', { onclick: () => { Object.assign(st, { ...EXPLORE_DEFAULTS, keys: [], more: st.more }); this.searchInput.value = ''; UISounds.click(); this.renderFilters(); this.newSearch(); Toast.show('Filters reset'); } }, icon('x'), 'Reset filters') : null))].filter(Boolean));
    };
    this.renderFilters();
    this.grid = h('div.ex-grid');
    this.status = h('div.ex-status');
    this.sentinel = h('div.ex-sentinel');
    const host = this.mpPick && Multiplayer.isHost();
    const header = h('div.ex-header',
      this.mpPick ? h('div.ex-mp', icon('multi'), h('span', host ? 'Pick a beatmap for your multiplayer room — it downloads for everyone.' : 'Find a beatmap and recommend it to the room host.'), h('span.grow'),
        h('button.btn.sm', { onclick: () => Screens.go('multiplayer', {}, { replace: true }) }, icon('back'), 'Back to room')) : null,
      h('div.ex-searchwrap', icon('search'), this.searchInput),
      this.filters);
    const scroller = h('div.screen-body.ex-body', overlayHeader('Beatmap listing', { icon: 'download', sub: 'osu!mania beatmaps, downloaded straight into your library' }),
      h('div.ov-content', h('div.page', header, this.grid, this.status, this.sentinel, this.shield = h('div.ex-shield'))));
    // "back to top" appears once you've scrolled a good way down
    // (a ring around it fills as you near the bottom of what's loaded, as lazer's does)
    const R = 24, C = 2 * Math.PI * R;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 52 52'); ring.classList.add('ex-totop-ring');
    ring.innerHTML = `<circle cx="26" cy="26" r="${R}" class="bg"/><circle cx="26" cy="26" r="${R}" class="fg" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}" transform="rotate(-90 26 26)"/>`;
    const fg = ring.querySelector('.fg');
    this.topBtn = h('button.ex-totop', { title: 'Back to top', 'aria-label': 'Back to top', onclick: () => { UISounds.click(); scroller.scrollTo({ top: 0, behavior: 'smooth' }); } }, ring, icon('up'));
    const paintRing = () => { const max = scroller.scrollHeight - scroller.clientHeight; const p = max > 0 ? clamp(scroller.scrollTop / max, 0, 1) : 0; fg.setAttribute('stroke-dashoffset', (C * (1 - p)).toFixed(2)); };
    // (and when the page's size settles — the screen sliding in, the header taking its height — the cards in view
    // are worked out again: before, the first results could sit unloaded until you scrolled)
    this._ringRO = new ResizeObserver(() => { paintRing(); if (!this._winRaf) this._winRaf = requestAnimationFrame(() => { this._winRaf = 0; this.renderWindow(); }); });
    this._ringRO.observe(this.grid); this._ringRO.observe(scroller); // (more results loading in moves the bottom further away)
    // while the list scrolls, cards passing under the pointer don't react to it (hover lifts, side panels
    // and hover sounds flickering past); they do again a moment after it stops
    scroller.addEventListener('scroll', () => {
      if (!this._winRaf) this._winRaf = requestAnimationFrame(() => { this._winRaf = 0; this.renderWindow(); });
      this.topBtn.classList.toggle('show', scroller.scrollTop > 600);
      paintRing();
      this.shield.classList.add('on'); clearTimeout(this._scrollT); this._scrollT = setTimeout(() => this.shield.classList.remove('on'), 160);
    }, { passive: true });
    el.append(scroller, this.topBtn);
    this.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && this.hasMore && !this.loading) this.loadMore(); }, { root: scroller, rootMargin: '0px 0px 3000px 0px' });
    this.io.observe(this.sentinel);
    // back online after an offline error: search again by itself
    const online = () => { if (this.error) this.newSearch(); };
    window.addEventListener('online', online);
    const resized = () => this.renderWindow(); // (a different width can mean a different number of columns)
    window.addEventListener('resize', resized);
    this._unsub = [Bus.on('library:changed', () => this.renderResults()),
      // (a difficulty's global board, asked for by its beatmap id, for the open beatmap overlay)
      Bus.on('lb', m => { if (!m.id) return; (this.lbById ||= new Map()).set(m.id, { ...m, at: Date.now() }); if (this.setView && this.setView.diff && this.setView.diff.id === m.id) this.renderSet(); }), () => window.removeEventListener('online', online), () => window.removeEventListener('resize', resized)];
    if (!this.results.length) this.newSearch(); else this.renderResults();
    return el;
  },
  leave() { this.io && this.io.disconnect(); this._ringRO && this._ringRO.disconnect(); (this._unsub || []).forEach(f => f()); this.stopPreview(); this.closeSet(); },
  /** One track with two handles (minimum and maximum stars); the label follows the handles while dragging. */
  starSliders() {
    const st = this.state;
    const range = h('div.ex-range');
    const lo = h('input.slider', { type: 'range', min: 0, max: 10, step: 0.1, value: st.minStars, 'aria-label': 'Minimum stars' });
    const hi = h('input.slider', { type: 'range', min: 0, max: 10, step: 0.1, value: Math.min(10, st.maxStars), 'aria-label': 'Maximum stars' });
    const v = h('span.ex-starval');
    const paint = () => {
      range.style.setProperty('--a', (lo.value * 10) + '%'); range.style.setProperty('--b', (hi.value * 10) + '%');
      v.textContent = this.starLabel(+lo.value, +hi.value >= 10 ? 20 : +hi.value);
    };
    // the handles can't cross: the one being dragged stops at the other
    lo.addEventListener('input', () => { if (+lo.value > +hi.value) lo.value = hi.value; paint(); });
    hi.addEventListener('input', () => { if (+hi.value < +lo.value) hi.value = lo.value; paint(); });
    const commit = () => { st.minStars = +lo.value; st.maxStars = +hi.value >= 10 ? 20 : +hi.value; this.newSearch(); };
    for (const s of [lo, hi]) { s.addEventListener('change', commit); s.addEventListener('keydown', e => e.stopPropagation()); }
    range.append(lo, hi);
    paint();
    return h('div.ex-stars', range, v);
  },
  starLabel(min = this.state.minStars, max = this.state.maxStars) { return `${min.toFixed(1)}★ – ${max >= 10 ? '∞' : max.toFixed(1) + '★'}`; },
  /** The sort sent to the server: none for the default (newest ranked first), exactly like Web-Osu-Mania. */
  sortParam() { const st = this.state; const s = `${st.sort || 'ranked'}_${st.dir}`; return s === 'ranked_desc' ? null : s; },
  filtersChanged() {
    const st = this.state, d = EXPLORE_DEFAULTS;
    return st.keys.length > 0 || st.status !== d.status || st.sort !== d.sort || st.dir !== d.dir || st.minStars !== d.minStars || st.maxStars !== d.maxStars
      || st.genre !== d.genre || st.language !== d.language || st.nsfw !== d.nsfw;
  },
  async newSearch() {
    const st = this.state;
    if (st.sort === 'relevance' && !st.q) { st.sort = 'ranked'; st.dir = 'desc'; this.renderFilters && this.renderFilters(); }
    this.page = 0; this.results = []; this.cursor = null; this.hasMore = false; this.token = {}; this.renderResults(); await this.loadMore();
  },
  async loadMore() {
    const tok = this.token || (this.token = {});
    this.loading = true; this.renderStatus();
    try {
      const st = this.state;
      const d = await OnlineBeatmaps.search({ q: st.q, keys: st.keys, status: st.status, sort: this.sortParam(), minStars: st.minStars, maxStars: st.maxStars, cursor: this.cursor, genre: st.genre, language: st.language, nsfw: st.nsfw });
      if (tok !== this.token) return;
      // pages come in osu!'s own order, one after another (as Web-Osu-Mania lists them)
      const seen = new Set(this.results.map(s => s.id));
      this.results = [...this.results, ...d.sets.filter(s => !seen.has(s.id))];
      this.hasMore = d.hasMore;
      this.cursor = d.cursor;
      this.page++;
      this.error = null;
    } catch (e) {
      if (tok !== this.token) return;
      this.error = e.message || String(e); this.errorStatus = e.status || 0; this.hasMore = false;
    } finally {
      if (tok === this.token) {
        this.loading = false; this.renderResults();
        // the end of the list is still in view (a page that added nothing): the observer won't fire again, so load on
        if (this.hasMore && this.sentinel && this.sentinel.isConnected) requestAnimationFrame(() => {
          if (tok !== this.token || this.loading || !this.hasMore) return;
          const r = this.sentinel.getBoundingClientRect();
          if (r.top < innerHeight + 600) this.loadMore();
        });
      }
    }
  },
  /** Beatmap sets you've liked in the listing (kept in this browser). */
  liked() { if (!this._liked) { try { this._liked = new Set(JSON.parse(localStorage.getItem('am.likedSets') || '[]')); } catch { this._liked = new Set(); } } return this._liked; },
  toggleLike(id) { const l = this.liked(); l.has(id) ? l.delete(id) : l.add(id); try { localStorage.setItem('am.likedSets', JSON.stringify([...l])); } catch { /* private mode */ } },
  imported: new Map(), // online set id -> local set ids it was imported as (an archive may carry other ids inside)
  owned(id) { return BeatmapManager.sets.find(s => s.onlineId === id) || (this.imported.get(id) || []).map(x => BeatmapManager.setById.get(x)).find(Boolean) || null; },
  renderStatus() {
    clearEl(this.status);
    if (this.loading) this.status.append(h('div.ex-loading', h('span.spinner'), 'Searching…'));
    else if (this.error) this.status.append(h('div.panel.ex-error', h('b', navigator.onLine === false ? 'You\'re offline' : this.results.length ? 'Failed to load more beatmaps.' : 'Failed to fetch beatmaps.'), h('p', this.error),
      // (Web-Osu-Mania's note for a 429)
      this.errorStatus === 429 ? h('p.muted', 'This can happen when too many people are browsing at once. You can still play the songs in your library. Otherwise, please be patient and try again in a little while.') : null,
      h('button.btn.sm.ex-retry', { onclick: () => this.results.length ? this.loadMore() : this.newSearch() }, icon('retry'), this.results.length ? 'Retry' : 'Try again')));
    else if (!this.results.length) this.status.append(h('div.empty', h('div.big', 'No beatmaps found'), 'Try a different search or loosen the filters.'));
    else this.status.append(h('div.muted.ex-source', `${this.results.length} set${this.results.length === 1 ? '' : 's'}${this.hasMore ? '' : ' · No more beatmaps.'}`));
  },
  renderResults() {
    if (!this.grid) return;
    // keep the scroll position: re-rendering (more results, a finished download) must not jump to the top
    const scroller = this.grid.closest('.screen-body');
    const top = scroller ? scroller.scrollTop : 0;
    const list = this.state.hideOwned ? this.results.filter(s => !this.owned(s.id)) : this.results;
    // cards that haven't changed are kept as they are (rebuilding every card made the whole page flash
    // each time another page of results came in)
    const old = this._cards || new Map(), next = new Map();
    const cards = list.map(set => {
      const sig = this.cardSig(set), c = old.get(set.id);
      const card = c && c.sig === sig && c.set === set ? c.el : this.card(set);
      // a card new to the list fades in once (and drops the animation after)
      if (!c) { card.classList.add('ex-new'); const done = () => card.classList.remove('ex-new'); card.addEventListener('animationend', done, { once: true }); setTimeout(done, 1000); }
      next.set(set.id, { el: card, sig, set });
      return card;
    });
    this._cards = next;
    this._all = cards;
    this.renderWindow();
    this.renderStatus();
    if (scroller) scroller.scrollTop = top;
    // once more after layout (the first row's height, and where the grid sits, are only known then)
    requestAnimationFrame(() => requestAnimationFrame(() => this.renderWindow()));
  },
  /** Only the cards on screen (and a screenful either side) are in the page; the rows above and below are just
   *  space. However long the list grows, scrolling it costs the same as the first page. */
  renderWindow() {
    const grid = this.grid, all = this._all || [];
    if (!grid) return;
    const sc = grid.closest('.screen-body');
    const cs = getComputedStyle(grid);
    const cols = Math.max(1, cs.gridTemplateColumns.split(' ').filter(Boolean).length);
    // the real distance from one row to the next, measured on the page (an estimate drifts further off the further
    // down the list you go, until the window is drawn off screen)
    const kids = grid.children;
    if (kids.length > cols && kids[cols].offsetTop > kids[0].offsetTop) this._rowH = kids[cols].offsetTop - kids[0].offsetTop;
    else if (kids[0] && kids[0].offsetHeight) this._rowH = this._rowH || kids[0].offsetHeight + (parseFloat(cs.rowGap) || 0);
    const rowH = this._rowH || 110, rows = Math.ceil(all.length / cols);
    let from = 0, to = rows;
    if (sc && all.length > cols * 12) {
      // where the grid starts in the list, from layout offsets (the header's scroll effects move things on screen,
      // which threw on-screen positions further off the further down you were)
      let gridTop = 0;
      for (let e = grid; e && e !== sc; e = e.offsetParent) { gridTop += e.offsetTop; if (e.offsetParent && !sc.contains(e.offsetParent) && e.offsetParent !== sc) { gridTop -= sc.offsetTop; break; } }
      const vh = sc.clientHeight || innerHeight; // (not laid out yet, mid-transition: assume a full window)
      const range = extra => [clamp(Math.floor((sc.scrollTop - gridTop - extra) / rowH), 0, rows), clamp(Math.ceil((sc.scrollTop - gridTop + vh + extra) / rowH), 0, rows)];
      // what's in the page already is kept while it still covers the screen with half a screen to spare; past that,
      // the window moves on with a screen and a half either side (so it changes every few hundred pixels, not every row)
      const [needA, needB] = range(vh);
      const w = this._win;
      if (w && w.cols === cols && w.n === all.length && w.from <= needA && w.to >= needB) { from = w.from; to = w.to; }
      else [from, to] = range(vh * 2);
      // covers start loading three screens ahead (either way), so a card scrolling in already has its picture
      const [pa, pb] = range(vh * 3);
      for (let i = pa * cols; i < Math.min(all.length, pb * cols); i++) { const f = all[i]._loadCovers; if (f) { all[i]._loadCovers = null; f(); } }
      // and the next page is asked for long before the end of the list comes into view
      if (this.hasMore && !this.loading && !this.error && pb >= rows - 2) this.loadMore();
    } else for (const c of all) { const f = c._loadCovers; if (f) { c._loadCovers = null; f(); } }
    this._win = { from, to, cols, n: all.length };
    const shown = all.slice(from * cols, to * cols);
    const pt = from ? `${from * rowH}px` : '', pb = to < rows ? `${(rows - to) * rowH}px` : '';
    if (grid.style.paddingTop !== pt) grid.style.paddingTop = pt;
    if (grid.style.paddingBottom !== pb) grid.style.paddingBottom = pb;
    // change only what differs: drop the cards that left, add the ones that came in (re-inserting all of them
    // restyled every card each time)
    const want = new Set(shown);
    for (const k of [...grid.children]) if (!want.has(k)) k.remove();
    let at = grid.firstElementChild;
    for (const c of shown) {
      if (c === at) { at = at.nextElementSibling; continue; }
      grid.insertBefore(c, at);
    }
  },
  /** What a card shows that can change without a new search. */
  cardSig(set) { const dl = this.downloads.get(set.id); return [!!this.owned(set.id), dl ? dl.state : '', this.liked().has(set.id), !!this.mpPick, Settings.get('ui.unicodeMetadata')].join(); },
  /** Only swap the play/pause icons — previewing never re-renders the list. */
  syncPreviewButtons() {
    if (!this.grid) return;
    for (const b of $$('.ex-play', this.grid)) {
      const id = Number(b.closest('.ex-card')?.dataset.id);
      const ic = this.previewId === id ? 'pause' : 'play';
      if (b.dataset.ic !== ic) { b.dataset.ic = ic; clearEl(b).append(icon(ic)); }
    }
    if (this.setView) this.renderSet();
  },
  /** osu!lazer's BeatmapCardNormal: the cover as a square thumbnail on the left (with the preview button), the title,
   *  artist and mapper beside it over the faded cover, and the status, difficulty spectrum and counts along the
   *  bottom. Clicking a card opens its beatmap info overlay — that's where you download or play it. */
  card(set) {
    const owned = this.owned(set.id), dl = this.downloads.get(set.id);
    const thumb = h('div.ex-thumb'), bg = h('div.ex-cardbg');
    // covers load as the card nears the screen (not 100 images per page at once, most of them far below)
    const loadCovers = () => {
      OnlineBeatmaps.loadCover(thumb, set.id, ['list@2x', 'list', 'card'], () => thumb.classList.add('loaded'));
      OnlineBeatmaps.loadCover(bg, set.id, ['card@2x', 'card', 'cover'], () => bg.classList.add('loaded'));
    };
    const keys = [...new Set(set.diffs.map(d => d.keys))].sort((a, b) => a - b);
    const len = Math.max(...set.diffs.map(d => d.length));
    const title = Settings.get('ui.unicodeMetadata') && set.titleUnicode ? set.titleUnicode : set.title;
    const artist = Settings.get('ui.unicodeMetadata') && set.artistUnicode ? set.artistUnicode : set.artist;
    const playBtn = h('button.ex-play', { title: 'Preview', 'aria-label': 'Preview', dataset: { ic: this.previewId === set.id ? 'pause' : 'play' }, onclick: e => { e.stopPropagation(); this.togglePreview(set.id); } }, icon(this.previewId === set.id ? 'pause' : 'play'));
    const spectrum = set.diffs.length > 10
      ? h('span.ex-spec-more', ...[...new Set(set.diffs.map(d => starColour(d.stars)))].slice(0, 1).map(c => h('i', { style: { '--sc': c } })), `${set.diffs.length}`)
      : h('span.ex-spec', ...set.diffs.map(d => h('i', { style: { '--sc': starColour(d.stars) }, title: `[${d.version}] ${d.stars.toFixed(2)}★ ${d.keys}K` })));
    // lazer's hover panel on the card's right edge: like and download (or play when it's already in the library)
    const liked = this.liked().has(set.id);
    const likeBtn = h(`button.ex-side-btn.like${liked ? '.on' : ''}`, { title: liked ? 'Unlike' : 'Like', 'aria-label': 'Like', onclick: e => { e.stopPropagation(); e.currentTarget.blur(); this.toggleLike(set.id); likeBtn.classList.toggle('on', this.liked().has(set.id)); clearEl(likeBtn).append(icon('heart', this.liked().has(set.id) ? 'fill' : '')); UISounds.click(); } }, icon('heart', liked ? 'fill' : ''));
    const sideAct = dl && dl.state === 'downloading'
      ? h('div.ex-side-btn.busy', { title: 'Downloading…', style: { '--p': ((dl.progress || 0) * 100).toFixed(0) + '%' } }, h('span.spinner'))
      : this.mpPick ? h('button.ex-side-btn', { title: 'Choose a difficulty', 'aria-label': 'Choose a difficulty', onclick: e => { e.stopPropagation(); this.openSet(set); } }, icon('multi'))
        : owned ? h('button.ex-side-btn.play', { title: 'Play', 'aria-label': 'Play', onclick: e => { e.stopPropagation(); const m = owned.maps.find(x => !x.problems.length) || owned.maps[0]; this.playLocal(m); } }, icon('play'))
          : h('button.ex-side-btn.dl', { title: 'Download', 'aria-label': 'Download', onclick: e => { e.stopPropagation(); this.download(set); } }, icon('download'));
    const card = h(`div.ex-card${owned ? '.owned' : ''}`, { dataset: { id: set.id }, tabindex: '0', role: 'button', 'aria-label': `${artist} - ${title}`, onclick: () => this.openSet(set),
      onkeydown: e => { if (e.key === 'Enter') { e.stopPropagation(); this.openSet(set); } } },
      bg, h('div.ex-cardshade'),
      h('div.ex-thumbwrap', thumb, playBtn,
        dl && dl.state === 'downloading' ? h('div.ex-thumbprog', { style: { '--p': ((dl.progress || 0) * 100).toFixed(0) + '%' } }) : null),
      h('div.ex-cb',
        h('div.ex-cb-top',
          h('div.ex-titles', h('div.ex-t', { title }, h('span.ex-tt', title), set.video ? h('span.ex-vid', { title: 'Has video' }, icon('film')) : null), h('div.ex-a', { title: artist }, artist)),
          h('div.ex-counts', h('span', { title: 'Favourites' }, icon('heart'), fmtCompact(set.favourites)), h('span', { title: 'Play count' }, icon('play'), fmtCompact(set.playCount)))),
        h('div.ex-m', 'mapped by ', h('b', set.creator)),
        h('div.ex-foot', h(`span.ex-statuspill.st-${set.status}`, set.status.toUpperCase()), spectrum,
          h('span.ex-keys', keys.length > 3 ? `${keys[0]}–${keys[keys.length - 1]}K` : keys.map(k => k + 'K').join(' ')),
          h('span.grow'),
          owned ? h('span.ex-owned', { title: 'In your library' }, icon('check')) : null,
          h('span.ex-length', icon('clock'), fmtTime(len * 1000)))),
      h('div.ex-side', likeBtn, sideAct));
    card.addEventListener('pointerenter', () => UISounds.hover());
    card._loadCovers = loadCovers;
    return card;
  },
  /** The card's / overlay's main action: Play, Download (with progress), or Pick / Suggest for a room. */
  actionFor(set, diff = null) {
    const owned = this.owned(set.id), dl = this.downloads.get(set.id);
    if (dl && dl.state === 'downloading') return h('div.ex-progress', { style: { '--p': ((dl.progress || 0) * 100).toFixed(0) + '%' } }, h('span', dl.progress != null ? `${Math.round(dl.progress * 100)}%` : fmtBytes(dl.bytes || 0)));
    if (this.mpPick) {
      const host = Multiplayer.isHost();
      return h('button.btn.sm.primary', { onclick: e => diff ? this.mpPickDiff(set, diff) : this.mpChoose(set, e.currentTarget) }, icon(host ? 'play' : 'multi'), host ? 'Pick' : 'Recommend');
    }
    if (owned) {
      const m = (diff && owned.maps.find(x => x.onlineId === diff.id)) || owned.maps.find(x => !x.problems.length) || owned.maps[0];
      return h('button.btn.sm.primary', { onclick: () => this.playLocal(m) }, icon('play'), 'Play');
    }
    return h('button.btn.sm', { onclick: () => this.download(set) }, icon('download'), dl && dl.state === 'error' ? 'Retry' : 'Download');
  },

  // ─────────────────────────────── beatmap set overlay ───────────────────────────────
  /** osu!lazer's BeatmapSetOverlay: a full page over the listing — the cover header with the difficulty picker, the
   *  title, artist and mapper, preview / download (or play) buttons, the details panel (length, BPM, notes, key count,
   *  HP drain, accuracy, star rating, rating) and the info section below. */
  openSet(set) {
    this.closeSet();
    UISounds.click();
    this.setView = { set, diff: set.diffs[0] }; // (lazer's BeatmapPicker starts on the first difficulty, the easiest)
    this.setEl = h('div.bso', { role: 'dialog', 'aria-label': `${set.artist} - ${set.title}` });
    this.setO = makeOverlay(this.setEl, { backdrop: false, onClose: () => { this.setO = null; this.setEl = null; this.setView = null; } });
    this.renderSet();
    // (the search only lists a set; its own page adds the ratings and where players failed — fetched once)
    if (!set.full) OnlineBeatmaps.getSet(set.id).then(full => {
      if (!full) return;
      set.full = true; set.ratings = full.ratings || set.ratings; set.description = full.description || set.description; set.tags = full.tags || set.tags;
      for (const d of set.diffs) { const f = full.diffs.find(x => x.id === d.id); if (f && f.failtimes) d.failtimes = f.failtimes; }
      if (this.setView && this.setView.set === set) this.renderSet();
    }).catch(() => {});
  },
  closeSet() { if (this.setO) this.setO.close(); },
  /** lazer's Info section: the mapper's description (as plain text — its HTML isn't trusted) and the tags. */
  descBox(set) {
    let text = '';
    if (set.description) {
      try {
        const doc = new DOMParser().parseFromString(set.description.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n'), 'text/html');
        for (const x of doc.querySelectorAll('script, style, noscript, template')) x.remove();
        text = (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000);
      } catch { text = ''; }
    }
    const tags = (set.tags || '').split(/\s+/).filter(Boolean).slice(0, 40);
    if (!text && !tags.length) return null;
    return h('div.bso-sec', h('h3', 'Description'), text ? h('div.bso-desc', text) : null,
      tags.length ? h('div.bso-tagwords', ...tags.map(t => h('button.bso-tagw', { title: 'Search for this tag', onclick: () => { UISounds.click(); this.closeSet(); this.searchInput.value = t; this.state.q = t; this.newSearch(); } }, t))) : null);
  },
  /** lazer's UserRatings: negative (1–5) against positive (6–10) votes, and the spread of all ten. */
  ratingsBox(set) {
    const r = set.ratings;
    if (!r) return null;
    const neg = r.slice(1, 6).reduce((a, b) => a + b, 0), pos = r.slice(6, 11).reduce((a, b) => a + b, 0), tot = neg + pos;
    if (!tot) return null;
    const max = Math.max(...r.slice(1));
    return h('div.bso-ratings',
      h('div.bso-gh', 'User Rating'),
      h('div.bso-rbar', h('i', { style: { width: (neg / tot * 100).toFixed(1) + '%' } })),
      h('div.bso-rnums', h('span', fmtInt(neg)), h('span', fmtInt(pos))),
      h('div.bso-gh', 'Rating Spread'),
      h('div.bso-spread', ...r.slice(1, 11).map((v, i) => h('i', { title: `${i + 1}: ${fmtInt(v)}`, style: { height: (max ? Math.max(2, v / max * 100) : 2).toFixed(1) + '%', '--h': (i / 9 * 120).toFixed(0) } }))));
  },
  /** lazer's SuccessRate "Points of Failure": where players quit (exit) and failed, across the song. */
  failBox(d) {
    const f = d.failtimes;
    if (!f) return null;
    const n = Math.max(f.fail.length, f.exit.length), tot = i => (f.fail[i] || 0) + (f.exit[i] || 0);
    let max = 0; for (let i = 0; i < n; i++) max = Math.max(max, tot(i));
    if (!max) return null;
    return h('div.bso-fails', h('div.bso-gh', 'Points of Failure'),
      h('div.bso-failg', ...Array.from({ length: n }, (_, i) => h('div', h('i.ex', { style: { height: ((f.exit[i] || 0) / max * 100).toFixed(1) + '%' } }), h('i.fl', { style: { height: ((f.fail[i] || 0) / max * 100).toFixed(1) + '%' } })))));
  },
  renderSet() {
    if (!this.setEl || !this.setView) return;
    const { set, diff: d } = this.setView;
    const keep = this.setEl.querySelector('.bso-scroll');
    const top = keep ? keep.scrollTop : 0;
    const cover = h('div.bso-cover');
    OnlineBeatmaps.loadCover(cover, set.id, ['cover@2x', 'cover', 'card@2x', 'card']);
    const title = Settings.get('ui.unicodeMetadata') && set.titleUnicode ? set.titleUnicode : set.title;
    const artist = Settings.get('ui.unicodeMetadata') && set.artistUnicode ? set.artistUnicode : set.artist;
    const playing = this.previewId === set.id;
    const bar = (label, v, max, fmt = x => x.toFixed(1), cls = '') => h(`div.bso-attr${cls}`, h('span', label), h('div.bar', h('i', { style: { width: clamp(v / max * 100, 0, 100) + '%' } })), h('b', fmt(v)));
    const date = s => { const t = Date.parse(s || ''); return t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null; };
    const hover = h('div.bso-diffhover');
    const diffs = h('div.bso-diffs', ...set.diffs.map(x => {
      const b = h(`button.bso-diff${x === d ? '.on' : ''}`, { style: { '--sc': starColour(x.stars) }, 'aria-label': `${x.version} ${x.stars.toFixed(2)} stars`,
        onclick: () => { this.setView.diff = x; UISounds.click(); this.renderSet(); } }, icon('mania'));
      b.addEventListener('pointerenter', () => { UISounds.hover(); clearEl(hover).append(h('b', x.version), starBadge(x.stars)); });
      b.addEventListener('pointerleave', () => clearEl(hover).append(h('b', d.version), starBadge(d.stars)));
      return b;
    }));
    hover.append(h('b', d.version), starBadge(d.stars));
    const owned = this.owned(set.id), dl = this.downloads.get(set.id);
    let main;
    if (dl && dl.state === 'downloading') main = h('div.bso-dl.busy', { style: { '--p': ((dl.progress || 0) * 100).toFixed(0) + '%' } }, h('i'), h('span', 'Downloading…'), h('small', dl.progress != null ? `${Math.round(dl.progress * 100)}%` : fmtBytes(dl.bytes || 0)));
    else if (this.mpPick) main = h('button.bso-dl', { onclick: () => this.mpPickDiff(set, d) }, icon(Multiplayer.isHost() ? 'play' : 'multi'), h('span', Multiplayer.isHost() ? 'Pick for the room' : 'Recommend to the host'), h('small', d.version));
    else if (owned) { const m = owned.maps.find(x => x.onlineId === d.id) || owned.maps.find(x => !x.problems.length) || owned.maps[0]; main = h('button.bso-dl.play', { onclick: () => this.playLocal(m) }, icon('play'), h('span', 'Play'), h('small', m.version)); }
    else main = h('button.bso-dl', { onclick: () => this.download(set) }, icon('download'), h('span', dl && dl.state === 'error' ? 'Retry download' : 'Download'), h('small', set.video ? 'with video' : 'osu!mania beatmap'));
    const genre = set.genreId > 1 ? (EXPLORE_GENRES.find(([v]) => v === set.genreId) || [])[1] : null;
    const lang = set.languageId > 1 ? (EXPLORE_LANGUAGES.find(([v]) => v === set.languageId) || [])[1] : null;
    const when = date(set.rankedDate || set.lastUpdated);
    const localMap = owned ? owned.maps.find(x => x.onlineId === d.id) : null;
    const localScores = localMap ? ScoreManager.forMap(localMap.hash).slice(0, 8) : [];
    const basic = (ic, label, v) => h('div.bso-basic', icon(ic), h('span', label), h('b', v));
    // lazer's scores section: the difficulty's global leaderboard (scores the server judged), by its beatmap id
    const lbs = this.lbById || (this.lbById = new Map()), lb = lbs.get(d.id);
    if (d.id > 0 && (!lb || Date.now() - lb.at > 60000) && !(this._lbAsked && this._lbAsked.id === d.id && Date.now() - this._lbAsked.at < 5000) && typeof Presence !== 'undefined' && Presence.ws) {
      this._lbAsked = { id: d.id, at: Date.now() }; Presence.send({ t: 'lb', id: d.id, scope: 'global' });
    }
    const me = typeof Presence !== 'undefined' ? Presence.pid() : '';
    const lbRow = sc => h(`div.bso-score.bso-gscore${sc.pid === me ? '.me' : ''}`, { onclick: () => { UISounds.click(); UserPanels.profile({ pid: sc.pid, name: sc.name, avatar: sc.avatar }); } },
      h('span.bso-rank', `#${sc.rank}`), rankPill(sc.grade), Presence.avatarEl(sc, 20), h('b', sc.name), h('span.grow'),
      sc.mods && sc.mods.length ? h('span.dim.bso-mods', sc.mods.join(' ')) : null, h('span.dim', `${fmtInt(sc.combo)}x`), h('span.dim', fmtAcc(sc.acc)), h('b', fmtScore(sc.score)));
    const global = d.id > 0 ? h('div.bso-sec', h('h3', 'Global ranking', h('small', d.version)),
      !lb ? h('div.muted', Presence.ws ? 'Loading scores…' : 'Scores need the online server.')
        : lb.scores.length ? h('div.bso-scorelist', ...lb.scores.slice(0, 10).map(lbRow), ...(lb.you && lb.you.rank > 10 ? [h('div.rk-sep', '…'), lbRow(lb.you)] : []))
          : h('div.muted', 'No scores yet. Be the first to set one!')) : null;
    // one calm page: the cover with the title, who mapped it and the buttons; a single details card on the right;
    // below, only what there is (tags, and your scores once it's in your library)
    // (tags and your scores sit in the left column under the buttons, so the page is one full screen)
    const body = h('div.bso-body', ...[
        [set.source, genre, lang].some(Boolean) ? h('div.bso-tags', ...[['Source', set.source], ['Genre', genre], ['Language', lang]].filter(([, v]) => v).map(([k, v]) => h('span.bso-tag', h('small', k), v))) : null,
        owned ? h('div.bso-sec', h('h3', 'Your scores', h('small', d.version)),
          localScores.length ? h('div.bso-scorelist', ...localScores.map((sc, i) => h('div.bso-score', h('span.bso-rank', `#${i + 1}`), rankPill(sc.grade), h('b', sc.player || ProfileManager.profile.name), h('span.grow'), h('span.dim', fmtAcc(sc.accuracy)), h('b', fmtScore(ScoreManager.value(sc))))))
            : h('div.muted', 'No scores on this difficulty yet.')) : null, global, this.descBox(set)].filter(Boolean));
    clearEl(this.setEl).append(h('div.bso-scroll',
      h('div.bso-header', cover, h('div.bso-shade'),
        h('button.icon-btn.bso-close', { title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => { UISounds.back(); this.closeSet(); } }, icon('x')),
        h('div.bso-inner',
          h('div.bso-left',
            h('div.bso-diffline', diffs, hover),
            h('div.bso-title', title, set.video ? h('span.ex-vid', { title: 'Has video' }, icon('film')) : null),
            h('div.bso-artist', artist),
            h('div.bso-meta', ...[h(`span.ex-statuspill.st-${set.status}`, set.status.toUpperCase()),
              h('span', 'mapped by ', h('b', set.creator)),
              when ? h('span.dim', when) : null,
              h('span.dim.bso-stat', { title: 'Play count' }, icon('play'), fmtCompact(set.playCount)),
              h('span.dim.bso-stat', { title: 'Favourites' }, icon('heart'), fmtCompact(set.favourites))].filter(Boolean)),
            h('div.bso-buttons',
              h('button.bso-fav', { title: 'Preview', 'aria-label': 'Preview', onclick: () => { this.togglePreview(set.id); this.renderSet(); } }, icon(playing ? 'pause' : 'play')),
              main),
            body.children.length ? body : null),
          h('div.bso-card',
            h('div.bso-basics', basic('clock', 'Length', fmtTime(d.length * 1000)), basic('music', 'BPM', String(Math.round(d.bpm))),
              basic('target', 'Notes', fmtInt(d.notes)), basic('list', 'Long notes', fmtInt(d.lns))),
            h('div.bso-bars', ...[bar('Keys', d.keys, 10, x => String(x)), bar('HP drain', d.hp, 10), bar('Accuracy', d.od, 10), bar('Stars', d.stars, 10, x => x.toFixed(2), '.sr'),
              set.rating ? bar('Rating', set.rating, 10, x => x.toFixed(1), '.rating') : null].filter(Boolean)),
            this.ratingsBox(set), this.failBox(d))))));
    const sc = this.setEl.querySelector('.bso-scroll');
    if (sc) sc.scrollTop = top;
  },
  async download(set) {
    if (this.downloads.get(set.id)?.state === 'downloading') return;
    const state = { state: 'downloading', progress: 0, bytes: 0 };
    this.downloads.set(set.id, state);
    this.refreshCard(set);
    try {
      let lastPaint = 0;
      const report = await OnlineBeatmaps.downloadAndImport(set, (p, bytes) => {
        state.progress = p; state.bytes = bytes;
        const now = performance.now();
        if (now - lastPaint > 100) { lastPaint = now; this.paintProgress(set, state); }
      });
      this.imported.set(set.id, report.sets.map(x => x.id));
      state.state = 'done';
    } catch (e) {
      state.state = 'error';
      Toast.err(`Couldn't download ${set.title}`, friendlyError(e));
    }
    this.refreshCard(set);
  },
  /** Multiplayer: choose one of the set's difficulties, then pick it for the room (host) or suggest it. */
  mpChoose(set, btn) {
    const r = btn.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { header: 'Choose a difficulty' },
      ...set.diffs.map(d => ({ label: `${d.version} · ${d.keys}K · ★${d.stars.toFixed(2)}`, icon: 'star', onClick: () => this.mpPickDiff(set, d) })),
    ]);
  },
  async mpPickDiff(set, d) {
    if (!Multiplayer.inRoom()) { Toast.err('You are no longer in a room'); return; }
    const host = Multiplayer.isHost();
    const findLocal = () => [...BeatmapManager.maps.values()].find(m => m.onlineId === d.id && !m.problems.length)
      || (this.owned(set.id)?.maps || []).find(m => m.version === d.version && !m.problems.length) || null;
    let m = findLocal();
    try {
      if (host) {
        if (!m) {
          // download (with the card's progress ring) before picking
          const state = { state: 'downloading', progress: 0, bytes: 0 };
          this.downloads.set(set.id, state); this.refreshCard(set);
          try {
            await OnlineBeatmaps.downloadAndImport(set, p => { state.progress = p; this.refreshCard(set); });
            state.state = 'done';
          } catch (e) { state.state = 'error'; throw e; } finally { this.refreshCard(set); }
          m = findLocal();
        }
        if (!m) throw new Error('That difficulty couldn\'t be found after downloading.');
        Multiplayer.selectMap(m, Settings.get('songselect.mods') || []);
        Toast.ok('Beatmap picked', `${m.title} [${m.version}]`);
      } else {
        const info = { title: set.title, artist: set.artist, version: d.version, creator: set.creator, stars: d.stars, keys: d.keys, onlineSetId: set.id, onlineId: d.id };
        Multiplayer.send({ t: 'suggest', map: m ? { ...info, hash: m.hash, length: m.length } : info });
        Toast.show('Recommended to the host', `${set.title} [${d.version}]`);
      }
      Screens.go('multiplayer', {}, { replace: true });
    } catch (e) { Toast.err(host ? 'Couldn\'t pick that beatmap' : 'Couldn\'t recommend that beatmap', e.message); }
  },
  /** Download progress, written into the card and the info page as they are: rebuilding them for every tick made
   *  the card under the pointer jitter (its hover lift and side panel restarted each time). */
  paintProgress(set, st) {
    const pct = ((st.progress || 0) * 100).toFixed(0) + '%';
    const card = this.grid && this.grid.querySelector(`.ex-card[data-id="${set.id}"]`);
    if (card) for (const el of card.querySelectorAll('.ex-thumbprog, .ex-side-btn.busy')) el.style.setProperty('--p', pct);
    const dl = this.setEl && this.setView && this.setView.set.id === set.id && this.setEl.querySelector('.bso-dl.busy');
    if (dl) { dl.style.setProperty('--p', pct); const sm = dl.querySelector('small'); if (sm) sm.textContent = st.progress != null ? `${Math.round(st.progress * 100)}%` : fmtBytes(st.bytes || 0); }
  },
  refreshCard(set) {
    const old = this.grid && this.grid.querySelector(`.ex-card[data-id="${set.id}"]`);
    if (old) { const card = this.card(set); old.replaceWith(card); if (this._cards) this._cards.set(set.id, { el: card, sig: this.cardSig(set), set }); }
    if (this.setView && this.setView.set.id === set.id) this.renderSet();
  },
  togglePreview(id) {
    if (this.previewId === id) { this.stopPreview(); this.syncPreviewButtons(); return; }
    this.stopPreview();
    AudioManager.resume();
    if (Music.playing) { Music.pause(); this._resumeMusic = true; }
    const a = previewPlayer(OnlineBeatmaps.previewURL(id));
    a.volume = clamp(Settings.get('audio.master') * Settings.get('audio.music'), 0, 1);
    a.play().catch(() => Toast.err('Preview unavailable'));
    a.onended = () => { this.stopPreview(); this.syncPreviewButtons(); };
    this.audio = a; this.previewId = id;
    this.syncPreviewButtons();
  },
  /** Play a downloaded map: its background and song start straight away (not after song select settles), and the
   *  menu song the preview had paused isn't resumed over it. */
  playLocal(m) {
    if (typeof Multiplayer !== 'undefined' && Multiplayer.inRoom()) { Toast.show('You\'re in a multiplayer room', 'Leave the room to play on your own.'); return; }
    this._resumeMusic = false;
    this.stopPreview();
    this.closeSet();
    SongSelect.selectedId = m.id;
    SongSelect.preview(m);
    Screens.go('songselect', { mapId: m.id });
  },
  stopPreview() {
    if (this.audio) { this.audio.pause(); this.audio = null; }
    this.previewId = null;
    if (this._resumeMusic && Music.loaded && !Music.playing) Music.play(Music.pausedPos, { fadeIn: 300 });
    this._resumeMusic = false;
  },
};

/** The online status (RANKED, LOVED, …) of beatmaps imported from files: looked up in the background for every set
 *  that has an online id and no status yet, one at a time, and kept with the set. */
const BeatmapStatus = {
  busy: false,
  async sync() {
    if (this.busy || !navigator.onLine) return;
    this.busy = true;
    let changed = 0;
    try {
      const todo = BeatmapManager.sets.filter(s => s.onlineId > 0 && !s.status && !s.statusChecked).slice(0, 200);
      for (const set of todo) {
        if (Screens.currentName === 'gameplay') { await sleep(5000); continue; } // (never during a song)
        let st = null;
        try { const d = await OnlineBeatmaps.getSet(set.onlineId); st = d && d.status; } catch (e) { if (e && e.status === 429) break; }
        set.statusChecked = Date.now();
        if (st) { set.status = st; changed++; }
        await DB.put('sets', { ...set, maps: undefined }).catch(() => {});
        await sleep(700);
      }
    } finally { this.busy = false; }
    if (changed) Bus.emit('library:changed');
  },
};
