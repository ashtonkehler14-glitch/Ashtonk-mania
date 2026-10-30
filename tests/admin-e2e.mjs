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
// (screenshots of the panel, with SHOT_DIR set)
const shot = async (pg, n) => { if (process.env.SHOT_DIR) await pg.screenshot({ path: join(process.env.SHOT_DIR, n + '.png'), fullPage: true }); };
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
    await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => AshtonkMania.Onboarding.finish()); await page.waitForTimeout(300);
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
  check('the code (typed any way) signs in: a session cookie only /admin gets, HttpOnly, SameSite=Strict', right.status === 200 && /^am_admin=\d+\.[0-9a-f]{24}\.o\.[0-9a-f]{64}$/.test(cookie) && /Path=\/admin/.test(right.headers.get('set-cookie')) && /HttpOnly/.test(right.headers.get('set-cookie')) && /SameSite=Strict/.test(right.headers.get('set-cookie')), right.headers.get('set-cookie'));
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
  // a banner that stays up (Announcements tab): every game shows it — whoever comes online meanwhile too — until it's taken down
  await panel.evaluate(() => { location.hash = 'announce'; });
  await panel.waitForSelector('main textarea', { timeout: 10000 });
  await panel.click('main .seg button:text-is("Event")');
  await panel.fill('main input[placeholder^="Title"]', 'Tournament');
  await panel.fill('main textarea', 'Finals tonight at 8!');
  check('Announcements: a preview of the banner as players will see it', await panel.evaluate(() => /Tournament/.test(document.querySelector('main .ann.event')?.textContent || '')));
  await panel.click('main button.primary:text-is("Announce")');
  const banner = await bob.waitForFunction(() => /Finals tonight at 8!/.test(document.querySelector('.ann-stack .ann.event')?.textContent || ''), null, { timeout: 8000 }).then(() => true, () => false);
  check('…a banner in every player\'s game, in its style, with its title', banner && await bob.evaluate(() => /Tournament/.test(document.querySelector('.ann-stack .ann-t').textContent)));
  // (anywhere but the main menu: a chip in the toolbar instead, a click for the whole of it)
  await bob.evaluate(() => AshtonkMania.Screens.go('songselect'));
  const chip = await bob.waitForFunction(() => !document.querySelector('.ann-stack .ann') && /Tournament/.test(document.querySelector('.ann-chip.event:not([hidden])')?.textContent || ''), null, { timeout: 8000 }).then(() => true, () => false);
  await bob.click('.ann-chip');
  const all = await bob.waitForFunction(() => /Finals tonight at 8!/.test(document.querySelector('.dialog .ann-list')?.textContent || ''), null, { timeout: 5000 }).then(() => true, () => false);
  check('…elsewhere, a chip in the toolbar (not over the screen), and a click shows it in full', chip && all);
  await bob.keyboard.press('Escape');
  await bob.evaluate(() => AshtonkMania.Screens.go('home'));
  await bob.waitForSelector('.ann-stack .ann', { timeout: 8000 }).catch(() => {});
  const late = await device('Dana');
  check('…and whoever comes online while it\'s up gets it too', await late.waitForFunction(() => /Finals tonight/.test(document.querySelector('.ann-stack')?.textContent || ''), null, { timeout: 15000 }).then(() => true, () => false));
  await late.close();
  await panel.waitForSelector('main button.danger:text-is("Take down")', { timeout: 8000 });
  await panel.click('main button.danger:text-is("Take down")');
  check('…taken down: it goes from every game', await bob.waitForFunction(() => !document.querySelector('.ann-stack .ann'), null, { timeout: 8000 }).then(() => true, () => false));
  // a player reports another: the owner's game hears of it at once; the Reports tab has it, with what they said in #lobby
  const alicePid = await owner.evaluate(() => AshtonkMania.Presence.pid());
  await owner.evaluate(() => AshtonkMania.Presence.send({ t: 'say', text: 'gg ez' }));
  await owner.waitForTimeout(400);
  await bob.evaluate(p => AshtonkMania.Presence.send({ t: 'report', pid: p, reason: 'chat', text: 'not nice' }), alicePid);
  const heard = await owner.waitForFunction(() => AshtonkMania.Staff.open === 1 && [...document.querySelectorAll('#toasts .toast')].some(t => /New report/.test(t.textContent)) && !!document.querySelector('.tb-profile .tb-rep'), null, { timeout: 8000 }).then(() => true, () => false);
  check('Report: a player reports someone — the admins online hear of it in their game', heard && await bob.evaluate(() => [...document.querySelectorAll('#toasts .toast')].some(t => /Report sent/.test(t.textContent))));
  await panel.evaluate(() => { location.hash = 'reports'; });
  await panel.waitForSelector('main .report', { timeout: 8000 }).catch(() => {});
  const rep = await panel.evaluate(() => ({ text: document.querySelector('main .report')?.textContent || '', tab: document.querySelector('.tabs button.on .pill')?.textContent }));
  check('…the Reports tab has it: who, why, what they said, their last lines in #lobby', /Chat/.test(rep.text) && /not nice/.test(rep.text) && /gg ez/.test(rep.text) && rep.tab === '1', JSON.stringify(rep).slice(0, 300));
  await panel.click('main .report button:text-is("Dealt with")');
  check('…and the admin\'s picture in the top bar loses its red dot', await owner.waitForFunction(() => !document.querySelector('.tb-profile .tb-rep'), null, { timeout: 8000 }).then(() => true, () => false));
  check('…dealt with: nothing waiting', await panel.waitForFunction(() => /Nothing waiting/.test(document.querySelector('main').textContent), null, { timeout: 8000 }).then(() => true, () => false) && (await api('reports')).open === 0);
  // moderating from the game: the owner mutes Bob from his ⋯ menu's admin items (the server checks it like the panel)
  const items = await owner.evaluate(p => AshtonkMania.Staff.menuItems({ pid: p, name: 'Bob' }).map(i => i.label || i.header).filter(Boolean), bobPid);
  const gm = await owner.evaluate(p => AshtonkMania.Staff.act('mute', { pid: p, minutes: 10, reason: '' }), bobPid);
  const mutedNow = ((await api('moderated')).mutes || []).some(x => x.pid === bobPid);
  check('In the game: an admin\'s ⋯ menu has their tools, and a mute from there works', items.includes('Mute for 10 minutes') && items.includes('Ban…') && gm.ok && mutedNow, JSON.stringify({ items, gm, mutedNow }));
  const notStaff = await bob.evaluate(p => AshtonkMania.Staff.act('ban', { pid: p, days: 1 }), alicePid);
  check('…a player who isn\'t an admin can\'t', !notStaff.ok && /not an admin/.test(notStaff.error || ''), JSON.stringify(notStaff));
  await owner.evaluate(p => AshtonkMania.Staff.act('unmute', { pid: p }), bobPid);
  // #lobby's rules from the Chat tab: blocked words starred out, slow mode (admins aren't held to it)
  await panel.evaluate(() => { location.hash = 'chat'; });
  await panel.waitForSelector('main textarea[placeholder^="One word"]', { timeout: 8000 });
  await panel.fill('main textarea[placeholder^="One word"]', 'heck');
  await panel.click('main button:text-is("Save words")');
  await panel.waitForFunction(() => /Blocked words \(1\)/.test(document.querySelector('main').textContent), null, { timeout: 8000 }).catch(() => {});
  await bob.evaluate(() => AshtonkMania.Presence.send({ t: 'say', text: 'what the heck' }));
  const starred = await bob.waitForFunction(() => AshtonkMania.Chat.channels.get('#lobby').lines.some(l => l.text === 'what the ****'), null, { timeout: 8000 }).then(() => true, () => false);
  // (slow mode on just after he spoke: his next line waits)
  await panel.click('main .seg button:text-is("15s")');
  await panel.waitForFunction(() => document.querySelector('main .seg button.on')?.textContent === '15s', null, { timeout: 8000 }).catch(() => {});
  await bob.evaluate(() => AshtonkMania.Presence.send({ t: 'say', text: 'and again' }));
  const slowed = await bob.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some(t => /Slow mode: one message every 15 seconds/.test(t.textContent)), null, { timeout: 8000 }).then(() => true, () => false);
  check('#lobby rules: a blocked word is starred out, and slow mode holds players back', starred && slowed && await bob.evaluate(() => AshtonkMania.Chat.channels.get('#lobby').lines.some(l => /Slow mode: one message every 15 seconds\./.test(l.text))), JSON.stringify({ starred, slowed, lines: await bob.evaluate(() => AshtonkMania.Chat.channels.get('#lobby').lines.slice(-4).map(l => l.text)), toasts: await bob.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).slice(-4)), rules: (await api('chatRules')).rules }));
  // (#lobby's lines filtered to some words; the automatic mute is on unless turned off)
  await panel.waitForFunction(() => /Slow mode: one message every 15 seconds/.test(document.querySelector('main .chat')?.textContent || ''), null, { timeout: 8000 }).catch(() => {}); // (the tab drawn again after the change)
  await panel.fill('main input.filter', 'the ****');
  const filtered = await panel.evaluate(() => { const ls = [...document.querySelectorAll('main .chat > .line')]; return { shown: ls.filter(l => !l.hidden).map(l => l.querySelector('.x').textContent), all: ls.length, auto: document.querySelector('main label.check input')?.checked }; });
  check('Chat tab: a filter narrows #lobby to some words; automatic mutes are on', filtered.shown.length === 1 && filtered.shown[0] === 'what the ****' && filtered.all > 1 && filtered.auto === true, JSON.stringify(filtered));
  await api('chatRules', { set: { slow: 0, words: '' } });
  // the search box in the top bar finds a player from any page
  await panel.fill('.top input.find', 'Bob'); await panel.press('.top input.find', 'Enter');
  check('Find a player (top bar): straight to the Players tab with them found', await panel.waitForFunction(() => location.hash === '#players' && [...document.querySelectorAll('main table td')].some(td => /Bob/.test(td.textContent)), null, { timeout: 8000 }).then(() => true, () => false));
  // a note on Bob, which only admins see; his page has what was done about him
  await panel.evaluate(p => { location.hash = 'players/' + p; }, bobPid);
  await panel.waitForSelector('main textarea[placeholder="Add a note…"]', { timeout: 8000 });
  await panel.fill('main textarea[placeholder="Add a note…"]', 'Starred words in #lobby — keep an eye on him');
  await panel.click('main button:text-is("Add note")');
  await panel.waitForFunction(() => /keep an eye on him/.test(document.querySelector('main .note')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const pg = await panel.evaluate(() => ({ note: document.querySelector('main .note')?.textContent || '', hist: [...document.querySelectorAll('main .card')].find(c => /^History/.test(c.querySelector('h2')?.textContent || ''))?.textContent || '' }));
  check('Player page: admins\' notes, and the history of what was done about them (the mute from the game)', /keep an eye on him/.test(pg.note) && /the owner/.test(pg.note) && /Muted/.test(pg.hist) && /Reported 0|Never reported/.test(pg.hist), JSON.stringify(pg).slice(0, 300));
  // a beatmap's leaderboard (Leaderboards tab): Bob's judged play on it, taken off from there
  await bob.evaluate(async () => { const b = await (await fetch('/tests/fixtures/test-set.osz')).blob(); await AshtonkMania.App.importFiles([new File([b], 'test-set.osz')]); });
  await bob.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length === 1, null, { timeout: 15000 });
  const sub = await bob.evaluate(async () => { const m = [...AshtonkMania.BeatmapManager.maps.values()][0]; const { notes } = await AshtonkMania.BeatmapManager.load(m.id); return Verified.submit({ rec: m, mods: [], modConfig: {}, seed: 1, events: generateAutoInputs(prepareNotes(notes, m.keys, [], 1), m.keys).flat() }); });
  await panel.evaluate(() => { location.hash = 'boards'; });
  await panel.waitForSelector('main input[placeholder^="Beatmap id"]', { timeout: 8000 });
  await panel.fill('main input[placeholder^="Beatmap id"]', (sub && sub.key) || 'none');
  await panel.click('main button.primary:text-is("Show")');
  await panel.waitForSelector('main table td', { timeout: 8000 }).catch(() => {});
  const board = await panel.evaluate(() => [...document.querySelectorAll('main table tr')].slice(1).map(tr => tr.textContent));
  check('Leaderboards: a beatmap\'s board, with each score on it', !!(sub && sub.ok) && board.length === 1 && /Bob/.test(board[0]), JSON.stringify({ ok: sub && sub.ok, board }));
  panel.once('dialog', d => d.accept());
  await panel.click('main table button.danger:text-is("Remove")');
  await panel.waitForFunction(() => /No scores\./.test(document.querySelector('main').textContent), null, { timeout: 8000 }).catch(() => {});
  check('…a score taken off from there goes from the board and their best plays', await panel.evaluate(() => /No scores\./.test(document.querySelector('main').textContent)) && !(await api('player', { pid: bobPid })).player.bests.length);
  // the overview's "Online now": a message or a mute right there (not for the owner or the admins)
  await panel.evaluate(() => { location.hash = 'overview'; }); await panel.waitForSelector('main td.quick', { timeout: 8000 });
  const quick = await panel.evaluate(() => [...document.querySelectorAll('main tr')].filter(tr => tr.querySelector('td.quick')).map(tr => [tr.firstChild.textContent, tr.querySelectorAll('td.quick button').length]));
  check('Overview: quick message and mute beside each player online — not the owner', quick.some(([n, k]) => /Bob/.test(n) && k === 2) && quick.some(([n, k]) => /Alice/.test(n) && k === 0), JSON.stringify(quick));
  // in the game, an admin has #lobby's rules to hand (the server's own answer comes back)
  const rr = await owner.evaluate(() => AshtonkMania.Staff.act('chatRules', {}));
  check('In the game: #lobby\'s rules read from the game', rr.ok && rr.rules && rr.rules.slow === 0, JSON.stringify(rr));
  await panel.evaluate(p => { location.hash = 'players/' + p; }, bobPid); // (back on Bob's page for what follows)

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
  // his ban notice has an appeal: it waits with the reports; "Lift the ban" there unbans him
  await bob.fill('.ban-appeal textarea', 'I was testing, sorry — it won\'t happen again.');
  await bob.click('.ban-send .btn');
  const appealed = await bob.waitForFunction(() => /Sent/.test(document.querySelector('.ban-send .rep-note')?.textContent || ''), null, { timeout: 8000 }).then(() => true, () => false);
  await panel.evaluate(() => { location.hash = 'reports'; });
  await panel.waitForSelector('main .report.appeal', { timeout: 8000 }).catch(() => {});
  const ap = await panel.evaluate(() => document.querySelector('main .report.appeal')?.textContent || '');
  check('Ban appeal: sent from the ban notice, it waits in Reports with the ban it\'s about', appealed && /Ban appeal/.test(ap) && /testing bans/.test(ap) && /it won't happen again/.test(ap), ap.slice(0, 200));
  panel.once('dialog', d => d.accept());
  await panel.click('main .report.appeal button:text-is("Lift the ban")');
  await panel.waitForFunction(() => /Nothing waiting/.test(document.querySelector('main').textContent), null, { timeout: 8000 }).catch(() => {});
  await panel.evaluate(p => { location.hash = 'players/' + p; }, bobPid);
  await bob.reload();
  await bob.waitForFunction(() => window.AshtonkMania && AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1 && AshtonkMania.Presence.me, null, { timeout: 30000 }).catch(() => {});
  check('Unban: they can come back online', await bob.evaluate(() => !!(window.AshtonkMania && AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1)));

  // ── an admin the owner makes: a role of the owner's naming and colour; they sign in to the panel with their own code
  await bob.waitForFunction(() => !!AshtonkMania.Account.code(), null, { timeout: 15000 }).catch(() => {});
  const bobCode = await bob.evaluate(() => AshtonkMania.Account.code());
  check('a player who isn\'t an admin can\'t sign in to the panel with their code', (await post('/admin/api/login', { code: bobCode }, { 'x-admin': '1' })).status === 401);
  const mk = await api('role', { pid: bobPid, name: 'Moderator', colour: '#ff3366' });
  await bob.waitForFunction(() => AshtonkMania.Presence.isAdmin === true, null, { timeout: 8000 }).catch(() => {});
  check('Make admin: their game gets the admin panel at once, with their role', !!mk.ok && await bob.evaluate(() => AshtonkMania.Presence.isAdmin === true && !!AshtonkMania.Presence.role && AshtonkMania.Presence.role.name === 'Moderator'), JSON.stringify(mk));
  const bl = await post('/admin/api/login', { code: bobCode }, { 'x-admin': '1' });
  const bobCookie = (bl.headers.get('set-cookie') || '').split(';')[0];
  check('…and they sign in to the panel with their own code', bl.status === 200 && new RegExp('^am_admin=\\d+\\.[0-9a-f]{24}\\.' + bobPid + '\\.[0-9a-f]{64}$').test(bobCookie), bobCookie);
  const bapi = (action, body) => post('/admin/api/' + action, body, { 'x-admin': '1', cookie: bobCookie });
  const ownerPid = await owner.evaluate(() => AshtonkMania.Presence.pid());
  const st = { overview: (await bapi('overview')).status, role: (await bapi('role', { pid: bobPid, name: 'Boss' })).status, log: (await bapi('log')).status, banOwner: (await bapi('ban', { pid: ownerPid, days: 1 })).status };
  const own = await (await bapi('overview')).json();
  check('…and on their overview, their own recent actions (not everyone\'s)', own.log.length >= 1 && own.log.every(e => e.by === 'Bob'), JSON.stringify(own.log.map(e => [e.what, e.by])));
  check('an admin moderates, but making admins, the log and acting on the owner are the owner\'s', st.overview === 200 && st.role === 403 && st.log === 403 && st.banOwner === 403, JSON.stringify(st));
  await api('unrole', { pid: bobPid });
  await bob.waitForFunction(() => AshtonkMania.Presence.isAdmin === false, null, { timeout: 8000 }).catch(() => {});
  check('Remove admin: their game loses the admin panel, and their session ends', await bob.evaluate(() => AshtonkMania.Presence.isAdmin === false) && (await bapi('overview')).status === 401);

  // a message to one player, a picture taken down, a room closed
  await api('warn', { pid: bobPid, text: 'Please keep #lobby friendly' });
  const warned = await bob.waitForFunction(() => [...document.querySelectorAll('.dialog')].some(d => /keep #lobby friendly/.test(d.textContent)), null, { timeout: 8000 }).then(() => true, () => false);
  check('Message: it pops up in their game', warned);
  await bob.keyboard.press('Escape');
  await bob.evaluate(() => AshtonkMania.ProfileManager.setAvatar('preset:cat-1'));
  await api('noAvatar', { pid: bobPid });
  const pic = await bob.waitForFunction(() => AshtonkMania.ProfileManager.profile.avatar === 'default', null, { timeout: 8000 }).then(() => true, () => false);
  const row = (await api('search', { q: bobPid })).players.find(x => x.pid === bobPid) || {};
  check('Take picture down: their game goes back to the default picture, and the panel marks it', pic && row.noAvatar === true, JSON.stringify({ pic, noAvatar: row.noAvatar }));
  await api('noAvatar', { pid: bobPid, on: false });
  const room = await bob.evaluate(async () => { await AshtonkMania.Multiplayer.create({ isPublic: true }); return AshtonkMania.Multiplayer.code; });
  await bob.waitForTimeout(1500);
  const listed = (await api('overview')).rooms.some(r => r.code === room);
  const closed = await api('roomClose', { code: room });
  const left = await bob.waitForFunction(() => !AshtonkMania.Multiplayer.inRoom(), null, { timeout: 8000 }).then(() => true, () => false);
  check('Close a room: everyone in it is sent back to the lounge (told why)', listed && closed.ok && left && await bob.evaluate(() => [...document.querySelectorAll('#toasts .toast')].some(t => /room was closed/i.test(t.textContent))), JSON.stringify({ listed, closed, left }));
  // the Players tab before anything's searched: who's online and was lately, and the top players
  await panel.evaluate(() => { location.hash = 'players'; }); await panel.waitForTimeout(800);
  const lists = await panel.$$eval('main .card h2', x => x.map(e => e.textContent));
  const recent = await panel.$$eval('main .card', cs => { const c = cs.find(x => /Online and recently seen/.test(x.textContent)); return c ? c.textContent : ''; });
  await shot(panel, 'admin-players');
  check('Players tab: who\'s online and was lately, and the top players, before any search', lists.some(t => /Online and recently seen/.test(t)) && lists.some(t => /Top players/.test(t)) && /Bob/.test(recent), lists.join('|'));

  // deleting a player: Cara, from her page's Delete player button — her game starts over as a new player
  const cara = await device('Cara');
  const caraPid = await cara.evaluate(() => AshtonkMania.Presence.pid());
  await cara.evaluate(() => AshtonkMania.Presence.send({ t: 'say', text: 'cara was here' }));
  await panel.evaluate(p => { location.hash = 'players/' + p; }, caraPid);
  await panel.waitForSelector('.danger-zone button.danger', { timeout: 10000 });
  await shot(panel, 'admin-player');
  panel.once('dialog', d => d.accept('DELETE'));
  await panel.click('.danger-zone button.danger');
  const told = await cara.waitForFunction(() => [...document.querySelectorAll('.dialog')].some(d => /deleted/i.test(d.textContent)), null, { timeout: 10000 }).then(() => true, () => false);
  await cara.waitForFunction(p => AshtonkMania.Presence.ws && AshtonkMania.Presence.ws.readyState === 1 && AshtonkMania.Presence.me && AshtonkMania.Presence.pid() !== p, caraPid, { timeout: 15000 }).catch(() => {});
  const after = await cara.evaluate(() => ({ pid: AshtonkMania.Presence.pid(), name: AshtonkMania.ProfileManager.profile.name }));
  const gone = !(await api('search', { q: 'Cara' })).players.some(x => x.pid === caraPid) && !(await api('overview')).chat.some(l => l.text === 'cara was here');
  check('Delete player: gone from the server (and #lobby), and their game is told and starts over as a new player', told && after.pid && after.pid !== caraPid && gone, JSON.stringify({ told, after, gone }));
  const reuse = await post('/api/account/code', { pid: caraPid, key: 'key-' + caraPid + '-0123456789abcdef' });
  check('…and the deleted id can\'t be taken again', reuse.status >= 400, String(reuse.status));
  await cara.context().close();

  // the daily challenge
  const ds = await api('dailySet', { map: { onlineSetId: 424242, onlineId: 777, keys: 4, title: 'Daily Song', artist: 'Daily Artist', version: 'Daily Hard', creator: 'Mapper', stars: 4.2, length: 95000 } });
  check('Daily challenge: the owner sets the day\'s beatmap', ds.ok && ds.daily.map.title === 'Daily Song', JSON.stringify(ds).slice(0, 120));
  await panel.evaluate(() => { location.hash = 'overview'; }); await panel.waitForTimeout(800); await shot(panel, 'admin-overview');
  const log = await api('log');
  check('the admin log has every change', ['Signed in', 'Renamed', 'Deleted a chat line', 'Announced', 'Took an announcement down', 'Dealt with a report', 'Wrote a note', 'Changed #lobby\'s rules', 'Muted', 'Banned', 'Unbanned', 'Made admin', 'No longer admin', 'Sent a message', 'Took a picture down', 'Allowed pictures again', 'Closed a room', 'Deleted a player', 'Set the daily challenge beatmap'].every(w => log.log.some(e => e.what === w)), log.log.map(e => e.what).join('|'));

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
