/* Free profile pictures: built-in Miku, Teto and Neru avatars (drawn here as small SVG portraits), plus any
 * images listed in public/avatars/avatars.json — [{ "file": "miku.png", "name": "Miku" }, …] — so real pictures
 * can be added by dropping them into that folder. Profile avatar values: 'default' (initial), 'custom'
 * (uploaded), 'preset:<id>' or 'file:<file>'. */

const CHARACTERS = {
  miku: { hair: '#3ec9bf', hairS: '#1e9e96', hairH: '#9ff0ea', eye: '#2bb3a8', outfit: '#9ca3ad', tie: '#3ec9bf', style: 'twintails', acc: '#2b2d36' },
  teto: { hair: '#e0445e', hairS: '#b52a44', hairH: '#ff9aab', eye: '#d8364f', outfit: '#8f8c99', tie: '#e0445e', style: 'drills', acc: '#2b2d36' },
  neru: { hair: '#f5d34a', hairS: '#d9ae25', hairH: '#fff1a6', eye: '#d99a22', outfit: '#a4a8b3', tie: '#373b46', style: 'ponytail', acc: '#5b4bc4' },
};

/** A small chibi bust portrait as an SVG string (100×100). */
function avatarSVG(c, { bg = ['#2a2a3a', '#15151f'], expr = 'open' } = {}) {
  const skin = '#ffe9de', line = '#3a2418';
  let back = '';
  if (c.style === 'twintails') back = `<path d="M22 28 C4 40 2 76 10 104 L26 104 C22 80 22 54 30 36 Z" fill="${c.hairS}"/><path d="M78 28 C96 40 98 76 90 104 L74 104 C78 80 78 54 70 36 Z" fill="${c.hairS}"/>`;
  if (c.style === 'drills') back = [0, 1, 2].map(i => `<circle cx="16" cy="${52 + i * 15}" r="${10 - i}" fill="${i % 2 ? c.hairS : c.hair}"/><circle cx="84" cy="${52 + i * 15}" r="${10 - i}" fill="${i % 2 ? c.hairS : c.hair}"/>`).join('')
    + `<path d="M11 50 q5 -4 10 0 M79 50 q5 -4 10 0 M12 66 q4 -4 9 0 M79 66 q4 -4 9 0" stroke="${c.hairH}" stroke-width="1.6" fill="none" opacity=".7"/>`;
  if (c.style === 'ponytail') back = `<path d="M70 24 C98 18 104 60 96 104 L80 104 C84 74 82 46 70 38 Z" fill="${c.hair}"/><path d="M84 34 C96 48 96 72 92 96" stroke="${c.hairH}" stroke-width="2.4" fill="none" opacity=".7"/>`;
  const eye = (x, kind) => kind === 'shut'
    ? `<path d="M${x - 6} 55 Q${x} 48 ${x + 6} 55" stroke="${line}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
    : `<ellipse cx="${x}" cy="55" rx="5.2" ry="6.4" fill="${c.eye}"/><ellipse cx="${x}" cy="56.5" rx="2.6" ry="3.6" fill="#1f1a2a"/><circle cx="${x - 1.8}" cy="53" r="1.7" fill="#fff"/><path d="M${x - 6.5} 50 Q${x} 46.5 ${x + 6.5} 50" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  const eyes = expr === 'happy' ? eye(39, 'shut') + eye(61, 'shut') : expr === 'wink' ? eye(39, 'open') + eye(61, 'shut') : eye(39, 'open') + eye(61, 'open');
  const mouth = expr === 'open' ? `<path d="M45.5 64 Q50 70 54.5 64 Z" fill="#b0404a" stroke="${line}" stroke-width="1.2" stroke-linejoin="round"/>`
    : `<path d="M45 64 Q50 68 55 64" stroke="${line}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  let acc = '';
  if (c.style === 'twintails') acc = `<rect x="18" y="26" width="8" height="8" rx="1.5" fill="${c.acc}"/><rect x="74" y="26" width="8" height="8" rx="1.5" fill="${c.acc}"/><rect x="20" y="28" width="4" height="4" fill="#ff6aa8"/><rect x="76" y="28" width="4" height="4" fill="#ff6aa8"/>`;
  if (c.style === 'drills') acc = `<path d="M50 17 C44 6 56 2 58 10 C60 4 68 8 62 14" stroke="${c.hair}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  if (c.style === 'ponytail') acc = `<circle cx="72" cy="28" r="4.5" fill="${c.acc}"/><path d="M50 17 C45 8 55 4 58 11" stroke="${c.hair}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
<rect width="100" height="100" fill="url(#g)"/>
<circle cx="18" cy="18" r="10" fill="#fff" opacity=".08"/><circle cx="86" cy="80" r="16" fill="#fff" opacity=".06"/>
${back}
<ellipse cx="50" cy="44" rx="33" ry="31" fill="${c.hairS}"/>
<path d="M18 104 C20 86 32 78 50 78 C68 78 80 86 82 104 Z" fill="${c.outfit}"/>
<path d="M38 80 L50 88 L62 80 L58 78 L50 84 L42 78 Z" fill="#c9ccd4"/>
<path d="M47.5 86 L52.5 86 L55 100 L50 104 L45 100 Z" fill="${c.tie}"/>
<rect x="45" y="70" width="10" height="10" rx="3" fill="${skin}"/>
<ellipse cx="50" cy="52" rx="26" ry="25" fill="${skin}"/>
${eyes}
<ellipse cx="33" cy="63" rx="5" ry="2.8" fill="#ff8fa8" opacity=".55"/><ellipse cx="67" cy="63" rx="5" ry="2.8" fill="#ff8fa8" opacity=".55"/>
${mouth}
<path d="M23 52 C20 24 36 15 50 15 C64 15 80 24 77 52 L72 42 L67 51 L61 37 L55 49 L49 35 L44 49 L38 37 L33 50 L28 42 Z" fill="${c.hair}"/>
<path d="M32 28 C38 21 46 19 55 20" stroke="${c.hairH}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".85"/>
${acc}
</svg>`;
}

const AVATAR_PRESETS = [
  { id: 'miku-1', name: 'Miku', char: 'miku', bg: ['#baf5ef', '#39c5bb'], expr: 'open' },
  { id: 'miku-2', name: 'Miku', char: 'miku', bg: ['#ffd1e6', '#ff7ab6'], expr: 'wink' },
  { id: 'teto-1', name: 'Teto', char: 'teto', bg: ['#ffe0e5', '#ff6b84'], expr: 'happy' },
  { id: 'teto-2', name: 'Teto', char: 'teto', bg: ['#3a2a3e', '#1c1622'], expr: 'open' },
  { id: 'neru-1', name: 'Neru', char: 'neru', bg: ['#fff4c2', '#ffcf3a'], expr: 'smile' },
  { id: 'neru-2', name: 'Neru', char: 'neru', bg: ['#d9c8ff', '#8a63ff'], expr: 'wink' },
];

const AvatarPresets = {
  _urls: new Map(),
  url(id) {
    if (this._urls.has(id)) return this._urls.get(id);
    const p = AVATAR_PRESETS.find(x => x.id === id);
    if (!p) return null;
    const u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(avatarSVG(CHARACTERS[p.char], p));
    this._urls.set(id, u);
    return u;
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
    const tile = (kind, url, name) => h(`button.av-tile${cur === kind ? '.on' : ''}`, { title: name, 'aria-label': name, onclick: () => pick(kind) }, h('img', { src: url, alt: '' }), h('span', name));
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
