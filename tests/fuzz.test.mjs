// Corrupted beatmaps: mutated .osu files must parse into something Auto plays perfectly, or be rejected with a
// BeatmapError — never crash (TypeError / RangeError), hang, or produce NaN anywhere from parsing to scoring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const M = load(['00-util.js', '03-beatmap-parser.js', '03b-mania-convert.js', '08-mods.js', '09-gameplay.js', '09a-osu-math.js', '10-renderer.js']);
const { BeatmapParser, BeatmapError, GameplayEngine, timingWindows, generateAutoInputs, prepareNotes, DifficultyCalculator, ScrollMap } = M;

let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = a => a[Math.floor(rnd() * a.length)];
const base = () => {
  const keys = pick([1, 4, 7, 10, 18]);
  const tp = ['0,500,4,1,0,100,1,0', '1000,-50,4,1,0,100,0,0', '2000,-200,4,1,0,100,0,0', '3000,300,4,1,0,100,1,0'];
  const ho = [];
  for (let i = 0; i < 60; i++) { const col = Math.floor(rnd() * keys), x = Math.floor((col + 0.5) * 512 / keys), t = 500 + i * 120; ho.push(rnd() < 0.3 ? `${x},192,${t},128,0,${t + 300}:0:0:0:0:` : `${x},192,${t},1,0,0:0:0:0:`); }
  return `osu file format v14\n\n[General]\nAudioFilename: a.mp3\nAudioLeadIn: 0\nPreviewTime: 1000\nMode: 3\n\n[Metadata]\nTitle:T\nArtist:A\nCreator:C\nVersion:V\nBeatmapSetID:1\n\n[Difficulty]\nHPDrainRate:5\nCircleSize:${keys}\nOverallDifficulty:8\nApproachRate:5\nSliderMultiplier:1.4\n\n[Events]\n0,0,"bg.jpg",0,0\n2,1000,5000\n\n[TimingPoints]\n${tp.join('\n')}\n\n[HitObjects]\n${ho.join('\n')}\n`;
};
const junk = ['', '-', 'NaN', 'Infinity', '-1e309', '1e309', '999999999999', '-5', '0', ',', ':', '|', '[', ']', 'abc', '\u0000', '٣', '1.5.5', ' ', '-0'];
const mutate = text => {
  let lines = text.split('\n');
  const n = 1 + Math.floor(rnd() * 6);
  for (let k = 0; k < n; k++) {
    const i = Math.floor(rnd() * lines.length), r = rnd();
    if (r < 0.25) { const parts = lines[i].split(/([,:|])/); const j = Math.floor(rnd() * parts.length); parts[j] = pick(junk); lines[i] = parts.join(''); }
    else if (r < 0.4) lines.splice(i, 1);
    else if (r < 0.5) lines.splice(i, 0, lines[Math.floor(rnd() * lines.length)]);
    else if (r < 0.6) lines[i] = lines[i].slice(0, Math.floor(rnd() * lines[i].length));
    else if (r < 0.7) lines[i] = lines[i].replace(/\d+/, () => pick(junk));
    else if (r < 0.8) lines = lines.slice(0, i);
    else if (r < 0.9) lines[i] = pick(['[HitObjects]', '[TimingPoints]', '[Difficulty]', 'CircleSize:' + pick(junk), 'OverallDifficulty:' + pick(junk), 'HPDrainRate:' + pick(junk), 'Mode:' + pick(['0', '1', '3', 'x'])]);
    else lines[i] = lines[i] + pick(junk);
  }
  return lines.join('\n');
};

function run(text) {
  const bm = BeatmapParser.parse(text);
  const keys = BeatmapParser.keyCount(bm);
  const raw = BeatmapParser.toManiaNotes(bm);
  BeatmapParser.analyse(bm);
  const sm = new ScrollMap(BeatmapParser.scrollSegments(bm, { useSV: true, useBPM: true }));
  for (let t = -1000; t < 12000; t += 997) assert.ok(Number.isFinite(sm.pos(t)), 'scroll position');
  BeatmapParser.timing(bm);
  const notes = prepareNotes(raw, keys, [], 1);
  assert.ok(Number.isFinite(DifficultyCalculator.calculate(notes, keys, 1)), 'star rating');
  const windows = timingWindows({ od: bm.od });
  assert.ok(windows.every(w => Number.isFinite(w) && w > 0), 'hit windows');
  const eng = new GameplayEngine({ notes, keys, windows, hp: bm.hp });
  for (const [t, c, d] of generateAutoInputs(eng.notes, keys)) eng.input(c, d === 1, t);
  eng.advance(1e9);
  const s = eng.summary();
  if (notes.length) assert.equal(s.score, 1000000, 'Auto plays it perfectly');
  assert.ok(Number.isFinite(s.scoreStd) && Number.isFinite(s.accuracy));
}

test('corrupted .osu files never crash the game (1,500 mutations)', () => {
  let parsed = 0, rejected = 0;
  for (let it = 0; it < 1500; it++) {
    const text = it % 10 === 0 ? base() : mutate(base());
    try { run(text); parsed++; }
    catch (e) {
      if (e instanceof BeatmapError) { rejected++; continue; }
      assert.fail(`case ${it}: ${e.stack}\n--- beatmap ---\n${text}`);
    }
  }
  assert.ok(parsed > 1000 && rejected > 0, `${parsed} parsed, ${rejected} rejected`);
});

test('broken difficulty values: OD/HP clamped to 0–10, garbage falls back to 5, garbage key count is rejected', () => {
  const b = base();
  assert.equal(BeatmapParser.parse(b.replace(/OverallDifficulty:8/, 'OverallDifficulty:81.5')).od, 10);
  assert.equal(BeatmapParser.parse(b.replace(/OverallDifficulty:8/, 'OverallDifficulty:abc')).od, 5);
  assert.equal(BeatmapParser.parse(b.replace(/HPDrainRate:5/, 'HPDrainRate:-3')).hp, 0);
  assert.throws(() => BeatmapParser.keyCount(BeatmapParser.parse(b.replace(/CircleSize:\d+/, 'CircleSize:x'))), BeatmapError);
  // objects hours past anything real are dropped, not turned into a days-long map
  const far = b.replace('[HitObjects]\n', '[HitObjects]\n256,192,999999999999,1,0,0:0:0:0:\n');
  const bm = BeatmapParser.parse(far);
  assert.ok(bm.hitObjects.every(o => o.time < 1e7));
});
