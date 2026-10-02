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
const defaultSettings = () => ({ type: 'h2h', win: 'score', size: MAX_PLAYERS, queue: 'host', public: true });

export class RoomLogic {
  constructor(code, now = () => Date.now(), rnd = Math.random) {
    this.code = code; this.now = now; this.rnd = rnd;
    this.players = []; this.hostId = null; this.created = false;
    this.map = null; this.mods = []; this.modConfig = null; this.vote = null;
    this.state = 'lobby'; this.deadline = 0; this.lastResults = null; this.departed = []; this.skipped = false;
    this.mode = 'custom'; this.settings = defaultSettings(); this.qp = null; this.rp = null;
  }
  get(id) { return this.players.find(p => p.id === id); }
  /** The room as one player sees it (`viewer`): in Ranked Play your own cards are shown, your opponent's are not. */
  snapshot(viewer = null) {
    const q = this.qp;
    return {
      code: this.code, state: this.state, host: this.hostId, map: this.map, mods: this.mods, modConfig: this.modConfig,
      mode: this.mode, settings: { ...this.settings },
      rp: this.rp ? this.rp.view(viewer) : null,
      qp: q ? { keys: q.keys, round: q.round, rounds: q.rounds, phase: q.phase, left: q.deadline ? Math.max(0, q.deadline - this.now()) : 0,
        pool: q.pool, picks: { ...q.picks }, chosen: q.chosen, points: { ...q.points } } : null,
      vote: this.vote ? { mods: this.vote.mods, by: this.vote.by, yes: [...this.vote.yes] } : null,
      players: this.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, ready: p.ready, hasMap: p.hasMap, playing: p.playing, diff: p.diff, mods: p.mods, team: p.team, away: !!p.away })),
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
      return { ok: true, as: back.id, out: [{ to: back.id, msg: { t: 'welcome', you: back.id, room: this.snapshot(back.id) } }, this.roomMsg(), this.system(`${back.name} reconnected`)] };
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
      team: this.settings.type === 'teams' ? this.smallerTeam() : null, sr: num(opts.sr, 0, 15, 0), cid: str(opts.cid, 40), away: false, awayUntil: 0 };
    this.players.push(p);
    if (!this.hostId) this.hostId = id;
    if (this.qp) { this.qp.points[id] = 0; this.qpGather(); }
    const out = [{ to: id, msg: { t: 'welcome', you: id, room: this.snapshot(id) } }, this.roomMsg(), this.system(`${p.name} joined the room`)];
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
        p.hasMap = !!m.has; if (!p.hasMap) p.ready = false;
        if (this.qp && this.qp.phase === 'load' && this.state === 'lobby') return [...this.qpMaybeStart(), this.roomMsg()];
        if (this.rp) return [...this.rp.mapState(), this.roomMsg()];
        return [this.roomMsg()];
      case 'ready':
        if (this.state !== 'lobby') return [];
        p.ready = !!m.ready && !!this.map && p.hasMap;
        return [this.roomMsg()];
      case 'start': {
        if (!host || this.state !== 'lobby') return [];
        if (this.players.length < 2) return [{ to: id, msg: { t: 'error', msg: 'Wait for an opponent to join.' } }];
        if (!this.map || !this.players.every(x => x.ready && x.hasMap)) return [{ to: id, msg: { t: 'error', msg: 'Everyone needs to be ready.' } }];
        if (this.vote) return [{ to: id, msg: { t: 'error', msg: 'Everyone has to accept (or decline) the speed mod first.' } }];
        return this.beginMatch(this.players);
      }
      case 'skip': {
        // the intro is only skipped once every player still playing has asked to
        if (this.state !== 'playing' || !p.playing || p.finished || this.skipped || p.skip) return [];
        p.skip = true;
        const active = this.players.filter(x => x.playing && !x.finished);
        const votes = active.filter(x => x.skip).length;
        if (votes < active.length) return [{ to: 'all', msg: { t: 'skipvote', votes, total: active.length } }];
        this.skipped = true;
        return [{ to: 'all', msg: { t: 'skip' } }];
      }
      case 'score':
        if (this.state !== 'playing' || !p.playing || p.finished) return [];
        p.live = { score: Math.round(num(m.score, 0, 1e7)), acc: num(m.acc, 0, 1), combo: Math.round(num(m.combo, 0, 1e6)), maxCombo: Math.round(num(m.maxCombo, 0, 1e6)), hp: num(m.hp, 0, 1), pp: num(m.pp, 0, 1e5) };
        return [{ to: { except: id }, msg: { t: 'opp', id, ...p.live } }];
      case 'finish':
        if (this.state !== 'playing' || !p.playing || p.finished) return [];
        p.finished = cleanResult(m.result);
        return this.checkFinished();
      case 'quit':
        if (this.state !== 'playing' || !p.playing || p.finished) return [];
        // Ranked Play: leaving the song scores 0 for this round; the other player plays on
        if (this.rp) { p.finished = { ...cleanResult({ score: 0, accuracy: p.live ? p.live.acc : 0, maxCombo: p.live ? p.live.maxCombo : 0 }), forfeit: true }; return [this.system(`${p.name} left the song`), ...this.checkFinished()]; }
        p.finished = { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc, pp: p.live.pp } : {}), forfeit: true };
        return [this.system(`${p.name} quit the match`), ...this.checkFinished()];
    }
    return [];
  }

  /** Start a match for `list` (everyone in a custom room; whoever loaded the beatmap in Quick Play). */
  beginMatch(list) {
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
  wantsTick() { return this.state === 'playing' || this.players.some(p => p.away) || !!(this.qp && this.qp.deadline) || !!(this.rp && this.rp.deadline); }

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
      if (this.now() < this.deadline) return out;
      for (const p of this.players) if (p.playing && !p.finished) p.finished = { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc, pp: p.live.pp } : {}), forfeit: true };
      return [...out, ...this.checkFinished()];
    }
    if (this.state !== 'lobby') return out;
    return [...out, ...(this.rp ? this.rp.tick() : this.qpTick())];
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
    for (const p of this.players) { p.playing = false; p.ready = false; p.finished = null; p.live = null; }
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
    if (url.pathname.endsWith('/status')) return json({ code, open: this.logic.created, players: this.logic.players.length, state: this.logic.state });
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a WebSocket upgrade' }, 426);
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    let id = crypto.randomUUID().slice(0, 8);
    let joined = false;
    server.addEventListener('message', ev => {
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
    });
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
  schedule() {
    if (this.timer || !this.logic.wantsTick()) return;
    this.timer = setInterval(() => {
      this.dispatch(this.logic.tick());
      if (!this.logic.wantsTick()) { clearInterval(this.timer); this.timer = null; }
    }, 1000);
  }
  dispatch(out) {
    if (out && out.length) this.announce();
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

/** Who's online, and invites between them. Presence protocol (client → server): hello {name, status},
 *  status {status, room}, invite {to, code}, ping. Server → client: welcome {you}, online {players},
 *  invite {from: {id, name}, code}, invited {to}, error {msg}. Plain JS so it can be unit-tested. */
export class PresenceLogic {
  constructor(now = () => Date.now()) { this.now = now; this.users = new Map(); this.lastInvite = new Map(); }
  static STALE = 70000; // clients ping every 10 s (a background tab maybe once a minute); silent this long = gone (a dropped connection may never say so)
  list() { return [...this.users.entries()].map(([id, u]) => ({ id, name: u.name, status: u.status, avatar: u.avatar })); }
  join(id, msg) {
    // the same browser tab reconnecting replaces its old entry straight away (no ghost of yourself)
    const cid = str(msg && msg.cid, 40), gone = [];
    if (cid) for (const [oid, u] of this.users) if (u.cid === cid) { this.users.delete(oid); gone.push(oid); }
    this.users.set(id, { name: str(msg && msg.name, 24) || 'Player', status: cleanStatus(msg && msg.status), avatar: cleanAvatar(msg && msg.avatar), cid, seen: this.now() });
    this.dropped = gone;
    return [{ to: id, msg: { t: 'welcome', you: id } }, this.broadcast()];
  }
  /** Forget everyone who hasn't been heard from in a while; returns their ids (to close) and the update. */
  prune() {
    const t = this.now(), gone = [];
    for (const [id, u] of this.users) if (t - u.seen > PresenceLogic.STALE) { this.users.delete(id); this.lastInvite.delete(id); gone.push(id); }
    return { gone, out: gone.length ? [this.broadcast()] : [] };
  }
  leave(id) { if (!this.users.delete(id)) return []; this.lastInvite.delete(id); return [this.broadcast()]; }
  broadcast() { return { to: 'all', msg: { t: 'online', players: this.list() } }; }
  message(id, msg) {
    const u = this.users.get(id);
    if (!u || !msg || typeof msg !== 'object') return [];
    u.seen = this.now();
    if (msg.t === 'list') return [{ to: id, msg: { t: 'online', players: this.list() } }];
    if (msg.t === 'status') {
      const st = cleanStatus(msg.status), name = msg.name != null ? str(msg.name, 24) || u.name : u.name, av = msg.avatar != null ? cleanAvatar(msg.avatar) : u.avatar;
      if (st === u.status && name === u.name && av === u.avatar) return [];
      u.status = st; u.name = name; u.avatar = av;
      return [this.broadcast()];
    }
    if (msg.t === 'invite') {
      const code = str(msg.code, 8).toUpperCase();
      if (!validCode(code) || !this.users.has(msg.to) || msg.to === id) return [{ to: id, msg: { t: 'error', msg: 'That player is no longer online.' } }];
      const key = `${msg.to}|${code}`, t = this.now();
      if (this.lastInvite.get(id)?.key === key && t - this.lastInvite.get(id).at < 3000) return []; // double-click
      this.lastInvite.set(id, { key, at: t });
      return [{ to: msg.to, msg: { t: 'invite', from: { id, name: u.name }, code } }, { to: id, msg: { t: 'invited', to: msg.to } }];
    }
    if (msg.t === 'ping') return [{ to: id, msg: { t: 'pong' } }];
    return [];
  }
}
const cleanStatus = s => ['menu', 'room', 'playing'].includes(s) ? s : 'menu';

/** Quick match: the first caller hosts a fresh room and waits; the next caller is sent to that room.
 *  The same (single) instance also runs presence — who's online — for invites. */
import { officialFetch, osuLoginState } from './index.js';

export class Matchmaker {
  constructor(state, env) { this.state = state; this.env = env; this.waiting = null; this.qp = {}; this.rooms = new Map(); this.presence = new PresenceLogic(); this.socks = new Map(); this.rq = new RankedQueue(Date.now, Math.random, () => makeCode()); }
  presenceSocket() {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const id = crypto.randomUUID().slice(0, 8);
    let joined = false;
    server.addEventListener('message', ev => {
      if (typeof ev.data !== 'string' || ev.data.length > 16384) return;
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
      this.send(this.presence.message(id, msg));
    });
    const gone = () => { if (!joined) return; joined = false; this.socks.delete(id); this.send(this.presence.leave(id)); };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
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
    if (url.pathname === '/osu/search') {
      if (!this._osuLoaded) { this._osuLoaded = true; osuLoginState.set(await this.state.storage.get('osuLogin').catch(() => null)); }
      const save = () => { const st = osuLoginState.get(); this.state.storage.put('osuLogin', st).catch(() => {}); };
      try { const d = await officialFetch(url.search.slice(1), this.env); save(); return json(d); } catch (e) { save(); return json({ error: e.message }, 502); }
    }
    if (url.pathname.endsWith('/presence')) {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ online: this.presence.list().length });
      return this.presenceSocket();
    }
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
export async function handleMultiplayer(request, env, url) {
  if (!env.ROOMS || !env.MATCHMAKER) return json({ error: 'Multiplayer is not enabled on this server.' }, 503);
  const path = url.pathname;
  if (path === '/api/mp/new' && request.method === 'POST') return json({ code: makeCode() });
  if (path === '/api/mp/presence') {
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
    return stub.fetch(new Request(new URL(path, url), request));
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
  const m = /^\/api\/mp\/room\/([A-Za-z0-9]{4,8})(\/status)?$/.exec(path);
  if (m) {
    const code = m[1].toUpperCase();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const u = new URL(url); u.searchParams.set('code', code);
    return stub.fetch(new Request(u, request));
  }
  return json({ error: 'Not found' }, 404);
}
