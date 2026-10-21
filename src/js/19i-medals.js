/* Medals, as osu!'s: earned by playing, each unlocked once with lazer's MedalAnimation — the screen dims, a 400px disc
 * (a 5px white rim, Blue glow, dark teal with triangles) pops in with an elastic bounce, light strips sweep out to
 * the sides, then "MEDAL UNLOCKED", the medal's name and what it was for. The profile lists them all. */

// Only the hard ones (and Neru's secrets): passes from 5★, full combos from 4★ — [stars, name]
const MEDAL_PASS = [[5, 'Five-Star Fury'], [6, 'Beyond Reason'], [7, 'Seventh Heaven'], [8, 'Into the Abyss']];
const MEDAL_FC = [[4, 'Iron Focus'], [5, 'Untouchable'], [6, 'Perfect Storm']];
// (lazer's skill medals don't count plays made easier)
const medalEasy = s => (s.mods || []).some(m => ['AT', 'NF', 'EZ', 'HT', 'DC'].includes(m)) || (s.rate || 1) < 1;
const MEDALS = [
  ...MEDAL_PASS.map(([stars, name]) => ({ id: `pass${stars}`, group: 'Skill', icon: 'star', stars, name, desc: `Pass a ${stars}★ beatmap without mods that make it easier.`, test: s => s.passed && !medalEasy(s) && s.stars >= stars })),
  ...MEDAL_FC.map(([stars, name]) => ({ id: `fc${stars}`, group: 'Skill', icon: 'target', stars, name, desc: `Full combo a ${stars}★ beatmap without mods that make it easier.`, test: s => s.passed && !medalEasy(s) && s.stars >= stars && s.counts && s.counts[5] === 0 })),
  { id: 'ss4', group: 'Skill', icon: 'magic', name: 'Perfectionist', desc: 'Get an SS on a 4★ beatmap: nothing below a 300.', test: s => s.passed && !medalEasy(s) && s.stars >= 4 && (s.grade === 'SS' || s.grade === 'XH') },
  { id: 'combo1000', group: 'Skill', icon: 'bolt', name: 'Thousand Strong', desc: 'Reach a 1,000x combo.', test: s => !(s.mods || []).includes('AT') && s.maxCombo >= 1000 },
  { id: 'plays1000', group: 'Dedication', icon: 'play', name: 'Devoted', desc: 'Play 1,000 times.', count: 1000 },
  // Neru's secrets: each unlocked by finding one of her easter eggs (NeruEggs.found) — "???" on the profile till then
  ...[['code', 'keyboard', 'Up Up Down Down', 'Get Neru dancing with a certain code.'],
    ['beat', 'music', 'On Beat', 'Tap along to the menu music until Neru dances.'],
    ['pat', 'heart', 'Headpat', 'Give Neru a headpat. She definitely didn\'t like it.'],
    ['dizzy', 'star', 'Round and Round', 'Make Neru dizzy.'],
    ['zako', 'chat', 'Zako~', 'Say her line back to her.'],
    ['hundred', 'heart-fill', 'Persistence', 'Click Neru a hundred times in one go.'],
    ['alone', 'clock', 'Left Alone', 'Leave Neru alone until she\'s hugging her knees.'],
    ['fish', 'magic', 'Gone Fishing', 'Pause so long she goes fishing — then bother the fish.'],
    ['peek', 'eye', 'You Called?', 'Search for her name.'],
    ['twirl', 'retry', 'Twirl', 'Double-click Neru.'],
    ['night', 'ghost', 'Night Owl', 'Catch Neru yawning after midnight.'],
    ['showoff', 'target', 'Show-off', 'Click Neru after a full combo.'],
    ['seasons', 'sync', 'Four Seasons', 'See four different times of year around Neru.'],
    ['teto', 'crosscircle', 'Wrong Twin-Tails', 'Put Teto in your name. Neru noticed.'],
    ['fine', 'book', 'The Fine Print', 'Scroll all the way down the settings.']].map(([id, ic, name, desc]) => ({ id: `neru-${id}`, group: 'Neru', icon: ic, name, desc, egg: true })),
];

const Medals = {
  all: MEDALS, queue: [], showing: false,
  unlocked() { return Settings.get('medals.unlocked') || {}; },
  has(id) { return !!this.unlocked()[id]; },
  /** After a play: unlock what it earned (shown once the results are up). */
  check(score) {
    if (!score) return;
    const got = { ...this.unlocked() }, fresh = [], plays = ScoreManager.scores.length;
    for (const m of MEDALS) {
      if (got[m.id] || m.egg) continue;
      const ok = m.count ? plays >= m.count : m.test(score);
      if (ok) { got[m.id] = Date.now(); fresh.push(m); }
    }
    if (!fresh.length) return;
    Settings.set('medals.unlocked', got);
    this.queue.push(...fresh);
    this.later();
  },
  /** Medals earned before there were medals: unlocked quietly, once. */
  backfill() {
    if (Settings.get('medals.backfilled2')) return; // (again for the medals there are now)
    const got = { ...this.unlocked() }, plays = ScoreManager.scores.length;
    for (const m of MEDALS) {
      if (got[m.id] || m.egg) continue;
      const s = m.count ? (plays >= m.count ? ScoreManager.scores[m.count - 1] : null) : ScoreManager.scores.find(x => m.test(x));
      if (s) got[m.id] = s.date || Date.now();
    }
    Settings.set('medals.unlocked', got);
    Settings.set('medals.backfilled2', true);
  },
  /** One of Neru's secrets found (`id`, a medal with `egg`): unlocked, once, with the medal animation. */
  egg(id) {
    const m = MEDALS.find(x => x.id === id && x.egg);
    if (!m || this.has(id)) return;
    Settings.set('medals.unlocked', { ...this.unlocked(), [id]: Date.now() });
    this.queue.push(m);
    this.later();
  },
  /** Show the queue one at a time, never over gameplay (lazer holds them for the results screen). */
  later() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      if (this.showing || !this.queue.length) return;
      if (Screens.currentName === 'gameplay' || Overlays.top()) { this.later(); return; }
      this.show(this.queue.shift());
    }, 1400);
  },
  show(m) {
    this.showing = true;
    if (Settings.get('audio.uiSounds')) { const b = AudioManager.synth('medal-get'); b && AudioManager.play(b, { bus: 'ui' }); }
    const el = h('div.medal-ov', { role: 'dialog', 'aria-label': `Medal unlocked: ${m.name}` },
      h('div.md-strip.l'), h('div.md-strip.r'),
      h('div.md-disc', h('div.md-tri'), h('div.md-icon', icon(m.icon))),
      h('div.md-text', h('div.md-unlocked', 'MEDAL UNLOCKED'), h('div.md-name', m.name), h('div.md-desc', m.desc)));
    // (Neru, in the corner once the medal's up — the one on the screen behind steps out meanwhile: never two of her)
    const neru = typeof NeruCameo !== 'undefined' && NeruCameo.make(m.egg ? 'secret' : 'medal', 'nc-medal', { delay: 1700 });
    if (neru) el.append(neru);
    let done = false;
    const close = () => { if (done) return; done = true; o.close(); };
    const o = makeOverlay(el, { onClose: () => { this.showing = false; this.later(); }, onKey: e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { close(); return true; } return false; } });
    el.addEventListener('click', close);
    Notifications.add(`Medal unlocked: ${m.name}`, m.desc, 'ok');
  },
  /** The profile's Medals section: every medal, the ones not yet earned dimmed. */
  section(got = this.unlocked()) {
    const groups = [...new Set(MEDALS.map(m => m.group))];
    // (every one of Neru's secrets found: there she is beside them, cheering)
    const allNeru = MEDALS.filter(m => m.egg).every(m => got[m.id]);
    const neru = g => g === 'Neru' && allNeru && typeof NeruCameo !== 'undefined' ? NeruCameo.make('allFound', 'nc-medals', { delay: 300 }) : null;
    return groups.map(g => h('div.md-group', h('h4', g), neru(g), h('div.md-grid', ...MEDALS.filter(m => m.group === g).map(m =>
      // (one of Neru's secrets not found yet: only that there is one)
      m.egg && !got[m.id] ? h('div.md-badge.secret', { title: '??? — A secret. Keep an eye on Neru.' }, h('div.md-mini', icon('question')), h('span', '???')) :
      h(`div.md-badge${got[m.id] ? '.on' : ''}`, { title: `${m.name} — ${m.desc}${got[m.id] ? `\nUnlocked ${new Date(got[m.id]).toLocaleDateString()}` : ''}` },
        h('div.md-mini', icon(m.icon)), h('span', m.name))))));
  },
  count() { const got = this.unlocked(); return MEDALS.filter(m => got[m.id]).length; },
};
