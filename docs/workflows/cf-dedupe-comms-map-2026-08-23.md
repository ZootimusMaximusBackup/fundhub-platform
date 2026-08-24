# CF dedupe + comms map 2026-08-23

| task | owner | status |
|---|---|---|
| fix-1-confirm-yes | fixer | done — CONFIRM accepted as YES in dpc-03 |
| fix-3-blank-where | fixer | done — omitted empty Where row (CF payload has no join URL) |
| fix-2-cancel-stops | fixer | done — cancelOn booking.cancelled |
| fix-4-josh-quiet | fixer | done — Josh uses SMS quiet hours |
| cf-webhook-dedupe | fixer | blocked (waiting for map) |
| slice-chase | mapper | done — `docs/workflows/comms-logic-2026-08-23-slice-chase.md` |
| slice-booking | mapper | done — `docs/workflows/comms-logic-2026-08-23-slice-booking.md` |
| slice-precall | mapper | done — `docs/workflows/comms-logic-2026-08-23-slice-precall.md` |
| slice-capture | mapper | done — `docs/workflows/comms-logic-2026-08-23-slice-capture.md` |
| comms-logic-map | mapper | done — `docs/workflows/comms-logic-2026-08-23.md` |
| preflight-1-6 | mapper | claimed |
| fix-noshow-emit | fixer | done — dpc-02 emits booking.noshow so S-05A can start without Cal.com |

## Change manifest — fix-1-confirm-yes

- Files: `src/workflows/dpc-03-inbound-reply-router.mjs`, `src/workflows/dpc-03-inbound-reply-router.test.mjs`
- `parseDecision` treats CONFIRM the same as YES (trim + case-insensitive already). STOP / RESCHEDULE / CLOSE unchanged.
- Journeys: none (this router is not in `docs/journeys`).

## Change manifest — fix-2-cancel-stops

- Files: `src/workflows/s-04b-booking-reminders.mjs`, `src/workflows/bs-01-precall-launcher.mjs`, `src/workflows/ai-set-04-3way-handoff.mjs`, `src/workflows/dpc-05-no-progress-escalation.mjs`, `src/workflows/ai-set-01-josh-setter.mjs`, `src/workflows/s-04b-booking-reminders.test.mjs`
- `booking.cancelled` now cancels in-flight runs for that booking id (and same email fallback). No new copy.
- Journeys: none (no route or screen change).

## Change manifest — fix-4-josh-quiet

- Files: `src/workflows/ai-set-01-josh-setter.mjs`, `src/workflows/ai-set-01-josh-setter.test.mjs`
- Josh dial uses the same 11pm–11am Eastern window as SMS (`inQuietHours` + `nextQuietHoursEnd`). One call after the wait.
- COMPLIANCE REVIEW REQUIRED — call timing.
- Journeys: none.

## Change manifest — fix-3-blank-where

- Files: `src/lib/render-template.mjs`, `src/lib/render-template.test.mjs`, `src/workflows/messaging.mjs`, `src/workflows/messaging.test.mjs`
- Live ClickFunnels appointment payloads have no join URL (adapter did not drop one). Confirm email now omits the empty Where row. A real URL still prints.
- Journeys: none.

## Change manifest — fix-noshow-emit

- Files: `src/workflows/dpc-02-call-outcome-enforcement.mjs`, `src/workflows/dpc-02-call-outcome-enforcement.test.mjs`, `src/adapters/calcom.mjs`
- When dpc-02 marks a no-show 5 minutes after the appointment ends, it emits `booking.noshow`. S-05A already listens to that event. Cal.com is not the live book page; the adapter was left in place with a top-line note.
- Journeys: none.
