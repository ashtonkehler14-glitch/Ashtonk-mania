/* ZIP archive support (.osz / .osk are plain ZIP files).
 * Reader: parses the central directory and inflates with the native DecompressionStream
 * when available, falling back to a small pure-JS inflater. Writer: store-only (for exports). */

const Inflate = (() => {
  // Compact RFC1951 inflater (fallback only; native DecompressionStream is preferred).
  function buildHuff(lengths, n) {
    const counts = new Uint16Array(16), offs = new Uint16Array(16), syms = new Uint16Array(n);
    for (let i = 0; i < n; i++) counts[lengths[i]]++;
    counts[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    for (let i = 0; i < n; i++) if (lengths[i]) syms[offs[lengths[i]]++] = i;
    return { counts, syms };
  }
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  let fixedL, fixedD;
  function fixed() {
    if (fixedL) return;
    const l = new Uint8Array(288);
    for (let i = 0; i < 144; i++) l[i] = 8;
    for (let i = 144; i < 256; i++) l[i] = 9;
    for (let i = 256; i < 280; i++) l[i] = 7;
    for (let i = 280; i < 288; i++) l[i] = 8;
    fixedL = buildHuff(l, 288);
    fixedD = buildHuff(new Uint8Array(30).fill(5), 30);
  }
  return function inflate(src, sizeHint = 0) {
    let pos = 0, bit = 0, out = new Uint8Array(Math.max(sizeHint, src.length * 4, 1024)), op = 0;
    const need = n => { if (op + n > out.length) { const o = new Uint8Array(Math.max(out.length * 2, op + n)); o.set(out); out = o; } };
    const bits = n => {
      let v = 0;
      for (let i = 0; i < n; i++) { v |= ((src[pos] >> bit) & 1) << i; if (++bit === 8) { bit = 0; pos++; } }
      return v;
    };
    const decode = t => {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len < 16; len++) {
        code |= bits(1);
        const count = t.counts[len];
        if (code - count < first) return t.syms[index + (code - first)];
        index += count; first += count; first <<= 1; code <<= 1;
      }
      throw new Error('bad huffman code');
    };
    let final = 0;
    do {
      final = bits(1);
      const type = bits(2);
      if (type === 0) {
        if (bit) { bit = 0; pos++; }
        const len = src[pos] | (src[pos + 1] << 8); pos += 4;
        need(len); out.set(src.subarray(pos, pos + len), op); op += len; pos += len;
        continue;
      }
      let lt, dt;
      if (type === 1) { fixed(); lt = fixedL; dt = fixedD; }
      else if (type === 2) {
        const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) cl[CLORDER[i]] = bits(3);
        const clt = buildHuff(cl, 19);
        const lens = new Uint8Array(hlit + hdist);
        for (let i = 0; i < hlit + hdist;) {
          const sym = decode(clt);
          if (sym < 16) lens[i++] = sym;
          else if (sym === 16) { const p = lens[i - 1], r = 3 + bits(2); for (let k = 0; k < r; k++) lens[i++] = p; }
          else if (sym === 17) i += 3 + bits(3);
          else i += 11 + bits(7);
        }
        lt = buildHuff(lens.subarray(0, hlit), hlit);
        dt = buildHuff(lens.subarray(hlit), hdist);
      } else throw new Error('invalid deflate block');
      for (;;) {
        const sym = decode(lt);
        if (sym < 256) { need(1); out[op++] = sym; }
        else if (sym === 256) break;
        else {
          const s = sym - 257, len = LBASE[s] + bits(LEXT[s]);
          const ds = decode(dt), dist = DBASE[ds] + bits(DEXT[ds]);
          need(len);
          for (let k = 0; k < len; k++, op++) out[op] = out[op - dist];
        }
      }
    } while (!final);
    return out.subarray(0, op);
  };
})();

const CRC32 = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return bytes => { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
})();

class ZipReader {
  /** @param {ArrayBuffer} buf */
  constructor(buf) {
    this.buf = buf;
    this.u8 = new Uint8Array(buf);
    this.dv = new DataView(buf);
    this.entries = [];
    this._parse();
  }
  _parse() {
    const { dv, u8 } = this;
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Corrupt archive: end of central directory not found');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const utf8 = new TextDecoder('utf-8'), latin = new TextDecoder('latin1');
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt archive: bad central directory');
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const nameBytes = u8.subarray(p + 46, p + 46 + nlen);
      const name = normPath((flags & 0x800 ? utf8 : ZipReader._looksUtf8(nameBytes) ? utf8 : latin).decode(nameBytes));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      this.entries.push({ name, method, csize, usize, lho });
    }
  }
  static _looksUtf8(b) { try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch (e) { return false; } }

  async read(entry) {
    const { dv } = this;
    if (dv.getUint32(entry.lho, true) !== 0x04034b50) throw new Error(`Corrupt archive entry: ${entry.name}`);
    const start = entry.lho + 30 + dv.getUint16(entry.lho + 26, true) + dv.getUint16(entry.lho + 28, true);
    const data = this.u8.subarray(start, start + entry.csize);
    if (entry.method === 0) return data.slice();
    if (entry.method !== 8) throw new Error(`Unsupported compression in ${entry.name}`);
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([data]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) { /* fall back to JS inflate */ }
    }
    return Inflate(data, entry.usize);
  }
  async readText(entry) { return new TextDecoder('utf-8').decode(await this.read(entry)); }
}

/** Store-only ZIP writer (exports .osz / .osk bundles). files: [{name, data: Uint8Array}] */
function writeZip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = CRC32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
