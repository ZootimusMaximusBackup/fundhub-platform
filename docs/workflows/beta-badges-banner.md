# Beta badges + banner

Batch: beta-badges-banner
Started: 2026-08-07

## Task list

| Task | Owner | Status |
|---|---|---|
| nav-badges | me | done |
| beta-banner | me | done |

Did both in one session (single agent) per owner instruction "Proceed all here!".

## Money path (no badge, live)

Pipeline, Closer Dashboard, Call cockpit, My numbers, Sales floor, Calendar, Lenders, Contracts, Client Control Panel, Messaging, Documents, Inquiry Remover, Message Copy, Workflows, Client Portal, Staff & Teams, Products & Commissions

## Beta (badge in nav + banner on page)

Finance OS, Subscriptions, Company Brain, Command Center, Galaxy, Ops & Admin, Agent Editor, Journeys, Campaigns, Social Studio, Creative Factory, Content, Hiring, Demo Mode, Brand Studio, Affiliate

Banner copy: "Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions."

## Shared context brief

This CRM is not React — it's static HTML pages under `public/app/*.html`,
each loading `shell.js` from `<head>`. Nav markup is the same on every
screen; `shell.js` swaps it for its own `SIDEBAR_HTML` copy on load
(`mountSidebar()`), so anything driven off one JS list there reaches every
screen with no per-page edits. `scripts/sync-sidebar.mjs` is the tool that
keeps `public/app/sidebar.fragment.html`, every page's inline `<aside>`, and
`SIDEBAR_HTML` in sync — not needed for this task since badges/banner are
injected at runtime, not baked into markup.

Design tokens live in `public/app/fundhub-brand.css`; `--warn: #F5CE8F`
already existed (used for "in progress" chips). No existing Badge/Chip
component to share — nav has no badge concept yet, so this adds the first
one.

## Change manifest

**`public/app/shell.js`**
- Added `BETA_PAGES` array (single config, sits right below `PAGE`) —
  the 16 filenames from the BETA list. This is the one place to add/remove
  a beta screen.
- `mountSidebar()`: while walking nav links, appends a `<span class="beta-badge">BETA</span>`
  to any `.navitem` whose href is in `BETA_PAGES`.
- New `mountBetaBanner()`: if `PAGE` is in `BETA_PAGES`, inserts a dismiss-able
  banner bar (same host-resolution logic as the existing Demo Mode banner —
  `.app > .shell` / `.app` / `body`). Dismiss removes the DOM node only —
  no sessionStorage/localStorage — so it is gone for this page view and
  back on the next load/navigation (every nav click is a full page load in
  this app, so that satisfies "dismissible per session, returns on reload").
- Wired `mountBetaBanner()` next to the existing unconditional `mountSidebar()`
  call (runs before role/session resolves, since it only depends on `PAGE`).

**`public/app/crm-sidebar.css`**
- Added `.navitem .beta-badge` (peach pill, `background: var(--warn, #F5CE8F)`,
  dark text) and hid it in `.side.mini` (icon-only rail), matching how `.lbl`
  is already hidden there.

**Not touched:** `sidebar.fragment.html`, any of the 32 page `.html` files,
`sync-sidebar.mjs`. Badge/banner are runtime-injected off the one list, per
the "don't edit 17 pages" requirement.

## Verification run

- `node --check public/app/shell.js` — clean
- `node --test src/http/app-nav-matches-shell.test.mjs src/http/app-nav-reachability.test.mjs src/http/mobile-shell.test.mjs` — 119/119 pass
- `npm run lint` — 1015 files clean
- `npx tsc --noEmit` — no TS project in this repo (JS-only), not applicable
- `npm test` (full suite, no `DATABASE_URL`) — pass, 0 fail (pg tests skip as documented in CLAUDE.md traps)

## Blockers / open questions

None.
