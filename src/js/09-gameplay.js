/* JudgementSystem / ScoreSystem / HealthSystem / GameplayEngine.
 * Pure, deterministic logic: given notes and a sequence of (column, down/up, songTime) inputs it
 * always produces the same result. Live play and replay playback share this code path exactly.
 *
 * Judging rules (`rules`):
 *   2 — osu!lazer's osu!mania rules, checked line by line against the osu!lazer source (ppy/osu:
 *       DrawableNote, DrawableHoldNote(+Head/Tail/Body), ManiaHitWindows, OrderedHitPolicy,
 *       ManiaHealthProcessor, ManiaModHardRock/Easy/Perfect). Used for every new play.
 *   1 — the rules plays were judged with before; replays recorded then keep them, so they re-score exactly. */

const J = { MARV: 0, PERF: 1, GREAT: 2, GOOD: 3, BAD: 4, MISS: 5 };
const JUDGEMENTS = [
  { id: '300g', name: 'Marvelous', short: 'MAX', score: 320, color: '#ffe066' },
  { id: '300', name: 'Perfect', short: '300', score: 300, color: '#ffc233' },
  { id: '200', name: 'Great', short: '200', score: 200, color: '#38d97a' },
  { id: '100', name: 'Good', short: '100', score: 100, color: '#3c9dff' },
  { id: '50', name: 'Bad', short: '50', score: 50, color: '#b07cf0' },
  { id: '0', name: 'Miss', short: 'MISS', score: 0, color: '#ff4a5c' },
];
const TAIL_LENIENCE = 1.5;
/** The judging rules new plays use (replays store the rules they were recorded with). */
const RULES = 2;

/** Timing windows in real milliseconds, [MAX, 300, 200, 100, 50, miss] (osu!mania table from OD).
 *  osu!mania's Easy / Hard Rock scale the windows themselves (×1.4 / ÷1.4) and leave OD alone; rules 1
 *  changed OD instead. Difficulty Adjust sets OD directly. */
function timingWindows({ od = 5, mods = [], mode = 'od', customOD = 8, customMs = '', odOverride = null, rules = RULES } = {}) {
  if (mode === 'ms') {
    const p = String(customMs).split(/[,\s]+/).map(Number).filter(n => isFinite(n) && n > 0);
    if (p.length === 6) return p.slice().sort((a, b) => a - b);
  }
  const base = mode === 'custom' ? customOD : od;
  const override = mods.includes('DA') ? odOverride : null;
  if (rules < 2) return OsuMath.hitWindows(OsuMath.odAfterMods(base, mods, override));
  const m = mods.includes('HR') ? 1 / 1.4 : mods.includes('EZ') ? 1.4 : 1;
  return OsuMath.hitWindows(override != null ? override : base).map(w => w * m);
}

/** osu!lazer standardised scoring (ManiaScoreProcessor): each judgement adds its base score (a MAX counts 300)
 *  times log₄(combo after it), between 0.5 and log₄(400); the combo part is worth 150,000 and accuracy
 *  (MAX = 305) 850,000 × acc^(2 + 2·acc). */
const STD_COMBO_BASE = [300, 300, 200, 100, 50, 0];
const STD_COMBO_CAP = Math.log(400) / Math.log(4);
const stdComboFactor = c => Math.min(Math.max(0.5, Math.log(c) / Math.log(4)), STD_COMBO_CAP);

/** ScoreV1 osu!mania scoring (1,000,000 max) with bonus, osu! accuracy and max combo — and, alongside it,
 *  osu!lazer's standardised score (`scoreStd`). */
class ScoreSystem {
  constructor(totalJudgements, { mods = [], accuracyMode = 'v2' } = {}) {
    this.total = Math.max(1, totalJudgements);
    this.mult = ModSystem.multiplier(mods);
    this.accMode = accuracyMode;
    this.counts = [0, 0, 0, 0, 0, 0];
    this.judged = 0; this.combo = 0; this.maxCombo = 0;
    this.bonus = 100; this.rawScore = 0;
    this.comboBreaks = 0;
    this.comboPortion = 0; this.maxComboPortion = 0;
    for (let k = 1; k <= this.total; k++) this.maxComboPortion += 300 * stdComboFactor(k);
  }
  add(j) {
    this.counts[j]++; this.judged++;
    const unit = 1e6 / 2 / this.total;
    this.bonus = clamp(this.bonus + SCORE_V1.bonusChange[j], 0, 100);
    this.rawScore += (unit * SCORE_V1.value[j] / 320 + unit * SCORE_V1.bonusValue[j] * Math.sqrt(this.bonus) / 320) * this.mult;
    if (j === J.MISS) this.breakCombo();
    else { this.combo++; if (this.combo > this.maxCombo) this.maxCombo = this.combo; }
    this.comboPortion += STD_COMBO_BASE[j] * stdComboFactor(this.combo);
  }
  breakCombo() { if (this.combo > 0) this.comboBreaks++; this.combo = 0; }
  get accuracy() { return this.accMode === 'v1' ? OsuMath.accuracyV1(this.counts) : OsuMath.accuracy(this.counts); }
  get score() { return Math.round(this.rawScore); }
  get scoreStd() {
    const acc = OsuMath.accuracy(this.counts);
    const combo = this.maxComboPortion > 0 ? this.comboPortion / this.maxComboPortion : 1;
    return Math.round((150000 * combo + 850000 * Math.pow(acc, 2 + 2 * acc) * (this.judged / this.total)) * this.mult);
  }
  grade(failed = false, mods = []) { return ScoreSystem.gradeFor(this.accuracy, failed, mods, this.counts); }
  static gradeFor(acc, failed, mods = [], counts = null) {
    return OsuMath.grade(acc, counts, failed, mods.includes('HD') || mods.includes('FI') || mods.includes('FL')); // (lazer's silver ranks: Hidden, Fade In, Flashlight)
  }
}

/** osu!mania health (legacy draining processor calibration + per-judgement changes). */
class HealthSystem {
  constructor({ hp = 5, mods = [], noFail = false, notes = [], breaks = [], hpOverride = null, accChallenge = null, rules = RULES } = {}) {
    this.value = 1;
    this.lazer = rules >= 2;
    const hpMod = OsuMath.hpAfterMods(hp, mods, mods.includes('DA') ? hpOverride : null);
    // osu!lazer uses the drain rate after mods for everything; rules 1 used the unmodified one for the changes
    this.rawHp = this.lazer ? hpMod : (mods.includes('DA') && hpOverride != null ? hpOverride : hp);
    this.mult = computeHpMultiplier(notes, hpMod, breaks, this.rawHp);
    this.noFail = noFail || mods.includes('NF') || mods.includes('AT');
    this.suddenDeath = mods.includes('SD');
    this.perfect = mods.includes('PF');
    this.perfectSS = mods.includes('PSS');
    this.accChallenge = mods.includes('AC') ? (accChallenge ?? 0.9) : null;
    this.failed = false; this.failTime = null;
    this.min = 1;
    this.timeline = [];
  }
  apply(j, t, hold = false, accuracy = 1) {
    if ((this.suddenDeath && j === J.MISS) || (this.perfect && j >= J.GREAT) || (this.perfectSS && j !== J.MARV)) {
      this.value = 0; this.fail(t);
    } else {
      this.value = clamp(this.value + healthIncrease(j, this.rawHp, hold, this.mult), 0, 1);
    }
    if (this.accChallenge != null && accuracy < this.accChallenge) this.fail(t);
    if (this.value < this.min) this.min = this.value;
    if (this.value <= 0) this.fail(t);
    this.timeline.push([Math.round(t), Math.round(this.value * 1000) / 1000]);
  }
  /** A hold released too early (its body breaks combo): Sudden Death fails, and in osu!lazer so do Perfect / SS. */
  earlyRelease(t) { if (this.suddenDeath || (this.lazer && (this.perfect || this.perfectSS))) this.fail(t); }
  fail(t) { if (this.noFail || this.failed) return; this.failed = true; this.failTime = t; }
}

/** Note states */
const NS = { PENDING: 0, HOLDING: 1, DONE: 2, MISSED: 3, DROPPED: 4 };

class GameplayEngine {
  /**
   * @param {object} o
   * @param {Array} o.notes  mania notes (already column-mapped / converted for mods)
   * @param {number} o.keys
   * @param {number[]} o.windows real-time windows [marv..miss] ms
   * @param {number} o.rate playback rate (map-time windows = real * rate)
   * @param {number} o.rules judging rules (see top of file)
   */
  constructor({ notes, keys, windows, rate = 1, mods = [], hp = 5, accuracyMode = 'v2', noFail = false, breaks = [], modConfig = {}, rules = RULES }) {
    this.keys = keys; this.rate = rate; this.mods = mods;
    this.rules = rules; this.lazer = rules >= 2;
    // No Release (osu!lazer ManiaModNoRelease): a hold still held when its end arrives is a MAX (a 50 if it broke)
    this.noRelease = this.lazer && mods.includes('NR');
    // Windows in song time. In osu!mania they scale with the playback rate, so the real-time window never changes
    // (IManiaRateAdjustmentMod); osu!lazer floors each one and adds half a millisecond (ManiaHitWindows).
    this.W = this.lazer ? windows.map(w => Math.floor(w * rate + 1e-9) + 0.5) : windows.map(w => w * rate);
    this.TW = this.W.map(w => w * TAIL_LENIENCE);
    this.notes = notes.map((n, i) => ({ ...n, i, state: NS.PENDING, headJ: -1, tailJ: -1, capped: false, bodyBroken: false, holdStart: 0, hitTime: 0 }));
    this.columns = Array.from({ length: keys }, () => []);
    for (const n of this.notes) this.columns[n.col].push(n);
    this.ptr = new Array(keys).fill(0);
    this.held = new Array(keys).fill(false);
    this.holding = new Array(keys).fill(null);
    const totalJ = this.notes.reduce((a, n) => a + (n.isLN ? 2 : 1), 0);
    this.totalJudgements = totalJ;
    this.score = new ScoreSystem(totalJ, { mods, accuracyMode });
    this.health = new HealthSystem({ hp, mods, noFail, notes: this.notes, breaks, hpOverride: modConfig.hp ?? null, accChallenge: modConfig.acc ?? null, rules });
    this.hitErrors = [];            // {t, err (real ms), j, tail}
    this.judgementLog = [];         // {t, j, col}
    this.lastJudgement = null;
    this.remaining = totalJ;
    this.listeners = [];
    this.inputCount = 0;
    this.pressCounts = new Array(keys).fill(0);
    this.lastTime = -Infinity;
  }
  onEvent(fn) { this.listeners.push(fn); }
  _emit(e) { for (const fn of this.listeners) fn(e); }

  _judge(n, j, t, err, tail) {
    this.score.add(j);
    // osu!lazer: misses on either end of a hold (head or tail) cost half a note's health; rules 1: only the tail
    this.health.apply(j, t, this.lazer ? n.isLN : tail, this.score.accuracy);
    this.remaining--;
    const e = { type: 'judgement', col: n.col, j, t, err, tail, note: n };
    this.lastJudgement = e;
    this.judgementLog.push({ t, j, col: n.col });
    if (err !== null && j !== J.MISS) this.hitErrors.push({ t, err: err / this.rate, j, tail });
    this._emit(e);
  }
  _windowFor(absErr, W) {
    for (let j = 0; j < 5; j++) if (absErr <= W[j]) return j;
    return J.MISS;
  }
  /** The column's current note (the first one not fully judged), or undefined. */
  _cur(c) {
    const col = this.columns[c];
    let p = this.ptr[c];
    while (p < col.length && (col[p].state === NS.DONE || col[p].state === NS.MISSED)) p++;
    this.ptr[c] = p;
    return col[p];
  }

  /** Process misses / auto-resolutions up to song time t. */
  advance(t) {
    if (t < this.lastTime) t = this.lastTime;
    this.lastTime = t;
    if (this.lazer) this._advanceLazer(t); else this._advanceLegacy(t);
  }

  /** osu!lazer: a note can't be hit any more once it's later than the 50 window (HitWindows.CanBeHit), and a hold's
   *  tail once it's later than 1.5× that. Resolved in time order across all columns. */
  _expiry(n) {
    if (n.state === NS.PENDING) return n.time + this.W[J.BAD];
    if (this.noRelease && n.state === NS.HOLDING) return n.end;
    return n.end + this.TW[J.BAD]; // HOLDING (held too long) or DROPPED (let go / head missed)
  }
  _advanceLazer(t) {
    for (;;) {
      let best = -1, bestT = Infinity;
      for (let c = 0; c < this.keys; c++) {
        const n = this._cur(c);
        if (!n) continue;
        const x = this._expiry(n);
        if (x < bestT) { bestT = x; best = c; }
      }
      if (best < 0 || !(t > bestT)) return;
      const n = this.columns[best][this.ptr[best]];
      if (n.state === NS.PENDING) {
        n.headJ = J.MISS;
        if (n.isLN) { n.state = NS.DROPPED; n.capped = true; } else { n.state = NS.MISSED; this.ptr[best]++; }
        this._judge(n, J.MISS, bestT, null, false);
      } else if (this.noRelease && n.state === NS.HOLDING) {
        // held through to the end: no release timing needed
        if (this.holding[best] === n) this.holding[best] = null;
        const j = n.capped ? J.BAD : J.MARV;
        n.tailJ = j; n.state = NS.DONE; this.ptr[best]++;
        this._judge(n, j, bestT, null, true);
      } else {
        if (this.holding[best] === n) this.holding[best] = null;
        n.tailJ = J.MISS; n.state = NS.MISSED; this.ptr[best]++;
        this._judge(n, J.MISS, bestT, null, true);
      }
    }
  }
  _advanceLegacy(t) {
    for (let c = 0; c < this.keys; c++) {
      const col = this.columns[c];
      let p = this.ptr[c];
      while (p < col.length) {
        const n = col[p];
        if (n.state === NS.PENDING) {
          if (t - n.time > this.W[J.MISS]) {
            this._judge(n, J.MISS, n.time + this.W[J.MISS], null, false);
            if (n.isLN) { n.state = NS.DROPPED; n.headJ = J.MISS; continue; }
            n.state = NS.MISSED; n.headJ = J.MISS; p++; continue;
          }
          break;
        } else if (n.state === NS.HOLDING) {
          if (t - n.end > this.TW[J.MISS]) {
            // held past the release window without letting go: the tail is missed
            n.tailJ = J.MISS; n.state = NS.MISSED;
            this.holding[c] = null;
            this._judge(n, J.MISS, n.end + this.TW[J.MISS], null, true);
            p++; continue;
          }
          break;
        } else if (n.state === NS.DROPPED) {
          if (t > n.end) {
            n.tailJ = J.MISS; n.state = NS.MISSED;
            this._judge(n, J.MISS, n.end, null, true);
            p++; continue;
          }
          break;
        } else { p++; }
      }
      this.ptr[c] = p;
    }
  }

  /** osu!lazer note lock (OrderedHitPolicy): hitting a note misses the earlier, still unjudged one in its column. */
  _forceMiss(n, c, t) {
    if (n.state === NS.PENDING) { n.headJ = J.MISS; this._judge(n, J.MISS, t, null, false); }
    if (n.isLN) {
      if (this.holding[c] === n) this.holding[c] = null;
      n.tailJ = J.MISS; this._judge(n, J.MISS, t, null, true);
    }
    n.state = NS.MISSED; this.ptr[c]++; // n is always the column's current note here
  }

  /** Key press/release at song time t (map ms). */
  input(col, down, t) {
    if (col < 0 || col >= this.keys) return;
    this.advance(t);
    this.inputCount++;
    if (down) {
      if (this.held[col]) return;
      this.held[col] = true;
      this.pressCounts[col]++;
      if (this.lazer) { this._pressLazer(col, t); return; }
      const colNotes = this.columns[col];
      const n = colNotes[this.ptr[col]];
      this._emit({ type: 'press', col, t, note: n || null });
      if (!n) return;
      if (n.state === NS.PENDING) {
        const err = t - n.time;
        if (err < -this.W[J.MISS]) return; // too early: nothing happens
        const j = this._windowFor(Math.abs(err), this.W);
        n.headJ = j; n.hitTime = t;
        if (n.isLN) {
          if (j === J.MISS) { n.state = NS.DROPPED; this._judge(n, j, t, err, false); }
          else { n.state = NS.HOLDING; n.holdStart = t; this.holding[col] = n; this._judge(n, j, t, err, false); }
        } else {
          n.state = j === J.MISS ? NS.MISSED : NS.DONE;
          this._judge(n, j, t, err, false);
          this.ptr[col]++;
        }
      } else if (n.state === NS.DROPPED && !n.released && t >= n.time - this.W[J.BAD] && t <= n.end) {
        // grab a long note whose head was missed: tail result is capped at Bad (one let go mid-hold can't be held again)
        n.state = NS.HOLDING; n.capped = true; this.holding[col] = n;
        this._emit({ type: 'regrab', col, t, note: n });
      }
    } else {
      if (!this.held[col]) return;
      this.held[col] = false;
      this._emit({ type: 'release', col, t });
      const n = this.holding[col];
      if (!n) return;
      this.holding[col] = null;
      const err = t - n.end;
      if (err < -this.TW[J.MISS]) {
        // released too early: the hold's body breaks combo, and it can't be held again — its tail is missed once
        // its window passes (pressing the column again does nothing to it)
        n.state = NS.DROPPED; n.capped = true; n.released = true;
        const broke = !this.lazer || !n.bodyBroken;
        n.bodyBroken = true;
        if (broke) { this.score.breakCombo(); this.health.earlyRelease(t); }
        this._emit({ type: 'earlyRelease', col, t, note: n, broke });
        return;
      }
      let j = this._windowFor(Math.abs(err), this.TW);
      // a broken hold's tail is capped at 50 (a miss stays a miss in osu!lazer)
      if (n.capped) j = this.lazer ? Math.max(j, J.BAD) : J.BAD;
      n.tailJ = j; n.state = this.lazer && j === J.MISS ? NS.MISSED : NS.DONE;
      this._judge(n, j, t, err, true);
      this.ptr[col]++;
    }
  }
  /** osu!lazer press: DrawableNote / DrawableHoldNote.OnPressed with the ordered hit policy. */
  _pressLazer(col, t) {
    let n = this._cur(col);
    this._emit({ type: 'press', col, t, note: n || null });
    while (n) {
      const next = this.columns[col][this.ptr[col] + 1];
      const hittable = !next || t < next.time; // a note can't be hit once the next one in its column has started
      if (n.state === NS.PENDING) {
        if (!hittable) { this._forceMiss(n, col, t); n = this._cur(col); continue; }
        const err = t - n.time;
        if (err < -this.W[J.MISS]) return; // too early: nothing happens
        const j = this._windowFor(Math.abs(err), this.W);
        n.headJ = j; n.hitTime = t;
        if (n.isLN) {
          // the hold begins even when the head is an early miss; its tail can then be at most a 50
          n.state = NS.HOLDING; n.holdStart = t; n.capped = j === J.MISS; this.holding[col] = n;
          this._judge(n, j, t, err, false);
        } else {
          n.state = j === J.MISS ? NS.MISSED : NS.DONE; this.ptr[col]++;
          this._judge(n, j, t, err, false);
        }
        return;
      }
      if (n.state === NS.DROPPED) {
        // hold it again: from the head's miss window until 50-window after the end (never in the tail's extra lenience)
        if (!n.released && hittable && t - n.time >= -this.W[J.MISS] && !(t > n.end && t - n.end > this.W[J.BAD])) {
          n.state = NS.HOLDING; n.capped = true; this.holding[col] = n;
          this._emit({ type: 'regrab', col, t, note: n });
          return;
        }
        if (!hittable) { this._forceMiss(n, col, t); n = this._cur(col); continue; }
      }
      return;
    }
  }

  get finished() { return this.remaining <= 0; }
  get endTime() { return this.notes.length ? Math.max(...this.notes.slice(-this.keys * 4).map(n => n.end)) : 0; }

  /** Reset notes in [from, to] (practice looping). */
  resetRange(from, to) {
    for (let c = 0; c < this.keys; c++) {
      const col = this.columns[c];
      let first = -1;
      for (let i = 0; i < col.length; i++) {
        const n = col[i];
        if (n.time >= from - 1 && n.time <= to) {
          if (n.state !== NS.PENDING) this.remaining += n.isLN ? 2 : 1;
          n.state = NS.PENDING; n.headJ = -1; n.tailJ = -1; n.capped = false; n.bodyBroken = false;
          if (first < 0) first = i;
        }
      }
      if (first >= 0) this.ptr[c] = Math.min(this.ptr[c], first);
      this.held[c] = false; this.holding[c] = null;
    }
    this.lastTime = from - 1;
  }

  summary() {
    const errs = this.hitErrors.filter(e => !e.tail).map(e => e.err);
    const mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0;
    const sd = errs.length > 1 ? Math.sqrt(errs.reduce((a, b) => a + (b - mean) ** 2, 0) / (errs.length - 1)) : 0;
    return {
      score: this.score.score, scoreStd: this.score.scoreStd, accuracy: this.score.accuracy, maxCombo: this.score.maxCombo, combo: this.score.combo,
      counts: [...this.score.counts], comboBreaks: this.score.comboBreaks,
      meanError: mean, unstableRate: sd * 10,
      early: errs.filter(e => e < 0).length, late: errs.filter(e => e > 0).length,
      hitErrors: this.hitErrors.map(e => [Math.round(e.t), Math.round(e.err * 10) / 10, e.j, e.tail ? 1 : 0]),
      totalJudgements: this.totalJudgements,
    };
  }
}

/** Prepare notes for a play: apply column map (MR/RD) and NLN. */
function prepareNotes(notes, keys, mods, seed, { red = null } = {}) {
  const map = ModSystem.columnMap(mods, keys, seed);
  const nln = mods.includes('NLN');
  const out = notes.map(n => ({ ...n, col: map[n.col], isLN: nln ? false : n.isLN, end: nln ? n.time : n.end }));
  return mods.includes('IN') ? invertNotes(out, keys, red) : out;
}

/** osu!lazer's Invert (ManiaModInvert): in each column, every note (or hold head) becomes a hold lasting until
 *  the next one starts, shortened by a quarter beat (at most by half) so there's always a gap to press again.
 *  The last note of each column has nothing to hold to and is dropped. red: uninherited timing points. */
function invertNotes(notes, keys, red) {
  const beatAt = t => {
    if (!red || !red.length) return 500;
    let bl = red[0].beatLength;
    for (const r of red) { if (r.time <= t) bl = r.beatLength; else break; }
    return bl;
  };
  const out = [];
  for (let c = 0; c < keys; c++) {
    const col = notes.filter(n => n.col === c).sort((a, b) => a.time - b.time);
    for (let i = 0; i < col.length - 1; i++) {
      const n = col[i], next = col[i + 1];
      let dur = next.time - n.time;
      dur = Math.max(dur / 2, dur - beatAt(next.time) / 4);
      if (!(dur > 0)) continue;
      out.push({ ...n, isLN: true, end: n.time + dur });
    }
  }
  return out.sort((a, b) => a.time - b.time || a.col - b.col);
}

/** Auto: generate a perfect input stream. Returns flat events [t, col, down(1/0)] sorted. */
function generateAutoInputs(notes, keys) {
  const byCol = Array.from({ length: keys }, () => []);
  for (const n of notes) byCol[n.col].push(n);
  const ev = [];
  for (const col of byCol) {
    for (let i = 0; i < col.length; i++) {
      const n = col[i], next = col[i + 1];
      let up = n.isLN ? n.end : n.time + 45;
      if (next && up >= next.time) up = n.isLN ? n.end : (n.time + next.time) / 2;
      ev.push([n.time, n.col, 1], [up, n.col, 0]);
    }
  }
  ev.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  return ev;
}
