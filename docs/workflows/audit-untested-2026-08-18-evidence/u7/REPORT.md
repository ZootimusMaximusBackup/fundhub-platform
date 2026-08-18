# WAVE C rollup + U7 findings

**COMPLIANCE REVIEW REQUIRED** — inquiry complete. Also payment rails (U4), credit-pull / consent (U5), inquiry (U6).

## WAVE C rollup

| Unit | Claim | Score |
|---|---|---|
| U4 | Closer can make a live pay link (rail, no charge) | **BROKEN** — create → 503 `commas_not_configured` |
| U5 | Bureau pull comes back with a score | **BROKEN** — all three buttons → 403, no consent row |
| U6 | Inquiry Send leaves the building | **BROKEN** — Send → `VIEW IS NOT DEFINED`, no outbound |
| U7 | Inquiry complete starts the next funding round | **UNVERIFIED** — `inquiry.removed` never fired |

TEST client `8556bedc-…` only. Live credit file never opened. No card charge. No letter mail. No fake `inquiry.removed`. `INNGEST_EVENT_KEY` not turned on.

---

# U7 — inquiry complete → next funding round

Walked 2026-08-18. Specialist `inquiry@fundhub.ai`. TEST cases only. Did not press Mark Cleared. Did not write `inquiry.removed`. Did not turn on `INNGEST_EVENT_KEY`.

Ground truth for “inquiry work done → next funding round starts by itself” is **MISSING**. Intended journeys do not name that hop.

Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u7/`. Logs: `db.json` `walk.json`.

No PASS without a shot, HTTP status, or database row.

## Score

| Ask | Result |
|---|---|
| Live count of `inquiry.removed` | **0** (all files). **0** on TEST. |
| Can a TEST case reach a real complete without a fake event? | **No** — Send is dead (U6). All 3 cases still `Queued`. Call never fired. Letter never delivered. |
| What would listen? | Inngest `c-03-inquiry-removed-resume-or-hold` on `inquiry.removed`. It would tag `inquiry:completed` and make a “Start next funding round” task. No bus/`register-all` handler. |
| Has that listener ever run? | **No.** `c-03` tasks **0**. Failed-event rows for this name **0**. TEST `ready_for_next_round` empty. Funding rounds on TEST **0**. |

Chris’s claim (when inquiry work is done, the next funding round starts by itself): **UNVERIFIED** — event never fired. There is nothing for the listener to run on.

## UNVERIFIED — event never fired

- Journey: **MISSING.**
- Expected (board): prove a real complete, or say the event never fired. Do not fake it. Do not press Mark Cleared if that fakes a complete.
- Observed:
  - `inquiry.removed` count: **0**.
  - Whole `inquiry_removal_cases` table: **3** rows, all TEST, all `Queued`. Completed: **0**.
  - Mark Cleared is on the TEST case. Recorded. Left it. Pressing it would write `inquiry.removed` with no bureau work.
  - Listener on file: `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs`. Trigger: `inquiry.removed`. Listed in `src/workflows/index.mjs`.
  - No `c-03` task for anyone. No next-round task. No funding round on TEST.
- Evidence: `01-mark-cleared-left.png` `db.json` `walk.json`. Also U6 `03-send-once.png` (same button).

## Left undone

- Nothing in this unit. Did not fake the event. Did not press Mark Cleared.

## Next

Wave C is done. Chris names what to fix.
