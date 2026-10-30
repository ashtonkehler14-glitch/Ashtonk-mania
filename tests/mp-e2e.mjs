// Two-player online match in headless Chromium against the real Worker + Durable Objects (run locally
// in workerd through Miniflare). Usage: MINIFLARE_DIR=<dir with node_modules/miniflare> node tests/mp-e2e.mjs
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let Miniflare;
try {
  const req = createRequire(join(process.env.MINIFLARE_DIR || root, 'package.json'));
  ({ Miniflare } = await import(pathToFileURL(req.resolve('miniflare')).href));
} catch (e) { console.log('SKIP: miniflare is not installed (set MINIFLARE_DIR)'); process.exit(0); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png' };
const mf = new Miniflare({
  modules: true, scriptPath: join(root, 'worker/index.js'), modulesRoot: root, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2026-08-01', cf: false, port: 0, host: '127.0.0.1',
  durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker', VAULT: 'PlayerVault' },
  bindings: { TEST_ALL_RANKED: '1', ADMIN_CODE: 'K7QM3XRA9DPZW2HF' }, // (the test beatmaps aren't online: count them as ranked; the admin panel's code)
  serviceBindings: {
    ASSETS: async req => {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const file = p === '/' ? join(root, 'index.html') : join(root, p);
      // (the deployed site serves public/: avatars, Neru's pictures)
      for (const f of [file, join(root, 'public', p)]) try { return new Response(readFileSync(f), { headers: { 'content-type': types[extname(f)] || 'application/octet-stream' } }); } catch { /* next */ }
      return new Response('not found', { status: 404 });
    },
  },
});
const url = String(await mf.ready);

const SHOTS = process.argv.includes('--shots');
const shotDir = process.env.SHOT_DIR || join(root, 'tests', 'shots');
const shot = async (page, n) => { if (SHOTS) await page.screenshot({ path: join(shotDir, n + '.png') }); };
/** The setup's first page: "No, I'm new", then the name. */
async function setupName(pg, name) {
  if (await pg.$('.setup-choice[data-id="new"]')) await pg.click('.setup-choice[data-id="new"]');
  await pg.fill('.onboarding .ob-name', name); await pg.keyboard.press('Enter');
}
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? '  — ' + extra : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];

async function player(name, init = null) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  if (init) await ctx.addInitScript(init);
  // Element.append(null) writes the word "null" on screen: any such call is reported as a page error
  await ctx.addInitScript(() => { for (const P of [Element.prototype, DocumentFragment.prototype]) { const o = P.append; P.append = function (...a) { if (a.some(x => x === null || x === undefined)) console.error('a null child was appended (it shows up as the text "null") to ' + (this.className || this.tagName)); return o.apply(this, a); }; } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && /null child was appended/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  if (await page.$('.onboarding')) { await setupName(page, name); await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => AshtonkMania.Onboarding.finish()); await page.waitForTimeout(300); }
  // (no medal pop-ups over the tests)
  await page.evaluate(async () => {
    const M = AshtonkMania.Medals;
    AshtonkMania.Settings.set('medals.unlocked', Object.fromEntries(M.all.map(m => [m.id, 1])));
    // (one already on its way — Night Owl, the tests run after midnight — put away too)
    M.queue.length = 0;
    for (let i = 0; i < 40 && document.querySelector('.medal-ov'); i++) { document.querySelector('.medal-ov').click(); await new Promise(r => setTimeout(r, 100)); }
  });
  await page.evaluate(async () => {
    const b = await (await fetch('/tests/fixtures/test-set.osz')).blob();
    await AshtonkMania.App.importFiles([new File([b], 'test-set.osz')]);
  });
  await page.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length === 1, null, { timeout: 15000 });
  await page.evaluate(() => AshtonkMania.Screens.go('multiplayer'));
  await page.waitForTimeout(400);
  return page;
}

/** A page script for a network that won't let the game's WebSockets through (a school Chromebook's filter): each one
 *  fails before it opens, as a filter's does (1006); the rest of the web works. */
const noWebSocket = () => {
  const W = window.WebSocket;
  window.WebSocket = function (u, p) {
    if (!/\/api\/mp\//.test(String(u))) return new W(u, p);
    const f = { readyState: 0, url: String(u), send() {}, close() {} };
    setTimeout(() => { f.readyState = 3; if (f.onerror) f.onerror(new Event('error')); if (f.onclose) f.onclose({ code: 1006, reason: '' }); }, 30);
    return f;
  };
};

// Create room: public or private (the lounge only makes regular rooms)
async function createRoom(page, ranked, isPublic) {
  await page.click('.mp-create');
  await page.waitForSelector('.mp-cr');
  await page.click(`.mp-cr-card.vis[data-v="${isPublic}"]`);
  await page.click('.dialog .actions .btn.primary');
  await page.waitForFunction(() => AshtonkMania.Multiplayer.inRoom(), null, { timeout: 10000 });
}

// lazer's dangerous dialog buttons confirm only when held
// (red dialog buttons confirm on a single press)
async function holdBtn(page, sel) {
  await (await page.waitForSelector(sel)).click();
}

const alice = await player('Alice');
const bob = await player('Bob');
await shot(alice, 'mp-lobby');
// a room the server can't open (Cloudflare turning it away for the day, say): the lounge says why, and keeps saying it
// (failing redrew the lounge, which took the message with it — "Create room" looked like it did nothing)
{
  const why = 'The game\'s server has used up today\'s free allowance on Cloudflare, so rooms can\'t open — they will again after midnight UTC.';
  await alice.route(/api\/mp\/room\/[A-Z0-9]+\/status/, r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: why }) }));
  // (the plain-request way in too: the room really can't be opened, whichever way the game tries — MpNet)
  await alice.route(/api\/mp\/room\/[A-Z0-9]+\/http/, r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: why }) }));
  await alice.evaluate(() => { const W = window.WebSocket; window._W = W; window.WebSocket = function (u, p) { if (!/api\/mp\/room\//.test(String(u))) return new W(u, p); const f = { readyState: 0, close() {}, send() {} }; setTimeout(() => { f.readyState = 3; f.onerror && f.onerror({}); f.onclose && f.onclose({ code: 1006 }); }, 50); return f; }; });
  await alice.click('.mp-create'); await alice.waitForSelector('.mp-cr');
  await alice.click('.dialog .actions .btn.primary');
  await alice.waitForFunction(w => (document.querySelector('.mp-status .mp-err') || {}).textContent === `${w} (MP-RS)`, why, { timeout: 8000 }).catch(() => {});
  await alice.waitForTimeout(600);
  const r = await alice.evaluate(() => ({ status: (document.querySelector('.mp-status .mp-err') || {}).textContent, copy: !!document.querySelector('.mp-status .off-copy'), enabled: !document.querySelector('.mp-create').disabled, inRoom: AshtonkMania.Multiplayer.inRoom() }));
  // (with its error code — the server said why: MP-RS — and the details to copy)
  check('a room the server can\'t open says why in the lounge, with its error code (and Create room works again)', r.status === `${why} (MP-RS)` && r.copy && r.enabled && !r.inRoom, JSON.stringify(r));
  await alice.evaluate(() => { window.WebSocket = window._W; localStorage.removeItem('am.mpHttp'); MpNet._http = false; });
  await alice.unroute(/api\/mp\/room\/[A-Z0-9]+\/status/);
  await alice.unroute(/api\/mp\/room\/[A-Z0-9]+\/http/);
}
// a player with their own picture: a room's first message carries it, and over 16 KB the room dropped it without a word
// — the game waited, then gave up (MP-RT), so they could never get into a room. The room takes it now; and the game
// sends a room-sized copy of the picture anyway (a server not updated yet still answers)
{
  const r = await alice.evaluate(async () => {
    const big = 'data:image/webp;base64,' + 'A'.repeat(20000);
    const raw = await new Promise(res => {
      const ws = new WebSocket(AshtonkMania.Host.ws('api/mp/room/BIGAV1'));
      const t = setTimeout(() => { res('no answer'); try { ws.close(); } catch {} }, 6000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: 'Big', avatar: big, create: true, pid: 'bigavatar01', cid: 'bigav' }));
      ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.t === 'welcome' || m.t === 'error') { clearTimeout(t); res(m.t); ws.close(); } };
    });
    const P = AshtonkMania.ProfileManager, was = [P.sharedAvatar, P.roomAvatar];
    // (the game's own hello, with a picture too big for a room: it goes, and fits)
    let sent = 0; const W = window.WebSocket.prototype.send;
    window.WebSocket.prototype.send = function (d) { if (/"t":"hello"/.test(d) && /api\/mp\/room\//.test(this.url)) sent = d.length; return W.call(this, d); };
    P.sharedAvatar = big; P.roomAvatar = big;
    let joined = false;
    try { await AshtonkMania.Multiplayer.create({ isPublic: false }); joined = AshtonkMania.Multiplayer.inRoom(); } catch (e) { joined = e.message; }
    AshtonkMania.Multiplayer.leave(); window.WebSocket.prototype.send = W; [P.sharedAvatar, P.roomAvatar] = was;
    return { raw, joined, sent };
  });
  check('a player with a big picture of their own gets into a room (the server answers a 20 KB hello; the game keeps its own under 16 KB)', r.raw === 'welcome' && r.joined === true && r.sent > 0 && r.sent < 16000, JSON.stringify(r));
}
// a network that won't let a WebSocket through (a school Chromebook's web filter or proxy: the web works, the multiplayer
// connection never opens — MP-RT): the game goes over plain requests instead, and plays with everyone else as before
{
  const carol = await player('Carol', noWebSocket);
  await carol.waitForFunction(() => { const P = AshtonkMania.Presence; return P.ws && P.ws.http && P.ws.readyState === 1 && P.me; }, null, { timeout: 20000 }).catch(() => {});
  const on = await carol.evaluate(() => ({ http: !!(AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.http), me: !!AshtonkMania.Presence.me, kept: !!localStorage.getItem('am.mpHttp') }));
  await alice.waitForFunction(() => AshtonkMania.Presence.players.some(p => p.name === 'Carol'), null, { timeout: 15000 }).catch(() => {});
  const seen = await alice.evaluate(() => AshtonkMania.Presence.players.some(p => p.name === 'Carol'));
  const code = await carol.evaluate(async () => { await AshtonkMania.Multiplayer.create({ isPublic: false }); return AshtonkMania.Multiplayer.inRoom() && AshtonkMania.Multiplayer.ws.http ? AshtonkMania.Multiplayer.code : null; });
  await alice.evaluate(c => AshtonkMania.Multiplayer.join(c), code);
  await carol.waitForFunction(() => AshtonkMania.Multiplayer.room && AshtonkMania.Multiplayer.room.players.length === 2, null, { timeout: 10000 }).catch(() => {});
  // (and a proxy that lets the server answer, then loses the answer on its way back: what was in it comes again —
  // once — on the same connection)
  let cut = 0, held = 0;
  await carol.route(/\/api\/mp\/room\/[A-Z0-9]+\/http/, async route => {
    // (a request still held open when this is taken away is let through by Playwright: nothing more to do with it)
    try {
      const body = route.request().postData() || '';
      if (cut || !/"poll":true/.test(body) || /"msgs"/.test(body)) { await route.continue(); return; }
      held++;
      const resp = await route.fetch(), d = await resp.json();
      if ((d.msgs || []).some(m => m.includes('hello carol'))) { cut++; await route.abort('connectionreset'); return; }
      await route.fulfill({ response: resp });
    } catch { /* already handled */ }
  });
  await carol.evaluate(() => { window.__roomWs = AshtonkMania.Multiplayer.ws; });
  // (the request already waiting at the server isn't caught: a first message answers it, and the next one is)
  await alice.evaluate(() => AshtonkMania.Multiplayer.send({ t: 'chat', text: 'warm up' }));
  await carol.waitForFunction(() => AshtonkMania.Multiplayer.chat.some(c => c.text === 'warm up'), null, { timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 50 && !held; i++) await carol.waitForTimeout(100);
  await alice.evaluate(() => AshtonkMania.Multiplayer.send({ t: 'chat', text: 'hello carol' }));
  await carol.waitForFunction(() => AshtonkMania.Multiplayer.chat.some(c => c.text === 'hello carol'), null, { timeout: 12000 }).catch(() => {});
  const resent = await carol.evaluate(() => ({ same: AshtonkMania.Multiplayer.ws === window.__roomWs, once: AshtonkMania.Multiplayer.chat.filter(c => c.text === 'hello carol').length }));
  await carol.unroute(/\/api\/mp\/room\/[A-Z0-9]+\/http/);
  await carol.evaluate(() => AshtonkMania.Multiplayer.send({ t: 'chat', text: 'hi alice' }));
  await alice.waitForFunction(() => AshtonkMania.Multiplayer.chat.some(c => c.text === 'hi alice'), null, { timeout: 8000 }).catch(() => {});
  const r = {
    on, seen, code, cut, resent,
    two: await carol.evaluate(() => (AshtonkMania.Multiplayer.room || { players: [] }).players.length),
    carolGot: await carol.evaluate(() => AshtonkMania.Multiplayer.chat.some(c => c.text === 'hello carol')),
    aliceGot: await alice.evaluate(() => AshtonkMania.Multiplayer.chat.some(c => c.text === 'hi alice')),
  };
  check('a network that blocks WebSockets (a school Chromebook): online and in a room by plain requests, chatting with a player on WebSockets — and a reply lost on its way comes again, once', on.http && on.me && on.kept && seen && !!code && r.two === 2 && r.carolGot && r.aliceGot && cut === 1 && resent.same && resent.once === 1, JSON.stringify(r));
  await alice.evaluate(() => AshtonkMania.Multiplayer.leave());
  await carol.evaluate(() => AshtonkMania.Multiplayer.leave());
  await carol.waitForTimeout(500);
  await carol.context().close();
}
// the lounge's room list isn't asked for while the game is in the background (a lounge left open in another tab asked
// every 3 s all day)
{
  let n = 0; const count = r => { if (/api\/mp\/rooms/.test(r.url())) n++; };
  alice.on('request', count);
  await alice.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await alice.waitForTimeout(7000);
  const hidden = n;
  await alice.evaluate(() => { delete document.hidden; });
  await alice.waitForTimeout(4000);
  alice.off('request', count);
  check('the lounge stops asking for the room list while the game is in the background, and starts again after', hidden === 0 && n > 0, `${hidden} hidden, ${n - hidden} after`);
}
// alone in a room a while, nobody joining: Neru peeks up, bored (once a room)
{
  await alice.evaluate(() => { NeruEggs.ROOM_ALONE_MS = 400; });
  await createRoom(alice, false, false);
  await alice.waitForFunction(() => document.querySelector('.nc-peek .nc-img'), null, { timeout: 5000 }).catch(() => {});
  const pose = await alice.evaluate(() => ((document.querySelector('.nc-peek .nc-img') || {}).src || '').split('/').pop());
  await alice.evaluate(() => { NeruEggs.ROOM_ALONE_MS = 60000; AshtonkMania.Multiplayer.leave(); document.querySelectorAll('.nc-peek').forEach(x => x.remove()); });
  await alice.waitForSelector('.mp-create', { timeout: 10000 });
  check('alone in a room a while: Neru peeks up, bored', pose === 'neru-bored.png', pose);
}
// lazer's chat overlay: #lobby reaches everyone online
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Chat && document.querySelector('#toolbar [data-ov="chat"]') && window.AshtonkMania.Presence && AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1, null, { timeout: 10000 })));
await alice.keyboard.press('F8');
await alice.waitForSelector('.chat .ch-input'); await alice.waitForTimeout(100);
check('F8 opens the chat overlay on #lobby', await alice.evaluate(() => /talking in #lobby/.test(document.querySelector('.ch-talk').textContent) && document.querySelector('#toolbar [data-ov="chat"]').classList.contains('on')));
await alice.fill('.ch-input', 'hello from alice'); await alice.press('.ch-input', 'Enter');
await bob.waitForFunction(() => AshtonkMania.Chat.channels.get('#lobby').lines.some(l => l.text === 'hello from alice'), null, { timeout: 5000 });
check('a #lobby message reaches the other player, counted as unread on their chat button', await bob.evaluate(() => AshtonkMania.Chat.unread === 1 && /1/.test(document.querySelector('#toolbar [data-ov="chat"] .tb-badge').textContent)));
await alice.waitForFunction(() => [...document.querySelectorAll('.ch-line')].some(l => /hello from alice/.test(l.textContent)), null, { timeout: 5000 });
check('…and shows in the sender\'s chat with the time and their name', await alice.evaluate(() => { const l = [...document.querySelectorAll('.ch-line')].pop(); return l && /hello from alice/.test(l.textContent) && l.querySelector('.ch-name').textContent === 'Alice' && /\d/.test(l.querySelector('.ch-time').textContent); }));
await shot(alice, 'mp-chat');
// lazer's /np: an action line saying what she's listening to
await alice.evaluate(() => { if (!AshtonkMania.MenuMusic.current) AshtonkMania.MenuMusic.current = [...AshtonkMania.BeatmapManager.maps.values()][0]; }); // (what's playing)
await alice.fill('.ch-input', '/np'); await alice.press('.ch-input', 'Enter');
const np = await bob.waitForFunction(() => AshtonkMania.Chat.channels.get('#lobby').lines.some(l => /^\/me is (listening to|playing) /.test(l.text)), null, { timeout: 5000 }).then(() => true, () => false);
const npLine = await alice.waitForFunction(() => { const l = [...document.querySelectorAll('.ch-line.act')].pop(); return l && /^\* Alice$/.test(l.querySelector('.ch-name').textContent) && /^is (listening to|playing) /.test(l.querySelector('.ch-text').textContent); }, null, { timeout: 5000 }).then(() => true, () => false);
check('chat /np sends an action line ("* Alice is listening to …")', np && npLine, JSON.stringify({ np, npLine }));
await alice.keyboard.press('Escape');
await alice.waitForFunction(() => !document.querySelector('.chat'), null, { timeout: 3000 });
// lazer's mention notification: Bob says Alice's name while her chat is closed
await bob.evaluate(() => AshtonkMania.Presence.send({ t: 'say', text: 'nice play alice!' }));
const mention = await alice.waitForFunction(() => [...document.querySelectorAll('#toasts *')].some(t => /Bob mentioned you in #lobby/.test(t.textContent)), null, { timeout: 5000 }).then(() => true, () => false);
check('a #lobby message with your name in it is a notification (lazer\'s mention)', mention);
// lazer's rankings: each player's totals, by pp
// — only plays the server judged count: a player's own claims (99,999pp, a made-up leaderboard score) change nothing
await bob.evaluate(() => { AshtonkMania.Presence.send({ t: 'stats', pp: 99999, acc: 1, plays: 9999, profile: AshtonkMania.ProfileScreen.summary() }); AshtonkMania.Presence.send({ t: 'lbSubmit', key: 'f'.repeat(64), score: 1e7 }); });
// Bob's game sends a real play (perfect, as Auto plays it): the beatmap file and the key presses, judged by the server
const bobScore = await bob.evaluate(async () => {
  const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal');
  const { notes } = await AshtonkMania.BeatmapManager.load(m.id);
  const events = generateAutoInputs(prepareNotes(notes, m.keys, [], 1), m.keys).flat();
  return Verified.submit({ rec: m, mods: [], modConfig: {}, seed: 1, events });
});
check('a play goes up as the beatmap and the key presses, and the server judges it itself', bobScore && bobScore.ok && bobScore.score === 1000000 && bobScore.grade === 'SS' && bobScore.pp > 0, JSON.stringify(bobScore));
// a play sent with someone else's id but not their key is refused
const forged = await bob.evaluate(async () => { const r = await fetch('api/mp/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: AshtonkMania.Presence.pid(), key: 'not-bobs-key-0000000000', osu: btoa('x'), play: { mods: [], events: [] } }) }); return r.status; });
check('…and nobody can send scores as someone else (their key)', forged === 403, String(forged));
const forgedLot = await bob.evaluate(async () => { const r = await fetch('api/mp/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: AshtonkMania.Presence.pid(), key: 'not-bobs-key-0000000000', plays: [{ osu: btoa('x'), result: { score: 1 } }] }) }); return r.status; });
check('…nor several at once', forgedLot === 403, String(forgedLot));
// lazer's user tags: only a player with a score on the beatmap can tag it; everyone sees the votes
{
  const hash = await bob.evaluate(() => [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal').hash);
  // (a fresh answer each time: the one already here can be from before the last votes arrived)
  const ask = (pg, h) => pg.evaluate(async h => { AshtonkMania.UserTags.cache.delete(h); AshtonkMania.UserTags.ask(h, true); for (let i = 0; i < 50; i++) { const c = AshtonkMania.UserTags.get(h); if (c && !c.pending && c.all.length) return c; await new Promise(r => setTimeout(r, 100)); } return AshtonkMania.UserTags.get(h); }, h);
  const a0 = await ask(alice, hash), b0 = await ask(bob, hash);
  await bob.evaluate(h => { AshtonkMania.UserTags.vote(h, 'jumpstream', true); AshtonkMania.UserTags.vote(h, 'stamina', true); }, hash);
  await alice.evaluate(h => AshtonkMania.UserTags.vote(h, 'gimmick', true), hash);
  await bob.waitForTimeout(800);
  const a1 = await ask(alice, hash);
  check('user tags (lazer): only a player with a score on the beatmap can tag it, and everyone sees the votes', !a0.can && b0.can && a0.all.includes('jumpstream') && a1.tags.map(t => t.tag).join() === 'jumpstream,stamina' && !a1.tags.some(t => t.mine), JSON.stringify({ a0: a0.can, b0: b0.can, a1: a1.tags }));
}
await alice.evaluate(() => AshtonkMania.Screens.go('rankings'));
await alice.waitForFunction(() => document.querySelectorAll('.rk-table .rk-row:not(.rk-head)').length >= 1, null, { timeout: 5000 }); await alice.waitForTimeout(150);
check('rankings list players by pp — lazer\'s total, with the bonus pp for each ranked play (performance table, no accuracy column)', await alice.evaluate(pp => { const r = document.querySelector('.rk-table .rk-row:not(.rk-head)'); return /#1/.test(r.textContent) && /Bob/.test(r.textContent) && new RegExp(`${Math.round(pp + 416.6667 * 0.005)}pp`).test(r.textContent) && !/99,999/.test(r.textContent) && !/%/.test(r.textContent) && document.querySelector('#toolbar [data-tab="rankings"]').classList.contains('on'); }, bobScore.pp), await alice.evaluate(() => document.querySelector('.rk-table') && document.querySelector('.rk-table').textContent));
await shot(alice, 'mp-rankings');
check('rankings: no ranked score table (by pp only)', await alice.evaluate(() => !document.querySelector('.ov-tab') && !/Ranked Score/.test(document.querySelector('.rk-head').textContent)));
// clicking a player opens their full profile (lazer's user profile), from what their game shared
await alice.click('.rk-table .rk-row:not(.rk-head)');
await alice.waitForFunction(() => document.querySelector('.pf-name') && /Bob/.test(document.querySelector('.pf-name').textContent), null, { timeout: 5000 });
check('rankings: clicking a player opens their full profile (rank, pp, play count, sections)', await alice.evaluate(pp => /#1/.test(document.querySelector('.pf-global').textContent) && document.querySelector('.pf-header').textContent.includes(`${Math.round(pp + 416.6667 * 0.005)}pp`) && !!document.querySelector('.pf-sec[data-sec="ranks"]') && !!document.querySelector('.pf-sec[data-sec="medals"]') /* (empty sections are left out) */ && !document.querySelector('.pf-avatar[title]'), bobScore.pp), await alice.evaluate(() => document.querySelector('.pf-header').textContent.slice(0, 200)), bobScore.pp);
await shot(alice, 'mp-profile-other');
check('profiles are kept simple: best performance, recent plays and medals — no first place ranks', await alice.evaluate(() => !/First place ranks/.test(document.querySelector('.screen-body').textContent) && [...document.querySelectorAll('.pf-tabs .ov-tab')].every(t => /^(ranks|recent|medals)$/.test(t.textContent))));
await alice.evaluate(() => AshtonkMania.Screens.back()); await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'rankings', null, { timeout: 5000 });
await alice.evaluate(() => AshtonkMania.Screens.back()); await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer', null, { timeout: 5000 });
// lazer's daily challenge: one beatmap a day for everyone, and a leaderboard of each player's best score
// (the server picks it from osu!'s listing, which the tests can't reach: the owner sets it from the admin panel)
const adminLogin = await fetch(url + 'admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin': '1' }, body: JSON.stringify({ code: 'K7QM-3XRA-9DPZ-W2HF' }) });
const adminCookie = (adminLogin.headers.get('set-cookie') || '').split(';')[0];
const dailySet = await (await fetch(url + 'admin/api/dailySet', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin': '1', cookie: adminCookie },
  body: JSON.stringify({ map: { onlineSetId: 424242, onlineId: 777, keys: 4, title: 'Daily Song', artist: 'Daily Artist', version: 'Daily Hard', creator: 'Mapper', stars: 4.2, length: 95000 } }) })).json();
check('daily challenge: the server\'s owner sets the day\'s beatmap from the admin panel', !!dailySet.ok, JSON.stringify(dailySet).slice(0, 200));
await alice.evaluate(() => AshtonkMania.Screens.go('daily'));
await alice.waitForFunction(() => document.querySelector('.dc-title'), null, { timeout: 8000 });
const dmap = await alice.evaluate(() => AshtonkMania.Daily.data.map);
check('daily challenge: the day\'s beatmap with the time remaining and Play', await alice.evaluate(() => document.querySelector('.dc-title').textContent.length > 0 && /^\d+:\d\d:\d\d$/.test(document.querySelector('.dc-time b').textContent) && !!document.querySelector('.dc-play')), JSON.stringify(dmap));
{
  // mods a daily score can't have (Wind Up here), picked earlier in song select, don't come along
  const dm = await alice.evaluate(async () => { const S = AshtonkMania.Settings; S.set('songselect.mods', ['WU', 'HR']); AshtonkMania.DailyScreen.render(); await new Promise(r => setTimeout(r, 100)); const out = { mods: AshtonkMania.DailyScreen.mods(), btn: document.querySelector('.dc-mods').textContent.trim() }; S.set('songselect.mods', []); AshtonkMania.DailyScreen.render(); return out; });
  check('daily challenge: mods its scores can\'t have (Wind Up) picked in song select are left out', JSON.stringify(dm.mods) === '["HR"]' && dm.btn === 'HR', JSON.stringify(dm));
}
await bob.evaluate(m => { const D = AshtonkMania.Daily; D.ask(); }, dmap);
await bob.waitForFunction(() => AshtonkMania.Daily.data && AshtonkMania.Daily.data.map, null, { timeout: 5000 });
check('…the same beatmap for everyone', await bob.evaluate(id => AshtonkMania.Daily.data.map.onlineId === id, dmap.onlineId));
check('…and its leaderboard has only plays the server judged (none yet)', await alice.evaluate(() => /No scores yet/.test(document.querySelector('.rk-empty, .dc-table, .dc-main .off-state') ? document.querySelector('#app').textContent : '')));
await shot(alice, 'mp-daily');
// lazer's global leaderboards at song select: Bob's best on a beatmap shows in Alice's Global scope
const lbHash = await bob.evaluate(() => [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal').hash);
await alice.evaluate(() => { const S = AshtonkMania.Settings; S.set('songselect.lbScope', 'global'); S.set('songselect.detailTab', 'ranking'); const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.Screens.go('songselect', { mapId: m.id }); });
await alice.waitForFunction(() => [...document.querySelectorAll('.lbs')].some(r => /Bob/.test(r.textContent)), null, { timeout: 8000 });
check('song select: the Global scope shows other players\' best scores from the server', await alice.evaluate(() => { const r = [...document.querySelectorAll('.lbs')].find(x => /Bob/.test(x.textContent)); return /1,000,000/.test(r.textContent) && /100\.00%/.test(r.textContent) && /#1/.test(r.textContent); }), await alice.evaluate(() => document.querySelector('.lb') && document.querySelector('.lb').textContent.slice(0, 300)));
await shot(alice, 'mp-global-lb');
{
  // a play whose score can't be sent at first (the network dropped as the song ended) is sent again once it's back
  let n = 0;
  await bob.route('**/api/mp/score', r => (++n === 1 ? r.abort('internetdisconnected') : r.continue()));
  const again = await bob.evaluate(async () => {
    const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal');
    const { notes } = await AshtonkMania.BeatmapManager.load(m.id);
    return Verified.submit({ rec: m, mods: [], modConfig: {}, seed: 1, events: generateAutoInputs(prepareNotes(notes, m.keys, [], 1), m.keys).flat() });
  });
  await bob.unroute('**/api/mp/score');
  check('a play that couldn\'t be sent at first (the network dropped) is sent again, and counts', n === 2 && !!again && again.ok && again.score === 1000000, JSON.stringify({ n, again }));
}
await alice.evaluate(() => { AshtonkMania.Settings.set('songselect.lbScope', 'local'); AshtonkMania.Screens.back(); });
await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'daily', null, { timeout: 5000 });

await alice.evaluate(() => AshtonkMania.Screens.back()); await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer', null, { timeout: 5000 });

check('multiplayer lobby renders', await alice.evaluate(() => !!document.querySelector('.mp-lobby') && !document.querySelector('.mp-lobby button[disabled]')));

// friends: invites and spectating are only between friends. Alice opens the dashboard (lazer's), finds Bob under
// "currently online" and sends a request from his panel's ⋯ menu; he accepts it from the prompt that pops up
const panelMenu = async (page, name) => { await page.evaluate(n => document.querySelector(`.up[data-name="${n}"] .up-more`).click(), name); await page.waitForSelector('.menu button'); return page.$$eval('.menu button', b => b.map(x => x.textContent.trim())); };
const menuPick = (page, label) => page.evaluate(l => [...document.querySelectorAll('.menu button')].find(b => b.textContent.trim() === l).click(), label);
// (Bob has a profile picture, which his friends see)
await bob.evaluate(() => { AshtonkMania.ProfileManager.sharedAvatar = 'preset:neru'; AshtonkMania.Presence.pushStatus(); });
await alice.click('#toolbar [data-tab="dashboard"]');
await alice.waitForSelector('.dash-tabs');
await alice.evaluate(() => [...document.querySelectorAll('.dash-tabs .ov-tab')].find(b => /currently online/.test(b.textContent)).click());
await alice.waitForSelector('.up[data-name="Bob"]', { timeout: 10000 });
const frBefore = await panelMenu(alice, 'Bob');
await menuPick(alice, 'Add friend');
await bob.waitForFunction(() => [...document.querySelectorAll('.dialog h2')].some(x => /Alice wants to be friends/.test(x.textContent)), null, { timeout: 5000 });
const pending = await panelMenu(alice, 'Bob'); await alice.keyboard.press('Escape');
await bob.click('.dialog .pd-btn.ok');
await alice.waitForFunction(() => AshtonkMania.Friends.list().some(f => f.name === 'Bob'), null, { timeout: 5000 });
const both = await bob.waitForFunction(() => AshtonkMania.Friends.list().some(f => f.name === 'Alice'), null, { timeout: 5000 }).then(() => true, () => false);
check('friend requests: the ⋯ menu\'s "Add friend" sends one, the other player accepts from a prompt, and both become friends; anyone can be spectated', frBefore.includes('View profile') && frBefore.includes('Add friend') && frBefore.includes('Spectate') && pending.includes('Friend request sent') && both, JSON.stringify({ frBefore, pending, both }));
// unfriending is in the ⋯ menu (not one click away) and asks first
const fm = await panelMenu(alice, 'Bob'); await alice.keyboard.press('Escape');
check('…once friends, "Remove friend" is in the ⋯ menu', fm.includes('Remove friend'), JSON.stringify(fm));
await alice.evaluate(() => AshtonkMania.Screens.go('multiplayer')); await alice.waitForTimeout(400);

// Alice creates a room, Bob joins with the code
await createRoom(alice, false, false);
await alice.waitForFunction(() => AshtonkMania.Multiplayer.inRoom(), null, { timeout: 10000 });
const code = await alice.evaluate(() => AshtonkMania.Multiplayer.room.code);
check('room created with a code', /^[A-Z0-9]{6}$/.test(code), code);
// Invite: Alice sees Bob online and invites him; Bob gets an invite prompt (he declines, then joins with the code)
await alice.waitForFunction(() => AshtonkMania.Presence.others().some(p => p.name === 'Bob'), null, { timeout: 10000 });
await alice.click('.mp-invite');
await alice.waitForSelector('.inv-row');
check('invite dialog lists friends who are online, with their pictures, and offers a link', await alice.evaluate(() => [...document.querySelectorAll('.inv-row')].some(r => r.querySelector('b').textContent === 'Bob' && /neru/.test((r.querySelector('img.avatar') || {}).src || '')) && !!document.querySelector('.inv-link')));
await alice.click('.inv-row .btn.primary');
await bob.waitForFunction(() => [...document.querySelectorAll('.dialog h2')].some(x => /Alice invited you/.test(x.textContent)), null, { timeout: 5000 });
check('the invited player gets a Join prompt', await bob.evaluate(code => document.querySelector('.dialog .body').textContent.includes(code), code));
await bob.click('.dialog .pd-btn.cancel');
await alice.click('.dialog .actions .btn');
await alice.waitForTimeout(300);
// a friend mid-song: "Invite after song" — nothing reaches them until their song is over, then the invite does
await bob.evaluate(() => { const P = AshtonkMania.Presence; P._status = P.status; P.status = () => 'playing'; P.pushStatus(); });
await alice.waitForFunction(() => AshtonkMania.Presence.others().some(p => p.name === 'Bob' && p.status === 'playing'), null, { timeout: 5000 });
await alice.click('.mp-invite');
await alice.waitForSelector('.inv-row');
const lateBtn = await alice.evaluate(() => [...document.querySelectorAll('.inv-row')].find(r => r.querySelector('b').textContent === 'Bob').querySelector('button').textContent);
await alice.evaluate(() => [...document.querySelectorAll('.inv-row')].find(r => r.querySelector('b').textContent === 'Bob').querySelector('button').click());
const waiting = await alice.evaluate(() => [...document.querySelectorAll('.inv-row')].find(r => r.querySelector('b').textContent === 'Bob').querySelector('button').textContent);
await alice.click('.dialog .actions .btn');
await alice.waitForTimeout(3200); // (and past the server's 3 s double-click guard for the same invite)
const early = await bob.evaluate(() => [...document.querySelectorAll('.dialog h2')].some(x => /invited you/.test(x.textContent)));
await bob.evaluate(() => { const P = AshtonkMania.Presence; P.status = P._status; delete P._status; P.pushStatus(); });
const late = await bob.waitForFunction(() => [...document.querySelectorAll('.dialog h2')].some(x => /Alice invited you/.test(x.textContent)), null, { timeout: 8000 }).then(() => true, () => false);
check('a friend mid-song: "Invite after song" waits, and the invite reaches them as soon as their song is over', lateBtn === 'Invite after song' && /After their song/.test(waiting) && !early && late && await alice.evaluate(() => AshtonkMania.Presence.afterSong.size === 0), JSON.stringify({ lateBtn, waiting, early, late }));
if (late) await bob.click('.dialog .pd-btn.cancel');
await bob.fill('.mp-code', code);
await bob.click('.mp-join');
await bob.waitForFunction(() => AshtonkMania.Multiplayer.inRoom(), null, { timeout: 10000 });
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room.players.length === 2, null, { timeout: 5000 });
check('opponent joined; both see two players', await bob.evaluate(() => document.querySelectorAll('.mp-player:not(.empty)').length === 2));
// the host's Settings (lazer's match settings): win by accuracy — everyone sees the new rule; only the host has the button
await alice.click('.mp-settings-btn');
await alice.waitForSelector('.dialog .mp-set');
await alice.click('.dialog .mp-seg-b:has-text("Accuracy")');
await bob.waitForFunction(() => /Highest Accuracy wins/.test(document.querySelector('.mp-rules')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
check('the host changes the room\'s rules from Settings (win by accuracy), and everyone sees them; only the host has the button', await bob.evaluate(() => /Highest Accuracy wins/.test(document.querySelector('.mp-rules').textContent) && !document.querySelector('.mp-settings-btn')));
await alice.click('.dialog .mp-seg-b:has-text("Score")'); // (back to score for the rest)
await bob.waitForFunction(() => /Highest Score wins/.test(document.querySelector('.mp-rules')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
await alice.click('.dialog .actions .btn');
await alice.waitForTimeout(300);
check('joining a missing room fails cleanly', await bob.evaluate(async () => {
  const M = AshtonkMania.Multiplayer, saved = { ws: M.ws, room: M.room, me: M.me, code: M.code };
  try { await new Promise((res, rej) => { const ws = new WebSocket(location.origin.replace('http', 'ws') + '/api/mp/room/ZZZZZZ'); ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: 'x', create: false })); ws.onmessage = e => { const m = JSON.parse(e.data); m.t === 'error' ? res(m.msg) : rej(new Error('joined')); }; }); return true; }
  catch { return false; } finally { Object.assign(M, saved); }
}));

// chat
await bob.fill('.mp-tabpane input', 'glhf');
await bob.press('.mp-tabpane input', 'Enter');
await alice.waitForFunction(() => [...document.querySelectorAll('.mp-msg')].some(m => m.textContent.includes('glhf')), null, { timeout: 5000 });
check('chat messages reach the other player', true);

// a dropped connection in the room (no "bye": the network went): Alice comes back on her own as herself, still
// the host — the room kept her seat instead of handing the host to Bob and taking her back as a newcomer
{
  const was = await alice.evaluate(() => ({ me: AshtonkMania.Multiplayer.me, host: AshtonkMania.Multiplayer.room.host }));
  await alice.evaluate(() => { const ws = AshtonkMania.Multiplayer.ws; ws.close(4000, 'network drop'); });
  await alice.waitForFunction(() => AshtonkMania.Multiplayer.reconnecting, null, { timeout: 3000 }).catch(() => {});
  await alice.waitForFunction(() => !AshtonkMania.Multiplayer.reconnecting && AshtonkMania.Multiplayer.ws && AshtonkMania.Multiplayer.ws.readyState === 1, null, { timeout: 15000 });
  await bob.waitForTimeout(500);
  const now = await alice.evaluate(() => ({ me: AshtonkMania.Multiplayer.me, host: AshtonkMania.Multiplayer.room.host, n: AshtonkMania.Multiplayer.room.players.length }));
  const bobSees = await bob.evaluate(() => { const r = AshtonkMania.Multiplayer.room; return { n: r.players.length, host: r.host, away: r.players.some(p => p.away) }; });
  check('a dropped connection in the room comes back as the same player, still the host (the seat is kept)',
    now.me === was.me && now.host === was.me && now.n === 2 && bobSees.n === 2 && bobSees.host === was.me && !bobSees.away, JSON.stringify({ was, now, bobSees }));
}

// Alice picks the beatmap through song select (pick mode)
await alice.click('.mp-map-actions .btn');
await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'songselect' && AshtonkMania.SongSelect.mpPick, null, { timeout: 5000 });
await alice.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.SongSelect.select(m.id); });
await alice.waitForTimeout(300);
await alice.click('.ss-cookie');
await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.room.map, null, { timeout: 5000 });
await bob.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room; return r.map && r.players.every(p => p.hasMap); }, null, { timeout: 5000 });
check('host picked the beatmap; both players have it', await bob.evaluate(() => AshtonkMania.Multiplayer.room.map.version === '4K Normal'));
check('no start until both are ready', await alice.evaluate(() => !document.querySelector('.mp-start') && /^Ready$/.test(document.querySelector('.mp-ready').textContent)));

await alice.click('.mp-ready'); await alice.waitForFunction(() => AshtonkMania.Multiplayer.self().ready, null, { timeout: 5000 }); await bob.click('.mp-ready');
await alice.waitForFunction(() => (e => e && !e.disabled)(document.querySelector('.mp-start')), null, { timeout: 5000 });
check('both ready turns the button into Start match (2 / 2 ready)', await alice.evaluate(() => document.querySelector('.mp-start').textContent === 'Start match (2 / 2 ready)'));
await shot(alice, 'mp-room');
check('the room shows no stray "null" / "undefined" / "NaN" text', await alice.evaluate(() => !/\b(null|undefined|NaN)\b/.test(document.querySelector('.mp-room').innerText)));
await alice.click('.mp-start');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.mp, null, { timeout: 10000 })));
check('match starts for both players', true);
check('synchronised countdown before the music starts', await alice.evaluate(() => !!document.querySelector('.mp-countdown') && !AshtonkMania.Music.playing));

// Alice plays perfectly (auto input feed), Bob does nothing and fails
await alice.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; s.feed = generateAutoInputs(s.engine.notes, s.keys).flat(); s.feedIdx = 0; });
await alice.waitForFunction(() => AshtonkMania.Music.playing, null, { timeout: 10000 });
await bob.waitForTimeout(2500);
await shot(alice, 'mp-ingame');
const board = await bob.evaluate(() => [...document.querySelectorAll('.hud-mp-row')].map(r => r.querySelector('.nm').textContent + ' ' + r.querySelector('.sc').textContent));
await bob.evaluate(() => AshtonkMania.Multiplayer.send({ t: 'chat', text: 'gl hf from bob' }));
const gpChat = await alice.waitForFunction(() => [...document.querySelectorAll('.gp-chat .gp-chat-l')].some(l => /gl hf from bob/.test(l.textContent)), null, { timeout: 5000 }).then(() => true, () => false);
const gpIn = await alice.evaluate(() => { const i = document.querySelector('.gp-chat-in'); return i && i.disabled; });
check('lazer\'s in-game chat: a room message shows in the corner mid-song, with no box to type in while playing', gpChat && gpIn, JSON.stringify({ gpChat, gpIn }));
check('in-game board shows both players with their live score', board.length === 2 && board.some(t => t.includes('Alice')) && board.every(t => /\d$/.test(t) && !/pp$/.test(t)), JSON.stringify(board));
await bob.waitForSelector('.hud-mpfailed', { timeout: 20000 });
check('as in lazer multiplayer: running out of health marks the play failed, and it carries on', await bob.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; return s.mpFailed && !s.failed && s.running && s.engine.health.value <= 0; }));
// after the song: lazer's multiplayer results — everyone's score panel, winner first — then back to the room
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'results' && AshtonkMania.Multiplayer.lastResults && document.querySelectorAll('.cp').length === 1 && document.querySelector('.res-grid .rs-top') && !document.querySelector('.mpr-verdict.wait'), null, { timeout: 40000 })));
const mpr = await Promise.all([alice, bob].map(p => p.evaluate(() => ({ verdict: document.querySelector('.mpr-verdict').textContent, place: document.querySelector('.res-mp-myplace').textContent, before: [...document.querySelectorAll('.res-mp-side.before .cp-name')].map(e => e.firstChild.textContent), after: [...document.querySelectorAll('.res-mp-side.after .cp-name')].map(e => e.firstChild.textContent) }))));
await alice.waitForTimeout(1200); await shot(alice, 'mp-results-screen'); await shot(bob, 'mp-results-screen-bob');
// picking Bob's panel makes his the big one (and Alice's goes into the row); picking hers brings it back
{
  await alice.click('.cp.cp-click'); await alice.waitForTimeout(700);
  const sw = await alice.evaluate(() => ({ main: document.querySelector('.res-grid > .rs .rs-name')?.textContent, row: [...document.querySelectorAll('.cp .cp-name')].map(e => e.firstChild.textContent) }));
  await alice.click('.cp.cp-click'); await alice.waitForTimeout(700);
  const back = await alice.evaluate(() => document.querySelector('.res-grid > .rs .rs-name')?.textContent);
  check('multiplayer results: picking another player\'s panel makes it the big one, and yours comes back the same way', sw.main === 'Bob' && sw.row.includes('Alice') && back === 'Alice', JSON.stringify({ ...sw, back }));
}
check('after the song, the results screen with your panel and the other player\'s, winner first', mpr[0].verdict === 'You win!' && mpr[1].verdict === 'You lose' && mpr[0].place === '#1' && mpr[1].place === '#2' && mpr[0].after.join() === 'Bob' && !mpr[0].before.length && mpr[1].before.join() === 'Alice' && !mpr[1].after.length, JSON.stringify(mpr));
await Promise.all([alice, bob].map(p => p.evaluate(() => AshtonkMania.Screens.go('multiplayer', {}, { replace: true }))));
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.lastResults, null, { timeout: 10000 })));
check('the play finishes, shown to the room as failed (F), and isn\'t recorded (only a play you finish is)', await bob.evaluate(() => { const r = AshtonkMania.Multiplayer.lastResults.rows.find(x => x.id === AshtonkMania.Multiplayer.me); return !AshtonkMania.ScoreManager.scores.length && r && r.grade === 'F'; }), await bob.evaluate(() => JSON.stringify([AshtonkMania.ScoreManager.scores.length, AshtonkMania.Multiplayer.lastResults.rows])));
const ra = await alice.evaluate(() => ({ verdict: document.querySelector('.mp-verdict')?.textContent, res: AshtonkMania.Multiplayer.lastResults }));
const rb = await bob.evaluate(() => document.querySelector('.mp-verdict')?.textContent);
await shot(alice, 'mp-results');
check('results: the higher score wins (as in osu! multiplayer)', /You win/.test(ra.verdict) && /You lose/.test(rb), `${ra.verdict} / ${rb}`);
check('winner row: full score and its pp', ra.res.rows[0].name === 'Alice' && ra.res.rows[0].score === 1000000 && ra.res.rows[0].pp > 0 && ra.res.rows[1].pp === 0, JSON.stringify(ra.res.rows.map(r => [r.name, r.score, Math.round(r.pp), r.passed])));
check('results panel leads with the score', await alice.evaluate(() => /^[\d,]+$/.test(document.querySelector('.mp-res-score').textContent.trim())));
check('scores are also saved locally', await alice.evaluate(() => AshtonkMania.ScoreManager.scores.length === 1));
// a score in the room's results brings its score card back up; Esc puts it away
await alice.click('.mp-res-row.click:not(.win)');
await alice.waitForSelector('.mpr-pop .rs-name', { timeout: 5000 }).catch(() => {});
check('clicking a score in the room\'s results opens its score card', await alice.evaluate(() => document.querySelector('.mpr-pop .rs-name')?.textContent === 'Bob'));
await alice.keyboard.press('Escape');
await alice.waitForFunction(() => !document.querySelector('.mpr-pop'), null, { timeout: 3000 }).catch(() => {});

// mods: Alice (the host) picks DT (+ her own Hidden) — the room's straight away; Bob asking for HT needs Alice to accept
// (she declines); Bob picks Mirror for himself
await alice.evaluate(() => AshtonkMania.Multiplayer.setMods(['DT', 'HD']));
check('the host\'s speed mod (DT) applies to the room straight away — no vote', await bob.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room; return r.mods[0] === 'DT' && !r.vote && !document.querySelector('.mp-vote'); }, null, { timeout: 5000 }).then(() => true, () => false), await bob.evaluate(() => JSON.stringify({ mods: AshtonkMania.Multiplayer.room.mods, vote: AshtonkMania.Multiplayer.room.vote })));
await bob.evaluate(() => AshtonkMania.Multiplayer.setMods(['HT']));
await alice.waitForSelector('.mp-vote .mp-accept', { timeout: 5000 });
await shot(alice, 'mp-vote');
// (Bob's copy of the room arrives on its own socket message: wait for it rather than checking the instant Alice sees the vote)
check('another player\'s speed mod (HT) needs everyone to accept', await bob.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room, v = document.querySelector('.mp-vote'); return r.mods[0] === 'DT' && r.vote && r.vote.mods[0] === 'HT' && v && /Waiting for everyone/.test(v.textContent); }, null, { timeout: 5000 }).then(() => true, async () => { console.log('  bob:', await bob.evaluate(() => JSON.stringify({ mods: AshtonkMania.Multiplayer.room.mods, vote: AshtonkMania.Multiplayer.room.vote, text: document.querySelector('.mp-vote')?.textContent }))); return false; }));
await alice.click('.mp-vote .mp-decline');
await bob.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room; return !r.vote && r.mods[0] === 'DT'; }, null, { timeout: 5000 });
await bob.evaluate(() => AshtonkMania.Multiplayer.setMods(['MR'], { propose: false }));
await alice.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room; return r.players.some(p => p.id !== r.host && p.mods.join() === 'MR'); }, null, { timeout: 5000 }).catch(() => {});
await bob.waitForTimeout(300);
const afterVote = await bob.evaluate(() => { const r = AshtonkMania.Multiplayer.room; const m = id => r.players.find(p => p.id === id).mods.join(); return { host: m(r.host), me: m(AshtonkMania.Multiplayer.me), banner: !!document.querySelector('.mp-vote'), mods: r.mods.join() }; });
check('declined: the room keeps DT; each player keeps their own mods', afterVote.host === 'HD' && afterVote.me === 'MR' && !afterVote.banner && afterVote.mods === 'DT', JSON.stringify(afterVote));

// rematch: forfeit by quitting
await alice.click('.mp-ready'); await alice.waitForFunction(() => AshtonkMania.Multiplayer.self().ready, null, { timeout: 5000 }); await bob.click('.mp-ready');
await alice.waitForFunction(() => (e => e && !e.disabled)(document.querySelector('.mp-start')), null, { timeout: 5000 });
await alice.click('.mp-start');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.Music.playing, null, { timeout: 15000 })));
const modsA = await alice.evaluate(() => AshtonkMania.GameplayScreen.s.mods.join());
const modsB = await bob.evaluate(() => AshtonkMania.GameplayScreen.s.mods.join());
check('in the match: DT for everyone plus each player\'s own mods', /DT/.test(modsA) && /HD/.test(modsA) && !/MR/.test(modsA) && /DT/.test(modsB) && /MR/.test(modsB) && !/HD/.test(modsB), `${modsA} / ${modsB}`);
await bob.keyboard.press('Escape');
await bob.waitForSelector('.dialog');
await holdBtn(bob, '.dialog .pd-btn.danger');
// (nobody can die in multiplayer, so Alice plays on to the end of the song before the results come in)
await alice.waitForFunction(() => AshtonkMania.Multiplayer.lastResults && AshtonkMania.Multiplayer.lastResults.rows.some(r => r.forfeit), null, { timeout: 40000 });
check('quitting forfeits the match', await alice.evaluate(() => AshtonkMania.Multiplayer.lastResults.winner === AshtonkMania.Multiplayer.me));
if (await alice.evaluate(() => AshtonkMania.Screens.currentName === 'gameplay')) {
  await alice.keyboard.press('Escape');
  await alice.waitForSelector('.dialog', { timeout: 2000 }).catch(() => {});
  if (await alice.$('.dialog .pd-btn.danger')) await holdBtn(alice, '.dialog .pd-btn.danger');
}
await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer', null, { timeout: 5000 });

// room updates keep a half-typed chat message
await bob.fill('.mp-tabpane input', 'half-typed');
await alice.click('.mp-ready');
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.players.some(p => p.ready), null, { timeout: 5000 });
check('room updates don\'t wipe what you are typing', await bob.evaluate(() => document.querySelector('.mp-tabpane input').value === 'half-typed'));
await alice.click('.mp-ready');

// each player's own speed (the room's setting): Bob picks HT for himself — no vote, the room's DT gone
await alice.click('.mp-settings-btn');
await alice.waitForSelector('.dialog .mp-set');
await alice.click('.dialog .mp-seg-b:has-text("Each their own")');
await alice.click('.dialog .actions .btn');
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.settings.speed === 'own', null, { timeout: 5000 }).catch(() => {});
await bob.evaluate(() => AshtonkMania.Multiplayer.setMods(['HT', 'MR']));
const own = await alice.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room, b = r.players.find(p => p.id !== r.host); return b && b.mods.includes('HT') ? { room: r.mods.join(), bob: b.mods.join(), vote: !!r.vote, rule: /Own speed mods/.test(document.querySelector('.mp-rules').textContent), badge: !!document.querySelector('.mp-pmods') } : null; }, null, { timeout: 5000 }).then(h => h.jsonValue(), () => null);
check('each their own speed: Bob\'s HT is his alone — no vote, no room speed', own && own.room === '' && /HT/.test(own.bob) && !own.vote && own.rule && own.badge, JSON.stringify(own));
await alice.click('.mp-settings-btn');
await alice.waitForSelector('.dialog .mp-set');
await alice.click('.dialog .mp-seg-b:has-text("Same for all")');
await alice.click('.dialog .actions .btn');
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.settings.speed === 'room', null, { timeout: 5000 }).catch(() => {});
check('one speed for everyone again: Bob\'s own HT goes', await alice.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room; return r.players.every(p => !(p.mods || []).includes('HT')); }, null, { timeout: 5000 }).then(() => true, () => false));

// the room's queue: the host queues a song, everyone sees what's up next; only the host (in "host picks") adds or
// takes songs off
await alice.evaluate(() => { const M = AshtonkMania.Multiplayer; M.queueAdd(M.localMap(M.room.map)); });
await bob.waitForSelector('.mp-qi', { timeout: 5000 }).catch(() => {});
const qv = await bob.evaluate(() => ({ items: document.querySelectorAll('.mp-qi').length, by: document.querySelector('.mp-qi-by')?.textContent, add: !!document.querySelector('.mp-queue-h .btn'), del: !!document.querySelector('.mp-qi-b.del') }));
check('the host queues a song: everyone sees it up next, with who added it; only the host can add or remove here', qv.items === 1 && /Alice/.test(qv.by) && !qv.add && !qv.del, JSON.stringify(qv));
await shot(alice, 'mp-queue');
await alice.click('.mp-queue-h .btn');
await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'songselect' && /queue/.test(document.querySelector('.tag.accent')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
check('Add song opens song select to pick a song for the queue', await alice.evaluate(() => AshtonkMania.SongSelect.mpQueue === true && /queue/.test(document.querySelector('.tag.accent')?.textContent || '')));
await alice.evaluate(() => AshtonkMania.Screens.go('multiplayer', {}, { replace: true }));
await alice.waitForSelector('.mp-qi-b.del', { timeout: 5000 });
await alice.$eval('.mp-qi-b.del', b => b.click());
check('the host takes it off the queue', await bob.waitForFunction(() => !document.querySelector('.mp-qi') && !(AshtonkMania.Multiplayer.room.queue || []).length, null, { timeout: 5000 }).then(() => true, () => false));

// beatmap search opens the real Browse screen (Beatmap Explorer). Online results are mocked (the mirrors are external).
const onlineDiff = (id, version, stars) => ({ beatmapset_id: 424242, id, mode: 'mania', version, difficulty_rating: stars, cs: 4, accuracy: 8, drain: 7, bpm: 150, total_length: 20, count_circles: 50, count_sliders: 4 });
// (an osu! API answer, as the game server's /api/getBeatmaps passes it on)
const onlineSet = { beatmapsets: [{ id: 424242, title: 'Online Anthem', title_unicode: 'Online Anthem', artist: 'The Test Suite', artist_unicode: 'The Test Suite', creator: 'Ashton', status: 'ranked', play_count: 1, favourite_count: 1, nsfw: false,
  beatmaps: [onlineDiff(4242420, 'Online Easy', 1.5), onlineDiff(4242421, 'Online Hard', 1.7)] }], cursor_string: null };
for (const p of [alice, bob]) {
  await p.route('**/api/getBeatmaps**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(onlineSet) }));
  await p.route('**/api/download/424242', r => r.fulfill({ contentType: 'application/octet-stream', body: readFileSync(join(root, 'tests', 'fixtures', 'online-set.osz')) }));
  await p.route('https://catboy.best/d/424242', r => r.fulfill({ contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(join(root, 'tests', 'fixtures', 'online-set.osz')) }));
  await p.route('https://assets.ppy.sh/**', r => r.abort());
  await p.route('https://b.ppy.sh/**', r => r.abort());
}
check('the room side panel is just chat', await alice.evaluate(() => document.querySelectorAll('.mp-side .mp-tabpane').length === 1 && !document.querySelector('.mp-sr-box') && /Chat/.test(document.querySelector('.mp-side').parentElement.textContent)));
const pickFromBrowse = async (p, version) => {
  await p.evaluate(() => [...document.querySelectorAll('.mp-map-actions .btn')].find(b => /Search beatmaps/.test(b.textContent)).click());
  await p.waitForFunction(() => AshtonkMania.Screens.currentName === 'explore' && document.querySelector('.ex-mp'), null, { timeout: 5000 });
  await p.waitForSelector('.ex-card[data-id="424242"]', { timeout: 10000 });
  const noSolo = await p.evaluate(() => !document.querySelector('.ex-card[data-id="424242"] .ex-side-btn.play'));
  await p.click('.ex-card[data-id="424242"] .ex-t');
  await p.waitForSelector('.bso .bso-diff', { timeout: 3000 });
  await p.evaluate(v => [...document.querySelectorAll('.bso-diff')].find(b => b.getAttribute('aria-label').startsWith(v)).click(), version);
  const label = await p.textContent('.bso .bso-dl');
  await p.click('.bso .bso-dl');
  await p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer', null, { timeout: 15000 });
  return { noSolo, label };
};
// the host searches Browse and picks a difficulty; it downloads for the host first
await pickFromBrowse(alice, 'Online Hard');
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.map && AshtonkMania.Multiplayer.room.map.version === 'Online Hard', null, { timeout: 15000 });
check('"Search beatmaps" opens Browse; the host picks there (downloaded on pick) and returns to the room', await alice.evaluate(() => AshtonkMania.BeatmapManager.sets.some(s => s.onlineId === 424242) && AshtonkMania.Multiplayer.inRoom()));
// the other player installs it automatically — no click — and only for the room
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room.players.every(p => p.hasMap), null, { timeout: 15000 });
check('the other player installs the room beatmap automatically', await bob.evaluate(() => AshtonkMania.BeatmapManager.sets.some(s => s.onlineId === 424242)));
check('…silently: no "missing beatmap" or download notice, and it\'s still only kept for this room', await bob.evaluate(() => AshtonkMania.Multiplayer.isTemp() && !/Missing beatmap|Downloading the beatmap|Installed for this room/.test(document.querySelector('.mp').innerText)));
await shot(bob, 'mp-temp');
// the other player browses and suggests; the host picks the suggestion from chat
const guest = await pickFromBrowse(bob, 'Online Easy');
check('in a room, Browse never offers solo Play (even for a downloaded song); a guest\'s button says Recommend', guest.noSolo && /Recommend to the host/.test(guest.label), JSON.stringify(guest));
await alice.waitForFunction(() => [...document.querySelectorAll('.mp-msg.suggest')].some(m => m.textContent.includes('Online Easy')), null, { timeout: 5000 });
check('guests suggest from Browse; the suggestion reaches the host with a Pick button', true);
await alice.evaluate(() => [...document.querySelectorAll('.mp-msg.suggest')].find(m => m.textContent.includes('Online Easy')).querySelector('button').click());
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.map && AshtonkMania.Multiplayer.room.map.version === 'Online Easy', null, { timeout: 10000 });
check('host picks a suggested beatmap', true);
// a guest recommends one from their own library: song select, then Play — the host gets it with a Pick button, and
// the room's beatmap stays as it is
const sugCount = () => alice.evaluate(() => document.querySelectorAll('.mp-msg.suggest').length);
const sug0 = await sugCount();
await bob.evaluate(() => [...document.querySelectorAll('.mp-map-actions .btn')].find(b => /^Recommend$/.test(b.textContent.trim())).click());
await bob.waitForFunction(() => AshtonkMania.Screens.currentName === 'songselect' && AshtonkMania.SongSelect.selectedId, null, { timeout: 8000 });
const recTag = await bob.evaluate(() => document.querySelector('.ss-footer .tag.accent')?.textContent || '');
await bob.evaluate(() => AshtonkMania.SongSelect.play());
await bob.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer', null, { timeout: 5000 });
const gotRec = await alice.waitForFunction(n => { const all = document.querySelectorAll('.mp-msg.suggest'); return all.length > n && all[all.length - 1].querySelector('button'); }, sug0, { timeout: 5000 }).then(() => true, () => false);
check('a guest recommends a beatmap from their library (song select): it reaches the host with a Pick button; the room\'s beatmap stays', /Recommend to the host/.test(recTag) && gotRec && await alice.evaluate(() => AshtonkMania.Multiplayer.room.map.version === 'Online Easy'), JSON.stringify({ recTag, gotRec, n: await sugCount() }));
// mod select in a room: every toggle reaches the room (on, off, on again); Auto is greyed out and can't be picked
const bobMods = () => alice.evaluate(() => (AshtonkMania.Multiplayer.room.players.find(p => p.name === 'Bob') || {}).mods || []);
const m0 = await bobMods();
await bob.evaluate(() => AshtonkMania.MultiplayerScreen.openMods());
await bob.waitForSelector('.modsel .mod-p', { timeout: 3000 });
const clickMod = id => bob.evaluate(id => [...document.querySelectorAll('.modsel .mod-p')].find(b => b.querySelector('.mod-id')?.textContent === id).click(), id);
const waitHD = on => alice.waitForFunction(on => ((AshtonkMania.Multiplayer.room.players.find(p => p.name === 'Bob') || {}).mods || []).includes('HD') === on, on, { timeout: 4000 }).catch(() => {});
const seq = [];
for (const on of [true, false, true]) { await clickMod('HD'); await waitHD(on); seq.push((await bobMods()).includes('HD')); }
const auto = await bob.evaluate(() => { const b = [...document.querySelectorAll('.modsel .mod-p')].find(b => b.querySelector('.mod-id')?.textContent === 'AT'); b.click(); return { grey: b.classList.contains('unavail'), picked: (AshtonkMania.Settings.get('songselect.mods') || []).includes('AT') }; });
await clickMod('HD'); await waitHD(false);
await bob.keyboard.press('Escape'); await bob.waitForTimeout(400);
const mEnd = await bobMods();
check('mods in a room: selecting and deselecting reach the room every time; Auto is greyed out', !m0.includes('HD') && seq.join() === 'true,false,true' && auto.grey && !auto.picked && mEnd.join() === m0.join(), JSON.stringify({ m0, seq, auto, mEnd }));
// other menus keep you in the room; going back (or home) from them returns to it
await alice.evaluate(() => AshtonkMania.Screens.go('profile'));
await alice.waitForTimeout(400);
await alice.evaluate(() => AshtonkMania.Screens.go('home'));
await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer', null, { timeout: 5000 }).catch(() => {});
check('opening another menu (profile) doesn\'t leave the room; home from there goes back to the room', await alice.evaluate(() => AshtonkMania.Multiplayer.inRoom() && AshtonkMania.Screens.currentName === 'multiplayer'));
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room.players.every(p => p.hasMap), null, { timeout: 10000 });

// each player picks their own difficulty
// (once Bob's list has the beatmap's other difficulties: it fills in as the beatmap finishes installing)
await bob.waitForFunction(() => [...document.querySelectorAll('.mp-diff option')].some(o => o.textContent.startsWith('Online Hard')), null, { timeout: 10000 });
await bob.selectOption('.mp-diff select', { label: await bob.evaluate(() => [...document.querySelectorAll('.mp-diff option')].find(o => o.textContent.startsWith('Online Hard')).textContent) });
await alice.waitForFunction(() => { const b = AshtonkMania.Multiplayer.room.players.find(p => p.id !== AshtonkMania.Multiplayer.me); return b.diff && b.diff.version === 'Online Hard'; }, null, { timeout: 5000 });
check('players choose their own difficulty (shown to the room)', await alice.evaluate(() => [...document.querySelectorAll('.mp-pdiff')].some(e => e.textContent.includes('Online Hard'))));
await alice.click('.mp-ready'); await alice.waitForFunction(() => AshtonkMania.Multiplayer.self().ready, null, { timeout: 5000 }); await bob.click('.mp-ready');
await alice.waitForFunction(() => (e => e && !e.disabled)(document.querySelector('.mp-start')), null, { timeout: 5000 });
await alice.click('.mp-start');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s, null, { timeout: 15000 })));
const played = [await alice.evaluate(() => AshtonkMania.GameplayScreen.s.rec.version), await bob.evaluate(() => AshtonkMania.GameplayScreen.s.rec.version)];
check('each player plays the difficulty they chose', played[0] === 'Online Easy' && played[1] === 'Online Hard', played.join(' / '));
for (const p of [bob, alice]) {
  await p.waitForFunction(() => AshtonkMania.Music.playing, null, { timeout: 15000 });
  await p.keyboard.press('Escape');
  await p.waitForSelector('.dialog', { timeout: 5000 }).catch(() => {});
  if (await p.$('.dialog .pd-btn.danger')) await holdBtn(p, '.dialog .pd-btn.danger');
  await p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer', null, { timeout: 8000 });
}
await alice.waitForFunction(() => AshtonkMania.Multiplayer.lastResults && AshtonkMania.Multiplayer.lastResults.map.version === 'Online Easy', null, { timeout: 10000 });
check('results show which difficulty each player played', await alice.evaluate(() => AshtonkMania.Multiplayer.lastResults.rows.find(r => r.name === 'Bob').diff.version === 'Online Hard'));

// a dropped connection reconnects on its own; the only notice is "Reconnected"
await bob.evaluate(() => { document.querySelectorAll('#toasts .toast').forEach(t => t.remove()); AshtonkMania.Multiplayer.ws.close(); });
await bob.waitForTimeout(40); // (the first retry goes out after 150 ms)
const midDrop = await bob.evaluate(() => ({ reconnecting: !!AshtonkMania.Multiplayer.reconnecting, room: !!document.querySelector('.mp-room'), marker: !!document.querySelector('.mp-reconnecting'), toasts: document.querySelector('#toasts').textContent }));
await bob.waitForFunction(() => !AshtonkMania.Multiplayer.reconnecting && AshtonkMania.Multiplayer.ws && AshtonkMania.Multiplayer.room.players.length === 2, null, { timeout: 15000 });
await alice.waitForFunction(() => { const b = AshtonkMania.Multiplayer.room.players.find(p => p.id !== AshtonkMania.Multiplayer.me); return b && b.diff && b.diff.version === 'Online Hard'; }, null, { timeout: 5000 }).catch(() => {});
const afterDrop = await bob.evaluate(() => document.querySelector('#toasts').textContent);
check('a dropped connection keeps the room on screen and reconnects quietly', midDrop.reconnecting && midDrop.room && midDrop.marker && !/Disconnected/.test(midDrop.toasts), JSON.stringify(midDrop));
check('only "Reconnected" is shown, and the player\'s difficulty choice is restored', /Reconnected/.test(afterDrop) && !/Disconnected/.test(afterDrop) && await alice.evaluate(() => AshtonkMania.Multiplayer.room.players.some(p => p.diff && p.diff.version === 'Online Hard')), afterDrop);

// leaving: the other player becomes host
await alice.evaluate(() => AshtonkMania.Multiplayer.leave());
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.players.length === 1 && AshtonkMania.Multiplayer.isHost(), null, { timeout: 5000 });
check('host left → remaining player becomes host', true);
await bob.evaluate(() => AshtonkMania.Multiplayer.leave());
await bob.waitForFunction(() => !AshtonkMania.BeatmapManager.sets.some(s => s.onlineId === 424242), null, { timeout: 5000 }).catch(() => {});
check('leaving the room removes the beatmap that was installed only for it', await bob.evaluate(() => !AshtonkMania.BeatmapManager.sets.some(s => s.onlineId === 424242) && AshtonkMania.BeatmapManager.sets.length === 1));
check('beatmaps you picked yourself stay', await alice.evaluate(() => AshtonkMania.BeatmapManager.sets.some(s => s.onlineId === 424242)));

// public rooms are listed in the lobby: Alice opens one, Bob sees it under Open rooms and joins with a click
await alice.evaluate(() => AshtonkMania.Screens.go('multiplayer', { force: true }));
await alice.waitForSelector('.mp-create');
await createRoom(alice, false, true);
await bob.evaluate(() => AshtonkMania.Screens.go('multiplayer', { force: true }));
await bob.waitForSelector('.mp-room-row:not([disabled])', { timeout: 15000 });
check('a public room shows up under Open rooms', await bob.evaluate(() => /Alice's room/.test(document.querySelector('.mp-room-row').textContent)));
await bob.click('.mp-room-row');
await bob.waitForFunction(() => AshtonkMania.Multiplayer.inRoom() && AshtonkMania.Multiplayer.room.players.length === 2, null, { timeout: 10000 });
check('clicking an open room joins it', await alice.evaluate(() => AshtonkMania.Multiplayer.room.code) === await bob.evaluate(() => AshtonkMania.Multiplayer.room.code));
check('regular rooms play by osu!\'s rules: head to head, highest score wins, up to 16', await bob.evaluate(() => { const st = AshtonkMania.Multiplayer.room.settings; return st.type === 'h2h' && st.win === 'score' && st.size === 16 && !document.querySelector('.mp-settings-btn'); }));

// lazer's participant panel: the host hands the room over (and back), and kicks a player between matches
{
  await alice.click('.mp-player:not(.empty) .mp-pact:not(.kick)');
  const handed = await bob.waitForFunction(() => AshtonkMania.Multiplayer.isHost() && !!document.querySelector('.mp-pact'), null, { timeout: 5000 }).then(() => true, () => false);
  await bob.evaluate(() => AshtonkMania.Multiplayer.send({ t: 'giveHost', id: AshtonkMania.Multiplayer.room.players.find(p => p.id !== AshtonkMania.Multiplayer.me).id }));
  await alice.waitForFunction(() => AshtonkMania.Multiplayer.isHost(), null, { timeout: 5000 });
  await alice.click('.mp-pact.kick'); await alice.click('.dialog .pd-btn.danger, .dialog button.danger');
  const kicked = await bob.waitForFunction(() => !AshtonkMania.Multiplayer.inRoom(), null, { timeout: 5000 }).then(() => true, () => false);
  const left = await alice.waitForFunction(() => AshtonkMania.Multiplayer.room.players.length === 1, null, { timeout: 5000 }).then(() => true, () => false);
  check('host: Give host hands the room over (crown button), Kick removes a player (they\'re told and back in the lounge)', handed && kicked && left, JSON.stringify({ handed, kicked, left }));
  await bob.evaluate(c => AshtonkMania.Multiplayer.join(c), await alice.evaluate(() => AshtonkMania.Multiplayer.room.code));
  await alice.waitForFunction(() => AshtonkMania.Multiplayer.room.players.length === 2, null, { timeout: 8000 });
}

// invites: the Invite button copies (or shares) a link; opening it joins the room directly
await bob.evaluate(() => AshtonkMania.Multiplayer.leave());
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room.players.length === 1, null, { timeout: 5000 });
const link = await alice.evaluate(() => AshtonkMania.Multiplayer.inviteLink());
if (!(await alice.evaluate(() => !!navigator.share))) {
  await alice.click('.mp-invite');
  await alice.click('.inv-link');
  await alice.waitForTimeout(300);
  await alice.click('.dialog .actions .btn');
  check('Invite → "Copy invite link" copies the room link', await alice.evaluate(async l => (await navigator.clipboard.readText()) === l, link), link);
}
await bob.goto(link);
await bob.waitForFunction(() => window.AshtonkMania && AshtonkMania.Multiplayer.inRoom(), null, { timeout: 20000 });
check('opening an invite link joins the room', await bob.evaluate(c => AshtonkMania.Multiplayer.room.code === c && !location.search.includes('join'), await alice.evaluate(() => AshtonkMania.Multiplayer.room.code)));
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room.players.length === 2, null, { timeout: 5000 });

// Ranked Play (osu!lazer's 1v1 card mode) has its own lounge, opened from the main menu, with no rating at stake:
// Alice opens a public 4K duel, Bob finds it there (and not in the normal lounge), then both choose a star rating
await alice.evaluate(() => { AshtonkMania.Multiplayer.leave(); AshtonkMania.Screens.go('multiplayer', { force: true }); });
await bob.evaluate(() => { AshtonkMania.Multiplayer.leave(); AshtonkMania.Screens.go('multiplayer', { force: true }); });
await alice.waitForSelector('.mp-create', { timeout: 10000 });
check('the normal lounge has no Ranked Play queue or match-type choice', await alice.evaluate(() => !document.querySelector('.rq') && !/Ranked Play/.test(document.querySelector('.mp-create').textContent)));
// (Dana will spectate Alice in it — and fetch the beatmap of each song she watches)
const dana = await player('Dana');
// (a Ranked Play deck is one card per song, never the same song twice: twelve songs for it to be dealt from, each its
// own beatmap set — the online fixture under ids and a title of its own — found in the listing and downloaded when played)
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
const unzipBuf = buf => { const out = []; for (let o = 0; buf.readUInt32LE(o) === 0x04034b50;) { const m = buf.readUInt16LE(o + 8), cs = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), xl = buf.readUInt16LE(o + 28), at = o + 30 + nl + xl, d = buf.subarray(at, at + cs); out.push([buf.subarray(o + 30, o + 30 + nl).toString(), m === 8 ? zlib.inflateRawSync(d) : d]); o = at + cs; } return out; };
const zipBuf = files => {
  const parts = [], central = []; let off = 0;
  for (const [name, data] of files) {
    const comp = zlib.deflateRawSync(data), nm = Buffer.from(name), lh = Buffer.alloc(30), ch = Buffer.alloc(46);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nm, comp); central.push(ch, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
};
const fixtureFiles = unzipBuf(readFileSync(join(root, 'tests', 'fixtures', 'online-set.osz')));
const rankSets = Array.from({ length: 12 }, (_, k) => ({ id: 610000 + k, title: `Card Song ${k + 1}` }));
const rankOsz = new Map(rankSets.map(({ id, title }) => [String(id), zipBuf(fixtureFiles.map(([n, d]) => [n, !n.endsWith('.osu') ? d : Buffer.from(d.toString()
  .replace(/^(Title(?:Unicode)?):Online Anthem/gm, `$1:${title}`).replace('BeatmapSetID:424242', `BeatmapSetID:${id}`).replace(/BeatmapID:424242(\d)/, (_, x) => `BeatmapID:${id * 10 + Number(x)}`))]))]));
const rankDiff = (sid, n, version, stars) => ({ beatmapset_id: sid, id: sid * 10 + n, mode: 'mania', version, difficulty_rating: stars, cs: 4, accuracy: 8, drain: 7, bpm: 150, total_length: 60, count_circles: 50, count_sliders: 4 });
const rankListing = { beatmapsets: rankSets.map(({ id, title }) => ({ id, title, title_unicode: title, artist: 'The Test Suite', artist_unicode: 'The Test Suite', creator: 'Ashton', status: 'ranked', play_count: 100, favourite_count: 50, nsfw: false,
  beatmaps: [rankDiff(id, 0, 'Online Easy', 2.5), rankDiff(id, 1, 'Online Hard', 4)] })), cursor_string: null };
const rankRoutes = async p => {
  await p.route('**/api/getBeatmaps**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(rankListing) }));
  await p.route(/\/api\/download\/(61\d{4})(?:$|[?#])/, r => r.fulfill({ contentType: 'application/octet-stream', body: rankOsz.get(r.request().url().match(/download\/(\d+)/)[1]) }));
  await p.route(/catboy\.best\/d\/(61\d{4})(?:$|[?#])/, r => r.fulfill({ contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: rankOsz.get(r.request().url().match(/\/d\/(\d+)/)[1]) }));
};
for (const p of [alice, bob]) await rankRoutes(p);
await rankRoutes(dana);
await dana.route('**/api/download/424242', r => r.fulfill({ contentType: 'application/octet-stream', body: readFileSync(join(root, 'tests', 'fixtures', 'online-set.osz')) }));
await dana.route('https://catboy.best/d/424242', r => r.fulfill({ contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(join(root, 'tests', 'fixtures', 'online-set.osz')) }));
await dana.route('https://assets.ppy.sh/**', r => r.abort());
await dana.route('https://b.ppy.sh/**', r => r.abort());
await alice.evaluate(() => AshtonkMania.Screens.go('multiplayer', { ranked: true, force: true }));
await alice.waitForFunction(() => /Ranked Play/.test(document.querySelector('#app').textContent) && /Create duel/.test((document.querySelector('.mp-create') || {}).textContent || ''), null, { timeout: 10000 });
check('the Ranked Play lounge: "Create duel", no rating shown', await alice.evaluate(() => !document.querySelector('.rq-rating') && !/Your \dK rating/.test(document.querySelector('#app').textContent)));
await alice.click('.mp-create');
await alice.waitForSelector('.dialog .mp-cr', { timeout: 5000 });
check('the duel dialog offers Fair (chosen) or Regular cards', await alice.evaluate(() => { const c = [...document.querySelectorAll('.mp-cr-card.deck')]; return c.length === 2 && c[0].classList.contains('on') && /Fair/.test(c[0].textContent) && /Regular/.test(c[1].textContent); }));
await alice.click('.dialog .actions .btn.primary');
await alice.waitForFunction(() => AshtonkMania.Multiplayer.isRP() && AshtonkMania.Multiplayer.room.rp.stage === 'waitjoin', null, { timeout: 15000 });
const duel = await alice.evaluate(() => AshtonkMania.Multiplayer.room.code);
check('…a Fair duel by default', await alice.evaluate(() => AshtonkMania.Multiplayer.room.rp.fair === true));
check('the duel is unrated', await alice.evaluate(() => !AshtonkMania.Multiplayer.room.rp.rated));
await bob.waitForFunction(c => document.querySelector('.mp-roomlist') && AshtonkMania.MultiplayerScreen._roomRows && !AshtonkMania.MultiplayerScreen._roomRows.has(c), duel, { timeout: 15000 });
check('the duel isn\'t listed in the normal lounge', true);
const refused = await bob.evaluate(async c => { try { await AshtonkMania.MultiplayerScreen.joinHere(c); return 'joined'; } catch (e) { return e.message; } }, duel);
check('joining a duel\'s code from the normal lounge is refused', /Ranked Play/.test(refused) && !(await bob.evaluate(() => AshtonkMania.Multiplayer.inRoom())), refused);
await bob.evaluate(() => AshtonkMania.Screens.go('multiplayer', { ranked: true, force: true }));
await bob.waitForFunction(c => AshtonkMania.MultiplayerScreen._roomRows && AshtonkMania.MultiplayerScreen._roomRows.has(c), duel, { timeout: 15000 });
check('…but it is in the Ranked Play lounge, as a Fair duel', await bob.evaluate(c => /Fair/.test(AshtonkMania.MultiplayerScreen._roomRows.get(c).row.textContent), duel));
await shot(bob, 'mp-rp-lounge');
await bob.evaluate(c => AshtonkMania.MultiplayerScreen._roomRows.get(c).row.click(), duel);
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Multiplayer.isRP() && AshtonkMania.Multiplayer.room.rp.stage === 'stars' && document.querySelector('.rks .rks-lock'), null, { timeout: 15000 })));
check('both in: each chooses a star rating first', await alice.evaluate(() => /Choose your star rating/.test(document.querySelector('.rks').textContent) && /Star Rating/.test(document.querySelector('.rkm-head').textContent)));
await alice.click('.rks-pre:nth-child(3)');
await alice.click('.rks-lock');
await alice.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room; return r.rp.users[AshtonkMania.Multiplayer.me].pref === 4; }, null, { timeout: 5000 });
check('the other player\'s pick stays hidden until both lock in', await bob.evaluate(() => { const r = AshtonkMania.Multiplayer.room, me = AshtonkMania.Multiplayer.me, o = Object.keys(r.rp.users).find(id => id !== me); return r.rp.users[o].picked && r.rp.users[o].pref == null && r.rp.stage === 'stars'; }));
await shot(bob, 'mp-rp-pick-stars');
await bob.fill('.rks-num', '2.5');
await bob.click('.rks-lock');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => !['waitjoin', 'stars'].includes(AshtonkMania.Multiplayer.room.rp.stage), null, { timeout: 15000 })));
check('both locked in: the cards are dealt', true);
// round 1's intro: the face-off, then the deck's star rating; no corner pieces or chat yet
await alice.waitForSelector('.rki .rki-x', { timeout: 10000 });
check('the intro: both players face off with the star ratings they chose', await alice.evaluate(() => document.querySelectorAll('.rki-side').length === 2 && /Chose 4\.00★/.test(document.querySelector('.rkm').textContent) && /Chose 2\.50★/.test(document.querySelector('.rkm').textContent) && !/Rating: /.test(document.querySelector('.rki-side').textContent) && document.querySelector('.rkm').classList.contains('no-corners') && document.querySelector('.rkm-chat').classList.contains('hidden') && document.querySelector('#app').classList.contains('hide-toolbar')));
await shot(alice, 'mp-rp-intro');
check('…and no one star rating is announced for the deck (each plays their own difficulty)', await alice.evaluate(() => !/Star rating has been decided/.test(document.querySelector('.rkm').textContent) && !document.querySelector('.rki-stars')));
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Multiplayer.room.rp.stage === 'discard' && document.querySelectorAll('.rkd-slot').length === 5, null, { timeout: 30000 })));
const vis = await alice.evaluate(() => { const g = AshtonkMania.Multiplayer.room.rp, me = AshtonkMania.Multiplayer.me, o = Object.keys(g.users).find(id => id !== me); return { mine: g.users[me].hand.every(i => g.cards[i]), theirs: g.users[o].hand.some(i => g.cards[i]), n: [g.users[me].hand.length, g.users[o].hand.length] }; });
check('discard phase: five cards each, and only your own are shown to you', vis.mine && !vis.theirs && vis.n.join() === '5,5', JSON.stringify(vis));
// Dana spectates Alice: Alice's match screen as Alice sees it — read-only
await dana.waitForFunction(() => AshtonkMania.Presence.players.some(p => p.name === 'Alice' && p.status === 'ranked'), null, { timeout: 15000 });
await dana.evaluate(() => AshtonkMania.Spectate.watch(AshtonkMania.Presence.players.find(p => p.name === 'Alice')));
await dana.waitForFunction(() => AshtonkMania.Screens.currentName === 'spectator' && document.querySelectorAll('.rkm.watch .rkd-slot').length === 5, null, { timeout: 15000 });
{
  const dv = await dana.evaluate(() => { const W = RankedWatch, g = W.room.rp, me = W.me, o = Object.keys(g.users).find(id => id !== me);
    return { pov: W.room.players.find(p => p.id === me).name, mine: g.users[me].hand.every(i => g.cards[i]), theirs: g.users[o].hand.some(i => g.cards[i]), tag: document.querySelector('.rkm-watchtag').textContent,
      input: !!document.querySelector('.rkm-chat input'), btn: document.querySelector('.rkd-btn').hidden, live: document.querySelectorAll('.rkd-slot.live').length, cap: document.querySelector('.rkm-cap').textContent }; });
  check('spectating a player in Ranked Play: their match screen as they see it — their five cards face up, their opponent\'s hidden — and nothing to press', dv.pov === 'Alice' && dv.mine && !dv.theirs && /Spectating\s*Alice/.test(dv.tag) && !dv.input && dv.btn && !dv.live && /Alice/.test(dv.cap), JSON.stringify(dv));
  if (SHOTS) await dana.waitForTimeout(1500); // (the screen's transition over)
  await shot(dana, 'mp-rp-spectate-discard');
}
check('the stage display: "Discard Phase" with its timer', await alice.evaluate(() => /Discard Phase/.test(document.querySelector('.rkm-head').textContent) && /^00:\d\d\.\d\d\d$/.test(document.querySelector('.rkm-timer').textContent)));
await bob.waitForTimeout(2200); await shot(bob, 'mp-rp-discard');
await alice.click('.rkd-slot:nth-child(1)'); await alice.click('.rkd-slot:nth-child(2)');
check('marking cards turns "Keep cards" into "Replace 2 cards"', await alice.evaluate(() => document.querySelector('.rkd-btn').textContent === 'Replace 2 cards'));
const before = await alice.evaluate(() => { const g = AshtonkMania.Multiplayer.room.rp; return g.users[AshtonkMania.Multiplayer.me].hand.slice(0, 2); });
await alice.click('.rkd-btn'); await bob.click('.rkd-btn');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Multiplayer.room.rp.stage === 'pick', null, { timeout: 20000 })));
check('replaced cards are swapped for new ones from the deck', await alice.evaluate(b => { const h = AshtonkMania.Multiplayer.room.rp.users[AshtonkMania.Multiplayer.me].hand; return h.length === 5 && !b.some(i => h.includes(i)); }, before));
const active = await alice.evaluate(() => { const r = AshtonkMania.Multiplayer.room; return r.players.find(p => p.id === r.rp.active).name; });
const activePage = active === 'Alice' ? alice : bob, otherPage = active === 'Alice' ? bob : alice;
check('pick phase: the stage overlay names whose pick it is', await otherPage.evaluate(n => [...document.querySelectorAll('.rkm-banner')].some(b => b.textContent.includes(`${n}'s pick`)), active));
{
  // a 4:3 screen at a tablet's interface size (125%): the match shrinks to fit instead of the hand of cards covering
  // the chat and your corner
  await otherPage.setViewportSize({ width: 1024, height: 768 }); await otherPage.evaluate(() => AshtonkMania.Settings.set('ui.scale', 1.25)); await otherPage.waitForTimeout(600);
  const ov = await otherPage.evaluate(() => {
    const R = e => e.getBoundingClientRect(), hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const cards = [...document.querySelectorAll('.rkm-myhand .rkc')].map(R), chat = R(document.querySelector('.rkm-chat')), me = R(document.querySelector('.rkm-corner.me'));
    return { n: cards.length, chat: cards.some(c => hit(c, chat)), corner: cards.some(c => hit(c, me)), zoom: document.querySelector('.rkm').style.zoom };
  });
  await otherPage.evaluate(() => AshtonkMania.Settings.set('ui.scale', 0.9)); await otherPage.setViewportSize({ width: 1400, height: 800 }); await otherPage.waitForTimeout(400);
  check('Ranked Play on a 4:3 tablet-sized screen: the hand of cards clears the chat and your corner', ov.n === 5 && !ov.chat && !ov.corner && !!ov.zoom, JSON.stringify(ov));
}
await activePage.waitForTimeout(1200);
await activePage.hover('.rkm-myhand .rkh-slot:nth-child(3)');
await otherPage.waitForFunction(() => document.querySelector('.rkm-opphand .rkh-slot.hover'), null, { timeout: 5000 });
check('hand replay: the other player sees the card being looked at', true);
check('…and so does someone spectating', await dana.waitForFunction(() => document.querySelector('.rkm.watch .rkh-slot.hover'), null, { timeout: 5000 }).then(() => true, () => false));
await activePage.click('.rkm-myhand .rkh-slot:nth-child(3)');
await otherPage.waitForFunction(() => document.querySelector('.rkm-opphand .rkh-slot.sel'), null, { timeout: 5000 });
await activePage.waitForTimeout(700); await shot(activePage, 'mp-rp-pick');
await shot(otherPage, 'mp-rp-opp-pick');
await activePage.click('.rkm-myhand .rkh-slot.sel .rkh-play');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => ['picked', 'ready'].includes(AshtonkMania.Multiplayer.room.rp.stage), null, { timeout: 10000 })));
check('the played card is revealed to both', await otherPage.evaluate(() => { const g = AshtonkMania.Multiplayer.room.rp; return g.played >= 0 && !!g.cards[g.played]; }));
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Multiplayer.room.rp.stage === 'ready' && AshtonkMania.Multiplayer.room.rp.countdown, null, { timeout: 30000 })));
check('gameplay warmup: both are ready once they have the beatmap, and the countdown starts', await alice.evaluate(() => /Gameplay/.test(document.querySelector('.rkm-head').textContent) && !!document.querySelector('.rkw .rkc')));
await alice.waitForTimeout(1600); await shot(alice, 'mp-rp-warmup');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.mp, null, { timeout: 30000 })));
check('…then both play the card', true);
const danaWatches = dana.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.spectate, null, { timeout: 30000 }).then(() => true,
  () => dana.evaluate(() => { const S = AshtonkMania.Spectate, c = S.cur; return { screen: AshtonkMania.Screens.currentName, cur: c && { title: c.head.title, set: c.head.onlineSetId, ended: c.ended, started: c.started }, has: !!(c && S.findMap(c.head)), dl: c && c.head.onlineSetId > 0 ? (AshtonkMania.ExplorerScreen.downloads.get(c.head.onlineSetId) || {}).state : null }; }));
await alice.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; s.feed = generateAutoInputs(s.engine.notes, s.keys).flat(); s.feedIdx = 0; });
// Bob plays two notes in three: he loses the round
await bob.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; s.feed = generateAutoInputs(s.engine.notes.filter((n, i) => i % 3), s.keys).flat(); s.feedIdx = 0; });
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.room.rp.stage === 'results', null, { timeout: 45000 })));
const r1 = await bob.evaluate(() => { const r = AshtonkMania.Multiplayer.room, g = r.rp, id = n => r.players.find(p => p.name === n).id, a = id('Alice'), b = id('Bob'); return { a: g.users[a].life, b: g.users[b].life, sa: g.results.scores[a], sb: g.results.scores[b], d: g.results.dmg[b] }; });
check('round 1: the lower score takes the difference + 50,000 damage — at most 500,000 for a song both played', r1.a === 1000000 && r1.b === 1000000 - Math.min(r1.sa - r1.sb + 50000, 500000) && r1.d.bonusDamage === 50000 && (r1.sa - r1.sb + 50000 > 500000) === (r1.d.capped === 500000), JSON.stringify(r1));
{
  const watched = await danaWatches;
  const back = await dana.waitForFunction(() => AshtonkMania.Screens.currentName === 'spectator' && document.querySelector('.rkm.watch .rkr'), null, { timeout: 30000 }).then(() => true, () => false);
  check('…someone spectating watches the song live, then is back on the match screen for the round\'s results', watched === true && back, JSON.stringify({ watched, back }));
  await dana.evaluate(() => AshtonkMania.Screens.back());
  await dana.waitForFunction(() => !AshtonkMania.Spectate.target && !RankedWatch.ws, null, { timeout: 5000 }).catch(() => {});
  await dana.context().close();
}
await bob.waitForFunction(() => document.querySelector('.rkr-col.hit'), null, { timeout: 12000 });
check('results: both scores side by side, then the damage lands on the loser', await bob.evaluate(() => document.querySelectorAll('.rkr-col').length === 2 && /Damage/.test(document.querySelector('.rkr-break').textContent)));
await shot(bob, 'mp-rp-results');
// round 2: the other player's turn (turns alternate); Bob leaves the song part-way, keeping the score he had, and
// spectates Alice playing on
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Multiplayer.room.rp.stage === 'pick' && AshtonkMania.Multiplayer.room.rp.round === 2, null, { timeout: 25000 })));
check('round 2 is the other player\'s turn; the round multiplier is now ×1', await alice.evaluate(n => { const r = AshtonkMania.Multiplayer.room; return r.players.find(p => p.id === r.rp.active).name !== n && r.rp.mult === 1; }, active));
await otherPage.waitForTimeout(1500);
await otherPage.click('.rkm-myhand .rkh-slot:nth-child(1)');
await otherPage.click('.rkm-myhand .rkh-slot.sel .rkh-play');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.mp && AshtonkMania.Music.playing, null, { timeout: 45000 })));
await alice.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; s.feed = generateAutoInputs(s.engine.notes, s.keys).flat(); s.feedIdx = 0; });
// (Bob hits every other note for a bit before he gives up)
await bob.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; s.feed = generateAutoInputs(s.engine.notes.filter((n, i) => i % 2), s.keys).flat(); s.feedIdx = 0;
  const M = AshtonkMania.Multiplayer, send = M.send.bind(M); M.send = m => { if (m && m.t === 'score') window.__lastScore = m.score; if (m && m.t === 'quit') window.__quitScore = window.__lastScore; return send(m); }; });
await bob.waitForFunction(() => AshtonkMania.GameplayScreen.s.engine.score.scoreStd > 0, null, { timeout: 20000 });
const lifeBefore = await alice.evaluate(() => { const r = AshtonkMania.Multiplayer.room; return r.rp.users[r.players.find(p => p.name === 'Bob').id].life; });
await bob.keyboard.press('Escape');
await bob.waitForSelector('.dialog', { timeout: 5000 });
check('leaving the song in Ranked Play: your score stops where it is, and you can watch them play on', await bob.evaluate(() => /score stops where it is now/.test(document.querySelector('.dialog').textContent) && /watch them play on/.test(document.querySelector('.dialog').textContent)));
await bob.waitForTimeout(100); await bob.keyboard.down('Enter'); await bob.waitForTimeout(750); await bob.keyboard.up('Enter'); // (a dangerous button: held)
await bob.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.room.rp.stage === 'playing', null, { timeout: 10000 });
check('…you wait in the match while your opponent plays on', await bob.evaluate(() => /Gameplay is in progress/.test(document.querySelector('.rkm-stage').textContent)));
await bob.waitForFunction(() => /[1-9]/.test((document.querySelector('.rkm-live b') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
check('…watching their score climb as they play', await bob.evaluate(() => /[1-9]/.test((document.querySelector('.rkm-live b') || {}).textContent || '')), await bob.evaluate(() => (document.querySelector('.rkm-live') || {}).textContent));
await bob.waitForSelector('.rkm-spec:not([hidden])', { timeout: 10000 }).catch(() => {});
check('…with Spectate (Alice) on the waiting screen', await bob.evaluate(() => { const b = document.querySelector('.rkm-spec'); return !!b && !b.hidden && /Spectate Alice/.test(b.textContent); }));
await shot(bob, 'mp-rp-gaveup');
await bob.click('.rkm-spec');
await bob.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.spectate, null, { timeout: 15000 }).catch(() => {});
check('…which plays her song live, as she plays it', await bob.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; return AshtonkMania.Screens.currentName === 'gameplay' && !!s && !!s.spectate && !s.mp && /Watching Alice play/.test((document.querySelector('.spec-live') || {}).textContent || ''); }));
await bob.waitForTimeout(1500); await shot(bob, 'mp-rp-spectating');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.room.rp.stage === 'results' && AshtonkMania.Multiplayer.room.rp.round === 2, null, { timeout: 45000 })));
check('…and back to the match for the round\'s results when her song ends', !(await bob.evaluate(() => !!AshtonkMania.Spectate.target)));
const r2 = await alice.evaluate(() => { const r = AshtonkMania.Multiplayer.room, b = r.players.find(p => p.name === 'Bob').id, a = r.players.find(p => p.name === 'Alice').id; return { score: r.rp.results.scores[b], alice: r.rp.results.scores[a], winner: r.rp.results.winner === a ? 'Alice' : r.rp.results.winner, life: r.rp.users[b].life }; });
const quitScore = await bob.evaluate(() => window.__quitScore);
check('…the round counts the score he had when he left (not 0), and he takes the damage', r2.score > 0 && r2.score === Math.round(quitScore) && r2.winner === 'Alice' && r2.life < lifeBefore, JSON.stringify({ ...r2, quitScore, lifeBefore }));
// Bob leaves the match: he loses it (nothing rated)
await bob.evaluate(() => AshtonkMania.Multiplayer.leave());
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room && AshtonkMania.Multiplayer.room.rp.stage === 'ended', null, { timeout: 30000 });
await alice.waitForSelector('.rke-title', { timeout: 5000 });
const end = await alice.evaluate(() => ({ title: document.querySelector('.rke-title').textContent, rating: !!document.querySelector('.rke-rating'), sub: (document.querySelector('.rke-sub') || {}).textContent, again: document.querySelector('.rke-btn.again').textContent }));
check('the opponent leaving ends the match: VICTORY, with no rating change', end.title === 'VICTORY' && !end.rating && /4K duel · 2 rounds played/.test(end.sub) && end.again === 'New duel', JSON.stringify(end));
check('…and the one who left is still named on it', await alice.evaluate(() => [...document.querySelectorAll('.rke-row')].some(e => /Bob/.test(e.textContent)) && !/Opponent/.test(document.querySelector('.rke-rows').textContent)));
await alice.waitForTimeout(1600); await shot(alice, 'mp-rp-ended');
check('the match screen shows no stray "null" / "undefined" / "NaN" text', await alice.evaluate(() => !/\b(null|undefined|NaN)\b/.test(document.querySelector('.rkm').innerText)));
await alice.click('.rke-btn.quit');
await alice.waitForFunction(() => !AshtonkMania.Multiplayer.inRoom() && /Create duel/.test((document.querySelector('.mp-create') || {}).textContent || ''), null, { timeout: 10000 });
check('back in the Ranked Play lounge', true);
// Regular cards: chosen in the dialog, kept for next time, and the lounge says so
await alice.click('.mp-create');
await alice.waitForSelector('.dialog .mp-cr', { timeout: 5000 });
await alice.click('.mp-cr-card.deck[data-v="regular"]');
await alice.click('.dialog .actions .btn.primary');
await alice.waitForFunction(() => AshtonkMania.Multiplayer.isRP() && AshtonkMania.Multiplayer.room.rp.stage === 'waitjoin', null, { timeout: 15000 });
const reg = await alice.evaluate(() => AshtonkMania.Multiplayer.room.code);
check('a Regular duel: the room is Regular, and the choice is kept', await alice.evaluate(() => AshtonkMania.Multiplayer.room.rp.fair === false && AshtonkMania.Settings.get('mp.rpDeck') === 'regular'));
await bob.evaluate(() => AshtonkMania.Screens.go('multiplayer', { ranked: true, force: true }));
await bob.waitForFunction(c => AshtonkMania.MultiplayerScreen._roomRows && AshtonkMania.MultiplayerScreen._roomRows.has(c), reg, { timeout: 15000 });
check('…the Ranked Play lounge lists it as Regular', await bob.evaluate(c => /Regular/.test(AshtonkMania.MultiplayerScreen._roomRows.get(c).row.textContent), reg));
await alice.evaluate(() => { AshtonkMania.Multiplayer.leave(); AshtonkMania.Settings.set('mp.rpDeck', 'fair'); });

// the dashboard: Alice's friends (Bob among them), then she spectates his play live from his panel's ⋯ menu
await alice.evaluate(() => AshtonkMania.Screens.go('home')); await bob.evaluate(() => AshtonkMania.Screens.go('home'));
// spectating (lazer's): Spectate someone and you're on their Spectator Mode screen — between songs, waiting for them
{
  await bob.waitForTimeout(800);
  await alice.evaluate(() => { const b = AshtonkMania.Presence.players.find(p => p.name === 'Bob'); AshtonkMania.Spectate.watch(b); });
  await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'spectator' && document.querySelector('.spm-box .spm-idle'), null, { timeout: 8000 }).catch(() => {});
  const spm = await alice.evaluate(() => ({ title: (document.querySelector('.spm-t') || {}).textContent, user: !!document.querySelector('.spm-user .up[data-name="Bob"]'), idle: (document.querySelector('.spm-idle') || {}).textContent || '',
    off: !!(document.querySelector('.spm-watch') || {}).disabled, auto: /Automatically download missing beatmaps/.test((document.querySelector('.spm-auto') || {}).textContent || '') && !document.querySelector('.spm-auto .toggle.on') }));
  await shot(alice, 'mp-spec-screen');
  check('Spectate: lazer\'s Spectator Mode screen — the player, "Waiting for Bob to play…", Start Watching off till he does, automatic downloads off', spm.title === 'Spectator Mode' && spm.user && /Waiting for Bob to play/.test(spm.idle) && spm.off && spm.auto, JSON.stringify(spm));
  await alice.evaluate(() => AshtonkMania.Screens.back());
  await alice.waitForFunction(() => AshtonkMania.Screens.currentName !== 'spectator', null, { timeout: 5000 }).catch(() => {});
  await bob.waitForFunction(() => AshtonkMania.Spectate.host.watchers === 0, null, { timeout: 5000 }).catch(() => {});
  check('…Back leaves it, and stops watching', await alice.evaluate(() => !AshtonkMania.Spectate.target) && await bob.evaluate(() => AshtonkMania.Spectate.host.watchers === 0));
}
// (Bob's page was opened again from an invite link since: his picture again)
await bob.evaluate(() => { AshtonkMania.ProfileManager.sharedAvatar = 'preset:neru'; AshtonkMania.Presence.pushStatus(); });
await alice.waitForTimeout(500);
await alice.click('#toolbar [data-tab="dashboard"]');
await alice.evaluate(() => [...document.querySelectorAll('.dash-tabs .ov-tab')].find(b => /^friends$/.test(b.textContent)).click());
await alice.waitForSelector('.dash-list .up[data-name="Bob"]', { timeout: 8000 });
const fr = await alice.evaluate(() => ({ kept: JSON.parse(localStorage.getItem('am.friends') || '[]').map(f => f.name + ':' + f.avatar), stream: [...document.querySelectorAll('.dash-si')].map(b => b.textContent).join('|'),
  pic: (document.querySelector('.dash-list .up[data-name="Bob"] img.avatar') || {}).src || '' }));
check('dashboard → friends: lazer\'s All / Online / Offline counts and the friend panels with their pictures (kept for when they\'re offline)', fr.kept.join() === 'Bob:preset:neru' && /neru/.test(fr.pic) && /All1/.test(fr.stream) && /Online1/.test(fr.stream) && /Offline0/.test(fr.stream), JSON.stringify(fr));
// Bob plays (real key presses); Alice spectates from the ⋯ menu
await bob.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.Screens.go('gameplay', { mapId: m.id, mods: ['NF'], force: true }); });
await bob.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 30000 });
const mash = setInterval(() => { for (const k of ['KeyD', 'KeyF', 'KeyJ', 'KeyK']) bob.keyboard.press(k).catch(() => {}); }, 150);
await alice.waitForFunction(() => /Playing/.test(document.querySelector('.up[data-name="Bob"]')?.textContent || ''), null, { timeout: 12000 });
await bob.waitForTimeout(3500);
const playingMenu = await panelMenu(alice, 'Bob');
await menuPick(alice, 'Spectate');
check('…his panel says what he\'s playing, and its menu offers Spectate', playingMenu.includes('Spectate'), JSON.stringify(playingMenu));
await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.spectate, null, { timeout: 20000 });
await alice.waitForTimeout(5000);
const sp = await alice.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; return { feed: s.feed.length, judged: s.engine.score.judged, t: AshtonkMania.Music.time, live: (document.querySelector('.spec-live-t') || {}).textContent || '', synced: !!s.spectate.synced, bar: !!document.querySelector('.rp-bar, .replay-bar') }; });
const bobT = await bob.evaluate(() => AshtonkMania.Music.time);
// the chat while watching: the bar's Message button (or F8) opens the conversation with him over his play; Esc closes
// the chat, not the spectating
const msgBtn = await alice.evaluate(() => (document.querySelector('.spec-live .spec-msg > span') || {}).textContent || ''); // (the label: the count of unread messages beside it apart)
await alice.keyboard.press('F8');
await alice.waitForSelector('.chat', { timeout: 5000 }).catch(() => {});
const specChat = await alice.evaluate(() => ({ open: !!document.querySelector('.chat'), cur: AshtonkMania.Chat.cur, watching: AshtonkMania.Screens.currentName === 'gameplay' && !!AshtonkMania.GameplayScreen.s?.spectate }));
await alice.keyboard.press('Escape'); await alice.waitForTimeout(500);
const afterEsc = await alice.evaluate(() => ({ chat: !!document.querySelector('.chat'), watching: AshtonkMania.Screens.currentName === 'gameplay' && !!AshtonkMania.GameplayScreen.s?.spectate }));
check('spectating a friend: "Message" (or F8) opens your conversation with him over his play; Esc closes it and the watching goes on', msgBtn === 'Message' && specChat.open && /^pm:/.test(specChat.cur) && specChat.watching && !afterEsc.chat && afterEsc.watching, JSON.stringify({ msgBtn, specChat, afterEsc }));
clearInterval(mash);
check('spectating: from the Spectator Mode screen his song starts by itself — "Watching Bob play … live" — a little behind him, from what he presses', sp.feed > 30 && sp.judged > 5 && sp.synced && /^Watching Bob play .+ live$/.test(sp.live) && sp.t < bobT && bobT - sp.t < 6000, JSON.stringify({ ...sp, bobT }));
const st = await bob.evaluate(() => (AshtonkMania.Presence.players.find(p => p.name === 'Alice') || {}).status);
{
  // the notes played before Alice started watching are judged from Bob's own presses (not all perfect)
  const aLog = await alice.evaluate(() => AshtonkMania.GameplayScreen.s.engine.judgementLog.map(x => [Math.round(x.t), x.j, x.col]));
  const upTo = aLog.length ? aLog[aLog.length - 1][0] - 200 : 0;
  const bLog = await bob.evaluate(T => AshtonkMania.GameplayScreen.s.engine.judgementLog.filter(x => x.t <= T).map(x => [Math.round(x.t), x.j, x.col]), upTo);
  const a2 = aLog.filter(x => x[0] <= upTo);
  const same = a2.length === bLog.length && a2.every((x, i) => x[1] === bLog[i][1] && x[2] === bLog[i][2]);
  check('spectating: notes from before you started watching are judged as the player played them', same && a2.length > 5, JSON.stringify({ a: a2.slice(0, 12), b: bLog.slice(0, 12), na: a2.length, nb: bLog.length }));
}
check('…and shows as spectating on the online list', st === 'watching', st);
const seen = await bob.evaluate(() => [...document.querySelectorAll('.spec-list')].map(e => e.textContent).join());
check('Bob sees who\'s spectating him on his HUD', /Spectators \(1\)/.test(seen) && /Alice/.test(seen), seen);
// Alice's window losing focus doesn't pause what she's watching
await alice.evaluate(() => window.dispatchEvent(new Event('blur'))); await alice.waitForTimeout(300);
check('spectating: switching away doesn\'t bring up the pause menu', await alice.evaluate(() => !document.querySelector('.pause-menu') && AshtonkMania.GameplayScreen.s.running));
// no Skip of her own while she watches: it skips when Bob does
check('spectating: no Skip button for the watcher — it skips only when the player does', await alice.evaluate(() => { const b = document.querySelector('.hud-skip'); return !b || b.style.display === 'none'; }));
// Bob pauses: Alice's playback stops where he paused, and she sees his pause menu — the button he's on lit up as he
// goes — and it carries on when he continues
await bob.keyboard.press('Escape');
await bob.waitForSelector('.pause-menu', { timeout: 3000 });
const sawMenu = await alice.waitForSelector('.pause-menu .pm-btn.theirs', { timeout: 10000 }).then(() => true, () => false);
const pm = await alice.evaluate(() => ({ buttons: [...document.querySelectorAll('.pause-menu .pm-btn')].map(b => b.textContent.trim()).join(), desc: (document.querySelector('.pause-menu .pm-desc') || {}).textContent || '', leave: !!document.querySelector('.pause-menu .pm-leave'), t: AshtonkMania.Music.time, running: AshtonkMania.GameplayScreen.s.running }));
await alice.waitForTimeout(600);
const held = await alice.evaluate(t => Math.abs(AshtonkMania.Music.time - t) < 50 && !AshtonkMania.GameplayScreen.s.running, pm.t);
await bob.hover('.pause-menu .pm-btn:nth-child(2)');
const lit = await alice.waitForFunction(() => (document.querySelector('.pause-menu .pm-btn.spec-sel') || {}).textContent === 'Retry', null, { timeout: 8000 }).then(() => true, () => false);
await shot(alice, 'mp-spec-paused');
await bob.click('.pause-menu .pm-btn.primary');
const resumed = await alice.waitForFunction(() => !document.querySelector('.pause-menu') && AshtonkMania.GameplayScreen.s.running, null, { timeout: 10000 }).then(() => true, () => false);
check('spectating: the player pausing shows the watcher his pause menu ("Bob paused"), playback held where he paused; the button he\'s on lights up; it carries on when he continues',
  sawMenu && pm.buttons === 'Continue,Retry,Quit' && /Bob paused/.test(pm.desc) && pm.leave && held && lit && resumed, JSON.stringify({ sawMenu, pm, held, lit, resumed }));
// Bob fails: Alice's playback fails there too — his fail menu (Retry and Quit, his to choose), saying who failed —
// and Stop watching takes her back to the Spectator Mode screen, still watching him
{
  await bob.evaluate(() => AshtonkMania.GameplayScreen.fail(AshtonkMania.GameplayScreen.gameTime()));
  await alice.waitForSelector('.pause-menu .pm-btn', { timeout: 10000 }).catch(() => {});
  const own = await alice.evaluate(() => ({ buttons: [...document.querySelectorAll('.pause-menu .pm-btn')].map(b => b.textContent.trim()), head: (document.querySelector('.pause-menu h2') || {}).textContent, desc: (document.querySelector('.pause-menu .pm-desc') || {}).textContent, failed: !!AshtonkMania.GameplayScreen.s.failed }));
  await shot(alice, 'mp-spec-failed');
  check('spectating a fail: it fails here too — his fail menu (Retry, Quit), saying who failed', own.failed && own.buttons.join() === 'Retry,Quit' && /failed/.test(own.head) && /Bob failed/.test(own.desc), JSON.stringify(own));
  await alice.click('.pause-menu .pm-leave');
  await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'spectator', null, { timeout: 8000 }).catch(() => {});
  check('…Stop watching goes back to the Spectator Mode screen, still watching Bob', await alice.evaluate(() => AshtonkMania.Screens.currentName === 'spectator' && !!AshtonkMania.Spectate.target && AshtonkMania.Spectate.target.name === 'Bob'));
}
await alice.evaluate(() => AshtonkMania.Screens.back());
await alice.waitForFunction(() => AshtonkMania.Screens.currentName !== 'spectator', null, { timeout: 8000 }).catch(() => {});
await bob.waitForFunction(() => AshtonkMania.Spectate.host.watchers === 0, null, { timeout: 5000 }).catch(() => {});
check('leaving the Spectator Mode screen stops spectating; Bob stops streaming', await bob.evaluate(() => AshtonkMania.Spectate.host.watchers === 0));
await bob.evaluate(() => AshtonkMania.Screens.go('home'));

// the lounge's Create room offers Team Versus; the room starts in teams and shows as Team Versus in the lounge
{
  await alice.evaluate(() => { AshtonkMania.Multiplayer.leave(); AshtonkMania.Screens.go('multiplayer', { force: true }); });
  await bob.evaluate(() => { AshtonkMania.Multiplayer.leave(); AshtonkMania.Screens.go('multiplayer', { force: true }); });
  await alice.waitForSelector('.mp-create', { timeout: 10000 });
  await alice.click('.mp-create'); await alice.waitForSelector('.mp-cr');
  const offered = await alice.evaluate(() => [...document.querySelectorAll('.mp-cr-card.type')].map(b => b.textContent));
  await alice.click('.mp-cr-card.type[data-v="teams"]');
  await alice.click('.mp-cr-card.vis[data-v="true"]');
  await alice.click('.dialog .actions .btn.primary');
  await alice.waitForFunction(() => AshtonkMania.Multiplayer.inRoom(), null, { timeout: 10000 });
  const inTeams = await alice.evaluate(() => AshtonkMania.Multiplayer.room.settings.type === 'teams' && !!document.querySelector('.mp-teams'));
  await bob.evaluate(() => {}); await shot(alice, 'mp-teams');
  const stacked = await alice.evaluate(() => { const t = [...document.querySelectorAll('.mp-teams > .mp-team')].map(e => e.getBoundingClientRect()); return t.length === 2 && t[1].top >= t[0].bottom - 1; });
  const listed = await bob.waitForFunction(() => [...document.querySelectorAll('.mp-room-row')].some(r => /Alice/.test(r.textContent) && /Team Versus/.test(r.textContent) && r.querySelector('.mp-rteams')), null, { timeout: 12000 }).then(() => true, () => false);
  check('lounge: Create room offers Team Versus; the room starts red vs blue (stacked, red above blue) and the lounge lists it as Team Versus', offered.length === 2 && /Team Versus/.test(offered[1]) && inTeams && stacked && listed, JSON.stringify({ offered, inTeams, stacked, listed }));
  await alice.evaluate(() => AshtonkMania.Multiplayer.leave());
}

// a whole match over plain requests (Fay's network blocks WebSockets) with a player on WebSockets: the beatmap, ready,
// start, each other's live scores, everyone's results
{
  const fay = await player('Fay', noWebSocket);
  await fay.waitForFunction(() => { const P = AshtonkMania.Presence; return P.ws && P.ws.http && P.me; }, null, { timeout: 20000 }).catch(() => {});
  const code = await fay.evaluate(async () => { await AshtonkMania.Multiplayer.create({ isPublic: false }); return AshtonkMania.Multiplayer.inRoom() && AshtonkMania.Multiplayer.ws.http ? AshtonkMania.Multiplayer.code : null; });
  await alice.evaluate(c => { AshtonkMania.Screens.go('multiplayer', { force: true }); return c && AshtonkMania.Multiplayer.join(c).catch(e => e.message); }, code);
  await fay.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.Multiplayer.selectMap(m, []); });
  await Promise.all([alice, fay].map(p => p.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room; return r && r.map && r.players.length === 2 && r.players.every(x => x.hasMap); }, null, { timeout: 10000 }).catch(() => {})));
  await alice.evaluate(() => AshtonkMania.Multiplayer.send({ t: 'ready', ready: true }));
  await fay.evaluate(() => AshtonkMania.Multiplayer.send({ t: 'ready', ready: true }));
  await fay.waitForFunction(() => AshtonkMania.Multiplayer.room.players.every(p => p.ready), null, { timeout: 10000 }).catch(() => {});
  await fay.evaluate(() => AshtonkMania.Multiplayer.send({ t: 'start' }));
  const began = await Promise.all([alice, fay].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.mp, null, { timeout: 15000 }).then(() => true, () => false)));
  for (const p of [alice, fay]) await p.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; if (s) { s.feed = generateAutoInputs(s.engine.notes, s.keys).flat(); s.feedIdx = 0; } });
  const live = await Promise.all([alice, fay].map(p => p.waitForFunction(() => [...AshtonkMania.Multiplayer.opps.values()].some(o => o.score > 0), null, { timeout: 25000 }).then(() => true, () => false)));
  const done = await Promise.all([alice, fay].map(p => p.waitForFunction(() => AshtonkMania.Multiplayer.lastResults && AshtonkMania.Multiplayer.lastResults.rows.length === 2, null, { timeout: 60000 }).then(() => true, () => false)));
  const rows = await fay.evaluate(() => (AshtonkMania.Multiplayer.lastResults || { rows: [] }).rows.map(x => [x.name, x.score]));
  check('a whole match over plain requests with a player on WebSockets: start, each other\'s live scores, everyone\'s results', !!code && began.every(Boolean) && live.every(Boolean) && done.every(Boolean) && rows.length === 2 && rows.every(x => x[1] > 0), JSON.stringify({ code, began, live, done, rows }));
  await alice.evaluate(() => { AshtonkMania.Multiplayer.leave(); AshtonkMania.Screens.go('multiplayer', {}, { replace: true }); });
  await fay.context().close();
}
// a filter that lets the connection open, then cuts it off moments later, again and again: after the third, the game
// goes over plain requests — and is online
{
  const erin = await player('Erin', () => {
    const W = window.WebSocket;
    window.WebSocket = function (u, p) {
      const ws = new W(u, p);
      if (/\/api\/mp\//.test(String(u))) ws.addEventListener('open', () => setTimeout(() => { const f = ws.onclose; ws.onclose = ws.onmessage = null; try { ws.close(); } catch { /* closed */ } if (f) f({ code: 1006, reason: '' }); }, 300));
      return ws;
    };
  });
  const on = await erin.waitForFunction(() => { const P = AshtonkMania.Presence; return P.ws && P.ws.http && P.ws.readyState === 1 && P.me; }, null, { timeout: 45000 }).then(() => true, () => false);
  const r = await erin.evaluate(() => ({ kept: !!localStorage.getItem('am.mpHttp'), why: (NetErr.log.find(e => e.code === 'MP-WC') || {}).code || null }));
  check('a connection that opens, then is cut off moments later, again and again: after the third, plain requests — and online', on && r.kept && r.why === 'MP-WC', JSON.stringify({ on, ...r }));
  await erin.context().close();
}

check('no page errors', errors.length === 0, errors.join(' | '));
// nobody at the keyboard: the game left open goes offline after a while (here 1 s), and comes back at the next key
{
  const bobId = await bob.evaluate(() => AshtonkMania.Presence.me);
  const seen = () => alice.evaluate(id => AshtonkMania.Presence.players.some(p => p.id === id), bobId);
  const before = await seen();
  await bob.evaluate(() => { const P = AshtonkMania.Presence; P._idleWas = P.IDLE; P.IDLE = 1000; P.lastInput = performance.now() - 5000; P.idleCheck(); });
  await alice.evaluate(() => AshtonkMania.Presence.send({ t: 'list' })); await alice.waitForTimeout(1500);
  const gone = !(await alice.evaluate(() => AshtonkMania.Presence.players.some(p => p.name === 'Bob')));
  await bob.evaluate(() => { const P = AshtonkMania.Presence; P.IDLE = P._idleWas; }); await bob.keyboard.press('Shift');
  const back = await alice.waitForFunction(() => AshtonkMania.Presence.players.some(p => p.name === 'Bob'), null, { timeout: 15000 }).then(() => true, () => false);
  check('someone who leaves the game open and walks away goes offline, and is back the moment they press a key', before && gone && back, JSON.stringify({ before, gone, back }));
}
await browser.close();
await mf.dispose();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
