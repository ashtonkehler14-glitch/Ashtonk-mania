// Player codes: type your code on another device and it's you — no second copy of you on the rankings after
// importing a save; codes that can't be guessed or worked back from what the server keeps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceLogic, newPlayerCode, cleanPlayerCode, codeHash, CODE_ALPHABET32 } from '../worker/multiplayer.js';

const KEY_A = 'a'.repeat(32), KEY_B = 'b'.repeat(32), KEY_NEW = 'd'.repeat(32);
const play = (score, pp) => ({ score, accuracy: 0.98, maxCombo: 500, grade: 'S', mods: [], counts: [1, 0, 0, 0, 0, 0], pp, stars: 4, title: 'Song', artist: 'Artist', version: 'Hard' });
const key = n => n.repeat(64).slice(0, 64);

test('codes: 16 characters, 80 random bits, only the fingerprint kept; typed any which way', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = newPlayerCode();
    assert.match(c, /^[0-9A-HJKMNP-TV-Z]{16}$/);
    seen.add(c);
  }
  assert.equal(seen.size, 2000, 'no two alike');
  assert.equal(CODE_ALPHABET32.length, 32, '5 bits a character: 80 bits a code');
  // every character turns up about as often as the others (nothing to bias a guess)
  const n = new Map();
  for (const c of seen) for (const ch of c) n.set(ch, (n.get(ch) || 0) + 1);
  const counts = [...n.values()], mean = 2000 * 16 / 32;
  assert.equal(counts.length, 32);
  assert.ok(counts.every(x => Math.abs(x - mean) < mean * 0.15), JSON.stringify(Object.fromEntries(n)));
  const c = 'K7QM3XRA9DPZW2HF';
  assert.equal(cleanPlayerCode('k7qm-3xra-9dpz-w2hf'), c, 'lower case, dashes');
  assert.equal(cleanPlayerCode(' K7QM 3XRA 9DPZ W2HF '), c, 'spaces');
  assert.equal(cleanPlayerCode('KOOO-IIII-LLLL-0000'), 'K000111111110000', 'O is 0, I and L are 1');
  assert.equal(cleanPlayerCode('K7QM-3XRA-9DPZ-W2H'), '', 'too short');
  assert.equal(cleanPlayerCode('K7QM-3XRA-9DPZ-W2HU'), '', 'U isn\'t in the alphabet');
  assert.equal(cleanPlayerCode('<script>alert(1)</script>'), '');
  const h = codeHash(c);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes(c.toLowerCase()) && h !== codeHash('K7QM3XRA9DPZW2HG'));
});

test('codes: a new code replaces the old one; only fingerprints are kept', () => {
  const p = new PresenceLogic();
  p.setCode('playerone', codeHash('AAAAAAAAAAAAAAAA'));
  p.setCode('playerone', codeHash('BBBBBBBBBBBBBBBB'));
  assert.equal(p.codes.get(codeHash('AAAAAAAAAAAAAAAA')), undefined, 'the old code stops working');
  assert.equal(p.codes.get(codeHash('BBBBBBBBBBBBBBBB')), 'playerone');
  assert.ok(![...p.codes.keys()].some(k => /A{16}|B{16}/.test(k)), 'no code itself is kept');
});

test('codes: typing your code on a second device merges what it had — one player on the rankings', () => {
  const p = new PresenceLogic();
  // device A: plays, gets a code
  p.join('a', { name: 'Kai', pid: 'deviceaa', key: KEY_A });
  p.recordVerified('deviceaa', key('1'), play(800000, 120));
  p.setCode('deviceaa', codeHash('K7QM3XRA9DPZW2HF'));
  // device B: a save imported there, playing as a player of its own — better on one beatmap, another beatmap too, a friend and a daily streak
  p.join('b', { name: 'Kai', pid: 'devicebb', key: KEY_B });
  p.recordVerified('devicebb', key('1'), play(950000, 150));
  p.recordVerified('devicebb', key('2'), play(700000, 80));
  p.join('f', { name: 'Friend', pid: 'friendff', key: 'f'.repeat(32) });
  p.makeFriends('devicebb', 'Kai', 'friendff', 'Friend');
  p.dailyStats.set('devicebb', { plays: 3, current: 2, best: 2, last: '2026-10-15' });
  p.profiles.set('devicebb', { name: 'Kai', plays: 40, top: [{ title: 'B', version: 'X', pp: 150, mapHash: 'b'.repeat(32) }] });
  p.profiles.set('deviceaa', { name: 'Kai', plays: 10, top: [{ title: 'A', version: 'Y', pp: 120, mapHash: 'a'.repeat(32) }] });
  assert.equal(p.rankings('deviceaa').total, 2, 'two of Kai before');

  const target = p.codes.get(codeHash(cleanPlayerCode('k7qm-3xra-9dpz-w2hf')));
  const r = p.linkDevice(target, 'devicebb', KEY_B, KEY_NEW);
  assert.equal(r.merged, true);
  assert.equal(r.pid, 'deviceaa');
  assert.equal(r.name, 'Kai');
  const rk = p.rankings('deviceaa');
  assert.equal(rk.total, 1, 'one Kai on the rankings');
  const rec = p.ranks.get('deviceaa');
  assert.equal(rec.bests[key('1')].pp, 150, 'the better play on a beatmap both played');
  assert.equal(rec.bests[key('2')].pp, 80, 'and the other device\'s other beatmap');
  assert.ok(!p.ranks.has('devicebb'));
  const board = p.boards.get(key('1'));
  assert.deepEqual(board.map(x => [x.pid, x.score]), [['deviceaa', 950000]], 'one score each on a beatmap\'s board');
  assert.ok(p.friends.get('deviceaa').has('friendff') && p.friends.get('friendff').has('deviceaa') && !p.friends.get('friendff').has('devicebb'), 'friends come along');
  assert.deepEqual(p.dailyStats.get('deviceaa'), { plays: 3, current: 2, best: 2, last: '2026-10-15' });
  assert.equal(p.profiles.get('deviceaa').top.length, 2, 'both devices\' best plays on the profile');
  assert.ok(p.keyOk('deviceaa', KEY_A) && p.keyOk('deviceaa', KEY_NEW), 'each device has a key of its own');
  assert.ok(!p.keyOk('devicebb', KEY_B), 'the old id is gone');
  // device A is told a new device started playing as them (device B's own tab isn't)
  assert.ok(r.out.some(o => o.to === 'a' && o.msg.t === 'codeUsed'), JSON.stringify(r.out.map(o => [o.to, o.msg.t])));
  assert.ok(!r.out.some(o => o.to === 'b' && o.msg.t === 'codeUsed'));
});

test('codes: a device whose key isn\'t its own merges nothing; signing devices out', () => {
  const p = new PresenceLogic();
  p.join('a', { name: 'Moe', pid: 'moeplay', key: KEY_A });
  p.setCode('moeplay', codeHash('MMMMMMMMMMMMMMMM'));
  p.join('x', { name: 'X', pid: 'xother1', key: KEY_B });
  p.recordVerified('xother1', key('3'), play(500000, 50));
  const r = p.linkDevice('moeplay', 'xother1', 'wrong'.repeat(8), KEY_NEW);
  assert.equal(r.merged, false);
  assert.ok(p.ranks.has('xother1'), 'their scores stay theirs');
  // the new device is online as the player: Sign out other devices from it tells the others (and only them)
  p.join('n', { name: 'Moe', pid: 'moeplay', key: KEY_NEW });
  const o = p.onlyKey('moeplay', KEY_NEW);
  assert.equal(o.n, 1);
  assert.deepEqual(o.out.map(x => [x.to, x.msg.t]), [['a', 'repid']]);
  assert.deepEqual(o.gone, ['a']);
  assert.ok(!p.keyOk('moeplay', KEY_A) && p.keyOk('moeplay', KEY_NEW));
  // a device signing itself out; nobody can take the id over once every device has
  p.dropKey('moeplay', KEY_NEW);
  assert.ok(!p.keyOk('moeplay', KEY_NEW));
  assert.equal(p.claim('moeplay', 'z'.repeat(32)), false);
});

test('codes: profiles from two devices are put together, never brought down', () => {
  const a = { plays: 50, playtime: 1000, grades: { S: 4 }, level: 20, xpInto: 5, top: [{ title: 'A', version: 'H', pp: 200 }, { title: 'C', version: 'H', pp: 90 }], recent: [{ title: 'A', version: 'H', date: 5 }], medals: { m1: 1 } };
  const b = { plays: 3, playtime: 50, grades: { S: 1, SS: 1 }, level: 2, xpInto: 1, top: [{ title: 'B', version: 'H', pp: 150 }, { title: 'C', version: 'H', pp: 100 }], recent: [{ title: 'B', version: 'H', date: 9 }], medals: { m2: 1 } };
  const m = PresenceLogic.mergeProfile(a, b);
  assert.equal(m.plays, 50);
  assert.equal(m.level, 20);
  assert.deepEqual(m.top.map(x => [x.title, x.pp]), [['A', 200], ['B', 150], ['C', 100]]);
  assert.deepEqual(m.recent.map(x => x.title), ['B', 'A']);
  assert.deepEqual(m.medals, { m1: 1, m2: 1 });
});

test('imported backups: a play copied onto someone else\'s profile counts only for whoever reported it first', () => {
  const p = new PresenceLogic(), checked = [];
  p.verifyTop = (pid, top) => checked.push([pid, top.map(x => x.title)]);
  const X = { title: 'X', version: 'H', pp: 300, mapHash: 'a'.repeat(32), score: 950000, date: 1700000000000 };
  const Y = { title: 'Y', version: 'H', pp: 120, mapHash: 'b'.repeat(32), score: 800000, date: 1700000500000 };
  p.join('a', { name: 'Ann', pid: 'annplay1', key: KEY_A });
  p.join('b', { name: 'Ann', pid: 'importer', key: KEY_B });
  p.message('a', { t: 'stats', profile: { plays: 5, top: [X] } });
  // a backup of Ann's imported elsewhere: the same play (beatmap, score, moment) — and a play of the importer's own
  p.message('b', { t: 'stats', profile: { plays: 6, top: [X, Y] } });
  assert.deepEqual(checked, [['annplay1', ['X']], ['importer', ['Y']]], 'the copy counts for nobody but Ann');
  // the same play again from Ann still counts for Ann; a play with no moment to it can't be told apart, and counts as before
  p.message('a', { t: 'stats', profile: { plays: 7, top: [X, { title: 'Z', pp: 50 }] } });
  assert.deepEqual(checked[2], ['annplay1', ['X', 'Z']]);
  // Ann's first device typed her code on another — merged away — so the player she is now can take the play
  p.recordVerified('newann12', 'c'.repeat(64), play(100000, 10));
  p.ranks.delete('annplay1'); p.auth.delete('annplay1');
  assert.deepEqual(p.ownPlays('newann12', [X]).map(x => x.title), ['X']);
  assert.deepEqual(p.ownPlays('importer', [X]).map(x => x.title), [], 'still not the importer\'s');
});

test('your settings and skin: kept per player, the skin in 1 MB pieces; a new one replaces the old; too big is turned down', async () => {
  const { PlayerVault, SKIN_MAX } = await import('../worker/vault.js');
  const m = new Map();
  const storage = {
    get: async k => m.get(k), put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, b); else m.set(k, v); },
    delete: async k => { for (const x of [].concat(k)) m.delete(x); }, deleteAll: async () => m.clear(),
  };
  const v = new PlayerVault({ storage });
  const call = (path, body, headers = {}) => v.fetch(new Request('https://vault' + path, { method: 'POST', body, headers, duplex: 'half' }));
  const stream = (n, piece = 300000) => new ReadableStream({ start(c) { for (let i = 0; i < n; i += piece) c.enqueue(new Uint8Array(Math.min(piece, n - i)).fill(i / piece % 251)); c.close(); } });
  const skinHdr = (id, name) => ({ 'x-am-skin': encodeURIComponent(JSON.stringify({ id, name })) });

  assert.deepEqual(await (await call('/restore')).json(), { ok: true, settings: null, skin: null, rev: 0 }, 'nothing kept yet');
  const first = await call('/settings', JSON.stringify({ v: 1, values: { 'gameplay.scrollSpeed': 30 }, skin: { id: 'skin-a', name: 'A' } }));
  assert.deepEqual([first.status, (await first.json()).rev], [200, 1], 'each change is numbered');
  assert.equal((await call('/settings', 'not json')).status, 400);

  const size = 2.5 * 1024 * 1024;
  let r = await call('/skin-up', stream(size), skinHdr('skin-a', 'A'));
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal([...m.keys()].filter(k => k.startsWith('sk:')).length, 3, 'three pieces');
  const kept = await (await call('/restore')).json();
  assert.deepEqual([kept.settings.values['gameplay.scrollSpeed'], kept.skin.name, kept.skin.size], [30, 'A', size]);
  const back = new Uint8Array(await (await call('/skin')).arrayBuffer());
  assert.equal(back.length, size);
  assert.equal(back[300000], 1, 'the bytes as sent');

  // a new skin: the old pieces go
  r = await call('/skin-up', stream(1000), skinHdr('skin-b', 'B'));
  assert.equal(r.status, 200);
  assert.deepEqual([...m.keys()].filter(k => k.startsWith('sk:')).length, 1);
  // too big: turned down, nothing left behind, the kept one stays
  r = await call('/skin-up', stream(SKIN_MAX + 1, 1 << 20), skinHdr('skin-c', 'C'));
  assert.equal(r.status, 413);
  assert.equal([...m.keys()].filter(k => k.startsWith('sk:')).length, 1);
  assert.equal((await (await call('/restore')).json()).skin.name, 'B');
  // merged into another player: nothing of theirs is kept
  await call('/wipe');
  assert.equal(m.size, 0);
});

test('your name and picture, beatmap offsets and installed beatmaps are kept with your settings; each change gets the next number', async () => {
  const { PlayerVault, mergeSettings } = await import('../worker/vault.js');
  const m = new Map(), storage = { get: async k => m.get(k), put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, b); else m.set(k, v); }, delete: async () => {} };
  const v = new PlayerVault({ storage });
  const call = (path, body) => v.fetch(new Request('https://vault' + path, { method: 'POST', body }));
  await call('/settings', JSON.stringify({ v: 2, full: true, values: { a: 1 }, profile: { name: 'Kai', avatar: 'preset:neru' }, offsets: { h1: 12 }, sets: [[100, 'Song', 'Artist', 'Mapper']] }));
  const r = await call('/settings', JSON.stringify({ v: 2, values: {}, profile: { name: 'Kai2', avatar: 'preset:miku' } }));
  assert.equal((await r.json()).rev, 2);
  const kept = await (await call('/restore')).json();
  assert.deepEqual([kept.rev, kept.settings.profile, kept.settings.offsets, kept.settings.sets], [2, { name: 'Kai2', avatar: 'preset:miku' }, { h1: 12 }, [[100, 'Song', 'Artist', 'Mapper']]], 'only what changed is replaced');
  assert.deepEqual(mergeSettings({ values: {} }, { values: {}, sets: [] }).sets, []);
});

test('switching a device from one account to another merges nothing: both stay as they were, each with its code', () => {
  const p = new PresenceLogic();
  p.join('a', { name: 'Ann', pid: 'annplay', key: KEY_A });
  p.setCode('annplay', codeHash('AAAAAAAAAAAAAAAA'));
  p.recordVerified('annplay', key('5'), play(800000, 120));
  p.join('b', { name: 'Ben', pid: 'benplay', key: KEY_B });
  p.setCode('benplay', codeHash('BBBBBBBBBBBBBBBB'));
  // Ann's device types Ben's code
  const r = p.linkDevice('benplay', 'annplay', KEY_A, KEY_NEW);
  assert.equal(r.merged, false, 'an account is never merged into another');
  assert.ok(p.ranks.get('annplay') && p.ranks.get('annplay').pp > 0, 'Ann keeps her plays');
  assert.equal(p.codes.get(codeHash('AAAAAAAAAAAAAAAA')), 'annplay', 'and her code still works');
  assert.ok(!(p.ranks.get('benplay') && p.ranks.get('benplay').pp > 0), 'Ben gets none of them');
});
