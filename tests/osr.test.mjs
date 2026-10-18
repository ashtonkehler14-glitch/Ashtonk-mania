// The .osr replay format's LZMA: what we write reads back, and a damaged or made-up file stops instead of eating memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { TextEncoder, TextDecoder, console };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../src/js/11c-osr.js', import.meta.url), 'utf8') + ';this.LZMA = LZMA; this.md5Hex = md5Hex;', ctx);
const { LZMA, md5Hex } = ctx;

test('LZMA: our replays\' key presses read back exactly', () => {
  const data = new TextEncoder().encode('12|3|0|0,'.repeat(5000) + '-12345|0|0|42');
  const back = LZMA.decode(LZMA.encode(data));
  assert.equal(back.length, data.length);
  assert.ok(back.every((v, i) => v === data[i]));
});

test('LZMA: a stream cut short (no size, no end marker) stops with an error', () => {
  const enc = LZMA.encode(new TextEncoder().encode('5|1|0|0,'.repeat(3000)));
  const cut = enc.slice(0, 200);
  for (let i = 5; i < 13; i++) cut[i] = 0xff; // (size unknown)
  assert.throws(() => LZMA.decode(cut), /Corrupt/);
});

test('LZMA: a file claiming a huge size is refused before anything is allocated', () => {
  const enc = LZMA.encode(new TextEncoder().encode('1|1|0|0'));
  enc[12] = 0x10; // (2^60 bytes)
  assert.throws(() => LZMA.decode(enc), /too big/);
});

test('md5Hex matches the known digests', () => {
  assert.equal(md5Hex(new Uint8Array(0)), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5Hex(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')), '9e107d9d372bb6826bd81d3542a419d6');
});
