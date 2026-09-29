// Screenshot tour for visual review: node tests/shots.mjs [--zoom=1.5]
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = process.env.SHOT_DIR || join(root, 'tests', 'shots');
mkdirSync(shotDir, { recursive: true });
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = p === '/' ? join(root, 'index.html') : join(root, p);
  let data;
  try { data = readFileSync(file); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html' }[extname(file)] || 'application/octet-stream' }); res.end(data);
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
page.on('pageerror', e => console.log('pageerror:', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
const shot = async n => { if (!only.length || only.includes(n)) await page.screenshot({ path: join(shotDir, n + '.png') }); };
await page.goto(url);
await page.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
await page.waitForTimeout(400);
if (await page.$('.onboarding')) { await shot('onboarding'); await page.fill('.onboarding .ob-name', 'Tester'); await page.keyboard.press('Enter'); await page.waitForTimeout(400); }
await page.evaluate(async () => {
  const b = await (await fetch('/tests/fixtures/test-set.osz')).blob();
  await AshtonkMania.App.importFiles([new File([b], 'test-set.osz')]);
});
await page.waitForTimeout(1200);
await page.evaluate(() => AshtonkMania.Screens.go('home'));
await page.waitForTimeout(1200);
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(900);
await shot('home-initial');
await page.mouse.click(800, 450); await page.waitForTimeout(900);
await shot('home-top');
await page.keyboard.press('p'); await page.waitForTimeout(900);
await shot('home-play');
await page.evaluate(() => AshtonkMania.Screens.go('songselect')); await page.waitForTimeout(900);
await page.hover('.tb-music'); await page.waitForTimeout(700);
await shot('nowplaying');
await page.mouse.move(800, 800); await page.waitForTimeout(500);
await page.click('.tb-profile'); await page.waitForTimeout(400);
await shot('usermenu');
await page.keyboard.press('Escape');
for (const s of ['songselect', 'explore', 'profile', 'stats', 'beatmaps', 'replays', 'collections', 'skins', 'multiplayer']) {
  const ok = await page.evaluate(n => { if (!AshtonkMania.Screens.registry[n]) return false; AshtonkMania.Screens.go(n); return true; }, s);
  if (!ok) continue;
  await page.waitForTimeout(1200); await shot(s);
}
await page.evaluate(() => AshtonkMania.SettingsPanel.open()); await page.waitForTimeout(600); await shot('settings');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.evaluate(() => AshtonkMania.Screens.go('songselect', { practice: false, force: true })); await page.waitForTimeout(900);
await page.evaluate(() => AshtonkMania.ModSelect.open()); await page.waitForTimeout(600); await shot('mods');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.evaluate(() => AshtonkMania.Settings.set('songselect.mods', ['AT']));
await page.keyboard.press('Enter'); await page.waitForTimeout(5000); await shot('gameplay');
await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'results', null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500); await shot('results');
await browser.close(); server.close();
