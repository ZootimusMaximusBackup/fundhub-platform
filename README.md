# fundhub-platform

The custom platform replacing GoHighLevel + Airtable + Commas-hosted checkout with **one Vercel company, one Postgres database, one event stream** (ClickFunnels stays the front end). Per the **Master Rebuild Spec v1** (APPROVED 2026-07-22) — canonical copy at `fundhub-docs` → `/raw/master-rebuild-spec.md`.

> Built WHILE the live GHL system keeps running. Nothing about launch pauses. Cut over rail by rail once gates pass.

## Requirements

- **Node.js 22** is required. Use the version in [`.nvmrc`](.nvmrc) (`nvm use` or your version manager equivalent).
- `package.json` `engines.node` is pinned to **22.x**; other Node versions are unsupported.

## Status: Phase 0 / B1 started

This is the **B1 (Schema + events)** deliverable — the foundation every other builder builds against (Spec §16). B1 merges first.

- **`db/schema/001_init.sql`** — the full v1 Postgres schema (Spec §3): all core tables, `org_id`/`created_at`/`updated_at` on every table (Rule 7), outcome labels on `clients` (Rule 8), append-only replayable `events` table (Rule 9), PII access-logging (Item 2), one-primary-snapshot constraint (Primary Snapshot rule).
- **`db/seed/002_pipelines.sql`** — the 7 pipelines + stages seeded exactly from Spec §5.

### Open item before B2/B3 build against this
- **`clients` 252 custom fields:** the schema holds them in `custom_fields jsonb` for now. Migration `003_clients_custom_fields.sql` must generate the **typed columns** from the CRM Source of Truth field export (Rule 2 — exact GHL names kept, e.g. `cf_svy_funding_target_amount`). Generate that before the CRM adapter (B2) writes typed data.

## Build order (Spec §16)
Phase 0: this schema + event bus + replay harness + Cognee ingestion + swarm boot (B1–B8, V1–V4).
Then adapters (Phase 1) → pipelines + ~60 Inngest workflow ports (Phase 2) → dashboards/portal (Phase 3) → Lendflow + Deluxe scaffold (Phase 4) → ops agents (Phase 5) → validator replay + shadow mode (Phase 6).

Tooling (mandated): OpenCode + Antigravity + **Cognee** (shared memory — every agent queries the graph before writing code; no agent works from its own recollection of the spec).

## Built so far (B1)
- `db/schema/001_init.sql` — 27-table schema (§3).
- `db/seed/002_pipelines.sql` — 7 pipelines + stages (§5).
- `db/migrate.mjs` — idempotent migrations runner (tracks `schema_migrations`, one txn per file). Run: `DATABASE_URL=… npm run migrate`.
- `src/events/` — the **event bus** (§4 + §16 replay harness): `emit()` (append-only, idempotent by key, dispatches handlers), `replay()` (re-fires stored events — the V1 validator's tool), `canonical.mjs` (the event names), `registry.mjs` (handler registration). `src/db.mjs` = pg pool.
- `src/adapters/` — **the B2 adapter layer.** Every adapter does the same three things: verify the source signature (fail-closed), normalize the raw body, and `emit()` canonical events onto the bus. NONE do GHL/Airtable/CRS side effects inline — those become handlers registered on the bus (so one event can drive many reactions, and `replay()` re-drives them). Ported from the live handlers where they exist.
  - `commas.mjs` — Commas/FanBasis payments (HMAC-SHA256). `$32 Business Financial Assessment` → `payment.received`+`diagnostic.paid`; `Consulting Services Deposit` → `deposit.paid`; `Consulting Services Package` (DIY) → `sale.closed`; failures → `payment.failed`. Routes **strictly on product name, never amount**.
  - `clickfunnels.mjs` — funnel front end (HMAC-SHA256). Lead/opt-in → `entry.captured`; survey step → also `survey.submitted`.
  - `twilio.mjs` — inbound SMS. Real Twilio HMAC-SHA1 signature scheme (base64 of URL+sorted params). Inbound message → `message.inbound`.
  - `mailgun.mjs` — bank inbox (real Mailgun HMAC-SHA256 over `timestamp+token`). Ports the live 7-type email classifier (APPROVED/COUNTEROFFER/DENIED/MISSING_DOCS/ACTION_REQUIRED/APP_RECEIVED/NOISE) → `mail.response`. ⚠️ Fails *open* when no signing key is set (mirrors current prod, which lacks the real signing key) — tighten to fail-closed once Chris supplies it.
  - `crs.mjs` — CRS engine OUTPUT (no webhook/signature — a mapper the platform calls after the engine runs). Completed result → `analysis.completed` + `decision.rendered`.
  - `bland.mjs` — Bland voice calls (HMAC-SHA256 shared secret, ⚠️ confirm scheme). Finished call → `call.completed` (in-progress calls emit nothing).
  - `calcom.mjs` — bookings (real Cal.com X-Cal-Signature-256). `BOOKING_CREATED`/`BOOKING_RESCHEDULED` → `booking.created`; cancelled/other ignored.
- **105 unit tests pass without a live Postgres** (`npm test`) — bus + 7 adapters. Each verifies signature accept/reject, normalize, canonical mapping, idempotent re-delivery, and handler dispatch.
- `src/handlers/client-lifecycle.mjs` — **the reactions layer (Phase 2 start).** Adapters emit events; these handlers write DOMAIN STATE to Postgres — the platform replacement for what GHL/Airtable did. `register()` wires: `entry.captured`/`survey.submitted` → find-or-create client + fold survey answers into `custom_fields`; `payment.received` → insert a `transactions` row; `diagnostic.paid`/`deposit.paid`/`sale.closed` → stamp client flags; `analysis.completed` → append `crs_results`; `decision.rendered` → set `outcome_tier` + funding estimate. Every write is IDEMPOTENT (find-or-create by email, `ON CONFLICT DO NOTHING` on the txn ref, event-id dedup on crs_results) so `replay()` re-drives events without double-writing. Migration `003_client_indexes.sql` adds the unique indexes this relies on.
- `src/handlers/comms.mjs` — reactions layer batch 2 (comms + scheduling): `message.inbound`→`messages` (sms), `call.completed`→`messages` (voice), `mail.response`→`bank_inbox` (classified bank email), `booking.created`→`tasks` (closer follow-up). SMS/mail/voice only LINK to an existing client (never mint one from an inbound message); booking resolves-or-creates. Idempotent via migration `004_comms_indexes.sql` (messages provider_ref unique) + event-id / booking-uid guard selects. Between the two handler modules, all 12 core journey + side events now persist domain state.
- `src/http/router.mjs` + `api/webhooks/[provider].mjs` — **the HTTP layer that makes it a runnable service.** `POST /api/webhooks/{commas|twilio|mailgun|calcom|bland|clickfunnels}` → the router picks the adapter, hands it the right signature header + secret (from env), and returns `{status, body}`. `src/register-all.mjs` wires every handler onto the bus on cold start. `api/health.mjs` checks the DB. Deploy target = Vercel (Spec §2).
- `api/dashboard/clients.mjs` + `api/dashboard/client.mjs` + `public/dashboard.html` — **read-only closer dashboard on real data** (Phase 3 start): one aggregate query for journey state per client (paid flags, outcome tier, funding estimate, tx summary, last activity) + a full detail view (transactions/crs_results/messages/tasks). Verified end-to-end (events → handlers → Postgres → dashboard). **Auth: shared-secret** (`DASHBOARD_SECRET`) — endpoints require the `x-dashboard-key` header / `?key=`, fail-closed in production; open the page as `/dashboard.html?key=<secret>`. Output is HTML-escaped (no XSS from client-controlled fields). Single-tenant internal tool — the key IS the auth.
- **124 unit tests pass without a live Postgres** (`npm test`) — bus + 7 adapters + 2 handler modules + router; the 2 real-DB integration tests self-skip.
- **Validated live against real Postgres 16** (2026-07-24, throwaway Docker container): `npm run migrate` applies all tables + 7 pipelines / 42 stages + indexes + default org clean; a signed Commas webhook deduped at the DB `ON CONFLICT` level with a bad-sig 401; and the **full journey integration test** (`client-lifecycle.pg.test.mjs`, runs when `DATABASE_URL` is set) drove entry→survey→payment→diagnostic→decision→analysis into real `clients`/`transactions`/`crs_results` rows, then `replay()`'d every stored event and asserted **zero double-writes**. Schema, migrations, idempotency, JSONB storage, dispatch, and replay-safety are all proven — not mocked.

## Creative Factory + Campaign Manager (migrations 045–050)

Partner orgs connect **their own** Meta / TikTok / social accounts by OAuth; the platform
generates creative, screens it, launches campaigns and runs the daily optimisation loop on their
behalf. Nothing runs through a Fundhub-owned ad account.

**This module introduces row level security to the codebase.** No table had it before — isolation
was application-level via `src/partners/scope.mjs`, which stays. Every new table also carries a
policy reading a transaction-scoped GUC, so a query that forgets its `partner_id` predicate returns
**nothing** rather than everything. `FORCE ROW LEVEL SECURITY`, because the app role owns these
tables and would otherwise be exempt from its own policies. Open a scope with
`withPartnerScope()` / `asPartner()` / `asStaff()` in `src/partners/rls.mjs` — outside one, these
tables read as empty.

| migration | what |
|---|---|
| `045_creative_factory` | brand kits + sources, creative assets, generation jobs; the RLS helpers the rest of the module reuses |
| `046_ad_platforms` | connections, campaign/ad-set/ad mirror, daily metrics, `action_log`, spend ceilings, partner-visible onboarding tasks |
| `047_compliance_rules` | the guardrail rule sets as config, seeded from the spec; CROA disclosure gate |
| `048_campaign_config` | provider selection, the six strategy templates, optimiser rules |
| `049_social` | organic channels and posts, screened on the same rails as paid |
| `050_creative_metering` | usage accrual, mirroring the `partner_revenue` pattern from 042 |

- `src/compliance/` — the guardrail engine every asset and payload passes before reaching a
  platform. **Deterministic**: patterns and literals, never an LLM. Fails closed on any error — a
  database outage, a bad regex and a malformed subject all return `blocked`. Three blocks are
  structural and not configurable: TikTok + credit repair, the Meta special-ad-category force, and
  the credit-repair human-approval gate. There is no override flag; do not add one.
- `src/creative/` — five providers behind one `generate(spec, ctx)`, selected by config row. A
  provider outage degrades a job to `queued`, never to a silent empty result.
- `src/adplatforms/` — every write goes **guardrail → action log → platform**, in that order. The
  log row is written *before* the call, so a crash mid-flight leaves a findable record. Tokens are
  AES-256-GCM with the partner id as additional authenticated data, so a ciphertext copied into
  another partner's row fails to decrypt.
- `src/optimize/` — the daily loop, idempotent per partner per day. Spend ceilings are enforced at
  two independent points: a pre-flight check against our mirror, and a kill-switch job reading
  **actual platform spend**, so a sync failure cannot disable both.
- `api/creative/`, `api/campaigns/` — ten partner-scoped read endpoints.

### Values deliberately left unset — these need a decision

`SELECT * FROM v_creative_config_gaps;` renders them; the features that read them refuse to run
rather than use a guessed number.

- **`ad_platform_category_map`** — the spec named `FINANCIAL_PRODUCTS_AND_SERVICES`, which is not a
  Meta enum member, and `CREDIT` is likely correct for these offers. **Meta launches are blocked
  until this is populated.**
- **`creative_billing_rates`** — generation-cost markup % and managed-ad-spend %. `accrue_creative_usage()`
  raises while either is null.
- **`optimization_rules.kill_no_conversions`** — the spend floor. Ships inactive.
- **`optimization_rules.spend_tier_refresh`** — the tier → cadence table. Ships inactive and empty.

`max_daily_increase_pct` seeds at 20 with a hard cap of 30, enforced by a CHECK.

Provider modules and the platform adapters carry `⚠️ CONFIRM` markers — their payload shapes are
unproven against real accounts, exactly like the `src/adapters/` files with the same marker.

## Diagrams
`docs/diagrams/` — event flow, one state machine per rail (7), the adapter boundary map, and the
agent trigger map. **Generated from the code**, never from a spec document: canonical events and
workflow triggers are *imported* from `src/events/canonical.mjs` and `src/workflows/index.mjs`,
rails are parsed from `db/seed/002_pipelines.sql`, and the boundary is read from `src/adapters/`.
Mermaid renders natively on GitHub, so there is no build step and no exported images.

```sh
npm run diagrams        # rewrite docs/diagrams/ from the current code
npm run diagrams:check  # fail if the committed diagrams are stale
```

`npm test` asserts the check, so renaming an event or adding a workflow fails the suite until the
diagrams are regenerated — they cannot drift quietly.

## Next
Provision a Postgres, run `npm install` + `npm run migrate` to validate the schema live, then register HANDLERS on the bus (the reactions: GHL field writes, Airtable sync, CRS pulls, letter gen). Each adapter's `⚠️ CONFIRM` block must be checked against a real payload before that source cuts over. Deferred behind the Monday launch — builds in parallel.

## Hiring — always-on inbound recruiting (migration 051)

Built from the sixteen Recruiting & Hiring source docs (Drive), not invented. The
funnel, stages, rubric categories and scorecard model all trace to a document; where the
docs contradict each other the newer one wins and the conflict is recorded in the migration.

**Funnel** (doc 10 + doc 11): Applied → Screening → Group Interview → 1:1 → Offer →
Hired → Onboarding → Ramp (60-day trial) → Performing.

- **Split from affiliates.** 002 seeded one rail for both (R-07). A referral and a candidate
  share nothing but a screen, so `hiring` is now its own pipeline; R-07 keeps its three stages.
- **Not `cards`.** `cards.client_id` is `NOT NULL` — making a client to satisfy a foreign key
  would put candidates in the closer queue and every client count. Applications carry their own
  `stage_id` into the shared `pipeline_stages`.
- **Mock calls are deliberately absent.** Doc 9 carries an explicit "we no longer recommend
  Mock Calls — MANY false positives and false negatives", and doc 11 lists them under
  misconceptions. The stage key is still accepted so a team can add the row without a migration.
- **`src/hiring/bench.mjs`** is what makes it always-on: `bench_target` defaults to 4 per role
  (doc 10's "full bench"), and a shortfall opens a task. Bench counts only candidates past the
  group interview — counting all applicants would report a healthy bench built from unscreened ones.

### This is an automated employment decision tool

Scoring applicants is regulated in a way scoring ad creative is not — Title VII adverse impact
attaches regardless of intent, and NYC Local Law 144 requires an annual bias audit and candidate
notice. So:

- **No candidate is ever rejected by software.** `grading.mjs` produces a score and an advisory
  recommendation; it has no database handle and no staff id to offer. Rejection lives in
  `pipeline.mjs` and requires a named human plus a written reason, enforced in three places:
  the function's argument check, the `hiring_decisions` CHECK, and a terminal-status trigger on
  `candidate_applications`. Each is attacked separately in the tests.
- **Protected characteristics are never stored**, not merely not scored — the intake path strips
  them before the insert, and a rubric naming one throws.
- **The audit trail is retained and undeletable**: rubric version as applied, per-category scores,
  and what the grader recommended next to what the human decided. `/api/hiring/decisions` derives
  the override rate, the central number in an AEDT review.
- A group-interview `no` does **not** auto-reject — it queues a human, because that is an adverse
  action. `yes` and `maybe` both advance, per doc 11's "move people forward even if you're 50/50".

**Adverse-impact analysis needs one more thing.** Because no protected data is collected, an
analysis by race or sex cannot be run from this data — it needs a separate, voluntary
self-identification survey held apart from the hiring record. That is the legally correct
arrangement, and it is flagged rather than implied to be already covered.

### LinkedIn Talent Solutions

`src/hiring/linkedin.mjs` posts jobs and ingests applications people chose to send. There is no
profile read, no search, and nowhere in the schema to put a harvested profile — sourcing data is
dense with proxies for protected characteristics, and the cheapest way to not score something is
never to hold it. ⚠️ CONFIRM: payload shapes are unverified against a real account.

### Left unset — `SELECT * FROM v_hiring_config_gaps;`

- **Role scorecards and comp/OTE.** Doc 7 links to external Closer and Setter Scorecard docs that
  are not in the library folder; doc 6 defines the OTE method, not the numbers. Seeding invented
  outcomes would put made-up performance agreements in front of real candidates.
- **Hiring manager per role** — bench alerts have nobody to route to until set.

## Config defaults (052) and EEO self-ID (053)

`052_config_defaults.sql` sets the five values earlier migrations left null. It is one
file so reverting to "unconfigured" is a single `git revert`. Values fall in three
categories, labelled in the migration:

| | value | basis |
|---|---|---|
| **PLATFORM FACT** | Meta `special_ad_category` = `CREDIT` | Meta's category covering credit cards, loans, financing. ⚠️ Confirm against your API version — a wrong enum is rejected at create time, loudly. |
| **DERIVED** | kill-switch floor $500, spend-tier refresh cadence, ROAS target 1.0 | Derived from the spec's own anchors (72h rotation, frequency 3+, break-even), with the reasoning written out. Tunable. |
| **PLACEHOLDER** | generation markup 100%, managed spend 10% | **Nobody's confirmed commercial terms.** `signed_off_at` is NULL and `v_creative_config_gaps` reports them until a human stamps it. Billing works either way — the flag is a visibility control, not a gate, because a default that stops being visible is one nobody re-examines. |

Hiring scorecards got **structure without targets**: doc 7 links to external Closer and
Setter Scorecard documents that were not in the folder. A template a manager fills in is
useful; invented targets become a performance agreement a real person is held to.

`053_eeo_selfid.sql` closes the adverse-impact gap. Voluntary self-ID stored **apart from
the hiring record**: there is no foreign key to an application, the invite token's link is
destroyed in the same transaction as the response insert (enforced by CHECK), and
`v_eeo_aggregate` suppresses any group under 5 because a cell of one is an identification.
The cost is deliberate — aggregate analysis works, per-candidate lookup cannot.

Deploy variables are in `.env.example`. `AD_TOKEN_ENC_KEY` is required; token storage
refuses to run without it rather than storing plaintext.
