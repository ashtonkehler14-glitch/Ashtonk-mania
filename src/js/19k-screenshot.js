/* osu!lazer's screenshots (F12): a PNG of the screen, saved with the date and time in its name and a notification
 * that opens it. In gameplay the picture is put together from the game's own layers — the background (dimmed and
 * blurred as you play it), the video and storyboard, the playfield, and the score — so it's instant and needs no
 * permission; elsewhere the browser captures this tab (it asks the first time). */

const Screenshot = {
  async take() {
    if (this._busy) return;
    this._busy = true;
    try {
      const canvas = Screens.currentName === 'gameplay' && GameplayScreen.s ? await this.gameplay() : await this.capture();
      if (!canvas) return;
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('The picture couldn\'t be made.');
      const d = new Date(), p2 = n => String(n).padStart(2, '0');
      const name = `ashtonk!mania ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}.png`;
      downloadBlob(blob, name);
      const url = URL.createObjectURL(blob);
      this.last = { name, size: blob.size, width: canvas.width, height: canvas.height };
      Toast.show('Screenshot saved', `${name} — click to view`, { onClick: () => window.open(url, '_blank') });
      setTimeout(() => URL.revokeObjectURL(url), 10 * 60000);
    } catch (e) {
      if (e && e.name === 'NotAllowedError') Toast.show('No screenshot', 'The browser needs permission to capture this tab.');
      else Toast.err('Couldn\'t take a screenshot', friendlyError(e));
    } finally { this._busy = false; }
  },
  /** The gameplay screen from its layers, at the screen's full resolution. */
  async gameplay() {
    const G = GameplayScreen, el = G.el, box = el.getBoundingClientRect();
    const k = Math.min(3, window.devicePixelRatio || 1), W = Math.round(el.clientWidth * k), H = Math.round(el.clientHeight * k);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const sx = W / (box.width || 1), sy = H / (box.height || 1);
    const at = node => { const r = node.getBoundingClientRect(); return [(r.left - box.left) * sx, (r.top - box.top) * sy, r.width * sx, r.height * sy]; };
    const cover = (img, iw, ih) => { const s = Math.max(W / iw, H / ih), w = iw * s, hh = ih * s; ctx.drawImage(img, (W - w) / 2, (H - hh) / 2, w, hh); };
    // the background (its blurred copy, as shown)
    const m = /url\("?([^")]+)"?\)/.exec(G.bgEl.style.backgroundImage || '');
    if (m) { const img = await this.image(m[1]).catch(() => null); if (img) cover(img, img.naturalWidth, img.naturalHeight); }
    const v = G.videoEl;
    if (v && v.readyState >= 2 && v.videoWidth && getComputedStyle(v).display !== 'none' && +getComputedStyle(v).opacity > 0) cover(v, v.videoWidth, v.videoHeight);
    if (G.sbCanvas && G.sbCanvas.width) { const [x, y, w, hh] = at(G.sbCanvas); ctx.drawImage(G.sbCanvas, x, y, w, hh); }
    // the dim over them
    const dim = +getComputedStyle(G.dimEl).opacity || 0;
    if (dim > 0) { ctx.fillStyle = `rgba(0, 0, 0, ${dim})`; ctx.fillRect(0, 0, W, H); }
    if (G.canvas && G.canvas.width) { const [x, y, w, hh] = at(G.canvas); ctx.drawImage(G.canvas, x, y, w, hh); }
    // the score and accuracy, top right, as the HUD shows them
    if (G.scoreEl && G.scoreEl.offsetParent !== null && !G.hud.classList.contains('hidden-hud')) {
      const draw = (node, text, weight) => {
        const r = node.getBoundingClientRect(); if (!r.width) return;
        const cs = getComputedStyle(node), size = parseFloat(cs.fontSize) * sy;
        ctx.font = `${weight} ${size}px Torus, Outfit, system-ui, sans-serif`;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, .6)'; ctx.shadowBlur = 8 * sy;
        ctx.fillStyle = cs.color || '#fff';
        ctx.fillText(text, (r.right - box.left) * sx, (r.top + r.height / 2 - box.top) * sy);
        ctx.shadowBlur = 0;
      };
      draw(G.scoreEl, fmtScore(G._lastSc || 0), 700);
      draw(G.accEl, fmtAcc(G._lastAcc ?? 1), 600);
    }
    return c;
  },
  image(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); },
  /** This tab, through the browser's screen capture (one frame). */
  async capture() {
    const md = navigator.mediaDevices;
    if (!md || !md.getDisplayMedia) { Toast.err('Screenshots need a newer browser', 'This browser can\'t capture the page — screenshots still work while playing.'); return null; }
    const stream = await md.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' });
    const track = stream.getVideoTracks()[0];
    try {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.srcObject = stream;
      await v.play();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      return c;
    } finally { track.stop(); }
  },
};
