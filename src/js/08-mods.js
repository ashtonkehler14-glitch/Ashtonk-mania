/* ModSystem — modular, data-driven mods. Only mods that make sense for mania are offered
 * (osu!standard-only mods such as Relax / Autopilot / Spun Out are intentionally excluded).
 * Score multipliers follow osu!mania: EZ/NF/HT 0.5, CS/NLN/NR 0.9, Difficulty Adjust 0.5, others 1.0.
 * Configurable mods (AC, DA, RT, HD/FI coverage, Percy) read their values from `mods.config`. */

const MODS = [
  { id: 'EZ', name: 'Easy', group: 'reduction', key: 'KeyQ', mult: 0.5, color: '#b2ff66', incompatible: ['HR', 'DA'],
    desc: 'Timing windows 1.4× wider, health drains half as much.' },
  { id: 'NF', name: 'No Fail', group: 'reduction', key: 'KeyW', mult: 0.5, color: '#b2ff66', incompatible: ['SD', 'PF', 'PSS', 'AC', 'AT'],
    desc: 'You can\'t fail, no matter what.' },
  { id: 'HT', name: 'Half Time', group: 'reduction', key: 'KeyE', mult: 0.5, color: '#b2ff66', incompatible: ['DT', 'NC', 'DC', 'RT'], rate: 0.75,
    desc: 'Less zoom… 0.75× speed, pitch preserved.' },
  { id: 'DC', name: 'Daycore', group: 'reduction', key: 'KeyR', mult: 0.5, color: '#b2ff66', incompatible: ['DT', 'NC', 'HT', 'RT'], rate: 0.75, pitch: true,
    desc: 'Whoaaaa… 0.75× speed with lowered pitch.' },
  { id: 'NR', name: 'No Release', group: 'reduction', key: 'KeyT', mult: 0.9, color: '#b2ff66', incompatible: ['NLN', 'IN'],
    desc: 'No more timing the end of hold notes: keep holding to the end for a MAX.' },
  { id: 'HR', name: 'Hard Rock', group: 'increase', key: 'KeyA', mult: 1.0, color: '#ff6666', incompatible: ['EZ', 'DA'],
    desc: 'Timing windows 1.4× tighter, health drains 1.4× harder.' },
  { id: 'SD', name: 'Sudden Death', group: 'increase', key: 'KeyS', mult: 1.0, color: '#ff6666', incompatible: ['NF', 'PF', 'PSS', 'AT'],
    desc: 'Miss once (or let go of a hold early) and fail.' },
  { id: 'PF', name: 'Perfect', group: 'increase', key: 'KeyD', mult: 1.0, color: '#ff6666', incompatible: ['NF', 'SD', 'PSS', 'AT'],
    desc: 'Anything below 300 (or letting go of a hold early) fails you.' },
  { id: 'PSS', name: 'Perfect (SS)', group: 'increase', key: 'KeyP', mult: 1.0, color: '#ff6666', incompatible: ['NF', 'SD', 'PF', 'AT'],
    desc: 'Only MAX judgements allowed.' },
  { id: 'AC', name: 'Accuracy Challenge', group: 'increase', key: 'KeyK', mult: 1.0, color: '#ff6666', incompatible: ['NF', 'AT'], config: 'acc',
    desc: 'Fail if your accuracy drops below the target.' },
  { id: 'DT', name: 'Double Time', group: 'increase', key: 'KeyF', mult: 1.0, color: '#ff6666', incompatible: ['HT', 'DC', 'NC', 'RT'], rate: 1.5,
    desc: 'Zoooooooooom… 1.5× speed, pitch preserved.' },
  { id: 'NC', name: 'Nightcore', group: 'increase', key: 'KeyG', mult: 1.0, color: '#ff6666', incompatible: ['HT', 'DC', 'DT', 'RT'], rate: 1.5, pitch: true,
    desc: 'Uguuuuuuuu… 1.5× speed with raised pitch.' },
  { id: 'HD', name: 'Hidden', group: 'increase', key: 'KeyH', mult: 1.0, color: '#ff6666', incompatible: ['FI'], config: 'cover',
    desc: 'Notes fade out before you hit them.' },
  { id: 'FI', name: 'Fade In', group: 'increase', key: 'KeyJ', mult: 1.0, color: '#ff6666', incompatible: ['HD'], config: 'cover',
    desc: 'Notes appear out of nowhere near the receptors.' },
  { id: 'MR', name: 'Mirror', group: 'conversion', key: 'KeyZ', mult: 1.0, color: '#8c66ff', incompatible: ['RD'],
    desc: 'Columns are mirrored left ↔ right.' },
  { id: 'RD', name: 'Random', group: 'conversion', key: 'KeyX', mult: 1.0, color: '#8c66ff', incompatible: ['MR'],
    desc: 'Columns are shuffled (seeded — replays stay reproducible).' },
  { id: 'CS', name: 'Constant Speed', group: 'conversion', key: 'KeyC', mult: 0.9, color: '#8c66ff', incompatible: [],
    desc: 'No more tricky speed changes: ignores SV and BPM scroll changes.' },
  { id: 'NLN', name: 'Hold Off', group: 'conversion', key: 'KeyV', mult: 0.9, color: '#8c66ff', incompatible: ['IN', 'NR'],
    desc: 'Long notes become regular notes.' },
  { id: 'IN', name: 'Invert', group: 'conversion', key: 'KeyI', mult: 1.0, color: '#8c66ff', incompatible: ['NLN', 'NR'],
    desc: 'Hold the keys. To the beat. Every gap between notes becomes a long note.' },
  { id: 'PC', name: 'Percy', group: 'conversion', key: 'KeyB', mult: 1.0, color: '#8c66ff', incompatible: ['NLN'], config: 'percy',
    desc: 'Long note tails are drawn shorter (visual only).' },
  { id: 'RT', name: 'Song Speed', group: 'conversion', key: 'KeyN', mult: 1.0, color: '#8c66ff', incompatible: ['HT', 'DC', 'DT', 'NC'], config: 'rate',
    desc: 'Any playback rate from 0.5× to 2×.' },
  { id: 'DA', name: 'Difficulty Adjust', group: 'conversion', key: 'KeyL', mult: 0.5, color: '#8c66ff', incompatible: ['EZ', 'HR'], config: 'da',
    desc: 'Override the beatmap\'s OD and HP.' },
  { id: 'AT', name: 'Auto', group: 'automation', key: 'KeyM', mult: 1.0, color: '#66ccff', incompatible: ['NF', 'SD', 'PF', 'PSS', 'AC'], unranked: true,
    desc: 'Watch a perfect automated play-through. Scores are not saved.' },
];
const MOD_BY_ID = new Map(MODS.map(m => [m.id, m]));
/** A glyph for every mod (24×24, stroked), in the spirit of osu!lazer's mod icons. */
const MOD_GLYPHS = {
  EZ: '<path d="M19 4C9 4 5 10 5 20c3-5 7-8 12-9M5 20l6-6"/>',
  NF: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  HT: '<path d="M14 6l-6 6 6 6M20 6l-6 6 6 6"/>',
  DC: '<path d="M14 6l-6 6 6 6"/><path d="M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
  NR: '<rect x="4" y="9" width="16" height="6" rx="3"/><path d="M5 20L19 4"/>',
  HR: '<path d="M12 21c-4 0-7-3-7-7 0-4 3-5 4-10 2 2 3 4 3 6 1-1 2-2 2-4 3 2 5 5 5 8 0 4-3 7-7 7z"/>',
  SD: '<path d="M12 3a7 7 0 00-7 7c0 2.5 1.2 4.3 3 5.3V19h8v-3.7c1.8-1 3-2.8 3-5.3a7 7 0 00-7-7z"/><circle cx="9.5" cy="10.5" r="1.3" class="fillme"/><circle cx="14.5" cy="10.5" r="1.3" class="fillme"/><path d="M11 19v-2M13 19v-2"/>',
  PF: '<circle cx="12" cy="12" r="8"/><path d="M10 16V8h3a2.5 2.5 0 010 5h-3"/>',
  PSS: '<circle cx="12" cy="12" r="8"/><path d="M11 9h-2a1.5 1.5 0 000 3h1a1.5 1.5 0 010 3H8M17 9h-2a1.5 1.5 0 000 3h1a1.5 1.5 0 010 3h-2"/>',
  AC: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" class="fillme"/>',
  DT: '<path d="M4 6l6 6-6 6M10 6l6 6-6 6M16 6l4 6-4 6"/>',
  NC: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>',
  HD: '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><path d="M4 20L20 4"/>',
  FI: '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.5"/>',
  MR: '<path d="M12 3v18"/><path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  RD: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" class="fillme"/><circle cx="15.5" cy="15.5" r="1.2" class="fillme"/><circle cx="12" cy="12" r="1.2" class="fillme"/>',
  CS: '<path d="M3 12h18"/><path d="M7 8v8M12 8v8M17 8v8"/>',
  NLN: '<rect x="6" y="9" width="12" height="6" rx="2"/><path d="M12 3v3M12 18v3"/>',
  IN: '<path d="M7 4v16M17 4v16"/><path d="M4 8l3-4 3 4M14 16l3 4 3-4"/>',
  PC: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5L20 17M8 15.5L20 7"/>',
  RT: '<path d="M4 16a8 8 0 1116 0"/><path d="M12 16l4-5"/>',
  DA: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" class="fillme"/><circle cx="15" cy="12" r="2" class="fillme"/><circle cx="7" cy="17" r="2" class="fillme"/>',
  AT: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01"/><circle cx="12" cy="3.5" r="1.2" class="fillme"/>',
};
/** osu!lazer's mod icon: a rounded hexagon in the mod type's colour with the mod's glyph on it. */
function modIcon(id, size = 36) {
  const m = MOD_BY_ID.get(id), c = m ? m.color : '#888';
  const el = h('span.mod-icon', { style: { '--mod': c, width: size + 'px', height: Math.round(size * 0.72) + 'px' }, title: m ? m.name : id });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 50 36');
  svg.innerHTML = `<path d="M10 2h30a4 4 0 013.4 1.9l5.2 9a10 10 0 010 10.2l-5.2 9A4 4 0 0140 34H10a4 4 0 01-3.4-1.9l-5.2-9a10 10 0 010-10.2l5.2-9A4 4 0 0110 2z" class="mi-bg"/>`
    + `<g transform="translate(15 8) scale(.83)" class="mi-g">${(MOD_GLYPHS[id] || '').replace(/class="fillme"/g, 'class="mi-fill"')}</g>`
    + (MOD_GLYPHS[id] ? '' : `<text x="25" y="23" text-anchor="middle" class="mi-t">${id}</text>`);
  el.append(svg);
  return el;
}
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
    return h(`span.mod-badge${small ? '.small' : ''}`, { style: { '--mod': m ? m.color : '#888' }, title: m ? `${m.name}${d ? ' ' + d : ''}` : id },
      modIcon(id, small ? 24 : 30), h('span.mb-t', id));
  },
};
