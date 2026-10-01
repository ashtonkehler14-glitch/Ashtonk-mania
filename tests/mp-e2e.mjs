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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  // Element.append(null) writes the word "null" on screen: any such call is reported as a page error
  await ctx.addInitScript(() => { for (const P of [Element.prototype, DocumentFragment.prototype]) { const o = P.append; P.append = function (...a) { if (a.some(x => x === null || x === undefined)) console.error('a null child was appended (it shows up as the text "null") to ' + (this.className || this.tagName)); return o.apply(this, a); }; } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && /null child was appended/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  if (await page.$('.onboarding')) { await page.fill('.onboarding .ob-name', name); await page.keyboard.press('Enter'); await page.waitForSelector('.setup-step-wom'); await page.evaluate(() => AshtonkMania.Onboarding.finish()); await page.waitForTimeout(300); }
  await page.evaluate(async () => {
    const b = await (await fetch('/tests/fixtures/test-set.osz')).blob();
    await AshtonkMania.App.importFiles([new File([b], 'test-set.osz')]);
  });
  await page.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length === 1, null, { timeout: 15000 });
  await page.evaluate(() => AshtonkMania.Screens.go('multiplayer'));
  await page.waitForTimeout(400);
  return page;
}

// Create room: regular or ranked, then public or private
async function createRoom(page, ranked, isPublic) {
  await page.click('.mp-create');
  await page.waitForSelector('.mp-cr');
  await page.click(`.mp-cr-card.type[data-v="${ranked}"]`);
  await page.click(`.mp-cr-card.vis[data-v="${isPublic}"]`);
  await page.click('.dialog .actions .btn.primary');
  await page.waitForFunction(() => AshtonkMania.Multiplayer.inRoom(), null, { timeout: 10000 });
}

const alice = await player('Alice');
const bob = await player('Bob');
await shot(alice, 'mp-lobby');
check('multiplayer lobby renders', await alice.evaluate(() => !!document.querySelector('.mp-lobby') && !document.querySelector('.mp-lobby button[disabled]')));

// Alice creates a room, Bob joins with the code
await createRoom(alice, false, false);
await alice.waitForFunction(() => AshtonkMania.Multiplayer.inRoom(), null, { timeout: 10000 });
const code = await alice.evaluate(() => AshtonkMania.Multiplayer.room.code);
check('room created with a code', /^[A-Z0-9]{6}$/.test(code), code);
// Invite: Alice sees Bob online and invites him; Bob gets an invite prompt (he declines, then joins with the code)
await alice.waitForFunction(() => AshtonkMania.Presence.others().some(p => p.name === 'Bob'), null, { timeout: 10000 });
await alice.click('.mp-invite');
await alice.waitForSelector('.inv-row');
check('invite dialog lists online players and offers a link', await alice.evaluate(() => [...document.querySelectorAll('.inv-row b')].some(b => b.textContent === 'Bob') && !!document.querySelector('.inv-link')));
await alice.click('.inv-row .btn.primary');
await bob.waitForFunction(() => [...document.querySelectorAll('.dialog h2')].some(x => /Alice invited you/.test(x.textContent)), null, { timeout: 5000 });
check('the invited player gets a Join prompt', await bob.evaluate(code => document.querySelector('.dialog .body').textContent.includes(code), code));
await bob.click('.dialog .pd-btn.cancel');
await alice.click('.dialog .actions .btn');
await alice.waitForTimeout(300);
await bob.fill('.mp-code', code);
await bob.click('.mp-join');
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
const board = await bob.evaluate(() => [...document.querySelectorAll('.hud-mp-row')].map(r => r.textContent));
check('in-game board shows both players with their live score', board.length === 2 && board.some(t => t.includes('Alice')) && board.every(t => /\d$/.test(t) && !/pp$/.test(t)), JSON.stringify(board));
await bob.waitForSelector('.hud-mpfailed', { timeout: 20000 });
check('as in lazer multiplayer: running out of health marks the play failed, and it carries on', await bob.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; return s.mpFailed && !s.failed && s.running && s.engine.health.value <= 0; }));
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.lastResults, null, { timeout: 40000 })));
check('the play finishes and is saved as a failed score (F, no pp, score untouched)', await bob.evaluate(() => { const sc = AshtonkMania.ScoreManager.scores[0]; return sc && sc.passed === false && sc.grade === 'F' && sc.pp === 0; }));
const ra = await alice.evaluate(() => ({ verdict: document.querySelector('.mp-verdict')?.textContent, res: AshtonkMania.Multiplayer.lastResults }));
const rb = await bob.evaluate(() => document.querySelector('.mp-verdict')?.textContent);
await shot(alice, 'mp-results');
check('results: the higher score wins (as in osu! multiplayer)', /You win/.test(ra.verdict) && /You lose/.test(rb), `${ra.verdict} / ${rb}`);
check('winner row: full score and its pp', ra.res.rows[0].name === 'Alice' && ra.res.rows[0].score === 1000000 && ra.res.rows[0].pp > 0 && ra.res.rows[1].pp === 0, JSON.stringify(ra.res.rows.map(r => [r.name, r.score, Math.round(r.pp), r.passed])));
check('results panel leads with the score', await alice.evaluate(() => /^[\d,]+$/.test(document.querySelector('.mp-res-score').textContent.trim())));
check('scores are also saved locally', await alice.evaluate(() => AshtonkMania.ScoreManager.scores.length === 1));

// mods: Alice wants DT (+ her own Hidden) — Bob has to accept DT; Bob picks Mirror for himself
await alice.evaluate(() => AshtonkMania.Multiplayer.setMods(['DT', 'HD']));
await bob.waitForSelector('.mp-vote .mp-accept', { timeout: 5000 });
await shot(bob, 'mp-vote');
// (Alice's copy of the room arrives on its own socket message: wait for it rather than checking the instant Bob sees the vote)
check('a speed mod (DT) needs the other player to accept', await alice.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room, v = document.querySelector('.mp-vote'); return !r.mods.length && r.vote && r.vote.mods[0] === 'DT' && v && /Waiting for everyone/.test(v.textContent); }, null, { timeout: 5000 }).then(() => true, async () => { console.log('  alice:', await alice.evaluate(() => JSON.stringify({ mods: AshtonkMania.Multiplayer.room.mods, vote: AshtonkMania.Multiplayer.room.vote, text: document.querySelector('.mp-vote')?.textContent }))); return false; }));
await bob.evaluate(() => AshtonkMania.Multiplayer.setMods(['MR']));
await bob.click('.mp-vote .mp-accept');
await alice.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room; return !r.vote && r.mods[0] === 'DT'; }, null, { timeout: 5000 });
await bob.waitForTimeout(300);
const afterVote = await bob.evaluate(() => { const r = AshtonkMania.Multiplayer.room; const m = id => r.players.find(p => p.id === id).mods.join(); return { host: m(r.host), me: m(AshtonkMania.Multiplayer.me), banner: !!document.querySelector('.mp-vote') }; });
check('after both accept, DT applies to the room; each player keeps their own mods', afterVote.host === 'HD' && afterVote.me === 'MR' && !afterVote.banner, JSON.stringify(afterVote));

// rematch: forfeit by quitting
await alice.click('.mp-ready'); await bob.click('.mp-ready');
await alice.waitForFunction(() => !document.querySelector('.mp-start').disabled, null, { timeout: 5000 });
await alice.click('.mp-start');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.Music.playing, null, { timeout: 15000 })));
const modsA = await alice.evaluate(() => AshtonkMania.GameplayScreen.s.mods.join());
const modsB = await bob.evaluate(() => AshtonkMania.GameplayScreen.s.mods.join());
check('in the match: DT for everyone plus each player\'s own mods', /DT/.test(modsA) && /HD/.test(modsA) && !/MR/.test(modsA) && /DT/.test(modsB) && /MR/.test(modsB) && !/HD/.test(modsB), `${modsA} / ${modsB}`);
await bob.keyboard.press('Escape');
await bob.waitForSelector('.dialog');
await bob.click('.dialog .pd-btn.danger');
// (nobody can die in multiplayer, so Alice plays on to the end of the song before the results come in)
await alice.waitForFunction(() => AshtonkMania.Multiplayer.lastResults && AshtonkMania.Multiplayer.lastResults.rows.some(r => r.forfeit), null, { timeout: 40000 });
check('quitting forfeits the match', await alice.evaluate(() => AshtonkMania.Multiplayer.lastResults.winner === AshtonkMania.Multiplayer.me));
if (await alice.evaluate(() => AshtonkMania.Screens.currentName === 'gameplay')) {
  await alice.keyboard.press('Escape');
  await alice.waitForSelector('.dialog', { timeout: 2000 }).catch(() => {});
  if (await alice.$('.dialog .pd-btn.danger')) await alice.click('.dialog .pd-btn.danger');
}
await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer', null, { timeout: 5000 });

// room updates keep a half-typed chat message
await bob.fill('.mp-tabpane input', 'half-typed');
await alice.click('.mp-ready');
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.players.some(p => p.ready), null, { timeout: 5000 });
check('room updates don\'t wipe what you are typing', await bob.evaluate(() => document.querySelector('.mp-tabpane input').value === 'half-typed'));
await alice.click('.mp-ready');

// beatmap search opens the real Browse screen (Beatmap Explorer). Online results are mocked (the mirrors are external).
const onlineSet = { source: 'mock', page: 0, hasMore: false, sets: [{ id: 424242, title: 'Online Anthem', titleUnicode: '', artist: 'The Test Suite', artistUnicode: '', creator: 'Ashton', source: '', status: 'ranked', playCount: 1, favourites: 1, video: false, nsfw: false,
  diffs: [{ id: 4242420, mode: 3, version: 'Online Easy', stars: 1.5, keys: 4, od: 8, hp: 7, bpm: 150, length: 20, notes: 50, lns: 4 }, { id: 4242421, mode: 3, version: 'Online Hard', stars: 1.7, keys: 4, od: 8, hp: 7, bpm: 150, length: 20, notes: 50, lns: 4 }] }] };
for (const p of [alice, bob]) {
  await p.route('**/api/search**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(onlineSet) }));
  await p.route('**/api/download/424242', r => r.fulfill({ contentType: 'application/octet-stream', body: readFileSync(join(root, 'tests', 'fixtures', 'online-set.osz')) }));
  await p.route('https://assets.ppy.sh/**', r => r.abort());
  await p.route('https://b.ppy.sh/**', r => r.abort());
}
check('the room side panel is just chat', await alice.evaluate(() => document.querySelectorAll('.mp-side .mp-tabpane').length === 1 && !document.querySelector('.mp-sr-box') && /Chat/.test(document.querySelector('.mp-side').textContent)));
const pickFromBrowse = async (p, version) => {
  await p.evaluate(() => [...document.querySelectorAll('.mp-map-actions .btn')].find(b => /Search beatmaps/.test(b.textContent)).click());
  await p.waitForFunction(() => AshtonkMania.Screens.currentName === 'explore' && document.querySelector('.ex-mp'), null, { timeout: 5000 });
  await p.waitForSelector('.ex-card[data-id="424242"]', { timeout: 10000 });
  await p.click('.ex-card[data-id="424242"] .ex-t');
  await p.waitForSelector('.bso .bso-diff', { timeout: 3000 });
  await p.evaluate(v => [...document.querySelectorAll('.bso-diff')].find(b => b.getAttribute('aria-label').startsWith(v)).click(), version);
  await p.click('.bso .bso-dl');
  await p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer', null, { timeout: 15000 });
};
// the host searches Browse and picks a difficulty; it downloads for the host first
await pickFromBrowse(alice, 'Online Hard');
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.map && AshtonkMania.Multiplayer.room.map.version === 'Online Hard', null, { timeout: 15000 });
check('"Search beatmaps" opens Browse; the host picks there (downloaded on pick) and returns to the room', await alice.evaluate(() => AshtonkMania.BeatmapManager.sets.some(s => s.onlineId === 424242) && AshtonkMania.Multiplayer.inRoom()));
// the other player installs it automatically — no click — and only for the room
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room.players.every(p => p.hasMap), null, { timeout: 15000 });
check('the other player installs the room beatmap automatically', await bob.evaluate(() => AshtonkMania.BeatmapManager.sets.some(s => s.onlineId === 424242)));
await bob.waitForSelector('.mp-temp', { timeout: 5000 });
check('it is marked as installed only for this room', await bob.evaluate(() => AshtonkMania.Multiplayer.isTemp()));
await shot(bob, 'mp-temp');
// the other player browses and suggests; the host picks the suggestion from chat
await pickFromBrowse(bob, 'Online Easy');
await alice.waitForFunction(() => [...document.querySelectorAll('.mp-msg.suggest')].some(m => m.textContent.includes('Online Easy')), null, { timeout: 5000 });
check('guests suggest from Browse; the suggestion reaches the host with a Pick button', true);
await alice.evaluate(() => [...document.querySelectorAll('.mp-msg.suggest')].find(m => m.textContent.includes('Online Easy')).querySelector('button').click());
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.map && AshtonkMania.Multiplayer.room.map.version === 'Online Easy', null, { timeout: 10000 });
check('host picks a suggested beatmap', true);
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room.players.every(p => p.hasMap), null, { timeout: 10000 });

// each player picks their own difficulty
await bob.selectOption('.mp-diff select', { label: await bob.evaluate(() => [...document.querySelectorAll('.mp-diff option')].find(o => o.textContent.startsWith('Online Hard')).textContent) });
await alice.waitForFunction(() => { const b = AshtonkMania.Multiplayer.room.players.find(p => p.id !== AshtonkMania.Multiplayer.me); return b.diff && b.diff.version === 'Online Hard'; }, null, { timeout: 5000 });
check('players choose their own difficulty (shown to the room)', await alice.evaluate(() => [...document.querySelectorAll('.mp-pdiff')].some(e => e.textContent.includes('Online Hard'))));
await alice.click('.mp-ready'); await bob.click('.mp-ready');
await alice.waitForFunction(() => !document.querySelector('.mp-start').disabled, null, { timeout: 5000 });
await alice.click('.mp-start');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s, null, { timeout: 15000 })));
const played = [await alice.evaluate(() => AshtonkMania.GameplayScreen.s.rec.version), await bob.evaluate(() => AshtonkMania.GameplayScreen.s.rec.version)];
check('each player plays the difficulty they chose', played[0] === 'Online Easy' && played[1] === 'Online Hard', played.join(' / '));
for (const p of [bob, alice]) {
  await p.waitForFunction(() => AshtonkMania.Music.playing, null, { timeout: 15000 });
  await p.keyboard.press('Escape');
  await p.waitForSelector('.dialog', { timeout: 5000 }).catch(() => {});
  if (await p.$('.dialog .pd-btn.danger')) await p.click('.dialog .pd-btn.danger');
  await p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer', null, { timeout: 8000 });
}
await alice.waitForFunction(() => AshtonkMania.Multiplayer.lastResults && AshtonkMania.Multiplayer.lastResults.map.version === 'Online Easy', null, { timeout: 10000 });
check('results show which difficulty each player played', await alice.evaluate(() => AshtonkMania.Multiplayer.lastResults.rows.find(r => r.name === 'Bob').diff.version === 'Online Hard'));

// a dropped connection reconnects on its own; the only notice is "Reconnected"
await bob.evaluate(() => { document.querySelectorAll('#toasts .toast').forEach(t => t.remove()); AshtonkMania.Multiplayer.ws.close(); });
await bob.waitForTimeout(150);
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

// Ranked Play: a ranked room (1v1) — Alice opens a public one, Bob joins it from Open rooms
await alice.evaluate(() => { AshtonkMania.Multiplayer.leave(); AshtonkMania.Screens.go('multiplayer', { force: true }); });
await bob.evaluate(() => { AshtonkMania.Multiplayer.leave(); AshtonkMania.Screens.go('multiplayer', { force: true }); });
await alice.waitForSelector('.mp-create');
await createRoom(alice, true, true);
await alice.waitForFunction(() => AshtonkMania.Multiplayer.isRP(), null, { timeout: 10000 });
await bob.waitForFunction(() => [...document.querySelectorAll('.mp-room-row')].some(r => /ranked/i.test(r.textContent)), null, { timeout: 15000 });
await bob.evaluate(() => [...document.querySelectorAll('.mp-room-row')].find(r => /ranked/i.test(r.textContent)).click());
await bob.waitForFunction(() => AshtonkMania.Multiplayer.isRP() && AshtonkMania.Multiplayer.room.players.length === 2, null, { timeout: 10000 });
check('a ranked room holds the two players', await alice.evaluate(() => AshtonkMania.Multiplayer.room.code) === await bob.evaluate(() => AshtonkMania.Multiplayer.room.code));
check('no rating: each player shows the skill level they picked', await bob.evaluate(() => AshtonkMania.Multiplayer.room.players.every(p => p.rating === undefined && p.skill > 0)));
await Promise.all([alice, bob].map(p => p.waitForSelector('.rpl .rk-opt', { timeout: 10000 })));
check('the ranked lobby is one card: no chat or rules list while waiting, three levels (Beginner to Advanced)', await bob.evaluate(() => getComputedStyle(document.querySelector('.mp-side')).display === 'none' && !document.querySelector('.rp-help') && [...document.querySelectorAll('.rpl .rk-opt b')].map(b => b.textContent).join() === 'Beginner,Intermediate,Advanced'));
await shot(bob, 'mp-rp-gather');
await bob.click('.rpl .rk-opt:nth-child(1)'); // Beginner
await bob.waitForFunction(() => { const r = AshtonkMania.Multiplayer.room; return r.players.find(p => p.id === AshtonkMania.Multiplayer.me).skill === 1.5; }, null, { timeout: 5000 });
check('picking a skill level tells the room', true);
check('the expected card range is shown between both levels', await alice.evaluate(() => /★/.test(document.querySelector('.rpl-range').textContent)));
for (const p of [alice, bob]) await p.click('.rp-readybtn');
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room.rp.phase === 'pick', null, { timeout: 40000 });
check('both ready: the cards are dealt', true);
const rpState = await alice.evaluate(() => { const r = AshtonkMania.Multiplayer.room; return { hands: Object.values(r.rp.hands).map(h => h.length), picker: r.players.find(p => p.id === r.rp.picker).name }; });
check('both players are dealt cards and one of them picks', rpState.hands.every(n => n >= 1) && !!rpState.picker, JSON.stringify(rpState));
await shot(alice, 'mp-rp-pick');
const pickerPage = rpState.picker === 'Alice' ? alice : bob;
check('each player can reroll their hand once a round', await alice.evaluate(() => !!document.querySelector('.rp-hand:not(.theirs) .rp-reroll')) && await bob.evaluate(() => !!document.querySelector('.rp-hand:not(.theirs) .rp-reroll')));
await pickerPage.click('.rp-hand:not(.theirs) .qp-card');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.mp, null, { timeout: 30000 })));
check('the picked card is played by both', true);
await alice.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; s.feed = generateAutoInputs(s.engine.notes, s.keys).flat(); s.feedIdx = 0; });
// Bob plays two notes in three: he loses the round, but not all his HP
await bob.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; s.feed = generateAutoInputs(s.engine.notes.filter((n, i) => i % 3), s.keys).flat(); s.feedIdx = 0; });
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && ['damage', 'final'].includes(AshtonkMania.Multiplayer.room.rp.phase), null, { timeout: 45000 })));
const hp = await bob.evaluate(() => { const r = AshtonkMania.Multiplayer.room; return Object.fromEntries(r.players.map(p => [p.name, r.rp.hp[p.id]])); });
check('the lower score takes the score difference as damage', hp.Alice === 1000000 && hp.Bob < 1000000 && hp.Bob > 0, JSON.stringify(hp));
await shot(bob, 'mp-rp-damage');
// round 2: Bob (the loser) picks, then leaves the song part-way — Alice is brought back and wins the round
await bob.waitForFunction(() => AshtonkMania.Multiplayer.room.rp.phase === 'pick' && AshtonkMania.Multiplayer.room.rp.round === 2, null, { timeout: 20000 });
await bob.click('.rp-hand:not(.theirs) .qp-card');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.mp && AshtonkMania.Music.playing, null, { timeout: 30000 })));
const hpBefore = await alice.evaluate(() => { const r = AshtonkMania.Multiplayer.room; return r.rp.hp[r.players.find(p => p.name === 'Bob').id]; });
await bob.keyboard.press('Escape');
await bob.waitForSelector('.dialog', { timeout: 5000 });
check('leaving the song in Ranked Play warns that the round goes to the opponent', await bob.evaluate(() => /wins this round/.test(document.querySelector('.dialog').textContent)));
await bob.keyboard.press('Enter');
await alice.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.room.rp.phase === 'damage' && AshtonkMania.Multiplayer.room.rp.round === 2, null, { timeout: 10000 });
const fr = await alice.evaluate(() => { const r = AshtonkMania.Multiplayer.room, bobId = r.players.find(p => p.name === 'Bob').id; return { loser: r.rp.last.loser === bobId, forfeit: r.rp.last.forfeit, hp: r.rp.hp[bobId], players: r.players.length }; });
check('the other player is brought back to the room and wins the round; the match goes on', fr.loser && fr.forfeit && fr.hp < hpBefore && fr.players === 2, JSON.stringify(fr));
await shot(alice, 'mp-rp-forfeit');
await bob.evaluate(() => AshtonkMania.Multiplayer.leave());
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room && AshtonkMania.Multiplayer.room.rp.phase === 'final', null, { timeout: 10000 });
check('the opponent leaving the room ends the match: victory (no rating)', await alice.evaluate(() => /Victory/.test(document.querySelector('.rp-final-t').textContent) && typeof RankedRating === 'undefined'));
await shot(alice, 'mp-rp-final');

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
await mf.dispose();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
