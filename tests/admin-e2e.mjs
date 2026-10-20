// The server owner's admin panel (worker/admin.js), against the real game server (worker/ in workerd through
// Miniflare): it's only on the server and only opens with the ADMIN_CODE secret — the code, or a device that plays as
// its player — and what it does reaches the players: a ban takes them offline, a name sticks, an announcement and a
// deleted chat line show up in their game.
// Usage: MINIFLARE_DIR=<dir with node_modules/miniflare> node tests/admin-e2e.mjs
import { readFileSync, mkdtempSync } from 'node:fs';
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };
// (kept on disk, so the server's players outlive it being started again with the owner's code)
const opts = code => ({
  modules: true, scriptPath: join(root, 'worker/index.js'), modulesRoot: root, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2026-08-01', cf: false, port: 0, host: '127.0.0.1',
  durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker', VAULT: 'PlayerVault' }, durableObjectsPersist: dir,
  bindings: { TEST_ALL_RANKED: '1', ...(code ? { ADMIN_CODE: code } : {}) },
  serviceBindings: {
    ASSETS: async req => {
      const p = decodeURIComponent(new URL(req.url).pathname);
      for (const f of [p === '/' ? join(root, 'index.html') : join(root, p), join(root, 'public', p)]) try { return new Response(readFileSync(f), { headers: { 'content-type': types[extname(f)] || 'application/octet-stream' } }); } catch { /* next */ }
      return new Response('not found', { status: 404 });
    },
  },
});
const dir = mkdtempSync(join(tmpdir(), 'am-admin-'));
const mf = new Miniflare(opts(''));
let url = String(await mf.ready).replace(/\/$/, '');

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✖'} ${name}${extra ? '  — ' + extra : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const post = (path, body, headers = {}) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });

async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('am.noInstallPrompt', '1'); } catch {} });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#loading-screen.done'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  if (await page.$('.onboarding')) {
    if (await page.$('.setup-choice[data-id="new"]')) await page.click('.setup-choice[data-id="new"]');
    await page.fill('.onboarding .ob-name', name); await page.keyboard.press('Enter');
    await page.waitForSelector('.setup-step-wom'); await page.evaluate(() => AshtonkMania.Onboarding.finish()); await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1 && AshtonkMania.Presence.me, null, { timeout: 15000 });
  return page;
}

try {
  // ── no ADMIN_CODE: the panel is off
  const off = await (await fetch(url + '/admin')).text();
  check('without the ADMIN_CODE secret the panel is off (and says how to turn it on)', /admin panel is off/i.test(off) && /wrangler secret put ADMIN_CODE/.test(off));
  check('…and its actions answer nothing', (await post('/admin/api/overview', {}, { 'x-admin': '1' })).status === 404);

  // Alice plays as the owner: her code (made at setup) goes in the secret
  const alice = await device('Alice');
  await alice.waitForFunction(() => !!AshtonkMania.Account.code(), null, { timeout: 15000 }).catch(() => {});
  const code = await alice.evaluate(() => AshtonkMania.Account.code());
  check('the owner has a player code', /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(code || ''), code);
  await alice.context().close();
  await mf.setOptions(opts(code));
  url = String(await mf.ready).replace(/\/$/, '');

  // ── what anyone can see: the sign-in page, without the panel's code
  const res = await fetch(url + '/admin'), login = await res.text();
  check('/admin without signing in is only the sign-in page (none of the panel\'s code is sent)', res.status === 200 && /Sign in/.test(login) && !/Wipe every score|chatDelete|removeScore/.test(login));
  const csp = res.headers.get('content-security-policy') || '';
  check('…with a strict content security policy, never cached, not indexed', /script-src 'nonce-/.test(csp) && /frame-ancestors 'none'/.test(csp) && res.headers.get('cache-control') === 'no-store' && /noindex/.test(res.headers.get('x-robots-tag') || ''), csp.slice(0, 80));
  check('the game\'s own files have no admin panel in them', !/admin\/api|Wipe every score/.test(readFileSync(join(root, 'index.html'), 'utf8')));
  check('its actions need a signed-in panel', (await post('/admin/api/overview', {}, { 'x-admin': '1' })).status === 401);
  check('…and the panel\'s own header (another site can\'t send it)', (await post('/admin/api/overview')).status === 403);
  const wrong = await post('/admin/api/login', { code: 'AAAA-BBBB-CCCC-DDDD' }, { 'x-admin': '1' });
  check('a wrong code doesn\'t sign in', wrong.status === 401 && !wrong.headers.get('set-cookie'));
  const right = await post('/admin/api/login', { code: code.toLowerCase().replace(/-/g, ' ') }, { 'x-admin': '1' });
  const cookie = (right.headers.get('set-cookie') || '').split(';')[0];
  check('the code (typed any way) signs in: a session cookie only /admin gets, HttpOnly, SameSite=Strict', right.status === 200 && /^am_admin=\d+\.[0-9a-f]{24}\.[0-9a-f]{64}$/.test(cookie) && /Path=\/admin/.test(right.headers.get('set-cookie')) && /HttpOnly/.test(right.headers.get('set-cookie')) && /SameSite=Strict/.test(right.headers.get('set-cookie')), right.headers.get('set-cookie'));
  const forged = cookie.replace(/.$/, c => c === '0' ? '1' : '0');
  check('a session cookie that\'s been changed doesn\'t work', (await post('/admin/api/overview', {}, { 'x-admin': '1', cookie: forged })).status === 401);
  const api = async (action, body) => (await post('/admin/api/' + action, body, { 'x-admin': '1', cookie })).json();

  // ── a device that plays as the owner is signed in straight away (and its game offers the panel)
  const owner = await device('Alice');
  await owner.evaluate(c => AshtonkMania.Account.link(c), code).catch(() => {});
  await owner.waitForFunction(() => AshtonkMania.Presence.isAdmin === true, null, { timeout: 15000 }).catch(() => {});
  check('the owner\'s game knows it\'s the owner\'s', await owner.evaluate(() => AshtonkMania.Presence.isAdmin === true));
  // (the top bar shows outside the main menu's first screen)
  await owner.evaluate(() => AshtonkMania.Screens.go('songselect')); await owner.waitForTimeout(800);
  await owner.click('.tb-profile', { button: 'right' });
  const menu = await owner.$$eval('.menu button', b => b.map(x => x.textContent.trim()));
  check('…and the menu under their name has "Admin panel"', menu.includes('Admin panel'), menu.join('|'));
  await owner.keyboard.press('Escape');
  const panel = await owner.context().newPage();
  await panel.goto(url + '/admin');
  await panel.waitForSelector('.tabs', { timeout: 15000 }).catch(() => {});
  check('opened on the owner\'s device, the panel signs in by itself', !!(await panel.$('.tabs')));

  // ── Bob, a player
  const bob = await device('Bob');
  const bobPid = await bob.evaluate(() => AshtonkMania.Presence.pid());
  await panel.reload(); await panel.waitForSelector('.tile');
  const online = await panel.$$eval('main table td', t => t.map(x => x.textContent).join('|'));
  check('Overview: who\'s online', /Bob/.test(online), online.slice(0, 120));

  // a name his game can't change
  await panel.evaluate(p => { location.hash = 'players/' + p; }, bobPid);
  await panel.waitForSelector('main .kv', { timeout: 10000 });
  await panel.fill('input[placeholder="New name"]', 'Robert');
  await panel.click('button:text-is("Rename")');
  await bob.waitForFunction(() => AshtonkMania.ProfileManager.profile.name === 'Robert', null, { timeout: 8000 }).catch(() => {});
  check('Rename: the player\'s game takes the new name', await bob.evaluate(() => AshtonkMania.ProfileManager.profile.name) === 'Robert');
  await api('rename', { pid: bobPid, name: '' });

  // #lobby: an announcement, and a line taken out
  await bob.evaluate(() => AshtonkMania.Presence.send({ t: 'say', text: 'something rude' }));
  await bob.waitForTimeout(500);
  const ov = await api('overview');
  const line = ov.chat.find(l => l.text === 'something rude');
  await api('chatDelete', { at: line && line.at, pid: bobPid });
  await bob.waitForTimeout(500);
  check('Chat: a deleted line goes from the players\' chat', !(await bob.evaluate(() => AshtonkMania.Chat.channels.get('#lobby').lines.some(l => l.text === 'something rude'))));
  await api('announce', { text: 'Server restart in 5 minutes' });
  await bob.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some(t => /Server restart in 5 minutes/.test(t.textContent)), null, { timeout: 8000 }).catch(() => {});
  check('Announce: every player gets it as a notification, and in #lobby', await bob.evaluate(() => [...document.querySelectorAll('#toasts .toast')].some(t => /Server restart in 5 minutes/.test(t.textContent)) && AshtonkMania.Chat.channels.get('#lobby').lines.some(l => l.text === 'Server restart in 5 minutes')));

  // a mute, then a ban
  await api('mute', { pid: bobPid, minutes: 10 });
  await bob.evaluate(() => AshtonkMania.Presence.send({ t: 'say', text: 'still here' }));
  await bob.waitForTimeout(600);
  check('Mute: their lines go nowhere', !(await api('overview')).chat.some(l => l.text === 'still here'));
  await panel.reload(); await panel.waitForSelector('main .kv');
  await panel.fill('input[placeholder^="Reason"]', 'testing bans');
  panel.once('dialog', d => d.accept());
  await panel.click('button.danger:text-is("Ban")');
  await bob.waitForFunction(() => [...document.querySelectorAll('.dialog')].some(d => /banned/i.test(d.textContent)) && !AshtonkMania.Presence.ws, null, { timeout: 8000 }).catch(() => {});
  const banned = await bob.evaluate(() => ({ told: [...document.querySelectorAll('.dialog')].some(d => /banned/i.test(d.textContent) && /testing bans/.test(d.textContent)), ws: !!AshtonkMania.Presence.ws }));
  check('Ban: the player is told why and taken offline', banned.told && !banned.ws, JSON.stringify(banned));
  await bob.waitForTimeout(3000);
  check('…and their game doesn\'t keep trying to come back', !(await bob.evaluate(() => AshtonkMania.Presence.ws)) && !(await api('overview')).online.some(u => u.pid === bobPid));
  const ps = await api('search', { q: 'Bob' });
  check('Players: search finds them, marked banned', ps.players.some(p => p.pid === bobPid && p.banned), JSON.stringify(ps.players.map(p => [p.name, !!p.banned])));
  await api('unban', { pid: bobPid });
  await bob.reload();
  await bob.waitForFunction(() => window.AshtonkMania && AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1 && AshtonkMania.Presence.me, null, { timeout: 30000 }).catch(() => {});
  check('Unban: they can come back online', await bob.evaluate(() => !!(window.AshtonkMania && AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1)));

  // the daily challenge
  const ds = await api('dailySet', { map: { onlineSetId: 424242, onlineId: 777, keys: 4, title: 'Daily Song', artist: 'Daily Artist', version: 'Daily Hard', creator: 'Mapper', stars: 4.2, length: 95000 } });
  check('Daily challenge: the owner sets the day\'s beatmap', ds.ok && ds.daily.map.title === 'Daily Song', JSON.stringify(ds).slice(0, 120));
  const log = await api('log');
  check('the admin log has every change', ['Signed in', 'Renamed', 'Deleted a chat line', 'Announced', 'Muted', 'Banned', 'Unbanned', 'Set the daily challenge beatmap'].every(w => log.log.some(e => e.what === w)), log.log.map(e => e.what).join('|'));

  // signing in with the code is limited per address
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) limited = (await post('/admin/api/login', { code: 'AAAA-BBBB-CCCC-DDDD' }, { 'x-admin': '1' })).status === 429;
  check('wrong codes are limited (a few tries every 10 minutes)', limited);
  const out = await post('/admin/api/logout', {}, { 'x-admin': '1', cookie });
  check('signing out ends the session', out.status === 200 && /Max-Age=0/.test(out.headers.get('set-cookie') || ''));
} catch (e) { check('ran to the end', false, e.stack); }

check('no page errors', !errors.length, errors.join(' | '));
await browser.close(); await mf.dispose();
const bad = results.filter(r => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
