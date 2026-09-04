# Unfinished Features Audit

Read-only audit. Measured **2026-08-02** against `main` at `df3e3b8`
(branch `audit/unfinished`). Only this file was added.

**Scope:** Features that are **wired but unfinished** — code exists and is
reachable (route, screen, module, or table), but the path does not work end to
end. This is different from [WIRING-AUDIT.md](./WIRING-AUDIT.md), which only
asked whether screens call endpoints.

**Model:** Grok. One session. No code changes outside this document.

---

## How this was measured

- Searched for stubs (`not_implemented`, HTTP 501), deferred gates, feature
  flags, “no scheduler / nothing transmits” headers, TODO/deferred comments,
  and half-built UI (“Coming soon”, disabled save, simulated banners).
- Traced writers vs readers for money tables (`sales`, `funding_rounds`,
  `commission_ledger`, `entitlements`), creative/social engines, mail, shifts,
  soft pulls, and outbound messaging.
- Re-checked every WIRING-AUDIT finding that looked stale after
  `e32f577` (hiring / creative / social screen wiring).

---

## Verdict in one page

The platform has a lot of **finished middle pieces** (stores, calculators,
screens that read live data). The gaps that stop end-to-end work cluster in
five places:

1. **Outbound mail for workflows** — staff replies can send; automated queue
   drain needs Inngest live + provider credentials + an owner decision on the
   backlog.
2. **Money chain writers** — sales, funding rounds, commission ledger rows, and
   entitlement grants are calculated or read, but almost never written by live
   handlers.
3. **Provider seams** — Plaid bank link, soft-pull bureau, creative vendors,
   social publish adapters are built as empty or unseeded seams.
4. **Half-built screens** — content admin, galaxy, social queue button, staff
   clock UI, hiring writes, creative generate.
5. **Operator switches still off** — `INNGEST_EVENT_KEY`, outbound pause,
   provider env vars.

---

## WIRING-AUDIT re-check (stale vs still true)

| ID | Original claim | Status today |
|----|----------------|--------------|
| L1 hiring hardcoded | Screen never called API | **Fixed** (`e32f577`) — reads all six `/api/hiring/*` GETs; falls back to sample on failure |
| L2 creative false “ok” | Status tiles claimed wired without fetch | **Fixed** — live GETs + ledger reports last check |
| L3 content-admin live stats | Hardcoded 5 / 4/4 | **Honest now** — banner says no backend; stats from empty in-memory arrays |
| L4 galaxy LIVE | Static pretending live | **Honest now** — `SIMULATED` pill + “No backend” notice |
| L5 social action-log claim | Said route unreachable | **Fixed** — wires `/api/campaigns/action-log?target_type=social_post` |
| D1–D4 dead reads | invoices, funding-rounds, finance-os, banking-surface unused | **Still true** |
| D5 shifts | No screen calls `/api/shifts` | **Still true** (staff-teams clock is local flip only) |
| D6–D19 hiring/creative dead | APIs unused | **Mostly fixed for reads**; creative/hiring still have **no write HTTP** |
| D7 banking revoke | No UI | **Still true** |
| D8 privacy erasure | No UI | **Still true** |
| D9 finance/cashflow | No UI | **Still true** |
| D10 banking/accounts | No UI (hand entry lives on `finance/bank-accounts`) | **Still true** |

---

## Findings

Effort key: **S** = small (hours), **M** = medium (days), **L** = large
(week+ / compliance gate / new vendor).

---

### A. Messaging & mail

#### A1. Workflow outbound mail — queued, rarely drained

| | |
|--|--|
| **What exists** | `sendTemplated` (`src/workflows/messaging.mjs`) inserts `messages` with `status='queued'`, `provider='internal'`. ~26 Inngest workflows use it. Dispatcher (`src/messaging/dispatch.mjs`), outbox (`src/messaging/outbox.mjs`), Mailgun + the CRM relay providers, CRM Outbox (`public/app/ops-admin.html` → `POST /api/messages-outbound`), Inngest sweeper `message-dispatch-sweeper` (**registered** in `src/workflows/index.mjs`, 49 functions), Netlify `staff-message-sweeper` every 5 minutes (**staff replies only**). |
| **What's missing** | (1) `INNGEST_EVENT_KEY` unset → sweeper never runs. (2) Provider credentials. (3) Per-org `messaging_settings.outbound_enabled`. (4) Owner decision to drain months of workflow backlog (staff sweeper deliberately skips it). (5) Rows written as `internal` need channel routing to a transmitting provider. |
| **Files** | `src/workflows/messaging.mjs`, `src/messaging/dispatch.mjs`, `src/messaging/outbox.mjs`, `src/workflows/message-dispatch-sweeper.mjs`, `netlify/functions/staff-message-sweeper.mjs`, `api/messages-outbound.mjs`, `src/messaging/providers/*` |
| **Work** | **M** (ops + owner decision). Staff replies already have a live path via compose → `dispatchMessage`. |
| **Note** | CLAUDE.md §12 / HANDOFF / AUDIT-FINDINGS “nothing transmits” and “sweeper not registered” are **stale**. Infrastructure exists; production send for workflows is still unfinished. |

#### A2. Magic-link email — queues only

| | |
|--|--|
| **What exists** | `src/auth/magic-link.mjs` → `sendTemplated`; routes `auth/magic-link`, `auth/magic-link-verify`; template seed `db/seed/007_portal_magic_link_template.sql`. |
| **What's missing** | Same drain + credentials as A1. Client always gets `{ ok: true }` even when only queued. |
| **Files** | `src/auth/magic-link.mjs`, `api/auth/magic-link.mjs` |
| **Work** | **M** (shared with A1) |

#### A3. Direct mail (`src/mail/`) — intake built, no drop

| | |
|--|--|
| **What exists** | Ingest, suppression, slugs, responses; tables `mail_universe`, `mail_campaigns`, `mail_responses`; tests; README documents FCRA/Deluxe gate. |
| **What's missing** | No HTTP routes under `api/`, no scheduler, no send function, no activation flag, no print/mail vendor integration. By design until legal gate clears. |
| **Files** | `src/mail/*`, `db/migrations/065_*.sql`–`067_*.sql` |
| **Work** | **L** |

#### A4. Banking reminders & finance alerts — rows only

| | |
|--|--|
| **What exists** | `src/banking/reminders.mjs`, `cashflow_reminders` table; `src/alerts/store.mjs` + `evaluate.mjs`; `api/finance/alerts.mjs`; finance-os can toggle triggers. |
| **What's missing** | No email/SMS/push. No cron for `evaluateAndRaise`. Alert UI missing acknowledge/resolve/dismiss/evaluate actions. Misleading toast: “You will get a text when this happens” (`finance-os.html` ~885) with no send path. |
| **Files** | `src/banking/reminders.mjs`, `src/alerts/store.mjs`, `api/finance/alerts.mjs`, `public/app/finance-os.html` |
| **Work** | **S** to fix toast / wire UI actions; **L** if customer notification is desired |

---

### B. Automation engine

#### B1. Inngest — 49 functions registered, engine dormant without keys

| | |
|--|--|
| **What exists** | `/api/inngest` short-circuit in `netlify/functions/api.mjs`; `api/inngest.mjs`; 49 functions including crons for message drain and contract chase. Event bus forwards only when `INNGEST_EVENT_KEY` is set (`src/events/bus.mjs`). Automations screen reports dormant when unset. |
| **What's missing** | Owner must set `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` and sync the Inngest dashboard. Until then: no cron workflows, no event-driven nurture/funding automations. |
| **Files** | `src/workflows/index.mjs`, `api/inngest.mjs`, `netlify/functions/api.mjs`, `src/events/bus.mjs` |
| **Work** | **S** config; **L** operational blast radius once on |
| **Note** | AUDIT-FINDINGS “[U] /api/inngest 404” is **fixed**. |

#### B2. Hard-decline detector deferred (C-06)

| | |
|--|--|
| **What exists** | Full decline branch (tags, tasks, templates) in `c-06-crs-results-router.mjs`. |
| **What's missing** | `HARD_DECLINE_SIGNALS_DEFERRED = true` — `isHardDecline()` always false. Needs real CRS field/tag map from onboarding (compliance decision). |
| **Files** | `src/workflows/c-06-crs-results-router.mjs` |
| **Work** | **M** + compliance input |

#### B3. Contract chaser — code ready, schedule needs Inngest

| | |
|--|--|
| **What exists** | `contract-chaser` cron `0 10 * * *`; manual `POST /api/contracts { action: "run_reminders" }`. |
| **What's missing** | Auto run needs Inngest live (B1) + outbound (A1). |
| **Files** | `src/workflows/contract-chaser.mjs`, `api/contracts.mjs` |
| **Work** | **M** (depends on A1/B1) |

#### B4. Dead-letter queue — retry script, not scheduled

| | |
|--|--|
| **What exists** | `src/events/dead-letter.mjs` (`retryDue`); `scripts/drain-dead-letters.mjs`. |
| **What's missing** | Not in `netlify.toml` schedules; nothing calls it in production. Failed handlers stay pending. |
| **Files** | `scripts/drain-dead-letters.mjs`, `src/events/dead-letter.mjs` |
| **Work** | **S** |

#### B5. Workflows never migrated from the CRM (documented gaps)

| | |
|--|--|
| **What exists** | Migration table documents missing N-07, BC-03, CT-00..03, AI agent layer, BS-01 task/ad enrollment gaps. |
| **What's missing** | Whole workflows, not half-built ones. |
| **Files** | docs referring to `workflow-migration-table` / CRM cutover notes |
| **Work** | **L** each |

---

### C. Money, billing, credit

#### C1. Sales / funding rounds — almost no production writers

| | |
|--|--|
| **What exists** | Tables; readers in affiliates/economics, commissions SQL helpers, workflows that **UPDATE** / **SELECT** `funding_rounds`; payment handlers write `transactions` + client flags (`src/handlers/client-lifecycle.mjs`). |
| **What's missing** | No production `INSERT INTO sales` or `INSERT INTO funding_rounds` outside tests. Lendflow webhook can emit round events, but rounds themselves are not created by app writers found in `src/`. Commission and entitlement chains have nothing solid to hang on. |
| **Files** | `src/handlers/client-lifecycle.mjs`, `src/adapters/lendflow.mjs`, `src/affiliates/economics.mjs`, workflows under `src/workflows/f-*.mjs` |
| **Work** | **L** |

#### C2. Commission ledger — calculator only

| | |
|--|--|
| **What exists** | Pure calculator (`src/commissions/calculate.mjs`) produces ledger **drafts**. `SQL_INSERT_LEDGER` string in `sql.mjs`. Products/commissions UI reads rates. |
| **What's missing** | No production caller that runs `INSERT INTO commission_ledger`. Header: “Writing them is somebody else's job.” |
| **Files** | `src/commissions/calculate.mjs`, `src/commissions/sql.mjs`, `src/commissions/index.mjs` |
| **Work** | **L** (wire on sale/funding events) |

#### C3. Entitlements — `grant()` never called from handlers

| | |
|--|--|
| **What exists** | `src/entitlements/entitlements.mjs` (`grant`, revoke, list); `GET /api/read/entitlements`; client portal reads entitlements. |
| **What's missing** | No handler/workflow imports `grant()` in production. Portal shows empty unless seeded/tests. |
| **Files** | `src/entitlements/entitlements.mjs`, `api/read/entitlements.mjs`, `public/app/client-portal.html` |
| **Work** | **M–L** |

#### C4. Subscriptions — plan management without charging

| | |
|--|--|
| **What exists** | Store + HTTP + `subscriptions.html` for start/change/cancel/cards. |
| **What's missing** | Explicitly no processor, no scheduler, no charge run (`src/subscriptions/store.mjs` header). |
| **Files** | `src/subscriptions/store.mjs`, `api/finance/subscriptions.mjs`, `api/finance/cards.mjs` |
| **Work** | **L** (compliance-flagged if built) |

#### C5. Payment links — URL + queue, not a full checkout loop

| | |
|--|--|
| **What exists** | Builds Commas checkout URL; `action:"send"` queues SMS via `sendTemplated`; webhook can `markPaid`. |
| **What's missing** | No Commas API create-session call; SMS depends on A1; confirm live URL shape. |
| **Files** | `src/payment-links/index.mjs`, `api/payment-links.mjs`, `src/adapters/commas.mjs`, `src/handlers/payment-links.mjs` |
| **Work** | **M** |

#### C6. Soft pulls — request queue only

| | |
|--|--|
| **What exists** | `requestSoftPull()` writes `soft_pull_requests` queued; consent gate; finance-os button; `fulfilSoftPull` / `recordPull` / `ingestCrsResult` implemented and tested. |
| **What's missing** | No bureau provider / outbound pull. No production caller of `fulfilSoftPull` / `recordPull`. Automated CRS insert path does not call `ingestCrsResult` for tradelines. |
| **Files** | `src/finance/soft-pulls.mjs`, `api/finance/soft-pull.mjs`, `src/tradelines/store.mjs`, `src/handlers/client-lifecycle.mjs` |
| **Work** | **L** |

#### C7. Plaid bank link — configured ≠ implemented

| | |
|--|--|
| **What exists** | Token encrypt/decrypt, env checks, mock provider sync works; finance-os calls sync with `provider: "mock"`. |
| **What's missing** | `linkAccount` / `getAccounts` return `not_implemented` when Plaid env is set (`src/banking/plaid.mjs`). Needs real HTTP client + consent + SOC 2 sign-off. |
| **Files** | `src/banking/plaid.mjs`, `src/banking/provider.mjs`, `api/banking/sync-accounts.mjs` |
| **Work** | **L** |

#### C8. Finance “501 stubs” — comments stale, handlers live

| | |
|--|--|
| **What exists** | Eight `/api/finance/*` routes fully implemented (subscriptions, cards, liabilities, bank-accounts, entities, bills, alerts, model). Zero handlers return HTTP 501. |
| **What's missing** | Stale headers in `api.mjs` / finance files / `data.js` still describe 501 scaffolding. |
| **Files** | `netlify/functions/api.mjs` (~385), `api/finance/*.mjs`, `public/app/data.js` (~270) |
| **Work** | **S** (docs only — not a product gap) |

---

### D. Hiring, creative, social, brand

#### D1. Hiring — live reads, no write API or UI actions

| | |
|--|--|
| **What exists** | Full store: apply/score/advance/reject/interviews (`src/hiring/pipeline.mjs`), LinkedIn post/close/ingest (`src/hiring/linkedin.mjs`), bench checks. Six GET endpoints. Screen reads them live. |
| **What's missing** | All six `api/hiring/*` are GET-only. UI cannot advance, reject, post a job, or score — only display. Writers exist but nothing HTTP-exposes them. |
| **Files** | `src/hiring/*`, `api/hiring/*`, `public/app/hiring.html` |
| **Work** | **L** |

#### D2. Creative Factory — live library reads, no generate path

| | |
|--|--|
| **What exists** | Job state machine `src/creative/generate.mjs` (`enqueue`/`claim`/`run`); four GET APIs; screen reads them. Screen honestly says no write path. |
| **What's missing** | No POST routes (405 via `partnerReadHandler`). Nothing calls `enqueue`/`claim`/`run` outside tests. `creative_providers` not seeded — `resolve()` throws if empty. Brand Studio BS-06 “Coming soon”. |
| **Files** | `src/creative/generate.mjs`, `src/creative/providers/index.mjs`, `api/creative/*`, `public/app/creative-factory.html`, `public/app/brand-studio.html` |
| **Work** | **L** |

#### D3. Social Studio — schedule/publish engine, Queue button dead

| | |
|--|--|
| **What exists** | `src/social/scheduler.mjs` (`schedule`, `publishDue`); tables; action-log read wired on screen. |
| **What's missing** | No HTTP for schedule/publish. “Queue post” button disabled: “No endpoint exists.” No cron calling `publishDue`. Channel adapters only registered in tests. |
| **Files** | `src/social/scheduler.mjs`, `public/app/social-studio.html`, `db/migrations/049_social.sql` |
| **Work** | **L** |

---

### E. Screens that are simulation / no backend

#### E1. Content admin — in-memory only

| | |
|--|--|
| **What exists** | Full UI for videos/tiers/tiles; honest banner. |
| **What's missing** | No `api/content/*`, no tables, upload does not persist, reload clears edits. |
| **Files** | `public/app/content-admin.html` |
| **Work** | **L** |

#### E2. Galaxy / partner-galaxy — simulated canvas

| | |
|--|--|
| **What exists** | `galaxy.html` fully simulated with honest banner. `partner-galaxy.html` live partner census in banner only; canvas still sample. |
| **What's missing** | Presence feed, handoff stream, money-movement feed. |
| **Files** | `public/app/galaxy.html`, `public/app/partner-galaxy.html` |
| **Work** | **L** |

#### E3. Staff Teams clock — UI lies locally; real API unused

| | |
|--|--|
| **What exists** | `/api/shifts` clock_in/clock_out fully built and tested. Staff roster reads live staff list. |
| **What's missing** | Clock tab toggles in-memory `p.clock` only — never calls `/api/shifts`. Screen notes clock has “NO SOURCE”. `autoCloseStale()` has no scheduler. |
| **Files** | `public/app/staff-teams.html`, `api/shifts.mjs`, `src/shifts/store.mjs` |
| **Work** | **M** (wire UI); **S** (schedule auto-close) |

#### E4. Built APIs with no screen

| Endpoint | Missing | Work |
|----------|---------|------|
| `POST /api/privacy/erasure` | Owner/admin erase UI | **M** |
| `POST /api/banking/revoke` | Disconnect-bank UI (+ optional Plaid item remove) | **M** |
| `GET/POST /api/finance/cashflow` | Screen (or fold into finance-os) | **M** |
| `GET/POST /api/banking/accounts` | Callers (hand entry already on `finance/bank-accounts`) | **S–M** |
| `GET /api/read/invoices` | Any screen (`FHData.invoices()` unused) | **S–M** |
| `GET /api/read/funding-rounds` | Any screen | **S–M** |
| `GET /api/read/finance-os`, `read/banking-surface` | Superseded by money-map — remove or alias | **S** |

---

### F. Env / flag gates (reachable code, off by default)

| Gate | Default | Effect |
|------|---------|--------|
| `INNGEST_EVENT_KEY` | unset | All 49 Inngest functions inert; bus bridge no-op |
| `INNGEST_SIGNING_KEY` | unset | Inngest cannot securely invoke serve handler |
| `messaging_settings.outbound_enabled` | per-org | Outbox drain refuses |
| Mailgun / CRM / Twilio send env | unset | Dispatch cannot transmit |
| `DEMO_LOGINS_ENABLED` | unset | Seeded demo principals cannot log in |
| `BANKING_MOCK_PROVIDER` | unset | Mock sync refuses |
| `BANKING_PROVIDER` | `mock` | Real Plaid needs credentials + seam close |
| `creative_providers` rows | none seeded | Generate throws |
| Twilio provider `ENABLED` | `false` | Built; waiting A2P; routing still the CRM by default |

---

## Intentionally unfinished (owner-gated — not bugs)

These are wired seams that **must not** be closed by an agent without an
owner decision:

- Direct mail drop (`src/mail/`) — FCRA / Deluxe / counsel gate.
- Plaid live link — SOC 2 + consent.
- Subscription charging — compliance-flagged fee timing.
- Turning on `INNGEST_EVENT_KEY` — brings 49 workflows live.
- Draining the historic workflow message backlog in one pass.

---

## Priority matrix

| Priority | Finding | Effort |
|----------|---------|--------|
| P0 | A1 Outbound for workflows (keys + credentials + drain policy) | M |
| P0 | B1 Set Inngest keys when ready to go live | S config |
| P1 | C1–C3 Sales → funding → commissions → entitlements writers | L |
| P1 | B2 CRS hard-decline signal map | M |
| P1 | B4 Schedule dead-letter drain | S |
| P1 | E3 Wire staff clock UI to `/api/shifts` + autoCloseStale | M |
| P2 | C6 Soft-pull bureau + fulfil path | L |
| P2 | C7 Plaid HTTP seams | L |
| P2 | D1–D3 Hiring writes, creative generate, social publish HTTP | L each |
| P2 | C4 Subscription billing (if product wants it) | L |
| P3 | E1–E2 Content admin / galaxy backends | L |
| P3 | E4 Dead-endpoint UI or deletion | S–M |
| P3 | Doc drift (501 comments, “47 functions”, sweeper “unregistered”) | S |

---

## What is *not* unfinished (common false alarms)

- Hiring / creative / social **reads** after `e32f577` — wired.
- Staff reply inbox send path (`compose` → immediate dispatch) — built; needs credentials.
- Finance write endpoints formerly described as 501 — implemented.
- `/api/inngest` routing — fixed.
- Mock bank sync — works when `BANKING_MOCK_PROVIDER` allows it.
- Quiet-hours `OUTCOME.DEFERRED` — implemented hold, not a missing feature.

---

## Left unchecked (would need live env)

- Whether Mailgun/CRM credentials are present in Netlify production.
- Whether `outbound_enabled` is true for any org.
- Whether any `sales` / `funding_rounds` rows exist from historical imports.
- Webhook stream / Commas double-count items from older AUDIT-FINDINGS (not re-proven here).

---

*End of audit.*
