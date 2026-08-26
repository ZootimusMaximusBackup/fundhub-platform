#!/usr/bin/env python3
"""Blur sensitive sim docs for e2e movie tests. Raw files stay in credentials/sim-source/."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "credentials" / "sim-source"
OUT = ROOT / "credentials" / "sim-pack"

# Map source basename (without ext) -> output filename for upload subtypes.
OUTPUTS = {
    "id_document": "id_document.png",
    "ssn_card": "ssn_card.png",
    "proof_of_address": "proof_of_address.png",
    "bank_statement": "bank_statement.png",
    "ftc_report": "ftc_report.png",
}


def blur_image(src: Path, dest: Path) -> None:
    img = Image.open(src).convert("RGB")
    w, h = img.size
    # Heavy blur on lower 55% (typical PII zone on ID/lease/SSN photos).
    region = img.crop((0, int(h * 0.35), w, h))
    region = region.filter(ImageFilter.GaussianBlur(radius=18))
    img.paste(region, (0, int(h * 0.35)))
    img = img.filter(ImageFilter.GaussianBlur(radius=2))
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, format="PNG", optimize=True)


def main() -> int:
    if not SOURCE.is_dir():
        print(f"missing source dir: {SOURCE}", file=sys.stderr)
        return 1
    made = 0
    for stem, out_name in OUTPUTS.items():
        matches = sorted(SOURCE.glob(f"{stem}.*"))
        if not matches:
            continue
        blur_image(matches[0], OUT / out_name)
        made += 1
        print(f"wrote {OUT / out_name}")
    if not made:
        print(f"no files in {SOURCE}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
