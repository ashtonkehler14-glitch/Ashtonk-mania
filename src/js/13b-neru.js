/* Neru on the main menu: a picture of Neru standing in the bottom-left corner. It shows the image chosen in
 * Settings → Interface, otherwise neru.png / neru.webp / neru.gif / neru.jpg placed next to index.html (the
 * public/ folder). With no picture nothing is shown.
 * She's alive: she breathes, bobs to the music's beat (harder in kiai), leans towards the cursor, perks up when
 * hovered, and clicking her makes her hop — happy face, a few sparkles and a line in a speech bubble. */

const NeruMascot = {
  FILES: ['neru.png', 'neru.webp', 'neru.gif', 'neru.jpg'],
  /** Her other faces and poses, public/neru-<name>.png (tools/neru-art.py makes them, from frames of her song's music
   *  video): the build lists the ones there are, so none is looked for that isn't there. */
  POSES: [/*__NERU_POSES__*/],
  /** The ones where she's sitting — at her desk, or hugging her knees: not for the main menu, where she stands. */
  SEATED: ['bored', 'huh', 'knees', 'sulk', 'tired'],
  _pics: null, _blobURL: null,
  /** Her pictures — { base, happy, poses: { name: url } } (happy: the face she makes when clicked or pleased; null if
   *  there isn't one) — or null with none. The picture chosen in Settings → Interface is all of them; otherwise the
   *  bundled ones. Looked up once, and shared by every place she shows. */
  pictures() {
    if (!this._pics) this._pics = (async () => {
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
        return { base: Host.asset(f), happy: poses.happy || null, poses };
      }
      return null;
    })();
    return this._pics;
  },
  // (Akita Neru: a tsundere, never off her phone — she'd never admit she's glad you're here)
  LINES: ['What?', 'Stop poking me.', 'I\'m busy. Texting.', 'Go pick a song already.', 'Don\'t get the wrong idea.', 'Hmph.',
    'It\'s not like I was waiting for you.', 'You again?', '...Fine. One more.', 'Quit it. My phone\'s right here.'],
  /** Said once a visit, when the main menu first shows her: hello, for the time of day (not that she'd call it that). */
  greeting() {
    const hr = new Date().getHours();
    return hr >= 5 && hr < 11 ? 'You\'re up early. ...Morning.' : hr >= 11 && hr < 17 ? 'Oh. It\'s you.' : hr >= 17 && hr < 22 ? 'Back again? Hmph.' : 'Shouldn\'t you be asleep?';
  },
  build() {
    const el = this.el = h('button.neru', { hidden: true, 'aria-label': 'Neru', onclick: e => { e.stopPropagation(); this.hop(); } });
    if (!Settings.get('ui.mascot')) return el;
    this.pictures().then(pics => {
      if (!pics || this.el !== el) return;
      this.img = h('img.neru-img', { src: pics.base, alt: '', draggable: 'false' });
      // body: leans and bobs (driven per frame); img: breathing and the hop (CSS); a soft shadow on the floor
      this.body = h('span.neru-body', this.img);
      this.shadow = h('span.neru-shadow');
      this.bubble = h('span.neru-say');
      el.append(this.shadow, this.body, this.bubble);
      el.hidden = false;
      el.addEventListener('pointerenter', () => { el.classList.add('perk'); if (!this._next) this.nextPose(); });
      el.addEventListener('pointerleave', () => el.classList.remove('perk'));
      this.start();
      // (the bundled Neru has a second, happy picture she switches to when clicked)
      this.base = pics.base; this.happy = pics.happy; this._poses = pics.poses;
      if (!NeruMascot._greeted) { NeruMascot._greeted = true; setTimeout(() => { if (this.el === el) this.say(this.greeting()); }, 1400); }
    });
    return el;
  },
  /** Per frame: the lean towards the pointer (eased) and the beat's bob decaying, written as one transform. */
  start() {
    cancelAnimationFrame(this._raf);
    this._lean = 0; this._bob = 0; this._px = null;
    // (her box is measured when the pointer moves, not every frame: reading layout each frame can force a reflow)
    if (!this._onMove) this._onMove = e => { this._px = e.clientX; this._py = e.clientY; if (this.el && this.el.isConnected) this._rect = this.el.getBoundingClientRect(); };
    window.addEventListener('pointermove', this._onMove, { passive: true });
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
      this._bob *= Math.exp(-dt / 140);
      const b = this._bob;
      // (written only when it changes: a style write every frame restyles her even when she's still)
      const tf = `rotate(${this._lean.toFixed(2)}deg) translateY(${(b * 6).toFixed(2)}px) scale(${(1 + b * 0.012).toFixed(4)}, ${(1 - b * 0.022).toFixed(4)})`;
      if (tf !== this._tf) { this._tf = tf; this.body.style.transform = tf; if (this.shadow) this.shadow.style.transform = `scaleX(${(1 + b * 0.05).toFixed(3)})`; }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  },
  /** A beat of the menu music (from the main menu's beat tracking): a little squash, harder in kiai. */
  beat(adj = 1, kiai = false) {
    if (!this.body || !Settings.get('ui.animSpeed')) return;
    this._bob = Math.max(this._bob, clamp(adj, 0, 1) * (kiai ? 1 : 0.55));
  },
  hop() {
    if (!this.el) return;
    this.el.classList.remove('hop'); void this.el.offsetWidth; this.el.classList.add('hop');
    UISounds.click();
    // (one of her other poses for a moment — picked and loaded when the pointer came to her, so it's there at once;
    // the happy one when that's all there is)
    const ready = this._next && this._next.complete && this._next.naturalWidth;
    const pose = ready ? this._next.src : this.happy, name = ready ? this._nextName : 'happy';
    this.nextPose();
    if (pose && this.img) {
      this.img.src = pose;
      // (her head the size it is in her own picture: see NeruCameo.HEAD)
      this.el.style.setProperty('--pose-s', NeruCameo.pose({ base: this.base, poses: this._poses }, name).scale);
      clearTimeout(this._back);
      this._back = setTimeout(() => { if (this.img) { this.img.src = this.base; this.el.style.removeProperty('--pose-s'); } }, 1600);
    }
    this.say();
    this.sparkle();
  },
  /** The pose a click will show next: a random one of hers (standing — there's no desk on the main menu — and not the
   *  one she just showed), loaded now. */
  nextPose() {
    const all = Object.entries(this._poses || {}).filter(([n]) => !this.SEATED.includes(n) && n !== this._nextName);
    if (!all.length) { this._next = null; return; }
    const [n, u] = all[Math.floor(Math.random() * all.length)];
    const img = new Image();
    img.src = u;
    this._next = img; this._nextName = n;
  },
  /** A short line in a bubble beside her head, gone after a moment (never the same line twice running). */
  say(text) {
    if (!this.bubble) return;
    let t = text;
    if (!t) { do t = this.LINES[Math.floor(Math.random() * this.LINES.length)]; while (t === this._lastLine && this.LINES.length > 1); }
    this._lastLine = t;
    this.bubble.textContent = t;
    NeruCameo.pop(this.bubble, 1900);
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
    clearTimeout(this._back); if (this.bubble) clearTimeout(this.bubble._t); cancelAnimationFrame(this._raf);
    if (this._onMove) window.removeEventListener('pointermove', this._onMove);
    this.el = null; this.img = null; this.body = null; this.shadow = null; this.bubble = null;
  },
};

/** Neru around the game, not only on the main menu (with the same setting): she pops up at the edge of a screen with
 *  something to say — grudgingly impressed by a good play, unimpressed by a poor one or a fail (a tsundere: never quite
 *  nice about it, never cruel either), texting while
 *  a song or the game loads — and clicking her makes her hop and say something else. Screens place her with a class
 *  of their own (`.nc-results`, `.nc-pause`…). */
const NeruCameo = {
  /** What she says, by mood; `happy` moods show her happy face (the others, her smug one). */
  LINES: {
    perfect: ['W-whatever. Anyone could do that.', '...Okay, that was perfect. Don\'t tell anyone I said that.', 'H-hey! I wasn\'t watching that closely or anything!'],
    best: ['A new best? ...Took you long enough.', 'Hmph. I guess that\'s an improvement.', 'Don\'t let it go to your head.'],
    great: ['Not bad. For you.', 'Hmph. Fine, that was good.', 'I\'ve seen worse. ...That\'s a compliment.'],
    okay: ['That\'s it?', 'Meh.', 'You call that trying?', 'I\'ve seen better.'],
    bad: ['...Seriously?', 'Are you even looking at the notes?', 'Wow. Just wow.', 'Did you fall asleep?'],
    failed: ['Ugh. Just retry already.', 'That was painful to watch.', 'Don\'t look at me like that.', 'I\'m not helping you. ...Again?'],
    paused: ['Hurry up. I\'m busy.', 'Fine, take your time. Not like I\'m waiting.', 'Taking a break? Already?'],
    loading: ['Don\'t mess this up.', 'I\'m not cheering for you or anything.', 'Go on, then.', 'Whatever. Just play.'],
    empty: ['There\'s nothing here.', 'No songs? Seriously?', 'Go get some songs already.'],
    boot: ['Hold on. I\'m texting.', 'Wait a second.', '...Loading. Be patient.'],
  },
  HAPPY: new Set(['perfect', 'best', 'great']),
  /** The poses that fit each mood — one of them, at random, each time (her shrug, neru.png, when there's none of
   *  them) — all from the song's video: sunglasses on or dancing about a perfect play; dancing, or flashing a peace
   *  sign with her catch, for a new best (not that she'd admit it); a wink for a good one; a wagging finger, a "meh" or
   *  a sideways look at a so-so one; snickering or smirking at a bad one; laughing, a knowing look, hugging her knees
   *  or sulking at her desk over a fail; bored stiff, slumped over her desk or on her phone while you pause; fists up —
   *  "I'm not cheering for you" — or pointing at you while it loads; hand on hip or a blank "huh?" at an empty library;
   *  on her phone while the game starts. */
  FACES: {
    perfect: ['cool', 'dance'], best: ['dance', 'fishing', 'happy'], great: ['wink', 'fishing', 'happy'],
    okay: ['point', 'meh', 'side'], bad: ['snicker', 'smirk', 'meh'], failed: ['mock', 'worried', 'knees', 'sulk'],
    paused: ['bored', 'tired', 'phone', 'sulk'], loading: ['cheer', 'pointat'], empty: ['sassy', 'huh'], boot: ['phone'],
  },
  /** How much of each pose's picture her head takes up (top of her hair to her chin, against its height): a close-up
   *  is shown smaller, so that her head comes out no bigger than in her default picture (HEAD_SIZE) — the same Neru
   *  whichever pose it is, not one twice the size of the other. */
  HEAD: {
    bored: 0.43, cheer: 0.37, cool: 0.22, dance: 0.18, fishing: 0.38, happy: 0.45, huh: 0.45, knees: 0.45, meh: 0.52,
    mock: 0.38, phone: 0.31, point: 0.45, pointat: 0.32, sassy: 0.49, side: 0.37, smirk: 0.53,
    snicker: 0.21, sulk: 0.45, tired: 0.68, wink: 0.28, worried: 0.47,
  },
  HEAD_SIZE: 0.36,
  /** One of the poses that fit `mood`, at random (her default picture with none of them). */
  face(pics, mood) {
    const have = (this.FACES[mood] || []).filter(n => pics.poses && pics.poses[n]);
    return this.pose(pics, have.length ? have[Math.floor(Math.random() * have.length)] : null);
  },
  /** A pose of hers by name (null: her default picture): its picture, and how big she's shown in it (see HEAD). */
  pose(pics, name) {
    if (!name || !pics.poses || !pics.poses[name]) return { src: pics.base, scale: 1 };
    return { src: pics.poses[name], scale: Math.min(1, this.HEAD_SIZE / (this.HEAD[name] || this.HEAD_SIZE)) };
  },
  /** A play's mood: from its grade, a new best, or a fail. */
  moodOf(s) {
    if (!s || !s.passed) return 'failed';
    if (['XH', 'X', 'SS'].includes(s.grade)) return 'perfect';
    if (s.isPB) return 'best';
    if (['SH', 'S'].includes(s.grade)) return 'great';
    return ['A', 'B'].includes(s.grade) ? 'okay' : 'bad';
  },
  /** A speech bubble shown for `ms`: popping in and fading (with animations off, simply there for that long — its
   *  animation is what shows it, and cut to nothing it never would). */
  pop(el, ms) {
    const still = !Settings.get('ui.animSpeed') || document.documentElement.classList.contains('no-anim');
    el.classList.toggle('still', still);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms);
  },
  line(mood) {
    const l = this.LINES[mood] || this.LINES.okay;
    let t;
    do t = l[Math.floor(Math.random() * l.length)]; while (t === this._last && l.length > 1);
    return (this._last = t);
  },
  /** Neru in `mood`, for a screen to put where `cls` places her; she comes in once her picture is ready and says her
   *  line `delay` ms later. Null when she's turned off. */
  make(mood, cls, { delay = 450, hold = 3600 } = {}) {
    if (!Settings.get('ui.mascot')) return null;
    const el = h(`button.neru-cameo.${cls}`, { type: 'button', 'aria-label': 'Neru', tabindex: '-1', hidden: true });
    NeruMascot.pictures().then(async pics => {
      if (!pics) { el.remove(); return; }
      const face = this.face(pics, mood), happy = pics.happy && this.pose(pics, 'happy');
      const img = h('img.nc-img', { src: face.src, alt: '', draggable: 'false' });
      // (her place's height, times how big she's shown in this pose)
      const show = f => { img.src = f.src; el.style.setProperty('--nc-s', f.scale); };
      el.style.setProperty('--nc-s', face.scale);
      // (shown once it can be drawn, never as an empty box that pops)
      try { await img.decode(); } catch { /* shown anyway */ }
      if (!el.isConnected && !el.parentNode) return;
      const say = h('span.neru-say.nc-say');
      el.append(h('span.nc-body', img), say);
      el.hidden = false;
      const anim = !!Settings.get('ui.animSpeed');
      if (anim) el.classList.add('in');
      const talk = (text, ms) => {
        say.textContent = text;
        say.style.setProperty('--say', `${ms}ms`);
        this.pop(say, ms);
      };
      setTimeout(() => { if (el.isConnected) { talk(this.line(mood), hold); this.burst(el, mood); } }, anim ? delay : 0);
      el.addEventListener('click', e => {
        e.stopPropagation();
        UISounds.click();
        el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop');
        // (her happy face for a moment, whatever her mood)
        if (happy && face.src !== happy.src) { show(happy); clearTimeout(el._back); el._back = setTimeout(() => show(face), 1600); }
        talk(this.line(mood), 2200);
        this.burst(el, mood);
      });
    });
    return el;
  },
  /** A few sparkles that burst out around her head and fade — when she's pleased (not that she'd say so). */
  burst(el, mood) {
    if (!this.HAPPY.has(mood) || !Settings.get('ui.animSpeed') || document.documentElement.classList.contains('slow')) return;
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
      const el = this.make('boot', 'nc-boot', { delay: 500, hold: 4000 });
      if (el) ls.append(el);
    }, 700);
  },
};

Bus.on('settings:changed', k => {
  if (k === 'ui.mascot' && Screens.currentName === 'home') { const old = document.querySelector('.home .neru'); if (old) old.replaceWith(NeruMascot.build()); }
});
