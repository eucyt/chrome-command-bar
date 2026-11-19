"""Draws the extension icons. Run: python3 scripts/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
SCALE = 8  # supersample, then shrink for smooth edges


def draw(size: int) -> Image.Image:
    s = size * SCALE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=(28, 28, 30, 255))
    # A prompt chevron and a cursor bar: "type here".
    w = max(1, int(s * 0.11))
    left, mid, top, bottom = s * 0.24, s * 0.46, s * 0.30, s * 0.70
    d.line([(left, top), (mid, s * 0.5), (left, bottom)], fill=(138, 180, 248, 255), width=w, joint="curve")
    d.rounded_rectangle([s * 0.56, s * 0.60, s * 0.80, s * 0.60 + w], radius=w // 2, fill=(242, 242, 247, 255))
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        draw(size).save(OUT / f"icon{size}.png")
        print("wrote", OUT / f"icon{size}.png")
