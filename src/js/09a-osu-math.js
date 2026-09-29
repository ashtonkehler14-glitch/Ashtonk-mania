/* OsuMath — osu!mania-accurate formulas.
 *
 * Ported from Web-Osu-Mania by Danny Duong (MIT License, Copyright (c) 2024 Danny Duong,
 * https://github.com/hectickiwi/Web-Osu-Mania), which in turn follows the official osu! sources:
 *   - hit windows:  https://osu.ppy.sh/wiki/en/Gameplay/Judgement/osu%21mania#scorev2
 *   - ScoreV1:      https://osu.ppy.sh/wiki/en/Gameplay/Score/ScoreV1/osu%21mania
 *   - accuracy:     https://osu.ppy.sh/wiki/en/Gameplay/Accuracy#osu!mania
 *   - health:       osu.Game/Rulesets/Scoring/LegacyDrainingHealthProcessor.cs, ManiaHealthProcessor.cs
 *   - star rating:  osu.Game.Rulesets.Mania/Difficulty/ManiaDifficultyCalculator.cs (+ Strain.cs, evaluators)
 *   - pp:           osu.Game.Rulesets.Mania/Difficulty/ManiaPerformanceCalculator.cs
 *
 * The MIT permission notice for the ported portions:
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 *   associated documentation files (the "Software"), to deal in the Software without restriction,
 *   including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
 *   and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
 *   subject to the following conditions: The above copyright notice and this permission notice shall be
 *   included in all copies or substantial portions of the Software.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */

const OsuMath = {
  /** OD after EZ / HR (osu! applies these to the difficulty value, not to the windows). */
  odAfterMods(od, mods = [], override = null) {
    if (mods.includes('EZ')) return od / 2;
    if (mods.includes('HR')) return Math.min(od * 1.4, 10);
    if (override != null) return override;
    return od;
  },
  hpAfterMods(hp, mods = [], override = null) {
    if (mods.includes('EZ')) return hp / 2;
    if (mods.includes('HR')) return Math.min(hp * 1.4, 10);
    if (override != null) return override;
    return hp;
  },

  /** osu!mania ScoreV2-table hit windows (ms, real time): [MAX, 300, 200, 100, 50, miss]. */
  hitWindows(od) {
    return [
      od <= 5 ? 22.4 - 0.6 * od : 24.9 - 1.1 * od,
      64 - 3 * od, 97 - 3 * od, 127 - 3 * od, 151 - 3 * od, 188 - 3 * od,
    ];
  },

  /** Displayed accuracy (MAX weighted 305). counts: [MAX,300,200,100,50,miss] */
  accuracy(c) {
    const n = c[0] + c[1] + c[2] + c[3] + c[4] + c[5];
    if (!n) return 1;
    return (305 * c[0] + 300 * c[1] + 200 * c[2] + 100 * c[3] + 50 * c[4]) / (305 * n);
  },
  /** Classic accuracy (MAX == 300). */
  accuracyV1(c) {
    const n = c[0] + c[1] + c[2] + c[3] + c[4] + c[5];
    if (!n) return 1;
    return (300 * (c[0] + c[1]) + 200 * c[2] + 100 * c[3] + 50 * c[4]) / (300 * n);
  },
  /** Accuracy used by pp (MAX weighted 320). */
  ppAccuracy(c) {
    const n = c[0] + c[1] + c[2] + c[3] + c[4] + c[5];
    if (!n) return 1;
    return (320 * c[0] + 300 * c[1] + 200 * c[2] + 100 * c[3] + 50 * c[4]) / (320 * n);
  },

  /** Performance points (ManiaPerformanceCalculator). starRating must already include rate mods. */
  pp(starRating, counts, mods = []) {
    const totalHits = counts.reduce((a, b) => a + b, 0);
    if (!totalHits) return 0;
    const acc = this.ppAccuracy(counts);
    let value = 8 * Math.pow(Math.max(starRating - 0.15, 0.05), 2.2) * Math.max(0, 5 * acc - 4) * (1 + 0.1 * Math.min(1, totalHits / 1500));
    if (mods.includes('NF')) value *= 0.75;
    if (mods.includes('EZ')) value *= 0.5;
    return value;
  },
  /** Profile total pp: best score per map, weighted 0.95^i, plus the play-count bonus osu! adds. */
  totalPp(ppList) {
    const sorted = ppList.filter(p => p > 0).sort((a, b) => b - a);
    let total = 0, w = 1;
    for (const p of sorted) { total += p * w; w *= 0.95; }
    const bonus = 416.6667 * (1 - Math.pow(0.995, Math.min(sorted.length, 1000)));
    return { total: total + bonus, weighted: total, bonus };
  },

  /** Letter grade (osu!lazer ManiaScoreProcessor.RankFromScore): SS = only MAX / 300 hits; then 95 / 90 / 80 / 70%
   *  and up for S / A / B / C. */
  grade(acc, counts, failed = false, hidden = false) {
    if (failed) return 'F';
    if (counts && counts[2] + counts[3] + counts[4] + counts[5] === 0) return hidden ? 'XH' : 'SS';
    if (acc >= 0.95) return hidden ? 'SH' : 'S';
    if (acc >= 0.9) return 'A';
    if (acc >= 0.8) return 'B';
    if (acc >= 0.7) return 'C';
    return 'D';
  },

  // https://github.com/ppy/osu/blob/master/osu.Game/Beatmaps/IBeatmapDifficultyInfo.cs
  difficultyRange(d, min, mid, max) {
    if (d > 5) return mid + (max - mid) * (d - 5) / 5;
    if (d < 5) return mid + (mid - min) * (d - 5) / 5;
    return mid;
  },
};

/** ScoreV1 (osu!mania) with the hit-bonus mechanic. Values indexed like J (MAX..miss). */
const SCORE_V1 = {
  value: [320, 300, 200, 100, 50, 0],
  bonusValue: [32, 32, 16, 8, 4, 0],
  bonusChange: [2, 1, -8, -24, -44, -100],
};

/** Legacy mania health: calibrates hpMultiplierNormal by simulating a perfect play, then applies
 *  per-judgement increases (hold-tail misses cost half). */
function computeHpMultiplier(notes, hp, breaks = [], rawHp = hp) {
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
function healthIncrease(j, hp, hold, mult = 1) {
  switch (j) {
    case J.MISS: return hold ? -(hp + 1) * 0.00375 : -(hp + 1) * 0.0075;
    case J.BAD: return -(hp + 1) * 0.0016;
    case J.GOOD: return 0;
    case J.GREAT: return mult * (0.004 - hp * 0.0004);
    case J.PERF: return mult * (0.005 - hp * 0.0005);
    default: return mult * (0.0055 - hp * 0.0005);
  }
}

/** Star rating: port of osu!lazer's ManiaDifficultyCalculator (Strain skill). */
const ManiaStarRating = {
  DIFFICULTY_MULTIPLIER: 0.018, INDIVIDUAL_DECAY_BASE: 0.125, OVERALL_DECAY_BASE: 0.3,
  DECAY_WEIGHT: 0.9, SECTION_LENGTH: 400, RELEASE_THRESHOLD: 30,

  calculate(notes, keys, rate = 1) {
    if (notes.length < 2) return 0;
    const hos = notes.map(n => ({ startTime: n.time / rate, endTime: (n.isLN ? n.end : n.time) / rate, column: n.col }))
      .sort((a, b) => Math.round(a.startTime) - Math.round(b.startTime));
    const objs = this._diffObjects(hos, keys);
    return this._strain(objs, keys) * this.DIFFICULTY_MULTIPLIER;
  },
  _diffObjects(hos, keys) {
    const objects = [], perCol = Array.from({ length: keys }, () => []);
    for (let i = 1; i < hos.length; i++) {
      const cur = hos[i], last = hos[i - 1];
      const col = perCol[cur.column] || (perCol[cur.column] = []);
      const prevInCol = col[col.length - 1] || null;
      const prevs = new Array(keys).fill(null);
      if (objects.length) {
        const p = objects[objects.length - 1];
        for (let j = 0; j < keys; j++) prevs[j] = p.prevs[j];
        prevs[p.column] = p;
      }
      const o = {
        index: objects.length, startTime: cur.startTime, endTime: cur.endTime, deltaTime: cur.startTime - last.startTime,
        column: cur.column, columnStrainTime: prevInCol ? cur.startTime - prevInCol.startTime : cur.startTime, prevs,
      };
      objects.push(o); col.push(o);
    }
    return objects;
  },
  _strain(objects, keys) {
    const decay = (v, dt, base) => v * Math.pow(base, dt / 1000);
    const bigger = (a, b, d) => a - b > d;
    const logistic = (x, mid, mul, max = 1) => max / (1 + Math.exp(mul * (mid - x)));
    const indiv = new Array(keys).fill(0);
    let highestIndiv = 0, overall = 1, currentStrain = 0, sectionPeak = 0, sectionEnd = 0;
    const peaks = [];
    for (const cur of objects) {
      if (cur.index === 0) sectionEnd = Math.ceil(cur.startTime / this.SECTION_LENGTH) * this.SECTION_LENGTH;
      while (cur.startTime > sectionEnd) {
        peaks.push(sectionPeak);
        const prev = cur.index > 0 ? objects[cur.index - 1] : null;
        const prevStart = prev ? prev.startTime : cur.startTime;
        sectionPeak = decay(highestIndiv, sectionEnd - prevStart, this.INDIVIDUAL_DECAY_BASE) + decay(overall, sectionEnd - prevStart, this.OVERALL_DECAY_BASE);
        sectionEnd += this.SECTION_LENGTH;
      }
      currentStrain *= Math.pow(1, cur.deltaTime / 1000);
      // individual strain
      let holdFactor = 1;
      for (const p of cur.prevs) {
        if (p && bigger(p.endTime, cur.endTime, 1) && bigger(cur.startTime, p.startTime, 1)) { holdFactor = 1.25; break; }
      }
      indiv[cur.column] = decay(indiv[cur.column], cur.columnStrainTime, this.INDIVIDUAL_DECAY_BASE) + 2 * holdFactor;
      highestIndiv = cur.deltaTime <= 1 ? Math.max(highestIndiv, indiv[cur.column]) : indiv[cur.column];
      // overall strain
      let overlapping = false, closestEnd = Math.abs(cur.endTime - cur.startTime), hf = 1, holdAdd = 0;
      for (const p of cur.prevs) {
        if (!p) continue;
        overlapping = overlapping || (bigger(p.endTime, cur.startTime, 1) && bigger(cur.endTime, p.endTime, 1) && bigger(cur.startTime, p.startTime, 1));
        if (bigger(p.endTime, cur.endTime, 1) && bigger(cur.startTime, p.startTime, 1)) hf = 1.25;
        closestEnd = Math.min(closestEnd, Math.abs(cur.endTime - p.endTime));
      }
      if (overlapping) holdAdd = logistic(closestEnd, this.RELEASE_THRESHOLD, 0.27);
      overall = decay(overall, cur.deltaTime, this.OVERALL_DECAY_BASE) + (1 + holdAdd) * hf;
      currentStrain += highestIndiv + overall - currentStrain;
      sectionPeak = Math.max(currentStrain, sectionPeak);
    }
    peaks.push(sectionPeak);
    let diff = 0, w = 1;
    for (const p of peaks.filter(x => x > 0).sort((a, b) => b - a)) { diff += p * w; w *= this.DECAY_WEIGHT; }
    return diff;
  },
};
