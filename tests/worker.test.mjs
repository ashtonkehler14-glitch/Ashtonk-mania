import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleGetBeatmaps, handleGetBeatmap, handleDownload, officialGet, osuApi, allowSearch, resetOsuLogin, rateLimitMessage } from '../worker/index.js';

const osuSet = (id, keys = [4, 7], mode = 'mania') => ({
  id, title: 'Song ' + id, artist: 'Artist', creator: 'Mapper', status: 'ranked', play_count: 10, favourite_count: 2,
  covers: { cover: 'x' }, preview_url: '//b.ppy.sh/preview/1.mp3', tags: 'lots of tags',
  beatmaps: keys.map((k, i) => ({ id: id * 10 + i, mode, version: `${k}K Hard`, difficulty_rating: 2 + i, cs: k, accuracy: 8, drain: 7, bpm: 180, total_length: 120, count_circles: 500, count_sliders: 50, checksum: 'abc', url: 'u' })),
});
const res = (body, status = 200, ct = 'application/json') => new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), { status, headers: { 'content-type': ct } });
const env = { OSU_CLIENT_ID: '1', OSU_CLIENT_SECRET: 's' };
/** A pretend osu!: logins and searches, recorded. */
function fakeOsu({ search = () => res({ beatmapsets: [osuSet(9)], cursor_string: 'abc', total: 1 }), set = id => res(osuSet(Number(id))), wom = () => res('down', 503, 'text/plain') } = {}) {
  const calls = [], womCalls = [];
  const fetchImpl = async (url, init = {}) => {
    if (url.startsWith('https://webosumania.com/')) { womCalls.push(url); return wom(new URL(url), init); }
    calls.push(url);
    if (url.endsWith('/oauth/token')) return res({ access_token: 'tok', expires_in: 86400 });
    if (url.includes('/api/v2/beatmapsets/search')) return search(new URL(url), init);
    const m = /\/api\/v2\/beatmapsets\/(\d+)$/.exec(url);
    if (m) return set(m[1], init);
    throw new Error('unexpected ' + url);
  };
  return { calls, womCalls, fetchImpl, searches: () => calls.filter(c => c.includes('beatmapsets/search')) };
}
const get = (path, fetchImpl, e = env) => (path.startsWith('/api/getBeatmaps') ? handleGetBeatmaps : handleGetBeatmap)(new URL('https://x' + path), e, fetchImpl);

test('/api/getBeatmaps sends osu! exactly Web-Osu-Mania\'s request: only its parameters, sorted', async () => {
  resetOsuLogin();
  const o = fakeOsu();
  const r = await get('/api/getBeatmaps?q=' + encodeURIComponent('stars>=3 stars<=6 key=4 key=7 camellia') + '&m=3&nsfw=true&s=loved&g=3&l=3&sort=plays_desc&cursor_string=abc&evil=1&page=4', o.fetchImpl);
  assert.equal(r.status, 200);
  const u = new URL(o.searches()[0]);
  assert.equal(u.origin + u.pathname, 'https://osu.ppy.sh/api/v2/beatmapsets/search');
  assert.deepEqual([...u.searchParams.keys()], ['cursor_string', 'g', 'l', 'm', 'nsfw', 'q', 's', 'sort'], 'unknown parameters dropped, the rest sorted');
  assert.equal(u.searchParams.get('q'), 'stars>=3 stars<=6 key=4 key=7 camellia');
  const d = await r.json();
  assert.equal(d.cursor_string, 'abc');
  assert.equal(d.beatmapsets[0].id, 9);
  assert.equal(d.beatmapsets[0].covers, undefined, 'trimmed like WOM\'s trimBeatmapSet');
  assert.equal(d.beatmapsets[0].beatmaps[0].checksum, undefined);
  assert.equal(d.beatmapsets[0].beatmaps[1].cs, 7);
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=3600');
  // the same search (in any parameter order) is answered from the hour-long cache
  const before = o.calls.length;
  await get('/api/getBeatmaps?sort=plays_desc&s=loved&nsfw=true&m=3&l=3&g=3&cursor_string=abc&q=' + encodeURIComponent('stars>=3 stars<=6 key=4 key=7 camellia'), o.fetchImpl);
  assert.equal(o.calls.length, before);
  resetOsuLogin();
});

test('/api/getBeatmaps: a 429 from osu! answers with WOM\'s message and stops asking osu! for Retry-After', async () => {
  resetOsuLogin();
  let limited = false;
  const o = fakeOsu({ search: () => limited ? new Response('slow down', { status: 429, headers: { 'Retry-After': '60' } }) : res({ beatmapsets: [osuSet(1)], cursor_string: null }) });
  assert.equal((await get('/api/getBeatmaps?m=3&q=first', o.fetchImpl)).status, 200);
  limited = true;
  const r = await get('/api/getBeatmaps?m=3&q=second', o.fetchImpl);
  assert.equal(r.status, 429);
  assert.equal(await r.text(), rateLimitMessage(60));
  assert.ok(osuApi.blockedUntil > Date.now() + 50000);
  const n = o.calls.length;
  const r2 = await get('/api/getBeatmaps?m=3&q=third', o.fetchImpl);
  assert.equal(r2.status, 429);
  assert.equal(await r2.text(), rateLimitMessage());
  assert.equal(o.calls.length, n, 'no osu! requests while blocked');
  // an answer osu! already gave is still served from the cache
  assert.equal((await get('/api/getBeatmaps?m=3&q=first', o.fetchImpl)).status, 200);
  // …and an older one (past the hour) rather than an error while osu! refuses
  osuApi.cache.get('beatmapsets/search?m=3&q=first').at -= 2 * 3600 * 1000;
  const stale = await get('/api/getBeatmaps?m=3&q=first', o.fetchImpl);
  assert.equal(stale.status, 200); assert.equal((await stale.json()).beatmapsets[0].id, 1);
  resetOsuLogin();
});

test('/api/getBeatmaps without an osu! key says so (no mirror listing)', async () => {
  resetOsuLogin();
  const o = fakeOsu();
  const r = await get('/api/getBeatmaps?m=3', o.fetchImpl, {});
  assert.equal(r.status, 503);
  assert.match(await r.text(), /OSU_CLIENT_ID/);
  assert.equal(o.calls.length, 0, 'nothing else is asked');
});

test('osu! errors read as Web-Osu-Mania words them', async () => {
  for (const [status, msg] of [[500, /ran into an error/], [503, /currently unavailable/], [504, /timed out/], [418, /unknown error/]]) {
    resetOsuLogin();
    const r = await get('/api/getBeatmaps?m=3&q=' + status, fakeOsu({ search: () => res('x', status, 'text/plain') }).fetchImpl);
    assert.equal(r.status, status); assert.match(await r.text(), msg);
  }
  resetOsuLogin();
  const r = await get('/api/getBeatmaps?m=3', async url => { if (url.endsWith('/oauth/token')) return res({ access_token: 't', expires_in: 9e4 }); throw new Error('network down'); });
  assert.equal(r.status, 504);
  resetOsuLogin();
});

test('/api/getBeatmap: one set by id (cached for a day), as WOM\'s getBeatmap', async () => {
  resetOsuLogin();
  const o = fakeOsu({ set: id => id === '404' ? res({ error: null }, 404) : res(osuSet(Number(id))) });
  const r = await get('/api/getBeatmap?beatmapSetId=77', o.fetchImpl);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.id, 77); assert.equal(d.covers, undefined);
  assert.ok(o.calls.some(c => c.endsWith('/api/v2/beatmapsets/77')));
  const n = o.calls.length;
  await get('/api/getBeatmap?beatmapSetId=77', o.fetchImpl);
  assert.equal(o.calls.length, n);
  assert.equal((await get('/api/getBeatmap?beatmapSetId=x1', o.fetchImpl)).status, 400);
  assert.equal((await get('/api/getBeatmap?beatmapSetId=404', o.fetchImpl)).status, 404);
  await assert.rejects(officialGet('users/1', env, o.fetchImpl), e => e.status === 400, 'only beatmap set requests are passed on');
  resetOsuLogin();
});

test('an expired osu! token is replaced and the request asked again once', async () => {
  resetOsuLogin();
  let logins = 0, first = true;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/oauth/token')) { logins++; return res({ access_token: 't' + logins, expires_in: 86400 }); }
    if (first) { first = false; return res('expired', 401, 'text/plain'); }
    assert.equal(init.headers.Authorization, 'Bearer t2');
    return res({ beatmapsets: [osuSet(5)], cursor_string: null });
  };
  const d = await officialGet('beatmapsets/search?m=3', env, fetchImpl);
  assert.equal(d.beatmapsets.length, 1); assert.equal(logins, 2);
  resetOsuLogin();
});

test('answers kept in the Durable Object\'s storage outlive a restart', async () => {
  resetOsuLogin();
  const saved = new Map();
  osuApi.store = { get: k => saved.get(k) || null, put: (k, e) => { saved.set(k, e); } };
  const o = fakeOsu();
  await officialGet('beatmapsets/search?m=3&q=keep', env, o.fetchImpl);
  assert.ok(saved.has('beatmapsets/search?m=3&q=keep'));
  osuApi.cache.clear(); // (a restart loses what's in memory)
  const n = o.calls.length;
  const d = await officialGet('beatmapsets/search?m=3&q=keep', env, o.fetchImpl);
  assert.equal(o.calls.length, n); assert.equal(d.beatmapsets[0].id, 9);
  resetOsuLogin();
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
  assert.equal((await worker.fetch(new Request('https://x/api/search?q=a'), env)).status, 404, 'no mirror search any more');
});

test('listing is rate-limited per visitor (like Web-Osu-Mania)', () => {
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

test('/api/osuFile: one difficulty\'s .osu for spectating, from osu! or else a mirror; nothing else passes', async () => {
  const { handleOsuFile } = await import('../worker/index.js');
  const calls = [];
  const r = await handleOsuFile(new URL('https://x/api/osuFile?id=42'), async u => { calls.push(u); return u.includes('osu.ppy.sh') ? res('nope', 404, 'text/plain') : res('osu file format v14\n[General]', 200, 'text/plain'); });
  assert.equal(r.status, 200); assert.match(await r.text(), /^osu file format/);
  assert.deepEqual(calls, ['https://osu.ppy.sh/osu/42', 'https://catboy.best/osu/42']);
  assert.equal((await handleOsuFile(new URL('https://x/api/osuFile?id=4x'), async () => res('x'))).status, 400);
  assert.equal((await handleOsuFile(new URL('https://x/api/osuFile?id=7'), async () => res('<html>', 200, 'text/html'))).status, 502);
});

test('osu! login: one token for many searches; a 429 on the login backs off instead of asking on every search', async () => {
  resetOsuLogin();
  let logins = 0, searches = 0, limit = true;
  const fetchImpl = async url => {
    if (url.endsWith('/oauth/token')) { logins++; return limit ? new Response('Too Many Attempts.', { status: 429, headers: { 'Retry-After': '60' } }) : res({ access_token: 't', expires_in: 86400 }); }
    searches++; return res({ beatmapsets: [osuSet(1)], cursor_string: null });
  };
  await assert.rejects(officialGet('beatmapsets/search?m=3&q=a', env, fetchImpl), e => e.status === 429 && /rate-limited/.test(e.message));
  await assert.rejects(officialGet('beatmapsets/search?m=3&q=b', env, fetchImpl), e => e.status === 429);
  assert.equal(logins, 1, 'no second login attempt while backing off');
  resetOsuLogin(); limit = false;
  await Promise.all(['c', 'd', 'e'].map(q => officialGet(`beatmapsets/search?m=3&q=${q}`, env, fetchImpl)));
  assert.equal(logins, 2, 'searches arriving together share one login');
  await officialGet('beatmapsets/search?m=3&q=f', env, fetchImpl);
  assert.equal(logins, 2); assert.equal(searches, 4);
  resetOsuLogin();
});

test('a second osu! app (OSU_CLIENT_ID_2) takes over while osu! refuses the first', async () => {
  resetOsuLogin();
  const env2 = { OSU_CLIENT_ID: '1', OSU_CLIENT_SECRET: 'a', OSU_CLIENT_ID_2: '2', OSU_CLIENT_SECRET_2: 'b' };
  const logins = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/oauth/token')) {
      const id = JSON.parse(init.body).client_id; logins.push(id);
      return id === 1 ? new Response('Too Many Attempts.', { status: 429, headers: { 'Retry-After': '600' } }) : res({ access_token: 't2', expires_in: 86400 });
    }
    assert.equal(init.headers.Authorization, 'Bearer t2');
    return res({ beatmapsets: [osuSet(3)], cursor_string: null });
  };
  const d = await officialGet('beatmapsets/search?m=3&q=x', env2, fetchImpl);
  assert.equal(d.beatmapsets.length, 1);
  await officialGet('beatmapsets/search?m=3&q=y', env2, fetchImpl);
  assert.deepEqual(logins, [1, 2], 'the first app is left alone while refused; the second one\'s login is reused');
  const h = await (await worker.fetch(new Request('https://x/api/health'), env2)).json();
  assert.equal(h.osuApps, 2);
  resetOsuLogin();
});

test('while osu! refuses the server, the list comes from Web-Osu-Mania\'s server (same request, same format)', async () => {
  resetOsuLogin();
  const womSet = { beatmapsets: [osuSet(42)], cursor_string: 'w1', total: 1 };
  const o = fakeOsu({
    wom: (u) => u.pathname === '/api/getBeatmaps' ? res(womSet) : res(osuSet(Number(u.searchParams.get('beatmapSetId')))),
  });
  // osu! refusing the login, as on Cloudflare's shared address
  const refusing = async (url, init) => url.endsWith('/oauth/token') ? new Response('<html>429 Too Many Requests nginx</html>', { status: 429 }) : o.fetchImpl(url, init);
  const r = await get('/api/getBeatmaps?m=3&nsfw=true&q=key%3D4&evil=1', refusing);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('X-Beatmap-Source'), 'webosumania.com');
  assert.equal((await r.json()).beatmapsets[0].id, 42);
  assert.equal(o.womCalls[0], 'https://webosumania.com/api/getBeatmaps?m=3&nsfw=true&q=key%3D4', 'only WOM\'s parameters, sorted');
  const one = await get('/api/getBeatmap?beatmapSetId=7', refusing);
  assert.equal(one.status, 200); assert.equal((await one.json()).id, 7);
  assert.equal(o.womCalls[1], 'https://webosumania.com/api/getBeatmap?beatmapSetId=7');
  // no osu! key at all: straight to WOM's server
  resetOsuLogin();
  assert.equal((await get('/api/getBeatmaps?m=3', o.fetchImpl, {})).headers.get('X-Beatmap-Source'), 'webosumania.com');
  // osu! working: osu! is used, WOM's server isn't asked
  resetOsuLogin();
  const n = o.womCalls.length;
  assert.equal((await get('/api/getBeatmaps?m=3&q=ok', o.fetchImpl)).headers.get('X-Beatmap-Source'), 'osu!');
  assert.equal(o.womCalls.length, n);
  resetOsuLogin();
});
