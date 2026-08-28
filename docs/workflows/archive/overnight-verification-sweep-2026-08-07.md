# overnight-verification-sweep-2026-08-07

Owner asleep. Goal: honest morning verdict — can this take live calls?

## Hard rules followed

- `MESSAGING_DRY_RUN` + `ADAPTERS_DRY_RUN` forced TRUE for verify + probes
- Only local `127.0.0.1/fundhub_verify` — never production
- Commits on branch `overnight/verification-sweep-2026-08-07` only (not main)
- Two-attempt stop respected on polluted pg suite (logged OPEN)

## Baseline

| Check | Result |
|-------|--------|
| Migrations through 155 on local verify | yes (synced 142–155; renames marked) |
| `npm run lint` | **PASS** (999 files) |
| `npm run test:e2e` | **196 passed** |
| `npm run verify:e2e` | **374 PASS / 0 FAIL / 31 UNVERIFIED** |
| `npm test` (first run, superuser URL) | 4620 pass / **3 fail** |
| After fixes + `ALLOW_SUPERUSER_DB=1` unit half | **4622 pass / 0 fail** |
| `npm test` as `fundhub_app` | 117 fail — expected; many `.pg.test` need owner ops |
| Shared-DB pg residual after verify pollution | **56 fail** (hook/setup; see OPEN) |

Original 3 fails: stale diagrams (fixed), raw `INSERT INTO tasks` in inquiry gate (fixed), superuser guard (local URL was owner — use `fundhub_app` or `ALLOW_SUPERUSER_DB=1`).

## Route audit

- `api/` handlers vs `ROUTES`: **0 orphans**, **0 ROUTES without files** (`routes.test.mjs` 15/15)
- Unauthenticated probe of all **135** ROUTES handlers: **0 returned 500** (401/403/400/404 only)
- Webhook router providers: commas, clickfunnels, bland, calcom, lendflow, inquiry-removal, twilio, twilio-status, mailgun, mailgun-events, **postgrid**
- Adapters **not** on webhook router (called elsewhere): `crs.mjs` (workflows), `hubstaff.mjs` (shift ingest), `oxylabs.mjs` (proxy launch)
- No second “lendflow-style” unregistered webhook adapter found

## Journey walk

- `npm run journeys` + `journeys:check`: actual files regenerate clean
- All `*-intended.md` still marked **WRITTEN AFTER THE FACT** (copied from actual historically)
- Intended vs actual **section format diverged** (category bullets vs open/secret/signed lists) — not a machine-clean permission diff; treat as **doc debt**, not a live permission matrix failure
- Security journey in verify: role isolation **PASS**

## Screen walk (Playwright, 5 roles × all `public/app/*.html` + mobile samples)

- **210 checks: 202 PASS / 8 FAIL**
- 8 fails were `visible_undefined`:
  - **client-control-panel**: real — banner showed `live record · undefined · …` when client name/id missing → **fixed** (`unknown client`)
  - **creative-factory**: **false positive** — page docs mention the word “undefined”
- Client portal STATE toggle: **not** visible to client role (after earlier fix)
- Mobile 390px key screens: no horizontal overflow flagged
- Full suite e2e already covers role smoke + security UI

Screenshots: `/tmp/overnight-screens/` (210 files)

## Money path (`verify:e2e` funding journey)

Operator: **YES for money spine** (dry-run). deposit → sale → entitlement → round.started → funded → closeout 10% — **PASS**. Messages queued only (not transmitted). DRAFT templates still blocked.

## Inquiry gate

Unit/pg core: deposit.paid / round.closeout register, one case per bureau, **idempotent re-fire**, weekend/business-day `call_due_at`, doc packet gates, TU-blocked still matches EQ lenders — **PASS**.

OPEN: `src/inquiry-ops/send.pg.test.mjs` wipe tries to **DELETE documents** (DB forbids) — harness issue on polluted DB, not product send-gate logic. sendCase unit tests for doc/portal gates **PASS**.

UNVERIFIED: `inquiry.gate.raised` / `inquiry.gate.clear` / `inquiry.docs.needed` have **no workflow listeners** (bus handlers may still exist).

## Adversarial (`verify:e2e`)

HMAC refuse/accept, zero/malformed amounts, opt-out, unicode names, expired links, tampered contract, cross-org isolation — **PASS**. Quiet-hours hold/release **UNVERIFIED**.

## OPEN

1. **Shared `fundhub_verify` pollution** — after many verify runs, ~56 `.pg.test` hooks fail (commission_rules overlap, document non-delete). Attempt 1: re-run with `ALLOW_SUPERUSER_DB`. Attempt 2: would need fresh DB wipe — **stopped**. Not code defects proven.
2. **Journey intended docs** — format/stale post-facto copies; agents must not rewrite intended.
3. **Canonical events without workflow listeners** — including `round.closeout`, `sale.closed`, inquiry.gate.* (handlers may cover some).
4. **INNGEST_EVENT_KEY** — live event→workflow fan-out off until owner turns it on.
5. **DRAFT message templates** — DS-02 letters-ready email will not send until rewritten.
6. **Agent live replies** — verify verdict NO without `ANTHROPIC_API_KEY`.

## Fixes + commits

| Hash | What |
|------|------|
| `0923f88` | Portal funding suppress + pay honesty + STATE/Included UX; gate→createTask; diagrams sync; CCP unknown-client banner; e2e gates; workflow boards |

Branch: `overnight/verification-sweep-2026-08-07` (not merged to main).

## Untested (credential-gated)

| Credential | Path blocked |
|------------|--------------|
| `POSTGRID_API_KEY` (+ webhook secret) | Real letter mail send / delivery webhook clock |
| `TWILIO_*` send + auth | Live SMS / voice status |
| `LENDFLOW_API_KEY` + webhook secret | Live lender submit + round webhooks from Lendflow |
| `GHL_API_KEY` / `GHL_RELAY_*` / location | GHL contact sync + SMS relay |
| `OXYLABS_*` | Proxy apply residential sessions |
| `CLICKFUNNELS_WEBHOOK_SECRET` | Live funnel ingress authenticity in prod |
| `COMMAS_WEBHOOK_SECRET` (+ checkout base) | Live payment webhooks / checkout links |
| `BLAND_WEBHOOK_SECRET` | Live voice agent callbacks |
| `CALCOM_WEBHOOK_SECRET` | Live booking webhooks |
| `HUBSTAFF_PAT` / org | Live monitoring ingest |
| `MAILGUN_SEND_*` / signing | Live email transmit |
| `ANTHROPIC_API_KEY` | Live client-facing agent replies |
| `INNGEST_EVENT_KEY` | Live scheduling of 47 workflows |
| Outbound company switch | Even with keys, queued messages may not leave |

Do **not** guess whether these work. They were not live-exercised (dry-run held).
