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
    let data;
    try { data = readFileSync(file); } catch { data = readFileSync(join(root, 'public', p)); } // bundled assets (neru.png…)
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? '  — ' + extra : ''}`); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
// (service workers off here: the API is mocked with page.route; the offline app is checked in its own context)
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
// Element.append(null) writes the word "null" on screen: any such call is reported as a page error
await context.addInitScript(() => { for (const P of [Element.prototype, DocumentFragment.prototype]) { const o = P.append; P.append = function (...a) { if (a.some(x => x === null || x === undefined)) console.error('a null child was appended (it shows up as the text "null") to ' + (this.className || this.tagName)); return o.apply(this, a); }; } });
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
    await page.waitForSelector('.setup-step-wom'); await page.evaluate(() => AshtonkMania.Onboarding.finish()); await page.waitForTimeout(400);
  }
};

await page.goto(url);
await waitBoot();
check('boots to home screen', await page.evaluate(() => AshtonkMania.Screens.currentName === 'home'));
check('first launch asks for a name', await page.evaluate(() => AshtonkMania.ProfileManager.profile.name === 'Tester' && AshtonkMania.ProfileManager.profile.onboarded));
check('Kori 3.0 is preinstalled and selected', await page.evaluate(() => /Kori 3\.0/.test(AshtonkMania.SkinManager.current.name)), await page.evaluate(() => AshtonkMania.SkinManager.current.name));
await page.waitForFunction(() => AshtonkMania.SkinManager.skins.some(s => /chemuss/i.test(s.name)), null, { timeout: 20000 }).catch(() => {});
{
  const ch = await page.evaluate(async () => {
    const A = AshtonkMania, SM = A.SkinManager, meta = SM.skins.find(s => /chemuss/i.test(s.name));
    if (!meta) return { missing: true };
    const sk = SM.instance(meta.id), L = await sk.mania(4);
    // where the orb's centre is at the moment it's hit vs the centre of the ring receptor (ring spans 2–217 of the
    // 325-px key image, drawn at its own height from the bottom), in osu!'s 480-unit space
    const k = L.tex.key[0], n = L.tex.note[0], noteH = L.columnWidth[0] * n.h / n.w;
    const keyH = k.h / 1.6, ringC = 480 - keyH + keyH * (109.5 / 325), noteC = L.hitPosition - noteH / 2;
    return { name: sk.name, stillKori: /Kori/.test(SM.current.name), col: L.columnWidth.join(), lines: L.columnLineWidth.join(), hit: L.hitPosition, note: n && n.w, light: !!L.tex.lightingN, max: L.judgement['300g'] && L.judgement['300g'].w, body: L.tex.noteL[0] && L.tex.noteL[0].frames[0].height, off: +(noteC - ringC).toFixed(2) };
  });
  check('Chemuss mixed edit ships as a second skin (Kori stays selected)', ch.name === 'Chemuss mixed edit' && ch.stillKori, JSON.stringify(ch));
  check('Chemuss 4K: its complete [Mania] section wins, repeated lists fill in, "null" hides lighting, giant textures are capped',
    ch.col === '70,70,70,70' && ch.lines === '0,0,0,0,0' && ch.note === 150 && ch.light === false && ch.max === 1 && ch.body === 8192, JSON.stringify(ch));
  check('Chemuss 4K: notes are hit centred on the ring receptors (hit position 448)', ch.hit === 448 && Math.abs(ch.off) < 1.5, JSON.stringify({ hit: ch.hit, offsetUnits: ch.off }));
}
check('branding is Ashtonk!mania', await page.evaluate(() => document.title === 'Ashtonk!mania' && document.querySelector('.lz-cookie-text').textContent.includes('ashtonk')));
check('osu!lazer toolbar: icon buttons (beatmap listing, notifications), no text tabs and no Discover', await page.evaluate(() => !document.querySelector('#toolbar [data-tab="songselect"]') && !!document.querySelector('#toolbar [data-tab="explore"]') && !document.querySelector('#toolbar [data-tab="discover"]') && !!document.querySelector('#toolbar [data-tab="notifications"]') && !!document.querySelector('#toolbar .tb-music') && !!document.querySelector('#toolbar .tb-clock')));
check('toolbar clock cycles full → digital → analog on click', await page.evaluate(() => { const c = document.querySelector('.tb-clock'), seen = [c.dataset.mode]; for (let i = 0; i < 3; i++) { document.querySelector('.tb-clock').click(); seen.push(document.querySelector('.tb-clock').dataset.mode); } return seen.join(',') === 'full,digital,analog,full'; }));
check('mouse wheel on the main menu changes the volume (lazer volume overlay)', await page.evaluate(async () => {
  AshtonkMania.Screens.go('home'); await new Promise(r => setTimeout(r, 300));
  const s = AshtonkMania.Settings, before = s.get('audio.master');
  document.querySelector('.lz-stage').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
  const up = s.get('audio.master'); s.set('audio.master', before);
  return Math.abs(up - Math.min(1, before + 0.05)) < 1e-6 && document.querySelector('.volume-overlay.show') !== null;
}));
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
check('song select starts the selected beatmap\'s song', await page.waitForFunction(() => AshtonkMania.Music.playing && AshtonkMania.Music.meta && AshtonkMania.Music.meta.setId === AshtonkMania.BeatmapManager.maps.get(AshtonkMania.SongSelect.selectedId).setId, null, { timeout: 5000 }).then(() => true, () => false));
check('carousel panels curve away from the middle like lazer', await page.evaluate(() => {
  const sc = document.querySelector('.carousel-scroll'), r = sc.getBoundingClientRect(), mid = r.top + r.height / 2;
  const items = [...document.querySelectorAll('.c-item')].map(e => { const b = e.getBoundingClientRect(); return { d: Math.abs(b.top + b.height / 2 - mid), x: parseFloat(e.style.translate) || 0 }; }).sort((a, b) => a.d - b.d);
  return items.length > 2 && items[0].x <= 2 && items[items.length - 1].x > items[0].x;
}));
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
  if (version === '4K Normal') {
    // smooth scrolling: from one drawn frame to the next, the playfield clock moves by exactly the time between the
    // frames' refreshes (it used to follow a jittery audio reading, so notes stepped unevenly), and no frame stalls
    // on building a sprite (the first hit lightings used to)
    const p = await page.evaluate(() => new Promise(resolve => {
      const G = AshtonkMania.GameplayScreen, R = G.renderer, orig = R.render, rec = [];
      R.render = function (g) { const t0 = performance.now(); const r = orig.call(this, g); rec.push([g.realNow, g.now, performance.now() - t0]); return r; };
      setTimeout(() => {
        R.render = orig;
        const steps = [], rate = G.s.rate;
        for (let i = 1; i < rec.length; i++) if (G.s.running) steps.push(Math.abs((rec[i][1] - rec[i - 1][1]) - (rec[i][0] - rec[i - 1][0]) * rate));
        const cost = rec.map(x => x[2]).sort((a, b) => a - b);
        resolve({ frames: rec.length, worstStepMs: +Math.max(...steps).toFixed(3), p99RenderMs: +cost[Math.floor(cost.length * 0.99)].toFixed(2) });
      }, 2500);
    }));
    check('gameplay: notes move by exactly the time between frames, and no frame stalls', p.frames > 60 && p.worstStepMs < 0.5 && p.p99RenderMs < 8, JSON.stringify(p));
  } else await page.waitForTimeout(2500);
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
let loaderChecked = false;
async function livePlay({ version, errorMs = 0, missEvery = 0 }) {
  await page.evaluate((v) => {
    const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === v);
    AshtonkMania.SongSelect.selectedId = m.id;
    AshtonkMania.SongSelect.play('play');
  }, version);
  if (!loaderChecked) { loaderChecked = true; const lt = await page.$eval('.gp-loader', el => el.innerText).catch(() => ''); check('player loader shows no stray "null" text', lt && !/\bnull\b/.test(lt), lt.replace(/\s+/g, ' ').slice(0, 160)); }
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
await page.waitForTimeout(2800); // (the accuracy circle and badges animate in)
const panel = await page.evaluate(() => {
  const g = document.querySelector('.rs .rs-ring .rs-grade'), ring = document.querySelector('.rs .accring');
  return { grade: g && g.textContent, badges: [...document.querySelectorAll('.rs-badge')].map(b => b.textContent), on: document.querySelector('.rs-badge.on')?.textContent,
    filled: ring ? 1 - parseFloat(ring.style.strokeDashoffset) / parseFloat(ring.getAttribute('stroke-dasharray')) : 0, hist: !!document.querySelector('.res-right canvas') };
});
const shown = { XH: 'SS', X: 'SS', SH: 'S' }[live.grade] || live.grade;
check('results: lazer score panel — accuracy circle filled to the accuracy, rank badges up to the grade, hit distribution beside it',
  panel.grade === shown && panel.on === shown && panel.badges[0] === 'D' && panel.badges.includes(shown) && Math.abs(panel.filled - (live.acc >= 1 || ['SS', 'XH', 'X'].includes(live.grade) ? 1 : Math.min(live.acc, 0.99))) < 0.01 && panel.hist, JSON.stringify(panel));
await page.click('.res-share');
await page.waitForSelector('.share-card');
await page.waitForFunction(() => document.querySelector('.share-card').naturalWidth > 0);
const card = await page.evaluate(() => { const i = document.querySelector('.share-card'); return [i.naturalWidth, i.naturalHeight]; });
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('.dialog button:text-is("Save PNG")')]);
check('results: Share makes a 1200×630 result card to copy or save as PNG', card[0] === 1200 && card[1] === 630 && /\.png$/.test(dl.suggestedFilename()), `${card} ${dl.suggestedFilename()}`);
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

check('new replays record the judging rules they were played with (osu!lazer rules = 2)', await page.evaluate(async (id) => (await AshtonkMania.ReplayManager.get(id)).rules === 2, rp.id));

// a pointer that just rests where the loader's settings panel appears (Watch on the Replays page sits there) must not
// hold the loader: only moving over the panel does
await page.mouse.move(1450, 150);
await page.evaluate(async (rp) => { const r = await AshtonkMania.ReplayManager.get(rp.id); Game.launch({ mapId: rp.mapId, mode: 'replay', replay: r }); }, rp);
await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay', null, { timeout: 10000 });
const loaderLeft = await page.waitForFunction(() => AshtonkMania.GameplayScreen.loaderGone, null, { timeout: 9000 }).then(() => true, () => false);
check('the player loader starts even with the pointer resting over its settings panel', loaderLeft);
await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'results', null, { timeout: 40000 });
await page.mouse.move(800, 450);

// watching a replay: pause, seek (re-judged exactly), speed — and the result is unchanged at the end
await page.evaluate(async (rp) => { const r = await AshtonkMania.ReplayManager.get(rp.id); Game.launch({ mapId: rp.mapId, mode: 'replay', replay: r }); }, rp);
await page.waitForFunction(() => AshtonkMania.GameplayScreen.loaderGone && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 15000 });
{
  check('replay controls: a timeline with pause, ±5s and speed buttons', await page.evaluate(() => !!document.querySelector('.replay-bar .rp-timeline') && document.querySelectorAll('.replay-bar .speed-group .chip').length === 6 && !!document.querySelector('.replay-bar .rp-play')));
  const seek = await page.evaluate(() => {
    const G = AshtonkMania.GameplayScreen, s = G.s, mid = s.endTime * 0.6;
    G.replaySeek(mid); const a = { score: s.engine.score.score, judged: s.engine.score.judged, combo: s.engine.score.combo, hp: s.engine.health.value };
    G.replaySeek(0); const z = s.engine.score.judged;
    G.replaySeek(mid); const b = { score: s.engine.score.score, judged: s.engine.score.judged, combo: s.engine.score.combo, hp: s.engine.health.value };
    const expect = s.baseNotes.filter(n => n.time < mid - 200).length;
    return { a, b, z, expect, near: Math.abs(G.gameTime() - mid) < 250 };
  });
  check('replay seek re-judges the recorded inputs up to that point (the same every time)', seek.a.judged >= seek.expect && seek.a.judged > 0 && seek.z === 0 && JSON.stringify(seek.a) === JSON.stringify(seek.b) && seek.near, JSON.stringify(seek));
  await page.keyboard.press('Space'); await page.waitForTimeout(250);
  const paused = await page.evaluate(() => ({ running: AshtonkMania.GameplayScreen.s.running, playing: AshtonkMania.Music.playing, t: AshtonkMania.GameplayScreen.gameTime() }));
  await page.waitForTimeout(300);
  const still = await page.evaluate(() => AshtonkMania.GameplayScreen.gameTime());
  await page.keyboard.press('Space'); await page.waitForTimeout(150);
  check('Space pauses and resumes a replay (no pause menu, no countdown)', !paused.running && !paused.playing && still === paused.t && !(await page.$('.pause-menu')) && await page.evaluate(() => AshtonkMania.GameplayScreen.s.running && AshtonkMania.Music.playing), JSON.stringify(paused));
  const t0 = await page.evaluate(() => AshtonkMania.GameplayScreen.gameTime());
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(80);
  const t1 = await page.evaluate(() => AshtonkMania.GameplayScreen.gameTime());
  check('← jumps back 5 seconds', t0 - t1 > 4500 && t0 - t1 < 5600, `${t0} → ${t1}`);
  await page.click('.replay-bar .speed-group .chip:text-is("2×")'); await page.waitForTimeout(300);
  const sp = await page.evaluate(() => ({ rate: AshtonkMania.Music.rate, speed: AshtonkMania.GameplayScreen.s.speed, running: AshtonkMania.GameplayScreen.s.running }));
  // (game time against the page's own clock: a busy test machine stretches Playwright's waits, not the ratio)
  const ratio = await page.evaluate(() => new Promise(r => { const G = AshtonkMania.GameplayScreen, g0 = G.gameTime(), p0 = performance.now(); setTimeout(() => r((G.gameTime() - g0) / (performance.now() - p0)), 600); }));
  check('playback speed 2×: the replay runs twice as fast', sp.speed === 2 && Math.abs(sp.rate - 2) < 1e-9 && sp.running && ratio > 1.7 && ratio < 2.3, JSON.stringify(sp) + ` ${ratio.toFixed(2)}× real time`);
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
  check('↓ / ↑ step the playback speed', await page.evaluate(() => AshtonkMania.GameplayScreen.s.speed === 1.5 && Math.abs(AshtonkMania.Music.rate - 1.5) < 1e-9));
  await page.evaluate(() => { const G = AshtonkMania.GameplayScreen; G.replaySeek(G.s.endTime - 1500); });
  await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'results', null, { timeout: 20000 });
  const sres = await page.evaluate(() => { const s = AshtonkMania.Screens.current.p.score; return { score: s.score, counts: s.counts }; });
  check('after seeking around and changing speed, the replay still ends with the original result', sres.score === rp.summary.score && JSON.stringify(sres.counts) === JSON.stringify(rp.summary.counts), `${sres.score} vs ${rp.summary.score}`);
}

// two keys bound to one column: the column stays pressed until both are up
await page.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.SongSelect.selectedId = m.id; AshtonkMania.SongSelect.play('play'); });
await page.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 15000 });
const twoKeys = await page.evaluate(() => {
  const G = AshtonkMania.GameplayScreen, s = G.s;
  const main = AshtonkMania.Settings.keybinds(s.keys)[0][0];
  s.keyMap.set('KeyQ', 0);
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
  key('keydown', main); key('keydown', 'KeyQ'); key('keyup', main);
  const stillHeld = s.held[0] && s.engine.held[0];
  key('keyup', 'KeyQ');
  const released = !s.held[0] && !s.engine.held[0];
  return { stillHeld, released, presses: s.engine.pressCounts[0], scroll: Math.abs(G.renderer.scrollLength - 402 * G.renderer.s) < 1e-9 };
});
check('two keys on one column: releasing one keeps the column held; releasing both lets go', twoKeys.stillHeld && twoKeys.released && twoKeys.presses === 1, JSON.stringify(twoKeys));
check('scroll speed is independent of the skin hit position (osu!lazer: 402/480 of the height per time range)', twoKeys.scroll);
await page.evaluate(() => AshtonkMania.Screens.go('songselect', {}, { replace: true }));
await page.waitForTimeout(400);

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
{
  const t0 = await page.evaluate(() => AshtonkMania.GameplayScreen.s.failClock.t);
  await page.waitForTimeout(1600);
  const t1 = await page.evaluate(() => AshtonkMania.GameplayScreen.gameTime());
  await page.waitForTimeout(400);
  const t2 = await page.evaluate(() => AshtonkMania.GameplayScreen.gameTime());
  check('after a fail the playfield winds down with the song and stays put (no jump back to the start)', t1 > t0 && t1 === t2 && await page.evaluate(() => document.querySelector('.gameplay').classList.contains('failing')), `${t0} → ${t1} → ${t2}`);
}
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
// a skin made only for 4K (skin.ini saved as UTF-16, as Notepad does) plays other key counts through its 4 columns
const four = await page.evaluate(async () => {
  const png = async w => { const c = document.createElement('canvas'); c.width = w; c.height = 40; c.getContext('2d').fillRect(0, 0, w, 40); return new Uint8Array(await (await new Promise(r => c.toBlob(r))).arrayBuffer()); };
  const ini = '[General]\r\nName: Four Only\r\n[Mania]\r\nKeys: 4\r\nColumnStart: 200\r\nColumnWidth: 50,40,40,50\r\n' +
    [0, 1, 2, 3].map(i => `KeyImage${i}: k${i}\r\nNoteImage${i}: n${i}\r\n`).join('');
  const u16 = new Uint8Array(2 + ini.length * 2); u16[0] = 0xff; u16[1] = 0xfe;
  for (let i = 0; i < ini.length; i++) u16[2 + i * 2] = ini.charCodeAt(i);
  const files = [{ name: 'skin.ini', data: u16 }];
  for (let i = 0; i < 4; i++) { files.push({ name: `k${i}.png`, data: await png(10 + i) }); files.push({ name: `n${i}.png`, data: await png(20 + i) }); }
  const meta = await AshtonkMania.SkinManager.importOsk(new File([writeZip(files)], 'four-only.osk'));
  const s = AshtonkMania.SkinManager.instance(meta.id);
  const col = L => L.tex.key.map(t => t ? t.pw - 10 : -1).join('') + '/' + L.tex.note.map(t => t ? t.pw - 20 : -1).join('');
  const L7 = await s.mania(7), L5 = await s.mania(5), L2 = await s.mania(2);
  return { name: s.name, borrowed: s.borrowedKeys().join(','), c7: col(L7), c5: col(L5), c2: col(L2), from4K: L7.from4K, w7: L7.columnWidth.join(','),
    start7: L7.columnStart, centred: Math.abs((L7.columnStart + L7.columnWidth.reduce((a, b) => a + b, 0) / 2) - (200 + 90)) < 0.1 };
});
check('UTF-16 skin.ini is read', four.name === 'Four Only', JSON.stringify(four));
check('4K-only skin plays 7K as 1 2 1 2 4 3 4 and 5K as 1 2 1 3 4, centred where its 4K stage was',
  four.c7 === '0101323/0101323' && four.c5 === '01023/01023' && four.c2 === '03/03' && four.from4K && four.borrowed === '1,2,3,5,6,7,8,9,10' && four.centred, JSON.stringify(four));
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
// no screen may show a stray "null" / "undefined" / "NaN" (a native append() prints null children as text)
const junkText = () => page.evaluate(() => { const m = document.body.innerText.match(/\b(null|undefined|NaN)\b/); return m ? m[0] + ' … ' + document.body.innerText.slice(Math.max(0, m.index - 60), m.index + 20).replace(/\s+/g, ' ') : null; });
const junk = [];
for (const s of ['home', 'beatmaps', 'collections', 'profile', 'stats', 'replays', 'songselect', 'skins', 'multiplayer']) {
  await page.evaluate(n => AshtonkMania.Screens.go(n), s);
  await page.waitForTimeout(700);
  await shot('11-' + s);
  const j = await junkText(); if (j) junk.push(`${s}: ${j}`);
}
check('no screen shows stray "null" / "undefined" / "NaN" text', !junk.length, junk.join(' | '));
check('every key count 1K–18K has a full set of distinct default keys', await page.evaluate(() => {
  for (let k = 1; k <= 18; k++) {
    const codes = AshtonkMania.Settings.keybinds(k).map(c => c[0]);
    if (codes.length !== k || codes.some(c => !c) || new Set(codes).size !== k) return false;
  }
  return true;
}));
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
await page.evaluate(() => [...document.querySelectorAll('.mod-p')].find(b => b.textContent.includes('Invert')).click());
await page.waitForTimeout(150);
check('mod select: osu!lazer\'s Invert and No Release are there, and Invert rules out Hold Off / No Release', await page.evaluate(() => {
  const p = name => [...document.querySelectorAll('.mod-p')].find(b => b.textContent.includes(name));
  return !!p('No Release') && p('Invert').classList.contains('on') && p('Hold Off').classList.contains('blocked') && p('No Release').classList.contains('blocked');
}));
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
await context.setOffline(true);
await page.evaluate(() => AshtonkMania.ExplorerScreen.newSearch());
await page.waitForSelector('.ex-error .ex-retry', { timeout: 5000 });
check('explorer offline: says you\'re offline, with a Try again button', /You're offline/.test(await page.textContent('.ex-error')));
await context.setOffline(false);
await page.waitForSelector('.ex-card[data-id="777"]', { timeout: 5000 });
check('explorer: searches again by itself once back online', !(await page.$('.ex-error')));
check('explorer filters show no stray "null" text (More filters closed)', !(await page.$eval('.ex-filters', el => /\bnull\b/.test(el.innerText))));
await page.route('https://b.ppy.sh/**', r => r.abort());
await page.evaluate(() => { window.__card = document.querySelector('.ex-card[data-id="777"]'); });
await page.click('.ex-card[data-id="777"] .ex-play');
await page.waitForTimeout(300);
check('previewing a song keeps the list in place (no re-render / jump to top)', await page.evaluate(() => window.__card.isConnected && window.__card.querySelector('.ex-play').dataset.ic === 'pause'));
await page.click('.ex-card[data-id="777"] .ex-play');
await shot('11b-explorer');
check('beatmap cards have lazer\'s hover panel with like and download', await page.evaluate(() => !!document.querySelector('.ex-card[data-id="777"] .ex-side .like') && !!document.querySelector('.ex-card[data-id="777"] .ex-side .dl')));
// as in lazer: clicking the card opens the beatmap info page, and that's where it's downloaded
await page.click('.ex-card[data-id="777"] .ex-t');
await page.waitForSelector('.bso .bso-dl', { timeout: 5000 });
check('clicking a beatmap card opens the lazer beatmap info page (difficulties, details, download)', await page.evaluate(() => !!document.querySelector('.bso-diffs .bso-diff') && !!document.querySelector('.bso-card') && /Download/.test(document.querySelector('.bso-dl').textContent)));
await page.click('.bso .bso-dl');
await page.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length === 2, null, { timeout: 15000 });
check('explorer download imports the .osz into the library', true);
await page.waitForFunction(() => /Play/.test(document.querySelector('.bso-dl')?.textContent || ''), null, { timeout: 5000 });
check('once downloaded, the beatmap info page offers Play', true);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
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
  check('explorer: default is "Has leaderboard", newest ranked first, with no sort sent (osu!\'s default, like WOM)', order1 === '802,801,804' && p0.get('sort') === null && p0.get('status') === 'leaderboard', `${order1} ${p0}`);
  await page.click('.ex-chip:text-is("Title")');
  await page.waitForTimeout(300);
  const order2 = await page.$$eval('.ex-card', a => a.map(c => c.dataset.id).join(','));
  const s2 = seen[seen.length - 1].get('sort');
  await page.click('.ex-chip:text-matches("^Title")');
  await page.waitForTimeout(300);
  const order3 = await page.$$eval('.ex-card', a => a.map(c => c.dataset.id).join(','));
  check('explorer: a new sort starts descending (Z→A), clicking again flips it (as on WOM)', order2 === '804,801,802' && s2 === 'title_desc' && order3 === '802,801,804' && seen[seen.length - 1].get('sort') === 'title_asc', `${order2} / ${order3}`);
  // WOM's other filters: genre, language, explicit content (under "More filters"), key counts up to 18K, reset
  await page.click('.ex-chip:text-is("More filters")');
  await page.click('.ex-chip:text-is("Anime")'); await page.waitForTimeout(150);
  await page.click('.ex-chip:text-is("Japanese")'); await page.waitForTimeout(150);
  await page.click('.ex-chip:text-is("Hide")'); await page.waitForTimeout(150);
  await page.click('.ex-chip:text-is("18K")'); await page.waitForTimeout(300);
  const pf = seen[seen.length - 1];
  check('explorer: genre, language, explicit content and 18K are sent as osu! filters', pf.get('g') === '3' && pf.get('l') === '3' && pf.get('nsfw') === 'false' && pf.get('keys') === '18', String(pf));
  await page.click('.ex-reset'); await page.waitForTimeout(300);
  const pr = seen[seen.length - 1];
  check('explorer: "Reset filters" goes back to the defaults', !pr.get('g') && !pr.get('l') && !pr.get('nsfw') && !pr.get('keys') && !pr.get('sort') && !(await page.$('.ex-reset')), String(pr));
  await page.click('.ex-chip:text-is("Fewer filters")');
  await page.evaluate(() => { const st = AshtonkMania.ExplorerScreen.state; st.sort = 'ranked'; st.dir = 'desc'; });
}
await page.evaluate(async () => { const s = AshtonkMania.BeatmapManager.sets.find(x => x.maps.some(m => /^Online/.test(m.version))); if (s) await AshtonkMania.BeatmapManager.removeSet(s.id); });

// beatmap sources (Web-Osu-Mania's "Sources" settings)
const src = await page.evaluate(async () => {
  const S = AshtonkMania.Settings, O = AshtonkMania.OnlineBeatmaps;
  const def = { preview: O.previewURL(5), cover: O.coverURL(5, 'card@2x'), dl: O.downloadURLs(5, true) };
  await S.set('online.previewSource', 'beatconnect'); await S.set('online.coverSource', 'sayobot'); await S.set('online.downloadSource', 'sayobot');
  const alt = { preview: O.previewURL(5), cover: O.coverURL(5, 'card@2x'), dl: O.downloadURLs(5, true), direct: O.downloadURLs(5, false) };
  await S.set('online.downloadSource', 'custom'); await S.set('online.customDownload', 'https://example.org/d/$setId');
  const custom = O.downloadURLs(5, false)[0];
  for (const k of ['online.previewSource', 'online.coverSource', 'online.downloadSource', 'online.customDownload']) S.reset(k);
  return { def, alt, custom };
});
check('beatmap sources: official preview / cover by default, downloads through the server first', src.def.preview === 'https://b.ppy.sh/preview/5.mp3' && src.def.cover === 'https://assets.ppy.sh/beatmaps/5/covers/card@2x.jpg' && src.def.dl[0] === 'api/download/5', JSON.stringify(src.def));
check('beatmap sources: choosing Beatconnect / SayoBot / a custom URL changes where previews, covers and downloads come from',
  src.alt.preview === 'https://beatconnect.io/preview/5.mp3' && src.alt.cover === 'https://a.sayobot.cn/beatmaps/5/covers/cover.webp'
  && src.alt.dl[0] === 'api/download/5?provider=sayobot' && src.alt.direct[0].includes('dl.sayobot.cn') && src.custom === 'https://example.org/d/5', JSON.stringify(src));

// pp tracking
const ppInfo = await page.evaluate(() => ({ total: AshtonkMania.ScoreManager.totalPp().total, best: AshtonkMania.ScoreManager.bestPpPerMap().length }));
check('pp is tracked from passed scores', ppInfo.total > 0 && ppInfo.best >= 1, JSON.stringify(ppInfo));
// score display: classic ScoreV1 or osu!lazer standardised (every play records both)
{
  const sd = await page.evaluate(async () => {
    const A = AshtonkMania, SM = A.ScoreManager, S = A.Settings;
    const withStd = SM.scores.filter(s => s.scoreStd != null);
    const late = withStd.find(s => s.accuracy < 0.9);
    const hash = (late || withStd[0]).mapHash;
    const classic = SM.forMap(hash).map(s => s.score);
    await S.set('gameplay.scoring', 'standardised');
    const std = SM.forMap(hash).map(s => SM.value(s));
    const differs = late ? SM.value(late) !== late.score : true;
    A.Screens.go('songselect', { mapId: SM.forMap(hash)[0].mapId });
    await new Promise(r => setTimeout(r, 900));
    const shown = [...document.querySelectorAll('.lb-row .sc, .score-row .sc, .nums .sc')].map(e => e.textContent.replace(/\D/g, '')).filter(Boolean).map(Number);
    S.reset('gameplay.scoring');
    return { n: withStd.length, classicSorted: classic.every((v, i) => !i || classic[i - 1] >= v), stdSorted: std.every((v, i) => !i || std[i - 1] >= v), differs, shown, std };
  });
  check('every play records both scores; "Score display" switches leaderboards to osu!lazer standardised', sd.n >= 2 && sd.classicSorted && sd.stdSorted && sd.differs && sd.shown.length > 0 && sd.shown.every(v => sd.std.includes(v)), JSON.stringify(sd));
}

// persistence across reload
const before = await page.evaluate(() => ({ scores: AshtonkMania.ScoreManager.scores.length, sets: AshtonkMania.BeatmapManager.sets.length, fav: AshtonkMania.Favorites.set.size, skin: AshtonkMania.SkinManager.current.id, replays: AshtonkMania.ReplayManager.list.length }));
await page.reload();
await waitBoot();
const after = await page.evaluate(() => ({ scores: AshtonkMania.ScoreManager.scores.length, sets: AshtonkMania.BeatmapManager.sets.length, fav: AshtonkMania.Favorites.set.size, skin: AshtonkMania.SkinManager.current.id, replays: AshtonkMania.ReplayManager.list.length, speed: AshtonkMania.Settings.get('gameplay.scrollSpeed') }));
check('scores, beatmaps, favorites, replays and skin survive refresh', JSON.stringify({ ...after, speed: undefined }) === JSON.stringify({ ...before, speed: undefined }) && before.scores > 0, JSON.stringify(after));
check('settings survive refresh', after.speed === 27);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.keyboard.press('Shift+Slash'); await page.waitForTimeout(300);
check('? opens the keyboard shortcuts list (every screen\'s keys in one place)', await page.evaluate(() => document.querySelectorAll('.shortcuts .sc-group').length >= 6 && /Retry/.test(document.querySelector('.shortcuts').textContent)));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
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
  await page.waitForTimeout(300);
  check('HUD score and accuracy use the skin\'s number font (Kori)', await page.evaluate(() => !!document.querySelector('.hud-score .sc canvas.skin-digits') && !!document.querySelector('.hud-score .acc canvas.skin-digits')));
  check('Hidden covers long notes band by band (the covered part of the lane hides hold bodies)', await page.evaluate(() => {
    const b = AshtonkMania.GameplayScreen.renderer._coverBands('HD'), f = AshtonkMania.GameplayScreen.renderer._coverBands('FI');
    return b[0][2] === 1 && b[b.length - 1][2] < 0.1 && f[0][2] < 0.1 && f[f.length - 1][2] === 1 && b.every(x => x[1] > x[0]);
  }));
  check('Space starts from the loader; the beatmap offset is applied', await page.evaluate(() => AshtonkMania.GameplayScreen.s.mapOffset === 20 && AshtonkMania.GameplayScreen.offsetMs() === AshtonkMania.Settings.get('audio.offset') + 20));
  check('automatic resolution: two slow 2-second windows lower the playfield resolution by 10% and remember it', await page.evaluate(() => {
    const G = AshtonkMania.GameplayScreen, S = AshtonkMania.Settings, r0 = G.renderer.autoScale, w0 = G.renderer.canvas.width;
    let t = performance.now();
    for (let i = 0; i < 300; i++) { t += 30; G.adaptResolution(30, t, 0); } // ~33 fps for 9 s
    const r1 = G.renderer.autoScale, w1 = G.renderer.canvas.width, saved = S.get('perf.autoScale');
    G._as.scale = 1; G.renderer.autoScale = 1; G.renderer.resize(true); S.set('perf.autoScale', 1);
    return r0 === 1 && r1 < 0.95 && r1 >= 0.6 && w1 < w0 && saved === r1;
  }));
  await page.keyboard.down('KeyR'); await page.waitForTimeout(120); await page.keyboard.up('KeyR'); await page.waitForTimeout(600);
  check('a quick tap of R does not retry (you have to hold it)', await page.evaluate(() => !AshtonkMania.GameplayScreen.retryCount && AshtonkMania.GameplayScreen.loaderGone));
  await page.keyboard.down('KeyR'); await page.waitForTimeout(700); await page.keyboard.up('KeyR');
  await page.waitForTimeout(250);
  check('holding R retries', await page.evaluate(() => AshtonkMania.GameplayScreen.retryCount === 1 && !!document.querySelector('.gp-loader')));
  await page.waitForFunction(() => AshtonkMania.GameplayScreen.loaderGone && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 8000 });
  await page.keyboard.down('Backquote'); await page.waitForTimeout(250);
  const holding = await page.evaluate(() => document.querySelector('.hold-retry').classList.contains('on') && !!AshtonkMania.GameplayScreen.s);
  await page.waitForTimeout(450); await page.keyboard.up('Backquote');
  await page.waitForTimeout(250);
  check('holding ` shows the retry bar, then retries (with a retry counter)', holding && await page.evaluate(() => AshtonkMania.GameplayScreen.retryCount === 2 && !!document.querySelector('.gp-loader .pl-tag.retry')));
  await page.waitForFunction(() => AshtonkMania.GameplayScreen.loaderGone && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 8000 });
  check('osu!lazer-style health bar in the top left (the stand-in skin has no scorebar of its own)', await page.evaluate(() => { const b = document.querySelector('.hud-hp'); return !!b && AshtonkMania.GameplayScreen.healthMode === 'lazer' && AshtonkMania.GameplayScreen.renderer.healthMode === null && !document.querySelector('.hud-skinhp') && b.getBoundingClientRect().top < 60 && +b.style.getPropertyValue('--hp') > 0; }));
  const hpStyles = await page.evaluate(async () => {
    const A = AshtonkMania, S = A.Settings, f = A.healthModeFor;
    const meta = A.SkinManager.skins.find(m => /Kori 3\.0$/.test(A.SkinManager.instance(m.id).name)); if (!meta) return { names: A.SkinManager.skins.map(m => A.SkinManager.instance(m.id).name), bar: [], modes: [] };
    const K = await A.SkinManager.instance(meta.id).mania(4), bare = await A.SkinManager.current.mania(4);
    const bar = new A.SkinHealthBar(K); document.body.append(bar.el); bar.update(0.5, performance.now()); bar.update(0.5, performance.now() + 400);
    const r = { bar: [bar.el.width > 100, bar.el.height > 10, Math.abs(bar.shown - 0.5) < 0.01, !!K.tex.scorebarBg] };
    bar.el.remove();
    r.modes = [f(K), f(bare)];
    await S.set('gameplay.healthStyle', 'skin'); r.modes.push(f(K), f(bare));
    await S.set('gameplay.healthStyle', 'stage'); r.modes.push(f(K));
    await S.set('gameplay.healthStyle', 'lazer'); r.modes.push(f(K));
    await S.set('gameplay.showHealth', false); r.modes.push(f(K));
    S.reset('gameplay.healthStyle'); S.reset('gameplay.showHealth');
    return r;
  });
  check('the bundled Kori uses its own health bar (scorebar images), eased like osu!lazer', hpStyles.bar.every(Boolean) && hpStyles.modes[0] === 'skinstage', JSON.stringify(hpStyles));
  check('health bar styles: skin beside the stage (default, as in osu!mania) / skin top-left / osu!lazer / slim; skins without a scorebar fall back to osu!lazer', hpStyles.modes.join() === 'skinstage,lazer,skin,lazer,stage,lazer,', JSON.stringify(hpStyles.modes));
  check('older installs of the bundled Kori get its health bar images once (upgrade)', await page.evaluate(async () => {
    const A = AshtonkMania, SM = A.SkinManager, meta = SM.skins.find(m => /Kori 3\.0$/.test(m.name));
    meta.files = meta.files.filter(f => !/^scorebar-/i.test(f)); await A.DB.put('skins', meta);
    await A.DB.kvSet('bundled.kori.v', 1);
    const gone = !(await SM.instance(meta.id).mania(4)).tex.scorebarColour;
    await A.App.upgradeBundledSkin();
    const m2 = SM.skins.find(m => m.id === meta.id);
    return gone && m2.files.includes('scorebar-colour.png') && !!(await SM.instance(meta.id).mania(4)).tex.scorebarColour && (await A.DB.kvGet('bundled.kori.v', 1)) >= 2;
  }));
  check('in-game leaderboard on the left with your live row', await page.evaluate(() => { const b = document.querySelector('.hud-lb'); return !!b && !b.classList.contains('lb-off') && !!b.querySelector('.hud-mp-row.me') && b.getBoundingClientRect().left < innerWidth / 3; }));
  await page.keyboard.press('Tab'); await page.waitForTimeout(100);
  const lbOff = await page.evaluate(() => document.querySelector('.hud-lb').classList.contains('lb-off') && AshtonkMania.Settings.get('gameplay.leaderboard') === false);
  await page.keyboard.press('Tab'); await page.waitForTimeout(100);
  check('Tab hides and shows the leaderboard (remembered)', lbOff && await page.evaluate(() => !document.querySelector('.hud-lb').classList.contains('lb-off') && AshtonkMania.Settings.get('gameplay.leaderboard') === true));
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
  // the UI fits a 1366×768 layout to the real (unzoomed) 1600×900 window, whatever the browser zoom
  const fit = Math.min(1600 / 1366, 900 / 768);
  check('browser zoom is compensated and the UI scales with the window (1366×768 reference, 90% by default)', z.cls && Math.abs(z.zoom - 1.25 / (fit * 0.9)) < 1e-6 && Math.abs(z.w - 1280) < 2 && Math.abs(z.h - 720) < 2 && Math.abs(z.tb - 40 * fit * 0.9 / 1.25) < 0.5, JSON.stringify(z));
  // zooming the browser afterwards (devicePixelRatio 1.25 → 1.5, window unchanged) is followed exactly
  const zz = await zp.evaluate(() => { Object.defineProperty(window, 'devicePixelRatio', { get: () => 1.5, configurable: true }); AshtonkMania.Zoom.update(); return AshtonkMania.Zoom.detect(); });
  check('a later browser zoom change is detected from devicePixelRatio', Math.abs(zz - 1.5) < 1e-6, String(zz));
  await zp.evaluate(() => { Object.defineProperty(window, 'devicePixelRatio', { get: () => 1.25, configurable: true }); AshtonkMania.Zoom.update(); });
  const z2 = await zp.evaluate(async () => { AshtonkMania.Settings.set('ui.scale', 1.2); await new Promise(r => setTimeout(r, 50)); const t = document.querySelector('#toolbar').getBoundingClientRect().height; AshtonkMania.Settings.set('ui.scale', 1); return t; });
  check('UI scaling scales everything (toolbar 20% taller at 120%)', Math.abs(z2 - 40 * fit / 1.25 * 1.2) < 0.5, String(z2));
  const prevented = await zp.evaluate(() => { const e = new KeyboardEvent('keydown', { code: 'Equal', key: '=', ctrlKey: true, cancelable: true, bubbles: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  check('Ctrl + / Ctrl - zoom shortcuts are blocked', prevented);
  await zctx.close();
}

// installable app: manifest + icons, and once opened it loads and plays offline (service worker)
{
  const octx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const op = await octx.newPage();
  const oErr = [];
  op.on('pageerror', e => oErr.push(e.message));
  await op.goto(url);
  await op.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  const man = await op.evaluate(async () => {
    const m = await (await fetch(document.querySelector('link[rel=manifest]').href)).json();
    const icons = await Promise.all(m.icons.map(async i => { const r = await fetch(i.src); return r.ok && (await r.blob()).size > 1000; }));
    return { name: m.name, display: m.display, start: m.start_url, icons: icons.every(Boolean) && m.icons.some(i => i.purpose === 'maskable') && m.icons.some(i => i.sizes === '512x512'), files: !!(m.file_handlers && m.file_handlers[0].accept) };
  });
  check('installable: a web app manifest with name, full-screen display, icons (incl. maskable) and .osz/.osk file handling', man.name === 'Ashtonk!mania' && man.display === 'fullscreen' && man.icons && man.files, JSON.stringify(man));
  await op.evaluate(() => navigator.serviceWorker.ready);
  await op.reload();
  await op.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  check('a service worker controls the page after the first visit', await op.evaluate(() => !!navigator.serviceWorker.controller));
  if (await op.$('.onboarding')) { await op.fill('.onboarding .ob-name', 'Offline'); await op.keyboard.press('Enter'); await op.waitForSelector('.setup-step-wom'); await op.evaluate(() => AshtonkMania.Onboarding.finish()); await op.waitForTimeout(300); }
  await op.evaluate(async () => { const b = await (await fetch('/tests/fixtures/test-set.osz')).blob(); await AshtonkMania.App.importFiles([new File([b], 'test-set.osz')]); });
  await octx.setOffline(true);
  await op.reload();
  await op.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  check('offline: the game still opens with your library (served by the service worker)', await op.evaluate(() => AshtonkMania.BeatmapManager.sets.length === 1 && !navigator.onLine && ['home', 'songselect'].includes(AshtonkMania.Screens.currentName)));
  await op.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.Screens.go('gameplay', { mapId: m.id, mods: ['AT'], force: true }); });
  await op.waitForFunction(() => AshtonkMania.GameplayScreen.loaderGone && AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 20000 });
  check('offline: beatmaps play', await op.waitForFunction(() => AshtonkMania.GameplayScreen.s.engine.score.judged > 0, null, { timeout: 15000 }).then(() => true, () => false));
  check('offline: no page errors', oErr.length === 0, oErr.join(' | '));
  await octx.setOffline(false);
  await octx.close();
}

// storage blocked (IndexedDB refuses to open): the game still boots, says so, and works for the session
{
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await bctx.addInitScript(() => { IDBFactory.prototype.open = function () { throw new DOMException('The user denied permission to access the database.', 'SecurityError'); }; });
  const bp = await bctx.newPage();
  const bErr = [];
  bp.on('pageerror', e => bErr.push(e.message));
  await bp.goto(url);
  await bp.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await bp.waitForTimeout(300);
  if (await bp.$('.onboarding')) { await bp.fill('.onboarding .ob-name', 'Guest'); await bp.keyboard.press('Enter'); await bp.waitForSelector('.setup-step-wom'); await bp.evaluate(() => AshtonkMania.Onboarding.finish()); await bp.waitForTimeout(400); }
  const toastText = await bp.$$eval('.toast', a => a.map(t => t.textContent).join(' | '));
  check('storage blocked: the game still boots and says nothing will be saved', await bp.evaluate(() => !!AshtonkMania.DB.memory && AshtonkMania.Screens.currentName === 'home') && /Storage is blocked/.test(toastText), toastText);
  await bp.evaluate(() => AshtonkMania.Screens.go('songselect')); await bp.waitForSelector('.ss-browse');
  await bp.click('.ss-browse'); await bp.waitForTimeout(400);
  check('an empty library offers "Browse beatmaps online" (the Beatmap Explorer)', await bp.evaluate(() => AshtonkMania.Screens.currentName === 'explore'));
  await bp.evaluate(() => AshtonkMania.Screens.go('home')); await bp.waitForTimeout(300);
  await bp.evaluate(async () => {
    const dt = new DataTransfer(), b = await (await fetch('/tests/fixtures/test-set.osz')).blob(); dt.items.add(new File([b], 'test-set.osz'));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
  });
  await bp.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length === 1, null, { timeout: 15000 });
  const memOk = await bp.evaluate(async () => { const A = AshtonkMania; await A.Settings.set('gameplay.scrollSpeed', 31); await A.Settings.flush(); return (await A.DB.kvGet('settings', {}))['gameplay.scrollSpeed'] === 31 && (await A.DB.getAll('maps')).length === 4; });
  check('storage blocked: beatmaps import and settings work in memory for the session', memOk);
  const msgs = await bp.evaluate(() => { const f = AshtonkMania.friendlyError; return [f(new DOMException('x', 'QuotaExceededError')), f(new TypeError('Failed to fetch')), f(new DOMException('Unable to decode audio data', 'EncodingError'))]; });
  check('error messages people can act on (storage full, network, audio)', /storage is full/i.test(msgs[0]) && /reach the server|offline/i.test(msgs[1]) && /decode/i.test(msgs[2]), msgs.join(' / '));
  await bp.evaluate(() => { setTimeout(() => { throw new Error('boom from a test'); }); });
  await bp.waitForTimeout(300);
  check('an unexpected error is reported to the player instead of failing silently', await bp.$$eval('.toast', a => a.some(t => /Something went wrong/.test(t.textContent) && /boom from a test/.test(t.textContent))));
  check('storage blocked: no other page errors', bErr.filter(m => !/boom from a test/.test(m)).length === 0, bErr.join(' | '));
  await bctx.close();
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
  await sp.waitForSelector('.setup-step-wom');
  check('setup: no skipping — after the name it asks about Web-Osu-Mania (yes / no)', !(await sp.$('.ob-skip')) && (await sp.$$('.setup-step-wom .setup-choice')).length === 2);
  await sp.click('.setup-choice[data-id="no"]');
  await sp.waitForSelector('.setup-step-device');
  check('setup: device step is just PC or Chromebook', (await sp.$$('.setup-step-device .setup-choice')).length === 2 && !(await sp.$('.setup-detect')));
  await sp.click('.setup-choice[data-id="chromebook"]');
  await sp.waitForSelector('.setup-step-look', { timeout: 3000 });
  check('setup: Chromebook turns on performance mode (keeping the menu blur, which is baked in) and moves on', await sp.evaluate(() => AshtonkMania.Settings.get('graphics.performanceMode') === true && AshtonkMania.Settings.get('graphics.particles') === false && AshtonkMania.Settings.get('graphics.menuBlur') === 12));
  check('setup: no colour question (as in lazer); size is a slider', !(await sp.$('.setup-swatch')) && !!(await sp.$('.setup-step-look input.slider')));
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
  check('setup: skins are Kori / Chemuss / Custom / Import; Custom has shape and colour options', /^Kori,(Chemuss mixed edit,)?Custom,.*Import a skin$/.test(skinNames) && await sp.evaluate(() => AshtonkMania.SkinManager.current.id === 'default' && AshtonkMania.Settings.get('skin.noteStyle') === 'arrows' && AshtonkMania.Settings.get('skin.hue') >= 0), skinNames);
  await sp.click('.setup-next'); await sp.waitForTimeout(600);
  check('setup: Finish closes it and lands on the main menu', !(await sp.$('.setup')) && await sp.evaluate(() => AshtonkMania.Screens.currentName === 'home' && AshtonkMania.ProfileManager.profile.onboarded && AshtonkMania.ProfileManager.profile.name === 'Newbie'));
  await sp.waitForFunction(() => { const i = document.querySelector('.home .neru:not([hidden]) img'); return i && /neru\.png$/.test(i.src); }, null, { timeout: 5000 });
  await sp.waitForTimeout(300);
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
  await sp.click('.av-tile >> nth=1'); await sp.waitForTimeout(400);
  check('the bundled Teto / Neru / Miku profile pictures can be picked', tiles.startsWith('Teto,Neru,Miku') && await sp.evaluate(() => AshtonkMania.ProfileManager.profile.avatar === 'preset:neru' && AshtonkMania.ProfileManager.avatarURL === 'avatars/neru.jpg' && !!document.querySelector('#toolbar .avatar').style.backgroundImage), tiles);
  check('a drawn preset saved by an older version shows that character\'s picture', await sp.evaluate(() => AshtonkMania.AvatarPresets.url('teto-2') === 'avatars/teto.jpg'));
  await sp.evaluate(() => AshtonkMania.Screens.go('home')); await sp.waitForTimeout(400);
  check('no FPS box in the corner when the FPS counter is off', await sp.evaluate(() => getComputedStyle(document.querySelector('#fps-counter')).display === 'none'));
  await sp.reload();
  await sp.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await sp.waitForTimeout(600);
  check('setup: choices persist and the wizard does not return', !(await sp.$('.setup')) && await sp.evaluate(() => AshtonkMania.Settings.get('graphics.performanceMode') === true));
  await sctx.close();
}

{
  // a Web-Osu-Mania backup, imported from the first-run setup: beatmaps, settings, keybinds, scores and collections
  const wctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const wp = await wctx.newPage();
  wp.on('pageerror', e => errors.push('wom: ' + e.message));
  // the backup's collection also holds a set that isn't in it (999): the import downloads it
  await wp.route('**/api/health', r => r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  await wp.route('**/api/download/**', r => r.fulfill({ contentType: 'application/octet-stream', body: readFileSync(join(root, 'tests', 'fixtures', 'test-set.osz')) }));
  await wp.goto(url);
  await wp.waitForSelector('.setup-step-welcome', { timeout: 30000 });
  await wp.fill('.ob-name', 'Kiwi'); await wp.keyboard.press('Enter');
  await wp.waitForSelector('.setup-step-wom');
  await wp.click('.setup-choice[data-id="yes"]');
  await wp.waitForSelector('.setup-step-wom .setup-wom-btn');
  check('setup: "Yes" explains where Web-Osu-Mania keeps its backup (Settings → Backup & Restore)', /Backup & Restore/.test(await wp.textContent('.setup-wom')));
  const [chooser] = await Promise.all([wp.waitForEvent('filechooser'), wp.click('.setup-wom-btn')]);
  await chooser.setFiles(join(root, 'tests', 'fixtures', 'wom-backup.zip'));
  await wp.waitForFunction(() => /Imported/.test(document.querySelector('.setup-wom')?.textContent || ''), null, { timeout: 20000 });
  const w = await wp.evaluate(async () => {
    const S = AshtonkMania.Settings, sc = AshtonkMania.ScoreManager.scores.find(s => s.imported === 'wom');
    return { text: document.querySelector('.setup-wom').textContent, sets: AshtonkMania.BeatmapManager.sets.filter(s => s.onlineId === 424242).length,
      vol: S.get('audio.master'), speed: S.get('gameplay.scrollSpeed'), dir: S.get('gameplay.scrollDirection'), off: S.get('audio.offset'), k4: S.get('input.keybinds')[4],
      score: sc && { v: sc.version, mods: sc.mods, rate: sc.rate, acc: sc.accuracy, grade: sc.grade, counts: sc.counts, n: AshtonkMania.ScoreManager.scores.length },
      col: (await AshtonkMania.DB.kvGet('collections')).find(c => c.name === 'WOM favourites'), downloaded: AshtonkMania.BeatmapManager.sets.filter(s => s.onlineId === 999).length };
  });
  check('Web-Osu-Mania backup: its stored beatmaps are imported', w.sets === 1, JSON.stringify(w));
  check('Web-Osu-Mania backup: settings and keybinds carry over', w.vol === 0.6 && w.speed === 27 && w.dir === 'up' && w.off === 12 && JSON.stringify(w.k4) === JSON.stringify([['KeyA', 'KeyZ'], ['KeyS'], ['KeyK'], ['KeyL']]), JSON.stringify(w));
  check('Web-Osu-Mania backup: high scores land on the right difficulty (mods, rate, judgements); ones for missing maps are left out', w.score && w.score.v === 'Online Hard' && w.score.mods.join() === 'DT,MR' && w.score.rate === 1.5 && w.score.counts.join() === '300,40,5,2,1,3' && w.score.n === 1, JSON.stringify(w.score));
  check('Web-Osu-Mania backup: collection songs missing from the backup are downloaded, and the collection holds them all', w.col && w.col.hashes.length > 2 && w.downloaded === 1, JSON.stringify({ col: w.col && w.col.hashes.length, dl: w.downloaded }));
  check('the setup screen says what came across', /2 beatmap sets \(1 downloaded for your collections\), 1 score, 1 collection, settings and keybinds/.test(w.text), w.text);
  await wctx.close();
}

// random (F2) picks another beatmap set; Shift+F2 goes back to where you were (lazer's rewind)
await page.evaluate(() => AshtonkMania.Screens.go('songselect', { force: true })); await page.waitForTimeout(700);
const rnd = await page.evaluate(async () => {
  const S = AshtonkMania.SongSelect, BM = AshtonkMania.BeatmapManager, before = S.selectedId;
  S.random(); await new Promise(r => setTimeout(r, 200));
  const picked = S.selectedId, otherSet = BM.maps.get(picked).setId !== BM.maps.get(before).setId;
  S.randomRewind(); await new Promise(r => setTimeout(r, 200));
  return { otherSet, back: S.selectedId === before, sets: BM.sets.length };
});
check('random picks a different beatmap set, and Shift+F2 rewinds to the previous one', (rnd.sets < 2 || rnd.otherSet) && rnd.back, JSON.stringify(rnd));

// song select: clicking a difficulty must not slide the whole list sideways (the panels run past the right edge)
await page.evaluate(() => AshtonkMania.Screens.go('songselect', { force: true })); await page.waitForTimeout(900);
await page.click('.diff-panel >> nth=1'); await page.waitForTimeout(500);
check('song select: clicking a difficulty keeps the list in place (no sideways scroll)', await page.evaluate(() => document.querySelector('.carousel-scroll').scrollLeft === 0));

// settings: typing goes straight into its search box (as in lazer), not to the screen behind
await page.evaluate(() => { AshtonkMania.Screens.go('songselect', { force: true }); });
await page.waitForTimeout(600);
await page.evaluate(() => AshtonkMania.SettingsPanel.open()); await page.waitForTimeout(400);
await page.keyboard.type('dim'); await page.waitForTimeout(200);
const typed = await page.evaluate(() => ({ sp: document.querySelector('.sp-search').value, ss: document.querySelector('input[aria-label="Search beatmaps"]').value, rows: document.querySelectorAll('.settings-panel .sp-section').length }));
check('settings: typing right after opening searches the settings', typed.sp === 'dim' && typed.ss === '' && typed.rows >= 1, JSON.stringify(typed));
await page.keyboard.press('Escape'); await page.waitForTimeout(400);

// the same toast again refreshes the one on screen instead of stacking copies
const dupToasts = await page.evaluate(() => { const T = AshtonkMania.Toast; T.clear(); for (let i = 0; i < 4; i++) T.err('Same thing', 'again'); T.ok('Something else'); return document.querySelectorAll('#toasts .toast:not(.out)').length; });
check('identical toasts don\'t stack', dupToasts === 2, String(dupToasts));

const realErrors = errors.filter(e => !/favicon|fonts\.g|ERR_CERT|ERR_NAME|ERR_INTERNET|ERR_FAILED|status of 404/.test(e));
check('no uncaught page errors', realErrors.length === 0, realErrors.slice(0, 8).join('\n'));
await browser.close();
server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
