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
  /** A code box tidies what's typed into it: capitals, a dash every four. */
  tidyInput(inp, onInput) {
    inp.addEventListener('input', () => { const f = this.format(inp.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 16)); if (f !== inp.value) inp.value = f; onInput && onInput(); });
  },
  /** Where Your code is, said for this device (a phone has no right-click). */
  where() { return Mobile.touch ? 'press and hold your name in the top bar → Your code' : 'right-click your name in the top bar → Your code'; },
  async call(what, body) {
    let r;
    try { r = await fetch(Host.api('api/account/' + what), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new Error('Couldn\'t reach the game\'s server. Check your connection and try again.'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw Object.assign(new Error(d.error || `The server couldn't do that (${r.status}).`), { status: r.status });
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
      localStorage.setItem('am.restore', '1'); // (your settings and skin to come: Sync.restore)
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
    this.askAgain();
  },
  /** Signed out: back to the setup's first question — have you played before? (your code, or start fresh). Not over a
   *  song: once it's over. */
  askAgain() {
    if (typeof Onboarding === 'undefined') return;
    if (Screens.currentName !== 'gameplay') { setTimeout(() => Onboarding.run({ account: true }), 250); return; }
    const off = Bus.on('screen:changed', () => { if (Screens.currentName === 'gameplay') return; off(); setTimeout(() => Onboarding.run({ account: true }), 400); });
  },
  /** This device's key doesn't work any more (signed out from another device): signed out here. */
  expired() {
    this.forget();
    Toast.err('Signed out on this device', 'Another of your devices signed this one out. Type your code to play as yourself here again.');
    this.askAgain();
  },
  forget() {
    try { ['am.pid', 'am.key', 'am.code', 'am.linked', 'am.restore'].forEach(k => localStorage.removeItem(k)); localStorage.setItem('am.signedOut', '1'); } catch { /* private mode */ }
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

/** The Your code panel: lazer's LoginOverlay look — a 360px panel under the right of the toolbar on Purple Background4.
 *  Two tabs, one thing each: My code (the code, hidden until tapped, with Copy — and, small underneath, New code and
 *  signing devices out) and Use a code (type one in). Signed out, only Use a code. */
const CodePanel = {
  o: null, tab: 'mine',
  open(opts = {}) {
    if (this.o) { this.close(); return; }
    this.opts = opts;
    this.shown = false;
    this.tab = opts.use || Account.signedOut() ? 'use' : 'mine';
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
    if (Account.signedOut()) { p.append(h('div.lp-title', 'PLAY AS YOURSELF HERE')); this.use(p); return; }
    const tab = (id, label) => h(`button.lp-tab${this.tab === id ? '.on' : ''}`, { onclick: () => { if (this.tab === id) return; UISounds.click(); this.tab = id; this.render(); } }, label);
    p.append(h('div.lp-tabs', tab('mine', 'My code'), tab('use', 'Use a code')));
    if (this.tab === 'mine') this.mine(p); else this.use(p);
  },
  /** My code: the code (tap to show), Copy; New code and signing out as small links. */
  mine(p) {
    const code = Account.code(), err = h('div.lp-err', { hidden: true });
    const fail = e => { err.hidden = false; err.textContent = friendlyError(e); };
    if (!code) {
      const get = h('button.btn.primary.lp-btn', icon('lock'), Account.linked() ? 'Make a new code' : 'Get my code');
      get.addEventListener('click', async () => { this.busy(get, true); try { await Account.newCode(); this.shown = true; this.render(); } catch (e) { fail(e); } finally { this.busy(get, false); } });
      p.append(h('p.lp-lead', Account.linked() ? 'This device doesn\'t have your code to show. A new one replaces it.' : 'Get a code to play as yourself on another device — your scores, rank, friends, settings and skin.'), get, err);
      return;
    }
    const val = h('div.lp-code', this.shown ? code : code.replace(/[^-]/g, '•'));
    const box = h(`button.lp-codebox${this.shown ? '' : '.hidden'}`, { 'aria-label': this.shown ? 'Your code' : 'Show your code', onclick: () => { if (!this.shown) { UISounds.click(); this.shown = true; this.render(); } } },
      val, this.shown ? null : h('span.lp-tap', Mobile.touch ? 'tap to show' : 'click to show'));
    const copy = h('button.lp-copy', { title: 'Copy', 'aria-label': 'Copy your code', onclick: async () => {
      try { await navigator.clipboard.writeText(code); UISounds.click(); Toast.ok('Code copied', 'Type or paste it on your other device.'); }
      catch { this.shown = true; this.render(); } // (no clipboard here: shown, to copy by hand)
    } }, icon('copy'));
    p.append(h('div.lp-code-row', box, copy), h('p.lp-lead', 'Type it on your other device to play there as you. ', h('b', 'Keep it secret.')), err);
    // (the rarely needed: small, under it)
    const act = (label, fn, cls = '') => h(`button.lp-act${cls}`, { onclick: fn }, label);
    p.append(h('div.lp-acts',
      act('New code', async () => {
        if (!(await Dialog.confirm('Make a new code?', 'Your current code stops working. Devices already playing as you stay — sign them out too if someone else may have it.', { ok: 'New code' }))) return;
        try { await Account.newCode(); this.shown = true; this.render(); Toast.ok('New code made', 'Your old code doesn\'t work any more.'); } catch (e) { fail(e); }
      }),
      act('Sign out other devices', async () => {
        if (!(await Dialog.confirm('Sign out your other devices?', 'Only this device will play as you. Typing your code brings the others back.', { ok: 'Sign them out' }))) return;
        try { await Account.signOutOthers(); } catch (e) { fail(e); }
      }),
      Account.linked() ? act('Sign out here', async () => {
        if (!(await Dialog.confirm('Sign out on this device?', 'It stops playing as you (good for a shared or school computer). Your beatmaps, scores and settings stay. Keep your code to come back.', { ok: 'Sign out' }))) return;
        this.close(); Account.logout();
      }, '.danger') : null));
  },
  /** Use a code: this device becomes the code's player. */
  use(p) {
    const inp = h('input.input.lp-in.lp-code-in', { placeholder: 'XXXX-XXXX-XXXX-XXXX', 'aria-label': 'Code', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters', maxlength: 24 });
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') submit(); });
    // (tidied as it's typed: capitals, a dash every four)
    Account.tidyInput(inp, () => { err.hidden = true; });
    const err = h('div.lp-err', { hidden: true });
    const go = h('button.btn.primary.lp-btn', 'Use code');
    const submit = async () => {
      if (!inp.value.trim()) { inp.focus(); return; }
      this.busy(go, true); err.hidden = true;
      try { const d = await Account.link(inp.value); this.close(); this.opts.onDone && this.opts.onDone(d.name); Sync.restoreToast(); }
      catch (e) { err.hidden = false; err.textContent = friendlyError(e); inp.select(); this.panel.classList.remove('shake'); void this.panel.offsetWidth; this.panel.classList.add('shake'); }
      finally { this.busy(go, false); }
    };
    go.addEventListener('click', submit);
    const signedOut = Account.signedOut();
    p.append(h('p.lp-lead', signedOut ? 'Type your code from your other device.' : 'Type the code from your other device to play as you here.', ' Your settings and skin come along.'), inp, err, go,
      signedOut ? h('div.lp-acts', h('button.lp-act', { onclick: () => { Account.fresh(); this.close(); Toast.show('Playing as a new player', 'Scores from this device go online as a new player.'); } }, 'Start over as a new player instead')) : null);
    setTimeout(() => inp.isConnected && inp.focus(), 60);
  },
};
