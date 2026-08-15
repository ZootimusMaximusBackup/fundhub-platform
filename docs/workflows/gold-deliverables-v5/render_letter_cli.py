#!/usr/bin/env python3
"""CLI: JSON letter spec on stdin → PDF via fundhub_pdf_template.render_letter.

Used by vendor/.../letter-generator.js so shipped letters are carbon copies of
the uploaded gold templates, filled with Underwrite IQ data.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from fundhub_pdf_template import render_letter  # noqa: E402


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        print("render_letter_cli: empty stdin", file=sys.stderr)
        return 2
    spec = json.loads(raw)
    if not isinstance(spec, dict):
        print("render_letter_cli: spec must be a JSON object", file=sys.stderr)
        return 2
    spec.setdefault("footer", "")
    out = spec.get("file")
    if not out:
        print("render_letter_cli: spec.file (output path) required", file=sys.stderr)
        return 2
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    render_letter(spec)
    sys.stdout.write(str(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
