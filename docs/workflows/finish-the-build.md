# finish-the-build

Shared board for the finish-the-build batch. Each workflow claims its task here,
writes its manifest here when done, and reads this file before starting.

This file did not exist when W3 ran; W3 created it and wrote the first entry.
Other workflows in this batch should append their own `## W<n>` heading below
rather than editing anyone else's.

## W3

**Task:** one-tap soft pull for an existing client (addendum §8), migration block
077 only. `status: done`

**What changed in plain language:** the system can now record that somebody asked
for a client's credit to be checked. Before this, when a credit check happened,
there was no record anywhere of who asked for it or why — only the answer that
came back. Now every request is written down: who tapped the button, which
client it was for, when, why, what it cost, and which credit report answered it.
A request that cannot say who asked for it is refused outright.

**Nothing sends anything.** Tapping the button writes a row that says "somebody
asked". No credit bureau is contacted. There is no code anywhere in this change
that could contact one, and no setting that turns one on. When a real credit
provider is connected later, the place it plugs in is marked and empty.

---

### Assumptions recorded (CLAUDE.md §2 and §3 were overridden for this run)

The owner told me to keep going rather than stop and ask. These are the calls I
made without asking. Each one is a place where a different answer would change
the work, so each is worth a look.

1. **Who is allowed to tap it.** Four employee roles — owner, admin, closer,
   funding advisor — plus the client themself, for their own file only. Setters
   and inquiry specialists are refused. I copied the reasoning from
   `api/pii.mjs`, which is deliberately narrower than the general staff set: a
   setter qualifying a lead has no business pulling that lead's credit. **If the
   owner wants inquiry specialists included, that is a one-line change to
   `SOFT_PULL_ROLES` in `api/finance/soft-pull.mjs`.**

2. **A client tapping counts as attribution.** The addendum says "a client with a
   token on file taps once". I read that as the client themself being a valid
   requester, so the ledger records two kinds of requester — staff and client —
   and stores the client's *account* id, since that is who tapped. A client can
   only ever request against their own file.

3. **Consent is not modelled here.** `c-00-crs-soft-pull-request` has a documented
   gap (workflow-migration-table.md, finding 15) about a missing
   `crs_softpull_consent` gate. I did **not** build a consent gate, because that
   is the paid-diagnostic path's rule and inventing a consent model for the
   on-demand path would be guessing at a compliance requirement. **This is the
   biggest open question in this unit — see COMPLIANCE, below.**

4. **A second tap returns the first request rather than starting a second.**
   Since nothing transmits, every request stays at `queued` forever, so this
   means the *first* request a client makes blocks later ones until somebody
   resolves it. I put that guard in code rather than in the database precisely so
   it can be changed without a migration once there is something that moves a row
   out of `queued`. The database-level version of that guard would have been a
   permanent trap.

5. **No event name was added.** `src/events/canonical.mjs` is untouched. Three
   names are *proposed* in `src/finance/PROPOSED-EVENTS.md`, with my reading that
   none of them is worth adding yet.

6. **`subscription_id` is a plain column with no foreign key.** W2 owns the
   subscriptions table and this migration has to apply to a database where that
   table does not exist. The id is carried, not validated. A later migration can
   add the key once the table it points at exists.

7. **Cost is taken in cents and refused if it looks like dollars.** A caller
   sending `12.5` is sending dollars into a cents column; that is a 400, not a
   rounding. An absent cost stays NULL, which means *unknown* — never *free*.

---

### COMPLIANCE REVIEW REQUIRED

This change touches credit-pull behaviour, which is on the flag list in
CLAUDE.md §7. Two specific things a human has to decide before this is used
against a real bureau:

1. **Is a recorded reason enough authorisation, or is a consent record needed?**
   Today the ledger requires a *stated reason* from the person who tapped. It
   does not require a *consent artefact from the client*. For the paid path there
   is a consent document kind already (`soft_pull_consent` in
   `src/documents/kinds.mjs`) and an open finding that C-00 never checks it. If
   the on-demand path needs the same gate, it belongs in
   `requestSoftPull()` and it is a small change — but it is a compliance answer,
   not an engineering one, so I did not guess at it.

2. **A client tapping for their own file is a permissible purpose under FCRA;
   an employee tapping is a different question.** The ledger records which of
   the two happened, so the record is there either way. Whether the employee
   path needs additional standing recorded per pull is the second decision.

Nothing here ships a pull. Both questions can be answered before the provider
seam is filled in, not after.

---

### Files touched

| File | Change |
|---|---|
| `db/migrations/077_soft_pull_requests.sql` | new — the `soft_pull_requests` ledger table, three CHECK constraints, three indexes, and a BEFORE UPDATE trigger making the attribution facts write-once. |
| `src/finance/soft-pulls.mjs` | new — the service module. `requestSoftPull`, `fulfilSoftPull`, `closeSoftPull`, `listSoftPullRequests`, `openRequestFor`, `getSoftPullRequest`, plus the validators and `boundedLimit`. |
| `src/finance/soft-pulls.test.mjs` | new — 60 unit tests, no database. |
| `src/finance/soft-pulls.pg.test.mjs` | new — 20 Postgres tests: the refusals hold at the table, and a result lands through `ingestCrsResult`. |
| `src/http/finance-soft-pull.pg.test.mjs` | new — 21 Postgres tests against the endpoint. |
| `api/finance/soft-pull.mjs` | new — `GET` / `POST /api/finance/soft-pull`. |
| `src/finance/PROPOSED-EVENTS.md` | new — three proposed event names; `canonical.mjs` NOT edited. |
| `netlify/functions/api.mjs` | `finance/soft-pull` added to `ROUTES`, with the import. Routed in the same commit as the handler. |
| `docs/workflows/finish-the-build.md` | new — this board. |

**Nothing in the DO-NOT-TOUCH list was touched.** `src/shifts/**`,
`src/commissions/**`, `src/mail/**`, `db/migrations/075/076/078/079` and
`public/app/**` are unmodified. Migration block 077 is the only migration added.

### Exports added

`src/finance/soft-pulls.mjs`:
`SoftPullError`, `SOFT_PULL_STATUSES`, `REQUESTER_KINDS`, `normalizeRequester`,
`normalizeReason`, `normalizeCostCents`, `costDisplay`, `decorate`,
`boundedLimit`, `openRequestFor`, `requestSoftPull`, `fulfilSoftPull`,
`closeSoftPull`, `listSoftPullRequests`, `getSoftPullRequest`.

`api/finance/soft-pull.mjs`: default handler export.

**Nothing existing changed shape.** No export was renamed or removed, and no
other module's behaviour was altered. `src/tradelines/store.mjs` is imported and
untouched. Another workflow can take this branch without adjusting anything.

### Routes added

`GET  /api/finance/soft-pull?client_id=<uuid>[&limit=]` → the pull history.
`POST /api/finance/soft-pull` `{ client_id, reason, cost_cents?, subscription_id?, idempotency_key? }`

### Schema added

One table, `soft_pull_requests`. No existing table, view, index or constraint was
altered. Applies to an empty database and re-applies as a no-op.

---

### Verification actually run

Against real Postgres 16, not reasoned about:

```
077 applies to an empty database        51 migrations, clean
077 re-applies                          0 applied; raw SQL re-run exits 0 with only "already exists" notices
npm test with DATABASE_URL unset        1947 tests · 0 fail · 195 skipped
npm test against Postgres (run 1 and 2) 2443 tests · 24 fail · 8 skipped
baseline on main, same database         2342 tests · 24 fail · 8 skipped
failing test NAMES, branch vs baseline  28 vs 28 — identical sets, zero new names
new unit tests                          60 pass
new pg tests                            20 + 21 pass
```

The failing-name lists were diffed, not the totals. CLAUDE.md §12 is right that
totals move for reasons that have nothing to do with the change.

### Mutation checks

Twelve deliberate breakages, each reverted after. Every one was caught.

| # | Mutation | Caught by |
|---|---|---|
| 1 | Attribution guard removed — a missing requester is invented | 11 unit + 1 pg |
| 2 | Reason guard removed — a blank reason becomes "unspecified" | 17 unit + 1 pg |
| 3 | Double-tap guard removed | 1 unit + 1 pg + 1 http-pg |
| 4 | Session gate widened — anonymous callers accepted | 2 http-pg |
| 5 | Role gate widened to any staff | 3 http-pg |
| 6 | Client-ownership check removed | 2 http-pg |
| 7 | `ingestCrsResult` replaced by a second, local parser | 1 unit + 2 pg + 1 http-pg |
| 8 | Mis-join guard removed — another client's file may answer | 1 pg |
| 9 | `soft_pull_requests_requester_ck` dropped in the database | 2 pg |
| 10 | `soft_pull_requests_reason_ck` dropped in the database | 1 pg |
| 11 | Immutability trigger dropped in the database | 1 pg |
| 12 | Route removed from `ROUTES` | 1 routes test |

9 through 11 matter most: they are the difference between a rule enforced by the
module that usually writes, and a rule enforced by the database against any
writer at all.

### Findings — read these

1. **`btrim(reason) <> ''` does not do what it looks like it does.** Postgres's
   `btrim` default trim set is the SPACE CHARACTER ONLY, so a reason of tab plus
   newline passed the check and landed in the table looking like an answer. My
   first version of 077 had it. The Postgres test caught it because it asserts
   against the table rather than against the module; the unit test could not
   have, because JavaScript's `.trim()` handles tabs correctly. The constraint is
   now `reason ~ '[^[:space:]]'`. **Worth checking wherever else this repo uses
   `btrim(x) <> ''` as a non-blank check.**

2. **The `c-00-crs-soft-pull-request` consent gap is still open and this unit
   does not close it.** See COMPLIANCE above.

3. **Nothing calls `fulfilSoftPull()` in production.** Same shape as W3's earlier
   finding about `autoCloseStale()`. The function is written, tested against real
   Postgres and reachable, and no code path invokes it, because the thing that
   would invoke it is the provider client that deliberately does not exist. That
   is by design for this unit, and it is exactly the class of half-dead feature
   AUDIT-FINDINGS.md warns about, so it is written down here rather than left to
   be discovered.

4. **`npm run lint` and `npx tsc --noEmit` do not exist in this repository.**
   CLAUDE.md §6 lists both as required gates. `package.json` has no `lint`
   script, there is no TypeScript, and no linter is a dependency (the only two
   dependencies are `pg` and `inngest`). I could not run them and did not add
   them — adding a linter is a new dependency and out of scope. **Someone should
   either add them or amend §6, because right now the definition of done names
   two checks that cannot be performed.**

5. **`docs/journeys/` does not exist.** CLAUDE.md §4 requires the `-actual.md`
   journey diagram to be updated in the same commit as any code change touching a
   flow, and requires an append to `docs/journeys/CHANGELOG.md`. Neither the
   directory nor the changelog is in this repository. There was no intended
   journey to read before building and no actual journey to update. I did not
   create the directory — authoring the first journey file for a flow I only
   partly own would be inventing the source of truth that §4 says agents must not
   author. **The client journey is the one this unit touches; whoever owns the
   intended journeys should decide whether a one-tap pull belongs on it.**
