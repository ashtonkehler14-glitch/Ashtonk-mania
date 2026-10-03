/* osu! replays (.osr) — the format osu!lazer and osu!stable both read and write (osu.Game/Scoring/Legacy:
 * LegacyScoreDecoder / LegacyScoreEncoder): a header (mode, version, the beatmap's MD5, player, judgement counts,
 * score, combo, mods as legacy bit flags, date) and the key frames, LZMA-compressed — for mania each frame is
 * "time delta|pressed columns as bits|0|0". Replays from lazer import here, and ours export for lazer. */

/** MD5 of bytes (lazer finds a replay's beatmap by the MD5 of its .osu file). */
function md5Hex(bytes) {
  const K = new Int32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0;
  const n = bytes.length, words = ((n + 8) >>> 6) + 1, M = new Int32Array(words * 16);
  for (let i = 0; i < n; i++) M[i >> 2] |= bytes[i] << ((i % 4) * 8);
  M[n >> 2] |= 0x80 << ((n % 4) * 8);
  M[words * 16 - 2] = (n * 8) | 0; M[words * 16 - 1] = Math.floor(n / 0x20000000);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let o = 0; o < M.length; o += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const t = d; d = c; c = b;
      const x = (a + f + K[i] + M[o + g]) | 0, s = S[(i >> 4) * 4 + (i % 4)];
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0; a = t;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0].map(v => [0, 8, 16, 24].map(sh => ((v >>> sh) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

/** LZMA ("alone" format: 5 property bytes, the 8-byte size, the stream) — a decoder after Igor Pavlov's reference
 *  LzmaSpec, and a small encoder that writes every byte as a literal (valid LZMA, just not much smaller). */
const LZMA = {
  decode(src) {
    let ip = 13;
    const props = src[0], lc = props % 9, lp = Math.floor(props / 9) % 5, pb = Math.floor(props / 45);
    let size = 0, unknown = true;
    for (let i = 0; i < 8; i++) { if (src[5 + i] !== 0xff) unknown = false; size += src[5 + i] * 2 ** (8 * i); }
    if (unknown) size = -1;
    let range = 0xffffffff, code = 0;
    const next = () => (ip < src.length ? src[ip++] : 0);
    next(); for (let i = 0; i < 4; i++) code = ((code << 8) | next()) >>> 0;
    const norm = () => { if (range < 0x1000000) { range = (range * 256) >>> 0; code = ((code << 8) | next()) >>> 0; } };
    const bit = (p, i) => {
      const bound = (range >>> 11) * p[i] >>> 0;
      let b;
      if (code < bound) { p[i] += (2048 - p[i]) >> 5; range = bound; b = 0; } else { p[i] -= p[i] >> 5; code = (code - bound) >>> 0; range = (range - bound) >>> 0; b = 1; }
      norm(); return b;
    };
    const direct = n => { let r = 0; for (; n > 0; n--) { range >>>= 1; let b = 0; if (code >= range) { code = (code - range) >>> 0; b = 1; } r = (r << 1) | b; norm(); } return r >>> 0; };
    const probs = n => new Uint16Array(n).fill(1024);
    const tree = (p, base, bits) => { let m = 1; for (let i = 0; i < bits; i++) m = (m << 1) + bit(p, base + m); return m - (1 << bits); };
    const rtree = (p, base, bits) => { let m = 1, s = 0; for (let i = 0; i < bits; i++) { const b = bit(p, base + m); m = (m << 1) + b; s |= b << i; } return s; };
    const lenCoder = () => ({ choice: probs(2), low: probs(16 << 3), mid: probs(16 << 3), high: probs(256) });
    const lenDecode = (L, posState) => bit(L.choice, 0) === 0 ? tree(L.low, posState << 3, 3) : bit(L.choice, 1) === 0 ? 8 + tree(L.mid, posState << 3, 3) : 16 + tree(L.high, 0, 8);
    const lit = probs(0x300 << (lc + lp)), posSlot = probs(4 << 6), posDec = probs(115), align = probs(16);
    const isMatch = probs(192), isRep = probs(12), isRepG0 = probs(12), isRepG1 = probs(12), isRepG2 = probs(12), isRep0Long = probs(192);
    const lenD = lenCoder(), repLenD = lenCoder();
    let out = new Uint8Array(size > 0 ? size : 1 << 16), pos = 0;
    const put = b => { if (pos >= out.length) { const o = new Uint8Array(out.length * 2); o.set(out); out = o; } out[pos++] = b; };
    let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;
    const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;
    while (size < 0 || pos < size) {
      const posState = pos & pbMask;
      if (bit(isMatch, (state << 4) + posState) === 0) {
        const prev = pos ? out[pos - 1] : 0, base = 0x300 * (((pos & lpMask) << lc) + (prev >> (8 - lc)));
        let s = 1;
        if (state >= 7) {
          let mb = out[pos - rep0 - 1];
          do { const mbit = (mb >> 7) & 1; mb <<= 1; const b = bit(lit, base + ((1 + mbit) << 8) + s); s = (s << 1) | b; if (mbit !== b) break; } while (s < 0x100);
        }
        while (s < 0x100) s = (s << 1) | bit(lit, base + s);
        put(s & 0xff);
        state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
        continue;
      }
      let len;
      if (bit(isRep, state) !== 0) {
        if (pos === 0) throw new Error('Corrupt LZMA data');
        if (bit(isRepG0, state) === 0) {
          if (bit(isRep0Long, (state << 4) + posState) === 0) { state = state < 7 ? 9 : 11; put(out[pos - rep0 - 1]); continue; }
        } else {
          let dist;
          if (bit(isRepG1, state) === 0) dist = rep1;
          else { if (bit(isRepG2, state) === 0) dist = rep2; else { dist = rep3; rep3 = rep2; } rep2 = rep1; }
          rep1 = rep0; rep0 = dist;
        }
        len = lenDecode(repLenD, posState);
        state = state < 7 ? 8 : 11;
      } else {
        rep3 = rep2; rep2 = rep1; rep1 = rep0;
        len = lenDecode(lenD, posState);
        state = state < 7 ? 7 : 10;
        const lenState = Math.min(len, 3);
        const slot = tree(posSlot, lenState << 6, 6);
        if (slot < 4) rep0 = slot;
        else {
          const nb = (slot >> 1) - 1;
          let dist = ((2 | (slot & 1)) << nb) >>> 0;
          if (slot < 14) dist += rtree(posDec, dist - slot, nb);
          else { dist += direct(nb - 4) << 4; dist += rtree(align, 0, 4); }
          rep0 = dist >>> 0;
          if (rep0 === 0xffffffff) break; // the end marker
        }
        if (rep0 >= pos) throw new Error('Corrupt LZMA data');
      }
      len += 2;
      for (let i = 0; i < len && (size < 0 || pos < size); i++) put(out[pos - rep0 - 1]);
    }
    return out.subarray(0, pos);
  },
  encode(data) {
    const lc = 3, lp = 0, pb = 2, dict = 1 << 21, out = [];
    out.push((pb * 5 + lp) * 9 + lc, dict & 255, (dict >>> 8) & 255, (dict >>> 16) & 255, (dict >>> 24) & 255);
    for (let i = 0; i < 8; i++) out.push(Math.floor(data.length / 2 ** (8 * i)) & 255);
    let low = 0, range = 0xffffffff, cache = 0, cacheSize = 1;
    const shiftLow = () => {
      if (low < 0xff000000 || low >= 2 ** 32) {
        const carry = low >= 2 ** 32 ? 1 : 0;
        let temp = cache;
        do { out.push((temp + carry) & 255); temp = 0xff; } while (--cacheSize !== 0);
        cache = Math.floor(low / 2 ** 24) & 255;
      }
      cacheSize++;
      low = (low % 2 ** 24) * 256;
    };
    const ebit = (p, i, b) => {
      const bound = (range >>> 11) * p[i] >>> 0;
      if (b === 0) { range = bound; p[i] += (2048 - p[i]) >> 5; } else { low += bound; range = (range - bound) >>> 0; p[i] -= p[i] >> 5; }
      while (range < 0x1000000) { range = (range * 256) >>> 0; shiftLow(); }
    };
    const isMatch = new Uint16Array(192).fill(1024), lit = new Uint16Array(0x300 << (lc + lp)).fill(1024);
    for (let pos = 0; pos < data.length; pos++) {
      ebit(isMatch, (0 << 4) + (pos & 3), 0); // (state stays 0: only literals)
      const prev = pos ? data[pos - 1] : 0, base = 0x300 * (prev >> (8 - lc));
      let s = 1;
      for (let i = 7; i >= 0; i--) { const b = (data[pos] >> i) & 1; ebit(lit, base + s, b); s = (s << 1) | b; }
    }
    for (let i = 0; i < 5; i++) shiftLow();
    return new Uint8Array(out);
  },
};

/** osu!'s legacy mod bits ⇄ our mods (lazer-only mods have no bit and are left out of an .osr). */
const OSR_MODS = [['NF', 1], ['EZ', 2], ['HD', 8], ['HR', 16], ['SD', 32], ['DT', 64], ['HT', 256], ['NC', 512 | 64], ['AT', 2048], ['PF', 16384 | 32], ['FI', 1 << 20], ['RD', 1 << 21], ['MR', 1 << 30]];

const Osr = {
  /** Read an .osr: { mode, version, beatmapMD5, player, counts, score, maxCombo, mods (bits), date, frames, seed }. */
  decode(buf) {
    const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let p = 0;
    const u8 = () => b[p++], u16 = () => { const v = dv.getUint16(p, true); p += 2; return v; }, i32 = () => { const v = dv.getInt32(p, true); p += 4; return v; };
    const i64 = () => { const v = dv.getBigInt64(p, true); p += 8; return v; };
    const str = () => {
      if (u8() !== 0x0b) return '';
      let len = 0, sh = 0, c;
      do { c = u8(); len |= (c & 0x7f) << sh; sh += 7; } while (c & 0x80);
      const s = new TextDecoder().decode(b.subarray(p, p + len)); p += len; return s;
    };
    const mode = u8(), version = i32(), beatmapMD5 = str(), player = str(); str();
    const c300 = u16(), c100 = u16(), c50 = u16(), geki = u16(), katu = u16(), miss = u16();
    const score = i32(), maxCombo = u16(), perfect = u8() === 1, mods = i32() >>> 0; str();
    const ticks = i64();
    const date = Number((ticks - 621355968000000000n) / 10000n);
    const len = i32();
    const data = len > 0 ? b.subarray(p, p + len) : new Uint8Array(0); p += Math.max(0, len);
    const text = data.length ? new TextDecoder('ascii').decode(LZMA.decode(data)) : '';
    let t = 0, seed = 0;
    const frames = [];
    for (const f of text.split(',')) {
      const s = f.split('|');
      if (s.length < 4) continue;
      if (s[0] === '-12345') { seed = parseInt(s[3], 10) || 0; continue; }
      t += Math.round(parseFloat(s[0])) || 0;
      frames.push([t, Math.round(parseFloat(s[1])) & ((1 << 20) - 1)]);
    }
    // osu!stable's fix-ups for the first frames (ReplayWatcher)
    if (frames.length >= 2 && frames[1][0] < frames[0][0]) { frames[1][0] = frames[0][0]; frames[0][0] = 0; }
    if (frames.length >= 3 && frames[0][0] > frames[2][0]) frames[0][0] = frames[1][0] = frames[2][0];
    return { mode, version, beatmapMD5, player, counts: [geki, c300, katu, c100, c50, miss], score, maxCombo, perfect, mods, date, frames, seed };
  },
  /** Write an .osr lazer opens (version 30000000: a lazer replay, without the extra score data block). */
  encode({ beatmapMD5, player, counts, score, maxCombo, perfect, mods, date, frames, seed = 0 }) {
    const out = [], u8 = v => out.push(v & 255), u16 = v => { u8(v); u8(v >> 8); }, i32 = v => { for (let i = 0; i < 4; i++) u8(v >> (8 * i)); };
    const i64 = v => { const d = new DataView(new ArrayBuffer(8)); d.setBigInt64(0, BigInt(v), true); for (let i = 0; i < 8; i++) u8(d.getUint8(i)); };
    const str = s => { if (!s) { u8(0); return; } const e = new TextEncoder().encode(s); u8(0x0b); let n = e.length; do { let c = n & 0x7f; n >>>= 7; if (n) c |= 0x80; u8(c); } while (n); for (const x of e) u8(x); };
    let last = 0, text = '';
    for (const [t, keys] of frames) { const ti = Math.round(t); text += `${ti - last}|${keys}|0|0,`; last = ti; }
    text += `-12345|0|0|${seed | 0}`;
    const data = LZMA.encode(new TextEncoder().encode(text));
    u8(3); i32(30000000); str(beatmapMD5); str(player); str(md5Hex(new TextEncoder().encode(`lazer-${player}-${date}`)));
    const [geki, c300, katu, c100, c50, miss] = counts;
    u16(c300); u16(c100); u16(c50); u16(geki); u16(katu); u16(miss);
    i32(Math.min(2147483647, Math.round(score))); u16(maxCombo); u8(perfect ? 1 : 0); i32(mods); str('');
    i64(BigInt(Math.round(date)) * 10000n + 621355968000000000n);
    i32(data.length); for (const x of data) u8(x);
    i64(-1);
    return new Uint8Array(out);
  },
  modsToBits(mods) { let v = 0; for (const [m, bitv] of OSR_MODS) if (mods.includes(m)) v |= bitv; return v >>> 0; },
  bitsToMods(bits) {
    const out = [];
    for (const [m, bitv] of OSR_MODS) if (((bits & bitv) >>> 0) === bitv >>> 0) out.push(m);
    // (Nightcore and Perfect carry DT and SD's bits too)
    return ModSystem.normalize(out.filter(m => !(m === 'DT' && out.includes('NC')) && !(m === 'SD' && out.includes('PF'))));
  },
  /** Our recorded inputs [t, col, down, …] ⇄ frames [time, pressed-columns bits]. */
  framesFromEvents(ev) {
    const frames = [];
    let keys = 0;
    for (let i = 0; i < ev.length; i += 3) {
      const t = Math.round(ev[i]), bitv = 1 << ev[i + 1];
      keys = ev[i + 2] === 1 ? keys | bitv : keys & ~bitv;
      if (frames.length && frames[frames.length - 1][0] === t) frames[frames.length - 1][1] = keys;
      else frames.push([t, keys]);
    }
    return frames;
  },
  eventsFromFrames(frames, keys) {
    const ev = [];
    let prev = 0;
    for (const [t, k] of frames) {
      const changed = (k ^ prev) & ((1 << keys) - 1);
      for (let c = 0; c < keys; c++) if (changed & (1 << c)) ev.push(t, c, (k >> c) & 1);
      prev = k;
    }
    return ev;
  },
  /** The MD5 of a difficulty's .osu file (remembered on its record once worked out). */
  async mapMD5(rec) {
    if (rec.md5) return rec.md5;
    const blob = await BeatmapManager.getFile(rec.setId, rec.osuPath);
    if (!blob) return null;
    rec.md5 = md5Hex(new Uint8Array(await blob.arrayBuffer()));
    DB.put('maps', rec).catch(() => {});
    return rec.md5;
  },
  async findMap(md5) {
    for (const rec of BeatmapManager.maps.values()) if (rec.md5 === md5) return rec;
    for (const rec of BeatmapManager.maps.values()) if (!rec.md5 && (await this.mapMD5(rec)) === md5) return rec;
    return null;
  },
  /** An .osr → one of our replays (saved), ready to watch. */
  async importFile(file) {
    const o = this.decode(await file.arrayBuffer());
    if (o.mode !== 3) throw new Error(`${file.name}: not an osu!mania replay`);
    const rec = await this.findMap(o.beatmapMD5);
    if (!rec) throw new Error(`${file.name}: its beatmap isn't in your library (import the beatmap first)`);
    const mods = this.bitsToMods(o.mods), [geki, c300, katu, c100, c50, miss] = o.counts;
    const total = geki + c300 + katu + c100 + c50 + miss;
    const accuracy = total ? (300 * (geki + c300) + 200 * katu + 100 * c100 + 50 * c50) / (300 * total) : 0;
    const events = this.eventsFromFrames(o.frames, rec.keys);
    const rep = {
      app: APP_NAME, kind: 'replay', format: 1, id: 'rp-' + uid(), date: o.date || Date.now(),
      mapHash: rec.hash, mapId: rec.id, title: rec.title, artist: rec.artist, version: rec.version, creator: rec.creator,
      keys: rec.keys, mods, rate: ModSystem.rate(mods, {}), seed: o.seed, accuracyMode: Settings.get('gameplay.accuracyMode'),
      windows: timingWindows({ od: rec.od, mods, mode: 'od', rules: RULES }), hp: rec.hp, player: o.player || 'Player',
      duration: events.length ? events[events.length - 3] : 0, modConfig: {}, noFail: mods.includes('NF'), rules: RULES, events,
      summary: { score: o.score, scoreStd: o.version >= 30000000 ? o.score : null, accuracy, maxCombo: o.maxCombo, counts: o.counts, grade: ScoreSystem.gradeFor(accuracy, false, mods, o.counts) },
      scoreId: null, source: 'osr',
    };
    return ReplayManager.importObject(rep);
  },
  /** One of our replays → an .osr file (download). */
  async bytesFor(rep) {
    const rec = BeatmapManager.mapByHash(rep.mapHash) || BeatmapManager.maps.get(rep.mapId);
    if (!rec) return null;
    const md5 = await this.mapMD5(rec);
    const sm = rep.summary || {};
    return this.encode({ beatmapMD5: md5, player: rep.player || ProfileManager.profile.name, counts: sm.counts || [0, 0, 0, 0, 0, 0], score: sm.scoreStd ?? sm.score ?? 0,
      maxCombo: sm.maxCombo || 0, perfect: !!(sm.counts && !sm.counts[5]), mods: this.modsToBits(rep.mods || []), date: rep.date || Date.now(), frames: this.framesFromEvents(rep.events || []), seed: rep.seed || 0 });
  },
  async exportReplay(rep) {
    const bytes = await this.bytesFor(rep);
    if (!bytes) { Toast.err('Can\'t export as .osr', 'The beatmap isn\'t in your library.'); return; }
    const name = `${rep.player || 'Player'} - ${rep.artist} - ${rep.title} [${rep.version}] (${new Date(rep.date).toISOString().slice(0, 10)}).osr`.replace(/[\\/:*?"<>|]/g, '_');
    const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
};
