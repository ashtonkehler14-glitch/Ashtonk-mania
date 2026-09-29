// Ashtonk!mania build: inlines src/styles.css and src/js/*.js into a single index.html (+ public/index.html for hosting).
// Usage: node build.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const tpl = readFileSync(join(root, 'src/index.template.html'), 'utf8');
const css = readFileSync(join(root, 'src/styles.css'), 'utf8');
const jsDir = join(root, 'src/js');
const js = readdirSync(jsDir).filter(f => f.endsWith('.js')).sort()
  .map(f => `/* ===== ${f} ===== */\n` + readFileSync(join(jsDir, f), 'utf8')).join('\n');
const out = tpl
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => '"use strict";\n' + js);
writeFileSync(join(root, 'index.html'), out);
// public/ is what Cloudflare serves (see wrangler.jsonc): only the built client, never sources or tests.
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public', 'index.html'), out);
console.log(`index.html written (${(out.length / 1024).toFixed(1)} KiB)`);
