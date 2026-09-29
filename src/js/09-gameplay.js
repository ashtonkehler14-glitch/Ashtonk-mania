/* JudgementSystem / ScoreSystem / HealthSystem / GameplayEngine.
 * Pure, deterministic logic: given notes and a sequence of (column, down/up, songTime) inputs it
 * always produces the same result. Live play and replay playback share this code path exactly. */

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

/** Timing windows in real milliseconds (osu!mania ScoreV2 table; OD adjusted by EZ/HR/Difficulty Adjust). */
function timingWindows({ od = 5, mods = [], mode = 'od', customOD = 8, customMs = '', odOverride = null } = {}) {
  if (mode === 'ms') {
    const p = String(customMs).split(/[,\s]+/).map(Number).filter(n => isFinite(n) && n > 0);
    if (p.length === 6) return p.slice().sort((a, b) => a - b);
  }
  const base = mode === 'custom' ? customOD : od;
  return OsuMath.hitWindows(OsuMath.odAfterMods(base, mods, mods.includes('DA') ? odOverride : null));
}

/** ScoreV1 osu!mania scoring (1,000,000 max) with bonus, osu! accuracy and max combo. */
class ScoreSystem {
  constructor(totalJudgements, { mods = [], accuracyMode = 'v2' } = {}) {
    this.total = Math.max(1, totalJudgements);
    this.mult = ModSystem.multiplier(mods);
    this.accMode = accuracyMode;
    this.counts = [0, 0, 0, 0, 0, 0];
    this.judged = 0; this.combo = 0; this.maxCombo = 0;
    this.bonus = 100; this.rawScore = 0;
    this.comboBreaks = 0;
  }
  add(j) {
    this.counts[j]++; this.judged++;
    const unit = 1e6 / 2 / this.total;
    this.bonus = clamp(this.bonus + SCORE_V1.bonusChange[j], 0, 100);
    this.rawScore += (unit * SCORE_V1.value[j] / 320 + unit * SCORE_V1.bonusValue[j] * Math.sqrt(this.bonus) / 320) * this.mult;
    if (j === J.MISS) this.breakCombo();
    else { this.combo++; if (this.combo > this.maxCombo) this.maxCombo = this.combo; }
  }
  breakCombo() { if (this.combo > 0) this.comboBreaks++; this.combo = 0; }
  get accuracy() { return this.accMode === 'v1' ? OsuMath.accuracyV1(this.counts) : OsuMath.accuracy(this.counts); }
  get score() { return Math.round(this.rawScore); }
  grade(failed = false, mods = []) { return ScoreSystem.gradeFor(this.accuracy, failed, mods, this.counts); }
  static gradeFor(acc, failed, mods = [], counts = null) {
    return OsuMath.grade(acc, counts, failed, mods.includes('HD') || mods.includes('FI'));
  }
}

/** osu!mania health (legacy draining processor calibration + per-judgement changes). */
class HealthSystem {
  constructor({ hp = 5, mods = [], noFail = false, notes = [], breaks = [], hpOverride = null, accChallenge = null } = {}) {
    this.value = 1;
    this.rawHp = mods.includes('DA') && hpOverride != null ? hpOverride : hp;
    const hpMod = OsuMath.hpAfterMods(hp, mods, mods.includes('DA') ? hpOverride : null);
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
  earlyRelease() { if (this.suddenDeath) this.fail(); }
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
   */
  constructor({ notes, keys, windows, rate = 1, mods = [], hp = 5, accuracyMode = 'v2', noFail = false, breaks = [], modConfig = {} }) {
    this.keys = keys; this.rate = rate; this.mods = mods;
    this.W = windows.map(w => w * rate);
    this.TW = this.W.map(w => w * TAIL_LENIENCE);
    this.notes = notes.map((n, i) => ({ ...n, i, state: NS.PENDING, headJ: -1, tailJ: -1, capped: false, holdStart: 0, hitTime: 0 }));
    this.columns = Array.from({ length: keys }, () => []);
    for (const n of this.notes) this.columns[n.col].push(n);
    this.ptr = new Array(keys).fill(0);
    this.held = new Array(keys).fill(false);
    this.holding = new Array(keys).fill(null);
    const totalJ = this.notes.reduce((a, n) => a + (n.isLN ? 2 : 1), 0);
    this.totalJudgements = totalJ;
    this.score = new ScoreSystem(totalJ, { mods, accuracyMode });
    this.health = new HealthSystem({ hp, mods, noFail, notes: this.notes, breaks, hpOverride: modConfig.hp ?? null, accChallenge: modConfig.acc ?? null });
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
    this.health.apply(j, t, tail, this.score.accuracy);
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

  /** Process misses / auto-resolutions up to song time t. */
  advance(t) {
    if (t < this.lastTime) t = this.lastTime;
    this.lastTime = t;
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
            // held past the release window without letting go: the tail is missed (osu!mania behaviour)
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

  /** Key press/release at song time t (map ms). */
  input(col, down, t) {
    if (col < 0 || col >= this.keys) return;
    this.advance(t);
    this.inputCount++;
    if (down) {
      if (this.held[col]) return;
      this.held[col] = true;
      this.pressCounts[col]++;
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
      } else if (n.state === NS.DROPPED && t >= n.time - this.W[J.BAD] && t <= n.end) {
        // re-grab a dropped long note: tail result is capped at Bad
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
        // released too early: combo breaks, the note can be re-grabbed but the tail is capped at 50
        n.state = NS.DROPPED; n.capped = true;
        this.score.breakCombo();
        this.health.earlyRelease(t);
        this._emit({ type: 'earlyRelease', col, t, note: n });
        return;
      }
      let j = this._windowFor(Math.abs(err), this.TW);
      if (n.capped) j = J.BAD;
      n.tailJ = j; n.state = NS.DONE;
      this._judge(n, j, t, err, true);
      this.ptr[col]++;
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
          n.state = NS.PENDING; n.headJ = -1; n.tailJ = -1; n.capped = false;
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
      score: this.score.score, accuracy: this.score.accuracy, maxCombo: this.score.maxCombo, combo: this.score.combo,
      counts: [...this.score.counts], comboBreaks: this.score.comboBreaks,
      meanError: mean, unstableRate: sd * 10,
      early: errs.filter(e => e < 0).length, late: errs.filter(e => e > 0).length,
      hitErrors: this.hitErrors.map(e => [Math.round(e.t), Math.round(e.err * 10) / 10, e.j, e.tail ? 1 : 0]),
      totalJudgements: this.totalJudgements,
    };
  }
}

/** Prepare notes for a play: apply column map (MR/RD) and NLN. */
function prepareNotes(notes, keys, mods, seed) {
  const map = ModSystem.columnMap(mods, keys, seed);
  const nln = mods.includes('NLN');
  return notes.map(n => ({ ...n, col: map[n.col], isLN: nln ? false : n.isLN, end: nln ? n.time : n.end }));
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

