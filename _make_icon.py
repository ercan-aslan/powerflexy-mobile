#!/usr/bin/env python3
"""Clean PowerFlexy icon edges and write Expo mobile assets."""
from pathlib import Path
import numpy as np
from PIL import Image

SRC = Path(
    r"C:\Users\ilknuraslan\.cursor\projects\e-web-powerflexy-com\assets"
    r"\c__Users_ilknuraslan_AppData_Roaming_Cursor_User_workspaceStorage_"
    r"69d6b1cf12ffe0d6726310f84d715641_images_image-1aa43d49-1dbf-43ed-abdc-724926b6696b.png"
)
OUT = Path(r"E:\web\powerflexy.com\mobile\assets")
OUT.mkdir(parents=True, exist_ok=True)

# Fill under cleaned icon (light logo → white)
PURPLE = (255, 255, 255, 255)
PINK = (255, 248, 252, 255)
DARK = (255, 255, 255, 255)


def make_gradient(size: int) -> Image.Image:
    """Diagonal purple → pink gradient matching the icon."""
    yy, xx = np.mgrid[0:size, 0:size]
    t = (xx + (size - 1 - yy)) / (2 * (size - 1))
    t = t.astype(np.float32)
    r = PURPLE[0] + (PINK[0] - PURPLE[0]) * t
    g = PURPLE[1] + (PINK[1] - PURPLE[1]) * t
    b = PURPLE[2] + (PINK[2] - PURPLE[2]) * t
    arr = np.stack([r, g, b], axis=-1).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def clean_black_edges(im: Image.Image, threshold: int = 28) -> Image.Image:
    """Turn near-black outer pixels transparent; keep icon body."""
    rgba = im.convert("RGBA")
    arr = np.array(rgba)
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    dark = (r.astype(np.int16) + g.astype(np.int16) + b.astype(np.int16)) < (threshold * 3)
    # Only clear pixels that are dark AND near the image border (outside the squircle)
    # Use flood-fill from corners so we don't punch holes in the logo.
    h, w = dark.shape
    mask = np.zeros((h, w), dtype=bool)
    stack = [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)]
    # Also seed a few border midpoints
    stack += [(0, w // 2), (h - 1, w // 2), (h // 2, 0), (h // 2, w - 1)]
    while stack:
        y, x = stack.pop()
        if y < 0 or y >= h or x < 0 or x >= w:
            continue
        if mask[y, x] or not dark[y, x]:
            continue
        mask[y, x] = True
        stack.extend([(y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)])
    arr[mask, 3] = 0
    return Image.fromarray(arr, "RGBA")


def soft_edge_cleanup(im: Image.Image) -> Image.Image:
    arr = np.array(im)
    a = arr[:, :, 3].astype(np.int16)
    lum = arr[:, :, 0].astype(np.int16) + arr[:, :, 1] + arr[:, :, 2]
    fringe = (a > 0) & (a < 250) & (lum < 70)
    arr[fringe, 3] = 0
    # Clear dark edge pixels that border transparency
    h, w = a.shape
    opaque_dark = (arr[:, :, 3] >= 240) & (lum < 40)
    ys, xs = np.where(opaque_dark)
    for y, x in zip(ys, xs):
        y0, y1 = max(0, y - 1), min(h, y + 2)
        x0, x1 = max(0, x - 1), min(w, x + 2)
        if (arr[y0:y1, x0:x1, 3] == 0).any():
            arr[y, x, 3] = 0
    return Image.fromarray(arr, "RGBA")


def content_bbox(im: Image.Image):
    a = np.array(im.split()[-1])
    ys, xs = np.where(a > 10)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def fit_square(im: Image.Image, size: int, pad_ratio: float = 0.0) -> Image.Image:
    """Scale content into a transparent square canvas."""
    box = content_bbox(im)
    cropped = im.crop(box)
    pad = int(size * pad_ratio)
    target = size - 2 * pad
    cropped.thumbnail((target, target), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - cropped.width) // 2
    y = (size - cropped.height) // 2
    canvas.paste(cropped, (x, y), cropped)
    return canvas


def cover_square(im: Image.Image, size: int) -> Image.Image:
    """Crop to opaque content and scale to fully cover a square (App Store style)."""
    box = content_bbox(im)
    cropped = im.crop(box)
    # Scale so the shorter side fills `size` (cover)
    w, h = cropped.size
    scale = max(size / w, size / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    resized = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (nw - size) // 2
    y = (nh - size) // 2
    return resized.crop((x, y, x + size, y + size))


def opaque_icon(cleaned: Image.Image, size: int = 1024) -> Image.Image:
    """Full-bleed opaque icon for iOS (no transparency, no black corners)."""
    covered = cover_square(cleaned, size)
    # Any residual alpha → fill with nearby gradient
    bg = make_gradient(size).convert("RGBA")
    out = Image.alpha_composite(bg, covered.convert("RGBA"))
    return out.convert("RGB")


def android_foreground(cleaned: Image.Image, size: int = 1024) -> Image.Image:
    """Adaptive foreground with safe padding (~18%)."""
    return fit_square(cleaned, size, pad_ratio=0.12)


def monochrome(cleaned: Image.Image, size: int = 1024) -> Image.Image:
    """White silhouette of the colored mark (ignore near-white background)."""
    fitted = fit_square(cleaned, size, pad_ratio=0.12).convert("RGBA")
    arr = np.array(fitted)
    rgb = arr[:, :, :3].astype(np.int16)
    a = arr[:, :, 3]
    whiteish = (rgb[:, :, 0] > 235) & (rgb[:, :, 1] > 235) & (rgb[:, :, 2] > 235)
    mark = (a > 20) & (~whiteish)
    out = np.zeros_like(arr)
    out[:, :, 0:3] = 255
    out[:, :, 3] = np.where(mark, 255, 0).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def notification_icon(cleaned: Image.Image, size: int = 96) -> Image.Image:
    """White alpha silhouette for Android notification."""
    mono = monochrome(cleaned, 512)
    mono = fit_square(mono, size, pad_ratio=0.08)
    return mono


def favicon(cleaned: Image.Image, size: int = 48) -> Image.Image:
    return fit_square(cleaned, size, pad_ratio=0.02)


def splash(cleaned: Image.Image, size: int = 512) -> Image.Image:
    return fit_square(cleaned, size, pad_ratio=0.08)


def main():
    raw = Image.open(SRC).convert("RGBA")
    cleaned = clean_black_edges(raw, threshold=30)
    cleaned = soft_edge_cleanup(cleaned)

    # Save cleaned source / logo
    cleaned.save(OUT / "logo-source.png", optimize=True)
    fit_square(cleaned, 512, 0.02).save(OUT / "logo.png", optimize=True)

    # Main Expo icon (opaque)
    opaque_icon(cleaned, 1024).save(OUT / "icon.png", optimize=True)

    # Android adaptive
    android_foreground(cleaned, 1024).save(OUT / "android-icon-foreground.png", optimize=True)
    make_gradient(1024).save(OUT / "android-icon-background.png", optimize=True)
    monochrome(cleaned, 1024).save(OUT / "android-icon-monochrome.png", optimize=True)

    # Splash / favicon / notification
    splash(cleaned, 512).save(OUT / "splash-icon.png", optimize=True)
    favicon(cleaned, 48).save(OUT / "favicon.png", optimize=True)
    notification_icon(cleaned, 96).save(OUT / "notification-icon.png", optimize=True)

    print("Wrote assets to", OUT)
    for p in sorted(OUT.glob("*.png")):
        im = Image.open(p)
        print(f"  {p.name:32} {im.size} {im.mode}")


if __name__ == "__main__":
    main()
