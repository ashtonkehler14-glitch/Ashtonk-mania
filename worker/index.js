/* Ashtonk!mania — Cloudflare Worker.
 * Serves the static client from ./public (ASSETS binding) and a small same-origin API:
 *   GET /api/health                                   → { ok, official, osuApps, proxy, multiplayer }
 *   GET /api/getBeatmaps?q&m&sort&cursor_string&s&nsfw&g&l&e → the osu! API's beatmapsets/search answer
 *   GET /api/getBeatmap?beatmapSetId=…                → one beatmap set from the osu! API
 *   GET /api/downloadBeatmap?destinationUrl=…         → an .osz from one of Web-Osu-Mania's download mirrors
 *   GET /api/download/:setId                          → the .osz from the first mirror that has it
 *
 * Beatmaps are listed exactly as Web-Osu-Mania's home screen lists them (MIT © 2024 Danny Duong,
 * src/routes/api/getBeatmaps.ts, getBeatmap.ts and -utils.ts): from the official osu! API v2, logged in with an osu!
 * OAuth app (OSU_CLIENT_ID / OSU_CLIENT_SECRET, `npx wrangler secret put …`; optionally a second app as
 * OSU_CLIENT_ID_2 / OSU_CLIENT_SECRET_2), passing on only WOM's parameters, keeping each answer for an hour and asking
 * no more for Retry-After (or 5 minutes) once osu! answers 429. Like WOM it can go through a proxy with its own IP
 * address (OSU_API_PROXY_URL / OSU_API_PROXY_KEY): Workers share addresses, so osu! can rate-limit them for other
 * people's requests. The mirrors are only for downloading beatmaps, never for listing them. */

const UA = { 'User-Agent': 'Ashtonk!mania beatmap explorer (+https://github.com/ashtonkehler14-glitch/Ashtonk-mania)' };

// Web-Osu-Mania's download providers (the explorer can ask for one to be tried first)
export const MIRRORS = {
  download: [
    { id: 'mino', name: 'Mino (catboy.best)', url: id => `https://catboy.best/d/${id}` },
    { id: 'nerinyan', name: 'NeriNyan', url: id => `https://api.nerinyan.moe/d/${id}?noVideo=true` },
    { id: 'osudirect', name: 'osu.direct', url: id => `https://osu.direct/api/d/${id}` },
    { id: 'sayobot', name: 'SayoBot', url: id => `https://dl.sayobot.cn/beatmaps/download/novideo/${id}` },
    { id: 'nekoha', name: 'Nekoha', url: id => `https://mirror.nekoha.moe/api4/download/${id}` },
  ],
};

const cors = { 'Access-Control-Allow-Origin': '*' };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors, ...extra } });
/** WOM answers a failed request with the message as plain text (and as the status text). */
const text = (msg, status) => new Response(msg, { status, statusText: status === 200 ? 'OK' : msg.replace(/[^\x20-\x7e]/g, '').slice(0, 200), headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors } });
const timeout = ms => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

/** Web-Osu-Mania's getBeatmaps: only these parameters are passed on to osu!. */
const KEEP_KEYS = new Set(['q', 'm', 'sort', 'cursor_string', 's', 'nsfw', 'g', 'l', 'e']); // (e: extra — has video / storyboard)
/** WOM's getRateLimitMessage. */
export const rateLimitMessage = retryAfter => `The site is being rate-limited by the osu! API, please try again ${retryAfter ? `after ${retryAfter} seconds` : 'later'}.`;
const STATUS_MESSAGES = {
  404: 'That beatmap set doesn\'t exist on osu!.',
  500: 'The osu! API ran into an error, try again later.',
  503: 'The osu! API is currently unavailable, try again later.',
  504: 'The request to the osu! API timed out.',
};
/** An osu! API failure, with the HTTP status the browser gets (as WOM answers it). */
export class OsuApiError extends Error { constructor(status, message) { super(message); this.status = status; } }

/** WOM's trimBeatmapSet (only what the listing uses is kept and cached), plus the few things the explorer's cards show. */
export function trimBeatmapSet(s) {
  return {
    artist: s.artist, artist_unicode: s.artist_unicode, creator: s.creator, id: s.id, nsfw: s.nsfw, offset: s.offset,
    status: s.status, title: s.title, title_unicode: s.title_unicode, user_id: s.user_id, play_count: s.play_count,
    favourite_count: s.favourite_count, rating: s.rating, genre_id: s.genre_id, language_id: s.language_id,
    source: s.source, video: s.video, ranked_date: s.ranked_date, last_updated: s.last_updated,
    beatmaps: (Array.isArray(s.beatmaps) ? s.beatmaps : []).map(b => ({
      beatmapset_id: b.beatmapset_id, difficulty_rating: b.difficulty_rating, id: b.id, mode: b.mode, total_length: b.total_length,
      user_id: b.user_id, version: b.version, bpm: b.bpm, cs: b.cs, accuracy: b.accuracy, drain: b.drain,
      count_circles: b.count_circles, count_sliders: b.count_sliders,
    })),
  };
}

/** The osu! OAuth apps to log in with: OSU_CLIENT_ID / OSU_CLIENT_SECRET, and optionally a second one
 *  (OSU_CLIENT_ID_2 / OSU_CLIENT_SECRET_2) that takes over while osu! is refusing the first. */
export function osuCredentials(env) {
  const out = [];
  if (env && env.OSU_CLIENT_ID && env.OSU_CLIENT_SECRET) out.push({ id: env.OSU_CLIENT_ID, secret: env.OSU_CLIENT_SECRET, name: 'OSU_CLIENT_ID' });
  if (env && env.OSU_CLIENT_ID_2 && env.OSU_CLIENT_SECRET_2) out.push({ id: env.OSU_CLIENT_ID_2, secret: env.OSU_CLIENT_SECRET_2, name: 'OSU_CLIENT_ID_2' });
  return out;
}
// per app: its login token and how long osu! asked us to leave it alone
let logins = [];
/** Web-Osu-Mania's optional proxy for the osu! API (OSU_API_PROXY_URL / OSU_API_PROXY_KEY): Workers share IP addresses,
 *  so osu! can rate-limit them for other people's requests; a proxy with its own address avoids that. */
const osuBase = env => (env && env.OSU_API_PROXY_URL ? String(env.OSU_API_PROXY_URL).replace(/\/+$/, '') : 'https://osu.ppy.sh');
const proxyKey = env => (env && env.OSU_API_PROXY_KEY ? { 'X-Proxy-Key': env.OSU_API_PROXY_KEY } : {});
/** (tests) forget the osu! logins, back-off and cached answers */
export function resetOsuLogin() { logins = []; osuApi.blockedUntil = 0; osuApi.cache.clear(); osuApi.store = null; }
/** The osu! logins and back-off, to keep in Durable Object storage: they survive the object being restarted, so a login
 *  is asked for about once a day (osu! limits logins per address, and Workers share addresses). */
export const osuLoginState = {
  get: () => ({ logins: logins.map(l => ({ token: l.token, blockedUntil: l.blockedUntil })), blockedUntil: osuApi.blockedUntil, lastError: osuApi.lastError }),
  set: st => {
    if (!st) return;
    if (st.lastError && !osuApi.lastError) osuApi.lastError = st.lastError;
    if (Array.isArray(st.logins) && !logins.length) logins = st.logins.map(l => ({ token: l && l.token && l.token.exp > Date.now() + 60000 ? l.token : null, blockedUntil: Number(l && l.blockedUntil) || 0 }));
    if (st.blockedUntil > osuApi.blockedUntil) osuApi.blockedUntil = st.blockedUntil;
  },
};
/** A login token for the first app osu! isn't refusing: { i, token } (WOM's getAccessToken, kept until it expires). */
async function getOfficialToken(env, fetchImpl) {
  const creds = osuCredentials(env);
  if (!creds.length) throw new OsuApiError(503, 'The game\'s server has no osu! API key yet, so it can\'t list beatmaps. Add one as OSU_CLIENT_ID and OSU_CLIENT_SECRET (see the README).');
  let lastErr = null;
  for (let i = 0; i < creds.length; i++) {
    const L = logins[i] || (logins[i] = { token: null, blockedUntil: 0 });
    if (L.token && L.token.exp > Date.now() + 60000) return { i, token: L.token.value };
    if (Date.now() < L.blockedUntil) { lastErr = new OsuApiError(429, rateLimitMessage(Math.ceil((L.blockedUntil - Date.now()) / 1000))); continue; }
    // (one login request per app at a time: searches arriving together wait for the same one)
    if (!L.pending) L.pending = (async () => {
      const c = creds[i];
      let r;
      try {
        r = await fetchImpl(`${osuBase(env)}/oauth/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...proxyKey(env) },
          body: JSON.stringify({ client_id: Number(c.id), client_secret: c.secret, grant_type: 'client_credentials', scope: 'public' }),
          signal: timeout(10000),
        });
      } catch (e) { throw new OsuApiError(504, STATUS_MESSAGES[504]); }
      if (!r.ok) await noteRefusal('login', r);
      if (r.status === 429) {
        // osu! is limiting this app's logins: leave it alone for a while (the next app is tried meanwhile)
        const wait = Number(r.headers.get('Retry-After')) || 300;
        L.blockedUntil = Date.now() + wait * 1000;
        throw new OsuApiError(429, rateLimitMessage(wait));
      }
      if (!r.ok) throw new OsuApiError(r.status >= 500 ? r.status : 500, r.status === 400 || r.status === 401
        ? `The game's server couldn't log in to osu! with ${c.name} (${r.status}): check the client ID and secret.`
        : `The game's server couldn't log in to osu! (${r.status}).`);
      const d = await r.json();
      L.token = { value: d.access_token, exp: Date.now() + d.expires_in * 1000 };
      return L.token.value;
    })().finally(() => { L.pending = null; });
    try { return { i, token: await L.pending }; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** osu! API state shared by the requests this copy answers: the back-off after a 429, the answers of the last hour,
 *  and (in the Durable Object) `store`, which keeps those answers when the object restarts. */
export const osuApi = { blockedUntil: 0, cache: new Map(), store: null, lastError: null };
/** What osu! said the last time it refused (for /api/health): the login or the search, the status, how long it asked us
 *  to wait, and the start of its answer — "Too Many Attempts." is osu!'s own limit, a Cloudflare page (error 1015)
 *  means the shared Workers address is being limited. */
async function noteRefusal(where, r) {
  const body = (await r.clone().text().catch(() => '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  osuApi.lastError = { where, status: r.status, retryAfter: r.headers.get('Retry-After'), server: r.headers.get('server'), at: new Date().toISOString(), body };
}
/** The osu! connection's state, for /api/health. */
export function osuStatus() {
  const left = t => Math.max(0, Math.ceil((t - Date.now()) / 1000));
  return { waitingSeconds: left(osuApi.blockedUntil), apps: logins.map(l => ({ loggedIn: !!(l.token && l.token.exp > Date.now()), waitingSeconds: left(l.blockedUntil) })), lastRefusal: osuApi.lastError };
}
const SEARCH_TTL = 3600 * 1000, SET_TTL = 86400 * 1000; // (WOM's KV expiries: an hour, a set a day)
const STALE_MAX = 7 * 86400 * 1000;
const OSU_PATH = /^(?:beatmapsets\/(?:search\?[^#]*|\d{1,10})|beatmaps\/(?:\d{1,10}|lookup\?checksum=[a-f0-9]{32}))$/;
function remember(key, e) {
  osuApi.cache.delete(key); osuApi.cache.set(key, e);
  while (osuApi.cache.size > 200) osuApi.cache.delete(osuApi.cache.keys().next().value);
}
/** One request to the osu! API v2 (`path` is "beatmapsets/search?…" or "beatmapsets/<id>"), trimmed as WOM trims it. */
async function askOsu(path, env, fetchImpl, retried = false) {
  if (Date.now() < osuApi.blockedUntil) throw new OsuApiError(429, rateLimitMessage());
  const { i, token } = await getOfficialToken(env, fetchImpl);
  let r;
  try {
    r = await fetchImpl(`${osuBase(env)}/api/v2/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...UA, ...proxyKey(env) }, signal: timeout(10000) });
  } catch (e) { throw new OsuApiError(504, STATUS_MESSAGES[504]); }
  if (r.ok) {
    const d = await r.json().catch(() => null);
    if (!d || typeof d !== 'object') throw new OsuApiError(500, STATUS_MESSAGES[500]);
    if (!path.startsWith('beatmapsets/search')) return trimBeatmapSet(d);
    return { beatmapsets: (Array.isArray(d.beatmapsets) ? d.beatmapsets : []).map(trimBeatmapSet), search: d.search, total: d.total, cursor_string: d.cursor_string || null };
  }
  await noteRefusal('search', r);
  const retryAfter = Number(r.headers.get('Retry-After')) || 0;
  if (r.status === 429) {
    // (another app can carry on while this one waits; with none left, stop asking — like WOM — for Retry-After or 5 min)
    const wait = (retryAfter || 300) * 1000;
    logins[i].blockedUntil = Date.now() + wait; logins[i].token = null;
    if (osuCredentials(env).some((_, k) => k !== i && Date.now() >= ((logins[k] || {}).blockedUntil || 0))) return askOsu(path, env, fetchImpl, retried);
    osuApi.blockedUntil = Date.now() + wait;
    throw new OsuApiError(429, rateLimitMessage(retryAfter));
  }
  // an expired or revoked token: log in again once
  if (r.status === 401 && !retried) { logins[i].token = null; return askOsu(path, env, fetchImpl, true); }
  throw new OsuApiError(r.status, STATUS_MESSAGES[r.status] ?? 'An unknown error occurred.');
}
/** An osu! API answer: from the last hour's (a set: the last day's) answers, or osu! itself. While osu! refuses or is
 *  down, an older answer to the same request (up to a week old) is given rather than an error. Runs in one shared
 *  place (the "osu-api" Durable Object) on the live server, so every request shares one login, cache and back-off. */
export async function officialGet(path, env, fetchImpl = fetch, ttl = SEARCH_TTL) {
  if (!OSU_PATH.test(path)) throw new OsuApiError(400, 'Bad request.');
  let hit = osuApi.cache.get(path) || null;
  if (!hit && osuApi.store) { hit = await osuApi.store.get(path); if (hit) remember(path, hit); }
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  try {
    const data = await askOsu(path, env, fetchImpl);
    const e = { at: Date.now(), data };
    remember(path, e);
    if (osuApi.store) await osuApi.store.put(path, e);
    return data;
  } catch (err) {
    if (hit && Date.now() - hit.at < STALE_MAX && (err.status === 429 || err.status >= 500)) return hit.data;
    throw err;
  }
}
async function osuRequest(path, ttl, env, fetchImpl) {
  if (env.MATCHMAKER && fetchImpl === fetch) {
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('osu-api'));
    const r = await stub.fetch(`https://osu-api/osu/get?ttl=${ttl}&path=${encodeURIComponent(path)}`);
    const body = await r.json().catch(() => null);
    if (!r.ok || !body) throw new OsuApiError(r.ok ? 500 : r.status, (body && body.error) || STATUS_MESSAGES[500]);
    return body;
  }
  return officialGet(path, env, fetchImpl, ttl);
}

/** While osu! refuses this server (Cloudflare's shared address gets its logins rate-limited), the same request goes to
 *  Web-Osu-Mania's own server, whose /api/getBeatmaps and /api/getBeatmap answer in exactly this format. Its answers are
 *  kept in Cloudflare's cache for an hour, so its server is asked as little as possible. */
const WOM_API = 'https://webosumania.com/api/';
export const womApi = { lastError: null };
async function fromWom(route, qs, fetchImpl) {
  let r;
  try {
    r = await fetchImpl(`${WOM_API}${route}?${qs}`, { headers: { Accept: 'application/json', ...UA }, signal: timeout(12000), cf: { cacheTtl: 3600, cacheEverything: true } });
  } catch (e) { womApi.lastError = { at: new Date().toISOString(), error: String(e && e.message || e).slice(0, 120) }; return null; }
  if (!r.ok) { womApi.lastError = { at: new Date().toISOString(), status: r.status, body: (await r.text().catch(() => '')).slice(0, 160) }; return null; }
  const d = await r.json().catch(() => null);
  if (!d || typeof d !== 'object') return null;
  womApi.lastError = null;
  return d;
}
/** osu! first; if it refuses or fails, Web-Osu-Mania's server; if that fails too, osu!'s error. */
async function listing(route, path, qs, ttl, env, fetchImpl) {
  try {
    return { data: await osuRequest(path, ttl, env, fetchImpl), source: 'osu!' };
  } catch (e) {
    if (e.status === 400 || e.status === 404) throw e;
    const d = await fromWom(route, qs, fetchImpl);
    if (d) return { data: d, source: 'webosumania.com' };
    throw e;
  }
}

/** Web-Osu-Mania's /api/getBeatmaps: the explorer's parameters (only WOM's, sorted so equal searches share a cached
 *  answer) go to osu!'s beatmapsets/search, and its answer comes back as it is. */
export async function handleGetBeatmaps(url, env, fetchImpl = fetch) {
  const params = new URLSearchParams(url.search);
  for (const k of [...new Set(params.keys())]) if (!KEEP_KEYS.has(k)) params.delete(k);
  params.sort();
  try {
    const { data, source } = await listing('getBeatmaps', `beatmapsets/search?${params}`, String(params), SEARCH_TTL, env, fetchImpl);
    return json(data, 200, { 'Cache-Control': 'public, max-age=3600', 'X-Beatmap-Source': source });
  } catch (e) { return text(e.message || STATUS_MESSAGES[500], e.status || 500); }
}
/** Web-Osu-Mania's /api/getBeatmap: one beatmap set by its id. */
export async function handleGetBeatmap(url, env, fetchImpl = fetch) {
  const id = url.searchParams.get('beatmapSetId') || '';
  if (!/^\d{1,10}$/.test(id)) return text('URL missing beatmapSetId', 400);
  try {
    const { data, source } = await listing('getBeatmap', `beatmapsets/${id}`, `beatmapSetId=${id}`, SET_TTL, env, fetchImpl);
    return json(data, 200, { 'Cache-Control': 'public, max-age=3600', 'X-Beatmap-Source': source });
  } catch (e) { return text(e.message || STATUS_MESSAGES[500], e.status || 500); }
}

/** A beatmap's set and ranked status, found by its beatmap id or its .osu file's MD5 (for files that don't say which
 *  set they're from): `/api/lookupBeatmap?id=` or `?checksum=`. */
export async function handleLookupBeatmap(url, env, fetchImpl = fetch) {
  const id = url.searchParams.get('id') || '', sum = (url.searchParams.get('checksum') || '').toLowerCase();
  const path = /^\d{1,10}$/.test(id) ? `beatmaps/${id}` : /^[a-f0-9]{32}$/.test(sum) ? `beatmaps/lookup?checksum=${sum}` : '';
  if (!path) return json({ error: 'Give a beatmap id or checksum.' }, 400);
  try {
    const b = await officialGet(path, env, fetchImpl, 7 * 86400000);
    const set = b && b.beatmapset;
    return json({ beatmapId: b.id || 0, setId: b.beatmapset_id || (set && set.id) || 0, status: String((set && set.status) || b.status || '') }, 200, { 'Cache-Control': 'public, max-age=86400' });
  } catch (e) { return json({ error: e.message || 'Not found' }, e.status === 404 ? 404 : e.status || 500); }
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
// (and the song preview hosts: phones play previews through Web Audio, which needs them fetched)
const DOWNLOAD_HOSTS = new Set(['catboy.best', 'api.nerinyan.moe', 'dl.sayobot.cn', 'osu.direct', 'mirror.nekoha.moe', 'b.ppy.sh', 'beatconnect.io', 'cdnx.sayobot.cn']);
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

/** Per-visitor limit on listing requests (Web-Osu-Mania allows 25 a minute; paging is cheap here, so 40), kept per isolate. */
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
    if (url.pathname === '/api/health') {
      let osu = null;
      if (env.MATCHMAKER) {
        try { osu = await (await env.MATCHMAKER.get(env.MATCHMAKER.idFromName('osu-api')).fetch('https://osu-api/osu/state')).json(); } catch { /* no state yet */ }
      }
      return json({ ok: true, official: osuCredentials(env).length > 0, osuApps: osuCredentials(env).length, proxy: !!env.OSU_API_PROXY_URL, multiplayer: !!env.ROOMS, osu, womFallbackError: womApi.lastError }, 200, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/api/getBeatmaps' || url.pathname === '/api/getBeatmap') {
      if (!allowSearch(request.headers.get('cf-connecting-ip'))) return text('Too many requests. Slow down!', 429);
      return url.pathname === '/api/getBeatmaps' ? handleGetBeatmaps(url, env) : handleGetBeatmap(url, env);
    }
    if (url.pathname === '/api/downloadBeatmap') return handleProxyDownload(url);
    if (url.pathname === '/api/lookupBeatmap') return handleLookupBeatmap(url, env);
    const dl = /^\/api\/download\/(\d+)(?:\.osz)?$/.exec(url.pathname);
    if (dl) return handleDownload(dl[1], fetch, url.searchParams.get('provider') || '');
    if (url.pathname.startsWith('/api/mp/')) return handleMultiplayer(request, env, url);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
