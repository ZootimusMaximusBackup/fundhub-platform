# R1 — Column Reality

Round 2. Every line number below was opened and read before it was written down.
Findings only. No code was written.

---

## The one fact that explains everything else

There are **two different storage places** with the **same field names**, and the
codebase mixes them up.

| | Where it lives | Who writes it |
|---|---|---|
| **Typed column** | `client_custom_fields` table — one real column per field, 305 of them | **Only 15 survey columns.** Nothing else, ever. |
| **JSONB key** | `clients.custom_fields` — one blob of key/value pairs | 20+ places across the app |

**Proof that only survey columns are written to the typed table.** I searched every
file under `src/`, `api/`, `netlify/`, `scripts/`, and `db/` for the table name
`client_custom_fields`. The complete list of hits is 24 lines. Exactly **one** of them
is an INSERT or UPDATE:

- `src/handlers/client-custom-fields.mjs:69` — `INSERT INTO client_custom_fields (...)`
- The columns it can write are fixed at `src/handlers/client-custom-fields.mjs:6-22`
  (`CF_SVY_TYPED_COLUMNS`) — all 15 begin `cf_svy_`.
- The only other write of any kind is a `DELETE` in demo cleanup,
  `src/demo/platform-seed.mjs:416`.

`db/migrations/163_cf_svy_typed_columns.sql:4` states the design in the repo's own
words: *"jsonb on clients.custom_fields remains source of truth; these columns are the
typed mirror."*

**So: for every column in this report, the answer to "does anything write the typed
column?" is NO.** The only question worth asking per-column is whether the *jsonb key*
of the same name is written.

---

## 1. Task item 3 — CONFIRMED

> *Round 1's headline says the typed column `employee_next_action` has no writer, and
> that `src/handlers/client-custom-fields.mjs:69` only writes `cf_svy_*` survey columns.*

**CONFIRMED, with a correction of emphasis.**

- `src/handlers/client-custom-fields.mjs:69` is indeed the INSERT line. Read it.
- It only writes the 15 `cf_svy_*` names listed at lines 6-22.
- The typed column `employee_next_action` (`db/schema/005_client_custom_fields.sql:32`)
  has **no writer anywhere**.

**The correction:** the jsonb key `employee_next_action` has **twelve** writers and is
very much alive. Round 1's headline is true about the column and misleading about the
field. Confirmed writers, all via `mergeCustomFields`
(`src/workflows/custom-fields.mjs:5-11`, which runs
`UPDATE clients SET custom_fields = custom_fields || $2::jsonb`):

| value written | file:line |
|---|---|
| `"Pull CRS"` | `src/workflows/c-05-pre-funding-review.mjs:44` |
| `"Pull CRS"` | `src/workflows/s-06-post-call-funding-purchased.mjs:42` |
| `"Collect Documents"` | `src/workflows/f-01-funding-intake.mjs:65` |
| `"Collect Documents"` | `src/workflows/f-02-portal-id-missing.mjs:43` |
| `"Collect Documents"` | `src/workflows/f-06-funding-conditions-missing-docs.mjs:32` |
| `"Collect Documents"` | `src/workflows/f-06-funding-conditions-missing-docs.mjs:48` |
| `"Remove Inquiries"` | `src/workflows/c-02-inquiry-created.mjs:54` |
| `"Remove Inquiries"` | `src/workflows/f-03-round-submitted.mjs:35` |
| `"Clear Fraud Alert"` | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:37` |
| `"Review Funding File"` | `src/workflows/c-05-pre-funding-review.mjs:39` |
| `"Apply for Funding"` | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45` |
| `"Prepare Next Funding Round"` | `src/workflows/f-04-round-approvals.mjs:32` |
| `"Prepare Next Funding Round"` | `src/workflows/f-11-bank-email-event-router.mjs:62` |
| `"Closed/Stop"` | `src/workflows/c-06-crs-results-router.mjs:162` |
| `"Collect inquiry identity packet"` | `src/handlers/inquiry-docs.mjs:27` |

The CRM screen reads the **jsonb** one and therefore works:
`public/app/client-control-panel.html:839` sets `var cf = c.custom_fields || {}`, and
`:889` paints `cf.employee_next_action`.

**Nine distinct strings are written. Only 7 of Chris's 11 values appear among them.**
Missing entirely as written values: `Lock Fee`, `File Prep`, `Review Disputes`,
`Ready to Fund`. And `Prepare Next Round` is written as
`"Prepare Next Funding Round"` — a different string.

---

## 2. Task item 4 — CONFIRMED, and it is worse than reported

> *`src/agents/context.mjs:109` reportedly reads `employee_next_action` from the dead
> typed column, making the AI context line at `:268` always blank.*

**CONFIRMED.**

- `src/agents/context.mjs:101-113` is one `db.query`. Line 110 reads
  `FROM client_custom_fields`. Line 109 is the last field in the SELECT list and
  includes `employee_next_action`.
- `src/agents/context.mjs:174` — `employee_next_action: cf.employee_next_action || null`
  where `cf` is that typed row (`const cf = cfRes.rows[0] || {}`, line 133).
- `src/agents/context.mjs:268` — `if (s.employee_next_action) lines.push(...)`. Always
  false, so the line is never emitted.

**Worse than reported: that same query pulls 16 fields, and 12 of them are dead for the
same reason.** Every one of these is read from the typed table and written nowhere but
jsonb (or nowhere at all):

| field read at context.mjs | line | used at | status |
|---|---|---|---|
| `agent_context` | 102 | :171 | dead — no writer anywhere |
| `crs_fico_score` | 102 | :142 | dead in typed table; jsonb key written at `src/workflows/u-03-crs-snapshot-sync.mjs:21` |
| `primary_fico_score` | 102 | :142 | dead — no writer anywhere |
| `analyzer_prequal_amount` | 103 | :143 | dead in typed table; jsonb key written at `src/handlers/client-lifecycle.mjs:450` |
| `cf_reanalyzer_prequal_amount` | 103 | :144 | dead — no writer anywhere |
| `total_funding_estimate` | 104 | :145 | dead in typed table; jsonb key written at `src/handlers/client-lifecycle.mjs:449` |
| `funding_round_number` | 104 | :158, :164-165 | dead — no writer anywhere |
| `funding_fico_band` | 104 | :169 | dead — no writer anywhere |
| `how_much_funding_does_your_business_need` | 105 | :138 | dead — not in `CF_SVY_TYPED_COLUMNS` |
| `what_will_the_funding_be_used_for` | 106 | :138 | dead — not in `CF_SVY_TYPED_COLUMNS` |
| `what_is_your_current_credit_score` | 107 | :138 | dead — not in `CF_SVY_TYPED_COLUMNS` |
| `cf_funding_scope` | 109 | :138 | dead — not in `CF_SVY_TYPED_COLUMNS` |
| `analyzer_path_raw` | 109 | :173 | dead — no writer anywhere |
| `cf_svy_self_reported_fico` | 108 | :138 | **LIVE** — written at `client-custom-fields.mjs:14` |
| `cf_svy_funding_target_amount` | 108 | :138 | **LIVE** — written at `client-custom-fields.mjs:15` |
| `employee_next_action` | 109 | :174, :268 | dead |

Plain language: the memory the AI agent reads before every reply is 14 fields wide and
**12 of the 14 are always empty**. Two survey answers get through.

Two other files have the same bug and nobody has reported it:

- `src/sales/cockpit.mjs:27` reads `cf.utm_source, cf.utm_campaign, cf.utm_medium,
  cf.cf_setter_user_id` from the typed table (joined at `:30`). None of the four is
  ever written there. The salesperson cockpit's lead source silently falls back.
- `src/sales/metrics.mjs:336-337` and `:384-385` do the same four fields for the
  belief/lead-source report, joined at `:346` and `:390`. `COALESCE(cf.utm_campaign,
  cf.utm_source, c.channel_source, 'unknown')` always skips the first two.

---

## 3. Task item 1+2 — the full inventory

Every column below was read in `db/schema/005_client_custom_fields.sql` at the line
shown. "TYPED" is NO for all of them, per section 0. "JSONB" is the finding.

### Pull CRS

| line | column | typed written? | jsonb key written? |
|---|---|---|---|
| 19 | `crs_status` | NO | **YES** — `"Requested"` at `src/workflows/c-00-crs-soft-pull-request.mjs:66`; `"Complete"` at `src/workflows/u-03-crs-snapshot-sync.mjs:19` |
| 21 | `cf_crs_pull_scope` | NO | **NEITHER.** Zero hits repo-wide. **Name mismatch:** `c-00-crs-soft-pull-request.mjs:67` writes the jsonb key `crs_pull_scope` — no `cf_` prefix — so it lands in jsonb under a name the typed column does not have. |
| 25 | `crs_fico_score` | NO | **YES** — `src/workflows/u-03-crs-snapshot-sync.mjs:21` |
| 29 | `cf_credit_pull_consent_status` | NO | **NEITHER.** Zero hits repo-wide. |
| 73 | `crs_snapshot_date` | NO | **YES** — `src/workflows/u-03-crs-snapshot-sync.mjs:20` |
| 80 | `cf_business_pull_status` | NO | **NEITHER.** Zero hits repo-wide. |
| 166 | `crs_paid` | NO | **YES** — `src/handlers/client-lifecycle.mjs:324` |
| 252 | `cf_crs_softpull_consent` | NO | **NEITHER.** One mention, and it is a comment saying the column cannot answer the question: `src/finance/soft-pulls.mjs:20`. |
| 272 | `cf_crs_softpull_consent_at` | NO | **NEITHER.** Zero hits repo-wide. |

### Collect Documents

| line | column | typed | jsonb |
|---|---|---|---|
| 15 | `doc_fix_instructions` | NO | **NEITHER.** Zero hits repo-wide. |
| 223 | `docs_received` | NO | **NEITHER.** The one hit, `src/workflows/f-06-funding-conditions-missing-docs.mjs:65`, is a return-value label `branch: "docs_received"`, not a write. |
| 295 | `id_uploaded` | NO | **NEITHER — but it is READ.** `src/workflows/f-02-portal-id-missing.mjs:28` tests `cf.id_uploaded !== true`. Nothing sets it, so that test is always true. |
| 302 | `document_status` | NO | **NEITHER.** Zero hits repo-wide. |

### Remove Inquiries

| line | column | typed | jsonb |
|---|---|---|---|
| 18, 154, 156 | `crs_inquiries_ex` / `_eq` / `_tu` | NO | NOT VERIFIED as writes — appear only in schema and metadata; no write site found. |
| 106, 221, 299 | `primary_inquiries_tu` / `_ex` / `_eq` | NO | NOT VERIFIED as writes — same. |
| 159 | `cf_inquiry_remover_user_id` | NO | **NEITHER.** Zero hits repo-wide. Note `inquiry_removal_cases.inquiry_remover_user_id` (no `cf_`) is a real, written column — `db/migrations/140_inquiry_ops.sql:119`, written via `src/inquiry-ops/cases.mjs:129`. |
| 172 | `last_inquiry_cleanup_date` | NO | **NEITHER.** Zero hits repo-wide. |
| 174 | `inquiry_status` | NO | **NEITHER.** Zero hits repo-wide. |

### Clear Fraud Alert

| line | column | typed | jsonb |
|---|---|---|---|
| 189 | `fraud_alert_present` | NO | **NEITHER.** Two hits, both in `scripts/extract-airtable.mjs` (`:103`, `:310`) — an Airtable extraction field list, not a write to this system. |
| 196 | `fraud_alert_cleared_date` | NO | **NEITHER.** Zero hits repo-wide. |

Real backing that does exist: `inquiry_removal_cases.fraud_alert_after`
(`db/migrations/140_inquiry_ops.sql:116`), writable via `src/inquiry-ops/cases.mjs:129`.
And the workflow branch at `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:36`
reads `event.payload?.fraudAlert` off the event, not off any column.

### Review Funding File

| line | column | typed | jsonb |
|---|---|---|---|
| 81 | `funding_condition_required` | NO | **YES (clear only)** — set to `false` at `src/workflows/f-06-funding-conditions-missing-docs.mjs:78`. Nothing ever sets it true. |
| 149 | `cf_funding_advisor_user_id` | NO | NOT VERIFIED — no write site found. |
| 197 | `funding_condition_description` | NO | **NEITHER.** Zero hits repo-wide. |
| 239 | `cf_funding_scope` | NO | **NEITHER.** Only read, at `src/agents/context.mjs:18` and `:109`. |
| 257 | `funding_summary_url` | NO | **NEITHER.** Zero hits repo-wide. |
| 279 | `funding_delivery_sent` | NO | **YES** — `src/workflows/u-02-analyzer-complete-delivery.mjs:67` |

### Prepare Next Round

| line | column | typed | jsonb |
|---|---|---|---|
| 77 | `ready_for_next_round` | NO | **YES** — `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45` |
| 102 | `funding_round_number` | NO | **NEITHER.** Read only: `src/agents/context.mjs:158`, `:164-165`, and five SMS/email templates in `src/workflows/templates-seed.mjs`. The real number lives on `funding_rounds.round_number` (`db/schema/001_init.sql:123`). |
| 153 | `round_hold_reason` | NO | **YES** — `"Fraud Alert"` at `c-03:37`; `"New Inquiries"` at `c-02-inquiry-created.mjs:54`; `"Awaiting CRS"` at `c-00:69` and `c-05-pre-funding-review.mjs:44`; the reason at `f-06:31`; cleared to `null` at `f-06:77` |

### Apply for Funding

| line | column | typed | jsonb |
|---|---|---|---|
| 23 | `denials_count` | NO | **NEITHER.** Zero hits repo-wide. |
| 183 | `approvals_count` | NO | **NEITHER.** Zero hits repo-wide. |
| 261 | `total_funding_estimate` | NO | **YES** — `src/handlers/client-lifecycle.mjs:449` |
| 275 | `funding_target_amount` | NO | **NEITHER.** Every hit that looks like one is the *different* field `cf_svy_funding_target_amount`. The only bare use is a read of a JS object property at `src/adapters/lendflow.mjs:423`. |

### Lock Fee — round 1 said "NO COLUMN. NO jsonb KEY. NOTHING." That is WRONG

Three typed columns exist. Round 1's live-database probe used
`column_name ILIKE '%lock%fee%'`, which cannot match `funding_fee_locked` because the
words are in the other order.

| line | column | typed | jsonb |
|---|---|---|---|
| 75 | `funding_fee_percent` | NO | **NEITHER.** One hit and it is a comment: `src/workflows/sys-01-client-value-calculator.mjs:8`. |
| 245 | `funding_fee_locked` | NO | **NEITHER.** Zero hits repo-wide. |
| 259 | `funding_locked_date` | NO | **YES** — `src/workflows/f-07-funding-locked.mjs:65` |
| 273 | `funding_fee_locked_timestamp` | NO | **NEITHER.** Zero hits repo-wide. |

So "Lock Fee" is not nothing. It is four named columns, of which one is written, in the
wrong place.

### File Prep

No column is named `file_prep`. Round 1's `ILIKE '%file_prep%'` returning zero is
correct. The nearest columns by concept:

| line | column | typed | jsonb |
|---|---|---|---|
| 187 | `business_available` | NO | **NEITHER.** Zero hits repo-wide. |
| 198 | `business_prep_summary_url` | NO | **NEITHER.** Zero hits repo-wide. |
| 185 | `letters_ready` | NO | **NEITHER.** Every hit (`src/repair/cases.mjs:53, 65, 83, 99`) is a computed count over the `dispute_letters` table, a completely different thing that happens to share the name. |

I am **not** claiming any of these three is "File Prep". They are the only columns whose
names touch the concept. **NOT VERIFIED** that Chris means any of them.

### Review Disputes

Round 1 said "NO COLUMN." Wrong — seven columns exist. Their `ILIKE '%review_dispute%'`
pattern could not match any of the real names.

| line | column | typed | jsonb |
|---|---|---|---|
| 22 | `df_status` | NO | **NEITHER.** Zero hits repo-wide. |
| 205 | `cf_negative_case_status` | NO | **NEITHER.** Zero hits repo-wide. |
| 213 | `df_raw` | NO | **NEITHER.** Zero hits repo-wide. |
| 215 | `df_case_id` | NO | **NEITHER.** Zero hits repo-wide. |
| 220 | `cf_negative_resolution_path` | NO | **NEITHER.** Zero hits repo-wide. |
| 298 | `df_client_id` | NO | **NEITHER.** Zero hits repo-wide. |
| 308 | `df_event` | NO | **NEITHER.** Zero hits repo-wide. |

`df_` almost certainly stands for DisputeFox, the old dispute vendor — the repo carries
a relay for it at `vendor/underwriteiq-full/api/lite/disputefox-relay.js:4`. But
`db/schema/meta/custom-field-map.json:94-99` gives the label as literally `"df_status"`
with no expansion, so **the expansion is INFERRED, NOT VERIFIED**.

### Ready to Fund

| line | column | typed | jsonb |
|---|---|---|---|
| 83 | `cf_graduation_path` | NO | **NEITHER.** Zero hits repo-wide. |
| 111 | `lifecycle_status` | NO | **YES** — `"New Lead"` at `src/workflows/s-01-new-lead-intake.mjs:16` and `src/handlers/client-lifecycle.mjs:260`; `"Funding Client"` at `src/workflows/f-01-funding-intake.mjs:56` and `src/workflows/s-06-post-call-funding-purchased.mjs:42`; `"Survey Complete"` at `src/handlers/client-lifecycle.mjs:286`. **No value "Ready to Fund" is ever written.** |
| 234 | `cf_graduation_date` | NO | **NEITHER.** Zero hits repo-wide. |
| 238 | `cf_graduation_status` | NO | **NEITHER.** Zero hits repo-wide. |

---

## 4. The six rollups

| rollup | column that would back it | typed | jsonb |
|---|---|---|---|
| Total clients | none needed — `clients` table | n/a | n/a |
| Needs Pull | `crs_status` (line 19) | NO | **YES** — `"Requested"` / `"Complete"` only. There is no "needed but not requested" value. |
| Action Needed | `employee_next_action` (line 32) | NO | **YES** — 15 write sites, 9 distinct values |
| Ready | `ready_for_next_round` (77) / `lifecycle_status` (111) | NO | **YES** for both, but neither carries a "Ready" value |
| Total Prequal | `analyzer_prequal_amount` (35), `cf_reanalyzer_prequal_amount` (288), `total_funding_estimate` (261) | NO | `analyzer_prequal_amount` **YES** (`client-lifecycle.mjs:450`); `total_funding_estimate` **YES** (`:449`); `cf_reanalyzer_prequal_amount` **NEITHER** |
| Total Approved | `total_approved_amount` (304), `approvals_count` (183) | NO | **NEITHER for both.** |

**The Total Approved correction.** Round 1 read `client_custom_fields.total_approved_amount`
as empty and stopped there. A column with that exact name is real, written, and holds
money — on a **different table**: `funding_closeout.total_approved_amount`,
`db/migrations/139_funding_ops.sql:32`, written at `src/funding/closeout.mjs:93` (UPDATE)
and `:110` (INSERT). Beware: `src/funding/closeout.mjs:66` warns the name is historical
and the value is a fee basis. Also `applications.approved_amount`
(`db/schema/001_init.sql:143`) and `funding_rounds.approved_amount` (`:127`) are real
columns on real tables.

---

## 5. Which of the 11 values are DERIVABLE

Counting the typed columns changes nothing on its own, because **nothing writes any of
them**. A typed column that exists and is never filled is worth exactly as much as a
column that does not exist. So the honest split is by what the *jsonb* key and the
*relational tables* actually hold.

### Backed today — a real signal exists and something writes it

1. **Pull CRS** — `custom_fields.crs_status` is written `"Requested"` / `"Complete"`
   (`c-00:66`, `u-03:19`), and `employee_next_action` is written `"Pull CRS"`
   (`c-05:44`, `s-06:42`).
2. **Collect Documents** — `employee_next_action` written `"Collect Documents"` at four
   sites (`f-01:65`, `f-02:43`, `f-06:32`, `f-06:48`).
3. **Remove Inquiries** — `employee_next_action` written `"Remove Inquiries"`
   (`c-02:54`, `f-03:35`), plus real rows in `inquiry_removal_cases`
   (`db/migrations/140_inquiry_ops.sql:101`).
4. **Clear Fraud Alert** — `employee_next_action` written `"Clear Fraud Alert"`
   (`c-03:37`), plus `inquiry_removal_cases.fraud_alert_after` (`140:116`).
   The two `fraud_alert_*` typed columns stay empty.
5. **Review Funding File** — `employee_next_action` written `"Review Funding File"`
   (`c-05:39`).
6. **Apply for Funding** — `employee_next_action` written `"Apply for Funding"`
   (`c-03:45`).

### Backed but the name does not match

7. **Prepare Next Round** — the code writes `"Prepare Next Funding Round"`
   (`f-04:32`, `f-11:62`). Same idea, different words. Any exact-string filter on
   `"Prepare Next Round"` returns nothing forever.

### Genuinely unbacked — no writer of any kind, in either place

8. **Lock Fee** — four columns exist (75, 245, 259, 273). One jsonb key is written
   (`funding_locked_date`, `f-07:65`). No `employee_next_action` value `"Lock Fee"` is
   ever written. `funding_fee_locked` and `funding_fee_locked_timestamp` have zero
   references in the entire codebase.
9. **File Prep** — no column of that name; the three nearest ones (185, 187, 198) have
   zero references.
10. **Review Disputes** — seven columns exist (22, 205, 213, 215, 220, 298, 308) and
    every one has zero references in the entire codebase.
11. **Ready to Fund** — four columns exist (83, 111, 234, 238); only `lifecycle_status`
    is written, and never with a value meaning "ready to fund".

---

## 6. Round-1 claims this round proves wrong

1. **"Lock Fee — NO COLUMN. NO jsonb KEY. NOTHING."**
   (`W5-live-data.md:199`) — WRONG. Four typed columns exist:
   `funding_fee_percent` (005:75), `funding_fee_locked` (005:245),
   `funding_locked_date` (005:259), `funding_fee_locked_timestamp` (005:273). Their
   probe pattern `%lock%fee%` cannot match `funding_fee_locked`.

2. **"Review Disputes — NO COLUMN."** (`W5-live-data.md:202`) — WRONG. Seven typed
   columns exist (005:22, 205, 213, 215, 220, 298, 308). Their pattern
   `%review_dispute%` matches none of the real names.

3. **"File Prep — NO COLUMN."** (`W5-live-data.md:200`) — TECHNICALLY TRUE for that
   exact name, but incomplete: `business_prep_summary_url` (005:198),
   `business_available` (005:187) and `letters_ready` (005:185) exist and were not
   reported.

4. **"Ready to Fund — NO COLUMN."** (`W5-live-data.md:201`) — INCOMPLETE.
   `cf_graduation_status` (005:238), `cf_graduation_path` (005:83) and
   `cf_graduation_date` (005:234) exist alongside the `ready_for_next_round` they did
   mention.

5. **"Total Approved — always NULL"** (`W5-live-data.md:214`) — TRUE about
   `client_custom_fields`, but it misses that
   `funding_closeout.total_approved_amount` (`db/migrations/139_funding_ops.sql:32`) is a
   real written column, filled at `src/funding/closeout.mjs:93` and `:110`.

6. **"`employee_next_action` has no writer"** — TRUE about the typed column, MISLEADING
   about the field. Fifteen jsonb write sites, listed in section 1.

---

## 7. NOT VERIFIED

- Whether `df_*` means DisputeFox. Inferred from
  `vendor/underwriteiq-full/api/lite/disputefox-relay.js:4`; the field map
  (`db/schema/meta/custom-field-map.json:94-99`) gives no expansion.
- Whether Chris's "File Prep" refers to `business_prep_summary_url` or anything else in
  this schema. No evidence either way — that is a question for him, not a guess for me.
- Live row counts. I read code and schema only; I ran no query against any database.
  Section 6's live-NULL claims are quoted from round 1's W5, not re-measured here.
- `crs_inquiries_*` and `primary_inquiries_*` (005:18, 106, 154, 156, 221, 299): I
  found no write site, but these were not exhaustively traced through the CRS adapter.
- Whether the Inngest workflows that write the jsonb keys actually run in production.
  `api/read/workflows.mjs:52-59` records that `INNGEST_EVENT_KEY` and
  `INNGEST_SIGNING_KEY` are both set as of 2026-08-19 and that function bodies have
  executed, but also that whether production's events reach Inngest at all is
  **UNPROVEN**. Every "YES — jsonb written" above is a proof that the code exists, not
  a proof that it fired.
