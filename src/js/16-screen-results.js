/* Results screen — grade, score, judgement breakdown, timing distribution & timing-over-time graphs,
 * personal-best tracking and replay actions. */

const ResultsScreen = {
  // (never gone back to: it shows one play, and Back from a screen opened after it — a retry, your profile — used to
  // reopen it without its score and crash the game)
  transient: true,
  // (the top bar marks where you came from: song select, or the profile or replays a score was opened from)
  get tab() { const b = this.p && this.p.back; return b && b.name !== 'results' ? b.name : 'songselect'; },
  enter(p) {
    // (nothing to show — opened without a score: song select instead of a crash)
    if (!p || !p.score) { this.p = { score: {} }; const out = () => Screens.busy ? setTimeout(out, 30) : Screens.go('songselect', {}, { replace: true }); setTimeout(out, 0); return h('div.results'); }
    this.p = p;
    const s = p.score;
    const map = BeatmapManager.mapByHash(s.mapHash);
    const el = this._el = h('div.results');
    // (a score on a beatmap you don't have — someone else's, from their profile — shows that beatmap's cover from osu!,
    // never the background of the song that happens to be playing)
    if (map) BeatmapManager.bgURL(map).then(u => Background.set(u));
    else if (!p.mp) { Background.set(s.onlineSetId > 0 ? OnlineBeatmaps.coverURL(s.onlineSetId, 'cover@2x') : null); this._foreignBg = true; }
    const body = h('div.res-body');
    // osu!lazer: the score panel opens in the middle; clicking it slides it aside for the statistics (and back)
    const grid = h('div.res-grid');
    const card = this.gradeCard(s, p);
    this.statsToggle(card, grid);
    grid.append(card, this.rightCol(s));
    body.append(grid);
    if (p.mp) { body.classList.add('mp'); MpResults.mount(body, grid, card, s); }
    else if (!p.watched && s.mapHash) MpResults.mountLocal(grid, card, s);
    const actions = this.actions(s, p, map);
    el.append(body, actions);
    // (Neru's reaction to the play you've just finished — not to a replay, someone else's play or a match)
    if (!this._swapping) {
      // (one of her own songs: delighted you passed it — sunglasses still for an SS — and sulking if you failed it)
      // (727 — when you see it: she points it out, NeruEggs.wysi)
      const mood = NeruCameo.moodOf(s), hers = NeruEggs.herSong(map), wysi = p.fresh && !p.mp && !p.watched && NeruEggs.wysi(s);
      if (wysi) NeruEggs.found('wysi');
      this._neru = p.fresh && !p.mp && !p.watched ? NeruCameo.make(wysi ? 'wysi' : hers && mood === 'failed' ? 'herSongFail' : hers && mood !== 'perfect' ? 'herSongPass' : mood, 'nc-results', { delay: 1500, poke: NeruEggs.resultsPoke(s) }) : null;
      if (this._neru) el.append(this._neru);
      // (a Teto or Miku fan's fail or poor play: she laughs, their thing crossed out — they won't save you)
      const fan = this._neru && !wysi && !hers && (mood === 'failed' || mood === 'bad') && NeruEggs.fanOf();
      if (fan) NeruEggs.propOn(this._neru, fan.who, 2200);
    }
    this.fitToScreen(body, grid);
    if (!this._swapping) this._origP = p; // (the results as they opened: switching back to that score restores them)
    if (p.fresh && s.passed && !this._swapping) setTimeout(() => Screens.currentName === 'results' && SkinManager.sample(s.accuracy >= 0.95 ? 'applause' : 'sectionpass').then(b => b && AudioManager.play(b, { volume: 0.6 })), 1300);
    return el;
  },
  /** Clicking the big panel slides it aside for the statistics, and back (any card that becomes the big one). */
  statsToggle(card, grid) {
    card.title = grid.classList.contains('stats-open') ? 'Click to hide statistics' : 'Click for statistics';
    card.addEventListener('click', e => {
      if (e.target.closest('button, a, input')) return;
      UISounds.click();
      grid.classList.toggle('stats-open');
      // (the panel slides over to where Neru stands: she steps aside meanwhile)
      const r = grid.closest('.results'); if (r) r.classList.toggle('stats-open', grid.classList.contains('stats-open'));
      card.title = grid.classList.contains('stats-open') ? 'Click to hide statistics' : 'Click for statistics';
    });
  },
  /** Never scroll: the panels shrink as one to fit whatever space is left (opening the statistics, or more of them,
   *  or a small window / phone), the way lazer's results always sit whole on screen — and the wide card a phone held
   *  sideways gets grows a little into the room it has. */
  fitToScreen(body, grid) {
    let raf = 0, shown = false;
    // (one observer per screen: the next results screen enters before this one leaves)
    const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(fit); });
    const fit = () => {
      raf = 0;
      if (!grid.isConnected) { if (shown) ro.disconnect(); return; } // (left: done)
      shown = true;
      const cs = getComputedStyle(body);
      const aw = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      // (a multiplayer results screen has its title and the match's lines above the panels: they take their room)
      let others = 0;
      for (const c of body.children) if (c !== grid && c.offsetParent) others += c.offsetHeight + (parseFloat(cs.rowGap) || 0);
      const ah = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - others;
      // (the wide card of a short, wide screen — a phone held sideways — may grow into the room it leaves, too)
      const grow = !grid.classList.contains('stats-open') && matchMedia('(max-height: 520px) and (min-aspect-ratio: 3/2)').matches ? 1.3 : 1;
      const k = Math.max(0.35, Math.min(grow, aw / grid.offsetWidth, ah / grid.offsetHeight));
      const on = Math.abs(k - 1) > 0.005;
      grid.style.scale = on ? k.toFixed(4) : '';
      // (shrunk from the top, and giving back the height it no longer uses, so the column stays centred on screen)
      if (others) { grid.style.transformOrigin = on ? '50% 0' : ''; grid.style.marginBottom = on ? `${(-grid.offsetHeight * (1 - k)).toFixed(1)}px` : ''; }
    };
    ro.observe(body); ro.observe(grid);
  },
  /** lazer's results: picking another score's panel makes it the big one in the middle — it grows out of where the
   *  small panel was, while the score that was big shrinks back into the row. */
  swapTo(score, fromEl) {
    const old = this._el, oldScore = this.p.score;
    if (!old || !old.isConnected || score === oldScore) return;
    const fromRect = fromEl && fromEl.getBoundingClientRect(), oldCard = old.querySelector('.res-grid > .rs'), oldRect = oldCard && oldCard.getBoundingClientRect();
    (this._srcs || []).forEach(x => { try { x.stop(); } catch {} }); this._srcs = [];
    // (the screen keeps its own element — the one the screen manager removes on leaving — and takes the new contents)
    const base = this._origP, back = base && score === base.score;
    this._swapping = true;
    let built;
    try { built = this.enter(back ? base : { ...this.p, score, fromList: true, fresh: false, replay: null }); } finally { this._swapping = false; }
    old.replaceChildren(...built.childNodes);
    if (this._neru) old.append(this._neru);
    this._el = old;
    const fresh = old;
    requestAnimationFrame(() => {
      const fly = (el, from) => {
        if (!el || !from) return;
        const to = el.getBoundingClientRect();
        if (!to.width || !to.height) return;
        const sx = from.width / to.width, sy = from.height / to.height, dx = from.left - to.left, dy = from.top - to.top;
        el.animate([{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.6 }, { transformOrigin: '0 0', transform: 'none', opacity: 1 }],
          { duration: 450, easing: 'cubic-bezier(.22, 1, .36, 1)' });
      };
      fly(fresh.querySelector('.res-grid > .rs'), fromRect);
      fly(fresh.querySelector(`.cp[data-sid="${CSS.escape(String(oldScore.id))}"]`), oldRect);
    });
  },
  leave() {
    // (that cover was only for this score: the screen you go back to shows the playing song's background again)
    if (this._foreignBg) { this._foreignBg = false; const mm = Music.meta && BeatmapManager.maps.get(Music.meta.mapId); if (mm) BeatmapManager.bgURL(mm).then(u => { if (Screens.currentName !== 'results') Background.set(u); }); }
    (this._offs || []).forEach(f => f()); this._offs = []; MpResults.unmount(); cancelAnimationFrame(this._cnt); (this._srcs || []).forEach(x => { try { x.stop(); } catch {} }); this._srcs = []; },
  /** lazer's results sounds: a tick each step of the accuracy circle (slowing down and rising in pitch as the
   *  fill eases out), then the rank's impact as the grade lands. */
  async introSounds(acc, fillMs, failed) {
    (this._srcs || []).forEach(x => { try { x.stop(); } catch { /* ended */ } });
    const tok = this._sndTok = {};
    this._srcs = [];
    if (!fillMs || !Settings.get('audio.uiSounds') || !AudioManager.ctx || AudioManager.ctx.state !== 'running') return;
    const [tick, impact] = await Promise.all([UISounds._get('score-tick'), UISounds._get(failed ? 'rank-impact-fail' : 'rank-impact-pass')]);
    if (Screens.currentName !== 'results' || tok !== this._sndTok) return;
    const t0 = AudioManager.ctx.currentTime + 0.03, N = Math.max(1, Math.round(acc * 40));
    let last = -1;
    for (let k = 1; k <= N; k++) {
      const f = k / N, t = (1 - Math.pow(1 - f, 1 / 5)) * fillMs; // (when the eased fill reaches f)
      if (t - last < 38 || t > fillMs * 0.55) continue;
      last = t;
      this._srcs.push(AudioManager.play(tick, { bus: 'ui', when: t0 + t / 1000, rate: 0.9 + 0.6 * f * acc, volume: 0.7 }));
    }
    this._srcs.push(AudioManager.play(impact, { bus: 'ui', when: t0 + (fillMs * 0.55 + 180) / 1000 }));
    this._srcs = this._srcs.filter(Boolean);
  },
  onKey(e) {
    if (this.p.mp || this.p.browse || this.p.spectated) return false; // (a room's match isn't yours to retry; nor, as in lazer, a score opened from a leaderboard or profile, or a play you watched)
    if (e.repeat) return true; // (a column key still held as the song ended)
    if ((e.code === 'Enter' || e.code === 'Space') && e.target && e.target.closest && e.target.closest('button, summary, a, input, select')) return false;
    if (e.code === 'KeyR' || (e.ctrlKey && e.code === 'KeyR')) { this.retry(); return true; }
    if (e.code === 'Enter' || e.code === 'Space') { this.retry(); return true; }
    return false;
  },
  onBack() { if (this.p.back) Screens.go(this.p.back.name, this.p.back.params, { replace: true }); else if (this.p.mp && Multiplayer.inRoom()) Screens.go('multiplayer', {}, { replace: true }); else Screens.go('songselect', { mapId: this.p.score.mapId }, { replace: true }); return true; },
  retry() {
    const s = this.p.score;
    const map = BeatmapManager.mapByHash(s.mapHash);
    if (!map) { Toast.err('Beatmap not found', 'This beatmap is no longer in your library.'); return; }
    UISounds.click();
    Game.launch({ mapId: map.id, mods: this.p.watched === 'auto' ? s.mods : s.mods.filter(m => m !== 'AT'), modConfig: s.modConfig || undefined, mode: 'play', back: this.p.back && this.p.back.name !== 'results' ? this.p.back : null, daily: this.p.daily || undefined }); // (a retry still counts for the daily challenge)
  },
  /** osu!lazer's expanded score panel: the player on top; then the beatmap, the accuracy circle (grade segments
   *  around it, the grade in the middle), mods, the score and the statistics. Colours are lazer's rank colours. */
  gradeCard(s, p) {
    const RANK = RANK_COLOURS;
    const letter = gradeLabel(s.grade);
    const rc = RANK[s.grade] || '#fff';
    // the player
    const mine = !p.watched || p.watched === 'replay' && s.player === ProfileManager.profile.name;
    const av = (mine || s.own) && s.player === ProfileManager.profile.name ? ProfileManager.avatarEl(80) : s.online ? Presence.avatarEl({ name: s.player, avatar: s.avatar }, 80) : h('span.rs-initial', (s.player || '?')[0].toUpperCase());
    // lazer's ExpandedPanelTopContent: an 80px picture (corners of 20) straddling the top of the panel, the name under it
    const top = h('div.rs-top', h('div.rs-av', av), h('div.rs-name', s.player || 'Player'),
      p.watched && p.watched !== 'online' && !p.spectated ? h('span.rs-tag', p.watched === 'auto' ? 'AUTO' : 'REPLAY') : null); // (a play you watched live isn't a replay)
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
    // badges sit on an ellipse just outside the ring, spaced so S and SS (95% and 100%, close together at the top) never
    // touch, nor A and S
    const badges = [['D', 0, 0.35], ['C', 0.7, 0.75], ['B', 0.8, 0.85], ['A', 0.9, 0.905], ['S', 0.95, 0.952], ['SS', 1, 1]];
    for (const [g, cut, at] of badges) {
      if (g === 'SS' ? !isSS && s.accuracy < 1 : s.accuracy < cut && !isSS) continue;
      const ang = (at * 360 - 90) * Math.PI / 180;
      // when the (eased) fill reaches this rank's cutoff
      const t = cut <= 0 ? 0 : 1 - Math.pow(1 - Math.min(1, cut / acc), 1 / 5);
      ring.append(h(`span.rs-badge${g === letter ? '.on' : ''}`, { style: { left: `${50 + Math.cos(ang) * 50 * 140 / 120}%`, top: `${50 + Math.sin(ang) * 50 * 135 / 120}%`, '--rc': RANK[g === 'SS' ? 'X' : g], '--rt': RANK_INK[g], animationDelay: `${Math.round(t * fillMs)}ms` } }, g));
    }
    ring.append(h('div.rs-grade', { style: { '--rc': rc, animationDelay: `${Math.round(fillMs * 0.55)}ms` } }, letter));
    requestAnimationFrame(() => requestAnimationFrame(() => { const c = ring.querySelector('.accring'); if (c) c.style.strokeDashoffset = C * (1 - acc); }));
    this.introSounds(acc, fillMs, ['D', 'F'].includes(s.grade));
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
    const pp = s.online && s.pp != null ? s.pp : ScoreManager.ppOf(s); // (someone else's play: the pp their profile lists)
    const stat = (k, v, title) => h('div.rs-stat', { title: title || '' }, h('div.k', k), h('div.v', v));
    const counts = s.counts || [0, 0, 0, 0, 0, 0];
    // lazer's ExpandedPanelMiddleContent: title and artist, the accuracy circle 40px below, the score, the star rating
    // with the mods, the difficulty and mapper, then the statistics under their little #222 pill headers
    const mid = h('div.rs-mid',
      h('div.rs-map', h('div.rs-title', s.title), h('div.rs-artist', s.artist)),
      ring,
      !s.passed ? h('div.rs-failed', 'FAILED') : null,
      scoreEl,
      h('div.rs-diff', starBadge(s.stars || 0), h('span.keys-tag', `${s.keys}K`),
        ...((s.mods || []).length ? [h('div.rs-mods', ...s.mods.map(m => ModSystem.badge(m, false, s.modConfig || null)))] : [])),
      h('div.rs-dv', h('div.rs-version', { title: s.version }, s.version), h('div.rs-mapper', 'mapped by ', h('b', s.creator || '?'))),
      h('div.rs-stats',
        stat('Accuracy', fmtAcc(s.accuracy)),
        stat('Max combo', fmtInt(s.maxCombo) + 'x'),
        stat('pp', fmtInt(pp), !s.passed || (s.mods || []).includes('AT') ? 'pp is only awarded for passes (not Auto)' : '')),
      h('div.rs-judges', ...JUDGEMENTS.map((j, i) => h('div.rs-j', h('div.k', { style: { color: j.color } }, j.short), h('div.v', fmtInt(counts[i]))))));
    if (p.fresh && s.passed && s.totalPpAfter != null && s.totalPpBefore != null && Math.round(s.totalPpAfter) > 0) {
      const d = s.totalPpAfter - s.totalPpBefore;
      mid.append(h('div.muted.res-ppdelta', `Total ${fmtInt(s.totalPpAfter)}pp (${d >= 0.5 ? '+' + fmtInt(d) : d <= -0.5 ? fmtInt(d) : '±0'})`));
    }
    // lazer: where the play stands on the beatmap's global ranking, once the server has judged it
    if (p.fresh && s.passed && !(s.mods || []).includes('AT') && typeof Verified !== 'undefined') {
      const el = h('div.res-grank', { hidden: true });
      const ours = sent => !(sent < (s.date || 0) - 3000); // (sent as this play ended, or later)
      const show = (d, sent) => {
        if (!d || d.key !== s.mapHash || !d.rank || !ours(sent)) return;
        el.hidden = false;
        clearEl(el).append(icon('trophy'), h('span', d.best ? 'Global rank ' : 'Your best is '), h('b', `#${fmtInt(d.rank)}`), h('span.muted', ` of ${fmtInt(d.of)}`));
      };
      const last = Verified.last;
      if (last && Date.now() - last.at < 60000) show(last.d, last.sent);
      const off = Bus.on('verified', show);
      (this._offs || (this._offs = [])).push(off);
      mid.append(el);
    }
    if (s.isPB && p.fresh) mid.append(h('div.res-pb', '★ NEW PERSONAL BEST'));
    else if (s.prevBest && p.fresh && s.passed) {
      const me = ScoreManager.value(s), best = ScoreManager.value(s.prevBest);
      mid.append(h('div.muted.res-prev', `Personal best: ${fmtScore(best)} (${me >= best ? '+' : ''}${fmtInt(me - best)})`));
    }
    // osu!lazer: calibrate this beatmap's offset from the play you just finished
    const sug = p.fresh ? MapOffsets.suggestion(s.mapHash, { sure: true }) : null;
    if (sug != null) {
      const cur = MapOffsets.get(s.mapHash);
      mid.append(h('button.btn.sm.res-calib', { title: 'Shifts this beatmap\'s offset by your average hit error', onclick: async e => {
        const btn = e.currentTarget;
        await MapOffsets.set(s.mapHash, cur + sug); MapOffsets.last = null; UISounds.click();
        btn.replaceWith(h('div.muted.res-calib', icon('check'), `Beatmap offset is now ${cur + sug > 0 ? '+' : ''}${cur + sug}ms`));
      } }, icon('clock'), `You hit ${Math.abs(sug)}ms ${sug > 0 ? 'late' : 'early'} on average · fix offset`));
    }
    mid.append(h('div.rs-played', `Played on ${fmtDateTime(s.date)}`));
    return h('div.rs', { style: { '--rc': rc } }, h('div.rs-toplayer'), top, mid);
  },
  rightCol(s) {
    const col = h('div.res-right', h('div.rs-head', 'Statistics'));
    const W = (s.windows || timingWindows({ od: s.od ?? 8 })).slice();
    // lazer's StatisticItemContainer: a 20px-cornered grey card with its name (16 bold, a #66FFCC bar under it)
    const item = (name, ...kids) => h('div.st-item', h('div.st-h', name), ...kids);
    // Performance Breakdown: the pp this play got and what a perfect play (all MAX) would, and each attribute's share
    const total = (s.counts || []).reduce((a, b) => a + b, 0);
    let maxPp = 0;
    const lm = BeatmapManager.mapByHash(s.mapHash), ppStars = !s.online && (s.rate || 1) === 1 && s.srVersion !== SR_VERSION && lm && lm.srVersion === SR_VERSION ? lm.stars : s.stars;
    try { maxPp = total && ppStars ? OsuMath.pp(ppStars, [total, 0, 0, 0, 0, 0], (s.mods || []).filter(m => m !== 'AT')) : 0; } catch { maxPp = 0; }
    const got = s.passed ? (s.online && s.pp != null ? s.pp : ScoreManager.ppOf(s) || s.pp || 0) : 0;
    const pct = maxPp > 0 ? clamp(got / maxPp, 0, 1) : 0;
    const perf = item('Performance Breakdown',
      h('div.st-pp', h('div.st-pp-l', h('span', 'Achieved PP'), h('b', fmtInt(Math.round(got)))), h('div.st-pp-r', h('span', 'Maximum'), h('b', fmtInt(Math.round(maxPp))))),
      h('div.st-row', h('span', 'Difficulty'), h('i.st-bar', h('i', { style: { width: `${(pct * 100).toFixed(1)}%` } })), h('b', `${Math.round(pct * 100)}%`)));
    const hist = item('Timing Distribution');
    // Secondary graphs stay folded away to keep the screen simple.
    const more = h('details.res-more', h('summary', 'More statistics'));
    // lazer's statistic items under the graph: unstable rate and the average hit error (early / late)
    // (lazer's SimpleStatisticTable: one name/value per row)
    const me = s.meanError || 0, table = (...rows) => h('div.st-table',
      h('div.st-row', h('span', 'Average Hit Error'), h('b', `${Math.abs(me).toFixed(2)} ms ${Math.abs(me) < 0.005 ? '' : me < 0 ? 'early' : 'late'}`.trim())),
      h('div.st-row', h('span', 'Unstable Rate'), h('b', (s.unstableRate || 0).toFixed(2))), ...rows);
    /** The graphs from the play's hit-by-hit timing and health (`t`: the play, or what storage has of it). */
    const timing = t => {
      hist.replaceChildren(hist.firstChild); more.replaceChildren(more.firstChild);
      const errs = (t.hitErrors || []).filter(e => !e[3]);
      if (errs.length) {
        hist.append(Charts.histogram(errs.map(e => e[1]), W, me));
        hist.append(table(h('div.st-row', h('span', 'Timed hits'), h('b', fmtInt(errs.length)))));
        more.append(h('div.panel.glass.chart-card', h('h3', 'Timing over time', h('span.grow'), h('span', 'early ↑ · late ↓')),
          Charts.scatter(t.hitErrors, W), h('div.chart-legend', ...JUDGEMENTS.slice(0, 5).map(j => h('span', { style: { '--c': j.color } }, j.short)))));
      } else {
        // (a play from your other device: its hit-by-hit timing stayed there — what it came to came along)
        if (s.synced && s.unstableRate != null) hist.append(table());
        hist.append(h('div.empty', { style: { padding: '24px' } }, s.synced ? 'The hit-by-hit timing stays on the device this was played on.' : 'No timing data for this play.'));
      }
      const hl = t.healthTimeline || [];
      if (hl.length > 2) {
        const step = Math.max(1, Math.floor(hl.length / 240));
        const pts = hl.filter((_, i) => i % step === 0 || i === hl.length - 1).map(([at, v]) => ({ y: v * 100, tip: `${fmtTime(at)} · health ${Math.round(v * 100)}%` }));
        more.append(h('div.panel.glass.chart-card', h('h3', 'Health over time', h('span.grow'), h('span', `lowest ${Math.round(hl.reduce((a, x) => Math.min(a, x[1]), 1) * 100)}%`)),
          Charts.line(pts, { height: 130, yMin: 0, yMax: 100, fmtY: v => Math.round(v) + '%', dots: false })));
      }
      more.hidden = more.children.length <= 1;
    };
    timing(s);
    // (a play kept here holds its timing in storage, not memory: drawn as soon as it's read — straight away)
    if (!s.online) ScoreManager.heavy(s).then(t => { if (t && this.p && this.p.score === s) timing(t); });
    col.append(h('div.st-pair', perf, hist));
    // lazer's user tags: after your own pass, vote for what the beatmap is
    const own = !s.player || s.player === ProfileManager.profile.name;
    // (tags live on the server: no panel when there isn't one to reach)
    if (s.passed && own && s.mapHash && !(s.mods || []).includes('AT') && typeof UserTags !== 'undefined' && Multiplayer.available() && Presence.health !== 'none') col.append(item('Beatmap tags', UserTags.panel(s.mapHash)));
    col.append(more);
    return col;
  },
  actions(s, p, map) {
    const replay = p.replay || null;
    const hasSaved = !!s.replayId || (replay && ReplayManager.list.some(r => r.id === replay.id));
    const bar = h('div.res-actions');
    const watch = h('button.res-ab.wide.green', { onclick: () => this.watch(), title: 'watch replay', 'aria-label': 'Watch replay' }, icon('play'));
    const save = h('button.res-ab', { onclick: async () => {
      if (!replay || save.disabled) return;
      save.disabled = true;
      try {
        // (a failed play opened from the fail screen isn't kept yet: its score goes with its replay)
        if (s.id && !ScoreManager.scores.some(x => x.id === s.id)) await ScoreManager.add(s);
        await ReplayManager.save(replay);
      } catch (e) { save.disabled = false; Toast.err('Couldn\'t save the replay', friendlyError(e)); return; }
      s.replayId = replay.id;
      Toast.ok('Replay saved', 'Find it in Replays.');
      save.disabled = true; save.title = 'replay saved';
      bar.insertBefore(exp, save.nextSibling);
    }, title: 'save replay', 'aria-label': 'Save replay' }, icon('save'));
    // export: lazer's .osr (opens in osu!lazer), or this game's own .amr
    const exp = h('button.res-ab', { onclick: async e => { const b = e.currentTarget.getBoundingClientRect(), r = replay || await ReplayManager.get(s.replayId); if (!r) return; showMenu(b.left, b.top - 6, [{ label: 'Export .osr (osu!lazer)', icon: 'download', onClick: () => Osr.exportReplay(r) }, { label: 'Export .amr', icon: 'download', onClick: () => ReplayManager.export(r) }], { above: true }); }, title: 'export replay', 'aria-label': 'Export replay' }, icon('download'));
    // lazer's results footer: #333, 50px, the buttons centred — watch replay and retry (300 × 30, green), then the
    // small ones (75 × 30)
    bar.append(backButton(() => this.onBack()));
    if (replay || s.replayId) bar.append(watch);
    // (after a multiplayer song: back to the room instead of retrying, as lazer's multiplayer results)
    if (p.mp) bar.append(h('button.res-ab.wide.green', { onclick: () => { UISounds.click(); this.onBack(); }, title: 'back to the room', 'aria-label': 'Back to the room' }, icon('multi')));
    // (lazer's AllowRetry: only after a play of your own — not on a score opened from a leaderboard or a profile)
    else if (!p.browse && !p.spectated) bar.append(h('button.res-ab.wide.green', { onclick: () => this.retry(), disabled: !map, title: 'retry (R)', 'aria-label': 'Retry' }, icon('retry')));
    // lazer's CollectionButton and FavouriteButton (the heart filled while the set is a favourite)
    if (map) {
      // (green while the beatmap is in a collection / the set is a favourite)
      const coll = h('button.res-ab', { onclick: e => { UISounds.click(); SongSelect.collectionMenu(e, map); }, title: 'collections', 'aria-label': 'Collections' }, icon('book'));
      const paintColl = () => coll.classList.toggle('green', Collections.list.some(c => c.hashes.includes(map.hash)));
      paintColl();
      (this._offs || (this._offs = [])).push(Bus.on('collections:changed', paintColl)); // (removed as the screen goes)
      bar.append(coll);
      const fav = h('button.res-ab', { 'aria-label': 'Favourite' });
      const paint = () => { const on = Favorites.has(map.setId); fav.classList.toggle('green', on); fav.title = on ? 'Unfavourite this beatmapset' : 'Favourite this beatmapset'; fav.replaceChildren(icon('heart', on ? 'fill' : '')); };
      fav.onclick = async () => { UISounds.click(); await Favorites.toggle(map.setId); paint(); };
      paint();
      bar.append(fav);
    }
    if (replay && !hasSaved && p.watched !== 'auto' && p.watched !== 'replay') bar.append(save);
    if (hasSaved || p.watched === 'replay') bar.append(exp);
    bar.append(h('button.res-ab.res-share', { onclick: () => ShareCard.open(s), title: 'share a picture of this result', 'aria-label': 'Share' }, icon('upload')));
    // (someone else's score on a beatmap you don't have: get it from here — the button counts up as it comes — and
    // the screen then has the rest: its replay, favourite, the beatmap at song select)
    if (!map && s.onlineSetId > 0) {
      const label = h('span', 'Download');
      const dl = h('button.res-ab.wide.dl', { title: 'download this beatmap', 'aria-label': 'Download beatmap', onclick: async () => {
        UISounds.click(); dl.disabled = true; label.textContent = 'Downloading…';
        try {
          await OnlineBeatmaps.downloadAndImport({ id: s.onlineSetId, title: s.title, artist: s.artist }, f => { label.textContent = f != null ? `Downloading… ${Math.round(f * 100)}%` : 'Downloading…'; });
        } catch (e) { Toast.err('Couldn\'t download the beatmap', friendlyError(e)); }
        if (Screens.current === this && this.p === p && BeatmapManager.mapByHash(s.mapHash)) Screens.go('results', { ...p, force: true }, { replace: true });
        else { dl.disabled = false; label.textContent = 'Download'; }
      } }, icon('download'), label);
      bar.append(dl);
    } else if (!map) bar.append(h('span.muted', s.online || s.synced ? 'Beatmap not in your library' : 'Beatmap no longer in library')); // (synced: played on your other device)

    return bar;
  },
  async watch() {
    const s = this.p.score;
    const replay = this.p.replay || (s.replayId && await ReplayManager.get(s.replayId));
    if (!replay) { Toast.err('No replay available'); return; }
    const map = BeatmapManager.mapByHash(replay.mapHash);
    if (!map) { Toast.err('Beatmap not found', 'Import the beatmap to watch this replay.'); return; }
    Game.launch({ mapId: map.id, mode: 'replay', replay, returnTo: { ...this.p, fresh: false } });
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
    const label = gradeLabel(s.grade);
    const rc = RANK_COLOURS[s.grade] || '#fff', fill = ['#fff', rc];
    x.font = F(800, 210); x.textAlign = 'center';
    g = x.createLinearGradient(0, 250, 0, 450); g.addColorStop(0, fill[0]); g.addColorStop(1, fill[1] || fill[0]);
    x.save(); x.shadowColor = fill[fill.length - 1]; x.shadowBlur = 40; x.fillStyle = g; x.fillText(label, 200, 440); x.restore();
    if (!s.passed) pill('FAILED', 150, 470, '#ff3b4f');
    // score and stats
    text(fmtScore(ScoreManager.value(s)), 76, 300, { w: 800, xPos: 380 });
    const stat = (k, v, i) => { const sx = 380 + i * 190; text(k, 17, 350, { w: 600, color: 'rgba(255,255,255,.6)', xPos: sx }); text(v, 34, 390, { w: 700, xPos: sx }); };
    const pp = s.online && s.pp != null ? s.pp : ScoreManager.ppOf(s); // (someone else's play: the pp their profile lists)
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
    text(`played by ${s.player || 'Player'} · ${new Date(s.date).toLocaleDateString(undefined, { dateStyle: 'medium' })}`, 20, H - 25, { w: 600, color: 'rgba(255,255,255,.8)' });
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
    const maxAbs = errs.reduce((a, e) => Math.max(a, Math.abs(e)), 1);
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
        const hh = v ? Math.max(bwid, v / max * ph * grow) : bwid;
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
    // lazer's bars grow up into place (300ms OutQuint) the first time the graph comes into view
    let grow = 0;
    const io = new IntersectionObserver(es => {
      if (!es.some(e => e.isIntersecting)) return;
      io.disconnect();
      const a = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--anim')), t0 = performance.now(), D = 300 * (Number.isFinite(a) ? a : 1);
      const step = now => { const t = D > 0 ? Math.min(1, (now - t0) / D) : 1; grow = 1 - (1 - t) ** 5; draw(-1); if (t < 1 && cv.isConnected) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    io.observe(cv);
    requestAnimationFrame(() => draw(-1));
    new ResizeObserver(() => draw(-1)).observe(cv);
    cv.addEventListener('pointermove', e => {
      if (!geo) return;
      const r = cv.getBoundingClientRect();
      const i = Math.floor(((e.clientX - r.left) * (cv.clientWidth / r.width) - geo.pad.l) / geo.bw);
      if (i < 0 || i >= nb) { tip.hidden = true; draw(-1); return; }
      const c = (i - SIDE) * bin;
      tip.hidden = false; tip.textContent = `${bin > 1 ? `${c - Math.floor(bin / 2)} to ${c + Math.ceil(bin / 2) - 1}` : c}ms: ${bins[i]} hit${bins[i] === 1 ? '' : 's'}`;
      tip.style.left = (e.clientX - r.left) * (cv.clientWidth / r.width) + 'px'; tip.style.top = (e.clientY - r.top) * (cv.clientHeight / r.height) + 'px';
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
      const t = t0 + ((e.clientX - r.left) * (cv.clientWidth / r.width) - geo.pad.l) / geo.pw * (t1 - t0);
      let best = 0, bd = Infinity;
      for (let i = 0; i < pts.length; i++) { const d = Math.abs(pts[i][0] - t); if (d < bd) { bd = d; best = i; } }
      const p = pts[best];
      tip.hidden = false; tip.textContent = `${fmtTime(p[0])} · ${p[1] > 0 ? '+' : ''}${p[1]}ms · ${JUDGEMENTS[p[2]].name}`;
      tip.style.left = (e.clientX - r.left) * (cv.clientWidth / r.width) + 'px'; tip.style.top = (e.clientY - r.top) * (cv.clientHeight / r.height) + 'px';
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
      const i = Math.floor(((e.clientX - r.left) * (cv.clientWidth / r.width) - geo.pad.l) / geo.bw);
      if (i < 0 || i >= data.length) { tip.hidden = true; draw(-1); return; }
      tip.hidden = false; tip.textContent = data[i].tip || `${data[i].label}: ${data[i].value}`;
      tip.style.left = (e.clientX - r.left) * (cv.clientWidth / r.width) + 'px'; tip.style.top = (e.clientY - r.top) * (cv.clientHeight / r.height) + 'px';
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
      const r = cv.getBoundingClientRect(), mx = (e.clientX - r.left) * (cv.clientWidth / r.width);
      let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = Math.abs(geo.X(i) - mx); if (d < bd) { bd = d; best = i; } });
      tip.hidden = false; tip.textContent = pts[best].tip;
      tip.style.left = geo.X(best) + 'px'; tip.style.top = (e.clientY - r.top) * (cv.clientHeight / r.height) + 'px';
      draw(best);
    });
    cv.addEventListener('pointerleave', () => { tip.hidden = true; draw(-1); });
    return wrap;
  },
};
