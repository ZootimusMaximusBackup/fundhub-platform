# W-INB

Inbound bureau mail, bank email, uploaded docs, and “inquiry gone.” Findings only. Intended journeys do not name this path. That is missing ground truth, not a license to invent one.

## Bureau letter back (metro2 inbound)

There is no event named `bureau-response`. The code is a function: `handleInboundResponse`. You hand it org, client, case, scanned text, and the items on the letter. Tests build that object inline. There is no fixture file.

If the scan is fuzzy, it holds and names `repair.parse.low_confidence`. If the scan is clear, it names `repair.response.parsed`. Those names are return values. The function does **not** put them on the event bus.

A clear scan on this client tried to write `repair_decision_log`. The database said no (row-level security). Zero rows. No dispute case exists for this file. **UNVERIFIED** as a stored bureau reply.

W6 still stands: Bland and PostGrid doors exist. They have never stored a capture.

## Bank email (`mail.response`)

Safe to fire without Mailgun. One local emit, classification APPROVED. Wrote `bank_inbox` `304146d6-…`. No mail vendor.

The live bus only runs `onMailResponse` (inbox row). F-06 / F-09 / F-11 are job-service functions. The job key was not used. Inngest did not run.

Local `handle()` like the unit tests:

- F-06 on APPROVED: skipped (`not_missing_docs`).
- F-09 on APPROVED: skipped (`not_denied`).
- F-11 on APPROVED: **ran**. Made task `170414e0-…`. Made a funding card `aaa14525-…` at approved. That also wrote `round.approved` `dc16b5e0-…`.
- F-06 missing-docs path: **not run**. Next hop would queue email/text (`sendTemplated`). The sender that actually mails is still off.

## Docs in (`docs.received`)

W-DESKS upload already wrote `docs.received` `b9ee35c4-…` when the FTC file landed. We emitted one more local copy `03d3666c-…` for the same document. The inquiry case stayed **Queued**. Flip only happens if a case is **Blocked** and the identity packet is complete. This case was never Blocked. Packet is still missing id / address / auth. No mail.

F-06 on `docs.received` ran locally. It did not clear the hold. Hold is still “Awaiting CRS,” not “Missing Documents.”

## Inquiry gone (C-03)

C-03 listens for `inquiry.removed` on the job service only. The live bus has **no** handler. This file has **no** real path there: case is Queued, not sent, not Completed. Inbound confirm does not fire it. Would fire only if someone marks the case cleared, closes it as Completed, or a live inquiry-removal webhook says cleared. We did not press those. We did not call a bureau.

Local `handle()` with a fake `inquiry.removed`: **ran** (resume). Tag `inquiry:completed`. Field `ready_for_next_round=true`. Task `d10ea1d6-…` “Start next funding round — clean file.” Inngest did **not** run.

Before this unit, live `mail.response` and `inquiry.removed` counts (other than the forbidden file) were **0**. Compare file `8556…` has **0** of these events.

## W-TEAR extras from this unit

- `bank_inbox` `304146d6-7ad3-405b-847d-c60dead69429`
- tasks `170414e0-…` (F-11) and `d10ea1d6-…` (C-03)
- card `aaa14525-844c-43b1-9865-4c04191ddedd` (funding_card_stacking / approved)
- events: `mail.response` `9e56ad39-…`, `docs.received` `03d3666c-…`, `inquiry.removed` `e4eb4b3c-…`, `round.approved` `dc16b5e0-…`
- tags / fields: `inquiry:completed`, `ready_for_next_round`, `employee_next_action`
