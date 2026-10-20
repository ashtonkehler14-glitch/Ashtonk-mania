/* Your settings, skin and scores, kept with your code: a device playing through a code sends the settings you change
 * on it — not the ones that belong to the device (performance and sharpness, audio offset, what song select last
 * showed) — your collections and favourites, the skin it uses if it's one you imported (Kori and the Custom skin are on
 * every device already), and the plays you set on it. Typing your code on another device brings them there
 * (Sync.restore, from the first-run setup and Your code → Use a code); after that, each device gets the plays the
 * others set as it goes. */

const Sync = {
  /** Settings that belong to the device, not to you: never sent, never taken from another device. */
  LOCAL: /^(graphics\.|perf\.|setup\.|debug\.|migr\.|last\.|songselect\.(lastDiff|collection|hidden)$|audio\.offset$|input\.latency$|gameplay\.video$|ui\.(parallax|scale)$|skin\.hd$)/,
  /** …and whatever the setup's Performance / Graphics page sets: a device's choice, never brought from another. */
  local(k) {
    if (!this._preset) this._preset = new Set(typeof SETUP_DEVICES === 'undefined' ? [] : Object.values(SETUP_DEVICES).flatMap(d => Object.keys(d.values())));
    return this.LOCAL.test(k) || this._preset.has(k);
  },
  /** Too big to send (a picture made a setting): kept on the device. */
  big(v) { return typeof v === 'string' && v.length > 100000; },
  /** The biggest skin the server keeps, and for scores: the biggest one, how many go in one call, how many it keeps
   *  (worker/vault.js). */
  SKIN_MAX: 30 * 1024 * 1024,
  SCORE_MAX: 4096, SCORES_SEND: 200, SCORES_MAX: 5000,
  mark(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
  marked(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  /** A code was just typed here: until what it brings has arrived, nothing from this device is sent (it would replace
   *  yours). Kept across a reload, so a restore cut short is finished at the next start. */
  pending() { return this.marked('am.restore') === '1'; },

  init() {
    // (each change noted, to be sent: a medal too — though alone it waits for the next change)
    Bus.on('settings:changed', k => { if (k !== '*' && this.local(k)) return; this.touch(k === '*' ? 'full' : k); this.later(); });
    for (const [ev, part] of [['skin:changed', 'skin'], ['collections:changed', 'cols'], ['favorites:changed', 'favs']]) Bus.on(ev, () => { this.touch(part); this.later(); });
    Bus.on('account:changed', () => this.later());
    Bus.on('scores:changed', () => this.later());
    // (back to the game after a while — a phone put down, another tab: what your other devices played since)
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - (this._pulledAt || 0) > this.PULL_EVERY) this.later(2000); });
    // (plays set without a connection go up once it's back, not at the next play)
    window.addEventListener('online', () => this.later(2000));
    // (a restore cut short: finished now — unless the setup is about to run, which brings it on its own page)
    if (this.pending() && Account.linked() && ProfileManager.profile.onboarded) setTimeout(() => this.restore().catch(e => console.warn('restore', e)), 2000);
    else this.later(3000);
  },
  later(ms = 10000) {
    clearTimeout(this.t);
    this.t = setTimeout(() => this.push().catch(e => console.warn('settings not kept', e)), ms);
  },
  /** What was changed on this device since it last went up (as this player): { full, keys, skin, cols, favs }, or
   *  null. Only that is sent, and the server merges it into what's kept: a device that merely has another version of
   *  the rest — brought long ago, or with a setting the game has added since — never puts it over what you changed
   *  on another device. */
  changes() {
    const pid = Account.me().pid;
    let c = null;
    try { c = JSON.parse(this.marked('am.setChanges') || 'null'); } catch { /* none */ }
    if (c && c.pid === pid && Array.isArray(c.keys)) return c;
    return pid && this.marked('am.setDirty') === pid ? { pid, full: true, keys: [] } : null; // (as the version before marked it)
  },
  /** Changed here — a setting (its key), 'skin', 'cols', 'favs', or 'full' (everything) — and not by a restore. */
  touch(part) { if (!this._restoring) this.note(part); },
  note(part) {
    const pid = Account.me().pid;
    if (!pid) return;
    const c = this.changes() || { pid, keys: [] };
    if (['full', 'skin', 'cols', 'favs'].includes(part)) c[part] = true; else if (!c.keys.includes(part)) c.keys.push(part);
    this.mark('am.setChanges', JSON.stringify(c));
    this._touched = Date.now();
  },
  /** Anything to send (a medal alone goes with the next change). */
  dirty(c = this.changes()) { return !!c && !!(c.full || c.skin || c.cols || c.favs || c.keys.some(k => k !== 'medals.unlocked')); },
  forgetChanges() { this.mark('am.setChanges', null); this.mark('am.setDirty', null); },
  /** When everything from here last went up (0: not yet, or not as this player). */
  sentAt() { const [p, t] = this.marked('am.syncAt').split('|'); return p && p === Account.me().pid ? Number(t) || 0 : 0; },
  // (nothing goes up while a restore is under way: what it brings isn't all here yet)
  ready() { return Account.linked() && !Account.signedOut() && !this.pending() && !this._restoring && Multiplayer.available() && !!Account.me().pid; },

  /** What's sent of what changed (`c`, as changes() has it; everything when `full`): your settings, which skin you use
   *  (by id and name: the same skin has another id on a device it was brought to), your collections (by name, with
   *  their beatmaps' hashes) and favourites (beatmap sets' ids) — unless there are too many to keep. */
  payload(c = { full: true, keys: [] }) {
    const values = {}, keys = new Set(c.keys), out = { v: 2, values };
    for (const [k, v] of Object.entries(Settings.values)) if (!this.local(k) && !this.big(v) && (c.full || keys.has(k))) values[k] = v;
    if (c.full) out.full = true;
    const cur = SkinManager.current;
    if (c.full || c.skin) out.skin = cur ? { id: cur.id, name: cur.builtin ? 'Custom' : (cur.meta && cur.meta.name) || '' } : null;
    if (c.full || c.cols) { const cols = Collections.list.map(x => ({ name: x.name, hashes: x.hashes })); if (JSON.stringify(cols).length <= 100000) out.collections = cols; }
    if (c.full || c.favs) { const favs = [...Favorites.set]; if (favs.length <= 2500) out.favorites = favs; }
    return out;
  },
  async push() {
    if (!this.ready()) return;
    // (one at a time: a skin still uploading on a slow connection was sent again by every settings change meanwhile)
    if (this._pushing) { this._again = true; return; }
    this._pushing = true;
    try {
      let failed = null;
      try {
        const c = this.changes();
        if (this.dirty(c)) {
          const t0 = Date.now(), me = Account.me();
          let d;
          try { d = await Account.call('settings', { ...me, settings: this.payload(c) }); }
          // (nothing kept yet: what changed here alone would be all there is — so everything)
          catch (e) { if (e.status !== 409 || c.full) throw e; c.full = true; d = await Account.call('settings', { ...me, settings: this.payload(c) }); }
          // (the skin itself, when it's what this device sent: d.skin is the one the server keeps)
          if (c.full || c.skin) await this.pushSkin(d.skin || null);
          if (!(this._touched > t0)) this.forgetChanges(); // (changed again meanwhile: all of it goes next time)
        }
      } catch (e) { failed = e; }
      // (your plays on their own: a skin that couldn't go up doesn't keep them back)
      let plays = true;
      try { await this.syncScores(); } catch (e) { plays = false; console.warn('scores not kept', e); }
      if (failed) throw failed;
      if (plays) this.mark('am.syncAt', `${Account.me().pid}|${Date.now()}`);
    } finally {
      this._pushing = false;
      if (this._again) { this._again = false; this.later(); }
    }
  },
  /** The skin you use, if you imported it, as the settings just sent name it (unless the server keeps that one
   *  already). `kept`: the server's, as it answered the settings. */
  async pushSkin(kept) {
    const cur = SkinManager.current, meta = cur && !cur.builtin && SkinManager.skins.find(s => s.id === cur.id);
    if (!meta || SkinManager.bundled(meta)) return;
    const me = Account.me(), sent = `${me.pid}|${meta.id}`;
    if (kept && kept.name === meta.name) { this.mark('am.skinSent', sent); return; }
    if (this.marked('am.skinBig') === sent) return;
    const blob = await SkinManager.oskBlob(meta.id);
    if (!blob) return;
    if (blob.size > this.SKIN_MAX) { this.mark('am.skinBig', sent); console.warn('skin too big to keep', blob.size); return; }
    const r = await fetch(Host.api('api/account/skin-up'), { method: 'POST', body: blob, signal: timeoutSignal(600000), // (10 minutes even on a slow connection)
      headers: { 'content-type': 'application/zip', 'x-am-auth': `${me.pid}.${me.key}`, 'x-am-skin': encodeURIComponent(JSON.stringify({ id: meta.id, name: meta.name })) } });
    if (!r.ok) throw new Error(`skin not kept (${r.status})`);
    this.mark('am.skinSent', sent);
  },

  /** What a play keeps for your other devices: what its results show — not the hit-by-hit timing or the health
   *  over time (too big: they stay on the device it was played on). */
  KEEP: ['id', 'mapHash', 'title', 'artist', 'version', 'creator', 'status', 'keys', 'stars', 'pp', 'mods', 'rate', 'score', 'scoreStd', 'accuracy', 'maxCombo',
    'counts', 'grade', 'passed', 'date', 'duration', 'player', 'meanError', 'unstableRate', 'early', 'late', 'totalJudgements', 'accuracyMode', 'windows', 'od', 'modConfig', 'srVersion'],
  compact(s) {
    const o = {};
    for (const k of this.KEEP) if (s[k] !== undefined) o[k] = s[k];
    // (and the beatmap's osu! ids: a device without the beatmap still shows it's a ranked one on your profile)
    const m = BeatmapManager.mapByHash(s.mapHash), set = m && BeatmapManager.setById.get(m.setId);
    if (m && m.onlineId > 0) o.onlineId = m.onlineId; else if (s.onlineId > 0) o.onlineId = s.onlineId;
    if (set && set.onlineId > 0) o.onlineSetId = set.onlineId; else if (s.onlineSetId > 0) o.onlineSetId = s.onlineSetId;
    return o;
  },
  /** How often what your other devices played is asked for (also when you come back to the game after this long). */
  PULL_EVERY: 10 * 60000,
  /** Your plays both ways: the new ones from here up, then the ones your other devices sent since — straight after
   *  sending (so a play deleted here can't come back as theirs), else every PULL_EVERY. Not in the middle of a song. */
  async syncScores() {
    const sent = await this.pushScores();
    if (Screens.currentName === 'gameplay') return;
    if (sent || Date.now() - (this._pulledAt || 0) > this.PULL_EVERY) await this.pullScores();
  },
  /** Which plays from here went up, for which player (typing another code sends them again): their ids, kept on their
   *  own — marking the plays themselves wrote each one back whole, hit-by-hit timing and all, megabytes at a time. */
  async sentIds(pid) {
    if (!this._sent || this._sent.pid !== pid) {
      const kept = await DB.kvGet('sync.sent', null).catch(() => null);
      this._sent = { pid, ids: new Set(kept && kept.pid === pid && Array.isArray(kept.ids) ? kept.ids : []) };
    }
    return this._sent.ids;
  },
  /** The plays set on this device that the server doesn't have yet, oldest first — the newest SCORES_MAX: older ones
   *  wouldn't be kept. Not imported ones (a backup, a Web-Osu-Mania save: they stay where they were imported), not the
   *  ones that came from your other devices. Resolves to how many went. */
  async pushScores() {
    const me = Account.me(), sent = await this.sentIds(me.pid);
    const due = ScoreManager.scores.filter(s => s.own !== false && !s.imported && !s.synced && !sent.has(s.id) && s.sent !== me.pid).slice(-this.SCORES_MAX);
    for (let i = 0; i < due.length; i += this.SCORES_SEND) {
      const part = due.slice(i, i + this.SCORES_SEND), send = part.map(s => this.compact(s)).filter(x => JSON.stringify(x).length <= this.SCORE_MAX);
      if (send.length) await Account.call('scores-up', { ...me, scores: send });
      for (const s of part) sent.add(s.id);
      const here = new Set(ScoreManager.scores.map(s => s.id)); // (a deleted play's id isn't kept)
      await DB.kvSet('sync.sent', { pid: me.pid, ids: [...sent].filter(id => here.has(id)) });
    }
    return due.length;
  },
  /** The plays kept since this device last asked (the server numbers them as they come), a page at a time. Resolves
   *  to how many were new here. */
  async pullScores() {
    const me = Account.me(), [p, n] = this.marked('am.scPulled').split('|');
    let after = p === me.pid ? Number(n) || 0 : 0, got = 0;
    for (let i = 0; i < 40; i++) {
      const d = await Account.call('scores', { ...me, after });
      if (Array.isArray(d.scores) && d.scores.length) got += await ScoreManager.addSynced(d.scores);
      if (Number.isFinite(d.last)) after = d.last;
      this.mark('am.scPulled', `${me.pid}|${after}`);
      if (d.next == null) break;
    }
    this._pulledAt = Date.now();
    return got;
  },

  /** After typing your code: your settings and skin from the server. `onStatus(text, fraction)` shows how it's going.
   *  Resolves to what came: { settings, skin, scores, collections, favorites } (skin: its name, if it was downloaded;
   *  scores: how many of your plays; collections: how many were added or got more beatmaps; favorites: how many new). */
  async restore(onStatus = () => {}) {
    this._restoring = true;
    try { return await this._restore(onStatus); } finally { this._restoring = false; }
  },
  async _restore(onStatus) {
    this.mark('am.restore', '1');
    onStatus('Bringing your settings…');
    let d;
    try { d = await Account.call('restore', Account.me()); }
    catch (e) {
      // (the server says it keeps nothing for this device — it doesn't keep settings, or this device isn't that player:
      // this device carries on as it is. Anything else — no answer, a server error, too many at once — is tried again
      // in a minute: until then nothing from here is sent, or it would replace what's kept)
      if ([400, 403, 404, 503].includes(e.status)) { this.mark('am.restore', null); this.later(); }
      else this.retry();
      throw e;
    }
    const got = { settings: false, skin: '', skinErr: '', scores: 0, collections: 0, favorites: 0 }, s = d.settings && typeof d.settings === 'object' ? d.settings : null;
    const own = s ? this.ownExtra(s) : [];
    if (s && s.values && typeof s.values === 'object') { await this.apply(s.values); got.settings = true; }
    if (s && Array.isArray(s.collections)) got.collections = await Collections.merge(s.collections);
    if (s && Array.isArray(s.favorites)) got.favorites = await Favorites.merge(s.favorites);
    // (the settings are here: whatever happens to the skin, this restore is done — it's never applied over again)
    this.mark('am.restore', null);
    const want = s && s.skin, pid = Account.me().pid;
    if (want && want.id) {
      if (want.id === 'default') await SkinManager.select('default');
      else {
        const here = SkinManager.skins.find(k => k.id === want.id) || SkinManager.skins.find(k => want.name && k.name === want.name);
        if (here) {
          await SkinManager.select(here.id);
          if (d.skin && d.skin.name === here.name) this.mark('am.skinSent', `${pid}|${here.id}`); // (the server has it already)
        } else if (d.skin && (d.skin.id === want.id || d.skin.name === want.name)) {
          try {
            onStatus(`Downloading your skin (${d.skin.name})…`, 0);
            const meta = await SkinManager.importOsk(await this.skinFile(d.skin, f => onStatus(`Downloading your skin (${d.skin.name})…`, f)));
            await SkinManager.select(meta.id);
            this.mark('am.skinSent', `${pid}|${meta.id}`); // (it's the one the server has)
            got.skin = meta.name;
          } catch (e) { got.skinErr = friendlyError(e); console.warn('skin not brought', e); }
        }
      }
    }
    // (what came is what's kept: nothing from here to send back — sent anyway, it went over newer settings another of
    // your devices had sent in the meantime — but what this device adds to it, and everything if nothing was kept)
    this.forgetChanges();
    if (!s) this.note('full');
    for (const part of own) this.note(part);
    onStatus('Bringing your scores…');
    // (all that's kept, not only what's new since this device last asked: one that had them and lost them — Reset
    // everything, or cleared by the browser — gets them back; the ones it has are skipped)
    this.mark('am.scPulled', null);
    try { got.scores = await this.pullScores(); } catch (e) { console.warn('scores not brought', e); } // (again with the next settings sent)
    this.later();
    // (the beatmaps your plays are on that this device hasn't got: offered once the setup, if it's open, is done)
    const offer = () => setTimeout(() => this.offerMissing(), 1500);
    if (typeof Onboarding !== 'undefined' && Onboarding.o) Onboarding.done.then(offer); else offer();
    return got;
  },
  /** The beatmaps your plays from your other devices are on that this device hasn't got (by their osu! set ids). */
  missingSets() {
    const have = new Set(BeatmapManager.sets.map(s => s.onlineId).filter(x => x > 0)), out = new Map();
    for (const s of ScoreManager.scores) {
      if (s.synced && s.onlineSetId > 0 && !have.has(s.onlineSetId) && !out.has(s.onlineSetId) && !BeatmapManager.mapByHash(s.mapHash)) out.set(s.onlineSetId, { id: s.onlineSetId, title: s.title || '', artist: s.artist || '' });
    }
    return [...out.values()];
  },
  offerMissing() {
    const n = this.missingSets().length;
    if (n) Toast.show('Get the beatmaps you\'ve played?', `Your plays from your other devices are on ${plural(n, 'beatmap')} this device hasn't got. ${kbHint('Click', 'Tap')} to download ${n === 1 ? 'it' : 'them'}.`, { timeout: 15000, hold: true, onClick: () => this.getMissing() });
  },
  /** Downloads them, three at a time (one stuck download doesn't hold up the rest), as lazer's progress notification
   *  does a download: how far it's got, and its X stops them. */
  async getMissing() {
    if (this._getting) return;
    const sets = this.missingSets(), n = sets.length;
    if (!n) return;
    if (navigator.onLine === false) { Toast.err('The beatmaps couldn\'t be downloaded', 'You\'re offline. Connect to the internet and try again.'); return; }
    this._getting = true;
    const queue = [...sets], ac = new AbortController();
    const note = Toast.progress('Downloading beatmaps you\'ve played', `0 of ${n}`, { onCancel: () => ac.abort() });
    let done = 0, failed = 0, first = '', full = false;
    const worker = async () => {
      for (let set; !ac.signal.aborted && (set = queue.shift());) {
        try { await OnlineBeatmaps.downloadAndImport(set, null, { quiet: true, signal: ac.signal }); }
        catch (e) {
          if (e && e.cancelled) break;
          failed++; first = first || friendlyError(e);
          // (no room left: the rest wouldn't fit either — not downloaded only to be thrown away)
          if (storageFull(e)) { full = true; first = friendlyError(e); failed += queue.length; done += queue.length; queue.length = 0; }
        }
        done++; note.set(done / n, `${done} of ${n}`);
      }
    };
    try { await Promise.all([worker(), worker(), worker()]); } finally { this._getting = false; }
    const got = done - failed, here = `${plural(got, 'beatmap')} you've played on your other devices ${got === 1 ? 'is' : 'are'} here now.`;
    if (ac.signal.aborted) { note.cancelled(); if (got) Toast.ok('Beatmaps downloaded', here, { hold: true }); return; }
    const why = full ? ` ${plural(failed, 'beatmap')} didn't fit. ${first}` : failed ? ` ${plural(failed, 'beatmap')} couldn't be (${noStop(first)}).` : '';
    if (got) note.done('Beatmaps downloaded', here + why);
    else note.fail('The beatmaps couldn\'t be downloaded', first);
  },
  /** What this device has that the kept settings `s` don't, and that a restore adds to them (so it's sent): its
   *  parts, as note() takes them — collections with a beatmap more, favourites, medals. */
  ownExtra(s) {
    const cols = new Map((Array.isArray(s.collections) ? s.collections : []).map(c => [c && c.name, new Set(c && Array.isArray(c.hashes) ? c.hashes : [])]));
    const favs = new Set(Array.isArray(s.favorites) ? s.favorites : []), medals = (s.values && s.values['medals.unlocked']) || {}, mine = Settings.values['medals.unlocked'] || {};
    return [
      Collections.list.some(c => c.hashes.some(x => !(cols.get(c.name) || new Set()).has(x))) && 'cols',
      [...Favorites.set].some(x => !favs.has(x)) && 'favs',
      typeof mine === 'object' && Object.keys(mine).some(k => !(k in medals)) && 'medals.unlocked',
    ].filter(Boolean);
  },
  /** A restore that didn't get an answer: again in a minute, quietly, while this device still waits for one. */
  retry() {
    clearTimeout(this._rt);
    this._rt = setTimeout(() => { if (this.pending() && Account.linked()) this.restore().catch(() => {}); }, 60000);
  },
  /** Restored outside the setup (Your code → Use a code): said in a toast. */
  async restoreToast() {
    try {
      const got = await this.restore();
      const plays = got.scores ? ` Your scores came too (${plural(got.scores, 'play')}).` : '';
      if (got.settings || got.skin) Toast.ok('Your settings came along', (got.skin ? `And your skin, ${got.skin}.` : got.skinErr ? `Your skin didn't (${noStop(got.skinErr)}).` : 'Everything\'s set the way you had it.') + plays);
      else if (got.scores) Toast.ok('Your scores came along', `${plural(got.scores, 'play')}.`);
    } catch (e) { if (e.status !== 503 && e.status !== 404) Toast.err('Your settings didn\'t come along', friendlyError(e)); }
  },
  /** The kept skin, downloaded (as a file importOsk takes). */
  async skinFile(info, onProgress) {
    // (given up on when nothing comes for 30 s — no answer at all, or the download stalling part-way)
    const ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(), 30000);
    const kick = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), 30000); };
    try {
      let r;
      try { r = await fetch(Host.api('api/account/skin'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Account.me()), signal: ctl.signal }); }
      catch { throw new Error('Couldn\'t reach the game\'s server. Check your connection and try again.'); }
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Your skin couldn't be downloaded (${r.status}).`); }
      const total = Number(r.headers.get('content-length')) || info.size || 0, parts = [];
      let n = 0;
      kick();
      try {
        if (r.body && r.body.getReader) {
          const rd = r.body.getReader();
          for (;;) { const { done, value } = await rd.read(); if (done) break; kick(); parts.push(value); n += value.length; if (total) onProgress(Math.min(1, n / total)); }
        } else parts.push(new Uint8Array(await r.arrayBuffer()));
      } catch (e) { throw ctl.signal.aborted ? new Error('Your skin stopped downloading. Check your connection and try again.') : e; }
      return new File(parts, `${info.name || 'skin'}.osk`, { type: 'application/zip' });
    } finally { clearTimeout(timer); }
  },
  /** Your settings in place of this device's — except the ones that belong to the device; medals from both. */
  async apply(remote) {
    const next = {};
    for (const [k, v] of Object.entries(remote)) if (!this.local(k)) next[k] = v;
    for (const [k, v] of Object.entries(Settings.values)) if (this.local(k) || (this.big(v) && !(k in next))) next[k] = v;
    const mine = Settings.values['medals.unlocked'];
    if (mine && typeof mine === 'object') next['medals.unlocked'] = { ...mine, ...(next['medals.unlocked'] || {}) };
    next['skin.current'] = Settings.values['skin.current']; // (chosen once it's here: SkinManager.select)
    await Settings.import(next);
  },
};
