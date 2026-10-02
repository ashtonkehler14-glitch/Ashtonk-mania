/* Renderer — Canvas 2D mania stage renderer driven by the TimingEngine clock.
 * All skin geometry is expressed in osu! "480-space" units and scaled by (canvas height / 480),
 * matching how skin.ini [Mania] values are authored. Nothing here decides judgements. */

class ScrollMap {
  constructor(segs) { this.segs = segs; this.i = 0; }
  pos(t) {
    const s = this.segs;
    let i = this.i;
    if (i >= s.length) i = s.length - 1;
    if (t < s[i].time) { i = bsearchLE(s, t, 'time'); if (i < 0) i = 0; }
    else while (i + 1 < s.length && s[i + 1].time <= t) i++;
    this.i = i;
    const g = s[i];
    return g.pos + (t - g.time) * g.vel;
  }
  /** Stateless variant (does not disturb the cached cursor). */
  posAt(t) { let i = bsearchLE(this.segs, t, 'time'); if (i < 0) i = 0; const g = this.segs[i]; return g.pos + (t - g.time) * g.vel; }
  velAt(t) { let i = bsearchLE(this.segs, t, 'time'); if (i < 0) i = 0; return this.segs[i].vel; }
}

/** The visible (not fully transparent) part of an image, in its own pixels — worked out once per image. Skin textures
 *  are often mostly empty padding, and only this part is worth drawing. null: the pixels can't be read. */
const _visibleBoxes = new WeakMap();
function visibleBox(img) {
  let b = _visibleBoxes.get(img);
  if (b !== undefined) return b;
  b = null;
  try {
    const W = img.width, H = img.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = new Uint32Array(x.getImageData(0, 0, W, H).data.buffer);
    // (the alpha byte of each pixel: the top byte on little-endian machines, the bottom one otherwise)
    const shift = new Uint8Array(new Uint32Array([0xff000000]).buffer)[3] === 0xff ? 24 : 0;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0, i = 0; y < H; y++) {
      for (let xx = 0; xx < W; xx++, i++) {
        if (!((d[i] >>> shift) & 255)) continue;
        if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; y1 = y;
      }
    }
    b = x1 < 0 ? { empty: true } : { x0, y0, x1: x1 + 1, y1: y1 + 1, W, H };
  } catch (e) { b = null; }
  _visibleBoxes.set(img, b);
  return b;
}

class ManiaRenderer {
  /** crop: size the canvas to just the stage (plus room for the health bar / key display) instead of the whole
   *  screen, so each frame clears, fills and composites far fewer pixels. The canvas's parent is the screen. */
  constructor(canvas, { crop = false } = {}) {
    this.canvas = canvas;
    this.crop = crop; this.cropX = 0;
    this._spr = new WeakMap(); this._crop = new WeakMap(); this._tx = 0; this._noteRefW = 0;
    if (crop && typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      // cache the screen size instead of reading clientWidth every frame (that can force a layout)
      this._ro = new ResizeObserver(es => { const r = es[es.length - 1].contentRect; this._hostW = r.width; this._hostH = r.height; });
      this._ro.observe(canvas.parentElement);
    }
    // (desynchronized canvases can skip vsync and tear — a torn note looks like a stutter — so low latency is opt-in)
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: !!Settings.get('graphics.lowLatency') });
    this.layout = null;
    this.effects = [];          // lighting + particles
    this.judgementFx = null;
    this.comboBump = 0;
    this.lastCombo = 0;
    this.keyLight = [];         // release time per column for stage light fade
    this.fontCache = new Map();
    this.healthMode = 'stage';  // 'stage' | 'skin' | null (drawn by the HUD instead)
  }
  setLayout(layout) {
    this.layout = layout;
    this._spr = new WeakMap(); this._crop = new WeakMap(); this._noteRefW = 0;
    this.keyLight = new Array(layout.keys).fill(-1e9);
    this.effects = []; this.judgementFx = null; this._lastN = []; this._pN = 0; this._missFx = [];
    this.resize(true);
  }
  dispose() { if (this._ro) this._ro.disconnect(); this._ro = null; }
  /** Distance a note scrolls during one "time range" (scroll speed): osu!lazer scales the time range with the skin's
   *  hit position, so on screen the speed is the same whatever the HitPosition — 402 of 480 units, the default. */
  get scrollLength() { return this.layout && this.layout.wom && this.hitY ? this.hitY : 402 * (this.s || this.H / 480 || 1); }
  resize(force = false) {
    const c = this.canvas;
    // (autoScale: lowered by gameplay when this device can't keep up — see GameplayScreen.adaptResolution)
    const dpr = Zoom.dpr() * Settings.get('graphics.renderScale') * (this.autoScale || 1);
    if (this.crop) {
      const host = c.parentElement;
      const cw = this._hostW ?? (host ? host.clientWidth : c.clientWidth), ch = this._hostH ?? (host ? host.clientHeight : c.clientHeight);
      const w = Math.max(1, Math.round(cw * dpr)), hh = Math.max(1, Math.round(ch * dpr));
      if (!force && w === this.W && hh === this.H && dpr === this._dpr) return;
      this._dpr = dpr; this.W = w; this.H = hh;
      this._geom();
      let x0 = 0, x1 = w;
      if (this.layout && Number.isFinite(this.stageX)) {
        // (a Web-Osu-Mania skin's judgements can be wider than its stage)
        const extra = this.layout.wom ? Math.max(0, 200 * this.womD - this.stageW / 2) : 0;
        x0 = clamp(Math.floor(this.stageX - 40 * this.s - extra), 0, w - 1);
        x1 = clamp(Math.ceil(this.stageX + this.stageW + 72 * this.s + extra), x0 + 1, w);
      }
      this.cropX = x0;
      c.width = x1 - x0; c.height = hh;
      c.style.left = (x0 / dpr) + 'px'; c.style.right = 'auto'; c.style.width = ((x1 - x0) / dpr) + 'px';
      return;
    }
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), hh = Math.max(1, Math.round(c.clientHeight * dpr));
    if (!force && w === c.width && hh === c.height) return;
    c.width = w; c.height = hh;
    this.W = w; this.H = hh;
    this._geom();
  }
  _geom() {
    this._spr = new WeakMap(); this._crop = new WeakMap(); this._noteRefW = 0; // sizes change: drop the pre-scaled sprites
    const L = this.layout;
    if (!L) return;
    const s = this.H / 480;
    this.s = s;
    // osu!stable/lazer size legacy skin textures in a 768-unit-tall space (POSITION_SCALE_FACTOR 1.6):
    // a texture pixel is H/768 screen pixels, while column widths/positions are in 480-space.
    this.u = this.H / 768;
    this.legacy = !L.skin.builtin;
    const lw = Settings.get('gameplay.laneWidth');
    this.colW = L.columnWidth.map(w => w * s * lw);
    this.colX = [];
    let x = 0;
    for (let i = 0; i < L.keys; i++) {
      this.colX.push(x);
      x += this.colW[i] + (i < L.keys - 1 ? ((L.columnSpacing[i] || 0) + Settings.get('gameplay.laneSpacing')) * s * lw : 0);
    }
    this.stageW = x;
    // fill styles, built once per layout / settings change instead of every frame
    const op = Settings.get('gameplay.stageOpacity');
    this._colFill = L.colours.column.slice(0, L.keys).map(c => rgba(c, op));
    while (this._colFill.length < L.keys) this._colFill.push('transparent');
    const dim = Settings.get('skin.dim');
    this._dimFill = dim > 0 ? `rgba(0,0,0,${dim})` : null;
    this._lineFill = rgba(L.colours.columnLine, 0.5);
    this._hasLines = L.columnLineWidth.some(w => w > 0);
    this._bands = null;
    const pos = Settings.get('gameplay.stagePosition');
    this.stageX = pos === 'skin' ? L.columnStart * s * (this.W / this.H > 4 / 3 ? 1 : 1)
      : pos === 'left' ? this.W * 0.12 : pos === 'right' ? this.W * 0.88 - this.stageW : (this.W - this.stageW) / 2;
    this.stageX += Settings.get('gameplay.stageOffset') / 100 * this.W;
    this.hitY = clamp((clamp(L.hitPosition, 240, 480) + Settings.get('gameplay.hitPositionOffset')) * s, 40 * s, this.H - 4);
    this.up = Settings.get('gameplay.scrollDirection') === 'up' || L.upsideDown;
    // what gets drawn upside down in upscroll (osu!: keys and notes unless the skin says otherwise; lights always)
    const F = L.flip || {}, f = (a, i) => this.up && (!a || a[i] !== false);
    this.fl = { key: [], keyD: [], note: [], head: [], body: [], tail: [] };
    for (let i = 0; i < L.keys; i++) {
      this.fl.key.push(f(F.key, i)); this.fl.keyD.push(f(F.keyD, i)); this.fl.note.push(f(F.note, i));
      this.fl.head.push(f(F.head, i)); this.fl.body.push(f(F.body, i));
      // a tail cap is authored flipped in downscroll; mirrored for upscroll it's flipped once more (unless not flipping)
      this.fl.tail.push(this.up ? !f(F.tail, i) : true);
    }
    if (L.wom) { this._geomWom(); return; }
    this.prewarm();
  }
  /** Builds every pre-scaled sprite the stage draws (notes, keys, stage light, and hit / hold lighting at each of its
   *  sizes) as soon as the sizes are known, while the loader is up. They used to be built the first time each one
   *  showed up mid-song — 3 to 13 ms apiece, so the first hits of a map dropped frames. */
  prewarm() {
    const L = this.layout;
    if (!L || !this.colW) return;
    const s = this.s, K = L.keys, frames = t => t ? t.frames : [];
    const effects = Settings.get('skin.effects'), lighting = Settings.get('gameplay.hitLighting');
    try {
      for (let c = 0; c < K; c++) {
        const w = this.colW[c], texN = L.tex.note[c], texH = L.tex.noteH[c], texT = L.tex.noteT[c];
        if (texN) { const nh = this._noteH(texN, c); for (const f of frames(texN)) this._sprite(f, w, nh, this.fl.note[c]); }
        if (texH) { const hh = this._noteH(texH, c); for (const f of frames(texH)) this._sprite(f, w, hh, this.fl.head[c]); }
        if (texT) { const th = this._noteH(texT, c); for (const f of frames(texT)) this._sprite(f, w, th, this.fl.tail[c]); }
        for (const [t, flip] of [[L.tex.key[c], this.fl.key[c]], [L.tex.keyD[c], this.fl.keyD[c]]]) {
          if (!t) continue;
          if (this.legacy && !t.fromDefault) this._cropSprite(t.img, w, t.h * this.u * (L.keyScale || 1), flip);
          else this._sprite(t.img, w, t.h * (w / t.w), flip);
        }
        const sl = L.tinted.stageLight[c];
        if (sl && effects) { const h = sl.h * (this.legacy ? this.u : s); for (const f of frames(sl)) this._cropSprite(f, w, h, this.up); }
        if (!lighting) continue;
        const tl = L.tinted.lightingL[c];
        if (tl) { const lw = this._lightW(tl, c, L.lightingLWidth), hh = tl.h * (lw / tl.w); for (const f of frames(tl)) this._cropSprite(f, lw, hh, this.up); }
        const tn = L.tinted.lightingN[c];
        if (tn) {
          const w0 = this._lightW(tn, c, L.lightingNWidth), multi = tn.frames.length > 1;
          for (let k = 0; k <= (multi ? 0 : 4); k++) { const sc = 1 + k / 16; for (const f of frames(tn)) this._cropSprite(f, w0 * sc, tn.h * (w0 / tn.w) * sc, this.up); }
        }
      }
    } catch (e) { console.warn('sprite prewarm', e); } // (drawn on demand instead)
  }
  /** Map a down-scroll rect to the actual direction and draw an image. */
  _img(img, x, yTop, w, h, flipY = false) {
    if (!img || w <= 0 || h <= 0) return;
    if (this.up) yTop = this.H - yTop - h;
    if (flipY) {
      const c = this.ctx;
      c.save(); c.translate(x, yTop + h); c.scale(1, -1); c.drawImage(img, 0, 0, w, h); c.restore();
      return;
    }
    this.ctx.drawImage(img, x, yTop, w, h);
  }
  _rect(x, yTop, w, h) { if (this.up) yTop = this.H - yTop - h; this.ctx.fillRect(x, yTop, w, h); }
  _noteH(tex, i) {
    const L = this.layout;
    if (!tex) return 0;
    // note height follows the narrowest column (or WidthForNoteHeightScale) so every column's notes match
    const w = this._noteRefW || (this._noteRefW = L.widthForNoteHeightScale > 0 ? L.widthForNoteHeightScale * this.s * Settings.get('gameplay.laneWidth') : Math.min(...this.colW));
    return tex.h * (w / tex.w);
  }
  /** A copy of `img` pre-scaled to exactly w×h device pixels (optionally flipped), cached per image and size.
   *  Drawing it 1:1 at a whole-pixel position is much cheaper than resampling the texture for every note. */
  _sprite(img, w, h, flip) {
    const W = Math.max(1, Math.round(w)), Hh = Math.max(1, Math.round(h));
    let m = this._spr.get(img);
    if (!m) { m = new Map(); this._spr.set(img, m); }
    const key = W * 16384 + Hh * 2 + (flip ? 1 : 0);
    let c = m.get(key);
    if (!c) {
      c = document.createElement('canvas'); c.width = W; c.height = Hh;
      const x = c.getContext('2d');
      if (flip) { x.translate(0, Hh); x.scale(1, -1); }
      x.drawImage(img, 0, 0, W, Hh);
      m.set(key, c);
      if (m.size > 24) m.delete(m.keys().next().value);
    }
    return c;
  }
  /** A pre-scaled sprite cropped to its visible pixels: skin textures are often mostly empty padding (Kori's
   *  lighting is 92–97% fully transparent, its keys 89–91%), and blending those empty pixels every frame was most of
   *  the canvas's raster time. Returns { c, dx, dy }: the cropped canvas and where it sits inside the w×h sprite. */
  _cropSprite(img, w, h, flip = false) {
    const W = Math.max(1, Math.round(w)), Hh = Math.max(1, Math.round(h));
    let cache = this._crop.get(img);
    if (!cache) { cache = new Map(); this._crop.set(img, cache); }
    const key = W * 16384 + Hh * 2 + (flip ? 1 : 0);
    let m = cache.get(key);
    if (m) return m;
    const b = visibleBox(img);
    if (!b) m = { c: this._sprite(img, w, h, flip), dx: 0, dy: 0 }; // unreadable: drawn uncropped
    else if (b.empty) m = { c: null, dx: 0, dy: 0 };                // nothing visible
    else {
      // the image's visible box, scaled to this size (a pixel of margin for the filtering at its edges)
      const sx = W / b.W, sy = Hh / b.H;
      const x0 = Math.max(0, Math.floor(b.x0 * sx) - 1), x1 = Math.min(W, Math.ceil(b.x1 * sx) + 1);
      let y0 = Math.max(0, Math.floor(b.y0 * sy) - 1), y1 = Math.min(Hh, Math.ceil(b.y1 * sy) + 1);
      if (flip) { const t = Hh - y1; y1 = Hh - y0; y0 = t; }
      const c = document.createElement('canvas'); c.width = Math.max(1, x1 - x0); c.height = Math.max(1, y1 - y0);
      const x = c.getContext('2d');
      if (flip) { x.translate(-x0, Hh - y0); x.scale(1, -1); } else x.translate(-x0, -y0);
      x.drawImage(img, 0, 0, W, Hh);
      m = { c, dx: x0, dy: y0 };
    }
    cache.set(key, m);
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    return m;
  }
  _cropImg(img, x, yTop, w, h, flipY = false) {
    if (!img || w <= 0 || h <= 0) return;
    if (this.up) yTop = this.H - yTop - h;
    const tx = this._tx, m = this._cropSprite(img, w, h, flipY);
    if (m.c) this.ctx.drawImage(m.c, Math.round(x + tx) - tx + m.dx, Math.round(yTop) + m.dy);
  }
  /** Like _img for fixed-size textures (notes, keys): drawn from a pre-scaled sprite, snapped to whole pixels. */
  _spriteImg(img, x, yTop, w, h, flipY = false) {
    if (!img || w <= 0 || h <= 0) return;
    if (this.up) yTop = this.H - yTop - h;
    const tx = this._tx; // translation from stage space to device pixels
    this.ctx.drawImage(this._sprite(img, w, h, flipY), Math.round(x + tx) - tx, Math.round(yTop));
  }
  /** A moving note: like _spriteImg, but only snapped across (its column never moves). Down the lane it keeps its
   *  exact sub-pixel position, so it travels the same distance every frame instead of stepping by whole pixels —
   *  which showed as uneven motion, most of all when the playfield is drawn below full resolution. */
  _noteImg(img, x, yTop, w, h, flipY = false) {
    if (!img || w <= 0 || h <= 0) return;
    if (this.up) yTop = this.H - yTop - h;
    const tx = this._tx;
    this.ctx.drawImage(this._sprite(img, w, h, flipY), Math.round(x + tx) - tx, yTop);
  }

  /** Render a frame. g: {now, posNow, scroll:ScrollMap, pxPerMs, engine, held[], hidden:'HD'|'FI'|null, realNow} */
  render(g) {
    const L = this.layout;
    if (!L) return;
    this.resize();
    if (L.wom) { this._renderWom(g); return; }
    const ctx = this.ctx, s = this.s, K = L.keys, H = this.H;
    const realNow = g.realNow ?? performance.now();
    ctx.setTransform(1, 0, 0, 1, -this.cropX, 0);
    ctx.clearRect(this.cropX, 0, this.canvas.width, H);
    ctx.save();
    ctx.translate(this.stageX, 0);
    this._tx = this.stageX - this.cropX;

    // column backgrounds, snapped to whole device pixels: adjacent columns then share an exact edge instead of
    // two anti-aliased half-covered pixels, which let the background show through as thin vertical seams
    const sx = this.stageX;
    for (let i = 0; i < K; i++) {
      const x0 = Math.round(sx + this.colX[i]) - sx, x1 = Math.round(sx + this.colX[i] + this.colW[i]) - sx;
      ctx.fillStyle = this._colFill[i];
      ctx.fillRect(x0, 0, x1 - x0, H);
    }
    if (this._dimFill) { ctx.fillStyle = this._dimFill; ctx.fillRect(0, 0, this.stageW, H); }
    // column lines
    if (this._hasLines) {
      ctx.fillStyle = this._lineFill;
      for (let i = 0; i <= K; i++) {
        const w = (L.columnLineWidth[i] || 0) * s * 0.5;
        if (w <= 0) continue;
        const x = i < K ? this.colX[i] : this.stageW;
        ctx.fillRect(x - w / 2, 0, w, this.hitY);
      }
    }
    // note y for a scroll position: hitY + noteOffset - (pos - posNow) * pxPerMs
    this._y0 = this.hitY + Settings.get('gameplay.noteOffset') * s + g.posNow * g.pxPerMs;
    // stage light (key press glow)
    if (Settings.get('skin.effects')) {
      for (let i = 0; i < K; i++) {
        const t = L.tinted.stageLight[i];
        if (!t) continue;
        let a = 0;
        if (g.held[i]) a = 1; else { const dt = Math.max(0, realNow - this.keyLight[i]); if (dt < 120) a = 1 - dt / 120; }
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        const h = t.h * (this.legacy ? this.u : s);
        const bottom = (L.lightPosition + Settings.get('gameplay.hitPositionOffset')) * s;
        this._cropImg(t.frameAt(realNow), this.colX[i], bottom - h, this.colW[i], h, this.up);
        ctx.globalAlpha = 1;
      }
    }
    // stage hint
    if (L.tex.stageHint) {
      const t = L.tex.stageHint, h = t.h * (this.legacy ? this.u : s);
      this._img(t.img, 0, this.hitY - h / 2, this.stageW, h, this.up);
    }
    if (L.keysUnderNotes) this._drawKeys(g);

    // notes
    if (g.engine) this._drawNotes(g, realNow);

    if (L.judgementLine) {
      ctx.fillStyle = rgba(L.colours.judgementLine, 0.9);
      this._rect(0, this.hitY - Math.max(1, s * 0.5), this.stageW, Math.max(1, s * 0.5));
    }
    if (!L.keysUnderNotes) this._drawKeys(g);
    // stage sides / bottom
    const us = this.legacy ? this.u : s;
    if (L.tex.stageLeft) { const t = L.tex.stageLeft, w = t.w * us; ctx.drawImage(t.img, -w, 0, w, H); }
    if (L.tex.stageRight) { const t = L.tex.stageRight, w = t.w * us; ctx.drawImage(t.img, this.stageW, 0, w, H); }
    if (L.tex.stageBottom) {
      const t = L.tex.stageBottom, w = t.w * us, h = t.h * us;
      this._img(t.img, (this.stageW - w) / 2, H - h, w, h, this.up);
    }
    // lighting
    if (Settings.get('gameplay.hitLighting')) this._drawLighting(g, realNow);
    this._drawParticles(realNow);
    // judgement & combo
    if (g.engine) {
      this._drawJudgement(realNow);
      this._drawCombo(g.engine.score.combo, realNow);
    }
    ctx.restore();
    if (g.engine) {
      // (the osu!lazer-style bar is part of the HUD, not the canvas)
      if (this.healthMode === 'stage') this._drawHealth(g.engine.health.value);
      else if (this.healthMode === 'skinstage') this._drawSkinHealth(g.engine.health.value);
      if (Settings.get('input.keyOverlay')) this._drawKeyOverlay(g);
    }
  }
  _drawKeys(g) {
    const L = this.layout, K = L.keys, H = this.H;
    for (let i = 0; i < K; i++) {
      const down = g.held[i] && L.tex.keyD[i];
      const t = down ? L.tex.keyD[i] : L.tex.key[i];
      if (!t) continue;
      const flip = down ? this.fl.keyD[i] : this.fl.key[i];
      if (this.legacy && !t.fromDefault) {
        // legacy keys: stretched to the column width, authored height kept (anchored to the bottom)
        // (a 4K skin played at more keys shrinks its keys about the hit position, as its columns shrank)
        const ks = L.keyScale || 1, h = t.h * this.u * ks;
        this._cropImg(t.img, this.colX[i], this.hitY + (H - this.hitY) * ks - h, this.colW[i], h, flip);
      } else {
        // built-in keys: drawn at their own proportions (tall enough to reach the screen edge), the receptor
        // (t.anchor down the texture) centred on the notes as they're hit
        const h = t.h * (this.colW[i] / t.w);
        const nh = this._noteH(L.tex.note[i], i);
        const top = this.hitY - nh / 2 - h * (t.anchor ?? 0.25);
        this._spriteImg(t.img, this.colX[i], top, this.colW[i], h, flip);
      }
    }
  }

  /** Hidden / Fade In lane cover: `coverage` is the fraction of the lane (above the receptors) that is covered. */
  _noteAlpha(y, hidden) {
    if (!hidden) return 1;
    const f = y / this.hitY, c = clamp(this.coverage ?? 0.5, 0.1, 0.9), fade = 0.12;
    if (hidden === 'HD') return clamp((1 - c - f) / fade + 1, 0, 1);
    return clamp((f - c) / fade, 0, 1);
  }

  /** Hidden / Fade In for long notes: the note is drawn once per horizontal band of the lane, each band clipped
   *  and given that band's opacity, so the covered part of the lane hides the body too (one opacity for the
   *  whole note let a visible head drag its body through the cover). */
  _coverBands(hidden) {
    const hY = this.hitY, c = clamp(this.coverage ?? 0.5, 0.1, 0.9), fade = 0.12, steps = 10, out = [];
    const r0 = (hidden === 'HD' ? 1 - c : c) * hY, r1 = r0 + fade * hY;
    for (let k = 0; k < steps; k++) {
      const a = (k + 0.5) / steps;
      out.push([r0 + (r1 - r0) * k / steps, r0 + (r1 - r0) * (k + 1) / steps, hidden === 'HD' ? 1 - a : a]);
    }
    if (hidden === 'HD') out.unshift([-1e6, r0, 1]); else out.push([r1, 1e6, 1]);
    return out;
  }
  _drawNotes(g, realNow) {
    const L = this.layout, ctx = this.ctx, eng = g.engine, K = L.keys, sc = g.scroll;
    const top = -this.H * 0.1, y0 = this._y0, ppm = g.pxPerMs;
    let bands = null;
    if (g.hidden) {
      const b = this._bands, cov = this.coverage ?? 0.5;
      bands = b && b.h === g.hidden && b.c === cov && b.y === this.hitY ? b.list : (this._bands = { h: g.hidden, c: cov, y: this.hitY, list: this._coverBands(g.hidden) }).list;
    }
    for (let c = 0; c < K; c++) {
      const col = eng.columns[c];
      const x = this.colX[c], w = this.colW[c];
      const texN = L.tex.note[c], texH = L.tex.noteH[c], texL = L.tex.noteL[c], texT = L.tex.noteT[c];
      const nh = texN ? this._noteH(texN, c) : 0;
      for (let i = eng.ptr[c]; i < col.length; i++) {
        const n = col[i];
        if (n.state === NS.DONE || (n.state === NS.MISSED && !n.isLN)) continue;
        // scroll positions don't change during a play: computed once per note
        if (n._sc !== sc) { n._sc = sc; n._hp = sc.pos(n.time); n._tp = n.isLN ? sc.posAt(g.percy ? Math.max(n.time, n.end - g.percy) : n.end) : 0; }
        let yHead = y0 - n._hp * ppm;
        if (yHead < top && !n.isLN) break;
        if (n.isLN) {
          const yTail = y0 - n._tp * ppm;
          if (yTail > this.H + 50 && n.state !== NS.HOLDING) continue;
          if (yHead < top && yTail < top) break;
          if (n.state === NS.HOLDING) yHead = Math.min(yHead, this.hitY);
          const mult = n.state === NS.DROPPED || n.state === NS.MISSED ? 0.45 : 1;
          if (!bands) { ctx.globalAlpha = mult; this._drawLN(c, x, w, yHead, yTail, realNow); ctx.globalAlpha = 1; continue; }
          const n0 = yTail - (texT ? this._noteH(texT, c) : 0), n1 = yHead;
          for (const [b0, b1, a] of bands) {
            const lo = Math.max(b0, n0), hi = Math.min(b1, n1);
            if (hi <= lo || a <= 0) continue;
            ctx.save();
            ctx.beginPath(); ctx.rect(x - 1, this.up ? this.H - b1 : b0, w + 2, b1 - b0); ctx.clip();
            ctx.globalAlpha = a * mult; this._drawLN(c, x, w, yHead, yTail, realNow);
            ctx.restore();
          }
        } else {
          if (yHead > this.H + 60) continue;
          const a = this._noteAlpha(yHead, g.hidden) * (n.state === NS.MISSED ? 0.5 : 1);
          if (a <= 0) continue;
          ctx.globalAlpha = a;
          if (texN) this._noteImg(texN.frameAt(realNow), x, yHead - nh, w, nh, this.fl.note[c]);
          ctx.globalAlpha = 1;
        }
      }
    }
    // missed notes fading out (lazer: FadeOut(150, Easing.In))
    const mf = this._missFx;
    if (mf && mf.length) {
      let keep = 0;
      for (let i = 0; i < mf.length; i++) {
        const f = mf[i], el = Math.max(0, realNow - f.t0);
        if (el >= 150 || f.n.col >= K) continue;
        mf[keep++] = f;
        const n = f.n, c = n.col, texN = L.tex.note[c];
        if (!texN) continue;
        if (n._sc !== sc) { n._sc = sc; n._hp = sc.pos(n.time); n._tp = 0; }
        const y = y0 - n._hp * ppm, nh = this._noteH(texN, c);
        if (y - nh > this.H) continue;
        const k = el / 150;
        ctx.globalAlpha = (1 - k * k) * this._noteAlpha(y, g.hidden) * 0.9;
        this._noteImg(texN.frameAt(realNow), this.colX[c], y - nh, this.colW[c], nh, this.fl.note[c]);
      }
      mf.length = keep;
      ctx.globalAlpha = 1;
    }
  }
  /** A long note: the body runs from the head's centre to the tail's centre; the tail cap is drawn flipped over the
   *  body end in down-scroll (legacy skins author tails as "caps" that round the body off). */
  _drawLN(c, x, w, yHead, yTail, realNow) {
    const L = this.layout, texN = L.tex.note[c], texH = L.tex.noteH[c], texL = L.tex.noteL[c], texT = L.tex.noteT[c];
    const hh = this._noteH(texH || texN, c);
    const th = texT ? this._noteH(texT, c) : 0;
    const bodyTop = yTail - th / 2, bodyBottom = yHead - hh / 2;
    // (the body lines up exactly with the head and tail sprites: same whole-pixel column edges)
    const bx = Math.round(x + this._tx) - this._tx, bw = Math.max(1, Math.round(w));
    if (texL && bodyBottom > bodyTop) this._drawBody(texL, bx, bw, bodyTop, bodyBottom, L.noteBodyStyle[c], realNow, this.fl.body[c]);
    if (texT && yTail - th < yHead - hh / 2) this._noteImg(texT.frameAt(realNow), x, yTail - th, w, th, this.fl.tail[c]);
    if (texH || texN) this._noteImg((texH || texN).frameAt(realNow), x, yHead - hh, w, hh, texH ? this.fl.head[c] : this.fl.note[c]);
  }
  _drawBody(tex, x, w, top, bottom, style, realNow, flip = false) {
    const img = tex.frameAt(realNow);
    const len = bottom - top;
    if (style === 0) { this._img(img, x, top, w, len, flip); return; }
    const th = Math.max(2, tex.h * (w / tex.w));
    const ctx = this.ctx;
    ctx.save();
    const clipY = this.up ? this.H - bottom : top;
    ctx.beginPath(); ctx.rect(x, clipY, w, len); ctx.clip();
    if (style === 2) { for (let y = bottom - th; y > top - th; y -= th) this._img(img, x, y, w, th, flip); }
    else { for (let y = top; y < bottom; y += th) this._img(img, x, y, w, th, flip); }
    ctx.restore();
  }

  // ── Web-Osu-Mania skins (MIT © 2024 Danny Duong): its stage, drawn the way its PixiJS game draws it — sizes in
  //    the window's CSS pixels (columns from its 854-wide lane widths × the window width, at least 1528), the hit
  //    position 130 px above the bottom, a #111 stage at 50% between two grey side lines, receptors under the hit
  //    line, notes tinted in the column colours, its judgement images and a Roboto Mono combo.
  _geomWom() {
    const L = this.layout, K = L.keys, st = k => Settings.get(`wom.${k}`);
    // window CSS px → canvas px
    const d = this.womD = (window.devicePixelRatio || 1) * Settings.get('graphics.renderScale') * (this.autoScale || 1);
    const Wc = this.W / d;
    let cw = (WOM.LANE_WIDTHS[K - 1] + st('laneWidthAdjustment')) / 854 * Math.max(Wc, 1528) * Settings.get('gameplay.laneWidth');
    if (cw * K > Wc) cw = Wc / K;
    const sp = st('laneSpacing');
    const notesW = Math.min(K * cw + sp * (K - 1), Wc);
    this.colW = []; this.colX = [];
    for (let i = 0; i < K; i++) { this.colX.push(i * (cw + sp) * d); this.colW.push(cw * d); }
    this.stageW = notesW * d;
    const outer = notesW + 4, off = st('stagePosition') * (Wc - outer) / 2;
    this.stageX = (Wc / 2 + off - outer / 2 + 2) * d;
    this.hitY = this.H - st('hitPositionOffset') * d;
    this.up = Settings.get('gameplay.scrollDirection') === 'up';
    this.womCol = WOM.colors(K);
    this.womArrow = WOM.ARROWS[K - 1] || [];
    this.womNS = st('noteScale');
    this._womSpr = new Map();
    if (!WOM._font) { try { WOM._font = new FontFace('WomRobotoMono', 'url(wom/RobotoMono.ttf)', { weight: '100 900' }); document.fonts.add(WOM._font); WOM._font.load().catch(() => {}); } catch { WOM._font = true; } }
  }
  /** A tinted white shape (or WOM's arrow image) drawn once at its size and cached: tap and head sprites. */
  _womSprite(kind, color, size, dark) {
    const key = `${kind}|${color}|${size | 0}|${dark ? 1 : 0}`;
    let c = this._womSpr.get(key);
    if (c !== undefined) return c;
    const d = this.womD, pad = Math.ceil(4 * d), n = Math.ceil(size) + pad * 2;
    let img = null;
    if (kind === 'arrows' || kind === 'thickArrows' || kind === 'arrowOutline' || kind === 'thickArrowOutline') {
      img = WOM.image({ arrows: 'arrow.svg', thickArrows: 'arrowThick.svg', arrowOutline: 'arrowOutline.svg', thickArrowOutline: 'arrowThickOutline.svg' }[kind]);
      if (!img) return null; // (not loaded yet: try again next frame, uncached)
    }
    c = document.createElement('canvas'); c.width = n; c.height = n;
    const x = c.getContext('2d'), m = n / 2;
    x.fillStyle = color;
    if (kind === 'circles') { x.beginPath(); x.arc(m, m, size / 2, 0, Math.PI * 2); x.fill(); }
    else if (kind === 'diamonds') { const r = size / Math.SQRT2; x.translate(m, m); x.rotate(Math.PI / 4); x.beginPath(); x.roundRect(-r / 2, -r / 2, r, r, 8 * d); x.fill(); }
    else { x.drawImage(img, pad, pad, size, size); if (color !== '#fff') { x.globalCompositeOperation = 'source-in'; x.fillRect(0, 0, n, n); } }
    if (dark) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(0, 0, n, n); }
    this._womSpr.set(key, c);
    return c;
  }
  /** Draws a cached sprite centred on (cx, y) in down-scroll coordinates, turned by `deg`. Arrows keep pointing the
   *  same way in upscroll (WOM flips them back); everything else mirrors with the stage. */
  _womBlit(spr, cx, y, deg = 0) {
    if (!spr) return;
    const ctx = this.ctx, yy = this.up ? this.H - y : y;
    if (!deg) { ctx.drawImage(spr, cx - spr.width / 2, yy - spr.height / 2); return; }
    ctx.save(); ctx.translate(cx, yy); ctx.rotate(deg * Math.PI / 180); ctx.drawImage(spr, -spr.width / 2, -spr.height / 2); ctx.restore();
  }
  _womRect(x, y, w, h) { this.ctx.fillRect(x, this.up ? this.H - y - h : y, w, h); }
  _womDark(c) { const m = this._womDk || (this._womDk = new Map()); let v = m.get(c); if (!v) { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = c; const hex = x.fillStyle; const n = parseInt(hex.slice(1), 16); v = `rgb(${(n >> 16 & 255) >> 1},${(n >> 8 & 255) >> 1},${(n & 255) >> 1})`; m.set(c, v); } return v; }
  _renderWom(g) {
    const L = this.layout, ctx = this.ctx, K = L.keys, H = this.H, d = this.womD, st = k => Settings.get(`wom.${k}`);
    const realNow = g.realNow ?? performance.now();
    const style = L.wom.style, ns = this.womNS, cols = this.womCol, ro = st('receptorOpacity'), lit = st('receptorLighting');
    ctx.setTransform(1, 0, 0, 1, -this.cropX, 0);
    ctx.clearRect(this.cropX, 0, this.canvas.width, H);
    ctx.save();
    ctx.translate(this.stageX, 0);
    this._tx = this.stageX - this.cropX;
    // stage sides: 2 px, grey up to 40% of the height, fading out towards the top (flipped in upscroll)
    const so = st('stageSidesOpacity');
    if (so > 0) {
      const gr = this._womSides && this._womSides.H === H && this._womSides.up === this.up ? this._womSides.g : null;
      const grad = gr || ctx.createLinearGradient(0, this.up ? 0 : H, 0, this.up ? H : 0);
      if (!gr) { grad.addColorStop(0.4, 'rgba(128,128,128,1)'); grad.addColorStop(1, 'rgba(128,128,128,0)'); this._womSides = { H, up: this.up, g: grad }; }
      ctx.globalAlpha = so; ctx.fillStyle = grad;
      ctx.fillRect(-2 * d, 0, 2 * d, H); ctx.fillRect(this.stageW, 0, 2 * d, H);
      ctx.globalAlpha = 1;
    }
    // stage background
    ctx.globalAlpha = st('stageOpacity'); ctx.fillStyle = '#111111'; ctx.fillRect(0, 0, this.stageW, H); ctx.globalAlpha = 1;
    const dim = Settings.get('skin.dim'); if (dim > 0) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, this.stageW, H); }
    // stage lights: 35% of the screen tall, the column colour fading upwards; 50% while held, then 0.3 s out
    if (lit && Settings.get('skin.effects')) {
      const lh = H * 0.35;
      for (let i = 0; i < K; i++) {
        let a = 0;
        if (g.held[i]) a = 1; else { const t = (realNow - this.keyLight[i]) / 300; if (t >= 0 && t < 1) a = (1 - t) * (1 - t); }
        if (a <= 0) continue;
        const gk = `l${i}|${lh | 0}|${this.up}`;
        let grad = (this._womLg || (this._womLg = new Map())).get(gk);
        if (!grad) {
          const y0 = this.up ? H - this.hitY : this.hitY, y1 = this.up ? y0 + lh : y0 - lh;
          grad = ctx.createLinearGradient(0, y0, 0, y1); grad.addColorStop(0, cols[i].tap); grad.addColorStop(1, 'rgba(255,255,255,0)');
          this._womLg.set(gk, grad);
        }
        ctx.globalAlpha = 0.5 * ro * a; ctx.fillStyle = grad;
        this._womRect(this.colX[i], this.hitY - lh, this.colW[i], lh);
      }
      ctx.globalAlpha = 1;
    }
    // stage hint: a 10 px #ccc line across the stage at the hit position
    ctx.globalAlpha = ro; ctx.fillStyle = '#cccccc'; this._womRect(0, this.hitY - 5 * d, this.stageW, 10 * d);
    // receptors
    const ms = this.colW[0] * ns;
    for (let i = 0; i < K; i++) {
      const cx = this.colX[i] + this.colW[i] / 2, on = lit && g.held[i];
      if (style === 'bars') {
        ctx.fillStyle = '#1a1a1a'; this._womRect(this.colX[i], this.hitY, this.colW[i], H - this.hitY);
        ctx.fillStyle = on ? cols[i].tap : '#4d4d4d';
        ctx.save(); ctx.translate(cx, this.up ? H - this.hitY - 40 * d : this.hitY + 40 * d); ctx.rotate(this.up ? -Math.PI / 4 * 3 : Math.PI / 4);
        ctx.beginPath(); ctx.roundRect(-5 * d, -5 * d, 40 * d, 40 * d, 5 * d); ctx.fill(); ctx.restore();
      } else if (style === 'circles' || style === 'diamonds') {
        const yy = this.up ? H - this.hitY : this.hitY;
        ctx.save(); ctx.translate(cx, yy); ctx.strokeStyle = '#b3b3b3'; ctx.lineWidth = 4 * d; ctx.beginPath();
        if (style === 'circles') ctx.arc(0, 0, ms / 2, 0, Math.PI * 2);
        else { const r = ms / Math.SQRT2; ctx.rotate(Math.PI / 4); ctx.roundRect(-r / 2, -r / 2, r, r, 8 * d); }
        ctx.stroke(); ctx.restore();
        if (on) { ctx.globalAlpha = 0.7 * ro; this._womBlit(this._womSprite(style, '#fff', ms), cx, this.hitY); ctx.globalAlpha = ro; }
      } else {
        const ang = this.womArrow[i] || 0, out = style === 'arrows' ? 'arrowOutline' : 'thickArrowOutline';
        this._womBlit(this._womSprite(out, '#fff', ms), cx, this.hitY, ang);
        if (on) { ctx.globalAlpha = 0.7 * ro; this._womBlit(this._womSprite(style, '#fff', ms), cx, this.hitY, ang); ctx.globalAlpha = ro; }
      }
    }
    ctx.globalAlpha = 1;
    this._y0 = this.hitY + (st('noteOffset') * d) + Settings.get('gameplay.noteOffset') * this.s + g.posNow * g.pxPerMs;
    if (g.engine) this._drawWomNotes(g);
    ctx.restore();
    if (g.engine) {
      this._drawWomJudgement(realNow); this._drawWomCombo(g.engine.score.combo);
      ctx.setTransform(1, 0, 0, 1, -this.cropX, 0);
      if (this.healthMode === 'stage') this._drawHealth(g.engine.health.value);
      if (Settings.get('input.keyOverlay')) this._drawKeyOverlay(g);
    }
  }
  /** Notes and holds, as WOM's Tap and Hold sprites. */
  _drawWomNotes(g) {
    const L = this.layout, ctx = this.ctx, eng = g.engine, K = L.keys, sc = g.scroll, d = this.womD;
    const style = L.wom.style, ns = this.womNS, cols = this.womCol, y0 = this._y0, ppm = g.pxPerMs, top = -this.H * 0.1;
    const arrow = style === 'arrows' || style === 'thickArrows';
    const darkHold = Settings.get('wom.darkerHolds') || Settings.get('wom.colorMode') === 'custom';
    for (let c = 0; c < K; c++) {
      const col = eng.columns[c], x = this.colX[c], w = this.colW[c], cx = x + w / 2, ms = w * ns, C = cols[c];
      const ang = arrow ? (this.womArrow[c] || 0) : 0; // (WOM flips arrows back in upscroll: they point the same way)
      const tap = (color, y, dark) => {
        if (style === 'bars') { ctx.fillStyle = dark ? this._womDark(color) : color; this._womRect(x, y - w * 0.4, w, w * 0.4); }
        else this._womBlit(this._womSprite(style, color, ms, dark), cx, y, ang);
      };
      for (let i = eng.ptr[c]; i < col.length; i++) {
        const n = col[i];
        if (n.state === NS.DONE || (n.state === NS.MISSED && !n.isLN)) continue;
        if (n._sc !== sc) { n._sc = sc; n._hp = sc.pos(n.time); n._tp = n.isLN ? sc.posAt(g.percy ? Math.max(n.time, n.end - g.percy) : n.end) : 0; }
        let yHead = y0 - n._hp * ppm;
        if (yHead < top && !n.isLN) break;
        if (!n.isLN) {
          if (yHead > this.H + 60) continue;
          ctx.globalAlpha = this._noteAlpha(yHead, g.hidden);
          if (ctx.globalAlpha > 0) tap(C.tap, yHead);
          ctx.globalAlpha = 1;
          continue;
        }
        const yTail = y0 - n._tp * ppm;
        if (yTail > this.H + 50 && n.state !== NS.HOLDING) continue;
        if (yHead < top && yTail < top) break;
        const broken = n.state === NS.DROPPED || n.state === NS.MISSED;
        if (n.state === NS.HOLDING) yHead = Math.min(yHead, this.hitY);
        const hold = broken ? this._womDark(C.hold) : C.hold, len = Math.max(0, yHead - yTail);
        ctx.globalAlpha = this._noteAlpha(Math.max(yTail, Math.min(yHead, this.hitY)), g.hidden);
        if (ctx.globalAlpha <= 0) { ctx.globalAlpha = 1; continue; }
        if (style === 'bars') {
          ctx.fillStyle = hold; this._womRect(x, yTail, w, len);
          if (darkHold) { this._womRect(x, yTail - w * 0.4, w, w * 0.4); ctx.fillStyle = broken ? this._womDark(C.holdHead) : C.holdHead; this._womRect(x, yHead - w * 0.4, w, w * 0.4); }
        } else {
          const bw = style === 'circles' ? ms : ms * (style === 'thickArrows' ? 0.85 : 0.6);
          ctx.fillStyle = hold; this._womRect(cx - bw / 2, yTail, bw, len);
          if (style === 'circles') this._womBlit(this._womSprite('circles', C.hold, ms, broken), cx, yTail);
          else {
            // the tail: a triangle on the far end of the body
            const ty = this.up ? this.H - yTail : yTail, dir = this.up ? 1 : -1;
            ctx.beginPath(); ctx.moveTo(cx - bw / 2, ty); ctx.lineTo(cx, ty + dir * bw / 2); ctx.lineTo(cx + bw / 2, ty); ctx.closePath(); ctx.fill();
          }
          this._womBlit(this._womSprite(style, C.holdHead, ms, broken), cx, yHead, ang);
        }
        // the head note itself until it's hit (WOM's hold head is a tap of its own)
        if (n.state === NS.PENDING) tap(C.holdHead, y0 - n._hp * ppm);
        ctx.globalAlpha = 1;
      }
    }
  }
  /** WOM's judgement: the set's image at its scale, popping from 1.2× over 0.3 s, gone 0.8 s later over 0.3 s; "Early"
   *  / "Late" above it for 200s and below (WOM's default). */
  _drawWomJudgement(realNow) {
    const fx = this.judgementFx;
    if (!fx) return;
    const el = Math.max(0, realNow - fx.t0);
    if (el > 1100) { this.judgementFx = null; return; }
    const set = Settings.get('wom.judgements'), id = ['300g', '300', '200', '100', '50', '0'][fx.j];
    const img = WOM.image(`judgements-${set}/mania-hit${fx.j === J.MARV && !Settings.get('gameplay.showMax') ? '300' : id}.png`);
    if (!img) return;
    const ctx = this.ctx, d = this.womD, hy = Settings.get('wom.hudY');
    const p = Math.min(1, el / 300), ease = 1 - (1 - p) * (1 - p);
    const k = WOM.judgementScale(set) * (1.2 - 0.2 * ease) * d * Settings.get('skin.scale');
    const cx = this._tx + this.stageW / 2, y = this.up ? this.H * hy - 50 * d : this.H * (1 - hy);
    ctx.globalAlpha = el > 800 ? 1 - (el - 800) / 300 : 1;
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(img, cx - w / 2, y - h / 2, w, h);
    const thr = Settings.get('wom.earlyLate'), score = [320, 300, 200, 100, 50, 0][fx.j];
    if (fx.err != null && fx.j !== J.MISS && thr >= 0 && score <= thr && fx.err !== 0) {
      const sz = 20 * d * (el < 300 ? 1.1 - 0.1 * ease : 1);
      ctx.font = `400 ${sz}px WomRobotoMono, "Roboto Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha *= 0.5; ctx.fillStyle = fx.err < 0 ? '#26de63' : '#de8826';
      ctx.fillText(fx.err < 0 ? 'Early' : 'Late', cx, y - 30 * d);
    }
    ctx.globalAlpha = 1;
  }
  _drawWomCombo(combo) {
    if (combo < 1) return;
    const ctx = this.ctx, d = this.womD, hy = Settings.get('wom.hudY');
    const cx = this._tx + this.stageW / 2, y = this.up ? this.H * hy : this.H * (1 - hy) + 50 * d;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `800 ${30 * d}px WomRobotoMono, "Roboto Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#dddddd'; ctx.fillText(String(combo), cx, y);
  }

  // ── effects
  onJudgement(e, realNow) {
    const L = this.layout;
    if (!L) return;
    // osu!lazer: a missed note keeps scrolling while it fades out over 150 ms instead of vanishing
    if (e.j === J.MISS && !e.note.isLN) (this._missFx || (this._missFx = [])).push({ n: e.note, t0: realNow });
    // culling: a new hit light replaces the column's previous one (dense streams used to stack them)
    if (e.j !== J.MISS && Settings.get('gameplay.hitLighting') && (!e.note.isLN || e.tail)) {
      const fx = { type: 'N', col: e.col, t0: realNow };
      (this._lastN || (this._lastN = []))[e.col] = fx;
      this.effects.push(fx);
    }
    if (L.wom) { if (Settings.get('gameplay.showJudgements')) this.judgementFx = { j: e.j, t0: realNow, err: e.err }; return; }
    if (Settings.get('gameplay.showJudgements') && (e.j !== J.MARV || Settings.get('gameplay.showMax'))) {
      const thr = Settings.get('gameplay.earlyLate');
      const el = thr > 0 && e.err != null && e.j !== J.MARV && Math.abs(e.err) >= thr ? (e.err < 0 ? 'EARLY' : 'LATE') : null;
      this.judgementFx = { j: e.j, t0: realNow, el };
    }
    if (Settings.get('graphics.particles') && e.j <= J.GREAT) {
      // at most ~96 particles alive at once, however dense the chart
      const n = Math.min(e.j === J.MARV ? 7 : 4, Math.max(0, 96 - (this._pN || 0)));
      this._pN = (this._pN || 0) + n;
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const sp = (0.25 + Math.random() * 0.45) * this.s;
        this.effects.push({ type: 'P', col: e.col, t0: realNow, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          color: rgba(L.colours.light[e.col]), life: 380 + Math.random() * 200 });
      }
    }
  }
  onRelease(col, realNow) { this.keyLight[col] = realNow; }

  /** Hit and hold lighting, drawn additively. Every frame comes from a pre-scaled sprite: resampling these big
   *  textures on every frame was over half of the canvas's raster time on devices that draw it in software. */
  _drawLighting(g, realNow) {
    const L = this.layout, ctx = this.ctx, s = this.s;
    ctx.globalCompositeOperation = 'lighter';
    // hold lighting
    const eng = g.engine;
    if (eng) for (let c = 0; c < L.keys; c++) {
      if (!eng.holding[c]) continue;
      const t = L.tinted.lightingL[c];
      if (!t) continue;
      const w = this._lightW(t, c, L.lightingLWidth), hh = t.h * (w / t.w);
      const cx = this.colX[c] + this.colW[c] / 2;
      this._cropImg(t.frameAt(realNow), cx - w / 2, this._lightY(c) - hh / 2, w, hh, this.up);
    }
    // hit lighting (effects are compacted in place: no new array every frame)
    let keep = 0;
    const fx = this.effects;
    for (let i = 0; i < fx.length; i++) {
      const e = fx[i];
      if (e.type !== 'N') { fx[keep++] = e; continue; }
      if (this._lastN && this._lastN[e.col] !== e) continue; // superseded by a newer hit in this column
      const t = L.tinted.lightingN[e.col];
      if (!t) continue;
      const el = Math.max(0, realNow - e.t0);
      const multi = t.frames.length > 1;
      const dur = multi ? t.frames.length / t.fps * 1000 : 180;
      if (el > dur) continue;
      const w0 = this._lightW(t, e.col, L.lightingNWidth);
      const sc = multi ? 1 : 1 + Math.round(el / dur * 4) / 16; // (grows in 1/16 steps: each size is cached)
      const w = w0 * sc, hh = t.h * (w0 / t.w) * sc;
      ctx.globalAlpha = multi ? 1 : 1 - el / dur;
      const cx = this.colX[e.col] + this.colW[e.col] / 2;
      this._cropImg(t.frameAt(el, false), cx - w / 2, this._lightY(e.col) - hh / 2, w, hh, this.up);
      ctx.globalAlpha = 1;
      fx[keep++] = e;
    }
    fx.length = keep;
    ctx.globalCompositeOperation = 'source-over';
  }
  /** Where lighting is centred: the hit position for legacy skins (as lazer does), the middle of the built-in
   *  skin's receptor (half a note above the hit position) otherwise. In upscroll it's drawn upside down like the rest
   *  of the stage (as stable does): skins often draw the flash off-centre to sit on their receptor. */
  _lightY(c) { return this.legacy ? this.hitY : this.hitY - this._noteH(this.layout.tex.note[c], c) / 2; }
  /** Hit/hold lighting width. Legacy skins follow lazer: texture size × (LightingNWidth or column width) / 30. */
  _lightW(t, c, widths) {
    const L = this.layout;
    if (this.legacy) {
      const cw = widths[c] > 0 ? widths[c] : L.columnWidth[c] * Settings.get('gameplay.laneWidth');
      return t.w * this.u * cw / 30;
    }
    return widths[c] > 0 ? widths[c] * this.s : this.colW[c] * 1.7; // built-in: the flash reaches a little past its column
  }
  _drawParticles(realNow) {
    const ctx = this.ctx;
    const fx = this.effects;
    let keep = 0;
    for (let i = 0; i < fx.length; i++) {
      const e = fx[i];
      if (e.type !== 'P') { fx[keep++] = e; continue; }
      const el = Math.max(0, realNow - e.t0);
      if (el > e.life) continue;
      const x = this.colX[e.col] + this.colW[e.col] / 2 + e.vx * el;
      let y = this.hitY + e.vy * el + 0.0006 * this.s * el * el;
      if (this.up) y = this.H - y;
      ctx.globalAlpha = 1 - el / e.life;
      ctx.fillStyle = e.color;
      const r = (e.star ? 3.2 : 2) * this.s * 0.5 * (1 - el / e.life * 0.5);
      if (e.star) {
        ctx.beginPath();
        for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + el / 200, rr = k % 2 ? r * 0.4 : r * 1.6; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        ctx.fill();
      } else ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      fx[keep++] = e;
    }
    fx.length = keep;
    this._pN = 0; for (let i = 0; i < keep; i++) if (fx[i].type === 'P') this._pN++;
  }
  _drawJudgement(realNow) {
    const fx = this.judgementFx;
    if (!fx) return;
    const L = this.layout, el = Math.max(0, realNow - fx.t0);
    const t = L.judgement[JUDGEMENTS[fx.j].id];
    if (!t) return;
    const total = t.frames.length > 1 ? Math.max(t.frames.length / t.fps * 1000, 300) : 360;
    if (el > total) { this.judgementFx = null; return; }
    const sk = Settings.get('skin.scale');
    const pop = t.frames.length > 1 ? 1 : (el < 60 ? 1.1 - 0.1 * (el / 60) : 1);
    const k = (this.legacy ? this.u : this.s * 0.8) * 0.6 * sk * pop;
    const w = t.w * k, hh = t.h * k;
    const y = L.scorePosition * this.s;
    this.ctx.globalAlpha = el > total - 100 ? (total - el) / 100 : 1;
    this._img(t.frameAt(el, false), this.stageW / 2 - w / 2, y - hh / 2, w, hh);
    if (fx.el) {
      const ctx = this.ctx, size = Math.round(6.5 * this.s);
      ctx.font = `900 ${size}px Torus, Outfit, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const yy = this.up ? this.H - (y + hh / 2 + size) : y + hh / 2 + size * 0.9;
      ctx.lineWidth = Math.max(2, size / 5); ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(fx.el, this.stageW / 2, yy);
      ctx.fillStyle = fx.el === 'EARLY' ? '#6cc6ff' : '#ff8a6c'; ctx.fillText(fx.el, this.stageW / 2, yy);
    }
    this.ctx.globalAlpha = 1;
  }
  _drawCombo(combo, realNow) {
    if (combo !== this.lastCombo) { if (combo > this.lastCombo) this.comboBump = realNow; this.lastCombo = combo; }
    if (combo < 2) return;
    const L = this.layout, ctx = this.ctx, s = this.s;
    const el = Math.max(0, realNow - this.comboBump);
    const bump = Settings.get('gameplay.comboEffects') && el < 90 ? 1 + 0.12 * (1 - el / 90) : 1;
    const y = L.comboPosition * s;
    const cx = this.stageW / 2;
    const sk = Settings.get('skin.scale');
    const text = String(combo);
    if (L.font) {
      const glyphs = text.split('').map(ch => L.font.glyphs[ch]).filter(Boolean);
      const hh = glyphs[0].h * (this.legacy ? this.u : s * 0.8) * sk * bump;
      const widths = glyphs.map(gl => gl.w * (hh / gl.h));
      const ov = L.font.overlap * (this.legacy ? this.u : s * 0.8) * sk;
      const total = widths.reduce((a, b) => a + b, 0) - ov * (glyphs.length - 1);
      let x = cx - total / 2;
      glyphs.forEach((gl, k) => { this._img(gl.img, x, y - hh / 2, widths[k], hh); x += widths[k] - ov; });
      return;
    }
    const size = Math.round(26 * s * sk * bump);
    ctx.font = `800 ${size}px Torus, Outfit, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const yy = this.up ? this.H - y : y;
    ctx.lineWidth = Math.max(2, size / 8); ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.strokeText(text, cx, yy);
    const milestone = Settings.get('gameplay.comboEffects') && combo % 100 === 0;
    ctx.fillStyle = milestone ? '#ffd54a' : (this.layout.skin.builtin ? '#efe6ff' : '#fff');
    ctx.fillText(text, cx, yy);
  }
  /** Health: a slim bar beside the stage running from near the top down to the bottom of the screen.
   *  The value eases smoothly, glows in the accent colour and turns red (with a gentle pulse) when low. */
  _drawHealth(v) {
    const ctx = this.ctx, s = this.s, now = performance.now();
    const dt = Math.min(100, now - (this._hpT || now)); this._hpT = now;
    this._hp = this._hp == null ? v : this._hp + (v - this._hp) * Math.min(1, dt / 120);
    const hp = clamp(this._hp, 0, 1);
    const w = Math.max(4, 3.4 * s), x = this.stageX + this.stageW + 5 * s, top = this.H * 0.06, bottom = this.H;
    const len = bottom - top, r = w / 2;
    const bar = (y0, y1) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y0, w, y1 - y0, [r, r, 0, 0]) : ctx.rect(x, y0, w, y1 - y0); ctx.fill(); };
    // track
    ctx.fillStyle = 'rgba(255,255,255,.08)'; bar(top, bottom);
    if (hp <= 0) return;
    const low = hp < 0.3;
    const y = bottom - len * hp;
    const accent = this._hpAccent || (this._hpAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff66ab');
    const c1 = low ? '#ff5a6e' : accent, c2 = low ? '#ff9a6e' : '#ffffff';
    const pulse = low ? 0.55 + 0.45 * Math.abs(Math.sin(now / 220)) : 1;
    // soft glow (a wider translucent bar is much cheaper than shadowBlur)
    ctx.globalAlpha = 0.18 * pulse; ctx.fillStyle = c1;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w, y - w, w * 3, bottom - y + w, [w * 1.5, w * 1.5, 0, 0]) : ctx.rect(x - w, y - w, w * 3, bottom - y + w); ctx.fill();
    ctx.globalAlpha = 1;
    const grd = ctx.createLinearGradient(0, y, 0, bottom);
    grd.addColorStop(0, c2); grd.addColorStop(0.08, c1); grd.addColorStop(1, c1);
    ctx.fillStyle = grd; bar(y, bottom);
    // bright head
    ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.9 * pulse;
    ctx.beginPath(); ctx.arc(x + r, y + r, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  /** The skin's scorebar, as osu!stable draws it in mania: turned upright beside the stage, filling upwards. */
  _drawSkinHealth(v) {
    const L = this.layout, col = L.tex.scorebarColour, bg = L.tex.scorebarBg;
    if (!col) return;
    const ctx = this.ctx, now = performance.now();
    const dt = Math.min(100, now - (this._hpT || now)); this._hpT = now;
    this._hp = this._hp == null ? v : this._hp + (v - this._hp) * Math.min(1, dt / 120);
    const hp = clamp(this._hp, 0, 1);
    const ref = bg || col;
    // screen px per skin px: the bar spans most of the height at most, and stays inside the room beside the stage
    const k = Math.min(this.s, this.H * 0.94 / ref.w, 66 * this.s / ref.h);
    ctx.save();
    ctx.translate(Math.round(this.stageX + this.stageW + 2 * this.s), this.H);
    ctx.rotate(-Math.PI / 2);
    if (bg) ctx.drawImage(bg.img, 0, 0, bg.w * k, bg.h * k);
    // fill offset inside the background (osu!: 4.8,16 for old-style skins, 12,12.5 with a scorebar-marker)
    const [ox, oy] = !bg ? [0, 0] : L.scorebarNewStyle ? [12, 12.5] : [4.8, 16];
    if (hp > 0) {
      const f = col.frameAt(now);
      ctx.drawImage(f, 0, 0, f.width * hp, f.height, ox * k, oy * k, col.w * k * hp, col.h * k);
    }
    ctx.restore();
  }
  _drawKeyOverlay(g) {
    const ctx = this.ctx, s = this.s, K = this.layout.keys;
    const size = 14 * s, gap = 2 * s;
    const x0 = this.stageX + this.stageW + 14 * s, y0 = this.H * 0.5;
    ctx.font = `700 ${Math.round(size * 0.36)}px Torus, Outfit, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < K; i++) {
      const y = y0 + i * (size + gap);
      ctx.fillStyle = g.held[i] ? rgba(this.layout.colours.light[i], 0.85) : 'rgba(20,12,34,.75)';
      ctx.fillRect(x0, y, size * 2.2, size);
      ctx.fillStyle = g.held[i] ? '#000' : '#ddd';
      ctx.fillText(`${g.keyLabels?.[i] || i + 1}  ${g.engine.pressCounts[i]}`, x0 + size * 1.1, y + size / 2);
    }
  }
}
