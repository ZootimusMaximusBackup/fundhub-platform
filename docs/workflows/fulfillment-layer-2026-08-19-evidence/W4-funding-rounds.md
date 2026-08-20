# W4 — Funding rounds half of Employee Next Action

**Date:** 2026-08-19 · **Agent:** W4 · **Scope:** findings only. No product code written.
No migration. No write. No new screen. Only this file was created.

Values owned: **Review Funding File · Prepare Next Round · Apply for Funding · Ready to Fund**

Every claim carries `file:line`. Where nothing exists it says **NOT FOUND** and names
where I looked.

---

## HEADLINE — read this first

**`funding_rounds.status` is not a state machine. In production it holds exactly two
values: `started` and `funded`.** Nothing else is ever written.

- `src/handlers/money-chain.mjs:671` — `ensureFundingRound(..., { status = "started" })`
- `src/handlers/money-chain.mjs:737` — the only caller, on `round.started`, passes `"started"`
- `src/handlers/money-chain.mjs:828` — `SET status = 'funded'`, on `round.funded`
- `src/demo/platform-seed.mjs:106` — writes `'funded'` or `'open'`, **`is_demo = true` only**

**There is no `submitted` status. There is no `approved` status. There is no `closed`
status.** `round.submitted` and `round.approved` have **no** bus listener that touches the
row — verified: the only `on("round.*")` registrations in the tree are
`src/handlers/money-chain.mjs:909` (`round.started`), `:910` (`round.funded`),
`src/handlers/customer-insights.mjs:110` (`round.funded`), and
`src/handlers/inquiry-gate.mjs:280` (`round.closeout`). So a round that has been
submitted to ten banks and approved by three still reads `status = 'started'`.

**And `src/funding/card-stacking-rounds.mjs:219` branches on
`status !== "funded" && status !== "closed"` — `'closed'` is read and never written.**
That branch decides whether re-parking a card on `apply_now` reuses the open round number
or allocates N+1 (`src/funding/card-stacking-rounds.mjs:213-224`). Because `'closed'` is
unreachable, only `'funded'` ever forces a new round number.

**The real state machine is the pipeline, not the round row.** `funding_card_stacking`
stages, seeded at `db/seed/002_pipelines.sql:34-36`:

| stage key | name | sort | emits (`src/funding/card-stacking-rounds.mjs:21-28`) |
|---|---|---|---|
| `apply_now` | Apply Now | 0 | `round.started` |
| `round_submitted` | Round Submitted | 1 | `round.submitted` |
| `approved` | Approved | 2 | `round.approved` |
| `action_required` | Action Required | 3 | *(none)* |
| `funded` | Funded | 4 | `round.funded` |
| `closed` | Closed | 5 | *(none)* |

Staff move the card (`src/workflows/cards.mjs:17-119`); the move emits the event
(`src/workflows/cards.mjs:90-111`); the event sets `employee_next_action`. **The card
stage is the signal with six values. The round row is a two-value shadow of it.**

**Cost note for whoever builds:** the card stage is NOT returned by
`GET /api/dashboard/client` — that endpoint returns `funding_rounds` rows
(`api/dashboard/client.mjs:98-102`, `:153`) and no `cards`/`pipeline_stages` join
(grep for `cards`/`pipeline` in `api/dashboard/client.mjs` → only `pipeline_ids` at `:67`).
It IS already loaded per-client by `src/sales/cockpit.mjs:74-82`
(`stage_key`, `stage_name`, `pipeline_key`, surfaced at `src/sales/cockpit.mjs:202`) and
per-board by `api/dashboard/pipeline.mjs`.

---

## The complete funding-round state machine

### The row

`funding_rounds` — `db/schema/001_init.sql:119-133`:
`id, org_id, client_id, round_number, status (NOT NULL, :124), product,
submitted_amount, approved_amount (:127), funded_amount (:128), hold_reason (:129),
conditions jsonb (:130), created_at, updated_at`.
Later columns: `source_event_id` (`db/migrations/137_money_chain_idempotency.sql:18`),
`is_demo` (`db/migrations/148_demo_mode.sql:7`).
Unique keys: `(client_id, round_number)` (`db/migrations/137_money_chain_idempotency.sql:27-28`).

### Every transition

| From | Trigger | Writer | To | Evidence |
|---|---|---|---|---|
| *(no row)* | `round.started` | money-chain | `status='started'` (INSERT) | `src/handlers/money-chain.mjs:708-726`, `:737` |
| `started` | `round.submitted` | **nothing** | `started` (unchanged) | no `on("round.submitted")` anywhere |
| `started` | `round.approved` | **nothing** | `started` (unchanged) | no `on("round.approved")` anywhere |
| `started` | `round.funded` | money-chain | `status='funded'` (UPDATE) | `src/handlers/money-chain.mjs:826-835` |
| *(no row)* | `round.funded` | **refused** | *(no row)* | `src/handlers/money-chain.mjs:806-819` — logs and returns `no_prior_round`; never inserts |
| any | `round.closeout` | inquiry-gate | status untouched | `src/handlers/inquiry-gate.mjs:280` |
| any | — | inquiry-gate | appends to `conditions` jsonb only | `src/inquiry-ops/gate.mjs:97-110` |
| `funded` | `apply_now` re-park | card-stacking | new row, `round_number+1` | `src/funding/card-stacking-rounds.mjs:213-224`, `:65-73` |

### `funded` has a hard money guard

A move to the `funded` stage is refused unless a funded amount > 0 can be resolved —
`src/workflows/cards.mjs:48-71` calling `guardFundedAmount`
(`src/funding/card-stacking-rounds.mjs:108-170`). Resolution order
(`src/funding/card-stacking-rounds.mjs:88-102`): explicit `fundedAmount` → explicit
`approvedAmount` → `SUM(applications.approved_amount) WHERE status='Approved'`
(`src/funding/card-stacking-rounds.mjs:41-52`) → refuse. Explicit zero refuses and does
**not** fall through to prefill (`:93-96`).

### Applications — the six-value status that actually moves

`applications` — `db/schema/001_init.sql:137-147`. Allowed statuses are frozen at
`src/lenders/tables.mjs:16-25`: **`Apply`, `Applied`, `Approved`, `Denied`,
`Missing Docs`, `Action Required`**. Every change is audited into `application_decisions`
(`src/applications/status.mjs:67-101`, table at `db/migrations/139_funding_ops.sql:6-22`).
Written through `POST /api/applications` (`api/applications.mjs:1-6`).

**DEFECT (live, mine, in scope):** `src/workflows/f-09-funding-declined-no-path.mjs:49`
tests `a.status === "DENIED"` — uppercase. The only legal value is `"Denied"`
(`src/lenders/tables.mjs:20`). So `allApplicationsDenied` returns **false** whenever the
round has any application row, F-09 exits `pending_applications`
(`src/workflows/f-09-funding-declined-no-path.mjs:76`), and the round hold reason
`"Internal Review"` is never set. It only "works" on rounds with zero application rows,
where `:48` short-circuits to `true`.

---

## Question 1 — `round_hold_reason`: every value, and what each implies

**Two different fields carry this idea, and they are not the same field.**

### (a) `clients.custom_fields.round_hold_reason` — the jsonb key. This is the live one.

| Value | Written at | Chris's status it implies |
|---|---|---|
| `"Awaiting CRS"` | `src/workflows/c-00-crs-soft-pull-request.mjs:69`, `src/workflows/c-05-pre-funding-review.mjs:44` | **Pull CRS** (c-05:44 sets both in one merge) |
| `"New Inquiries"` | `src/workflows/c-02-inquiry-created.mjs:54` | **Remove Inquiries** (same merge) |
| `"Fraud Alert"` | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:37` | **Clear Fraud Alert** (same merge) |
| `"Missing Documents"` | `src/workflows/f-06-funding-conditions-missing-docs.mjs:31` (and `:47` passes the value) | **Collect Documents** (`src/workflows/f-06-...mjs:32`) |
| `null` | `src/workflows/f-06-funding-conditions-missing-docs.mjs:77` | no hold — but see the guard below |

**Four values plus null. That is the whole set.**

The clear at `f-06:77` fires **only** when the current value is exactly
`"Missing Documents"` (`src/workflows/f-06-funding-conditions-missing-docs.mjs:75`).
Deliberate — the comment at `:68-70` says it must not clobber F-09's `"Internal Review"`
or C-02's `"New Inquiries"`. **Consequence: `"Awaiting CRS"`, `"New Inquiries"` and
`"Fraud Alert"` are never cleared by anything.** They are overwritten by the next
workflow that happens to write the key, or they stay forever.

Readers: `src/workflows/bc-01-customer-responsiveness.mjs:35` (compares `"Awaiting CRS"`
only) and `public/app/client-control-panel.html:890`.

**Dead twin:** typed column `client_custom_fields.round_hold_reason`
(`db/schema/005_client_custom_fields.sql:153`, map entry
`db/schema/meta/custom-field-map.json:1141-1148`, `ghlType: SINGLE_OPTIONS`) — **no
writer, no recorded option list**. Same dead-column shape W1 found for
`employee_next_action`.

### (b) `funding_rounds.hold_reason` — the real typed column on the round.

`db/schema/001_init.sql:129`. **Exactly ONE value is ever written: `"Internal Review"`**
— `src/workflows/f-09-funding-declined-no-path.mjs:31` (called with that literal at `:79`).
Nothing ever clears it (grep for `hold_reason` writes: one UPDATE, `f-09:31`).
And because of the `"DENIED"` case bug above, that one writer is unreachable on any round
that has application rows. **In practice this column is almost certainly NULL everywhere.**

Read by `openBlockers` (`src/http/client-detail.mjs:182-187`, severity `high`) and as the
CCP fallback (`public/app/client-control-panel.html:890`).

`"Internal Review"` maps to no chip on Chris's list. Nearest is **Review Funding File**.

### The precedence the CCP already uses

`public/app/client-control-panel.html:890`:
`cf.round_hold_reason || (latestRound && latestRound.hold_reason) || ""`
— contact field wins, round column is the fallback. Any new display should keep that
order or the two will disagree on screen.

---

## Question 2 — "Finalized": the exact column and value

### NOT FOUND.

There is no `Finalized` state, column, or value on a funding round anywhere in this repo.

**Where I looked:** `db/schema/001_init.sql:119-133` (funding_rounds — no such column and
no such status), `db/migrations/139_funding_ops.sql` (funding_closeout /
funding_closeout_items), `db/schema/005_client_custom_fields.sql`,
`db/schema/meta/custom-field-map.json`, and a case-insensitive grep for
`finaliz|finalis` across `src/ api/ db/ netlify/ scripts/ public/app/`.

**The four near-misses, so nobody re-finds them and thinks they are it:**

1. **`file.finalized`** — a canonical event NAME, `src/events/canonical.mjs:22`. It has no
   emitter and no listener: `docs/END-TO-END-VERIFICATION.md:263` and `:439` both record
   it as a canonical event with no workflow listener.
   `src/adapters/lendflow.mjs:176` explicitly declines to emit it —
   *"Terminal housekeeping state. file.finalized is the file-level fact and is not ours to emit."*
2. **`is_finalized`** — appears only as an Airtable **claim to be checked**, not a fact:
   `scripts/extract-airtable.mjs:316` inside `SPEC_EXPECTATIONS` (header at `:301-302`:
   *"These are claims to be checked, not truths"*), mirrored in
   `fundhub-docs/sources/AIRTABLE-BASE-EXTRACT.md:117`. The spec it cites,
   `spec-client-control-panel.md`, **is not in this repo** (W1 looked too).
3. **`funding_closeout.status`** — a real column, `db/migrations/139_funding_ops.sql:41`,
   `NOT NULL DEFAULT 'open'`. **It is always `'open'`.** The only INSERT hardcodes
   `'open'` (`src/funding/closeout.mjs:109-116`) and the only UPDATE
   (`src/funding/closeout.mjs:92-101`) does not touch `status`. The demo seeder also
   writes `'open'` (`src/demo/platform-seed.mjs:124`).
4. **"File Finalized"** — a static label in a hardcoded 8-step stepper,
   `public/app/client-portal.html:468` and `:486`. Display copy, bound to no data.

**What to tell Chris:** the closest thing that means "this round is done" is
`funding_rounds.status = 'funded'` (`src/handlers/money-chain.mjs:828`), optionally with
a `funding_closeout` row existing for that round (`src/funding/closeout.mjs:109`), which
is what records the success fee. If he wants the word "Finalized" next to the round, that
is a **label choice over `status='funded'`**, not an existing field. Do not invent a
column.

---

## Question 3 — a client with NO funding round at all

**Today it shows an em dash.** `public/app/client-control-panel.html:879-884`:
`rounds[0]` is undefined → `roundText = ""` → `setText("ccp-round", "")` → `dash("")`
(`public/app/client-control-panel.html:720-723`) → **`—`**. Same for the System Facts row
`ccp-facts-round`.

That em dash cannot tell "never started" apart from "loaded and empty". Three different
real situations produce it, and existing rows already separate them:

| Situation | Condition on rows that exist today | Honest display |
|---|---|---|
| Never entered funding | no `funding_rounds` row **and** no `cards` row on the `funding_card_stacking` pipeline (`db/seed/002_pipelines.sql:13`, cards read at `src/sales/cockpit.mjs:74-82`) | **"Not in funding yet"** |
| Prequalified, round never started | no `funding_rounds` row **and** `clients.custom_fields->>'total_funding_estimate'` is present (written `src/handlers/client-lifecycle.mjs:448-451`) | **"Prequal only — no round started"** |
| Not a funding client | no `funding_rounds` row **and** `clients.outcome_tier = 'REPAIR_ONLY'` (`db/schema/001_init.sql:44-72`; funding-path test at `src/config/product-path.mjs`, used `src/workflows/f-01-funding-intake.mjs:52-53`) | **"Repair path — no funding round expected"** |

**Never show `$0`.** Money is integer cents and NULL means unknown, which must survive
(CLAUDE.md §12). `money()` at `public/app/client-control-panel.html:724-729` already
returns `—` for null/zero/negative — keep that behaviour.

---

## Question 4 — are "Total Prequal" and "Total Approved" funding round states?

### No. Neither one is a funding round state. Neither is a state at all — both are amounts.

The complete list of `funding_rounds.status` values reachable in production is
**`'started'` and `'funded'`** (`src/handlers/money-chain.mjs:671`, `:737`, `:828`).
Plus `'open'` in demo data only (`src/demo/platform-seed.mjs:106`, `is_demo = true`).
There is no `prequal` status and no `approved` status.

### Total Prequal — a client jsonb amount, written before any round exists

`clients.custom_fields.total_funding_estimate` and `.analyzer_prequal_amount`.
Both written from **one** number in the same merge —
`src/handlers/client-lifecycle.mjs:448-451`, from `payload.fundingEstimate` on
`decision.rendered` (comment at `:443-444`). That fires on the sales side, before a
funding round exists at all. Painted per-client at
`public/app/client-control-panel.html:857`. Already lifted out of jsonb in SQL by
`api/dashboard/clients.mjs:25` and `api/dashboard/pipeline.mjs` CARDS_SQL.
**Nothing sums it across clients.** A "Total Prequal" rollup would be a new aggregate over
that jsonb key.

### Total Approved — three different things wear this name. Two of them are wrong.

1. **`funding_rounds.approved_amount`** — `db/schema/001_init.sql:127`. A real column and
   the honest per-round approval amount. Written only by money-chain: from the event
   payload on insert (`src/handlers/money-chain.mjs:708-726`) and by
   `COALESCE($3, approved_amount)` on `round.funded` (`src/handlers/money-chain.mjs:830`).
   Returned per client by `GET /api/dashboard/client` (`api/dashboard/client.mjs:98-102`)
   and by `GET /api/read/funding-rounds` (`api/read/funding-rounds.mjs:24-25`).
   **This is the column a "Total Approved" rollup should sum.**

2. **The CCP tile labelled "Total Approved" does not read it.**
   `public/app/client-control-panel.html:858-859` reads `client.funded_amount` and falls
   back to prequal when that is empty. **Nothing in production writes
   `clients.funded_amount`.** The only writer in the tree is
   `src/demo/platform-seed.mjs:77`; I grepped every `UPDATE clients` in `src/` and `api/`
   and none of the other twenty-two touch `funded` or `funded_amount`. The code already
   says so out loud at `src/workflows/n-06-renewal-second-wave.mjs:29-30`:
   *"clients.funded is a schema column but nothing writes it."*
   **So on every real client that tile is showing the prequal number under an
   "Approved" label.** That is a live, visible defect and it is exactly the number Chris
   is asking to roll up.

3. **`funding_closeout.total_approved_amount`** — `db/migrations/139_funding_ops.sql:37`.
   **Not an approval total.** It is the fee basis (the funded amount), and
   `src/funding/closeout.mjs:66-68` says so explicitly: *"Column name is historical
   (`total_approved_amount`); value is the fee basis (funded amount). Do not rename
   without a migration."* Do not use it for "Total Approved".

The maintained per-round approval sum that IS real:
`SUM(applications.approved_amount) WHERE status = 'Approved'` —
`src/funding/card-stacking-rounds.mjs:41-52`.

---

## The four values

### 1. Review Funding File

- **signalKind:** json key in `clients.custom_fields` (`employee_next_action`)
- **trueWhen:** a `funding_rounds` row exists for the client (only `round.started` creates
  one — `src/handlers/money-chain.mjs:737`) **AND**
  `clients.custom_fields->>'crs_status' = 'Complete'` **AND** no hold is set
  (`custom_fields->>'round_hold_reason' IS NULL` and the latest round's
  `hold_reason IS NULL`). That is verbatim C-05's branch:
  `src/workflows/c-05-pre-funding-review.mjs:34` reads the flag, `:39` writes the value.
  `crs_status = 'Complete'` has one writer: `src/workflows/u-03-crs-snapshot-sync.mjs:19`.
- **falseWhen:** `crs_status <> 'Complete'` — C-05 takes the other branch and writes
  `round_hold_reason: "Awaiting CRS"` + `employee_next_action: "Pull CRS"`
  (`src/workflows/c-05-pre-funding-review.mjs:44`). Also false when the client has no
  `funding_rounds` row at all, and false once the round moves on: `round.submitted`
  overwrites the field with `"Remove Inquiries"` (`src/workflows/f-03-round-submitted.mjs:35`).
- **missingData:** `crs_status` is absent entirely on any client who never went through
  C-00 (`src/workflows/c-00-crs-soft-pull-request.mjs:66` is the only writer of
  `"Requested"`). Absent is **not** the same as incomplete — show
  **"Credit status unknown"**, not "Pull CRS". Separately: **nothing anywhere records that
  the review was done.** There is no reviewed-at, no reviewer, no done flag; the value only
  disappears when some other workflow overwrites it. The honest secondary display is the
  round's `created_at` age (`db/schema/001_init.sql:131`, returned at
  `api/dashboard/client.mjs:98-100`) — "on Review Funding File for N days".
- **evidence:** `src/workflows/c-05-pre-funding-review.mjs:34`, `:39`, `:44`, `:52`;
  `src/workflows/u-03-crs-snapshot-sync.mjs:19`;
  `src/handlers/money-chain.mjs:737`; `public/app/client-control-panel.html:889`
- **confidence:** **certain** that C-05 writes it exactly this way.
  **unverified** that it survives — see the race below.

> **RACE — this one is real.** Three Inngest functions fire on the same `round.started`
> event and two of them write `employee_next_action`:
> `src/workflows/c-05-pre-funding-review.mjs:52` writes `"Review Funding File"`,
> `src/workflows/f-01-funding-intake.mjs:72` writes `"Collect Documents"`
> (`src/workflows/f-01-funding-intake.mjs:65`), and
> `src/workflows/f-02-portal-id-missing.mjs:66` writes `"Collect Documents"` too, after a
> 3-hour sleep (`src/workflows/f-02-portal-id-missing.mjs:34`, `:43`).
> `mergeCustomFields` is a blind `custom_fields || $2::jsonb`
> (`src/workflows/custom-fields.mjs:7-8`) — last write wins, no ordering, no guard.
> **So on a normal funding start, "Review Funding File" is very likely overwritten by
> "Collect Documents" within the same second, and again three hours later.** A display
> that trusts the field alone will under-report this value. This is a question for Chris,
> not a thing to fix here.

### 2. Prepare Next Round

- **signalKind:** json key in `clients.custom_fields` (`employee_next_action`) —
  **but the string does not match Chris's spec.**
- **STRING MISMATCH:** the code writes **`"Prepare Next Funding Round"`**
  (`src/workflows/f-04-round-approvals.mjs:32` and
  `src/workflows/f-11-bank-email-event-router.mjs:62`). Chris's spec says
  **`"Prepare Next Round"`** (`docs/workflows/fulfillment-layer-2026-08-19.md:21`).
  I re-ran the check myself: the exact string `Prepare Next Round` returns **0 files**
  across `src/ api/ public/app/ db/ netlify/ scripts/ docs/journeys/`.
  Do not rename either side. This is Chris's call.
- **trueWhen:** the latest round has been approved and is not yet funded. Rows that prove
  it, in order of strength:
  1. the client's `funding_card_stacking` card sits on stage `approved`
     (`db/seed/002_pipelines.sql:35`) — this is what actually emits `round.approved`
     (`src/funding/card-stacking-rounds.mjs:24`); or
  2. `EXISTS (SELECT 1 FROM applications a WHERE a.funding_round_id = <latest round>
     AND a.status = 'Approved')` (`src/lenders/tables.mjs:19`); or
  3. `funding_rounds.approved_amount > 0` on the latest round (`db/schema/001_init.sql:127`)
  — **AND** that round's `status <> 'funded'` (`src/handlers/money-chain.mjs:828`).
  F-04 additionally requires the event's `approvedAmount > 0`
  (`src/workflows/f-04-round-approvals.mjs:23-24`).
  F-11 writes the same value off a bank email classified `APPROVED` or `COUNTEROFFER`
  (`src/workflows/f-11-bank-email-event-router.mjs:60-64`) and moves the card to
  `approved` at `:63-64`.
- **falseWhen:** the latest round is `status = 'funded'` — the work is done, and the
  `funded` stage is what allocates round N+1 next time
  (`src/funding/card-stacking-rounds.mjs:213-224`). Also false when no application on the
  round is `Approved` and `approved_amount` is NULL.
- **missingData:** **`funding_rounds.status` never becomes `approved`.** There is no
  round-level proof of approval — you must read `applications.status` or the card stage.
  If the round has zero application rows and `approved_amount IS NULL`, show
  **"No approval recorded"** — never infer approval from the round row, and never show
  `$0` for a NULL `approved_amount`.
- **evidence:** `src/workflows/f-04-round-approvals.mjs:23`, `:32`, `:39`;
  `src/workflows/f-11-bank-email-event-router.mjs:60-64`;
  `db/seed/002_pipelines.sql:35`; `src/funding/card-stacking-rounds.mjs:21-28`;
  `src/lenders/tables.mjs:16-25`; `src/handlers/money-chain.mjs:828`
- **confidence:** **certain** on the write path and the status gap.
  **likely** on the row-level restatement (card stage vs application status can disagree —
  `src/workflows/cards.mjs:103-110` swallows a failed emit and leaves the card moved).

### 3. Apply for Funding

- **signalKind:** json key in `clients.custom_fields` (`employee_next_action`), written
  once, paired with `ready_for_next_round: true` in the same merge.
- **trueWhen:** an `inquiry.removed` event arrived **without** a fraud alert —
  `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45`
  (the `!event.payload?.fraudAlert` path, guard at `:36`).
  Row-level restatement using only fields that exist: the client has **no active**
  `inquiry_removal_cases` — active is `case_status IN ('Queued','Scheduled','In Progress',
  'Escalated','Blocked')` (`src/inquiry-ops/gate.mjs:9`, loader at `:10-21`, enum at
  `db/migrations/140_inquiry_ops.sql:12-20`) — **AND**
  `custom_fields->>'ready_for_next_round' = 'true'` **AND** there is no open round
  (either no `funding_rounds` row, or the latest one is `status = 'funded'`).
- **falseWhen:** a fraud alert is present — C-03 takes the other branch and writes
  `round_hold_reason: "Fraud Alert"` + `employee_next_action: "Clear Fraud Alert"`
  (`src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:37`). Also false while a round is
  open (`status = 'started'`, `src/handlers/money-chain.mjs:737`) — you cannot apply for the
  next round while the current one is running.
- **missingData:** **`ready_for_next_round` has one writer and zero readers, and nothing
  ever clears it.** Written at `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45`;
  a full-tree grep finds no other production reference (typed twin
  `db/schema/005_client_custom_fields.sql:77` is unwritten, map entry
  `db/schema/meta/custom-field-map.json:534-538`). **Once true it stays true through every
  later round.** So it cannot prove "apply now" on its own — it must be paired with "no
  open round". If the client has no `inquiry_removal_cases` history at all, show
  **"No inquiry work on file"**, not "Ready".
- **evidence:** `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:36`, `:37`, `:45`,
  `:51-53`; `src/inquiry-ops/gate.mjs:9-21`; `db/migrations/140_inquiry_ops.sql:12-20`,
  `:107`; `src/handlers/money-chain.mjs:737`, `:828`
- **confidence:** **certain** on the write path. **likely** on the row-level restatement.

### 4. Ready to Fund

- **signalKind:** **NOT FOUND.**
- The exact string `Ready to Fund` returns **0 files** across
  `src/ api/ public/app/ db/ netlify/ scripts/ docs/journeys/`. I ran that check myself;
  it confirms W1. There is no field, no status, no chip, no constant, no template.
- **Where I looked:** every `funding_rounds` status write
  (`src/handlers/money-chain.mjs:671`, `:737`, `:828`; `src/demo/platform-seed.mjs:106`),
  every `employee_next_action` write (15 sites, all listed by W1 and re-verified),
  the pipeline stage seed (`db/seed/002_pipelines.sql:34-36`), the application status set
  (`src/lenders/tables.mjs:16-25`), `db/schema/005_client_custom_fields.sql`,
  `db/schema/meta/custom-field-map.json`, and `docs/journeys/`.
- **The nearest thing that already exists, and it is a good one:**
  **"Ready to Fund" is exactly the question `guardFundedAmount` already answers.**
  `src/workflows/cards.mjs:48-71` refuses a move to the `funded` stage
  unless a funded amount > 0 can be resolved; the resolver
  (`src/funding/card-stacking-rounds.mjs:88-102`) falls back to
  `SUM(applications.approved_amount) WHERE funding_round_id = ? AND status = 'Approved'`
  (`src/funding/card-stacking-rounds.mjs:41-52`), and the refusal message even offers that
  sum as the suggested amount (`src/funding/card-stacking-rounds.mjs:150-156`).
  So: **trueWhen** = latest round `status <> 'funded'` **AND**
  `SUM(applications.approved_amount) WHERE status='Approved'` on that round is `> 0`.
  **falseWhen** = that sum is null or zero, or the round is already funded.
  **missingData** = no application rows on the round → show
  **"No approved lender amounts yet"**, never `$0`.
  **signalKind if built this way:** derived row aggregate (SUM over `applications`),
  not a stored field.
- **confidence:** **certain** that the literal value does not exist.
  **unverified** that the guard above is what Chris means by the chip — that is a question
  for him, not an inference to ship.

---

## Cross-cutting defects found while mapping (report only — nothing changed)

1. **`clients.funded_amount` has no production writer.** Only
   `src/demo/platform-seed.mjs:77`. The CCP tile labelled "Total Approved"
   (`public/app/client-control-panel.html:449`) reads it at `:858` and silently falls back
   to the prequal number at `:859`. Every real client shows a prequal figure under an
   "Approved" label. Corroborated in-code at
   `src/workflows/n-06-renewal-second-wave.mjs:29-30`.
2. **`"DENIED"` vs `"Denied"`** — `src/workflows/f-09-funding-declined-no-path.mjs:49`
   compares against a value that is not in the allowed set
   (`src/lenders/tables.mjs:16-25`). F-09 can only fire on rounds with zero application
   rows. So `funding_rounds.hold_reason` is effectively never set.
3. **`'closed'` is read but never written** — `src/funding/card-stacking-rounds.mjs:219`.
   The `closed` stage exists on the board (`db/seed/002_pipelines.sql:36`) but emits no
   event (`src/funding/card-stacking-rounds.mjs:27`) and updates no row.
4. **`round.submitted` and `round.approved` update nothing on the round.** No listener
   exists. `funding_rounds.status` cannot distinguish "just started" from "approved by
   three banks".
5. **Three workflows race on `round.started`** to write `employee_next_action` —
   `c-05:52`, `f-01:72`, `f-02:66` (the last after a 3h sleep). Last write wins
   (`src/workflows/custom-fields.mjs:7-8`).
6. **`funding_closeout.status` is always `'open'`** — INSERT hardcodes it
   (`src/funding/closeout.mjs:112`), the UPDATE never touches it
   (`src/funding/closeout.mjs:92-101`).
7. **`round_hold_reason` is only ever cleared for `"Missing Documents"`**
   (`src/workflows/f-06-funding-conditions-missing-docs.mjs:75-79`). `"Awaiting CRS"`,
   `"New Inquiries"` and `"Fraud Alert"` have no clear path.

## Questions for Chris (do not guess these)

1. `"Prepare Next Funding Round"` (code) vs `"Prepare Next Round"` (spec) — which string wins?
2. `"Ready to Fund"` — is it "every approved lender amount is in, move it to funded", i.e.
   the `guardFundedAmount` condition? Or something else?
3. "Finalized" next to the round — is that a label over `status = 'funded'`, or a state he
   expects to exist separately?
