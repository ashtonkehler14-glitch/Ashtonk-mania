/* osu! API proxy for Ashtonk!mania (the OSU_API_PROXY_URL setting, as on Web-Osu-Mania).
 * Cloudflare Workers share IP addresses, so osu! can rate-limit the game's server (429) for other sites' requests.
 * Run this somewhere with its own address and the game's server talks to osu! through it.
 *
 * Deno Deploy: paste this file into a new playground at https://dash.deno.com and set PROXY_KEY under Settings →
 * Environment Variables. On your own server: `PROXY_KEY=… deno run --allow-net --allow-env osu-proxy.js`.
 *
 * Only osu!'s login (/oauth/token) and beatmap set requests (/api/v2/beatmapsets…) are passed on, and only with the
 * right X-Proxy-Key, so nobody else can use it as an open proxy. */

const OSU = 'https://osu.ppy.sh';
const ALLOWED = /^\/(oauth\/token|api\/v2\/beatmapsets(\/\d+|\/search)?)$/;

export async function handle(request, key) {
  const url = new URL(request.url);
  if (url.pathname === '/') return new Response('osu! proxy for Ashtonk!mania is running.');
  if (!key || request.headers.get('x-proxy-key') !== key) return new Response('Wrong or missing X-Proxy-Key.', { status: 403 });
  if (!ALLOWED.test(url.pathname)) return new Response('Not allowed.', { status: 404 });
  const headers = new Headers();
  for (const h of ['authorization', 'content-type', 'accept', 'user-agent']) if (request.headers.get(h)) headers.set(h, request.headers.get(h));
  const r = await fetch(OSU + url.pathname + url.search, {
    method: request.method,
    headers,
    body: request.method === 'POST' ? await request.text() : undefined,
  });
  const out = new Headers();
  for (const h of ['content-type', 'retry-after', 'x-ratelimit-remaining']) if (r.headers.get(h)) out.set(h, r.headers.get(h));
  return new Response(r.body, { status: r.status, headers: out });
}

if (typeof Deno !== 'undefined') Deno.serve(req => handle(req, Deno.env.get('PROXY_KEY')));
