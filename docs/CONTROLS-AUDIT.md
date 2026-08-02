# Controls Audit — `public/app/*.html`

Read-only audit. Measured **2026-08-02** against `main` at `df3e3b8`
(branch `audit/controls`). Only this file was added.

---

## Fixes applied 2026-08-02 (`fix/controls-persist`)

Follow-up pass on branch `fix/controls-persist`. Plain-language record of what
got wired or cleaned up, and what still shows empty because no read source
exists yet.

### What was fixed

| Area | What changed |
|------|----------------|
| **Agent editor** | Save, promote, demote, and new-agent now call `POST /api/agents` via `FHData.write`. Edits persist instead of dying in memory. |
| **Pipeline board** | Card drag and MOVE menu call `POST /api/pipeline-cards` so stage changes stick. Sample cards without a real card id stay local-only. |
| **Products & commissions** | Product save/create calls `POST /api/products`. Rails column stays empty (`[]`) — nothing in the products table records funnel membership. |
| **Client control panel** | The five ↗ link buttons open Finance OS, closer dashboard, documents, and raw report when a client id is present. GHL Contact stays disabled until a contact URL exists on the client. |
| **Calendar** | Join Call and His file are wired but stay disabled when the task has no `meeting_url` or linked client. Buttons enable when live task data supplies those fields. |
| **Command Center** | KPI tiles, holds strip, pipeline rail counts/dollars, and live feed no longer show invented numbers — all show `—` or an empty-state message until a read endpoint exists. Agent badge wiring from `/api/read/agents` is unchanged. |
| **Ops & Admin** | Money KPI tiles and period picker no longer swap fake dollar amounts. AR table, affiliate summary, and staff comp “This Week” column show empty states. Outbound mail and DLQ tiles still read live (`/api/messages-outbound`, failed events). |
| **Staff & Teams** | Clock tab and ON SHIFT / CONSENT stats show `—` when consent or clock is `null` (live roster from `/api/read/staff`). Sample PEOPLE array remains only as a pre-load fallback. Permission matrix unchanged (local UI config). |

### Still no source — what each would need

| Screen / control | Empty today because | Likely source |
|------------------|---------------------|---------------|
| **Command Center KPIs** (cash collected, close rate, cost/funded, funded today) | No aggregate read for ad spend or funding totals | Dashboard KPI read — payments + pipeline stage aggregates; ad spend needs migration 038 `ad_spend` table |
| **Command Center holds** | No holds feed | Read on clients/cards with a hold reason — e.g. extend `/api/read/clients` or a dedicated holds query on `pipeline_cards` + hold flags |
| **Command Center rails summary** | Stage counts and dollars are not loaded | Could reuse `/api/dashboard/pipeline` aggregates (same shape pipeline.html uses) keyed by rail |
| **Ops money KPIs** | Period picker has labels only | Finance aggregate read — sum payments, funded volume, close/show rates for the selected window |
| **Ops AR table** | No unpaid-invoice list | AR read endpoint — open invoices with days overdue, sorted oldest first |
| **Ops affiliates payouts** | Summary line and rows empty | Affiliate read — referral counts and payout totals from commissions or affiliate ledger |
| **Staff clock & consent columns** | `staff` table has no clock or consent fields | `/api/shifts` (or shift columns on staff) for clock; consent capture table (same as `/api/consent/capture`) for monitoring consent |
| **Products rails column** | Product-to-rail mapping not stored | Junction table or column linking product codes to pipeline keys — none exists today |
| **Calendar meeting_url / coverage roster** | Tasks from task queue may lack call links and assignee roster | Task read must include `meeting_url`; coverage roster needs a staff-on-shift or calendar-assignments read |
| **GHL contact URL on client** | No GHL id/url on client record | External id column on `clients` (or partner CRM link table) exposed on client read |

---

**Scope:** Every interactive control on every screen under `public/app/` —
buttons, links, toggles, dropdowns, filters, form fields, drawer triggers,
tabs. Each gets one of:

| Verdict | Meaning |
|---------|---------|
| **WORKS** | Handler does real work (API, navigation, or meaningful UI logic) |
| **DEAD** | No handler at all |
| **STUB** | Handler exists but does nothing meaningful for the product (local-only when server is expected, fake timer, disabled “no endpoint”, coming soon) |
| **UNKNOWN** | Cannot determine from static reading alone |

**Expectation (owner):** Brand Studio and every Beta screen should have real
functionality behind every control. Gaps there are called out first.

**Model:** Grok. One session. No product code changed.

---

## How this was measured

1. Extracted ~1,700 static tags (`button`, `a`, `input`, `select`, `textarea`,
   `role=button|tab|switch`) from all 31 HTML files.
2. Traced handlers in each file’s `<script>` blocks (`getElementById`,
   `addEventListener`, `data-*` delegation, `FHData` / `fetch`).
3. Manually re-graded known unfinished screens and every Brand Studio /
   Beta control (auto-classification alone over-counts WORKS).
4. Shared sidebar chrome is graded once, then per-file exceptions.

**Not counted as product controls:** pure display spans, hidden inputs,
`<label for>` alone (unless it is the only hit target). Dynamic buttons built
in `innerHTML` are listed under that screen’s “dynamic” section when found.

---

## Verdict in one page

Most staff screens that load live data have filters/tabs/saves that **WORKS**.
The failures cluster here:

1. **Brand Studio (Beta)** — preview editors WORKS locally; **Save / Submit /
   Verify / Reset are STUB**; server PUT wrapper never attaches; **sidebar
   collapse chrome is DEAD** on this file; BS-06 generation is DEAD.
2. **Contracts** — contract actions mostly WORKS, but **same dead sidebar
   chrome** (burger + 9 navheads never wired).
3. **Beta / simulation screens** — content-admin, galaxy, social queue,
   creative (no generate), hiring (no writes), staff clock.
4. **Editors that look live but only mutate memory** — agent-editor save,
   products-commissions edits, pipeline drag/MOVE, affiliate sign license.
5. **Wireframe action buttons with no listeners** — client-control-panel
   “Open … ↗” row, client-portal Download/Text/Call, calendar Join Call.

---

## Shared sidebar chrome

**Present on** every screen except `index.html` and `client-portal.html`
(~25 nav links + logo + burger + 9 `.navhead` group headers).

| Control | Typical lines | Verdict on most screens | Verdict exceptions |
|---------|---------------|-------------------------|--------------------|
| Logo → Command Center | ~side-top | **WORKS** | — |
| `#burger` collapse | same | **WORKS** | **DEAD** on `brand-studio.html`, `contracts.html` (element exists, no `getElementById('burger')` wiring) |
| 9× `.navhead` (Work / Watch / Automation / Setup / My Work / Client / Finance / Marketing / Beta) | sidebar | **WORKS** | **DEAD** on `brand-studio.html`, `contracts.html` (no `querySelectorAll('.navhead')`) |
| ~25× `.navitem` links | sidebar | **WORKS** | shell.js may block disallowed targets per role |
| Injected Sign out (`shell.js`) | runtime | **WORKS** | `POST /api/auth/logout` |

**“Beta” group** is an HTML label only (Hiring, Brand Studio). `shell.js` has
no beta flag. Partner role is limited to `partner-galaxy.html` +
`brand-studio.html`.

Below, **page-specific** inventories omit repeated WORKS nav links unless the
screen’s chrome wiring is broken.

---

## Brand Studio — full inventory (priority)

File: `public/app/brand-studio.html`  
Partner-facing brand editor. Claims persistence via `/api/partner-brand`.

### Critical defects

1. `save()` and `D` live inside an IIFE (lines 504–696) and are **never** put
   on `window`. The later wrapper (745–770) checks
   `typeof window.save === "function"` → always false → **PUT never runs**.
2. Even if wired, PUT keys (`entity_name`, `display_face`, …) do not match
   local `D` keys (`entity`, `display`, …).
3. GET paint only sets a few CSS vars; form fields stay on localStorage.
4. Save message claims “Tokens applied to your CRM, site, and PDFs” after
   localStorage only.

### Controls

| Line | Label | Verdict | Evidence |
|------|-------|---------|----------|
| 274 | Logo fundhub | **WORKS** | `href="command-center.html"` |
| 274 | `#burger` Collapse sidebar | **DEAD** | No listener in this file |
| 276 | Work ▾ | **DEAD** | `.navhead` unwired |
| 284 | Watch ▾ | **DEAD** | same |
| 289 | Automation ▾ | **DEAD** | same |
| 295 | Setup ▾ | **DEAD** | same |
| 301 | My Work ▾ | **DEAD** | same |
| 306 | Client ▾ | **DEAD** | same |
| 309 | Finance ▾ | **DEAD** | same |
| 313 | Marketing ▾ | **DEAD** | same |
| 318 | Beta ▾ | **DEAD** | same |
| 277–320 | All `.navitem` links | **WORKS** | Real `href`s |
| 331 | Reset `#resetBtn` | **STUB** | Clears localStorage + reload; no server reset |
| 347 | Brand name `#bName` | **WORKS** | Updates `D` + live preview (not server) |
| 348 | Legal entity `#bEntity` | **WORKS** | same |
| 349 | Address `#bAddr` | **WORKS** | same |
| 350 | Support email `#bEmail` | **WORKS** | same |
| 353 | Wordmark `#bLogo` | **WORKS** | FileReader → data URL preview |
| 354 | Use text `#clearLogo` | **WORKS** | Clears logo |
| 365 | Ink color/hex `#cInk` `#cInkHex` | **WORKS** | `bindColor` |
| 366 | Paper color/hex `#cPaper` `#cPaperHex` | **WORKS** | same |
| 369–370 | Ramp stops `#r0`…`#r5` | **WORKS** | Loop wires `$("r"+i)` |
| 371 | Presets `#rampPreset` | **WORKS** | Cycles presets |
| 377 | Display face `#fDisplay` | **WORKS** | Fonts + tokens |
| 388 | Mono face `#fMono` | **WORKS** | same |
| 397 | Copy voice `#bVoice` | **WORKS** | Updates `D.voice` |
| 412 | Domain `#bDomain` | **WORKS** | Strips URL into `D` |
| 412 | Verify `#verifyBtn` | **STUB** | `setTimeout` fakes DNS; no API |
| 419–421 | copy (CNAME / A / TXT) | **WORKS** | Clipboard |
| 433 | Funnel cards (×6, dynamic) | **WORKS** | Toggle `D.funnels` + preview |
| 455–461 | BS-06 Generate VSL / ads / wordmark | **DEAD** | `.soon { pointer-events:none }`; “Coming soon”; no handlers |
| 466 | Save & apply `#saveBtn` | **STUB** | localStorage only; false “applied everywhere” copy; server wrap dead |
| 467 | Submit for approval `#submitBtn` | **STUB** | Local `status=submitted`; API forbids writing `approval_status` |
| 484 | Preview “Start application” | **DEAD** | `<span class="pv-btn">`; decorative |

**Brand Studio score (page-specific + broken chrome):**  
~22 WORKS (preview editors + nav links) · **7 STUB** · **13 DEAD** (9 navheads + burger + 3 BS-06).  
**Does not meet “every control has real functionality.”**

---

## Beta group screens

Sidebar “Beta” links: **Hiring**, **Brand Studio** (above). Related unfinished
surfaces often treated as beta: Social Studio, Creative Factory, Content,
Galaxy.

### `hiring.html` — reads live; no write controls

| Line / area | Label | Verdict | Evidence |
|-------------|-------|---------|----------|
| Sidebar chrome | burger / navheads / links | **WORKS** | Wired |
| 363 | Reset filters | **WORKS** | Clears filters + re-render |
| 449–451 | Role / source / flagged filters | **WORKS** | Filters live GET or sample |
| Dynamic | Stage chips, cards, tables | **WORKS** | Open read-only drawer; may GET application |
| 607–656 | Funnel / decisions filters | **WORKS** | Re-query / re-render |
| 730 | Drawer close | **WORKS** | UI |
| — | Advance / reject / post job / score | **N/A (missing)** | Writers exist in `src/hiring/*` but no HTTP/UI |

Expectation gap: every *existing* control WORKS for read/filter; product write
actions were never given controls (not DEAD buttons — absent).

### `social-studio.html`

| Line | Label | Verdict | Evidence |
|------|-------|---------|----------|
| Chrome | — | **WORKS** | Wired |
| 402 | Partner select | **STUB** | Sample partner scope |
| 404 | + Compose | **STUB** | Scroll/focus only |
| 411–423 | Stat tiles | **STUB** | Sample derivation text |
| 480–514 | Composer fields | **STUB** | Local guardrail preview |
| 520 | Run guardrail preview | **STUB** | Client-side; “nothing is written” |
| **521** | **Queue post `#queueBtn`** | **STUB** | `disabled`; title “No endpoint exists” |
| 523 | Clear | **STUB** | Clears fields |
| 569–579 | Workbench tabs / filters | **STUB** | Sample `POSTS[]` |
| 649 | Best-times channel | **STUB** | Sample |
| 751 | Drawer close | **STUB** | UI on sample |
| Audit pane | Action log | **WORKS** | `GET /api/campaigns/action-log?target_type=social_post` |

### `creative-factory.html`

| Line / area | Label | Verdict | Evidence |
|-------------|-------|---------|----------|
| Chrome | — | **WORKS** | Wired |
| 382 | Show request URLs | **WORKS** | Toggles URL display |
| 402 | Partner select | **WORKS** | Re-fetches four GETs |
| Filters / chips / drawers / pagination | — | **WORKS** | Read-only live (or sample fallback) |
| — | Generate / enqueue / approve / reject | **N/A (missing)** | Screen documents no write path |

### `content-admin.html`

| Line | Label | Verdict | Evidence |
|------|-------|---------|----------|
| Chrome | — | **WORKS** | Wired |
| 276–331 | Upload flow (choose/drop/title/tier/upload/clear) | **STUB** | Fake progress → in-memory `VIDEOS[]`; no `api/content/*` |
| Dynamic | Tier selects / tile switches / preview | **STUB** | In-memory only; reload loses |
| Video list rows | — | **DEAD** | No click/remove handlers |

### `galaxy.html` / `partner-galaxy.html`

| Control | Verdict | Evidence |
|---------|---------|----------|
| Chrome | **WORKS** | Wired |
| Canvas click / hover / Esc / panel close | **STUB** | Scripted simulation; honest “SIMULATED” / “No backend” |
| Partner census banner (`partner-galaxy` only) | **WORKS** | `FHData.partners()` read |

---

## Per-screen inventories (remaining)

### `index.html`
No controls. Redirect stub via `shell.js`. —

### `affiliate.html`
**Data:** Mixed — sample leads/payouts; partial `FHData.affiliates` for owed/conversion.

| Line | Label | Verdict | Evidence |
|------|-------|---------|----------|
| Chrome | — | **WORKS** | |
| 203–204 | Copy link / code | **WORKS** | Clipboard |
| 222 | Sign license `#signBtn` | **STUB** | `confirm` + local hide banner; no contract API |
| 240–254 | Tabs / status / search | **WORKS** | Filters sample arrays |
| Tables | — | **STUB** | Hardcoded `LEADS`/`PAYOUTS` |

### `agent-editor.html`
**Data:** Live agent list from `FHData.read("agents")`; edits not persisted.

| Line | Label | Verdict | Evidence |
|------|-------|---------|----------|
| 250 | + New agent | **STUB** | Local `AGENTS` push |
| List / fields / switches / triggers | — | **WORKS** (UI) | Edit in-memory model |
| 277–278 | Promote / Demote | **STUB** | `cur.mode` only |
| 366 | Save agent | **STUB** | “SAVED” text; no write API |
| 367 | Revert | **WORKS** | Reloads from memory |

### `automations.html`
**Data:** Live `GET /api/read/workflows`.

| Control | Verdict | Evidence |
|---------|---------|----------|
| Rail filter, row expand | **WORKS** | Filters/expands live registry |
| Status badges LIVE/DORMANT | display | Not toggles |

### `calendar.html`
**Data:** Day body from `FHData.taskQueue`; week strip / right rail sample.

| Line | Label | Verdict | Evidence |
|------|-------|---------|----------|
| Day/Week, prev/next/today, week days | **WORKS** | UI navigation |
| 649 | Give Carlos to Nina / Reschedule | **STUB** | Removes conflict CSS locally |
| **721** | **Join Call** | **DEAD** | No listener |
| **722** | **His file** | **DEAD** | No listener |
| Demo toggle | **WORKS** | Demo UI |

### `campaign-manager.html`
**Data:** Live read-only `GET /api/campaigns/*`.

| Control | Verdict | Evidence |
|---------|---------|----------|
| Reload, filters, drawers, rails | **WORKS** | GET only by design |
| Write actions | **N/A** | None present |

### `closer-dashboard.html`
| Control | Verdict | Evidence |
|---------|---------|----------|
| Draw / guardrail / fee inputs | **WORKS** | `recompute()` calculator |
| Live tradelines when `?client_id=` | **WORKS** | `FHData.read("tradelines")` |

### `command-center.html`
| Control | Verdict | Evidence |
|---------|---------|----------|
| Rail toggles, feed/roster filters, hold chips | **WORKS** | Filter sample DOM |
| KPI tiles | **STUB** | Explicitly unwired; agent badges patched from API |

### `consent-capture.html`
| Control | Verdict | Evidence |
|---------|---------|----------|
| Method, name, expires, Record, Withdraw | **WORKS** | `GET/POST /api/consent/capture` (needs `client_id`) |

### `contracts.html`
**Data:** Live contracts API. **Chrome broken.**

| Line | Label | Verdict | Evidence |
|------|-------|---------|----------|
| 143 | `#burger` | **DEAD** | Unwired (same as Brand Studio) |
| 9× `.navhead` | **DEAD** | Unwired |
| Nav links | **WORKS** | `href`s |
| Template/client selects, preview, send, remind, void, PDF tools, wording save | **WORKS** | `/api/contracts` |
| Add contact form | **WORKS** | Wired |

### `documents.html`
| Control | Verdict | Evidence |
|---------|---------|----------|
| Pending / class / tabs / status / search / sort | **WORKS** | Live `FHData.documents` when available |
| Row download/open | **UNKNOWN** | No clear row click/download handler found |

### `finance-os.html`
| Control | Verdict | Evidence |
|---------|---------|----------|
| Client/entity pickers, soft pull, sample load, days, add account/card/bill, alert switches, deal run, ask, drawer save | **WORKS** | `/api/finance/*`, money-map (needs `client_id`) |
| Soft-pull fulfilment | note | Queues only — control WORKS; bureau path unfinished (see UNFINISHED-AUDIT) |

### `inquiry-remover.html`
| Control | Verdict | Evidence |
|---------|---------|----------|
| Bureau chips, expand, log attempt, confirm, status, reveal SSN | **WORKS** | Live when `data-id` present |
| Sample rows without id | **STUB** | Actions disabled / messaging |

### `journeys.html`
| Control | Verdict | Evidence |
|---------|---------|----------|
| Undo, save version, test against code, apply, ask, canvas | **WORKS** | `/api/journeys*` |

### `messaging.html`
| Control | Verdict | Evidence |
|---------|---------|----------|
| Search, tabs, convo list, compose, Send | **WORKS** | Inbox/thread/send APIs (shift-gated) |

### `ops-admin.html`
| Line | Label | Verdict | Evidence |
|------|-------|---------|----------|
| Period picker, Money/People tabs, AR sort | **STUB** | Sample KPI wireframe |
| 410–412 | Outbox Send / Pause / Email invoices | **WORKS** | `/api/messages-outbound` |
| Affiliates details + link | **WORKS** | Native `<details>` + href |
| Staff/consent sample tables | **DEAD** | Static; no handlers |
| DLQ KPI tile | **WORKS** | `FHData.failedEvents()` |

### `pipeline.html`
| Control | Verdict | Evidence |
|---------|---------|----------|
| Rail tabs, search, filters | **WORKS** | Live board read |
| Card drag | **STUB** | `sessionStorage` only — no stage API |
| MOVE menu | **STUB** | Opens menu; does not persist route |

### `products-commissions.html`
| Control | Verdict | Evidence |
|---------|---------|----------|
| Tabs, filters, ledger jump, open editor | **WORKS** | Live reads |
| Save product / change rate / close version | **STUB** | Local `PRODUCTS`/`RULES` only |

### `staff-teams.html`
| Line | Label | Verdict | Evidence |
|------|-------|---------|----------|
| Tabs, role filter, search, open editor, cancel | **WORKS** | Roster from `/api/read/staff` when live |
| Clock in/out `[data-clock]` | **STUB** | Flips local `p.clock`; never `/api/shifts` |
| Permission matrix `.pcell` | **STUB** | In-memory `PERMS` |
| Save / Deactivate / Active/Consent/Clock switches | **STUB** | Memory only |
| Reset password | **WORKS** | `/api/auth/admin-reset` |

### `subscriptions.html`
| Control | Verdict | Evidence |
|---------|---------|----------|
| Start/change/cancel plan, cards, payment links create/copy/send/expire | **WORKS** | `/api/finance/*`, `/api/payment-links` (needs `client_id`) |

### `template-editor.html`
| Control | Verdict | Evidence |
|---------|---------|----------|
| List, subject/body, tags, Save, Undo, Approve | **WORKS** | message-templates API |

### `client-control-panel.html`
| Line | Label | Verdict | Evidence |
|------|-------|---------|----------|
| Collapsible groups | **WORKS** | Toggle sections |
| Notes `#notes` | **STUB** | Fake “saved” timeout |
| Staff upload (with `?id=`) | **WORKS** | `/api/documents-upload` |
| Pull TU/EX/EQ, Issue Removal, Generate Apps | **STUB** | `setTimeout` simulation |
| **533–537** Open Funding Matrix / Credit Snapshot / Bank Inbox / GHL / Raw Report | **DEAD** | `.link-btn` — no listeners |
| Client field paint | **WORKS** | `FHData.client(id)` when live |

### `client-portal.html` (no staff sidebar)
| Line | Label | Verdict | Evidence |
|------|-------|---------|----------|
| In progress / Just funded | **STUB** | Local state |
| Play video | **STUB** | Fake scrubber |
| Book / Unlock modals | **STUB** | Simulated checkout/booking |
| Upload Documents (with client id) | **WORKS** | documents-upload |
| Download ↓ (×3) | **DEAD** | No handlers |
| Text / Call | **DEAD** | No handlers |
| Portal tabs | **STUB** | Pane switch |
| Entitlements paint | **WORKS** | When client id present |

### `sample-data.html`
**Dev tool · no writes** (self-described). All profile/gate/run/reset/randomize/preset/tab/copy controls are **STUB** (local routing engine only). Not a product screen.

---

## Master list — every DEAD control

| File | Line | Label | Notes |
|------|------|-------|-------|
| brand-studio.html | 274 | `#burger` | Chrome unwired |
| brand-studio.html | 276 | Work ▾ | Chrome unwired |
| brand-studio.html | 284 | Watch ▾ | |
| brand-studio.html | 289 | Automation ▾ | |
| brand-studio.html | 295 | Setup ▾ | |
| brand-studio.html | 301 | My Work ▾ | |
| brand-studio.html | 306 | Client ▾ | |
| brand-studio.html | 309 | Finance ▾ | |
| brand-studio.html | 313 | Marketing ▾ | |
| brand-studio.html | 318 | Beta ▾ | |
| brand-studio.html | 457–461 | Generate VSL / ads / wordmark | Coming soon, `pointer-events:none` |
| brand-studio.html | 484 | Preview Start application | Decorative span |
| contracts.html | ~143 | `#burger` | Chrome unwired |
| contracts.html | 9× | `.navhead` groups | Chrome unwired |
| calendar.html | 721 | Join Call | No listener |
| calendar.html | 722 | His file | No listener |
| client-control-panel.html | 533 | Open Funding Matrix ↗ | No listener |
| client-control-panel.html | 534 | Open Credit Snapshot ↗ | No listener |
| client-control-panel.html | 535 | Open Bank Inbox ↗ | No listener |
| client-control-panel.html | 536 | GHL Contact ↗ | No listener |
| client-control-panel.html | 537 | Raw Report ↗ | No listener |
| client-portal.html | 413,417,421 | Download ↓ | No listener |
| client-portal.html | 561–562 | Text / Call | No listener |
| content-admin.html | video list rows | (no actions) | Render only |
| ops-admin.html | People zone sample tables | — | Static |

---

## Master list — every STUB control (high signal)

| File | Line / area | Label | Why STUB |
|------|-------------|-------|----------|
| brand-studio.html | 331 | Reset | localStorage only |
| brand-studio.html | 412 | Verify | Fake DNS timeout |
| brand-studio.html | 466 | Save & apply | localStorage; server wrap never attaches |
| brand-studio.html | 467 | Submit for approval | Local status; API won’t take it |
| social-studio.html | 521 | Queue post | Disabled; no endpoint |
| social-studio.html | composer / tabs / filters | (most) | Sample-only product surface |
| content-admin.html | upload + tiers + tiles | (all) | In-memory; no backend |
| galaxy.html / partner-galaxy.html | canvas interactions | — | Simulation |
| staff-teams.html | clock buttons | Clock in/out | Never calls `/api/shifts` |
| staff-teams.html | save / deactivate / perms / switches | — | Memory only |
| agent-editor.html | 250, 277–278, 366 | New / Promote / Demote / Save | No write API |
| products-commissions.html | editor save / rate change | — | Local only |
| pipeline.html | drag / MOVE | — | sessionStorage / non-persisting menu |
| affiliate.html | 222 | Sign license | Local confirm only |
| calendar.html | 649 | Give Carlos… / Reschedule | CSS only |
| client-control-panel.html | notes / pull / removal / generate | — | Fake timers |
| client-portal.html | state / play / book / unlock / tabs | — | Wireframe |
| ops-admin.html | period / zones / AR (non-outbox) | — | Wireframe |
| command-center.html | KPI tiles | — | Unwired sample |
| sample-data.html | all | — | Dev tool by design |

---

## Counts (approximate, page-specific + exceptions)

| Bucket | Approx |
|--------|--------|
| Screens audited | 31 |
| Static interactive tags extracted | ~1,700 |
| Shared chrome WORKS (most screens) | ~35 per screen × 28 |
| Brand Studio DEAD+STUB | **20** |
| Contracts chrome DEAD | **10** |
| Other high-signal DEAD | ~12 |
| High-signal STUB (product-facing) | ~80+ across beta/wireframe screens |
| Screens where almost every control WORKS for its job | consent-capture, messaging, contracts (actions), finance-os, subscriptions, template-editor, journeys, automations, campaign-manager (read), creative-factory (read), hiring (read), inquiry-remover |

Exact WORKS counts are inflated if you count every nav link on every page; the
**product gaps** are the DEAD/STUB tables above.

---

## UNKNOWN (could not finish statically)

| Area | Why |
|------|-----|
| documents.html row actions | No obvious download/open handler; may be display-only by design |
| Some dynamic `innerHTML` buttons | Wired in render closures; graded from pattern, not every generated line |
| Soft-pull / payment-link “Send” depth | Control calls API (WORKS); downstream bureau/mail may still queue only |

---

## Priority fixes (if the bar is “every control works”)

1. **Brand Studio** — expose `save`/`D` (or rewrite wrap), fix PUT field map, hydrate forms from GET, wire burger/navheads, remove or build BS-06.
2. **Contracts** — copy chrome wiring from `documents.html` (~228–230).
3. **Social Queue post** — HTTP for `schedule()` or remove the button.
4. **Staff clock** — call `/api/shifts`.
5. **Client Control Panel link row** — wire or delete DEAD ↗ buttons.
6. **Agent editor / products-commissions / pipeline MOVE** — add write APIs or mark UI read-only.

---

*End of audit.*
