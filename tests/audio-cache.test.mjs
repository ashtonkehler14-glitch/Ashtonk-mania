// Decoded songs kept for song select and gameplay: a few, and never more than the device's memory can spare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { __ctx } = load(['00-util.js', '05-audio.js']);
const { trimAudioCache, audioBudget } = __ctx;
const MB = 1048576;
/** A stand-in for a decoded song of `mb` megabytes (stereo float32). */
const song = mb => ({ length: mb * MB / 8, numberOfChannels: 2 });

test('a phone (4 GB) keeps decoded songs within its budget, always the newest', () => {
  __ctx.navigator = { deviceMemory: 4 };
  assert.equal(audioBudget(), 160 * MB);
  const m = new Map([['a', song(90)], ['b', song(90)], ['c', song(90)]]);
  trimAudioCache(m, 4, v => v);
  assert.deepEqual([...m.keys()], ['c']); // (90 + 90 is already over 160)
  const big = new Map([['marathon', song(400)]]);
  trimAudioCache(big, 4, v => v);
  assert.deepEqual([...big.keys()], ['marathon']); // (the one being played stays, however big)
});

test('a computer keeps more, still at most the count asked for; songs still decoding are never dropped', () => {
  __ctx.navigator = { deviceMemory: 8 };
  const m = new Map([['a', song(40)], ['b', null], ['c', song(40)], ['d', song(40)], ['e', song(40)]]);
  trimAudioCache(m, 4, v => v);
  assert.deepEqual([...m.keys()], ['b', 'c', 'd', 'e']);
  __ctx.navigator = { deviceMemory: 2 }; // (100 MB at the least)
  const n = new Map([['a', song(60)], ['b', null], ['c', song(60)]]);
  trimAudioCache(n, 4, v => v);
  assert.deepEqual([...n.keys()], ['b', 'c']);
});
