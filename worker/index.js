/* Ashtonk!mania — Cloudflare Worker.
 * Serves the static client from ./public (ASSETS binding) and provides a small same-origin API so the
 * beatmap explorer works without CORS problems:
 *   GET /api/health                     → { ok, official, multiplayer }
 *   GET /api/search?q&keys&status&sort&cursor&page&minStars&maxStars&nsfw&g&l → { sets, cursor, hasMore, source }
 *   GET /api/download/:setId            → the .osz (proxied from the first mirror that has it)
 *
 * Browsing works like Web-Osu-Mania's home screen (MIT © 2024 Danny Duong, src/routes/api/getBeatmaps.ts and
 * src/lib/osuApi.ts): with OSU_CLIENT_ID / OSU_CLIENT_SECRET set (`npx wrangler secret put …`), a search is the official
 * osu! API v2 beatmapsets/search with exactly the parameters WOM sends — q (with stars>= / stars<= / key filters),
 * m=3, s (category, left out for "Has leaderboard"), nsfw, g (genre), l (language), sort only when it isn't the
 * default (so osu! picks relevance for text searches) and cursor_string paging — cached for an hour. If osu!
 * rate-limits, the Worker backs off for Retry-After (or 5 minutes) like WOM and answers from the mirrors meanwhile.
 * Without credentials the public mirrors are searched. Downloads always come from mirrors. */

const PAGE_SIZE = 40;
const UA = { 'User-Agent': 'Ashtonk!mania beatmap explorer (+https://github.com/ashtonkehler14-glitch/Ashtonk-mania)' };

export const MIRRORS = {
  search: [
    // (sort is osu!'s "<criteria>_<asc|desc>", e.g. ranked_desc — the default, as on osu! and Web-Osu-Mania)
    { name: 'Mino (catboy.best)', url: p => `https://catboy.best/api/v2/search?q=${enc(p.q)}&query=${enc(p.q)}&mode=3&m=3&limit=${PAGE_SIZE}&offset=${p.page * PAGE_SIZE}${specificStatus(p) ? `&status=${statusNum(p.status)}&s=${p.status}` : ''}${sortQ(p)}` },
    { name: 'NeriNyan', url: p => `https://api.nerinyan.moe/search?q=${enc(p.q)}&m=3&ps=${PAGE_SIZE}&p=${p.page}${specificStatus(p) ? `&s=${p.status}` : p.status === 'leaderboard' ? '&s=ranked,approved,qualified,loved' : '&s=all'}${sortQ(p)}&nsfw=${p.nsfw !== false}${p.genre ? `&g=${p.genre}` : ''}${p.language ? `&l=${p.language}` : ''}` },
    { name: 'osu.direct', url: p => `https://osu.direct/api/v2/search?query=${enc(p.q)}&q=${enc(p.q)}&mode=3&amount=${PAGE_SIZE}&offset=${p.page * PAGE_SIZE}${specificStatus(p) ? `&status=${statusNum(p.status)}` : ''}${sortQ(p)}` },
  ],
  // Web-Osu-Mania's download providers (the explorer can ask for one to be tried first)
  download: [
    { id: 'mino', name: 'Mino (catboy.best)', url: id => `https://catboy.best/d/${id}` },
    { id: 'nerinyan', name: 'NeriNyan', url: id => `https://api.nerinyan.moe/d/${id}?noVideo=true` },
    { id: 'osudirect', name: 'osu.direct', url: id => `https://osu.direct/api/d/${id}` },
    { id: 'sayobot', name: 'SayoBot', url: id => `https://dl.sayobot.cn/beatmaps/download/novideo/${id}` },
    { id: 'nekoha', name: 'Nekoha', url: id => `https://mirror.nekoha.moe/api4/download/${id}` },
  ],
};

const enc = s => encodeURIComponent(s || '');
const sortQ = p => p.sort ? `&sort=${p.sort}` : '';
const STATUS_NUM = { ranked: 1, approved: 2, qualified: 3, loved: 4, pending: 0, wip: -1, graveyard: -2 };
const statusNum = s => STATUS_NUM[s] ?? 1;
/** "Has leaderboard" (osu!'s default category) and "Any" aren't a single status on the mirrors. */
const specificStatus = p => p.status !== 'any' && p.status !== 'leaderboard';
const LEADERBOARD = new Set(['ranked', 'approved', 'qualified', 'loved']);
export const SORT_CRITERIA = ['title', 'artist', 'difficulty', 'ranked', 'rating', 'plays', 'favourites', 'relevance', 'updated'];
const DEFAULT_SORT = 'ranked_desc';
const STATUS_NAME = { '-2': 'graveyard', '-1': 'wip', 0: 'pending', 1: 'ranked', 2: 'approved', 3: 'qualified', 4: 'loved' };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...extra } });

/** Normalise the many beatmap-set shapes (osu! API v2, mirrors) into one compact form; mania only. */
export function normalizeSet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = Number(raw.id ?? raw.beatmapset_id ?? raw.SetID ?? raw.setId);
  if (!id) return null;
  const diffs = (raw.beatmaps || raw.ChildrenBeatmaps || raw.children || []).map(b => ({
    id: Number(b.id ?? b.beatmap_id ?? b.BeatmapID ?? 0),
    mode: b.mode_int ?? (typeof b.mode === 'number' ? b.mode : b.mode === 'mania' ? 3 : b.Mode ?? (b.mode === undefined ? 3 : -1)),
    version: String(b.version ?? b.DiffName ?? b.diff_name ?? 'Normal'),
    stars: Number(b.difficulty_rating ?? b.DifficultyRating ?? b.stars ?? 0),
    keys: Math.round(Number(b.cs ?? b.CS ?? b.circle_size ?? 4)),
    od: Number(b.accuracy ?? b.OD ?? 0), hp: Number(b.drain ?? b.HP ?? 0),
    bpm: Number(b.bpm ?? b.BPM ?? raw.bpm ?? 0),
    length: Number(b.total_length ?? b.TotalLength ?? b.hit_length ?? 0),
    notes: Number(b.count_circles ?? b.CountNormal ?? 0), lns: Number(b.count_sliders ?? b.CountSlider ?? 0),
  })).filter(d => Number(d.mode) === 3).sort((a, b) => a.stars - b.stars);
  if (!diffs.length) return null;
  const st = raw.status ?? raw.ranked ?? raw.RankedStatus;
  return {
    id, title: String(raw.title ?? raw.Title ?? ''), titleUnicode: String(raw.title_unicode ?? raw.title ?? raw.Title ?? ''),
    artist: String(raw.artist ?? raw.Artist ?? ''), artistUnicode: String(raw.artist_unicode ?? raw.artist ?? raw.Artist ?? ''),
    creator: String(raw.creator ?? raw.Creator ?? ''), source: String(raw.source ?? raw.Source ?? ''),
    status: typeof st === 'number' || /^-?\d+$/.test(String(st)) ? (STATUS_NAME[st] || 'pending') : String(st || 'pending'),
    playCount: Number(raw.play_count ?? raw.PlayCount ?? 0), favourites: Number(raw.favourite_count ?? raw.Favourites ?? 0),
    video: !!(raw.video ?? raw.HasVideo), nsfw: !!raw.nsfw,
    rankedDate: raw.ranked_date ?? raw.RankedDate ?? raw.approved_date ?? raw.ApprovedDate ?? null,
    lastUpdated: raw.last_updated ?? raw.LastUpdate ?? raw.submitted_date ?? null,
    rating: setRating(raw),
    genreId: raw.genre_id ?? raw.genre?.id ?? null, languageId: raw.language_id ?? raw.language?.id ?? null,
    diffs,
  };
}
/** Average user rating (0–10). osu! sends `rating`, some mirrors only the vote counts (`ratings`, index = score). */
function setRating(raw) {
  const r = Number(raw.rating ?? raw.Rating);
  if (r > 0) return r;
  const v = raw.ratings;
  if (Array.isArray(v)) {
    let n = 0, sum = 0;
    v.forEach((c, i) => { if (i > 0) { n += Number(c) || 0; sum += i * (Number(c) || 0); } });
    if (n) return sum / n;
  }
  return 0;
}
export function normalizeList(data) {
  const arr = Array.isArray(data) ? data : (data && (data.beatmapsets || data.data || data.results || data.sets)) || [];
  return arr.map(normalizeSet).filter(Boolean);
}

const timeout = ms => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

let officialToken = null;
/** Web-Osu-Mania's optional proxy for the osu! API (OSU_API_PROXY_URL / OSU_API_PROXY_KEY): Workers share IP addresses,
 *  so osu! can rate-limit them for other people's requests; a proxy with its own address avoids that. */
const osuBase = env => (env && env.OSU_API_PROXY_URL ? String(env.OSU_API_PROXY_URL).replace(/\/+$/, '') : 'https://osu.ppy.sh');
const proxyKey = env => (env && env.OSU_API_PROXY_KEY ? { 'X-Proxy-Key': env.OSU_API_PROXY_KEY } : {});
async function getOfficialToken(env, fetchImpl) {
  if (officialToken && officialToken.exp > Date.now() + 60000) return officialToken.value;
  const r = await fetchImpl(`${osuBase(env)}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...proxyKey(env) },
    body: JSON.stringify({ client_id: Number(env.OSU_CLIENT_ID), client_secret: env.OSU_CLIENT_SECRET, grant_type: 'client_credentials', scope: 'public' }),
  });
  if (!r.ok) throw new Error(`osu! OAuth failed (${r.status}${r.status === 401 ? ': check OSU_CLIENT_ID / OSU_CLIENT_SECRET' : ''}) ${(await r.text().catch(() => '')).slice(0, 120)}`);
  const d = await r.json();
  officialToken = { value: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return officialToken.value;
}

/** Search params → query understood by osu!/mirrors (keys & stars are osu! search syntax, as WOM sends them). */
export function buildParams(url) {
  const sp = url.searchParams;
  const keys = [...new Set((sp.get('keys') || '').split(',').map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 18))].sort((a, b) => a - b);
  const minStars = parseFloat(sp.get('minStars') || '0') || 0, maxStars = parseFloat(sp.get('maxStars') || '0') || 0;
  // one "key=N" per key count, exactly as Web-Osu-Mania's getBeatmapSets() writes them
  const keyQ = keys.map(k => `key=${k}`);
  const extra = [minStars > 0 ? `stars>=${minStars}` : '', maxStars > 0 ? `stars<=${maxStars}` : '', ...keyQ].filter(Boolean);
  const rawQ = (sp.get('q') || '').slice(0, 200).trim();
  const int = (k, lo, hi) => { const v = parseInt(sp.get(k) || '', 10); return v >= lo && v <= hi ? v : null; };
  const sort = sp.get('sort') ? validSort(sp.get('sort')) : null;
  return {
    q: [...extra, rawQ].filter(Boolean).join(' '),
    rawQ,
    keys, status: STATUSES.includes(sp.get('status')) ? sp.get('status') : 'leaderboard',
    // null = the default order, which osu! chooses (relevance for text searches, updated for pending/WIP/graveyard)
    sort: sort === DEFAULT_SORT ? null : sort,
    page: Math.max(0, Math.min(200, parseInt(sp.get('page') || '0', 10) || 0)),
    minStars, maxStars: maxStars || 99,
    cursor: (sp.get('cursor') || '').slice(0, 500),
    nsfw: sp.get('nsfw') !== 'false',
    genre: int('g', 1, 20), language: int('l', 1, 20),
    // the mirror that served page 0 serves the following pages too, so the order stays consistent
    loose: sp.get('loose') === '1',
    provider: Math.max(0, Math.min(MIRRORS.search.length - 1, parseInt(sp.get('provider') || '0', 10) || 0)),
  };
}
const STATUSES = ['any', 'leaderboard', 'ranked', 'qualified', 'loved', 'pending', 'wip', 'graveyard'];
/** "<criteria>_<asc|desc>" (osu! API / Web-Osu-Mania); anything else falls back to ranked_desc. */
export function validSort(s) {
  const m = /^([a-z]+)_(asc|desc)$/.exec(s || '');
  return m && SORT_CRITERIA.includes(m[1]) ? s : DEFAULT_SORT;
}
/** The order a default search has on osu! (BeatmapsetSearchRequestParams::getDefaultSortField). */
export function effectiveSort(p) {
  if (p.sort) return p.sort;
  if (p.rawQ) return 'relevance_desc';
  if (['pending', 'wip', 'graveyard'].includes(p.status)) return 'updated_desc';
  return DEFAULT_SORT;
}
/** How well a set matches the search words (for "relevance" when a mirror can't order by it). */
export function relevance(set, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(w => w && !/[<>=]/.test(w));
  if (!words.length) return 0;
  const title = `${set.title} ${set.titleUnicode}`.toLowerCase(), artist = `${set.artist} ${set.artistUnicode}`.toLowerCase();
  const other = `${set.creator} ${set.source} ${set.diffs.map(d => d.version).join(' ')}`.toLowerCase();
  const phrase = words.join(' ');
  let score = set.title.toLowerCase() === phrase ? 40 : title.includes(phrase) ? 20 : artist.includes(phrase) ? 12 : 0;
  for (const w of words) score += title.includes(w) ? 6 : artist.includes(w) ? 4 : other.includes(w) ? 2 : 0;
  return score;
}
/** Order a page ourselves when the mirror couldn't sort by the chosen criterion (stable). */
export function localSort(sets, sort, q) {
  const [crit, dir] = sort.split('_');
  const date = s => Date.parse(s.rankedDate || s.lastUpdated || '') || 0;
  const key = {
    title: s => s.title.toLowerCase(), artist: s => s.artist.toLowerCase(), difficulty: s => s.diffs[0] ? s.diffs[0].stars : 0,
    ranked: date, rating: s => s.rating || 0, plays: s => s.playCount || 0, favourites: s => s.favourites || 0,
    relevance: s => relevance(s, q), updated: s => Date.parse(s.lastUpdated || s.rankedDate || '') || 0,
  }[crit];
  if (!key) return sets;
  const sign = dir === 'asc' ? 1 : -1;
  return sets.map((s, i) => [s, key(s), i]).sort((a, b) => {
    const c = typeof a[1] === 'string' ? a[1].localeCompare(b[1]) : a[1] - b[1];
    return c ? c * sign : a[2] - b[2];
  }).map(e => e[0]);
}
/** Sorts to try on a mirror: the chosen one, then one every mirror accepts. Mirrors differ on "rating" and
 *  "relevance" (some reject them outright); relevance is their default order for a text search anyway. */
export function sortAttempts(p) {
  const want = effectiveSort(p);
  if (want.startsWith('relevance')) return p.rawQ ? [null, DEFAULT_SORT] : [DEFAULT_SORT];
  return want === DEFAULT_SORT ? [DEFAULT_SORT] : [want, null];
}
export function postFilter(sets, p) {
  const statusOk = s => p.status === 'any' ? true : p.status === 'leaderboard' ? LEADERBOARD.has(s.status)
    : p.status === 'ranked' ? s.status === 'ranked' || s.status === 'approved' : s.status === p.status;
  // genre / language / NSFW: osu! filters these itself; mirrors that ignore them are filtered here when they say
  const extraOk = s => (p.nsfw !== false || !s.nsfw) && (!p.genre || s.genreId == null || s.genreId === p.genre)
    && (!p.language || s.languageId == null || s.languageId === p.language);
  return sets.filter(s => statusOk(s) && extraOk(s))
    .map(s => ({ ...s, diffs: s.diffs.filter(d => (!p.keys.length || p.keys.includes(d.keys)) && d.stars >= p.minStars - 0.005 && d.stars <= p.maxStars + 0.005) }))
    .filter(s => s.diffs.length);
}

/** osu! API state shared by requests in this isolate: the back-off after a 429 and an hour-long result cache. */
export const osuApi = { blockedUntil: 0, cache: new Map() };
const CACHE_TTL = 3600 * 1000;
function cacheGet(key) {
  const c = osuApi.cache.get(key);
  if (!c) return null;
  if (Date.now() - c.at > CACHE_TTL) { osuApi.cache.delete(key); return null; }
  return c.data;
}
function cachePut(key, data) {
  osuApi.cache.set(key, { at: Date.now(), data });
  while (osuApi.cache.size > 300) osuApi.cache.delete(osuApi.cache.keys().next().value);
}
/** The osu! API search parameters, exactly as Web-Osu-Mania's getBeatmapSets() builds them (sorted, for caching). */
export function officialParams(p) {
  const qs = new URLSearchParams();
  if (p.q) qs.set('q', p.q);
  qs.set('m', '3');
  if (p.sort) qs.set('sort', p.sort);
  if (p.cursor) qs.set('cursor_string', p.cursor);
  if (p.status !== 'leaderboard') qs.set('s', p.status);
  qs.set('nsfw', String(p.nsfw));
  if (p.genre) qs.set('g', String(p.genre));
  if (p.language) qs.set('l', String(p.language));
  qs.sort();
  return qs;
}
async function searchOfficial(p, env, fetchImpl) {
  const qs = officialParams(p), key = qs.toString();
  let d = cacheGet(key);
  if (!d) {
    if (Date.now() < osuApi.blockedUntil) throw new Error(`rate-limited by osu!, retrying in ${Math.ceil((osuApi.blockedUntil - Date.now()) / 1000)}s`);
    const token = await getOfficialToken(env, fetchImpl);
    const r = await fetchImpl(`${osuBase(env)}/api/v2/beatmapsets/search?${qs}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...UA, ...proxyKey(env) }, signal: timeout(10000) });
    if (r.status === 429) {
      // like WOM: stop asking for Retry-After seconds (5 minutes if osu! doesn't say)
      osuApi.blockedUntil = Date.now() + (Number(r.headers.get('Retry-After')) || 300) * 1000;
      throw new Error('rate-limited by osu! (429)');
    }
    if (r.status === 401) officialToken = null; // expired / revoked token: fetch a new one next time
    if (!r.ok) throw new Error(`osu! API ${r.status} ${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120)}`);
    const raw = await r.json();
    d = { sets: normalizeList(raw), cursor: raw.cursor_string || null, total: raw.total ?? null };
    cachePut(key, d);
  }
  return json({ sets: postFilter(d.sets, p), page: p.page, hasMore: !!d.cursor, cursor: d.cursor, total: d.total, source: 'osu! API' }, 200, { 'Cache-Control': 'public, max-age=3600' });
}

export async function handleSearch(url, env, fetchImpl = fetch) {
  const p = buildParams(url);
  const errors = [];
  if (env && env.OSU_CLIENT_ID && env.OSU_CLIENT_SECRET) {
    try { return await searchOfficial(p, env, fetchImpl); } catch (e) { errors.push(`osu! API: ${e.message}`); }
  }
  const order = MIRRORS.search.map((_, i) => (i + p.provider) % MIRRORS.search.length);
  const want = effectiveSort(p), attempts = sortAttempts(p);
  for (const [n, i] of order.entries()) {
    const m = MIRRORS.search[i];
    // mirrors that don't understand osu!'s "key=4 stars>=3" filters in the search text find nothing with them: those
    // are asked again with just the words, and the keys and stars are filtered here (postFilter) instead
    // (later pages ask for the same kind of search as the first page got: "loose")
    const tries = attempts.map(sort => [sort, p.loose ? p.rawQ : p.q]);
    if (p.q !== p.rawQ && !p.loose) tries.push(...attempts.map(sort => [sort, p.rawQ]));
    for (const [k, [sort, q]] of tries.entries()) {
      const tag = `${m.name}${sort === want ? '' : ` (${sort || 'default order'})`}${q === p.q ? '' : ' (words only)'}`;
      try {
        const r = await fetchImpl(m.url({ ...p, sort, q }), { headers: { Accept: 'application/json', ...UA }, signal: timeout(9000) });
        // a mirror that's down (5xx, rate limit, blocked) is skipped; other 4xx may be the sort it doesn't accept
        if (!r.ok) { errors.push(`${tag}: HTTP ${r.status}`); if (r.status >= 500 || [403, 404, 429].includes(r.status)) break; continue; }
        const data = await r.json();
        const raw = normalizeList(data);
        if (!raw.length && data && !Array.isArray(data) && data.error) { errors.push(`${tag}: ${String(data.error).slice(0, 80)}`); continue; }
        // an empty first page: a sort the mirror ignored or rejected quietly, or this mirror just has nothing —
        // try the next order, then the next mirror
        if (!raw.length && p.page === 0 && k < tries.length - 1) { errors.push(`${tag}: no results`); continue; }
        if (!raw.length && p.page === 0 && p.rawQ && n < order.length - 1) { errors.push(`${tag}: no results`); break; }
        let sets = postFilter(raw, p);
        if (sort !== want) sets = localSort(sets, want, p.rawQ);
        return json({ sets, page: p.page, hasMore: raw.length >= PAGE_SIZE / 2, source: m.name, provider: i, sort: want, sortedLocally: sort !== want, wordsOnly: q !== p.q, errors }, 200, { 'Cache-Control': 'public, max-age=300' });
      } catch (e) { errors.push(`${tag}: ${e.message}`); break; } // unreachable / timed out: next mirror
    }
  }
  return json({ sets: [], page: p.page, hasMore: false, source: null, errors, error: 'All beatmap search providers failed.' }, 502);
}

export async function handleDownload(id, fetchImpl = fetch, provider = '') {
  if (!/^\d{1,9}$/.test(id)) return json({ error: 'Invalid beatmap set id' }, 400);
  const errors = [];
  const order = MIRRORS.download.slice().sort((a, b) => (b.id === provider) - (a.id === provider));
  for (const m of order) {
    try {
      // (a mirror that doesn't answer within 20 s is skipped instead of holding the download)
      const r = await fetchImpl(m.url(id), { headers: UA, redirect: 'follow', signal: timeout(20000) });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || /json|html|text/.test(ct)) { errors.push(`${m.name}: ${r.status}`); continue; }
      const headers = { 'Content-Type': 'application/x-osu-beatmap-archive', 'Content-Disposition': `attachment; filename="${id}.osz"`, 'X-Mirror': m.name, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' };
      const len = r.headers.get('content-length');
      if (len) headers['Content-Length'] = len;
      return new Response(r.body, { status: 200, headers });
    } catch (e) { errors.push(`${m.name}: ${e.message}`); }
  }
  return json({ error: 'No mirror could provide this beatmap set.', errors }, 502);
}

/** Web-Osu-Mania's /api/downloadBeatmap (src/routes/api/downloadBeatmap.ts): fetch destinationUrl and pass the body
 *  through. Only Web-Osu-Mania's beatmap providers are allowed, so it can't be used as an open proxy. */
const DOWNLOAD_HOSTS = new Set(['catboy.best', 'api.nerinyan.moe', 'dl.sayobot.cn', 'osu.direct', 'mirror.nekoha.moe']);
export async function handleProxyDownload(url, fetchImpl = fetch) {
  const dest = url.searchParams.get('destinationUrl');
  if (!dest) return json({ error: 'Missing "destinationUrl" query parameter.' }, 400);
  let d;
  try { d = new URL(dest); } catch { return json({ error: 'Invalid "destinationUrl".' }, 400); }
  if (d.protocol !== 'https:' || !DOWNLOAD_HOSTS.has(d.hostname)) return json({ error: 'That download source isn\'t allowed.' }, 403);
  try {
    const r = await fetchImpl(d.href, { method: 'GET', headers: UA, redirect: 'follow' });
    if (!r.ok) return json({ error: `Proxy fetch failed - ${r.statusText || r.status}` }, r.status >= 400 && r.status < 600 ? r.status : 500, r.headers.get('Retry-After') ? { 'Retry-After': r.headers.get('Retry-After') } : {});
    const headers = { 'Content-Type': r.headers.get('content-type') || 'application/x-osu-beatmap-archive', 'Access-Control-Allow-Origin': '*' };
    if (r.headers.get('content-length')) headers['Content-Length'] = r.headers.get('content-length');
    return new Response(r.body, { status: r.status, headers });
  } catch (e) { return json({ error: `Proxy fetch failed - ${e.message}` }, 500); }
}

/** Per-visitor search limit (Web-Osu-Mania allows 25 a minute; paging is cheap here, so 40), kept per isolate. */
const searchHits = new Map();
export function allowSearch(ip, now = Date.now(), limit = 40, windowMs = 60000) {
  if (!ip) return true;
  const hits = (searchHits.get(ip) || []).filter(t => now - t < windowMs);
  hits.push(now);
  searchHits.set(ip, hits);
  if (searchHits.size > 5000) searchHits.delete(searchHits.keys().next().value);
  return hits.length <= limit;
}

export { MatchRoom, Matchmaker } from './multiplayer.js';
import { handleMultiplayer } from './multiplayer.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ ok: true, official: !!(env.OSU_CLIENT_ID && env.OSU_CLIENT_SECRET), multiplayer: !!env.ROOMS });
    if (url.pathname === '/api/search') {
      if (!allowSearch(request.headers.get('cf-connecting-ip'))) return json({ error: 'Too many searches — slow down for a moment.' }, 429, { 'Retry-After': '30' });
      return handleSearch(url, env);
    }
    if (url.pathname === '/api/downloadBeatmap') return handleProxyDownload(url);
    const dl = /^\/api\/download\/(\d+)(?:\.osz)?$/.exec(url.pathname);
    if (dl) return handleDownload(dl[1], fetch, url.searchParams.get('provider') || '');
    if (url.pathname.startsWith('/api/mp/')) return handleMultiplayer(request, env, url);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
