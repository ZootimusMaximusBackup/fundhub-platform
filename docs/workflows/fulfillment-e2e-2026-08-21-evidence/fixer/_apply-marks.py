#!/usr/bin/env python3
"""Burn numbered red boxes + yellow arrows + legend onto overnight-audit shots."""
from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
SHOTS = HERE / "shots"
RAW = SHOTS / "_raw"
MANIFEST = HERE / "shot-marks.json"
RED = (255, 40, 40, 255)
YELLOW = (255, 220, 0, 255)
WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 220)


def load_font(size: int):
    for name in (
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ):
        p = Path(name)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except OSError:
                continue
    return ImageFont.load_default()


def draw_arrow(draw, x1, y1, x2, y2):
    draw.line([(x1, y1), (x2, y2)], fill=YELLOW, width=4)
    angle = math.atan2(y2 - y1, x2 - x1)
    size = 14
    a1 = angle + math.pi * 0.85
    a2 = angle - math.pi * 0.85
    draw.polygon(
        [
            (x2, y2),
            (x2 + size * math.cos(a1), y2 + size * math.sin(a1)),
            (x2 + size * math.cos(a2), y2 + size * math.sin(a2)),
        ],
        fill=YELLOW,
    )


def mark_image(src: Path, spec: dict) -> None:
    im = Image.open(src).convert("RGBA")
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = load_font(15)
    font_b = load_font(18)
    font_num = load_font(17)
    marks = [m for m in spec.get("marks", []) if m.get("box")]
    targets = []
    for m in marks:
        box = m["box"]
        x, y, w, h = box["x"], box["y"], box["w"], box["h"]
        x = max(0, min(x, im.width - 1))
        y = max(0, min(y, im.height - 1))
        w = max(8, min(w, im.width - x))
        h = max(8, min(h, im.height - y))
        draw.rectangle([x - 3, y - 3, x + w + 3, y + h + 3], outline=RED, width=5)
        label = str(m.get("n") or m.get("label") or "1")
        bx = max(4, x - 6)
        by = max(4, y - 34)
        draw.rounded_rectangle([bx, by, bx + 30, by + 26], radius=6, fill=RED)
        draw.text((bx + 10, by + 4), label, fill=WHITE, font=font_num)
        targets.append((x + w / 2, y + h / 2, m, label))
    if marks:
        lh = 40 + len(marks) * 24
        lx = max(8, im.width - 460)
        ly = max(8, im.height - lh - 12)
        draw.rounded_rectangle([lx, ly, lx + 448, ly + lh], radius=10, fill=BLACK)
        draw.text((lx + 14, ly + 8), spec.get("legend") or spec.get("title") or "Step", fill=WHITE, font=font_b)
        ty = ly + 34
        for m, _cx_cy in zip(marks, targets):
            label = str(m.get("n") or m.get("label") or "1")
            draw.text((lx + 14, ty), f"{label}. {m.get('caption', '')}", fill=(255, 210, 210, 255), font=font)
            ty += 24
        for cx, cy, m, label in targets:
            draw_arrow(draw, lx + 8, ly + lh / 2, cx, cy)
    marked = Image.alpha_composite(im, overlay).convert("RGB")
    out = SHOTS / src.name.replace(".png", "-MARKED.png")
    if src.parent == RAW:
        dest = SHOTS / src.name
        marked.save(dest, quality=94)
        marked.save(out, quality=94)
    else:
        marked.save(src.with_name(src.stem + "-MARKED.png"), quality=94)
        marked.save(src, quality=94)


def main() -> None:
    if not MANIFEST.exists():
        raise SystemExit(0)
    SHOTS.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text())
    ok = 0
    for file, spec in manifest.items():
        raw = RAW / file
        if not raw.exists():
            alt = SHOTS / file
            if alt.exists():
                shutil.copy2(alt, raw)
            else:
                print("missing", file)
                continue
        if not spec.get("marks"):
            shutil.copy2(raw, SHOTS / file)
            continue
        mark_image(raw, spec)
        ok += 1
        print("marked", file)
    print(f"done {ok}")


if __name__ == "__main__":
    main()
