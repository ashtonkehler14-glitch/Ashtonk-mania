import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomLogic, makeCode, validCode, CODE_ALPHABET } from '../worker/multiplayer.js';

const MAP = { hash: 'abc123', title: 'Song', artist: 'Artist', version: '4K Hard', creator: 'M', keys: 4, stars: 3.2, length: 120000, onlineSetId: 42, onlineId: 420 };
const msgs = (out, t) => out.filter(o => o.msg.t === t);
function room(clock = { t: 0 }) {
  const r = new RoomLogic('ABCDEF', () => clock.t);
  r.join('a', 'Alice', true); r.join('b', 'Bob', false);
  return r;
}
function ready(r) {
  r.message('a', { t: 'map', map: MAP, mods: ['HD', 'AT', 'bad'] });
  r.message('b', { t: 'hasMap', has: true });
  r.message('a', { t: 'ready', ready: true }); r.message('b', { t: 'ready', ready: true });
}

test('room codes use the unambiguous alphabet', () => {
  const c = makeCode();
  assert.equal(c.length, 6);
  assert.ok([...c].every(ch => CODE_ALPHABET.includes(ch)));
  assert.ok(validCode(c) && !validCode('ab') && !validCode('ABC-12'));
});

test('joining: create vs join, full rooms, host', () => {
  const r = new RoomLogic('X');
  assert.equal(r.join('b', 'Bob', false).ok, false, 'cannot join a room nobody created');
  const a = r.join('a', 'Alice', true);
  assert.ok(a.ok);
  assert.equal(msgs(a.out, 'welcome')[0].to, 'a');
  assert.ok(r.join('b', 'Bob', false).ok);
  assert.equal(r.join('c', 'Cat', false).error, 'This room is full.');
  assert.equal(r.hostId, 'a');
});

test('map selection is host-only, strips Auto and resets ready', () => {
  const r = room();
  assert.equal(r.message('b', { t: 'map', map: MAP }).length, 0);
  ready(r);
  assert.deepEqual(r.mods, ['HD']);
  assert.ok(r.players.every(p => p.ready));
  r.message('a', { t: 'map', map: { ...MAP, hash: 'zzz' } });
  assert.ok(r.players.every(p => !p.ready));
  assert.equal(r.get('b').hasMap, false);
  assert.equal(r.get('a').hasMap, true);
});

test('cannot ready without the beatmap; start needs two ready players', () => {
  const r = room();
  r.message('a', { t: 'map', map: MAP });
  r.message('b', { t: 'ready', ready: true });
  assert.equal(r.get('b').ready, false);
  assert.equal(msgs(r.message('a', { t: 'start' }), 'error').length, 1);
  ready(r);
  assert.equal(r.message('b', { t: 'start' }).length, 0, 'only the host starts');
  const out = r.message('a', { t: 'start' });
  assert.equal(msgs(out, 'start')[0].msg.delay, 5000);
  assert.equal(r.state, 'playing');
});

test('live scores go to the opponent only; higher pp wins', () => {
  const r = room(); ready(r); r.message('a', { t: 'start' });
  const live = r.message('a', { t: 'score', score: 5000, acc: 0.99, combo: 10, hp: 1 });
  assert.deepEqual(live[0].to, { except: 'a' });
  assert.equal(r.message('a', { t: 'finish', result: { score: 900000, accuracy: 0.97, passed: true, grade: 'A', pp: 120 } }).length, 0, 'waits for both');
  const out = r.message('b', { t: 'finish', result: { score: 950000, accuracy: 0.95, passed: true, grade: 'A', pp: 95 } });
  const res = msgs(out, 'results')[0].msg.results;
  assert.equal(res.winner, 'a', 'more pp wins even with less score (e.g. a harder difficulty)');
  assert.deepEqual(res.rows.map(x => x.id), ['a', 'b']);
  assert.equal(r.state, 'lobby');
  assert.ok(r.players.every(p => !p.ready && !p.playing));
});

test('ties are draws, forfeits lose, leaving mid-match hands the win to the other player', () => {
  let r = room(); ready(r); r.message('a', { t: 'start' });
  r.message('a', { t: 'finish', result: { score: 800000, accuracy: 0.9 } });
  let res = msgs(r.message('b', { t: 'finish', result: { score: 800000, accuracy: 0.9 } }), 'results')[0].msg.results;
  assert.equal(res.winner, null);

  r = room(); ready(r); r.message('a', { t: 'start' });
  r.message('a', { t: 'score', score: 999999, acc: 1 });
  r.message('a', { t: 'quit' });
  res = msgs(r.message('b', { t: 'finish', result: { score: 10, accuracy: 0.1 } }), 'results')[0].msg.results;
  assert.equal(res.winner, 'b', 'quitting forfeits even with a higher score');

  r = room(); ready(r); r.message('a', { t: 'start' });
  const out = r.leave('b');
  res = msgs(out, 'results')[0].msg.results;
  assert.equal(res.winner, 'a');
  assert.ok(res.rows.find(x => x.id === 'b').forfeit);
  assert.equal(r.state, 'lobby');
});

test('host leaves → other player becomes host; empty rooms close', () => {
  const r = room();
  r.leave('a');
  assert.equal(r.hostId, 'b');
  r.leave('b');
  assert.equal(r.created, false);
  assert.equal(r.join('c', 'Cat', false).ok, false);
});

test('unfinished players time out after the map length', () => {
  const clock = { t: 0 };
  const r = room(clock); ready(r); r.message('a', { t: 'start' });
  r.message('a', { t: 'finish', result: { score: 500000, accuracy: 0.9 } });
  assert.equal(r.tick().length, 0);
  clock.t = 5000 + 120000 + 60001;
  const res = msgs(r.tick(), 'results')[0].msg.results;
  assert.equal(res.winner, 'a');
});

test('inputs are sanitised', () => {
  const r = room();
  r.message('a', { t: 'chat', text: 'x'.repeat(1000) });
  const c = r.message('a', { t: 'chat', text: '  hi\u0000there ' });
  assert.equal(c[0].msg.text, 'hi there');
  assert.equal(r.message('a', { t: 'map', map: { title: 'no hash' } })[0].msg.t, 'error');
  ready(r); r.message('a', { t: 'start' });
  r.message('a', { t: 'finish', result: { score: 1e12, accuracy: 7, counts: 'nope' } });
  const res = msgs(r.message('b', { t: 'finish', result: {} }), 'results')[0].msg.results;
  const a = res.rows.find(x => x.id === 'a');
  assert.equal(a.score, 1e7); assert.equal(a.accuracy, 1); assert.deepEqual(a.counts, [0, 0, 0, 0, 0, 0]);
});

test('suggestions are broadcast as chat with the beatmap attached (online-only maps allowed)', () => {
  const r = room();
  const out = r.message('b', { t: 'suggest', map: { title: 'Online Song', artist: 'X', version: '7K', onlineSetId: 12, onlineId: 120, keys: 7 } });
  assert.equal(out[0].to, 'all');
  assert.equal(out[0].msg.suggest.onlineSetId, 12);
  assert.equal(out[0].msg.suggest.hash, '');
  assert.equal(r.message('b', { t: 'suggest', map: { title: 'No ids' } }).length, 0);
});

test('each player can pick their own difficulty of the room beatmap; a new map resets the choices', () => {
  const r = room(); ready(r);
  r.message('b', { t: 'diff', diff: { version: '4K Easy', stars: 1.2, keys: 4 } });
  assert.equal(r.snapshot().players.find(p => p.id === 'b').diff.version, '4K Easy');
  r.message('a', { t: 'start' });
  r.message('a', { t: 'finish', result: { score: 900000, accuracy: 0.97 } });
  const res = msgs(r.message('b', { t: 'finish', result: { score: 950000, accuracy: 0.99 } }), 'results')[0].msg.results;
  assert.equal(res.rows.find(x => x.id === 'b').diff.version, '4K Easy');
  assert.equal(res.rows.find(x => x.id === 'a').diff, null, 'no choice = the host\'s difficulty');
  r.message('a', { t: 'map', map: { ...MAP, hash: 'other' } });
  assert.equal(r.get('b').diff, null);
});

test('equal pp (e.g. two fails at 0pp) falls back to score, then accuracy', () => {
  const r = room(); ready(r); r.message('a', { t: 'start' });
  r.message('a', { t: 'finish', result: { score: 300000, accuracy: 0.7, pp: 0 } });
  const res = msgs(r.message('b', { t: 'finish', result: { score: 400000, accuracy: 0.6, pp: 0 } }), 'results')[0].msg.results;
  assert.equal(res.winner, 'b');
  const live = r.message('a', { t: 'score', score: 1, acc: 1, combo: 1, hp: 1, pp: 5 });
  assert.equal(live.length, 0, 'no live scores outside a match');
});
