/* Ashtonk!mania — core utilities.
 * Everything here is dependency-free and shared by every other system. */

const APP_NAME = 'Ashtonk!mania';
const APP_VERSION = '0.1.0';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Tiny hyperscript helper: h('div.cls#id', {attrs}, children...) */
function h(tag, attrs, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
    }
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs); attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  appendChildren(el, children);
  return el;
}
function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
function clearEl(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtTime(ms, withMs = false) {
  const neg = ms < 0; ms = Math.abs(ms);
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  let out = `${neg ? '-' : ''}${m}:${String(s % 60).padStart(2, '0')}`;
  if (withMs) out += '.' + String(Math.floor(ms % 1000)).padStart(3, '0');
  return out;
}
function fmtDuration(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
const fmtInt = n => Math.round(n).toLocaleString('en-US');
/** "1 set", "2 sets", "1 difficulty", "3 difficulties" (formatted count + word). */
const plural = (n, one, many = one + 's') => `${fmtInt(n)} ${Math.round(n) === 1 ? one : many}`;
/** 1234 → "1.2K", 1234567 → "1.2M" (osu!-style short counts). */
const fmtCompact = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(Math.round(n));
const fmtScore = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtAcc = a => (a * 100).toFixed(2) + '%';
function fmtDate(ts) {
  const d = new Date(ts), now = Date.now(), diff = (now - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

/** SHA-256 hex of a string or ArrayBuffer. Falls back to FNV-1a when SubtleCrypto is unavailable (file://). */
async function hashHex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  if (globalThis.crypto && crypto.subtle) {
    try {
      const d = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { /* insecure context */ }
  }
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 16777619);
    h2 = Math.imul(h2 ^ bytes[(bytes.length - 1 - i)], 2246822519);
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).repeat(4);
}

/** Seeded PRNG (mulberry32) — used by Random mod so replays reproduce the same shuffle. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple pub/sub. */
class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, fn) { if (!this._h.has(ev)) this._h.set(ev, new Set()); this._h.get(ev).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { const s = this._h.get(ev); if (s) s.delete(fn); }
  emit(ev, ...args) { const s = this._h.get(ev); if (s) for (const fn of [...s]) { try { fn(...args); } catch (e) { console.error(e); } } }
}
const Bus = new Emitter();

/** Fuzzy match: returns score > 0 if every char of the needle appears in order; contiguous and word-start hits score higher. */
function fuzzyScore(hay, needle) {
  if (!needle) return 1;
  hay = hay.toLowerCase();
  const direct = hay.indexOf(needle);
  if (direct >= 0) return 1000 - direct + (direct === 0 || hay[direct - 1] === ' ' ? 200 : 0);
  let hi = 0, score = 0, streak = 0;
  for (let i = 0; i < needle.length; i++) {
    const c = needle[i];
    const at = hay.indexOf(c, hi);
    if (at < 0) return 0;
    streak = at === hi ? streak + 1 : 0;
    score += 1 + streak * 2 + (at === 0 || hay[at - 1] === ' ' ? 3 : 0);
    hi = at + 1;
  }
  return score;
}

/** Binary search: last index i where arr[i][key] <= v (or -1). */
function bsearchLE(arr, v, key) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((key ? arr[mid][key] : arr[mid]) <= v) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function downloadBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function downloadJSON(obj, name) { downloadBlob(new Blob([JSON.stringify(obj)], { type: 'application/json' }), name); }

function pickFiles({ accept = '', multiple = true, directory = false } = {}) {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    if (multiple) inp.multiple = true;
    if (directory) { inp.webkitdirectory = true; inp.setAttribute('webkitdirectory', ''); }
    inp.addEventListener('change', () => { resolve(Array.from(inp.files || [])); inp.remove(); });
    document.body.appendChild(inp); inp.click();
  });
}

const fileExt = name => { const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i + 1).toLowerCase(); };
const normPath = p => p.replace(/\\/g, '/').replace(/^\.?\//, '').trim();
const mimeFor = name => ({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
}[fileExt(name)] || 'application/octet-stream');

/** Loads an Image from a Blob; resolves null on failure (never throws). */
function loadImageBlob(blob) {
  return new Promise(resolve => {
    if (!blob) return resolve(null);
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/** Downscale an image blob to a JPEG thumbnail blob (for fast song-select panels). */
async function makeThumbnail(blob, maxW = 640) {
  const img = await loadImageBlob(blob);
  if (!img) return null;
  const s = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return new Promise(r => c.toBlob(b => r(b), 'image/jpeg', 0.82));
}

/** Object-URL cache so blobs from IndexedDB are only materialised once. */
const BlobURLs = {
  map: new Map(),
  get(key, blob) {
    if (this.map.has(key)) return this.map.get(key);
    if (!blob) return null;
    const u = URL.createObjectURL(blob); this.map.set(key, u); return u;
  },
  drop(prefix) {
    for (const [k, u] of this.map) if (k.startsWith(prefix)) { URL.revokeObjectURL(u); this.map.delete(k); }
  },
};

const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
function parseColour(str, fallback = null) {
  if (!str) return fallback;
  const p = str.split(',').map(s => parseInt(s.trim(), 10));
  if (p.length < 3 || p.some(isNaN)) return fallback;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] / 255 : 1 };
}
const rgba = (c, mul = 1) => c ? `rgba(${c.r},${c.g},${c.b},${(c.a ?? 1) * mul})` : 'transparent';
