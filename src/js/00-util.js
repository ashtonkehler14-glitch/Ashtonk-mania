/* Ashtonk!mania — core utilities.
 * Everything here is dependency-free and shared by every other system. */

const APP_NAME = 'Ashtonk!mania';
const APP_VERSION = '0.1.0';

/** A keyboard shortcut mentioned in text, left out on a phone or tablet (no keyboard to press it on). */
const kbHint = (withKeys, without = '') => typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches ? without : withKeys;
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
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}
/** lazer's ToShortRelativeTime (leaderboards): "now", "5 mins", "3 hrs", "2dys", "4mos", "1yr". */
function shortAgo(ts) {
  const diff = (Date.now() - ts) / 1000, q = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (diff < 30) return 'now';
  if (diff < 60) return q(Math.floor(diff), 'sec');
  if (diff < 3600) return q(Math.floor(diff / 60), 'min');
  if (diff < 86400) return q(Math.floor(diff / 3600), 'hr');
  const then = new Date(ts), now = new Date(), back = (mo, yr = 0) => { const d = new Date(now); d.setFullYear(d.getFullYear() - yr, d.getMonth() - mo); return d; };
  if (then > back(1)) { const d = Math.floor(diff / 86400); return d < 2 ? '1dy' : `${d}dys`; }
  for (let mo = 1; mo <= 11; mo++) if (then > back(mo + 1)) return mo === 1 ? '1mo' : `${mo}mos`;
  let yr = 1;
  while (then <= back(0, yr + 1)) yr++;
  return yr === 1 ? '1yr' : `${yr}yrs`;
}
/** "1 Oct 2026, 14:03" — short absolute date + time (results, replays). */
const fmtDateTime = ts => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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
/** MD5 of bytes, as hex — how osu! names a beatmap file (WebCrypto has no MD5). */
function md5Hex(bytes) {
  const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  const n = bytes.length, total = ((n + 8) >>> 6) + 1 << 6, buf = new Uint8Array(total);
  buf.set(bytes); buf[n] = 0x80;
  const bits = n * 8, dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bits >>> 0, true); dv.setUint32(total - 4, Math.floor(bits / 4294967296), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      const sh = S[(i >> 4) * 4 + (i & 3)];
      B = (B + ((F << sh) | (F >>> (32 - sh)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0, true); out.setUint32(4, b0, true); out.setUint32(8, c0, true); out.setUint32(12, d0, true);
  return [...new Uint8Array(out.buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}
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
// The UI passes optional children around as `cond ? el : null`. h() drops those, but the DOM's own append() would
// print the word "null" on screen (it happened on three screens), so the DOM methods drop them too.
if (typeof Element !== 'undefined') for (const P of [Element.prototype, DocumentFragment.prototype]) {
  for (const m of ['append', 'prepend', 'replaceChildren']) {
    const orig = P[m];
    P[m] = function (...kids) { return orig.apply(this, kids.some(k => k == null) ? kids.filter(k => k != null) : kids); };
  }
}


/** lazer's search boxes (FocusedTextBox): Esc clears what's typed first; with nothing typed, it does what Esc does
 *  anywhere on the screen (back). Every other key stays in the box. */
function searchBoxKey(e, onClear) {
  if (e.key !== 'Escape') { e.stopPropagation(); return; }
  e.preventDefault(); e.stopPropagation();
  if (e.target.value) { e.target.value = ''; onClear(); }
  else { e.target.blur(); Screens.back(); }
}

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

/** Set an element's text by changing its text node in place when it has one: replacing the node (textContent =) counts
 *  as a DOM insertion, which re-checks every :has() and sibling rule on the page — on the gameplay HUD, every update. */
function setText(el, text) {
  const n = el.firstChild;
  if (n && n.nodeType === 3 && !n.nextSibling) { if (n.data !== text) n.data = text; }
  else el.textContent = text;
}

/** lazer's song select search: a word matches only where it appears as written (any case) — no loose letter-by-letter
 *  matching, so a search leaves just the songs it names. Earlier and word-start matches score higher. */
function wordScore(hay, word) {
  if (!word) return 1;
  const at = hay.toLowerCase().indexOf(word);
  if (at < 0) return 0;
  return 1000 - Math.min(at, 800) + (at === 0 || /[\s([\-_/]/.test(hay[at - 1]) ? 200 : 0);
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
  // (iOS greys out files of a type it doesn't know when they're listed here — .osz, .osk, .osr… — so on an iPhone or
  // iPad the picker takes any file, and the import sorts out what it can use)
  const ios = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  if (ios && /\.(osz|osk|osr|osu|amr)\b/i.test(accept)) accept = '';
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
async function makeThumbnail(blob, maxW = 640, quality = 0.82) {
  // (decoded and resized off the main thread where the browser can — a big background done here froze the menus for a
  // moment on slow devices — then only copied onto the canvas and encoded, which is asynchronous too)
  if (typeof createImageBitmap === 'function') {
    try {
      const full = await createImageBitmap(blob);
      const s = Math.min(1, maxW / full.width), w = Math.max(1, Math.round(full.width * s)), hh = Math.max(1, Math.round(full.height * s));
      const bm = s < 1 ? await createImageBitmap(full, { resizeWidth: w, resizeHeight: hh, resizeQuality: 'high' }) : full;
      if (bm !== full) full.close();
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      c.getContext('2d').drawImage(bm, 0, 0);
      bm.close();
      return await new Promise(r => c.toBlob(b => r(b), 'image/jpeg', quality));
    } catch (e) { /* not decodable this way: the image element below */ }
  }
  const img = await loadImageBlob(blob);
  if (!img) return null;
  const s = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return new Promise(r => c.toBlob(b => r(b), 'image/jpeg', quality));
}
/** Run `fn` once a smooth scroll of `sc` has finished (scrollend where the browser has it, else after a moment). */
function settleOn(sc, fn) {
  let done = false;
  const go = () => { if (done) return; done = true; sc.removeEventListener('scrollend', go); fn(); };
  if ('onscrollend' in sc) sc.addEventListener('scrollend', go, { once: true });
  setTimeout(go, 900);
}
/** Run `fn` when the browser has a moment to spare (not in the middle of scrolling or an animation). */
const whenIdle = fn => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 200));

/** Picture work off the main thread (a Web Worker with an OffscreenCanvas): blurring a song's background and similar
 *  jobs froze the menus for a moment on slow devices each time the song changed. `run` resolves to null where workers
 *  or OffscreenCanvas aren't available, and the caller does the work itself. */
const ImageWorker = {
  run(job) {
    if (this.w === undefined) {
      this.w = null;
      try {
        if (typeof OffscreenCanvas === 'function' && typeof Worker === 'function') {
          const src = `onmessage = async ({ data: m }) => {
  try {
    if (m.op === 'blur') {
      const blob = await (await fetch(m.url)).blob();
      const full = await createImageBitmap(blob);
      const W = m.W, H = Math.max(1, Math.round(W * full.height / Math.max(1, full.width)));
      const bm = await createImageBitmap(full, { resizeWidth: W, resizeHeight: H, resizeQuality: 'high' }); full.close();
      const c = new OffscreenCanvas(W, H), x = c.getContext('2d'), r = m.r;
      x.filter = 'blur(' + r.toFixed(2) + 'px)';
      x.drawImage(bm, -r * 2, -r * 2, W + r * 4, H + r * 4); bm.close();
      postMessage({ id: m.id, blob: await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }) });
    } else postMessage({ id: m.id, err: 'unknown job' });
  } catch (e) { postMessage({ id: m.id, err: String(e) }); }
};`;
          const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
          this.wait = new Map(); this.n = 0;
          w.onmessage = ({ data }) => { const f = this.wait.get(data.id); if (f) { this.wait.delete(data.id); f(data.err ? null : data); } };
          w.onerror = () => { for (const f of this.wait.values()) f(null); this.wait.clear(); this.w = null; };
          this.w = w;
        }
      } catch (e) { this.w = null; }
    }
    if (!this.w) return Promise.resolve(null);
    return new Promise(r => { const id = ++this.n; this.wait.set(id, r); this.w.postMessage({ ...job, id }); });
  },
};

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

/** A message people can act on for the errors browsers throw (storage full, network down, unreadable files, audio). */
function friendlyError(e) {
  const name = e && e.name, msg = (e && e.message) || String(e || 'Unknown error');
  if (name === 'QuotaExceededError' || /quota|storage full/i.test(msg))
    return 'Browser storage is full. Delete beatmaps or replays you don\'t need (Settings → Maintenance shows how much is used), then try again.';
  if (name === 'TypeError' && /failed to fetch|networkerror|load failed|network connection/i.test(msg))
    return navigator.onLine === false ? 'You\'re offline. Connect to the internet and try again.' : 'Couldn\'t reach the server. Check your connection and try again.';
  if (name === 'EncodingError' || /unable to decode|decodeaudiodata/i.test(msg))
    return 'This browser can\'t decode that audio file (it may be damaged or in an unsupported format).';
  if (name === 'NotReadableError') return 'The file couldn\'t be read. Was it moved, deleted, or is it still downloading?';
  return msg;
}
