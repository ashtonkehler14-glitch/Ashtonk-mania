// Online 1v1 multiplayer for Ashtonk!mania.
//  - MatchRoom (Durable Object, one per room code) relays a tiny JSON protocol over WebSockets.
//  - Matchmaker (Durable Object, single instance) pairs players for "Quick match".
//  - RoomLogic holds all room rules and is plain JS so it can be unit-tested in Node.
//
// Protocol (client → server): hello {name, create}, chat {text}, suggest {map}, diff {diff}, map {map, mods, modConfig} (host),
// hasMap {has}, ready {ready}, start (host), score {score, acc, combo, hp}, finish {result}, quit, ping {c}.
// Server → client: welcome {you, room}, room {room}, chat {...}, start {delay, map, mods, modConfig},
// opp {id, score, acc, combo, hp}, results {results}, error {msg, fatal}, pong {c, s}.

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const START_DELAY = 5000;
const MAX_PLAYERS = 2;

export function makeCode(len = 6, rnd = Math.random) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)];
  return s;
}
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

export class RoomLogic {
  constructor(code, now = () => Date.now()) {
    this.code = code; this.now = now;
    this.players = []; this.hostId = null; this.created = false;
    this.map = null; this.mods = []; this.modConfig = null;
    this.state = 'lobby'; this.deadline = 0; this.lastResults = null; this.departed = [];
  }
  get(id) { return this.players.find(p => p.id === id); }
  snapshot() {
    return {
      code: this.code, state: this.state, host: this.hostId, map: this.map, mods: this.mods, modConfig: this.modConfig,
      players: this.players.map(p => ({ id: p.id, name: p.name, ready: p.ready, hasMap: p.hasMap, playing: p.playing, diff: p.diff })),
    };
  }
  roomMsg() { return { to: 'all', msg: { t: 'room', room: this.snapshot() } }; }
  system(text) { return { to: 'all', msg: { t: 'chat', from: null, name: '', text, ts: this.now() } }; }

  join(id, name, create) {
    if (!this.created && !create) return { ok: false, error: 'Room not found — check the code.' };
    if (this.players.length >= MAX_PLAYERS) return { ok: false, error: 'This room is full.' };
    if (this.state !== 'lobby') return { ok: false, error: 'A match is in progress in this room.' };
    this.created = true;
    const p = { id, name: str(name, 24) || 'Player', ready: false, hasMap: false, playing: false, finished: null, live: null, diff: null };
    this.players.push(p);
    if (!this.hostId) this.hostId = id;
    return { ok: true, out: [{ to: id, msg: { t: 'welcome', you: id, room: this.snapshot() } }, this.roomMsg(), this.system(`${p.name} joined the room`)] };
  }

  leave(id) {
    const p = this.get(id);
    if (!p) return [];
    const out = [];
    if (this.state === 'playing' && p.playing) {
      if (!p.finished) p.finished = { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc } : {}), forfeit: true };
      this.departed.push({ id: p.id, name: p.name, diff: p.diff, ...p.finished, left: true });
    }
    this.players = this.players.filter(x => x !== p);
    if (this.state === 'playing') out.push(...this.checkFinished(true));
    if (!this.players.length) { this.reset(); return out; }
    if (this.hostId === id) this.hostId = this.players[0].id;
    for (const x of this.players) x.ready = false;
    out.push(this.roomMsg(), this.system(`${p.name} left the room`));
    return out;
  }
  reset() {
    this.created = false; this.hostId = null; this.map = null; this.mods = []; this.modConfig = null;
    this.state = 'lobby'; this.deadline = 0; this.lastResults = null; this.departed = [];
  }

  message(id, m) {
    const p = this.get(id);
    if (!p || !m || typeof m !== 'object') return [];
    const host = id === this.hostId;
    switch (m.t) {
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
        this.mods = Array.isArray(m.mods) ? m.mods.filter(x => typeof x === 'string' && /^[A-Z]{2,3}$/.test(x) && x !== 'AT').slice(0, 12) : [];
        this.modConfig = m.modConfig && typeof m.modConfig === 'object' ? Object.fromEntries(Object.entries(m.modConfig).slice(0, 12).map(([k, v]) => [str(k, 16), num(v, -1e4, 1e4)])) : null;
        for (const x of this.players) { x.ready = false; x.diff = null; if (x.id !== id) x.hasMap = false; }
        p.hasMap = true;
        return [this.roomMsg(), this.system(`Beatmap changed to ${map.artist} - ${map.title} [${map.version}]`)];
      }
      case 'diff': {
        // each player may play any difficulty of the room's beatmap set
        if (this.state !== 'lobby' || !this.map) return [];
        const d = m.diff && typeof m.diff === 'object' ? m.diff : null;
        p.diff = d ? { version: str(d.version, 200), stars: num(d.stars, 0, 100), keys: Math.round(num(d.keys, 1, 18, 4)) } : null;
        return [this.roomMsg()];
      }
      case 'hasMap': p.hasMap = !!m.has; if (!p.hasMap) p.ready = false; return [this.roomMsg()];
      case 'ready':
        if (this.state !== 'lobby') return [];
        p.ready = !!m.ready && !!this.map && p.hasMap;
        return [this.roomMsg()];
      case 'start': {
        if (!host || this.state !== 'lobby') return [];
        if (this.players.length < 2) return [{ to: id, msg: { t: 'error', msg: 'Wait for an opponent to join.' } }];
        if (!this.map || !this.players.every(x => x.ready && x.hasMap)) return [{ to: id, msg: { t: 'error', msg: 'Both players need to be ready.' } }];
        this.state = 'playing';
        this.deadline = this.now() + START_DELAY + (this.map.length || 600000) / rateOf(this.mods, this.modConfig) + 60000;
        for (const x of this.players) { x.playing = true; x.finished = null; x.live = null; }
        this.departed = [];
        return [{ to: 'all', msg: { t: 'start', delay: START_DELAY, map: this.map, mods: this.mods, modConfig: this.modConfig } }, this.roomMsg()];
      }
      case 'score':
        if (this.state !== 'playing' || !p.playing || p.finished) return [];
        p.live = { score: Math.round(num(m.score, 0, 1e7)), acc: num(m.acc, 0, 1), combo: Math.round(num(m.combo, 0, 1e6)), hp: num(m.hp, 0, 1) };
        return [{ to: { except: id }, msg: { t: 'opp', id, ...p.live } }];
      case 'finish':
        if (this.state !== 'playing' || !p.playing || p.finished) return [];
        p.finished = cleanResult(m.result);
        return this.checkFinished();
      case 'quit':
        if (this.state !== 'playing' || !p.playing || p.finished) return [];
        p.finished = { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc } : {}), forfeit: true };
        return [this.system(`${p.name} quit the match`), ...this.checkFinished()];
    }
    return [];
  }

  /** Called periodically: players who never report back are timed out. */
  tick() {
    if (this.state !== 'playing' || this.now() < this.deadline) return [];
    for (const p of this.players) if (p.playing && !p.finished) p.finished = { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc } : {}), forfeit: true };
    return this.checkFinished();
  }

  checkFinished(someoneLeft = false) {
    if (this.state !== 'playing') return [];
    const active = this.players.filter(p => p.playing);
    const done = active.every(p => p.finished);
    // someone left mid-match: the player still here wins by forfeit straight away
    if (!done && !(someoneLeft && active.length === 1)) return [];
    const row = p => ({ id: p.id, name: p.name, diff: p.diff, ...(p.finished || { ...cleanResult(p.live ? { score: p.live.score, accuracy: p.live.acc } : {}), pending: true }) });
    const rows = [...active.map(row), ...this.departed];
    const order = (a, b) => (a.forfeit - b.forfeit) || (b.score - a.score) || (b.accuracy - a.accuracy);
    rows.sort(order);
    const winner = rows.length === 1 ? rows[0].id : rows.length > 1 && order(rows[0], rows[1]) !== 0 ? rows[0].id : null;
    this.lastResults = { rows, winner, map: this.map, mods: this.mods, at: this.now() };
    this.state = 'lobby'; this.deadline = 0; this.departed = [];
    for (const p of this.players) { p.playing = false; p.ready = false; p.finished = null; p.live = null; }
    return [{ to: 'all', msg: { t: 'results', results: this.lastResults } }, this.roomMsg()];
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
  constructor(state, env) { this.state = state; this.env = env; this.logic = null; this.socks = new Map(); this.timer = null; }
  async fetch(request) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code') || '';
    if (!this.logic) this.logic = new RoomLogic(code);
    if (url.pathname.endsWith('/status')) return json({ code, open: this.logic.created, players: this.logic.players.length, state: this.logic.state });
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a WebSocket upgrade' }, 426);
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const id = crypto.randomUUID().slice(0, 8);
    let joined = false;
    server.addEventListener('message', ev => {
      if (typeof ev.data !== 'string' || ev.data.length > 8192) return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (!joined) {
        if (msg.t !== 'hello') return;
        const r = this.logic.join(id, msg.name, !!msg.create);
        if (!r.ok) { try { server.send(JSON.stringify({ t: 'error', msg: r.error, fatal: true })); server.close(4000, 'rejected'); } catch { /* closed */ } return; }
        joined = true; this.socks.set(id, server);
        this.dispatch(r.out);
        return;
      }
      this.dispatch(this.logic.message(id, msg));
      this.schedule();
    });
    const gone = () => {
      if (!joined) return;
      joined = false; this.socks.delete(id);
      this.dispatch(this.logic.leave(id));
    };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }
  schedule() {
    if (this.logic.state !== 'playing' || this.timer) return;
    this.timer = setInterval(() => {
      this.dispatch(this.logic.tick());
      if (this.logic.state !== 'playing') { clearInterval(this.timer); this.timer = null; }
    }, 5000);
  }
  dispatch(out) {
    for (const { to, msg } of out || []) {
      const data = JSON.stringify(msg);
      for (const [id, ws] of this.socks) {
        const hit = to === 'all' || to === id || (to && typeof to === 'object' && to.except !== id);
        if (hit) { try { ws.send(data); } catch { /* socket closing */ } }
      }
    }
  }
}

/** Quick match: the first caller hosts a fresh room and waits; the next caller is sent to that room. */
export class Matchmaker {
  constructor(state, env) { this.state = state; this.env = env; this.waiting = null; }
  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const now = Date.now();
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
  if (path.startsWith('/api/mp/quick') && request.method === 'POST') {
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
