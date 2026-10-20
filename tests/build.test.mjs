// The built files (what `wrangler deploy` serves) match the sources and each other: the page and its service worker
// carry the same build id — a mismatch would offer "Update ready to install" every time the game is opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('index.html is built from the current sources, and public/ has the same page', () => {
  const page = read('index.html'), id = (/const APP_BUILD = '([0-9a-f]+)';/.exec(page) || [])[1], poses = (/ POSES: (\[[^\]\n]*\]),/.exec(page) || [])[1];
  assert.equal(read('public/index.html'), page, 'public/index.html differs from index.html: run node build.mjs');
  for (const f of readdirSync(new URL('../src/js/', import.meta.url)).filter(f => f.endsWith('.js'))) {
    const src = read('src/js/' + f).replace("const APP_BUILD = '__BUILD__';", () => `const APP_BUILD = '${id}';`).replace('POSES: [/*__NERU_POSES__*/]', () => `POSES: ${poses}`);
    assert.ok(page.includes(src), `${f} changed since the last build: run node build.mjs`);
  }
});

test('the page lists Neru\'s poses that are in public/ (neru-<pose>.png)', () => {
  const poses = JSON.parse((/ POSES: (\[[^\]\n]*\]),/.exec(read('index.html')) || [])[1] || 'null');
  const files = readdirSync(new URL('../public/', import.meta.url)).map(f => /^neru-([a-z]+)\.png$/.exec(f)).filter(Boolean).map(m => m[1]).sort();
  assert.deepEqual(poses, files);
  assert.ok(files.includes('happy'));
});

test('each of Neru\'s screens has a pose that\'s there, every pose has a screen, and each has its head size', () => {
  const src = read('src/js/13b-neru.js');
  const obj = name => new Function(`return ${(new RegExp(`\\n  ${name}: (\\{[^}]*\\}),`).exec(src) || [])[1]}`)();
  const pose = obj('POSE'), head = obj('HEAD');
  const files = readdirSync(new URL('../public/', import.meta.url)).map(f => /^neru-([a-z]+)\.png$/.exec(f)).filter(Boolean).map(m => m[1]).sort();
  for (const [screen, n] of Object.entries(pose)) assert.ok(files.includes(n), `${screen}: no public/neru-${n}.png`);
  const used = new Set(Object.values(pose).concat('happy'));
  assert.deepEqual(files.filter(n => !used.has(n)), [], 'poses no screen shows (they belong in art/neru/)');
  assert.deepEqual(Object.keys(head).sort(), files, 'HEAD: one for each pose');
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
