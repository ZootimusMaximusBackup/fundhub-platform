# Delete Command Center screen — 2026-08-17

Owner ask: remove the Command Center screen, its nav entry, and any route
pointing at it. Report references first. Report shared dependencies before
deleting.

Owner-set: the screen is redundant. That call is final and not re-litigated here.

## Status

| # | Unit | Owner | Status |
|---|------|-------|--------|
| 1 | Find frontend refs (screen file, nav, links) | Fixer | done |
| 2 | Find route + API handler refs | Fixer | done |
| 3 | Find backend module consumers | Fixer | done |
| 4 | Find test + e2e refs | Fixer | done |
| 5 | Find doc + journey refs | Fixer | done |
| 6 | Delete + prove + deploy | Fixer | blocked — 14 other sessions editing the same files |

## Blocker — the tree is not mine alone

**Fourteen other Claude sessions are running against this repo right now**,
started within a few minutes of each other. They are actively writing the same
files this task needs to change.

Evidence:

- `ListAgents` reports 14 peer sessions on `fundhub-platform`, all ~48 min old.
- `git status` was clean at 20:27 when this session started. By 21:13 it showed
  **50+ modified files** that this session did not touch.
- All 34 screens under `public/app/` were re-stamped in one batch at 21:00:14 —
  a sidebar regeneration run by another session.
- Untracked boards for other in-flight tasks are present: `contracts-dedup`,
  `subscriptions-removal`, `demo-mode-removal`, `creative-factory-declutter`,
  `crm-feel`, `social-studio-plain`, `beta-banner-removal`, `hiring-repurpose`.
- `docs/SIDEBAR-STRUCTURE.md` and `docs/journeys/CHANGELOG.md` — two files this
  task must edit — were already modified by another session.

Consequences:

1. **Push would ship other people's unfinished work.** A commit here cannot be
   limited safely by `git add -A`; 50+ files of half-done contracts, demo-mode
   and subscriptions work would go to `main`.
2. **`netlify deploy --build --prod` builds the working directory.** It would
   push that same unfinished state to the live site.
3. **The sidebar is contested.** `shell.js` holds `SIDEBAR_HTML`, the template
   every screen is stamped from. Another session re-stamps from it. Whichever of
   us writes last wins, and the other change is silently lost.

Action taken: the two edits made in this session (`public/app/shell.js`,
`src/lib/rbac.ts`) were saved to a patch and the files restored, so no other
session sweeps a half-finished Command Center removal into its commit.

Patch parked at:
`<session scratchpad>/command-center-removal.patch`

## Resolved — landing page

**Command Center is the landing page for the owner and admin roles.**

Owner decision 2026-08-17: owner and admin land on `pipeline.html` instead.
Set in `public/app/shell.js` HOME map and `src/lib/rbac.ts` ROLE_DEFAULTS.

Two places set it:

- `public/app/shell.js:261-262` — `HOME` map, `owner:` and `admin:`
- `src/lib/rbac.ts:175` — `ROLE_DEFAULTS.admin`

Deleting the screen without choosing a replacement means owner and admin log
in and land on a page that does not exist.

Also: the fundhub logo in the top-left of **every** screen links to
`command-center.html` as its home target (`sidebar.fragment.html:6` and the
same line copied into 33 other screens). Those all need a new target too.

The logo repoint is already handled at runtime by `shell.js` — it rewrites the
logo href to the role's home, so only the static fallback needs changing.

## Correction to an earlier assumption

`api/read/finance-command.mjs` and `src/finance/command-center.mjs` are **not**
the Command Center screen's backend. Name collision only. They power
`finance-os.html` (Finance OS) and `finance-ask`. Confirmed by reading the
call sites:

- `public/app/finance-os.html:532` — `FHData.read("finance-command", mmParams)`
- `public/app/finance-os.html:939` — calls `/api/read/finance-ask`
- `api/read/finance-ask.mjs:27` — `import { commandCenter } from "../../src/finance/command-center.mjs"`

`public/app/command-center.html` never calls `finance-command`. **These files
must not be deleted.**

## Shared context brief — what the screen actually reads

The Command Center screen has **no exclusive backend code**. Every endpoint it
reads is shared with another screen:

| Screen call | API path | Also used by |
|---|---|---|
| `FHData.kpis("today")` (line 1089) | `/api/dashboard/kpis` | `ops-admin.html:609` |
| `FHData.pipeline(key)` (line 1181) | `/api/dashboard/pipeline` | `pipeline.html:1731` |
| `FHData.read("agents")` (line 1298) | `/api/read/agents` | `agent-editor.html:867` |

So nothing in `api/`, `src/`, or the `ROUTES` map in
`netlify/functions/api.mjs` gets deleted. Frontend and config only.

## Full reference manifest

### The screen itself
- `public/app/command-center.html` — delete
- `wireframes/command-center.html` — design wireframe, not shipped

### Nav + logo links — 34 files in `public/app/`
Each carries two references: the logo `home` href and the sidebar nav item.

`shell.js` (7 refs), `sidebar.fragment.html`, `agent-editor.html`,
`affiliate.html`, `automations.html`, `brand-studio.html`, `calendar.html`,
`campaign-manager.html`, `client-control-panel.html`, `closer-call.html`,
`closer-dashboard.html`, `command-center.html`, `company-brain.html`,
`consent-capture.html`, `content-admin.html`, `contracts.html`,
`creative-factory.html`, `documents.html`, `finance-os.html`, `galaxy.html`,
`hiring.html`, `inquiry-remover.html`, `journeys.html`, `lenders.html`,
`messaging.html`, `my-numbers.html`, `ops-admin.html`, `partner-galaxy.html`,
`pipeline.html`, `products-commissions.html`, `sales-floor.html`,
`sample-data.html`, `social-studio.html`, `staff-teams.html`,
`template-editor.html`

Plus a back-link: `public/app/subscriptions.html:257` — `← Command Center`

### Role + permission config
- `public/app/shell.js:24, 38, 146` — screen order / allow lists
- `public/app/shell.js:261-262` — `HOME` landing map (**the blocker**)
- `public/app/shell.js:1010` — comment referencing the screen
- `src/lib/rbac.ts:16, 44` — role permission arrays
- `src/lib/rbac.ts:85` — label map, `'Command center'`
- `src/lib/rbac.ts:133` — `Operations` nav group
- `src/lib/rbac.ts:175` — `ROLE_DEFAULTS.admin` (**the blocker**)

### Tests
Dedicated (delete):
- `e2e/command-center.spec.mjs`

Shared — must be **edited**, not deleted:
- `e2e/screens-smoke.spec.mjs:10, 64`
- `e2e/sidebar-roles.spec.mjs:121, 146-147`
- `e2e/verification-roles.spec.mjs:37, 47`
- `e2e/crm-flows.spec.mjs:274`
- `e2e/demo-mode.spec.mjs:5`
- `e2e/integration-round.spec.mjs:98, 150, 165`
- `e2e/verification-security.spec.mjs:84, 93, 100, 102`
- `src/http/app-client-carry.test.mjs`
- `src/http/crm-html.test.mjs`

Not ours — keep:
- `src/finance/command-center.test.mjs` (tests the Finance OS module)
- `src/http/finance-command.pg.test.mjs` (tests the Finance OS endpoint)

### Build artifacts (regenerate, do not hand-edit)
- `dist/fundhub-frontend.html` — built by `scripts/build-artifact.mjs`
- `.netlify/functions-serve/api/public/app/command-center.html` — build cache

### Docs
- `docs/SIDEBAR-STRUCTURE.md:30, 59` — live doc, needs updating.
  Line 59 explicitly records a past decision to keep both `sales-floor.html`
  and `command-center.html`. That decision is now reversed by the owner.
- Historical audit/evidence folders under `docs/workflows/**-evidence/` are
  dated records. **Not rewritten.**

### Journeys
No `docs/journeys/*-intended.md` file references Command Center. Checked all
eight tracked journeys. No CLAUDE.md §4 conflict.

## Process note

The first verify pass in this batch was written badly: the sub-agent prompts
told verifiers to assume "safe to delete" unless they found hard proof of a
dependency. That is backwards for a deletion check. Six of those checks were
blocked by the safety classifier, correctly. Their output was discarded and
none of it informs this manifest. Everything above comes from the read-only
sweeps and direct file reads.

## Change manifest

Nothing committed. Working tree restored to how this session found it.
No file deleted. No push. No deploy.

The patch parked in the scratchpad contains the finished edits to:

- `public/app/shell.js` — BETA_PAGES, SIDEBAR_HTML template, ALL list, owner
  beta rail, HOME map (owner + admin -> pipeline.html), stale comment
- `src/lib/rbac.ts` — admin + staff route arrays, label map, Operations nav
  group, ROLE_DEFAULTS.admin -> app/pipeline.html

Still to do once the tree is quiet: delete the screen file, strip the nav item
from 34 screens, delete `e2e/command-center.spec.mjs`, edit 9 shared specs and
2 src tests, update `docs/SIDEBAR-STRUCTURE.md`, regenerate `dist/`.
