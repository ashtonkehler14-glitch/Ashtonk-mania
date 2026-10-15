/* Where the game's files and its server are. On the website both are next to the page (relative paths). A copy
 * saved as one HTML file and opened from the device (file://, see HtmlFile) carries its files inside it
 * (window.AM_ASSETS: path → data: URL) and talks to the website it was saved from (window.AM_SERVER), or to the
 * address set in Settings → Maintenance. */

const Host = {
  /** Running from a saved HTML file rather than the website. */
  standalone: !/^https?:$/.test(location.protocol),
  files: window.AM_ASSETS || null,
  /** The game's website ('https://…/'), for a saved file; '' on the website itself (everything is relative there). */
  server() {
    if (!this.standalone) return '';
    let s = ''; try { s = localStorage.getItem('am.server') || ''; } catch { /* private mode */ }
    s = s || window.AM_SERVER || '';
    return /^https?:\/\/[^/\s]+/i.test(s) ? s.replace(/\/*$/, '/') : '';
  },
  setServer(s) {
    s = String(s || '').trim();
    if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
    try { if (s && s !== window.AM_SERVER) localStorage.setItem('am.server', s); else localStorage.removeItem('am.server'); } catch { /* private mode */ }
    return this.server();
  },
  /** Whether there's a game server to talk to (multiplayer, beatmap search, rankings). */
  online() { return !this.standalone || !!this.server(); },
  /** A server path ('api/…') as a URL fetch() can use. */
  api(path) { return this.standalone ? this.server() + path : path; },
  /** A server path as a WebSocket URL. */
  ws(path) { const u = new URL(this.api(path), location.href); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; return u; },
  /** A file shipped with the game ('skins/kori.osk', 'avatars/miku.jpg'…): from inside the saved file when it has it. */
  asset(path) {
    const f = this.files && (this.files[path] || this.files[safeDecode(path)]);
    return f || this.api(path);
  },
  /** The page's address for links other people open (invites): the website, even from a saved file. */
  siteURL() { return this.standalone ? this.server() || location.href : location.href; },
};
function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }
