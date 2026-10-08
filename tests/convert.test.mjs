import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from './load.mjs';
const M = load(['00-util.js', '03-beatmap-parser.js', '03b-mania-convert.js', '09a-osu-math.js']);
const { BeatmapParser, ManiaConvert } = M;
const fx = n => new URL(`./fixtures/lazer-convert/${n}`, import.meta.url);

// osu!lazer's own conversion tests (ManiaBeatmapConversionTest): every note's start, end and column, within 2ms
for (const name of ['basic', 'zero-length-slider', '20544', '100374', '1450162', 'mania-specific-spinner', '4869637', '1K', '4K', '7K', '8K', '10K', '18K']) {
  test(`lazer conversion test "${name}" gives lazer's notes`, () => {
    const bm = BeatmapParser.parse(readFileSync(fx(`${name}.osu`), 'utf8'));
    const want = JSON.parse(readFileSync(fx(`${name}.json`), 'utf8'));
    const got = (bm.mode === 0 ? ManiaConvert.convert(bm).notes : BeatmapParser.toManiaNotes(bm))
      .map(n => [n.time, n.end, n.col]).sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    assert.equal(got.length, want.length);
    got.forEach((g, i) => {
      const w = want[i];
      assert.ok(Math.abs(g[0] - w[0]) <= 2 && Math.abs(g[1] - w[1]) <= 2 && g[2] === w[2], `note ${i}: want ${w} got ${g}`);
    });
  });
}

const std = (objects, { cs = 4, od = 5, hp = 5, ar = '', version = 14 } = {}) => BeatmapParser.parse(`osu file format v${version}

[General]
AudioFilename: audio.mp3
Mode: 0

[Difficulty]
HPDrainRate:${hp}
CircleSize:${cs}
OverallDifficulty:${od}
${ar === '' ? '' : `ApproachRate:${ar}\n`}SliderMultiplier:1.4

[Events]
2,5000,6000

[TimingPoints]
0,500,4,2,0,70,1,0
2000,-50,4,2,0,70,0,0

[HitObjects]
${objects.join('\n')}
`);

test('a convert\'s column count follows lazer (how many objects are sliders or spinners, and its accuracy)', () => {
  const circles = Array.from({ length: 20 }, (_, i) => `${i * 25},192,${1000 + i * 100},1,0,0:0:0:0:`);
  const sliders = Array.from({ length: 20 }, (_, i) => `${i * 25},192,${1000 + i * 300},2,0,B|${i * 25 + 50}:192,1,70`);
  assert.equal(BeatmapParser.keyCount(std(circles)), 7); // under 20% sliders
  assert.equal(BeatmapParser.keyCount(std([...circles.slice(0, 15), ...sliders.slice(0, 5)], { od: 5 })), 6); // 25%, OD 5
  assert.equal(BeatmapParser.keyCount(std([...circles.slice(0, 15), ...sliders.slice(0, 5)], { od: 8 })), 7);
  assert.equal(BeatmapParser.keyCount(std(sliders, { od: 4 })), 4); // over 60%, OD 4
  assert.equal(BeatmapParser.keyCount(std(sliders, { od: 6 })), 5);
  assert.equal(BeatmapParser.keyCount(std([...circles.slice(0, 10), ...sliders.slice(0, 10)], { od: 2 })), 4); // 50%: OD + 1, at least 4
});

test('a convert is the same notes every time, scrolls by BPM only, and is played like any mania map', () => {
  const objs = Array.from({ length: 40 }, (_, i) => i % 5 ? `${(i * 97) % 512},${(i * 53) % 384},${1000 + i * 150},1,${i % 3 ? 0 : 8},0:0:0:0:` : `${(i * 41) % 512},100,${1000 + i * 150},2,4,B|300:300,2,120`);
  const a = BeatmapParser.toManiaNotes(std(objs)), b = BeatmapParser.toManiaNotes(std(objs));
  assert.deepEqual(a, b);
  assert.ok(a.length >= 40 && a.some(n => n.isLN));
  const keys = BeatmapParser.keyCount(std(objs));
  assert.ok(a.every(n => n.col >= 0 && n.col < keys));
  // (osu! difficulty settings change the seed, so the pattern)
  assert.notDeepEqual(BeatmapParser.toManiaNotes(std(objs, { hp: 7 })).map(n => n.col), a.map(n => n.col));
  // the green line at 2000ms is a slider speed: it doesn't change a convert's scrolling
  assert.ok(BeatmapParser.scrollSegments(std(objs)).every(s => s.vel === 1));
  const st = BeatmapParser.analyse(std(objs));
  assert.equal(st.keys, keys);
  assert.ok(st.stars > 0);
  assert.equal(M.validateBeatmap(std(objs)).problems.length, 0);
});

test('osu!taiko and osu!catch difficulties still can\'t be played', () => {
  const bm = std(['256,192,1000,1,0,0:0:0:0:']);
  for (const mode of [1, 2]) {
    bm.mode = mode;
    assert.match(M.validateBeatmap(bm).problems.join(), /Not an osu!mania or osu! difficulty/);
    assert.throws(() => BeatmapParser.toManiaNotes(bm));
  }
});

test('files older than format v5 are moved 24ms later, as osu! does', () => {
  const old = std(['256,192,1000,1,0,0:0:0:0:', '256,192,2000,12,0,3000,0:0:0:0:'], { version: 4 });
  // (vm arrays: compared as JSON)
  assert.equal(JSON.stringify(old.hitObjects.map(h => [h.time, h.endTime])), '[[1024,0],[2024,3024]]');
  assert.equal(JSON.stringify(old.timingPoints.map(t => t.time)), '[24,2024]');
  assert.equal(JSON.stringify(old.events.breaks), '[{"start":5024,"end":6024}]');
  assert.equal(std(['256,192,1000,1,0,0:0:0:0:']).hitObjects[0].time, 1000);
});
