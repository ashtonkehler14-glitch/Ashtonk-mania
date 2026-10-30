// Online multiplayer for Ashtonk!mania: rooms of up to 8 (Head to Head or Team Versus) and osu!lazer-style Quick Play.
//  - MatchRoom (Durable Object, one per room code) relays a tiny JSON protocol over WebSockets.
//  - Matchmaker (Durable Object, single instance) pairs players for "Quick match".
//  - RoomLogic holds all room rules and is plain JS so it can be unit-tested in Node.
//
// Protocol (client → server): hello {name, create, mode?, keys?, size?, sr?}, settings {settings} (host), team {team}, pool {maps}
// (Quick Play host), pick {i} (Quick Play), chat {text}, suggest {map}, diff {diff}, map {map, mods, modConfig} (host),
// mods {mods} (your own mods), rate {mods, modConfig} (the host: set the room's speed mod; anyone else: propose one), vote {yes}, hasMap {has}, ready {ready},
// start (host), skip (vote to skip the intro), score {score, acc, combo, hp}, finish {result}, quit, ping {c}.
// Server → client: welcome {you, room}, room {room}, chat {...}, start {delay, map, mods, modConfig, playerMods},
// skipvote {votes, total}, skip, opp {id, score, acc, combo, hp}, results {results}, error {msg, fatal}, pong {c, s},
// qpPool {round, keys, sr} (to the Quick Play host: send this round's beatmap pool).
// Watching (someone spectating a Ranked Play player): hello {watch: their pid} — welcome {you: theirs, watch, room}, then
// what that player is sent (room, chat, opp, hand, results), and nothing they send counts but ping.
//
// Room settings (host, like lazer's match settings): match type Head to Head or Team Versus (red/blue; the team with
// the higher team average wins), the win condition (pp, score, accuracy or max combo), room size (2-8) and queue mode (the
// host picks every map, or the host role passes to the next player after each match).
//
// Quick Play (osu!lazer's matchmaking mode): the matchmaker fills a lobby of up to 8 for 4K or 7K. Once two or more
// are in, a short countdown starts the first round. Each round the host's client offers a pool of beatmaps, everyone
// picks one, and a roulette lands on one of the picked maps; everyone downloads it and plays. Placements score points
// (8, 6, 5, 4, 3, 2, 1, 0), and after the last round the most points wins.
//
// Ranked Play (osu!lazer's 1v1 card mode, with its queue and rating) lives in ranked-play.js; a room in 'rp' mode hands
// its stages to a RankedPlay instance.
//
// Mods: everyone picks their own mods (Hidden, Hard Rock, Mirror…). Mods that change the song's speed (DT, NC, HT, DC,
// Rate) apply to the whole room, so they only take effect once every player accepts. Skipping the intro also needs
// every player's vote.

import { RankedPlay, RankedQueue, RP } from './ranked-play.js';
import { SETTINGS_MAX, SKIN_MAX, SCORE_MAX, SCORES_SEND } from './vault.js';
export { RP, RankedPlay, RankedQueue, rateMatch, deckTargets, deckTargetsForStars, beatmapRating, starsForRating, initialRating, RATING, QUEUE, uniqueSongs } from './ranked-play.js';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const START_DELAY = 5000;
const MAX_PLAYERS = 16;
export const WIN_CONDITIONS = ['pp', 'score', 'accuracy', 'combo'];
/** Quick Play phase lengths (ms), rounds and placement points. */
export const QP = { GATHER: 20000, FULL: 3000, POOL: 15000, PICK: 25000, REVEAL: 5000, LOAD: 90000, STANDINGS: 12000, ROUNDS: 5 };
export const QP_POINTS = [8, 6, 5, 4, 3, 2, 1, 0];
const QP_BLOCKED = ['map', 'mods', 'rate', 'vote', 'diff', 'ready', 'start', 'settings', 'team', 'kick', 'giveHost'];

export function makeCode(len = 6, rnd = Math.random) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)];
  return s;
}
export const RATE_MODS = ['DT', 'NC', 'HT', 'DC', 'RT'];
/** Valid mod ids, deduplicated; Auto is never allowed in a match. */
export function cleanMods(list) {
  return Array.isArray(list) ? [...new Set(list.filter(x => typeof x === 'string' && /^[A-Z]{2,3}$/.test(x) && x !== 'AT'))].slice(0, 12) : [];
}
// (mods a judged play can't have — Cinema, Wind Up / Down, Adaptive Speed, Muted: the judge turns those plays down, and a
// match result it turned down is an F — so a room never takes them, even ones still picked from solo play)
export const NO_ROOM_MODS = ['AT', 'CN', 'WU', 'WD', 'AS', 'MU'];
const personalMods = list => cleanMods(list).filter(x => !RATE_MODS.includes(x) && !NO_ROOM_MODS.includes(x));
const speedMods = list => cleanMods(list).filter(x => RATE_MODS.includes(x)).slice(0, 1);
const cleanConfig = c => c && typeof c === 'object' ? Object.fromEntries(Object.entries(c).slice(0, 12).map(([k, v]) => [str(k, 16), num(v, -1e4, 1e4)])) : null;
/** A shared profile picture: a preset / public picture id, or a small inline JPEG / PNG / WebP. */
export const cleanAvatar = a => typeof a === 'string' && a.length <= 24000 && /^(preset:[\w-]{1,32}|file:[\w .()-]{1,64}|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/.test(a) ? a : '';
export const validCode = c => typeof c === 'string' && /^[A-Z0-9]{4,8}$/.test(c);

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const num = (v, lo, hi, def = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

function cleanMap(m) {
  if (!m || typeof m !== 'object' || typeof m.hash !== 'string' || !m.hash) return null;
  return {
    hash: str(m.hash, 64), title: str(m.title, 200), artist: str(m.artist, 200), version: str(m.version, 200), creator: str(m.creator, 100),
    keys: Math.round(num(m.keys, 1, 18, 4)), stars: num(m.stars, 0, 100), length: num(m.length, 0, 3600000),
    onlineSetId: Math.round(num(m.onlineSetId, -1, 1e9, -1)), onlineId: Math.round(num(m.onlineId, -1, 1e10, -1)),
  };
}
/** A Ranked Play card: a beatmap, and — `per` — the difficulty of its set each player (`ids`) plays, each near the
 *  star rating they chose. Their difficulties must be the same length (one song, not a pack of several of different
 *  lengths): a card whose aren't is left out. A card without `per` is one difficulty for both. */
function cleanRankedCard(m, ids) {
  const map = cleanSuggestion(m);
  if (!map || !m.per || typeof m.per !== 'object') return map;
  const per = {};
  for (const id of ids) {
    const d = m.per[id];
    if (!d || typeof d !== 'object') return map;
    per[id] = { version: str(d.version, 200), stars: num(d.stars, 0, 100), onlineId: Math.round(num(d.onlineId, -1, 1e10, -1)), length: num(d.length, 0, 3600000) };
  }
  const lens = Object.values(per).map(d => d.length);
  if (lens.some(x => !(x > 0)) || Math.max(...lens) - Math.min(...lens) > Math.max(3000, Math.max(...lens) * 0.03)) return null;
  map.per = per;
  return map;
}
/** Suggestions may point at a beatmap the suggester only found online (no local hash yet). */
function cleanSuggestion(m) {
  if (!m || typeof m !== 'object') return null;
  const map = cleanMap({ ...m, hash: typeof m.hash === 'string' && m.hash ? m.hash : '-' });
  if (!map || !map.title || (map.hash === '-' && map.onlineId <= 0 && map.onlineSetId <= 0)) return null;
  if (map.hash === '-') map.hash = '';
  return map;
}
const VERIFY_WAIT = 20000; // ms a finished play has to come in to be judged
const newToken = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); };

/** A team's value in Team Versus: the average of its players' (so 2 against 3 is fair: either side's score tops out
 *  at 1,000,000). Scores and combos are whole numbers. */
export function teamValue(vals, whole = false) {
  if (!vals.length) return 0;
  const v = vals.reduce((a, b) => a + b, 0) / vals.length;
  return whole ? Math.round(v) : v;
}
function cleanResult(r) {
  r = r && typeof r === 'object' ? r : {};
  const counts = Array.isArray(r.counts) ? r.counts.slice(0, 6).map(c => Math.round(num(c, 0, 1e6))) : [];
  while (counts.length < 6) counts.push(0);
  return {
    score: Math.round(num(r.score, 0, 1e7)), accuracy: num(r.accuracy, 0, 1), maxCombo: Math.round(num(r.maxCombo, 0, 1e6)),
    counts, grade: str(r.grade, 3) || 'D', passed: !!r.passed, pp: num(r.pp, 0, 1e5), forfeit: !!r.forfeit,
  };
}

// a regular room plays like osu!'s multiplayer: head to head, the highest score wins
// (autoStart: lazer's auto start — seconds after someone readies up before the match starts with whoever's ready, 0
//  off; autoSkip: every intro skipped as soon as anyone asks)
const AUTO_STARTS = [0, 30, 60, 120, 300];
const defaultSettings = () => ({ type: 'h2h', win: 'score', size: MAX_PLAYERS, queue: 'host', public: true, autoStart: 0, autoSkip: false });

export class RoomLogic {
  constructor(code, now = () => Date.now(), rnd = Math.random) {
    this.code = code; this.now = now; this.rnd = rnd;
    this.players = []; this.hostId = null; this.created = false; this.resultCid = new Map(); this.departedCid = new Map();
    this.map = null; this.mods = []; this.modConfig = null; this.vote = null;
    this.state = 'lobby'; this.deadline = 0; this.lastResults = null; this.departed = []; this.skipped = false;
    this.mode = 'custom'; this.settings = defaultSettings(); this.qp = null; this.rp = null;
  }
  get(id) { return this.players.find(p => p.id === id); }
  /** A regular room's setup — beatmap, mods, settings, host — kept in storage, so a restart of the server (every new
   *  version deployed restarts it) doesn't wipe the room: the players reconnect into it as it was. (A match under way,
   *  Quick Play and Ranked Play can't be carried over.) */
  saveable() {
    if (!this.created || this.mode !== 'custom' || !this.players.length) return null;
    const host = this.get(this.hostId);
    return { v: 1, map: this.map, mods: this.mods, modConfig: this.modConfig, settings: this.settings, hostPid: host ? host.pid : '', at: this.now() };
  }
  restore(d) {
    if (!d || d.v !== 1 || this.created || this.now() - (d.at || 0) > 6 * 3600000) return false;
    this.created = true; this.mode = 'custom';
    this.map = d.map || null; this.mods = Array.isArray(d.mods) ? d.mods : []; this.modConfig = d.modConfig || null;
    this.settings = { ...defaultSettings(), ...(d.settings || {}) };
    this.restoredHost = d.hostPid || '';
    return true;
  }
  /** The room as one player sees it (`viewer`): in Ranked Play your own cards are shown, your opponent's are not. */
  snapshot(viewer = null) {
    const q = this.qp;
    return {
      code: this.code, state: this.state, host: this.hostId, map: this.map, mods: this.mods, modConfig: this.modConfig,
      mode: this.mode, settings: { ...this.settings }, autoLeft: this.autoAt ? Math.max(0, this.autoAt - this.now()) : 0,
      rp: this.rp ? this.rp.view(viewer) : null,
      qp: q ? { keys: q.keys, round: q.round, rounds: q.rounds, phase: q.phase, left: q.deadline ? Math.max(0, q.deadline - this.now()) : 0,
        pool: q.pool, picks: { ...q.picks }, chosen: q.chosen, points: { ...q.points } } : null,
      vote: this.vote ? { mods: this.vote.mods, by: this.vote.by, yes: [...this.vote.yes] } : null,
      starting: !!this.pendingStart, players: this.players.map(p => ({ id: p.id, pid: p.pid, name: p.name, avatar: p.avatar, ready: p.ready, hasMap: p.hasMap, playing: p.playing, diff: p.diff, mods: p.mods, team: p.team, away: !!p.away,
        // (their song's over: what they got — judged, or as their game reported it while the judge checks it)
        fin: this.state === 'playing' && p.playing && (p.finished || p.claimed) ? (({ score, accuracy, maxCombo, counts, grade, passed, forfeit, pp }) => ({ score, accuracy, maxCombo, counts, grade, passed, forfeit, pp: pp || 0, checked: !!p.finished }))(p.finished || p.claimed) : null })),
    };
  }
  /** What the lobby's room list shows (null: not listed — private, Quick Play / Ranked Play, or empty). */
  listing() {
    if (!this.created || this.mode === 'qp' || !this.settings.public || !this.players.length) return null;
    const host = this.get(this.hostId), m = this.map, ranked = this.mode === 'rp';
    if (ranked && this.rp.rated) return null; // (queue matches are the two players' own)
    if (ranked && this.rp.stage === 'ended' && this.players.length < 2) return null; // (over, and nobody left to play again)
    return { code: this.code, name: `${host ? host.name : 'Someone'}'s ${ranked ? 'Ranked Play duel' : 'room'}`, host: host ? host.name : '', avatar: host ? host.avatar : '', rating: ranked && host && this.rp.user(host.id) ? this.rp.user(host.id).rating : null,
      players: this.players.length, size: this.settings.size, ranked, keys: ranked ? this.rp.keys : null, fair: ranked ? this.rp.fair : null,
      state: ranked ? (this.rp.stage === 'waitjoin' ? 'lobby' : 'playing') : this.state, type: this.settings.type, win: this.settings.win,
      map: m ? { title: m.title, artist: m.artist, version: m.version, stars: m.stars, keys: m.keys, onlineSetId: m.onlineSetId } : null };
  }
  /** The team with fewer players (red first), for someone joining a Team Versus room. */
  smallerTeam() { const red = this.players.filter(p => p.team === 0).length, blue = this.players.filter(p => p.team === 1).length; return red <= blue ? 0 : 1; }
  /** The next player after `id` in join order (the host rotation, and a Quick Play host who never sent a pool). */
  nextAfter(id) { const i = this.players.findIndex(p => p.id === id); return this.players.length ? this.players[(i + 1) % this.players.length].id : null; }
  /** The room update for everyone. In Ranked Play each player gets their own view (`each`: what one player is sent). */
  roomMsg() { return { to: 'all', msg: { t: 'room', room: this.snapshot() }, each: this.rp ? id => ({ t: 'room', room: this.snapshot(id) }) : null }; }
  system(text) { return { to: 'all', msg: { t: 'chat', from: null, name: '', text, ts: this.now() } }; }

  /** Who was on which team, by browser (cid) and player (pid): someone who drops out and comes back is put back on
   *  their own team, not whichever is smaller. */
  remember(p) {
    if (p.team == null) return;
    if (!this.teamMem) this.teamMem = new Map();
    if (p.cid) this.teamMem.set('c:' + p.cid, p.team);
    if (p.pid) this.teamMem.set('p:' + p.pid, p.team);
    if (this.teamMem.size > 64) this.teamMem.delete(this.teamMem.keys().next().value);
  }
  teamFor(opts) {
    const m = this.teamMem, cid = str(opts.cid, 40), pid = String(opts.pid || '');
    const t = m && ((cid && m.get('c:' + cid)) ?? (pid && m.get('p:' + pid)));
    return t === 0 || t === 1 ? t : this.smallerTeam();
  }
  join(id, name, create, opts = {}) {
    opts = opts && typeof opts === 'object' ? opts : {};
    if (!this.created && !create) return { ok: false, error: 'Room not found — check the code.' };
    // a player whose connection dropped mid-match comes back as themselves (same browser) — also when the server hasn't
    // noticed the old connection die yet (a network change leaves it looking open for minutes): this new one takes over,
    // instead of being turned away as a newcomer mid-match or counted as someone else
    const back = opts.cid ? this.players.find(p => p.cid && p.cid === String(opts.cid).slice(0, 40)) : null;
    if (back) {
      back.away = false; back.awayUntil = 0;
      // catch them up: everyone's latest live score (so the in-game leaderboard fills straight back in), and the
      // match's results if it ended while they were reconnecting
      const catchUp = [];
      if (this.state === 'playing') for (const q of this.players) if (q !== back && q.playing && q.live) catchUp.push({ to: back.id, msg: { t: 'opp', id: q.id, ...q.live } });
      if (this.state === 'lobby' && this.lastResults && this.lastResults.rows.some(r => r.id === back.id)) catchUp.push({ to: back.id, msg: { t: 'results', results: this.lastResults } });
      return { ok: true, as: back.id, out: [{ to: back.id, msg: { t: 'welcome', you: back.id, token: back.token, room: this.snapshot(back.id) } }, ...catchUp, this.roomMsg(), this.system(`${back.name} reconnected`)] };
    }
    if (this.players.length >= this.settings.size) return { ok: false, error: 'This room is full.' };
    if (this.qp && this.qp.round > 0) return { ok: false, error: 'This Quick Play match has already started.' };
    if (this.rp && this.rp.stage !== 'waitjoin') return { ok: false, error: 'This Ranked Play match has already started.' };
    if (this.state !== 'lobby') return { ok: false, error: 'A match is in progress in this room.' };
    // each lounge joins only its own kind of room (the client says which it's joining from)
    if (this.created && opts.want === 'rp' && !this.rp) return { ok: false, error: 'That\'s a regular room — join it from the multiplayer lounge.' };
    if (this.created && opts.want === 'room' && (this.rp || this.qp)) return { ok: false, error: 'That\'s a Ranked Play room — join it from Ranked Play on the main menu.' };
    if (!this.created) {
      // whoever opens the room sets it up: Quick Play, or a custom room (a quick 1v1 match asks for 2 players)
      this.created = true;
      if (opts.mode === 'rp') {
        // a match the queue made is rated and unlisted; a duel between friends is neither rated nor (unless public) listed
        this.mode = 'rp'; this.settings = { ...defaultSettings(), win: 'score', size: 2, public: !opts.rated && opts.public !== false };
        this.rp = new RankedPlay(this, { keys: opts.keys, rated: !!opts.rated, deck: opts.deck });
      } else if (opts.mode === 'qp') {
        this.mode = 'qp'; this.settings = { ...defaultSettings(), win: 'score', size: 8 };
        this.qp = { keys: Number(opts.keys) === 7 ? 7 : 4, round: 0, rounds: QP.ROUNDS, phase: 'gather', deadline: 0, pool: null, picks: {}, chosen: -1, points: {}, fails: 0 };
      } else {
        if (opts.size != null) this.settings.size = Math.round(num(opts.size, 2, MAX_PLAYERS, MAX_PLAYERS));
        if (opts.size != null && opts.size <= 2) this.settings.public = false; // quick 1v1 rooms aren't listed
        if (opts.public === false) this.settings.public = false;
        if (opts.type === 'teams') this.settings.type = 'teams'; // (Team Versus from the lounge's Create room)
      }
    }
    const p = { id, name: str(name, 24) || 'Player', avatar: cleanAvatar(opts.avatar), ready: false, hasMap: false, playing: false, finished: null, live: null, diff: null, mods: [], skip: false,
      team: this.settings.type === 'teams' ? this.teamFor(opts) : null, sr: num(opts.sr, 0, 15, 0), cid: str(opts.cid, 40), pid: /^[a-z0-9]{6,24}$/.test(String(opts.pid || '')) ? String(opts.pid) : '', away: false, awayUntil: 0,
      token: newToken() }; // (for this player's plays sent to be judged: see verify)
    this.players.push(p);
    // back after their connection dropped for too long to keep their seat: the last match's results are theirs again
    // (their row, under their new id, so "You win" / "You lose" and everyone else's scores show as before)
    const mine = this.lastResults && p.cid ? this.lastResults.rows.find(r => this.resultCid.get(r.id) === p.cid) : null;
    if (mine) {
      const was = mine.id;
      for (const r of this.lastResults.rows) if (r.id === was) r.id = id;
      if (this.lastResults.winner === was) this.lastResults.winner = id;
      this.resultCid.delete(was); this.resultCid.set(id, p.cid);
    }
    if (!this.hostId) this.hostId = id;
    if (this.restoredHost && p.pid === this.restoredHost) { this.hostId = id; this.restoredHost = ''; } // (the host back after a restart)
    if (this.qp) { this.qp.points[id] = 0; this.qpGather(); }
    const out = [{ to: id, msg: { t: 'welcome', you: id, token: p.token, room: this.snapshot(id) } }, this.roomMsg(), this.system(`${p.name} joined the room`)];
    if (mine && this.state === 'lobby') out.splice(1, 0, { to: id, msg: { t: 'results', results: this.lastResults } });
    if (this.rp) {
      this.rp.addUser(p, opts);
      out[0].msg.room = this.snapshot(id);
      if (this.players.length === 2) out.push(...this.rp.begin()); // both in: the match begins
    }
    return { ok: true, out };
  }

  /** A connection closed. Mid-match (a song being played, or a Ranked Play match under way) a dropped connection isn't
   *  a loss: the player keeps their place for a while to reconnect. Leaving on purpose (the client says "bye", which
   *  it also does when its tab is closed) or never coming back is. */
  disconnect(id) {
    const p = this.get(id);
    if (!p) return [];
    // (finished and waiting for the others counts too: their result stays in the match; and just after a match, a
    // short wait — long enough for a quick reconnect to get the results with everyone in them)
    const midMatch = (this.state === 'playing' && p.playing) || (this.rp && !['waitjoin', 'ended'].includes(this.rp.stage));
    const justPlayed = !midMatch && this.state === 'lobby' && this.lastResults && this.now() - this.lastResults.at < 120000 && this.lastResults.rows.some(r => r.id === p.id);
    // (and in a room's lobby: a dropped connection keeps its seat — host, ready, team, difficulty — for 30 s, so a
    // blip in the network comes back as the same player instead of someone who left and joined again)
    const lobbyDrop = !midMatch && !justPlayed && this.state === 'lobby' && !this.qp && !this.rp;
    if ((midMatch || justPlayed || lobbyDrop) && p.cid && !p.leaving) {
      p.away = true; p.awaySince = this.now(); p.awayUntil = this.now() + (midMatch ? RP.AWAY : justPlayed ? 20000 : 30000);
      return [this.system(`${p.name} lost connection — waiting for them to come back`), this.roomMsg()];
    }
    return this.leave(id);
  }
  /** Between matches the host can't stay away: the room would sit waiting for them, with nobody able to pick a
   *  beatmap or start. A blip (back within 10 s) keeps the host; longer, the next player still here takes over (lazer
   *  hands the host on as soon as they go), and coming back they're a player like the rest. */
  passHostIfAway() {
    const host = this.get(this.hostId);
    if (!host || !host.away || this.state !== 'lobby' || this.qp || this.rp || this.now() - (host.awaySince || 0) < 10000) return [];
    const next = this.players.find(x => !x.away && x !== host);
    if (!next) return [];
    this.hostId = next.id;
    return [this.system(`${next.name} is now the host`)];
  }
  /** (`said`: the room's already been told why they're gone — kicked — so no "left the room" after it) */
  leave(id, { said = false } = {}) {
    const p = this.get(id);
    if (!p) return [];
    const out = [], wasPlaying = !!p.playing;
    if (this.rp) out.push(...this.rp.leave(id));
    if (this.state === 'playing' && p.playing) {
      if (!p.finished) p.finished = { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc, pp: p.live.pp } : {}), forfeit: true };
      this.departed.push({ id: p.id, name: p.name, diff: p.diff, team: p.team, ...p.finished, left: true }); if (p.cid) this.departedCid.set(p.id, p.cid);
    }
    this.players = this.players.filter(x => x !== p);
    this.remember(p);
    if (this.qp) delete this.qp.points[id];
    if (this.state === 'playing') out.push(...this.checkFinished(wasPlaying));
    if (!this.players.length) { this.reset(); return out; }
    const wasHost = this.hostId === id;
    if (wasHost) this.hostId = this.players[0].id;
    this.unreadyAll();
    if (this.vote) { this.vote = null; out.push(this.system('Speed mod vote cancelled')); }
    if (!said) out.push(this.system(`${p.name} left the room`));
    const q = this.qp;
    if (q && this.state !== 'playing') {
      if (q.phase === 'gather') this.qpGather();
      else if (q.phase !== 'final' && this.players.length < 2) out.push(...this.qpFinal('Everyone else left — Quick Play is over.'));
      else if (q.phase === 'pool' && wasHost) out.push(...this.qpAskPool()); // the new host sends the pool instead
      else if (q.phase === 'load') out.push(...this.qpMaybeStart());
    }
    out.push(this.roomMsg());
    return out;
  }
  reset() {
    this.created = false; this.hostId = null; this.map = null; this.mods = []; this.modConfig = null; this.vote = null;
    this.state = 'lobby'; this.deadline = 0; this.lastResults = null; this.departed = [];
    this.mode = 'custom'; this.settings = defaultSettings(); this.qp = null; this.rp = null;
  }

  message(id, m) {
    const p = this.get(id);
    if (!p || !m || typeof m !== 'object') return [];
    const host = id === this.hostId;
    if ((this.qp || this.rp) && QP_BLOCKED.includes(m.t)) return []; // Quick Play / Ranked Play run themselves
    switch (m.t) {
      case 'settings': {
        if (!host || this.state !== 'lobby') return [];
        const st = this.settings, o = m.settings && typeof m.settings === 'object' ? m.settings : {}, changes = [];
        if (['h2h', 'teams'].includes(o.type) && o.type !== st.type) {
          st.type = o.type;
          this.players.forEach((x, i) => { x.team = st.type === 'teams' ? i % 2 : null; this.remember(x); });
          changes.push(st.type === 'teams' ? 'Team Versus' : 'Head to Head');
        }
        if (WIN_CONDITIONS.includes(o.win) && o.win !== st.win) { st.win = o.win; changes.push(`win by ${o.win === 'combo' ? 'max combo' : o.win}`); }
        if (o.size != null) {
          const n = Math.max(2, this.players.length, Math.round(num(o.size, 2, MAX_PLAYERS, st.size)));
          if (n !== st.size) { st.size = n; changes.push(`up to ${n} players`); }
        }
        if (typeof o.public === 'boolean' && o.public !== st.public) { st.public = o.public; changes.push(o.public ? 'listed in the lobby' : 'private (join with the code)'); }
        if (['host', 'rotate'].includes(o.queue) && o.queue !== st.queue) { st.queue = o.queue; changes.push(o.queue === 'rotate' ? 'the host rotates after each match' : 'the host picks every map'); }
        if (AUTO_STARTS.includes(o.autoStart) && o.autoStart !== st.autoStart) { st.autoStart = o.autoStart; changes.push(o.autoStart ? `auto start after ${o.autoStart >= 60 ? `${o.autoStart / 60} min` : `${o.autoStart}s`}` : 'auto start off'); this.armAuto(); }
        if (typeof o.autoSkip === 'boolean' && o.autoSkip !== st.autoSkip) { st.autoSkip = o.autoSkip; changes.push(o.autoSkip ? 'intros skipped automatically' : 'auto skip off'); }
        if (!changes.length) return [];
        this.unreadyAll();
        return [this.roomMsg(), this.system(`Room settings: ${changes.join(', ')}`)];
      }
      // lazer's participant panel, for the host: kick a player (between matches), or hand the room to them
      case 'kick': {
        const t = this.get(String(m.id || ''));
        if (!host || !t || t === p || this.state !== 'lobby') return [];
        return [{ to: t.id, msg: { t: 'kicked' } }, this.system(`${t.name} was removed from the room`), ...this.leave(t.id, { said: true })];
      }
      case 'giveHost': {
        const t = this.get(String(m.id || ''));
        if (!host || !t || t === p) return [];
        this.hostId = t.id;
        return [this.system(`${t.name} is now the host`), this.roomMsg()];
      }
      case 'team':
        if (this.state !== 'lobby' || this.settings.type !== 'teams') return [];
        p.team = m.team ? 1 : 0; this.remember(p);
        return [this.roomMsg()];
      case 'pool': {
        if (this.rp) return Array.isArray(m.maps) ? this.rp.setDeck(id, m.maps.slice(0, RP.DECK).map(x => cleanRankedCard(x, Object.keys(this.rp.users))).filter(Boolean)) : [];
        const q = this.qp;
        if (!q || !host || q.phase !== 'pool' || !Array.isArray(m.maps)) return [];
        const maps = m.maps.slice(0, 6).map(cleanSuggestion).filter(Boolean);
        if (!maps.length) return [];
        q.pool = maps; q.picks = {}; q.chosen = -1; q.phase = 'pick'; q.deadline = this.now() + QP.PICK;
        return [this.roomMsg()];
      }
      case 'discard': return this.rp ? this.rp.discard(id, m.cards) : [];
      case 'hand': return this.rp ? this.rp.hand(id, m) : [];
      case 'play': return this.rp ? this.rp.play(id, m.card) : [];
      case 'pick': {
        const q = this.qp, i = Number(m.i);
        if (!q || q.phase !== 'pick' || !Number.isInteger(i) || i < 0 || i >= q.pool.length) return [];
        q.picks[id] = i;
        // everyone has picked: spin the roulette after a moment
        if (this.players.every(x => q.picks[x.id] != null)) q.deadline = Math.min(q.deadline, this.now() + 1500);
        return [this.roomMsg()];
      }
      case 'rpready': return this.rp && m.ready !== false ? this.rp.setReady(id) : [];
      case 'rpStars': return this.rp ? this.rp.setStars(id, m.stars) : [];
      case 'rematch': return this.rp ? this.rp.askRematch(id) : [];
      case 'bye': p.leaving = true; return []; // (leaving on purpose: the closed connection isn't a drop to wait out)
      case 'ping': return [{ to: id, msg: { t: 'pong', c: m.c, s: this.now() } }];
      case 'chat': {
        const text = str(m.text, 300);
        return text ? [{ to: 'all', msg: { t: 'chat', from: id, name: p.name, text, ts: this.now() } }] : [];
      }
      case 'suggest': {
        const map = cleanSuggestion(m.map);
        if (!map) return [];
        return [{ to: 'all', msg: { t: 'chat', from: id, name: p.name, text: `suggested ${map.artist} - ${map.title} [${map.version}]`, suggest: map, ts: this.now() } }];
      }
      case 'map': {
        if (!host || this.state !== 'lobby') return [];
        const map = cleanMap(m.map);
        if (!map) return [{ to: id, msg: { t: 'error', msg: 'Invalid beatmap' } }];
        this.map = map;
        this.unreadyAll();
        for (const x of this.players) { x.diff = null; if (x.id !== id) x.hasMap = false; }
        p.hasMap = true;
        const out = [this.system(`Beatmap changed to ${map.artist} - ${map.title} [${map.version}]`)];
        if (Array.isArray(m.mods)) {
          p.mods = personalMods(m.mods);
          // the host's speed mod (DT…) becomes the room's. Picking a map without one keeps the room's current speed
          // (removing it goes through the Mods button)
          const sp = speedMods(m.mods);
          if (sp.length) out.push(...this.propose(p, sp, cleanConfig(m.modConfig)));
        }
        return [this.roomMsg(), ...out];
      }
      case 'mods':
        if (this.state !== 'lobby') return [];
        p.mods = personalMods(m.mods);
        return [this.roomMsg()];
      case 'rate':
        if (this.state !== 'lobby') return [];
        return [...this.propose(p, speedMods(m.mods), cleanConfig(m.modConfig)), this.roomMsg()];
      case 'vote': {
        if (this.state !== 'lobby' || !this.vote || this.vote.yes.includes(id)) return [];
        const label = this.vote.mods.join('') || 'no speed mod';
        if (!m.yes) { this.vote = null; return [this.system(`${p.name} declined ${label}`), this.roomMsg()]; }
        this.vote.yes.push(id);
        return [...this.settleVote(), this.roomMsg()];
      }
      case 'diff': {
        // each player may play any difficulty of the room's beatmap set (in Ranked Play: the one dealt to them)
        if (this.rp || this.state !== 'lobby' || !this.map) return [];
        const d = m.diff && typeof m.diff === 'object' ? m.diff : null;
        p.diff = d ? { version: str(d.version, 200), stars: num(d.stars, 0, 100), keys: Math.round(num(d.keys, 1, 18, 4)) } : null;
        return [this.roomMsg()];
      }
      case 'hasMap':
        p.hasMap = !!m.has;
        if (this.qp && this.qp.phase === 'load' && this.state === 'lobby') return [...this.qpMaybeStart(), this.roomMsg()];
        if (this.rp) return [...this.rp.mapState(), this.roomMsg()];
        // the host already pressed Start: it begins as soon as the last download is in
        if (this.pendingStart && this.canBegin()) { this.pendingStart = false; return this.beginMatch(this.here()); }
        return [this.roomMsg()];
      case 'ready':
        // (ready before the beatmap has finished downloading: it installs in the background, nobody sees it)
        if (this.state !== 'lobby') return [];
        p.ready = !!m.ready && !!this.map;
        if (!p.ready) this.pendingStart = false;
        this.armAuto();
        return [this.roomMsg()];
      case 'start': {
        if (!host || this.state !== 'lobby') return [];
        // (someone who dropped just after the last match isn't waited for: the match starts without them)
        const here = this.players.filter(x => !x.away);
        if (here.length < 2) return [{ to: id, msg: { t: 'error', msg: 'Wait for an opponent to join.' } }];
        if (!this.map || !here.every(x => x.ready)) return [{ to: id, msg: { t: 'error', msg: 'Everyone needs to be ready.' } }];
        if (this.vote) return [{ to: id, msg: { t: 'error', msg: 'Everyone has to accept (or decline) the speed mod first.' } }];
        // someone's beatmap is still downloading in the background: start the moment it's in
        if (!here.every(x => x.hasMap)) { this.pendingStart = true; return [this.roomMsg()]; }
        return this.beginMatch(here);
      }
      case 'skip': {
        // the intro is only skipped once every player still playing has asked to
        if (this.state !== 'playing' || !p.playing || p.finished || this.skipped || p.skip) return [];
        p.skip = true;
        const active = this.players.filter(x => x.playing && !x.finished);
        const votes = active.filter(x => x.skip).length;
        if (votes < active.length && !this.settings.autoSkip) return [{ to: 'all', msg: { t: 'skipvote', votes, total: active.length } }];
        this.skipped = true;
        return [{ to: 'all', msg: { t: 'skip' } }];
      }
      case 'score':
        if (this.state !== 'playing' || !p.playing || p.finished) return [];
        p.live = { score: Math.round(num(m.score, 0, 1e7)), acc: num(m.acc, 0, 1), combo: Math.round(num(m.combo, 0, 1e6)), maxCombo: Math.round(num(m.maxCombo, 0, 1e6)), hp: num(m.hp, 0, 1), pp: num(m.pp, 0, 1e5) };
        return [{ to: { except: id }, msg: { t: 'opp', id, ...p.live } }];
      case 'finish':
        // the song's over for them: what they say they scored is only shown while their play is judged (verify) —
        // the result is the judged play, or 0 if none comes in time
        if (this.state !== 'playing' || !p.playing || p.finished || p.claimed) return [];
        p.claimed = cleanResult(m.result); p.verifyDue = this.now() + VERIFY_WAIT;
        // (everyone's told straight away that their song's over — not only once every play has been judged)
        return (o => o.length ? o : [this.roomMsg()])(this.checkFinished());
      case 'quit':
        if (this.state !== 'playing' || !p.playing || p.finished) return [];
        // Ranked Play: leaving the song keeps the score you had when you left it (the game sends it just before) — the
        // round is decided on that; the other player plays on
        // (with the room as it is now: their row shows they're out, not still playing)
        if (this.rp) { p.finished = { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc, maxCombo: p.live.maxCombo } : {}), forfeit: true }; return [this.system(`${p.name} left the song`), ...this.checkFinished(), this.roomMsg()]; }
        p.finished = { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc, pp: p.live.pp } : {}), forfeit: true };
        return [this.system(`${p.name} quit the match`), ...this.checkFinished(), this.roomMsg()];
    }
    return [];
  }

  canBegin() { const here = this.here(); return this.state === 'lobby' && !!this.map && !this.vote && here.length >= 2 && here.every(x => x.ready && x.hasMap); }
  /** The players connected right now (not someone whose connection dropped and is being waited for). */
  here() { return this.players.filter(x => !x.away); }
  /** Start a match for `list` (everyone in a custom room; whoever loaded the beatmap in Quick Play). */
  /** lazer's auto start: the countdown runs while anyone's ready (and stops when nobody is). */
  /** Everyone un-readied (a new map, new rules, someone leaving, a new speed mod): nothing is left armed to start. */
  unreadyAll() { for (const x of this.players) x.ready = false; this.autoAt = 0; this.pendingStart = false; }
  armAuto() {
    const sec = this.settings.autoStart || 0, anyReady = this.players.some(x => x.ready);
    if (!sec || !anyReady || this.state !== 'lobby' || this.qp || this.rp) { this.autoAt = 0; return; }
    if (!this.autoAt) this.autoAt = this.now() + sec * 1000;
  }
  beginMatch(list) {
    this.pendingStart = false; this.autoAt = 0;
    this.state = 'playing'; this.skipped = false;
    this.deadline = this.now() + START_DELAY + (this.map.length || 600000) / rateOf(this.mods, this.modConfig) + 60000;
    for (const x of this.players) { x.playing = list.includes(x); x.finished = null; x.live = null; x.skip = false; }
    this.departed = []; this.departedCid = new Map();
    const g = this.qp;
    if (g) { g.phase = 'playing'; g.deadline = 0; }
    const playerMods = g || this.rp ? {} : Object.fromEntries(list.map(x => [x.id, x.mods]));
    return [{ to: 'all', msg: { t: 'start', delay: START_DELAY, map: this.map, mods: this.mods, modConfig: this.modConfig, playerMods, players: list.map(x => x.id) } }, this.roomMsg()];
  }

  // ── Quick Play
  /** Two or more in the lobby start the countdown to the first round; a full lobby starts it almost at once. */
  qpGather() {
    const q = this.qp;
    if (!q || q.phase !== 'gather') return [];
    if (this.players.length < 2) { q.deadline = 0; return []; }
    const at = this.now() + (this.players.length >= this.settings.size ? QP.FULL : QP.GATHER);
    if (!q.deadline || at < q.deadline) q.deadline = at;
    return [];
  }
  qpRound() {
    const q = this.qp;
    if (this.players.length < 2) return this.qpFinal('Not enough players left — Quick Play is over.');
    q.round++; q.pool = null; q.picks = {}; q.chosen = -1; q.fails = 0;
    this.map = null; this.mods = []; this.modConfig = null;
    for (const x of this.players) { x.hasMap = false; x.diff = null; x.ready = false; }
    return [this.system(`Round ${q.round} of ${q.rounds}`), ...this.qpAskPool()];
  }
  /** Ask the host's client for this round's pool, around the lobby's typical star rating. */
  qpAskPool() {
    const q = this.qp;
    q.phase = 'pool'; q.deadline = this.now() + QP.POOL;
    const srs = this.players.map(x => x.sr).filter(x => x > 0).sort((a, b) => a - b);
    const sr = srs.length ? srs[Math.floor(srs.length / 2)] : 0;
    return [{ to: this.hostId, msg: { t: 'qpPool', round: q.round, keys: q.keys, sr } }, this.roomMsg()];
  }
  /** The roulette: one of the picked maps (a map picked twice is twice as likely), or any of the pool if nobody picked. */
  qpChoose() {
    const q = this.qp;
    const votes = this.players.map(x => q.picks[x.id]).filter(i => i != null);
    const cand = votes.length ? votes : q.pool.map((_, i) => i);
    q.chosen = cand[Math.min(cand.length - 1, Math.floor(this.rnd() * cand.length))];
    this.map = q.pool[q.chosen];
    for (const x of this.players) { x.hasMap = false; x.diff = null; }
    q.phase = 'reveal'; q.deadline = this.now() + QP.REVEAL;
    return [this.roomMsg()];
  }
  qpMaybeStart() {
    const q = this.qp;
    if (!q || q.phase !== 'load' || !this.players.length || !this.players.every(x => x.hasMap)) return [];
    return this.qpStart();
  }
  /** Play with whoever has the beatmap; if nobody could get it, pick again. */
  qpStart() {
    const q = this.qp, list = this.players.filter(x => x.hasMap);
    if (!list.length) { q.round--; return [this.system('Nobody could load that beatmap — picking again'), ...this.qpRound()]; }
    const out = [];
    const out2 = this.players.filter(x => !x.hasMap);
    if (out2.length) out.push(this.system(`${out2.map(x => x.name).join(', ')} couldn't load the beatmap and sit${out2.length > 1 ? '' : 's'} this round out`));
    return [...out, ...this.beginMatch(list)];
  }
  qpFinal(text) {
    const q = this.qp;
    q.phase = 'final'; q.deadline = 0; this.map = null;
    const top = this.standings()[0];
    return [this.system(text || (top ? `Quick Play is over — ${top.name} wins with ${top.points} points!` : 'Quick Play is over')), this.roomMsg()];
  }
  standings() {
    const q = this.qp;
    return q ? this.players.map(p => ({ id: p.id, name: p.name, points: q.points[p.id] || 0 })).sort((a, b) => b.points - a.points) : [];
  }
  qpTick() {
    const q = this.qp;
    if (!q || !q.deadline || this.now() < q.deadline || this.state !== 'lobby') return [];
    switch (q.phase) {
      case 'gather': return this.qpRound();
      case 'pool':
        // the host never sent a pool: ask the next player (three tries)
        if (++q.fails >= 3) return this.qpFinal('Couldn\'t find beatmaps for this round — Quick Play is over.');
        this.hostId = this.nextAfter(this.hostId);
        return this.qpAskPool();
      case 'pick': return this.qpChoose();
      case 'reveal': q.phase = 'load'; q.deadline = this.now() + QP.LOAD; return [...this.qpMaybeStart(), this.roomMsg()];
      case 'load': return this.qpStart();
      case 'standings': return q.round >= q.rounds ? this.qpFinal() : this.qpRound();
    }
    return [];
  }
  /** Does the room need its clock ticking (a match to time out, a Quick Play / Ranked Play phase to end)? */
  wantsTick() { return this.state === 'playing' || !!this.autoAt || this.players.some(p => p.away) || !!(this.qp && this.qp.deadline) || !!(this.rp && this.rp.deadline); }

  /** A player asks for a room speed mod (or none). It applies once everyone has accepted. */
  propose(p, mods, modConfig) {
    const rateOfCfg = c => (c && Number.isFinite(+c.rate) ? +c.rate : 1);
    const same = (a, b, ca, cb) => a.length === b.length && a.every(x => b.includes(x)) && (!a.includes('RT') || Math.abs(rateOfCfg(ca) - rateOfCfg(cb)) < 0.005);
    // the host sets the room's speed outright (an open vote is settled by it); anyone else's goes to everyone
    if (p.id === this.hostId) {
      if (same(mods, this.mods, modConfig, this.modConfig)) return [];
      this.vote = null;
      this.mods = mods; this.modConfig = mods.includes('RT') ? modConfig : null; this.autoAt = 0; this.pendingStart = false;
      for (const x of this.players) x.ready = false;
      return [this.system(mods.length ? `${p.name} changed the speed to ${mods.join('')}` : `${p.name} removed the speed mod`)];
    }
    if (!this.vote && same(mods, this.mods, modConfig, this.modConfig)) return [];
    if (this.vote && same(mods, this.vote.mods, modConfig, this.vote.modConfig)) return [];
    this.vote = { mods, modConfig, by: p.id, yes: [p.id] };
    const settled = this.settleVote();
    if (settled.length) return settled;
    return [this.system(`${p.name} wants to play ${mods.length ? 'with ' + mods.join('') : 'without speed mods'} — everyone has to accept`)];
  }
  settleVote() {
    const v = this.vote;
    if (!v || !this.players.every(x => v.yes.includes(x.id))) return [];
    this.mods = v.mods; this.modConfig = v.mods.includes('RT') ? v.modConfig : null; this.vote = null; this.autoAt = 0; this.pendingStart = false;
    for (const x of this.players) x.ready = false;
    return [this.system(this.mods.length ? `Everyone accepted — playing with ${this.mods.join('')}` : 'Speed mods removed')];
  }

  /** Called periodically: players who never report back are timed out, and Quick Play moves through its phases. */
  tick() {
    // a dropped connection that didn't come back in time: gone for good
    const out = [];
    for (const p of [...this.players]) if (p.away && this.now() >= p.awayUntil) out.push(...this.leave(p.id));
    { const h = this.passHostIfAway(); if (h.length) out.push(...h, this.roomMsg()); }
    if (this.state === 'playing') {
      // a finished play whose key presses never came in to be judged counts for nothing
      let lapsed = false;
      // (no judgement in time — the judge can run out of CPU on a small server plan — the player's own result stands,
      // marked unverified, rather than a 0 that would spoil the match)
      for (const p of this.players) if (p.playing && !p.finished && p.claimed && this.now() >= p.verifyDue) { p.finished = { ...p.claimed, unverified: true }; lapsed = true; }
      if (lapsed) out.push(...this.checkFinished());
      if (this.state !== 'playing' || this.now() < this.deadline) return out;
      for (const p of this.players) if (p.playing && !p.finished) p.finished = { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc, pp: p.live.pp } : {}), forfeit: true };
      return [...out, ...this.checkFinished()];
    }
    if (this.state !== 'lobby') return out;
    // auto start: the match begins with whoever's ready (and has the beatmap) when the countdown runs out
    if (this.autoAt && this.now() >= this.autoAt && !this.qp && !this.rp) {
      this.autoAt = 0;
      const ready = this.players.filter(x => x.ready && x.hasMap);
      if (this.map && !this.vote && ready.length && this.players.length >= 2) return [...out, this.system('Auto start: the match is starting'), ...this.beginMatch(ready)];
      this.armAuto();
      return [...out, this.roomMsg()];
    }
    return [...out, ...(this.rp ? this.rp.tick() : this.qpTick())];
  }

  /** A player's play, judged by the server (verifyPlay, in no-fail mode as multiplayer plays). It must be this
   *  room's beatmap (or another difficulty of its set) with the room's mods and theirs; then it's their result —
   *  what decides the match, Quick Play's points and Ranked Play's damage. Anything else counts for nothing. */
  verify(id, token, r, { hash = '' } = {}) {
    const p = this.get(id);
    if (!p || !token || p.token !== token) return { error: 'Not a player in this room.' };
    if (this.state !== 'playing' || !p.playing || p.finished) return { error: 'No play to judge.', out: [] };
    const map = this.map || {};
    // (Ranked Play: their own difficulty of the card's set — the one near the star rating they chose — and no other)
    const own = this.rp && map.per && map.per[id];
    const sameMap = own ? (own.onlineId > 0 ? r.beatmapId === own.onlineId : r.version === own.version) && (!(map.onlineSetId > 0) || r.beatmapSetId === map.onlineSetId)
      : !this.map || (map.hash && hash === map.hash) || (map.onlineSetId > 0 && r.beatmapSetId === map.onlineSetId) ||
      (!!map.title && r.title === map.title && r.artist === map.artist);
    // (a play the judge turned down has no mods to compare: it counts for nothing — reading them threw, the judging
    // failed, and the player's own unchecked result stood instead)
    const want = [...new Set([...this.mods, ...(p.mods || [])])].sort().join(), got = !r.error && Array.isArray(r.mods) ? [...r.mods].sort().join() : '';
    // (Rate Adjust: the room's speed too — a slower play under the same mod isn't the room's)
    const rt = this.mods.includes('RT') && this.modConfig && Number.isFinite(+this.modConfig.rate) ? +this.modConfig.rate : null;
    const speedOk = rt == null || (Number.isFinite(+r.rate) && Math.abs(+r.rate - rt) < 0.005);
    if (r.error || !sameMap || want !== got || !speedOk) {
      p.finished = { ...cleanResult({}), grade: 'F', unverified: true };
      return { error: r.error || (!sameMap ? 'Not this room\'s beatmap.' : 'Not the room\'s mods.'), out: this.checkFinished() };
    }
    p.finished = { score: r.score, accuracy: r.accuracy, maxCombo: r.maxCombo, counts: r.counts, grade: r.failed ? 'F' : r.grade, passed: !r.failed, pp: r.pp, forfeit: false, verified: true };
    return { ok: true, out: (o => o.length ? o : [this.roomMsg()])(this.checkFinished()) };
  }

  checkFinished(someoneLeft = false) {
    if (this.state !== 'playing') return [];
    const active = this.players.filter(p => p.playing);
    const done = active.every(p => p.finished);
    // someone left mid-match: the player still here wins by forfeit straight away
    if (!done && !(someoneLeft && active.length === 1)) return [];
    const row = p => ({ id: p.id, name: p.name, diff: p.diff, team: p.team, mods: [...this.mods, ...(p.mods || [])], ...(p.finished || { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc, pp: p.live.pp } : {}), pending: true }) });
    const rows = [...active.map(row), ...this.departed];
    // ranked by the room's win condition (pp by default); score, then accuracy, only break ties — e.g. two fails at 0pp
    const win = this.settings.win, key = r => win === 'score' ? r.score : win === 'accuracy' ? r.accuracy : win === 'combo' ? r.maxCombo : r.pp;
    const order = (a, b) => (a.forfeit - b.forfeit) || (key(b) - key(a)) || (b.score - a.score) || (b.accuracy - a.accuracy);
    rows.sort(order);
    rows.forEach((r, i) => { r.place = i && order(rows[i - 1], r) === 0 ? rows[i - 1].place : i + 1; });
    let winner = rows.length === 1 ? rows[0].id : rows.length > 1 && order(rows[0], rows[1]) !== 0 ? rows[0].id : null;
    let teams = null, winnerTeam = null;
    if (this.settings.type === 'teams') {
      // Team Versus: each team's value is its players' average (score, pp, accuracy or combo), so uneven teams are
      // even — a team's score is out of 1,000,000 however many are on it; the higher average wins
      teams = [0, 1].map(t => {
        const m = rows.filter(r => r.team === t), vals = m.map(key);
        return { total: teamValue(vals, win === 'score' || win === 'combo'), players: m.length };
      });
      winnerTeam = teams[0].total === teams[1].total ? null : teams[0].total > teams[1].total ? 0 : 1;
      winner = null;
    }
    this.lastResults = { rows, winner, teams, winnerTeam, type: this.settings.type, win, map: this.map, mods: this.mods, at: this.now() };
    // (whose browser each row is: kept here, never sent — see join)
    this.resultCid = new Map([...this.departedCid, ...this.players.filter(x => x.cid && x.playing).map(x => [x.id, x.cid])]); this.departedCid = new Map();
    this.state = 'lobby'; this.deadline = 0; this.departed = [];
    for (const p of this.players) { p.playing = false; p.ready = false; p.finished = null; p.live = null; p.claimed = null; }
    const out = [...this.passHostIfAway()];
    const q = this.qp;
    if (this.rp) out.push(...this.rp.gameplayDone(rows));
    else if (q) {
      // placement points; a forfeit scores nothing
      for (const r of rows) { r.points = r.forfeit ? 0 : QP_POINTS[r.place - 1] ?? 0; if (q.points[r.id] != null) q.points[r.id] += r.points; }
      this.lastResults.qp = { round: q.round, rounds: q.rounds, standings: this.standings() };
      q.phase = 'standings'; q.deadline = this.now() + QP.STANDINGS;
    } else if (this.settings.queue === 'rotate' && this.players.length > 1) {
      this.hostId = this.nextAfter(this.hostId);
      out.push(this.system(`${this.get(this.hostId).name} picks the next beatmap`));
    }
    return [{ to: 'all', msg: { t: 'results', results: this.lastResults } }, ...out, this.roomMsg()];
  }
}

function rateOf(mods, cfg) {
  if (mods.includes('DT') || mods.includes('NC')) return 1.5;
  if (mods.includes('HT') || mods.includes('DC')) return 0.75;
  if (mods.includes('RT') && cfg && cfg.rate) return Math.max(0.5, Math.min(2, cfg.rate));
  return 1;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** A connection by plain requests, for a network that won't let a WebSocket through — a school's web filter or proxy:
 *  the web works, but a WebSocket never opens (the game said MP-RT / MP-W1006). It stands in for one: send() queues
 *  what's going to the player, close() ends it, and the player's requests (httpSession) bring their messages and take
 *  what's queued. */
export class HttpSock {
  constructor(sid, now = Date.now) { this.sid = sid; this.now = now; this.q = []; this.base = 1; this.waiter = null; this.closed = null; this.seen = now(); this.onclose = null; }
  send(data) {
    if (this.closed) return;
    this.q.push(String(data));
    if (this.q.length > 5000) { this.q.shift(); this.base++; } // (a player who stopped asking: their session ends soon anyway)
    // (what comes close together goes back together: a waiting poll is answered a moment later — fewer requests)
    if (this.waiter && !this._wt) this._wt = setTimeout(() => { this._wt = 0; this.wake(); }, 80);
  }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = { code, reason: String(reason || '') }; this.wake();
    const f = this.onclose; this.onclose = null; if (f) f();
  }
  wake() { const w = this.waiter; this.waiter = null; if (w) w(); }
  /** What's queued for the player — waiting up to `ms` for something (a request held open: long polling). Numbered:
   *  q[0] is message `base`. With `ack` (the last one the player got), what they have is let go and the rest stays
   *  until they say they have it — a reply a proxy cut off on its way is sent again, nothing's lost. (Without: an
   *  older game, everything goes at once.) */
  async take(ms, ack = null) {
    if (ack != null) { const n = Math.max(0, Math.min(this.q.length, ack - this.base + 1)); this.q.splice(0, n); this.base += n; }
    if (!this.q.length && !this.closed && ms > 0) {
      await new Promise(res => {
        if (this.waiter) this.waiter(); // (an earlier poll still waiting: it answers empty, this one waits)
        const t = setTimeout(() => { if (this.waiter === done) { this.waiter = null; res(); } }, ms);
        const done = () => { clearTimeout(t); res(); };
        this.waiter = done;
      });
    }
    if (ack == null) { const msgs = this.q.splice(0); this.base += msgs.length; return { msgs, closed: this.closed }; }
    return { msgs: this.q.slice(), first: this.base, closed: this.closed };
  }
}
/** A player's request on a plain-request connection: { sid?, msgs: [text…], poll?, close? }. The first (no sid) opens
 *  one — `attach(sock)` hooks it up as the WebSocket code does, returning { message(text), touch() } — and carries its
 *  hello; msgs go in in order; poll waits up to 15 s for what's going to the player and takes it; close ends it. A connection
 *  that hasn't been heard from in 45 s is closed (the player's gone). ack: the number of the last message the player
 *  got (see HttpSock.take). Answers { sid, msgs, first?, closed? }. */
export async function httpSession(map, body, attach, now = Date.now) {
  const t = now();
  for (const [k, s] of map) if (t - s.seen > 45000 || (s.closed && t - s.seen > 5000)) { s.close(4002, 'timeout'); map.delete(k); }
  let s = body.sid ? map.get(String(body.sid)) : null;
  if (body.sid && !s) return { msgs: [], closed: { code: 4001, reason: 'gone' } };
  if (!s) {
    if (map.size > 2000) return { msgs: [], closed: { code: 1013, reason: 'busy' } };
    s = new HttpSock(randomHex(12), now); map.set(s.sid, s);
    s.handlers = attach(s);
  }
  s.seen = t;
  // (each request is the player still being there — no pings needed to keep them on: see the handlers' touch)
  if (s.handlers.touch) s.handlers.touch();
  for (const m of Array.isArray(body.msgs) ? body.msgs.slice(0, 100) : []) if (typeof m === 'string') s.handlers.message(m);
  if (body.close) { s.close(1000, 'bye'); map.delete(s.sid); return { sid: s.sid, msgs: [], closed: s.closed }; }
  if (!body.poll) return { sid: s.sid, msgs: [] };
  const ack = body.ack == null || !Number.isFinite(Number(body.ack)) ? null : Number(body.ack);
  const r = await s.take(Math.max(0, Math.min(15000, Number(body.wait) || 15000)), ack);
  s.seen = now(); if (s.handlers.touch) s.handlers.touch();
  return { sid: s.sid, ...r };
}

// ── player codes: 16 characters from Crockford's base32 (no I, L, O or U — nothing to misread), 80 random bits, made
// here with the platform's secure random numbers. Only each code's SHA-256 is kept: with 2^80 possible codes, neither
// guessing one nor working one back from a stolen fingerprint is possible in practice.
export const CODE_ALPHABET32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const randomHex = bytes => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
export function newPlayerCode() {
  // (256 is a multiple of 32: each character is exactly uniform)
  return [...crypto.getRandomValues(new Uint8Array(16))].map(b => CODE_ALPHABET32[b & 31]).join('');
}
/** A code as typed — any case, with or without its dashes and spaces, O for 0 and I or L for 1 — or '' if it can't be one. */
export function cleanPlayerCode(s) {
  const c = String(s ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(c) ? c : '';
}
export const codeHash = c => sha256hex('ashtonk-code:' + c);
/** How long a ticket in a saved HTML file signs it in for (Matchmaker.account). */
export const TICKET_MS = 24 * 3600 * 1000;
/** The hash of the server owner's code (the ADMIN_CODE secret), or '' when there's none. */
export const adminCodeHash = env => { const c = cleanPlayerCode(env && env.ADMIN_CODE); return c ? codeHash(c) : ''; };

/** One room per code. Plain (non-hibernating) WebSockets: a room only lives while its players are connected. */
export class MatchRoom {
  constructor(state, env) { this.state = state; this.env = env; this.logic = null; this.socks = new Map(); this.timer = null; this.beat = null; this._listed = ''; this.seen = new Map(); this.kick = new Map(); this.watchers = new Map(); }
  static MAX_WATCHERS = 16;
  static WATCH_MSGS = new Set(['room', 'chat', 'opp', 'hand', 'results']);
  /** Tell the lobby's room list about this room (on change, and every 15 s while anyone is in it). */
  announce(force = false) {
    const l = this.logic && this.logic.listing(), body = JSON.stringify(l ? { room: l } : { remove: this.logic && this.logic.code });
    if (!force && body === this._listed) return;
    if (!l && !this._listed.includes('"room"')) { this._listed = body; return; }
    this._listed = body;
    if (!this.env.MATCHMAKER) return;
    const stub = this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName('global'));
    stub.fetch('https://mm/internal/rooms/update', { method: 'POST', body, headers: { 'content-type': 'application/json' } }).catch(() => {});
    if (l && !this.beat) this.beat = setInterval(() => this.announce(true), 15000);
    if (!l && this.beat) { clearInterval(this.beat); this.beat = null; }
  }
  /** Players ping every 5 s: a connection silent for 20 s has dropped without closing (the network went — Wi-Fi to
   *  mobile, a tunnel), so it's closed and the player counts as away, with their seat kept for them to come back,
   *  instead of looking connected to everyone else for minutes. Checked every 5 s in every room (private rooms and
   *  Ranked Play included). */
  dropSilent() {
    const t = Date.now();
    for (const [ws, w] of this.watchers) if (t - w.seen > 30000) { this.watchers.delete(ws); try { ws.close(4002, 'timeout'); } catch { /* closed */ } }
    if (!this.socks.size && !this.watchers.size) { clearInterval(this.sweep); this.sweep = null; return; }
    for (const [id, at] of this.seen) if (t - at > 20000) {
      const ws = this.socks.get(id);
      if (ws) { try { ws.close(4002, 'timeout'); } catch { /* closed */ } }
      (this.kick.get(id) || (() => this.seen.delete(id)))(); // (a dead connection may never report the close)
    }
  }
  async fetch(request) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code') || '';
    if (!this.logic) this.logic = new RoomLogic(code);
    if (!this._restored) this._restored = this.state.storage.get('room').then(d => { if (d && this.logic.restore(d)) this.announce(true); }).catch(() => {});
    await this._restored;
    if (url.pathname.endsWith('/status')) return json({ code, open: this.logic.created, players: this.logic.players.length, state: this.logic.state });
    // a player's play, sent to be judged here (their room token proves who they are): see RoomLogic.verify
    // (judged by the Worker that took the request — judging here would hold up, and on a small plan could reset, the
    // whole room — then handed over on a path only the Worker uses; see judgePlay)
    if (url.pathname.endsWith('/judged') && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object' || !body.r || typeof body.r !== 'object') return json({ error: 'Bad request.' }, 400);
      const v = this.logic.verify(String(body.id || ''), String(body.token || ''), body.r, { hash: String(body.hash || '') });
      this.dispatch(v.out || []); this.schedule();
      return json(v.ok ? { ok: true } : { error: v.error }, v.ok ? 200 : 422);
    }
    // (a network that won't let a WebSocket through: the same connection by plain requests — HttpSock)
    if (url.pathname.endsWith('/http') && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object') return json({ error: 'Bad request.' }, 400);
      return json(await httpSession(this.http || (this.http = new Map()), body, sock => this.attach(sock)));
    }
    // the server's owner closing the room (the admin panel, through the Matchmaker — the Worker's router never sends a
    // player here): everyone in it, and anyone watching, is sent back to the lounge, and it's gone
    if (url.pathname === '/close' && request.method === 'POST') {
      const n = this.logic.players.length;
      if (!this.logic.created && !this.socks.size) return json({ ok: false });
      this.dispatch([{ to: 'all', msg: { t: 'kicked', closed: true } }]);
      for (const ws of [...this.socks.values(), ...this.watchers.keys()]) { try { ws.close(4000, 'closed'); } catch { /* closed */ } }
      this.socks.clear(); this.watchers.clear(); this.seen.clear(); this.kick.clear();
      clearInterval(this.timer); this.timer = null;
      this.logic = new RoomLogic(code);
      this.announce(true);
      clearTimeout(this._saveT); this._saved = undefined;
      await this.state.storage.delete('room').catch(() => {});
      return json({ ok: true, players: n });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a WebSocket upgrade' }, 426);
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const c = this.attach(server);
    server.addEventListener('message', ev => c.message(ev.data));
    server.addEventListener('close', c.gone);
    server.addEventListener('error', c.gone);
    return new Response(null, { status: 101, webSocket: client });
  }
  /** A player's connection — a WebSocket, or the plain-request stand-in for one (HttpSock) — joined to the room:
   *  { message(text), gone() }. */
  attach(server) {
    let id = crypto.randomUUID().slice(0, 8);
    let joined = false, watcher = null;
    // (one message that goes wrong is dropped — an error escaping here could reset the room for everyone in it)
    const onMessage = data => {
      // (as much as the online connection takes: a hello with a player's own picture went over 16 KB and was dropped
      // without an answer — their game waited, then gave up with MP-RT)
      if (typeof data !== 'string' || data.length > 65536) return;
      let msg; try { msg = JSON.parse(data); } catch { return; }
      if (watcher) { watcher.seen = Date.now(); if (msg.t === 'ping') { try { server.send(JSON.stringify({ t: 'pong', c: msg.c, s: Date.now() })); } catch { /* closed */ } } return; }
      if (!joined) {
        if (msg.t !== 'hello') return;
        if (msg.watch != null) { watch(msg); return; }
        const r = this.logic.join(id, msg.name, !!msg.create, msg);
        if (!r.ok) { try { server.send(JSON.stringify({ t: 'error', msg: r.error, fatal: true })); server.close(4000, 'rejected'); } catch { /* closed */ } return; }
        if (r.as) { // back after a dropped connection: this socket is that player now
          id = r.as;
          const old = this.socks.get(id);
          if (old && old !== server) { this.socks.delete(id); try { old.close(4003, 'replaced'); } catch { /* closed */ } }
        }
        joined = true; this.socks.set(id, server); this.seen.set(id, Date.now());
        this.kick.set(id, gone);
        if (!this.sweep) this.sweep = setInterval(() => this.dropSilent(), 5000);
        this.dispatch(r.out);
        this.schedule();
        return;
      }
      this.seen.set(id, Date.now());
      this.dispatch(this.logic.message(id, msg));
      this.schedule();
    };
    // someone spectating a Ranked Play player: the match as that player sees it — what they're sent, their own cards
    // face up — read-only, and not one of the room's players (see dispatch)
    const watch = msg => {
      const pov = this.logic.rp && this.logic.players.find(p => p.pid && p.pid === String(msg.watch));
      const no = !pov ? 'They\'re not in this match any more.' : this.watchers.size >= MatchRoom.MAX_WATCHERS ? 'Too many people are watching this match.' : '';
      if (no) { try { server.send(JSON.stringify({ t: 'error', msg: no, fatal: true })); server.close(4000, 'rejected'); } catch { /* closed */ } return; }
      watcher = { pov: pov.id, seen: Date.now() };
      joined = true; this.watchers.set(server, watcher);
      if (!this.sweep) this.sweep = setInterval(() => this.dropSilent(), 5000);
      try { server.send(JSON.stringify({ t: 'welcome', you: pov.id, watch: true, room: this.logic.snapshot(pov.id), chat: (this.logic.chatLog || []).slice() })); } catch { /* closed */ }
    };
    const gone = () => {
      if (!joined) return;
      joined = false;
      if (watcher) { this.watchers.delete(server); return; }
      if (this.socks.get(id) !== server) return; // (an old socket of a player who has reconnected)
      this.socks.delete(id); this.seen.delete(id); this.kick.delete(id);
      this.dispatch(this.logic.disconnect(id));
      this.announce(); // (the last one out leaves nothing to dispatch, but the room must leave the list)
      this.schedule();
    };
    if (server instanceof HttpSock) server.onclose = gone;
    return { message: data => { try { onMessage(data); } catch (e) { console.error('room message', e); } }, gone, touch: () => { if (watcher) watcher.seen = Date.now(); else if (joined) this.seen.set(id, Date.now()); } };
  }
  saveSoon() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      const d = this.logic && this.logic.saveable(), body = JSON.stringify(d);
      if (body === this._saved) return;
      this._saved = body;
      (d ? this.state.storage.put('room', d) : this.state.storage.delete('room')).catch(() => {});
    }, 1000);
  }
  schedule() {
    if (this.timer || !this.logic.wantsTick()) return;
    this.timer = setInterval(() => {
      let out = [];
      try { out = this.logic.tick(); } catch (e) { console.error('room tick', e); }
      this.dispatch(out);
      if (!this.logic.wantsTick()) { clearInterval(this.timer); this.timer = null; }
    }, 1000);
  }
  dispatch(out) {
    if (out && out.length) { this.announce(); this.saveSoon(); }
    for (const { to, msg, each } of out || []) {
      // the room's recent chat, for whoever joins (or comes back after a reload) — as lazer shows a channel's history
      if (this.logic && msg) {
        const log = this.logic.chatLog || (this.logic.chatLog = []);
        if (to === 'all' && msg.t === 'chat') { log.push(msg); if (log.length > 40) log.shift(); }
        else if (msg.t === 'welcome') msg.chat = log.slice();
      }
      const data = each ? null : JSON.stringify(msg);
      for (const [id, ws] of this.socks) {
        const hit = to === 'all' || to === id || (to && typeof to === 'object' && to.except !== id);
        if (hit) { try { ws.send(data || JSON.stringify(each(id))); } catch { /* socket closing */ } }
      }
      // whoever is watching a player gets what that player gets (and their hand as they handle it)
      if (msg && MatchRoom.WATCH_MSGS.has(msg.t)) for (const [ws, w] of this.watchers) {
        const id = w.pov, hit = to === 'all' || to === id || (to && typeof to === 'object' && to.except !== id) || (msg.t === 'hand' && msg.id === id);
        if (hit) { try { ws.send(data || JSON.stringify(each(id))); } catch { /* socket closing */ } }
      }
    }
    // (the player watched has left the room: their match is over for whoever watched it)
    if (this.watchers.size && this.logic) for (const [ws, w] of this.watchers) if (!this.logic.players.some(p => p.id === w.pov)) { this.watchers.delete(ws); try { ws.close(4006, 'over'); } catch { /* closed */ } }
    // Ranked Play: a player who left a rated match sits out of the queue for a while
    const rp = this.logic && this.logic.rp;
    if (rp && rp.bans.length && this.env.MATCHMAKER) {
      const stub = this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName('global'));
      for (const b of rp.bans.splice(0)) stub.fetch('https://mm/internal/rq/ban', { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } }).catch(() => {});
    }
  }
}

/** Who's online, invites, and spectating. Presence protocol (client → server): hello {name, status, avatar, cid, pid},
 *  status {status, name?, avatar?, song?, rp?}, invite {to, code}, list, ping; spectating: play {head} (a play started:
 *  the replay header), frames {ev, at, reset?, last?, act?} (its inputs, streamed only while someone watches; act: a skip, pause, fail…), playEnd {quit?},
 *  watch {to}, unwatch {to}. Server → client: welcome {you}, online {players}, invite {from, code}, invited {to},
 *  error {msg}; to a player: spectators {n, full?} (full: send everything so far); to a watcher: specStart {id, name,
 *  head, ev, at, hist, pid, room}, specFrames {id, ev, at, reset?, last?, act? {k, t, sel?}}, specEnd {id, quit?, gone?},
 *  specWait {id, name, pid, room}, specRoom {id, pid, room} (room: the Ranked Play match they're in — see MatchRoom's watchers).
 *  Plain JS so it can be unit-tested. */
export class PresenceLogic {
  constructor(now = () => Date.now()) {
    this.now = now; this.users = new Map(); this.lastInvite = new Map();
    // friends, by public id: pid → Map(pid → name), and friend requests waiting for an answer: pid → Map(from pid → name).
    // `persist(key, value)` keeps them (the Durable Object's storage); `load` fills them back in on start.
    this.friends = new Map(); this.requests = new Map(); this.persist = null;
    // lazer's chat: #lobby for everyone online (the last CHAT_KEEP lines kept for whoever comes online), and private
    // messages between friends; `said` rate-limits each connection
    this.chat = []; this.said = new Map();
    // lazer's rankings (performance): each player's own totals by public id, kept in storage (rk:<pid>)
    this.ranks = new Map(); this.persistRank = null;
    // lazer's daily challenge: one beatmap a day (US Central time), picked by the server itself (Matchmaker.pickDaily —
    // never by a player's game), and each player's best score on it; `persistDaily` keeps it. `hist`: the last weeks'
    // beatmaps, not picked again soon. `dailyError`: why today's couldn't be picked yet (shown on the screen)
    this.daily = { day: '', map: null, scores: [], hist: [] }; this.persistDaily = null; this.dailyError = null;
    // each player's daily challenge record (lazer's profile box): days played, the current and best daily streak
    this.dailyStats = new Map(); this.persistDailyStats = null;
    // lazer's global beatmap leaderboards: each beatmap's (by its .osu file's hash) best score per player, top 100
    this.boards = new Map(); this.persistBoard = null;
    // each board's osu! beatmap id (read from the judged file), so a beatmap's board can be found by its id alone —
    // lazer's beatmap overlay, before it's downloaded (lbid:<id> in storage)
    this.boardIds = new Map(); this.persistBoardId = null;
    // lazer's "First place ranks": the beatmaps each player is #1 on (f1:<pid>), kept as the boards change
    this.firsts = new Map(); this.persistFirsts = null;
    // scores an admin took off — pid → { all: when every score of theirs went, keys: { beatmap: when that one went } }:
    // a play from before then isn't taken again when the player's own game catches up on its best plays (each
    // device still has them) — only a play made since. `persistTomb` keeps them
    this.tombs = new Map(); this.persistTomb = null;
    // when each player was last online (for friends' "Last seen …"): set as they go offline; `persistSeen` keeps it
    this.seen = new Map(); this.persistSeen = null;
    // whose a play on a profile is (its beatmap, score and the moment it was set — only a copied backup repeats all three):
    // the first player to report it; a copy on someone else's profile counts for nobody else (po:<fingerprint>)
    this.playOwner = new Map(); this.persistPlayOwner = null;
    // players' keys, by public id (only each key's SHA-256 is kept): pid → hash, or a list of them for an account (a key
    // for each device signed in to it)
    this.auth = new Map(); this.persistAuth = null;
    // players merged into another (a device's own id, when its code was typed there): old id → the player it is now. Never
    // claimed again — a second tab or the installed app still on the old id would otherwise bring the guest back to life,
    // the device that player and a guest at once (mg:<pid>)
    this.merged = new Map(); this.persistMerged = null;
    // player codes (one per player, for playing as them on another device): code fingerprint → pid, and pid → fingerprint
    this.codes = new Map(); this.codeOf = new Map(); this.persistCode = null;
    // each player's profile as their game last shared it (lazer's user profile, opened by other players): pid → data
    this.profiles = new Map(); this.profileJson = new Map(); this.persistProfile = null;
    // lazer's playlists: lists of beatmaps a player puts up for a while, each with everyone's best score on each
    // beatmap and an overall board of their totals (kept in storage, pl:<id>)
    this.playlists = new Map(); this.persistPlaylist = null;
    // lazer's user tags: each beatmap's (by its file's id) tags, with who voted for them — `persistTags` keeps them
    this.tags = new Map(); this.persistTags = null;
    // the server owner's moderation (the admin panel, admin.js): banned players (pid → { until, reason, at, name }; until
    // 0: for good), muted ones (no chat), and names given to players (pid → { name, was }: their game's own name doesn't
    // count while there's one; `name` '' with `was`: given back, their own name to be handed back when they're next on)
    // — `persistMod(kind, pid, value or null)` keeps them (bn:, mu:, nm:)
    this.bans = new Map(); this.mutes = new Map(); this.names = new Map(); this.persistMod = null;
    // which player is the server's owner: the one whose code is the ADMIN_CODE secret (its hash, set by Matchmaker)
    this.adminHash = '';
    // the admins the owner has made, each with a role of the owner's naming and colour (pid → { name, colour, at }; rl:)
    this.roles = new Map();
    // players the owner deleted (dl:): their id is never used again — a device still on it is told, and starts over as
    // a new player; and players whose picture an admin took down (na:): none of theirs is shown until it's allowed again
    this.deleted = new Set(); this.noAvatar = new Set();
  }
  isAdmin(pid) { return !!pid && !!this.adminHash && this.codes.get(this.adminHash) === pid; }
  /** Owner, or an admin the owner made: the admin panel opens for them. */
  isStaff(pid) { return this.isAdmin(pid) || (!!pid && this.roles.has(pid)); }
  /** The role shown beside a player's name (the rankings, their profile): the owner's, or the one they were given. */
  roleOf(pid) {
    if (this.isAdmin(pid)) return { name: 'Owner', colour: '#ffcc22', owner: true };
    const r = pid && this.roles.get(pid);
    return r ? { name: r.name, colour: r.colour } : null;
  }
  /** Make a player an admin with a role (a name up to 24 characters and a colour, #rrggbb), or change theirs. Their
   *  game's admin menu opens straight away. */
  adminRole(pid, { name = '', colour = '' } = {}) {
    const n = str(name, 24).trim(), c = /^#[0-9a-f]{6}$/i.test(String(colour)) ? String(colour).toLowerCase() : '#66ccff';
    if (!n || this.isAdmin(pid)) return null;
    const v = { name: n, colour: c, at: (this.roles.get(pid) || {}).at || this.now() };
    this.roles.set(pid, v); if (this.persistMod) this.persistMod('rl', pid, v);
    return [...this.users.entries()].filter(([, u]) => u.pid === pid).map(([id]) => ({ to: id, msg: { t: 'admin', role: { name: v.name, colour: v.colour } } }));
  }
  adminUnrole(pid) {
    if (!this.roles.delete(pid)) return [];
    if (this.persistMod) this.persistMod('rl', pid, null);
    return [...this.users.entries()].filter(([, u]) => u.pid === pid).map(([id]) => ({ to: id, msg: { t: 'admin', off: true } }));
  }
  loadMod({ bans = {}, mutes = {}, names = {}, roles = {}, deleted = [], noAvatar = [] } = {}) {
    for (const pid of deleted) this.deleted.add(pid);
    for (const pid of noAvatar) this.noAvatar.add(pid);
    for (const [pid, v] of Object.entries(roles)) if (v && typeof v === 'object' && v.name) this.roles.set(pid, { name: str(v.name, 24), colour: /^#[0-9a-f]{6}$/i.test(String(v.colour)) ? v.colour : '#66ccff', at: Number(v.at) || 0 });
    for (const [pid, v] of Object.entries(bans)) if (v && typeof v === 'object') this.bans.set(pid, v);
    for (const [pid, v] of Object.entries(mutes)) if (v && typeof v === 'object') this.mutes.set(pid, v);
    for (const [pid, v] of Object.entries(names)) if (v && typeof v === 'object' && (v.name || v.was)) this.names.set(pid, { name: str(v.name, 24), was: str(v.was, 24) });
  }
  /** A ban or mute still in force (one whose time is up goes). */
  modOf(kind, pid) {
    const map = kind === 'bn' ? this.bans : this.mutes, v = pid && map.get(pid);
    if (!v) return null;
    if (v.until && v.until <= this.now()) { map.delete(pid); if (this.persistMod) this.persistMod(kind, pid, null); return null; }
    return v;
  }
  isBanned(pid) { return !!this.modOf('bn', pid); }
  bannedMsg(pid) { const b = this.modOf('bn', pid); return { t: 'banned', reason: (b && b.reason) || '', until: (b && b.until) || 0 }; }
  // ── the server owner's tools (the admin panel, admin.js → Matchmaker.admin). They're all here, on the server: the game
  //    itself has none of them, nor anything that could reach them.
  /** Players by name (part of it, any case) or public id: those online, ranked, with a profile or a given name. */
  adminSearch(q) {
    const t = str(q, 40).trim().toLowerCase(), found = new Map();
    const add = (pid, name) => { if (pid && !found.has(pid)) found.set(pid, name || ''); };
    const has = n => !t || String(n || '').toLowerCase().includes(t);
    if (/^[a-z0-9]{6,24}$/.test(t)) for (const m of [this.ranks, this.profiles, this.auth, this.names]) if (m.has(t)) add(t, '');
    for (const u of this.users.values()) if (u.pid && has(u.name)) add(u.pid, u.name);
    for (const [pid, n] of this.names) if (n.name && has(n.name)) add(pid, n.name);
    for (const m of [this.bans, this.mutes]) for (const [pid, v] of m) if (v.name && has(v.name)) add(pid, v.name);
    for (const [pid, r] of this.ranks) if (has(r.name)) add(pid, r.name);
    if (t) for (const [pid, p] of this.profiles) if (has(p && p.name)) add(pid, p.name);
    return [...found].slice(0, 80).map(([pid, name]) => this.adminRow(pid, name));
  }
  adminRow(pid, name = '') {
    const r = this.ranks.get(pid), p = this.profiles.get(pid), u = [...this.users.values()].find(x => x.pid === pid), given = this.givenName(pid);
    const banned = this.modOf('bn', pid), muted = this.modOf('mu', pid);
    return { pid, name: given || (u && u.name) || name || (r && r.name) || (p && p.name) || (banned && banned.name) || (muted && muted.name) || '', pp: r ? Math.round(r.pp || 0) : 0, plays: r ? r.plays || 0 : 0,
      online: !!u, seen: this.seen.get(pid) || 0, code: this.codeOf.has(pid), banned, muted, named: given, owner: this.isAdmin(pid), role: this.roles.get(pid) || null,
      noAvatar: this.noAvatar.has(pid), deleted: this.deleted.has(pid), avatar: (u && u.avatar) || (r && r.avatar) || '' };
  }
  /** The name the server's owner gave this player ('' when there's none). */
  givenName(pid) { const g = pid && this.names.get(pid); return (g && g.name) || ''; }
  /** Their own name: as they were before a name was given them. */
  ownName(pid) {
    const g = this.names.get(pid), u = [...this.users.values()].find(x => x.pid === pid), r = this.ranks.get(pid), p = this.profiles.get(pid);
    return (g && g.was) || (u && u.name) || (r && r.name) || (p && p.name) || '';
  }
  /** One player as the admin panel shows them: standing, devices, friends, best plays, what's in force on them. */
  adminPlayer(pid) {
    const r = this.ranks.get(pid), mine = r && r.pp > 0 && !this.isBanned(pid);
    const bests = r && r.bests ? Object.entries(r.bests).filter(([, b]) => b).map(([key, b]) => ({ key, title: str(b.title, 120), artist: str(b.artist, 120), version: str(b.version, 120),
      pp: Math.round(b.pp || 0), score: b.score || 0, acc: b.acc || 0, grade: b.grade || '', mods: Array.isArray(b.mods) ? b.mods : [], date: b.date || 0 })).sort((a, b) => b.pp - a.pp || b.score - a.score).slice(0, 100) : [];
    const sessions = [...this.users.entries()].filter(([, u]) => u.pid === pid).map(([id, u]) => ({ id, name: u.name, status: u.status, vis: u.vis }));
    return { ...this.adminRow(pid), admin: this.isAdmin(pid), rank: mine ? [...this.ranks.values()].filter(x => x.pp > r.pp && !this.isBanned(x.pid)).length + 1 : 0, acc: r ? r.acc || 0 : 0,
      devices: this.keyHashes(pid).length, friends: (this.friends.get(pid) || new Map()).size, sessions, bests, daily: this.dailyStats.get(pid) || null,
      firsts: Object.keys(this.firsts.get(pid) || {}).length };
  }
  /** Banned (for `days`, or for good): they're taken offline now and can't come back online, and their scores stop
   *  showing on the boards, the rankings and the daily challenge (kept, in case of an unban). Returns { out, gone }. */
  adminBan(pid, { days = 0, reason = '' } = {}) {
    const v = { until: days > 0 ? this.now() + Math.min(3650, days) * 86400000 : 0, reason: str(reason, 200), at: this.now(), name: this.adminRow(pid).name };
    this.bans.set(pid, v); if (this.persistMod) this.persistMod('bn', pid, v);
    const ids = this.byPid(pid), out = [];
    for (const id of ids) { out.push({ to: id, msg: this.bannedMsg(pid) }); out.push(...this.forget(id)); }
    return { out: ids.length ? [...out, this.broadcast()] : out, gone: ids };
  }
  adminUnban(pid) { this.bans.delete(pid); if (this.persistMod) this.persistMod('bn', pid, null); }
  /** No chat (#lobby or private messages) for `minutes`, or for good. */
  adminMute(pid, { minutes = 0, reason = '' } = {}) {
    const v = { until: minutes > 0 ? this.now() + Math.min(525600, minutes) * 60000 : 0, reason: str(reason, 200), at: this.now(), name: this.adminRow(pid).name };
    this.mutes.set(pid, v); if (this.persistMod) this.persistMod('mu', pid, v);
    return this.byPid(pid).map(id => ({ to: id, msg: { t: 'error', msg: `You've been muted${v.reason ? `: ${v.reason}` : ''}.` } }));
  }
  adminUnmute(pid) { this.mutes.delete(pid); if (this.persistMod) this.persistMod('mu', pid, null); }
  /** A name for this player that their game can't change (an offensive one replaced); '' gives them their own back
   *  (now if they're online, else when they're next on). */
  adminRename(pid, name) {
    const n = str(name, 24).replace(/[\u0000-\u001f\u007f]/g, '').trim(), was = this.ownName(pid);
    const to = n || was;
    const rec = n ? { name: n, was } : was ? { name: '', was } : null;
    if (rec) this.names.set(pid, rec); else this.names.delete(pid);
    const out = [];
    const ids = this.byPid(pid);
    if (to) {
      for (const id of ids) { this.users.get(id).name = to; out.push({ to: id, msg: { t: 'renamed', name: to } }); }
      const r = this.ranks.get(pid);
      if (r && r.name !== to) { r.name = to; if (this.persistRank) this.persistRank(pid, r); }
    }
    // (given back while they're online: done — nothing left to hand back later)
    if (!n && ids.length) this.names.delete(pid);
    if (this.persistMod) this.persistMod('nm', pid, this.names.get(pid) || null);
    return out.length ? [...out, this.broadcast()] : out;
  }
  /** A line taken out of #lobby (for everyone, and for whoever comes online later). */
  adminChatDelete(at, pid) {
    const n = this.chat.length;
    this.chat = this.chat.filter(l => !(l.at === at && ((l.from && l.from.pid) || '') === (pid || '')));
    if (this.chat.length === n) return [];
    if (this.persistChat) this.persistChat(this.chat);
    return [{ to: 'all', msg: { t: 'sayDel', at, pid: pid || '' } }];
  }
  adminChatClear() { this.chat = []; if (this.persistChat) this.persistChat(this.chat); return [{ to: 'all', msg: { t: 'chatClear' } }]; }
  /** A message from the server's owner: a notification for everyone online, and a line in #lobby. */
  adminAnnounce(text) {
    const tx = str(text, 300).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!tx) return [];
    const line = { ch: '#lobby', from: { pid: '', name: 'Ashtonk!mania', avatar: '', system: true }, text: tx, at: this.now() };
    this.chat.push(line); if (this.chat.length > PresenceLogic.CHAT_KEEP) this.chat.shift();
    if (this.persistChat) this.persistChat(this.chat);
    return [{ to: 'all', msg: { t: 'say', ...line } }, { to: 'all', msg: { t: 'announce', text: tx } }];
  }
  /** One score off a beatmap's board, and out of the player's best plays (their total worked out again). */
  adminRemoveScore(pid, key) {
    this.tomb(pid, key);
    const list = this.boards.get(key);
    if (list && list.some(x => x.pid === pid)) {
      const next = list.filter(x => x.pid !== pid); this.boards.set(key, next); if (this.persistBoard) this.persistBoard(key, next);
      if (list[0] && list[0].pid === pid) this.setFirst(pid, key, null);
    }
    const r = this.ranks.get(pid);
    if (r && r.bests && r.bests[key]) {
      delete r.bests[key];
      if (Array.isArray(r.rk)) r.rk = r.rk.filter(k => k !== key.slice(0, 10));
      PresenceLogic.revalue(r); if (this.persistRank) this.persistRank(pid, r);
    }
  }
  /** Remember that an admin took a player's score on `key` off (null: all of them), as of now. */
  tomb(pid, key) {
    const t = this.tombs.get(pid) || { all: 0, keys: {} }, now = this.now();
    if (key) t.keys[key] = now; else { t.all = now; t.keys = {}; }
    this.tombs.set(pid, t); if (this.persistTomb) this.persistTomb(pid, t);
  }
  /** When an admin last took this player's score on `key` off (0: never) — a play from before then stays off. */
  removedAt(pid, key) { const t = this.tombs.get(pid); return t ? Math.max(t.all || 0, (t.keys && t.keys[key]) || 0) : 0; }
  /** Every score of theirs gone: off every board (the ones read in — Matchmaker reads in all of theirs first), their
   *  ranking, their daily challenge scores and record, and their first places. */
  adminWipe(pid) {
    this.tomb(pid, null);
    for (const [key, list] of this.boards) if (list.some(x => x.pid === pid)) {
      const next = list.filter(x => x.pid !== pid); this.boards.set(key, next); if (this.persistBoard) this.persistBoard(key, next);
    }
    if (this.ranks.delete(pid) && this.dropPlayer) this.dropPlayer(pid, 'rank');
    const d = this.dailyNow(); if (d.scores.some(x => x.pid === pid)) { d.scores = d.scores.filter(x => x.pid !== pid); this.saveDaily(); }
    if (this.dailyStats.delete(pid) && this.dropPlayer) this.dropPlayer(pid, 'daily');
    if (this.firsts.has(pid)) { this.firsts.delete(pid); if (this.persistFirsts) this.persistFirsts(pid, {}); }
  }
  /** A player deleted (the owner's, in the admin panel): everything the server keeps of theirs goes — their scores
   *  (adminWipe), profile, friends and friend requests (theirs, and them in other players' lists), code and devices,
   *  last-seen, tag votes, playlist scores, lines in #lobby and any ban, mute, name or picture rule — and their id is
   *  never used again: a device still on it is told (repid, deleted) and starts over as a new player. Whose a play was
   *  (playOwner) is kept, so the same plays sent again from a new id count for nobody. The boards and tags they're on
   *  must be read in first (Matchmaker.preloadPlayer). Returns { out, gone }. */
  adminDelete(pid) {
    this.adminWipe(pid);
    const touched = new Set();
    if (this.friends.has(pid)) { this.friends.delete(pid); this.save('fr', pid); }
    for (const [p, m] of this.friends) if (m.delete(pid)) { this.save('fr', p); touched.add(p); }
    if (this.requests.has(pid)) { this.requests.delete(pid); this.save('fq', pid); }
    for (const [p, m] of this.requests) if (m.delete(pid)) { this.save('fq', p); touched.add(p); }
    const fc = this.codeOf.get(pid);
    if (fc) { this.codes.delete(fc); this.codeOf.delete(pid); if (this.persistCode) this.persistCode(null, pid, fc); }
    this.auth.delete(pid); this.seen.delete(pid); this.profiles.delete(pid); this.profileJson.delete(pid);
    if (this.dropPlayer) for (const w of ['auth', 'seen', 'profile', 'rank', 'daily']) this.dropPlayer(pid, w);
    for (const [key, votes] of this.tags) {
      let changed = false;
      for (const t of Object.keys(votes)) if (votes[t].includes(pid)) { votes[t] = votes[t].filter(x => x !== pid); if (!votes[t].length) delete votes[t]; changed = true; }
      if (changed && this.persistTags) this.persistTags(key, votes);
    }
    for (const pl of this.playlists.values()) if (pl.scores && pl.scores[pid]) { delete pl.scores[pid]; this.savePlaylist(pl); }
    const before = this.chat.length;
    this.chat = this.chat.filter(l => !(l.from && l.from.pid === pid));
    if (this.chat.length !== before && this.persistChat) this.persistChat(this.chat);
    for (const [kind, map] of [['bn', this.bans], ['mu', this.mutes], ['nm', this.names]]) if (map.delete(pid) && this.persistMod) this.persistMod(kind, pid, null);
    if (this.noAvatar.delete(pid) && this.persistMod) this.persistMod('na', pid, null);
    if (this.tombs.delete(pid) && this.dropPlayer) this.dropPlayer(pid, 'tomb');
    this.deleted.add(pid); if (this.persistMod) this.persistMod('dl', pid, { at: this.now() });
    // (online now: told, and taken off — their game starts over as a new player)
    const ids = this.byPid(pid), out = [];
    for (const id of ids) { out.push({ to: id, msg: { t: 'repid', deleted: true } }); out.push(...this.forget(id)); }
    return { out: [...out, ...this.friendsOut(...touched), ...(ids.length ? [this.broadcast()] : [])], gone: ids };
  }
  /** A message from an admin to one player (every tab of theirs): shown to them as a notice they have to close. */
  adminWarn(pid, text) {
    const tx = str(text, 300).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return tx ? this.byPid(pid).map(id => ({ to: id, msg: { t: 'warned', text: tx } })) : [];
  }
  /** Their picture taken down (one that isn't OK): it's gone from wherever it was kept, and none of theirs is shown again
   *  until it's allowed (`on` false). Their game is told, and goes back to the default picture. */
  adminNoAvatar(pid, on = true) {
    if (!on) { if (this.noAvatar.delete(pid) && this.persistMod) this.persistMod('na', pid, null); return []; }
    this.noAvatar.add(pid); if (this.persistMod) this.persistMod('na', pid, { at: this.now() });
    const ids = this.byPid(pid);
    for (const id of ids) this.users.get(id).avatar = '';
    const r = this.ranks.get(pid);
    if (r && r.avatar) { r.avatar = ''; if (this.persistRank) this.persistRank(pid, r); }
    for (const [key, list] of this.boards) if (list.some(x => x && x.pid === pid && x.avatar)) { for (const x of list) if (x && x.pid === pid) x.avatar = ''; if (this.persistBoard) this.persistBoard(key, list); }
    const d = this.daily; if (d.scores.some(x => x.pid === pid && x.avatar)) { for (const x of d.scores) if (x.pid === pid) x.avatar = ''; if (this.persistDaily) this.persistDaily(d); }
    for (const pl of this.playlists.values()) {
      let changed = false;
      if (pl.host && pl.host.pid === pid && pl.host.avatar) { pl.host.avatar = ''; changed = true; }
      if (pl.scores && pl.scores[pid] && pl.scores[pid].avatar) { pl.scores[pid].avatar = ''; changed = true; }
      if (changed) this.savePlaylist(pl);
    }
    const pf = this.profiles.get(pid);
    if (pf && pf.avatar) { pf.avatar = ''; this.profileJson.delete(pid); if (this.persistProfile) this.persistProfile(pid, pf); }
    let chatChanged = false;
    for (const l of this.chat) if (l.from && l.from.pid === pid && l.from.avatar) { l.from.avatar = ''; chatChanged = true; }
    if (chatChanged && this.persistChat) this.persistChat(this.chat);
    return [...ids.map(id => ({ to: id, msg: { t: 'avatarRemoved' } })), ...(ids.length ? [this.broadcast()] : [])];
  }
  /** Their code stops working (one that got out): their devices stay signed in, and they can make a new one. */
  adminRevokeCode(pid) {
    const fc = this.codeOf.get(pid);
    if (!fc) return null;
    this.codes.delete(fc); this.codeOf.delete(pid); if (this.persistCode) this.persistCode(null, pid, fc);
    return this.byPid(pid).map(id => ({ to: id, msg: { t: 'codeRevoked' } }));
  }
  /** The players seen most recently, and the best by pp (the Players tab before anything's searched for). */
  adminLists() {
    const recent = [...this.seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([pid]) => pid);
    const online = [...new Set([...this.users.values()].map(u => u.pid).filter(Boolean))];
    const top = [...this.ranks.values()].filter(r => r.pp > 0).sort((a, b) => b.pp - a.pp).slice(0, 25).map(r => r.pid);
    return { recent: [...new Set([...online, ...recent])].slice(0, 30).map(p => this.adminRow(p)), top: top.map(p => this.adminRow(p)) };
  }
  static PL_ITEMS = 20;
  static PL_OPEN = 3; // playlists one player can have open at once
  /** lazer's user tags, for mania: the ones players can put on a beatmap after playing it. */
  static USER_TAGS = ['stream', 'jumpstream', 'handstream', 'chordstream', 'chordjack', 'jack', 'minijack', 'speed', 'stamina', 'technical', 'long notes', 'inverse',
    'hybrid', 'trill', 'roll', 'bracket', 'anchor', 'burst', 'dump', 'delay', 'polyrhythm', 'scroll speed changes', 'gimmick', 'vibro', 'beginner friendly', 'sight-read friendly'];
  static TAG_VOTES = 10; // tags one player can vote for on one beatmap
  static PL_KEEP = 14 * 86400000; // an ended playlist is kept (and listed) this long
  loadPlaylists(all) {
    const now = this.now();
    for (const p of Object.values(all || {})) if (p && p.id && Array.isArray(p.items) && now - p.ends < PresenceLogic.PL_KEEP) this.playlists.set(p.id, p);
  }
  /** What the playlists list shows of one. */
  plCard(p) {
    const players = Object.keys(p.scores || {}).length, first = p.items[0] || {};
    const stars = p.items.map(x => x.stars || 0);
    return { id: p.id, name: p.name, host: { pid: p.host.pid, ...this.nameOf(p.host) }, created: p.created, ends: p.ends, items: p.items.length, players,
      cover: first.onlineSetId || 0, keys: [...new Set(p.items.map(x => x.keys))].sort((a, b) => a - b), minStars: Math.min(...stars), maxStars: Math.max(...stars) };
  }
  /** A player's name and picture as they are now. */
  nameOf(x) { const c = this.current({ pid: x.pid, name: x.name, avatar: x.avatar }); return { name: c.name, avatar: c.avatar }; }
  plList(pid) {
    const now = this.now(), all = [...this.playlists.values()].filter(p => now - p.ends < PresenceLogic.PL_KEEP).sort((a, b) => b.created - a.created).slice(0, 100);
    return { t: 'plList', now, list: all.map(p => this.plCard(p)) };
  }
  /** One playlist in full: its beatmaps (each with its top 10 and your best), and everyone's totals. */
  plMsg(p, pid) {
    const sc = p.scores || {};
    const totals = Object.entries(sc).map(([who, v]) => {
      const best = Object.values(v.best || {});
      return { pid: who, ...this.nameOf({ pid: who, name: v.name, avatar: v.avatar }), score: best.reduce((a, b) => a + b.score, 0), done: best.length,
        acc: best.length ? best.reduce((a, b) => a + b.acc, 0) / best.length : 0 };
    }).sort((a, b) => b.score - a.score || b.done - a.done || b.acc - a.acc).map((x, i) => ({ ...x, rank: i + 1 }));
    const items = p.items.map(it => {
      const rows = Object.entries(sc).filter(([, v]) => v.best && v.best[it.hash]).map(([who, v]) => ({ pid: who, ...this.nameOf({ pid: who, name: v.name, avatar: v.avatar }), ...v.best[it.hash] }))
        .sort((a, b) => b.score - a.score || a.at - b.at).map((x, i) => ({ ...x, rank: i + 1 }));
      return { ...it, plays: rows.length, top: rows.slice(0, 10), you: rows.find(x => x.pid === pid) || null };
    });
    return { t: 'pl', now: this.now(), ...this.plCard(p), items, board: totals.slice(0, 50), you: totals.find(x => x.pid === pid) || null };
  }
  /** Has this player a play on this beatmap the server knows of (on its board, or among their best plays)? */
  played(pid, key) {
    const r = this.ranks.get(pid);
    return !!((r && r.bests && r.bests[key]) || (this.boards.get(key) || []).some(x => x.pid === pid));
  }
  /** A beatmap's tags, most votes first (lazer shows a tag once enough players agree: here, any vote). */
  tagsMsg(key, pid) {
    const votes = this.tags.get(key) || {};
    const list = Object.entries(votes).map(([tag, who]) => ({ tag, n: who.length, mine: who.includes(pid) })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
    return { t: 'tags', key, tags: list, all: PresenceLogic.USER_TAGS, can: !!pid && this.played(pid, key) };
  }
  savePlaylist(p) { if (this.persistPlaylist) this.persistPlaylist(p); }
  static PROFILE_MAX = 90000; // characters of JSON (50 best plays with their osu! ids, for checking)
  /** Does this key own this public id? The first key used with an id claims it. */
  claim(pid, key) {
    const k = String(key || '');
    if (k.length < 16 || k.length > 100 || this.merged.has(pid) || this.deleted.has(pid)) return false;
    const hash = sha256hex(k), have = this.keyHashes(pid);
    if (have.length) return have.includes(hash);
    if (this.codeOf.has(pid)) return false; // (a player with a code whose every device signed out isn't up for grabs)
    this.auth.set(pid, hash);
    if (this.persistAuth) this.persistAuth(pid, hash);
    return true;
  }
  loadMerged(all) { for (const [pid, to] of Object.entries(all || {})) if (/^[a-z0-9]{6,24}$/.test(String(to || ''))) this.merged.set(pid, String(to)); }
  loadAuth(all) { for (const [pid, h] of Object.entries(all || {})) if (typeof h === 'string' || (Array.isArray(h) && h.length)) this.auth.set(pid, h); }
  keyHashes(pid) { const h = this.auth.get(pid); return Array.isArray(h) ? h : h ? [h] : []; }
  /** Is this one of the keys for this public id? */
  keyOk(pid, key) { const k = String(key || ''); return k.length >= 16 && k.length <= 100 && this.keyHashes(pid).includes(sha256hex(k)); }

  // ── player codes: a secret code belongs to a player, and typing it on another device makes that device the same
  //    player — one entry on the rankings and the beatmap boards, one profile and friends list. Each device gets a key
  //    of its own for the player's id, so one can be signed out without the others.
  static DEVICE_KEYS = 20; // devices playing as one player at once (past that, the one that joined longest ago is signed out)
  loadCodes(all) {
    for (const [h, v] of Object.entries(all || {})) if (v && typeof v === 'object' && /^[a-z0-9]{6,24}$/.test(String(v.pid || ''))) { this.codes.set(h, v.pid); this.codeOf.set(v.pid, h); }
  }
  /** Another device joined: a key of its own for the id. */
  addKey(pid, key) {
    const h = sha256hex(String(key)), list = [...this.keyHashes(pid).filter(x => x !== h), h].slice(-PresenceLogic.DEVICE_KEYS);
    this.auth.set(pid, list);
    if (this.persistAuth) this.persistAuth(pid, list);
  }
  /** A device signed out: its key stops working (the player's other devices stay). */
  dropKey(pid, key) {
    const h = sha256hex(String(key || '')), list = this.keyHashes(pid).filter(x => x !== h);
    if (list.length) this.auth.set(pid, list); else this.auth.delete(pid);
    if (this.persistAuth) this.persistAuth(pid, list);
  }
  /** Every device but this one signed out (a code that got out): the others are told at once and dropped. */
  onlyKey(pid, key) {
    const h = sha256hex(String(key || '')), before = this.keyHashes(pid).length;
    this.auth.set(pid, [h]);
    if (this.persistAuth) this.persistAuth(pid, [h]);
    const out = [], gone = [];
    for (const [id, u] of this.users) if (u.pid === pid && u.kh !== h) { out.push({ to: id, msg: { t: 'repid', account: true } }); gone.push(id); }
    return { n: Math.max(0, before - 1), out, gone };
  }
  /** A new code for this player (the old one stops working): its fingerprint is all that's kept. */
  setCode(pid, hash) {
    const old = this.codeOf.get(pid);
    if (old) this.codes.delete(old);
    this.codes.set(hash, pid); this.codeOf.set(pid, hash);
    if (this.persistCode) this.persistCode(hash, pid, old || null);
  }
  /** A device typed the player's code: it gets a key for their id, and the player it was until now (`from`, proved by
   *  its key) goes into them — so they aren't on the rankings twice. Their other devices are told. */
  linkDevice(pid, from, fromKey, newKey) {
    // (only a player of this device's own — no code — becomes part of the code's player: one with a code is an account
    // of its own, switched away from here, never merged into another one)
    const merge = /^[a-z0-9]{6,24}$/.test(String(from || '')) && from !== pid && this.keyOk(from, fromKey) && !this.codeOf.has(from);
    const out = merge ? this.mergePlayer(from, pid) : [];
    this.addKey(pid, newKey);
    // (the player's other devices — not the one that typed the code, whose tabs are still on their old key)
    const self = new Set([sha256hex(newKey), sha256hex(String(fromKey || ''))]);
    for (const [id, u] of this.users) if (u.pid === pid && !self.has(u.kh)) out.push({ to: id, msg: { t: 'codeUsed' } });
    const r = this.ranks.get(pid), pf = this.profiles.get(pid);
    return { ok: true, pid, merged: merge, name: (r && r.name) || (pf && pf.name) || '', out };
  }
  /** Everything the server keeps about one player (`from`) moved to another (`to`): their best plays, rank, places on the
   *  beatmap boards and first places, daily challenge record and today's score, playlist scores, friends and friend
   *  requests, tag votes and profile. `from` is gone afterwards. The boards and tags it's on, and both players' best
   *  plays, must be loaded first (Matchmaker.preloadPlayer). */
  mergePlayer(from, to) {
    const name = (this.ranks.get(to) || {}).name || (this.profiles.get(to) || {}).name || (this.ranks.get(from) || {}).name || 'Player';
    // (a code `from` had is no more: the one to play as them now is `to`'s)
    const fc = this.codeOf.get(from);
    if (fc) { this.codes.delete(fc); this.codeOf.delete(from); if (this.persistCode) this.persistCode(null, from, fc); }
    // rankings: the best play on each beatmap from either, and the totals worked out again from them
    const a = this.ranks.get(from);
    if (a) {
      const rec = this.ranks.get(to) || { pid: to, name, avatar: a.avatar, plays: 0, bests: {}, pol: PresenceLogic.RANK_POLICY };
      const bests = { ...(rec.bests || {}) };
      for (const [k, x] of Object.entries(a.bests || {})) if (x && (!bests[k] || (bests[k].pp || 0) < (x.pp || 0))) bests[k] = x;
      rec.bests = Object.fromEntries(Object.entries(bests).sort((p, q) => (q[1].pp || 0) - (p[1].pp || 0)).slice(0, PresenceLogic.KEEP_BESTS));
      delete rec._lazy;
      rec.rk = [...new Set([...(rec.rk || []), ...(a.rk || [])])].slice(0, 1000);
      rec.okh = [...new Set([...(rec.okh || []), ...(a.okh || [])])].slice(0, 50);
      rec.plays = (rec.plays || 0) + (a.plays || 0);
      if (a.rep && (!rec.rep || (a.rep.pp || 0) > (rec.rep.pp || 0))) rec.rep = a.rep;
      rec.pid = to; rec.name = name; rec.at = Math.max(rec.at || 0, a.at || 0);
      PresenceLogic.revalue(rec);
      rec.v.rscore = Object.values(rec.bests).reduce((t, x) => t + (x.pp > 0 ? x.score || 0 : 0), 0);
      PresenceLogic.settleRank(rec);
      this.ranks.set(to, rec); this.ranks.delete(from);
      if (this.persistRank) this.persistRank(to, rec);
      if (this.dropPlayer) this.dropPlayer(from, 'rank');
    }
    // beatmap boards: the better of the two scores stays, as `to`
    for (const [key, list] of this.boards) {
      const mine = list.find(x => x && x.pid === from);
      if (!mine) continue;
      const theirs = list.find(x => x && x.pid === to);
      const keep = !theirs || mine.score > theirs.score ? { ...mine, pid: to, name } : theirs;
      const next = [...list.filter(x => x && x.pid !== from && x.pid !== to), keep].sort((p, q) => q.score - p.score || p.date - q.date);
      this.boards.set(key, next);
      if (this.persistBoard) this.persistBoard(key, next);
    }
    // first places: the ones `to` now holds
    const fa = this.firsts.get(from);
    if (fa) {
      const fb = { ...(this.firsts.get(to) || {}) };
      for (const [k, v] of Object.entries(fa)) {
        const b = this.boards.get(k);
        if (v && (!b || (b[0] && b[0].pid === to)) && (!fb[k] || (fb[k].score || 0) < (v.score || 0))) fb[k] = v;
      }
      this.firsts.delete(from);
      if (this.persistFirsts) this.persistFirsts(from, {});
      if (Object.keys(fb).length) { this.firsts.set(to, fb); if (this.persistFirsts) this.persistFirsts(to, fb); }
    }
    // the daily challenge: days played added up, the best streak, and the streak of whichever played last
    const da = this.dailyStats.get(from);
    if (da) {
      const db = this.dailyStats.get(to), last = !db || String(da.last || '') > String(db.last || '') ? da : db;
      const m = db ? { plays: (db.plays || 0) + (da.plays || 0), best: Math.max(db.best || 0, da.best || 0), current: last.current || 0, last: last.last || '' } : da;
      this.dailyStats.set(to, m); this.dailyStats.delete(from);
      if (this.persistDailyStats) { this.persistDailyStats(to, m); }
      if (this.dropPlayer) this.dropPlayer(from, 'daily');
    }
    const d = this.daily, ds = d.scores.find(x => x.pid === from);
    if (ds) {
      const dt = d.scores.find(x => x.pid === to), keep = !dt || ds.score > dt.score ? { ...ds, pid: to, name } : dt;
      d.scores = [...d.scores.filter(x => x.pid !== from && x.pid !== to), keep];
      if (this.persistDaily) this.persistDaily(d);
    }
    // playlists: their best on each beatmap there
    for (const pl of this.playlists.values()) {
      let changed = false;
      if (pl.host && pl.host.pid === from) { pl.host.pid = to; pl.host.name = name; changed = true; }
      const sa = pl.scores && pl.scores[from];
      if (sa) {
        const sb = pl.scores[to] || { name, avatar: sa.avatar, best: {} };
        for (const [k, v] of Object.entries(sa.best || {})) if (v && (!sb.best[k] || sb.best[k].score < v.score)) sb.best[k] = v;
        sb.name = name; pl.scores[to] = sb; delete pl.scores[from]; changed = true;
      }
      if (changed) this.savePlaylist(pl);
    }
    // friends and friend requests (theirs, and theirs in other players' lists)
    const touched = new Set([to]);
    const ff = this.friends.get(from);
    if (ff) {
      if (!this.friends.has(to)) this.friends.set(to, new Map());
      for (const [p, n] of ff) if (p !== to) this.friends.get(to).set(p, n);
      this.friends.delete(from); this.save('fr', from);
    }
    for (const [p, m] of this.friends) if (m.has(from)) { m.delete(from); if (p !== to) m.set(to, name); this.save('fr', p); touched.add(p); }
    this.friends.get(to)?.delete(to); // (an old device of theirs they had befriended)
    const rq = this.requests.get(from);
    if (rq) {
      if (!this.requests.has(to)) this.requests.set(to, new Map());
      for (const [p, n] of rq) if (p !== to && !this.areFriends(p, to)) this.requests.get(to).set(p, n);
      this.requests.delete(from); this.save('fq', from);
    }
    for (const [p, m] of this.requests) if (m.has(from)) { m.delete(from); if (p !== to && !this.areFriends(p, to)) m.set(to, name); this.save('fq', p); touched.add(p); }
    this.save('fr', to); this.save('fq', to);
    // tag votes
    for (const [key, votes] of this.tags) {
      let changed = false;
      for (const t of Object.keys(votes)) if (votes[t].includes(from)) { votes[t] = [...new Set(votes[t].map(x => x === from ? to : x))]; changed = true; }
      if (changed && this.persistTags) this.persistTags(key, votes);
    }
    // the profile: the two put together
    const pa = this.profiles.get(from);
    if (pa) {
      const merged = PresenceLogic.mergeProfile(this.profiles.get(to), pa);
      this.profiles.set(to, { ...merged, name }); this.profileJson.delete(to);
      if (this.persistProfile) this.persistProfile(to, this.profiles.get(to));
    }
    this.profiles.delete(from); this.profileJson.delete(from);
    if (this.dropPlayer) this.dropPlayer(from, 'profile');
    this.seen.delete(from); this.auth.delete(from);
    if (this.dropPlayer) { this.dropPlayer(from, 'seen'); this.dropPlayer(from, 'auth'); }
    this.merged.set(from, to); if (this.persistMerged) this.persistMerged(from, to);
    // (any tab still online as the guest is the account now)
    for (const u of this.users.values()) if (u.pid === from) { u.pid = to; u.name = name; }
    return [...this.friendsOut(...touched)];
  }
  /** A profile from one of an account's devices, put together with what its other devices sent: the best plays of
   *  all of them (each beatmap once, at its best), the highest counts, the newest plays — so a device with fewer
   *  scores never brings the account's standing down. */
  static mergeProfile(prev, next) {
    if (!prev || typeof prev !== 'object') return next;
    if (!next || typeof next !== 'object') return prev;
    const out = { ...prev, ...next };
    for (const k of ['plays', 'playtime', 'passed', 'notes', 'highestCombo', 'rankedPlays', 'rankedScore', 'pp']) out[k] = Math.max(+prev[k] || 0, +next[k] || 0);
    if ((+prev.plays || 0) > (+next.plays || 0)) out.avgAcc = prev.avgAcc;
    const lv = x => (+x.level || 0) * 1e12 + (+x.xpInto || 0);
    if (lv(prev) > lv(next)) for (const k of ['level', 'xpInto', 'xpNeed', 'xpProgress']) out[k] = prev[k];
    out.grades = {};
    for (const g of ['XH', 'SS', 'SH', 'S', 'A']) out.grades[g] = Math.max(+((prev.grades || {})[g]) || 0, +((next.grades || {})[g]) || 0);
    const best = new Map();
    for (const x of [...(Array.isArray(prev.top) ? prev.top : []), ...(Array.isArray(next.top) ? next.top : [])]) {
      if (!x || typeof x !== 'object') continue;
      const id = PresenceLogic.playId(x), b = best.get(id);
      if (!b || (+x.pp || 0) > (+b.pp || 0)) best.set(id, x);
    }
    out.top = [...best.values()].sort((p, q) => (+q.pp || 0) - (+p.pp || 0)).slice(0, 50);
    const seen = new Set();
    out.recent = [...(Array.isArray(next.recent) ? next.recent : []), ...(Array.isArray(prev.recent) ? prev.recent : [])]
      .filter(x => { if (!x || typeof x !== 'object') return false; const id = PresenceLogic.playId(x) + '|' + x.date; if (seen.has(id)) return false; seen.add(id); return true; })
      .sort((p, q) => (+q.date || 0) - (+p.date || 0)).slice(0, 10);
    out.medals = { ...(prev.medals && typeof prev.medals === 'object' ? prev.medals : {}), ...(next.medals && typeof next.medals === 'object' ? next.medals : {}) };
    if (prev.created && (!next.created || prev.created < next.created)) out.created = prev.created;
    return out;
  }
  /** A profile play's fingerprint: its beatmap, score and the moment it was set ('' when it doesn't say). */
  static playPrint(x) {
    const hash = String((x && x.mapHash) || ''), date = Math.round(+(x && x.date) || 0);
    return hash && date > 0 ? `${hash.slice(0, 40)}|${Math.round(+x.score || 0)}|${date}` : '';
  }
  loadPlayOwners(all) { for (const [k, v] of Object.entries(all || {})) if (typeof v === 'string') this.playOwner.set(k, v); }
  /** The plays on a player's profile that are theirs: an exact copy of a play someone else reported first (an imported
   *  backup) is left out. A play whose first reporter is gone (merged into another player through their code) is
   *  theirs to take. */
  ownPlays(pid, top) {
    return (Array.isArray(top) ? top : []).filter(x => {
      const fp = PresenceLogic.playPrint(x);
      if (!fp) return true;
      const owner = this.playOwner.get(fp);
      if (owner === pid) return true;
      if (owner && (this.ranks.has(owner) || this.keyHashes(owner).length)) return false; // (someone else's: a copy)
      this.playOwner.set(fp, pid);
      if (this.persistPlayOwner) this.persistPlayOwner(fp, pid);
      return true;
    });
  }
  static KEEP_BESTS = 200; // each player's best plays kept for their total (lazer's total uses the top 100)
  /** A play the server judged itself (verifyPlay): onto the beatmap's leaderboard, into the player's best plays —
   *  their total pp, accuracy and grades for the rankings are worked out from those — and, when it's the daily
   *  challenge's beatmap today, onto its board. Nothing a player says about their score counts anywhere else. */
  recordVerified(pid, key, r, { daily = null, playlist = null } = {}) {
    const t = this.now(), online = [...this.users.values()].find(x => x.pid === pid), old = this.ranks.get(pid);
    const name = online ? online.name : old ? old.name : 'Player', avatar = online ? online.avatar : old ? old.avatar : '';
    const entry = { pid, name, avatar, score: r.score, acc: r.accuracy, combo: r.maxCombo, grade: r.grade, mods: r.mods, counts: r.counts, pp: Math.round(r.pp * 100) / 100, stars: r.stars, date: t };
    // the beatmap's board: each player's best score
    const board = this.boards.get(key) || [];
    const prev = board.find(x => x.pid === pid);
    if (!prev || prev.score < entry.score) {
      const before = board[0] ? board[0].pid : null;
      const next = [...board.filter(x => x.pid !== pid), entry].sort((a, b) => b.score - a.score || a.date - b.date).slice(0, PresenceLogic.LB_KEEP);
      this.boards.set(key, next);
      if (this.persistBoard) this.persistBoard(key, next);
      // a new #1 (or the #1 beating their own score): their first place, taken from whoever had it
      if (next[0].pid === pid) {
        if (before && before !== pid) this.setFirst(before, key, null);
        this.setFirst(pid, key, { score: entry.score, acc: entry.acc, grade: entry.grade, mods: entry.mods, combo: entry.combo, pp: entry.pp, date: t, counts: entry.counts,
          title: String(r.title || '').slice(0, 120), artist: String(r.artist || '').slice(0, 120), version: String(r.version || '').slice(0, 120), stars: entry.stars });
      }
    }
    if (r.beatmapId > 0 && this.boardIds.get(r.beatmapId) !== key) { this.boardIds.set(r.beatmapId, key); if (this.persistBoardId) this.persistBoardId(r.beatmapId, key); }
    // the player's record: best pp per beatmap → total pp (each next one 95% as much), accuracy weighted the same way
    const rec = old || { pid, name, avatar, plays: 0, bests: {}, pol: PresenceLogic.RANK_POLICY };
    if (rec._lazy && !rec.bests) throw new Error('A player\'s best plays have to be loaded before a new one is recorded.'); // (never start them over by mistake)
    if (!rec.bests) rec.bests = {}; // (a record from before the server judged plays: its pp stays as reported)
    rec.name = name; rec.avatar = avatar; rec.plays++; rec.at = t;
    const b = rec.bests[key];
    // (with the song, so a profile can list it — read from the judged beatmap file itself)
    // (its hit counts and star rating too: the score on their profile opens with them, not as a row of 0s)
    if (!b || b.pp < entry.pp) rec.bests[key] = { pp: entry.pp, acc: entry.acc, grade: entry.grade, score: entry.score, combo: entry.combo, mods: entry.mods, date: t,
      ...(Array.isArray(entry.counts) && entry.counts.length === 6 ? { counts: entry.counts } : {}), ...(Number.isFinite(entry.stars) ? { stars: entry.stars } : {}),
      title: String(r.title || '').slice(0, 120), artist: String(r.artist || '').slice(0, 120), version: String(r.version || '').slice(0, 120),
      // (its beatmap set on osu!: a profile shows that set's cover behind it, on a device without the beatmap)
      ...(r.beatmapSetId > 0 ? { sid: r.beatmapSetId } : b && b.sid ? { sid: b.sid } : {}),
      // (pp only comes from a ranked or approved beatmap — the score route asks osu! before it's judged: checked)
      ...(entry.pp > 0 ? { ok: true } : {}) };
    const list = Object.entries(rec.bests).sort((a, b2) => b2[1].pp - a[1].pp).slice(0, PresenceLogic.KEEP_BESTS);
    rec.bests = Object.fromEntries(list);
    // (how many ranked beatmaps they've set a pp score on, for lazer's bonus — kept past the 200 best plays, up to 1000)
    if (entry.pp > 0) { const id = key.slice(0, 10); rec.rk = rec.rk || []; if (!rec.rk.includes(id) && rec.rk.length < 1000) rec.rk.push(id); }
    const { pp, acc: wAcc } = PresenceLogic.weigh(list.map(([, x]) => x), (rec.rk || []).length);
    const accW = wAcc, wSum = 1;
    const g = list.map(([, x]) => x.grade);
    // (ranked score: the best score on each ranked beatmap, added up — lazer's Score rankings)
    const rscore = list.reduce((a, [, x]) => a + (x.pp > 0 ? x.score || 0 : 0), 0);
    rec.v = { pp: Math.round(pp * 100) / 100, n: (rec.rk || []).length, acc: wSum ? accW / wSum : 0, ss: g.filter(x => x === 'SS' || x === 'XH').length, s: g.filter(x => x === 'S' || x === 'SH').length, a: g.filter(x => x === 'A').length, rscore };
    PresenceLogic.settleRank(rec);
    this.ranks.set(pid, rec);
    if (this.persistRank) this.persistRank(pid, rec);
    const out = [];
    // a playlist's beatmap (while the playlist is open): the player's best on it there
    const pl = playlist && this.playlists.get(String(playlist.id || ''));
    if (pl && pl.ends > t && pl.items.some(x => x.hash === key)) {
      const v = (pl.scores ||= {})[pid] ||= { name, avatar, best: {} };
      v.name = name; v.avatar = avatar;
      const was = v.best[key];
      if (!was || was.score < entry.score) v.best[key] = { score: entry.score, acc: entry.acc, combo: entry.combo, grade: entry.grade, mods: entry.mods, at: t };
      this.savePlaylist(pl);
      for (const [x, ux] of this.users) if (ux.pid === pid) out.push({ to: x, msg: this.plMsg(pl, pid) });
    }
    // the daily challenge: only today's issued beatmap (its beatmap id read from the verified file itself)
    const d = this.dailyNow();
    const dailyOk = !!(daily && d.map && daily.day === d.day && r.beatmapId === d.map.onlineId);
    if (dailyOk) {
      this.countDailyDay(pid, d.day);
      const ds = { pid, name, avatar, score: entry.score, acc: entry.acc, combo: entry.combo, grade: entry.grade, mods: entry.mods, at: t };
      const was = d.scores.find(x => x.pid === pid);
      if (!was || was.score < ds.score) { d.scores = d.scores.filter(x => x.pid !== pid); d.scores.push(ds); }
      this.saveDaily();
      out.push(...[...this.users.keys()].map(x => ({ to: x, msg: this.dailyMsg(this.users.get(x).pid) })));
    }
    // where the player's best stands on the board now, and whether this play set it (lazer's results)
    const now = this.boards.get(key) || [], at = now.findIndex(x => x.pid === pid);
    return { out, entry, total: rec.pp, rank: at < 0 ? null : at + 1, of: now.length, best: !prev || prev.score < entry.score,
      daily: !daily ? null : dailyOk ? 'ok' : !d.map || daily.day !== d.day ? 'day' : 'map' };
  }
  /** A player's profile for someone looking at it: what their game shared, their place in the rankings, their daily
   *  challenge record and whether they're online. */
  profileMsg(pid) {
    const data = this.profiles.get(pid) || null, r = this.ranks.get(pid);
    // their best plays the server judged (the ones with a known song, on ranked beatmaps), best first — for a profile their game hasn't sent
    // (with each one's beatmap — its file's hash — so their own game can tell which of its plays these are)
    // (a play kept before its hit counts and star rating were: those of the same score on the beatmap's board, when it's there)
    const fill = (key, b) => { if (b.counts && b.stars != null) return {}; const e = (this.boards.get(key) || []).find(x => x && x.pid === pid && x.score === b.score); return e ? { counts: b.counts || e.counts, stars: b.stars ?? e.stars } : {}; };
    const top = r && r.bests ? Object.entries(r.bests).filter(([, b]) => b && b.title && b.pp > 0).sort((a, b) => b[1].pp - a[1].pp).slice(0, 100)
      .map(([key, b]) => ({ key, title: b.title, artist: b.artist, version: b.version, grade: b.grade, accuracy: b.acc, mods: b.mods || [], date: b.date, pp: b.pp, score: b.score, maxCombo: b.combo, passed: true, onlineSetId: b.sid || undefined,
        counts: b.counts, stars: b.stars, ...fill(key, b) })) : [];
    const online = [...this.users.entries()].find(([, x]) => x.pid === pid && x.vis !== 'offline'); // (appearing offline: offline here too)
    const all = [...this.ranks.values()].filter(x => x.pp > 0).sort((a, b) => b.pp - a.pp || b.acc - a.acc), at = all.findIndex(x => x.pid === pid);
    // (a first place stored without its song — the backfill couldn't find which beatmap it was — takes the name from their
    //  best plays if it can; one still without a name isn't listed: it showed as an empty row)
    const bests = r && r.bests ? r.bests : {};
    const f1 = Object.entries(this.firsts.get(pid) || {}).map(([k, v]) => v && !v.title && bests[k] && bests[k].title ? { ...v, title: bests[k].title, artist: bests[k].artist, version: bests[k].version, key: k } : v && { ...v, key: k })
      .filter(v => v && v.title).sort((a, b) => b.date - a.date);
    const firsts = f1.slice(0, 20).map(b => ({ title: b.title, artist: b.artist, version: b.version, grade: b.grade, accuracy: b.acc, mods: b.mods || [], date: b.date, pp: b.pp, score: b.score, maxCombo: b.combo, stars: b.stars, counts: b.counts, passed: true, ...fill(b.key, b) }));
    // (the best plays their profile lists: only the ones checked to be on ranked beatmaps — and when their standing is
    //  the plays judged here, those instead — with the numbers the total is made of: the bonus pp and how many plays)
    let shown = data;
    if (data && Array.isArray(data.top)) {
      const ok = r && r.okh ? new Set(r.okh) : null;
      const vt = r && r.src === 'judged' && top.length ? [] : data.top.filter(x => x && x.pp > 0 && x.passed !== false && (ok ? ok.has(PresenceLogic.playId(x)) : x.ranked === true));
      shown = { ...data, top: vt, pp: r ? r.pp : data.pp };
    }
    const n = r ? r.n || 0 : 0, bonus = n > 0 ? Math.round(416.6667 * (1 - 0.995 ** Math.min(1000, n)) * 100) / 100 : 0;
    return { t: 'profile', pid, data: shown, top, firsts, firstCount: f1.length, name: online ? online[1].name : r ? r.name : data ? data.name : null, avatar: online ? online[1].avatar : r ? r.avatar : null,
      role: this.roleOf(pid), rank: at < 0 ? null : at + 1, daily: this.dailyStatsOf(pid), verified: r ? { pp: r.pp, acc: r.acc, plays: r.plays, ss: r.ss, s: r.s, a: r.a, n, bonus, src: r.src || 'judged' } : null, online: !!online, id: online ? online[0] : null, status: online ? online[1].status : 'offline' };
  }
  setFirst(pid, key, v) {
    const m = this.firsts.get(pid) || {};
    if (v) m[key] = v; else delete m[key];
    this.firsts.set(pid, m);
    if (this.persistFirsts) this.persistFirsts(pid, m);
  }
  loadFirsts(all) { for (const [pid, v] of Object.entries(all || {})) if (v && typeof v === 'object') this.firsts.set(pid, v); }
  static LB_KEEP = 100;
  static lbKey(k) { k = String(k || ''); return /^[a-f0-9]{16,64}$/.test(k) ? k : ''; }
  boardMsg(key, pid, scope) {
    const all = (this.boards.get(key) || []).filter(s => !this.isBanned(s.pid));
    const fr = this.friends.get(pid);
    const list = scope === 'friends' ? all.filter(s => s.pid === pid || (fr && fr.has(s.pid))) : all;
    const at = list.findIndex(s => s.pid === pid);
    return { t: 'lb', key, scope: scope === 'friends' ? 'friends' : 'global', total: list.length, you: at < 0 ? null : { ...this.current(list[at]), rank: at + 1 }, scores: list.slice(0, 50).map((s, i) => ({ ...this.current(s), rank: i + 1 })) };
  }
  loadDailyStats(all) { for (const [pid, v] of Object.entries(all || {})) if (v && typeof v === 'object') this.dailyStats.set(pid, v); }
  /** A player's daily record as of today (a streak broken by a missed day reads 0). */
  dailyStatsOf(pid) {
    const v = this.dailyStats.get(pid);
    if (!v) return null;
    const today = PresenceLogic.dayOf(this.now()), yesterday = PresenceLogic.prevDay(today);
    return { ...v, current: v.last === today || v.last === yesterday ? v.current : 0 };
  }
  countDailyDay(pid, day) {
    const v = this.dailyStats.get(pid) || { plays: 0, current: 0, best: 0, last: '' };
    if (v.last === day) return;
    const yesterday = PresenceLogic.prevDay(day);
    v.current = v.last === yesterday ? v.current + 1 : 1; v.best = Math.max(v.best, v.current); v.plays++; v.last = day;
    this.dailyStats.set(pid, v);
    if (this.persistDailyStats) this.persistDailyStats(pid, v);
  }
  /** The daily challenge's day, in US Central time (America/Chicago, daylight saving included): it turns over at
   *  midnight there. */
  static dayOf(t) {
    const p = PresenceLogic._central(t);
    return `${p.year}-${p.month}-${p.day}`;
  }
  static _central(t) {
    const fmt = PresenceLogic._fmt || (PresenceLogic._fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
    const o = {}; for (const x of fmt.formatToParts(new Date(t))) o[x.type] = x.value;
    return o;
  }
  /** The calendar day before `day` (YYYY-MM-DD). */
  static prevDay(day) { return new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10); }
  /** When `day` ends: the next midnight in Central time, as a timestamp. */
  static dayEnd(day) {
    const next = new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10), L = Date.parse(next + 'T00:00:00Z');
    // (the zone's offset there, worked out from how Chicago shows that moment; twice, for the hours either side of a change)
    const off = t => { const p = PresenceLogic._central(t); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t; };
    let u = L - off(L); u = L - off(u);
    return u;
  }
  dailyNow() {
    const day = PresenceLogic.dayOf(this.now());
    // (a new challenge at 12am Central — one saved under any other day, including a UTC one from before, makes way)
    if (this.daily.day !== day) { this.daily = { day, map: null, scores: [], hist: (this.daily.hist || []).slice(-60) }; this.dailyError = null; this.saveDaily(); }
    return this.daily;
  }
  /** The daily challenge's beatmaps to pick from in one page of osu!'s listing: ranked (or approved) 4K difficulties of
   *  3.5–5.5 stars — none of the last weeks' — with what the challenge shows of them, as osu! has them. */
  static dailyCandidates(data, recent = []) {
    const out = [], seen = new Set(recent.map(Number));
    for (const set of (data && Array.isArray(data.beatmapsets) ? data.beatmapsets : [])) {
      if (!set || !(set.id > 0) || !['ranked', 'approved'].includes(String(set.status))) continue;
      for (const b of Array.isArray(set.beatmaps) ? set.beatmaps : []) {
        const mania = b && (b.mode === 'mania' || b.mode_int === 3 || b.mode === 3), stars = Number(b && b.difficulty_rating);
        if (!mania || !(b.id > 0) || Math.round(Number(b.cs)) !== 4 || !(stars >= 3.5 && stars <= 5.5) || seen.has(b.id)) continue;
        out.push({ onlineSetId: set.id, onlineId: b.id, keys: 4, title: str(set.title, 120), artist: str(set.artist, 120), version: str(b.version, 120),
          creator: str(set.creator, 40), stars: Math.round(stars * 100) / 100, length: Math.min(36e5, Math.max(0, Number(b.total_length) || 0) * 1000) });
      }
    }
    return out;
  }
  /** Today's beatmap is `m` (from osu!'s listing, or set by the server's owner): everyone online is told. */
  setDailyMap(m) {
    const d = this.dailyNow(), onlineSetId = Math.floor(Number(m && m.onlineSetId)), onlineId = Math.floor(Number(m && m.onlineId)), keys = Number(m && m.keys);
    if (!(onlineSetId > 0 && onlineId > 0 && keys >= 1 && keys <= 10)) return [];
    if (d.map && d.map.onlineId !== onlineId) d.scores = []; // (today's beatmap changed by the server's owner: its board starts over)
    d.map = { onlineSetId, onlineId, keys, title: str(m.title, 120), artist: str(m.artist, 120), version: str(m.version, 120), creator: str(m.creator, 40),
      stars: Math.round(Math.min(20, Math.max(0, Number(m.stars) || 0)) * 100) / 100, length: Math.min(36e5, Math.max(0, Number(m.length) || 0)) };
    d.hist = [...(d.hist || []).filter(x => x !== onlineId), onlineId].slice(-60);
    this.dailyError = null;
    this.saveDaily();
    return this.dailyBroadcast();
  }
  /** The day's challenge, to everyone online (each with their own place on it). */
  dailyBroadcast() { return [...this.users.keys()].map(x => ({ to: x, msg: this.dailyMsg(this.users.get(x).pid) })); }
  saveDaily() { if (this.persistDaily) this.persistDaily(this.daily); }
  /** A score as shown: with its player's current name and picture (a rename shows on scores set before it). */
  current(s) {
    const online = [...this.users.values()].find(u => u.pid === s.pid), r = this.ranks.get(s.pid);
    const name = online ? online.name : r ? r.name : s.name, avatar = online ? online.avatar : r ? r.avatar : s.avatar;
    return name === s.name && avatar === s.avatar ? s : { ...s, name, avatar };
  }
  dailyMsg(pid) {
    const d = this.dailyNow(), sorted = d.scores.filter(s => !this.isBanned(s.pid)).sort((a, b) => b.score - a.score || b.acc - a.acc || a.at - b.at);
    const at = sorted.findIndex(s => s.pid === pid), end = PresenceLogic.dayEnd(d.day);
    // lazer's score breakdown (how many scores fall in each 100,000) and event feed (the newest scores, with their place)
    const bins = new Array(11).fill(0);
    for (const x of sorted) bins[Math.min(10, Math.floor((x.score || 0) / 100000))]++;
    const recent = [...sorted.map((x, i) => ({ x, rank: i + 1 }))].sort((a, b) => b.x.at - a.x.at).slice(0, 8)
      .map(({ x, rank }) => ({ ...this.current({ pid: x.pid, name: x.name, avatar: x.avatar }), pid: x.pid, score: x.score, rank, at: x.at }));
    return { t: 'daily', day: d.day, endsAt: end, map: d.map, error: d.map ? null : this.dailyError, total: sorted.length, bins, recent, you: at < 0 ? null : { ...this.current(sorted[at]), rank: at + 1 }, stats: this.dailyStatsOf(pid),
      scores: sorted.slice(0, 50).map((s, i) => ({ ...this.current(s), rank: i + 1 })) };
  }
  static CHAT_KEEP = 100;
  static CHAT_BURST = 5; // messages per CHAT_WINDOW
  static CHAT_WINDOW = 5000;
  // (only records the server worked out itself: ones that came from players' own reports, before scores were verified, are dropped)
  // (records from before plays were judged here — pp as each game reported it — count too, as reported)
  loadRanks(ranks) {
    for (const [pid, r] of Object.entries(ranks || {})) {
      if (!r || typeof r !== 'object') continue;
      // (stored apart — rb:<pid> — and read only when needed: the rankings need just the totals)
      if (r.sb && !r.bests) r._lazy = true;
      // (records from before only ranked beatmaps gave pp: their plays can't be told apart, so their standing starts over
      //  — the player's game reports its ranked-only pp the next time they're online, and new plays are judged as usual)
      if ((r.pol || 0) < 2) {
        const zero = { pp: 0, acc: 0, ss: 0, s: 0, a: 0 };
        for (const b of Object.values(r.bests || {})) if (b) b.pp = 0;
        r.v = { ...zero }; r.rep = { ...zero }; r.pol = 2; r.reset = true;
      }
      // (policy 3: a game's own word on its pp no longer counts — only plays checked to be on ranked beatmaps, the ones
      //  judged here and the ones on the profile looked up on osu! — and totals are lazer's, with the bonus pp)
      //  — but nobody's standing is taken away for it: what they had stays until their profile has been checked again,
      //  in the background, from what the server already holds (restoreRanks), without them having to come online
      if (r.pol < 3) {
        r.pol = 3; r.reset = true; r.rew = 1;
        if (r.bests) { PresenceLogic.revalue(r); delete r.rew; }
      }
      // (a record from the short while only judged plays counted — its profile's standing was dropped: it's checked again
      //  from their profile, in the background — restoreRanks — and the next time they're online)
      if (r.pol > PresenceLogic.RANK_POLICY) { r.pol = PresenceLogic.RANK_POLICY; r.reset = true; }
      if (r.bests) PresenceLogic.dropUnranked(r);
      PresenceLogic.settleRank(r);
      this.ranks.set(pid, r);
    }
  }
  /** A player's standing: the pp of the plays judged here or, while that's lower (a small server can't always judge a
   *  long song in time), what their game reports from their own scores — whichever is higher. */
  static RANK_POLICY = 3;
  /** A standing from the best plays a player's profile lists (only the ones on ranked beatmaps: `isRanked(entry)`),
   *  weighted as osu! weights them; null when none count. */
  static rankFromTop(top, isRanked) {
    const list = (Array.isArray(top) ? top : []).filter(x => x && Number.isFinite(+x.pp) && +x.pp > 0 && x.passed !== false && isRanked(x))
      .map(x => ({ ...x, pp: Math.min(100000, +x.pp), acc: Math.min(1, Math.max(0, +x.accuracy || 0)) }));
    if (!list.length) return null;
    const { pp, acc } = PresenceLogic.weigh(list, list.length);
    const g = list.map(x => x.grade);
    return { pp, acc, n: list.length, ss: g.filter(x => x === 'SS' || x === 'XH').length, s: g.filter(x => x === 'S' || x === 'SH').length, a: g.filter(x => x === 'A').length };
  }
  /** Total pp and accuracy as osu!'s servers work them out for lazer (UserTotalPerformanceProcessor): the best play on
   *  each ranked beatmap, highest pp first, the top 1000 weighted 0.95^i, plus 416.6667 × (1 − 0.995^n) for how many
   *  there are (n up to 1000); accuracy weighted the same way. `plays`: [{pp, acc}], `n`: ranked plays counted. */
  static weigh(plays, n = plays.length) {
    const list = plays.filter(x => x && x.pp > 0).sort((a, b) => b.pp - a.pp).slice(0, 1000);
    let pp = 0, accW = 0, wSum = 0;
    list.forEach((x, i) => { const w = 0.95 ** i; pp += x.pp * w; accW += (x.acc || 0) * w; wSum += w; });
    const count = Math.min(1000, Math.max(n || 0, list.length));
    if (count > 0) pp += 416.6667 * (1 - 0.995 ** count);
    return { pp: Math.round(pp * 100) / 100, acc: wSum ? accW / wSum : 0 };
  }
  /** A profile play's id, to remember it was checked: its beatmap file's hash, else its song and difficulty. */
  static playId(x) { return x && x.mapHash ? 'h' + String(x.mapHash).slice(0, 12) : `t${String(x && x.title || '').slice(0, 40)}|${String(x && x.version || '').slice(0, 30)}`.toLowerCase(); }
  /** The ids of the plays found to be on ranked beatmaps. */
  static okIds(top, flags) { return top.filter((x, i) => flags[i] === true && x && x.pp > 0).map(PresenceLogic.playId).slice(0, 50); }
  /** A record's totals again from its best plays (after the way they're added up changed). */
  /** Best plays set with mods that no longer count (Difficulty Adjust and the others lazer doesn't rank) are dropped, and
   *  the totals worked out again without them. */
  static dropUnranked(rec) {
    const bad = Object.entries(rec.bests || {}).filter(([, x]) => !rankedMods(x)).map(([k]) => k);
    if (!bad.length) return rec;
    for (const k of bad) delete rec.bests[k];
    if (rec.rk) rec.rk = rec.rk.filter(id => !bad.some(k => k.slice(0, 10) === id));
    return PresenceLogic.revalue(rec);
  }
  static revalue(rec) {
    const list = Object.values(rec.bests || {});
    if (!rec.rk) rec.rk = Object.entries(rec.bests || {}).filter(([, x]) => x && x.pp > 0).map(([k]) => k.slice(0, 10));
    const { pp, acc } = PresenceLogic.weigh(list, rec.rk.length), g = list.map(x => x.grade);
    rec.v = { ...(rec.v || {}), pp: list.some(x => x.pp > 0) ? pp : 0, n: rec.rk.length, acc, ss: g.filter(x => x === 'SS' || x === 'XH').length, s: g.filter(x => x === 'S' || x === 'SH').length, a: g.filter(x => x === 'A').length };
    PresenceLogic.settleRank(rec);
    return rec;
  }
  static settleRank(r) {
    const v = r.v || { pp: 0, acc: 0, ss: 0, s: 0, a: 0 }, rep = r.rep || { pp: 0, acc: 0, ss: 0, s: 0, a: 0 };
    const use = rep.pp > v.pp ? rep : v;
    r.pp = use.pp; r.acc = use.acc; r.ss = use.ss; r.s = use.s; r.a = use.a;
    // (how many ranked plays the total counts, for its bonus pp, and where it came from: plays judged here, or their profile's plays checked on osu!)
    r.n = use.n || 0; r.src = use === rep ? 'profile' : 'judged';
    r.rscore = Math.max(v.rscore || 0, rep.rscore || 0);
    return r;
  }
  /** The top 50 by pp, and where you stand. */
  rankings(pid, mode = 'performance') {
    // lazer's Performance and Score tables: by total pp, or by ranked score
    const byScore = mode === 'score';
    const all = [...this.ranks.values()].filter(r => (byScore ? r.rscore > 0 : r.pp > 0) && !this.isBanned(r.pid)).sort(byScore ? (a, b) => b.rscore - a.rscore || b.pp - a.pp : (a, b) => b.pp - a.pp || b.acc - a.acc);
    const online = new Set([...this.users.values()].filter(u => u.vis !== 'offline').map(u => u.pid));
    const at = all.findIndex(r => r.pid === pid);
    const pub = ({ bests, v, rep, _lazy, sb, okh, rk, ...r }) => r; // (not each player's whole list of plays)
    // (the owner, and the admins they made, with their role beside their name)
    const withRole = r => { const role = this.roleOf(r.pid); return role ? { ...pub(r), role } : pub(r); };
    return { t: 'rankings', mode: byScore ? 'score' : 'performance', total: all.length, you: at < 0 ? null : { ...withRole(all[at]), rank: at + 1 }, list: all.slice(0, 50).map((r, i) => ({ ...withRole(r), rank: i + 1, online: online.has(r.pid) })) };
  }
  load(friends, requests) {
    for (const [pid, l] of Object.entries(friends || {})) this.friends.set(pid, new Map(l));
    for (const [pid, l] of Object.entries(requests || {})) this.requests.set(pid, new Map(l));
  }
  areFriends(a, b) { return !!a && !!b && !!this.friends.get(a)?.has(b); }
  save(kind, pid) { if (this.persist && pid) this.persist(kind, pid, [...((kind === 'fr' ? this.friends : this.requests).get(pid) || new Map())]); }
  /** Everyone online with this public id (a player can have the game open in two tabs). */
  byPid(pid) { return [...this.users.entries()].filter(([, u]) => u.pid && u.pid === pid).map(([id]) => id); }
  friendsMsg(pid) {
    const online = new Set([...this.users.values()].filter(u => u.vis !== 'offline').map(u => u.pid));
    // (with each one's current name and picture: from them while online, else from their last ranked record)
    const who = (p, name) => { const c = this.current({ pid: p, name, avatar: '' }); return { pid: p, name: c.name, avatar: c.avatar || '' }; };
    return { t: 'friends', list: [...(this.friends.get(pid) || [])].map(([p, name]) => ({ ...who(p, name), online: online.has(p), seen: this.seen.get(p) || 0 })), requests: [...(this.requests.get(pid) || [])].map(([p, name]) => who(p, name)) };
  }
  /** Tell both sides (every tab of each) their friends changed. */
  friendsOut(...pids) { return pids.flatMap(p => this.byPid(p).map(id => ({ to: id, msg: this.friendsMsg(p) }))); }
  makeFriends(a, an, b, bn) {
    if (!this.friends.has(a)) this.friends.set(a, new Map());
    if (!this.friends.has(b)) this.friends.set(b, new Map());
    this.friends.get(a).set(b, bn); this.friends.get(b).set(a, an);
    this.requests.get(a)?.delete(b); this.requests.get(b)?.delete(a);
    for (const p of [a, b]) { this.save('fr', p); this.save('fq', p); }
  }
  static STALE = 35000; // clients ping every 10 s and go offline after 30 s in the background; silent this long = gone (a dropped connection may never say so)
  static MAX_EV = 240000; // a play's inputs kept for late watchers (t, col, down — ~80,000 key events)
  // (lazer's user status: "Appear offline" keeps a player off the list — and out of reach for spectating and invites)
  // (`role`: an admin's, the owner's — their name and picture in Neru's colours wherever they show)
  list() { return [...this.users.entries()].filter(([, u]) => u.vis !== 'offline').map(([id, u]) => ({ id, pid: u.pid, name: u.name, status: u.status, avatar: u.avatar, song: u.status === 'playing' ? u.song : null, watchers: u.watchers.size, dnd: u.vis === 'dnd' || undefined, role: (u.pid && this.roleOf(u.pid)) || undefined })); }
  join(id, msg) {
    // the same browser tab reconnecting replaces its old entry straight away (no ghost of yourself)
    const cid = str(msg && msg.cid, 40), gone = [], out = [];
    if (cid) for (const [oid, u] of this.users) if (u.cid === cid) { out.push(...this.forget(oid)); gone.push(oid); }
    // a public id belongs to whoever first used it with their secret key: anyone else using it stays anonymous
    let pid = /^[a-z0-9]{6,24}$/.test(String(msg && msg.pid || '')) ? String(msg.pid) : '';
    // (the client quietly takes a new id of its own — unless the id is a player with a code, or one merged into such a
    // player (`account`): then it's signed out, and asked for the code, rather than quietly made a new guest)
    if (pid && !this.claim(pid, msg && msg.key)) { const del = this.deleted.has(pid), acct = !del && (this.codeOf.has(pid) || this.merged.has(pid)); pid = ''; out.push({ to: id, msg: { t: 'repid', ...(del ? { deleted: true } : acct ? { account: true } : {}) } }); }
    // (banned by the server's owner: not let in at all — told why, and the connection closes)
    this.dropped = gone;
    if (pid && this.isBanned(pid)) return [...out, { to: id, msg: this.bannedMsg(pid) }];
    // (a name the server's owner gave them; or their own, given back while they were away)
    const nrec = pid ? this.names.get(pid) : null, given = (nrec && (nrec.name || nrec.was)) || '';
    if (given && str(msg && msg.name, 24) !== given) out.push({ to: id, msg: { t: 'renamed', name: given } });
    if (nrec && !nrec.name) { this.names.delete(pid); if (this.persistMod) this.persistMod('nm', pid, null); }
    this.users.set(id, { name: given || str(msg && msg.name, 24) || 'Player', status: cleanStatus(msg && msg.status), kh: pid ? sha256hex(String(msg.key || '')) : '', avatar: pid && this.noAvatar.has(pid) ? '' : cleanAvatar(msg && msg.avatar), cid,
      pid, song: null, seen: this.now(), vis: cleanVis(msg && msg.vis),
      play: null, ev: [], t: 0, hist: false, watchers: new Set(), watching: null, rp: '' });
    this.dropped = gone;
    const me = this.users.get(id);
    return [...out, { to: id, msg: { t: 'welcome', you: id } }, { to: id, msg: { t: 'chatHist', list: this.chat } }, ...(me.pid ? [{ to: id, msg: this.friendsMsg(me.pid) }] : []),
      ...(this.isStaff(me.pid) ? [{ to: id, msg: { t: 'admin', role: this.roleOf(me.pid) } }] : []), this.broadcast()];
  }
  /** Forget everyone who hasn't been heard from in a while; returns their ids (to close) and the update. */
  prune() {
    const t = this.now(), gone = [], out = [];
    for (const [id, u] of this.users) if (t - u.seen > PresenceLogic.STALE) { out.push(...this.forget(id)); gone.push(id); }
    return { gone, out: gone.length ? [...out, this.broadcast()] : [] };
  }
  /** Take a player off the list: their watchers are told the stream ended, and they stop watching anyone. */
  forget(id) {
    const u = this.users.get(id);
    if (!u) return [];
    const out = [];
    for (const w of u.watchers) { const wu = this.users.get(w); if (wu && wu.watching === id) wu.watching = null; out.push({ to: w, msg: { t: 'specEnd', id, gone: true } }); }
    if (u.watching) out.push(...this.unwatch(id, u.watching));
    if (u.pid && u.vis !== 'offline') this.markSeen(u.pid);
    this.users.delete(id); this.lastInvite.delete(id); this.said.delete(id);
    return out;
  }
  markSeen(pid) { const t = this.now(); this.seen.set(pid, t); if (this.persistSeen) this.persistSeen(pid, t); }
  leave(id) { if (!this.users.has(id)) return []; const out = this.forget(id); return [...out, this.broadcast()]; }
  broadcast() { return { to: 'all', msg: { t: 'online', players: this.list() } }; }
  watcherNames(u) { return [...u.watchers].map(w => this.users.get(w)?.name).filter(Boolean); }
  unwatch(id, target) {
    const u = this.users.get(id), tu = this.users.get(target);
    if (u && u.watching === target) u.watching = null;
    if (!tu || !tu.watchers.delete(id)) return [];
    // nobody left watching: the player stops streaming, and what was kept is dropped
    if (!tu.watchers.size) { tu.hist = false; tu.ev = []; }
    return [{ to: target, msg: { t: 'spectators', n: tu.watchers.size, names: this.watcherNames(tu) } }];
  }
  message(id, msg) {
    const u = this.users.get(id);
    if (!u || !msg || typeof msg !== 'object') return [];
    u.seen = this.now();
    if (msg.t === 'list') return [{ to: id, msg: { t: 'online', players: this.list() } }];
    if (msg.t === 'stats') {
      if (!u.pid) return [];
      // (their profile, for other players to open — what it shows of pp, rank and scores is the server's own)
      if (msg.profile && typeof msg.profile === 'object') {
        const json = JSON.stringify(msg.profile);
        if (json.length <= PresenceLogic.PROFILE_MAX && json !== this.profileJson.get(u.pid)) {
          // (an account's: what this device sent, put together with what its other devices did)
          const sent = JSON.parse(json), data = { ...(this.codeOf.has(u.pid) ? PresenceLogic.mergeProfile(this.profiles.get(u.pid), sent) : sent), name: u.name };
          this.profiles.set(u.pid, data); this.profileJson.set(u.pid, json);
          if (this.persistProfile) this.persistProfile(u.pid, data);
        }
      }
      // their standing as their game reports it (see settleRank), and their name and picture as they are now
      const p = msg.profile && typeof msg.profile === 'object' ? msg.profile : null;
      // (the pp their game works out isn't taken as it is: their best plays are checked to be on ranked beatmaps — on
      //  osu!, by the server, see verifyTop — and only those count, weighted as lazer weighs them)
      let rec = this.ranks.get(u.pid);
      if (rec) {
        // (their play count is the server's own — one for each play it judged — not what their game says)
        const before = JSON.stringify([rec.name, rec.avatar]);
        rec.name = u.name; rec.avatar = u.avatar;
        if (JSON.stringify([rec.name, rec.avatar]) !== before && this.persistRank) this.persistRank(u.pid, rec);
      }
      const top = this.codeOf.has(u.pid) && this.profiles.get(u.pid) ? this.profiles.get(u.pid).top : p && p.top; // (a player on several devices: all their best plays)
      if (Array.isArray(top) && top.length && this.verifyTop) this.verifyTop(u.pid, this.ownPlays(u.pid, top.slice(0, 50)), { name: u.name, avatar: u.avatar });
      if (this.verifyBests) this.verifyBests(u.pid);
      return [];
    }
    if (msg.t === 'rankings') return [{ to: id, msg: this.rankings(u.pid, msg.mode === 'score' ? 'score' : 'performance') }];
    // (your own best plays as the server has judged them — each beatmap's file hash and pp — so your game can send the
    //  ones it's missing: see Verified.catchUp)
    if (msg.t === 'myBests') { const r = u.pid ? this.ranks.get(u.pid) : null; return [{ to: id, msg: { t: 'myBests', list: r && r.bests ? Object.entries(r.bests).map(([k, b]) => [k, b.pp]) : [], keep: PresenceLogic.KEEP_BESTS } }]; }
    if (msg.t === 'profile') { const pid = String(msg.pid || ''); return /^[a-z0-9]{6,24}$/.test(pid) ? [{ to: id, msg: this.profileMsg(pid) }] : []; }
    if (msg.t === 'daily') return [{ to: id, msg: this.dailyMsg(u.pid) }];
    // ── user tags
    if (msg.t === 'tags') { const key = PresenceLogic.lbKey(msg.key); return key ? [{ to: id, msg: this.tagsMsg(key, u.pid) }] : []; }
    if (msg.t === 'tagVote') {
      const key = PresenceLogic.lbKey(msg.key), tag = String(msg.tag || '');
      if (!key || !u.pid || !PresenceLogic.USER_TAGS.includes(tag)) return [];
      if (!this.played(u.pid, key)) return [{ to: id, msg: { ...this.tagsMsg(key, u.pid), err: 'Set a score on this beatmap first (it has to reach the server) — then you can tag it.' } }];
      const votes = this.tags.get(key) || {}, mine = Object.keys(votes).filter(k => votes[k].includes(u.pid));
      if (msg.on && !mine.includes(tag)) {
        if (mine.length >= PresenceLogic.TAG_VOTES) return [{ to: id, msg: { ...this.tagsMsg(key, u.pid), err: `You can vote for ${PresenceLogic.TAG_VOTES} tags on a beatmap.` } }];
        votes[tag] = [...(votes[tag] || []), u.pid];
      } else if (!msg.on && mine.includes(tag)) {
        votes[tag] = votes[tag].filter(x => x !== u.pid);
        if (!votes[tag].length) delete votes[tag];
      }
      this.tags.set(key, votes);
      if (this.persistTags) this.persistTags(key, votes);
      return [{ to: id, msg: this.tagsMsg(key, u.pid) }];
    }
    // ── playlists
    if (msg.t === 'plList') return [{ to: id, msg: this.plList(u.pid) }];
    if (msg.t === 'pl') { const p = this.playlists.get(String(msg.id || '')); return [{ to: id, msg: p ? this.plMsg(p, u.pid) : { t: 'pl', id: String(msg.id || '').slice(0, 12), gone: true } }]; }
    if (msg.t === 'plCreate') {
      if (!u.pid) return [];
      const now = this.now(), open = [...this.playlists.values()].filter(p => p.host.pid === u.pid && p.ends > now).length;
      if (open >= PresenceLogic.PL_OPEN) return [{ to: id, msg: { t: 'error', msg: `You can have ${PresenceLogic.PL_OPEN} playlists open at once. Close one first.` } }];
      const seen = new Set(), items = [];
      for (const m of Array.isArray(msg.items) ? msg.items.slice(0, PresenceLogic.PL_ITEMS) : []) {
        if (!m || typeof m !== 'object') continue;
        const hash = String(m.hash || '');
        if (!/^[a-f0-9]{64}$/.test(hash) || seen.has(hash)) continue;
        seen.add(hash);
        const n = (v, max) => Math.min(max, Math.max(0, Math.floor(Number(v) || 0)));
        items.push({ hash, onlineId: n(m.onlineId, 1e10), onlineSetId: n(m.onlineSetId, 1e10), keys: Math.min(18, Math.max(1, n(m.keys, 18))), title: str(m.title, 120), artist: str(m.artist, 120),
          version: str(m.version, 120), creator: str(m.creator, 40), stars: Math.round(Math.min(20, Math.max(0, Number(m.stars) || 0)) * 100) / 100, length: n(m.length, 36e5) });
      }
      if (!items.length) return [{ to: id, msg: { t: 'error', msg: 'A playlist needs at least one beatmap.' } }];
      const hours = [1, 3, 6, 12, 24, 72, 168, 336].includes(Number(msg.hours)) ? Number(msg.hours) : 24;
      let pid; do pid = makeCode(8); while (this.playlists.has(pid));
      const p = { id: pid, name: str(msg.name, 60) || `${u.name}'s playlist`, host: { pid: u.pid, name: u.name, avatar: u.avatar }, created: now, ends: now + hours * 3600000, items, scores: {} };
      this.playlists.set(pid, p); this.savePlaylist(p);
      return [{ to: id, msg: { ...this.plMsg(p, u.pid), made: true } }, ...[...this.users.keys()].map(x => ({ to: x, msg: this.plList(this.users.get(x).pid) }))];
    }
    if (msg.t === 'plClose') {
      const p = this.playlists.get(String(msg.id || ''));
      if (!p || p.host.pid !== u.pid || p.ends <= this.now()) return [];
      p.ends = this.now(); this.savePlaylist(p);
      return [{ to: id, msg: this.plMsg(p, u.pid) }];
    }
    if (msg.t === 'lb') {
      // (by the beatmap's file hash, or — `id` — by its osu! beatmap id)
      const bid = Math.floor(Number(msg.id) || 0), key = bid > 0 ? this.boardIds.get(bid) : PresenceLogic.lbKey(msg.key);
      if (bid > 0 && !key) return [{ to: id, msg: { t: 'lb', id: bid, key: '', scope: msg.scope === 'friends' ? 'friends' : 'global', total: 0, you: null, scores: [] } }];
      return key ? [{ to: id, msg: { ...this.boardMsg(key, u.pid, msg.scope), ...(bid > 0 ? { id: bid } : {}) } }] : [];
    }
    // (scores go up only as plays the server judges itself: POST /api/mp/score — see Matchmaker.score)
    // (the day's beatmap is the server's to pick: what an older game proposes is ignored — it gets the day's as it is)
    if (msg.t === 'dailyPropose') return [{ to: id, msg: this.dailyMsg(u.pid) }];
    if (msg.t === 'status') {
      const given = this.givenName(u.pid);
      const st = cleanStatus(msg.status), name = given || (msg.name != null ? str(msg.name, 24) || u.name : u.name), av = u.pid && this.noAvatar.has(u.pid) ? '' : msg.avatar != null ? cleanAvatar(msg.avatar) : u.avatar;
      const told = given && msg.name != null && str(msg.name, 24) !== given ? [{ to: id, msg: { t: 'renamed', name: given } }] : [];
      const song = st === 'playing' ? cleanSong(msg.song) || (u.status === 'playing' ? u.song : null) : null;
      // (the Ranked Play match they're in: only their spectators are told, to watch it as they see it)
      const rp = typeof msg.rp === 'string' && /^[A-Z0-9]{4,10}$/.test(msg.rp) ? msg.rp : '';
      if (rp !== u.rp) { u.rp = rp; told.push(...[...u.watchers].map(w => ({ to: w, msg: { t: 'specRoom', id, pid: u.pid, room: rp } }))); }
      if (st === u.status && name === u.name && av === u.avatar && JSON.stringify(song) === JSON.stringify(u.song)) return told;
      u.status = st; u.name = name; u.avatar = av; u.song = song;
      return [...told, this.broadcast()];
    }
    // ── chat: a line in #lobby, or a private message to a friend (every tab of both of you)
    if (msg.t === 'say' || msg.t === 'pm') {
      const text = str(msg.text, 300).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
      if (!text) return [];
      const muted = this.modOf('mu', u.pid);
      if (muted) {
        const mins = muted.until ? Math.max(1, Math.ceil((muted.until - this.now()) / 60000)) : 0;
        return [{ to: id, msg: { t: 'error', msg: `You can't chat ${mins ? `for another ${mins >= 120 ? `${Math.round(mins / 60)} hours` : `${mins} minute${mins === 1 ? '' : 's'}`}` : 'any more'}${muted.reason ? ` (${muted.reason})` : ''}.` } }];
      }
      const t = this.now(), recent = (this.said.get(id) || []).filter(x => t - x < PresenceLogic.CHAT_WINDOW);
      if (recent.length >= PresenceLogic.CHAT_BURST) return [{ to: id, msg: { t: 'error', msg: 'You\'re sending messages too fast.' } }];
      recent.push(t); this.said.set(id, recent);
      const from = { pid: u.pid, name: u.name, avatar: u.avatar };
      if (msg.t === 'say') {
        const line = { ch: '#lobby', from, text, at: t };
        this.chat.push(line); if (this.chat.length > PresenceLogic.CHAT_KEEP) this.chat.shift();
        if (this.persistChat) this.persistChat(this.chat);
        return [{ to: 'all', msg: { t: 'say', ...line } }];
      }
      const to = String(msg.to || '');
      if (!u.pid || !this.areFriends(u.pid, to)) return [{ to: id, msg: { t: 'error', msg: 'You can only message your friends.' } }];
      const targets = this.byPid(to);
      if (!targets.length) return [{ to: id, msg: { t: 'error', msg: 'That player is offline.' } }];
      const toName = this.users.get(targets[0]).name;
      return [...targets.map(x => ({ to: x, msg: { t: 'pm', with: { pid: u.pid, name: u.name, avatar: u.avatar }, from, text, at: t } })),
        ...this.byPid(u.pid).map(x => ({ to: x, msg: { t: 'pm', with: { pid: to, name: toName }, from, text, at: t, mine: true } }))];
    }
    if (msg.t === 'vis') {
      const v = cleanVis(msg.v);
      if (v === u.vis) return [];
      if (v === 'offline' && u.pid) this.markSeen(u.pid);
      u.vis = v;
      const out = [];
      // (gone offline to everyone else: nobody can keep watching)
      if (v === 'offline') for (const w of [...u.watchers]) out.push(...this.unwatch(w, id), { to: w, msg: { t: 'specEnd', id, gone: true } });
      return [...out, this.broadcast()];
    }
    if (msg.t === 'invite') {
      const code = str(msg.code, 8).toUpperCase();
      if (!validCode(code) || !this.users.has(msg.to) || msg.to === id || this.users.get(msg.to).vis === 'offline') return [{ to: id, msg: { t: 'error', msg: 'That player is no longer online.' } }];
      if (this.users.get(msg.to).vis === 'dnd') return [{ to: id, msg: { t: 'error', msg: 'That player isn\'t taking invites right now (Do not disturb).' } }];
      if (!this.areFriends(u.pid, this.users.get(msg.to).pid)) return [{ to: id, msg: { t: 'error', msg: 'You can only invite your friends.' } }];
      if (this.users.get(msg.to).status !== 'menu') return [{ to: id, msg: { t: 'error', msg: 'That player is already in a room.' } }];
      const key = `${msg.to}|${code}`, t = this.now();
      if (this.lastInvite.get(id)?.key === key && t - this.lastInvite.get(id).at < 3000) return []; // double-click
      this.lastInvite.set(id, { key, at: t });
      return [{ to: msg.to, msg: { t: 'invite', from: { id, name: u.name }, code } }, { to: id, msg: { t: 'invited', to: msg.to } }];
    }
    // ── friends: a request, answered by the other player; friends are mutual
    if (msg.t === 'friendReq') {
      const tu = this.users.get(String(msg.to || ''));
      if (!tu || !u.pid || !tu.pid || tu.pid === u.pid) return [{ to: id, msg: { t: 'error', msg: 'That player is no longer online.' } }];
      if (this.areFriends(u.pid, tu.pid)) return [];
      // they had already asked you: that's a yes from both
      if (this.requests.get(u.pid)?.has(tu.pid)) { this.makeFriends(u.pid, u.name, tu.pid, tu.name); return this.friendsOut(u.pid, tu.pid); }
      if (!this.requests.has(tu.pid)) this.requests.set(tu.pid, new Map());
      const fresh = !this.requests.get(tu.pid).has(u.pid);
      this.requests.get(tu.pid).set(u.pid, u.name); this.save('fq', tu.pid);
      return [{ to: id, msg: { t: 'friendSent', pid: tu.pid, name: tu.name } },
        ...(fresh ? this.byPid(tu.pid).map(t => ({ to: t, msg: { t: 'friendReq', from: { pid: u.pid, name: u.name } } })) : []),
        ...this.friendsOut(tu.pid)];
    }
    if (msg.t === 'friendAnswer') {
      const from = String(msg.pid || ''), name = this.requests.get(u.pid)?.get(from);
      if (!u.pid || name == null) return [];
      if (msg.yes) { this.makeFriends(u.pid, u.name, from, name); return [...this.friendsOut(u.pid, from), ...this.byPid(from).map(t => ({ to: t, msg: { t: 'friendAdded', pid: u.pid, name: u.name } }))]; }
      this.requests.get(u.pid).delete(from); this.save('fq', u.pid);
      return this.friendsOut(u.pid);
    }
    if (msg.t === 'unfriend') {
      const other = String(msg.pid || '');
      if (!u.pid || !this.areFriends(u.pid, other)) return [];
      this.friends.get(u.pid).delete(other); this.friends.get(other)?.delete(u.pid);
      this.save('fr', u.pid); this.save('fr', other);
      // (no more watching each other)
      const out = [];
      for (const [wid, wu] of this.users) if (wu.pid === u.pid || wu.pid === other) { const tgt = wu.watching && this.users.get(wu.watching); if (tgt && (tgt.pid === u.pid || tgt.pid === other) && tgt.pid !== wu.pid) { out.push(...this.unwatch(wid, wu.watching), { to: wid, msg: { t: 'specEnd', id: wu.watching, gone: true } }); } }
      return [...out, ...this.friendsOut(u.pid, other)];
    }
    // ── spectating
    if (msg.t === 'watch') {
      const to = String(msg.to || ''), tu = this.users.get(to);
      if (!tu || to === id || tu.vis === 'offline') return [{ to: id, msg: { t: 'error', msg: 'That player is no longer online.' } }];
      const out = u.watching && u.watching !== to ? this.unwatch(id, u.watching) : [];
      const first = !tu.watchers.size;
      tu.watchers.add(id); u.watching = to;
      if (!tu.play) return [...out, { to: id, msg: { t: 'specWait', id: to, name: tu.name, pid: tu.pid, room: tu.rp || '' } }, { to, msg: { t: 'spectators', n: tu.watchers.size, names: this.watcherNames(tu) } }];
      // mid-play: what's kept so far, or (nobody was watching, so nothing was streamed) ask the player for all of it
      out.push({ to: id, msg: { t: 'specStart', id: to, name: tu.name, head: tu.play, ev: tu.hist ? tu.ev : [], at: tu.t, hist: tu.hist, pid: tu.pid, room: tu.rp || '' } });
      out.push({ to, msg: { t: 'spectators', n: tu.watchers.size, names: this.watcherNames(tu), full: first || !tu.hist } });
      return out;
    }
    if (msg.t === 'unwatch') return this.unwatch(id, String(msg.to || u.watching || ''));
    if (msg.t === 'play') {
      if (!msg.head || typeof msg.head !== 'object') return [];
      const head = cleanHead(msg.head);
      if (!head) return [];
      u.play = head; u.ev = []; u.t = 0; u.hist = u.watchers.size > 0; // (a fresh play: nothing to catch up on)
      return [...u.watchers].map(w => ({ to: w, msg: { t: 'specStart', id, name: u.name, head, ev: [], at: 0, hist: true, pid: u.pid, room: u.rp || '' } }));
    }
    if (msg.t === 'frames') {
      if (!u.play || !u.watchers.size || !Array.isArray(msg.ev)) return [];
      const ev = msg.ev.slice(0, 6000).map(Number).filter(Number.isFinite), t = num(msg.at, -1e4, 1e8);
      if (msg.reset) u.ev = [];
      if (u.ev.length + ev.length <= PresenceLogic.MAX_EV) for (const x of ev) u.ev.push(x);
      u.t = Math.max(u.t, t);
      if (msg.last) u.hist = true;
      // (what they did — a skip, a pause, the pause menu button they're on, carrying on, a fail — at a time in the song)
      const a = msg.act && typeof msg.act === 'object' && ['skip', 'outro', 'pause', 'resume', 'fail', 'sel'].includes(msg.act.k) ? msg.act : null;
      const act = a ? { k: a.k, t: num(a.t, -1e4, 1e8), ...(a.k === 'sel' && ['continue', 'retry', 'quit'].includes(a.sel) ? { sel: a.sel } : {}) } : null;
      return [...u.watchers].map(w => ({ to: w, msg: { t: 'specFrames', id, ev, at: u.t, reset: !!msg.reset, last: !!msg.last, ...(act ? { act } : {}) } }));
    }
    if (msg.t === 'playEnd') {
      if (!u.play) return [];
      u.play = null; u.ev = []; u.hist = false;
      return [...u.watchers].map(w => ({ to: w, msg: { t: 'specEnd', id, quit: !!msg.quit } }));
    }
    if (msg.t === 'ping') return [{ to: id, msg: { t: 'pong' } }];
    return [];
  }
}
/** What a player is playing, as shown on the online list. */
const cleanSong = s => s && typeof s === 'object' && s.title ? { title: str(s.title, 120), artist: str(s.artist, 120), version: str(s.version, 80), stars: num(s.stars, 0, 20, 0), keys: Math.round(num(s.keys, 1, 18, 4)) } : null;
/** A play's replay header (what a watcher needs to play it back), checked and trimmed. */
const cleanHead = h => {
  const hash = str(h.mapHash, 64);
  if (!hash) return null;
  const nums = o => o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).slice(0, 16).map(([k, v]) => [str(k, 16), typeof v === 'number' ? num(v, -1e6, 1e6) : str(String(v), 32)])) : {};
  return {
    mapHash: hash, onlineId: Math.round(num(h.onlineId, -1, 1e10, -1)), onlineSetId: Math.round(num(h.onlineSetId, -1, 1e10, -1)),
    title: str(h.title, 120), artist: str(h.artist, 120), version: str(h.version, 80), creator: str(h.creator, 40),
    keys: Math.round(num(h.keys, 1, 18, 4)), mods: cleanMods(h.mods), rate: num(h.rate, 0.25, 4, 1), seed: Math.round(num(h.seed, 0, 2 ** 32, 0)),
    windows: Array.isArray(h.windows) ? h.windows.slice(0, 8).map(x => num(x, 0, 1000, 100)) : nums(h.windows), accuracyMode: str(h.accuracyMode, 16), hp: num(h.hp, 0, 10, 5), modConfig: nums(h.modConfig),
    noFail: !!h.noFail, rules: Math.round(num(h.rules, 0, 100, 1)), player: str(h.player, 24),
  };
};
const cleanVis = v => v === 'dnd' || v === 'offline' ? v : 'online';
const cleanStatus = s => ['menu', 'room', 'ranked', 'playing', 'watching'].includes(s) ? s : 'menu';

/** Quick match: the first caller hosts a fresh room and waits; the next caller is sent to that room.
 *  The same (single) instance also runs presence — who's online — for invites. */
import { officialGet, osuApi, osuLoginState, osuStatus, beatmapListing, beatmapInfo } from './index.js';
import { sha256hex } from './sha256.js';
import { verifyPlay, acceptPlay, ModSystem } from './verify-bundle.js';
/** A score kept from before its mods stopped counting (Difficulty Adjust and the others lazer doesn't rank): left out. */
const rankedMods = x => !x || !Array.isArray(x.mods) || ModSystem.isRanked(x.mods.map(String));
const rankedBoard = v => (Array.isArray(v) ? v.filter(rankedMods) : []);

export class Matchmaker {
  constructor(state, env) { this.state = state; this.env = env; this.waiting = null; this.qp = {}; this.rooms = new Map(); this.presence = new PresenceLogic(); this.socks = new Map(); this.rq = new RankedQueue(Date.now, Math.random, () => makeCode()); }
  presenceSocket() {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const c = this.presenceAttach(server);
    server.addEventListener('message', ev => c.message(ev.data));
    server.addEventListener('close', c.gone);
    server.addEventListener('error', c.gone);
    return new Response(null, { status: 101, webSocket: client });
  }
  /** Someone's online connection — a WebSocket, or the plain-request stand-in for one (HttpSock) — hooked up:
   *  { message(text), gone() }. */
  presenceAttach(server) {
    const id = crypto.randomUUID().slice(0, 8);
    let joined = false;
    // (one message that goes wrong is dropped — an error escaping here could reset the object, and with it everyone online)
    const onMessage = ev => {
      if (typeof ev.data !== 'string' || ev.data.length > 65536) return; // (a play's inputs go up in chunks of up to ~60 KB)
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (!joined) {
        if (msg.t !== 'hello') return;
        joined = true; this.socks.set(id, server);
        const out = this.presence.join(id, msg);
        this.closeGone(this.presence.dropped);
        this.send(out);
        // (banned: told why, then the connection closes — the game doesn't try again)
        if (!this.presence.users.has(id)) { joined = false; this.socks.delete(id); setTimeout(() => { try { server.close(4003, 'banned'); } catch { /* closed */ } }, 100); return; }
        if (!this.sweep) this.sweep = setInterval(() => { const r = this.presence.prune(); this.closeGone(r.gone); this.send(r.out); if (!this.socks.size) { clearInterval(this.sweep); this.sweep = null; } }, 10000);
        return;
      }
      if (!this.presence.users.has(id)) { try { server.close(4001, 'stale'); } catch { /* closed */ } return; } // pruned: the client reconnects
      // the tab closing: off the list now (the close itself may never arrive)
      if (msg.t === 'bye') { gone(); try { server.close(1000, 'bye'); } catch { /* closed */ } return; }
      // (a beatmap's leaderboard comes out of storage the first time it's asked for)
      // (and a player's profile the first time it's opened)
      // (their best plays too, when they're kept apart and not read yet)
      const lazyBests = msg.t === 'profile' && (r => r && r._lazy && !r.bests)(this.presence.ranks.get(String(msg.pid || '')));
      if (msg.t === 'profile' && /^[a-z0-9]{6,24}$/.test(String(msg.pid || '')) && (lazyBests || (!this.presence.profiles.has(msg.pid) && !(this._pfLoaded || (this._pfLoaded = new Set())).has(msg.pid)))) {
        (this._pfLoaded || (this._pfLoaded = new Set())).add(msg.pid);
        Promise.all([
          this.presence.profiles.has(msg.pid) ? null : this.state.storage.get(`pf:${msg.pid}`).catch(() => null),
          this.ensureBests(msg.pid).catch(() => {}),
        ]).then(([v]) => {
          if (v && typeof v === 'object' && !this.presence.profiles.has(msg.pid)) this.presence.profiles.set(msg.pid, v);
          if (this.presence.users.has(id)) this.send(this.presence.message(id, msg));
        });
        return;
      }
      // (an account's profile is put together from what each of its devices reports: the kept one is read in first, or
      // the first report after a restart would stand in for all of them)
      const su = msg.t === 'stats' ? this.presence.users.get(id) : null;
      if (su && su.pid && this.presence.codeOf.has(su.pid) && !this.presence.profiles.has(su.pid)) {
        const L = this._pfLoading || (this._pfLoading = new Map()), done = this._pfLoaded || (this._pfLoaded = new Set());
        let pr = L.get(su.pid);
        if (!pr && !done.has(su.pid)) {
          done.add(su.pid);
          pr = this.state.storage.get(`pf:${su.pid}`).catch(() => null).then(v => {
            if (v && typeof v === 'object' && !this.presence.profiles.has(su.pid)) this.presence.profiles.set(su.pid, v);
            L.delete(su.pid);
          });
          L.set(su.pid, pr);
        }
        if (pr) { pr.then(() => { if (this.presence.users.has(id)) this.send(this.presence.message(id, msg)); }); return; }
      }
      // (a beatmap's user tags come out of storage the first time they're asked for — with its board, and the voter's
      // best plays when they aren't read yet: they decide whether that player may tag it)
      const tkey = msg.t === 'tags' || msg.t === 'tagVote' ? PresenceLogic.lbKey(msg.key) : '';
      if (tkey) {
        const tu = this.presence.users.get(id), tr = tu && tu.pid ? this.presence.ranks.get(tu.pid) : null;
        const loaded = this._tgLoaded || (this._tgLoaded = new Set()), lazy = !!(tr && tr._lazy && !tr.bests);
        if (!loaded.has(tkey) || lazy) {
          if (loaded.size > 20000) loaded.clear();
          loaded.add(tkey);
          Promise.all([
            this.presence.tags.has(tkey) ? null : this.state.storage.get(`tg:${tkey}`).catch(() => null),
            this.presence.boards.has(tkey) ? null : this.state.storage.get(`lb:${tkey}`).catch(() => null),
            lazy ? this.ensureBests(tu.pid).catch(() => {}) : null,
          ]).then(([tg, lb]) => {
            if (tg && typeof tg === 'object' && !this.presence.tags.has(tkey)) this.presence.tags.set(tkey, tg);
            if (!this.presence.boards.has(tkey)) this.presence.boards.set(tkey, rankedBoard(lb));
            if (this.presence.users.has(id)) this.send(this.presence.message(id, msg));
          });
          return;
        }
      }
      // (a board asked for by beatmap id: which board that is comes out of storage first)
      const bid = msg.t === 'lb' ? Math.floor(Number(msg.id) || 0) : 0;
      if (bid > 0 && !this.presence.boardIds.has(bid) && !(this._bidMiss || (this._bidMiss = new Set())).has(bid)) {
        this.state.storage.get(`lbid:${bid}`).catch(() => null).then(k => {
          if (typeof k === 'string' && !this.presence.boardIds.has(bid)) this.presence.boardIds.set(bid, k); else if (!k) this._bidMiss.add(bid);
          if (this._bidMiss.size > 5000) this._bidMiss.clear();
          if (this.presence.users.has(id)) onMessage({ data: JSON.stringify(msg) });
        });
        return;
      }
      const key = (msg.t === 'lb' || msg.t === 'lbSubmit') && (bid > 0 ? this.presence.boardIds.get(bid) : PresenceLogic.lbKey(msg.key));
      if (key && !this.presence.boards.has(key)) {
        this.state.storage.get(`lb:${key}`).catch(() => null).then(v => {
          if (!this.presence.boards.has(key)) this.presence.boards.set(key, rankedBoard(v));
          if (this.presence.users.has(id)) this.send(this.presence.message(id, msg));
        });
        return;
      }
      // (your own best plays: read from storage first when they're kept apart)
      if (msg.t === 'myBests') {
        const mu = this.presence.users.get(id);
        if (mu && mu.pid) { this.ensureBests(mu.pid).catch(() => {}).then(() => { if (this.presence.users.has(id)) this.send(this.presence.message(id, msg)); }); return; }
      }
      // (no beatmap for today yet: the server picks one, and everyone online gets it)
      if (msg.t === 'daily' && !this.presence.dailyNow().map) this.pickDaily({ retry: !!msg.retry });
      this.send(this.presence.message(id, msg));
    };
    const gone = () => { if (!joined) return; joined = false; this.socks.delete(id); this.send(this.presence.leave(id)); };
    if (server instanceof HttpSock) server.onclose = gone;
    return { message: data => { try { onMessage({ data }); } catch (e) { console.error('presence message', e); } }, gone,
      touch: () => { const u = joined && this.presence.users.get(id); if (u) u.seen = this.presence.now(); } };
  }
  /** Today's daily challenge beatmap, picked here — never by a player's game, which could pick any beatmap and say
   *  anything about it: a ranked 4K beatmap of 3.5–5.5 stars from osu!'s listing (in a random order, so it isn't always
   *  the same few), none of the last weeks'. Once at a time; after a failure, not again for a minute (or half that when
   *  a player asks again). `force`: a new one even if today has one (the server's owner, from the admin panel). */
  pickDaily({ force = false, retry = false } = {}) {
    const P = this.presence;
    if (P.dailyNow().map && !force) return Promise.resolve();
    if (this._picking) return this._picking;
    if (!force && this._pickFailedAt && Date.now() - this._pickFailedAt < (retry ? 30000 : 60000)) return Promise.resolve();
    return (this._picking = (async () => {
      const sorts = ['ranked_desc', 'plays_desc', 'favourites_desc', 'rating_desc', 'ranked_asc', 'title_asc', 'artist_desc'];
      const base = { m: '3', s: 'ranked', nsfw: 'false', q: 'stars>=3.5 stars<=5.5 key=4', sort: sorts[Math.floor(Math.random() * sorts.length)] };
      const cand = [];
      let cursor = null;
      for (let i = 0; i < 3 && cand.length < 80; i++) {
        const data = await beatmapListing({ ...base, ...(cursor ? { cursor_string: cursor } : {}) }, this.env);
        cand.push(...PresenceLogic.dailyCandidates(data, P.dailyNow().hist || []));
        if (!(cursor = data && data.cursor_string)) break;
      }
      if (!cand.length) throw new Error('The beatmap listing had no beatmap to choose from.');
      this._pickFailedAt = 0;
      this.send(P.setDailyMap(cand[Math.floor(Math.random() * cand.length)]));
    })().catch(e => {
      this._pickFailedAt = Date.now();
      P.dailyError = String((e && e.message) || 'The beatmap listing couldn\'t be reached.').slice(0, 200);
      this.send(P.dailyBroadcast());
    }).finally(() => { this._picking = null; }));
  }
  /** The server owner's admin panel (worker/admin.js), as /internal/admin/<action> — reached only through the Worker,
   *  after it has checked the panel's session: nothing from outside gets here (handleMultiplayer and handleAccount never
   *  pass /internal/ paths on). Every change goes in the admin log. */
  async admin(action, request) {
    await this.loadFriends();
    const P = this.presence, b = (await request.json().catch(() => null)) || {}, ip = request.headers.get('x-ip') || '';
    P.adminHash = adminCodeHash(this.env);
    const pid = /^[a-z0-9]{6,24}$/.test(String(b.pid || '')) ? String(b.pid) : '';
    // (an admin the owner made: their name goes in the log with what they did)
    const actorHdr = request.headers.get('x-admin-who') || 'owner';
    const log = (what, extra = {}) => {
      this.adminLog = [...(this.adminLog || []), { at: Date.now(), what, ip, ...(actorHdr !== 'owner' ? { by: P.adminRow(actorHdr).name || actorHdr } : {}), ...extra }].slice(-300);
      this.state.storage.put('adminLog', this.adminLog).catch(() => {});
    };
    const who = p => ({ pid: p, name: P.adminRow(p).name || p });
    const noPlayer = () => json({ error: 'No such player.' }, 400);
    // who's acting: the owner (their code is ADMIN_CODE), or an admin the owner made (their pid). Admins moderate players;
    // making and unmaking admins, wiping a player, the daily challenge and the log are the owner's — and nobody but the
    // owner acts on an admin
    const actor = actorHdr, owner = actor === 'owner';
    const PRE = new Set(['try', 'device', 'signedIn', 'staffCode', 'isStaff']);
    if (!PRE.has(action)) {
      if (!owner && !P.roles.has(actor)) return json({ error: 'You\'re not an admin any more.' }, 401);
      if (!owner && ['role', 'unrole', 'wipe', 'deletePlayer', 'revokeCode', 'dailyPick', 'dailySet', 'chatClear', 'log', 'roomClose', 'playlistDelete'].includes(action)) return json({ error: 'Only the owner can do that.' }, 403);
      if (!owner && pid && P.isStaff(pid) && ['ban', 'mute', 'rename', 'removeScore', 'wipe', 'warn', 'noAvatar'].includes(action)) return json({ error: 'Only the owner can do that to an admin.' }, 403);
    }

    const daily = () => { const d = P.dailyNow(); return { day: d.day, map: d.map, scores: d.scores.length, error: d.map ? null : P.dailyError, endsAt: PresenceLogic.dayEnd(d.day) }; };
    switch (action) {
      // signing in with the code: tries per address, and everyone's (the Worker compares the code itself)
      case 'try': return json({ ok: this.allowTry('adm:' + ip, 8) && this.allowTry('adm:all', 60) });
      // signing in from a device that plays as the owner (the game's own pid and key, read by the panel's page)
      case 'device': {
        const ok = !!pid && P.keyOk(pid, String(b.key || '')) && P.isStaff(pid);
        return json({ ok, who: ok ? (P.isAdmin(pid) ? 'owner' : pid) : null });
      }
      // signing in with an admin's own player code (one the owner made an admin): whose it is
      case 'staffCode': { const c = cleanPlayerCode(b.code), p = c ? P.codes.get(codeHash(c)) : null; return json({ pid: p && P.roles.has(p) ? p : null }); }
      case 'isStaff': return json({ ok: !!pid && P.roles.has(pid) });
      case 'signedIn': log('Signed in', { how: str(b.how, 20) }); return json({ ok: true });
      case 'overview': {
        for (const [c, r] of this.rooms) if (Date.now() - r.at > 40000) this.rooms.delete(c);
        const online = [...P.users.entries()].map(([id, u]) => ({ id, pid: u.pid, name: u.name, status: u.status, vis: u.vis, avatar: u.avatar,
          song: u.song ? { title: str(u.song.title, 120), artist: str(u.song.artist, 120), version: str(u.song.version, 120) } : null }));
        const live = m => [...m.keys()].filter(x => P.modOf(m === P.bans ? 'bn' : 'mu', x)).length;
        return json({ online, ranked: [...P.ranks.values()].filter(r => r.pp > 0).length, codes: P.codes.size, bans: live(P.bans), mutes: live(P.mutes),
          players: P.auth.size, playlists: [...P.playlists.values()].filter(p => p.ends > Date.now()).length, dailyScores: P.dailyNow().scores.length, deleted: P.deleted.size,
          rooms: [...this.rooms.values()].slice(0, 50), daily: daily(), chat: P.chat.slice(-100), log: owner ? (this.adminLog || []).slice(-15).reverse() : [], owner: P.adminHash ? P.codes.get(P.adminHash) || null : null,
          me: owner ? { owner: true } : { pid: actor, name: P.adminRow(actor).name, role: P.roles.get(actor) },
          staff: [...P.roles.keys()].map(x => P.adminRow(x)) });
      }
      case 'search': return json({ players: P.adminSearch(b.q) });
      case 'lists': return json(P.adminLists());
      // ── a player deleted: everything the server keeps of theirs, and their id for good (the owner's)
      case 'deletePlayer': {
        if (!pid) return noPlayer();
        if (P.isAdmin(pid)) return json({ error: 'That\'s you, the owner.' }, 400);
        if (P.roles.has(pid)) return json({ error: 'Take admin away from them first.' }, 400);
        if (P.deleted.has(pid)) return json({ error: 'Already deleted.' }, 400);
        const w = who(pid);
        await this.preloadPlayer(pid);
        const r = P.adminDelete(pid);
        this.send(r.out); setTimeout(() => this.closeGone(r.gone, 4003, 'deleted'), 300);
        // (their settings, skin and scores kept for their devices)
        if (this.env && this.env.VAULT) this.env.VAULT.get(this.env.VAULT.idFromName(pid)).fetch('https://vault/wipe', { method: 'POST' }).catch(() => {});
        log('Deleted a player', w);
        return json({ ok: true });
      }
      case 'warn': {
        if (!pid) return noPlayer();
        const out = P.adminWarn(pid, b.text);
        if (!str(b.text, 300).trim()) return json({ error: 'Write the message.' }, 400);
        if (!out.length) return json({ error: 'They\'re not online: a message reaches them only while they are.' }, 400);
        this.send(out); log('Sent a message', { ...who(pid), text: str(b.text, 300) });
        return json({ ok: true });
      }
      case 'noAvatar': {
        if (!pid) return noPlayer();
        const on = b.on !== false;
        this.send(P.adminNoAvatar(pid, on)); log(on ? 'Took a picture down' : 'Allowed pictures again', who(pid));
        return json({ ok: true });
      }
      case 'revokeCode': {
        if (!pid) return noPlayer();
        const out = P.adminRevokeCode(pid);
        if (!out) return json({ error: 'They have no code.' }, 400);
        this.send(out); log('Reset their code', who(pid));
        return json({ ok: true });
      }
      // ── rooms and playlists
      case 'roomClose': {
        const c = String(b.code || '').toUpperCase();
        if (!/^[A-Z0-9]{4,10}$/.test(c) || !this.env || !this.env.ROOMS) return json({ error: 'No such room.' }, 400);
        const r = await this.env.ROOMS.get(this.env.ROOMS.idFromName(c)).fetch(`https://room/close?code=${c}`, { method: 'POST' }).then(x => x.json()).catch(() => null);
        this.rooms.delete(c);
        if (!r || !r.ok) return json({ error: 'That room couldn\'t be closed (it may be empty already).' }, 400);
        log('Closed a room', { name: c, text: r.players ? `${r.players} player${r.players === 1 ? '' : 's'} sent back to the lounge` : '' });
        return json({ ok: true });
      }
      case 'playlists': return json({ playlists: [...P.playlists.values()].sort((a, b) => b.created - a.created).slice(0, 100).map(p => ({ ...P.plCard(p), open: p.ends > Date.now() })) });
      case 'playlistDelete': {
        const id = String(b.id || ''), pl = P.playlists.get(id);
        if (!pl) return json({ error: 'No such playlist.' }, 400);
        P.playlists.delete(id); this.state.storage.delete(`pl:${id}`).catch(() => {});
        log('Removed a playlist', { name: str(pl.name, 60), to: pl.host && pl.host.name });
        return json({ ok: true });
      }
      case 'role': {
        if (!pid) return noPlayer();
        const out = P.adminRole(pid, { name: b.name, colour: b.colour });
        if (!out) return json({ error: P.isAdmin(pid) ? 'That\'s you, the owner.' : 'Give the role a name.' }, 400);
        this.send(out); log('Made admin', { ...who(pid), to: P.roles.get(pid).name });
        return json({ ok: true });
      }
      case 'unrole': { if (!pid) return noPlayer(); this.send(P.adminUnrole(pid)); log('No longer admin', who(pid)); return json({ ok: true }); }
      case 'player': {
        if (!pid) return noPlayer();
        await this.ensureBests(pid);
        if (!P.profiles.has(pid)) { const v = await this.state.storage.get(`pf:${pid}`).catch(() => null); if (v && typeof v === 'object' && !P.profiles.has(pid)) P.profiles.set(pid, v); }
        return json({ player: { ...P.adminPlayer(pid), admin: P.isAdmin(pid) } });
      }
      case 'moderated': {
        const of = (m, kind) => [...m.keys()].filter(x => kind ? P.modOf(kind, x) : true).map(x => P.adminRow(x));
        return json({ bans: of(P.bans, 'bn'), mutes: of(P.mutes, 'mu'), names: [...P.names.keys()].filter(x => P.givenName(x)).map(x => P.adminRow(x)) });
      }
      case 'ban': {
        if (!pid) return noPlayer();
        if (P.isAdmin(pid)) return json({ error: 'That\'s you.' }, 400);
        const days = Math.max(0, Number(b.days) || 0), r = P.adminBan(pid, { days, reason: b.reason });
        this.send(r.out); setTimeout(() => this.closeGone(r.gone, 4003, 'banned'), 300);
        log('Banned', { ...who(pid), days, reason: str(b.reason, 200) });
        return json({ ok: true });
      }
      case 'unban': if (!pid) return noPlayer(); P.adminUnban(pid); log('Unbanned', who(pid)); return json({ ok: true });
      case 'mute': {
        if (!pid) return noPlayer();
        const minutes = Math.max(0, Number(b.minutes) || 0);
        this.send(P.adminMute(pid, { minutes, reason: b.reason }));
        log('Muted', { ...who(pid), minutes, reason: str(b.reason, 200) });
        return json({ ok: true });
      }
      case 'unmute': if (!pid) return noPlayer(); P.adminUnmute(pid); log('Unmuted', who(pid)); return json({ ok: true });
      case 'rename': {
        if (!pid) return noPlayer();
        const before = who(pid).name;
        this.send(P.adminRename(pid, b.name));
        log(str(b.name, 24).trim() ? 'Renamed' : 'Gave their own name back', { pid, name: before, to: str(b.name, 24).trim() });
        return json({ ok: true });
      }
      case 'chatDelete': {
        const at = Number(b.at) || 0, line = P.chat.find(l => l.at === at && ((l.from && l.from.pid) || '') === (pid || ''));
        this.send(P.adminChatDelete(at, pid));
        if (line) log('Deleted a chat line', { pid, name: line.from && line.from.name, text: str(line.text, 300) });
        return json({ ok: true });
      }
      case 'chatClear': this.send(P.adminChatClear()); log('Cleared #lobby'); return json({ ok: true });
      case 'announce': {
        const out = P.adminAnnounce(b.text);
        if (!out.length) return json({ error: 'Write something to announce.' }, 400);
        this.send(out); log('Announced', { text: str(b.text, 300) });
        return json({ ok: true });
      }
      case 'removeScore': {
        const key = PresenceLogic.lbKey(b.key);
        if (!pid || !key) return noPlayer();
        if (!P.boards.has(key)) { const v = await this.state.storage.get(`lb:${key}`).catch(() => null); if (!P.boards.has(key)) P.boards.set(key, rankedBoard(v)); }
        await this.ensureBests(pid);
        const best = P.ranks.get(pid) && P.ranks.get(pid).bests && P.ranks.get(pid).bests[key];
        P.adminRemoveScore(pid, key);
        log('Removed a score', { ...who(pid), map: best ? `${best.artist} - ${best.title} [${best.version}]` : key.slice(0, 12) });
        return json({ ok: true });
      }
      case 'wipe': {
        if (!pid) return noPlayer();
        const w = who(pid);
        await this.preloadPlayer(pid);
        P.adminWipe(pid);
        log('Wiped every score', w);
        return json({ ok: true });
      }
      case 'dailyPick': {
        await this.pickDaily({ force: true });
        const d = daily();
        log('Picked a new daily challenge beatmap', { map: d.map ? `${d.map.artist} - ${d.map.title} [${d.map.version}]` : '', error: d.error || undefined });
        return json({ ok: !!d.map && !d.error, daily: d, error: d.error || undefined });
      }
      case 'dailySet': {
        // a beatmap by its id (looked up on osu!), or — the tests — given whole
        let m = b.map && typeof b.map === 'object' && b.map.title ? b.map : null;
        const id = Math.floor(Number((b.map && b.map.onlineId) || b.id) || 0);
        if (!m) {
          if (!(id > 0)) return json({ error: 'Give a beatmap id (the number after # in its osu! address).' }, 400);
          let x; try { x = await beatmapInfo(id, this.env); } catch (e) { return json({ error: `osu! didn't find it: ${(e && e.message) || 'no answer'}` }, 400); }
          if (!x || !(x.mode === 'mania' || x.mode_int === 3)) return json({ error: 'That isn\'t an osu!mania beatmap.' }, 400);
          const set = x.beatmapset || {};
          m = { onlineSetId: x.beatmapset_id || set.id, onlineId: x.id, keys: Math.round(Number(x.cs)), title: set.title, artist: set.artist, version: x.version, creator: set.creator, stars: x.difficulty_rating, length: (Number(x.total_length) || 0) * 1000 };
        }
        const out = P.setDailyMap(m);
        if (!out.length && !P.dailyNow().map) return json({ error: 'That beatmap can\'t be the daily challenge.' }, 400);
        this.send(out);
        const d = daily();
        log('Set the daily challenge beatmap', { map: d.map ? `${d.map.artist} - ${d.map.title} [${d.map.version}]` : '' });
        return json({ ok: true, daily: d });
      }
      case 'log': return json({ log: (this.adminLog || []).slice().reverse() });
    }
    return json({ error: 'Not found' }, 404);
  }
  /** Player codes: code {pid, key} → a new code for this player (the old one stops working); link {code, pid, key} →
   *  this device becomes the code's player (a key of its own; the player it was goes into them); logout {pid, key} →
   *  this device's key stops working; others {pid, key} → every other device's does. Codes are tried a few times per
   *  address and only so often overall; a wrong one gets the same answer, after the same pause, as any other.
   *  ticket {pid, key} → a one-time ticket for the game saved as an HTML file on this device: link {ticket, pid, key}
   *  makes the device opening that file this player, once, within TICKET_MS, while their code is still the same.
   *  Their code isn't in the file as it is — only mixed with a pad that link hands back with the ticket — and the
   *  server keeps only the ticket's fingerprint. */
  async account(what, request) {
    await this.loadFriends();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'Bad request.' }, 400);
    const P = this.presence, ip = request.headers.get('x-ip') || '', pid = String(body.pid || ''), key = String(body.key || '');
    const mine = /^[a-z0-9]{6,24}$/.test(pid) && P.keyOk(pid, key);
    if (what === 'code') {
      // (every new player gets one in the first-run setup: a class setting up at once behind one school address has room;
      // the address is checked before anything is made or kept)
      if (!this.allowTry('ci:' + ip, 150)) return json({ error: 'Too many new codes. Try again in a few minutes.' }, 429);
      // (a player that's never been online yet claims its id first)
      if (!mine && !(/^[a-z0-9]{6,24}$/.test(pid) && !P.keyHashes(pid).length && P.claim(pid, key))) return json({ error: 'This device isn\'t signed in as that player.' }, 403);
      if (!this.allowTry('c:' + pid, 6)) return json({ error: 'Too many new codes. Try again in a few minutes.' }, 429);
      let code;
      do code = newPlayerCode(); while (P.codes.has(codeHash(code)));
      P.setCode(pid, codeHash(code));
      return json({ ok: true, code });
    }
    if (what === 'ticket') {
      if (!mine || !P.codeOf.has(pid)) return json({ error: 'Get your code first: the file signs in with it.' }, 403);
      if (!this.allowTry('tk:' + pid, 10)) return json({ error: 'Too many at once. Try again in a few minutes.' }, 429);
      // (tickets never used — a file saved and never opened — are cleared as new ones are made)
      const kept = await this.state.storage.list({ prefix: 'tk:', limit: 200 }).catch(() => new Map());
      for (const [k, v] of kept) if (!v || v.exp < Date.now()) await this.state.storage.delete(k).catch(() => {});
      const ticket = randomHex(16), pad = newPlayerCode();
      await this.state.storage.put(`tk:${codeHash(ticket)}`, { pid, ch: P.codeOf.get(pid), pad, exp: Date.now() + TICKET_MS });
      return json({ ok: true, ticket, pad });
    }
    if (what === 'link' && typeof body.ticket === 'string') {
      const t0 = Date.now(), ticket = body.ticket.slice(0, 64);
      const settle = async () => { const w = 400 - (Date.now() - t0); if (w > 0) await new Promise(r => setTimeout(r, w)); };
      if (this.triesOf('lw:' + ip) >= 10 || !this.allowTry('l:' + ip, 100)) { await settle(); return json({ error: 'Too many codes tried from here. Wait a few minutes and try again.' }, 429); }
      const at = `tk:${codeHash(ticket)}`, t = /^[0-9a-f]{32}$/.test(ticket) ? await this.state.storage.get(at).catch(() => null) : null;
      if (t) await this.state.storage.delete(at).catch(() => {}); // (once only, whatever comes of it)
      // (gone, used, out of date, or the player has had a new code since)
      if (!t || t.exp < Date.now() || P.codeOf.get(t.pid) !== t.ch) { this.allowTry('lw:' + ip, 1e9); await settle(); return json({ error: 'This file\'s sign-in has run out. Type your code to play as yourself here.' }, 401); }
      if (/^[a-z0-9]{6,24}$/.test(pid) && pid !== t.pid && P.keyOk(pid, key)) await Promise.all([this.preloadPlayer(pid), this.preloadPlayer(t.pid, false)]);
      else await this.preloadPlayer(t.pid, false);
      const newKey = randomHex(32), r = P.linkDevice(t.pid, pid, key, newKey);
      this.send(r.out);
      if (r.merged && pid !== r.pid && this.env && this.env.VAULT) this.env.VAULT.get(this.env.VAULT.idFromName(pid)).fetch('https://vault/wipe', { method: 'POST' }).catch(() => {});
      await settle();
      return json({ ok: true, pid: r.pid, key: newKey, name: r.name, merged: r.merged, pad: t.pad });
    }
    if (what === 'link') {
      const t0 = Date.now(), c = cleanPlayerCode(body.code);
      const settle = async () => { const w = 400 - (Date.now() - t0); if (w > 0) await new Promise(r => setTimeout(r, w)); }; // (every answer takes as long)
      // (wrong codes are what's limited per address — 10 every 10 minutes; right ones, a class's returning players behind
      // one school address, have room for 100)
      if (this.triesOf('lw:' + ip) >= 10 || !this.allowTry('l:' + ip, 100)) { await settle(); return json({ error: 'Too many codes tried from here. Wait a few minutes and try again.' }, 429); }
      const target = c ? P.codes.get(codeHash(c)) : null;
      if (!target) {
        this.allowTry('lw:' + ip, 1e9);
        // (wrong codes count against everyone too: spread over many addresses, guessing still gets nowhere)
        if (!this.allowTry('l:all', 2000)) { await settle(); return json({ error: 'Too many wrong codes have been tried. Try again later.' }, 429); }
        await settle();
        return json({ error: c ? 'That code doesn\'t belong to anyone. Check it and try again.' : 'A code is 16 letters and numbers, like K7QM-3XRA-9DPZ-W2HF.' }, c ? 401 : 400);
      }
      if (/^[a-z0-9]{6,24}$/.test(pid) && pid !== target && P.keyOk(pid, key)) await Promise.all([this.preloadPlayer(pid), this.preloadPlayer(target, false)]);
      else await this.preloadPlayer(target, false);
      const newKey = randomHex(32), r = P.linkDevice(target, pid, key, newKey);
      this.send(r.out);
      // (the player this device was is part of the code's player now: their own settings and skin aren't kept)
      if (r.merged && pid !== r.pid && this.env && this.env.VAULT) this.env.VAULT.get(this.env.VAULT.idFromName(pid)).fetch('https://vault/wipe', { method: 'POST' }).catch(() => {});
      await settle();
      return json({ ok: true, pid: r.pid, key: newKey, name: r.name, merged: r.merged });
    }
    if (what === 'logout') {
      if (mine) P.dropKey(pid, key);
      return json({ ok: true });
    }
    if (what === 'others') {
      if (!mine) return json({ error: 'This device isn\'t signed in as that player.' }, 403);
      // (an HTML file saved with a sign-in in it, not opened yet: that's shut out too)
      const kept = await this.state.storage.list({ prefix: 'tk:' }).catch(() => new Map());
      for (const [k, v] of kept) if (v && (v.pid === pid || v.exp < Date.now())) await this.state.storage.delete(k).catch(() => {});
      const r = P.onlyKey(pid, key);
      this.send(r.out);
      setTimeout(() => this.closeGone(r.gone), 200); // (after they've been told)
      return json({ ok: true, n: r.n });
    }
    return json({ error: 'Not found' }, 404);
  }
  /** Before a player's settings or skin are kept or handed out (PlayerVault): is this device that player? Keeping
   *  them is for players with a code (only they can bring them to another device); each is limited per player. */
  async vaultAuth(request) {
    await this.loadFriends();
    const b = await request.json().catch(() => ({})), P = this.presence, pid = String(b.pid || ''), what = String(b.what || '');
    const limit = { settings: 60, 'skin-up': 6, restore: 120, skin: 10, 'scores-up': 60, scores: 120 }[what];
    if (!limit) return json({ error: 'Not found' }, 404);
    if (!/^[a-z0-9]{6,24}$/.test(pid) || !P.keyOk(pid, String(b.key || ''))) return json({ error: 'This device isn\'t signed in as that player.' }, 403);
    if ((what === 'settings' || what === 'skin-up' || what === 'scores-up') && !P.codeOf.has(pid)) return json({ error: 'Get your code first: your settings are kept for the devices that use it.' }, 403);
    if (!this.allowTry(`v:${what}:${pid}`, limit)) return json({ error: 'Too many at once. Try again in a few minutes.' }, 429);
    return json({ ok: true });
  }
  /** How many tries this key has had in the last 10 minutes (without counting one). */
  triesOf(k) { const t = Date.now(), list = (this._tries && this._tries.get(k)) || []; return list.filter(x => t - x < 600000).length; }
  /** At most `n` tries per 10 minutes for this key (an address, a player, or everyone). */
  allowTry(k, n) {
    const t = Date.now(), m = this._tries || (this._tries = new Map());
    // (too many keys: the ones not used for 10 minutes go — never all of them, which reset every limit at once)
    if (m.size > 20000) { for (const [key, list] of m) if (!list.length || t - list[list.length - 1] >= 600000) m.delete(key); if (m.size > 20000) for (const key of [...m.keys()].slice(0, 5000)) if (!/^(l|lw|ci):/.test(key)) m.delete(key); }
    const list = (m.get(k) || []).filter(x => t - x < 600000);
    if (list.length >= n) { m.set(k, list); return false; }
    list.push(t); m.set(k, list);
    return true;
  }
  /** What has to be in memory before a player is merged into another (PresenceLogic.mergePlayer): their best plays,
   *  their profile, and — `all` — every beatmap board and tag list they're on (kept in storage, read only when asked
   *  for: all of them are looked through once). */
  async preloadPlayer(pid, all = true) {
    const st = this.state.storage, P = this.presence;
    await this.ensureBests(pid);
    if (!P.profiles.has(pid)) { const v = await st.get(`pf:${pid}`).catch(() => null); if (v && typeof v === 'object' && !P.profiles.has(pid)) P.profiles.set(pid, v); }
    if (!all) return;
    for (const [prefix, map] of [['lb:', P.boards], ['tg:', P.tags]]) {
      let after = null;
      for (;;) {
        const page = await st.list({ prefix, limit: 256, ...(after ? { startAfter: after } : {}) }).catch(() => new Map());
        for (const [k, v] of page) {
          after = k;
          const on = prefix === 'lb:' ? Array.isArray(v) && v.some(x => x && x.pid === pid) : v && typeof v === 'object' && Object.values(v).some(x => Array.isArray(x) && x.includes(pid));
          if (on && !map.has(k.slice(3))) map.set(k.slice(3), v);
        }
        if (page.size < 256) break;
      }
    }
  }
  /** A finished play, to be judged here: { pid, key, osu (the beatmap file, base64), play: { mods, modConfig, seed,
   *  events }, daily? }. The file's SHA-256 is the beatmap's id; verifyPlay plays the key presses through the game's
   *  judging and works the score out; that score — never the player's own — goes on the boards and rankings. */
  async score(request) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !body.r || typeof body.r !== 'object') return json({ error: 'Bad request.' }, 400);
    await this.loadFriends();
    const pid = String(body.pid || '');
    if (!/^[a-z0-9]{6,24}$/.test(pid) || !this.presence.keyOk(pid, body.key)) return json({ error: 'Not signed in as that player.' }, 403);
    if (this.presence.isBanned(pid)) return json({ error: 'You\'re banned from online play.' }, 403);
    const t = Date.now(), last = (this._lastScore || (this._lastScore = new Map())).get(pid) || 0;
    if (t - last < 3000) return json({ error: 'Too many scores at once.' }, 429);
    this._lastScore.set(pid, t);
    const key = String(body.hash || ''), r = body.r;
    if (!/^[a-f0-9]{64}$/.test(key)) return json({ error: 'Bad beatmap file.' }, 400);
    if (r.error) return json({ error: r.error }, 422);
    // (a play sent again from before an admin took it off — the game catching up, one at a time — stays off)
    const gone = this.presence.removedAt(pid, key);
    if (gone && body.date != null && !(Number(body.date) > gone)) return json({ error: 'Taken off by an admin.', removed: true }, 422);
    if (!this.presence.boards.has(key)) { const v = await this.state.storage.get(`lb:${key}`).catch(() => null); if (!this.presence.boards.has(key)) this.presence.boards.set(key, rankedBoard(v)); }
    const daily = body.daily && typeof body.daily === 'object' ? { day: String(body.daily.day || '') } : null;
    const playlist = body.playlist && typeof body.playlist === 'object' ? { id: String(body.playlist.id || '').slice(0, 12) } : null;
    await this.ensureBests(pid);
    const { out, entry, total, rank, of, best, daily: dailyRes } = this.presence.recordVerified(pid, key, r, { daily, playlist });
    this.send(out);
    return json({ ok: true, key, score: entry.score, accuracy: entry.acc, combo: entry.combo, grade: entry.grade, pp: entry.pp, stars: entry.stars, total, rank, of, best, daily: dailyRes });
  }
  /** Several plays of one player's at once (the game catching up on best plays the server doesn't have): { pid, key,
   *  items: [{ hash, r }] } — each onto the boards and into their best plays as score() puts one. */
  async scores(request) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) return json({ error: 'Bad request.' }, 400);
    await this.loadFriends();
    const pid = String(body.pid || '');
    if (!/^[a-z0-9]{6,24}$/.test(pid) || !this.presence.keyOk(pid, body.key)) return json({ error: 'Not signed in as that player.' }, 403);
    if (this.presence.isBanned(pid)) return json({ error: 'You\'re banned from online play.' }, 403);
    const t = Date.now(), last = (this._lastBatch || (this._lastBatch = new Map())).get(pid) || 0;
    if (t - last < 3000) return json({ error: 'Too many scores at once.' }, 429);
    this._lastBatch.set(pid, t);
    await this.ensureBests(pid);
    const out = [], results = [];
    for (const it of body.items.slice(0, 25)) {
      const key = String((it && it.hash) || ''), r = it && it.r;
      if (!r || typeof r !== 'object' || r.error || !/^[a-f0-9]{64}$/.test(key)) { results.push({ key, error: (r && r.error) || 'Bad beatmap file.' }); continue; }
      // (taken off by an admin: not back from the player's own game — a play made since is another matter)
      const gone = this.presence.removedAt(pid, key);
      if (gone && !(Number(it.date) > gone)) { results.push({ key, error: 'Taken off by an admin.', removed: true }); continue; }
      if (!this.presence.boards.has(key)) { const v = await this.state.storage.get(`lb:${key}`).catch(() => null); if (!this.presence.boards.has(key)) this.presence.boards.set(key, rankedBoard(v)); }
      const got = this.presence.recordVerified(pid, key, r, {});
      out.push(...got.out);
      results.push({ key, ok: true, pp: got.entry.pp });
    }
    this.send(out);
    return json({ ok: true, results });
  }
  /** Friends and friend requests live in this object's storage (fr:<pid>, fq:<pid>), loaded once before anyone connects. */
  async loadFriends() {
    if (this._friendsLoaded) return this._friendsLoaded;
    return (this._friendsLoaded = (async () => {
      const st = this.state.storage, fr = {}, fq = {};
      try {
        for (const [k, v] of await st.list({ prefix: 'fr:' })) fr[k.slice(3)] = v;
        for (const [k, v] of await st.list({ prefix: 'fq:' })) fq[k.slice(3)] = v;
        const rk = {}; for (const [k, v] of await st.list({ prefix: 'rk:' })) rk[k.slice(3)] = v;
        const au = {}; for (const [k, v] of await st.list({ prefix: 'au:' })) au[k.slice(3)] = v;
        this.presence.loadAuth(au);
        const mg = {}; for (const [k, v] of await st.list({ prefix: 'mg:' })) mg[k.slice(3)] = v;
        this.presence.loadMerged(mg);
        const cd = {}; for (const [k, v] of await st.list({ prefix: 'cd:' })) cd[k.slice(3)] = v;
        this.presence.loadCodes(cd);
        const po = {}; for (const [k, v] of await st.list({ prefix: 'po:' })) po[k.slice(3)] = v;
        this.presence.loadPlayOwners(po);
        this.presence.loadRanks(rk);
        const ds = {}; for (const [k, v] of await st.list({ prefix: 'ds:' })) ds[k.slice(3)] = v;
        this.presence.loadDailyStats(ds);
        const f1 = {}; for (const [k, v] of await st.list({ prefix: 'f1:' })) f1[k.slice(3)] = v;
        this.presence.loadFirsts(f1);
        for (const [k, v] of await st.list({ prefix: 'tomb:' })) if (v && typeof v === 'object') this.presence.tombs.set(k.slice(5), v);
        const pl = {}, plOld = [];
        for (const [k, v] of await st.list({ prefix: 'pl:' })) { if (v && Date.now() - (v.ends || 0) >= PresenceLogic.PL_KEEP) plOld.push(k); else pl[k.slice(3)] = v; }
        if (plOld.length) st.delete(plOld.slice(0, 128)).catch(() => {}); // (long-closed playlists go for good)
        this.presence.loadPlaylists(pl);
        const dc = await st.get('daily'); if (dc && typeof dc === 'object' && Array.isArray(dc.scores)) this.presence.daily = dc;
        // (#lobby's last lines outlive the server restarting: it used to come back empty, and wiped everyone's chat)
        for (const [k, v] of await st.list({ prefix: 'ls:' })) if (typeof v === 'number') this.presence.seen.set(k.slice(3), v);
        const ch = await st.get('chat'); if (Array.isArray(ch)) this.presence.chat = ch.slice(-PresenceLogic.CHAT_KEEP);
        const mod = { bans: {}, mutes: {}, names: {} };
        for (const [k, v] of await st.list({ prefix: 'bn:' })) mod.bans[k.slice(3)] = v;
        for (const [k, v] of await st.list({ prefix: 'mu:' })) mod.mutes[k.slice(3)] = v;
        for (const [k, v] of await st.list({ prefix: 'nm:' })) mod.names[k.slice(3)] = v;
        mod.roles = {}; for (const [k, v] of await st.list({ prefix: 'rl:' })) mod.roles[k.slice(3)] = v;
        mod.deleted = [...(await st.list({ prefix: 'dl:' })).keys()].map(k => k.slice(3));
        mod.noAvatar = [...(await st.list({ prefix: 'na:' })).keys()].map(k => k.slice(3));
        this.presence.loadMod(mod);
        const al = await st.get('adminLog'); this.adminLog = Array.isArray(al) ? al : [];
      } catch (e) {
        this._friendsLoaded = null; // (tried again with the next request)
        throw new Error('The game\'s server couldn\'t read its players just now. Try again in a moment.');
      }
      this.presence.load(fr, fq);
      // (a player's totals and their best plays are kept apart: the totals load with the server, the plays when needed)
      this.presence.persistRank = (pid, r) => { const { bests, _lazy, ...rest } = r; st.put(`rk:${pid}`, { ...rest, sb: 1 }).catch(() => {}); if (bests) st.put(`rb:${pid}`, bests).catch(() => {}); r.sb = 1; };
      // records from before that: split a few at a time, in the background
      const inline = [...this.presence.ranks].filter(([, r]) => !r.sb && r.bests).map(([pid]) => pid);
      const split = () => { for (const pid of inline.splice(0, 20)) { const r = this.presence.ranks.get(pid); if (r && !r.sb) this.presence.persistRank(pid, r); } if (inline.length) setTimeout(split, 500); };
      if (inline.length) setTimeout(split, 3000);
      for (const [pid, r] of this.presence.ranks) if (r.reset) { delete r.reset; this.presence.persistRank(pid, r); }
      this.presence.verifyTop = (pid, top, who) => { this.verifyTop(pid, top, who).catch(e => console.error('verifyTop', e)); };
      this.presence.verifyBests = pid => { this.verifyBests(pid).catch(e => console.error('verifyBests', e)); };
      this.restoreRanks().catch(e => console.error('restoreRanks', e));
      // (records whose plays weren't loaded when the way totals are added up changed: worked out again, a few at a time)
      const rew = [...this.presence.ranks].filter(([, r]) => r.rew).map(([pid]) => pid);
      const revalue = async () => { for (const pid of rew.splice(0, 10)) { const r = this.presence.ranks.get(pid); if (!r) continue; await this.ensureBests(pid); delete r.rew; PresenceLogic.revalue(r); this.presence.persistRank(pid, r); } if (rew.length) setTimeout(() => revalue().catch(() => {}), 500); };
      if (rew.length) setTimeout(() => revalue().catch(() => {}), 2000);
      this.presence.persistMerged = (pid, to) => { st.put(`mg:${pid}`, to).catch(() => {}); };
      this.presence.persistAuth = (pid, h) => { (Array.isArray(h) && !h.length ? st.delete(`au:${pid}`) : st.put(`au:${pid}`, h)).catch(() => {}); };
      this.presence.persistPlayOwner = (fp, pid) => { st.put(`po:${fp}`, pid).catch(() => {}); };
      this.presence.persistCode = (hash, pid, old) => { if (hash) st.put(`cd:${hash}`, { pid, at: Date.now() }).catch(() => {}); if (old) st.delete(`cd:${old}`).catch(() => {}); };
      // (a player merged into an account: what was kept under their old id goes)
      this.presence.dropPlayer = (pid, what) => {
        const keys = { rank: [`rk:${pid}`, `rb:${pid}`], daily: [`ds:${pid}`], profile: [`pf:${pid}`], seen: [`ls:${pid}`], auth: [`au:${pid}`], tomb: [`tomb:${pid}`] }[what];
        if (keys) st.delete(keys).catch(() => {});
      };
      this.presence.persistDaily = d => { st.put('daily', d).catch(() => {}); };
      this.presence.persistSeen = (pid, t) => { st.put(`ls:${pid}`, t).catch(() => {}); };
      // (written at most every couple of seconds however busy the lobby is)
      this.presence.persistChat = c => { if (this._chatT) return; this._chatT = setTimeout(() => { this._chatT = null; st.put('chat', this.presence.chat).catch(() => {}); }, 2000); };
      // (once: the first places on boards set before they were kept — each board's #1, named from their best there;
      //  a few boards at a time, a little apart, so it never holds the server up)
      const backfill = async () => {
        const state = await st.get('f1v1').catch(() => true);
        if (state === true) return;
        const P = this.presence, opts = { prefix: 'lb:', limit: 25 };
        if (typeof state === 'string') opts.startAfter = state;
        const page = await st.list(opts);
        let last = null;
        for (const [k, list] of page) {
          last = k;
          const top = Array.isArray(list) && list[0], key = k.slice(3);
          if (!top || !top.pid) continue;
          const cur = P.firsts.get(top.pid) || {};
          if (cur[key]) continue;
          await this.ensureBests(top.pid);
          const b = P.ranks.get(top.pid) && P.ranks.get(top.pid).bests && P.ranks.get(top.pid).bests[key];
          cur[key] = { score: top.score, acc: top.acc, grade: top.grade, mods: top.mods || [], combo: top.combo, pp: top.pp, date: top.date, stars: top.stars,
            title: b ? b.title : '', artist: b ? b.artist : '', version: b ? b.version : '' };
          P.firsts.set(top.pid, cur); st.put(`f1:${top.pid}`, cur).catch(() => {});
        }
        if (page.size < 25 || !last) { st.put('f1v1', true).catch(() => {}); return; }
        await st.put('f1v1', last);
        setTimeout(() => backfill().catch(() => {}), 2000);
      };
      setTimeout(() => backfill().catch(() => {}), 5000);
      this.presence.persistTags = (key, v) => { (Object.keys(v).length ? st.put(`tg:${key}`, v) : st.delete(`tg:${key}`)).catch(() => {}); };
      this.presence.persistTomb = (pid, t) => { st.put(`tomb:${pid}`, t).catch(() => {}); };
      this.presence.persistFirsts = (pid, m) => { (Object.keys(m).length ? st.put(`f1:${pid}`, m) : st.delete(`f1:${pid}`)).catch(() => {}); };
      this.presence.persistPlaylist = p => { st.put(`pl:${p.id}`, p).catch(() => {}); };
      this.presence.persistBoardId = (bid, key) => { this._bidMiss && this._bidMiss.delete(bid); st.put(`lbid:${bid}`, key).catch(() => {}); };
      this.presence.persistDailyStats = (pid, v) => { st.put(`ds:${pid}`, v).catch(() => {}); };
      this.presence.persistBoard = (key, list) => { st.put(`lb:${key}`, list).catch(() => {}); };
      this.presence.persistProfile = (pid, data) => { st.put(`pf:${pid}`, data).catch(() => {}); };
      this.presence.persist = (kind, pid, list) => { (list.length ? st.put(`${kind}:${pid}`, list) : st.delete(`${kind}:${pid}`)).catch(() => {}); };
      this.presence.persistMod = (kind, pid, v) => { (v == null ? st.delete(`${kind}:${pid}`) : st.put(`${kind}:${pid}`, v)).catch(() => {}); };
      this.presence.adminHash = adminCodeHash(this.env);
    })());
  }
  /** osu! API answers kept in this object's storage (like WOM's KV cache), so they outlive a restart: the newest 300. */
  osuStore() {
    const st = this.state.storage, IDX = 'osuCacheIndex', MAX = 300;
    return {
      get: k => st.get('osu:' + k).catch(() => null),
      put: async (k, e) => {
        if (k.length > 1500) return; // (storage keys are limited to 2 KB)
        try {
          const idx = [k, ...((await st.get(IDX)) || []).filter(x => x !== k)];
          const gone = idx.splice(MAX);
          await st.put({ ['osu:' + k]: e, [IDX]: idx });
          if (gone.length) await st.delete(gone.map(x => 'osu:' + x));
        } catch { /* storage full or unavailable: the in-memory answers still work */ }
      },
    };
  }
  /** A player's best plays, read from storage the first time they're needed. */
  async ensureBests(pid) {
    const r = this.presence.ranks.get(pid);
    if (!r || !r._lazy || r.bests) return;
    let b;
    try { b = await this.state.storage.get(`rb:${pid}`); } catch (e) { throw new Error('Couldn\'t read the player\'s best plays just now.'); }
    if (!r.bests) { r.bests = b && typeof b === 'object' ? b : {}; PresenceLogic.dropUnranked(r); }
    delete r._lazy;
  }
  /** Players whose standing started over (or who never had one) and aren't online to re-report it: their standing
   *  from the best plays their profile lists, counting only those on ranked beatmaps — the profile says so, or (shared
   *  by an older game) the song is looked up on osu! by its artist, title and difficulty name. Once per player. */
  /** Whether a play on a player's profile is on a ranked (or approved) beatmap — asked of osu! by the beatmap's id, else
   *  its set's, else (shared by an older game) by its artist, title and difficulty name; what the game itself says
   *  about it isn't taken on trust. Answers are kept (and osu!'s replies cached a week). null: not looked up this time. */
  async rankedEntry(x, budget) {
    const statusOf = this._statusOf || (this._statusOf = new Map());
    const id = +x.onlineId > 0 ? `b${+x.onlineId}` : +x.onlineSetId > 0 ? `s${+x.onlineSetId}` : `${x.artist}|${x.title}|${x.version}|${x.creator || ''}`.toLowerCase();
    if (!statusOf.has(id)) {
      if (budget && budget.n-- <= 0) return null;
      if (!x.title && !(+x.onlineId > 0) && !(+x.onlineSetId > 0)) return false;
      let found = '';
      try {
        if (+x.onlineId > 0) { const b = await officialGet(`beatmaps/${+x.onlineId}`, this.env, fetch, 7 * 86400000); found = String((b && b.beatmapset && b.beatmapset.status) || (b && b.status) || ''); }
        else if (+x.onlineSetId > 0) { const d = await officialGet(`beatmapsets/${+x.onlineSetId}`, this.env, fetch, 7 * 86400000); found = String((d && d.status) || ''); }
        else {
          const q = encodeURIComponent(`${x.artist || ''} ${x.title}`.trim().slice(0, 200));
          const d = await officialGet(`beatmapsets/search?q=${q}&m=3&s=any`, this.env, fetch, 7 * 86400000);
          const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
          const sets = (d && d.beatmapsets) || [];
          const hit = sets.find(b => same(b.title, x.title) && same(b.artist, x.artist) && (b.beatmaps || []).some(m => same(m.version, x.version)) && (!x.creator || same(b.creator, x.creator)))
            || sets.find(b => same(b.title, x.title) && (b.beatmaps || []).some(m => same(m.version, x.version)));
          found = hit ? String(hit.status || '') : '';
        }
      } catch (e) { if (!(e && e.status === 404)) return null; } // (osu! has no such beatmap: not ranked; anything else: asked again later)
      statusOf.set(id, found);
    }
    const v = statusOf.get(id);
    // (osu! had nothing to match it: not ranked — what the game itself says isn't taken on trust, or a made-up play
    // would count)
    return v === 'ranked' || v === 'approved';
  }
  /** A player's best plays the server judged, each checked once against osu! (see rankedEntry): one on a beatmap that
   *  isn't ranked or approved — judged before every play was checked first, or kept from an older game — stops counting
   *  (0pp, and not in the bonus), so the total only ever adds up ranked plays. At most every ten minutes a player. */
  async verifyBests(pid) {
    if (!this._vb) this._vb = new Map();
    if (Date.now() - (this._vb.get(pid) || 0) < 600000) return;
    this._vb.set(pid, Date.now());
    await this.ensureBests(pid);
    const P = this.presence, rec = P.ranks.get(pid);
    if (!rec || !rec.bests) return;
    const todo = Object.entries(rec.bests).filter(([, b]) => b && b.pp > 0 && b.ok !== true);
    if (!todo.length) return;
    // (the beatmap's id on osu!, where its leaderboard has one)
    const idOf = new Map();
    for (const [bid, key] of P.boardIds) idOf.set(key, bid);
    const budget = { n: 60 };
    let changed = false;
    for (const [key, b] of todo) {
      const f = await this.rankedEntry({ onlineId: idOf.get(key) || 0, onlineSetId: b.sid || 0, artist: b.artist, title: b.title, version: b.version }, budget);
      if (f === null) continue; // (not looked up this time: checked again later)
      changed = true;
      if (f) b.ok = true;
      else { b.pp = 0; b.ok = false; if (Array.isArray(rec.rk)) rec.rk = rec.rk.filter(x => x !== key.slice(0, 10)); }
    }
    if (!changed) return;
    PresenceLogic.revalue(rec);
    if (P.persistRank) P.persistRank(pid, rec);
  }
  /** A player's profile plays, checked (see rankedEntry): their standing from the ones on ranked beatmaps. */
  async verifyTop(pid, top, who = {}) {
    if (!this._vt) this._vt = new Map();
    const last = this._vt.get(pid) || 0;
    if (Date.now() - last < 30000) { this._vtNext = this._vtNext || new Map(); this._vtNext.set(pid, { top, who }); return; } // (at most every 30s each)
    this._vt.set(pid, Date.now());
    const budget = { n: 60 };
    const flags = await Promise.all(top.map(x => x && typeof x === 'object' ? this.rankedEntry(x, budget) : false));
    // (a lookup that couldn't be done now: their standing stays as it is, and it's tried again in a minute)
    if (flags.some(f => f === null)) { this._vt.delete(pid); setTimeout(() => this.verifyTop(pid, top, who).catch(() => {}), 60000); return; }
    const P = this.presence, rep = PresenceLogic.rankFromTop(top.filter((x, i) => flags[i] === true), () => true);
    let rec = P.ranks.get(pid);
    if (!rec && !rep) return;
    if (!rec && !P.keyHashes(pid).length) return; // (merged into another player while osu! was asked: gone)
    if (!rec) { rec = { pid, name: who.name || 'Player', avatar: who.avatar || '', plays: 0, bests: {}, pol: PresenceLogic.RANK_POLICY }; P.ranks.set(pid, rec); }
    rec.rep = rep || { pp: 0, acc: 0, ss: 0, s: 0, a: 0 };
    rec.okh = PresenceLogic.okIds(top, flags);
    PresenceLogic.settleRank(rec);
    if (P.persistRank) P.persistRank(pid, rec);
    const next = this._vtNext && this._vtNext.get(pid);
    if (next) { this._vtNext.delete(pid); setTimeout(() => this.verifyTop(pid, next.top, next.who).catch(() => {}), 30000); }
  }
  /** Players who aren't online to send their profile: their standing from the best plays it lists, checked the same
   *  way. Once per player for each change of the rules (rr2: only plays checked to be ranked, lazer's weighting). */
  async restoreRanks() {
    const st = this.state.storage, P = this.presence;
    const budget = { n: 300 };
    const ranked = x => this.rankedEntry(x, budget);
    // (a few profiles at a time, a little apart, so it never holds the server up; once for each change of the rules)
    const state = await st.get('rr4').catch(() => null);
    if (state === true) return;
    const opts = { prefix: 'pf:', limit: 20 };
    if (typeof state === 'string') opts.startAfter = state;
    const page = await st.list(opts);
    let done = typeof state === 'string' ? state : null, deferred = false; // (done: the last profile fully dealt with)
    for (const [k, data] of page) {
      const pid = k.slice(3), rec = P.ranks.get(pid);
      // (only the plays that are theirs: a copy of someone else's — an imported backup — is left out)
      const mine = data && typeof data === 'object' && Array.isArray(data.top) ? P.ownPlays(pid, data.top.slice(0, 50)) : [];
      if (mine.length || (rec && rec.rep && rec.rep.pp > 0)) {
        const flags = await Promise.all(mine.map(x => x && typeof x === 'object' ? ranked(x) : false));
        // (lookups used up or failing: this player's standing stays as it is, and they're checked again next round)
        if (flags.some(f => f === null)) { deferred = true; break; }
        const rep = PresenceLogic.rankFromTop(mine.filter((x, i) => flags[i] === true), () => true);
        if (rec || (rep && P.keyHashes(pid).length)) { // (a player merged into another has no keys: not brought back)
          const r = rec || { pid, name: String(data.name || 'Player').slice(0, 40), avatar: '', plays: Number(data.plays) || 0, bests: {}, pol: PresenceLogic.RANK_POLICY };
          r.restored = true;
          r.rep = rep || { pp: 0, acc: 0, ss: 0, s: 0, a: 0 };
          r.okh = PresenceLogic.okIds(mine, flags);
          PresenceLogic.settleRank(r);
          P.ranks.set(pid, r);
          if (P.persistRank) P.persistRank(pid, r);
        }
      }
      done = k;
    }
    if (done) await st.put('rr4', done);
    // (this round's osu! lookups used up: carry on in a minute with a fresh allowance — not at the next restart)
    if (deferred) { setTimeout(() => this.restoreRanks().catch(e => console.error('restoreRanks', e)), 60000); return; }
    if (page.size < 20) { st.put('rr4', true).catch(() => {}); return; }
    setTimeout(() => this.restoreRanks().catch(e => console.error('restoreRanks', e)), 1500);
  }
  closeGone(ids, code = 4001, why = 'replaced') { for (const id of ids || []) { const ws = this.socks.get(id); this.socks.delete(id); if (ws) { try { ws.close(code, why); } catch { /* closed */ } } } }
  send(out) {
    for (const { to, msg } of out || []) {
      const data = JSON.stringify(msg);
      for (const [id, ws] of this.socks) if (to === 'all' || to === id) { try { ws.send(data); } catch { /* closing */ } }
    }
  }
  async fetch(request) {
    const url = new URL(request.url);
    // the shared osu! API client (its own instance, "osu-api"): one login, cache and back-off for the whole server
    if (url.pathname === '/osu/get' || url.pathname === '/osu/state') {
      if (!this._osuLoaded) { this._osuLoaded = true; osuLoginState.set(await this.state.storage.get('osuLogin').catch(() => null)); osuApi.store = this.osuStore(); }
      const save = () => {
        const st = JSON.stringify(osuLoginState.get());
        if (st !== this._osuSaved) { this._osuSaved = st; this.state.storage.put('osuLogin', JSON.parse(st)).catch(() => {}); }
      };
      if (url.pathname === '/osu/state') return json(osuStatus());
      try { const d = await officialGet(url.searchParams.get('path') || '', this.env, fetch, Number(url.searchParams.get('ttl')) || undefined); save(); return json(d); }
      catch (e) { save(); return json({ error: e.message }, e.status || 500); }
    }
    // (a network that won't let a WebSocket through: the online connection by plain requests — HttpSock)
    if (url.pathname.endsWith('/presence/http') && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object') return json({ error: 'Bad request.' }, 400);
      await this.loadFriends();
      return json(await httpSession(this.http || (this.http = new Map()), body, sock => this.presenceAttach(sock)));
    }
    if (url.pathname.endsWith('/presence')) {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ online: this.presence.list().length });
      await this.loadFriends();
      return this.presenceSocket();
    }
    if (url.pathname === '/judged-score' && request.method === 'POST') return this.score(request);
    if (url.pathname === '/judged-scores' && request.method === 'POST') return this.scores(request);
    if (url.pathname.startsWith('/internal/admin/') && request.method === 'POST') return this.admin(url.pathname.slice(16), request);
    // (a player's kept settings or plays changed: their other devices online fetch them — not the one that sent them)
    if (url.pathname === '/internal/synced' && request.method === 'POST') {
      const b = await request.json().catch(() => ({})), pid = String(b.pid || ''), kh = b.key ? sha256hex(String(b.key)) : '';
      const part = b.part === 'scores' ? 'scores' : 'settings';
      this.send([...this.presence.users.entries()].filter(([, u]) => u.pid && u.pid === pid && u.kh !== kh).map(([id]) => ({ to: id, msg: { t: 'synced', part } })));
      return json({ ok: true });
    }
    if (url.pathname.startsWith('/api/account/') && request.method === 'POST') return this.account(url.pathname.slice(13), request);
    if (url.pathname === '/vault-auth' && request.method === 'POST') return this.vaultAuth(request);
    // (8: a body that isn't an object — `null` parses fine — is an empty one)
    const body = (request.method === 'POST' ? await request.json().catch(() => null) : null) || {};
    if (typeof body !== 'object') return json({ error: 'Bad request.' }, 400);
    const now = Date.now();
    // (the rooms' own reports and bans: internal paths — handleMultiplayer never passes these on from outside)
    if (url.pathname === '/internal/rooms/update') {
      if (body.room && validCode(body.room.code)) this.rooms.set(body.room.code, { ...body.room, at: now });
      else if (typeof body.remove === 'string') this.rooms.delete(body.remove);
      return json({ ok: true });
    }
    if (url.pathname === '/api/mp/rooms') {
      for (const [c, r] of this.rooms) if (now - r.at > 40000) this.rooms.delete(c); // (live rooms check in every 15 s)
      return json({ rooms: [...this.rooms.values()].sort((a, b) => (a.state === 'playing') - (b.state === 'playing') || b.players - a.players).slice(0, 50) });
    }
    const rq = /^\/api\/mp\/rq\/(join|poll|accept|decline|leave|count)$/.exec(url.pathname) || /^\/internal\/rq\/(ban)$/.exec(url.pathname);
    if (rq) {
      // the Ranked Play queue
      const q = this.rq, t = String(body.ticket || '');
      q.update();
      switch (rq[1]) {
        case 'join': return json(q.join({ ...body, avatar: cleanAvatar(body.avatar) })); // (shown to the player it's matched with)
        case 'poll': return json(q.status(t));
        case 'accept': return json(q.accept(t));
        case 'decline': case 'leave': return json(q.decline(t));
        case 'ban': q.ban(String(body.cid || ''), Math.min(RP.LEAVE_BAN, Number(body.ms) || 0)); return json({ ok: true });
        case 'count': return json({ queued: q.counts() });
      }
    }
    if (url.pathname === '/api/mp/quickplay') {
      // Quick Play: everyone asking within a minute for the same key count shares one lobby (the room turns away
      // late arrivals once it has started, and the client asks again with `not` for a fresh one)
      const keys = Number(body.keys) === 7 ? 7 : 4, cur = this.qp[keys];
      if (cur && now - cur.at < 60000 && cur.code !== body.not) return json({ code: cur.code, host: false });
      const code = makeCode();
      this.qp[keys] = { code, at: now };
      return json({ code, host: true });
    }
    if (this.waiting && now - this.waiting.at > 40000) this.waiting = null;
    if (url.pathname === '/api/mp/quick/cancel') { if (this.waiting && this.waiting.code === body.code) this.waiting = null; return json({ ok: true }); }
    if (url.pathname === '/api/mp/quick/keep') { if (this.waiting && this.waiting.code === body.code) this.waiting.at = now; return json({ ok: !!this.waiting && this.waiting.code === body.code }); }
    if (url.pathname !== '/api/mp/quick') return json({ error: 'Not found' }, 404);
    if (this.waiting && this.waiting.code !== body.not) { const { code } = this.waiting; this.waiting = null; return json({ code, host: false }); }
    const code = makeCode();
    this.waiting = { code, at: now };
    return json({ code, host: true });
  }
}

/** Routes /api/mp/* (called from the main Worker). */
/** Judge a play in the Worker handling its request (never in a Durable Object: a long song's judging is heavy, and a
 *  shared object that runs over its CPU limit is reset — every player connected to it would drop). Body: { osu (the
 *  beatmap file, base64), play, … }. Returns { body, hash, r } — r the result or { error } — or { res } to answer with. */
async function judgePlay(request, { noFail = false } = {}) {
  if (Number(request.headers.get('content-length') || 0) > 8e6) return { res: json({ error: 'Too big.' }, 413) };
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return { res: json({ error: 'Bad request.' }, 400) };
  const j = await judgeFile(body.osu, { result: body.result, play: body.play, noFail });
  if (!j) return { body, res: json({ error: 'Bad beatmap file.' }, 400) };
  return { body, ...j };
}
/** A beatmap file (base64) and a play on it: { hash, md5, r } — r the play's result, or { error } — or null for a file
 *  that isn't one. */
async function judgeFile(osu, { result = null, play = null, noFail = false } = {}) {
  // (each byte by hand: a callback for every one of a long map's bytes took longer than the rest of the play together,
  // and a few plays at once ran over the time the server is given — none of them counted)
  let bytes;
  try { const bin = atob(String(osu || '')); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); } catch { return null; }
  if (!bytes.length || bytes.length > 5e6) return null;
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
  let r;
  // (the game's own result, taken as it is; a play sent as its key presses only — an older game — is judged)
  try { const text = new TextDecoder().decode(bytes); r = result && typeof result === 'object' ? acceptPlay(text, result, { noFail }) : verifyPlay(text, play, { noFail }); }
  catch { r = { error: 'The play could not be judged.' }; }
  // (the file's MD5 is how osu! itself knows a beatmap: it finds the set of a file that doesn't say which it's from —
  // only worked out for one that doesn't)
  let md5 = '';
  if (!(r && r.beatmapId > 0)) try { md5 = hex(await crypto.subtle.digest('MD5', bytes)); } catch { md5 = ''; }
  return { hash, md5, r };
}
/** As in osu!, only ranked / approved beatmaps give pp: the set's status from the osu! API (kept a week). When osu!
 *  can't say — not reachable, no osu! API key on this server, the beatmap not found there — the play keeps the pp the
 *  game gave it (the game only gives pp on beatmaps osu! told it are ranked). */
async function rankedOnly(r, md5, env) {
  if (!r || r.error || !(r.pp > 0) || env.TEST_ALL_RANKED === '1') return r;
  const { status: st, setId } = await beatmapStatus(r, md5, env);
  if (setId > 0 && !(r.beatmapSetId > 0)) r = { ...r, beatmapSetId: setId };
  return st && st !== 'ranked' && st !== 'approved' ? { ...r, pp: 0, unranked: true } : r;
}

/** A judged beatmap's ranked status on osu!: by its set id, else its beatmap id, else its file's MD5 ('' when unknown). */
export async function beatmapStatus(r, md5, env, get = officialGet, again = true) {
  const week = 7 * 86400000;
  try {
    if (r.beatmapSetId > 0) return { status: String((await get(`beatmapsets/${r.beatmapSetId}`, env, fetch, week)).status || ''), setId: r.beatmapSetId };
    const path = r.beatmapId > 0 ? `beatmaps/${r.beatmapId}` : /^[a-f0-9]{32}$/.test(md5 || '') ? `beatmaps/lookup?checksum=${md5}` : '';
    if (!path) return { status: '', setId: 0 };
    const b = await get(path, env, fetch, week), set = b && b.beatmapset;
    return { status: String((set && set.status) || (b && b.status) || ''), setId: (b && b.beatmapset_id) || (set && set.id) || 0 };
  } catch (e) {
    // (osu! busy or a blip: once more in a moment — a pass on a ranked map taken as unranked kept 0pp for good)
    if (again && !(e && e.status === 404)) { await new Promise(res => setTimeout(res, 1500)); return beatmapStatus(r, md5, env, get, false); }
    return { status: '', setId: 0 };
  }
}

/** /api/account/*: to the server object that keeps the players (Matchmaker), with the caller's address for its limits.
 *  Your settings and skin (settings, restore, skin, skin-up) are kept in a PlayerVault of your own, once the
 *  Matchmaker has checked this device is you: settings {pid, key, settings} keeps them; restore {pid, key} says what
 *  there is (the settings, which skin); skin {pid, key} sends the skin; skin-up sends one to keep (the .osk as the body,
 *  `x-am-auth: pid.key`, `x-am-skin`: its id and name). Your scores, for your other devices: scores-up {pid, key, scores}
 *  keeps them (each once), scores {pid, key, after} sends the ones kept after that sequence number, a page at a time. */
export async function handleAccount(request, env, url) {
  if (!env.MATCHMAKER) return json({ error: 'Accounts aren\'t available on this server.' }, 503);
  const m = /^\/api\/account\/(code|link|ticket|logout|others|settings|restore|skin|skin-up|scores|scores-up)$/.exec(url.pathname);
  if (request.method !== 'POST' || !m) return json({ error: 'Not found' }, 404);
  const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global')), what = m[1];
  if (/^(code|link|ticket|logout|others)$/.test(what)) {
    const body = (await request.text()).slice(0, 4096);
    return stub.fetch(new Request(new URL(url.pathname, url), { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-ip': request.headers.get('cf-connecting-ip') || '' } }));
  }
  if (!env.VAULT) return json({ error: 'Keeping settings isn\'t available on this server.' }, 503);
  let pid = '', key = '', settings = null, b = null;
  if (what === 'skin-up') {
    [pid = '', key = ''] = (request.headers.get('x-am-auth') || '').split('.');
    if (Number(request.headers.get('content-length')) > SKIN_MAX) return json({ error: 'Your skin is too big to keep (30 MB at most).' }, 413);
  } else {
    const max = what === 'scores-up' ? SCORES_SEND * SCORE_MAX + 4096 : SETTINGS_MAX + 4096, big = what === 'scores-up' ? 'Too many scores at once.' : 'Your settings are too big to keep.';
    if (Number(request.headers.get('content-length')) > max) return json({ error: big }, 413);
    const text = await request.text();
    if (text.length > max) return json({ error: big }, 413);
    try { b = JSON.parse(text); } catch { /* below */ }
    if (!b || typeof b !== 'object') return json({ error: 'Bad request.' }, 400);
    pid = String(b.pid || ''); key = String(b.key || ''); settings = b.settings;
  }
  const auth = await stub.fetch(new Request(new URL('/vault-auth', url), { method: 'POST', body: JSON.stringify({ pid, key, what }), headers: { 'content-type': 'application/json' } }));
  if (!auth.ok) return auth;
  const vault = env.VAULT.get(env.VAULT.idFromName(pid)), at = new URL('/' + what, url);
  // (something of yours changed on one device: your others online are told, and fetch it straight away — waited for:
  // a request left running once the answer has gone can be cut off)
  const told = async (res, part) => {
    if (res.ok) await stub.fetch(new Request(new URL('/internal/synced', url), { method: 'POST', body: JSON.stringify({ pid, part, key }), headers: { 'content-type': 'application/json' } })).catch(() => {});
    return res;
  };
  if (what === 'settings') {
    if (!settings || typeof settings !== 'object') return json({ error: 'Bad settings.' }, 400);
    return told(await vault.fetch(new Request(at, { method: 'POST', body: JSON.stringify(settings) })), 'settings');
  }
  if (what === 'skin-up') return told(await vault.fetch(new Request(at, { method: 'POST', body: request.body, headers: { 'x-am-skin': request.headers.get('x-am-skin') || '' } })), 'settings');
  if (what === 'scores-up') return told(await vault.fetch(new Request(at, { method: 'POST', body: JSON.stringify({ scores: Array.isArray(b.scores) ? b.scores : null }) })), 'scores');
  if (what === 'scores') return vault.fetch(new Request(at, { method: 'POST', body: JSON.stringify({ after: b.after }) }));
  return vault.fetch(new Request(at, { method: 'POST' }));
}

export async function handleMultiplayer(request, env, url) {
  if (!env.ROOMS || !env.MATCHMAKER) return json({ error: 'Multiplayer is not enabled on this server.' }, 503);
  const path = url.pathname;
  if (path === '/api/mp/new' && request.method === 'POST') return json({ code: makeCode() });
  if (path === '/api/mp/presence' || (path === '/api/mp/presence/http' && request.method === 'POST')) {
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
    return stub.fetch(new Request(new URL(path, url), request));
  }
  if (path === '/api/mp/score' && request.method === 'POST') {
    const j = await judgePlay(request, {});
    if (j.res) return j.res;
    j.r = await rankedOnly(j.r, j.md5, env);
    // (a daily challenge play on a beatmap whose file doesn't say its id — older ones don't: found from the file's MD5,
    // or it could never match the day's beatmap)
    if (j.r && !j.r.error && j.body.daily && !(j.r.beatmapId > 0) && /^[a-f0-9]{32}$/.test(j.md5 || '')) {
      try { const b = await officialGet(`beatmaps/lookup?checksum=${j.md5}`, env, fetch, 7 * 86400000); if (b && b.id > 0) j.r = { ...j.r, beatmapId: b.id }; } catch { /* not found */ }
    }
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
    // (`date`: when a play sent again — as its result — was played)
    const date = j.body.result && typeof j.body.result === 'object' && Number.isFinite(+j.body.result.date) ? +j.body.result.date : undefined;
    return stub.fetch(new Request(new URL('/judged-score', url), { method: 'POST', body: JSON.stringify({ pid: j.body.pid, key: j.body.key, daily: j.body.daily, playlist: j.body.playlist, hash: j.hash, r: j.r, date }), headers: { 'content-type': 'application/json' } }));
  }
  // (several plays at once — your best plays the server doesn't have yet, from the game catching up: { pid, key, plays:
  // [{ osu, result }] }, up to 25 — each taken as score() takes one)
  if (path === '/api/mp/scores' && request.method === 'POST') {
    if (Number(request.headers.get('content-length') || 0) > 30e6) return json({ error: 'Too big.' }, 413);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !Array.isArray(body.plays)) return json({ error: 'Bad request.' }, 400);
    const items = await Promise.all(body.plays.slice(0, 25).map(async p => {
      const j = p && typeof p === 'object' && p.result && typeof p.result === 'object' ? await judgeFile(p.osu, { result: p.result }) : null;
      return j ? { hash: j.hash, r: await rankedOnly(j.r, j.md5, env), date: Number(p.result.date) || 0 } : { hash: '', r: { error: 'Bad beatmap file.' } };
    }));
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
    return stub.fetch(new Request(new URL('/judged-scores', url), { method: 'POST', body: JSON.stringify({ pid: body.pid, key: body.key, items }), headers: { 'content-type': 'application/json' } }));
  }
  if (path === '/api/mp/rooms') {
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
    return stub.fetch(new Request(new URL(path, url)));
  }
  // (the queue's ban is only called by the rooms themselves, straight to the Durable Object)
  if ((/^\/api\/mp\/(quick|quick\/cancel|quick\/keep|quickplay)$/.test(path) || /^\/api\/mp\/rq\/(join|poll|accept|decline|leave|count)$/.test(path)) && request.method === 'POST') {
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
    return stub.fetch(new Request(new URL(path, url), { method: 'POST', body: await request.text(), headers: { 'content-type': 'application/json' } }));
  }
  const m = /^\/api\/mp\/room\/([A-Za-z0-9]{4,8})(\/status|\/verify|\/http)?$/.exec(path);
  if (m) {
    const code = m[1].toUpperCase();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const u = new URL(url); u.searchParams.set('code', code);
    if (m[2] === '/verify') {
      if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
      const j = await judgePlay(request, { noFail: true });
      if (j.res && !j.body) return j.res;
      // (a judge that broke isn't the player's fault: the room waits it out and their own result stands)
      if (j.r && j.r.error === 'The play could not be judged.') return json({ error: j.r.error }, 503);
      u.pathname = `/api/mp/room/${code}/judged`;
      return stub.fetch(new Request(u, { method: 'POST', body: JSON.stringify({ id: j.body.id, token: j.body.token, hash: j.hash || '', r: j.r || { error: 'The play could not be judged.' } }), headers: { 'content-type': 'application/json' } }));
    }
    return stub.fetch(new Request(u, request));
  }
  return json({ error: 'Not found' }, 404);
}
