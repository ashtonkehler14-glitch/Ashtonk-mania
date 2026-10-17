/* Your code: play as yourself on another device. Every player can get a secret code (Your code, from the menu under
 * your name in the top bar); typing it on another device makes that device you — one entry on the rankings and the
 * beatmap leaderboards, one profile and friends list — and what that device had online before is added to you, so a
 * save imported onto it doesn't put you on the leaderboards twice. No username or password.
 * Keeping it safe: a code is 16 characters, 80 random bits made by the server (guessing one is hopeless, and the server
 * only lets a few be tried); the server keeps only its fingerprint; each device gets a key of its own, so New code
 * (the old one stops working) and Sign out other devices shut out anyone who got hold of it, and your devices are told
 * whenever a new one starts playing as you. This device keeps its own copy of the code to show you. */

const Account = {
  /** The code, as this device has it to show (it made the code, or one was typed into it). */
  code() { try { return localStorage.getItem('am.code') || ''; } catch { return ''; } },
  /** This device plays as a player through a code (made or typed here). */
  linked() { try { return localStorage.getItem('am.linked') === '1'; } catch { return false; } },
  /** Signed out on this device: no online identity until a code is typed, or it starts over as a new player. */
  signedOut() { try { return localStorage.getItem('am.signedOut') === '1'; } catch { return false; } },
  ALPHABET: '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
  /** A code as typed — any case, dashes and spaces or not, O for 0, I or L for 1 — or '' if it can't be one. */
  clean(s) {
    const c = String(s || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(c) ? c : '';
  },
  format(c) { return String(c || '').replace(/(.{4})(?=.)/g, '$1-'); },
  async call(what, body) {
    let r;
    try { r = await fetch(Host.api('api/account/' + what), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new Error('Couldn\'t reach the game\'s server. Check your connection and try again.'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || `The server couldn't do that (${r.status}).`);
    return d;
  },
  /** This device's player now (pid and its key), as far as the server knows it. */
  me() { const pid = Presence.pid(); return pid ? { pid, key: Presence.key() } : {}; },
  /** A new code for you (any one you had before stops working). */
  async newCode() {
    if (this.signedOut()) throw new Error('This device is signed out. Type your code to play as yourself here.');
    const d = await this.call('code', this.me());
    try { localStorage.setItem('am.code', this.format(d.code)); localStorage.setItem('am.linked', '1'); } catch { /* private mode */ }
    Bus.emit('account:changed');
    return this.format(d.code);
  },
  /** Type a code: this device becomes that player. */
  async link(typed) {
    const c = this.clean(typed);
    if (!c) throw new Error('A code is 16 letters and numbers, like K7QM-3XRA-9DPZ-W2HF. Check it and try again.');
    const d = await this.call('link', { code: c, ...this.me() });
    try {
      localStorage.setItem('am.pid', d.pid); localStorage.setItem('am.key', d.key);
      localStorage.setItem('am.code', this.format(c)); localStorage.setItem('am.linked', '1');
      localStorage.removeItem('am.signedOut');
    } catch { /* private mode */ }
    Presence._pid = null; Presence._key = null;
    if (d.name && d.name !== ProfileManager.profile.name) await ProfileManager.setName(d.name);
    Toolbar.updateProfile();
    Presence.reconnect();
    Bus.emit('account:changed');
    UISounds.play('check-on');
    Toast.ok(d.name ? `Playing as ${d.name}` : 'Code accepted', d.merged ? 'What this device had online is part of you now — one player on the rankings.' : 'This device plays as you now.');
    return d;
  },
  /** Every device but this one stops playing as you (a code that got out: make a new one too). */
  async signOutOthers() {
    const d = await this.call('others', this.me());
    Toast.ok(d.n ? `Signed out ${plural(d.n, 'other device')}` : 'No other devices were signed in', 'Only this device plays as you now. Make a new code too if someone else may have yours.');
  },
  /** Stop playing as yourself on this device (a shared or school computer). */
  logout() {
    const me = this.me();
    if (me.pid) this.call('logout', me).catch(() => {}); // (its key is forgotten here either way)
    this.forget();
    Toast.show('Signed out on this device', 'Type your code to play as yourself here again.');
  },
  /** This device's key doesn't work any more (signed out from another device): signed out here. */
  expired() {
    this.forget();
    Toast.err('Signed out on this device', 'Another of your devices signed this one out. Type your code to play as yourself here again.');
  },
  forget() {
    try { ['am.pid', 'am.key', 'am.code', 'am.linked'].forEach(k => localStorage.removeItem(k)); localStorage.setItem('am.signedOut', '1'); } catch { /* private mode */ }
    Presence._pid = null; Presence._key = null;
    Presence.reconnect();
    Bus.emit('account:changed');
  },
  /** Signed out: start over as a new player here instead. */
  fresh() {
    try { localStorage.removeItem('am.signedOut'); } catch { /* private mode */ }
    Presence._pid = null; Presence._key = null;
    Presence.reconnect();
    Bus.emit('account:changed');
  },
};

/** The Your code panel: lazer's LoginOverlay look — a 360px panel under the right of the toolbar on Purple Background4 —
 *  with your code (hidden until you ask; Copy), New code and Sign out other devices; and Use a code, for this device. */
const CodePanel = {
  o: null,
  open(opts = {}) {
    if (this.o) { this.close(); return; }
    this.opts = opts;
    this.shown = false;
    this.panel = h('div.login-panel', { role: 'dialog', 'aria-label': 'Your code' });
    this.o = makeOverlay(this.panel, { onClose: () => { this.o = null; document.documentElement.classList.remove('lp-open'); } });
    this.o.el.classList.add('login-ov');
    document.documentElement.classList.add('lp-open');
    this.render();
  },
  close() { if (this.o) this.o.close(); },
  busy(btn, on) { btn.disabled = on; btn.classList.toggle('busy', on); },
  render() {
    const p = this.panel;
    clearEl(p);
    if (!Multiplayer.available()) { p.append(h('div.lp-title', 'YOUR CODE'), h('p.lp-note', 'Codes need the game\'s server. Play on the website, or set its address in Settings → Maintenance.')); return; }
    if (!Account.signedOut() && !this.opts.use) this.mine(p);
    this.use(p);
  },
  /** Your code: hidden until shown, Copy, New code, Sign out other devices — and this device's sign out. */
  mine(p) {
    const code = Account.code(), err = h('div.lp-err', { hidden: true });
    const fail = e => { err.hidden = false; err.textContent = friendlyError(e); };
    p.append(h('div.lp-title', 'YOUR CODE'));
    if (code) {
      const val = h('div.lp-code', { title: this.shown ? '' : 'Show it' }, this.shown ? code : code.replace(/[^-]/g, '•'));
      val.addEventListener('click', () => { if (!this.shown) { this.shown = true; this.render(); } });
      const copy = h('button.btn.sm', { onclick: async () => { try { await navigator.clipboard.writeText(code); Toast.ok('Code copied', 'Type or paste it on your other device.'); } catch { this.shown = true; this.render(); } } }, icon('copy'), 'Copy');
      p.append(h('div.lp-code-row', val, this.shown ? null : h('button.btn.sm', { onclick: () => { this.shown = true; this.render(); } }, icon('eye'), 'Show'), copy));
      p.append(h('p.lp-note', 'Type it on another device to play there as you: your scores, rank and friends. ', h('b', 'Keep it secret'), ' — anyone with it can play as you.'));
    } else {
      const get = h('button.btn.primary.lp-btn', icon('lock'), Account.linked() ? 'Make a new code' : 'Get my code');
      get.addEventListener('click', async () => { this.busy(get, true); try { await Account.newCode(); this.shown = true; this.render(); } catch (e) { fail(e); } finally { this.busy(get, false); } });
      p.append(h('p.lp-note', Account.linked()
        ? 'This device doesn\'t have your code to show. Making a new one replaces it (the old one stops working).'
        : 'A code lets you play as yourself on another device — your scores, rank and friends — with no username or password.'), get);
    }
    p.append(err);
    if (code) {
      const again = h('button.btn.lp-btn', icon('retry'), 'New code');
      again.addEventListener('click', async () => {
        if (!(await Dialog.confirm('Make a new code?', 'Your current code stops working. Devices already playing as you stay signed in — use Sign out other devices for those.', { ok: 'New code' }))) return;
        this.busy(again, true); try { await Account.newCode(); this.shown = true; this.render(); Toast.ok('New code made', 'Your old code doesn\'t work any more.'); } catch (e) { fail(e); } finally { this.busy(again, false); }
      });
      const others = h('button.btn.lp-btn', icon('user-times'), 'Sign out other devices');
      others.addEventListener('click', async () => {
        if (!(await Dialog.confirm('Sign out your other devices?', 'Only this device will play as you. On the others, typing your code brings them back.', { ok: 'Sign them out' }))) return;
        this.busy(others, true); try { await Account.signOutOthers(); } catch (e) { fail(e); } finally { this.busy(others, false); }
      });
      p.append(again, others);
    }
    if (Account.linked()) {
      const out = h('button.btn.lp-btn.danger', 'Sign out on this device');
      out.addEventListener('click', async () => {
        if (!(await Dialog.confirm('Sign out on this device?', 'It stops playing as you (good for a shared or school computer). Your beatmaps, scores and settings here stay. Make sure you have your code to come back.', { ok: 'Sign out' }))) return;
        this.close(); Account.logout();
      });
      p.append(out);
    }
  },
  /** Use a code: this device becomes the code's player. */
  use(p) {
    const inp = h('input.input.lp-in.lp-code-in', { placeholder: 'XXXX-XXXX-XXXX-XXXX', 'aria-label': 'Your code', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters', maxlength: 24 });
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') submit(); });
    // (tidied as it's typed: capitals, a dash every four)
    inp.addEventListener('input', () => { const raw = inp.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 16); const f = Account.format(raw); if (f !== inp.value) inp.value = f; err.hidden = true; });
    const err = h('div.lp-err', { hidden: true });
    const go = h('button.btn.primary.lp-btn', 'Use code');
    const submit = async () => {
      if (!inp.value.trim()) { inp.focus(); return; }
      this.busy(go, true); err.hidden = true;
      try { const d = await Account.link(inp.value); this.close(); this.opts.onDone && this.opts.onDone(d.name); }
      catch (e) { err.hidden = false; err.textContent = friendlyError(e); inp.select(); this.panel.classList.remove('shake'); void this.panel.offsetWidth; this.panel.classList.add('shake'); }
      finally { this.busy(go, false); }
    };
    go.addEventListener('click', submit);
    const signedOut = Account.signedOut();
    p.append(h('div.lp-title.lp-sep', signedOut || this.opts.use ? 'PLAY AS YOURSELF HERE' : 'USE A CODE ON THIS DEVICE'),
      h('p.lp-hint', signedOut ? 'This device is signed out. Type your code (from Your code on your other device) to play as yourself here.' : 'Got a code from your other device? Type it here and this device plays as you — what it has online now is added to you.'),
      inp, err, go,
      signedOut ? h('p.lp-note', 'Or ', h('button.lp-link', { onclick: () => { Account.fresh(); this.close(); Toast.show('Playing as a new player', 'Scores from this device go online as a new player.'); } }, 'start over as a new player'), ' on this device.') : null);
    if (signedOut || this.opts.use) setTimeout(() => inp.focus(), 60);
  },
};
