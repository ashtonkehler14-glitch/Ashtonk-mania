/* Results screen — grade, score, judgement breakdown, timing distribution & timing-over-time graphs,
 * personal-best tracking and replay actions. */

const ResultsScreen = {
  tab: 'songselect',
  enter(p) {
    this.p = p;
    const s = p.score;
    const map = BeatmapManager.mapByHash(s.mapHash);
    const el = h('div.results');
    if (map) BeatmapManager.bgURL(map).then(u => Background.set(u, { blur: Settings.get('graphics.menuBlur') + 6, dim: 0.35 }));
    const body = h('div.res-body');
    const grid = h('div.res-grid');
    const head = h('div.res-head',
      h('div', { style: { flex: '1', minWidth: '0' } },
        h('div.t', s.title), h('div.a', `${s.artist} · mapped by ${s.creator || '?'}`),
        h('div.d', `[${s.version}] · ${s.keys}K · played by ${s.player} · ${new Date(s.date).toLocaleString()}`)),
      starBadge(s.stars || 0),
      h('div.row', { style: { gap: '4px' } }, ...(s.mods || []).map(m => ModSystem.badge(m, false, s.modConfig || null))),
      p.watched ? h('span.tag.accent', p.watched === 'auto' ? 'AUTO PLAY' : 'REPLAY') : null,
      !s.passed ? h('span.tag.warn', 'FAILED') : null);
    grid.append(head, this.gradeCard(s, p), this.rightCol(s));
    body.append(grid);
    const actions = this.actions(s, p, map);
    el.append(body, actions);
    if (p.fresh && s.passed) setTimeout(() => SkinManager.sample(s.accuracy >= 0.95 ? 'applause' : 'sectionpass').then(b => b && AudioManager.play(b, { volume: 0.6 })), 700);
    return el;
  },
  leave() { cancelAnimationFrame(this._cnt); },
  onKey(e) {
    if (e.code === 'KeyR' || (e.ctrlKey && e.code === 'KeyR')) { this.retry(); return true; }
    if (e.code === 'Enter' || e.code === 'Space') { this.retry(); return true; }
    return false;
  },
  onBack() { Screens.go('songselect', { mapId: this.p.score.mapId }, { replace: true }); return true; },
  retry() {
    const s = this.p.score;
    const map = BeatmapManager.mapByHash(s.mapHash);
    if (!map) { Toast.err('Beatmap not found', 'This beatmap is no longer in your library.'); return; }
    UISounds.click();
    Game.launch({ mapId: map.id, mods: this.p.watched === 'auto' ? s.mods : s.mods.filter(m => m !== 'AT'), mode: 'play' });
  },
  gradeCard(s, p) {
    const R = 100, C = 2 * Math.PI * R;
    const ring = h('div.res-ring');
    ring.innerHTML = `<svg viewBox="0 0 230 230"><circle cx="115" cy="115" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="14"/>
      <circle class="accring" cx="115" cy="115" r="${R}" fill="none" stroke="url(#rg)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition: stroke-dashoffset calc(1200ms * var(--anim)) cubic-bezier(.16,1,.3,1)"/>
      <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" style="stop-color: var(--accent)"/></linearGradient></defs></svg>`;
    ring.append(gradeEl(s.grade));
    requestAnimationFrame(() => requestAnimationFrame(() => { const c = ring.querySelector('.accring'); if (c) c.style.strokeDashoffset = C * (1 - s.accuracy); }));
    const scoreEl = h('div.res-score', '0');
    let digits = null; // the skin's number font, once loaded
    SkinManager.scoreFont().then(f => { if (!f) return; digits = skinDigits(f, 44, { align: 'center' }); scoreEl.classList.add('skinned'); scoreEl.replaceChildren(digits.el); digits.set(fmtScore(shown)); }).catch(() => {});
    let shown = 0;
    const t0 = performance.now(), dur = 1100 * (Settings.get('ui.animSpeed') > 0 ? 1 / Settings.get('ui.animSpeed') : 0);
    const tick = () => {
      const k = dur ? clamp((performance.now() - t0) / dur, 0, 1) : 1;
      shown = s.score * (1 - Math.pow(1 - k, 3));
      if (digits) digits.set(fmtScore(shown)); else scoreEl.textContent = fmtScore(shown);
      if (k < 1) this._cnt = requestAnimationFrame(tick);
    };
    tick();
    const pp = ScoreManager.ppOf(s);
    const ppEl = h('div.res-pp', h('b', fmtInt(pp)), 'pp');
    if (!s.passed || (s.mods || []).includes('AT')) ppEl.title = 'pp is only awarded for passes (not Auto)';
    const card = h('div.panel.glass.res-grade-card', ring, scoreEl, ppEl);
    if (p.fresh && s.passed && s.totalPpAfter != null && s.totalPpBefore != null) {
      const d = s.totalPpAfter - s.totalPpBefore;
      card.append(h('div.muted.res-ppdelta', `Total ${fmtInt(s.totalPpAfter)}pp (${d >= 0.5 ? '+' + fmtInt(d) : d <= -0.5 ? fmtInt(d) : '±0'})`));
    }
    if (s.isPB && p.fresh) card.append(h('div.res-pb', '★ NEW PERSONAL BEST'));
    else if (s.prevBest && p.fresh && s.passed) card.append(h('div.muted', `Personal best: ${fmtScore(s.prevBest.score)} (${s.score >= s.prevBest.score ? '+' : ''}${fmtInt(s.score - s.prevBest.score)})`));
    const kv = (k, v, title) => h('div.stat', { title: title || '' }, h('div.k', k), h('div.v', v));
    card.append(h('div.res-kv',
      kv('Accuracy', fmtAcc(s.accuracy)), kv('Max combo', fmtInt(s.maxCombo) + 'x'),
      kv('UR', (s.unstableRate || 0).toFixed(1), `Unstable rate · mean ${(s.meanError || 0).toFixed(1)}ms · ${s.early || 0} early / ${s.late || 0} late`)));
    // osu!lazer: calibrate this beatmap's offset from the play you just finished
    const sug = p.fresh ? MapOffsets.suggestion(s.mapHash) : null;
    if (sug != null) {
      const cur = MapOffsets.get(s.mapHash);
      card.append(h('button.btn.sm.res-calib', { title: 'Shifts this beatmap\'s offset by your average hit error', onclick: async e => {
        const btn = e.currentTarget;
        await MapOffsets.set(s.mapHash, cur + sug); MapOffsets.last = null; UISounds.click();
        btn.replaceWith(h('div.muted.res-calib', icon('check'), `Beatmap offset is now ${cur + sug > 0 ? '+' : ''}${cur + sug}ms`));
      } }, icon('clock'), `You hit ${Math.abs(sug)}ms ${sug > 0 ? 'late' : 'early'} on average · fix offset`));
    }
    return card;
  },
  rightCol(s) {
    const col = h('div.res-right');
    const counts = s.counts || [0, 0, 0, 0, 0, 0];
    const total = Math.max(1, counts.reduce((a, b) => a + b, 0));
    const judge = h('div.panel.glass.res-judge', ...JUDGEMENTS.map((j, i) => {
      const bar = h('i', { style: { '--jc': j.color } });
      requestAnimationFrame(() => requestAnimationFrame(() => bar.style.width = (counts[i] / total * 100) + '%'));
      return h('div.jrow', h('div.jn', { style: { color: j.color } }, j.name), h('div.jc', fmtInt(counts[i])), h('div.jb', bar));
    }));
    col.append(judge);
    const errs = (s.hitErrors || []).filter(e => !e[3]);
    const W = (s.windows || timingWindows({ od: s.od ?? 8 })).slice();
    const hist = h('div.panel.glass.chart-card', h('h3', 'Hit distribution', h('span.grow'), h('span', `${errs.length} hits · mean ${(s.meanError || 0).toFixed(1)}ms · UR ${(s.unstableRate || 0).toFixed(1)}`)));
    const scatter = h('div.panel.glass.chart-card', h('h3', 'Timing over time', h('span.grow'), h('span', 'early ↑ · late ↓')));
    if (errs.length) {
      hist.append(Charts.histogram(errs.map(e => e[1]), W, s.meanError || 0));
      scatter.append(Charts.scatter(s.hitErrors, W));
      scatter.append(h('div.chart-legend', ...JUDGEMENTS.slice(0, 5).map(j => h('span', { style: { '--c': j.color } }, j.name))));
    } else {
      hist.append(h('div.empty', { style: { padding: '24px' } }, 'No timing data for this play.'));
      scatter.style.display = 'none';
    }
    col.append(hist);
    // Secondary graphs stay folded away to keep the screen simple.
    const more = h('details.res-more', h('summary', 'More statistics'));
    if (errs.length) more.append(scatter);
    const hl = s.healthTimeline || [];
    if (hl.length > 2) {
      const step = Math.max(1, Math.floor(hl.length / 240));
      const pts = hl.filter((_, i) => i % step === 0 || i === hl.length - 1).map(([t, v]) => ({ y: v * 100, tip: `${fmtTime(t)} · health ${Math.round(v * 100)}%` }));
      more.append(h('div.panel.glass.chart-card', h('h3', 'Health over time', h('span.grow'), h('span', `lowest ${Math.round(Math.min(...hl.map(x => x[1])) * 100)}%`)),
        Charts.line(pts, { height: 130, yMin: 0, yMax: 100, fmtY: v => Math.round(v) + '%', dots: false })));
    }
    if (more.children.length > 1) {
      col.append(more);
    }
    return col;
  },
  actions(s, p, map) {
    const replay = p.replay || null;
    const hasSaved = !!s.replayId || (replay && ReplayManager.list.some(r => r.id === replay.id));
    const bar = h('div.res-actions');
    const watch = h('button.btn', { onclick: () => this.watch() }, icon('film'), 'Watch replay');
    const save = h('button.btn', { onclick: async () => {
      if (!replay) return;
      await ReplayManager.save(replay);
      s.replayId = replay.id;
      Toast.ok('Replay saved', 'Find it in Replays.');
      save.disabled = true; save.textContent = 'Replay saved';
      bar.insertBefore(exp, save.nextSibling);
    } }, icon('save'), 'Save replay');
    const exp = h('button.btn.ghost', { onclick: async () => { const r = replay || await ReplayManager.get(s.replayId); if (r) ReplayManager.export(r); } }, icon('download'), 'Export .amr');
    bar.append(
      backButton(() => this.onBack()),
      h('button.btn.primary', { onclick: () => this.retry(), disabled: !map, title: 'Retry (R)' }, icon('retry'), 'Retry'));
    if (replay || s.replayId) bar.append(watch);
    if (replay && !hasSaved && p.watched !== 'auto' && p.watched !== 'replay') bar.append(save);
    if (hasSaved || p.watched === 'replay') bar.append(exp);
    if (!map) bar.append(h('span.muted', 'Beatmap no longer in library'));

    return bar;
  },
  async watch() {
    const s = this.p.score;
    const replay = this.p.replay || (s.replayId && await ReplayManager.get(s.replayId));
    if (!replay) { Toast.err('No replay available'); return; }
    const map = BeatmapManager.mapByHash(replay.mapHash);
    if (!map) { Toast.err('Beatmap not found', 'Import the beatmap to watch this replay.'); return; }
    Game.launch({ mapId: map.id, mode: 'replay', replay, returnTo: { ...this.p } });
  },
};

/** Small canvas chart helpers with hover tooltips (single-series, thin marks, recessive grid). */
const Charts = {
  _setup(heightPx) {
    const wrap = h('div.chart-wrap');
    const cv = h('canvas', { style: { height: heightPx + 'px' } });
    const tip = h('div.chart-tip', { hidden: true });
    wrap.append(cv, tip);
    return { wrap, cv, tip };
  },
  _ctx(cv) {
    const dpr = Zoom.dpr();
    const w = cv.clientWidth || 600, hh = cv.clientHeight || 160;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { x, w, h: hh };
  },
  _css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); },
  histogram(errs, W, mean) {
    const { wrap, cv, tip } = this._setup(170);
    const range = W[J.BAD], bin = 2;
    const nb = Math.ceil(range * 2 / bin);
    const bins = new Array(nb).fill(0);
    for (const e of errs) { const i = Math.floor((clamp(e, -range, range - 0.001) + range) / bin); bins[i]++; }
    const max = Math.max(...bins, 1);
    let geo = null;
    const draw = hover => {
      const { x, w, h: H } = this._ctx(cv);
      const pad = { l: 8, r: 8, t: 8, b: 20 };
      const pw = w - pad.l - pad.r, ph = H - pad.t - pad.b;
      const bw = pw / nb;
      geo = { pad, pw, ph, bw };
      x.strokeStyle = 'rgba(255,255,255,.06)'; x.lineWidth = 1;
      for (let k = 1; k <= 3; k++) { const y = pad.t + ph * (1 - k / 4); x.beginPath(); x.moveTo(pad.l, y); x.lineTo(w - pad.r, y); x.stroke(); }
      bins.forEach((v, i) => {
        if (!v) return;
        const c = -range + (i + 0.5) * bin;
        let j = 0; while (j < 5 && Math.abs(c) > W[j]) j++;
        const hh = Math.max(2, v / max * ph);
        x.fillStyle = JUDGEMENTS[Math.min(j, 4)].color;
        x.globalAlpha = hover === i ? 1 : 0.85;
        const bx = pad.l + i * bw + 1, bwid = Math.max(1, bw - 2);
        x.beginPath();
        x.roundRect ? x.roundRect(bx, pad.t + ph - hh, bwid, hh, [Math.min(4, bwid / 2), Math.min(4, bwid / 2), 0, 0]) : x.rect(bx, pad.t + ph - hh, bwid, hh);
        x.fill();
      });
      x.globalAlpha = 1;
      const zx = pad.l + pw / 2;
      x.fillStyle = '#fff'; x.fillRect(zx - 1, pad.t, 2, ph);
      const mx = pad.l + (mean + range) / (2 * range) * pw;
      x.fillStyle = '#ffd54a'; x.fillRect(mx - 1, pad.t, 2, ph);
      x.fillStyle = this._css('--muted') || '#999'; x.font = '700 11px Torus, Outfit, system-ui'; x.textAlign = 'center';
      x.fillText(`-${Math.round(range)}ms (early)`, pad.l + 44, H - 5); x.fillText('0', zx, H - 5); x.fillText(`+${Math.round(range)}ms (late)`, w - pad.r - 44, H - 5);
    };
    requestAnimationFrame(() => draw(-1));
    new ResizeObserver(() => draw(-1)).observe(cv);
    cv.addEventListener('pointermove', e => {
      if (!geo) return;
      const r = cv.getBoundingClientRect();
      const i = Math.floor(((e.clientX - r.left) * Zoom.z - geo.pad.l) / geo.bw);
      if (i < 0 || i >= nb) { tip.hidden = true; draw(-1); return; }
      const lo = -range + i * bin;
      tip.hidden = false; tip.textContent = `${lo.toFixed(0)} to ${(lo + bin).toFixed(0)}ms: ${bins[i]} hit${bins[i] === 1 ? '' : 's'}`;
      tip.style.left = (e.clientX - r.left) * Zoom.z + 'px'; tip.style.top = (e.clientY - r.top) * Zoom.z + 'px';
      draw(i);
    });
    cv.addEventListener('pointerleave', () => { tip.hidden = true; draw(-1); });
    return wrap;
  },
  scatter(hitErrors, W) {
    const { wrap, cv, tip } = this._setup(170);
    const pts = hitErrors.filter(e => !e[3]);
    const range = W[J.BAD];
    const t0 = pts.length ? pts[0][0] : 0, t1 = pts.length ? pts[pts.length - 1][0] : 1;
    let geo = null;
    const draw = hi => {
      const { x, w, h: H } = this._ctx(cv);
      const pad = { l: 40, r: 8, t: 8, b: 8 };
      const pw = w - pad.l - pad.r, ph = H - pad.t - pad.b;
      geo = { pad, pw, ph };
      const Y = e => pad.t + ph / 2 + clamp(e, -range, range) / range * ph / 2;
      for (let j = 3; j >= 0; j--) {
        x.fillStyle = JUDGEMENTS[j].color; x.globalAlpha = 0.05;
        x.fillRect(pad.l, Y(-W[j]), pw, Y(W[j]) - Y(-W[j]));
      }
      x.globalAlpha = 1;
      x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(pad.l, Y(0) - 0.5, pw, 1);
      x.fillStyle = this._css('--muted') || '#999'; x.font = '700 10px Torus, Outfit, system-ui'; x.textAlign = 'right';
      x.fillText(`-${Math.round(range)}`, pad.l - 6, pad.t + 9); x.fillText('0', pad.l - 6, Y(0) + 3); x.fillText(`+${Math.round(range)}`, pad.l - 6, H - pad.b);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const px = pad.l + (p[0] - t0) / Math.max(1, t1 - t0) * pw;
        x.fillStyle = JUDGEMENTS[p[2]].color;
        x.globalAlpha = hi === i ? 1 : 0.7;
        x.fillRect(px - 1.5, Y(p[1]) - 1.5, hi === i ? 5 : 3, hi === i ? 5 : 3);
      }
      x.globalAlpha = 1;
    };
    requestAnimationFrame(() => draw(-1));
    new ResizeObserver(() => draw(-1)).observe(cv);
    cv.addEventListener('pointermove', e => {
      if (!geo || !pts.length) return;
      const r = cv.getBoundingClientRect();
      const t = t0 + ((e.clientX - r.left) * Zoom.z - geo.pad.l) / geo.pw * (t1 - t0);
      let best = 0, bd = Infinity;
      for (let i = 0; i < pts.length; i++) { const d = Math.abs(pts[i][0] - t); if (d < bd) { bd = d; best = i; } }
      const p = pts[best];
      tip.hidden = false; tip.textContent = `${fmtTime(p[0])} · ${p[1] > 0 ? '+' : ''}${p[1]}ms · ${JUDGEMENTS[p[2]].name}`;
      tip.style.left = (e.clientX - r.left) * Zoom.z + 'px'; tip.style.top = (e.clientY - r.top) * Zoom.z + 'px';
      draw(best);
    });
    cv.addEventListener('pointerleave', () => { tip.hidden = true; draw(-1); });
    return wrap;
  },
  /** Vertical bars over categories (stats page). data: [{label, value, tip}] */
  bars(data, { height = 180, color = null } = {}) {
    const { wrap, cv, tip } = this._setup(height);
    let geo = null;
    const draw = hi => {
      const { x, w, h: H } = this._ctx(cv);
      const pad = { l: 34, r: 6, t: 10, b: 22 };
      const pw = w - pad.l - pad.r, ph = H - pad.t - pad.b;
      const intData = data.every(d => Number.isInteger(d.value));
      let max = Math.max(1, ...data.map(d => d.value));
      if (intData) max = Math.max(4, Math.ceil(max / 4) * 4);
      const bw = pw / data.length;
      const maxBar = 56;
      geo = { pad, pw, ph, bw };
      x.strokeStyle = 'rgba(255,255,255,.06)'; x.fillStyle = this._css('--muted') || '#999'; x.font = '700 10px Torus, Outfit, system-ui'; x.textAlign = 'right';
      for (let k = 0; k <= 4; k++) {
        const y = pad.t + ph * (1 - k / 4);
        x.beginPath(); x.moveTo(pad.l, y); x.lineTo(w - pad.r, y); x.stroke();
        x.fillText(intData ? fmtInt(max * k / 4) : String(Math.round(max * k / 4 * 10) / 10), pad.l - 5, y + 3);
      }
      const col = color || this._css('--accent') || '#b07cff';
      data.forEach((d, i) => {
        const hh = d.value / max * ph;
        const bwid = Math.max(1, Math.min(maxBar, bw - 2)), bx = pad.l + i * bw + (bw - bwid) / 2;
        x.fillStyle = d.color || col; x.globalAlpha = hi === i ? 1 : 0.82;
        if (hh > 0) { x.beginPath(); x.roundRect ? x.roundRect(bx, pad.t + ph - hh, bwid, hh, [Math.min(4, bwid / 2), Math.min(4, bwid / 2), 0, 0]) : x.rect(bx, pad.t + ph - hh, bwid, hh); x.fill(); }
      });
      x.globalAlpha = 1; x.textAlign = 'center'; x.fillStyle = this._css('--muted') || '#999';
      const every = Math.ceil(data.length / 10);
      data.forEach((d, i) => { if (i % every === 0 || data.length <= 12) x.fillText(d.label, pad.l + (i + 0.5) * bw, H - 6); });
    };
    requestAnimationFrame(() => draw(-1));
    new ResizeObserver(() => draw(-1)).observe(cv);
    cv.addEventListener('pointermove', e => {
      if (!geo) return;
      const r = cv.getBoundingClientRect();
      const i = Math.floor(((e.clientX - r.left) * Zoom.z - geo.pad.l) / geo.bw);
      if (i < 0 || i >= data.length) { tip.hidden = true; draw(-1); return; }
      tip.hidden = false; tip.textContent = data[i].tip || `${data[i].label}: ${data[i].value}`;
      tip.style.left = (e.clientX - r.left) * Zoom.z + 'px'; tip.style.top = (e.clientY - r.top) * Zoom.z + 'px';
      draw(i);
    });
    cv.addEventListener('pointerleave', () => { tip.hidden = true; draw(-1); });
    return wrap;
  },
  /** Line chart (single series). pts: [{x, y, tip}] */
  line(pts, { height = 180, yMin = null, yMax = null, fmtY = v => v, dots = true } = {}) {
    const { wrap, cv, tip } = this._setup(height);
    let geo = null;
    const draw = hi => {
      const { x, w, h: H } = this._ctx(cv);
      const pad = { l: 46, r: 10, t: 10, b: 10 };
      const pw = w - pad.l - pad.r, ph = H - pad.t - pad.b;
      const ys = pts.map(p => p.y);
      const lo = yMin ?? Math.min(...ys), hi2 = yMax ?? Math.max(...ys);
      const span = Math.max(1e-6, hi2 - lo);
      const X = i => pad.l + (pts.length < 2 ? pw / 2 : i / (pts.length - 1) * pw);
      const Y = v => pad.t + ph * (1 - (v - lo) / span);
      geo = { pad, pw, X };
      x.strokeStyle = 'rgba(255,255,255,.06)'; x.fillStyle = this._css('--muted') || '#999'; x.font = '700 10px Torus, Outfit, system-ui'; x.textAlign = 'right';
      for (let k = 0; k <= 4; k++) { const v = lo + span * k / 4, y = Y(v); x.beginPath(); x.moveTo(pad.l, y); x.lineTo(w - pad.r, y); x.stroke(); x.fillText(fmtY(v), pad.l - 5, y + 3); }
      const acc = this._css('--accent') || '#b07cff';
      x.strokeStyle = acc; x.lineWidth = 2; x.lineJoin = 'round'; x.beginPath();
      pts.forEach((p, i) => i ? x.lineTo(X(i), Y(p.y)) : x.moveTo(X(i), Y(p.y))); x.stroke();
      pts.forEach((p, i) => {
        if (!dots && hi !== i) return;
        x.fillStyle = this._css('--panel-solid') || '#111'; x.beginPath(); x.arc(X(i), Y(p.y), hi === i ? 6 : 4, 0, Math.PI * 2); x.fill();
        x.fillStyle = acc; x.beginPath(); x.arc(X(i), Y(p.y), hi === i ? 4.5 : 3, 0, Math.PI * 2); x.fill();
      });
    };
    requestAnimationFrame(() => draw(-1));
    new ResizeObserver(() => draw(-1)).observe(cv);
    cv.addEventListener('pointermove', e => {
      if (!geo || !pts.length) return;
      const r = cv.getBoundingClientRect(), mx = (e.clientX - r.left) * Zoom.z;
      let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = Math.abs(geo.X(i) - mx); if (d < bd) { bd = d; best = i; } });
      tip.hidden = false; tip.textContent = pts[best].tip;
      tip.style.left = geo.X(best) + 'px'; tip.style.top = (e.clientY - r.top) * Zoom.z + 'px';
      draw(best);
    });
    cv.addEventListener('pointerleave', () => { tip.hidden = true; draw(-1); });
    return wrap;
  },
};
