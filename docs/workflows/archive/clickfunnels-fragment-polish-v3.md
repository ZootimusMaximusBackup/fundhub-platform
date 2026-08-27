# ClickFunnels fragment polish V3 — shared board

**Status:** done — V3.1 stripped interior widget CSS from 02a/04a (match live)  
**Pack:** `clickfunnels-fragments/`  
**Baseline:** V2 live on apply.fundhub.ai

## Task list

| Unit | Owner | Status |
|------|-------|--------|
| Live DOM — booking form + Confirm | this session | done |
| Part A — 04a scheduler form polish | this session | done |
| Part A — 02a input treatment | this session | done |
| Part B — booking capture + storage handoff | this session | done |
| Part B — merge add-to-calendar into live 05 | this session | done |
| fixes-v3.md + screenshots + zip | this session | done |

## Live selectors (booking form)

- `#formContainer` / `#formContainer > .flex-grow` (dead rail)
- `label.ml-0`, `input.appointment_schedule_request_field`, `.iti__*`
- Confirm: `button.cf2__confirm-button.DTP__confirm-button` — live fill `#188bf6`
- Handoff fields: `#appointment_schedule_request_start_on|end_on|tzid`
- Storage key: `fh_booking_v1`

## Change manifests

- `04a-book-top.html` — form Inter/inputs/center + Confirm token + capture script
- `05-thank-you.html` — scraped live + `.cal-cta` after prep / before FAQ
- `02a-apply-top.html` — survey input chrome
- Deliverable zip: `fundhub-funnel-dropins-v3.zip` (+ Downloads copy)

## Chris next

Paste `04a`, `05`, `02a`. Eyeball Confirm on slot step + form fields + thank-you with a real booking.
