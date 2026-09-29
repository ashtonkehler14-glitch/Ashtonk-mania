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
        cur[k] = v;
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

  maniaSection(keys) { return this.ini.mania[keys] || null; }
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
    super({ id: 'default', name: 'Ashtonk!mania Default', author: 'Ashtonk!mania', version: 'latest', files: [], builtin: true,
      ini: { general: { Name: 'Ashtonk!mania Default', Author: 'Ashtonk!mania', Version: 'latest' }, colours: {}, fonts: {}, mania: {}, maniaList: [] } });
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
  static palette() { return THEME_PALETTES[(typeof Settings !== 'undefined' && Settings.get('ui.theme')) || 'kori'] || THEME_PALETTES.kori; }
  static generate(key) {
    const C = DefaultSkin.canvas, rr = DefaultSkin.rr;
    const P = DefaultSkin.palette();
    const noteCol = { '1': P.n1, '2': P.n2, 's': P.s };
    const hex = (c, a) => c + Math.round(a * 255).toString(16).padStart(2, '0');
    const darker = typeof Settings === 'undefined' || Settings.get('skin.darkerHolds');
    let m;
    // Shaped notes for the built-in skin (styles from Web-Osu-Mania): am-<part>-<type>-<style>-<angle>
    if ((m = /^am-(note|body|tail|key|keyd)-([12s])-(bars|circles|diamonds|arrows)-(\d+)$/.exec(key))) {
      const [, part, T, style, ang] = m;
      if (style === 'bars') return DefaultSkin.generate(part === 'note' ? `mania-note${T}` : part === 'body' ? `mania-note${T}l` : part === 'tail' ? `mania-note${T}t` : `mania-key${T}${part === 'keyd' ? 'd' : ''}`);
      const [a, b] = noteCol[T];
      const ratio = style === 'diamonds' ? 0.85 : 0.8;
      const shape = (x, cx, cy, size) => {
        x.save(); x.translate(cx, cy);
        if (style === 'circles') { x.beginPath(); x.arc(0, 0, size / 2, 0, Math.PI * 2); }
        else if (style === 'diamonds') { x.rotate(Math.PI / 4); const q = size / Math.SQRT2; rr(x, -q / 2, -q / 2, q, q, q * 0.18); }
        else {
          x.rotate(+ang * Math.PI / 180);
          const r = size / 2;
          x.beginPath();
          x.moveTo(0, -r); x.lineTo(r, 0); x.lineTo(r * 0.42, 0); x.lineTo(r * 0.42, r); x.lineTo(-r * 0.42, r); x.lineTo(-r * 0.42, 0); x.lineTo(-r, 0); x.closePath();
        }
        x.restore();
      };
      if (part === 'note') return new Texture([C(128, 128, (x, w, h) => {
        shape(x, w / 2, h / 2, w * ratio);
        const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, a); g.addColorStop(1, b);
        x.fillStyle = g; x.fill(); x.lineWidth = 5; x.strokeStyle = 'rgba(10,4,20,.85)'; x.stroke();
      })], 2);
      if (part === 'body') return new Texture([C(128, 32, (x, w, h) => {
        const bw = w * ratio * 0.62;
        x.fillStyle = hex(darker ? b : a, darker ? 0.62 : 0.8); x.fillRect((w - bw) / 2, 0, bw, h);
      })], 2);
      if (part === 'tail') return new Texture([C(128, 64, (x, w, h) => {
        const bw = w * ratio * 0.62;
        rr(x, (w - bw) / 2, 0, bw, h * 0.7, [0, 0, bw / 2, bw / 2]);
        x.fillStyle = hex(darker ? b : a, darker ? 0.62 : 0.8); x.fill();
      })], 2);
      const pressed = part === 'keyd';
      return new Texture([C(128, 320, (x, w, h) => {
        const g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.22, pressed ? hex(P.n2[1], 0.22) : 'rgba(8,5,14,.45)'); g.addColorStop(1, 'rgba(5,3,8,.9)');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        shape(x, w / 2, h * 0.25, w * ratio);
        x.lineWidth = 7;
        x.strokeStyle = pressed ? (T === 's' ? P.s[0] : P.key) : hex(T === 's' ? P.s[1] : P.key, 0.5);
        if (pressed) { x.shadowColor = x.strokeStyle; x.shadowBlur = 20; x.fillStyle = hex(T === 's' ? P.s[1] : P.n2[1], 0.35); x.fill(); }
        x.stroke();
      })], 2);
    }
    if ((m = /^mania-note([12s])$/.exec(key)) || (m = /^mania-note([12s])h$/.exec(key))) {
      const [a, b] = noteCol[m[1]];
      return new Texture([C(128, 40, (x, w, h) => {
        rr(x, 4, 4, w - 8, h - 8, 10);
        const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, a); g.addColorStop(1, b);
        x.fillStyle = g; x.fill();
        x.lineWidth = 3; x.strokeStyle = 'rgba(15,5,30,.85)'; x.stroke();
        x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(16, 9, w - 32, 3);
      })], 2);
    }
    if ((m = /^mania-note([12s])l$/.exec(key))) {
      const [a, b] = noteCol[m[1]];
      const c1 = darker ? b : a;
      return new Texture([C(128, 32, (x, w, h) => {
        const g = x.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.1, hex(c1, 0.66)); g.addColorStop(0.5, hex(darker ? b : a, darker ? 0.7 : 0.8));
        g.addColorStop(0.9, hex(c1, 0.66)); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(14, 0, w - 28, h);
        x.fillStyle = 'rgba(255,255,255,.3)'; x.fillRect(w / 2 - 2, 0, 4, h);
      })], 2);
    }
    if ((m = /^mania-note([12s])t$/.exec(key))) {
      const [a, b] = noteCol[m[1]];
      return new Texture([C(128, 24, (x, w, h) => {
        rr(x, 14, 4, w - 28, h - 8, 8);
        const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, a); g.addColorStop(1, b);
        x.fillStyle = g; x.fill(); x.lineWidth = 3; x.strokeStyle = 'rgba(15,5,30,.85)'; x.stroke();
      })], 2);
    }
    if ((m = /^mania-key([12s])(d?)$/.exec(key))) {
      const pressed = !!m[2], spec = m[1] === 's';
      const col = spec ? P.s[0] : P.key;
      return new Texture([C(128, 172, (x, w, h) => {
        const g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, pressed ? hex(spec ? P.s[1] : P.n2[1], 0.3) : '#0b0812'); g.addColorStop(1, '#050308');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        rr(x, 22, 26, w - 44, 34, 12);
        x.lineWidth = 5;
        x.strokeStyle = pressed ? col : hex(col, 0.45);
        if (pressed) { x.shadowColor = col; x.shadowBlur = 18; x.fillStyle = hex(col, 0.35); x.fill(); }
        x.stroke();
        x.shadowBlur = 0;
        x.fillStyle = 'rgba(255,255,255,.05)'; x.fillRect(0, 0, 2, h); x.fillRect(w - 2, 0, 2, h);
      })], 2);
    }
    if (key === 'mania-stage-hint') return new Texture([C(256, 24, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h);
      const [r0, g0, b0] = DefaultSkin.palette().glow;
      g.addColorStop(0, `rgba(${r0},${g0},${b0},0)`); g.addColorStop(0.5, `rgba(${r0},${g0},${b0},.95)`); g.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    })], 2);
    if (key === 'mania-stage-light') return new Texture([C(64, 256, (x, w, h) => {
      const g = x.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(0.35, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    })], 2);
    if (key === 'mania-stage-left' || key === 'mania-stage-right') return new Texture([C(8, 64, (x, w, h) => {
      const g = x.createLinearGradient(key.endsWith('left') ? w : 0, 0, key.endsWith('left') ? 0 : w, 0);
      const [r0, g0, b0] = DefaultSkin.palette().glow;
      g.addColorStop(0, `rgba(${r0},${g0},${b0},.9)`); g.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    })], 2);
    if (key === 'mania-stage-bottom') return null;
    if (key === 'lightingn' || key === 'lightingl') {
      const hold = key === 'lightingl';
      return new Texture([C(256, 256, (x, w, h) => {
        const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(hold ? 0.25 : 0.15, 'rgba(255,255,255,.75)');
        g.addColorStop(0.5, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
      })], 2);
    }
    if ((m = /^mania-hit(300g|300|200|100|50|0)$/.exec(key))) {
      const spec = {
        '300g': ['MARVELOUS', ['#fff7c2', '#ffd23f', '#c9a2ff']], '300': ['PERFECT', ['#fff4b0', '#ffc933']],
        '200': ['GREAT', ['#b4ffc8', '#38d97a']], '100': ['GOOD', ['#a9e1ff', '#3c9dff']],
        '50': ['BAD', ['#e2c4ff', '#9a64d8']], '0': ['MISS', ['#ffb3b3', '#ff4a5c']],
      }[m[1]];
      const font = '900 italic 64px "Nunito", system-ui, sans-serif';
      const meas = document.createElement('canvas').getContext('2d'); meas.font = font;
      const tw = Math.ceil(meas.measureText(spec[0]).width) + 40;
      return new Texture([C(tw, 96, (x, w, h) => {
        x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
        const g = x.createLinearGradient(0, 16, 0, 80);
        spec[1].forEach((c, i) => g.addColorStop(i / Math.max(1, spec[1].length - 1), c));
        x.lineWidth = 8; x.strokeStyle = 'rgba(10,4,20,.9)'; x.lineJoin = 'round';
        x.strokeText(spec[0], w / 2, h / 2); x.fillStyle = g; x.fillText(spec[0], w / 2, h / 2);
      })], 2.6);
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
  defaultColumnWidth(keys) { return keys <= 4 ? 58 : keys <= 6 ? 52 : keys <= 7 ? 48 : keys <= 8 ? 44 : keys <= 9 ? 40 : 36; },

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
    const nbs = parseInt(get('NoteBodyStyle') ?? '1', 10);
    for (let i = 0; i < keys; i++) L.noteBodyStyle.push(parseInt(get(`NoteBodyStyle${i}`) ?? nbs, 10) || 0);
    const col = (k, d) => parseColour(get(k), d);
    L.colours.column = []; L.colours.light = [];
    for (let i = 0; i < keys; i++) {
      L.colours.column.push(col(`Colour${i + 1}`, isDefault ? { r: 8, g: 5, b: 14, a: 0.88 } : { r: 0, g: 0, b: 0, a: 1 }));
      const types = maniaColumnTypes(keys, L.specialStyle);
      const P = DefaultSkin.palette(), gl = types[i] === 'S' ? P.glowS : P.glow;
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
      if (explicit) { const t = await skin.texture(explicit, opts); if (t) return t; }
      if (defName && !skin.builtin) { const t = await skin.texture(defName, opts); if (t) return t; }
      return defName ? def.texture(defName, opts) : null;
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
    L.tex.lightingL = await load('LightingL', 'lightingL', { fps: L.lightFPS });
    for (const [j, name] of [['300g', 'Hit300g'], ['300', 'Hit300'], ['200', 'Hit200'], ['100', 'Hit100'], ['50', 'Hit50'], ['0', 'Hit0']]) {
      L.judgement[j] = await load(name, `mania-hit${j}`, { fps: 20 });
    }
    // score/combo fonts from [Fonts]
    const fonts = skin.ini.fonts || {};
    L.font = await SkinManager.loadFont(skin, fonts.ComboPrefix || fonts.ScorePrefix || 'score', parseFloat(fonts.ComboOverlap || fonts.ScoreOverlap || '0') || 0);
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
    Bus.on('settings:changed', k => { if (k === 'ui.theme' || k === 'skin.noteStyle' || k === 'skin.darkerHolds' || k === '*') this.invalidateGenerated(); });
    this.skins = await DB.getAll('skins');
    const want = Settings.get('skin.current');
    await this.select(want && (want === 'default' || this.skins.some(s => s.id === want)) ? want : (this.skins[0]?.id || 'default'), { silent: true });
  },

  list() {
    return [{ id: 'default', name: 'Ashtonk!mania Default', author: 'Ashtonk!mania', version: 'latest', builtin: true, ini: this.defaultSkin.ini, files: [] }, ...this.skins];
  },

  instance(id) {
    if (id === 'default') return this.defaultSkin;
    if (this.current && this.current.id === id) return this.current;
    const meta = this.skins.find(s => s.id === id);
    return meta ? new Skin(meta) : null;
  },

  async select(id, { silent = false } = {}) {
    const skin = this.instance(id) || this.defaultSkin;
    if (this.current && this.current !== skin && !this.current.builtin) this.current.dispose();
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
    const iniEntry = entries.find(e => /(^|\/)skin\.ini$/i.test(e.name));
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

  /** Play a skin sound with fallback to the default skin's synthesized sound. */
  async sample(name) {
    const s = this.current && await this.current.sound(name);
    if (s) return s;
    if (this.current && !this.current.builtin && this.current.has(name)) return null; // skin intentionally muted it
    return this.defaultSkin.sound(name);
  },
};
