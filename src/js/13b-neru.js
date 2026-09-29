/* Neru on the main menu: a picture of Neru standing in the bottom-left corner. It shows the image chosen in
 * Settings → Interface, otherwise neru.png / neru.webp / neru.gif / neru.jpg placed next to index.html (the
 * public/ folder). With no picture nothing is shown. Clicking her makes her hop. */

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
  build() {
    const el = this.el = h('button.neru', { hidden: true, 'aria-label': 'Neru', onclick: e => { e.stopPropagation(); this.hop(); } });
    if (!Settings.get('ui.mascot')) return el;
    this.source().then(u => {
      if (!u || this.el !== el) return;
      el.append(h('img.neru-img', { src: u, alt: '', draggable: 'false' }));
      el.hidden = false;
    });
    return el;
  },
  hop() {
    if (!this.el) return;
    this.el.classList.remove('hop'); void this.el.offsetWidth; this.el.classList.add('hop');
    UISounds.click();
  },
  /** Use a picture the player chose (a File/Blob), or null to go back to the bundled one. */
  async setImage(file) {
    await DB.kvSet('mascot.image', file ? new Blob([await file.arrayBuffer()], { type: file.type || 'image/png' }) : null);
    this._probe = null;
    const old = document.querySelector('.home .neru');
    if (old) old.replaceWith(this.build());
  },
  stop() { this.el = null; },
};

Bus.on('settings:changed', k => {
  if (k === 'ui.mascot' && Screens.currentName === 'home') { const old = document.querySelector('.home .neru'); if (old) old.replaceWith(NeruMascot.build()); }
});
