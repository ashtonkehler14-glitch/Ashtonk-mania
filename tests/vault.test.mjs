// A player's scores kept for their other devices (worker/vault.js): each kept once, read back a page at a time in the
// order they came, and only the newest SCORES_MAX.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerVault, SCORES_MAX, SCORE_MAX } from '../worker/vault.js';

/** Durable Object storage, as far as the vault uses it. */
class FakeStorage {
  constructor() { this.m = new Map(); this.writes = 0; }
  async get(k) { if (Array.isArray(k)) { assert.ok(k.length <= 128, 'at most 128 keys at once'); return new Map(k.filter(x => this.m.has(x)).map(x => [x, this.m.get(x)])); } return this.m.get(k); }
  async put(k, v) { if (typeof k === 'object') { const e = Object.entries(k); assert.ok(e.length <= 128, 'at most 128 keys at once'); for (const [a, b] of e) this.m.set(a, b); this.writes += e.length; } else { this.m.set(k, v); this.writes++; } }
  async delete(k) { for (const x of [].concat(k)) this.m.delete(x); }
  async deleteAll() { this.m.clear(); }
  async list({ prefix = '', start = '', limit = Infinity } = {}) { return new Map([...this.m.keys()].filter(k => k.startsWith(prefix) && k >= start).sort().slice(0, limit).map(k => [k, this.m.get(k)])); }
}
const vault = () => new PlayerVault({ storage: new FakeStorage() });
const call = async (v, path, body) => (await v.fetch(new Request('https://vault/' + path, { method: 'POST', body: JSON.stringify(body) }))).json();
const sc = (i, extra = {}) => ({ id: `sc-test${String(i).padStart(5, '0')}`, mapHash: 'h' + (i % 7), score: 1000 + i, date: 1e12 + i, ...extra });

test('scores are kept once each, and come back in the order they came, a page at a time', async () => {
  const v = vault();
  assert.equal((await call(v, 'scores-up', { scores: [sc(1), sc(2), sc(3)] })).added, 3);
  assert.equal((await call(v, 'scores-up', { scores: [sc(2), sc(3), sc(4)] })).added, 1); // (sent again: kept once)
  const a = await call(v, 'scores', { after: 0 });
  assert.deepEqual(a.scores.map(x => x.id), [sc(1), sc(2), sc(3), sc(4)].map(x => x.id));
  assert.equal(a.next, null);
  const b = await call(v, 'scores', { after: 2 });
  assert.deepEqual(b.scores.map(x => x.id), [sc(3).id, sc(4).id]);
  assert.equal((await call(v, 'scores', { after: a.last })).scores.length, 0);
});

test('bad scores are left out: no id, a strange id, one too big, not an object', async () => {
  const v = vault();
  const r = await call(v, 'scores-up', { scores: [{ mapHash: 'x' }, { id: '../x' }, sc(1, { pad: 'x'.repeat(SCORE_MAX) }), 'sc-hello', null, [1], sc(2)] });
  assert.equal(r.added, 1);
  assert.equal((await call(v, 'scores-up', { scores: 'nope' })).error, 'Bad scores.');
});

test('a long history is read in pages, and only the newest are kept', async () => {
  const v = vault();
  for (let i = 0; i < SCORES_MAX + 150; i += 200) await call(v, 'scores-up', { scores: Array.from({ length: 200 }, (_, j) => sc(i + j)) });
  let after = 0, all = [], pages = 0;
  for (;;) { const p = await call(v, 'scores', { after }); all.push(...p.scores); pages++; if (p.next == null) break; after = p.next; }
  assert.equal(all.length, SCORES_MAX);
  assert.ok(pages > 1);
  assert.equal(all[all.length - 1].id, sc(SCORES_MAX + 199).id); // (the newest)
  assert.equal(all[0].id, sc(200).id); // (the oldest 200 went)
  assert.equal((await call(v, 'scores-up', { scores: [sc(5)] })).added, 1); // (one that went is kept again if sent again)
});

test('a merged player keeps nothing', async () => {
  const v = vault();
  await call(v, 'scores-up', { scores: [sc(1)] });
  await call(v, 'wipe', {});
  assert.equal((await call(v, 'scores', { after: 0 })).scores.length, 0);
});

test('settings: what a device changed is merged into what\'s kept — each setting as it was last changed, medals from all', async () => {
  const v = vault(), restore = async () => (await call(v, 'restore', {})).settings;
  // (nothing kept yet: a device's changes alone would be all there is — it's asked for everything)
  const first = await v.fetch(new Request('https://vault/settings', { method: 'POST', body: JSON.stringify({ v: 2, values: { a: 1 } }) }));
  assert.equal(first.status, 409);
  assert.equal((await first.json()).full, true);
  await call(v, 'settings', { v: 2, full: true, values: { a: 1, b: 1, 'medals.unlocked': { m1: 1 } }, skin: { id: 's1', name: 'One' }, collections: [{ name: 'C', hashes: ['h1'] }], favorites: ['set-1'] });
  // device B changes b and unlocks a medal; device A then changes a (its b is older: not sent)
  await call(v, 'settings', { v: 2, values: { b: 2, 'medals.unlocked': { m2: 1 } } });
  await call(v, 'settings', { v: 2, values: { a: 3, 'medals.unlocked': { m1: 1 } } });
  const s = await restore();
  assert.deepEqual(s.values, { a: 3, b: 2, 'medals.unlocked': { m1: 1, m2: 1 } });
  assert.deepEqual([s.skin.name, s.collections[0].name, s.favorites[0], 'full' in s], ['One', 'C', 'set-1', false]); // (not sent: kept as they were)
  // a skin, collections or favourites sent replace what's kept
  await call(v, 'settings', { v: 2, values: {}, skin: { id: 's2', name: 'Two' }, favorites: [] });
  const t = await restore();
  assert.deepEqual([t.skin.name, t.favorites.length, t.collections.length, t.values.a], ['Two', 0, 1, 3]);
  // an older game sends everything, which replaces it all
  await call(v, 'settings', { v: 1, values: { z: 9 }, skin: null });
  assert.deepEqual((await restore()).values, { z: 9 });
});
