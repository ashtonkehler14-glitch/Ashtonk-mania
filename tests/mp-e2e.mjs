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

// Create room: public or private (the lounge only makes regular rooms)
async function createRoom(page, ranked, isPublic) {
  await page.click('.mp-create');
  await page.waitForSelector('.mp-cr');
  await page.click(`.mp-cr-card.vis[data-v="${isPublic}"]`);
  await page.click('.dialog .actions .btn.primary');
  await page.waitForFunction(() => AshtonkMania.Multiplayer.inRoom(), null, { timeout: 10000 });
}

const alice = await player('Alice');
const bob = await player('Bob');
await shot(alice, 'mp-lobby');
check('multiplayer lobby renders', await alice.evaluate(() => !!document.querySelector('.mp-lobby') && !document.querySelector('.mp-lobby button[disabled]')));

// friends: invites and spectating are only between friends. Alice opens the dashboard (lazer's), finds Bob under
// "currently online" and sends a request from his panel's ⋯ menu; he accepts it from the prompt that pops up
const panelMenu = async (page, name) => { await page.evaluate(n => document.querySelector(`.up[data-name="${n}"] .up-more`).click(), name); await page.waitForSelector('.menu button'); return page.$$eval('.menu button', b => b.map(x => x.textContent.trim())); };
const menuPick = (page, label) => page.evaluate(l => [...document.querySelectorAll('.menu button')].find(b => b.textContent.trim() === l).click(), label);
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
check('friend requests: the ⋯ menu\'s "Add friend" sends one, the other player accepts from a prompt, and both become friends', frBefore.includes('View profile') && frBefore.includes('Add friend') && !frBefore.includes('Spectate') && pending.includes('Friend request sent') && both, JSON.stringify({ frBefore, pending, both }));
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
check('invite dialog lists friends who are online and offers a link', await alice.evaluate(() => [...document.querySelectorAll('.inv-row b')].some(b => b.textContent === 'Bob') && !!document.querySelector('.inv-link')));
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
check('in-game board shows both players with their live score', board.length === 2 && board.some(t => t.includes('Alice')) && board.every(t => /\d$/.test(t) && !/pp$/.test(t)), JSON.stringify(board));
await bob.waitForSelector('.hud-mpfailed', { timeout: 20000 });
check('as in lazer multiplayer: running out of health marks the play failed, and it carries on', await bob.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; return s.mpFailed && !s.failed && s.running && s.engine.health.value <= 0; }));
// after the song: lazer's multiplayer results — everyone's score panel, winner first — then back to the room
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'results' && AshtonkMania.Multiplayer.lastResults && document.querySelectorAll('.cp').length === 1 && document.querySelector('.res-grid .rs-top') && !document.querySelector('.mpr-verdict.wait'), null, { timeout: 40000 })));
const mpr = await Promise.all([alice, bob].map(p => p.evaluate(() => ({ verdict: document.querySelector('.mpr-verdict').textContent, place: document.querySelector('.res-mp-myplace').textContent, before: [...document.querySelectorAll('.res-mp-side.before .cp-name')].map(e => e.firstChild.textContent), after: [...document.querySelectorAll('.res-mp-side.after .cp-name')].map(e => e.firstChild.textContent) }))));
await alice.waitForTimeout(1200); await shot(alice, 'mp-results-screen'); await shot(bob, 'mp-results-screen-bob');
check('after the song, the results screen with your panel and the other player\'s, winner first', mpr[0].verdict === 'You win!' && mpr[1].verdict === 'You lose' && mpr[0].place === '#1' && mpr[1].place === '#2' && mpr[0].after.join() === 'Bob' && !mpr[0].before.length && mpr[1].before.join() === 'Alice' && !mpr[1].after.length, JSON.stringify(mpr));
await Promise.all([alice, bob].map(p => p.evaluate(() => AshtonkMania.Screens.go('multiplayer', {}, { replace: true }))));
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.lastResults, null, { timeout: 10000 })));
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
await alice.click('.mp-ready'); await alice.waitForFunction(() => AshtonkMania.Multiplayer.self().ready, null, { timeout: 5000 }); await bob.click('.mp-ready');
await alice.waitForFunction(() => (e => e && !e.disabled)(document.querySelector('.mp-start')), null, { timeout: 5000 });
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
check('the room side panel is just chat', await alice.evaluate(() => document.querySelectorAll('.mp-side .mp-tabpane').length === 1 && !document.querySelector('.mp-sr-box') && /Chat/.test(document.querySelector('.mp-side').textContent)));
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
  if (await p.$('.dialog .pd-btn.danger')) await p.click('.dialog .pd-btn.danger');
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
await alice.evaluate(() => AshtonkMania.Screens.go('multiplayer', { ranked: true, force: true }));
await alice.waitForFunction(() => /Ranked Play/.test(document.querySelector('#app').textContent) && /Create duel/.test((document.querySelector('.mp-create') || {}).textContent || ''), null, { timeout: 10000 });
check('the Ranked Play lounge: "Create duel", no rating shown', await alice.evaluate(() => !document.querySelector('.rq-rating') && !/Your \dK rating/.test(document.querySelector('#app').textContent)));
await alice.click('.mp-create');
await alice.waitForSelector('.dialog .mp-cr', { timeout: 5000 });
await alice.click('.dialog .actions .btn.primary');
await alice.waitForFunction(() => AshtonkMania.Multiplayer.isRP() && AshtonkMania.Multiplayer.room.rp.stage === 'waitjoin', null, { timeout: 15000 });
const duel = await alice.evaluate(() => AshtonkMania.Multiplayer.room.code);
check('the duel is unrated', await alice.evaluate(() => !AshtonkMania.Multiplayer.room.rp.rated));
await bob.waitForFunction(c => document.querySelector('.mp-roomlist') && AshtonkMania.MultiplayerScreen._roomRows && !AshtonkMania.MultiplayerScreen._roomRows.has(c), duel, { timeout: 15000 });
check('the duel isn\'t listed in the normal lounge', true);
const refused = await bob.evaluate(async c => { try { await AshtonkMania.MultiplayerScreen.joinHere(c); return 'joined'; } catch (e) { return e.message; } }, duel);
check('joining a duel\'s code from the normal lounge is refused', /Ranked Play/.test(refused) && !(await bob.evaluate(() => AshtonkMania.Multiplayer.inRoom())), refused);
await bob.evaluate(() => AshtonkMania.Screens.go('multiplayer', { ranked: true, force: true }));
await bob.waitForFunction(c => AshtonkMania.MultiplayerScreen._roomRows && AshtonkMania.MultiplayerScreen._roomRows.has(c), duel, { timeout: 15000 });
check('…but it is in the Ranked Play lounge', true);
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
await alice.waitForFunction(() => document.querySelector('.rki.landed'), null, { timeout: 15000 });
check('…then the star rating is decided', await alice.evaluate(() => /Star rating has been decided/.test(document.querySelector('.rki').textContent) && /~\d+\.\d\d/.test(document.querySelector('.rki-stars').textContent)));
await shot(alice, 'mp-rp-stars');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Multiplayer.room.rp.stage === 'discard' && document.querySelectorAll('.rkd-slot').length === 5, null, { timeout: 30000 })));
const vis = await alice.evaluate(() => { const g = AshtonkMania.Multiplayer.room.rp, me = AshtonkMania.Multiplayer.me, o = Object.keys(g.users).find(id => id !== me); return { mine: g.users[me].hand.every(i => g.cards[i]), theirs: g.users[o].hand.some(i => g.cards[i]), n: [g.users[me].hand.length, g.users[o].hand.length] }; });
check('discard phase: five cards each, and only your own are shown to you', vis.mine && !vis.theirs && vis.n.join() === '5,5', JSON.stringify(vis));
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
await activePage.waitForTimeout(1200);
await activePage.hover('.rkm-myhand .rkh-slot:nth-child(3)');
await otherPage.waitForFunction(() => document.querySelector('.rkm-opphand .rkh-slot.hover'), null, { timeout: 5000 });
check('hand replay: the other player sees the card being looked at', true);
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
await alice.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; s.feed = generateAutoInputs(s.engine.notes, s.keys).flat(); s.feedIdx = 0; });
// Bob plays two notes in three: he loses the round
await bob.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; s.feed = generateAutoInputs(s.engine.notes.filter((n, i) => i % 3), s.keys).flat(); s.feedIdx = 0; });
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.room.rp.stage === 'results', null, { timeout: 45000 })));
const r1 = await bob.evaluate(() => { const r = AshtonkMania.Multiplayer.room, g = r.rp, id = n => r.players.find(p => p.name === n).id, a = id('Alice'), b = id('Bob'); return { a: g.users[a].life, b: g.users[b].life, sa: g.results.scores[a], sb: g.results.scores[b], d: g.results.dmg[b] }; });
check('round 1: the lower score takes ⌈difference × (0.5 + 0.5)⌉ + 50,000 damage', r1.a === 1000000 && r1.b === 1000000 - (Math.ceil((r1.sa - r1.sb) * 1) + 50000) && r1.d.bonusDamage === 50000, JSON.stringify(r1));
await bob.waitForFunction(() => document.querySelector('.rkr-col.hit'), null, { timeout: 12000 });
check('results: both scores side by side, then the damage lands on the loser', await bob.evaluate(() => document.querySelectorAll('.rkr-col').length === 2 && /Damage/.test(document.querySelector('.rkr-break').textContent)));
await shot(bob, 'mp-rp-results');
// round 2: the other player's turn (turns alternate); they leave the song part-way and score 0
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Multiplayer.room.rp.stage === 'pick' && AshtonkMania.Multiplayer.room.rp.round === 2, null, { timeout: 25000 })));
check('round 2 is the other player\'s turn; the round multiplier is now ×1', await alice.evaluate(n => { const r = AshtonkMania.Multiplayer.room; return r.players.find(p => p.id === r.rp.active).name !== n && r.rp.mult === 1; }, active));
await otherPage.waitForTimeout(1500);
await otherPage.click('.rkm-myhand .rkh-slot:nth-child(1)');
await otherPage.click('.rkm-myhand .rkh-slot.sel .rkh-play');
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.mp && AshtonkMania.Music.playing, null, { timeout: 45000 })));
await alice.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; s.feed = generateAutoInputs(s.engine.notes, s.keys).flat(); s.feedIdx = 0; });
const lifeBefore = await alice.evaluate(() => { const r = AshtonkMania.Multiplayer.room; return r.rp.users[r.players.find(p => p.name === 'Bob').id].life; });
await bob.keyboard.press('Escape');
await bob.waitForSelector('.dialog', { timeout: 5000 });
check('leaving the song in Ranked Play warns that it scores 0 for the round', await bob.evaluate(() => /score 0/.test(document.querySelector('.dialog').textContent)));
await bob.keyboard.press('Enter');
await bob.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.room.rp.stage === 'playing', null, { timeout: 10000 });
check('…you wait in the match while your opponent plays on', await bob.evaluate(() => /Gameplay is in progress/.test(document.querySelector('.rkm-stage').textContent)));
await Promise.all([alice, bob].map(p => p.waitForFunction(() => AshtonkMania.Screens.currentName === 'multiplayer' && AshtonkMania.Multiplayer.room.rp.stage === 'results' && AshtonkMania.Multiplayer.room.rp.round === 2, null, { timeout: 45000 })));
const r2 = await alice.evaluate(() => { const r = AshtonkMania.Multiplayer.room, b = r.players.find(p => p.name === 'Bob').id; return { score: r.rp.results.scores[b], life: r.rp.users[b].life }; });
check('…and take the damage for a score of 0', r2.score === 0 && r2.life < lifeBefore, JSON.stringify({ ...r2, lifeBefore }));
// Bob leaves the match: he loses it (nothing rated)
await bob.evaluate(() => AshtonkMania.Multiplayer.leave());
await alice.waitForFunction(() => AshtonkMania.Multiplayer.room && AshtonkMania.Multiplayer.room.rp.stage === 'ended', null, { timeout: 30000 });
await alice.waitForSelector('.rke-title', { timeout: 5000 });
const end = await alice.evaluate(() => ({ title: document.querySelector('.rke-title').textContent, rating: !!document.querySelector('.rke-rating'), sub: (document.querySelector('.rke-sub') || {}).textContent, again: document.querySelector('.rke-btn.again').textContent }));
check('the opponent leaving ends the match: VICTORY, with no rating change', end.title === 'VICTORY' && !end.rating && /4K duel · 2 rounds played/.test(end.sub) && end.again === 'New duel', JSON.stringify(end));
await alice.waitForTimeout(1600); await shot(alice, 'mp-rp-ended');
check('the match screen shows no stray "null" / "undefined" / "NaN" text', await alice.evaluate(() => !/\b(null|undefined|NaN)\b/.test(document.querySelector('.rkm').innerText)));
await alice.click('.rke-btn.quit');
await alice.waitForFunction(() => !AshtonkMania.Multiplayer.inRoom() && /Create duel/.test((document.querySelector('.mp-create') || {}).textContent || ''), null, { timeout: 10000 });
check('back in the Ranked Play lounge', true);

// the dashboard: Alice's friends (Bob among them), then she spectates his play live from his panel's ⋯ menu
await alice.evaluate(() => AshtonkMania.Screens.go('home')); await bob.evaluate(() => AshtonkMania.Screens.go('home'));
await alice.waitForTimeout(500);
await alice.click('#toolbar [data-tab="dashboard"]');
await alice.evaluate(() => [...document.querySelectorAll('.dash-tabs .ov-tab')].find(b => /^friends$/.test(b.textContent)).click());
await alice.waitForSelector('.dash-list .up[data-name="Bob"]', { timeout: 8000 });
const fr = await alice.evaluate(() => ({ n: JSON.parse(localStorage.getItem('am.friends') || '[]').length, stream: [...document.querySelectorAll('.dash-si')].map(b => b.textContent).join('|') }));
check('dashboard → friends: lazer\'s All / Online / Offline counts and the friend panels (kept for when they\'re offline)', fr.n === 1 && /All1/.test(fr.stream) && /Online1/.test(fr.stream) && /Offline0/.test(fr.stream), JSON.stringify(fr));
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
const sp = await alice.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; return { feed: s.feed.length, judged: s.engine.score.judged, t: AshtonkMania.Music.time, pill: !!document.querySelector('.spec-pill'), synced: !!s.spectate.synced, bar: !!document.querySelector('.rp-bar, .replay-bar') }; });
const bobT = await bob.evaluate(() => AshtonkMania.Music.time);
clearInterval(mash);
check('spectating: Alice watches Bob\'s play live, a little behind him, from what he presses', sp.feed > 30 && sp.judged > 5 && sp.synced && sp.pill && sp.t < bobT && bobT - sp.t < 6000, JSON.stringify({ ...sp, bobT }));
const st = await bob.evaluate(() => (AshtonkMania.Presence.players.find(p => p.name === 'Alice') || {}).status);
check('…and shows as spectating on the online list', st === 'watching', st);
const seen = await bob.evaluate(() => [...document.querySelectorAll('.spec-list')].map(e => e.textContent).join());
check('Bob sees who\'s spectating him on his HUD', /Spectators \(1\)/.test(seen) && /Alice/.test(seen), seen);
// Alice's window losing focus doesn't pause what she's watching
await alice.evaluate(() => window.dispatchEvent(new Event('blur'))); await alice.waitForTimeout(300);
check('spectating: switching away doesn\'t bring up the pause menu', await alice.evaluate(() => !document.querySelector('.pause-menu') && AshtonkMania.GameplayScreen.s.running));
// Bob pauses: once Alice's playback reaches that moment she sees the pause screen; it goes when he continues
await bob.keyboard.press('Escape');
await bob.waitForSelector('.pause-menu', { timeout: 3000 });
const sawPause = await alice.waitForSelector('.spec-pause', { timeout: 8000 }).then(() => true, () => false);
const pausedT = await alice.evaluate(() => AshtonkMania.Music.time);
await alice.waitForTimeout(600);
const held = await alice.evaluate(t => Math.abs(AshtonkMania.Music.time - t) < 50 && !AshtonkMania.GameplayScreen.s.running, pausedT);
await bob.click('.pause-menu .pm-btn.primary');
const resumed = await alice.waitForFunction(() => !document.querySelector('.spec-pause') && AshtonkMania.GameplayScreen.s.running, null, { timeout: 6000 }).then(() => true, () => false);
check('spectating: the player pausing shows the watcher the pause screen, held there, and it carries on when they continue', sawPause && held && resumed, JSON.stringify({ sawPause, held, resumed }));
await alice.keyboard.press('Escape');
await alice.waitForFunction(() => AshtonkMania.Screens.currentName !== 'gameplay' && !document.querySelector('.spec-pill'), null, { timeout: 8000 });
await bob.waitForFunction(() => AshtonkMania.Spectate.host.watchers === 0, null, { timeout: 5000 }).catch(() => {});
check('Esc stops spectating; Bob stops streaming', await bob.evaluate(() => AshtonkMania.Spectate.host.watchers === 0));
await bob.evaluate(() => AshtonkMania.Screens.go('home'));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
await mf.dispose();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
