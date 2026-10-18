// The built files (what `wrangler deploy` serves) match the sources and each other: the page and its service worker
// carry the same build id — a mismatch would offer "Update ready to install" every time the game is opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('index.html is built from the current sources, and public/ has the same page', () => {
  const page = read('index.html'), id = (/const APP_BUILD = '([0-9a-f]+)';/.exec(page) || [])[1];
  assert.equal(read('public/index.html'), page, 'public/index.html differs from index.html: run node build.mjs');
  for (const f of readdirSync(new URL('../src/js/', import.meta.url)).filter(f => f.endsWith('.js'))) {
    const src = read('src/js/' + f).replace("const APP_BUILD = '__BUILD__';", () => `const APP_BUILD = '${id}';`);
    assert.ok(page.includes(src), `${f} changed since the last build: run node build.mjs`);
  }
});

test('the page and its service worker carry the same build id', () => {
  const page = /const APP_BUILD = '([0-9a-f]{12})';/.exec(read('index.html')), sw = /const VERSION = '([0-9a-f]{12})';/.exec(read('public/sw.js'));
  assert.ok(page && sw, 'a build id is missing: run node build.mjs');
  assert.equal(sw[1], page[1]);
});

test('the server\'s score judge is built from the current sources', () => {
  const bundle = read('worker/verify-bundle.js');
  for (const f of ['00-util.js', '03-beatmap-parser.js', '03b-mania-convert.js', '08-mods.js', '09-gameplay.js', '09a-osu-math.js', '09c-verify.js'])
    assert.ok(bundle.includes(read('src/js/' + f)), `${f} changed since the last build: run node build.mjs`);
});
