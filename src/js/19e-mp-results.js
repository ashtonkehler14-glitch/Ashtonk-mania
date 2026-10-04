/* After a multiplayer song: osu!lazer's MultiplayerResultsScreen — every player's score as lazer's contracted score
 * panel (#place, avatar, name, judgements, combo, accuracy, mods; the score and grade along the bottom), lined up
 * from the winner to the last place, yours picked out. It waits for the others to finish first (their live scores
 * meanwhile), then shows who won. */

const MpResults = {
  /** On the results screen after a multiplayer song (lazer's MultiplayerResultsScreen): the other players' panels
   *  either side of yours, in placing order, and who won above them. Repaints as they finish. */
  mount(body, grid, card, score) {
    this.my = score; this._key = null; this._final = false;
    this.head = h('div.res-mp-head');
    this.before = h('div.res-mp-side.before'); this.after = h('div.res-mp-side.after');
    // (your panel keeps its place in the row: the others sit before and after it)
    grid.prepend(this.before);
    card.after(this.after);
    body.prepend(this.head);
    this.place = h('div.res-mp-myplace'); card.prepend(this.place);
    this._unsub = [Bus.on('mp:changed', () => this.paint()), Bus.on('mp:opp', () => this.paint())];
    this._t = setInterval(() => this.paint(), 500);
    this.paint();
  },
  unmount() { (this._unsub || []).forEach(f => f()); this._unsub = []; clearInterval(this._t); },
  /** The match's results once everyone's done; until then the live scores of those still playing. */
  rows() {
    const res = Multiplayer.lastResults;
    if (res) return { res, rows: res.rows };
    const room = Multiplayer.room, rows = [];
    if (this.my) rows.push({ id: Multiplayer.me, name: ProfileManager.profile.name, score: this.my.scoreStd ?? this.my.score, accuracy: this.my.accuracy, maxCombo: this.my.maxCombo, counts: this.my.counts, grade: this.my.grade, mods: this.my.mods, done: true });
    for (const [id, o] of Multiplayer.opps || []) {
      const p = room && room.players.find(x => x.id === id);
      if (!p || id === Multiplayer.me) continue;
      rows.push({ id, name: p.name, score: o.score || 0, accuracy: o.acc || 0, maxCombo: o.maxCombo || 0, counts: null, grade: null, mods: [], pending: true });
    }
    rows.sort((a, b) => b.score - a.score);
    rows.forEach((r, i) => { r.place = i + 1; });
    return { res: null, rows };
  },
  paint() {
    const { res, rows } = this.rows();
    const key = JSON.stringify([!!res, rows.map(r => [r.id, r.place, r.score, r.pending])]);
    if (key === this._key) return;
    const first = !this._key || (!!res && !this._final);
    this._key = key; this._final = !!res;
    const me = Multiplayer.me, mine = rows.find(r => r.id === me);
    let verdict = 'Waiting for the others to finish…', cls = 'wait';
    if (res) {
      if (res.teams) {
        const my = mine ? mine.team : null;
        verdict = res.winnerTeam === null ? 'Draw' : `${res.winnerTeam ? 'Blue' : 'Red'} team wins!`;
        cls = res.winnerTeam === null ? 'draw' : res.winnerTeam === my ? 'won' : 'lost';
      } else {
        verdict = res.winner === null ? 'Draw' : res.winner === me ? 'You win!' : rows.length > 2 && mine ? `You placed #${mine.place}` : 'You lose';
        cls = res.winner === null ? 'draw' : res.winner === me ? 'won' : 'lost';
      }
    }
    const map = (res && res.map) || (Multiplayer.room && Multiplayer.room.map);
    clearEl(this.head).append(h(`div.mpr-verdict.${cls}`, verdict), map ? h('div.mpr-map', `${map.artist} - ${map.title}`, map.version ? h('span', ` [${map.version}]`) : null) : null);
    const at = rows.findIndex(r => r.id === me);
    const panel = (r, i) => this.panel(r, i, first, res);
    clearEl(this.before).append(...rows.slice(0, Math.max(0, at)).map(panel));
    clearEl(this.after).append(...(at < 0 ? rows : rows.slice(at + 1)).map((r, k) => panel(r, (at < 0 ? 0 : at + 1) + k)));
    // (your own panel: its place and the winner's crown)
    const mine2 = rows.find(r => r.id === me);
    if (this.place) this.place.textContent = mine2 ? `#${mine2.place}` : '';
  },
  /** lazer's contracted ScorePanel (130 × 385). */
  panel(r, i, animate, res) {
    const me = r.id === Multiplayer.me;
    const room = Multiplayer.room, p = room && room.players.find(x => x.id === r.id);
    const g = r.forfeit ? 'F' : r.grade || null;
    const NAMES = ['Perfect', 'Great', 'Good', 'Ok', 'Meh', 'Miss'];
    const stat = (k, v) => h('div.cp-stat', h('span', k), h('b', v));
    const win = res && (res.teams ? r.team === res.winnerTeam : r.id === res.winner);
    return h(`div.cp${me ? '.me' : ''}${win ? '.win' : ''}${r.team === 0 ? '.red' : r.team === 1 ? '.blue' : ''}`, { style: { '--rc': RANK_COLOURS[g] || '#444', animationDelay: animate ? `${i * 80}ms` : '0ms' }, 'data-anim': animate ? '1' : null },
      h('div.cp-place', `#${r.place || i + 1}`),
      h('div.cp-mid',
        h('div.cp-av', me ? ProfileManager.avatarEl(110) : Presence.avatarEl(p || { name: r.name }, 110)),
        h('div.cp-name', r.name, me ? h('small', ' (you)') : null),
        r.counts ? h('div.cp-stats', ...r.counts.map((c, k) => stat(NAMES[k], fmtInt(c)))) : h('div.cp-stats.cp-live', r.pending ? 'still playing…' : ''),
        h('div.cp-stats.cp-sum', stat('Combo', `x${fmtInt(r.maxCombo || 0)}`), stat('Accuracy', fmtAcc(r.accuracy || 0))),
        (r.mods || []).length ? h('div.cp-mods', ...r.mods.map(m => ModSystem.badge(m, true))) : null,
        r.forfeit ? h('div.cp-note', r.left ? 'left the match' : 'forfeited') : null),
      h('div.cp-bottom', h('div.cp-score', fmtScore(r.score || 0)), g ? rankPill(g) : h('span.cp-wait', '…')));
  },
};
