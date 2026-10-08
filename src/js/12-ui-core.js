/* UIManager: icons, toasts, dialogs, menus, background, toolbar and the ScreenManager. */

/** A page's "nothing here" card: an icon in a circle, a title, a line of help and maybe a button — so empty lists,
 *  offline pages and failed searches all look alike. `slash` strikes the icon through (can't reach / failed);
 *  `cls` adds classes (".plain" drops the card behind it, ".compact" for small panels). */
function stateCard(ic, title, sub, { slash = false, action = null, cls = '' } = {}) {
  return h(`div.off-state${cls}`, h('div.off-ico', icon(ic), slash ? h('i') : null), h('div.off-t', title), sub ? h('div.off-sub', sub) : null, action);
}

// (every icon is one of lazer's: 12-icons.js)
const ICONS = {};
function icon(name, cls = '') {
  // (each icon is parsed once and copied after that: lists build hundreds of them, and parsing the markup every
  // time was a good part of what a long list cost to draw)
  const key = name + '|' + cls;
  let t = icon.cache.get(key);
  if (!t) {
    t = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    t.setAttribute('aria-hidden', 'true');
    // lazer's own icons first (12-icons.js): the filled version where there is one ("heart" / "heart-fill")
    const src = (/\bfill\b/.test(cls) && ICON_SRC[name + '-fill']) || ICON_SRC[name];
    if (src && src[0] === 'L') {
      // an osu!lazer icon texture, drawn as a mask in the text colour (like lazer tints its white icons)
      t.setAttribute('viewBox', '0 0 24 24'); t.setAttribute('class', `i lzi lzi-${icon.img(src[1])} ${cls}`);
    } else if (src) {
      // Font Awesome 5, as osu!framework draws it: the glyph filling its box
      t.setAttribute('viewBox', `0 0 ${src[1]} ${src[2]}`); t.setAttribute('class', `i fai ${cls}`);
      t.innerHTML = `<path d="${src[3]}" style="fill:currentColor;stroke:none"/>`;
    } else {
      t.setAttribute('viewBox', '0 0 24 24'); t.setAttribute('class', `i ${cls}`);
      t.innerHTML = (ICONS[name] || '').replace(/class="fillme"/g, 'fill="currentColor" stroke="none"');
    }
    icon.cache.set(key, t);
  }
  return t.cloneNode(true);
}
icon.cache = new Map();
/** One CSS rule per lazer icon picture (the picture isn't repeated in every element) — all made in one go the first
 *  time any is used: adding them one by one as icons first appeared made the browser restyle the page each time. */
icon.img = n => {
  if (!icon.sheet) {
    icon.sheet = document.createElement('style');
    icon.sheet.textContent = Object.keys(ICON_IMG).map(k => `svg.lzi-${k.replace(/[^a-zA-Z0-9-]/g, '_')} { --lzi: url("${ICON_IMG[k]}"); }`).join('\n');
    document.head.appendChild(icon.sheet);
  }
  return n.replace(/[^a-zA-Z0-9-]/g, '_');
};

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
/** lazer's StarRatingDisplay changing value: the number (and its colour) runs from the old rating to the new one over
 *  100ms + 80ms per star of difference (at most 1s), OutQuint. `paint(stars)` is told each step (for colours around it). */
function starBadgeRoll(from, to, paint) {
  const el = starBadge(from == null ? to : from);
  if (from == null || Math.abs(from - to) < 0.005 || !Settings.get('ui.animSpeed')) { if (paint) paint(to); return el; }
  const txt = el.lastChild, D = Math.min(1000, 100 + 80 * Math.abs(to - from)), t0 = performance.now();
  const step = now => {
    const t = Math.min(1, (now - t0) / D), v = from + (to - from) * (1 - (1 - t) ** 5);
    txt.nodeValue = v.toFixed(2); el.style.setProperty('--sc', starColour(v)); el.style.color = v >= 6.5 ? '#ffd966' : '#16101f';
    if (paint) paint(v);
    if (t < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return el;
}
/** osu!lazer's tooltips (OsuTooltipContainer): a dark grey box with 5px corners following the cursor. Elements keep
 *  using the plain `title` attribute; on first hover it moves to data-tip so the browser's own tooltip never shows.
 *  The first tooltip waits a moment; moving on to the next element shows its tooltip straight away, as in lazer. */
// lazer's OsuButton click flash, on every button (restarted on each click)
document.addEventListener('click', e => {
  const b = e.target && e.target.closest && e.target.closest('.btn, .pm-btn');
  if (!b || b.disabled) return;
  b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
}, true);
document.addEventListener('animationend', e => { if (e.animationName === 'btnFlash') e.target.classList.remove('flash'); else if (e.animationName === 'pmFlash') e.target.closest('.pm-btn')?.classList.remove('flash'); }, true);

/** lazer's OsuTextBox draws each letter as a FallingDownContainer: one you delete doesn't just vanish, it drops out of
 *  the box and fades (200ms, InExpo). A native input can't move its letters, so a copy of what was deleted is laid over
 *  the spot it left and dropped from there. */
const FallingText = {
  TYPES: new Set(['text', 'search', 'url', 'email']),
  init() {
    document.addEventListener('beforeinput', e => { try { this.drop(e); } catch { /* only decoration */ } });
  },
  drop(e) {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !this.TYPES.has(t.type) || !e.inputType.startsWith('delete') || e.isComposing) return;
    if (document.documentElement.classList.contains('slow') || document.documentElement.classList.contains('perf') || document.getElementById('app').classList.contains('in-game')) return; // (not mid-song)
    const v = t.value; let a = t.selectionStart, b = t.selectionEnd;
    if (a == null || !v) return;
    if (a === b) {
      if (e.inputType === 'deleteContentBackward') a = Math.max(0, a - 1);
      else if (e.inputType === 'deleteContentForward') b = Math.min(v.length, b + 1);
      else if (e.inputType === 'deleteWordBackward') a = v.slice(0, a).search(/\S*\s*$/);
      else return;
    }
    const gone = v.slice(a, b);
    if (!gone.trim() || gone.length > 60) return;
    const cs = getComputedStyle(t), r = t.getBoundingClientRect();
    // (measured by a hidden copy of the text beside the box: it gets the box's font and any scaling of the page around it)
    const m = document.createElement('span');
    m.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:pre;pointer-events:none';
    Object.assign(m.style, { font: cs.font, letterSpacing: cs.letterSpacing, fontKerning: cs.fontKerning });
    t.after(m);
    const w = s => { m.textContent = s; return m.getBoundingClientRect().width; };
    const k = t.offsetWidth ? r.width / t.offsetWidth : 1; // (the page's scale here)
    const left = r.left + (parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)) * k;
    const inner = r.width - (parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) * k;
    const all = w(v), slack = Math.max(0, inner - all);
    const align = cs.textAlign === 'center' ? slack / 2 : cs.textAlign === 'right' || cs.textAlign === 'end' ? slack : 0;
    const x = left + align + w(v.slice(0, a)) - t.scrollLeft * k, gw = w(gone);
    m.remove();
    if (x < r.left - 2 || x > r.right) return;
    const el = document.createElement('span');
    el.className = 'fall-text';
    el.textContent = gone;
    const size = (parseFloat(cs.fontSize) || 14) * k;
    Object.assign(el.style, { left: x + 'px', top: (r.top + r.height / 2) + 'px', font: cs.font, fontSize: size + 'px', color: cs.color, letterSpacing: cs.letterSpacing, clipPath: `inset(-100vh ${Math.max(0, x + gw - r.right)}px -100vh 0)` });
    document.body.append(el);
    const d = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--anim')) || 1;
    const anim = el.animate([{ transform: 'translateY(-50%)', opacity: 1 }, { transform: `translateY(calc(-50% + ${size}px))`, opacity: 0 }],
      { duration: 200 * d, easing: 'cubic-bezier(.7, 0, .84, 0)' });
    anim.onfinish = anim.oncancel = () => el.remove();
  },
};

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
      const show = () => { if (this.still) return; const was = this.visible; this.el.textContent = tip; this.el.classList.add('show'); this.visible = true; this.place(!was); };
      if (this.visible) show(); else this._t = setTimeout(show, 450);
    });
    document.addEventListener('pointermove', e => { if (this.still && this.x !== undefined && (Math.abs(e.clientX - this.x) > 2 || Math.abs(e.clientY - this.y) > 2)) this.still = false; this.x = e.clientX; this.y = e.clientY; if (this.visible) this.place(); }, { passive: true });
    Bus.on('screen:changed', () => { this.hide(); this.cur = null; this.still = true; });
    document.addEventListener('pointerleave', () => { this.cur = null; this.hide(); });
    document.addEventListener('pointerdown', () => { clearTimeout(this._t); this.hide(); }, true);
    document.addEventListener('keydown', () => this.hide(), true);
  },
  hide() { clearTimeout(this._t); if (this.visible) { this.visible = false; this.el.classList.remove('show'); } },
  /** lazer's tooltip trails the pointer (it eases to where the pointer is over 120ms OutQuint) instead of being stuck to
   *  it; a tooltip that has just appeared starts right there. */
  place(snap = false) {
    const r = this.el.getBoundingClientRect();
    let x = (this.x || 0) + 14, y = (this.y || 0) + 18;
    if (x + r.width > innerWidth - 6) x = innerWidth - r.width - 6;
    if (y + r.height > innerHeight - 6) y = (this.y || 0) - r.height - 10;
    this.tx = x; this.ty = y;
    if (snap || this.px === undefined) { this.px = x; this.py = y; this.draw(); return; }
    if (!this._raf) { this._last = performance.now(); this._raf = requestAnimationFrame(() => this.follow()); }
  },
  follow() {
    this._raf = 0;
    const now = performance.now(), k = 1 - Math.exp(-(now - this._last) / 32); this._last = now; // (~OutQuint over 120ms)
    this.px += (this.tx - this.px) * k; this.py += (this.ty - this.py) * k;
    if (Math.abs(this.tx - this.px) < .3 && Math.abs(this.ty - this.py) < .3) { this.px = this.tx; this.py = this.ty; }
    this.draw();
    if (this.visible && (this.px !== this.tx || this.py !== this.ty)) this._raf = requestAnimationFrame(() => this.follow());
  },
  draw() { this.el.style.transform = `translate(${this.px.toFixed(1)}px, ${this.py.toFixed(1)}px) scale(${(1 / Zoom.z).toFixed(3)})`; },
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
  show(title, body = '', { type = 'info', timeout = 4200, log = true, onClick = null } = {}) {
    const ico = { info: 'info', ok: 'star', err: 'x' }[type] || 'info';
    const box = $('#toasts');
    const key = `${type}\n${title}\n${body}`;
    // the same message again while it's still up refreshes that toast instead of stacking a copy
    const same = [...box.children].find(t => t._key === key && !t.classList.contains('out'));
    if (same) { same._arm(); same.classList.remove('bump'); void same.offsetWidth; same.classList.add('bump'); return same._close; }
    if (log && typeof Notifications !== 'undefined') Notifications.add(title, body, type, { onClick });
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
    el.addEventListener('pointerleave', () => { if (timeout && !el._drag) timer = setTimeout(close, 1500); });
    el.addEventListener('click', () => { if (el._dragged) { el._dragged = false; return; } if (onClick) onClick(); close(); });
    Toast.draggable(el, close);
    if (onClick) el.classList.add('act');
    el._arm();
    return close;
  },
  /** lazer's toasts can be dragged: rubber-banded (the pull eases off the further it goes), tilting as they go left;
   *  thrown left (tilted past 10° or flicked) they fly off and fall away; pushed right they go to the notifications;
   *  let go anywhere else they spring back (800ms OutElastic). */
  draggable(el, close) {
    let sx = 0, sy = 0, x = 0, y = 0, vx = 0, vy = 0, lt = 0, lx = 0, ly = 0, id = null;
    const put = () => { el.style.translate = `${x}px ${y}px`; el.style.rotate = `${Math.min(0, x * 0.1)}deg`; };
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || el.classList.contains('out')) return;
      id = e.pointerId; sx = e.clientX; sy = e.clientY; x = y = vx = vy = 0; lt = performance.now(); lx = ly = 0;
      el.getAnimations().forEach(a => { if (a._spring) a.cancel(); });
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - sx, dy = e.clientY - sy;
      if (!el._drag) { if (Math.hypot(dx, dy) < 6) return; el._drag = true; el.setPointerCapture(id); el.classList.add('dragging'); }
      const len = Math.hypot(dx, dy), k = len > 0 ? Math.pow(len, 0.8) / len : 0;
      dx *= k; dy *= k;
      if (dx >= 0) dy = 0;
      else { const t = Math.min(1, -dx / 200); dy *= t < .5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2; } // (InOutQuart)
      x = dx; y = dy; put();
      const now = performance.now(), dt = Math.max(1, now - lt), a = 1 - Math.exp(-dt / 40);
      vx += ((x - lx) / dt - vx) * a; vy += ((y - ly) / dt - vy) * a; lx = x; ly = y; lt = now;
    });
    const end = e => {
      if (e.pointerId !== id) return;
      id = null;
      if (!el._drag) return;
      el._drag = false; el._dragged = true; el.classList.remove('dragging');
      if (Math.min(0, x * 0.1) < -10 || vx < -0.3) {
        // flung: it keeps its speed and falls (lazer's fling), then it's gone
        if (vx > -0.3) vx = -0.3 - 0.5 * Math.random();
        let last = performance.now();
        const fly = now => {
          const dt = now - last; last = now;
          vy += dt * 0.005; x += vx * dt; y += vy * dt; put();
          if (y < innerHeight + 200 && x > -innerWidth) requestAnimationFrame(fly); else el.remove();
        };
        el.classList.add('flung');
        requestAnimationFrame(fly);
      } else if (x > 30 || vx > 0.3) close();
      else {
        const a = el.animate([{ translate: `${x}px ${y}px`, rotate: `${Math.min(0, x * 0.1)}deg` }, { translate: '0px 0px', rotate: '0deg' }],
          { duration: 800, easing: getComputedStyle(document.documentElement).getPropertyValue('--el-out') || 'ease-out' });
        a._spring = true;
        x = y = 0; el.style.translate = ''; el.style.rotate = '';
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  },
  /** lazer's ProgressNotification: a toast with a bar. Like lazer's tray, the toast steps aside after a moment (not
   *  while the pointer is on it; it can be swiped away too) and the bar carries on in the notifications until the work
   *  is done, so it never sits over a page for a whole download. `onCancel`: the entry's X cancels the work, as in lazer.
   *  Returns { set(fraction, text), done(title, body), fail(title, body), cancelled() }. */
  progress(title, body = '', { onCancel = null } = {}) {
    const box = $('#toasts');
    const bar = h('i'), txt = h('div.t-body', body);
    const el = h('div.toast.info.prog', { role: 'status' }, h('div.t-ico', icon('download')), h('div', h('div.t-title', title), txt, h('div.t-bar', bar)));
    box.appendChild(el);
    while (box.children.length > 5) box.firstChild.remove();
    const n = Notifications.add(title, body, 'info', { prog: 0, onCancel });
    let timer = 0;
    const close = () => { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 300); };
    const arm = ms => { clearTimeout(timer); timer = setTimeout(close, ms); };
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => { if (!el._drag) arm(1500); });
    el.addEventListener('click', () => { if (el._dragged) { el._dragged = false; return; } close(); });
    Toast.draggable(el, close);
    arm(4200);
    return {
      set(f, text) { bar.style.width = (clamp(f || 0, 0, 1) * 100).toFixed(1) + '%'; if (text != null) txt.textContent = text; Notifications.progress(n, f, text); },
      done: (t, b) => { close(); Notifications.remove(n); Toast.ok(t, b); },
      fail: (t, b) => { close(); Notifications.remove(n); Toast.err(t, b); },
      cancelled: () => { close(); Notifications.remove(n); },
    };
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
    const btn = b => {
      const go = () => { UISounds[b.cancel ? 'back' : 'click'](); b.onClick && b.onClick(); o.close(); };
      if (!/danger/.test(b.cls || '')) return h(`button.pd-btn.${b.cls || 'ok'}`, { style: { '--c': b.colour }, onclick: go }, h('span', b.label));
      return this.dangerButton(b, go);
    };
    const btns = buttons.map(btn);
    const dlg = h('div.dialog.popup', { role: 'dialog', 'aria-modal': 'true' },
      h('div.pd-ring', icon(ic)), h('h2', title), body != null ? h('div.body', body) : null, h('div.pd-buttons', ...btns));
    // (outside gameplay the music is muffled behind the dialog, as in lazer)
    const duck = typeof Screens === 'undefined' || Screens.currentName !== 'gameplay';
    if (duck) AudioManager.duck(true);
    o = makeOverlay(dlg, { onClose: () => { if (duck) AudioManager.duck(false); onClose && onClose(); }, onKey });
    return { o, btns };
  },
  /** lazer's PopupDialogDangerousButton, in red — confirmed with a single press (no holding). */
  dangerButton(b, go) {
    return h(`button.pd-btn.${b.cls}`, { style: { '--c': b.colour }, onclick: () => {
      if (Settings.get('audio.uiSounds')) { const buf = AudioManager.synth('dialog-dangerous-select'); buf && AudioManager.play(buf, { bus: 'ui' }); }
      go();
    } }, h('span', b.label));
  },
  confirm(title, body, { ok = 'Confirm', cancel = 'Cancel', danger = false, icon: ic = null } = {}) {
    return new Promise(resolve => {
      let result = false;
      const { btns } = this.popup(title, body, [
        { label: ok, colour: danger ? '#cc3333' : '#ff66aa', cls: danger ? 'ok.danger' : 'ok', onClick: () => { result = true; } },
        { label: cancel, colour: '#66ccff', cls: 'cancel', cancel: true },
      ], { icon: ic || (danger ? 'trash' : 'question'), onClose: () => resolve(result), onKey: e => { if (e.key === 'Enter' && !danger) { btns[0].click(); return true; } } });
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
  const menu = h(`div.menu${above ? '.up' : ''}`, { role: 'menu' });
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
      // (in the picture worker where it can: blurring here held up the menu each time the song changed)
      const r0 = blur * 640 / Math.max(640, innerWidth), done = await ImageWorker.run({ op: 'blur', url, W: 640, r: r0 });
      if (done && done.blob) return URL.createObjectURL(done.blob);
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
  set(url, { blur = Settings.get('graphics.performanceMode') ? 0 : this.menuBlurPx(), dim = this.MENU_DIM } = {}) { // (Performance mode: no blur, nothing to bake)
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

/** osu!lazer's OnScreenDisplay: a 240px-minimum box of black at 70% with corners of 20, centred three quarters of
 *  the way down the screen — what changed on top (14px bold), its new value in the middle (24px light) and the shortcut
 *  at the bottom (12px bold, faint). It grows in over 0.5s and, half a second after the last change, fades away
 *  over 1.5s. Used for settings changed with a key (scroll speed, play speed, the leaderboard, music controls…). */
const OSD = {
  show(what, value, keys = '') {
    if (!this.el) {
      this.what = h('div.osd-what'); this.value = h('div.osd-value'); this.keys = h('div.osd-keys');
      this.el = h('div.osd', { 'aria-live': 'polite' }, this.what, this.value, this.keys);
      $('#app').appendChild(this.el);
    }
    this.what.textContent = String(what).toUpperCase(); this.value.textContent = value; this.keys.textContent = keys ? String(keys).toUpperCase() : '';
    const el = this.el;
    if (!el.classList.contains('show')) { el.getAnimations().forEach(a => a.cancel()); el.classList.add('show'); el.animate([{ opacity: 0, height: '99px' }, { opacity: 1, height: '110px' }], { duration: 500, easing: 'cubic-bezier(.22, 1, .36, 1)' }); }
    else el.getAnimations().forEach(a => a.cancel());
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      const a = el.animate([{ opacity: 1, height: '110px' }, { opacity: 0, height: '99px' }], { duration: 1500, easing: 'cubic-bezier(.64, 0, .78, 0)' });
      a.onfinish = () => el.classList.remove('show');
    }, 500);
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
    this.chatCount = h('span.tb-badge', h('span'));
    // like lazer's toolbar toggles: a page's button closes that page when it's already open
    const page = name => () => { if (Screens.currentName === name) Screens.back(); else Screens.go(name); };
    this.pages = { explore: page('explore'), profile: page('profile'), rankings: page('rankings') };
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
        // lazer's ToolbarChangelogButton
        btn('sparkle', 'changelog', 'track recent dev updates in Ashtonk!mania', () => WhatsNew.show(), { right: true, cls: '.tb-changelog' }),
        btn('trophy', 'rankings', 'find out who\'s the best right now', this.pages.rankings, { right: true, dataset: { tab: 'rankings' } }),
        btn('beatmap', 'beatmap listing', 'browse for new beatmaps', this.pages.explore, { key: 'Ctrl+B', right: true, dataset: { tab: 'explore' } }),
        this.chatBtn = btn('chat', 'chat', 'join the real-time discussion', () => Chat.toggle(), { key: 'F8', right: true, dataset: { ov: 'chat' } }),
        btn('social', 'dashboard', 'view your friends and who\'s online', () => OnlinePanel.toggle(), { right: true, dataset: { tab: 'dashboard' } }),
        // lazer's ToolbarWikiButton: here, the help — every keyboard shortcut, screen by screen
        this.npBtn,
        // (lazer's order: you, then the clock, then notifications)
        this.profileBtn = h('button.tb-btn.tb-profile', { dataset: { tab: 'profile' }, 'aria-label': 'your profile', onclick: () => { UISounds.click(); this.pages.profile(); },
          oncontextmenu: e => { e.preventDefault(); this.userMenu(e); } }),
        this.clock,
        this.bell),
    );
    this.chatBtn.append(this.chatCount);
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
    if (!ctrl && !e.altKey && !e.shiftKey && e.code === 'F8') { Chat.toggle(); return true; }
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
      const on = { settings: !!SettingsPanel.o, np: !!NowPlaying.open, notifications: Notifications.isOpen(), chat: !!(typeof Chat !== 'undefined' && Chat.o) };
      // lazer pushes the screen 5% of a side panel's width away from it, for a sense of depth
      $('#app').classList.toggle('side-l', on.settings);
      $('#app').classList.toggle('side-r', on.notifications && !on.settings);
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
    const st = Settings.get('online.status') || 'online';
    clearEl(this.profileBtn).append(h('span.lbl', p.name), h('span.tb-av', ProfileManager.avatarEl(32), st !== 'online' ? h(`i.tb-st.${st}`, { title: st === 'dnd' ? 'Do not disturb' : 'Appearing offline' }) : null));
  },
  userMenu() {
    const r = this.profileBtn.getBoundingClientRect();
    // lazer's UserDropdown: your status first
    const cur = Settings.get('online.status') || 'online';
    const status = (v, label, col) => ({ label: h('span.st-opt', h('i', { style: { background: col } }), label), checked: cur === v, onClick: () => this.setStatus(v) });
    const m = showMenu(r.right, r.bottom + 6, [
      status('online', 'Online', '#b3d944'), status('dnd', 'Do not disturb', '#ff6666'), status('offline', 'Appear offline', '#999999'),
      { sep: true },
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
  /** Online, Do not disturb (no invites or pop-ups) or Appear offline (off everyone's list, can't be spectated). */
  setStatus(v) {
    if ((Settings.get('online.status') || 'online') === v) return;
    Settings.set('online.status', v);
    if (typeof Presence !== 'undefined') Presence.send({ t: 'vis', v });
    this.updateProfile();
    Toast.show(v === 'offline' ? 'You appear offline' : v === 'dnd' ? 'Do not disturb' : 'You\'re online', v === 'offline' ? 'Nobody sees you on the online list or can spectate you.' : v === 'dnd' ? 'No invites or pop-ups until you change it back.' : 'Everyone can see you on the online list.');
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
      marquee(this.title, () => h('span', m ? m.title : 'no beatmaps available!')); // (lazer's DummyWorkingBeatmap)
      marquee(this.artist, () => h('span', m ? m.artist : 'please load a beatmap!'));
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
  const b = h('button.lz-back', { onclick: () => { UISounds.back(); b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); onClick(); }, title: 'Back (Esc)', 'aria-label': 'Back' }, h('span.lz-back-inner', icon('leftcircle'), 'back'));
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

/** osu!lazer's MenuCursor (MenuCursorContainer), drawn by the game as lazer draws it: its menu-cursor texture at 0.15×
 *  (× the cursor size setting, × the interface scale). Pressing shrinks it to 0.9× and fades in a pink glow over
 *  800 ms (OutQuint); letting go springs it back (500 ms, OutElastic). (lazer can also turn it to point along a drag;
 *  that's off by default here.) Each press and release plays lazer's cursor-tap, panned to where
 *  the cursor is and pitched a little at random (lower on release). The system cursor is hidden while it's on; it's
 *  hidden too in gameplay (until the mouse moves), for touch, and while keys are being pressed. */
const LazerCursor = {
  TEX_W: 312, TEX_H: 442, BASE: 0.15,
  /** CSS linear() easings for osu!framework's elastic curves. */
  ease(fn) { const pts = []; for (let i = 0; i <= 48; i++) pts.push(fn(i / 48).toFixed(4)); return `linear(${pts.join(', ')})`; },
  apply() {
    const on = !this.missing && Settings.get('ui.lazerCursor') !== false && matchMedia('(hover: hover)').matches;
    document.body.classList.toggle('lz-cursor', on);
    if (!on) { if (this.el) this.el.hidden = true; return; }
    if (!this.el) this.build();
    this.size();
  },
  build() {
    const OUT_ELASTIC = t => t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
    const OUT_ELASTIC_QUARTER = t => t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((0.25 * t - 0.075) * (2 * Math.PI) / 0.3 * 4) + 1;
    this.EL = this.ease(OUT_ELASTIC); this.ELQ = this.ease(OUT_ELASTIC_QUARTER);
    this.add = h('span.lzc-add');
    this.scaleEl = h('span.lzc-scale', h('img.lzc-img', { src: 'lazer/menu-cursor.png', alt: '', draggable: 'false',
      // (no picture — index.html opened on its own, without the lazer/ folder next to it: the system cursor, rather
      // than a broken-image box following the mouse)
      onerror: () => { this.missing = true; this.apply(); } }), this.add);
    this.rotEl = h('span.lzc-rot', this.scaleEl);
    this.el = h('div#lz-cur', { hidden: true, 'aria-hidden': 'true' }, this.rotEl);
    document.body.appendChild(this.el);
    this.rot = 0; this.drag = 0; // 0 not dragging, 1 started, 2 rotating
    const OQ = 'cubic-bezier(.23, 1, .32, 1)';
    const anim = (el, prop, to, ms, easing) => {
      const from = getComputedStyle(el)[prop];
      el.getAnimations().filter(a => a._p === prop).forEach(a => a.cancel());
      const a = el.animate([{ [prop]: from }, { [prop]: to }], { duration: ms, easing, fill: 'forwards' }); a._p = prop;
    };
    this.rotTo = (deg, ms, easing) => { this.rot = deg; anim(this.rotEl, 'rotate', `${deg}deg`, ms, easing); };
    let lastT = 0;
    const move = e => {
      if (e.pointerType === 'touch') { this.el.hidden = true; return; }
      this.x = e.clientX; this.y = e.clientY;
      this.el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      const t = e.target && e.target.closest ? e.target : null;
      this.el.hidden = !document.body.classList.contains('lz-cursor') || !!(t && t.closest('.gameplay:not(.show-cursor)'));
      if (this.drag) {
        const now = performance.now(), dt = Math.max(1, now - lastT); lastT = now;
        let dx = e.clientX - this.dx, dy = e.clientY - this.dy, dist = Math.hypot(dx, dy);
        // (lazer lets the centre of the turn drift after the pointer once it's far away)
        if (dist > 60) { const k = Math.min(1, 0.04 / dt * 16); this.dx += dx * k * 0.06; this.dy += dy * k * 0.06; dx = e.clientX - this.dx; dy = e.clientY - this.dy; dist = Math.hypot(dx, dy); }
        if (this.drag === 1 && dist > 80 * this.k) this.drag = 2;
        if (this.drag === 2 && dist > 0) {
          let deg = Math.atan2(-dx, dy) * 180 / Math.PI + 24.3, diff = (deg - this.rot) % 360;
          if (diff < -180) diff += 360; if (diff > 180) diff -= 360;
          this.rotTo(this.rot + diff, 120, OQ);
        }
      }
    };
    window.addEventListener('pointermove', e => { move(e); if (this.el.classList.contains('kb')) this.el.classList.remove('kb'); }, { passive: true, capture: true });
    // lazer hides the menu cursor while you use the keyboard (PopOut: fades over 250ms, shrinking to 0.6×); moving
    // the mouse brings it back
    window.addEventListener('keydown', e => { if (!e.repeat && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) this.el.classList.add('kb'); }, true);
    window.addEventListener('pointerdown', e => {
      move(e);
      if (e.pointerType === 'touch' || this.el.hidden) return;
      this.scaleEl.getAnimations().forEach(a => a.cancel());
      anim(this.scaleEl, 'scale', '0.9', 800, OQ);
      this.add.getAnimations().forEach(a => a.cancel());
      this.add.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, easing: OQ, fill: 'forwards' });
      if (Settings.get('ui.cursorRotate') && this.drag !== 2) { this.drag = 1; this.dx = e.clientX; this.dy = e.clientY; lastT = performance.now(); }
      this.tap(1);
    }, true);
    window.addEventListener('pointerup', e => {
      if (e.buttons) return;
      this.add.getAnimations().forEach(a => a.cancel());
      this.add.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, easing: OQ, fill: 'forwards' });
      anim(this.scaleEl, 'scale', '1', 500, this.EL);
      if (this.drag) { this.rotTo(0, 400 * (0.5 + Math.abs(this.rot / 960)), this.ELQ); this.rot = 0; this.drag = 0; }
      if (e.pointerType !== 'touch' && !this.el.hidden) this.tap(0.8);
    }, true);
    document.documentElement.addEventListener('pointerleave', () => { this.el.hidden = true; });
    window.addEventListener('blur', () => { this.el.hidden = true; });
    Bus.on('ui:scaled', () => this.size());
  },
  /** Texture × 0.15 × cursor size × the interface scale (lazer's cursor lives inside its scaling container). */
  size() {
    const k = this.k = clamp(Settings.get('ui.cursorSize') || 0.7, 0.5, 2) * this.BASE / (Zoom.z || 1);
    this.el.style.setProperty('--lzc-w', `${(this.TEX_W * k).toFixed(2)}px`);
    this.el.style.setProperty('--lzc-h', `${(this.TEX_H * k).toFixed(2)}px`);
  },
  /** lazer's playTapSample: ±1% pitch at random, panned by where the cursor is (at most 75%). */
  async tap(freq) {
    if (!Settings.get('audio.uiSounds') || !AudioManager.ctx || AudioManager.ctx.state !== 'running') return;
    if (!this._buf) this._buf = fetch('lazer/cursor-tap.wav').then(r => r.arrayBuffer()).then(b => AudioManager.ctx.decodeAudioData(b)).catch(() => null);
    const buf = await this._buf;
    if (!buf) return;
    AudioManager.play(buf, { bus: 'ui', volume: freq, rate: freq - 0.01 + Math.random() * 0.02, pan: ((this.x || 0) / innerWidth * 2 - 1) * 0.75 });
  },
  init() {
    this.apply();
    Bus.on('settings:changed', k => { if (k === 'ui.lazerCursor' || k === 'ui.cursorSize' || k === '*') this.apply(); });
  },
};

/** osu!lazer's NotificationOverlay: everything that popped up as a toast is kept here (newest first) until cleared;
 *  the toolbar bell counts the ones you haven't seen. */
const Notifications = {
  list: [], unread: 0, el: null,
  /** (`prog` makes it a live progress entry — Toast.progress's — which goes when the work is done and isn't counted:
   *  the finished or failed notice that replaces it is. `onClick`: as in lazer, clicking the entry does what clicking
   *  its toast did — opens the chat, the daily challenge… — and it's done with) */
  add(title, body, type = 'info', { prog = null, onCancel = null, onClick = null } = {}) {
    const n = { id: Math.random().toString(36).slice(2), title: String(title), body: body ? String(body) : '', type, at: Date.now(), prog, onCancel, onClick };
    this.list.unshift(n);
    if (this.list.length > 60) this.list.length = 60;
    if (!this.isOpen() && prog == null) this.unread++;
    Bus.emit('notif:changed');
    if (this.isOpen()) this.render();
    return n;
  },
  /** A live entry's bar and text, written in place (re-rendering the list on every tick would eat clicks on it). */
  progress(n, f, text) {
    n.prog = clamp(f || 0, 0, 1);
    if (text != null) n.body = String(text);
    if (n.barEl) n.barEl.style.width = (n.prog * 100).toFixed(1) + '%';
    if (n.bodyEl && text != null) n.bodyEl.textContent = n.body;
  },
  remove(n) {
    if (!this.list.includes(n)) return;
    this.list = this.list.filter(x => x !== n);
    Bus.emit('notif:changed');
    if (this.isOpen()) this.render();
  },
  isOpen() { return !!(this.el && this.el.classList.contains('open')); },
  toggle() { this.isOpen() ? this.close() : this.open(); },
  open() {
    if (!this.el) {
      this.listEl = h('div.nf-list');
      this.el = h('div.nf-panel', { role: 'dialog', 'aria-label': 'Notifications' },
        // lazer's NotificationSection: "NOTIFICATIONS" and its count in yellow, "CLEAR ALL" on the right
        h('div.nf-head', h('div.nf-title', 'NOTIFICATIONS', this.countEl = h('span.nf-count')), h('button.nf-clear', { onclick: () => { UISounds.click(); this.clear(); } }, 'CLEAR ALL')),
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
  /** How long ago, in whole units rounded down (90 minutes is "1h ago", not "2h"; 59½ minutes isn't "60m"). */
  ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000), f = (n, u) => `${Math.max(1, Math.floor(n))}${u} ago`;
    if (s < 45) return 'just now';
    if (s < 3600) return f(s / 60, 'm');
    if (s < 86400) return f(s / 3600, 'h');
    if (s < 30 * 86400) return f(s / 86400, 'd');
    if (s < 365 * 86400) { const n = Math.max(1, Math.floor(s / (30 * 86400))); return `${n} month${n === 1 ? '' : 's'} ago`; }
    const n = Math.floor(s / (365 * 86400)); return `${n} year${n === 1 ? '' : 's'} ago`;
  },
  render() {
    if (!this.listEl) return;
    const ico = { info: 'info', ok: 'star', err: 'x' };
    clearEl(this.listEl).append(...(this.list.length ? this.list.map(n => h(`div.nf-item.${n.type}${n.onClick ? '.act' : ''}`,
      { onclick: n.onClick ? e => { if (e.target.closest('.nf-x')) return; UISounds.click(); this.list = this.list.filter(x => x !== n); this.close(); n.onClick(); } : null },
      h('div.nf-ico', icon(n.prog != null ? 'download' : ico[n.type] || 'info', n.type === 'ok' ? 'fill' : '')),
      h('div.nf-body', h('div.nf-t', n.title), n.body || n.prog != null ? (n.bodyEl = h('div.nf-b', n.body)) : null,
        n.prog != null ? h('div.nf-bar', n.barEl = h('i', { style: { width: (n.prog * 100).toFixed(1) + '%' } })) : h('div.nf-time', this.ago(n.at))),
      n.prog != null && n.onCancel
        ? h('button.nf-x', { title: 'Cancel', 'aria-label': 'Cancel', onclick: () => { UISounds.click(); n.onCancel(); } }, icon('x'))
        : h('button.nf-x', { title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => { this.list = this.list.filter(x => x !== n); this.render(); } }, icon('check')))) : []));
    if (this.countEl) this.countEl.textContent = String(this.list.length);
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
    // (a phone's address bar sliding in or out changes the visible height: the layout follows it)
    if (window.visualViewport) visualViewport.addEventListener('resize', () => this.update());
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
    // (a phone's keyboard opening doesn't shrink the game: browsers that still resize the page for it keep the height
    // from before, and Keyboard pans the screen up instead — see 19d-mobile)
    const typing = document.documentElement.classList.contains('touch') && document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    const ih = typing && innerWidth === this._iw && innerHeight < (this._ih || 0) ? this._ih : innerHeight;
    if (!typing || innerWidth !== this._iw) { this._iw = innerWidth; this._ih = innerHeight; }
    const bz = this.detect(), W = innerWidth * bz, H = ih * bz;
    // a small window on a computer (or a browser zoom we couldn't read, such as a page opened at 300%) keeps scaling
    // down with the window, as lazer's does, instead of laying the full-size interface into a tiny space; phones and
    // tablets (no mouse) keep their own responsive layout
    const desktop = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches; // (the same test the narrow-screen CSS uses)
    // a phone or tablet held sideways gets the full interface too, exactly as osu!lazer on Android does: the same
    // 1366×768 layout as a computer, scaled to the screen (so a phone shows what a desktop window shows, smaller).
    // Held upright, it keeps the narrow responsive layout (and is asked to rotate).
    // (held upright — gameplay — the same space turned on its side, 768×1366, so the interface is the same size
    // either way up instead of twice as big upright)
    const touchLand = !desktop && W > H, touchUp = !desktop && !touchLand && typeof TOUCH_DEVICE !== 'undefined' && TOUCH_DEVICE;
    const fit = touchLand ? clamp(Math.min(W / 1366, H / 768), 0.2, 4) : touchUp ? clamp(Math.min(W / 768, H / 1366), 0.2, 4)
      : W >= 1000 && H >= 560 ? clamp(Math.min(W / 1366, H / 768), 0.75, 4) : desktop ? clamp(Math.min(W / 1366, H / 768), 0.3, 1) : 1;
    const ui = typeof Settings !== 'undefined' && Settings.values ? clamp(Settings.get('ui.scale') || (TOUCH_DEVICE ? 1.25 : 0.9), 0.5, 2) : 0.9;
    const k = fit * ui / bz, z = Math.abs(k - 1) < 0.002 ? 1 : 1 / k;
    const r = document.documentElement.style;
    // (vw / vh inside the app mean the app's layout size, not the window's)
    r.setProperty('--vw', (innerWidth * z / 100).toFixed(3) + 'px'); r.setProperty('--vh', (ih * z / 100).toFixed(3) + 'px');
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
  /** The screens' entrance animations (each ends where the element rests, so letting go of it changes nothing). */
  ENTRANCES: new Set(['scrIn', 'scrInRight', 'scrInZoom', 'scrInMenu', 'ssWedgeIn', 'ssCarIn', 'ssFootIn', 'ovBodyIn', 'ovBgIn', 'wedgeIn']),
  async go(name, params = {}, { replace = false, transition = 'default' } = {}) {
    // (a screen may be swapped for another first: in a multiplayer room, "home" means back to the room)
    if (this.redirect && !params.noRedirect) { name = this.redirect(name, this.currentName); if (!name) return; }
    const next = this.registry[name];
    if (!next || this.busy) return;
    if (this.currentName === name && !params.force) { next.refresh && next.refresh(params); return; }
    this.busy = true;
    const prevName = this.currentName;
    try {
      const prev = this.current;
      if (prev) {
        if (prev.canLeave && !(await prev.canLeave())) return;
        if (!replace && prevName && !prev.transient) this.history.push(prevName);
        if (this.history.length > 20) this.history.shift();
        const oldEl = prev.el;
        prev.leave && prev.leave();
        if (oldEl) {
          oldEl.classList.remove('enter', 'zoom', 'from-right');
          oldEl.classList.add('leave'); if (transition === 'zoom') oldEl.classList.add('zoom');
          // (an overlay closing to a screen that isn't one: lazer's pop-out as its waves drop)
          if (oldEl.classList.contains('ov') && !(next.ov)) this._popOut = true;
          // lazer's main menu leaves slowly (its buttons fold away, then it fades over 400ms, InSine) under the next screen
          const fromMenu = prevName === 'home';
          if (fromMenu) oldEl.classList.add('from-menu');
          oldEl.inert = true; // (its state is already torn down: a click during the fade-out used to reach stale handlers)
          setTimeout(() => oldEl.remove(), fromMenu ? 460 : 220);
        }
      }
      this.current = next; this.currentName = name;
      if (next.keepParams) next._lastParams = params; // (Back returns to the same one: someone's profile, not yours)
      const el = await next.enter(params);
      next.el = el;
      el.classList.add('screen', 'enter');
      if (prevName === 'home') el.classList.add('after-menu');
      if (transition === 'zoom') el.classList.add('zoom');
      if (transition === 'right') el.classList.add('from-right');
      if (this._popOut) { this._popOut = false; if (!el.classList.contains('ov')) UISounds.play('overlay-big-pop-out', 0.5); }
      // lazer's WaveOverlayContainer: an overlay screen opens with four waves in its colours sweeping up through it
      if (el.classList.contains('ov') && !document.documentElement.classList.contains('slow') && !document.documentElement.classList.contains('perf')) {
        const old = el.querySelector(':scope > .ov-waves'); if (old) old.remove();
        const waves = h('div.ov-waves', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
        if (!(prev && prev.el && prev.el.classList.contains('ov'))) UISounds.play('overlay-big-pop-in', 0.6);
        el.append(waves);
        setTimeout(() => waves.remove(), 1400);
      }
      // once it has come in, the screen's entrance animations are let go: one held on its last frame (fill: both)
      // keeps the screen on a compositor layer of its own, and then everything in it that overlaps — every card of a
      // long list — gets a layer too (hundreds of them, which made scrolling stutter on slow Chromebooks)
      // (one sweep for a burst of them: a list's cards each end their slide-in, and a sweep of the whole screen per card
      // — forty of them on a page of the library — took tens of milliseconds on a slow device)
      let sweep = 0;
      el.addEventListener('animationend', e => {
        if (!this.ENTRANCES.has(e.animationName) || sweep) return;
        sweep = setTimeout(() => {
          sweep = 0;
          for (const a of el.getAnimations({ subtree: true })) if (a.playState === 'finished' && this.ENTRANCES.has(a.animationName)) a.cancel();
        }, 120);
      });
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
    const to = prev || 'home', r = this.registry[to];
    this.go(to, r && r.keepParams && r._lastParams ? { ...r._lastParams, force: true } : {}, { replace: true });
  },
};
