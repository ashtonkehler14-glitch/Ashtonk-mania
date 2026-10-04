/* Medals, as osu!'s: earned by playing, each unlocked once with lazer's MedalAnimation — the screen dims, a 400px disc
 * (a 5px white rim, Blue glow, dark teal with triangles) pops in with an elastic bounce, light strips sweep out to
 * the sides, then "MEDAL UNLOCKED", the medal's name and what it was for. The profile lists them all. */

// stars → [name, …] for the pass and full combo medals
const MEDAL_PASS = ['Opening Act', 'Finding the Beat', 'In the Groove', 'Keyboard Warrior', 'Five-Star Fury', 'Beyond Reason', 'Seventh Heaven', 'Into the Abyss'];
const MEDAL_FC = ['Unbroken', 'Steady Hands', 'Flawless Flow', 'Iron Focus', 'Untouchable', 'Perfect Storm'];
// (lazer's skill medals don't count plays made easier)
const medalEasy = s => (s.mods || []).some(m => ['AT', 'NF', 'EZ', 'HT', 'DC'].includes(m)) || (s.rate || 1) < 1;
const MEDALS = [
  { id: 'first', group: 'Skill', icon: 'star', name: 'First Steps', desc: 'Pass your first beatmap.', test: s => s.passed && !(s.mods || []).includes('AT') },
  ...MEDAL_PASS.map((name, i) => ({ id: `pass${i + 1}`, group: 'Skill', icon: 'star', stars: i + 1, name, desc: `Pass a ${i + 1}★ beatmap without mods that make it easier.`, test: s => s.passed && !medalEasy(s) && s.stars >= i + 1 })),
  ...MEDAL_FC.map((name, i) => ({ id: `fc${i + 1}`, group: 'Skill', icon: 'target', stars: i + 1, name, desc: `Full combo a ${i + 1}★ beatmap without mods that make it easier.`, test: s => s.passed && !medalEasy(s) && s.stars >= i + 1 && s.counts && s.counts[5] === 0 })),
  { id: 'ss', group: 'Skill', icon: 'sparkle', name: 'Perfectionist', desc: 'Get an SS: nothing below a 300.', test: s => s.passed && !medalEasy(s) && (s.grade === 'SS' || s.grade === 'XH') },
  { id: 'combo500', group: 'Skill', icon: 'bolt', name: 'Combo Chain', desc: 'Reach a 500x combo.', test: s => !(s.mods || []).includes('AT') && s.maxCombo >= 500 },
  { id: 'combo1000', group: 'Skill', icon: 'bolt', name: 'Thousand Strong', desc: 'Reach a 1,000x combo.', test: s => !(s.mods || []).includes('AT') && s.maxCombo >= 1000 },
  { id: 'hidden', group: 'Mod Introduction', icon: 'ghost', name: 'In the Dark', desc: 'Pass a 3★ beatmap with Hidden or Fade In.', test: s => s.passed && !medalEasy(s) && s.stars >= 3 && (s.mods || []).some(m => m === 'HD' || m === 'FI') },
  { id: 'speed', group: 'Mod Introduction', icon: 'shuffle', name: 'Need for Speed', desc: 'Pass a 3★ beatmap with Double Time or Nightcore.', test: s => s.passed && !medalEasy(s) && s.stars >= 3 && (s.mods || []).some(m => m === 'DT' || m === 'NC') },
  { id: 'keys7', group: 'Mod Introduction', icon: 'keyboard', name: 'Seven Keys', desc: 'Pass a 7K beatmap.', test: s => s.passed && !(s.mods || []).includes('AT') && s.keys === 7 },
  { id: 'plays10', group: 'Dedication', icon: 'play', name: 'Warming Up', desc: 'Play 10 times.', count: 10 },
  { id: 'plays100', group: 'Dedication', icon: 'play', name: 'Regular', desc: 'Play 100 times.', count: 100 },
  { id: 'plays1000', group: 'Dedication', icon: 'play', name: 'Devoted', desc: 'Play 1,000 times.', count: 1000 },
  { id: 'multi', group: 'Hush-Hush', icon: 'multi', name: 'Better Together', desc: 'Finish a multiplayer match.', ctx: 'mp' },
  { id: 'daily', group: 'Hush-Hush', icon: 'calendar', name: 'Daily Dose', desc: 'Set a score in the daily challenge.', ctx: 'daily' },
];

const Medals = {
  all: MEDALS, queue: [], showing: false,
  unlocked() { return Settings.get('medals.unlocked') || {}; },
  has(id) { return !!this.unlocked()[id]; },
  /** After a play: unlock what it earned (shown once the results are up). */
  check(score, ctx = {}) {
    if (!score) return;
    const got = { ...this.unlocked() }, fresh = [], plays = ScoreManager.scores.length;
    for (const m of MEDALS) {
      if (got[m.id]) continue;
      const ok = m.count ? plays >= m.count : m.ctx ? !!ctx[m.ctx] && !(score.mods || []).includes('AT') : m.test(score);
      if (ok) { got[m.id] = Date.now(); fresh.push(m); }
    }
    if (!fresh.length) return;
    Settings.set('medals.unlocked', got);
    this.queue.push(...fresh);
    this.later();
  },
  /** Medals earned before there were medals: unlocked quietly, once. */
  backfill() {
    if (Settings.get('medals.backfilled')) return;
    const got = { ...this.unlocked() }, plays = ScoreManager.scores.length;
    for (const m of MEDALS) {
      if (got[m.id] || m.ctx) continue;
      const s = m.count ? (plays >= m.count ? ScoreManager.scores[m.count - 1] : null) : ScoreManager.scores.find(x => m.test(x));
      if (s) got[m.id] = s.date || Date.now();
    }
    Settings.set('medals.unlocked', got);
    Settings.set('medals.backfilled', true);
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
    let done = false;
    const close = () => { if (done) return; done = true; o.close(); };
    const o = makeOverlay(el, { onClose: () => { this.showing = false; this.later(); }, onKey: e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { close(); return true; } return false; } });
    el.addEventListener('click', close);
    Notifications.add(`Medal unlocked: ${m.name}`, m.desc, 'ok');
  },
  /** The profile's Medals section: every medal, the ones not yet earned dimmed. */
  section(got = this.unlocked()) {
    const groups = [...new Set(MEDALS.map(m => m.group))];
    return groups.map(g => h('div.md-group', h('h4', g), h('div.md-grid', ...MEDALS.filter(m => m.group === g).map(m =>
      h(`div.md-badge${got[m.id] ? '.on' : ''}`, { title: `${m.name} — ${m.desc}${got[m.id] ? `\nUnlocked ${new Date(got[m.id]).toLocaleDateString()}` : ''}` },
        h('div.md-mini', icon(m.icon)), h('span', m.name))))));
  },
  count() { const got = this.unlocked(); return MEDALS.filter(m => got[m.id]).length; },
};
