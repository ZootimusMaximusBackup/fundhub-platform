# Workflow Migration Table

Living document, filled in one batch at a time per WORKFLOWS B3 (N-series → F-series →
AR-series → AF-series → the rest). Every one of the 140 GHL workflows in
`GHL-System-Map.md` gets a row here — MIGRATED / MERGED INTO X / RETIRED / BLOCKED /
DEFERRED — before this file is considered done. Rows not yet processed are marked
PENDING rather than guessed.

**Mode change, mid-run:** after the N-series batch, Chris switched this from
"stop between series and wait" to "run the full port straight through, only stop for
money / outbound-messaging-at-scale / PII." From F-series onward, ambiguous calls that
aren't one of those three are made directly and logged in "Decisions made without
confirmation" below, rather than pausing to ask.

Legend:
- **MIGRATED** — ported to `src/workflows/<key>.mjs`, tests passing.
- **RETIRED** — confirmed dead, nothing to port.
- **BLOCKED** — needs a decision (usually new canonical events) before it can be ported.
- **DEFERRED** — port intentionally withheld pending a business-logic or compliance decision.
- **MERGED INTO X** — folded into another workflow's file.
- **PENDING** — batch not yet run.

## Final tally (run complete — all 140 processed)

| Disposition | Count |
|---|---|
| MIGRATED | 47 |
| RETIRED | 45 |
| BLOCKED | 29 |
| DEFERRED | 9 |
| MERGED INTO another file | 8 |
| OUT OF SCOPE (not actually in the 140) | 1 |
| **Total accounted for** | **139** |

Counted 139 of the source map's own "140 workflows" header figure — not 140 exactly.
This isn't a dropped workflow; it's the source map's own category counts not fully
reconciling, which surfaced repeatedly during this port: AF-06 filed under both
DECOMMISSIONED and the AR-Series section, a second "DPC-04" filed under the AS-Series
heading with unrelated content, two distinct workflows both keyed "S-02", N-08 present
only in the DECOMMISSIONED folder despite Spec §6 listing it as live. Every distinct
workflow definition actually encountered while reading `GHL-System-Map.md` end to end
has a row below — none were skipped for being inconvenient.

---

## Model drift — 04/08 vs 05/30

**Status: needs Chris.** Every workflow in `src/workflows/` was ported from
`fundhub-docs/sources/ghl-crm-source-of-truth.md`, dated **04/08/2026**, which says of
itself "THESE RULES ARE OUTDATED." The current source of truth is **05/30/2026** and is
**not in this repo** — it has not been uploaded. Everything below is derived from what
is verifiable in code plus the one drift Chris stated directly; nothing here is inferred
from the 05/30 document, because nobody has read it.

### The drift

Under 04/08, the CRS soft pull ran **before** the call: the client paid the $32
diagnostic, the pull returned, a recommendation was stamped on the record, and the call
was booked and taken against it. Under 05/30 the pull runs **live on the call**. The
recommendation does not exist until Stage 4. Any workflow that reads it before a call
has completed is reading a value that has not been produced yet.

### Field mapping (why `cf_analyzer_recommendation` greps clean)

The 04/08 doc's `cf_analyzer_recommendation` (24 occurrences) was **not ported under that
name**. It has two successors in this codebase, and an audit that greps for the GHL field
name finds nothing:

| 04/08 GHL field | Ported to | Written by | On event |
|---|---|---|---|
| `cf_analyzer_recommendation` (the 6-tier decision) | `clients.outcome_tier`, read via `clientOutcomeTier()` in `src/config/product-path.mjs` | `client-lifecycle.mjs:onDecisionRendered` | `decision.rendered` — **and nothing else** |
| `cf_analyzer_recommendation` (the dollar figure shown to the client) | `custom_fields.total_funding_estimate` | `client-lifecycle.mjs:onDecisionRendered` | `decision.rendered` |

So the audit question "does the value exist when this workflow runs?" reduces to a
mechanical one: **is this workflow's trigger strictly after `decision.rendered` on the
canonical spine?** (`src/events/canonical.mjs`.)

### Audit — all 8 readers of `clientOutcomeTier()`

| Workflow | Trigger | Tier exists at trigger? | Verdict |
|---|---|---|---|
| `c-06-crs-results-router` | `analysis.completed` | No — see ordering bug below | **FIXED** |
| `u-02-analyzer-complete-delivery` | `analysis.completed` | No — same | **FIXED** |
| `bs-01-precall-launcher` | `booking.created` | **No** — booking precedes the call, the pull happens on it | **DEAD — proposal below, not shipped** |
| `ds-02-diy-letters` | `payment.received` | Unknown — generic side event, fires for the $32 diagnostic too | **FLAG** |
| `ds-01-repair-referral` | `call.completed` | Probably — the pull runs during the call it follows | **AT RISK** |
| `s-06-post-call-funding-purchased` | `deposit.paid` | Yes — post-decision on the spine | OK |
| `f-01-funding-intake` | `round.started` | Yes | OK |
| `f-09-funding-declined-no-path` | `mail.response` | Yes — bank response, deep in funding rounds | OK |

**Fixed — `c-06` and `u-02` (an ordering bug, provable from code alone, model-independent).**
`emitCrsResult` (`src/adapters/crs.mjs`) emits `analysis.completed` **then**
`decision.rendered`, and `bus.mjs:dispatch` runs handlers synchronously in order. So a
workflow triggered by `analysis.completed` runs *before* `onDecisionRendered` writes
`clients.outcome_tier` — the column is null on a first pull and stale on a re-pull. C-06
routed every real pull to `not_funding`; U-02 fell through to `unknown_path` and **sent no
delivery email at all**. Every test for both pre-seeded `outcome_tier` on the fake client
row, so the suite never exercised the real sequencing and stayed green over a dead branch.

Fix: the tier now rides on the `analysis.completed` payload as well
(`crs.mjs:mapToCanonical`), and both workflows read it via a new `resolveOutcomeTier(db,
clientId, payload)` that prefers the payload and falls back to the column. This is not a
guess about 05/30 — two in-repo consumers already assumed that payload shape:
`client-lifecycle.mjs:onAnalysisCompleted` reads `payload.outcomeTier` to fill
`crs_results.outcome_tier` (previously always null in production — a second bug this
closes), and `api/dashboard/seed.mjs` emits it. `crs.mjs` was the outlier. Regression
tests added for the null-column and stale-column cases.

Note that C-06 and U-02 are **correctly placed** under 05/30 — they fire on the CRS run
itself, which is now the on-call run. They were never dead; they were mis-plumbed.

**Flag — `ds-02-diy-letters`.** Trigger is `payment.received`, which is generic: the $32
diagnostic is itself a payment. If DS-02 can fire on a pre-call payment, `outcome_tier` is
null, `isFundingPath(null)` is false, and DIY letters go to someone who may turn out to be
a funding client. Needs the 05/30 doc to say which payment(s) reach DS-02.

**At risk — `ds-01-repair-referral`.** Trigger `call.completed` is after the on-call pull,
so the tier normally exists. But if a call ends without a pull having run, the tier is
null, `isFundingPath(null)` is false, and the repair referral proceeds for a client who
was never assessed. Fail-closed on the tier means fail-open on the referral here. Worth a
decision, not obviously wrong.

### Also drifted (not `outcome_tier` readers)

| Workflow / artifact | Trigger | Issue |
|---|---|---|
| `c-00-crs-soft-pull-request` | `diagnostic.paid` | **Structurally the heart of the drift.** This is the workflow that *requests* the pull at payment time, sets `crs_status: "Requested"` and `round_hold_reason: "Awaiting CRS"`. Under 05/30 the pull is initiated on the call. Whether `diagnostic.paid` still precedes the call at all is exactly what the 05/30 doc has to answer. **FLAG.** |
| `ai-set-04-3way-handoff` | `booking.created` | Sends `SMS-AISET04-HANDOFF` 15 min before the call: *"I've briefed your Senior Advisor on your UnderwriteIQ results and they're ready to review your {{contact.analyzer_prequal_amount}} pre-approval."* Under 05/30 no pull has run — the results don't exist and the claim is false. Copy needs rewriting, not just a merge tag. **FLAG (copy).** |
| `ai-set-03-no-answer-cadence` | `call.completed` (no-answer) | Same problem across all three messages: *"you've been pre-approved for {{contact.analyzer_prequal_amount}} in capital"*, *"we have your UnderwriteIQ results ready"*, *"Your pre-approval is still active"*. Fires precisely when the call did **not** connect, so under 05/30 no pull ran. **FLAG (copy).** |
| `dpc-01-analyzer-lock`, `u-03`, `u-04`, `u-05`, `c-02` | `analysis.completed` | Timing-shifted (they now run on-call rather than pre-call) but they read the event payload, not `outcome_tier`, so they are not dead. No change. |

**Adjacent bug, not fixed here (out of scope, needs its own pass).**
`analyzer_prequal_amount` has **no writer anywhere in the codebase** — `onDecisionRendered`
writes `total_funding_estimate` instead. Separately,
`render-template.mjs`'s `TOKEN_RE = /\{\{\s*(\w+)\s*\}\}/g` cannot match dotted tags
(`\w` excludes `.`), and every `sendTemplated` call site passes no `context`. So
`{{contact.analyzer_prequal_amount}}` and every other dotted tag currently renders
**literally, braces and all**, into outbound SMS and email. Both are model-independent and
predate this audit.

### Proposal — the BS series' correct trigger point

**Not shipped. Flagged for review.** `bs-01-precall-launcher` currently fires on
`booking.created` and routes by product path; under 05/30 the tier is null at that moment,
so the router falls straight through to `no_matching_path:null` and neither the funding nor
the repair drip ever sends. The whole BS series was built on the pre-call premise: a drip
that runs between booking and call, personalized by a recommendation that — under 05/30 —
does not exist until the call itself.

That leaves a genuine product question, not a mechanical one: **is a pre-call backend drip
still wanted at all, and if so, what is it allowed to say?** Three options, in the order I'd
recommend them:

1. **Split the workflow at the two moments (recommended).** Keep a `booking.created`
   trigger for the *unpersonalized* part — show-up reminders, logistics, social proof, the
   `bs:precall` tag and `bs_precall_start_ts` stamp, none of which need a tier. Move the
   personalized funding-vs-repair drip to a second workflow triggered on
   `decision.rendered`, where the tier is authoritative by construction. This preserves the
   pre-call touch cadence, keeps every personalized claim truthful, and needs no new events.
   Costs: the drip's copy has to be split into "before we know" and "after we know" halves,
   and the 5–6 template sequences need re-sequencing against a post-call start.
2. **Move BS-01 wholesale to `decision.rendered`.** Simplest change — one trigger line, no
   copy split. But it stops being a *pre-call* launcher entirely; the "72HR" framing of
   `BS-EMAIL-FUNDING-72HR` / `BS-EMAIL-REPAIR-72HR` becomes a post-call 72-hour window.
   That may actually be what 05/30 intends, and if so this is the right answer — but it is a
   business decision about when the backend sell happens, not a port fix.
3. **Keep `booking.created` and drop the personalization.** One generic drip, no path
   routing. Cheapest, and loses the reason the series existed.

Blocking questions for Chris, in priority order:
- Under 05/30, does anything at all send between `booking.created` and the call? (If no,
  BS-01 is retired outright rather than re-triggered, and options 1–3 collapse.)
- Is the 72-hour window in `BS-EMAIL-*-72HR` measured from booking or from the call?
- Does `diagnostic.paid` ($32) still fire before the call, or has it moved onto the call
  with the pull? This one also decides `c-00` and `ds-02` above.

The same three questions govern `BS-CLICK-FUND-01..06` / `BS-CLICK-REPAIR-01..06` (12
workflows, already BLOCKED below on a missing `content.engaged` event) — no point
specifying their trigger before the series' shape is settled.

---

---

## Full audit vs 05/30 — ranked findings

**Method.** Every one of the 47 ports was audited against the 05/30 doc by 9 family
auditors, producing 129 candidate findings. Each was then handed to an independent
adversarial verifier instructed to *refute* it: re-read the cited doc lines, re-read the
real code, check it wasn't already fixed, and check it didn't lean on a stale post-line-213
doc section that Part A supersedes.

**Result: 99 confirmed, 30 refuted, 2 ports clean.** Severity after verifier correction:
10 critical / 31 high / 33 medium / 25 low. 36 are mechanically unambiguous (✅) — the
rest need a decision. Finders over-called severity badly: 21 raw "critical" survived as 10.

Doc line numbers refer to the 05/30 upload. `Mech?` = ✅ means the fix is determined by
the doc with no business judgment.

| # | Sev | Workflow | Defect | 05/30 lines | One-line fix | Mech? |
|---|---|---|---|---|---|---|
| 1 | CRIT | `ai-set-03-no-answer-cadence` | All three no-answer SMS assert a pre-approval / UnderwriteIQ results that do not exist pre-call | 5, 15, 33, 43, 50, 53, 54, 55, 58, 152,  | Rewrite SMS-AISET03-MSG1/2/3 to reference only the booked appointment and the application answers, removing every pre-approval, UnderwriteIQ-results… | — |
| 2 | CRIT | `ai-set-04-3way-handoff` | T-15 handoff SMS claims UnderwriteIQ results and a dollar pre-approval that cannot exist before the call | 5, 15, 33, 48, 49, 50, 53, 54, 55, 58, 1 | Rewrite SMS-AISET04-HANDOFF (and the advisor task title) to frame the call as where the Advisor pulls credit live per doc 48-50, deleting every Under… | — |
| 3 | CRIT | `bs-01-precall-launcher` | Tier router runs at booking.created (Stage 3) but reads a Stage-4-only field — every real run exits with no drip | 5, 15, 33, 46, 58-61, 152, 210-211, 1278 | BS-01 cannot branch on a tier at booking time — either drop the router and run one pre-call drip for every booked contact (Stage 2's FICO + has_negat… | — |
| 4 | CRIT | `dpc-03-inbound-reply-router` | YES purchase-decision branch is permanently dead — gated on a flag nothing in the repo ever writes | 3583,3584,3585,3576,3577,3578,3558,3593, | Delete the dpc03_awaiting_decision gate (lines 48-51 and 74-77); disambiguate YES the way doc 3576-3578 does — evaluate the call-confirmation route f… | — |
| 5 | CRIT | `dpc-05-no-progress-escalation` | No client-type gate — escalation email AND SMS go out to leads who never became clients | 3652,3653,198,199,3658 | Gate on a client-type tag before any send — but note KEY DRIFT 3: Part A lines 78 and 83 replaced client:repair with client:repair-referral / client:… | — |
| 6 | CRIT | `ds-02-diy-letters` | DS-02 triggers on money already received, so it never invoices anyone and never fires for an unpaid DIY sale | 74,75,76,80,81,4526,4527,4529,4530,4531, | Trigger DS-02 off the Stage 5 Sales Outcome = "DIY Letters Purchased" signal, write cf_diy_status = Pending Payment, send the invoice, and gate deliv… | — |
| 7 | CRIT | `f-03-round-submitted` | F-03 gate reads a payload field no emitter ever sets — the round-submitted email/SMS can never send | 105,190,1650,1651,1653,1655,1656,1657,10 | Write clients.custom_fields.funding_round_number in the funding rounds loop and gate F-03 on that field (payload as fallback), instead of on a payloa… | — |
| 8 | CRIT | `f-06-funding-conditions-missing-docs` | F-06 missing-docs branch is dead: gate reads `conditionDescription`, which no mail.response emitter sets, and the docum… | 188,1718,1719,1721,1722,1724,1726,1727,1 | Trigger F-06 off a funding_condition_required flip (contact fields, schema 005:81/197) carrying the client id, not off mail.response payload keys Mai… | — |
| 9 | CRIT | `f-09-funding-declined-no-path` | Dead on the real event: nothing on a mail.response payload identifies the contact | 1792, 1933, 10705 | Have the Mailgun adapter resolve the client from the forwarding recipient and pass clientId to emit(), or read payload.contact_id in resolveClient —… | — |
| 10 | CRIT | `f-11-bank-email-event-router` | Dead on the real event: the router never resolves a contact and skips the documented recon task | 1933, 1935, 1936, 1937, 1938, 1939, 1940 | Resolve the contact from payload.contact_id (and have the Mailgun adapter pass clientId on emit), and create the F-11D Recon task instead of returnin… | — |
| 11 | HIGH | `ai-set-03-no-answer-cadence` | Fires on any unanswered Bland voice call, not just the setter's booking-confirmation dial | 48, 114, 115, 116, 117, 5310, 5314, 5332 | Gate the cadence on the client having a booking.created with no call held yet (and no ai:stop-contact tag) so only the setter's confirmation dial enr… | — |
| 12 | HIGH | `bc-01-customer-responsiveness` | crs_paid short-circuit collapses the two responsiveness paths, so every funding client scores Fast | 54, 55, 68, 667, 668, 669, 670, 672, 677 | Route on Round Hold Reason = Awaiting CRS first and check CRS Paid only on that branch; the docs branch must test the docs-missing signal alone. | ✅ |
| 13 | HIGH | `bs-01-precall-launcher` | GATE BS-01A is not implemented at all — no identity, no still-booked, no anti-re-entry check | 25, 1281-1293 | Add the GATE BS-01A pre-check before any tag/field/send and exit when it fails — every clause at lines 1284-1291, except the cf_analyzer_recommendati… | — |
| 14 | HIGH | `c-00-crs-soft-pull-request` | C-00 never actually requests the CRS pull — it only writes 'Requested' and stops | 56, 4019, 4020, 11665, 9182, 9183, 9184, | On the paid+consented branch, invoke the real CRS pull (the Stitch Credit / UnderwriteIQ entrypoint that feeds emitCrsResult) instead of only stampin… | — |
| 15 | HIGH | `c-00-crs-soft-pull-request` | No consent gate — C-00 proceeds to a soft pull with no cf_crs_softpull_consent and no charge amount | 3986, 3987, 4000, 4002, 4003, 4004, 54,  | Gate the request branch on custom_fields.crs_softpull_consent === 'Yes' AND crs_charge_amount not empty AND crs_paid === true, and add a step that wr… | — |
| 16 | HIGH | `c-00-crs-soft-pull-request` | C-00 has no unpaid/no-consent branch and no 'Pull CRS' entry point, so the invoice+consent half of the workflow does no… | 3986, 3987, 3988, 3989, 3990, 3991, 4007 | Add a second entry point for employee_next_action becoming 'Pull CRS' and an unpaid branch that sets crs_status='Pending Payment', round_hold_reason=… | — |
| 17 | HIGH | `c-02-inquiry-created` | C-02 fires at Stage 4 on the live call pull instead of between funding rounds, holding every new client | 4054, 4055, 4057, 4058, 4059, 4060, 1691 | Gate the handler on a funding product path AND a non-empty funding round number so it can only run between rounds (Stage 7), never on the Stage 4 cal… | — |
| 18 | HIGH | `c-02b-inquiry-removal-requested` | C-02B is built backwards: it writes the flag that in 05/30 is two hops UPSTREAM of C-02B, and fires it at the wrong sta… | 9256, 9259, 9262, 9263, 9279, 9280, 9281 | Stop writing run_inquiry_removal on deposit.paid; rebuild C-02B as the receiver of the advisor-initiated manual_inquiry_removal_requested event (per-… | — |
| 19 | HIGH | `c-06-crs-results-router` | C-06 has no DECLINE branch — hard declines silently fall through with no tag, no task and no decline email/SMS | 63, 64, 85, 86, 4204, 4205, 4209, 4210,  | Add a decline branch ahead of the funding/repair checks that tags hold:declined, sets the closed/stop next action, creates the decline task and sends… | — |
| 20 | HIGH | `c-06-crs-results-router` | C-06 FUNDING branch never fires the deliver-letters webhook with the funding letter set | 72, 73, 4914, 4915, 4917, 4919, 4922, 49 | On the funding branch, POST the existing deliver-letters webhook (reuse ds-02's DELIVER_LETTERS_URL helper) with the funding letter set and store the… | — |
| 21 | HIGH | `dpc-03-inbound-reply-router` | Invented 'no' keyword routes ordinary replies to close_file — closes files and strips nurture | 3559,3560,3558,3593,3548,3549 | Drop \|\bno\b from parseDecision (line 44) — match CLOSE only, per doc 3560. | ✅ |
| 22 | HIGH | `dpc-05-no-progress-escalation` | Trigger is a per-booking one-shot 72h sleep, not the daily scheduler sweep — the safety net is absent for Stages 6-10 | 3642,3643,3644,198,199,200,179 | Re-trigger DPC-05 as a daily scheduled sweep over all clients keyed on cf_last_progress_timestamp, not a per-booking one-shot sleep. | — |
| 23 | HIGH | `dpc-05-no-progress-escalation` | Progress test is 'anything since booking' + 'decision_status set', not 'last progress older than 72 hours' | 3649,3650,3651,3680,3681,155,179 | Escalate when cf_last_progress_timestamp is older than now-72h, and delete the decision_status short-circuit at line 27. | ✅ |
| 24 | HIGH | `ds-01-repair-referral` | DS-01 fires on any declined call disposition, including hard OFAC/fraud declines and Funding-Didn't-Buy | 74,75,76,77,78,79,85,86,161,162,4489,449 | Trigger DS-01 off the Stage 5 Sales Outcome = "Repair Referral Sent" signal, not off a declined call disposition. | — |
| 25 | HIGH | `ds-01-repair-referral` | The "never fires on the funding route" guard reads a tier that is always null at call.completed | 53,54,55,56,57,58,59,60,61,63,74,75,76,7 | Take the funding/repair split from the Stage 5 Sales Outcome signal that triggers DS-01, rather than from clients.outcome_tier, which is unwritten at… | — |
| 26 | HIGH | `ds-02-diy-letters` | Invoice amount comes from the payment payload with a $0 fallback instead of cf_diy_charge_amount default 1000 | 80,165,4531,5233 | Source the invoice amount from cf_diy_charge_amount with a 1000 default instead of from the payment payload's amount. | — |
| 27 | HIGH | `f-01-funding-intake` | F-01 is bound to round.started, so the one-time F1 intake re-runs on every funding round | 88,89,99,100,101,105,184,185,190,195,157 | Fire F-01 once per client on entry to funding (e.g. deposit.paid, as S-06 does) or guard round.started to the first round only. | — |
| 28 | HIGH | `f-02-portal-id-missing` | F-02 re-runs on every round.started and its exit condition can never be met | 90,92,93,99,105,184,185,188,190,195,1608 | Bind F-02 to one-time funding intake (not per-round round.started) and feed id_uploaded / portal_onboarding_status from a real source so the workflow… | — |
| 29 | HIGH | `f-05-inquiry-cleanup-gate` | F-05 flips inquiry_log rows instead of the Inquiry Status contact field, so the C-02 handoff never happens | 101,102,105,1701,1702,1704,1705,2140,214 | Have F-05 set clients.custom_fields.inquiry_status = "Pending Removal" (doc 1702) and make C-02 react to that transition, not only to analysis.comple… | — |
| 30 | HIGH | `f-06-funding-conditions-missing-docs` | F-06 writes Round Hold Reason to funding_rounds.hold_reason while C-02/C-03 use the contact field | 105,168,645,669,703,1726,1735,4065 | Set/clear clients.custom_fields.round_hold_reason ("Missing Documents"/null) as C-02 and C-03 do, instead of funding_rounds.hold_reason. | ✅ |
| 31 | HIGH | `f-09-funding-declined-no-path` | A single bank denial flags the whole file no-path when no application rows are tracked | 1792, 1852, 1853, 1854 | Invert the empty cases to fail closed (`return false` when there is no round or no application rows) so no-path is only declared on positive evidence… | — |
| 32 | HIGH | `f-11-bank-email-event-router` | MISSING_DOCS branch writes no Round Hold Reason and no Next Action | 168, 188, 1847, 1848, 1849 | In the MISSING_DOCS branch, set the latest round's hold_reason to 'Missing Documents' and employee_next_action to 'Collect Documents' (or drop F-06's… | — |
| 33 | HIGH | `n-04-post-funding-nurture` | Post-funding nurture fires once per funded round instead of once on F23 entry, and drops the client:funding gate | 121, 1123, 1124, 1125, 1127, 1128, 1129, | Have F-08 enroll N-04 once on F23 entry (or add a once-per-client guard plus the client:funding / Lifecycle Status = Funding Client gate) instead of… | — |
| 34 | HIGH | `n-06-renewal-second-wave` | Renewal wake-up check ignores Funding Locked Date and client:funding, and fans out one renewal per funded round | 110, 121, 1150, 1153, 1154, 1155, 1755 | At wake time gate on custom_fields.funding_locked_date being older than 6 months plus an active funding client, and dedupe so one client gets one ren… | — |
| 35 | HIGH | `s-01-new-lead-intake` | Identity gate (Email AND Phone) is not enforced anywhere on the S-series | 29,30,140,141,2385,2386,2387,2546,2547,2 | Gate handle() on the resolved client row having both a non-empty email and a non-empty phone before any state write, and apply the same check in s-04… | ✅ |
| 36 | HIGH | `s-04-call-booked` | S-04B never ported: booked leads get no confirmation email, no confirmation SMS, no reminders | 46,47,2597,2598,2599,2600,2601,2602,2603 | Port S-04B: on booking.created send the S-04 Appointment Confirmation email plus confirmation SMS, then a 24h-before email+SMS and a 1h-before SMS re… | — |
| 37 | HIGH | `s-04-call-booked` | AI-SET-01 setter confirm call missing — no port initiates the Josh call on booking | 45,46,47,48,49,50,209,210,211,5309,5310, | Add an AI-SET-01 port on booking.created that places the Josh confirm call using application answers only, never a score or pre-approval amount. | — |
| 38 | HIGH | `s-08-post-call-funding-declined` | Triggers on a raw Bland call disposition with no path gate — collides with S-09's population and double-fires with DS-01 | 56,57,58,59,60,61,152,153,159,160,161,16 | Gate S-08 on the funding path (isFundingPath(outcome_tier)) so a repair-path decline routes to S-09/DS-01 only — note the doc's 'OR Primary Snapshot… | — |
| 39 | HIGH | `sys-01-ltv-calculator` | Lifetime value sums capital funded to the client instead of repair paid plus commission earned | 3721, 3726, 3727, 3728, 3729, 5049, 5050 | Compute lifetime_value as repair_total_paid + funding_commission_earned rather than a running sum of fundedAmount. | — |
| 40 | HIGH | `u-02-analyzer-complete-delivery` | Repair branch ships the paid DIY repair deliverable for free on the CRS return, with no payment gate | 77,78,79,80,81,83,84,1233,1234,1235,437, | Delete the repair branch from U-02 — repair letters ship only from DS-02 behind the cf_diy_paid gate (doc 80-84). | — |
| 41 | HIGH | `u-02-analyzer-complete-delivery` | Funding letter-pack delivery fires at Stage 4 on the raw CRS return, before the close and the $3,000 deposit | 66,67,68,69,72,73,53,54,55,56,57,58,59,6 | Move the funding letter-pack delivery out of U-02's analysis.completed trigger onto the C-06 FUNDING paid branch (doc 72-73). | — |
| 42 | MEDI | `bc-01-customer-responsiveness` | BC-01 triggers on round.started instead of the docs:missing / ops:action-required signals it is supposed to time | 647, 648, 649, 651, 652, 653, 675, 732 | Trigger BC-01 off the docs:missing / ops:action-required signals (with the Awaiting-CRS hold check) and exit when neither condition is present, rathe… | ✅ |
| 43 | MEDI | `bc-02-customer-friction` | BC-02 triggers on round.started instead of the four escalation tags, so friction is only ever sampled at round start | 752, 753, 754, 755, 756, 757, 759 | Trigger BC-02 on the four tag-added signals (call:no_show, docs:missing, ops:action-required, ar:collections) instead of round.started. | — |
| 44 | MEDI | `bc-02-customer-friction` | call:no_show is missing from the friction priority router, so no-shows score Low instead of High | 754, 787, 788, 792, 793, 794, 795, 821,  | Insert call:no_show as a High-friction condition immediately after ar:collections in classifyFriction(). | ✅ |
| 45 | MEDI | `bc-03-primary-motivation (MISSING — no such file exists)` | BC-03 Primary Motivation is fully specified in 05/30 but has no port at all | 129, 130, 828, 838, 839, 840, 841, 842,  | Port BC-03 off message.inbound plus the post-CRS signals, with the empty-only gate and the five keyword branches; the Analyzer-Path fallback (doc 897… | — |
| 46 | MEDI | `c-03-inquiry-removed-resume-or-hold` | C-03 resume branch never clears Round Hold Reason, leaving the client ready-for-next-round while still hold-flagged | 4108, 4109, 4110, 4112, 105, 168 | On the resume branch, clear round_hold_reason (set to null/empty) alongside the ready_for_next_round write. | ✅ |
| 47 | MEDI | `c-03-inquiry-removed-resume-or-hold` | C-03 fraud branch tags fraud:alert-present instead of ops:action-required and never writes Ready For Next Round = No | 4098, 4099, 4100, 4101, 4757, 5054, 757 | Add ops:action-required alongside fraud:alert-present on the fraud branch and write ready_for_next_round=false there. | ✅ |
| 48 | MEDI | `dpc-03-inbound-reply-router` | CALL CONFIRMATION route missing entirely — cf_call_confirmed is never written anywhere in the repo | 3576,3577,3578,3579,3580,3581,3583,3590, | Add the CALL CONFIRMATION route ahead of the YES route: when cf_call_outcome='booked' and the body confirms attendance, set call_confirmed=true plus… | — |
| 49 | MEDI | `dpc-03-inbound-reply-router` | close_file moves the opportunity to the Downsell stage instead of a closed stage | 3622,3623,77,78,79,83 | Move close_file to a closed/lost sales stage — the seed has 'lost' and no S5 Closed row, so the target stage needs Chris's call. | — |
| 50 | MEDI | `dpc-03-inbound-reply-router` | DPC-04 merged in without its hard-stop gate — a fraud/collections contact can still trigger the contract+payment task | 3608,3609,3610,3611,154 | Gate the YES and RESCHEDULE routes on custom_fields.hard_stop_reason being empty, letting close_file through regardless (doc 3610-3611). | ✅ |
| 51 | MEDI | `dpc-05-no-progress-escalation` | Cooldown tag is written but never checked before escalating | 3654,3655,3682,199 | Read the client's tags and exit when dpc:no-progress-escalated is already present, before the task and the two sends. | ✅ |
| 52 | MEDI | `ds-01-repair-referral` | No opportunity move to Sales S5 Closed (Referred) | 77,78,4507,4508 | Add a moveCardToStage to the sales pipeline's Closed (Referred) stage — the stage does not exist in db/seed/002_pipelines.sql:27-28 and doc 4507-4508… | — |
| 53 | MEDI | `ds-02-diy-letters` | cf_diy_status is written with values that are not in the dropdown option set | 83,164,4529,4538,4547,5235 | Restrict cf_diy_status writes to Pending Payment -> Paid -> Fulfilled and drop the invented Processing/Delivered/Delivery Failed values. | — |
| 54 | MEDI | `ds-02-diy-letters` | No opportunity move to Sales S5 Closed (Fulfilled) | 83,4549 | Add a moveCardToStage to the sales pipeline's Closed (Fulfilled) stage — note the seeded sales pipeline has no such stage (db/seed/002_pipelines.sql:… | — |
| 55 | MEDI | `f-01-funding-intake` | F-01 gates on outcome_tier (the CRS recommendation) instead of Product Path | 144,152,174,175,186,187,1582,1583 | Gate F-01 on clients.custom_fields.product_path === "Funding" (doc 1583), not on outcome_tier/isFundingPath. | — |
| 56 | MEDI | `f-02-portal-id-missing` | F-02 follow-up sends email only; the doc requires email AND SMS | 1622,1623,1625,1626,1628,1629 | Add an SMS follow-up send alongside the follow-up email in the still-missing branch. | ✅ |
| 57 | MEDI | `f-04-round-approvals` | F-04's approvals copy ships a literal {{custom_fields.funding_round_number}} — the round number is never written or int… | 105,195,1679,1680,1682,1683 | Populate clients.custom_fields.funding_round_number in the rounds loop and pass it through sendTemplated's context (or use a token renderTemplate can… | — |
| 58 | MEDI | `f-07-funding-locked` | Fee Locked lock does not exist: Funding Fee Locked is never written and never enforced | 108, 110, 169, 176, 177, 382 | In the fee-ready branch, read funding_fee_locked first — if true, use the stored funding_fee_percent and never the payload's; otherwise write {fundin… | — |
| 59 | MEDI | `f-09-funding-declined-no-path` | Employee Next Action = Review Funding File is never set | 194 | Add mergeCustomFields(db, clientId, { employee_next_action: 'Review Funding File' }) alongside the hold-reason step. | ✅ |
| 60 | MEDI | `f-10-client-funding-inbox-provisioner` | The provisioning webhook was dropped, so the forwarding address the client is told to use is never created | 1821, 2068 | Add an outbound provisioning call (adapter or HTTP step) before the field write, or hold the F-10 email until provisioning is confirmed. | — |
| 61 | MEDI | `f-11-bank-email-event-router` | ACTION_REQUIRED branch writes no Round Hold Reason and no Next Action | 168, 194, 1856, 1857, 1858, 1859 | In the ACTION_REQUIRED branch, set the latest round's hold_reason to 'Internal Review' and employee_next_action to 'Review Funding File'. | ✅ |
| 62 | MEDI | `n-01-cold-nurture` | N-series SMS copy now exists in 05/30 but every N-workflow still treats it as missing, so no nurture SMS ever sends | 1043, 1070, 1095, 1121, 1148, 1246, 1248 | Seed the five N-series SMS openers verbatim from doc 1249-1262 (and decide whether they run as one-shot sends or as Agent 3 openers) so the nurture s… | — |
| 63 | MEDI | `s-01-new-lead-intake` | S-01 fires at Stage 0 (entry.captured) instead of Stage 1 | 21,22,23,24,25,26,28,29,30,31,32,33,34,2 | Change the S-01 trigger from { event: "entry.captured" } to { event: "survey.submitted" } (Stage 1 on the spine). | ✅ |
| 64 | MEDI | `s-04-call-booked` | Stage 2 two-gate survey qualification is implemented nowhere in the codebase | 36,37,38,39,40,41,42,43,146,147,206,207 | Add a Stage-2 gate between survey.submitted and booking that requires cf_svy_self_reported_fico in {700-749, 750+} AND cf_svy_has_negatives = No, rou… | — |
| 65 | MEDI | `s-06-post-call-funding-purchased` | None of the four paid-outcome gates are implemented | 68,69,70,71,160,161,162,2785,2786,2787,2 | Add the four gate reads (sales_outcome === 'Funding Purchased', contract_funding_signed, crs_paid, funding_fee_percent not empty) on top of the depos… | — |
| 66 | MEDI | `s-06-post-call-funding-purchased` | Missing 'If Missing Required Fields' failure branch | 2806,2807,2808,2809 | On gate failure add tag ops:action-required and create a 'Fix missing funding gates.' task, reusing the pattern already in f-01-funding-intake.mjs:57… | ✅ |
| 67 | MEDI | `s-08-post-call-funding-declined` | Opportunity is never moved to S5 Closed | 77,78,79,81,82,83,2865,2866,2867 | Add a moveCardToStage on the sales pipeline to the stage that represents S5 Closed — db/seed/002_pipelines.sql seeds no 'S5 Closed' key, so which of… | — |
| 68 | MEDI | `s-08-post-call-funding-declined` | No 'Funding Didn't Buy' follow-up sequence, and the task carries no 24h due date | 2869,2870,2871 | Set the task due_at to +24h with the doc's title and start the 'Funding Didn't Buy' follow-up sequence — blocked on Chris supplying the follow-up cop… | — |
| 69 | MEDI | `sys-01-client-value-calculator` | Prequal fallback branch omits the Funding Fee Percent multiplication, overstating client value by ~10x | 3689, 3690, 3691, 3692, 3704, 3705, 3706 | Multiply the prequal/estimate fallback by feePercent/100 the same way the approved-amount branch does. | ✅ |
| 70 | MEDI | `sys-01-client-value-calculator` | Writes custom field potential_value; the documented field is cf_potential_commission | 3706, 3710, 3714, 5046 | Rename the written custom field from potential_value to potential_commission to match cf_potential_commission. | ✅ |
| 71 | MEDI | `sys-01-client-value-calculator` | Single round.approved trigger leaves the prequal fallback unreachable and never recomputes on fee-percent change | 33, 58, 3694, 3695, 3696, 3697, 3698, 37 | Also trigger SYS-01 on decision.rendered (prequal set) and on the fee-percent write so both documented recompute paths actually run. | — |
| 72 | MEDI | `sys-01-ltv-calculator` | LTV accumulates on round.funded rather than on payment received | 123, 3720, 3721, 3723, 3724, 3752 | Trigger SYS-01-LTV on payment.received / invoice.paid instead of round.funded. | — |
| 73 | MEDI | `u-03-crs-snapshot-sync` | Syncs only the FICO score — utilization, inquiries, negatives and late payments are never written | 540,541,542,543,544,545,546,547,548,4962 | Write crs_utilization_percent and crs_inquiries_ex/eq/tu from the payload's `utilization` and `newInquiries` in the same mergeCustomFields call (doc… | — |
| 74 | MEDI | `u-04-promote-crs-primary` | Promotes only Primary FICO Score — the other four Primary Snapshot fields are never copied, and a partial pull can null… | 593,596,600,605,609,613,563,4951,4952,49 | Copy all five CRS metrics into the Primary fields, and skip (not null) any metric absent from the payload (doc 596-613). | ✅ |
| 75 | LOW | `at-01-first-touch-capture` | First Touch URL and UTM fields are never captured | 23, 24, 953, 954, 955, 956, 958, 959, 96 | Write first_touch_url and the five utm_* fields from the entry payload inside the same once-only gate, skipping any that are absent. | — |
| 76 | LOW | `bc-01-customer-responsiveness` | Global identity gate (Email + Phone) is missing from both behavioral classifiers | 140, 141, 656, 657, 658, 659, 660, 663,  | Exit both BC-01 and BC-02 before scoring when the client's email or phone is empty. | ✅ |
| 77 | LOW | `c-00-crs-soft-pull-request` | C-00 writes Round Hold Reason = 'Awaiting CRS' on the PAID branch, where the doc puts it only on the unpaid branch | 4007, 4009, 4013, 4014, 4015 | Drop round_hold_reason from the paid-branch write and set it only on the unpaid/no-consent branch. | — |
| 78 | LOW | `c-02-inquiry-created` | C-02 never writes Ready For Next Round = No | 4064, 4065, 4066, 105, 4137 | Add ready_for_next_round: false to the mergeCustomFields call. | ✅ |
| 79 | LOW | `c-02-inquiry-created` | C-02 task title drops the funding round number | 4070, 4071, 4983, 105 | Interpolate the client's funding_round_number into the task title. | — |
| 80 | LOW | `c-03-inquiry-removed-resume-or-hold` | C-03 resume branch removes inquiry:pending but leaves ops:action-required set | 4113, 4115, 4116, 757, 4778 | Add "ops:action-required" to the removeTags call on the resume branch. | ✅ |
| 81 | LOW | `c-03-inquiry-removed-resume-or-hold` | C-03 never stamps the Inquiry Cleanup Date on the resume branch | 4111, 4996, 17, 18 | Add last_inquiry_cleanup_date: new Date().toISOString() to the resume-branch mergeCustomFields call. | ✅ |
| 82 | LOW | `c-05-pre-funding-review` | C-05 omits the Product Path = Funding gate | 4168, 4169, 4170, 4171, 88 | Add an isFundingPath(outcome tier) gate before the CRS-status check, matching f-01-funding-intake.mjs. | ✅ |
| 83 | LOW | `dpc-03-inbound-reply-router` | YES moves the opportunity to Closed Won (deposit) off an SMS, before any deposit exists | 3613,3614,3615,3616,3622,3623,66,67,68,6 | Drop the closed_won move from the YES branch and leave the sales stage to S-06 on the paid outcome (doc 3614-3616, Part A 68-71). | — |
| 84 | LOW | `ds-01-repair-referral` | Missing the Has Email gate — SMS, tag and Product Path fire for contacts with no email | 4492,4493,4494,4495,4505,4506,4507,4508 | Wrap the entire body in an "email is not empty" guard and no-op the whole workflow when it is empty. | ✅ |
| 85 | LOW | `f-02-portal-id-missing` | F-02 completion path never writes Last Progress Timestamp, so DPC-05 still escalates a client who finished onboarding | 155,198,199,200,1631,1632,1633,1634 | Include `last_progress_timestamp: new Date().toISOString()` in the docs_uploaded merge at f-02:54. | ✅ |
| 86 | LOW | `f-06-funding-conditions-missing-docs` | F-06 never clears Funding Condition Required on docs.received | 1718,1719,1732,1733,1734,1735 | Add `funding_condition_required: false` to the docs.received branch's custom-field merge. | ✅ |
| 87 | LOW | `f-07-funding-locked` | Funding Locked Date is written as null instead of today | 110, 1154, 1755 | Default to now: `funding_locked_date: event.payload?.lockedAt \|\| new Date().toISOString()`. | ✅ |
| 88 | LOW | `f-07-funding-locked` | last_progress_action written without its paired timestamp | 155, 179, 1762 | Write last_progress_timestamp: new Date().toISOString() in the same mergeCustomFields call at line 85. | ✅ |
| 89 | LOW | `f-07-funding-locked` | Header comment claims the fee calculation was deliberately not ported, but the code does calculate and invoice it | 1757 | Delete the 'DELIBERATELY NOT PORTED' paragraph and keep only the FLAG at lines 67-69 describing the approvedAmount assumption. | ✅ |
| 90 | LOW | `f-10-client-funding-inbox-provisioner` | Forwarding address hardcodes the branded domain where the doc specifies a neutral one | 1886, 1887 | Move the domain to config (env var) and have Chris confirm the neutral inbound domain instead of hardcoding fundhub.ai. | — |
| 91 | LOW | `s-02-incomplete-survey-nudge` | Tag semantics inverted — S-02 writes survey:complete and never writes survey:incomplete | 2492,2493,2494,2495,2496,2501,2502,2503, | Drop the survey:complete write at line 36 (exit only) and add tag survey:incomplete on the nudge branch before sending. | ✅ |
| 92 | LOW | `s-02-incomplete-survey-nudge` | Missing 'Lead Magnet Type is Survey' gate | 23,24,26,2486,2487,2488,2489,2490 | Add a lead_magnet_type === "Survey" gate before the wait — which first requires AT-01 to stop hardcoding the value at at-01-first-touch-capture.mjs:2… | — |
| 93 | LOW | `s-02-incomplete-survey-nudge` | Wait shape wrong: one 20-minute sleep instead of 2 min + pre-check + 30 min + re-check | 2483,2484,2492,2493,2494,2495,2496,2498, | Replace the single 20m sleep with 2m sleep -> completion check (exit if complete) -> 30m sleep -> re-check. | ✅ |
| 94 | LOW | `s-04-call-booked` | S-04 does not write cf_last_progress_action / cf_last_progress_timestamp | 155,197,198,199,200,5417,5418 | Add last_progress_action: "call_booked" and last_progress_timestamp to the mergeCustomFields call at s-04-call-booked.mjs:20. | ✅ |
| 95 | LOW | `s-06-post-call-funding-purchased` | Funding opportunity at F1 is never created | 68,69,70,71,2795,2796,2797 | Add moveCardToStage(db, { orgId, clientId, pipelineKey: "funding_card_stacking", stageKey: "apply_now" }) to S-06. | — |
| 96 | LOW | `s-06-post-call-funding-purchased` | Intake task title does not match the doc | 70,71,2802,2803,2804 | Change the task title at s-06-post-call-funding-purchased.mjs:25 to 'Funding intake — confirm CRS + start onboarding.' | — |
| 97 | LOW | `s-08-post-call-funding-declined` | S-08 does not set the last progress timestamp | 155,197,198,199,200,2865,2872 | Add a mergeCustomFields write of last_progress_action and last_progress_timestamp alongside the tag in S-08. | ✅ |
| 98 | LOW | `u-02-analyzer-complete-delivery` | Identity-missing branch writes U-05's tag instead of its own, and the task title does not match the doc | 520,521,522,11961,11967 | Tag `analyzer:payload-missing-identity` on U-02's identity-missing branch and title the task 'ERROR — Missing Identity (Investigate Payload)' (doc 52… | ✅ |
| 99 | LOW | `u-04-promote-crs-primary` | Never adds the primary:crs tag | 619,620,621,623,624,625 | Add `addTags(db, clientId, ['primary:crs'])` alongside the existing untag (doc 619-621). | ✅ |


### Refuted — do not re-raise

These read plausibly and were killed on inspection. Recorded so they don't come back.

| Workflow | Claim | Why it was killed |
|---|---|---|
| `bs-01-precall-launcher` | REPAIR_TEMPLATES implements BS-EMAIL-REPAIR-72HR, which 05/30 marks DECOMMISSIONED | Killed on gates 2, 3, 5 and 6. (1) The harm assertion is false: BS-01 fires on booking.created, but clients.outcome_tier is written by exactly one handler on decision.rendered (client-lifecycle.mjs:146), so th… |
| `bs-01-precall-launcher` | No mid-drip re-check and no exit path — the drip keeps emailing after the call, decision, or h… | KILLED on check 4 (stale post-213 premise), with check 2's stated consequence also false.  CITATIONS ARE CLEAN. All four verify verbatim: 1381-1386 = the three BS-ADS EXIT triggers (cf_call_outcome / cf_decisi… |
| `bs-01-precall-launcher` | cf_bs_precall_status is never written — only the start timestamp is stamped | Citations are accurate (steps 1-3 pass): doc 1298 does say "SET → cf_bs_precall_status = active", 5116-5117 define the field as SINGLE_OPTIONS none/active/ended, and bs-01-precall-launcher.mjs:45-46 really doe… |
| `bs-01-precall-launcher` | BS-TASKS and BS-ADS are never enrolled — two of BS-01's five launch actions are missing entire… | Citations are accurate (step 1 passes): doc 1300-1301 do list BS-TASKS and BS-ADS as YES-path actions 4-5, BS-ADS is mapped 1317-1406 with exit/cleanup 1379-1406 and the deferred webhook at exactly 1399, and B… |
| `bs-01-precall-launcher` | BS-01 adds the call:booked tag itself — that is its own trigger, and S-04 already writes it | Citations are accurate (only nit: the "State written" bullet is line 51, not 52), but the claimed PORT BEHAVIOR is false on both asserted harms, failing verification step 2.  1) NO RE-ENTRY LOOP. The claim's c… |
| `s-02-incomplete-survey-nudge` | S-02 triggers on entry.captured, not on the lead:new tag written at Stage 1 | Citations are accurate (doc 26, 34, 2480-2481, 2493-2494 all say what is claimed), and the port does register { event: "entry.captured" } at s-02-incomplete-survey-nudge.mjs:48. But the claimed behavioral cons… |
| `c-00-crs-soft-pull-request` | C-00 overwrites Analyzer Path unconditionally instead of writing it only when blank | Citations are accurate (step 1 passes): line 4015 verbatim reads "SET C-00Y1 — Analyzer Path = Funding (only if blank)" and 4200-4201 read "GATE C-06A — Funding path only / AND: Analyzer Path = Funding". The l… |
| `ds-02-diy-letters` | deliver-letters POST carries no letter-set selector, so the repair set (12 fields) is indistin… | REFUTED on three independent grounds.  (1) The doc does not specify a payload to drift from. The claim's own citation, doc 4540-4541, reads: "URL: [DELIVER-LETTERS WEBHOOK URL] — Darwin will give you this. Thi… |
| `u-02-analyzer-complete-delivery` | Both delivery branches drop the 'Letters Ready = TRUE' and 'Delivery Not Sent' preconditions,… | Killed at step 4 (stale-section rule); would also fail steps 5 and 6.  STEP 1 — citations PASS. All verified verbatim: 497-502 = Repair conditions (Analyzer Path = Repair / Repair Letters Ready = TRUE / Repair… |
| `u-05-data-health-monitor` | Runs on every analysis.completed with no analyzer:complete / Analyzer Status gate, so it silen… | Citations check out (step 1 passes) but the claim dies on steps 2, 4 and 6.  STEP 1 — PASS. Every cited line is verbatim. 11950-11952 = "Triggers / Tag Added: analyzer:complete / Daily Recurring Check". 11955… |
| `u-05-data-health-monitor` | Health check validates the wrong fields — the recommendation C-06 branches on is never checked | REFUTED at steps 1, 2 and 3.  STEP 1 (citations, partial fabrication): Doc 11957-11963 is verbatim exact ("YES PATH — DATA VALIDATION / If Analyzer Path is missing / OR Credit Suggestions are missing" -> add t… |
| `u-02-analyzer-complete-delivery` | Step 2 field mapping is reduced to analyzer_status — analyzer_path, last-run date and credit s… | KILLED on four independent grounds.  (1) STALE SECTION (verification rule 4 — decisive). Doc line 456 sits inside the post-213 per-workflow block "UNDERWRITEIQ WORKFLOWS / PHASE 2 — ANALYZER COMPLETE -> MAP DA… |
| `u-05-data-health-monitor` | Missing the Daily Recurring Check trigger — health is only ever evaluated at the instant of th… | Citation and port behavior both check out (doc 11950-11952 really do list two triggers; u-05-data-health-monitor.mjs:47-51 really does register only { event: 'analysis.completed' }, and there is no cron anywhe… |
| `u-04-promote-crs-primary` | The Analyzer half of the Primary Snapshot Rule is dead code — nothing can ever set Analyzer as… | REFUTED at step 2 — the port already matches the doc verbatim, so there is no divergence to fix.  Citations do check out (step 1): line 174 = "Primary Snapshot Rule: before CRS, source is Analyzer; after CRS c… |
| `dpc-02-call-outcome-enforcement` | Path C missing — rescheduled/canceled appointments get force-marked no_show and dropped to Lost | Citations are clean (doc 3538-3539 and 149 say exactly what is claimed, and the Part A / post-213 staleness handling is honest), but the finding dies on the port-behavior check. The claimed mechanism does not… |
| `dpc-01-analyzer-lock` | DPC-01 never writes the recommendation it exists to lock | KILLED on step 4 (stale section, unacknowledged) with an independent kill from the repo's own migration table.  Citations are accurate (step 1 passes): 3502-3504 read verbatim "Actions / Set cf_analyzer_recomm… |
| `dpc-05-no-progress-escalation` | No hard-stop exclusion — closed/collections contacts still get the escalation email and SMS | Citations are accurate (steps 1 and 4 pass), but the claim dies on step 2: the port does not behave as claimed.  STEP 1 - PASS. Doc line 179 reads verbatim "72-hour pressure: no progress for 72 hours and not h… |
| `dpc-03-inbound-reply-router` | Inbound EMAIL replies can never resolve a client — phone-only lookup | Citations are genuine (3551-3553 "Trigger / ● Incoming SMS / ● Incoming Email", 3556 "Email OR Phone must exist"), and line 69 of the port does resolve via findClientByPhone. The claim still dies on three inde… |
| `dpc-03-inbound-reply-router` | YES branch does not remove nurture tags | Citation is accurate (doc 3583-3590 does list '● Remove nurtures' under D) YES) and the port literally omits removeTags in the YES branch (lines 83-88) while calling it in close_file (line 101). But the findin… |
| `dpc-01-analyzer-lock` | None of DPC-01's gate conditions are implemented — no email/phone identity gate | Citations check out (3495-3500 verbatim; Part A identity gate at 29-30, claim cited 30-31 — off by one but not fabricated) and the port genuinely lacks a phone check (dpc-01-analyzer-lock.mjs:11-12; resolveCli… |
| `dpc-02-call-outcome-enforcement` | No-show cards land in Lost — the seed has no distinct S4 No Show stage | Killed on steps 2, 3, and 4. (1) Citations are accurate — 3529/3533/3541-3542/180 read as quoted — but the claim misreads their consequence. The claim's central harm ("no-show rate cannot be graphed") is refut… |
| `f-07-funding-locked` | No hand-off to AR: no invoice opportunity created and Invoice Status is never set to Sent | Citations are accurate (doc 108-110, 171, 1760 say what is claimed, and 110 is inside the current-truth Part A region), but the claim fails on the code. It asserts "no invoice opportunity created" and that "th… |
| `f-07-funding-locked` | Balance Due is never written, so the balance-driven AR stage can never start | Citations are accurate (check 1 passes): doc lines 108-110, 113, 178 and 1757 say exactly what is quoted, and 108-113/178 sit in Part A (pre-213), so check 4 passes too. The finding dies on checks 2 and 5.  KI… |
| `f-08-post-funding-monitoring` | Documented client:funding gate is missing | Citations are accurate (line 121 = F-08 starts N-04; lines 1776-1777 = "Gate / Contact Tag client:funding is present"), and f-08-post-funding-monitoring.mjs:30-35 genuinely has no tag gate. But the omission is… |
| `f-09-funding-declined-no-path` | Gate reads the CRS outcome tier instead of Product Path | Citations are accurate (doc 144, 152, 1795 read as quoted), but the drift does not survive steps 2 and 3.  (1) The claimed failure scenario is unreachable. `custom_fields.product_path` has exactly two writers… |
| `f-10-client-funding-inbox-provisioner` | cf_inbox_forwarding_verified is written false and nothing can ever flip it true | Citations are accurate (1888-1893, 1896-1909, 2069 all verbatim) and the code facts are accurate (line 53 writes false; no F-10R handler; grep confirms the flag appears exactly once in src/). It still fails as… |
| `f-10-client-funding-inbox-provisioner` | F-10 email and SMS templates are never seeded, so both sends are silent no-ops | Citations are genuine and the mechanics are described correctly, but this is not drift from the 05/30 doc. The port implements both send steps exactly as the doc's action list (lines 1823-1824) requires; what… |
| `n-03-hot-nurture` | Hot nurture fires on booking.created / call.completed — exactly the leads nurture is supposed… | Citations are verbatim-accurate and the port behaves as described, but the claim dies on checks 3 and 4.  CHECK 3 (fatal): This is a re-report of the explicitly-listed already-fixed item. The claim's entire su… |
| `ai-set-03-no-answer-cadence` | No-answer cadence compressed to 2.5 hours instead of the documented Min 7 / Hour 4 / Day 2 spa… | Killed on step 4 (stale section), with a secondary defect in the fix instruction.  CITATION (step 1) IS CLEAN: doc lines 5332-5337 read exactly as quoted. PORT BEHAVIOR (step 2) IS AS DESCRIBED: ai-set-03-no-a… |
| `af-02-referral-ownership-capture` | AF-02 writes first_touch_date, which is not in its documented action set and can stamp a Stage… | Doc citations are accurate (check 1 passes): 3130-3133 list only the two owner fields as AF-02's actions, 3127 has First Touch Date only in the gate, 943-946 give the write to AT-01, and Part A 23-26 agrees ra… |


### Fixed in this pass

Per Chris's scoping: only **dead code** (cannot fire under 05/30) and **wrong-firing**
(fires when it shouldn't, or writes the wrong value) were repaired. Everything else is
logged above for Darwin to sequence.

| Workflow | What was wrong | Category |
|---|---|---|
| `src/adapters/mailgun.mjs` | `mail.response` carried nothing identifying a contact, so **F-06, F-09 and F-11 were all dead on the real event** — every one exited `no_client`. Now resolves the client from F-10's `monitor+<clientId>@` forwarding address (with a `funding_email_forwarding_address` fallback) and passes it on emit. | dead |
| `dpc-03-inbound-reply-router` | YES purchase branch was gated on `dpc03_awaiting_decision`, **a field nothing in the repo ever writes** — permanently unreachable. Replaced with the doc's call-state disambiguation (3576-3578): YES while `call_outcome = booked` is a call confirmation, otherwise the purchase decision. | dead |
| `dpc-03-inbound-reply-router` | Invented bare `no` keyword routed *"no thanks" / "no worries" / "not today"* to `close_file`, closing files and stripping nurture. Doc 3560 lists CLOSE only. | wrong-firing |
| `dpc-03-inbound-reply-router` | DPC-04's contract+payment task had no hard-stop gate — a fraud/collections contact could trigger it off an SMS. | wrong-firing |
| `dpc-05-no-progress-escalation` | **No client-type gate: escalation email AND SMS went to leads who never became clients.** Now gates on the Part A client tags before any send. | wrong-firing |
| `dpc-05-no-progress-escalation` | Progress test was "anything since booking" plus a `decision_status` short-circuit, not the doc's sliding "last progress older than 72h" (178-179). A client who did one thing after booking then vanished for weeks never escalated. | wrong-firing |
| `u-02-analyzer-complete-delivery` | **Repair branch emailed the paid $1,000 DIY letter pack for free** on the CRS return, with no payment gate. Doc 79-84: repair letters ship only from DS-02 behind `cf_diy_paid`. Branch now tags and routes only. | wrong-firing |
| `ds-01-repair-referral` | Fired on **any** declined disposition — including hard OFAC/fraud declines (which doc 84-86 routes to C-06's DECLINE branch) and "Funding Didn't Buy". Now requires an explicit repair-referral signal and excludes hard declines. Also added the missing email+phone identity gate before the SMS. | wrong-firing |
| `bc-01-customer-responsiveness` | `crs_paid` was tested first on **both** paths; every funding client pays the diagnostic, so the docs path was unreachable and **every funding client scored Fast**. Now routes on Round Hold Reason per GATE BC-01B (667-672). | wrong-firing |
| `bc-02-customer-friction` | `call:no_show` was missing from the priority router, so no-shows scored **Low** instead of High (doc 787-794). | wrong-firing |
| `f-06-funding-conditions-missing-docs` | Wrote Round Hold Reason to `funding_rounds.hold_reason` while C-02/C-03 read the **contact** field (184-190), so nothing downstream ever saw F-06's hold. Also now clears `funding_condition_required` on docs.received (1832). | wrong-firing |
| `sys-01-client-value-calculator` | Prequal fallback omitted the fee-percent multiply, **overstating client value ~10×**; and wrote `potential_value` instead of the doc's `cf_potential_commission` (3704-3714, 5046). | wrong-firing |
| `c-06-crs-results-router` | No DECLINE branch at all. Now wired end to end behind a **DEFERRED no-op detector** — see BLOCKED above. | dead |

Every fix ships with a regression test that asserts the *old* behaviour is gone. That
matters here: the audit's central lesson is that the existing tests pre-seeded state which
masked the bugs — BS-01's suite passed for a workflow that never sends an email.

**Not fixed, by instruction:** BS-01's trigger (business decision), C-00 (blocked on the
`diagnostic.paid` question), and the AI-SET-03/04 SMS copy (a rewrite Chris or the copy
agent owns). All three are in the ranked table above.


### MISSING — specified in 05/30, never ported

Not drift. These were never built, so there is nothing to correct — they are unported
work and need sequencing as new builds.

| Key | What 05/30 specifies | Doc lines | What it needs |
|---|---|---|---|
| **S-04B** | The booking confirmation leg: confirmation email, confirmation SMS, and reminders, fired alongside S-04 on booking. Booked leads currently receive **nothing** between booking and the call. | 46 | Confirmation + reminder templates (none seeded), and a decision on reminder offsets — the doc gives the leg, not the timings. |
| **AI-SET-01** | Josh setter **voice** call, fires immediately on booking to confirm attendance and frame the call as *"where the Advisor pulls credit live."* Josh *"has only the application answers, never a score or approval."* | 45–50 | A Bland outbound dial on `booking.created` (adapter exists: `src/adapters/bland.mjs`), plus the agent script. Note AI-SET-03 is the *no-answer* follow-up to this call and currently fires off any unanswered Bland call because this one was never built. |
| **BC-03 Primary Motivation** | Third behavioral classifier feeding agent tone, alongside BC-01/BC-02. Five keyword branches (Speed / Relief / Growth / Certainty / Control) with an Analyzer-Path fallback, gated to write only when the field is empty. | 129–130, 828–910 | Keyword source — the doc's branches key off inbound reply text; the port has no inbound-text corpus wired to a classifier. |

### BLOCKED — external dependency

| Key | Blocked on | Who owes it | Built anyway |
|---|---|---|---|
| **Stage 2 survey qualification gate** | `cf_svy_has_negatives` field key — doc line 206: *"pending from DirectROAS. The Stage 2 gate is not enforceable until it exists."* | DirectROAS | Yes, fully. `src/config/survey-qualification.mjs` implements all three outcomes; the FICO half is complete today. **Absent negatives field → `MANUAL_REVIEW`**, never pass and never fail — missing input means a human looks. Failing open sends unqualified people to a call; failing closed sends qualified people to the downsell. A test asserts the absent case, so the gate starts working the day the key ships. |
| **C-06 hard-decline branch** | Hard-decline signal mapping — doc line 4204: *"DEFERRED: exact field/tag names until CRS onboarding finalizes."* | CRS onboarding | Branch structure only. Tag, task, decline email + SMS and close are wired; the threshold is a named config constant marked DEFERRED and the branch **no-ops** rather than guessing. No decline threshold was invented — that is a money and compliance decision. |


## Open decisions for Darwin

1. **Lead temperature (N-01/02/03).** The GHL source tagged leads `nurture:cold` /
   `nurture:warm` / `nurture:hot` via an undocumented side-automation — no source
   describes how that tag was assigned, and `outcome_tier` can't stand in for it
   (it's only set post-`decision.rendered`, well past where most nurture targets
   ever get). **Decision made on Chris's behalf, needs Chris's confirm-or-override:**
   derive temperature from funnel depth instead, using events already in
   `canonical.mjs`. Rules live in `src/config/lead-temperature.mjs`:
   - `hot` = `booking.created` or `call.completed`, no `diagnostic.paid`
   - `warm` = `survey.submitted`, no `booking.created`/`call.completed`
   - `cold` = `entry.captured` only, no `survey.submitted`
   - re-evaluated on every relevant event so a lead's bucket moves as they engage.
   No new canonical event was added.

2. **N-05 repair-pipeline events — proposal, not yet approved.** The Optimization/
   Repair Rounds pipeline (Spec §5.4: Round Sent → Bureau Processing → Portal
   Updated → Round Complete → Upgrade Invite) has **zero** canonical events —
   `round.*` in `canonical.mjs` reads as Funding-pipeline-only. N-05 (Repair-Complete
   Nurture) needs at least one of these to exist. Proposed vocabulary, for Darwin to
   approve or reject (mirrors the Funding pipeline's `round.started/submitted/
   approved/funded` shape):
   - `repair.round_sent` — emitted when a repair round is dispatched to the bureau.
     Payload: `{ clientId, roundNumber, bureau }`.
   - `repair.portal_updated` — emitted when the bureau portal status changes.
     Payload: `{ clientId, roundNumber, bureauStatus }`.
   - `repair.completed` — emitted when a repair round is marked complete (this is
     the one N-05 actually needs — maps to GHL's "Repair Complete Date" field
     update). Payload: `{ clientId, roundNumber, completedAt }`.
   - `repair.upgrade_invited` — emitted when the client is invited to upgrade after
     repair completion. Payload: `{ clientId, roundNumber }`.
   Nothing above has been added to `canonical.mjs`. No repair-pipeline workflow will
   port until this is decided — expect this to come up again in a later batch (the
   spec's R-series).

3. **N-07 inactivity threshold — undefined at the source.** GHL's own definition of
   N-07's trigger literally says "No activity for X days — definition deferred." This
   was never finished, not just undocumented. Combined with N-07 being a mass send to
   dormant non-clients, it needs both a threshold and a consent/quiet-hours review
   before it exists as code. See DEFERRED row below.

---

## (root)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| (unkeyed) | Round Started — Client Notify | MIGRATED | `src/workflows/round-started-client-notify.mjs`. Audit fix applied (moved out of the root/no-folder location into the Funding series alongside F-01..F-11). Trigger `round.started`; real audit-approved SMS copy seeded via `src/workflows/templates-seed.mjs`. |

## DECOMMISSIONED WORKFLOWS (23) — confirmed dead, per workflow-coherence-audit.md

| Key | Disposition | Reasoning |
|---|---|---|
| S-03 | RETIRED | Confirmed decommissioned (workflow-coherence-audit.md); still `published` in GHL but folder-flagged dead. |
| S-04B | RETIRED | Same. |
| S-05a | RETIRED | Same. |
| S-07 | RETIRED | Same. |
| S-09 | RETIRED | Same. |
| S-10 | RETIRED | Same. |
| U-01 | RETIRED | Same. |
| U-06 (old) | RETIRED | Superseded by the current U-06 (Spec §6 audit fix: "real analyzer entry URL, no placeholder" applies to the *live* U-06, not this one). |
| N-01..N-08 (DECOM-folder copies) | RETIRED | Same workflow IDs as the live N-01–N-08 documented in `ghl-crm-source-of-truth.md`, but filed in GHL's "DECOMMISSIONED WORKFLOWS" folder. Per task instruction the DECOM-folder copy is skipped regardless; the *live* N-01–N-07 are ported below via their AGENT DRAFT definitions (the only other copy that exists). N-08 has no such counterpart — see its own row. |
| AR-01..AR-03 (DECOM copies) | RETIRED | Live AR-series definitions exist separately under `## ACCOUNTS RECEIVABLE WORKFLOWS (AR-Series)` — pending the AR-series batch. |
| F-02/F-06/F-10 (DECOM copies) | RETIRED | Live F-series definitions exist separately under `## FUNDING WORKFLOWS (F-Series)` — pending the F-series batch. |
| AF-06 | RETIRED | Confirmed decommissioned; no live counterpart found elsewhere in the map. |

## AIRTABLE AUTOMATIONS (AX-Series) (12)

| Disposition | Reasoning |
|---|---|
| RETIRED (all 12) | Spec §6: "Dissolves entirely: the AX series. With one database there is no GHL↔Airtable mirroring." AX-01 client create/sync becomes the client upsert already implemented on `entry.captured`/`survey.submitted` (`src/handlers/client-lifecycle.mjs`, `resolveClient`). AX-02/03/20/21/24 become ordinary event handlers, already covered by the existing reactions layer — nothing left to port under the AX name. |

## NURTURE WORKFLOWS (N-Series) — this batch

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| N-01 | Long-Term Cold Nurture | MIGRATED | `src/workflows/n-01-cold-nurture.mjs`. Ported the live [AGENT DRAFT] copy (sole variant for this key). Trigger replaced per decision #1 above: `entry.captured`, gated on funnel-depth temperature = cold. SMS wired, gated on template existing (real copy confirmed missing in GHL — Chris's own tracking note). |
| N-02 | Long-Term Warm Nurture | MIGRATED | `src/workflows/n-02-warm-nurture.mjs`. Same pattern; trigger `survey.submitted`, gated on temperature = warm. |
| N-03 | Long-Term Hot Nurture | MIGRATED | `src/workflows/n-03-hot-nurture.mjs`. Same pattern; triggers on `booking.created` OR `call.completed` (either can newly produce "hot"), gated on temperature = hot. |
| N-04 | Post-Funding Nurture | MIGRATED | `src/workflows/n-04-post-funding-nurture.mjs`. Original trigger "Pipeline Stage Changed → F23 Post-Funding Monitoring" mapped to `round.funded` (the event that puts a client into that stage); the gate (tag client:funding present) is implied by round.funded having fired, so no separate check. |
| N-05 | Repair-Complete Nurture | BLOCKED | Needs Optimization/Repair pipeline canonical events that don't exist yet. Proposal in "Open decisions for Darwin" §2 above. Not ported; do not add events without Darwin's sign-off. |
| N-06 | Renewal / Second-Wave Funding | MIGRATED | `src/workflows/n-06-renewal-second-wave.mjs`. Original trigger was a Daily Scheduler (polling) gated on "Funding Locked Date older than 6 months" — converted to `round.funded` + a durable 6-month `step.sleep`, re-checking `clients.funded` at wake instead of scanning nightly. Audit fix applied (workflow-coherence-audit.md: SMS step dropped in the AGENT DRAFT regression) — SMS is present here. |
| N-07 | Global Re-engagement (Inactive Leads) | DEFERRED | Two reasons, both from the GHL source itself: (1) the inactivity threshold ("no activity for X days") is marked "definition deferred" — never finished, not just undocumented; (2) it's a mass send to dormant non-clients, which needs a consent + quiet-hours review before it exists as code at all (Spec §7 compliance gate). Not built. |
| N-08 | Analyzer Re-run (6–12 months) | RETIRED | **Conflict, recorded rather than resolved:** Master Rebuild Spec §6 lists "N-01 to N-08 (live versions)" as workflows to port. But the system map has no live/AGENT-DRAFT copy of N-08 anywhere — it exists *only* in the DECOMMISSIONED WORKFLOWS folder, which the task's own skip list already covers. No live definition exists to reconstruct from. Flagged for Darwin. |

## FUNDING WORKFLOWS (F-Series) — this batch

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| F-01 | Funding Intake (F1) | MIGRATED | `src/workflows/f-01-funding-intake.mjs`. Trigger `round.started`; gate "Product Path = Funding" via `outcome_tier` (see decision below). Pod-missing fallback (create task) covers POD-01B's purpose — see POD-01B row. |
| F-02 | Portal / ID Missing (Onboarding Nudge) | MIGRATED | `src/workflows/f-02-portal-id-missing.mjs`. Ported the live [AGENT DRAFT] copy. Trigger `round.started` + `step.sleep` (2-4h range → 3h picked, see decision below) + a 2-day recheck, mirroring GHL's wait/recheck structure without polling. |
| F-03 | Round Submitted (F2/F4/F6...F20) | MIGRATED | `src/workflows/f-03-round-submitted.mjs`. Trigger `round.submitted` (exact match — this is the file the task brief used as its own naming example). Audit fix: real ready-to-paste SMS + email copy, not the blank original. |
| F-04 | Round Approvals (F3/F5/F7...F21) | MIGRATED | `src/workflows/f-04-round-approvals.mjs`. Trigger `round.approved`. Audit fix: real ready-to-paste SMS + email-subject copy. |
| F-05 | Inquiry Cleanup Gate (Between Rounds) | MIGRATED | `src/workflows/f-05-inquiry-cleanup-gate.mjs`. Trigger `round.approved` (same stage as F-04, different reaction). Flips open `inquiry_log` rows to Pending Removal; C-02 (Inquiry Removal pipeline) takes over from there — out of this batch's scope. |
| F-06 | Funding Conditions / Missing Docs | MIGRATED | `src/workflows/f-06-funding-conditions-missing-docs.mjs`. Ported the live [AGENT DRAFT] copy. Original trigger ("Custom Field: Funding Condition Required = true") replaced with `mail.response` (classification MISSING_DOCS) + `docs.received` for the clear-hold half — see decision below re: no new event invented. |
| F-07 | Funding Locked (F22) | MIGRATED (partial — see decision below) | `src/workflows/f-07-funding-locked.mjs`. Trigger `round.funded`. Audit fix: real ready-to-paste SMS + FR22 email copy. **Commission/Balance-Due calculation deliberately NOT automated** — touches money with an unclear formula in the source; a human-facing invoice task is created instead of a computed number. |
| F-08 | Post-Funding Monitoring (F23) | MIGRATED | `src/workflows/f-08-post-funding-monitoring.mjs`. Trigger `round.funded`. Audit fix: dangling trailing wait removed. N-04 enrollment needs no explicit step — it already listens on `round.funded` directly. |
| F-09 | Funding Declined / No Path | MIGRATED | `src/workflows/f-09-funding-declined-no-path.mjs`. Original trigger ("Tag Added: funding:no-path") replaced with `mail.response` (classification DENIED) — the same concrete upstream signal F-11 already classifies, rather than an undocumented tag-assigner. Gate: Product Path = Funding. |
| F-10 | Client Funding Inbox Provisioner | MIGRATED (partial — see decision below) | `src/workflows/f-10-client-funding-inbox-provisioner.mjs`. Trigger `round.started`. **The external `provision_client_funding_inbox` webhook is NOT called** — no adapter exists for it and none was documented; a deterministic forwarding address is computed locally and an ops task created for the real provisioning + confirmation call instead. |
| F-10R | Inbox Verified Receiver (Inbound) | BLOCKED | Reacts to an inbound webhook from the same undocumented inbox-provisioning system F-10 can't call. No adapter, no canonical event, nothing to react to yet. Proposed vocabulary: `inbox.forwarding_verified` (payload `{ clientId }`), emitted by a future adapter for that system. Not built. |
| F-11 | Bank Email Event Router (Inbound) | MIGRATED | `src/workflows/f-11-bank-email-event-router.mjs`. Trigger `mail.response` (Spec §4 names this exact conversion: "F-11 becomes a handler"). Creates the routing task per classification; APPROVED/COUNTEROFFER additionally move the client's card to the Funding pipeline's `approved` stage. DENIED/MISSING_DOCS get deeper follow-through in F-09/F-06 respectively — this file's job is strictly the routing task GHL created for every classification. |
| POD-01B | Funding Handoff & Pod Assignment | MERGED INTO F-01 | Its automated half (an external `lookup_pod` webhook) has no adapter; its fallback purpose (assign pod roles when missing) is exactly what F-01 already does via a task, so nothing is lost — just not auto-assigned. |
| F-12A | Remote Install Kickoff (Zoho Unattended) | OUT OF SCOPE | Appears in `ghl-crm-source-of-truth.md` but not in `GHL-System-Map.md`'s 140-workflow crawl (the F-series Contents count is 13 and F-12A isn't one of them). Not part of the authoritative 140; not built. Flagged here so it isn't silently unaccounted for. |

---

## ACCOUNTS RECEIVABLE WORKFLOWS (AR-Series) — BLOCKED, entire series

Stopped rather than logged-and-continued: this is money + PII together, which is an
explicit stop condition regardless of the "run straight through" mode change.

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| AR-01 | Invoice Sent | BLOCKED | Gated on "Balance Due > 0" — see proposal below. |
| AR-02 | Invoice Reminder | BLOCKED | Same. |
| AR-03 | Escalation | BLOCKED | Same. Audit fix noted for later (workflow-coherence-audit.md: AGENT DRAFT dropped the SMS step vs the DECOM version — re-add once built) — not applied since nothing is built yet. |
| AR-04 | Collections Handoff | BLOCKED | Same gate, plus sends client identity + balance + contract links to an external collections webhook that was never built even in GHL (`draft` status, placeholder `example.com` URL). Money and PII together — needs a human decision on whether/how this ships at all, not just a data-model fix. |

### Proposal: what AR needs before it can be built

1. **An invoice data model — doesn't exist yet.** `transactions` records money
   *received*; nothing in `001_init.sql` records money *owed*. AR needs its own
   table, roughly:
   - `invoices`: `id, org_id, client_id, source (e.g. funding_commission |
     backend_selling), amount_due, amount_paid, status (sent|reminded|escalated|
     paid|written_off), due_at, created_at, updated_at`.
   - This is a schema change — out of scope for this session (`001_init.sql` and
     migrations are explicitly not mine to touch); flagging the need, not the SQL.

2. **Canonical events for the invoice lifecycle — none exist.** Proposed (mirrors
   the `round.*` shape), pending Darwin's approval:
   - `invoice.sent` — payload `{ clientId, invoiceId, amountDue }`.
   - `invoice.reminder_due` — payload `{ clientId, invoiceId, amountDue,
     daysOutstanding }`.
   - `invoice.escalated` — payload `{ clientId, invoiceId, amountDue }`.
   - `invoice.paid` / `invoice.written_off` — payload `{ clientId, invoiceId }`.

3. **The Balance Due formula itself — open question for Chris and Darwin,
   inherited from F-07.** GHL's own F-07 steps copy `total_approved_amount`
   straight into `Commission Owed` and then into `Balance Due` with no visible
   fee-percent multiplication, despite gating on a fee percent existing. Until
   someone confirms what that figure actually should be, there is no correct
   "Balance Due > 0" gate to build AR-01..04 against — building the AR ladder on a
   guessed number would put a wrong dollar figure in front of a real client.

None of AR-01..04 are built. Revisit once 1-3 above are resolved.

---

## AFFILIATE WORKFLOWS (AF-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| AF-01 | Affiliate Activation | BLOCKED | Needs affiliate tier/tracking-id state — see schema proposal below. |
| AF-02 | Referral Ownership Capture | MIGRATED | `src/workflows/af-02-referral-ownership-capture.mjs`. Triggers `entry.captured`/`diagnostic.paid`/`analysis.completed` (canonical mappings of GHL's `lead:new`/`analyzer:started`/`analyzer:complete` tags). Operates entirely on the *lead's own* `clients.custom_fields` (sticky first-touch attribution), so it doesn't need the missing affiliate data model. |
| AF-03A | Tier2 Auto-Unlock — Paid Outcome | BLOCKED | Trigger maps cleanly to `sale.closed` + product-path gating (no new event needed), but the actions all read/write the affiliate's own tier level + unlock date — see schema proposal below. |
| AF-03B | Tier2 Auto-Unlock — First Recruit | BLOCKED | Same data-model gap (recruiter's tier level + direct downline count). |
| AF-04 | Commission Accrual (Outcome-Based) | BLOCKED | Two independent blockers: (1) money — the source doc itself marks "Funding/Repair Commission Amount" as `(your calc / number field)`, i.e. explicitly unspecified even in GHL, same category as the F-07 commission gap; (2) the affiliate tier/tracking-id/balance-due/payout-status data model doesn't exist to write to even once the formula is known. Trigger would map cleanly to `sale.closed` + product-path gating (no new event needed) — that part isn't the blocker. |
| AF-05 | Payout Pending Ops | BLOCKED | Downstream of AF-04; nothing to route without it. |
| AF-06 | Affiliate Reactivation | RETIRED | Already in the 23 confirmed-decommissioned list (see top of this file). |
| AF-06C | Reactivation Cooldown (15d) | RETIRED | Its only job is removing the `affiliate:reactivation-sent` tag that AF-06 (retired) would have set — orphaned, nothing left to clean up after. |
| AF-07 | Partner Hub Access (Pending) | BLOCKED | Single-step "Grant membership/offer" — no defined trigger beyond the step itself, and no adapter for whatever membership system this refers to. |
| AF-08 | Partner Hub Access (Active) | BLOCKED | Same — grant/revoke pair for the same undefined membership system. |

### Proposal: affiliate data model — doesn't exist yet

The `affiliates` table (`001_init.sql`) has only `id, org_id, name, status`.
`affiliate_events` is a history log (`kind: lead|status_change|payout`, jsonb
`detail`), not current state. Everything AF-01/03A/03B/04/05/07/08 need to read or
write — tracking ID, tier level (Tier1/Tier2), activated date, tier2 unlock date,
direct downline count, balance due, payout status — has nowhere to live without a
schema change, which is out of scope for this session (not touching `001_init.sql`
or migrations). Flagging the fields needed, not proposing the SQL:

- `affiliates.tracking_id` (unique per org)
- `affiliates.tier_level` (Tier1 | Tier2)
- `affiliates.activated_at`, `affiliates.tier2_unlocked_at`
- `affiliates.direct_downline_count`
- `affiliates.balance_due`, `affiliates.payout_status`

Once that exists, AF-01/03A/03B's triggers are otherwise straightforward (AF-01: no
clean canonical-event equivalent for "tracking ID assigned" either — would also need
something like `affiliate.tracking_id_assigned`; AF-03A/03B/04: `sale.closed` +
product-path gating, no new event needed).

---

## Decisions made without confirmation

Per the mode change above — logged here for Darwin to review, not gated on approval.

1. **Product Path = Funding/Repair mapping** (`src/config/product-path.mjs`, used by
   F-01/F-09 and likely more later). GHL's "Product Path" field has no direct
   equivalent column; mapped to `clients.outcome_tier`: `FUNDING_PLUS_REPAIR` /
   `FULL_FUNDING` / `PREMIUM_STACK` = Funding path, `REPAIR_ONLY` = Repair path. This
   is a categorical/name-based mapping (Rule 4-compliant — no dollar amounts
   involved), but the exact tier-to-path assignment is my read of the schema
   comment, not a confirmed business rule.
2. **F-02 wait duration.** GHL's own doc gives a range ("2-4 hours"), not a single
   number. Picked 3h (the midpoint) for the initial wait. Mechanical timing choice.
3. **F-06/F-09 round-matching.** `bank_inbox` has no `funding_round_id` column, so
   "set hold_reason on the client's most recent funding round" stands in for "the
   round this bank email is actually about." Fine for a single-round-in-flight
   client; could mis-target if a client somehow has two rounds open at once.
4. **F-07 commission/balance-due — deliberately withheld, not just simplified.**
   GHL's own steps show a straight field copy (Commission Owed = Total Approved
   Amount; Balance Due = Commission Owed) with no visible fee-percent multiplication,
   despite the gate checking that a fee percent exists. Whether `total_approved_amount`
   already *is* the fee amount, or something else, isn't resolvable from anything
   read for this port. Since this is money reaching a real client's invoice, no
   formula was guessed — an "Invoice Client" task carries the raw inputs for a human
   to calculate instead.
5. **F-10/F-10R/POD-01B external webhooks.** Three GHL workflows call external
   systems (`provision_client_funding_inbox`, its inbound confirmation, `lookup_pod`)
   that have no adapter anywhere in this codebase and no documented API contract.
   Rather than invent adapters/endpoints for undocumented external systems, the
   database-side work each workflow does is ported and the external call is replaced
   with an ops task (F-10, POD-01B) or left BLOCKED (F-10R, which has nothing to
   react to without the other two).
6. **F-11 "Move Opportunity to Approvals Stage".** Implemented via a new small
   shared helper (`src/workflows/cards.mjs`, `moveCardToStage`) against the
   `funding_card_stacking` pipeline's `approved` stage (keys from
   `db/seed/002_pipelines.sql` — not modified, only read).
7. **DS-02 invoice — stubbed as a task, per Chris's explicit decision.** The
   downsell-only gate (Hard Rule 1) and the underwrite-iq-lite letter-delivery
   webhook are built for real; `payments_create_invoice` is a staff task instead
   (`src/workflows/ds-02-diy-letters.mjs`). **Flag for Darwin:** a separate session is
   currently designing the products/commission model — connect DS-02's eventual real
   invoicing to that rather than building it as a one-off later.
8. **S-05 (No Show) merged into DPC-02**, and DPC-02's no-show stage maps to the
   sales pipeline's `lost` stage — `db/seed/002_pipelines.sql` has no distinct
   `no_show` stage key.
9. **DPC-02 "did the call happen" check** is "has this client ever fired
   `call.completed`", not matched to the specific booking — no booking↔call
   correlation column exists in the schema. Fine for one-booking-in-flight; could
   misfire with two concurrent bookings for the same client.
10. **BC-01/BC-02 categorical→numeric mapping.** `behavior_scores.responsiveness`/
    `friction` are numeric columns; GHL's Fast/Normal/Slow and High/Medium/Low are
    mapped to 1.0/0.5/0.0. **Known gap:** `behavior_scores` has no idempotency hook
    in the schema (no unique constraint, no jsonb column to stash an event id) —
    unlike every other handler in this port, a replayed event writes a second row.
    Low-risk (analytics only, not money/messaging/PII), documented with a test
    rather than hidden; would need a schema change (out of scope) to fix for real.
11. **S-06 sets `custom_fields.product_path`** in addition to using `outcome_tier`
    for gating elsewhere — a display-parity mirror of GHL's literal "Product Path"
    field, not a new gating mechanism.
12. **BS-01 drip cadence — CORRECTED.** The first port read the source's bare
    "Wait" steps as a flat 4h interval, which collapsed a three-day sequence into a
    16-hour burst of five sends. The source is a **D1-D3 × E1-E6 grid** (Darwin,
    from the docs repo): three day rows, six slot columns, 18 cells. E1 is the
    kickoff column (only D1's is written), E2-E5 are the four named daily sends
    (morning / midday / afternoon / evening), E6 is spare. **The docs carry copy for
    11 of the 18 cells.** The other 7 are addressed by the code and resolved at send
    time — a cell with no template is skipped and returned in `gaps`, never invented.
    Keys are `BS-FUND-{day}-{slot}-{name}` / `BS-REPAIR-{day}-{slot}-{name}` and are
    matched by `{prefix}-{day}-{slot}-%` prefix, because the trailing name word is
    the docs' own and is not derivable from grid position. The previous port's
    `EMAIL-BS-FUND-01-KICKOFF`-style keys were invented and never existed in source.
    Remaining timing choice (not a business rule): booking.created carries no
    local-time anchor, so slots are relative offsets summing to 24h per day row —
    kickoff at t=0, last cell at +71h, inside the source's 72-hour window.
12a. **BS-01 recheck is an Exit, gated on call-held.** The source's Gate 2 is an
    exit, not a branch, and was missing from the first port entirely. BS-01 is
    pre-call material, so once the call has happened the remaining touches are stale
    and sending them is worse than sending nothing. The gate reuses DPC-02's
    `callHappened` (a `call.completed` event for the client), now exported rather
    than duplicated. It deliberately does **not** read `cf_analyzer_recommendation`:
    that field is only written *during* the call, so gating on it would pass on
    exactly the wrong side. Checked at every wake rather than once after the
    kickoff — a single check at +12h would still let 14 stale touches through.
13. **AI-SET-03's third wait / exit condition.** The audit fix says "30 min / 2 hr /
    24 hr" for three waits, but only two waits separate the three messages in the
    source crawl. Built as: msg1 → 30m → msg2 → 2h → msg3, checking for a rebooking
    (`booking.created`) after each wait and exiting early if found. The literal
    "24 hr" third wait wasn't placed anywhere unambiguous, so it isn't in the code —
    worth Darwin's eyes if a genuine post-msg3 cooldown was intended.
14. **AI-SET-04 3-way handoff copy** now includes the advisor follow-up task the
    original draft lacked (per Spec §6's explicit fix instruction), rather than
    wiring into DPC-03 as the spec suggested — DPC-03 reacts to inbound SMS replies,
    not outbound scheduled sends, so there was no natural hook to wire into; a
    parallel task serves the same "advisor is briefed" purpose.
15. **POD-01A (Lead Intake & Setter Assignment) — not built.** Round-robin sales-rep
    assignment needs a shared rotation counter with nowhere to live in the current
    schema (`staff` has no assignment-counter column) — same category of gap as the
    affiliate data model above. BLOCKED, not built; see its own row below.

---

## BEHAVIORAL COMPLIANCE (BC-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| BC-01 | Customer Responsiveness Classifier | MIGRATED | `src/workflows/bc-01-customer-responsiveness.mjs`. Trigger `round.started`; 24h/48h wait ladder against `crs_paid`/docs-cleared state, written to `behavior_scores.responsiveness`. |
| BC-02 | Customer Friction Level Detector | MIGRATED | `src/workflows/bc-02-customer-friction.mjs`. Trigger `round.started`; classifies from current tag state (`ar:collections`/`docs:missing`/`ops:action-required`), written to `behavior_scores.friction`. |
| BC-03 | Primary Motivation Assignment | DEFERRED | Source itself says "THIS IS FOR AI, LEAVE OFF THEN TEST LATER" — explicitly not ready even in GHL. Not built. |

## ATTRIBUTION WORKFLOWS (AT-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| AT-01 | First Touch Capture | MIGRATED | `src/workflows/at-01-first-touch-capture.mjs`. Trigger `entry.captured`; sticky (set-once) First Touch Date + Lead Magnet Type. |
| AT-02 | Attribution Normalizer (DEFENSIVE) | MERGED INTO AT-01 | Same "don't overwrite once locked" rule AT-01 already enforces via its own gate. |
| (map artifact) | S-02 — Attribution Capture | MERGED INTO AT-01 | A second, differently-defined "S-02" in the map sets the identical First Touch Date field for the identical reason — not built as its own file. (Distinct from "S-02 — Incomplete App (Survey)", which IS built separately.) |

## HIRING WORKFLOWS (HR-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| Closer Hiring \| Interview Booked | BLOCKED | An internal HR/candidate process, not a client-funnel event — no canonical event exists for "candidate booked an interview" and none of the 9 adapters cover it (Cal.com's canonical `booking.created` is modeled as a client strategy-session booking). Real SMS/email copy also still has unfilled placeholder links (`[ROLE/4R DOC LINK]` etc. — Spec §6: "filled before activation"). Not built. |

## BACK-END SELLING (BS-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| BS-01 | Pre-Call Backend Launcher | MIGRATED | `src/workflows/bs-01-precall-launcher.mjs`. Merges in BS-EMAIL-FUNDING-72HR (live) and BS-EMAIL-REPAIR-72HR (live) — both are enrollment targets of BS-01, not independently-triggered, so one continuous flow. Trigger `booking.created`; drip choice by product path. Cadence is the D1-D3 × E1-E6 grid (18 cells, 11 with copy today) with a call-held exit gate — see decisions 12 and 12a. |
| BS-01 | Pre-Call Backend Launcher | **MIGRATED — DEAD under 05/30** | `src/workflows/bs-01-precall-launcher.mjs`. Merges in BS-EMAIL-FUNDING-72HR (live) and BS-EMAIL-REPAIR-72HR (live) — both are enrollment targets of BS-01, not independently-triggered, so one continuous flow. Trigger `booking.created`; drip choice by product path. **The tier does not exist at `booking.created` under the 05/30 model, so the router falls through to `no_matching_path:null` and neither drip sends.** Not repaired — the correct trigger point is a business decision; see "Model drift — 04/08 vs 05/30" above for the proposal and the blocking questions. |
| BS-EMAIL-FUNDING-72HR (live) | MERGED INTO BS-01 | See above. |
| BS-EMAIL-REPAIR-72HR (live) | MERGED INTO BS-01 | See above. |
| BS-EMAIL-FUNDING-72HR ([AGENT DRAFT]) | RETIRED | Exact duplicate of the live version (same subjects) — Spec §6 explicit note: "Keep one." |
| BS-ADS (TURNED OFF FOR NOW) | RETIRED | Source itself marks this off; not built. |
| BS-CLICK-FUND — Funding Video Click Tracker | RETIRED | 0 steps in the crawl — an empty/draft placeholder, nothing to port. |
| BS-CLICK-FUND-01..06, BS-CLICK-REPAIR-01..06 (12 total) | BLOCKED | Video-click tracking has no canonical event and no adapter captures it (ClickFunnels' adapter covers opt-in/survey/purchase only, not granular content clicks). Proposed vocabulary for Darwin: `content.engaged`, payload `{ clientId, contentKey, contentType }`, emitted by a future CF tracking-pixel/webhook. Not built. |
| BS-TASKS | BLOCKED | Every task in the crawl is a generic, contentless "Add Task" — no real titles/bodies were captured, and no single clear trigger either. Nothing faithful to port. |

## SALES WORKFLOWS (S-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| POD-01A | Lead Intake & Setter Assignment | BLOCKED | Round-robin rep assignment needs a shared rotation counter with no column to live in (`staff` table has none). See decision #15 above. |
| S-01 | New Lead / Intake | MIGRATED | `src/workflows/s-01-new-lead-intake.mjs`. Trigger `entry.captured`. GHL-internal webhook step (POST back to GHL) dropped — dies with GHL. |
| S-02 | Incomplete App (Survey) | MIGRATED | `src/workflows/s-02-incomplete-survey-nudge.mjs`. Audit fix applied (2-min wait → 20 min, per "bump to 15-30 min"). |
| S-04 | Call Booked → Move to S2 | MIGRATED | `src/workflows/s-04-call-booked.mjs`. Trigger `booking.created`. |
| S-05 | No Show | MERGED INTO DPC-02 | Same action DPC-02's no-show branch already performs — see decision #8 above. |
| S-06 | Post-Call Outcome: Funding Purchased | MIGRATED | `src/workflows/s-06-post-call-funding-purchased.mjs`. Trigger `sale.closed`, gated on the funding path. |
| S-08 | Post-Call: Funding Didn't Buy | MIGRATED | `src/workflows/s-08-post-call-funding-declined.mjs`. Trigger `call.completed`, gated on a declined outcome — the same signal DS-01/DS-02 react to independently. |

## DOWNSELL WORKFLOWS (DS-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| DS-01 | Repair Referral | MIGRATED | `src/workflows/ds-01-repair-referral.mjs`. Real SMS copy exists but needs the real partner link filled in (Spec §6) — send stays gated on the template existing. Blocked from ever firing on the funding route, same product-path gate as DS-02. **AT RISK (model drift):** trigger `call.completed` normally follows the on-call pull, but a call that ends without a pull leaves the tier null, which fails open into the referral. |
| DS-02 | DIY Letters | MIGRATED (partial — per Chris's explicit decision) | `src/workflows/ds-02-diy-letters.mjs`. **Hard Rule 1**: gated to the not-qualified downsell path only — tested proving BOTH directions. Letter-delivery webhook to underwrite-iq-lite built for real; the Commas invoice is a staff task instead (no outbound invoice-creation adapter exists — real money, designed deliberately later, not invented here). See decision #7 above. **FLAG (model drift):** trigger `payment.received` is generic and the $32 diagnostic is itself a payment — if DS-02 can fire pre-call the tier is null and letters go to a possible funding client. Needs the 05/30 doc. |

## AGENTS

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| AGENT — Context Loader (Field Writer) | DEFERRED | Belongs to Spec §8/9's AI Agent Layer ("Own runtime on Claude API") — a separate build, not this Inngest workflow port. |
| AGENT — Document Check (Internal) | DEFERRED | Same — uses an `ai_agent` step (a live LLM call), not a plain reactive handler. |
| AGENT — Recon (Internal) | DEFERRED | Same. |

## AI SETTER (AS-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| AI-SET-03 | No-Answer SMS Cadence | MIGRATED | `src/workflows/ai-set-03-no-answer-cadence.mjs`. Despite the "AI Setter" name, this is pre-scripted "Josh"-voiced SMS (no `ai_agent` step in the source), so it's a plain templated cadence, not part of the deferred AI Agent Layer. Audit fix applied: waits 1 min → 30 min / 2 hr (see decision #13 above for the third-wait ambiguity). Real compliance-scrubbed copy seeded. **FLAG (model drift, copy):** all three messages assert UnderwriteIQ results / a pre-approval amount, but this fires when the call did *not* connect — under 05/30 no pull has run. Copy needs rewriting. |
| AI-SET-04 | 3-Way Text Handoff | MIGRATED | `src/workflows/ai-set-04-3way-handoff.mjs`. Audit fix applied (Spec §6: publish, real T-15-off-Cal.com trigger via `step.sleepUntil`, advisor follow-up task added — see decision #14 above). |
| DPC-04 | Reschedule Rebooking | MERGED INTO DPC-03 | A third AS-Series entry, filed here despite the "DPC-04" key (unrelated to the Decision Finalizer also called DPC-04) — a 2-step SMS + `setter:reschedule` tag reacting to the exact "reschedule" reply DPC-03 already parses. Real copy seeded (Workflow-SMS-Stragglers.md). |

## UNDERWRITEIQ WORKFLOWS (U-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| U-02 | Analyzer Complete → Map + Letters + Delivery | MIGRATED | `src/workflows/u-02-analyzer-complete-delivery.mjs`. Trigger `analysis.completed`. Real copy exists (EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md) but wasn't seeded in this batch — send stays gated on the template existing. **Fixed (model drift audit):** read `clients.outcome_tier` before `decision.rendered` had written it, so every real pull fell to `unknown_path` and no delivery email sent; now resolves the tier from the event payload. |
| U-03 | CRS Snapshot Sync | MIGRATED | `src/workflows/u-03-crs-snapshot-sync.mjs`. Trigger `analysis.completed`, gated `source === "crs"`. |
| U-04 | Promote CRS as Primary Snapshot | MIGRATED | `src/workflows/u-04-promote-crs-primary.mjs`. Same gate as U-03 — "CRS always wins over the Analyzer estimate once it lands." |
| U-05 | UnderwriteIQ Data Health Monitor | MIGRATED | `src/workflows/u-05-data-health-monitor.mjs`. Trigger `analysis.completed`; checks payload completeness. |

## DECISION & PROGRESS CONTROL (DPC-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| DPC-01 | Analyzer Lock | MIGRATED | `src/workflows/dpc-01-analyzer-lock.mjs`. Trigger `analysis.completed`. |
| DPC-02 | Call Outcome Enforcement + Call Held | MIGRATED | `src/workflows/dpc-02-call-outcome-enforcement.mjs`. Trigger `booking.created` + 5-min-post-end wait; folds in S-05 (see decision #8). |
| DPC-03 | Inbound Reply Router | MIGRATED | `src/workflows/dpc-03-inbound-reply-router.mjs`. Trigger `message.inbound` (exact match); non-creating phone lookup only (never mints a client from an inbound reply, same rule `src/handlers/comms.mjs` follows). Merges in DPC-04. |
| DPC-04 | Decision Finalizer | MERGED INTO DPC-03 | No separate trigger event exists for "decision status changed" — it's the second half of the same handler. |
| DPC-05 | 72-Hour No-Progress Escalation | MIGRATED | `src/workflows/dpc-05-no-progress-escalation.mjs`. Audit fix applied (`{{booking_link}}` → `{{contact.calendar_booking_link}}`), real copy seeded. |
| SYS-01 | Client Value Calculator | MIGRATED | `src/workflows/sys-01-client-value-calculator.mjs`. Explicit, unambiguous formula (`approved_amount * fee_percent`) for an internal projection metric, not a real invoice — built directly, unlike F-07/AF-04. |
| SYS-01-LTV | Lifetime Value Calculator | MIGRATED | `src/workflows/sys-01-ltv-calculator.mjs`. Running total per client, deduped via an event-id set stored in `custom_fields` (this one DOES have a working idempotency mechanism, unlike BC-01/02). |

## CHECKOUT (CT-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| CT-00 | Funding Contract Dispatch | DEFERRED | `draft`/"(Test)"/"(Update Source Of Truth)" in the source itself — not live, not finished. Real contract dispatch + payment-link flow (money). Same category as the AR-series stop: not building unfinished payment infrastructure. |
| CT-01 | CRS Soft Pull Form + FanBasis Payment Link | DEFERRED | Same — draft/test, real payment link. |
| CT-02 | Repair Contract + Front-End Repair Fee Checkout | DEFERRED | Same. |
| CT-03 | Funding Upfront Fee Checkout | DEFERRED | Same. |

## CREDIT OPS WORKFLOWS (C-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| C-00 | CRS Soft Pull Request | MIGRATED | `src/workflows/c-00-crs-soft-pull-request.mjs`. Trigger `diagnostic.paid`. Airtable webhook calls dropped (AX dissolution, Spec §6) — everything else ported as custom_fields writes. **FLAG (model drift):** this workflow encodes the pre-call premise itself — it requests the pull at payment time. Under 05/30 the pull is initiated on the call. Needs the 05/30 doc before it is re-pointed. |
| C-02 | Inquiry Created → Assign Inquiry Specialist | MIGRATED | `src/workflows/c-02-inquiry-created.mjs`. Trigger `analysis.completed`, gated on `payload.newInquiries`. Logs to `inquiry_log`. |
| C-02B | Inquiry Removal Requested | MIGRATED | `src/workflows/c-02b-inquiry-removal-requested.mjs`. Trigger `deposit.paid` — Spec §4.2's named auto-trigger, ported directly. |
| C-03 | Inquiry Removed → Resume or Hold (Fraud Alert Gate) | MIGRATED | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs`. Trigger `inquiry.removed` (exact match). |
| C-04 | Snapshot Valid Gatekeeping | BLOCKED | The "stale" threshold this gates on isn't specified anywhere read for this port — the crawl shows a literal hardcoded date (`2026-02-01`), which reads as crawl noise (a snapshot of one contact's field value) rather than the actual staleness rule. Not inventing a threshold. |
| C-05 | Pre-Funding Review Logic | MIGRATED | `src/workflows/c-05-pre-funding-review.mjs`. Trigger `round.started`. |
| C-06 | CRS Results Router | MIGRATED | `src/workflows/c-06-crs-results-router.mjs`. Trigger `analysis.completed`, gated `source === "crs"`. **Fixed (model drift audit):** read `clients.outcome_tier` before `decision.rendered` had written it, routing every real pull to `not_funding`; now resolves the tier from the event payload. |

## HEALTH WORKFLOWS (HX-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| HX-01 | Tag Cleanup | RETIRED | Spec §6: "replaced by the heartbeat agent (Section 9), which supersets them." |
| HX-02 | Lifecycle Manager | RETIRED | Same. |
| HX-03 | Data Completeness Checks | RETIRED | Same. |
| HX-04 | Duplicate Blocker (Receiver) | RETIRED | Same. |
| HX-05 | GHL ↔ Airtable Reconciliation | RETIRED | Same, plus independently covered by the AX dissolution (no more Airtable to reconcile against). |
