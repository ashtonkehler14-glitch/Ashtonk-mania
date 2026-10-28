/* Neru on the main menu: a picture of Neru standing in the bottom-left corner. It shows the image chosen in
 * Settings → Interface, otherwise neru.png / neru.webp / neru.gif / neru.jpg placed next to index.html (the
 * public/ folder). With no picture nothing is shown.
 * She's alive: she breathes, bobs to the music's beat (harder in kiai), leans towards the cursor, perks up when
 * hovered, and clicking her makes her hop — her excited face for a moment, and a few sparkles.
 * And things to find just by playing (NeruEggs) — mostly pictures and motion, hardly a word:
 * - on the main menu: bored when left alone, then on her phone, then hugging her knees (sulking when you come back,
 *   nodding off at night); in a huff — or a spin, as often — when clicked over and over, won over by a hundred clicks,
 *   a twirl when double-clicked by one of her own; cheering through a song's chorus; dancing when tapped in time with the music, or to a certain
 *   code; sunglasses on when you keep the pointer on her (a glint off them); picked up and dropped, dizzy when flung,
 *   shaken or circled round; a headpat (hearts — then a huff, as if she hadn't liked it); her own taunt typed back at
 *   her; a double take at her own name; the volume turned all the way up or down; songs skipped one after another (a
 *   wagging finger);
 * - when she sees you: a yawn after midnight, a cheer on New Year's Day, a year on from your first play and at a
 *   milestone play, a cheer for five new songs or more, a sulk when you're back after a week away, a worried look
 *   after an hour's playing without a break; and from the plays since she last saw you, her sunglasses still on after
 *   an SS, a snicker after three fails in a row, a wagging finger after a new best;
 * - the time of year drifting around her: snow, cherry blossom, bubbles on summer days, fireflies on summer nights,
 *   red dragonflies in September, autumn leaves, bats across a harvest moon at Halloween, hearts on Valentine's Day,
 *   confetti a year on from your first play (what falls settling at her feet; pop a bubble); stars at night, and a
 *   shooting star now and then; on April Fools' Day she's the other way round;
 * - elsewhere: peeking up when her name's searched for; the small Neru on other screens keeps its own picture, but a
 *   click there gets a pose of her own now and then — a dance after a full combo, a sulk after a poor play, a snicker
 *   after a fail, her phone out while you pause, a wagging finger at an empty library, worried at a song far above
 *   anything you've passed — fishing when a pause goes on (click her and the fish flops), a headpat, a huff too when
 *   clicked over and over.
 * Finding some unlocks secret medals (Medals' "Neru" group). */

const NeruMascot = {
  FILES: ['neru.png', 'neru.webp', 'neru.gif', 'neru.jpg'],
  /** Her other faces and poses, public/neru-<name>.png (tools/neru-art.py makes them, from frames of her song's music
   *  video): the build lists the ones there are, so none is looked for that isn't there. */
  POSES: [/*__NERU_POSES__*/],
  _pics: null, _blobURL: null,
  /** Her pictures — { base, happy, poses: { name: url } } (happy: the face she makes when clicked or pleased; null if
   *  there isn't one) — or null with none. The picture chosen in Settings → Interface is all of them; otherwise the
   *  bundled ones. Looked up once, and shared by every place she shows. */
  pictures() {
    // (a Teto, Miku or Neru fan gets her, never a picture of your own — theirs, most likely)
    if (this._pics && this._picsTeto !== NeruEggs.stays()) this._pics = null;
    if (!this._pics) this._pics = (async () => {
      this._picsNow = null;
      const blob = (this._picsTeto = NeruEggs.stays()) ? null : await DB.kvGet('mascot.image', null).catch(() => null);
      if (blob instanceof Blob) {
        if (this._blobURL) URL.revokeObjectURL(this._blobURL);
        const u = this._blobURL = URL.createObjectURL(blob);
        return { base: u, happy: null, poses: {} };
      }
      const loads = src => new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = src; });
      for (const f of this.FILES) {
        if (!(await loads(Host.asset(f)))) continue;
        const poses = Object.fromEntries(this.POSES.map(n => [n, Host.asset(`neru-${n}.png`)]));
        return (this._picsNow = { base: Host.asset(f), happy: poses.happy || null, poses });
      }
      return null;
    })();
    return this._pics;
  },
  /** Whether she shows: Settings → Show Neru — or, for a Teto, Miku or Neru fan, whatever that says (NeruEggs.stays). */
  on() { return !!Settings.get('ui.mascot') || NeruEggs.stays(); },
  build() {
    const el = this.el = h('button.neru', { hidden: true, 'aria-label': 'Neru', tabindex: '-1', onclick: e => { e.stopPropagation(); if (this._dragged) { this._dragged = false; return; } this.hop(); } });
    if (!this.on()) return el;
    this.pictures().then(pics => {
      if (!pics || this.el !== el) return;
      this.img = h('img.neru-img', { src: pics.base, alt: '', draggable: 'false' });
      // body: leans and bobs (driven per frame); img: breathing and the hop (CSS); a soft shadow on the floor
      this.body = h('span.neru-body', this.img);
      this.shadow = h('span.neru-shadow');
      el.append(this.shadow, this.body);
      el.hidden = false;
      el.addEventListener('pointerenter', e => { el.classList.add('perk'); NeruEggs.hoverStart(e); });
      el.addEventListener('pointerleave', () => { el.classList.remove('perk'); NeruEggs.hoverEnd(); });
      el.addEventListener('pointerdown', e => { NeruEggs.tap(e); NeruEggs.press(e); });
      el.addEventListener('contextmenu', e => e.preventDefault()); // (a long press on a touch screen is a headpat, not the browser's menu)
      this.start();
      // (the bundled Neru has a second, excited picture she switches to when clicked — loaded now, so it's there at once)
      this.base = pics.base; this.happy = pics.happy;
      if (pics.happy) new Image().src = pics.happy;
      NeruEggs._vol = Settings.get('audio.master'); // (where the volume starts: only a change to all the way up or down counts)
      NeruEggs._clicked = 0; // (clicks on her, this visit)
      NeruEggs.namesake();
      NeruEggs.fan();
      NeruEggs.watchCode();
      if (NeruEggs.foolsDay()) el.classList.add('nm-fools');
      NeruEggs.greet();
      NeruEggs.newYearsEve(el);
      NeruEggs.milestone();
      NeruEggs.breather();
      NeruEggs.drift(el, NeruEggs.anniversary() ? 'confetti' : undefined);
      // (after the drift: put in first of all, so the stars are furthest back — behind the leaves, the snow, the moon)
      if (NeruEggs.night()) NeruEggs.twinkle(el);
    });
    return el;
  },
  /** Her pose when nothing's going on: bored once she's been left alone a while, cheering through a song's chorus,
   *  her usual picture otherwise. */
  rest() { return this._idle && this.has(this._idlePose || 'bored') ? this._idlePose || 'bored' : this._kiai && this.has('cheer') ? 'cheer' : null; },
  /** In the middle of something (clicked over and over — a huff, a spin —, being held, a stare, her happy face after a
   *  click): poses wait for it. */
  busy() { const t = performance.now(); return t < (this._happyUntil || 0) || t < (this._actUntil || 0) || !!this._drag || !!this._drop || !!this._staring || !!(this.el && this.el._fanBusy); },
  /** Whether a pose of hers is there (the bundled pictures — not a picture of the player's own). */
  has(name) { return !!(this._picsNow && this._picsNow.poses && this._picsNow.poses[name]); },
  /** Show a pose (null: her usual picture), at the size that keeps her head the same as in the others — crossfaded from
   *  the one before, never a jump; `pop`: a little flash of light as it changes, for the bigger moments. */
  async show(name, { pop = true } = {}) {
    const pics = await this.pictures(), img = this.img;
    if (!pics || !img) return;
    // (her happy face — clicked — at her full size, as it's always been on the main menu)
    const f = !name ? { src: pics.base, scale: 1 } : name === 'happy' && pics.happy ? { src: pics.happy, scale: 1 } : NeruCameo.pose(pics, name);
    // (a photo held up beside her: her pose stays till it's gone — then the last one asked for meanwhile; their thing
    // crossed out in a thought bubble: she doesn't go back to how she was till it's gone either)
    if (this.el && (this.el.querySelector(':scope > .neru-photo') || (name || null) === (this.rest() || null) && this.el.querySelector(':scope > .neru-bread'))) {
      this._afterPhoto = name || null;
      // (taken once it's gone, however it went)
      clearTimeout(this._afterT);
      const el = this.el, later = () => { if (this.el !== el || this._afterPhoto === undefined) return; if (el.querySelector(':scope > .neru-photo, :scope > .neru-bread')) { this._afterT = setTimeout(later, 250); return; } const n = this._afterPhoto; this._afterPhoto = undefined; this.show(n, { pop: false }); };
      this._afterT = setTimeout(later, 250);
      return;
    }
    this._afterPhoto = undefined; // (asked for since: what was waiting is out of date)
    if (img.dataset.pose === (name || '')) return;
    img.dataset.pose = name || '';
    await NeruCameo.swap(img, f.src, () => {
      img.style.height = f.scale < 1 ? `${(f.scale * 100).toFixed(1)}%` : '';
      // (where her head is now, for what floats over it — the cross mark, the steam)
      if (this.el) this.el.style.setProperty('--nm-top', `${((1 - f.scale) * 100).toFixed(1)}%`);
    }, () => this.img === img && img.dataset.pose === (name || ''));
    if (pop && this.img === img && Settings.get('ui.animSpeed')) img.animate([{ filter: 'brightness(1.35) drop-shadow(0 10px 24px rgba(0, 0, 0, .5))' }, { filter: 'drop-shadow(0 10px 24px rgba(0, 0, 0, .5))' }], { duration: 320, easing: 'ease-out' });
  },
  /** Per frame: the lean towards the pointer (eased) and the beat's bob decaying, written as one transform. */
  start() {
    cancelAnimationFrame(this._raf);
    this._lean = 0; this._bob = 0; this._px = null;
    // (her box is measured when the pointer moves, not every frame: reading layout each frame can force a reflow)
    // (her box measured a few times a second at most: measured on every move of the pointer, the page was laid out
    // again each time)
    if (!this._onMove) this._onMove = e => { this._px = e.clientX; this._py = e.clientY; this.wake(); if (this.el && this.el.isConnected) { const t = performance.now(); if (!this._rect || t - (this._rectAt || 0) > 250) { this._rect = this.el.getBoundingClientRect(); this._rectAt = t; } NeruEggs.circle(e.clientX, e.clientY); } };
    window.addEventListener('pointermove', this._onMove, { passive: true });
    NeruEggs.watchIdle();
    let last = performance.now();
    const tick = now => {
      this._raf = -1; // (mid-frame: a bounce set during it doesn't start a second loop — see wake())
      if (!this.el || !this.body || !this.el.isConnected) { if (this.el && !this.el.isConnected) this.stop(); else this._raf = requestAnimationFrame(tick); return; }
      if (typeof Spectate !== 'undefined' && Spectate.rkEl) { last = now; this._raf = requestAnimationFrame(tick); return; } // (hidden under a spectated screen)
      const dt = Math.min(64, now - last); last = now;
      let want = 0;
      if (this._px != null && this._rect && Settings.get('ui.animSpeed')) {
        const r = this._rect, cx = r.left + r.width / 2, cy = r.top + r.height * 0.3;
        // a few degrees towards the cursor, more the further away it is (and none once it's over her)
        want = clamp((this._px - cx) / innerWidth * 9, -4, 4) * (this._py < cy - r.height ? 0.6 : 1);
      }
      this._lean += (want - this._lean) * (1 - Math.exp(-dt / 260));
      this._bob *= Math.exp(-dt / 140);
      const b = this._bob;
      // (picked up: she hangs from where she was grabbed and swings as she's moved; let go, she drops back down)
      const held = NeruEggs.held(dt, now);
      // (written only when it changes: a style write every frame restyles her even when she's still)
      const tf = held ? held.tf : `rotate(${this._lean.toFixed(2)}deg) translateY(${(b * 6).toFixed(2)}px) scale(${(1 + b * 0.012).toFixed(4)}, ${(1 - b * 0.022).toFixed(4)})`;
      const sh = held ? held.sh : `scaleX(${(1 + b * 0.05).toFixed(3)})`;
      if (tf !== this._tf) { this._tf = tf; this.body.style.transform = tf; if (this.shadow) { this.shadow.style.transform = sh; this.shadow.style.opacity = held ? held.so : ''; } }
      // (settled — still, not held, not leaning any further — the loop sleeps until something moves her: the pointer, a
      // bounce, a grab. Waking every frame for nothing kept a slow device busy on the main menu)
      if (!held && b < 0.0005 && Math.abs(want - this._lean) < 0.005) { last = now; this._raf = 0; return; }
      this._raf = requestAnimationFrame(tick);
    };
    this._tick = tick;
    this._raf = requestAnimationFrame(tick);
  },
  /** A beat of the menu music (from the main menu's beat tracking): a little squash, harder in kiai. */
  beat(adj = 1, kiai = false) {
    NeruEggs.chorus(kiai);
    if (!this.body || !Settings.get('ui.animSpeed')) return;
    // (dancing: every beat bounces her all the way, and every other one brings sparkles)
    if (NeruEggs.dancing()) { this._bob = 1; if ((this._danceBeat = (this._danceBeat || 0) + 1) % 2 === 0) this.sparkle(); return; }
    this._bob = Math.max(this._bob, clamp(adj, 0, 1) * (kiai ? 1 : 0.55));
  },
  hop() {
    if (!this.el) return;
    // (clicked over and over — angry, a spin, or for a Teto or Miku fan the words or a photo: nothing till it's played
    // out — no click, no touch, not even the hundredth)
    if (this.el._fanBusy) return;
    const now = performance.now();
    // (mid-twirl: nothing cuts it short — another click waits till she's round)
    if (now < (this._twirlUntil || 0)) return;
    // (the hundredth click on her this visit, however many huffs she's had: she gives up pretending she minds)
    if (++NeruEggs._clicked === NeruEggs.HUNDRED) { NeruEggs.hundred(); return; }
    // (dancing — to the code, or to the beat you're tapping — a tap only bounces her along)
    if (NeruEggs.dancing()) { this._bob = 1; this.sparkle(); UISounds.click(); return; }
    // (clicked over and over: every click counts, one after another — each within CLICK_GAP of the last — and the
    // eighth always gets her going (huff): never a matter of chance or of how quickly you click. A tap that sets her
    // dancing, in time with the music, was the dance's and stopped above.)
    NeruEggs._onBeat = false;
    if (NeruEggs.counted(this, now) >= NeruEggs.CLICKS) { NeruEggs.huff(); return; }
    this.el.classList.remove('hop', 'twirl'); void this.el.offsetWidth; this.el.classList.add('hop');
    UISounds.click();
    NeruEggs.stopStare();
    if (this.happy && this.img) {
      // (April Fools' Day: she laughs instead — got you. A Teto or Miku fan gets nothing of the sort from one click:
      // their thing crossed out or a photo comes only when clicked over and over, like a huff — clickedOver)
      this.show(NeruEggs.foolsDay() && this.has('mock') ? 'mock' : 'happy', { pop: false });
      if (NeruEggs.valentine()) for (let i = 0; i < 4; i++) setTimeout(() => NeruEggs.heart(), i * 120);
      clearTimeout(this._back);
      this._happyUntil = now + 1600;
      this._back = setTimeout(() => this.show(this.rest()), 1600);
    }
    this.sparkle();
  },
  /** A handful of sparkles that burst out around her and fade. */
  sparkle() {
    if (!this.el || !Settings.get('ui.animSpeed')) return;
    const colors = ['#ffd54a', '#ff8cc0', '#ffffff', '#8fd3ff'];
    for (let i = 0; i < 7; i++) {
      const sp = h('span.neru-spark');
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, d = 60 + Math.random() * 70;
      sp.style.left = `${45 + (Math.random() - 0.5) * 30}%`; sp.style.top = `${22 + Math.random() * 20}%`;
      sp.style.background = colors[i % colors.length];
      this.el.append(sp);
      sp.animate([{ transform: 'translate(-50%, -50%) scale(0) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d * 0.7}px), calc(-50% + ${Math.sin(a) * d * 0.7}px)) scale(1) rotate(90deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d + 18}px)) scale(.4) rotate(180deg)`, opacity: 0 }],
        { duration: 700 + Math.random() * 300, easing: 'cubic-bezier(.22, 1, .36, 1)' }).onfinish = () => sp.remove();
    }
  },
  /** Use a picture the player chose (a File/Blob), or null to go back to the bundled one. */
  async setImage(file) {
    await DB.kvSet('mascot.image', file ? new Blob([await file.arrayBuffer()], { type: file.type || 'image/png' }) : null);
    this._pics = null;
    const old = document.querySelector('.home .neru');
    if (old) old.replaceWith(this.build());
  },
  /** Her loop running again (it sleeps while she's settled; `_raf` 0 means asleep, -1 in the middle of a frame). */
  wake() { if (!this._raf && this._tick && this.el && this.el.isConnected) this._raf = requestAnimationFrame(this._tick); },
  stop() {
    clearTimeout(this._back); cancelAnimationFrame(this._raf); this._raf = 0; this._tick = null;
    if (this._onMove) window.removeEventListener('pointermove', this._onMove);
    NeruEggs.unwatchIdle(); NeruEggs.stopStare(); NeruEggs.letGo(true); clearTimeout(NeruEggs._patT); clearInterval(NeruEggs._heartT); NeruEggs._patting = false;
    // (a huff, a chorus or a stare cut short by leaving ends with it)
    this.el = null; this.img = null; this.body = null; this.shadow = null; this._idle = this._kiai = false; this._idlePose = null; this._happyUntil = 0; this._afterPhoto = undefined;
  },
};
// (a bounce — on the beat, a cheer, a headpat — wakes her sleeping loop: set from all over, so it's done here)
Object.defineProperty(NeruMascot, '_bob', { get() { return this.__bob || 0; }, set(v) { this.__bob = v; if (v > 0.0005) this.wake(); }, configurable: true });

/** Neru around the game, not only on the main menu (with the same setting): she pops up at the edge of a screen in a
 *  pose that fits — grudgingly impressed by a good play, unimpressed by a poor one or a fail (a tsundere: never quite
 *  nice about it, never cruel either), on her phone while a song or the game loads — and clicking her makes her hop.
 *  Screens place her with a class of their own (`.nc-results`, `.nc-pause`…). */
const NeruCameo = {
  /** The moods she's pleased about (not that she'd say so): sparkles. */
  HAPPY: new Set(['perfect', 'great', 'medal', 'secret', 'allFound', 'herSong', 'herSongPass']),
  /** Her pose on each screen (her shrug, neru.png, if it isn't there) — all from the song's video: sunglasses on for a
   *  perfect play, a wagging finger at an S, a wink for an A or B, worn out at a C or D, laughing at a fail; bored at her
   *  desk while you pause, fists up — "I'm not cheering for you" — while a song loads, hand on hip at an empty library,
   *  a blank "huh?" at an empty list, fishing while the game starts. */
  POSE: {
    perfect: 'cool', great: 'point', okay: 'wink', bad: 'tired', failed: 'mock',
    paused: 'bored', loading: 'cheer', empty: 'sassy', list: 'huh', boot: 'fishing',
    // (a medal: a wag of her finger at a hard one — not bad — and a wink when it's one of her own secrets you found;
    // on her phone, reading what's new)
    medal: 'point', secret: 'wink', news: 'phone', waiting: 'bored', asleep: 'tired', herSong: 'dance',
    // (the results of one of her songs: delighted you passed it, sulking if you failed it)
    herSongPass: 'happy', herSongFail: 'sulk',
    // (the same song again and again: worn out; 727 on the results: pointing it out)
    again: 'tired', wysi: 'point',
    // (turning her off as one of her own: offended; a Teto or Miku song, for their fan: laughing at it)
    refused: 'sassy', theirSong: 'mock',
    // (her marker on your Teto or Miku picture: snickering at her handiwork; a crown on her own: a wink)
    doodle: 'snicker', crowned: 'wink',
    // (every one of her secrets found: cheering beside them on your profile)
    allFound: 'cheer',
    // (beside the first-run setup, sizing you up: Onboarding.NERU has her pose for each page)
    setup: 'sassy',
  },
  /** The poses only easter eggs bring out (NeruEggs): a dance for the Konami code (or tapping along to the music), her
   *  phone and then her knees when left alone longer, and a sulk when you come back after that (or after a week away); and on other screens, clicked, a dance after a full
   *  combo, a sulk after a poor play, a snicker after a fail, her phone out while you pause, a wagging finger at an
   *  empty library, worried while a song far
   *  above anything you've passed loads (and after an hour's playing without a break). */
  EGG: {
    code: 'dance', aloneLonger: 'phone', aloneLongest: 'knees', back: 'sulk', fullCombo: 'dance', failed: 'snicker',
    farAbove: 'worried', longSession: 'worried', poorPlay: 'sulk', paused: 'phone', noSongs: 'point',
  },
  /** How much of each pose's picture her head takes up (top of her hair to her chin, against its height): a close-up
   *  is shown smaller, so that her head comes out no bigger than in her default picture (HEAD_SIZE) — the same Neru
   *  whichever pose it is, not one twice the size of the other. */
  HEAD: {
    bored: 0.43, cheer: 0.37, cool: 0.38, dance: 0.18, fishing: 0.38, happy: 0.45, huh: 0.45, knees: 0.45, mock: 0.38,
    phone: 0.31, point: 0.45, sassy: 0.49, snicker: 0.21, sulk: 0.45, tired: 0.68, wink: 0.28, worried: 0.47,
  },
  HEAD_SIZE: 0.36,
  /** Her pose for `mood`'s screen (her default picture without it). */
  face(pics, mood) { return this.pose(pics, this.POSE[mood] || null); },
  /** A pose of hers by name (null: her default picture): its picture, and how big she's shown in it (see HEAD). */
  pose(pics, name) {
    if (!name || !pics.poses || !pics.poses[name]) return { src: pics.base, scale: 1 };
    // (a close-up is shown a little smaller — never below 85%: shrunk to match her head exactly, some poses came out tiny)
    return { src: pics.poses[name], scale: clamp(this.HEAD_SIZE / (this.HEAD[name] || this.HEAD_SIZE), 0.85, 1) };
  },
  /** Neru beside a dialog (`dlg`, centred in `host`): where there's less room than she needs — a tablet, the dialog
   *  nearly as wide as the screen — she's shrunk to fit it, and with too little to look like herself she isn't there
   *  at all (half of her behind the dialog looked broken). Kept fitted as her picture comes in, with each pose and
   *  when the window changes, until she's gone. (Widths in the host's own units: no transforms in them.) */
  beside(el, dlg, host) {
    let fit = 1;
    const ro = new ResizeObserver(() => {
      if (!el.isConnected) { ro.disconnect(); return; }
      if (!el.offsetWidth) return; // (her picture's still loading)
      const room = (host.clientWidth - dlg.offsetWidth) / 2 - el.offsetLeft - 12;
      const f = clamp(room / (el.offsetWidth / fit), 0, 1);
      if (Math.abs(f - fit) < 0.01) return;
      fit = f;
      el.style.setProperty('--nc-fit', f.toFixed(3));
      el.classList.toggle('nc-cramped', f < 0.6);
    });
    ro.observe(el); ro.observe(host);
  },
  /** A play's mood: from its grade (a new best too), or a fail. */
  moodOf(s) {
    if (!s || !s.passed) return 'failed';
    if (['XH', 'X', 'SS'].includes(s.grade)) return 'perfect';
    if (['SH', 'S'].includes(s.grade)) return 'great';
    return ['A', 'B'].includes(s.grade) ? 'okay' : 'bad';
  },
  /** Neru in `mood`, for a screen to put where `cls` places her; she comes in once her picture is ready (and in a mood
   *  she's pleased about, sparkles `delay` ms later). `poke`: an easter egg's pose a click brings out for a moment, in
   *  place of her happy face. Null when she's turned off. */
  make(mood, cls, { delay = 450, poke = null } = {}) {
    if (!NeruMascot.on()) return null;
    // (a Teto or Miku fan: clicked, she snickers at you — unless there's an easter egg's pose. Their thing crossed out,
    // or a photo, only when clicked over and over: NeruEggs.clickedOver)
    if (!poke && NeruEggs.fanOf()) poke = 'snicker';
    const el = h(`button.neru-cameo.${cls}`, { type: 'button', 'aria-label': 'Neru', tabindex: '-1', hidden: true });
    // (sparkles: in a mood she's pleased about)
    const pleased = this.HAPPY.has(mood);
    NeruMascot.pictures().then(async pics => {
      if (!pics) { el.remove(); return; }
      let face = this.face(pics, mood);
      const happy = pics.happy && this.pose(pics, 'happy');
      // (what a click brings out for a moment: her happy face, or the easter egg's pose — when that picture is there)
      const react = poke && pics.poses && pics.poses[poke] ? this.pose(pics, poke) : happy;
      if (react) new Image().src = react.src; // (ready before the first click)
      const img = h('img.nc-img', { src: face.src, alt: '', draggable: 'false' });
      // (her place's height, times how big she's shown in this pose — crossfaded from the one before)
      const show = f => this.swap(img, f.src, () => el.style.setProperty('--nc-s', f.scale));
      el.style.setProperty('--nc-s', face.scale);
      // (another pose later on — NeruEggs.fishLater — and the one she goes back to after a click)
      el._pose = name => {
        if (!pics.poses || !pics.poses[name]) return;
        face = this.pose(pics, name);
        if (el.isConnected) show(face);
      };
      // (shown once it can be drawn, never as an empty box that pops)
      try { await img.decode(); } catch { /* shown anyway */ }
      if (!el.isConnected && !el.parentNode) return;
      el.append(h('span.nc-body', img));
      el.hidden = false;
      const anim = !!Settings.get('ui.animSpeed');
      if (anim) el.classList.add('in');
      setTimeout(() => { if (el.isConnected && pleased) this.burst(el); }, anim ? delay : 0);
      // (her sunglasses on — an SS — catch the light now and then)
      if (pics.poses && pics.poses.cool) NeruEggs.glintLoop(img.parentElement, img, () => el.isConnected && img.getAttribute('src') === pics.poses.cool);
      // (pressed and held: a headpat, like the main menu's Neru — her happy face, hearts; let go, a huff, and no click
      // besides)
      el.addEventListener('pointerdown', e => {
        if (e.button || el._patT || el._patting || el._fanBusy) return; // (clicked over and over: busy till it's played out)
        const up = () => {
          clearTimeout(el._patT); el._patT = null;
          window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
          if (!el._patting) return;
          el._patting = false; clearInterval(el._hearts);
          el._noClick = true; setTimeout(() => { el._noClick = false; }, 400);
          clearTimeout(el._back);
          // (let go: hand on hip, blushing — a long one, a shake too: as the main menu's Neru)
          if (pics.poses && pics.poses.sassy) {
            show(this.pose(pics, 'sassy'));
            if (performance.now() - el._patFrom > 900) { el.classList.remove('hop', 'shake'); void el.offsetWidth; el.classList.add('shake'); }
            UISounds.play('click-short');
            NeruEggs.blush(img.parentElement, img, 'sassy');
            el._back = setTimeout(() => { el.classList.remove('shake'); show(face); }, 2600);
          } else show(face);
        };
        window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
        el._patT = setTimeout(() => {
          el._patT = null;
          if (!el.isConnected || el._fanBusy) return;
          el._patting = true; el._patFrom = performance.now(); clearTimeout(el._back);
          if (happy) show(happy);
          UISounds.play('check-on');
          const heart = () => { if (!el.isConnected) { clearInterval(el._hearts); return; } NeruEggs.heart(el, img); };
          heart(); el._hearts = setInterval(heart, 230);
        }, NeruEggs.PAT_MS);
      });
      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('click', e => {
        e.stopPropagation();
        if (el._noClick) { el._noClick = false; return; } // (let go after a headpat)
        const now = performance.now();
        // (clicked over and over, like the main menu's Neru — angry, a spin…: a click does nothing till it's played out)
        if (el._fanBusy) return;
        // (as the main menu's Neru: every click counts, one after another, and the sixth always gets her going — one of
        // her own gets a spin; a Teto or Miku fan their thing crossed out or a photo where anyone else gets angry)
        if (NeruEggs.counted(el, now) >= NeruEggs.CAMEO_CLICKS && pics.poses && pics.poses.sassy) {
          el._clicks = []; clearTimeout(el._back);
          const no = NeruEggs.fanOf(), pose = name => {
            if (!name) { show(face); return true; }
            const f = name === 'happy' ? happy : pics.poses[name] && this.pose(pics, name);
            if (!f) return false;
            show(f); return true;
          };
          if (NeruEggs.neruFan()) { NeruEggs.found('twirl'); NeruEggs.spin(el, pose); } else NeruEggs.clickedOver(no && no.who, el, img, pose);
          return;
        }
        // (fishing: the fish on her line flops about — she keeps still, rod in hand — an easter egg)
        if (pics.poses && face.src === pics.poses.fishing && img.getAttribute('src') === face.src) { NeruEggs.flopFish(img.parentElement, img); return; }
        el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop');
        UISounds.click();
        // (her happy face for a moment, whatever her mood — or the easter egg's pose, held a little longer)
        if (react && face.src !== react.src) { show(react); clearTimeout(el._back); el._back = setTimeout(() => show(face), react === happy ? 1600 : 2200); }
        if (pleased || (react !== happy && poke === this.EGG.fullCombo)) this.burst(el);
        if (react !== happy && poke === this.EGG.fullCombo) NeruEggs.found('showoff');
      });
    });
    return el;
  },
  /** A picture changed for another without a jump: the one before fades out over the new one fading in. `apply`
   *  makes any other change that goes with it (its size) at the moment it swaps; `still()` says whether it's still wanted
   *  once the new picture is ready. */
  async swap(img, src, apply = null, still = () => true) {
    const pre = new Image(); pre.src = src;
    try { await pre.decode(); } catch { /* shown anyway */ }
    if (!still()) return;
    if (img._flopEnd) img._flopEnd(); // (a fish flopping on her line: over, the picture's changing)
    const box = img.parentElement, anim = Settings.get('ui.animSpeed') && !document.documentElement.classList.contains('slow');
    if (anim && box && img.isConnected && img.complete && img.naturalWidth && img.getAttribute('src') !== src) {
      // (the old picture, where it was — held to the bottom, as she stands — fading away over the new one)
      const ghost = img.cloneNode(); ghost.classList.add('neru-ghost'); ghost.removeAttribute('data-pose');
      Object.assign(ghost.style, { left: `${img.offsetLeft}px`, bottom: `${Math.max(0, box.clientHeight - img.offsetTop - img.offsetHeight)}px`, width: `${img.offsetWidth}px`, height: `${img.offsetHeight}px` });
      box.append(ghost);
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-out' }).onfinish = () => ghost.remove();
      img.src = src; if (apply) apply();
      img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-in' });
      return;
    }
    img.src = src; if (apply) apply();
  },
  /** A few sparkles that burst out around her head and fade — when she's pleased (not that she'd say so). */
  burst(el) {
    if (!Settings.get('ui.animSpeed') || document.documentElement.classList.contains('slow')) return;
    const colors = ['#ffd54a', '#ff8cc0', '#ffffff', '#8fd3ff'];
    for (let i = 0; i < 6; i++) {
      const sp = h('span.neru-spark');
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2, d = 50 + Math.random() * 60;
      sp.style.left = `${45 + (Math.random() - 0.5) * 30}%`; sp.style.top = `${18 + Math.random() * 16}%`;
      sp.style.background = colors[i % colors.length];
      el.append(sp);
      sp.animate([{ transform: 'translate(-50%, -50%) scale(0)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d * 0.7}px), calc(-50% + ${Math.sin(a) * d * 0.7}px)) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - 14}px)) scale(.5)`, opacity: 0 }],
        { duration: 800 + Math.random() * 300, easing: 'cubic-bezier(.22, 1, .36, 1)' }).onfinish = () => sp.remove();
    }
  },
  /** On the loading screen, if loading takes a moment (not on a quick start, where she'd only flash by). */
  boot() {
    const ls = $('#loading-screen');
    setTimeout(() => {
      if (!ls || ls.classList.contains('done')) return;
      const el = this.make('boot', 'nc-boot');
      if (el) ls.append(el);
    }, 700);
  },
};

Bus.on('music:changed', m => NeruEggs.skipped(m));
Bus.on('screen:changed', () => { NeruEggs._selPeeked = false; NeruEggs.selectIdle(); });
for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => { if (Screens.currentName === 'songselect') NeruEggs.selectIdle(); }, { capture: true, passive: true });
Bus.on('library:changed', () => { if (NeruMascot.img) NeruEggs.newSongs(); NeruEggs.newSet(); });
Bus.on('mp:changed', () => NeruEggs.roomAlone());
// (any box for looking something up: the song, beatmap, settings, mods, rooms, collections and library searches)
document.addEventListener('input', e => { if (e.target && e.target.matches && e.target.matches('input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i], input[aria-label*="search" i]')) NeruEggs.searched(e.target); });
// (a new name or picture that makes you a Teto or Miku fan — or no longer: Neru comes back on, or goes, and she's herself
// again or your picture)
Bus.on('profile:changed', () => {
  const fan = JSON.stringify([NeruEggs.fanOf(), NeruEggs.neruFan()]);
  if (fan === (NeruEggs._wasFan || JSON.stringify([null, false]))) return;
  NeruEggs._wasFan = fan; NeruEggs._fanSeen = false;
  const old = Screens.currentName === 'home' && document.querySelector('.home .neru');
  if (old) old.replaceWith(NeruMascot.build());
});
Bus.on('settings:changed', k => {
  if (k === 'audio.master') NeruEggs.volume(Settings.get('audio.master'));
  if (k === 'ui.mascot' && Screens.currentName === 'home' && !NeruEggs._backing) { const old = document.querySelector('.home .neru'); if (old) old.replaceWith(NeruMascot.build()); }
});

/** Neru's easter eggs: each one is only pictures and motion — she never
 *  says anything. */
const NeruEggs = {
  IDLE_MS: 45000,
  /** Left alone longer still: on her phone, then hugging her knees (each only if that picture is there); bored sooner
   *  late at night. */
  get IDLE_STAGES() { return [[this.lateNight() ? 20000 : 45000, 'bored'], [180000, NeruCameo.EGG.aloneLonger], [360000, NeruCameo.EGG.aloneLongest]]; },
  // ── left alone on the main menu: after a while she gets bored (at her desk), then gets her phone out, and in the end
  // sits hugging her knees; back to herself, with a start, when you move or press anything (from her knees: in a sulk
  // for a moment first)
  watchIdle() {
    this.unwatchIdle();
    this._seen = performance.now();
    this._wake = () => {
      this._seen = performance.now();
      const M = NeruMascot;
      if (!M._idle) return;
      const was = M._idlePose;
      M._idle = false; M._idlePose = null;
      if (M.el) { M.el.classList.remove('startle'); void M.el.offsetWidth; M.el.classList.add('startle'); }
      // (left alone so long she ended up hugging her knees: she sulks a moment before she's herself again)
      if (was === NeruCameo.EGG.aloneLongest && this.act(NeruCameo.EGG.back, 2600, { hop: false })) return;
      if (!M.busy()) M.show(M.rest());
    };
    for (const ev of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, this._wake, { passive: true });
    window.addEventListener('pointermove', this._wakeMove = e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this._wake(); }, { passive: true });
    // (left alone at night, whatever she's doing: she's nodding off — little z's float up from her)
    this._zT = setInterval(() => { if (NeruMascot._idle && !document.hidden && this.night()) this.snooze(); }, 1300);
    this._idleT = setInterval(() => {
      const M = NeruMascot;
      if (!M.img || document.hidden || M.busy()) return;
      const away = performance.now() - this._seen;
      // (the latest stage reached whose picture is there)
      let pose = null;
      for (const [ms, name] of this.IDLE_STAGES) if (away >= ms && M.has(name)) pose = name;
      if (!pose || (M._idle && M._idlePose === pose)) return;
      M._idle = true; M._idlePose = pose; M.show(pose);
      if (pose === NeruCameo.EGG.aloneLongest) this.found('alone');
    }, 3000);
  },
  unwatchIdle() {
    clearInterval(this._idleT); clearInterval(this._zT);
    if (this._wake) for (const ev of ['pointerdown', 'keydown', 'wheel']) window.removeEventListener(ev, this._wake);
    if (this._wakeMove) window.removeEventListener('pointermove', this._wakeMove);
    this._wake = this._wakeMove = null;
  },

  // ── clicked over and over: angry (clickedOver) — or in Neru mode a spin
  /** Clicks it takes — one after another, each within CLICK_GAP ms of the last — on the main menu's Neru and on the
   *  smaller Neru on other screens. Always that many: not a chance per click. */
  CLICKS: 8, CAMEO_CLICKS: 6, CLICK_GAP: 1200,
  /** A click on `who` (a Neru, keeping its own count) at `now`: how many in a row so far. */
  counted(who, now) {
    const c = who._clicks || [], last = c[c.length - 1];
    who._clicks = last == null || now - last > this.CLICK_GAP ? [now] : [...c, now];
    return who._clicks.length;
  },
  huff() {
    const M = NeruMascot, el = M.el;
    if (!el) return;
    M._clicks = []; M._happyUntil = 0;
    clearTimeout(M._back);
    const pose = name => {
      if (!name) { if (!M.busy()) M.show(M.rest()); return true; }
      if (name === 'happy' ? !M.happy : !M.has(name)) return false;
      M._idle = false; M.show(name, { pop: false });
      return true;
    };
    // (one of her own — the Neru gang — never makes her angry: a spin, always)
    if (this.neruFan()) { this.found('twirl'); this.spin(el, pose); return; }
    const f = this.fanOf();
    this.clickedOver(f && f.who, el, M.img, pose);
  },
  /** Clicked over and over: she gets angry (hand on hip, a shake, the cross mark and steam) — or a Teto or Miku fan
   *  (`who`) gets their thing in a thought bubble, crossed out (no baguette, no leek), or, as often, a photo of their
   *  character held up. (A spin is for one of her own, in Neru mode — huff.) Nothing — a click, a touch — has her do
   *  anything else till it's over, and a photo or a thought is gone before she changes pose. `box`/`img`: which Neru
   *  (the main menu's or a screen's); `pose(name)` puts her in a pose — whether it's there — and back (null). */
  clickedOver(who, box, img, pose) {
    if (!box || !img || box._fanBusy) return;
    const photo = who && (this.PHOTOS[who] || []).length && !box.classList.contains('behind') && Settings.get('ui.animSpeed');
    const kind = !who ? 'angry' : photo && Math.random() < 0.5 ? 'photo' : 'thought';
    box._fanBusy = true;
    let held = null; // (the photo or the thought bubble, waited out)
    const end = () => {
      if (held && held.isConnected && box.isConnected) { setTimeout(end, 80); return; }
      box._fanBusy = false;
      box.classList.remove('huff', 'shake', 'giggle');
      pose(null);
    };
    const shake = cls => { box.classList.remove('hop', 'huff', 'shake', 'giggle'); void box.offsetWidth; box.classList.add(cls); };
    if (kind === 'angry') {
      pose('sassy');
      shake(box === NeruMascot.el ? 'huff' : 'shake');
      UISounds.play('dialog-dangerous-tick');
      this.fume(box);
      setTimeout(end, 3200);
    } else if (kind === 'photo') {
      // (laughing; the photo once her new pose is in, beside it)
      if (!pose('mock')) pose('snicker');
      shake('giggle');
      UISounds.play('click-short');
      setTimeout(() => { held = box.isConnected ? this.photo(who, box, img) : null; setTimeout(end, held ? 2500 : 1600); }, 450);
    } else {
      // (their thing in a thought bubble, struck out)
      pose('sassy');
      shake('shake');
      UISounds.play('dialog-dangerous-tick');
      setTimeout(() => { held = box.isConnected ? this.prop(who, box, img) : null; setTimeout(end, 2700); }, 250);
    }
  },
  /** Clicked over and over in Neru mode: a spin — her happy face, sparkles — and clicks do nothing till she's round
   *  and back. `box`/`pose` as clickedOver's. */
  spin(box, pose) {
    if (!box || box._fanBusy) return;
    box._fanBusy = true;
    if (!pose('happy')) pose(null);
    box.classList.remove('hop', 'huff', 'shake', 'giggle', 'twirl'); void box.offsetWidth; box.classList.add('twirl');
    UISounds.play('check-on');
    if (box === NeruMascot.el) NeruMascot.sparkle(); else NeruCameo.burst(box);
    setTimeout(() => { box._fanBusy = false; box.classList.remove('twirl'); pose(null); }, 1400);
  },

  /** A little "z" floating up from beside her head, drifting and fading — nodding off. */
  snooze(box = NeruMascot.el, img = NeruMascot.img, { size = 15 } = {}) {
    if (!box || !img || !box.isConnected || !Settings.get('ui.animSpeed') || document.documentElement.classList.contains('slow')) return;
    const er = box.getBoundingClientRect(), ir = img.getBoundingClientRect(), k = box.offsetWidth ? er.width / box.offsetWidth : 1;
    const x = (ir.left - er.left + ir.width * 0.72) / k, y = (ir.top - er.top + ir.height * 0.12) / k;
    this._zn = ((this._zn || 0) + 1) % 3;
    const z = h('span.neru-z', 'z'); z.style.left = `${x}px`; z.style.top = `${y}px`; z.style.fontSize = `${size + this._zn * size / 3}px`;
    box.append(z);
    z.animate([{ transform: 'translate(-50%, -50%) rotate(-12deg) scale(.6)', opacity: 0 }, { transform: 'translate(calc(-50% + 10px), calc(-50% - 18px)) rotate(4deg) scale(1)', opacity: 1, offset: 0.3 },
      { transform: 'translate(calc(-50% + 34px), calc(-50% - 62px)) rotate(14deg) scale(1.1)', opacity: 0 }], { duration: 2400, easing: 'ease-out' }).onfinish = () => z.remove();
  },

  // ── new songs: five or more beatmap sets more than when she last saw the library (back on the main menu, or added
  // while she's there) — she cheers
  newSongs() {
    const n = typeof BeatmapManager !== 'undefined' ? BeatmapManager.sets.length : 0, was = this._sets;
    this._sets = n;
    if (was == null || n - was < 5 || Screens.currentName !== 'home') return;
    clearTimeout(this._newT);
    this._newT = setTimeout(() => { if (this.act('cheer', 2200, { sparkle: true })) UISounds.play('check-on'); }, 900);
  },

  // ── a hundred clicks on her in one visit to the main menu: whatever her mood, she gives up — her happy face, a
  // shower of hearts and sparkles
  HUNDRED: 100,
  /** One of her secrets found: its medal (Medals.egg), the first time. */
  found(what) { if (typeof Medals !== 'undefined') Medals.egg(`neru-${what}`); },
  hundred() {
    this.found('hundred');
    const M = NeruMascot;
    M._happyUntil = M._actUntil = 0; clearTimeout(M._back); this.stopStare();
    if (M.el) M.el.classList.remove('huff', 'shake');
    if (!this.act('happy', 3200, { sparkle: true })) return;
    UISounds.play('check-on');
    for (let i = 0; i < 10; i++) setTimeout(() => this.heart(), i * 110);
    for (const t of [600, 1300, 2000]) setTimeout(() => { if (M.img && M.img.dataset.pose === 'happy') { M._bob = 1; M.sparkle(); } }, t);
  },

  /** The anger mark — the cross of four curved strokes over her head, pulsing — and a few puffs of steam: a huff,
   *  wherever she is (`el`: her element; what's over her head is placed by --nm-top). */
  fume(el) {
    if (!Settings.get('ui.animSpeed')) return;
    const light = document.documentElement.classList.contains('slow'); // (lighter: the mark alone, no steam)
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), g = document.createElementNS(NS, 'g');
    svg.setAttribute('viewBox', '0 0 40 40');
    for (const [k, v] of [['fill', 'none'], ['stroke', '#ff3b5c'], ['stroke-width', '5'], ['stroke-linecap', 'round']]) g.setAttribute(k, v);
    for (const d of ['M16 4c0 7-5 12-12 12', 'M24 4c0 7 5 12 12 12', 'M16 36c0-7-5-12-12-12', 'M24 36c0-7 5-12 12-12']) { const pa = document.createElementNS(NS, 'path'); pa.setAttribute('d', d); g.append(pa); }
    svg.append(g);
    const vein = h('span.neru-vein', svg);
    el.append(vein);
    vein.animate([{ transform: 'scale(0) rotate(-30deg)', opacity: 0 }, { transform: 'scale(1.25) rotate(8deg)', opacity: 1, offset: 0.18 }, { transform: 'scale(.9)', offset: 0.3 },
      { transform: 'scale(1.1)', offset: 0.45 }, { transform: 'scale(.95)', offset: 0.6 }, { transform: 'scale(1.05)', opacity: 1, offset: 0.85 }, { transform: 'scale(1.2)', opacity: 0 }],
      { duration: 2400, easing: 'ease-out' }).onfinish = () => vein.remove();
    if (!light) for (let i = 0; i < 3; i++) setTimeout(() => {
      if (!el.isConnected) return;
      const p = h('span.neru-puff'); p.style.left = `${30 + i * 14}%`;
      el.append(p);
      p.animate([{ transform: 'translate(-50%, 0) scale(.3)', opacity: 0 }, { transform: 'translate(-50%, -18px) scale(1)', opacity: 0.85, offset: 0.25 },
        { transform: `translate(calc(-50% + ${(i - 1) * 22}px), -60px) scale(1.6)`, opacity: 0 }], { duration: 1100, easing: 'cubic-bezier(.22, 1, .36, 1)' }).onfinish = () => p.remove();
    }, 120 + i * 160);
  },
  /** A short act of the main menu's Neru: `pose` for `ms`, then back to herself — unless she's in the middle of
   *  something else (a huff, being held…), which goes first. */
  act(pose, ms = 1600, { hop = true, sparkle = false } = {}) {
    const M = NeruMascot;
    if (!M.img || M.busy() || !M.has(pose)) return false;
    M._actUntil = performance.now() + ms; M._idle = false;
    M.show(pose, { pop: false });
    if (hop && M.el) { M.el.classList.remove('hop'); void M.el.offsetWidth; M.el.classList.add('hop'); }
    if (sparkle) M.sparkle();
    clearTimeout(this._actT);
    this._actT = setTimeout(() => { if (!M.busy()) M.show(M.rest()); }, ms + 30);
    return true;
  },

  // ── your name is hers: the first time she sees it (once a session), a double take — she laughs — then a wagging finger
  namesake() {
    if (this._named || !/^\s*neru\s*$/i.test(ProfileManager.profile.name || '')) return;
    this._named = true;
    setTimeout(() => {
      if (!this.act('mock', 1500, { hop: false })) { this._named = false; return; }
      const M = NeruMascot; if (M.el) { M.el.classList.remove('startle'); void M.el.offsetWidth; M.el.classList.add('startle'); }
      setTimeout(() => { M._actUntil = 0; this.act('point', 1500); }, 1500);
    }, 1400);
  },

  // ── a Teto or Miku fan — her name in yours, written any way at all, or the bundled Teto or Miku picture as yours:
  // there's no turning Neru off (or swapping her for a picture of your own), and the first time she sees it (once a
  // session) she lets you know what she thinks of that — a blank look, their thing in a thought bubble over her head
  // (Teto's French bread, Miku's leek), crossed out, a snicker, laughing at you, then a wagging finger. Her own name in
  // yours, or her picture as yours: she's pleased.
  /** Whether `name` has `who` ('teto', 'miku' or 'neru') in it, written any way at all: TeTo, t3t0, T.e.t.o, Тето, テト,
   *  重音…; M1KU, m i k u, Мику, ミク, 初音…; N3RU, n e r u, ネル, 亞北… */
  named(who, name) {
    let n = String(name || '').normalize('NFKC').toLowerCase();
    const JP = { teto: /テト|てと|ﾃﾄ|重音|kasane/, miku: /ミク|みく|ﾐｸ|初音|hatsune/, neru: /ネル|ねる|ﾈﾙ|亞北|亜北|akita/ };
    if (JP[who] && JP[who].test(n)) return true;
    // (look-alike letters and numbers as the letters they pass for, then everything that isn't a letter dropped)
    const LIKE = { '3': 'e', '€': 'e', 'е': 'e', 'ε': 'e', '0': 'o', 'о': 'o', 'ο': 'o', 'ø': 'o', '°': 'o', '7': 't', '+': 't', 'т': 't', 'τ': 't',
      '1': 'i', '!': 'i', '|': 'i', 'і': 'i', 'ι': 'i', 'и': 'i', 'м': 'm', 'к': 'k', 'κ': 'k', 'у': 'u', 'μ': 'u', 'υ': 'u' };
    n = [...n].map(c => LIKE[c] || c).join('').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
    // (and doubled letters as one: "tettooo", "miiikuu")
    n = n.replace(/(.)\1+/g, '$1');
    // (Teto and Miku backwards too: "otet", "ukim")
    return n.includes(who) || (who !== 'neru' && n.includes([...who].reverse().join('')));
  },
  /** Whether Teto is in your name (written any way). */
  tetoFan(name = this.myName()) { return this.named('teto', name); },
  myName() { return typeof ProfileManager !== 'undefined' && ProfileManager.profile ? ProfileManager.profile.name : ''; },
  /** Whose fan you're showing up as: { who: 'teto' | 'miku', by: 'name' | 'picture' } — your name first (Teto before
   *  Miku), then your picture (the bundled Teto or Miku one) — or null. */
  fanOf(name = this.myName(), avatar = typeof ProfileManager !== 'undefined' && ProfileManager.profile ? ProfileManager.profile.avatar : '') {
    for (const who of ['teto', 'miku']) if (this.named(who, name)) return { who, by: 'name' };
    for (const who of ['teto', 'miku']) if (avatar === `preset:${who}`) return { who, by: 'picture' };
    return null;
  },
  /** Whether she stays on whatever Settings says — for a Teto or Miku fan (to make fun of them) and one of her own. */
  stays() { return !!this.fanOf() || this.neruFan(); },
  /** Turning her off (or swapping her for a picture of your own) while she stays: she won't have it — up she peeks,
   *  laughing at a Teto or Miku fan with their thing crossed out over her head, offended at one of her own. */
  refuse() {
    const f = this.fanOf(), side = document.querySelector('.settings-panel:not(.out)') ? 'right' : null;
    this.peek(f ? 'failed' : 'refused', { found: false, side, then: el => { if (f) this.prop(f.who, el, el.querySelector('.nc-img')); else this.fume(el); } });
    return true;
  },
  fan() {
    const f = this.fanOf();
    this._wasFan = JSON.stringify([f, this.neruFan()]); // (what a change of name or picture is told apart from)
    // (turned off before: she's back — and says so before she starts on you)
    const late = this.back(f) ? 2300 : 0;
    if (!f) { this.ownPicture(late); return; }
    if (this._fanSeen) return;
    this._fanSeen = true;
    clearTimeout(this._fanT);
    // (each step only if she's still in the one before: a click, a drag or leaving the menu ends it there)
    const M = NeruMascot, then = (pose, ms, fn) => { this._fanT = setTimeout(() => { if (M.img && M.img.dataset.pose === pose) { M._actUntil = 0; fn(); } }, ms); };
    for (const f2 of this.PHOTOS[f.who] || []) new Image().src = Host.asset(`neru-photos/${f2}`); // (ready before she shows one)
    this._fanT = setTimeout(() => {
      if (!this.act('huh', 1500, { hop: false })) { this._fanSeen = false; return; }
      if (M.el) { M.el.classList.remove('startle'); void M.el.offsetWidth; M.el.classList.add('startle'); }
      this.found('teto');
      setTimeout(() => this.prop(f.who), 350);
      then('huh', 1500, () => {
        if (!this.act('snicker', 1300, { hop: false })) return;
        if (M.el) { M.el.classList.remove('giggle'); void M.el.offsetWidth; M.el.classList.add('giggle'); }
        UISounds.play('click-short');
        then('snicker', 1300, () => {
          // (laughing, she holds up a photo of their character — one nobody asked to see)
          if (!this.act('mock', 2700, { hop: false })) return;
          if (M.el) { M.el.classList.remove('giggle'); void M.el.offsetWidth; M.el.classList.add('giggle'); }
          // (one time in ten with a photo of their character; placed once her new pose is in, beside it)
          if (Math.random() < this.PHOTO_CHANCE) setTimeout(() => this.photo(f.who), 450);
          then('mock', 2700, () => this.act('point', 1800));
        });
      });
    }, 1400 + late);
    // (and every couple of minutes on the main menu after that, another laugh at them)
    clearInterval(this._fanAgain);
    this._fanAgain = setInterval(() => {
      const g = this.fanOf();
      if (!g || !M.el || !M.el.isConnected) { clearInterval(this._fanAgain); return; }
      // (one time in ten a photo of their character, laughing — else their thing crossed out, with a snicker)
      const pic = Math.random() < this.PHOTO_CHANCE;
      if (document.hidden || M._idle || !this.act(pic ? 'mock' : 'snicker', pic ? 2700 : 1600, { hop: false })) return;
      if (M.el) { M.el.classList.remove('giggle'); void M.el.offsetWidth; M.el.classList.add('giggle'); }
      setTimeout(() => pic ? this.photo(g.who) : this.prop(g.who), 450);
    }, this.FAN_AGAIN_MS);
  },
  FAN_AGAIN_MS: 150000,
  /** Their character as nobody wants to see them — bald, round, smug — on photos she pulls out to laugh at
   *  (public/neru-photos/). */
  PHOTOS: {
    miku: ['miku-bald.jpg', 'miku-bald-2.jpg', 'miku-round.jpg', 'miku-lollipop.jpg', 'miku-fried.jpg', 'miku-plank.jpg', 'miku-derp.jpg', 'miku-aaa.jpg', 'miku-scream.jpg', 'miku-skibidi.jpg'],
    teto: ['teto-smug.jpg', 'teto-chibi.jpg', 'teto-fried.jpg', 'teto-pear.jpg', 'teto-hood.jpg', 'teto-bread.jpg', 'teto-mcd.jpg', 'teto-toilet.jpg'],
  },
  /** How often a laugh at them comes with a photo (else their thing crossed out): one in ten — a rare treat. */
  PHOTO_CHANCE: 0.1,
  /** A laugh at them: now and then a photo, else their thing crossed out (on the main menu's Neru, or `box`/`img`). */
  jab(who, box, img) { if (Math.random() < this.PHOTO_CHANCE && !(box && box.classList.contains('behind'))) this.photo(who, box, img); else this.prop(who, box, img); },
  /** One of them as a polaroid, taped up beside her for a moment (`ms`) — a different one from last time. */
  photo(who, box = NeruMascot.el, img = NeruMascot.img, ms = 2500) {
    const list = this.PHOTOS[who] || [];
    if (!list.length || !box || !img || !box.isConnected || box.querySelector(':scope > .neru-photo')) return null;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this._lastPhoto) i = (i + 1) % list.length;
    this._lastPhoto = i;
    const er = box.getBoundingClientRect(), ir = img.getBoundingClientRect(), k = box.offsetWidth ? er.width / box.offsetWidth : 1;
    const el = h('span.neru-photo', h('img', { src: Host.asset(`neru-photos/${list[i]}`), alt: '', draggable: 'false' }), h('i.np-tape'));
    // (beside her, a little below her face: clear of the menu's bar of buttons; on her left when she's on the right)
    const flip = box.classList.contains('right');
    Object.assign(el.style, { left: `${(ir.left - er.left + ir.width * (flip ? 0.12 : 0.88)) / k}px`, top: `${(ir.top - er.top + ir.height * 0.2) / k}px` }, flip ? { translate: '-100% 0' } : {});
    box.append(el);
    // (kept on the screen: one peeking up from the bottom edge has it higher, beside her face)
    const over = er.top + (parseFloat(el.style.top) + el.offsetHeight) * k - (innerHeight - 12);
    if (over > 0) el.style.top = `${parseFloat(el.style.top) - over / k}px`;
    const tilt = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 4);
    el.style.rotate = `${tilt}deg`;
    // (the main menu's Neru keeps her pose while it's up — NeruMascot.show — and takes the one asked for meanwhile now)
    const M = NeruMascot;
    if (box === M.el) M._afterPhoto = undefined;
    const away = () => {
      el.remove();
      if (box === M.el && M._afterPhoto !== undefined) { const n = M._afterPhoto; M._afterPhoto = undefined; M.show(n, { pop: false }); }
    };
    if (!Settings.get('ui.animSpeed')) { setTimeout(away, ms); return el; }
    // (flicked up into place with a little overshoot, and dropped away again)
    el.animate([{ transform: 'translateY(46px) scale(.55)', rotate: `${tilt * 3}deg`, opacity: 0 }, { transform: 'translateY(-6px) scale(1.04)', rotate: `${tilt * 0.5}deg`, opacity: 1, offset: 0.62 }, { transform: 'none', rotate: `${tilt}deg`, opacity: 1 }],
      { duration: 560, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    setTimeout(() => { if (el.isConnected) el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(34px) scale(.92)' }], { duration: 380, easing: 'ease-in', fill: 'forwards' }).onfinish = away; }, ms);
    return el;
  },
  /** Their thing crossed out beside a small Neru `el` (a screen's), once her picture's in. */
  propOn(el, who, delay = 600) {
    if (!el || !who) return;
    const go = (n = 0) => { const img = el.querySelector('.nc-img'); if (!el.isConnected && n > 3) return; if (!img || el.hidden) { if (n < 60) setTimeout(() => go(n + 1), 100); return; } setTimeout(() => this.prop(who, el, img), delay); };
    go();
  },
  // ── the Teto or Miku picture as yours: Neru's been at it with a marker — glasses and a moustache drawn on, wherever
  // it's big enough to see (your profile, your results); the first time this session, drawn before your eyes. Her own
  // picture as yours gets a crown instead.
  /** Where on their picture (256 × 256) her marker goes: their eyes, and the middle of the moustache (over their
   *  mouth, clear of the glasses); on hers, the crown (on top of her head) and a sparkle either side. */
  DOODLE: {
    teto: { eyes: [[85, 134], [155, 125]], lip: [120, 152] },
    miku: { eyes: [[94, 101], [151, 112]], lip: [124, 138] },
    neru: { crown: [118, 40], sparkles: [[44, 70], [170, 22]] },
  },
  /** The doodle over `el` (an avatar showing `avatar`), if it's Teto's, Miku's or Neru's picture. */
  doodle(el, avatar) {
    const m = /^preset:(teto|miku|neru)(-\d+)?$/.exec(avatar || ''), at = m && this.DOODLE[m[1]];
    if (!at) return;
    const f = n => n.toFixed(1);
    // [path, when, how long, its transform, filled ('gold' for hers)]
    let strokes;
    if (at.crown) {
      // (a crown, set at a jaunty angle and coloured in gold; then a sparkle each side)
      const [cx, cy] = at.crown, star = 'M0 -9Q1 -1 9 0Q1 1 0 9Q-1 1 -9 0Q-1 -1 0 -9Z';
      strokes = [
        ['M-24 0L-28 -26L-13 -12L0 -30L13 -12L28 -26L24 0Z', 0, 520, `translate(${cx} ${cy}) rotate(-12) scale(1.15)`, 'gold'],
        ...at.sparkles.map(([x, y], i) => [star, 600 + i * 140, 170, `translate(${x} ${y}) rotate(${i ? 12 : -8}) scale(1.25)`, 'gold']),
      ];
    } else {
      const [[x1, y1], [x2, y2]] = at.eyes, [mx, my] = at.lip;
      const d = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / d, uy = (y2 - y1) / d, r = Math.min(24, d * 0.36);
      const deg = Math.atan2(uy, ux) * 180 / Math.PI;
      // (lens, bridge, lens, the arms off the sides; then a handlebar moustache, outlined a curl at a time and filled in)
      const lens = (x, y, from) => `M${f(x + r * Math.cos(from))} ${f(y + r * Math.sin(from))}a${r} ${r} 0 1 1 ${f(-2 * r * Math.cos(from))} ${f(-2 * r * Math.sin(from))}a${r} ${r} 0 1 1 ${f(2 * r * Math.cos(from))} ${f(2 * r * Math.sin(from))}`;
      const curl = 'M0 -4C-5 -9 -14 -10 -20 -6C-25 -2 -28 0 -31 -2C-34 -4 -35 -8 -33 -11C-38 -8 -38 -1 -33 2C-27 6 -16 7 -8 4C-4 3 -1 1 0 1Z';
      const lip = `translate(${mx} ${my}) rotate(${f(deg)}) scale(.9)`;
      strokes = [
        [lens(x1, y1, -2.4), 0, 300],
        [`M${f(x1 + r * ux)} ${f(y1 + r * uy)}Q${f((x1 + x2) / 2 + 9 * uy)} ${f((y1 + y2) / 2 - 9 * ux)} ${f(x2 - r * ux)} ${f(y2 - r * uy)}`, 300, 110],
        [lens(x2, y2, -0.8), 410, 300],
        [`M${f(x1 - r * ux)} ${f(y1 - r * uy)}l${f(-16 * ux + 4 * uy)} ${f(-16 * uy - 4 * ux)}M${f(x2 + r * ux)} ${f(y2 + r * uy)}l${f(16 * ux + 4 * uy)} ${f(16 * uy - 4 * ux)}`, 720, 140],
        [curl, 930, 220, lip, true],
        [curl, 1110, 220, `${lip} scale(-1 1)`, true],
      ];
    }
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 256 256'); svg.setAttribute('class', 'neru-doodle'); svg.setAttribute('aria-hidden', 'true');
    const paths = [];
    for (const cls of ['nd-halo', 'nd-ink']) {
      const g = document.createElementNS(ns, 'g'); g.setAttribute('class', cls);
      for (const [dd, at2, ms, tf, filled] of strokes) {
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', dd); p.setAttribute('pathLength', '1');
        if (tf) p.setAttribute('transform', tf);
        if (filled) p.classList.add('nd-fill');
        if (filled === 'gold') p.classList.add('nd-gold');
        g.append(p); paths.push({ p, at: at2, ms, filled });
      }
      svg.append(g);
    }
    el.classList.add('doodled');
    el.append(svg);
    // (the first one this session is drawn as you look — one made again while that's under way picks it up where it
    // is — with a snicker; after that, it's just there)
    if (!Settings.get('ui.animSpeed')) return;
    const now = performance.now();
    if (this._doodleAt == null) {
      this._doodleAt = now;
      setTimeout(() => { if (document.querySelector('.neru-doodle')) this.peek(at.crown ? 'crowned' : 'doodle', { found: false }); }, 250);
    }
    const ago = now - this._doodleAt;
    if (ago > 1600) return;
    for (const { p, at: at2, ms, filled } of paths) {
      p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: ms, delay: at2 - ago, easing: 'cubic-bezier(.45, .05, .55, .95)', fill: 'backwards' });
      if (filled) p.animate([{ fillOpacity: 0 }, { fillOpacity: 1 }], { duration: 160, delay: at2 + ms - 40 - ago, easing: 'ease-out', fill: 'backwards' });
    }
  },
  /** Whether `rec` (a beatmap) is Teto's or Miku's — their name in its title, artist or source: who, or null. */
  theirSong(rec) {
    if (!rec) return null;
    const set = typeof BeatmapManager !== 'undefined' && BeatmapManager.sets ? BeatmapManager.sets.find(x => x.id === rec.setId) : null;
    const text = [rec.title, rec.artist, set && set.titleUnicode, set && set.artistUnicode, set && set.source].filter(Boolean).join(' ');
    return ['teto', 'miku'].find(w => this.named(w, text)) || null;
  },
  /** A Neru fan — her name in yours (written any way; just "Neru" gets the namesake's tease instead), or her picture as
   *  yours: the first time she sees it (once a session), she's pleased — not that she'd say so. */
  neruFan(name = this.myName(), avatar = typeof ProfileManager !== 'undefined' && ProfileManager.profile ? ProfileManager.profile.avatar : '') {
    return avatar === 'preset:neru' || (this.named('neru', name) && !/^\s*neru\s*$/i.test(String(name || '')));
  },
  ownPicture(late = 0) {
    if (!this.neruFan() || this._ownSeen) return;
    this._ownSeen = true;
    setTimeout(() => { if (!this.act('happy', 1700, { sparkle: true })) { this._ownSeen = false; return; } for (const t of [150, 450]) setTimeout(() => this.heart(), t); }, 2800 + late);
  },
  /** Turned off in Settings, and then a Teto or Miku fan (`f`) or one of hers: she's back — turned on again, for good —
   *  and says so beside her head, smug at a fan of theirs, with a wink for one of hers. Whether she did. */
  back(f) {
    if (Settings.get('ui.mascot') || !this.stays()) return false;
    this._backing = true;
    try { Settings.set('ui.mascot', true); } finally { this._backing = false; }
    setTimeout(() => { if (this.act(f ? 'sassy' : 'wink', 2100)) this.say('I\'m back~'); }, 1100);
    return true;
  },
  /** Something she says, in a speech bubble beside her face — on the side away from the screen's edge — for `ms`. */
  say(text, box = NeruMascot.el, img = NeruMascot.img, ms = 1900) {
    if (!box || !img || !box.isConnected) return null;
    const old = box.querySelector(':scope > .neru-say');
    if (old) old.remove();
    const er = box.getBoundingClientRect(), ir = img.getBoundingClientRect(), k = box.offsetWidth ? er.width / box.offsetWidth : 1;
    const flip = box.classList.contains('right');
    const el = h(`span.neru-say${flip ? '.flip' : ''}`, text);
    Object.assign(el.style, { left: `${(ir.left - er.left + ir.width * (flip ? 0.2 : 0.8)) / k}px`, top: `${(ir.top - er.top + ir.height * 0.23) / k}px` });
    box.append(el);
    const away = () => el.remove();
    if (!Settings.get('ui.animSpeed')) { setTimeout(away, ms); return el; }
    el.animate([{ scale: 0.3, opacity: 0 }, { scale: 1.08, opacity: 1, offset: 0.6 }, { scale: 1, opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    setTimeout(() => { if (el.isConnected) el.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '0 -10px' }], { duration: 320, easing: 'ease-in', fill: 'forwards' }).onfinish = away; }, ms);
    return el;
  },
  /** Their thing in a thought bubble beside her head — Teto's French bread, Miku's leek — then struck out, the bubble
   *  shaking its head with her. */
  PROPS: {
    // the loaf, slashed on top, and a highlight
    teto: '<g transform="rotate(-14 66 38)"><rect x="34" y="29" width="66" height="19" rx="9.5" fill="#d79a52" stroke="#9c6428" stroke-width="2"/>'
      + '<path d="M40 33q34-5 56 0" stroke="#f3cf93" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>'
      + '<g stroke="#9c6428" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M46 44l7-11M58 44l7-11M70 44l7-11M82 44l7-11"/></g></g>',
    // the leek: roots, the white stalk paling into green, and three leaves fanning out
    miku: '<g transform="translate(66 39) scale(.8) rotate(-16) translate(-70 -39)"><g stroke="#b9b49c" stroke-width="1.6" stroke-linecap="round"><path d="M33 36l-6-3M33 39h-7M33 42l-6 3"/></g>'
      + '<rect x="32" y="33" width="42" height="12" rx="6" fill="#f7f8ee" stroke="#aeb79a" stroke-width="1.6"/>'
      + '<rect x="62" y="33.8" width="12" height="10.4" fill="#cfe9b4"/>'
      + '<g stroke="#2f7f2c" stroke-width="1.6" stroke-linejoin="round"><path d="M72 34c11-3 21-7 32-14-5 9-15 15-30 19z" fill="#5cc455"/><path d="M72 44c13 2 23 5 34 11-10 1-21-3-32-9z" fill="#4fb548"/>'
      + '<path d="M72 37c12-1 24 0 36 2-11 3-23 4-36 4z" fill="#45a83f"/></g>'
      + '<path d="M36 36.5h30" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".9"/></g>',
  },
  prop(who = 'teto', box = NeruMascot.el, img = NeruMascot.img) {
    if (!box || !img || !box.isConnected || box.querySelector(':scope > .neru-bread')) return null;
    const er = box.getBoundingClientRect(), ir = img.getBoundingClientRect(), k = box.offsetWidth ? er.width / box.offsetWidth : 1;
    // (beside her face, on the side away from the screen's edge — over her head it would be under the menu's bar; one
    // peeking up on the right has it on her left, the other way round)
    const flip = box.classList.contains('right'), tx = flip ? '-88%' : '-12%';
    const el = h(`span.neru-bread.nb-${who}${flip ? '.flip' : ''}`);
    Object.assign(el.style, { left: `${(ir.left - er.left + ir.width * (flip ? 0.14 : 0.86)) / k}px`, top: `${(ir.top - er.top + ir.height * 0.04) / k}px` });
    el.innerHTML = '<svg viewBox="0 0 120 84">'
      // the bubble: a cloud, and two small puffs trailing down to her
      + '<g fill="#fff" stroke="rgba(0,0,0,.18)" stroke-width="1.5"><circle cx="8" cy="78" r="4.5"/><circle cx="19" cy="66" r="7"/>'
      + '<path d="M38 56c-12 2-18-9-11-17-6-10 5-21 15-15 4-11 20-13 26-3 8-8 23-4 23 7 11 0 15 14 7 20 5 9-4 18-13 14-5 9-19 9-24 2-7 6-19 3-23-8z"/></g>'
      + (this.PROPS[who] || this.PROPS.teto)
      // struck out
      + '<g class="nb-x" stroke="#ff3b5c" stroke-width="7" stroke-linecap="round"><path d="M44 18l46 42" pathLength="1"/><path d="M90 18L44 60" pathLength="1"/></g></svg>';
    box.append(el);
    // (gone: the main menu's Neru takes the pose she was kept from going back to meanwhile — NeruMascot.show)
    const M = NeruMascot, away = () => {
      el.remove();
      if (box === M.el && M._afterPhoto !== undefined && !box.querySelector(':scope > .neru-photo')) { const n = M._afterPhoto; M._afterPhoto = undefined; M.show(n, { pop: false }); }
    };
    const anim = !!Settings.get('ui.animSpeed');
    if (!anim) { setTimeout(away, 2600); return el; }
    el.animate([{ transform: `translate(${tx}, -50%) scale(.2)`, opacity: 0 }, { transform: `translate(${tx}, -50%) scale(1.08)`, opacity: 1, offset: 0.6 }, { transform: `translate(${tx}, -50%) scale(1)`, opacity: 1 }],
      { duration: 380, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' });
    // (the cross drawn on, stroke by stroke)
    el.querySelectorAll('.nb-x path').forEach((pa, i) => pa.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 170, delay: 900 + i * 190, easing: 'ease-in', fill: 'both' }));
    setTimeout(() => { if (el.isConnected) el.animate([{ rotate: '0deg' }, { rotate: '-7deg' }, { rotate: '6deg' }, { rotate: '-4deg' }, { rotate: '0deg' }], { duration: 420, easing: 'ease-in-out' }); }, 1300);
    setTimeout(() => { if (el.isConnected) el.animate([{ opacity: 1 }, { opacity: 0, transform: `translate(${tx}, -62%) scale(.9)` }], { duration: 420, easing: 'ease-in', fill: 'forwards' }).onfinish = away; }, 2700);
    return el;
  },

  // ── the Konami code on the main menu (↑ ↑ ↓ ↓ ← → ← → B A): she dances, a burst of sparkles on every beat of it
  CODE: ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'],
  watchCode() {
    if (this._codeOn) return;
    this._codeOn = true;
    let at = 0, w = 0, wAt = 0;
    // (ahead of the main menu's own keys: B and A — Browse… — aren't pressed for the menu when they finish the code)
    window.addEventListener('keydown', e => {
      if (Screens.currentName !== 'home' || !NeruMascot.img || e.ctrlKey || e.altKey || e.metaKey) { at = w = 0; return; }
      if (e.repeat || (e.target && e.target.closest && e.target.closest('input, textarea, select'))) return;
      // (her word, typed quickly: its last letter — O, settings — isn't the menu's when it finishes it)
      const now = performance.now();
      if (now - wAt > 1500) w = 0;
      wAt = now;
      if (e.code === this.WORD[w]) {
        if (++w === this.WORD.length) { w = 0; at = 0; e.preventDefault(); e.stopImmediatePropagation(); this.zako(); return; }
      } else w = e.code === this.WORD[0] ? 1 : 0;
      if (e.code !== this.CODE[at]) { at = e.code === this.CODE[0] ? 1 : 0; return; }
      at++;
      if (at > 8) { e.preventDefault(); e.stopImmediatePropagation(); }
      if (at === this.CODE.length) { at = 0; this.dance(); this.found('code'); }
    }, true);
  },
  // ── "zako" typed on the main menu — her song's taunt — and she laughs, then wags her finger at you, a heart and all
  WORD: ['KeyZ', 'KeyA', 'KeyK', 'KeyO'],
  zako() {
    this.found('zako');
    const M = NeruMascot;
    if (!this.act('mock', 1400, { hop: false })) return;
    UISounds.play('click-short');
    clearTimeout(this._zakoT);
    this._zakoT = setTimeout(() => { M._actUntil = 0; if (this.act('point', 1700)) for (const t of [0, 260]) setTimeout(() => this.heart(), t); }, 1400);
  },
  dance({ ms = 4600 } = {}) {
    const M = NeruMascot;
    const pose = NeruCameo.EGG.code;
    if (!M.img || M._drag || M._drop || !M.has(pose)) return;
    // (whatever she was in the middle of gives way: this is what the code is for)
    this.stopStare(); clearTimeout(M._back); M._happyUntil = M._actUntil = 0; M._idle = false; M._idlePose = null;
    M._clicks = []; // (the taps that set her dancing were the dance's: a fresh count of clicks after)
    if (M.el) M.el.classList.remove('huff', 'shake');
    if (!this.act(pose, ms, { sparkle: true })) return;
    this._danceUntil = performance.now() + ms;
    UISounds.play('check-on');
    clearInterval(this._danceT);
    // (with the music playing she dances to it — each of its beats bounces her, NeruMascot.beat — else to a beat of
    // her own)
    if (Music.playing && Music.meta && Music.meta.timing && Music.meta.timing.length) return;
    let n = 0;
    this._danceT = setInterval(() => {
      if (++n > 6 || !M.el || !M.img) { clearInterval(this._danceT); return; }
      M._bob = 1; M.sparkle();
    }, 650);
  },

  // ── tapped in time with the menu music — eight beats in a row — she dances, for as long as you keep the beat (taps
  // on the beat never count towards a huff)
  TAPS: 8,
  /** A press on her (the main menu, `e`): whether it's on a beat of the music playing — as heard when it was pressed —
   *  and how many in a row have been. */
  tap(e = null) {
    const tm = typeof Music !== 'undefined' && Music.playing && Music.meta && Music.meta.timing;
    this._onBeat = false;
    if (!tm || !tm.length) { this._taps = 0; return; }
    const t = Music.timeAt(e && e.timeStamp > 0 ? e.timeStamp : undefined), i = Math.max(0, bsearchLE(tm, t, 'time')), tp = tm[i], len = tp.beatLength;
    if (!(len > 0) || t < tp.time) { this._taps = 0; return; }
    const k = (t - tp.time) / len, d = (k - Math.round(k)) * len, n = i * 1e6 + Math.round(k);
    // (a little either side of the beat — wider for a slow song — and each tap a beat or two after the one before)
    this._onBeat = Math.abs(d) <= Math.min(90, len * 0.2);
    const gap = n - (this._tapBeat ?? -1e9);
    this._taps = this._onBeat ? (gap >= 1 && gap <= 2 ? (this._taps || 0) + 1 : 1) : 0;
    if (this._onBeat) this._tapBeat = n;
    // (dancing already: on the beat, she keeps going — and the count starts over for the next time)
    if (this.dancing()) { this._taps = 0; if (this._onBeat) this.keepDancing(len); return; }
    if (this._taps >= this.TAPS) { this._taps = 0; this.dance({ ms: Math.max(2400, len * 6) }); this.found('beat'); }
  },
  /** Whether she's dancing now (to the code, or to the beat). */
  dancing() { const now = performance.now(); return now < (this._danceUntil || 0) && now < (NeruMascot._actUntil || 0); },
  /** Still on the beat while she dances: she keeps going (a few more beats from now). */
  keepDancing(len = 500) {
    const M = NeruMascot, ms = Math.max(2400, len * 6);
    M._actUntil = this._danceUntil = performance.now() + ms;
    clearTimeout(this._actT);
    this._actT = setTimeout(() => { if (!M.busy()) M.show(M.rest()); }, ms + 30);
  },

  // ── songs skipped one after another on the main menu — three in a few seconds — a wag of her finger: make up your
  // mind (standing, never one of her pictures at her desk: changing songs didn't sit her down)
  /** Each song the menu music moves on to (the same one again — restarted, paused — isn't one). */
  skipped(map) {
    if (!map || map.id === this._song) return;
    this._song = map.id;
    if (Screens.currentName !== 'home') { this._skips = []; return; }
    const now = performance.now();
    this._skips = (this._skips || []).filter(t => now - t < 12000);
    this._skips.push(now);
    if (this._skips.length >= 3) { this._skips = []; this.act('point', 1700, { hop: false }); }
  },

  // ── her name searched for (song select, the beatmap listing): she peeks up from the bottom of the screen — "huh?
  // you called?" — and ducks back down (not when the search found nothing: the empty list has her already)
  searched(input) {
    const v = input.value || '', them = ['teto', 'miku'].find(w => this.named(w, v));
    if (!(them || /(^|[^a-z])neru([^a-z]|$)/i.test(v)) || performance.now() - (this._peekAt || -1e9) < 9000) return;
    this._peekAt = performance.now();
    // (Teto or Miku looked up, in any search box, written any way: she peeks up laughing at you — the one looked up's
    // thing crossed out, or now and then a photo of them, whoever you're a fan of)
    // (the settings open: up on the right, clear of them)
    const who = them, side = document.querySelector('.settings-panel:not(.out)') ? 'right' : null;
    setTimeout(() => { if (input.isConnected) who ? this.peek('failed', { found: false, side, then: el => this.jab(who, el, el.querySelector('.nc-img')) }) : this.peek('list', { side }); }, 300);
  },
  /** Whether Neru's on screen already — the main menu's, or a small one on another screen, a dialog or a medal: a peek
   *  then would make two of her. */
  onScreen() {
    // (one scrolled out of sight — at the foot of the settings, say — doesn't count)
    // (nor one the settings panel is over)
    const sp = document.querySelector('.settings-panel:not(.out)'), cover = sp && sp.getBoundingClientRect();
    const seen = n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && !(cover && !n.closest('.settings-panel') && r.left + r.width / 2 < cover.right); };
    return [...document.querySelectorAll('.home .neru, .neru-cameo:not(.nc-peek)')].some(n => !n.hidden && seen(n) && getComputedStyle(n).opacity !== '0');
  },
  /** A small Neru peeking up from the bottom edge of the screen for a moment, in `mood`'s pose — clicks go through her
   *  to whatever she's in front of (song select's Back button, say). `found`: her name searched for (a medal). */
  peek(mood = 'list', { found = true, side = null, then = null } = {}) {
    if (!Settings.get('ui.animSpeed') || document.querySelector('.nc-peek') || this.onScreen()) return null;
    const el = NeruCameo.make(mood, 'nc-peek');
    if (!el) return null;
    if (side === 'right') el.classList.add('right');
    // (the chat open: up from behind its top edge, never over what's being said)
    const chat = document.querySelector('.chat:not(.out)');
    let edge = chat ? chat.getBoundingClientRect().top : innerHeight;
    // (a bar along the bottom where she comes up — the back button, the results' buttons: from behind its top edge
    // too, rather than over them)
    if (!chat) for (const e of document.elementsFromPoint(side === 'right' ? innerWidth - 120 : 120, innerHeight - 3)) {
      const r = e.getBoundingClientRect();
      if (r.bottom >= innerHeight - 4 && r.height > 8 && r.height < innerHeight * 0.2) edge = Math.min(edge, r.top);
    }
    if (edge < innerHeight - 4) { el.classList.add('behind'); el.style.bottom = `${((1 - edge / innerHeight) * 100).toFixed(2)}%`; }
    document.body.append(el);
    if (found) this.found('peek');
    const up = [{ transform: 'translateY(105%)' }, { transform: 'translateY(38%)', offset: 0.55 }, { transform: 'translateY(42%)' }];
    let done = false;
    const away = () => {
      if (done) return;
      if (el.isConnected && el.querySelector(':scope > .neru-photo, :scope > .neru-bread')) { setTimeout(away, 100); return; } // (a photo she's holding up, or a thought, goes first)
      done = true;
      el.animate([{ transform: 'translateY(42%)' }, { transform: 'translateY(105%)' }], { duration: 420, easing: 'cubic-bezier(.55, 0, .75, .2)', fill: 'forwards' }).onfinish = () => el.remove();
    };
    // (once her picture's in: up, a look, and back down)
    const go = () => { if (el.hidden) { if (el.isConnected) setTimeout(go, 60); return; } el.animate(up, { duration: 650, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' }); setTimeout(away, 3200); if (then) setTimeout(() => el.isConnected && then(el), 520); };
    el.style.transform = 'translateY(105%)';
    go();
    return el;
  },

  // ── the very bottom of the settings, past everything: Neru, fast asleep at her desk (a click wakes her for a moment)
  /** `el`: her, at the foot of the settings' `scroll`; once she's scrolled into view, her medal and her z's. */
  finePrint(el, scroll) {
    if (typeof IntersectionObserver === 'undefined') return;
    let t = 0;
    const io = new IntersectionObserver(([e]) => {
      clearInterval(t);
      if (!el.isConnected) { io.disconnect(); return; }
      if (!e.isIntersecting || el.hidden) return;
      this.found('fine');
      const img = () => el.querySelector('.nc-img');
      t = setInterval(() => { if (!el.isConnected) { clearInterval(t); io.disconnect(); return; } if (img() && /neru-tired/.test(img().src)) this.snooze(el, img(), { size: 11 }); }, 1500);
    }, { root: scroll, threshold: 0.6 });
    io.observe(el);
  },

  // ── first on the rankings, or on today's daily challenge: she peeks up, sunglasses on (once a session for each — a
  // new day's challenge counts again)
  topOfTheBoard(key = 'rankings', screen = 'rankings') {
    if ((this._tops ||= new Set()).has(key)) return;
    this._tops.add(key);
    setTimeout(() => { if (Screens.currentName === screen) this.peek('perfect', { found: false }); }, 700);
  },
  // ── a multiplayer match (or a Ranked Play duel) decided: she peeks up — sunglasses on for a win, laughing at a loss, a
  // blank look at a draw. Once a match (`id`: a duel's, redrawn as it's shown)
  matchOver(how, id = null) {
    if (id && this._matchSeen === id) return;
    this._matchSeen = id;
    setTimeout(() => this.peek(how === 'won' ? 'perfect' : how === 'lost' ? 'failed' : 'list', { found: false }), 900);
  },
  // ── alone in a multiplayer room for a minute, nobody joining: she peeks up, bored — keeping you company (once a room)
  ROOM_ALONE_MS: 60000,
  roomAlone() {
    const r = typeof Multiplayer !== 'undefined' && Multiplayer.inRoom() ? Multiplayer.room : null;
    const alone = !!r && !r.qp && !r.rp && r.state === 'lobby' && r.players.length === 1;
    if (!alone) { clearTimeout(this._aloneT); this._aloneT = 0; return; }
    if (this._aloneT || (this._aloneSeen ||= new Set()).has(r.code)) return;
    this._aloneT = setTimeout(() => {
      this._aloneT = 0;
      const now = Multiplayer.inRoom() && Multiplayer.room;
      if (!now || now.code !== r.code || now.players.length !== 1 || Screens.currentName !== 'multiplayer') return;
      this._aloneSeen.add(r.code);
      this.peek('waiting', { found: false });
    }, this.ROOM_ALONE_MS);
  },
  // ── one of her songs just added to the library: she peeks up, delighted (once a beatmap set)
  /** (sets added since the game started are new: one imported again keeps when it was first added) */
  NEW_SINCE: Date.now(),
  newSet() {
    if (typeof BeatmapManager === 'undefined' || !BeatmapManager.sets) return;
    const told = this._toldSets ||= new Set();
    const fresh = BeatmapManager.sets.filter(x => (x.added || 0) >= this.NEW_SINCE && !told.has(x.id));
    for (const x of fresh) told.add(x.id);
    if (fresh.some(x => this.herSong({ title: x.title, artist: x.artist, setId: x.id }))) setTimeout(() => this.peek('herSongPass', { found: false }), 600);
  },
  // ── her name said in the chat: she peeks up to see who's talking about her (her taunt said back: she laughs)
  mentioned(text) {
    const t = String(text || '');
    const taunt = /(^|[^a-z])zako([^a-z]|$)/i.test(t), name = /(^|[^a-z])neru([^a-z]|$)/i.test(t), said = ['teto', 'miku'].find(w => this.named(w, t));
    const them = said; // (the one said, whoever you're a fan of)
    if (!(taunt || name || them) || performance.now() - (this._chatPeekAt || -1e9) < 20000) return;
    this._chatPeekAt = performance.now();
    // (Teto or Miku: she laughs, their thing crossed out over her head; on the main menu she's there already: she looks
    // round herself)
    setTimeout(() => {
      if (Screens.currentName === 'home' && NeruMascot.img) { if (this.act(them || taunt ? 'mock' : 'huh', 1600, { hop: false }) && them) setTimeout(() => this.jab(them), 450); }
      else this.peek(them || taunt ? 'failed' : 'list', { found: false, then: them ? el => this.jab(them, el, el.querySelector('.nc-img')) : null });
    }, 400);
  },

  // ── left sitting in song select — no key, click or scroll for a while — she peeks up, bored: pick something already.
  // Once a visit to song select.
  SELECT_IDLE_MS: 45000,
  selectIdle() {
    clearTimeout(this._selT);
    if (Screens.currentName !== 'songselect' || this._selPeeked) return;
    this._selT = setTimeout(() => {
      if (Screens.currentName !== 'songselect') return;
      // (not over a dialog, or while the game's in the background: she waits)
      if (Overlays.top() || document.hidden || document.querySelector('.nc-peek') || this.onScreen()) { this.selectIdle(); return; }
      this._selPeeked = true;
      this.peek('waiting', { found: false });
    }, this.SELECT_IDLE_MS);
  },

  // ── the main menu's volume turned all the way up: she cheers; all the way down: the music's gone, she's bored
  volume(v) {
    const was = this._vol; this._vol = v;
    if (was == null || Screens.currentName !== 'home') return;
    if (v >= 1 && was < 1) this.act('cheer', 1500, { sparkle: true });
    else if (v <= 0 && was > 0) this.act('bored', 1800, { hop: false });
  },

  // ── her hello, the first time she sees you: on New Year's Day — and a year on from your first play here (confetti
  // too) — a cheer and sparkles, again and again; back after a
  // week or more away, a sulk — then she can't help being glad; after midnight (till 5), a yawn — and left alone that
  // late she's bored sooner
  /** Today (its date and time, by the clock here). */
  today() { return new Date(); },
  /** Late at night (midnight till 5, by the clock here). */
  lateNight(d = this.today()) { return d.getHours() < 5; },
  /** Back after a week or more without a play (once there have been a few). */
  away(d = this.today()) {
    const sc = typeof ScoreManager !== 'undefined' ? ScoreManager.scores : [], last = sc[sc.length - 1];
    return sc.length >= 5 && !!last && d - (last.date || d) >= 7 * 864e5;
  },
  /** The day, a year or more on, of your first play here: how many years (0 on any other day). */
  anniversary(d = this.today()) {
    const first = typeof ScoreManager !== 'undefined' && ScoreManager.scores[0];
    if (!first || !first.date) return 0;
    const f = new Date(first.date), years = d.getFullYear() - f.getFullYear();
    return years >= 1 && d.getMonth() === f.getMonth() && d.getDate() === f.getDate() ? years : 0;
  },
  greet(d = this.today()) {
    const newYear = (d.getMonth() === 0 && d.getDate() === 1) || this.anniversary(d) > 0, back = this.away(d), late = this.lateNight(d);
    if (this._greeted || !(newYear || back || late)) return;
    this._greeted = true;
    clearTimeout(this._greetT);
    this._greetT = setTimeout(() => {
      const M = NeruMascot;
      if (newYear) {
        if (!this.act('cheer', 2600, { sparkle: true })) { this._greeted = false; return; }
        for (const t of [550, 1100, 1650]) setTimeout(() => { if (M.img && M.img.dataset.pose === 'cheer') { M._bob = 1; M.sparkle(); } }, t);
      } else if (back) {
        if (!this.act(NeruCameo.EGG.back, 2600, { hop: false })) { this._greeted = false; return; }
        clearTimeout(this._greetT);
        this._greetT = setTimeout(() => { if (M.img && M.img.dataset.pose === NeruCameo.EGG.back) { M._actUntil = 0; this.act('happy', 1500, { sparkle: true }); } }, 2600);
      } else if (!this.act('tired', 2400, { hop: false })) this._greeted = false;
      else this.found('night');
    }, 1600);
  },

  // ── an SS since she last saw you: back on the main menu, her sunglasses are still on for a while, catching the light
  /** The plays from `from` on (the ones since she last saw you): one an SS, and on go the sunglasses. */
  shades(from) {
    const since = ScoreManager.scores.slice(from).filter(sc => sc.own !== false);
    const perfect = since.some(sc => sc.passed && ['XH', 'X', 'SS'].includes(sc.grade));
    if (!perfect) { this.remember(since); return; }
    clearTimeout(this._mileT);
    this._mileT = setTimeout(() => {
      const M = NeruMascot;
      if (!this.act('cool', 6000, { hop: false })) return;
      for (const t of [700, 3200]) setTimeout(() => { if (M.img && M.img.dataset.pose === 'cool') this.glint(M.body, M.img); }, t);
    }, 1200);
  },

  // ── she saw that: back on the main menu after three fails in a row (and no pass since), a snicker; after a new
  // personal best at an S or better, a wag of her finger — not bad, not that she'd say so
  /** The plays since she last saw you (`since`, oldest first). */
  remember(since) {
    if (!since.length) return;
    const fails = since.length >= 3 && since.slice(-3).every(sc => !sc.passed);
    const best = !fails && since.some(sc => sc.passed && sc.isPB && ['SH', 'S'].includes(sc.grade));
    if (!fails && !best) return;
    clearTimeout(this._mileT);
    this._mileT = setTimeout(() => {
      if (fails) { if (this.act(NeruCameo.EGG.failed, 1800, { hop: false })) UISounds.play('click-short'); }
      else this.act('point', 1800, { sparkle: true });
    }, 1200);
  },

  // ── an hour of playing at a stretch: back on the main menu, she's worried about you for a moment (once) — not that
  // she'd say so
  SINCE: Date.now(),
  BREAK_MS: 3600000,
  /** On the main menu: an hour's playing (songs played to their end, or failed) since the game was opened, a look. */
  breather() {
    if (this._breather || typeof ScoreManager === 'undefined') return;
    const sc = ScoreManager.scores;
    let ms = 0;
    for (let i = sc.length - 1; i >= 0 && (sc[i].date || 0) >= this.SINCE; i--) if (sc[i].own !== false) ms += sc[i].duration || 0;
    if (ms < this.BREAK_MS) return;
    this._breather = true;
    clearTimeout(this._breatherT);
    this._breatherT = setTimeout(() => { if (!this.act(NeruCameo.EGG.longSession, 2800, { hop: false })) this._breather = false; }, 1400);
  },

  // ── on the main menu as the year turns (New Year's Eve, at midnight): a cheer, sparkles, and confetti falling
  newYearsEve(el, d = this.today()) {
    if (d.getMonth() !== 11 || d.getDate() !== 31) return;
    const ms = new Date(d.getFullYear() + 1, 0, 1) - d;
    if (ms > 6 * 3600000) return;
    clearTimeout(this._nyeT);
    this._nyeT = setTimeout(() => {
      const M = NeruMascot;
      if (!el.isConnected || M.el !== el) return;
      M._actUntil = M._happyUntil = 0;
      if (this.act('cheer', 3600, { sparkle: true })) for (const t of [500, 1000, 1500, 2000, 2500]) setTimeout(() => { if (M.img && M.img.dataset.pose === 'cheer') { M._bob = 1; M.sparkle(); } }, t);
      UISounds.play('check-on');
      for (const x of el.querySelectorAll('.neru-drift, .neru-ground')) x.remove();
      this.drift(el, 'confetti');
    }, ms);
  },

  // ── a milestone — your 100th play, 250th, 500th, 1000th… — and back on the main menu she cheers, sparkles and all
  MILESTONES: [100, 250, 500, 1000, 2500, 5000, 10000],
  /** On the main menu (each time it's shown): a milestone passed since she last saw it, a cheer. */
  milestone() {
    this.newSongs();
    const n = typeof ScoreManager !== 'undefined' ? ScoreManager.scores.length : 0, was = this._plays;
    this._plays = n;
    if (!(was > 0) || n <= was) return;
    if (!this.MILESTONES.some(m => was < m && n >= m)) { this.shades(was); return; }
    clearTimeout(this._mileT);
    this._mileT = setTimeout(() => {
      const M = NeruMascot;
      if (!this.act('cheer', 3000, { sparkle: true })) return;
      UISounds.play('check-on');
      for (const t of [450, 900, 1350, 1800, 2250]) setTimeout(() => { if (M.img && M.img.dataset.pose === 'cheer') { M._bob = 1; M.sparkle(); } }, t);
    }, 1200);
  },

  // ── the time of year, around her on the main menu: autumn leaves drifting down, snow in winter, cherry blossom in
  // spring, fireflies on a summer night, and bats across a harvest moon for Halloween — a few at a time, some behind her and some (bigger,
  // softer, nearer) in front; the other way round south of the equator (by the time zone)
  /** Which, on day `d`: 'snow' (till the spring equinox), 'petals', 'bubbles' (late spring and summer days),
   *  'fireflies' (summer evenings), 'dragonflies' (September), 'leaves', 'bats' (the last days of October), 'hearts'
   *  (Valentine's Day), or null (a May night, say). */
  seasonOf(d = this.today(), zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })()) {
    const m = d.getMonth() + 1, day = d.getDate(), hr = d.getHours();
    if (m === 10 && day >= 29) return 'bats';
    if (m === 2 && day === 14) return 'hearts';
    const south = /^(Australia|Antarctica|Pacific\/(Auckland|Chatham))|^America\/(Argentina|Sao_Paulo|Santiago|Montevideo|Asuncion|Punta_Arenas)|^Africa\/(Johannesburg|Maseru|Mbabane|Windhoek|Maputo|Harare)/.test(zone);
    const n = south ? (m + 5) % 12 + 1 : m; // (the month it'd be up north)
    if (n === 12 || n <= 2 || (n === 3 && day < 20)) return 'snow';
    if (n === 3 || n === 4) return 'petals';
    if (n === 10 || n === 11) return 'leaves';
    if (n === 9) return 'dragonflies';
    if (n >= 6 && n <= 8 && (hr >= 19 || hr < 5)) return 'fireflies';
    return n >= 5 && n <= 8 && hr >= 7 && hr < 19 ? 'bubbles' : null;
  },
  /** How each kind drifts: how big (px), how long one takes to cross (ms), how often a new one comes (ms), how many at
   *  once, how far it sways (px) and over how long (ms), how fast it flutters (ms: none for 0), how far it tilts with
   *  each sway (degrees: a heart, which doesn't flutter — it stays facing you), and its colours. */
  DRIFT: {
    leaves: { size: [22, 32], ms: [8000, 11000], every: [1500, 2600], most: 6, sway: [16, 34], swayMs: [1500, 2500], spin: [2600, 4600], colors: ['#f08c3c', '#e8663a', '#f2a23a', '#de5434', '#f5c842'] },
    snow: { size: [4, 9], ms: [8500, 13000], every: [320, 700], most: 22, sway: [8, 20], swayMs: [2400, 4000], spin: [0, 0], colors: ['#ffffff', '#f2f7ff', '#e6f0ff'] },
    petals: { size: [17, 24], ms: [8000, 11500], every: [1000, 1900], most: 8, sway: [20, 40], swayMs: [1700, 2900], spin: [2200, 3800], colors: ['#ffc4d8', '#ffb3cb', '#ffd8e6', '#f9a8c4'] },
    fireflies: { size: [5, 7], ms: [6000, 9000], every: [800, 1500], most: 8, sway: [18, 36], swayMs: [2600, 4200], spin: [0, 0], colors: ['#e8ff8a', '#fff59a', '#c8ff7a'] },
    bats: { size: [42, 56], ms: [4800, 6800], every: [2600, 5200], most: 3, sway: [8, 14], swayMs: [700, 1000], spin: [0, 0], colors: ['#160d1f', '#1d1228', '#120a19'] },
    confetti: { size: [11, 16], ms: [6500, 9000], every: [220, 520], most: 22, sway: [10, 24], swayMs: [900, 1600], spin: [600, 1200], colors: ['#ff6fa8', '#ffd54a', '#8fd3ff', '#9be15d', '#c49bff', '#ff9f43'] },
    bubbles: { size: [14, 30], ms: [7000, 10500], every: [900, 1800], most: 7, sway: [10, 22], swayMs: [1600, 2600], spin: [0, 0], colors: ['#bfe9ff', '#ffd1f0', '#d6ffe9', '#fff3c4'] },
    dragonflies: { size: [30, 40], ms: [6500, 9500], every: [2200, 4200], most: 3, sway: [3, 6], swayMs: [500, 800], spin: [0, 0], colors: ['#d9452f', '#e2582c', '#c93a2a'] },
    hearts: { size: [18, 27], ms: [8000, 11000], every: [900, 1700], most: 8, sway: [14, 28], swayMs: [1800, 2800], spin: [0, 0], tilt: [8, 16], colors: ['#ff6fa8', '#ff8fc0', '#ff4d8d', '#ffb3d1'] },
  },
  /** Christmas Eve and Day: twice the snow. */
  christmas(d = this.today()) { return d.getMonth() === 11 && (d.getDate() === 24 || d.getDate() === 25); },
  /** April Fools' Day: she's the other way round all day, and laughs when clicked. */
  foolsDay(d = this.today()) { return d.getMonth() === 3 && d.getDate() === 1; },
  /** Valentine's Day: a click brings hearts too. */
  valentine(d = this.today()) { return d.getMonth() === 1 && d.getDate() === 14; },
  /** The shape of one: an SVG, coloured `c` (a gold leaf: a ginkgo's fan). */
  driftShape(kind, c) {
    if (kind === 'leaves' && c === '#f5c842') return `<svg viewBox="0 0 24 24"><path fill="${c}" d="M12 14.5C7.2 14.5 2.6 11 2 4.6 5 2.4 9.2 2.1 11.2 3.6L12 6.2l.8-2.6c2-1.5 6.2-1.2 9.2 1C21.4 11 16.8 14.5 12 14.5z"/><path fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round" d="M12 14v8.5"/><path fill="none" stroke="rgba(150,100,20,.4)" stroke-width=".8" stroke-linecap="round" d="M12 13.6 7 6.5M12 13.6 9.4 5M12 13.6l2.6-8.6M12 13.6 17 6.5"/></svg>`;
    if (kind === 'leaves') return `<svg viewBox="0 0 24 24"><path fill="${c}" d="M12 1.5c-3.6 3-6.8 6.6-6.8 11.2 0 4 2.9 7 6.1 8.1V23h1.4v-2.2c3.2-1.1 6.1-4.1 6.1-8.1 0-4.6-3.2-8.2-6.8-11.2z"/><path fill="none" stroke="rgba(90,40,20,.45)" stroke-width="1" stroke-linecap="round" d="M12 4v17M12 10l-3.2-2.6M12 10l3.2-2.6M12 14.5l-4-3M12 14.5l4-3"/></svg>`;
    if (kind === 'petals') return `<svg viewBox="0 0 20 20"><path fill="${c}" d="M10 19C4.6 15.6 2.6 10.6 4.2 6.2 5.2 3.4 7.4 1.6 8.8 1l1.2 2.4L11.2 1c1.4.6 3.6 2.4 4.6 5.2 1.6 4.4-.4 9.4-5.8 12.8z"/><path fill="none" stroke="rgba(230,110,150,.5)" stroke-width=".8" stroke-linecap="round" d="M10 17V7"/></svg>`;
    if (kind === 'dragonflies') return `<svg viewBox="0 0 32 32"><g fill="rgba(235,245,255,.6)" stroke="rgba(255,255,255,.85)" stroke-width=".6"><ellipse cx="9" cy="11" rx="8" ry="2.6" transform="rotate(-8 9 11)"/><ellipse cx="23" cy="11" rx="8" ry="2.6" transform="rotate(8 23 11)"/><ellipse cx="9.5" cy="15.5" rx="7" ry="2.3" transform="rotate(10 9.5 15.5)"/><ellipse cx="22.5" cy="15.5" rx="7" ry="2.3" transform="rotate(-10 22.5 15.5)"/></g><rect x="15" y="9" width="2" height="21" rx="1" fill="${c}"/><circle cx="16" cy="7.5" r="2.4" fill="${c}"/></svg>`;
    if (kind === 'confetti') return `<svg viewBox="0 0 10 10"><rect y="2" width="10" height="6" rx="1" fill="${c}"/></svg>`;
    if (kind === 'hearts') return `<svg viewBox="0 0 24 22"><path fill="${c}" d="M12 21.4l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.6L12 21.4z"/></svg>`;
    if (kind === 'bats') return `<svg viewBox="0 0 32 16"><path fill="${c}" d="M16 5.2c.7-1.6 1.4-2.6 1.4-2.6l.6 2.4c3.4-2.6 8.6-3.8 13-2.4-1.8 1-3 2.8-3.4 5.4-1.8-1.2-4-1.2-5.6.4-1-1.2-2.8-1.4-4-.2-.4 1.4-1.2 2.6-2 3.4-.8-.8-1.6-2-2-3.4-1.2-1.2-3-1-4 .2-1.6-1.6-3.8-1.6-5.6-.4C4 5.6 2.8 3.8 1 2.8c4.4-1.4 9.6-.2 13 2.4l.6-2.4s.7 1 1.4 2.6z"/></svg>`;
    return ''; // (snow, fireflies: a soft dot — its colour from CSS)
  },
  /** `el`'s size, read again only every few seconds: a new leaf or snowflake every fraction of a second mustn't make
   *  the page work out its layout each time (on a slow Chromebook, that's what costs). */
  measure(el) {
    let w = 0, hh = 0, at = -1e9;
    return () => { const t = performance.now(); if (t - at > 4000 || !w) { w = el.offsetWidth; hh = el.offsetHeight; at = t; } return [w, hh]; };
  },
  /** Something come down to rest on the ground at her feet (`ground`): a leaf or a petal lying where it fell (nine at
   *  most — the oldest fades as another lands), or a little more snow on the drift there. */
  settle(ground, kind, x, c) {
    if (kind === 'snow') {
      let pile = ground.querySelector('.nd-pile');
      if (!pile) ground.append(pile = h('span.nd-pile'));
      pile.style.height = `${Math.min(18, (parseFloat(pile.style.height) || 0) + 0.35).toFixed(2)}px`;
      return;
    }
    const lying = ground.querySelectorAll('.nd-rest:not(.going)');
    if (lying.length >= 9) { const old = lying[0]; old.classList.add('going'); old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, fill: 'forwards' }).onfinish = () => old.remove(); }
    const sz = this.DRIFT[kind].size[1] * (0.7 + Math.random() * 0.25), leaf = h('span.nd-rest');
    leaf.innerHTML = this.driftShape(kind, c);
    Object.assign(leaf.style, { left: `${x}px`, width: `${sz}px`, height: `${sz}px`, bottom: `${(Math.random() * 6).toFixed(1)}px`, transform: `translateX(-50%) rotate(${(Math.random() * 360).toFixed(0)}deg) scaleY(.55)` });
    ground.append(leaf);
    leaf.animate([{ opacity: 0, translate: '0 -6px' }, { opacity: 1, translate: '0 0' }], { duration: 500, easing: 'ease-out' });
  },
  /** A bubble popped: a little burst, and gone. */
  pop(p) {
    for (const a of p.getAnimations({ subtree: true })) a.pause();
    p.style.pointerEvents = 'none';
    UISounds.play('click-short');
    p.animate([{ scale: 1, opacity: 1 }, { scale: 1.6, opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' }).onfinish = () => p.remove();
  },
  /** A time of year seen around her (kept, as a setting: on every device of yours) — four different, and a medal. */
  SEASONS: ['snow', 'petals', 'bubbles', 'fireflies', 'dragonflies', 'leaves', 'bats', 'hearts'],
  seen(kind) {
    if (!this.SEASONS.includes(kind)) return;
    const had = Settings.get('neru.seasons') || [];
    if (!had.includes(kind)) Settings.set('neru.seasons', had.concat(kind));
    if (new Set((Settings.get('neru.seasons') || []).filter(k => this.SEASONS.includes(k))).size >= 4) this.found('seasons');
  },
  /** How far through its month the moon is on `d` (0 new, 0.5 full): from a new moon known to the minute (6 January
   *  2000, 18:14 UTC), a synodic month at a time. */
  moonPhase(d = this.today()) {
    const days = (d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 864e5, m = 29.530588853;
    return ((days / m) % 1 + 1) % 1;
  },
  /** The moon as it is on `d`: its lit part (waxing on the right, waning on the left), the rest only just there. */
  moon(d = this.today()) {
    const p = this.moonPhase(d), k = Math.cos(2 * Math.PI * p), r = 10, rx = (r * Math.abs(k)).toFixed(2), waxing = p < 0.5;
    // (the lit limb, top to bottom on its side, then back up along the terminator — bulging into the light for a
    // crescent, out of it for a gibbous moon)
    const lit = `M10 0A10 10 0 0 ${waxing ? 1 : 0} 10 20A${rx} 10 0 0 ${waxing ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0)} 10 0Z`;
    const m = h('span.nd-moon', { dataset: { phase: p.toFixed(3) } });
    m.innerHTML = `<svg viewBox="-1 -1 22 22"><circle cx="10" cy="10" r="10" fill="#c9cfe0" opacity=".1"/><path d="${lit}" fill="#f4f1e4"/></svg>`;
    return m;
  },
  /** Night (10pm till 5, by the clock here): stars come out. */
  night(d = this.today()) { const hr = d.getHours(); return hr >= 22 || hr < 5 || (this.tanabata(d) && hr >= 19); },
  /** Tanabata (7 July, the star festival): the stars out from the evening, and shooting stars one after another. */
  tanabata(d = this.today()) { return d.getMonth() === 6 && d.getDate() === 7; },
  /** Stars twinkling high up around the main menu's Neru (`el`) — far off, behind whatever the time of year brings —
   *  for as long as she's there. */
  twinkle(el) {
    if (!el) return;
    const html = document.documentElement, still = matchMedia('(prefers-reduced-motion: reduce)');
    const quiet = () => !Settings.get('ui.animSpeed') || still.matches || html.classList.contains('slow') || html.classList.contains('perf');
    if (quiet()) return;
    const sky = h('span.neru-sky', { 'aria-hidden': 'true' });
    el.prepend(sky);
    // (and the moon as it is tonight — not at Halloween, which has its own)
    if (this.seasonOf() !== 'bats') sky.append(this.moon());
    let n = 0;
    const box = this.measure(sky);
    const one = () => {
      const [W, H] = box();
      if (!W || !H) return;
      const st = h('span.nd-star'), sz = 13 + Math.random() * 9;
      st.innerHTML = '<svg viewBox="0 0 20 20"><path d="M10 0l2.6 7.4L20 10l-7.4 2.6L10 20l-2.6-7.4L0 10l7.4-2.6z"/></svg>';
      // (in the open sky beside her — to her right, or a few to her left — not behind her, where they'd never be seen)
      const x = Math.random() < 0.72 ? 0.75 + Math.random() * 0.23 : 0.02 + Math.random() * 0.13;
      Object.assign(st.style, { left: `${W * x}px`, top: `${H * (0.22 + Math.random() * 0.66)}px`, width: `${sz}px`, height: `${sz}px` });
      sky.append(st); n++;
      st.animate([{ opacity: 0, transform: 'translate(-50%, -50%) scale(.3) rotate(0deg)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1) rotate(45deg)', offset: 0.5 },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(.3) rotate(90deg)' }], { duration: 1800 + Math.random() * 1400, easing: 'ease-in-out' }).onfinish = () => { st.remove(); n--; };
    };
    const go = () => {
      if (!el.isConnected || !sky.isConnected) { sky.remove(); return; }
      setTimeout(go, 350 + Math.random() * 650);
      if (!document.hidden && n < 8 && !quiet()) one();
    };
    setTimeout(go, 500);
    // (now and then, a shooting star)
    const wishes = this.tanabata();
    const shooting = () => { if (!el.isConnected || !sky.isConnected) return; if (!document.hidden && !quiet()) this.shoot(sky, box); setTimeout(shooting, wishes ? 3500 + Math.random() * 4500 : 18000 + Math.random() * 22000); };
    setTimeout(shooting, wishes ? 1500 : 5000 + Math.random() * 7000);
  },
  /** A shooting star across `sky` (its size `box()`): a bright streak, down and away, gone in a moment. */
  shoot(sky, box = this.measure(sky)) {
    const [W, H] = box();
    if (!W || !H) return;
    // (in the open sky to her right, down and away from her — not behind her, where it'd never be seen)
    const s = h('span.nd-shoot'), x0 = W * (0.76 + Math.random() * 0.08), y0 = H * (0.25 + Math.random() * 0.2), dx = W * (0.12 + Math.random() * 0.08), dy = H * (0.2 + Math.random() * 0.12);
    const a = Math.atan2(dy, dx) * 180 / Math.PI;
    sky.append(s);
    s.animate([{ transform: `translate(${x0}px, ${y0}px) rotate(${a}deg) scaleX(.2)`, opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: `translate(${x0 + dx * 0.6}px, ${y0 + dy * 0.6}px) rotate(${a}deg) scaleX(1)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${x0 + dx}px, ${y0 + dy}px) rotate(${a}deg) scaleX(.6)`, opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.3, .1, .5, 1)' }).onfinish = () => s.remove();
  },
  /** Starts the time of year drifting around the main menu's Neru (`el`), for as long as she's there. */
  drift(el, kind = this.seasonOf()) {
    const K = kind === 'snow' && this.christmas() ? { ...this.DRIFT.snow, every: [150, 360], most: 34 } : this.DRIFT[kind];
    if (!K || !el) return;
    const html = document.documentElement, still = matchMedia('(prefers-reduced-motion: reduce)');
    const quiet = () => !Settings.get('ui.animSpeed') || still.matches || html.classList.contains('slow') || html.classList.contains('perf');
    if (quiet()) return;
    const back = h(`span.neru-drift.nd-${kind}`, { 'aria-hidden': 'true' }), front = h(`span.neru-drift.nd-${kind}.nd-front`, { 'aria-hidden': 'true' });
    // (and the ground at her feet, where what falls can settle)
    const ground = ['leaves', 'petals', 'snow'].includes(kind) ? h(`span.neru-ground.nd-${kind}`, { 'aria-hidden': 'true' }) : null;
    el.prepend(back); el.append(front);
    if (ground) el.append(ground);
    // (seen, once it's been there a while — not a glimpse)
    setTimeout(() => { if (back.isConnected) this.seen(kind); }, 20000);
    const r = ([a, b]) => a + Math.random() * (b - a), pick = a => a[Math.floor(Math.random() * a.length)];
    let n = 0;
    const box = this.measure(back); // (the layer in front is the same size)
    /** One more, on its way across (`pre`: already part of the way, as if it had been falling a while). */
    const one = (pre = false) => {
      const near = Math.random() < 0.28, layer = near ? front : back, [W, H] = box();
      if (!W || !H) return;
      const size = r(K.size) * (near ? 1.3 : 1), ms = r(K.ms) * (near ? 0.85 : 1), c = pick(K.colors);
      // three layers: the fall (or flight) across, the sway from side to side, and the turn (or flap, or glow)
      const p = h('span.nd'), sway = h('i'), spin = h('i');
      spin.innerHTML = this.driftShape(kind, c);
      if (!spin.firstChild) { spin.className = 'nd-dot'; if (kind === 'bubbles') spin.style.setProperty('--c', c); else spin.style.background = c; }
      Object.assign(p.style, { width: `${size}px`, height: `${size * (kind === 'bats' ? 0.5 : 1)}px` });
      sway.append(spin); p.append(sway); layer.append(p); n++;
      let path;
      if (kind === 'bats') {
        // (across her, from one side to the other, climbing a little; facing the way it flies)
        const ltr = Math.random() < 0.5, y0 = H * r([0.12, 0.42]), y1 = y0 - H * r([0.04, 0.12]);
        path = [{ transform: `translate(${ltr ? -size * 2 : W + size}px, ${y0}px)` }, { transform: `translate(${ltr ? W + size : -size * 2}px, ${y1}px)` }];
        if (!ltr) spin.style.scale = '-1 1';
        endless(spin, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.45) translateY(12%)' }], { duration: r([150, 210]), iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
      } else if (kind === 'bubbles') {
        // (up from the floor, drifting, and — somewhere along the way — pop)
        const x = W * r([0.02, 0.98]), top = H * r([0.05, 0.45]), x1 = x + r([-30, 30]);
        path = [{ transform: `translate(${x}px, ${H + size}px) scale(.6)`, opacity: 0 }, { opacity: 0.9, offset: 0.1 }, { transform: `translate(${x1}px, ${top}px) scale(1)`, opacity: 0.9, offset: 0.93 },
          { transform: `translate(${x1}px, ${top}px) scale(1.4)`, opacity: 0 }];
      } else if (kind === 'dragonflies') {
        // (darting from one spot to the next, hovering at each — facing the way it goes)
        const pts = [];
        for (let i = 0; i < 5; i++) pts.push([W * r([0.04, 0.96]), H * r([0.12, 0.7])]);
        path = pts.map(([x, y], i) => {
          const [nx, ny] = pts[Math.min(i + 1, pts.length - 1)], [px, py] = pts[Math.max(i - 1, 0)];
          const a = Math.atan2((i < pts.length - 1 ? ny - y : y - py), (i < pts.length - 1 ? nx - x : x - px)) * 180 / Math.PI + 90;
          return { transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${a.toFixed(1)}deg)`, opacity: i === 0 || i === pts.length - 1 ? 0 : 1, offset: i / (pts.length - 1), easing: 'cubic-bezier(.6, 0, .2, 1)' };
        });
        endless(spin, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(.82)' }], { duration: 70, iterations: Infinity, direction: 'alternate' });
      } else if (kind === 'fireflies') {
        // (where it is, low around her, glowing up and fading as it wanders)
        const x = W * r([0.05, 0.95]), y = H * r([0.35, 0.95]);
        path = [{ transform: `translate(${x}px, ${y}px)`, opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { transform: `translate(${x + r([-30, 30])}px, ${y - r([10, 40])}px)`, opacity: 0 }];
        endless(spin, [{ opacity: 0.35, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1.1)' }], { duration: r([900, 1600]), iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
      } else {
        // (down from above her head to the floor)
        const x = W * r([0.02, 0.98]);
        path = [{ transform: `translate(${x}px, ${-size * 2}px)` }, { transform: `translate(${x + r([-40, 40])}px, ${H + size}px)` }];
        const turn = r(K.spin);
        if (turn) {
          // (a leaf or a petal flutters as it falls — turning a little towards you and away — at an angle of its own)
          const a = Math.random() * 360, f = r([35, 65]);
          endless(spin, [{ transform: `rotate(${a}deg) rotateY(${-f}deg) rotateX(${f * 0.4}deg)` }, { transform: `rotate(${a + r([-40, 40])}deg) rotateY(${f}deg) rotateX(${-f * 0.4}deg)` }],
            { duration: turn, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', delay: -Math.random() * turn });
        }
      }
      // (side to side as it comes down — a leaf or a petal tilting with each swing, like a pendulum)
      const amp = r(K.sway), tilt = K.tilt ? r(K.tilt) : K.spin[1] ? r([18, 30]) : 0;
      // (a bat bobs up and down as it flies instead)
      const ax = kind === 'bats' ? 'translateY' : 'translateX';
      endless(sway, [{ transform: `${ax}(${-amp}px) rotate(${-tilt}deg)` }, { transform: `${ax}(${amp}px) rotate(${tilt}deg)` }], { duration: r(K.swayMs), iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', delay: -Math.random() * 2000 });
      // (a bubble behind her can be popped: a click on one)
      if (kind === 'bubbles' && !near) p.addEventListener('pointerdown', e => { e.stopPropagation(); this.pop(p); n--; });
      const fell = p.animate(path, { duration: ms, easing: 'linear', delay: pre ? -ms * r([0.15, 0.75]) : 0 });
      fell.onfinish = () => {
        p.remove(); n--; Endless.sweep();
        // (now and then one that's come down settles at her feet)
        if (ground && ground.isConnected && Math.random() < (kind === 'snow' ? 0.5 : 0.35)) this.settle(ground, kind, W * r([0.08, 0.92]), c); // (the ground's as wide as the drift)
      };
    };
    const spawn = () => {
      if (!el.isConnected || !back.isConnected) { back.remove(); front.remove(); if (ground) ground.remove(); return; }
      setTimeout(spawn, r(K.every));
      if (!document.hidden && n < K.most && !quiet()) one();
    };
    // (the first few already on their way when she comes in: not an empty sky that slowly fills)
    setTimeout(() => { if (el.isConnected && !quiet()) for (let i = Math.max(1, Math.round(K.most / 3)); i > 0; i--) one(true); spawn(); }, 400);
  },

  // ── her sunglasses (an SS, or the pointer kept on her on the main menu): now and then a glint runs across them
  /** One glint across the sunglasses of her "cool" picture `img` (inside `box`): a streak of light over the lenses and
   *  a twinkle at their corner. */
  glint(box, img) {
    if (!box || !img || !img.isConnected || !Settings.get('ui.animSpeed') || !img.offsetWidth) return;
    const w = img.offsetWidth, hh = img.offsetHeight, x0 = img.offsetLeft, y0 = img.offsetTop;
    // (where the lenses are in that picture, as fractions of it)
    const g = h('span.neru-glint', h('i'));
    Object.assign(g.style, { left: `${x0 + w * 0.48}px`, top: `${y0 + hh * 0.405}px`, width: `${w * 0.33}px`, height: `${hh * 0.045}px` });
    box.append(g);
    g.firstChild.animate([{ transform: 'translateX(-120%) skewX(-20deg)', opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.7 }, { transform: 'translateX(320%) skewX(-20deg)', opacity: 0 }],
      { duration: 650, easing: 'cubic-bezier(.4, 0, .2, 1)' });
    const star = h('span.neru-twinkle');
    Object.assign(star.style, { left: `${x0 + w * 0.8}px`, top: `${y0 + hh * 0.405}px` });
    box.append(star);
    star.animate([{ transform: 'translate(-50%, -50%) scale(0) rotate(0deg)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1) rotate(45deg)', opacity: 1, offset: 0.5 },
      { transform: 'translate(-50%, -50%) scale(0) rotate(90deg)', opacity: 0 }], { duration: 520, delay: 420, easing: 'ease-out', fill: 'backwards' }).onfinish = () => star.remove();
    setTimeout(() => g.remove(), 700);
  },
  /** Glints every few seconds for as long as she wears them (`still()`). */
  glintLoop(box, img, still) {
    // (still going while she's in another pose for a moment — clicked — and glinting again once they're back on)
    const go = () => { if (!img.isConnected) return; if (still()) this.glint(box, img); setTimeout(go, 3600 + Math.random() * 1800); };
    setTimeout(go, 900);
  },

  // ── fishing (the loading screen, a pause that went on): click her and the fish on her line flops about — swinging
  // from its mouth, drops flying off its tail
  /** Where the fish on her line is in neru-fishing.png (fractions of the picture), and its mouth, where it hangs. */
  FISH: { l: 0.866, t: 0.636, r: 0.996, b: 0.906, mx: 0.935, my: 0.642, tx: 0.93, ty: 0.9 },
  flopFish(box, img) {
    this.found('fish');
    UISounds.play('check-on');
    if (!box || !img || img._flopEnd || !Settings.get('ui.animSpeed') || !img.offsetWidth) return;
    if (!(CSS.supports('mask-composite', 'exclude') || CSS.supports('-webkit-mask-composite', 'xor'))) return;
    const F = this.FISH, w = img.offsetWidth, hh = img.offsetHeight, cs = getComputedStyle(img);
    const L = w * F.l, T = hh * F.t, W = w * (F.r - F.l), H = hh * (F.b - F.t), mx = w * F.mx, my = hh * F.my;
    // (the picture held still while it flops — its sway paused where it is — so the fish stays on its line)
    const anims = img.getAnimations(), lift = cs.translate;
    for (const a of anims) a.pause();
    // the fish: that part of the picture, laid over it and moved just as it is…
    const wrap = h('span.neru-flop'), fish = h('i');
    Object.assign(wrap.style, { left: `${img.offsetLeft}px`, top: `${img.offsetTop}px`, width: `${w}px`, height: `${hh}px`, transform: cs.transform, transformOrigin: cs.transformOrigin, translate: lift, filter: cs.filter });
    Object.assign(fish.style, { left: `${L}px`, top: `${T}px`, width: `${W}px`, height: `${H}px`, backgroundImage: `url("${img.currentSrc || img.src}")`, backgroundSize: `${w}px ${hh}px`,
      backgroundPosition: `${-L}px ${-T}px`, transformOrigin: `${mx - L}px ${my - T}px` });
    wrap.append(fish); box.append(wrap);
    // …and cut out of the picture itself while it flops
    const m = `linear-gradient(#000 0 0) 0 0 / 100% 100% no-repeat, linear-gradient(#000 0 0) ${L}px ${T}px / ${W}px ${H}px no-repeat`;
    img.style.webkitMask = m; img.style.mask = m; img.style.webkitMaskComposite = 'xor'; img.style.maskComposite = 'exclude'; img.style.translate = lift;
    img._flopEnd = () => {
      img._flopEnd = null; wrap.remove();
      for (const k of ['webkitMask', 'mask', 'webkitMaskComposite', 'maskComposite', 'translate']) img.style[k] = '';
      for (const a of anims) if (a.playState === 'paused') a.play();
    };
    const swing = [0, 24, -19, 13, -8, 4, 0], at = [0, 0.13, 0.32, 0.5, 0.67, 0.83, 1], ms = 1150;
    fish.animate(swing.map((d, i) => ({ transform: `rotate(${d}deg)`, offset: at[i], easing: 'ease-in-out' })), { duration: ms }).onfinish = () => { if (img._flopEnd) img._flopEnd(); };
    // (drops flung off its tail as it swings out, the way it was going)
    const tx = w * (F.tx - F.mx), ty = hh * (F.ty - F.my);
    for (const i of [1, 2]) setTimeout(() => {
      if (!wrap.isConnected) return;
      const th = swing[i] * Math.PI / 180, x = mx + tx * Math.cos(th) - ty * Math.sin(th), y = my + tx * Math.sin(th) + ty * Math.cos(th), dir = swing[i] > 0 ? -1 : 1;
      for (let j = 0; j < 3; j++) {
        const d = h('span.neru-drop'); Object.assign(d.style, { left: `${x}px`, top: `${y}px` });
        wrap.append(d);
        const r = 18 + Math.random() * 22, up = 8 + Math.random() * 16;
        d.animate([{ transform: 'translate(-50%, -50%) scale(.5)', opacity: 0.95 },
          { transform: `translate(calc(-50% + ${dir * r}px), calc(-50% - ${up}px)) scale(1)`, opacity: 0.9, offset: 0.45 },
          { transform: `translate(calc(-50% + ${dir * r * 1.4}px), calc(-50% + ${26 - up}px)) scale(.5)`, opacity: 0 }],
          { duration: 560 + Math.random() * 160, easing: 'cubic-bezier(.22, 1, .36, 1)' }).onfinish = () => d.remove();
      }
    }, at[i] * ms);
  },

  // ── the small Neru on other screens: her picture there stays as it is, but a click now and then gets a pose of her
  // own for a moment instead of her happy face (NeruCameo.make's `poke`)
  /** While a song loads: one far above anything you've passed — she's worried for you (not on Auto: you're not even
   *  playing). */
  // ── one of her songs — Neru (or ネル) in its title, artist or source: she dances on its loading screen
  herSong(rec) {
    if (!rec) return false;
    const set = typeof BeatmapManager !== 'undefined' && BeatmapManager.sets ? BeatmapManager.sets.find(x => x.id === rec.setId) : null;
    const text = [rec.title, rec.artist, set && set.titleUnicode, set && set.artistUnicode, set && set.source].filter(Boolean).join(' ');
    return /(^|[^a-z])neru([^a-z]|$)|ネル/i.test(text);
  },
  // ── the same song tried ten times in a row (a few minutes apart at most): she's worn out on its loading screen — again?
  TRIES: 10,
  /** Another go at `rec` (its loading screen): how many in a row now. */
  tries(rec) {
    const now = Date.now(), k = rec && (rec.hash || rec.id);
    const t = this._tries && this._tries.k === k && now - this._tries.at < 300000 ? this._tries.n + 1 : 1;
    this._tries = { k, n: t, at: now };
    return t;
  },
  // ── 727 — a 727x combo, or a score of 727,xxx — the osu! "when you see it": on the results she points it out
  wysi(sc) { return !!sc && (sc.maxCombo === 727 || Math.floor((sc.scoreStd ?? sc.score ?? 0) / 1000) === 727); },
  loaderPoke(mods = [], rec = null) { return rec && !mods.includes('AT') && this.outOfReach(rec.stars) ? NeruCameo.EGG.farAbove : null; },
  /** A star rating well past the hardest you've passed (by a star and a half, and a third again): only once you've
   *  passed a few, so a new player isn't met with it every time. */
  outOfReach(stars) {
    if (!(stars > 0) || typeof ScoreManager === 'undefined') return false;
    let best = 0, n = 0;
    for (const sc of ScoreManager.scores) if (sc.passed && !(sc.mods || []).includes('AT') && sc.stars > 0) { n++; if (sc.stars > best) best = sc.stars; }
    return n >= 3 && stars >= Math.max(best + 1.5, best * 1.35);
  },
  /** A play's results: a full combo — not one miss — gets a little dance (with sparkles); a poor one (a C or a D) a
   *  disappointed sulk. */
  resultsPoke(s) {
    const c = (s && s.passed && s.counts) || [];
    if (c.length > 5 && c[5] === 0) return NeruCameo.EGG.fullCombo;
    return s && s.passed && NeruCameo.moodOf(s) === 'bad' ? NeruCameo.EGG.poorPlay : null;
  },

  // ── the menu music's chorus (kiai): she cheers through it, bouncing harder on each beat, and stops when it ends
  chorus(on) {
    const M = NeruMascot;
    if (!!on === !!M._kiai || !M.img) { M._kiai = !!on; return; }
    M._kiai = !!on;
    if (M.busy() || M._idle) return;
    M.show(M.rest());
    if (on) M.sparkle();
  },

  // ── the pointer kept on her: after a few seconds she plays it cool — sunglasses on — then winks
  STARE_MS: 3500,
  hoverStart(e) {
    if (e && e.pointerType === 'touch') return;
    clearTimeout(this._stareT);
    // (once in a while, not every time the pointer passes)
    if (performance.now() - (this._staredAt || -1e9) < 20000) return;
    this._stareT = setTimeout(() => {
      const M = NeruMascot;
      if (!M.el || !M.el.matches(':hover') || M.busy() || !M.has('cool')) return;
      M._staring = true; this._staredAt = performance.now();
      M.show('cool', { pop: false }).then(() => setTimeout(() => { if (M._staring && M.img && M.img.dataset.pose === 'cool') this.glint(M.body, M.img); }, 350));
      this._stareT = setTimeout(() => {
        if (!M._staring) return;
        M.show(M.has('wink') ? 'wink' : null, { pop: false }); M.sparkle();
        if (M.el) { M.el.classList.remove('hop'); void M.el.offsetWidth; M.el.classList.add('hop'); }
        this._stareT = setTimeout(() => { if (!M._staring) return; M._staring = false; if (!M.busy()) M.show(M.rest()); }, 1300);
      }, 1500);
    }, this.STARE_MS);
  },
  hoverEnd() { if (!NeruMascot._staring) clearTimeout(this._stareT); },
  stopStare() { clearTimeout(this._stareT); NeruMascot._staring = false; },

  // ── picked up: press and drag her and she hangs from your pointer, swinging as it moves and wagging a finger at you;
  // let go and she drops back into her place with a bump and a puff of dust, put out about it for a moment
  press(e) {
    const M = NeruMascot;
    if (e.button || !M.body || this._p || performance.now() < (M._twirlUntil || 0) || M.el._fanBusy) return; // (mid-twirl, mid-huff: she's busy)
    // (in the page's own pixels: the interface may be scaled — UI scale — so screen pixels are divided by that)
    const r = M.body.getBoundingClientRect(), k = M.body.offsetWidth ? r.width / M.body.offsetWidth : 1;
    this._p = { id: e.pointerId, x: e.clientX, y: e.clientY, k, ox: (e.clientX - r.left) / k, oy: (e.clientY - r.top) / k, lx: e.clientX, lt: performance.now() };
    // (held still on her head a moment: a headpat)
    clearTimeout(this._patT);
    const ir = M.img && M.img.getBoundingClientRect();
    if (ir && ir.height && (e.clientY - ir.top) / ir.height < this.HEAD_TOP) this._patT = setTimeout(() => { if (this._p && !M._drag) this.pat(true); }, this.PAT_MS);
    const move = ev => {
      const p = this._p;
      if (!p || ev.pointerId !== p.id) return;
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y, t = performance.now();
      if (!M._drag) {
        // (stroking her head, mid-pat: still a pat, not picking her up)
        if (this._patting) return;
        if (Math.hypot(dx, dy) < 10 || M._drop) return;
        clearTimeout(this._patT);
        // (picked up)
        this.stopStare(); clearTimeout(M._back); M._happyUntil = 0; M.el.classList.remove('huff', 'hop', 'shake');
        M._drag = { dx: 0, dy: 0, vx: 0, ang: 0 }; M.wake();
        M.body.style.transformOrigin = `${p.ox}px ${p.oy}px`;
        M.el.classList.add('held');
        M.show(M.has('point') ? 'point' : null, { pop: false });
        UISounds.play('select-expand');
      }
      const d = M._drag, vb = M.el.getBoundingClientRect(), k = p.k || 1;
      // (kept on screen: where she's held can't be pulled past an edge, nor her feet below where she stands)
      d.dx = clamp(dx, -vb.left - p.ox * k * 0.5, innerWidth - vb.left - p.ox * k * 1.5) / k;
      d.dy = clamp(dy, -vb.top - p.oy * k + 20, 24) / k;
      d.vx = d.vx * 0.6 + ((ev.clientX - p.lx) / k / Math.max(1, t - p.lt)) * 0.4;
      // (shaken about: moved back and forth, fast, again and again)
      const v = (ev.clientX - p.lx) / k / Math.max(1, t - p.lt);
      if (Math.abs(v) > 0.7) {
        const sg = Math.sign(v);
        if (p.sg && sg !== p.sg) { p.flips = (p.flips || []).filter(x => t - x < 1500); p.flips.push(t); if (p.flips.length >= 5) d.shaken = true; }
        p.sg = sg;
      }
      p.lx = ev.clientX; p.lt = t;
      (p.hist ||= []).push([t, ev.clientX]); while (p.hist.length > 2 && t - p.hist[0][0] > 100) p.hist.shift();
    };
    const up = ev => {
      if (!this._p || ev.pointerId !== this._p.id) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      this._lastP = this._p; this._p = null;
      clearTimeout(this._patT);
      // (let go after a pat, or after being carried: not a click as well)
      if (this._patting) { M._dragged = true; setTimeout(() => { M._dragged = false; }, 400); this.pat(false); }
      if (M._drag) {
        M._dragged = true; setTimeout(() => { M._dragged = false; }, 400);
        // (flung: how fast the pointer went over its last tenth of a second — not one move's jumpy speed — and still
        // going when let go)
        const p = this._lastP, h = (p && p.hist) || [], t = performance.now(), a = h[0], b = h[h.length - 1];
        M._drag.fling = !!a && a !== b && t - b[0] < 100 && Math.abs(b[1] - a[1]) / (p.k || 1) / Math.max(16, b[0] - a[0]) > this.FLING;
        this.letGo();
      }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  },
  letGo(now = false) {
    const M = NeruMascot, d = M._drag;
    M._drag = null;
    if (M.el) M.el.classList.remove('held');
    if (now || !d || !M.body) { M._drop = null; if (M.body) M.body.style.transformOrigin = ''; return; }
    // (the further up she was, the longer the fall)
    // (flung — let go while still moving fast — or shaken about: she lands dizzy)
    M.wake();
    M._drop = { t0: performance.now(), dur: clamp(280 + Math.max(0, -d.dy) * 0.9, 300, 620), fx: d.dx, fy: d.dy, fa: d.ang, dizzy: !!d.shaken || !!d.fling };
  },
  /** Each frame while she's held or falling: her transform (and her shadow's), or null when she's on the ground. */
  held(dt, now) {
    const M = NeruMascot, d = M._drag;
    if (d) {
      // (swinging: leaning against the way she's moved, settling back as the pointer slows)
      d.vx *= Math.exp(-dt / 120);
      d.ang += (clamp(-d.vx * 26, -38, 38) - d.ang) * (1 - Math.exp(-dt / 90));
      const lift = clamp(-d.dy / 300, 0, 1);
      return { tf: `translate(${d.dx.toFixed(1)}px, ${d.dy.toFixed(1)}px) rotate(${d.ang.toFixed(2)}deg)`, sh: `translateX(${d.dx.toFixed(1)}px) scaleX(${(1 - lift * 0.55).toFixed(3)})`, so: (1 - lift * 0.7).toFixed(2) };
    }
    const f = M._drop;
    if (!f) return null;
    const k = clamp((now - f.t0) / f.dur, 0, 1), fall = k * k, side = 1 - Math.pow(1 - k, 3);
    const x = f.fx * (1 - side), y = f.fy * (1 - fall), a = f.fa * (1 - side);
    if (k >= 1) {
      // (landed: a squash, a little dust, and she's put out about it)
      M._drop = null; M.body.style.transformOrigin = ''; M._bob = 1;
      if (Settings.get('ui.animSpeed')) for (const side of [-1, 1]) {
        const p = h('span.neru-dust'); M.el.append(p);
        p.animate([{ transform: 'translate(-50%, 0) scale(.4)', opacity: 0.8 }, { transform: `translate(calc(-50% + ${side * 46}px), -10px) scale(1.4)`, opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.22, 1, .36, 1)' }).onfinish = () => p.remove();
      }
      UISounds.play('click-short');
      // (dizzy, from a fling or a shake: a blank, dazed look, stars going round her head)
      const dizzy = f.dizzy && M.has('huh'), ms = dizzy ? 2400 : 1400;
      M.show(dizzy ? 'huh' : M.has('sassy') ? 'sassy' : null, { pop: false });
      if (dizzy) { this.daze(); this.found('dizzy'); }
      M._happyUntil = now + ms;
      clearTimeout(M._back); M._back = setTimeout(() => { if (!M.busy()) M.show(M.rest()); }, ms);
      return null;
    }
    const lift = clamp(-y / 300, 0, 1);
    return { tf: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${a.toFixed(2)}deg)`, sh: `translateX(${x.toFixed(1)}px) scaleX(${(1 - lift * 0.55).toFixed(3)})`, so: (1 - lift * 0.7).toFixed(2) };
  },

  // ── dizzy: flung (let go while still moving fast) or shaken about, she lands dazed; the pointer circled round her
  // head three times, she follows it until she's dizzy — a blank look, little stars going round her head, a wobble
  FLING: 1.5,
  /** Each move of the pointer on the main menu: how far it's gone round her head (near it, not off across the
   *  screen) — three times round, either way, without stopping, and she's dizzy. */
  circle(x, y) {
    const M = NeruMascot, r = M._rect;
    if (!r || !M.img || M._drag || M._drop || M.busy() || Screens.currentName !== 'home') { this._turn = null; return; }
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.25, dist = Math.hypot(x - cx, y - cy);
    if (dist < r.width * 0.2 || dist > r.width * 1.6) { this._turn = null; return; }
    const a = Math.atan2(y - cy, x - cx), now = performance.now(), t = this._turn;
    if (!t || now - t.at > 500) { this._turn = { a, sum: 0, at: now, t0: now }; return; }
    let da = a - t.a;
    if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
    t.a = a; t.at = now; t.sum += da;
    if (now - t.t0 > 7000) { t.t0 = now; t.sum = da; } // (too slow to make anyone dizzy: from here)
    if (Math.abs(t.sum) >= 6 * Math.PI) { this._turn = null; this.dizzy(); }
  },
  dizzy() {
    this.found('dizzy');
    const M = NeruMascot;
    if (!M.has('huh') || !this.act('huh', 2400, { hop: false })) return;
    if (M.el) { M.el.classList.remove('wobble'); void M.el.offsetWidth; M.el.classList.add('wobble'); setTimeout(() => { if (M.el) M.el.classList.remove('wobble'); }, 2400); }
    this.daze();
  },
  /** Little stars going round her head, cartoon-dizzy, for `ms`. */
  daze(ms = 2300) {
    const M = NeruMascot;
    if (!M.el || !M.img || !Settings.get('ui.animSpeed') || document.documentElement.classList.contains('slow')) return;
    const er = M.el.getBoundingClientRect(), ir = M.img.getBoundingClientRect(), k = M.el.offsetWidth ? er.width / M.el.offsetWidth : 1;
    const cx = (ir.left - er.left + ir.width * 0.5) / k, cy = (ir.top - er.top + ir.height * 0.08) / k, rx = ir.width * 0.26 / k, ry = rx * 0.32;
    for (let i = 0; i < 3; i++) {
      const st = h('span.neru-dizzy');
      st.innerHTML = '<svg viewBox="0 0 20 20"><path d="M10 1.5l2.5 5.3 5.8.8-4.2 4 1 5.8-5.1-2.8-5.1 2.8 1-5.8-4.2-4 5.8-.8z"/></svg>';
      M.el.append(st);
      // (round an ellipse over her head — bigger in front, smaller going round the back)
      const frames = [];
      for (let j = 0; j <= 16; j++) {
        const an = (j / 16 + i / 3) * 2 * Math.PI, front = (Math.sin(an) + 1) / 2;
        frames.push({ transform: `translate(${(cx + Math.cos(an) * rx).toFixed(1)}px, ${(cy + Math.sin(an) * ry).toFixed(1)}px) translate(-50%, -50%) scale(${(0.7 + front * 0.45).toFixed(2)})`, zIndex: front > 0.5 ? 3 : -1 });
      }
      endless(st, frames, { duration: 950, iterations: Infinity });
      st.animate([{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: ms, fill: 'forwards' }).onfinish = () => st.remove();
    }
  },

  // ── a headpat: press and hold on her head and she leans into it — her happy face, little hearts floating up (stroke
  // it, and it goes on) — and let go, she remembers herself: hand on hip, a shake of her head, as if she hadn't liked
  // it at all
  /** How far down her picture her head goes, and how long a press there is held before it's a pat (ms). */
  HEAD_TOP: 0.4,
  PAT_MS: 550,
  pat(on) {
    const M = NeruMascot;
    if (on) {
      if (!M.img || M._drag || M._drop || this._patting) return;
      this._patting = true; this._patFrom = performance.now(); this.found('pat');
      this.stopStare(); clearTimeout(M._back); clearTimeout(this._actT); M._happyUntil = 0; M._idle = false; M._idlePose = null;
      if (M.el) M.el.classList.remove('huff', 'shake', 'hop');
      M._actUntil = Infinity; // (busy for as long as it goes on)
      M.show(M.happy ? 'happy' : null, { pop: false });
      UISounds.play('check-on');
      clearInterval(this._heartT);
      this._heartT = setInterval(() => this.heart(), 230);
      this.heart();
      return;
    }
    if (!this._patting) return;
    this._patting = false; clearInterval(this._heartT);
    M._actUntil = 0;
    if (!M.img) return;
    // (let go: hand on hip as if she hadn't liked it — and blushing; a long one, she catches herself enjoying it: a shake)
    if (M.has('sassy')) {
      this.act('sassy', 2600, { hop: false });
      if (performance.now() - this._patFrom > 900 && M.el) { M.el.classList.remove('shake'); void M.el.offsetWidth; M.el.classList.add('shake'); }
      UISounds.play('click-short');
      this.blush(M.body, M.img, 'sassy');
    } else M.show(M.rest(), { pop: false });
  },
  /** Where her cheeks are on her pictures (fractions of each): her usual one, her happy face, hand on hip. */
  CHEEKS: { base: [[0.43, 0.379], [0.666, 0.361]], happy: [[0.245, 0.443], [0.584, 0.479]], sassy: [[0.439, 0.493], [0.704, 0.461]] },
  /** Her cheeks blushing — pink, a few strokes across them — on `img` in `pose` (her picture in `body`, so they move with
   *  her), once that picture's in: for about two seconds, or till her picture changes. Only on her own pictures. */
  async blush(body, img, pose = 'sassy', ms = 1800) {
    const pics = await NeruMascot.pictures();
    const src = pics && pics.poses && pics.poses.sassy ? (pose === 'happy' ? pics.happy : pose === 'base' ? pics.base : pics.poses[pose]) : null;
    if (!src || !this.CHEEKS[pose] || !body || !img) return;
    for (let i = 0; i < 20 && !(img.getAttribute('src') === src && img.complete && img.naturalWidth); i++) await sleep(60);
    if (img.getAttribute('src') !== src || !img.naturalWidth || !body.isConnected) return;
    body.querySelectorAll(':scope > .neru-blush').forEach(x => x.remove());
    // (her picture as drawn, in her own box's units: fitted into it, held to the bottom left)
    const nw = img.naturalWidth, nh = img.naturalHeight, f = Math.min(img.offsetWidth / nw, img.offsetHeight / nh), dw = nw * f, dh = nh * f;
    const x0 = img.offsetLeft, y0 = img.offsetTop + img.offsetHeight - dh, w = dw * 0.17;
    const el = h('span.neru-blush');
    for (const [fx, fy] of this.CHEEKS[pose]) {
      const c = h('i');
      c.innerHTML = '<svg viewBox="0 0 40 22"><path d="M12 16l5-9M19.5 16l5-9M27 16l5-9" stroke="#e8406c" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>';
      Object.assign(c.style, { left: `${x0 + fx * dw}px`, top: `${y0 + fy * dh}px`, width: `${w}px`, height: `${w * 0.55}px` });
      el.append(c);
    }
    body.append(el);
    const anim = Settings.get('ui.animSpeed');
    if (anim) el.animate([{ opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }], { duration: 320, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    const t0 = performance.now(), away = () => { clearInterval(watch); if (!el.isConnected) return; if (!anim) { el.remove(); return; } el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: 'ease-in', fill: 'forwards' }).onfinish = () => el.remove(); };
    // (her picture changed — a click, another pose: gone with it, at once)
    const watch = setInterval(() => { if (img.getAttribute('src') !== src || !el.isConnected) { clearInterval(watch); el.remove(); } else if (performance.now() - t0 > ms) away(); }, 100);
  },
  /** A little heart floating up beside her face (and fading): the main menu's Neru, or `box` with her picture `img` —
   *  a small Neru on another screen. */
  heart(box = NeruMascot.el, img = NeruMascot.img) {
    if (!box || !img || !box.isConnected || !Settings.get('ui.animSpeed') || document.documentElement.classList.contains('slow')) return;
    const er = box.getBoundingClientRect(), ir = img.getBoundingClientRect(), k = box.offsetWidth ? er.width / box.offsetWidth : 1;
    // (from beside her face, not the top of her head: on the main menu that's under its bar of buttons)
    const side = Math.random() < 0.5 ? -1 : 1, x = (ir.left - er.left + ir.width * (0.5 + side * (0.2 + Math.random() * 0.22))) / k, y = (ir.top - er.top + ir.height * (0.2 + Math.random() * 0.12)) / k;
    const c = ['#ff6fa8', '#ff8fc0', '#ff4d8d'][Math.floor(Math.random() * 3)], sz = 20 + Math.random() * 9;
    const el = h('span.neru-heart');
    el.innerHTML = `<svg viewBox="0 0 24 22"><path fill="${c}" d="M12 21.4l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.6L12 21.4z"/></svg>`;
    Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${sz}px`, height: `${sz}px` });
    box.append(el);
    const dx = side * (8 + Math.random() * 22), up = 40 + Math.random() * 30, tilt = side * (5 + Math.random() * 15);
    el.animate([{ transform: 'translate(-50%, -50%) scale(.3)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.3}px), calc(-50% - ${up * 0.3}px)) scale(1.1) rotate(${tilt * 0.5}deg)`, opacity: 1, offset: 0.25 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% - ${up}px)) scale(.8) rotate(${tilt}deg)`, opacity: 0 }],
      { duration: 1100 + Math.random() * 300, easing: 'cubic-bezier(.22, 1, .36, 1)' }).onfinish = () => el.remove();
  },

  // ── a pause that goes on: bored at her desk, she gives up waiting and goes fishing
  FISH_MS: 20000,
  fishLater(el) {
    if (!el) return;
    setTimeout(() => { if (el.isConnected && el._pose) el._pose('fishing'); }, this.FISH_MS);
  },
};
