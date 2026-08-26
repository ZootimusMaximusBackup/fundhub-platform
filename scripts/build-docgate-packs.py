#!/usr/bin/env python3
"""Build Chris Stanbridge doc-gate packs (good / blurry / cutoff). Raw stays in sim-source/."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "credentials" / "sim-source"
OUT = ROOT / "credentials" / "sim-pack"


def blur_image(src: Path, dest: Path, radius: int = 28) -> None:
    img = Image.open(src).convert("RGB")
    img = img.filter(ImageFilter.GaussianBlur(radius=radius))
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, format="PNG", optimize=True)


def cutoff_image(src: Path, dest: Path) -> None:
    """Sharp but cropped — right/bottom missing (not blurry)."""
    img = Image.open(src).convert("RGB")
    w, h = img.size
    # Keep top-left ~55% — cuts name/address/account areas on typical statements/IDs.
    crop = img.crop((0, 0, int(w * 0.55), int(h * 0.55)))
    dest.parent.mkdir(parents=True, exist_ok=True)
    crop.save(dest, format="PNG", optimize=True)


def pdf_first_page_png(src: Path, dest: Path) -> bool:
    """Best-effort: copy PDF alongside; PNG render needs poppler. Prefer copy."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() == ".pdf":
        shutil.copy2(src, dest.with_suffix(".pdf"))
        return True
    shutil.copy2(src, dest)
    return True


def main() -> int:
    good = SOURCE / "good"
    if not good.is_dir():
        print(f"missing {good}", file=sys.stderr)
        return 1

    # Good pack — sharp copies for upload
    for name in ("id_document.png", "ssn_card.png"):
        src = good / name
        if src.exists():
            dest = OUT / "good" / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            print(f"wrote {dest}")
    bank = good / "bank_statement.pdf"
    if bank.exists():
        shutil.copy2(bank, OUT / "good" / "bank_statement.pdf")
        print(f"wrote {OUT / 'good' / 'bank_statement.pdf'}")

    # Wrong-id: princess ID + good SSN + good bank
    wid = SOURCE / "wrong-id" / "id_document.png"
    if wid.exists():
        shutil.copy2(wid, OUT / "wrong-id" / "id_document.png")
        shutil.copy2(good / "ssn_card.png", OUT / "wrong-id" / "ssn_card.png")
        shutil.copy2(bank, OUT / "wrong-id" / "bank_statement.pdf")
        print("wrote wrong-id pack")

    # Outdated bank + good ID/SSN
    old = SOURCE / "outdated" / "bank_statement.pdf"
    if old.exists():
        shutil.copy2(good / "id_document.png", OUT / "outdated" / "id_document.png")
        shutil.copy2(good / "ssn_card.png", OUT / "outdated" / "ssn_card.png")
        shutil.copy2(old, OUT / "outdated" / "bank_statement.pdf")
        print("wrote outdated pack")

    # Blurry — blur ID + bank preview from ID as stand-in if PDF can't rasterize
    blur_image(good / "id_document.png", OUT / "blurry" / "id_document.png")
    blur_image(good / "ssn_card.png", OUT / "blurry" / "ssn_card.png")
    # Rasterize bank: use a heavy-blur of ID as "unreadable bank photo" stand-in
    # plus keep pdf for staff; primary upload for quality fail is blurry ID photo of statement.
    # Convert first page via pdftoppm if available.
    import subprocess
    tmp = OUT / "blurry" / "_bank_page.png"
    try:
        subprocess.run(
            ["pdftoppm", "-png", "-f", "1", "-singlefile", str(bank), str(tmp.with_suffix(""))],
            check=True,
            capture_output=True,
        )
        blur_image(tmp, OUT / "blurry" / "bank_statement.png", radius=40)
        tmp.unlink(missing_ok=True)
    except Exception as e:
        print(f"pdftoppm blur bank skipped: {e}", file=sys.stderr)
        blur_image(good / "id_document.png", OUT / "blurry" / "bank_statement.png", radius=40)
    print("wrote blurry pack")

    # Cutoff — sharp crop of bank page / ID
    try:
        subprocess.run(
            ["pdftoppm", "-png", "-f", "1", "-singlefile", str(bank), str(OUT / "cutoff" / "_bank")],
            check=True,
            capture_output=True,
        )
        cutoff_image(OUT / "cutoff" / "_bank.png", OUT / "cutoff" / "bank_statement.png")
        (OUT / "cutoff" / "_bank.png").unlink(missing_ok=True)
    except Exception:
        cutoff_image(good / "id_document.png", OUT / "cutoff" / "bank_statement.png")
    cutoff_image(good / "id_document.png", OUT / "cutoff" / "id_document.png")
    shutil.copy2(good / "ssn_card.png", OUT / "cutoff" / "ssn_card.png")
    print("wrote cutoff pack")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
