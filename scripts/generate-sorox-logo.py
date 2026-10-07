"""Usage: python3 scripts/generate-sorox-logo.py  (needs Pillow)

Generate every Soro X logo asset: a ring with an X inscribed, on a violet squircle."""
import math, os, sys
from PIL import Image, ImageDraw, ImageFilter

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SS = 4  # supersampling

TOP, BOTTOM = (0x5B, 0x21, 0xB6), (0x1E, 0x1B, 0x4B)  # violet -> deep indigo
WHITE = (255, 255, 255)


def p(*a):
    return os.path.join(ROOT, *a)


# ---------- geometry (1024 master box, centre 512) ----------
def bars(w, L):
    """Two diagonal bars (width w, half-length L) as clockwise (screen) polygons."""
    h = w / 2
    out = []
    for dx, dy in ((1, 1), (1, -1)):
        n = math.hypot(dx, dy); ux, uy = dx / n, dy / n; px, py = -uy * h, ux * h
        a = (512 - ux * L, 512 - uy * L); b = (512 + ux * L, 512 + uy * L)
        poly = [(a[0] + px, a[1] + py), (a[0] - px, a[1] - py), (b[0] - px, b[1] - py), (b[0] + px, b[1] + py)]
        area = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]))
        if area < 0:
            poly.reverse()
        out.append(poly)
    return out


def mark_d(R=406, w=75, L=None):
    r = R - w
    if L is None:
        L = R + 94  # the X crosses the ring and runs past it
    d = f"M512 {512-R} A{R} {R} 0 1 1 512 {512+R} A{R} {R} 0 1 1 512 {512-R} Z M512 {512-r} A{r} {r} 0 1 0 512 {512+r} A{r} {r} 0 1 0 512 {512-r} Z"
    for poly in bars(w, L):
        d += " M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in poly) + " Z"
    return d


def draw_mark(size, R=406, w=75, color=WHITE, crop=True):
    """Mark on transparent canvas. crop=True: the ring fills the image (viewBox 106..918)."""
    S = size * SS
    img = Image.new("RGBA", (S, S), color + (0,))
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    if crop:
        k = S / (2 * R); off = 512 - R
    else:
        k = S / 1024; off = 0
    tf = lambda x, y: ((x - off) * k, (y - off) * k)
    c = tf(512, 512)
    d.ellipse([c[0] - R * k, c[1] - R * k, c[0] + R * k, c[1] + R * k], fill=255)
    r = R - w
    d.ellipse([c[0] - r * k, c[1] - r * k, c[0] + r * k, c[1] + r * k], fill=0)
    for poly in bars(w, R + 94):
        d.polygon([tf(*q) for q in poly], fill=255)
    solid = Image.new("RGBA", (S, S), color + (255,))
    img = Image.composite(solid, img, mask)
    return img.resize((size, size), Image.LANCZOS)


def squircle_pts(cx, cy, half, n=5.0, steps=720):
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        x = half * math.copysign(abs(ct) ** (2 / n), ct)
        y = half * math.copysign(abs(st) ** (2 / n), st)
        pts.append((cx + x, cy + y))
    return pts


def gradient(S, top=TOP, bottom=BOTTOM):
    g = Image.new("RGBA", (1, 256))
    for i in range(256):
        t = i / 255
        g.putpixel((0, i), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
    return g.resize((S, S), Image.BICUBIC)


def app_icon(size, inset=0.0, shadow=False, bg=None, mark_color=WHITE, mark_ratio=0.72):
    """Full app icon: squircle (inset = margin fraction per side) with the white mark."""
    S = size * SS
    half = S * (0.5 - inset)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).polygon(squircle_pts(S / 2, S / 2, half), fill=255)
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    if shadow:
        sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        smask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(smask).polygon(squircle_pts(S / 2, S / 2 + S * 0.012, half), fill=110)
        smask = smask.filter(ImageFilter.GaussianBlur(S * 0.018))
        sh.putalpha(smask)
        base = Image.alpha_composite(base, sh)
    fill = gradient(S) if bg is None else Image.new("RGBA", (S, S), bg + (255,))
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    layer.paste(fill, (0, 0), mask)
    base = Image.alpha_composite(base, layer)
    m = int(round(2 * half * mark_ratio))
    mk = draw_mark(m // SS + 1, color=mark_color).resize((m, m), Image.LANCZOS)
    base.alpha_composite(mk, ((S - m) // 2, (S - m) // 2))
    return base.resize((size, size), Image.LANCZOS)


def save(img, *rel, **kw):
    path = p(*rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, **kw)
    print("wrote", rel[-1] if len(rel) == 1 else os.path.join(*rel))


def main():
    # ---------- SVG masters ----------
    D75 = mark_d()
    D80 = mark_d(w=80)
    svg_mark = lambda fill: f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="106 106 812 812" width="812" height="812" role="img" aria-label="Soro X mark"><path fill="{fill}" d="{D75}"/></svg>\n'
    for name, fill in (("white", "#FFFFFF"), ("black", "#000000"), ("violet", "#1E1B4B")):
        open(p("brand", f"sorox-mark-{name}.svg"), "w").write(svg_mark(fill))
    open(p("brand", "sorox-mark-liquid-glass-layer.svg"), "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="Soro X mark (Liquid Glass layer, weight 80)"><path fill="#FFFFFF" d="{D80}"/></svg>\n')
    sq = " L".join(f"{x:.2f} {y:.2f}" for x, y in squircle_pts(512, 512, 500, steps=360))
    mr = 0.72 * 1000 / 812
    open(p("brand", "sorox-app-icon.svg"), "w").write(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="Soro X">\n'
        '<defs><linearGradient id="bg" x1="512" y1="12" x2="512" y2="1012" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="#{TOP[0]:02X}{TOP[1]:02X}{TOP[2]:02X}"/><stop offset="1" stop-color="#{BOTTOM[0]:02X}{BOTTOM[1]:02X}{BOTTOM[2]:02X}"/></linearGradient></defs>\n'
        f'<path fill="url(#bg)" d="M{sq} Z"/>\n'
        f'<g transform="translate(512 512) scale({mr:.6f}) translate(-512 -512)"><path fill="#FFFFFF" d="{D75}"/></g></svg>\n')
    print("wrote brand SVGs")
    # The splash animation keeps its own stroke-68 copy: mark_d(w=68).

    # ---------- rasters ----------
    # white mark, full-bleed, transparent
    for rel, s in ((("assets", "icon-512.png"), 512), (("src", "components", "icon.png"), 644), (("src", "assets", "logo.png"), 644)):
        save(draw_mark(s), *rel)
    save(draw_mark(644), "src", "assets", "logo.webp", lossless=True)
    for base in (("assets",), ("src", "components")):
        save(draw_mark(16), *base, "iconTemplate.png")
        save(draw_mark(32), *base, "iconTemplate@2x.png")
    # mark layer for the macOS 26 .icon bundle (ring at 106..918 of 1024)
    save(draw_mark(1024, crop=False), "assets", "Natively.icon", "Assets", "mark.png")
    # website logo: soft violet mark on white
    web = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
    wm = draw_mark(620, color=(0xDD, 0xD6, 0xFE)); web.alpha_composite(wm, (202, 202)); save(web, "src", "assets", "logowebsite.png")

    # full app icons
    for s in (16, 32, 64, 128, 256, 512, 1024):
        inset = 0 if s <= 64 else 12 / 1024
        save(app_icon(s, inset=inset), "assets", "icons", "png", f"icon_{s}x{s}.png")
    save(app_icon(512, inset=6 / 512), "assets", "icon.png")
    save(app_icon(512, inset=0.0935, shadow=True), "assets", "icons", "mac", "dock-icon.png")
    save(app_icon(192, inset=0.0935, shadow=True), "src", "assets", "about", "app-icon-mac.webp", lossless=True)
    save(app_icon(192, inset=2 / 192), "src", "assets", "about", "app-icon-win.webp", lossless=True)

    # Windows .ico and macOS .icns
    big = app_icon(1024, inset=0)
    save(big, "assets", "icons", "win", "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    mac = app_icon(1024, inset=0.0975, shadow=True)
    for rel in (("assets", "icon.icns"), ("assets", "natively.icns"), ("assets", "icons", "mac", "icon.icns")):
        save(mac, *rel)

    # liquid-glass reference renders
    for ver in ("macos26", "macos27"):
        for v in ("Default", "Dark", "ClearDark", "ClearLight", "TintedDark", "TintedLight"):
            if v == "Default":
                im = app_icon(1024, inset=0.0975)
            elif v.endswith("Dark"):
                im = app_icon(1024, inset=0.0975, bg=(0x1C, 0x1C, 0x1E) if v != "TintedDark" else (0x2E, 0x10, 0x65))
            else:
                im = app_icon(1024, inset=0.0975, bg=(0xF8, 0xF5, 0xFF), mark_color=(0x5B, 0x21, 0xB6))
            save(im, "brand", "liquid-glass", f"sorox-{ver}-{v}.png")


if __name__ == '__main__':
    main()
