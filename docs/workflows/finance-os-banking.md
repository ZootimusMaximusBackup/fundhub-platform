# finance-os-banking

Shared board for the finance-os-banking batch. Each workflow claims its task
here, writes its manifest here when done, and reads this file before starting.

This file did not exist when W9 ran; W9 created it and wrote the first entry.
Other workflows in this batch should append their own `## W<n>` heading below
rather than editing anyone else's.

## Task list

| Unit | Owns | Status |
|---|---|---|
| W2 | `subscriptions` table (migration 075) + its read endpoint | `pending` — not merged as of this commit |
| W3 | on-demand soft-pull request path | `pending` — not merged as of this commit |
| W4 | `alerts` table (migration 078) + its read endpoint | `pending` — not merged as of this commit |
| W9 | `public/app/finance-os.html` — the client subscription screen | `done` |

W9 does not block on W2/W3/W4. The screen was built against the API contract
and renders an honest unavailable state for each unshipped source. When those
three merge, the screen starts showing their data with no change to the HTML.

---

## W9

**Task:** build the client's Finance OS subscription surface. `status: done`

**What changed in plain language:** clients get a new page that lists every
credit card we can see, what the limit and balance are, and how much of the
card they are using. The page refuses to guess. When a card's credit limit is
missing, it shows a blank and says why, instead of showing 0% — which would
tell someone their credit looks perfect when the truth is nobody knows.

### Fields DISPLAYED, and the source of each

| Field on screen | Source | Notes |
|---|---|---|
| Issuer (per card) | `tradelines.lender` (054) | Blank string renders as `(no issuer recorded)`. |
| Limit (per card) | `tradelines.credit_limit_cents` (054) | Integer cents, converted to dollars at the boundary only. |
| Balance (per card) | `tradelines.balance_cents` (054) | Same. |
| Utilization (per card) | **DERIVED** — `balance ÷ limit` | Not stored. 054 explicitly refuses to store it. NULL when either input is unknown or the limit is 0. |
| Overall utilization | **DERIVED** — `Σbalance ÷ Σlimit` | Weighted, over countable cards only. Not the mean of the per-card percentages. |
| Total limit / total balance | **DERIVED** from the above | Excludes cards with an incomplete pair, and states how many it excluded. |
| Entered-by-hand marker | `tradelines.source = 'manual'` (054) | 054 requires a reader always be able to tell a bureau number from a typed one. |
| Loans-not-shown count | `tradelines.kind = 'installment'` (054) | Installment lines are not cards; filtered out of the table and counted. |
| Subscription tier | `subscriptions.tier` (075, **W2**) | Not shipped — renders the unavailable state. |
| Subscription status | `subscriptions.status` (075, **W2**) | Not shipped — renders the unavailable state. |
| Alerts | `alerts` (078, **W4**) | Not shipped — renders the unavailable state. |
| On-demand soft pull | **W3**'s request path | Not shipped — button rendered disabled with the real reason. |
| Monthly optimization report | `entitlement_catalog.credit-optimization-roadmap` (032) | Reports whether the client HOLDS the deliverable. See the assumption below. |

### Fields REFUSED for lack of a source

Every one of these was asked for or implied somewhere, and none has a table
behind it. None appears on the screen — not as a placeholder, not greyed out,
not as "coming soon". They are listed in `NOT_SOURCED` in the view module so
the gap stays visible.

| Refused field | Why |
|---|---|
| Bills | v2 — no bills table exists |
| Business vs. personal split | v2 — `tradelines` has no ownership column |
| Payment reminders | v2 — no due-date or reminder table exists |
| Cash-flow projection | v2 — no income or recurring-payment source exists |
| Minimum payment | Not on `tradelines`; a bureau file does not always carry it |
| Statement date | Not on `tradelines` |
| Card last four | Not on `tradelines`. `account_ref` is a bureau identifier, not a card number |
| Rewards / points | No source anywhere in the schema |
| Report generation date, download link, monthly cadence | Nothing stores a produced report artifact. The tile names the entitlement only |

### Files touched

| File | Change |
|---|---|
| `src/http/finance-os-view.mjs` | New. Every decision the screen makes, as pure functions. 479 lines between the `FHVIEW` markers. |
| `src/http/finance-os-view.test.mjs` | New. 80 tests. Covers every null path, both response shapes, all nine `classify()` branches, and the marker-block consistency check. |
| `public/app/finance-os.html` | New. The screen. Carries a verbatim copy of the view module between `/* ==FHVIEW-BEGIN== */` and `/* ==FHVIEW-END== */`. |
| `public/app/shell.js` | `finance-os.html` appended to the `ALL` array. Without this the gate at `shell.js:483` redirects the page to `command-center.html`. |
| `api/read/finance-os.mjs` | New. `GET /api/read/finance-os?client_id=` — the screen's own read endpoint. Admits a `client` principal scoped to their own rows. Returns tradeline rows only; no derived totals. |
| `src/http/finance-os-read.pg.test.mjs` | New. 10 tests against the real router, including the cross-tenant isolation assertions. |
| `netlify/functions/api.mjs` | `read/finance-os` registered in the `ROUTES` map. A handler file is not a route; without this it 404s locally and deployed. |
| `docs/workflows/finance-os-banking.md` | New. This board. |

No migration. No new dependency.

### Assumptions recorded (made without stopping, per the run instruction)

1. **Two of the three named spec documents do not exist.**
   `../fundhub-docs/sources/client-control-panel-wireframe.md` and
   `../fundhub-docs/sources/fundhub-partner-platform-addendum.md` are not on
   this account — the in-repo `fundhub-docs/sources/` holds only
   `AIRTABLE-BASE-EXTRACT.md`, and HANDOFF.md line 90 confirms the sibling repo
   is absent. The §8 field list quoted in the task brief was used as the spec.
   The layout grammar was taken from `public/app/client-portal.html`, which is
   an approved implementation that does exist. **No tile was invented to fill
   the gap.**

2. **The screen reads `/api/read/finance-os`, its own endpoint.** The first
   cut reused the existing `/api/read/tradelines`, which works for staff but
   403s a client principal — see the resolved blocker below. The new endpoint
   returns ROWS ONLY and derives nothing: utilization and the portfolio totals
   are computed by the view module, which the screen carries and which is unit
   tested. Computing them server-side as well would create a second answer that
   can disagree with the first.

3. **"Monthly optimization report" is NOT `src/optimize/`.** That module
   optimises ad spend — campaign budgets and platform ceilings — and has
   nothing to do with a consumer's credit. Wiring the tile to it would have
   produced confident nonsense of exactly the kind HANDOFF.md warns about with
   `cards`. The real identity is `credit-optimization-roadmap` in
   `entitlement_catalog` (032), which `client-portal.html` already renders. The
   tile reports whether the client holds it and claims nothing else.

4. **The unavailable banners name the missing migration file**
   (`075_subscriptions.sql`, `078_alerts.sql`). This is developer wording on a
   consumer-facing screen. It was kept deliberately: the brief requires the
   difference between "not deployed" and "not signed in" to be legible, the
   screen cannot ship to real clients until W2/W3/W4 land anyway, and a vague
   "coming soon" is exactly what rule 1 forbids. **Soften this copy before real
   clients see the page.**

5. **The screen does its own `fetch` rather than using `FHData.get()`.**
   `public/app/data.js:59` maps 401 and 403 onto one `"unauthorized"` source,
   and the brief requires those two to stay distinct. `send()` in the screen
   captures the raw status and hands it to `classify()`.

6. **Most permissive reasonable gate.** `/api/read/finance-os` serves staff
   (`ROLE_SETS.STAFF`, any named client) and a `client` principal (their own
   rows only). Affiliates and partners are not admitted — they have no business
   with a consumer's card balances. Anonymous callers are refused.

### The client-access blocker — RESOLVED inside this lane

Originally reported here as a blocker for another workflow. It is fixed.

`api/read/tradelines.mjs:36-37` gates on `ROLE_SETS.STAFF` and takes
`client_id` from the query string. That is correct for the Closer Dashboard — a
closer looks at somebody else's file — but it means a signed-in client on their
own Finance OS screen got a 403.

Rather than widen a shared staff endpoint (whose other caller does not want
client scoping), W9 added **`api/read/finance-os.mjs`**: a `readHandler` that
admits a `client` principal and takes the scope from the SESSION, never the
query string, exactly as `api/read/entitlements.mjs` does. Staff must name a
client; a client reads only their own rows and `?client_id=` is ignored for
them, so editing the URL cannot widen it.

`api/read/tradelines.mjs` is **unchanged** — no other lane's surface was
touched.

Covered by `src/http/finance-os-read.pg.test.mjs` (10 tests against the real
router), written adversarially: the assertions that matter are the ones where a
client tries to read another client's balances by naming them in the URL, and
where an anonymous caller and an affiliate are refused.

### Bug found by running it, not by reading it

`buildRoadmap()` initially read `res.body.data`. Endpoints built on
`readHandler()` answer `{ ok, count, limit, offset, hasMore, items }` — the key
is `items`. Only the hand-rolled `api/read/tradelines.mjs` answers `data`. The
roadmap tile therefore found nothing against a perfectly healthy server. Fixed
by `rows()`, which reads whichever key arrived, and pinned by four tests. This
is the AUDIT-FINDINGS.md shape again: a unit test against a fake response would
have stayed green forever.

### Verification actually performed

- `npm test` without `DATABASE_URL`: **1772 pass, 0 fail, 195 skipped.**
- `npm test` against a real Postgres 16 with all 50 migrations applied:
  **zero new failing test names** versus the same suite run on the branch with
  W9's changes stashed. Names diffed, not totals.
- Chromium via Playwright, against `scripts/dev-server.mjs` with a real seeded
  staff session: the page **renders and does not bounce** to
  `command-center.html`. Verified with tradelines covering a normal card, a
  NULL limit, a NULL balance, a zero limit, a real zero balance, an over-limit
  card and an installment loan. All seven behaved correctly.
- An invalid session redirects to `login.html?next=/app/finance-os.html` —
  `shell.js` handles that before the screen loads, so `classify()`'s 401 branch
  is defensive only (it fires if a session expires mid-fetch).
- `node db/migrate.mjs` applies clean and re-applies as a no-op (0 applied on
  the second run). W9 adds no migration; this confirms it broke nobody else's.
- Endpoint mutation check: three deliberate breaks — taking the client scope
  from the query string (the cross-tenant leak), letting closed lines through,
  and admitting affiliates. **All three were caught.**
- View-module mutation check: six deliberate breaks of the critical rules — unknown
  utilization returning 0, zero-limit dividing, clamping over-limit to 100%,
  collapsing 403 into 401, dropping the `items` shape, and letting unknown
  cards into the totals. **All six were caught** by 1–8 failing tests each.

### Repo facts worth carrying forward

- **`npm run lint` and `npx tsc --noEmit` do not exist in this repo.**
  `package.json` has no `lint` script, and there is no `tsconfig.json` or
  eslint config anywhere. CLAUDE.md §6 lists both as gates. Either add them or
  correct §6 — right now that checklist cannot be completed as written.
- **`node_modules` was empty at session start**, which made `npm test` report
  119 failures that were all `Cannot find package 'inngest'`. Run `npm install`
  before trusting a red suite.
- **`docs/journeys/` does not exist**, so CLAUDE.md §4's journey files and
  changelog have no directory to live in. W9 did not create the eight intended
  journeys — §4 says agents do not author `-intended.md`, and inventing them
  would be the exact failure this lane exists to avoid.
