#!/usr/bin/env python3
"""Polish a cut-out picture of Neru that's already made (tools/neru-art.py's output): where she runs off a side of the
picture (her ponytail, her side, an arm — the video's frame cut her off there), she fades out over a longer, eased way
than neru-art.py's fade_edges gives a side (5% of a narrow picture's width: a few pixels at the size the game shows
her, which reads as a hard straight line down her hair).

    python3 tools/neru-polish.py IN [IN2 ...] --out public/ [--fade 0.1] [--min-run 0.04]

Each IN is written to OUT/<same name>. Where she reaches the left or right edge down a stretch of at least --min-run of
the picture's height, she fades out over --fade of its height before the edge (on top of the fade there already); the
fade eases out above and below that stretch, so it never starts or stops at a line of its own. The bottom edge (12%
already) is left as it is.

Saved as neru-art.py saves a faded picture: in pngquant's 256 colours, undithered (a fifth the size, and her flat
colours lose nothing).

Needs: pip install numpy pillow; apt install pngquant
"""
import argparse
import os
import shutil
import subprocess

import numpy as np
from PIL import Image


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def runs(mask):
    """(start, end) of each run of True in a 1-D mask."""
    d = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)))


def fade_sides(alpha, fade=0.1, min_run=0.04):
    """She fades out before the left and right edges where she reaches them: the edges and the rows faded."""
    h, w = alpha.shape
    n = max(8, int(h * fade))
    band = max(2, int(w * 0.02))
    a = alpha.copy()
    ys = np.arange(h)[:, None]
    xs = np.arange(w)[None, :]
    done = []
    for side, cols in (('left', slice(0, band)), ('right', slice(w - band, w))):
        reach = alpha[:, cols].max(axis=1) > 0.25
        for y0, y1 in runs(reach):
            if y1 - y0 < h * min_run:
                continue
            d = xs if side == 'left' else (w - 1 - xs)
            across = np.where(d < n, smooth(d / n), 1.0)
            # (eased in over a shorter way than across, so a long fade beside her legs doesn't reach up into her face)
            along = smooth(1 - np.maximum(np.maximum(y0 - ys, ys - y1), 0) / max(8, int(h * 0.06)))
            a *= 1 - along * (1 - across)
            done.append((side, int(y0), int(y1)))
    return a, done


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--fade', type=float, default=0.1)
    ap.add_argument('--min-run', type=float, default=0.04)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for src in args.inputs:
        p = np.array(Image.open(src).convert('RGBA')).astype(np.float32)
        a, done = fade_sides(p[..., 3] / 255, args.fade, args.min_run)
        p[..., 3] = (a * 255).round()
        dst = os.path.join(args.out, os.path.basename(src))
        Image.fromarray(p.clip(0, 255).astype(np.uint8), 'RGBA').save(dst, optimize=True)
        if shutil.which('pngquant'):
            subprocess.run(['pngquant', '256', '--nofs', '--speed', '1', '--force', '--output', dst, dst], check=True)
        print(f'{os.path.basename(src)}: ' + (', '.join(f'{s} edge, rows {y0}-{y1}' for s, y0, y1 in done) or 'nothing to fade'))


if __name__ == '__main__':
    main()
