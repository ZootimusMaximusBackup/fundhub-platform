# W2 — Credit half of Employee Next Action

**Date:** 2026-08-19 · **Agent:** W2 · **Scope:** findings only. No product code written.
No migrations, no schema, no writes, no workflow changes. Only this file was created.

**COMPLIANCE REVIEW REQUIRED** — see §6. Credit-pull type and consent capture are both
touched by this mapping (CLAUDE.md §7).

---

## HEADLINE

Three of the four values are real and already written by live workflows. One does not
exist at all.

| Value | Exists in code? | The signal underneath it |
|---|---|---|
| **Pull CRS** | YES, 2 write sites | `custom_fields.crs_status` + a countable `crs_results` row count + `soft_pull_requests.status` |
| **Clear Fraud Alert** | YES, 1 write site | **NOTHING PERSISTS THE FRAUD FLAG.** It lives only in an event payload. The column built for it has zero writers. |
| **Remove Inquiries** | YES, 2 write sites | `inquiry_removal_cases.open_inquiry_count` (real column) + `inquiry_log.is_open` (real column) |
| **Review Disputes** | **NOT FOUND** | zero hits repo-wide. Nearest real signal is the optimization pipeline stage `response_received`, whose SLA task is literally named `owner_reviews_parse`. |

Two findings that change the plan:

1. **"Clear Fraud Alert" is a one-way door.** Nothing in this repository ever clears it.
   No code removes the `fraud:alert-present` tag, nulls `round_hold_reason='Fraud Alert'`,
   or writes `fraud_alert_cleared_date`. Once a client gets this chip it stays until an
   unrelated later event happens to overwrite it.
2. **The low-confidence dispute review queue can never fill.** `api/repair/exceptions.mjs:44-51`
   queries `dispute_responses`. **Nothing in the repository ever INSERTs into
   `dispute_responses`.** The only producer, `handleInboundResponse`
   (`src/metro2/inbound/handler.mjs:10`), is called only by its own test
   (`src/metro2/inbound/inbound.test.mjs:35`). That endpoint always returns an empty list.

---

## 1. "Pull CRS"

**signalKind:** json key in `clients.custom_fields` — with a real column and a derived
row count both available as independent cross-checks.

### Where the chip is written

| file:line | trigger | condition |
|---|---|---|
| `src/workflows/c-05-pre-funding-review.mjs:44` | `round.started` (`:52`) | `custom_fields.crs_status !== 'Complete'` (`:34`) — also sets `round_hold_reason: "Awaiting CRS"` |
| `src/workflows/s-06-post-call-funding-purchased.mjs:42` | `deposit.paid` (`:52`) | outcome tier is a funding path (`:37-38`) — also sets `lifecycle_status: "Funding Client"`, `product_path: "Funding"` |

A real `tasks` row is raised alongside: "Funding intake — pull CRS"
(`src/workflows/s-06-post-call-funding-purchased.mjs:25`, role `closer`) and
"Cannot start funding — CRS incomplete" (`src/workflows/c-05-pre-funding-review.mjs:46`,
role `funding_advisor`).

### trueWhen

`clients.custom_fields->>'crs_status' IS DISTINCT FROM 'Complete'` at the moment a
funding round starts — the exact test at `src/workflows/c-05-pre-funding-review.mjs:34`.
Or a funding-path deposit is paid (`src/workflows/s-06-post-call-funding-purchased.mjs:37-42`).

Independent cross-checks that do not rely on the chip, in order of cheapness:

* `COUNT(crs_results WHERE client_id = c.id) = 0` — **already computed today** as
  `crs_count` in `api/dashboard/clients.mjs:33`, mapped to the response at
  `api/dashboard/clients.mjs:98`. Zero new SQL needed for a list surface.
* No `soft_pull_requests` row at `status='fulfilled'` — that status is the only one that
  may carry a `crs_result_id` (`db/migrations/077_soft_pull_requests.sql:152-153`, `:195-198`).
* The composite already assembled per-client by `softPullStatus()`
  (`src/sales/closer-deck.mjs:289-329`): consent validity, diagnostic paid, pull status,
  latest crs_result id, outcome tier. This is the most complete existing answer to
  "should this person be pulled, and may they be".

### falseWhen

`custom_fields.crs_status = 'Complete'`. Written in exactly one place:
`src/workflows/u-03-crs-snapshot-sync.mjs:19`, on `analysis.completed` where
`payload.source === 'crs'` (`:13`). Same write also stamps `crs_snapshot_date` (`:20`).

Equivalently, in real rows: a `soft_pull_requests` row moved to `status='fulfilled'` with
a non-null `crs_result_id` — the constraint at `db/migrations/077_soft_pull_requests.sql:195-198`
guarantees those two agree.

**Note:** `crs_status` only ever holds `'Requested'`
(`src/workflows/c-00-crs-soft-pull-request.mjs:66`) or `'Complete'`
(`src/workflows/u-03-crs-snapshot-sync.mjs:19`). Nothing writes a failure value. A pull
that failed leaves `crs_status='Requested'` forever, and the honest record of the failure
is on the `soft_pull_requests` row's `state_reason`
(`db/migrations/077_soft_pull_requests.sql:155-156`).

### missingData

When `crs_status` is absent AND `crs_results` count is 0 AND `soft_pull_requests` count is
0: show **"No credit pull on file."** Do not print "Pull CRS" from the absence of
`crs_status`. Both writers only fire after a funding round starts or a funding deposit is
paid — a client who has done neither has no next action, and blank is the truthful answer.

### confidence

**certain** for every claim above.

---

## 2. "Clear Fraud Alert"

**signalKind:** json key in `clients.custom_fields`. **The fraud flag itself is NOT FOUND
as any persisted field** — it exists only in the inbound event payload.

### Where the chip is written

`src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:37`, on `inquiry.removed` (`:52`),
gated solely on `event.payload?.fraudAlert` (`:36`).

That payload key is set at `src/adapters/inquiry-removal.mjs:98`, copied from
`normalizeInquiryRemovalEvent` at `src/adapters/inquiry-removal.mjs:84`
(`!!(b.fraud_alert ?? b.fraudAlert)`) — i.e. it comes off the signed inbound webhook body
from the Inquiry Removal AI runtime and is never stored.

### What survives on the record

Four things, all written in the same branch:

| what | file:line |
|---|---|
| `custom_fields.employee_next_action = "Clear Fraud Alert"` | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:37` |
| `custom_fields.round_hold_reason = "Fraud Alert"` | same line |
| tag `fraud:alert-present` on `clients.tags` | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:38` |
| open task "Fraud alert present — clear before resuming", role `inquiry_specialist` | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:39`, `:23` |

### trueWhen

Any of the four above are present. In SQL terms, the cheapest is
`'fraud:alert-present' = ANY(clients.tags)` — `tags` is a real column
(`db/schema/001_init.sql`, `clients` block) and is already returned whole by
`GET /api/dashboard/client`.

### falseWhen

**NOT FOUND.** There is no clear path. Verified by grepping `fraud` across
`src api public db` — every hit is listed here and none of them clears anything:

* `inquiry_removal_cases.fraud_alert_after` (`db/migrations/140_inquiry_ops.sql:116`) is
  the column built to hold this. It is on the writable list of `updateCase`
  (`src/inquiry-ops/cases.mjs:129`) — **and no caller in the repository ever passes it.**
  Grep for `fraud_alert_after` across `src api public db scripts` returns exactly two
  hits: that writable list and the migration itself. The column is always NULL.
* `client_custom_fields.fraud_alert_present` (`db/schema/005_client_custom_fields.sql:189`)
  and `client_custom_fields.fraud_alert_cleared_date`
  (`db/schema/005_client_custom_fields.sql:196`) — both on the typed mirror table whose
  only writer is frozen to `cf_svy_*` columns (`src/handlers/client-custom-fields.mjs:69`,
  column set `:6-21`). Always NULL. (Same dead-table problem W1 documented.)
* Nothing calls `removeTags(db, clientId, ["fraud:alert-present"])`. The only `removeTags`
  calls in C-03 clear `inquiry:pending` (`:43`).

The chip only ever changes by being **overwritten**: a later `inquiry.removed` with
`fraudAlert` falsy takes the other branch and writes `"Apply for Funding"`
(`src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45`).

### missingData

There is no clear-date and no cleared state anywhere. The honest display is the chip plus
the task's `created_at`, labelled **"Flagged <date>. No clear date is recorded."** Do not
compute an age from `clients.updated_at` — that column moves on every unrelated
custom_fields merge, so it would report the wrong age.

### confidence

**certain** — for the chip, for the four survivors, and for the absence of any clear path.

---

## 3. "Remove Inquiries"

**signalKind:** json key in `clients.custom_fields`, backed by a **real column**
(`inquiry_removal_cases.open_inquiry_count`) and a **derived row count**
(`inquiry_log WHERE is_open = true`).

### Where the chip is written

| file:line | trigger | condition |
|---|---|---|
| `src/workflows/c-02-inquiry-created.mjs:54` | `analysis.completed` (`:63`) | `payload.newInquiries` is a non-empty array (`:45-46`) — also sets `round_hold_reason: "New Inquiries"` and tags `inquiry:pending`, `ops:action-required` (`:55`) |
| `src/workflows/f-03-round-submitted.mjs:35` | round submitted | (unconditional in that workflow) |

C-02 also writes one `inquiry_log` row per new inquiry
(`src/workflows/c-02-inquiry-created.mjs:21-24`, status `'New'`) and raises the task
"Remove inquiries — round in progress" (`:36`, role `inquiry_specialist`).

### trueWhen

Chip-independent, and both are real columns:

* An ACTIVE `inquiry_removal_cases` row for the client with `open_inquiry_count > 0`.
  Active = `case_status IN ('Queued','Scheduled','In Progress','Escalated','Blocked')`
  (`src/inquiry-ops/cases.mjs:14`; the same list is repeated at
  `src/inquiry-ops/gate.mjs:8`). Column: `db/migrations/140_inquiry_ops.sql:120`
  (`open_inquiry_count integer NOT NULL DEFAULT 0`).
  Already loadable per-client via `getActiveCaseForClient`
  (`src/inquiry-ops/cases.mjs:68-80`), which `GET /api/dashboard/client` already returns
  and the Client Control Panel already paints
  (`public/app/client-control-panel.html:862`).
* Or `COUNT(inquiry_log WHERE client_id = … AND is_open = true) > 0`.
  `is_open boolean NOT NULL DEFAULT true` — `db/migrations/143_inquiry_removal_bridge.sql:38`;
  its stated purpose is exactly this rollup, `db/migrations/143_inquiry_removal_bridge.sql:98-99`
  ("Rollup source for inquiry_removal_cases.open_inquiry_count. False once Cleared/Removed.").

### falseWhen

The last open inquiry on the case is confirmed removed. `confirmRemoval`
(`src/inquiries/work.mjs:159`) sets `inquiry_log.is_open = false` (`:168`), recounts the
remaining open rows (`:180-184`), and when the count hits zero sets
`case_status='Completed'`, `open_inquiry_count = 0`, `master_call_state='completed'`
(`src/inquiries/work.mjs:194-205`) and emits `inquiry.removed` (`:206`). C-03 then
overwrites the chip — to `"Apply for Funding"` (`c-03:45`) normally, or to
`"Clear Fraud Alert"` (`c-03:37`) if the payload carried a fraud alert.

The webhook path reaches the same state through `src/inquiry-removal/cases.mjs`
(`clearInquiry` at `:420-445`, `closeCase` at `:485-510`).

### missingData

Two traps, both real:

1. `open_inquiry_count` is `NOT NULL DEFAULT 0` (`db/migrations/140_inquiry_ops.sql:120`),
   so **0 is ambiguous** — it means both "all cleared" and "never counted". Never print
   "0 open inquiries" as proof the file is clean. Disambiguate with `case_status` and with
   whether any `inquiry_log` row exists at all.
2. No `inquiry_removal_cases` row and no `inquiry_log` rows → show
   **"No inquiry work on file"**, not "0 open".

### confidence

**certain.**

---

## 4. "Review Disputes"

**signalKind: NOT FOUND.**

The exact string `Review Disputes` returns **zero hits** across `src/`, `api/`, `public/`,
`db/`, and `docs/journeys/`. It is not an `employee_next_action` value anywhere. This
matches W1's ground brief, which listed it among the four Airtable chips with no code
behind them.

**Where I looked:** every `mergeCustomFields(...)` patch object in `src/workflows/**` and
`src/handlers/**`; all of `src/metro2/**`; all of `src/repair/**`;
`src/workflows/ds-02-diy-letters.mjs`; `db/schema/005_client_custom_fields.sql`;
`db/schema/meta/custom-field-map.json`.

### The real dispute state that exists

Four tables, all created by `db/migrations/160_metro2_dispute_engine.sql`:

| table | key statuses | line |
|---|---|---|
| `dispute_cases` | `open`, `awaiting_response`, `round_complete`, `closed`, `stalled`, `cancelled` | `db/migrations/160_metro2_dispute_engine.sql:27-28` |
| `dispute_items` | `open`, `sent`, `verified`, `deleted`, `updated`, `unaddressed`, `closed`, `escalated` | `db/migrations/160_metro2_dispute_engine.sql:49-50` |
| `dispute_letters` | `generated`, `variance_failed`, `ready`, `sent`, `delivered`, `failed` | `db/migrations/160_metro2_dispute_engine.sql:66-67` |
| `dispute_responses` | `confirmed` boolean + `confidence` numeric | `db/migrations/160_metro2_dispute_engine.sql:76-88` |

Writers: the only three INSERTs are `src/metro2/rounds/store.mjs:7` (cases), `:18` (items),
`:36` (letters), reached from `analyzeAndGenerate` (`src/repair/analyze.mjs:202`, `:245`),
reached from `POST /api/repair/generate` (`api/repair/generate.mjs:80`).

### The closest thing to "Review Disputes" that is real

A **derived row count** over the optimization pipeline, not a custom_fields key:

* The optimization card sits at stage `response_received` — one of the four "need me"
  stages (`src/repair/cases.mjs:4-9`) — and its SLA task is literally named
  **`owner_reviews_parse`** (`src/repair/sla.mjs:11`). That is this chip, under another
  name, already in the code.
* Per-client counts already assembled by `LIST_SQL` in `src/repair/cases.mjs:72-106`:
  `case_count` over `dispute_cases` where `status NOT IN ('closed','cancelled')`
  (`:89-97`), `letters_ready`, `letters_sent` (`:98-104`).
* Per-client item list at `src/repair/cases.mjs:140-153`, already ordered by severity.

### Proposed trueWhen (a proposal, not a finding)

A `dispute_cases` row for the client with `status NOT IN ('closed','cancelled')` AND at
least one `dispute_items` row at `status IN ('open','unaddressed','escalated')`
(`db/migrations/160_metro2_dispute_engine.sql:49-50`); OR the client's optimization card is
at stage `response_received` or `stalled` (`src/repair/cases.mjs:4-9`).

### Proposed falseWhen

`dc.case_count = 0` from the lateral at `src/repair/cases.mjs:89-97` — no dispute case
outside `closed`/`cancelled`.

### missingData

No `dispute_cases` row at all → show **"Not on the repair track."** Say that, not
"no disputes" — the two look identical in the data and mean completely different things.

### THE DEAD QUEUE — a live defect, not a design gap

`api/repair/exceptions.mjs:44-51` queries `dispute_responses` for unconfirmed parses under
0.85 confidence and returns them as `lowConfidenceParses`. That list is **always empty**:

* Grep for `dispute_responses` across the whole repo (excluding `node_modules`) returns
  seven hits and **not one is an INSERT**: `db/migrations/160_metro2_dispute_engine.sql:76`,
  `db/migrations/200_dispute_rls_policies.sql:9,23,117`,
  `db/migrations/202_client_fk_indexes.sql:31`, `api/repair/exceptions.mjs:46` (SELECT),
  `api/repair/exceptions.mjs:64` (UPDATE), `src/security/rls-shape.test.mjs:71`.
* The producer, `handleInboundResponse` (`src/metro2/inbound/handler.mjs:10`), is imported
  only by `src/metro2/inbound/inbound.test.mjs:5` and called only at `:35`. No production
  call site.
* `db/migrations/200_dispute_rls_policies.sql:23` already records `dispute_responses` at
  **0 rows**.

So the "confirm this parse" button at `api/repair/exceptions.mjs:61-73` has nothing to act
on, and any "Review Disputes" count built on that table would read 0 forever.

### confidence

**certain** that the value does not exist and that `dispute_responses` has no writer.
**likely** for the proposed mapping onto `dispute_cases` / `dispute_items` / the
`response_received` stage.

---

## 5. Nothing reads any of this except one screen

Restating W1's headline because all four of my values inherit it:

* `employee_next_action` is read in exactly one place that works:
  `public/app/client-control-panel.html:889` (`setText("ccp-next-action", cf.employee_next_action)`),
  painting into the element at `public/app/client-control-panel.html:472`.
* `src/agents/context.mjs:109` reads it from `client_custom_fields.employee_next_action` —
  the typed column with no writer — so the agent line at `src/agents/context.mjs:268`
  is always blank.
* **No SQL anywhere filters, groups, or counts on `employee_next_action`.** So there is no
  rollup to extend; any count is new aggregate SQL.

The supporting signals are in better shape. Two of the three credit signals are already
selected by a live list endpoint:
`crs_count` at `api/dashboard/clients.mjs:33` and `:98`, and `crs_paid` at
`api/dashboard/clients.mjs:22` and `:87`.

---

## 6. COMPLIANCE REVIEW REQUIRED — the credit-pull type

CLAUDE.md §7 flags credit-pull type. Two separate answers.

### 6a. Is soft vs hard distinguishable in the data? NO for our own pulls.

**There is no pull-type column anywhere.** Not on `crs_results`
(`db/schema/001_init.sql:310-318`: id, org_id, client_id, result, outcome_tier, created_at,
updated_at; plus `provider` and `provider_result_id` from
`db/migrations/157_crs_result_identity.sql:28-33`; plus `is_demo` from
`db/migrations/148_demo_mode.sql:20`). Not on `soft_pull_requests`
(`db/migrations/077_soft_pull_requests.sql:118-199`).

The type is only inferrable **from code**, never from a stored row: every pull this
platform makes goes through the vendor's prequalification product, one endpoint per
bureau —
`/transunion/credit-report/standard/tu-prequal-fico9` (`src/finance/crs-client.mjs:63`),
`/experian/credit-profile/credit-report/standard/exp-prequal-fico9` (`:68`),
`/equifax/credit-report/standard/efx-prequal-fico9` (`:73`) — ordered by
`orderPrequal()` (`src/finance/crs-client.mjs:324`), called at exactly one line,
`src/finance/crs-pull.mjs:607`.

`custom_fields.crs_pull_scope` is **not** a type. Its two values are `consumer_only` and
`consumer_plus_ex_business` (`src/workflows/c-00-crs-soft-pull-request.mjs:64`) — that is
which bureaus and whether business credit is included, not soft versus hard.

**What this means:** today it is safe by construction, because there is no hard-pull code
path. But nothing in the database would tell the two apart if one were ever added, and
`soft_pull_requests` asserts "soft" by its table name alone
(`db/migrations/077_soft_pull_requests.sql:223-224`). A row does not carry the claim.

### 6b. Third-party hard inquiries are classified in memory and thrown away.

The Metro 2 engine DOES know hard from soft for inquiries **on the consumer's report**:
`src/metro2/checks/inquiries.mjs:34-36` — "Only hard inquiries are in scope; a soft pull is
not visible to lenders" — reading a provenance-wrapped `inquiry.hard` off the normalized
report.

That classification is **never persisted**. `inquiry_log` has no hard/soft column:
base table `db/schema/001_init.sql:169-180` (bureau, inquiry, status, call_attempts,
outcome), plus `db/migrations/140_inquiry_ops.sql:173-194` (all call-machinery), plus
`db/migrations/143_inquiry_removal_bridge.sql:35-39` (external id, name, is_open,
cleared_at). So the inquiry-removal desk cannot filter hard from soft in the database, and
"Remove Inquiries" counts every logged inquiry regardless of type.

### 6c. Would "Pull CRS" be shown when a pull is not permitted? YES.

**Neither writer of the chip consults consent or identity.**

* `src/workflows/c-05-pre-funding-review.mjs:44` — the only thing it reads first is
  `custom_fields.crs_status` (`:33-34`).
* `src/workflows/s-06-post-call-funding-purchased.mjs:42` — the only thing it reads first
  is the outcome tier (`:37`).

Permission is enforced **later**, at request time, in two gates the chip knows nothing
about:

* **Consent gate** — `requestSoftPull` calls `consentStatus(kind:'soft_pull_consent')` and
  throws `403 consent_required` when it is not valid
  (`src/finance/soft-pulls.mjs:306-314`). It distinguishes none-on-file, expired, revoked,
  and not-yet-effective (`src/finance/soft-pulls.mjs:242-253`). A revoked consent means
  stop, permanently (`:244-245`).
* **Identity gate** — no legal name / DOB / address / SSN on file returns
  `identity_required` (`src/finance/crs-pull.mjs:552-559` and `:578-585`).

**Today the Client Control Panel does not have this bug**, because it runs its own live
consent check and disables the three bureau buttons:
`checkConsent()` at `public/app/client-control-panel.html:1189-1231`, calling
`GET /api/consent/capture?kind=soft_pull_consent` (`:1196-1197`), and
`setPullsEnabled(false, why)` on refusal (`:1221`). Refusal codes are translated to plain
sentences at `:1243-1252`.

**But the screen already contradicts itself.** The chip at
`public/app/client-control-panel.html:889` paints "Pull CRS" with no consent awareness at
all, so a client who revoked consent sees "Next Action: Pull CRS" sitting directly above
three disabled buttons and a line saying they revoked.

**The risk in this batch.** Any NEW surface that repeats the chip — a list column, a
pipeline card chip, a "Needs Pull" rollup — inherits the chip and does **not** inherit the
consent check, which lives in the Client Control Panel's own script, not in the data. That
would tell an employee to pull a consumer's credit on people who never agreed, whose
consent expired, or who explicitly revoked.

**The fix is cheap and already written.** `softPullStatus()`
(`src/sales/closer-deck.mjs:289-329`) already returns `consent_valid` and `consent_reason`
beside `pull_status` and `crs_result_id`, in one function, from the same three tables.
Any new "Pull CRS" display should carry the consent verdict with it rather than showing
the instruction bare.

**Owner decision needed (one question, not a recommendation):** should a "Pull CRS" chip
be suppressed, or shown greyed with the reason, when consent is not valid? I have not
built either.

---

## 7. What I could not answer

* **Live row counts.** Whether any real client currently carries "Clear Fraud Alert",
  how many `dispute_cases` rows exist, how many `inquiry_removal_cases` are active. That
  needs a read-only query against production and is W5's task. I ran none.
* **The allowed option list for `employee_next_action`.** Same NOT FOUND W1 recorded —
  `db/schema/meta/custom-field-map.json:174-180` types it `SINGLE_OPTIONS` and records no
  options array.
* **Whether Chris's "Review Disputes" means the parse-review queue
  (`owner_reviews_parse`) or the item-level dispute list.** Both exist in code; they are
  different jobs for different people. Not inventing an answer.
