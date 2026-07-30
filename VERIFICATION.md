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
2. **FIXED in Unit 14.** The seed suite now uses throwaway `+seedtest` addresses, so the real six accounts survive a full `npm test` run.
   teardown.** A full `npm test` therefore leaves you unable to log in until you
   re-run `scripts/seed-staff.mjs`. This bit twice during verification. Already
   in `HANDOFF.md`; worth fixing by giving that suite its own throwaway emails.
3. **8 tests skip** — they need the `fundhub-docs` sibling repo, which is not on
   this account. They un-skip automatically when it exists.

## Suite at time of verification

```
1178 tests · 1170 pass · 0 fail · 8 skipped
33 migrations, clean from scratch, idempotent on re-run
```
