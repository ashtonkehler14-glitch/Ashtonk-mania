// Each player's settings, skin and scores, kept for the devices that play as them through their code: one Durable
// Object a player (PlayerVault, idFromName(pid)). Typing your code on another device brings them there. Only reached
// through handleAccount (multiplayer.js), once the Matchmaker has checked the device's key — never straight from outside.

/** A stored value holds at most 2 MB: a skin is kept in 1 MB pieces. */
const CHUNK = 1 << 20;
export const SETTINGS_MAX = 1024 * 1024;
export const SKIN_MAX = 30 * 1024 * 1024;
/** Your scores, kept for your other devices: each as the game sends it (no hit-by-hit timing), the newest this many. */
export const SCORE_MAX = 4096;
export const SCORES_MAX = 5000;
export const SCORES_SEND = 200; // (at most this many in one go)
const SCORES_PAGE = 300;
const seqKey = n => `sq:${String(n).padStart(10, '0')}`;
const scoreId = id => typeof id === 'string' && /^sc-[\w-]{4,48}$/.test(id);

/** What's kept (`base`) with a device's changes (`o`: the settings it changed; skin, collections or favourites if
 *  they changed) — medals unlocked anywhere stay unlocked. */
export function mergeSettings(base, o) {
  const values = { ...base.values, ...(o.values && typeof o.values === 'object' && !Array.isArray(o.values) ? o.values : {}) };
  const m0 = base.values['medals.unlocked'], m1 = o.values && o.values['medals.unlocked'];
  if (m0 && typeof m0 === 'object' && m1 && typeof m1 === 'object') values['medals.unlocked'] = { ...m0, ...m1 };
  const out = { ...base, v: 2, values };
  for (const k of ['skin', 'collections', 'favorites', 'profile', 'offsets', 'sets']) if (k in o) out[k] = o[k];
  delete out.full;
  return out;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export class PlayerVault {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const st = this.state.storage, path = new URL(request.url).pathname;
    // the settings, as the game sends them ({ v, values, skin: { id, name }, collections, favorites }). From v2, what a
    // device changed is merged into what's kept — each setting as the device that last changed it has it, medals from
    // all — and only `full` replaces it all (the first time; older games always do)
    if (path === '/settings') {
      let text = await request.text(), o;
      if (text.length > SETTINGS_MAX) return json({ error: 'Your settings are too big to keep.' }, 413);
      try { o = JSON.parse(text); if (!o || typeof o !== 'object' || Array.isArray(o)) throw 0; } catch { return json({ error: 'Bad settings.' }, 400); }
      if (o.v >= 2 && !o.full) {
        const old = await st.get('settings');
        let base = null;
        try { base = old ? JSON.parse(old.text) : null; } catch { /* unreadable: as if none */ }
        if (!base || typeof base !== 'object' || !base.values || typeof base.values !== 'object') return json({ error: 'Nothing is kept yet: send everything.', full: true }, 409);
        text = JSON.stringify(mergeSettings(base, o));
        if (text.length > SETTINGS_MAX) return json({ error: 'Your settings are too big to keep.' }, 413);
      }
      // (each change numbered: a device asking again later knows whether there's anything new since)
      const rev = ((await st.get('rev')) || 0) + 1;
      await st.put({ settings: { at: Date.now(), text }, rev });
      // (which skin is kept: a device whose skin isn't it sends its own)
      const k = await st.get('skin');
      return json({ ok: true, rev, skin: k ? { id: k.id, name: k.name } : null });
    }
    // what there is to bring to a device: the settings, and which skin is kept (not the skin itself)
    if (path === '/restore') {
      const [s, k, rev] = await Promise.all([st.get('settings'), st.get('skin'), st.get('rev')]);
      let settings = null;
      try { settings = s ? JSON.parse(s.text) : null; } catch { /* unreadable: as if none */ }
      return json({ ok: true, settings, rev: rev || 0, skin: k ? { id: k.id, name: k.name, size: k.size, at: k.at } : null });
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
    // scores to keep: each once (by its id), in the order they came — so a device asks for "the ones after the last I
    // got" — and only the newest SCORES_MAX
    if (path === '/scores-up') {
      let b = null;
      try { b = JSON.parse(await request.text()); } catch { /* below */ }
      if (!b || !Array.isArray(b.scores)) return json({ error: 'Bad scores.' }, 400);
      const list = b.scores.slice(0, SCORES_SEND).filter(x => x && typeof x === 'object' && !Array.isArray(x) && scoreId(x.id));
      const have = new Set();
      for (let i = 0; i < list.length; i += 128) for (const k of (await st.get(list.slice(i, i + 128).map(x => `si:${x.id}`))).keys()) have.add(k);
      let seq = (await st.get('scSeq')) || 0, n = (await st.get('scN')) || 0, added = 0;
      const put = {};
      for (const x of list) {
        const ik = `si:${x.id}`, text = JSON.stringify(x);
        if (have.has(ik) || ik in put || text.length > SCORE_MAX) continue;
        seq++; put[seqKey(seq)] = text; put[ik] = seq; added++;
      }
      if (added) {
        put.scSeq = seq; put.scN = n + added;
        const entries = Object.entries(put);
        for (let i = 0; i < entries.length; i += 128) await st.put(Object.fromEntries(entries.slice(i, i + 128)));
        if (n + added > SCORES_MAX) await this.trimScores(n + added - SCORES_MAX);
      }
      return json({ ok: true, added });
    }
    // the scores kept after sequence number `after`, a page at a time: `next` to go on from, null at the end
    if (path === '/scores') {
      let b = {};
      try { b = JSON.parse(await request.text()) || {}; } catch { /* from the start */ }
      const after = Math.max(0, Math.floor(Number(b.after) || 0));
      const page = await st.list({ prefix: 'sq:', start: seqKey(after + 1), limit: SCORES_PAGE });
      const scores = [];
      let last = after;
      for (const [k, v] of page) { last = Number(k.slice(3)); try { scores.push(JSON.parse(v)); } catch { /* unreadable: left out */ } }
      return json({ ok: true, scores, last, next: page.size === SCORES_PAGE ? last : null });
    }
    // a player merged into another (their code typed on this player's device): nothing of theirs is kept
    if (path === '/wipe') { await st.deleteAll(); return json({ ok: true }); }
    return json({ error: 'Not found' }, 404);
  }
  /** The oldest `k` scores go (past SCORES_MAX). */
  async trimScores(k) {
    const st = this.state.storage, old = await st.list({ prefix: 'sq:', limit: k }), del = [];
    for (const [key, v] of old) { del.push(key); try { del.push(`si:${JSON.parse(v).id}`); } catch { /* unreadable */ } }
    for (let i = 0; i < del.length; i += 128) await st.delete(del.slice(i, i + 128));
    await st.put('scN', Math.max(0, ((await st.get('scN')) || 0) - old.size));
  }
  async drop(up, n) {
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(`sk:${up}:${i}`);
    for (let i = 0; i < keys.length; i += 128) await this.state.storage.delete(keys.slice(i, i + 128)).catch(() => {});
  }
}
