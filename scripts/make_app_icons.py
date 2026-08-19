"""Build Expo icon / splash assets from PowerFlexy logo."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
CANDIDATES = [
    ROOT.parent / "logo-hi-clean.png",
    ROOT.parent / "logo.png",
    ROOT.parent / "pro.powerflexy.com" / "public" / "assets" / "img" / "logo-dark.png",
    ROOT.parent / "pro.powerflexy.com" / "public" / "assets" / "img" / "logo.png",
]
CREAM = (245, 242, 235, 255)


def content_bbox(im: Image.Image, thresh: int = 45):
    px = im.load()
    w, h = im.size
    min_x, min_y, max_x, max_y = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 20:
                continue
            if abs(r - 245) + abs(g - 242) + abs(b - 235) <= thresh:
                continue
            if r > 245 and g > 245 and b > 245:
                continue
            found = True
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
    if not found:
        return (0, 0, w, h)
    pad = 8
    return (
        max(0, min_x - pad),
        max(0, min_y - pad),
        min(w, max_x + 1 + pad),
        min(h, max_y + 1 + pad),
    )


def main() -> None:
    src = next((p for p in CANDIDATES if p.is_file()), None)
    if src is None:
        raise SystemExit("No PowerFlexy logo found for icon generation")
    print("source", src)

    OUT.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert("RGBA")
    box = content_bbox(im)
    cropped = im.crop(box)
    cw, ch = cropped.size
    print("content", cw, ch, "bbox", box)

    size = 1024
    canvas = Image.new("RGBA", (size, size), CREAM)
    fill = int(size * 0.88)
    scale = fill / max(cw, ch)
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    logo = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    ox, oy = (size - nw) // 2, (size - nh) // 2
    canvas.paste(logo, (ox, oy), logo)
    canvas.convert("RGB").save(OUT / "icon.png", "PNG", optimize=True)
    canvas.save(OUT / "splash-icon.png", "PNG", optimize=True)

    fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    safe = int(size * 0.68)
    scale2 = safe / max(cw, ch)
    nw2, nh2 = max(1, int(cw * scale2)), max(1, int(ch * scale2))
    logo2 = cropped.resize((nw2, nh2), Image.Resampling.LANCZOS)
    ox2, oy2 = (size - nw2) // 2, (size - nh2) // 2
    fg.paste(logo2, (ox2, oy2), logo2)
    fg.save(OUT / "android-icon-foreground.png", "PNG", optimize=True)

    Image.new("RGB", (size, size), (245, 242, 235)).save(
        OUT / "android-icon-background.png", "PNG"
    )

    mono = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    alpha = Image.new("L", logo2.size)
    apx = alpha.load()
    lp = logo2.load()
    for y in range(nh2):
        for x in range(nw2):
            r, g, b, a = lp[x, y]
            if a > 20 and abs(r - 245) + abs(g - 242) + abs(b - 235) > 45:
                apx[x, y] = 255
            else:
                apx[x, y] = 0
    black = Image.new("RGBA", logo2.size, (0, 0, 0, 255))
    black.putalpha(alpha)
    mono.paste(black, (ox2, oy2), black)
    mono.save(OUT / "android-icon-monochrome.png", "PNG")

    full_canvas = Image.new("RGBA", (800, 320), CREAM)
    max_w, max_h = 720, 280
    sf = min(max_w / cw, max_h / ch)
    nwf, nhf = max(1, int(cw * sf)), max(1, int(ch * sf))
    lf = cropped.resize((nwf, nhf), Image.Resampling.LANCZOS)
    full_canvas.paste(lf, ((800 - nwf) // 2, (320 - nhf) // 2), lf)
    full_canvas.save(OUT / "logo.png", "PNG", optimize=True)
    cropped.save(OUT / "logo-source.png", "PNG", optimize=True)

    fav = canvas.resize((48, 48), Image.Resampling.LANCZOS)
    fav.save(OUT / "favicon.png", "PNG", optimize=True)

    notif = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    nm = mono.resize((72, 72), Image.Resampling.LANCZOS)
    white = Image.new("RGBA", nm.size, (255, 255, 255, 0))
    wp = white.load()
    mp = nm.load()
    for y in range(nm.size[1]):
        for x in range(nm.size[0]):
            _r, _g, _b, a = mp[x, y]
            if a > 20:
                wp[x, y] = (255, 255, 255, a)
    notif.paste(white, (12, 12), white)
    notif.save(OUT / "notification-icon.png", "PNG", optimize=True)

    print("wrote icons to", OUT)


if __name__ == "__main__":
    main()
