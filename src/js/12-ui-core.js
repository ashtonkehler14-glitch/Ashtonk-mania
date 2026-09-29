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
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h0M10 10h0M14 10h0M18 10h0M7 14h10"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6M19 6a8 8 0 010 12"/>',
  retry: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  multi: '<circle cx="8" cy="9" r="3"/><circle cx="17" cy="9" r="3"/><path d="M2 20c.8-3.4 3.2-5 6-5s5.2 1.6 6 5M14 15.5c.9-.4 1.9-.5 3-.5 2.8 0 5.2 1.6 6 5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  sparkle: '<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" class="fillme"/><path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" class="fillme"/>',
  skip: '<path d="M5 5l9 7-9 7zM17 5v14"/>',
  prev: '<path d="M19 5l-9 7 9 7zM7 5v14"/>',
  bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 7V4M4 11h3M17 11h3M4 17h3M17 17h3M8 4l2 3M16 4l-2 3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h0M3 12h0M3 18h0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
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
function starBadge(sr) {
  const c = starColour(sr);
  const el = h('span.stars', { style: { '--sc': c, color: sr >= 6.5 ? '#ffd966' : '#16101f' } }, icon('star', 'fill'), sr.toFixed(2));
  return el;
}
function gradeEl(g, cls = '') {
  const label = g === 'XH' ? 'SS' : g === 'SH' ? 'S' : g;
  return h(`span.grade.grade-${g}${cls ? '.' + cls : ''}`, { title: g === 'XH' || g === 'SH' ? `${label} (Hidden)` : label }, label);
}

// ─────────────────────────────── Toasts ───────────────────────────────
const Toast = {
  show(title, body = '', { type = 'info', timeout = 4200 } = {}) {
    const ico = { info: 'info', ok: 'star', err: 'x' }[type] || 'info';
    const el = h(`div.toast.${type}`, { role: 'status' }, h('div.t-ico', icon(ico, type === 'ok' ? 'fill' : '')), h('div', h('div.t-title', title), body ? h('div.t-body', body) : null));
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 5) box.firstChild.remove();
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
    el.addEventListener('click', close);
    if (timeout) setTimeout(close, timeout);
    return close;
  },
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
  const o = {
    el: wrap, onKey,
    close() {
      if (closed) return; closed = true;
      Overlays.remove(o);
      contentEl.classList.add(animOutClass); bd && bd.classList.add('out');
      setTimeout(() => wrap.remove(), 220 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--anim')) || 1) + 10);
      onClose && onClose();
    },
  };
  if (bd && dismissable) bd.addEventListener('click', () => { UISounds.back(); o.close(); });
  return Overlays.push(o);
}

const Dialog = {
  confirm(title, body, { ok = 'Confirm', cancel = 'Cancel', danger = false } = {}) {
    return new Promise(resolve => {
      let result = false;
      const okBtn = h(`button.btn${danger ? '.danger' : '.primary'}`, { onclick: () => { result = true; UISounds.click(); o.close(); } }, ok);
      const dlg = h('div.dialog', { role: 'dialog', 'aria-modal': 'true' }, h('h2', title), h('div.body', body),
        h('div.actions', h('button.btn.ghost', { onclick: () => { UISounds.back(); o.close(); } }, cancel), okBtn));
      const o = makeOverlay(dlg, { onClose: () => resolve(result), onKey: e => { if (e.key === 'Enter') { okBtn.click(); return true; } } });
      setTimeout(() => okBtn.focus(), 30);
    });
  },
  prompt(title, value = '', { ok = 'Save', placeholder = '' } = {}) {
    return new Promise(resolve => {
      let result = null;
      const inp = h('input.input', { value, placeholder, style: { width: '100%' }, maxlength: 60 });
      const submit = () => { result = inp.value; UISounds.click(); o.close(); };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } e.stopPropagation(); if (e.key === 'Escape') o.close(); });
      const dlg = h('div.dialog', { role: 'dialog', 'aria-modal': 'true' }, h('h2', title), h('div.body', inp),
        h('div.actions', h('button.btn.ghost', { onclick: () => o.close() }, 'Cancel'), h('button.btn.primary', { onclick: submit }, ok)));
      const o = makeOverlay(dlg, { onClose: () => resolve(result) });
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
function showMenu(x, y, items) {
  const menu = h('div.menu', { role: 'menu' });
  for (const it of items) {
    if (it.sep) { menu.appendChild(h('div.sep')); continue; }
    if (it.header) { menu.appendChild(h('div.hdr', it.header)); continue; }
    menu.appendChild(h('button', { role: 'menuitem', onclick: () => { UISounds.click(); o.close(); it.onClick && it.onClick(); } },
      it.icon ? icon(it.icon) : null, it.label, it.checked ? h('span.check', '✓') : null));
  }
  const o = makeOverlay(menu, { backdrop: false });
  const closer = e => { if (!menu.contains(e.target)) { o.close(); document.removeEventListener('pointerdown', closer, true); } };
  setTimeout(() => document.addEventListener('pointerdown', closer, true), 0);
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    menu.style.left = clamp(x, 8, innerWidth - r.width - 8) * Zoom.z + 'px';
    menu.style.top = clamp(y, 8, innerHeight - r.height - 8) * Zoom.z + 'px';
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
  set(url, { blur = Settings.get('graphics.menuBlur'), dim = 0 } = {}) {
    const app = $('#app');
    app.classList.toggle('bg-empty', !url);
    const a = $('#bg-a'), b = $('#bg-b');
    const filter = `blur(${blur}px) brightness(${1 - dim})`;
    if (url === this.current) { (this.flip ? b : a).style.filter = filter; return; }
    this.current = url;
    this.flip = !this.flip;
    const show = this.flip ? b : a, hide = this.flip ? a : b;
    show.style.backgroundImage = url ? `url("${url}")` : 'none';
    show.style.filter = filter;
    show.classList.toggle('show', !!url);
    hide.classList.remove('show');
  },
  parallax(e) {
    if (!Settings.get('ui.parallax') || $('#app').classList.contains('in-game')) { $('#bg-layer').style.transform = ''; return; }
    const x = (e.clientX / innerWidth - 0.5) * -16, y = (e.clientY / innerHeight - 0.5) * -12;
    $('#bg-layer').style.transform = `translate(${x}px, ${y}px) scale(1.02)`;
  },
};

// ─────────────────────────────── Toolbar ───────────────────────────────
const Toolbar = {
  build() {
    const tb = $('#toolbar');
    clearEl(tb);
    const btn = (ic, tip, sub, fn, extra = {}) => {
      const b = h('button.tb-btn', { 'aria-label': tip, onclick: () => { UISounds.click(); fn(); }, ...extra }, icon(ic), h('span.tb-tip', h('b', tip), sub ? h('span', sub) : null));
      b.addEventListener('pointerenter', () => UISounds.hover());
      return b;
    };
    this.npBtn = h('button.tb-btn.tb-music', { 'aria-label': 'Now playing', onclick: () => NowPlaying.toggle(true) }, icon('music'), this.npText = h('span.tb-np-text'));
    this.npBtn.addEventListener('pointerenter', () => NowPlaying.hoverOpen());
    this.npBtn.addEventListener('pointerleave', () => NowPlaying.hoverClose());
    tb.append(
      h('div.tb-group',
        btn('gear', 'Settings', 'Change your settings (Ctrl+O)', () => SettingsPanel.toggle()),
        btn('home', 'Home', 'Return to the main menu', () => Screens.go('home'), { dataset: { tab: 'home' } })),
      h('div.tb-spacer'),
      h('div.tb-group',
        this.npBtn,
        this.clock = h('div.tb-clock'),
        this.profileBtn = h('button.tb-btn.tb-profile', { dataset: { tab: 'profile' }, 'aria-label': 'Account', onclick: e => this.userMenu(e) })),
    );
    this.updateProfile();
    this.tick();
    setInterval(() => this.tick(), 1000);
    Bus.on('music:changed', () => this.updateNp());
  },
  tick() {
    if ($('#app').classList.contains('in-game')) return; // the toolbar is hidden in game: don't relayout every second
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (this.clock.textContent !== t) this.clock.textContent = t;
  },
  setActive(id) { $$('#toolbar [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === id)); },
  updateProfile() {
    const p = ProfileManager.profile;
    clearEl(this.profileBtn).append(ProfileManager.avatarEl(26), h('span.lbl', p.name));
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

/** osu!lazer-style now playing panel: cover, title, seekable progress and previous / play-pause / next. */
const NowPlaying = {
  el: null, open: false, pinned: false, _t: 0,
  ensure() {
    if (this.el) return;
    this.cover = h('div.np-cover');
    this.title = h('div.np-title'); this.artist = h('div.np-artist');
    this.fill = h('i');
    this.bar = h('div.np-bar', this.fill);
    this.cur = h('span'); this.dur = h('span');
    const b = (ic, tip, fn) => h('button.np-ctl', { title: tip, 'aria-label': tip, onclick: e => { e.stopPropagation(); UISounds.click(); fn(); } }, icon(ic));
    this.playBtn = b('pause', 'Play / pause', () => MenuMusic.toggle());
    this.el = h('div.np-panel',
      this.cover,
      h('div.np-body', this.title, this.artist,
        h('div.np-ctls', b('prev', 'Previous track', () => MenuMusic.prev()), this.playBtn, b('skip', 'Next track', () => MenuMusic.next())),
        h('div.np-times', this.cur, this.dur)),
      this.bar);
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
    this.el.addEventListener('pointerenter', () => clearTimeout(this._t));
    this.el.addEventListener('pointerleave', () => this.hoverClose());
    $('#app').appendChild(this.el);
    Bus.on('music:changed', () => this.render());
    document.addEventListener('pointerdown', e => {
      if (this.open && !this.el.contains(e.target) && !Toolbar.npBtn.contains(e.target)) this.hide();
    }, true);
  },
  hoverOpen() { clearTimeout(this._t); this.show(); },
  hoverClose() { if (this.pinned) return; clearTimeout(this._t); this._t = setTimeout(() => this.hide(), 350); },
  toggle(pin) { if (this.open && this.pinned) { this.hide(); return; } this.pinned = !!pin; this.show(); },
  show() {
    this.ensure();
    if (this.open) return;
    this.open = true;
    this.el.classList.add('show');
    this.render();
    const loop = () => { if (!this.open) return; this.update(); this._raf = requestAnimationFrame(loop); };
    loop();
  },
  hide() { if (!this.el) return; this.open = false; this.pinned = false; this.el.classList.remove('show'); cancelAnimationFrame(this._raf); },
  async render() {
    if (!this.el) return;
    const m = MenuMusic.current;
    this.title.textContent = m ? m.title : 'Nothing playing';
    this.artist.textContent = m ? m.artist : 'Import some beatmaps to hear music here';
    const url = m ? await BeatmapManager.bgURL(m).catch(() => null) : null;
    this.cover.style.backgroundImage = url ? `url("${url}")` : '';
    this.update();
  },
  update() {
    const d = Music.duration, t = clamp(Music.time, 0, d || 0);
    this.fill.style.width = d ? (t / d * 100).toFixed(2) + '%' : '0%';
    this.cur.textContent = fmtTime(t); this.dur.textContent = fmtTime(d);
    const ic = Music.playing ? 'pause' : 'play';
    if (this.playBtn.dataset.ic !== ic) { this.playBtn.dataset.ic = ic; clearEl(this.playBtn).append(icon(ic)); }
  },
};

/** osu!lazer-style back button (pink, slanted, bottom-left). */
function backButton(onClick) {
  const b = h('button.lz-back', { onclick: () => { UISounds.back(); onClick(); }, title: 'Back (Esc)', 'aria-label': 'Back' }, h('span.lz-back-inner', icon('back'), 'back'));
  b.addEventListener('pointerenter', () => UISounds.hover());
  return b;
}

/** osu!-style volume control: Alt + mouse wheel adjusts master volume (Shift = music, Ctrl = effects). */
const VolumeOverlay = {
  el: null, hideT: 0,
  adjust(which, delta) {
    const key = which === 'music' ? 'audio.music' : which === 'effects' ? 'audio.effects' : 'audio.master';
    const v = clamp(Math.round((Settings.get(key) + delta) * 100) / 100, 0, 1);
    Settings.set(key, v);
    this.show();
  },
  show() {
    if (!this.el) { this.el = h('div.volume-overlay'); $('#app').appendChild(this.el); }
    clearEl(this.el).append(...[['Master', 'audio.master'], ['Music', 'audio.music'], ['Effects', 'audio.effects']].map(([l, k]) => {
      const v = Settings.get(k);
      return h('div.vo-row', h('div.vo-ring', { style: { '--p': (v * 100) + '%' } }, h('span', Math.round(v * 100))), h('div.vo-l', l));
    }));
    this.el.classList.add('show');
    clearTimeout(this.hideT);
    this.hideT = setTimeout(() => this.el.classList.remove('show'), 1400);
  },
  bind() {
    window.addEventListener('wheel', e => {
      if (!e.altKey) return;
      e.preventDefault();
      this.adjust(e.shiftKey ? 'music' : e.ctrlKey ? 'effects' : 'master', e.deltaY < 0 ? 0.05 : -0.05);
    }, { passive: false });
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
  detect() {
    const ow = window.outerWidth, iw = window.innerWidth;
    if (!ow || !iw) return 1;
    const raw = ow / iw;
    const lvl = this.LEVELS.reduce((a, b) => Math.abs(b - raw) < Math.abs(a - raw) ? b : a);
    if (lvl === 1 || Math.abs(lvl - raw) / lvl > 0.03) return 1; // side panels / devtools make the ratio meaningless
    const base = (window.devicePixelRatio || 1) / lvl;
    return this.BASE_DPR.some(b => Math.abs(b - base) < 0.06) ? lvl : 1;
  },
  update() {
    const z = this.detect();
    if (z === this.z) return;
    this.z = z;
    const r = document.documentElement.style;
    r.setProperty('--zoom', z); r.setProperty('--zoom-inv', 1 / z);
    $('#app').classList.toggle('zoomfix', z !== 1);
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
