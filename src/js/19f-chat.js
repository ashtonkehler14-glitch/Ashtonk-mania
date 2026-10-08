/* osu!lazer's ChatOverlay (Pink colour scheme): slides up from the bottom of the screen, 40% tall by default and
 * resizable by dragging its top bar. The channel list on the left (190px: CHANNELS — #lobby, everyone online — then
 * DIRECT MESSAGES with friends), the chat lines (time, the name in its colour right-aligned in 150px, the message),
 * and the text bar along the bottom ("talking in #lobby"). F8 or the toolbar's chat button toggles it. */

const Chat = {
  channels: new Map([['#lobby', { key: '#lobby', name: '#lobby', pm: false, lines: [], unread: 0 }]]),
  cur: '#lobby', o: null,
  // lazer's ChatLine.default_username_colours (picked by user id; here by a hash of the public id or name)
  COLOURS: ['588c7e', 'b2a367', 'c98f65', 'bc5151', '5c8bd6', '7f6ab7', 'a368ad', 'aa6880', '6fad9b', 'f2e394', 'f2ae72', 'f98f8a', '7daef4', 'a691f2', 'c894d3', 'd895b0', '53c4a1', 'eace5c', 'ea8c47', 'fc4f4f', '3d94ea', '7760ea', 'af52c6', 'e25696', '677c66', '9b8732', '8c5129', '8c3030', '1f5d91', '4335a5', '812a96', '992861'],
  colour(from) { const k = String(from.pid || from.name || ''); let n = 0; for (let i = 0; i < k.length; i++) n = (n * 31 + k.charCodeAt(i)) >>> 0; return '#' + this.COLOURS[n % this.COLOURS.length]; },
  get unread() { let n = 0; for (const c of this.channels.values()) n += c.unread; return n; },

  /** From the presence server. */
  on(m) {
    if (m.t === 'chatHist') {
      // merged with what we already have, never swapped for it: a reconnect (or the server having restarted, with
      // less or nothing to send) used to wipe the chat
      const lobby = this.channels.get('#lobby');
      const sig = l => `${l.at}|${(l.from && (l.from.pid || l.from.name)) || ''}|${l.text}`;
      const all = new Map();
      for (const l of [...lobby.lines, ...(Array.isArray(m.list) ? m.list : [])]) if (l && l.text) all.set(sig(l), l);
      lobby.lines = [...all.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-200);
      this.save();
      this.paint();
      return;
    }
    if (m.t === 'say') {
      this.add('#lobby', m);
      // lazer's MentionNotification: your name in #lobby while you're not looking at it (not in Do not disturb)
      if (this.mentions(m.text) && !(m.from && m.from.pid === Presence.pid()) && !(this.o && this.cur === '#lobby') && Settings.get('online.status') !== 'dnd' && Screens.currentName !== 'gameplay')
        Toast.show(`${m.from.name} mentioned you in #lobby`, m.text.length > 80 ? m.text.slice(0, 80) + '…' : m.text, { onClick: () => this.open('#lobby') });
    }
    else if (m.t === 'pm' && m.with && m.with.pid) {
      const key = 'pm:' + m.with.pid;
      if (!this.channels.has(key)) this.channels.set(key, { key, name: m.with.name, pid: m.with.pid, pm: true, lines: [], unread: 0 });
      else this.channels.get(key).name = m.with.name;
      this.add(key, m);
      // lazer: a private message while you're not looking at it is a notification that opens the conversation
      if (!m.mine && !(this.o && this.cur === key)) {
        Toast.show(`${m.from.name} sent you a message`, m.text.length > 80 ? m.text.slice(0, 80) + '…' : m.text, { onClick: () => this.open(key) });
      }
    }
  },
  /** The chat is kept in this browser too (#lobby and your conversations), so a reload or a dropped connection
   *  doesn't empty it. */
  save() {
    clearTimeout(this._sv);
    this._sv = setTimeout(() => {
      try { localStorage.setItem('am.chat', JSON.stringify([...this.channels.values()].map(c => ({ key: c.key, name: c.name, pid: c.pid, pm: c.pm, lines: c.lines.slice(-200) })))); } catch { /* full or private */ }
    }, 500);
  },
  restore() {
    try {
      const d = JSON.parse(localStorage.getItem('am.chat') || 'null');
      if (!Array.isArray(d)) return;
      for (const c of d) {
        if (!c || typeof c.key !== 'string' || !Array.isArray(c.lines)) continue;
        if (c.key !== '#lobby' && !/^pm:/.test(c.key)) continue;
        const ex = this.channels.get(c.key);
        if (ex) ex.lines = c.lines; else this.channels.set(c.key, { key: c.key, name: String(c.name || c.key), pid: c.pid, pm: !!c.pm, lines: c.lines, unread: 0 });
      }
    } catch { /* nothing kept */ }
  },
  /** Does this message say your name (as a word)? */
  mentions(text) {
    const n = (ProfileManager.profile.name || '').trim();
    if (n.length < 2) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_])`, 'iu').test(String(text || ''));
  },
  add(key, line) {
    const c = this.channels.get(key);
    c.lines.push({ from: line.from || {}, text: String(line.text || ''), at: line.at || Date.now() });
    if (c.lines.length > 200) c.lines.shift();
    this.save();
    const looking = this.o && this.cur === key && !document.hidden;
    if (!looking && !(line.from && line.from.pid === Presence.pid())) c.unread++;
    if (this.o && this.cur === key) this.appendLine(c.lines[c.lines.length - 1]);
    this.paintList(); this.badge();
  },

  toggle() { this.o ? this.close() : this.open(); },
  open(key) {
    if (key && this.channels.has(key)) this.cur = key;
    if (this.o) { this.paint(); return; }
    UISounds.click();
    Presence.start();
    // (connecting / offline / back online: the empty channel says which)
    if (!this._pres) this._pres = Bus.on('presence:changed', () => { if (this.o && this.lines && !this.lines.querySelector('.ch-line')) this.paint(); });
    this.list = h('div.ch-list');
    this.lines = h('div.ch-lines');
    this.talk = h('span.ch-talk');
    this.input = h('input.ch-input', { type: 'text', maxlength: 300, placeholder: 'type here', 'aria-label': 'Chat message', autocomplete: 'off' });
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (this.input.value) { this.input.value = ''; e.stopPropagation(); } else this.input.blur(); return; }
      e.stopPropagation();
      if (e.key === 'Enter' && this.input.value.trim()) { this.send(this.input.value); this.input.value = ''; }
    });
    const top = h('div.ch-top', icon('chat'), h('span', 'chat'));
    this.panel = h('div.chat', { role: 'dialog', 'aria-label': 'Chat', style: { '--ch-f': clamp(Settings.get('ui.chatHeight') || 0.4, 0.2, 0.7) } },
      top, h('div.ch-body', this.list, h('div.ch-main', this.lines, h('div.ch-bar', this.talk, this.input))));
    // lazer: drag the top bar to resize (20%–70% of the screen)
    top.addEventListener('pointerdown', e => {
      if (e.button) return;
      top.setPointerCapture(e.pointerId);
      const app = $('#app').getBoundingClientRect();
      const move = ev => { const f = clamp((app.bottom - ev.clientY) / app.height, 0.2, 0.7); this.panel.style.setProperty('--ch-f', f); this._h = f; };
      const up = () => { top.removeEventListener('pointermove', move); top.removeEventListener('pointerup', up); if (this._h) Settings.set('ui.chatHeight', +this._h.toFixed(3)); };
      top.addEventListener('pointermove', move); top.addEventListener('pointerup', up);
    });
    this.o = makeOverlay(this.panel, { onClose: () => { this.o = null; Toolbar.sync(); } });
    this.o.el.classList.add('chat-ov');
    this.paint();
    Toolbar.sync();
    setTimeout(() => this.input && this.input.focus({ preventScroll: true }), 50);
  },
  close() { if (this.o) { UISounds.back(); this.o.close(); } },

  send(text) {
    const c = this.channels.get(this.cur);
    if (!Presence.ws) { Toast.err('Chat is offline', 'Can\'t reach the server right now — trying again…'); return; }
    // lazer's chat commands: /me does something, /np says what you're listening to (or playing), /help lists them
    const cmd = /^\/(\w+)\s*(.*)$/.exec(text);
    if (cmd) {
      const [, name, rest] = cmd, low = name.toLowerCase();
      if (low === 'help') { this.local('Commands: /me <action> — /np (what you\'re listening to or playing) — /help'); return; }
      if (low === 'np') {
        const G = typeof GameplayScreen !== 'undefined' && Screens.currentName === 'gameplay' && GameplayScreen.s ? GameplayScreen.s.rec : null;
        const m = G || MenuMusic.current;
        if (!m) { this.local('Nothing is playing right now.'); return; }
        text = `/me is ${G ? 'playing' : 'listening to'} ${m.artist} - ${m.title}${m.version ? ` [${m.version}]` : ''}`;
      } else if (low !== 'me') { this.local(`Unknown command /${name} — try /help.`); return; }
      else if (!rest.trim()) return;
    }
    if (c.pm) Presence.send({ t: 'pm', to: c.pid, text }); else Presence.send({ t: 'say', text });
  },
  /** A line only you see (a command's answer). */
  local(text) {
    const c = this.channels.get(this.cur);
    const l = { from: { name: '', pid: '' }, text, at: Date.now(), local: true };
    c.lines.push(l); this.appendLine(l);
  },
  /** Start (or go back to) a private conversation with a friend. */
  message(u) {
    const key = 'pm:' + u.pid;
    if (!this.channels.has(key)) this.channels.set(key, { key, name: u.name, pid: u.pid, pm: true, lines: [], unread: 0 });
    this.open(key);
  },

  paint() {
    if (!this.o) return;
    const c = this.channels.get(this.cur) || this.channels.get('#lobby');
    this.cur = c.key; c.unread = 0;
    this.talk.textContent = c.pm ? `talking with ${c.name}` : `talking in ${c.name}`;
    this.input.dataset.kbLabel = c.name; // (the phone's typing bar shows where it goes)
    clearEl(this.lines);
    if (!c.lines.length) this.lines.append(!Presence.ws ? offlineState('Chat', { compact: true }) : h('div.ch-empty', c.pm ? `Say hi to ${c.name}!` : 'Nobody has said anything yet.'));
    for (const l of c.lines) this.appendLine(l, false);
    this.lines.scrollTop = this.lines.scrollHeight;
    this.paintList(); this.badge();
  },
  appendLine(l, scroll = true) {
    if (!this.lines) return;
    const empty = this.lines.querySelector('.ch-empty'); if (empty) empty.remove();
    const stick = this.lines.scrollHeight - this.lines.scrollTop - this.lines.clientHeight < 40;
    const d = new Date(l.at), t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const me = l.from.pid && l.from.pid === Presence.pid();
    const act = /^\/me\s+/.test(l.text || '');
    if (l.local) this.lines.append(h('div.ch-line.local', h('span.ch-time', t), h('span.ch-text', l.text)));
    // (/me: lazer's action line — the name and what they did, in italics)
    else this.lines.append(h(`div.ch-line${me ? '.me' : ''}${act ? '.act' : ''}${!me && this.mentions(l.text) ? '.mention' : ''}`,
      h('span.ch-time', t),
      h('span.ch-name', { style: { color: this.colour(l.from) }, title: l.from.name }, act ? `* ${l.from.name || '?'}` : l.from.name || '?'),
      h('span.ch-text', act ? l.text.replace(/^\/me\s+/, '') : l.text)));
    if (scroll && (stick || me)) this.lines.scrollTop = this.lines.scrollHeight;
  },
  paintList() {
    if (!this.o) return;
    const item = c => h(`button.ch-item${c.key === this.cur ? '.on' : ''}${c.unread ? '.unread' : ''}`, { onclick: () => { UISounds.click(); this.cur = c.key; this.paint(); this.input.focus({ preventScroll: true }); } },
      c.pm ? h('span.ch-dot', { style: { background: this.colour({ pid: c.pid, name: c.name }) } }) : null,
      h('span.ch-iname', c.name), c.unread ? h('span.ch-count', String(Math.min(99, c.unread))) : null,
      c.pm ? h('span.ch-x', { title: 'Close', onclick: e => { e.stopPropagation(); this.channels.delete(c.key); this.save(); if (this.cur === c.key) this.cur = '#lobby'; this.paint(); } }, icon('x')) : null);
    const all = [...this.channels.values()], pub = all.filter(c => !c.pm), pms = all.filter(c => c.pm);
    clearEl(this.list).append(
      h('div.ch-group', h('span', 'CHANNELS'), icon('globe')), ...pub.map(item),
      h('div.ch-group', h('span', 'DIRECT MESSAGES'), icon('user')),
      ...(pms.length ? pms.map(item) : [h('div.ch-hint', 'Message a friend from their ⋯ menu.')]));
  },
  /** The toolbar button shows unread messages, like the notification bell. */
  badge() {
    if (!Toolbar.chatCount) return;
    const n = this.unread;
    Toolbar.chatCount.firstChild.textContent = n ? String(Math.min(99, n)) : '';
    Toolbar.chatCount.classList.toggle('show', n > 0);
  },
};
Chat.restore();
