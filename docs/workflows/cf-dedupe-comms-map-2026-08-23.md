# CF dedupe + comms map 2026-08-23

| task | owner | status |
|---|---|---|
| fix-1-confirm-yes | fixer | done — CONFIRM accepted as YES in dpc-03 |
| cf-webhook-dedupe | fixer | blocked (waiting for map) |
| slice-chase | mapper | claimed |
| slice-booking | mapper | done — `docs/workflows/comms-logic-2026-08-23-slice-booking.md` |
| slice-precall | mapper | done — `docs/workflows/comms-logic-2026-08-23-slice-precall.md` |
| slice-capture | mapper | done — `docs/workflows/comms-logic-2026-08-23-slice-capture.md` |

| comms-logic-map | mapper | claimed |
| preflight-1-6 | mapper | claimed |

## Change manifest — fix-1-confirm-yes

- Files: `src/workflows/dpc-03-inbound-reply-router.mjs`, `src/workflows/dpc-03-inbound-reply-router.test.mjs`
- `parseDecision` treats CONFIRM the same as YES (trim + case-insensitive already). STOP / RESCHEDULE / CLOSE unchanged.
- Journeys: none (this router is not in `docs/journeys`).
