// Each player's settings and skin, kept for the devices that play as them through their code: one Durable Object a
// player (PlayerVault, idFromName(pid)). Typing your code on another device brings them there. Only reached through
// handleAccount (multiplayer.js), once the Matchmaker has checked the device's key — never straight from outside.

/** A stored value holds at most 2 MB: a skin is kept in 1 MB pieces. */
const CHUNK = 1 << 20;
export const SETTINGS_MAX = 256 * 1024;
export const SKIN_MAX = 30 * 1024 * 1024;

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export class PlayerVault {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const st = this.state.storage, path = new URL(request.url).pathname;
    // the settings, as the game sends them ({ v, values, skin: { id, name } }): replaced each time
    if (path === '/settings') {
      const text = await request.text();
      if (text.length > SETTINGS_MAX) return json({ error: 'Your settings are too big to keep.' }, 413);
      try { const o = JSON.parse(text); if (!o || typeof o !== 'object') throw 0; } catch { return json({ error: 'Bad settings.' }, 400); }
      await st.put('settings', { at: Date.now(), text });
      // (which skin is kept: a device whose skin isn't it sends its own)
      const k = await st.get('skin');
      return json({ ok: true, skin: k ? { id: k.id, name: k.name } : null });
    }
    // what there is to bring to a device: the settings, and which skin is kept (not the skin itself)
    if (path === '/restore') {
      const [s, k] = await Promise.all([st.get('settings'), st.get('skin')]);
      let settings = null;
      try { settings = s ? JSON.parse(s.text) : null; } catch { /* unreadable: as if none */ }
      return json({ ok: true, settings, skin: k ? { id: k.id, name: k.name, size: k.size, at: k.at } : null });
    }
    // the skin (an .osk), in pieces as it arrives; the one kept before goes once the new one is all in
    if (path === '/skin-up') {
      let info = {};
      try { info = JSON.parse(decodeURIComponent(request.headers.get('x-am-skin') || '')) || {}; } catch { /* nameless */ }
      const id = String(info.id || '').slice(0, 64), name = String(info.name || '').slice(0, 120);
      if (!id || !request.body) return json({ error: 'Bad skin.' }, 400);
      const up = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const buf = new Uint8Array(CHUNK), reader = request.body.getReader();
      let n = 0, fill = 0, size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > SKIN_MAX) throw Object.assign(new Error('Your skin is too big to keep (30 MB at most).'), { status: 413 });
          for (let off = 0; off < value.length;) {
            const take = Math.min(CHUNK - fill, value.length - off);
            buf.set(value.subarray(off, off + take), fill);
            fill += take; off += take;
            if (fill === CHUNK) { await st.put(`sk:${up}:${n++}`, buf.slice()); fill = 0; }
          }
        }
        if (fill) await st.put(`sk:${up}:${n++}`, buf.slice(0, fill));
        if (!size) throw Object.assign(new Error('Bad skin.'), { status: 400 });
      } catch (e) {
        try { reader.cancel(); } catch { /* done */ }
        await this.drop(up, n);
        return json({ error: e.status ? e.message : 'The skin didn\'t arrive whole. Try again.' }, e.status || 400);
      }
      const old = await st.get('skin');
      await st.put('skin', { id, name, size, chunks: n, up, at: Date.now() });
      if (old) await this.drop(old.up, old.chunks);
      return json({ ok: true, size });
    }
    if (path === '/skin') {
      const k = await st.get('skin');
      if (!k) return json({ error: 'No skin kept.' }, 404);
      let i = 0;
      const body = new ReadableStream({
        async pull(c) {
          if (i >= k.chunks) { c.close(); return; }
          const v = await st.get(`sk:${k.up}:${i++}`);
          if (!v) { c.error(new Error('missing piece')); return; }
          c.enqueue(v instanceof Uint8Array ? v : new Uint8Array(v));
        },
      });
      return new Response(body, { headers: { 'content-type': 'application/zip', 'content-length': String(k.size), 'cache-control': 'no-store', 'x-am-skin': encodeURIComponent(JSON.stringify({ id: k.id, name: k.name })) } });
    }
    // a player merged into another (their code typed on this player's device): nothing of theirs is kept
    if (path === '/wipe') { await st.deleteAll(); return json({ ok: true }); }
    return json({ error: 'Not found' }, 404);
  }
  async drop(up, n) {
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(`sk:${up}:${i}`);
    for (let i = 0; i < keys.length; i += 128) await this.state.storage.delete(keys.slice(i, i + 128)).catch(() => {});
  }
}
