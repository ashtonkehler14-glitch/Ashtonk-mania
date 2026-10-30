/* The game's side of running the server: admins' announcements as banners across the top of the game, reporting a
 * player, and — for the owner and the admins they made — moderating straight from the game (a player's ⋯ menu, a
 * chat line), without opening the admin panel. The server checks every admin action again (who's asking, and what
 * they may do); the game only offers what an admin can. */

/** The server's announcements: an admin's message for everyone online — and whoever comes online while it's up — as
 *  a banner under the toolbar, in its style (news, a warning, an event, maintenance with a countdown to it). One
 *  closed stays closed on this device; one marked "pop-up" also opens as a notice to close, once. Never over a song. */
const Announcements = {
  list: [], el: null, _tick: 0,
  KEY: 'am.annClosed',
  STYLE: { info: ['info', 'Announcement'], warn: ['warn', 'Important'], event: ['star', 'Event'], maint: ['gear', 'Maintenance'] },
  closed() { try { return new Set(JSON.parse(localStorage.getItem(this.KEY) || '[]')); } catch { return new Set(); } },
  remember(id) { const c = this.closed(); c.add(id); try { localStorage.setItem(this.KEY, JSON.stringify([...c].slice(-60))); } catch { /* private mode */ } },
  close(id) { this.remember(id); this.paint(); },
  set(list) {
    this.list = (Array.isArray(list) ? list : []).filter(a => a && a.id && a.text).slice(0, 5);
    this.paint();
    // (a pop-up one: a notice to read and close, once — then its banner stays until closed too)
    const seen = this.closed();
    for (const a of this.list) if (a.popup && !seen.has('p' + a.id)) {
      this.remember('p' + a.id);
      const [ic, label] = this.STYLE[a.kind] || this.STYLE.info;
      Dialog.popup(a.title || label, this.body(a), [{ label: 'OK', colour: '#66ccff', cls: 'cancel', cancel: true }], { icon: ic });
    }
  },
  body(a) { return h('div.ann-pop', String(a.text), a.at > Date.now() ? h('p.ann-when', this.countdown(a.at)) : null); },
  /** "in 4:59" to a maintenance time, "now" once it's come. */
  countdown(at) {
    const s = Math.max(0, Math.round((at - Date.now()) / 1000));
    if (!s) return 'Starting now';
    const m = Math.floor(s / 60), hr = Math.floor(m / 60);
    return `In ${hr ? `${hr}h ${String(m % 60).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`}`;
  },
  paint() {
    const app = document.getElementById('app');
    if (!app) return;
    if (!this.el || !this.el.isConnected) { this.el = h('div.ann-stack', { 'aria-live': 'polite' }); app.append(this.el); }
    // (the chip sits in the toolbar's free middle, between the ruleset and the buttons on the right — never over them)
    if (!this.chip) this.chip = h('button.ann-chip', { onclick: () => { UISounds.click(); this.showAll(); } });
    const host = document.querySelector('#toolbar .tb-spacer') || app;
    if (this.chip.parentNode !== host) host.append(this.chip);
    if (!this._scr) this._scr = Bus.on('screen:changed', () => this.paint());
    const shut = this.closed(), now = Date.now();
    const show = this.list.filter(a => !shut.has(a.id) && (!a.until || a.until > now));
    // the main menu has room for them in full (on a phone on its side, for one: more would run into the logo); anywhere
    // else they'd cover the screen's own top (song select's search, a room's header), so they're a chip in the middle
    // of the toolbar instead — a click shows them all
    const full = (typeof Screens === 'undefined' || Screens.currentName === 'home') && (show.length < 2 || !matchMedia('(max-height: 520px)').matches);
    clearEl(this.el).append(...(full ? show : []).map(a => {
      const [ic, label] = this.STYLE[a.kind] || this.STYLE.info;
      return h(`div.ann.${this.STYLE[a.kind] ? a.kind : 'info'}`, { role: 'status' },
        h('span.ann-ic', icon(ic)),
        h('div.ann-main', h('b.ann-t', a.title || label), h('span.ann-x', String(a.text)), a.at > now ? h('span.ann-cd', { dataset: { at: a.at } }, this.countdown(a.at)) : null),
        h('button.ann-close', { title: 'Close', 'aria-label': 'Close the announcement', onclick: () => { UISounds.click(); this.close(a.id); } }, icon('x')));
    }));
    // (the chip: the one that matters most — maintenance, then a warning, an event, news — and how many more)
    const RANK = { maint: 0, warn: 1, event: 2, info: 3 }, top = [...show].sort((x, y) => (RANK[x.kind] ?? 3) - (RANK[y.kind] ?? 3))[0];
    this.chip.hidden = full || !top;
    if (top) {
      const [ic, label] = this.STYLE[top.kind] || this.STYLE.info;
      this.chip.className = `ann-chip ${this.STYLE[top.kind] ? top.kind : 'info'}`;
      this.chip.title = show.map(a => `${a.title || (this.STYLE[a.kind] || this.STYLE.info)[1]}: ${a.text}`).join('\n');
      clearEl(this.chip).append(h('span.ann-ic', icon(ic)), h('span.ann-chip-t', top.title || label),
        top.at > now ? h('span.ann-cd', { dataset: { at: top.at } }, this.countdown(top.at)) : null, show.length > 1 ? h('span.ann-more', `+${show.length - 1}`) : null);
    }
    // (a countdown ticks while one's on screen)
    clearInterval(this._tick);
    if (show.some(a => a.at > now)) this._tick = setInterval(() => {
      for (const c of [...this.el.querySelectorAll('.ann-cd'), ...this.chip.querySelectorAll('.ann-cd')]) c.textContent = this.countdown(+c.dataset.at);
      if (show.every(a => !(a.at > Date.now() - 60000))) clearInterval(this._tick);
    }, 1000);
    // (one that's run out goes on its own)
    clearTimeout(this._end);
    const next = Math.min(...show.filter(a => a.until).map(a => a.until));
    if (Number.isFinite(next)) this._end = setTimeout(() => this.paint(), Math.min(2 ** 31 - 1, Math.max(1000, next - now + 500)));
  },
  /** Every announcement up, in one notice (the toolbar chip's click); "Close all" closes them here. */
  showAll() {
    const shut = this.closed(), now = Date.now(), show = this.list.filter(a => !shut.has(a.id) && (!a.until || a.until > now));
    if (!show.length) return;
    const body = h('div.ann-list', ...show.map(a => {
      const [ic, label] = this.STYLE[a.kind] || this.STYLE.info;
      return h(`div.ann.${this.STYLE[a.kind] ? a.kind : 'info'}`, h('span.ann-ic', icon(ic)), h('div.ann-main', h('b.ann-t', a.title || label), h('span.ann-x', String(a.text)), a.at > now ? h('span.ann-cd', this.countdown(a.at)) : null));
    }));
    Dialog.popup(show.length === 1 ? 'Announcement' : 'Announcements', body, [
      { label: 'OK', colour: '#66ccff', cls: 'cancel', cancel: true },
      { label: 'Close all', colour: '#ff66aa', onClick: () => { for (const a of show) this.remember(a.id); this.paint(); } },
    ], { icon: 'bell' });
  },
};

/** Reporting a player to the admins: why (from a short list) and, if you like, a few words. The server keeps it for
 *  the admins, with the player's last lines in #lobby. */
const Report = {
  REASONS: [['cheating', 'Cheating', 'impossible scores, a bot'], ['chat', 'Chat', 'abuse, spam, harassment'], ['name', 'Name or picture', 'offensive or inappropriate'], ['other', 'Something else', '']],
  open(u) {
    if (!u || !u.pid) return;
    if (!(Presence.ws && Presence.ws.readyState === 1)) { Toast.err('Can\'t report right now', 'You\'re not connected to the online service.'); return; }
    let reason = 'cheating';
    const text = h('textarea.input.rep-text', { maxlength: 300, rows: 3, placeholder: 'What happened? (optional)' });
    text.addEventListener('keydown', typingKeys);
    const opts = h('div.rep-opts', ...this.REASONS.map(([k, l, sub]) => h(`button.rep-opt${k === reason ? '.on' : ''}`, { type: 'button', onclick: e => {
      UISounds.click(); reason = k; for (const b of opts.children) b.classList.toggle('on', b === e.currentTarget);
    } }, h('b', l), sub ? h('small', sub) : null)));
    const body = h('div.rep', h('p.rep-who', 'Report ', h('b', u.name || 'this player'), ' to the game\'s admins.'), opts, text,
      h('p.rep-note', 'Only the admins see reports. Reporting someone who did nothing wrong can get you muted.'));
    Dialog.custom('Report a player', body, [
      { label: 'Cancel' },
      { label: 'Send report', danger: true, onClick: () => { Presence.send({ t: 'report', pid: u.pid, reason, text: text.value.trim().slice(0, 300) }); } },
    ]);
    setTimeout(() => text.focus({ preventScroll: true }), 50);
  },
};

/** Moderating from the game, for the owner and the admins they made: what their ⋯ menus offer, sent to the server as
 *  the admin panel's own actions (checked there again). */
const Staff = {
  _req: 0, _wait: new Map(),
  on() { return !!(typeof Presence !== 'undefined' && Presence.isAdmin); },
  /** An admin action through the online service: resolves with the server's answer ({ ok } or { error }). */
  act(action, body = {}) {
    return new Promise(resolve => {
      const req = ++this._req;
      if (!(Presence.ws && Presence.ws.readyState === 1)) { resolve({ error: 'You\'re not connected to the online service.' }); return; }
      Presence.send({ t: 'staff', action, req, ...body });
      const t = setTimeout(() => { this._wait.delete(req); resolve({ error: 'The server didn\'t answer.' }); }, 15000);
      this._wait.set(req, r => { clearTimeout(t); resolve(r); });
    });
  },
  async run(action, body, ok) {
    const r = await this.act(action, body);
    if (r && r.ok) { if (ok) Toast.ok(ok); } else Toast.err('Couldn\'t do that', (r && r.error) || 'Something went wrong.');
    return r && r.ok;
  },
  /** Messages for this module from the server. */
  msg(m) {
    if (m.t === 'anns') Announcements.set(m.list);
    else if (m.t === 'staffDone') { const f = this._wait.get(m.req); if (f) { this._wait.delete(m.req); f(m); } }
    else if (m.t === 'reported') { if (m.ok) Toast.ok('Report sent', 'Thanks — the admins will look into it.'); else Toast.err('Report not sent', m.error || ''); }
    // (to an admin: a player was just reported — and how many reports are waiting)
    else if (m.t === 'staffReport') {
      this.open = m.open || 0; Bus.emit('staff:reports'); if (typeof Toolbar !== 'undefined') Toolbar.updateProfile();
      if (m.report) Toast.show(`New report: ${m.report.name}`, `${m.report.reason}${m.report.text ? ` — “${m.report.text}”` : ''} (by ${m.report.by}). ${this.open} waiting in the admin panel.`, { timeout: 12000 });
    }
  },
  panelURL(hash = '') { return (Host.standalone ? new URL('admin', Host.server()).href : '/admin') + (hash ? '#' + hash : ''); },
  openPanel(hash) { window.open(this.panelURL(hash), '_blank', 'noopener'); },
  /** The admin's items for a player's ⋯ menu (none for yourself, nor — unless you're the owner — another admin). */
  menuItems(u) {
    if (!this.on() || !u || !u.pid || u.pid === Presence.pid()) return [];
    const role = u.role || roleOfPid(u.pid);
    if (role && !(Presence.role && Presence.role.owner)) return [];
    const name = u.name || 'them';
    return [{ sep: true }, { header: 'Admin' }, ...[
      { label: 'Send a message…', icon: 'envelope', onClick: () => this.warn(u) },
      { label: 'Mute for 10 minutes', icon: 'mute', onClick: () => this.run('mute', { pid: u.pid, minutes: 10, reason: '' }, `${name} muted for 10 minutes`) },
      { label: 'Mute for a day', icon: 'mute', onClick: () => this.run('mute', { pid: u.pid, minutes: 1440, reason: '' }, `${name} muted for a day`) },
      { label: 'Unmute', icon: 'volume', onClick: () => this.run('unmute', { pid: u.pid }, `${name} unmuted`) },
      { label: 'Ban…', icon: 'user-times', danger: true, onClick: () => this.ban(u) },
      { label: 'Open in the admin panel', icon: 'cog', onClick: () => this.openPanel('players/' + encodeURIComponent(u.pid)) }].map(it => ({ ...it, staff: true }))];
  },
  async warn(u) {
    const text = await this.ask(`Message ${u.name || 'them'}`, 'They see it as a notice they have to close.', 'Send');
    if (text) this.run('warn', { pid: u.pid, text }, 'Message sent');
  },
  /** A text to send, in a dialog of its own (longer than Dialog.prompt takes). */
  ask(title, note, ok) {
    return new Promise(resolve => {
      let out = null;
      const ta = h('textarea.input.rep-text', { maxlength: 300, rows: 3 });
      ta.addEventListener('keydown', typingKeys);
      Dialog.custom(title, h('div.rep', note ? h('p.rep-note', note) : null, ta), [{ label: 'Cancel' }, { label: ok, primary: true, onClick: () => { out = ta.value.trim(); } }], { onClose: () => resolve(out) });
      setTimeout(() => ta.focus({ preventScroll: true }), 50);
    });
  },
  ban(u) {
    let days = 1;
    const reason = h('input.input', { maxlength: 200, placeholder: 'Reason (they see it)' });
    reason.addEventListener('keydown', typingKeys);
    const opts = h('div.rep-opts.rep-days', ...[[1 / 24, '1 hour'], [1, '1 day'], [7, '7 days'], [30, '30 days'], [0, 'For good']].map(([d, l]) => h(`button.rep-opt${d === days ? '.on' : ''}`, { type: 'button', onclick: e => {
      UISounds.click(); days = d; for (const b of opts.children) b.classList.toggle('on', b === e.currentTarget);
    } }, h('b', l))));
    Dialog.custom(`Ban ${u.name || 'this player'}`, h('div.rep', h('p.rep-note', 'Taken offline now and kept offline. For good: their account is removed, scores and all.'), opts, reason), [
      { label: 'Cancel' },
      { label: 'Ban', danger: true, onClick: () => this.run('ban', { pid: u.pid, days, reason: reason.value.trim() }, `${u.name || 'They'} ${days ? 'banned' : 'banned for good'}`) },
    ]);
  },
  /** #lobby's rules from the game (toolbar menu → #lobby rules…): slow mode and the lock, as the admin panel has them
   *  (the blocked words are the panel's). */
  async chatRules() {
    const r = await this.act('chatRules', {});
    if (!r || !r.ok) { Toast.err('Couldn\'t read #lobby\'s rules', (r && r.error) || ''); return; }
    const cur = r.rules || { slow: 0, locked: false };
    let slow = cur.slow, locked = cur.locked;
    const seg = (list, v0, set) => { const el = h('div.rep-opts.rep-days', ...list.map(([v, l]) => h(`button.rep-opt${v === v0 ? '.on' : ''}`, { type: 'button', onclick: e => { UISounds.click(); set(v); for (const b of el.children) b.classList.toggle('on', b === e.currentTarget); } }, h('b', l)))); return el; };
    Dialog.custom('#lobby rules', h('div.rep',
      h('p.rep-note', 'Slow mode: how long each player waits between messages (admins don\'t).'),
      seg([[0, 'Off'], [5, '5s'], [15, '15s'], [30, '30s'], [60, '1 min'], [300, '5 min']], slow, v => { slow = v; }),
      h('p.rep-note', 'Locked: only admins can talk in #lobby.'),
      seg([[false, 'Open'], [true, 'Locked']], locked, v => { locked = v; })), [
      { label: 'Cancel' },
      { label: 'Save', primary: true, onClick: () => { if (slow !== cur.slow || locked !== cur.locked) this.run('chatRules', { set: { slow, locked } }, '#lobby rules saved'); } },
    ]);
  },
  /** An announcement from the game (toolbar menu → Announce…): its text, style and how long it stays up. */
  announce() {
    let kind = 'info', hours = 1;
    const title = h('input.input', { maxlength: 60, placeholder: 'Title (optional)' });
    const text = h('textarea.input.rep-text', { maxlength: 300, rows: 3, placeholder: 'The message, for everyone online' });
    for (const x of [title, text]) x.addEventListener('keydown', typingKeys);
    const seg = (list, cur, set) => { const el = h('div.rep-opts.rep-days', ...list.map(([v, l]) => h(`button.rep-opt${v === cur ? '.on' : ''}`, { type: 'button', onclick: e => { UISounds.click(); set(v); for (const b of el.children) b.classList.toggle('on', b === e.currentTarget); } }, h('b', l)))); return el; };
    const popup = h('input', { type: 'checkbox' });
    Dialog.custom('Announce', h('div.rep',
      seg([['info', 'News'], ['warn', 'Important'], ['event', 'Event'], ['maint', 'Maintenance']], kind, v => { kind = v; }),
      title, text,
      h('p.rep-note', 'Stays up for'), seg([[0, 'Just now'], [1, '1 hour'], [6, '6 hours'], [24, '1 day'], [168, '7 days']], hours, v => { hours = v; }),
      h('label.rep-check', popup, 'Also as a pop-up everyone has to close')), [
      { label: 'Cancel' },
      { label: 'Announce', primary: true, onClick: () => { if (text.value.trim()) this.run('announce', { text: text.value.trim(), title: title.value.trim(), kind, hours, popup: popup.checked, lobby: true }, 'Announced'); } },
    ]);
    setTimeout(() => text.focus({ preventScroll: true }), 50);
  },
};
