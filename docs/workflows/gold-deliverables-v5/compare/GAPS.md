# Gold vs live — text gaps (W7)

**When:** 2026-08-14  
**How:** `src/company-brain/pdf-text.mjs` `extractPdfText` (pdfjs). No new deps. No email. No Claude spend.  
**Live letter:** Jordan Sample fixture via `generateDisputeLetters` / `generateLetters` → `live-letter-experian-bureau.txt` (+ sibling `live-letter-*.txt`).  
**Live report:** fixture markdown through `renderDocumentPDF` (`gold-report-shell.test.mjs` sample) → `live-report-credit-analysis.txt`. Full Claude-authored report body **not** rendered (would spend ANTHROPIC).

Gate bar from board: empty letter body → fail; `[ QR CODE ]` → fail; QR must be `https://apply.fundhub.ai`.

---

## Scorecard

| Check | Gold | Live |
|-------|------|------|
| Letter bodies present | Bureau OK; **6 inquiry/personal header-only** | Bureau + inquiry + personal OK |
| Fundhub on letters | **None** (all 9 gold dispute PDFs) | **None** (all live letter extracts) |
| `[ QR CODE ]` placeholder | **Present** on 4 gold reports | **Absent** on live report |
| `apply.fundhub.ai` on report close | **Missing** (booking template instead) | **Present** |

---

## 1. Missing bodies (gold inquiry + personal)

These six gold PDFs extract to **header only** (~137–157 chars): sender, date, bureau address, `Re:` line — then stop.

| File | Chars | Body? |
|------|------:|-------|
| `gold-dispute_*_inquiry_removal.txt` (3) | 137–141 | No |
| `gold-dispute_*_personal_info.txt` (3) | 153–157 | No |

Raw PDF probe: no ASCII `FCRA` / `To Whom` / `Sincerely` in those files; empty ToUnicode `bfchar` maps. Files are ~9–10 KB vs ~23–28 KB for bureau letters that have bodies.

**Live:** same Jordan Sample fixture produces full inquiry (~1000+ chars, FCRA 604) and personal-info (~1100+ chars, FCRA 611) bodies with ENCLOSURES. No Fundhub.

**Bureau gold** (`dispute_*_bureau.pdf`): full bodies (2963–4610 chars). Live Experian bureau (`live-letter-experian-bureau.txt`, 4013 chars) matches SIGNET / Field 21 / 24 / 20 / REQUESTED ACTIONS / 1681i. No Fundhub either side.

---

## 2. Fundhub on letters — pass

- All `gold-dispute_*.txt`: no `fundhub` / `FundHub`.
- All `live-letter-*.txt`: no `fundhub` / `FundHub`.
- Reports **may** say fundhub (gold and live do). That is allowed.

---

## 3. `[ QR CODE ]` + apply URL (reports)

### Gold reports (extract)

| File | `[ QR CODE ]` (spaced letters) | `apply.fundhub.ai` | Close CTA text |
|------|:------------------------------:|:------------------:|----------------|
| `gold-credit_analysis_report.txt` | Yes | No | `www.fundhubbookingurl.template` |
| `gold-optimization_roadmap.txt` | Yes | No | same template |
| `gold-funding_snapshot.txt` | Yes | No | same template |
| `gold-lender_match_list.txt` | Yes | No | same template |
| `gold-summary_funding_snapshot.txt` | No | No | 1-page summary; no close CTA page |

Gold close page literally shows spaced placeholder: `[   Q R   C O D E   ]` plus booking URL template — fails the board bar if gold were shipped as-is.

### Live report (fixture, no Claude)

`live-report-credit-analysis.txt` (5 pages, fixture markdown):

- **No** `[ QR CODE ]` placeholder.
- **Has** `apply.fundhub.ai` and `SCAN TO OPEN APPLY.FUNDHUB.AI` on close page.
- Has `fundhub.` branding (allowed on reports).

Caveat: this is shell + fixture body only, not a full Claude-written 12-page analysis. Close-page QR/URL gate is what we could prove without spending API.

---

## Files written

Under `docs/workflows/gold-deliverables-v5/compare/`:

- `gold-*.txt` — one per gold PDF listed in the W7 job (14 files)
- `live-letter-experian-bureau.txt` — primary live letter (Experian Round 1 / SIGNET)
- `live-letter-*.txt` — other Jordan Sample letter extracts
- `live-report-credit-analysis.txt` — fixture report (no Claude)
- `GAPS.md` — this file
- `_extract-meta.json` — machine summary of lengths / flags

---

## Biggest gaps (top 3)

1. **Gold inquiry + personal-info letters are header-only** — six gold PDFs fail the empty-body bar in text extract (and look empty in the file bytes). Live generator already emits full bodies.
2. **Gold reports still ship `[ QR CODE ]` + `www.fundhubbookingurl.template`** — no `apply.fundhub.ai`. Live fixture report already closes with apply.fundhub.ai and no placeholder (W3/W4 path).
3. **Live full report body not compared** — Claude report generation skipped to avoid ANTHROPIC spend; only shell/fixture close page proven. Gold analysis is 12 pages / ~20k chars vs live fixture 5 pages / ~4k chars (content depth, not the QR gate).
