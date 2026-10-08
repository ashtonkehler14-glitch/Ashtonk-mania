// Ranked Play: osu!lazer's 1v1 card mode, rule for rule as its server plays it (osu-server-spectator:
// RankedPlayMatchController, RankedPlayStageImplementation and the stages under RankedPlay/Stages, the matchmaking
// queue and beatmap selector). Plain JS with an injectable clock and random source, so it can be unit-tested in Node.
//
// A match:
//  - Both players start with 1,000,000 life and a hand of five beatmap cards dealt from a shuffled deck of up to 50,
//    picked around the lower player's rating.
//  - Round 1 opens with the intro (20 s), then a discard phase (30 s): each player may replace any of their cards once.
//  - Players take turns to play a card (45 s; when time runs out, the card last selected — or the first — is played).
//    The lower-rated player goes first. From round 3, the player whose turn it is draws a card first.
//  - Both download the beatmap (up to 2 min), look at it and press Ready (up to 2 min, then a 10 s countdown), and play.
//    Whoever isn't ready in time takes 100,000 and the round is skipped.
//  - The lower total score takes damage: the score difference plus 50,000 (no multipliers: every round counts the
//    same). A hit taken at full life always leaves 1 (last stand).
//  - Leaving mid-song ends the match there (the other player goes back to the match screen and wins).
//  - Once it's over, both players can ask for a rematch: a new (unrated) match in the same room.
//  - The match ends when a player has no life left or the cards run out; the most life wins. Leaving loses (life 0); a dropped connection gets a minute to come back.
//  - Matches from the queue are rated (OpenSkill Plackett–Luce on the final life, μ 1500 σ 150 τ 15, as lazer);
//    a duel between friends is not.

export const RP = {
  LIFE: 1_000_000, HAND: 5, DECK: 50, BASE_DAMAGE: 50_000, NOT_READY_DAMAGE: 100_000,
  WAIT_JOIN: 60_000, STARS: 60_000, DEAL: 15_000, INTRO: 20_000, DISCARD: 30_000, DISCARD_DONE: 3_000, FINISH_DISCARD: 5_000, PICK: 45_000,
  FINISH_PICK: 120_000, WARMUP: 120_000, COUNTDOWN: 10_000, RESULTS: 15_000,
  AWAY: 60_000,        // a dropped connection gets this long to come back before the player is counted as gone (any match)
  LEAVE_BAN: 600_000,  // leaving a rated match: 10 minutes out of the queue (lazer)
  DECLINE_BAN: 60_000, // declining (or ignoring) a match found by the queue: 1 minute
};
export const RATING = { MU: 1500, SIGMA: 150, TAU: 15, BETA: 0, KAPPA: 0.0001 };
/** Stage names, in lazer's order (RankedPlayStage). `deal` is ours: the deck is being drawn up after both joined. */
export const RP_STAGES = ['waitjoin', 'stars', 'deal', 'warmup', 'discard', 'discarded', 'pick', 'picked', 'ready', 'playing', 'results', 'ended'];

const num = (v, lo, hi, def = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

/** A beatmap's matchmaking rating from its star rating (MatchmakingBeatmapSelector), and back. */
export const beatmapRating = sr => Math.round(800 + 500 * (Math.exp(0.16 * sr) - 1));
export const starsForRating = r => Math.max(0.5, Math.log(Math.max(1e-6, (r - 800) / 500 + 1)) / 0.16);
/** A new player's rating, estimated from their pp (MatchmakingQueueBackgroundService). */
export const initialRating = pp => -4000 + 600 * Math.log(Math.max(0, pp) + 4000);

/** The deck around the star rating both players asked for: `n` targets drawn from N(their average, 0.35²), at least
 *  0.5★ (Box–Muller). */
export function deckTargetsForStars(prefs, n = RP.DECK, rnd = Math.random) {
  const want = prefs.length ? prefs.reduce((a, b) => a + b, 0) / prefs.length : 3, out = [];
  while (out.length < n) {
    const theta = 2 * Math.PI * rnd(), r = Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd())));
    out.push(want + 0.35 * r * Math.cos(theta), want + 0.35 * r * Math.sin(theta));
  }
  return out.slice(0, n).map(x => Math.round(Math.max(0.5, x) * 100) / 100);
}

/** The deck's target star ratings: `n` ratings drawn from N(lowest player rating, 100²) (Box–Muller), as stars. */
export function deckTargets(ratings, n = RP.DECK, rnd = Math.random) {
  const mu = ratings.length ? Math.min(...ratings) : RATING.MU, out = [];
  while (out.length < n) {
    const theta = 2 * Math.PI * rnd(), r = Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd())));
    out.push(mu + 100 * r * Math.cos(theta), mu + 100 * r * Math.sin(theta));
  }
  return out.slice(0, n).map(x => Math.round(starsForRating(x) * 100) / 100);
}

/** OpenSkill's Plackett–Luce update for players who each make up a team (lazer: μ 1500, σ 150, β 0, τ 15, γ = 1).
 *  players: [{ mu, sigma, score }] — a higher score places higher, equal scores draw. Returns [{ mu, sigma }]. */
export function rateMatch(players, { beta = RATING.BETA, tau = RATING.TAU, kappa = RATING.KAPPA } = {}) {
  const t = players.map(p => ({ mu: p.mu, s2: p.sigma * p.sigma + tau * tau, score: p.score }));
  const c = Math.sqrt(t.reduce((a, p) => a + p.s2 + beta * beta, 0));
  const rank = t.map(p => t.filter(q => q.score > p.score).length);
  const top = Math.max(...t.map(p => p.mu));
  const e = t.map(p => Math.exp((p.mu - top) / c)); // (shifted: only the ratios matter)
  const sumQ = t.map((_, q) => t.reduce((a, _p, i) => (rank[i] >= rank[q] ? a + e[i] : a), 0));
  const A = t.map((_, q) => rank.filter(r => r === rank[q]).length);
  return t.map((p, i) => {
    let omega = 0, delta = 0;
    for (let q = 0; q < t.length; q++) {
      if (rank[q] > rank[i]) continue;
      const quot = e[i] / sumQ[q];
      omega += (i === q ? 1 - quot : -quot) / A[q];
      delta += quot * (1 - quot) / A[q];
    }
    return { mu: p.mu + p.s2 / c * omega, sigma: Math.sqrt(p.s2 * Math.max(1 - p.s2 / (c * c) * delta, kappa)) };
  });
}

/** One Ranked Play match, run inside a room (RoomLogic): it owns the stages, the cards and the life points; the room
 *  owns the players, the beatmap being played and the gameplay itself. Every method returns messages to send. */
export class RankedPlay {
  constructor(room, opts = {}) {
    this.room = room;
    this.keys = Number(opts.keys) === 7 ? 7 : 4;
    this.rated = !!opts.rated;
    this.stage = 'waitjoin'; this.round = 0;
    this.deadline = opts.rated ? room.now() + RP.WAIT_JOIN : 0; this.stageAt = room.now(); this.stageLen = opts.rated ? RP.WAIT_JOIN : 0;
    this.mult = 1;                 // (no round multiplier: damage is the score difference + the bonus, every round)
    this.id = room.now();          // (this match, as opposed to an earlier one in the same room — a rematch)
    this.rematch = {};             // who's asked for a rematch once it's over
    this.users = {};               // id → { rating, sigma, ratingAfter, life, hand, won, mult, dmg, cid }
    this.order = [];               // turn order: lowest rating first
    this.active = null;            // whose turn it is
    this.pool = []; this.deck = [];
    this.played = -1;              // the card in play this round
    this.selected = -1;            // the card the active player last selected (played if their time runs out)
    this.discarded = {}; this.ready = {}; this.countdown = false;
    this.results = null; this.history = []; this.winner = null; this.stars = 0;
    this.dealer = null; this.dealFails = 0; this.completed = false;
    this.bans = [];                // queue bans for the Worker to pass on: [{ cid, ms }]
  }
  now() { return this.room.now(); }
  get players() { return this.room.players; }
  user(id) { return this.users[id]; }
  /** A player joins with their rating for this key count (clients send both: `ratings: { 4: { mu, sigma }, 7: … }`). */
  addUser(p, opts) {
    const own = opts.ratings && typeof opts.ratings === 'object' && opts.ratings[this.keys] && typeof opts.ratings[this.keys] === 'object' ? opts.ratings[this.keys] : opts;
    const rating = num(own.mu ?? own.rating, 0, 5000, RATING.MU), sigma = num(own.sigma, 1, 500, RATING.SIGMA);
    this.users[p.id] = { name: p.name, avatar: p.avatar || '', rating: Math.round(rating), mu: rating, sigma, ratingAfter: Math.round(rating), pref: null, life: RP.LIFE, hand: [], won: 0, mult: 0, dmg: null, cid: String(opts.cid || '').slice(0, 40) };
  }
  alive() { return Object.values(this.users).filter(u => u.life > 0).length; }
  cardsLeft() { return this.deck.length + Object.values(this.users).reduce((a, u) => a + u.hand.length, 0); }
  roundsRemaining() { return this.alive() > 1 && this.cardsLeft() > 0; }
  other(id) { return Object.keys(this.users).find(k => k !== id) || null; }

  /** What one player sees: their own cards, the cards that have been played, and only the number of everyone else's. */
  view(viewer) {
    const cards = {}, show = i => { if (i >= 0 && this.pool[i]) cards[i] = this.pool[i]; };
    if (viewer && this.users[viewer]) this.users[viewer].hand.forEach(show);
    show(this.played);
    for (const h of this.history) show(h.card);
    const users = {};
    for (const [id, u] of Object.entries(this.users)) {
      // a star rating stays hidden from the other player until both have locked theirs in
      const showPref = id === viewer || this.stage !== 'stars';
      // (a name always; an avatar only once they've left the room — while here, it's in the room's player list)
      users[id] = { name: u.name || '', avatar: this.room.get(id) ? '' : u.avatar || '', rating: u.rating, ratingAfter: u.ratingAfter, muAfter: u.muAfter ?? null, sigmaAfter: u.sigmaAfter ?? null, pref: showPref ? u.pref : null, picked: u.pref != null, life: u.life, hand: [...u.hand], won: u.won, mult: u.mult, dmg: u.dmg,
        discarded: !!this.discarded[id], ready: !!this.ready[id], away: !!(this.room.get(id) || {}).away };
    }
    return { keys: this.keys, rated: this.rated, stage: this.stage, round: this.round, left: this.deadline ? Math.max(0, this.deadline - this.now()) : 0, len: this.stageLen,
      mult: this.mult, users, order: [...this.order], active: this.active, deck: this.deck.length, cards, played: this.played, countdown: this.countdown,
      results: this.results, history: this.history, winner: this.winner, stars: this.stars, id: this.id, rematch: Object.keys(this.rematch) };
  }

  // ── stages
  go(stage, len) {
    this.stage = stage; this.stageAt = this.now(); this.stageLen = len || 0;
    this.deadline = len > 0 ? this.now() + len : 0;
    this.countdown = false;
  }
  /** A stage's countdown ran out (or was skipped to its end). */
  tick() {
    if (!this.deadline || this.now() < this.deadline) return [];
    switch (this.stage) {
      case 'waitjoin': return this.end('Your opponent never joined');
      case 'stars': {
        // time's up: anyone who didn't choose takes the other's choice (or 3★)
        const set = Object.values(this.users).map(u => u.pref).filter(v => v != null);
        for (const u of Object.values(this.users)) if (u.pref == null) u.pref = set.length ? set[0] : 3;
        return this.afterStars();
      }
      case 'deal':
        // the dealer's client never sent the deck: ask the other player (three tries)
        if (++this.dealFails >= 3) return this.end('Couldn\'t find beatmaps for the deck');
        this.dealer = this.other(this.dealer) || this.dealer;
        return this.askDeck();
      case 'warmup': return this.round === 1 ? this.enter('discard') : this.enter('pick');
      case 'discard': return this.enter('discarded');
      case 'discarded': return this.enter('pick');
      case 'pick': {
        const hand = this.user(this.active).hand;
        return this.activate(hand.includes(this.selected) ? this.selected : hand[0]);
      }
      case 'picked': return this.notReady(id => !!(this.room.get(id) || {}).hasMap);
      case 'ready':
        if (this.countdown) return this.startGameplay();
        return this.notReady(id => !!(this.room.get(id) || {}).hasMap && !!this.ready[id]);
      case 'results': return this.finishResults();
    }
    return [];
  }
  /** Enter a stage and run what it does on the way in. */
  enter(stage) {
    switch (stage) {
      case 'warmup': {
        for (const p of this.players) { p.ready = false; }
        this.round++;
        if (this.round >= 2) this.active = this.order[(this.order.indexOf(this.active) + 1) % this.order.length];
        if (this.round >= 3) this.draw(this.active, 1); // a card on each later turn
        this.go('warmup', this.round === 1 ? RP.INTRO : 0);
        if (this.round > 1) return this.enter('pick');
        return [this.room.roomMsg()];
      }
      case 'discard': this.discarded = {}; this.go('discard', RP.DISCARD); return [this.room.roomMsg()];
      case 'discarded': this.go('discarded', RP.FINISH_DISCARD); return [this.room.roomMsg()];
      case 'pick': {
        this.played = -1; this.selected = -1; this.results = null;
        if (!this.user(this.active).hand.length) this.draw(this.active, 1);
        this.go('pick', RP.PICK);
        const p = this.room.get(this.active);
        return [this.room.system(`Round ${this.round} — ${p ? p.name : 'The active player'} plays a card`), this.room.roomMsg()];
      }
    }
    return [];
  }
  /** Start of the match: both players are in. Draw up the deck (the dealer's client finds the beatmaps). */
  begin() {
    // first both players say how hard they want it: the deck is drawn up around their star ratings
    this.go('stars', RP.STARS);
    return [this.room.system('Both players: enter the star rating you want to play'), this.room.roomMsg()];
  }
  /** A player locks in the star rating they want (0.5–15★). Once both have, the deck is dealt. */
  setStars(id, v) {
    const u = this.user(id);
    if (!u || this.stage !== 'stars' || u.pref != null) return [];
    const n = Number(v);
    if (!Number.isFinite(n)) return [];
    u.pref = Math.round(Math.min(15, Math.max(0.5, n)) * 100) / 100;
    if (Object.values(this.users).every(x => x.pref != null)) return this.afterStars();
    return [this.room.roomMsg()];
  }
  afterStars() {
    // turn order: whoever asked for the lower star rating goes first (ties at random)
    const ids = this.players.map(p => p.id);
    const tie = Object.fromEntries(ids.map(id => [id, this.room.rnd()]));
    this.order = ids.sort((a, b) => (this.user(a).pref ?? 0) - (this.user(b).pref ?? 0) || tie[a] - tie[b]);
    this.active = this.order[0];
    this.dealer = this.room.hostId;
    return this.askDeck();
  }
  askDeck() {
    this.go('deal', RP.DEAL);
    const prefs = Object.values(this.users).map(u => u.pref).filter(v => v != null);
    const targets = prefs.length ? deckTargetsForStars(prefs, RP.DECK, this.room.rnd) : deckTargets(Object.values(this.users).map(u => u.mu), RP.DECK, this.room.rnd);
    return [{ to: this.dealer, msg: { t: 'rpDeck', keys: this.keys, targets } }, this.room.roomMsg()];
  }
  /** The dealer's beatmaps arrive: shuffle them into the deck, deal five each, and the first round starts. */
  setDeck(id, maps) {
    if (this.stage !== 'deal' || id !== this.dealer || !maps.length) return [];
    this.pool = maps.slice(0, RP.DECK);
    this.deck = this.pool.map((_, i) => i);
    for (let i = this.deck.length - 1; i > 0; i--) { const j = Math.floor(this.room.rnd() * (i + 1)); [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]]; }
    this.stars = Math.round(this.pool.reduce((a, m) => a + (m.stars || 0), 0) / this.pool.length * 100) / 100;
    for (const id of this.order) this.draw(id, RP.HAND);
    return this.enter('warmup');
  }
  draw(id, n) { const u = this.user(id); if (u) u.hand.push(...this.deck.splice(0, n)); }

  /** Discard phase: replace any of your cards, once. */
  discard(id, cards) {
    const u = this.user(id);
    if (this.stage !== 'discard' || !u || this.discarded[id]) return [];
    const out = Array.isArray(cards) ? [...new Set(cards.map(Number))].filter(i => u.hand.includes(i)) : [];
    this.discarded[id] = true;
    u.hand = u.hand.filter(i => !out.includes(i));
    this.draw(id, out.length);
    // both done: a moment for the animations, then on
    if (Object.keys(this.users).every(k => this.discarded[k])) { this.deadline = this.now() + RP.DISCARD_DONE; this.stageLen = RP.DISCARD_DONE; this.stageAt = this.now(); }
    return [this.room.roomMsg()];
  }
  /** The active player's hand as they handle it (hovered and selected card), for the opponent to watch. */
  hand(id, m) {
    if (this.stage !== 'pick' || id !== this.active) return [];
    const u = this.user(id), pick = v => (Number.isInteger(v) && u.hand.includes(v) ? v : -1);
    const hover = pick(m.hover), sel = pick(m.sel);
    if (sel >= 0) this.selected = sel;
    return [{ to: { except: id }, msg: { t: 'hand', id, hover, sel } }];
  }
  play(id, card) {
    card = Number(card);
    if (this.stage !== 'pick' || id !== this.active || !this.user(id).hand.includes(card)) return [];
    return this.activate(card);
  }
  /** Play a card: its beatmap becomes the room's, and both start getting it. */
  activate(card) {
    if (card == null || card < 0) return this.end('No cards left');
    this.played = card;
    const room = this.room;
    room.map = this.pool[card]; room.mods = []; room.modConfig = null;
    for (const p of this.players) { p.hasMap = false; p.ready = false; p.diff = null; }
    this.ready = {};
    this.go('picked', RP.FINISH_PICK);
    const p = room.get(this.active), m = this.pool[card];
    return [room.system(`${p ? p.name : 'Someone'} played ${m.artist} - ${m.title} [${m.version}]`), room.roomMsg()];
  }
  /** A player's beatmap download state changed. */
  mapState() {
    if (this.stage === 'picked' && this.players.every(p => p.hasMap)) { this.go('ready', RP.WARMUP); this.ready = {}; }
    return [];
  }
  /** Gameplay warmup: Ready once you've looked at the beatmap; both ready starts a 10 s countdown (it can't be undone). */
  setReady(id) {
    if (this.stage !== 'ready' || this.ready[id] || !(this.room.get(id) || {}).hasMap) return [];
    this.ready[id] = true;
    if (!this.countdown && this.players.every(p => this.ready[p.id] && p.hasMap)) { this.countdown = true; this.deadline = this.now() + RP.COUNTDOWN; this.stageLen = RP.COUNTDOWN; this.stageAt = this.now(); }
    return [this.room.roomMsg()];
  }
  /** Someone wasn't ready in time: if anyone was, the others take 100,000 × the round multiplier; the card is spent. */
  notReady(isReady) {
    const ids = this.players.map(p => p.id), readyIds = ids.filter(isReady);
    if (readyIds.length) for (const id of ids) if (!isReady(id)) this.damage(id, RP.NOT_READY_DAMAGE, 1, 0);
    this.spend();
    const late = this.players.filter(p => !isReady(p.id)).map(p => p.name);
    const out = [this.room.system(`${late.join(' and ') || 'Nobody'} wasn't ready in time — the round is skipped`)];
    this.room.map = null;
    return [...out, ...(this.roundsRemaining() ? this.enter('warmup') : this.end())];
  }
  spend() { const u = this.user(this.active); if (u) u.hand = u.hand.filter(i => i !== this.played); }
  startGameplay() {
    this.go('playing', 0);
    return this.room.beginMatch(this.players.filter(p => !p.away));
  }
  /** Gameplay is over (everyone finished, quit or left): work out the round. */
  gameplayDone(rows) {
    if (this.stage === 'ended') return []; // (someone left mid-song: the match already ended)
    this.spend();
    const score = id => { const x = rows.find(r => r.id === id); return x && !x.left ? x.score : 0; };
    const ids = Object.keys(this.users), scores = Object.fromEntries(ids.map(id => [id, score(id)]));
    for (const id of ids) this.users[id].dmg = this.damage(id); // (no damage yet)
    const best = Math.max(...ids.map(id => scores[id])), top = ids.filter(id => scores[id] === best);
    const winner = top.length === 1 ? top[0] : null;
    if (winner) {
      const loser = ids.find(id => id !== winner);
      this.users[loser].dmg = this.damage(loser, best - scores[loser], 1, RP.BASE_DAMAGE);
      this.users[winner].won++;
    }
    const pick = k => Object.fromEntries(ids.map(id => { const x = rows.find(r => r.id === id) || {}; return [id, x[k] ?? null]; }));
    this.results = { round: this.round, card: this.played, winner, scores, accuracy: pick('accuracy'), maxCombo: pick('maxCombo'), grade: pick('grade'), counts: pick('counts'),
      quit: Object.fromEntries(ids.map(id => [id, !!(rows.find(r => r.id === id) || {}).forfeit])), dmg: Object.fromEntries(ids.map(id => [id, this.users[id].dmg])) };
    this.history.push({ round: this.round, card: this.played, active: this.active, winner, scores });
    this._winner = winner;
    this.go('results', RP.RESULTS);
    if (!this.roundsRemaining()) this.complete();
    return [this.room.roomMsg()];
  }
  finishResults() {
    this._winner = null;
    for (const u of Object.values(this.users)) u.dmg = null;
    this.room.map = null;
    return this.roundsRemaining() ? this.enter('warmup') : this.end();
  }
  /** Take damage (Damage()): ⌈direct × multiplier⌉ + bonus, and a hit at full life leaves 1. */
  damage(id, direct = 0, multiplier = 1, bonus = 0) {
    const u = this.users[id], total = Math.ceil(direct * multiplier) + bonus;
    const info = { damage: total, rawDamage: direct + bonus, oldLife: u.life, newLife: Math.max(u.life === RP.LIFE ? 1 : 0, u.life - total), directDamage: direct, multiplier, bonusDamage: bonus };
    u.life = info.newLife;
    return info;
  }
  /** A player is gone for good (left, or never came back): life 0. Rated matches bar them from the queue for a while. */
  kill(id) {
    const u = this.users[id];
    if (!u || u.life <= 0 && u.killed) return;
    u.life = 0; u.killed = true;
    if (this.rated && u.cid) this.bans.push({ cid: u.cid, ms: RP.LEAVE_BAN });
    if (!this.roundsRemaining()) this.complete();
  }
  /** Leaving, by stage (lazer: WaitForJoin closes the match with no loss; gameplay and results carry on to the end of
   *  the round; any other stage ends the match there). */
  leave(id) {
    const name = (this.room.get(id) || { name: 'Your opponent' }).name;
    switch (this.stage) {
      case 'ended': return [];
      // before the first round: no loss, the match just can't go ahead (a lone duel host leaving empties the room)
      case 'waitjoin': delete this.users[id]; return [];
      case 'stars':
      case 'deal': delete this.users[id]; this.order = this.order.filter(x => x !== id); return this.end(`${name} left before the match started`);
      // mid-song: the match ends there, and the other player is taken off the song back to the match screen
      case 'playing': this.kill(id); return [...this.end(`${name} left the match`), { to: 'all', msg: { t: 'rpAbort' } }];
      case 'results': if (this.roundsRemaining()) this.kill(id); return [];
    }
    this.kill(id);
    return this.end(`${name} left the match`);
  }
  /** After the match: a player asks for a rematch; once both still here have, a new (unrated) match starts in the room. */
  askRematch(id) {
    if (this.stage !== 'ended' || !this.users[id] || this.room.players.length !== 2) return [];
    this.rematch[id] = true;
    if (!this.room.players.every(p => this.rematch[p.id])) return [this.room.system(`${(this.room.get(id) || {}).name || 'Your opponent'} wants a rematch`), this.room.roomMsg()];
    const next = new RankedPlay(this.room, { keys: this.keys, rated: false });
    for (const p of this.room.players) {
      const u = this.users[p.id];
      next.addUser(p, { mu: u.muAfter ?? u.mu, sigma: u.sigmaAfter ?? u.sigma, cid: u.cid });
      Object.assign(p, { ready: false, hasMap: false, playing: false, finished: null, live: null, diff: null });
    }
    this.room.rp = next;
    this.room.map = null;
    return [this.room.system('Rematch!'), ...next.begin()];
  }
  end(why) {
    if (this.stage === 'ended') return [];
    this.go('ended', 0);
    this.room.map = null;
    this.complete();
    const w = this.winner && this.room.get(this.winner);
    return [this.room.system(why ? `${why}${w ? ` — ${w.name} wins` : ''}` : w ? `${w.name} wins the match!` : 'The match is over'), this.room.roomMsg()];
  }
  /** The match is decided: the winner (the most life; equal life is a draw) and, when rated, the new ratings. */
  complete() {
    if (this.completed) return;
    this.completed = true;
    if (this.round === 0) return; // never started: no winner, nothing rated
    const ids = Object.keys(this.users), max = Math.max(...ids.map(id => this.users[id].life)), top = ids.filter(id => this.users[id].life === max);
    this.winner = top.length === 1 ? top[0] : null;
    if (!this.rated || ids.length < 2) return;
    const after = rateMatch(ids.map(id => ({ mu: this.users[id].mu, sigma: this.users[id].sigma, score: this.users[id].life })));
    ids.forEach((id, i) => { const u = this.users[id]; u.ratingAfter = Math.round(after[i].mu); u.muAfter = after[i].mu; u.sigmaAfter = after[i].sigma; });
  }
}

/** The Ranked Play queue (lazer's MatchmakingQueue for a 1v1 pool): players wait in a queue per key count; two whose
 *  ratings are close enough are offered the match, and once both accept they're sent to a fresh room. The search
 *  widens the longer someone waits. Declining or ignoring the offer costs a minute out of the queue; the other player
 *  goes back to searching. Clients poll every couple of seconds; one that stops polling drops out. */
export const QUEUE = { RADIUS: 250, RADIUS_DOUBLE: 30_000, INVITE: 30_000, STALE: 12_000, READY_KEEP: 60_000 };
export class RankedQueue {
  constructor(now = () => Date.now(), rnd = Math.random, code = () => Math.random().toString(36).slice(2, 8).toUpperCase()) {
    this.now = now; this.rnd = rnd; this.code = code;
    this.users = new Map();  // ticket → { ticket, cid, name, avatar, keys, rating, since, seen, state, invite, room }
    this.invites = new Map(); // id → { id, tickets: [a, b], deadline, accepted: Set, keys }
    this.bans = new Map();   // cid → until
    this.seq = 0;
  }
  id() { return (++this.seq).toString(36) + Math.floor(this.rnd() * 2 ** 40).toString(36); }
  banned(cid) { const t = cid && this.bans.get(cid); if (t && t > this.now()) return t - this.now(); if (t) this.bans.delete(cid); return 0; }
  ban(cid, ms) { if (cid) this.bans.set(cid, Math.max(this.bans.get(cid) || 0, this.now() + ms)); }
  join(o) {
    const cid = String(o.cid || '').slice(0, 40), left = this.banned(cid);
    if (left) return { status: 'banned', left };
    for (const [t, u] of this.users) if (cid && u.cid === cid) this.remove(t); // one queue entry per player
    const ticket = this.id() + this.id();
    const u = { ticket, cid, name: String(o.name || 'Player').slice(0, 24), avatar: typeof o.avatar === 'string' && o.avatar.length < 12000 ? o.avatar : '',
      keys: Number(o.keys) === 7 ? 7 : 4, rating: num(o.rating, 0, 5000, RATING.MU), since: this.now(), seen: this.now(), state: 'search', invite: null, room: null };
    this.users.set(ticket, u);
    this.update();
    return this.status(ticket);
  }
  remove(ticket) {
    const u = this.users.get(ticket);
    if (!u) return;
    this.users.delete(ticket);
    if (u.invite) this.cancel(u.invite, ticket);
  }
  /** An offer fell through because of `ticket` (declined, ignored or left): they're out, the other searches again. */
  cancel(id, ticket) {
    const inv = this.invites.get(id);
    if (!inv) return;
    this.invites.delete(id);
    for (const t of inv.tickets) {
      const u = this.users.get(t);
      if (!u) continue;
      if (t === ticket || (!ticket && !inv.accepted.has(t))) { this.ban(u.cid, RP.DECLINE_BAN); this.users.delete(t); }
      else { u.state = 'search'; u.invite = null; }
    }
  }
  radius(u) {
    const ratingBonus = Math.exp(((u.rating - 1500) / 750) ** 2);
    return QUEUE.RADIUS * ratingBonus * 2 ** ((this.now() - u.since) / QUEUE.RADIUS_DOUBLE);
  }
  /** Drop players who stopped polling, time out offers, and pair whoever can be paired. */
  update() {
    const t = this.now();
    for (const [ticket, u] of [...this.users]) if (t - u.seen > QUEUE.STALE && u.state !== 'ready') this.remove(ticket);
    for (const [ticket, u] of [...this.users]) if (u.state === 'ready' && t - u.seen > QUEUE.READY_KEEP) this.users.delete(ticket);
    for (const [id, inv] of [...this.invites]) if (t > inv.deadline) this.cancel(id, null);
    const waiting = [...this.users.values()].filter(u => u.state === 'search').sort((a, b) => a.since - b.since);
    const taken = new Set();
    for (const u of waiting) {
      if (taken.has(u.ticket)) continue;
      const r = this.radius(u);
      const opp = waiting.filter(v => v !== u && !taken.has(v.ticket) && v.keys === u.keys && (!u.cid || v.cid !== u.cid) && Math.abs(v.rating - u.rating) <= Math.max(r, this.radius(v)))
        .sort((a, b) => Math.abs(a.rating - u.rating) - Math.abs(b.rating - u.rating))[0];
      if (!opp) continue;
      taken.add(u.ticket); taken.add(opp.ticket);
      const id = this.id();
      this.invites.set(id, { id, tickets: [u.ticket, opp.ticket], deadline: t + QUEUE.INVITE, accepted: new Set(), keys: u.keys });
      u.state = opp.state = 'invited'; u.invite = opp.invite = id;
    }
  }
  accept(ticket) {
    const u = this.users.get(ticket);
    if (!u || u.state !== 'invited') return this.status(ticket);
    const inv = this.invites.get(u.invite);
    inv.accepted.add(ticket);
    if (inv.tickets.every(x => inv.accepted.has(x))) {
      // both in: a fresh room for the two of them
      const code = this.code();
      this.invites.delete(inv.id);
      for (const x of inv.tickets) { const v = this.users.get(x); if (v) { v.state = 'ready'; v.room = code; v.invite = null; } }
    }
    return this.status(ticket);
  }
  decline(ticket) {
    const u = this.users.get(ticket);
    if (u && u.invite) this.cancel(u.invite, ticket); else this.remove(ticket);
    return { status: 'none' };
  }
  status(ticket) {
    const u = this.users.get(ticket);
    if (!u) return { status: 'none' };
    u.seen = this.now();
    const queued = [...this.users.values()].filter(v => v.keys === u.keys && v.state === 'search').length;
    if (u.state === 'search') return { status: 'search', ticket, queued, waited: this.now() - u.since };
    if (u.state === 'ready') return { status: 'ready', ticket, room: u.room, keys: u.keys };
    const inv = this.invites.get(u.invite), o = this.users.get(inv.tickets.find(x => x !== ticket));
    return { status: 'found', ticket, left: Math.max(0, inv.deadline - this.now()), accepted: inv.accepted.has(ticket), opponentAccepted: !!o && inv.accepted.has(o.ticket),
      opponent: o ? { name: o.name, avatar: o.avatar, rating: Math.round(o.rating) } : null, keys: u.keys };
  }
  /** Queue sizes per key count, for the lobby. */
  counts() { const c = { 4: 0, 7: 0 }; for (const u of this.users.values()) if (u.state === 'search') c[u.keys]++; return c; }
}
