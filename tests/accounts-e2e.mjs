// Your code across devices, against the real game server (worker/ in workerd through Miniflare): get your code on one
// device, type it on another that already played as a player of its own (a save imported there), and there is one of
// you on the rankings; wrong codes, a new code, signing other devices out and the limit on tries.
// Usage: MINIFLARE_DIR=<dir with node_modules/miniflare> node tests/accounts-e2e.mjs
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
  durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker', VAULT: 'PlayerVault' },
  bindings: { TEST_ALL_RANKED: '1' },
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

/** The setup's first page: "No, I'm new", then the name. */
async function setupName(pg, name) {
  if (await pg.$('.setup-choice[data-id="new"]')) await pg.click('.setup-choice[data-id="new"]');
  await pg.fill('.onboarding .ob-name', name); await pg.keyboard.press('Enter');
}
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? '  — ' + extra : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];

/** A device: its own browser profile, set up as `name`, with the test beatmaps. */
async function device(name, label) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${label} pageerror: ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  if (await page.$('.onboarding')) { await setupName(page, name); await page.waitForSelector('.setup-step-wom'); await page.evaluate(() => AshtonkMania.Onboarding.finish()); await page.waitForTimeout(300); }
  await page.evaluate(() => AshtonkMania.Settings.set('medals.unlocked', Object.fromEntries(AshtonkMania.Medals.all.map(m => [m.id, 1]))));
  await page.evaluate(async () => { const b = await (await fetch('/tests/fixtures/test-set.osz')).blob(); await AshtonkMania.App.importFiles([new File([b], 'test-set.osz')]); });
  await page.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length === 1, null, { timeout: 15000 });
  await page.waitForFunction(() => AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1 && AshtonkMania.Presence.me, null, { timeout: 15000 });
  return page;
}
/** A perfect play (as Auto plays it) on one difficulty, sent to be judged. */
const play = (page, version) => page.evaluate(async v => {
  const m = [...AshtonkMania.BeatmapManager.maps.values()].find(x => x.version === v);
  const { notes } = await AshtonkMania.BeatmapManager.load(m.id);
  return Verified.submit({ rec: m, mods: [], modConfig: {}, seed: 1, events: generateAutoInputs(prepareNotes(notes, m.keys, [], 1), m.keys).flat() });
}, version);
const rankings = page => page.evaluate(() => new Promise(res => {
  const off = AshtonkMania.Bus.on('rankings', m => { off(); res({ total: m.total, names: m.list.map(x => x.name), pids: m.list.map(x => x.pid) }); });
  AshtonkMania.Presence.send({ t: 'rankings' });
}));
const toasts = page => page.evaluate(() => document.querySelector('#toasts').textContent);
/** A finished play kept on the device (as the game keeps one: with its hit-by-hit timing and health over time). */
const keepScore = (page, extra) => page.evaluate(async extra => {
  const A = AshtonkMania, m = [...A.BeatmapManager.maps.values()][0] || {};
  const s = await A.ScoreManager.add({ id: 'sc-' + Math.random().toString(36).slice(2, 12), mapHash: m.hash, mapId: m.id, setId: m.setId, title: m.title, artist: m.artist, version: m.version, creator: m.creator,
    keys: m.keys || 4, stars: 2.5, pp: 12, mods: [], rate: 1, score: 900000, scoreStd: 950000, accuracy: 0.97, maxCombo: 300, counts: [200, 50, 10, 0, 0, 2], grade: 'A', passed: true,
    date: Date.now(), duration: 60000, player: A.ProfileManager.profile.name, own: true, meanError: -3.2, unstableRate: 120, windows: [16, 40, 73, 103, 127, 164], replayId: null, srVersion: SR_VERSION,
    hitErrors: Array.from({ length: 400 }, (_, i) => [i * 100, 5, 0]), healthTimeline: [[0, 1], [1000, 0.9]], ...extra });
  return s.id;
}, extra || {});
/** Your settings, skin and plays sent now (and what your other devices sent asked for straight away). */
const syncNow = page => page.evaluate(async () => { const S = AshtonkMania.Sync; while (S._pushing) await new Promise(r => setTimeout(r, 50)); S._pulledAt = 0; await S.push(); });
const closePanel = async page => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.login-panel'), null, { timeout: 3000 }); };
const typeCode = async (page, code) => {
  await page.evaluate(() => AshtonkMania.CodePanel.open({ use: true }));
  await page.waitForSelector('.login-panel .lp-code-in');
  await page.fill('.login-panel .lp-code-in', code);
  await page.press('.login-panel .lp-code-in', 'Enter');
};

try {
  // ── device A: plays, then gets its code from the menu under its name
  const a = await device('Kai', 'A');
  const sa = await play(a, '4K Normal');
  check('device A\'s play is judged and counted', sa && sa.ok, JSON.stringify(sa && { ok: sa.ok, pp: sa.pp }));
  const pidA = await a.evaluate(() => AshtonkMania.Presence.pid());
  await a.click('.tb-profile', { button: 'right' });
  await a.click('.menu >> text=Your code');
  await a.waitForSelector('.login-panel');
  const tabs = await a.$$eval('.login-panel .lp-tab', t => t.map(x => x.textContent));
  check('the menu under your name has Your code: two tabs, My code and Use a code (no username or password)', tabs.join('|') === 'My code|Use a code' && !(await a.$('.login-panel input[type=password]')), tabs.join('|'));
  // (the code was made at setup, "No, I'm new"): hidden until you click it
  check('the code from setup is under My code, hidden until you ask to see it', /^[•-]+$/.test(await a.textContent('.login-panel .lp-code')));
  await a.click('.login-panel .lp-codebox');
  await a.waitForFunction(() => /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test((document.querySelector('.login-panel .lp-code') || {}).textContent || ''), null, { timeout: 8000 });
  const code = await a.textContent('.login-panel .lp-code');
  check('…clicked: 16 characters in fours, the one setup showed', /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/.test(code) && code === await a.evaluate(() => AshtonkMania.Account.code()), code);
  check('…the player is the same as before (the code is for who you already are)', await a.evaluate(() => AshtonkMania.Presence.pid()) === pidA);
  await closePanel(a);
  await a.evaluate(() => AshtonkMania.CodePanel.open()); await a.waitForSelector('.login-panel .lp-code');
  check('opened again later, the code is hidden until you ask to see it', /^[•-]+$/.test(await a.textContent('.login-panel .lp-code')));
  await closePanel(a);

  // ── device B: a save imported onto another device, playing as a player of its own — two of Kai
  const b = await device('Kai', 'B');
  const sb = await play(b, '7K Hard');
  check('device B has a judged play of its own', sb && sb.ok, JSON.stringify(sb && { ok: sb.ok, pp: sb.pp }));
  await b.waitForTimeout(300);
  check('before the code: Kai is on the rankings twice (one for each device)', (await rankings(b)).total === 2);
  const pidB = await b.evaluate(() => AshtonkMania.Presence.pid());
  // a wrong code: the same answer as any wrong code, after the same pause
  const wrongT = Date.now();
  await typeCode(b, 'AAAA-BBBB-CCCC-DDDD');
  await b.waitForSelector('.login-panel .lp-err:not([hidden])');
  check('a wrong code is turned down ("doesn\'t belong to anyone"), and this device stays as it was', /doesn't belong to anyone/i.test(await b.textContent('.login-panel .lp-err')) && Date.now() - wrongT >= 380 && await b.evaluate(() => AshtonkMania.Presence.pid()) === pidB);
  // the right one, typed carelessly: lower case, no dashes, an O for a 0
  const sloppy = code.replace(/-/g, '').toLowerCase().replace(/0/g, 'o');
  await b.fill('.login-panel .lp-code-in', sloppy);
  check('…the code box tidies what you type (capitals, a dash every four)', /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(await b.inputValue('.login-panel .lp-code-in')));
  await b.press('.login-panel .lp-code-in', 'Enter');
  await b.waitForFunction(() => AshtonkMania.Account.linked() && !document.querySelector('.login-panel'), null, { timeout: 10000 });
  const linked = await b.evaluate(() => ({ pid: AshtonkMania.Presence.pid(), name: AshtonkMania.ProfileManager.profile.name }));
  check('device B takes the code: the same player as device A', linked.pid === pidA && linked.name === 'Kai', JSON.stringify(linked));
  check('…it says what it had is part of you now', /part of you now/i.test(await toasts(b)));
  await b.waitForFunction(() => AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1 && AshtonkMania.Presence.me, null, { timeout: 10000 });
  await b.waitForTimeout(300);
  const after = await rankings(b);
  check('after the code: one Kai on the rankings', after.total === 1 && after.pids[0] === pidA, JSON.stringify(after));
  await a.waitForFunction(() => /A new device is playing as you/.test(document.querySelector('#toasts').textContent), null, { timeout: 5000 }).catch(() => {});
  check('device A is told a new device is playing as it (with what to do if it wasn\'t you)', /A new device is playing as you/.test(await toasts(a)) && !/A new device is playing as you/.test(await toasts(b)));
  const prof = await a.evaluate(pid => new Promise(res => { const off = AshtonkMania.Bus.on('profile:remote', m => { if (m.pid === pid) { off(); res(m); } }); AshtonkMania.Presence.send({ t: 'profile', pid }); }), pidA);
  check('the profile has both devices\' plays', prof.top && prof.top.length === 2, JSON.stringify((prof.top || []).map(x => x.version)));
  const sb2 = await play(b, '4K Normal');
  check('a new play on device B counts for Kai', sb2 && sb2.ok, JSON.stringify(sb2 && sb2.error));

  // ── a new code: the old one stops working; devices already playing stay
  await a.evaluate(() => AshtonkMania.CodePanel.open()); await a.waitForSelector('.login-panel .lp-code');
  await a.click('.login-panel >> text=New code');
  await a.click('.dialog .pd-btn.ok');
  await a.waitForFunction(old => { const t = (document.querySelector('.login-panel .lp-code') || {}).textContent || ''; return /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(t) && t !== old; }, code, { timeout: 8000 });
  const code2 = await a.textContent('.login-panel .lp-code');
  await closePanel(a);
  const c = await device('Someone', 'C');
  await typeCode(c, code);
  await c.waitForSelector('.login-panel .lp-err:not([hidden])');
  check('after New code, the old code doesn\'t work', /doesn't belong to anyone/i.test(await c.textContent('.login-panel .lp-err')) && code2 !== code);
  check('…and device B, already playing as Kai, still is', await b.evaluate(() => AshtonkMania.Account.linked() && !!AshtonkMania.Presence.pid()));

  // ── Sign out other devices (from A): B is signed out at once and sends no scores
  await a.evaluate(() => AshtonkMania.CodePanel.open()); await a.waitForSelector('.login-panel');
  await a.click('.login-panel >> text=Sign out other devices');
  await a.click('.dialog .pd-btn.ok');
  await a.waitForFunction(() => /Signed out 1 other device/.test(document.querySelector('#toasts').textContent), null, { timeout: 8000 });
  await b.waitForFunction(() => AshtonkMania.Account.signedOut(), null, { timeout: 8000 }).catch(() => {});
  const bOut = await b.evaluate(async () => ({ out: AshtonkMania.Account.signedOut(), pid: AshtonkMania.Presence.pid(), sent: await Verified.submit({ rec: [...AshtonkMania.BeatmapManager.maps.values()][0], mods: [], modConfig: {}, seed: 1, events: [] }), toast: document.querySelector('#toasts').textContent }));
  check('Sign out other devices: device B is signed out straight away, told so, and sends no scores', bOut.out && bOut.pid === '' && bOut.sent === null && /Signed out on this device/.test(bOut.toast), JSON.stringify({ ...bOut, toast: bOut.toast.slice(0, 120) }));
  await a.waitForTimeout(3200); // (one score every 3 s from a player)
  const sa2 = await play(a, '7K Hard');
  check('device A still plays as Kai', sa2 && sa2.ok, JSON.stringify(sa2 && sa2.error));
  // signed out, B is back at the setup's first question; "Yes, I have a code" and the new code bring it back
  const asked = await b.waitForSelector('.setup .setup-step-welcome .setup-choice[data-id="have"]', { timeout: 6000 }).then(() => true, () => false);
  check('signed out: the setup\'s first question comes back — have you played before?', asked && /played Ashtonk!mania before/.test(await b.textContent('.setup')));
  await b.click('.setup-choice[data-id="have"]');
  await b.fill('.setup-code-in', code2);
  await b.keyboard.press('Enter');
  await b.waitForFunction(() => AshtonkMania.Account.linked() && !AshtonkMania.Account.signedOut() && !document.querySelector('.setup'), null, { timeout: 10000 });
  check('a signed-out device comes back with the new code', await b.evaluate(() => AshtonkMania.Presence.pid()) === pidA);
  // (what it brought counts as sent: sent back, it went over newer settings another device sent meanwhile)
  await b.waitForFunction(() => !AshtonkMania.Sync.pending(), null, { timeout: 15000 }).catch(() => {});
  const bSent = await b.evaluate(() => localStorage.getItem('am.setSent') || '');
  check('…and doesn\'t send the settings it brought straight back', bSent.startsWith(pidA + '|'), bSent);
  check('…still one Kai on the rankings', (await rankings(a)).total === 1);

  // ── your scores come along too: device A keeps a play of its own (and one from a backup, which stays there)
  // (as a beatmap from osu! has: its ids there — the fixture's are made up)
  await a.evaluate(() => { const A = AshtonkMania, m = [...A.BeatmapManager.maps.values()][0]; m.onlineId = 4242; A.BeatmapManager.setById.get(m.setId).onlineId = 77; });
  const scA = await keepScore(a), scImp = await keepScore(a, { imported: 'backup' });
  // (and a collection of its own)
  const favSet = await a.evaluate(async () => { const A = AshtonkMania, m = [...A.BeatmapManager.maps.values()][0], c = await Collections.create('Jumps'); await Collections.toggle(c.id, m.hash); await A.Favorites.toggle(m.setId); return m.setId; });
  // ── your settings and skin come along: device A uses a skin it imported, and settings of its own
  const osk = readFileSync(join(root, 'tests/fixtures/chemuss.osk')).toString('base64');
  const mineA = await a.evaluate(async b64 => {
    const A = AshtonkMania, bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const meta = await A.SkinManager.importOsk(new File([bytes], 'chemuss.osk'));
    await A.SkinManager.select(meta.id);
    A.Settings.set('gameplay.scrollSpeed', 33); A.Settings.set('wom.hue', 200); A.Settings.set('audio.offset', 25); A.Settings.set('graphics.performanceMode', true);
    await A.Sync.push();
    return { skin: meta.name, sent: localStorage.getItem('am.skinSent') || '' };
  }, osk);
  check('device A keeps its settings and the skin it imported on the server', !!mineA.skin && mineA.sent.endsWith(await a.evaluate(() => AshtonkMania.SkinManager.current.id)), JSON.stringify(mineA));
  // (what went is kept as a list of ids: the plays themselves aren't written again)
  const sentA = await a.evaluate(async ([x, y]) => { const l = AshtonkMania.ScoreManager.scores, kept = await DB.kvGet('sync.sent', {}); return { n: l.length, pid: kept.pid, own: (kept.ids || []).includes(x), imp: (kept.ids || []).includes(y), marked: l.some(s => 'sent' in s) }; }, [scA, scImp]);
  check('…and its play (not the one from a backup), which doesn\'t come back to it twice', sentA.n === 2 && sentA.pid === pidA && sentA.own && !sentA.imp && !sentA.marked, JSON.stringify(sentA));
  // a new device: "Yes, I have a code" → its own page for the code → your settings and skin arrive → only the device's own page is left
  const ectx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const e = await ectx.newPage();
  e.on('pageerror', x => errors.push(`E pageerror: ${x.message}`));
  await e.goto(url);
  await e.waitForSelector('.setup-step-welcome .setup-choice[data-id="have"]', { timeout: 30000 });
  await e.click('.setup-choice[data-id="have"]');
  await e.waitForSelector('.setup-step-account .setup-code-in');
  check('a new device: "Yes, I have a code" leads to a page of its own for the code', !(await e.$('.setup-step-welcome')));
  await e.fill('.setup-code-in', code2);
  // (everything the page says while your settings come)
  await e.evaluate(() => { window.__said = []; new MutationObserver(() => { const r = document.querySelector('.setup-restore'); if (r) window.__said.push(r.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
  await e.keyboard.press('Enter');
  await e.waitForSelector('.setup-step-device', { timeout: 20000 });
  const said = await e.evaluate(() => window.__said);
  check('…the page shows them coming, then what came — your settings, your skin (no stray "null")', said.some(t => /Downloading your skin/.test(t)) && said.some(t => /Your settings/.test(t) && /Your skin:/.test(t)) && !said.some(t => /null/.test(t)), JSON.stringify([...new Set(said)]).slice(0, 400));
  const got = await e.evaluate(() => { const A = AshtonkMania, S = A.Settings; return { steps: A.Onboarding.steps.map(x => x.id).join(), got: A.Onboarding.got, speed: S.get('gameplay.scrollSpeed'), hue: S.get('wom.hue'), offset: S.get('audio.offset'), perf: S.get('graphics.performanceMode'), skin: A.SkinManager.current.meta && A.SkinManager.current.meta.name, files: (A.SkinManager.current.meta && A.SkinManager.current.meta.files || []).length, pid: A.Presence.pid() }; });
  check('…your settings come along (not the ones that belong to a device: audio offset, performance)', got.speed === 33 && got.hue === 200 && got.offset !== 25 && got.perf !== true && got.got && got.got.settings, JSON.stringify(got));
  check('…and the skin you imported, downloaded and in use', got.skin === mineA.skin && got.files > 5 && got.got.skin === mineA.skin, JSON.stringify(got));
  check('…then only the device\'s own page is left (performance or graphics): it\'s you, set up as you were', got.steps === 'welcome,account,device' && got.pid === pidA, got.steps);
  const scE = await e.evaluate(async id => { const A = AshtonkMania, l = A.ScoreManager.scores, s = l.find(x => x.id === id), kept = await DB.get('scores', id); return { n: l.length, s: s && { synced: s.synced, timing: !!(kept && kept.hitErrors), ur: s.unstableRate, mean: s.meanError, counts: s.counts.join(), oid: `${s.onlineId}/${s.onlineSetId}` }, plays: StatisticsManager.compute().plays }; }, scA);
  check('…and your play from device A, without its hit-by-hit timing (the backup\'s stays there), with the beatmap\'s osu! ids', scE.s && scE.s.oid === '4242/77' && scE.n === 1 && scE.s && scE.s.synced && !scE.s.timing && scE.s.ur === 120 && scE.s.mean === -3.2 && scE.s.counts === '200,50,10,0,0,2' && scE.plays === 1 && got.got.scores === 1, JSON.stringify(scE));
  const colE = await e.evaluate(id => Collections.list.map(c => `${c.name}:${c.hashes.length}`).join() + (AshtonkMania.Favorites.has(id) ? ' fav' : ''), favSet);
  check('…and your collections (merged with the ones a new device has) and favourites (the set isn\'t here yet)', /Jumps:1/.test(colE) && /Practice:0/.test(colE) && / fav$/.test(colE) && got.got.collections === 1 && got.got.favorites === 1 && said.some(t => /Your collections and favourites/.test(t)), colE);
  check('…the page says your scores came', said.some(t => /Your scores \(1 play\)/.test(t)), JSON.stringify([...new Set(said)]).slice(0, 400));
  // closed before Finish: back on this player's page (never "I'm new", which would rename them), then the device's page
  await e.reload();
  await e.waitForSelector('.setup-step-account .setup-restore', { timeout: 30000 });
  check('closed before Finish: the setup comes back as this player ("Playing as Kai"), not at "have you played before?"', /Playing as Kai/.test(await e.textContent('.setup-step-account')) && !(await e.$('.setup-step-welcome')) && !(await e.$('.setup-back')));
  await e.waitForFunction(() => /Your settings/.test(document.querySelector('.setup-restore')?.textContent || ''), null, { timeout: 20000 });
  await e.click('.setup-next');
  await e.waitForSelector('.setup-step-device', { timeout: 20000 });
  // a choice finishes the setup on its own; a tap on Finish as well mustn't run it twice
  await e.click('.setup-choice[data-id="pc"]');
  await e.click('.setup-next', { timeout: 1000 }).catch(() => {});
  await e.waitForFunction(() => !document.querySelector('.setup'), null, { timeout: 8000 });
  await e.waitForTimeout(600);
  // a play on device E reaches device A (and each keeps one of each)
  const scE2 = await keepScore(e, { mapHash: await a.evaluate(() => [...AshtonkMania.BeatmapManager.maps.values()][0].hash), accuracy: 0.99 });
  await syncNow(e); await syncNow(a);
  const both = await Promise.all([a, e].map(pg => pg.evaluate(ids => { const l = AshtonkMania.ScoreManager.scores; return { n: l.length, ids: ids.map(id => l.filter(s => s.id === id).length).join(), e2: (l.find(s => s.id === ids[1]) || {}).synced || false }; }, [scA, scE2])));
  check('a play on another device reaches this one (once, as one of yours): device E\'s play is on device A', both[0].n === 3 && both[0].ids === '1,1' && both[0].e2 === true && both[1].n === 2 && both[1].ids === '1,1' && both[1].e2 === false, JSON.stringify(both));
  // its results: what it came to, and where its timing is
  const res = await a.evaluate(async id => { const A = AshtonkMania; await A.Screens.go('results', { score: A.ScoreManager.scores.find(s => s.id === id), fromList: true, browse: true }); await new Promise(r => setTimeout(r, 800)); const t = document.querySelector('.res-right')?.textContent || ''; await A.Screens.go('home'); return t; }, scE2);
  check('…its results show the unstable rate, and that the hit-by-hit timing stays on the device it was played on', /Unstable Rate/.test(res) && /stays on the device this was played on/.test(res), res.slice(0, 200));
  check('…and it\'s done (Finish on that page — once, even tapped twice)', await e.evaluate(() => AshtonkMania.Settings.get('wom.hue') === 200 && !AshtonkMania.Sync.pending() && AshtonkMania.ProfileManager.profile.name === 'Kai') && (await toasts(e)).split('Welcome, Kai!').length <= 2);

  // ── Reset everything on a device playing through a code: still you — your name (not "Player", which the server would
  // take as a rename), and your settings and every play kept for you come back
  await e.evaluate(() => DataManager.resetEverything());
  await e.waitForSelector('.setup-step-account .setup-restore', { timeout: 30000 });
  await e.waitForFunction(() => /Your settings/.test(document.querySelector('.setup-restore')?.textContent || ''), null, { timeout: 20000 });
  const reset = await e.evaluate(() => { const A = AshtonkMania; return { name: A.ProfileManager.profile.name, page: document.querySelector('.setup-restore').textContent, n: A.ScoreManager.scores.length, hue: A.Settings.get('wom.hue') }; });
  check('Reset everything on a device with your code: still Kai, with your settings and both plays back', reset.name === 'Kai' && /Your scores \(2 plays\)/.test(reset.page) && reset.n === 2 && reset.hue === 200, JSON.stringify(reset));
  check('…and the server still has Kai, not "Player"', (await rankings(a)).names.join() === 'Kai');

  // ── guessing: a few tries per address, then turned away (codes have 80 random bits anyway)
  const tries = await c.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 12; i++) out.push(await AshtonkMania.Account.call('link', { code: 'ZZZZZZZZZZZZZZZ' + (i % 10) }).then(() => 'ok', e => /Too many/.test(e.message) ? 'limited' : 'wrong'));
    return out;
  });
  check('guessing codes: after a few tries from one address, it\'s turned away', tries.includes('limited') && !tries.includes('ok'), tries.join(','));
  // nothing secret travels in an address, and the server keeps no code
  const badLink = await c.evaluate(() => fetch('api/account/link?code=x', { method: 'GET' }).then(r => r.status));
  check('codes only travel in the body of a POST (nothing to end up in logs or history)', badLink === 404, String(badLink));

  // ── a save from another player imported: the hint (none for a save of this same player's)
  await c.evaluate(async () => { await DataManager.importAll({ app: 'Ashtonk!mania', kind: 'backup', pid: AshtonkMania.Presence.pid(), scores: [{ id: 'own1', mapHash: 'h', date: 1 }] }); }).catch(() => {});
  await c.waitForTimeout(1600);
  check('importing a save of your own: no hint about codes', !/one player on the rankings/i.test(await toasts(c)));
  await c.evaluate(async () => { const s = AshtonkMania.ScoreManager.scores[0] || { id: 'x', mapHash: 'h', date: 1 }; await DataManager.importAll({ app: 'Ashtonk!mania', kind: 'backup', scores: [{ ...s, id: 'imported1' }] }); }).catch(() => {});
  await c.waitForTimeout(1600);
  check('importing another device\'s save: told to type the code from that device', /Your code/.test(await toasts(c)) && /one player on the rankings/i.test(await toasts(c)));
  // a backup's scores stay on the device: marked as imported, never sent with its profile, never on the rankings
  const imp = await c.evaluate(async () => {
    AshtonkMania.Rankings.report(); await new Promise(r => setTimeout(r, 800));
    const s = AshtonkMania.ScoreManager.scores.find(x => x.id === 'imported1');
    return { marked: s ? s.imported : null, sent: AshtonkMania.ProfileScreen.summary().top.some(x => x.imported) };
  });
  const rk = await rankings(c);
  check('a backup\'s scores are marked imported, aren\'t sent with the profile, and the device that imported it isn\'t on the rankings', imp.marked === 'backup' && !imp.sent && !rk.names.includes('Someone'), JSON.stringify({ imp, rk }));
} catch (e) { check('ran to the end', false, e.stack); }

check('no page errors', !errors.length, errors.join(' | '));
await browser.close(); await mf.dispose();
const bad = results.filter(r => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
