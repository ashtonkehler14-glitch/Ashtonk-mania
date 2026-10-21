/* Neru on the main menu: a picture of Neru standing in the bottom-left corner. It shows the image chosen in
 * Settings → Interface, otherwise neru.png / neru.webp / neru.gif / neru.jpg placed next to index.html (the
 * public/ folder). With no picture nothing is shown.
 * She's alive: she breathes, bobs to the music's beat (harder in kiai), leans towards the cursor, perks up when
 * hovered, and clicking her makes her hop — her excited face for a moment, and a few sparkles.
 * And a few things to find just by playing (NeruEggs): bored when left alone (and fishing when left a good while
 * longer), in a huff when clicked over and over, dancing when clicked in time with the music, flustered when her
 * head's patted, cheering through a song's chorus, the lights down and sunglasses on when you keep the pointer on her
 * (and still on just after an SS), picked up and dropped (sulking if it keeps happening, dizzy if she was shaken
 * about), worried when the internet goes, fishing when a pause goes on (click her and the fish on her line flops
 * about), a glint off her sunglasses, a double take at her own name, the volume turned all the way up or down, and the
 * small Neru on other screens in a huff too when clicked over and over. Each screen's own picture of her stays as it
 * is. */

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
    if (!this._pics) this._pics = (async () => {
      this._picsNow = null;
      const blob = await DB.kvGet('mascot.image', null).catch(() => null);
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
  build() {
    const el = this.el = h('button.neru', { hidden: true, 'aria-label': 'Neru', tabindex: '-1', onclick: e => { e.stopPropagation(); if (this._dragged) { this._dragged = false; return; } this.hop(); } });
    if (!Settings.get('ui.mascot')) return el;
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
      el.addEventListener('pointerdown', e => NeruEggs.press(e));
      el.addEventListener('pointermove', e => NeruEggs.patMove(e));
      this.start();
      // (the bundled Neru has a second, excited picture she switches to when clicked — loaded now, so it's there at once)
      this.base = pics.base; this.happy = pics.happy;
      if (pics.happy) new Image().src = pics.happy;
      // (and her worried face — for when the internet goes, when it couldn't be fetched any more — kept in memory)
      const w = pics.poses && pics.poses.worried;
      if (w && !w.startsWith('blob:')) fetch(w).then(r => r.ok ? r.blob() : null).then(b => { if (b && pics.poses.worried === w) pics.poses.worried = URL.createObjectURL(b); }).catch(() => {});
      NeruEggs._vol = Settings.get('audio.master'); // (where the volume starts: only a change to all the way up or down counts)
      NeruEggs.namesake();
      NeruEggs.afterSS();
    });
    return el;
  },
  /** Her pose when nothing's going on: bored once she's been left alone a while, cheering through a song's chorus,
   *  her usual picture otherwise. */
  rest() { return this._idle === 'fishing' && this.has('fishing') ? 'fishing' : this._idle && this.has('bored') ? 'bored' : this._kiai && this.has('cheer') ? 'cheer' : null; },
  /** In the middle of something (a huff, being held, a stare, her happy face after a click): poses wait for it. */
  busy() { const t = performance.now(); return t < (this._huffUntil || 0) || t < (this._happyUntil || 0) || t < (this._actUntil || 0) || !!this._drag || !!this._drop || !!this._staring; },
  /** Whether a pose of hers is there (the bundled pictures — not a picture of the player's own). */
  has(name) { return !!(this._picsNow && this._picsNow.poses && this._picsNow.poses[name]); },
  /** Show a pose (null: her usual picture), at the size that keeps her head the same as in the others — crossfaded from
   *  the one before, never a jump; `pop`: a little flash of light as it changes, for the bigger moments. */
  async show(name, { pop = true } = {}) {
    const pics = await this.pictures(), img = this.img;
    if (!pics || !img) return;
    // (her happy face — clicked — at her full size, as it's always been on the main menu)
    const f = !name ? { src: pics.base, scale: 1 } : name === 'happy' && pics.happy ? { src: pics.happy, scale: 1 } : NeruCameo.pose(pics, name);
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
    if (!this._onMove) this._onMove = e => { this._px = e.clientX; this._py = e.clientY; if (this.el && this.el.isConnected) this._rect = this.el.getBoundingClientRect(); };
    window.addEventListener('pointermove', this._onMove, { passive: true });
    NeruEggs.watchIdle();
    let last = performance.now();
    const tick = now => {
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
      // (dancing: she rocks from side to side, a beat each way)
      const tilt = performance.now() < (this._danceUntil || 0) ? this._tiltTo || 0 : 0;
      this._tilt = (this._tilt || 0) + (tilt - (this._tilt || 0)) * (1 - Math.exp(-dt / 90));
      this._bob *= Math.exp(-dt / 140);
      const b = this._bob;
      // (picked up: she hangs from where she was grabbed and swings as she's moved; let go, she drops back down)
      const held = NeruEggs.held(dt, now);
      // (written only when it changes: a style write every frame restyles her even when she's still)
      const tf = held ? held.tf : `rotate(${(this._lean + this._tilt).toFixed(2)}deg) translateY(${(b * 6).toFixed(2)}px) scale(${(1 + b * 0.012).toFixed(4)}, ${(1 - b * 0.022).toFixed(4)})`;
      const sh = held ? held.sh : `scaleX(${(1 + b * 0.05).toFixed(3)})`;
      if (tf !== this._tf) { this._tf = tf; this.body.style.transform = tf; if (this.shadow) { this.shadow.style.transform = sh; this.shadow.style.opacity = held ? held.so : ''; } }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  },
  /** A beat of the menu music (from the main menu's beat tracking): a little squash, harder in kiai. */
  beat(adj = 1, kiai = false) {
    NeruEggs.chorus(kiai);
    if (!this.body || !Settings.get('ui.animSpeed')) return;
    // (dancing: every beat a full bounce, a rock the other way and a note)
    const dancing = performance.now() < (this._danceUntil || 0);
    if (dancing) { this._tiltTo = this._tiltTo > 0 ? -5 : 5; NeruEggs.note(this.el); }
    this._bob = Math.max(this._bob, dancing ? 1 : clamp(adj, 0, 1) * (kiai ? 1 : 0.55));
  },
  hop() {
    if (!this.el) return;
    const now = performance.now();
    // (in a huff: a click only gets a shake of her head)
    if (now < (this._huffUntil || 0)) { this.el.classList.remove('shake'); void this.el.offsetWidth; this.el.classList.add('shake'); UISounds.play('click-short'); return; }
    if (now < (this._danceUntil || 0)) return; // (dancing: she's busy)
    // (clicked in time with the music: she keeps time with you — a note for each, a little higher each time — and on
    // the eighth she dances. Keeping time isn't mashing: those clicks don't count towards a huff)
    const kept = NeruEggs.keepTime(now);
    if (kept >= NeruEggs.RHYTHM_HITS && NeruEggs.dance()) return;
    if (kept < 3) {
      this._clicks = (this._clicks || []).filter(t => now - t < 2600);
      this._clicks.push(now);
      if (this._clicks.length >= 8 && this.has('sassy')) { NeruEggs.huff(); return; }
    }
    this.el.classList.remove('hop'); void this.el.offsetWidth; this.el.classList.add('hop');
    if (kept >= 2) { NeruEggs.note(this.el); UISounds.play('click-short-confirm', 1, 1 + Math.min(kept, 8) * 0.045); }
    else UISounds.click();
    NeruEggs.stopStare();
    if (this.happy && this.img) {
      this.show('happy', { pop: false });
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
  stop() {
    clearTimeout(this._back); cancelAnimationFrame(this._raf);
    if (this._onMove) window.removeEventListener('pointermove', this._onMove);
    NeruEggs.unwatchIdle(); NeruEggs.stopStare(); NeruEggs.letGo(true); NeruEggs._rhythm = null; this._danceUntil = 0; this._tilt = 0;
    // (a huff, a chorus or a stare cut short by leaving ends with it)
    this.el = null; this.img = null; this.body = null; this.shadow = null; this._idle = this._kiai = false; this._huffUntil = this._happyUntil = 0;
  },
};

/** Neru around the game, not only on the main menu (with the same setting): she pops up at the edge of a screen in a
 *  pose that fits — grudgingly impressed by a good play, unimpressed by a poor one or a fail (a tsundere: never quite
 *  nice about it, never cruel either), on her phone while a song or the game loads — and clicking her makes her hop.
 *  Screens place her with a class of their own (`.nc-results`, `.nc-pause`…). */
const NeruCameo = {
  /** The moods she's pleased about (not that she'd say so): sparkles. */
  HAPPY: new Set(['perfect', 'great']),
  /** Her pose on each screen (her shrug, neru.png, if it isn't there) — all from the song's video: sunglasses on for a
   *  perfect play, a wagging finger at an S, a wink for an A or B, worn out at a C or D, laughing at a fail; bored at her
   *  desk while you pause, fists up — "I'm not cheering for you" — while a song loads, hand on hip at an empty library,
   *  a blank "huh?" at an empty list, fishing while the game starts. */
  POSE: {
    perfect: 'cool', great: 'point', okay: 'wink', bad: 'tired', failed: 'mock',
    paused: 'bored', loading: 'cheer', empty: 'sassy', list: 'huh', boot: 'fishing',
  },
  /** How much of each pose's picture her head takes up (top of her hair to her chin, against its height): a close-up
   *  is shown smaller, so that her head comes out no bigger than in her default picture (HEAD_SIZE) — the same Neru
   *  whichever pose it is, not one twice the size of the other. */
  HEAD: {
    bored: 0.43, cheer: 0.37, cool: 0.38, dance: 0.26, fishing: 0.38, happy: 0.45, huh: 0.45, knees: 0.45, meh: 0.52,
    mock: 0.38, point: 0.45, sassy: 0.49, sulk: 0.45, switch: 0.31, tired: 0.68, wink: 0.28, worried: 0.47,
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
  /** A play's mood: from its grade (a new best too), or a fail. */
  moodOf(s) {
    if (!s || !s.passed) return 'failed';
    if (['XH', 'X', 'SS'].includes(s.grade)) return 'perfect';
    if (['SH', 'S'].includes(s.grade)) return 'great';
    return ['A', 'B'].includes(s.grade) ? 'okay' : 'bad';
  },
  /** Neru in `mood`, for a screen to put where `cls` places her; she comes in once her picture is ready (and in a mood
   *  she's pleased about, sparkles `delay` ms later). Null when she's turned off. */
  make(mood, cls, { delay = 450 } = {}) {
    if (!Settings.get('ui.mascot')) return null;
    const el = h(`button.neru-cameo.${cls}`, { type: 'button', 'aria-label': 'Neru', tabindex: '-1', hidden: true });
    // (sparkles: in a mood she's pleased about)
    const pleased = this.HAPPY.has(mood);
    NeruMascot.pictures().then(async pics => {
      if (!pics) { el.remove(); return; }
      let face = this.face(pics, mood);
      const happy = pics.happy && this.pose(pics, 'happy');
      if (happy) new Image().src = happy.src; // (ready before the first click)
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
      el.addEventListener('click', e => {
        e.stopPropagation();
        const now = performance.now();
        // (in a huff — clicked over and over, like the main menu's Neru — a click only gets a shake of her head)
        if (now < (el._huffUntil || 0)) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); UISounds.play('click-short'); return; }
        el._clicks = (el._clicks || []).filter(t => now - t < 2600); el._clicks.push(now);
        if (el._clicks.length >= 6 && pics.poses && pics.poses.sassy) {
          el._clicks = []; el._huffUntil = now + 3000; clearTimeout(el._back);
          show(this.pose(pics, 'sassy'));
          el.classList.remove('hop', 'shake'); void el.offsetWidth; el.classList.add('shake');
          UISounds.play('dialog-dangerous-tick');
          NeruEggs.fume(el);
          el._back = setTimeout(() => { el.classList.remove('shake'); show(face); }, 3000);
          return;
        }
        // (fishing: the fish on her line flops about — she keeps still, rod in hand — an easter egg)
        if (pics.poses && face.src === pics.poses.fishing && img.getAttribute('src') === face.src) { NeruEggs.flopFish(img.parentElement, img); return; }
        el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop');
        UISounds.click();
        // (her happy face for a moment, whatever her mood)
        if (happy && face.src !== happy.src) { show(happy); clearTimeout(el._back); el._back = setTimeout(() => show(face), 1600); }
        if (pleased) this.burst(el);
      });
    });
    return el;
  },
  /** A picture changed for another without a jump: the one before fades out over the new one fading in. `apply`
   *  makes any other change that goes with it (its size) at the moment it swaps; `still()` says whether it's still wanted
   *  once the new picture is ready. */
  async swap(img, src, apply = null, still = () => true) {
    const pre = new Image(); pre.src = src;
    try { await pre.decode(); } catch { /* checked below */ }
    // (a picture that couldn't be loaded — offline — never replaces the one she has)
    if (!still() || !pre.naturalWidth) return;
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

// (the connection lost on the main menu: she's worried — no signal! — and glad when it's back)
addEventListener('offline', () => NeruEggs.signal(false));
addEventListener('online', () => NeruEggs.signal(true));

Bus.on('settings:changed', k => {
  if (k === 'audio.master') NeruEggs.volume(Settings.get('audio.master'));
  if (k === 'ui.mascot' && Screens.currentName === 'home') { const old = document.querySelector('.home .neru'); if (old) old.replaceWith(NeruMascot.build()); }
});

/** Neru's easter eggs: each one is only pictures and motion — she never
 *  says anything. */
const NeruEggs = {
  IDLE_MS: 45000,
  FISH_IDLE_MS: 120000,
  /** Poses only her easter eggs use (each screen's own are NeruCameo.POSE). */
  EGG_POSES: ['dance', 'knees', 'meh', 'sulk', 'switch', 'worried'],
  // ── left alone on the main menu: after a while she gets bored (at her desk); back to herself, with a start, when
  // you move or press anything
  watchIdle() {
    this.unwatchIdle();
    this._seen = performance.now();
    this._wake = () => {
      this._seen = performance.now();
      const M = NeruMascot;
      if (!M._idle) return;
      M._idle = false;
      if (M.el) { M.el.classList.remove('startle'); void M.el.offsetWidth; M.el.classList.add('startle'); }
      if (!M.busy()) M.show(M.rest());
    };
    for (const ev of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, this._wake, { passive: true });
    window.addEventListener('pointermove', this._wakeMove = e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this._wake(); }, { passive: true });
    this._idleT = setInterval(() => {
      const M = NeruMascot;
      if (!M.img || document.hidden || M.busy()) return;
      const quiet = performance.now() - this._seen;
      if (!M._idle) { if (quiet >= this.IDLE_MS && M.has('bored')) { M._idle = true; M.show('bored'); } return; }
      // (left alone a good while longer: she gives up waiting and goes fishing)
      if (M._idle !== 'fishing' && quiet >= this.IDLE_MS + this.FISH_IDLE_MS && M.has('fishing')) { M._idle = 'fishing'; M.show('fishing'); }
    }, 3000);
  },
  unwatchIdle() {
    clearInterval(this._idleT);
    if (this._wake) for (const ev of ['pointerdown', 'keydown', 'wheel']) window.removeEventListener(ev, this._wake);
    if (this._wakeMove) window.removeEventListener('pointermove', this._wakeMove);
    this._wake = this._wakeMove = null;
  },

  // ── clicked over and over: hand on hip, a shake, a cross mark and a puff of steam — and for a few seconds she won't hop
  huff() {
    const M = NeruMascot, el = M.el;
    if (!el) return;
    M._clicks = []; M._huffUntil = performance.now() + 3400; M._happyUntil = 0;
    clearTimeout(M._back);
    M.show('sassy', { pop: false });
    el.classList.remove('hop', 'huff'); void el.offsetWidth; el.classList.add('huff');
    UISounds.play('dialog-dangerous-tick');
    this.fume(el);
    M._back = setTimeout(() => { el.classList.remove('huff'); if (!M.busy()) M.show(M.rest()); }, 3400);
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

  // ── the main menu's volume turned all the way up: she cheers; all the way down: the music's gone, she's bored
  volume(v) {
    const was = this._vol; this._vol = v;
    if (was == null || Screens.currentName !== 'home') return;
    if (v >= 1 && was < 1) this.act('cheer', 1500, { sparkle: true });
    else if (v <= 0 && was > 0) this.act('bored', 1800, { hop: false });
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
    const go = () => { if (!img.isConnected || !still()) return; this.glint(box, img); setTimeout(go, 3600 + Math.random() * 1800); };
    setTimeout(go, 900);
  },

  // ── fishing (the loading screen, a pause that went on): click her and the fish on her line flops about — swinging
  // from its mouth, drops flying off its tail
  /** Where the fish on her line is in neru-fishing.png (fractions of the picture), and its mouth, where it hangs. */
  FISH: { l: 0.866, t: 0.636, r: 0.996, b: 0.906, mx: 0.935, my: 0.642, tx: 0.93, ty: 0.9 },
  flopFish(box, img) {
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
      // (the lights first: she flicks the switch and the room goes dark around her — then the sunglasses)
      const sw = M.has('switch');
      if (sw) { M.show('switch', { pop: false }); UISounds.play('check-off'); this.lights(true); }
      this._stareT = setTimeout(() => {
        if (!M._staring) return;
        M.show('cool', { pop: false }).then(() => setTimeout(() => { if (M._staring && M.img && M.img.dataset.pose === 'cool') this.glint(M.body, M.img); }, 350));
        this._stareT = setTimeout(() => {
          if (!M._staring) return;
          // (lights back up, and a wink)
          this.lights(false); if (sw) UISounds.play('check-on');
          M.show(M.has('wink') ? 'wink' : null, { pop: false }); M.sparkle();
          if (M.el) { M.el.classList.remove('hop'); void M.el.offsetWidth; M.el.classList.add('hop'); }
          this._stareT = setTimeout(() => { if (!M._staring) return; M._staring = false; if (!M.busy()) M.show(M.rest()); }, 1300);
        }, 1700);
      }, sw ? 700 : 0);
    }, this.STARE_MS);
  },
  hoverEnd() { if (!NeruMascot._staring) clearTimeout(this._stareT); },
  stopStare() { clearTimeout(this._stareT); NeruMascot._staring = false; this.lights(false); },
  /** The main menu's lights down (a spotlight left on her) or back up. */
  lights(on) {
    const M = NeruMascot, home = M.el && M.el.parentElement;
    if (!on) {
      const d = this._dim; this._dim = null;
      if (M.el) M.el.classList.remove('lit');
      if (d) { if (Settings.get('ui.animSpeed')) d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: 'ease-out' }).onfinish = () => d.remove(); else d.remove(); }
      return;
    }
    if (!home || this._dim) return;
    const r = M.body.getBoundingClientRect(), hr = home.getBoundingClientRect(), k = home.offsetWidth ? hr.width / home.offsetWidth : 1;
    const x = (r.left + r.width / 2 - hr.left) / k, y = (r.top + r.height * 0.4 - hr.top) / k, rad = r.height / k;
    const d = this._dim = h('span.neru-dim');
    d.style.background = `radial-gradient(circle at ${x.toFixed(0)}px ${y.toFixed(0)}px, rgba(4, 2, 12, 0) ${(rad * 0.38).toFixed(0)}px, rgba(4, 2, 12, .66) ${(rad * 0.85).toFixed(0)}px)`;
    home.append(d);
    M.el.classList.add('lit');
    if (Settings.get('ui.animSpeed')) d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
  },

  // ── picked up: press and drag her and she hangs from your pointer, swinging as it moves and wagging a finger at you;
  // let go and she drops back into her place with a bump and a puff of dust, put out about it for a moment
  press(e) {
    const M = NeruMascot;
    if (e.button || !M.body || this._p) return;
    // (in the page's own pixels: the interface may be scaled — UI scale — so screen pixels are divided by that)
    const r = M.body.getBoundingClientRect(), k = M.body.offsetWidth ? r.width / M.body.offsetWidth : 1;
    this._p = { id: e.pointerId, x: e.clientX, y: e.clientY, k, ox: (e.clientX - r.left) / k, oy: (e.clientY - r.top) / k, lx: e.clientX, lt: performance.now(), pat: e.pointerType === 'touch' && this.onHead(e) };
    const move = ev => {
      const p = this._p;
      if (!p || ev.pointerId !== p.id) return;
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y, t = performance.now();
      if (!M._drag) {
        // (a finger on her head may be patting it: she's picked up once it's clearly moving her, not rubbing)
        if (p.pat ? Math.abs(dy) < 18 && Math.abs(dx) < 70 : Math.hypot(dx, dy) < 10) return;
        if (M._drop) return;
        // (picked up)
        this.stopStare(); clearTimeout(M._back); M._huffUntil = M._happyUntil = 0; M.el.classList.remove('huff', 'hop', 'shake');
        M._drag = { dx: 0, dy: 0, vx: 0, ang: 0 };
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
      // (shaken about — quick, back and forth — she'll come down dizzy)
      const sd = Math.sign(ev.clientX - p.lx);
      if (sd && Math.abs(ev.clientX - p.lx) / k / Math.max(1, t - p.lt) > 0.5) {
        if (p.sd && sd !== p.sd) { p.flips = (p.flips || []).filter(x => t - x < 1400); p.flips.push(t); if (p.flips.length >= 6) d.shaken = true; }
        p.sd = sd;
      }
      p.lx = ev.clientX; p.lt = t;
    };
    const up = ev => {
      if (!this._p || ev.pointerId !== this._p.id) return;
      this._pEnd();
      if (M._drag) { M._dragged = true; setTimeout(() => { M._dragged = false; }, 400); this.letGo(); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    this._pEnd = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); this._p = null; };
  },
  letGo(now = false) {
    const M = NeruMascot, d = M._drag;
    M._drag = null;
    if (M.el) M.el.classList.remove('held');
    if (now || !d || !M.body) { M._drop = null; if (M.body) M.body.style.transformOrigin = ''; return; }
    // (the further up she was, the longer the fall)
    M._drop = { t0: performance.now(), dur: clamp(280 + Math.max(0, -d.dy) * 0.9, 300, 620), fx: d.dx, fy: d.dy, fa: d.ang, shaken: !!d.shaken };
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
      // (dropped a third time in a little while: she's had enough — she sulks at her desk, a cloud of gloom over her;
      // shaken about first: dizzy, a hand to her mouth, stars going round her head)
      const drops = this._drops = (this._drops || []).filter(t => now - t < 40000);
      drops.push(now);
      const dizzy = f.shaken && M.has('meh'), fed = !dizzy && drops.length >= 3 && M.has('sulk'), ms = dizzy || fed ? 2800 : 1400;
      if (fed) { this._drops = []; this.gloom(M.el); }
      if (dizzy) this.dizzy(M.el, ms);
      M.show(dizzy ? 'meh' : fed ? 'sulk' : M.has('sassy') ? 'sassy' : null, { pop: false });
      M._happyUntil = now + ms;
      clearTimeout(M._back); M._back = setTimeout(() => { if (!M.busy()) M.show(M.rest()); }, ms);
      return null;
    }
    const lift = clamp(-y / 300, 0, 1);
    return { tf: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${a.toFixed(2)}deg)`, sh: `translateX(${x.toFixed(1)}px) scaleX(${(1 - lift * 0.55).toFixed(3)})`, so: (1 - lift * 0.7).toFixed(2) };
  },

  // ── clicked in time with the menu music: she keeps time with you, and dances
  RHYTHM_HITS: 8,
  /** The menu music's beat now — its length, and how far into it the song is (0–1) — or null with none playing. */
  beatPhase() {
    const tm = typeof Music !== 'undefined' && Music.playing && Music.meta && Music.meta.timing;
    if (!tm || !tm.length) return null;
    const t = Music.time, tp = tm[Math.max(0, bsearchLE(tm, t, 'time'))];
    if (!tp || !(tp.beatLength > 0)) return null;
    const x = (t - tp.time) / tp.beatLength;
    return { len: tp.beatLength, phase: x - Math.floor(x) };
  },
  /** A click on her: how many in a row have kept time — each a beat or two after the one before, at the same point in
   *  the beat (wherever that is: on the beat, or off it, as you hear it) — counting this one; 1 when it starts over. */
  keepTime(now) {
    const b = this.beatPhase(), r = this._rhythm;
    if (!b) { this._rhythm = null; return 0; }
    if (r && Math.abs(b.len - r.len) < 1) {
      const gap = (now - r.at) / b.len, beats = Math.round(gap), d = Math.abs(b.phase - r.phase), off = Math.min(d, 1 - d);
      if (beats >= 1 && beats <= 2 && Math.abs(gap - beats) < 0.2 && off < 0.2) { r.n++; r.at = now; return r.n; }
    }
    this._rhythm = { len: b.len, phase: b.phase, at: now, n: 1 };
    return 1;
  },
  /** She dances: for a couple of bars, bouncing and rocking on every beat, notes flying. */
  dance() {
    const M = NeruMascot, now = performance.now();
    if (!M.img || !M.el || !M.has('dance') || M._drag || M._drop || now < (M._huffUntil || 0)) return false;
    const b = this.beatPhase(), ms = clamp((b ? b.len : 500) * 8, 2600, 4400);
    this._rhythm = null; this.stopStare();
    clearTimeout(M._back); M._happyUntil = 0; M._idle = false;
    M._danceUntil = M._actUntil = now + ms; M._tiltTo = 5;
    M.show('dance');
    M.el.classList.remove('hop'); void M.el.offsetWidth; M.el.classList.add('hop');
    UISounds.play('check-on'); M.sparkle();
    for (let i = 0; i < 3; i++) setTimeout(() => this.note(M.el), i * 120);
    clearTimeout(this._actT);
    this._actT = setTimeout(() => { if (!M.busy()) M.show(M.rest()); }, ms + 30);
    return true;
  },
  /** A music note that pops up from her head and floats away. */
  note(el) {
    if (!el || !el.isConnected || !Settings.get('ui.animSpeed') || document.documentElement.classList.contains('slow')) return;
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 24 24');
    pa.setAttribute('d', 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z');
    for (const [k, v] of [['fill', ['#ffd54a', '#ff8cc0', '#8fd3ff', '#ffffff'][Math.floor(Math.random() * 4)]], ['stroke', '#3b2a35'], ['stroke-width', '1.4'], ['stroke-linejoin', 'round'], ['paint-order', 'stroke']]) pa.setAttribute(k, v);
    svg.append(pa);
    const n = h('span.neru-note', svg), side = Math.random() < 0.5 ? -1 : 1;
    n.style.left = `${50 + side * (12 + Math.random() * 22)}%`;
    el.append(n);
    const dx = side * (18 + Math.random() * 26), up = 70 + Math.random() * 50, rot = side * (10 + Math.random() * 16);
    n.animate([{ transform: 'translate(-50%, 0) scale(.4) rotate(0deg)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.3}px), -${up * 0.3}px) scale(1) rotate(${-rot}deg)`, opacity: 1, offset: 0.25 },
      { transform: `translate(calc(-50% + ${dx * 0.75}px), -${up * 0.7}px) scale(1) rotate(${rot}deg)`, opacity: 1, offset: 0.65 },
      { transform: `translate(calc(-50% + ${dx}px), -${up}px) scale(.8) rotate(0deg)`, opacity: 0 }],
      { duration: 1100 + Math.random() * 300, easing: 'cubic-bezier(.25, .8, .4, 1)' }).onfinish = () => n.remove();
  },

  // ── her head patted (the pointer rubbed back and forth over it, or a finger): flustered — hugging her knees, red in
  // the face — and a few hearts
  /** Whether a pointer is on her head (the top of her picture, between its sides). */
  onHead(e) {
    const img = NeruMascot.img;
    if (!img) return false;
    const r = img.getBoundingClientRect();
    return e.clientX > r.left + r.width * 0.15 && e.clientX < r.right - r.width * 0.15 && e.clientY > r.top && e.clientY < r.top + r.height * 0.4;
  },
  patMove(e) {
    const M = NeruMascot;
    // (a mouse moving over her with no button held; a finger pressed on her head)
    if (!M.img || M._drag || M._drop || (e.pointerType === 'touch' ? !(this._p && this._p.pat) : e.buttons)) return;
    if (!this.onHead(e)) { this._pat = null; return; }
    const now = performance.now(), p = this._pat || (this._pat = { x: e.clientX, dir: 0, flips: [] }), dx = e.clientX - p.x;
    if (Math.abs(dx) < 6) return;
    const dir = Math.sign(dx);
    p.x = e.clientX;
    if (p.dir && dir !== p.dir) { p.flips = p.flips.filter(t => now - t < 1500); p.flips.push(now); }
    p.dir = dir;
    if (p.flips.length >= 4) { this._pat = null; this.patted(); }
  },
  patted() {
    const M = NeruMascot, now = performance.now();
    if (now - (this._pattedAt || -1e9) < 12000 || !M.has('knees')) return;
    // (a finger: not picked up after all)
    if (this._p && this._p.pat && this._pEnd) this._pEnd();
    this.stopStare();
    if (!this.act('knees', 2600, { hop: false })) return;
    this._pattedAt = now;
    M.el.classList.remove('shy'); void M.el.offsetWidth; M.el.classList.add('shy');
    UISounds.play('select-expand');
    this.hearts(M.el);
  },
  /** A few hearts that float up from her head. */
  hearts(el) {
    if (!el || !Settings.get('ui.animSpeed')) return;
    const NS = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < 3; i++) setTimeout(() => {
      if (!el.isConnected) return;
      const svg = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
      svg.setAttribute('viewBox', '0 0 24 24');
      pa.setAttribute('d', 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.2 0 3.7 1.3 5.4 3.3 1.7-2 3.2-3.3 5.4-3.3 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z');
      for (const [k, v] of [['fill', i === 1 ? '#ff8cc0' : '#ff5c9d'], ['stroke', '#3b2a35'], ['stroke-width', '1.6'], ['stroke-linejoin', 'round']]) pa.setAttribute(k, v);
      svg.append(pa);
      const hd = h('span.neru-heart', svg), x = [38, 62, 50][i];
      hd.style.left = `${x}%`; hd.style.setProperty('--hs', `${[26, 20, 30][i]}px`);
      el.append(hd);
      const dx = (x - 50) * 1.4, up = 60 + i * 18;
      hd.animate([{ transform: 'translate(-50%, 0) scale(.2)', opacity: 0 }, { transform: `translate(calc(-50% + ${dx * 0.4}px), -${up * 0.35}px) scale(1.15)`, opacity: 1, offset: 0.3 },
        { transform: `translate(calc(-50% + ${dx * 0.8}px), -${up * 0.8}px) scale(1)`, opacity: 1, offset: 0.7 }, { transform: `translate(calc(-50% + ${dx}px), -${up}px) scale(.9)`, opacity: 0 }],
        { duration: 1300, easing: 'cubic-bezier(.22, 1, .36, 1)' }).onfinish = () => hd.remove();
    }, i * 200);
  },

  /** Stars going round and round her head, for `ms`. */
  dizzy(el, ms = 2800) {
    if (!el || !Settings.get('ui.animSpeed')) return;
    const NS = 'http://www.w3.org/2000/svg', ring = h('span.neru-dizzy'), R = 46;
    for (let i = 0; i < 3; i++) {
      const svg = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
      svg.setAttribute('viewBox', '0 0 24 24');
      pa.setAttribute('d', 'M12 2.5l2.6 6.2 6.7.5-5.1 4.4 1.6 6.5L12 16.6l-5.8 3.5 1.6-6.5-5.1-4.4 6.7-.5z');
      for (const [k, v] of [['fill', '#ffd54a'], ['stroke', '#3b2a35'], ['stroke-width', '1.6'], ['stroke-linejoin', 'round']]) pa.setAttribute(k, v);
      svg.append(pa);
      const st = h('i', svg);
      ring.append(st);
      // (round an ellipse — the far side smaller — a third of the way apart)
      const frames = [];
      for (let j = 0; j <= 16; j++) {
        const a = j / 16 * Math.PI * 2 + i * Math.PI * 2 / 3, x = Math.cos(a) * R, y = Math.sin(a) * R * 0.3, sc = 0.7 + (Math.sin(a) + 1) * 0.22;
        frames.push({ transform: `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px)) scale(${sc.toFixed(2)}) rotate(${j * 22.5}deg)` });
      }
      st.animate(frames, { duration: 900, iterations: Infinity });
    }
    el.append(ring);
    ring.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.82 }, { opacity: 0 }], { duration: ms }).onfinish = () => ring.remove();
  },

  // ── the internet gone, on the main menu: worried, a bead of sweat; back again, she cheers
  signal(on) {
    const M = NeruMascot;
    if (Screens.currentName !== 'home' || !M.img) return;
    if (on) { if (this._lost) { this._lost = false; this.act('cheer', 1400, { sparkle: true }); } return; }
    if (!this.act('worried', 3200, { hop: false })) return;
    this._lost = true;
    M.el.classList.remove('startle'); void M.el.offsetWidth; M.el.classList.add('startle');
    this.sweat(M.el);
  },
  /** A bead of sweat running down beside her face. */
  sweat(el) {
    if (!el || !Settings.get('ui.animSpeed')) return;
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 20 28');
    pa.setAttribute('d', 'M10 2C10 2 3 12 3 18a7 7 0 0 0 14 0C17 12 10 2 10 2z');
    for (const [k, v] of [['fill', '#bfe6f7'], ['stroke', '#3b2a35'], ['stroke-width', '1.8'], ['stroke-linejoin', 'round']]) pa.setAttribute(k, v);
    svg.append(pa);
    const d = h('span.neru-sweat', svg);
    el.append(d);
    d.animate([{ transform: 'translateY(-6px) scale(.4)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.15 },
      { transform: 'translateY(10px) scale(1)', opacity: 1, offset: 0.75 }, { transform: 'translateY(22px) scale(.9)', opacity: 0 }], { duration: 2400, easing: 'ease-in' }).onfinish = () => d.remove();
  },

  // ── back on the main menu straight after an SS: she's still got her sunglasses on, for a moment
  afterSS() {
    const s = typeof ScoreManager !== 'undefined' && ScoreManager.recent(1)[0];
    if (!s || !s.passed || !['XH', 'X', 'SS'].includes(s.grade) || Date.now() - (s.date || 0) > 300000 || this._ssSeen === s.id) return;
    this._ssSeen = s.id;
    setTimeout(() => {
      const M = NeruMascot;
      if (!this.act('cool', 2600, { hop: false })) return;
      setTimeout(() => { if (M.img && M.img.dataset.pose === 'cool') this.glint(M.body, M.img); }, 800);
    }, 900);
  },

  /** A little cloud of gloom over her head: wavy lines, as a manga draws a sulk. */
  gloom(el) {
    if (!el || !Settings.get('ui.animSpeed')) return;
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), g = document.createElementNS(NS, 'g');
    svg.setAttribute('viewBox', '0 0 40 30');
    for (const [k, v] of [['fill', 'none'], ['stroke', '#6f5a9e'], ['stroke-width', '2.6'], ['stroke-linecap', 'round']]) g.setAttribute(k, v);
    for (const x of [10, 20, 30]) { const pa = document.createElementNS(NS, 'path'); pa.setAttribute('d', `M${x} 3c-3 4 3 7 0 11s3 7 0 12`); g.append(pa); }
    svg.append(g);
    const gl = h('span.neru-gloom', svg);
    el.append(gl);
    gl.animate([{ opacity: 0, transform: 'translate(-50%, -8px)' }, { opacity: 0.9, transform: 'translate(-50%, 0)', offset: 0.2 }, { opacity: 0.9, transform: 'translate(-50%, 3px)', offset: 0.8 },
      { opacity: 0, transform: 'translate(-50%, 6px)' }], { duration: 2600, easing: 'ease-in-out' }).onfinish = () => gl.remove();
  },

  // ── a pause that goes on: bored at her desk, she gives up waiting and goes fishing
  FISH_MS: 20000,
  fishLater(el) {
    if (!el) return;
    setTimeout(() => { if (el.isConnected && el._pose) el._pose('fishing'); }, this.FISH_MS);
  },
};
