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

**F1 AMENDED AGAIN · the AI call fires too, also delayed.**
Chris also received the AI phone call at the same time as the text (~5:50pm,
roughly 3 minutes after booking). So the full booking sequence works:
calendar invite email + SMS + AI call all fire. None of them is missing.

Verdict on F1: **WORKED, BUT DELAYED.** Not a broken automation.
Owner-set target: all three must land **within 60 seconds** of the booking.
Today they take about 3 minutes. The fix is latency, not wiring.

**F4 · Test-data naming: use a distinct FIRST name per sim client (owner note).**
Messages greet the client by FIRST name only, so every one of the five sims
gets "Hey Sim" and they are impossible to tell apart in the inbox and on the
phone. The path lives in the LAST name, where no message ever looks.

Next run, put the distinguishing word in the FIRST name:
first "Sim 3" / last "Trial" (and so on), not first "Sim" / last "Three-Trial".
Update the data sheet in docs/workflows/manual-walkthrough-SOP.md section 3
and the runbook HTML before the next walk.

Not changing mid-run — the five clients for 2026-09-03 keep the current names.

**F5 · AI SETTER IS BROKEN. Does not work at all. (owner, severity: highest)**
Chris on the live walk: the AI setter "doesn't work AT ALL". Total failure,
not a degraded or delayed behaviour like F1. He believes a Claude change
broke it ("something was fucked by Claude").

This is the top finding of the walk so far. Open, unassigned, un-diagnosed.

To do after the walk (do NOT fix mid-run, SOP rule: write findings, don't fix):
- Get the exact symptom from Chris: does the call not place, does it place and
  the agent says nothing, does it hang up, or does it not follow its prompt?
- Find when it last worked and diff the setter's prompt/config/workflow
  registration against that point. Chris suspects a regression, so bisect
  rather than redesign.
- The `fundhub-agent-tester` skill exists for exactly this: run the live agent
  prompt against a roleplay client and score prompt fulfilment.
- Note this is the SETTER (books the call), distinct from the booking-
  confirmation AI call in F1, which did fire.

**F5 ADDENDUM · two named causes (owner-set).**
Chris: "We need a more powerful model of Josh AI. And the prompt is fucked."

So F5 splits into two pieces of work, both owner-decided, not open questions:
1. **Model upgrade** — the Josh AI setter agent runs on too weak a model.
   Raise the tier. Owner call, already made.
2. **Prompt rewrite** — the setter's prompt is bad and needs rewriting, not
   patching.

Both are post-walk. Do not touch mid-run.

**Step 1.2 / all paths · PASS.** All five sims present in **Booked** on the
pipeline board, correct self-reported score bands on each card
(One-Funding 700-749, Two-Repair 580-649, Three-Trial 580-649,
Four-Blueprint 650-699, Five-Academy 750+), phone and email on each.
Booked column count reads 6 — one pre-existing non-sim lead also sits there.

**F3 UPDATE · a "Confirmed" stage DOES exist on the pipeline board.**
The board shows Booked → **Confirmed** as adjacent columns, so the CRM has a
place to record a confirmation. Still to verify: does anything move a card
into Confirmed automatically when the client RSVPs Yes on the calendar invite,
or is Confirmed only ever set by hand? All five sims sat in Booked after
booking, so nothing auto-moved them — but none of them had RSVP'd yet either.
Not yet proven either way.

**Step 1.3 · attribution PASS.** Client Control Panel "How they got here" on
Sim One-Funding shows Source fb · Campaign funding600 · Ad 42-ringlights ·
Landed on /watch · Magnet VSL. The five UTMs survive the funnel and land on
the client record. Plumbing works.

**F6 · Ad UTM naming may be stale vs the ad matrix (owner note, UNCONFIRMED).**
Chris added "unless I am wrong" — treat as unverified until the matrix is read.
Chris on seeing "42-ringlights": that is not how the matrix is built for ad
UTMs now. The value carries through correctly, so this is a test-data and
convention problem, not a tracking bug.

To do after the walk: get the CURRENT ad-matrix UTM convention from Chris,
then update the five ad links in docs/workflows/manual-walkthrough-SOP.md
section 3 and manual-walkthrough-runbook.html so the next walk exercises real
naming. Until then, reporting grouped by ad name will not match live ads.

**F6 RETRACTED · the ad UTM naming is CORRECT. Chris's hunch was wrong.**
Checked docs/ads/registry.json and src/ads/registry.mjs. The ad id is the
leading digits of utm_content; the text after the dash is the ad's title.
All five walk ads are real, current registry entries:

| utm_content | id | title | lane | gate | entry | primary offer |
|---|---|---|---|---|---|---|
| 42-ringlights | 42 | ringlights | funding600 | 600 | direct | funding_dfy |
| 43 | 43 | (none) | sorting | none | sorting | funding_dfy |
| 45 | 45 | (none) | sorting | none | sorting | funding_dfy |
| 26-underwriter | 26 | underwriter | uwiq | none | sorting | capital_blueprint |
| 82 | 82 | (none) | premium | 720 | direct | funding_dfy |

No SOP change needed. Attribution is healthy and the links exercise real ads.

**F7 · Three registry ads have no title (minor data gap).**
Ads 43, 45 and 82 have `"title": null` while 42 and 26 are named. So their
utm_content is a bare number and any report grouped by ad name shows a digit
with no label. Cheap fix: add titles in docs/ads/registry.json.

**F8 · Survey answers are landing in the WRONG FIELDS on the Client Control
Panel.** Observed on Sim Five-Academy. What Chris typed vs what the panel shows:

| Survey screen | He answered | Panel shows |
|---|---|---|
| 7 Revenue | $1M+ | **missing entirely** |
| 8 Can you verify | Yes, both | shown as **"Business revenue: Yes, both"** |
| Can verify revenue | (from screen 8) | — |
| Personal income | n/a | — |
| Can verify income | n/a | — |

So the screen-8 verify answer is being written into the revenue field, and the
real revenue figure ($1M+) is dropped. Four fields read "—" that should carry
data. This is a field-mapping bug, not an empty client.

**F9 · The Client Control Panel does not show the OFFER ROUTING at all
(owner: "that is not what is actually in the repository").**
"How they got here" shows only Source / Campaign / Ad / Landed on / Magnet.
It does NOT show gate, entry, primary offer or secondary offers — which is the
whole point of ad attribution, and the data exists.

For Sim Five-Academy (ad 82) the registry already holds:
gate **720** · entry **direct** · primary **funding_dfy** · secondary **none**.
None of it reaches this screen. Tier and Prequal under PATH also read "—".

Owner is explicit that tracking primary/secondary offer per client is how the
system was designed. The registry has it; the panel does not surface it.
Verify next whether the Closer Dashboard shows the four ad lines (SOP 1.4
claims it does) — if it does, this is a CCP display gap; if it does not, the
routing is not surfaced anywhere and that is far more serious.

Both F8 and F9 are FIXES FOR AFTER THE WALK. Owner said: proceed.

**F9 DOWNGRADED · the routing IS surfaced — on the Closer Dashboard.**
Sim Five-Academy's closer screen shows exactly the four lines, matching the
registry for ad 82:
GATE 720+ · ENTRY Direct, sell what they were promised ·
PRIMARY Funding, done-for-you · SECONDARY None.

So F9 is a **display gap on the Client Control Panel only**, not missing data.
The routing works end to end. Revised ask: surface gate/entry/primary/secondary
on the CCP too, since that is the screen non-closers open. Severity: low.
SOP step 1.4 / 5.1 expectation: PASS.

**F10 · CONFIRMED LIVE — the lender matcher ignores the credit file.**
Sim Five-Academy's closer screen reads **"307 lenders match this file"** while
also reading "No credit pull on file yet" and "No crs_results row for this
client yet". A client with zero credit data matches 307 lenders.

This is exactly what the funding ground-truth agent predicted from the code
(finding 4 in docs/workflows/expected-deliverables-funding-2026-09-03.md:
matching uses no score, no card use, no tier, no estimate). Predicted ~313
with no state on file; observed 307. Prediction and live behaviour agree.

Consequence: the lender count shown to a closer is not evidence of anything
about that client. A 588 repair client sees a near-identical number.

Also observed on this screen and correct: all five sims listed in UP NEXT with
their booked times; "What they can get" correctly refuses to show figures with
no credit pull; success fee 10% house default.

**F10 ESCALATED · owner verdict: showing ANY lender count before a credit pull
is wrong. Severity: HIGH.**
Chris: "we didn't pull their fucking credit yet, so there shouldn't be any
matched banks at all."

Owner-set: with no credit file on the client, the correct display is **no
lender count at all** — not 307, not any number. The screen already knows the
file is empty (it prints "No credit pull on file yet" three times in the same
panel) and then contradicts itself with "307 lenders match this file".

Two separate defects, both now owner-decided:
1. **Gate the count.** No credit pull on file → show nothing, or "pull credit
   to see matches". Never a number.
2. **Make matching actually use the credit file.** Post-pull, the count must
   change based on score / tier / card use. Today it does not (F10 original,
   proven live and in code).

Note the wording is a lie either way: "match this file" when there is no file.
This is a number a closer could repeat to a client on a live call.

**F11 · CLIENT-FACING BUG. The Present deck shows raw database IDs instead of
the client's survey answers. Severity: HIGH — the client sees this.**
Present deck screen S-03 "YOUR ANSWERS" / "This is what you told us. Anything
change?" on Sim Five-Academy. This is the CLIENT half of the split screen.

| Row | Shown | Should show |
|---|---|---|
| Funding target | 207883 | $200k - $400k |
| Planned use | 207888 | Growth (marketing, inventory, hiring) |
| Business | 207918 | Yes, 5+ years |
| Monthly revenue | 208124 | $1M+ (annual) |
| Capital on hand | 207975 | $100k+ |
| What changes with the money | 207897 | Grow faster |

Six consecutive ~207.9k values: these are answer-option row ids. The screen
renders the option's ID instead of resolving it to its label.

Three rows correctly show "—" (Annual income they said, Income Insight
Experian, IncomeView Equifax) because no credit pull exists yet. Those are
right.

Related to F8 (same survey data mis-handled on the Client Control Panel), but
worse: F8 is an internal screen, this one is shown to the customer on a live
sales call. A closer opening the deck with a real client on Zoom shows them
six meaningless numbers on a slide that says "this is what you told us".

Fix: resolve the option id to its display label before render. Check whether
the same unresolved id leaks into any other client-facing surface.

**F11 ESCALATED · the raw ID is the HERO NUMBER on the goal slide.**
Present deck screen S-04 "THE GOAL", client half. Under the heading
"BEGIN WITH THE END IN MIND" the screen prints **207883** in the largest type
on the page, then a paragraph beginning "207888. What does the business look
like 6 to 12 months from now with this deployed?"

So the defect is not confined to a list of rows (F11 original, screen S-03).
The same unresolved option id is rendered as the single biggest visual element
on a client-facing slide, and again mid-sentence in body copy.

Context that makes this expensive: the closer's own notes on the matching
screen read "The cost number is what the $3,000 gets anchored against. Do not
skip it." The deck is built so this number carries the price anchor. Today it
shows a database row id.

Screens confirmed affected so far: S-03 (six rows), S-04 (hero + body).
Check every remaining deck screen for the same leak.

**Step 1.5 / 5.x · soft pull SENT.** "Send soft pull ($32 + approval form)"
returned the toast "Soft pull emailed — pay link + approval form." Live soft
pull panel read consent: waiting · paid $32: not yet · pull: not started
before the click. Awaiting the email in Chris's inbox.

Also on this screen and worth noting: a "NO-PAY DOWNSELL — E-BOOK" control
with a free-text price and the caption "Empty PDF attached until the real file
is ready." The e-book product ships an empty PDF today.

**F12 · The soft pull arrived by TEXT, not email. The UI says email.**
Chris, on Sim Five-Academy: "I was texted not emailed."

The button is labelled "Send soft pull ($32 + approval form)" and the success
toast reads **"Soft pull emailed — pay link + approval form."** No email
arrived. An SMS did.

So one of two things is wrong and we do not yet know which:
- the channel is right (SMS) and the toast copy lies, or
- the channel is wrong (should be email, or both) and delivery went to the
  fallback.

Do not guess. Read the template and the send path after the walk. The SOP
(step 1.5) also says "Email in your inbox with the consent link", so the
written expectation matches the toast, not the observed behaviour.

Note this is a $32 payment request plus a credit-consent form. Which channel
carries it is a compliance-relevant question, not a cosmetic one:
consent capture is on the CLAUDE.md section 7 flag list.
COMPLIANCE REVIEW REQUIRED on any change to how this consent is delivered.

**TODO after this sim · full SMS review.** Chris will share the complete text
message thread so every SMS issue gets written up together. Expect findings on
wording, timing (see F1: ~3 min vs the 60-second target), sender identity, and
which messages should be email instead. Hold a section for it.
