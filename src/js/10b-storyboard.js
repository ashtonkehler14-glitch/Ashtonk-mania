/* Storyboards, played behind the stage as osu!lazer plays them (osu! file format v14, [Events]): sprites and
 * animations on the Background, Pass, Foreground and Overlay layers, moved, faded, scaled, rotated, tinted and
 * flipped by their commands (F, M, MX, MY, S, V, R, C, P), with loops (L) and lazer's easings. The beatmap's .osb
 * (shared by its difficulties) is drawn first, then the difficulty's own lines. Hit-sound triggers (T) and sample
 * events aren't played. Drawn on a 2D canvas in the 640×480 storyboard space (854 wide for widescreen storyboards),
 * fitted to the screen's height. */

const SB_LAYERS = { Background: 0, Fail: 1, Pass: 2, Foreground: 3, Overlay: 4 };
const SB_ORIGINS = {
  TopLeft: [0, 0], Centre: [0.5, 0.5], CentreLeft: [0, 0.5], TopRight: [1, 0], BottomCentre: [0.5, 1], TopCentre: [0.5, 0],
  Custom: [0, 0], CentreRight: [1, 0.5], BottomLeft: [0, 1], BottomRight: [1, 1],
};
const SB_ORIGIN_IDS = ['TopLeft', 'Centre', 'CentreLeft', 'TopRight', 'BottomCentre', 'TopCentre', 'Custom', 'CentreRight', 'BottomLeft', 'BottomRight'];

/** osu!'s easings (Easing in osu.Framework), by number. */
const SB_EASE = (() => {
  const { PI, sin, cos, pow, sqrt } = Math;
  const outBounce = t => t < 1 / 2.75 ? 7.5625 * t * t : t < 2 / 2.75 ? 7.5625 * (t -= 1.5 / 2.75) * t + 0.75 : t < 2.5 / 2.75 ? 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375 : 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
  const io = (fin, fout) => t => t < 0.5 ? fin(t * 2) / 2 : 0.5 + fout(t * 2 - 1) / 2;
  const inQuad = t => t * t, outQuad = t => t * (2 - t), inCubic = t => t * t * t, outCubic = t => --t * t * t + 1;
  const inQuart = t => t * t * t * t, outQuart = t => 1 - --t * t * t * t, inQuint = t => t * t * t * t * t, outQuint = t => --t * t * t * t * t + 1;
  const inSine = t => 1 - cos(t * PI / 2), outSine = t => sin(t * PI / 2), inExpo = t => t ? pow(2, 10 * (t - 1)) : 0, outExpo = t => t === 1 ? 1 : 1 - pow(2, -10 * t);
  const inCirc = t => 1 - sqrt(1 - t * t), outCirc = t => sqrt(1 - --t * t);
  const inElastic = t => t === 0 || t === 1 ? t : -pow(2, 10 * (t - 1)) * sin((t - 1 - 0.075) * (2 * PI) / 0.3);
  const outElastic = t => t === 0 || t === 1 ? t : pow(2, -10 * t) * sin((t - 0.075) * (2 * PI) / 0.3) + 1;
  const outElasticHalf = t => t === 0 || t === 1 ? t : pow(2, -10 * t) * sin((0.5 * t - 0.075) * (2 * PI) / 0.3) + 1;
  const outElasticQuarter = t => t === 0 || t === 1 ? t : pow(2, -10 * t) * sin((0.25 * t - 0.075) * (2 * PI) / 0.3) + 1;
  const s = 1.70158, s2 = s * 1.525;
  const inBack = t => t * t * ((s + 1) * t - s), outBack = t => --t * t * ((s + 1) * t + s) + 1;
  const inBounce = t => 1 - outBounce(1 - t);
  const lin = t => t;
  return [lin, outQuad, inQuad, inQuad, outQuad, io(inQuad, outQuad), inCubic, outCubic, io(inCubic, outCubic), inQuart, outQuart, io(inQuart, outQuart),
    inQuint, outQuint, io(inQuint, outQuint), inSine, outSine, t => (1 - cos(PI * t)) / 2, inExpo, outExpo, io(inExpo, outExpo), inCirc, outCirc, io(inCirc, outCirc),
    inElastic, outElastic, outElasticHalf, outElasticQuarter, io(inElastic, outElastic), inBack, outBack,
    t => t < 0.5 ? (pow(2 * t, 2) * ((s2 + 1) * 2 * t - s2)) / 2 : (pow(2 * t - 2, 2) * ((s2 + 1) * (t * 2 - 2) + s2) + 2) / 2,
    inBounce, outBounce, io(inBounce, outBounce)];
})();

const Storyboard = {
  /** The image files a set's storyboard uses (lower-case paths), for import: `texts` are its .osb and .osu files. */
  files(texts) {
    const out = new Set();
    for (const text of texts) {
      const vars = this.vars(text);
      for (let line of this.eventLines(text)) {
        if (line.startsWith(' ') || line.startsWith('_')) continue;
        line = this.sub(line, vars);
        const p = this.split(line);
        const f = p[3] ? normPath(p[3].replace(/^"|"$/g, '')).toLowerCase() : '';
        if (p[0] === 'Sprite' || p[0] === '4') { if (f) out.add(f); }
        else if ((p[0] === 'Animation' || p[0] === '6') && f) {
          const n = Math.min(500, Math.max(1, parseInt(p[6], 10) || 1)), dot = f.lastIndexOf('.');
          for (let i = 0; i < n; i++) out.add(dot < 0 ? f + i : f.slice(0, dot) + i + f.slice(dot));
        }
      }
    }
    return out;
  },
  /** The [Events] section's lines (raw, keeping their indentation). */
  eventLines(text) {
    const out = [];
    let on = false;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const t = raw.trim();
      if (t.startsWith('[')) { on = t === '[Events]'; continue; }
      if (on && t && !t.startsWith('//')) out.push(raw.replace(/\s+$/, ''));
    }
    return out;
  },
  /** An .osb's [Variables] ($name=value). */
  vars(text) {
    const v = [];
    let on = false;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const t = raw.trim();
      if (t.startsWith('[')) { on = t === '[Variables]'; continue; }
      const m = on && /^(\$[^=]+)=(.*)$/.exec(t);
      if (m) v.push([m[1], m[2]]);
    }
    return v.sort((a, b) => b[0].length - a[0].length); // (longest first: $ab before $a)
  },
  sub(line, vars) { if (!vars.length || !line.includes('$')) return line; for (const [k, x] of vars) line = line.split(k).join(x); return line; },
  split(line) {
    // (commas inside a quoted file name stay in it)
    const out = []; let cur = '', q = false;
    for (const ch of line.trim()) { if (ch === '"') { q = !q; cur += ch; } else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur);
    return out.map(x => x.trim());
  },

  /** Every sprite of these texts (the .osb, then the .osu), its commands expanded (loops unrolled) and sorted. */
  parse(texts) {
    const sprites = [];
    let budget = 400000; // commands, all told (a storyboard past this is cut short rather than freeze the game)
    for (const text of texts) {
      if (!text) continue;
      const vars = this.vars(text);
      let cur = null, loop = null;
      for (let raw of this.eventLines(text)) {
        raw = this.sub(raw, vars);
        const depth = /^[ _]+/.exec(raw)?.[0].length || 0;
        const p = this.split(raw);
        if (!depth) {
          loop = null; cur = null;
          const type = p[0];
          if (type === 'Sprite' || type === '4' || type === 'Animation' || type === '6') {
            const layer = SB_LAYERS[p[1]] ?? (Number.isFinite(+p[1]) ? +p[1] : -1);
            if (layer < 0 || layer === SB_LAYERS.Fail) { cur = { skip: true }; continue; } // (the Fail layer: only shown while failing in stable)
            const origin = SB_ORIGINS[p[2]] || SB_ORIGINS[SB_ORIGIN_IDS[+p[2]]] || SB_ORIGINS.TopLeft;
            const file = normPath(String(p[3] || '').replace(/^"|"$/g, ''));
            cur = { layer, origin, file, x: +p[4] || 0, y: +p[5] || 0, cmds: [], anim: null, order: sprites.length };
            if (type === 'Animation' || type === '6') cur.anim = { frames: Math.max(1, parseInt(p[6], 10) || 1), delay: Math.max(1, +p[7] || 16), once: p[8] === 'LoopOnce' || p[8] === '1' };
            sprites.push(cur);
          }
          continue;
        }
        if (!cur || cur.skip || budget <= 0) continue;
        const c = p[0];
        if (depth === 1 && c === 'L') { loop = { start: +p[1] || 0, count: Math.max(1, parseInt(p[2], 10) || 1), cmds: [] }; (cur.loops ||= []).push(loop); continue; }
        if (depth === 1 && c === 'T') { loop = { trigger: true, cmds: [] }; continue; } // (hit-sound triggers aren't played)
        if (depth === 1) loop = null;
        const list = depth >= 2 && loop ? loop.cmds : depth === 1 ? cur.cmds : null;
        if (!list) continue;
        budget -= this.command(list, p);
      }
    }
    // loops unrolled (lazer's CommandLoop: each pass offset by the length of its commands)
    for (const s of sprites) {
      for (const l of s.loops || []) {
        if (l.trigger || !l.cmds.length) continue;
        const a = Math.min(...l.cmds.map(c => c.s)), b = Math.max(...l.cmds.map(c => c.e)), dur = b - a;
        const n = dur > 0 ? Math.min(l.count, 4000) : 1;
        for (let i = 0; i < n && budget > 0; i++) for (const c of l.cmds) { s.cmds.push({ ...c, s: c.s + l.start + i * dur, e: c.e + l.start + i * dur }); budget--; }
      }
      delete s.loops;
      this.finish(s);
    }
    return sprites.filter(s => s.start != null);
  },
  /** One command line into `list`: chained values become one command each (osu!'s shorthand). Returns how many. */
  command(list, p) {
    const type = p[0], ease = SB_EASE[+p[1]] || SB_EASE[0], s0 = +p[2] || 0, e0 = p[3] === '' || p[3] == null ? s0 : +p[3];
    const v = p.slice(4);
    const n = { F: 1, M: 2, MX: 1, MY: 1, S: 1, V: 2, R: 1, C: 3, P: 1 }[type];
    if (!n || !v.length) return 0;
    if (type === 'P') { list.push({ t: 'P', ease, s: s0, e: e0, a: v[0], b: v[0] }); return 1; }
    const nums = v.map(Number);
    const sets = Math.max(1, Math.floor(nums.length / n));
    const dur = e0 - s0;
    let made = 0;
    // (a single set: the value holds; two or more: each next one tweens from the one before, each as long as the first)
    if (sets === 1) { const a = nums.slice(0, n); list.push({ t: type, ease, s: s0, e: e0, a, b: a }); return 1; }
    for (let i = 0; i < sets - 1; i++) {
      const a = nums.slice(i * n, i * n + n), b = nums.slice((i + 1) * n, (i + 1) * n + n);
      list.push({ t: type, ease, s: s0 + i * dur, e: e0 + i * dur, a, b }); made++;
    }
    return made;
  },
  /** A sprite's commands grouped by what they change, each sorted; its lifetime from its first to its last. */
  finish(s) {
    if (!s.cmds.length) return;
    const by = {};
    let start = Infinity, end = -Infinity;
    for (const c of s.cmds) {
      if (c.t !== 'P') { start = Math.min(start, c.s); end = Math.max(end, c.e); }
      // (lazer's X and Y timelines: M moves both, MX / MY one each)
      if (c.t === 'M') { (by.X ||= []).push({ ...c, a: [c.a[0]], b: [c.b[0]] }); (by.Y ||= []).push({ ...c, a: [c.a[1]], b: [c.b[1]] }); }
      else if (c.t === 'MX') (by.X ||= []).push(c);
      else if (c.t === 'MY') (by.Y ||= []).push(c);
      else (by[c.t] ||= []).push(c);
    }
    for (const k in by) by[k].sort((a, b) => a.s - b.s);
    if (!Number.isFinite(start)) return;
    s.by = by; s.start = start; s.end = end; delete s.cmds;
  },
  /** A value at time t from a property's sorted commands (osu!: before the first, its start value; between and
   *  after, the last one's end value). */
  value(list, t) {
    const n = list[0].a.length, out = new Array(n);
    for (let j = 0; j < n; j++) out[j] = Storyboard.num(list, t, j);
    return out;
  },
  /** The last command started by t (-1: none yet). Each timeline remembers where it was, so a frame only steps a
   *  little from the last one instead of searching a long (looped) list. */
  seek(list, t) {
    let i = list._i || 0;
    if (i >= list.length) i = list.length - 1;
    while (i > 0 && list[i].s > t) i--;
    while (i + 1 < list.length && list[i + 1].s <= t) i++;
    list._i = i;
    return list[i].s <= t ? i : -1;
  },
  /** One component (j) of a timeline's value at t, as a number. */
  num(list, t, j = 0) {
    const i = Storyboard.seek(list, t);
    if (i < 0) return list[0].a[j];
    const c = list[i];
    if (t >= c.e || c.e === c.s) return c.b[j];
    return c.a[j] + (c.b[j] - c.a[j]) * c.ease((t - c.s) / (c.e - c.s));
  },
};

/** Plays a parsed storyboard onto a canvas, frame by frame. */
class StoryboardPlayer {
  constructor(sprites, images, { widescreen = false } = {}) {
    this.images = images; // lower-case path → ImageBitmap / HTMLImageElement
    this.widescreen = widescreen;
    // (drawn layer by layer, each in file order)
    this.sprites = sprites.filter(s => s.layer !== SB_LAYERS.Fail).sort((a, b) => a.layer - b.layer || a.order - b.order);
    this.byStart = [...this.sprites].sort((a, b) => a.start - b.start);
    this.end = 0; for (const s of this.sprites) if (s.end > this.end) this.end = s.end; // (when the last sprite's done: the outro's end)
    this.reset();
    this.tints = new Map();
  }
  reset() { this.next = 0; this.active = []; this.lastT = -Infinity; }
  img(path) { return this.images.get(path.toLowerCase()) || null; }
  frameFile(s, t) {
    if (!s.anim) return s.file;
    const a = s.anim;
    let i = Math.floor((t - s.start) / a.delay);
    i = a.once ? Math.min(Math.max(0, i), a.frames - 1) : ((i % a.frames) + a.frames) % a.frames;
    const dot = s.file.lastIndexOf('.');
    return dot < 0 ? s.file + i : s.file.slice(0, dot) + i + s.file.slice(dot);
  }
  /** A tinted copy of an image (C), kept: colours rounded to steps of 8 so a fading colour doesn't make thousands. */
  tinted(img, r, g, b) {
    const key = `${(r >> 3)},${(g >> 3)},${(b >> 3)}`;
    let m = this.tints.get(img);
    if (!m) { m = new Map(); this.tints.set(img, m); }
    let c = m.get(key);
    if (c) return c;
    if (m.size > 48) m.delete(m.keys().next().value);
    c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(img, 0, 0);
    m.set(key, c);
    return c;
  }
  draw(ctx, t, W, H) {
    if (t < this.lastT - 1) this.reset(); // (went back: a seek or a retry)
    this.lastT = t;
    // the sprites that have started (and not ended)
    let added = false;
    while (this.next < this.byStart.length && this.byStart[this.next].start <= t) { this.active.push(this.byStart[this.next++]); added = true; }
    if (this.active.length) this.active = this.active.filter(s => s.end >= t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!this.active.length) return;
    const k = H / 480, cx = W / 2, cy = H / 2;
    if (!this.widescreen) { ctx.save(); ctx.beginPath(); ctx.rect(cx - 320 * k, 0, 640 * k, H); ctx.clip(); }
    // (in layer and file order: the active ones, sorted the way they're kept)
    // (sorted only when new ones started: removing ended ones keeps the order)
    if (added && this.active.length > 1) this.active.sort((a, b) => a.layer - b.layer || a.order - b.order);
    const act = this.active;
    const N = Storyboard.num;
    for (const s of act) {
      const by = s.by;
      const op = by.F ? N(by.F, t) : 1;
      if (op <= 0.001) continue;
      const x = by.X ? N(by.X, t) : s.x, y = by.Y ? N(by.Y, t) : s.y;
      let sx = 1, sy = 1;
      if (by.S) sx = sy = N(by.S, t);
      if (by.V) { sx *= N(by.V, t, 0); sy *= N(by.V, t, 1); }
      if (!sx || !sy) continue;
      const rot = by.R ? N(by.R, t) : 0;
      let flipH = false, flipV = false, add = false;
      if (by.P) for (const c of by.P) if (c.s === c.e ? t >= c.s : t >= c.s && t <= c.e) { if (c.a === 'H') flipH = true; else if (c.a === 'V') flipV = true; else if (c.a === 'A') add = true; }
      let img = this.img(this.frameFile(s, t));
      if (!img) continue;
      if (by.C) { const r = Math.round(N(by.C, t, 0)), g = Math.round(N(by.C, t, 1)), b = Math.round(N(by.C, t, 2)); if (r < 250 || g < 250 || b < 250) img = this.tinted(img, Math.max(0, r), Math.max(0, g), Math.max(0, b)); }
      const fx = flipH ? -1 : 1, fy = flipV ? -1 : 1;
      const cos = Math.cos(rot), sin = Math.sin(rot), a = sx * k * fx, d = sy * k * fy;
      ctx.setTransform(cos * a, sin * a, -sin * d, cos * d, cx + (x - 320) * k, cy + (y - 240) * k);
      ctx.globalAlpha = Math.min(1, op);
      ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
      // (the origin flips with the sprite, as in lazer)
      ctx.drawImage(img, -s.origin[0] * img.width, -s.origin[1] * img.height);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (!this.widescreen) ctx.restore();
  }
}
