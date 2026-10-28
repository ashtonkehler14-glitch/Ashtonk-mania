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
  if (await page.$('.onboarding')) { await setupName(page, name); await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => AshtonkMania.Onboarding.finish()); await page.waitForTimeout(300); }
  await page.evaluate(async () => {
    const M = AshtonkMania.Medals;
    AshtonkMania.Settings.set('medals.unlocked', Object.fromEntries(M.all.map(m => [m.id, 1])));
    M.queue.length = 0; // (one already on its way — Night Owl, after midnight — put away too)
    for (let i = 0; i < 40 && document.querySelector('.medal-ov'); i++) { document.querySelector('.medal-ov').click(); await new Promise(r => setTimeout(r, 100)); }
  });
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

  // out of date: the file asks (once the song is over) and writes the new version over itself
  await fp.evaluate(() => AshtonkMania.Screens.go('songselect')); await fp.waitForTimeout(800);
  const canWrite = await fp.evaluate(() => typeof window.showSaveFilePicker === 'function');
  check('a saved file can write itself (the browser offers File System Access to file:// pages)', canWrite);
  const same = await fp.evaluate(async () => { await AshtonkMania.HtmlFile.check(); return !document.querySelector('.dialog'); });
  check('a file of the website\'s current version doesn\'t ask to update', same);
  const kept = await fp.evaluate(async () => {
    const F = AshtonkMania.HtmlFile, build = F.build, pick = window.showSaveFilePicker;
    let picked = false;
    F.build = async () => { throw new Error('The download stopped part-way.'); };
    window.showSaveFilePicker = async () => { picked = true; throw new DOMException('no', 'AbortError'); };
    try { await F.update(); } finally { F.build = build; window.showSaveFilePicker = pick; }
    return !picked && !document.querySelector('.dialog');
  });
  check('an update that can\'t get the new version never touches the file', kept);
  // the website with nothing newer than the file (a copy of the old page kept on the way): nothing is written — written
  // and restarted, the file was the same version again and asked to update again, over and over
  const noNew = await fp.evaluate(async () => {
    const F = AshtonkMania.HtmlFile, pick = window.showSaveFilePicker; let picked = false;
    window.showSaveFilePicker = async () => { picked = true; throw new DOMException('no', 'AbortError'); };
    try { await F.update(); } finally { window.showSaveFilePicker = pick; }
    await new Promise(r => setTimeout(r, 300));
    return { picked, dialog: !!document.querySelector('.dialog'), toasts: [...document.querySelectorAll('#toasts .t-title')].map(e => e.textContent).join('|') };
  });
  check('an update with nothing newer on the website writes nothing (no restart into the same version)', !noNew.picked && !noNew.dialog && /No newer version/.test(noNew.toasts), JSON.stringify(noNew));
  // (from here on the website has a newer version: what it sends is stamped as another build)
  await fp.evaluate(() => {
    const F = AshtonkMania.HtmlFile, build = F.build;
    F.build = async (...a) => { const b = await build.apply(F, a); return new Blob([(await b.text()).replace(/const APP_BUILD = '[0-9a-f]+'/, "const APP_BUILD = 'feedfacecafe'")], { type: 'text/html' }); };
  });
  // the file it was written to last time being another copy with this name (in Downloads, say): not written to — the
  // save box is asked for, saying where this file is
  const other = await fp.evaluate(async () => {
    const F = AshtonkMania.HtmlFile, kv = AshtonkMania.DB.kvGet;
    let wrote = 0;
    const fake = { name: F.fileName(), queryPermission: async () => 'granted', requestPermission: async () => 'granted', getFile: async () => new File(['<script>window.AM_SAVED=1;</script>'], F.fileName()), createWritable: async () => ({ write: async () => { wrote++; }, close: async () => {} }) };
    AshtonkMania.DB.kvGet = async (k, d) => k === 'htmlFile.handle' ? fake : kv.call(AshtonkMania.DB, k, d);
    const done = F.update();
    for (let i = 0; i < 600 && !document.querySelector('.dialog'); i++) await new Promise(r => setTimeout(r, 100));
    const text = (document.querySelector('.dialog') || {}).textContent || '';
    const notNow = [...document.querySelectorAll('.dialog button')].find(b => b.textContent.trim() === 'Not now');
    if (notNow) notNow.click();
    await done; AshtonkMania.DB.kvGet = kv;
    for (let i = 0; i < 40 && document.querySelector('.dialog'); i++) await new Promise(r => setTimeout(r, 100)); // (faded away)
    return { wrote, text, where: F.where() };
  });
  check('the file remembered from last time, if it\'s another copy, isn\'t written over — the save box is asked for, saying where this file is', other.wrote === 0 && other.text.includes(other.where), JSON.stringify(other).slice(0, 300));
  await fp.evaluate(() => {
    AshtonkMania.HtmlFile.latest = async () => 'feedfacecafe';
    // (the browser's save box can't be clicked in a test: it hands back a file that records what's written)
    window.showSaveFilePicker = async o => { window.__picked = o.suggestedName; let file = new File([], 'x'); return { name: 'Ashtonk!mania (2).html', requestPermission: async () => 'granted', getFile: async () => file, createWritable: async () => { let b = null; return { write: async x => { b = x; }, close: async () => { file = b; window.__written = b.size; } }; } }; };
    return AshtonkMania.HtmlFile.check();
  });
  const asked = await fp.evaluate(() => (document.querySelector('.dialog h2') || {}).textContent || '');
  check('an out-of-date file asks whether to update', /new version of Ashtonk!mania/.test(asked), asked);
  await fp.evaluate(() => [...document.querySelectorAll('.dialog button')].find(b => b.textContent.trim() === 'Update').click());
  // (the new version is all fetched before the save box opens: that box empties the file you pick there and then, so a
  // version that never came used to leave a 0-byte file where the game was)
  const saveBtn = () => [...document.querySelectorAll('.dialog button')].find(b => b.textContent.trim() === 'Save');
  await fp.waitForFunction(`(${saveBtn})()`, null, { timeout: 60000 }).catch(() => {});
  check('the save box only opens once the new version is all here', await fp.evaluate(`!window.__picked && !!(${saveBtn})()`));
  await fp.evaluate(`(${saveBtn})().click()`);
  await fp.waitForFunction(() => window.__written > 0, null, { timeout: 60000 }).catch(() => {});
  const wrote = await fp.evaluate(() => ({ picked: window.__picked, size: window.__written || 0 }));
  check('"Update" writes the newest version to the file (the save box opens on this file\'s name)', wrote.picked === 'Ashtonk!mania.html' && wrote.size > 6e6, JSON.stringify(wrote));
  // a write that doesn't stick (the drive not having the new file all there, read back): written again, then — still
  // not there — nothing restarts (that opened a blank white page) and the new version downloads instead
  await fp.waitForFunction(() => !AshtonkMania.HtmlFile.busy, null, { timeout: 30000 }).catch(() => {});
  const lost = await fp.evaluate(async () => {
    const F = AshtonkMania.HtmlFile, kv = AshtonkMania.DB.kvGet, dl = window.downloadBlob, reload = F.WRITE_WAIT;
    let writes = 0, downloaded = null, unloaded = false;
    const onUnload = () => { unloaded = true; }; window.addEventListener('beforeunload', onUnload);
    const fake = { name: F.fileName(), queryPermission: async () => 'granted', requestPermission: async () => 'granted', getFile: async () => new File([`<script>window.AM_SAVED=${window.AM_SAVED};</script>`], F.fileName()), createWritable: async () => ({ write: async () => { writes++; }, close: async () => {} }) };
    AshtonkMania.DB.kvGet = async (k, d) => k === 'htmlFile.handle' ? fake : kv.call(AshtonkMania.DB, k, d);
    window.downloadBlob = (b, n) => { downloaded = `${n}|${b.size > 6e6}`; };
    F.WRITE_WAIT = 600;
    try { await F.update(); } finally { AshtonkMania.DB.kvGet = kv; window.downloadBlob = dl; F.WRITE_WAIT = reload; }
    await new Promise(r => setTimeout(r, 1500));
    window.removeEventListener('beforeunload', onUnload);
    return { writes, downloaded, unloaded, toasts: [...document.querySelectorAll('#toasts .t-title')].map(e => e.textContent).join('|') };
  });
  check('a write that doesn\'t stick is tried again, then nothing restarts and the new version downloads instead', lost.writes === 2 && lost.downloaded === 'Ashtonk!mania.html|true' && !lost.unloaded && /didn.t save properly/.test(lost.toasts), JSON.stringify(lost));
  // restarted after an update that went over another copy (still the old version here): it says so, and forgets that
  // file, instead of offering the update again and again; restarted as the new version, it says it's updated
  await fp.evaluate(() => localStorage.setItem('am.fileUpdated', JSON.stringify({ build: 'feedfacecafe', at: Date.now(), name: 'Ashtonk!mania.html' })));
  await fp.reload(); await fp.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 60000 });
  await fp.waitForFunction(() => /wasn.t updated/.test((document.querySelector('.dialog h2') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  const wrong = await fp.evaluate(async () => ({ dialog: (document.querySelector('.dialog') || {}).textContent || '', handle: await AshtonkMania.DB.kvGet('htmlFile.handle', 'none') }));
  check('restarted as the old version after an update, it says that file wasn\'t the one updated (and forgets it)', /wasn.t updated/.test(wrong.dialog) && wrong.handle === null, JSON.stringify(wrong).slice(0, 300));
  await fp.evaluate(() => { const b = [...document.querySelectorAll('.dialog button')].find(x => x.textContent.trim() === 'Not now'); if (b) b.click(); });
  await fp.evaluate(() => localStorage.setItem('am.fileUpdated', JSON.stringify({ build: APP_BUILD, at: Date.now(), name: 'Ashtonk!mania.html' })));
  await fp.reload(); await fp.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 60000 });
  await fp.waitForFunction(() => [...document.querySelectorAll('#toasts .t-title')].some(e => e.textContent === 'Updated'), null, { timeout: 15000 }).catch(() => {});
  const okNow = await fp.evaluate(() => ({ toast: [...document.querySelectorAll('#toasts .t-title')].some(e => e.textContent === 'Updated'), dialog: !!document.querySelector('.dialog') }));
  check('restarted as the new version, it says it\'s updated and asks nothing', okNow.toast && !okNow.dialog, JSON.stringify(okNow));
} catch (e) { check('ran to the end', false, e.stack); }

check('no page errors', !errors.length, errors.join(' | '));
await browser.close(); await mf.dispose();
const bad = results.filter(r => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
