// Loads the browser-global source files into a Node vm context for logic tests.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
export function load(files) {
  const ctx = { console, TextDecoder, TextEncoder, crypto: globalThis.crypto, structuredClone, performance, setTimeout, clearTimeout, Blob, Response, DecompressionStream };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const src = files.map(f => readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8')).join('\n');
  // expose top-level const/class declarations
  const names = [...src.matchAll(/^(?:const|class|function|let)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  vm.runInContext(src + `\n;globalThis.__exports = {${names.join(',')}};`, ctx);
  // (the context itself, to stub a browser global a test needs)
  Object.defineProperty(ctx.__exports, '__ctx', { value: ctx });
  return ctx.__exports;
}
