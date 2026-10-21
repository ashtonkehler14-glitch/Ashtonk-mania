/* Neru on the main menu: a picture of Neru standing in the bottom-left corner. It shows the image chosen in
 * Settings → Interface, otherwise neru.png / neru.webp / neru.gif / neru.jpg placed next to index.html (the
 * public/ folder). With no picture nothing is shown.
 * She's alive: she breathes, bobs to the music's beat (harder in kiai), leans towards the cursor, perks up when
 * hovered, and clicking her makes her hop — her excited face for a moment, and a few sparkles (clicked in time with
 * the music, eight beats running, she dances).
 * And a few things to find just by playing (NeruEggs): bored when left alone — then fishing, then hugging her knees,
 * and sulking when you come back — in a huff when clicked over and over, cheering through a song's chorus, the lights
 * down and sunglasses on when you keep the pointer on her, picked up and dropped (sulking if it keeps happening, dizzy
 * if she was shaken about), a headpat (hearts — then a huff, as if she hadn't liked it), worried when the internet
 * goes, fishing when a pause goes on (click her and the fish on her line flops about), a glint off her sunglasses, a
 * double take at her own name, the volume turned all the way up or down, songs skipped one after another, and the
 * small Neru on other screens in a huff too when clicked over and over. Each screen's own picture of her stays as it
 * is; a click there, now and then, gets a pose of her own instead of her happy face: a dance after a full combo, a
 * snicker after a fail, worried at a song far above anything you've passed. And the time of year drifting around her
 * — autumn leaves, snow, cherry blossom, fireflies on a summer night, bats at Halloween, hearts on Valentine's Day
 * (and twice the snow at Christmas; on April Fools' Day she's the other way round), stars twinkling at night — a
 * cheer on New Year's Day and at a milestone play, a sulk when you're back after a week away, a worried look after an
 * hour's playing without a break, and her sunglasses still on after an SS. */

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
      el.addEventListener('contextmenu', e => e.preventDefault()); // (a long press on a touch screen is a headpat, not the browser's menu)
      this.start();
      // (the bundled Neru has a second, excited picture she switches to when clicked — loaded now, so it's there at once)
      this.base = pics.base; this.happy = pics.happy;
      if (pics.happy) new Image().src = pics.happy;
      // (and her worried face — for when the internet goes, when it couldn't be fetched any more — kept in memory)
      const w = pics.poses && pics.poses[NeruCameo.EGG.offline];
      if (w && !w.startsWith('blob:')) fetch(w).then(r => r.ok ? r.blob() : null).then(b => { if (b && pics.poses[NeruCameo.EGG.offline] === w) pics.poses[NeruCameo.EGG.offline] = URL.createObjectURL(b); }).catch(() => {});
      NeruEggs._vol = Settings.get('audio.master'); // (where the volume starts: only a change to all the way up or down counts)
      NeruEggs.namesake();
      if (NeruEggs.foolsDay()) el.classList.add('nm-fools');
      NeruEggs.greet();
      NeruEggs.milestone();
      NeruEggs.breather();
      NeruEggs.drift(el);
      // (after the drift: put in first of all, so the stars are furthest back — behind the leaves, the snow, the moon)
      if (NeruEggs.night()) NeruEggs.twinkle(el);
    });
    return el;
  },
  /** Her pose when nothing's going on: bored once she's been left alone a while, cheering through a song's chorus,
   *  her usual picture otherwise. */
  rest() { return this._idle && this.has(this._idlePose || 'bored') ? this._idlePose || 'bored' : this._kiai && this.has('cheer') ? 'cheer' : null; },
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
      const tilt = NeruEggs.dancing() ? this._tiltTo || 0 : 0;
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
    // (dancing: every beat bounces her all the way, rocks her the other way and sends up a note; every other one
    // brings sparkles)
    if (NeruEggs.dancing()) {
      this._bob = 1; this._tiltTo = this._tiltTo > 0 ? -5 : 5; NeruEggs.note(this.el);
      if ((this._danceBeat = (this._danceBeat || 0) + 1) % 2 === 0) this.sparkle();
      return;
    }
    this._bob = Math.max(this._bob, clamp(adj, 0, 1) * (kiai ? 1 : 0.55));
  },
  hop() {
    if (!this.el) return;
    const now = performance.now();
    // (in a huff: a click only gets a shake of her head)
    if (now < (this._huffUntil || 0)) { this.el.classList.remove('shake'); void this.el.offsetWidth; this.el.classList.add('shake'); UISounds.play('click-short'); return; }
    // (clicked in time with the music: she keeps time with you — a note for each, a little higher each time — and on
    // the eighth she dances; dancing, clicks still in time keep her going. Keeping time isn't mashing: those clicks
    // never add up to a huff)
    const kept = NeruEggs.keepTime(now), pitch = 1 + Math.min(kept, 8) * 0.045;
    if (NeruEggs.dancing()) {
      if (kept >= 2) NeruEggs.keepDancing();
      this._bob = 1; NeruEggs.note(this.el); UISounds.play('click-short-confirm', 1, pitch);
      return;
    }
    if (kept >= NeruEggs.TAPS && NeruEggs.dance()) return;
    if (kept < 3) {
      this._clicks = (this._clicks || []).filter(t => now - t < 2600);
      this._clicks.push(now);
      if (this._clicks.length >= 8 && this.has('sassy')) { NeruEggs.huff(); return; }
    }
    this.el.classList.remove('hop'); void this.el.offsetWidth; this.el.classList.add('hop');
    if (kept >= 2) { NeruEggs.note(this.el); UISounds.play('click-short-confirm', 1, pitch); }
    else UISounds.click();
    NeruEggs.stopStare();
    if (this.happy && this.img) {
      // (April Fools' Day: she laughs instead — got you)
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
  stop() {
    clearTimeout(this._back); cancelAnimationFrame(this._raf);
    if (this._onMove) window.removeEventListener('pointermove', this._onMove);
    NeruEggs.unwatchIdle(); NeruEggs.stopStare(); NeruEggs.letGo(true); clearTimeout(NeruEggs._patT); clearInterval(NeruEggs._heartT); NeruEggs._patting = false;
    NeruEggs._rhythm = null; NeruEggs._danceUntil = 0; this._tilt = 0;
    // (a huff, a chorus or a stare cut short by leaving ends with it)
    this.el = null; this.img = null; this.body = null; this.shadow = null; this._idle = this._kiai = false; this._idlePose = null; this._huffUntil = this._happyUntil = 0;
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
  /** The poses only easter eggs bring out (NeruEggs): a dance when clicked in time with the music, fishing and then
   *  hugging her knees when left alone longer, and a sulk when you come back after that (or after a week away, or when
   *  she's dropped once too often); the light switch before her sunglasses, queasy after being shaken about, worried
   *  when the internet goes (and after an hour's playing without a break); and on other screens, clicked, a dance after
   *  a full combo, a snicker after a fail, worried while a song far above anything you've passed loads. */
  EGG: {
    beat: 'dance', aloneLonger: 'fishing', aloneLongest: 'knees', back: 'sulk', dropped: 'sulk', lights: 'switch',
    dizzy: 'meh', offline: 'worried', fullCombo: 'dance', failed: 'snicker', farAbove: 'worried', longSession: 'worried',
  },
  /** How much of each pose's picture her head takes up (top of her hair to her chin, against its height): a close-up
   *  is shown smaller, so that her head comes out no bigger than in her default picture (HEAD_SIZE) — the same Neru
   *  whichever pose it is, not one twice the size of the other. */
  HEAD: {
    bored: 0.43, cheer: 0.37, cool: 0.38, dance: 0.26, fishing: 0.38, happy: 0.45, huh: 0.45, knees: 0.45, meh: 0.52,
    mock: 0.38, point: 0.45, sassy: 0.49, snicker: 0.33, sulk: 0.45, switch: 0.31, tired: 0.68, wink: 0.28, worried: 0.47,
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
   *  she's pleased about, sparkles `delay` ms later). `poke`: an easter egg's pose a click brings out for a moment, in
   *  place of her happy face. Null when she's turned off. */
  make(mood, cls, { delay = 450, poke = null } = {}) {
    if (!Settings.get('ui.mascot')) return null;
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
        if (e.button || el._patT || el._patting) return;
        const up = () => {
          clearTimeout(el._patT); el._patT = null;
          window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
          if (!el._patting) return;
          el._patting = false; clearInterval(el._hearts);
          el._noClick = true; setTimeout(() => { el._noClick = false; }, 400);
          clearTimeout(el._back);
          if (performance.now() - el._patFrom > 900 && pics.poses && pics.poses.sassy) {
            show(this.pose(pics, 'sassy'));
            el.classList.remove('hop', 'shake'); void el.offsetWidth; el.classList.add('shake');
            UISounds.play('click-short');
            el._back = setTimeout(() => { el.classList.remove('shake'); show(face); }, 1500);
          } else show(face);
        };
        window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
        el._patT = setTimeout(() => {
          el._patT = null;
          if (!el.isConnected || performance.now() < (el._huffUntil || 0)) return;
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
        // (her happy face for a moment, whatever her mood — or the easter egg's pose, held a little longer)
        if (react && face.src !== react.src) { show(react); clearTimeout(el._back); el._back = setTimeout(() => show(face), react === happy ? 1600 : 2200); }
        if (pleased || (react !== happy && poke === this.EGG.fullCombo)) this.burst(el);
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

Bus.on('music:changed', m => NeruEggs.skipped(m));
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
  /** Left alone longer still: she gives up waiting and goes fishing, then hugs her knees (each only if that picture is
   *  there). */
  get IDLE_STAGES() { return [[this.IDLE_MS, 'bored'], [165000, NeruCameo.EGG.aloneLonger], [360000, NeruCameo.EGG.aloneLongest]]; },
  // ── left alone on the main menu: after a while she gets bored (at her desk), then goes fishing, and in the end sits
  // hugging her knees; back to herself, with a start, when you move or press anything (from her knees: in a sulk for a
  // moment first)
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
    this._idleT = setInterval(() => {
      const M = NeruMascot;
      if (!M.img || document.hidden || M.busy()) return;
      const away = performance.now() - this._seen;
      // (the latest stage reached whose picture is there)
      let pose = null;
      for (const [ms, name] of this.IDLE_STAGES) if (away >= ms && M.has(name)) pose = name;
      if (!pose || (M._idle && M._idlePose === pose)) return;
      M._idle = true; M._idlePose = pose; M.show(pose);
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

  // ── clicked in time with the menu music — eight beats running — she dances, for as long as you keep the beat
  TAPS: 8,
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
   *  the beat (wherever that is as you hear it: on the beat, or off it, Bluetooth headphones and all) — counting this
   *  one; 1 when it starts over, 0 with no music. */
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
    const M = NeruMascot, now = performance.now(), pose = NeruCameo.EGG.beat;
    if (!M.img || !M.el || !M.has(pose) || M._drag || M._drop || this._patting || now < (M._huffUntil || 0)) return false;
    const b = this.beatPhase(), ms = clamp((b ? b.len : 500) * 8, 2600, 4400);
    this._rhythm = null; this.stopStare();
    clearTimeout(M._back); M._happyUntil = 0; M._idle = false; M._idlePose = null;
    M._actUntil = this._danceUntil = now + ms; M._tiltTo = 5;
    M.show(pose);
    M.el.classList.remove('hop'); void M.el.offsetWidth; M.el.classList.add('hop');
    UISounds.play('check-on'); M.sparkle();
    for (let i = 0; i < 3; i++) setTimeout(() => this.note(M.el), i * 120);
    clearTimeout(this._actT);
    this._actT = setTimeout(() => { if (!M.busy()) M.show(M.rest()); }, ms + 30);
    return true;
  },
  /** Whether she's dancing now. */
  dancing() { const now = performance.now(); return now < (this._danceUntil || 0) && now < (NeruMascot._actUntil || 0); },
  /** Still in time while she dances: she keeps going (a few more beats from now). */
  keepDancing() {
    const M = NeruMascot, b = this.beatPhase(), ms = Math.max(2400, (b ? b.len : 500) * 6);
    M._actUntil = this._danceUntil = performance.now() + ms;
    clearTimeout(this._actT);
    this._actT = setTimeout(() => { if (!M.busy()) M.show(M.rest()); }, ms + 30);
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

  // ── songs skipped one after another on the main menu — three in a few seconds — a blank "huh?": make up your mind
  /** Each song the menu music moves on to (the same one again — restarted, paused — isn't one). */
  skipped(map) {
    if (!map || map.id === this._song) return;
    this._song = map.id;
    if (Screens.currentName !== 'home') { this._skips = []; return; }
    const now = performance.now();
    this._skips = (this._skips || []).filter(t => now - t < 12000);
    this._skips.push(now);
    if (this._skips.length >= 3) { this._skips = []; this.act('huh', 1700, { hop: false }); }
  },

  // ── the main menu's volume turned all the way up: she cheers; all the way down: the music's gone, she's bored
  volume(v) {
    const was = this._vol; this._vol = v;
    if (was == null || Screens.currentName !== 'home') return;
    if (v >= 1 && was < 1) this.act('cheer', 1500, { sparkle: true });
    else if (v <= 0 && was > 0) this.act('bored', 1800, { hop: false });
  },

  // ── her hello, the first time she sees you: on New Year's Day, a cheer and sparkles, again and again; back after a
  // week or more away, a sulk — then she can't help being glad
  /** Today (its date and time, by the clock here). */
  today() { return new Date(); },
  /** Back after a week or more without a play (once there have been a few). */
  away(d = this.today()) {
    const sc = typeof ScoreManager !== 'undefined' ? ScoreManager.scores : [], last = sc[sc.length - 1];
    return sc.length >= 5 && !!last && d - (last.date || d) >= 7 * 864e5;
  },
  greet(d = this.today()) {
    const newYear = d.getMonth() === 0 && d.getDate() === 1, back = this.away(d);
    if (this._greeted || !(newYear || back)) return;
    this._greeted = true;
    clearTimeout(this._greetT);
    this._greetT = setTimeout(() => {
      const M = NeruMascot;
      if (newYear) {
        if (!this.act('cheer', 2600, { sparkle: true })) { this._greeted = false; return; }
        for (const t of [550, 1100, 1650]) setTimeout(() => { if (M.img && M.img.dataset.pose === 'cheer') { M._bob = 1; M.sparkle(); } }, t);
      } else {
        if (!this.act(NeruCameo.EGG.back, 2600, { hop: false })) { this._greeted = false; return; }
        clearTimeout(this._greetT);
        this._greetT = setTimeout(() => { if (M.img && M.img.dataset.pose === NeruCameo.EGG.back) { M._actUntil = 0; this.act('happy', 1500, { sparkle: true }); } }, 2600);
      }
    }, 1600);
  },

  // ── an SS since she last saw you: back on the main menu, her sunglasses are still on for a while, catching the light
  /** The plays from `from` on (the ones since she last saw you): one an SS, and on go the sunglasses. */
  shades(from) {
    const perfect = ScoreManager.scores.slice(from).some(sc => sc.passed && sc.own !== false && ['XH', 'X', 'SS'].includes(sc.grade));
    if (!perfect) return;
    clearTimeout(this._mileT);
    this._mileT = setTimeout(() => {
      const M = NeruMascot;
      if (!this.act('cool', 6000, { hop: false })) return;
      for (const t of [700, 3200]) setTimeout(() => { if (M.img && M.img.dataset.pose === 'cool') this.glint(M.body, M.img); }, t);
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

  // ── a milestone — your 100th play, 250th, 500th, 1000th… — and back on the main menu she cheers, sparkles and all
  MILESTONES: [100, 250, 500, 1000, 2500, 5000, 10000],
  /** On the main menu (each time it's shown): a milestone passed since she last saw it, a cheer. */
  milestone() {
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
  /** Which, on day `d`: 'leaves', 'snow', 'petals', 'fireflies' (summer, evenings), 'bats' (the last days of
   *  October), 'hearts' (Valentine's Day), or null. */
  seasonOf(d = this.today(), zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })()) {
    const m = d.getMonth() + 1, day = d.getDate(), hr = d.getHours();
    if (m === 10 && day >= 29) return 'bats';
    if (m === 2 && day === 14) return 'hearts';
    const south = /^(Australia|Antarctica|Pacific\/(Auckland|Chatham))|^America\/(Argentina|Sao_Paulo|Santiago|Montevideo|Asuncion|Punta_Arenas)|^Africa\/(Johannesburg|Maseru|Mbabane|Windhoek|Maputo|Harare)/.test(zone);
    const n = south ? (m + 5) % 12 + 1 : m; // (the month it'd be up north)
    if (n === 12 || n <= 2) return 'snow';
    if ((n === 3 && day >= 20) || n === 4) return 'petals';
    if (n === 10 || n === 11) return 'leaves';
    if (n >= 6 && n <= 8 && (hr >= 19 || hr < 5)) return 'fireflies';
    return null;
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
  /** Night (10pm till 5, by the clock here): stars come out. */
  night(d = this.today()) { const hr = d.getHours(); return hr >= 22 || hr < 5; },
  /** Stars twinkling high up around the main menu's Neru (`el`) — far off, behind whatever the time of year brings —
   *  for as long as she's there. */
  twinkle(el) {
    if (!el) return;
    const html = document.documentElement, still = matchMedia('(prefers-reduced-motion: reduce)');
    const quiet = () => !Settings.get('ui.animSpeed') || still.matches || html.classList.contains('slow') || html.classList.contains('perf');
    if (quiet()) return;
    const sky = h('span.neru-sky', { 'aria-hidden': 'true' });
    el.prepend(sky);
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
  },
  /** Starts the time of year drifting around the main menu's Neru (`el`), for as long as she's there. */
  drift(el, kind = this.seasonOf()) {
    const K = kind === 'snow' && this.christmas() ? { ...this.DRIFT.snow, every: [150, 360], most: 34 } : this.DRIFT[kind];
    if (!K || !el) return;
    const html = document.documentElement, still = matchMedia('(prefers-reduced-motion: reduce)');
    const quiet = () => !Settings.get('ui.animSpeed') || still.matches || html.classList.contains('slow') || html.classList.contains('perf');
    if (quiet()) return;
    const back = h(`span.neru-drift.nd-${kind}`, { 'aria-hidden': 'true' }), front = h(`span.neru-drift.nd-${kind}.nd-front`, { 'aria-hidden': 'true' });
    el.prepend(back); el.append(front);
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
      if (!spin.firstChild) { spin.className = 'nd-dot'; spin.style.background = c; }
      Object.assign(p.style, { width: `${size}px`, height: `${size * (kind === 'bats' ? 0.5 : 1)}px` });
      sway.append(spin); p.append(sway); layer.append(p); n++;
      let path;
      if (kind === 'bats') {
        // (across her, from one side to the other, climbing a little; facing the way it flies)
        const ltr = Math.random() < 0.5, y0 = H * r([0.12, 0.42]), y1 = y0 - H * r([0.04, 0.12]);
        path = [{ transform: `translate(${ltr ? -size * 2 : W + size}px, ${y0}px)` }, { transform: `translate(${ltr ? W + size : -size * 2}px, ${y1}px)` }];
        if (!ltr) spin.style.scale = '-1 1';
        spin.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.45) translateY(12%)' }], { duration: r([150, 210]), iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
      } else if (kind === 'fireflies') {
        // (where it is, low around her, glowing up and fading as it wanders)
        const x = W * r([0.05, 0.95]), y = H * r([0.35, 0.95]);
        path = [{ transform: `translate(${x}px, ${y}px)`, opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { transform: `translate(${x + r([-30, 30])}px, ${y - r([10, 40])}px)`, opacity: 0 }];
        spin.animate([{ opacity: 0.35, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1.1)' }], { duration: r([900, 1600]), iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
      } else {
        // (down from above her head to the floor)
        const x = W * r([0.02, 0.98]);
        path = [{ transform: `translate(${x}px, ${-size * 2}px)` }, { transform: `translate(${x + r([-40, 40])}px, ${H + size}px)` }];
        const turn = r(K.spin);
        if (turn) {
          // (a leaf or a petal flutters as it falls — turning a little towards you and away — at an angle of its own)
          const a = Math.random() * 360, f = r([35, 65]);
          spin.animate([{ transform: `rotate(${a}deg) rotateY(${-f}deg) rotateX(${f * 0.4}deg)` }, { transform: `rotate(${a + r([-40, 40])}deg) rotateY(${f}deg) rotateX(${-f * 0.4}deg)` }],
            { duration: turn, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', delay: -Math.random() * turn });
        }
      }
      // (side to side as it comes down — a leaf or a petal tilting with each swing, like a pendulum)
      const amp = r(K.sway), tilt = K.tilt ? r(K.tilt) : K.spin[1] ? r([18, 30]) : 0;
      // (a bat bobs up and down as it flies instead)
      const ax = kind === 'bats' ? 'translateY' : 'translateX';
      sway.animate([{ transform: `${ax}(${-amp}px) rotate(${-tilt}deg)` }, { transform: `${ax}(${amp}px) rotate(${tilt}deg)` }], { duration: r(K.swayMs), iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', delay: -Math.random() * 2000 });
      p.animate(path, { duration: ms, easing: 'linear', delay: pre ? -ms * r([0.15, 0.75]) : 0 }).onfinish = () => { p.remove(); n--; };
    };
    const spawn = () => {
      if (!el.isConnected || !back.isConnected) { back.remove(); front.remove(); return; }
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
  loaderPoke(mods = [], rec = null) { return rec && !mods.includes('AT') && this.outOfReach(rec.stars) ? NeruCameo.EGG.farAbove : null; },
  /** A star rating well past the hardest you've passed (by a star and a half, and a third again): only once you've
   *  passed a few, so a new player isn't met with it every time. */
  outOfReach(stars) {
    if (!(stars > 0) || typeof ScoreManager === 'undefined') return false;
    let best = 0, n = 0;
    for (const sc of ScoreManager.scores) if (sc.passed && !(sc.mods || []).includes('AT') && sc.stars > 0) { n++; if (sc.stars > best) best = sc.stars; }
    return n >= 3 && stars >= Math.max(best + 1.5, best * 1.35);
  },
  /** A play's results: a full combo — not one miss — gets a little dance (with sparkles). */
  resultsPoke(s) { const c = (s && s.passed && s.counts) || []; return c.length > 5 && c[5] === 0 ? NeruCameo.EGG.fullCombo : null; },

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
      const sw = M.has(NeruCameo.EGG.lights);
      if (sw) { M.show(NeruCameo.EGG.lights, { pop: false }); UISounds.play('check-off'); this.lights(true); }
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
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      this._p = null;
      clearTimeout(this._patT);
      // (let go after a pat, or after being carried: not a click as well)
      if (this._patting) { M._dragged = true; setTimeout(() => { M._dragged = false; }, 400); this.pat(false); }
      if (M._drag) { M._dragged = true; setTimeout(() => { M._dragged = false; }, 400); this.letGo(); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
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
      const dizzy = f.shaken && M.has(NeruCameo.EGG.dizzy), fed = !dizzy && drops.length >= 3 && M.has(NeruCameo.EGG.dropped), ms = dizzy || fed ? 2800 : 1400;
      if (fed) { this._drops = []; this.gloom(M.el); }
      if (dizzy) this.dizzy(M.el, ms);
      M.show(dizzy ? NeruCameo.EGG.dizzy : fed ? NeruCameo.EGG.dropped : M.has('sassy') ? 'sassy' : null, { pop: false });
      M._happyUntil = now + ms;
      clearTimeout(M._back); M._back = setTimeout(() => { if (!M.busy()) M.show(M.rest()); }, ms);
      return null;
    }
    const lift = clamp(-y / 300, 0, 1);
    return { tf: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${a.toFixed(2)}deg)`, sh: `translateX(${x.toFixed(1)}px) scaleX(${(1 - lift * 0.55).toFixed(3)})`, so: (1 - lift * 0.7).toFixed(2) };
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
      this._patting = true; this._patFrom = performance.now();
      this.stopStare(); clearTimeout(M._back); clearTimeout(this._actT); M._huffUntil = M._happyUntil = 0; M._idle = false; M._idlePose = null;
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
    // (a long one: she catches herself enjoying it)
    if (performance.now() - this._patFrom > 900 && M.has('sassy')) {
      this.act('sassy', 1500, { hop: false });
      if (M.el) { M.el.classList.remove('shake'); void M.el.offsetWidth; M.el.classList.add('shake'); }
      UISounds.play('click-short');
    } else M.show(M.rest(), { pop: false });
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

  // ── the internet gone, on the main menu: worried — no signal! — a bead of sweat; back again, she cheers
  signal(on) {
    const M = NeruMascot;
    if (Screens.currentName !== 'home' || !M.img) return;
    if (on) { if (this._lost) { this._lost = false; this.act('cheer', 1400, { sparkle: true }); } return; }
    if (!this.act(NeruCameo.EGG.offline, 3200, { hop: false })) return;
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

  // ── a pause that goes on: bored at her desk, she gives up waiting and goes fishing
  FISH_MS: 20000,
  fishLater(el) {
    if (!el) return;
    setTimeout(() => { if (el.isConnected && el._pose) el._pose('fishing'); }, this.FISH_MS);
  },
};
