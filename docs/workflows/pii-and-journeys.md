# pii-and-journeys — shared board

Two follow-ups from the banking compliance batch. Independent: no shared files.

---

## Task list

| # | Task | Owner | Branch | Status |
|---|------|-------|--------|--------|
| W1 | Fix the SSN reveal log — `revealSsn()` runs with autocommit | claude | `claude/pii-ssn-reveal-log` | **claimed** — PR #59 merged, unblocked |
| W2 | `docs/journeys/`, actual files only, generated from code | claude | `claude/journeys-actual-generated` | **done** — merged to main |
| W3 | Gate `/api/partner-brand` to owner and admin | claude | `claude/partner-brand-role-gate` | **done** |
| W4 | Endpoints an affiliate can actually reach | unclaimed | not cut | **scoped, not started** — buildout finishes first (owner) |

### W1 is unblocked

PR #59 merged on 2026-07-31, so `src/db/with-transaction.mjs` is on `main`. W1 imports it
and deletes the broken local copy in `src/pii/index.mjs` — no third copy of the helper.

### W4 — what it needs to cover

**Scoped here, deliberately not started.** The owner's call: the buildout finishes first.

An `affiliate` is a real account kind (`src/auth/account-session.mjs` `PRINCIPAL_KINDS`)
that can be issued a session, and **no endpoint anywhere names it**. They sign in and reach
nothing. `src/http/read-api.mjs` describes this exact failure in its own comments and names
the `principals` option as the fix — applied to `client` and `partner`, skipped for
`affiliate`.

Whoever picks this up needs to decide, with a human, what an affiliate is actually for
before writing a route. The likely surface is their own referrals and their own
commissions — `affiliates` (033) and `commission_ledger` (014) already exist. Two rules
are not negotiable:

* Every query scopes to the signed-in affiliate's own `affiliate_id`, from the session.
  `readHandler`'s `principals` option does **no** automatic scoping on purpose — the
  endpoint's own SQL has to say who it is for, in the open.
* An affiliate must never reach a client's identity, credit file or bank data. Those are
  a different person's records and an affiliate is an outside party.

---

## W2 — change manifest

### Files added

| File | What it is |
|---|---|
| `scripts/journeys/extract.mjs` | Reads the routing table and every handler's gate, from source |
| `scripts/journeys/render.mjs` | Turns those facts into readable pages with Mermaid |
| `scripts/journeys/generate.mjs` | `build` / `stale` / `write` + CLI, mirroring `scripts/diagrams/` |
| `scripts/journeys/generate.test.mjs` | 18 tests, including the staleness guard |
| `docs/journeys/*-actual.md` | 8 journey pages, generated |
| `docs/journeys/README.md` | Index + findings, generated |
| `docs/journeys/CHANGELOG.md` | Hand-maintained, per CLAUDE.md §4 |

### Files changed

| File | Change |
|---|---|
| `package.json` | Added `journeys` and `journeys:check` scripts |

### Exports added

`scripts/journeys/extract.mjs` — `extractAll`, `routes`, `roleSets`, `gateFor`, `methodsFor`,
`reaches`, `code`, `middlewareSuperRoles`, `JOURNEYS`, `PREFIX_ROUTED`, `REPO`
`scripts/journeys/render.mjs` — `renderAll`
`scripts/journeys/generate.mjs` — `build`, `stale`, `write`, `OUT_DIR`

### Routes affected

None. This workflow adds no endpoint and changes no gate. It only reads them.

### Journeys impacted

All eight. They did not exist before; they exist now, generated from code.

---

## Decisions

1. **Actual files only.** No `-intended.md` was created. CLAUDE.md §4 says intended
   journeys are hand-authored and agents do not edit them — an agent writing one would be
   authoring the source of truth it is meant to be checked against. A test enforces this.
   **Consequence worth stating: nothing compares what the system does against what it was
   meant to do.** These pages are a mirror, not a test.

2. **Generated, not hand-written.** Follows the precedent already set by
   `scripts/diagrams/` ("GENERATED ... do not edit by hand"). The staleness check runs in
   `npm test`, so adding a route or changing a role gate fails the suite until the pages
   are rebuilt.

3. **A separate generator from `scripts/diagrams/`.** `scripts/diagrams/generate.test.mjs`
   asserts the adapter population is exactly 8. Folding journeys in would put a shared,
   brittle test in the path of every journey change.

---

## Findings — for a human, not for an agent to fix

1. **`role-sales-manager` does not exist — and that is FUTURE WORK, not a mistake.**
   **Owner decision, 2026-07-31: the role is planned. Sarah runs sales. It stays listed in
   CLAUDE.md §4, and it is NOT to be built yet.** The journey page says so. Nothing here is
   waiting on it and no agent should create the role on its own initiative.

2. **Nothing admits an `affiliate`.** Confirmed a real gap by the owner and scoped as W4
   above. **Not started — the buildout finishes first.**

3. **`/api/partner-brand` — FIXED.** It was worse than first reported and also better: the
   PUT was gated the whole time by an inner `canWrite()` check, and the **GET was not**, so
   any signed-in employee could read any partner's trading name, registered address,
   support email and domain by passing a `partner_id`. Now owner and admin on both methods,
   via a second `requireRole` call. Verified to break no screen first: `shell.js`
   `applyBrand()` returns early unless `staff.partner_id` is set, and `staff` has no such
   column, so the read was never called from a staff session.

   **Why the journeys reported it as "no role check" rather than "the read has no role
   check":** the generator reads the gate at the handler's **entry**. That is the honest
   thing to report — an inner check on one method does not gate the other — and it is
   exactly what made this easy to miss by eye. A per-method reader would be a real
   improvement to `scripts/journeys/extract.mjs` and is recorded here as a to-do.

4. **Four routes are genuinely open and three more need no sign-in.** The open ones are
   the sign-in routes and the health check. The other three verify a signature instead of
   a session: the signed document link, the provider webhook, and Inngest. Recorded so
   "no `requireAuth`" is never read as "open to the world".

5. **There is no automatic super-role on the read path.** An owner reaches those routes
   only because `owner` is written into each `ROLE_SETS` value by hand. Remove it from one
   and the owner silently loses that route. A *separate* curried `requireRole` in
   `src/http/middleware/requireRole.mjs` does carry `SUPER_ROLES`; `/api/inquiry` is the
   one route using it. Two functions with the same name and different behaviour.

---

## Owner decisions — settled, do not re-litigate

| Date | Decision |
|---|---|
| 2026-07-31 | `role-sales-manager` is **future work**, not a stale entry. Stays in CLAUDE.md §4. Do not build it yet. |
| 2026-07-31 | The affiliate gap is real. Scoped as W4. **Do not start** until the buildout is finished. |
| 2026-07-31 | `/api/partner-brand` gating to owner+admin was **not** intended to be open. Fixed now. |
| 2026-07-31 | `claude/postgres-superuser-migration-lzm6xt` stays **unmerged**. The owner runs its runbook against production first, then it merges. Nobody merges it before that. |

## Blockers

None. W1 is claimed and unblocked; W4 is deliberately parked.

### To-do worth recording

`scripts/journeys/extract.mjs` reports the gate at a handler's **entry** only. A handler
whose methods are gated differently — as `/api/partner-brand` was — is described by its
weakest gate. That is the safe direction to be wrong in, but a per-method reader would
have named the read specifically.
