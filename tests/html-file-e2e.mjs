// The game saved as one HTML file (Settings → Maintenance → Save as an HTML file), opened from the device (file://):
// its bundled files come from inside it and its online features reach the game server (worker/index.js in workerd
// through Miniflare) across origins. Usage: MINIFLARE_DIR=<dir with node_modules/miniflare> node tests/html-file-e2e.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ttf': 'font/ttf' };
const mf = new Miniflare({
  modules: true, scriptPath: join(root, 'worker/index.js'), modulesRoot: root, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2026-08-01', cf: false, port: 0, host: '127.0.0.1',
  durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker', VAULT: 'PlayerVault' },
  serviceBindings: {
    // the static files as Cloudflare serves public/ (with public/_headers' CORS line)
    ASSETS: async req => {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const file = p === '/' ? 'index.html' : p.slice(1);
      for (const f of [join(root, 'public', file), join(root, file)]) {
        try { return new Response(readFileSync(f), { headers: { 'content-type': types[extname(f)] || 'application/octet-stream', 'access-control-allow-origin': '*' } }); } catch { /* next */ }
      }
      return new Response('not found', { status: 404 });
    },
  },
});
const url = String(await mf.ready).replace(/\/$/, '');

/** The setup's first page: "No, I'm new", then the name. */
async function setupName(pg, name) {
  if (await pg.$('.setup-choice[data-id="new"]')) await pg.click('.setup-choice[data-id="new"]');
  await pg.fill('.onboarding .ob-name', name); await pg.keyboard.press('Enter');
}
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? '  — ' + extra : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];

async function open(ctx, where, name) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  await page.goto(where);
  await page.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 60000 });
  await page.waitForTimeout(300);
  if (await page.$('.onboarding')) { await setupName(page, name); await page.waitForSelector('.setup-step-wom'); await page.evaluate(() => AshtonkMania.Onboarding.finish()); await page.waitForTimeout(300); }
  await page.evaluate(() => AshtonkMania.Settings.set('medals.unlocked', Object.fromEntries(AshtonkMania.Medals.all.map(m => [m.id, 1]))));
  return page;
}

try {
  // 1) on the website: save the file (the same code as the button)
  const site = await open(await browser.newContext({ viewport: { width: 1400, height: 800 } }), url, 'Site');
  const btn = await site.evaluate(async () => {
    AshtonkMania.SettingsPanel.open(); await new Promise(r => setTimeout(r, 400));
    AshtonkMania.SettingsPanel.build('data'); await new Promise(r => setTimeout(r, 200));
    const b = [...document.querySelectorAll('button')].find(x => /Save as an HTML file/.test(x.textContent));
    AshtonkMania.SettingsPanel.close();
    return !!b;
  });
  check('Settings → Maintenance has "Save as an HTML file"', btn);
  const [download] = await Promise.all([site.waitForEvent('download', { timeout: 60000 }), site.evaluate(() => AshtonkMania.HtmlFile.save())]);
  const dir = mkdtempSync(join(tmpdir(), 'am-html-'));
  const file = join(dir, download.suggestedFilename());
  await download.saveAs(file);
  const html = readFileSync(file, 'utf8');
  check('the file is named Ashtonk!mania.html', download.suggestedFilename() === 'Ashtonk!mania.html', download.suggestedFilename());
  check('the bundled files are inside it (skins, cursor, avatars, Neru)', /window\.AM_ASSETS=/.test(html) && html.length > 6e6, `${(html.length / 1e6).toFixed(1)} MB`);
  check('it knows the website it came from', html.includes(`window.AM_SERVER=${JSON.stringify(url + '/')}`));
  const outside = html.replace(/<script>\n"use strict"[\s\S]*<\/script>/, ''); // (the page, not the game's own source)
  check('the CSS and icons point inside the file (no relative paths left)', outside.length > 1e5 && !/url\(lazer\/|href="icons\/|rel="manifest"/.test(outside));

  // Ctrl+S saves it the same way (instead of the browser's "Save page", which leaves the bundled files behind)
  await site.waitForTimeout(500);
  const viaKey = await Promise.all([site.waitForEvent('download', { timeout: 60000 }), site.keyboard.press('Control+s')]).then(([d]) => d.suggestedFilename()).catch(e => 'ERR ' + e.message);
  check('Ctrl+S saves the game as the HTML file', viaKey === 'Ashtonk!mania.html', viaKey);

  // 2) opened from the device
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const failed = [];
  ctx.on('requestfailed', r => failed.push(r.url().slice(0, 120) + ' ' + (r.failure() || {}).errorText));
  const fp = await open(ctx, pathToFileURL(file).href, 'FileCopy');
  const st = await fp.evaluate(() => ({ standalone: AshtonkMania.Host.standalone, server: AshtonkMania.Host.server(), proto: location.protocol }));
  check('opened from the device, it runs as the saved copy and talks to the website', st.proto === 'file:' && st.standalone && st.server === url + '/', JSON.stringify(st));
  const skins = await fp.evaluate(() => ({ current: AshtonkMania.SkinManager.current.name, all: AshtonkMania.SkinManager.skins.map(s => s.name) }));
  check('Kori is installed and selected from inside the file', /kori/i.test(skins.current), JSON.stringify(skins));
  const looks = await fp.evaluate(() => ({ cursor: (document.querySelector('.lzc-img') || {}).src || '', avatar: AshtonkMania.AvatarPresets.url('miku') || '', neru: (document.querySelector('.neru-img') || {}).src || '' }));
  check('the cursor, avatars and Neru come from inside the file', [looks.cursor, looks.avatar, looks.neru].every(s => s.startsWith('data:image/')), JSON.stringify(Object.fromEntries(Object.entries(looks).map(([k, v]) => [k, v.slice(0, 30)]))));
  const fileFails = failed.filter(f => f.startsWith('file:'));
  check('nothing is looked for next to the file', !fileFails.length, fileFails.join(' | '));

  // online features across origins (the page's origin is "null"): health check, presence, a multiplayer room
  check('beatmap search reaches the server', await fp.evaluate(() => AshtonkMania.OnlineBeatmaps.checkApi()));
  await fp.waitForFunction(() => AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1, null, { timeout: 15000 }).catch(() => {});
  check('it shows as online (presence WebSocket)', await fp.evaluate(() => !!(AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1)));
  await fp.evaluate(() => AshtonkMania.Screens.go('multiplayer'));
  const code = await fp.evaluate(async () => { await AshtonkMania.Multiplayer.create({ isPublic: false }); return AshtonkMania.Multiplayer.code; }).catch(e => 'ERR ' + e.message);
  check('it opens a multiplayer room (a JSON POST across origins, then the room\'s WebSocket)', /^[A-Z0-9]{4,8}$/.test(code), code);
  const link = await fp.evaluate(() => AshtonkMania.Multiplayer.inviteLink());
  check('its invite links point at the website, not the file', link.startsWith(url + '/?join='), link);
  await site.evaluate(c => AshtonkMania.Screens.go('multiplayer').then(() => AshtonkMania.Multiplayer.join(c)), code);
  await fp.waitForFunction(() => AshtonkMania.Multiplayer.room && AshtonkMania.Multiplayer.room.players.length === 2, null, { timeout: 15000 }).catch(() => {});
  check('a player on the website joins the file copy\'s room', await fp.evaluate(() => !!(AshtonkMania.Multiplayer.room && AshtonkMania.Multiplayer.room.players.length === 2)));
  await fp.evaluate(() => AshtonkMania.Multiplayer.leave()); await site.evaluate(() => AshtonkMania.Multiplayer.leave());

  // playing from the file: import a beatmap and start it
  await fp.evaluate(async u => { const b = await (await fetch(u + '/tests/fixtures/test-set.osz')).blob(); await AshtonkMania.App.importFiles([new File([b], 'test-set.osz')]); }, url);
  await fp.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length === 1, null, { timeout: 15000 });
  await fp.evaluate(() => AshtonkMania.Screens.go('gameplay', { mapId: AshtonkMania.BeatmapManager.sets[0].maps[0].id }));
  await fp.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.started, null, { timeout: 20000 }).catch(() => {});
  await fp.waitForTimeout(1500);
  const g = await fp.evaluate(() => ({ screen: AshtonkMania.Screens.currentName, t: AshtonkMania.GameplayScreen.s ? AshtonkMania.GameplayScreen.s.time || AshtonkMania.Game.time && AshtonkMania.Game.time() : null }));
  check('a beatmap plays from the file', g.screen === 'gameplay', JSON.stringify(g));

  // the saved copy fetches the newest version from the website (the files across origins)
  const fresh = await fp.evaluate(async () => (await AshtonkMania.HtmlFile.build()).size);
  check('"Get the newest version" works from the file', fresh > 6e6, `${(fresh / 1e6).toFixed(1)} MB`);
} catch (e) { check('ran to the end', false, e.stack); }

check('no page errors', !errors.length, errors.join(' | '));
await browser.close(); await mf.dispose();
const bad = results.filter(r => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
