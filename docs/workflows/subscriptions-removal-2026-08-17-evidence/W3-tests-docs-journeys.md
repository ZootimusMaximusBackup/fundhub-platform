# W3 — Tests, docs and journeys sweep

Read-only. Nothing in this workflow edited code, tests or docs. This file is the
only thing W3 wrote.

Repo: `/Users/zootimusmaximus/fundhub-platform` · commit `7be91a0` · 2026-08-17
Search terms: `subscription`, `subscriptions`, `billing`, `recurring plan`,
`subscriptions.html`, `finance/subscriptions`. Excluded `node_modules/`,
`vendor/`, `.git/`.

**The tree moved while this sweep ran.** `public/app/shell.js` and
`src/http/app-nav-reachability.test.mjs` both gained an `ADVISOR_ONLY` list
(`lenders.html` becomes funding-advisor-only) partway through. That change has
nothing to do with Subscriptions and changes no finding here, but it shifted line
numbers in both files. Every line number below was re-checked against the moved
files. **W5 should re-check them again before editing — another workflow is live
in this tree.**

---

## The short version

Deleting the screen, its nav rows and its shell entries turns **three test files
red** and leaves **two Playwright files quietly green while testing nothing**.

Red:

| File | Why |
|---|---|
| `src/http/subscriptions-screen.test.mjs` | It reads the screen file at import. The whole file dies, not one test. |
| `src/http/app-client-carry.test.mjs` | ~18 tests use `subscriptions.html` as the example screen for a shared shell mechanism. |
| `e2e/sidebar-roles.spec.mjs` | Asserts the owner's sidebar **contains** `subscriptions.html`. |

Silently green (false pass — worse than red):

| File | Why |
|---|---|
| `e2e/screens-smoke.spec.mjs` | A deleted page 404s, and a 404 still has a visible `<body>` and throws no script error. The test keeps passing while proving nothing. |
| `e2e/crm-flows.spec.mjs` | Same. |

`src/http/app-nav-reachability.test.mjs` does **not** name Subscriptions. It goes
red only if the deletion is *partial* — screen gone but a nav row left, or a nav
row removed from some screens and not others. It is the global consistency check,
and it is the one that will catch a half-finished delete.

`src/http/routes.test.mjs` does not care about the screen at all. It cares about
`api/finance/subscriptions.mjs` and its `ROUTES` key, which the board says stay.
Full answer in section 3.

---

## 1. Every test file that names it

### 1a. Under the `npm test` glob (`src/**` and `scripts/**`) — these run

| File | Lines | What it is |
|---|---|---|
| `src/http/subscriptions-screen.test.mjs` | whole file (42, 44, 53, 186, 222, 257, 295, 332, 357 + ~25 tests) | Tests the screen's inline wiring script against a stub DOM. |
| `src/http/app-client-carry.test.mjs` | 33, 35, 201, 203, 213, 215, 219, 250, 252, 256, 258, 263, 265, 271, 273, 278, 280, 284, 286, 300, 302, 306, 308, 313, 315, 321, 326, 332, 335, 344, 345, 354, 375 | Tests `shell.js` carrying the open client. Uses the screen as its example. |
| `src/http/subscriptions-endpoints.test.mjs` | 686 lines; imports handler at line 44 | Tests the **API**, not the screen. |
| `src/http/subscriptions-endpoints.pg.test.mjs` | 440 lines; imports handler at line 29 | Tests the API against real Postgres. |
| `src/subscriptions/index.test.mjs` | 241 lines, whole file | Pure logic — price/card refusals. No screen, no API. |
| `src/subscriptions/store.pg.test.mjs` | 545 lines, whole file | Postgres constraints on the `subscriptions` table. |
| `src/http/db-down.test.mjs` | 123 | `/api/finance/subscriptions` is one of 14 entries in the `CLUSTER` list; the handler is dynamically imported at line 179. |
| `src/demo/platform-seed.pg.test.mjs` | 29 — `assert.ok((status.counts.subscriptions \|\| 0) >= 1, "expected subscriptions")` | Counts demo rows in the **table**. Nothing to do with the screen. |

Passing mentions only (a comment naming a sibling file, or the word "billing" in
an unrelated sense) — none of these break:

* `src/http/payment-links-endpoints.test.mjs:2`
* `src/http/bank-accounts-endpoints.test.mjs:11`
* `src/http/bills-cashflow-endpoints.test.mjs:15, 327, 475, 500`
* `src/http/bills-cashflow-endpoints.pg.test.mjs:152, 214`
* `src/http/finance-soft-pull.pg.test.mjs:473`
* `src/payment-links/index.test.mjs:2`
* `src/finance/soft-pulls.test.mjs:60`, `src/finance/soft-pulls.pg.test.mjs:652, 655, 660, 662`
* `src/finance/crs-pull.test.mjs:19`
* `src/banking/recurring.test.mjs:734, 888, 893, 904, 968, 977, 986` (bank-statement recurring-charge detection — a different feature with a similar word)
* `src/banking/recurring.pg.test.mjs:22, 443`
* `src/liabilities/card-stack.test.mjs:15, 284`
* `src/social/social.pg.test.mjs` (~25 lines; `creative_billing_rates`, unrelated)
* `src/compliance/screen.test.mjs:142`, `src/messaging/gate.test.mjs:309` ("billing after performance" compliance wording)
* `scripts/diagrams/generate.test.mjs:102`

### 1b. Playwright / e2e (outside `npm test`; run by `npm run test:e2e`)

| File | Line | Content |
|---|---|---|
| `e2e/sidebar-roles.spec.mjs` | 37 | `const OWNER_ADMIN_ONLY = ["subscriptions.html", "journeys.html"];` |
| `e2e/screens-smoke.spec.mjs` | 24 | `"/app/subscriptions.html",` in the `SCREENS` array |
| `e2e/crm-flows.spec.mjs` | 185 | `"/app/subscriptions.html"` in the "hiring / creative / social / campaign" loop |

### 1c. Under `scripts/`

`scripts/tmp-full-live-verify.mjs:107` lists `"subscriptions.html"` in a screen
array. It is a **script, not a test** — `scripts/run-suite.mjs` only collects
files ending `.test.mjs`, so the suite never touches it. It would 404 against the
live site after deletion, silently.

`scripts/journeys/generate.test.mjs` — see section 4. It names nothing, but it is
the thing that fails if a route disappears and the journeys are not regenerated.

---

## 2. THE KEY QUESTION — which tests go red, and exactly why

Assumed deletion, per the board: `public/app/subscriptions.html` deleted; the
`<a class="navitem" href="subscriptions.html">` row removed from all 34 HTML
files and from `shell.js`'s `SIDEBAR_HTML` (line 31); the `shell.js` list entries
removed — `ALL:61`, `OWNER_ADMIN_ONLY:139`, `CLIENT_SCREENS:405`, plus the
`ALL` header comment at line 23. API untouched.

### RED — because they test the screen itself

**A. `src/http/subscriptions-screen.test.mjs` — the entire file, ~25 tests**

Not one assertion. Line 44 runs at module load, before any test:

```
const HTML = fs.readFileSync(SCREEN, "utf8");
```

where line 42 is `const SCREEN = path.resolve(HERE, "../../public/app/subscriptions.html")`.
Delete the screen and this throws `ENOENT` at import. `node --test` reports the
whole file as a failure. Line 43 also reads `public/app/data.js`, which stays.

**This file exists only to test the deleted screen. It should be deleted with it,
in the same commit.** There is nothing in it to re-point.

**B. `src/http/app-client-carry.test.mjs` — roughly 18 of its ~24 tests**

This file tests a **shared** mechanism (`shell.js` carrying `?client_id=` between
screens) and happens to use `subscriptions.html` as its worked example. Its own
header, lines 33-38, says so:

> `subscriptions.html` stayed, moved to Setup. The tests below used to reach for
> whichever of those eleven happened to fit each scenario; they now reach for
> `finance-os.html` or `subscriptions.html`, the two CLIENT_SCREENS this app still
> has

Three distinct failure causes:

*Cause 1 — the screen leaves `CLIENT_SCREENS` (`shell.js:405`), so nothing is
appended any more.* Every assertion of the form "the client rides along" flips:

| Line | Assertion |
|---|---|
| 203 | `assert.notEqual(a.href, "subscriptions.html", "shell.js did not touch the anchor at all — the harness is not reaching gateLinks()")` |
| 215 | `assert.equal(a.href, "subscriptions.html?client_id=" + CID);` |
| 219-224 | `const screens = ["finance-os.html", "subscriptions.html"];` then `assert.equal(links[i].href, screens[i] + "?client_id=" + CID, ...)` — the array is hardcoded, so this fails on the second element |
| 273 | `assert.equal(a.href, "subscriptions.html?client_id=" + CID);` (gateLinks-runs-twice test) |
| 280 | `assert.equal(a.href, "subscriptions.html?tier=starter&client_id=" + CID);` |
| 286 | `assert.equal(a.href, "subscriptions.html?client_id=" + CID + "#history");` |
| 302 | `assert.equal(a.href, "subscriptions.html?client_id=" + CID);` (Command Center detour) |
| 308 | `assert.equal(a.href, "subscriptions.html?client_id=" + CID);` (address bar beats memory) |
| 326 | `assert.equal(seen.href, "subscriptions.html?client_id=" + CID);` (control panel `?id=`) |

*Cause 2 — the screen leaves `OWNER_ADMIN_ONLY` (`shell.js:139`), so the gate no
longer hides it from a closer.* Lines 344-358 and 373-378:

| Line | Assertion |
|---|---|
| 347 | `assert.equal(a.li.style.display, "none", "a link with a query string was not gated ...")` — after removal the link is not forbidden for a closer, so display stays `""` |
| 356 | `assert.equal(ev.defaultPrevented, true, "the click interceptor let a forbidden navigation start; ...")` — nothing to prevent any more |
| 377 | `assert.ok(r.navigations.length > 0, "a forbidden screen was not routed away from")` and `assert.equal(r.navigations[0].to, "/app/closer-dashboard.html?client_id=" + CID)` — the run opens `page: "subscriptions.html"` as a closer and expects a bounce |

*Cause 3 — none.* Five tests happen to keep passing by accident, because they
assert the href is **unchanged**: lines 252, 258, 265, 315, 335. They would then
be proving nothing.

**Fix, not delete.** The mechanism is real and still worth guarding.
`finance-os.html` is in both `CLIENT_SCREENS` and `OWNER_ADMIN_ONLY`, so every
one of these can be re-pointed at it. Line 219's two-element array needs a second
`CLIENT_SCREENS` member or must shrink to one.

**C. `e2e/sidebar-roles.spec.mjs`**

Line 37 declares the list, and the owner test consumes it:

```
const OWNER_ADMIN_ONLY = ["subscriptions.html", "journeys.html"];
...
expectIncludes(hrefs, [...CLOSER_DESK, ...SALES_FLOOR, ...OWNER_ADMIN_ONLY, ...HIRING_ONLY]);
```

`expectIncludes` is `expect(hrefs, "missing " + h).toContain(h)`. With the nav row
gone the owner's visible sidebar no longer contains `subscriptions.html`, so this
fails with `missing subscriptions.html`. The closer / sales_manager /
funding_advisor tests in the same file use `expectExcludes` and will keep passing
(absent counts as excluded), which means only one of four tests here reports the
problem.

### RED — but only if the delete is left half-done (global consistency, not the screen)

**D. `src/http/app-nav-reachability.test.mjs`** never says the word
"subscriptions". It reads `shell.js`'s lists as text and every screen's sidebar
markup, and cross-checks them. Four different ways a partial delete trips it:

> **Line numbers below are against the current file (259 lines), which gained an
> `ADVISOR_ONLY` list on 2026-08-17 and shifted everything down by 3-18 lines.
> Re-check before quoting.** The `ADVISOR_ONLY` change is unrelated to
> Subscriptions (it moved `lenders.html` to funding-advisor-only) and does not
> alter any finding here.

| Left behind | Line | Assertion that fires |
|---|---|---|
| `shell.js` `ALL` still lists it, file deleted | 117 | `assert.ok(HTML.has(s), "shell.js lists ${s} but public/app/${s} does not exist")` |
| A nav row left in **any** of the 34 HTML files, file deleted | 249-257 | `assert.deepEqual(broken, [], "these links go nowhere:\n  " + broken.join("\n  "))` |
| Nav row removed from **some** screens only | 147-154 | `assert.deepEqual(navHrefs(HTML.get(f)), first, "${f}'s sidebar differs from ${WITH_SIDEBAR[0]}'s ...")` |
| `ALL` entry removed but a nav row kept | 156-160 | `assert.deepEqual(stray, [], "the sidebar links to ${stray.join(", ")}, which shell.js will not open")` |
| Nav row removed but `ALL` entry kept | 136-145 | `assert.deepEqual(missing, [], "no sidebar row links to ...")` |

Counts are safe. `ALL` is 33 entries today and the guard at line 115 is
`assert.ok(ALL.length >= 20, ...)`; 32 still passes. `WITH_SIDEBAR` is 34 files
and the guard at line 128 is `>= 20`; 33 still passes. So **no test fails purely
because a count dropped** — every failure here names the inconsistency.

One more, and it is easy to miss: the `visibleFor(...)` tests at lines 184-231
compare a role's visible rows against a list built from `shell.js` itself, so they
move together and stay green — **except** `"owner/admin keep every non-partner
sidebar row"` (lines 226-230), which fails if the `ALL` entry and the nav row are
not removed in the same commit.

There is one file the sweep must not miss: `public/app/sidebar.fragment.html:26`
carries the same nav row and is picked up by the `FILES` scan at line 80.

### FALSE GREEN — the two that keep passing while testing nothing

**E. `e2e/screens-smoke.spec.mjs:24` and `e2e/crm-flows.spec.mjs:185`**

Both call `openScreen(page, "/app/subscriptions.html", OWNER)`. Chain:

* `e2e/harness.mjs:277` — `await page.goto(pathName)`. Playwright does not throw
  on an HTTP 404.
* `e2e/static-server.mjs:67` — a missing file answers
  `res.writeHead(404, { "content-type": "text/plain" }).end("not found")`.
* `e2e/harness.mjs:264-270` — `assertPageAlive` only checks
  `await expect(page.locator("body")).toBeVisible()` and that no page error was
  collected. A plain-text 404 has a visible `<body>` and runs no script.

Result: `"/app/subscriptions.html loads without a JavaScript error"` **passes on a
page that does not exist**. Nothing will tell W5 these lines are stale. They must
be removed by hand.

### NOT AFFECTED by removing the screen

`src/http/subscriptions-endpoints.test.mjs`, `src/http/subscriptions-endpoints.pg.test.mjs`,
`src/subscriptions/index.test.mjs`, `src/subscriptions/store.pg.test.mjs`,
`src/http/db-down.test.mjs`, `src/demo/platform-seed.pg.test.mjs`. All of these
test the API, the pure logic, or the table. Per the board's scope those stay.
They break only under the deeper deletion analysed in section 3.

---

## 3. `src/http/routes.test.mjs` — read in full, exact answer

The file is 241 lines. Its invariant (lines 18-24): every `*.mjs` under `api/` is
either an exact `ROUTES` key, a prefix-routed special case, or named in
`ALLOWED_UNROUTED` with a written reason. **`ALLOWED_UNROUTED` is currently empty
(`const ALLOWED_UNROUTED = {};`, line 71)** and the file's own comment says the
empty list is the point.

The two relevant pieces of subscription wiring are:

* `api/finance/subscriptions.mjs` — the handler on disk
* `netlify/functions/api.mjs:161` `import financeSubscriptions from "../../api/finance/subscriptions.mjs";`
  and `:615` `"finance/subscriptions": financeSubscriptions,`

`routes.test.mjs` says **nothing** about `public/app/subscriptions.html`. Deleting
the screen, the nav rows and the `shell.js` entries leaves this file entirely
green.

Four scenarios:

| Scenario | Result |
|---|---|
| **Screen + nav + shell entries removed, API and `ROUTES` key both kept** (the board's scope) | **PASSES.** No assertion in this file touches `public/`. |
| **`ROUTES` key removed, `api/finance/subscriptions.mjs` kept** | **FAILS**, test at line 88. `handlerKeys()` (line 76) walks `api/` and yields `"finance/subscriptions"`; it is in neither `ROUTES`, `SPECIAL_CASES` nor `ALLOWED_UNROUTED`, so `orphans = ["finance/subscriptions"]` and line 96 `assert.deepEqual(orphans, [], ...)` fails with "api/ handlers unreachable by any caller". |
| **Handler file deleted, `ROUTES` key kept** | **FAILS twice.** Line 107 `const dangling = Object.keys(ROUTES).filter((k) => !KEYS.includes(k));` → `["finance/subscriptions"]`, and line 108 `assert.deepEqual(dangling, [], ...)` fails. It also fails *earlier and louder*: line 38 `import { ROUTES, routePath, config } from "../../netlify/functions/api.mjs";` cannot resolve `netlify/functions/api.mjs:161`'s import of the missing file, so the test file dies at import — as does every other importer of the adapter. |
| **Both removed together** | `routes.test.mjs` **passes**, but four other things break — see below. |

If anyone is tempted to park it on the allow-list instead: adding
`"finance/subscriptions"` to `ALLOWED_UNROUTED` while the `ROUTES` key still
exists fails line 129 (`"${key}" is in ROUTES and in ALLOWED_UNROUTED`), and the
reason string must be at least 40 characters or line 139 fails.

**If the API is removed too (out of the board's scope, recorded for W4):**

1. `src/http/subscriptions-endpoints.test.mjs:44` — `import subscriptions from "../../api/finance/subscriptions.mjs";` → whole file dies at import (686 lines of tests).
2. `src/http/subscriptions-endpoints.pg.test.mjs:29` — same import, whole file dies (440 lines).
3. `src/http/db-down.test.mjs:123, 179` — the `CLUSTER` entry `["/api/finance/subscriptions", "../../api/finance/subscriptions.mjs"]` is dynamically imported inside the test at line 179, so one test fails rather than the file.
4. `scripts/journeys/generate.test.mjs:28` — the journeys go stale. See section 4.

---

## 4. `docs/journeys/`

### The finding first

**No `-intended.md` file mentions subscriptions at all.** Nothing hand-authored
has to change, and nothing hand-authored may be touched (CLAUDE.md §4).

**No Mermaid flowchart in any journey file contains a subscription step.** The
`-actual.md` files are generated by `scripts/journeys/generate.mjs`, which reads
`netlify/functions/api.mjs`'s `ROUTES` map plus each `api/` handler's role gate
(`scripts/journeys/extract.mjs:10-14, 69-95`). It has no knowledge of
`public/app/` at all. The only subscription content in these files is **one row
in each route-inventory table**.

### `-intended.md` — hand-authored, agents must not edit

| File | Subscription content |
|---|---|
| `affiliate-intended.md` | none |
| `client-intended.md` | none |
| `gate-relay-intended.md` | none |
| `role-closer-intended.md` | none |
| `role-funding-advisor-intended.md` | none |
| `role-inquiry-remover-intended.md` | none |
| `role-owner-intended.md` | none |
| `role-sales-manager-intended.md` | none |
| `white-label-intended.md` | none |

**Nothing to do here. Leave them alone.**

### `-actual.md` — generated from code, must be regenerated if the route changes

Every one of the eight carries the same single row in its route table:

```
| `/api/finance/subscriptions` | GET, POST | owner, admin, sales_manager |
```

| File | Line |
|---|---|
| `docs/journeys/role-owner-actual.md` | 124 |
| `docs/journeys/role-sales-manager-actual.md` | 118 |
| `docs/journeys/role-closer-actual.md` | 211 |
| `docs/journeys/role-funding-advisor-actual.md` | 214 |
| `docs/journeys/role-inquiry-remover-actual.md` | 212 |
| `docs/journeys/client-actual.md` | 151 |
| `docs/journeys/affiliate-actual.md` | 148 |
| `docs/journeys/white-label-actual.md` | 160 |

`gate-relay-actual.md` has none.

**Whether these need updating depends entirely on the API decision:**

* **API and `ROUTES` key kept** (board scope) → the generator produces byte-identical
  output. **No journey file changes. No changelog line needed for a route.**
* **`ROUTES` key removed** → all eight go stale immediately and
  `scripts/journeys/generate.test.mjs:28`, `*** every generated page matches what
  the code now produces ***`, fails inside `npm test` with "docs/journeys is out
  of date with the code". Fix is `npm run journeys` plus a
  `docs/journeys/CHANGELOG.md` line, in the **same commit** as the code change
  (CLAUDE.md §4).

### `docs/journeys/CHANGELOG.md`

Three historical entries name subscriptions — lines 67, 77 and (indirectly) 62.
These are the permanent record and must **not** be rewritten. Line 77 is the one
that recorded the owner decision the screen survived on:

> subscriptions.html kept (it's Fundhub billing the client, not the client's own
> money) and moved to Setup next to Products & Commissions

A new line goes on top when the deletion lands.

### Diagrams

`scripts/diagrams/generate.test.mjs:102` mentions "the billing group" — that is a
title-trimming test for an unrelated diagram group and does not enumerate screens.
`npm run diagrams:check` was not observed to read `public/app/`.

---

## 5. Boards and docs

### `docs/compliance/`

**This directory does not exist.** CLAUDE.md §7 points at it; nothing is there.
Recording the absence rather than filling it (CLAUDE.md §2, "never invent").

Nothing about the Subscriptions **screen** is compliance-flagged. The related
compliance-flagged item is subscription *charging*, which has never existed —
`api/finance/subscriptions.mjs:15-19` and `src/subscriptions/store.mjs` both open
by saying nothing here charges anybody, and `docs/UNFINISHED-AUDIT.md:339` lists
"Subscription charging — compliance-flagged fee timing" as deliberately unbuilt.
**Removing the screen does not touch dispute logic, fee timing, refunds, payment
rails, consent capture or credit-pull type.** W3 sees no `COMPLIANCE REVIEW
REQUIRED` trigger in the screen deletion itself.

### `docs/workflows/` — boards that go stale

Highest-value first (these make claims a reader would act on):

| File | Lines | What it claims |
|---|---|---|
| `docs/workflows/ui-audit-2026-08-17.md` | 17, 43, 72, 93, 104, 118, 164, 179, 181, 201, 250, 260, 263, 268, 422, 459, 460, 461, 462, 472, 612, 648 | 22 hits. Rows 459-462 are per-screen audit verdicts for `subscriptions.html`; line 201 is a fix-count table row; line 612 is an open question about per-client screens. |
| `docs/workflows/finish-the-build.md` | 10, 343, 379, 381-384, 393, 397-399, 414-415, 434-435 | 30 hits. The build record for W2 (migrations 075/076 + store module). Historical. |
| `docs/workflows/finance-os-audit-2026-07-31.md` | 10 hits | Finance OS audit. |
| `docs/workflows/fable-audit-2026-08-16.md` | 67, 130, 226, 417, 782, 847, 1004, 1024, 1048 | Role-by-role reach audit. |
| `docs/workflows/perf-audit-2026-08-17.md` | 14, 58, 63, 76 | Lighthouse scores per screen — line 63 records `subscriptions (0.662)`. |
| `docs/workflows/screen-audit-2026-08-16.md` | 57, 80 | `\| subscriptions \| yes \| partial \| Billing gaps \|` and the 16-BETA-pages list. |
| `docs/workflows/beta-badges-banner.md` | 21 | Lists Subscriptions among the beta-badged screens. |
| `docs/workflows/crm-feel-2026-08-17.md` | 20 | `finance-os.css` adds to 2 screens only (finance-os, subscriptions) — becomes 1. |
| `docs/workflows/comprehensive-fix-report-2026-08-16.md` | 3 hits | |
| `docs/workflows/full-nonbeta-gauntlet.md` | 72, 77 | Mailgun "Subscription" — unrelated word, no change needed. |
| `docs/workflows/e2e-verify-run4.md` | 2 hits | |
| `docs/workflows/finance-os-banking.md` | 30, 231 | Recurring-charge detection — unrelated feature. |
| `docs/workflows/demo-mode.md` | 6 | Demo seed lists `subscriptions/cards` — table, not screen. |
| `docs/workflows/mobile-crm.md` | 1 hit | |
| `docs/workflows/commas-track-d.md` | 24 | A Commas webhook "subscription" — unrelated word. |
| `docs/workflows/finish-the-build/W3.md`, `W9.md` | 1 and 2 hits | Historical. |
| `docs/workflows/fundhub-beta-buildout/099-consent.md` | 1 hit | |
| `docs/workflows/e2e-verify-run5-evidence/**` | ~30 files | Route probes and UI walks, per role. Historical evidence. |

### `docs/` top level — docs that go stale

| File | Lines |
|---|---|
| `docs/SIDEBAR-STRUCTURE.md` | **28** (`\| **Funding** \| Lenders → Finance OS → Contracts → Subscriptions \|`) and **47** (`\| subscriptions.html, journeys.html \| owner / admin \|`). **This is the one that becomes actively wrong the moment the nav row goes.** |
| `docs/CONTROLS-AUDIT.md` | 388 (a `### subscriptions.html` section), 495 |
| `docs/WIRING-AUDIT.md` | 23, 91, 92, 105 (line 105 cites `subscriptions.html:362–375`) |
| `docs/PAYMENT-LINKS-SPEC.md` | 16, 30, 31, 135, 147 — the Payment Links panel **lives on this screen** (`Screen: public/app/subscriptions.html`), and line 147 names `src/http/subscriptions-screen.test.mjs` as its screen test. Deleting the screen deletes the only UI for payment links. **Flag to W4.** |
| `docs/UNFINISHED-AUDIT.md` | 195, 199, 200, 201, 235, 339, 358 (section C4) |
| `docs/FINAL-USABILITY-PASS.md` | 30 |
| `docs/END-TO-END-VERIFICATION.md` | 637 |
| `docs/MONEY-CHAIN-AUDIT.md` | 171, 177 |
| `docs/STILL-MISSING.md` | 51, 96 — Commas webhook "subscription", unrelated word |
| `docs/audits/COMPANY-AUDIT-2026-07-31.md` | 22, 315, 317, 321, 397, 398, 406, 408, 491 |

### Repo root

`WORKFLOW-AUTONOMY.md` (3), `RECOVERY-2026-08-01.md` (2), `VERIFICATION.md` (1),
`TODO.md` (1). All historical.

---

## 6. Evidence folders, screenshots and fixtures

### Folders named for it

* `docs/workflows/perf-audit-evidence/subscriptions/` — `run-1/2/3.report.json`, `run-1/2/3.report.html`, `summary.md`, `summary.json`
* `docs/workflows/ui-audit-evidence/subscriptions/` — `audit.md`, `audit.json`, `fixed/audit.md`, `fixed/audit.json`, `restamp/cml.md`, `restamp/probe-with-client.json`, `restamp/probe-no-client.json`
* `docs/workflows/ui-audit-evidence/subscriptions-client/` — `audit.md`, `audit.json`
* `docs/workflows/ui-audit-evidence/subscriptions-mlfix/` — `audit.md`, `audit.json`
* `docs/workflows/ui-audit-evidence/_reverify-live/subscriptions/` — `audit.md`, `audit.json`

These are dated evidence of past runs. Recommend **keep** — they are the record of
what the screen did while it existed. Do not regenerate.

### Screenshots

* `docs/workflows/e2e-verify-run5-evidence/role-owner/shots/13-subscriptions.html.png`
* `docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/shots/13-subscriptions.html.png`
* `docs/workflows/e2e-verify-run5-evidence/role-owner/restamp-2026-08-17/shots/13-subscriptions.html.png`
* `docs/workflows/ui-audit-evidence/run4-2026-08-17/shots/05-subscriptions.png`

### Fixtures and seed data (the table, not the screen — leave alone)

* `src/demo/seed-ui-coverage.mjs:151, 163, 167, 267` — `seedSubscriptions()`
* `src/demo/platform-seed.mjs:275, 318, 378, 404` — demo counts and cleanup
* `public/app/sample-data.html:367, 380` — `COUNT_KEYS` and `LABELS` include `subscriptions`; this is the Demo Mode counter reading the **table**, and it survives the screen. Note `sample-data.html:268` is a nav row and does go.
* `db/migrations/075_subscriptions.sql` — the table. Out of scope.

### Build artifacts (not source)

* `.netlify/functions-serve/api/public/app/subscriptions.html` — a copy produced by
  `netlify dev`. Regenerates itself; ignore.

### No wireframe

There is no `wireframes/subscriptions.html`.

---

## 7. `npm test` glob — false-green check

`package.json:"test": "node scripts/run-suite.mjs"`. `scripts/run-suite.mjs:36-51`
walks exactly two roots:

```
const all = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "scripts"))];
```

and collects only files ending `.test.mjs`.

**Findings:**

1. **No subscription test sits under `api/`.** `find api -name "*test*"` returns
   nothing. Both endpoint test files were deliberately placed at
   `src/http/subscriptions-endpoints*.test.mjs` and say so in their headers
   (`subscriptions-endpoints.test.mjs:5-9`, `.pg.test.mjs:18-21`), citing this
   exact trap. **No false green from the `api/` glob hole.**

2. **The real false green is Playwright.** `e2e/` is outside the glob by design —
   it runs under `npm run test:e2e`. The three e2e files in section 1b will not be
   exercised by `npm test` at all, and two of them (`screens-smoke`, `crm-flows`)
   would pass even when run, against a 404 page. **W5 must run
   `npm run test:e2e` as well as `npm test`, and must delete those two array
   entries by hand — no tool will flag them.**

3. `scripts/tmp-full-live-verify.mjs:107` is a script, not a `.test.mjs`, so the
   suite ignores it. It probes the live site and would start 404ing after deploy.

4. `.netlify/functions-serve/api/src/**/*.test.mjs` — 73 copied test files inside
   the Netlify build cache. `walk()` never reaches them (it only walks `src/` and
   `scripts/` at the repo root). Noise, not risk.

5. **Baseline discipline.** CLAUDE.md §12: with `DATABASE_URL` unset, 442
   `.pg.test.mjs` tests skip and the suite still reports green. Two of the six
   subscription test files are `.pg.test.mjs`
   (`src/http/subscriptions-endpoints.pg.test.mjs`,
   `src/subscriptions/store.pg.test.mjs`). Against a database they run; without
   one they skip silently. The board's recorded baseline was taken with
   `DATABASE_URL` unset, so **any post-deletion measurement must be taken the same
   way** or the numbers are not comparable.

---

## 8. Checklist for W5

Delete outright:

* `src/http/subscriptions-screen.test.mjs` — tests only the deleted screen

Edit, do not delete:

* `src/http/app-client-carry.test.mjs` — re-point ~18 tests at `finance-os.html`
  (it is in both `CLIENT_SCREENS` and `OWNER_ADMIN_ONLY`); fix the hardcoded array
  at line 219
* `e2e/sidebar-roles.spec.mjs:37` — drop `"subscriptions.html"` from `OWNER_ADMIN_ONLY`
* `e2e/screens-smoke.spec.mjs:24` — drop the entry (will not fail on its own)
* `e2e/crm-flows.spec.mjs:185` — drop the entry (will not fail on its own)
* `scripts/tmp-full-live-verify.mjs:107` — drop the entry
* `docs/SIDEBAR-STRUCTURE.md:28, 47` — the doc that becomes wrong immediately
* `docs/journeys/CHANGELOG.md` — one new line at the top

Do not touch:

* Any `docs/journeys/*-intended.md` (CLAUDE.md §4)
* Any `-actual.md`, **unless** the `ROUTES` key goes too — then run `npm run journeys`
* `src/subscriptions/**`, `api/finance/subscriptions.mjs`, `db/migrations/075_subscriptions.sql`
* Evidence folders and screenshots under `docs/workflows/`

Run before reporting done: `npm run lint`, `npx tsc --noEmit`, `npm test`,
**`npm run test:e2e`**, `npm run journeys:check`, `npm run diagrams:check`.

Do not forget `public/app/sidebar.fragment.html:26` — it is not a screen but the
nav-reachability test scans it.
