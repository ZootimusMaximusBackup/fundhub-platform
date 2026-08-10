# journey-intended-stale-audit-2026-08-07

**Status: CLOSED — no open tasks.**

## Task list

| Unit | Owner | Status |
|------|-------|--------|
| Inventory all eight journeys (intended current vs stale) | A | done |
| Inquiry-removal intended vs actual side-by-side + gap class | A | done |
| Cross-check overnight sweep / CHANGELOG | B | done |
| Client money-path simulation (booking → deposit) | A | done |
| Close open questions (owner answered: simulate client actual) | A | done |

## Verdicts (final)

1. **All eight `*-intended.md` are stale** — after-the-fact copies from 2026-08-02; format and counts drifted from regenerated actual. Agents do not rewrite them.
2. **Inquiry-removal divergence is a doc problem**, not a proven behavior bug. Trust `role-inquiry-remover-actual.md`.
3. **Client money-path dry-run (2026-08-07, `fundhub_verify`):** booking PASS, $32 PASS, deposit PASS; held call NOT EXERCISED; route PARTIAL (harness shortcut, no `decision.rendered`).
4. Simulate against **actual** only. CRS sandbox continuation lived on `crs-softview-2026-08-07.md` / `crs-credentials-2026-08-07.md`.

## Change manifest

- This board only (report). No intended rewrites. No product code in this batch.
