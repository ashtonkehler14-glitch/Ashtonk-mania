// End-to-end test in headless Chromium: import, song select, gameplay (auto + live keys), results,
// skins, persistence across reload. Usage: node tests/e2e.mjs [--shots]
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv.includes('--shots');
const shotDir = process.env.SHOT_DIR || join(root, 'tests', 'shots');
if (SHOTS) mkdirSync(shotDir, { recursive: true });
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = p === '/' ? join(root, 'index.html') : join(root, p);
  try {
    const data = readFileSync(file);
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript' }[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? '  — ' + extra : ''}`); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const shot = async name => { if (SHOTS) await page.screenshot({ path: join(shotDir, name + '.png') }); };
const waitBoot = async () => {
  await page.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await page.waitForTimeout(400);
  if (await page.$('.onboarding')) { await page.fill('.onboarding .ob-name', 'Tester'); await page.keyboard.press('Enter'); await page.waitForTimeout(400); }
};

await page.goto(url);
await waitBoot();
check('boots to home screen', await page.evaluate(() => AshtonkMania.Screens.currentName === 'home'));
check('first launch asks for a name', await page.evaluate(() => AshtonkMania.ProfileManager.profile.name === 'Tester' && AshtonkMania.ProfileManager.profile.onboarded));
check('Kori 3.0 is preinstalled and selected', await page.evaluate(() => /Kori 3\.0/.test(AshtonkMania.SkinManager.current.name)), await page.evaluate(() => AshtonkMania.SkinManager.current.name));
check('branding is Ashtonk!mania', await page.evaluate(() => document.title === 'Ashtonk!mania' && document.querySelector('.lz-cookie-text').textContent.includes('ashtonk')));
check('osu!lazer toolbar: icon buttons only, no text tabs', await page.evaluate(() => !document.querySelector('#toolbar [data-tab="songselect"]') && !!document.querySelector('#toolbar .tb-music') && !!document.querySelector('#toolbar .tb-clock')));
check('touch controls and Neru easter eggs removed', await page.evaluate(() => !AshtonkMania.Settings.schema.has('input.touch') && !AshtonkMania.Settings.schema.has('gameplay.neruSparkle') && typeof window.LOADING_NERU === 'undefined'));
await page.mouse.click(700, 450); await page.waitForTimeout(500);
check('main menu opens the lazer button bar (no footer panels)', await page.evaluate(() => document.querySelector('.lz-menu').dataset.state === 'top' && document.querySelectorAll('.lz-btn').length === 4 && !document.querySelector('.continue, .lz-footer')));
await shot('01-home-empty');

// import via synthetic drop event (exercises the drag & drop pipeline)
const dropFiles = async (names) => page.evaluate(async (names) => {
  const dt = new DataTransfer();
  for (const n of names) { const b = await (await fetch('/tests/fixtures/' + n)).blob(); dt.items.add(new File([b], n)); }
  window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
}, names);
await dropFiles(['test-set.osz']);
await page.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length === 1, null, { timeout: 15000 });
const lib = await page.evaluate(() => { const s = AshtonkMania.BeatmapManager.sets[0]; return { n: s.maps.length, keys: s.maps.map(m => m.keys).sort(), broken: s.maps.filter(m => m.problems.length).map(m => m.version + ': ' + m.problems.join(';')), stars: s.maps.map(m => m.stars) }; });
check('.osz import: 5 difficulties grouped into one set', lib.n === 5, JSON.stringify(lib.keys));
check('broken difficulty explained, not crashing', lib.broken.length === 1 && /Missing audio/.test(lib.broken[0]), lib.broken[0]);
await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'songselect', null, { timeout: 5000 });
await page.waitForTimeout(800);
check('import navigates to song select with new map selected', await page.evaluate(() => !!AshtonkMania.SongSelect.selectedId));
await shot('02-songselect');

// corrupt / non-mania archives
await dropFiles(['corrupt.osz', 'standard.osz']);
await page.waitForTimeout(1500);
const rep = await page.evaluate(() => AshtonkMania.App.lastReport);
check('corrupt archive reported', rep.errors.some(e => /corrupt\.osz/.test(e)), rep.errors.join(' | '));
check('non-mania map reported as unplayable', rep.warnings.some(w => /Not an osu!mania/.test(w)) || rep.errors.some(e => /mania/.test(e)), rep.warnings.join(' | '));
await page.evaluate(async () => { const s = AshtonkMania.BeatmapManager.sets.find(x => x.maps.some(m => m.mode === 0)); if (s) await AshtonkMania.BeatmapManager.removeSet(s.id); });

// search & sort
await page.keyboard.type('9K');
await page.waitForTimeout(300);
const searched = await page.evaluate(() => AshtonkMania.SongSelect.results.map(r => r.maps.map(m => m.version)));
check('search filters difficulties', JSON.stringify(searched) === JSON.stringify([['9K Expert']]), JSON.stringify(searched));
await page.evaluate(() => { const s = AshtonkMania.SongSelect; s.searchInput.value = 'keys>=8'; s.query = 'keys>=8'; s.rebuild(true); });
const syntax = await page.evaluate(() => AshtonkMania.SongSelect.results[0].maps.map(m => m.keys));
check('filter syntax (keys>=8)', JSON.stringify(syntax) === '[8,9]', JSON.stringify(syntax));
await page.evaluate(() => { const s = AshtonkMania.SongSelect; s.searchInput.value = 'test anthm'; s.query = 'test anthm'; s.rebuild(true); });
check('fuzzy search tolerates typos', await page.evaluate(() => AshtonkMania.SongSelect.results.length === 1));
await page.evaluate(() => { const s = AshtonkMania.SongSelect; s.searchInput.value = ''; s.query = ''; AshtonkMania.Settings.set('songselect.sort', 'stars'); s.rebuild(); });
check('sorting by star rating works', await page.evaluate(() => AshtonkMania.SongSelect.results.length === 1));

// favorite
await page.evaluate(async () => { await AshtonkMania.Favorites.toggle(AshtonkMania.BeatmapManager.sets[0].id); });

// Auto plays for 4K / 7K / 8K / 9K
async function autoPlay(version) {
  await page.evaluate((v) => {
    const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === v);
    AshtonkMania.Settings.set('songselect.mods', ['AT']);
    AshtonkMania.SongSelect.selectedId = m.id;
    AshtonkMania.SongSelect.play('play');
  }, version);
  await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  if (version === '7K Hard') await shot('03-gameplay-7k-default-skin');
  // skip to speed things up is not possible for auto; wait for results
  await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'results', null, { timeout: 40000 });
  await page.waitForTimeout(500);
  return page.evaluate(() => { const s = AshtonkMania.Screens.current.p.score; return { score: s.score, acc: s.accuracy, grade: s.grade, counts: s.counts, maxCombo: s.maxCombo }; });
}
for (const v of ['4K Normal', '7K Hard', '8K Insane', '9K Expert']) {
  const r = await autoPlay(v);
  check(`Auto ${v}: all Marvelous, 1,000,000, SS`, r.score === 1000000 && r.grade === 'SS' && r.counts[5] === 0, JSON.stringify(r));
  if (v === '4K Normal') await shot('04-results-auto');
}
await page.evaluate(() => AshtonkMania.Settings.set('songselect.mods', []));

// live keyboard play: press every note of 4K using the real keybinds at the right audio time
async function livePlay({ version, errorMs = 0, missEvery = 0 }) {
  await page.evaluate((v) => {
    const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === v);
    AshtonkMania.SongSelect.selectedId = m.id;
    AshtonkMania.SongSelect.play('play');
  }, version);
  await page.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 15000 });
  // drive keys from inside the page, scheduled against the audio clock
  await page.evaluate(({ errorMs, missEvery }) => new Promise(resolve => {
    const G = AshtonkMania.GameplayScreen, s = G.s;
    const codes = AshtonkMania.Settings.keybinds(s.keys).map(c => c[0]);
    const ev = [];
    s.engine.notes.forEach((n, i) => {
      if (missEvery && i % missEvery === 0) return;
      ev.push([n.time + errorMs, n.col, 1], [(n.isLN ? n.end : n.time + 40) + errorMs, n.col, 0]);
    });
    ev.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    let i = 0;
    const tick = () => {
      if (!G.s) return resolve();
      const now = G.gameTime();
      while (i < ev.length && ev[i][0] <= now) {
        const [t, c, d] = ev[i++];
        window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: codes[c], key: codes[c], bubbles: true }));
      }
      if (i < ev.length) setTimeout(tick, 1); else resolve();
    };
    tick();
  }), { errorMs, missEvery });
  await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'results', null, { timeout: 40000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => { const s = AshtonkMania.Screens.current.p.score; return { score: s.score, acc: s.accuracy, grade: s.grade, counts: s.counts, mean: s.meanError, ur: s.unstableRate, pb: s.isPB, replayId: s.replayId }; });
}
const live = await livePlay({ version: '4K Normal' });
check('live keyboard play is judged from the audio clock (no misses, ≥ 95% acc)', live.counts[5] === 0 && live.acc > 0.95, JSON.stringify(live));
check('live play becomes a personal best with an auto-saved replay', live.pb && !!live.replayId);
await shot('05-results-live');
const late = await livePlay({ version: '4K Normal', errorMs: 50, missEvery: 7 });
check('late hits + skipped notes: misses counted, mean offset positive', late.counts[5] > 0 && late.mean > 25, JSON.stringify(late));
check('worse run is not a new PB', late.pb === false);

// replay reproduces original result
const rp = await page.evaluate(async () => {
  const r = AshtonkMania.ReplayManager.list[0];
  const map = AshtonkMania.BeatmapManager.mapByHash(r.mapHash);
  const { Game } = window; return { id: r.id, mapId: map.id, summary: r.summary };
});
await page.evaluate(async (rp) => { const r = await AshtonkMania.ReplayManager.get(rp.id); Game.launch({ mapId: rp.mapId, mode: 'replay', replay: r }); }, rp);
await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay', null, { timeout: 10000 });
await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'results', null, { timeout: 40000 });
const rres = await page.evaluate(() => { const s = AshtonkMania.Screens.current.p.score; return { score: s.score, counts: s.counts, acc: s.accuracy }; });
check('replay playback reproduces the original score exactly', rres.score === rp.summary.score && JSON.stringify(rres.counts) === JSON.stringify(rp.summary.counts), `${rres.score} vs ${rp.summary.score}`);

// pause / resume / fail path
await page.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.SongSelect.selectedId = m.id; AshtonkMania.Settings.set('songselect.mods', ['SD']); AshtonkMania.SongSelect.play('play'); });
await page.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 15000 });
await page.waitForTimeout(700);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const paused = await page.evaluate(() => !!document.querySelector('.pause-menu') && !AshtonkMania.Music.playing);
check('Escape pauses gameplay and audio', paused);
await shot('06-pause');
await page.keyboard.press('Escape');
await page.waitForTimeout(1600);
check('resume continues audio after countdown', await page.evaluate(() => AshtonkMania.Music.playing && AshtonkMania.GameplayScreen.s.running));
await page.waitForFunction(() => document.querySelector('.pause-box h2.failed'), null, { timeout: 15000 });
check('Sudden Death fails on first miss', true);
await shot('07-failed');
await page.evaluate(() => AshtonkMania.Settings.set('songselect.mods', []));
await page.evaluate(() => AshtonkMania.GameplayScreen.quit());
await page.waitForTimeout(500);

// skin import (Kori-structured stand-in)
await dropFiles(['Kori-test.osk']);
await page.waitForFunction(() => AshtonkMania.SkinManager.current.name === 'Kori 3.0 (test stand-in)', null, { timeout: 10000 });
const sk = await page.evaluate(async () => {
  const s = AshtonkMania.SkinManager.current; const L4 = await s.mania(4); const L7 = await s.mania(7);
  return { name: s.name, author: s.author, keys: s.supportedKeys(), fromIni: L4.fromSkinIni, colW: L4.columnWidth, hit: L4.hitPosition,
    keyTexW: L4.tex.key[0] && L4.tex.key[0].pw, keyScale: L4.tex.key[0] && L4.tex.key[0].scale, noteW: L7.tex.note[1] && L7.tex.note[1].pw,
    lightFrames: L4.tex.lightingN && L4.tex.lightingN.frames.length, font: !!L4.font, hitsound: !!(await s.sound('normal-hitnormal')) };
});
check('.osk import parses skin.ini metadata', sk.name === 'Kori 3.0 (test stand-in)' && sk.author === 'Fixture Generator', JSON.stringify(sk));
check('skin.ini [Mania] per-key sections applied (4K/7K)', JSON.stringify(sk.keys) === '[4,7]' && sk.fromIni && sk.hit === 395 && sk.colW[0] === 60);
check('custom mania/ paths resolved with @2x preference', sk.keyTexW === 128 && sk.keyScale === 2, `${sk.keyTexW}px scale ${sk.keyScale}`);
check('animated lighting frames + score font + skin hitsound detected', sk.lightFrames === 3 && sk.font && sk.hitsound);
await page.evaluate(() => AshtonkMania.Screens.go('skins'));
await page.waitForTimeout(1500);
await shot('08-skins');
await page.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.Settings.set('songselect.mods', ['AT']); AshtonkMania.SongSelect.selectedId = m.id; AshtonkMania.SongSelect.play('play'); });
await page.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 15000 });
await page.waitForTimeout(3200);
await shot('09-gameplay-kori-skin');
check('gameplay renders with the imported skin', await page.evaluate(() => AshtonkMania.GameplayScreen.s.layout.skin.name === 'Kori 3.0 (test stand-in)'));
await page.evaluate(() => AshtonkMania.GameplayScreen.quit());
await page.evaluate(() => AshtonkMania.Settings.set('songselect.mods', []));

// practice mode
await page.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '7K Hard'); AshtonkMania.SongSelect.selectedId = m.id; AshtonkMania.SongSelect.play('practice'); });
await page.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 15000 });
await page.waitForTimeout(800);
await page.evaluate(() => AshtonkMania.GameplayScreen.practiceSpeed(1.5));
await page.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running && AshtonkMania.GameplayScreen.s.rate === 1.5, null, { timeout: 20000 });
await page.waitForTimeout(1200);
const pr = await page.evaluate(() => ({ rate: AshtonkMania.Music.rate, stretched: !!AshtonkMania.Music.stretched }));
check('practice speed change (pitch-preserving time stretch)', pr.rate === 1.5 && pr.stretched, JSON.stringify(pr));
await shot('10-practice');
await page.evaluate(() => AshtonkMania.GameplayScreen.quit());
await page.evaluate(() => AshtonkMania.Settings.set('practice.speed', 1));
await page.waitForTimeout(400);

// other screens render without errors
for (const s of ['home', 'beatmaps', 'collections', 'profile', 'stats', 'replays']) {
  await page.evaluate(n => AshtonkMania.Screens.go(n), s);
  await page.waitForTimeout(700);
  await shot('11-' + s);
}
await page.keyboard.press('Control+o');
await page.waitForTimeout(600);
await shot('12-settings');
await page.keyboard.press('Escape');
await page.evaluate(() => AshtonkMania.Settings.set('gameplay.scrollSpeed', 27));
await page.waitForTimeout(600);

// now playing panel: hover the song in the toolbar → pause / next / previous
await page.evaluate(() => AshtonkMania.Screens.go('home'));
await page.waitForTimeout(1500);
await page.hover('.tb-music');
await page.waitForSelector('.np-panel.show', { timeout: 3000 });
check('hovering the toolbar song opens the now-playing panel', await page.evaluate(() => document.querySelector('.np-title').textContent.length > 0));
const wasPlaying = await page.evaluate(() => AshtonkMania.Music.playing);
await page.click('.np-ctls .np-ctl:nth-child(2)');
await page.waitForTimeout(200);
check('now-playing pause / resume', wasPlaying && await page.evaluate(() => !AshtonkMania.Music.playing));
await page.click('.np-ctls .np-ctl:nth-child(2)');
await page.waitForTimeout(300);
const beforeNext = await page.evaluate(() => AshtonkMania.MenuMusic.history.length);
await page.click('.np-ctls .np-ctl:nth-child(3)');
await page.waitForTimeout(800);
check('now-playing next track', await page.evaluate(n => AshtonkMania.MenuMusic.history.length === n + 1 && AshtonkMania.Music.playing, beforeNext));
await page.evaluate(() => AshtonkMania.Music.play(10000));
await page.click('.np-ctls .np-ctl:nth-child(1)');
await page.waitForTimeout(300);
check('now-playing previous restarts the song', await page.evaluate(() => AshtonkMania.Music.time < 3000));
await page.mouse.move(700, 700);
await page.waitForTimeout(600);

// beatmap explorer (Worker API mocked — the real mirrors are external services)
await page.route('**/api/health', r => r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
await page.route('**/api/search**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: 'mock', page: 0, hasMore: false,
  sets: [{ id: 777, title: 'Explorer Song', titleUnicode: '', artist: 'Mock', artistUnicode: '', creator: 'M', source: '', status: 'ranked', playCount: 1, favourites: 1, video: false, nsfw: false,
    diffs: [{ id: 7770, mode: 3, version: '4K', stars: 2.1, keys: 4, od: 8, hp: 7, bpm: 150, length: 60, notes: 100, lns: 10 }] }] }) }));
await page.route('**/api/download/**', r => r.fulfill({ contentType: 'application/octet-stream', body: readFileSync(join(root, 'tests', 'fixtures', 'standard.osz')) }));
await page.route('https://assets.ppy.sh/**', r => r.abort());
await page.evaluate(() => { AshtonkMania.OnlineBeatmaps.apiAvailable = null; AshtonkMania.ExplorerScreen.results = []; AshtonkMania.Screens.go('explore'); });
await page.waitForSelector('.ex-card[data-id="777"]', { timeout: 10000 });
check('beatmap explorer lists online results', true);
await shot('11b-explorer');
await page.click('.ex-card[data-id="777"] .ex-action button');
await page.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length === 2, null, { timeout: 15000 });
check('explorer download imports the .osz into the library', true);
await page.evaluate(async () => { const s = AshtonkMania.BeatmapManager.sets.find(x => /Standard/.test(x.title)); if (s) await AshtonkMania.BeatmapManager.removeSet(s.id); });

// pp tracking
const ppInfo = await page.evaluate(() => ({ total: AshtonkMania.ScoreManager.totalPp().total, best: AshtonkMania.ScoreManager.bestPpPerMap().length }));
check('pp is tracked from passed scores', ppInfo.total > 0 && ppInfo.best >= 1, JSON.stringify(ppInfo));

// persistence across reload
const before = await page.evaluate(() => ({ scores: AshtonkMania.ScoreManager.scores.length, sets: AshtonkMania.BeatmapManager.sets.length, fav: AshtonkMania.Favorites.set.size, skin: AshtonkMania.SkinManager.current.id, replays: AshtonkMania.ReplayManager.list.length }));
await page.reload();
await waitBoot();
const after = await page.evaluate(() => ({ scores: AshtonkMania.ScoreManager.scores.length, sets: AshtonkMania.BeatmapManager.sets.length, fav: AshtonkMania.Favorites.set.size, skin: AshtonkMania.SkinManager.current.id, replays: AshtonkMania.ReplayManager.list.length, speed: AshtonkMania.Settings.get('gameplay.scrollSpeed') }));
check('scores, beatmaps, favorites, replays and skin survive refresh', JSON.stringify({ ...after, speed: undefined }) === JSON.stringify({ ...before, speed: undefined }) && before.scores > 0, JSON.stringify(after));
check('settings survive refresh', after.speed === 27);
await shot('13-home-after-reload');

// responsiveness: 720p and ultrawide
for (const [w, hh, n] of [[1280, 720, '720p'], [2560, 1080, 'ultrawide'], [1440, 900, '16x10']]) {
  await page.setViewportSize({ width: w, height: hh });
  await page.evaluate(() => AshtonkMania.Screens.go('songselect'));
  await page.waitForTimeout(700);
  await shot('14-songselect-' + n);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check(`no horizontal overflow at ${n}`, !overflow);
  await page.evaluate(() => AshtonkMania.Screens.go('home'));
  await page.waitForTimeout(300);
}

// browser zoom is compensated: simulate 125% zoom (window 1.25× wider than the viewport, DPR 1.25)
{
  const zctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.25 });
  await zctx.addInitScript(() => { Object.defineProperty(window, 'outerWidth', { get: () => Math.round(innerWidth * 1.25) }); });
  const zp = await zctx.newPage();
  await zp.goto(url);
  await zp.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  const z = await zp.evaluate(() => { const a = document.querySelector('#app').getBoundingClientRect(), t = document.querySelector('#toolbar').getBoundingClientRect(); return { cls: document.querySelector('#app').classList.contains('zoomfix'), w: a.width, h: a.height, tb: t.height, zoom: AshtonkMania.Zoom.z }; });
  check('browser zoom is compensated (UI keeps its physical size)', z.cls && z.zoom === 1.25 && Math.abs(z.w - 1280) < 2 && Math.abs(z.h - 720) < 2 && Math.abs(z.tb - 32) < 1, JSON.stringify(z));
  const prevented = await zp.evaluate(() => { const e = new KeyboardEvent('keydown', { code: 'Equal', key: '=', ctrlKey: true, cancelable: true, bubbles: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  check('Ctrl + / Ctrl - zoom shortcuts are blocked', prevented);
  await zctx.close();
}

check('no uncaught page errors', errors.filter(e => !/favicon|fonts\.g|ERR_CERT|ERR_NAME|ERR_INTERNET|ERR_FAILED|status of 404/.test(e)).length === 0, errors.slice(0, 8).join('\n'));
await browser.close();
server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
