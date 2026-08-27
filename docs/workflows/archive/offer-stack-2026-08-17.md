# Offer stack — My Numbers + Sales Floor — 2026-08-17

Owner ask (verbatim intent):
1. My Numbers only counts funding calls. It should account for the full canonical offer stack.
2. Sales Floor has the same gap, and no way to scroll between closers to see individual numbers and performance. Add that.
3. Sales Floor Drive access — scope it, do not build it.

Standing GO on any endpoint the offer stack needs. No invented data.

## Task list

| ID | Task | Owner | Status |
|----|------|-------|--------|
| W1 | Offer stack data layer + both endpoints | main session | claimed |
| W2 | My Numbers screen renders the offer stack | agent | done |
| W3 | Sales Floor offer stack + closer scroller | agent | claimed |
| W4 | Drive access scoping report (no build) | agent | done |

---

## Ground brief — read this before you touch anything

### The gap, in one line
`src/sales/metrics.mjs` reads only `call_outcomes` (the closer's call disposition log),
`funding_rounds`, `funding_closeout`, `commission_ledger`, `staff_targets`, `shifts`,
`events` and `messages`. It **never reads `sales` or `products`.** So both screens show the
funding-call world only. The other four offers do not exist on screen.

### The canonical offer stack (source: `products` table, seeded by `db/migrations/015_seed_products.sql`)

| code | name | category |
|------|------|----------|
| `diagnostic` | $32 Diagnostic | diagnostic |
| `card-stacking-dfy` | Card Stacking DFY | funding |
| `consulting-package` | Consulting Services Package | consulting |
| `repair-bundle` | Credit Repair Bundle | repair |
| `inquiry-removal` | Inquiry Removal | inquiry_removal |

The stack is read **live from `products`**, not hardcoded. `products.active = false` is a retired
product — it still appears if it has sales in the period, otherwise it is dropped.
`products.sort_order` is the display order.

### Money rules (CLAUDE.md §12)
- Money is **integer cents** via `src/commissions/money.mjs`. `sales.agreed_price` and
  `sale_payments.amount` are `numeric(14,2)` **dollars** — convert at the boundary with `toCents`.
- **NULL means unknown and must survive.** Never default an unknown to 0.
- `sale_payments.kind = 'refund'` is stored POSITIVE and must be SUBTRACTED.

### Attribution — the honest limitation, read this
`sales` has **no closer column.** There is no `staff_id` on the table. The only way to tie a sale
to a closer is `commission_ledger.sale_id` -> `commission_ledger.staff_id`.

Consequence: a sale with no commission ledger row yet has **no closer**. Those sales are real
revenue but cannot be credited to a person. They are reported on the floor as `unattributed`
with a plain-English reason. This is why the floor total can be larger than the sum of the
closers. Do not hide that. Do not spread it across closers.

---

## W1 contract — the response shape W2 and W3 build against

Both endpoints gain an `offer_stack` object. Same shape in both places.

```jsonc
"offer_stack": {
  "available": true,           // false when the tables cannot be read
  "reason": null,              // plain-English string when available=false
  "period": { "start": "...", "end": "...", "label": "this month" },
  "items": [
    {
      "product_id": "uuid",
      "code": "card-stacking-dfy",
      "name": "Card Stacking DFY",
      "category": "funding",
      "sort_order": 20,
      "active": true,
      "units": 12,                    // active sales in period. Always a number.
      "sold_cents": 3600000,          // sum of agreed_price. null = unknown.
      "sold_display": "$36,000",      // null when sold_cents is null
      "collected_cents": 1200000,     // payments minus refunds. null = unknown.
      "collected_display": "$12,000",
      "refunded_cents": 0,
      "cancelled_units": 1,
      "refunded_units": 0
    }
    // ...one entry per product in the canonical stack, ALWAYS all of them,
    // even at zero. A zero row is the honest answer, not a missing row.
  ],
  "totals": {
    "units": 20,
    "sold_cents": 5000000, "sold_display": "$50,000",
    "collected_cents": 2000000, "collected_display": "$20,000",
    "refunded_cents": 0
  }
}
```

### `/api/read/my-numbers` — extra
`offer_stack` is scoped to that one closer, through `commission_ledger`.
Plus a sibling key:
```jsonc
"offer_stack_scope": {
  "basis": "commission_ledger",
  "note": "A sale only counts for a closer once it has a commission row."
}
```

### `/api/read/sales-floor` — extra
- `offer_stack` = whole floor, org-wide, every sale in the period regardless of attribution.
- `offer_stack_unattributed`: same `items`/`totals` shape, holding sales with **no** commission
  row, plus `"reason"` explaining it in plain English. `null` when there are none.
- **Each entry in the existing `closers[]` array gains:**
  - `offer_stack` — that closer's own stack, same shape as above (`items` + `totals`)
  - `deposits` — integer, already computed in the roster query, now returned

W3's scroller reads `closers[i].offer_stack` — **no second request, no new endpoint.**

### Null discipline for W2 and W3
When a `*_cents` is `null`, the endpoint sends a matching `*_reason` or the parent
`offer_stack.reason`. Show that sentence. Never render `$0` for an unknown. Never render a bare
dash with nothing next to it.

---

## Change manifests

_(each workflow appends its own below before reporting complete)_

### W2 — My Numbers screen renders the offer stack

**Files touched (only these two):**
- `public/app/my-numbers.html` — +22 lines. New `Offer stack` section placed directly under the
  cash/rank hero, above `This month`: a 4-column table (`Product` / `Units sold` / `Amount sold` /
  `Cash collected`) with `#stackBody`, a period note `#stackPeriod`, a scope note `#stackScope`,
  and the `.stack` / `.st-row` / `.st-msg` styles plus a 640px one-column rule. No existing markup
  changed, no existing style changed.
- `public/app/my-numbers.js` — +69 lines. `esc()`, `known()`, `why()`, `cash()`, `stackRow()`,
  `paintOfferStack(d)`, and one call to `paintOfferStack(d)` inside `paint()`. Nothing existing
  changed.

**Contract read:** `d.offer_stack` (`available`, `reason`, `period.label`, `items[]`, `totals`) and
`d.offer_stack_scope.note`. Exactly the W1 shape — no second request, no new endpoint.

**Null discipline:** a `*_cents` that is `null` renders the sentence — item-level `*_reason` first,
then `offer_stack.reason`, then `"Not known — no reason was given."`. Never `$0` for an unknown,
never a bare dash. A real `0` renders as `0` / `$0` on its own row; all five products always show.
`refunded_cents > 0` adds `after $X refunded` under the collected figure. `active:false` is
labelled `retired product`.

**States covered:** full stack · `offer_stack` absent (older endpoint) · `available:false`
(shows `reason`) · unknown collected on one row and on the totals row · 390px phone.

**Journeys:** none changed. No new route, no new step — `/api/read/my-numbers` was already a
closer-reachable read in `role-closer-intended.md` / `role-closer-actual.md`. No `-actual.md`
edit, no CHANGELOG line.

**Verified:** `npm run lint` clean (1295 files). `node --test src/http/closer-ui-honest.test.mjs
src/http/crm-html.test.mjs src/http/app-nav-reachability.test.mjs` — 66 pass, 0 fail. Playwright
screenshots (stubbed response in a scratch file, not committed) in
`docs/workflows/offer-stack-2026-08-17-evidence/my-numbers/`. `npx tsc --noEmit` is a no-op in this
repo — there is no `tsconfig.json`, so tsc prints its help text and checks nothing. Not yet seen
against a live deploy.

**Not done (deliberate):** `cancelled_units` and `refunded_units` are in the contract but are not
shown — the owner asked for units sold, amount sold, cash collected and a totals row.

### W4 — Drive access scoping report (report only, no build)

**Files touched:** `docs/workflows/sales-floor-drive-scope-2026-08-17.md` (new), this board row.
**Code changed:** none. **Endpoints added:** none. **Migrations:** none. **Journeys touched:** none.

**Headline: Drive access on the Sales Floor is already built and wired, front to back.**
`src/sales/metrics.mjs:434` -> `api/read/sales-floor.mjs` -> `public/app/sales-floor.js:194-223`
already renders a "Today's recordings" panel with "Open in Drive" links and a "Refresh from
Drive" button that POSTs `/api/company-brain/sync`. Both routes are in the `ROUTES` map.
`src/company-brain/drive-client.mjs` is a real read-only Google Drive client (hand-rolled, no
`googleapis` package). Purpose per the repo: Google Meet call recordings, and nothing else.

**Findings W1/W3 should know about:**
- The Sales Floor response already carries a `recordings` key. Do not add a second one.
- `api/read/sales-floor.mjs` and `api/company-brain/sync.mjs` both gate on `ROLE_SETS.FINANCE`
  (owner, admin, sales_manager) and scope by `staff.org_id`.
- `brain_files`, `brain_chunks`, `brain_drive_sync` have **no row-level security**. Org isolation
  on the Drive path is application-level `org_id = $1` only.
- `src/http/cross-org-isolation.pg.test.mjs` only probes endpoints carrying a client id in the
  URL, so **the Sales Floor endpoint is never leak-tested**. If W1/W3 add org-wide reads there,
  nothing in the suite will catch a missing `WHERE org_id`.
- `docs/journeys/role-sales-manager-intended.md` does not mention Drive, recordings, Google or
  Meet anywhere. Existing documentation gap, not caused by this batch.

## Blockers and open questions

- **W4, for the owner:** `GOOGLE_DRIVE_DELEGATE_EMAIL` is not set, and nothing in the repo records
  whether that was deliberate. Without it the robot account only sees files explicitly shared with
  its own email, so the recordings panel can look broken when it is merely empty. Not a blocker for
  W1/W2/W3.
- **W4, for the owner:** one Google account serves every org. No per-org Drive credential exists in
  the schema. Safe today with one org; leaks on the day there are two.

### W1 — data layer + endpoints (main session) — DONE

Files touched:
- `src/sales/offer-stack.mjs` — NEW. Reads `products` (the canonical stack), `sales`, and
  `sale_payments`. Exports `closerOfferStack`, `floorOfferStack`, `zeroStackFrom`,
  `OFFER_STACK_BASIS`.
- `src/sales/offer-stack.test.mjs` — NEW. 12 unit tests.
- `src/sales/metrics.mjs` — `closerMyNumbers` gains `offer_stack` + `offer_stack_scope`.
  `salesFloor` gains `offer_stack`, `offer_stack_unattributed`, and `closers[].offer_stack`.
  `closerRoster` now also returns `deposits` (already computed, previously dropped).

No new endpoints were needed — both routes already existed and already carried the payload.
No migration. No new dependency. No schema change.

Proof: `npm run lint` clean. `node --test src/sales/metrics.test.mjs src/sales/offer-stack.test.mjs`
= 19 passing, 0 failing.

Honesty notes recorded in code:
- A sale ties to a closer ONLY through `commission_ledger`. Sales with no ledger row are
  reported as `offer_stack_unattributed`, never spread across closers.
- Unknown stays `null` with a reason. Never 0.
- Retired products still appear when they carry money in the period.
- `units`/`sold` count by `sold_at`; `collected` counts by `paid_at`. Both labelled in `basis`.

### W4 — Drive scope (agent) — DONE, and the premise was wrong

Report: `docs/workflows/sales-floor-drive-scope-2026-08-17.md`.

Finding, independently re-verified by the main session: the Sales Floor **already has**
Google Drive access. `src/company-brain/drive-client.mjs` + `auth.mjs` are a real read-only
Drive client. `src/sales/recordings.mjs` lists Meet recordings. `public/app/sales-floor.js`
at HEAD already renders "Open in Drive" links and a "Refresh from Drive" button, and
`company-brain/sync` is in the ROUTES map.

It is switched OFF, not absent. `driveConfigFromEnv` requires
`GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`; without it `ready` is false and the panel says
"Drive not connected".

## Incident — 2026-08-17

A `git stash` run by a concurrent process (not part of this batch) reverted every modified
tracked file in this shared tree to HEAD mid-build. It captured W1's `metrics.mjs`, W2's
`my-numbers.*` and W3's `sales-floor.*`. Nothing was lost — all of it is in `stash@{0}`.
W1 recovered with `git checkout stash@{0} -- src/sales/metrics.mjs` and re-verified green.
W2 and W3 were told to recover the same way, per-file, and to never run `git stash pop`.

## Live proof status — 2026-08-17

Shipped as commit `63a0241`, pushed to `main`, auto-deployed. Confirmed live:

- `https://fundhub.ai/app/my-numbers.js` contains `paintOfferStack` — deployed.
- `https://fundhub.ai/app/sales-floor.js` contains `paintCloserFocus` — deployed.
- `GET /api/read/my-numbers` -> **401** (auth required), not 500. Handler loads, gate works.
- `GET /api/read/sales-floor` -> **401**, same.
- `GET /api/health` -> 200, `"db":"up"`, 0 pending migrations. `health` is in the SAME bundled
  function as both endpoints, so the whole function loads — the metrics/offer-stack import
  cycle does not break production. Also verified locally: `api.mjs` imports clean, and the
  cycle resolves from both entry directions.

**BLOCKED — live screenshots could not be taken.** `POST /api/auth/login` returns **500** on
production for a real account. Not caused by this batch:

- An empty POST to the same endpoint correctly returns `400 email_and_password_required`, so the
  handler itself loads and validates. The 500 happens during actual authentication.
- W3 hit the same login error BEFORE this batch was deployed, while live still ran the old code.
- Nothing in this batch touches auth. The last commit to touch auth/staff was `6f41ca4`
  ("Save staff role changes and send invite and reset mail"), which was already on `main`
  before this work started.

Nobody can sign in to fundhub.ai right now. Reported, not fixed — out of this task's scope.
