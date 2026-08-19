#!/usr/bin/env python3
"""Make Expo icons from the rounded wordmark: only corners become transparent."""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path(
    r"C:\Users\ilknuraslan\.cursor\projects\e-web-powerflexy-com\assets"
    r"\c__Users_ilknuraslan_AppData_Roaming_Cursor_User_workspaceStorage"
    r"_69d6b1cf12ffe0d6726310f84d715641_images"
    r"_01d90a4a-903b-40a7-9be4-ab3a7875238d-f7754eb3-6b54-46e9-b0b6-b027077a11d4.png"
)
OUT = Path(__file__).resolve().parents[1] / "assets"
DARK = (22, 19, 26)


def flood_white_corners(rgb: np.ndarray, thresh: int = 220) -> np.ndarray:
    """Connected near-white pixels reachable from the 4 corners."""
    h, w, _ = rgb.shape
    white = (rgb[:, :, 0] >= thresh) & (rgb[:, :, 1] >= thresh) & (rgb[:, :, 2] >= thresh)
    seen = np.zeros((h, w), dtype=bool)
    q = deque([(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)])
    while q:
        y, x = q.popleft()
        if y < 0 or y >= h or x < 0 or x >= w or seen[y, x] or not white[y, x]:
            continue
        seen[y, x] = True
        q.extend(((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)))
    # Soften 1px fringe next to cleared corners (AA on the round)
    fringe = np.zeros_like(seen)
    ys, xs = np.where(seen)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
        yy = np.clip(ys + dy, 0, h - 1)
        xx = np.clip(xs + dx, 0, w - 1)
        near = (rgb[yy, xx, 0] >= 180) & (rgb[yy, xx, 1] >= 180) & (rgb[yy, xx, 2] >= 180)
        fringe[yy, xx] = near
    fringe &= ~seen
    alpha = np.full((h, w), 255, dtype=np.uint8)
    alpha[seen] = 0
    alpha[fringe] = 0
    return alpha


def main() -> None:
    raw = Image.open(SRC).convert("RGB")
    rgb = np.array(raw)
    print("source", raw.size, SRC.name)
    alpha = flood_white_corners(rgb)
    rgba = np.dstack([rgb, alpha])
    cleaned = Image.fromarray(rgba, "RGBA")
    print("transparent%", round(100 * (alpha == 0).mean(), 2))

    OUT.mkdir(parents=True, exist_ok=True)
    cleaned.save(OUT / "logo-source.png", "PNG", optimize=True)

    # iOS / Expo icon: opaque, corners filled with icon dark (Apple forbids alpha)
    ios = Image.new("RGB", cleaned.size, DARK)
    ios.paste(cleaned.convert("RGB"), (0, 0), cleaned)
    ios.save(OUT / "icon.png", "PNG", optimize=True)

    # Android adaptive: transparent corners; dark plate behind
    cleaned.save(OUT / "android-icon-foreground.png", "PNG", optimize=True)
    Image.new("RGB", (1024, 1024), DARK).save(OUT / "android-icon-background.png", "PNG")

    mono = np.zeros((1024, 1024, 4), dtype=np.uint8)
    mark = (alpha > 0) & ~((rgb[:, :, 0] < 40) & (rgb[:, :, 1] < 40) & (rgb[:, :, 2] < 40))
    mono[mark] = (0, 0, 0, 255)
    Image.fromarray(mono, "RGBA").save(OUT / "android-icon-monochrome.png", "PNG")

    cleaned.save(OUT / "splash-icon.png", "PNG", optimize=True)
    cleaned.resize((512, 512), Image.Resampling.LANCZOS).save(OUT / "logo.png", "PNG", optimize=True)
    ios.resize((48, 48), Image.Resampling.LANCZOS).save(OUT / "favicon.png", "PNG", optimize=True)

    notif = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    nm = Image.fromarray(mono, "RGBA").resize((72, 72), Image.Resampling.LANCZOS)
    white = Image.new("RGBA", nm.size, (255, 255, 255, 0))
    na = np.array(nm)
    wa = np.array(white)
    on = na[:, :, 3] > 20
    wa[on] = (255, 255, 255, 255)
    notif.paste(Image.fromarray(wa, "RGBA"), (12, 12), Image.fromarray(wa, "RGBA"))
    notif.save(OUT / "notification-icon.png", "PNG")

    for p in sorted(OUT.glob("*.png")):
        im = Image.open(p)
        print(f"  {p.name:32} {im.size} {im.mode} {p.stat().st_size}")


if __name__ == "__main__":
    main()
