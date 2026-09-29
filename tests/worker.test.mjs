import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleSearch, handleDownload, normalizeSet, MIRRORS } from '../worker/index.js';

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

test('search reports every provider failure', async () => {
  const r = await handleSearch(new URL('https://x/api/search?q=a'), {}, async () => { throw new Error('offline'); });
  assert.equal(r.status, 502);
  const d = await r.json();
  assert.equal(d.errors.length, MIRRORS.search.length);
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
