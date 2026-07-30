# Unit 13 — verification pass

Read-only. Nothing was fixed in this pass; findings are ranked by severity below.
Every check was RUN, not reasoned about.

## Result: no blocking defects found

Two candidate findings turned out to be false positives from naive checks; both
are recorded below rather than quietly dropped, because the naive version of each
check is the one someone will write again.

---

## Checks and outcomes

| # | Check | Result |
|---|---|---|
| 1 | Migrations 001→044 apply clean, in order, on a scratch Postgres 16 | **PASS** — 33 files; re-run applies 0 |
| 2 | All 19 workflows write `assignee_role` | **PASS** — verified by running each workflow's `handle()`, not by grep |
| 3 | No event emitted that is absent from `canonical.mjs` | **PASS** — none |
| 4 | No event fires twice via both a bus handler and an Inngest function | **PASS** — see note below |
| 5 | DS-02 letters unreachable from the funding route, fails closed on a null tier | **PASS** — 4 hard-rule tests |
| 6 | Product routing by name, never by dollar amount | **PASS** — no workflow branches on an amount |
| 7 | Every money/work writer carries an idempotency guard | **PASS** — none unguarded |
| 8 | New tests would fail against a no-op implementation | **PASS** — 21 killed, see below |
| 9 | `event.id` / `event.payload.X` resolve against the bridge shape | **PASS** — false positive, see below |
| 10 | Cross-role API reach | **PASS** — closer 403 on inquiry and on commissions |
| 11 | Full auth isolation matrix (Unit 12) | **PASS** — 24 tests |

## 4 — the ten "double subscriptions" are complementary, not duplicate

Ten canonical events have both a bus handler and Inngest functions:
`entry.captured`, `survey.submitted`, `payment.received`, `diagnostic.paid`,
`deposit.paid`, `analysis.completed`, `message.inbound`, `call.completed`,
`mail.response`, `booking.created`.

This is **not** double execution. The bus handlers live only in `src/handlers/`
(`client-lifecycle.mjs`, `comms.mjs`) and do SPINE work — persisting the client,
writing the message row. The Inngest functions live only in `src/workflows/` and
do WORKFLOW work. No module registers on both paths, so nothing runs twice:

```
same module on both paths: 0
```

## 8 — mutation testing: 21 tests killed by no-op implementations

Four modules were each replaced with a permissive stub and the suites re-run:

| Module gutted to a no-op | Tests that failed |
|---|---|
| `partners/scope.mjs` (always unrestricted) | **13** of 26 |
| `entitlements.mjs` (`has()` always true) | **4** of 22 |
| `lib/create-task.mjs` (role optional, no dedupe) | **3** of 17 |
| `auth/account-session.mjs` (invite-only removed) | **1** of 24 |

All four restored and confirmed clean against git.

The accounts figure of 1 is **defence in depth working, not weak tests**: removing
the code-side invite-only check did not open the hole, because the `044` trigger
still rejected the insert. The one test that failed is the one asserting the CODE
path refuses; the test asserting the DATABASE refuses still passed against the
gutted module. That is the intended design.

## 9 — `event.data` is the bridge, not a mismatch (false positive)

A naive grep flagged ten workflows for reading `event.data` where the bridge
supplies `event.payload`. Reading the code shows the opposite:

```js
inngest.createFunction(…, ({ event, step }) => handle({ event: event.data, db, step }))
```

`bus.mjs` sends `{ name, data: { id, payload, orgId, clientId } }`, so `event.data`
IS `{ id, payload, … }` and the wrapper unwraps Inngest's envelope before calling
the internal `handle()`. The shapes match. **The check was wrong, not the code.**

## 10 — `api/inquiry.mjs` is gated (false positive)

A grep for `requireAuth` found nothing and looked like an unauthenticated
endpoint. It uses a different middleware:

```js
const staff = await requireRole("inquiry_specialist", "admin")(req, res);
```

Confirmed empirically: a closer gets **403**, an inquiry specialist and an owner
pass auth and fail only on `INQUIRY_API_SECRET` not being set locally.

---

## Non-blocking observations

1. **`INQUIRY_API_SECRET` is unset**, so `/api/inquiry` 500s for permitted roles.
   Expected locally; needs setting wherever the inquiry runtime is reachable.
2. ~~`src/auth/seed-staff.pg.test.mjs` deletes the six real staff accounts in
   its teardown, so a full `npm test` leaves you unable to log in.~~
   **FIXED in Unit 14** — the suite now uses throwaway `+seedtest` addresses.
   Verified: all six real accounts survive a full `npm test` run.
3. **8 tests skip** — they need the `fundhub-docs` sibling repo, which is not on
   this account. They un-skip automatically when it exists.

---

## Follow-up pass: one real defect, found by driving the browser

Unit 13 checked the API and the workflows. It did **not** check what a screen
does with an error response, and that is where the defect was.

### A 404 meant two different things and the frontend believed the wrong one

`client-control-panel` opened with a stale `?id=` reported
**"backend unavailable (offline: /api/\* not deployed)"** while the backend was
up and answering correctly. `public/app/data.js` mapped every 404 to "the API is
not deployed", so a missing row and a missing deployment were indistinguishable.

Fixed by splitting the two: the router's fallthrough answers
`{error:"not_found", path}` and only that is an outage. Anything else at 404 is
a working backend saying the record does not exist, which is now a `sample`
banner with a reason rather than an `error` banner.

### The same request class was also a 500 with the raw Postgres message

`?id=zzz` reached Postgres and raised SQLSTATE `22P02`, which every handler
reported as a 500 quoting `invalid input syntax for type uuid: "zzz"`. Two
problems in one: a client error reported as a server fault, and the query's
internals echoed back to the caller.

Swept **119 route/parameter combinations** for it. Five endpoints were affected:
`dashboard/client`, `read/documents`, `read/commissions`, `read/entitlements`,
`partner-brand`, plus `tasks` on both GET and PATCH. All now classify SQLSTATE
class 22 as a **400 `invalid_parameter`** and scrub the fallback 500 through
`safeError()`. Re-swept: **0 leaking 5xx**, and the write paths (PATCH/PUT) are
clean too.

Classification is on `err.code`, never the message — the message is localised
and version-dependent.

### Why the earlier pass missed it

Both defects need an error path to be *rendered*, not just returned. The Unit 13
checks asserted status codes and payloads; neither opened the page. The banner
cases are now driven in Chromium — real record, absent id, malformed id, no id —
asserting the **tone the user sees**, not the HTTP status.

### Mutation testing on the fixes

| Mutation | Tests that failed |
|---|---|
| all 404s → `offline` (the original bug) | 3 |
| all 404s → `notfound` (over-broad, hides outages) | 2 |
| match `error:"not_found"` without checking `path` | 1 |
| `explain()` treats a missing record as an outage | 2 |
| SQLSTATE classification removed | 2 |
| SQLSTATE classification applied to *everything* | 2 |
| `isUuid()` always true | 1 |

The over-broad mutations matter as much as the absent ones: they prove the tests
pin the boundary rather than just the happy path.

## A screen that was recorded as blocked, and was not

`inquiry-remover` was listed as having no data source, on the grounds that
`/api/inquiry` returns the external Airtable shape. That was true and beside the
point: there is a local `inquiry_log` table whose columns map 1:1 onto the
screen's Work Queue (bureau, inquiry, status, call_attempts, outcome). The
earlier note had checked the endpoint and never checked the schema.

Wired via a new `/api/read/inquiries`. All ten of the screen's interactions were
driven in Chromium against real rows — expand, collapse, log an attempt, mark
confirmed, both stat bumps, and the bureau filter — because the screen binds its
handlers to whatever rows exist at init, so wiring it wrong would have produced a
page that renders correctly and does nothing.

Re-checked the other five blocked screens against the schema rather than the
notes. They are genuinely blocked. One trap worth recording: **`public.cards` is
a pipeline kanban card, not a credit card.** It is the obvious-looking source for
`closer-dashboard` and it is the wrong one.

## Suite after the follow-up pass

```
1210 tests · 1202 pass · 0 fail · 8 skipped   (was 1178 · 1170)
33 migrations, clean from scratch, idempotent on re-run
15 of 21 screens verified in Chromium: 0 console errors, 0 failed requests
layout identical to the pre-wiring commit on every wired screen
119 route/parameter combinations swept for error leaks: 0
```
