// Accounts across devices, against the real game server (worker/ in workerd through Miniflare): make an account on
// one device, sign in to it on another that already played as a guest (a save imported there), and there is one of
// you on the rankings. Usage: MINIFLARE_DIR=<dir with node_modules/miniflare> node tests/accounts-e2e.mjs
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
const PASS = 'a line from my favourite song';

try {
  // ── device A: plays as a guest, then makes an account from the toolbar (lazer's sign-in panel)
  const a = await device('Kai', 'A');
  const sa = await play(a, '4K Normal');
  check('device A\'s play is judged and counted', sa && sa.ok, JSON.stringify(sa && { ok: sa.ok, pp: sa.pp }));
  const guestPid = await a.evaluate(() => AshtonkMania.Presence.pid());
  await a.click('.tb-profile');
  await a.waitForSelector('.login-panel');
  check('a guest\'s user button opens the sign-in panel (lazer\'s LoginOverlay)', /ACCOUNT/.test(await a.textContent('.login-panel')) && !!(await a.$('.login-panel input[type=password]')));
  await a.click('.login-panel >> text=Create an account');
  check('Create an account: the username starts as your name', await a.inputValue('.login-panel .lp-in[type=text]') === 'Kai');
  await a.fill('.login-panel .lp-in[type=password]', 'short');
  await a.click('.login-panel >> text=Create account');
  await a.waitForSelector('.login-panel .lp-err:not([hidden])');
  check('a password that\'s too short is turned down, saying why', /at least 8/i.test(await a.textContent('.login-panel .lp-err')));
  await a.fill('.login-panel .lp-in[type=password]', PASS);
  await a.click('.login-panel >> text=Create account');
  await a.waitForFunction(() => AshtonkMania.Account.signedIn() && !document.querySelector('.login-panel'), null, { timeout: 10000 });
  const accA = await a.evaluate(() => ({ name: AshtonkMania.Account.name(), pid: AshtonkMania.Presence.pid() }));
  check('the account is made, and device A\'s guest is the account (same id, its play kept)', accA.name === 'Kai' && accA.pid === guestPid, JSON.stringify(accA));
  await a.waitForFunction(() => AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1, null, { timeout: 10000 });

  // ── device B: a save imported onto another device, playing as a guest of its own — two of Kai, until it signs in
  const b = await device('Kai', 'B');
  const sb = await play(b, '7K Hard');
  check('device B (a guest) has a judged play of its own', sb && sb.ok, JSON.stringify(sb && { ok: sb.ok, pp: sb.pp }));
  await b.waitForTimeout(300);
  const before = await rankings(b);
  check('before signing in: Kai is on the rankings twice (one for each device)', before.total === 2, JSON.stringify(before));
  check('…the guest using an account\'s name shows as a guest', before.names.includes('Kai') && before.names.includes('Kai (guest)'), JSON.stringify(before.names));
  // a taken username
  const taken = await b.evaluate(() => AshtonkMania.Account.call('register', { name: 'KAI', password: 'whatever123' }).then(() => 'made', e => e.message));
  check('a username that\'s taken (whatever its case) can\'t be made again', /taken/i.test(taken), taken);
  // wrong password: an error under the fields, and the panel shakes
  await b.click('.tb-profile');
  await b.waitForSelector('.login-panel');
  await b.fill('.login-panel .lp-in[type=text]', 'kai');
  await b.fill('.login-panel .lp-in[type=password]', 'not the password');
  await b.press('.login-panel .lp-in[type=password]', 'Enter');
  await b.waitForSelector('.login-panel .lp-err:not([hidden])');
  check('a wrong password: "Wrong username or password", still a guest', /wrong username or password/i.test(await b.textContent('.login-panel .lp-err')) && !(await b.evaluate(() => AshtonkMania.Account.signedIn())));
  // the right one (the username in any case)
  await b.fill('.login-panel .lp-in[type=password]', PASS);
  await b.press('.login-panel .lp-in[type=password]', 'Enter');
  await b.waitForFunction(() => AshtonkMania.Account.signedIn() && !document.querySelector('.login-panel'), null, { timeout: 10000 });
  const accB = await b.evaluate(() => ({ name: AshtonkMania.Account.name(), pid: AshtonkMania.Presence.pid(), profile: AshtonkMania.ProfileManager.profile.name }));
  check('device B signs in: the same player as device A', accB.pid === accA.pid && accB.name === 'Kai' && accB.profile === 'Kai', JSON.stringify(accB));
  check('it says the guest\'s scores joined the account', /part of your account/i.test(await toasts(b)));
  await b.waitForFunction(() => AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1 && AshtonkMania.Presence.me, null, { timeout: 10000 });
  await b.waitForTimeout(300);
  const after = await rankings(b);
  check('after signing in: one Kai on the rankings', after.total === 1 && after.names[0] === 'Kai' && after.pids[0] === accA.pid, JSON.stringify(after));
  const prof = await a.evaluate(pid => new Promise(res => { const off = AshtonkMania.Bus.on('profile:remote', m => { if (m.pid === pid) { off(); res(m); } }); AshtonkMania.Presence.send({ t: 'profile', pid }); }), accA.pid);
  check('the account has both devices\' plays (its total counts the beatmap each one played)', prof.top && prof.top.length === 2, JSON.stringify((prof.top || []).map(x => x.version)));
  // a new play on device B goes to the account
  const sb2 = await play(b, '4K Normal');
  check('a new play on device B counts for the account', sb2 && sb2.ok, JSON.stringify(sb2 && sb2.error));
  const after2 = await rankings(a);
  check('…still one Kai', after2.total === 1, JSON.stringify(after2));

  // ── signing out on device B: no online identity there; device A stays signed in
  await b.click('.tb-profile', { button: 'right' });
  await b.click('.menu >> text=Sign out');
  await b.waitForSelector('.login-panel');
  await b.click('.login-panel >> text=Sign out');
  await b.waitForSelector('.dialog');
  await b.click('.dialog .pd-btn.ok');
  await b.waitForFunction(() => !AshtonkMania.Account.signedIn() && AshtonkMania.Account.signedOut(), null, { timeout: 5000 });
  const out = await b.evaluate(async () => ({ pid: AshtonkMania.Presence.pid(), sent: await Verified.submit({ rec: [...AshtonkMania.BeatmapManager.maps.values()][0], mods: [], modConfig: {}, seed: 1, events: [] }) }));
  check('signed out: no online identity, and no scores go up', out.pid === '' && out.sent === null, JSON.stringify(out));
  await a.waitForTimeout(3200); // (the server takes one score every 3 s from a player — device B just sent one as the account)
  const sa2 = await play(a, '7K Hard');
  check('device A is still signed in (its own key) and its plays still count', sa2 && sa2.ok, JSON.stringify(sa2 && sa2.error));
  check('…one Kai on the rankings, still', (await rankings(a)).total === 1);
  // back as a guest, importing a save: a hint to sign in
  await b.evaluate(() => AshtonkMania.Account.guest());
  await b.evaluate(async () => {
    const s = AshtonkMania.ScoreManager.scores[0];
    await DataManager.importAll({ app: 'Ashtonk!mania', kind: 'backup', scores: [{ ...s, id: 'imported1' }] });
  }).catch(() => {});
  await b.waitForTimeout(1600);
  check('a guest importing a save is told to sign in, so they\'re one player online', /one player on the rankings/i.test(await toasts(b)));
} catch (e) { check('ran to the end', false, e.stack); }

check('no page errors', !errors.length, errors.join(' | '));
await browser.close(); await mf.dispose();
const bad = results.filter(r => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
