/* Safe mode, for a school or work device: the online features a web filter is likely to block (or to block the whole
 * game over) are off — chat, multiplayer and Ranked Play, the daily challenge, the rankings and online leaderboards,
 * who's online, spectating and invites. Nothing holds a real-time connection to the game's server and plays aren't
 * sent to it. The beatmap listing and its downloads keep working (with explicit beatmaps hidden), as do your own
 * beatmaps, skins, scores and replays. Asked about in the first-run setup; switched in Settings → Online.
 *
 * It also comes on by itself (unless that's turned off) after the tab was taken to another page soon after the game
 * opened by something that was neither the game nor the player — what a school filter does when it blocks a page it
 * has just looked at. The next time the game opens, safe mode is on and says why. */
const SafeMode = {
  get on() { return !!Settings.get('online.safeMode'); },
  /** The screens that are online only. */
  SCREENS: new Set(['multiplayer', 'dashboard', 'rankings', 'daily']),
  blocks(name) { return this.on && this.SCREENS.has(name); },
  /** Something that's off was asked for: say so, instead of nothing happening. */
  refuse(what = 'That', plural = false) {
    Toast.show(`${what} ${plural ? 'are' : 'is'} off in safe mode`, kbHint('Safe mode turns off the online features school filters block. Click to change it in Settings.', 'Safe mode turns off the online features school filters block. Tap to change it in Settings.'),
      { onClick: () => SettingsPanel.open('Online') });
  },

  /** Safe mode switched on or off while the game is open: the online parts go (or come back) straight away. */
  apply() {
    const on = this.on;
    document.documentElement.classList.toggle('safe-mode', on);
    if (on === this._was) return;
    this._was = on;
    if (on) {
      try { if (typeof Chat !== 'undefined' && Chat.o) Chat.close(); } catch (e) { console.warn('safe mode: chat', e); }
      try { if (typeof Spectate !== 'undefined' && Spectate.target) Spectate.stop({ quiet: true }); } catch (e) { console.warn('safe mode: spectate', e); }
      try { if (Multiplayer.room || Multiplayer.ws) Multiplayer.leave(); } catch (e) { console.warn('safe mode: room', e); }
      Presence.stop();
      if (this.SCREENS.has(Screens.currentName)) Screens.go('home', { noRedirect: true });
    } else Presence.start();
    Bus.emit('safemode:changed', on);
  },

  // ── redirect watch ────────────────────────────────────────────────────────────────────────────────────────
  KEY: 'am.session',
  /** How soon after the game opened a takeover counts (a filter looks at a page as it loads). */
  WINDOW: 120000,
  read() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { return null; } },
  write(s) { try { localStorage.setItem(this.KEY, JSON.stringify(s)); } catch { /* storage blocked */ } },
  /** The game itself is about to leave the page (a reload for an update, a reset): not a takeover. */
  leaving() { this._leaving = true; },

  /** The very first thing the game does, before the loading screen's first step: how did the last visit end, and
   *  watch this one from the start (a school filter can take the tab while the game is still loading). */
  early() {
    const prev = this.read();
    const nav = typeof performance !== 'undefined' && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    // (timed from when this page started loading: a slow start isn't time spent somewhere else)
    const started = typeof performance !== 'undefined' && performance.timeOrigin ? Math.round(performance.timeOrigin) : Date.now();
    this.session = { at: started };
    this.write(this.session);
    // (a reload — the player's or the game's — ends the last visit on purpose, whatever it looked like; and the game
    // opening again the moment it left means the "other page" was the game itself: an invite link, its own address)
    this._prevTaken = !!(prev && prev.taken && !(nav && nav.type === 'reload') && !(prev.out && started - prev.out < 1500));
    this.watch();
  },
  /** Once the settings are loaded (and before anything online starts): safe mode on if the last visit was taken. */
  boot() {
    if (!this.session) this.early();
    if (this._prevTaken) this.takenOver();
    this._was = this.on;
    document.documentElement.classList.toggle('safe-mode', this._was);
    Bus.on('settings:changed', k => { if (k === 'online.safeMode' || k === '*') this.apply(); });
  },
  /** The last visit was taken over: safe mode comes on, and says so once the game is up (announce). */
  takenOver() {
    if (this.on || Settings.get('online.safeModeAuto') === false) return;
    Settings.set('online.safeMode', true);
    this.pending = true;
  },
  /** After the loading screen: why safe mode came on by itself, with the way back. Returns whether it showed. */
  announce() {
    if (!this.pending) return false;
    this.pending = false;
    Dialog.popup('Safe mode is on',
      h('div', h('p', `Last time ${APP_NAME} opened, something other than the game — a school or work web filter, probably — took this tab to another page.`),
        h('p', 'Safe mode turns off chat, multiplayer and the other online features those filters block, so the game can stay open. The beatmap listing, your songs, skins and scores all still work.'),
        h('p.muted', 'You can change it any time in Settings → Online.')),
      [{ label: 'Keep safe mode on', colour: '#66cc99' },
        { label: 'Turn it off', colour: '#ff66aa', cls: 'cancel', onClick: () => Settings.set('online.safeMode', false) }],
      { icon: 'lock' });
    return true;
  },
  /** Notes how this visit ends: a page change while the game is in front, has the focus and the player did nothing
   *  that leaves a page (a browser shortcut, the address bar, a link, switching away), soon after it opened — or one
   *  started by a script that isn't the game's — is a takeover. A reload, closing the tab with Ctrl+W, typing an
   *  address, the phone locking or the browser being closed aren't. */
  watch() {
    const mark = () => { this._userAt = Date.now(); };
    addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey || e.altKey || /^(Control|Meta|Alt|F5|BrowserBack|BrowserForward|BrowserRefresh|BrowserHome)$/.test(e.key)) mark(); }, true);
    addEventListener('click', e => { if (e.target && e.target.closest && e.target.closest('a[href]')) mark(); }, true);
    addEventListener('mouseup', e => { if (e.button === 3 || e.button === 4) mark(); }, true); // (the mouse's back / forward buttons)
    addEventListener('blur', mark);
    document.addEventListener('visibilitychange', () => { if (document.hidden) mark(); });
    // (Chrome's Navigation API sees a script sending the page somewhere: one that wasn't the game, or a link the
    // player clicked, is something else steering the tab)
    if (typeof navigation !== 'undefined' && navigation && navigation.addEventListener) {
      navigation.addEventListener('navigate', e => {
        if (!e.destination || e.destination.sameDocument || e.downloadRequest) return;
        if (e.userInitiated || e.navigationType === 'traverse') mark(); // (a link, Back or Forward: the player)
        else if (!this._leaving) this._scripted = true;
      });
    }
    addEventListener('pagehide', () => {
      const now = Date.now(), s = this.session || { at: now };
      const player = this._leaving || now - (this._userAt || 0) < 1500 || document.hidden || !document.hasFocus();
      s.out = now;
      s.taken = !player && (this._scripted || now - s.at < this.WINDOW);
      this.write(s);
    });
    // (back from the other page to this one kept in memory, without loading again: the same check, here and now)
    addEventListener('pageshow', e => {
      if (!e.persisted) return;
      const prev = this.read();
      this.session = { at: Date.now() }; this.write(this.session); this._scripted = false; this._leaving = false;
      if (prev && prev.taken) { this.takenOver(); this.announce(); }
    });
  },
};
