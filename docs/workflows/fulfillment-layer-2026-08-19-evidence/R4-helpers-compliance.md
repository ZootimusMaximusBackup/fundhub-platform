# R4 — Existing helpers and compliance

Round 2 evidence. Every line cited below was opened and read. Where I could not
verify, it says NOT VERIFIED and why.

---

## THE HEADLINE

**A "next action" field already exists, is already written by twelve workflows, and is
already painted on the Client Control Panel.** It is
`clients.custom_fields.employee_next_action`.

- Painted: `public/app/client-control-panel.html:889`
  `setText("ccp-next-action", cf.employee_next_action);`
- The panel it fills: `public/app/client-control-panel.html:469-472`
  — eyebrow `Next Action`, value `<div class="na-main" id="ccp-next-action">—</div>`
- Right underneath it, same panel: `Why it hasn't happened` (line 480) and the blocker
  list (line 481), filled by `paintBlockers(d.open_blockers, hold)` at line 897.

So the screen already has a **Next Action + Why it hasn't happened** pair. The work Chris
wants is **extending what feeds those two boxes**, not building a tenth derivation.

There is **no** function anywhere named `nextAction`, `nextBestAction`, `whatNext`,
`nextStep` or similar. Verified by grep over `src/` and `api/` for
`function (next|derive)[A-Za-z]*Action|nextBestAction|next_best|whatNext|nextStep` —
zero hits. So there is nothing to collide with; the risk is duplicating
`employee_next_action`, not duplicating a function.

---

# PART A — REUSE

## A1. `openBlockers()` — `src/http/client-detail.mjs:169-215`

Opened and read in full. **Confirmed severity-ranked and confirmed on the wire to the CCP.**

Five sources of blockers, in the order they are pushed:

| # | Source rows | `kind` | `severity` | Label | Line |
|---|---|---|---|---|---|
| 1 | `tasks` where `!t.done` | `task` | `normal` | the task's own title | 173-180 |
| 2 | `fundingRounds` where `hold_reason` | `funding_hold` | `high` | `Round <n> on hold` | 182-188 |
| 3 | `invoices` where `balance_due > 0` | `balance_due` | `high` if `due_at` is past, else `normal` | `Invoice overdue` / `Balance outstanding` | 190-198 |
| 4 | `custom_fields.crs_paid === false` | `gate` | `high` | `CRS not paid` | 202-205 |
| 5 | `custom_fields.deposit_paid === false` AND `sale_closed === true` | `gate` | `high` | `Deposit outstanding` | 206-209 |

Ranking, verbatim, lines 212-213:

```js
const order = { high: 0, normal: 1 };
blockers.sort((a, b) => order[a.severity] - order[b.severity]);
```

Two severities only. Sort is stable, so within `high` the order is funding holds →
overdue invoices → gates, and within `normal` it is tasks → non-overdue balances.

Every blocker carries a `source` string naming the row or flag it came from
(`funding_rounds`, `invoices`, `custom_fields.crs_paid`, the task's `source_workflow`).
Task blockers carry `detail: "owned by <role>"` or `"unassigned"` (line 177).

**Wiring, verified end to end:**
- `openBlockers` is called once, at `src/http/client-detail.mjs:314`, inside
  `clientDetailExtras()` (defined line 306).
- `clientDetailExtras` is imported and called by `api/dashboard/client.mjs:6` and
  `api/dashboard/client.mjs:125`.
- The CCP reads it at `public/app/client-control-panel.html:897`.
- `paintBlockers` is at `public/app/client-control-panel.html:793-820`. It prepends a
  synthetic `{label:"On hold", detail: holdReason}` row when a hold reason is not already
  represented (lines 799-803), and hides the "Why it hasn't happened" label when the list
  is empty (line 804).

**Gap:** `paintBlockers` renders only `label` and `detail`. It ignores `severity`, `kind`,
`source` and `id`. So the ranking exists in the data and is invisible on screen — the high
items are simply first in the list, with no visual difference.

## A2. `STAGE_SLA` / `isBreached` — `src/repair/sla.mjs`

Opened and read in full (34 lines).

`STAGE_SLA` (lines 3-12) maps eight repair stages to a clock and a task name:

| Stage | Clock | `task` name |
|---|---|---|
| `intake` | 3 days (`businessDays: true`) | `chase_contract` |
| `awaiting_documents` | 14 days | `owner_contact_client` |
| `analysis` | 1 hour | `engineering_engine_failure` |
| `letters_generated` | 30 minutes | `engineering_generation_or_variance` |
| `ready_to_send` | 4 hours | `dispatch_failure` |
| `in_transit` | 10 days | `check_postgrid_tracking` |
| `awaiting_response` | 5 days after `responseDueAt` | `bureau_deadline_breach` |
| `response_received` | 24 hours | `owner_reviews_parse` |

`isBreached({stageKey, enteredAt, asOf, responseDueAt})` (lines 14-31) returns
`{breached, task, sla}`.

**THIS IS DEAD CODE. Corrects the round-1 claim that it "maps stage plus age to a named
employee task."** It maps stage plus age to a **string**, and nothing consumes the string.

Proof, all four checks run:
- `isBreached` has exactly one non-test caller: `src/repair/handlers.mjs:50`, inside
  `evaluateSlaBreach(card)` (defined `src/repair/handlers.mjs:49-56`).
- `evaluateSlaBreach` has **zero** callers. Grep for `evaluateSlaBreach` across the whole
  repo (excluding `node_modules`) returns exactly one line: its own definition.
- The eight task-name strings (`chase_contract`, `owner_contact_client`, …) appear
  **nowhere else in the repository** — not in a `createTask` call, not in SQL, not in any
  HTML. Grep over the whole tree returns only `src/repair/sla.mjs:4-11`.
- `STAGE_SLA` therefore carries **no owning role**. `createTask` requires one
  (`src/lib/create-task.mjs:65-67`), so these strings cannot become tasks as they stand.

Note `sla.businessDays` is declared on `intake` (line 4) but `isBreached` never reads it —
lines 26-29 handle only `minutes`, `hours`, `days`. A 3-day intake SLA is therefore
measured in calendar days, not business days. That matters because CROA's hold is
**business** days (see B2).

`STALLED_STAGE = "stalled"` (line 34) IS live — used by
`src/repair/pipeline.mjs:4` and `:34`.

## A3. `createTask` — `src/lib/create-task.mjs`

**The "41 sites" figure is NOT VERIFIED. I count 36.** Grep for `createTask(` over `src/`,
`api/` and `netlify/`, excluding `*.test.mjs`, comment lines, the wrapper name
`createTaskOnce`, import statements and the function's own definition, returns 37 lines,
one of which is a doc comment (`src/lib/create-task.mjs:39`). That leaves **36 direct
invocation sites**. There are no `createTask` calls in `api/` or `netlify/` at all.

Several of those 36 are inside per-file wrappers (`createTaskOnce`, `createRoutingTask`,
`safeTask`) that are themselves called from two places, so the number of *distinct task
outcomes* is higher than 36. I did not chase every wrapper to a final count, so treat 36
as the verified floor for call sites.

**The role IS required and IS enforced.** `src/lib/create-task.mjs:65-67`:

```js
if (!assigneeRole) {
  throw new Error(`createTask: assigneeRole is required (${sourceWorkflow}: "${title}")`);
}
```

Allowed roles, `src/lib/create-task.mjs:28-35`:
`owner`, `admin`, `funding_advisor`, `closer`, `inquiry_specialist`, `setter`,
`sales_manager`.

**Roles actually used by production call sites** (read from each file):

| Role | Call sites |
|---|---|
| `funding_advisor` | ai-set-04, c-05, c-06, dpc-03, dpc-05, f-01, f-07, f-08, f-09, f-10, f-11, n-06, u-02, u-05, customer-insights (×2, via `ASSIGNEE_ROLE` at `src/handlers/customer-insights.mjs:11`) |
| `closer` | contracts/notify.mjs:369, comms.mjs:455, comms.mjs:516, contract-signed.mjs (`SIGNED_TASK_ROLE`, `src/handlers/contract-signed.mjs:84`), s-05a, s-06, s-08, seed-ui-coverage default |
| `admin` | ds-02, hiring/bench.mjs:56 and :105, hiring/pipeline.mjs:271 and :315, messaging/gate.mjs (`GATE_TASK_ROLE`, line 59), adapters/mailgun.mjs (`COMPLAINT_TASK_ROLE`, line 354), partners/onboarding.mjs default (line 38) |
| `inquiry_specialist` | c-02, c-03, inquiry-ops/gate.mjs:120 |
| `owner` | commas-disputes (`DISPUTE_ROLE` line 45, `REFUND_ROLE` line 46), messaging/outbox.mjs:306 |

**`setter` and `sales_manager` are allowed by `createTask` but no production call site ever
uses them.** Verified: neither string appears as an `assigneeRole:` value anywhere.

**Distinct task titles** (constants resolved to their literal text):

*Funding advisor*
- `3-way handoff — advisor follow-up on UnderwriteIQ results` (ai-set-04:27)
- `Pre-funding review — CRS complete` (c-05:40)
- `Cannot start funding — CRS incomplete` (c-05:46)
- `Declined after CRS — document reason + confirm messaging sent` (c-06:76)
- `Yes — send contract + collect payment` (dpc-03:104)
- `Reschedule — send booking link` (dpc-03:111)
- `No progress 72h — investigate` (dpc-05:71)
- `Assign pod roles for funding client` (f-01, `POD_TASK_TITLE` line 24)
- `Fix fee lock/percent before invoicing` (f-07:61)
- `Invoice client — approved <amount> @ <pct>% (calculate + send)` (f-07:90)
- `30-day check-in + prep for next wave` (f-08, `TASK_TITLE` line 17)
- `Funding no-path decision` (f-09, `TASK_TITLE` line 25)
- `Provision funding inbox: confirm forwarding + bank-only filter` (f-10, `TASK_TITLE` line 25)
- `DOCS NEEDED: collect docs (see BANK_INBOX log)` / `DENIED: log denial + adjust plan` / `ACTION REQUIRED: call/verify/sign (see BANK_INBOX log)` / `APP RECEIVED: email logged` (f-11:28-32)
- `Second wave funding — outreach + prep next round` (n-06, `TASK_TITLE` line 27)
- `Investigate missing analyzer identity/path` (u-02:37)
- `Fix UnderwriteIQ mapping — critical fields missing` (u-05:27)
- `Post-funding Google Meet interview` (customer-insights, line 15)
- `Mid-journey check-in` (customer-insights, `MID_TASK_TITLE` line 18)

*Closer*
- `Contract not signed: <title> — <name> has not signed` (contracts/notify.mjs:365)
- `Contract signed: <title> — <who>` (contract-signed.mjs:201)
- `<booking prefix> booked` / `<booking prefix> rescheduled` (comms.mjs:319-320)
- `No-show recovery — rebook` (s-05a:34)
- `Funding intake — pull CRS` (s-06:25)
- `Funding didn't buy — follow-up` (s-08:21)

*Inquiry specialist*
- `Remove inquiries — round in progress` (c-02:36)
- `Fraud alert present — clear before resuming` (c-03:39)
- `Start next funding round — clean file` (c-03:46)
- `All bureaus gated — inquiry removal blocking lender match` (inquiry-ops/gate.mjs:117)

*Admin*
- `Send DIY invoice (Commas checkout) — confirm payment captured` (ds-02:43)
- `Held: outbound message uses restricted wording` (messaging/gate.mjs:286)
- `Spam complaint — review the template that sent this` (mailgun.mjs:553)
- `Bench short for <role>: <n> of <target>` (bench.mjs:50)
- `<n>-day trial review due: <name> (<role>)` (bench.mjs:102)
- `Send candidate feedback: application <id>` (pipeline.mjs:269)
- `Group interview 'no' — decide and record: application <id>` (pipeline.mjs:313)
- `Partner onboarding: <title>` (partners/onboarding.mjs:61)

*Owner*
- `URGENT — payment disputed: <amount>` (commas-disputes.mjs:78)
- `Refund issued: <amount>` (commas-disputes.mjs:109)
- one mail-failure alert title, built at runtime (`src/messaging/outbox.mjs:301-306`)

**Yes — a task with an owning role IS a next action, and `openBlockers` already turns every
open task into a blocker row with `owned by <role>` in its detail line
(`src/http/client-detail.mjs:173-180`).** That path already works.

## A4. `src/config/product-path.mjs` — the repair-only guard

Opened and read in full (38 lines).

```
line 6:  const FUNDING_TIERS = ["FUNDING_PLUS_REPAIR", "FULL_FUNDING", "PREMIUM_STACK"];
line 7:  const REPAIR_TIERS  = ["REPAIR_ONLY"];
line 9:  isFundingPath(tier)     → false on null/unknown (fails closed)
line 14: isRepairOnlyPath(tier)  → true only for REPAIR_ONLY
line 19: clientOutcomeTier(db, clientId) → SELECT outcome_tier FROM clients WHERE id = $1
line 35: resolveOutcomeTier(db, clientId, payload) → payload.outcomeTier first, column second
```

The header comment (line 2) says the ladder is verified against the live engine
(`underwrite-iq-lite route-outcome.js:15-20`). That external file is outside this repo, so
**NOT VERIFIED** by me; I verified only that the two arrays hold those five strings.

**Nine production files gate on it.** Verified list, each opened at the cited line:
`src/sales/closer-deck.mjs:612`, `u-02:59-77`, `bs-01-precall-launcher:246-258`,
`ds-02:115-116`, `f-01:52-53`, `f-09:72-73`, `ds-01-repair-referral:65-66`,
`s-06:37-38`, `c-06:172-184`.

### THE REPAIR-ONLY BUG, CONFIRMED

**`src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45` writes
`employee_next_action: "Apply for Funding"` with no product-path check at all.**

Verbatim, line 45:

```js
await step.run("set-ready-for-next-round", () => mergeCustomFields(db, clientId, { ready_for_next_round: true, employee_next_action: "Apply for Funding" }));
```

The file's imports are lines 6-11 and `../config/product-path.mjs` is not among them. The
only gate on that branch is `event.payload?.fraudAlert` (line 36). So a `REPAIR_ONLY`
client whose inquiry is removed gets `Apply for Funding` written to their record, and the
Client Control Panel paints it at `public/app/client-control-panel.html:889`.

`mergeCustomFields` (`src/workflows/custom-fields.mjs:5-11`) writes straight into
`clients.custom_fields` jsonb, which is exactly what the CCP reads.

This is the failure mode the task description named, and it is live today, before any new
work is done.

## A5. `clients.outcome_tier` — CONFIRMED, and already on the wire

`db/schema/001_init.sql:60`, opened and read verbatim:

```sql
  outcome_tier      text,   -- FRAUD_HOLD|MANUAL_REVIEW|REPAIR_ONLY|FUNDING_PLUS_REPAIR|FULL_FUNDING|PREMIUM_STACK
```

Six tiers, exactly as reported. It is a bare `text` column — **no CHECK constraint**, so
the six names are a comment, not a rule. (`outcome_tier` also appears at `001_init.sql:315`
and `:358` on other tables; those are different columns.)

**Who writes it (production paths):**
- `src/handlers/client-lifecycle.mjs:432` — `onDecisionRendered`, on `decision.rendered`:
  `UPDATE clients SET outcome_tier = $2 WHERE id = $1`, guarded by `if (p.outcomeTier)`
  at line 431. This is the canonical writer.
- `src/finance/crs-pull.mjs:246` and `:250` — `persistOutcomeTier`. Line 234's comment
  states a simulated pull never writes it.
- Demo/verification only: `src/demo/platform-seed.mjs:73`,
  `src/demo/simulate-client.mjs:346`, `src/verification/journeys/diy.mjs:108`,
  `src/verification/journeys/funding.mjs:281`.

`src/handlers/client-lifecycle.mjs:385` writes `outcome_tier` on **`crs_results`**, not on
`clients` — different table, do not confuse them.

**Already on the wire to screens — three of them:**
- CCP: `api/dashboard/client.mjs:66` selects it → `public/app/client-control-panel.html:845`
  `setText("ccp-tier", c.outcome_tier);` (label markup at line 569).
- Pipeline board: `api/dashboard/pipeline.mjs:42` and `:101` →
  `public/app/pipeline.html:1102`, `:1364`, `:1444`.
- Client list: `api/dashboard/clients.mjs:17` and `:82`.

**So a Phase-1 next-action derivation needs no new column and no new endpoint to know the
client's path. The tier is already there.**

## A6. `src/sales/cockpit.mjs`, `src/demo/roster.mjs`, `src/repair/pipeline.mjs`

**`src/sales/cockpit.mjs` (367 lines, read in full).** `buildCockpit` (line 18) assembles
fourteen parallel reads into one payload. Derivations it does:
- `close_rate: held ? deposits / held : null` (line 183)
- `staff.shift.on_shift` from an open `shifts` row (lines 168-175)
- `summarizeCrs` (line 269) — `available: false` + a `reason` string when there is no
  `crs_results` row (lines 270-276)
- `underwrite.lenders_reason` when zero lenders matched (lines 210-212)
- `quietClients` (line 346) — deposits older than 7 days where `funded IS NOT TRUE`
- `upcomingCalls` (line 326) — `tasks` with `assignee_role = 'closer'`, future `due_at`,
  no `call_outcomes` row

**It is not a next-action derivation.** It surfaces facts and reasons-for-absence. It has
no ranking and no notion of a blocked state.

**Verified defect worth noting:** `buildCockpit` SELECTs `c.outcome_tier` at line 25 and
**never returns it**. The `client` block it builds (lines 188-203) has no `outcome_tier`
key, and grep confirms line 25 is the only occurrence of the string in the file. So the
closer's cockpit reads the client's funding-vs-repair path out of the database and throws
it away.

**`src/demo/roster.mjs` (72 lines, read in full).** No derivation of any kind. It is a
flat list of twelve invented demo clients with a hardcoded `tier` per row (lines 7-18),
21 invented demo lenders (lines 38-67), and three constant arrays (lines 70-72). Nothing
computes anything. **Round-1 hypothesis that this holds a status derivation: wrong.**

**`src/repair/pipeline.mjs` (56 lines, read in full).** Two things:
- `REPAIR_STAGES` (lines 8-22) — thirteen stage keys, `intake` through `cancelled`
- `EVENT_STAGE` (lines 39-56) — maps fifteen `repair.*` event names to a stage key

It moves cards. It derives no status and names no owner.

---

## A7. THE ANSWER TO "IS THIS EXTENDING ONE, OR WRITING A TENTH?"

**Extending. Two things, both already built, both already painted on the same panel.**

1. **`employee_next_action`** — a stored string, written by twelve workflows, painted at
   `client-control-panel.html:889`. Values in use today, all read from the code:
   `Clear Fraud Alert` (c-03:37), `Apply for Funding` (c-03:45), `Remove Inquiries`
   (c-02:54, f-03:35), `Prepare Next Funding Round` (f-04:32, f-11:62), `Collect Documents`
   (f-06:32, f-06:48, f-02:43, f-01:65), `Pull CRS` (c-05:44, s-06:42),
   `Review Funding File` (c-05:39), `Closed/Stop` (c-06:162),
   `Collect inquiry identity packet` (`src/handlers/inquiry-docs.mjs:27`).

2. **`openBlockers()`** — the "why it hasn't happened" list, already severity-ranked,
   already delivered by `/api/dashboard/client`.

What is genuinely missing is not a tenth helper. It is three things:

- **Nothing derives the next action from current state.** `employee_next_action` is a
  *stamp* left behind by whichever workflow ran last. If no workflow fired, the box is
  blank. If the wrong one fired last, the box is wrong — see A4.
- **Nothing checks the product path before stamping it.** c-03 and c-05 stamp without
  reading `outcome_tier`.
- **The repair rail has no next-action feed at all.** `STAGE_SLA` names eight tasks and
  none of them reach a person (A2).

The cheapest correct Phase 1 is: a single derivation that reads
`clients.outcome_tier` + `custom_fields` + open `tasks` + `funding_rounds` + `invoices` —
all five of which `api/dashboard/client.mjs` already loads — and returns the next action,
then feeds the **existing** `ccp-next-action` box instead of the raw stamp. `openBlockers`
already has that exact argument shape (`{client, tasks, fundingRounds, invoices}`,
`src/http/client-detail.mjs:169`). Putting the new function beside it in the same file, and
returning it from the same `clientDetailExtras` (line 306), adds no endpoint, no column and
no screen.

---

# PART B — COMPLIANCE (CLAUDE.md §7)

## B1. Credit-pull type — soft vs hard

**Soft and hard are NOT distinguishable in the data, because only soft exists.**

Verified:
- The ledger table is `soft_pull_requests` (`db/migrations/077_soft_pull_requests.sql:118`).
  Its columns include `reason`, `cost_cents`, `crs_result_id`, `status`. **There is no
  pull-type or hard/soft column.** The table comment (line 224) calls it
  "Audit trail for consumer-credit soft pulls".
- The consent kinds are a closed set of two:
  `db/migrations/167_dispute_authorization_consent.sql:41`
  `CHECK (kind IN ('soft_pull_consent', 'dispute_authorization'))`, and
  `src/consent/index.mjs:66`
  `export const CONSENT_KINDS = Object.freeze(["soft_pull_consent", "dispute_authorization"]);`
- Grep for `hard_pull|hard pull|hardPull|hard inquiry` across `db/`, `src/`, `api/`: every
  hit is about **third-party** hard inquiries appearing on the consumer's report
  (`src/metro2/checks/inquiries.mjs:39` and `:132`, `src/metro2/rules/citations.mjs:260`
  and `:275`, `src/inquiry-ops/letter-draft.mjs:103`) or is a forbidden-phrase guardrail
  (`src/agents/guardrails.mjs:197`). None describes a pull this platform performs.

**So a screen cannot say the wrong pull type, because there is only one type. Good.**

### Could a screen say "Pull CRS" when a pull is not permitted? **YES. Today. It already does.**

Two gates exist and both are real:

**Gate 1 — consent.** `src/finance/soft-pulls.mjs:306-314`, opened and read:

```js
const consent = await consentStatus(db, { orgId, clientId, kind: "soft_pull_consent" });
if (!consent.valid) {
  throw new SoftPullError(consentRefusal(consent.reason), { status: 403, code: "consent_required" });
}
```

The comment above it (lines 289-305) is emphatic that this runs FIRST, before the replay
and open-request guards, and that nothing caches the answer so a revocation bites
immediately. This is well built.

**Gate 2 — payment.** `custom_fields.crs_paid`, written by
`src/handlers/client-lifecycle.mjs:324` (`mergeCustomFields(db, clientId, { crs_paid: true })`),
and surfaced as a `high`-severity blocker at `src/http/client-detail.mjs:202-205`.

**The CCP already respects gate 1 — for the BUTTON only.**
`public/app/client-control-panel.html:1189-1231` fetches
`/api/consent/capture?client_id=…&kind=soft_pull_consent` and calls
`setPullsEnabled(false, why)` (line 1221) when the consent is not valid.
`setPullsEnabled` (lines 1033-1040) sets `b.disabled = !on` on the pull buttons.

**But the Next Action text is not gated.** Line 889 paints `cf.employee_next_action`
unconditionally. And two workflows stamp `"Pull CRS"` without reading consent or `crs_paid`:

- `src/workflows/c-05-pre-funding-review.mjs:44` — the only thing it checks is
  `custom_fields.crs_status === "Complete"` (line 34). No consent read, no `crs_paid` read.
- `src/workflows/s-06-post-call-funding-purchased.mjs:42` — checks `isFundingPath` (lines
  37-38), which is correct, but does not check consent.

Result on screen right now: **"Next Action: Pull CRS" in large type, above a greyed-out pull
button.** The text tells a closer to do something the system will refuse.

`src/workflows/c-00-crs-soft-pull-request.mjs` was read in full (141 lines) and is the
*correct* model. It refuses cleanly and does not report success on a refusal — lines 97-105
return `{done:true, pulled:false, reason:"consent_required"}` rather than throwing. Line
78-80 refuses with `no_account_for_attribution` when there is no account to attribute the
pull to. Its header (lines 13-32) is explicit that a status label without a report is the
bug it was written to fix. Any new derivation should copy this posture.

## B2. CROA's three-business-day hold — `src/repair/croa.mjs`

Opened and read in full (46 lines). **Confirmed at the exact lines given.**

- `croaReleaseDate(enrolledAtIso)` — **line 25**. Returns `addBusinessDays(day, 3)`
  (line 27). `addBusinessDays` (lines 12-23) skips Saturday and Sunday, so the window is
  genuinely business days.
- `canLeaveIntake({enrolledAt, asOf, contract})` — line 34. **Lines 38-41**, verbatim:

```js
  const releaseDate = croaReleaseDate(enrolledAt);
  const today = String(asOf || new Date().toISOString()).slice(0, 10);
  if (today < releaseDate) {
    return { ok: false, reason: "croa_3_day_hold", releaseDate };
  }
```

It also refuses on `missing_enrolled_at` (line 35) and on `contract_incomplete` (lines
36-37), where the six required contract keys are `terms_and_cost`,
`services_description`, `estimated_timeline`, `business_name_address`,
`cancellation_notice`, `disclosure_delivered_at` (lines 3-10).

**Where it is enforced, and how narrowly:** exactly one caller,
`src/repair/handlers.mjs:20-27`. Read in full. It runs **only** on the event
`repair.docs.needed` (line 18) and **only** when `event.payload?.fromIntake` is truthy
(line 25). Lines 14-16 are an empty `if` block with a comment and no body — the
`repair.enrolled` and `repair.docs.complete` events check nothing.

**Must a repair client inside the window be shown no actionable next step?**

The gate stops a **card from moving stages**. It does not stop anything from being
displayed, and nothing in the repair rail writes `employee_next_action` at all (verified —
none of the `repair.*` handlers appear in the `employee_next_action` grep). So today the
Next Action box for a repair client in the CROA window shows whatever a *sales* workflow
last stamped there — which for a client who came off an inquiry removal is
`"Apply for Funding"` (A4).

For Phase 1 the safe rule is: **inside the CROA window, the next action must be a
preparation step, never a step that performs or bills the repair service.** `canLeaveIntake`
already returns `{ok:false, reason:"croa_3_day_hold", releaseDate}` — the `releaseDate` is
exactly the "not before this date" a screen needs. Reuse it; do not recompute the window.

Two caveats found while reading:
- The gate is not wired to `repair.enrolled` (the empty block at handlers.mjs:14-16), so
  a Phase 1 derivation must call `canLeaveIntake` itself rather than trusting that a card
  in `intake` means the gate ran.
- `STAGE_SLA.intake` is `{days: 3, businessDays: true}` (`sla.mjs:4`) but `isBreached`
  never reads `businessDays` (lines 26-29). Its 3-day clock and CROA's 3-business-day
  window are therefore **different lengths** and will disagree across a weekend. Do not
  use the SLA clock as a stand-in for the CROA release date.

## B3. Consent capture — does the inquiry identity packet include an authorization document?

**YES. Confirmed at the exact lines given.** `src/inquiry-ops/doc-gate.mjs`, read in full.

- `PACKET_SUBTYPES.AUTHORIZATION = "soft_pull_consent"` — **line 13**.
- **Lines 33-35**, verbatim:

```js
  const hasAuth =
    bySubtype.has(PACKET_SUBTYPES.AUTHORIZATION) ||
    rows.some((d) => d && d.kind === KINDS.AUTHORIZATION);
```

- **Line 41**: `if (!hasAuth) missing.push("authorization");`

Two ways to satisfy it: a document whose `subtype` is `soft_pull_consent`, or any document
whose `kind` is `authorization`. The full required set is government photo ID (line 39),
proof of address **or** bank statement (lines 30-32, 40), and authorization (line 41). SSN
card is conditional on `opts.requireSsn` (line 42), decided by `disputeNeedsSsn` (lines
57-63).

Note the string pushed at line 41 is `"authorization"`, not the subtype value
`"soft_pull_consent"` — a screen listing `missing` gets a friendly word, not a key. Fine
to display as-is.

`api/consent/capture.mjs` was read (first 120 lines). Relevant facts:
- It writes `client_consents` rows and pulls nobody's credit (lines 16-19).
- Consent text is never taken from the request body — the caller sends a version and the
  server looks up the words (lines 28-32).
- **Owner decision, 2026-08-19, recorded at lines 42-46: identity capture is client
  self-serve. Staff never see, type or handle a Social Security number.** The GET returns a
  boolean for whether an identity is held and a signed link, and nothing else (lines 34-40).
- Roles that may record or revoke a consent: `owner`, `admin`, `closer`, `funding_advisor`
  (line 92), deliberately the same set as `SOFT_PULL_ROLES` in `api/finance/soft-pull.mjs`.

**Consequence for Phase 1: a next action must never be "get their SSN" or route a staff
member to a field that takes one.** The correct next action when identity is missing is
"send the client their signed link", which the CCP already implements as the handoff block
(lines 1042-1058).

## B4. Fee timing and refunds — the Lock Fee area

**Two columns exist in the Lock Fee area and NOTHING reads or writes either one.**

`db/schema/005_client_custom_fields.sql`, both lines opened:
- line 245: `funding_fee_locked  text[],   -- CHECKBOX · Funding Fee Locked · contact.funding_fee_locked`
- line 273: `funding_fee_locked_timestamp  date,   -- DATE · Funding Fee Locked Timestamp · contact.funding_fee_locked_timestamp`

Grep for `funding_fee_locked` across the entire repository, all file types, excluding
`node_modules`: **exactly two hits, both of them the schema lines above.** No `.mjs`, no
`.html`, no other `.sql`. The columns are dead.

(Round 1's failure mode here was a LIKE pattern like `'%lock%fee%'`, which cannot match
`funding_fee_locked` because the words are the other way round. I grepped the schema files
by concept instead.)

**What actually handles fee timing:** `src/workflows/f-07-funding-locked.mjs`, read in full
(100 lines). Trigger is `round.funded` (line 98).

- Line 54: `const feeReady = approvedAmount != null && feePercent != null;`
- Lines 58-63: if the fee is not ready, it tags `ops:action-required` and raises the task
  **`Fix fee lock/percent before invoicing`** to `funding_advisor` (line 61). No invoice.
- Line 74: `const feeAmount = Math.round(Number(approvedAmount) * Number(feePercent)) / 100;`
- Lines 75-88: creates the success-fee invoice, `source: "funding_success_fee"`.
- Line 90: raises **`Invoice client — approved <amount> @ <pct>% (calculate + send)`**.

Lines 70-72 carry a live flag for Chris: the formula assumes `approvedAmount` is the
funded base, not the fee. Unresolved in the code. Not my scope; recorded.

**The other money task:** `src/workflows/ds-02-diy-letters.mjs:43` raises
`Send DIY invoice (Commas checkout) — confirm payment captured` to `admin`. Its trigger is
`payment.received` (line 161), it is hard-gated to `REPAIR_ONLY` (lines 115-116, fails
closed on a null tier), and the invoice it writes at lines 124-136 is an internal ledger
entry after money has already arrived — not a demand for money up front.

**The advance-fee rule is documented.** `docs/compliance/creative-block-reasons.md:119`:
`advance-fee` — charging or advertising a fee before the credit-repair work is finished —
severity `block`, cited to CROA 15 U.S.C. 1679b(b). The rule set is enforced today only on
marketing creative (`public/app/creative-factory.html:722`,
`public/app/social-studio.html:720-730`), not on operational screens.

**Consequence for Phase 1: any next action whose text asks a person to invoice, charge or
collect from a repair client is inside the fee-timing rule.** Two of the existing task
titles already are (`Invoice client — …`, `Send DIY invoice …`). If the derivation
promotes a task title into the Next Action box, it inherits that exposure.

---

## B5. WHICH PARTS OF A PHASE 1 BUILD NEED THE LABEL

`COMPLIANCE REVIEW REQUIRED` goes at the top of the summary for any change touching:
dispute logic, credit-repair messaging, fee timing, refund behavior, payment rails, consent
capture, or credit-pull type (CLAUDE.md §7).

**These parts need the label:**

| Part of the build | Which §7 category | Why |
|---|---|---|
| Showing, suppressing or reordering `"Pull CRS"` as a next action | **credit-pull type** and **consent capture** | The text is an instruction to perform a consumer-credit pull. Gated at `src/finance/soft-pulls.mjs:306-314`; the text is currently ungated (`client-control-panel.html:889`). |
| Any next action derived for a `REPAIR_ONLY` client | **credit-repair messaging** | The words shown to staff about a credit-repair client are credit-repair messaging. Includes fixing `c-03:45`. |
| Any next action suppressed or shown inside the CROA window | **credit-repair messaging** | `src/repair/croa.mjs:34-41` is the statutory hold. |
| Any next action whose text is "invoice", "charge", "collect" or "send checkout" | **fee timing** | Two existing task titles already say this: `f-07:90`, `ds-02:43`. |
| Surfacing the chargeback or refund tasks as a next action | **refund behavior**, **dispute logic** | `src/handlers/commas-disputes.mjs:78` and `:109`, both owned by `owner`. |
| Anything that reads or displays consent state to decide the text | **consent capture** | `api/consent/capture.mjs`, and the owner decision at its lines 42-46. |

**These parts do NOT need the label:**

- Reading `clients.outcome_tier` (`001_init.sql:60`) — a routing label, already on three
  screens.
- Reordering or re-styling `openBlockers` output (`client-detail.mjs:169-215`) as long as
  the words are unchanged.
- Fixing `buildCockpit` to return the `outcome_tier` it already selects
  (`src/sales/cockpit.mjs:25`).
- Wiring `evaluateSlaBreach` to something, so long as the eight `STAGE_SLA` task names
  (`sla.mjs:4-11`) are internal and none reaches a client.

**Practically: a Phase 1 next-action derivation will touch at least three of the six
categories above. Assume the label is required for the whole build, and say so at the top
of the summary.**

---

## WHAT I COULD NOT VERIFY

- **`createTask` "41 sites"** — NOT VERIFIED. I count 36 direct invocation lines outside
  tests. Some are wrappers called twice, so the count of distinct task outcomes is higher,
  but I did not resolve every wrapper to a final number and will not state one.
- **The CRS tier ladder against the live engine** — `src/config/product-path.mjs:2-3` cites
  `underwrite-iq-lite route-outcome.js:15-20`, which is outside this repository.
  CLAUDE.md §2 forbids reading it. NOT VERIFIED beyond the two arrays in this repo.
- **Any live row counts** — I ran no database queries at all. Everything here is read from
  files in the working tree at commit `74c74247`, so no finding of mine can be the round-1
  "zero rows means empty" mistake. (`db/migrations/104_app_role.sql` and
  `db/migrations/200_dispute_rls_policies.sql` both exist; I confirmed the files are there
  but did not need them, since I queried nothing.)
- **Whether `f-07`'s fee formula is right** — the file flags its own assumption at lines
  70-72 and nothing resolves it. Recorded, not investigated.
