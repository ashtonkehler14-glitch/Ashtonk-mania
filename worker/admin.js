/* The server owner's admin panel, at /admin. All of it lives here, on the server: it isn't part of the game (not in
 * public/, nor in the HTML file the game saves), the panel's own page is only sent once you're signed in, and nothing
 * it does happens in the page — each button asks the server (Matchmaker.admin), which only listens to a signed-in panel.
 *  - Signing in: your player code, the one in the ADMIN_CODE secret (`npx wrangler secret put ADMIN_CODE`), tried a few
 *    times per address; or — on a device whose game plays as you (signed in with that code) — straight away.
 *  - A session lasts 12 hours, in a cookie only /admin gets (HttpOnly, SameSite=Strict, Secure), signed with the code:
 *    changing the code signs every session out. The panel's requests also carry a header other sites can't send. */
import { cleanPlayerCode } from './multiplayer.js';

const COOKIE = 'am_admin', SESSION_H = 12;
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode('am-admin:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
/** Two strings equal, compared in a time that doesn't depend on where they differ. */
async function same(a, b) {
  const [x, y] = await Promise.all([hmac('compare', String(a)), hmac('compare', String(b))]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
/** Who a session is: 'o' (the owner) or an admin's pid — null when signed out. (A session from before admins could be
 *  made has no one named: the owner's.) */
async function signedIn(request, code) {
  const c = (request.headers.get('cookie') || '').split(/;\s*/).find(x => x.startsWith(COOKIE + '='));
  if (!c) return null;
  const parts = c.slice(COOKIE.length + 1).split('.');
  const [exp, nonce] = parts, who = parts.length === 4 ? parts[2] : 'o', sig = parts[parts.length - 1];
  if (!(Number(exp) > Date.now()) || !/^[0-9a-f]{24}$/.test(nonce || '') || !sig || !(who === 'o' || /^[a-z0-9]{6,24}$/.test(who))) return null;
  return (await same(sig, await hmac(code, parts.length === 4 ? `${exp}.${nonce}.${who}` : `${exp}.${nonce}`))) ? who : null;
}
async function sessionCookie(code, url, who = 'o') {
  const exp = Date.now() + SESSION_H * 3600e3, nonce = hex(crypto.getRandomValues(new Uint8Array(12)));
  return `${COOKIE}=${exp}.${nonce}.${who}.${await hmac(code, `${exp}.${nonce}.${who}`)}; Path=/admin; Max-Age=${SESSION_H * 3600}; HttpOnly; SameSite=Strict${url.protocol === 'https:' ? '; Secure' : ''}`;
}

const SECURE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...SECURE, ...extra } });
function page(title, body, script = '') {
  const n = hex(crypto.getRandomValues(new Uint8Array(16)));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title}</title><style nonce="${n}">${CSS}</style></head><body>${body}${script ? `<script nonce="${n}">"use strict";${script}</script>` : ''}</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURE,
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${n}'; style-src 'nonce-${n}'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` } });
}

/** /admin, /admin/api/<action> (called from the Worker for those paths). */
export async function handleAdmin(request, env, url) {
  const code = cleanPlayerCode(env.ADMIN_CODE);
  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Not found' }, 404);
    if (!code || !env.MATCHMAKER) return page('Admin panel · Ashtonk!mania', OFF);
    return (await signedIn(request, code)) ? page('Admin panel · Ashtonk!mania', '<div id="app"></div>', PANEL_JS) : page('Sign in · Ashtonk!mania admin', LOGIN, LOGIN_JS);
  }
  const m = /^\/admin\/api\/([a-zA-Z]{2,20})$/.exec(url.pathname);
  if (!m || request.method !== 'POST' || !code || !env.MATCHMAKER) return json({ error: 'Not found' }, 404);
  // (the panel's own requests: another site can't add this header without the browser asking first — and it isn't
  // answered — nor send the cookie, which is SameSite=Strict)
  const origin = request.headers.get('origin');
  if (request.headers.get('x-admin') !== '1' || (origin && origin !== url.origin)) return json({ error: 'Not allowed.' }, 403);
  const text = await request.text();
  if (text.length > 20000) return json({ error: 'Too big.' }, 413);
  let b; try { b = JSON.parse(text || '{}'); } catch { return json({ error: 'Bad request.' }, 400); }
  if (!b || typeof b !== 'object') return json({ error: 'Bad request.' }, 400);
  const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global')), ip = request.headers.get('cf-connecting-ip') || '';
  const ask = (action, body = {}, who = 'o') => stub.fetch(new Request(`https://matchmaker/internal/admin/${action}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-ip': ip, 'x-admin-who': who === 'o' ? 'owner' : who } }));
  const action = m[1];
  if (action === 'login') {
    const t0 = Date.now(), settle = async () => { const w = 400 - (Date.now() - t0); if (w > 0) await new Promise(r => setTimeout(r, w)); }; // (every answer takes as long)
    const allowed = await ask('try').then(r => r.json()).then(r => !!r.ok).catch(() => false);
    if (!allowed) { await settle(); return json({ error: 'Too many tries from here. Wait a few minutes.' }, 429); }
    // (the owner's code — or the code of a player the owner made an admin)
    const good = await same(cleanPlayerCode(b.code) || '-', code);
    const staff = good ? null : await ask('staffCode', { code: String(b.code || '').slice(0, 40) }).then(r => r.json()).then(r => r.pid || null).catch(() => null);
    await settle();
    if (!good && !staff) return json({ error: 'That isn\'t an admin\'s code.' }, 401);
    await ask('signedIn', { how: 'code' }, staff || 'o').catch(() => {});
    return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(code, url, staff || 'o') });
  }
  if (action === 'device') {
    const r = await ask('device', { pid: String(b.pid || ''), key: String(b.key || '') }).then(x => x.json()).catch(() => ({}));
    if (!r.ok) return json({ ok: false });
    const who = r.who === 'owner' || !r.who ? 'o' : String(r.who);
    await ask('signedIn', { how: 'device' }, who).catch(() => {});
    return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(code, url, who) });
  }
  const who = await signedIn(request, code);
  const out = { 'Set-Cookie': `${COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Strict` };
  if (!who) return json({ error: 'Signed out. Sign in again.' }, 401);
  if (action === 'logout') return json({ ok: true }, 200, out);
  // (an admin the owner made: still one? — taken away, the session ends there)
  if (who !== 'o' && !(await ask('isStaff', { pid: who }).then(x => x.json()).then(x => !!x.ok).catch(() => false))) return json({ error: 'You\'re not an admin any more.' }, 401, out);
  const r = await ask(action, b, who);
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', ...SECURE } });
}

const CSS = `
:root { color-scheme: dark; --bg: #13101b; --panel: #1d1828; --panel2: #262036; --line: rgba(255,255,255,.08); --text: #ece8f6; --muted: #a49bb8;
  --accent: #b366ff; --good: #99eb47; --bad: #ff5f7a; --warn: #ffc33d; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; border: 0; border-radius: 8px; padding: 7px 13px; background: var(--panel2); color: var(--text); font-weight: 600; }
button:hover { filter: brightness(1.15); }
button:disabled { opacity: .5; cursor: default; filter: none; }
button.primary { background: var(--accent); color: #fff; }
button.danger { background: rgba(255,95,122,.16); color: var(--bad); }
button.small { padding: 4px 9px; font-size: 12px; }
input, select, textarea { background: #0f0c16; border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; min-width: 0; }
input:focus, select:focus, textarea:focus { outline: 2px solid rgba(179,102,255,.5); border-color: transparent; }
h1 { font-size: 18px; margin: 0; } h2 { font-size: 15px; margin: 0 0 10px; } h3 { font-size: 12px; margin: 6px 0 2px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
h3 + p { margin: 0 0 8px; }
.muted { color: var(--muted); } .small { font-size: 12px; } .good { color: var(--good); } .bad { color: var(--bad); } .warn { color: var(--warn); }
.top { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 16px; padding: 12px 20px; background: rgba(19,16,27,.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
.top .logo { width: 30px; height: 30px; border-radius: 9px; background: linear-gradient(135deg, var(--accent), #ff66ab); display: grid; place-items: center; font-weight: 800; color: #fff; }
.tabs { display: flex; gap: 4px; flex: 1; overflow-x: auto; }
.tabs button { background: none; color: var(--muted); white-space: nowrap; }
.tabs button.on { background: var(--panel2); color: var(--text); }
main { max-width: 1180px; margin: 0 auto; padding: 20px; }
.grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); margin-bottom: 16px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.tile b { display: block; font-size: 24px; font-weight: 700; } .tile span { color: var(--muted); font-size: 12px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 16px; }
.cols { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.top .grow { flex: 1; }
@media (max-width: 860px) { .line .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .line .x { order: 3; flex-basis: 100%; padding-left: 78px; } .cols { grid-template-columns: minmax(0, 1fr); } .top { flex-wrap: wrap; gap: 10px 16px; padding: 10px 16px; } .tabs { order: 3; flex: 1 0 100%; } main { padding: 16px; } }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.row > input.grow, .grow { flex: 1; }
.mt { margin-top: 10px; } .mb { margin-bottom: 12px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { color: var(--muted); font-weight: 600; font-size: 12px; }
tr.click { cursor: pointer; } tr.click:hover td { background: rgba(255,255,255,.03); }
.av { width: 26px; height: 26px; border-radius: 7px; object-fit: cover; vertical-align: middle; background: var(--panel2); display: inline-grid; place-items: center; font-weight: 700; font-size: 12px; margin-right: 8px; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 11px; font-weight: 700; margin-left: 6px; background: var(--panel2); color: var(--muted); }
.pill.bad { background: rgba(255,95,122,.15); color: var(--bad); } .pill.warn { background: rgba(255,195,61,.14); color: var(--warn); } .pill.good { background: rgba(153,235,71,.14); color: var(--good); } .pill.acc { background: rgba(179,102,255,.18); color: #d6b3ff; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--good); margin-right: 6px; }
.chat { max-height: 520px; overflow-y: auto; }
.line { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 6px 4px; border-bottom: 1px solid var(--line); align-items: baseline; }
.line .t { color: var(--muted); font-size: 12px; flex: none; width: 68px; white-space: nowrap; } .line .n { font-weight: 700; flex: none; } .line .x { flex: 1 1 200px; min-width: 0; overflow-wrap: anywhere; }
.line.sys .n { color: var(--accent); }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; } .kv span { color: var(--muted); }
.actions { display: grid; gap: 12px; } .actions .row > * { flex: none; }
.empty { color: var(--muted); padding: 16px 4px; text-align: center; }
.danger-zone { border-color: rgba(255,95,122,.35); }
.danger-zone h2 { color: var(--bad); }
.pic { width: 64px; height: 64px; border-radius: 14px; object-fit: cover; background: var(--panel2); display: inline-grid; place-items: center; font-size: 26px; font-weight: 800; flex: none; }
.who { display: flex; gap: 14px; align-items: center; margin-bottom: 12px; } .who h2 { margin: 0; }
textarea { width: 100%; min-height: 64px; resize: vertical; }
.filter { margin-bottom: 10px; width: 100%; }
.msg { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 10px 16px; border-radius: 10px; background: var(--panel2); box-shadow: 0 8px 30px rgba(0,0,0,.5); font-weight: 600; z-index: 5; }
.msg.err { background: #3a1a24; color: var(--bad); }
.center { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
.login { width: min(420px, 100%); }
.login input { width: 100%; font-size: 18px; letter-spacing: .12em; text-transform: uppercase; text-align: center; padding: 12px; margin: 14px 0 10px; font-family: ui-monospace, monospace; }
.login button { width: 100%; padding: 11px; }
code { background: #0f0c16; padding: 2px 6px; border-radius: 6px; }
[hidden] { display: none !important; }
input[type=color] { width: 46px; height: 34px; padding: 3px; cursor: pointer; }
.card { overflow-x: auto; }
@media (max-width: 600px) { .doing { display: none; } td.quick { white-space: normal; } td.quick button { margin: 2px 0 2px 4px; } }
a { color: #d6b3ff; } a.big { font-weight: 700; font-size: 15px; }
.tabs .pill { margin-left: 6px; }
.todos { display: grid; gap: 10px; margin-bottom: 16px; }
.todo { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; border-radius: 12px; background: var(--panel); border: 1px solid var(--line); box-shadow: inset 3px 0 0 var(--accent); }
.todo.bad { box-shadow: inset 3px 0 0 var(--bad); } .todo .muted { flex: 1; min-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seg { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 3px; border-radius: 10px; background: #0f0c16; }
.seg button { background: none; color: var(--muted); padding: 5px 11px; } .seg button.on { background: var(--panel2); color: var(--text); }
.check { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: var(--muted); } .check input { width: 16px; height: 16px; }
.ann { --ac: #66ccff; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; padding: 10px 14px; border-radius: 10px; background: #0f0c16; box-shadow: inset 3px 0 0 var(--ac); }
.ann.warn { --ac: #ffcc22; } .ann.event { --ac: #ff66aa; } .ann.maint { --ac: #ff8a5c; }
.ann b { color: var(--ac); } .ann span { overflow-wrap: anywhere; } .ann .cd { margin-left: auto; font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 99px; background: rgba(255,255,255,.08); }
.annrow { padding: 8px 0; border-bottom: 1px solid var(--line); }
.report .quote { margin: 10px 0 0; padding: 8px 12px; border-left: 3px solid var(--line); color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
.report.closed { opacity: .7; }
.report.appeal { border-color: rgba(179,102,255,.35); }
.chat.mini { margin-top: 10px; max-height: 180px; } .chat.mini .line { padding: 4px; }
.find { width: 200px; } @media (max-width: 860px) { .find { flex: 1; width: auto; } }
td.quick { white-space: nowrap; text-align: right; } td.quick button + button { margin-left: 4px; }
.note { padding: 8px 0; border-bottom: 1px solid var(--line); } .note .x { margin-top: 4px; white-space: pre-wrap; overflow-wrap: anywhere; }
`;

const OFF = `<div class="center"><div class="card login"><h1>The admin panel is off</h1>
<p class="muted">Put your player code (the one under your name in the game → Your code) in the server's <code>ADMIN_CODE</code> secret, then it opens with that code:</p>
<p><code>npx wrangler secret put ADMIN_CODE</code></p>
<p class="muted small">Or on Cloudflare: Workers &amp; Pages → v2-ashtonkmania → Settings → Variables and Secrets → Add (type: Secret).</p></div></div>`;

const LOGIN = `<div class="center"><div class="card login"><h1>Ashtonk!mania admin</h1>
<p class="muted" id="sub">Checking this device…</p>
<input id="code" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" maxlength="24" aria-label="Player code">
<button class="primary" id="go">Sign in</button><p class="bad small" id="err"></p></div></div>`;

const LOGIN_JS = `
const $ = id => document.getElementById(id);
const post = (a, b) => fetch('/admin/api/' + a, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin': '1' }, body: JSON.stringify(b || {}) });
(async () => {
  // (a device whose game plays as you is signed in at once)
  let pid = '', key = '';
  try { pid = localStorage.getItem('am.pid') || ''; key = localStorage.getItem('am.key') || ''; } catch {}
  if (pid && key) { try { const r = await (await post('device', { pid, key })).json(); if (r.ok) { location.reload(); return; } } catch {} }
  $('sub').textContent = 'Type your player code: the owner\\'s (the one in the ADMIN_CODE secret), or an admin\\'s.';
  $('code').focus();
})();
async function go() {
  $('go').disabled = true; $('err').textContent = '';
  try {
    const r = await post('login', { code: $('code').value });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) { location.reload(); return; }
    $('err').textContent = d.error || 'Couldn\\'t sign in.';
  } catch { $('err').textContent = 'Couldn\\'t reach the server.'; }
  $('go').disabled = false;
}
$('go').addEventListener('click', go);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
`;

// The panel (only sent to a signed-in session). Everything a player wrote — names, chat — goes in as text, never HTML.
const PANEL_JS = `
const h = (tag, attrs, ...kids) => {
  const [t, ...cls] = tag.split('.'), el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'value') el.value = v; else el.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat(9)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
};
const api = async (action, body) => {
  const r = await fetch('/admin/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin': '1' }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { location.reload(); throw new Error('Signed out'); }
  if (!r.ok || d.error) throw new Error(d.error || 'The server said no (' + r.status + ').');
  return d;
};
let msgT;
const say = (text, err) => { document.querySelectorAll('.msg').forEach(x => x.remove()); const m = h('div.msg' + (err ? '.err' : ''), text); document.body.append(m); clearTimeout(msgT); msgT = setTimeout(() => m.remove(), 3500); };
const run = async (fn, ok) => { try { const r = await fn(); if (ok) say(ok); return r; } catch (e) { say(e.message, true); throw e; } };
const ago = t => { if (!t) return '—'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
const when = t => t ? new Date(t).toLocaleString() : '—';
const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmt = n => Math.round(n || 0).toLocaleString();
const pct = a => ((a || 0) * 100).toFixed(2) + '%';
const avatar = (a, name) => typeof a === 'string' && (a.startsWith('data:image/') || a.startsWith('preset:') || a.startsWith('file:'))
  ? h('img.av', { src: a.startsWith('preset:') ? '/avatars/' + a.slice(7).split('-')[0] + '.jpg' : a.startsWith('file:') ? '/avatars/' + encodeURIComponent(a.slice(5)) : a, alt: '' })
  : h('span.av', String(name || '?').slice(0, 1).toUpperCase());
const until = m => m ? (m.until ? 'until ' + when(m.until) : 'for good') + (m.reason ? ' — ' + m.reason : '') : '';
// (a role's pill in its own colour — set through the style object: the page's rules allow no style attributes)
const rolePill = (name, colour) => { const el = h('span.pill', name); if (/^#[0-9a-f]{6}$/i.test(colour || '')) { el.style.color = colour; el.style.background = colour + '26'; } return el; };
const badges = p => [p.owner || p.admin ? rolePill('Owner', '#ffcc22') : p.role ? rolePill(p.role.name, p.role.colour) : null, p.banned ? h('span.pill.bad', 'banned') : null, p.muted ? h('span.pill.warn', 'muted') : null, p.named ? h('span.pill', 'renamed') : null, p.noAvatar ? h('span.pill.warn', 'picture down') : null, p.code ? h('span.pill.good', 'code') : null, p.deleted ? h('span.pill.bad', 'deleted') : null];
let ME = { owner: true };

let lastQuery = '';
const TABS = [['overview', 'Overview'], ['reports', 'Reports'], ['players', 'Players'], ['announce', 'Announcements'], ['chat', 'Chat'], ['boards', 'Leaderboards'], ['playlists', 'Playlists'], ['daily', 'Daily challenge'], ['log', 'Log']];
let OPEN = 0; // (reports waiting: shown on their tab)
const tabBtns = () => tabsEl.replaceChildren(...tabs().map(([k, l]) => h('button' + (k === tab ? '.on' : ''), { onclick: () => go(k) }, l, k === 'reports' && OPEN ? h('span.pill.bad', String(OPEN)) : null)));
const tabs = () => ME.owner ? TABS : TABS.filter(([k]) => k !== 'daily' && k !== 'log');
let tab = (location.hash.slice(1).split('/')[0]) || 'overview';
const app = document.getElementById('app'), main = h('main'), tabsEl = h('div.tabs');
// (a player found from any page: their name or id, Enter)
const findBox = h('input.find', { placeholder: 'Find a player…', 'aria-label': 'Find a player' });
findBox.addEventListener('keydown', e => { if (e.key === 'Enter' && findBox.value.trim()) { lastQuery = findBox.value.trim(); findBox.value = ''; findBox.blur(); go('players'); } });
app.append(h('div.top', h('div.logo', 'A'), h('h1', 'Admin'), tabsEl, findBox, h('button.small', { onclick: async () => { await api('logout').catch(() => {}); location.reload(); } }, 'Sign out')), main);
// (the overview and the reports keep themselves up to date while the panel is in view — not while you're typing)
setInterval(() => { if (document.hidden || (tab !== 'overview' && tab !== 'reports') || (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) return; ({ overview, reports })[tab]().catch(() => {}); }, 20000);
// (reasons admins give most, offered as they type one)
const REASON_LIST = h('datalist', { id: 'reasons' }, ['Cheating', 'Offensive name', 'Offensive picture', 'Spam in #lobby', 'Harassment', 'Hate speech', 'Impersonating someone', 'Ban evasion'].map(r => h('option', { value: r })));
document.body.append(REASON_LIST);
const go = (t, sub) => { tab = t; location.hash = sub ? t + '/' + sub : t; render(); };
// (any change of address — a player's page, back to the list, the browser's Back button — draws the page it names)
let shown = null;
window.addEventListener('hashchange', () => { if (location.hash === shown) return; tab = location.hash.slice(1).split('/')[0] || 'overview'; render(); });

async function render() {
  shown = location.hash;
  tabBtns();
  main.replaceChildren(h('div.empty', 'Loading…'));
  try { await ({ overview, reports, players, announce, chat, boards, playlists, daily, log })[tab](); } catch (e) { main.replaceChildren(h('div.card', h('p.bad', e.message))); }
}

async function overview() {
  const d = await api('overview');
  const map = d.daily.map;
  ME = d.me || ME; OPEN = d.reports || 0; tabBtns();
  // (what needs an admin now: reports waiting; and what everyone sees: the announcements up)
  const todo = [OPEN ? h('div.todo.bad', h('b', OPEN + ' report' + (OPEN === 1 ? '' : 's') + ' waiting'), h('span.muted', 'Players told the admins about someone.'), h('button.primary', { onclick: () => go('reports') }, 'Review')) : null,
    (d.anns || []).length ? h('div.todo', h('b', d.anns.length + ' announcement' + (d.anns.length === 1 ? '' : 's') + ' up'), h('span.muted', d.anns.map(a => a.title || a.text).join(' · ')), h('button', { onclick: () => go('announce') }, 'Manage')) : null].filter(Boolean);
  main.replaceChildren(
    h('div.card', h('div.row', h('span.muted', 'Signed in as'), ME.owner ? rolePill('Owner', '#ffcc22') : [h('b', ME.name || ME.pid), ME.role ? rolePill(ME.role.name, ME.role.colour) : null], h('span.grow'),
      h('button.small', { onclick: () => go('announce') }, 'Announce…'))),
    todo.length ? h('div.todos', todo) : null,
    h('div.grid', [['Online now', d.online.length], ['Open reports', OPEN], ['Players', d.players], ['Ranked players', d.ranked], ['Players with a code', d.codes], ['Open rooms', d.rooms.length], ['Open playlists', d.playlists], ['Daily challenge scores', d.dailyScores], ['Banned', d.bans], ['Muted', d.mutes]].map(([l, v]) => h('div.tile', h('b', fmt(v)), h('span', l)))),
    d.owner ? null : h('div.card', h('p.warn', 'No player has the code in ADMIN_CODE yet: sign in to the game with it (Your code) so the game knows you\\'re the owner.')),
    h('div.cols',
      h('div.card', h('h2', 'Online now'), d.online.length ? h('table', h('tr', h('th', 'Player'), h('th.doing', 'Doing'), h('th')), d.online.map(u => h('tr.click', { onclick: () => u.pid && openPlayer(u.pid) },
        h('td', avatar(u.avatar, u.name), u.name, u.pid ? null : h('span.pill', 'guest')), h('td.muted.doing', u.status === 'playing' && u.song ? 'Playing ' + u.song.artist + ' - ' + u.song.title + ' [' + u.song.version + ']' : u.status, u.vis === 'offline' ? ' (appearing offline)' : ''),
        // (quick ones, right here: a message, ten minutes' mute — not for the owner or the admins)
        h('td.quick', u.pid && u.pid !== d.owner && !(d.staff || []).some(x => x.pid === u.pid) ? [
          h('button.small', { title: 'Send them a message', onclick: async e => { e.stopPropagation(); const t = prompt('A message for ' + u.name + ' (a notice they have to close):'); if (!t) return; await run(() => api('warn', { pid: u.pid, text: t }), 'Sent'); } }, 'Message'),
          h('button.small', { title: 'Mute for 10 minutes', onclick: async e => { e.stopPropagation(); await run(() => api('mute', { pid: u.pid, minutes: 10, reason: '' }), u.name + ' muted for 10 minutes'); } }, 'Mute 10m')] : null)))) : h('div.empty', 'Nobody is online.')),
      h('div',
        h('div.card', h('h2', 'Daily challenge'), map ? h('div', h('b', map.artist + ' - ' + map.title), h('div.muted', '[' + map.version + '] · ' + map.stars + '★ · ' + map.keys + 'K · ' + d.daily.scores + ' scores')) : h('p.' + (d.daily.error ? 'bad' : 'muted'), d.daily.error || 'Not picked yet (picked when the first player opens it).'),
          h('div.row.mt', h('button.small', { onclick: () => go('daily') }, 'Change…'))),
        h('div.card', h('h2', 'Open rooms'), h('p.muted.small', 'Rooms listed in the lounge (private rooms and Ranked Play matches aren\\'t).'),
          d.rooms.length ? h('table', d.rooms.map(r => h('tr', h('td', r.name || r.code, h('div.muted.small', r.code + (r.map ? ' · ' + r.map.artist + ' - ' + r.map.title : ''))), h('td.muted', (r.players || 0) + '/' + (r.size || '?')), h('td.muted', r.state || ''),
            h('td', ME.owner ? h('button.small.danger', { onclick: async () => { if (!confirm('Close ' + (r.name || r.code) + '? Everyone in it goes back to the lounge.')) return; await run(() => api('roomClose', { code: r.code }), 'Room closed'); overview(); } }, 'Close') : null)))) : h('div.empty', 'No open rooms.')),
        h('div.card', h('h2', 'Admins'), h('p.muted.small', ME.owner ? 'Players you\\'ve made admins: they sign in here with their own code and can ban, mute, rename and remove scores — but not act on another admin. Make one from a player\\'s page.' : 'The admins the owner made.'),
          d.staff && d.staff.length ? h('table', d.staff.map(p => h('tr.click', { onclick: () => openPlayer(p.pid) }, h('td', p.online ? h('span.dot') : null, p.name || p.pid, badges(p)), h('td.muted', p.online ? 'online' : ago(p.seen))))) : h('div.empty', 'No admins yet.')),
        ME.owner ? h('div.card', h('h2', 'Recent actions'), d.log.length ? logTable(d.log) : h('div.empty', 'Nothing yet.')) : null)));
}

async function players() {
  const sub = decodeURIComponent(location.hash.split('/')[1] || '');
  if (sub) return openPlayer(sub, true);
  const q = h('input.grow', { placeholder: 'Name or player id', value: lastQuery, 'aria-label': 'Search players' }), out = h('div');
  const search = async () => {
    lastQuery = q.value;
    const d = await run(() => api('search', { q: q.value }));
    out.replaceChildren(d.players.length ? h('table', h('tr', h('th', 'Player'), h('th', 'pp'), h('th', 'Plays'), h('th', 'Last seen')),
      d.players.map(p => h('tr.click', { onclick: () => openPlayer(p.pid) }, h('td', p.online ? h('span.dot') : null, p.name || h('span.muted', p.pid), badges(p)), h('td', fmt(p.pp)), h('td', fmt(p.plays)), h('td.muted', p.online ? 'online' : ago(p.seen))))) : h('div.empty', 'No players found.'));
  };
  q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  const [mod, lists] = await Promise.all([api('moderated'), api('lists')]);
  const quick = (title, list, what) => h('div.card', h('h2', title), list.length ? h('table', list.map(p => h('tr.click', { onclick: () => openPlayer(p.pid) },
    h('td', p.online ? h('span.dot') : null, avatar(p.avatar, p.name), p.name || h('span.muted', p.pid), badges(p)), h('td.muted.small', what(p))))) : h('div.empty', 'None.'));
  const modList = (title, list, what) => h('div.card', h('h2', title + ' (' + list.length + ')'), list.length ? h('table', list.map(p => h('tr.click', { onclick: () => openPlayer(p.pid) },
    h('td', p.name || p.pid, badges(p)), h('td.muted.small', what(p))))) : h('div.empty', 'None.'));
  main.replaceChildren(h('div.card', h('h2', 'Find a player'), h('div.row', q, h('button.primary', { onclick: search }, 'Search')), out),
    h('div.cols', quick('Online and recently seen', lists.recent, p => p.online ? 'online' : ago(p.seen)), quick('Top players', lists.top, p => fmt(p.pp) + 'pp · ' + fmt(p.plays) + ' plays')),
    h('div.cols', modList('Banned', mod.bans, p => until(p.banned)), h('div', modList('Muted', mod.mutes, p => until(p.muted)), modList('Renamed', mod.names, p => 'shown as ' + p.named))));
  q.focus();
  if (lastQuery) search();
}

async function openPlayer(pid, inPlace) {
  if (!inPlace) { tab = 'players'; location.hash = 'players/' + encodeURIComponent(pid); return; }
  const { player: p } = await api('player', { pid });
  const reason = h('input.grow', { placeholder: 'Reason, for a ban or mute (they see it)', maxlength: 200, list: 'reasons' });
  const banFor = h('select', [String(10 / 1440) + '|10 minutes', String(1 / 24) + '|1 hour', '1|1 day', '7|7 days', '30|30 days', '0|For good'].map(x => h('option', { value: x.split('|')[0] }, x.split('|')[1])));
  const note = h('textarea', { placeholder: 'A message only they see, as a notice they have to close (while they\\'re online)', maxlength: 300 });
  const muteFor = h('select', ['10|10 minutes', '60|1 hour', '1440|1 day', '10080|7 days', '0|For good'].map(x => h('option', { value: x.split('|')[0] }, x.split('|')[1])));
  const name = h('input.grow', { placeholder: 'New name', maxlength: 24, value: p.named || '' });
  const again = () => openPlayer(pid, true);
  const act = (a, body, ok, confirmText) => async () => { if (confirmText && !confirm(confirmText)) return; await run(() => api(a, { pid, ...body() }), ok); again(); };
  // (what the admins know of them — notes only admins see, what was reported, what was done — under their details)
  const side = [
      h('div.card', h('h2', 'Admins\\' notes (' + p.notes.length + ')'), h('p.muted.small', 'Only admins see these — a warning given, something to keep an eye on.'),
        p.notes.length ? h('div', p.notes.slice().reverse().map(n => h('div.note', h('div.row', h('b.small', n.by || '?'), h('span.muted.small', when(n.at)), h('span.grow'),
          h('button.small', { onclick: async () => { if (!confirm('Delete this note?')) return; await run(() => api('note', { pid, del: n.at }), 'Note deleted'); again(); } }, 'Delete')), h('div.x', n.text)))) : h('div.empty', 'No notes yet.'),
        (() => { const t = h('textarea', { placeholder: 'Add a note…', maxlength: 500 }); return h('div.mt', t, h('div.row.mt', h('button.primary', { onclick: async () => { if (!t.value.trim()) return; await run(() => api('note', { pid, text: t.value }), 'Note added'); again(); } }, 'Add note'))); })()),
      h('div.card', h('h2', 'History'),
        p.reports.length ? h('div', h('h3', 'Reported ' + p.reports.length + ' time' + (p.reports.length === 1 ? '' : 's')), p.reports.map(r => h('div.line', h('span.t', ago(r.at)), h('span.n', REASONS[r.reason] || r.reason), h('span.x', (r.text || '') + ' — by ' + ((r.by && r.by.name) || '?') + (r.open ? ' (waiting)' : ''))))) : h('p.muted.small', 'Never reported.' + (p.reported ? '' : '')),
        p.reported ? h('p.muted.small', 'They\\'ve reported others ' + p.reported + ' time' + (p.reported === 1 ? '' : 's') + '.') : null,
        h('h3.mt', 'What the admins did'), p.history && p.history.length ? logTable(p.history) : h('div.empty', 'Nothing yet.'))];
  main.replaceChildren(
    h('div.row.mb', h('button.small', { onclick: () => go('players') }, '← Players')),
    h('div.cols',
      h('div.col', h('div.card', h('div.who', avatar(p.avatar, p.name).cloneNode(true), h('h2', p.name || p.pid, badges(p))), h('div.kv',
        h('span', 'Player id'), h('div', p.pid), h('span', 'Online'), h('div', p.online ? h('b.good', 'now (' + p.sessions.length + ' tab' + (p.sessions.length === 1 ? '' : 's') + ')') : 'last seen ' + ago(p.seen)),
        h('span', 'Global rank'), h('div', p.rank ? '#' + fmt(p.rank) : '—'), h('span', 'pp'), h('div', fmt(p.pp)), h('span', 'Accuracy'), h('div', p.acc ? pct(p.acc) : '—'), h('span', 'Ranked plays'), h('div', fmt(p.plays)),
        h('span', 'First places'), h('div', fmt(p.firsts)), h('span', 'Friends'), h('div', fmt(p.friends)), h('span', 'Devices'), h('div', fmt(p.devices) + (p.code ? ' · has a code' : '')),
        h('span', 'Daily challenge'), h('div', p.daily ? p.daily.days + ' days played · best streak ' + (p.daily.best || 0) : '—'),
        p.banned ? [h('span', 'Banned'), h('div.bad', until(p.banned))] : null, p.muted ? [h('span', 'Muted'), h('div.warn', until(p.muted))] : null)), ...side),
      h('div.card.actions', h('h2', 'Actions'),
        p.admin ? h('p.muted', 'This is the owner (the ADMIN_CODE player).') : !ME.owner && p.role ? h('p.muted', 'An admin: only the owner can act on them.') : [
          ME.owner ? roleBox(p, act) : null,
          p.banned && p.muted ? null : h('div.row', reason),
          h('div', h('h3', 'Ban'), h('p.muted.small', 'Taken offline now and kept offline; their scores are hidden from the boards and rankings.'),
            p.banned ? h('button', { onclick: act('unban', () => ({}), 'Unbanned') }, 'Unban')
            : h('div.row', banFor, h('button.danger', { onclick: act('ban', () => ({ days: Number(banFor.value), reason: reason.value }), 'Banned', 'Ban ' + (p.name || p.pid) + '?') }, 'Ban'))),
          h('div', h('h3', 'Mute'), h('p.muted.small', 'No #lobby or private messages.'), p.muted ? h('button', { onclick: act('unmute', () => ({}), 'Unmuted') }, 'Unmute')
            : h('div.row', muteFor, h('button', { onclick: act('mute', () => ({ minutes: Number(muteFor.value), reason: reason.value }), 'Muted') }, 'Mute')))],
        h('div', h('h3', 'Name'), h('p.muted.small', 'One their game can\\'t change, for a name that isn\\'t OK.'), h('div.row', name, h('button', { onclick: act('rename', () => ({ name: name.value }), 'Renamed') }, 'Rename'),
          p.named ? h('button', { onclick: act('rename', () => ({ name: '' }), 'Their own name is back') }, 'Give their name back') : null)),
        p.admin || (!ME.owner && p.role) ? null : [
          h('div', h('h3', 'Message'), h('p.muted.small', 'Tell them something (a warning, a heads-up): it pops up in their game.'), note,
            h('div.row.mt', h('button', { onclick: async () => { if (!note.value.trim()) return; await run(() => api('warn', { pid, text: note.value }), 'Sent'); note.value = ''; } }, 'Send message'))),
          h('div', h('h3', 'Profile picture'), h('p.muted.small', p.noAvatar ? 'Taken down: none of theirs shows until you allow pictures again.' : 'Take down a picture that isn\\'t OK: it goes everywhere it shows, and they can\\'t put another up until you allow it.'),
            p.noAvatar ? h('button', { onclick: act('noAvatar', () => ({ on: false }), 'Pictures allowed again') }, 'Allow pictures again')
            : h('button', { onclick: act('noAvatar', () => ({ on: true }), 'Picture taken down', 'Take down the profile picture of ' + (p.name || p.pid) + '?') }, 'Take picture down'))],
        h('div', h('h3', 'Scores'), h('p.muted.small', ME.owner ? 'Take one play off below, or all of them.' : 'Take a play off below.'), !ME.owner ? null : h('button.danger', { onclick: act('wipe', () => ({}), 'Every score wiped', 'Wipe every score of ' + (p.name || p.pid) + '? Their rankings, leaderboard scores and daily challenge scores go for good.') }, 'Wipe every score')),
        ME.owner && p.code && !p.admin ? h('div', h('h3', 'Code'), h('p.muted.small', 'If their code got out: it stops working. Their devices stay signed in, and they can make a new one.'), h('button', { onclick: act('revokeCode', () => ({}), 'Code reset', 'Reset the code of ' + (p.name || p.pid) + '?') }, 'Reset their code')) : null)),
    ME.owner && !p.admin && !p.deleted ? h('div.card.danger-zone', h('h2', 'Delete player'),
      h('p.muted', 'Deletes ' + (p.name || p.pid) + ' from the server for good: their profile, every score (rankings, beatmap boards, daily challenge), friends, code and devices, saved settings and skin, and their lines in #lobby. Their game starts over as a new player; what\\'s on their own device (beatmaps, skins) stays there.'),
      p.role ? h('p.warn.small', 'They\\'re an admin: take admin away first.') : h('button.danger', { onclick: async () => {
        const typed = prompt('This can\\'t be undone. Type DELETE to delete ' + (p.name || p.pid) + '.');
        if (typed == null) return;
        if (typed.trim().toUpperCase() !== 'DELETE') { say('Not deleted: type DELETE to confirm.', true); return; }
        await run(() => api('deletePlayer', { pid }), 'Player deleted'); go('players');
      } }, 'Delete player…')) : null,
    h('div.card', h('h2', 'Best plays (' + p.bests.length + ')'), p.bests.length ? h('table', h('tr', h('th', 'Beatmap'), h('th', 'pp'), h('th', 'Score'), h('th', 'Accuracy'), h('th', 'Mods'), h('th', 'Set'), h('th')),
      p.bests.map(s => h('tr', h('td', s.artist + ' - ' + s.title, h('span.muted', ' [' + s.version + ']')), h('td', fmt(s.pp)), h('td', fmt(s.score)), h('td', pct(s.acc)), h('td.muted', s.mods.join(' ') || '—'), h('td.muted', ago(s.date)),
        h('td', h('button.small.danger', { onclick: act('removeScore', () => ({ key: s.key }), 'Score removed', 'Remove this score?') }, 'Remove'))))) : h('div.empty', 'No ranked plays.')));
}

/** The owner's: make a player an admin, with a role of your naming and colour (shown beside their name on the rankings
 *  and their profile) — or change it, or take it away. */
function roleBox(p, act) {
  const name = h('input.grow', { placeholder: 'Role name (e.g. Moderator)', maxlength: 24, value: p.role ? p.role.name : '' });
  const colour = h('input', { type: 'color', value: p.role ? p.role.colour : '#66ccff', 'aria-label': 'Role colour' });
  const preview = h('span');
  const paint = () => preview.replaceChildren(rolePill(name.value.trim() || 'Role', colour.value));
  name.addEventListener('input', paint); colour.addEventListener('input', paint); paint();
  return h('div', h('h3', 'Admin'), h('p.muted.small', p.role ? 'An admin: they sign in to this panel with their own code.' : 'Make them an admin: they sign in to this panel with their own code, and the role shows beside their name.'),
    h('div.row', name, colour, preview),
    h('div.row.mt', h('button.primary', { onclick: act('role', () => ({ name: name.value, colour: colour.value }), p.role ? 'Role saved' : 'Made an admin', p.role ? null : 'Make ' + (p.name || p.pid) + ' an admin? They can ban, mute and rename players.') }, p.role ? 'Save role' : 'Make admin'),
      p.role ? h('button.danger', { onclick: act('unrole', () => ({}), 'No longer an admin', 'Take admin away from ' + (p.name || p.pid) + '?') }, 'Remove admin') : null));
}

async function chat() {
  const [d, cr] = await Promise.all([api('overview'), api('chatRules')]);
  const R = cr.rules;
  const words = h('textarea', { placeholder: 'One word per line (or separated by commas): starred out wherever they\\'re written', maxlength: 4000 });
  words.value = R.words.join('\\n');
  const setRules = async (set, ok) => { await run(() => api('chatRules', { set }), ok); chat(); };
  const rulesCard = h('div.card', h('h2', '#lobby rules'),
    h('h3', 'Slow mode'), h('p.muted.small', 'How long each player waits between messages (admins don\\'t).'),
    seg([[0, 'Off'], [5, '5s'], [15, '15s'], [30, '30s'], [60, '1 min'], [300, '5 min']], R.slow, v => setRules({ slow: v }, v ? 'Slow mode on' : 'Slow mode off')),
    h('h3.mt', 'Lock'), h('p.muted.small', R.locked ? 'Locked: only admins can talk in #lobby.' : 'Open: everyone can talk.'),
    h('button' + (R.locked ? '' : '.danger'), { onclick: () => setRules({ locked: !R.locked }, R.locked ? '#lobby is open again' : '#lobby locked') }, R.locked ? 'Unlock #lobby' : 'Lock #lobby'),
    h('h3.mt', 'Blocked words (' + R.words.length + ')'), h('p.muted.small', 'Starred out in #lobby and private messages. Players don\\'t see the list.'), words,
    h('div.row.mt', h('button.primary', { onclick: () => setRules({ words: words.value }, 'Blocked words saved') }, 'Save words')));
  const text = h('input.grow', { placeholder: 'A message for everyone online (a notification, and a line in #lobby)', maxlength: 300 });
  const announce = async () => { if (!text.value.trim()) return; await run(() => api('announce', { text: text.value }), 'Announced'); chat(); };
  text.addEventListener('keydown', e => { if (e.key === 'Enter') announce(); });
  main.replaceChildren(
    h('div.card', h('h2', 'Announce'), h('div.row', text, h('button.primary', { onclick: announce }, 'Send')), h('p.muted.small', 'A quick one, just now. For a banner that stays up, an event or maintenance: ', h('a', { href: '#announce' }, 'Announcements'), '.')),
    rulesCard,
    h('div.card', h('div.row', h('h2.grow', '#lobby (' + d.chat.length + ')'), h('button.small', { onclick: chat }, 'Refresh'), !ME.owner ? null : h('button.small.danger', { onclick: async () => { if (!confirm('Clear #lobby for everyone?')) return; await run(() => api('chatClear'), 'Cleared'); chat(); } }, 'Clear all')),
      d.chat.length ? h('div.chat', d.chat.slice().reverse().map(l => h('div.line' + (l.from && l.from.system ? '.sys' : ''), h('span.t', clock(l.at)), h('span.n', (l.from && l.from.name) || '?'), h('span.x', l.text),
        l.from && l.from.pid ? h('button.small', { onclick: () => openPlayer(l.from.pid) }, 'Player') : null,
        h('button.small.danger', { onclick: async () => { await run(() => api('chatDelete', { at: l.at, pid: (l.from && l.from.pid) || '' }), 'Deleted'); chat(); } }, 'Delete')))) : h('div.empty', 'No messages.')));
}

async function daily() {
  const d = (await api('overview')).daily, m = d.map;
  const id = h('input.grow', { placeholder: 'Beatmap id (the number after # in its osu! address)', inputmode: 'numeric' });
  const set = async () => { if (!id.value.trim()) return; if (m && d.scores && !confirm('Today\\'s ' + d.scores + ' scores are for the current beatmap: changing it starts its board over. Change it?')) return; await run(() => api('dailySet', { id: id.value.trim() }), 'Daily challenge set'); daily(); };
  id.addEventListener('keydown', e => { if (e.key === 'Enter') set(); });
  main.replaceChildren(h('div.card', h('h2', 'Today (' + d.day + ')'),
    m ? h('div.kv', h('span', 'Beatmap'), h('b', m.artist + ' - ' + m.title), h('span', 'Difficulty'), h('div', m.version + ' · ' + m.stars + '★ · ' + m.keys + 'K'), h('span', 'Mapper'), h('div', m.creator || '—'),
      h('span', 'osu!'), h('div', 'set ' + m.onlineSetId + ', beatmap ' + m.onlineId), h('span', 'Scores'), h('div', fmt(d.scores)), h('span', 'Ends'), h('div', when(d.endsAt)))
      : h('p.' + (d.error ? 'bad' : 'muted'), d.error || 'Not picked yet: the server picks one when the first player opens the daily challenge.'),
    h('h3', 'Change it'), h('div.row', h('button', { onclick: async () => { if (m && d.scores && !confirm('Pick another? Today\\'s scores are for the current beatmap.')) return; await run(() => api('dailyPick'), 'Picked a new one'); daily(); } }, 'Pick another at random')),
    h('div.row.mt', id, h('button.primary', { onclick: set }, 'Set'))));
}

// ── Announcements: a banner in everyone's game while it's up (and whoever comes online meanwhile) — in a style, with a
// title, for as long as you pick; maintenance counts down to a time; a pop-up has to be closed. Or just now: a
// notification and a line in #lobby.
const STYLES = [['info', 'News'], ['warn', 'Important'], ['event', 'Event'], ['maint', 'Maintenance']];
const seg = (list, cur, set) => { const el = h('div.seg', list.map(([v, l]) => h('button' + (v === cur ? '.on' : ''), { type: 'button', onclick: e => { set(v); for (const b of el.children) b.classList.toggle('on', b === e.currentTarget); } }, l))); return el; };
async function announce() {
  const d = await api('anns');
  let kind = 'info', hours = 6;
  const title = h('input.grow', { placeholder: 'Title (optional) — e.g. "New update!"', maxlength: 60 });
  const text = h('textarea', { placeholder: 'The message, for everyone in the game', maxlength: 300 });
  const minutes = h('input', { type: 'number', min: 1, max: 10080, placeholder: 'minutes', value: '15' });
  const popup = h('input', { type: 'checkbox' }), lobby = h('input', { type: 'checkbox', checked: true });
  const prev = h('div'), cdRow = h('div.row', h('span.muted', 'Counts down to it in'), minutes, h('span.muted', 'minutes'));
  const paint = () => {
    cdRow.hidden = kind !== 'maint';
    const label = (STYLES.find(x => x[0] === kind) || STYLES[0])[1];
    prev.replaceChildren(h('div.ann.' + kind, h('b', title.value.trim() || label), h('span', text.value.trim() || 'Your message shows here.'), kind === 'maint' && Number(minutes.value) > 0 ? h('span.cd', 'In ' + Number(minutes.value) + ':00') : null));
  };
  for (const x of [title, text, minutes]) x.addEventListener('input', paint);
  const send = async () => {
    if (!text.value.trim()) { say('Write the message first.', true); return; }
    await run(() => api('announce', { text: text.value, title: title.value, kind, hours, popup: popup.checked, lobby: lobby.checked, minutes: kind === 'maint' ? Number(minutes.value) || 0 : 0 }), hours || popup.checked || kind === 'maint' ? 'Announced — it\\'s up in everyone\\'s game' : 'Announced');
    announce();
  };
  main.replaceChildren(
    h('div.cols',
      h('div.card', h('h2', 'New announcement'),
        h('h3', 'Style'), seg(STYLES, kind, v => { kind = v; paint(); }),
        h('h3.mt', 'Message'), h('div.row', title), h('div.mt', text), cdRow,
        h('h3.mt', 'Stays up'), seg([[0, 'Just now'], [1, '1 hour'], [6, '6 hours'], [24, '1 day'], [72, '3 days'], [168, '7 days'], [720, '30 days']], hours, v => { hours = v; }),
        h('p.muted.small', 'Just now: a notification for whoever is online, and a line in #lobby. Up for a while: a banner in everyone\\'s game — players coming online meanwhile see it too — until it runs out or you take it down. Each player can close it.'),
        h('label.check', popup, ' Also a pop-up everyone has to close'), h('label.check', lobby, ' Also a line in #lobby'),
        h('div.row.mt', h('button.primary', { onclick: send }, 'Announce'))),
      h('div',
        h('div.card', h('h2', 'Preview'), prev),
        h('div.card', h('h2', 'Up now (' + d.anns.length + ')'), d.anns.length ? h('div', d.anns.map(a => h('div.annrow',
          h('div.ann.' + a.kind, h('b', a.title || (STYLES.find(x => x[0] === a.kind) || STYLES[0])[1]), h('span', a.text)),
          h('div.row.mt', h('span.muted.small', 'until ' + when(a.until) + (a.popup ? ' · pop-up' : '') + (a.at ? ' · counting down to ' + clock(a.at) : '')), h('span.grow'),
            h('button.small.danger', { onclick: async () => { await run(() => api('annEnd', { id: a.id }), 'Taken down'); announce(); } }, 'Take down'))))) : h('div.empty', 'None up. Players only see the ones up now.')))));
  paint(); text.focus();
}

// ── Reports: what players told the admins about someone — why, in their words, with the player's last lines in
// #lobby — and the quick answers to them.
const REASONS = { cheating: 'Cheating', chat: 'Chat', name: 'Name or picture', other: 'Something else', appeal: 'Ban appeal' };
let repShow = 'open';
async function reports() {
  const d = await api('reports');
  OPEN = d.open; tabBtns();
  const list = d.reports.filter(r => repShow === 'open' ? r.open : !r.open);
  const done = (r, how) => async () => { await run(() => api('reportClose', { id: r.id, how }), how === 'dismissed' ? 'Dismissed' : 'Marked as dealt with'); reports(); };
  const quick = (r, action, body, ok, confirmText) => async () => {
    if (confirmText && !confirm(confirmText)) return;
    await run(() => api(action, { pid: r.pid, ...body }), ok);
    await api('reportClose', { id: r.id, how: 'done' }).catch(() => {});
    reports();
  };
  // (a banned player's appeal: what they said, the ban it's about, and the two answers to it)
  const appeal = r => h('div.card.report.appeal' + (r.open ? '' : '.closed'),
    h('div.row', h('span.pill.acc', 'Ban appeal'), h('a.big', { href: '#players/' + encodeURIComponent(r.pid) }, r.name || r.pid), h('span.grow'), h('span.muted.small', ago(r.at))),
    h('p.muted.small', 'Banned ' + (r.ban && r.ban.until ? 'until ' + when(r.ban.until) : 'for good') + (r.ban && r.ban.reason ? ' — ' + r.ban.reason : '')),
    h('p.quote', r.text),
    r.open ? h('div.row.mt', h('span.grow'),
      h('button.small', { onclick: done(r, 'dismissed') }, 'Keep the ban'),
      h('button.small.primary', { onclick: async () => { if (!confirm('Lift the ban on ' + (r.name || r.pid) + '?')) return; await run(() => api('unban', { pid: r.pid }), 'Ban lifted'); await api('reportClose', { id: r.id, how: 'done' }).catch(() => {}); reports(); } }, 'Lift the ban'))
      : h('p.muted.small', (r.how === 'dismissed' ? 'Ban kept' : 'Ban lifted') + ' by ' + (r.closedBy || '?') + ', ' + ago(r.closedAt)));
  const card = r => r.reason === 'appeal' ? appeal(r) : h('div.card.report' + (r.open ? '' : '.closed'),
    h('div.row', h('span.pill.bad', REASONS[r.reason] || r.reason), h('a.big', { href: '#players/' + encodeURIComponent(r.pid) }, r.name || r.pid), h('span.muted.small', 'reported by '), h('a', { href: '#players/' + encodeURIComponent(r.by.pid) }, r.by.name || r.by.pid), h('span.grow'), h('span.muted.small', ago(r.at))),
    r.text ? h('p.quote', r.text) : h('p.muted.small', 'No details given.'),
    r.chat && r.chat.length ? h('div.chat.mini', h('h3', 'Their last lines in #lobby'), r.chat.map(l => h('div.line', h('span.t', clock(l.at)), h('span.x', l.text)))) : null,
    r.open ? h('div.row.mt',
      h('button.small', { onclick: quick(r, 'mute', { minutes: 60, reason: 'Reported: ' + (REASONS[r.reason] || '') }, 'Muted for an hour') }, 'Mute 1 hour'),
      h('button.small', { onclick: quick(r, 'mute', { minutes: 1440, reason: 'Reported: ' + (REASONS[r.reason] || '') }, 'Muted for a day') }, 'Mute 1 day'),
      h('button.small', { onclick: async () => { const t = prompt('A message for ' + (r.name || 'them') + ' (a notice they have to close):'); if (!t) return; await quick(r, 'warn', { text: t }, 'Message sent')(); } }, 'Warn…'),
      h('button.small.danger', { onclick: quick(r, 'ban', { days: 1, reason: 'Reported: ' + (REASONS[r.reason] || '') }, 'Banned for a day', 'Ban ' + (r.name || r.pid) + ' for a day?') }, 'Ban 1 day'),
      h('span.grow'),
      h('button.small', { onclick: done(r, 'dismissed') }, 'Dismiss'), h('button.small.primary', { onclick: done(r, 'done') }, 'Dealt with'))
      : h('p.muted.small', (r.how === 'dismissed' ? 'Dismissed' : 'Dealt with') + ' by ' + (r.closedBy || '?') + ', ' + ago(r.closedAt)));
  main.replaceChildren(
    h('div.row.mb', h('h2.grow', 'Reports'), seg([['open', 'Waiting (' + d.open + ')'], ['closed', 'Done']], repShow, v => { repShow = v; reports(); })),
    list.length ? h('div', list.map(card)) : h('div.card', h('div.empty', repShow === 'open' ? 'Nothing waiting — all clear.' : 'None dealt with yet.')));
}

const logTable = list => h('table', list.map(e => h('tr', h('td.muted.small', when(e.at)), h('td', e.by ? h('span.muted', e.by + ': ') : null, h('b', e.what), e.name ? ' · ' + e.name : '', e.to ? ' → ' + e.to : '',
  e.days != null ? ' · ' + (e.days ? e.days + ' days' : 'for good') : '', e.minutes != null ? ' · ' + (e.minutes ? e.minutes + ' min' : 'for good') : '', e.map ? ' · ' + e.map : '',
  e.text ? h('div.muted.small', e.text) : null, e.reason ? h('div.muted.small', 'Reason: ' + e.reason) : null), h('td.muted.small', e.ip || ''))));
async function log() {
  const d = await api('log'), box = h('div'), f = h('input.filter', { placeholder: 'Filter: an action, a player, a reason…', 'aria-label': 'Filter the log' });
  const paint = () => { const t = f.value.trim().toLowerCase(), list = t ? d.log.filter(e => JSON.stringify(e).toLowerCase().includes(t)) : d.log; box.replaceChildren(list.length ? logTable(list) : h('div.empty', t ? 'Nothing matches.' : 'Nothing yet.')); };
  f.addEventListener('input', paint); paint();
  main.replaceChildren(h('div.card', h('h2', 'Admin log (' + d.log.length + ')'), f, box));
  f.focus();
}
// ── Leaderboards: a beatmap's board by its osu! beatmap id, to take a score off it (a cheated one, say)
let boardId = '';
async function boards() {
  const id = h('input.grow', { placeholder: 'Beatmap id (the number after # in its osu! address)', inputmode: 'numeric', value: boardId });
  const out = h('div');
  const show = async () => {
    boardId = id.value.trim();
    if (!boardId) return;
    const d = await run(() => api('board', /^[a-f0-9]{64}$/i.test(boardId) ? { key: boardId.toLowerCase() } : { id: boardId })).catch(() => null);
    if (!d) { out.replaceChildren(); return; }
    out.replaceChildren(h('h2.mt', d.info ? d.info.artist + ' - ' + d.info.title + ' [' + d.info.version + ']' : 'Beatmap ' + boardId),
      d.scores.length ? h('table', h('tr', h('th', '#'), h('th', 'Player'), h('th', 'Score'), h('th', 'Accuracy'), h('th', 'Mods'), h('th', 'pp'), h('th', 'Set'), h('th')),
        d.scores.map(x => h('tr', h('td', '#' + x.rank), h('td', h('a', { href: '#players/' + encodeURIComponent(x.pid) }, x.name || x.pid)), h('td', fmt(x.score)), h('td', pct(x.acc)), h('td.muted', (x.mods || []).join(' ') || '—'), h('td', fmt(x.pp)), h('td.muted', ago(x.date)),
          h('td', h('button.small.danger', { onclick: async () => { if (!confirm('Take ' + (x.name || x.pid) + '\\'s score off this beatmap? It goes from their best plays too.')) return; await run(() => api('removeScore', { pid: x.pid, key: d.key }), 'Score removed'); show(); } }, 'Remove'))))) : h('div.empty', 'No scores.'));
  };
  id.addEventListener('keydown', e => { if (e.key === 'Enter') show(); });
  main.replaceChildren(h('div.card', h('h2', 'Leaderboards'), h('p.muted.small', 'A beatmap\\'s board here, as players see it: take off a score that shouldn\\'t be there.'), h('div.row', id, h('button.primary', { onclick: show }, 'Show')), out));
  id.focus();
  if (boardId) show();
}

async function playlists() {
  const d = await api('playlists');
  main.replaceChildren(h('div.card', h('h2', 'Playlists (' + d.playlists.length + ')'), h('p.muted.small', 'The ones players have put up (ended ones are kept two weeks). Remove one with a name that isn\\'t OK.'),
    d.playlists.length ? h('table', h('tr', h('th', 'Name'), h('th', 'Host'), h('th', 'Beatmaps'), h('th', 'Players'), h('th', 'Ends'), h('th')),
      d.playlists.map(pl => h('tr', h('td', pl.name, pl.open ? h('span.pill.good', 'open') : h('span.pill', 'ended')), h('td', pl.host ? h('a', { href: '#players/' + encodeURIComponent(pl.host.pid) }, pl.host.name || pl.host.pid) : '—'), h('td', fmt(pl.items)), h('td', fmt(pl.players)), h('td.muted', when(pl.ends)),
        h('td', ME.owner ? h('button.small.danger', { onclick: async () => { if (!confirm('Remove the playlist "' + pl.name + '"? Its scores go with it.')) return; await run(() => api('playlistDelete', { id: pl.id }), 'Playlist removed'); playlists(); } }, 'Remove') : null)))) : h('div.empty', 'No playlists.')));
}

// (who's signed in — the owner, or an admin they made — before the first page: what's shown depends on it)
api('overview').then(d => { ME = d.me || ME; }).catch(() => {}).finally(render);
`;
