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
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' }[extname(file)] || 'application/octet-stream' });
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
page.on('console', m => { if (m.type() === 'error' && !/status of (502|429)/.test(m.text())) errors.push('console: ' + m.text()); }); // (the explorer's mocked server failures)
const shot = async name => { if (SHOTS) await page.screenshot({ path: join(shotDir, name + '.png') }); };
const waitBoot = async () => {
  await page.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await page.waitForTimeout(400);
  if (await page.$('.onboarding')) {
    await page.fill('.onboarding .ob-name', 'Tester'); await page.keyboard.press('Enter');
    await page.waitForSelector('.setup-step-wom'); await page.evaluate(() => AshtonkMania.Onboarding.finish()); await page.waitForTimeout(400);
  }
  // (every medal already earned: their pop-ups would cover what the tests click; the medal test resets them)
  await page.evaluate(() => AshtonkMania.Settings.set('medals.unlocked', Object.fromEntries(AshtonkMania.Medals.all.map(m => [m.id, 1]))));
};

await page.goto(url);
await waitBoot();
check('boots to home screen', await page.evaluate(() => AshtonkMania.Screens.currentName === 'home'));
check('first launch asks for a name', await page.evaluate(() => AshtonkMania.ProfileManager.profile.name === 'Tester' && AshtonkMania.ProfileManager.profile.onboarded));
check('Kori 3.0 is preinstalled and selected', await page.evaluate(() => /Kori 3\.0/.test(AshtonkMania.SkinManager.current.name)), await page.evaluate(() => AshtonkMania.SkinManager.current.name));
await page.waitForTimeout(1500);
check('Chemuss no longer comes with the game (only Kori is installed)', await page.evaluate(() => !AshtonkMania.SkinManager.skins.some(s => /chemuss/i.test(s.name))));
{
  // the skin-parsing checks still run on Chemuss, imported like any player's .osk
  const osk = readFileSync(new URL('./fixtures/chemuss.osk', import.meta.url)).toString('base64');
  const ch = await page.evaluate(async b64 => {
    const A = AshtonkMania, SM = A.SkinManager;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), cur = SM.current.id;
    await SM.importOsk(new File([bytes], 'chemuss.osk'));
    if (SM.current.id !== cur) await SM.select(cur, { silent: true });
    const meta = SM.skins.find(s => /chemuss/i.test(s.name));
    if (!meta) return { missing: true };
    const sk = SM.instance(meta.id), L = await sk.mania(4);
    // where the orb's centre is at the moment it's hit vs the centre of the ring receptor (ring spans 2–217 of the
    // 325-px key image, drawn at its own height from the bottom), in osu!'s 480-unit space
    const k = L.tex.key[0], n = L.tex.note[0], noteH = L.columnWidth[0] * n.h / n.w;
    const keyH = k.h / 1.6, ringC = 480 - keyH + keyH * (109.5 / 325), noteC = L.hitPosition - noteH / 2;
    const out = { name: sk.name, col: L.columnWidth.join(), lines: L.columnLineWidth.join(), hit: L.hitPosition, note: n && n.w, light: !!L.tex.lightingN, max: L.judgement['300g'] && L.judgement['300g'].w, body: L.tex.noteL[0] && L.tex.noteL[0].frames[0].height, off: +(noteC - ringC).toFixed(2) };
    await SM.remove(meta.id);
    return out;
  }, osk);
  check('Chemuss 4K: its complete [Mania] section wins, repeated lists fill in, "null" hides lighting, giant textures are capped',
    ch.col === '70,70,70,70' && ch.lines === '0,0,0,0,0' && ch.note === 150 && ch.light === false && ch.max === 1 && ch.body === 8192, JSON.stringify(ch));
  check('Chemuss 4K: notes are hit centred on the ring receptors (hit position 448)', ch.hit === 448 && Math.abs(ch.off) < 1.5, JSON.stringify({ hit: ch.hit, offsetUnits: ch.off }));
}
check('branding is Ashtonk!mania', await page.evaluate(() => document.title === 'Ashtonk!mania' && document.querySelector('.lz-cookie-text').textContent.includes('ashtonk')));
check('osu!lazer toolbar: icon buttons (beatmap listing, notifications), no text tabs and no Discover', await page.evaluate(() => !document.querySelector('#toolbar [data-tab="songselect"]') && !!document.querySelector('#toolbar [data-tab="explore"]') && !document.querySelector('#toolbar [data-tab="discover"]') && !!document.querySelector('#toolbar [data-ov="notifications"]') && !!document.querySelector('#toolbar .tb-music') && !!document.querySelector('#toolbar .tb-clock')));
check('toolbar clock cycles like lazer: full → digital with time running → digital → analog', await page.evaluate(() => { const c = document.querySelector('.tb-clock'), seen = [c.dataset.mode]; for (let i = 0; i < 4; i++) { document.querySelector('.tb-clock').click(); seen.push(document.querySelector('.tb-clock').dataset.mode); } return seen.join(',') === 'full,runtime,digital,analog,full'; }));
check('mouse wheel on the main menu changes the volume (lazer volume overlay)', await page.evaluate(async () => {
  AshtonkMania.Screens.go('home'); await new Promise(r => setTimeout(r, 300));
  const s = AshtonkMania.Settings, before = s.get('audio.master');
  document.querySelector('.lz-stage').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
  const up = s.get('audio.master'); s.set('audio.master', before);
  return Math.abs(up - Math.min(1, before + 0.05)) < 1e-6 && document.querySelector('.volume-overlay.show') !== null;
}));
check('KPS counter and hit error bar removed (the judgement counter is back, off by default)', await page.evaluate(() => ['gameplay.kpsCounter', 'gameplay.hitErrorBar', 'gameplay.errorBarScale'].every(k => !AshtonkMania.Settings.schema.has(k)) && AshtonkMania.Settings.schema.get('gameplay.judgementCounter').d === false && !document.querySelector('.hud-kps')));
check('touch controls, hitsounds and the old Neru easter-egg settings removed', await page.evaluate(() => !AshtonkMania.Settings.schema.has('input.touch') && !AshtonkMania.Settings.schema.has('audio.hitsounds') && !AshtonkMania.Settings.schema.has('gameplay.neruSparkle') && typeof window.LOADING_NERU === 'undefined'));
await page.mouse.click(700, 450); await page.waitForTimeout(500);
check('main menu opens the lazer button bar (no footer panels)', await page.evaluate(() => document.querySelector('.lz-menu').dataset.state === 'top' && document.querySelectorAll('.lz-btn.exp').length === 4 && document.querySelector('#app:not(.hide-toolbar)') && !document.querySelector('.continue, .lz-footer')));
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
check('each difficulty shows its own background and plays its own song file (song select, low-quality gameplay copy)', await page.evaluate(async () => {
  const { SongSelect: S, BeatmapManager: B, Background } = AshtonkMania, set = B.setById.get(B.maps.get(S.selectedId).setId), was = S.selectedId;
  const ex = set.maps.find(m => m.keys === 9), other = set.maps.find(m => m.keys === 4);
  const wait = async url => { for (let i = 0; i < 40 && Background.current !== url; i++) await new Promise(r => setTimeout(r, 50)); return Background.current === url; };
  const exUrl = await B.bgURL(ex), otherUrl = await B.bgURL(other);
  const waitKey = async f => { for (let i = 0; i < 60 && !(A.Music.key || '').endsWith(f); i++) await new Promise(r => setTimeout(r, 50)); return (A.Music.key || '').endsWith(f); };
  const A = AshtonkMania;
  S.select(ex.id); const a = await wait(exUrl) && await waitKey('expert.wav');
  S.select(other.id); const b = await wait(otherUrl) && await waitKey('audio.wav');
  const [t1, t2] = await Promise.all([B.bgThumbURL(ex), B.bgThumbURL(other)]);
  S.select(was);
  return ex.bgFile === 'expert.png' && exUrl !== otherUrl && a && b && t1 && t2 && t1 !== t2;
}));
await shot('02-songselect');

// lazer's Beatmap skins: a beatmap carrying its own skin pictures (here a red mania-note1.png) plays with them over
// your skin's — only those pictures, not @2x copies, and not when the setting is off
{
  const r = await page.evaluate(async () => {
    const A = AshtonkMania, zr = new ZipReader(await (await fetch('/tests/fixtures/test-set.osz')).arrayBuffer());
    const files = [];
    for (const e of zr.entries) files.push({ name: e.name, data: new Uint8Array(await zr.read(e)) });
    const c = document.createElement('canvas'); c.width = 64; c.height = 16; const x = c.getContext('2d'); x.fillStyle = '#f00'; x.fillRect(0, 0, 64, 16);
    const png = new Uint8Array(await (await new Promise(res => c.toBlob(res))).arrayBuffer());
    files.push({ name: 'mania-note1.png', data: png }, { name: 'mania-note1@2x.png', data: png });
    await A.App.importFiles([new File([writeZip(files)], 'bmskin.osz')]);
    const set = A.BeatmapManager.sets[0], base = A.SkinManager.current;
    const kept = Object.keys(set.fileIndex).filter(f => /^mania-/.test(f));
    const wrap = A.SkinManager.forBeatmap(base, set);
    const own = await wrap.texture('mania-note1'), other = await wrap.texture('mania-key1'), baseOther = await base.texture('mania-key1');
    const baseNote = await base.texture('mania-note1');
    return { sets: A.BeatmapManager.sets.length, kept, has: BeatmapSkin.has(set), own: own && own.w, other: other === baseOther, baseNote: baseNote ? baseNote.w : null, setting: A.Settings.get('skin.beatmapSkins') };
  });
  check('beatmap skins: a beatmap\'s own skin pictures are kept and used over your skin\'s (not @2x copies), the rest still comes from your skin',
    r.sets === 1 && r.kept.join() === 'mania-note1.png' && r.has && r.own === 64 && r.other && r.baseNote !== 64 && r.setting === true, JSON.stringify(r));
}

// an .osz / .zip with the song folder inside it: the .osu files' audio and background are found next to them
{
  const r = await page.evaluate(async () => {
    const A = AshtonkMania, zr = new ZipReader(await (await fetch('/tests/fixtures/test-set.osz')).arrayBuffer());
    const files = [];
    for (const e of zr.entries) files.push({ name: 'Songs/123 The Test Suite - Ashtonk Test Anthem/' + e.name, data: new Uint8Array(await zr.read(e)) });
    await A.App.importFiles([new File([writeZip(files)], 'folder inside.zip')]);
    return { sets: A.BeatmapManager.sets.length, warnings: A.App.lastReport.warnings, errors: A.App.lastReport.errors };
  });
  check('import: an archive with the song folder inside it finds each difficulty\'s audio (only the broken one is reported)',
    r.sets === 1 && !r.errors.length && r.warnings.length === 1 && /missing\.mp3/.test(r.warnings[0]), JSON.stringify(r));
}

// corrupt / unplayable archives
await dropFiles(['corrupt.osz', 'taiko.osz']);
await page.waitForTimeout(1500);
const rep = await page.evaluate(() => AshtonkMania.App.lastReport);
check('corrupt archive reported', rep.errors.some(e => /corrupt\.osz/.test(e)), rep.errors.join(' | '));
check('an osu!taiko archive is rejected (nothing unplayable is added)', rep.errors.some(e => /no playable difficulties/.test(e)) && !(await page.evaluate(() => AshtonkMania.BeatmapManager.sets.some(s => /Taiko/.test(s.title)))), rep.errors.join(' | '));
// an osu! (standard) map plays converted, as lazer converts it; song select's "Show converted beatmaps" hides it
await dropFiles(['standard.osz']);
await page.waitForFunction(() => AshtonkMania.BeatmapManager.sets.some(s => /Standard/.test(s.title)), null, { timeout: 15000 });
{
  const r = await page.evaluate(async () => {
    const A = AshtonkMania, s = A.BeatmapManager.sets.find(x => /Standard/.test(x.title)), m = s.maps[0];
    const { notes } = await A.BeatmapManager.load(m.id);
    const listed = () => A.SongSelect.results.some(x => x.set.id === s.id);
    A.SongSelect.rebuild(true);
    const shown = listed();
    A.Settings.set('songselect.converts', false); A.SongSelect.rebuild(true);
    const hidden = !listed();
    A.Settings.set('songselect.converts', true); A.SongSelect.rebuild(true);
    return { mode: m.mode, keys: m.keys, stars: m.stars, notes: notes.length, lns: notes.filter(n => n.isLN).length, shown, hidden, back: listed() };
  });
  check('an osu! (standard) map imports as a converted osu!mania difficulty (lazer\'s columns, notes and holds), listed in song select and hidden with "Show converted beatmaps" off',
    r.mode === 0 && r.keys === 7 && r.notes === 71 && r.lns === 7 && r.stars > 0 && r.shown && r.hidden && r.back, JSON.stringify(r));
  await page.evaluate(() => { const m = AshtonkMania.BeatmapManager.sets.find(x => /Standard/.test(x.title)).maps[0]; AshtonkMania.Screens.go('gameplay', { mapId: m.id, mods: ['AT'], force: true }); });
  await page.waitForFunction(() => { const s = AshtonkMania.GameplayScreen.s; return s && s.engine && s.engine.score.judged > 8; }, null, { timeout: 20000 }).catch(() => {});
  const play = await page.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; return s && s.engine ? { keys: s.keys, judged: s.engine.score.judged, misses: s.engine.score.counts[5] } : null; });
  check('a converted map plays (Auto hits its notes)', play && play.keys === 7 && play.judged > 8 && play.misses === 0, JSON.stringify(play));
  // lazer's key mods: the convert with four columns (song select says so too)
  const k4 = await page.evaluate(() => { const A = AshtonkMania, m = A.BeatmapManager.sets.find(x => /Standard/.test(x.title)).maps[0]; A.Settings.set('songselect.mods', ['4K']); const shown = A.SongSelect.keysOf(m); A.Settings.set('songselect.mods', []); A.Screens.go('gameplay', { mapId: m.id, mods: ['AT', '4K'], force: true }); return shown; });
  await page.waitForFunction(() => { const s = AshtonkMania.GameplayScreen.s; return s && s.keys === 4 && s.engine && s.engine.score.judged > 8; }, null, { timeout: 20000 }).catch(() => {});
  const play4 = await page.evaluate(() => { const s = AshtonkMania.GameplayScreen.s; return s && s.engine ? { keys: s.keys, judged: s.engine.score.judged, misses: s.engine.score.counts[5], cols: Math.max(...s.engine.notes.map(n => n.col)) } : null; });
  check('the 4K key mod plays a convert with four columns (and song select shows 4K)', k4 === 4 && play4 && play4.keys === 4 && play4.cols === 3 && play4.judged > 8 && play4.misses === 0, JSON.stringify({ k4, play4 }));
  // a library from before converts: the osu! difficulty's file was kept, the difficulty left out — it comes back once
  const back = await page.evaluate(async () => {
    const A = AshtonkMania, B = A.BeatmapManager, set = B.sets.find(x => /Standard/.test(x.title)), id = set.mapIds[0];
    await A.DB.del('maps', id); B.maps.delete(id); set.mapIds = []; set.maps = []; await A.DB.put('sets', { ...set, maps: undefined });
    A.Settings.set('migr.converts', false);
    const n = await B.addConverts(), again = await B.addConverts();
    const m = B.maps.get(id);
    return { n, again, back: !!m && m.mode === 0 && set.mapIds.includes(id) && m.keys === 7, stored: !!(await A.DB.get('maps', id)) };
  });
  check('songs imported before converts get their osu! difficulties as converts, once', back.n === 1 && back.again === 0 && back.back && back.stored, JSON.stringify(back));
  await page.evaluate(async () => { AshtonkMania.Screens.go('songselect', {}, { replace: true }); const s = AshtonkMania.BeatmapManager.sets.find(x => x.maps.some(m => m.mode === 0)); if (s) await AshtonkMania.BeatmapManager.removeSet(s.id); });
  await page.waitForTimeout(400);
}

// search & sort
await page.keyboard.type('9K');
await page.waitForTimeout(300);
const searched = await page.evaluate(() => AshtonkMania.SongSelect.results.map(r => r.maps.map(m => m.version)));
check('search filters difficulties', JSON.stringify(searched) === JSON.stringify([['9K Expert']]), JSON.stringify(searched));
// typed into the search box, Enter still plays the pick (the box hands Enter on)
await page.evaluate(() => { const s = AshtonkMania.SongSelect; window.__ssPlay = s.play; window.__played = null; s.play = mode => { window.__played = mode; }; });
await page.keyboard.press('Enter'); await page.waitForTimeout(150);
const typedEnter = await page.evaluate(() => { const s = AshtonkMania.SongSelect; s.play = window.__ssPlay; return { mode: window.__played, scr: AshtonkMania.Screens.currentName }; });
check('typing a search, then Enter plays the selected difficulty (as in lazer)', typedEnter.mode === 'play' && typedEnter.scr === 'songselect', JSON.stringify(typedEnter));
await page.evaluate(() => { const s = AshtonkMania.SongSelect; s.searchInput.value = 'keys>=8'; s.query = 'keys>=8'; s.rebuild(true); });
const syntax = await page.evaluate(() => AshtonkMania.SongSelect.results[0].maps.map(m => m.keys));
check('filter syntax (keys>=8)', JSON.stringify(syntax) === '[8,9]', JSON.stringify(syntax));
const lz = await page.evaluate(() => { const s = AshtonkMania.SongSelect, L = v => JSON.stringify(s.parseLength(v)), n = q => { s.searchInput.value = q; s.query = q; s.rebuild(true); return s.results.reduce((a, r) => a + (r.maps ? r.maps.length : 1), 0); };
  const out = { p: ['90', '90s', '2m', '1m30s', '1:30', '1:02:03', 'abc'].map(L).join(' '), short: n('length<1m'), long: n('length>2m'), all: n(''), diff: n('diff=expert') }; n(''); return out; });
check('filters read lengths as lazer does (90, 90s, 2m, 1m30s, 1:30) and diff= finds a difficulty by name', lz.p === '[90,0.5] [90,0.5] [120,30] [90,0.5] [90,0.5] [3723,0.5] null' && lz.short === lz.all && lz.long === 0 && lz.diff === 1, JSON.stringify(lz));
const only = await page.evaluate(() => { const s = AshtonkMania.SongSelect, n = q => { s.searchInput.value = q; s.query = q; s.rebuild(true); return s.results.length; }; return { all: n(''), word: n('anthem'), loose: n('tsnhm'), none: n('zzqx') }; });
check('search keeps only the songs it names (lazer: every word must appear; no loose letter matching)', only.all >= 1 && only.word === 1 && only.loose === 0 && only.none === 0, JSON.stringify(only));
await page.evaluate(() => { const s = AshtonkMania.SongSelect; s.searchInput.value = ''; s.query = ''; AshtonkMania.Settings.set('songselect.group', 'none'); AshtonkMania.Settings.set('songselect.sort', 'stars'); s.rebuild(); });
check('sorting by difficulty: each difficulty its own panel, easiest first (lazer)', await page.evaluate(() => { const r = AshtonkMania.SongSelect.results; return r.length === 4 && r.every(x => x.std && x.maps.length === 1) && r.every((x, i) => !i || r[i - 1].maps[0].stars <= x.maps[0].stars) && document.querySelectorAll('.std-panel').length === 4; }));
await page.evaluate(() => { AshtonkMania.Settings.set('songselect.sort', 'title'); AshtonkMania.SongSelect.rebuild(); });
// lazer's FilterControl: the star range keeps only difficulties inside it; Group puts the sets under group headers,
// with the selected difficulty's group open
const grouped = await page.evaluate(() => {
  const s = AshtonkMania.SongSelect, S = AshtonkMania.Settings, n = () => s.results.reduce((a, r) => a + r.maps.length, 0);
  S.set('songselect.starsMin', 1.69); s.rebuild(true);
  const ranged = { n: n(), count: s.countEl.textContent };
  S.set('songselect.starsMin', 0); s.rebuild(true);
  S.set('songselect.group', 'keys'); s.expandedGroup = undefined; s.rebuild();
  const heads = [...document.querySelectorAll('.group-panel')].map(e => e.textContent);
  const sel = AshtonkMania.BeatmapManager.maps.get(s.selectedId);
  const open = s.expandedGroup, diffs = s.rows.filter(r => r.type === 'diff').length;
  // a search that matches nothing, then cleared: the selected difficulty's group is open again (it stayed folded up)
  s.searchInput.value = 'zzqx'; s.query = 'zzqx'; s.rebuild(true);
  s.searchInput.value = ''; s.query = ''; s.rebuild(true);
  const reopen = { open: s.expandedGroup, diffs: s.rows.filter(r => r.type === 'diff').length };
  S.set('songselect.group', 'none'); s.rebuild();
  return { ranged, heads, open, want: sel && `${sel.keys}K`, diffs, reopen };
});
check('song select: the star range filters difficulties (the count is of songs), and Group lists them under lazer\'s group headers', grouped.ranged.n === 3 && grouped.ranged.count === '1 match' && grouped.heads.length === 4 && grouped.open === grouped.want && grouped.diffs === 1, JSON.stringify(grouped));

check('song select: a search that matches nothing, once cleared, leaves the selected difficulty\'s group open', grouped.reopen.open === grouped.want && grouped.reopen.diffs === 1, JSON.stringify(grouped.reopen));

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
    // on building a sprite (the first hit lightings used to). Measured while notes are on screen: in the lead-in the
    // clock may still take one correction as the audio output settles once sound starts (nothing is there to move).
    // (an audio output that shifts by up to 50 ms — a busy machine, a Bluetooth headset — is eased in over about a
    // second by design: every frame then moves the same few % faster, evenly. So, as a share of the time between
    // frames: no frame more than 6% off, and no jitter — the speed never changing by 3% or more from one frame to the
    // next (following the raw audio reading did that by tens of %))
    const p = await page.evaluate(() => new Promise(resolve => {
      const G = AshtonkMania.GameplayScreen, R = G.renderer, orig = R.render, rec = [];
      const shown = G.s.firstNote - 11485 / AshtonkMania.Settings.get('gameplay.scrollSpeed') * G.s.rate;
      R.render = function (g) { const t0 = performance.now(); const r = orig.call(this, g); rec.push([g.realNow, g.now, performance.now() - t0]); return r; };
      setTimeout(() => {
        R.render = orig;
        const dev = [], rate = G.s.rate;
        for (let i = 1; i < rec.length; i++) if (G.s.running && rec[i - 1][1] >= shown) { const dt = rec[i][0] - rec[i - 1][0]; dev.push([(rec[i][1] - rec[i - 1][1]) - dt * rate, dt]); }
        const rel = dev.map(([d, dt]) => d / Math.max(dt, 1)), jitter = rel.slice(1).map((r, i) => Math.abs(r - rel[i]));
        const cost = rec.map(x => x[2]).sort((a, b) => a - b);
        resolve({ frames: rec.length, measured: dev.length, worstStepMs: +Math.max(...dev.map(d => Math.abs(d[0]))).toFixed(3), worstOffPct: +(Math.max(...rel.map(Math.abs)) * 100).toFixed(2),
          worstJitterPct: +(Math.max(...jitter) * 100).toFixed(2), p99RenderMs: +cost[Math.floor(cost.length * 0.99)].toFixed(2) });
      }, 4000);
    }));
    check('gameplay: notes move by the time between frames — evenly, no jitter — and no frame stalls', p.frames > 60 && p.measured > 40 && p.worstOffPct < 6 && p.worstJitterPct < 3 && p.p99RenderMs < 8, JSON.stringify(p));
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
// the song opens on the difficulty last played from it (9K Expert was played last; 7K Hard then remembered instead)
const lastDiff = await page.evaluate(() => {
  const M = AshtonkMania, set = M.BeatmapManager.sets[0], v = id => M.BeatmapManager.maps.get(id).version;
  const a = v(M.SongSelect.pickDiff(set.maps).id);
  M.Game.rememberDiff(set.maps.find(m => m.version === '7K Hard').id);
  const b = v(M.SongSelect.pickDiff(set.maps).id);
  M.Game.rememberDiff(set.maps.find(m => m.version === '9K Expert').id);
  return { a, b };
});
check('song select opens a song on the difficulty you last played', lastDiff.a === '9K Expert' && lastDiff.b === '7K Hard', JSON.stringify(lastDiff));

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

// the game server judges online scores itself from the key presses (src/js/09c-verify.js): it must reach exactly the
// score the game did
const judgeAgain = id => page.evaluate(async id => {
  const r = await AshtonkMania.ReplayManager.get(id), sc = AshtonkMania.ScoreManager.scores.find(x => x.replayId === id);
  const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.hash === sc.mapHash);
  const text = await (await AshtonkMania.BeatmapManager.getFile(m.setId, m.osuPath)).text();
  const v = verifyPlay(text, { mods: r.mods, modConfig: r.modConfig, seed: r.seed, events: r.events });
  return { error: v.error, same: !v.error && v.counts.join() === sc.counts.join() && v.maxCombo === sc.maxCombo && Math.abs(v.score - AshtonkMania.ScoreManager.value(sc)) < 1 && Math.abs(v.accuracy - sc.accuracy) < 1e-9, v: v.error ? null : [v.counts.join(), v.score, v.maxCombo], local: [sc.counts.join(), AshtonkMania.ScoreManager.value(sc), sc.maxCombo] };
}, id);
const live = await livePlay({ version: '4K Normal' });
check('live keyboard play is judged from the audio clock (no misses, ≥ 95% acc)', live.counts[5] === 0 && live.acc > 0.95, JSON.stringify(live));
check('live play becomes a personal best with an auto-saved replay', live.pb && !!live.replayId);
{ const j = await judgeAgain(live.replayId); check('the server\'s judge, playing the recorded key presses again, gets exactly the score the game did', j.same, JSON.stringify(j)); }
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
// a dialog nobody answered, still open as a song starts (a match beginning under it): closed, and the keys are the song's
await page.evaluate(() => { AshtonkMania.Dialog.confirm('Left open', 'Nobody answered this'); });
const underDlg = await livePlay({ version: '4K Normal', errorMs: 25 }); // (a little late: a score of its own, not a copy of the first)
check('a dialog still open when a song starts is closed, and the song gets every key press', underDlg.counts[5] === 0 && underDlg.acc > 0.95 && !(await page.evaluate(() => !!document.querySelector('.dialog'))), JSON.stringify(underDlg.counts));
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

{
  // Wind Up / Wind Down / Adaptive Speed: a replay is judged from the speed the play started at (the rate it saved is
  // where the song ended, 1.5× for Wind Up)
  await page.evaluate(async (rp) => { const r = { ...(await AshtonkMania.ReplayManager.get(rp.id)), mods: ['WU'], rate: 1.5 }; Game.launch({ mapId: rp.mapId, mode: 'replay', replay: r }); }, rp);
  await page.waitForFunction(() => { const s = AshtonkMania.GameplayScreen.s; return s && s.engine && s.mods.includes('WU'); }, null, { timeout: 15000 });
  const wu = await page.evaluate(() => ({ engine: AshtonkMania.GameplayScreen.s.engine.rate, ramp: AshtonkMania.GameplayScreen.s.ramp }));
  check('a Wind Up replay is judged from the speed it started at, not the one it ended on', wu.engine === 1 && !!wu.ramp, JSON.stringify(wu));
  await page.evaluate(() => AshtonkMania.GameplayScreen.quit());
  await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'songselect', null, { timeout: 10000 });
}
check('new replays record the judging rules they were played with (osu!lazer rules = 2)', await page.evaluate(async (id) => (await AshtonkMania.ReplayManager.get(id)).rules === 2, rp.id));
// osu!lazer replays (.osr): ours export as .osr and an .osr imports back (by the beatmap's MD5) with the same inputs
{
  const ox = await page.evaluate(async (id) => {
    const A = AshtonkMania, rep = await A.ReplayManager.get(id);
    const bytes = await A.Osr.bytesFor(rep);
    const back = A.Osr.decode(bytes.buffer);
    const report = await A.App.importFiles([new File([bytes], 'lazer replay.osr')]);
    const imp = report.replays[0];
    const round = ev => ev.map((v, i) => i % 3 === 0 ? Math.round(v) : v).join();
    return { mode: back.mode, md5ok: back.beatmapMD5 === await A.Osr.mapMD5(A.BeatmapManager.mapByHash(rep.mapHash)), player: back.player === rep.player,
      counts: JSON.stringify(back.counts) === JSON.stringify(rep.summary.counts), imported: !!imp && imp.source === 'osr' && imp.mapHash === rep.mapHash,
      sameInputs: !!imp && round(imp.events) === round(rep.events), mods: !!imp && imp.mods.join() === rep.mods.join() };
  }, rp.id);
  check('replays export as osu!lazer\'s .osr and an .osr imports back onto its beatmap with the same key presses', ox.mode === 3 && ox.md5ok && ox.player && ox.counts && ox.imported && ox.sameInputs && ox.mods, JSON.stringify(ox));
}

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
{
  // Esc, or leaving the window, during the 3-2-1 after Continue pauses again (the song mustn't carry on unseen)
  const st = () => page.evaluate(() => ({ menu: !!document.querySelector('.pause-menu'), cd: !!document.querySelector('.countdown'), playing: AshtonkMania.Music.playing, running: AshtonkMania.GameplayScreen.s.running }));
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  const counting = await st();
  await page.keyboard.press('Escape'); await page.waitForTimeout(1400);
  const esc = await st();
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(1400);
  const away = await st();
  const ok = x => x.menu && !x.cd && !x.playing && !x.running;
  check('Esc or leaving the window during the unpause countdown pauses again', counting.cd && !counting.menu && ok(esc) && ok(away), JSON.stringify({ counting, esc, away }));
}
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
check('the judgement counter is off by default', await page.evaluate(() => !document.querySelector('.hud-jc')));
await page.evaluate(() => AshtonkMania.GameplayScreen.quit());
// turned on: lazer's six counters (Perfect … Miss), counting up as notes are hit
await page.evaluate(() => { AshtonkMania.Settings.set('gameplay.judgementCounter', true); const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.SongSelect.selectedId = m.id; AshtonkMania.SongSelect.play('play'); });
await page.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 15000 });
await page.waitForTimeout(4000);
const jc = await page.evaluate(() => ({ names: [...document.querySelectorAll('.hud-jc .jc-name')].map(e => e.textContent).join(','), perfect: +document.querySelector('.hud-jc .jc-n').textContent, judged: AshtonkMania.GameplayScreen.s.engine.score.counts[0] }));
check('the judgement counter (when turned on) shows lazer\'s six judgements and counts them', jc.names === 'Perfect,Great,Good,Ok,Meh,Miss' && jc.perfect > 0 && Math.abs(jc.perfect - jc.judged) <= 3, JSON.stringify(jc));
await page.evaluate(() => { AshtonkMania.Settings.set('gameplay.judgementCounter', false); AshtonkMania.GameplayScreen.quit(); });
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
  check('scroll speed changes in game (F3/F4, Ctrl −/+) with an on-screen popup', up === before + 2 && down === before + 1 && await page.evaluate(() => /scroll speed/i.test(document.querySelector('.osd.show')?.textContent || '')), `${before} → ${up} → ${down}`);
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
const rows = await page.evaluate(() => document.querySelectorAll('.settings-panel .set-row').length);
// (room for the hit position and note offset, asked to be regular settings, lazer's Prefer downloads without video,
// and safe mode with its "turn on by itself")
check('settings are a short list (no "show all" split)', rows >= 25 && rows <= 49, String(rows));
check('niche options are gone from the panel but keep working', await page.evaluate(() => !document.querySelector('.sp-more') && ![...document.querySelectorAll('.settings-panel .set-row')].some(r => /Unpause countdown|Renderer scale|Lane spacing/.test(r.textContent)) && AshtonkMania.Settings.get('gameplay.unpauseDelay') === 1200));
await page.fill('.sp-search', 'offset');
await page.waitForTimeout(200);
check('settings search finds options', await page.evaluate(() => [...document.querySelectorAll('.settings-panel .set-row')].some(r => /Audio offset/.test(r.textContent))));
await page.keyboard.press('Escape'); await page.waitForTimeout(150);
const escOnce = await page.evaluate(() => ({ open: !!AshtonkMania.SettingsPanel.o, q: document.querySelector('.sp-search').value, rows: document.querySelectorAll('.settings-panel .set-row').length }));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('settings search: Esc clears what\'s typed first (as lazer), a second Esc closes the panel', escOnce.open && escOnce.q === '' && escOnce.rows === rows && !(await page.evaluate(() => !!AshtonkMania.SettingsPanel.o)), JSON.stringify(escOnce));
await page.evaluate(() => AshtonkMania.Screens.go('songselect'));
await page.waitForTimeout(700);
await page.keyboard.press('F1');
await page.waitForSelector('.modsel .mod-p');
await page.evaluate(() => [...document.querySelectorAll('.mod-p')].find(b => b.textContent.includes('Hidden')).click());
await page.waitForTimeout(200);
const modsel = await page.evaluate(() => ({ cols: document.querySelectorAll('.modcol-h').length, on: (document.querySelector('.mod-p.on') || {}).textContent || '', slider: !!document.querySelector('.ms-cust .slider'), custOn: !document.querySelector('.ms-cust').classList.contains('off'), mods: AshtonkMania.Settings.get('songselect.mods') }));
check('mod select: lazer columns, toggling a mod and its customise panel', modsel.cols >= 4 && modsel.on.includes('Hidden') && modsel.slider && modsel.custOn && modsel.mods.includes('HD'), JSON.stringify(modsel));
// lazer's mod search: Tab to search, the columns keep only the mods found, Enter takes the first
await page.keyboard.press('Tab'); await page.keyboard.type('mirror'); await page.waitForTimeout(100);
const msearch = await page.evaluate(() => ({ shown: [...document.querySelectorAll('.modcol:not(.mod-presets) .mod-p')].map(b => b.querySelector('b').firstChild.textContent), focused: document.activeElement === AshtonkMania.ModSelect.searchEl }));
await page.keyboard.press('Enter'); await page.waitForTimeout(100);
const mtook = await page.evaluate(() => AshtonkMania.Settings.get('songselect.mods').includes('MR'));
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
check('mod select: Tab to search finds mods by name, Enter selects the first', msearch.focused && msearch.shown.length === 1 && msearch.shown[0] === 'Mirror' && mtook, JSON.stringify({ msearch, mtook }));
await page.evaluate(() => { AshtonkMania.Settings.set('songselect.mods', ['HD']); AshtonkMania.ModSelect.render(); });
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

// now playing panel: click the note in the toolbar (lazer's ToolbarMusicButton) → pause / next / previous
await page.evaluate(() => AshtonkMania.Screens.go('home'));
await page.waitForTimeout(1500);
await page.hover('.tb-music');
await page.waitForTimeout(400);
check('hovering the toolbar note only shows its tooltip (like lazer)', await page.evaluate(() => !document.querySelector('.np-panel.show') && getComputedStyle(document.querySelector('.tb-music .tb-tip')).opacity > 0.5));
await page.click('.tb-music');
await page.waitForSelector('.np-panel.show', { timeout: 3000 });
await page.waitForFunction(() => document.querySelector('.tb-music.on'), null, { timeout: 2000 }).catch(() => {}); // (the toolbar updates on the next frame)
const npState = await page.evaluate(() => ({ on: document.querySelector('.tb-music').classList.contains('on'), title: document.querySelector('.np-title').textContent, cls: document.querySelector('.tb-music').className }));
check('clicking the toolbar note opens the now-playing panel and turns the button carmine', npState.on && npState.title.length > 0, JSON.stringify(npState));
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

// beatmap explorer (the game server's /api/getBeatmaps mocked with osu! API answers — osu! itself is external)
const osuRaw = (id, title, extra = {}) => ({ id, title, title_unicode: title, artist: 'Mock', artist_unicode: 'Mock', creator: 'M', status: 'ranked', play_count: 1, favourite_count: 1, nsfw: false, ...extra,
  beatmaps: [{ beatmapset_id: id, id: id * 10, mode: 'mania', version: '4K', difficulty_rating: 2.1, cs: 4, accuracy: 8, drain: 7, bpm: 150, total_length: 60, count_circles: 100, count_sliders: 10 },
    { beatmapset_id: id, id: id * 10 + 1, mode: 'osu', version: 'Std', difficulty_rating: 3, cs: 4, accuracy: 8, drain: 7, bpm: 150, total_length: 60, count_circles: 100, count_sliders: 10 }] });
const mirrorSearches = [];
for (const u of ['https://catboy.best/api/**', 'https://api.nerinyan.moe/search**', 'https://osu.direct/api/v2/search**']) await page.route(u, r => { mirrorSearches.push(r.request().url()); r.abort(); });
await page.route('**/api/health', r => r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
await page.route('**/api/getBeatmaps**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ beatmapsets: [osuRaw(777, 'Explorer Song')], cursor_string: null, total: 1 }) }));
await page.route('**/api/download/**', r => r.fulfill({ contentType: 'application/octet-stream', body: readFileSync(join(root, 'tests', 'fixtures', 'online-set.osz')) }));
// (downloads go straight to the chosen provider, Mino by default, as on Web-Osu-Mania)
await page.route('https://catboy.best/d/**', r => r.fulfill({ contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(join(root, 'tests', 'fixtures', 'online-set.osz')) }));
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
check('toasts sit below the beatmap info page\'s close button (a phone has no Esc)', await page.evaluate(() => { const c = document.querySelector('.bso-close').getBoundingClientRect(), e = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2); return !!document.querySelector('#toasts .toast') && !!(e && e.closest('.bso-close')); }));
check('a download\'s progress entry leaves the notifications once it\'s in the library', await page.evaluate(() => !Notifications.list.some(n => n.prog != null) && Notifications.list.some(n => /^Downloaded /.test(n.title))));
check('the "Downloaded" notice takes you to the beatmap, as lazer\'s "Click to view"', await page.evaluate(() => { const n = Notifications.list.find(n => /^Downloaded /.test(n.title)); return !!(n && n.onClick && /Click to view/.test(n.body)); }));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
{
  // lazer's "Download without Video": a set with a video has a second button, which asks the mirrors for the set without it
  const nv = await page.evaluate(async raw => {
    const E = AshtonkMania.ExplorerScreen, O = AshtonkMania.OnlineBeatmaps, real = O.downloadAndImport, calls = [];
    O.downloadAndImport = async (s, p, opts) => { calls.push(opts && opts.noVideo); return { sets: [] }; };
    try {
      E.openSet(O.normalize(raw));
      const btns = [...document.querySelectorAll('.bso-buttons .bso-dl')], labels = btns.map(b => b.innerText.replace(/\s+/g, ' ').trim());
      btns[1].click();
      await new Promise(r => setTimeout(r, 100));
      E.downloads.delete(raw.id); E.imported.delete(raw.id); E.closeSet();
      return { labels, calls, urls: O.downloadURLs(5, false, true), proxied: O.downloadURLs(5, true, true)[0], plain: O.downloadURLs(5, false)[0] };
    } finally { O.downloadAndImport = real; }
  }, osuRaw(778, 'Video Song', { video: true }));
  check('a beatmap with a video has Download with video / without video buttons, as in lazer', nv.labels.length === 2 && /with video/.test(nv.labels[0]) && /without video/.test(nv.labels[1]) && nv.calls[0] === true, JSON.stringify(nv));
  check('downloads without video ask each mirror for its no-video file (Nekoha has none: the video is left out on import)',
    nv.urls[0] === 'https://catboy.best/d/5n' && nv.urls.includes('https://api.nerinyan.moe/d/5?noVideo=1') && nv.urls.includes('https://dl.sayobot.cn/beatmaps/download/novideo/5') && nv.urls.includes('https://osu.direct/api/d/5?noVideo=1')
    && nv.urls.includes('https://mirror.nekoha.moe/api4/download/5') && nv.proxied === 'api/downloadBeatmap?destinationUrl=' + encodeURIComponent('https://catboy.best/d/5n') && nv.plain === 'https://catboy.best/d/5', JSON.stringify(nv));
  await page.waitForTimeout(400);
  // the download's entry in the notifications has lazer's cancel X: cancelling stops it quietly, back to Download
  const cx = await page.evaluate(async raw => {
    const E = AshtonkMania.ExplorerScreen, O = AshtonkMania.OnlineBeatmaps, realFetch = window.fetch;
    window.fetch = (u, o) => new Promise((_, rej) => o && o.signal && o.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    try {
      const set = O.normalize(raw);
      E.openSet(set);
      const run = E.download(set);
      await new Promise(r => setTimeout(r, 100));
      const live = Notifications.list.find(n => n.prog != null);
      const busy = !!document.querySelector('.bso-dl.busy');
      live && live.onCancel && live.onCancel();
      await run;
      const out = { busy, live: !!(live && live.onCancel), left: Notifications.list.some(n => n.prog != null), state: E.downloads.get(raw.id) || null,
        err: [...document.querySelectorAll('#toasts .toast.err')].some(t => /Cancel Song/.test(t.textContent)), btn: document.querySelector('.bso-dl')?.textContent };
      E.closeSet();
      return out;
    } finally { window.fetch = realFetch; }
  }, osuRaw(779, 'Cancel Song'));
  check('a download can be cancelled from its notification (lazer\'s X): no error, the Download button is back', cx.busy && cx.live && !cx.left && !cx.state && !cx.err && /Download/.test(cx.btn || ''), JSON.stringify(cx));
  await page.waitForTimeout(300);
  // as in lazer, an entry in the notifications does what its toast did when clicked (opens the chat, the daily challenge…)
  await page.evaluate(() => { window.__nfClicked = 0; Toast.show('Clickable notice', 'click me', { onClick: () => { window.__nfClicked++; } }); Notifications.open(); });
  await page.waitForTimeout(300);
  await page.click('.nf-item.act');
  await page.waitForTimeout(200);
  check('clicking a notification does what its toast does, and it\'s done with', await page.evaluate(() => window.__nfClicked === 1 && !Notifications.isOpen() && !Notifications.list.some(n => n.title === 'Clickable notice')));
  // lazer's "Update ready to install": a new version taking over while the game is open (not the first install) says so
  const upd = await page.evaluate(async () => {
    const sw = navigator.serviceWorker, had = !!sw.controller;
    App.watchUpdates({ update: () => Promise.resolve() });
    if (!had) { sw.dispatchEvent(new Event('controllerchange')); await new Promise(r => setTimeout(r, 50)); }
    const first = [...document.querySelectorAll('#toasts .toast')].some(t => /Update ready/.test(t.textContent));
    sw.dispatchEvent(new Event('controllerchange')); await new Promise(r => setTimeout(r, 100));
    const toast = [...document.querySelectorAll('#toasts .toast')].find(t => /Update ready to install/.test(t.textContent));
    const n = Notifications.list.find(x => /Update ready/.test(x.title));
    if (toast) toast.remove();
    return { first, toast: !!toast, clickable: !!(n && n.onClick) };
  });
  check('a new version going live while the game is open shows lazer\'s "Update ready to install" (click to restart); the first install doesn\'t', !upd.first && upd.toast && upd.clickable, JSON.stringify(upd));
  const wn = await page.evaluate(async () => {
    const W = WhatsNew; await DB.kvSet('changelog.seen', W.latest()); await DB.kvSet('changelog.seenLines', W.lines());
    await W.maybeShow(); const same = !!document.querySelector('.cl');
    await DB.kvSet('changelog.seenLines', W.lines() - 1); await W.maybeShow(); const grew = !!document.querySelector('.cl');
    Overlays.closeAll(); await new Promise(r => setTimeout(r, 400));
    await W.maybeShow(); const again = !!document.querySelector('.cl'); Overlays.closeAll();
    return { same, grew, again };
  });
  check('What\'s new comes back when the latest update gains lines after you\'ve seen it (and only then)', !wn.same && wn.grew && !wn.again, JSON.stringify(wn));
  const wn2 = await page.evaluate(async () => {
    await DB.kvSet('changelog.seen', CHANGELOG[2].id); await WhatsNew.maybeShow();
    const n = document.querySelectorAll('.cl .cl-entry').length; Overlays.closeAll(); return n;
  });
  check('What\'s new shows every update since the one you last saw (two missed: both)', wn2 === 2, String(wn2));
  await page.waitForTimeout(400);
}
{
  // Web-Osu-Mania's request: the list comes in osu!'s own order, page after page by osu!'s cursor
  const seen = [];
  const pages = { '': [osuRaw(802, 'Alpha'), osuRaw(801, 'Bravo'), osuRaw(804, 'Delta', { nsfw: true })], next1: [osuRaw(805, 'Echo')] };
  await page.unroute('**/api/getBeatmaps**');
  await page.route('**/api/getBeatmaps**', r => { const sp = new URL(r.request().url()).searchParams; seen.push(sp); const c = sp.get('cursor_string') || '';
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ beatmapsets: pages[c] || [], cursor_string: c ? null : 'next1', total: 4 }) }); });
  await page.evaluate(() => AshtonkMania.ExplorerScreen.newSearch());
  await page.waitForSelector('.ex-card[data-id="805"]', { timeout: 8000 }).catch(() => {});
  const order1 = await page.$$eval('.ex-card', a => a.map(c => c.dataset.id).join(','));
  const p0 = seen[0];
  check('explorer: asks the game server exactly as Web-Osu-Mania does (m=3, nsfw, no sort or category for the defaults) and keeps osu!\'s order',
    order1 === '802,801,804,805' && p0.get('m') === '3' && p0.get('nsfw') === 'true' && p0.get('sort') === null && p0.get('s') === null && p0.get('q') === null && seen[1] && seen[1].get('cursor_string') === 'next1', `${order1} ${p0} | ${seen[1]}`);
  await page.click('.ex-chip:text-is("Title")');
  await page.waitForTimeout(300);
  const s2 = seen[seen.length - 1].get('sort');
  await page.click('.ex-chip:text-matches("^Title")');
  await page.waitForTimeout(300);
  check('explorer: a new sort starts descending (Z→A), clicking again flips it (as on WOM)', s2 === 'title_desc' && seen[seen.length - 1].get('sort') === 'title_asc', `${s2} / ${seen[seen.length - 1]}`);
  {
    // lazer's listing: typing a search sorts by relevance (osu! does then), and clearing it goes back to ranked
    const rel = await page.evaluate(async () => {
      const E = AshtonkMania.ExplorerScreen, st = E.state, was = { sort: st.sort, dir: st.dir }, inp = E.searchInput;
      inp.value = 'anthem'; inp.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 650));
      const typed = `${st.sort}_${st.dir}`, reset = !!document.querySelector('.ex-reset');
      inp.value = ''; inp.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 650));
      const cleared = `${st.sort}_${st.dir}`;
      Object.assign(st, was); E.renderFilters(); E.newSearch();
      return { typed, reset, cleared };
    });
    check('explorer: typing a search sorts by relevance and clearing it goes back to ranked, as in lazer (no "Reset filters" for it)', rel.typed === 'relevance_desc' && rel.cleared === 'ranked_desc' && !rel.reset, JSON.stringify(rel));
    await page.waitForTimeout(300);
  }
  // WOM's other filters: genre, language, explicit content (under "More filters"), key counts up to 18K, stars, reset
  await page.click('.ex-chip:text-is("More filters")');
  await page.click('.ex-chip:text-is("Anime")'); await page.waitForTimeout(150);
  await page.click('.ex-chip:text-is("Japanese")'); await page.waitForTimeout(150);
  await page.click('.ex-chip:text-is("Hide")'); await page.waitForTimeout(150);
  await page.click('.ex-chip:text-is("Loved")'); await page.waitForTimeout(150);
  await page.evaluate(() => { const st = AshtonkMania.ExplorerScreen.state; st.minStars = 3; st.maxStars = 6; st.q = 'camellia'; });
  await page.click('.ex-chip:text-is("18K")'); await page.waitForTimeout(300);
  const pf = seen[seen.length - 1];
  check('explorer: filters go to osu! as WOM writes them (key / stars in the search text, s, g, l, nsfw)',
    pf.get('g') === '3' && pf.get('l') === '3' && pf.get('nsfw') === 'false' && pf.get('s') === 'loved' && pf.get('q') === 'stars>=3 stars<=6 key=18 camellia', String(pf));
  await page.click('.ex-reset'); await page.waitForTimeout(300);
  const pr = seen[seen.length - 1];
  check('explorer: "Reset filters" goes back to the defaults', !pr.get('g') && !pr.get('l') && pr.get('nsfw') === 'true' && !pr.get('s') && !pr.get('sort') && !(await page.$('.ex-reset')), String(pr));
  await page.click('.ex-chip:text-is("Fewer filters")');
  await page.evaluate(() => { const st = AshtonkMania.ExplorerScreen.state; st.sort = 'ranked'; st.dir = 'desc'; st.q = ''; });
}
{
  // osu! refusing the game server: Web-Osu-Mania's error, and the mirrors are NOT used to list songs
  await page.unroute('**/api/getBeatmaps**');
  await page.route('**/api/getBeatmaps**', r => r.fulfill({ status: 429, contentType: 'text/plain', body: 'The site is being rate-limited by the osu! API, please try again later.' }));
  await page.evaluate(() => AshtonkMania.ExplorerScreen.newSearch());
  await page.waitForSelector('.ex-error', { timeout: 8000 }).catch(() => {});
  const err = await page.evaluate(() => (document.querySelector('.ex-error') || {}).textContent || '');
  check('explorer: osu! refusing shows WOM\'s "Failed to fetch beatmaps" (code 429) and never lists from a mirror',
    /Failed to fetch beatmaps/.test(err) && /Code 429: The site is being rate-limited/.test(err) && !mirrorSearches.length && !(await page.$('.ex-card')), `${err} | ${mirrorSearches}`);
  await page.unroute('**/api/getBeatmaps**');
  await page.route('**/api/getBeatmaps**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ beatmapsets: [osuRaw(777, 'Explorer Song')], cursor_string: null }) }));
}
{
  // deleting the set whose song is playing: the music moves on to another song (not the deleted one, still in memory)
  const mv = await page.evaluate(async () => {
    const A = AshtonkMania, s = A.BeatmapManager.sets.find(x => x.maps.some(m => /^Online/.test(m.version)));
    if (!s) return null;
    await A.MenuMusic.play(s.maps[0]);
    const was = !!A.MenuMusic.current && A.MenuMusic.current.setId === s.id;
    await A.BeatmapManager.removeSet(s.id);
    await new Promise(r => setTimeout(r, 1500));
    const cur = A.MenuMusic.current;
    return { screen: A.Screens.currentName, was, moved: !!cur && cur.setId !== s.id && !!A.BeatmapManager.maps.get(cur.id), stale: !!A.Music.key && A.Music.key.startsWith(s.id + '/') };
  });
  check('deleting the beatmap set whose song is playing moves the music on to another song', !!mv && mv.was && mv.moved && !mv.stale, JSON.stringify(mv));
}

// beatmap sources (Web-Osu-Mania's "Sources" settings)
const src = await page.evaluate(async () => {
  const S = AshtonkMania.Settings, O = AshtonkMania.OnlineBeatmaps;
  const def = { preview: O.previewURL(5), cover: O.coverURL(5, 'card@2x'), dl: O.downloadURLs(5, true), direct: O.downloadURLs(5, false)[0] };
  await S.set('online.previewSource', 'beatconnect'); await S.set('online.coverSource', 'sayobot'); await S.set('online.downloadSource', 'sayobot');
  const alt = { preview: O.previewURL(5), cover: O.coverURL(5, 'card@2x'), dl: O.downloadURLs(5, true), direct: O.downloadURLs(5, false) };
  await S.set('online.downloadSource', 'custom'); await S.set('online.customDownload', 'https://example.org/d/$setId');
  const custom = O.downloadURLs(5, false)[0];
  for (const k of ['online.previewSource', 'online.coverSource', 'online.downloadSource', 'online.customDownload']) S.reset(k);
  return { def, alt, custom };
});
check('beatmap sources: official preview / cover by default; downloads from Mino, proxied as WOM when asked', src.def.preview === 'https://b.ppy.sh/preview/5.mp3' && src.def.cover === 'https://assets.ppy.sh/beatmaps/5/covers/card@2x.jpg' && src.def.dl[0] === 'api/downloadBeatmap?destinationUrl=' + encodeURIComponent('https://catboy.best/d/5') && src.def.direct === 'https://catboy.best/d/5', JSON.stringify(src.def));
check('beatmap sources: choosing Beatconnect / SayoBot / a custom URL changes where previews, covers and downloads come from',
  src.alt.preview === 'https://beatconnect.io/preview/5.mp3' && src.alt.cover === 'https://a.sayobot.cn/beatmaps/5/covers/cover.webp'
  && src.alt.dl[0] === 'api/downloadBeatmap?destinationUrl=' + encodeURIComponent('https://dl.sayobot.cn/beatmaps/download/5') && src.alt.direct[0] === 'https://dl.sayobot.cn/beatmaps/download/5' && src.custom === 'https://example.org/d/5', JSON.stringify(src));

// pp tracking (ranked beatmaps only: the test set counts as ranked, then not)
const unrankedPp = await page.evaluate(() => AshtonkMania.ScoreManager.totalPp().total);
await page.evaluate(() => { for (const s of AshtonkMania.BeatmapManager.sets) s.status = 'ranked'; });
const ppInfo = await page.evaluate(() => ({ total: AshtonkMania.ScoreManager.totalPp().total, best: AshtonkMania.ScoreManager.bestPpPerMap().length }));
check('pp is tracked from passed scores on ranked beatmaps only', ppInfo.total > 0 && ppInfo.best >= 1 && unrankedPp === 0, JSON.stringify({ ...ppInfo, unrankedPp }));
// score display: always osu!lazer's standardised score (the setting is gone)
{
  const sd = await page.evaluate(async () => {
    const A = AshtonkMania, SM = A.ScoreManager;
    const withStd = SM.scores.filter(s => s.scoreStd != null);
    const hash = withStd[0].mapHash;
    const std = SM.forMap(hash).map(s => SM.value(s));
    A.Settings.set('songselect.lbScope', 'local'); // (your own scores: the Local leaderboard)
    A.Screens.go('songselect', { mapId: SM.forMap(hash)[0].mapId });
    await new Promise(r => setTimeout(r, 900));
    const shown = [...document.querySelectorAll('.lbs-score, .score-row .sc, .nums .sc')].map(e => e.textContent.replace(/\D/g, '')).filter(Boolean).map(Number);
    return { n: withStd.length, stdSorted: std.every((v, i) => !i || std[i - 1] >= v), shown, std, setting: A.Settings.get('gameplay.scoring') ?? null };
  });
  check('scores show osu!lazer\'s standardised score everywhere, with no setting to change it', sd.n >= 2 && sd.stdSorted && sd.shown.length > 0 && sd.shown.every(v => sd.std.includes(v)) && sd.setting === null, JSON.stringify(sd));
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
// a computer window at 300% browser zoom (a 640×360 page): the interface scales down to fit, as lazer's does, instead
// of falling apart into the phone layout
{
  await page.setViewportSize({ width: 640, height: 360 });
  await page.evaluate(() => AshtonkMania.Screens.go('songselect'));
  await page.waitForTimeout(700);
  const z = await page.evaluate(() => { const info = document.querySelector('.ss-info'), r = document.querySelector('.ss-right').getBoundingClientRect(); return { z: AshtonkMania.Zoom.z, info: !!info && getComputedStyle(info).display !== 'none', fits: r.right <= innerWidth + 1, overflow: document.documentElement.scrollWidth > innerWidth + 1 }; });
  check('300% zoom (640×360): song select scales down whole — the info panel stays, nothing overflows', z.z > 1.8 && z.info && z.fits && !z.overflow, JSON.stringify(z));
  await shot('14-songselect-300pct');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => AshtonkMania.Screens.go('home'));
  await page.waitForTimeout(300);
}

// lazer's menu cursor, drawn by the game: follows the pointer, shrinks to 0.9× with a pink glow while pressed
{
  await page.mouse.move(400, 300); await page.waitForTimeout(100);
  await page.mouse.down(); await page.waitForTimeout(900);
  const c = await page.evaluate(() => { const el = document.querySelector('#lz-cur'), sc = document.querySelector('.lzc-scale'); return { shown: !!el && !el.hidden, at: el && el.style.transform, scale: getComputedStyle(sc).scale, glow: +getComputedStyle(document.querySelector('.lzc-add')).opacity, sys: getComputedStyle(document.body).cursor }; });
  await page.mouse.up(); await page.waitForTimeout(600);
  check('the osu!lazer menu cursor follows the mouse, shrinks and glows pink while pressed (system cursor hidden)', c.shown && /400px, 300px/.test(c.at) && Math.abs(+c.scale - 0.9) < 0.02 && c.glow > 0.9 && c.sys === 'none', JSON.stringify(c));
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(350);
  const kbHidden = await page.evaluate(() => +getComputedStyle(document.querySelector('.lzc-rot')).opacity < 0.05);
  await page.mouse.move(420, 310); await page.waitForTimeout(450);
  const back = await page.evaluate(() => +getComputedStyle(document.querySelector('.lzc-rot')).opacity > 0.95);
  check('pressing a key hides the cursor (as lazer); moving the mouse brings it back', kbHidden && back, JSON.stringify({ kbHidden, back }));
}

// the Web-Osu-Mania skins draw their own stage (each style plays without errors; judgements come from the chosen set)
const skinBefore = await page.evaluate(() => AshtonkMania.SkinManager.current.id);
for (const st of ['bars', 'arrows']) {
  await page.evaluate(async st => { await AshtonkMania.Settings.set('wom.style', st); await AshtonkMania.SkinManager.select('default'); const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.keys === 4); AshtonkMania.Screens.go('gameplay', { mapId: m.id, mods: ['AT'], force: true }); }, st);
  await page.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.engine && AshtonkMania.GameplayScreen.s.engine.score.combo > 2, null, { timeout: 20000 });
  const r = await page.evaluate(() => { const R = AshtonkMania.GameplayScreen.s.renderer || AshtonkMania.GameplayScreen.renderer; return { wom: !!(R && R.layout && R.layout.wom), style: R && R.layout && R.layout.wom && R.layout.wom.style, hit: R && Math.round(R.hitY / R.s), colW: R && Math.round(R.colW[0] / R.s / AshtonkMania.Settings.get('gameplay.laneWidth')) }; });
  check(`Custom skin, ${st}: Web-Osu-Mania's notes, sized and placed like Kori (72-wide columns, hit position 434 of 480)`, r.wom && r.style === st && r.hit === 434 && r.colW === 72, JSON.stringify(r));
  await shot('wom-' + st);
}
await page.evaluate(async id => { await AshtonkMania.SkinManager.select(id); AshtonkMania.Screens.go('home', { force: true }); }, skinBefore); await page.waitForTimeout(500);

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
  check('holding ` shows the retry bar, then retries (counted, as lazer\'s pause menu shows)', holding && await page.evaluate(() => AshtonkMania.GameplayScreen.retryCount === 2 && !document.querySelector('.gp-loader .pl-tag')));
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
  await sp.waitForSelector('.setup-step-safe');
  check('setup: then it asks whether this is a school device (safe mode yes / no)', (await sp.$$('.setup-step-safe .setup-choice')).length === 2 && /school/i.test(await sp.textContent('.setup-step-safe')));
  await sp.click('.setup-step-safe .setup-choice[data-id="no"]');
  await sp.waitForSelector('.setup-step-device');
  check('setup: "No" leaves safe mode off', await sp.evaluate(() => AshtonkMania.Settings.get('online.safeMode') === false && !document.documentElement.classList.contains('safe-mode')));
  check('setup: device step is just PC or Chromebook', (await sp.$$('.setup-step-device .setup-choice')).length === 2 && !(await sp.$('.setup-detect')));
  await sp.click('.setup-choice[data-id="chromebook"]');
  await sp.waitForSelector('.setup-step-look', { timeout: 3000 });
  check('setup: Performance turns Performance mode on (menus and all) and moves on', await sp.evaluate(() => AshtonkMania.Settings.get('graphics.performanceMode') === true && AshtonkMania.Settings.get('graphics.particles') === false && document.documentElement.classList.contains('perf')));
  check('setup: no colour question (as in lazer); size is a slider', !(await sp.$('.setup-swatch')) && !!(await sp.$('.setup-step-look input.slider')));
  await sp.click('.setup-next'); await sp.waitForSelector('.setup-step-gameplay');
  await sp.waitForTimeout(600);
  const pvDrawn = await sp.evaluate(() => { const c = document.querySelector('.setup-pv canvas'); return c && c.width > 50 && c.height > 50; });
  check('setup: live gameplay preview renders; scroll speed defaults to 22', pvDrawn && await sp.evaluate(() => AshtonkMania.Settings.get('gameplay.scrollSpeed') === 22));
  await sp.click('.setup-next'); await sp.waitForSelector('.setup-step-skin');
  const skinNames = await sp.$$eval('.setup-skinitem b', a => a.map(x => x.textContent).join(','));
  await sp.click('.setup-skinitem[data-id="default"]');
  await sp.waitForSelector('.setup-custom');
  await sp.click('.setup-custom .setup-seg >> nth=0 >> button >> nth=2');
  await sp.selectOption('.setup-custom select', 'fnf');
  check('setup: skins are Kori / Custom / Import; Custom has note type, colour and judgement options', /^Kori,Custom,.*Import a skin$/.test(skinNames) && await sp.evaluate(() => AshtonkMania.SkinManager.current.id === 'default' && AshtonkMania.Settings.get('wom.style') === 'arrows' && AshtonkMania.Settings.get('wom.judgements') === 'fnf'), skinNames);
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
  await sp.keyboard.press('Control+F11'); await sp.waitForTimeout(700);
  const fc = await sp.evaluate(() => { const e = document.querySelector('#fps-counter'); return { on: !e.hidden, ms: (e.querySelector('.fc-ms') || {}).textContent, fps: (e.querySelector('.fc-fps') || {}).textContent, col: e.querySelector('.fc-fps') && getComputedStyle(e.querySelector('.fc-fps')).color }; });
  check('Ctrl+F11 shows lazer\'s FPS counter: frame time over frame rate, tinted by how healthy they are', fc.on && /^\d+ ms$/.test(fc.ms) && /^[\d,]+ fps$/.test(fc.fps) && /^rgb/.test(fc.col), JSON.stringify(fc));
  await sp.keyboard.press('Control+F11'); await sp.waitForTimeout(200);
  await sp.reload();
  await sp.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await sp.waitForTimeout(600);
  check('setup: choices persist and the wizard does not return', !(await sp.$('.setup')) && await sp.evaluate(() => AshtonkMania.Settings.get('graphics.performanceMode') === true));
  await sp.evaluate(() => AshtonkMania.Settings.set('graphics.performanceMode', true));
  const pm = await sp.evaluate(() => ({ cls: document.documentElement.classList.contains('perf'), anim: AshtonkMania.Settings.get('ui.animSpeed'), noAnim: document.documentElement.classList.contains('no-anim'), glass: getComputedStyle(document.querySelector('#toolbar')).backdropFilter, parallax: AshtonkMania.Settings.get('ui.parallax') }));
  await sp.evaluate(() => AshtonkMania.Settings.set('graphics.performanceMode', false));
  check('Performance mode strips the menus: no animation, blur or parallax (and gives them back when turned off)', pm.cls && pm.anim === 0 && pm.noAnim && (pm.glass === 'none' || !pm.glass) && pm.parallax === false && await sp.evaluate(() => !document.documentElement.classList.contains('perf') && AshtonkMania.Settings.get('ui.animSpeed') > 0), JSON.stringify(pm));
  await sctx.close();
}

{
  // safe mode, for a school device: chosen in the setup, it turns the online features off; and it comes on by itself
  // after a filter takes the tab to another page soon after the game opened
  const kctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const kp = await kctx.newPage();
  kp.on('pageerror', e => errors.push('safe mode: ' + e.message));
  const ready = async () => { await kp.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 }); await kp.waitForTimeout(2000); };
  await kp.goto(url);
  await kp.waitForSelector('.setup-step-welcome', { timeout: 30000 });
  await kp.fill('.ob-name', 'School'); await kp.keyboard.press('Enter');
  await kp.waitForSelector('.setup-step-wom'); await kp.click('.setup-step-wom .setup-choice[data-id="no"]');
  await kp.waitForSelector('.setup-step-safe'); await kp.click('.setup-step-safe .setup-choice[data-id="yes"]');
  await kp.waitForSelector('.setup-step-device');
  await kp.evaluate(() => AshtonkMania.Onboarding.finish()); await kp.waitForTimeout(600);
  await kp.evaluate(() => AshtonkMania.Screens.go('home')); await kp.waitForTimeout(600);
  const off = await kp.evaluate(async () => {
    const A = AshtonkMania, r = {};
    r.tb = [...document.querySelectorAll('#toolbar .tb-btn')].filter(b => b.offsetWidth > 0).map(b => b.getAttribute('aria-label'));
    r.play = [...document.querySelectorAll('.lz-btn')].map(b => b.dataset.id); // (the menu's buttons, whichever row is showing)
    for (const s of ['multiplayer', 'dashboard', 'rankings', 'daily']) await A.Screens.go(s);
    r.screen = A.Screens.currentName;
    A.Chat.open(); r.chat = !!A.Chat.o;
    r.presence = A.Presence.started || !!A.Presence.ws;
    r.toast = [...document.querySelectorAll('#toasts .t-title')].some(t => /off in safe mode/.test(t.textContent));
    return r;
  });
  check('safe mode (chosen in the setup): no chat, who\'s online or rankings in the toolbar, Play is solo only, online screens and chat stay shut (saying why), no connection',
    !off.tb.some(l => /^(chat|dashboard|rankings)$/.test(l)) && off.tb.includes('beatmap listing') && off.play.includes('solo') && !off.play.some(id => /multi|daily|lounge|ranked/.test(id)) && off.screen === 'home' && !off.chat && !off.presence && off.toast, JSON.stringify(off));
  await kp.evaluate(() => AshtonkMania.Settings.set('online.safeMode', false)); await kp.waitForTimeout(400);
  check('safe mode off: the online features come back at once', await kp.evaluate(() => AshtonkMania.Presence.started && [...document.querySelectorAll('#toolbar .tb-btn')].some(b => b.offsetWidth > 0 && b.getAttribute('aria-label') === 'chat') && !!document.querySelector('.lz-btn[data-id=multi]')));
  // a filter's script sends the tab to its block page soon after the game opened → safe mode on next time, saying why
  await kp.reload(); await ready();
  check('a reload doesn\'t turn safe mode on', await kp.evaluate(() => !AshtonkMania.Settings.get('online.safeMode') && !document.querySelector('.dialog.popup')));
  await kp.evaluate(() => { setTimeout(() => { location.href = 'about:blank'; }, 50); }); await kp.waitForTimeout(1800);
  await kp.goto(url); await ready();
  check('the tab taken to another page soon after opening: safe mode is on next time, and says why', await kp.evaluate(() => AshtonkMania.Settings.get('online.safeMode') === true && !AshtonkMania.Presence.started && /Safe mode is on/.test((document.querySelector('.dialog.popup h2') || {}).textContent || '')));
  await kp.evaluate(() => [...document.querySelectorAll('.dialog.popup .pd-btn')].find(b => /Turn it off/.test(b.textContent)).click()); await kp.waitForTimeout(400);
  // the player leaving (a browser shortcut held as the page went) isn't a takeover
  await kp.keyboard.down('Control'); await kp.goto('about:blank'); await kp.keyboard.up('Control'); await kp.waitForTimeout(1800);
  await kp.goto(url); await ready();
  check('"Turn it off" turns it off, and leaving the game yourself (Ctrl+W) doesn\'t turn it back on', await kp.evaluate(() => !AshtonkMania.Settings.get('online.safeMode') && !document.querySelector('.dialog.popup')));
  await kctx.close();
}

{
  // a Web-Osu-Mania backup, imported from the first-run setup: beatmaps, settings, keybinds, scores and collections
  const wctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const wp = await wctx.newPage();
  wp.on('pageerror', e => errors.push('wom: ' + e.message));
  // the backup's collection also holds a set that isn't in it (999): the import downloads it
  await wp.route('**/api/health', r => r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  await wp.route('**/api/download/**', r => r.fulfill({ contentType: 'application/octet-stream', body: readFileSync(join(root, 'tests', 'fixtures', 'test-set.osz')) }));
  await wp.route('https://catboy.best/d/**', r => r.fulfill({ contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(join(root, 'tests', 'fixtures', 'test-set.osz')) }));
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
      skin: AshtonkMania.SkinManager.current.id, style: S.get('wom.style'), hue: S.get('wom.hue'), jud: S.get('wom.judgements'), ns: S.get('wom.noteScale'), hp: S.get('wom.hitPositionOffset'), dk: S.get('wom.darkerHolds'), el: S.get('wom.earlyLate'),
      col: (await AshtonkMania.DB.kvGet('collections')).find(c => c.name === 'WOM favourites'), downloaded: AshtonkMania.BeatmapManager.sets.filter(s => s.onlineId === 999).length };
  });
  check('Web-Osu-Mania backup: its stored beatmaps are imported', w.sets === 1, JSON.stringify(w));
  check('Web-Osu-Mania backup: settings and keybinds carry over', w.vol === 0.6 && w.speed === 27 && w.dir === 'up' && w.off === 12 && JSON.stringify(w.k4) === JSON.stringify([['KeyA', 'KeyZ'], ['KeyS'], ['KeyK'], ['KeyL']]), JSON.stringify(w));
  check('Web-Osu-Mania backup: its skin comes across (style, colour, judgements, note size, hit position)', w.skin === 'default' && w.style === 'diamonds' && w.hue === 120 && w.jud === 'fnf' && w.ns === 0.7 && w.hp === 150 && w.dk === false && w.el === 300, JSON.stringify(w));
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

// song select: a set's panel that stayed on screen while another set opened still opens when clicked (it kept the
// row it was drawn with, still marked open, and ignored the click), and a panel rebuilt or slid away between press
// and release still takes the click — once (not select-then-play)
{
  await page.evaluate(() => AshtonkMania.Screens.go('songselect', { force: true })); await page.waitForTimeout(900);
  const at = key => page.evaluate(k => { const el = AshtonkMania.SongSelect.pool.get(k); if (!el) return null; const r = el.firstChild.getBoundingClientRect(); return { x: r.left + 160, y: r.top + r.height / 2 }; }, key);
  const was = await page.evaluate(() => AshtonkMania.SongSelect.selectedId);
  const sets = await page.evaluate(() => [...AshtonkMania.SongSelect.pool.keys()].filter(k => k.startsWith('s:')));
  const cur = await page.evaluate(() => 's:' + AshtonkMania.SongSelect.expandedSet), other = sets.find(k => k !== cur);
  const out = { sets: sets.length };
  if (other) {
    let b = await at(other); await page.mouse.click(b.x, b.y); await page.waitForTimeout(600);
    out.toOther = await page.evaluate(() => 's:' + AshtonkMania.SongSelect.expandedSet) === other;
    b = await at(cur); if (b) { await page.mouse.click(b.x, b.y); await page.waitForTimeout(600); }
    out.back = await page.evaluate(() => 's:' + AshtonkMania.SongSelect.expandedSet) === cur;
  }
  const d = await page.evaluate(() => { const S = AshtonkMania.SongSelect; return [...S.pool.keys()].find(k => k.startsWith('d:') && k !== 'd:' + S.selectedId) || null; });
  if (d) {
    const b = await at(d); await page.mouse.move(b.x, b.y); await page.mouse.down();
    await page.evaluate(() => AshtonkMania.SongSelect.renderVisible(true)); await page.mouse.up(); await page.waitForTimeout(400);
    out.rebuilt = await page.evaluate(k => 'd:' + AshtonkMania.SongSelect.selectedId === k, d);
    out.stillHere = await page.evaluate(() => AshtonkMania.Screens.currentName === 'songselect');
  }
  await page.evaluate(id => AshtonkMania.SongSelect.select(id), was); await page.waitForTimeout(500);
  check('song select: clicking songs always works — a set that stayed on screen reopens, a panel rebuilt under the pointer takes the click once',
    (!other || (out.toOther && out.back)) && (!d || (out.rebuilt && out.stillHere)) && (other || d), JSON.stringify(out));
}

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
// the toolbar button of what's open lights up whole (not a dot in its corner), and a status shows on the avatar
const tbOn = await page.evaluate(async () => {
  const st = document.querySelector('.tb-btn.on > .tb-st'), r = st && st.getBoundingClientRect(), btn = st && st.parentElement.getBoundingClientRect();
  Toolbar.setStatus('dnd');
  await new Promise(res => setTimeout(res, 300));
  const dot = document.querySelector('.tb-av > .tb-st.dnd'), op = dot ? +getComputedStyle(dot).opacity : null; // (read before the dot goes)
  Toolbar.setStatus('online');
  return { w: r && Math.round(r.width), bw: btn && Math.round(btn.width), dot: op };
});
check('toolbar: the open overlay\'s button lights up, and a status dot shows on the avatar', tbOn.w >= tbOn.bw - 10 && tbOn.dot === 1, JSON.stringify(tbOn));
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);

// the same toast again refreshes the one on screen instead of stacking copies
const dupToasts = await page.evaluate(() => { const T = AshtonkMania.Toast; T.clear(); for (let i = 0; i < 4; i++) T.err('Same thing', 'again'); T.ok('Something else'); return document.querySelectorAll('#toasts .toast:not(.out)').length; });
check('identical toasts don\'t stack', dupToasts === 2, String(dupToasts));

{
  // a phone, as lazer's app: the game is used sideways and gameplay is upright. The stage fits, each column takes
  // touches, and a pause button stands in for Escape
  const mctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const mp = await mctx.newPage();
  mp.on('pageerror', e => errors.push('mobile: ' + e.message));
  await mp.goto(url);
  await mp.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await mp.waitForSelector('.mob-inst', { timeout: 30000 });
  check('phone: opening in the browser recommends the app straight away, saying the browser isn\'t recommended', /not recommended/.test(await mp.textContent('.mob-inst')));
  await mp.click('.mob-inst-skip'); await mp.waitForTimeout(400);
  await mp.waitForSelector('.ob-name', { timeout: 30000 }); await mp.fill('.ob-name', 'Phone'); await mp.keyboard.press('Enter'); await mp.waitForTimeout(300);
  await mp.evaluate(() => AshtonkMania.Onboarding.finish()); await mp.waitForFunction(() => !document.querySelector('.setup'));
  await mp.evaluate(async () => { const b = await (await fetch('/tests/fixtures/test-set.osz')).blob(); await AshtonkMania.App.importFiles([new File([b], 'test-set.osz')]); });
  {
    // a long press is a right-click (iOS sends no contextmenu for one, and the press ended as a tap that started the song)
    await mp.evaluate(() => AshtonkMania.Screens.go('songselect', { force: true })); await mp.waitForTimeout(1500);
    const at = await mp.evaluate(() => { const r = document.querySelector('.diff-panel').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; });
    const cdp0 = await mctx.newCDPSession(mp);
    await cdp0.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at[0], y: at[1], id: 1 }] }); await mp.waitForTimeout(800);
    await cdp0.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await mp.waitForTimeout(500);
    const lp = await mp.evaluate(() => ({ menu: /Practice/.test(document.querySelector('.menu')?.textContent || ''), scr: AshtonkMania.Screens.currentName }));
    check('phone: a long press on a beatmap opens its options (like a right-click), and doesn\'t start the song', lp.menu && lp.scr === 'songselect', JSON.stringify(lp));
    await mp.keyboard.press('Escape'); await mp.waitForTimeout(300);
  }
  await mp.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.Screens.go('gameplay', { mapId: m.id, mods: [], force: true }); });
  await mp.waitForTimeout(4000);
  // sideways: the song plays as it is (no prompt), the screen's width split evenly between the columns for touches
  const side = await mp.evaluate(() => { const G = AshtonkMania.GameplayScreen, r = G.renderer, b = G.canvas.parentElement.getBoundingClientRect();
    return { prompt: !document.querySelector('.rot-prompt').hidden, running: !!(G.s && G.s.running), cols: [0.1, 0.3, 0.6, 0.9].map(f => r.columnAt(b.left + b.width * f)) }; });
  check('phone sideways: gameplay plays sideways too (no prompt), each quarter of the screen a column', !side.prompt && side.running && side.cols.join() === '0,1,2,3', JSON.stringify(side));
  // turned upright mid-song: it waits for a tap, then plays on upright
  await mp.setViewportSize({ width: 390, height: 844 });
  await mp.waitForSelector('.gp-tap', { timeout: 5000 }); await mp.tap('.gp-tap');
  await mp.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 20000 });
  await mp.waitForFunction(() => { const r = AshtonkMania.GameplayScreen.renderer; return r && r.H > r.W; }, null, { timeout: 5000 }); // (laid out upright)
  check('phone upright in gameplay: no prompt', await mp.evaluate(() => document.querySelector('.rot-prompt').hidden));
  const fit = await mp.evaluate(() => { const r = AshtonkMania.GameplayScreen.renderer; return r.stageX >= 0 && r.stageX + r.stageW <= r.W + 1; });
  check('phone upright: the playfield fits across the screen', fit);
  check('phone: laid out as FNF plays on phones (arrow-sized columns side by side, a full-height hitbox per column) in your own skin', await mp.evaluate(() => { const S = AshtonkMania.Settings, r = AshtonkMania.GameplayScreen.renderer, size = Math.min(r.H * 0.2 * S.get('gameplay.laneWidth'), r.W * 0.96 / 4);
    return S.get('wom.style') !== 'arrows' && S.get('wom.judgements') !== 'fnf' && r.colW.every(w => Math.abs(w - size) < 0.5) && Math.abs(r.colX[1] - size) < 0.5 && document.querySelectorAll('.fnf-hitbox i').length === 4; }));
  check('phone: notes fall at a computer\'s speed — as many column widths a second as at the same scroll speed there', await mp.evaluate(() => { const r = AshtonkMania.GameplayScreen.renderer;
    return Math.abs(r.scrollLength - 402 * r.colW[0] / r.layout.columnWidth[0]) < 0.01; }));
  check('phone: columns are wide finger targets (the stage spans the screen\'s width)', await mp.evaluate(() => { const r = AshtonkMania.GameplayScreen.renderer; return r.colW.every(w => w >= r.W * 0.22); }));
  check('phone: no blue tap highlight (feels like an app)', await mp.evaluate(() => document.documentElement.classList.contains('touch') && /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(document.documentElement).webkitTapHighlightColor)));
  const cdp = await mctx.newCDPSession(mp), held = [];
  for (let i = 0; i < 4; i++) {
    const x = (i + 0.5) / 4 * 390; // (FNF hitboxes: the screen in four strips)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 600, id: i }] });
    await mp.waitForTimeout(40);
    held.push(await mp.evaluate(() => AshtonkMania.GameplayScreen.s.held.map(Number).join('')));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mp.waitForTimeout(30);
  }
  check('phone: touching a column holds that column, letting go releases it', held.join() === '1000,0100,0010,0001' && await mp.evaluate(() => !AshtonkMania.GameplayScreen.s.held.some(Boolean)), held.join());
  // turning the phone / leaving fullscreen mid-song: lazer's "click to resume" instead of the pause menu
  await mp.evaluate(() => AshtonkMania.GameplayScreen.tapToResume()); await mp.waitForTimeout(300);
  const tapUp = await mp.evaluate(() => ({ tap: !!document.querySelector('.gp-tap'), menu: !!document.querySelector('.pause-menu'), running: AshtonkMania.GameplayScreen.s.running }));
  await mp.tap('.gp-tap'); await mp.waitForTimeout(200);
  await mp.waitForFunction(() => AshtonkMania.GameplayScreen.s.running, null, { timeout: 6000 });
  check('phone: a paused song shows "Tap to resume" (no pause menu), and a tap carries on', tapUp.tap && !tapUp.menu && !tapUp.running && await mp.evaluate(() => !document.querySelector('.gp-tap')), JSON.stringify(tapUp));
  await mp.tap('.hud-touch-pause'); await mp.waitForTimeout(400);
  check('phone: the on-screen pause button pauses', !!(await mp.$('.pause-menu')));
  // ...and it's there in every kind of play (Auto here), even with the HUD hidden
  await mp.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.Screens.go('gameplay', { mapId: m.id, mods: ['AT'], force: true }); });
  await mp.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running, null, { timeout: 20000 });
  await mp.evaluate(() => AshtonkMania.GameplayScreen.hud.classList.add('hidden-hud')); await mp.waitForTimeout(300);
  const autoPause = await mp.evaluate(() => { const b = document.querySelector('.hud-touch-pause'); if (!b) return null; const r = b.getBoundingClientRect(); return { vis: getComputedStyle(b).visibility, w: r.width, top: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b }; });
  await mp.tap('.hud-touch-pause'); await mp.waitForTimeout(400);
  check('phone: the pause button is there in Auto too, with the HUD hidden, and pauses', !!(autoPause && autoPause.vis === 'visible' && autoPause.w > 20 && autoPause.top) && !!(await mp.$('.pause-menu')), JSON.stringify(autoPause));
  await mp.evaluate(() => AshtonkMania.Screens.go('home', {}, {})); await mp.setViewportSize({ width: 390, height: 844 }); await mp.waitForTimeout(500);
  await mp.evaluate(() => { const H = AshtonkMania.Screens.current; if (H.setState) H.setState('top'); }); await mp.waitForTimeout(900);
  check('phone: the whole app fits the visible screen (its bottom isn\'t cut off)', await mp.evaluate(() => { const r = document.querySelector('#app').getBoundingClientRect(); return Math.abs(r.bottom - innerHeight) < 2 && Math.abs(r.right - innerWidth) < 2; }));
  await mp.waitForTimeout(700);
  check('phone upright in the menus: asked to turn sideways (the game is used sideways, as lazer\'s app)', await mp.evaluate(() => !document.querySelector('.rot-prompt').hidden && /sideways/.test(document.querySelector('.rot-prompt').textContent)));
  await mp.setViewportSize({ width: 844, height: 390 }); await mp.waitForTimeout(500);
  const land = await mp.evaluate(() => ({ rot: !document.querySelector('.rot-prompt').hidden, z: AshtonkMania.Zoom.z, w: document.querySelector('#app').offsetWidth }));
  check('phone sideways: the desktop interface scaled to the screen as on lazer for Android, at the phone\'s 125% UI scale (no rotate prompt)', !land.rot && land.z > 1.3 && Math.abs(land.w - 844 / (Math.min(844 / 1366, 390 / 768) * 1.25)) < 6, JSON.stringify(land));
  {
    // a tablet-shaped screen and many keys: the stage spans it, so the skin's health bar beside it would be off the
    // edge — lazer's bar at the top instead; with fewer keys the skin's bar stays beside the stage
    await mp.setViewportSize({ width: 1024, height: 768 }); await mp.waitForTimeout(400);
    const hpFor = async v => {
      await mp.evaluate(v => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === v); AshtonkMania.Screens.go('gameplay', { mapId: m.id, mods: ['AT'], force: true }); }, v);
      await mp.waitForFunction(v => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running && AshtonkMania.GameplayScreen.s.rec.version === v, v, { timeout: 20000 });
      return mp.evaluate(() => { const G = AshtonkMania.GameplayScreen, r = G.renderer; return { hm: G.healthMode, off: !!r.healthMode && r.stageX + r.stageW + r._cropMargins()[1] > r.W }; });
    };
    const nine = await hpFor('9K Expert'), four = await hpFor('4K Normal');
    check('touch screen: a stage spanning the screen gets lazer\'s health bar at the top (the skin\'s beside it would be off the edge)', nine.hm === 'lazer' && !nine.off && four.hm !== 'lazer' && !four.off, JSON.stringify({ nine, four }));
  }
  {
    // practice on a touch screen: the tools sat over the first column — while the song plays a touch there is the
    // column's; paused, the tools are above the pause screen to use
    await mp.setViewportSize({ width: 844, height: 390 }); await mp.waitForTimeout(400);
    await mp.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.Screens.go('gameplay', { mapId: m.id, mods: [], mode: 'practice', force: true }); });
    await mp.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running && document.querySelector('.practice-bar'), null, { timeout: 20000 });
    const hit = () => mp.evaluate(() => { const b = [...document.querySelectorAll('.practice-bar button')].find(x => /Set A/.test(x.textContent)), r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); });
    const playing = await hit();
    await mp.tap('.hud-touch-pause'); await mp.waitForTimeout(500);
    const paused = await hit();
    check('phone practice: the tools let touches through to the column while the song plays, and are there to use when paused', !playing && paused, JSON.stringify({ playing, paused }));
  }
  {
    // watching Auto / a replay on a phone: a tap brings up the playback controls (moving the mouse does on a computer)
    await mp.evaluate(() => { const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); AshtonkMania.Screens.go('gameplay', { mapId: m.id, mods: ['AT'], force: true }); });
    await mp.waitForFunction(() => AshtonkMania.GameplayScreen.s && AshtonkMania.GameplayScreen.s.running && document.querySelector('.replay-bar'), null, { timeout: 20000 });
    await mp.waitForTimeout(600);
    const op = () => mp.evaluate(() => getComputedStyle(document.querySelector('.replay-bar')).opacity);
    const before = await op();
    await mp.touchscreen.tap(420, 200); await mp.waitForTimeout(400);
    const after = await op();
    check('phone: watching Auto, a tap brings up the playback controls', before === '0' && after === '1', JSON.stringify({ before, after }));
  }
  await mctx.close();
}

// lazer's Manage collections dialog: typing in the last box makes a collection, the name boxes rename in place
{
  await page.evaluate(() => AshtonkMania.ManageCollections.open()); await page.waitForTimeout(400);
  await page.click('.mc-item.new .mc-name'); await page.keyboard.type('Dialog made'); await page.waitForTimeout(700);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const mc = await page.evaluate(() => ({ made: AshtonkMania.Collections.list.some(c => c.name === 'Dialog made'), open: !!document.querySelector('.mc-dialog:not(.out)') }));
  check('Manage collections (lazer\'s dialog): typing in "Create a new collection" makes one, Esc closes it', mc.made && !mc.open, JSON.stringify(mc));
  await page.evaluate(async () => { const c = AshtonkMania.Collections.list.find(c => c.name === 'Dialog made'); if (c) await AshtonkMania.Collections.remove(c.id); });
}
// song select's right-click menu: "Add to collection…" lists the collections, ticking one adds the difficulty
{
  const r = await page.evaluate(async () => {
    const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => !x.problems.length);
    const c = await AshtonkMania.Collections.create('Right-click made');
    await AshtonkMania.Screens.go('songselect', { mapId: m.id }); await new Promise(r => setTimeout(r, 600));
    AshtonkMania.SongSelect.options({ clientX: 700, clientY: 300 }, m);
    const pick = label => [...document.querySelectorAll('.menu button')].find(b => b.textContent.includes(label));
    const add = pick('Add to collection'); if (!add) return { add: false };
    add.click(); await new Promise(r => setTimeout(r, 300));
    const item = pick('Right-click made'); if (!item) return { add: true, item: false };
    item.click(); await new Promise(r => setTimeout(r, 300));
    const inIt = c.hashes.includes(m.hash);
    await AshtonkMania.Collections.remove(c.id);
    return { add: true, item: true, inIt };
  });
  check('song select right-click: "Add to collection…" lists the collections and adds the difficulty', r.add && r.item && r.inIt, JSON.stringify(r));
}
// results: picking another score's panel swaps it into the middle; leaving afterwards leaves nothing behind
{
  const ok = await page.evaluate(async () => { const SM = AshtonkMania.ScoreManager, s = SM.scores.find(x => x.passed && SM.forMap(x.mapHash).filter(y => y.passed).length > 1);
    if (!s) return false; AshtonkMania.Screens.go('results', { score: s, fromList: true }); return true; });
  if (ok) {
    await page.waitForSelector('.cp.cp-click', { timeout: 5000 });
    const before = await page.evaluate(() => document.querySelector('.res-grid > .rs .rs-score, .res-grid > .rs')?.textContent.slice(0, 200));
    await page.click('.cp.cp-click'); await page.waitForTimeout(700);
    const after = await page.evaluate(() => document.querySelector('.res-grid > .rs .rs-score, .res-grid > .rs')?.textContent.slice(0, 200));
    await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
    const left = await page.evaluate(() => ({ screen: AshtonkMania.Screens.currentName, stray: document.querySelectorAll('.results, .res-grid, .cp').length }));
    check('results: picking another score swaps it into the middle, and going back leaves nothing of the results behind', before !== after && left.screen !== 'results' && left.stray === 0, JSON.stringify(left));
  }
}
// results never scroll: with the statistics and "More statistics" open, in a small window, the panels shrink to fit
{
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.evaluate(() => { const S = AshtonkMania.ScoreManager.scores.find(s => s.passed); AshtonkMania.Screens.go('results', { score: S, fromList: true }); });
  await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'results'); await page.waitForTimeout(800);
  await page.evaluate(() => { const g = [...document.querySelectorAll('.res-grid')].pop(); g.classList.add('stats-open'); const d = g.querySelector('.res-more'); if (d) d.open = true; });
  await page.waitForTimeout(600);
  const rf = await page.evaluate(() => { const b = [...document.querySelectorAll('.res-body')].pop(), g = [...document.querySelectorAll('.res-grid')].pop(), B = b.getBoundingClientRect(), G = g.getBoundingClientRect();
    return { inside: G.top >= B.top - 1 && G.bottom <= B.bottom + 1 && G.left >= B.left - 1 && G.right <= B.right + 1, scroll: b.scrollHeight > b.clientHeight + 1 && getComputedStyle(b).overflowY !== 'hidden', scale: g.style.scale }; });
  check('results: everything fits on screen without scrolling, even with all statistics open in a small window', rf.inside && !rf.scroll, JSON.stringify(rf));
  await page.setViewportSize({ width: 1600, height: 900 });
}
// another player's profile is open to anyone, and each of their scores opens on the results screen
{
  await page.evaluate(() => AshtonkMania.Screens.go('profile', { pid: 'someoneelse1', name: 'Zed', force: true })); await page.waitForTimeout(500);
  await page.evaluate(() => AshtonkMania.Bus.emit('profile:remote', { t: 'profile', pid: 'someoneelse1', name: 'Zed', data: { ...AshtonkMania.ProfileScreen.summary(), name: 'Zed' }, verified: { pp: 123 }, online: false, status: 'offline' }));
  await page.waitForTimeout(400);
  const n = await page.evaluate(() => document.querySelectorAll('.pf-score.remote').length);
  await page.evaluate(() => document.querySelector('.pf-score.remote').click());
  await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'results', null, { timeout: 4000 }).catch(() => {}); await page.waitForTimeout(600);
  const rr = await page.evaluate(() => ({ scr: AshtonkMania.Screens.currentName, name: [...document.querySelectorAll('.rs-name')].pop()?.textContent, tag: !!document.querySelector('.rs-tag') }));
  check('someone else\'s profile scores open on the results screen, under their name', n > 0 && rr.scr === 'results' && rr.name === 'Zed' && !rr.tag, JSON.stringify({ n, ...rr }));
  // a player whose game hasn't sent a profile still has one: what the server knows of them
  await page.evaluate(() => AshtonkMania.Screens.go('profile', { pid: 'quietplayer1', name: 'Quiet', force: true })); await page.waitForTimeout(400);
  await page.evaluate(() => AshtonkMania.Bus.emit('profile:remote', { t: 'profile', pid: 'quietplayer1', name: 'Quiet', data: null, rank: 7, verified: { pp: 321, acc: 0.95, plays: 40, ss: 1, s: 2, a: 3 }, online: false, status: 'offline' }));
  await page.waitForTimeout(400);
  const qp = await page.evaluate(() => ({ name: [...document.querySelectorAll('.pf-name')].pop()?.textContent, pp: [...document.querySelectorAll('.pf-big b')].map(b => b.textContent).join(' '), empty: !!document.querySelector('.rk-empty') }));
  check('a player who hasn\'t sent a profile still has one (name, rank, pp from the server)', qp.name === 'Quiet' && /#7/.test(qp.pp) && /321pp/.test(qp.pp) && !qp.empty, JSON.stringify(qp));
  await page.evaluate(() => AshtonkMania.Screens.go('home')); await page.waitForTimeout(400);
  // renaming yourself renames your own scores and replays
  const ren = await page.evaluate(async () => { const PM = AshtonkMania.ProfileManager, old = PM.profile.name; await PM.setName('Renamed'); const sc = AshtonkMania.ScoreManager.scores.filter(s => s.own || s.player === 'Renamed').length, bad = AshtonkMania.ScoreManager.scores.filter(s => s.player === old).length, rp = AshtonkMania.ReplayManager.list.filter(r => r.player === old).length; await PM.setName(old); return { sc, bad, rp }; });
  check('changing your name changes it on your scores and replays', ren.sc > 0 && ren.bad === 0 && ren.rp === 0, JSON.stringify(ren));
}
// the profile's cover is the background of your highest-pp play
{
  await page.evaluate(() => AshtonkMania.Screens.go('profile')); await page.waitForTimeout(800);
  const pc = await page.evaluate(async () => { const SM = AshtonkMania.ScoreManager, BM = AshtonkMania.BeatmapManager, top = SM.bestPpPerMap().map(t => BM.mapByHash(t.score.mapHash)).find(Boolean);
    const want = top && await BM.bgURL(top), got = (document.querySelector('.pf-cover').style.backgroundImage.match(/url\("(.*)"\)/) || [])[1]; return { ok: !top || !want || got === want, want, got }; });
  check('profile: the cover is your top pp play\'s background', pc.ok, JSON.stringify(pc));
}

// medals: a play unlocks what it earned, shown with lazer's medal animation once off gameplay; the profile lists them
{
  await page.evaluate(() => { AshtonkMania.Screens.go('home'); AshtonkMania.Settings.set('medals.unlocked', {}); AshtonkMania.Medals.check({ passed: true, mods: [], rate: 1, stars: 2.4, keys: 4, counts: [80, 0, 0, 0, 0, 0], grade: 'SS', maxCombo: 80 }); });
  await page.waitForSelector('.medal-ov', { timeout: 5000 });
  const got = await page.evaluate(() => Object.keys(AshtonkMania.Medals.unlocked()).sort().join());
  check('medals: a play unlocks the ones it earned (pass, full combo, SS by stars) with the medal animation', /first/.test(got) && /pass2/.test(got) && !/pass3/.test(got) && /fc2/.test(got) && /\bss\b/.test(got) && await page.evaluate(() => /MEDAL UNLOCKED/.test(document.querySelector('.medal-ov').textContent)), got);
  for (let i = 0; i < 8 && await page.$('.medal-ov'); i++) { await page.click('.medal-ov'); await page.waitForTimeout(1700); }
  await page.evaluate(() => AshtonkMania.Screens.go('profile')); await page.waitForTimeout(700);
  check('medals: the profile shows earned medals lit and the rest dimmed', await page.evaluate(() => document.querySelectorAll('.md-badge.on').length >= 6 && document.querySelectorAll('.md-badge:not(.on)').length > 0));
}

// dangerous dialog buttons (red): a single press confirms, no holding
{
  await page.evaluate(() => { window.__dc = AshtonkMania.Dialog.confirm('Delete thing?', 'x', { ok: 'Delete', danger: true }).then(v => { window.__dcv = v; }); });
  await page.waitForSelector('.dialog .pd-btn.danger'); await page.waitForTimeout(400);
  const b = await (await page.$('.dialog .pd-btn.danger')).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ open: !!document.querySelector('.dialog:not(.out) .pd-btn.danger'), v: window.__dcv }));
  check('dangerous dialog button: one press confirms (no holding)', !after.open && after.v === true, JSON.stringify(after));
}

// lazer's skin editor (Ctrl+Shift+S): the game shrinks with Auto playing, and a component dragged there stays moved in a play
{
  await page.keyboard.press('Control+Shift+KeyS');
  await page.waitForSelector('.se-box', { timeout: 20000 });
  await page.waitForTimeout(800);
  const boxOf = name => page.evaluate(n => { const b = [...document.querySelectorAll('.se-box')].find(b => b.querySelector('.se-label').textContent === n); if (!b) return null; const r = b.getBoundingClientRect(); const hd = b.querySelector('.se-handle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, hx: hd.x + hd.width / 2, hy: hd.y + hd.height / 2, scale: +AshtonkMania.GameplayScreen.el.style.scale }; }, name);
  const box = await boxOf('Score');
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x - 120, box.y + 90, { steps: 6 }); await page.mouse.up();
  const L = await page.evaluate(() => AshtonkMania.Settings.get('hud.layout'));
  // the combo counter (drawn with the stage) has its own box too: moved, then made bigger from its corner
  await page.waitForFunction(() => [...document.querySelectorAll('.se-box .se-label')].some(l => l.textContent === 'Combo counter'), null, { timeout: 15000 }).catch(() => {});
  const cb = await boxOf('Combo counter');
  if (cb) {
    await page.mouse.move(cb.x, cb.y); await page.mouse.down(); await page.mouse.move(cb.x + 60, cb.y + 40, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(200); // (the box is drawn where it went on the next frames: its handle is read from there)
    const cb2 = await boxOf('Combo counter');
    await page.mouse.move(cb2.hx, cb2.hy); await page.mouse.down(); await page.mouse.move(cb2.hx + 40, cb2.hy + 30, { steps: 5 }); await page.mouse.up();
  }
  const C = await page.evaluate(() => AshtonkMania.Settings.get('hud.layout').combo || null);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  const back = await page.evaluate(() => [AshtonkMania.Screens.currentName, !!document.querySelector('.se')]);
  check('skin editor: the game shrinks, dragging the score moves only the score (accuracy, pp and mods stay), and Esc closes back',
    box.scale > 0.3 && box.scale < 1 && L.sc && L.sc.x < -0.05 && L.sc.y > 0.05 && !L.acc && !L.pp && !L.mods && back[0] !== 'gameplay' && !back[1], JSON.stringify({ box, L, back }));
  check('skin editor: the combo counter can be moved and resized on its own', !!(C && C.x > 0.01 && C.y > 0.01 && C.s > 1), JSON.stringify(C));
  // a layout saved when score, accuracy, pp and mods moved as one block: each of the four takes its place
  const mig = await page.evaluate(() => { const S = AshtonkMania.Settings; S.set('hud.layout', { score: { x: 0.1, s: 1.2 } }); const L = AshtonkMania.HudLayout.get(); return { keys: Object.keys(L).sort().join(), sc: L.sc, mods: L.mods, saved: Object.keys(S.get('hud.layout')).sort().join() }; });
  check('skin editor: an older layout (score block) becomes the four separate parts', mig.keys === 'acc,mods,pp,sc' && mig.sc.x === 0.1 && mig.mods.s === 1.2 && mig.saved === 'acc,mods,pp,sc', JSON.stringify(mig));
  await page.evaluate(() => AshtonkMania.Settings.set('hud.layout', {}));
}

// lazer's F12 screenshot: in gameplay it's put together from the game's layers, at the screen's size
{
  await page.evaluate(() => { window.__shots = []; window.downloadBlob = (b, n) => window.__shots.push({ b, n }); const M = AshtonkMania, m = [...M.BeatmapManager.maps.values()].find(x => x.version === '4K Normal'); M.Game.launch({ mapId: m.id, mods: ['AT'], mode: 'play' }); });
  await page.waitForTimeout(5000);
  await page.keyboard.press('F12'); await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => { const s = window.__shots[0]; if (!s) return null; const bmp = await createImageBitmap(s.b); return { n: s.n, w: bmp.width, h: bmp.height, type: s.b.type }; });
  check('F12 in gameplay saves a PNG screenshot of the screen', !!r && r.type === 'image/png' && r.w >= 800 && /^ashtonk!mania \d{4}-\d\d-\d\d .*\.png$/.test(r.n), JSON.stringify(r));
  await page.evaluate(() => AshtonkMania.GameplayScreen.quit()); await page.waitForTimeout(1200);
}

const realErrors = errors.filter(e => !/favicon|fonts\.g|ERR_CERT|ERR_NAME|ERR_INTERNET|ERR_FAILED|status of 404/.test(e));
check('no uncaught page errors', realErrors.length === 0, realErrors.slice(0, 8).join('\n'));
await browser.close();
server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
