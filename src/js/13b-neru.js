/* Neru on the main menu: a picture of Neru standing in the bottom-left corner. It shows the image chosen in
 * Settings → Interface, otherwise neru.png / neru.webp / neru.gif / neru.jpg placed next to index.html (the
 * public/ folder). With no picture nothing is shown.
 * She's alive: she breathes, bobs to the music's beat (harder in kiai), leans towards the cursor, perks up when
 * hovered, and clicking her makes her hop — happy face, a few sparkles and a line in a speech bubble. */

const NeruMascot = {
  FILES: ['neru.png', 'neru.webp', 'neru.gif', 'neru.jpg'],
  _probe: null, _blobURL: null,
  /** URL of the picture to show, or null. */
  async source() {
    const blob = await DB.kvGet('mascot.image', null).catch(() => null);
    if (blob instanceof Blob) {
      if (this._blobURL) URL.revokeObjectURL(this._blobURL);
      return (this._blobURL = URL.createObjectURL(blob));
    }
    const loads = src => new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = src; });
    if (!this._probe) this._probe = (async () => { for (const f of this.FILES) if (await loads(f)) return f; return null; })();
    return this._probe;
  },
  LINES: ['Let\'s play!', 'Pick a song~', 'One more?', 'Full combo time!', 'Eyes on the notes!', 'Hehe~', 'You got this!', 'Again!'],
  build() {
    const el = this.el = h('button.neru', { hidden: true, 'aria-label': 'Neru', onclick: e => { e.stopPropagation(); this.hop(); } });
    if (!Settings.get('ui.mascot')) return el;
    this.source().then(async u => {
      if (!u || this.el !== el) return;
      this.img = h('img.neru-img', { src: u, alt: '', draggable: 'false' });
      // body: leans and bobs (driven per frame); img: breathing and the hop (CSS); a soft shadow on the floor
      this.body = h('span.neru-body', this.img);
      this.shadow = h('span.neru-shadow');
      this.bubble = h('span.neru-say');
      el.append(this.shadow, this.body, this.bubble);
      el.hidden = false;
      el.addEventListener('pointerenter', () => el.classList.add('perk'));
      el.addEventListener('pointerleave', () => el.classList.remove('perk'));
      this.start();
      // the bundled Neru has a second, happy picture she switches to when clicked
      this.base = u; this.happy = null;
      if (!u.startsWith('blob:')) {
        const ok = await new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = 'neru-happy.png'; });
        if (ok && this.el === el) this.happy = 'neru-happy.png';
      }
    });
    return el;
  },
  /** Per frame: the lean towards the pointer (eased) and the beat's bob decaying, written as one transform. */
  start() {
    cancelAnimationFrame(this._raf);
    this._lean = 0; this._bob = 0; this._px = null;
    // (her box is measured when the pointer moves, not every frame: reading layout each frame can force a reflow)
    if (!this._onMove) this._onMove = e => { this._px = e.clientX; this._py = e.clientY; if (this.el && this.el.isConnected) this._rect = this.el.getBoundingClientRect(); };
    window.addEventListener('pointermove', this._onMove, { passive: true });
    let last = performance.now();
    const tick = now => {
      if (!this.el || !this.body || !this.el.isConnected) { if (this.el && !this.el.isConnected) this.stop(); else this._raf = requestAnimationFrame(tick); return; }
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
    this.el.classList.remove('hop'); void this.el.offsetWidth; this.el.classList.add('hop');
    UISounds.click();
    if (this.happy && this.img) {
      this.img.src = this.happy;
      clearTimeout(this._back);
      this._back = setTimeout(() => { if (this.img) this.img.src = this.base; }, 1600);
    }
    this.say();
    this.sparkle();
  },
  /** A short line in a bubble beside her head, gone after a moment (never the same line twice running). */
  say(text) {
    if (!this.bubble) return;
    let t = text;
    if (!t) { do t = this.LINES[Math.floor(Math.random() * this.LINES.length)]; while (t === this._lastLine && this.LINES.length > 1); }
    this._lastLine = t;
    this.bubble.textContent = t;
    this.bubble.classList.remove('show'); void this.bubble.offsetWidth; this.bubble.classList.add('show');
    clearTimeout(this._sayT);
    this._sayT = setTimeout(() => this.bubble && this.bubble.classList.remove('show'), 1900);
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
    this._probe = null;
    const old = document.querySelector('.home .neru');
    if (old) old.replaceWith(this.build());
  },
  stop() {
    clearTimeout(this._back); clearTimeout(this._sayT); cancelAnimationFrame(this._raf);
    if (this._onMove) window.removeEventListener('pointermove', this._onMove);
    this.el = null; this.img = null; this.body = null; this.shadow = null; this.bubble = null;
  },
};

Bus.on('settings:changed', k => {
  if (k === 'ui.mascot' && Screens.currentName === 'home') { const old = document.querySelector('.home .neru'); if (old) old.replaceWith(NeruMascot.build()); }
});
