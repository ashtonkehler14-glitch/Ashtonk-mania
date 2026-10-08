/* osu!lazer's ManiaBeatmapConverter (osu.Game.Rulesets.Mania/Beatmaps, MIT © ppy Pty Ltd): an osu!standard beatmap
 * played as osu!mania, turned into exactly the notes lazer (and osu!stable) make from it — the column count from its
 * circle size, accuracy and how many of its objects are sliders and spinners; the patterns from its legacy
 * generators (circles, sliders, spinners), driven by the same seeded random numbers, so a convert is the same map
 * for everyone (replays, multiplayer and the server's judging included). */

const ManiaConvert = (() => {
  const f32 = Math.fround;
  // (C#'s Math.Round and MathF.Round: a half goes to the even neighbour)
  const roundEven = x => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };
  const T_ = { None: 0, ForceStack: 1, ForceNotStack: 2, KeepSingle: 4, LowProbability: 8, Alternate: 16, ForceSigSlider: 32, ForceNotSlider: 64, Gathered: 128, Mirror: 256, Reverse: 512, Cycle: 1024, Stair: 2048, ReverseStair: 4096 };
  const has = (v, f) => (v & f) === f;
  const SND = { whistle: 2, finish: 4, clap: 8 };

  /** osu!stable's random number generator (xorshift), as lazer's LegacyRandom. */
  class LegacyRandom {
    constructor(seed) { this.x = seed >>> 0; this.y = 842502087; this.z = 3579807591; this.w = 273326509; }
    nextUInt() {
      const t = (this.x ^ (this.x << 11)) >>> 0;
      this.x = this.y; this.y = this.z; this.z = this.w;
      return (this.w = (this.w ^ (this.w >>> 19) ^ t ^ (t >>> 8)) >>> 0);
    }
    next() { return this.nextUInt() & 0x7FFFFFFF; }
    nextDouble() { return this.next() / 2147483648; }
    nextRange(lo, hi) { return Math.trunc(lo + this.nextDouble() * (hi - lo)); }
  }

  class Pattern {
    constructor() { this.objs = []; this.cols = new Set(); }
    add(o) { this.objs.push(o); this.cols.add(o.col); }
    addAll(p) { for (const o of p.objs) this.add(o); }
    has(c) { return this.cols.has(c); }
    get columns() { return this.cols.size; }
    clear() { this.objs = []; this.cols = new Set(); }
  }
  class NotEnoughColumns extends Error { constructor() { super('There were not enough columns to complete conversion.'); } }

  /** The control points an osu! beatmap gives a convert: the beat length, slider velocity and kiai at a time. */
  function controlPoints(bm) {
    const tps = bm.timingPoints;
    const red = tps.filter(t => t.uninherited);
    // (a red line also sets the slider velocity back to 1; a green one at the same moment wins over it)
    const diff = [];
    for (const t of tps) {
      const sv = t.uninherited ? 1 : Math.min(10, Math.max(0.1, t.beatLength < 0 ? 100 / -t.beatLength : 1));
      if (diff.length && diff[diff.length - 1].time === t.time) { if (!t.uninherited) diff[diff.length - 1].sv = sv; }
      else diff.push({ time: t.time, sv });
    }
    const effects = [];
    for (const t of tps) {
      const kiai = !!(t.effects & 1);
      if (effects.length && effects[effects.length - 1].time === t.time) { if (!t.uninherited) effects[effects.length - 1].kiai = kiai; }
      else effects.push({ time: t.time, kiai });
    }
    const at = (list, time) => { let lo = 0, hi = list.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m].time <= time) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
    return {
      // (osu! keeps a beat between 6ms and a minute)
      beatLength(time) { if (!red.length) return 1000; const i = at(red, time); return Math.min(60000, Math.max(6, red[i < 0 ? 0 : i].beatLength)); },
      sv(time) { const i = at(diff, time); return i < 0 ? 1 : diff[i].sv; },
      kiai(time) { const i = at(effects, time); return i < 0 ? false : effects[i].kiai; },
    };
  }

  /** The difficulty settings as osu! reads them (single-precision, each within osu!'s range), approach rate
   *  falling back to accuracy. */
  function difficulty(bm) {
    const d = bm.difficulty, num = (v, dflt) => { const n = parseFloat(v); return Number.isFinite(n) ? n : dflt; };
    const c = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const od = f32(num(d.OverallDifficulty, 5)), cs = f32(num(d.CircleSize, 5)), hp = f32(num(d.HPDrainRate, 5));
    const ar = f32(num(d.ApproachRate, od));
    return { od: c(od, 0, 10), cs: bm.mode === 3 ? c(cs, 1, 18) : c(cs, 0, 10), hp: c(hp, 0, 10), ar: c(ar, 0, 10), sliderMultiplier: c(num(d.SliderMultiplier, 1.4), 0.4, 3.6) };
  }
  /** The random numbers' seed: from the drain rate, circle size, accuracy and approach rate. */
  const seedOf = D => roundEven(f32(D.hp + D.cs)) * 20 + Math.trunc(D.od * 41.2) + roundEven(D.ar);
  // (osu! reads a position from a file as whole numbers)
  const whole = ho => ({ ...ho, x: Math.trunc(ho.x), y: Math.trunc(ho.y) });

  /** lazer's column count for a convert. */
  function columnCount(bm) {
    const D = difficulty(bm), hos = bm.hitObjects;
    const roundedCS = roundEven(D.cs), roundedOD = roundEven(D.od);
    const total = hos.length, endTime = hos.filter(h => h.type & (2 | 8 | 128)).length; // (sliders, spinners and holds)
    if (total > 0) {
      const pct = endTime / total;
      if (pct < 0.2) return 7;
      if (pct < 0.3 || roundedCS >= 5) return roundedOD > 5 ? 7 : 6;
      if (pct > 0.6) return roundedOD > 4 ? 5 : 4;
    }
    return Math.max(4, Math.min(roundedOD + 1, 7));
  }

  /** What every pattern generator shares (lazer's PatternGenerator / LegacyPatternGenerator). */
  class Gen {
    constructor(cx, ho, prev) {
      this.cx = cx; this.rnd = cx.rnd; this.ho = ho; this.T = cx.T; this.prev = prev;
      this.randomStart = this.T === 8 ? 1 : 0;
    }
    snd(f) { return (this.ho.hitSound & f) !== 0; }
    getColumn(pos, allowSpecial = false) {
      if (allowSpecial && this.T === 8) return Math.min(6, Math.max(0, Math.floor(f32(f32(pos) / f32(512 / 7))))) + 1;
      return Math.min(this.T - 1, Math.max(0, Math.floor(f32(f32(pos) / f32(512 / this.T)))));
    }
    randomNoteCount(p2, p3, p4 = 0, p5 = 0, p6 = 0) {
      const v = this.rnd.nextDouble();
      if (v >= 1 - p6) return 6;
      if (v >= 1 - p5) return 5;
      if (v >= 1 - p4) return 4;
      if (v >= 1 - p3) return 3;
      return v >= 1 - p2 ? 2 : 1;
    }
    get conversionDifficulty() { return this.cx.conversionDifficulty(); }
    randomColumn(lower, upper) { return this.rnd.nextRange(lower ?? this.randomStart, upper ?? this.T); }
    findAvailable(initial, { lower, upper, next, validation, patterns = [] } = {}) {
      lower = lower ?? this.randomStart; upper = upper ?? this.T;
      next = next || (() => this.randomColumn(lower, upper));
      const valid = c => { if (validation && !validation(c)) return false; for (const p of patterns) if (p.has(c)) return false; return true; };
      if (valid(initial)) return initial;
      let any = false;
      for (let i = lower; i < upper; i++) if (valid(i)) { any = true; break; }
      if (!any) throw new NotEnoughColumns();
      do initial = next(initial); while (!valid(initial));
      return initial;
    }
  }

  class CircleGen extends Gen {
    constructor(cx, ho, prev, prevTime, prevPos, density, lastStair) {
      super(cx, ho, prev);
      this.stairType = lastStair;
      const beat = cx.cp.beatLength(ho.time), kiai = cx.cp.kiai(ho.time);
      const dx = f32(f32(ho.x) - prevPos.x), dy = f32(f32(ho.y) - prevPos.y), posSep = f32(Math.sqrt(dx * dx + dy * dy));
      const timeSep = ho.time - prevTime;
      let t = 0;
      if (timeSep <= 80) t |= T_.ForceNotStack | T_.KeepSingle;
      else if (timeSep <= 95) t |= T_.ForceNotStack | T_.KeepSingle | lastStair;
      else if (timeSep <= 105) t |= T_.ForceNotStack | T_.LowProbability;
      else if (timeSep <= 125) t |= T_.ForceNotStack;
      else if (timeSep <= 135 && posSep < 20) t |= T_.Cycle | T_.KeepSingle;
      else if (timeSep <= 150 && posSep < 20) t |= T_.ForceStack | T_.LowProbability;
      else if (posSep < 20 && density >= beat / 2.5) t |= T_.Reverse | T_.LowProbability;
      else if (density < beat / 2.5 || kiai) { /* (nothing) */ }
      else t |= T_.LowProbability;
      if (!has(t, T_.KeepSingle)) {
        if (this.snd(SND.finish) && this.T !== 8) t |= T_.Mirror;
        else if (this.snd(SND.clap)) t |= T_.Gathered;
      }
      this.type = t;
    }
    generate() {
      const p = this.core();
      for (const o of p.objs) {
        if (has(this.type, T_.Stair) && o.col === this.T - 1) this.stairType = T_.ReverseStair;
        if (has(this.type, T_.ReverseStair) && o.col === this.randomStart) this.stairType = T_.Stair;
      }
      return [p];
    }
    core() {
      const T = this.T, t = this.type, prev = this.prev, rs = this.randomStart;
      const pattern = new Pattern();
      if (T === 1) { this.add(pattern, 0); return pattern; }
      const lastColumn = prev.objs.length ? prev.objs[0].col : 0;
      if (has(t, T_.Reverse) && prev.objs.length) {
        for (let i = rs; i < T; i++) if (prev.has(i)) this.add(pattern, rs + T - i - 1);
        return pattern;
      }
      if (has(t, T_.Cycle) && prev.objs.length === 1 && (T !== 8 || lastColumn !== 0) && (T % 2 === 0 || lastColumn !== Math.trunc(T / 2))) {
        this.add(pattern, rs + T - lastColumn - 1);
        return pattern;
      }
      if (has(t, T_.ForceStack) && prev.objs.length) {
        for (let i = rs; i < T; i++) if (prev.has(i)) this.add(pattern, i);
        return pattern;
      }
      if (prev.objs.length === 1) {
        if (has(t, T_.Stair)) { let c = lastColumn + 1; if (c === T) c = rs; this.add(pattern, c); return pattern; }
        if (has(t, T_.ReverseStair)) { let c = lastColumn - 1; if (c === rs - 1) c = T - 1; this.add(pattern, c); return pattern; }
      }
      if (has(t, T_.KeepSingle)) return this.randomNotes(1);
      const cd = this.conversionDifficulty;
      if (has(t, T_.Mirror)) {
        if (cd > 6.5) return this.randomPatternMirrored(0.12, 0.38, 0.12);
        if (cd > 4) return this.randomPatternMirrored(0.12, 0.17, 0);
        return this.randomPatternMirrored(0.12, 0, 0);
      }
      const low = has(t, T_.LowProbability);
      if (cd > 6.5) return low ? this.randomPattern(0.78, 0.42, 0, 0) : this.randomPattern(1, 0.62, 0, 0);
      if (cd > 4) return low ? this.randomPattern(0.35, 0.08, 0, 0) : this.randomPattern(0.52, 0.15, 0, 0);
      if (cd > 2) return low ? this.randomPattern(0.18, 0, 0, 0) : this.randomPattern(0.45, 0, 0, 0);
      return this.randomPattern(0, 0, 0, 0);
    }
    randomNotes(noteCount) {
      const T = this.T, rs = this.randomStart, pattern = new Pattern();
      const stack = !has(this.type, T_.ForceNotStack);
      if (!stack) noteCount = Math.min(noteCount, T - rs - this.prev.columns);
      let col = this.getColumn(this.ho.x, true);
      const next = last => { if (has(this.type, T_.Gathered)) { last++; if (last === T) last = rs; } else last = this.randomColumn(); return last; };
      for (let i = 0; i < noteCount; i++) {
        col = this.findAvailable(col, { next, patterns: stack ? [pattern] : [pattern, this.prev] });
        this.add(pattern, col);
      }
      return pattern;
    }
    get specialColumn() { return this.snd(SND.clap) && this.snd(SND.finish); }
    randomPattern(p2, p3, p4, p5) {
      const pattern = new Pattern();
      pattern.addAll(this.randomNotes(this.noteCount(p2, p3, p4, p5)));
      if (this.randomStart > 0 && this.specialColumn) this.add(pattern, 0);
      return pattern;
    }
    randomPatternMirrored(centre, p2, p3) {
      if (has(this.type, T_.ForceNotStack)) return this.randomPattern(0.5 + p2 / 2, p2, (p2 + p3) / 2, p3);
      const T = this.T, rs = this.randomStart, pattern = new Pattern();
      const { count, addToCentre } = this.noteCountMirrored(centre, p2, p3);
      const limit = Math.trunc((T % 2 === 0 ? T : T - 1) / 2);
      let col = this.randomColumn(undefined, limit);
      for (let i = 0; i < count; i++) {
        col = this.findAvailable(col, { upper: limit, patterns: [pattern] });
        this.add(pattern, col);
        this.add(pattern, rs + T - col - 1);
      }
      if (addToCentre) this.add(pattern, Math.trunc(T / 2));
      if (rs > 0 && this.specialColumn) this.add(pattern, 0);
      return pattern;
    }
    noteCount(p2, p3, p4, p5) {
      switch (this.T) {
        case 2: p2 = 0; p3 = 0; p4 = 0; p5 = 0; break;
        case 3: p2 = Math.min(p2, 0.1); p3 = 0; p4 = 0; p5 = 0; break;
        case 4: p2 = Math.min(p2, 0.23); p3 = Math.min(p3, 0.04); p4 = 0; p5 = 0; break;
        case 5: p3 = Math.min(p3, 0.15); p4 = Math.min(p4, 0.03); p5 = 0; break;
      }
      if (this.snd(SND.clap)) p2 = 1;
      return this.randomNoteCount(p2, p3, p4, p5);
    }
    noteCountMirrored(centre, p2, p3) {
      switch (this.T) {
        case 2: centre = 0; p2 = 0; p3 = 0; break;
        case 3: centre = Math.min(centre, 0.03); p2 = 0; p3 = 0; break;
        case 4: centre = 0; p2 = 1 - Math.max((1 - p2) * 2, 0.8); p3 = 0; break;
        case 5: centre = Math.min(centre, 0.03); p3 = 0; break;
        case 6: centre = 0; p2 = 1 - Math.max((1 - p2) * 2, 0.5); p3 = 1 - Math.max((1 - p3) * 2, 0.85); break;
      }
      p2 = Math.min(1, Math.max(0, p2)); p3 = Math.min(1, Math.max(0, p3));
      const centreVal = this.rnd.nextDouble();
      const count = this.randomNoteCount(p2, p3);
      return { count, addToCentre: this.T % 2 !== 0 && count !== 3 && centreVal > 1 - centre };
    }
    add(pattern, col) { pattern.add({ col, time: this.ho.time, end: this.ho.time, hs: this.ho.hitSound }); }
  }

  class SliderGen extends Gen {
    constructor(cx, ho, prev) {
      super(cx, ho, prev);
      this.type = cx.cp.kiai(ho.time) ? T_.None : T_.LowProbability;
      // (lazer's GetPrecisionAdjustedBeatLength for mania: the slider velocity as osu!stable's single-precision beat length)
      const svBeat = -100 / cx.cp.sv(ho.time);
      const mult = svBeat < 0 ? Math.min(10000, Math.max(10, f32(-svBeat))) / 100 : 1;
      const beatLength = cx.cp.beatLength(ho.time) * mult;
      this.spans = Math.max(1, ho.slider ? ho.slider.slides : 1);
      this.start = roundEven(ho.time);
      const distance = ho.slider && ho.slider.length > 0 ? ho.slider.length : 0;
      // (a slider with no length has no repeats: lazer resets them, as such a slider can't be followed)
      if (!distance) this.spans = 1;
      this.end = Math.floor(this.start + distance * beatLength * this.spans * 0.01 / cx.D.sliderMultiplier);
      this.seg = Math.trunc((this.end - this.start) / this.spans);
      // each node's sounds (the head, every repeat and the tail): the slider's own, or the edge sounds the file gives
      // (a slider with no length keeps its first and last)
      const n = Math.max(1, ho.slider ? ho.slider.slides : 1) + 1, edge = ho.raw && ho.raw[8] ? String(ho.raw[8]).split('|') : [];
      const nodes = Array.from({ length: n }, (_, i) => i < edge.length ? (parseInt(edge[i], 10) || 0) : ho.hitSound);
      this.nodes = distance ? nodes : [nodes[0], nodes[n - 1]];
    }
    nodeSound(time) { const i = this.seg === 0 ? 0 : Math.trunc((time - this.start) / this.seg); return this.nodes[Math.min(this.nodes.length - 1, Math.max(0, i))]; }
    generate() {
      const p = this.core();
      if (p.objs.length === 1) return [p];
      // (the objects ending with the slider make the next pattern's "previous" on their own)
      const mid = new Pattern(), tail = new Pattern();
      for (const o of p.objs) (this.end !== roundEven(o.end) ? mid : tail).add(o);
      return [mid, tail];
    }
    core() {
      const T = this.T, cd = this.conversionDifficulty, prev = this.prev;
      if (T === 1) { const p = new Pattern(); this.add(p, 0, this.start, this.end); return p; }
      if (this.spans > 1) {
        if (this.seg <= 90) return this.randomHoldNotes(this.start, 1);
        if (this.seg <= 120) { this.type |= T_.ForceNotStack; return this.randomNotes(this.start, this.spans + 1); }
        if (this.seg <= 160) return this.stair(this.start);
        if (this.seg <= 200 && cd > 3) return this.randomMultipleNotes(this.start);
        if (this.end - this.start >= 4000) return this.nRandomNotes(this.start, 0.23, 0, 0);
        if (this.seg > 400 && this.spans < T - 1 - this.randomStart) return this.tiledHoldNotes(this.start);
        return this.holdAndNormalNotes(this.start);
      }
      if (this.seg <= 110) {
        if (prev.columns < T) this.type |= T_.ForceNotStack; else this.type &= ~T_.ForceNotStack;
        return this.randomNotes(this.start, this.seg < 80 ? 1 : 2);
      }
      const low = has(this.type, T_.LowProbability);
      if (cd > 6.5) return low ? this.nRandomNotes(this.start, 0.78, 0.3, 0) : this.nRandomNotes(this.start, 0.85, 0.36, 0.03);
      if (cd > 4) return low ? this.nRandomNotes(this.start, 0.43, 0.08, 0) : this.nRandomNotes(this.start, 0.56, 0.18, 0);
      if (cd > 2.5) return low ? this.nRandomNotes(this.start, 0.3, 0, 0) : this.nRandomNotes(this.start, 0.37, 0.08, 0);
      return low ? this.nRandomNotes(this.start, 0.17, 0, 0) : this.nRandomNotes(this.start, 0.27, 0, 0);
    }
    randomHoldNotes(start, noteCount) {
      const pattern = new Pattern(), usable = this.T - this.randomStart - this.prev.columns;
      let col = this.randomColumn();
      for (let i = 0; i < Math.min(usable, noteCount); i++) { col = this.findAvailable(col, { patterns: [pattern, this.prev] }); this.add(pattern, col, start, this.end); }
      for (let i = 0; i < noteCount - usable; i++) { col = this.findAvailable(col, { patterns: [pattern] }); this.add(pattern, col, start, this.end); }
      return pattern;
    }
    randomNotes(start, noteCount) {
      const pattern = new Pattern();
      let col = this.getColumn(this.ho.x, true);
      if (has(this.type, T_.ForceNotStack) && this.prev.columns < this.T) col = this.findAvailable(col, { patterns: [this.prev] });
      let last = col;
      for (let i = 0; i < noteCount; i++) {
        this.add(pattern, col, start, start);
        const l = last;
        col = this.findAvailable(col, { validation: c => c !== l });
        last = col;
        start += this.seg;
      }
      return pattern;
    }
    stair(start) {
      const pattern = new Pattern();
      let col = this.getColumn(this.ho.x, true), up = this.rnd.nextDouble() > 0.5;
      for (let i = 0; i <= this.spans; i++) {
        this.add(pattern, col, start, start);
        start += this.seg;
        if (up) { if (col >= this.T - 1) { up = false; col--; } else col++; }
        else if (col <= this.randomStart) { up = true; col++; } else col--;
      }
      return pattern;
    }
    randomMultipleNotes(start) {
      const T = this.T, rs = this.randomStart, pattern = new Pattern();
      const legacy = T >= 4 && T <= 8;
      const interval = this.rnd.nextRange(1, T - (legacy ? 1 : 0));
      let col = this.getColumn(this.ho.x, true);
      for (let i = 0; i <= this.spans; i++) {
        this.add(pattern, col, start, start);
        col += interval;
        if (col >= T - rs) col = col - T - rs + (legacy ? 1 : 0);
        col += rs;
        if (T > 2) this.add(pattern, col, start, start);
        col = this.randomColumn();
        start += this.seg;
      }
      return pattern;
    }
    nRandomNotes(start, p2, p3, p4) {
      switch (this.T) {
        case 2: p2 = 0; p3 = 0; p4 = 0; break;
        case 3: p2 = Math.min(p2, 0.1); p3 = 0; p4 = 0; break;
        case 4: p2 = Math.min(p2, 0.3); p3 = Math.min(p3, 0.04); p4 = 0; break;
        case 5: p2 = Math.min(p2, 0.34); p3 = Math.min(p3, 0.1); p4 = Math.min(p4, 0.03); break;
      }
      const dbl = s => (s & (SND.clap | SND.finish)) !== 0;
      if (!has(this.type, T_.LowProbability) && (dbl(this.ho.hitSound) || dbl(this.nodeSound(this.start)))) p2 = 1;
      return this.randomHoldNotes(start, this.randomNoteCount(p2, p3, p4));
    }
    tiledHoldNotes(start) {
      const pattern = new Pattern(), repeat = Math.min(this.spans, this.T), end = start + this.seg * this.spans;
      let col = this.getColumn(this.ho.x, true);
      if (has(this.type, T_.ForceNotStack) && this.prev.columns < this.T) col = this.findAvailable(col, { patterns: [this.prev] });
      for (let i = 0; i < repeat; i++) { col = this.findAvailable(col, { patterns: [pattern] }); this.add(pattern, col, start, end); start += this.seg; }
      return pattern;
    }
    holdAndNormalNotes(start) {
      const T = this.T, cd = this.conversionDifficulty, pattern = new Pattern();
      let hold = this.getColumn(this.ho.x, true);
      if (has(this.type, T_.ForceNotStack) && this.prev.columns < T) hold = this.findAvailable(hold, { patterns: [this.prev] });
      this.add(pattern, hold, start, this.end);
      let col = this.randomColumn(), count;
      if (cd > 6.5) count = this.randomNoteCount(0.63, 0);
      else if (cd > 4) count = this.randomNoteCount(T < 6 ? 0.12 : 0.45, 0);
      else if (cd > 2.5) count = this.randomNoteCount(T < 6 ? 0 : 0.24, 0);
      else count = 0;
      count = Math.min(T - 1, count);
      const ignoreHead = !(this.nodeSound(start) & (SND.whistle | SND.finish | SND.clap));
      const row = new Pattern();
      for (let i = 0; i <= this.spans; i++) {
        if (!(ignoreHead && start === this.start)) {
          for (let j = 0; j < count; j++) { col = this.findAvailable(col, { validation: c => c !== hold, patterns: [row] }); this.add(row, col, start, start); }
        }
        pattern.addAll(row); row.clear();
        start += this.seg;
      }
      return pattern;
    }
    add(pattern, col, start, end) { pattern.add({ col, time: start, end, hs: start === end ? this.nodeSound(start) : this.ho.hitSound }); }
  }

  class SpinnerGen extends Gen {
    constructor(cx, ho, prev) {
      super(cx, ho, prev);
      this.end = Math.trunc(Math.max(ho.time, ho.endTime || ho.time));
      this.type = prev.columns === this.T ? T_.None : T_.ForceNotStack;
    }
    generate() {
      const pattern = new Pattern(), hold = this.end - this.ho.time >= 100;
      let col;
      if (this.T === 8 && this.snd(SND.finish) && this.end - this.ho.time < 1000) col = 0;
      else if (this.T === 8) col = this.column();
      else col = this.column(0);
      pattern.add({ col, time: this.ho.time, end: hold ? this.end : this.ho.time, hs: this.ho.hitSound });
      return [pattern];
    }
    column(lower) {
      const c = this.randomColumn(lower);
      return has(this.type, T_.ForceNotStack) ? this.findAvailable(c, { lower, patterns: [this.prev] }) : this.findAvailable(c, { lower });
    }
  }

  /** The converted notes: [{ col, time, end, isLN, hs, sample }], as toManiaNotes gives. */
  function convert(bm) {
    const D = difficulty(bm), T = columnCount(bm), hos = bm.hitObjects;
    const seed = seedOf(D);
    const breakTime = (bm.events.breaks || []).reduce((a, b) => a + Math.max(0, b.end - b.start), 0);
    let cdCache = null;
    const cx = {
      T, D, rnd: new LegacyRandom(seed), cp: controlPoints(bm),
      conversionDifficulty() {
        if (cdCache != null) return cdCache;
        const last = hos[hos.length - 1], first = hos[0];
        let drain = Math.trunc(((last ? last.time : 0) - (first ? first.time : 0) - breakTime) / 1000);
        if (drain === 0) drain = 10000;
        const v = (f32(D.hp + Math.min(7, Math.max(4, D.ar))) / 1.5 + hos.length / drain * 9) / 38 * 5 / 1.15;
        return (cdCache = Math.min(v, 12));
      },
    };
    let lastPattern = new Pattern(), lastTime = 0, lastPos = { x: 0, y: 0 }, lastStair = T_.Stair, density = 2147483647;
    const prevTimes = [];
    const computeDensity = t => { prevTimes.push(t); if (prevTimes.length > 7) prevTimes.shift(); if (prevTimes.length >= 2) density = (prevTimes[prevTimes.length - 1] - prevTimes[0]) / prevTimes.length; };
    const record = (t, pos) => { lastTime = t; lastPos = pos; };
    const out = [];
    for (const src of hos) {
      const ho = whole(src), pos = { x: ho.x, y: ho.y };
      let gen;
      if (ho.type & 128) {
        // (a hold note stays itself, in the column its position gives: lazer's PassThroughPatternGenerator)
        const g = new Gen(cx, ho, lastPattern), end = Math.max(ho.time, ho.endTime || ho.time), p = new Pattern();
        p.add({ col: g.getColumn(ho.x), time: ho.time, end, hs: ho.hitSound });
        gen = { generate: () => [p] };
        record(end, pos); computeDensity(end);
      } else if (ho.type & 8) {
        gen = new SpinnerGen(cx, ho, lastPattern);
        record(gen.end, { x: 256, y: 192 }); computeDensity(gen.end);
      } else if (ho.type & 2) {
        gen = new SliderGen(cx, ho, lastPattern);
        for (let i = 0; i <= gen.spans; i++) { const t = ho.time + gen.seg * i; record(t, pos); computeDensity(t); }
      } else {
        computeDensity(ho.time);
        gen = new CircleGen(cx, ho, lastPattern, lastTime, lastPos, density, lastStair);
        record(ho.time, pos);
      }
      for (const p of gen.generate()) {
        if (gen instanceof CircleGen) lastStair = gen.stairType;
        if (gen instanceof CircleGen || gen instanceof SliderGen) lastPattern = p;
        for (const o of p.objs) out.push({ col: o.col, time: o.time, end: o.end > o.time ? o.end : o.time, isLN: o.end > o.time, hs: o.hs || 0, sample: [] });
      }
    }
    return { keys: T, notes: out };
  }

  /** An osu!mania map's spinners, as lazer plays them: each a hold (from 100ms long) in a column picked by the same
   *  seeded random numbers, one spinner after another. Returns a function giving each spinner's note in turn. */
  function spinners(bm, T) {
    const D = difficulty(bm), cx = { T, D, rnd: new LegacyRandom(seedOf(D)), cp: null }, none = new Pattern();
    return ho => new SpinnerGen(cx, whole(ho), none).generate()[0].objs[0];
  }

  /** How long each slider in an osu!mania map lasts (lazer's ConvertSlider): its length over its speed, once per
   *  span (0 for one with no length). */
  function sliderDurations(bm) {
    const D = difficulty(bm), cp = controlPoints(bm);
    return ho => {
      const len = ho.slider && ho.slider.length > 0 ? ho.slider.length : 0, spans = Math.max(1, ho.slider ? ho.slider.slides : 1);
      if (!len) return 0;
      const velocity = 100 * D.sliderMultiplier * cp.sv(ho.time) / cp.beatLength(ho.time);
      return spans * len / velocity;
    };
  }

  return { convert, columnCount, spinners, sliderDurations, LegacyRandom };
})();
