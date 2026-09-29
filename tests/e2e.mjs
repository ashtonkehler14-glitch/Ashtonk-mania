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
  if (await page.$('.onboarding')) {
    await page.fill('.onboarding .ob-name', 'Tester'); await page.keyboard.press('Enter');
    await page.waitForSelector('.setup-step-ask');
    await page.click('.onboarding .ob-skip'); await page.waitForTimeout(400);
  }
};

await page.goto(url);
await waitBoot();
check('boots to home screen', await page.evaluate(() => AshtonkMania.Screens.currentName === 'home'));
check('first launch asks for a name', await page.evaluate(() => AshtonkMania.ProfileManager.profile.name === 'Tester' && AshtonkMania.ProfileManager.profile.onboarded));
check('Kori 3.0 is preinstalled and selected', await page.evaluate(() => /Kori 3\.0/.test(AshtonkMania.SkinManager.current.name)), await page.evaluate(() => AshtonkMania.SkinManager.current.name));
check('branding is Ashtonk!mania', await page.evaluate(() => document.title === 'Ashtonk!mania' && document.querySelector('.lz-cookie-text').textContent.includes('ashtonk')));
check('osu!lazer toolbar: icon buttons only, no text tabs, no beatmap listing', await page.evaluate(() => !document.querySelector('#toolbar [data-tab="songselect"]') && !document.querySelector('#toolbar [data-tab="explore"]') && !!document.querySelector('#toolbar .tb-music') && !!document.querySelector('#toolbar .tb-clock')));
check('KPS counter, judgement counter and hit error bar removed', await page.evaluate(() => ['gameplay.kpsCounter', 'gameplay.judgementCounter', 'gameplay.hitErrorBar', 'gameplay.errorBarScale'].every(k => !AshtonkMania.Settings.schema.has(k)) && !document.querySelector('.hud-kps')));
check('touch controls, hitsounds and the old Neru easter-egg settings removed', await page.evaluate(() => !AshtonkMania.Settings.schema.has('input.touch') && !AshtonkMania.Settings.schema.has('audio.hitsounds') && !AshtonkMania.Settings.schema.has('gameplay.neruSparkle') && typeof window.LOADING_NERU === 'undefined'));
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
check('.osz import: the 4 playable difficulties grouped into one set', lib.n === 4 && !lib.broken.length, JSON.stringify(lib.keys));
check('unplayable difficulty is left out (reported, not listed)', await page.evaluate(() => AshtonkMania.App.lastReport.warnings.some(w => /Missing audio/.test(w))));
await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'songselect', null, { timeout: 5000 });
await page.waitForTimeout(800);
check('import navigates to song select with new map selected', await page.evaluate(() => !!AshtonkMania.SongSelect.selectedId));
await shot('02-songselect');

// corrupt / non-mania archives
await dropFiles(['corrupt.osz', 'standard.osz']);
await page.waitForTimeout(1500);
const rep = await page.evaluate(() => AshtonkMania.App.lastReport);
check('corrupt archive reported', rep.errors.some(e => /corrupt\.osz/.test(e)), rep.errors.join(' | '));
check('non-mania archive is rejected (nothing unplayable is added)', rep.errors.some(e => /no playable osu!mania/.test(e)) && !(await page.evaluate(() => AshtonkMania.BeatmapManager.sets.some(s => /Standard/.test(s.title)))), rep.errors.join(' | '));
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
{
  const before = await page.evaluate(() => AshtonkMania.Settings.get('gameplay.scrollSpeed'));
  await page.keyboard.press('F4'); await page.keyboard.press('F4');
  const up = await page.evaluate(() => AshtonkMania.Settings.get('gameplay.scrollSpeed'));
  await page.keyboard.press('Control+Minus');
  const down = await page.evaluate(() => AshtonkMania.Settings.get('gameplay.scrollSpeed'));
  check('scroll speed changes in game (F3/F4, Ctrl −/+) with an on-screen popup', up === before + 2 && down === before + 1 && await page.evaluate(() => /Scroll speed/.test(document.querySelector('.gp-speed')?.textContent || '')), `${before} → ${up} → ${down}`);
  await page.keyboard.press('F3');
}
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
const simple = await page.evaluate(() => document.querySelectorAll('.settings-panel .set-row').length);
await page.click('.sp-more');
await page.waitForTimeout(200);
const full = await page.evaluate(() => document.querySelectorAll('.settings-panel .set-row').length);
check('settings show the essentials first, everything behind "Show all settings"', simple <= 23 && full > simple + 20, `${simple} → ${full}`);
await page.click('.sp-more');
await page.fill('.sp-search', 'unpause');
await page.waitForTimeout(200);
check('settings search still finds advanced options', await page.evaluate(() => [...document.querySelectorAll('.settings-panel .set-row')].some(r => /Unpause/.test(r.textContent))));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.evaluate(() => AshtonkMania.Screens.go('songselect'));
await page.waitForTimeout(700);
await page.keyboard.press('F1');
await page.waitForSelector('.modsel .mod-p');
await page.evaluate(() => [...document.querySelectorAll('.mod-p')].find(b => b.textContent.includes('Hidden')).click());
await page.waitForTimeout(200);
check('mod select: lazer columns, toggling a mod and its customise panel', await page.evaluate(() => document.querySelectorAll('.modcol-h').length >= 5 && document.querySelector('.mod-p.on').textContent.includes('Hidden') && !!document.querySelector('.mod-config .slider') && AshtonkMania.Settings.get('songselect.mods').includes('HD')));
await page.keyboard.press('Backspace');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
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
await page.route('**/api/download/**', r => r.fulfill({ contentType: 'application/octet-stream', body: readFileSync(join(root, 'tests', 'fixtures', 'online-set.osz')) }));
await page.route('https://assets.ppy.sh/**', r => r.abort());
await page.evaluate(() => { AshtonkMania.OnlineBeatmaps.apiAvailable = null; AshtonkMania.ExplorerScreen.results = []; AshtonkMania.Screens.go('explore'); });
await page.waitForSelector('.ex-card[data-id="777"]', { timeout: 10000 });
check('beatmap explorer lists online results', true);
await page.route('https://b.ppy.sh/**', r => r.abort());
await page.evaluate(() => { window.__card = document.querySelector('.ex-card[data-id="777"]'); });
await page.click('.ex-card[data-id="777"] .ex-play');
await page.waitForTimeout(300);
check('previewing a song keeps the list in place (no re-render / jump to top)', await page.evaluate(() => window.__card.isConnected && window.__card.querySelector('.ex-play').dataset.ic === 'pause'));
await page.click('.ex-card[data-id="777"] .ex-play');
await shot('11b-explorer');
await page.click('.ex-card[data-id="777"] .ex-action button');
await page.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length === 2, null, { timeout: 15000 });
check('explorer download imports the .osz into the library', true);
{
  // Web-Osu-Mania ordering: "Has leaderboard" + newest ranked first by default, results kept in the chosen order
  const mk = (id, title, status, rankedDate, plays) => ({ id, title, titleUnicode: '', artist: 'A', artistUnicode: '', creator: 'M', source: '', status, rankedDate, playCount: plays, favourites: 0, video: false, nsfw: false,
    diffs: [{ id: id * 10, mode: 3, version: '4K', stars: 2, keys: 4, od: 8, hp: 7, bpm: 150, length: 60, notes: 10, lns: 0 }] });
  const seen = [];
  await page.unroute('**/api/search**');
  await page.route('**/api/search**', r => { seen.push(new URL(r.request().url()).searchParams); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: 'mock', page: 0, hasMore: false, sets: [
    mk(801, 'Bravo', 'ranked', '2023-05-01T00:00:00Z', 5), mk(802, 'Alpha', 'loved', '2024-01-01T00:00:00Z', 50), mk(803, 'Charlie', 'graveyard', null, 9), mk(804, 'Delta', 'ranked', '2021-01-01T00:00:00Z', 500)] }) }); });
  await page.evaluate(() => AshtonkMania.ExplorerScreen.newSearch());
  await page.waitForSelector('.ex-card[data-id="801"]');
  const order1 = await page.$$eval('.ex-card', a => a.map(c => c.dataset.id).join(','));
  const p0 = seen[seen.length - 1];
  check('explorer: default is "Has leaderboard", newest ranked first (ranked_desc)', order1 === '802,801,804' && p0.get('sort') === 'ranked_desc' && p0.get('status') === 'leaderboard', `${order1} ${p0}`);
  await page.click('.ex-chip:text-is("Title")');
  await page.waitForTimeout(300);
  const order2 = await page.$$eval('.ex-card', a => a.map(c => c.dataset.id).join(','));
  await page.click('.ex-chip:text-matches("^Title")');
  await page.waitForTimeout(300);
  const order3 = await page.$$eval('.ex-card', a => a.map(c => c.dataset.id).join(','));
  check('explorer: sorting by title is A→Z, clicking again flips it', order2 === '802,801,804' && order3 === '804,801,802' && seen[seen.length - 1].get('sort') === 'title_desc', `${order2} / ${order3}`);
  await page.evaluate(() => { const st = AshtonkMania.ExplorerScreen.state; st.sort = 'ranked'; st.dir = 'desc'; });
}
await page.evaluate(async () => { const s = AshtonkMania.BeatmapManager.sets.find(x => x.maps.some(m => /^Online/.test(m.version))); if (s) await AshtonkMania.BeatmapManager.removeSet(s.id); });

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

// player loader, beatmap offset and hold-to-retry
{
  const id = await page.evaluate(() => [...AshtonkMania.BeatmapManager.maps.values()].find(m => !m.problems.length).id);
  await page.evaluate(async id => { const m = AshtonkMania.BeatmapManager.maps.get(id); await AshtonkMania.MapOffsets.set(m.hash, 20); AshtonkMania.Screens.go('gameplay', { mapId: id, force: true }); }, id);
  await page.waitForSelector('.gp-loader .pl-t');
  check('player loader shows the beatmap and quick settings before playing', await page.evaluate(id => document.querySelector('.gp-loader .pl-t').textContent === AshtonkMania.BeatmapManager.maps.get(id).title && !!document.querySelector('.pl-settings .slider'), id));
  await page.waitForFunction(() => document.querySelector('.gp-loader.ready'), null, { timeout: 15000 });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => AshtonkMania.GameplayScreen.loaderGone && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 5000 });
  check('Space starts from the loader; the beatmap offset is applied', await page.evaluate(() => AshtonkMania.GameplayScreen.s.mapOffset === 20 && AshtonkMania.GameplayScreen.offsetMs() === AshtonkMania.Settings.get('audio.offset') + 20));
  await page.keyboard.down('Backquote'); await page.waitForTimeout(250);
  const holding = await page.evaluate(() => document.querySelector('.hold-retry').classList.contains('on') && !!AshtonkMania.GameplayScreen.s);
  await page.waitForTimeout(450); await page.keyboard.up('Backquote');
  await page.waitForTimeout(250);
  check('holding ` shows the retry bar, then retries (with a retry counter)', holding && await page.evaluate(() => AshtonkMania.GameplayScreen.retryCount === 1 && !!document.querySelector('.gp-loader .pl-tag.retry')));
  await page.evaluate(async id => { await AshtonkMania.MapOffsets.set(AshtonkMania.BeatmapManager.maps.get(id).hash, 0); }, id);
  await page.evaluate(() => AshtonkMania.Screens.go('home'));
  await page.waitForTimeout(500);
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

// first-run setup wizard on a fresh profile, on a Chromebook
{
  const sctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const sp = await sctx.newPage();
  sp.on('pageerror', e => errors.push('setup: ' + e.message));
  await sp.goto(url);
  await sp.waitForSelector('.setup-step-welcome', { timeout: 30000 });
  await sp.click('.setup-next');
  check('setup: a name is required', /name/.test(await sp.textContent('.ob-err')) && !!(await sp.$('.setup-step-welcome')));
  await sp.fill('.ob-name', 'Newbie'); await sp.keyboard.press('Enter');
  await sp.waitForSelector('.setup-step-ask');
  check('setup: after the name it asks whether to set up (set up / skip)', !!(await sp.$('.setup-choice.primary')) && !!(await sp.$('.setup-choice.ob-skip')) && !(await sp.$('.setup-step-experience')));
  await sp.click('.setup-choice.primary');
  await sp.waitForSelector('.setup-step-device');
  check('setup: device step is just PC or Chromebook', (await sp.$$('.setup-step-device .setup-choice')).length === 2 && !(await sp.$('.setup-detect')));
  await sp.click('.setup-choice[data-id="chromebook"]');
  await sp.waitForSelector('.setup-step-look', { timeout: 3000 });
  check('setup: Chromebook turns on performance mode and moves on', await sp.evaluate(() => AshtonkMania.Settings.get('graphics.performanceMode') === true && AshtonkMania.Settings.get('graphics.particles') === false && AshtonkMania.Settings.get('graphics.menuBlur') === 0));
  const swatches = await sp.$$eval('.setup-swatch span', a => a.map(x => x.textContent).join(','));
  await sp.click('.setup-swatch >> nth=2');
  check('setup: accent colours are Kori, Neru, Teto, Miku and apply live; size is a slider', swatches === 'Kori,Neru,Teto,Miku' && await sp.evaluate(() => document.documentElement.dataset.theme === 'teto') && !!(await sp.$('.setup-step-look input.slider')), swatches);
  await sp.click('.setup-next'); await sp.waitForSelector('.setup-step-gameplay');
  await sp.waitForTimeout(600);
  const pvDrawn = await sp.evaluate(() => { const c = document.querySelector('.setup-pv canvas'); return c && c.width > 50 && c.height > 50; });
  check('setup: live gameplay preview renders; scroll speed defaults to 22', pvDrawn && await sp.evaluate(() => AshtonkMania.Settings.get('gameplay.scrollSpeed') === 22));
  await sp.click('.setup-next'); await sp.waitForSelector('.setup-step-skin');
  const skinNames = await sp.$$eval('.setup-skinitem b', a => a.map(x => x.textContent).join(','));
  await sp.click('.setup-skinitem[data-id="default"]');
  await sp.waitForSelector('.setup-custom');
  await sp.click('.setup-custom .setup-seg >> nth=0 >> button >> nth=3');
  await sp.click('.setup-custom .setup-seg >> nth=1 >> button >> nth=1');
  check('setup: skins are Kori / Custom / Import; Custom has shape and colour options', /^Kori,Custom,.*Import a skin$/.test(skinNames) && await sp.evaluate(() => AshtonkMania.SkinManager.current.id === 'default' && AshtonkMania.Settings.get('skin.noteStyle') === 'arrows' && AshtonkMania.Settings.get('skin.hue') >= 0), skinNames);
  await sp.click('.setup-next'); await sp.waitForTimeout(600);
  check('setup: Finish closes it and lands on the main menu', !(await sp.$('.setup')) && await sp.evaluate(() => AshtonkMania.Screens.currentName === 'home' && AshtonkMania.ProfileManager.profile.onboarded && AshtonkMania.ProfileManager.profile.name === 'Newbie'));
  await sp.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 40; c.height = 80; c.getContext('2d').fillRect(0, 0, 40, 80);
    await AshtonkMania.NeruMascot.setImage(await new Promise(r => c.toBlob(r, 'image/png')));
  });
  await sp.waitForSelector('.home .neru:not([hidden]) img', { timeout: 5000 });
  await sp.click('.neru');
  check('Neru shows the chosen picture on the main menu (no speech bubbles)', await sp.evaluate(() => document.querySelector('.neru').classList.contains('hop') && !document.querySelector('.neru-bubble')));
  check('the Ashtonk!mania logo stays pink whatever the theme', await sp.evaluate(() => getComputedStyle(document.querySelector('.lz-cookie-disc')).backgroundColor === 'rgb(255, 102, 171)'));
  await sp.evaluate(() => AshtonkMania.Screens.go('profile')); await sp.waitForTimeout(400);
  await sp.click('.pf-avatar'); await sp.waitForSelector('.av-tile');
  const tiles = await sp.$$eval('.av-tile span', a => a.map(x => x.textContent).join(','));
  await sp.click('.av-tile >> nth=4'); await sp.waitForTimeout(400);
  check('free Miku / Teto / Neru profile pictures can be picked', tiles.startsWith('Miku,Miku,Teto,Teto,Neru,Neru') && await sp.evaluate(() => AshtonkMania.ProfileManager.profile.avatar === 'preset:neru-1' && /^data:image\/svg/.test(AshtonkMania.ProfileManager.avatarURL) && !!document.querySelector('#toolbar .avatar').style.backgroundImage), tiles);
  await sp.evaluate(() => AshtonkMania.Screens.go('home')); await sp.waitForTimeout(400);
  check('no FPS box in the corner when the FPS counter is off', await sp.evaluate(() => getComputedStyle(document.querySelector('#fps-counter')).display === 'none'));
  await sp.reload();
  await sp.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await sp.waitForTimeout(600);
  check('setup: choices persist and the wizard does not return', !(await sp.$('.setup')) && await sp.evaluate(() => AshtonkMania.Settings.get('graphics.performanceMode') === true && AshtonkMania.Settings.get('ui.theme') === 'teto'));
  await sctx.close();
}

check('no uncaught page errors', errors.filter(e => !/favicon|fonts\.g|ERR_CERT|ERR_NAME|ERR_INTERNET|ERR_FAILED|status of 404/.test(e)).length === 0, errors.slice(0, 8).join('\n'));
await browser.close();
server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
