/* UIManager: icons, toasts, dialogs, menus, background, toolbar and the ScreenManager. */

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  play: '<path d="M7 4l13 8-13 8z" class="fillme"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  folder: '<path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-7 8-7s7 2.5 8 7"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  brush: '<path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  unfullscreen: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
  star: '<path d="M12 2l3 6.9 7.5.6-5.7 5 1.8 7.4L12 18l-6.6 3.9 1.8-7.4-5.7-5 7.5-.6z" class="fillme"/>',
  heart: '<path d="M12 21s-7.5-4.6-9.5-9.2C1 8.1 3.4 4 7.2 4c2.1 0 3.6 1.1 4.8 2.7C13.2 5.1 14.7 4 16.8 4 20.6 4 23 8.1 21.5 11.8 19.5 16.4 12 21 12 21z"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  mods: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  pc: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2.5 19h19l-2.2-4H4.7z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.4v.6M12 16.6v.5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h0M10 10h0M14 10h0M18 10h0M7 14h10"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6M19 6a8 8 0 010 12"/>',
  retry: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  multi: '<circle cx="8" cy="9" r="3"/><circle cx="17" cy="9" r="3"/><path d="M2 20c.8-3.4 3.2-5 6-5s5.2 1.6 6 5M14 15.5c.9-.4 1.9-.5 3-.5 2.8 0 5.2 1.6 6 5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  sparkle: '<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" class="fillme"/><path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" class="fillme"/>',
  skip: '<path d="M5 5l9 7-9 7zM17 5v14"/>',
  prev: '<path d="M19 5l-9 7 9 7zM7 5v14"/>',
  bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 7V4M4 11h3M17 11h3M4 17h3M17 17h3M8 4l2 3M16 4l-2 3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h0M3 12h0M3 18h0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z" class="fillme"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/>',
  mania: '<circle cx="12" cy="12" r="9"/><path d="M8.5 8v8M12 8v8M15.5 8v8"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  social: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.8 3.4-6 6.5-6s5.7 2.2 6.5 6"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.4c1.9.8 3.1 2.8 3.5 5.6"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  npprev: '<path d="M5.5 5h2.6v14H5.5z" class="fillme"/><path d="M19 5.4v13.2L8.6 12z" class="fillme"/>',
  npnext: '<path d="M15.9 5h2.6v14h-2.6z" class="fillme"/><path d="M5 5.4v13.2L15.4 12z" class="fillme"/>',
  npplay: '<circle cx="12" cy="12" r="9.6" stroke-width="1.9"/><path d="M10 8.1v7.8l6.1-3.9z" class="fillme"/>',
  nppause: '<circle cx="12" cy="12" r="9.6" stroke-width="1.9"/><path d="M9.2 8.3h2v7.4h-2zM12.8 8.3h2v7.4h-2z" class="fillme"/>',
  bars: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H4v1a4 4 0 004 4M16 6h4v1a4 4 0 01-4 4M12 13v4M8 21h8M9 17h6v4H9z"/>',
};
function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', `i ${cls}`); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = (ICONS[name] || '').replace(/class="fillme"/g, 'fill="currentColor" stroke="none"');
  return s;
}

/** Star rating colour ramp. */
function starColour(sr) {
  const stops = [[0, '#4290fb'], [1.25, '#4fc0ff'], [2, '#4fffd5'], [2.5, '#7cff4f'], [3.3, '#f6f05c'], [4.2, '#ff8068'], [4.9, '#ff4e6f'], [5.8, '#c645b8'], [6.7, '#6563de'], [7.7, '#18158e'], [9, '#000000']];
  if (sr >= 9) return '#000000';
  let i = 0; while (i < stops.length - 2 && sr > stops[i + 1][0]) i++;
  const [a, ca] = stops[i], [b, cb] = stops[i + 1];
  const t = clamp((sr - a) / (b - a), 0, 1);
  const p = c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
  const x = p(ca), y = p(cb);
  return '#' + x.map((v, k) => Math.round(lerp(v, y[k], t)).toString(16).padStart(2, '0')).join('');
}
/** Text drawn with a skin's number font (score-0.png … score-comma, -dot, -percent, -x) on a canvas that sits
 *  where the text was. Characters the font doesn't have are skipped. The canvas only ever grows (in steps) and
 *  the digits are aligned inside it, so a score changing 20 times a second doesn't re-layout the page each time. */
function skinDigits(font, cssH, { align = 'right' } = {}) {
  const c = h('canvas.skin-digits');
  c.width = 1; c.height = 1;
  let last = null;
  const set = text => {
    text = String(text);
    if (text === last) return;
    last = text;
    const glyphs = [...text].map(ch => font.glyphs[ch]).filter(Boolean);
    const dpr = Zoom.dpr(), H = Math.max(1, Math.round(cssH * dpr));
    const ref = font.glyphs['0'] || glyphs[0];
    const x = c.getContext('2d');
    if (!ref || !glyphs.length) { x.clearRect(0, 0, c.width, c.height); return; }
    // scale by the digits' ink, not their image: many skins pad each glyph with empty space (Chemuss's are two-thirds
    // padding), which drawn to the box height left the numbers tiny
    const ink = font._ink || (font._ink = digitInk(ref));
    // (digits fill 88% of the height, leaving room for a comma's tail below and a percent sign reaching higher)
    const k = H * 0.88 / Math.max(1, ink.bottom - ink.top), ov = font.overlap * k;
    const base = H * 0.94 + (ref.h - ink.bottom) * k; // where the reference glyph's bottom edge lands
    const widths = glyphs.map(g => g.w * k);
    const W = Math.max(1, Math.ceil(widths.reduce((a, b) => a + b, 0) - ov * (glyphs.length - 1)));
    if (c.height !== H || W > c.width) {
      c.width = Math.ceil(W / 32) * 32; c.height = H;
      c.style.height = cssH + 'px'; c.style.width = (c.width / dpr) + 'px';
    } else x.clearRect(0, 0, c.width, c.height);
    let px = align === 'right' ? c.width - W : align === 'center' ? Math.round((c.width - W) / 2) : 0;
    glyphs.forEach((g, i) => { const gh = g.h * k; x.drawImage(g.img, px, base - gh, widths[i], gh); px += widths[i] - ov; });
  };
  return { el: c, set };
}
/** The rows of a glyph that have any ink: { top, bottom } in the glyph's own pixels (the whole box if unreadable). */
function digitInk(g) {
  const out = { top: 0, bottom: g.h };
  try {
    const W = Math.max(1, Math.round(g.img.width || g.w)), Hh = Math.max(1, Math.round(g.img.height || g.h));
    const c = document.createElement('canvas'); c.width = W; c.height = Hh;
    const x = c.getContext('2d'); x.drawImage(g.img, 0, 0);
    const d = x.getImageData(0, 0, W, Hh).data;
    let t = -1, b = -1;
    for (let y = 0; y < Hh; y++) for (let i = y * W * 4 + 3, e = i + W * 4; i < e; i += 4) if (d[i] > 8) { if (t < 0) t = y; b = y; break; }
    if (t >= 0 && b - t + 1 >= Hh * 0.15) { const f = g.h / Hh; out.top = t * f; out.bottom = (b + 1) * f; }
  } catch (e) { /* tainted or odd image: use the box */ }
  return out;
}
function starBadge(sr) {
  const c = starColour(sr);
  const el = h('span.stars', { style: { '--sc': c, color: sr >= 6.5 ? '#ffd966' : '#16101f' } }, icon('star', 'fill'), sr.toFixed(2));
  return el;
}
/** osu!lazer's tooltips (OsuTooltipContainer): a dark grey box with 5px corners following the cursor. Elements keep
 *  using the plain `title` attribute; on first hover it moves to data-tip so the browser's own tooltip never shows.
 *  The first tooltip waits a moment; moving on to the next element shows its tooltip straight away, as in lazer. */
const Tooltip = {
  init() {
    this.el = h('div.lz-tip', { role: 'tooltip' });
    document.body.appendChild(this.el);
    document.addEventListener('pointerover', e => {
      const t = e.target.closest && e.target.closest('[title], [data-tip]');
      if (t === this.cur) return;
      clearTimeout(this._t);
      this.cur = t;
      if (!t) { this.hide(); return; }
      if (t.hasAttribute('title')) { const v = t.getAttribute('title'); if (v) t.dataset.tip = v; t.removeAttribute('title'); }
      const tip = t.dataset.tip;
      if (!tip || e.pointerType === 'touch' || document.getElementById('app').classList.contains('in-game')) { this.hide(); return; }
      // only for a pointer that's actually moving: a new screen appearing under a still mouse shows nothing
      const show = () => { if (this.still) return; this.el.textContent = tip; this.el.classList.add('show'); this.visible = true; this.place(); };
      if (this.visible) show(); else this._t = setTimeout(show, 450);
    });
    document.addEventListener('pointermove', e => { if (this.still && this.x !== undefined && (Math.abs(e.clientX - this.x) > 2 || Math.abs(e.clientY - this.y) > 2)) this.still = false; this.x = e.clientX; this.y = e.clientY; if (this.visible) this.place(); }, { passive: true });
    Bus.on('screen:changed', () => { this.hide(); this.cur = null; this.still = true; });
    document.addEventListener('pointerleave', () => { this.cur = null; this.hide(); });
    document.addEventListener('pointerdown', () => { clearTimeout(this._t); this.hide(); }, true);
    document.addEventListener('keydown', () => this.hide(), true);
  },
  hide() { clearTimeout(this._t); if (this.visible) { this.visible = false; this.el.classList.remove('show'); } },
  place() {
    const r = this.el.getBoundingClientRect();
    let x = (this.x || 0) + 14, y = (this.y || 0) + 18;
    if (x + r.width > innerWidth - 6) x = innerWidth - r.width - 6;
    if (y + r.height > innerHeight - 6) y = (this.y || 0) - r.height - 10;
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${(1 / Zoom.z).toFixed(3)})`;
  },
};

/** osu!lazer's rank colours (OsuColour.ForRank) and the ink its rank pills (DrawableRank) write the letter in: gold for
 *  SS / S, silver-blue for their Hidden variants (XH / SH). */
const RANK_COLOURS = { XH: '#de31ae', X: '#de31ae', SS: '#de31ae', SH: '#02b5c3', S: '#02b5c3', A: '#88da20', B: '#e3b130', C: '#ff8e5d', D: '#ff5a5a', F: '#9a9a9a' };
const RANK_INK = { XH: '#dff3fb', SH: '#dff3fb', X: '#ffd257', SS: '#ffd257', S: '#ffd257', A: '#275227', B: '#553a2b', C: '#473625', D: '#512525', F: '#303030' };
function rankPill(g) {
  const label = g === 'XH' || g === 'X' ? 'SS' : g === 'SH' ? 'S' : g;
  return h('span.rank-pill', { style: { '--rc': RANK_COLOURS[g] || '#888', '--rt': RANK_INK[g] || '#222' }, title: g === 'XH' || g === 'SH' ? `${label} (Hidden)` : label }, label);
}
function gradeEl(g, cls = '') {
  const label = g === 'XH' ? 'SS' : g === 'SH' ? 'S' : g;
  return h(`span.grade.grade-${g}${cls ? '.' + cls : ''}`, { title: g === 'XH' || g === 'SH' ? `${label} (Hidden)` : label }, label);
}

// ─────────────────────────────── Toasts ───────────────────────────────
const Toast = {
  show(title, body = '', { type = 'info', timeout = 4200, log = true } = {}) {
    const ico = { info: 'info', ok: 'star', err: 'x' }[type] || 'info';
    const box = $('#toasts');
    const key = `${type}\n${title}\n${body}`;
    // the same message again while it's still up refreshes that toast instead of stacking a copy
    const same = [...box.children].find(t => t._key === key && !t.classList.contains('out'));
    if (same) { same._arm(); same.classList.remove('bump'); void same.offsetWidth; same.classList.add('bump'); return same._close; }
    if (log && typeof Notifications !== 'undefined') Notifications.add(title, body, type);
    const el = h(`div.toast.${type}`, { role: 'status' }, h('div.t-ico', icon(ico, type === 'ok' ? 'fill' : '')), h('div', h('div.t-title', title), body ? h('div.t-body', body) : null));
    el._key = key;
    box.appendChild(el);
    while (box.children.length > 5) box.firstChild.remove();
    let timer = 0;
    const close = () => { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 300); };
    // like lazer's toasts, one stays while the pointer is on it and leaves a moment after
    el._arm = () => { clearTimeout(timer); if (timeout) timer = setTimeout(close, timeout); };
    el._close = close;
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => { if (timeout) timer = setTimeout(close, 1500); });
    el.addEventListener('click', close);
    el._arm();
    return close;
  },
  /** Fade out every toast on screen (lazer holds notifications back while you play; ours just go). */
  clear() { for (const el of $('#toasts').children) { el.classList.add('out'); setTimeout(() => el.remove(), 300); } },
  ok(t, b) { return this.show(t, b, { type: 'ok' }); },
  err(t, b) { return this.show(t, b, { type: 'err', timeout: 8000 }); },
};

// ─────────────────────────────── Overlays ───────────────────────────────
const Overlays = {
  stack: [],
  /** push an overlay {el, close(), onKey?} — el appended to #overlay-root */
  push(o) { this.stack.push(o); $('#overlay-root').appendChild(o.el); return o; },
  remove(o) { this.stack = this.stack.filter(x => x !== o); },
  top() { return this.stack[this.stack.length - 1]; },
  closeAll() { for (const o of [...this.stack].reverse()) o.close(); },
};

function makeOverlay(contentEl, { backdrop = true, onClose, onKey, animOutClass = 'out', dismissable = true } = {}) {
  const wrap = h('div', { style: { position: 'absolute', inset: '0' } });
  let bd = null;
  if (backdrop) { bd = h('div.backdrop'); wrap.appendChild(bd); }
  wrap.appendChild(contentEl);
  let closed = false;
  // an overlay takes the keyboard from whatever is behind it (a focused search box kept getting the typing) and
  // hands it back when it closes
  const prev = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  if (prev && prev.blur) prev.blur();
  const o = {
    el: wrap, onKey,
    close() {
      if (closed) return; closed = true;
      Overlays.remove(o);
      contentEl.classList.add(animOutClass); bd && bd.classList.add('out');
      setTimeout(() => wrap.remove(), 220 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--anim')) || 1) + 10);
      onClose && onClose();
      const a = document.activeElement;
      // (only a text box gets it back: a button refocused after a dialog showed a focus ring nobody asked for)
      if (prev && prev.isConnected && /^(INPUT|TEXTAREA)$/.test(prev.tagName) && !Overlays.top() && (!a || a === document.body || wrap.contains(a))) prev.focus({ preventScroll: true });
    },
  };
  if (bd && dismissable) bd.addEventListener('click', () => { UISounds.back(); o.close(); });
  return Overlays.push(o);
}

/** Dialogs, drawn like osu!lazer's PopupDialog: a white icon ring, the title and text, and a stack of slanted
 *  DialogButtons — Pink to confirm, Blue to cancel, Red for anything destructive. */
const Dialog = {
  popup(title, body, buttons, { icon: ic = 'question', onKey = null, onClose = null } = {}) {
    let o;
    const btn = b => h(`button.pd-btn.${b.cls || 'ok'}`, { style: { '--c': b.colour }, onclick: () => { UISounds[b.cancel ? 'back' : 'click'](); b.onClick && b.onClick(); o.close(); } }, h('span', b.label));
    const btns = buttons.map(btn);
    const dlg = h('div.dialog.popup', { role: 'dialog', 'aria-modal': 'true' },
      h('div.pd-ring', icon(ic)), h('h2', title), body != null ? h('div.body', body) : null, h('div.pd-buttons', ...btns));
    // (outside gameplay the music is muffled behind the dialog, as in lazer)
    const duck = typeof Screens === 'undefined' || Screens.currentName !== 'gameplay';
    if (duck) AudioManager.duck(true);
    o = makeOverlay(dlg, { onClose: () => { if (duck) AudioManager.duck(false); onClose && onClose(); }, onKey });
    return { o, btns };
  },
  confirm(title, body, { ok = 'Confirm', cancel = 'Cancel', danger = false, icon: ic = null } = {}) {
    return new Promise(resolve => {
      let result = false;
      const { btns } = this.popup(title, body, [
        { label: ok, colour: danger ? '#cc3333' : '#ff66aa', cls: danger ? 'ok.danger' : 'ok', onClick: () => { result = true; } },
        { label: cancel, colour: '#66ccff', cls: 'cancel', cancel: true },
      ], { icon: ic || (danger ? 'trash' : 'question'), onClose: () => resolve(result), onKey: e => { if (e.key === 'Enter') { btns[0].click(); return true; } } });
      setTimeout(() => btns[0].focus(), 30);
    });
  },
  prompt(title, value = '', { ok = 'Save', placeholder = '' } = {}) {
    return new Promise(resolve => {
      let result = null;
      const inp = h('input.input.pd-input', { value, placeholder, maxlength: 60 });
      const { o, btns } = this.popup(title, inp, [
        { label: ok, colour: '#ff66aa', onClick: () => { result = inp.value; } },
        { label: 'Cancel', colour: '#66ccff', cls: 'cancel', cancel: true },
      ], { icon: 'edit', onClose: () => resolve(result) });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); btns[0].click(); } e.stopPropagation(); if (e.key === 'Escape') o.close(); });
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
    });
  },
  custom(title, bodyEl, actions = []) {
    let o;
    const dlg = h('div.dialog', { role: 'dialog', 'aria-modal': 'true' }, h('h2', title), h('div.body', bodyEl),
      h('div.actions', ...actions.map(a => h(`button.btn${a.primary ? '.primary' : a.danger ? '.danger' : '.ghost'}`, { onclick: () => { a.onClick && a.onClick(); if (a.close !== false) o.close(); } }, a.label))));
    o = makeOverlay(dlg);
    return o;
  },
};

/** Context menu: items [{label, icon, onClick, checked, sep, header}] */
/** A popup menu at (x, y); with { above: true } y is where its bottom edge goes (a menu opened from a footer button). */
function showMenu(x, y, items, { above = false } = {}) {
  const menu = h('div.menu', { role: 'menu' });
  for (const it of items) {
    if (it.sep) { menu.appendChild(h('div.sep')); continue; }
    if (it.header) { menu.appendChild(h('div.hdr', it.header)); continue; }
    menu.appendChild(h(`button${it.danger ? '.danger' : ''}`, { role: 'menuitem', onclick: () => { UISounds.click(); o.close(); it.onClick && it.onClick(); } },
      it.icon ? icon(it.icon) : null, it.label, it.checked ? h('span.check', '✓') : null));
  }
  const o = makeOverlay(menu, { backdrop: false });
  const closer = e => { if (!menu.contains(e.target)) { o.close(); document.removeEventListener('pointerdown', closer, true); } };
  setTimeout(() => document.addEventListener('pointerdown', closer, true), 0);
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    menu.style.left = clamp(x, 8, innerWidth - r.width - 8) * Zoom.z + 'px';
    menu.style.top = clamp(above ? y - r.height : y, 8, innerHeight - r.height - 8) * Zoom.z + 'px';
    const f = menu.querySelector('button'); f && f.focus();
  });
  menu.addEventListener('keydown', e => {
    const btns = $$('button', menu); const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { btns[(i + 1) % btns.length].focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { btns[(i - 1 + btns.length) % btns.length].focus(); e.preventDefault(); }
  });
  return o;
}

// ─────────────────────────────── Background ───────────────────────────────
const Background = {
  current: null, flip: false,
  /** The blur is baked into a small copy of the image once (and cached), so the browser never has to run a live
   *  full-screen blur filter: that's what made menu blur too slow for Chromebooks. Where canvas filters aren't
   *  supported the CSS blur is used as before. */
  _baked: new Map(),
  canBake: typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype,
  bake(url, blur) {
    const key = url + '|' + blur;
    let p = this._baked.get(key);
    if (p) return p;
    p = (async () => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const W = 640, Hh = Math.max(1, Math.round(W * img.naturalHeight / Math.max(1, img.naturalWidth)));
      const c = document.createElement('canvas'); c.width = W; c.height = Hh;
      const x = c.getContext('2d');
      const r = blur * W / Math.max(640, innerWidth);
      x.filter = `blur(${r.toFixed(2)}px)`;
      x.drawImage(img, -r * 2, -r * 2, W + r * 4, Hh + r * 4); // drawn a little oversize so the edges stay opaque
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
      return blob ? URL.createObjectURL(blob) : null;
    })().catch(() => null);
    this._baked.set(key, p);
    if (this._baked.size > 16) { const [k, old] = this._baked.entries().next().value; this._baked.delete(k); old.then(u => u && setTimeout(() => URL.revokeObjectURL(u), 5000)); }
    return p;
  },
  /** Menus (song select, results, every page) show the song's background at a fixed 25% dim and 25% blur — the
   *  same scale as gameplay's sliders; the player's own dim and blur only apply once gameplay starts. */
  MENU_DIM: 0.25, MENU_BLUR: 0.25,
  menuBlurPx() { return this.MENU_BLUR * 50 * innerWidth / 1920; },
  set(url, { blur = this.menuBlurPx(), dim = this.MENU_DIM } = {}) {
    if (url !== this.current) Bus.emit('bg:changed', url);
    const app = $('#app');
    app.classList.toggle('bg-empty', !url);
    const a = $('#bg-a'), b = $('#bg-b');
    const bake = url && blur > 0.5 && this.canBake;
    const bright = `brightness(${1 - dim})`;
    const filter = bake ? bright : `blur(${blur}px) ${bright}`;
    const apply = el => {
      if (!bake) return;
      const tok = this._tok = {};
      this.bake(url, blur).then(u => { if (u && tok === this._tok && this.current === url) { el.style.backgroundImage = `url("${u}")`; el.style.filter = bright; } });
    };
    if (url === this.current) {
      const el = this.flip ? b : a;
      if (bake) apply(el); else { el.style.backgroundImage = url ? `url("${url}")` : 'none'; el.style.filter = filter; }
      return;
    }
    this.current = url;
    this.flip = !this.flip;
    const show = this.flip ? b : a, hide = this.flip ? a : b;
    // until the blurred copy is ready (a few ms; instant when cached) the image shows with a CSS blur
    show.style.backgroundImage = url ? `url("${url}")` : 'none';
    show.style.filter = `blur(${blur}px) ${bright}`;
    show.classList.toggle('show', !!url);
    hide.classList.remove('show');
    apply(show);
  },
  parallax(e) {
    if (!Settings.get('ui.parallax') || $('#app').classList.contains('in-game')) { $('#bg-layer').style.transform = ''; return; }
    const x = (e.clientX / innerWidth - 0.5) * -16, y = (e.clientY / innerHeight - 0.5) * -12;
    $('#bg-layer').style.transform = `translate(${x}px, ${y}px) scale(1.02)`;
  },
};

// ─────────────────────────────── Toolbar ───────────────────────────────
const Toolbar = {
  /** osu!lazer's Toolbar, 40px tall on Gray(0.1): settings and home, then the ruleset, on the left; beatmap listing,
   *  now playing, you, the clock and notifications on the right. A button lights up (an additive grey inset 3px with
   *  6px corners) under the pointer, flashes white when clicked and stays carmine while the panel it opens is showing.
   *  Tooltips are lazer's: big shadowed lowercase text under the button with the hotkey in a little box, over an 80px
   *  shade that fades in below the bar while the pointer is on it. */
  build() {
    const tb = $('#toolbar');
    clearEl(tb);
    if (!tb._wired) {
      tb._wired = true;
      // a click flashes the button and hides its tooltip until the pointer leaves (it sat half-visible under the panel it opened)
      tb.addEventListener('click', e => {
        const b = e.target.closest('.tb-btn'); if (!b) return;
        b.classList.add('tip-off');
        b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
      });
      tb.addEventListener('pointerout', e => { const b = e.target.closest('.tb-btn'); if (b && !b.contains(e.relatedTarget)) b.classList.remove('tip-off'); });
      tb.addEventListener('pointerover', e => { const b = e.target.closest('.tb-btn'); if (b && !b.contains(e.relatedTarget)) UISounds.hover(); });
    }
    const btn = (ic, title, sub, fn, { key, right, cls = '', ...extra } = {}) =>
      h(`button.tb-btn${cls}`, { 'aria-label': title, onclick: () => { UISounds.click(); fn(); }, ...extra },
        h('span.tb-st'), icon(ic), this.tip(title, sub, key, right));
    // lazer's ToolbarMusicButton: the note and a thin volume bar beside it; scrolling on it changes the master volume
    this.volFill = h('i');
    this.volBar = h('span.tb-vol', this.volFill);
    this.npBtn = h('button.tb-btn.tb-music', { 'aria-label': 'now playing', dataset: { ov: 'np' }, onclick: () => { UISounds.click(); NowPlaying.toggle(); } },
      h('span.tb-st'), icon('music'), this.volBar, this.tip('now playing', 'manage the currently playing track', 'F6', true));
    this.npText = h('span'); // (lazer's toolbar shows just the note; the title is in the panel)
    this.bellCount = h('span.tb-badge', h('span'));
    this.bell = btn('bell', 'notifications', 'waiting for \'ya', () => Notifications.toggle(), { key: 'Ctrl+N', right: true, dataset: { ov: 'notifications' } });
    this.bell.append(this.bellCount);
    // like lazer's toolbar toggles: a page's button closes that page when it's already open
    const page = name => () => { if (Screens.currentName === name) Screens.back(); else Screens.go(name); };
    this.pages = { explore: page('explore'), profile: page('profile') };
    this.clock = h('button.tb-clock', { 'aria-label': 'clock', onclick: () => { UISounds.click(); this.cycleClock(); } });
    // lazer's ToolbarRulesetSelector, here with the one ruleset: its icon in #00ffaa over a darker triangle-patterned
    // background, with the little white line under the selected one
    const ruleset = h('div.tb-ruleset',
      btn('mania', 'osu!mania', 'play some osu!mania', () => {}, { cls: '.tb-rs' }),
      h('span.tb-rs-line'));
    tb.append(
      h('div.tb-group.tb-left',
        btn('gear', 'settings', `change the way ${APP_NAME} behaves`, () => SettingsPanel.toggle(), { key: 'Ctrl+O', dataset: { ov: 'settings' } }),
        btn('home', 'home', 'return to the main menu', () => this.home(), { key: 'Alt+Home' })),
      ruleset,
      h('div.tb-spacer'),
      h('div.tb-group.tb-right',
        btn('download', 'beatmap listing', 'browse for new beatmaps', this.pages.explore, { key: 'Ctrl+B', right: true, dataset: { tab: 'explore' } }),
        this.npBtn,
        // (lazer's order: you, then the clock, then notifications)
        this.profileBtn = h('button.tb-btn.tb-profile', { dataset: { tab: 'profile' }, 'aria-label': 'your profile', onclick: () => { UISounds.click(); this.pages.profile(); },
          oncontextmenu: e => { e.preventDefault(); this.userMenu(e); } }),
        this.clock,
        this.bell),
    );
    this.updateProfile();
    this.buildClock();
    this.tick();
    setInterval(() => this.tick(), 1000);
    Bus.on('music:changed', () => this.updateNp());
    Bus.on('notif:changed', () => this.updateBell());
    Bus.on('settings:changed', k => { if (k === 'audio.master' || k === '*') this.updateVolume(); });
    Bus.on('screen:changed', () => this.sync());
    this.updateBell();
    this.updateVolume();
  },
  tip(title, sub, key, right) {
    return h(`span.tb-tip${right ? '.r' : ''}`, h('b', title), h('span.tb-sub', h('span', sub), key ? h('kbd', key.toUpperCase()) : null));
  },
  home() { if (Screens.currentName !== 'home') Screens.go('home'); },
  /** lazer's global hotkeys for the toolbar's buttons (Ctrl+O is in App.onKey with the rest). */
  hotkey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.altKey && !ctrl && e.code === 'Home') { this.home(); return true; }
    if (!ctrl && !e.altKey && !e.shiftKey && e.code === 'F6') { NowPlaying.toggle(); return true; }
    if (ctrl && !e.altKey && !e.shiftKey && e.code === 'KeyB') { this.pages.explore(); return true; }
    if (ctrl && !e.altKey && !e.shiftKey && e.code === 'KeyN') { Notifications.toggle(); return true; }
    return false;
  },
  updateBell() {
    const n = Notifications.unread, c = this.bellCount;
    if (n > (this._lastN || 0)) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
    this._lastN = n;
    c.firstChild.textContent = n ? n.toLocaleString('en-US') : '';
    c.classList.toggle('show', n > 0);
    this.bell.classList.toggle('has', n > 0);
  },
  updateVolume() { if (this.volFill) this.volFill.style.transform = `scaleY(${clamp(Settings.get('audio.master'), 0, 1)})`; },
  /** the volume bar widens from 3px to 6px while the wheel is changing the volume over it, for a second after */
  volumeTouched() {
    this.volBar.classList.add('wide');
    clearTimeout(this._volT); this._volT = setTimeout(() => this.volBar.classList.remove('wide'), 1000);
  },
  /** The carmine "open" state of the buttons whose panel is showing (lazer's ToolbarOverlayToggleButton). */
  sync() {
    cancelAnimationFrame(this._syncRaf);
    this._syncRaf = requestAnimationFrame(() => {
      const on = { settings: !!SettingsPanel.o, np: !!NowPlaying.open, notifications: Notifications.isOpen() };
      $$('#toolbar [data-ov]').forEach(b => b.classList.toggle('on', !!on[b.dataset.ov]));
      $$('#toolbar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === this._tab));
    });
  },
  /** lazer's ToolbarClock: click to go full (analog + digital + time running) → digital with time running → digital →
   *  analog → full. The analog face is 22px with a 2px white rim, white hands and a pink second hand that ticks with
   *  a little elastic bounce; the time is "h:mm:ss tt" (or 24-hour where that's the local habit). */
  CLOCK_MODES: ['full', 'runtime', 'digital', 'analog'],
  buildClock() {
    const mode = this.CLOCK_MODES.includes(Settings.get('ui.clockMode')) ? Settings.get('ui.clockMode') : 'full';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 22 22'); svg.setAttribute('class', 'tb-analog');
    // hands drawn pointing at 12, rotated about the centre: lazer's LargeHand is 2.4px thick, 34% / 48% of the face
    // long, with a 0.7px Gray2 rim; the SecondHand is 66% long, 1.68px thick and starts 3.36px behind the centre
    const hand = (cls, len) => `<g class="${cls}"><line x1="11" y1="11" x2="11" y2="${(11 - (len * 22 - 2.4)).toFixed(2)}" class="rim"/><line x1="11" y1="11" x2="11" y2="${(11 - (len * 22 - 2.4)).toFixed(2)}" class="core"/></g>`;
    svg.innerHTML = '<circle cx="11" cy="11" r="10" class="face"/>' + hand('hr', 0.34) + hand('mn', 0.48) +
      '<g class="sc"><line x1="11" y1="13.52" x2="11" y2="0.68"/></g><circle cx="11" cy="11" r="1.2" class="dot"/><circle cx="11" cy="11" r="0.84" class="dot2"/>';
    this.hands = { hr: svg.querySelector('.hr'), mn: svg.querySelector('.mn'), sc: svg.querySelector('.sc') };
    this._rot = { hr: null, mn: null, sc: null };
    this.clockTime = h('span.tb-time'); this.clockRun = h('span.tb-run', h('span', 'running'), this.clockRunT = h('span'));
    // (append() writes a literal "null" for null arguments, so only the parts this mode shows are passed)
    clearEl(this.clock).append(...[h('span.tb-st'), mode === 'full' || mode === 'analog' ? svg : null,
      mode !== 'analog' ? h('span.tb-digital', this.clockTime, mode === 'full' || mode === 'runtime' ? this.clockRun : null) : null].filter(Boolean));
    this.clock.dataset.mode = mode;
    this.clock.classList.add('tb-btn');
    this._lastT = '';
  },
  cycleClock() {
    const i = this.CLOCK_MODES.indexOf(this.clock.dataset.mode);
    Settings.set('ui.clockMode', this.CLOCK_MODES[(i + 1) % this.CLOCK_MODES.length]);
    this.buildClock(); this.tick();
  },
  use24h() {
    if (this._h24 == null) { try { const hc = new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hourCycle; this._h24 = hc === 'h23' || hc === 'h24'; } catch { this._h24 = false; } }
    return this._h24;
  },
  tick() {
    if ($('#app').classList.contains('in-game')) return; // the toolbar is hidden in game: don't relayout every second
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const t = this.use24h() ? `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
      : `${d.getHours() % 12 || 12}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
    if (this.clockTime && this.clockTime.textContent !== t) this.clockTime.textContent = t;
    if (this.clockRun && this.clockRun.isConnected) {
      // .NET's TimeSpan "c" format, as lazer prints it: hh:mm:ss, with a day count in front after a day
      const s = Math.floor(performance.now() / 1000), dd = Math.floor(s / 86400);
      this.clockRunT.textContent = `${dd ? dd + '.' : ''}${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
    }
    if (this.hands && this.hands.hr.isConnected) {
      const sec = d.getSeconds(), min = d.getMinutes() + sec / 60, hr = (d.getHours() % 12) + min / 60;
      this.turn('hr', hr * 30); this.turn('mn', min * 6); this.turn('sc', sec * 6);
    }
  },
  /** Rotate a clock hand the short way round (so 59 → 0 seconds carries on forwards rather than spinning back). */
  turn(k, deg) {
    const prev = this._rot[k];
    const next = prev == null ? deg : prev + ((((deg - prev) % 360) + 540) % 360 - 180);
    if (next === prev) return;
    this._rot[k] = next;
    this.hands[k].style.transform = `rotate(${next}deg)`;
    if (prev == null) { this.hands[k].style.transition = 'none'; void this.hands[k].getBoundingClientRect(); this.hands[k].style.transition = ''; }
  },
  setActive(id) { this._tab = id; this.sync(); },
  updateProfile() {
    const p = ProfileManager.profile;
    // lazer's ToolbarUserButton: the name, then a 32px picture with rounded corners (not a circle)
    clearEl(this.profileBtn).append(h('span.lbl', p.name), h('span.tb-av', ProfileManager.avatarEl(32)));
  },
  userMenu() {
    const r = this.profileBtn.getBoundingClientRect();
    const m = showMenu(r.right, r.bottom + 6, [
      { label: 'Profile', icon: 'user', onClick: () => Screens.go('profile') },
      { label: 'Replays', icon: 'film', onClick: () => Screens.go('replays') },
      { sep: true },
      { label: 'Beatmap library', icon: 'music', onClick: () => Screens.go('beatmaps') },
      { label: 'Collections', icon: 'folder', onClick: () => Screens.go('collections') },
      { label: 'Skins', icon: 'brush', onClick: () => Screens.go('skins') },
      { sep: true },
      { label: 'What\'s new', icon: 'sparkle', onClick: () => WhatsNew.show() },
      { label: 'Settings', icon: 'gear', onClick: () => SettingsPanel.open() },
    ]);
    return m;
  },
  /** Kept for callers that announce the playing track; the panel reads MenuMusic.current. */
  setNowPlaying(map) { if (map && MenuMusic.current !== map) { MenuMusic.current = map; this.updateNp(); NowPlaying.render(); } else if (!map) this.updateNp(); },
  updateNp() {
    const m = MenuMusic.current;
    this.npText.textContent = m ? `${m.artist} - ${m.title}` : '';
    this.npBtn.classList.toggle('paused', !Music.playing);
  },
};

/** lazer's MarqueeContainer: text that fits sits centred; text that doesn't scrolls left at 50px/s after a second's
 *  pause, followed by a copy 15px behind it, round and round. */
function marquee(el, make) {
  clearEl(el).classList.add('marquee');
  const flow = h('span.mq-flow', make());
  el.append(flow);
  requestAnimationFrame(() => {
    const w = flow.firstChild.getBoundingClientRect().width, room = el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight);
    if (!(w > room + 0.5)) return;
    flow.append(h('span.mq-copy', make()));
    const dist = w + 15, ms = 1000 + dist * 1000 / 50;
    el.classList.add('scroll');
    flow.animate([{ transform: 'none' }, { transform: 'none', offset: 1000 / ms }, { transform: `translateX(${-dist}px)` }], { duration: ms, iterations: Infinity });
  });
}

/** osu!lazer's NowPlayingOverlay: a 400×130 player 10px under the toolbar's right end, the track's background dimmed
 *  behind its title (25px italic) and artist (15px bold italic), with shuffle, previous / play / next and the
 *  playlist along a darker strip at the bottom, and a thin yellow seek bar that thickens under the pointer. A new
 *  track's background slides in from the side it came from. The playlist drops down 10px below it. */
const NowPlaying = {
  el: null, open: false,
  ensure() {
    if (this.el) return;
    this.bgs = h('div.np-bgs');
    this.title = h('div.np-title'); this.artist = h('div.np-artist');
    this.fill = h('i');
    this.bar = h('div.np-bar', h('span.np-bar-bg'), this.fill);
    const b = (ic, tip, fn, cls = '') => h(`button.np-ctl${cls}`, { title: tip, 'aria-label': tip, onclick: e => { e.stopPropagation(); fn(); } }, h('span.np-ctl-in', icon(ic)));
    this.playBtn = b('npplay', 'Play / pause', () => MenuMusic.toggle(), '.np-play');
    this.shuffleBtn = b('shuffle', 'Shuffle', () => { Settings.set('audio.shuffle', !this.shuffleOn()); this.paintToggles(); }, '.np-side.np-shuffle');
    this.listBtn = b('bars', 'Playlist', () => this.togglePlaylist(), '.np-side.np-listbtn');
    this.list = h('div.np-list');
    this.playlist = h('div.np-playlist', this.list);
    this.player = h('div.np-player', this.bgs, this.title, this.artist,
      h('div.np-bottom', this.shuffleBtn,
        h('div.np-ctls', b('npprev', 'Previous track', () => MenuMusic.prev()), this.playBtn, b('npnext', 'Next track', () => MenuMusic.next())),
        this.listBtn),
      this.bar);
    this.el = h('div.np-panel', this.player, this.playlist);
    // lazer's IconButton: squeezes to 75% while held (2s OutQuint) and springs back (1s OutElastic), flashes yellow on click
    this.el.addEventListener('pointerdown', e => { const c = e.target.closest('.np-ctl'); if (c) c.classList.add('down'); });
    window.addEventListener('pointerup', () => $$('.np-ctl.down').forEach(c => c.classList.remove('down')));
    this.el.addEventListener('click', e => { const c = e.target.closest('.np-ctl'); if (c) { UISounds.click(); c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); } });
    const seek = e => {
      const r = this.bar.getBoundingClientRect();
      if (!Music.loaded) return;
      const pos = clamp((e.clientX - r.left) / r.width, 0, 1) * Music.duration;
      if (Music.playing) Music.play(pos, { fadeIn: 60 }); else Music.pausedPos = pos;
      this.update();
    };
    this.bar.addEventListener('pointerdown', e => { seek(e); this.bar.setPointerCapture(e.pointerId); this._drag = true; });
    this.bar.addEventListener('pointermove', e => { if (this._drag) seek(e); });
    this.bar.addEventListener('pointerup', () => { this._drag = false; });
    // lazer's DragContainer: the player follows a drag on a rubber band (distance^0.7) and springs back when let go
    this.player.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('.np-ctl, .np-bar')) return;
      const x0 = e.clientX, y0 = e.clientY;
      this.el.classList.add('dragging');
      const move = ev => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0, len = Math.hypot(dx, dy), k = len > 0 ? Math.pow(len, 0.7) / len : 0;
        this.el.style.translate = `${dx * k}px ${dy * k}px`;
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.el.classList.remove('dragging'); this.el.style.translate = ''; };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    $('#app').appendChild(this.el);
    Bus.on('music:changed', () => this.render());
    document.addEventListener('pointerdown', e => {
      if (this.open && !this.el.contains(e.target) && !Toolbar.npBtn.contains(e.target)) this.hide();
    }, true);
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && this.open) { e.preventDefault(); e.stopImmediatePropagation(); this.hide(); } }, true);
    Bus.on('screen:changed', () => this.hide());
    this.paintToggles();
  },
  shuffleOn() { return Settings.get('audio.shuffle') !== false; },
  paintToggles() {
    this.shuffleBtn.classList.toggle('on', this.shuffleOn());
    this.listBtn.classList.toggle('on', this.el.classList.contains('list'));
  },
  togglePlaylist() {
    const on = !this.el.classList.contains('list');
    this.el.classList.toggle('list', on);
    if (on) this.renderList();
    this.paintToggles();
  },
  /** lazer's Playlist: every set as "title  artist" (the artist smaller, bold and grey), the playing one in yellow. */
  renderList() {
    const cur = MenuMusic.current;
    clearEl(this.list);
    const sets = BeatmapManager.sets.filter(s => s.maps.some(m => !m.problems.length));
    if (!sets.length) { this.list.append(h('div.np-li.empty', 'No beatmaps yet')); return; }
    for (const s of sets) {
      const m = s.maps.find(x => !x.problems.length);
      const row = h('div.np-li', { onclick: () => { UISounds.click(); MenuMusic.go(m, false); } });
      row.classList.toggle('sel', !!cur && cur.setId === s.id);
      marquee(row, () => h('span', h('span.np-li-t', m.title), '  ', h('span.np-li-a', m.artist)));
      this.list.append(row);
    }
    const sel = this.list.querySelector('.sel');
    if (sel) requestAnimationFrame(() => sel.scrollIntoView({ block: 'nearest' }));
  },
  /** The toolbar's note (or F6) opens the panel, or closes it if it's showing — like lazer, hovering doesn't. */
  toggle() {
    if (this.open) { this.hide(); return; }
    this.show();
  },
  show() {
    this.ensure();
    if (this.open) return;
    this.open = true;
    this.el.classList.add('show');
    this.render();
    const loop = () => { if (!this.open) return; this.update(); this._raf = requestAnimationFrame(loop); };
    loop();
    Toolbar.sync();
  },
  hide() { if (!this.el) return; this.open = false; this.el.classList.remove('show'); cancelAnimationFrame(this._raf); Toolbar.sync(); },
  async render() {
    if (!this.el) return;
    const m = MenuMusic.current;
    const key = m ? m.setId : '';
    if (key !== this._key || !this.title.firstChild) {
      marquee(this.title, () => h('span', m ? m.title : 'Nothing to play'));
      marquee(this.artist, () => h('span', m ? m.artist : 'Nothing to play'));
    }
    if (this.el.classList.contains('list')) this.renderList();
    if (key === this._key && this.bgs.firstChild) { this.update(); return; }
    this._key = key;
    const dir = MenuMusic.dir || 0; MenuMusic.dir = 0;
    const url = m ? await BeatmapManager.bgURL(m).catch(() => null) : null;
    if (key !== this._key) return;
    // the new background slides in from the right after "next" (from the left after "previous"), pushing the old one out
    const old = [...this.bgs.children];
    const bg = h('div.np-bg', h('div.np-bg-img', { style: url ? `background-image: url("${url}")` : '' }));
    if (dir && old.length && this.open) {
      bg.style.transform = `translateX(${dir * 100}%)`;
      this.bgs.append(bg);
      void bg.offsetWidth;
      bg.classList.add('slide'); bg.style.transform = '';
      for (const o of old) { o.classList.add('slide'); o.style.transform = `translateX(${-dir * 100}%)`; setTimeout(() => o.remove(), 520); }
    } else { old.forEach(o => o.remove()); this.bgs.append(bg); }
    this.update();
  },
  update() {
    const d = Music.duration, t = clamp(Music.time, 0, d || 0);
    this.fill.style.transform = `scaleX(${d ? (t / d).toFixed(4) : 0})`;
    const ic = Music.playing ? 'nppause' : 'npplay';
    if (this.playBtn.dataset.ic !== ic) { this.playBtn.dataset.ic = ic; clearEl(this.playBtn.firstChild).append(icon(ic)); }
  },
};

/** osu!lazer-style back button (pink, slanted, bottom-left). */
function backButton(onClick) {
  const b = h('button.lz-back', { onclick: () => { UISounds.back(); onClick(); }, title: 'Back (Esc)', 'aria-label': 'Back' }, h('span.lz-back-inner', icon('back'), 'back'));
  b.addEventListener('pointerenter', () => UISounds.hover());
  return b;
}

/** osu!lazer's VolumeOverlay: the mouse wheel changes the volume on the main menu and in game (anywhere with Alt),
 *  shown at the left edge as three rings — effects, master (the big one) and music. Hover a ring to choose which
 *  one the wheel changes; the overlay fades away a moment after the last change. */
const VolumeOverlay = {
  el: null, hideT: 0, sel: 'master', hover: false,
  KEYS: { master: 'audio.master', music: 'audio.music', effects: 'audio.effects' },
  adjust(which, delta) {
    const key = this.KEYS[which] || 'audio.master';
    const v = clamp(Math.round((Settings.get(key) + delta) * 100) / 100, 0, 1);
    Settings.set(key, v);
    if (which === 'master' && v > 0) this._muted = null;
    this.show(which);
  },
  ring(which, label, big) {
    const R = big ? 38 : 26, C = 2 * Math.PI * R, sz = (R + 8) * 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${sz} ${sz}`); svg.setAttribute('width', sz); svg.setAttribute('height', sz);
    svg.innerHTML = `<circle cx="${sz / 2}" cy="${sz / 2}" r="${R}" class="vo-bg"/><circle cx="${sz / 2}" cy="${sz / 2}" r="${R}" class="vo-fg" stroke-dasharray="${C}" transform="rotate(-90 ${sz / 2} ${sz / 2})"/>`;
    const num = h('span.vo-num'), el = h(`div.vo-meter.${which}${big ? '.big' : ''}`, { onpointerenter: () => { this.sel = which; this.paint(); } }, h('div.vo-dial', svg, num), h('div.vo-label', label));
    el._fg = svg.querySelector('.vo-fg'); el._C = C; el._num = num; el._which = which;
    return el;
  },
  build() {
    this.meters = [this.ring('effects', 'Effects'), this.ring('master', 'Master', true), this.ring('music', 'Music')];
    this.muteBtn = h('button.vo-mute', { title: 'Mute', 'aria-label': 'Mute', onclick: () => this.toggleMute() }, icon('volume'));
    this.el = h('div.volume-overlay', { onpointerenter: () => { this.hover = true; clearTimeout(this.hideT); }, onpointerleave: () => { this.hover = false; this.later(); } },
      this.muteBtn, ...this.meters);
    $('#app').appendChild(this.el);
  },
  toggleMute() {
    const v = Settings.get('audio.master');
    if (v > 0) { this._muted = v; Settings.set('audio.master', 0); } else Settings.set('audio.master', this._muted || 0.8);
    this.show('master');
  },
  paint() {
    for (const m of this.meters) {
      const v = Settings.get(this.KEYS[m._which]);
      m._fg.style.strokeDashoffset = (m._C * (1 - v)).toFixed(1);
      m._num.textContent = Math.round(v * 100);
      m.classList.toggle('sel', m._which === this.sel);
    }
    const muted = Settings.get('audio.master') === 0;
    this.muteBtn.classList.toggle('on', muted);
    clearEl(this.muteBtn).append(icon(muted ? 'mute' : 'volume'));
  },
  show(which) {
    if (!this.el) this.build();
    if (which) this.sel = which;
    this.paint();
    this.el.classList.add('show');
    this.later();
  },
  later() { clearTimeout(this.hideT); if (!this.hover) this.hideT = setTimeout(() => { this.el.classList.remove('show'); this.sel = 'master'; }, 1000); },
  /** Is the pointer over something that scrolls (a list, a panel)? Then the wheel scrolls it instead. */
  overScroller(t) {
    for (let el = t; el && el !== document.body; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 2) { const o = getComputedStyle(el).overflowY; if (o === 'auto' || o === 'scroll') return true; }
    }
    return false;
  },
  bind() {
    window.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) return;
      const scr = Screens.currentName, shown = this.el && this.el.classList.contains('show');
      const here = scr === 'home' || (scr === 'gameplay' && !Settings.get('input.noWheelVolumeInGame'));
      // lazer's ToolbarMusicButton: the wheel over the toolbar's note always changes the master volume
      const onNote = !!(e.target.closest && e.target.closest('.tb-music'));
      if (onNote) { this.sel = 'master'; Toolbar.volumeTouched(); }
      if (!e.altKey && !(shown && this.hover) && !onNote) {
        if (!here || Overlays.stack.length || SettingsPanel.o || this.overScroller(e.target)) return;
        if (scr === 'gameplay' && GameplayScreen.pauseEl) return;
      }
      e.preventDefault(); e.stopPropagation();
      const which = e.altKey && e.shiftKey ? 'music' : e.altKey && e.ctrlKey ? 'effects' : this.sel;
      // lazer's VolumeMeter: 5% for each notch of the wheel. A touchpad or a smooth-scrolling wheel sends a notch as many
      // small events, and those add up (each used to count as a whole notch, so the volume raced away)
      const notch = e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 1 : 100;
      if (which !== this._accFor || performance.now() - (this._accT || 0) > 600) this._acc = 0;
      this._accFor = which; this._accT = performance.now();
      this._acc += clamp(-e.deltaY / notch, -3, 3) * 0.05;
      const step = Math.trunc(this._acc * 100) / 100;
      if (step) { this._acc -= step; this.adjust(which, step); } else this.show(which);
    }, { passive: false, capture: true });
  },
};

/** osu!lazer's menu cursor: a white arrow with a soft outline, drawn by the browser (so it never lags) at the size
 *  chosen in settings; it shrinks a little while a button is held, like lazer's. Hidden in game as before. */
const LazerCursor = {
  apply() {
    const on = Settings.get('ui.lazerCursor') !== false, size = clamp(Settings.get('ui.cursorSize') || 1, 0.5, 2);
    const root = document.documentElement.style;
    if (!on) { root.removeProperty('--lz-cursor'); root.removeProperty('--lz-cursor-down'); document.body.classList.remove('lz-cursor'); return; }
    // lazer's menu cursor: a dark rounded arrow with a white rim; pressed, it shrinks slightly and glows pink
    const mk = (k, pressed) => {
      const S = Math.round(32 * size * k);
      const path = 'M6.2 3.2 L25.4 17.2 Q27.3 18.7 24.9 19.2 L17.6 20.4 Q16.6 20.6 16.1 21.5 L12.4 28.2 Q11.2 30.1 10.5 28 L4.6 5.2 Q4.1 2.1 6.2 3.2 Z';
      const glow = pressed ? '<path d="' + path + '" fill="none" stroke="#ff66ab" stroke-opacity=".75" stroke-width="5" stroke-linejoin="round"/>' : '';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 32 32">${glow}<path d="${path}" transform="translate(.8 1.4)" fill="rgba(0,0,0,.35)"/><path d="${path}" fill="#16141c" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/><path d="M7.4 6.4 L21.6 16.8" stroke="rgba(255,255,255,.18)" stroke-width="1.4" stroke-linecap="round"/></svg>`;
      return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(5.4 * S / 32)} ${Math.round(3 * S / 32)}`;
    };
    root.setProperty('--lz-cursor', `${mk(1)}, auto`);
    root.setProperty('--lz-cursor-down', `${mk(0.9, true)}, auto`);
    document.body.classList.add('lz-cursor');
  },
  init() {
    this.apply();
    Bus.on('settings:changed', k => { if (k === 'ui.lazerCursor' || k === 'ui.cursorSize' || k === '*') this.apply(); });
    window.addEventListener('pointerdown', () => document.body.classList.add('lz-down'), true);
    window.addEventListener('pointerup', () => document.body.classList.remove('lz-down'), true);
  },
};

/** osu!lazer's NotificationOverlay: everything that popped up as a toast is kept here (newest first) until cleared;
 *  the toolbar bell counts the ones you haven't seen. */
const Notifications = {
  list: [], unread: 0, el: null,
  add(title, body, type = 'info') {
    this.list.unshift({ id: Math.random().toString(36).slice(2), title: String(title), body: body ? String(body) : '', type, at: Date.now() });
    if (this.list.length > 60) this.list.length = 60;
    if (!this.isOpen()) this.unread++;
    Bus.emit('notif:changed');
    if (this.isOpen()) this.render();
  },
  isOpen() { return !!(this.el && this.el.classList.contains('open')); },
  toggle() { this.isOpen() ? this.close() : this.open(); },
  open() {
    if (!this.el) {
      this.listEl = h('div.nf-list');
      this.el = h('div.nf-panel', { role: 'dialog', 'aria-label': 'Notifications' },
        h('div.nf-head', h('div.nf-title', 'notifications'), h('div.nf-sub', 'waiting for \'ya'), h('button.btn.sm.nf-clear', { onclick: () => this.clear() }, 'Clear all')),
        this.listEl);
      $('#app').appendChild(this.el);
      document.addEventListener('pointerdown', e => { if (this.isOpen() && !this.el.contains(e.target) && !e.target.closest('.tb-btn')) this.close(); }, true);
      // like lazer's overlays: Esc closes it (before anything else hears the key), and so does going to another screen
      window.addEventListener('keydown', e => { if (e.key === 'Escape' && this.isOpen()) { e.preventDefault(); e.stopImmediatePropagation(); UISounds.back(); this.close(); } }, true);
      Bus.on('screen:changed', () => this.close());
    }
    this.render();
    this.el.classList.add('open');
    this.unread = 0; Bus.emit('notif:changed');
    Toolbar.sync();
  },
  close() { if (this.el) this.el.classList.remove('open'); Toolbar.sync(); },
  clear() { this.list = []; this.render(); Bus.emit('notif:changed'); },
  ago(t) { const s = Math.round((Date.now() - t) / 1000); return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; },
  render() {
    if (!this.listEl) return;
    const ico = { info: 'info', ok: 'star', err: 'x' };
    clearEl(this.listEl).append(...(this.list.length ? this.list.map(n => h(`div.nf-item.${n.type}`,
      h('div.nf-ico', icon(ico[n.type] || 'info', n.type === 'ok' ? 'fill' : '')),
      h('div.nf-body', h('div.nf-t', n.title), n.body ? h('div.nf-b', n.body) : null, h('div.nf-time', this.ago(n.at))),
      h('button.nf-x', { title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => { this.list = this.list.filter(x => x !== n); this.render(); } }, icon('x')))) : [h('div.nf-empty', 'No notifications')]));
  },
};

/**
 * Keeps the interface the same physical size regardless of browser zoom (like a native client):
 * zoom shortcuts (Ctrl +/-/0, Ctrl + wheel, pinch) are blocked, and a zoom level that is already set
 * is detected (outer/inner window width, sanity-checked against the device pixel ratio) and undone by
 * laying #app out at the un-zoomed size and scaling it back down.
 */
const Zoom = {
  z: 1,
  LEVELS: [0.25, 0.3, 1 / 3, 0.5, 2 / 3, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 4 / 3, 1.5, 1.7, 1.75, 2, 2.4, 2.5, 3, 4, 5],
  BASE_DPR: [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.625, 3, 3.5, 4],
  init() {
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && ['Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'Digit0', 'Numpad0'].includes(e.code)) e.preventDefault();
    }, true);
    window.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) e.preventDefault(); }, { passive: false, capture: true });
    ['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
    window.addEventListener('resize', () => this.update());
    this.update();
  },
  /** The browser's zoom level. The first reading compares the window's outer and inner widths; after that, zooming
   *  changes devicePixelRatio while the screen stays the same, so a change is followed exactly from there (a new
   *  screen — another monitor — takes a fresh reading). */
  detect() {
    const dpr = window.devicePixelRatio || 1, sw = screen.width, sh = screen.height;
    const b = this._base;
    if (b && b.sw === sw && b.sh === sh) return clamp(b.bz * dpr / b.dpr, 0.25, 5);
    const bz = this.guess();
    this._base = { dpr, bz, sw, sh };
    return bz;
  },
  guess() {
    const ow = window.outerWidth, iw = window.innerWidth;
    if (!ow || !iw) return 1;
    const raw = ow / iw;
    const lvl = this.LEVELS.reduce((a, b) => Math.abs(b - raw) < Math.abs(a - raw) ? b : a);
    if (lvl === 1 || Math.abs(lvl - raw) / lvl > 0.03) return 1; // side panels / devtools make the ratio meaningless
    const base = (window.devicePixelRatio || 1) / lvl;
    return this.BASE_DPR.some(b => Math.abs(b - base) < 0.06) ? lvl : 1;
  },
  /** The whole interface is laid out for a 1366×768 space and scaled to fit the window (as lazer's scaling container
   *  does), times the "UI scaling" setting — so it looks the same at any resolution and any browser zoom, and UI
   *  scaling is the one way to make it bigger or smaller. Narrow screens (phones) keep their own responsive layout. */
  update() {
    const bz = this.detect(), W = innerWidth * bz, H = innerHeight * bz;
    const fit = W >= 1000 && H >= 560 ? clamp(Math.min(W / 1366, H / 768), 0.75, 4) : 1;
    const ui = typeof Settings !== 'undefined' && Settings.values ? clamp(Settings.get('ui.scale') || 0.9, 0.5, 2) : 0.9;
    const k = fit * ui / bz, z = Math.abs(k - 1) < 0.002 ? 1 : 1 / k;
    const r = document.documentElement.style;
    // (vw / vh inside the app mean the app's layout size, not the window's)
    r.setProperty('--vw', (innerWidth * z / 100).toFixed(3) + 'px'); r.setProperty('--vh', (innerHeight * z / 100).toFixed(3) + 'px');
    if (z === this.z) return;
    this.z = z;
    r.setProperty('--zoom', z); r.setProperty('--zoom-inv', 1 / z);
    $('#app').classList.toggle('zoomfix', z !== 1);
    Bus.emit('ui:scaled', 1 / z);
  },
  /** Canvas backing-store scale for sizes measured in layout px (clientWidth). */
  dpr() { return (window.devicePixelRatio || 1) / this.z; },
};

function toggleFullscreen(force) {
  const el = document.documentElement;
  const on = !!document.fullscreenElement;
  if (force === undefined) force = !on;
  if (force && !on) return (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : Promise.reject()).catch(() => Toast.err('Fullscreen unavailable', 'Your browser blocked fullscreen.'));
  if (!force && on) return document.exitFullscreen().catch(() => {});
  return Promise.resolve();
}

// ─────────────────────────────── ScreenManager ───────────────────────────────
const Screens = {
  registry: {},
  current: null, currentName: null,
  history: [],
  busy: false,
  register(name, screen) { this.registry[name] = screen; },
  async go(name, params = {}, { replace = false, transition = 'default' } = {}) {
    const next = this.registry[name];
    if (!next || this.busy) return;
    if (this.currentName === name && !params.force) { next.refresh && next.refresh(params); return; }
    this.busy = true;
    try {
      const prev = this.current, prevName = this.currentName;
      if (prev) {
        if (prev.canLeave && !(await prev.canLeave())) return;
        if (!replace && prevName && !prev.transient) this.history.push(prevName);
        if (this.history.length > 20) this.history.shift();
        const oldEl = prev.el;
        prev.leave && prev.leave();
        if (oldEl) {
          oldEl.classList.remove('enter', 'zoom', 'from-right');
          oldEl.classList.add('leave'); if (transition === 'zoom') oldEl.classList.add('zoom');
          oldEl.inert = true; // (its state is already torn down: a click during the fade-out used to reach stale handlers)
          setTimeout(() => oldEl.remove(), 220);
        }
      }
      this.current = next; this.currentName = name;
      const el = await next.enter(params);
      next.el = el;
      el.classList.add('screen', 'enter');
      if (transition === 'zoom') el.classList.add('zoom');
      if (transition === 'right') el.classList.add('from-right');
      $('#screens').appendChild(el);
      Toolbar.setActive(next.tab || name);
      $('#app').classList.toggle('in-game', !!next.inGame);
      Bus.emit('screen:changed', name);
    } finally { this.busy = false; }
  },
  back() {
    if (this.current && this.current.onBack && this.current.onBack() === true) return;
    let prev = this.history.pop();
    while (prev && (prev === this.currentName || this.registry[prev]?.transient)) prev = this.history.pop();
    UISounds.back();
    this.go(prev || 'home', {}, { replace: true });
  },
};
