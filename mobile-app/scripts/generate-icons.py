"""
Regenerates the Android launcher icons from assets/brand/icon-source.png.

    python scripts/generate-icons.py

Writes, under android/app/src/main/res/:
  mipmap-*/ic_launcher.webp, ic_launcher_round.webp     (legacy, Android < 8)
  mipmap-*/ic_launcher_foreground.webp                   (adaptive foreground)
  mipmap-anydpi-v26/ic_launcher*.xml                     (adaptive icon)
and assets/brand/logo.png (the 192px logo shown inside the app).
The icon changes native resources, so shipping it needs a new APK (and a
runtimeVersion bump), not an OTA update.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "brand" / "icon-source.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

NAVY = (2, 16, 60)  # same as @color/bizmate_icon_background
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def rounded_art() -> Image.Image:
    """The artwork's rounded square, with its black surround made transparent."""
    im = Image.open(SRC).convert("RGB")
    arr = np.array(im).astype(int)
    solid = arr.max(axis=2) > 6
    ys, xs = np.where(solid)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    art = im.crop(box)
    mask = Image.fromarray((solid[box[1]:box[3], box[0]:box[2]] * 255).astype("uint8"))
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    art = art.convert("RGBA")
    art.putalpha(mask)
    return art


def logo_only() -> Image.Image:
    """The B mark + wordmark on a transparent background (for the adaptive icon).

    The artwork's navy backdrop is a smooth gradient, so it is estimated per row
    from the empty left/right margins, and a pixel's alpha is how far it is from
    that backdrop. This keeps the foreground free of the square's border.
    """
    im = Image.open(SRC).convert("RGB")
    arr = np.array(im).astype(float)
    solid = arr.max(axis=2) > 6
    ys, xs = np.where(solid)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    art = arr[y0:y1, x0:x1]
    h, w, _ = art.shape
    left = np.median(art[:, int(w * 0.10):int(w * 0.16)], axis=1)   # per-row backdrop, left margin
    right = np.median(art[:, int(w * 0.84):int(w * 0.90)], axis=1)  # ... and right margin
    t = np.linspace(0, 1, w)[None, :, None]
    bg = left[:, None, :] * (1 - t) + right[:, None, :] * t
    dist = np.linalg.norm(art - bg, axis=2)
    alpha = np.clip(dist / 110.0, 0, 1)
    # keep only the central region (drop the rounded border and any corner noise)
    keep = np.zeros((h, w))
    keep[int(h * 0.12):int(h * 0.90), int(w * 0.10):int(w * 0.90)] = 1
    alpha *= keep
    out = np.dstack([art, alpha * 255]).astype("uint8")
    img = Image.fromarray(out, "RGBA")
    return img.crop(img.getbbox())


def square(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


def on_canvas(art: Image.Image, canvas: int, scale: float, bg=None) -> Image.Image:
    out = Image.new("RGBA", (canvas, canvas), (*bg, 255) if bg else (0, 0, 0, 0))
    a = square(art, int(canvas * scale))
    off = (canvas - a.width) // 2
    out.alpha_composite(a, (off, off))
    return out


def main() -> None:
    art = rounded_art()
    logo = logo_only()
    for dpi, size in LEGACY.items():
        d = RES / f"mipmap-{dpi}"
        d.mkdir(parents=True, exist_ok=True)
        square(art, size).save(d / "ic_launcher.webp", lossless=True)

        big = size * 4  # draw the circle at 4x, then shrink for clean edges
        round_img = on_canvas(art, big, 0.96, bg=NAVY)
        circle = Image.new("L", (big, big), 0)
        ImageDraw.Draw(circle).ellipse((0, 0, big - 1, big - 1), fill=255)
        round_img.putalpha(circle)
        round_img.resize((size, size), Image.LANCZOS).save(d / "ic_launcher_round.webp", lossless=True)

    for dpi, size in ADAPTIVE.items():
        d = RES / f"mipmap-{dpi}"
        # The wordmark is wide; 0.52 of the canvas keeps it inside every mask shape.
        fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        k = int(size * 0.52) / max(logo.size)
        lg = logo.resize((max(1, int(logo.width * k)), max(1, int(logo.height * k))), Image.LANCZOS)
        fg.alpha_composite(lg, ((size - lg.width) // 2, (size - lg.height) // 2))
        fg.save(d / "ic_launcher_foreground.webp", lossless=True)

    # In-app logo (shop-code screen, home header): small, rounded, transparent corners.
    square(art, 192).save(ROOT / "assets" / "brand" / "logo.png", optimize=True)

    any_dir = RES / "mipmap-anydpi-v26"
    any_dir.mkdir(parents=True, exist_ok=True)
    xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '  <background android:drawable="@color/bizmate_icon_background"/>\n'
        '  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '</adaptive-icon>\n'
    )
    (any_dir / "ic_launcher.xml").write_text(xml, encoding="utf-8")
    (any_dir / "ic_launcher_round.xml").write_text(xml, encoding="utf-8")
    print("icons written to", RES)


if __name__ == "__main__":
    main()
