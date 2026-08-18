# Subscriptions screen removal — 2026-08-17

Owner: Chris. Decision: the Subscriptions screen comes out. Client payment
tracking belongs in Finance OS, which is being rebuilt separately.
Recorded as owner-set. Not up for re-litigation.

## Scope

Remove: the screen, the nav entry, and any route pointing at it.
Do NOT remove: any API, table, or shared file that something else uses.
Report everything that referenced it before deletion.

## Task list

| # | Task | Owner | Status |
|---|------|-------|--------|
| W1 | Screen, nav, routes sweep | agent | done |
| W2 | API and server sweep | agent | done |
| W3 | Tests, docs, journeys sweep | agent | claimed |
| W4 | Shared-use check (waits on W1+W2) | Fixer | done |
| W5 | Delete, prove, push, deploy | Fixer | blocked — payment links decision |

## Rules for this batch

- W1/W2/W3 are read-only. They do not edit code.
- Each writes its own evidence file under
  `docs/workflows/subscriptions-removal-2026-08-17-evidence/`.
  Separate files on purpose — three agents appending to one file clobber it.
- W4 is strict: when in doubt, KEEP. A deleted live API is worse than a
  dead one left in place.
- W5 owns the only diff.

## Shared context brief (ground phase, before agent reports)

Repo shape, learned from the parallel `delete-command-center-2026-08-17.md`
board (same kind of task, different screen):

- Screens are plain HTML files at `public/app/<name>.html`.
- API handlers live at `api/read/<name>.mjs` (and sibling verbs).
- Backend data modules live under `src/<domain>/`.
- Endpoint tests live at `src/http/<name>.pg.test.mjs`.
- Browser tests live at `e2e/<name>.spec.mjs`.
- `wireframes/<name>.html` is design-only, not shipped code.

Known repo traps that apply to THIS deletion (CLAUDE.md §12):

- `netlify/functions/api.mjs` holds a hardcoded `ROUTES` map. A handler and
  its route entry must be removed together or `src/http/routes.test.mjs` fails.
- `src/http/routes.test.mjs` fails if a handler is neither routed nor on the
  explicit allow-list.
- `npm test` globs `src/**` and `scripts/**` only. A test under `api/` never
  runs and gives a false green.
- `npm run journeys:check` and `npm run diagrams:check` may enumerate screens.
  Both must be run after deletion, not just lint and test.

## Baseline, measured before any change

Commit: `7be91a0`, clean tree (only untracked workflow boards).
Environment: local, macOS, node v22.21.1, `DATABASE_URL` unset.

- `npm run lint` -> exit 0. 1283 files parse clean.
- `npm test` -> 5552 tests, 5546 pass, **3 fail**, 3 skipped. Suite exits 1.
  pg tests skip because `DATABASE_URL` is unset.

The 3 baseline failures, all PRE-EXISTING and none about subscriptions:

1. `scripts/journeys/generate.test.mjs:146` — "no route's gate is left
   unverified". Cause: `gifts/message-blaster` references a gate whose shape
   the generator does not recognise. Fallout from the recent message-blaster
   commits, not this task.
2. `src/http/health-migrations.test.mjs:70` — `db/expected-migrations.mjs` is
   stale versus what `db/` holds. Fix is `npm run migrations:manifest`, which
   is NOT this task and NOT mine to run under owner-scope-minimal-diff.
   NOTE: this makes the migration manifest a live tripwire — if this deletion
   removed a migration file, this same test would change its complaint and the
   two causes would be impossible to tell apart. So: do not touch migrations.
3. `src/http/read-endpoints-org-scope.test.mjs:184` — `company-brain-affiliate.mjs`
   no longer passes `orgId` to its store. Unrelated multi-tenant drift.

After deletion the suite must still show exactly these 3 and no others.

Any failure after deletion gets diffed against this. CLAUDE.md §12 warns the
failure count moves with the environment, so the only number that counts is
the one measured here, on this machine, at this commit.

## Findings

### W2 — API and server (done)

Full detail: `subscriptions-removal-2026-08-17-evidence/W2-api-server.md`

Endpoints (all gated to owner/admin, org from `staff.org_id`):

| Path | Handler | ROUTES line |
|---|---|---|
| `/api/finance/subscriptions` | `api/finance/subscriptions.mjs` | 615 |
| `/api/finance/cards` | `api/finance/cards.mjs` | 616 |
| `/api/payment-links` | `api/payment-links.mjs` | 675 |
| `/api/finance/soft-pull` | `api/finance/soft-pull.mjs` | 545 |

No handler/route mismatch. `ALLOWED_UNROUTED` is empty, so every handler is routed.

**DANGER, recorded loudly:** one Netlify function serves all of `/api/*`. A
handler deleted without its ROUTES entry leaves a dangling import that 502s
the ENTIRE API — including login. Handler and route entry live and die together.

Database: table `subscriptions` (migration 075), table `client_cards` (076,
which also adds a foreign key back onto `subscriptions`), a `subscription_id`
column on `soft_pull_requests` (077, deliberately no foreign key), and demo
flags (153). Nothing in `db/schema/` or `db/seed/`.

Background jobs: **none**. Zero of 117 workflow files touch subscriptions.
No billing run, no dunning, no renewal or expiry job exists.

Shared modules:
- `src/subscriptions/index.mjs` — pure helpers.
- `src/subscriptions/store.mjs` — database layer.

**Three traps W2 flagged for the deletion step:**

1. `api/finance/cards.mjs` looks unrelated by name but is not. Its `attach`
   action runs `UPDATE subscriptions`, and it renders on `subscriptions.html`.
2. `src/subscriptions/index.mjs` has TWO consumers outside this feature —
   `api/payment-links.mjs:31` and `src/sales/closer-deck.mjs:7`, both for
   `formatPrice` / `priceToCents`. Deleting that module breaks unrelated screens.
3. `soft_pull_requests.subscription_id` has no foreign key. Dropping the table
   would leave dangling ids and Postgres would never complain.

Server-side tests that exist: `src/http/subscriptions-endpoints.test.mjs`,
`src/http/subscriptions-endpoints.pg.test.mjs`, `src/http/subscriptions-screen.test.mjs`,
`src/subscriptions/index.test.mjs`, `src/subscriptions/store.pg.test.mjs`.

Demo seeders write subscriptions rows: `src/demo/seed-ui-coverage.mjs`,
`src/demo/platform-seed.mjs`.

### W1 — screen, nav, routes (done)

Full detail: `subscriptions-removal-2026-08-17-evidence/W1-screen-nav-routes.md`

Architecture: there is NO client-side router. `public/app/` is one HTML file
per screen and the URL is the filename. The sidebar is GENERATED —
`public/app/sidebar.fragment.html` is canonical and `scripts/sync-sidebar.mjs`
stamps it into all 34 screens plus the `SIDEBAR_HTML` constant in `shell.js`.
Do not hand-edit the 34 copies. Edit the fragment, run the sync script.

Delete list:
- `public/app/subscriptions.html` — whole screen, markup + CSS + wiring in one file.
- `src/http/subscriptions-screen.test.mjs` — reads only that file.

Nav: `public/app/sidebar.fragment.html:26` (Funding group), then regenerate.
Hand-edit four lists in `public/app/shell.js`: `BETA_PAGES` L23, `ALL` L61,
`OWNER_ADMIN_ONLY` L131, `CLIENT_SCREENS` L384.
Sidebar + shell.js must land in ONE commit or `src/http/app-nav-reachability.test.mjs` goes red.

No redirects, no deep links. The sidebar row is the only way in.

Git origin — **the owner is right, he did not create it.** Added 2026-07-31 in
commit `f992c13`, author AND committer `Claude <noreply@anthropic.com>`,
co-author `Claude Sonnet 5`. Subject: "[FINANCE OS BUILDOUT] Scaffold: eight new
routes registered, six screens navigable...". Landed straight on `main`.
An agent built six screen shells in one pass because ~7,000 lines of tested
logic had no UI. Five were later absorbed into Finance OS by `26b3c1e`; this
one was kept. The payment-links panel was added later by `64dd8a6` (2026-08-02,
also Claude). Every `Zooted` commit touching the file is a later sidebar sweep,
not authorship.

### W4 — shared use (done, verified directly by Fixer, not just reported)

| Thing | Verdict | Who else uses it |
|---|---|---|
| `src/subscriptions/index.mjs` | **KEEP** | `src/sales/closer-deck.mjs:7`, `api/payment-links.mjs:31` |
| `src/subscriptions/store.mjs` | **KEEP** | `api/finance/cards.mjs:69`, `api/finance/subscriptions.mjs:46` |
| `api/finance/subscriptions.mjs` | **KEEP** | routed at `netlify/functions/api.mjs:615` |
| `api/finance/cards.mjs` | **KEEP** | routed at L616; writes `subscriptions` |
| `api/payment-links.mjs` | **KEEP** | routed at L675; live money feature |
| `src/handlers/payment-links.mjs` | **KEEP** | Commas webhook. Marks links paid. Runs with no UI. |
| `public/app/finance-os.css` | **KEEP** | `finance-os.html` also loads it |
| `public/app/shell.js`, `data.js`, `crm-sidebar.css`, `fundhub-brand.css` | **KEEP** | 34-44 screens each |
| `db/migrations/075,076,077,153` | **KEEP** | never edit or delete an applied migration |
| `public/app/subscriptions.html` | **DELETE** | nothing imports it |
| `src/http/subscriptions-screen.test.mjs` | **DELETE** | tests only the deleted file |

Correction to W2: it reported `src/handlers/` does not exist. It does, and it
contains `payment-links.mjs`, the live Commas webhook handler.

## BLOCKER — owner decision needed before W5 runs

**COMPLIANCE REVIEW REQUIRED** (CLAUDE.md §7 — payment rails)

`subscriptions.html` is the ONLY front-end for THREE things, verified by
grepping all of `public/`:

1. Start / change / cancel a client's subscription.
2. Add / attach / remove a client's card.
3. **Create, send, copy and expire a client payment link.**

Number 3 is a live money-moving feature with its own spec
(`docs/PAYMENT-LINKS-SPEC.md`), itself marked COMPLIANCE REVIEW REQUIRED.
Deleting the screen removes the only way staff can ask a client for money.
The webhook keeps working, so links already sent still get marked paid —
but no new link can be created.

The owner's instruction named the Subscriptions screen. It did not mention
payment links. This is missing information, not a decision he made, so it
goes back to him rather than being guessed at.

Status: W5 blocked pending the answer.

_(W3 pending)_

## Blockers and open questions

_(none yet)_

## COLLISION — another session is editing the same file, right now

Detected 2026-08-17 20:49. `public/app/sidebar.fragment.html` was written at
20:48:43, 75 seconds earlier, by a session that is not this one.

That session removed the **Demo Mode** (`sample-data.html`) nav row from the
canonical fragment. Its own board — `docs/workflows/demo-mode-removal-2026-08-17.md`
— says "**BLOCKED ON CHRIS**" and "Phase 2 has not started. Nothing written yet."
So the fragment edit is ahead of its own approval gate.

Why this matters here: `scripts/sync-sidebar.mjs` stamps the whole fragment into
all 33 screens plus `shell.js`. Running it (which this task must, to remove the
Subscriptions row) propagated the Demo Mode removal into every screen too.

**Handling — this task commits ONLY its own change.**

- Staged: the Subscriptions nav row removal, everywhere. Nothing else.
- Left in the working tree, uncommitted, untouched: the Demo Mode row removal,
  and the in-flight content edits in `campaign-manager.html`,
  `closer-dashboard.html`, `creative-factory.html`, `social-studio.html`.
- Not reverted. Another session's work is not this task's to undo.

**Deploy consequence, recorded before it bites anyone:** `netlify deploy --build
--prod` builds from the LOCAL working tree, so running it here would push the
unapproved Demo Mode removal live. This task ships by pushing to `main` and
letting Netlify build from git, which carries only the committed change.

## STOPPED BEFORE PUSH — 2026-08-17 21:0x

The deletion is built and proven. It is NOT committed and NOT deployed.

### What proved out

Measured on this machine, `DATABASE_URL` unset.

| | Baseline at HEAD `8659d5f` | After the change |
|---|---|---|
| Failing tests | **18** | **11** |
| Failing suites | 7 | 5 |
| `npm run lint` | clean | clean (1296 files) |
| `src/http/routes.test.mjs` | pass | 15 pass / 0 fail |
| nav reachability + sidebar match + client carry | **FAILING** | **97 pass / 0 fail** |

The change ADDED zero failures. It FIXED two suites that were already red at
HEAD: `hiring.html`, `my-numbers.html`, `sales-floor.html` and `closer-call.html`
had stale sidebars, left behind when the Lenders commits changed the nav without
restamping every screen. Running `sync-sidebar.mjs` repaired them as a side
effect — unavoidable, since that script is the only sanctioned way to change a
nav row.

The 5 suites still failing were all failing before this task touched anything:
journeys stale, journey extraction, two Contracts screen suites, and one
org-filter drift. None are subscriptions-related.

### Why it stopped short of push and deploy

1. **The working tree is shared with at least three other live sessions.** During
   this task the tree accumulated in-flight work on contracts, pipeline counts,
   company brain and demo mode — including `netlify/functions/api.mjs`.
2. **This task's work was destroyed once already.** At 20:52 another session
   committed, moved HEAD forward 5 commits, and swept the whole dirty tree into
   `stash@{0}` — this task's edits included, mixed with its own. The work was
   redone from scratch afterwards.
3. **`sidebar.fragment.html` now carries a second, foreign change** — Contracts
   moved from Funding to Admin and renamed "Contract templates". Because
   `sync-sidebar.mjs` stamps the whole fragment, all 33 screens now hold that
   change alongside this one. Whole-file staging would commit it.
4. **Pushing to `main` auto-deploys production**, and `main` is currently red.

Committing cleanly from here needs per-file blob surgery across ~40 files while
three sessions keep writing. That is the thrashing CLAUDE.md §8 forbids.

### How to finish — 5 minutes on a quiet tree

1. Park the other sessions. Let them commit or stash their own work.
2. Confirm clean: `git status --porcelain` shows nothing but this board.
3. Take a fresh baseline: `npm test`, record the failure count.
4. Run `docs/workflows/subscriptions-removal-2026-08-17-evidence/REDO.sh`.
5. Verify with the commands it prints. Failures must not exceed the baseline.
6. Commit, push. Netlify builds from git — do NOT run
   `netlify deploy --build --prod`, which would build from the dirty local tree.

### Already delivered and safe on disk

- `docs/FINANCE-OS-REBUILD-HANDOVER.md` — what Finance OS must rebuild.
- `.../REDO.sh` — the exact change, re-runnable, with assertions.
- This board, plus the W1/W2/W3 evidence files.

| # | Task | Owner | Status |
|---|------|-------|--------|
| W5 | Delete, prove, push, deploy | Fixer | built + proven; **push/deploy held** |
