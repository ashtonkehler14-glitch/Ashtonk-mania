// The multiplayer connection by plain requests (for networks that won't let a WebSocket through): HttpSock stands in
// for a WebSocket on the server, httpSession serves the player's requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSock, httpSession } from '../worker/multiplayer.js';

/** A stand-in room: echoes each message back, says welcome to a hello, and records what happened. */
function room() {
  const log = { msgs: [], gone: 0, touched: 0 };
  const attach = sock => ({
    message(text) { const m = JSON.parse(text); log.msgs.push(m); sock.send(JSON.stringify(m.t === 'hello' ? { t: 'welcome' } : { t: 'echo', m })); },
    touch() { log.touched++; },
    gone() { log.gone++; },
  });
  return { log, attach: sock => { const h = attach(sock); sock.onclose = () => h.gone(); return h; } };
}

test('the first request opens a connection, carries its hello and gets the answer straight away', async () => {
  const map = new Map(), r = room();
  const d = await httpSession(map, { msgs: [JSON.stringify({ t: 'hello', name: 'A' })], poll: true }, r.attach);
  assert.ok(d.sid && map.has(d.sid));
  assert.deepEqual(d.msgs.map(x => JSON.parse(x).t), ['welcome']);
  assert.equal(r.log.touched, 2); // (each request is a sign of life: as it comes in, and as it's answered)
});

test('messages sent go in in order; a waiting poll is answered as soon as there is something', async () => {
  const map = new Map(), r = room();
  const { sid } = await httpSession(map, { msgs: [JSON.stringify({ t: 'hello' })], poll: true }, r.attach);
  const poll = httpSession(map, { sid, poll: true }, r.attach); // (held open: nothing queued yet)
  const sent = await httpSession(map, { sid, msgs: [JSON.stringify({ t: 'a' }), JSON.stringify({ t: 'b' })] }, r.attach);
  assert.deepEqual(sent.msgs, []); // (a send doesn't take what's queued: the poll does, in order)
  const got = await poll;
  assert.deepEqual(got.msgs.map(x => JSON.parse(x).m.t), ['a', 'b']);
  assert.deepEqual(r.log.msgs.map(m => m.t), ['hello', 'a', 'b']);
});

test('a poll with nothing to take answers empty after the wait', async () => {
  const map = new Map(), r = room();
  const { sid } = await httpSession(map, { msgs: [JSON.stringify({ t: 'hello' })], poll: true }, r.attach);
  const t0 = Date.now();
  const d = await httpSession(map, { sid, poll: true, wait: 50 }, r.attach);
  assert.deepEqual(d.msgs, []);
  assert.ok(Date.now() - t0 >= 40);
});

test('closing: by the player (the room hears they left), by the server (the poll says so), and a gone session', async () => {
  const map = new Map(), r = room();
  const a = await httpSession(map, { msgs: [JSON.stringify({ t: 'hello' })], poll: true }, r.attach);
  const bye = await httpSession(map, { sid: a.sid, close: true }, r.attach);
  assert.equal(bye.closed.code, 1000); assert.equal(r.log.gone, 1); assert.ok(!map.has(a.sid));
  // (a request for a connection that's gone: told it's closed, so the game connects again)
  const late = await httpSession(map, { sid: a.sid, poll: true }, r.attach);
  assert.equal(late.closed.code, 4001);
  // the server closing it (kicked, replaced): the waiting poll says so
  const b = await httpSession(map, { msgs: [JSON.stringify({ t: 'hello' })], poll: true }, r.attach);
  const p = httpSession(map, { sid: b.sid, poll: true }, r.attach);
  map.get(b.sid).close(4003, 'replaced');
  const d = await p;
  assert.deepEqual(d.closed, { code: 4003, reason: 'replaced' });
  assert.equal(r.log.gone, 2);
});

test('a connection not heard from in 45 s is closed (the player is gone)', async () => {
  let t = 1_000_000;
  const now = () => t, map = new Map(), r = room();
  const a = await httpSession(map, { msgs: [JSON.stringify({ t: 'hello' })], poll: true }, r.attach, now);
  t += 46_000;
  await httpSession(map, { msgs: [JSON.stringify({ t: 'hello' })], poll: true }, r.attach, now); // (anyone's request sweeps)
  assert.ok(!map.has(a.sid)); assert.equal(r.log.gone, 1);
});

test('HttpSock behaves as a socket: send after close does nothing, close happens once', () => {
  const s = new HttpSock('x'); let n = 0; s.onclose = () => n++;
  s.send('a'); s.close(1000); s.close(1000); s.send('b');
  assert.equal(n, 1); assert.deepEqual(s.q, ['a']);
});

test('numbered messages: kept until the player says they have them, so a reply lost on its way is sent again', async () => {
  const map = new Map(), r = room();
  const a = await httpSession(map, { msgs: [JSON.stringify({ t: 'hello' })], poll: true, ack: 0 }, r.attach);
  assert.equal(a.first, 1); assert.deepEqual(a.msgs.map(x => JSON.parse(x).t), ['welcome']);
  await httpSession(map, { sid: a.sid, msgs: [JSON.stringify({ t: 'x' }), JSON.stringify({ t: 'y' })] }, r.attach);
  // the welcome arrived (ack 1): x and y come, numbered 2 and 3 …
  const b = await httpSession(map, { sid: a.sid, poll: true, ack: 1 }, r.attach);
  assert.equal(b.first, 2); assert.deepEqual(b.msgs.map(x => JSON.parse(x).m.t), ['x', 'y']);
  // … but that reply never reached the player (a proxy cut it off): asked again with ack 1, they come again
  const c = await httpSession(map, { sid: a.sid, poll: true, ack: 1 }, r.attach);
  assert.equal(c.first, 2); assert.deepEqual(c.msgs.map(x => JSON.parse(x).m.t), ['x', 'y']);
  // once they're acknowledged they're let go, and the next poll waits for what's new
  const d = await httpSession(map, { sid: a.sid, poll: true, ack: 3, wait: 30 }, r.attach);
  assert.deepEqual(d.msgs, []); assert.equal(map.get(a.sid).q.length, 0);
  assert.equal(map.get(a.sid).base, 4);
});
