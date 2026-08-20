# W3 — Documents and Money (Phase 0, findings only)

**COMPLIANCE REVIEW REQUIRED** — see §5. This touches fee timing and refund behavior.

**Date:** 2026-08-19 · **Agent:** W3 · **Scope:** findings only. No product code written.
No migrations. No writes. No new screens.
**Rule followed:** every claim carries `file:line`. Where nothing exists it says
**NOT FOUND** and names where I looked.

---

## HEADLINE — read this first

Three values were assigned to me. Here is the short answer on each.

1. **"Collect Documents" EXISTS** and is written by four places. **Two of those four are
   broken in opposite directions.** One can never fire; one can never stop firing.
2. **"File Prep" DOES NOT EXIST** in this repository. Zero hits. The only hit in the whole
   tree is a vendor QA script describing somebody else's system.
3. **"Lock Fee" DOES NOT EXIST** as a next-action value. Zero hits. **But the thing it
   names is real** — there is an exact column that freezes the fee, and there is a real
   task row that gets created when the fee is not ready. That task is the only durable
   record of "the fee is not locked" anywhere in the system.

Three things that change the plan:

**A. F-06 can never say "Collect Documents" on a real bank email.**
`src/workflows/f-06-funding-conditions-missing-docs.mjs:39` refuses to continue unless the
event carries `conditionDescription`. The real Mailgun payload is built at
`src/adapters/mailgun.mjs:652-658` and its keys are exactly
`classification, from, to, subject, clientId, source`. **There is no
`conditionDescription` key.** Only the test fixture supplies one
(`src/workflows/f-06-funding-conditions-missing-docs.test.mjs:19`). So F-06's
missing-docs branch exits `no_condition_description` on every real bank email, and neither
of its two `employee_next_action` writes (`:32` and `:48`) ever runs in production.

**B. F-02 can never stop saying "Collect Documents".**
`src/workflows/f-02-portal-id-missing.mjs:28` gates on
`cf.id_uploaded !== true || cf.portal_onboarding_status !== "Complete"`.
**Nothing anywhere writes either key.** Grepped `src/ api/ public/ db/ netlify/` for both:
the only hits are that one read, the test fixtures, the dead typed columns
(`db/schema/005_client_custom_fields.sql:295` and `:167`) and the GHL field map
(`db/schema/meta/custom-field-map.json:2278`, `:1254`). The upload endpoint does not write
them (`api/documents-upload.mjs` — the whole file). The survey merge cannot write them
either; its key set is `cf_svy_*` only (`src/handlers/client-custom-fields.mjs:6-21`).
So the gate is permanently true: three hours after every funding round starts, every
funding client is tagged `docs:missing` and stamped "Collect Documents", forever.

**C. There is no funding-side "required documents" list. At all.**
Grepped `required_document`, `document_requirement`, `requiredDocs`, `REQUIRED_DOCS`,
`docs_required`, `required_docs` across `src/ api/ db/ public/ docs/` — **zero hits.**
The only document checklist in the repo is `src/inquiry-ops/doc-gate.mjs:21-54`, and that
is the **inquiry-removal identity packet**, not a funding file. So the question "are the
docs in?" has no answer on the funding path. That absence is the finding.

---

## 1. "Collect Documents"

### signalKind
**JSON key inside `clients.custom_fields` (jsonb).** Not a real column that anything reads.
Column: `clients.custom_fields jsonb NOT NULL DEFAULT '{}'` — `db/schema/001_init.sql:55`.
Writer helper: `mergeCustomFields` — `src/workflows/custom-fields.mjs:5-11`.

### Every write site

| file:line | fires on | reachable in production? |
|---|---|---|
| `src/workflows/f-01-funding-intake.mjs:65` | `round.started`, gated on funding product path (`:52-53`) | **YES** |
| `src/workflows/f-02-portal-id-missing.mjs:43` | `round.started` + 3h sleep (`:35`), gated on `id_uploaded`/`portal_onboarding_status` (`:28`) | **YES, but the gate never clears** — see Headline B |
| `src/workflows/f-06-funding-conditions-missing-docs.mjs:32` | `mail.response` classified `MISSING_DOCS` | **NO** — see Headline A |
| `src/workflows/f-06-funding-conditions-missing-docs.mjs:48` | same event, second write of the same value | **NO** — same reason |

### trueWhen
`clients.custom_fields->>'employee_next_action' = 'Collect Documents'`

Two corroborating signals that already exist and are independently readable:
* `'docs:missing' = ANY(clients.tags)` — set at `src/workflows/f-06-…:46` and
  `src/workflows/f-02-…:42`; also set by the inquiry path at `src/handlers/inquiry-docs.mjs:25`.
  Storage is `clients.tags text[]` (`db/schema/001_init.sql:65`), helpers at
  `src/workflows/tags.mjs:5-19`.
* `clients.custom_fields->>'round_hold_reason' = 'Missing Documents'` — set at
  `src/workflows/f-06-…:31`.

### falseWhen
**There is no clean false.** This is the important part.

`employee_next_action` is **never cleared by anything**. The only way it stops saying
"Collect Documents" is a different workflow overwriting it with a different string. Both
clear-down paths clear the *tag* and the *hold reason* and leave the next action stamped:

* `src/workflows/f-06-…:71-81` (`clearHoldIfMissingDocs`) — on `docs.received`, sets
  `round_hold_reason: null` and `funding_condition_required: false`. Does **not** touch
  `employee_next_action`.
* `src/workflows/f-06-…:61` — removes the `docs:missing` tag. Same omission.
* `src/workflows/f-02-…:53-54` — removes the tag and writes
  `last_progress_action: "docs_uploaded"`. Same omission.

So the honest falseWhen against fields that exist today is:

`'docs:missing' <> ALL(clients.tags)` **AND**
`clients.custom_fields->>'round_hold_reason' IS DISTINCT FROM 'Missing Documents'`

— i.e. the *tag* is the trustworthy clear signal, and the next-action string is stale.
A screen that reads only `employee_next_action` will show "Collect Documents" on clients
whose documents arrived.

### missingData
`custom_fields` has no `employee_next_action` key. That is the normal state for any client
who has never entered a funding round.

**Show "—".** The screen already has the right helper: `dash()` at
`public/app/client-control-panel.html:715-719` returns `"—"` for null/empty, and
`setText()` at `:720-723` routes every value through it. `setText("ccp-next-action", …)` at
`:889` already degrades correctly today. Do not show "None", do not show blank, do not
invent "Nothing to do" — a missing key means nobody has told us, not that the work is done.

### evidence
`src/workflows/f-01-funding-intake.mjs:65`,
`src/workflows/f-02-portal-id-missing.mjs:28`, `:43`, `:53-54`,
`src/workflows/f-06-funding-conditions-missing-docs.mjs:31-33`, `:39`, `:46`, `:48`, `:61`, `:71-81`,
`src/adapters/mailgun.mjs:652-658`,
`src/workflows/tags.mjs:5-19`,
`db/schema/001_init.sql:55`, `:65`,
`public/app/client-control-panel.html:472`, `:889`.

### confidence
**certain** that the value is written and persisted.
**certain** that F-06's branch is unreachable on a real bank email (payload keys read
directly from the emitter).
**certain** that F-02's gate has no writer (grepped the whole tree for both keys).

### What "docs are in" actually means today — the full answer

There are **two different document worlds** in this repo and they do not touch.

**World 1 — the funding path. NO CHECKLIST EXISTS.**
Nothing counts documents, names required ones, or computes completeness for funding.
`GET /api/dashboard/client` — the Client Control Panel's main read — does not return
documents at all (`api/dashboard/client.mjs:62-118`: clients, transactions, crs_results,
messages, tasks, funding_rounds, invoices, businesses. No documents query).
The Documents block on that screen is upload-only (`public/app/client-control-panel.html:585-600`,
wired at `:1433`). It posts and shows nothing back.

**World 2 — the inquiry-removal identity packet. A REAL CHECKLIST EXISTS.**
`src/inquiry-ops/doc-gate.mjs:21-54` (`checkDocPacket`). Required: government photo ID
(`id_document`), proof of address (`proof_of_address` **or** `bank_statement`), and an
authorization document. SSN card is required only when the dispute involves SSN-related
data (`:42`, decided by `disputeNeedsSsn` at `:57-63`). Returns
`{ complete, missing[], present{} }`. Loaded per client by `loadClientDocuments`
(`:65-76`) — `SELECT … FROM documents WHERE org_id AND client_id AND (expires_at IS NULL
OR expires_at > now())`. Consumed at `src/handlers/inquiry-docs.mjs:57-60`, which flips
blocked cases to Queued when the packet completes (`:62-69`).
This gate drives the value **"Collect inquiry identity packet"**
(`src/handlers/inquiry-docs.mjs:27`), not "Collect Documents".

**Where documents live.** `documents` + `document_versions`, `db/migrations/030_documents.sql:59`
and `:175`. Five kinds, CHECK-constrained (`db/migrations/118_client_uploads.sql:50-54`):
`authorization | contract | invoice_document | deliverable | client_upload`.
Client upload subtypes: `id_document, ssn_card, proof_of_address, bank_statement,
proof_of_income, tax_return, additional_fraud_docs, other` —
`src/documents/kinds.mjs:55-64`. Subtype is **free text in the database**, validated only
when a caller opts in (`src/documents/kinds.mjs:6-9`, `:117-126`).

**How a document arrives.** `POST /api/documents-upload` (`api/documents-upload.mjs:54`),
routed at `netlify/functions/api.mjs:709`. It validates the actual bytes against magic
numbers (`:103-110`), registers one document per file with a random discriminator so three
bank statements are three rows not one (`:112-124`, reasoning at `:16-21`), and emits
`docs.received` (`:126-138`).

**How a screen could read documents.** `GET /api/read/documents?client_id=&kind=` —
`api/read/documents.mjs:26-44`, routed at `netlify/functions/api.mjs:316`, gated
`ROLE_SETS.STAFF` (`api/read/documents.mjs:21`). Returns per row: `id, client_id,
document_key, kind, subtype, title, invoice_id, current_version, mime_type, byte_size,
generated_at, delivered_at, delivery_channel, delivery_status, signature_required,
signed_at, signer_name, expires_at, created_at, client_name`. `storage_key` is stripped.
**No screen in `public/app/` calls it per-client except `documents.html:415` (the whole
list) and `inquiry-remover.html:2080` (opens it in a new tab as raw JSON).**

---

## 2. "File Prep"

### signalKind
**NOT FOUND.**

### Where I looked
`grep -rn "File Prep|file_prep|filePrep"` across the whole repository excluding
`node_modules` and `.git`. Four hits, and none is this platform's code:

* `docs/workflows/fulfillment-layer-2026-08-19.md:24` and `:36` — Chris's own spec for this
  batch (the request, not an implementation).
* `docs/workflows/fulfillment-layer-2026-08-19-evidence/W1-ground-brief.md:27`, `:258` —
  W1 recording the same absence.
* `vendor/underwriteiq-full/scripts/rafael-qa-runner.js:898` — a **vendor** QA script
  asserting that somebody else's GHL automation "AX-07 (Blocker Task)" routes on
  `blocker_type` values `new_negative, file_prep, reconciliation, fraud_alert,
  stale_snapshot`. That is a statement about the old GoHighLevel system, verified against
  a written SOW. **There is no `blocker_type` column, no AX-07, and no such router in this
  repository.** Grep confirms: `blocker_type` appears nowhere in `src/ api/ db/ public/`.

### trueWhen
**Cannot be stated.** Nothing in this repository defines what "File Prep" means.

Three existing signals sit near the idea. Each is a real, queryable thing. **None of them
is "File Prep" and I am not proposing any of them as a substitute** — that is Chris's call:

| candidate | what it actually says | evidence |
|---|---|---|
| A contract is out but unsigned | `contracts.status IN ('sent','viewed')` and `signed_at IS NULL`. The schema calls this "the CRM's 'waiting on a signature' queue" and indexes it. | `db/migrations/124_contracts.sql:168-169`, `:181-184`, `:218-219` |
| A funding round carries conditions | `funding_rounds.conditions jsonb NOT NULL DEFAULT '[]'` | `db/schema/001_init.sql:129`; the only writer is `src/inquiry-ops/gate.mjs:99` |
| The identity packet is incomplete | `checkDocPacket(...).complete === false` | `src/inquiry-ops/doc-gate.mjs:44-53` — but this is inquiry removal, not funding |

### falseWhen
**Cannot be stated.** No definition, therefore no negation.

### missingData
Not applicable — the signal itself is absent, not the data behind it.

If Chris wants this chip, the honest display today is **"Not tracked"**, not "—" and not a
guess assembled from the three candidates above. A chip that silently means one of three
different things is worse than no chip.

### evidence
`docs/workflows/fulfillment-layer-2026-08-19.md:24`,
`vendor/underwriteiq-full/scripts/rafael-qa-runner.js:898`,
`db/migrations/124_contracts.sql:168-169`, `:218-219`,
`db/schema/001_init.sql:129`,
`src/inquiry-ops/doc-gate.mjs:44-53`.

### confidence
**certain** that the string does not exist in this platform's code.
**certain** that no `blocker_type` router exists here.

---

## 3. "Lock Fee"

### signalKind
**NOT FOUND as an `employee_next_action` value.**
`grep -rn "Lock Fee|lock_fee|lockFee"` across the repository excluding `node_modules` and
`.git` → only Chris's spec (`docs/workflows/fulfillment-layer-2026-08-19.md:24`, `:36`) and
W1's record of the absence (`W1-ground-brief.md:27`, `:257`).

**But the concept is real and has an exact column.** Two of them, in fact, and they are
different things.

### The fee-lock columns

**The agreed fee, frozen at the sale:**
`sales.agreed_success_fee_percent numeric(7,4)` — `db/migrations/011_sales.sql:32-34`,
constrained `IS NULL OR (>= 0 AND <= 100)`. The schema comment is explicit
(`db/migrations/011_sales.sql:29-31`):

> "The client-facing success fee agreed at sale (e.g. 10.0000 for the card stacking DFY
> back end). Frozen here so a later change to the product default cannot restate what this
> client owes. NULL = no success fee on this deal."

Written once by `src/handlers/money-chain.mjs:200-204`, from
`payload.agreedSuccessFeePercent` if present, else `products.default_success_fee_percent`,
else **null** (`:203-204`), and inserted at `:207-217`.

**The computed fee at closeout:**
`funding_closeout.fee_percent numeric(6,4) NOT NULL DEFAULT 0.10`,
`total_fee numeric(14,2) NOT NULL DEFAULT 0`,
`balance_due numeric(14,2) NOT NULL DEFAULT 0`,
`total_approved_amount numeric(14,2) NOT NULL DEFAULT 0` —
`db/migrations/139_funding_ops.sql:32-38`, one row per round (`UNIQUE (funding_round_id)`,
`:39`). Written by `src/funding/closeout.mjs:108-118` (insert) / `:91-101` (update).

**Read the warning at `src/funding/closeout.mjs:66-68`.** `total_approved_amount` is a
historical name; the value stored is the **fee basis**, which is `funded_amount` falling
back to `approved_amount` (`:57-63`). It is **not** an approval total. Do not surface it as
one.

### The one place the code says "fee lock"

`src/workflows/f-07-funding-locked.mjs:61` — task title
`"Fix fee lock/percent before invoicing"`, source workflow
`f-07-funding-locked-fee-not-ready` (`:33`). Created when the `round.funded` event arrives
without both an approved amount and a fee percent (`:53-54`, `:58-62`).

**F-07 never writes `employee_next_action`.** Its only custom-field writes are
`funding_locked_date` (`:65`) and `last_progress_action: "invoice_sent"` (`:91`). So even
the "fee is not ready" branch leaves the next-action field untouched. Confirmed by reading
the whole file.

### trueWhen
Built only from rows that exist today:

An open task exists for this client whose `source_workflow = 'f-07-funding-locked-fee-not-ready'`
and `done = false`.

```
tasks.client_id = <client>
AND tasks.source_workflow = 'f-07-funding-locked-fee-not-ready'
AND tasks.done = false
```

`tasks` schema: `db/schema/001_init.sql:223-235`; `source_workflow` (`:231`) and `done` (`:232`) are both
real columns there, and `idx_tasks_open` at `:236` already indexes `done = false`. That task row is created at `src/workflows/f-07-funding-locked.mjs:60-61`
via `createTaskOnce` (`:35-47`), deduped on `(client_id, source_workflow, body=eventId)`
(`:36`).

Underlying cause, readable directly if you prefer the cause to the symptom:
`sales.agreed_success_fee_percent IS NULL` for the client's active sale
(`db/migrations/011_sales.sql:32`), **or** the `round.funded` payload carried no
`approvedAmount` (`src/workflows/f-07-funding-locked.mjs:53-54`).

### falseWhen
Any one of these, all of which are real rows:

* A `funding_closeout` row exists for the round — `db/migrations/139_funding_ops.sql:28-40`,
  written only on the funded path (`src/funding/closeout.mjs:108-118`).
* An invoice exists with `source = 'funding_success_fee'` — created at
  `src/workflows/f-07-funding-locked.mjs:75-88`, idempotent on
  `successFeeKey(saleId, fundingRoundId)` (`src/invoices/index.mjs:125`).
* The `f-07-funding-locked-fee-not-ready` task is marked `done = true`.

### missingData
Two distinct absences, and they must display differently:

1. **`sales.agreed_success_fee_percent IS NULL`** → show **"Fee % not set"**.
   **Never "0%". Never "$0 fee due".** The schema says NULL means "no success fee on this
   deal" (`db/migrations/011_sales.sql:30-31`) — but see §4 item 1: two live code paths
   already turn that NULL into a hard zero, so a zero on screen is genuinely ambiguous
   between "free deal", "not filled in", and "the view coalesced it".

2. **No `funding_closeout` row at all** → show **"—"**.
   Do **not** read `funding_closeout.total_fee = 0` as "no fee". That column is
   `NOT NULL DEFAULT 0` (`db/migrations/139_funding_ops.sql:34`), so zero is the only shape
   "unknown" can take. `src/funding/closeout.mjs:13-16` also returns `0` from `money()` for
   any non-finite input. Treat `total_fee = 0 AND total_approved_amount = 0` as
   **"not computed"**, not as "$0.00 owed".

### evidence
`db/migrations/011_sales.sql:29-34`,
`db/migrations/139_funding_ops.sql:28-40`,
`src/funding/closeout.mjs:13-16`, `:57-68`, `:91-118`,
`src/workflows/f-07-funding-locked.mjs:33`, `:53-54`, `:58-62`, `:65`, `:74-91`,
`src/handlers/money-chain.mjs:200-217`,
`src/invoices/index.mjs:38-70`, `:125`,
`db/schema/001_init.sql:223-235`.

### confidence
**certain** the string is absent.
**certain** the columns and the task row exist as described (read directly).
**unverified** whether any `f-07-funding-locked-fee-not-ready` task rows actually exist on
the live database — that is W5's job. I ran no queries against client data.

---

## 4. THE NULL LIST — every money and entitlement signal I rely on that can be NULL

CLAUDE.md §12: *"Money is integer cents via `src/commissions/money.mjs`. `fromCents`
returns a string; `percentOf` takes percent units (`10` = 10%). NULL means unknown and must
survive — never default it to 0."*

`src/commissions/money.mjs:42-48` (`fromCents` → string), `:54-59` (`percentOf`, percent
units), `:30-39` (`toCents`, and note it maps `null` → `0` deliberately, documented at
`:28-29` as "no payments yet is a legitimate zero base" — that is a base for a commission
sum, not a display value).

**The screen's existing honest-degrade is the em dash.** `dash()` at
`public/app/client-control-panel.html:715-719` and `money()` at `:724-729` both return
`"—"`. Use them. (One caveat: `money()` at `:727` also returns `"—"` for `v <= 0`, so a
genuine, real $0 currently displays as "—" too. Not a blocker, but it means "—" on that
screen already carries two meanings.)

Here is every nullable signal in my half, and what the screen must show.

| # | Signal | Where it can be NULL | What the screen shows for NULL | Why "0" is wrong |
|---|---|---|---|---|
| 1 | `sales.agreed_success_fee_percent` | `db/migrations/011_sales.sql:32` | **"Fee % not set"** | Two live paths already collapse it. `db/migrations/014_commission_ledger.sql:217` and `:223` wrap it in `COALESCE(sa.agreed_success_fee_percent, 0)` inside `v_sale_balance`, so `success_fee_due` reads **$0.00** and is indistinguishable from a genuinely fee-free deal. `src/commissions/calculate.mjs:69` does the same in JavaScript: `feePct === null \|\| undefined ? 0 : percentOf(...)`. |
| 2 | `funding_rounds.approved_amount` | `db/schema/001_init.sql:127` | **"—"** | A round that has not been decided is not a round approved for zero dollars. |
| 3 | `funding_rounds.funded_amount` | `db/schema/001_init.sql:128` | **"—"** | `db/migrations/014_commission_ledger.sql:192` sums `COALESCE(fr.funded_amount, 0)`, so an unfilled round contributes 0 to `funded_total` and the whole `success_fee_due` reads $0. |
| 4 | `funding_rounds.submitted_amount` | `db/schema/001_init.sql:126` | **"—"** | Same class. Nothing submitted yet ≠ submitted for $0. |
| 5 | `clients.funded_amount` | `db/schema/001_init.sql:58` | **"—"** | **Live defect right now.** `public/app/client-control-panel.html:858-859` reads `money(c.funded_amount)` and, when it comes back `"—"`, substitutes the **prequal estimate** under a tile labelled **"Total Approved"** (`:449`). A guess is being shown as an approval. The prequal already has its own tile at `:448`. |
| 6 | `custom_fields.total_funding_estimate` / `analyzer_prequal_amount` | jsonb keys, absent until written | **"—"** or "Not analysed yet" | Written only when `decision.rendered` carries a `fundingEstimate` — `src/handlers/client-lifecycle.mjs:434`, `:448-451`. Absent means the analyzer has not run. `api/dashboard/clients.mjs:90` already handles this correctly with `?? null` — copy that, not lines 87-89. |
| 7 | `transactions.amount_paid` | `db/schema/001_init.sql:157` | **"—"** | A recorded transaction with no amount is a data gap, not a free purchase. `api/dashboard/clients.mjs:95` already does `?? null` correctly. |
| 8 | `v_invoice_balance.amount_paid` | `COALESCE(pay.amount_paid, 0)` — `db/migrations/031_invoices.sql:475` | **use `settlement_state`, not the number** | Here 0 is *arithmetically* right (no payment rows genuinely means nothing paid). But `settlement_state` at `db/migrations/031_invoices.sql:491-497` names the state in words — `void \| written_off \| settled \| partially_paid \| unpaid`. Show the word. A bare "$0.00" cannot tell "unpaid" from "voided". |
| 9 | `invoices.due_at` | `db/migrations/017_invoices.sql:42` — "nullable; policy TBD" | **"No due date"** | `v_invoice_aging` returns the literal bucket `'no_due_date'` (`db/migrations/031_invoices.sql:542`) and `days_overdue` NULL (`:537-539`). Rendering that as "0 days overdue" would make a client with no due date look current, and rendering it as overdue would chase money that is not yet owed. |
| 10 | `funding_closeout.total_fee` / `balance_due` / `total_approved_amount` | **NOT NULL DEFAULT 0** — `db/migrations/139_funding_ops.sql:33-35` | **"—" when total_fee = 0 AND total_approved_amount = 0** | These columns **cannot** hold NULL, so zero is the only face "unknown" has. `src/funding/closeout.mjs:13-16` returns 0 from `money()` for any non-finite input, and `:59-63` falls back approved→funded. Printing "$0.00 fee" as fact is a false statement about money owed. |
| 11 | `custom_fields.crs_paid` / `deposit_paid` / `sale_closed` | key absent | **"—" / "unknown"** | **These are only ever written `true`.** `src/handlers/client-lifecycle.mjs:324`, `:338`, `:342`. Nothing writes `false` anywhere — grepped the whole tree. Two live consequences: (a) `src/http/client-detail.mjs:202` tests `cf.crs_paid === false`, so the "CRS not paid" blocker **can never fire in production**; same shape at `:206` for the deposit blocker. (b) **`api/dashboard/clients.mjs:87-89` maps `r.crs_paid ?? false`** — so the list endpoint reports "not paid" for every client whose key is simply missing. That is the exact endpoint W1 recommends extending. Fix the pattern before adding to it, or copy line `:90`'s `?? null`. |
| 12 | `entitlements.source_transaction_id` | `db/migrations/032_entitlements.sql:97`, nullable by design | **"Granted manually"** | NULL there means a manual or comped grant, explained by `granted_by` (`db/migrations/032_entitlements.sql:95-96`, `granted_by` at `:99`). It is a third state, not a missing payment. |
| 13 | `documents.signed_at` / `signer_name` / `byte_size` / `checksum` / `expires_at` | `db/migrations/030_documents.sql:127-129`, `:103-105`, `:134` | **"Waiting for signature" only when `signature_required = true`** | `signature_required boolean NOT NULL DEFAULT false` (`db/migrations/030_documents.sql:126`). A document that needs no signature is not an unsigned document. `expires_at` is document **validity**, never a deletion clock — stated at `db/migrations/030_documents.sql:41-43`. Most documents leave it NULL and that is the intended state. |

### One more, not nullable but just as wrong

`api/dashboard/clients.mjs:99` returns `task_count: Number(r.task_count)` from
`COUNT(DISTINCT tk.id)` with the join at `:43`:
`LEFT JOIN tasks tk ON tk.client_id = c.id AND tk.org_id = c.org_id`.
**There is no `done = false` filter.** So `task_count` counts finished work as outstanding
work. Anything that reads it as "open items" is wrong, and it grows forever.

---

## 5. Paid vs entitled — are they distinguishable?

**Yes. Cleanly. They are different tables and the link between them is explicit.**

**PAID — three independent records, all real:**

| record | table | evidence |
|---|---|---|
| money in the door | `transactions` (`amount_paid`, `status`) | `db/schema/001_init.sql:152-164`; written `'succeeded'` at `src/handlers/client-lifecycle.mjs:310`, `'failed'` at `:315` |
| money against an invoice | `invoice_payments`, surfaced as `v_invoice_balance.settlement_state` | `db/migrations/031_invoices.sql:445-452`, `:491-497` |
| money against a sale | `sale_payments` (`kind IN ('deposit','installment','success_fee','refund')`) | `db/migrations/011_sales.sql:86-90` |

**ENTITLED — one record:**
`entitlements` (`db/migrations/032_entitlements.sql:89-116`), resolved by
`v_client_entitlements.active` = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
(`db/migrations/032_entitlements.sql:168-183`). Read helper `has()` at
`src/entitlements/entitlements.mjs:50-59`; portal read `forClient()` at `:24-46`.

**The link:** `entitlements.source_transaction_id → transactions.id`
(`db/migrations/032_entitlements.sql:97`).

### The gap that makes the distinction matter

**A client can pay and receive nothing.** `grantFromTransaction` returns
`{ granted: [], unmapped: true, reason: "no_mapping" }` when `product_entitlements` has no
row for the purchased product — `src/entitlements/entitlements.mjs:154-166`. The header
comment at `:141-145` says why this is not an error and why it used to be invisible:

> "money landed, the portal stayed locked, and nobody could see why."

`forClient()` then reports that code in `locked` via `COALESCE(e.active, false)`
(`src/entitlements/entitlements.mjs:30`, `:43`) — so **"locked" conflates "never bought"
with "bought, but the product was never mapped"**.

**What the screen should show for that state:** *"Paid — access not granted (product not
mapped)"*. Not "locked". Not "$0". The existing report for the underlying gap is
`unmappedProducts()` at `src/entitlements/entitlements.mjs:212-224`.

**Three distinguishable states, and a fourth trap:**

1. Paid **and** entitled — transaction row + active entitlement linked by
   `source_transaction_id`.
2. Paid **and not** entitled — transaction row, no entitlement. The `unmapped` gap above.
3. Entitled **and not** paid — entitlement with `source_transaction_id IS NULL`, i.e. a
   manual or comped grant (`db/migrations/032_entitlements.sql:95-96`, `granted_by` at `:99`).
4. **The trap:** paid, then **refunded**. `transactions.status = 'succeeded'` **stays
   'succeeded'** — nothing rewrites it. The refund shows up as
   `sales.status = 'refunded'` (`db/migrations/011_sales.sql:47-48`), a
   `sale_payments.kind = 'refund'` row (`db/migrations/011_sales.sql:86-87`), a
   `v_invoice_balance.refunded` total (`db/migrations/031_invoices.sql:478`), and
   `entitlements.revoked_at` (`src/entitlements/entitlements.mjs:117-133`).
   **Any "paid" chip that reads `transactions.status = 'succeeded'` alone will show a
   refunded client as paid.** Use `v_invoice_balance.settlement_state` or
   `v_client_entitlements.active`, both of which already account for it.

---

## 6. Contract signed — the exact column

Asked for specifically, so stated plainly.

**`contracts.signed_at timestamptz`** — `db/migrations/124_contracts.sql:181`.
Paired with **`contracts.status = 'signed'`** (`:168-169`) and
**`contracts.signer_name text`** (`:182`).

The schema enforces that they cannot disagree — three CHECK constraints:

* `contracts_signature_pair_ck` (`:201-204`) — a signature is a name **and** a time, never
  one without the other.
* `contracts_signed_status_ck` (`:205-206`) — `signed_at IS NULL OR status = 'signed'`.
* `contracts_sent_has_body_ck` (`:197-200`) — anything past draft has a frozen body.

So **`contracts.signed_at IS NOT NULL` is sufficient and safe.** You do not need to check
`status` as well; the constraint guarantees it.

Written by `src/contracts/sign.mjs:488-497` — the UPDATE on `contracts` itself. The
per-signer row is stamped separately at `src/contracts/sign.mjs:379-386`
(`contract_signers`). Both are conditional on `signed_at IS NULL` so two tabs racing
produce one signature, not two (`src/contracts/sign.mjs:377-378`, `:419-421`).

**The mirror.** `documents.signed_at` / `signer_name` / `signature_ref` also exist
(`db/migrations/030_documents.sql:127-129`), plus `document_versions.signed_at` (`:207-209`).
`documents` is the immutable artifact; `contracts` is the record of the agreement. There is
an index built for exactly the "unsigned" question:
`idx_documents_unsigned ON documents (org_id, client_id) WHERE signature_required AND signed_at IS NULL`
— `db/migrations/030_documents.sql:164-165`.

**How to read it.** `GET /api/read/contracts?view=contracts&client_id=<uuid>` —
`api/read/contracts.mjs`, routed at `netlify/functions/api.mjs:772`, gated
`ROLE_SETS.STAFF` (`api/read/contracts.mjs:56`). `signed_at` and `signer_name` are in the
selected column list at `src/contracts/send.mjs:56` and `:82`.

**Two live gaps worth naming:**

1. **No workflow ever sends a contract.** Grepped `src/workflows/` and `src/handlers/` for
   contract imports — the only hit is `src/workflows/contract-chaser.mjs:44-46`, which
   *chases* contracts that are already out. Contracts are created by hand from
   `public/app/contracts.html` via `POST /api/contracts`
   (`netlify/functions/api.mjs:771`). A `funding_agreement` template is seeded
   (`db/seed/007_contract_templates.sql:102`) and nothing sends it.
2. **A signed contract is not connected to `employee_next_action` in any direction.**
   Nothing reads `contracts.signed_at` to set a next action, and nothing reads a next
   action to decide a contract is needed.

---

## 7. COMPLIANCE REVIEW REQUIRED — why

Per CLAUDE.md §7 this flag goes on anything touching **fee timing** or **refund
behavior**. Both apply here. Two reasons, stated once:

**Fee timing.** The "Lock Fee" chip is, by definition, a display of *when a fee becomes
owed*. The moment is `round.funded` — `src/workflows/f-07-funding-locked.mjs:98`. On that
event the code computes `feeAmount = approvedAmount × feePercent / 100`
(`src/workflows/f-07-funding-locked.mjs:74`) and immediately raises a success-fee invoice
(`:75-88`). The file carries its own unresolved flag about that formula at `:10-19` and
`:70-72`: it is not settled whether the source figure is the funded base or the fee itself.
Showing the chip changes nothing about the money — but the `trueWhen`/`falseWhen` we pick
decides which clients staff chase, and when.

**Refund behavior.** Any "paid" signal built on `transactions.status = 'succeeded'` alone
reports a refunded client as paid, because that column is never rewritten on a refund
(§5 item 4). The refund lives in `sales.status = 'refunded'`
(`db/migrations/011_sales.sql:47-48`), `sale_payments.kind = 'refund'`
(`db/migrations/011_sales.sql:86-87`), `v_invoice_balance.refunded`
(`db/migrations/031_invoices.sql:478`) and `entitlements.revoked_at`
(`src/entitlements/entitlements.mjs:117-133`). Choosing the wrong source shows money as
collected that was returned.

Per the owner-decisions section of CLAUDE.md, the label is a marker Chris asked for. No
recommendation is attached to it.

---

## 8. NOT FOUND — the full list, with where I looked

| Thing | Where I looked | Result |
|---|---|---|
| `"File Prep"` as a value | whole repo, excluding `node_modules`/`.git` | **NOT FOUND** — only Chris's spec and one vendor QA script (`vendor/underwriteiq-full/scripts/rafael-qa-runner.js:898`) |
| `"Lock Fee"` as a value | whole repo, excluding `node_modules`/`.git` | **NOT FOUND** — only Chris's spec |
| A `blocker_type` router (the vendor's AX-07) | `src/ api/ db/ public/` | **NOT FOUND** |
| Any funding-side required-documents checklist | `required_document`, `document_requirement`, `requiredDocs`, `REQUIRED_DOCS`, `docs_required`, `required_docs` across `src/ api/ db/ public/ docs/` | **NOT FOUND** — zero hits |
| A writer for `custom_fields.id_uploaded` | `src/ api/ public/ db/ netlify/` | **NOT FOUND** — read only, at `src/workflows/f-02-portal-id-missing.mjs:28` |
| A writer for `custom_fields.portal_onboarding_status` | same | **NOT FOUND** — read only, same line |
| `conditionDescription` on a real `mail.response` | `src/adapters/mailgun.mjs:652-658` (the emitter), `src/handlers/comms.mjs:273-275` | **NOT FOUND** — the payload has six keys and this is not one of them |
| A writer of `crs_paid: false`, `deposit_paid: false`, `sale_closed: false` | `src/ api/ db/ public/` | **NOT FOUND** — every write is `true` (`src/handlers/client-lifecycle.mjs:324`, `:338`, `:342`) |
| A workflow that sends a `funding_agreement` contract | `src/workflows/`, `src/handlers/` | **NOT FOUND** — only the chaser (`src/workflows/contract-chaser.mjs:44-46`) and the manual endpoint |
| Documents on the Client Control Panel's main read | `api/dashboard/client.mjs:62-118` | **NOT FOUND** — eight queries, none touches `documents` |
| Live row counts (which values appear on real clients) | not attempted | **W5's task.** I ran no queries against client data. |

---

## 9. What W3 did not do

* Wrote no product code. No migrations, no tables, no columns, no screens.
* Wrote no client data.
* Did not touch the shared board (`docs/workflows/fulfillment-layer-2026-08-19.md`) — the
  lead writes that.
* Did not run `git stash`.
* Ran no query against the production database.
