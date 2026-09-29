/* ModSystem — modular, data-driven mods. Only mods that make sense for mania are offered
 * (osu!standard-only mods such as Relax / Autopilot / Spun Out / Flashlight aim are intentionally excluded). */

const MODS = [
  { id: 'EZ', name: 'Easy', group: 'reduction', key: 'KeyQ', mult: 0.5, color: '#7ee07a', incompatible: ['HR'],
    desc: 'Larger timing windows, half health drain.' },
  { id: 'NF', name: 'No Fail', group: 'reduction', key: 'KeyW', mult: 0.5, color: '#7ee07a', incompatible: ['SD', 'PF', 'AT'],
    desc: 'You can\'t fail, no matter what.' },
  { id: 'HT', name: 'Half Time', group: 'reduction', key: 'KeyE', mult: 0.5, color: '#7ee07a', incompatible: ['DT', 'NC', 'DC'], rate: 0.75,
    desc: 'Less zoom… 0.75× speed, pitch preserved.' },
  { id: 'DC', name: 'Daycore', group: 'reduction', key: 'KeyR', mult: 0.5, color: '#7ee07a', incompatible: ['DT', 'NC', 'HT'], rate: 0.75, pitch: true,
    desc: 'Whoaaaa… 0.75× speed with lowered pitch.' },
  { id: 'HR', name: 'Hard Rock', group: 'increase', key: 'KeyA', mult: 1.0, color: '#ff7a8a', incompatible: ['EZ'],
    desc: 'Tighter timing windows (÷1.4) and harsher health drain.' },
  { id: 'SD', name: 'Sudden Death', group: 'increase', key: 'KeyS', mult: 1.0, color: '#ff7a8a', incompatible: ['NF', 'PF', 'AT'],
    desc: 'Miss once and fail.' },
  { id: 'PF', name: 'Perfect', group: 'increase', key: 'KeyD', mult: 1.0, color: '#ff7a8a', incompatible: ['NF', 'SD', 'AT'],
    desc: 'Anything below Perfect fails you.' },
  { id: 'DT', name: 'Double Time', group: 'increase', key: 'KeyF', mult: 1.0, color: '#ff7a8a', incompatible: ['HT', 'DC', 'NC'], rate: 1.5,
    desc: 'Zoooooooooom… 1.5× speed, pitch preserved.' },
  { id: 'NC', name: 'Nightcore', group: 'increase', key: 'KeyG', mult: 1.0, color: '#ff7a8a', incompatible: ['HT', 'DC', 'DT'], rate: 1.5, pitch: true,
    desc: 'Uguuuuuuuu… 1.5× speed with raised pitch.' },
  { id: 'HD', name: 'Hidden', group: 'increase', key: 'KeyH', mult: 1.0, color: '#ff7a8a', incompatible: ['FI'],
    desc: 'Notes fade out before you hit them.' },
  { id: 'FI', name: 'Fade In', group: 'increase', key: 'KeyJ', mult: 1.0, color: '#ff7a8a', incompatible: ['HD'],
    desc: 'Notes appear out of nowhere near the receptors.' },
  { id: 'MR', name: 'Mirror', group: 'conversion', key: 'KeyZ', mult: 1.0, color: '#b28bff', incompatible: ['RD'],
    desc: 'Columns are mirrored left ↔ right.' },
  { id: 'RD', name: 'Random', group: 'conversion', key: 'KeyX', mult: 1.0, color: '#b28bff', incompatible: ['MR'],
    desc: 'Columns are shuffled (seeded — replays stay reproducible).' },
  { id: 'CS', name: 'Constant Speed', group: 'conversion', key: 'KeyC', mult: 0.9, color: '#b28bff', incompatible: [],
    desc: 'No more tricky speed changes: ignores SV and BPM scroll changes.' },
  { id: 'NLN', name: 'No Long Notes', group: 'conversion', key: 'KeyV', mult: 0.9, color: '#b28bff', incompatible: [],
    desc: 'Long notes become regular notes.' },
  { id: 'AT', name: 'Auto', group: 'automation', key: 'KeyM', mult: 1.0, color: '#6cc6ff', incompatible: ['NF', 'SD', 'PF'], unranked: true,
    desc: 'Watch a perfect automated play-through. Scores are not saved.' },
];
const MOD_BY_ID = new Map(MODS.map(m => [m.id, m]));
const MOD_GROUPS = [['reduction', 'Difficulty Reduction'], ['increase', 'Difficulty Increase'], ['conversion', 'Conversion'], ['automation', 'Automation']];

const ModSystem = {
  normalize(list) { return MODS.filter(m => list.includes(m.id)).map(m => m.id); },
  toggle(list, id) {
    const m = MOD_BY_ID.get(id);
    if (!m) return list;
    if (list.includes(id)) return list.filter(x => x !== id);
    return this.normalize([...list.filter(x => !m.incompatible.includes(x) && !(MOD_BY_ID.get(x)?.incompatible || []).includes(id)), id]);
  },
  multiplier(list) { return list.reduce((a, id) => a * (MOD_BY_ID.get(id)?.mult ?? 1), 1); },
  rate(list) { for (const id of list) { const r = MOD_BY_ID.get(id)?.rate; if (r) return r; } return 1; },
  pitchShift(list) { return list.some(id => MOD_BY_ID.get(id)?.pitch); },
  label(list) { return list.length ? list.join('') : 'NM'; },
  isRanked(list) { return !list.some(id => MOD_BY_ID.get(id)?.unranked); },
  /** Timing window multiplier in real time. */
  windowScale(list) { return list.includes('HR') ? 1 / 1.4 : list.includes('EZ') ? 1.4 : 1; },
  drainScale(list) { return list.includes('HR') ? 1.4 : list.includes('EZ') ? 0.5 : 1; },
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
  badge(id, small = false) {
    const m = MOD_BY_ID.get(id);
    return h(`span.mod-badge${small ? '.small' : ''}`, { style: { '--mod': m ? m.color : '#888' }, title: m ? m.name : id }, id);
  },
};
