/* Your settings and skin, kept with your code: a device playing through a code sends its settings — not the ones that
 * belong to the device (performance and sharpness, audio offset, what song select last showed) — and the skin it uses,
 * if it's one you imported (Kori and the Custom skin are on every device already). Typing your code on another
 * device brings both there (Sync.restore, from the first-run setup and Your code → Use a code). */

const Sync = {
  /** Settings that belong to the device, not to you: never sent, never taken from another device. */
  LOCAL: /^(graphics\.|perf\.|setup\.|debug\.|migr\.|last\.|songselect\.(lastDiff|collection|hidden)$|audio\.offset$|input\.latency$|gameplay\.video$|ui\.(parallax|scale)$|skin\.hd$)/,
  local(k) { return this.LOCAL.test(k); },
  /** The biggest skin the server keeps (worker/vault.js). */
  SKIN_MAX: 30 * 1024 * 1024,
  mark(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
  marked(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  /** A code was just typed here: until what it brings has arrived, nothing from this device is sent (it would replace
   *  yours). Kept across a reload, so a restore cut short is finished at the next start. */
  pending() { return this.marked('am.restore') === '1'; },

  init() {
    Bus.on('settings:changed', k => { if (k === '*' || !this.local(k)) this.later(); });
    Bus.on('skin:changed', () => this.later());
    Bus.on('account:changed', () => this.later());
    if (this.pending() && Account.linked()) setTimeout(() => this.restore().catch(e => console.warn('restore', e)), 2000);
    else this.later(3000);
  },
  later(ms = 4000) {
    clearTimeout(this.t);
    this.t = setTimeout(() => this.push().catch(e => console.warn('settings not kept', e)), ms);
  },
  ready() { return Account.linked() && !Account.signedOut() && !this.pending() && Multiplayer.available() && !!Account.me().pid; },

  /** What's sent: your settings, and which skin you use (by id and name: the same skin has another id on a device it
   *  was brought to). */
  payload() {
    const values = {};
    for (const [k, v] of Object.entries(Settings.values)) if (!this.local(k) && !(typeof v === 'string' && v.length > 100000)) values[k] = v;
    const cur = SkinManager.current;
    return { v: 1, values, skin: cur ? { id: cur.id, name: cur.builtin ? 'Custom' : (cur.meta && cur.meta.name) || '' } : null };
  },
  async push() {
    if (!this.ready()) return;
    const me = Account.me(), p = this.payload(), sum = `${me.pid}|${await hashHex(JSON.stringify(p))}`;
    if (this.marked('am.setSent') !== sum) {
      await Account.call('settings', { ...me, settings: p });
      this.mark('am.setSent', sum);
    }
    await this.pushSkin();
  },
  /** The skin you use, if you imported it, once (again when you change skins). */
  async pushSkin() {
    const cur = SkinManager.current, meta = cur && !cur.builtin && SkinManager.skins.find(s => s.id === cur.id);
    if (!meta || SkinManager.bundled(meta)) return;
    const me = Account.me(), sent = `${me.pid}|${meta.id}`;
    if (this.marked('am.skinSent') === sent) return;
    const blob = await SkinManager.oskBlob(meta.id);
    if (!blob) return;
    if (blob.size > this.SKIN_MAX) { this.mark('am.skinSent', sent); console.warn('skin too big to keep', blob.size); return; }
    const r = await fetch(Host.api('api/account/skin-up'), { method: 'POST', body: blob,
      headers: { 'content-type': 'application/zip', 'x-am-auth': `${me.pid}.${me.key}`, 'x-am-skin': encodeURIComponent(JSON.stringify({ id: meta.id, name: meta.name })) } });
    if (!r.ok) throw new Error(`skin not kept (${r.status})`);
    this.mark('am.skinSent', sent);
  },

  /** After typing your code: your settings and skin from the server. `onStatus(text, fraction)` shows how it's going.
   *  Resolves to what came: { settings, skin } (skin: its name, if it was downloaded). */
  async restore(onStatus = () => {}) {
    this.mark('am.restore', '1');
    onStatus('Bringing your settings…');
    let d;
    try { d = await Account.call('restore', Account.me()); }
    catch (e) {
      // (the server answered no — none kept there, or it doesn't keep them: this device carries on as it is; no answer
      // at all, or too many at once: tried again at the next start)
      if (e.status && e.status !== 429) { this.mark('am.restore', null); this.later(); }
      throw e;
    }
    const got = { settings: false, skin: '' }, s = d.settings && typeof d.settings === 'object' ? d.settings : null;
    if (s && s.values && typeof s.values === 'object') { await this.apply(s.values); got.settings = true; }
    const want = s && s.skin;
    if (want && want.id) {
      if (want.id === 'default') await SkinManager.select('default');
      else {
        const here = SkinManager.skins.find(k => k.id === want.id) || SkinManager.skins.find(k => want.name && k.name === want.name);
        if (here) await SkinManager.select(here.id);
        else if (d.skin && (d.skin.id === want.id || d.skin.name === want.name)) {
          onStatus(`Downloading your skin (${d.skin.name})…`, 0);
          const meta = await SkinManager.importOsk(await this.skinFile(d.skin, f => onStatus(`Downloading your skin (${d.skin.name})…`, f)));
          await SkinManager.select(meta.id);
          this.mark('am.skinSent', `${Account.me().pid}|${meta.id}`); // (it's the one the server has)
          got.skin = meta.name;
        }
      }
    }
    this.mark('am.restore', null);
    this.mark('am.setSent', null);
    this.later();
    return got;
  },
  /** Restored outside the setup (Your code → Use a code): said in a toast. */
  async restoreToast() {
    try {
      const got = await this.restore();
      if (got.settings || got.skin) Toast.ok('Your settings came along', got.skin ? `And your skin, ${got.skin}.` : 'Everything\'s set the way you had it.');
    } catch (e) { if (e.status !== 503 && e.status !== 404) Toast.err('Your settings didn\'t come along', friendlyError(e)); }
  },
  /** The kept skin, downloaded (as a file importOsk takes). */
  async skinFile(info, onProgress) {
    let r;
    try { r = await fetch(Host.api('api/account/skin'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Account.me()) }); }
    catch { throw new Error('Couldn\'t reach the game\'s server. Check your connection and try again.'); }
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Your skin couldn't be downloaded (${r.status}).`); }
    const total = Number(r.headers.get('content-length')) || info.size || 0, parts = [];
    let n = 0;
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader();
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; if (total) onProgress(Math.min(1, n / total)); }
    } else parts.push(new Uint8Array(await r.arrayBuffer()));
    return new File(parts, `${info.name || 'skin'}.osk`, { type: 'application/zip' });
  },
  /** Your settings in place of this device's — except the ones that belong to the device; medals from both. */
  async apply(remote) {
    const next = {};
    for (const [k, v] of Object.entries(remote)) if (!this.local(k)) next[k] = v;
    for (const [k, v] of Object.entries(Settings.values)) if (this.local(k)) next[k] = v;
    const mine = Settings.values['medals.unlocked'];
    if (mine && typeof mine === 'object') next['medals.unlocked'] = { ...mine, ...(next['medals.unlocked'] || {}) };
    next['skin.current'] = Settings.values['skin.current']; // (chosen once it's here: SkinManager.select)
    await Settings.import(next);
  },
};
