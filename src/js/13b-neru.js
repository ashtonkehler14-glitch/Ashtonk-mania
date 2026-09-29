/* Neru on the main menu: a picture of Neru standing in the bottom-left corner. It shows the image chosen in
 * Settings → Interface, otherwise neru.png / neru.webp / neru.gif / neru.jpg placed next to index.html (the
 * public/ folder). With no picture nothing is shown. Clicking her makes her hop.
 * Easter egg: click her 10 times in a row and she turns into Teto (10 more to swap back). */

const NeruMascot = {
  FILES: ['neru.png', 'neru.webp', 'neru.gif', 'neru.jpg'],
  EGG_CLICKS: 10,
  teto: false, clicks: 0, _lastClick: 0,
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
  build() {
    const el = this.el = h('button.neru', { hidden: true, 'aria-label': 'Neru', onclick: e => { e.stopPropagation(); this.hop(); } });
    if (!Settings.get('ui.mascot')) return el;
    this.source().then(async u => {
      if (!u || this.el !== el) return;
      this.img = h('img.neru-img', { src: u, alt: '', draggable: 'false' });
      el.append(this.img);
      el.hidden = false;
      // the bundled Neru has a second, happy picture she switches to when clicked
      this.base = u; this.happy = null; this.tetoURL = null;
      if (!u.startsWith('blob:')) {
        const loads = src => new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = src; });
        const [happy, teto] = await Promise.all([loads('neru-happy.png'), loads('teto.png')]);
        if (this.el !== el) return;
        if (happy) this.happy = 'neru-happy.png';
        if (teto) this.tetoURL = 'teto.png';
        if (this.teto && this.tetoURL) this.img.src = this.tetoURL;
      }
    });
    return el;
  },
  hop() {
    if (!this.el) return;
    // easter egg: enough clicks in a row (no more than a second apart) swaps Neru and Teto
    const now = performance.now();
    this.clicks = now - this._lastClick < 1000 ? this.clicks + 1 : 1;
    this._lastClick = now;
    if (this.tetoURL && this.img && this.clicks >= this.EGG_CLICKS) {
      this.clicks = 0;
      this.teto = !this.teto;
      clearTimeout(this._back);
      this.el.classList.remove('hop', 'swap'); void this.el.offsetWidth; this.el.classList.add('swap');
      setTimeout(() => { if (this.img) this.img.src = this.teto ? this.tetoURL : this.base; }, 250);
      this.el.setAttribute('aria-label', this.teto ? 'Teto' : 'Neru');
      UISounds.play('check-on');
      return;
    }
    this.el.classList.remove('hop', 'swap'); void this.el.offsetWidth; this.el.classList.add('hop');
    UISounds.click();
    if (this.teto) return;
    if (this.happy && this.img) {
      this.img.src = this.happy;
      clearTimeout(this._back);
      this._back = setTimeout(() => { if (this.img && !this.teto) this.img.src = this.base; }, 1600);
    }
  },
  /** Use a picture the player chose (a File/Blob), or null to go back to the bundled one. */
  async setImage(file) {
    await DB.kvSet('mascot.image', file ? new Blob([await file.arrayBuffer()], { type: file.type || 'image/png' }) : null);
    this._probe = null;
    const old = document.querySelector('.home .neru');
    if (old) old.replaceWith(this.build());
  },
  stop() { clearTimeout(this._back); this.el = null; this.img = null; },
};

Bus.on('settings:changed', k => {
  if (k === 'ui.mascot' && Screens.currentName === 'home') { const old = document.querySelector('.home .neru'); if (old) old.replaceWith(NeruMascot.build()); }
});
