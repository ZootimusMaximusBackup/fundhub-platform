# Frontend ↔ Backend Wiring Audit

Read-only audit. Measured 2026-08-02 against `main` at `033d25a`, in a git
worktree on branch `audit/wiring`. Nothing outside `docs/WIRING-AUDIT.md` was
changed.

## How this was measured

- **Every backend route**: `netlify/functions/api.mjs`'s `ROUTES` map is the
  single source of truth for what `/api/*` paths exist (its own header
  explains why — a handler file not in this map 404s everywhere, and that has
  shipped broken twice before). 85 static route keys, plus 3 dynamic
  prefix routes handled separately in `handler()`: `webhooks/:provider`,
  `documents/:id`, and `inngest`. As of this pass, every file under `api/` is
  routed — there is nothing on the "handler exists but isn't in ROUTES" list
  today.
- **Every frontend call**: `public/app/*.html` (30 screens) load two shared
  files — `shell.js` (session/nav chrome) and `data.js` (`window.FHData`, the
  shared read/write client with a documented `{ok, source, data, error}`
  contract). Most screens call the backend through `FHData.read()`/`.write()`/
  named wrappers (`FHData.commissions()`, `FHData.staff()`, etc.) rather than
  calling `fetch()` directly, so a plain `grep fetch(` undercounts real wiring
  by a wide margin. Two screens (`campaign-manager.html`, `subscriptions.html`)
  carry their own hand-rolled `apiGet()`/`apiGet`-alike because `data.js`
  doesn't yet have a reader for `/api/campaigns/*` or `/api/finance/*` (both
  screens say so in their own comments). I traced calls through all three
  patterns — `FHData.*`, `apiGet`/hand-rolled fetch, and raw `fetch()` — before
  concluding a screen doesn't call something.
- **Legacy/reference pages out of scope**: `public/fh.js` and its demo-mode
  API client are not used by any file in `public/app/` — every `public/app/`
  screen loads `shell.js` + `data.js` instead. `fh.js` appears to serve older
  top-level pages (`public/dashboard.html`, `public/crm.html`) which the task
  scoped out (`public/app/*.html` only). `public/app/index.html` is a
  documented redirect stub, not a data screen. `public/app/sample-data.html`
  is a documented static design-reference page (its own `<h1>` is "Sample
  Data"), not a feature screen — excluded from "lying" findings for that
  reason.

## Findings

### BROKEN — screen calls an endpoint that doesn't exist
**None found.** Every literal `/api/...` path reachable from `public/app/*`
(via `fetch()`, `apiGet()`, or an `FHData` wrapper) resolves to a real entry
in `ROUTES` or one of the three prefix routes. No typos, no stale paths.

### LYING — screen renders data as real/live with no fetch behind it

| # | File | Line(s) | Description | Severity |
|---|------|---------|-------------|----------|
| L1 | [public/app/hiring.html](public/app/hiring.html:983) | 969–983+ (`var APPS = [...]`) | Zero `fetch`/`FHData` calls anywhere in the file (confirmed: `grep -c fetch(` = 0). Renders a large hardcoded `APPS` array — explicitly commented "Shaped exactly as GET /api/hiring/candidates returns them" — as the candidate pipeline. All six backend hiring endpoints (`hiring/candidates`, `hiring/application`, `hiring/postings`, `hiring/decisions`, `hiring/funnel`, `hiring/bench`) are built, routed, and never called by this or any other screen. | **lying** |
| L2 | [public/app/creative-factory.html](public/app/creative-factory.html:1652) | 1639–1658, and throughout (status tiles) | Zero `fetch` calls in the entire 2,763-line file. The screen displays its own status board claiming each of the four Creative Factory endpoints is `state:'readable'`/`tone:'ok'` (`api/creative/jobs.mjs`, `library.mjs`, `approvals.mjs`, `brand-kits.mjs`) — i.e., it actively asserts these are wired and healthy while never issuing a single network request to verify or populate that claim. This is worse than silently hardcoded data: the screen tells the viewer "readable/ok" about a connection that was never opened. | **lying** (compounded — false status claim, not just static data) |
| L3 | [public/app/content-admin.html](public/app/content-admin.html:282) | 282–283 | `<div class="sv" id="kVideos">5</div>` and `<div class="sv" id="kTiers">4/4</div>` are static literals in the HTML — no script anywhere in the file populates `#kVideos`/`#kTiers` from a fetch (file has 0 `FHData` refs, 0 `fetch` calls). Presented as live stats ("in the library", "plus a default") with no backend behind them at all — there is no `api/content/*` route in `ROUTES`. | **lying** |
| L4 | [public/app/galaxy.html](public/app/galaxy.html) | whole file | 0 `FHData` refs, 0 `fetch` calls, 1,939 lines. No corresponding backend resource exists under `ROUTES` for a "galaxy" concept at all (distinct from `partner-galaxy.html`, which does wire `FHData.partners()`). Entirely static. | **lying** (no backend even exists to wire to — see also D-extra below) |
| L5 | [public/app/social-studio.html](public/app/social-studio.html:688) | 682–690 | Self-documents its own gap ("No social API... even `/api/campaigns/action-log?target_type=social_post`... is unreachable on the deployed target"), which is honest — but the claim is **stale**: `campaigns/action-log` **is** routed today (`netlify/functions/api.mjs` ROUTES, confirmed present). The screen is telling viewers a route is unreachable when it now exists. Low severity since it's a documented gap, not a silent one, but the specific factual claim is wrong. | **cosmetic** (stale self-documentation, not a live deception) |

### DEAD — backend endpoint no screen calls

Verified by exhaustive string search (resource name, wrapper function name,
and full path) across every file in `public/app/`, `public/fh.js`,
`shell.js`, and `data.js` — not just a `fetch(` grep, since most calls go
through `FHData` wrappers that build the path from a resource name.

| # | Endpoint | Handler | Notes |
|---|----------|---------|-------|
| D1 | `GET /api/read/invoices` | `api/read/invoices.mjs` | `FHData.invoices()` wrapper exists in `data.js`; nothing calls it. |
| D2 | `GET /api/read/funding-rounds` | `api/read/funding-rounds.mjs` | `FHData.fundingRounds()` wrapper exists; nothing calls it. |
| D3 | `GET /api/read/finance-os` | `api/read/finance-os.mjs` | Superseded in practice — `finance-os.html` (the screen this endpoint is named for) reads `read/money-map` + `read/finance-command` instead and never calls `read/finance-os`. The route comment in `api.mjs` itself says money-map "gathers what read/finance-os... already serve," which is consistent with this being an intentionally-superseded predecessor endpoint nobody removed. |
| D4 | `GET /api/read/banking-surface` | `api/read/banking-surface.mjs` | Same pattern as D3 — folded into `read/money-map`, never called directly. |
| D5 | `POST /api/shifts` | `api/shifts.mjs` | No screen references `shifts` at all. |
| D6 | `POST/GET /api/hiring/funnel` | `api/hiring/funnel.mjs` | Part of the entirely-unwired Hiring backend (see L1). |
| D7 | `POST /api/banking/revoke` | `api/banking/revoke.mjs` | No "disconnect bank" button/call anywhere in `public/app/`. Destructive action, built and gated, unreachable from the UI. |
| D8 | `POST /api/privacy/erasure` | `api/privacy/erasure.mjs` | No screen exposes a client-erasure action. |
| D9 | `POST/GET /api/finance/cashflow` | `api/finance/cashflow.mjs` | Not called by `finance-os.html` or any other screen (which reads cashflow-adjacent data via `money-map`/`finance-command` instead). |
| D10 | `POST/GET /api/banking/accounts` | `api/banking/accounts.mjs` | Distinct from `finance/bank-accounts` (which **is** wired, in `finance-os.html`) — this is the separate "manual entry" writer per its own `ROUTES` comment, and it has no caller. |
| D11 | `GET /api/creative/library` | `api/creative/library.mjs` | See L2 — referenced only in `creative-factory.html`'s comments/status labels, never actually fetched. |
| D12 | `GET /api/creative/brand-kits` | `api/creative/brand-kits.mjs` | Same as D11. |
| D13 | `GET /api/creative/jobs` | `api/creative/jobs.mjs` | Same as D11. |
| D14 | `GET /api/creative/approvals` | `api/creative/approvals.mjs` | Same as D11. |
| D15 | `POST/GET /api/hiring/candidates` | `api/hiring/candidates.mjs` | See L1. |
| D16 | `POST/GET /api/hiring/application` | `api/hiring/application.mjs` | See L1. |
| D17 | `POST/GET /api/hiring/postings` | `api/hiring/postings.mjs` | See L1. |
| D18 | `POST/GET /api/hiring/decisions` | `api/hiring/decisions.mjs` | See L1. |
| D19 | `POST/GET /api/hiring/bench` | `api/hiring/bench.mjs` | See L1. |

**Not counted as dead** (confirmed live callers): `read/agents` (
`agent-editor.html`, `command-center.html`), `read/products` (
`products-commissions.html`), `read/tradelines` (`closer-dashboard.html`),
`read/underwrite` + `read/transactions` + `read/money-map` +
`read/finance-command` + `read/finance-ask` (`finance-os.html`),
`read/workflows` (`automations.html`), `campaigns/*` (all six, via
`campaign-manager.html`'s own `apiGet`/`wirePanel`), `finance/subscriptions` +
`finance/cards` + `payment-links` (`subscriptions.html`), `contracts` /
`read/contracts` (`contracts.html`), `messages-outbound` (`ops-admin.html`).

### Screens rendering hardcoded data instead of fetching
Covered under LYING above (L1–L4). No additional screens found beyond those
four — every other screen either wires through `FHData`/`apiGet` or is a
non-data page (`index.html` redirect stub, `sample-data.html` design
reference).

### Screens that fetch but ignore/misrepresent response fields
No confirmed instances found. This codebase is unusually self-documenting —
`data.js`'s header and most screens' inline comments already call out known
edge cases (e.g., `campaign-manager.html:1349` notes a field the API
deliberately doesn't project; `subscriptions.html:362–375` documents why it
duplicates `data.js`'s private `get()` instead of extending the shared file
banner-for-banner). I did not find a screen displaying a field the
corresponding handler doesn't return, or silently dropping part of a response
it does receive. The one factual staleness found is L5 above (a documented
gap whose underlying fact changed after the comment was written).

## Summary by severity

- **broken**: 0
- **lying**: 4 screens (hiring.html, creative-factory.html, content-admin.html, galaxy.html)
- **dead**: 19 backend endpoints across 8 feature areas (invoices, funding-rounds, the two superseded finance-os/banking-surface reads, shifts, banking/revoke, privacy/erasure, finance/cashflow, banking/accounts, all 6 hiring/* routes, all 4 creative/* routes)
- **cosmetic**: 1 (stale claim in social-studio.html)

## What I need you to check
Two screens — `hiring.html` and `creative-factory.html` — look production-ready
(2,400+ and 2,700+ lines, fully styled, self-describing their own data shapes)
but are 100% disconnected from working backends that were already built and
routed for them. If either was demoed or shown to anyone as "done," the data
they saw was invented, not real. That's the one thing worth you personally
looking at before anything else in this list.

## Risk
None — this audit made no code changes.

## Left undone
Nothing in scope. Out of scope by the task's own instruction: `public/*.html`
top-level pages (`dashboard.html`, `crm.html`, etc.) that use the separate
`public/fh.js` client were not audited, since the task specified
`public/app/*.html` only.

## Next
Your call on L1/L2 (hiring, creative-factory) — wire them to the endpoints
that already exist, or relabel them clearly as non-functional previews so
nobody mistakes the sample rows for real pipeline data.
