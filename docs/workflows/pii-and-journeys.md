# pii-and-journeys — shared board

Two follow-ups from the banking compliance batch. Independent: no shared files.

---

## Task list

| # | Task | Owner | Branch | Status |
|---|------|-------|--------|--------|
| W1 | Fix the SSN reveal log — `revealSsn()` runs with autocommit | unclaimed | `claude/pii-ssn-reveal-log` | **queued** — waits for PR #59 |
| W2 | `docs/journeys/`, actual files only, generated from code | journeys-actual-generated | `claude/journeys-actual-generated` | **done** |

### Why W1 waits

The correct transaction helper it needs — `src/db/with-transaction.mjs` — only exists on
PR #59. Starting W1 first means writing a *third* copy of that helper, which is the
duplication CLAUDE.md §8 warns about. Once #59 merges, W1 imports it and deletes the
broken local copy.

**W1 is not started.** The prompt for it is written and ready to paste into a fresh session.

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

1. **`role-sales-manager` does not exist.** CLAUDE.md §4 tracks it as one of eight
   journeys. Nothing in `src/`, `api/` or `db/` defines a sales-manager role — the name
   does not appear at all. No diagram was drawn. Either the role was planned and never
   built, or it was renamed and §4 should stop listing it.

2. **Nothing admits an `affiliate`.** An affiliate is a real account kind and can be
   issued a session, but no endpoint anywhere names `affiliate` as an accepted principal.
   They can sign in and reach nothing. `src/http/read-api.mjs` describes this exact
   failure in its own comments and names `principals` as the fix — applied to `client` and
   `partner`, not to `affiliate`.

3. **`/api/partner-brand` is gated by `requireAuth` alone.** Any signed-in employee of any
   role can read and write a white-label partner's brand tokens — a setter included. It is
   not a broken gate like the `read/tradelines` case; there is simply no role check. Worth
   a decision.

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

## Blockers

None for W2.

W1 is blocked only by ordering — see above.
