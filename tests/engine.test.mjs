import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const M = load(['00-util.js', '03-beatmap-parser.js', '08-mods.js', '09-gameplay.js']);
const { GameplayEngine, BeatmapParser, J, timingWindows, generateAutoInputs, prepareNotes, DifficultyCalculator } = M;

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

test('long note: re-grab after early release caps tail at Bad', () => {
  const e = engineFor(osu([ln(0, 1000, 2000)]));
  e.input(0, true, 1000); e.input(0, false, 1400); e.input(0, true, 1500); e.input(0, false, 2000);
  assert.equal(e.score.counts[J.BAD], 1);
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
  const bl = BeatmapParser.barlines(bm, 4000);
  assert.ok(bl.includes(0) && bl.includes(2000) && bl.includes(3000));
});

test('star rating grows with density', () => {
  const mk = gap => BeatmapParser.analyse(BeatmapParser.parse(osu(Array.from({ length: 400 }, (_, i) => note(i % 4, 1000 + i * gap))))).stars;
  const slow = mk(250), fast = mk(80), faster = mk(50);
  console.log('stars', { slow, fast, faster });
  assert.ok(slow < fast && fast < faster);
});
