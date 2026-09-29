/* Ashtonk!mania — Cloudflare Worker.
 * Serves the static client from ./public (ASSETS binding) and provides a small same-origin API so the
 * beatmap explorer works without CORS problems:
 *   GET /api/health                     → { ok, official }
 *   GET /api/search?q&keys&status&sort&page&minStars&maxStars → { sets: [...normalized], page, hasMore, source }
 *   GET /api/download/:setId            → the .osz (proxied from the first mirror that has it)
 * Search uses the official osu! API when OSU_CLIENT_ID / OSU_CLIENT_SECRET secrets are configured
 * (wrangler secret put …), otherwise public mirrors. Downloads always come from mirrors. */

const PAGE_SIZE = 40;
const UA = { 'User-Agent': 'Ashtonk!mania beatmap explorer (+https://github.com/ashtonkehler14-glitch/Ashtonk-mania)' };

export const MIRRORS = {
  search: [
    { name: 'Mino (catboy.best)', url: p => `https://catboy.best/api/v2/search?q=${enc(p.q)}&query=${enc(p.q)}&mode=3&m=3&limit=${PAGE_SIZE}&offset=${p.page * PAGE_SIZE}${p.status !== 'any' ? `&status=${statusNum(p.status)}&s=${p.status}` : ''}${p.sort ? `&sort=${p.sort}` : ''}` },
    { name: 'NeriNyan', url: p => `https://api.nerinyan.moe/search?q=${enc(p.q)}&m=3&ps=${PAGE_SIZE}&p=${p.page}${p.status !== 'any' ? `&s=${p.status}` : '&s=all'}${p.sort ? `&sort=${p.sort}` : ''}&nsfw=true` },
    { name: 'osu.direct', url: p => `https://osu.direct/api/v2/search?query=${enc(p.q)}&q=${enc(p.q)}&mode=3&amount=${PAGE_SIZE}&offset=${p.page * PAGE_SIZE}${p.status !== 'any' ? `&status=${statusNum(p.status)}` : ''}${p.sort ? `&sort=${p.sort}` : ''}` },
  ],
  download: [
    { name: 'Mino (catboy.best)', url: id => `https://catboy.best/d/${id}` },
    { name: 'NeriNyan', url: id => `https://api.nerinyan.moe/d/${id}?noVideo=true` },
    { name: 'osu.direct', url: id => `https://osu.direct/api/d/${id}` },
    { name: 'SayoBot', url: id => `https://dl.sayobot.cn/beatmaps/download/novideo/${id}` },
  ],
};

const enc = s => encodeURIComponent(s || '');
const STATUS_NUM = { ranked: 1, approved: 2, qualified: 3, loved: 4, pending: 0, wip: -1, graveyard: -2 };
const statusNum = s => STATUS_NUM[s] ?? 1;
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
    rankedDate: raw.ranked_date ?? raw.RankedDate ?? null,
    diffs,
  };
}
export function normalizeList(data) {
  const arr = Array.isArray(data) ? data : (data && (data.beatmapsets || data.data || data.results || data.sets)) || [];
  return arr.map(normalizeSet).filter(Boolean);
}

let officialToken = null;
async function getOfficialToken(env, fetchImpl) {
  if (officialToken && officialToken.exp > Date.now() + 60000) return officialToken.value;
  const r = await fetchImpl('https://osu.ppy.sh/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: Number(env.OSU_CLIENT_ID), client_secret: env.OSU_CLIENT_SECRET, grant_type: 'client_credentials', scope: 'public' }),
  });
  if (!r.ok) throw new Error(`osu! OAuth failed (${r.status})`);
  const d = await r.json();
  officialToken = { value: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return officialToken.value;
}

/** Search params → query understood by osu!/mirrors (keys & stars are also osu! search syntax). */
export function buildParams(url) {
  const sp = url.searchParams;
  const keys = (sp.get('keys') || '').split(',').map(Number).filter(n => n >= 1 && n <= 18);
  const extra = [
    ...keys.length === 1 ? [`key=${keys[0]}`] : [],
    sp.get('minStars') ? `stars>=${Number(sp.get('minStars'))}` : '',
    sp.get('maxStars') ? `stars<=${Number(sp.get('maxStars'))}` : '',
  ].filter(Boolean);
  return {
    q: [(sp.get('q') || '').slice(0, 200), ...extra].filter(Boolean).join(' '),
    rawQ: (sp.get('q') || '').slice(0, 200),
    keys, status: sp.get('status') || 'ranked', sort: sp.get('sort') || '',
    page: Math.max(0, Math.min(200, parseInt(sp.get('page') || '0', 10) || 0)),
    minStars: parseFloat(sp.get('minStars') || '0') || 0, maxStars: parseFloat(sp.get('maxStars') || '99') || 99,
    cursor: sp.get('cursor') || '',
  };
}
export function postFilter(sets, p) {
  return sets.map(s => ({ ...s, diffs: s.diffs.filter(d => (!p.keys.length || p.keys.includes(d.keys)) && d.stars >= p.minStars - 0.005 && d.stars <= p.maxStars + 0.005) }))
    .filter(s => s.diffs.length);
}

export async function handleSearch(url, env, fetchImpl = fetch) {
  const p = buildParams(url);
  const errors = [];
  if (env && env.OSU_CLIENT_ID && env.OSU_CLIENT_SECRET) {
    try {
      const token = await getOfficialToken(env, fetchImpl);
      const qs = new URLSearchParams({ m: '3', q: p.q });
      if (p.status !== 'ranked') qs.set('s', p.status === 'any' ? 'any' : p.status);
      if (p.sort) qs.set('sort', p.sort);
      if (p.cursor) qs.set('cursor_string', p.cursor);
      const r = await fetchImpl(`https://osu.ppy.sh/api/v2/beatmapsets/search?${qs}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!r.ok) throw new Error(`osu! API ${r.status}`);
      const d = await r.json();
      const sets = postFilter(normalizeList(d), p);
      return json({ sets, page: p.page, hasMore: !!d.cursor_string, cursor: d.cursor_string || null, source: 'osu! API' }, 200, { 'Cache-Control': 'public, max-age=300' });
    } catch (e) { errors.push(`osu! API: ${e.message}`); }
  }
  for (const m of MIRRORS.search) {
    try {
      const r = await fetchImpl(m.url(p), { headers: { Accept: 'application/json', ...UA } });
      if (!r.ok) { errors.push(`${m.name}: HTTP ${r.status}`); continue; }
      const raw = normalizeList(await r.json());
      const sets = postFilter(raw, p);
      if (!raw.length && errors.length < MIRRORS.search.length - 1 && p.page === 0 && p.rawQ) { errors.push(`${m.name}: no results`); continue; }
      return json({ sets, page: p.page, hasMore: raw.length >= PAGE_SIZE / 2, source: m.name, errors }, 200, { 'Cache-Control': 'public, max-age=300' });
    } catch (e) { errors.push(`${m.name}: ${e.message}`); }
  }
  return json({ sets: [], page: p.page, hasMore: false, source: null, errors, error: 'All beatmap search providers failed.' }, 502);
}

export async function handleDownload(id, fetchImpl = fetch) {
  if (!/^\d{1,9}$/.test(id)) return json({ error: 'Invalid beatmap set id' }, 400);
  const errors = [];
  for (const m of MIRRORS.download) {
    try {
      const r = await fetchImpl(m.url(id), { headers: UA, redirect: 'follow' });
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ ok: true, official: !!(env.OSU_CLIENT_ID && env.OSU_CLIENT_SECRET) });
    if (url.pathname === '/api/search') return handleSearch(url, env);
    const dl = /^\/api\/download\/(\d+)(?:\.osz)?$/.exec(url.pathname);
    if (dl) return handleDownload(dl[1]);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
