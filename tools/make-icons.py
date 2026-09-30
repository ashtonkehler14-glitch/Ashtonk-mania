# Ashtonk!mania app icons (public/icons): the pink osu!-style disc with a white ring and four mania notes in a
# staircase. Usage: python3 tools/make-icons.py  (needs Pillow)
import os
from PIL import Image, ImageDraw
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)
S = 2048

def disc(size, pad_frac, bg=None):
    im = Image.new('RGBA', (size, size), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = size / 2
    r = size * (0.5 - pad_frac)
    # radial-ish gradient: lighter pink at top-left, deeper at bottom-right
    grad = Image.new('RGBA', (size, size))
    gp = grad.load()
    for y in range(0, size, 4):
        for x in range(0, size, 4):
            t = ((x + y) / (2 * size))
            col = (int(255 - 20 * t), int(118 - 70 * t), int(190 - 30 * t), 255)
            for yy in range(y, min(size, y + 4)):
                for xx in range(x, min(size, x + 4)):
                    gp[xx, yy] = col
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse([c - r, c - r, c + r, c + r], fill=255)
    im.paste(grad, (0, 0), mask)
    ring = r * 0.085
    d.ellipse([c - r + ring / 2, c - r + ring / 2, c + r - ring / 2, c + r - ring / 2], outline=(255, 255, 255, 255), width=int(ring))
    # four notes, staircase (like a 4K stair pattern), rounded, inside the ring
    inner = r * 0.66
    colw = inner * 2 / 4
    nh = colw * 0.62
    for i in range(4):
        x0 = c - inner + i * colw + colw * 0.07
        x1 = x0 + colw * 0.86
        y = c + inner * 0.50 - i * (inner * 0.40) - nh / 2
        a = 255 if i % 3 == 0 else 235
        d.rounded_rectangle([x0, y, x1, y + nh], radius=nh * 0.38, fill=(255, 255, 255, a))
    # judgement line
    lw = r * 0.035
    ly = c + inner * 0.50 + nh * 0.78
    d.rounded_rectangle([c - inner, ly, c + inner, ly + lw], radius=lw / 2, fill=(255, 255, 255, 170))
    return im

def save(img, size, path):
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)

any_ = disc(S, 0.02)
for n in (192, 512):
    save(any_, n, os.path.join(OUT, f'icon-{n}.png'))
# maskable: full-bleed background, disc inside the 80% safe zone
mask = disc(S, 0.13, bg=(24, 23, 28, 255))
save(mask, 512, os.path.join(OUT, 'maskable-512.png'))
save(mask, 180, os.path.join(OUT, 'apple-touch-icon.png'))
save(any_, 64, os.path.join(OUT, 'favicon-64.png'))
print('ok')
