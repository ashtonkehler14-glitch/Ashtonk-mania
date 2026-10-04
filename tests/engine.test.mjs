import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const M = load(['00-util.js', '03-beatmap-parser.js', '08-mods.js', '09-gameplay.js', '09a-osu-math.js']);
const { GameplayEngine, BeatmapParser, J, timingWindows, generateAutoInputs, prepareNotes, DifficultyCalculator, OsuMath, ScoreSystem } = M;

function osu(objects, { keys = 4, od = 8, extraTP = '' } = {}) {
  return `osu file format v14

[General]
AudioFilename: audio.mp3
PreviewTime: 1000
Mode: 3

[Metadata]
Title:Test
Artist:Tester
Creator:Ash
Version:Hard

[Difficulty]
HPDrainRate:5
CircleSize:${keys}
OverallDifficulty:${od}

[Events]
0,0,"bg.jpg",0,0

[TimingPoints]
0,500,4,1,0,100,1,0
${extraTP}
[HitObjects]
${objects.join('\n')}
`;
}
const xFor = (col, keys) => Math.floor((col + 0.5) * 512 / keys);
const note = (col, t, keys = 4) => `${xFor(col, keys)},192,${t},1,0,0:0:0:0:`;
const ln = (col, t, end, keys = 4) => `${xFor(col, keys)},192,${t},128,0,${end}:0:0:0:0:`;

function engineFor(text, mods = []) {
  const bm = BeatmapParser.parse(text);
  const notes = prepareNotes(BeatmapParser.toManiaNotes(bm), BeatmapParser.keyCount(bm), mods, 1);
  return new GameplayEngine({ notes, keys: BeatmapParser.keyCount(bm), windows: timingWindows({ od: bm.od, mods }), mods, hp: bm.hp });
}

test('parser reads mania objects, columns and LNs', () => {
  const bm = BeatmapParser.parse(osu([note(0, 1000), note(3, 1500), ln(1, 2000, 2600)]));
  const notes = BeatmapParser.toManiaNotes(bm);
  assert.equal(notes.length, 3);
  assert.deepEqual(Array.from(notes.map(n => n.col)), [0, 3, 1]);
  assert.equal(notes[2].isLN, true); assert.equal(notes[2].end, 2600);
  assert.equal(bm.events.background.file, 'bg.jpg');
  const a = BeatmapParser.analyse(bm);
  assert.equal(a.keys, 4); assert.equal(a.lnCount, 1); assert.equal(Math.round(a.bpm), 120);
});

test('7K and 9K column mapping', () => {
  for (const k of [7, 8, 9]) {
    const objs = Array.from({ length: k }, (_, c) => note(c, 1000 + c * 100, k));
    const bm = BeatmapParser.parse(osu(objs, { keys: k }));
    assert.deepEqual(Array.from(BeatmapParser.toManiaNotes(bm).map(n => n.col)), Array.from({ length: k }, (_, c) => c));
  }
});

test('perfect hits give Marvelous, SS and 1,000,000', () => {
  const e = engineFor(osu([note(0, 1000), note(1, 1250), note(2, 1500), note(3, 1750)]));
  for (const n of e.notes) { e.input(n.col, true, n.time); e.input(n.col, false, n.time + 30); }
  e.advance(5000);
  assert.equal(e.score.counts[J.MARV], 4);
  assert.equal(e.score.score, 1000000);
  assert.equal(e.score.accuracy, 1);
  assert.equal(e.score.maxCombo, 4);
  assert.ok(e.finished);
});

test('timing errors map to judgement windows (OD8)', () => {
  // OD8: 16, 40, 73, 103, 127, 164
  const e = engineFor(osu([note(0, 1000), note(0, 2000), note(0, 3000), note(0, 4000), note(0, 5000), note(0, 6000)]));
  // OD8 (ScoreV2 table): MAX 16.1, 300 40, 200 73, 100 103, 50 127, miss 164
  const errs = [10, -35, 60, -100, 120, 150];
  errs.forEach((er, i) => { e.input(0, true, 1000 * (i + 1) + er); e.input(0, false, 1000 * (i + 1) + er + 20); });
  assert.deepEqual([...e.score.counts], [1, 1, 1, 1, 1, 1]);
});

test('unhit notes are missed after the miss window', () => {
  const e = engineFor(osu([note(0, 1000), note(1, 1000)]));
  e.advance(1100); assert.equal(e.score.counts[J.MISS], 0);
  e.advance(1200); assert.equal(e.score.counts[J.MISS], 2);
  assert.equal(e.score.combo, 0);
});

test('too-early press does nothing', () => {
  const e = engineFor(osu([note(0, 1000)]));
  e.input(0, true, 700); e.input(0, false, 720);
  assert.equal(e.score.judged, 0);
});

test('chords, jacks and streams', () => {
  const objs = [note(0, 1000), note(1, 1000), note(2, 1000), note(0, 1100), note(0, 1200), note(1, 1300), note(2, 1400), note(3, 1500)];
  const e = engineFor(osu(objs));
  const ev = generateAutoInputs(e.notes, 4);
  for (const [t, c, d] of ev) e.input(c, !!d, t);
  e.advance(9999);
  assert.equal(e.score.counts[J.MARV], objs.length);
});

test('long note: hold and release gives two judgements', () => {
  const e = engineFor(osu([ln(0, 1000, 2000)]));
  e.input(0, true, 1005); e.advance(1500); e.input(0, false, 2010);
  assert.equal(e.score.judged, 2); assert.equal(e.score.counts[J.MARV], 2);
});

test('long note: early release breaks combo and tail misses', () => {
  const e = engineFor(osu([note(1, 900), ln(0, 1000, 2000)]));
  e.input(1, true, 900); e.input(1, false, 950);
  e.input(0, true, 1000); e.input(0, false, 1500);
  assert.equal(e.score.combo, 0);
  e.advance(2500);
  assert.equal(e.score.counts[J.MISS], 1);
  assert.equal(e.score.judged, 3);
});

test('long note: let go mid-hold, it can\'t be held again (the tail is missed)', () => {
  const e = engineFor(osu([ln(0, 1000, 2000)]));
  e.input(0, true, 1000); e.input(0, false, 1400); e.input(0, true, 1500); e.input(0, false, 2000);
  e.advance(2400);
  assert.equal(e.score.counts[J.BAD], 0);
  assert.equal(e.score.counts[J.MISS], 1);
});

test('long note: missed head then note right after LN end is still hittable', () => {
  const e = engineFor(osu([ln(0, 1000, 2000), note(0, 2100)]));
  e.advance(2050);
  e.input(0, true, 2100); e.input(0, false, 2120);
  assert.equal(e.score.counts[J.MISS], 2);
  assert.equal(e.score.counts[J.MARV], 1);
});

test('multiple simultaneous long notes', () => {
  const e = engineFor(osu([ln(0, 1000, 2000), ln(1, 1000, 2500), ln(2, 1200, 1800), ln(3, 1500, 3000)]));
  for (const [t, c, d] of generateAutoInputs(e.notes, 4)) e.input(c, !!d, t);
  e.advance(4000);
  assert.equal(e.score.counts[J.MARV], 8);
});

test('deterministic replay reproduces identical results', () => {
  const objs = [];
  for (let i = 0; i < 200; i++) objs.push(note(i % 4, 1000 + i * 90));
  const text = osu(objs);
  const inputs = [];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 200; i++) { const t = 1000 + i * 90 + (rnd() - 0.5) * 200; inputs.push([t, i % 4, 1], [t + 30, i % 4, 0]); }
  inputs.sort((a, b) => a[0] - b[0]);
  const run = () => { const e = engineFor(text); for (const [t, c, d] of inputs) e.input(c, !!d, t); e.advance(1e6); return e.summary(); };
  assert.deepEqual(run(), run());
});

test('Sudden Death fails on miss; No Fail never fails', () => {
  const e = engineFor(osu([note(0, 1000)]), ['SD']); e.advance(2000); assert.ok(e.health.failed);
  const objs = Array.from({ length: 60 }, (_, i) => note(0, 1000 + i * 100));
  const e2 = engineFor(osu(objs), ['NF']); e2.advance(1e6); assert.ok(!e2.health.failed);
  const e3 = engineFor(osu(objs)); e3.advance(1e6); assert.ok(e3.health.failed);
});

test('Mirror mod mirrors columns', () => {
  const bm = BeatmapParser.parse(osu([note(0, 1000), note(3, 1100)]));
  const n = prepareNotes(BeatmapParser.toManiaNotes(bm), 4, ['MR'], 1);
  assert.deepEqual(Array.from(n.map(x => x.col)), [3, 0]);
});

test('BPM changes and SV produce monotonic scroll segments', () => {
  const bm = BeatmapParser.parse(osu([note(0, 1000)], { extraTP: '2000,250,4,1,0,100,1,0\n3000,-50,4,1,0,100,0,0\n' }));
  const segs = BeatmapParser.scrollSegments(bm);
  const at = t => { let s = segs[0]; for (const x of segs) if (x.time <= t) s = x; return s.pos + (t - s.time) * s.vel; };
  assert.ok(at(2500) - at(2000) > at(1500) - at(1000)); // faster after BPM doubles
  assert.equal(segs.find(s => s.time === 3000).vel, 4); // 2x BPM * 2x SV
});

test('star rating grows with density', () => {
  const mk = gap => BeatmapParser.analyse(BeatmapParser.parse(osu(Array.from({ length: 400 }, (_, i) => note(i % 4, 1000 + i * gap))))).stars;
  const slow = mk(250), fast = mk(80), faster = mk(50);
  console.log('stars', { slow, fast, faster });
  assert.ok(slow < fast && fast < faster);
});

test('osu!mania hit windows follow the ScoreV2 table; EZ/HR scale the windows (rules 1 changed OD)', () => {
  const w = timingWindows({ od: 8 });
  assert.equal(Math.round(w[0] * 10) / 10, 16.1);
  assert.deepEqual(Array.from(w.slice(1)), [40, 73, 103, 127, 164]);
  assert.equal(timingWindows({ od: 5 })[0], 22.4 - 3);
  // osu!mania HR divides the windows by 1.4 and EZ multiplies them by 1.4; OD itself is untouched
  const hr = timingWindows({ od: 8, mods: ['HR'] });
  assert.equal(Math.round(hr[1] * 1000) / 1000, Math.round(40 / 1.4 * 1000) / 1000);
  const ez = timingWindows({ od: 8, mods: ['EZ'] });
  assert.equal(Math.round(ez[1] * 1000) / 1000, 56);
  // rules 1 (older replays) changed OD: HR → OD 10, EZ → OD 4
  assert.equal(timingWindows({ od: 8, mods: ['HR'], rules: 1 })[1], 34);
  assert.equal(timingWindows({ od: 8, mods: ['EZ'], rules: 1 })[1], 52);
  const da = timingWindows({ od: 8, mods: ['DA'], odOverride: 0 });
  assert.equal(da[5], 188);
});

test('ScoreV1: a miss costs base score and bonus, recovering slowly', () => {
  const s1 = new ScoreSystem(100); for (let i = 0; i < 100; i++) s1.add(J.MARV);
  assert.equal(s1.score, 1000000);
  const s2 = new ScoreSystem(100); s2.add(J.MISS); for (let i = 0; i < 99; i++) s2.add(J.MARV);
  assert.ok(s2.score < 990000 && s2.score > 900000, String(s2.score));
  const s3 = new ScoreSystem(100, { mods: ['EZ'] }); for (let i = 0; i < 100; i++) s3.add(J.MARV);
  assert.equal(s3.score, 500000);
});

test('accuracy and pp formulas', () => {
  assert.equal(OsuMath.accuracy([10, 0, 0, 0, 0, 0]), 1);
  assert.equal(Math.round(OsuMath.accuracy([0, 10, 0, 0, 0, 0]) * 1e4) / 1e4, Math.round(300 / 305 * 1e4) / 1e4);
  // 5* SS with 1500 hits: 8 * 4.85^2.2 * 1 * 1.1
  const pp = OsuMath.pp(5, [1500, 0, 0, 0, 0, 0], []);
  assert.equal(Math.round(pp * 100) / 100, Math.round(8 * Math.pow(4.85, 2.2) * 1.1 * 100) / 100);
  assert.equal(OsuMath.pp(5, [0, 0, 0, 0, 0, 10], []), 0);
  assert.ok(OsuMath.pp(5, [1000, 0, 0, 0, 0, 0], ['NF']) < OsuMath.pp(5, [1000, 0, 0, 0, 0, 0], []));
  const t = OsuMath.totalPp([100, 100]);
  assert.equal(Math.round(t.weighted), 195);
  assert.equal(OsuMath.totalPp([123.4]).total, 123.4, 'one play: the total is exactly its pp');
  assert.equal(Math.round(t.total), 195);
});

test('grades use osu!mania thresholds (SS needs no 200/100/50/miss)', () => {
  assert.equal(OsuMath.grade(0.99, [10, 5, 0, 0, 0, 0]), 'SS');
  assert.equal(OsuMath.grade(0.99, [10, 5, 1, 0, 0, 0]), 'S');
  assert.equal(OsuMath.grade(0.95, [10, 5, 1, 0, 0, 0]), 'S', 'osu!lazer: 95% and up is S');
  assert.equal(OsuMath.grade(0.9499, [10, 5, 1, 0, 0, 0]), 'A');
  assert.equal(OsuMath.grade(0.9, [10, 5, 1, 0, 0, 0]), 'A');
  assert.equal(OsuMath.grade(0.7, [10, 5, 1, 0, 0, 0]), 'C');
  assert.equal(OsuMath.grade(0.5, [1, 0, 0, 0, 0, 1], true), 'F');
});

test('long note held far past its end is missed (osu!mania)', () => {
  const e = engineFor(osu([ln(0, 1000, 2000)]));
  e.input(0, true, 1000); e.advance(3000);
  assert.equal(e.score.counts[J.MISS], 1);
});

test('health multiplier is finite and misses hurt more than holds', () => {
  const e = engineFor(osu(Array.from({ length: 50 }, (_, i) => note(i % 4, 1000 + i * 150))));
  assert.ok(isFinite(e.health.mult) && e.health.mult >= 1);
  e.advance(1200);
  assert.ok(e.health.value < 1);
});

// ── scroll velocity (SV) — green lines multiply the scroll speed, red lines reset it and scale it by BPM
function svMap(tps) {
  return osu([note(0, 1000), note(1, 9000)]).replace('[TimingPoints]\n0,500,4,1,0,100,1,0', '[TimingPoints]\n' + tps.join('\n'));
}
const velAt = (segs, t) => { let v = segs[0].vel; for (const s of segs) if (s.time <= t) v = s.vel; return v; };
const posAt = (segs, t) => { let g = segs[0]; for (const s of segs) if (s.time <= t) g = s; return g.pos + (t - g.time) * g.vel; };

test('SV: green lines change the scroll speed and red lines reset it', () => {
  const bm = BeatmapParser.parse(svMap(['0,500,4,1,0,100,1,0', '2000,-50,4,1,0,100,0,0', '4000,-200,4,1,0,100,0,0', '6000,500,4,1,0,100,1,0']));
  const segs = BeatmapParser.scrollSegments(bm);
  assert.equal(velAt(segs, 1000), 1);
  assert.equal(velAt(segs, 3000), 2);
  assert.equal(velAt(segs, 5000), 0.5);
  assert.equal(velAt(segs, 7000), 1, 'a red line resets SV');
  // integrated distance: 2000 @1 + 2000 @2 + 2000 @0.5
  assert.equal(posAt(segs, 6000) - posAt(segs, 0), 2000 + 4000 + 1000);
  const constant = BeatmapParser.scrollSegments(bm, { useSV: false, useBPM: false });
  assert.equal(velAt(constant, 3000), 1);
});

test('SV: real-map quirks (old format, same-time red + green in either order, spaces, malformed flags)', () => {
  // old format (no uninherited field): negative beat length = green line
  let segs = BeatmapParser.scrollSegments(BeatmapParser.parse(svMap(['0,500,4,1,0,100', '2000,-25,4,1,0,100'])));
  assert.equal(velAt(segs, 3000), 4);
  // green written before the red at the same time still applies
  segs = BeatmapParser.scrollSegments(BeatmapParser.parse(svMap(['0,500,4,1,0,100,1,0', '2000,-50,4,1,0,100,0,0', '2000,500,4,1,0,100,1,0'])));
  assert.equal(velAt(segs, 3000), 2);
  // spaces around values
  segs = BeatmapParser.scrollSegments(BeatmapParser.parse(svMap(['0, 500, 4, 1, 0, 100, 1, 0', '2000 , -50 , 4 , 1 , 0 , 100 , 0 , 0'])));
  assert.equal(velAt(segs, 3000), 2);
  // negative beat length flagged as uninherited: still an SV change (osu! treats negative beat lengths as SV)
  segs = BeatmapParser.scrollSegments(BeatmapParser.parse(svMap(['0,500,4,1,0,100,1,0', '2000,-50,4,1,0,100,1,0'])));
  assert.equal(velAt(segs, 3000), 2);
  assert.equal(BeatmapParser.timing(BeatmapParser.parse(svMap(['0,500,4,1,0,100,1,0', '2000,-50,4,1,0,100,1,0']))).red.length, 1);
});

test('SV: BPM changes scale the scroll relative to the main BPM', () => {
  const bm = BeatmapParser.parse(svMap(['0,500,4,1,0,100,1,0', '6000,250,4,1,0,100,1,0', '6000,-200,4,1,0,100,0,0']));
  const segs = BeatmapParser.scrollSegments(bm);
  assert.equal(velAt(segs, 7000), 2 * 0.5, 'double BPM × half SV');
  assert.equal(velAt(BeatmapParser.scrollSegments(bm, { useSV: true, useBPM: false }), 7000), 0.5);
});

test('SV/BPM follow Web-Osu-Mania: main BPM from the playable part only, no speed caps', () => {
  // a 250ms-beat intro before the first note must not become the "main" BPM
  const bm = BeatmapParser.parse(osu([note(0, 20000), note(1, 30000)]).replace('[TimingPoints]\n0,500,4,1,0,100,1,0',
    '[TimingPoints]\n0,250,4,1,0,100,1,0\n19000,500,4,1,0,100,1,0\n25000,-5,4,1,0,100,0,0\n26000,500,4,1,0,100,1,0'));
  assert.equal(BeatmapParser.mostCommonBeatLength(bm), 500);
  const segs = BeatmapParser.scrollSegments(bm);
  assert.equal(velAt(segs, 21000), 1);
  assert.equal(velAt(segs, 25500), 20, 'SV 20× is not capped (teleport)');
  assert.equal(velAt(segs, 1000), 2, 'the intro still scrolls at its own BPM');
});

// ── osu!lazer judging rules (rules 2) — each case mirrors a line of the osu!lazer source ──
function engineRules(text, { mods = [], rules = 2, rate = 1 } = {}) {
  const bm = BeatmapParser.parse(text);
  const keys = BeatmapParser.keyCount(bm);
  const notes = prepareNotes(BeatmapParser.toManiaNotes(bm), keys, mods, 1);
  return new GameplayEngine({ notes, keys, windows: timingWindows({ od: bm.od, mods, rules }), mods, hp: bm.hp, rules, rate });
}

test('lazer windows: floor(window × rate) + 0.5, in song time', () => {
  const e = engineRules(osu([note(0, 1000)]));
  assert.deepEqual(Array.from(e.W), [16.5, 40.5, 73.5, 103.5, 127.5, 164.5]);
  const dt = engineRules(osu([note(0, 1000)]), { rate: 1.5 });
  assert.deepEqual(Array.from(dt.W), [24.5, 60.5, 109.5, 154.5, 190.5, 246.5]); // floor(16.1×1.5)=24, 60, floor(109.5)=109…
  // an error of 40.3 ms is a 300 under lazer (≤ 40.5); rules 1 made it a 200
  const a = engineRules(osu([note(0, 1000)])); a.input(0, true, 1040.3);
  assert.equal(a.score.counts[J.PERF], 1);
  const b = engineRules(osu([note(0, 1000)]), { rules: 1 }); b.input(0, true, 1040.3);
  assert.equal(b.score.counts[J.GREAT], 1);
});

test('lazer: a late note is missed once it is past the 50 window (not the miss window)', () => {
  const e = engineRules(osu([note(0, 1000)]));
  e.advance(1127); assert.equal(e.score.judged, 0);
  e.advance(1128); assert.equal(e.score.counts[J.MISS], 1);
  assert.equal(e.judgementLog[0].t, 1127.5);
  // rules 1 waited for the miss window, and a press in between was a miss
  const l = engineRules(osu([note(0, 1000)]), { rules: 1 });
  l.advance(1150); assert.equal(l.score.judged, 0);
  l.input(0, true, 1150); assert.equal(l.score.counts[J.MISS], 1);
});

test('lazer: pressing early inside the miss window is a miss; earlier does nothing', () => {
  const e = engineRules(osu([note(0, 1000), note(1, 2000)]));
  e.input(0, true, 1000 - 150); e.input(0, false, 1000 - 140);
  assert.equal(e.score.counts[J.MISS], 1, '−150 ms is past the 50 window (127.5) but inside miss (164.5)');
  e.input(1, true, 2000 - 170);
  assert.equal(e.score.judged, 1, '−170 ms is outside the miss window: nothing');
});

test('lazer note lock: once the next note in a column starts, the earlier one is missed and the press hits the next', () => {
  const e = engineRules(osu([note(0, 1000), note(0, 1100)]));
  e.input(0, true, 1105); e.input(0, false, 1130);
  assert.equal(e.score.counts[J.MISS], 1);
  assert.equal(e.score.counts[J.MARV], 1);
  assert.equal(e.judgementLog[0].t, 1105);
  // before the next note's time the earlier note still takes the press
  const f = engineRules(osu([note(0, 1000), note(0, 1100)]));
  f.input(0, true, 1095);
  assert.equal(f.score.counts[J.GOOD], 1, '+95 ms on the first note is a 100');
  // rules 1: the press hit the first note late (a 50) and the second one stayed
  const l = engineRules(osu([note(0, 1000), note(0, 1100)]), { rules: 1 });
  l.input(0, true, 1105);
  assert.equal(l.score.counts[J.BAD], 1); assert.equal(l.score.judged, 1);
});

test('lazer: misses from several columns are judged in time order', () => {
  const e = engineRules(osu([note(0, 1000), note(1, 990), note(2, 1010)]));
  e.advance(2000);
  assert.deepEqual(Array.from(e.judgementLog, x => x.col), [1, 0, 2]);
});

test('lazer hold: an early-miss head still starts the hold, and the tail is capped at 50', () => {
  const e = engineRules(osu([ln(0, 1000, 2000)]));
  e.input(0, true, 850); // −150: head miss
  assert.equal(e.score.counts[J.MISS], 1);
  e.input(0, false, 2000);
  assert.equal(e.score.counts[J.BAD], 1);
  assert.ok(e.finished);
});

test('lazer hold: held past the end, the tail is missed at 1.5 × the 50 window', () => {
  const e = engineRules(osu([ln(0, 1000, 2000)]));
  e.input(0, true, 1000);
  e.advance(2191); assert.equal(e.score.judged, 1, 'still releasable at +191 ms (1.5 × 127.5 = 191.25)');
  e.advance(2192); assert.equal(e.score.counts[J.MISS], 1);
  // a release at +191 is a 50
  const f = engineRules(osu([ln(0, 1000, 2000)]));
  f.input(0, true, 1000); f.input(0, false, 2191);
  assert.equal(f.score.counts[J.BAD], 1);
});

test('lazer hold: let go and never held again, the tail is missed after its window (not at the end)', () => {
  const e = engineRules(osu([ln(0, 1000, 2000)]));
  e.input(0, true, 1000); e.input(0, false, 1400);
  e.advance(2100); assert.equal(e.score.counts[J.MISS], 0);
  e.advance(2192); assert.equal(e.score.counts[J.MISS], 1);
});

test('lazer hold: once let go mid-hold it can\'t be held again; combo breaks once and the tail is missed', () => {
  const e = engineRules(osu([note(1, 900), ln(0, 1000, 3000), note(1, 1500), note(1, 2500)]));
  e.input(1, true, 900); e.input(1, false, 920);
  e.input(0, true, 1000);
  e.input(0, false, 1200);                 // early release: combo breaks
  assert.equal(e.score.combo, 0);
  e.input(1, true, 1500); e.input(1, false, 1520);
  e.input(0, true, 1600); e.input(0, false, 1700); // pressing again does nothing: no second combo break
  assert.equal(e.score.combo, 1);
  e.input(0, true, 3100); e.input(0, false, 3110);
  assert.equal(e.score.counts[J.BAD], 0, 'no tail judgement from pressing again');
  e.advance(3200); assert.equal(e.score.counts[J.MISS], 2, 'the hold\'s tail, and the note at 2500 nobody pressed');
});

test('lazer hold: a tail released inside the miss part of its window stays a miss when capped', () => {
  const e = engineRules(osu([ln(0, 1000, 3000)]));
  e.input(0, true, 1000); e.input(0, false, 1200); e.input(0, true, 1300);
  e.input(0, false, 3000 - 220); // −220: past 1.5 × 50 (191.25), inside 1.5 × miss (246.75)
  e.advance(3300);
  assert.equal(e.score.counts[J.MISS], 1);
  assert.equal(e.score.counts[J.BAD], 0);
});

test('lazer: missing either end of a hold costs half a note of health', () => {
  const miss = (objs, t) => { const e = engineRules(osu(objs)); e.advance(t); return 1 - e.health.value; };
  const tapLoss = miss([note(0, 1000)], 1200);
  const headLoss = miss([ln(0, 1000, 5000)], 1200);
  assert.ok(Math.abs(headLoss - tapLoss / 2) < 1e-9, `${headLoss} vs ${tapLoss}`);
});

test('lazer: Sudden Death and Perfect fail when a hold is let go early', () => {
  const sd = engineRules(osu([ln(0, 1000, 2000)]), { mods: ['SD'] });
  sd.input(0, true, 1000); sd.input(0, false, 1300); assert.ok(sd.health.failed);
  const pf = engineRules(osu([ln(0, 1000, 2000)]), { mods: ['PF'] });
  pf.input(0, true, 1000); pf.input(0, false, 1300); assert.ok(pf.health.failed);
  const pf1 = engineRules(osu([ln(0, 1000, 2000)]), { mods: ['PF'], rules: 1 });
  pf1.input(0, true, 1000); pf1.input(0, false, 1300); assert.ok(!pf1.health.failed);
});

test('lazer: autoplay still scores a perfect play on chords, jacks and long notes', () => {
  const objs = [note(0, 1000), note(1, 1000), note(0, 1080), note(0, 1160), ln(2, 1000, 1500), ln(3, 1200, 1300), note(3, 1400), ln(1, 1300, 2000)];
  const e = engineRules(osu(objs));
  for (const [t, c, d] of generateAutoInputs(e.notes, 4)) e.input(c, !!d, t);
  e.advance(9999);
  assert.equal(e.score.counts[J.MARV], e.totalJudgements);
  assert.equal(e.score.score, 1000000);
});

test('main BPM ignores BPM lines after the last note', () => {
  const bm = BeatmapParser.parse(osu([note(0, 1000), note(1, 5000)]).replace('[TimingPoints]\n0,500,4,1,0,100,1,0',
    '[TimingPoints]\n0,500,4,1,0,100,1,0\n2000,400,4,1,0,100,1,0\n9000,500,4,1,0,100,1,0'));
  // 1000–2000 at 500 (1s) vs 2000–5000 at 400 (3s): 400 is the main beat; the 500 line after the last note used
  // to subtract its (negative) duration and could never matter
  assert.equal(BeatmapParser.mostCommonBeatLength(bm), 400);
});

test('osu!lazer standardised score: 1,000,000 for all MAX, accuracy^(2+2acc), log4 combo curve, mod multiplier', () => {
  const f = c => Math.min(Math.max(0.5, Math.log(c) / Math.log(4)), Math.log(400) / Math.log(4));
  const play = (n, js, opts) => { const s = new ScoreSystem(n, opts); js.forEach(j => s.add(j)); return s; };
  assert.equal(play(100, Array(100).fill(J.MARV)).scoreStd, 1000000);
  const acc = 300 / 305;
  assert.equal(play(100, Array(100).fill(J.PERF)).scoreStd, Math.round(150000 + 850000 * acc ** (2 + 2 * acc)));
  // a miss halfway restarts the combo curve and costs accuracy
  const miss = play(100, Array.from({ length: 100 }, (_, i) => i === 50 ? J.MISS : J.MARV));
  let max = 0, got = 0;
  for (let k = 1; k <= 100; k++) max += 300 * f(k);
  for (let k = 1; k <= 50; k++) got += 300 * f(k);
  for (let k = 1; k <= 49; k++) got += 300 * f(k);
  const a2 = 99 / 100;
  assert.equal(miss.scoreStd, Math.round(150000 * got / max + 850000 * a2 ** (2 + 2 * a2)));
  // mid-play: both parts grow with progress
  const half = play(100, Array(50).fill(J.MARV));
  let hc = 0; for (let k = 1; k <= 50; k++) hc += 300 * f(k);
  assert.equal(half.scoreStd, Math.round(150000 * hc / max + 850000 * 0.5));
  // No Fail halves it; classic score is unchanged by all this
  assert.equal(play(10, Array(10).fill(J.MARV), { mods: ['NF'] }).scoreStd, 500000);
  assert.equal(play(100, Array(100).fill(J.MARV)).score, 1000000);
});

test('the engine summary carries both scores', () => {
  const eng = engineFor(osu([note(0, 1000), note(1, 1500), ln(2, 2000, 2600)]));
  for (const [t, c, d] of generateAutoInputs(eng.notes, 4).flat().reduce((a, x, i, arr) => (i % 3 ? a : a.concat([[arr[i], arr[i + 1], arr[i + 2]]])), [])) eng.input(c, d === 1, t);
  eng.advance(10000);
  const s = eng.summary();
  assert.equal(s.score, 1000000);
  assert.equal(s.scoreStd, 1000000);
});

test('No Release (osu!lazer): a hold still held at its end is a MAX with no release timing; broken holds get a 50', () => {
  const e = engineRules(osu([ln(0, 1000, 2000)]), { mods: ['NR'] });
  e.input(0, true, 1000);
  e.advance(2000); assert.equal(e.score.judged, 1, 'not before the end');
  e.advance(2001); assert.equal(e.score.counts[J.MARV], 2, 'head + tail MAX once the end is reached');
  e.input(0, false, 2600); // letting go long after changes nothing
  assert.equal(e.score.judged, 2); assert.equal(e.score.counts[J.MISS], 0);
  // without NR, the same hold held that long is a missed tail
  const f = engineRules(osu([ln(0, 1000, 2000)]));
  f.input(0, true, 1000); f.advance(2600);
  assert.equal(f.score.counts[J.MISS], 1);
  // let go early: pressing again doesn't take it back, the tail is missed
  const g = engineRules(osu([ln(0, 1000, 2000)]), { mods: ['NR'] });
  g.input(0, true, 1000); g.input(0, false, 1400); g.input(0, true, 1500); g.advance(2400);
  assert.equal(g.score.counts[J.BAD], 0); assert.equal(g.score.counts[J.MISS], 1);
  // releasing inside the tail window before the end is judged as usual
  const h = engineRules(osu([ln(0, 1000, 2000)]), { mods: ['NR'] });
  h.input(0, true, 1000); h.input(0, false, 1950);
  assert.equal(h.score.counts[J.PERF] + h.score.counts[J.MARV] + h.score.counts[J.GREAT], 2);
});

test('Invert (osu!lazer): gaps become holds shortened by a quarter beat (at most by half), last note dropped', () => {
  // 120 BPM (500 ms beats): notes in column 0 at 1000, 2000, 2200, 3000
  const text = osu([note(0, 1000), note(0, 2000), note(0, 2200), ln(0, 3000, 3400), note(1, 1500)]);
  const bm = BeatmapParser.parse(text);
  const red = BeatmapParser.timing(bm).red;
  const n = prepareNotes(BeatmapParser.toManiaNotes(bm), 4, ['IN'], 1, { red });
  const c0 = n.filter(x => x.col === 0);
  assert.equal(JSON.stringify(c0.map(x => [x.time, x.end, x.isLN])), JSON.stringify([[1000, 1875, true], [2000, 2100, true], [2200, 2875, true]]));
  assert.equal(n.filter(x => x.col === 1).length, 0, 'a column with one note has nothing to hold to');
  // Auto still plays it perfectly
  const eng = new GameplayEngine({ notes: n, keys: 4, windows: timingWindows({ od: 8 }), mods: ['IN'] });
  for (const [t, c, d] of generateAutoInputs(eng.notes, 4)) eng.input(c, d === 1, t);
  eng.advance(1e9);
  assert.equal(eng.summary().score, 1000000);
});

test('parser reads the epilepsy warning flag (lazer\'s player loader disclaimer)', () => {
  const text = osu([note(0, 1000)]);
  assert.equal(BeatmapParser.parse(text).epilepsyWarning, false);
  assert.equal(BeatmapParser.parse(text.replace('[General]', '[General]\nEpilepsyWarning: 1')).epilepsyWarning, true);
});

test('score verification: the server judges a play from its key presses — not from what the player says it scored', () => {
  const V = load(['00-util.js', '03-beatmap-parser.js', '08-mods.js', '09-gameplay.js', '09a-osu-math.js', '09c-verify.js']);
  const text = osu([note(0, 1000), note(1, 1500), ln(2, 2000, 2600), note(3, 3000)]);
  const bm = V.BeatmapParser.parse(text), keys = V.BeatmapParser.keyCount(bm);
  const notes = V.prepareNotes(V.BeatmapParser.toManiaNotes(bm), keys, [], 1);
  const events = V.generateAutoInputs(notes, keys).flat();
  // a perfect play
  const r = V.verifyPlay(text, { mods: [], seed: 1, events });
  assert.ok(!r.error, r.error);
  assert.deepEqual([r.counts[5], r.maxCombo, r.grade, Math.round(r.accuracy * 100)], [0, 5, 'SS', 100]);
  assert.ok(r.score >= 999000 && r.pp > 0 && r.stars > 0);
  // half the notes never pressed: the misses are counted, whatever a client might claim
  const partial = V.verifyPlay(text, { mods: ['NF'], seed: 1, events: events.slice(0, 6) });
  assert.ok(!partial.error, partial.error); assert.ok(partial.counts[5] >= 2 && partial.score < r.score);
  // cheats: Auto, impossible input, out-of-order input
  assert.equal(V.verifyPlay(text, { mods: ['AT'], seed: 1, events }).error, 'unranked mods');
  assert.equal(V.verifyPlay(text, { mods: [], seed: 1, events: [1000, 0, 1, 1000.5, 0, 0] }).error, 'impossible input');
  assert.equal(V.verifyPlay(text, { mods: [], seed: 1, events: [1000, 0, 1, 900, 0, 0] }).error, 'input out of order');
  assert.equal(V.verifyPlay(text, { mods: [], seed: 1, events: [1000, 0, 1, 1000, 0, 1] }).error, 'impossible input');
});

test('bar lines: one per bar from each timing point, every fourth major, "omit first bar line" honoured', () => {
  const red = [{ time: 0, beatLength: 500, meter: 4 }, { time: 8000, beatLength: 250, meter: 3, effects: 8 }];
  const bars = BeatmapParser.barLines(red, 10000);
  // 2000ms bars up to the second point (0…6000), then 750ms bars starting one bar late (8750, 9500)
  assert.deepEqual([...bars.map(b => b.time)], [0, 2000, 4000, 6000, 8750, 9500]);
  assert.deepEqual([...bars.map(b => b.major)], [true, false, false, false, false, false]);
  assert.equal(BeatmapParser.barLines([{ time: 0, beatLength: 0, meter: 4 }], 5000).length, 0);
});
