# Follow-up fix-all — 2026-08-15

Owner: fix everything left from SMS / fall-off / agents thread.

| # | Task | Owner | Status |
|---|---|---|---|
| W1 | AI-SET-04 handoff copy rewrite | this chat | done |
| W2 | S-04B booking confirm + 24h + 2h SMS | this chat | done |
| W3 | No-book fall-off SMS chase | this chat | done |
| W4 | Retire GHL-* agent rows | this chat | done |
| W5 | Twilio MediaUrl (MMS) support + text results SMS | this chat | done |
| W6 | E2E queue prove (no blast outbox) | this chat | pending — deploy then one booking prove |

## Laws
- GHL out. No inventing meme image files — wire MMS + text results; assets later.
- Do not dump outbound queue. Do not flip `outbound_enabled` without prove.
- COMPLIANCE REVIEW REQUIRED — client SMS.

## Cadences

**S-04B** (has booking): confirm now → 24h before → 2h before. Exit if cancelled/noshow/held as needed.

**No-book** (survey done, never booked): +2h → +24h → +72h. Exit on `booking.created`.

**Handoff** (T-15): intro to closer + meeting link. No dollar pre-approval / UnderwriteIQ-results-before-call claims.
