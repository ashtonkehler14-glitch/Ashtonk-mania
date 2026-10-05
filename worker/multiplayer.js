// Online multiplayer for Ashtonk!mania: rooms of up to 8 (Head to Head or Team Versus) and osu!lazer-style Quick Play.
//  - MatchRoom (Durable Object, one per room code) relays a tiny JSON protocol over WebSockets.
//  - Matchmaker (Durable Object, single instance) pairs players for "Quick match".
//  - RoomLogic holds all room rules and is plain JS so it can be unit-tested in Node.
//
// Protocol (client → server): hello {name, create, mode?, keys?, size?, sr?}, settings {settings} (host), team {team}, pool {maps}
// (Quick Play host), pick {i} (Quick Play), chat {text}, suggest {map}, diff {diff}, map {map, mods, modConfig} (host),
// mods {mods} (your own mods), rate {mods, modConfig} (propose a room speed mod), vote {yes}, hasMap {has}, ready {ready},
// start (host), skip (vote to skip the intro), score {score, acc, combo, hp}, finish {result}, quit, ping {c}.
// Server → client: welcome {you, room}, room {room}, chat {...}, start {delay, map, mods, modConfig, playerMods},
// skipvote {votes, total}, skip, opp {id, score, acc, combo, hp}, results {results}, error {msg, fatal}, pong {c, s},
// qpPool {round, keys, sr} (to the Quick Play host: send this round's beatmap pool).
//
// Room settings (host, like lazer's match settings): match type Head to Head or Team Versus (red/blue; the team with
// the bigger total wins), the win condition (pp, score, accuracy or max combo), room size (2-8) and queue mode (the
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
export { RP, RankedPlay, RankedQueue, rateMatch, deckTargets, beatmapRating, starsForRating, initialRating, RATING, QUEUE } from './ranked-play.js';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const START_DELAY = 5000;
const MAX_PLAYERS = 16;
export const WIN_CONDITIONS = ['pp', 'score', 'accuracy', 'combo'];
/** Quick Play phase lengths (ms), rounds and placement points. */
export const QP = { GATHER: 20000, FULL: 3000, POOL: 15000, PICK: 25000, REVEAL: 5000, LOAD: 90000, STANDINGS: 12000, ROUNDS: 5 };
export const QP_POINTS = [8, 6, 5, 4, 3, 2, 1, 0];
const QP_BLOCKED = ['map', 'mods', 'rate', 'vote', 'diff', 'ready', 'start', 'settings', 'team'];

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
const personalMods = list => cleanMods(list).filter(x => !RATE_MODS.includes(x));
const speedMods = list => cleanMods(list).filter(x => RATE_MODS.includes(x)).slice(0, 1);
const cleanConfig = c => c && typeof c === 'object' ? Object.fromEntries(Object.entries(c).slice(0, 12).map(([k, v]) => [str(k, 16), num(v, -1e4, 1e4)])) : null;
/** A shared profile picture: a preset / public picture id, or a small inline JPEG / PNG / WebP. */
export const cleanAvatar = a => typeof a === 'string' && a.length <= 12000 && /^(preset:[\w-]{1,32}|file:[\w .()-]{1,64}|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/.test(a) ? a : '';
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
    this.players = []; this.hostId = null; this.created = false;
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
        fin: this.state === 'playing' && p.playing && (p.finished || p.claimed) ? (({ score, accuracy, maxCombo, counts, grade, passed, forfeit }) => ({ score, accuracy, maxCombo, counts, grade, passed, forfeit, checked: !!p.finished }))(p.finished || p.claimed) : null })),
    };
  }
  /** What the lobby's room list shows (null: not listed — private, Quick Play / Ranked Play, or empty). */
  listing() {
    if (!this.created || this.mode === 'qp' || !this.settings.public || !this.players.length) return null;
    const host = this.get(this.hostId), m = this.map, ranked = this.mode === 'rp';
    if (ranked && this.rp.rated) return null; // (queue matches are the two players' own)
    return { code: this.code, name: `${host ? host.name : 'Someone'}'s ${ranked ? 'Ranked Play duel' : 'room'}`, host: host ? host.name : '', avatar: host ? host.avatar : '', rating: ranked && host && this.rp.user(host.id) ? this.rp.user(host.id).rating : null,
      players: this.players.length, size: this.settings.size, ranked, keys: ranked ? this.rp.keys : null,
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

  join(id, name, create, opts = {}) {
    opts = opts && typeof opts === 'object' ? opts : {};
    if (!this.created && !create) return { ok: false, error: 'Room not found — check the code.' };
    // a player whose connection dropped mid-match comes back as themselves (same browser)
    const back = opts.cid ? this.players.find(p => p.away && p.cid && p.cid === String(opts.cid).slice(0, 40)) : null;
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
        this.rp = new RankedPlay(this, { keys: opts.keys, rated: !!opts.rated });
      } else if (opts.mode === 'qp') {
        this.mode = 'qp'; this.settings = { ...defaultSettings(), win: 'score', size: 8 };
        this.qp = { keys: Number(opts.keys) === 7 ? 7 : 4, round: 0, rounds: QP.ROUNDS, phase: 'gather', deadline: 0, pool: null, picks: {}, chosen: -1, points: {}, fails: 0 };
      } else {
        if (opts.size != null) this.settings.size = Math.round(num(opts.size, 2, MAX_PLAYERS, MAX_PLAYERS));
        if (opts.size != null && opts.size <= 2) this.settings.public = false; // quick 1v1 rooms aren't listed
        if (opts.public === false) this.settings.public = false;
      }
    }
    const p = { id, name: str(name, 24) || 'Player', avatar: cleanAvatar(opts.avatar), ready: false, hasMap: false, playing: false, finished: null, live: null, diff: null, mods: [], skip: false,
      team: this.settings.type === 'teams' ? this.smallerTeam() : null, sr: num(opts.sr, 0, 15, 0), cid: str(opts.cid, 40), pid: /^[a-z0-9]{6,24}$/.test(String(opts.pid || '')) ? String(opts.pid) : '', away: false, awayUntil: 0,
      token: newToken() }; // (for this player's plays sent to be judged: see verify)
    this.players.push(p);
    if (!this.hostId) this.hostId = id;
    if (this.restoredHost && p.pid === this.restoredHost) { this.hostId = id; this.restoredHost = ''; } // (the host back after a restart)
    if (this.qp) { this.qp.points[id] = 0; this.qpGather(); }
    const out = [{ to: id, msg: { t: 'welcome', you: id, token: p.token, room: this.snapshot(id) } }, this.roomMsg(), this.system(`${p.name} joined the room`)];
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
    const midMatch = (this.state === 'playing' && p.playing && !p.finished) || (this.rp && !['waitjoin', 'ended'].includes(this.rp.stage));
    if (midMatch && p.cid && !p.leaving) {
      p.away = true; p.awayUntil = this.now() + RP.AWAY;
      return [this.system(`${p.name} lost connection — waiting for them to come back`), this.roomMsg()];
    }
    return this.leave(id);
  }
  leave(id) {
    const p = this.get(id);
    if (!p) return [];
    const out = [];
    if (this.rp) out.push(...this.rp.leave(id));
    if (this.state === 'playing' && p.playing) {
      if (!p.finished) p.finished = { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc, pp: p.live.pp } : {}), forfeit: true };
      this.departed.push({ id: p.id, name: p.name, diff: p.diff, ...p.finished, left: true });
    }
    this.players = this.players.filter(x => x !== p);
    if (this.qp) delete this.qp.points[id];
    if (this.state === 'playing') out.push(...this.checkFinished(true));
    if (!this.players.length) { this.reset(); return out; }
    const wasHost = this.hostId === id;
    if (wasHost) this.hostId = this.players[0].id;
    for (const x of this.players) x.ready = false;
    if (this.vote) { this.vote = null; out.push(this.system('Speed mod vote cancelled')); }
    out.push(this.system(`${p.name} left the room`));
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
          this.players.forEach((x, i) => { x.team = st.type === 'teams' ? i % 2 : null; });
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
        for (const x of this.players) x.ready = false;
        return [this.roomMsg(), this.system(`Room settings: ${changes.join(', ')}`)];
      }
      case 'team':
        if (this.state !== 'lobby' || this.settings.type !== 'teams') return [];
        p.team = m.team ? 1 : 0;
        return [this.roomMsg()];
      case 'pool': {
        if (this.rp) return Array.isArray(m.maps) ? this.rp.setDeck(id, m.maps.slice(0, RP.DECK).map(cleanSuggestion).filter(Boolean)) : [];
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
        for (const x of this.players) { x.ready = false; x.diff = null; if (x.id !== id) x.hasMap = false; }
        this.pendingStart = false;
        p.hasMap = true;
        const out = [this.system(`Beatmap changed to ${map.artist} - ${map.title} [${map.version}]`)];
        if (Array.isArray(m.mods)) {
          p.mods = personalMods(m.mods);
          // the host's speed mod (DT…) is only a proposal: everyone has to accept it. Picking a map without one keeps
          // the room's current speed (removing it goes through the Mods button — and a vote)
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
        // each player may play any difficulty of the room's beatmap set
        if (this.state !== 'lobby' || !this.map) return [];
        const d = m.diff && typeof m.diff === 'object' ? m.diff : null;
        p.diff = d ? { version: str(d.version, 200), stars: num(d.stars, 0, 100), keys: Math.round(num(d.keys, 1, 18, 4)) } : null;
        return [this.roomMsg()];
      }
      case 'hasMap':
        p.hasMap = !!m.has;
        if (this.qp && this.qp.phase === 'load' && this.state === 'lobby') return [...this.qpMaybeStart(), this.roomMsg()];
        if (this.rp) return [...this.rp.mapState(), this.roomMsg()];
        // the host already pressed Start: it begins as soon as the last download is in
        if (this.pendingStart && this.canBegin()) { this.pendingStart = false; return this.beginMatch(this.players); }
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
        if (this.players.length < 2) return [{ to: id, msg: { t: 'error', msg: 'Wait for an opponent to join.' } }];
        if (!this.map || !this.players.every(x => x.ready)) return [{ to: id, msg: { t: 'error', msg: 'Everyone needs to be ready.' } }];
        if (this.vote) return [{ to: id, msg: { t: 'error', msg: 'Everyone has to accept (or decline) the speed mod first.' } }];
        // someone's beatmap is still downloading in the background: start the moment it's in
        if (!this.players.every(x => x.hasMap)) { this.pendingStart = true; return [this.roomMsg()]; }
        return this.beginMatch(this.players);
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
        // Ranked Play: leaving the song scores 0 for this round; the other player plays on
        if (this.rp) { p.finished = { ...cleanResult({ score: 0, accuracy: p.live ? p.live.acc : 0, maxCombo: p.live ? p.live.maxCombo : 0 }), forfeit: true }; return [this.system(`${p.name} left the song`), ...this.checkFinished()]; }
        p.finished = { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc, pp: p.live.pp } : {}), forfeit: true };
        return [this.system(`${p.name} quit the match`), ...this.checkFinished()];
    }
    return [];
  }

  canBegin() { return this.state === 'lobby' && !!this.map && !this.vote && this.players.length >= 2 && this.players.every(x => x.ready && x.hasMap); }
  /** Start a match for `list` (everyone in a custom room; whoever loaded the beatmap in Quick Play). */
  /** lazer's auto start: the countdown runs while anyone's ready (and stops when nobody is). */
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
    this.departed = [];
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
    const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
    if (!this.vote && same(mods, this.mods)) return [];
    if (this.vote && same(mods, this.vote.mods)) return [];
    this.vote = { mods, modConfig, by: p.id, yes: [p.id] };
    const settled = this.settleVote();
    if (settled.length) return settled;
    return [this.system(`${p.name} wants to play ${mods.length ? 'with ' + mods.join('') : 'without speed mods'} — everyone has to accept`)];
  }
  settleVote() {
    const v = this.vote;
    if (!v || !this.players.every(x => v.yes.includes(x.id))) return [];
    this.mods = v.mods; this.modConfig = v.mods.includes('RT') ? v.modConfig : null; this.vote = null;
    for (const x of this.players) x.ready = false;
    return [this.system(this.mods.length ? `Everyone accepted — playing with ${this.mods.join('')}` : 'Speed mods removed')];
  }

  /** Called periodically: players who never report back are timed out, and Quick Play moves through its phases. */
  tick() {
    // a dropped connection that didn't come back in time: gone for good
    const out = [];
    for (const p of [...this.players]) if (p.away && this.now() >= p.awayUntil) out.push(...this.leave(p.id));
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
    const sameMap = !this.map || (map.hash && hash === map.hash) || (map.onlineSetId > 0 && r.beatmapSetId === map.onlineSetId) ||
      (!!map.title && r.title === map.title && r.artist === map.artist);
    const want = [...new Set([...this.mods, ...(p.mods || [])])].sort().join(), got = [...r.mods].sort().join();
    if (r.error || !sameMap || want !== got) {
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
      // Team Versus: totals (accuracy averages), the bigger total wins
      teams = [0, 1].map(t => {
        const m = rows.filter(r => r.team === t), vals = m.map(key);
        const total = !vals.length ? 0 : win === 'accuracy' ? vals.reduce((a, b) => a + b, 0) / vals.length : vals.reduce((a, b) => a + b, 0);
        return { total, players: m.length };
      });
      winnerTeam = teams[0].total === teams[1].total ? null : teams[0].total > teams[1].total ? 0 : 1;
      winner = null;
    }
    this.lastResults = { rows, winner, teams, winnerTeam, type: this.settings.type, win, map: this.map, mods: this.mods, at: this.now() };
    this.state = 'lobby'; this.deadline = 0; this.departed = [];
    for (const p of this.players) { p.playing = false; p.ready = false; p.finished = null; p.live = null; p.claimed = null; }
    const out = [];
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

/** One room per code. Plain (non-hibernating) WebSockets: a room only lives while its players are connected. */
export class MatchRoom {
  constructor(state, env) { this.state = state; this.env = env; this.logic = null; this.socks = new Map(); this.timer = null; this.beat = null; this._listed = ''; this.seen = new Map(); this.kick = new Map(); }
  /** Tell the lobby's room list about this room (on change, and every 15 s while anyone is in it). */
  announce(force = false) {
    const l = this.logic && this.logic.listing(), body = JSON.stringify(l ? { room: l } : { remove: this.logic && this.logic.code });
    if (!force && body === this._listed) return;
    if (!l && !this._listed.includes('"room"')) { this._listed = body; return; }
    this._listed = body;
    if (!this.env.MATCHMAKER) return;
    const stub = this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName('global'));
    stub.fetch('https://mm/api/mp/rooms/update', { method: 'POST', body, headers: { 'content-type': 'application/json' } }).catch(() => {});
    if (l && !this.beat) this.beat = setInterval(() => { this.dropSilent(); this.announce(true); }, 15000);
    if (!l && this.beat) { clearInterval(this.beat); this.beat = null; }
  }
  /** Players ping every 15 s: a connection silent for 90 s has dropped without closing, so close it (they leave). */
  dropSilent() {
    const t = Date.now();
    for (const [id, at] of this.seen) if (t - at > 90000) {
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
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a WebSocket upgrade' }, 426);
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    let id = crypto.randomUUID().slice(0, 8);
    let joined = false;
    server.addEventListener('message', ev => { try { onMessage(ev); } catch (e) { console.error('room message', e); } });
    // (one message that goes wrong is dropped — an error escaping here could reset the room for everyone in it)
    const onMessage = ev => {
      if (typeof ev.data !== 'string' || ev.data.length > 16384) return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (!joined) {
        if (msg.t !== 'hello') return;
        const r = this.logic.join(id, msg.name, !!msg.create, msg);
        if (!r.ok) { try { server.send(JSON.stringify({ t: 'error', msg: r.error, fatal: true })); server.close(4000, 'rejected'); } catch { /* closed */ } return; }
        if (r.as) { // back after a dropped connection: this socket is that player now
          id = r.as;
          const old = this.socks.get(id);
          if (old && old !== server) { this.socks.delete(id); try { old.close(4003, 'replaced'); } catch { /* closed */ } }
        }
        joined = true; this.socks.set(id, server); this.seen.set(id, Date.now());
        this.kick.set(id, gone);
        this.dispatch(r.out);
        this.schedule();
        return;
      }
      this.seen.set(id, Date.now());
      this.dispatch(this.logic.message(id, msg));
      this.schedule();
    };
    const gone = () => {
      if (!joined) return;
      joined = false;
      if (this.socks.get(id) !== server) return; // (an old socket of a player who has reconnected)
      this.socks.delete(id); this.seen.delete(id); this.kick.delete(id);
      this.dispatch(this.logic.disconnect(id));
      this.announce(); // (the last one out leaves nothing to dispatch, but the room must leave the list)
      this.schedule();
    };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
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
      const data = each ? null : JSON.stringify(msg);
      for (const [id, ws] of this.socks) {
        const hit = to === 'all' || to === id || (to && typeof to === 'object' && to.except !== id);
        if (hit) { try { ws.send(data || JSON.stringify(each(id))); } catch { /* socket closing */ } }
      }
    }
    // Ranked Play: a player who left a rated match sits out of the queue for a while
    const rp = this.logic && this.logic.rp;
    if (rp && rp.bans.length && this.env.MATCHMAKER) {
      const stub = this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName('global'));
      for (const b of rp.bans.splice(0)) stub.fetch('https://mm/api/mp/rq/ban', { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } }).catch(() => {});
    }
  }
}

/** Who's online, invites, and spectating. Presence protocol (client → server): hello {name, status, avatar, cid, pid},
 *  status {status, name?, avatar?, song?}, invite {to, code}, list, ping; spectating: play {head} (a play started:
 *  the replay header), frames {ev, at, reset?, last?} (its inputs, streamed only while someone watches), playEnd {quit?},
 *  watch {to}, unwatch {to}. Server → client: welcome {you}, online {players}, invite {from, code}, invited {to},
 *  error {msg}; to a player: spectators {n, full?} (full: send everything so far); to a watcher: specStart {id, name,
 *  head, ev, at, hist}, specFrames {id, ev, at, reset?, last?}, specEnd {id, quit?, gone?}, specWait {id, name}.
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
    // lazer's daily challenge: one beatmap a day (UTC), proposed by the first player to ask, and each player's best
    // score on it; `persistDaily` keeps it
    this.daily = { day: '', map: null, scores: [] }; this.persistDaily = null;
    // each player's daily challenge record (lazer's profile box): days played, the current and best daily streak
    this.dailyStats = new Map(); this.persistDailyStats = null;
    // lazer's global beatmap leaderboards: each beatmap's (by its .osu file's hash) best score per player, top 100
    this.boards = new Map(); this.persistBoard = null;
    // each board's osu! beatmap id (read from the judged file), so a beatmap's board can be found by its id alone —
    // lazer's beatmap overlay, before it's downloaded (lbid:<id> in storage)
    this.boardIds = new Map(); this.persistBoardId = null;
    // lazer's "First place ranks": the beatmaps each player is #1 on (f1:<pid>), kept as the boards change
    this.firsts = new Map(); this.persistFirsts = null;
    // players' keys, by public id (only the key's SHA-256 is kept): pid → hash
    this.auth = new Map(); this.persistAuth = null;
    // each player's profile as their game last shared it (lazer's user profile, opened by other players): pid → data
    this.profiles = new Map(); this.profileJson = new Map(); this.persistProfile = null;
    // lazer's playlists: lists of beatmaps a player puts up for a while, each with everyone's best score on each
    // beatmap and an overall board of their totals (kept in storage, pl:<id>)
    this.playlists = new Map(); this.persistPlaylist = null;
    // lazer's user tags: each beatmap's (by its file's id) tags, with who voted for them — `persistTags` keeps them
    this.tags = new Map(); this.persistTags = null;
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
  static PROFILE_MAX = 48000; // characters of JSON
  /** Does this key own this public id? The first key used with an id claims it. */
  claim(pid, key) {
    const k = String(key || '');
    if (k.length < 16 || k.length > 100) return false;
    const hash = sha256hex(k), have = this.auth.get(pid);
    if (have) return have === hash;
    this.auth.set(pid, hash);
    if (this.persistAuth) this.persistAuth(pid, hash);
    return true;
  }
  loadAuth(all) { for (const [pid, h] of Object.entries(all || {})) if (typeof h === 'string') this.auth.set(pid, h); }
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
        this.setFirst(pid, key, { score: entry.score, acc: entry.acc, grade: entry.grade, mods: entry.mods, combo: entry.combo, pp: entry.pp, date: t,
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
    if (!b || b.pp < entry.pp) rec.bests[key] = { pp: entry.pp, acc: entry.acc, grade: entry.grade, score: entry.score, combo: entry.combo, mods: entry.mods, date: t,
      title: String(r.title || '').slice(0, 120), artist: String(r.artist || '').slice(0, 120), version: String(r.version || '').slice(0, 120) };
    const list = Object.entries(rec.bests).sort((a, b2) => b2[1].pp - a[1].pp).slice(0, PresenceLogic.KEEP_BESTS);
    rec.bests = Object.fromEntries(list);
    let pp = 0, accW = 0, wSum = 0;
    list.forEach(([, x], i) => { const w = 0.95 ** i; pp += x.pp * w; accW += x.acc * w; wSum += w; });
    const g = list.map(([, x]) => x.grade);
    // (ranked score: the best score on each ranked beatmap, added up — lazer's Score rankings)
    const rscore = list.reduce((a, [, x]) => a + (x.pp > 0 ? x.score || 0 : 0), 0);
    rec.v = { pp: Math.round(pp * 100) / 100, acc: wSum ? accW / wSum : 0, ss: g.filter(x => x === 'SS' || x === 'XH').length, s: g.filter(x => x === 'S' || x === 'SH').length, a: g.filter(x => x === 'A').length, rscore };
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
    if (daily && d.map && daily.day === d.day && r.beatmapId === d.map.onlineId) {
      this.countDailyDay(pid, d.day);
      const ds = { pid, name, avatar, score: entry.score, acc: entry.acc, combo: entry.combo, grade: entry.grade, mods: entry.mods, at: t };
      const was = d.scores.find(x => x.pid === pid);
      if (!was || was.score < ds.score) { d.scores = d.scores.filter(x => x.pid !== pid); d.scores.push(ds); }
      this.saveDaily();
      out.push(...[...this.users.keys()].map(x => ({ to: x, msg: this.dailyMsg(this.users.get(x).pid) })));
    }
    // where the player's best stands on the board now, and whether this play set it (lazer's results)
    const now = this.boards.get(key) || [], at = now.findIndex(x => x.pid === pid);
    return { out, entry, total: rec.pp, rank: at < 0 ? null : at + 1, of: now.length, best: !prev || prev.score < entry.score };
  }
  /** A player's profile for someone looking at it: what their game shared, their place in the rankings, their daily
   *  challenge record and whether they're online. */
  profileMsg(pid) {
    const data = this.profiles.get(pid) || null, r = this.ranks.get(pid);
    // their best plays the server judged (the ones with a known song, on ranked beatmaps), best first — for a profile their game hasn't sent
    const top = r && r.bests ? Object.values(r.bests).filter(b => b && b.title && b.pp > 0).sort((a, b) => b.pp - a.pp).slice(0, 20)
      .map(b => ({ title: b.title, artist: b.artist, version: b.version, grade: b.grade, accuracy: b.acc, mods: b.mods || [], date: b.date, pp: b.pp, score: b.score, maxCombo: b.combo, passed: true })) : [];
    const online = [...this.users.entries()].find(([, x]) => x.pid === pid && x.vis !== 'offline'); // (appearing offline: offline here too)
    const all = [...this.ranks.values()].filter(x => x.pp > 0).sort((a, b) => b.pp - a.pp || b.acc - a.acc), at = all.findIndex(x => x.pid === pid);
    const f1 = Object.values(this.firsts.get(pid) || {}).sort((a, b) => b.date - a.date);
    const firsts = f1.slice(0, 20).map(b => ({ title: b.title, artist: b.artist, version: b.version, grade: b.grade, accuracy: b.acc, mods: b.mods || [], date: b.date, pp: b.pp, score: b.score, maxCombo: b.combo, stars: b.stars, passed: true }));
    return { t: 'profile', pid, data, top, firsts, firstCount: f1.length, name: online ? online[1].name : r ? r.name : data ? data.name : null, avatar: online ? online[1].avatar : r ? r.avatar : null,
      rank: at < 0 ? null : at + 1, daily: this.dailyStatsOf(pid), verified: r ? { pp: r.pp, acc: r.acc, plays: r.plays, ss: r.ss, s: r.s, a: r.a } : null, online: !!online, id: online ? online[0] : null, status: online ? online[1].status : 'offline' };
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
    const all = this.boards.get(key) || [];
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
    const today = PresenceLogic.dayOf(this.now()), yesterday = PresenceLogic.dayOf(this.now() - 86400000);
    return { ...v, current: v.last === today || v.last === yesterday ? v.current : 0 };
  }
  countDailyDay(pid, day) {
    const v = this.dailyStats.get(pid) || { plays: 0, current: 0, best: 0, last: '' };
    if (v.last === day) return;
    const yesterday = PresenceLogic.dayOf(Date.parse(day + 'T12:00:00Z') - 86400000);
    v.current = v.last === yesterday ? v.current + 1 : 1; v.best = Math.max(v.best, v.current); v.plays++; v.last = day;
    this.dailyStats.set(pid, v);
    if (this.persistDailyStats) this.persistDailyStats(pid, v);
  }
  static dayOf(t) { return new Date(t).toISOString().slice(0, 10); }
  dailyNow() {
    const day = PresenceLogic.dayOf(this.now());
    if (this.daily.day !== day) { this.daily = { day, map: null, scores: [] }; this.saveDaily(); }
    return this.daily;
  }
  saveDaily() { if (this.persistDaily) this.persistDaily(this.daily); }
  /** A score as shown: with its player's current name and picture (a rename shows on scores set before it). */
  current(s) {
    const online = [...this.users.values()].find(u => u.pid === s.pid), r = this.ranks.get(s.pid);
    const name = online ? online.name : r ? r.name : s.name, avatar = online ? online.avatar : r ? r.avatar : s.avatar;
    return name === s.name && avatar === s.avatar ? s : { ...s, name, avatar };
  }
  dailyMsg(pid) {
    const d = this.dailyNow(), sorted = [...d.scores].sort((a, b) => b.score - a.score || b.acc - a.acc || a.at - b.at);
    const at = sorted.findIndex(s => s.pid === pid), end = Date.parse(d.day + 'T00:00:00Z') + 86400000;
    // lazer's score breakdown (how many scores fall in each 100,000) and event feed (the newest scores, with their place)
    const bins = new Array(11).fill(0);
    for (const x of sorted) bins[Math.min(10, Math.floor((x.score || 0) / 100000))]++;
    const recent = [...sorted.map((x, i) => ({ x, rank: i + 1 }))].sort((a, b) => b.x.at - a.x.at).slice(0, 8)
      .map(({ x, rank }) => ({ ...this.current({ pid: x.pid, name: x.name, avatar: x.avatar }), pid: x.pid, score: x.score, rank, at: x.at }));
    return { t: 'daily', day: d.day, endsAt: end, map: d.map, total: sorted.length, bins, recent, you: at < 0 ? null : { ...this.current(sorted[at]), rank: at + 1 }, stats: this.dailyStatsOf(pid),
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
      if ((r.pol || 0) < PresenceLogic.RANK_POLICY) {
        const zero = { pp: 0, acc: 0, ss: 0, s: 0, a: 0 };
        for (const b of Object.values(r.bests || {})) if (b) b.pp = 0;
        r.v = { ...zero }; r.rep = { ...zero }; r.pol = PresenceLogic.RANK_POLICY; r.reset = true;
      }
      PresenceLogic.settleRank(r);
      this.ranks.set(pid, r);
    }
  }
  /** A player's standing: the pp of the plays judged here or, while that's lower (a small server can't always judge a
   *  long song in time), what their game reports from their own scores — whichever is higher. */
  static RANK_POLICY = 2;
  /** A standing from the best plays a player's profile lists (only the ones on ranked beatmaps: `isRanked(entry)`),
   *  weighted as osu! weights them; null when none count. */
  static rankFromTop(top, isRanked) {
    const list = (Array.isArray(top) ? top : []).filter(x => x && Number.isFinite(+x.pp) && +x.pp > 0 && x.passed !== false && isRanked(x)).sort((a, b) => b.pp - a.pp);
    if (!list.length) return null;
    let pp = 0, accW = 0, wSum = 0;
    list.forEach((x, i) => { const w = 0.95 ** i; pp += Math.min(100000, +x.pp) * w; accW += Math.min(1, Math.max(0, +x.accuracy || 0)) * w; wSum += w; });
    const g = list.map(x => x.grade);
    return { pp: Math.round(pp * 100) / 100, acc: accW / wSum, ss: g.filter(x => x === 'SS' || x === 'XH').length, s: g.filter(x => x === 'S' || x === 'SH').length, a: g.filter(x => x === 'A').length };
  }
  static settleRank(r) {
    const v = r.v || { pp: 0, acc: 0, ss: 0, s: 0, a: 0 }, rep = r.rep || { pp: 0, acc: 0, ss: 0, s: 0, a: 0 };
    const use = rep.pp > v.pp ? rep : v;
    r.pp = use.pp; r.acc = use.acc; r.ss = use.ss; r.s = use.s; r.a = use.a;
    r.rscore = Math.max(v.rscore || 0, rep.rscore || 0);
    return r;
  }
  /** The top 50 by pp, and where you stand. */
  rankings(pid, mode = 'performance') {
    // lazer's Performance and Score tables: by total pp, or by ranked score
    const byScore = mode === 'score';
    const all = [...this.ranks.values()].filter(r => byScore ? r.rscore > 0 : r.pp > 0).sort(byScore ? (a, b) => b.rscore - a.rscore || b.pp - a.pp : (a, b) => b.pp - a.pp || b.acc - a.acc);
    const online = new Set([...this.users.values()].filter(u => u.vis !== 'offline').map(u => u.pid));
    const at = all.findIndex(r => r.pid === pid);
    const pub = ({ bests, v, rep, _lazy, sb, ...r }) => r; // (not each player's whole list of plays)
    return { t: 'rankings', mode: byScore ? 'score' : 'performance', total: all.length, you: at < 0 ? null : { ...pub(all[at]), rank: at + 1 }, list: all.slice(0, 50).map((r, i) => ({ ...pub(r), rank: i + 1, online: online.has(r.pid) })) };
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
    return { t: 'friends', list: [...(this.friends.get(pid) || [])].map(([p, name]) => ({ pid: p, name, online: online.has(p) })), requests: [...(this.requests.get(pid) || [])].map(([p, name]) => ({ pid: p, name })) };
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
  list() { return [...this.users.entries()].filter(([, u]) => u.vis !== 'offline').map(([id, u]) => ({ id, pid: u.pid, name: u.name, status: u.status, avatar: u.avatar, song: u.status === 'playing' ? u.song : null, watchers: u.watchers.size, dnd: u.vis === 'dnd' || undefined })); }
  join(id, msg) {
    // the same browser tab reconnecting replaces its old entry straight away (no ghost of yourself)
    const cid = str(msg && msg.cid, 40), gone = [], out = [];
    if (cid) for (const [oid, u] of this.users) if (u.cid === cid) { out.push(...this.forget(oid)); gone.push(oid); }
    // a public id belongs to whoever first used it with their secret key: anyone else using it stays anonymous
    let pid = /^[a-z0-9]{6,24}$/.test(String(msg && msg.pid || '')) ? String(msg.pid) : '';
    if (pid && !this.claim(pid, msg && msg.key)) { pid = ''; out.push({ to: id, msg: { t: 'repid' } }); } // (the client quietly takes a new id of its own)
    this.users.set(id, { name: str(msg && msg.name, 24) || 'Player', status: cleanStatus(msg && msg.status), avatar: cleanAvatar(msg && msg.avatar), cid,
      pid, song: null, seen: this.now(), vis: cleanVis(msg && msg.vis),
      play: null, ev: [], t: 0, hist: false, watchers: new Set(), watching: null });
    this.dropped = gone;
    const me = this.users.get(id);
    return [...out, { to: id, msg: { t: 'welcome', you: id } }, { to: id, msg: { t: 'chatHist', list: this.chat } }, ...(me.pid ? [{ to: id, msg: this.friendsMsg(me.pid) }] : []), this.broadcast()];
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
    this.users.delete(id); this.lastInvite.delete(id); this.said.delete(id);
    return out;
  }
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
          const data = { ...JSON.parse(json), name: u.name };
          this.profiles.set(u.pid, data); this.profileJson.set(u.pid, json);
          if (this.persistProfile) this.persistProfile(u.pid, data);
        }
      }
      // their standing as their game reports it (see settleRank), and their name and picture as they are now
      const p = msg.profile && typeof msg.profile === 'object' ? msg.profile : null, num = (x, max) => (Number.isFinite(+x) ? Math.min(max, Math.max(0, +x)) : 0);
      const gr = p && p.grades && typeof p.grades === 'object' ? p.grades : {};
      const rep = p ? { pp: Math.round(num(p.pp, 100000) * 100) / 100, acc: num(p.avgAcc, 1), ss: num(gr.SS, 1e6) + num(gr.XH, 1e6), s: num(gr.S, 1e6) + num(gr.SH, 1e6), a: num(gr.A, 1e6), rscore: Math.round(num(p.rankedScore, 1e13)) } : null;
      let rec = this.ranks.get(u.pid);
      if (!rec && rep && rep.pp > 0) { rec = { pid: u.pid, name: u.name, avatar: u.avatar, plays: 0, bests: {}, pol: PresenceLogic.RANK_POLICY }; this.ranks.set(u.pid, rec); }
      if (rec) {
        const before = JSON.stringify([rec.name, rec.avatar, rec.rep]);
        rec.name = u.name; rec.avatar = u.avatar;
        if (rep) { rec.rep = rep; if (Number.isFinite(+p.plays)) rec.plays = Math.max(rec.plays || 0, num(p.plays, 1e9)); }
        PresenceLogic.settleRank(rec);
        if (JSON.stringify([rec.name, rec.avatar, rec.rep]) !== before && this.persistRank) this.persistRank(u.pid, rec);
      }
      return [];
    }
    if (msg.t === 'rankings') return [{ to: id, msg: this.rankings(u.pid, msg.mode === 'score' ? 'score' : 'performance') }];
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
    if (msg.t === 'dailyPropose') {
      // the first proposal of the day wins (everyone then gets it)
      const d = this.dailyNow(), m = msg.map || {};
      if (d.map) return [{ to: id, msg: this.dailyMsg(u.pid) }];
      const onlineSetId = Math.floor(Number(m.onlineSetId)), onlineId = Math.floor(Number(m.onlineId)), keys = Number(m.keys);
      if (!(onlineSetId > 0 && onlineId > 0 && (keys === 4 || keys === 7))) return [];
      d.map = { onlineSetId, onlineId, keys, title: str(m.title, 120), artist: str(m.artist, 120), version: str(m.version, 120), creator: str(m.creator, 40),
        stars: Math.round(Math.min(20, Math.max(0, Number(m.stars) || 0)) * 100) / 100, length: Math.min(36e5, Math.max(0, Number(m.length) || 0)) };
      this.saveDaily();
      return [...this.users.keys()].map(x => ({ to: x, msg: this.dailyMsg(this.users.get(x).pid) }));
    }
    if (msg.t === 'status') {
      const st = cleanStatus(msg.status), name = msg.name != null ? str(msg.name, 24) || u.name : u.name, av = msg.avatar != null ? cleanAvatar(msg.avatar) : u.avatar;
      const song = st === 'playing' ? cleanSong(msg.song) || (u.status === 'playing' ? u.song : null) : null;
      if (st === u.status && name === u.name && av === u.avatar && JSON.stringify(song) === JSON.stringify(u.song)) return [];
      u.status = st; u.name = name; u.avatar = av; u.song = song;
      return [this.broadcast()];
    }
    // ── chat: a line in #lobby, or a private message to a friend (every tab of both of you)
    if (msg.t === 'say' || msg.t === 'pm') {
      const text = str(msg.text, 300).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
      if (!text) return [];
      const t = this.now(), recent = (this.said.get(id) || []).filter(x => t - x < PresenceLogic.CHAT_WINDOW);
      if (recent.length >= PresenceLogic.CHAT_BURST) return [{ to: id, msg: { t: 'error', msg: 'You\'re sending messages too fast.' } }];
      recent.push(t); this.said.set(id, recent);
      const from = { pid: u.pid, name: u.name, avatar: u.avatar };
      if (msg.t === 'say') {
        const line = { ch: '#lobby', from, text, at: t };
        this.chat.push(line); if (this.chat.length > PresenceLogic.CHAT_KEEP) this.chat.shift();
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
      const screen = tu.rk ? tu.rk.z.map((z, part) => ({ to: id, msg: { t: 'specRk', id: to, seq: tu.rk.seq, part, parts: tu.rk.parts, z } })) : tu.rkview ? [{ to: id, msg: { t: 'specRk', id: to, html: tu.rkview } }] : [];
      if (!tu.play) return [...out, { to: id, msg: { t: 'specWait', id: to, name: tu.name } }, ...screen, { to, msg: { t: 'spectators', n: tu.watchers.size, names: this.watcherNames(tu) } }];
      // mid-play: what's kept so far, or (nobody was watching, so nothing was streamed) ask the player for all of it
      out.push({ to: id, msg: { t: 'specStart', id: to, name: tu.name, head: tu.play, ev: tu.hist ? tu.ev : [], at: tu.t, hist: tu.hist, paused: tu.paused ?? null } });
      out.push({ to, msg: { t: 'spectators', n: tu.watchers.size, names: this.watcherNames(tu), full: first || !tu.hist } });
      return out;
    }
    if (msg.t === 'unwatch') return this.unwatch(id, String(msg.to || u.watching || ''));
    // a Ranked Play match's screen as the player sees it (between songs), for their spectators
    // (the player's whole screen whenever they're not mid-song: compressed and sent in chunks, each passed straight on
    // and the latest full set kept for anyone who starts watching)
    if (msg.t === 'rkview') {
      if (typeof msg.z === 'string') {
        const parts = Math.trunc(Number(msg.parts)), part = Math.trunc(Number(msg.part)), seq = Number(msg.seq);
        if (!(parts >= 1 && parts <= 40 && part >= 0 && part < parts && Number.isFinite(seq)) || msg.z.length > 61000) return [];
        if (!u.rk || u.rk.seq !== seq) u.rk = { seq, parts, z: [] };
        u.rk.z[part] = msg.z; u.rkview = null;
        return [...u.watchers].map(w => ({ to: w, msg: { t: 'specRk', id, seq, part, parts, z: msg.z } }));
      }
      const html = typeof msg.html === 'string' && msg.html.length <= 60000 ? msg.html : null;
      u.rkview = html; u.rk = null;
      return [...u.watchers].map(w => ({ to: w, msg: { t: 'specRk', id, html } }));
    }
    // where their pointer is on that screen (0–1 across and down) and whether it's pressed, passed straight on
    if (msg.t === 'rkcur') {
      if (!u.watchers.size) return [];
      const c = v => Math.min(1, Math.max(0, Number(v) || 0));
      const cur = { t: 'specCur', id, x: Math.round(c(msg.x) * 10000) / 10000, y: Math.round(c(msg.y) * 10000) / 10000, d: !!msg.d };
      return [...u.watchers].map(w => ({ to: w, msg: cur }));
    }
    if (msg.t === 'play') {
      if (!msg.head || typeof msg.head !== 'object') return [];
      const head = cleanHead(msg.head);
      if (!head) return [];
      u.play = head; u.ev = []; u.t = 0; u.hist = u.watchers.size > 0; u.paused = null; // (a fresh play: nothing to catch up on)
      return [...u.watchers].map(w => ({ to: w, msg: { t: 'specStart', id, name: u.name, head, ev: [], at: 0, hist: true } }));
    }
    if (msg.t === 'frames') {
      if (!u.play || !u.watchers.size || !Array.isArray(msg.ev)) return [];
      const ev = msg.ev.slice(0, 6000).map(Number).filter(Number.isFinite), t = num(msg.at, -1e4, 1e8);
      if (msg.reset) u.ev = [];
      if (u.ev.length + ev.length <= PresenceLogic.MAX_EV) for (const x of ev) u.ev.push(x);
      u.t = Math.max(u.t, t);
      if (msg.last) u.hist = true;
      return [...u.watchers].map(w => ({ to: w, msg: { t: 'specFrames', id, ev, at: u.t, reset: !!msg.reset, last: !!msg.last } }));
    }
    if (msg.t === 'pause') {
      if (!u.play) return [];
      u.paused = msg.paused ? num(msg.at, -1e4, 1e8) : null;
      return [...u.watchers].map(w => ({ to: w, msg: { t: 'specPause', id, paused: !!msg.paused, at: u.paused } }));
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
import { officialGet, osuApi, osuLoginState, osuStatus } from './index.js';
import { sha256hex } from './sha256.js';
import { verifyPlay } from './verify-bundle.js';

export class Matchmaker {
  constructor(state, env) { this.state = state; this.env = env; this.waiting = null; this.qp = {}; this.rooms = new Map(); this.presence = new PresenceLogic(); this.socks = new Map(); this.rq = new RankedQueue(Date.now, Math.random, () => makeCode()); }
  presenceSocket() {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const id = crypto.randomUUID().slice(0, 8);
    let joined = false;
    server.addEventListener('message', ev => { try { onMessage(ev); } catch (e) { console.error('presence message', e); } });
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
            if (!this.presence.boards.has(tkey)) this.presence.boards.set(tkey, Array.isArray(lb) ? lb : []);
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
          if (!this.presence.boards.has(key)) this.presence.boards.set(key, Array.isArray(v) ? v : []);
          if (this.presence.users.has(id)) this.send(this.presence.message(id, msg));
        });
        return;
      }
      this.send(this.presence.message(id, msg));
    };
    const gone = () => { if (!joined) return; joined = false; this.socks.delete(id); this.send(this.presence.leave(id)); };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }
  /** A finished play, to be judged here: { pid, key, osu (the beatmap file, base64), play: { mods, modConfig, seed,
   *  events }, daily? }. The file's SHA-256 is the beatmap's id; verifyPlay plays the key presses through the game's
   *  judging and works the score out; that score — never the player's own — goes on the boards and rankings. */
  async score(request) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !body.r || typeof body.r !== 'object') return json({ error: 'Bad request.' }, 400);
    await this.loadFriends();
    const pid = String(body.pid || '');
    if (!/^[a-z0-9]{6,24}$/.test(pid) || !this.presence.auth.has(pid) || this.presence.auth.get(pid) !== sha256hex(String(body.key || '').slice(0, 100))) return json({ error: 'Not signed in as that player.' }, 403);
    const t = Date.now(), last = (this._lastScore || (this._lastScore = new Map())).get(pid) || 0;
    if (t - last < 3000) return json({ error: 'Too many scores at once.' }, 429);
    this._lastScore.set(pid, t);
    const key = String(body.hash || ''), r = body.r;
    if (!/^[a-f0-9]{64}$/.test(key)) return json({ error: 'Bad beatmap file.' }, 400);
    if (r.error) return json({ error: r.error }, 422);
    if (!this.presence.boards.has(key)) { const v = await this.state.storage.get(`lb:${key}`).catch(() => null); if (!this.presence.boards.has(key)) this.presence.boards.set(key, Array.isArray(v) ? v : []); }
    const daily = body.daily && typeof body.daily === 'object' ? { day: String(body.daily.day || '') } : null;
    const playlist = body.playlist && typeof body.playlist === 'object' ? { id: String(body.playlist.id || '').slice(0, 12) } : null;
    await this.ensureBests(pid);
    const { out, entry, total, rank, of, best } = this.presence.recordVerified(pid, key, r, { daily, playlist });
    this.send(out);
    return json({ ok: true, key, score: entry.score, accuracy: entry.acc, combo: entry.combo, grade: entry.grade, pp: entry.pp, stars: entry.stars, total, rank, of, best });
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
        this.presence.loadRanks(rk);
        const ds = {}; for (const [k, v] of await st.list({ prefix: 'ds:' })) ds[k.slice(3)] = v;
        this.presence.loadDailyStats(ds);
        const f1 = {}; for (const [k, v] of await st.list({ prefix: 'f1:' })) f1[k.slice(3)] = v;
        this.presence.loadFirsts(f1);
        const pl = {}, plOld = [];
        for (const [k, v] of await st.list({ prefix: 'pl:' })) { if (v && Date.now() - (v.ends || 0) >= PresenceLogic.PL_KEEP) plOld.push(k); else pl[k.slice(3)] = v; }
        if (plOld.length) st.delete(plOld.slice(0, 128)).catch(() => {}); // (long-closed playlists go for good)
        this.presence.loadPlaylists(pl);
        const dc = await st.get('daily'); if (dc && typeof dc === 'object' && Array.isArray(dc.scores)) this.presence.daily = dc;
      } catch { /* storage unavailable: start empty */ }
      this.presence.load(fr, fq);
      // (a player's totals and their best plays are kept apart: the totals load with the server, the plays when needed)
      this.presence.persistRank = (pid, r) => { const { bests, _lazy, ...rest } = r; st.put(`rk:${pid}`, { ...rest, sb: 1 }).catch(() => {}); if (bests) st.put(`rb:${pid}`, bests).catch(() => {}); r.sb = 1; };
      // records from before that: split a few at a time, in the background
      const inline = [...this.presence.ranks].filter(([, r]) => !r.sb && r.bests).map(([pid]) => pid);
      const split = () => { for (const pid of inline.splice(0, 20)) { const r = this.presence.ranks.get(pid); if (r && !r.sb) this.presence.persistRank(pid, r); } if (inline.length) setTimeout(split, 500); };
      if (inline.length) setTimeout(split, 3000);
      for (const [pid, r] of this.presence.ranks) if (r.reset) { delete r.reset; this.presence.persistRank(pid, r); }
      this.restoreRanks().catch(e => console.error('restoreRanks', e));
      this.presence.persistAuth = (pid, h) => { st.put(`au:${pid}`, h).catch(() => {}); };
      this.presence.persistDaily = d => { st.put('daily', d).catch(() => {}); };
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
      this.presence.persistFirsts = (pid, m) => { (Object.keys(m).length ? st.put(`f1:${pid}`, m) : st.delete(`f1:${pid}`)).catch(() => {}); };
      this.presence.persistPlaylist = p => { st.put(`pl:${p.id}`, p).catch(() => {}); };
      this.presence.persistBoardId = (bid, key) => { this._bidMiss && this._bidMiss.delete(bid); st.put(`lbid:${bid}`, key).catch(() => {}); };
      this.presence.persistDailyStats = (pid, v) => { st.put(`ds:${pid}`, v).catch(() => {}); };
      this.presence.persistBoard = (key, list) => { st.put(`lb:${key}`, list).catch(() => {}); };
      this.presence.persistProfile = (pid, data) => { st.put(`pf:${pid}`, data).catch(() => {}); };
      this.presence.persist = (kind, pid, list) => { (list.length ? st.put(`${kind}:${pid}`, list) : st.delete(`${kind}:${pid}`)).catch(() => {}); };
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
    const b = await this.state.storage.get(`rb:${pid}`).catch(() => null);
    if (!r.bests) r.bests = b && typeof b === 'object' ? b : {};
    delete r._lazy;
  }
  /** Players whose standing started over (or who never had one) and aren't online to re-report it: their standing
   *  from the best plays their profile lists, counting only those on ranked beatmaps — the profile says so, or (shared
   *  by an older game) the song is looked up on osu! by its artist, title and difficulty name. Once per player. */
  async restoreRanks() {
    const st = this.state.storage, P = this.presence, statusOf = this._statusOf || (this._statusOf = new Map()); // (kept across the chunks)
    let lookups = 0;
    const ranked = async x => {
      if (typeof x.ranked === 'boolean') return x.ranked;
      const k = `${x.artist}|${x.title}|${x.version}|${x.creator || ''}`.toLowerCase();
      if (!statusOf.has(k)) {
        if (++lookups > 300 || !x.title) return false; // (the rest next time)
        let found = '';
        try {
          const q = encodeURIComponent(`${x.artist || ''} ${x.title}`.trim().slice(0, 200));
          const d = await officialGet(`beatmapsets/search?q=${q}&m=3&s=any`, this.env, fetch, 7 * 86400000);
          const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
          const sets = (d && d.beatmapsets) || [];
          const hit = sets.find(b => same(b.title, x.title) && same(b.artist, x.artist) && (b.beatmaps || []).some(m => same(m.version, x.version)) && (!x.creator || same(b.creator, x.creator)))
            || sets.find(b => same(b.title, x.title) && (b.beatmaps || []).some(m => same(m.version, x.version)));
          found = hit ? String(hit.status || '') : '';
        } catch { return false; }
        statusOf.set(k, found);
      }
      const v = statusOf.get(k);
      return v === 'ranked' || v === 'approved';
    };
    // (a few profiles at a time, a little apart, so it never holds the server up; done once)
    const state = await st.get('rr1').catch(() => true);
    if (state === true) return;
    const opts = { prefix: 'pf:', limit: 20 };
    if (typeof state === 'string') opts.startAfter = state;
    const page = await st.list(opts);
    let lastKey = null;
    for (const [k, data] of page) {
      lastKey = k;
      const pid = k.slice(3), rec = P.ranks.get(pid);
      if (!data || typeof data !== 'object' || !Array.isArray(data.top) || !data.top.length) continue;
      if (rec && (rec.restored || rec.pp > 0)) continue;
      if ([...P.users.values()].some(u => u.pid === pid)) continue; // (online: their game reports it)
      const flags = await Promise.all(data.top.slice(0, 50).map(x => x && typeof x === 'object' ? ranked(x) : false));
      if (lookups > 300) break;
      const rep = PresenceLogic.rankFromTop(data.top.slice(0, 50).filter((x, i) => flags[i]), () => true);
      const r = rec || { pid, name: String(data.name || 'Player').slice(0, 40), avatar: '', plays: Number(data.plays) || 0, bests: {}, pol: PresenceLogic.RANK_POLICY };
      r.restored = true;
      if (rep && (!r.rep || r.rep.pp < rep.pp)) r.rep = rep;
      PresenceLogic.settleRank(r);
      P.ranks.set(pid, r);
      if (P.persistRank) P.persistRank(pid, r);
    }
    if (lookups > 300) return; // (the osu! lookups for this start are used up: the rest next time)
    if (page.size < 20 || !lastKey) { st.put('rr1', true).catch(() => {}); return; }
    await st.put('rr1', lastKey);
    setTimeout(() => this.restoreRanks().catch(e => console.error('restoreRanks', e)), 1500);
  }
  closeGone(ids) { for (const id of ids || []) { const ws = this.socks.get(id); this.socks.delete(id); if (ws) { try { ws.close(4001, 'replaced'); } catch { /* closed */ } } } }
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
    if (url.pathname.endsWith('/presence')) {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ online: this.presence.list().length });
      await this.loadFriends();
      return this.presenceSocket();
    }
    if (url.pathname === '/judged-score' && request.method === 'POST') return this.score(request);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const now = Date.now();
    if (url.pathname.endsWith('/rooms/update')) {
      if (body.room && validCode(body.room.code)) this.rooms.set(body.room.code, { ...body.room, at: now });
      else if (typeof body.remove === 'string') this.rooms.delete(body.remove);
      return json({ ok: true });
    }
    if (url.pathname.endsWith('/rooms')) {
      for (const [c, r] of this.rooms) if (now - r.at > 40000) this.rooms.delete(c); // (live rooms check in every 15 s)
      return json({ rooms: [...this.rooms.values()].sort((a, b) => (a.state === 'playing') - (b.state === 'playing') || b.players - a.players).slice(0, 50) });
    }
    const rq = /\/api\/mp\/rq\/(join|poll|accept|decline|leave|ban|count)$/.exec(url.pathname);
    if (rq) {
      // the Ranked Play queue
      const q = this.rq, t = String(body.ticket || '');
      q.update();
      switch (rq[1]) {
        case 'join': return json(q.join(body));
        case 'poll': return json(q.status(t));
        case 'accept': return json(q.accept(t));
        case 'decline': case 'leave': return json(q.decline(t));
        case 'ban': q.ban(String(body.cid || ''), Math.min(RP.LEAVE_BAN, Number(body.ms) || 0)); return json({ ok: true });
        case 'count': return json({ queued: q.counts() });
      }
    }
    if (url.pathname.endsWith('/quickplay')) {
      // Quick Play: everyone asking within a minute for the same key count shares one lobby (the room turns away
      // late arrivals once it has started, and the client asks again with `not` for a fresh one)
      const keys = Number(body.keys) === 7 ? 7 : 4, cur = this.qp[keys];
      if (cur && now - cur.at < 60000 && cur.code !== body.not) return json({ code: cur.code, host: false });
      const code = makeCode();
      this.qp[keys] = { code, at: now };
      return json({ code, host: true });
    }
    if (this.waiting && now - this.waiting.at > 40000) this.waiting = null;
    if (url.pathname.endsWith('/cancel')) { if (this.waiting && this.waiting.code === body.code) this.waiting = null; return json({ ok: true }); }
    if (url.pathname.endsWith('/keep')) { if (this.waiting && this.waiting.code === body.code) this.waiting.at = now; return json({ ok: !!this.waiting && this.waiting.code === body.code }); }
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
  let bytes;
  try { bytes = Uint8Array.from(atob(String(body.osu || '')), c => c.charCodeAt(0)); } catch { return { body, res: json({ error: 'Bad beatmap file.' }, 400) }; }
  if (!bytes.length || bytes.length > 5e6) return { body, res: json({ error: 'Bad beatmap file.' }, 400) };
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
  // (the file's MD5 is how osu! itself knows a beatmap: it finds the set of a file that doesn't say which it's from)
  let md5 = ''; try { md5 = hex(await crypto.subtle.digest('MD5', bytes)); } catch { md5 = ''; }
  let r;
  try { r = verifyPlay(new TextDecoder().decode(bytes), body.play, { noFail }); } catch { r = { error: 'The play could not be judged.' }; }
  return { body, hash, md5, r };
}

/** A judged beatmap's ranked status on osu!: by its set id, else its beatmap id, else its file's MD5 ('' when unknown). */
export async function beatmapStatus(r, md5, env, get = officialGet) {
  const week = 7 * 86400000;
  try {
    if (r.beatmapSetId > 0) return { status: String((await get(`beatmapsets/${r.beatmapSetId}`, env, fetch, week)).status || ''), setId: r.beatmapSetId };
    const path = r.beatmapId > 0 ? `beatmaps/${r.beatmapId}` : /^[a-f0-9]{32}$/.test(md5 || '') ? `beatmaps/lookup?checksum=${md5}` : '';
    if (!path) return { status: '', setId: 0 };
    const b = await get(path, env, fetch, week), set = b && b.beatmapset;
    return { status: String((set && set.status) || (b && b.status) || ''), setId: (b && b.beatmapset_id) || (set && set.id) || 0 };
  } catch { return { status: '', setId: 0 }; }
}

export async function handleMultiplayer(request, env, url) {
  if (!env.ROOMS || !env.MATCHMAKER) return json({ error: 'Multiplayer is not enabled on this server.' }, 503);
  const path = url.pathname;
  if (path === '/api/mp/new' && request.method === 'POST') return json({ code: makeCode() });
  if (path === '/api/mp/presence') {
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
    return stub.fetch(new Request(new URL(path, url), request));
  }
  if (path === '/api/mp/score' && request.method === 'POST') {
    const j = await judgePlay(request, {});
    if (j.res) return j.res;
    // (as in osu!, only ranked / approved beatmaps give pp: the set's status from the osu! API, kept a week)
    if (j.r && !j.r.error && j.r.pp > 0 && env.TEST_ALL_RANKED !== '1') {
      const { status: st, setId } = await beatmapStatus(j.r, j.md5, env);
      if (setId > 0 && !(j.r.beatmapSetId > 0)) j.r = { ...j.r, beatmapSetId: setId };
      if (st !== 'ranked' && st !== 'approved') j.r = { ...j.r, pp: 0, unranked: true };
    }
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
    return stub.fetch(new Request(new URL('/judged-score', url), { method: 'POST', body: JSON.stringify({ pid: j.body.pid, key: j.body.key, daily: j.body.daily, playlist: j.body.playlist, hash: j.hash, r: j.r }), headers: { 'content-type': 'application/json' } }));
  }
  if (path === '/api/mp/rooms') {
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
    return stub.fetch(new Request(new URL(path, url)));
  }
  // (the queue's ban is only called by the rooms themselves, straight to the Durable Object)
  if ((path.startsWith('/api/mp/quick') || /^\/api\/mp\/rq\/(join|poll|accept|decline|leave|count)$/.test(path)) && request.method === 'POST') {
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
    return stub.fetch(new Request(new URL(path, url), { method: 'POST', body: await request.text(), headers: { 'content-type': 'application/json' } }));
  }
  const m = /^\/api\/mp\/room\/([A-Za-z0-9]{4,8})(\/status|\/verify)?$/.exec(path);
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
