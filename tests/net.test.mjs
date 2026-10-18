// Requests that stop answering: given up on (no spinner for ever), while a slow download that keeps coming isn't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { load } from './load.mjs';

const { timeoutSignal, __ctx } = load(['00-util.js']);
Object.assign(__ctx, { fetch, AbortController, AbortSignal, TransformStream });
const { fetchStalled } = __ctx; // (an async function: not among load()'s names)

/** A server: '/stall' sends a little and then nothing; '/slow' sends a part every 60 ms for a while; '/silent' never answers. */
function serve() {
  return new Promise(res => {
    const s = createServer((req, r) => {
      if (req.url === '/silent') return;
      r.writeHead(200, { 'content-type': 'application/zip' });
      if (req.url === '/stall') { r.write('PK'); return; }
      let n = 0;
      const t = setInterval(() => { r.write('x'.repeat(100)); if (++n === 10) { clearInterval(t); r.end(); } }, 60);
    }).listen(0, () => res(s));
  });
}

test('a download that stops part-way is given up on; a slow one that keeps coming is waited for', async () => {
  const s = await serve(), base = `http://127.0.0.1:${s.address().port}`;
  try {
    const t0 = Date.now();
    await assert.rejects((await fetchStalled(base + '/stall', {}, 200)).arrayBuffer());
    assert.ok(Date.now() - t0 < 2000);
    await assert.rejects(fetchStalled(base + '/silent', {}, 200));
    const r = await fetchStalled(base + '/slow', {}, 200); // (600 ms in all, longer than the 200 ms it may go quiet)
    assert.equal(r.headers.get('content-type'), 'application/zip');
    assert.equal((await r.arrayBuffer()).byteLength, 1000);
    await assert.rejects(fetch(base + '/silent', { signal: timeoutSignal(150) }), e => e.name === 'TimeoutError' || e.name === 'AbortError');
  } finally { s.closeAllConnections(); s.close(); }
});
