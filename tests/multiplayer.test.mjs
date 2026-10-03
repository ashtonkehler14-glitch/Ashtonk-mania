import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomLogic, PresenceLogic, makeCode, validCode, CODE_ALPHABET, QP, QP_POINTS, RP, cleanAvatar, rateMatch, deckTargets, beatmapRating, starsForRating, initialRating, RankedQueue, QUEUE } from '../worker/multiplayer.js';

test('presence: online list, statuses and invites between players', () => {
  const clock = { t: 0 };
  const p = new PresenceLogic(() => clock.t);
  const joinOut = p.join('a', { name: 'Alice' });
  assert.equal(joinOut[0].msg.t, 'welcome');
  p.join('b', { name: 'Bob', status: 'room' });
  assert.deepEqual(p.list().map(x => [x.name, x.status]), [['Alice', 'menu'], ['Bob', 'room']]);
  const st = p.message('a', { t: 'status', status: 'playing' });
  assert.equal(st[0].msg.players[0].status, 'playing');
  // Bob is in a room: he can't be invited until he's back in the menus
  assert.equal(p.message('a', { t: 'invite', to: 'b', code: 'ABCDEF' })[0].msg.msg, 'That player is already in a room.');
  p.message('b', { t: 'status', status: 'menu' });
  const inv = p.message('a', { t: 'invite', to: 'b', code: 'ABCDEF' });
  assert.deepEqual(inv[0], { to: 'b', msg: { t: 'invite', from: { id: 'a', name: 'Alice' }, code: 'ABCDEF' } });
  assert.equal(inv[1].msg.t, 'invited');
  assert.deepEqual(p.message('a', { t: 'invite', to: 'b', code: 'ABCDEF' }), []); // double click
  assert.equal(p.message('a', { t: 'invite', to: 'nobody', code: 'ABCDEF' })[0].msg.t, 'error');
  assert.equal(p.message('a', { t: 'invite', to: 'b', code: 'x' })[0].msg.t, 'error');
  const left = p.leave('b');
  assert.deepEqual(left[0].msg.players.map(x => x.id), ['a']);
});

test('presence: silent players drop off, a reconnecting tab replaces its old entry, list on request', () => {
  const clock = { t: 0 };
  const p = new PresenceLogic(() => clock.t);
  p.join('a', { name: 'Alice', cid: 'tab1' }); p.join('b', { name: 'Bob', cid: 'tab2' });
  clock.t = 20000; p.message('a', { t: 'ping' });
  assert.deepEqual(p.prune().gone, []);
  clock.t = 80000;
  const r = p.prune();
  assert.deepEqual(r.gone, ['b']); // Bob went quiet
  assert.deepEqual(r.out[0].msg.players.map(x => x.name), ['Alice']);
  p.join('a2', { name: 'Alice', cid: 'tab1' }); // Alice's tab reconnects
  assert.deepEqual(p.dropped, ['a']);
  assert.deepEqual(p.list().map(x => x.id), ['a2']);
  const l = p.message('a2', { t: 'list' });
  assert.deepEqual(l, [{ to: 'a2', msg: { t: 'online', players: p.list() } }]);
});

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
  const a = r.join('a', 'Alice', true, { size: 2 }); // a quick 1v1 match opens a room for two
  assert.ok(a.ok);
  assert.equal(msgs(a.out, 'welcome')[0].to, 'a');
  assert.ok(r.join('b', 'Bob', false, { size: 8 }).ok, 'only the opener sets the room up');
  assert.equal(r.join('c', 'Cat', false).error, 'This room is full.');
  assert.equal(r.hostId, 'a');
  const big = new RoomLogic('Y');
  for (let i = 0; i < 16; i++) assert.ok(big.join('p' + i, 'P' + i, i === 0).ok);
  assert.equal(big.join('p17', 'Late', false).error, 'This room is full.', 'rooms hold up to 16');
});

test('map selection is host-only, strips Auto and resets ready', () => {
  const r = room();
  assert.equal(r.message('b', { t: 'map', map: MAP }).length, 0);
  ready(r);
  assert.deepEqual(r.mods, []);
  assert.deepEqual(r.get('a').mods, ['HD']); // the host's own mod, not the room's
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

test('regular rooms play like osu! multiplayer: head to head, the highest score wins, up to 16', () => {
  const r = room();
  assert.deepEqual([r.settings.type, r.settings.win, r.settings.size, r.settings.public], ['h2h', 'score', 16, true]);
  ready(r); r.message('a', { t: 'start' });
  r.message('a', { t: 'finish', result: { score: 900000, accuracy: 0.97, pp: 120 } });
  const res = msgs(r.message('b', { t: 'finish', result: { score: 950000, accuracy: 0.95, pp: 95 } }), 'results')[0].msg.results;
  assert.equal(res.winner, 'b');
  const p = new RoomLogic('P'); p.join('a', 'A', true, { public: false });
  assert.equal(p.settings.public, false);
  assert.equal(p.listing(), null);
});

test('live scores go to the opponent only; with win by pp, higher pp wins', () => {
  const r = room(); r.message('a', { t: 'settings', settings: { win: 'pp' } }); ready(r); r.message('a', { t: 'start' });
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

test('speed mods (DT…) need every player to accept; other mods are per player', () => {
  const r = room();
  r.message('a', { t: 'map', map: MAP, mods: ['DT', 'HD'] });
  assert.deepEqual(r.mods, []);
  assert.deepEqual(r.vote.mods, ['DT']);
  r.message('b', { t: 'hasMap', has: true });
  r.message('b', { t: 'mods', mods: ['MR', 'DT', 'AT'] });
  assert.deepEqual(r.get('b').mods, ['MR']);
  r.message('a', { t: 'ready', ready: true }); r.message('b', { t: 'ready', ready: true });
  assert.equal(msgs(r.message('a', { t: 'start' }), 'error').length, 1); // vote still open
  r.message('b', { t: 'vote', yes: true });
  assert.deepEqual(r.mods, ['DT']);
  assert.equal(r.vote, null);
  r.message('a', { t: 'ready', ready: true }); r.message('b', { t: 'ready', ready: true });
  const st = msgs(r.message('a', { t: 'start' }), 'start')[0].msg;
  assert.deepEqual(st.mods, ['DT']);
  assert.deepEqual(st.playerMods, { a: ['HD'], b: ['MR'] });
  r.checkFinished(); r.state = 'lobby';
  r.message('a', { t: 'map', map: { ...MAP, hash: 'next' }, mods: ['HD'] }); // a new map without DT keeps the room's DT
  assert.deepEqual(r.mods, ['DT']);
  assert.equal(r.vote, null);
});

test('declining a speed mod cancels it', () => {
  const r = room();
  r.message('a', { t: 'map', map: MAP });
  r.message('b', { t: 'rate', mods: ['HT'] });
  assert.deepEqual(r.vote.mods, ['HT']);
  r.message('a', { t: 'vote', yes: false });
  assert.equal(r.vote, null);
  assert.deepEqual(r.mods, []);
});

test('the intro is skipped only when every player votes', () => {
  const r = room();
  ready(r);
  r.message('a', { t: 'start' });
  const one = r.message('a', { t: 'skip' });
  assert.deepEqual(one[0].msg, { t: 'skipvote', votes: 1, total: 2 });
  assert.deepEqual(r.message('a', { t: 'skip' }), []);
  assert.equal(r.message('b', { t: 'skip' })[0].msg.t, 'skip');
  assert.deepEqual(r.message('b', { t: 'skip' }), []);
});

const fin = (r, id, res) => r.message(id, { t: 'finish', result: { passed: true, grade: 'A', ...res } });
function bigRoom(n, clock = { t: 0 }) {
  const r = new RoomLogic('ROOM', () => clock.t);
  for (let i = 0; i < n; i++) r.join('p' + i, 'P' + i, i === 0);
  r.message('p0', { t: 'map', map: MAP });
  for (let i = 0; i < n; i++) { r.message('p' + i, { t: 'hasMap', has: true }); r.message('p' + i, { t: 'ready', ready: true }); }
  return r;
}

test('room settings are the host\'s; win conditions rank by pp, score, accuracy or max combo with placements', () => {
  const r = bigRoom(3);
  assert.deepEqual(r.message('p1', { t: 'settings', settings: { win: 'score' } }), [], 'host only');
  const out = r.message('p0', { t: 'settings', settings: { win: 'accuracy', size: 1, queue: 'bogus' } });
  assert.equal(r.settings.win, 'accuracy');
  assert.equal(r.settings.size, 3, 'never smaller than the players already in');
  assert.equal(r.settings.queue, 'host');
  assert.match(msgs(out, 'chat')[0].msg.text, /win by accuracy/);
  assert.ok(r.players.every(p => !p.ready), 'changing the rules un-readies everyone');
  for (const p of r.players) r.message(p.id, { t: 'ready', ready: true });
  r.message('p0', { t: 'start' });
  fin(r, 'p0', { score: 900000, accuracy: 0.95, pp: 200, maxCombo: 500 });
  fin(r, 'p1', { score: 800000, accuracy: 0.99, pp: 100, maxCombo: 100 });
  const res = msgs(fin(r, 'p2', { score: 700000, accuracy: 0.99, pp: 90, maxCombo: 50 }), 'results')[0].msg.results;
  assert.deepEqual(res.rows.map(x => [x.id, x.place]), [['p1', 1], ['p2', 2], ['p0', 3]], 'equal accuracy: score breaks the tie');
  assert.equal(res.winner, 'p1');
  assert.equal(res.win, 'accuracy');
});

test('Team Versus: balanced teams, switching, team totals decide the winner', () => {
  const r = bigRoom(4);
  r.message('p0', { t: 'settings', settings: { type: 'teams', win: 'score' } });
  assert.deepEqual(r.players.map(p => p.team), [0, 1, 0, 1]);
  r.join('p4', 'P4', false);
  assert.equal(r.get('p4').team, 0, 'newcomers join the smaller team (red first)');
  r.message('p4', { t: 'team', team: 1 });
  assert.equal(r.get('p4').team, 1);
  r.leave('p4');
  for (const p of r.players) { r.message(p.id, { t: 'ready', ready: true }); }
  r.message('p0', { t: 'start' });
  fin(r, 'p0', { score: 900000 }); fin(r, 'p2', { score: 100000 }); // red 1,000,000
  fin(r, 'p1', { score: 600000 });
  const res = msgs(fin(r, 'p3', { score: 500000 }), 'results')[0].msg.results; // blue 1,100,000
  assert.deepEqual(res.teams.map(t => t.total), [1000000, 1100000]);
  assert.equal(res.winnerTeam, 1);
  assert.equal(res.winner, null);
  assert.equal(res.rows[0].id, 'p0', 'individual placements still listed');
  r.message('p0', { t: 'settings', settings: { type: 'h2h' } });
  assert.ok(r.players.every(p => p.team === null));
});

test('host rotation passes the host to the next player after each match', () => {
  const r = bigRoom(3);
  r.message('p0', { t: 'settings', settings: { queue: 'rotate' } });
  for (const p of r.players) r.message(p.id, { t: 'ready', ready: true });
  r.message('p0', { t: 'start' });
  for (const p of r.players) fin(r, p.id, { score: 1 });
  assert.equal(r.hostId, 'p1');
});

test('a match with more players ends when everyone still in has finished', () => {
  const r = bigRoom(3);
  r.message('p0', { t: 'start' });
  fin(r, 'p0', { score: 5, pp: 5 });
  assert.equal(msgs(r.leave('p1'), 'results').length, 0, 'p2 still playing');
  const res = msgs(fin(r, 'p2', { score: 9, pp: 9 }), 'results')[0].msg.results;
  assert.deepEqual(res.rows.map(x => x.id), ['p2', 'p0', 'p1']);
  assert.ok(res.rows[2].forfeit && res.rows[2].left);
});

test('Quick Play: gather, pool, picks, roulette, load, play, points, rounds and the final', () => {
  const clock = { t: 0 };
  const r = new RoomLogic('QP', () => clock.t, () => 0.99);
  r.join('a', 'Alice', true, { mode: 'qp', keys: 7, sr: 3 });
  assert.equal(r.snapshot().mode, 'qp');
  assert.equal(r.qp.keys, 7);
  assert.equal(r.qp.deadline, 0, 'alone: no countdown');
  r.join('b', 'Bob', false, { sr: 5 });
  assert.equal(r.qp.deadline, QP.GATHER);
  assert.deepEqual(r.message('a', { t: 'map', map: MAP }), [], 'no host picks in Quick Play');
  clock.t = QP.GATHER;
  let out = r.tick();
  const ask = msgs(out, 'qpPool')[0];
  assert.equal(ask.to, 'a');
  assert.deepEqual([ask.msg.round, ask.msg.keys], [1, 7]);
  assert.ok(ask.msg.sr >= 3 && ask.msg.sr <= 5);
  assert.equal(r.qp.round, 1);
  assert.deepEqual(r.message('b', { t: 'pool', maps: [MAP] }), [], 'only the host sends the pool');
  const pool = [MAP, { ...MAP, hash: '', title: 'Online', onlineSetId: 7, onlineId: 70 }, { title: 'bad' }];
  r.message('a', { t: 'pool', maps: pool });
  assert.equal(r.qp.phase, 'pick');
  assert.equal(r.qp.pool.length, 2, 'invalid entries dropped');
  assert.deepEqual(r.message('a', { t: 'pick', i: 9 }), []);
  r.message('a', { t: 'pick', i: 0 });
  r.message('b', { t: 'pick', i: 1 });
  assert.ok(r.qp.deadline <= clock.t + 1500, 'everyone picked: spin soon');
  clock.t += 1500; r.tick();
  assert.equal(r.qp.phase, 'reveal');
  assert.equal(r.qp.chosen, 1, 'lands on one of the picked maps');
  assert.equal(r.map.title, 'Online');
  clock.t += QP.REVEAL; r.tick();
  assert.equal(r.qp.phase, 'load');
  r.message('a', { t: 'hasMap', has: true });
  assert.equal(r.state, 'lobby', 'waits for everyone to have the map');
  out = r.message('b', { t: 'hasMap', has: true });
  const st = msgs(out, 'start')[0].msg;
  assert.deepEqual(st.players, ['a', 'b']);
  assert.deepEqual(st.playerMods, {});
  fin(r, 'a', { score: 700000 });
  const res = msgs(fin(r, 'b', { score: 900000 }), 'results')[0].msg.results;
  assert.deepEqual(res.rows.map(x => [x.id, x.points]), [['b', QP_POINTS[0]], ['a', QP_POINTS[1]]], 'Quick Play is won on score');
  assert.equal(res.qp.round, 1);
  assert.equal(r.qp.phase, 'standings');
  // round 2: the host never sends a pool → the next player is asked
  clock.t += QP.STANDINGS; out = r.tick();
  assert.equal(r.qp.round, 2);
  clock.t += QP.POOL; out = r.tick();
  assert.equal(msgs(out, 'qpPool')[0].to, 'b');
  assert.equal(r.hostId, 'b');
  r.message('b', { t: 'pool', maps: [MAP] });
  clock.t += QP.PICK; r.tick(); // nobody picked: any map in the pool
  assert.equal(r.qp.chosen, 0);
  clock.t += QP.REVEAL; r.tick();
  r.message('a', { t: 'hasMap', has: true });
  clock.t += QP.LOAD; out = r.tick(); // b never got it: a plays alone
  assert.deepEqual(msgs(out, 'start')[0].msg.players, ['a']);
  assert.match(msgs(out, 'chat')[0].msg.text, /Bob couldn't load/);
  fin(r, 'a', { score: 1 });
  assert.deepEqual(r.snapshot().qp.points, { a: QP_POINTS[1] + QP_POINTS[0], b: QP_POINTS[0] });
  // late arrivals are turned away once it has started
  assert.equal(r.join('c', 'Cat', false).ok, false);
  // play out the remaining rounds quickly: the final
  r.qp.round = r.qp.rounds;
  clock.t += QP.STANDINGS; out = r.tick();
  assert.equal(r.qp.phase, 'final');
  assert.match(msgs(out, 'chat')[0].msg.text, /Alice wins with 14 points/);
});

test('Quick Play: a full lobby starts almost at once; everyone else leaving ends it', () => {
  const clock = { t: 0 };
  const r = new RoomLogic('QP', () => clock.t);
  for (let i = 0; i < 8; i++) r.join('p' + i, 'P' + i, i === 0, { mode: 'qp' });
  assert.equal(r.qp.deadline, QP.FULL);
  clock.t = QP.FULL; r.tick();
  assert.equal(r.qp.phase, 'pool');
  for (let i = 1; i < 8; i++) r.leave('p' + i);
  assert.equal(r.qp.phase, 'final');
});

// ── Ranked Play: osu!lazer's rules (osu-server-spectator RankedPlay stages)
const deck = (n = 50) => Array.from({ length: n }, (_, i) => ({ ...MAP, hash: 'h' + i, title: 'Song ' + i, stars: 3 + i * 0.02, onlineSetId: 100 + i, onlineId: 1000 + i }));
/** A rated match between Alice (1600) and Bob (1400), dealt and at the end of the intro. */
function rpMatch(clock = { t: 0 }, opts = {}) {
  const r = new RoomLogic('RP', () => clock.t, () => 0.25);
  r.join('a', 'Alice', true, { mode: 'rp', keys: 4, rated: true, rating: 1600, sigma: 150, cid: 'ca', ...opts });
  const joined = r.join('b', 'Bob', false, { rating: 1400, sigma: 150, cid: 'cb' }).out;
  // both pick the star rating they want (Bob the lower, so he goes first)
  const out = [...joined, ...r.message('a', { t: 'rpStars', stars: 4 }), ...r.message('b', { t: 'rpStars', stars: 2 })];
  r.message('a', { t: 'pool', maps: deck() });
  return { r, out };
}
const tickTo = (r, clock) => { clock.t = r.rp.deadline; return r.tick(); };
/** Play the current card: both get it, both ready, the countdown runs out, both finish with these scores. */
function playRound(r, clock, a, b) {
  r.message('a', { t: 'hasMap', has: true }); r.message('b', { t: 'hasMap', has: true });
  r.message('a', { t: 'rpready', ready: true }); r.message('b', { t: 'rpready', ready: true });
  const out = tickTo(r, clock);
  fin(r, 'a', { score: a }); fin(r, 'b', { score: b });
  return out;
}

test('Ranked Play maths: beatmap ratings from stars, a new player\'s rating from pp, the deck around the lower rating', () => {
  assert.equal(beatmapRating(0), 800);
  assert.equal(beatmapRating(5), Math.round(800 + 500 * (Math.exp(0.8) - 1)));
  for (const sr of [1, 2.5, 4, 6.3]) assert.ok(Math.abs(starsForRating(beatmapRating(sr)) - sr) < 0.01);
  assert.equal(Math.round(initialRating(0)), 976, 'no pp: about 1.9★ cards');
  assert.ok(initialRating(5000) > initialRating(1000));
  let seed = 1; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const t = deckTargets([1600, 1400], 50, rnd).sort((x, y) => x - y);
  assert.equal(t.length, 50);
  const median = t[25];
  assert.ok(Math.abs(median - starsForRating(1400)) < 0.35, `centred on the lower rating (${median}★ vs ${starsForRating(1400).toFixed(2)}★)`);
});

test('Ranked Play rating: OpenSkill Plackett–Luce on the final life (μ 1500, σ 150, τ 15)', () => {
  const [w, l] = rateMatch([{ mu: 1500, sigma: 150, score: 600000 }, { mu: 1500, sigma: 150, score: 0 }]);
  assert.ok(Math.abs(w.mu - 1553.3) < 0.5 && Math.abs(l.mu - 1446.7) < 0.5, `±53 between equals (${w.mu}, ${l.mu})`);
  assert.ok(w.sigma < 150.75 && Math.abs(w.sigma - l.sigma) < 1e-9, 'more certain afterwards');
  const [d1, d2] = rateMatch([{ mu: 1600, sigma: 120, score: 5 }, { mu: 1400, sigma: 120, score: 5 }]);
  assert.ok(d1.mu < 1600 && d2.mu > 1400, 'a draw pulls the ratings together');
  const [up] = rateMatch([{ mu: 1300, sigma: 150, score: 1 }, { mu: 1700, sigma: 150, score: 0 }]);
  assert.ok(up.mu - 1300 > 53, 'beating a stronger player is worth more');
});

test('Ranked Play: deal, intro, discard phase, the lower rating plays first, and the timer plays the selected card', () => {
  const clock = { t: 0 };
  const r = new RoomLogic('RP', () => clock.t, () => 0.25);
  r.join('a', 'Alice', true, { mode: 'rp', keys: 4, rated: true, rating: 1600, cid: 'ca' });
  assert.equal(r.rp.stage, 'waitjoin');
  assert.equal(r.listing(), null, 'queue matches are not listed');
  const joined = r.join('b', 'Bob', false, { rating: 1400, cid: 'cb' }).out;
  assert.equal(r.join('c', 'Cat', false).ok, false, 'two players only');
  assert.equal(r.rp.stage, 'stars', 'both choose a star rating first');
  assert.deepEqual(msgs(joined, 'rpDeck'), [], 'no deck until both have chosen');
  const half = r.message('b', { t: 'rpStars', stars: 2.5 });
  assert.equal(r.rp.view('a').users.b.pref, null, 'the other player\'s choice stays hidden until both have chosen');
  assert.equal(r.rp.view('a').users.b.picked, true);
  const out = [...half, ...r.message('a', { t: 'rpStars', stars: 3.5 })];
  assert.ok(msgs(out, 'rpDeck')[0].msg.targets.every(t => t >= 0.5 && Math.abs(t - 3) < 2), 'the deck is drawn around both choices');
  const ask = msgs(out, 'rpDeck')[0];
  assert.equal(ask.to, 'a', 'the host\'s client draws up the deck');
  assert.equal(ask.msg.targets.length, RP.DECK);
  assert.equal(r.rp.stage, 'deal');
  r.message('a', { t: 'pool', maps: deck() });
  assert.equal(r.rp.stage, 'warmup'); assert.equal(r.rp.round, 1); assert.equal(r.rp.stageLen, RP.INTRO);
  assert.equal(r.rp.user('a').hand.length, RP.HAND); assert.equal(r.rp.user('b').hand.length, RP.HAND);
  assert.equal(r.rp.deck.length, 50 - 2 * RP.HAND);
  assert.equal(r.rp.active, 'b', 'the lower-rated player plays first');
  assert.ok(Math.abs(r.rp.stars - 3.49) < 0.01, 'the deck\'s average star rating');
  // each player sees their own cards only
  const va = r.snapshot('a').rp, vb = r.snapshot('b').rp;
  assert.deepEqual(Object.keys(va.cards).map(Number).sort(), [...r.rp.user('a').hand].sort());
  assert.ok(r.rp.user('b').hand.every(i => !(i in va.cards)) && r.rp.user('a').hand.every(i => !(i in vb.cards)));
  assert.equal(va.users.b.hand.length, RP.HAND, 'the number of the opponent\'s cards is known');
  // round 1 opens with the discard phase: replace any cards, once
  tickTo(r, clock);
  assert.equal(r.rp.stage, 'discard'); assert.equal(r.rp.stageLen, RP.DISCARD);
  const old = [...r.rp.user('a').hand];
  r.message('a', { t: 'discard', cards: [old[0], old[1], 999] });
  assert.equal(r.rp.user('a').hand.length, RP.HAND);
  assert.ok(!r.rp.user('a').hand.includes(old[0]) && !r.rp.user('a').hand.includes(old[1]) && r.rp.user('a').hand.includes(old[2]));
  assert.deepEqual(r.message('a', { t: 'discard', cards: [old[2]] }), [], 'only once');
  r.message('b', { t: 'discard', cards: [] }); // keeps the hand
  assert.equal(r.rp.deadline - clock.t, RP.DISCARD_DONE, 'both done: on after the animations');
  tickTo(r, clock); assert.equal(r.rp.stage, 'discarded');
  tickTo(r, clock); assert.equal(r.rp.stage, 'pick'); assert.equal(r.rp.stageLen, RP.PICK);
  // Bob's turn: Alice can't play, and watches Bob's hand; the timer plays the card Bob last selected
  assert.deepEqual(r.message('a', { t: 'play', card: r.rp.user('a').hand[0] }), []);
  const sel = r.rp.user('b').hand[3];
  const relay = r.message('b', { t: 'hand', hover: r.rp.user('b').hand[1], sel });
  assert.deepEqual(relay[0], { to: { except: 'b' }, msg: { t: 'hand', id: 'b', hover: r.rp.user('b').hand[1], sel } });
  tickTo(r, clock);
  assert.equal(r.rp.stage, 'picked'); assert.equal(r.rp.played, sel);
  assert.equal(r.map.title, r.rp.pool[sel].title);
  assert.ok(sel in r.snapshot('a').rp.cards, 'a played card is shown to both');
  // both have it → look it over and ready up → a 10 s countdown → play
  r.message('a', { t: 'hasMap', has: true }); r.message('b', { t: 'hasMap', has: true });
  assert.equal(r.rp.stage, 'ready');
  r.message('a', { t: 'rpready', ready: true });
  assert.equal(r.rp.countdown, false);
  r.message('b', { t: 'rpready', ready: true });
  assert.equal(r.rp.countdown, true); assert.equal(r.rp.deadline - clock.t, RP.COUNTDOWN);
  const start = tickTo(r, clock);
  assert.equal(msgs(start, 'start').length, 1); assert.equal(r.rp.stage, 'playing');
  assert.deepEqual(msgs(start, 'start')[0].msg.playerMods, {}, 'nobody brings their own mods');
});

test('Ranked Play damage: ⌈difference × (round + winner multipliers)⌉ + 50,000, multipliers grow, a card each later turn', () => {
  const clock = { t: 0 };
  const { r } = rpMatch(clock);
  tickTo(r, clock); r.message('a', { t: 'discard', cards: [] }); r.message('b', { t: 'discard', cards: [] });
  tickTo(r, clock); tickTo(r, clock);
  // round 1 (Bob's card): Alice wins by 200,000 → 200,000 × (0.5 + 0.5) + 50,000
  r.message('b', { t: 'play', card: r.rp.user('b').hand[0] });
  playRound(r, clock, 900000, 700000);
  assert.equal(r.rp.stage, 'results');
  assert.equal(r.rp.user('b').life, RP.LIFE - 250000);
  assert.deepEqual(r.rp.results.dmg.b, { damage: 250000, rawDamage: 250000, oldLife: RP.LIFE, newLife: 750000, directDamage: 200000, multiplier: 1, bonusDamage: 50000 });
  assert.equal(r.rp.results.winner, 'a'); assert.equal(r.rp.user('a').won, 1);
  assert.equal(r.rp.user('b').hand.length, RP.HAND - 1, 'the played card is spent');
  // round 2 (Alice's turn, no draw yet): round ×1, Alice's own ×1 after her win → Bob wins this time, his own is still ×0.5
  tickTo(r, clock);
  assert.equal(r.rp.round, 2); assert.equal(r.rp.stage, 'pick'); assert.equal(r.rp.active, 'a');
  assert.equal(r.rp.mult, 1); assert.equal(r.rp.user('a').mult, 1); assert.equal(r.rp.user('b').mult, 0.5);
  assert.equal(r.rp.user('a').hand.length, RP.HAND);
  r.message('a', { t: 'play', card: r.rp.user('a').hand[2] });
  playRound(r, clock, 600000, 800001);
  assert.equal(r.rp.user('a').life, RP.LIFE - (Math.ceil(200001 * 1.5) + 50000));
  // round 3 (Bob's turn): he draws a card first; round ×1.5
  tickTo(r, clock);
  assert.equal(r.rp.round, 3); assert.equal(r.rp.active, 'b'); assert.equal(r.rp.mult, 1.5);
  assert.equal(r.rp.user('b').hand.length, RP.HAND, 'a card on each turn from round 3');
  assert.equal(r.rp.user('b').mult, 1);
  // a tie does no damage
  r.message('b', { t: 'play', card: r.rp.user('b').hand[0] });
  const lifeA = r.rp.user('a').life, lifeB = r.rp.user('b').life;
  playRound(r, clock, 500000, 500000);
  assert.equal(r.rp.results.winner, null);
  assert.deepEqual([r.rp.user('a').life, r.rp.user('b').life], [lifeA, lifeB]);
});

test('Ranked Play: last stand at full life, the match ends at 0 life, and rated matches update both ratings', () => {
  const clock = { t: 0 };
  const { r } = rpMatch(clock);
  tickTo(r, clock); r.message('a', { t: 'discard', cards: [] }); r.message('b', { t: 'discard', cards: [] });
  tickTo(r, clock); tickTo(r, clock);
  r.message('b', { t: 'play', card: r.rp.user('b').hand[0] });
  playRound(r, clock, 1000000, 0); // 1,050,000 damage at full life
  assert.equal(r.rp.user('b').life, 1, 'last stand: a hit at full life leaves 1');
  assert.notEqual(r.rp.stage, 'ended');
  tickTo(r, clock);
  r.message('a', { t: 'play', card: r.rp.user('a').hand[0] });
  playRound(r, clock, 300000, 200000);
  assert.equal(r.rp.user('b').life, 0);
  assert.equal(r.rp.winner, 'a');
  const u = r.snapshot('a').rp.users;
  assert.ok(u.a.ratingAfter > 1600 && u.b.ratingAfter < 1400, `ratings move (${u.a.ratingAfter}, ${u.b.ratingAfter})`);
  tickTo(r, clock);
  assert.equal(r.rp.stage, 'ended');
});

test('Ranked Play: not ready in time costs 100,000 × the round multiplier and skips the round', () => {
  const clock = { t: 0 };
  const { r } = rpMatch(clock);
  tickTo(r, clock); r.message('a', { t: 'discard', cards: [] }); r.message('b', { t: 'discard', cards: [] });
  tickTo(r, clock); tickTo(r, clock);
  const card = r.rp.user('b').hand[0];
  r.message('b', { t: 'play', card });
  r.message('a', { t: 'hasMap', has: true }); // Bob never gets the beatmap
  tickTo(r, clock);
  assert.equal(r.rp.user('b').life, RP.LIFE - 50000, '100,000 × 0.5');
  assert.equal(r.rp.user('a').life, RP.LIFE);
  assert.ok(!r.rp.user('b').hand.includes(card), 'the card is spent');
  assert.equal(r.rp.round, 2); assert.equal(r.rp.stage, 'pick');
  // nobody ready: no damage, the round is skipped all the same
  r.message('a', { t: 'play', card: r.rp.user('a').hand[0] });
  r.message('a', { t: 'hasMap', has: true }); r.message('b', { t: 'hasMap', has: true });
  tickTo(r, clock);
  assert.deepEqual([r.rp.user('a').life, r.rp.user('b').life], [RP.LIFE, RP.LIFE - 50000]);
  assert.equal(r.rp.round, 3);
});

test('Ranked Play: leaving the song scores 0 for the round; the other player plays on', () => {
  const clock = { t: 0 };
  const { r } = rpMatch(clock);
  tickTo(r, clock); r.message('a', { t: 'discard', cards: [] }); r.message('b', { t: 'discard', cards: [] });
  tickTo(r, clock); tickTo(r, clock);
  r.message('b', { t: 'play', card: r.rp.user('b').hand[0] });
  r.message('a', { t: 'hasMap', has: true }); r.message('b', { t: 'hasMap', has: true });
  r.message('a', { t: 'rpready', ready: true }); r.message('b', { t: 'rpready', ready: true });
  tickTo(r, clock);
  r.message('a', { t: 'score', score: 400000, acc: 0.98, combo: 100, maxCombo: 100 });
  r.message('a', { t: 'quit' });
  assert.equal(r.state, 'playing', 'Bob is still playing');
  fin(r, 'b', { score: 300000 });
  assert.equal(r.rp.stage, 'results');
  assert.equal(r.rp.results.scores.a, 0);
  assert.equal(r.rp.user('a').life, RP.LIFE - (300000 + 50000));
  assert.equal(r.players.length, 2, 'the match goes on');
});

test('Ranked Play: leaving the match loses it (and a rated one bans from the queue); a dropped connection can come back', () => {
  const clock = { t: 0 };
  let { r } = rpMatch(clock);
  tickTo(r, clock);
  // Bob's connection drops: he's away, and back as himself when the same tab reconnects
  r.disconnect('b');
  assert.equal(r.get('b').away, true); assert.notEqual(r.rp.stage, 'ended');
  const back = r.join('b2', 'Bob', false, { cid: 'cb' });
  assert.equal(back.ok, true); assert.equal(back.as, 'b');
  assert.equal(r.get('b').away, false);
  assert.equal(r.join('x', 'X', false, { cid: 'zz' }).ok, false, 'nobody else gets in');
  // away too long: gone for good
  r.disconnect('b');
  clock.t += RP.AWAY; r.tick();
  assert.equal(r.rp.stage, 'ended'); assert.equal(r.rp.winner, 'a');
  assert.equal(r.rp.user('b').life, 0);
  assert.deepEqual(r.rp.bans, [{ cid: 'cb', ms: RP.LEAVE_BAN }]);
  assert.ok(r.snapshot('a').rp.users.a.ratingAfter > 1600);
  // leaving before the cards are even dealt: no winner, nothing rated
  ({ r } = { r: new RoomLogic('RQ', () => clock.t, () => 0.25) });
  r.join('a', 'A', true, { mode: 'rp', rated: true, rating: 1500, cid: 'ca' }); r.join('b', 'B', false, { rating: 1500, cid: 'cb' });
  r.leave('b');
  assert.equal(r.rp.stage, 'ended'); assert.equal(r.rp.winner, null);
  assert.equal(r.snapshot('a').rp.users.a.ratingAfter, 1500);
  // a rated match nobody else turns up for ends after a minute
  const lone = new RoomLogic('RL', () => clock.t, () => 0.25);
  lone.join('a', 'A', true, { mode: 'rp', rated: true, rating: 1500 });
  clock.t += RP.WAIT_JOIN; lone.tick();
  assert.equal(lone.rp.stage, 'ended');
});

test('Ranked Play duels between friends: unrated, listed while public, the deck from both ratings', () => {
  const clock = { t: 0 };
  const r = new RoomLogic('DU', () => clock.t, () => 0.25);
  r.join('a', 'Alice', true, { mode: 'rp', keys: 7, rating: 1234 });
  assert.equal(r.listing().ranked, true); assert.equal(r.listing().keys, 7); assert.equal(r.listing().rating, 1234);
  assert.equal(r.listing().name, "Alice's Ranked Play duel");
  clock.t += 10 * 60000; r.tick();
  assert.equal(r.rp.stage, 'waitjoin', 'a duel waits for the friend');
  r.join('b', 'Bob', false, { rating: 1500 });
  r.message('a', { t: 'rpStars', stars: 3 }); r.message('b', { t: 'rpStars', stars: 3 });
  r.message('a', { t: 'pool', maps: deck(12) });
  assert.equal(r.listing().state, 'playing');
  r.leave('b');
  assert.equal(r.rp.winner, 'a');
  assert.equal(r.snapshot('a').rp.users.a.ratingAfter, 1234, 'unrated');
  const priv = new RoomLogic('DP'); priv.join('a', 'A', true, { mode: 'rp', public: false }); assert.equal(priv.listing(), null);
});

test('Ranked Play queue: pairs close ratings, both accept → one room; a decline costs a minute; the search widens', () => {
  const clock = { t: 0 };
  let n = 0;
  const q = new RankedQueue(() => clock.t, () => 0.5, () => 'ROOM' + ++n);
  const a = q.join({ cid: 'ca', name: 'Alice', keys: 4, rating: 1500 });
  assert.equal(a.status, 'search');
  const far = q.join({ cid: 'cf', name: 'Far', keys: 4, rating: 1900 });
  const b = q.join({ cid: 'cb', name: 'Bob', keys: 4, rating: 1560 });
  assert.equal(q.status(a.ticket).status, 'found');
  assert.deepEqual(q.status(a.ticket).opponent, { name: 'Bob', avatar: '', rating: 1560 });
  assert.equal(q.status(far.ticket).status, 'search', 'too far apart for now');
  q.accept(a.ticket);
  assert.equal(q.status(a.ticket).accepted, true); assert.equal(q.status(b.ticket).opponentAccepted, true);
  q.accept(b.ticket);
  const ra = q.status(a.ticket), rb = q.status(b.ticket);
  assert.equal(ra.status, 'ready'); assert.equal(ra.room, rb.room);
  // a 7K player is never paired with a 4K one
  const s7 = q.join({ cid: 'c7', name: 'Seven', keys: 7, rating: 1900 });
  q.update(); assert.equal(q.status(s7.ticket).status, 'search');
  // declining: a minute out of the queue; the other one searches again
  const c = q.join({ cid: 'cc', name: 'Cat', keys: 4, rating: 1880 });
  assert.equal(q.status(c.ticket).status, 'found');
  q.decline(c.ticket);
  assert.equal(q.status(far.ticket).status, 'search');
  assert.equal(q.join({ cid: 'cc', keys: 4 }).status, 'banned');
  clock.t += RP.DECLINE_BAN + 1;
  q.status(far.ticket); q.status(s7.ticket);
  // an offer nobody answers runs out
  const d = q.join({ cid: 'cd', name: 'Dan', keys: 4, rating: 1910 });
  assert.equal(q.status(d.ticket).status, 'found');
  for (let t = 0; t < QUEUE.INVITE + 1000; t += 5000) { clock.t += 5000; q.status(d.ticket); q.status(far.ticket); q.status(s7.ticket); q.update(); }
  assert.equal(q.status(d.ticket).status, 'none'); assert.equal(q.status(far.ticket).status, 'none');
  // the search radius doubles every 30 s (and starts wider far from 1500, where there are fewer players)
  q.decline(s7.ticket); // (leaves: by now Seven's own search would reach the next player)
  const lo = q.join({ cid: 'l', keys: 7, rating: 1000 }), hi = q.join({ cid: 'h', keys: 7, rating: 1700 });
  assert.ok(q.radius({ rating: 2600, since: clock.t }) > 2000, 'a top player searches widely from the start');
  assert.equal(q.status(lo.ticket).status, 'search');
  for (let i = 0; i < 6; i++) { clock.t += 10000; q.status(lo.ticket); q.status(hi.ticket); q.update(); }
  assert.equal(q.status(lo.ticket).status, 'found');
  // players who stop polling drop out
  const quiet = q.join({ cid: 'qq', keys: 4, rating: 3000 });
  clock.t += QUEUE.STALE + 1; q.update();
  assert.equal(q.status(quiet.ticket).status, 'none');
});

test('shared avatars: presets, public pictures and small inline images only', () => {
  assert.equal(cleanAvatar('preset:teto'), 'preset:teto');
  assert.equal(cleanAvatar('file:rin.png'), 'file:rin.png');
  assert.equal(cleanAvatar('data:image/jpeg;base64,QUJD'), 'data:image/jpeg;base64,QUJD');
  assert.equal(cleanAvatar('javascript:alert(1)'), '');
  assert.equal(cleanAvatar('data:image/svg+xml;base64,QUJD'), '');
  assert.equal(cleanAvatar('data:image/jpeg;base64,' + 'A'.repeat(20000)), '');
  const r = new RoomLogic('X'); r.join('a', 'Alice', true, { avatar: 'preset:miku' });
  assert.equal(r.snapshot().players[0].avatar, 'preset:miku');
  const p = new PresenceLogic(); p.join('a', { name: 'A', avatar: 'preset:neru' });
  assert.equal(p.list()[0].avatar, 'preset:neru');
});

test('room listing: public custom rooms and duels only; private, quick 1v1, Quick Play and queue matches are not listed', () => {
  const r = new RoomLogic('ROOM1'); r.join('a', 'Alice', true, { avatar: 'preset:teto' });
  assert.equal(r.listing().name, "Alice's room");
  assert.equal(r.listing().avatar, 'preset:teto');
  r.message('a', { t: 'map', map: MAP });
  assert.equal(r.listing().map.title, 'Song');
  r.message('a', { t: 'settings', settings: { public: false } });
  assert.equal(r.listing(), null);
  const q = new RoomLogic('Q'); q.join('a', 'A', true, { size: 2 }); assert.equal(q.listing(), null);
  const p = new RoomLogic('P'); p.join('a', 'A', true, { mode: 'qp' }); assert.equal(p.listing(), null);
  const k = new RoomLogic('K'); k.join('a', 'A', true, { mode: 'rp', rating: 1400 });
  assert.equal(k.listing().ranked, true, 'public Ranked Play duels are listed, open while waiting for an opponent');
  assert.equal(k.listing().rating, 1400);
  assert.equal(k.listing().state, 'lobby');
  const k2 = new RoomLogic('K2'); k2.join('a', 'A', true, { mode: 'rp', public: false }); assert.equal(k2.listing(), null);
  const k3 = new RoomLogic('K3'); k3.join('a', 'A', true, { mode: 'rp', rated: true }); assert.equal(k3.listing(), null);
});

test('Ranked Play: leaving on purpose isn\'t mistaken for a dropped connection', () => {
  const clock = { t: 0 };
  const { r } = rpMatch(clock);
  tickTo(r, clock);
  r.message('b', { t: 'bye' });
  r.disconnect('b');
  assert.equal(r.rp.stage, 'ended'); assert.equal(r.rp.winner, 'a');
  assert.equal(r.players.length, 1);
});

test('a dropped connection mid-song keeps the player\'s place until they reconnect; leaving on purpose does not', () => {
  const clock = { t: 0 };
  const r = new RoomLogic('DROP', () => clock.t);
  r.join('a', 'Alice', true, { cid: 'ca' }); r.join('b', 'Bob', false, { cid: 'cb' });
  r.message('a', { t: 'map', map: MAP }); r.message('b', { t: 'hasMap', has: true });
  r.message('a', { t: 'ready', ready: true }); r.message('b', { t: 'ready', ready: true });
  r.message('a', { t: 'start' });
  assert.equal(r.state, 'playing');
  r.message('a', { t: 'score', score: 123456, acc: 0.98, combo: 50, maxCombo: 50, hp: 1, pp: 10 });
  // Bob's connection drops: Alice doesn't win on the spot
  r.disconnect('b');
  assert.equal(r.get('b').away, true);
  fin(r, 'a', { score: 500000 });
  assert.equal(r.state, 'playing', 'the match waits for Bob');
  clock.t += 30000; r.tick();
  assert.equal(r.state, 'playing');
  // he's back (same browser) and finishes his song
  const back = r.join('b2', 'Bob', false, { cid: 'cb' });
  assert.equal(back.as, 'b');
  const caught = back.out.find(o => o.msg.t === 'opp');
  assert.ok(caught && caught.to === 'b' && caught.msg.id === 'a' && caught.msg.score === 123456, 'he gets Alice\'s latest score straight back');
  const out = fin(r, 'b', { score: 700000 });
  assert.equal(msgs(out, 'results')[0].msg.results.winner, 'b', 'his result counts');
  // next match: Bob drops and never comes back — after a minute he's gone and Alice wins by forfeit
  r.message('a', { t: 'ready', ready: true }); r.message('b', { t: 'ready', ready: true });
  r.message('a', { t: 'start' });
  r.disconnect('b');
  clock.t += 60000;
  const late = r.tick();
  assert.equal(msgs(late, 'results')[0].msg.results.winner, 'a');
  // a third: closing the tab (bye) ends it at once
  const r2 = new RoomLogic('BYE', () => clock.t);
  r2.join('a', 'Alice', true, { cid: 'ca' }); r2.join('b', 'Bob', false, { cid: 'cb' });
  r2.message('a', { t: 'map', map: MAP }); r2.message('b', { t: 'hasMap', has: true }); r2.message('a', { t: 'ready', ready: true }); r2.message('b', { t: 'ready', ready: true }); r2.message('a', { t: 'start' });
  r2.message('b', { t: 'bye' });
  const now = r2.disconnect('b');
  assert.equal(msgs(now, 'results')[0].msg.results.winner, 'a');
});

test('Ranked Play: both choose a star rating; one who doesn\'t in time takes the other\'s, and the deck follows it', () => {
  const clock = { t: 0 };
  const r = new RoomLogic('ST', () => clock.t, () => 0.25);
  r.join('a', 'Alice', true, { mode: 'rp', keys: 4 });
  r.join('b', 'Bob', false, {});
  assert.equal(r.rp.stage, 'stars');
  assert.deepEqual(r.message('a', { t: 'rpStars', stars: 'abc' }), [], 'not a number: ignored');
  r.message('a', { t: 'rpStars', stars: 99 });
  assert.equal(r.rp.user('a').pref, 15, 'clamped to 15★');
  assert.deepEqual(r.message('a', { t: 'rpStars', stars: 2 }), [], 'locked in once chosen');
  clock.t = r.rp.deadline;
  const out = r.tick();
  assert.equal(r.rp.stage, 'deal');
  assert.equal(r.rp.user('b').pref, 15, 'the other player\'s choice');
  const ask = out.find(o => o.msg && o.msg.t === 'rpDeck');
  assert.ok(ask && ask.msg.targets.every(t => t > 13), 'deck drawn around 15★');
});

test('each lounge joins only its own kind of room: a duel from the Ranked Play lounge, a room from the multiplayer lounge', () => {
  const duel = new RoomLogic('RD', () => 0);
  duel.join('a', 'Alice', true, { mode: 'rp', keys: 4 });
  const no = duel.join('b', 'Bob', false, { want: 'room' });
  assert.equal(no.ok, false); assert.match(no.error, /Ranked Play/);
  assert.equal(duel.players.length, 1, 'the refused player never entered');
  assert.equal(duel.rp.stage, 'waitjoin');
  assert.ok(duel.join('b', 'Bob', false, { want: 'rp' }).ok);
  const room = new RoomLogic('RR', () => 0);
  room.join('a', 'Alice', true, {});
  const no2 = room.join('b', 'Bob', false, { want: 'rp' });
  assert.equal(no2.ok, false); assert.match(no2.error, /regular room/);
  assert.ok(room.join('b', 'Bob', false, { want: 'room' }).ok);
  assert.ok(room.join('c', 'Cat', false, {}).ok, 'an invite link joins whatever the room is');
});
