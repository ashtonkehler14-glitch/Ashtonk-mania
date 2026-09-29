/* JudgementSystem / ScoreSystem / HealthSystem / GameplayEngine.
 * Pure, deterministic logic: given notes and a sequence of (column, down/up, songTime) inputs it
 * always produces the same result. Live play and replay playback share this code path exactly. */

const J = { MARV: 0, PERF: 1, GREAT: 2, GOOD: 3, BAD: 4, MISS: 5 };
const JUDGEMENTS = [
  { id: '300g', name: 'Marvelous', short: 'MAX', score: 305, v1: 300, color: '#ffe066', health: 0.008 },
  { id: '300', name: 'Perfect', short: '300', score: 300, v1: 300, color: '#ffc233', health: 0.006 },
  { id: '200', name: 'Great', short: '200', score: 200, v1: 200, color: '#38d97a', health: 0.002 },
  { id: '100', name: 'Good', short: '100', score: 100, v1: 100, color: '#3c9dff', health: 0 },
  { id: '50', name: 'Bad', short: '50', score: 50, v1: 50, color: '#b07cf0', health: -0.012 },
  { id: '0', name: 'Miss', short: 'MISS', score: 0, v1: 0, color: '#ff4a5c', health: -0.06 },
];
const TAIL_LENIENCE = 1.5;

/** Timing windows in real milliseconds (before rate scaling). */
function timingWindows({ od = 5, mods = [], mode = 'od', customOD = 8, customMs = '' } = {}) {
  let w;
  if (mode === 'ms') {
    const p = String(customMs).split(/[,\s]+/).map(Number).filter(n => isFinite(n) && n > 0);
    if (p.length === 6) w = p.slice().sort((a, b) => a - b);
  }
  if (!w) {
    const o = mode === 'custom' ? customOD : od;
    w = [16, 64 - 3 * o, 97 - 3 * o, 127 - 3 * o, 151 - 3 * o, 188 - 3 * o];
  }
  const s = ModSystem.windowScale(mods);
  return w.map(x => x * s);
}

class ScoreSystem {
  constructor(totalJudgements, { mods = [], accuracyMode = 'v2' } = {}) {
    this.total = Math.max(1, totalJudgements);
    this.mult = ModSystem.multiplier(mods);
    this.accMode = accuracyMode;
    this.counts = [0, 0, 0, 0, 0, 0];
    this.judged = 0; this.combo = 0; this.maxCombo = 0;
    this.scoreSum = 0; this.accSum = 0; this.comboSum = 0;
    this.comboBreaks = 0;
    let cm = 0; for (let k = 1; k <= this.total; k++) cm += Math.min(k, 400) / 400;
    this.comboMax = cm;
  }
  add(j) {
    const J_ = JUDGEMENTS[j];
    this.counts[j]++; this.judged++;
    this.scoreSum += J_.score;
    this.accSum += this.accMode === 'v1' ? J_.v1 : J_.score;
    if (j === J.MISS) this.breakCombo();
    else {
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.comboSum += (J_.score / 305) * Math.min(this.combo, 400) / 400;
    }
  }
  breakCombo() { if (this.combo > 0) this.comboBreaks++; this.combo = 0; }
  get accuracy() {
    if (!this.judged) return 1;
    return this.accSum / (this.judged * (this.accMode === 'v1' ? 300 : 305));
  }
  get score() {
    return Math.round(1e6 * this.mult * (0.99 * this.scoreSum / (this.total * 305) + 0.01 * this.comboSum / this.comboMax));
  }
  /** Score if the rest of the map were played perfectly — used for pace display. */
  grade(failed = false, mods = []) { return ScoreSystem.gradeFor(this.accuracy, failed, mods, this.counts); }
  static gradeFor(acc, failed, mods = [], counts = null) {
    if (failed) return 'F';
    const hid = mods.includes('HD') || mods.includes('FI');
    const perfect = counts ? counts[2] + counts[3] + counts[4] + counts[5] === 0 : acc >= 1;
    if (perfect) return hid ? 'XH' : 'SS';
    if (acc >= 0.95) return hid ? 'SH' : 'S';
    if (acc >= 0.9) return 'A';
    if (acc >= 0.8) return 'B';
    if (acc >= 0.7) return 'C';
    return 'D';
  }
}

class HealthSystem {
  constructor({ hp = 5, mods = [], noFail = false } = {}) {
    this.value = 1;
    this.factor = (0.5 + hp / 10) * ModSystem.drainScale(mods);
    this.noFail = noFail || mods.includes('NF') || mods.includes('AT');
    this.suddenDeath = mods.includes('SD');
    this.perfect = mods.includes('PF');
    this.failed = false; this.failTime = null;
    this.min = 1;
  }
  apply(j, t) {
    const g = JUDGEMENTS[j].health;
    this.value = clamp(this.value + (g < 0 ? g * this.factor : g), 0, 1);
    if (this.value < this.min) this.min = this.value;
    if (this.suddenDeath && j === J.MISS) this.fail(t);
    if (this.perfect && j >= J.GREAT) this.fail(t);
    if (this.value <= 0) this.fail(t);
  }
  earlyRelease(t) {
    this.value = clamp(this.value - 0.03 * this.factor, 0, 1);
    if (this.suddenDeath) this.fail(t);
    if (this.value <= 0) this.fail(t);
  }
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
  constructor({ notes, keys, windows, rate = 1, mods = [], hp = 5, accuracyMode = 'v2', noFail = false }) {
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
    this.health = new HealthSystem({ hp, mods, noFail });
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
    this.health.apply(j, t);
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
          if (t - n.end > this.TW[J.BAD]) {
            // held past the release window: judged as a late release
            n.tailJ = J.BAD; n.state = NS.DONE;
            this.holding[c] = null;
            this._judge(n, n.tailJ, n.end + this.TW[J.BAD], null, true);
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
      if (err < -this.TW[J.BAD]) {
        // released too early
        n.state = NS.DROPPED; n.capped = true;
        this.score.breakCombo();
        this.health.earlyRelease(t);
        this._emit({ type: 'earlyRelease', col, t, note: n });
        return;
      }
      let j = this._windowFor(Math.abs(err), this.TW);
      if (n.capped) j = Math.max(j, J.BAD);
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

/** Resolve beatmap hitsounds (sample set / additions / custom index / keysounds). */
const HitSounds = {
  SETS: ['', 'normal', 'soft', 'drum'],
  /** List of {name, volume, file?} to play for a note. */
  resolve(note, bm, tpIndex) {
    const s = note.sample || [];
    const tp = tpIndex(note.time);
    const mapSet = { normal: 1, soft: 2, drum: 3 }[bm.sampleSetName] || 1;
    let normal = parseInt(s[0], 10) || tp?.sampleSet || mapSet;
    let add = parseInt(s[1], 10) || normal;
    const idx = parseInt(s[2], 10) || tp?.sampleIndex || 0;
    const vol = (parseInt(s[3], 10) || tp?.volume || 100) / 100;
    const file = s[4] ? normPath(s[4]) : '';
    const out = [];
    if (file) { out.push({ file, volume: vol }); return out; }
    const nm = (set, sound) => `${this.SETS[set] || 'normal'}-hit${sound}`;
    out.push({ name: nm(normal, 'normal'), index: idx, volume: vol });
    if (note.hs & 2) out.push({ name: nm(add, 'whistle'), index: idx, volume: vol });
    if (note.hs & 4) out.push({ name: nm(add, 'finish'), index: idx, volume: vol });
    if (note.hs & 8) out.push({ name: nm(add, 'clap'), index: idx, volume: vol });
    return out;
  },
};

/** Loads sample buffers for a play (beatmap custom samples > skin > default). */
class SampleBank {
  constructor(setId) { this.setId = setId; this.cache = new Map(); }
  async _beatmapSample(base) {
    for (const ext of ['wav', 'ogg', 'mp3']) {
      if (BeatmapManager.hasFile(this.setId, `${base}.${ext}`)) {
        const b = await BeatmapManager.getFile(this.setId, `${base}.${ext}`);
        if (b && b.size > 64) return AudioManager.decode(await b.arrayBuffer()).catch(() => null);
        return null;
      }
    }
    return undefined;
  }
  async get(spec) {
    const key = spec.file ? `f:${spec.file}` : `${spec.name}:${spec.index || 0}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = (async () => {
      const useMap = Settings.get('audio.beatmapSamples');
      if (spec.file) {
        if (!useMap) return null;
        const b = await BeatmapManager.getFile(this.setId, spec.file);
        return b ? AudioManager.decode(await b.arrayBuffer()).catch(() => null) : null;
      }
      if (useMap && spec.index > 0) {
        const r = await this._beatmapSample(spec.index === 1 ? spec.name : spec.name + spec.index);
        if (r !== undefined) return r;
      }
      return SkinManager.sample(spec.name);
    })();
    this.cache.set(key, p);
    return p;
  }
  async preload(specLists) {
    const uniq = new Map();
    for (const l of specLists) for (const s of l) uniq.set(s.file ? `f:${s.file}` : `${s.name}:${s.index || 0}`, s);
    await Promise.all([...uniq.values()].map(s => this.get(s)));
  }
  play(specs) {
    for (const s of specs) {
      const p = this.cache.get(s.file ? `f:${s.file}` : `${s.name}:${s.index || 0}`);
      if (p) p.then(b => b && AudioManager.play(b, { volume: s.volume ?? 1 }));
    }
  }
}
