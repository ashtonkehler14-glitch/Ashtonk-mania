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
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.layout = null;
    this.effects = [];          // lighting + particles
    this.judgementFx = null;
    this.comboBump = 0;
    this.lastCombo = 0;
    this.keyLight = [];         // release time per column for stage light fade
    this.fontCache = new Map();
  }
  setLayout(layout) {
    this.layout = layout;
    this.keyLight = new Array(layout.keys).fill(-1e9);
    this.effects = []; this.judgementFx = null;
    this.resize(true);
  }
  resize(force = false) {
    const c = this.canvas;
    const dpr = Zoom.dpr() * Settings.get('graphics.renderScale');
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), hh = Math.max(1, Math.round(c.clientHeight * dpr));
    if (!force && w === c.width && hh === c.height) return;
    c.width = w; c.height = hh;
    this.W = w; this.H = hh;
    this._geom();
  }
  _geom() {
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
    const w = L.widthForNoteHeightScale > 0 ? L.widthForNoteHeightScale * this.s * Settings.get('gameplay.laneWidth') : Math.min(...this.colW);
    return tex.h * (w / tex.w);
  }

  /** Render a frame. g: {now, posNow, scroll:ScrollMap, pxPerMs, engine, held[], barlines[], hidden:'HD'|'FI'|null, realNow} */
  render(g) {
    const L = this.layout;
    if (!L) return;
    this.resize();
    const ctx = this.ctx, s = this.s, K = L.keys, H = this.H;
    const realNow = g.realNow ?? performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.W, H);
    ctx.save();
    ctx.translate(this.stageX, 0);

    // column backgrounds
    for (let i = 0; i < K; i++) {
      ctx.fillStyle = rgba(L.colours.column[i], Settings.get('gameplay.stageOpacity'));
      ctx.fillRect(this.colX[i], 0, this.colW[i], H);
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
    // barlines
    if (g.barlines && Settings.get('gameplay.barlines')) {
      ctx.fillStyle = rgba(L.colours.barline, 0.6);
      const bh = Math.max(1, L.barlineHeight * s * 0.5);
      for (let i = g.barIdx || 0; i < g.barlines.length; i++) {
        const t = g.barlines[i];
        const y = yOf(g.scroll.posAt(t));
        if (y > this.hitY + 2) { g.barIdx = i + 1; continue; }
        if (y < -10) break;
        this._rect(0, y - bh, this.stageW, bh);
      }
    }
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
          this._img(t.img, this.colX[i], H - h, this.colW[i], h);
        } else {
          // built-in keys: receptor (25% down the texture) centred on where notes are hit
          const h = t.h * (this.colW[i] / t.w);
          const nh = this._noteH(L.tex.note[i], i);
          const top = this.hitY - nh / 2 - h * 0.25;
          this._img(t.img, this.colX[i], top, this.colW[i], Math.max(h, H - top));
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
      if (Settings.get('gameplay.hitErrorBar')) this._drawErrorBar(g, realNow);
    }
    ctx.restore();
    if (g.engine) {
      if (Settings.get('gameplay.showHealth')) this._drawHealth(g.engine.health.value);
      if (Settings.get('input.keyOverlay')) this._drawKeyOverlay(g);
      if (Settings.get('gameplay.judgementCounter')) this._drawCounter(g.engine.score.counts);
    }
  }

  /** Hidden / Fade In lane cover: `coverage` is the fraction of the lane (above the receptors) that is covered. */
  _noteAlpha(y, hidden) {
    if (!hidden) return 1;
    const f = y / this.hitY, c = clamp(this.coverage ?? 0.5, 0.1, 0.9), fade = 0.12;
    if (hidden === 'HD') return clamp((1 - c - f) / fade + 1, 0, 1);
    return clamp((f - c) / fade, 0, 1);
  }

  _drawNotes(g, yOf, realNow) {
    const L = this.layout, ctx = this.ctx, eng = g.engine, K = L.keys;
    const top = -this.H * 0.1;
    for (let c = 0; c < K; c++) {
      const col = eng.columns[c];
      const x = this.colX[c], w = this.colW[c];
      const texN = L.tex.note[c], texH = L.tex.noteH[c], texL = L.tex.noteL[c], texT = L.tex.noteT[c];
      for (let i = eng.ptr[c]; i < col.length; i++) {
        const n = col[i];
        if (n.state === NS.DONE || (n.state === NS.MISSED && !n.isLN)) continue;
        const headPos = g.scroll.pos(n.time);
        let yHead = yOf(headPos);
        if (yHead < top && !n.isLN) break;
        if (n.isLN) {
          const yTail = yOf(g.scroll.posAt(g.percy ? Math.max(n.time, n.end - g.percy) : n.end));
          if (yTail > this.H + 50 && n.state !== NS.HOLDING) continue;
          if (yHead < top && yTail < top) break;
          const holding = n.state === NS.HOLDING;
          if (holding) yHead = Math.min(yHead, this.hitY);
          const dropped = n.state === NS.DROPPED || n.state === NS.MISSED;
          const alpha = this._noteAlpha(Math.max(yTail, 0), g.hidden) * (dropped ? 0.45 : 1);
          ctx.globalAlpha = Math.max(this._noteAlpha(yHead, g.hidden), alpha) * (dropped ? 0.45 : 1);
          const hh = this._noteH(texH || texN, c);
          const th = texT ? this._noteH(texT, c) : 0;
          // body runs from the head's centre to the tail's centre; the tail cap is drawn flipped over the
          // body end in down-scroll (legacy skins author tails as "caps" that round the body off)
          const bodyTop = yTail - th / 2, bodyBottom = yHead - hh / 2;
          if (texL && bodyBottom > bodyTop) this._drawBody(texL, x, w, bodyTop, bodyBottom, L.noteBodyStyle[c], realNow);
          if (texT && yTail - th < yHead - hh / 2) this._img(texT.frameAt(realNow), x, yTail - th, w, th, !this.up);
          if (texH || texN) this._img((texH || texN).frameAt(realNow), x, yHead - hh, w, hh);
          ctx.globalAlpha = 1;
        } else {
          if (yHead > this.H + 60) continue;
          const nh = this._noteH(texN, c);
          ctx.globalAlpha = this._noteAlpha(yHead, g.hidden) * (n.state === NS.MISSED ? 0.5 : 1);
          if (texN) this._img(texN.frameAt(realNow), x, yHead - nh, w, nh);
          ctx.globalAlpha = 1;
        }
      }
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
    if (e.j !== J.MISS && Settings.get('gameplay.hitLighting') && (!e.note.isLN || e.tail)) this.effects.push({ type: 'N', col: e.col, t0: realNow });
    if (Settings.get('gameplay.showJudgements') && (e.j !== J.MARV || Settings.get('gameplay.showMax'))) {
      const thr = Settings.get('gameplay.earlyLate');
      const el = thr > 0 && e.err != null && e.j !== J.MARV && Math.abs(e.err) >= thr ? (e.err < 0 ? 'EARLY' : 'LATE') : null;
      this.judgementFx = { j: e.j, t0: realNow, el };
    }
    if (Settings.get('graphics.particles') && e.j <= J.GREAT) {
      const n = e.j === J.MARV ? 7 : 4;
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
    // hit lighting
    this.effects = this.effects.filter(e => {
      if (e.type !== 'N') return true;
      const t = L.tinted.lightingN[e.col];
      if (!t) return false;
      const el = realNow - e.t0;
      const multi = t.frames.length > 1;
      const dur = multi ? t.frames.length / t.fps * 1000 : 180;
      if (el > dur) return false;
      const w0 = this._lightW(t, e.col, L.lightingNWidth);
      const sc = multi ? 1 : 1 + el / dur * 0.25;
      const w = w0 * sc, hh = t.h * (w0 / t.w) * sc;
      ctx.globalAlpha = multi ? 1 : 1 - el / dur;
      const cx = this.colX[e.col] + this.colW[e.col] / 2;
      this._img(t.frameAt(el, false), cx - w / 2, this.hitY - hh / 2, w, hh);
      ctx.globalAlpha = 1;
      return true;
    });
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
    this.effects = this.effects.filter(e => {
      if (e.type !== 'P') return true;
      const el = realNow - e.t0;
      if (el > e.life) return false;
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
      return true;
    });
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
    const pop = t.frames.length > 1 ? 1 : (el < 60 ? 1.18 - 0.18 * (el / 60) : 1);
    const k = (this.legacy ? this.u : this.s * 0.8) * sk * pop;
    const w = t.w * k, hh = t.h * k;
    const y = L.scorePosition * this.s;
    this.ctx.globalAlpha = el > total - 100 ? (total - el) / 100 : 1;
    this._img(t.frameAt(el, false), this.stageW / 2 - w / 2, y - hh / 2, w, hh);
    if (fx.el) {
      const ctx = this.ctx, size = Math.round(9 * this.s);
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
  _drawErrorBar(g, realNow) {
    const eng = g.engine, ctx = this.ctx, s = this.s;
    const W = eng.W.map(w => w / eng.rate);
    const width = Math.min(this.stageW * 0.9, 150 * s) * Settings.get('gameplay.errorBarScale');
    const scale = width / 2 / W[J.BAD];
    const cx = this.stageW / 2;
    const y = this.up ? 14 * s : this.H - 8 * s;
    const hh = 2.4 * s;
    for (let j = J.BAD; j >= 0; j--) {
      ctx.fillStyle = JUDGEMENTS[j].color; ctx.globalAlpha = 0.45;
      ctx.fillRect(cx - W[j] * scale, y - hh / 2, W[j] * 2 * scale, hh);
    }
    ctx.globalAlpha = 1;
    const errs = eng.hitErrors;
    const nowT = g.now;
    for (let i = errs.length - 1, k = 0; i >= 0 && k < 40; i--, k++) {
      const e = errs[i];
      const age = (nowT - e.t) / eng.rate;
      if (age > 3000) break;
      ctx.globalAlpha = clamp(1 - age / 3000, 0, 1);
      ctx.fillStyle = JUDGEMENTS[e.j].color;
      ctx.fillRect(cx + clamp(e.err, -W[J.BAD], W[J.BAD]) * scale - 1, y - hh * 2.5, Math.max(2, s * 0.6), hh * 5);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 1, y - hh * 3, 2, hh * 6);
  }
  _drawHealth(v) {
    const ctx = this.ctx, s = this.s;
    const x = this.stageX + this.stageW + 6 * s, top = this.H * 0.18, bottom = this.hitY, w = 3.2 * s;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x, top, w, bottom - top);
    const hh = (bottom - top) * v;
    const grd = ctx.createLinearGradient(0, bottom - hh, 0, bottom);
    const P = DefaultSkin.palette();
    grd.addColorStop(0, v < 0.25 ? '#ff4a5c' : P.n2[0]); grd.addColorStop(1, v < 0.25 ? '#ff8a5c' : P.n2[1]);
    ctx.fillStyle = grd;
    ctx.fillRect(x, bottom - hh, w, hh);
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
  _drawCounter(counts) {
    const ctx = this.ctx, s = this.s;
    const x = this.stageX - 12 * s, y0 = this.H * 0.45, lh = 9 * s;
    ctx.font = `800 ${Math.round(lh * 0.8)}px Torus, Outfit, system-ui, sans-serif`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    JUDGEMENTS.forEach((jj, i) => {
      ctx.fillStyle = jj.color; ctx.fillText(`${jj.short}  ${counts[i]}`, x, y0 + i * lh);
    });
  }
}
