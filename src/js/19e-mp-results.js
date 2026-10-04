/* After a multiplayer song: osu!lazer's MultiplayerResultsScreen — every player's score as lazer's contracted score
 * panel (#place, avatar, name, judgements, combo, accuracy, mods; the score and grade along the bottom), lined up
 * from the winner to the last place, yours picked out. It waits for the others to finish first (their live scores
 * meanwhile), then shows who won. */

const MpResultsScreen = {
  tab: 'multiplayer',
  enter(params = {}) {
    this.my = params.score || null;
    this.el = h('div.mpr');
    this.head = h('div.mpr-head');
    this.list = h('div.mpr-list');
    const foot = h('div.mpr-foot',
      backButton(() => Screens.go('multiplayer', {}, { replace: true })),
      h('div.grow'),
      this.my ? h('button.res-ab.wide', { title: 'your results', 'aria-label': 'Your results', onclick: () => { UISounds.click(); Screens.go('results', { score: this.my, replay: params.replay || null, fromList: true }); } }, icon('chart')) : null,
      h('button.res-ab.wide.green', { title: 'back to the room', 'aria-label': 'Back to the room', onclick: () => { UISounds.click(); Screens.go('multiplayer', {}, { replace: true }); } }, icon('multi')),
      h('div.grow'));
    this.el.append(this.head, this.list, foot);
    this._unsub = [Bus.on('mp:changed', () => this.paint()), Bus.on('mp:opp', () => this.paint())];
    this._t = setInterval(() => this.paint(), 500);
    this.paint();
    return this.el;
  },
  leave() { (this._unsub || []).forEach(f => f()); clearInterval(this._t); },
  onKey(e) { if (e.key === 'Escape') { Screens.go('multiplayer', {}, { replace: true }); return true; } return false; },
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
    clearEl(this.list).append(...rows.map((r, i) => this.panel(r, i, first, res)));
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
