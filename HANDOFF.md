# Handoff — state of the platform

Written for the next engineer picking this up. It is deliberately blunt about
what is finished and what only looks finished.

## The one-line summary

The **data layer is built and tested**. The **product is not wired**: 19 of 21
CRM screens still render hardcoded sample data, only staff can sign in, and no
production database is configured. Do not open the deployed site expecting a
working CRM.

---

## Get running locally (5 minutes, verified from scratch)

Postgres 16 and Node 22.

```bash
npm install

# 1. a database
sudo -u postgres psql -c "CREATE ROLE fundhub LOGIN PASSWORD 'localdev' SUPERUSER"
sudo -u postgres createdb -O fundhub fundhub
export DATABASE_URL="postgres://fundhub:localdev@127.0.0.1:5432/fundhub"

# 2. schema — 31 files, applies clean, re-running is a no-op
node db/migrate.mjs

# 3. staff logins. Reads the password from the ENV, never argv.
#    Re-running does NOT reset a password someone has changed;
#    --reset-passwords is the opt-in that does.
STAFF_INITIAL_PASSWORD='<pick one, 12+ chars>' node scripts/seed-staff.mjs

# 4. tests
npm test                    # 1154 tests, 0 failures, 8 skipped

# 5. the screens
npx http-server public -p 8899 -c-1
# → http://127.0.0.1:8899/login.html
```

**The 8 skipped tests** need the `fundhub-docs` sibling repo, which is not on
this account. They are the message-template seeders. They skip cleanly and
un-skip automatically the moment `../fundhub-docs/sources` exists with the three
copy source docs.

(That suite used to delete these six accounts in its teardown, so a full
`npm test` left you unable to log in. Fixed in Unit 14 — it uses throwaway
`+seedtest` addresses now, and the real six survive a full run.)

---

## What is actually done

Each of these is verified against a real Postgres, not by reading code.

| Area | Where | State |
|---|---|---|
| Schema | `db/migrations/` | 31 files, clean from scratch, idempotent |
| Dead-letter queue | `src/events/dead-letter.mjs` | Handler failures isolated + recorded, retry with backoff |
| Task routing | `src/lib/create-task.mjs` | All 20 task-writing sites route to an owning role |
| Entitlements | `src/entitlements/` | Grants, catalog, locked tiles |
| Agent registry | `src/agents/registry.mjs` | 14 agents; only Setter Josh + Inquiry Removal AI are live |
| Partner isolation | `src/partners/scope.mjs` | Tenancy boundary, mutation-tested three ways |
| Affiliate economics | `src/affiliates/economics.mjs` | Attribution, accrual, tier 2 |
| Read APIs | `api/read/*` | 10 endpoints, role-gated, paginated, redacted |
| Principals | `src/auth/account-session.mjs` | client/affiliate/partner sign-in; partner is invite-only |
| Brand Studio | `api/partner-brand.mjs` | GET/PUT, Google-fonts-only, applied by shell.js |
| Health | `api/health.mjs` | Always 200, names its state, leaks no host |

---

## What is NOT done — in the order it will bite you

### 1. The screens are not wired (biggest gap)

**6 of 21** read real data: `client-control-panel`, `pipeline`, `documents`,
`staff-teams`, `affiliate`, `ops-admin`.
The other 19 render invented sample rows — Command Center, Closer Dashboard,
Messaging, Galaxy, everything. The read APIs those screens need now exist
(`/api/read/*` and the widened `/api/dashboard/client`), so this is wiring, not
design.

Rules that apply when you do it:
- **Never change the layout.** Those 20 screens are the approved design. Replace
  data, add loading and empty states, do not restyle or reorder.
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

What is still missing is the SCREENS: `client-portal.html` and
`partner-galaxy.html` are still hardcoded sample data, so a principal can now
authenticate but lands on a wireframe. Wiring those is the remaining work.

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
It is not. All 47 functions are inert. Set `INNGEST_EVENT_KEY` and
`INNGEST_SIGNING_KEY` **after** a verification pass, not before.

### 5. Brand Studio: backend done, screen not wired

`043` + `api/partner-brand.mjs` + `shell.js applyBrand()` all landed in Unit 11,
so tokens persist and are applied at boot. `brand-studio.html` itself still
writes to localStorage — the screen needs pointing at the endpoint.

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
