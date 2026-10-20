// Everything of yours on every device: a change on one (name, picture, settings, beatmap offsets) is on your other
// devices in seconds; a device without your beatmaps can pick which to install; signing out, or switching to another
// player's code, takes the last player's plays off the device. Usage: MINIFLARE_DIR=<dir> node tests/sync-e2e.mjs
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
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };
const mf = new Miniflare({
  modules: true, scriptPath: join(root, 'worker/index.js'), modulesRoot: root, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2026-08-01', cf: false, port: 0, host: '127.0.0.1',
  durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker', VAULT: 'PlayerVault' },
  bindings: { TEST_ALL_RANKED: '1' },
  serviceBindings: {
    ASSETS: async req => {
      const p = decodeURIComponent(new URL(req.url).pathname);
      for (const f of [p === '/' ? join(root, 'index.html') : join(root, p), join(root, 'public', p)]) try { return new Response(readFileSync(f), { headers: { 'content-type': types[extname(f)] || 'application/octet-stream' } }); } catch { /* next */ }
      return new Response('not found', { status: 404 });
    },
  },
});
const url = String(await mf.ready);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? '  — ' + extra : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];

/** A device: its own browser, set up as a new player `name` (a code made at setup); with the test beatmaps if `maps`. */
async function device(name, maps = true) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('am.noInstallPrompt', '1'); } catch {} });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  if (await page.$('.onboarding')) {
    if (await page.$('.setup-choice[data-id="new"]')) await page.click('.setup-choice[data-id="new"]');
    await page.fill('.onboarding .ob-name', name); await page.keyboard.press('Enter');
    await page.waitForSelector('.setup-step-wom'); await page.evaluate(() => AshtonkMania.Onboarding.finish()); await page.waitForTimeout(300);
  }
  if (maps) {
    await page.evaluate(async () => { const b = await (await fetch('/tests/fixtures/test-set.osz')).blob(); await AshtonkMania.App.importFiles([new File([b], 'test-set.osz')]); });
    await page.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length === 1, null, { timeout: 15000 });
  }
  await page.waitForFunction(() => AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1 && AshtonkMania.Presence.me, null, { timeout: 15000 });
  return page;
}
/** A play kept on the device, as the game keeps one. */
const keepScore = (page, id) => page.evaluate(async id => {
  const A = AshtonkMania, m = [...A.BeatmapManager.maps.values()][0] || {};
  await A.ScoreManager.add({ id, mapHash: m.hash || 'h'.repeat(64), mapId: m.id, setId: m.setId, title: m.title || 'Song', artist: m.artist || 'Artist', version: m.version || 'V', creator: m.creator || 'C',
    keys: m.keys || 4, stars: 2.5, pp: 12, mods: [], rate: 1, score: 900000, scoreStd: 950000, accuracy: 0.97, maxCombo: 300, counts: [200, 50, 10, 0, 0, 2], grade: 'A', passed: true,
    date: Date.now(), duration: 60000, player: A.ProfileManager.profile.name, own: true, replayId: null, srVersion: SR_VERSION, hitErrors: [], healthTimeline: [] });
}, id);
const push = page => page.evaluate(async () => { const S = Sync; while (S._pushing) await new Promise(r => setTimeout(r, 50)); await S.push(); });

try {
  // ── Kai, on device A: a beatmap set from osu! (so it can be downloaded again elsewhere), a play, and his code
  const a = await device('Kai');
  await a.evaluate(() => { const s = AshtonkMania.BeatmapManager.sets[0]; s.onlineId = 424242; AshtonkMania.Bus.emit('library:changed'); });
  await keepScore(a, 'sc-kai-one');
  await a.waitForFunction(() => !!AshtonkMania.Account.code() && AshtonkMania.Account.linked(), null, { timeout: 15000 });
  const code = await a.evaluate(() => AshtonkMania.Account.code());
  await push(a);

  // ── device B: no beatmaps; Kai types his code there
  const b = await device('Temp', false);
  await b.evaluate(async c => { await AshtonkMania.Account.link(c); await Sync.restore(); }, code);
  await b.waitForTimeout(800);
  const bState = await b.evaluate(() => ({ name: AshtonkMania.ProfileManager.profile.name, plays: AshtonkMania.ScoreManager.scores.map(s => s.id), mine: AccountBeatmaps.list().map(s => s.id) }));
  check('typing your code: your name and plays come, and the beatmaps you have elsewhere are listed', bState.name === 'Kai' && bState.plays.includes('sc-kai-one') && bState.mine.includes(424242), JSON.stringify(bState));
  await b.evaluate(() => AshtonkMania.Screens.go('beatmaps')); await b.waitForTimeout(700);
  const empty = await b.evaluate(() => { const btn = [...document.querySelectorAll('.off-state button')].find(x => /Show your beatmaps/.test(x.textContent)); return { btn: !!btn, head: !document.querySelector('.lib-mine').hidden && /Your beatmaps/.test(document.querySelector('.lib-mine').textContent) }; });
  check('an empty library on a device signed in to you: a button shows the beatmaps you had installed', empty.btn && empty.head, JSON.stringify(empty));
  await b.evaluate(() => [...document.querySelectorAll('.off-state button')].find(x => /Show your beatmaps/.test(x.textContent)).click());
  await b.waitForSelector('.ab-card');
  await b.evaluate(() => { window.__got = null; Sync.getSets = async sets => { window.__got = sets.map(s => s.id); }; });
  const before = await b.evaluate(() => ({ go: document.querySelector('.ab-go').disabled, text: document.querySelector('.ab-go').textContent }));
  await b.click('.ab-card[data-id="424242"]');
  const after = await b.evaluate(() => ({ on: document.querySelector('.ab-card[data-id="424242"]').classList.contains('on'), text: document.querySelector('.ab-go').textContent }));
  await b.click('.ab-go');
  const got = await b.evaluate(() => window.__got);
  check('…pick the ones you want and install them', before.go && after.on && /Install 1/.test(after.text) && JSON.stringify(got) === '[424242]', JSON.stringify({ before, after, got }));

  // ── a change on A is on B in seconds (the server tells B): name, picture, a setting, a beatmap offset
  const hash = await a.evaluate(() => [...AshtonkMania.BeatmapManager.maps.values()][0].hash);
  await a.evaluate(async h => {
    const A = AshtonkMania;
    await A.ProfileManager.setName('Kai Two'); await A.ProfileManager.setAvatar('preset:miku');
    A.Settings.set('gameplay.scrollSpeed', 27); await A.MapOffsets.set(h, 15);
  }, hash);
  await push(a);
  await b.waitForFunction(h => { const A = AshtonkMania; return A.ProfileManager.profile.name === 'Kai Two' && A.ProfileManager.profile.avatar === 'preset:miku' && A.Settings.get('gameplay.scrollSpeed') === 27 && A.MapOffsets.get(h) === 15; }, hash, { timeout: 20000 }).catch(() => {});
  const live = await b.evaluate(h => { const A = AshtonkMania; return { name: A.ProfileManager.profile.name, avatar: A.ProfileManager.profile.avatar, speed: A.Settings.get('gameplay.scrollSpeed'), offset: A.MapOffsets.get(h) }; }, hash);
  check('a change on one device is on your others in seconds: name, picture, settings, beatmap offsets', live.name === 'Kai Two' && live.avatar === 'preset:miku' && live.speed === 27 && live.offset === 15, JSON.stringify(live));
  // …and back the other way, with an uploaded picture
  await b.evaluate(async () => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#e05'; x.fillRect(0, 0, 64, 64); const blob = await new Promise(r => c.toBlob(r, 'image/png')); await AshtonkMania.ProfileManager.setAvatar('custom', blob); });
  await push(b);
  await a.waitForFunction(() => AshtonkMania.ProfileManager.profile.avatar === 'custom', null, { timeout: 20000 }).catch(() => {});
  check('…both ways, an uploaded picture too', await a.evaluate(() => AshtonkMania.ProfileManager.profile.avatar === 'custom' && !!AshtonkMania.ProfileManager.avatarURL));

  // ── signing out on B: Kai's plays and name are gone from it
  await b.evaluate(() => AshtonkMania.Account.logout());
  await b.waitForTimeout(800);
  const out = await b.evaluate(() => ({ plays: AshtonkMania.ScoreManager.scores.length, name: AshtonkMania.ProfileManager.profile.name, avatar: AshtonkMania.ProfileManager.profile.avatar, offsets: Object.keys(AshtonkMania.MapOffsets.map).length }));
  check('signing out takes your plays, name, picture and offsets off the device', out.plays === 0 && out.name === 'Player' && out.avatar === 'default' && out.offsets === 0, JSON.stringify(out));

  // ── Zed, on device C, with a play of his own, switches to Kai's code: Zed's play goes; Kai's come; Zed stays himself
  const c = await device('Zed');
  await keepScore(c, 'sc-zed-one');
  await c.waitForFunction(() => !!AshtonkMania.Account.code() && AshtonkMania.Account.linked(), null, { timeout: 15000 });
  const zedCode = await c.evaluate(() => AshtonkMania.Account.code()), zedPid = await c.evaluate(() => AshtonkMania.Presence.pid());
  await push(c);
  await c.evaluate(async k => { await AshtonkMania.Account.link(k); await Sync.restore(); }, code);
  await c.waitForTimeout(800);
  const sw = await c.evaluate(() => ({ plays: AshtonkMania.ScoreManager.scores.map(s => s.id), name: AshtonkMania.ProfileManager.profile.name }));
  check('switching to another player\'s code: the last player\'s plays go, the new one\'s come', !sw.plays.includes('sc-zed-one') && sw.plays.includes('sc-kai-one') && sw.name === 'Kai Two', JSON.stringify(sw));
  const zedBack = await c.evaluate(async z => { await AshtonkMania.Account.link(z); await Sync.restore(); return { pid: AshtonkMania.Presence.pid(), plays: AshtonkMania.ScoreManager.scores.map(s => s.id), name: AshtonkMania.ProfileManager.profile.name }; }, zedCode);
  check('…and the other player is still there, code and plays (never merged into the new one)', zedBack.pid === zedPid && zedBack.plays.includes('sc-zed-one') && !zedBack.plays.includes('sc-kai-one') && zedBack.name === 'Zed', JSON.stringify(zedBack));
} catch (e) { check('ran to the end', false, e.stack); }

check('no page errors', !errors.length, errors.join(' | '));
await browser.close(); await mf.dispose();
const bad = results.filter(r => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
