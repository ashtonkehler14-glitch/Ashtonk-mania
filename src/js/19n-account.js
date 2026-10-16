/* Accounts: osu!lazer's sign-in (its LoginOverlay, under the user button on the toolbar). An account is a username and
 * password on the game's server, and every device signed in to it is the same player — one entry on the rankings and
 * the beatmap boards, one profile and friends list. Without one you play as a guest of this browser, as before.
 * Signing in on a device that was playing as a guest moves that guest's scores, rank and friends into the account
 * (the server does it), so a save imported onto a second device doesn't put you on the leaderboards twice.
 * After Sign out a device has no online identity — it plays, chats and joins rooms, but sends no scores — until it
 * signs in again or goes back to being a guest. Beatmaps, scores and settings stay on each device (Export / Import data). */

const Account = {
  /** The username this device is signed in as ('' when it isn't). */
  name() { try { return localStorage.getItem('am.account') || ''; } catch { return ''; } },
  signedIn() { return !!this.name(); },
  /** Signed out (no online identity) rather than a guest. */
  signedOut() { try { return localStorage.getItem('am.signedOut') === '1'; } catch { return false; } },
  async call(what, body) {
    let r;
    try { r = await fetch(Host.api('api/account/' + what), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new Error('Couldn\'t reach the game\'s server. Check your connection and try again.'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || `The server couldn't do that (${r.status}).`);
    return d;
  },
  /** This device's guest, to go into the account (its key proves it's this device's). */
  guestId() { const pid = Presence.pid(); return pid && !this.signedIn() ? { pid, key: Presence.key() } : {}; },
  /** This device is the account's player now. */
  async become({ name, pid, key }) {
    try {
      if (pid) localStorage.setItem('am.pid', pid);
      if (key) localStorage.setItem('am.key', key);
      localStorage.setItem('am.account', name);
      localStorage.removeItem('am.signedOut');
    } catch { /* private mode */ }
    Presence._pid = null; Presence._key = null;
    if (ProfileManager.profile.name !== name) await ProfileManager.setName(name);
    Toolbar.updateProfile();
    Presence.reconnect();
    Bus.emit('account:changed');
  },
  async register(name, password) {
    const d = await this.call('register', { name, password, ...this.guestId() });
    await this.become(d);
    UISounds.play('check-on');
    Toast.ok(`Welcome, ${d.name}!`, 'Your account is ready. Sign in with it on your other devices to be the same player there.');
    return d;
  },
  async login(name, password) {
    const d = await this.call('login', { name, password, ...this.guestId() });
    await this.become(d);
    UISounds.play('check-on');
    Toast.ok(`Signed in as ${d.name}`, d.merged ? 'What this device had online as a guest is part of your account now — one player on the rankings.' : 'This device plays as your account now.');
    return d;
  },
  async logout() {
    const pid = Presence.pid(), key = Presence.key();
    if (pid) this.call('logout', { pid, key }).catch(() => {}); // (the key's forgotten here either way)
    this.forget();
    Toast.show('Signed out', 'Scores from this device don\'t go online until you sign in again.');
  },
  /** The account's key stopped working here (it was signed out on the server): signed out. */
  expired() {
    this.forget();
    Toast.err('You were signed out', 'Sign in again (your name in the top bar) to send scores from this device.');
  },
  forget() {
    try { ['am.account', 'am.pid', 'am.key'].forEach(k => localStorage.removeItem(k)); localStorage.setItem('am.signedOut', '1'); } catch { /* private mode */ }
    Presence._pid = null; Presence._key = null;
    Toolbar.updateProfile();
    Presence.reconnect();
    Bus.emit('account:changed');
  },
  /** Back to playing as a guest of this browser. */
  guest() {
    try { localStorage.removeItem('am.signedOut'); } catch { /* private mode */ }
    Presence._pid = null; Presence._key = null;
    Toolbar.updateProfile();
    Presence.reconnect();
    Bus.emit('account:changed');
  },
  /** Your name: an account's is changed on the server (it has to stay unique), a guest's only here. */
  async setName(n) {
    n = String(n || '').trim();
    if (!n) return;
    if (!this.signedIn()) { await ProfileManager.setName(n); Toolbar.updateProfile(); return; }
    try {
      const d = await this.call('rename', { pid: Presence.pid(), key: Presence.key(), name: n });
      try { localStorage.setItem('am.account', d.name); } catch { /* private mode */ }
      await ProfileManager.setName(d.name);
      Toolbar.updateProfile();
      Bus.emit('account:changed');
    } catch (e) { Toast.err('Couldn\'t change your username', friendlyError(e)); }
  },
  /** On every start: a signed-in device keeps the account's name (an imported save can bring another one along). */
  init() {
    const n = this.name();
    if (n && ProfileManager.profile.name !== n) ProfileManager.setName(n).then(() => Toolbar.updateProfile()).catch(() => {});
  },
};

/** lazer's LoginOverlay: a 360px panel under the right of the toolbar (Purple Background4) — ACCOUNT, username,
 *  password and Sign in, then Register; signed in, the player and Sign out. Account creation (lazer's own overlay)
 *  is the same panel's second page, with lazer's words under each field. */
const LoginPanel = {
  o: null, page: 'signin',
  open(opts = {}) {
    if (this.o) { this.close(); return; }
    this.opts = opts;
    this.page = opts.page || 'signin';
    this.panel = h('div.login-panel', { role: 'dialog', 'aria-label': 'Account' });
    this.o = makeOverlay(this.panel, { onClose: () => { this.o = null; document.documentElement.classList.remove('lp-open'); } });
    this.o.el.classList.add('login-ov');
    document.documentElement.classList.add('lp-open');
    this.render();
  },
  close() { if (this.o) this.o.close(); },
  render() {
    const p = this.panel;
    clearEl(p);
    if (!Multiplayer.available()) { p.append(h('div.lp-title', 'ACCOUNT'), h('p.lp-note', 'Accounts need the game\'s server. Play on the website, or set its address in Settings → Maintenance.')); return; }
    if (Account.signedIn()) { this.signedIn(p); return; }
    if (this.page === 'register') { this.register(p); return; }
    this.signIn(p);
  },
  field(placeholder, type, autocomplete) {
    const inp = h('input.input.lp-in', { type, placeholder, autocomplete, spellcheck: 'false', autocapitalize: 'off', maxlength: type === 'password' ? 200 : 15, 'aria-label': placeholder });
    inp.addEventListener('keydown', e => e.stopPropagation());
    return inp;
  },
  busy(btn, on) { btn.disabled = on; btn.classList.toggle('busy', on); },
  signIn(p) {
    const user = this.field('username', 'text', 'username'), pass = this.field('password', 'password', 'current-password');
    const err = h('div.lp-err', { hidden: true });
    const go = h('button.btn.primary.lp-btn', 'Sign in');
    const submit = async () => {
      if (!user.value.trim() || !pass.value) { err.hidden = false; err.textContent = 'Type your username and password.'; (user.value.trim() ? pass : user).focus(); return; }
      this.busy(go, true); err.hidden = true;
      try { const d = await Account.login(user.value, pass.value); this.close(); this.opts.onDone && this.opts.onDone(d.name); }
      catch (e) { err.hidden = false; err.textContent = friendlyError(e); pass.select(); this.panel.classList.remove('shake'); void this.panel.offsetWidth; this.panel.classList.add('shake'); }
      finally { this.busy(go, false); }
    };
    go.addEventListener('click', submit);
    pass.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    user.addEventListener('keydown', e => { if (e.key === 'Enter') pass.focus(); });
    p.append(h('div.lp-title', 'ACCOUNT'), user, pass, err, go,
      h('button.btn.lp-btn', { onclick: () => { UISounds.click(); this.page = 'register'; this.render(); } }, 'Create an account'),
      Account.signedOut()
        ? h('p.lp-note', 'Signed out: scores from this device don\'t go online. ', h('button.lp-link', { onclick: () => { Account.guest(); this.close(); Toast.show('Playing as a guest', 'Scores from this device go online as a guest of this browser.'); } }, 'Play as a guest instead'))
        : h('p.lp-note', 'You\'re playing as a guest of this browser. Sign in to be the same player on every device — what you have here as a guest comes with you.'));
    setTimeout(() => user.focus(), 60);
  },
  register(p) {
    const user = this.field('username', 'text', 'username'), pass = this.field('password', 'password', 'new-password');
    user.value = Account.signedOut() ? '' : (ProfileManager.profile.name || '').slice(0, 15);
    const err = h('div.lp-err', { hidden: true });
    const go = h('button.btn.primary.lp-btn', 'Create account');
    const submit = async () => {
      this.busy(go, true); err.hidden = true;
      try { const d = await Account.register(user.value, pass.value); this.close(); this.opts.onDone && this.opts.onDone(d.name); }
      catch (e) { err.hidden = false; err.textContent = friendlyError(e); }
      finally { this.busy(go, false); }
    };
    go.addEventListener('click', submit);
    pass.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    user.addEventListener('keydown', e => { if (e.key === 'Enter') pass.focus(); });
    // (lazer's account creation, without the email: what each field is for, in its words)
    p.append(h('div.lp-title', 'CREATE AN ACCOUNT'),
      user, h('p.lp-hint', 'This will be your public presence. No profanity, no impersonation. Avoid exposing your own personal details, too! (3 to 15 letters, numbers or spaces.)'),
      pass, h('p.lp-hint', 'At least 8 characters long. Choose something long but also something you will remember, like a line from your favourite song. There\'s no way to get it back if you forget it.'),
      err, go,
      h('button.btn.lp-btn', { onclick: () => { UISounds.back(); this.page = 'signin'; this.render(); } }, 'I have an account'),
      Account.signedOut() ? null : h('p.lp-note', 'Your scores, rank and friends as a guest on this device become the account\'s.'));
    setTimeout(() => (user.value ? pass : user).focus(), 60);
  },
  signedIn(p) {
    const out = h('button.btn.lp-btn.danger', 'Sign out');
    out.addEventListener('click', async () => {
      if (!(await Dialog.confirm('Sign out?', 'Scores from this device won\'t go online until you sign in again. Your beatmaps, scores and settings here stay.', { ok: 'Sign out' }))) return;
      this.close(); Account.logout();
    });
    p.append(h('div.lp-title', 'SIGNED IN'),
      h('button.lp-user', { onclick: () => { this.close(); Screens.go('profile'); } }, ProfileManager.avatarEl(48), h('span.lp-user-t', h('b', Account.name()), h('small', 'View profile'))),
      h('p.lp-note', 'Every device signed in to this account is the same player. Beatmaps and settings stay on each device — move them with Settings → Maintenance → Export / Import data.'),
      out);
  },
};
