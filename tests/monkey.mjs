// Monkey test: thousands of random clicks, keys, screen changes, plays and window resizes in headless Chromium;
// fails on any uncaught page error and prints the steps that led to it.
// Usage: node tests/monkey.mjs [steps=600] [seed=7]
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = p === '/' ? join(root, 'index.html') : join(root, p);
  try {
    let data; try { data = readFileSync(file); } catch { data = readFileSync(join(root, 'public', p)); }
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' }[extname(file)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' })).newPage();
let failures = 0;
const errs = [];
page.on('pageerror', e => errs.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' | ')));
page.on('dialog', d => d.dismiss().catch(() => {}));
await page.route('**/api/**', r => r.fulfill({ status: 503, body: '' }));
await page.route('https://**', r => r.abort());
await page.goto(url);
await page.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 60000 });
await page.waitForTimeout(400);
if (await page.$('.onboarding')) { await page.fill('.onboarding .ob-name', 'Monkey'); await page.keyboard.press('Enter'); await page.waitForSelector('.setup-step-wom'); await page.evaluate(() => AshtonkMania.Onboarding.finish()); await page.waitForTimeout(500); }
await page.evaluate(async () => { const b = await (await fetch('/tests/fixtures/test-set.osz')).blob(); await AshtonkMania.App.importFiles([new File([b], 'test-set.osz')]); });
await page.waitForTimeout(1200);
let seed = +(process.argv[3] || 7); const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const KEYS = ['Shift+Delete', 'Control+Enter', 'Alt+Enter', 'Escape', 'Enter', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F1', 'F2', 'F3', 'F4', 'Backspace', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyR', 'Shift+Tab', 'Control+o', 'Shift+Slash', 'PageDown', 'KeyP', 'KeyS', 'KeyB', 'KeyU', 'KeyH'];
const SCREENS = ['home', 'songselect', 'explore', 'profile', 'skins', 'replays', 'collections', 'beatmaps', 'multiplayer'];
const STEPS = +(process.argv[2] || 600);
const trail = [];
for (let i = 0; i < STEPS; i++) {
  const r = rnd();
  try {
    if (r < 0.5) {
      // click a random visible, enabled button / chip / row
      const n = await page.evaluate(() => { window.__btns = [...document.querySelectorAll('button, .chip, [role=button], .lb-row, .ex-card, .c-item')].filter(b => { const x = b.getBoundingClientRect(); return x.width > 2 && x.height > 2 && x.bottom > 0 && x.top < innerHeight && !b.disabled && !/Reset everything|Clear beatmaps|Delete|Clear scores|Clear replays|Import|Export|Save PNG|Copy image|Share…/i.test(b.textContent) && !b.closest('.danger') && !b.classList.contains('danger'); }); return window.__btns.length; });
      if (n) { const k = Math.floor(rnd() * n); const label = await page.evaluate(k => { const b = window.__btns[k]; const t = (b.textContent || b.title || b.className).trim().slice(0, 30); b.click(); return t; }, k); trail.push('click ' + label); }
    } else if (r < 0.8) {
      const key = KEYS[Math.floor(rnd() * KEYS.length)];
      if (key === 'KeyR' && rnd() < 0.5) { await page.keyboard.down('KeyR'); await page.waitForTimeout(600); await page.keyboard.up('KeyR'); } else await page.keyboard.press(key);
      trail.push('key ' + key);
    } else if (r < 0.9) {
      const s = SCREENS[Math.floor(rnd() * SCREENS.length)];
      await page.evaluate(s => AshtonkMania.Screens.go(s), s); trail.push('go ' + s);
    } else if (r < 0.95) {
      await page.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()]; if (!m.length) return; const x = m[Math.floor(Math.random() * m.length)]; AshtonkMania.Screens.go('gameplay', { mapId: x.id, mods: Math.random() < 0.5 ? ['AT'] : [], force: true }); }); trail.push('play');
    } else {
      const w = 900 + Math.floor(rnd() * 900), hh = 600 + Math.floor(rnd() * 400);
      await page.setViewportSize({ width: w, height: hh }); trail.push(`resize ${w}x${hh}`);
    }
  } catch (e) { trail.push('step error ' + e.message.slice(0, 80)); }
  await page.waitForTimeout(40 + Math.floor(rnd() * 160));
  if (errs.length) { failures++; console.log('✖ page error after:', trail.slice(-8).join(' → ')); console.log(errs.join('\n')); errs.length = 0; }
}
console.log(`${failures ? '✖' : '✔'} ${STEPS} random steps (seed ${process.argv[3] || 7}), ${failures} page error(s)`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
