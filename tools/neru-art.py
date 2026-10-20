#!/usr/bin/env python3
"""Neru's pictures for the game: upscaled 4x with Real-ESRGAN's anime model, cut out from their background with a
clean edge (no white rim from an earlier cut-out), faded out where the picture's edge cuts her off, and saved at the
size the game shows them.

    python3 tools/neru-art.py IN [IN2 ...] --out public/ [--name neru-cheer] [--frame 0] [--height 1400] [--colors 80] [--plain]
        [--crop x0,y0,x1,y1] [--tol 7] [--bg R,G,B] [--holes x,y;x,y] [--fast]

Each IN — a file, or a link to one online (a sticker, a GIF) — is a picture of Neru on a plain background, or already
cut out (transparent around her); of an animated one, --frame picks the frame. The result is OUT/<name>.png (--name
for a single picture: the game takes neru.png as her smug face and neru-<pose>.png — happy, cheer, laugh, shrug —
as her others, see NeruMascot.POSES), --height pixels tall (sharp on a phone's screen at the biggest she's shown), in
--colors colours (flat colours like hers lose nothing, and the file is a fraction of the size). --plain skips the
upscaling (a picture that's already big and sharp).

A frame of the song's music video (ffmpeg -ss <time> -i <video> -frames:v 1 frame.png): --crop to the panel she's in,
--fast for the upscaler made for anime video (minutes, not half an hour), and --bg 254,202,223 (the video's pink) for
a close-up, where she runs off most of the frame's edge. A pocket of background she shuts in (between her hair and
something she holds) small enough to be left as part of her: --holes, a point in it.

Needs: pip install numpy pillow scipy realesrgan-ncnn-py; apt install libomp5 pngquant; and a Vulkan driver — with no
GPU, Chromium's software one: VK_ICD_FILENAMES=<chromium>/chrome-linux/vk_swiftshader_icd.json (slow: ~25 minutes a
picture).
"""
import argparse
import io
import os
import shutil
import subprocess
import sys
import urllib.request

import numpy as np
from PIL import Image
from scipy import ndimage


def flatten(im):
    """The picture on its background colour, where that background is, and how solid each pixel is: a cut-out's
    transparent part is its background (drawn white, as it was cut from — its part-transparent pixels keep their own
    colour: where the picture's edge cuts her off, she fades out, and that stays); a picture with a background
    of its own has it all round its edge."""
    a = np.array(im.convert('RGBA')).astype(np.float32)
    alpha = a[..., 3] / 255
    if (alpha < 0.5).mean() > 0.02:
        bg = np.array([255, 255, 255], np.float32)
        seed = alpha < 0.02
        solid = np.where(alpha >= 0.97, 1, alpha)
        rgb = np.where(seed[..., None], bg, a[..., :3])
        return Image.fromarray(rgb.round().clip(0, 255).astype(np.uint8)), bg, seed, solid, 40
    # a background of its own (a frame of the music video: flat pink, a shade off her cardigan): every patch of
    # exactly that colour that touches the edge, or is big enough not to be part of her — the gaps between her arms
    # and her body too — but not her cardigan, a few levels away and behind her outline
    edge = np.concatenate([a[0, :, :3], a[-1, :, :3], a[:, 0, :3], a[:, -1, :3]])
    # (its commonest colour, not an average: where her desk or her hair runs along the edge, an average is off)
    vals, counts = np.unique(edge.round().astype(np.int32), axis=0, return_counts=True)
    bg = BG if BG is not None else vals[counts.argmax()].astype(np.float32)
    close = np.abs(a[..., :3] - bg).max(-1) < TOL
    lab, n = ndimage.label(close)
    sizes = np.bincount(lab.ravel())
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    # (and that colour through and through: where she runs off the frame, a patch of cardigan — a few levels off, but
    # nudged nearer by the video's compression — isn't background)
    diff = np.abs(a[..., :3] - bg).max(-1)
    typical = ndimage.median(diff, lab, index=np.arange(1, n + 1)) if n else []
    keep = [i for i in range(1, n + 1) if (i in border or sizes[i] > close.size * 0.002) and typical[i - 1] <= TOL / 2]
    seed = np.isin(lab, keep)
    # (and any pocket of it named with --holes: one shut in by her hair and something she holds is too small to tell
    # from a patch of her skin, a shade off it)
    for x, y in HOLES:
        if lab[y, x]:
            seed |= lab == lab[y, x]
    return Image.fromarray(a[..., :3].round().clip(0, 255).astype(np.uint8)), bg, seed, np.ones(alpha.shape, np.float32), TOL * 2


def frame_cut(im):
    """Where the picture's edge cuts her off (a hand, her legs), an earlier cut-out left her fading out over a few
    pixels: the box that trims those off, so she ends there with a clean, straight edge."""
    alpha = np.array(im.convert('RGBA'))[..., 3].astype(np.float32) / 255
    h, w = alpha.shape

    def depth(lines):  # lines: the picture's rows or columns, from that edge inwards
        hit = lines[0] > 0.02
        if hit.sum() < 4:
            return 0
        for i in range(min(40, len(lines))):
            if np.median(lines[i][hit]) >= 0.97:
                return i
        return 0
    return (depth(alpha.T), depth(alpha), w - depth(alpha.T[::-1]), h - depth(alpha[::-1]))


TOL = 7  # (how far from the background's colour a pixel may be and still be background: --tol)
BG = None  # (the background's colour, when she fills so much of the picture that its edge doesn't show it: --bg)
HOLES = []  # (points in pockets of background she shuts in, that are background too: --holes)
MODEL = 3  # realesrgan-x4plus-anime (--fast: 0, realesr-animevideov3-x2 — made for frames of anime video, and many
#            times quicker)


def upscale(rgb):
    from realesrgan_ncnn_py import Realesrgan
    return Realesrgan(gpuid=0, model=MODEL, tilesize=256).process_pil(rgb)


def cut_out(rgb, bg, seed, solid, reach=40):
    """Alpha for the (upscaled) picture: the background around her — everything near its colour (within `reach`)
    that's connected to where the background was — goes; the rim where her outline meets it is made part-transparent
    outline colour (colour-to-alpha), so there's no light fringe on a dark menu."""
    a = np.array(rgb).astype(np.float32)
    h, w = a.shape[:2]
    k = h // seed.shape[0]
    seed = np.kron(seed, np.ones((k, k), bool))[:h, :w] if k > 1 else seed
    solid = np.array(Image.fromarray((solid * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)).astype(np.float32) / 255
    diff = np.abs(a - bg).max(-1)
    # (only a few pixels past where the background was: a near-white part of her that the picture's edge cuts
    # open — a palm, a sleeve — mustn't be taken for it)
    near = (diff < reach) & ndimage.binary_dilation(seed, iterations=6 * k)
    lab, _ = ndimage.label(near)
    ids = np.unique(lab[seed & near])
    back = np.isin(lab, ids[ids > 0])
    # the outline's colour: the darkest pixels along the edge of what's left
    band = ndimage.binary_dilation(back, iterations=max(3, k * 2)) & ~back
    lum = a.mean(-1)
    dark = band & (lum <= np.percentile(lum[band], 20))
    line = np.median(a[dark], axis=0) if dark.any() else np.array([60, 30, 50], np.float32)
    # colour-to-alpha along the rim: each pixel as a mix of the outline colour and the background
    d = bg - line
    t = np.clip(((bg - a) @ d) / (d @ d), 0, 1)
    resid = np.abs(a - (bg - t[..., None] * d)).max(-1)
    rim = band & (resid < 56)
    alpha = solid.copy()
    alpha[back] = 0
    alpha[rim] = t[rim] * solid[rim]
    # only her: text beside her (the song's words), bits of anything else in the frame go
    lab, n = ndimage.label(alpha > 0.5)
    if n > 1:
        sizes = np.bincount(lab.ravel()); sizes[0] = 0
        alpha[~np.isin(lab, np.where(sizes >= sizes.max() * 0.03)[0])] = 0
    out = a.copy()
    out[rim] = line
    return out, alpha


def fade_edges(alpha, bottom=0.12, side=0.05):
    """Where the picture's edge cuts her off (at the waist in most frames of the video, her hair off a side), she
    fades out over a short way rather than ending in a hard straight line: the game shows her over its screens, not
    in a box. (An edge she's already faded out at is left as it is.)"""
    h, w = alpha.shape
    a = alpha.copy()

    def ramp(n):
        t = (np.arange(n) + 0.5) / n
        return t * t * (3 - 2 * t)

    def cut(line):
        return (line > 0.5).sum() >= max(6, line.size * 0.03)
    b, t, l, r = cut(alpha[-1]), cut(alpha[0]), cut(alpha[:, 0]), cut(alpha[:, -1])
    if b:
        n = max(2, round(h * bottom)); a[-n:] *= ramp(n)[::-1, None]
    if t:
        n = max(2, round(h * side)); a[:n] *= ramp(n)[:, None]
    if l:
        n = max(2, round(w * side)); a[:, :n] *= ramp(n)[None, :]
    if r:
        n = max(2, round(w * side)); a[:, -n:] *= ramp(n)[None, ::-1]
    return a


def save(rgbf, alpha, path, height, colors=0):
    """Resized on premultiplied colour (no dark or light seams at the edge), then saved."""
    h, w = alpha.shape
    pm = np.dstack([rgbf * alpha[..., None], alpha * 255]).clip(0, 255)
    im = Image.fromarray(pm.round().astype(np.uint8), 'RGBA')
    if height and height < h:
        im = im.resize((round(w * height / h), height), Image.LANCZOS)
    p = np.array(im).astype(np.float32)
    al = p[..., 3:4] / 255
    rgb = np.where(al > 0, p[..., :3] / np.maximum(al, 1e-6), 0)
    out = np.dstack([rgb, p[..., 3:4]]).round().clip(0, 255).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(path, optimize=True)
    # (no dithering: it would speckle her flat colours, and the file with them)
    if colors and shutil.which('pngquant'):
        subprocess.run(['pngquant', str(colors), '--nofs', '--speed', '1', '--force', '--output', path, path], check=True)


def load(src, frame):
    """A file, or a link to one (downloaded): of an animated picture, the frame asked for."""
    if src.startswith(('http://', 'https://')):
        req = urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0 (neru-art)'})
        with urllib.request.urlopen(req, timeout=60) as r:
            im = Image.open(io.BytesIO(r.read()))
    else:
        im = Image.open(src)
    if getattr(im, 'n_frames', 1) > 1:
        im.seek(min(frame, im.n_frames - 1))
    return im.convert('RGBA')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--height', type=int, default=1400)
    ap.add_argument('--colors', type=int, default=80)
    ap.add_argument('--plain', action='store_true', help='no upscaling (a lanczos 4x instead, to cut out at)')
    ap.add_argument('--name', help='the result\'s name (one picture): neru, neru-happy, neru-cheer…')
    ap.add_argument('--frame', type=int, default=0, help='of an animated picture, which frame')
    ap.add_argument('--crop', help='x0,y0,x1,y1: the part of the picture she\'s in (a frame of a video)')
    ap.add_argument('--tol', type=int, default=7, help='how close to the background\'s colour is background')
    ap.add_argument('--bg', help='R,G,B: the background\'s colour (a close-up, where she runs off most of the edge)')
    ap.add_argument('--holes', help='x,y[;x,y…]: points (after --crop) in small pockets of background she shuts in')
    ap.add_argument('--fast', action='store_true', help='the anime-video upscaler (2x, quick) instead of the anime one')
    o = ap.parse_args()
    global TOL, MODEL, BG, HOLES
    TOL, MODEL = o.tol, (0 if o.fast else 3)
    BG = np.array([float(v) for v in o.bg.split(',')], np.float32) if o.bg else None
    HOLES = [tuple(int(v) for v in p.split(',')) for p in o.holes.split(';')] if o.holes else []
    if o.name and len(o.inputs) > 1:
        ap.error('--name is for one picture')
    os.makedirs(o.out, exist_ok=True)
    for f in o.inputs:
        im = load(f, o.frame)
        if o.crop:
            im = im.crop(tuple(int(v) for v in o.crop.split(',')))
        im = im.crop(frame_cut(im))
        rgb, bg, seed, solid, reach = flatten(im)
        big = rgb.resize((rgb.width * 4, rgb.height * 4), Image.LANCZOS) if o.plain else upscale(rgb)
        rgbf, alpha = cut_out(big, bg, seed, solid, reach)
        # (just her, with a little room: a frame of a video has a lot of background around her)
        ys, xs = np.where(alpha > 0.1)  # (not a faint speck of what was cut away)
        if len(xs):
            m = max(4, big.height // 100)
            y0, y1, x0, x1 = max(0, ys.min() - m), min(alpha.shape[0], ys.max() + 1 + m), max(0, xs.min() - m), min(alpha.shape[1], xs.max() + 1 + m)
            rgbf, alpha = rgbf[y0:y1, x0:x1], alpha[y0:y1, x0:x1]
        faded = fade_edges(alpha)
        # (a fade needs all of pngquant's colours: at fewer, it comes out in bands)
        colors = 256 if o.colors and not np.array_equal(faded, alpha) else o.colors
        alpha = faded
        dst = os.path.join(o.out, (o.name or os.path.splitext(os.path.basename(f.split('?')[0]))[0]) + '.png')
        save(rgbf, alpha, dst, o.height, colors)
        print(f, '->', dst, file=sys.stderr)
    # (straight out: the Vulkan driver can crash as Python tears it down, after everything's saved)
    sys.stderr.flush()
    os._exit(0)


if __name__ == '__main__':
    main()
