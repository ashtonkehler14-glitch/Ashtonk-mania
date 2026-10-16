// Accounts: one player on every device signed in — no second copy of you on the rankings after importing a save.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceLogic, passwordHash } from '../worker/multiplayer.js';

const KEY_A = 'a'.repeat(32), KEY_B = 'b'.repeat(32), KEY_B2 = 'c'.repeat(32);
const pass = { salt: '00', hash: 'h', iter: 1 };
const play = (score, pp, extra = {}) => ({ score, accuracy: 0.98, maxCombo: 500, grade: 'S', mods: [], counts: [1, 0, 0, 0, 0, 0], pp, stars: 4, title: 'Song', artist: 'Artist', version: 'Hard', ...extra });
const key = n => n.repeat(64).slice(0, 64);
let fresh = 0;
const freshId = () => ({ pid: `fresh${++fresh}x`, key: 'f'.repeat(32) });

test('accounts: a guest makes an account and keeps what it had; usernames are unique and checked', () => {
  const p = new PresenceLogic();
  p.join('t1', { name: 'Ashton', pid: 'guesta1', key: KEY_A });
  p.recordVerified('guesta1', key('1'), play(900000, 100));
  const r = p.createAccount({ name: '  Ashton ', pass, pid: 'guesta1', key: KEY_A, fresh: freshId });
  assert.equal(r.ok, true);
  assert.equal(r.pid, 'guesta1', 'the guest becomes the account');
  assert.equal(r.key, null, 'its key stays the same');
  assert.equal(r.name, 'Ashton');
  assert.equal(p.ranks.get('guesta1').bests[key('1')].pp, 100);
  assert.equal(p.createAccount({ name: 'ashton', pass, pid: 'other12', key: KEY_B, fresh: freshId }).status, 409, 'taken, whatever the case');
  assert.ok(p.createAccount({ name: 'ab', pass, pid: 'other12', key: KEY_B, fresh: freshId }).error, 'too short');
  assert.ok(p.createAccount({ name: 'bad<name>', pass, pid: 'other12', key: KEY_B, fresh: freshId }).error, 'odd characters');
  // somebody else's id (wrong key): the account starts on a new id of its own
  const s = p.createAccount({ name: 'Thief', pass, pid: 'guesta1', key: KEY_B, fresh: freshId });
  assert.ok(s.ok && s.pid !== 'guesta1' && s.key, JSON.stringify(s));
});

test('accounts: the username is the name everywhere; a guest using it shows as a guest', () => {
  const p = new PresenceLogic();
  p.join('t1', { name: 'Neru', pid: 'neruacc', key: KEY_A });
  p.createAccount({ name: 'Neru', pass, pid: 'neruacc', key: KEY_A, fresh: freshId });
  p.join('t2', { name: 'Someone Else', pid: 'neruacc', key: KEY_A });
  assert.equal(p.users.get('t2').name, 'Neru', 'an account\'s name comes from the account');
  p.join('t3', { name: 'neru', pid: 'imposter', key: KEY_B });
  assert.equal(p.users.get('t3').name, 'neru (guest)');
  p.message('t3', { t: 'status', status: 'menu', name: 'NERU' });
  assert.equal(p.users.get('t3').name, 'NERU (guest)', 'renaming to it later too');
});

test('accounts: signing in on a second device merges that device\'s guest — one player on the rankings', () => {
  const p = new PresenceLogic();
  // device A: the account, with a play
  p.join('a', { name: 'Kai', pid: 'deviceaa', key: KEY_A });
  p.recordVerified('deviceaa', key('1'), play(800000, 120));
  p.createAccount({ name: 'Kai', pass, pid: 'deviceaa', key: KEY_A, fresh: freshId });
  // device B: a guest with the same name (an imported save), better on one beatmap, another beatmap too, a friend and a daily streak
  p.join('b', { name: 'Kai', pid: 'devicebb', key: KEY_B });
  assert.equal(p.users.get('b').name, 'Kai (guest)');
  p.recordVerified('devicebb', key('1'), play(950000, 150));
  p.recordVerified('devicebb', key('2'), play(700000, 80));
  p.join('f', { name: 'Friend', pid: 'friendff', key: KEY_B2 });
  p.makeFriends('devicebb', 'Kai', 'friendff', 'Friend');
  p.dailyStats.set('devicebb', { plays: 3, current: 2, best: 2, last: '2026-10-15' });
  p.profiles.set('devicebb', { name: 'Kai', plays: 40, top: [{ title: 'B', version: 'X', pp: 150, mapHash: 'b'.repeat(32) }] });
  p.profiles.set('deviceaa', { name: 'Kai', plays: 10, top: [{ title: 'A', version: 'Y', pp: 120, mapHash: 'a'.repeat(32) }] });
  assert.equal(p.rankings('deviceaa').total, 2, 'two of Kai before');

  const r = p.signIn(p.accounts.get('kai'), 'devicebb', KEY_B, 'd'.repeat(32));
  assert.equal(r.merged, true);
  assert.equal(r.pid, 'deviceaa');
  const rk = p.rankings('deviceaa');
  assert.equal(rk.total, 1, 'one Kai on the rankings');
  assert.equal(rk.list[0].name, 'Kai');
  const rec = p.ranks.get('deviceaa');
  assert.equal(rec.bests[key('1')].pp, 150, 'the better play on a beatmap both played');
  assert.equal(rec.bests[key('2')].pp, 80, 'and the other device\'s other beatmap');
  assert.ok(rec.pp > 150, 'totals worked out from both');
  assert.ok(!p.ranks.has('devicebb'));
  const board = p.boards.get(key('1'));
  assert.equal(board.length, 1, 'one score each on a beatmap\'s board');
  assert.deepEqual([board[0].pid, board[0].score], ['deviceaa', 950000]);
  assert.equal(p.boards.get(key('2'))[0].pid, 'deviceaa');
  assert.ok(p.friends.get('deviceaa').has('friendff') && p.friends.get('friendff').has('deviceaa') && !p.friends.get('friendff').has('devicebb'), 'friends come along');
  assert.deepEqual(p.dailyStats.get('deviceaa'), { plays: 3, current: 2, best: 2, last: '2026-10-15' });
  assert.equal(p.profiles.get('deviceaa').top.length, 2, 'both devices\' best plays on the profile');
  assert.equal(p.profiles.get('deviceaa').plays, 40);
  // both devices are the account now, each with its own key
  assert.ok(p.keyOk('deviceaa', KEY_A) && p.keyOk('deviceaa', 'd'.repeat(32)));
  assert.ok(!p.keyOk('devicebb', KEY_B), 'the guest id is gone');
  assert.equal(p.users.get('b').pid, 'deviceaa', 'a tab still online as the guest is the account now');
  // signing out on one device leaves the other signed in
  p.dropKey('deviceaa', 'd'.repeat(32));
  assert.ok(p.keyOk('deviceaa', KEY_A) && !p.keyOk('deviceaa', 'd'.repeat(32)));
  // nobody can take an account's id once every device has signed out
  p.dropKey('deviceaa', KEY_A);
  assert.equal(p.claim('deviceaa', 'z'.repeat(32)), false);
});

test('accounts: a device that wasn\'t the guest (wrong key) merges nothing', () => {
  const p = new PresenceLogic();
  p.join('a', { name: 'Moe', pid: 'moaccnt', key: KEY_A });
  p.createAccount({ name: 'Moe', pass, pid: 'moaccnt', key: KEY_A, fresh: freshId });
  p.join('x', { name: 'X', pid: 'xguestx', key: KEY_B });
  p.recordVerified('xguestx', key('3'), play(500000, 50));
  const r = p.signIn(p.accounts.get('moe'), 'xguestx', 'wrong'.repeat(8), 'e'.repeat(32));
  assert.equal(r.merged, false);
  assert.ok(p.ranks.has('xguestx'), 'their scores stay theirs');
});

test('accounts: renaming keeps the name unique and changes it everywhere', () => {
  const p = new PresenceLogic();
  p.join('a', { name: 'Old', pid: 'renamer', key: KEY_A });
  p.recordVerified('renamer', key('4'), play(600000, 60));
  p.createAccount({ name: 'Old', pass, pid: 'renamer', key: KEY_A, fresh: freshId });
  p.createAccount({ name: 'Taken', pass, pid: 'another', key: KEY_B, fresh: freshId });
  assert.equal(p.renameAccount('renamer', KEY_A, 'taken').status, 409);
  assert.equal(p.renameAccount('renamer', KEY_B, 'Fresh').status, 403, 'only a signed-in device');
  assert.equal(p.renameAccount('renamer', KEY_A, 'Fresh').name, 'Fresh');
  assert.ok(!p.accounts.has('old') && p.accounts.get('fresh').pid === 'renamer');
  assert.equal(p.users.get('a').name, 'Fresh');
  assert.equal(p.ranks.get('renamer').name, 'Fresh');
});

test('accounts: profiles from two devices are put together, never brought down', () => {
  const a = { plays: 50, playtime: 1000, grades: { S: 4 }, level: 20, xpInto: 5, top: [{ title: 'A', version: 'H', pp: 200 }, { title: 'C', version: 'H', pp: 90 }], recent: [{ title: 'A', version: 'H', date: 5 }], medals: { m1: 1 } };
  const b = { plays: 3, playtime: 50, grades: { S: 1, SS: 1 }, level: 2, xpInto: 1, top: [{ title: 'B', version: 'H', pp: 150 }, { title: 'C', version: 'H', pp: 100 }], recent: [{ title: 'B', version: 'H', date: 9 }], medals: { m2: 1 } };
  const m = PresenceLogic.mergeProfile(a, b);
  assert.equal(m.plays, 50);
  assert.equal(m.level, 20);
  assert.deepEqual(m.top.map(x => [x.title, x.pp]), [['A', 200], ['B', 150], ['C', 100]]);
  assert.deepEqual(m.recent.map(x => x.title), ['B', 'A']);
  assert.deepEqual(m.grades, { XH: 0, SS: 1, SH: 0, S: 4, A: 0 });
  assert.deepEqual(m.medals, { m1: 1, m2: 1 });
});

test('accounts: passwords are kept as salted PBKDF2 hashes', async () => {
  const h1 = await passwordHash('correct horse', 'aabbccdd', 1000), h2 = await passwordHash('correct horse', 'aabbccdd', 1000);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(await passwordHash('correct horse', '11223344', 1000), h1, 'another salt');
  assert.notEqual(await passwordHash('correct horsf', 'aabbccdd', 1000), h1);
});
