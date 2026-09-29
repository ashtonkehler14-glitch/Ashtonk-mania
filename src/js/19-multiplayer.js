/* Multiplayer architecture (not exposed in the UI yet — no server exists).
 * The state model is transport-agnostic so a WebSocket/WebRTC transport can be dropped in later
 * without touching single-player code. Gameplay already produces everything a room needs:
 * deterministic input streams (replays) and per-judgement score updates. */

const RoomState = { OPEN: 'open', COUNTDOWN: 'countdown', PLAYING: 'playing', RESULTS: 'results' };

class MultiplayerTransport {
  /** @param {(msg:object)=>void} onMessage */
  connect(onMessage) { throw new Error('No multiplayer transport configured'); }
  send(msg) { throw new Error('not connected'); }
  close() {}
}

class MultiplayerRoom extends Emitter {
  constructor({ id, name, host, transport }) {
    super();
    this.id = id; this.name = name; this.hostId = host;
    this.transport = transport;
    this.state = RoomState.OPEN;
    this.players = new Map();     // id -> {id, name, ready, spectating, score, accuracy, combo, health, finished}
    this.map = null;              // {hash, title, version}
    this.mods = [];
    this.countdownEnd = 0;        // shared wall-clock (ms) at which audio starts
  }
  join(player) { this.players.set(player.id, { ready: false, spectating: false, score: 0, accuracy: 1, combo: 0, health: 1, finished: false, ...player }); this.emit('players'); }
  leave(id) { this.players.delete(id); if (id === this.hostId) this.hostId = this.players.keys().next().value || null; this.emit('players'); }
  setReady(id, ready) { const p = this.players.get(id); if (p) { p.ready = ready; this.emit('players'); } }
  setSpectating(id, v) { const p = this.players.get(id); if (p) { p.spectating = v; this.emit('players'); } }
  selectMap(map, mods = []) { this.map = map; this.mods = mods; for (const p of this.players.values()) p.ready = false; this.emit('map'); }
  get allReady() { const act = [...this.players.values()].filter(p => !p.spectating); return act.length > 0 && act.every(p => p.ready); }
  /** Host starts a synchronized countdown; every client schedules Music.play relative to countdownEnd. */
  startCountdown(ms = 5000, now = Date.now()) {
    if (!this.allReady) return false;
    this.state = RoomState.COUNTDOWN; this.countdownEnd = now + ms; this.emit('countdown', this.countdownEnd);
    return true;
  }
  begin() { this.state = RoomState.PLAYING; for (const p of this.players.values()) { p.finished = false; p.score = 0; } this.emit('start'); }
  /** Live score update (from GameplayEngine judgements) — used for the in-game scoreboard. */
  updateScore(id, { score, accuracy, combo, health }) {
    const p = this.players.get(id); if (!p) return;
    Object.assign(p, { score, accuracy, combo, health }); this.emit('scores', this.scoreboard());
  }
  finish(id, result) { const p = this.players.get(id); if (p) { p.finished = true; p.result = result; } if ([...this.players.values()].every(x => x.spectating || x.finished)) { this.state = RoomState.RESULTS; this.emit('results', this.scoreboard()); } }
  scoreboard() { return [...this.players.values()].filter(p => !p.spectating).sort((a, b) => b.score - a.score); }
  /** Spectating: a spectator receives the player's input events and feeds them into a replay-mode GameplayEngine. */
  relayInputs(id, events) { this.emit('inputs', { id, events }); }
}
