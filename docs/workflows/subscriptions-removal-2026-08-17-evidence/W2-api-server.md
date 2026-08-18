# W2 — Server-side subscriptions inventory

Read-only investigation. Nothing was edited. This file is an inventory only; it
recommends no deletion and flags nothing for edit.

Date: 2026-08-17
Scope searched: `src/`, `api/`, `netlify/functions/`, `db/schema/`, `db/migrations/`,
`db/seed/`, `src/workflows/`, `src/handlers/`, `src/lib/`, plus `scripts/` and `e2e/`
for callers. Excluded `node_modules/` and `vendor/`.
Terms: subscription, subscriptions, subscription_plan, billing, recurring, plan,
dunning, tier, and variants.

---

## Headline findings

1. **Four handler files** are in scope. One is the subscriptions endpoint proper;
   one is its card sibling that writes the `subscriptions` table; two only borrow
   a price-formatting helper.
2. **No route/handler mismatch exists.** All four handlers are present in the
   `ROUTES` map. `ALLOWED_UNROUTED` in `src/http/routes.test.mjs:71` is the empty
   object `{}`, so the routing test already forbids an unrouted handler anywhere
   under `api/`. Verified at runtime: `ROUTES` has 167 keys and contains all four.
3. **Zero background jobs.** No workflow, Inngest function, cron, or sweeper
   anywhere touches subscriptions. There is no billing run, no dunning, no
   renewal sweep. The subscriptions table is written only by live HTTP requests
   and by the demo seeder.
4. **Nothing transmits.** `api/finance/subscriptions.mjs:15` states it directly and
   the code matches: no processor call, no scheduler, no outbound `fetch` behind
   any of this. Starting a subscription records a row.
5. **`src/lib/` and `src/commissions/` contain no subscription code.** The only
   shared dependency going the other way is `src/commissions/money.mjs`, which
   subscriptions consumes.

---

## 1. API handler files

### 1a. `api/finance/subscriptions.mjs` — the primary handler
Full path: `/Users/zootimusmaximus/fundhub-platform/api/finance/subscriptions.mjs`

| | |
|---|---|
| Role gate | `ROLE_SETS.FINANCE` = {owner, admin}, set at line 55, enforced line 126 |
| Org scoping | `staff.org_id` only; body `org_id`/`orgId` rejected 400 (lines 60, 169-173) |
| Ownership | `ownsClient()` at line 358 — checks `clients.org_id` |
| Default export | `handler(req, res)` at line 119 |

Imports (lines 39-48): `src/db.mjs`, `src/http/middleware/requireAuth.mjs`,
`src/http/read-api.mjs`, `src/subscriptions/store.mjs`, `src/subscriptions/index.mjs`,
`src/http/db-down.mjs`.

Local helpers: `readPriceCents()` line 86, `withPrice()` line 114, `ownsClient()` line 358.

### 1b. `api/finance/cards.mjs` — writes the `subscriptions` table
Full path: `/Users/zootimusmaximus/fundhub-platform/api/finance/cards.mjs`

Carries a `COMPLIANCE REVIEW REQUIRED` marker in its own header at line 24 for the
`action:"add"` case (accepts a processor token, never a card number).

Coupled to subscriptions two ways:
- `action: "attach"` (line 235) calls `attachCard()`, which runs
  `UPDATE subscriptions s ...` (`src/subscriptions/store.mjs:400`). It returns the
  updated subscription row: `res.status(200).json({ ok: true, action: "attach", subscription: sub })`
  at line 267.
- Shares the same front-end screen. Line 73: it shares `subscriptions.html`.

Imports from subscriptions modules at lines 69-70:
`putClientCard`, `listClientCards`, `removeClientCard`, `attachCard` (and siblings) from
`src/subscriptions/store.mjs`; `assertNoCardData` from `src/subscriptions/index.mjs`.

### 1c. `api/payment-links.mjs` — shared-helper dependency only
Full path: `/Users/zootimusmaximus/fundhub-platform/api/payment-links.mjs`

Line 31: `import { priceToCents, assertPriceCents, formatPrice } from "../src/subscriptions/index.mjs";`

That is the entire coupling. It owns its own `payment_links` table and does not
read or write `subscriptions`. Its header (lines 9-10) says it is the same class
of action as starting a plan and shares the same `ROLE_SETS.FINANCE` gate.
Line 40-41 cross-references `api/finance/subscriptions.mjs readPriceCents`.

**Consequence for a later deletion step:** removing `src/subscriptions/index.mjs`
would break this handler, which is unrelated to the Subscriptions screen.

### 1d. `api/finance/soft-pull.mjs` — carries an opaque `subscription_id`
Full path: `/Users/zootimusmaximus/fundhub-platform/api/finance/soft-pull.mjs`

- Line 3: request body accepts `subscription_id?`
- Line 110: comment — "W2 owns subscriptions. This endpoint takes the id as an opaque value"
- Line 112: `subscriptionId: isUuid(body.subscription_id) ? String(body.subscription_id).trim() : null`

It never joins to the `subscriptions` table. The value lands in
`soft_pull_requests.subscription_id`, a column that deliberately carries **no
foreign key** (`db/migrations/077_soft_pull_requests.sql:73`).

### 1e. Checked and NOT in scope
- `api/read/finance-os.mjs:6` — a comment saying subscriptions are a separate build. Serves no subscription data.
- `src/finance/os-grid.mjs:12` — comment: "no bank data, no liabilities, no subscriptions."
- `api/finance/bills.mjs:361`, `api/finance/alerts.mjs:83` and `:659` — comments only, cross-referencing the subscriptions handler's money conventions.
- `api/read/money-map.mjs` — matched on `recurring_bills`, unrelated to subscriptions.

---

## 2. ROUTES map (`netlify/functions/api.mjs`)

Full path: `/Users/zootimusmaximus/fundhub-platform/netlify/functions/api.mjs`
`ROUTES` is declared at line 209 and exported. Key = path minus leading `/api/` (line 206).

| ROUTES line | Key | Import line | Handler file |
|---|---|---|---|
| 615 | `"finance/subscriptions"` | 161 | `api/finance/subscriptions.mjs` |
| 616 | `"finance/cards"` | 162 | `api/finance/cards.mjs` |
| 675 | `"payment-links"` | 176 | `api/payment-links.mjs` |
| 545 | `"finance/soft-pull"` | 158 | `api/finance/soft-pull.mjs` |

Explanatory comments that name subscriptions: line 572 (the "Finance OS write
surface" block listing `subscriptions/store` among twelve previously-unreachable
modules), line 604 (role gates), lines 669-673 (payment-links gate rationale).

### Mismatch check — result: NONE

- **Handler with no route:** none. Verified at runtime by importing the module and
  enumerating `Object.keys(ROUTES)` (167 keys); all four keys above are present.
- **Route with no handler:** none. Each key resolves to a real imported module; the
  import would have thrown on a missing file.
- **Structural guarantee:** `src/http/routes.test.mjs` walks `api/` on disk and fails
  if a handler is neither routed nor on `ALLOWED_UNROUTED`. That object is empty
  (`src/http/routes.test.mjs:71`), so today *every* handler under `api/` is routed.
  Two further tests keep the list honest (lines 122, 135).

**Warning for the later deletion step.** This cuts both ways. Deleting a handler
file without deleting its `ROUTES` entry breaks the import and 502s the entire
`/api/*` function — all of it, login included, because one Netlify function serves
every path (`config.path = "/api/*"`, line 204). Deleting a `ROUTES` entry without
the handler makes `routes.test.mjs` fail. The two must move together.

---

## 3. Endpoint contracts (exact paths and methods)

For front-end cross-referencing.

### `/api/finance/subscriptions`
| Method | Shape | Handler line |
|---|---|---|
| `GET` | `?client_id=<uuid>` → `{ ok, client_id, current, history }` | 137-165 |
| `POST` | `{ action: "start", client_id, tier, price\|price_cents, currency?, provider?, card_id?, period_start?, period_end?, at?, notes? }` | 184-210 |
| `POST` | `{ action: "change", client_id, tier, price\|price_cents, currency?, period_start?, period_end?, at?, notes? }` | 212-249 |
| `POST` | `{ action: "cancel", client_id, at?, ends_at? }` | 251-275 |
| any other | 405, `allow: GET, POST` | 282-283 |

Status codes: 400 invalid_action / bad price / `org_id_not_accepted`; 403 `org_required`
and `forbidden`; 404 "no subscription to cancel"; 409 conflict (lines 287, 329);
503 db down (line 349).

### `/api/finance/cards`
| Method | Shape | Handler line |
|---|---|---|
| `GET` | `?client_id=<uuid>[&include_removed=1]` → `{ ok, cards }` | 128 |
| `POST` | `{ action: "add", client_id, provider_token, brand?, last4?, exp_month?, exp_year?, provider? }` | 189 |
| `POST` | `{ action: "attach", client_id, card_id }` → returns `{ subscription }` | 235 |
| `POST` | `{ action: "remove", client_id, card_id }` | 270 |
| any other | 405, `allow: GET, POST` | 305 |

### `/api/payment-links`
| Method | Shape | Handler line |
|---|---|---|
| `GET` | `?client_id=<uuid>` | 83 |
| `POST` | `{ action: "create", client_id, purpose, description?, price\|price_cents }` | 103 |
| `POST` | `{ action: "send", id }` | 132 |
| `POST` | `{ action: "expire", id }` | 132 |
| any other | 405, `allow: GET, POST` | 189 |

### `/api/finance/soft-pull`
| Method | Shape |
|---|---|
| `POST` | `{ client_id, reason, cost_cents?, subscription_id?, idempotency_key? }` |

---

## 4. Database objects

`db/schema/` and `db/seed/` contain **no** subscription references. Everything is in
`db/migrations/`. Per CLAUDE.md §12 an applied migration must never be edited —
this is an inventory, and nothing here is flagged for edit.

### `db/migrations/075_subscriptions.sql` — the main migration
- Table `subscriptions`, line 102. Columns: `id`, `org_id`, `client_id`, `tier`,
  `status` (`active`/`past_due`/`cancelled`), `price_cents` (bigint, NULL = not
  recorded, not zero), `currency`, `card_id`, `provider` (default `'commas'`),
  `provider_ref`, `current_period_start`, `current_period_end`, `cancelled_at`,
  `effective_from`, `effective_to`, `notes`, `created_at`, `updated_at`.
- Constraints: `subscriptions_window` (165), `subscriptions_period` (171),
  `subscriptions_cancel_coherent` (180), `subscriptions_no_overlap`
  EXCLUDE USING gist (237).
- Indexes: `subscriptions_client_idx` (187), `subscriptions_live_idx` (190),
  `subscriptions_card_idx` (194), `subscriptions_provider_ref_uq` UNIQUE (211).
- Function `subscriptions_terms_immutable()` (266).
- Triggers `trg_subscriptions_terms_immutable` (289), `trg_subscriptions_updated` (295).

### `db/migrations/076_client_cards.sql`
- Table `client_cards`, line 95. Columns: `id`, `org_id`, `client_id`, `provider`,
  `provider_token`, `brand`, `last4`, `exp_month`, `exp_year`, `removed_at`,
  `created_at`, `updated_at`.
- Constraints `client_cards_last4_shape` (133), `client_cards_token_not_pan` (140),
  `client_cards_expiry` (146).
- Indexes `client_cards_token_uq` (165), `client_cards_client_idx` (169),
  `client_cards_id_client_uq` (184). Trigger `trg_client_cards_updated` (188).
- **Line 208: `ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_card_fk`** —
  a composite FK `(card_id, client_id)`. A cross-migration dependency: 076 modifies
  the table 075 created.

### `db/migrations/077_soft_pull_requests.sql`
- Column `subscription_id uuid` on `soft_pull_requests`, line 145.
- Line 73: explicit note that it carries **no** foreign key, on purpose.
- `COMMENT ON COLUMN` line 227; immutability trigger references it at line 245.

### `db/migrations/153_demo_ui_coverage.sql`
- Line 4: `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;`
- Line 7: same for `client_cards`.
- Line 18: `CREATE INDEX subscriptions_is_demo_idx ON subscriptions (org_id) WHERE is_demo;`

### `db/expected-migrations.mjs`
- Line 60: `"migrations/075_subscriptions.sql"`
- Line 61: `"migrations/076_client_cards.sql"`

### No row-level security
No `CREATE POLICY`, `ENABLE ROW LEVEL SECURITY`, or `GRANT` anywhere in
`db/migrations/` names `subscriptions` or `client_cards`. Isolation on these tables
rests entirely on the `org_id` filters in `src/subscriptions/store.mjs` and the
`ownsClient()` checks in the two handlers.

---

## 5. Background jobs and workflows — none

Searched all 117 files in `src/workflows/` for subscription, dunning, billing,
recurring, plan.

**Result: zero functional references.** The single hit is a passing comment:
`src/workflows/c-00-crs-soft-pull-request.mjs:91` — "up in a billing report nobody
checks." Not a subscription code path.

There is no defined-but-inert subscription workflow either. Nothing exists to
register.

### Inngest
- `api/inngest.mjs` serves `/api/inngest`; registration is `functions` imported from
  `src/workflows/index.mjs` (line 23), served via `serveEdge` (line 27).
- Routed at `netlify/functions/api.mjs:800` (`if (path === "inngest")`), import line 173.
- **No Inngest function references subscriptions.** The 47 workflow functions remain
  gated behind `INNGEST_EVENT_KEY` (a CLAUDE.md §11 owner-approval switch).

### Netlify scheduled functions (`netlify.toml` lines 55-73)
`staff-message-sweeper` (*/5), `social-publish-sweeper` (*/5), `creative-job-runner`
(*/2), `hubstaff-poll-sweeper` (*/10), `commas-inbox-sweeper` (* * * * *).

None reference subscriptions. `commas-inbox-sweeper` is the closest — Commas is the
payment provider named in the `subscriptions.provider` default — but the sweeper
itself contains no subscription reference. `src/adapters/commas.mjs` mentions
subscription events only in a parser comment (line 65) and reads `d.billing.email`
(line 137) off an inbound payload.

**Summary: no billing run, no renewal job, no dunning process, no expiry sweep
exists anywhere in this repository.**

---

## 6. Shared library functions

### `src/subscriptions/index.mjs` — pure helpers, no database
Full path: `/Users/zootimusmaximus/fundhub-platform/src/subscriptions/index.mjs`

| Line | Export |
|---|---|
| 51 | `looksLikeCardNumber(value)` |
| 62 | `assertNoCardData(input, where)` |
| 123 | `normalizeCardMeta(input)` |
| 168 | `priceToCents(value)` — null-preserving, unlike `money.toCents()` |
| 175 | `formatPrice(cents)` |
| 184 | `assertPriceCents(value, where)` |
| 215 | `isLiveAt(row, at)` |
| 245 | `planChange(current, next, at)` |

Non-exported: `readExpMonth` (73), `readExpYear` (87), `readLast4` (105), `asTime` (197).

### `src/subscriptions/store.mjs` — the database layer
Full path: `/Users/zootimusmaximus/fundhub-platform/src/subscriptions/store.mjs`

| Line | Export | Tables touched |
|---|---|---|
| 44 | `class SubscriptionConflictError` (carries its own 409 status) | — |
| 87 | `putClientCard` | `client_cards` (INSERT ... ON CONFLICT, 93) |
| 119 | `listClientCards` | `client_cards` (SELECT, 123) |
| 141 | `removeClientCard` | `client_cards` (UPDATE, 145) |
| 172 | `startSubscription` | `subscriptions` (INSERT, 185) |
| 222 | `getSubscriptionAt` | `subscriptions` (SELECT, 226) |
| 239 | `listSubscriptions` | `subscriptions` (SELECT, 243) |
| 275 | `changeTier` | `subscriptions` (UPDATE + INSERT in one CTE, 289/294) |
| 355 | `cancelSubscription` | `subscriptions` (UPDATE + SELECT CTE, 362/369) |
| 395 | `attachCard` | `subscriptions` JOIN `client_cards` (UPDATE, 400-402) |

Internal: `SUB_COLUMNS` const (52), `required()` (57). Imports
`normalizeCardMeta, assertPriceCents, planChange` from `./index.mjs` (line 22).

### What subscription code calls OUT to
- `src/commissions/money.mjs` — `toCents`, `fromCents` (`src/subscriptions/index.mjs:24`).
  This is the only `src/commissions/` dependency. It is one-directional:
  `money.mjs` knows nothing about subscriptions.
- `src/db.mjs`, `src/http/middleware/requireAuth.mjs`, `src/http/read-api.mjs`
  (`ROLE_SETS`, `requireRole`, `isUuid`, `CLIENT_DATA_ERRORS`), `src/http/db-down.mjs`
  — all from the two handlers.

### What calls IN to subscription modules (the deletion blast radius)
| Caller | Line | Imports |
|---|---|---|
| `api/finance/subscriptions.mjs` | 46, 47 | store + index |
| `api/finance/cards.mjs` | 69, 70 | store + `assertNoCardData` |
| `api/payment-links.mjs` | 31 | `priceToCents`, `assertPriceCents`, `formatPrice` |
| `src/sales/closer-deck.mjs` | 7 | `formatPrice` |

`src/sales/closer-deck.mjs` and `api/payment-links.mjs` are **outside** the
Subscriptions feature. Both would break if `src/subscriptions/index.mjs` were
removed wholesale.

### `src/lib/` — nothing
No subscription, billing, or dunning code. The only "dunning" hits repo-wide are
two markdown files: `src/commissions/PROPOSED-EVENTS.md:130` and
`src/commissions/commission-model-open-questions.md:337`.

### `src/handlers/` — no directory by that name
The path named in the task does not exist. API handlers live in `api/`.

---

## 7. Other server-side references (non-handler)

### Demo seeding
- `src/demo/seed-ui-coverage.mjs` — `seedSubscriptions()` (151), `INSERT INTO subscriptions` (163), guard (167), call site (267)
- `src/demo/platform-seed.mjs` — counts (275, 318), `DELETE FROM subscriptions WHERE org_id=$1 AND is_demo` (378), `DELETE FROM subscriptions WHERE client_id=ANY($1)` (404)

### Tests (server-side)
- `src/http/subscriptions-endpoints.test.mjs`
- `src/http/subscriptions-endpoints.pg.test.mjs`
- `src/http/subscriptions-screen.test.mjs` — asserts against `public/app/subscriptions.html` (path resolved line 42); checks calls to `/api/finance/subscriptions` (lines 151, 210)
- `src/subscriptions/index.test.mjs`
- `src/subscriptions/store.pg.test.mjs`

Note per CLAUDE.md §12: `.pg.test.mjs` files skip entirely when `DATABASE_URL` is
unset, so a green local run proves nothing about the database-backed ones.

### Front-end coupling (context for the deletion, not server-side)
- `public/app/subscriptions.html` — the screen
- `public/app/shell.js` — lines 23, 54, 61, 119-120, 131, 384 (`"subscriptions.html": "client_id"`), 1763. Lines 119-120 tie the screen's `OWNER_ADMIN_ONLY` entry to the role gates on `/api/finance/subscriptions` and `/api/finance/cards`.
- `api/finance/subscriptions.mjs:53` warns that the `shell.js` `OWNER_ADMIN_ONLY` row must move with any change to `SUBSCRIPTION_ROLES`.
- E2E: `e2e/sidebar-roles.spec.mjs:37`, `e2e/screens-smoke.spec.mjs:24`, `e2e/crm-flows.spec.mjs:185`, `scripts/tmp-full-live-verify.mjs:107`

---

## 8. Gaps and cautions for the deciding step

1. **`api/finance/cards.mjs` is not separable by name.** It sounds like a cards
   feature but it writes the `subscriptions` table via `attachCard` and renders on
   `subscriptions.html`. Treating it as unrelated would leave a live endpoint
   writing an orphaned table.
2. **`src/subscriptions/index.mjs` has two outside consumers** (`api/payment-links.mjs`,
   `src/sales/closer-deck.mjs`). It is not exclusively subscription code.
3. **Handler and `ROUTES` entry must move together** — see the warning in section 2.
4. **`subscriptions_card_fk` lives in 076, not 075.** Any future DB work has to
   account for the constraint being defined in the client-cards migration.
5. **`soft_pull_requests.subscription_id` would become a dangling reference** if the
   table went. It has no FK, so the database will not complain — the column would
   silently hold ids pointing at nothing.
6. **No `docs/journeys/` entry was found for subscriptions** in this search; the
   journeys tracked in CLAUDE.md §4 are role- and client-based. Journey impact was
   not part of this task and has not been assessed.
