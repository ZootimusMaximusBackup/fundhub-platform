# W5 — Live data reality check (READ-ONLY)

**Date:** 2026-08-19 · **Agent:** W5 · **Scope:** findings only. No product code. No writes.
**Every statement below is a `SELECT` result or a `file:line`. Nothing is inferred.**

---

## HOW I CONNECTED

Local `/Users/zootimusmaximus/fundhub-platform/.env` exists and holds `DATABASE_URL`.
CLAUDE.md §11 permits reading it. **The value is never printed anywhere in this file.**

* **Target (host/database only, no credentials):** `aws-1-us-west-2.pooler.supabase.com:5432/postgres`
* **Matches** the Supabase project recorded in `CLAUDE.md:256` (`oqpnlusrotpxfenysfxz`, session pooler, us-west-2). **This is the live production database.**
* **Server:** PostgreSQL 17.6
* **Connected as role:** `fundhub_app` — the unprivileged app role from `db/migrations/104_app_role.sql`.
* **Row-level security check (so nobody discounts these counts as "RLS hid rows"):**
  `pg_policies` shows `clients_app_all` and `funding_rounds_app_all` with `qual = true`.
  Every table I read has an ALL policy qualifying to `true` for this role.
  **No rows were hidden from me. The counts are the whole table.**
* Only one org exists: `Fundhub` = `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`, and all 47 clients belong to it.

**Every statement I ran was `SELECT` or `WITH`.** The runner refused anything else by regex
before dispatch. Zero writes, zero DDL, zero migrations.

---

## HEADLINE — read this before anything else

> **Nineteen clients in this database look like real people. Zero of them carry a single
> fulfillment signal.**

```sql
SELECT count(*) AS real_clients,
 count(*) FILTER (WHERE custom_fields ? 'employee_next_action')   AS ena,
 count(*) FILTER (WHERE custom_fields ? 'crs_status')             AS crs_status,
 count(*) FILTER (WHERE custom_fields ? 'total_funding_estimate') AS prequal,
 count(*) FILTER (WHERE custom_fields ? 'ready_for_next_round')   AS ready,
 count(*) FILTER (WHERE outcome_tier IS NOT NULL)                 AS tier,
 count(*) FILTER (WHERE EXISTS (SELECT 1 FROM crs_results r WHERE r.client_id=clients.id)) AS crs_row,
 count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.client_id=clients.id AND NOT t.done)) AS open_task
FROM clients
WHERE NOT is_demo AND email NOT LIKE 'prove_%' AND email NOT LIKE '%@example.com'
  AND email NOT LIKE 'stanbridgejchris%' AND email NOT LIKE 'e2e+%';
```

| real_clients | ena | crs_status | prequal | ready | tier | crs_row | open_task |
|---|---|---|---|---|---|---|---|
| **19** | **0** | **0** | **0** | **0** | **0** | **0** | 15 |

The only signal a real client carries is an **open task**. Everything the fulfillment
layer wants to drive on — Employee Next Action, credit-pull state, prequal money,
ready flag, outcome tier, a credit file at all — is **empty on every real client.**

**Four more facts of the same size:**

1. **`funding_rounds` has ZERO rows.** So does `applications`. So does `funding_closeout`.
   `db/schema/001_init.sql:119` defines the table; nothing has ever put a row in it live.
   Yet 22 `round.*` events HAVE fired (see §6). **Total Approved cannot be computed. It is 0
   because the source table is empty, not because nobody was approved.**
2. **The typed column `client_custom_fields.employee_next_action` exists and is NULL on all
   20 rows.** Confirmed live — this is not a code-reading guess. W1's finding stands.
3. **Chris's TEST client is archived** (`custom_fields.crm_archived_at = 2026-08-18T21:45:03Z`)
   and its credit file is a **copy of the simulated demo client's** — see §5.
4. **`employee_next_action` is set on 8 of 47 clients; 5 are demo seeds, 2 are prove-script
   artifacts, 1 is Chris's TEST client.** Not one real client has it.

---

## 1. THE SIMULATED DEMO CLIENT — every signal

Seeded by `src/demo/simulate-client.mjs:274` (`loadSimulatedClient`). Three exist live.
I read the newest: **`376376b3-7ee5-4c3a-b0e7-563ca9681478`**, `sim+1787180327289@demo.fundhub.local`,
created `2026-08-19T22:58:47Z`.

### Row (`clients`)

| field | value | state |
|---|---|---|
| `is_demo` | `true` | POPULATED |
| `outcome_tier` | `FULL_FUNDING` | POPULATED |
| `funded` | `false` | POPULATED (default) |
| `funded_amount` | `null` | **NULL** |
| `days_to_fund` | `null` | **NULL** |
| `channel_source` | `simulated` | POPULATED |
| `pipeline_ids` | `{}` | EMPTY |

### `custom_fields` — 12 keys, complete dump

| key | value |
|---|---|
| `analyzer_path` | `Funding` |
| `business_age_months` | `30` |
| `crs_inquiries_eq` | `2` |
| `crs_inquiries_ex` | `4` |
| `crs_inquiries_tu` | `1` |
| `crs_late_payments_count` | `0` |
| `crs_negative_items_count` | `0` |
| `crs_paid` | `true` |
| `crs_pull_scope` | `consumer_only` |
| `crs_status` | **`Requested`** — NOT `Complete` |
| `ghl_link_dry_run` | `true` |
| `round_hold_reason` | `Awaiting CRS` |

### Every fulfillment signal, called plainly

| signal | state | evidence |
|---|---|---|
| **`employee_next_action`** | **ABSENT** — the key is not in the blob | jsonb dump above. `src/demo/simulate-client.mjs` never writes it (`SIM_UNDERWRITING_FIELDS`, `simulate-client.mjs:151-158`, has six keys and this is not one) |
| `crs_results` rows | **POPULATED** — 1 row, `44c83c9a-…`, `outcome_tier=FULL_FUNDING`, `environment=simulated`, `scores {eq:724, ex:718, tu:731}`, 7 inquiries | `simulate-client.mjs:299` |
| Fraud flag | **ABSENT** everywhere: no `custom_fields.fraud_alert_present`, `client_custom_fields.fraud_alert_present` NULL, `inquiry_removal_cases.fraud_alert_after` NULL | see §4 |
| Open inquiry count | **NO CASE ROW.** The 7 inquiries live only inside `crs_results.result->'inquiries'`. `inquiry_removal_cases` has no row for this client | |
| Document state | **POPULATED** — 2 `documents` rows, both `kind=contract / subtype=repair_trial`. One `sent, signature_required, signed 2026-08-19T23:00:20Z`; one `not_delivered` (the signed copy) | |
| Contract signed | **YES** — 1 `contracts` row, `REPAIR-TRIAL-AGREEMENT`, `status=signed`, `signed_at=2026-08-19T23:00:20Z` | |
| Paid / entitlements | **POPULATED** — 1 transaction `Business Financial Assessment $32.00 succeeded`; 1 entitlement `credit-analysis-report`, not revoked | |
| `funding_rounds` | **NO ROWS.** status / `round_hold_reason` / finalized — **all absent, because there is no row** | table is empty platform-wide |
| Tradelines | 4 rows | `simulate-client.mjs:307` |
| Tasks | **0** | |
| Invoices | **0** | |
| Consents | **0 `client_consents` rows** — note the contract was signed but no consent row exists | |
| Soft-pull requests | **0** | |
| Pipeline card | 1 | `simulate-client.mjs:344` |
| `client_custom_fields` typed row | **NONE** | |

**The one-line verdict on the demo client:** it is a good credit-file fixture and a **bad
fulfillment fixture.** It has a credit pull, tradelines, a signed contract and a payment —
but no next action, no funding round, no tasks, no inquiry case. A screen built on
`employee_next_action` shows this client **blank**.

---

## 2. CHRIS'S TEST CLIENT — every signal

**`8556bedc-46e1-4d85-b0cd-a24adfee1521`** · `stanbridgejchris+e2e-fire@gmail.com` ·
`TEST Client Role` · `client_code FH-000140` · created `2026-08-16T10:22:56Z` ·
last updated `2026-08-19T22:59:07Z`.

### Row (`clients`)

| field | value | state |
|---|---|---|
| `is_demo` | `false` | POPULATED |
| **`outcome_tier`** | `null` | **NULL** ← its own credit result says `FULL_FUNDING` |
| `funded` | `false` | POPULATED (default) |
| `funded_amount` | `null` | **NULL** |
| `days_to_fund` | `null` | **NULL** |
| `channel_source` | `null` | **NULL** |
| `tags` | `{inquiry:completed}` | POPULATED |
| `pipeline_ids` | `{}` | **EMPTY** |
| `partner_id` | `null` | **NULL** |

### `custom_fields` — 11 keys, complete dump

| key | value | note |
|---|---|---|
| `analyzer_path` | `Funding` | |
| **`crm_archived_at`** | `2026-08-18T21:45:03.377Z` | **this client is ARCHIVED** |
| `crs_paid` | `true` | |
| `crs_pull_scope` | `consumer_only` | |
| **`crs_status`** | **`Ready`** | **no code in this repo writes this value — see §7** |
| `deposit_paid` | `true` | |
| `e2e_paint_crs_copied_from` | `44c83c9a-e30c-4a6e-9842-30020c1beb6f` | the **demo** client's crs row |
| **`employee_next_action`** | **`Apply for Funding`** | the only real-ish client that has one |
| `ghl_link_dry_run` | `true` | |
| `ready_for_next_round` | `true` | |
| `sale_closed` | `true` | |

### Every fulfillment signal

| signal | state | evidence |
|---|---|---|
| **`employee_next_action`** | **POPULATED** = `Apply for Funding` | matches `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45` |
| `crs_results` rows | **POPULATED but not genuine.** 1 row `7a272fdb-…`, created `2026-08-19T22:59:06Z`, **`is_demo = true`**, `environment = simulated`, scores `{eq:724, ex:718, tu:731}` — **byte-identical to the demo client's scores.** `custom_fields.e2e_paint_crs_copied_from` names the source row | |
| Tradelines | **ZERO** — the credit result was copied, the tradelines were not | |
| Fraud flag | **ABSENT** — no jsonb key, typed column NULL, `inquiry_removal_cases.fraud_alert_after` NULL on all 3 of its cases | |
| Open inquiry count | **3 `inquiry_removal_cases` rows, all with `open_inquiry_count = 0`**: one `Completed` (closed `2026-08-18T21:42:28Z`), **two still `Queued`** from `2026-08-18T16:13` and `16:15`. `master_call_state` NULL on all three. `funding_round_id` NULL on all three | |
| Document state | **POPULATED** — 4 `documents`: `Soft Pull Authorization` (sent, signed `2026-08-18T16:12:37Z`) + its signed copy; `Credit Repair Agreement` (sent, signed `2026-08-18T22:03:13Z`) + its signed copy | |
| Contract signed | **YES ×2, plus 1 stuck draft.** `SOFT-PULL-CONSENT` signed `2026-08-18T16:12:37Z`; `CREDIT-REPAIR-AGREEMENT` signed `2026-08-18T22:03:13Z`; a **second `SOFT-PULL-CONSENT` still `draft`, never sent** | |
| Paid | **POPULATED — 6 succeeded transactions, $10,232 total**: UnderwriteIQ soft-pull $32; Funding done-for-you $3,000; Credit repair done-for-you $1,000; Repair test run $200; UnderwriteIQ Deliverables $1,000; Funding Mastery course $5,000 | |
| **Entitlements** | **ZERO.** Six paid products, no entitlement row | **defect** |
| **`funding_rounds`** | **ZERO ROWS.** `status`, `round_hold_reason`, `finalized` — **all absent** | |
| Invoices | **ZERO** — $10,232 collected, no invoice row | |
| Tasks | 2 open: `Start next funding round — clean file` (inquiry_specialist, from `c-03-inquiry-removed-resume-or-hold`) and `Mid-journey check-in` (funding_advisor, due `2026-08-25`) | |
| Consents | 2 `client_consents` rows, none revoked | |
| Soft-pull requests | 4 rows | |
| Pipeline card | **ZERO** — this client is on no board | |
| `client_custom_fields` typed row | **NONE** | |

---

## 3. POPULATED vs NULL vs COLUMN-DOES-NOT-EXIST

### 3a. Columns that DO NOT EXIST AT ALL — the most valuable finding

Checked against `information_schema.columns` on the live database.

| what the fulfillment spec wants | does a column exist? | evidence |
|---|---|---|
| **`Lock Fee`** (Airtable chip, `docs/workflows/fulfillment-layer-2026-08-19.md:27`) | **NO COLUMN. NO jsonb KEY. NOTHING.** `column_name ILIKE '%lock%fee%'` → 0 rows | nearest live thing is a task title, `Fix fee lock/percent before invoicing`, from workflow `f-07-funding-locked-fee-not-ready`, open on 5 clients |
| **`File Prep`** | **NO COLUMN.** `ILIKE '%file_prep%'` → 0 rows | |
| **`Ready to Fund`** | **NO COLUMN.** `ILIKE '%ready_to_fund%'` → 0 rows | the closest is `client_custom_fields.ready_for_next_round`, which is a different statement |
| **`Review Disputes`** | **NO COLUMN.** `ILIKE '%review_dispute%'` → 0 rows | `dispute_cases`, `dispute_items`, `dispute_letters`, `dispute_responses` tables all exist and are **all 0 rows** |
| **`Prepare Next Round`** (exact string) | the code writes `Prepare Next Funding Round` instead | `src/workflows/f-04-round-approvals.mjs:32`, `src/workflows/f-11-bank-email-event-router.mjs:62`. **Neither string appears on any live client** |

### 3b. Columns that EXIST but are ALWAYS NULL

| column | rows | non-null | evidence |
|---|---|---|---|
| **`client_custom_fields.employee_next_action`** | 20 | **0** | `db/schema/005_client_custom_fields.sql:32`. Confirmed live. `src/agents/context.mjs:109` reads it, so the AI agent context line at `src/agents/context.mjs:268` is blank on every client. **Live-verified defect.** |
| `client_custom_fields.fraud_alert_present` | 20 | **0** | `db/schema/005_client_custom_fields.sql:189` |
| `client_custom_fields.fraud_alert_cleared_date` | 20 | **0** | `db/schema/005_client_custom_fields.sql:196` |
| `client_custom_fields.round_hold_reason` | 20 | **0** | |
| `client_custom_fields.ready_for_next_round` | 20 | **0** | `db/schema/005_client_custom_fields.sql:77` |
| `client_custom_fields.total_approved_amount` | 20 | **0** | |
| `client_custom_fields.analyzer_prequal_amount` | 20 | **0** | |
| `clients.funded_amount` | 47 | **0** | nobody is funded |
| `inquiry_removal_cases.fraud_alert_after` | 3 | **0** | |
| `inquiry_removal_cases.master_call_state` | 3 | **0** | |

**The typed table is 309 columns wide and exactly 15 of them ever hold a value.**
Those 15 are: `client_id`, `org_id`, `created_at`, `updated_at`, ten `cf_svy_*` survey
columns, and `business_name` (**1 row only**, on `9af65808-…`).
`business_name` is **not** in `CF_SVY_TYPED_COLUMNS` (`src/handlers/client-custom-fields.mjs:6-21`),
so something outside the one known writer put it there. **Writer NOT FOUND** — I grepped
`src/`, `api/`, `scripts/` for `client_custom_fields` writes and found exactly one INSERT
(`src/handlers/client-custom-fields.mjs:69`), whose column list cannot produce it.

### 3c. Tables that exist and are EMPTY (0 rows, live)

`funding_rounds` · `applications` · `application_decisions` · `application_scores` ·
`funding_closeout` · `funding_closeout_items` · `funding_round_sales` ·
`dispute_cases` · `dispute_items` · `dispute_letters` · `dispute_responses` ·
`inquiry_log` · `inquiry_attempts` · `inquiry_prep` · `lenders` · `businesses` ·
`business_tradelines` · `commission_ledger` · `client_cards` · `subscriptions` ·
`snapshots` · `action_log` · `alerts` · `owner_notifications` · `entities`

---

## 4. COVERAGE ACROSS ALL 47 CLIENTS

### 4a. `custom_fields` keys — how many of 47 clients carry each

Only keys the fulfillment layer cares about are listed; the full 91-key census was run.

```sql
SELECT k AS cf_key, count(*) AS clients_with_key, 47 - count(*) AS clients_missing
FROM clients c, LATERAL jsonb_each_text(c.custom_fields) AS t(k,v)
GROUP BY k ORDER BY 2 DESC;
```

| cf key | set | null/absent | of 47 |
|---|---|---|---|
| `lifecycle_status` | 34 | 13 | 72% |
| `first_touch_date` | 27 | 20 | 57% |
| `lead_magnet_type` | 27 | 20 | 57% |
| `cf_svy_self_reported_fico` | 19 | 28 | 40% |
| `call_outcome` | 16 | 31 | 34% |
| `crm_archived_at` | 11 | 36 | 23% |
| **`round_hold_reason`** | **9** | 38 | **19%** — all 9 are the value `Awaiting CRS` |
| **`employee_next_action`** | **8** | 39 | **17%** |
| `funding_email_forwarding_address` | 7 | 40 | 15% |
| `analyzer_status` | 5 | 42 | 11% |
| `funding_delivery_sent` | 4 | 43 | 9% |
| **`crs_paid`** | **3** | 44 | **6%** |
| **`crs_status`** | **3** | 44 | **6%** |
| `crs_snapshot_date` | 1 | 46 | 2% |
| **`analyzer_prequal_amount`** | **1** | 46 | **2%** |
| **`total_funding_estimate`** | **1** | 46 | **2%** |
| **`ready_for_next_round`** | **1** | 46 | **2%** |
| **`deposit_paid`** | **1** | 46 | **2%** |
| **`sale_closed`** | **1** | 46 | **2%** |
| `crs_fico_score` | key on 1, **value NULL** | 46 | — |
| `primary_fico_score` | key on 1, **value NULL** | 46 | — |
| `fraud_alert_present` | **0** | 47 | **0%** |

### 4b. Where the 8 `employee_next_action` values actually live

| client | email | is_demo | value | set at |
|---|---|---|---|---|
| `8556bedc-…` | `stanbridgejchris+e2e-fire@gmail.com` | false | `Apply for Funding` | 2026-08-19 22:59 |
| `f90df1b4-…` | `gauntlet_msvmvykl@demo.fundhub.local` | **true** | `Collect Documents` | 2026-08-19 04:59 |
| `5a06de3f-…` | `gauntlet_msvmy3lb@demo.fundhub.local` | **true** | `Collect Documents` | 2026-08-19 04:59 |
| `113e9f24-…` | `gauntlet_msvn1et7@demo.fundhub.local` | **true** | `Collect Documents` | 2026-08-19 04:59 |
| `c352d809-…` | `gauntlet_msvn91if@demo.fundhub.local` | **true** | `Collect Documents` | 2026-08-19 04:59 |
| `585164ce-…` | `gauntlet_msvnd48o@demo.fundhub.local` | **true** | `Collect Documents` | 2026-08-19 04:59 |
| `ace01c72-…` | `prove_cs_msvmygoy.client@example.com` | false | `Collect Documents` | 2026-08-16 13:02 |
| `cac09cb0-…` | `prove_cs_msvmv8gz.client@example.com` | false | `Collect Documents` | 2026-08-16 12:59 |

**Only 2 of the 9 values the code can write have ever appeared live.**
`Pull CRS`, `Remove Inquiries`, `Clear Fraud Alert`, `Review Funding File`,
`Prepare Next Funding Round`, `Closed/Stop`, `Collect inquiry identity packet` —
**all zero occurrences.**

### 4c. Row-level signals — clients that have any row at all

```sql
SELECT (SELECT count(*) FROM clients) AS total_clients,
 (SELECT count(*) FROM clients c WHERE EXISTS (SELECT 1 FROM crs_results r WHERE r.client_id=c.id)) AS has_crs_row, …
```

| signal | all 47 | non-demo 37 | **truly real 19** |
|---|---|---|---|
| has a `crs_results` row | 9 | 7 | **0** |
| has tradelines | 3 | 1 | **0** |
| **has a `funding_rounds` row** | **0** | **0** | **0** |
| has an `inquiry_removal_cases` row | 1 | 1 | **0** |
| has a `documents` row | 4 | 2 | **0** |
| has a signed contract | 4 | 2 | **0** |
| has an active entitlement | 3 | 2 | **0** |
| has a succeeded transaction | 3 | 2 | **0** |
| has an invoice | 1 | 1 | **0** |
| has an open task | 26 | 21 | **15** |
| has a pipeline card | 19 | — | — |
| has a `client_custom_fields` row | 20 | — | — |
| `outcome_tier` set | 18 | — | **0** |
| `funded_amount` set | **0** | 0 | 0 |
| `pipeline_ids` non-empty | **0** | 0 | 0 |

*"truly real" = `NOT is_demo` and email not matching `prove_%`, `%@example.com`,
`stanbridgejchris%`, `e2e+%`. That leaves **19** clients. A hand check of the list confirms
they read as real people and companies (Gmail, Yahoo, company domains), all created
2026-08-13 → 2026-08-18, all arriving through the survey.*

### 4d. What a real client actually has

A typical real client (`0d9284e3-…`, `bhives.evolutionarymining@gmail.com`) carries **19
custom_fields keys and every one of them is survey or attribution**: nine `cf_svy_*` answers
plus their `_label` twins, `bs_precall_start_ts`, `call_outcome`, `first_touch_date`,
`lead_magnet_type`, `lifecycle_status`.

**Nothing about credit. Nothing about money. Nothing about a next action.**
`lifecycle_status` is `New Lead` on 27 clients and `Funding Client` on 7.

---

## 5. THE SIX ROLLUPS AS THEY COME OUT TODAY

The spec (`docs/workflows/fulfillment-layer-2026-08-19.md:31`) names the six but does not
define them. I computed each against the most defensible source in the code, and I say
which definition I used. **Numbers are over all 47 clients unless stated.**

### R1 — Total clients

```sql
SELECT count(*) AS all_clients,
       count(*) FILTER (WHERE is_demo=false) AS non_demo,
       count(*) FILTER (WHERE is_demo=false AND custom_fields->>'crm_archived_at' IS NULL) AS non_demo_not_archived
FROM clients WHERE org_id='fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6';
```

**47 total · 37 non-demo · 26 non-demo and not archived · 19 that look like real people.**

Pick one and say so on the screen. `api/dashboard/clients.mjs:44` already hides demo rows
unless demo mode is on (`src/demo/exclude-demo.mjs`), so **37** is the number that matches
what an operator sees today. It does **not** filter archived, so the archived 11 are still
in that list.

### R2 — Needs Pull

Three candidate definitions, three very different numbers. **This is a decision Chris has to make.**

```sql
-- (a) by the driver field
SELECT count(*) FROM clients WHERE custom_fields->>'employee_next_action' = 'Pull CRS';           -- 0
-- (b) by the gate c-05 actually reads (src/workflows/c-05-pre-funding-review.mjs:34)
SELECT count(*) FROM clients WHERE COALESCE(custom_fields->>'crs_status','') <> 'Complete';       -- 46
-- (c) by "no credit file exists", non-demo
SELECT count(*) FROM clients c WHERE c.is_demo=false
  AND NOT EXISTS (SELECT 1 FROM crs_results r WHERE r.client_id=c.id);                            -- 30
```

| definition | number |
|---|---|
| (a) `employee_next_action = 'Pull CRS'` | **0** |
| (b) `crs_status <> 'Complete'` | **46 of 47** |
| (c) non-demo with no `crs_results` row | **30 of 37** |

(a) is useless — nothing writes it. (b) is 98% of the book because the key is absent on 44
clients, and **absent is not the same as "needs a pull."** (c) is the only honest one.

### R3 — Action Needed

Definition taken from `openBlockers()` at `src/http/client-detail.mjs:169-215` — the only
"what is stopping this file" logic that exists.

```sql
SELECT count(*) FROM clients c
WHERE c.org_id='fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6' AND (
   EXISTS (SELECT 1 FROM tasks t WHERE t.client_id=c.id AND t.done=false)
   OR EXISTS (SELECT 1 FROM funding_rounds fr WHERE fr.client_id=c.id AND fr.hold_reason IS NOT NULL)
   OR EXISTS (SELECT 1 FROM v_invoice_balance vb WHERE vb.client_id=c.id AND COALESCE(vb.balance_due,0) > 0)
   OR (c.custom_fields->>'crs_paid') = 'false'
   OR ((c.custom_fields->>'deposit_paid') = 'false' AND (c.custom_fields->>'sale_closed') = 'true')
);
```

**Answer: 26.**

Cause breakdown, so nobody thinks this is a rich signal:

| cause | clients |
|---|---|
| open task | **26** |
| held funding round | **0** (table empty) |
| unpaid invoice | 1 |
| `crs_paid = false` | 0 |
| deposit gate | 0 |

**"Action Needed" is, today, exactly "has an open task."** Four of the five branches never
fire. And 16 of those 26 tasks are the same row — `Strategy session booked`, from
ClickFunnels — which is a booking, not a blocker.

### R4 — Ready

```sql
SELECT count(*) FILTER (WHERE (custom_fields->>'ready_for_next_round')='true')   AS ready_flag,
       count(*) FILTER (WHERE (custom_fields->>'employee_next_action')='Apply for Funding') AS ena_apply
FROM clients WHERE org_id='fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6';
```

**Answer: 1, by either definition — and it is the same single client, Chris's archived TEST client.**

### R5 — Total Prequal

```sql
SELECT count(*) FILTER (WHERE custom_fields ? 'total_funding_estimate') AS n_tfe,
       sum(NULLIF(custom_fields->>'total_funding_estimate','')::numeric)  AS sum_tfe,
       count(*) FILTER (WHERE custom_fields ? 'analyzer_prequal_amount') AS n_apa,
       sum(NULLIF(custom_fields->>'analyzer_prequal_amount','')::numeric) AS sum_apa
FROM clients WHERE org_id='fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6';
```

**Answer: $50,000 — from exactly ONE client (`9af65808-…`, Chris's own live file). 46 of 47
contribute nothing.**

Both keys hold `50000` on the same client, written together at
`src/handlers/client-lifecycle.mjs:449-450`. A "Total Prequal" tile reading $50,000 is
technically true and completely misleading.

### R6 — Total Approved

```sql
SELECT (SELECT count(*) FROM funding_rounds)            AS funding_round_rows,   -- 0
       (SELECT sum(approved_amount) FROM funding_rounds) AS sum_fr_approved,     -- NULL
       (SELECT count(*) FROM applications)               AS application_rows,    -- 0
       (SELECT sum(approved_amount) FROM applications)   AS sum_app_approved,    -- NULL
       (SELECT count(*) FROM clients WHERE funded)       AS clients_funded,      -- 0
       (SELECT sum(funded_amount) FROM clients)          AS sum_client_funded;   -- NULL
```

**NOT COMPUTABLE.** Every source is empty:

* `funding_rounds` — **0 rows**, so `sum(approved_amount)` is **NULL, not 0**
* `applications` — **0 rows**
* `funding_closeout.total_approved_amount` — **0 rows** (and `src/funding/closeout.mjs:66-68`
  warns it is a **fee basis**, not an approval total, so it was never the right source anyway)
* `clients.funded` — **true on 0 of 47**; `clients.funded_amount` — **NULL on all 47**

**A "Total Approved" tile has nothing to read.** Per CLAUDE.md §12, NULL means unknown and
must survive — this tile must render **"—"**, never **"$0"**. `$0` is a claim that nobody was
approved. The truth is that nothing was ever recorded.

### Rollup summary

| rollup | number today | trustworthy? |
|---|---|---|
| Total clients | 47 / 37 / 26 / 19 | yes, once Chris picks which |
| Needs Pull | 0, 46 or 30 | **no** — definition undecided, and (a) is dead |
| Action Needed | **26** | only as "has an open task" |
| Ready | **1** | technically yes, and that 1 is archived |
| Total Prequal | **$50,000** | **no** — one client of 47 |
| Total Approved | **NOT COMPUTABLE** | **no** — source table empty |

---

## 6. THINGS I FOUND THAT NOBODY ASKED FOR BUT SHOULD KNOW

**Twenty-two funding-round events fired and produced zero funding_rounds rows.**

```sql
SELECT name, count(*), min(created_at), max(created_at)
FROM events WHERE name LIKE 'round.%' GROUP BY name;
```

| event | count | first | last |
|---|---|---|---|
| `round.started` | 5 | 2026-08-16 10:00:14 | 2026-08-16 10:13:35 |
| `round.submitted` | 5 | 2026-08-16 10:00:16 | 2026-08-16 10:13:36 |
| `round.approved` | 5 | 2026-08-16 10:00:16 | 2026-08-16 10:13:36 |
| `round.funded` | 3 | 2026-08-16 10:04:31 | 2026-08-16 10:13:37 |
| `round.closeout` | 4 | 2026-08-13 07:32:57 | 2026-08-16 10:13:38 |

`funding_rounds` is empty. The timestamps line up exactly with the `gauntlet_*` demo seeds
(created 2026-08-16 09:59 → 10:13), so the most likely explanation is that a demo teardown
removed the rows. **I did not verify that and I am not going to guess.** What is certain:
`INSERT INTO funding_rounds` appears in `src/handlers/money-chain.mjs` and in test/seed
files only — **no production workflow inserts a funding round.**

**Other live oddities, stated once each:**

* `crs_status = 'Ready'` on the TEST client. **No writer exists in this repo.** Grep across
  `src/ api/ scripts/ netlify/ public/` finds `"Requested"` (`src/workflows/c-00-crs-soft-pull-request.mjs:66`)
  and `"Complete"` (`src/workflows/u-03-crs-snapshot-sync.mjs:19`) and nothing else.
  And `c-05` gates on exactly `=== "Complete"` (`src/workflows/c-05-pre-funding-review.mjs:34`),
  so `Ready` **fails the gate**.
* The TEST client paid $10,232 across 6 transactions and has **0 entitlements and 0 invoices.**
* The TEST client's `outcome_tier` is NULL while its own `crs_results` row says `FULL_FUNDING`.
* Two `inquiry_removal_cases` for the TEST client have been sitting `Queued` since 2026-08-18.
* 7 clients carry `custom_fields.crs_fico_score` / `primary_fico_score` **as a JSON null** —
  the key is present, the value is null. Any code doing `if (cf.crs_fico_score)` treats that
  as missing; any code doing `'crs_fico_score' in cf` treats it as present.
* Live keys with **no writer anywhere in this repo**: `address` (5 clients),
  `sample_roster` (5), `prove_letter_pack` (5), `prove_uiq_deliverables` (3), `attr_path` (2),
  `prove_p1_email` (1), `e2e_paint_crs_copied_from` (1), and every `cf_svy_*_label` variant
  (up to 15 clients each). **`clients.custom_fields` is not a closed key set and cannot be
  treated as one.**

---

## 7. THE TEST CLIENT AS THE HONEST-DEGRADE CASE

Chris asked what the TEST client is missing and what a sensible screen would show.

### What it HAS (a screen can show these truthfully)

Employee Next Action `Apply for Funding` · `ready_for_next_round` true · `crs_paid` true ·
`deposit_paid` true · `sale_closed` true · 2 signed contracts · 4 documents ·
6 succeeded payments · 2 open tasks · 2 consent records · 1 completed inquiry-removal case.

### What it is MISSING

| missing | consequence for a screen |
|---|---|
| **`funding_rounds` row** | no round number, no status, no `hold_reason`, no approved amount, no "finalized". **Every funding-round field on the screen is empty.** |
| **`outcome_tier` NULL** | no tier chip, even though its credit result says `FULL_FUNDING` |
| **`total_funding_estimate` / `analyzer_prequal_amount` absent** | **no Prequal number.** The CCP tile at `public/app/client-control-panel.html:448` renders blank |
| **`funded_amount` NULL, `funded` false** | Total Approved blank |
| **0 tradelines** | no card-stacking, no utilisation, no available credit |
| **0 entitlements** despite $10,232 paid | "what did they buy" cannot be answered from entitlements |
| **0 invoices** despite $10,232 paid | no balance, no statement |
| **0 pipeline cards, empty `pipeline_ids`** | **this client is on no board.** It cannot be found by moving through the pipeline |
| **`crm_archived_at` set** | it is archived. Any list that respects archive hides it |
| `crs_status = 'Ready'` | a value no gate recognises. `c-05` reads it as "not complete" |
| its `crs_results` row is `is_demo=true`, `environment=simulated`, copied | any screen that flags demo data flags the TEST client's credit file as fake |
| 2 stale `Queued` inquiry cases | "open inquiry work" shows 2 items that nobody is working |

### What a sensible screen shows for it

1. **Next Action: `Apply for Funding`** — real, populated, show it.
2. **A round panel that says "No funding round yet"** — not `Round 0`, not `$0`, not a
   blank box. There is no row; say there is no row.
3. **Prequal and Total Approved as `—`** — never `$0`. CLAUDE.md §12: NULL means unknown
   and must survive. `$0` says "approved for nothing." `—` says "we have not recorded this."
4. **A "demo credit file" marker.** The one credit result on this client has `is_demo=true`.
   A screen that shows FICO 718/724/731 without that marker is lying about a real client.
5. **A paid-but-no-entitlement line.** 6 payments, 0 entitlements is the interesting fact,
   and it is invisible unless the screen looks for the absence.
6. **The archived state, visibly.** If the screen shows an archived client without saying so,
   an operator will work a file that was deliberately put away.

**The general rule this case teaches:** every tile on the fulfillment screen needs three
states, not two — **a value**, **"none recorded"**, and **"not applicable."** With today's
data, "none recorded" is the state most tiles will be in most of the time.

---

## WHAT I COULD NOT ANSWER, AND WHERE I LOOKED

* **Why `funding_rounds` is empty when 22 `round.*` events fired.** Answering it means
  reading deleted rows or an audit trail. `action_log` is 0 rows. `snapshots` is 0 rows.
  **NOT FOUND** — I will not guess at a cause.
* **Who wrote `crs_status = 'Ready'` and `client_custom_fields.business_name`.** Grepped
  `src/ api/ scripts/ netlify/ public/` for both. **NOT FOUND.** Most likely hand SQL or a
  script since deleted; I did not verify and am not claiming it.
* **The allowed option list for `employee_next_action`.** `db/schema/meta/custom-field-map.json:174-180`
  types it `SINGLE_OPTIONS` and records **no options array**. Still **NOT FOUND**, exactly as
  W1 reported. The live database contributes two observed values — `Apply for Funding` and
  `Collect Documents` — and that is all the evidence there is.

---

## RAILS I KEPT

* Every statement was `SELECT` or `WITH`. A regex guard in the runner refused anything else
  before it reached the connection. **No INSERT, UPDATE, DELETE, DDL, migration, or
  `db/migrate.mjs` run.**
* No product code written. No migration added. No screen, tab, or menu row.
* `DATABASE_URL` never printed. Only `host:port/database` appears, which
  `src/db.mjs:dbTarget` already treats as safe for operator logs.
* No `git stash`.
* The only file I created is this one.
