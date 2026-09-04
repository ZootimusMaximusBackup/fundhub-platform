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

**CREDIT PUSHED · Sim Five-Academy (owner-authorized, live).**
`scripts/sim/with-prod-env.sh push-credit --email …+sim-05@ --profile academy`
Client 823c850e-deee-4022-bf80-27ec23f77915. EX 762 · EQ 770 · TU 758,
4 tradelines, 4 liabilities, 0 inquiries, 0 negatives. Wrote crs_results
c159f8e3-4205-4306-b8f3-07652a04b87e. Stamped outcome_tier=FULL_FUNDING,
total_funding_estimate=199350. Emitted analysis.completed + decision.rendered.
No bureau called, no card charged. Marked simulated.

**F13 · The "premium buyer" test profile can never reach the premium tier.**
Engine is CORRECT — this is a test-data defect, not an engine bug.
`isPremiumStack` (vendor/underwriteiq-full/api/lite/crs/route-outcome.js:153)
requires ALL of: median >= 760, utilization <= 10%, revolving anchor limit
>= $10,000, revolving depth >= 3.
Academy scores median 762 (passes) but its lines are the shared CLEAN set,
which computes ~17% utilization — so it fails on card use and lands on
FULL_FUNDING every time.
Consequence: PREMIUM_STACK is untested by this walkthrough. Nobody has ever
seen the "Premium Funding Approved" path run. To exercise it, the academy
profile needs its own low-utilization line set.

**F14 · The funding estimate ignores the credit score entirely.**
Profile `funding` (median 724) and profile `academy` (median 762) both produce
**$199,350 to the dollar**. Cause: both use the same CLEAN tradeline set, and
the estimate is derived from the card/loan anchors and the utilization band
only. A 38-point score difference changes nothing.
Predicted in docs/workflows/expected-deliverables-funding-2026-09-03.md and now
confirmed live on two different clients.
Owner question for later: SHOULD score move the estimate? If yes this is a
product bug; if no, the number is honest but the sim can never show variation.

**Note · GoHighLevel was not called.** The push logged
"ADAPTERS_DRY_RUN fence is up — stamped placeholder dry-ghl-823c850edeee".
So the CRM sync to GoHighLevel is fenced off in this environment. Anything the
walk expects to appear in GoHighLevel will not.

**GoHighLevel note WITHDRAWN (owner).** Chris: "GoHighLevel isn't relevant for
the CRM." The ADAPTERS_DRY_RUN fence skipping the GoHighLevel call is expected
and correct, not a gap. Fundhub's own CRM is the system of record. Do not
raise GoHighLevel as a finding again, and do not chase anything that "should
have appeared" there.

**F15 · TWO DIFFERENT FUNDING NUMBERS FOR THE SAME CLIENT. Severity: HIGHEST.**
Sim Five-Academy, same credit file, same minute:

| Source | Funding figure |
|---|---|
| Tier engine write (push-credit output, client row `total_funding_estimate`) | **$199,350** |
| Present deck "ENGINE DATA" line, shown on the sales call | **$939,500** |

4.7x apart. The deck figure is the one a closer reads to a client.
Deck line in full: `FULL_FUNDING · $939,500 · 762/758/770 · afterFix — · beliefs 0/7`.
Scores match the pushed file exactly (762/758/770), so both numbers are being
computed from the SAME credit data and disagreeing.

Note the deck's own comment at public/app/present.js:917-920 says the
pre-approval figure "comes from state.engine, which the SERVER computes from
business age" — so the deck recomputes rather than reading the stored estimate.
Two independent calculations of the same quantity, no reconciliation.
push-credit wrote businessAgeMonths: 72 for the academy profile, which is
likely why the deck's number is far larger.

This is a money figure quoted to a customer. Until it is resolved, no funding
estimate shown on the deck can be trusted.

Do NOT fix mid-walk. Next steps after: find the server endpoint behind the deck
payload, diff its estimate math against src/finance/crs-tier.mjs, and decide
which one is authoritative. One of them must be deleted, not "kept in sync".

**F16 · Status line contradicts the result.** Same panel reads
`pull: not started` while also reading `tier: FULL_FUNDING` and showing full
engine data. The pull-status indicator is not updated by the path that stamps
the tier. Minor next to F15 but it is on the same screen.

**Also confirmed working:** a hard refresh DID populate the deck — consent: on
file, paid $32.00: sent, scores correct. The earlier "not on this file yet" was
a stale page, not a defect. Retracted as a finding.

**F15 ROOT CAUSE FOUND. It is not a sync bug — the two numbers measure
different things, and the bigger one is computed for a client with no
business.**

`src/sales/closer-deck.mjs:297-306`. The deck calls
`applyStackedBusinessFunding(computeUnderwrite(bureaus, businessAgeMonths), businessAges)`
and shows `totals.total_combined_funding` = **personal + stacked business
funding**. It only falls back to the stored `total_funding_estimate`
($199,350, personal only) when that stacked calculation returns null.

So:
- stored $199,350 = PERSONAL funding only
- deck $939,500 = PERSONAL + STACKED BUSINESS

Neither is "wrong arithmetic". They are different quantities, both presented
as "the funding estimate", with no label distinguishing them.

**The actual defect:** Sim Five-Academy's own Client Control Panel reads
**"No businesses on file"**. The deck still stacked business funding for him,
off the `businessAgeMonths: 72` the sim profile writes. A client with no
business is being quoted roughly $740,000 of business funding.

Owner verdict already given: "939k is so wrong". Treat $199,350 as the number
closer to correct and the deck figure as the defect.

Three things to decide after the walk:
1. Should the deck ever stack business funding when no business exists on the
   client? Almost certainly not — gate it on a real business record, not on a
   loose age field.
2. One of the two calculations must become authoritative and the other deleted.
   Keeping both "in sync" will fail again.
3. Label whatever is shown: personal-only vs personal+business, on the screen.

Cross-reference F14 (the stored estimate ignores credit score) — so BOTH
figures on this screen have an open correctness question.

**E-book no-pay downsell · SENT.** Sim Five-Academy, price typed as `5`,
"Send e-book email" returned "E-book email sent with PDF attached."
Expected per the control's own caption: "Empty PDF attached until the real
file is ready." Verifying the delivered attachment now.

Watch on this one: the amount field took a bare `5`. Confirm whether that means
$5.00 or 5 cents — the deck's e-book handler validates cents
(src/sales/closer-deck.mjs:538-545, "whole-cent amount between $1 and
$500,000"), so a bare 5 could be read either way. If the client is charged
$0.05 or $5.00 when Chris meant the other, that is a money bug.

**F12 RETRACTED · the soft-pull email DID arrive.** Subject "Your soft-pull
assessment — authorize, then pay", 6:24 PM, to +sim-05. Chris received BOTH an
SMS and an email; only the SMS was noticed at the time. The toast copy
("Soft pull emailed") and SOP step 1.5 are correct. No channel defect.
The compliance flag raised under F12 is withdrawn with it.

**F17 · Fundhub mail is skipping the inbox (environment, not product).**
Every Fundhub message carries the Gmail labels `FS Auto` / `FS Fundhub` and
lands in All Mail rather than Inbox. That is a filter on Chris's own account.
It caused F12's false finding and will keep hiding walk evidence.
Action: check the "FS Auto" filter before the next walk, or run the walk from
All Mail. Not a product defect — recorded so the next run does not repeat the
mistake.

**Email sequence observed for Sim Five-Academy (times MST, 2026-09-03):**

| Time | Subject |
|---|---|
| 6:05 / 6:10 / 6:15 PM | "You're booked — <date/time>" (one per sim as each booked) |
| 6:07 PM | "A new appointment has been scheduled!" (staff-side) |
| 6:08 PM | Google Calendar invitation |
| 6:24 PM | "Your soft-pull assessment — authorize, then pay" |
| 6:34 PM | "Fundhub e-book — $5" (with attachment) |
| 6:35 PM | "You're in — here's what happens next" |

**E-book amount resolved:** a bare `5` in the price field means **$5.00**, not
5 cents — the delivered subject line reads "Fundhub e-book — $5". The concern
logged with the send is closed. PDF attachment present; contents still to be
opened (expected empty).

**F4 CONFIRMED IN THE WILD.** Every message greets "Hey Sim" / "Hi Sim".
Five clients, one indistinguishable first name, exactly as predicted.

**F18 · Email signature images have a white background on a grey email.**
Observed in the Fundhub email signature block. The "fundhub." wordmark and the
"Josh" handwritten signature are images with a solid WHITE background, sitting
on the email body's light-grey ground. Both render as visible white rectangles
around the artwork.

Fix: export both as PNGs with a transparent background, or set the signature
block's background to match the image white. Transparent PNG is the right
answer — the signature must sit correctly on any client's background, and
Gmail/Outlook dark mode will make the white boxes worse, not better.

Check the same two assets everywhere they appear, not just this template.

Signature content for the record: "Josh · Funding Executive · Fundhub.ai ·
(561) 304-8368 · Fundhub.ai — Funding Intelligence for Entrepreneurs".

**F19 · EVERY EMAIL IS BEING SENT TWICE. Severity: HIGH.**
Both the soft-pull email (6:24 PM) and the e-book email (6:34 PM) appear as
TWO identical messages from noreply@fundhub.ai to +sim-05, same minute. The
All Mail list confirms it with thread counts: "Fundhub 2", "Fundhub 2",
"Fundhub 5". The booking sequence shows 5 in one thread.

A client receives duplicates of every transactional email, including the one
carrying a pay link. Check the dispatcher for double-processing of queued
`messages` rows (src/messaging/dispatch.mjs, swept every 5 minutes by
src/workflows/message-dispatch-sweeper.mjs) before assuming the workflow fires
twice — a sweeper that does not lock a row will send it again on the next tick.

**F18 REFINED · the white-box signature is template-specific.**
The soft-pull email's signature shows white rectangles behind the wordmark and
the "Josh" signature. The e-book email's signature renders the SAME two images
cleanly with no white box. So one template's styling is at fault, not the image
assets. Diff the two templates' signature block rather than re-exporting the
PNGs.

**Soft-pull email content · reads correctly.** Two clear numbered steps,
base $32 plus $10 per business up to 5, an authorization link and a pay link.
Nothing misleading. Two notes:
- The authorization link is rendered as a raw signed URL, wrapping across three
  lines (org, client, exp, sig all visible). Works, but ugly next to the tidy
  "Pay soft-pull assessment" link above it. Use link text for both.
- Payment goes to **fanbasis.com/agency-checkout/fundhub-1/…**, not Commas.
  Worth confirming that is intended, since push-payment.mjs simulates a Commas
  webhook.

**E-book PDF · placeholder confirmed, and the email is honest about it.**
Attachment `fundhub-ebook.pdf` present; Gmail's thumbnail renders blank. Body
copy says "The PDF is attached (placeholder until the final file is ready)."
So this is a known gap stated to the customer, not a silent failure. Still a
real deliverable gap: a paying customer receives an empty book.

**F19 RETRACTED (owner). Emails are NOT being sent twice.**
Chris: "not true, remember we have multiple clients using same email."

All five sim clients use plus-tags on ONE Gmail account, and Gmail threads by
subject line regardless of the plus-tag. So "Fundhub 2" / "Fundhub 5" are
messages to DIFFERENT sim clients collapsed into one thread by a shared
subject, not duplicate sends to one client.

The two 6:24 PM messages both addressed to +sim-05 are most likely explained by
the "Send soft pull" button appearing on several screens of deck section 03
(seen on screens 5, 6 and 7), so it can be pressed more than once during a
walk.

LESSON FOR THIS WALK: do not read Gmail thread counts as evidence of duplicate
delivery while every sim shares one mailbox. Verify send counts against the
`messages` table instead, not against the inbox.

**E-book pay link · WORKS.** fanbasis.com checkout opens correctly, shows
Fundhub, **$5.00**, card / Google Pay / Cash App Pay / US bank account, and
"Powered by Commas". So fanbasis.com is Commas' checkout host — my earlier note
questioning "fanbasis not Commas" is WITHDRAWN. The rail is Commas, as
push-payment.mjs assumes. Statement descriptor reads COMMAS.

**F20 · The checkout calls the product "Consulting Services Package".**
The e-book pay page shows `Consulting Services Package · $5.00`, not the
e-book. Every Fundhub product may be sharing one generic Commas product label.
The customer sees this at the moment of payment and again on their receipt.
Check whether the $32 soft pull, the $1,000 and $3,000 and $5,000 offers all
show the same generic name. If they do, receipts and disputes will be hard to
tell apart, and "Consulting Services Package" is a poor descriptor for a
$5 e-book.

**Note for later, not re-raised:** the thread does show a second 6:34 PM
message to the SAME address (+sim-05), which the shared-mailbox explanation
does not cover. Owner has ruled duplicates are not happening; recording the
observation only so it can be settled from the `messages` table rather than
from Gmail. No action now.

**F20 CORRECTED · the generic product title is BY DESIGN and rule-governed.**
Chris: "there are hard rules on what api shows commas... it's in repo."
Confirmed at `src/config/offers.mjs:35-79`. The comment is explicit:
"Resolve the Commas-facing product title — never staff free text."

The rule maps a title per product code and per payment purpose:

| Product code / purpose | Commas-facing title |
|---|---|
| diagnostic | Consulting Services Assessment |
| card-stacking-dfy / deposit | Consulting Services Engagement |
| repair | Consulting Services Standard |
| (invoice) | Consulting Services Completion |
| custom / fallback | Consulting Services Package |

So "Consulting Services Package" on the e-book checkout is the CORRECT default
for a custom-purpose payment. Not a bug. F20 withdrawn as a defect.

The only open question left, and it is small: should the e-book get its own
mapped title rather than falling through to the default? Owner's call, not a
finding. Everything else about this behaviour is working as specified.

**F15 ESCALATED TO MAXIMUM · the wrong number is the CLIENT-FACING
PRE-APPROVAL FIGURE. COMPLIANCE REVIEW REQUIRED.**
Present deck screen S-07 "YOUR RESULTS", client half, Sim Five-Academy:

    PRE-APPROVED FOR APPROXIMATELY
    $939,500
    Across multiple credit lines with 0 percent introductory rates.
    EXPERIAN 762 · TRANSUNION 758 · EQUIFAX 770

This is not internal engine data. It is the headline the customer reads, and
the closer script beside it says out loud: "We can get you pre-approved for
approximately [Amount] across multiple credit lines with 0 percent introductory
rates. Pause. Let the number land."

The number is wrong for the reason already established (F15 root cause): the
deck stacks BUSINESS funding onto personal for a client whose own record says
"No businesses on file", off a loose `businessAgeMonths` value. The engine's
own stored figure for the same file is $199,350.

Why this is the most serious finding of the walk:
- It is a specific dollar pre-approval claim made to a consumer.
- It is spoken aloud, by script, and the script instructs the closer to pause
  so the number lands.
- It also asserts "0 percent introductory rates" alongside it.
- It is repeated on screen S-08 ("secure that [Amount] in the next two weeks").

CLAUDE.md section 7: this is credit-outcome messaging to a consumer.
**COMPLIANCE REVIEW REQUIRED** on the fix. Flagged as the marker Chris asked
for, per the owner-decisions rule — no advice attached.

Owner has already said the figure is wrong ("939k is so wrong lmao"). Until it
is fixed, do not run this deck screen in front of a real client.

**Deck section 05 COMMIT · the descent ladder, as built.**
Screen 17/24. "DESCENT LADDER — EVERY CALL MONETIZES", options in order:

| Offer | Price |
|---|---|
| Funding · deposit (default selected) | $3,000 |
| Repair DFY | $1,000 |
| Repair trial round | $200 |
| DIY letters + course | $1,000 |
| Funding Mastery | $5,000 |
| Education deliverables | $1,000 |

Caption: "One click reshapes the price screen. Descend only on a no. Financing
available on everything except the soft pull and the funding deposit."
Objection buttons present: Think about it · $3K is a lot · What if it fails ·
Spouse · Burned before · DIY · Reframes.

Matches the SOP's five paths and prices. No finding.

**Note · the ladder defaults to Funding $3,000 regardless of the client's
routed offer.** Sim Five-Academy's own closer screen says PRIMARY is
"Funding, done-for-you", so the $3,000 default is consistent with HIS routing,
but the SOP path for this client is Capital Academy / Funding Mastery $5,000.
Worth confirming later whether the ladder default follows the ad-registry
primary offer or is simply always $3,000. Not yet proven either way — do not
record as a defect.

**$939,500 now confirmed on FOUR screens:** S-07 (client hero), S-08, S-09 and
S-17 all carry it in the ENGINE DATA line. The wrong figure follows the whole
deck, it is not one bad slide.

**OFFER NAMES AND PRICES — recorded (owner asked these be saved).**
The descent ladder on deck section 05, exactly as it reads live 2026-09-03:

| # | Offer name (verbatim) | Price |
|---|---|---|
| 1 | Funding · deposit | $3,000 |
| 2 | Repair DFY | $1,000 |
| 3 | Repair trial round | $200 |
| 4 | DIY letters + course | $1,000 |
| 5 | Funding Mastery | $5,000 |
| 6 | Education deliverables | $1,000 |

Rules shown with the ladder: "One click reshapes the price screen. Descend only
on a no. Financing available on everything except the soft pull and the funding
deposit."

Objection buttons present: Think about it · $3K is a lot · What if it fails ·
Spouse · Burned before · DIY · Reframes.

**F21 · Missing objection handling from "alec dupesh" (owner note, low
priority).** Chris: "common objections from alec dupesh should be here....but
honestly not huge deal." Name recorded verbatim as he said it — do not guess
who this is or substitute a different trainer's material. Ask Chris for the
source before adding anything.
Owner explicitly rated this LOW. Do not treat it as blocking.

**OPEN QUESTION · did the ladder selection actually change?**
After Chris was told to click "Funding Mastery · $5,000", both screenshots
still show **Funding · $3,000 deposit** highlighted as selected. Either the
click was not made, or clicking a ladder row does not change the selection.
Unresolved — confirm with Chris before recording as a defect.

**LADDER QUESTION RESOLVED · the descent ladder WORKS.** Clicking
"Funding Mastery · $5,000" selected it, and the client price screen reshaped
correctly to S-19 "THE INVESTMENT — FUNDING MASTERY, A TO Z · $5,000 ·
The full Fundhub program · Your own file · FINANCING AVAILABLE", then S-20
"Two courses. One skill set." (Course 1 UWIQ deliverables + bank list $1,000,
Course 2 Funding Mastery A to Z $5,000). Engine data line also gained
`route EDU`. No defect. The earlier screenshots were taken before the click.

**F22 · Client-side deck slides have most of the screen empty (owner: "the
screens are falling apart").**
On S-19, S-20 and especially S-23, all client-half content sits in a band at
the top and the remaining two-thirds to three-quarters of the slide is blank
white. Chris was viewing at 50% browser zoom, which exaggerates it, but the
layout does not fill or balance the space at any zoom — there is no vertical
centring and no scaling of the type to the slide.

This is the half the CUSTOMER sees on a screen share. Judge it against
docs/UI-STANDARDS.md before changing anything (that file is law for anything
under public/app/).

**Deck section 07 CLOSE · live actions, as built (S-23).**
Client half reads "RIGHT NOW, ON THIS CALL — Let's get this going", with
Agreement: Sent · Billing: On this call · Welcome email: Incoming.
Staff actions available: **Send agreement + pay link** (primary), Invoice this
client, Send contract, Send deliverables package now, a REPAIR REFERRAL
checkbox, and Log disposition and close.

**F23 · The wrap script promises FUNDING to a client who bought the COURSE.
(owner: "this is not accurate")**
Deck screen 24/24, section 07 CLOSE "Wrap", with Funding Mastery $5,000
selected and the engine line reading `route EDU`. The closer is scripted to say:

  "Within 24 business hours your advisor reaches out and starts on your file.
   Within 72 business hours your first applications are submitted."
  "Congratulations, Sim. You made a great decision. We're going to get you
   funded. Talk soon."

None of that is true for this purchase. Sim Five-Academy bought a $5,000
education program. No advisor works his file, no applications get submitted,
and nobody is getting him funded as a result of this sale.

The client half of the same screen IS correct — "Today: Deliverables ·
Your pace: Program · When you're ready: Funding — we run the full process
whenever you want." So the customer-facing copy adapts to the offer and the
closer script does not.

This is a spoken promise of a funding outcome attached to an education sale.
CLAUDE.md section 7: credit/funding-outcome messaging to a consumer.
**COMPLIANCE REVIEW REQUIRED** on the fix.

Check every section-07 script line against each of the six ladder offers, not
just this one — if the wrap is hardcoded to the funding path, the earlier
sections likely are too.

**Send agreement + pay link · WORKS.** Sim Five-Academy. Delivered by text,
and presumed by email too. Contract auto-matched correctly: the wording panel
pre-selected **"Funding Mastery Program Agreement"** with the note "Matched
Funding Mastery Program Agreement to this offer. Send when ready." The offer
chosen on the ladder does drive the contract template. Good.

**F24 · THE BUTTON GIVES NO FEEDBACK, SO IT GETS PRESSED REPEATEDLY AND THE
CLIENT IS SPAMMED. Severity: HIGH. This also explains the earlier duplicate
emails.**
Chris, verbatim: "when I click it, it should show that it's been clicked, bro.
And it should have, like, a reset of five seconds or something, or like three
seconds... I don't know it's been sent other than the little bottom thing, but
I press it like three or four times, and then all of a sudden the client gets
like four or five text messages, four or five emails, because I can't really
tell."

So the two 6:24 PM messages to +sim-05 (recorded earlier, then set aside when
F19 was retracted) were REAL duplicates after all — not a Gmail threading
artifact and not a workflow firing twice. The cause is a send button with no
pressed state, no disabled state, and no cooldown. Every extra press is another
real text and another real email to a customer.

Required fix on every send control in the deck:
- immediate visual pressed/sending state on click
- disable the button while the request is in flight
- a cooldown of roughly 3-5 seconds after success (owner's number)
- a persistent "Sent at HH:MM" line, not just a toast that vanishes

This is a customer-experience and cost problem, and for SMS it is also a
consent/frequency question. Applies to Send soft pull, Send agreement + pay
link, Send contract, Send this wording, Send deliverables package now, and
Send e-book email.

**F25 · Too many live-action buttons after the offer is already chosen.**
Chris: "It's all kind of confusing as fuck, though, because we've already
chosen the offer. So it's just extra buttons that will throw people off.
Obviously, there's a black label on it. That's not enough."

Section 07 presents Send agreement + pay link, Invoice this client, Send
contract, a contract wording form, Send deliverables package now, a Repair
referral checkbox, and Log disposition and close — all at once, with only the
black fill marking the intended one. Once the ladder selection is made, the
screen should lead with the single correct action for that offer and demote or
hide the rest. Owner has judged the current emphasis insufficient.

**F26 · BLOCKER · the simulated payment is REJECTED by the live webhook.**
`scripts/sim/with-prod-env.sh push-payment --email …+sim-05@`
resolved the right link (pl_1e544cf878f9c46f93741356 · product funding-mastery
"Funding Mastery Course" · $5,000.00 · status sent) and posted to
https://fundhub.ai/api/webhooks/commas, which answered:

    HTTP 401 {"ok":false,"status":401,"reason":"bad_signature","queued":false}

So no payment lands, no entitlement is granted, and the whole
post-payment half of path 5 cannot be walked until this is fixed.

Checked so far: `COMMAS_WEBHOOK_SECRET` DOES come back from Netlify production
(20 characters, value not printed). The script signs with
`HMAC-SHA256(raw, secret)` hex into header `x-webhook-signature`
(scripts/sim/push-payment.mjs:47, :103). So the secret is present and the
method is the documented one — the mismatch is elsewhere: either the live
handler expects a different header name, a different digest encoding, a
prefixed scheme, or a signature over a different byte string than `raw`.

NOT yet diagnosed further. Next step is to read the live handler behind
`webhooks/commas` and compare its verification to the script's signing, one
pass, no guessing.

**F27 · The contract wording form demands COMPANY details from a client with
no company.** Sim Five-Academy's own record says "No businesses on file", he is
buying a $5,000 personal education program, and the Funding Mastery Program
Agreement form still requires Company name and Company email as mandatory
fields. Either the template should have a personal variant, or those fields
should not be required for an education purchase.
Walk continued with placeholder values so as not to block.

**F27 UPGRADED · OWNER-SET: REMOVE THE CONTRACT WORDING FORM ENTIRELY.**
Chris, verbatim: "this needs to be fixed. This is horrific... it should already
have that information. Just send it. We don't need to, like, enter in the
information. That is booty. It needs to be changed... it needs to be just
removed completely."

Decision, not a suggestion: the "WORDING FOR THIS CLIENT" panel on deck section
07 — Company name, What the program includes, Program fee, Access length
(days), Company email, and the "Send this wording" button — comes out. The
system already holds the client, the offer, the price and the contract
template; it correctly auto-matched "Funding Mastery Program Agreement" to the
selected offer without any help. Sending the contract must be one click with
no typing.

Log as owner-set and do not re-raise. F27's earlier framing (make company
fields optional / add a personal variant) is superseded — the whole form goes.

**Payment signature — diagnosis so far, one pass, not yet solved.**
The header name is NOT the problem. `src/adapters/commas.mjs:53` accepts
`x-webhook-signature` first, which is exactly what push-payment.mjs sends
(:103). Both sides compute HMAC-SHA256 over the raw body and compare hex
(`verifyCommasSignature`, :67-71), and the adapter also tolerates a "sha256="
prefix. So header, algorithm and encoding all match.

That leaves the secret itself or the exact bytes signed. Most likely the
`COMMAS_WEBHOOK_SECRET` this laptop reads from Netlify is not the value the
deployed site verifies with. Next pass: confirm what the running site actually
has, rather than what `netlify env:get` returns. Stopping here per the
two-attempt rule instead of guessing at a third change.

Note the same file carries a standing warning at :29 to confirm the signature
header and body paths against a real Commas sandbox, and :47-51 records that
this adapter was once wired to a header no real delivery ever carried — so this
seam has broken before.

**Contract flow · WORKS end to end.** "Please sign: Funding Mastery Program
Agreement" email 6:51 PM → signed link opens contract.html with status
WAITING FOR YOUR SIGNATURE → typed name + tick → "signing..." → SIGNED, "This
document is signed. Nothing else is needed from you", signed by Chris Stanbridge
9/3/2026 6:52:23 PM, with Download a copy. Mechanics are sound.

**F28 · THE COMPANY-NAME FIELD POPULATES THE WRONG PARTY. Severity: HIGH.**
The contract reads:

    Between: Sim Five Academy LLC ("we")
    And: Sim Five-Academy ("you")

"Sim Five Academy LLC" is the value typed into the wording form's *Company
name* box. It landed as the SELLER — the "we" — which must always be Fundhub.
So the agreement currently says the client's own company is selling the program
to the client. Every contract sent through this form has the same defect.

This compounds F27 (owner-set: remove the wording form entirely). Removing the
form fixes this too, since the seller should never be typed by staff.

**F29 · The contract has no signature block inside the document.**
The agreement body ends at "YOUR COPY" with no signature lines, no date line,
no party blocks. The signature is captured in a separate panel below the
document, so the saved and downloaded copy carries no visible execution block
where a contract normally has one. Chris: "Lacking signature spot on document."

**F30 · The contract wording is placeholder, not the real agreement (owner).**
Chris: "Def not the real contract." The current body is six short generic
sections (WHAT THIS IS / WHAT YOU PAY / WHAT WE DO NOT PROMISE / HOW LONG THIS
LASTS / YOUR COPY). It reads as scaffolding, not the executed legal document.
Real contract text is needed from Chris before this can go in front of a paying
customer. Recorded as owner-stated fact, no advice attached.

One thing the placeholder does get RIGHT and which must survive any rewrite:
"We do not promise funding, any approval amount, any credit score change, or
any particular result. This is an education program." That disclaimer is
correct for the Academy offer and directly contradicts the closer's spoken wrap
script (F23), which promises funding on the same sale.

**F24 CONFIRMED WITH HARD EVIDENCE · two pay-link emails, two DIFFERENT links.**
Both 6:47 PM to +sim-05, subject "Capital Academy — $5,000":
`fanbasis.com/agency-checkout/fundhub-1/KBxJJ` and
`fanbasis.com/agency-checkout/fundhub-1/NjAMN`.
Distinct checkout ids, so these are two real sends creating two real pay links,
not one message threaded twice. The no-feedback send button (F24) is
demonstrably generating duplicate payment links for a single sale.

**F30 ACTION SET BY OWNER · SEED REAL CONTRACTS.**
Chris: "Seed real contracts."

Owner-set task, not a suggestion. The placeholder bodies come out and the real
executed agreement text goes into the contract templates as seeded data, so
every offer sends its true document.

What this needs, in order:
1. Chris supplies the real contract text, one per agreement. Known templates in
   play so far: Funding Mastery Program Agreement (Academy, $5,000),
   FUNDING-AGREEMENT (funding DFY, $3,000 deposit), CREDIT-REPAIR-AGREEMENT
   (repair DFY, $1,000). The SOP also records that Capital Blueprint ($1,000)
   has **no contract template at all** — that gap is still open.
2. Seed them into `contract_templates` by `template_key` via db/seed, so they
   ship with the repo rather than being typed on a call.
3. Fix F28 in the same pass: the seller party is always Fundhub, never a staff-
   typed value.
4. Add the signature block inside the document body (F29).

Do NOT draft contract language independently — this is executed legal text and
Chris supplies it. Agents seed what he provides.

The one line that must survive into the Academy contract verbatim in substance:
no promise of funding, approval amount, credit score change, or any particular
result; it is an education program.

**F31 · A NEW PAYING CLIENT HAS NO WAY INTO THE PORTAL. Severity: HIGH.**
`fundhub.ai/app/client-portal.html` presents a plain **email + password** sign
in with "Need help? support@fundhub.ai", "Forgot your password?" and
"Back to fundhub.ai". There is no "email me a sign-in link" option on the page
at all.

A client who has just booked, been sold and signed has never set a password.
Nothing in the whole walk asked them to create one. So their only route in is
the password-reset flow, which is not a welcome experience for someone who paid
$5,000 sixty seconds ago.

This also finally corrects the runbook and SOP text. Earlier today those files
said the portal magic link is "request-only, ask for one on the portal sign-in
page" (commits 47ea5000 and 1160b73d). **That is wrong too** — the sign-in page
offers no such request. Both files need correcting again, and this time from
the live screen rather than from the template table.

The whole portal entry story is now the open question: is there a magic-link
route at all, does the booking or purchase flow ever set a password, or is
password-reset genuinely the intended door? Trace it in code before writing
anything else into the SOP.

**F31 EXPANDED · the portal account EXISTS and is active — the client just
cannot get a credential. Confirmed against the live database.**

    accounts row c27a007f-8538-4599-aff6-391ba301dc24
    kind client · status active · password_hash PRESENT
    client_id 823c850e-… (Sim Five-Academy)
    activated_at 2026-09-04T01:27:20Z  (6:27 PM MST, right after the consent form)
    invited_at NULL

So the funnel DOES create and activate a portal account with a password set,
about a minute after the soft-pull consent form. Nobody ever tells the client
what that password is, no invite was sent (`invited_at` is null), and the
self-serve reset answers **"Nothing was sent. Ask an owner or admin for a reset
link."**

Net effect: every client who buys is silently given an active account they can
never sign into. That is the real shape of F31 — not a missing account, a
missing credential hand-off.

There IS an `account_magic_links` table and magic-link code
(src/auth/magic-link.pg.test.mjs), so the mechanism exists. What is missing is
anything that sends one at signup or purchase, and any owner/admin control to
send one from the CRM — grep found no reset-link or magic-link action on the
Client Control Panel.

Three things to decide after the walk:
1. Send a set-your-password or magic link at account creation.
2. Give the owner/admin a "send portal link" button on the client record, since
   the reset screen explicitly tells clients to ask for one.
3. Decide whether client self-serve reset should work at all; today it is off.

**Side observation, unexplained:** accounts matching `%+sim-%` are
5 affiliate + 5 partner + 1 client. Only ONE client account exists for five sim
clients, while five affiliate and five partner accounts exist. Origin unknown,
probably earlier runs. Not chased.

**Walk blocked here.** Setting a password on the sim account required a write to
the production database that the agent harness refused. Command handed to Chris
to run himself.
