#!/usr/bin/env python3
"""Switch the TM after "VeritaAssure" to the registered mark in the two link-preview images (2026-10-27, USPTO Reg. 8521603), and
correct demo-og.png's "Seventeen modules" to "Eighteen modules" (CLAUDE.md: public copy says eighteen).

client/public/og-image.png (site-wide share image) and client/public/demo-og.png (/demo pages) have no generator in the
repo, so this patches them in place: both sit on a flat brand-teal background, so the old glyph (and its drop shadow on
demo-og) is painted over with the background colour and the new text is drawn in the matching Windows font (Arial Bold
on og-image, Segoe UI on demo-og). Positions are measured from the images themselves, not hard-coded.

Usage: python scripts/retm_og_images.py [out_dir]   (default: overwrite client/public/)
"""
import os
import site
import sys

sys.path.append(site.getusersitepackages())
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "client", "public")
OUT = sys.argv[1] if len(sys.argv) > 1 else PUB
FONTS = r"C:\Windows\Fonts"
REG = "\u00ae"


def lit(px, x, y, t=200):
    return min(px[x, y][:3]) > t


def col_clusters(img, y0, y1):
    px = img.load(); w = img.size[0]
    on = [any(lit(px, x, y) for y in range(y0, y1)) for x in range(w)] + [False]
    out, s = [], None
    for x, v in enumerate(on):
        if v and s is None: s = x
        if not v and s is not None: out.append((s, x - 1)); s = None
    return out


def row_span(img, x0, x1, y0, y1):
    px = img.load()
    ys = [y for y in range(y0, y1) if any(lit(px, x, y) for x in range(x0, x1 + 1))]
    return min(ys), max(ys)


def fit_font(path, text, target_w, target_h=None):
    best = None
    for size in range(8, 200):
        f = ImageFont.truetype(path, size)
        l, t, r, b = f.getbbox(text)
        err = (abs((r - l) - target_w) if target_w else 0) + (abs((b - t) - target_h) if target_h else 0)
        if best is None or err < best[0]:
            best = (err, size)
    return ImageFont.truetype(path, best[1]), best[1]


def og_image():
    img = Image.open(os.path.join(PUB, "og-image.png")).convert("RGB")
    bg = img.getpixel((20, 20))
    cl = col_clusters(img, 200, 300)
    # Title "VeritaAssure" + TM: the TM is the last two clusters (T and M); the "e" before it sets the cap height.
    tm_x0, tm_x1 = cl[-2][0], cl[-1][1]
    tm_y0, tm_y1 = row_span(img, tm_x0, tm_x1, 200, 300)
    cap_y0, base_y = row_span(img, cl[0][0], cl[0][1], 200, 300)  # the "V": cap top to baseline
    d = ImageDraw.Draw(img)
    d.rectangle([tm_x0 - 3, tm_y0 - 3, tm_x1 + 3, tm_y1 + 3], fill=bg)
    # A registered sign as tall as the old TM reads heavy (it is a full circle); 70% matches a normal superscript.
    f, size = fit_font(os.path.join(FONTS, "arialbd.ttf"), REG, target_w=0, target_h=round(0.7 * (tm_y1 - tm_y0 + 1)))
    l, t, r, b = f.getbbox(REG)
    d.text((tm_x0 - l, tm_y0 - t), REG, font=f, fill=(255, 255, 255))
    img.save(os.path.join(OUT, "og-image.png"), optimize=True)
    return f"og-image: TM at x{tm_x0}-{tm_x1} y{tm_y0}-{tm_y1} -> registered sign Arial Bold {size}px (cap top {cap_y0}, baseline {base_y})"


def shadowed(img, xy, text, font, fill=(255, 255, 255), shadow=(0, 40, 44, 170), off=(2, 3), blur=2):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((xy[0] + off[0], xy[1] + off[1]), text, font=font, fill=shadow)
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    base = img.convert("RGBA"); base.alpha_composite(layer)
    ImageDraw.Draw(base).text(xy, text, font=font, fill=fill)
    return base.convert("RGB")


def demo_og():
    img = Image.open(os.path.join(PUB, "demo-og.png")).convert("RGB")
    bg = img.getpixel((20, 20))
    msgs = []
    # 1) Title TM (band 165-240): last two clusters.
    cl = col_clusters(img, 165, 240)
    tm_x0, tm_x1 = cl[-2][0], cl[-1][1]
    tm_y0, tm_y1 = row_span(img, tm_x0, tm_x1, 165, 240)
    ImageDraw.Draw(img).rectangle([tm_x0 - 3, tm_y0 - 3, tm_x1 + 7, tm_y1 + 8], fill=bg)
    f, size = fit_font(os.path.join(FONTS, "segoeuib.ttf"), REG, target_w=0, target_h=tm_y1 - tm_y0 + 1)
    l, t, r, b = f.getbbox(REG)
    img = shadowed(img, (tm_x0 - l, tm_y0 - t), REG, f)
    msgs.append(f"demo-og: TM at x{tm_x0}-{tm_x1} y{tm_y0}-{tm_y1} -> registered sign Segoe UI Bold {size}px")
    # 2) Feature line (band 436-472): repaint the whole line with "Eighteen".
    lc = col_clusters(img, 436, 472)
    x0, x1 = lc[0][0], lc[-1][1]
    y0, y1 = row_span(img, x0, x1, 430, 478)
    old = "Seventeen modules  \u00b7  surveyor-ready output  \u00b7  built by a former Joint Commission surveyor"
    new = "Eighteen modules  \u00b7  surveyor-ready output  \u00b7  built by a former Joint Commission surveyor"
    f2, size2 = fit_font(os.path.join(FONTS, "segoeui.ttf"), old, target_w=x1 - x0 + 1)
    ImageDraw.Draw(img).rectangle([x0 - 6, y0 - 6, x1 + 8, y1 + 9], fill=bg)
    l, t, r, b = f2.getbbox(new)
    cx = (x0 + x1) / 2
    ol, ot, orr, ob = f2.getbbox(old)
    img = shadowed(img, (round(cx - (r - l) / 2 - l), y0 - ot), new, f2)
    msgs.append(f"demo-og: line x{x0}-{x1} y{y0}-{y1} redrawn in Segoe UI {size2}px, centred at {cx:.0f}")
    img.save(os.path.join(OUT, "demo-og.png"), optimize=True)
    return "; ".join(msgs)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print(og_image()); print(demo_og())
