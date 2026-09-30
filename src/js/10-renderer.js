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

class ManiaRenderer {
  /** crop: size the canvas to just the stage (plus room for the health bar / key display) instead of the whole
   *  screen, so each frame clears, fills and composites far fewer pixels. The canvas's parent is the screen. */
  constructor(canvas, { crop = false } = {}) {
    this.canvas = canvas;
    this.crop = crop; this.cropX = 0;
    this._spr = new WeakMap(); this._tx = 0; this._noteRefW = 0;
    if (crop && typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      // cache the screen size instead of reading clientWidth every frame (that can force a layout)
      this._ro = new ResizeObserver(es => { const r = es[es.length - 1].contentRect; this._hostW = r.width; this._hostH = r.height; });
      this._ro.observe(canvas.parentElement);
    }
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
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
    this._spr = new WeakMap(); this._noteRefW = 0;
    this.keyLight = new Array(layout.keys).fill(-1e9);
    this.effects = []; this.judgementFx = null; this._lastN = []; this._pN = 0; this._missFx = [];
    this.resize(true);
  }
  dispose() { if (this._ro) this._ro.disconnect(); this._ro = null; }
  /** Distance a note scrolls during one "time range" (scroll speed): osu!lazer scales the time range with the skin's
   *  hit position, so on screen the speed is the same whatever the HitPosition — 402 of 480 units, the default. */
  get scrollLength() { return 402 * (this.s || this.H / 480 || 1); }
  resize(force = false) {
    const c = this.canvas;
    const dpr = Zoom.dpr() * Settings.get('graphics.renderScale');
    if (this.crop) {
      const host = c.parentElement;
      const cw = this._hostW ?? (host ? host.clientWidth : c.clientWidth), ch = this._hostH ?? (host ? host.clientHeight : c.clientHeight);
      const w = Math.max(1, Math.round(cw * dpr)), hh = Math.max(1, Math.round(ch * dpr));
      if (!force && w === this.W && hh === this.H && dpr === this._dpr) return;
      this._dpr = dpr; this.W = w; this.H = hh;
      this._geom();
      let x0 = 0, x1 = w;
      if (this.layout && Number.isFinite(this.stageX)) {
        x0 = clamp(Math.floor(this.stageX - 40 * this.s), 0, w - 1);
        x1 = clamp(Math.ceil(this.stageX + this.stageW + 72 * this.s), x0 + 1, w);
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
    this._spr = new WeakMap(); this._noteRefW = 0; // sizes change: drop the pre-scaled sprites
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
    const pos = Settings.get('gameplay.stagePosition');
    this.stageX = pos === 'skin' ? L.columnStart * s * (this.W / this.H > 4 / 3 ? 1 : 1)
      : pos === 'left' ? this.W * 0.12 : pos === 'right' ? this.W * 0.88 - this.stageW : (this.W - this.stageW) / 2;
    this.stageX += Settings.get('gameplay.stageOffset') / 100 * this.W;
    this.hitY = clamp((clamp(L.hitPosition, 240, 480) + Settings.get('gameplay.hitPositionOffset')) * s, 40 * s, this.H - 4);
    this.up = Settings.get('gameplay.scrollDirection') === 'up' || L.upsideDown;
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
  /** Like _img for fixed-size textures (notes, keys): drawn from a pre-scaled sprite, snapped to whole pixels. */
  _spriteImg(img, x, yTop, w, h, flipY = false) {
    if (!img || w <= 0 || h <= 0) return;
    if (this.up) yTop = this.H - yTop - h;
    const tx = this._tx; // translation from stage space to device pixels
    this.ctx.drawImage(this._sprite(img, w, h, flipY), Math.round(x + tx) - tx, Math.round(yTop));
  }

  /** Render a frame. g: {now, posNow, scroll:ScrollMap, pxPerMs, engine, held[], hidden:'HD'|'FI'|null, realNow} */
  render(g) {
    const L = this.layout;
    if (!L) return;
    this.resize();
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
      ctx.fillStyle = rgba(L.colours.column[i], Settings.get('gameplay.stageOpacity'));
      ctx.fillRect(x0, 0, x1 - x0, H);
    }
    const dim = Settings.get('skin.dim');
    if (dim > 0) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, this.stageW, H); }
    // column lines
    if (L.columnLineWidth.some(w => w > 0)) {
      ctx.fillStyle = rgba(L.colours.columnLine, 0.5);
      for (let i = 0; i <= K; i++) {
        const w = (L.columnLineWidth[i] || 0) * s * 0.5;
        if (w <= 0) continue;
        const x = i < K ? this.colX[i] : this.stageW;
        ctx.fillRect(x - w / 2, 0, w, this.hitY);
      }
    }
    const pxPerMs = g.pxPerMs;
    const noteOffset = Settings.get('gameplay.noteOffset') * s;
    const yOf = pos => this.hitY + noteOffset - (pos - g.posNow) * pxPerMs;
    // stage light (key press glow)
    if (Settings.get('skin.effects')) {
      for (let i = 0; i < K; i++) {
        const t = L.tinted.stageLight[i];
        if (!t) continue;
        let a = 0;
        if (g.held[i]) a = 1; else { const dt = realNow - this.keyLight[i]; if (dt < 120) a = 1 - dt / 120; }
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        const h = t.h * (this.legacy ? this.u : s);
        const bottom = (L.lightPosition + Settings.get('gameplay.hitPositionOffset')) * s;
        this._img(t.frameAt(realNow), this.colX[i], bottom - h, this.colW[i], h);
        ctx.globalAlpha = 1;
      }
    }
    // stage hint
    if (L.tex.stageHint) {
      const t = L.tex.stageHint, h = t.h * (this.legacy ? this.u : s);
      this._img(t.img, 0, this.hitY - h / 2, this.stageW, h);
    }
    const drawKeys = () => {
      for (let i = 0; i < K; i++) {
        const t = g.held[i] ? (L.tex.keyD[i] || L.tex.key[i]) : L.tex.key[i];
        if (!t) continue;
        if (this.legacy) {
          // legacy keys: stretched to the column width, authored height kept (anchored to the bottom)
          const h = t.h * this.u;
          this._spriteImg(t.img, this.colX[i], H - h, this.colW[i], h);
        } else {
          // built-in keys: receptor (25% down the texture) centred on where notes are hit
          const h = t.h * (this.colW[i] / t.w);
          const nh = this._noteH(L.tex.note[i], i);
          const top = this.hitY - nh / 2 - h * 0.25;
          this._spriteImg(t.img, this.colX[i], top, this.colW[i], Math.max(h, H - top));
        }
      }
    };
    if (L.keysUnderNotes) drawKeys();

    // notes
    if (g.engine) this._drawNotes(g, yOf, realNow);

    if (L.judgementLine) {
      ctx.fillStyle = rgba(L.colours.judgementLine, 0.9);
      this._rect(0, this.hitY - Math.max(1, s * 0.5), this.stageW, Math.max(1, s * 0.5));
    }
    if (!L.keysUnderNotes) drawKeys();
    // stage sides / bottom
    const us = this.legacy ? this.u : s;
    if (L.tex.stageLeft) { const t = L.tex.stageLeft, w = t.w * us; ctx.drawImage(t.img, -w, 0, w, H); }
    if (L.tex.stageRight) { const t = L.tex.stageRight, w = t.w * us; ctx.drawImage(t.img, this.stageW, 0, w, H); }
    if (L.tex.stageBottom) {
      const t = L.tex.stageBottom, w = t.w * us, h = t.h * us;
      this._img(t.img, (this.stageW - w) / 2, H - h, w, h);
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
  _drawNotes(g, yOf, realNow) {
    const L = this.layout, ctx = this.ctx, eng = g.engine, K = L.keys, sc = g.scroll;
    const top = -this.H * 0.1;
    const bands = g.hidden ? this._coverBands(g.hidden) : null;
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
        let yHead = yOf(n._hp);
        if (yHead < top && !n.isLN) break;
        if (n.isLN) {
          const yTail = yOf(n._tp);
          if (yTail > this.H + 50 && n.state !== NS.HOLDING) continue;
          if (yHead < top && yTail < top) break;
          if (n.state === NS.HOLDING) yHead = Math.min(yHead, this.hitY);
          const mult = n.state === NS.DROPPED || n.state === NS.MISSED ? 0.45 : 1;
          const draw = () => {
            const hh = this._noteH(texH || texN, c);
            const th = texT ? this._noteH(texT, c) : 0;
            // body runs from the head's centre to the tail's centre; the tail cap is drawn flipped over the
            // body end in down-scroll (legacy skins author tails as "caps" that round the body off)
            const bodyTop = yTail - th / 2, bodyBottom = yHead - hh / 2;
            if (texL && bodyBottom > bodyTop) this._drawBody(texL, x, w, bodyTop, bodyBottom, L.noteBodyStyle[c], realNow);
            if (texT && yTail - th < yHead - hh / 2) this._spriteImg(texT.frameAt(realNow), x, yTail - th, w, th, !this.up);
            if (texH || texN) this._spriteImg((texH || texN).frameAt(realNow), x, yHead - hh, w, hh);
          };
          if (!bands) { ctx.globalAlpha = mult; draw(); ctx.globalAlpha = 1; continue; }
          const y0 = yTail - (texT ? this._noteH(texT, c) : 0), y1 = yHead;
          for (const [b0, b1, a] of bands) {
            const lo = Math.max(b0, y0), hi = Math.min(b1, y1);
            if (hi <= lo || a <= 0) continue;
            ctx.save();
            ctx.beginPath(); ctx.rect(x - 1, this.up ? this.H - b1 : b0, w + 2, b1 - b0); ctx.clip();
            ctx.globalAlpha = a * mult; draw();
            ctx.restore();
          }
        } else {
          if (yHead > this.H + 60) continue;
          const a = this._noteAlpha(yHead, g.hidden) * (n.state === NS.MISSED ? 0.5 : 1);
          if (a <= 0) continue;
          ctx.globalAlpha = a;
          if (texN) this._spriteImg(texN.frameAt(realNow), x, yHead - nh, w, nh);
          ctx.globalAlpha = 1;
        }
      }
    }
    // missed notes fading out (lazer: FadeOut(150, Easing.In))
    const mf = this._missFx;
    if (mf && mf.length) {
      let keep = 0;
      for (let i = 0; i < mf.length; i++) {
        const f = mf[i], el = realNow - f.t0;
        if (el >= 150 || f.n.col >= K) continue;
        mf[keep++] = f;
        const n = f.n, c = n.col, texN = L.tex.note[c];
        if (!texN) continue;
        if (n._sc !== sc) { n._sc = sc; n._hp = sc.pos(n.time); n._tp = 0; }
        const y = yOf(n._hp), nh = this._noteH(texN, c);
        if (y - nh > this.H) continue;
        const k = el / 150;
        ctx.globalAlpha = (1 - k * k) * this._noteAlpha(y, g.hidden) * 0.9;
        this._spriteImg(texN.frameAt(realNow), this.colX[c], y - nh, this.colW[c], nh);
      }
      mf.length = keep;
      ctx.globalAlpha = 1;
    }
  }
  _drawBody(tex, x, w, top, bottom, style, realNow) {
    const img = tex.frameAt(realNow);
    const len = bottom - top;
    if (style === 0) { this._img(img, x, top, w, len); return; }
    const th = Math.max(2, tex.h * (w / tex.w));
    const ctx = this.ctx;
    ctx.save();
    const clipY = this.up ? this.H - bottom : top;
    ctx.beginPath(); ctx.rect(x, clipY, w, len); ctx.clip();
    if (style === 2) { for (let y = bottom - th; y > top - th; y -= th) this._img(img, x, y, w, th); }
    else { for (let y = top; y < bottom; y += th) this._img(img, x, y, w, th); }
    ctx.restore();
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
      this._img(t.frameAt(realNow), cx - w / 2, this.hitY - hh / 2, w, hh);
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
      const el = realNow - e.t0;
      const multi = t.frames.length > 1;
      const dur = multi ? t.frames.length / t.fps * 1000 : 180;
      if (el > dur) continue;
      const w0 = this._lightW(t, e.col, L.lightingNWidth);
      const sc = multi ? 1 : 1 + el / dur * 0.25;
      const w = w0 * sc, hh = t.h * (w0 / t.w) * sc;
      ctx.globalAlpha = multi ? 1 : 1 - el / dur;
      const cx = this.colX[e.col] + this.colW[e.col] / 2;
      this._img(t.frameAt(el, false), cx - w / 2, this.hitY - hh / 2, w, hh);
      ctx.globalAlpha = 1;
      fx[keep++] = e;
    }
    fx.length = keep;
    ctx.globalCompositeOperation = 'source-over';
  }
  /** Hit/hold lighting width. Legacy skins follow lazer: texture size × (LightingNWidth or column width) / 30. */
  _lightW(t, c, widths) {
    const L = this.layout;
    if (this.legacy) {
      const cw = widths[c] > 0 ? widths[c] : L.columnWidth[c] * Settings.get('gameplay.laneWidth');
      return t.w * this.u * cw / 30;
    }
    return widths[c] > 0 ? widths[c] * this.s : t.w * this.s;
  }
  _drawParticles(realNow) {
    const ctx = this.ctx;
    const fx = this.effects;
    let keep = 0;
    for (let i = 0; i < fx.length; i++) {
      const e = fx[i];
      if (e.type !== 'P') { fx[keep++] = e; continue; }
      const el = realNow - e.t0;
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
    const L = this.layout, el = realNow - fx.t0;
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
    const el = realNow - this.comboBump;
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
