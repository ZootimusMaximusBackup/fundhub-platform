# Manual walkthrough — every product path, by hand, on the live site (2026-09-03)

Owner-set: Chris types every field himself. Live fundhub.ai. His phone number on every
simulated client. Sandbox credit pulls (live CRS switched to sandbox for the run, then
back). Funding and repair fulfillment must be walked to the deliverable. Then one
white-label pass. The SOP with diagrams is `docs/workflows/manual-walkthrough-SOP.md`.

## Status

| # | Unit | Owner | Status |
|---|---|---|---|
| 1 | Ground: CRS sandbox toggle, SIM flags, funnel fields, disposition → offer → fulfillment, portal access, partner flow | Claude (this session) | done |
| 2 | Data sheet: seven simulated clients with ad URLs, form answers, and what to click | Claude | done — SOP §3 |
| 3 | SOP with diagrams, one page per path + the two push tools (`scripts/sim/`) | Claude | done |
| 4 | Walk: Soft pull → Funding DFY → fulfillment | Chris | pending |
| 5 | Walk: Repair DFY → fulfillment | Chris | pending |
| 6 | Walk: Repair trial | Chris | pending |
| 7 | Walk: Capital Blueprint (portal) | Chris | pending |
| 8 | Walk: Capital Academy (portal) | Chris | pending |
| 9 | Walk: White-label partner + one client under it | Chris | pending |
| 10 | Fix list from the walks, one PR per fix | Claude | pending |

## Decisions (owner, 2026-09-03)

- Live site, not a scratch copy.
- Chris enters data by hand through the ClickFunnels opt-in. Claude supplies the data.
- One phone number (Chris's) on every simulated client. Names that read as simulated.
- No bureau is called and no card is charged. Claude pushes a simulated credit file (`scripts/sim/push-credit.mjs`) and a signed fake payment receipt (`scripts/sim/push-payment.mjs`) per path. Live CRS is left untouched; the Pull buttons are off-limits during the walk.
- Funding and repair deliverables are the bar: "perfection". Findings get fixed step by step.

## Ground brief (unit 1, 2026-09-03)

- Front door is a 4-page CF funnel: /watch → /apply (9-question survey, branches at "Do you have a business?") → /funding-book-call → /thank-you. Same contact cannot run it twice.
- After opt-in: entry.captured + survey.submitted + booking.created → Sales board card at Booked, closer task "Strategy session booked", welcome email + SMS.
- CRS sandbox is env-only (two deploys) and returns three canned fake people — useless for judging deliverables. Chose: push a simulated file straight onto the client, run the real tier engine, emit the same two events a pull emits. Verified on a scratch db: funding → FULL_FUNDING $199,350; repair/trial → REPAIR_ONLY; card moves to decision_rendered.
- Commas/Fanbasis has no test mode. Chose: signed fake receipt to the real webhook carrying our payment_links link_ref, so purpose/product/client resolve from our own row. Tool refuses the $32 diagnostic link (would fire a real pull).
- `+fhtest` emails are hidden from dashboards; the sim clients use `+sim-NN`, which also skips quiet hours.
- Known before the walk: Capital Blueprint entitlement is unrouted (tile stays locked after purchase; migration needed); Blueprint has no contract template; repair has no enroll-on-payment (manual POST); partner approval endpoint exists, screen unverified; approval does not stamp agreement_signed_at.

## Findings from the walks

(one line per finding: path | screen | what happened | what should happen | fix PR)

## Findings — live walk, 2026-09-03

**F1 · Sim One-Funding · step 1.1 · no text message on booking.**
Booking a slot produced only a Google Calendar invitation email
("Invitation: Funding Strategy Meeting — Sim One-Funding", 7:00-7:30pm MST,
Google Meet link). No SMS and no call arrived on the real cell.
SOP step 1.1 says "Welcome email + text on your phone within a minute."
Observed: calendar invite only. Reported by Chris, 5:47pm.

**F2 · Sim One-Funding · the booking email carries NO portal sign-in link.**
Follows from F1's screenshot. The runbook (steps 4.3 / 5.3 / 1.14, corrected
in commit 1160b73d) tells the client to "sign in with the link from the
booking-confirmation email". That email is a plain Google Calendar invite with
a Meet link and nothing else. So there is currently NO path to the portal for a
client except asking for a link on the sign-in page. The corrected runbook line
is still wrong — it names an email that does not contain the link.

**F1 AMENDED · the text does arrive, but late.**
Chris got the Sim One booking text at 5:50pm, roughly 3 minutes after booking
(invite email landed 5:47pm). So it is not missing, it is slow. SOP says
"within a minute". Owner note: booking confirmations need to be more immediate.
Treat the delay as the finding, not the absence.

**F3 · Does the CRM record that a client CONFIRMED the invite? (owner note)**
Chris: "When they confirm, is there anywhere in the CRM that tracks they
confirm? If not, there should be." The calendar invite offers Yes / No / Maybe
(RSVP). Open question for Claude to trace: is that RSVP captured anywhere on
the client record or pipeline card, and does anything change when a client
accepts or declines? If nothing captures it, that is the finding, and the
owner has said it should exist.
