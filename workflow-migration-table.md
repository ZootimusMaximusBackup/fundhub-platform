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
| DS-01 | Repair Referral | MIGRATED | `src/workflows/ds-01-repair-referral.mjs`. Real SMS copy exists but needs the real partner link filled in (Spec §6) — send stays gated on the template existing. Blocked from ever firing on the funding route, same product-path gate as DS-02. |
| DS-02 | DIY Letters | MIGRATED (partial — per Chris's explicit decision) | `src/workflows/ds-02-diy-letters.mjs`. **Hard Rule 1**: gated to the not-qualified downsell path only — tested proving BOTH directions. Letter-delivery webhook to underwrite-iq-lite built for real; the Commas invoice is a staff task instead (no outbound invoice-creation adapter exists — real money, designed deliberately later, not invented here). See decision #7 above. |

## AGENTS

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| AGENT — Context Loader (Field Writer) | DEFERRED | Belongs to Spec §8/9's AI Agent Layer ("Own runtime on Claude API") — a separate build, not this Inngest workflow port. |
| AGENT — Document Check (Internal) | DEFERRED | Same — uses an `ai_agent` step (a live LLM call), not a plain reactive handler. |
| AGENT — Recon (Internal) | DEFERRED | Same. |

## AI SETTER (AS-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| AI-SET-03 | No-Answer SMS Cadence | MIGRATED | `src/workflows/ai-set-03-no-answer-cadence.mjs`. Despite the "AI Setter" name, this is pre-scripted "Josh"-voiced SMS (no `ai_agent` step in the source), so it's a plain templated cadence, not part of the deferred AI Agent Layer. Audit fix applied: waits 1 min → 30 min / 2 hr (see decision #13 above for the third-wait ambiguity). Real compliance-scrubbed copy seeded. |
| AI-SET-04 | 3-Way Text Handoff | MIGRATED | `src/workflows/ai-set-04-3way-handoff.mjs`. Audit fix applied (Spec §6: publish, real T-15-off-Cal.com trigger via `step.sleepUntil`, advisor follow-up task added — see decision #14 above). |
| DPC-04 | Reschedule Rebooking | MERGED INTO DPC-03 | A third AS-Series entry, filed here despite the "DPC-04" key (unrelated to the Decision Finalizer also called DPC-04) — a 2-step SMS + `setter:reschedule` tag reacting to the exact "reschedule" reply DPC-03 already parses. Real copy seeded (Workflow-SMS-Stragglers.md). |

## UNDERWRITEIQ WORKFLOWS (U-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| U-02 | Analyzer Complete → Map + Letters + Delivery | MIGRATED | `src/workflows/u-02-analyzer-complete-delivery.mjs`. Trigger `analysis.completed`. Real copy exists (EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md) but wasn't seeded in this batch — send stays gated on the template existing. |
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
| C-00 | CRS Soft Pull Request | MIGRATED | `src/workflows/c-00-crs-soft-pull-request.mjs`. Trigger `diagnostic.paid`. Airtable webhook calls dropped (AX dissolution, Spec §6) — everything else ported as custom_fields writes. |
| C-02 | Inquiry Created → Assign Inquiry Specialist | MIGRATED | `src/workflows/c-02-inquiry-created.mjs`. Trigger `analysis.completed`, gated on `payload.newInquiries`. Logs to `inquiry_log`. |
| C-02B | Inquiry Removal Requested | MIGRATED | `src/workflows/c-02b-inquiry-removal-requested.mjs`. Trigger `deposit.paid` — Spec §4.2's named auto-trigger, ported directly. |
| C-03 | Inquiry Removed → Resume or Hold (Fraud Alert Gate) | MIGRATED | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs`. Trigger `inquiry.removed` (exact match). |
| C-04 | Snapshot Valid Gatekeeping | BLOCKED | The "stale" threshold this gates on isn't specified anywhere read for this port — the crawl shows a literal hardcoded date (`2026-02-01`), which reads as crawl noise (a snapshot of one contact's field value) rather than the actual staleness rule. Not inventing a threshold. |
| C-05 | Pre-Funding Review Logic | MIGRATED | `src/workflows/c-05-pre-funding-review.mjs`. Trigger `round.started`. |
| C-06 | CRS Results Router | MIGRATED | `src/workflows/c-06-crs-results-router.mjs`. Trigger `analysis.completed`, gated `source === "crs"`. |

## HEALTH WORKFLOWS (HX-Series)

| Key | Name | Disposition | Reasoning |
|---|---|---|---|
| HX-01 | Tag Cleanup | RETIRED | Spec §6: "replaced by the heartbeat agent (Section 9), which supersets them." |
| HX-02 | Lifecycle Manager | RETIRED | Same. |
| HX-03 | Data Completeness Checks | RETIRED | Same. |
| HX-04 | Duplicate Blocker (Receiver) | RETIRED | Same. |
| HX-05 | GHL ↔ Airtable Reconciliation | RETIRED | Same, plus independently covered by the AX dissolution (no more Airtable to reconcile against). |
