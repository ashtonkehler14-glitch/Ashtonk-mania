/* SkinParser + SkinManager — real .osk skin engine.
 *  - imports .osk archives, parses skin.ini (General / Colours / Fonts / per-key [Mania] sections)
 *  - indexes assets case-insensitively (backslash/forward slash, extension-less, @2x aware, animation frames)
 *  - resolves per-key-count mania layouts (column widths, spacing, hit/score/combo positions, colours, images)
 *  - lazily decodes textures & sounds from IndexedDB and caches them
 *  - falls back to the built-in Ashtonk!mania default skin for any missing asset */

const SkinParser = {
  parse(text) {
    const ini = { general: {}, colours: {}, fonts: {}, mania: {}, maniaList: [] };
    let section = '', cur = null;
    for (let raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
      let line = raw.trim();
      if (!line || line.startsWith('//')) continue;
      const cmt = line.indexOf('//');
      if (cmt > 0) line = line.slice(0, cmt).trim();
      if (line[0] === '[' && line.endsWith(']')) {
        section = line.slice(1, -1).toLowerCase();
        if (section === 'mania') { cur = {}; ini.maniaList.push(cur); }
        continue;
      }
      const i = line.indexOf(':');
      if (i < 0) continue;
      const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
      if (section === 'mania') {
        // a list given twice in one section fills in the earlier one (osu!: "ColumnLineWidth: 0,0,0,0,0" then
        // "ColumnLineWidth: 0,0" leaves all five at 0), instead of replacing it and leaving the rest at defaults
        const prev = cur[k];
        if (prev != null && /^(ColumnWidth|ColumnLineWidth|ColumnSpacing|LightingNWidth|LightingLWidth)$/i.test(k)) {
          const a = String(prev).split(','), b = v.split(',');
          b.forEach((x, j) => { if (x.trim() !== '') a[j] = x; });
          cur[k] = a.join(',');
        } else cur[k] = v;
        if (k.toLowerCase() === 'keys') ini.mania[parseInt(v, 10)] = cur;
      } else if (section === 'general' || section === 'colours' || section === 'fonts') {
        ini[section][k] = v;
      }
    }
    return ini;
  },
};

/** Skin names sometimes carry sort-order padding ("-    《NM》 Kori 3.0"); trim it for display. */
const cleanSkinName = n => String(n || '').replace(/^[\s\-_.·]+/, '').trim();

/** Column note-type pattern used for default asset names (mania-note1 / mania-note2 / mania-noteS). */
function maniaColumnTypes(keys, specialStyle = 0) {
  const t = [];
  for (let i = 0; i < keys; i++) {
    if (keys % 2 === 1 && i === (keys - 1) / 2) { t.push('S'); continue; }
    const d = i < keys / 2 ? i : keys - 1 - i;
    t.push(d % 2 === 0 ? '1' : '2');
  }
  if (keys % 2 === 0 && keys >= 6) {
    if (specialStyle === 1) t[0] = 'S';
    else if (specialStyle === 2) t[keys - 1] = 'S';
  }
  return t;
}

const SOUND_EXTS = ['wav', 'ogg', 'mp3'];
const IMAGE_EXTS = ['png', 'jpg', 'jpeg'];

/** A texture: one or more frames with a logical (osu!pixel) size. */
class Texture {
  constructor(frames, scale = 1, fps = 30) {
    this.frames = frames; this.scale = scale; this.fps = fps;
    const f = frames[0];
    this.pw = f.width; this.ph = f.height;
    this.w = f.width / scale; this.h = f.height / scale;
  }
  get img() { return this.frames[0]; }
  frameAt(elapsedMs, loop = true) {
    if (this.frames.length === 1) return this.frames[0];
    let i = Math.floor(elapsedMs / 1000 * this.fps);
    i = loop ? i % this.frames.length : Math.min(i, this.frames.length - 1);
    return this.frames[Math.max(0, i)];
  }
}

function tintSource(src, c) {
  const cv = document.createElement('canvas');
  cv.width = src.width; cv.height = src.height;
  const x = cv.getContext('2d');
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
  x.fillRect(0, 0, cv.width, cv.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(src, 0, 0);
  return cv;
}

async function decodeImage(blob) {
  if (!blob) return null;
  try {
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob);
  } catch (e) { /* fall through */ }
  return loadImageBlob(blob);
}

/** Base skin: file-backed (imported .osk). */
class Skin {
  constructor(meta) {
    this.meta = meta;                // DB record {id, name, author, version, ini, files:[...]}
    this.id = meta.id;
    this.ini = meta.ini || { general: {}, colours: {}, fonts: {}, mania: {}, maniaList: [] };
    this.texCache = new Map();
    this.soundCache = new Map();
    this.layoutCache = new Map();
    this.index = new Map();          // lookup key -> {sd, hd}
    for (const path of meta.files || []) {
      const lower = path.toLowerCase();
      const ext = fileExt(lower);
      let base = ext ? lower.slice(0, -(ext.length + 1)) : lower;
      let hd = false;
      if (base.endsWith('@2x')) { hd = true; base = base.slice(0, -3); }
      const e = this.index.get(base) || {};
      if (IMAGE_EXTS.includes(ext) || SOUND_EXTS.includes(ext)) {
        if (hd) e.hd = e.hd || path; else e.sd = e.sd || path;
        this.index.set(base, e);
      }
    }
  }
  get builtin() { return false; }
  get name() { return cleanSkinName(this.ini.general.Name || this.meta.name) || 'Unnamed skin'; }
  get author() { return this.ini.general.Author || this.meta.author || 'Unknown'; }
  get version() { return this.ini.general.Version || this.meta.version || 'latest'; }

  _key(name) { return normPath(name).toLowerCase().replace(/\.(png|jpe?g|wav|ogg|mp3)$/, ''); }
  has(name) { const k = this._key(name); return this.index.has(k) || this.index.has(k + '-0'); }

  async _blob(path) { return DB.get('files', `skin:${this.id}/${path}`); }

  /** Load a texture by skin-relative name (extension-less). Handles @2x and -N animation frames. */
  async texture(name, { fps = 30 } = {}) {
    if (!name) return null;
    const key = this._key(name);
    if (this.texCache.has(key)) return this.texCache.get(key);
    const p = this._loadTexture(key, fps);
    this.texCache.set(key, p);
    return p;
  }
  async _loadTexture(key, fps) {
    const want2x = SkinManager.prefer2x();
    const pick = e => (want2x && e.hd) ? { path: e.hd, scale: 2 } : e.sd ? { path: e.sd, scale: 1 } : e.hd ? { path: e.hd, scale: 2 } : null;
    const frames = [];
    let scale = 1;
    if (this.index.has(key + '-0')) {
      for (let i = 0; i < 240 && this.index.has(`${key}-${i}`); i++) {
        const p = pick(this.index.get(`${key}-${i}`));
        const img = p && await decodeImage(await this._blob(p.path));
        if (!img) break;
        frames.push(img); scale = p.scale;
      }
    }
    if (!frames.length && this.index.has(key)) {
      const p = pick(this.index.get(key));
      const img = p && await decodeImage(await this._blob(p.path));
      if (img) { frames.push(img); scale = p.scale; }
    }
    if (!frames.length) return null;
    // textures taller or wider than GPUs accept (some skins ship 20000-px long-note bodies) are cut to 8192 px,
    // which keeps the part that's ever seen and avoids a slow fallback path on every draw
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i], w = f.width, hh = f.height;
      if ((w > 8192 || hh > 8192) && typeof createImageBitmap === 'function') {
        try { frames[i] = await createImageBitmap(f, 0, 0, Math.min(w, 8192), Math.min(hh, 8192)); if (f.close) f.close(); } catch (e) { /* keep it */ }
      }
    }
    // 1x1 transparent placeholders are used by skinners to hide elements: keep them (they're intentional).
    return new Texture(frames, scale, fps);
  }

  async sound(name) {
    const key = this._key(name);
    if (this.soundCache.has(key)) return this.soundCache.get(key);
    const p = (async () => {
      const e = this.index.get(key);
      if (!e) return null;
      const blob = await this._blob(e.sd || e.hd);
      if (!blob || blob.size < 64) return null; // empty files are used to mute sounds
      return AudioManager.decode(await blob.arrayBuffer()).catch(() => null);
    })();
    this.soundCache.set(key, p);
    return p;
  }

  /** The [Mania] section for a key count. When a skin has several for the same count (edits often paste a new
   *  section in without removing the old one), the one whose images are actually in the skin wins; with a tie,
   *  the last one (osu!lazer's rule). */
  maniaSection(keys) {
    const cands = (this.ini.maniaList || []).filter(s => parseInt(Object.entries(s).find(([k]) => k.toLowerCase() === 'keys')?.[1], 10) === keys);
    if (cands.length < 2) return this.ini.mania[keys] || null;
    this._secCache = this._secCache || new Map();
    if (this._secCache.has(keys)) return this._secCache.get(keys);
    const score = sec => Object.entries(sec).filter(([k, v]) => /^(KeyImage|NoteImage|Stage|Lighting|Hit)/i.test(k) && v && this.has(v)).length;
    let best = cands[cands.length - 1], bestScore = score(best);
    for (let i = cands.length - 2; i >= 0; i--) { const sc = score(cands[i]); if (sc > bestScore) { best = cands[i]; bestScore = sc; } }
    this._secCache.set(keys, best);
    return best;
  }
  supportedKeys() { return Object.keys(this.ini.mania).map(Number).sort((a, b) => a - b); }

  /** Resolve the full mania layout for a key count, loading every texture it needs. */
  async mania(keys) {
    if (this.layoutCache.has(keys)) return this.layoutCache.get(keys);
    const p = ManiaLayout.resolve(this, keys);
    this.layoutCache.set(keys, p);
    return p;
  }
  dispose() {
    for (const p of this.texCache.values()) Promise.resolve(p).then(t => t && t.frames.forEach(f => f.close && f.close()));
    this.texCache.clear(); this.soundCache.clear(); this.layoutCache.clear();
  }
}

/** Colours of the built-in skin for each UI theme. */
const THEME_PALETTES = {
  lazer: { n1: ['#ffffff', '#d8d8e0'], n2: ['#ff8cc0', '#ff66ab'], s: ['#ffe27a', '#ffcc22'], key: '#ff66ab', glow: [255, 102, 171], glowS: [255, 204, 34] },
  kori: { n1: ['#f4ecff', '#c9b0ff'], n2: ['#b57bff', '#7d3cff'], s: ['#ffe27a', '#f5b700'], key: '#c69bff', glow: [176, 128, 255], glowS: [255, 210, 80] },
  neru: { n1: ['#fffbea', '#ffe9a0'], n2: ['#ffd54a', '#e6a800'], s: ['#d9c2ff', '#8a4dff'], key: '#ffd54a', glow: [255, 207, 58], glowS: [176, 124, 255] },
  teto: { n1: ['#f5f6f8', '#c9ced6'], n2: ['#ff6b84', '#d0213d'], s: ['#ffd0d8', '#ff8fa3'], key: '#ff6b84', glow: [255, 77, 106], glowS: [255, 170, 185] },
  miku: { n1: ['#ecfffd', '#aeeee8'], n2: ['#39c5bb', '#139a90'], s: ['#ff8cc0', '#e12885'], key: '#39c5bb', glow: [57, 197, 187], glowS: [255, 95, 168] },
  midnight: { n1: ['#eef6ff', '#bcd9ff'], n2: ['#6cb6ff', '#2f7fff'], s: ['#ffe27a', '#f5b700'], key: '#6cb6ff', glow: [108, 182, 255], glowS: [255, 210, 80] },
};
/** Arrow directions per column for the "arrows" note style (from Web-Osu-Mania, MIT © 2024 Danny Duong). */
const LANE_ARROW_DIRECTIONS = [
  [180], [270, 90], [270, 180, 90], [270, 180, 0, 90], [270, 315, 180, 45, 90], [270, 45, 180, 0, 45, 90],
  [270, 315, 0, 180, 0, 45, 90], [270, 315, 225, 180, 0, 135, 45, 90], [270, 315, 225, 0, 180, 0, 135, 45, 90],
  [270, 315, 225, 315, 180, 0, 45, 135, 45, 90],
];

/** Built-in "Ashtonk!mania" default skin: procedurally generated Kori-inspired textures + synthesized sounds. */
class DefaultSkin extends Skin {
  constructor() {
    super({ id: 'default', name: 'Custom', author: 'Ashtonk!mania', version: 'latest', files: [], builtin: true,
      ini: { general: { Name: 'Custom', Author: 'Ashtonk!mania', Version: 'latest' }, colours: {}, fonts: {}, mania: {}, maniaList: [] } });
    this.gen = new Map();
  }
  get builtin() { return true; }
  has(name) { const k = this._key(name); return DefaultSkin.NAMES.has(k) || k.startsWith('am-'); }
  supportedKeys() { return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; }
  async texture(name) {
    const key = this._key(name);
    if (this.gen.has(key)) return this.gen.get(key);
    const t = DefaultSkin.generate(key);
    this.gen.set(key, t);
    return t;
  }
  async sound(name) {
    const key = this._key(name);
    if (this.soundCache.has(key)) return this.soundCache.get(key);
    const buf = AudioManager.synth(key);
    this.soundCache.set(key, buf);
    return buf;
  }
  static canvas(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h); return c;
  }
  static rr(x, X, Y, W, H, r) { x.beginPath(); x.roundRect ? x.roundRect(X, Y, W, H, r) : x.rect(X, Y, W, H); }
  static palette() {
    const hue = typeof Settings !== 'undefined' ? Settings.get('skin.hue') : -1;
    if (hue >= 0) return DefaultSkin.huePalette(hue);
    return THEME_PALETTES[(typeof Settings !== 'undefined' && Settings.get('ui.theme')) || 'kori'] || THEME_PALETTES.kori;
  }
  /** Note colours from one hue, as Web-Osu-Mania's "simple" colour mode (MIT © 2024 Danny Duong): coloured
   *  primary columns, near-white secondary columns and a contrasting centre column. */
  static huePalette(hue) {
    const hsl = (h, s, l) => {
      s /= 100; l /= 100;
      const f = n => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
      return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
    };
    const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
    const centre = hue > 35 && hue < 75 ? 212 : 62;
    const p = hsl(hue, 80, 69), c = hsl(centre, 80, 69);
    return { n1: [hex(hsl(hue, 8, 98)), hex(hsl(hue, 6, 76))], n2: [hex(p), hex(hsl(hue, 58, 54))], s: [hex(c), hex(hsl(centre, 58, 54))], key: hex(p), glow: p, glowS: c };
  }
  /** The Custom skin, drawn after osu!lazer's default "Argon" mania skin: notes with a light-to-accent gradient over a
   *  darker base, a bright hit edge and a chevron (bars) or a highlight rim (other shapes); darkened holds with accent
   *  edges; a see-through note-shaped hit target on a glowing grey line above a key panel with Argon's three dots;
   *  judgements as lazer's words in lazer's hit colours. Shapes: bars / circles / diamonds / arrows (Web-Osu-Mania, MIT
   *  © 2024 Danny Duong); colours follow the chosen theme or hue. */
  static generate(key) {
    const C = DefaultSkin.canvas, rr = DefaultSkin.rr;
    const P = DefaultSkin.palette();
    const noteCol = { '1': P.n1, '2': P.n2, 's': P.s };
    const hex = (c, a) => c + Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0');
    const rgbOf = c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
    const mix = (c1, c2, t) => { const a = rgbOf(c1), b = rgbOf(c2); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
    const darker = typeof Settings === 'undefined' || Settings.get('skin.darkerHolds');
    const style0 = typeof Settings === 'undefined' ? 'bars' : Settings.get('skin.noteStyle');
    const W = 128;
    // shape path centred on (cx, cy); `size` is the shape's width
    const shape = (x, style, cx, cy, size, ang = 0, hScale = 1) => {
      x.save(); x.translate(cx, cy);
      x.beginPath();
      if (style === 'bars') { const hh = size * 0.5 * hScale; rr(x, -size / 2, -hh / 2, size, hh, Math.min(10, hh * 0.22)); }
      else if (style === 'circles') x.arc(0, 0, size / 2, 0, Math.PI * 2);
      else if (style === 'diamonds') { x.rotate(Math.PI / 4); const q = size / Math.SQRT2; rr(x, -q / 2, -q / 2, q, q, q * 0.22); }
      else {
        x.rotate(+ang * Math.PI / 180);
        const r = size / 2;
        x.moveTo(0, -r); x.lineTo(r, -r * 0.02); x.lineTo(r * 0.4, -r * 0.02); x.lineTo(r * 0.4, r); x.lineTo(-r * 0.4, r); x.lineTo(-r * 0.4, -r * 0.02); x.lineTo(-r, -r * 0.02); x.closePath();
      }
      x.restore();
    };
    const sizeOf = style => W * (style === 'bars' ? 0.94 : style === 'diamonds' ? 0.86 : 0.8);
    const noteHOf = style => style === 'bars' ? 72 : W; // texture height (bars: a chunky Argon-like bar)
    const bodyW = style => sizeOf(style) * (style === 'bars' ? 0.84 : 0.6);
    const holdCol = T => darker ? mix(noteCol[T][0], '#0c0a12', 0.72) : mix(noteCol[T][0], '#0c0a12', 0.45);

    // a note: a soft glow, a darker base, the coloured face (lighter at the top), a bright hit edge or rim
    const drawNote = (x, style, cx, cy, size, ang, a, b) => {
      shape(x, style, cx, cy, size, ang);
      x.shadowColor = hex(a, 0.55); x.shadowBlur = 14; x.fillStyle = mix(b, '#000000', 0.45); x.fill(); x.shadowBlur = 0;
      x.save(); shape(x, style, cx, cy, size, ang); x.clip();
      const top = cy - size / 2, bot = cy + size / 2;
      const g = x.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, mix(a, '#ffffff', 0.28)); g.addColorStop(0.55, a); g.addColorStop(1, b);
      x.fillStyle = g;
      if (style === 'bars') {
        const hh = size * 0.5, y0 = cy - hh / 2;
        x.fillRect(cx - size / 2, y0, size, hh * 0.82);
        // the hit edge: a bright rounded line along the bottom, with a small glow
        x.shadowColor = hex('#ffffff', 0.8); x.shadowBlur = 6; x.fillStyle = '#ffffff';
        rr(x, cx - size / 2 + 3, y0 + hh * 0.8, size - 6, hh * 0.14, hh * 0.07); x.fill(); x.shadowBlur = 0;
        // a small chevron pointing at the receptors
        x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 4; x.lineCap = 'round'; x.lineJoin = 'round';
        x.beginPath(); x.moveTo(cx - 9, y0 + hh * 0.32); x.lineTo(cx, y0 + hh * 0.52); x.lineTo(cx + 9, y0 + hh * 0.32); x.stroke();
      } else {
        x.fillRect(cx - size / 2, top, size, size);
        // an inner highlight rim and a gloss on the upper half
        const gl = x.createLinearGradient(0, top, 0, cy);
        gl.addColorStop(0, 'rgba(255,255,255,.34)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = gl; x.fillRect(cx - size / 2, top, size, size / 2);
        shape(x, style, cx, cy, size, ang); x.lineWidth = 7; x.strokeStyle = 'rgba(255,255,255,.45)'; x.stroke();
      }
      x.restore();
      shape(x, style, cx, cy, size, ang); x.lineWidth = 2.5; x.strokeStyle = hex(mix(b, '#000000', 0.5), 0.9); x.stroke();
    };

    let m;
    // legacy names (used as fallbacks for imported skins) → the bars style
    if ((m = /^mania-note([12s])(h?)$/.exec(key))) return DefaultSkin.generate(`am-note-${m[1]}-bars-0`);
    if ((m = /^mania-note([12s])l$/.exec(key))) return DefaultSkin.generate(`am-body-${m[1]}-bars-0`);
    if ((m = /^mania-note([12s])t$/.exec(key))) return DefaultSkin.generate(`am-tail-${m[1]}-bars-0`);
    if ((m = /^mania-key([12s])(d?)$/.exec(key))) return DefaultSkin.generate(`am-key${m[2]}-${m[1]}-bars-0`);

    if ((m = /^am-(note|body|tail|key|keyd)-([12s])-(bars|circles|diamonds|arrows)-(\d+)$/.exec(key))) {
      const [, part, T, style, ang] = m;
      const [a, b] = noteCol[T];
      const size = sizeOf(style);
      if (part === 'note') {
        const nh = noteHOf(style);
        return new Texture([C(W, nh, x => drawNote(x, style, W / 2, nh / 2, size, ang, a, b))], 2);
      }
      if (part === 'body') {
        const bw = bodyW(style), c = holdCol(T);
        return new Texture([C(W, 32, (x, w, h) => {
          const x0 = (w - bw) / 2;
          const g = x.createLinearGradient(x0, 0, x0 + bw, 0);
          g.addColorStop(0, mix(c, a, 0.35)); g.addColorStop(0.18, c); g.addColorStop(0.82, c); g.addColorStop(1, mix(c, a, 0.35));
          x.fillStyle = g; x.fillRect(x0, 0, bw, h);
          x.fillStyle = hex(a, 0.7); x.fillRect(x0, 0, 2.5, h); x.fillRect(x0 + bw - 2.5, 0, 2.5, h);
        })], 2);
      }
      if (part === 'tail') {
        const bw = bodyW(style), c = holdCol(T), th = Math.round(bw / 2) + 4;
        return new Texture([C(W, th, (x, w, h) => {
          const x0 = (w - bw) / 2;
          rr(x, x0, 0, bw, h - 4, [0, 0, bw / 2, bw / 2]); x.fillStyle = c; x.fill();
          x.lineWidth = 2.5; x.strokeStyle = hex(a, 0.7); x.stroke();
        })], 2);
      }
      // receptor + key panel (Argon's key area). The texture is tall so it never has to be stretched to reach the
      // bottom of the screen; `anchor` marks the receptor's centre (as a fraction of the height).
      const pressed = part === 'keyd';
      const RH = 1024, ry = 96;
      const t = new Texture([C(W, RH, (x, w, h) => {
        // the key panel below the hit line: the column's colour, very dark, fading in
        const pg = x.createLinearGradient(0, ry, 0, ry + 260);
        pg.addColorStop(0, hex(mix(a, '#07060b', pressed ? 0.62 : 0.8), 0.95)); pg.addColorStop(1, hex(mix(a, '#07060b', pressed ? 0.8 : 0.9), 0.97));
        x.fillStyle = pg; rr(x, 2, ry, w - 4, h - ry, 6); x.fill();
        // pressed: the column above lights up with the note colour
        if (pressed) {
          const g = x.createLinearGradient(0, ry, 0, 0);
          g.addColorStop(0, hex(a, 0.42)); g.addColorStop(1, hex(a, 0));
          x.fillStyle = g; x.fillRect(2, 0, w - 4, ry);
        }
        // the hit target line (grey, glowing; white while pressed)
        x.shadowColor = pressed ? a : 'rgba(255,255,255,.5)'; x.shadowBlur = pressed ? 14 : 6;
        x.fillStyle = pressed ? '#ffffff' : '#c4c4c4';
        rr(x, 3, ry - 3.5, w - 6, 7, 3.5); x.fill(); x.shadowBlur = 0;
        // the hit target: the note shape, see-through; filled with the note colour while pressed
        shape(x, style, w / 2, ry, size * 0.96, ang);
        if (pressed) { x.shadowColor = a; x.shadowBlur = 18; x.fillStyle = hex(a, 0.55); x.fill(); x.shadowBlur = 0; x.lineWidth = 4; x.strokeStyle = '#ffffff'; }
        else { x.fillStyle = 'rgba(255,255,255,.08)'; x.fill(); x.lineWidth = 3.5; x.strokeStyle = 'rgba(255,255,255,.38)'; }
        x.lineJoin = 'round'; x.stroke();
        // Argon's three dots in the key panel, glowing when pressed
        const dy = ry + 70, sp = 10;
        x.fillStyle = pressed ? '#ffffff' : hex(a, 0.9);
        x.shadowColor = a; x.shadowBlur = pressed ? 14 : 6;
        for (const [ox, oy] of [[0, 0], [-sp, sp * 1.2], [sp, sp * 1.2]]) { x.beginPath(); x.arc(w / 2 + ox, dy + oy, 5, 0, Math.PI * 2); x.fill(); }
        x.shadowBlur = 0;
      })], 2);
      t.anchor = ry / RH;
      return t;
    }
    if (key === 'mania-stage-hint') return null; // (the hit target line is part of the key texture)
    if (key === 'mania-stage-light') return new Texture([C(64, 256, (x, w, h) => {
      const [r0, g0, b0] = DefaultSkin.palette().glow;
      const g = x.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, `rgba(${r0},${g0},${b0},.38)`); g.addColorStop(0.45, `rgba(${r0},${g0},${b0},.12)`); g.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    })], 2);
    if (key === 'mania-stage-left' || key === 'mania-stage-right') return new Texture([C(6, 64, (x, w, h) => {
      const g = x.createLinearGradient(key.endsWith('left') ? w : 0, 0, key.endsWith('left') ? 0 : w, 0);
      g.addColorStop(0, 'rgba(255,255,255,.16)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    })], 2);
    if (key === 'mania-stage-bottom') return null;
    if (key === 'lightingn') return new Texture([C(256, 256, (x, w, h) => {
      // Argon's hit explosion: a white flash in the note's shape with a wide glow (tinted per column)
      shape(x, style0 === 'arrows' ? 'circles' : style0, w / 2, h / 2, w * 0.36);
      x.shadowColor = 'rgba(255,255,255,.95)'; x.shadowBlur = 40; x.fillStyle = '#ffffff'; x.fill();
      x.shadowBlur = 16; x.fill(); x.shadowBlur = 0;
    })], 2);
    if (key === 'lightingl') return new Texture([C(256, 256, (x, w, h) => {
      // hold lighting: a glowing ring pulse around the hit target
      shape(x, style0 === 'arrows' ? 'circles' : style0, w / 2, h / 2, w * 0.4);
      x.lineWidth = 8; x.strokeStyle = '#ffffff'; x.shadowColor = 'rgba(255,255,255,.9)'; x.shadowBlur = 22; x.stroke();
      x.shadowBlur = 0;
    })], 2);
    if ((m = /^mania-hit(300g|300|200|100|50|0)$/.exec(key))) {
      // lazer's judgement words in lazer's hit-result colours, spaced out, with a soft glow of the same colour
      const [word, col] = { '300g': ['PERFECT', '#99eeff'], '300': ['GREAT', '#66ccff'], '200': ['GOOD', '#b3d944'], '100': ['OK', '#88b300'], '50': ['MEH', '#ffcc22'], '0': ['MISS', '#ed1121'] }[m[1]];
      const font = '600 58px "Torus", "Inter", "Segoe UI", system-ui, sans-serif';
      const meas = document.createElement('canvas').getContext('2d'); meas.font = font;
      if ('letterSpacing' in meas) meas.letterSpacing = '12px';
      const tw = Math.ceil(meas.measureText(word).width) + 60;
      return new Texture([C(tw, 100, (x, w, h) => {
        x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
        if ('letterSpacing' in x) x.letterSpacing = '12px';
        x.shadowColor = hex(col, 0.85); x.shadowBlur = 18;
        x.fillStyle = col; x.fillText(word, w / 2 + 6, h / 2);
        x.shadowBlur = 0; x.fillStyle = mix(col, '#ffffff', 0.35); x.fillText(word, w / 2 + 6, h / 2);
      })], 2.1);
    }
    return null;
  }
}
DefaultSkin.NAMES = new Set(['mania-note1', 'mania-note2', 'mania-notes', 'mania-note1h', 'mania-note2h', 'mania-notesh',
  'mania-note1l', 'mania-note2l', 'mania-notesl', 'mania-note1t', 'mania-note2t', 'mania-notest', 'mania-key1', 'mania-key2', 'mania-keys',
  'mania-key1d', 'mania-key2d', 'mania-keysd', 'mania-stage-hint', 'mania-stage-light', 'mania-stage-left', 'mania-stage-right',
  'lightingn', 'lightingl', 'mania-hit300g', 'mania-hit300', 'mania-hit200', 'mania-hit100', 'mania-hit50', 'mania-hit0']);

/** Resolved per-key-count configuration (skin.ini [Mania] + textures + fallbacks). */
const ManiaLayout = {
  num(v, d) { const n = parseFloat(v); return isFinite(n) ? n : d; },
  list(v, n, d) {
    const out = new Array(n).fill(d);
    if (v == null) return out;
    const p = String(v).split(',').map(s => parseFloat(s));
    for (let i = 0; i < n; i++) if (isFinite(p[i])) out[i] = p[i];
    return out;
  },
  defaultColumnWidth(keys) { return keys <= 4 ? 52 : keys <= 6 ? 48 : keys <= 7 ? 45 : keys <= 8 ? 42 : keys <= 9 ? 39 : 35; },

  async resolve(skin, keys) {
    const def = SkinManager.defaultSkin;
    const isDefault = skin.builtin;
    const sec = skin.maniaSection(keys) || {};
    const get = k => {
      for (const kk in sec) if (kk.toLowerCase() === k.toLowerCase()) return sec[kk];
      return undefined;
    };
    const n = this.num.bind(this);
    const L = {
      keys, skin, fromSkinIni: !!skin.maniaSection(keys),
      columnStart: n(get('ColumnStart'), 136),
      columnRight: n(get('ColumnRight'), 19),
      columnWidth: this.list(get('ColumnWidth'), keys, isDefault ? this.defaultColumnWidth(keys) : 30),
      columnSpacing: this.list(get('ColumnSpacing'), Math.max(0, keys - 1), 0),
      columnLineWidth: this.list(get('ColumnLineWidth'), keys + 1, isDefault ? 0 : 2),
      lightingNWidth: this.list(get('LightingNWidth'), keys, 0),
      lightingLWidth: this.list(get('LightingLWidth'), keys, 0),
      hitPosition: n(get('HitPosition'), isDefault ? 400 : 402),
      lightPosition: n(get('LightPosition'), 413),
      scorePosition: n(get('ScorePosition'), isDefault ? 250 : 300),
      comboPosition: n(get('ComboPosition'), isDefault ? 170 : 111),
      barlineHeight: n(get('BarlineHeight'), 1.2),
      widthForNoteHeightScale: n(get('WidthForNoteHeightScale'), 0),
      lightFPS: n(get('LightFramePerSecond'), 30),
      judgementLine: (get('JudgementLine') ?? (isDefault ? '0' : '1')) !== '0',
      keysUnderNotes: get('KeysUnderNotes') === '1',
      upsideDown: get('UpsideDown') === '1',
      specialStyle: parseInt(get('SpecialStyle') || '0', 10) || 0,
      comboBurstStyle: parseInt(get('ComboBurstStyle') || '1', 10),
      noteBodyStyle: [],
      colours: {},
      tex: { key: [], keyD: [], note: [], noteH: [], noteL: [], noteT: [] },
      judgement: {},
    };
    // upscroll flipping (osu!stable / lazer): keys flip unless KeyFlipWhenUpsideDown is 0; notes, heads, bodies and
    // tails flip unless NoteFlipWhenUpsideDown is 0; each can be overridden per column (KeyFlipWhenUpsideDown#,
    // KeyFlipWhenUpsideDown#D for the pressed key, NoteFlipWhenUpsideDown#, #H, #L, #T; columns count from 0)
    const flag = (k, d) => { const v = get(k); return v == null || String(v).trim() === '' ? d : String(v).trim() !== '0'; };
    const keyFlip = flag('KeyFlipWhenUpsideDown', true), noteFlip = flag('NoteFlipWhenUpsideDown', true);
    L.flip = { key: [], keyD: [], note: [], head: [], body: [], tail: [] };
    for (let i = 0; i < keys; i++) {
      const k = flag(`KeyFlipWhenUpsideDown${i}`, keyFlip), nn = flag(`NoteFlipWhenUpsideDown${i}`, noteFlip);
      L.flip.key.push(k); L.flip.keyD.push(flag(`KeyFlipWhenUpsideDown${i}D`, k));
      L.flip.note.push(nn); L.flip.head.push(flag(`NoteFlipWhenUpsideDown${i}H`, nn));
      L.flip.body.push(flag(`NoteFlipWhenUpsideDown${i}L`, nn)); L.flip.tail.push(flag(`NoteFlipWhenUpsideDown${i}T`, nn));
    }
    const nbs = parseInt(get('NoteBodyStyle') ?? '1', 10);
    for (let i = 0; i < keys; i++) L.noteBodyStyle.push(parseInt(get(`NoteBodyStyle${i}`) ?? nbs, 10) || 0);
    const col = (k, d) => parseColour(get(k), d);
    L.colours.column = []; L.colours.light = [];
    for (let i = 0; i < keys; i++) {
      const types = maniaColumnTypes(keys, L.specialStyle);
      const P = DefaultSkin.palette(), gl = types[i] === 'S' ? P.glowS : P.glow;
      // Custom skin (as Argon): each column's background is its note colour, darkened almost to black
      const nc = (types[i] === 'S' ? P.s : types[i] === '2' ? P.n2 : P.n1)[0], ncr = [1, 3, 5].map(k => parseInt(nc.slice(k, k + 2), 16));
      L.colours.column.push(col(`Colour${i + 1}`, isDefault ? { r: Math.round(4 + ncr[0] * 0.06), g: Math.round(3 + ncr[1] * 0.06), b: Math.round(7 + ncr[2] * 0.06), a: 0.93 } : { r: 0, g: 0, b: 0, a: 1 }));
      L.colours.light.push(col(`ColourLight${i + 1}`, isDefault ? { r: gl[0], g: gl[1], b: gl[2], a: 1 } : { r: 255, g: 255, b: 255, a: 1 }));
    }
    L.colours.columnLine = col('ColourColumnLine', { r: 255, g: 255, b: 255, a: 1 });
    L.colours.barline = col('ColourBarline', { r: 255, g: 255, b: 255, a: isDefault ? 0.35 : 1 });
    L.colours.judgementLine = col('ColourJudgementLine', { r: 255, g: 255, b: 255, a: 1 });
    L.colours.keyWarning = col('ColourKeyWarning', { r: 0, g: 0, b: 0, a: 1 });
    L.colours.hold = col('ColourHold', { r: 255, g: 191, b: 51, a: 1 });
    L.colours.break = col('ColourBreak', { r: 255, g: 0, b: 0, a: 1 });

    // texture lookup with fallback to built-in default
    const load = async (iniKey, defName, opts = {}) => {
      const explicit = iniKey ? get(iniKey) : undefined;
      if (explicit) {
        const t = await skin.texture(explicit, opts); if (t) return t;
        // "null", "none", "_blank"… that aren't files: the skinner is hiding this element, not asking for the default
        if (/^(null|none|nothing|-|_?blank\d*|empty)$/i.test(String(explicit).trim())) return null;
      }
      if (defName && !skin.builtin) { const t = await skin.texture(defName, opts); if (t) return t; }
      if (!defName) return null;
      // the built-in art stands in for what the skin doesn't have: it's placed by the built-in rules (its keys
      // put the receptor where notes are hit), not by the legacy-skin ones
      const t = await def.texture(defName, opts);
      if (t) t.fromDefault = true;
      return t;
    };
    const types = maniaColumnTypes(keys, L.specialStyle);
    const style = isDefault ? (Settings.get('skin.noteStyle') || 'bars') : 'bars';
    for (let i = 0; i < keys; i++) {
      const T = types[i];
      if (isDefault && style !== 'bars') {
        const ang = (LANE_ARROW_DIRECTIONS[keys - 1] || [])[i] ?? 0;
        const nm = part => `am-${part}-${T.toLowerCase()}-${style}-${ang}`;
        L.tex.key[i] = await def.texture(nm('key')); L.tex.keyD[i] = await def.texture(nm('keyd'));
        L.tex.note[i] = L.tex.noteH[i] = await def.texture(nm('note'));
        L.tex.noteL[i] = await def.texture(nm('body')); L.tex.noteT[i] = await def.texture(nm('tail'));
        continue;
      }
      L.tex.key[i] = await load(`KeyImage${i}`, `mania-key${T}`);
      L.tex.keyD[i] = await load(`KeyImage${i}D`, `mania-key${T}D`);
      L.tex.note[i] = await load(`NoteImage${i}`, `mania-note${T}`);
      L.tex.noteH[i] = (await load(`NoteImage${i}H`, get(`NoteImage${i}`) ? null : `mania-note${T}H`)) || L.tex.note[i];
      L.tex.noteL[i] = await load(`NoteImage${i}L`, `mania-note${T}L`);
      L.tex.noteT[i] = (await load(`NoteImage${i}T`, get(`NoteImage${i}`) ? null : `mania-note${T}T`)) || null;
    }
    L.tex.stageLeft = await load('StageLeft', 'mania-stage-left');
    L.tex.stageRight = await load('StageRight', 'mania-stage-right');
    L.tex.stageBottom = await load('StageBottom', 'mania-stage-bottom');
    L.tex.stageHint = await load('StageHint', 'mania-stage-hint');
    L.tex.stageLight = await load('StageLight', 'mania-stage-light');
    L.tex.lightingN = await load('LightingN', 'lightingN', { fps: L.lightFPS });
    // the skin's own health bar (osu! scorebar-bg / scorebar-colour, animated or not); built-in skins have none
    if (!skin.builtin) {
      const tx = n => skin.texture(n).catch(() => null);
      L.tex.scorebarColour = await skin.texture('scorebar-colour', { fps: 20 }).catch(() => null);
      if (L.tex.scorebarColour) {
        L.tex.scorebarBg = await tx('scorebar-bg');
        // "new style" skins have a scorebar-marker; older ones use the ki sprites (osu!lazer LegacyHealthDisplay)
        L.tex.scorebarMarker = await tx('scorebar-marker');
        L.tex.scorebarKi = [await tx('scorebar-ki'), await tx('scorebar-kidanger'), await tx('scorebar-kidanger2')];
      }
      L.scorebarNewStyle = !!L.tex.scorebarMarker;
    }
    L.tex.lightingL = await load('LightingL', 'lightingL', { fps: L.lightFPS });
    for (const [j, name] of [['300g', 'Hit300g'], ['300', 'Hit300'], ['200', 'Hit200'], ['100', 'Hit100'], ['50', 'Hit50'], ['0', 'Hit0']]) {
      L.judgement[j] = await load(name, `mania-hit${j}`, { fps: 20 });
    }
    // score/combo fonts from [Fonts]
    const fonts = skin.ini.fonts || {};
    L.font = await SkinManager.loadFont(skin, fonts.ComboPrefix || fonts.ScorePrefix || 'score', parseFloat(fonts.ComboOverlap || fonts.ScoreOverlap || '0') || 0);
    L.scoreFont = await SkinManager.loadFont(skin, fonts.ScorePrefix || 'score', parseFloat(fonts.ScoreOverlap || '0') || 0);
    // tinted variants for lights
    L.tinted = { stageLight: [], lightingN: [], lightingL: [] };
    for (let i = 0; i < keys; i++) {
      const c = L.colours.light[i];
      for (const k of ['stageLight', 'lightingN', 'lightingL']) {
        const t = L.tex[k];
        const white = c.r === 255 && c.g === 255 && c.b === 255;
        L.tinted[k][i] = t ? (white ? t : new Texture(t.frames.map(f => tintSource(f, c)), t.scale, t.fps)) : null;
      }
    }
    return L;
  },
};

const SkinManager = {
  skins: [],             // metadata records
  current: null,         // Skin instance
  defaultSkin: null,

  prefer2x() {
    const mode = Settings.get('skin.hd');
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return (window.innerHeight * (window.devicePixelRatio || 1)) >= 700;
  },

  /** Theme / built-in style changes regenerate the procedural textures (imported skins fall back to them). */
  invalidateGenerated() {
    this.defaultSkin.gen.clear(); this.defaultSkin.layoutCache.clear();
    if (this.current && this.current !== this.defaultSkin) this.current.layoutCache.clear();
  },
  async init() {
    this.defaultSkin = new DefaultSkin();
    Bus.on('settings:changed', k => { if (k === 'ui.theme' || k === 'skin.noteStyle' || k === 'skin.darkerHolds' || k === 'skin.hue' || k === '*') this.invalidateGenerated(); });
    this.skins = await DB.getAll('skins');
    const want = Settings.get('skin.current');
    await this.select(want && (want === 'default' || this.skins.some(s => s.id === want)) ? want : (this.skins[0]?.id || 'default'), { silent: true });
  },

  list() {
    return [{ id: 'default', name: 'Custom', author: 'Ashtonk!mania', version: 'latest', builtin: true, ini: this.defaultSkin.ini, files: [] }, ...this.skins];
  },

  instance(id) {
    if (id === 'default') return this.defaultSkin;
    if (this.current && this.current.id === id) return this.current;
    const meta = this.skins.find(s => s.id === id);
    return meta ? new Skin(meta) : null;
  },

  /** A skin that's no longer current may still be on screen (a running game, its HUD, a preview), so its images are
   *  only released at the next screen change: closing them straight away made anything still drawing them throw. */
  retire(skin) {
    (this._retired || (this._retired = new Set())).add(skin);
    if (!this._retireHook) this._retireHook = Bus.on('screen:changed', () => {
      for (const k of this._retired) if (k !== this.current) { k.dispose(); this._retired.delete(k); }
    });
  },
  async select(id, { silent = false } = {}) {
    const skin = this.instance(id) || this.defaultSkin;
    if (this.current && this.current !== skin && !this.current.builtin) this.retire(this.current);
    this.current = skin;
    await Settings.set('skin.current', skin.id);
    UISounds.reset();
    if (!silent) Bus.emit('skin:changed', skin);
    return skin;
  },

  /** Import an .osk (ZIP). Returns the new skin metadata. */
  async importOsk(file, onProgress) {
    const buf = await file.arrayBuffer();
    let zip;
    try { zip = new ZipReader(buf); } catch (e) { throw new Error(`${file.name}: ${e.message}`); }
    let entries = zip.entries.filter(e => !/(^|\/)(__macosx|\.ds_store)/i.test(e.name));
    // strip a single common top folder (some .osk files wrap everything in one directory)
    // the top-most skin.ini is the skin's (some skins carry leftover ones in sub-folders)
    const iniEntry = entries.filter(e => /(^|\/)skin\.ini$/i.test(e.name)).sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
    let prefix = '';
    if (iniEntry && iniEntry.name.includes('/')) prefix = iniEntry.name.slice(0, iniEntry.name.lastIndexOf('/') + 1);
    let ini = { general: {}, colours: {}, fonts: {}, mania: {}, maniaList: [] };
    if (iniEntry) {
      const bytes = await zip.read(iniEntry);
      let text = new TextDecoder('utf-8').decode(bytes);
      if (text.includes('�')) text = new TextDecoder('latin1').decode(bytes);
      ini = SkinParser.parse(text);
    }
    const name = cleanSkinName(ini.general.Name) || file.name.replace(/\.osk$/i, '');
    const id = 'skin-' + (await hashHex(name + '|' + buf.byteLength)).slice(0, 16);
    await DB.delPrefix('files', `skin:${id}/`);
    const files = [], items = [];
    let done = 0;
    for (const e of entries) {
      if (prefix && !e.name.startsWith(prefix)) continue;
      const rel = e.name.slice(prefix.length);
      const ext = fileExt(rel);
      if (![...IMAGE_EXTS, ...SOUND_EXTS, 'ini'].includes(ext)) continue;
      const data = await zip.read(e);
      items.push({ store: 'files', key: `skin:${id}/${rel}`, value: new Blob([data], { type: mimeFor(rel) }) });
      files.push(rel);
      if (items.length >= 40) { await DB.putMany(items.splice(0)); }
      onProgress && onProgress(++done / entries.length);
    }
    if (items.length) await DB.putMany(items);
    const meta = {
      id, name, author: ini.general.Author || 'Unknown', version: ini.general.Version || '1.0',
      ini, files, added: Date.now(), source: file.name,
      maniaKeys: Object.keys(ini.mania).map(Number).sort((a, b) => a - b),
      maniaAssets: files.filter(f => /(^|\/)(mania|lighting)/i.test(f) || /mania/i.test(f)).length,
    };
    await DB.put('skins', meta);
    this.skins = this.skins.filter(s => s.id !== id).concat(meta);
    Bus.emit('skins:changed');
    return meta;
  },

  /** Add files to an installed skin ([{ rel, data }]); used to complete older copies of the bundled Kori. */
  async addFiles(id, files) {
    const meta = this.skins.find(s => s.id === id);
    if (!meta || !files.length) return;
    await DB.putMany(files.map(f => ({ store: 'files', key: `skin:${id}/${f.rel}`, value: new Blob([f.data], { type: mimeFor(f.rel) }) })));
    meta.files = [...new Set([...meta.files, ...files.map(f => f.rel)])];
    await DB.put('skins', meta);
    if (this.current && this.current.id === id) { this.retire(this.current); this.current = new Skin(meta); }
    Bus.emit('skins:changed');
  },

  /** Replace an installed skin's skin.ini (used to update the skins that ship with the game). */
  async updateIni(id, text, rel = 'Skin.ini') {
    const meta = this.skins.find(s => s.id === id);
    if (!meta) return;
    meta.ini = SkinParser.parse(text);
    meta.maniaKeys = Object.keys(meta.ini.mania).map(Number).sort((a, b) => a - b);
    const path = meta.files.find(f => /(^|\/)skin\.ini$/i.test(f)) || rel;
    await DB.put('files', new Blob([text], { type: 'text/plain' }), `skin:${id}/${path}`);
    await DB.put('skins', meta);
    if (this.current && this.current.id === id) { this.retire(this.current); this.current = new Skin(meta); }
    Bus.emit('skins:changed');
  },

  async remove(id) {
    if (id === 'default') return;
    await DB.del('skins', id);
    await DB.delPrefix('files', `skin:${id}/`);
    this.skins = this.skins.filter(s => s.id !== id);
    if (this.current && this.current.id === id) await this.select('default');
    Bus.emit('skins:changed');
  },

  async exportOsk(id) {
    const meta = this.skins.find(s => s.id === id);
    if (!meta) return;
    const files = [];
    for (const f of meta.files) {
      const b = await DB.get('files', `skin:${id}/${f}`);
      if (b) files.push({ name: f, data: new Uint8Array(await b.arrayBuffer()) });
    }
    downloadBlob(writeZip(files), `${meta.name}.osk`);
  },

  /** Skin number font (score-0..9 etc). Returns null when the skin has none. */
  async loadFont(skin, prefix, overlap) {
    const glyphs = {};
    const names = { '0': '0', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', ',': 'comma', '.': 'dot', '%': 'percent', 'x': 'x' };
    let found = 0;
    for (const [ch, nm] of Object.entries(names)) {
      if (skin.builtin) break;
      const t = await skin.texture(`${prefix}-${nm}`);
      if (t) { glyphs[ch] = t; found++; }
    }
    return found >= 10 ? { glyphs, overlap } : null;
  },

  /** The current skin's score font (for the HUD and results), or null. */
  scoreFont() {
    const skin = this.current;
    if (!skin || skin.builtin) return Promise.resolve(null);
    if (this._sfSkin !== skin) { this._sfSkin = skin; const f = skin.ini.fonts || {}; this._sf = this.loadFont(skin, f.ScorePrefix || 'score', parseFloat(f.ScoreOverlap || '0') || 0); }
    return this._sf;
  },
  /** A sound only the current (imported) skin provides — no synthesized fallback. Plays it if present. */
  async skinOnly(name, volume = 1) {
    const skin = this.current;
    if (!skin || skin.builtin || !skin.has(name)) return;
    const b = await skin.sound(name).catch(() => null);
    if (b) AudioManager.play(b, { volume });
  },
  /** Play a skin sound with fallback to the default skin's synthesized sound. */
  async sample(name) {
    const s = this.current && await this.current.sound(name);
    if (s) return s;
    if (this.current && !this.current.builtin && this.current.has(name)) return null; // skin intentionally muted it
    return this.defaultSkin.sound(name);
  },
};
