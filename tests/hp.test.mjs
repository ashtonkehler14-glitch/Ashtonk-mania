// osu!'s health calibration (the drain a map gets): the fast version gives exactly what the plain one — written as
// osu! writes it — gives, on all kinds of maps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from './load.mjs';

const { OsuMath, J, healthIncrease } = load(['00-util.js', '03-beatmap-parser.js', '03b-mania-convert.js', '08-mods.js', '09-gameplay.js', '09a-osu-math.js']);
// (both run outside the test sandbox, where every global lookup is slow)
const src = readFileSync(new URL('../src/js/09a-osu-math.js', import.meta.url), 'utf8');
const fast = new Function('OsuMath', 'J', 'healthIncrease', src.slice(src.indexOf('function computeHpMultiplier'), src.indexOf('function healthIncrease')) + '; return computeHpMultiplier;')(OsuMath, J, healthIncrease);
const reference = new Function('OsuMath', 'J', 'healthIncrease', `function reference(notes, hp, breaks = [], rawHp = hp) {
  const lowestHpEver = OsuMath.difficultyRange(hp, 0.975, 0.8, 0.3);
  const lowestHpEnd = OsuMath.difficultyRange(hp, 0.99, 0.9, 0.4);
  const hpRecoveryAvailable = OsuMath.difficultyRange(hp, 0.04, 0.02, 0);
  let hpMultiplierNormal = 1;
  if (!notes.length) return 1;
  const heads = notes.slice().sort((a, b) => a.time - b.time);
  const drainStart = heads[0].time;
  const increaseFor = (j, hold) => healthIncrease(j, rawHp, hold, hpMultiplierNormal);
  let testDrop = 0.00025;
  for (let guard = 0; guard < 4000; guard++) {
    let currentHp = 1, currentHpUncapped = 1, lastTime = drainStart, currentBreak = 0, fail = false, count = 0;
    const reduce = amt => { currentHpUncapped = Math.max(0, currentHpUncapped - amt); currentHp = Math.max(0, currentHp - amt); };
    const increase = hold => { const a = increaseFor(J.MARV, hold); currentHpUncapped += a; currentHp = Math.max(0, Math.min(1, currentHp + a)); };
    for (const h of heads) {
      count++;
      while (currentBreak < breaks.length && breaks[currentBreak].end <= h.time) { lastTime = h.time; currentBreak++; }
      reduce(testDrop * (h.time - lastTime));
      lastTime = h.end;
      if (currentHp <= lowestHpEver) { fail = true; testDrop *= 0.96; break; }
      const reduction = testDrop * (h.end - h.time);
      const overkill = Math.max(0, reduction - currentHp);
      reduce(reduction);
      if (h.isLN) { increase(true); increase(true); }
      if (overkill > 0 && currentHp - overkill <= lowestHpEver) { fail = true; testDrop *= 0.96; break; }
      if (!h.isLN) increase(false);
    }
    if (!fail && currentHp < lowestHpEnd) { fail = true; testDrop *= 0.94; hpMultiplierNormal *= 1.01; }
    const recovery = (currentHpUncapped - 1) / Math.max(1, count);
    if (!fail && recovery < hpRecoveryAvailable) { fail = true; testDrop *= 0.96; hpMultiplierNormal *= 1.01; }
    if (!fail && !isFinite(hpMultiplierNormal)) return 1;
    if (!fail) return hpMultiplierNormal;
  }
  return hpMultiplierNormal;
}
return reference;`)(OsuMath, J, healthIncrease);

test('the health calibration gives exactly the plain version\'s multiplier', () => {
  let seed = 7;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 120; k++) {
    const n = 20 + Math.floor(r() * 1500), notes = [], kind = r();
    let t = 500 + r() * 2000;
    for (let i = 0; i < n; i++) {
      t += kind < 0.3 ? 20 + r() * 80 : kind < 0.7 ? 50 + r() * 400 : r() < 0.05 ? 3000 + r() * 8000 : 100 + r() * 900;
      const isLN = r() < (kind < 0.5 ? 0.4 : 0.1);
      notes.push({ time: Math.round(t), end: Math.round(t + (isLN ? 50 + r() * 2000 : 0)), isLN });
    }
    const mid = notes[Math.floor(n / 2)].time, breaks = r() < 0.3 ? [{ start: mid - 4000, end: mid - 100 }] : [];
    const hp = Math.round(r() * 100) / 10, raw = r() < 0.5 ? hp : Math.round(r() * 100) / 10;
    assert.ok(Object.is(fast(notes, hp, breaks, raw), reference(notes, hp, breaks, raw)), `map ${k}`);
  }
  assert.equal(fast([], 5), 1);
});
