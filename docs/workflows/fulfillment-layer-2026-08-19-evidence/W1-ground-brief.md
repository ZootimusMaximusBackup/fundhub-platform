# W1 — Ground brief (fulfillment layer, Phase 0)

**Date:** 2026-08-19 · **Agent:** W1 · **Scope:** findings only, no product code written.
**Rule followed:** every claim below carries `file:line`. Where nothing exists, it says
**NOT FOUND** and names where I looked.

---

## HEADLINE — read this first

**`employee_next_action` already exists and is already the driver field Chris means.**
It is **not** a database column that anything reads. It is a **JSON key inside
`clients.custom_fields` (jsonb)**, written by 15 call sites, and read by exactly **one**
screen: the Client Control Panel.

Three facts that change the plan:

1. **There IS a typed column** `client_custom_fields.employee_next_action`
   (`db/schema/005_client_custom_fields.sql:32`) — and **nothing ever writes it.**
   The only writer to that table is `src/handlers/client-custom-fields.mjs:69`, and it
   writes `cf_svy_*` survey columns only. So the typed column is **always NULL**.
2. `src/agents/context.mjs:109` reads `employee_next_action` **from that dead typed
   column**, not from the live jsonb. So the AI agent context line at
   `src/agents/context.mjs:268` is **always blank** today. That is a real, live defect.
3. **Chris's value list and the code's value list do not match.** Code writes
   `"Prepare Next Funding Round"`; Chris's spec says `"Prepare Next Round"`. And four of
   his Airtable chips — `Lock Fee`, `File Prep`, `Review Disputes`, `Ready to Fund` — do
   not exist anywhere in this repo. Code also writes two values his list does not
   mention: `"Closed/Stop"` and `"Collect inquiry identity packet"`.

**Cheapest extension point for the whole batch:** `api/dashboard/clients.mjs`. Its SQL
already lifts four jsonb keys out of `clients.custom_fields` at lines 21–24. Adding
`employee_next_action` there is one SELECT line plus one mapper line. No new route, no
migration, no new screen. That endpoint is already routed
(`netlify/functions/api.mjs:304`) and already feeds a client list.

---

## 1. THE READ LAYER

### Route registration — the trap in CLAUDE.md §12

`netlify/functions/api.mjs:224` declares `export const ROUTES = { … }`.
`src/http/routes.test.mjs:71` sets `const ALLOWED_UNROUTED = {};` — **empty**. The test at
`src/http/routes.test.mjs:94` fails if any `api/**` handler is neither in `ROUTES` nor on
that empty allow-list. So **today every handler file under `api/` IS routed.** Every
handler named below was verified present in the map by line number.

### 1a. `public/app/client-control-panel.html` (CCP) — 1550 lines

| What it calls | Handler file | ROUTES line | Notes |
|---|---|---|---|
| `GET /api/dashboard/client?id=` | `api/dashboard/client.mjs` | `netlify/functions/api.mjs:305` | **the main read** — called at `client-control-panel.html:1349` via `FHData.client(id)` (`public/app/data.js:170`) |
| `GET /api/dashboard/clients?limit=200` | `api/dashboard/clients.mjs` | `netlify/functions/api.mjs:304` | client picker only — `client-control-panel.html:921` |
| `GET /api/read/inquiry-cases` | `api/read/inquiry-cases.mjs` | `netlify/functions/api.mjs:321` | "Need action" list — `client-control-panel.html:952` |
| `GET /api/read/agent-context?client_id=` | `api/read/agent-context.mjs` | `netlify/functions/api.mjs:334` | `client-control-panel.html:1368` |
| `GET /api/consent/capture?client_id=` | `api/consent/capture.mjs` | `netlify/functions/api.mjs:722` | `client-control-panel.html:1196` |
| `POST /api/finance/crs-pull` | `api/finance/crs-pull.mjs` | `netlify/functions/api.mjs:604` | `client-control-panel.html:1280` |
| `POST /api/inquiry-cases` | `api/inquiry-cases.mjs` | `netlify/functions/api.mjs:286` | `client-control-panel.html:1333` |
| `POST /api/documents-upload` | `api/documents-upload.mjs` | `netlify/functions/api.mjs:709` | `client-control-panel.html:1433` |
| `GET /api/read/lender-matches?client_id=` | `api/read/lender-matches.mjs` | `netlify/functions/api.mjs:319` | `client-control-panel.html:1490` |

**Fields `GET /api/dashboard/client` returns per client** — `api/dashboard/client.mjs:66-71`:

```
id, org_id, first_name, last_name, email, phone,
outcome_tier, funded, funded_amount, days_to_fund,
channel_source, tags, pipeline_ids,
dnd_sms, dnd_email, dnd_voice, consent_sms,
custom_fields,          <-- THE WHOLE JSONB BLOB, unfiltered
created_at, updated_at
```

Plus these arrays/objects (`api/dashboard/client.mjs:145-157`):
`transactions[]`, `crs_results[]`, `messages[]` (limit 100), `tasks[]`,
`funding_rounds[]`, `invoices[]` (from view `v_invoice_balance`),
`inquiry_removal_case` (via `getActiveCaseForClient`, `src/inquiry-ops/cases.mjs`).

Plus derived extras from `clientDetailExtras` (`src/http/client-detail.mjs:306-315`):
`tier_reasoning`, `tri_merge`, `utilisation`, `income_estimates`, `business_credit`,
`latest_booking`, `open_blockers`.

**KEY POINT: because `custom_fields` is returned whole, the CCP already has
`employee_next_action` for free.** It is painted at
`public/app/client-control-panel.html:889`:
`setText("ccp-next-action", cf.employee_next_action);` into the element at
`public/app/client-control-panel.html:472`.
`src/http/crm-html.test.mjs:56` already asserts the string `employee_next_action` is
present in that HTML — so removing it breaks a test.

### 1b. `public/app/pipeline.html` — 1798 lines

| What it calls | Handler file | ROUTES line | Notes |
|---|---|---|---|
| `GET /api/dashboard/pipeline?key=` | `api/dashboard/pipeline.mjs` | `netlify/functions/api.mjs:306` | the board — `pipeline.html:1730` via `FHData.pipeline` (`public/app/data.js:181`) |
| `GET /api/dashboard/pipeline-counts` | `api/dashboard/pipeline-counts.mjs` | `netlify/functions/api.mjs:307` | rail-tab counts — `pipeline.html:1750` |
| `GET /api/dashboard/client?id=` | `api/dashboard/client.mjs` | `netlify/functions/api.mjs:305` | drawer only, one client at a time — `pipeline.html:1453` |
| `POST /api/pipeline-cards` | `api/pipeline-cards.mjs` | `netlify/functions/api.mjs:272` | card moves — `pipeline.html:623` |
| `POST /api/dashboard/client-archive` | `api/dashboard/client-archive.mjs` | `netlify/functions/api.mjs:310` | `pipeline.html:1505` |
| `GET /api/read/lender-matches` | `api/read/lender-matches.mjs` | `netlify/functions/api.mjs:319` | `pipeline.html:1150` |

**Fields `GET /api/dashboard/pipeline` returns per card** —
`api/dashboard/pipeline.mjs:97-114`:
`id, client_id, name, email, phone, owner, entered_at, outcome_tier, funded, amount,
is_demo, survey_fico`.
Per stage (`api/dashboard/pipeline.mjs:117-129`): `key, name, sort_order, count, amount,
cards[]`.
The SQL that feeds it is `CARDS_SQL` at `api/dashboard/pipeline.mjs:32-58`. It already
lifts three jsonb keys: `total_funding_estimate` (line 47),
`cf_svy_self_reported_fico` (48), `cf_svy_self_reported_fico_label` (49).
It does **not** carry `employee_next_action`.

`GET /api/dashboard/pipeline-counts` returns only `{ ok, counts: { <pipeline_key>: n } }`
(`api/dashboard/pipeline-counts.mjs:66-70`). SQL at `api/dashboard/pipeline-counts.mjs:29-47`.

### 1c. `public/app/closer-dashboard.html` — 1264 lines

This page is **the card-stacking / tradelines screen**, not a client roster. It reads one
client at a time.

| What it calls | Handler file | ROUTES line | Notes |
|---|---|---|---|
| `GET /api/read/tradelines?client_id=` | `api/read/tradelines.mjs` | `netlify/functions/api.mjs:363` | main read — `closer-dashboard.html:1167` |
| `GET /api/read/deal-math` | `api/read/deal-math.mjs` | `netlify/functions/api.mjs:461` | `closer-dashboard.html:1201` |
| `GET /api/read/closer-call?client_id=` | `api/read/closer-call.mjs` | `netlify/functions/api.mjs:459` | `closer-dashboard.html:1249` |
| `GET /api/read/lender-matches` | `api/read/lender-matches.mjs` | `netlify/functions/api.mjs:319` | `closer-dashboard.html:1107` |
| `GET /api/auth/session` | `api/auth/session.mjs` | `netlify/functions/api.mjs:227` | `closer-dashboard.html:906` |

`GET /api/read/tradelines` returns `{ ok, data: [tradeline rows + credit_limit, balance,
available], funding }` — `api/read/tradelines.mjs:191-202`.
`GET /api/read/closer-call` returns `{ ok, ...buildCockpit(...) }` —
`api/read/closer-call.mjs:41`, built by `src/sales/cockpit.mjs:18`.

**The page carries a verbatim copy of `src/http/closer-dashboard-view.mjs`** inside
`/* FH-VIEW-BEGIN */ … /* FH-VIEW-END */`, published as `window.FHCloserView`
(`public/app/closer-dashboard.html:590`; reasoning at
`src/http/closer-dashboard-view.mjs:1-32`). `src/http/closer-dashboard-view.test.mjs`
runs the SAME fixtures through both and fails on drift. **If you change that block in the
HTML you must change `src/http/closer-dashboard-view.mjs` identically, in ES5.**

### Which one to extend

**`api/dashboard/clients.mjs`.** It is the only one of the three that already returns a
LIST of clients with per-client custom_fields keys pulled out
(`api/dashboard/clients.mjs:21-24`), and it is already the CCP's own client picker.
Second choice is `api/dashboard/pipeline.mjs` `CARDS_SQL` (line 32) for a per-card chip.
`closer-dashboard.html` is single-client and view-mirrored — the most expensive of the
three to touch.

---

## 2. THE SIX ROLLUPS

Searched: `src/http/pipeline-counts.test.mjs`, `src/sales/cockpit.mjs`,
`src/sales/metrics.mjs`, `src/http/closer-dashboard-view.mjs`, `src/dashboard/kpis.mjs`,
`api/dashboard/*`, `api/read/*`, all of `src/` and `db/`.

| Rollup | Verdict | Evidence |
|---|---|---|
| **Total clients** | **NOT FOUND** as a rollup | `api/dashboard/clients.mjs:104` returns `count: clients.length` — that is the length of a **capped** list (default 50, cap 500; `api/dashboard/clients.mjs:73`), not a total. `src/dashboard/kpis.mjs:81-86` counts clients but only `created_at >= now() - N days` → surfaced as `new_clients` (`src/dashboard/kpis.mjs:140`). A true `SELECT count(*) FROM clients WHERE org_id=$1` exists only in demo tooling: `src/demo/money-snapshot.mjs:10`. |
| **Needs Pull** | **NOT FOUND** | No count anywhere. The nearest live signals: `employee_next_action = "Pull CRS"` written at `src/workflows/c-05-pre-funding-review.mjs:44` and `src/workflows/s-06-post-call-funding-purchased.mjs:42`; `custom_fields.crs_status` written `"Requested"` at `src/workflows/c-00-crs-soft-pull-request.mjs:66` and `"Complete"` at `src/workflows/u-03-crs-snapshot-sync.mjs:19`; the gate read at `src/workflows/c-05-pre-funding-review.mjs:34`. Nothing aggregates any of these. |
| **Action Needed** | **NOT FOUND** as a number. A per-client LIST exists. | `openBlockers()` at `src/http/client-detail.mjs:169-215` builds a per-client blocker array from open tasks, held funding rounds, unpaid invoices, and two custom_fields gates (`crs_paid`, `deposit_paid`). It is returned by `GET /api/dashboard/client` and painted at `public/app/client-control-panel.html:894`. It is **one client at a time**; there is no cross-client count. The CCP's "Need action" group (`public/app/client-control-panel.html:488-492`, wired at `:946-978`) is a LIST of open inquiry-removal cases from `GET /api/read/inquiry-cases`, capped at 12 (`:964`) — also no count. |
| **Ready** | **NOT FOUND** | `custom_fields.ready_for_next_round` is written `true` at `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45`. A typed column `ready_for_next_round text[]` exists at `db/schema/005_client_custom_fields.sql:77` and has no writer. **Nothing reads either.** No count. |
| **Total Prequal** | **NOT FOUND** as a rollup | Per-client only. `custom_fields.analyzer_prequal_amount` / `custom_fields.total_funding_estimate` — written at `src/handlers/client-lifecycle.mjs:449-450`, painted per-client at `public/app/client-control-panel.html:857`. The one place amounts are summed is per-STAGE on the board: `api/dashboard/pipeline.mjs:126` sums `funded_amount ?? total_funding_estimate` per column. That is a stage total, not a prequal total. |
| **Total Approved** | **NOT FOUND** as a rollup | Per-client only. `funding_rounds.approved_amount` (`db/schema/001_init.sql:127`) is returned by `GET /api/dashboard/client`. The CCP tile labelled "Total Approved" (`public/app/client-control-panel.html:449`) does **not** read that column — it reads `client.funded_amount`, falling back to prequal (`public/app/client-control-panel.html:858-859`). Money rollups that DO exist are different things: `funded_amount_cents` in `src/dashboard/kpis.mjs:44-52` (period-scoped, `clients.funded`), and `funding_closeout.total_approved_amount` which is a **fee basis**, not an approval total — see the explicit warning at `src/funding/closeout.mjs:66-68`. |

**Bottom line: zero of the six rollups exist today.** All six would be new aggregate
reads. Five of the six have an identifiable per-client source; "Action Needed" has a
per-client list but no agreed definition.

---

## 3. THE EXISTING `next_action` — full answer

### What it is

**A JSON key named `employee_next_action` inside the `clients.custom_fields` jsonb
column.** Not a table column that is used. Not a task field. Not a local variable.

- The column: `clients.custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb` —
  `db/schema/001_init.sql:55`.
- The writer helper: `mergeCustomFields(db, clientId, patch)` —
  `src/workflows/custom-fields.mjs:5-11`. SQL is
  `UPDATE clients SET custom_fields = custom_fields || $2::jsonb WHERE id = $1`
  (`src/workflows/custom-fields.mjs:7-8`). A duplicate private copy lives at
  `src/handlers/client-lifecycle.mjs:230-236` (same SQL).
- **It is persisted.** Every write is a real `UPDATE` against Postgres.

### The dead twin — this is the finding

A typed column with the same name exists and is never written:

- `db/schema/005_client_custom_fields.sql:32` —
  `employee_next_action text, -- SINGLE_OPTIONS · Employee Next Action · contact.employee_next_action`
- Field map entry: `db/schema/meta/custom-field-map.json:174-180`
  (`ghlId: 4VLPuwlzIYKZh1cX4hGI`, `ghlType: SINGLE_OPTIONS`). **The map records no option
  list** — the allowed values were never captured.
- The ONLY writer to `client_custom_fields` in the whole repo is
  `src/handlers/client-custom-fields.mjs:69` (`INSERT INTO client_custom_fields`), and its
  column set is frozen to `cf_svy_*` at `src/handlers/client-custom-fields.mjs:6-21`.
  Verified by grep for `INSERT INTO client_custom_fields` / `UPDATE client_custom_fields`
  across the whole tree — one hit.
- Therefore `client_custom_fields.employee_next_action` is **always NULL**.
- And `src/agents/context.mjs:109` selects it from that dead table; `:174` maps it to
  `snapshot.employee_next_action`; `:268` renders
  `` `Employee next action: ${s.employee_next_action}` ``. **That line never appears.**
- Same dead-join problem hits `src/sales/cockpit.mjs:30` (reads `cf.utm_source`,
  `cf.utm_campaign`, `cf.utm_medium`, `cf.cf_setter_user_id`) and
  `src/sales/metrics.mjs:336-337` and `:384-385` (lead_source / setter_key). All those
  columns are unwritten too, so those COALESCE chains always fall through to
  `c.channel_source` / `'unknown'`.
- Corroborating prior audit: `docs/workflows/e2e-verify-run4.md:605` recorded
  `client_custom_fields` rows = 0, "no writer".

### Every write site and the exact value

| Value written | file:line |
|---|---|
| `"Pull CRS"` | `src/workflows/c-05-pre-funding-review.mjs:44` (with `round_hold_reason: "Awaiting CRS"`) |
| `"Pull CRS"` | `src/workflows/s-06-post-call-funding-purchased.mjs:42` (with `lifecycle_status: "Funding Client"`, `product_path: "Funding"`) |
| `"Collect Documents"` | `src/workflows/f-01-funding-intake.mjs:65` |
| `"Collect Documents"` | `src/workflows/f-02-portal-id-missing.mjs:43` |
| `"Collect Documents"` | `src/workflows/f-06-funding-conditions-missing-docs.mjs:32` |
| `"Collect Documents"` | `src/workflows/f-06-funding-conditions-missing-docs.mjs:48` |
| `"Remove Inquiries"` | `src/workflows/c-02-inquiry-created.mjs:54` (with `round_hold_reason: "New Inquiries"`) |
| `"Remove Inquiries"` | `src/workflows/f-03-round-submitted.mjs:35` |
| `"Clear Fraud Alert"` | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:37` (with `round_hold_reason: "Fraud Alert"`) |
| `"Apply for Funding"` | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45` (with `ready_for_next_round: true`) |
| `"Review Funding File"` | `src/workflows/c-05-pre-funding-review.mjs:39` |
| `"Prepare Next Funding Round"` | `src/workflows/f-04-round-approvals.mjs:32` |
| `"Prepare Next Funding Round"` | `src/workflows/f-11-bank-email-event-router.mjs:62` |
| `"Closed/Stop"` | `src/workflows/c-06-crs-results-router.mjs:162` (with `hard_stop_reason: "disqualified"`) |
| `"Collect inquiry identity packet"` | `src/handlers/inquiry-docs.mjs:27` |

**15 write sites. 9 distinct values.**

Test assertions that pin these values (do not weaken):
`src/workflows/f-01-funding-intake.test.mjs:13`,
`src/workflows/f-03-round-submitted.test.mjs:16`,
`src/workflows/f-06-funding-conditions-missing-docs.test.mjs:23`,
`src/workflows/c-05-pre-funding-review.test.mjs:10`,
`src/http/crm-html.test.mjs:56`.

### Chris's list vs. the code's list

Chris's spec (`docs/workflows/fulfillment-layer-2026-08-19.md:22-27`):

| Chris's value | In code? | Evidence |
|---|---|---|
| Pull CRS | **YES, exact** | `src/workflows/c-05-pre-funding-review.mjs:44` |
| Collect Documents | **YES, exact** | `src/workflows/f-01-funding-intake.mjs:65` |
| Remove Inquiries | **YES, exact** | `src/workflows/c-02-inquiry-created.mjs:54` |
| Clear Fraud Alert | **YES, exact** | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:37` |
| Review Funding File | **YES, exact** | `src/workflows/c-05-pre-funding-review.mjs:39` |
| Apply for Funding | **YES, exact** | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45` |
| **Prepare Next Round** | **NO — string mismatch** | code writes `"Prepare Next Funding Round"` (`src/workflows/f-04-round-approvals.mjs:32`, `src/workflows/f-11-bank-email-event-router.mjs:62`). Exact string `"Prepare Next Round"` returns zero hits across `src/ api/ public/ db/ docs/journeys/`. |
| **Lock Fee** | **NOT FOUND** | zero hits, whole repo |
| **File Prep** | **NOT FOUND** | zero hits, whole repo |
| **Review Disputes** | **NOT FOUND** | zero hits, whole repo |
| **Ready to Fund** | **NOT FOUND** | zero hits, whole repo |

Values the code writes that Chris's list does **not** mention: `"Closed/Stop"`
(`src/workflows/c-06-crs-results-router.mjs:162`) and
`"Collect inquiry identity packet"` (`src/handlers/inquiry-docs.mjs:27`).

**This is a question for Chris, not a thing to fix.** Do NOT rename
`"Prepare Next Funding Round"` and do NOT invent the four missing chips.

### Does it mean what Chris means?

**Yes — same meaning, same field, same intent.** It is a single-select "what should an
employee do next on this file", set by the workflow engine as the file moves. It is not a
different thing that happens to share a name.

The gap is **coverage, not meaning**: 9 values exist, Chris's model needs 11, and only
one screen reads it.

### Is it live?

Yes. `src/workflows/index.mjs:68-71` records that `INNGEST_EVENT_KEY` and
`INNGEST_SIGNING_KEY` are **both set on the live deploy (verified by name 2026-08-19)**
and Inngest has executed functions in production. Separately, `src/events/bus.mjs:41-45`
dispatches local handlers **synchronously on every `emit`**, before Inngest is even
consulted (`src/events/bus.mjs:49`). So `src/handlers/*` writes land regardless.

---

## 4. THE CLIENT SHAPE

### Canonical row: `clients` — `db/schema/001_init.sql:44-72`

```
id uuid PK · org_id uuid NOT NULL · ghl_contact_id text · client_master_key text UNIQUE
first_name · last_name · email · phone            (all text)
custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb   <-- line 55
funded boolean NOT NULL DEFAULT false
funded_amount numeric(14,2) · days_to_fund integer
outcome_tier text   -- FRAUD_HOLD|MANUAL_REVIEW|REPAIR_ONLY|FUNDING_PLUS_REPAIR|FULL_FUNDING|PREMIUM_STACK
channel_source text · pipeline_ids uuid[] · tags text[]
dnd_sms · dnd_email · dnd_voice · consent_sms      (all boolean NOT NULL DEFAULT false)
created_at · updated_at timestamptz
```

Columns added later:
- `client_code text` — `db/migrations/012_attribution.sql:58`
- `partner_id uuid` — `db/migrations/042_partners.sql:73`
- `is_demo boolean NOT NULL DEFAULT false` — `db/migrations/094_demo_logins.sql:78`

### Where `custom_fields` lives

**`clients.custom_fields`, jsonb, `db/schema/001_init.sql:55`.** That is the source of
truth. The header comment at `db/schema/001_init.sql:40-43` says the typed carbon-copy
table was meant to replace it and never did.

`db/migrations/163_cf_svy_typed_columns.sql:4` says it plainly:
"jsonb on clients.custom_fields remains source of truth; these columns are the typed mirror."

### Writers of `clients.custom_fields`

1. `src/workflows/custom-fields.mjs:5` `mergeCustomFields` — the shared helper, imported
   by ~25 workflow files.
2. `src/handlers/client-lifecycle.mjs:230` — private duplicate of the same helper.
3. `src/workflows/ds-02-diy-letters.mjs:98` — direct SQL, writes `diy_delivered_event_id`.
4. `src/workflows/c-06-crs-results-router.mjs:134` — direct SQL, writes
   `funding_letters_delivered_event_id`.
5. `src/handlers/client-lifecycle.mjs:46-53` — `jsonb_build_object` for
   `ghl_link_missing`, `ghl_link_missing_reason`, `ghl_link_missing_at`.
6. `src/handlers/client-lifecycle.mjs:94-99` — `jsonb_build_object` for
   `ghl_link_dry_run`.
7. `api/dashboard/client-archive.mjs:59-65` — writes `crm_archived_at`
   (`api/dashboard/client-archive.mjs:50`).
8. `src/privacy/erasure.mjs:319` — resets the whole blob to `'{}'::jsonb`.

### `custom_fields` JSON keys actually written in this codebase

Extracted from every `mergeCustomFields(...)` patch object and every direct jsonb write.
`file:line` is one representative site; the count is total write sites.

| Key | Representative site | sites |
|---|---|---|
| `affiliate_tier1_owner` | `src/workflows/af-02-referral-ownership-capture.mjs:43` | 1 |
| `affiliate_tier2_owner` | `src/workflows/af-02-referral-ownership-capture.mjs:44` | 1 |
| `analyzer_path` | `src/workflows/c-00-crs-soft-pull-request.mjs:65` | 1 |
| `analyzer_prequal_amount` | `src/handlers/client-lifecycle.mjs:450` | 1 |
| `analyzer_status` | `src/workflows/u-02-analyzer-complete-delivery.mjs:49` | 1 |
| `bs_email_last_sent_ts` | `src/workflows/bs-01-precall-launcher.mjs:170` | 1 |
| `bs_precall_start_ts` | `src/workflows/bs-01-precall-launcher.mjs:244` | 1 |
| `bs_sms_last_sent_ts` | `src/workflows/bs-01-precall-launcher.mjs:191` | 3 |
| `call_confirmed` | `src/workflows/dpc-03-inbound-reply-router.mjs:92` | 1 |
| `call_outcome` | `src/handlers/comms.mjs:465` | 8 |
| `cf_inbox_forwarding_verified` | `src/workflows/f-10-client-funding-inbox-provisioner.mjs:54` | 1 |
| `closer_deck_disposition` (nested object: `route`, `offer_key`, `amount_cents`, `temperature`, `beliefs_count`, `cost_of_inaction`, `at`) | `src/sales/closer-deck.mjs:672-681` | 1 |
| `closer_deck_ebook_sent_at` | `src/sales/closer-deck.mjs:513` | 1 |
| `closer_deck_letters_at` | `src/sales/closer-deck.mjs:630` | 1 |
| `closer_deck_soft_pull_sent_at` | `src/sales/closer-deck.mjs:434` | 1 |
| `crm_archived_at` | `api/dashboard/client-archive.mjs:50` | 1 |
| `crs_paid` | `src/handlers/client-lifecycle.mjs:324` | 1 |
| `crs_pull_scope` | `src/workflows/c-00-crs-soft-pull-request.mjs:65` | 1 |
| `crs_snapshot_date` | `src/workflows/u-03-crs-snapshot-sync.mjs:18` | 1 |
| `crs_status` | `src/workflows/c-00-crs-soft-pull-request.mjs:66` | 2 |
| `decision_status` | `src/workflows/dpc-03-inbound-reply-router.mjs:100` | 1 |
| `deposit_paid` | `src/handlers/client-lifecycle.mjs:338` | 1 |
| `diy_delivered_event_id` | `src/workflows/ds-02-diy-letters.mjs:98` | 1 |
| `diy_letter_count` | `src/metro2/diy/deliver.mjs:76` | 1 |
| `diy_package_ready_at` | `src/metro2/diy/deliver.mjs:76` | 1 |
| `diy_package_reason` | `src/metro2/diy/deliver.mjs:32` | 2 |
| `diy_pdf_count` | `src/metro2/diy/deliver.mjs:76` | 1 |
| `diy_status` | `src/metro2/diy/deliver.mjs:32` | 6 |
| **`employee_next_action`** | `src/handlers/inquiry-docs.mjs:27` | **15** |
| `first_touch_date` | `src/workflows/af-02-referral-ownership-capture.mjs:42` | 1 |
| `funding_condition_required` | `src/workflows/f-06-funding-conditions-missing-docs.mjs:76` | 1 |
| `funding_delivery_sent` | `src/workflows/u-02-analyzer-complete-delivery.mjs:67` | 1 |
| `funding_email_forwarding_address` | `src/workflows/f-10-client-funding-inbox-provisioner.mjs:54` | 1 |
| `funding_letters_delivered_event_id` | `src/workflows/c-06-crs-results-router.mjs:135` | 1 |
| `funding_locked_date` | `src/workflows/f-07-funding-locked.mjs:65` | 1 |
| `ghl_link_dry_run` | `src/handlers/client-lifecycle.mjs:97` | 1 |
| `ghl_link_missing` / `_reason` / `_at` | `src/handlers/client-lifecycle.mjs:49-51` | 1 |
| `hard_stop_reason` | `src/workflows/c-06-crs-results-router.mjs:161` | 1 |
| `inquiry_docs_missing` | `src/handlers/inquiry-docs.mjs:28` | 1 |
| `last_progress_action` | `src/workflows/dpc-01-analyzer-lock.mjs:15` | 4 |
| `last_progress_timestamp` | `src/workflows/dpc-01-analyzer-lock.mjs:15` | 3 |
| `lifecycle_status` | `src/handlers/client-lifecycle.mjs:260` | 5 |
| `lifetime_value` | `src/workflows/sys-01-ltv-calculator.mjs:32` | 1 |
| `ltv_applied_event_ids` | `src/workflows/sys-01-ltv-calculator.mjs:32` | 1 |
| `potential_commission` | `src/workflows/sys-01-client-value-calculator.mjs:35` | 1 |
| `primary_fico_score` | `src/workflows/u-04-promote-crs-primary.mjs:19` | 1 |
| `primary_snapshot_source` | `src/workflows/u-04-promote-crs-primary.mjs:19` | 1 |
| `product_path` | `src/workflows/ds-01-repair-referral.mjs:71` | 2 |
| `ready_for_next_round` | `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45` | 1 |
| `round_hold_reason` | `src/workflows/c-00-crs-soft-pull-request.mjs:65` | 6 |
| `run_inquiry_removal` | `src/workflows/c-02b-inquiry-removal-requested.mjs:17` | 1 |
| `sale_closed` | `src/handlers/client-lifecycle.mjs:342` | 1 |
| `total_funding_estimate` | `src/handlers/client-lifecycle.mjs:450` | 1 |

**Plus two open-ended writes — the key set is NOT closed:**
- `src/handlers/client-lifecycle.mjs:280` merges the **entire survey answers object**
  verbatim: `await mergeCustomFields(db, clientId, answers);`. Every `cf_svy_*` key the
  survey posts lands in the blob.
- `src/handlers/client-lifecycle.mjs:244-256` (`attributionFields`, spread in at `:261`) merges
  `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `landing_path`,
  `referrer_domain`, `lead_magnet_type`.

Keys read back out **in SQL** (`custom_fields->>'…'`) across `src/` and `api/` — the short
list, and it tells you what is load-bearing today:
`affiliate_tier1_owner`, `business_name`, `cf_svy_self_reported_fico`,
`cf_svy_self_reported_fico_label`, `crm_archived_at`, `crs_paid`, `deposit_paid`,
`funding_email_forwarding_address`, `sale_closed`, `synthetic`, `synthetic_run_id`,
`total_funding_estimate`.
**`employee_next_action` is NOT among them** — no SQL anywhere filters or groups on it.

### Related tables W2–W5 will need

- `funding_rounds` — `db/schema/001_init.sql:119-133`:
  `id, org_id, client_id, round_number, status, product, submitted_amount,
  approved_amount, funded_amount, hold_reason, conditions jsonb, created_at, updated_at`.
- `applications` — `db/schema/001_init.sql:137-147`:
  `id, org_id, funding_round_id, bank, status, approved_amount, conditions jsonb, …`.
- `tasks` — `db/schema/001_init.sql:223-236`:
  `id, org_id, client_id, assignee, title, body, due_at, source_workflow, done,
  created_at, updated_at`; plus `assignee_role` and `assignee_staff_id`
  (`db/migrations/041_task_routing.sql:36-37`), `meeting_url`
  (`db/migrations/146_tasks_meeting_url.sql:5`), `is_demo`
  (`db/migrations/153_demo_ui_coverage.sql:2`).
- `inquiry_removal_cases` — accessor `src/inquiry-ops/cases.mjs`; carries `case_status`,
  `open_inquiry_count`, `master_call_state`, `selected_bureaus_raw`, `assigned_remover`
  (`src/inquiry-ops/cases.mjs:87-93`, `:127-130`).

---

## 5. THE PAGE STRUCTURE (describe only — nothing changed)

### 5a. `public/app/client-control-panel.html`

Layout: `<div class="record-head">` at **line 435** (closes **462**), then `<main>` at
**464** containing `.main-col` (**465**, closes **602**) and `.side-col` (**604**).
`</main>` at **661**.

`.main-col` groups, in order (boundaries verified line by line):

| lines | block | contains an action control? |
|---|---|---|
| 446–461 | `.record-fields` tiles inside `.record-head`: Main Status (`447`), Prequal (`448`), Total Approved (`449`), Open Inquiries (`450`), Inquiry Removal (`451`), Scores (`452-453`), Card Use (`459`), Funding Round (`460`) | no |
| 467–486 | `.group` → `.blockers-panel#ccp-blockers-panel`. Eyebrow "Next Action" (`470`), value `#ccp-next-action` (`472`), blocker age (`474-477`), why-label (`480`), `#ccp-blocker-list` (`481`), `.status-chip-row#ccp-chips` (`482-484`) | **no** |
| 488–492 | `.group` "Need action" — list of open inquiry-removal cases, `#ccp-need-action` (`491`) | anchors only |
| 494–526 | `.group` "Actions" — **Pull TransUnion (`520`), Pull Experian (`521`), Pull Equifax (`522`), Generate Apps (`523`), Issue Inquiry Removal (`524`)**, status `#ccp-issue-ir-status` (`525`) | **YES — do not move** |
| 529–540 | `.group` "Agent context" (collapsed, `#agent-context-body`) — comment at `528` | no |
| 545–558 | `.group` "Credit & Hold Status" (collapsed, `#hold-body`) — Credit Status `552`, Income EX `553`, On Hold Because `554`, Income EQ `555`; comment at `541-543` | no |
| 560–579 | `.group` "Details" (collapsed, `#details-body`) — Email/Phone/Tier/Path (`566-569`) + notes textarea (`571-572`) | textarea (read-only per footer note at `688`) |
| 585–600 | `.group` "Documents" (collapsed, `#upload-body`) — dropzone; comment at `581-584` | **YES — upload** |

`.side-col` (604–659) holds Funding · Apply, a `<details>` block ending at `643`, and the
"System Facts" `.group` at **645–658** (`#facts-body` `650`, `.facts-list` `651`, rows
`652-655`).

**Where a new read-only display block fits, cheapest first:**

1. **Inside the existing Next Action panel, immediately after
   `public/app/client-control-panel.html:472`** (the `#ccp-next-action` div) and before
   `.blocker-age-wrap` at `474`. A sibling `<div>` here sits directly under the value it
   explains. Nothing in that panel is a button. Zero risk.
2. **As a new chip in `.status-chip-row#ccp-chips`, lines 482–484.** There is exactly one
   chip today (`#ccp-chip-credit`, line `483`, painted at `:878`). Adding siblings is
   additive markup inside a flex row. No button moves.
3. **A new `.group` inserted between line 492 (`</div>` closing "Need action") and line
   494 (`<div class="group">` opening "Actions").** This puts a read-only block above the
   action buttons without touching them. Follow the collapsed pattern used at `545-551`
   (`<button class="group-title tog" aria-expanded="false" aria-controls="…">` + a
   `.group-body` with `hidden`) — the fold handler at `:672-679` picks it up automatically.
4. **New `.fact-row`s inside "System Facts", after line 655** (`.facts-list` is `651–656`).
   Purely informational, collapsed by default, and already the home for
   `Last Credit Pull / Scores / Funding Round / Funded`.

**Do not touch:** lines 494–526 (Actions group — five live buttons), 585–600 (Documents
upload). Both hold live controls.

**Note for whoever paints:** `setText()` and `render(d)` live at
`public/app/client-control-panel.html:837-905`. `cf` is already bound at `:839`
(`var cf = c.custom_fields || {}`), so any custom_fields key is already in hand — no new
fetch needed. And `src/http/crm-html.test.mjs:50-67` asserts on this file's contents;
read it before editing.

### 5b. `public/app/pipeline.html`

Chrome, top to bottom:

| lines | block |
|---|---|
| 375–386 | `<header class="topbar">` — brand, org pill, clock, LIVE pill |
| 390–399 | `<nav class="railbar">` — 8 rail tabs, each `.rail-tab[data-rail]` with `.rt-code` and `.rt-count` (counts painted from `/api/dashboard/pipeline-counts`, `:1748-1758`) |
| 402–413 | `<div class="filterbar">` — search `#q` (`403`), Filter button `#filterBtn` (`404`), **`.filter-chips#filterChips` (`405`)**, `.filter-spacer` (`406`), `.board-summary` (`407–412`) with `#sumCount` (`408`), `#sumMoney` (`409`), `#sumHeld` (`410`), Archive button `#boardArchiveTop` (`411`). Comment header at `401`. |
| 414–425 | `<div class="filterpanel" id="filterPanel" hidden>` — Owner `415`, Hold `416–417`, Age `418–420`, Sort `421–423`, Clear all `#filterClear` `424` |
| 433–436 | `.board-row` → `.board-wrap` → `#boardStatus` (`435`), `#board` (`436`) |
| 442–496 | `.route-menu#routeMenu` — deliberately outside `#board` (reason at `439-441`) |
| 500–514 | `.fh-drawer#fhDrawer` — per-client side drawer |
| 516–527 | archive confirm modal |
| 531–534 | footer status bar |

**Where a lens/toggle could sit:**

1. **In the filter bar, between `#filterBtn` (line 404) and `.filter-chips` (line 405).**
   That row is already a flex line of controls with a spacer at `406` pushing the summary
   right. A segmented lens control dropped here inherits the existing layout and touches
   no button. This is the natural home.
2. **As a new `.select` row inside `#filterPanel`, after line 423** (end of the Sort
   select) and before `#filterClear` at `424`. Matches the existing
   `<div class="select"><span class="sl-k">…</span><select …>` pattern exactly. Hidden
   until Filter is pressed, so it adds no visual weight.

**Where a chip row could sit:**

1. **`.filter-chips#filterChips` at line 405 already IS a chip row.** It is populated by
   script and styled at `:129-133` (`.filter-chips`, `.fchip`, `.fchip .x`). Emitting
   read-only chips into it needs no new markup and no new CSS.
2. **A new sibling `<div>` between the filter bar (`</div>` at line 413) and
   `#filterPanel` (line 414).** A full-width strip there sits under the controls and above
   the board, and pushes nothing sideways.
3. **Per-card chips** would go in `CARDS_SQL`/`paint()` territory — note the warning at
   `public/app/pipeline.html:549-551`: card selectors are scoped to `.board` on purpose
   because a demonstration strip lower in the page reuses `.col`/`.card` markup. And
   `paint()` tears down every child of `.board` on load (`:439-441`), so anything nested
   inside `#board` must be re-rendered by the paint function, not injected once.

**Do not touch:** `#boardArchiveTop` (line 411 — archive), the rail tabs (390–399 — they
drive `load()` at `:1720`), and anything inside `#board`.

---

## What I could not answer, and where I looked

- **The allowed option list for `employee_next_action`.** GHL typed it `SINGLE_OPTIONS`
  but `db/schema/meta/custom-field-map.json:174-180` records no options array. Looked in
  `db/schema/meta/custom-field-map.json`, `db/schema/005_client_custom_fields.sql`,
  `fundhub-docs/sources/AIRTABLE-BASE-EXTRACT.md`. **NOT FOUND.** The 9 values in §3 are
  what the code writes — that is the real, observable set, not a spec.
- **Live row counts / which values actually appear on real clients.** That needs a
  read-only SELECT against the production database. **That is W5's task, not mine** — I
  wrote no queries against client data.
- **`spec-client-control-panel.md`, `spec-navigation.md`,
  `spec-inquiry-remover-dashboard.md`** — referenced by
  `fundhub-docs/sources/AIRTABLE-BASE-EXTRACT.md:112-140` but **the files are not in this
  repo.** Searched `fundhub-docs/` and `docs/` by name. If Chris has them, they carry the
  original field rename map (`Next Action Badge`, `Hold Reason`, `Employee Next Action`,
  `fraud_alert_present`, `security_freeze_p_present`, and 7 more —
  `fundhub-docs/sources/AIRTABLE-BASE-EXTRACT.md:115-117`).

## Rules W2–W5 must not break

- `npm test` globs `src/**` and `scripts/**` only. A test under `api/` never runs.
  Endpoint tests go at `src/http/<name>.pg.test.mjs` and import the `api/` handler.
  (CLAUDE.md §12)
- A handler file is not a route. `ALLOWED_UNROUTED` is empty
  (`src/http/routes.test.mjs:71`), so any new `api/**` file must be added to `ROUTES` at
  `netlify/functions/api.mjs:224` or `src/http/routes.test.mjs` fails.
- Money is integer cents via `src/commissions/money.mjs`. `fromCents` returns a **string**.
  NULL means unknown and must survive — never default it to 0. (CLAUDE.md §12)
- `public/app/closer-dashboard.html:590` holds a verbatim ES5 copy of
  `src/http/closer-dashboard-view.mjs`. Change one, change both, or
  `src/http/closer-dashboard-view.test.mjs` fails.
- Editing an applied migration is a silent no-op — supersede with a new file.
  (CLAUDE.md §12) **Phase 0 adds no migrations at all.**
- Do not add a page, screen, tab, or menu row. Fit into existing surfaces.
