import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { load } from './load.mjs';
const { md5Hex } = load(['00-util.js']);

test('md5Hex: the same MD5 as osu! uses for beatmap files, at every length around a block', () => {
  for (const str of ['', 'a', 'abc', 'The quick brown fox jumps over the lazy dog', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'y'.repeat(1000), 'ünïcødé [Hard]\r\n']) {
    const b = new TextEncoder().encode(str);
    assert.equal(md5Hex(b), createHash('md5').update(b).digest('hex'), `length ${b.length}`);
  }
});
