"""Draws the extension icons. Run: python3 scripts/make_icons.py"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
SCALE = 8  # supersample, then shrink for smooth edges
UNIT = 128  # the shape below is laid out on a 128x128 grid
TOP_LEFT, BOTTOM_RIGHT = (63, 208, 192), (27, 134, 184)
STROKE = 13


def shell_path() -> list[tuple[float, float]]:
    """A spiral shell whose tail runs on as the handle of a magnifier: "search" and "yadokari" in one stroke."""
    cx = cy = 56
    r0, r1, turns, start = 6, 31, 1.5, math.pi * 1.25
    growth = math.log(r1 / r0) / (turns * 2 * math.pi)
    steps = 400
    pts = []
    for i in range(steps + 1):
        t = turns * 2 * math.pi * i / steps
        r = r0 * math.exp(growth * t)
        pts.append((cx + r * math.cos(start + t), cy + r * math.sin(start + t)))
    x0, y0 = pts[-1]
    pts += [(x0 + (100 - x0) * i / 100, y0 + (100 - y0) * i / 100) for i in range(1, 101)]
    return pts


def draw(size: int) -> Image.Image:
    s = size * SCALE
    k = s / UNIT

    ramp = Image.linear_gradient("L").resize((s, s))  # top to bottom
    diagonal = Image.blend(ramp, ramp.rotate(90), 0.5)  # top-left to bottom-right
    bg = Image.merge("RGB", [diagonal.point(lambda v, a=a, b=b: a + (b - a) * v / 255) for a, b in zip(TOP_LEFT, BOTTOM_RIGHT)])

    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)

    # Stamping discs along the path gives round caps and joins at any width.
    stroke = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(stroke)
    r = STROKE / 2 * k
    for x, y in shell_path():
        d.ellipse([x * k - r, y * k - r, x * k + r, y * k + r], fill=255)

    img = Image.composite(Image.new("RGB", (s, s), "white"), bg, stroke).convert("RGBA")
    img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        draw(size).save(OUT / f"icon{size}.png")
        print("wrote", OUT / f"icon{size}.png")
