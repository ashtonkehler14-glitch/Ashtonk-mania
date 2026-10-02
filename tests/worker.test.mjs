import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleSearch, handleDownload, normalizeSet, MIRRORS, osuApi, allowSearch } from '../worker/index.js';

const osuSet = (id, keys = [4, 7], mode = 'mania') => ({
  id, title: 'Song ' + id, artist: 'Artist', creator: 'Mapper', status: 'ranked', play_count: 10, favourite_count: 2,
  beatmaps: keys.map((k, i) => ({ id: id * 10 + i, mode, version: `${k}K Hard`, difficulty_rating: 2 + i, cs: k, accuracy: 8, drain: 7, bpm: 180, total_length: 120, count_circles: 500, count_sliders: 50 })),
});
const res = (body, status = 200, ct = 'application/json') => new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), { status, headers: { 'content-type': ct } });

test('normalizes osu!-API-shaped sets and keeps only mania difficulties', () => {
  const s = normalizeSet({ ...osuSet(1), beatmaps: [...osuSet(1).beatmaps, { id: 99, mode: 'osu', cs: 4, difficulty_rating: 5, version: 'Std' }] });
  assert.equal(s.diffs.length, 2);
  assert.deepEqual(s.diffs.map(d => d.keys), [4, 7]);
  assert.equal(normalizeSet(osuSet(2, [4], 'osu')), null);
});

test('search falls back to the next mirror and filters by key count', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); if (url.includes('catboy')) return res('nope', 503, 'text/plain'); return res([osuSet(5), osuSet(6, [7])]); };
  const r = await handleSearch(new URL('https://x/api/search?q=freedom&keys=7&status=ranked'), {}, fetchImpl);
  const d = await r.json();
  assert.equal(d.source, 'NeriNyan');
  assert.equal(d.sets.length, 2);
  assert.ok(d.sets.every(s => s.diffs.every(x => x.keys === 7)));
  assert.ok(calls[0].includes('catboy') && calls[1].includes('nerinyan'));
  assert.ok(calls[1].includes('key%3D7') || calls[1].includes('key=7'));
});

test('search sends osu!-style sort, filters "has leaderboard" and pins the mirror for later pages', async () => {
  const calls = [];
  const sets = [osuSet(7), { ...osuSet(8), status: 'graveyard' }, { ...osuSet(9), status: 'loved' }];
  const fetchImpl = async url => { calls.push(url); return res(sets); };
  // a text search in the default order is osu!'s relevance order: the mirror is asked without a sort (its own
  // relevance order), exactly like Web-Osu-Mania leaves "sort" out for the default
  const d = await (await handleSearch(new URL('https://x/api/search?q=a'), {}, fetchImpl)).json();
  assert.ok(!calls[0].includes('sort='));
  assert.equal(d.sort, 'relevance_desc');
  assert.deepEqual(d.sets.map(s => s.id), [7, 9]);
  assert.equal(d.provider, 0);
  await handleSearch(new URL('https://x/api/search?q=a&sort=title_asc&page=1&provider=1'), {}, fetchImpl);
  assert.ok(calls[1].includes('nerinyan') && calls[1].includes('sort=title_asc'));
  await handleSearch(new URL('https://x/api/search?sort=evil;drop'), {}, fetchImpl);
  assert.ok(calls[2].includes('sort=ranked_desc'), 'an unknown sort is the default order (ranked, newest first)');
});

test('rating sort: a mirror that rejects it is asked again in its default order and the page is sorted by rating', async () => {
  const calls = [];
  const sets = [{ ...osuSet(1), rating: 6.1 }, { ...osuSet(2), ratings: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 9] }, { ...osuSet(3), rating: 8 }];
  const fetchImpl = async url => { calls.push(url); return url.includes('sort=rating') ? res({ error: 'invalid sort' }, 400) : res(sets); };
  const d = await (await handleSearch(new URL('https://x/api/search?sort=rating_desc'), {}, fetchImpl)).json();
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes('sort=rating_desc') && !calls[1].includes('sort='));
  assert.deepEqual(d.sets.map(s => s.id), [2, 3, 1]);
  assert.equal(d.sortedLocally, true);
  // a mirror that answers 200 with an error body counts as a failure too
  const calls2 = [];
  await handleSearch(new URL('https://x/api/search?sort=rating_asc'), {}, async url => { calls2.push(url); return url.includes('sort=') ? res({ error: 'bad' }) : res(sets); });
  assert.equal(calls2.length, 2);
});

test('relevance sort: uses the mirror\'s own order for a text search and ranks the best matches first', async () => {
  const calls = [];
  const sets = [{ ...osuSet(1), title: 'Other thing' }, { ...osuSet(2), title: 'Zako' }, { ...osuSet(3), title: 'Zako Zako Remix' }];
  const d = await (await handleSearch(new URL('https://x/api/search?q=zako&sort=relevance_desc'), {}, async url => { calls.push(url); return res(sets); })).json();
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes('sort='));
  assert.deepEqual(d.sets.map(s => s.id), [2, 3, 1]);
  // relevance without words falls back to newest ranked
  await handleSearch(new URL('https://x/api/search?sort=relevance_desc'), {}, async url => { calls.push(url); return res(sets); });
  assert.ok(calls[1].includes('sort=ranked_desc'));
});

test('search reports every provider failure', async () => {
  const r = await handleSearch(new URL('https://x/api/search?q=a'), {}, async () => { throw new Error('offline'); });
  assert.equal(r.status, 502);
  const d = await r.json();
  assert.equal(d.errors.length, MIRRORS.search.length);
});

test('official osu! API: the same request Web-Osu-Mania sends, cached, with back-off on 429', async () => {
  osuApi.cache.clear(); osuApi.blockedUntil = 0;
  const calls = [];
  const env = { OSU_CLIENT_ID: '1', OSU_CLIENT_SECRET: 's' };
  let limited = false;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/oauth/token')) return res({ access_token: 'tok', expires_in: 3600 });
    if (url.includes('osu.ppy.sh/api/v2/beatmapsets/search')) {
      if (limited) return new Response('slow down', { status: 429, headers: { 'Retry-After': '60' } });
      return res({ beatmapsets: [osuSet(9), { ...osuSet(10), nsfw: true }], cursor_string: 'abc', total: 2 });
    }
    return res([osuSet(11)]); // mirrors
  };
  const search = async qs => (await handleSearch(new URL('https://x/api/search?' + qs), env, fetchImpl)).json();
  const d = await search('q=camellia&keys=4,7&minStars=3&maxStars=6');
  const u = new URL(calls.find(c => c.includes('beatmapsets/search')));
  assert.equal(u.searchParams.get('m'), '3');
  assert.equal(u.searchParams.get('q'), 'stars>=3 stars<=6 key=4 key=7 camellia');
  assert.equal(u.searchParams.get('sort'), null, 'the default order is left to osu! (relevance for a text search)');
  assert.equal(u.searchParams.get('s'), null, '"Has leaderboard" is osu!\'s default category');
  assert.equal(u.searchParams.get('nsfw'), 'true');
  assert.equal(d.source, 'osu! API'); assert.equal(d.cursor, 'abc'); assert.ok(d.hasMore);
  // category, genre, language, NSFW, explicit sort and the cursor go through as osu! parameters
  await search('status=loved&g=3&l=3&nsfw=false&sort=plays_desc&cursor=abc');
  const u2 = new URL(calls.filter(c => c.includes('beatmapsets/search')).pop());
  assert.deepEqual([...u2.searchParams.keys()], [...u2.searchParams.keys()].slice().sort(), 'sorted, so equal searches share a cache entry');
  assert.equal(u2.searchParams.get('s'), 'loved'); assert.equal(u2.searchParams.get('g'), '3'); assert.equal(u2.searchParams.get('l'), '3');
  assert.equal(u2.searchParams.get('nsfw'), 'false'); assert.equal(u2.searchParams.get('sort'), 'plays_desc'); assert.equal(u2.searchParams.get('cursor_string'), 'abc');
  // the same search again comes from the cache
  const before = calls.length;
  await search('q=camellia&keys=4,7&minStars=3&maxStars=6');
  assert.equal(calls.length, before);
  // a 429 blocks the osu! API for Retry-After and the mirrors answer meanwhile
  limited = true;
  const r = await search('q=something+else');
  assert.notEqual(r.source, 'osu! API'); assert.ok(r.sets.length);
  assert.ok(osuApi.blockedUntil > Date.now() + 50000);
  const n = calls.length;
  await search('q=third');
  assert.ok(!calls.slice(n).some(c => c.includes('osu.ppy.sh')), 'no osu! requests while blocked');
  osuApi.blockedUntil = 0; osuApi.cache.clear();
});

test('official osu! API is used when credentials are configured', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/oauth/token')) return res({ access_token: 'tok', expires_in: 3600 });
    if (url.includes('/api/v2/beatmapsets/search')) return res({ beatmapsets: [osuSet(9)], cursor_string: 'abc' });
    throw new Error('unexpected ' + url);
  };
  const d = await (await handleSearch(new URL('https://x/api/search?q=x'), { OSU_CLIENT_ID: '1', OSU_CLIENT_SECRET: 's' }, fetchImpl)).json();
  assert.equal(d.source, 'osu! API');
  assert.equal(d.cursor, 'abc');
});

test('download proxies the first mirror that returns an archive', async () => {
  const fetchImpl = async (url) => url.includes('catboy') ? res({ error: 'not found' }, 404) : res(new Uint8Array([80, 75, 3, 4, 1, 2, 3]), 200, 'application/octet-stream');
  const r = await handleDownload('123', fetchImpl);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('X-Mirror'), 'NeriNyan');
  assert.equal((await r.arrayBuffer()).byteLength, 7);
  assert.equal((await handleDownload('12a')).status, 400);
});

test('non-API paths are served from static assets', async () => {
  const env = { ASSETS: { fetch: async () => new Response('index') } };
  assert.equal(await (await worker.fetch(new Request('https://x/'), env)).text(), 'index');
  assert.equal((await worker.fetch(new Request('https://x/api/nope'), env)).status, 404);
  const h = await (await worker.fetch(new Request('https://x/api/health'), env)).json();
  assert.equal(h.ok, true);
});

test('search is rate-limited per visitor (like Web-Osu-Mania)', () => {
  const t0 = 1e12;
  for (let i = 0; i < 40; i++) assert.ok(allowSearch('1.2.3.4', t0 + i));
  assert.ok(!allowSearch('1.2.3.4', t0 + 100));
  assert.ok(allowSearch('5.6.7.8', t0 + 100), 'other visitors are not affected');
  assert.ok(allowSearch('1.2.3.4', t0 + 61000), 'the window slides');
});

test('downloads try the chosen provider first (Web-Osu-Mania providers incl. Nekoha)', async () => {
  const calls = [];
  const osz = new Uint8Array(300).fill(7);
  const fetchImpl = async url => { calls.push(url); return new Response(osz, { status: 200, headers: { 'content-type': 'application/octet-stream' } }); };
  const r = await handleDownload('123', fetchImpl, 'nekoha');
  assert.equal(r.status, 200);
  assert.ok(calls[0].includes('mirror.nekoha.moe'));
  assert.equal(r.headers.get('X-Mirror'), 'Nekoha');
  calls.length = 0;
  await handleDownload('123', fetchImpl);
  assert.ok(calls[0].includes('catboy.best'), 'default order starts with Mino');
});

test('a mirror that finds nothing with osu!\'s key/star filters in the text is asked again with just the words', async () => {
  const calls = [];
  const fetchImpl = async url => { calls.push(url); return res(/key%3D/.test(url) ? [] : [osuSet(11, [4, 7]), osuSet(12, [7])]); };
  const d = await (await handleSearch(new URL('https://x/api/search?q=camellia&keys=4'), {}, fetchImpl)).json();
  assert.equal(d.wordsOnly, true);
  assert.deepEqual(d.sets.map(s => s.id), [11], 'keys are filtered here instead');
  assert.ok(d.sets[0].diffs.every(x => x.keys === 4));
  assert.equal(calls[0].includes('catboy'), true);
  // the next page goes straight to the words-only search
  calls.length = 0;
  await handleSearch(new URL('https://x/api/search?q=camellia&keys=4&page=1&loose=1'), {}, fetchImpl);
  assert.equal(calls.length, 1); assert.ok(!/key%3D/.test(calls[0]));
});

test('Web-Osu-Mania\'s /api/downloadBeatmap: passes a provider\'s file through, only for WOM\'s providers', async () => {
  const { handleProxyDownload } = await import('../worker/index.js');
  const calls = [];
  const ok = await handleProxyDownload(new URL('https://x/api/downloadBeatmap?destinationUrl=' + encodeURIComponent('https://catboy.best/d/5')), async (u) => { calls.push(u); return res(new Uint8Array(300), 200, 'application/x-osu-beatmap-archive'); });
  assert.equal(ok.status, 200); assert.equal(calls[0], 'https://catboy.best/d/5');
  assert.equal((await ok.arrayBuffer()).byteLength, 300);
  assert.equal((await handleProxyDownload(new URL('https://x/api/downloadBeatmap?destinationUrl=' + encodeURIComponent('https://evil.example/x')), async () => res('x'))).status, 403);
  assert.equal((await handleProxyDownload(new URL('https://x/api/downloadBeatmap'), async () => res('x'))).status, 400);
  assert.equal((await handleProxyDownload(new URL('https://x/api/downloadBeatmap?destinationUrl=' + encodeURIComponent('https://osu.direct/api/d/5')), async () => res('nope', 404, 'text/plain'))).status, 404);
});

test('osu! login: one token for many searches; a 429 on the login backs off instead of asking on every search', async () => {
  const { officialFetch, resetOsuLogin } = await import('../worker/index.js');
  osuApi.cache.clear(); osuApi.blockedUntil = 0; resetOsuLogin();
  const env = { OSU_CLIENT_ID: '1', OSU_CLIENT_SECRET: 's' };
  let logins = 0, searches = 0, limit = true;
  const fetchImpl = async url => {
    if (url.endsWith('/oauth/token')) { logins++; return limit ? new Response('Too Many Attempts.', { status: 429, headers: { 'Retry-After': '60' } }) : res({ access_token: 't', expires_in: 86400 }); }
    searches++; return res({ beatmapsets: [osuSet(1)], cursor_string: null });
  };
  await assert.rejects(officialFetch('m=3&q=a', env, fetchImpl), /429/);
  await assert.rejects(officialFetch('m=3&q=b', env, fetchImpl), /rate-limited/);
  assert.equal(logins, 1, 'no second login attempt while backing off');
  osuApi.blockedUntil = 0; limit = false;
  await Promise.all([officialFetch('m=3&q=c', env, fetchImpl), officialFetch('m=3&q=d', env, fetchImpl), officialFetch('m=3&q=e', env, fetchImpl)]);
  assert.equal(logins, 2, 'searches arriving together share one login');
  await officialFetch('m=3&q=f', env, fetchImpl);
  assert.equal(logins, 2); assert.equal(searches, 4);
  osuApi.cache.clear();
});
