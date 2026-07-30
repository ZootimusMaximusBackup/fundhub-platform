# Handoff — state of the platform

Written for the next engineer picking this up. It is deliberately blunt about
what is finished and what only looks finished.

> ## READ `AUDIT-FINDINGS.md` FIRST
>
> An independent seven-lens audit was run against this branch after the build queue was
> declared finished. It found **53 defects, four of them blocking**, concentrated exactly
> where the unit tests fake out the real seams — the Netlify adapter, the schema/code
> boundary, and the screen/DOM boundary.
>
> **All four blocking defects and every high finding are now fixed** (see the git log from
> `Independent audit: 53 findings` onward). What is worth carrying forward is not the list
> but the shape:
>
> - **A fake that models the schema you wish you had cannot fail when the schema moves.**
>   `031_invoices.sql` renamed three columns and the only writer of the table was never
>   updated. Every `createInvoice()` raised SQLSTATE 42703 against Postgres while the unit
>   tests stayed green, because they ran against an in-memory stub still modelling the old
>   names. `*.pg.test.mjs` files now cover every money path against a real database.
> - **A structural check can pass over a half-dead feature.** `src/adapters/lendflow.mjs`
>   was 440 lines, fully tested, documented as live in `docs/diagrams`, and never registered
>   in the router — so `/api/webhooks/lendflow` 404'd and the whole `round.*` event family
>   had no producer. `npm run diagrams:check` reported "up to date" throughout, because it
>   reads the adapters directory rather than the router.
> - **"Absent config" must never mean "no gate".** `/api/dashboard/*` served the entire
>   client book to anonymous callers because the gate returned open whenever
>   `DASHBOARD_SECRET` was unset and `NODE_ENV` was not `"production"` — the exact deployed
>   configuration. It was masked only by there being no production database.
> - **Banner tone and "no console errors" do not mean a screen works.** Seven screens
>   rendered real data and reverted to sample on the first filter keystroke, or painted it
>   into a hidden element, all under a green "live" badge.
>
> **`scripts/marketing/lib/*.test.mjs` — 78 tests — never ran**, because the `npm test`
> glob covered `src/**` and `scripts/diagrams/*` only. The glob is `scripts/**` now and all
> 78 pass.
>
> Still open and deliberately not built: **nothing transmits.** `sendTemplated` writes
> `messages` rows with `status='queued'` and no code ever sends them — there is no outbound
> fetch anywhere in `src/adapters/` or `src/lib/`. Turning on the Inngest keys will run 47
> workflows and produce zero SMS or email. That needs a sender, and a decision about which
> provider.

## The one-line summary

The **backend is built and tested** — all 14 units of the build queue are done.
The **front end is now mostly wired too**: 14 of 21 screens read real data. What
remains is 7 screens with no data source yet, and no production database. Do not
open the deployed site expecting live data until `DATABASE_URL` is set.

---

## Get running locally (5 minutes, verified from scratch)

Postgres 16 and Node 22.

```bash
npm install

# 1. a database
sudo -u postgres psql -c "CREATE ROLE fundhub LOGIN PASSWORD 'localdev' SUPERUSER"
sudo -u postgres createdb -O fundhub fundhub
export DATABASE_URL="postgres://fundhub:localdev@127.0.0.1:5432/fundhub"

# 2. schema — 33 files, applies clean, re-running is a no-op
node db/migrate.mjs

# 3. staff logins. Reads the password from the ENV, never argv.
#    Re-running does NOT reset a password someone has changed.
#    If the accounts already exist you will see "6 already correct" and your
#    NEW password will NOT be in effect — add --reset-passwords to force it.
STAFF_INITIAL_PASSWORD='<pick one, 12+ chars>' node scripts/seed-staff.mjs

# 4. tests
npm test                    # 1348 tests, 0 failures, 8 skipped

# 5. the app — screens AND a working /api/*
node scripts/dev-server.mjs
# → http://127.0.0.1:8899/login.html
```

**Step 5 used to say `npx http-server public`.** That serves the HTML and
nothing else, so every `/api/*` request 404s, the seeded logins are rejected at
the login screen, and no screen can reach real data — following the documented
steps exactly produced an app that looked broken. `scripts/dev-server.mjs`
routes `/api/*` through the REAL Netlify function handler, so local behaviour is
the deployed behaviour rather than a second implementation that can drift.

**The 8 skipped tests** need the `fundhub-docs` sibling repo, which is not on
this account. They are the message-template seeders. They skip cleanly and
un-skip automatically the moment `../fundhub-docs/sources` exists with the three
copy source docs.

The staff seed suite used to delete these six accounts in its teardown, so a
full `npm test` left you unable to log in. Fixed in Unit 14 — it uses throwaway
`+seedtest` addresses now, and the real six survive a full run.

---

## What is actually done

Each of these is verified against a real Postgres, not by reading code.

| Area | Where | State |
|---|---|---|
| Schema | `db/schema/` + `db/migrations/` + `db/seed/` | 33 files total (10 + 21 + 2), clean from scratch, idempotent |
| Dead-letter queue | `src/events/dead-letter.mjs` | Handler failures isolated + recorded, retry with backoff |
| Task routing | `src/lib/create-task.mjs` | All 20 task-writing sites route to an owning role |
| Entitlements | `src/entitlements/` | Grants, catalog, locked tiles |
| Agent registry | `src/agents/registry.mjs` | 14 agents; only Setter Josh + Inquiry Removal AI are live |
| Partner isolation | `src/partners/scope.mjs` | **NOW WIRED.** `api/read/partners` is its first production caller. A partner principal sees exactly their own row; staff still see the whole book. Adversarially tested in `src/http/principal-reads.pg.test.mjs`. Other endpoints do not admit partners at all, so there is nothing else to scope yet. |
| Affiliate economics | `src/affiliates/economics.mjs` | Attribution, accrual, tier 2 |
| Read APIs | `api/read/*` | 13 endpoints, role-gated, paginated, redacted |
| Principals | `src/auth/account-session.mjs` | client/affiliate/partner sign-in; partner is invite-only |
| Brand Studio | `api/partner-brand.mjs` | GET/PUT, Google-fonts-only, applied by shell.js |
| Health | `api/health.mjs` | Always 200, names its state, leaks no host |

---

## What is NOT done — in the order it will bite you

### 1. Six screens are still on sample data

**15 of 21** read real data: `client-control-panel`, `pipeline`, `documents`,
`staff-teams`, `affiliate`, `ops-admin`, `command-center`, `products-commissions`,
`client-portal`, `partner-galaxy`, `messaging`, `calendar`, `agent-editor`,
`brand-studio`, `inquiry-remover`.

The remaining **6** each lack a data source, not wiring. None is a wiring job
you can just do — each needs a modelling decision first:

| Screen | What it needs first |
|---|---|
| `closer-dashboard` | credit-card tradelines with APR / limit / balance. **The `cards` table is NOT this** — see the warning below |
| `automations` | a workflow-run history table; none exists |
| `galaxy` | node/edge layout has no source (`/api/read/staff` exists, the graph does not) |
| `content-admin` | a video library table and a tier->video mapping. **Partial source exists**: `entitlement_catalog` holds the five locked-tile identities the portal already renders, but it has no price and no marketing copy, and there is no write endpoint — so the editor would display real names and be unable to save. Needs the write path first. |
| `sample-data` | a sample-data screen by design — leave it |
| `index` | router, renders nothing |

> **`cards` is a name collision.** `public.cards` is a PIPELINE KANBAN card —
> `(client_id, pipeline_id, stage_id, owner)`. It has no APR, limit or balance
> and has nothing to do with credit cards. `closer-dashboard`'s waterfall and
> cliff calculators need real tradelines, and no table in the schema holds them.
> Do not wire the dashboard to `cards`.

**`inquiry-remover` reads, but does not write.** It now renders the real
`inquiry_log` queue via `/api/read/inquiries`, and every interaction — expand,
log an attempt, mark confirmed, filter by bureau — works on the real rows. But
those actions are still LOCAL ONLY: there is no write endpoint for
`inquiry_log`, so a click updates the screen and is lost on reload. That is the
next job on this screen.

Two things on it are reported rather than guessed:
- **Status pills** are mapped only where the wording is unambiguous. Anything
  else keeps its real text on a neutral pill and is counted in the banner
  ("2 with an unmapped status"). `inquiry_log.status` is free text, so a
  complete mapping would be an invention.
- **The "Worked" stat** keeps its sample value. Nothing in `inquiry_log` records
  who worked a row or when, and deriving it from `call_attempts > 0` would be a
  guess. Queue Left, Calls and Confirmed ARE derived from the real rows.

The read APIs most screens need now exist
(`/api/read/*` and the widened `/api/dashboard/client`), so this is wiring, not
design.

Rules that apply when you do it:
- **Never change the layout.** Those screens are the approved design. Replace
  data, add loading and empty states, do not restyle or reorder. The four wired
  in Unit 10 were checked element-by-element against their pre-wiring geometry;
  do the same.
- **Fall back, don't blank.** A wired screen keeps its sample markup and shows a
  banner when the API cannot answer. A missing database must never produce an
  empty screen.
- **Never invent a field.** Anything with no source in the schema keeps its
  sample value and gets reported.

### 2. Principals can log in, but their screens are not wired

`accounts` + `account_sessions` landed in Unit 12 (044). Client, affiliate and
partner all sign in through `/api/auth/login`, which returns a `principal` field
so the frontend can route. Partner is invite-only, enforced in code AND by a
trigger.

`client-portal.html` and `partner-galaxy.html` are both wired now, so a
principal who signs in lands on real rows rather than a wireframe. What has NOT
been exercised end-to-end is a real client/affiliate/partner session driving
those two screens — they were verified with a staff session. Log in as each kind
before trusting it.

`036_partner_role.sql` seeded `partner` into the STAFF catalog as a stopgap. Now
that real partner accounts exist it should be reverted — see the DESIGN NOTE in
that file.

### 3. No production database

`DATABASE_URL` is not set on Netlify, so the deployed site runs entirely in demo
mode. `/api/health` will report `state: "unconfigured"` rather than 5xx, and the
screens fall back to sample markup rather than blanking — both deliberate.

This could not be done from the build environment: its network policy returns
403 for `console.neon.tech` and `api.netlify.com` and blocks raw TCP entirely, so
no remote Postgres is reachable even with a connection string in hand.

### 4. Workflows do not fire in production

`src/events/bus.mjs` only forwards to Inngest when `INNGEST_EVENT_KEY` is set.
It is not. All 47 functions are inert.

This is deliberate and is the LAST step: setting those keys turns 47 functions
live against whatever `DATABASE_URL` points at. Unit 13's verification pass is
clean (see `VERIFICATION.md`), so the gate is now just "do it when someone is
watching" — an operator action, not a commit.

### 5. Brand Studio writes through, but only for a partner principal

`043` + `api/partner-brand.mjs` + `shell.js applyBrand()` landed in Unit 11, and
`brand-studio.html` now PUTs to the endpoint as well as caching a local draft.
The localStorage write was kept deliberately: a failed PUT leaves the draft
intact and the banner says "saved LOCALLY only" rather than pretending it
persisted.

It only loads a real palette for a partner principal, or with an explicit
`?partner_id=<id>`. A staff session with neither sees the sample palette — that
is correct, not a bug.

---

## Decisions made that you should know about

- **Task idempotency is event-scoped, not title-scoped.** The spec asked for
  `(client_id, source_workflow, title)`; title is not unique per occurrence, so a
  client on a second round would have received *no task at all*. Kept the
  event-scoped key the existing unique index already enforces. `dedupeOn:
  "title"` is available for callers that want the stricter behaviour.
- **Staff roles share the full sidebar.** The narrow per-role tab lists were
  causing screens to load and bounce, and protected nothing —
  `/api/dashboard/*` gates on a valid session, not on a role. Principals stay
  confined. If commission rates and staff comp should be restricted, gate them in
  the API first; that is where the data is.
- **`staff.role` has no CHECK/FK against the catalog.** Deferred deliberately:
  `020_auth.sql` backfills the catalog *from* `staff.role`, so the constraint can
  fail an existing database. `src/auth/role-catalog-drift.pg.test.mjs` guards it
  in CI instead.

## Things left unpopulated on purpose — do not guess these

| What | Where | Why |
|---|---|---|
| Product → entitlement mapping | `product_entitlements` (empty) | Documented nowhere. `unmappedProducts()` lists all five products. |
| Affiliate commission schedule (AF-04) | `affiliate_commission_rules` (empty) | Undecided. Unrated conversions keep `commission_due` NULL, not 0. `unratedConversions()` lists them. |
| Agent prompts + guardrails | `agents.prompt` / `.guardrails` (NULL) | Only Setter Josh's screen text is the real agent's; the rest is sample copy. `needsAttention()` lists them. |
| `comms.mjs` "Strategy session booked" | routed to `closer` | Confirmed by the owner. |

Each has a reporting function so the gap stays visible instead of being
forgotten.

## Explicitly deferred, do not build

SSE at `api/stream.mjs` (polling is fine), migration 038 CAPI/Deluxe ad
attribution, hosted partner funnels at custom domains, BS-06 script generation.
