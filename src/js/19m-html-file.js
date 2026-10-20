/* Ashtonk!mania as one HTML file (Ctrl+S, or Settings → Maintenance → Data management): the page with every file
 * it ships with inside it — the Kori skin, Neru, avatars, the cursor, the WOM images and the Outfit font.
 * Opened from the device (file://) it plays like the website, offline too, and its online features (multiplayer,
 * beatmap search and downloads, rankings, the daily challenge) talk to the website it was saved from (Host).
 * The file is put together here, in the browser, from what the website serves: the page, then each file that
 * public/files.json lists (written by build.mjs). A saved file notices when the website has a newer version and,
 * if you say so, writes it over itself (File System Access; elsewhere the new file downloads). */

const HtmlFile = {
  NAME: 'Ashtonk!mania.html',
  busy: false,
  /** The website the file is put together from. */
  base() { return Host.standalone ? Host.server() : new URL('.', location.href).href; },
  async build(onProgress = () => {}) {
    const base = this.base();
    if (!base) throw new Error('Set the game\'s website address first.');
    const get = async (path, as) => {
      let r;
      // (a file that stops coming part-way is given up on, not waited for with the save stuck at its percent)
      try { r = await fetchStalled(new URL(path, base), { cache: 'no-cache' }, 30000); } catch { throw new Error('Couldn\'t reach the game\'s website. Check your connection and try again.'); }
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      try { return await (as === 'text' ? r.text() : as === 'json' ? r.json() : r.blob()); }
      catch (e) { if (e instanceof SyntaxError) throw e; throw new Error('The download stopped part-way. Check your connection and try again.'); }
    };
    let page = await get('index.html', 'text');
    const list = await get('files.json', 'json');
    if (!Array.isArray(list) || !page.includes('"use strict"')) throw new Error('The website sent something unexpected. Try again later.');
    const assets = {};
    let done = 0;
    const total = list.length + 2;
    // (a few at a time: the skins are most of the size)
    const queue = list.filter(p => typeof p === 'string' && /^[\w./ ()-]+$/.test(p));
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const path = queue.shift();
        assets[path] = await blobToDataURL(await get(encodeURI(path)));
        onProgress(++done / total);
      }
    }));
    page = await this.inlineFonts(page).catch(() => page);
    onProgress(++done / total);
    // the page's own references to bundled files (favicon, the cursor's glow in the CSS); the manifest is for the website
    for (const [path, data] of Object.entries(assets)) page = page.split(`url(${path})`).join(`url("${data}")`).split(`href="${path}"`).join(`href="${data}"`);
    page = page.replace(/<link rel="manifest"[^>]*>\n?/, '');
    const head = `<script>window.AM_SERVER=${jsString(base)};window.AM_SAVED=${Date.now()};window.AM_ASSETS=${jsString(assets)};<\/script>\n`;
    // (before the game's script, which reads them as it starts; after the loading screen, so that shows first)
    const at = page.lastIndexOf('<script>\n"use strict"');
    page = at >= 0 ? page.slice(0, at) + head + page.slice(at) : page.replace('</head>', head + '</head>');
    onProgress(1);
    return new Blob([page], { type: 'text/html' });
  },
  /** Google Fonts' Outfit, put inside the file so the text looks right offline (left as a link if it can't be fetched). */
  async inlineFonts(page) {
    const m = /<link href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)" rel="stylesheet">/.exec(page);
    if (!m) return page;
    // (Google's servers blocked or not answering — a school network: the link stays, after 15 s at most)
    let css = await (await fetch(m[1].replace(/&amp;/g, '&'), { signal: timeoutSignal(15000) })).text();
    // (Outfit is one variable font per alphabet: every weight's @font-face names the same file — kept once, as a range)
    const faces = new Map();
    for (const [, body] of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
      const src = /url\(([^)]+)\)/.exec(body), w = /font-weight:\s*(\d+)/.exec(body);
      if (!src || !w) continue;
      const f = faces.get(src[1]) || { body, lo: +w[1], hi: +w[1] };
      f.lo = Math.min(f.lo, +w[1]); f.hi = Math.max(f.hi, +w[1]);
      faces.set(src[1], f);
    }
    if (faces.size) css = [...faces.values()].map(f => `@font-face {${f.body.replace(/font-weight:\s*\d+/, `font-weight: ${f.lo} ${f.hi}`)}}`).join('\n');
    const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)\s'"]+/g) || [])];
    for (const u of urls) css = css.split(u).join(await blobToDataURL(await (await fetch(u, { signal: timeoutSignal(30000) })).blob()));
    return page.replace(m[0], () => `<style>${css}</style>`).replace(/<link rel="preconnect"[^>]*>\n?/g, '');
  },
  async save() {
    if (this.busy) return;
    this.busy = true;
    const p = Toast.progress(Host.standalone ? 'Getting the newest version' : 'Saving the game as an HTML file', 'Packing the skins and pictures…');
    try {
      const blob = await this.build(f => p.set(f));
      downloadBlob(blob, this.NAME);
      p.done('HTML file saved', `${this.NAME} (${fmtBytes(blob.size)}): open it in a browser to play — no website needed.`);
    } catch (e) { p.fail('Couldn\'t save the HTML file', friendlyError(e)); }
    finally { this.busy = false; }
  },
  /** The build the website serves now (its service worker names it), or null when it can't be asked. */
  async latest() {
    const base = this.base();
    if (!base) return null;
    const r = await fetch(new URL('sw.js', base), { cache: 'no-cache', signal: timeoutSignal(15000) });
    const m = r.ok && /const VERSION = '([0-9a-f]{6,40})'/.exec(await r.text());
    return m ? m[1] : null;
  },
  /** This file's name on the device (the update is written over it). */
  fileName() { try { return decodeURIComponent(location.pathname.split('/').pop()) || this.NAME; } catch { return this.NAME; } },
  /** A saved file looks for a newer version as it opens and every few hours while it stays open, and asks — not in
   *  the middle of a song (as lazer holds notifications back), and "Not now" holds for a day. */
  watch() {
    if (!Host.standalone || !Host.server()) return;
    const check = this.check = async () => {
      const v = await this.latest().catch(() => null);
      if (!v || v === APP_BUILD || this._asked === v) return;
      let later = null; try { later = JSON.parse(localStorage.getItem('am.fileUpdateLater') || 'null'); } catch { /* none */ }
      if (later && later.v === v && Date.now() - later.at < 86400e3) return;
      this._asked = v;
      const ask = () => {
        if (Screens.currentName === 'gameplay' || document.querySelector('.dialog')) { const off = Bus.on('screen:changed', () => { if (Screens.currentName !== 'gameplay') { off(); setTimeout(ask, 1500); } }); return; }
        this.offer(v);
      };
      ask();
    };
    setTimeout(check, 6000);
    setInterval(check, 3 * 3600e3);
  },
  async offer(v) {
    const ok = await Dialog.confirm('A new version of Ashtonk!mania is out', `This file is out of date. Update it now? The new version is written over ${this.fileName()} — your beatmaps, scores and settings stay as they are.`, { ok: 'Update', cancel: 'Not now', icon: 'download' });
    if (!ok) { try { localStorage.setItem('am.fileUpdateLater', JSON.stringify({ v, at: Date.now() })); } catch { /* private mode */ } return; }
    this.update();
  },
  /** Write the newest version over this file: the place it was saved to before (remembered), or — the first time —
   *  where you point the save box (already on this file's name). A browser that can't write files gets a download. */
  async update() {
    if (this.busy) return;
    const name = this.fileName();
    // (asked straight away, while the click that asked for it still counts: the browser only allows the save box then)
    let handle = await DB.kvGet('htmlFile.handle', null).catch(() => null);
    if (handle && handle.name !== name) handle = null;
    if (handle) { try { if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') handle = null; } catch { handle = null; } }
    if (!handle && window.showSaveFilePicker) {
      try { handle = await window.showSaveFilePicker({ suggestedName: name, startIn: 'downloads', types: [{ description: 'Ashtonk!mania', accept: { 'text/html': ['.html'] } }] }); }
      catch (e) { if (e && e.name === 'AbortError') return; handle = null; }
    }
    if (!handle) { await this.save(); Toast.show('Put the new file in place of this one', `Then open ${this.NAME} again to play the new version.`, { timeout: 10000 }); return; }
    this.busy = true;
    const p = Toast.progress('Updating Ashtonk!mania', 'Getting the newest version…');
    try {
      const blob = await this.build(f => p.set(f * 0.97));
      const w = await handle.createWritable();
      await w.write(blob); await w.close();
      DB.kvSet('htmlFile.handle', handle).catch(() => {});
      if (handle.name === name) { p.done('Updated', 'Starting the new version…'); setTimeout(() => location.reload(), 1200); }
      else p.done('New version saved', `As ${handle.name}: open it to play the new version.`);
    } catch (e) { p.fail('Couldn\'t update the file', friendlyError(e)); }
    finally { this.busy = false; }
  },
  /** Its part of Settings → Maintenance → Data management. */
  panel(btn) {
    const note = t => h('div.muted', { style: { fontSize: '.8rem' } }, t);
    if (!Host.standalone) return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      h('div.row.wrap', btn(kbHint('Save as an HTML file (Ctrl+S)', 'Save as an HTML file'), 'download', () => this.save())),
      note('One file with the whole game inside: open it in a browser on any device to play without this website — offline too, or where the site is blocked. Multiplayer, beatmap search and rankings still connect to this site. Its beatmaps, scores and settings are its own: move them with Export all data / Import data.'));
    const inp = h('input.input', { value: Host.server(), placeholder: 'https://…', 'aria-label': 'Game website', spellcheck: 'false', autocomplete: 'off', style: { flex: '1', minWidth: '180px' } });
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') apply(); });
    const apply = () => {
      const s = Host.setServer(inp.value);
      inp.value = s;
      Toast.ok(s ? 'Game website set' : 'No game website', s ? 'Reload to connect to it.' : 'Online features are off until one is set.');
    };
    const saved = window.AM_SAVED ? new Date(window.AM_SAVED).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      note(`Playing from a saved HTML file${saved ? ` (saved ${saved})` : ''}. Online features connect to this website:`),
      h('div.row', { style: { gap: '6px' } }, inp, h('button.btn.sm', { onclick: apply }, 'Set')),
      h('div.row.wrap', btn('Update this file', 'download', () => this.update()), btn(kbHint('Save a copy (Ctrl+S)', 'Save a copy'), 'download', () => this.save())));
  },
};

function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
/** A value as JavaScript source that's safe inside a <script> tag. */
function jsString(v) { return JSON.stringify(v).replace(/</g, '\\u003c'); }
