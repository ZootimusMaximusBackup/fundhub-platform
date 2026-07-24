# fundhub-platform

The custom platform replacing GoHighLevel + Airtable + Commas-hosted checkout with **one Vercel company, one Postgres database, one event stream** (ClickFunnels stays the front end). Per the **Master Rebuild Spec v1** (APPROVED 2026-07-22) — canonical copy at `fundhub-docs` → `/raw/master-rebuild-spec.md`.

> Built WHILE the live GHL system keeps running. Nothing about launch pauses. Cut over rail by rail once gates pass.

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
- **117 unit tests pass without a live Postgres** (`npm test`) — bus + 7 adapters + handler unit tests; the 2 real-DB integration tests self-skip.
- **Validated live against real Postgres 16** (2026-07-24, throwaway Docker container): `npm run migrate` applies all tables + 7 pipelines / 42 stages + indexes + default org clean; a signed Commas webhook deduped at the DB `ON CONFLICT` level with a bad-sig 401; and the **full journey integration test** (`client-lifecycle.pg.test.mjs`, runs when `DATABASE_URL` is set) drove entry→survey→payment→diagnostic→decision→analysis into real `clients`/`transactions`/`crs_results` rows, then `replay()`'d every stored event and asserted **zero double-writes**. Schema, migrations, idempotency, JSONB storage, dispatch, and replay-safety are all proven — not mocked.

## Next
Provision a Postgres, run `npm install` + `npm run migrate` to validate the schema live, then register HANDLERS on the bus (the reactions: GHL field writes, Airtable sync, CRS pulls, letter gen). Each adapter's `⚠️ CONFIRM` block must be checked against a real payload before that source cuts over. Deferred behind the Monday launch — builds in parallel.
