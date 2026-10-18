// .osz / .osk archives: what we write reads back, the fallback inflater reads what zlib writes, and a damaged entry stops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import vm from 'node:vm';

const ctx = { TextEncoder, TextDecoder, Blob, Response, DecompressionStream, TransformStream, console, normPath: p => p.replace(/\\/g, '/') };
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

/** A one-entry archive with a deflated entry, saying it unpacks to `says` bytes. */
function deflatedZip(name, raw, says) {
  const data = deflateRawSync(raw), nm = Buffer.from(name), lh = Buffer.alloc(30), ch = Buffer.alloc(46), end = Buffer.alloc(22);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(says, 22); lh.writeUInt16LE(nm.length, 26);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(says, 24); ch.writeUInt16LE(nm.length, 28);
  const cdAt = 30 + nm.length + data.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + nm.length, 12); end.writeUInt32LE(cdAt, 16);
  const buf = Buffer.concat([lh, nm, data, ch, nm, end]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

test('a deflated entry unpacks to what the archive says', async () => {
  const raw = Buffer.from('osu file format v14\n'.repeat(5000));
  const zip = new ZipReader(deflatedZip('a.osu', raw, raw.length));
  assert.equal(Buffer.compare(Buffer.from(await zip.read(zip.entries[0])), raw), 0);
});

test('an entry that unpacks into far more than it says (a "zip bomb") is stopped', async () => {
  const raw = Buffer.alloc(40 * 1024 * 1024); // (40 MB of zeros: a few KB packed)
  const zip = new ZipReader(deflatedZip('bomb.osu', raw, 1000));
  await assert.rejects(zip.read(zip.entries[0]), /bigger than it says/);
  // (and the fallback inflater, for browsers without DecompressionStream)
  const e = zip.entries[0], start = zip._start(e);
  assert.throws(() => Inflate(zip.u8.subarray(start, start + e.csize), e.usize, ZipReader.limit(e)), /bigger than it says/);
});
