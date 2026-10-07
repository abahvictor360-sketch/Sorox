"""Usage: python3 tablet/scripts/generate-icons.py  (needs Pillow)

Draws the Soro X Tablet app icons and splash screens for Android and iOS from
the same logo code as the desktop app (scripts/generate-sorox-logo.py), and
overwrites the Capacitor placeholders at the sizes Capacitor generated.
"""
import glob
import importlib.util
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
TABLET = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location("sorox_logo", os.path.join(TABLET, "..", "scripts", "generate-sorox-logo.py"))
logo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(logo)  # defines the drawing helpers; generation only runs under __main__

SPLASH_BG = (0x0F, 0x0D, 0x24)
ADAPTIVE_BG = "#3A1C8F"
RES = os.path.join(TABLET, "android", "app", "src", "main", "res")
XCASSETS = os.path.join(TABLET, "ios", "App", "App", "Assets.xcassets")


def square_icon(size):
    """Opaque full-bleed square: the OS applies its own mask (iOS requires no alpha)."""
    S = size * 4
    img = logo.gradient(S).convert("RGB")
    m = int(S * 0.62)
    mark = logo.draw_mark(m // 4 + 1).resize((m, m), Image.LANCZOS)
    img.paste(mark, ((S - m) // 2, (S - m) // 2), mark)
    return img.resize((size, size), Image.LANCZOS)


def round_icon(size):
    S = size * 4
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, S - 1, S - 1], fill=255)
    base.paste(square_icon(S).convert("RGBA"), (0, 0), mask)
    return base.resize((size, size), Image.LANCZOS)


def adaptive_foreground(size):
    """108dp canvas; the mark stays inside the 66dp safe zone."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    m = int(size * 0.5)
    img.alpha_composite(logo.draw_mark(m), ((size - m) // 2, (size - m) // 2))
    return img


def splash(w, h):
    img = Image.new("RGB", (w, h), SPLASH_BG)
    m = int(min(w, h) * 0.22)
    mark = logo.draw_mark(m)
    img.paste(mark, ((w - m) // 2, (h - m) // 2), mark)
    return img


def overwrite(path, make):
    w, h = Image.open(path).size
    make(w, h).save(path, optimize=True)
    print("wrote", os.path.relpath(path, TABLET), f"{w}x{h}")


def main():
    for p in glob.glob(os.path.join(RES, "mipmap-*", "ic_launcher.png")):
        overwrite(p, lambda w, h: square_icon(w))
    for p in glob.glob(os.path.join(RES, "mipmap-*", "ic_launcher_round.png")):
        overwrite(p, lambda w, h: round_icon(w))
    for p in glob.glob(os.path.join(RES, "mipmap-*", "ic_launcher_foreground.png")):
        overwrite(p, lambda w, h: adaptive_foreground(w))
    for p in glob.glob(os.path.join(RES, "drawable*", "splash.png")):
        overwrite(p, splash)
    overwrite(os.path.join(XCASSETS, "AppIcon.appiconset", "AppIcon-512@2x.png"), lambda w, h: square_icon(w))
    for p in glob.glob(os.path.join(XCASSETS, "Splash.imageset", "*.png")):
        overwrite(p, splash)

    bg = os.path.join(RES, "values", "ic_launcher_background.xml")
    with open(bg, "w") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                f'    <color name="ic_launcher_background">{ADAPTIVE_BG}</color>\n</resources>\n')
    print("wrote", os.path.relpath(bg, TABLET))


if __name__ == "__main__":
    main()
