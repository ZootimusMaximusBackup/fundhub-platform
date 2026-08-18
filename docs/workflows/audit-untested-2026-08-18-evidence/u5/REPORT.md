# U5 findings — bureau pull that comes back

**COMPLIANCE REVIEW REQUIRED** — credit-pull type, consent.

Walked 2026-08-18 on `https://fundhub.ai`. Owner `chris@fundhub.ai`. Clicks only on test client `8556bedc-…` (`client@fundhub.ai`). Never opened the live credit file. Did not mail a bureau letter. Did not put the bureau vendor in sandbox. TransUnion: one click, then stop.

Ground truth for a bureau pull step is **MISSING**. Intended journeys do not name “staff clicks Soft pull / Experian / Equifax / TransUnion and a score comes back.” Scored against Chris’s claim on the board.

Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u5/`. Logs: `walk.json` `db.json` `db-after.json`.

No PASS without a shot, HTTP status, or database row.

## Score

| Ask | Result |
|---|---|
| Soft-pull consent row on this file | **No** — `soft_pull_consent` count **0** |
| Soft pull / Experian / Equifax / TransUnion returns a score | **BROKEN** — each bureau click → **403** |
| `soft_pull_requests` row / scores leave dashes | **No** — pulls **0**, CRS **0**, scores still dashes |

Chris’s claim (a bureau pull runs on the TEST file and a score / inquiries / tradelines come back): **BROKEN**. Every button refuses. Nothing comes back.

## BROKEN

### Bureau buttons refuse — no consent the pull reads

- Journey: **MISSING.**
- Expected (board): click Soft pull, then Experian, Equifax, TransUnion on the TEST file. Record refuse vs return. No letter mail.
- Observed:
  - File opened: **TEST Client Role** / `client@fundhub.ai`. Scores: `EX — · EQ — · TU —`.
  - There is no “Soft Pull” button. The three bureau buttons are the pull.
  - Pull Experian once → `POST /api/finance/crs-pull` **403**. Screen: “no soft-pull consent on file for this client — capture consent before requesting a pull.”
  - Pull Equifax once → same **403**, same words.
  - Pull TransUnion once → same **403**, same words. Did not click TransUnion again.
  - Scores still dashes after all three.
  - `client_consents` kind `soft_pull_consent`: **0**. There is one other consent kind (`dispute_authorization`). That is not the kind the pull reads.
  - A **SOFT-PULL-CONSENT** contract is signed. The pull does not treat that as the consent row.
  - `soft_pull_requests` **0**. `crs_results` **0**. No letter was mailed.
- Evidence: `01-ccp-before-pull.png` `03-pull-experian.png` `04-pull-equifax.png` `05-pull-transunion.png` `06-ccp-after-pulls.png` `walk.json` `db-after.json`

## Left undone

- Nothing in this unit. Did not force a pull around the gate.

## Next

U6 — Inquiry Send on a TEST Queued case only.
