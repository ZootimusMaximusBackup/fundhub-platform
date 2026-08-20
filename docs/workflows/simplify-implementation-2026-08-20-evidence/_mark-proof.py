#!/usr/bin/env python3
"""Mark the local calendar click proof with exact red callouts."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "test-results/controls-persist-calendar--c5ac4-ndar-event-makes-it-Up-Next-chromium/test-failed-1.png"
OUT = Path(__file__).resolve().parent / "shots/calendar-event-click-MARKED.png"

image = Image.open(SRC).convert("RGBA")
draw = ImageDraw.Draw(image)
font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
bold = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 19)
red = (255, 35, 35, 255)
yellow = (255, 220, 0, 255)

marks = [
    ("1", "Clicked day event: Dana Whitfield", (306, 491, 930, 555)),
    ("2", "Up Next repainted with that event", (954, 226, 1268, 472)),
]
for number, _, (x1, y1, x2, y2) in marks:
    draw.rectangle((x1, y1, x2, y2), outline=red, width=5)
    draw.rounded_rectangle((x1, max(4, y1 - 30), x1 + 28, y1 - 4), radius=5, fill=red)
    draw.text((x1 + 9, y1 - 28), number, fill="white", font=bold)

legend = (231, 612, 912, 710)
draw.rounded_rectangle(legend, radius=10, fill=(0, 0, 0, 225))
draw.text((250, 622), "Calendar day click — local browser proof", fill="white", font=bold)
draw.text((250, 654), "1. Clicked day event: Dana Whitfield", fill=(255, 215, 215), font=font)
draw.text((250, 681), "2. Up Next repainted with that event", fill=(255, 215, 215), font=font)
draw.line((912, 662, 1000, 390), fill=yellow, width=4)
draw.line((231, 668, 620, 525), fill=yellow, width=4)

OUT.parent.mkdir(parents=True, exist_ok=True)
image.convert("RGB").save(OUT, quality=94)
print(OUT)
