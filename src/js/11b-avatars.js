/* Free profile pictures: the bundled Teto, Neru and Miku pictures in public/avatars, plus any images listed in
 * public/avatars/avatars.json — [{ "file": "rin.png", "name": "Rin" }, …] — so more can be added by dropping them
 * into that folder. Profile avatar values: 'default' (initial), 'custom' (uploaded), 'preset:<id>' or 'file:<file>'. */

const AVATAR_PRESETS = [
  { id: 'teto', name: 'Teto', file: 'teto.jpg' },
  { id: 'neru', name: 'Neru', file: 'neru.jpg' },
  { id: 'miku', name: 'Miku', file: 'miku.jpg' },
];

const AvatarPresets = {
  /** The picture for a preset id. Older profiles saved drawn presets such as 'teto-1' / 'miku-2': those map to that
   *  character's picture. */
  url(id) {
    const p = AVATAR_PRESETS.find(x => x.id === id) || AVATAR_PRESETS.find(x => x.id === String(id).split('-')[0]);
    return p ? 'avatars/' + p.file : null;
  },
  /** Extra pictures from public/avatars/avatars.json (cached for the session). */
  extra() {
    if (!this._extra) this._extra = fetch('avatars/avatars.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : []).then(a => Array.isArray(a)
      ? a.filter(x => x && typeof x.file === 'string' && /^[\w .()-]+\.(png|jpe?g|webp|gif|svg)$/i.test(x.file)).map(x => ({ file: x.file, name: String(x.name || x.file), url: 'avatars/' + encodeURIComponent(x.file) }))
      : []).catch(() => []);
    return this._extra;
  },
};

/** Profile picture picker: the free avatars, pictures in public/avatars, your own upload, or your initial. */
const AvatarPicker = {
  async open() {
    let o;
    const pick = async (kind, blob) => { await ProfileManager.setAvatar(kind, blob); Toolbar.updateProfile(); UISounds.click(); o && o.close(); Bus.emit('avatar:changed'); };
    const cur = ProfileManager.profile.avatar;
    const tile = (kind, url, name) => {
      const t = h(`button.av-tile${cur === kind ? '.on' : ''}`, { title: name, 'aria-label': name, onclick: () => pick(kind) }, h('img', { src: url, alt: '', onerror: () => t.remove() }), h('span', name));
      return t;
    };
    const grid = h('div.av-grid', ...AVATAR_PRESETS.map(p => tile('preset:' + p.id, AvatarPresets.url(p.id), p.name)));
    const body = h('div.av-picker',
      grid,
      h('div.av-actions',
        h('button.btn.sm', { onclick: async () => { const [f] = await pickFiles({ accept: 'image/*', multiple: false }); if (f) pick('custom', f); } }, icon('upload'), 'Upload your own'),
        h('button.btn.sm.ghost', { onclick: () => pick('default') }, icon('user'), 'Use my initial')));
    o = Dialog.custom('Profile picture', body, [{ label: 'Close' }]);
    const extra = await AvatarPresets.extra();
    for (const x of extra) grid.append(tile('file:' + x.file, x.url, x.name));
  },
};
