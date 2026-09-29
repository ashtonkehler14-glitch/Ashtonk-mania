// Two-player online match in headless Chromium against the real Worker + Durable Objects (run locally
// in workerd through Miniflare). Usage: MINIFLARE_DIR=<dir with node_modules/miniflare> node tests/mp-e2e.mjs
import { readFileSync } from 'node:fs';
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

const types = { '.html': 'text/html', '.js': 'text/javascript' };
const mf = new Miniflare({
  modules: true, scriptPath: join(root, 'worker/index.js'), modulesRoot: root, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2026-08-01', cf: false, port: 0, host: '127.0.0.1',
  durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker' },
  serviceBindings: {
    ASSETS: async req => {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const file = p === '/' ? join(root, 'index.html') : join(root, p);
      try { return new Response(readFileSync(file), { headers: { 'content-type': types[extname(file)] || 'application/octet-stream' } }); }
      catch { return new Response('not found', { status: 404 }); }
    },
  },
});
const url = String(await mf.ready);

const SHOTS = process.argv.includes('--shots');
const shotDir = process.env.SHOT_DIR || join(root, 'tests', 'shots');
const shot = async (page, n) => { if (SHOTS) await page.screenshot({ path: join(shotDir, n + '.png') }); };
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? '  — ' + extra : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  if (await page.$('.onboarding')) { await page.fill('.onboarding .ob-name', name); await page.keyboard.press('Enter'); await page.waitForTimeout(300); }
  await page.evaluate(async () => {
    const b = await (await fetch('/tests/fixtures/test-set.osz')).blob();
    await AshtonkMania.App.importFiles([new File([b], 'test-set.osz')]);
  });
  await page.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length === 1, null, { timeout: 15000 });
  await page.evaluate(() => AshtonkMania.Screens.go('multiplayer'));
  await page.waitForTimeout(400);
  return page;
}

const alice = await player('Alice');
const bob = await player('Bob');
await shot(alice, 'mp-lobby');
check('multiplayer lobby renders', await alice.evaluate(() => !!document.querySelector('.mp-lobby') && !document.querySelector('.mp-lobby button[disabled]')));

// Alice creates a room, Bob joins with the code
await alice.click('.mp-card:nth-child(2) button');
await alice.waitForFunction(() => AshtonkMania.Multiplayer.inRoom(), null, { timeout: 10000 });
const code = await alice.evaluate(() => AshtonkMania.Multiplayer.room.code);
check('room created with a code', /^[A-Z0-9]{6}$/.test(code), code);
await bob.fill('.mp-code', code);
await bob.click('.mp-card:nth-child(3) .btn');
await bob.waitForFunction(() => AshtonkMania.Multiplayer.inRoom(), null, { timeout: 10000 });
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room.players.length === 2, null, { timeout: 5000 });
check('opponent joined; both see two players', await bob.evaluate(() => document.querySelectorAll('.mp-player:not(.empty)').length === 2));
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

// Alice picks the beatmap through song select (pick mode)
await alice.click('.mp-map-actions .btn');
await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'songselect' && AshtonkMania.SongSelect.mpPick, null, { timeout: 5000 });
await alice.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.SongSelect.select(m.id); });
await alice.waitForTimeout(300);
await alice.click('.ss-cookie');
await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.room.map, null, { timeout: 5000 });
await bob.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room; return r.map && r.players.every(p => p.hasMap); }, null, { timeout: 5000 });
check('host picked the beatmap; both players have it', await bob.evaluate(() => AshtonkMania.Multiplayer.room.map.version === '4K Normal'));
check('start is disabled until both are ready', await alice.evaluate(() => document.querySelector('.mp-start').disabled));

await alice.click('.mp-ready'); await bob.click('.mp-ready');
await alice.waitForFunction(() => !document.querySelector('.mp-start').disabled, null, { timeout: 5000 });
check('both ready enables Start', true);
await shot(alice, 'mp-room');
await alice.click('.mp-start');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.mp, null, { timeout: 10000 })));
check('match starts for both players', true);
check('synchronised countdown before the music starts', await alice.evaluate(() => !!document.querySelector('.mp-countdown') && !AshtonkMania.Music.playing));

// Alice plays perfectly (auto input feed), Bob does nothing and fails
await alice.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; s.feed = generateAutoInputs(s.engine.notes, s.keys).flat(); s.feedIdx = 0; });
await alice.waitForFunction(() => AshtonkMania.Music.playing, null, { timeout: 10000 });
await bob.waitForTimeout(2500);
await shot(alice, 'mp-ingame');
const board = await bob.evaluate(() => [...document.querySelectorAll('.hud-mp-row')].map(r => r.textContent));
check('in-game board shows both players with live scores', board.length === 2 && board.some(t => t.includes('Alice')), JSON.stringify(board));
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.lastResults, null, { timeout: 40000 })));
const ra = await alice.evaluate(() => ({ verdict: document.querySelector('.mp-verdict')?.textContent, res: AshtonkMania.Multiplayer.lastResults }));
const rb = await bob.evaluate(() => document.querySelector('.mp-verdict')?.textContent);
await shot(alice, 'mp-results');
check('results: higher score wins', /You win/.test(ra.verdict) && /You lose/.test(rb), `${ra.verdict} / ${rb}`);
check('winner row has the full score', ra.res.rows[0].name === 'Alice' && ra.res.rows[0].score === 1000000, JSON.stringify(ra.res.rows.map(r => [r.name, r.score, r.passed])));
check('scores are also saved locally', await alice.evaluate(() => AshtonkMania.ScoreManager.scores.length === 1));

// rematch: forfeit by quitting
await alice.click('.mp-ready'); await bob.click('.mp-ready');
await alice.waitForFunction(() => !document.querySelector('.mp-start').disabled, null, { timeout: 5000 });
await alice.click('.mp-start');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.Music.playing, null, { timeout: 15000 })));
await bob.keyboard.press('Escape');
await bob.waitForSelector('.dialog');
await bob.click('.dialog .btn.danger');
await alice.waitForFunction(() => AshtonkMania.Multiplayer.lastResults && AshtonkMania.Multiplayer.lastResults.rows.some(r => r.forfeit), null, { timeout: 10000 });
check('quitting forfeits the match', await alice.evaluate(() => AshtonkMania.Multiplayer.lastResults.winner === AshtonkMania.Multiplayer.me));
await alice.keyboard.press('Escape');
await alice.waitForSelector('.dialog').catch(() => {});
if (await alice.$('.dialog')) await alice.click('.dialog .btn.danger');
await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer', null, { timeout: 5000 });

// room updates keep a half-typed chat message
await bob.fill('.mp-tabpane input', 'half-typed');
await alice.click('.mp-ready');
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.players.some(p => p.ready), null, { timeout: 5000 });
check('room updates don\'t wipe what you are typing', await bob.evaluate(() => document.querySelector('.mp-tabpane input').value === 'half-typed'));
await alice.click('.mp-ready');

// song search in the room: the guest searches their library and suggests; the host picks the suggestion
await bob.click('.mp-tab:nth-child(2)');
await bob.fill('.mp-sr-box input', 'hard');
await bob.waitForFunction(() => [...document.querySelectorAll('.mp-sr-row')].some(r => r.textContent.includes('7K Hard')), null, { timeout: 5000 });
check('room search finds songs in the library', true);
await shot(bob, 'mp-search');
await bob.evaluate(() => [...document.querySelectorAll('.mp-sr-row')].find(r => r.textContent.includes('7K Hard')).querySelector('button').click());
await alice.waitForSelector('.mp-msg.suggest button', { timeout: 5000 });
check('guest suggestions reach the host with a Pick button', true);
await alice.click('.mp-msg.suggest button');
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.map && AshtonkMania.Multiplayer.room.map.version === '7K Hard', null, { timeout: 5000 });
check('host picks a suggested beatmap', true);

// online search: the host picks a beatmap nobody has; it downloads for the host, the guest downloads it from the room
const onlineSet = { source: 'mock', page: 0, hasMore: false, sets: [{ id: 424242, title: 'Online Anthem', titleUnicode: '', artist: 'The Test Suite', artistUnicode: '', creator: 'Ashton', source: '', status: 'ranked', playCount: 1, favourites: 1, video: false, nsfw: false,
  diffs: [{ id: 4242420, mode: 3, version: 'Online Easy', stars: 1.5, keys: 4, od: 8, hp: 7, bpm: 150, length: 20, notes: 50, lns: 4 }, { id: 4242421, mode: 3, version: 'Online Hard', stars: 1.7, keys: 4, od: 8, hp: 7, bpm: 150, length: 20, notes: 50, lns: 4 }] }] };
for (const p of [alice, bob]) {
  await p.route('**/api/search**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(onlineSet) }));
  await p.route('**/api/download/424242', r => r.fulfill({ contentType: 'application/octet-stream', body: readFileSync(join(root, 'tests', 'fixtures', 'online-set.osz')) }));
  await p.route('https://assets.ppy.sh/**', r => r.abort());
}
// the host opens the beatmap provider from the map panel ("Search beatmaps" popup), searches online and picks
await alice.evaluate(() => [...document.querySelectorAll('.mp-map-actions .btn')].find(b => /Search beatmaps/.test(b.textContent)).click());
await alice.waitForSelector('.mp-search-dlg', { timeout: 5000 });
check('"Search beatmaps" opens the beatmap provider search in the room', await alice.evaluate(() => document.querySelector('.mp-search-dlg [data-src="online"]').classList.contains('on')));
await alice.fill('.mp-search-dlg .mp-sr-box input', 'online');
await alice.waitForFunction(() => [...document.querySelectorAll('.mp-search-dlg .mp-sr-row')].some(r => r.textContent.includes('Online Hard')), null, { timeout: 5000 });
check('room search finds songs online', true);
await shot(alice, 'mp-search-popup');
await alice.evaluate(() => [...document.querySelectorAll('.mp-search-dlg .mp-sr-row')].find(r => r.textContent.includes('Online Hard')).querySelector('button').click());
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.map && AshtonkMania.Multiplayer.room.map.version === 'Online Hard', null, { timeout: 15000 });
await alice.waitForFunction(() => !document.querySelector('.mp-search-dlg'), null, { timeout: 3000 }).catch(() => {});
check('host picks an online beatmap from the popup (downloaded on pick, popup closes)', await alice.evaluate(() => AshtonkMania.BeatmapManager.sets.some(s => s.onlineId === 424242) && !document.querySelector('.mp-search-dlg')));
// the other player installs it automatically — no click — and only for the room
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room.players.every(p => p.hasMap), null, { timeout: 15000 });
check('the other player installs the room beatmap automatically', await bob.evaluate(() => AshtonkMania.BeatmapManager.sets.some(s => s.onlineId === 424242)));
await bob.waitForSelector('.mp-temp', { timeout: 5000 });
check('it is marked as installed only for this room', await bob.evaluate(() => AshtonkMania.Multiplayer.isTemp()));
await shot(bob, 'mp-temp');

// each player picks their own difficulty
await bob.selectOption('.mp-diff select', { label: await bob.evaluate(() => [...document.querySelectorAll('.mp-diff option')].find(o => o.textContent.startsWith('Online Easy')).textContent) });
await alice.waitForFunction(() => { const b = AshtonkMania.Multiplayer.room.players.find(p => p.id !== AshtonkMania.Multiplayer.me); return b.diff && b.diff.version === 'Online Easy'; }, null, { timeout: 5000 });
check('players choose their own difficulty (shown to the room)', await alice.evaluate(() => [...document.querySelectorAll('.mp-pdiff')].some(e => e.textContent.includes('Online Easy'))));
await alice.click('.mp-ready'); await bob.click('.mp-ready');
await alice.waitForFunction(() => !document.querySelector('.mp-start').disabled, null, { timeout: 5000 });
await alice.click('.mp-start');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s, null, { timeout: 15000 })));
const played = [await alice.evaluate(() => AshtonkMania.GameplayScreen.s.rec.version), await bob.evaluate(() => AshtonkMania.GameplayScreen.s.rec.version)];
check('each player plays the difficulty they chose', played[0] === 'Online Hard' && played[1] === 'Online Easy', played.join(' / '));
for (const p of [bob, alice]) {
  await p.waitForFunction(() => AshtonkMania.Music.playing, null, { timeout: 15000 });
  await p.keyboard.press('Escape');
  await p.waitForSelector('.dialog', { timeout: 5000 }).catch(() => {});
  if (await p.$('.dialog .btn.danger')) await p.click('.dialog .btn.danger');
  await p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer', null, { timeout: 8000 });
}
await alice.waitForFunction(() => AshtonkMania.Multiplayer.lastResults && AshtonkMania.Multiplayer.lastResults.map.version === 'Online Hard', null, { timeout: 10000 });
check('results show which difficulty each player played', await alice.evaluate(() => AshtonkMania.Multiplayer.lastResults.rows.find(r => r.name === 'Bob').diff.version === 'Online Easy'));

// leaving: the other player becomes host
await alice.evaluate(() => AshtonkMania.Multiplayer.leave());
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.players.length === 1 && AshtonkMania.Multiplayer.isHost(), null, { timeout: 5000 });
check('host left → remaining player becomes host', true);
await bob.evaluate(() => AshtonkMania.Multiplayer.leave());
await bob.waitForFunction(() => !AshtonkMania.BeatmapManager.sets.some(s => s.onlineId === 424242), null, { timeout: 5000 }).catch(() => {});
check('leaving the room removes the beatmap that was installed only for it', await bob.evaluate(() => !AshtonkMania.BeatmapManager.sets.some(s => s.onlineId === 424242) && AshtonkMania.BeatmapManager.sets.length === 1));
check('beatmaps you picked yourself stay', await alice.evaluate(() => AshtonkMania.BeatmapManager.sets.some(s => s.onlineId === 424242)));

// quick match pairs two searching players
await alice.evaluate(() => AshtonkMania.Screens.go('multiplayer', { force: true }));
await bob.waitForTimeout(300);
await alice.click('.mp-card:nth-child(1) button');
await alice.waitForFunction(() => AshtonkMania.Multiplayer.inRoom(), null, { timeout: 10000 });
await bob.click('.mp-card:nth-child(1) button');
await bob.waitForFunction(() => AshtonkMania.Multiplayer.inRoom(), null, { timeout: 10000 });
check('quick match puts both players in the same room', await alice.evaluate(() => AshtonkMania.Multiplayer.room.code) === await bob.evaluate(() => AshtonkMania.Multiplayer.room.code));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
await mf.dispose();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
