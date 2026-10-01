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
    // osu!lazer: the score panel opens in the middle; clicking it slides it aside for the statistics (and back)
    const grid = h('div.res-grid');
    const card = this.gradeCard(s, p);
    card.title = 'Click for statistics';
    card.addEventListener('click', e => {
      if (e.target.closest('button, a, input')) return;
      UISounds.click();
      grid.classList.toggle('stats-open');
      card.title = grid.classList.contains('stats-open') ? 'Click to hide statistics' : 'Click for statistics';
    });
    grid.append(card, this.rightCol(s));
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
  /** osu!lazer's expanded score panel: the player on top; then the beatmap, the accuracy circle (grade segments
   *  around it, the grade in the middle), mods, the score and the statistics. Colours are lazer's rank colours. */
  gradeCard(s, p) {
    const RANK = RANK_COLOURS;
    const letter = s.grade === 'XH' ? 'SS' : s.grade === 'SH' ? 'S' : s.grade;
    const rc = RANK[s.grade] || '#fff';
    // the player
    const mine = !p.watched || p.watched === 'replay' && s.player === ProfileManager.profile.name;
    const av = mine && s.player === ProfileManager.profile.name ? ProfileManager.avatarEl(64) : h('span.rs-initial', (s.player || '?')[0].toUpperCase());
    const top = h('div.rs-top', av, h('div.rs-who', h('div.rs-name', s.player || 'Player'), h('div.rs-when', `Played on ${fmtDateTime(s.date)}`)),
      p.watched ? h('span.rs-tag', p.watched === 'auto' ? 'AUTO' : 'REPLAY') : null);
    // accuracy circle (lazer's AccuracyCircle): the accuracy fills the thick outer ring; just inside it the grade
    // thresholds are coloured segments (SS shown as a virtual 1% so it's visible); each rank's badge pops in when the
    // fill passes it, so only the ranks you reached show up. Positions and sizes follow lazer's relative values.
    const VSS = 0.01, GAP = 2 / 360, R = 108, W = 0.2 * 120, C = 2 * Math.PI * R, R2 = 0.8 * 120 - 2.5 - 2.4, C2 = 2 * Math.PI * R2;
    const segs = [[0, 0.7, RANK.D], [0.7, 0.8, RANK.C], [0.8, 0.9, RANK.B], [0.9, 0.95, RANK.A], [0.95, 1 - VSS, RANK.S], [1 - VSS, 1, RANK.X]];
    const arc = (a, b, col) => `<circle cx="120" cy="120" r="${R2.toFixed(1)}" fill="none" stroke="${col}" stroke-width="4.8" stroke-dasharray="${Math.max(0.5, (b - a - GAP) * C2).toFixed(2)} ${C2.toFixed(2)}" stroke-dashoffset="${(-(a + GAP / 2) * C2).toFixed(2)}"/>`;
    // an SS can be under 100% (a 300 counts a little less than a MAX): lazer fills the circle for it anyway
    const isSS = ['XH', 'X', 'SS'].includes(s.grade);
    const acc = isSS || s.accuracy >= 1 ? 1 : Math.min(s.accuracy, 1 - VSS);
    const fillMs = 1400 * (Settings.get('ui.animSpeed') > 0 ? 1 / Settings.get('ui.animSpeed') : 0);
    const ring = h('div.rs-ring');
    ring.innerHTML = `<svg viewBox="0 0 240 240"><defs><linearGradient id="rsg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cf6ff"/><stop offset="1" stop-color="#baffa9"/></linearGradient></defs>
      <circle cx="120" cy="120" r="${R - 1.2}" fill="none" stroke="rgba(47,47,47,.5)" stroke-width="${W + 2.4}"/>
      <circle class="accring" cx="120" cy="120" r="${R}" fill="none" stroke="url(#rsg)" stroke-width="${W}" stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition: stroke-dashoffset ${fillMs}ms cubic-bezier(.1,1,.2,1)"/>
      ${segs.map(([a, b, c]) => arc(a, b, c)).join('')}</svg>`;
    // badges sit on an ellipse just outside the ring; A and S are nudged down so they don't collide with SS (as lazer does)
    const badges = [['D', 0, 0.35], ['C', 0.7, 0.75], ['B', 0.8, 0.85], ['A', 0.9, 0.9125], ['S', 0.95, 0.96], ['SS', 1, 1]];
    for (const [g, cut, at] of badges) {
      if (g === 'SS' ? !isSS && s.accuracy < 1 : s.accuracy < cut && !isSS) continue;
      const ang = (at * 360 - 90) * Math.PI / 180;
      // when the (eased) fill reaches this rank's cutoff
      const t = cut <= 0 ? 0 : 1 - Math.pow(1 - Math.min(1, cut / acc), 1 / 5);
      ring.append(h(`span.rs-badge${g === letter ? '.on' : ''}`, { style: { left: `${50 + Math.cos(ang) * 50 * 140 / 120}%`, top: `${50 + Math.sin(ang) * 50 * 135 / 120}%`, '--rc': RANK[g === 'SS' ? 'X' : g], '--rt': RANK_INK[g], animationDelay: `${Math.round(t * fillMs)}ms` } }, g));
    }
    ring.append(h('div.rs-grade', { style: { '--rc': rc, animationDelay: `${Math.round(fillMs * 0.55)}ms` } }, letter));
    requestAnimationFrame(() => requestAnimationFrame(() => { const c = ring.querySelector('.accring'); if (c) c.style.strokeDashoffset = C * (1 - acc); }));
    // score, counted up (in the skin's number font when it has one)
    const scoreEl = h('div.res-score', '0');
    let digits = null;
    SkinManager.scoreFont().then(f => { if (!f) return; digits = skinDigits(f, 44, { align: 'center' }); scoreEl.classList.add('skinned'); scoreEl.replaceChildren(digits.el); digits.set(fmtScore(shown)); }).catch(() => {});
    let shown = 0;
    const t0 = performance.now(), dur = 1100 * (Settings.get('ui.animSpeed') > 0 ? 1 / Settings.get('ui.animSpeed') : 0);
    const tick = () => {
      const k = dur ? clamp((performance.now() - t0) / dur, 0, 1) : 1;
      shown = ScoreManager.value(s) * (1 - Math.pow(1 - k, 3));
      if (digits) digits.set(fmtScore(shown)); else scoreEl.textContent = fmtScore(shown);
      if (k < 1) this._cnt = requestAnimationFrame(tick);
    };
    tick();
    const pp = ScoreManager.ppOf(s);
    const stat = (k, v, title) => h('div.rs-stat', { title: title || '' }, h('div.k', k), h('div.v', v));
    const counts = s.counts || [0, 0, 0, 0, 0, 0];
    const mid = h('div.rs-mid',
      h('div.rs-map',
        h('div.rs-title', s.title), h('div.rs-artist', s.artist),
        h('div.rs-diff', starBadge(s.stars || 0), h('span.rs-version', { title: s.version }, s.version)),
        h('div.rs-mapper', h('span.muted', `${s.keys}K · mapped by `), h('b', s.creator || '?'))),
      ring,
      (s.mods || []).length ? h('div.rs-mods', ...s.mods.map(m => ModSystem.badge(m, false, s.modConfig || null))) : null,
      !s.passed ? h('div.rs-failed', 'FAILED') : null,
      scoreEl,
      h('div.rs-stats',
        stat('Accuracy', fmtAcc(s.accuracy)),
        stat('Max combo', fmtInt(s.maxCombo) + 'x'),
        stat('pp', fmtInt(pp), !s.passed || (s.mods || []).includes('AT') ? 'pp is only awarded for passes (not Auto)' : '')),
      h('div.rs-judges', ...JUDGEMENTS.map((j, i) => h('div.rs-j', h('div.k', { style: { color: j.color } }, j.short), h('div.v', fmtInt(counts[i]))))));
    if (p.fresh && s.passed && s.totalPpAfter != null && s.totalPpBefore != null) {
      const d = s.totalPpAfter - s.totalPpBefore;
      mid.append(h('div.muted.res-ppdelta', `Total ${fmtInt(s.totalPpAfter)}pp (${d >= 0.5 ? '+' + fmtInt(d) : d <= -0.5 ? fmtInt(d) : '±0'})`));
    }
    if (s.isPB && p.fresh) mid.append(h('div.res-pb', '★ NEW PERSONAL BEST'));
    else if (s.prevBest && p.fresh && s.passed) {
      const me = ScoreManager.value(s), best = ScoreManager.value(s.prevBest);
      mid.append(h('div.muted.res-prev', `Personal best: ${fmtScore(best)} (${me >= best ? '+' : ''}${fmtInt(me - best)})`));
    }
    // osu!lazer: calibrate this beatmap's offset from the play you just finished
    const sug = p.fresh ? MapOffsets.suggestion(s.mapHash) : null;
    if (sug != null) {
      const cur = MapOffsets.get(s.mapHash);
      mid.append(h('button.btn.sm.res-calib', { title: 'Shifts this beatmap\'s offset by your average hit error', onclick: async e => {
        const btn = e.currentTarget;
        await MapOffsets.set(s.mapHash, cur + sug); MapOffsets.last = null; UISounds.click();
        btn.replaceWith(h('div.muted.res-calib', icon('check'), `Beatmap offset is now ${cur + sug > 0 ? '+' : ''}${cur + sug}ms`));
      } }, icon('clock'), `You hit ${Math.abs(sug)}ms ${sug > 0 ? 'late' : 'early'} on average · fix offset`));
    }
    return h('div.rs', { style: { '--rc': rc } }, top, mid);
  },
  rightCol(s) {
    const col = h('div.res-right', h('div.rs-head', 'Statistics'));
    const errs = (s.hitErrors || []).filter(e => !e[3]);
    const W = (s.windows || timingWindows({ od: s.od ?? 8 })).slice();
    const hist = h('div.panel.glass.chart-card', h('h3', 'Hit distribution'));
    const scatter = h('div.panel.glass.chart-card', h('h3', 'Timing over time', h('span.grow'), h('span', 'early ↑ · late ↓')));
    if (errs.length) {
      hist.append(Charts.histogram(errs.map(e => e[1]), W, s.meanError || 0));
      // lazer's statistic items under the graph: unstable rate and the average hit error (early / late)
      const me = s.meanError || 0;
      hist.append(h('div.res-stats',
        h('div.res-stat', h('span', 'Unstable rate'), h('b', (s.unstableRate || 0).toFixed(2))),
        h('div.res-stat', h('span', 'Average hit error'), h('b', `${Math.abs(me).toFixed(2)} ms ${Math.abs(me) < 0.005 ? '' : me < 0 ? 'early' : 'late'}`.trim())),
        h('div.res-stat', h('span', 'Timed hits'), h('b', fmtInt(errs.length)))));
      scatter.append(Charts.scatter(s.hitErrors, W));
      scatter.append(h('div.chart-legend', ...JUDGEMENTS.slice(0, 5).map(j => h('span', { style: { '--c': j.color } }, j.short))));
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
    bar.append(h('button.btn.ghost.res-share', { onclick: () => ShareCard.open(s), title: 'A picture of this result to copy or save' }, icon('upload'), 'Share'));
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

/** A 1200×630 picture of a result (the size link previews use), to copy, save or share anywhere. */
const ShareCard = {
  W: 1200, H: 630,
  async render(s) {
    const W = this.W, H = this.H;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const F = (w, px) => `${w} ${px}px Outfit, "Segoe UI", system-ui, sans-serif`;
    try { await Promise.all([800, 700, 500].map(w => document.fonts.load(F(w, 40)))); } catch (e) { /* system font */ }
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff66ab';
    // background: the beatmap's picture, blurred and darkened
    x.fillStyle = '#18171c'; x.fillRect(0, 0, W, H);
    const map = BeatmapManager.mapByHash(s.mapHash);
    const url = map ? await BeatmapManager.bgURL(map).catch(() => null) : null;
    const img = url ? await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = url; }) : null;
    if (img && img.naturalWidth) {
      const k = Math.max(W / img.naturalWidth, H / img.naturalHeight) * 1.08;
      const iw = img.naturalWidth * k, ih = img.naturalHeight * k;
      x.save(); x.filter = 'blur(8px)'; x.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih); x.restore();
    }
    let g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(14,11,22,.93)'); g.addColorStop(0.55, 'rgba(14,11,22,.78)'); g.addColorStop(1, 'rgba(14,11,22,.62)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = accent; x.fillRect(0, 0, W, 6);
    const text = (t, px, y, { w = 700, color = '#fff', align = 'left', max = 0, xPos = 60 } = {}) => {
      x.font = F(w, px); x.fillStyle = color; x.textAlign = align; x.textBaseline = 'alphabetic';
      let str = String(t);
      if (max) while (str.length > 1 && x.measureText(str).width > max) str = str.slice(0, -2) + '…';
      x.fillText(str, xPos, y);
      return x.measureText(str).width;
    };
    const pill = (label, px, y, bg, fg = '#fff', h = 30, font = 16) => {
      x.font = F(700, font); const w = x.measureText(label).width + 22;
      x.fillStyle = bg; x.beginPath(); x.roundRect ? x.roundRect(px, y, w, h, h / 2) : x.rect(px, y, w, h); x.fill();
      x.fillStyle = fg; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(label, px + 11, y + h / 2 + 1); x.textBaseline = 'alphabetic';
      return w;
    };
    // beatmap
    text(s.title || 'Unknown', 44, 92, { w: 800, max: 760 });
    text(`${s.artist || ''}${s.creator ? ` · mapped by ${s.creator}` : ''}`, 24, 128, { w: 500, color: 'rgba(255,255,255,.75)', max: 760 });
    let px = 60;
    const sr = s.stars || 0, sc = starColour(sr);
    px += pill(`★ ${sr.toFixed(2)}`, px, 150, sc, sr >= 6.5 ? '#ffd966' : '#1a1a1a') + 8;
    px += pill(`[${s.version}]`, px, 150, 'rgba(255,255,255,.12)') + 8;
    px += pill(`${s.keys}K`, px, 150, 'rgba(255,255,255,.12)') + 8;
    for (const m of s.mods || []) { const d = MOD_BY_ID.get(m); px += pill(m, px, 150, d ? d.color : accent, '#1a1a1a') + 6; }
    // grade
    const label = s.grade === 'XH' ? 'SS' : s.grade === 'SH' ? 'S' : s.grade;
    const rc = RANK_COLOURS[s.grade] || '#fff', fill = ['#fff', rc];
    x.font = F(800, 210); x.textAlign = 'center';
    g = x.createLinearGradient(0, 250, 0, 450); g.addColorStop(0, fill[0]); g.addColorStop(1, fill[1] || fill[0]);
    x.save(); x.shadowColor = fill[fill.length - 1]; x.shadowBlur = 40; x.fillStyle = g; x.fillText(label, 200, 440); x.restore();
    if (!s.passed) pill('FAILED', 150, 470, '#ff3b4f');
    // score and stats
    text(fmtScore(ScoreManager.value(s)), 76, 300, { w: 800, xPos: 380 });
    const stat = (k, v, i) => { const sx = 380 + i * 190; text(k, 17, 350, { w: 600, color: 'rgba(255,255,255,.6)', xPos: sx }); text(v, 34, 390, { w: 700, xPos: sx }); };
    const pp = ScoreManager.ppOf(s);
    stat('Accuracy', fmtAcc(s.accuracy), 0); stat('Max combo', fmtInt(s.maxCombo) + 'x', 1); stat('pp', fmtInt(pp), 2);
    if (s.unstableRate) stat('UR', s.unstableRate.toFixed(1), 3);
    // judgements
    const counts = s.counts || [0, 0, 0, 0, 0, 0];
    JUDGEMENTS.forEach((j, i) => {
      const jx = 380 + (i % 3) * 250, jy = 450 + Math.floor(i / 3) * 44;
      x.fillStyle = j.color; x.beginPath(); x.arc(jx + 7, jy - 7, 7, 0, Math.PI * 2); x.fill();
      text(j.short, 20, jy, { w: 600, color: 'rgba(255,255,255,.8)', xPos: jx + 24 });
      text(fmtInt(counts[i]), 22, jy, { w: 800, xPos: jx + 215, align: 'right' });
    });
    // footer
    x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(0, H - 64, W, 64);
    text(`played by ${s.player || 'Player'} · ${new Date(s.date).toLocaleDateString()}`, 20, H - 25, { w: 600, color: 'rgba(255,255,255,.8)' });
    const bw = text('mania', 22, H - 25, { w: 500, color: 'rgba(255,255,255,.85)', xPos: W - 60, align: 'right' });
    text('ashtonk!', 30, H - 25, { w: 800, color: accent, xPos: W - 64 - bw, align: 'right' });
    return new Promise(r => c.toBlob(r, 'image/png'));
  },
  fileName(s) { return `${s.artist} - ${s.title} [${s.version}] ${fmtAcc(s.accuracy)}.png`.replace(/[\\/:*?"<>|]/g, '_'); },
  /** Preview with Copy / Save / Share (the system share sheet, where the browser has one). */
  async open(s) {
    UISounds.click();
    const blob = await this.render(s);
    if (!blob) { Toast.err('Couldn\'t draw the result card'); return; }
    const url = URL.createObjectURL(blob);
    const file = new File([blob], this.fileName(s), { type: 'image/png' });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    const copy = async () => {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); Toast.ok('Result card copied', 'Paste it anywhere.'); }
      catch (e) { Toast.err('Couldn\'t copy the image', 'Your browser blocked it — use Save instead.'); }
    };
    const o = Dialog.custom('Share your result', h('img.share-card', { src: url, alt: 'Result card' }), [
      { label: 'Close' },
      ...(canShare ? [{ label: 'Share…', onClick: () => navigator.share({ files: [file], title: `${s.title} [${s.version}]` }).catch(() => {}) }] : []),
      { label: 'Save PNG', onClick: () => downloadBlob(blob, file.name) },
      ...(navigator.clipboard && window.ClipboardItem ? [{ label: 'Copy image', primary: true, onClick: copy }] : []),
    ]);
    const close = o.close;
    o.close = () => { URL.revokeObjectURL(url); close(); };
    return o;
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
    // lazer's HitEventTimingDistributionGraph: 50 bins either side of a centre bin, sized from the widest hit
    const SIDE = 50, nb = SIDE * 2 + 1;
    const maxAbs = Math.max(1, ...errs.map(e => Math.abs(e)));
    const bin = Math.max(1, Math.ceil(maxAbs / SIDE));
    const range = (SIDE + 0.5) * bin;
    const bins = new Array(nb).fill(0);
    for (const e of errs) bins[clamp(Math.round(e / bin) + SIDE, 0, nb - 1)]++;
    const max = Math.max(...bins, 1);
    const colourAt = c => { let j = 0; while (j < 5 && Math.abs(c) > W[j]) j++; return JUDGEMENTS[Math.min(j, 4)].color; };
    let geo = null;
    const draw = hover => {
      const { x, w, h: H } = this._ctx(cv);
      const pad = { l: 8, r: 8, t: 8, b: 20 };
      const pw = w - pad.l - pad.r, ph = H - pad.t - pad.b;
      const bw = pw / nb;
      geo = { pad, pw, ph, bw };
      x.strokeStyle = 'rgba(255,255,255,.06)'; x.lineWidth = 1;
      for (let k = 1; k <= 3; k++) { const y = pad.t + ph * (1 - k / 4); x.beginPath(); x.moveTo(pad.l, y); x.lineTo(w - pad.r, y); x.stroke(); }
      const bwid = Math.max(1, bw * 0.7), rad = bwid / 2;
      bins.forEach((v, i) => {
        const bx = pad.l + i * bw + (bw - bwid) / 2;
        x.fillStyle = colourAt((i - SIDE) * bin);
        // empty bins stay as faint dots so the shape of the window still reads
        const hh = v ? Math.max(bwid, v / max * ph) : bwid;
        x.globalAlpha = !v ? 0.18 : hover === i ? 1 : 0.85;
        x.beginPath();
        x.roundRect ? x.roundRect(bx, pad.t + ph - hh, bwid, hh, rad) : x.rect(bx, pad.t + ph - hh, bwid, hh);
        x.fill();
      });
      x.globalAlpha = 1;
      const zx = pad.l + pw / 2;
      x.fillStyle = 'rgba(255,255,255,.28)'; x.fillRect(zx - 0.5, pad.t, 1, ph);
      const mx = pad.l + clamp((mean + range) / (2 * range), 0, 1) * pw;
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
      const c = (i - SIDE) * bin;
      tip.hidden = false; tip.textContent = `${bin > 1 ? `${c - Math.floor(bin / 2)} to ${c + Math.ceil(bin / 2) - 1}` : c}ms: ${bins[i]} hit${bins[i] === 1 ? '' : 's'}`;
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
