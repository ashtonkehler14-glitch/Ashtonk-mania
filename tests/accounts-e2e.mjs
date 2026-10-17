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
  durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker' },
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
  if (await page.$('.onboarding')) { await page.fill('.onboarding .ob-name', name); await page.keyboard.press('Enter'); await page.waitForSelector('.setup-step-wom'); await page.evaluate(() => AshtonkMania.Onboarding.finish()); await page.waitForTimeout(300); }
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
  await a.click('.login-panel >> text=Get my code');
  await a.waitForFunction(() => /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test((document.querySelector('.login-panel .lp-code') || {}).textContent || ''), null, { timeout: 8000 });
  const code = await a.textContent('.login-panel .lp-code');
  check('Get my code: 16 characters in fours, shown on this device', /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/.test(code), code);
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
  // a wrong code: the same answer as any wrong code, after the same pause
  const wrongT = Date.now();
  await typeCode(b, 'AAAA-BBBB-CCCC-DDDD');
  await b.waitForSelector('.login-panel .lp-err:not([hidden])');
  check('a wrong code is turned down ("doesn\'t belong to anyone"), and this device stays as it was', /doesn't belong to anyone/i.test(await b.textContent('.login-panel .lp-err')) && Date.now() - wrongT >= 380 && await b.evaluate(() => !AshtonkMania.Account.linked()));
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
  // B comes back with the new code
  await typeCode(b, code2);
  await b.waitForFunction(() => AshtonkMania.Account.linked() && !AshtonkMania.Account.signedOut(), null, { timeout: 10000 });
  check('a signed-out device comes back with the new code', await b.evaluate(() => AshtonkMania.Presence.pid()) === pidA);
  check('…still one Kai on the rankings', (await rankings(a)).total === 1);

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

  // ── a save imported by a device that isn't using a code: the hint
  await c.evaluate(async () => { const s = AshtonkMania.ScoreManager.scores[0] || { id: 'x', mapHash: 'h', date: 1 }; await DataManager.importAll({ app: 'Ashtonk!mania', kind: 'backup', scores: [{ ...s, id: 'imported1' }] }); }).catch(() => {});
  await c.waitForTimeout(1600);
  check('importing a save on a device that isn\'t using a code: told to type the code from the other device', /Your code/.test(await toasts(c)) && /one player on the rankings/i.test(await toasts(c)));
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
