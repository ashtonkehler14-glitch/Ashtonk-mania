/* ModSystem — modular, data-driven mods. Only mods that make sense for mania are offered
 * (osu!standard-only mods such as Relax / Autopilot / Spun Out are intentionally excluded).
 * Score multipliers follow osu!mania: EZ/NF/HT 0.5, CS/NLN/NR 0.9, Difficulty Adjust 0.5, others 1.0.
 * Configurable mods (AC, DA, RT, HD/FI coverage, Percy) read their values from `mods.config`. */

const MODS = [
  { id: 'EZ', name: 'Easy', group: 'reduction', key: 'KeyQ', mult: 0.5, color: '#7ee07a', incompatible: ['HR', 'DA'],
    desc: 'Timing windows 1.4× wider, health drains half as much.' },
  { id: 'NF', name: 'No Fail', group: 'reduction', key: 'KeyW', mult: 0.5, color: '#7ee07a', incompatible: ['SD', 'PF', 'PSS', 'AC', 'AT'],
    desc: 'You can\'t fail, no matter what.' },
  { id: 'HT', name: 'Half Time', group: 'reduction', key: 'KeyE', mult: 0.5, color: '#7ee07a', incompatible: ['DT', 'NC', 'DC', 'RT'], rate: 0.75,
    desc: 'Less zoom… 0.75× speed, pitch preserved.' },
  { id: 'DC', name: 'Daycore', group: 'reduction', key: 'KeyR', mult: 0.5, color: '#7ee07a', incompatible: ['DT', 'NC', 'HT', 'RT'], rate: 0.75, pitch: true,
    desc: 'Whoaaaa… 0.75× speed with lowered pitch.' },
  { id: 'NR', name: 'No Release', group: 'reduction', key: 'KeyT', mult: 0.9, color: '#7ee07a', incompatible: ['NLN', 'IN'],
    desc: 'No more timing the end of hold notes: keep holding to the end for a MAX.' },
  { id: 'HR', name: 'Hard Rock', group: 'increase', key: 'KeyA', mult: 1.0, color: '#ff7a8a', incompatible: ['EZ', 'DA'],
    desc: 'Timing windows 1.4× tighter, health drains 1.4× harder.' },
  { id: 'SD', name: 'Sudden Death', group: 'increase', key: 'KeyS', mult: 1.0, color: '#ff7a8a', incompatible: ['NF', 'PF', 'PSS', 'AT'],
    desc: 'Miss once (or let go of a hold early) and fail.' },
  { id: 'PF', name: 'Perfect', group: 'increase', key: 'KeyD', mult: 1.0, color: '#ff7a8a', incompatible: ['NF', 'SD', 'PSS', 'AT'],
    desc: 'Anything below 300 (or letting go of a hold early) fails you.' },
  { id: 'PSS', name: 'Perfect (SS)', group: 'increase', key: 'KeyP', mult: 1.0, color: '#ff7a8a', incompatible: ['NF', 'SD', 'PF', 'AT'],
    desc: 'Only MAX judgements allowed.' },
  { id: 'AC', name: 'Accuracy Challenge', group: 'increase', key: 'KeyK', mult: 1.0, color: '#ff7a8a', incompatible: ['NF', 'AT'], config: 'acc',
    desc: 'Fail if your accuracy drops below the target.' },
  { id: 'DT', name: 'Double Time', group: 'increase', key: 'KeyF', mult: 1.0, color: '#ff7a8a', incompatible: ['HT', 'DC', 'NC', 'RT'], rate: 1.5,
    desc: 'Zoooooooooom… 1.5× speed, pitch preserved.' },
  { id: 'NC', name: 'Nightcore', group: 'increase', key: 'KeyG', mult: 1.0, color: '#ff7a8a', incompatible: ['HT', 'DC', 'DT', 'RT'], rate: 1.5, pitch: true,
    desc: 'Uguuuuuuuu… 1.5× speed with raised pitch.' },
  { id: 'HD', name: 'Hidden', group: 'increase', key: 'KeyH', mult: 1.0, color: '#ff7a8a', incompatible: ['FI'], config: 'cover',
    desc: 'Notes fade out before you hit them.' },
  { id: 'FI', name: 'Fade In', group: 'increase', key: 'KeyJ', mult: 1.0, color: '#ff7a8a', incompatible: ['HD'], config: 'cover',
    desc: 'Notes appear out of nowhere near the receptors.' },
  { id: 'MR', name: 'Mirror', group: 'conversion', key: 'KeyZ', mult: 1.0, color: '#b28bff', incompatible: ['RD'],
    desc: 'Columns are mirrored left ↔ right.' },
  { id: 'RD', name: 'Random', group: 'conversion', key: 'KeyX', mult: 1.0, color: '#b28bff', incompatible: ['MR'],
    desc: 'Columns are shuffled (seeded — replays stay reproducible).' },
  { id: 'CS', name: 'Constant Speed', group: 'conversion', key: 'KeyC', mult: 0.9, color: '#b28bff', incompatible: [],
    desc: 'No more tricky speed changes: ignores SV and BPM scroll changes.' },
  { id: 'NLN', name: 'Hold Off', group: 'conversion', key: 'KeyV', mult: 0.9, color: '#b28bff', incompatible: ['IN', 'NR'],
    desc: 'Long notes become regular notes.' },
  { id: 'IN', name: 'Invert', group: 'conversion', key: 'KeyI', mult: 1.0, color: '#b28bff', incompatible: ['NLN', 'NR'],
    desc: 'Hold the keys. To the beat. Every gap between notes becomes a long note.' },
  { id: 'PC', name: 'Percy', group: 'conversion', key: 'KeyB', mult: 1.0, color: '#b28bff', incompatible: ['NLN'], config: 'percy',
    desc: 'Long note tails are drawn shorter (visual only).' },
  { id: 'RT', name: 'Song Speed', group: 'conversion', key: 'KeyN', mult: 1.0, color: '#b28bff', incompatible: ['HT', 'DC', 'DT', 'NC'], config: 'rate',
    desc: 'Any playback rate from 0.5× to 2×.' },
  { id: 'DA', name: 'Difficulty Adjust', group: 'conversion', key: 'KeyL', mult: 0.5, color: '#b28bff', incompatible: ['EZ', 'HR'], config: 'da',
    desc: 'Override the beatmap\'s OD and HP.' },
  { id: 'AT', name: 'Auto', group: 'automation', key: 'KeyM', mult: 1.0, color: '#6cc6ff', incompatible: ['NF', 'SD', 'PF', 'PSS', 'AC'], unranked: true,
    desc: 'Watch a perfect automated play-through. Scores are not saved.' },
];
const MOD_BY_ID = new Map(MODS.map(m => [m.id, m]));
const MOD_GROUPS = [['reduction', 'Difficulty Reduction'], ['increase', 'Difficulty Increase'], ['conversion', 'Conversion'], ['automation', 'Automation']];
const MOD_CONFIG_DEFAULTS = { acc: 0.9, od: 8, hp: 8, rate: 1.2, cover: 0.5, percy: 150 };

const ModSystem = {
  normalize(list) { return MODS.filter(m => list.includes(m.id)).map(m => m.id); },
  toggle(list, id) {
    const m = MOD_BY_ID.get(id);
    if (!m) return list;
    if (list.includes(id)) return list.filter(x => x !== id);
    return this.normalize([...list.filter(x => !m.incompatible.includes(x) && !(MOD_BY_ID.get(x)?.incompatible || []).includes(id)), id]);
  },
  config(cfg) { return { ...MOD_CONFIG_DEFAULTS, ...(cfg || (typeof Settings !== 'undefined' ? Settings.get('mods.config') : null) || {}) }; },
  multiplier(list, cfg) {
    let m = list.reduce((a, id) => a * (MOD_BY_ID.get(id)?.mult ?? 1), 1);
    if (list.includes('RT') && this.config(cfg).rate < 1) m *= 0.5;
    return m;
  },
  rate(list, cfg) {
    if (list.includes('RT')) return clamp(Math.round(this.config(cfg).rate * 20) / 20, 0.5, 2);
    for (const id of list) { const r = MOD_BY_ID.get(id)?.rate; if (r) return r; }
    return 1;
  },
  pitchShift(list) { return list.some(id => MOD_BY_ID.get(id)?.pitch); },
  label(list) { return list.length ? list.join('') : 'NM'; },
  isRanked(list) { return !list.some(id => MOD_BY_ID.get(id)?.unranked); },
  /** Column permutation for Mirror / Random. */
  columnMap(list, keys, seed) {
    const map = Array.from({ length: keys }, (_, i) => i);
    if (list.includes('MR')) map.reverse();
    if (list.includes('RD')) {
      const rnd = mulberry32(seed);
      for (let i = keys - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [map[i], map[j]] = [map[j], map[i]]; }
    }
    return map;
  },
  /** Short human description of configured values (shown on badges / results). */
  describe(id, cfg) {
    const c = this.config(cfg);
    if (id === 'AC') return `${Math.round(c.acc * 100)}%`;
    if (id === 'RT') return `${this.rate(['RT'], cfg)}×`;
    if (id === 'DA') return `OD${c.od} HP${c.hp}`;
    if (id === 'HD' || id === 'FI') return `${Math.round(c.cover * 100)}%`;
    if (id === 'PC') return `${c.percy}ms`;
    return '';
  },
  badge(id, small = false, cfg = null) {
    const m = MOD_BY_ID.get(id);
    const d = cfg ? this.describe(id, cfg) : '';
    return h(`span.mod-badge${small ? '.small' : ''}`, { style: { '--mod': m ? m.color : '#888' }, title: m ? `${m.name}${d ? ' ' + d : ''}` : id }, id);
  },
};
