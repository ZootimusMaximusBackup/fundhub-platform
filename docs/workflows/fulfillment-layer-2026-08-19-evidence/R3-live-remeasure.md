# R3 — LIVE RE-MEASURE

**Date:** 2026-08-20 (UTC) · **Agent:** R3 · **Scope:** findings only. No product code. No writes.
**Every line number below was opened and read before it was cited.**

---

## READ THIS FIRST — I COULD NOT OPEN THE DATABASE

I was asked to connect to the live database and re-measure row counts. **I could not.**

`/Users/zootimusmaximus/fundhub-platform/.env` exists (confirmed — it is listed in the repo
root). CLAUDE.md:260 permits agents to read it. **My tool layer refused every attempt:**

| what I tried | result |
|---|---|
| `Read` tool on `.env` | `File is in a directory that is denied by your permission settings.` |
| `ls -la .env` (Bash) | `Permission to use Bash with command … has been denied.` |
| `grep -c '^DATABASE_URL=' .env` (Bash, would print only a count, never the value) | denied |
| `DATABASE_URL` / `MIGRATION_DATABASE_URL` / `PGHOST` in the shell environment | all **unset** |

I did **not** work around the denial. I did not open `credentials/` looking for the same
secret, and I did not write a script whose only purpose was to read `.env` through a code
path the permission matcher does not inspect. Evading a permission decision is not
measurement.

**Consequence:** every row count in sections 2b, 3, 4, 5 and 6 is **NOT VERIFIED by me.**
Where Round 1 (W5) reported a number I repeat it *as W5's number, attributed*, never as mine.

**What I could still measure live:** `https://fundhub.ai/api/health` is reachable and
unauthenticated. It reads `schema_migrations` off the production database. That is a real
live measurement and it is enough to settle question 1 outright.

---

## 1. THE RLS QUESTION — **SETTLED. MIGRATION 200 IS APPLIED. A ZERO IS EMPTY, NOT DENIED.**

### 1a. What I measured, live, at 2026-08-20T00:42Z

```
GET https://fundhub.ai/api/health
{"ok":true,"db":"up","state":"up","migrations":178,"expected":176,"pending":0,
 "error":null,"checkedAt":"2026-08-20T00:42:21.394Z"}

GET https://fundhub.ai/api/health?strict=1
{"ok":true,"db":"up","state":"up","migrations":178,"expected":176,"pending":0,
 "error":null,"checkedAt":"2026-08-20T00:42:56.540Z","missingMigrations":[]}
```

### 1b. Why that proves 200 is applied

`healthState` does not count rows. It compares **keys**:

* `src/http/health.mjs:144` — `const missing = expected.filter((k) => !applied.has(k));`
* `src/http/health.mjs:148` — `body.migrations = applied.size;` (distinct keys in `schema_migrations`)
* `src/http/health.mjs:130` — `expected: expected.length`
* `src/http/health.mjs:151` — `body.state = pending === 0 ? "up" : "behind";`

`db/migrate.mjs:137` inserts one `schema_migrations` row per file, keyed `<dir>/<file>`
(`db/migrate.mjs:107` reads them back the same way).

The expected list is `db/expected-migrations.mjs`. I opened it:

* line 165 — `"migrations/200_dispute_rls_policies.sql"`
* line 166 — `"migrations/201_no_bare_rls_sweep.sql"`
* array length (measured by import): **176** — identical to the live `expected: 176`.

The deployed bundle carries its own copy of that list, so I checked that a 176-entry list
could only be a list containing 200. Git says yes:

| commit | contains `200_dispute` | entries |
|---|---|---|
| `6c7860dc~1` | **no** | 160 |
| `6c7860dc` "Unlock the credit-dispute tables…" | **yes** | 163 |
| `a0fb69cf` | yes | 176 |
| `74c74247` (HEAD, main) | yes | **176** |

The list only reached 176 *after* 200 was already in it. Live reports `expected: 176`.
Therefore the deployed expected list contains `migrations/200_dispute_rls_policies.sql`,
and `pending: 0` / `missingMigrations: []` means that key **is present in
`schema_migrations` on the production database.**

**200 is applied. 201 is applied by the same proof (line 166, same list).**

### 1c. So what does a zero on a dispute table mean?

`db/migrations/200_dispute_rls_policies.sql:134-148`, which has now run against live:

```
134  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
135  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
137  pol := t || '_app_all';
145-148  CREATE POLICY %I ON public.%I USING (true) WITH CHECK (true)
```

over the six tables named at `200:113-120`: `dispute_cases`, `dispute_items`,
`dispute_letters`, `dispute_responses`, `furnisher_mail_addresses`, `repair_decision_log`.

`USING (true)` hides nothing from `fundhub_app`.

> **A zero count on `dispute_cases` / `dispute_items` / `dispute_letters` /
> `dispute_responses` read TODAY means EMPTY. It does not mean DENIED.**

### 1d. Was W5's zero taken before or after the unlock? — after, on the timeline

`6c7860dc` (the commit that adds 200) landed on `main` inside merge `7db4ba69`, committed
**2026-08-18 21:57:02 -0700**. Deploys run from `main` (CLAUDE.md:253) and migrations run on
the production context (CLAUDE.md:277-287). W5's file was written 2026-08-19 17:20 local —
roughly nineteen hours later.

W5 line 202 says the four tables are "all 0 rows". On that timeline the unlock had already
shipped, so **W5's zeros are almost certainly true empties.** I cannot pin the exact Netlify
deploy timestamp from here, so I mark the *timing* NOT VERIFIED while the *conclusion for
today* is verified.

### 1e. One W5 claim I could not verify and that no file in this repo supports

W5 lines 16-18 says:

> "`pg_policies` shows `clients_app_all` and `funding_rounds_app_all` with `qual = true`."

**No migration in `db/` creates a policy named `clients_app_all` or
`funding_rounds_app_all`.** I grepped all of `db/` for `app_all`; the only producers are
`200:137` (the six dispute tables), `177_agents_live_integrity.sql:218`,
`203_bookings_rls_policy.sql:137`, `235_affiliate_link_clicks.sql:146` and
`245_education_enrollments.sql:84`. The blanket sweeps name their policies
`<table>_no_bare_rls` instead (`109:82`, `154:26`, `201:51-52`).

Either those two policies were created out of band on live — which is exactly the failure
mode `200`'s header documents at lines 37-41 — or W5 paraphrased a policy name it saw.
**NOT VERIFIED. Reason: no database access.** It does not change 1c.

### 1f. Correction to my own briefing

I was pointed at `db/migrations/104_app_role.sql:26-27` for "fundhub_app is NOBYPASSRLS by
design". Lines 26-27 are prose about superusers. The actual declarations are:

* `104_app_role.sql:115` — `NOBYPASSRLS` in the `CREATE ROLE fundhub_app` branch
* `104_app_role.sql:132` — `NOBYPASSRLS` re-asserted in the `ALTER ROLE` branch
* `104_app_role.sql:264-266` — the check that rolls the whole migration back if the role can
  reach `BYPASSRLS` through a group membership

The claim is true. The line reference was not.

---

## 2. TYPED COLUMNS vs JSONB

### 2a. The typed columns all exist — Round 1's "NO COLUMN" verdict is partly wrong

All eight columns I was asked about exist in `db/schema/005_client_custom_fields.sql`.
I opened the file and read each line:

| # | column | line | type | comment on that line |
|---|---|---|---|---|
| 1 | `employee_next_action` | **32** | `text` | SINGLE_OPTIONS · Employee Next Action |
| 2 | `fraud_alert_present` | **189** | `text[]` | CHECKBOX · Fraud Alert Present |
| 3 | `fraud_alert_cleared_date` | **196** | `date` | DATE · Fraud Alert Cleared Date |
| 4 | `funding_fee_locked` | **245** | `text[]` | CHECKBOX · Funding Fee Locked |
| 5 | `funding_locked_date` | **259** | `date` | DATE · Funding Locked Date |
| 6 | `document_status` | **302** | `text` | SINGLE_OPTIONS · Document Status |
| 7 | `total_approved_amount` | **304** | `text` | MONETORY · Total Approved Amount |
| 8 | `approvals_count` | **183** | `numeric` | NUMERICAL · Approvals Count |

Two more in the same family that the "Lock Fee" question is really about:

* `funding_fee_locked_timestamp` — line **273**, `date`

**The trap, confirmed.** W5 line 199 says of `Lock Fee`: *"NO COLUMN. NO jsonb KEY.
NOTHING. `column_name ILIKE '%lock%fee%'` → 0 rows."* That pattern requires the letters
`lock` to appear **before** `fee`. Every real column puts them the other way round —
`funding_**fee**_**lock**ed`. The pattern could never have matched. **Three columns exist
and W5 reported none.** The correct search is by concept (`%lock%`), not by a guessed
compound.

W5's other three "NO COLUMN" verdicts (`File Prep`, `Ready to Fund`, `Review Disputes`) are
literally true for those exact strings, but "NOTHING" overstates it — adjacent columns exist:
`letters_ready` (**185**), `ready_for_next_round` (**77**), `business_prep_summary_url`
(**198**), `document_status` (**302**).

### 2b. Non-null counts on the typed columns — **structurally zero, and I can prove it without the database**

This is stronger than a count, so I am giving it instead of one.

`client_custom_fields` is 304 columns wide (`db/schema/005_client_custom_fields.sql`, 313
lines, header at lines 1-4: *"Auto-generated from 300 live GHL custom fields … Do NOT
hand-edit"*).

**The entire repository contains exactly one writer to that table.**

* `src/handlers/client-custom-fields.mjs:68-76` — the only `INSERT INTO client_custom_fields`
  outside test files. Its column list is built from `CF_SVY_TYPED_COLUMNS`
  (`src/handlers/client-custom-fields.mjs:6-22`), which is **fifteen `cf_svy_*` names and
  nothing else.**
* I grepped `db/` for `INSERT INTO client_custom_fields` / `UPDATE client_custom_fields`:
  **zero hits.** No migration or seed ever backfilled it.
* `src/demo/platform-seed.mjs:416` only `DELETE`s from it.

**None of the eight columns is in `CF_SVY_TYPED_COLUMNS`.** No code path exists that can
put a value in any of them. So:

| typed column on `client_custom_fields` | non-null rows | basis |
|---|---|---|
| `employee_next_action` | **0** | no writer exists |
| `fraud_alert_present` | **0** | no writer exists |
| `fraud_alert_cleared_date` | **0** | no writer exists |
| `funding_fee_locked` | **0** | no writer exists |
| `funding_locked_date` | **0** | no writer exists |
| `document_status` | **0** | no writer exists |
| `total_approved_amount` | **0** | no writer exists |
| `approvals_count` | **0** | no writer exists |

W5 measured 20 rows in the table with 0 non-null on the ones it checked. That agrees with
this proof exactly. **Row count of the table itself: 20 per W5 — NOT VERIFIED by me.**

**These are columns that exist and that nothing will ever write.** That is the finding.

### 2c. Where the same concepts DO get written — `clients.custom_fields` (jsonb)

The workflows write these names, but into the **jsonb blob on `clients`**, not the typed
table. The helper:

```
src/workflows/custom-fields.mjs:5-11
  export async function mergeCustomFields(db, clientId, patch) {
    ...
    `UPDATE clients SET custom_fields = custom_fields || $2::jsonb WHERE id = $1`
```

Its own comment (line 4) says: *"Merge a partial object into clients.custom_fields (jsonb)."*

Call sites that write these exact keys — all opened and read:

| jsonb key | written at |
|---|---|
| `employee_next_action` | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:37,45` · `c-02-inquiry-created.mjs:54` · `c-05-pre-funding-review.mjs:39,44` · `c-06-crs-results-router.mjs:162` · `f-01-funding-intake.mjs:65` · `f-02-portal-id-missing.mjs:43` · `f-03-round-submitted.mjs:35` · `f-04-round-approvals.mjs:32` · `f-06-funding-conditions-missing-docs.mjs:32,48` · `f-11-bank-email-event-router.mjs:62` · `s-06-post-call-funding-purchased.mjs:42` · `src/handlers/inquiry-docs.mjs:27` |
| `funding_locked_date` | `src/workflows/f-07-funding-locked.mjs:65` |
| `round_hold_reason` | `c-02:54` · `c-03:37` · `c-05:44` · `c-00-crs-soft-pull-request.mjs:69` · `f-06:31,77` |
| `fraud_alert_present` · `fraud_alert_cleared_date` · `funding_fee_locked` · `document_status` · `total_approved_amount` · `approvals_count` | **no writer found anywhere — jsonb or typed** |

`total_approved_amount` has one more trap: it **is** written live, but to a **different
table**. `funding_closeout.total_approved_amount` (`src/funding/closeout.mjs:93,110`) is a
real, written column. `src/funding/closeout.mjs:66` warns in its own comment that the name
is historical and the value is a fee basis, not an approval total. Same words, three
different places, two of which nothing writes.

### 2d. Side by side

| concept | typed col on `client_custom_fields` | non-null there | jsonb key on `clients.custom_fields` | clients carrying the key |
|---|---|---|---|---|
| `employee_next_action` | **exists** (005:32) | **0** (no writer) | **written** by 13 call sites | **8 of 47** — W5:66 · NOT VERIFIED by me |
| `fraud_alert_present` | **exists** (005:189) | **0** (no writer) | **no writer** | NOT VERIFIED |
| `fraud_alert_cleared_date` | **exists** (005:196) | **0** (no writer) | **no writer** | NOT VERIFIED |
| `funding_fee_locked` | **exists** (005:245) | **0** (no writer) | **no writer** | NOT VERIFIED |
| `funding_locked_date` | **exists** (005:259) | **0** (no writer) | **written** — f-07:65 | NOT VERIFIED |
| `document_status` | **exists** (005:302) | **0** (no writer) | **no writer** | NOT VERIFIED |
| `total_approved_amount` | **exists** (005:304) | **0** (no writer) | **no writer** — but a *different table*, `funding_closeout`, has a written column of the same name | NOT VERIFIED |
| `approvals_count` | **exists** (005:183) | **0** (no writer) | **no writer** | NOT VERIFIED |

---

## 3. THE SIX ROLLUPS

### 3a. First, a framing correction — **these six tiles do not exist in the product**

I searched all of `public/`, `src/` and `api/` for the labels. Result:

* `Total Approved` — one hit, `public/app/client-control-panel.html:449` (a per-client tile,
  not a book-wide rollup)
* `Prequal` — `public/app/client-control-panel.html:448`
* **`Total Clients`, `Needs Pull`, `Action Needed`, `Ready`, `Total Prequal` — zero hits anywhere.**

They come from W5's own proposal section (`W5-live-data.md:342-472`), where W5 itself already
marks three of them "**no**, definition undecided" and one "**NOT COMPUTABLE**". They are a
design suggestion, not a screen anyone is looking at. Re-measuring them as if they were live
would be measuring something that does not exist.

**Numbers: NOT VERIFIED. Reason: no database access.** W5's figures, attributed to W5:

| rollup | W5's answer (W5:467-472) | W5's own confidence |
|---|---|---|
| Total clients | 47 / 37 / 26 / 19 | "yes, once Chris picks which" |
| Needs Pull | 0, 46 or 30 | **no** — definition undecided |
| Action Needed | 26 | only as "has an open task" |
| Ready | (see W5:421) 1 | 1, and it is the archived TEST client |
| Total Prequal | $50,000 | **no** — one client out of 47 |
| Total Approved | NOT COMPUTABLE | **no** — `funding_rounds` empty |

### 3b. The four client populations — **the SQL is sound, the numbers are NOT VERIFIED**

W5's own query (`W5-live-data.md:347`) is the right shape:

```sql
count(*)                                                     -- all
count(*) FILTER (WHERE is_demo = false)                      -- non-demo
count(*) FILTER (WHERE is_demo = false
                   AND custom_fields->>'crm_archived_at' IS NULL)  -- non-demo, not archived
```

and the fourth ("looks like a real person") adds email exclusions (`W5:41-42`):
`email NOT LIKE 'prove_%'`, `NOT LIKE '%@example.com'`, `NOT LIKE 'stanbridgejchris%'`,
`NOT LIKE 'e2e+%'`.

47 / 37 / 26 / 19 are **W5's counts, not mine.** I could not re-run them.

Two things I *can* say about that fourth number: the email-prefix list is a judgement call
written by hand, not a flag in the schema. There is no `is_test` column. So 19 is not a
measurement in the way 47 is — it is a filter someone chose. That should be said out loud
before anyone puts it on a screen.

### 3c. **Which population should an operator see? — the code makes a choice, and the two endpoints disagree. VERIFIED.**

I opened both files and read every line of both `WHERE` clauses.

**`api/dashboard/clients.mjs:45-46`** — the whole filter:

```
45    WHERE c.org_id = $1
46      AND ($3::boolean OR COALESCE(c.is_demo, false) = false)
```

**There is no archive filter in this file at all.** I grepped: `crm_archived_at` appears
zero times in `api/dashboard/clients.mjs`.

**`api/dashboard/pipeline.mjs:52-54`**:

```
52    WHERE p.key = $1 AND p.org_id = $2 AND cd.org_id = $2
53      AND ($4::boolean OR COALESCE(c.is_demo, false) = false)
54      AND (c.custom_fields->>'crm_archived_at' IS NULL)
```

**Confirmed: `clients.mjs` filters demo but NOT archived; `pipeline.mjs` filters both.**
`api/dashboard/pipeline-counts.mjs:34-35` matches `pipeline.mjs` (its comment at lines 12-14
says so deliberately).

**A correction to how that was stated to me.** Neither endpoint filters `is_demo`
unconditionally. Both are gated on a live org flag:

* `src/demo/exclude-demo.mjs:4-8` — `orgDemoModeEnabled` reads `orgs.demo_mode_enabled`
* `api/dashboard/clients.mjs:75` and `api/dashboard/pipeline.mjs:83` pass that result in as
  `$3` / `$4`
* When it is **true**, `($3::boolean OR …)` short-circuits and **demo clients are shown.**

So the operator's client list is one of two populations depending on a database flag I
cannot read:

| `orgs.demo_mode_enabled` | `/api/dashboard/clients` shows | `/api/dashboard/pipeline` shows |
|---|---|---|
| **false** | non-demo, **archived included** → W5's **37** | non-demo, not archived → W5's **26** |
| **true** | **everyone**, archived included → W5's **47** | all, not archived |

**The live value of `orgs.demo_mode_enabled` is NOT VERIFIED. Reason: no database access.**

One more thing an operator should know, verified: `api/dashboard/clients.mjs:74` caps the
list at **50 by default** (`boundedLimit(req.query?.limit, { fallback: 50, cap: 500 })`). If
the book ever passes 50, the screen silently shows a page, not a population. `pipeline.mjs:76`
uses 500/2000.

**My answer to "which one should an operator see":** the archived filter is the real
disagreement, and it is a bug, not a preference. The same person shows up on the client list
and is missing from the board, with nothing on screen explaining why. Whichever population
Chris picks, **both endpoints should apply the same three filters.** Today they do not.

---

## 4. CARDS — **NOT VERIFIED**

Counts of cards, their pipelines and their stages, and the count of distinct clients holding
at least one card, all require the database. **I could not read it.**

W5 reports (attributed, not re-verified):

* `W5-live-data.md:313` — **19 clients have a pipeline card**
* `W5:122` — the simulated demo client has **1** card
* `W5:186` and `W5:541` — Chris's TEST client has **ZERO** cards; "this client is on no board"

What I *did* verify, from the files:

**The rails.** `db/seed/002_pipelines.sql:11-18` seeds six: `sales`,
`funding_card_stacking`, `funding_altfin`, `optimization`, `inquiry_removal`,
`ar_collections`. Two more arrive by migration — `db/migrations/051_hiring.sql:77` and
`db/migrations/115_affiliates_white_label.sql:51` — giving the eight rails
`api/dashboard/pipeline-counts.mjs:8` refers to.

**The stages.** `db/seed/002_pipelines.sql:27-59`, 45 stage rows including four explicitly
labelled `(legacy)` on the `optimization` rail (lines 50-51).

**Who writes a card.** `src/workflows/cards.mjs:79` (`UPDATE cards SET stage_id`) and
`src/workflows/cards.mjs:82` (`INSERT INTO cards`), plus two demo seeders
(`src/demo/simulate-client.mjs:363`, `src/demo/platform-seed.mjs:93`). `src/workflows/cards.mjs`
is reached through the Inngest workflow layer.

**Anyone comparing "clients with a card" to "total clients" must use the same population on
both sides** — the board already drops archived clients (§3c) and the client list does not,
so the two figures are not measured against the same denominator today.

---

## 5. `funding_rounds`, `applications`, `application_decisions`, `funding_closeout`

### 5a. Row counts — **NOT VERIFIED**

W5 (`W5-live-data.md:57-58`, `W5:229-234`) reports all four at **0 rows**, alongside
`application_scores`, `funding_closeout_items`, `funding_round_sales`, `lenders`, `entities`
and others. Attributed to W5. Not re-measured.

### 5b. **`funding_rounds` has no column called `round_hold_reason`. VERIFIED.**

I was asked for "the distinct values of `status` and `round_hold_reason` actually present"
on `funding_rounds`. The second column does not exist. I opened the table definition:

```
db/schema/001_init.sql:119   CREATE TABLE funding_rounds (
                    :123     round_number     integer NOT NULL,
                    :124     status           text NOT NULL,
                    :125     product          text,
                    :126     submitted_amount numeric(14,2),
                    :127     approved_amount  numeric(14,2),
                    :128     funded_amount    numeric(14,2),
                    :129     hold_reason      text,
                    :130     conditions       jsonb NOT NULL DEFAULT '[]'::jsonb,
```

The column is **`hold_reason`** (line 129). `round_hold_reason` is a *different thing in two
other places*: a typed column on `client_custom_fields`
(`db/schema/005_client_custom_fields.sql:153`) and a jsonb key on `clients.custom_fields`
written by six workflow call sites (see §2c).

Querying `funding_rounds.round_hold_reason` returns an error, not a zero. This is the same
class of mistake as the `%lock%fee%` pattern: a name that sounds right and is not.

`status` has **no CHECK constraint** on `funding_rounds` — `001_init.sql:124` is a bare
`text NOT NULL`. So the set of values is whatever writers put there, and the writers are:
`src/handlers/money-chain.mjs:709` (`INSERT`), `src/workflows/f-09-funding-declined-no-path.mjs:31`
(`UPDATE … SET hold_reason`), `src/demo/platform-seed.mjs:106` (demo only, `is_demo=true`).

**Distinct values present: NOT VERIFIED. Reason: no database access.**

### 5c. Writers exist for all four — so "empty" is not "unbuilt"

| table | real (non-demo, non-test) writer |
|---|---|
| `funding_rounds` | `src/handlers/money-chain.mjs:709` |
| `applications` | `src/verification/journeys/funding.mjs:575,586` · `src/applications/status.mjs:84` (update) |
| `application_decisions` | `src/applications/status.mjs:90` |
| `funding_closeout` | `src/funding/closeout.mjs:109` |

The code to fill these tables is written. If they are empty, the question is what stops the
writers running — not whether they exist. CLAUDE.md:302 names `INNGEST_EVENT_KEY` as the
switch that makes 47 workflow functions go live and puts it on the "ask me first" list.
**Whether that key is set live: NOT VERIFIED. Reason: no database or Netlify access.** That
is the single most useful thing left to check and it takes one command.

---

## 6. THE TEST CLIENT AND THE SIMULATED DEMO CLIENT — **NOT VERIFIED**

Both facts I was asked to confirm need the database. I could not read it. W5's claims,
attributed:

| claim | W5 line | my status |
|---|---|---|
| TEST client (`TEST Client Role`, `FH-000140`, created 2026-08-16T10:22:56Z) is archived: `custom_fields.crm_archived_at = 2026-08-18T21:45:03.377Z` | `W5:135`, `W5:157` | **NOT VERIFIED** |
| TEST client's only `crs_results` row is a demo copy: `is_demo=true`, `environment=simulated` | `W5:544` | **NOT VERIFIED** |
| TEST client has zero pipeline cards | `W5:186`, `W5:541` | **NOT VERIFIED** |
| TEST client `crs_status = 'Ready'` with "no writer anywhere in the repo" | `W5:501` | **W5 IS WRONG AS WRITTEN — corrected below.** The live value itself, NOT VERIFIED |
| Simulated demo client `376376b3-7ee5-4c3a-b0e7-563ca9681478` has 1 card | `W5:122` | **NOT VERIFIED** |

### 6a. Correcting W5 on `crs_status` — **writers DO exist. None of them writes `Ready`.**

W5:501 says of `crs_status = 'Ready'`: *"No writer exists in this repo."* That is not right,
and I nearly repeated it. I grepped `src/`, `api/`, `netlify/` and `scripts/` excluding test
files and opened every hit:

* `src/workflows/c-00-crs-soft-pull-request.mjs:65-70` — writes `crs_status: "Requested"`
* `src/workflows/u-03-crs-snapshot-sync.mjs:18-22` — writes `crs_status: "Complete"`
* `src/workflows/c-05-pre-funding-review.mjs:34` — **reads** it, comparing to `"Complete"`

Both writers go through `mergeCustomFields`, so the value lands in `clients.custom_fields`
(jsonb), never in the typed `client_custom_fields.crs_status` column
(`db/schema/005_client_custom_fields.sql:19`) — same split as §2c.

The precise finding is sharper and worse than W5's version: **the repository writes exactly
two values, `Requested` and `Complete`, and `Ready` is neither.** A grep for `Ready` next to
`crs_status` across `src/`, `api/` and `scripts/` returns nothing. So if the live TEST client
really reads `Ready`, that value came from outside this codebase — and
`c-05-pre-funding-review.mjs:34` tests for `=== "Complete"`, so a client sitting at `Ready`
never satisfies that gate and never advances. **Live value: NOT VERIFIED.**

### 6b. `crm_archived_at`

`crm_archived_at` is **not a column.** It is a jsonb key on `clients.custom_fields`, stamped
by `api/dashboard/client-archive.mjs:50` (`const stamp = { crm_archived_at: new Date().toISOString() };`).
It is read in exactly two places — `api/dashboard/pipeline.mjs:54` and
`api/dashboard/pipeline-counts.mjs:35`. Nowhere else in the codebase respects it.

---

## WHAT THIS ROUND SETTLED, AND WHAT IT DID NOT

**Settled, with evidence I opened and read:**

1. Migration 200 **is applied** on the live database. Zero rows on the four dispute tables
   means **empty**, not denied. Round 1's assertion survives, though Round 1 could not have
   known that — it never checked whether the unlock had shipped.
2. All eight typed columns **exist** in `db/schema/005_client_custom_fields.sql`, at lines
   32, 183, 189, 196, 245, 259, 302 and 304.
3. **Nothing can ever write any of them.** The table has exactly one writer and it touches
   fifteen `cf_svy_*` columns. This is a structural proof, stronger than a count.
4. Round 1's `%lock%fee%` search was incapable of matching `funding_fee_locked`. Three real
   columns were reported as "NOTHING".
5. `api/dashboard/clients.mjs` does **not** filter archived clients; `api/dashboard/pipeline.mjs:54`
   and `pipeline-counts.mjs:35` do. Both demo filters are **conditional** on
   `orgs.demo_mode_enabled`, not unconditional.
6. `funding_rounds` has **`hold_reason`**, not `round_hold_reason`. The question as posed
   cannot be answered because the column does not exist.
7. The six rollup tiles are a Round 1 proposal. **No such screen exists in this product.**

**Not settled, and why:** every live row count. My tool layer refused access to `.env` and
`DATABASE_URL` is not in the environment. I did not route around that refusal. Anyone who
needs those numbers should re-run with database access granted; the SQL in §3b is the right
shape to start from, with `hold_reason` substituted in §5b.
