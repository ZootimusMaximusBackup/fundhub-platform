# Fundhub — Communication Layer Build Spec
**For Cursor. Owner-approved 2026-08-22.**

The CRM works. The communication layer does not fire correctly after the migration.
This spec repairs the wiring between existing CRM events and existing communication
assets. It is a repair job, not a redesign.

---

## 0. Rules — read before touching anything

1. **Do not redesign the CRM.** Do not invent new workflow architecture.
2. **Do not replace existing communication assets.** Reuse what is seeded.
3. **Preserve-first.** Several items below may already exist from earlier build
   specs and were lost in a migration. **Before building anything new in section 4,
   grep for it.** If a prior implementation exists in any form — a file, a dead
   branch, a stubbed function, an orphaned seed — restore and finish that instead
   of writing a parallel one. Report what you found and what you rebuilt.
4. **Fundhub submits to lenders. Fundhub is not a lender.** No copy or field may
   imply Fundhub deposits funds.
5. Two fixes are **already applied on `main`** — do not redo, do not revert:
   - `bs-01-precall-launcher.mjs` no longer sends `SMS_BS01_BOOKED` (S-04B owns it)
   - `bs-01-precall-launcher.mjs` no longer sends `SMS_BS01_DAYOF` (S-04B owns it)
   - `s-04b-booking-reminders.mjs` now also sends `EMAIL-S04-01-CONFIRM`
     (seeded in `db/seed/012_s04_booking_confirm_email.sql`)
6. Run `node --test "src/workflows/*.test.mjs"` after each section. 313 tests
   passed before this work started. Update assertions when send counts change —
   do not delete tests.

7. **The event-to-communication mapping in this spec is owner-approved and
   final.** Which event fires which message, at what timing, in which order —
   every one of those decisions was made deliberately by the owner in session on
   2026-08-22, against the live template state and the original system design.
   They are not proposals.

   Your job is the mechanism: where to attach the trigger, how to gate it, how to
   keep it idempotent, how to test it. Not what fires when.

   If implementing a mapping as written is technically impossible, or you find
   hard evidence in the codebase that contradicts it, **stop and report it.** Do
   not silently substitute your own judgment, do not re-sequence a lane because a
   different order seems cleaner, and do not add a send the spec did not ask for.
   Over-messaging is the exact failure this whole engagement exists to fix.

---

## 1. P0 — Transmission is off. Nothing else in this spec matters until it is on.

### 1.1 `MESSAGING_DRY_RUN` must be explicitly OFF

**This is the root cause of "nothing is working."**

`src/lib/dry-run.mjs` defaults to **blocked**. Read its header. The only values
that permit transmission are `0`, `false`, `no`, `off`. Unset is blocked. Empty
is blocked. Any other string is blocked. The file's own history records that
`MESSAGING_DRY_RUN=true` was set in production — `true` is not in the allow-list,
so it means **hold**.

**Action:**
- Set `MESSAGING_DRY_RUN=0` in the production Netlify environment.
- Set `ADAPTERS_DRY_RUN=0` in the production Netlify environment.
- **We are 100% live.** The owner has stated this repeatedly. Do not leave the
  fence up "for safety." Do not re-raise it after testing.
- Confirm back the value you read before you changed it.

### 1.2 Verify the rest of the transmission chain

Check and report each. Do not assume.

| Gate | Where | Required state |
|---|---|---|
| `MESSAGING_DRY_RUN` | Netlify env | `0` |
| `ADAPTERS_DRY_RUN` | Netlify env | `0` |
| `INNGEST_EVENT_KEY` | Netlify env | set (owner-set 2026-08-20, stays on permanently — CLAUDE.md §11) |
| `INNGEST_SIGNING_KEY` | Netlify env | set |
| Twilio credentials | Netlify env | set — SMS cannot send without them |
| Mailgun credentials | Netlify env | set — email cannot send without them |
| `messaging_settings.outbound_enabled` | DB, per org | `true` for the `fundhub` org |
| `messaging_settings.daily_send_cap` | DB, per org | high enough for real volume (default 500) |
| `message-dispatch-sweeper` | `src/workflows/index.mjs` | registered, cron `*/5 * * * *` |

### 1.3 Fix the stale comment that has misled three audits

`netlify.toml` line ~107 says *"INNGEST_EVENT_KEY remains unset and the 47 workflow
functions remain dormant."* This contradicts `CLAUDE.md` §11, which is newer and
authoritative. Correct the comment. Three prior audits reported the system dormant
because of this line.

Same for `CLAUDE.md` §12: *"nothing schedules the dispatcher yet — see
`message-dispatch-sweeper.mjs`, which is defined and deliberately not registered."*
It **is** registered now. Correct it.

---

## 2. P0 — Two structural defects that silently kill half the automation

### 2.1 A human closer's call fires nothing

`call.completed` is emitted by exactly one file: `src/adapters/bland.mjs` — the AI
voice agent. When a human closer logs a disposition, `logCallOutcome()`
(`src/sales/call-outcomes.mjs`) writes a `call_outcomes` row and **emits no event**.

Every workflow listening on `call.completed` therefore only ever fires from Josh's
AI calls, never from a real sales call: `ds-01-repair-referral`,
`s-08-post-call-funding-declined`, `ai-set-03-no-answer-cadence`.

**Action:** `logCallOutcome()` must `emit(db, "call.completed", …)` after a
successful write, with a payload carrying:

```js
{
  clientId,
  orgId,
  outcome,                    // deposit | downsell | callback | no_show | not_a_fit
  offerKey,                   // from closer_deck_disposition, null if none
  disposition: "closer",      // distinguishes from Bland's AI-call payload
  repairReferral,             // true only when the closer marked a repair referral
  declineReason: null,
  taskId
}
```

Use an idempotency key so a re-save does not double-fire.

**Guard:** `ai-set-03-no-answer-cadence` gates on
`disposition === "no_answer" | "no-answer" | "voicemail"`. A closer payload will
never match, so it stays AI-only. Verify this holds — do not let closer calls
trigger the no-answer text cadence.

**Note on `repairReferral`:** `ds-01-repair-referral` requires
`payload.repairReferral === true`. Nothing currently sets it. Surface it as an
explicit closer control in the disposition UI. Without it that whole branch is dead.

### 2.2 The document agent is registered against a trigger that does not exist

`GHL-DOC` ("Document Check") is seeded in `db/migrations/114_ghl_agent_seed.sql`
with a full prompt, image reading on, and a JSON output schema
(`accept` / `request_more` / `hold`). Its recorded trigger is the GHL-era tag
`docs:uploaded`. **Nothing in this stack raises that tag.**

`api/documents-upload.mjs` already exists, works, and emits `docs.received` — its
own header explains it deliberately chose the canonical event over a new
`docs.uploaded`.

**Action:** retrigger `GHL-DOC` on `docs.received` where the document `kind` is one
of `id_document`, `proof_of_address`, `articles_of_organization`, `ssn_card`,
`proof_of_income`, `bank_statement`. Route its JSON output per section 4.5.

`docs.received` is already consumed by `src/handlers/inquiry-docs.mjs` for the
inquiry gate — a different purpose. Both consumers must coexist. Discriminate on
document `kind`; do not hijack the inquiry path.

### 2.3 `GHL-RECON` is also orphaned

`Recon` — the system-health watchdog that emails and texts the owner when a
workflow breaks or stalls — is seeded and wired to the GHL-era tag `recon:flag`,
which nothing raises. Note it, wire it if cheap, otherwise report it as deferred.
Given how long this outage went unnoticed, it has obvious value.

---

## 3. Turn-offs — owner-confirmed, apply before building anything new

Remove the trigger registration. **Keep the template rows and the exported keys**
with a `RETIRED 2026-08-22` comment, matching how BS-01's retired keys were handled.

| # | Workflow | Change | Reason (owner) |
|---|---|---|---|
| 3.1 | `n-01-cold-nurture` | remove `entry.captured` trigger | Long-term cold-nurture copy was landing on leads eleven seconds old |
| 3.2 | `n-02-warm-nurture` | remove `survey.submitted` trigger | Same defect. S-NOBOOK owns the post-survey chase alone |
| 3.3 | `n-03-hot-nurture` | remove both triggers, disable | "Every lead is hot. Doesn't mean we assault them" |
| 3.4 | `u-02-analyzer-complete-delivery` | disable both sends | "That's all old workflows" |
| 3.5 | `c-06-crs-results-router` | disable the decline email + SMS | "We never tell somebody they're declined" — keep tags, task, routing |
| 3.6 | `f-10-client-funding-inbox-provisioner` | disable email + SMS | Inbox routing is set up live on the sales call; no follow-up wanted |

**3.7 — `analysis.completed` sends nothing to the client, at all.**
A UnderwriteIQ soft pull returns in milliseconds and is dashboard-only. After 3.4
and 3.5, confirm by grep that no `sendTemplated` call remains reachable from any
`analysis.completed` workflow.

**3.8 — `src/config/lead-temperature.mjs`.** With N-01/N-02/N-03 off, nothing
consumes `classifyTemperature()` for sending. Leave the module in place. Do not
delete it and do not build new logic on it — its "hot" definition is flagged in its
own header as an unconfirmed guess.

### Fix while you are in there

**3.9 — `ai-set-04-3way-handoff.mjs`:** `createAdvisorTaskOnce()` is called with
`assigneeRole: "funding_advisor"`. Owner confirms it should be **`"closer"`**.

---

## 4. Build — new wiring

All copy for this section is written and approved in
`docs/workflows/missing-copy-2026-08-22.md`. Seed it in new
`db/seed/*.sql` files with `compliance_passed = true`, following the pattern in
`db/seed/012_s04_booking_confirm_email.sql`, and append every filename to
`db/expected-migrations.mjs`.

### 4.1 Welcome — `entry.captured`

New workflow. Sends `EMAIL-S00-WELCOME` + `SMS-S00-WELCOME` immediately.

Fires for every captured lead. `at-01`, `s-01`, `af-02` continue to run silently
alongside it. `s-02`'s +20 min "finish your application" nudge is unchanged and
still correct.

### 4.2 Portal invite — `booking.created`

`EMAIL-PORTAL-MAGIC-LINK` already exists (`db/seed/007_portal_magic_link_template.sql`)
and is only sent today when a client requests a login link themselves.

**Wire it to fire on `booking.created`, for everyone who books.**

Owner's reasoning: portal access is granted at booking regardless of whether they
ever buy. Free users in the portal see the rest of the ecosystem. This is
deliberate, not a leak.

Every product-delivery email in 4.4 assumes the client already has portal access
from this step.

### 4.3 No-book chase gets an email arm — `survey.submitted`

`s-nobook-chase` currently sends three texts at +2h / +24h / +72h and stops when
the client books.

**Add `EMAIL-NOBOOK-01/02/03` paired to the same three touches.** Same stop
condition — a booking halts the whole sequence, email included.

### 4.4 No-show recovery becomes a real sequence — `booking.noshow`

`s-05a-no-show-recovery` currently sends one email + one text and stops.

**Extend to four touches, email + SMS at each:**

| Touch | Delay | Keys |
|---|---|---|
| 1 | immediate | `EMAIL/SMS-S05A-NOSHOW-RECOVERY` *(exists)* |
| 2 | +24h | `EMAIL/SMS-S05A-NOSHOW-02` |
| 3 | +72h | `EMAIL/SMS-S05A-NOSHOW-03` |
| 4 | +7d | `EMAIL/SMS-S05A-NOSHOW-04` |

Stop the sequence on `booking.created` (they rebooked). Re-check before each send,
the way `bs-01` re-checks `callHappened()`.

### 4.5 Offer bucket delivery — closer sets the bucket

**Trigger:** `logDeckDisposition()` in `src/sales/closer-deck.mjs`, which already
writes `closer_deck_disposition.offer_key` to custom fields and calls
`logCallOutcome()`.

Once 2.1 is done, this rides the new `call.completed` emission. **Read the bucket
from `offerKey`, not from `outcome`** — `outcomeForOffer()` collapses all six
offers into `deposit` / `downsell`, so `outcome` cannot tell you which product
they bought.

| `offer_key` | Email |
|---|---|
| `SOFT_PULL` | `EMAIL-OFFER-SOFT-PULL` |
| `FUNDING_DFY` | `EMAIL-OFFER-FUNDING-DFY` |
| `REPAIR_DFY` | `EMAIL-OFFER-REPAIR-DFY` |
| `REPAIR_TRIAL` | `EMAIL-OFFER-REPAIR-TRIAL` |
| `UWIQ_DELIVERABLES` | `EMAIL-OFFER-UWIQ-DELIVERABLES` |
| `FUNDING_MASTERY` | `EMAIL-OFFER-FUNDING-MASTERY` |
| none / `not_a_fit` | `EMAIL-OFFER-NONE` |

Email only. SMS on this step is deliberately out of scope — owner: *"we can add
sms later, not needed, extra cost."*

### 4.6 Document collection lane — `deposit.paid`

Today `deposit.paid` runs `s-06-post-call-funding-purchased` (tags, lifecycle,
internal task) and `c-02b`. **The client receives nothing.** There is no document
request, no collection agent, and no gate stopping funding work from starting
before documents clear.

Owner: *"After the deposit is paid, document upload is a hard gate. We cannot begin
optimization or funding work until the required documents are uploaded and
approved. The AI agent's job at this stage is to collect those documents. The
client can respond to the AI by text or upload directly through their portal."*

**Build:**

1. On `deposit.paid` → send `EMAIL-DOC-01-REQUEST` + `SMS-DOC-01-REQUEST`.
2. Set a funding gate on the client — funding work blocked until documents clear.
   Reuse the existing gate pattern in `src/inquiry-ops/doc-gate.mjs` rather than
   inventing a new mechanism.
3. On `docs.received` with a client-document `kind` → run `GHL-DOC` (per 2.2).
4. Route the agent's JSON output:
   - `accept` → clear the gate, send `EMAIL/SMS-DOC-03-APPROVED`, set
     `employee_next_action` to profile optimization
   - `request_more` → send `SMS-DOC-02-REQUEST-MORE`, surface the agent's
     `message_to_client` in the portal, gate stays closed
   - `hold` → staff task with `hold_reason`, no client message, gate stays closed
5. Inbound texts with photo attachments must reach the same agent path as portal
   uploads. Owner explicitly requires both routes.

### 4.7 Per-round invoicing and AR collections

**Terminology, owner-corrected:** invoice on **round completion**, not round
approval. Approval is not instant — it often needs follow-up and additional
documents. A round starts, gets processed, completes, then the next round starts.
Approval status is determined through CRS and feeds back into the system separately.

`src/commissions/calculate.mjs` already computes `success_fee` from *that round's*
funded amount at the frozen percent. The math engine is correct — do not rewrite it.

`GHL-A2` ("Agent 2 — AR / Collections", sender identity *Fundhub Billing*) is seeded
with AR-01 / AR-02 / AR-03 sticky references and an AR-04 automated collections
handoff. It is orphaned. No AR message templates exist — they are in the copy doc.

**Build the chain:**

```
round completes
  → invoice.created   (success fee for that round)
  → invoice.sent      → EMAIL/SMS-AR-01-FIRST-NOTICE
  → +7d unpaid        → EMAIL/SMS-AR-02-REMINDER
  → +14d unpaid       → EMAIL/SMS-AR-03-FINAL-NOTICE
  → still unpaid      → AR-04 automated collections handoff, no human takes over
  → invoice.paid      → stop the chase immediately
```

`invoice.created`, `invoice.sent`, `invoice.paid`, `invoice.voided` are already
canonical events. **No workflow listens to any of them today** — the invoice only
goes out if staff trigger it manually through `api/messages-outbound.mjs`.
`INVOICE-SENT-EMAIL` already exists and works.

Every chase step must re-check payment state before sending. A paid invoice must
never receive a reminder.

### 4.8 `round.closeout` — new emitter, owner-confirmed

`round.closeout` is consumed by `src/handlers/inquiry-gate.mjs` and
`src/handlers/money-chain.mjs`. **Nothing emits it.** It can never fire today.

**Build:** a staff action in the CRM that marks a client's entire funding
engagement complete and emits `round.closeout`. This is a deliberate human
decision — the last round is subjective and the specialist decides when the client
is done.

Match existing CRM UI conventions. Do not invent a new pattern.

### 4.9 Post-funding nurture moves behind closeout

`n-04-post-funding-nurture` currently fires on `round.funded`, at the same instant
as `f-07-funding-locked`. Two emails and two texts land together.

**Retrigger N-04 on `round.closeout`.** Correct sequence, per owner:

```
funding completes → F-07 notify → invoice → AR collects → round.closeout → N-04 nurture
```

`n-06-renewal-second-wave` (+180d) is correctly spaced. Leave it.

### 4.10 Reschedule restarts the sequence — `booking.rescheduled`

`booking.rescheduled` is emitted by `src/adapters/calcom.mjs` and
`src/adapters/clickfunnels.mjs`, and handled by `src/handlers/comms.mjs` — which
updates the booking record and **sends nothing**.

The live defect: S-04B's confirm and reminders are scheduled off the *original*
`booking.created` time. After a reschedule the client holds reminders for a slot
that no longer exists, and gets no confirmation for the new one.

**Build:** on `booking.rescheduled`, cancel the in-flight S-04B and BS-01 runs for
that booking and restart both against the new `start_time`.

**No automations exist in ClickFunnels** — owner confirmed. Everything is in this
repo. Do not assume an external system sends the reschedule confirmation.

Deferred: the owner wants a rescheduled booking to eventually receive *different*
backend-selling content than the original, so they do not see the same emails
twice. **Not in this build.** Restart with the same content.

### 4.11 AX-07 Funding Paused — new-negative detector

Owner-confirmed as a real feature, matching existing CRM UI conventions.

`EMAIL-AX07-FUNDING-PAUSED` and `SMS-AX07-FUNDING-PAUSED` already exist, seeded,
`compliance_passed = false`. **Reuse them. Turn them on when the detector works.**

The original mechanism was an Airtable snapshot-diff (`AX11`) firing a webhook into
a GHL router. Airtable is retired and there is no equivalent in this stack —
confirmed absent in `docs/workflows/fulfillment-layer-2026-08-19-evidence/W3-docs-money.md`.

**Trigger:** a new negative item appearing on a CRS snapshot compared against the
prior snapshot for that client. `u-03-crs-snapshot-sync` already syncs snapshots —
build the diff on top of it, do not build a second snapshot pipeline.

**Chain, per owner:**

```
new negative detected on a CRS snapshot
  → funding gate closes — the funding advisor is blocked from proceeding
  → task for the sales rep
  → close the client on a discounted credit repair package
  → invoice
  → repair runs to completion
  → new funding round starts later
```

Owner's reasoning, for the gate logic: one bad bureau with two clean ones is
technically still fundable on the two — but a single new negative almost always
means more are coming, so funding pauses automatically rather than letting the
advisor waste a round. The gate is not advisory. It blocks.

---

## 5. Explicitly out of scope — do not build

| Item | Owner's reason |
|---|---|
| AI voice recovery call on `booking.cancelled` | "Cancel the AI voice recovery call for this build. We can build that later." |
| `payment.failed` / `refunded` / `disputed` client comms | Commas handles processing; refunds are course-only; disputes are internal financing management |
| Inquiry-removed client notification | "Feels really redundant, they're gonna know" |
| Funding-declined client notification | "We're not gonna tell you you're declined ever" |
| The 12 `BS-REPAIR-*` pre-call nurture cells | Stay wired and OFF (`compliance_passed = false`) until copy is reviewed |
| Reschedule variant content for BS-01 | Deferred — restart with the same content |
| SMS on offer-bucket delivery | "We can add sms later, not needed, extra cost" |
| Editing any existing approved copy | Not this build |

---

## 5B. BACKLOG — deferred, but NOT cancelled. Do not lose these.

These are real gaps the owner wants built. They are out of *this* build only
because they need decisions that were not made in the 2026-08-22 session.
**They are not in section 5.** Section 5 is cancelled work. This is queued work.

Track them. Raise them at the end of this build so they get scheduled.

### 5B.1 — The post-pause recovery chain (follows 4.11 / AX-07)

AX-07 currently stops at: gate closes, task created, paused email + text sent.
The owner's full sequence continues past that point:

```
funding paused
  → sales rep closes the client on a DISCOUNTED credit repair package
  → invoice for that package
  → repair runs to completion
  → a new funding round starts later
```

Everything after the sales task is unbuilt. Needed before it can be:
- the discounted repair offer itself — is it a new `OFFERS` entry, or an
  existing key at a reduced price?
- what reopens the funding gate — repair program completion, a clean CRS
  snapshot, or a manual staff release?
- whether the new funding round is a fresh engagement or a resumption of the
  paused one

### 5B.2 — Partial and multi-invoice payment allocation

With per-round invoicing (4.7), a client can have two or more invoices open at
once. Today nothing decides which one a payment applies to, and the AR chase
cannot tell which invoice to stop chasing.

Needed before it can be built:
- allocation rule — oldest first, or client/staff picks
- partial payment handling: does a half-paid invoice keep receiving AR chases?
- what happens when a payment exceeds the invoice it is applied to

**Do not guess either of these.** Surface them to the owner as decisions.

### 5B.3 — AI-owned prove phone and inbox

Today `FUNDHUB_TEST_PHONE` and `FUNDHUB_TEST_INBOX` are Chris’s. Not AI-owned.
The AI can already see send/delivery in `messages` plus Twilio/Resend. It cannot
read his lock screen. Fake `e2e+aff-*@` / `e2e+wl-*@` bounce.

Smallest later setup:
- a real mailbox the AI can open
- a second Twilio number as the test “To”
- for Josh: that number auto-answers, or a human still picks up

Do **not** buy a number, create a mailbox, or set env in this build.
Needed before it can be set up: which mailbox, which Twilio number, and whether
Josh’s prove call auto-answers.

### 5B.4 — Commission CRM: Approve / Mark paid (ready to ship)

**Source thread:** [Commission payout structure](ab087d72-efb9-4ae0-b80e-44fcf4ac40ef)
**Code branch (local, not pushed):** `feat/commission-payout-crm` @ `e21abc7c`

What it is:
- Products & Commissions ledger: select Accrued → **Approve**, select Approved → **Mark paid** + paste ACH/check/payroll id
- `POST /api/commissions` (`approve` | `mark_paid`)
- Records status only. **Does not send money.** Commas stays client-pay-in.
- Unit + Postgres rollback proof already green on that branch

Ship when Netlify is free. Do **not** mix this deploy with the section 1–4
comms repair unless both are intentionally on the same ship. At ship time:
regen journey `-actual.md` on a clean tree (earlier regen mixed other routes).

Detail board (pointer): `docs/workflows/commission-payout-crm-2026-08-22.md`

### 5B.5 — Staff payout notice email (closer + sales manager) — BUILT 2026-08-23

When a ledger row is **Mark paid**, email that person:
- you were paid / distributed
- amount
- expect ACH (or named rail) to hit today / on the stated schedule

**Live wiring:** `commission.paid` → `src/handlers/staff-comp-alerts.mjs` →
`notifyCommissionPaid` (Resend). Template `EMAIL-COMMISSION-PAID`
(`db/seed/018_staff_comp_alerts.sql`). Needs staff email on the roster row.
Code ships with the next deploy; seed is already applied on production DB.

### 5B.6 — Deal-close dopamine reward (closer + sales manager) — BUILT 2026-08-23

When a deal closes (`sale.closed` or `deposit.paid`), SMS win ping to the closer
and sales manager on that sale (from `sale_attributions` / link actors).
Template `SMS-DEAL-CLOSE-WIN`. Needs phone on the staff row. Queued like the
booked-call staff text (same dispatcher path).

### 5B.10 — Staff ACH payout rail (QUEUED — decide before build)

Owner asked about Plaid for company → staff payouts. Current Plaid code in this
repo is **client bank link only** (Finance OS seams — not implemented to transmit).
Paying closers is a different product.

Recommended path (owner pick later):
1. **Near term (already works):** Approve → Mark paid + paste ACH batch id; Melio /
   bank ACH / payroll outside the CRM. Email (5B.5) tells them money is coming.
2. **Next:** Melio or similar bill-pay API that pushes ACH to staff bank details
   stored on `staff` (routing + account, encrypted) — Mark paid auto-fills `payout_ref`.
3. **Plaid Transfer** (not Plaid Link): company funding account + staff recipients.
   Heavier compliance (SOC 2, consent). Only after (1)–(2) feel right for weeks.

Do **not** build Transfer until Chris names this row as a build.

### 5B.7 — Conveyor + North Stars → Ops / AI COO v1 (DONE 2026-08-24)

**Status: DONE** for pulse + briefs + hire/LinkedIn + later brain shapes/reads (2026-08-24). Ready to ship, not shipped (deploy not named). Fire / raise / bonus are C-suite task shapes only — no auto-enqueue, no kick, no invented % or $. Ad spend is a read + review task. Hermes stays later.

**This pass built (2026-08-24):**

- Daily pulse: company 8 (`computeKpis`) + 20/20 `staff_targets` bars + MODEL unit clocks
- Two briefs: CEO “what needs doing today?” / Chris “what will be done.”
- Packed calendar → one hire-closer task (`createCsuiteTask` kind=hire, assignee `sales_manager`) + LinkedIn post via existing `src/hiring/linkedin.mjs` `postJob`
- Fire: helper `createCsuiteTask({ kind: 'fire' })` assignee `owner`. No locked fire trigger. Do not call `suspendStaff`
- GET `/api/read/ops-pulse` (read only). POST `/api/ops/hire-closer` (owner/admin write)
- Ops Admin “Today’s briefs” card

**Change manifest**

- Added: `src/ops/pulse.mjs`, `src/ops/briefs.mjs`, `src/ops/hire-closer.mjs`, `src/ops/csuite-tasks.mjs` + tests
- Added: `api/read/ops-pulse.mjs`, `api/ops/hire-closer.mjs`
- Routed: `read/ops-pulse`, `ops/hire-closer` in `netlify/functions/api.mjs`
- UI: `public/app/ops-admin.html` briefs section; `public/app/data.js` `opsPulse` / `hireCloser`
- Journeys: `docs/journeys/ops-pulse-intended.md` + `-actual.md`
- Board: `docs/workflows/ops-coo-v1-2026-08-24.md`

**Still later (do not build from this row):** Hermes; fire auto-enqueue (blocked on Chris Q1); raise/bonus auto-enqueue (blocked on Q6/Q7 dollars); buying/pausing ads.

**Status was QUEUED.** Spec lock 2026-08-24. The agent v1 above is the named build. Do **not** treat this as a fire/raise/bonus brain.

**Source thread:** [Ops agent for KPI management](b3cf46b7-aa4b-49b7-9858-73d8569ecd11)
**Owner-set 2026-08-22 / 2026-08-24.** Track it. Do not lose it. Do not treat “eight KPIs per role” as the law.

**The law is the belt.** Success = lead → book → show → close (**deposit** logged) → upsell/downsell on the pay link → fund → inquiry / repair when needed.

**Long spec (read this):** [`docs/workflows/fundhub-conveyor-kpis-2026-08-23.md`](fundhub-conveyor-kpis-2026-08-23.md)

**One North Star per seat** (from that spec):

- AI setter — count bookings. Never hire setters.
- Sales manager — team deposits vs calendar fullness. Calendar too full → hire a **closer**.
- Closer — about **20 deposits / month**.
- Funding advisor — about **20 funded / month**.
- Inquiry remover and Credit repair — two seats. Same Specialist login today (Inquiries / Repair toggle). Clock: healthy ~15 days, hard cap 30. Do not invent monthly counts.
- Owner — company health, not a per-seat star.

**Company 8** (already on the company dashboard): new clients, booked calls, show rate, close rate, cash, funded count, funded dollars, cost per funded. Company health. Not eight numbers per person.

**Mail:** expedited. Not overnight.

**Unit job times** (how long one job takes — not the 15/30 day file clock): [`fundhub-conveyor-kpis-2026-08-23.md`](fundhub-conveyor-kpis-2026-08-23.md) §8 and `src/ops/role-unit-times.mjs`. Card app 10 min, funding round 50 min, funded file 175 min, repair 5 min, FTC upload 2 min, close call 45 min. Starting bar is 20. Time-max is 213 closer calls / 54 funded files at 160h.

**Starting bars written 2026-08-24.** Closer deposits=20/month and funding advisor funded count=20/month (`files`). Still not the hire / fire agent.

What the later agent will do (still queued):

- Watch the belt by day and by week.
- Tell the **CEO what needs doing** and tell **Chris what will be done**.
- Hire / fire / assign from those numbers (packed calendar → hire closer). Same idea for every seat.
- Learn over time (Hermes / training). Later: ramp-ups and how-to material.

Capability check — **current CRM cannot run that loop yet**:

- Staff on/off is invite + revoke login only. No employment fire. No reactivate.
- Hiring can mark `hired` and does **not** create a staff login.
- LinkedIn can post/close a job (unverified live). Not a switch from a number.
- No Hermes in this repo. Staff Ask is product help. Company Brain is docs Q&A. Neither acts.
- Reuse later, do not invent a second copy: `staff_targets`, sales metrics, company dashboard numbers, tasks, hiring stages, LinkedIn post/close.

Still needed before the agent build (do not guess):

- Chris locks the conveyor spec
- who is CEO vs Chris on the two briefs if they are not the same person
- which number crossing which line means hire vs fire vs assign a checklist
- whether LinkedIn hiring is in v1 or later

Pointer: [`docs/workflows/ops-kpi-agent-2026-08-22.md`](ops-kpi-agent-2026-08-22.md)

### 5B.8 — AI agent prompts (Josh and related)

**Owner 2026-08-22:** prompts are bad (“poopy”). Needs a later pass to rewrite/fix
Josh and the other AI agent prompts. **Not this build.** Do not rewrite copy now.

### 5B.9 — Double Josh call on the 2026-08-22 book-a-call prove

Owner got **two** live Josh / Bland calls during the prove. Unknown at queue time
whether two workflows fired, two books, or a retry. Diagnose later. Do **not**
fix by placing more calls. Do not prove-dial again unless the owner asks.

### 5B.10 — Refresh the live robot / function list on deploy

A later worker found the Inngest live function list was last refreshed Aug 13, so
new workflows did not run until a sync. Refresh that list as part of deploy so
new jobs are not silent for days. Do **not** implement the sync in this build.

### 5B.11 — Duplicate reminders + “tomorrow” on the same day

Live prove 2026-08-22 (owner SMS + Gmail screenshots, ~12:35 PM Pacific):

- Leftover **Saturday 2:30 PM MST** book plus the intended **Monday 11:30 AM MST**
  book both confirmed. After Inngest synced, S-04B for Saturday sent the day-of
  text **and** the 24h “your call is tomorrow” text on Saturday — `sleepUntil` for
  T-24h was already in the past, so the 24h template fired on day-of. Do **not**
  rewrite approved copy. Fix the **gate/schedule** later: skip the 24h send when
  wake time is already inside the day-of window.
- Welcome twice (then a pile): many `entry.captured` events, one S-00 workflow,
  one client — not two welcome workflows.
- Extra Saturday 2:00 / 2:30 in-flight S-04B / BS-01 / T-15 jobs were cancelled
  in Inngest. Monday 11:30 left running. Do **not** book or call Josh to re-prove.

Same cluster as 5B.9 (double Josh) and 5B.8 (prompts). **Not this build.**

---

## 6. Verification before you call it done

1. `node --test "src/workflows/*.test.mjs"` — all green. Update assertions where
   send counts changed; do not delete tests.
2. Confirm and report the value `MESSAGING_DRY_RUN` held **before** you changed it.
   The owner needs to know how long transmission was fenced.
3. Every new template row: `compliance_passed = true`, correct `org_id`, reachable
   by its `template_key`.
4. Every new seed filename appended to `db/expected-migrations.mjs`.
5. Grep-prove no `sendTemplated` call is reachable from any `analysis.completed`
   workflow.
6. **End-to-end live test.** Book a real call on a real number and confirm actual
   receipt of: confirm SMS, confirm email, portal invite, and Josh's AI call. The
   owner's report is *"nothing is working"* — a green test suite is not evidence
   that a message reached a phone.
7. Report anything in section 4 you found already built, and what you restored
   rather than rebuilt.

---

## 7. Source of evidence

- Live `message_templates` dump, 2026-08-20 — 237 rows, re-verified 08-21:
  `docs/workflows/live-journey-2026-08-20-evidence/all-template-copy.md`
- `docs/workflows/messaging-review-2026-08-21.md` and its evidence folder
- `FUNDHUB.AI GO HIGH LEVEL CRM SOURCE OF TRUTH 05_30_2026.pdf` — historical design
  reference only. **Fundhub does not use GoHighLevel.** The `GHL-*` prefixes on
  seeded agent records are migration artifacts, not a live integration.
- `docs/workflows/missing-copy-2026-08-22.md` — the 29 new templates
- Owner decisions: this session, 2026-08-22
