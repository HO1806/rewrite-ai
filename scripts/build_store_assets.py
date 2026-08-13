#!/usr/bin/env python3
"""
Build the Chrome Web Store listing assets from the originals in store-assets/source.

    pip install Pillow
    python scripts/build_store_assets.py

Deliberately Python rather than Node: this runs by hand when the artwork changes,
never in CI, and adding `sharp` to package.json for it would put a native image
dependency in the extension's dependency tree for no runtime benefit.

The store rejects anything that is not exactly the required size, so every asset
goes through one cover-crop-then-downscale path. Nothing is ever stretched to fit
or padded out with bars.

Requirements, from https://developer.chrome.com/docs/webstore/images:
  screenshots  1280x800 (or 640x400), max 5, square corners, full bleed, no padding
  small tile   440x280, required for the listing to rank alongside others
  store icon   128x128 with the artwork at 96x96 and 16px transparent padding
  marquee      1400x560, optional; not built - see store-assets/README.md
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageStat
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "store-assets" / "source"
UPLOAD = ROOT / "store-assets" / "upload"
ICONS = ROOT / "icons"

SCREENSHOT = (1280, 800)
SMALL_TILE = (440, 280)
STORE_ICON = 128
# The store icon's artwork must sit inside a 96x96 box, leaving 16px of
# transparent padding per side for the rounded frame Chrome draws itself.
STORE_ICON_ART = 96

# Toolbar icons fill most of their frame. The shipped ones had the mark at
# 38-62% of the width, which reads as a speck at 16px.
TOOLBAR_PLATE_FILL = 0.94
TOOLBAR_GLYPH_FILL = 0.62

# Toolbar icons are plated rather than bare. The artwork is a tall, narrow mark
# in pale blue-to-purple; at 16x16 that renders as an unreadable 10x15 smudge
# with no contrast against either a light or a dark toolbar. Filling a gradient
# plate and knocking the mark out in white keeps it legible at every size.
PLATE_FROM = (59, 130, 246)   # #3b82f6
PLATE_TO = (139, 92, 246)     # #8b5cf6

# source stem -> output name. Screenshots 1-5 are the upload set; the two `alt-`
# files are spares, since the store accepts a maximum of five.
SCREENSHOTS = {
    "20b8a8b0-2918-4a02-be95-e84abf05ef09": "screenshot-1-hero",
    "221e6131-4214-4cf2-8d69-15c96a1e598d": "screenshot-2-whatsapp-tone",
    "e3ea21c3-94b7-4958-82a8-798be1e2297c": "screenshot-3-gmail-format",
    "ba15c1eb-ac1c-42ef-bfc6-7a2f91a7f89d": "screenshot-4-context-menu",
    "ce2248ce-62ea-4c8e-85d7-db31715ab551": "screenshot-5-popup-settings",
    "d8b96310-38cc-41a4-a1da-a1b84161efd4": "alt-whatsapp-simple",
    "2e9042ec-d4a3-4e8e-b0a0-4bcbd101767c": "alt-context-menu-dark",
}

BRAND = "b5469d47-bceb-4ab8-9446-a635db0e4f53"
ICON = "75197c76-3998-42eb-bdf6-73e56a8df43a"

# Measured content bounds in the 1573x1000 brand image: the icon plate spans
# y 112-414, the wordmark y 448-546, the tagline y 586-629, and the card cluster
# starts at x 660. This box keeps all three brand elements whole with even
# margins, which is only possible by reaching past the start of the cards.
TILE_CROP = (0, 102, 844, 639)

# ...so the right edge is faded into the page background. Without it the tile
# ends on a vertically sliced card showing fragments of words, which reads as a
# mistake; faded, it reads as depth. Sampled from the empty band between the
# brand column and the cards rather than hardcoded, so it tracks the artwork.
TILE_FADE_FROM, TILE_FADE_TO = 560, 760
TILE_BG_SAMPLE = (645, 102, 700, 639)


def cover_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Centre-crop to the target aspect, then downscale. Never distorts."""
    target_w, target_h = size
    src_w, src_h = image.size

    scale = max(target_w / src_w, target_h / src_h)
    crop_w, crop_h = target_w / scale, target_h / scale
    left, top = (src_w - crop_w) / 2, (src_h - crop_h) / 2

    box = (round(left), round(top), round(left + crop_w), round(top + crop_h))
    return image.crop(box).resize(size, Image.LANCZOS)


def fade_right_edge(image: Image.Image, background: tuple[float, float, float]) -> Image.Image:
    """Ramp the right edge into a flat background colour."""
    pixels = image.load()
    width, height = image.size
    span = TILE_FADE_TO - TILE_FADE_FROM

    for x in range(max(0, TILE_FADE_FROM), width):
        t = min(1.0, max(0.0, (x - TILE_FADE_FROM) / span))
        if t <= 0:
            continue
        for y in range(height):
            r, g, b = pixels[x, y][:3]
            pixels[x, y] = (
                round(r * (1 - t) + background[0] * t),
                round(g * (1 - t) + background[1] * t),
                round(b * (1 - t) + background[2] * t),
            )

    return image


def average_colour(image: Image.Image, box: tuple[int, int, int, int]) -> tuple[float, float, float]:
    mean = ImageStat.Stat(image.convert("RGB").crop(box)).mean
    return (mean[0], mean[1], mean[2])


def save(image: Image.Image, path: Path, *, keep_alpha: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    if keep_alpha:
        image.save(path, "PNG", optimize=True)
    else:
        # Screenshots and promo tiles are full-bleed; an alpha channel only adds
        # weight and has caused promo-image rejections.
        image.convert("RGB").save(path, "PNG", optimize=True)

    kb = path.stat().st_size / 1024
    print(f"  {path.relative_to(ROOT).as_posix():<48} {image.size[0]}x{image.size[1]}  {kb:.0f} KB")


def load(stem: str) -> Image.Image:
    path = SOURCE / f"{stem}.png"
    if not path.exists():
        sys.exit(f"Missing source image: {path.relative_to(ROOT).as_posix()}")
    return Image.open(path)


def glyph(source: Image.Image) -> Image.Image:
    """
    Crop the source icon to its opaque artwork.

    The 1024x1024 original is a transparent PNG whose opaque content — the
    quill and lightning mark — occupies only about 7% of the frame. Scaling the
    whole thing down leaves a tiny mark floating in empty space, so the artwork
    is isolated first.
    """
    rgba = source.convert("RGBA")
    # A high alpha threshold ignores the very faint glow around the mark, which
    # would otherwise inflate the bounding box by a third.
    solid = rgba.getchannel("A").point(lambda a: 255 if a > 200 else 0)

    box = solid.getbbox()
    if box is None:
        sys.exit("The icon source has no opaque pixels to crop to.")
    return rgba.crop(box)


def fit_centred(art: Image.Image, canvas: int, art_box: int) -> Image.Image:
    """Scale art into art_box, centred on a transparent canvas x canvas square."""
    scale = art_box / max(art.size)
    sized = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)

    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.paste(sized, ((canvas - sized.width) // 2, (canvas - sized.height) // 2), sized)
    return out


def toolbar_icon(art: Image.Image, size: int) -> Image.Image:
    """A gradient rounded-square plate with the mark knocked out in white."""
    # Render at 8x and downsample, so the rounded corners and the mark's edges
    # are antialiased rather than jagged at 16px.
    scale = 8
    canvas = size * scale
    plate_size = round(canvas * TOOLBAR_PLATE_FILL)
    radius = round(plate_size * 0.28)

    gradient = Image.new("RGB", (plate_size, plate_size))
    pixels = gradient.load()
    for y in range(plate_size):
        for x in range(plate_size):
            # 135-degree ramp, matching the brand gradient direction.
            t = (x + y) / (2 * (plate_size - 1))
            pixels[x, y] = tuple(
                round(PLATE_FROM[i] * (1 - t) + PLATE_TO[i] * t) for i in range(3)
            )

    mask = Image.new("L", (plate_size, plate_size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, plate_size - 1, plate_size - 1), radius=radius, fill=255
    )

    plate = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    offset = (canvas - plate_size) // 2
    plate.paste(gradient, (offset, offset), mask)

    # Knock the mark out in white using its own alpha as the stencil.
    glyph_box = round(canvas * TOOLBAR_GLYPH_FILL)
    stencil = fit_centred(art, canvas, glyph_box).getchannel("A")
    plate.paste(Image.new("RGBA", (canvas, canvas), (255, 255, 255, 255)), (0, 0), stencil)

    return plate.resize((size, size), Image.LANCZOS)


def main() -> None:
    print("Screenshots (1280x800):")
    for stem, name in SCREENSHOTS.items():
        save(cover_resize(load(stem), SCREENSHOT), UPLOAD / f"{name}.png")

    print("\nSmall promotional tile (440x280):")
    brand = load(BRAND).convert("RGB")
    tile = fade_right_edge(brand.crop(TILE_CROP), average_colour(brand, TILE_BG_SAMPLE))
    save(cover_resize(tile, SMALL_TILE), UPLOAD / "promo-small-440x280.png")

    print(f"\nStore icon ({STORE_ICON}x{STORE_ICON}, artwork at {STORE_ICON_ART}x{STORE_ICON_ART}):")
    art = glyph(load(ICON))
    print(f"  artwork cropped to {art.width}x{art.height} from {load(ICON).size[0]}x{load(ICON).size[1]}")
    save(fit_centred(art, STORE_ICON, STORE_ICON_ART), UPLOAD / "store-icon-128.png", keep_alpha=True)

    print("\nToolbar icons (same artwork, plated for legibility at 16px):")
    for size in (16, 48, 128):
        save(toolbar_icon(art, size), ICONS / f"icon-{size}.png", keep_alpha=True)

    print("\nDone. Upload screenshots 1-5, the tile, and the store icon.")


if __name__ == "__main__":
    main()
