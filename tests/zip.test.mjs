// .osz / .osk archives: what we write reads back, the fallback inflater reads what zlib writes, and a damaged entry stops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import vm from 'node:vm';

const ctx = { TextEncoder, TextDecoder, Blob, Response, DecompressionStream, console, normPath: p => p.replace(/\\/g, '/') };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../src/js/02-zip.js', import.meta.url), 'utf8') + ';this.Inflate = Inflate; this.ZipReader = ZipReader; this.writeZip = writeZip;', ctx);
const { Inflate, ZipReader, writeZip } = ctx;

test('the fallback inflater reads what zlib writes (stored, fixed and dynamic blocks)', () => {
  for (const level of [0, 1, 9]) {
    const raw = Buffer.from('osu file format v14\n[HitObjects]\n'.repeat(3000));
    const out = Inflate(new Uint8Array(deflateRawSync(raw, { level })));
    assert.equal(Buffer.compare(Buffer.from(out), raw), 0, `level ${level}`);
  }
});

test('a deflated entry cut short stops with an error instead of reading on for ever', () => {
  const d = deflateRawSync(Buffer.from('hello hello hello world '.repeat(2000)));
  assert.throws(() => Inflate(new Uint8Array(d.subarray(0, 50))), /cut short/);
});

test('an archive we write reads back, names in any script included', async () => {
  const files = [{ name: 'Song [Hard].osu', data: new TextEncoder().encode('osu file format v14') }, { name: '曲/bg.jpg', data: new Uint8Array([1, 2, 3]) }];
  const zip = new ZipReader(await writeZip(files).arrayBuffer());
  assert.deepEqual(Array.from(zip.entries, e => e.name), files.map(f => f.name)); // (made in this realm: the vm's arrays aren't the same kind)
  assert.deepEqual([...await zip.read(zip.entries[1])], [1, 2, 3]);
});

test('something that isn\'t an archive is said to be corrupt', () => {
  assert.throws(() => new ZipReader(new Uint8Array(100).buffer), /Corrupt archive/);
});
