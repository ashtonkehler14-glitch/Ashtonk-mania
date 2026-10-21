/* Neru on the main menu: a picture of Neru standing in the bottom-left corner. It shows the image chosen in
 * Settings → Interface, otherwise neru.png / neru.webp / neru.gif / neru.jpg placed next to index.html (the
 * public/ folder). With no picture nothing is shown.
 * She's alive: she breathes, bobs to the music's beat (harder in kiai), leans towards the cursor, perks up when
 * hovered, and clicking her makes her hop — her excited face for a moment, and a few sparkles.
 * And a few things to find (NeruEggs): bored when left alone, in a huff when clicked over and over, a party for the
 * Konami code, and a peek in when you search for her. */

const NeruMascot = {
  FILES: ['neru.png', 'neru.webp', 'neru.gif', 'neru.jpg'],
  /** Her other faces and poses, public/neru-<name>.png (tools/neru-art.py makes them, from frames of her song's music
   *  video): the build lists the ones there are, so none is looked for that isn't there. */
  POSES: [/*__NERU_POSES__*/],
  _pics: null, _blobURL: null,
  /** Her pictures — { base, happy, poses: { name: url } } (happy: the face she makes when clicked or pleased; null if
   *  there isn't one) — or null with none. The picture chosen in Settings → Interface is all of them; otherwise the
   *  bundled ones. Looked up once, and shared by every place she shows. */
  pictures() {
    if (!this._pics) this._pics = (async () => {
      this._picsNow = null;
      const blob = await DB.kvGet('mascot.image', null).catch(() => null);
      if (blob instanceof Blob) {
        if (this._blobURL) URL.revokeObjectURL(this._blobURL);
        const u = this._blobURL = URL.createObjectURL(blob);
        return { base: u, happy: null, poses: {} };
      }
      const loads = src => new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = src; });
      for (const f of this.FILES) {
        if (!(await loads(Host.asset(f)))) continue;
        const poses = Object.fromEntries(this.POSES.map(n => [n, Host.asset(`neru-${n}.png`)]));
        return (this._picsNow = { base: Host.asset(f), happy: poses.happy || null, poses });
      }
      return null;
    })();
    return this._pics;
  },
  build() {
    const el = this.el = h('button.neru', { hidden: true, 'aria-label': 'Neru', tabindex: '-1', onclick: e => { e.stopPropagation(); this.hop(); } });
    if (!Settings.get('ui.mascot')) return el;
    this.pictures().then(pics => {
      if (!pics || this.el !== el) return;
      this.img = h('img.neru-img', { src: pics.base, alt: '', draggable: 'false' });
      // body: leans and bobs (driven per frame); img: breathing and the hop (CSS); a soft shadow on the floor
      this.body = h('span.neru-body', this.img);
      this.shadow = h('span.neru-shadow');
      el.append(this.shadow, this.body);
      el.hidden = false;
      el.addEventListener('pointerenter', () => el.classList.add('perk'));
      el.addEventListener('pointerleave', () => el.classList.remove('perk'));
      this.start();
      // (the bundled Neru has a second, excited picture she switches to when clicked — loaded now, so it's there at once)
      this.base = pics.base; this.happy = pics.happy;
      if (pics.happy) new Image().src = pics.happy;
    });
    return el;
  },
  /** Her pose when nothing's going on: bored once she's been left alone a while, her usual picture otherwise. */
  rest() { return this._idle && this.has('bored') ? 'bored' : null; },
  /** Whether a pose of hers is there (the bundled pictures — not a picture of the player's own). */
  has(name) { return !!(this._picsNow && this._picsNow.poses && this._picsNow.poses[name]); },
  /** Show a pose (null: her usual picture), at the size that keeps her head the same as in the others; `pop`: a quick
   *  fade-in, so the change isn't a jump. */
  async show(name, { pop = true } = {}) {
    const pics = await this.pictures(), img = this.img;
    if (!pics || !img) return;
    const f = name ? NeruCameo.pose(pics, name) : { src: pics.base, scale: 1 };
    if (img.dataset.pose === (name || '')) return;
    img.dataset.pose = name || '';
    const pre = new Image(); pre.src = f.src;
    try { await pre.decode(); } catch { /* shown anyway */ }
    if (this.img !== img || img.dataset.pose !== (name || '')) return;
    img.src = f.src; img.style.height = f.scale < 1 ? `${(f.scale * 100).toFixed(1)}%` : '';
    // (where her head is now, for what floats over it — the cross mark, the steam)
    if (this.el) this.el.style.setProperty('--nm-top', `${((1 - f.scale) * 100).toFixed(1)}%`);
    if (pop && Settings.get('ui.animSpeed')) img.animate([{ opacity: 0.3, filter: 'brightness(1.4) drop-shadow(0 10px 24px rgba(0, 0, 0, .5))' }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
  },
  /** Per frame: the lean towards the pointer (eased) and the beat's bob decaying, written as one transform. */
  start() {
    cancelAnimationFrame(this._raf);
    this._lean = 0; this._bob = 0; this._px = null;
    // (her box is measured when the pointer moves, not every frame: reading layout each frame can force a reflow)
    if (!this._onMove) this._onMove = e => { this._px = e.clientX; this._py = e.clientY; if (this.el && this.el.isConnected) this._rect = this.el.getBoundingClientRect(); };
    window.addEventListener('pointermove', this._onMove, { passive: true });
    NeruEggs.watchIdle();
    let last = performance.now();
    const tick = now => {
      if (!this.el || !this.body || !this.el.isConnected) { if (this.el && !this.el.isConnected) this.stop(); else this._raf = requestAnimationFrame(tick); return; }
      if (typeof Spectate !== 'undefined' && Spectate.rkEl) { last = now; this._raf = requestAnimationFrame(tick); return; } // (hidden under a spectated screen)
      const dt = Math.min(64, now - last); last = now;
      let want = 0;
      if (this._px != null && this._rect && Settings.get('ui.animSpeed')) {
        const r = this._rect, cx = r.left + r.width / 2, cy = r.top + r.height * 0.3;
        // a few degrees towards the cursor, more the further away it is (and none once it's over her)
        want = clamp((this._px - cx) / innerWidth * 9, -4, 4) * (this._py < cy - r.height ? 0.6 : 1);
      }
      this._lean += (want - this._lean) * (1 - Math.exp(-dt / 260));
      this._bob *= Math.exp(-dt / 140);
      const b = this._bob;
      // (written only when it changes: a style write every frame restyles her even when she's still)
      const tf = `rotate(${this._lean.toFixed(2)}deg) translateY(${(b * 6).toFixed(2)}px) scale(${(1 + b * 0.012).toFixed(4)}, ${(1 - b * 0.022).toFixed(4)})`;
      if (tf !== this._tf) { this._tf = tf; this.body.style.transform = tf; if (this.shadow) this.shadow.style.transform = `scaleX(${(1 + b * 0.05).toFixed(3)})`; }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  },
  /** A beat of the menu music (from the main menu's beat tracking): a little squash, harder in kiai. */
  beat(adj = 1, kiai = false) {
    if (!this.body || !Settings.get('ui.animSpeed')) return;
    this._bob = Math.max(this._bob, clamp(adj, 0, 1) * (kiai ? 1 : 0.55));
  },
  hop() {
    if (!this.el) return;
    const now = performance.now();
    // (in a huff: a click only gets a shake of her head)
    if (now < (this._huffUntil || 0)) { this.el.classList.remove('shake'); void this.el.offsetWidth; this.el.classList.add('shake'); UISounds.play('click-short'); return; }
    this._clicks = (this._clicks || []).filter(t => now - t < 2600);
    this._clicks.push(now);
    if (this._clicks.length >= 8 && this.has('sassy')) { NeruEggs.huff(); return; }
    this.el.classList.remove('hop'); void this.el.offsetWidth; this.el.classList.add('hop');
    UISounds.click();
    if (this.happy && this.img) {
      this.show('happy', { pop: false });
      clearTimeout(this._back);
      this._back = setTimeout(() => this.show(this.rest()), 1600);
    }
    this.sparkle();
  },
  /** A handful of sparkles that burst out around her and fade. */
  sparkle() {
    if (!this.el || !Settings.get('ui.animSpeed')) return;
    const colors = ['#ffd54a', '#ff8cc0', '#ffffff', '#8fd3ff'];
    for (let i = 0; i < 7; i++) {
      const sp = h('span.neru-spark');
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, d = 60 + Math.random() * 70;
      sp.style.left = `${45 + (Math.random() - 0.5) * 30}%`; sp.style.top = `${22 + Math.random() * 20}%`;
      sp.style.background = colors[i % colors.length];
      this.el.append(sp);
      sp.animate([{ transform: 'translate(-50%, -50%) scale(0) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d * 0.7}px), calc(-50% + ${Math.sin(a) * d * 0.7}px)) scale(1) rotate(90deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d + 18}px)) scale(.4) rotate(180deg)`, opacity: 0 }],
        { duration: 700 + Math.random() * 300, easing: 'cubic-bezier(.22, 1, .36, 1)' }).onfinish = () => sp.remove();
    }
  },
  /** Use a picture the player chose (a File/Blob), or null to go back to the bundled one. */
  async setImage(file) {
    await DB.kvSet('mascot.image', file ? new Blob([await file.arrayBuffer()], { type: file.type || 'image/png' }) : null);
    this._pics = null;
    const old = document.querySelector('.home .neru');
    if (old) old.replaceWith(this.build());
  },
  stop() {
    clearTimeout(this._back); cancelAnimationFrame(this._raf);
    if (this._onMove) window.removeEventListener('pointermove', this._onMove);
    NeruEggs.unwatchIdle();
    this.el = null; this.img = null; this.body = null; this.shadow = null; this._idle = this._party = false; this._huffUntil = 0; // (a party or huff cut short by leaving ends with it)
  },
};

/** Neru around the game, not only on the main menu (with the same setting): she pops up at the edge of a screen in a
 *  pose that fits — grudgingly impressed by a good play, unimpressed by a poor one or a fail (a tsundere: never quite
 *  nice about it, never cruel either), on her phone while a song or the game loads — and clicking her makes her hop.
 *  Screens place her with a class of their own (`.nc-results`, `.nc-pause`…). */
const NeruCameo = {
  /** The moods she's pleased about (not that she'd say so): sparkles. */
  HAPPY: new Set(['perfect', 'great', 'peek']),
  /** Her pose on each screen (her shrug, neru.png, if it isn't there) — all from the song's video: sunglasses on for a
   *  perfect play, a wagging finger at an S, a wink for an A or B, worn out at a C or D, laughing at a fail; bored at her
   *  desk while you pause, fists up — "I'm not cheering for you" — while a song loads, hand on hip at an empty library,
   *  a blank "huh?" at an empty list, fishing while the game starts. */
  POSE: {
    perfect: 'cool', great: 'point', okay: 'wink', bad: 'tired', failed: 'mock',
    paused: 'bored', loading: 'cheer', empty: 'sassy', list: 'huh', boot: 'fishing', peek: 'wink',
  },
  /** How much of each pose's picture her head takes up (top of her hair to her chin, against its height): a close-up
   *  is shown smaller, so that her head comes out no bigger than in her default picture (HEAD_SIZE) — the same Neru
   *  whichever pose it is, not one twice the size of the other. */
  HEAD: {
    bored: 0.43, cheer: 0.37, cool: 0.22, fishing: 0.38, happy: 0.45, huh: 0.45, mock: 0.38, point: 0.45, sassy: 0.49,
    tired: 0.68, wink: 0.28,
  },
  HEAD_SIZE: 0.36,
  /** Her pose for `mood`'s screen (her default picture without it). */
  face(pics, mood) { return this.pose(pics, this.POSE[mood] || null); },
  /** A pose of hers by name (null: her default picture): its picture, and how big she's shown in it (see HEAD). */
  pose(pics, name) {
    if (!name || !pics.poses || !pics.poses[name]) return { src: pics.base, scale: 1 };
    return { src: pics.poses[name], scale: Math.min(1, this.HEAD_SIZE / (this.HEAD[name] || this.HEAD_SIZE)) };
  },
  /** A play's mood: from its grade (a new best too), or a fail. */
  moodOf(s) {
    if (!s || !s.passed) return 'failed';
    if (['XH', 'X', 'SS'].includes(s.grade)) return 'perfect';
    if (['SH', 'S'].includes(s.grade)) return 'great';
    return ['A', 'B'].includes(s.grade) ? 'okay' : 'bad';
  },
  /** Neru in `mood`, for a screen to put where `cls` places her; she comes in once her picture is ready (and in a mood
   *  she's pleased about, sparkles `delay` ms later). Null when she's turned off. */
  make(mood, cls, { delay = 450 } = {}) {
    if (!Settings.get('ui.mascot')) return null;
    const el = h(`button.neru-cameo.${cls}`, { type: 'button', 'aria-label': 'Neru', tabindex: '-1', hidden: true });
    NeruMascot.pictures().then(async pics => {
      if (!pics) { el.remove(); return; }
      const face = this.face(pics, mood), happy = pics.happy && this.pose(pics, 'happy');
      const img = h('img.nc-img', { src: face.src, alt: '', draggable: 'false' });
      // (her place's height, times how big she's shown in this pose)
      const show = f => { img.src = f.src; el.style.setProperty('--nc-s', f.scale); };
      el.style.setProperty('--nc-s', face.scale);
      // (shown once it can be drawn, never as an empty box that pops)
      try { await img.decode(); } catch { /* shown anyway */ }
      if (!el.isConnected && !el.parentNode) return;
      el.append(h('span.nc-body', img));
      el.hidden = false;
      const anim = !!Settings.get('ui.animSpeed');
      if (anim) el.classList.add('in');
      setTimeout(() => { if (el.isConnected) this.burst(el, mood); }, anim ? delay : 0);
      el.addEventListener('click', e => {
        e.stopPropagation();
        UISounds.click();
        el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop');
        // (her happy face for a moment, whatever her mood)
        if (happy && face.src !== happy.src) { show(happy); clearTimeout(el._back); el._back = setTimeout(() => show(face), 1600); }
        this.burst(el, mood);
      });
    });
    return el;
  },
  /** A few sparkles that burst out around her head and fade — when she's pleased (not that she'd say so). */
  burst(el, mood) {
    if (!this.HAPPY.has(mood) || !Settings.get('ui.animSpeed') || document.documentElement.classList.contains('slow')) return;
    const colors = ['#ffd54a', '#ff8cc0', '#ffffff', '#8fd3ff'];
    for (let i = 0; i < 6; i++) {
      const sp = h('span.neru-spark');
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2, d = 50 + Math.random() * 60;
      sp.style.left = `${45 + (Math.random() - 0.5) * 30}%`; sp.style.top = `${18 + Math.random() * 16}%`;
      sp.style.background = colors[i % colors.length];
      el.append(sp);
      sp.animate([{ transform: 'translate(-50%, -50%) scale(0)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d * 0.7}px), calc(-50% + ${Math.sin(a) * d * 0.7}px)) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - 14}px)) scale(.5)`, opacity: 0 }],
        { duration: 800 + Math.random() * 300, easing: 'cubic-bezier(.22, 1, .36, 1)' }).onfinish = () => sp.remove();
    }
  },
  /** On the loading screen, if loading takes a moment (not on a quick start, where she'd only flash by). */
  boot() {
    const ls = $('#loading-screen');
    setTimeout(() => {
      if (!ls || ls.classList.contains('done')) return;
      const el = this.make('boot', 'nc-boot');
      if (el) ls.append(el);
    }, 700);
  },
};

Bus.on('settings:changed', k => {
  if (k === 'ui.mascot' && Screens.currentName === 'home') { const old = document.querySelector('.home .neru'); if (old) old.replaceWith(NeruMascot.build()); }
});

/** Neru's easter eggs: each one is only pictures and motion — she never
 *  says anything. */
const NeruEggs = {
  IDLE_MS: 45000,
  // ── left alone on the main menu: after a while she gets bored (at her desk); back to herself, with a start, when
  // you move or press anything
  watchIdle() {
    this.unwatchIdle();
    this._seen = performance.now();
    this._wake = () => {
      this._seen = performance.now();
      const M = NeruMascot;
      if (!M._idle) return;
      M._idle = false;
      if (M.el) { M.el.classList.remove('startle'); void M.el.offsetWidth; M.el.classList.add('startle'); }
      M.show(M.rest());
    };
    for (const ev of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, this._wake, { passive: true });
    window.addEventListener('pointermove', this._wakeMove = e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this._wake(); }, { passive: true });
    this._idleT = setInterval(() => {
      const M = NeruMascot;
      if (!M.img || M._idle || document.hidden || performance.now() - this._seen < this.IDLE_MS || performance.now() < (M._huffUntil || 0) || M._party) return;
      if (!M.has('bored')) return; // (no such picture)
      M._idle = true; M.show('bored');
    }, 3000);
  },
  unwatchIdle() {
    clearInterval(this._idleT);
    if (this._wake) for (const ev of ['pointerdown', 'keydown', 'wheel']) window.removeEventListener(ev, this._wake);
    if (this._wakeMove) window.removeEventListener('pointermove', this._wakeMove);
    this._wake = this._wakeMove = null;
  },

  // ── clicked over and over: hand on hip, a shake, a cross mark and a puff of steam — and for a few seconds she won't hop
  huff() {
    const M = NeruMascot, el = M.el;
    if (!el) return;
    M._clicks = []; M._huffUntil = performance.now() + 3400;
    clearTimeout(M._back);
    M.show('sassy', { pop: false });
    el.classList.remove('hop', 'huff'); void el.offsetWidth; el.classList.add('huff');
    UISounds.play('dialog-dangerous-tick');
    if (Settings.get('ui.animSpeed')) {
      // (the cross-shaped anger mark of anime: four curved strokes)
      const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), g = document.createElementNS(NS, 'g');
      svg.setAttribute('viewBox', '0 0 40 40');
      for (const [k, v] of [['fill', 'none'], ['stroke', '#ff3b5c'], ['stroke-width', '5'], ['stroke-linecap', 'round']]) g.setAttribute(k, v);
      for (const d of ['M16 4c0 7-5 12-12 12', 'M24 4c0 7 5 12 12 12', 'M16 36c0-7-5-12-12-12', 'M24 36c0-7 5-12 12-12']) { const pa = document.createElementNS(NS, 'path'); pa.setAttribute('d', d); g.append(pa); }
      svg.append(g);
      const vein = h('span.neru-vein', svg);
      el.append(vein);
      vein.animate([{ transform: 'scale(0) rotate(-30deg)', opacity: 0 }, { transform: 'scale(1.25) rotate(8deg)', opacity: 1, offset: 0.18 }, { transform: 'scale(.9)', offset: 0.3 },
        { transform: 'scale(1.1)', offset: 0.45 }, { transform: 'scale(.95)', offset: 0.6 }, { transform: 'scale(1.05)', opacity: 1, offset: 0.85 }, { transform: 'scale(1.2)', opacity: 0 }],
        { duration: 2400, easing: 'ease-out' }).onfinish = () => vein.remove();
      for (let i = 0; i < 3; i++) setTimeout(() => {
        if (!el.isConnected) return;
        const p = h('span.neru-puff'); p.style.left = `${30 + i * 14}%`;
        el.append(p);
        p.animate([{ transform: 'translate(-50%, 0) scale(.3)', opacity: 0 }, { transform: 'translate(-50%, -18px) scale(1)', opacity: 0.85, offset: 0.25 },
          { transform: `translate(calc(-50% + ${(i - 1) * 22}px), -60px) scale(1.6)`, opacity: 0 }], { duration: 1100, easing: 'cubic-bezier(.22, 1, .36, 1)' }).onfinish = () => p.remove();
      }, 120 + i * 160);
    }
    M._back = setTimeout(() => { el.classList.remove('huff'); M.show(M.rest()); }, 3400);
  },

  // ── the Konami code on the main menu (↑ ↑ ↓ ↓ ← → ← → B A): a party — she cheers, and confetti falls over the screen
  KONAMI: ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'],
  onKey(e) {
    if (e.repeat || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
    const want = this.KONAMI[this._k || 0];
    this._k = e.code === want ? (this._k || 0) + 1 : e.code === this.KONAMI[0] ? 1 : 0;
    const home = Screens.currentName === 'home' && !!NeruMascot.img;
    // (once the arrows are in, B and A are the code's, not the main menu's — B would have opened Browse)
    if (home && this._k > 8) { e.preventDefault(); e.stopImmediatePropagation(); }
    if (this._k < this.KONAMI.length) return;
    this._k = 0;
    if (home) this.party();
  },
  party() {
    const M = NeruMascot;
    if (M._party) return;
    M._party = true; M._idle = false;
    clearTimeout(M._back);
    M.show('cheer');
    if (M.el) { M.el.classList.remove('hop'); void M.el.offsetWidth; M.el.classList.add('hop'); }
    UISounds.play('medal-get');
    M.sparkle(); setTimeout(() => M.sparkle(), 450);
    if (Settings.get('ui.animSpeed')) this.confetti();
    M._back = setTimeout(() => { M._party = false; M.show(M.rest()); }, 4200);
  },
  confetti() {
    const slow = document.documentElement.classList.contains('slow'), n = slow ? 36 : 90;
    const box = h('div.neru-confetti', { 'aria-hidden': 'true' }), colors = ['#ffcf3a', '#ff8cc0', '#ffffff', '#8fd3ff', '#aa88ff'];
    document.body.append(box);
    const H = innerHeight;
    for (let i = 0; i < n; i++) {
      const p = h(`i.${i % 5 === 0 ? 'star' : i % 3 === 0 ? 'dot' : 'bit'}`);
      p.style.background = colors[i % colors.length];
      p.style.left = `${Math.random() * 100}%`;
      box.append(p);
      const drift = (Math.random() - 0.5) * 240, spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540), d = 2200 + Math.random() * 1600;
      p.animate([{ transform: `translate(0, -40px) rotate(0deg)`, opacity: 1 }, { transform: `translate(${drift * 0.6}px, ${H * 0.55}px) rotate(${spin * 0.6}deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${drift}px, ${H + 40}px) rotate(${spin}deg)`, opacity: 0.2 }], { duration: d, delay: Math.random() * 700, easing: 'cubic-bezier(.25, .4, .55, 1)', fill: 'backwards' });
    }
    setTimeout(() => box.remove(), 4800);
  },

  // ── her name in song select's search: she peeks in from the side of the screen (gone again when the search changes)
  search(q, host) {
    const hit = /^\s*(akita\s+)?neru\s*$/i.test(q || '');
    if (!hit) { this.unpeek(); return; }
    if (this._peek && this._peek.isConnected) return;
    // (never two of her: not while she's on screen somewhere else — the loading screen's, gone, doesn't count)
    if (!host || [...document.querySelectorAll('.neru-cameo:not(.nc-peek), .home .neru')].some(e => !e.hidden && e.getClientRects().length && e.getBoundingClientRect().width)) return;
    const el = this._peek = NeruCameo.make('peek', 'nc-peek', { delay: 700 });
    if (!el) return;
    host.append(el);
    UISounds.play('select-expand');
  },
  unpeek() {
    const el = this._peek;
    this._peek = null;
    if (!el || !el.isConnected) return;
    if (!Settings.get('ui.animSpeed')) { el.remove(); return; }
    el.classList.add('out');
    setTimeout(() => el.remove(), 420);
  },
};
window.addEventListener('keydown', e => NeruEggs.onKey(e), true);
