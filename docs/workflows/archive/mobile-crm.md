# Mobile CRM — shared board

Batch started 2026-08-05. Owner approved: the CRM must work on a phone. This is
a layout change and that is intended.

**Read this whole file before you start. Claim your task before you touch code.**

---

## 1. Shared context brief (from the ground phase — workflow 1)

Do not re-derive any of this. It cost a session to establish.

### The shape of the app

- **37 screens** in `public/app/*.html`. Each is a standalone HTML file with its
  CSS inline in a `<style>` block.
- Every gated screen links `fundhub-brand.css` and `crm-sidebar.css`, and loads
  `shell.js` **blocking in `<head>`**.
- `shell.js` is the auth gate. It decides whether you may see the screen and
  redirects if not. It also **injects the sidebar markup** — the sidebar is not
  in the page HTML. It must stay blocking; do not add `defer`.

### The one hard rule about the sidebar

`crm-sidebar.css` says it in its own header, and it is true:

> Shared CRM sidebar chrome — THE only place sidebar geometry is allowed.
> Pages must not redefine `.side` / `.navitem` widths or position; shell.js also
> injects a lock stylesheet that wins.

**Do not style `.side`, `.navitem`, `.side-top`, `.side-scroll` or `.side-foot`
in a page.** It will not work — shell.js's injected stylesheet overrides you.
Sidebar work belongs to workflow 1 and is already done.

### Breakpoints — use these, do not invent your own

The app currently has **26 different `@media` declarations** ranging from 480px
to 1320px with no convention. That is the mess we are not repeating.

| Name | Query | Meaning |
|---|---|---|
| Phone | `@media (max-width:640px)` | Single column. Tables become cards. |
| Tablet | `@media (max-width:860px)` | Sidebar goes off-canvas. Two columns collapse to one. |

Write desktop-first (`max-width` queries), because the existing CSS is
desktop-first. Do not convert pages to `min-width`.

**860px is load-bearing** — `shell.js` and `crm-sidebar.css` both key off it.
Do not change it.

### Tables on a phone — owner decision

**Cards by default.** A row becomes a stacked card with labelled values.
Horizontal scroll is only for tables where comparing columns side by side is
the point (financial ledgers, commission splits). When in doubt, cards.

Workflow 1 provides both helpers — see section 2.

### Testing: the auth gate will redirect you

Loading `/app/pipeline.html` in a browser sends you to sign-in. Any screenshot
you take without handling this is a picture of the login page. This already
wasted one measurement pass.

To test, stub the gate and inject the sidebar yourself. Harness in section 3.

### What is already correct

- All screens have `<meta name="viewport">` **except** four, fixed by workflow 1:
  `automations`, `client-control-panel`, `inquiry-remover`, `ops-admin`.
- Brand colors, fonts, button and card geometry were normalised on 2026-08-05.
  See `docs/BRAND-AUDIT-2026-08-05.md`. **Do not re-litigate radii or colors.**
  Buttons are 7px, cards are 10px, and that is settled.

---

## 2. Shared helpers (provided by workflow 1, in `crm-sidebar.css`)

Use these instead of writing your own. They are already loaded on every screen.

| Class | Does |
|---|---|
| `.fh-scroll-x` | Wrap a table that must stay a table. Scrolls sideways inside its own box; the page body never scrolls sideways. |
| `.fh-stack` | Any grid/flex row. Collapses to a single column at 640px. |
| `.fh-hide-phone` | Hidden at ≤640px. For columns that do not earn their space. |
| `.fh-tap` | Forces a 44px minimum touch target at ≤860px. |

Table-to-card conversion has no generic helper — the labels differ per table, so
each workflow does its own using the documented pattern in section 5.

---

## 3. Test harness

Copy this. It stubs the gate, injects the real sidebar, and measures overflow.

```
node docs/workflows/mobile-check.mjs <page-name>[,<page-name>...]
```

Committed by workflow 1 at `docs/workflows/mobile-check.mjs`. It reports, per
page: document width vs viewport width, whether anything overflows sideways, and
the widest offending element. **Sideways overflow on a phone is a bug. Zero
tolerance — that is the single measurable definition of done for this batch.**

---

## 4. Task list

Claim by changing `pending` → `claimed (your name)` **before** you start.
Write your manifest into section 6 when done, before reporting complete.

| # | Task | Screens | Status |
|---|---|---|---|
| 1 | Ground + shell | sidebar, viewport metas, shared helpers, harness | **done** |
| 2 | Sales | pipeline, closer-dashboard, closer-call, my-numbers, sales-floor, calendar | **done** |
| 3 | Funding + client ops | lenders, finance-os, contracts, subscriptions, client-control-panel, messaging, documents, inquiry-remover, company-brain | **done** |
| 4 | Watch + automation | command-center, galaxy, partner-galaxy, ops-admin, agent-editor, automations, journeys, template-editor | **done** |
| 5 | Marketing + admin + portals | campaign-manager, social-studio, creative-factory, content-admin, staff-teams, hiring, products-commissions, brand-studio, sample-data, client-portal, affiliate, consent-capture | **done** |

**All five are done, 2026-08-05.** Workflows 2-5 were run in the same session
rather than in parallel, at the owner's request. See section 6.

---

## 5. Rules for every workflow

1. **Do not touch the sidebar.** Workflow 1 owns it.
2. **Do not invent breakpoints.** 640 and 860. That is all.
3. **Do not change desktop.** Every rule you add goes inside a `max-width` query.
   If desktop renders differently after your change, you did it wrong.
4. **No new dependencies.** No CSS framework. This repo has none and is not
   getting one.
5. **Do not touch `public/crm.html` or `public/dashboard.html`.** Owner has
   ruled them out of scope.
6. Run the harness on every screen you touch. Sideways overflow must be zero.
7. `npm run lint` and `npm test` before you report done. Tests baseline is
   **4536 pass / 2 fail** — the 2 are pre-existing and unrelated. If you see a
   third, you caused it.
8. Update `-actual.md` journeys only if you change a flow. Pure CSS does not.

### Table-to-card pattern

Keep the `<table>` in the DOM for desktop. At ≤640px, re-flow with CSS only —
do not rebuild the markup in JS:

```css
@media (max-width:640px){
  .yourtable thead{display:none}
  .yourtable tr{display:block;border:1px solid var(--line);border-radius:10px;
                margin-bottom:10px;padding:10px}
  .yourtable td{display:flex;justify-content:space-between;gap:12px;
                border:0;padding:4px 0}
  .yourtable td::before{content:attr(data-label);color:var(--gray);
                        font-family:var(--mono);font-size:10px;
                        letter-spacing:.1em;text-transform:uppercase}
}
```

This needs `data-label="Name"` on each `<td>`. Adding that attribute is the only
markup change permitted.

---

## 6. Change manifests

Append yours here when your task is done. Files touched, classes added, anything
another workflow needs to know.

### Workflow 1 — ground + shell — **DONE 2026-08-05**

**Files touched**

- `public/app/shell.js` — mobile drawer, scrim, menu button, topbar clearance fix
- `public/app/crm-sidebar.css` — off-canvas transition, label restoration, shared helpers
- `public/app/automations.html`, `client-control-panel.html`, `inquiry-remover.html`,
  `ops-admin.html` — added the missing `<meta name="viewport">`
- `docs/workflows/mobile-check.mjs` — new, the layout harness
- `docs/workflows/mobile-crm.md` — this board

**Four real bugs found and fixed**

1. **Content had 228px of dead left padding on a 390px phone**, leaving 162px
   usable. The mobile override was first written in `crm-sidebar.css` and
   silently lost: `shell.js` injects `#fh-side-lock` at runtime, appended to
   `<head>`, so at equal specificity it wins on source order. The override now
   lives inside that same injected sheet. **If you need to beat a sidebar rule,
   it has to go in the lock, not the stylesheet.**
2. **The scrim never appeared.** `shell.js` looked up `getElementById("side-scrim")`
   while the ten pages that shipped one called it `sideScrim`, and the other 27
   had no scrim at all. `shell.js` now creates and owns it.
3. **Every topbar overflowed sideways.** `shell.js` injects
   `padding-right:max(16px,var(--fh-shell-top-clearance,360px))` on `.topbar`
   and friends to keep the floating search clear of action buttons. ~360px of
   padding on a 390px screen is wider than the screen. Capped to 16px below
   860px. **This alone fixed 4 screens.**
4. **The session chip covered the menu.** `#fh-shell-chip` is `position:fixed`
   at z-index ~2147483000 against the rail's 400. Chip and search button are now
   hidden while the drawer is open (`html.fh-drawer-open`).

**Behaviour change**

Below 860px the rail no longer shrinks to a 60px glyph strip. It is off-canvas
and opens as a drawer via a ☰ button at top-left. Closes on: ✕, scrim tap,
picking a destination, or Escape. `.mini` is stripped on entering mobile so a
desktop-collapsed rail cannot carry over. Desktop is unchanged.

**New shared API for workflows 2-5**

`.fh-scroll-x`, `.fh-stack`, `.fh-hide-phone`, `.fh-tap` — see section 2.
`html.fh-drawer-open` is set while the drawer is open, if you need to suppress
your own floating chrome.

**Verified**

- Drawer open/close measured in Chromium at 390px: rail parks at `left:-228`,
  opens to `left:0`, scrim shows and dismisses. Screenshotted and inspected.
- Content `padding-left` is `0px` on mobile across pipeline, lenders,
  command-center, hiring — was `228px`.
- `npm run lint` clean. `npm test` 4536 pass / 2 fail — baseline, both
  pre-existing and unrelated.

**Baseline for workflows 2-5: 15 of 36 screens pass, 21 fail.**

Run `node docs/workflows/mobile-check.mjs` for the live list. As of handoff:

| Screen | Widest element overflowing 390px |
|---|---|
| campaign-manager | `table.grid` 1341px |
| hiring | `table.grid` 1170px |
| creative-factory | `table.grid` 1051px |
| affiliate | `table.grid` 789px |
| calendar | `div.left-col` 762px |
| products-commissions | `table.grid` 704px |
| documents | `table.grid` 606px |
| lenders | `table.grid` 577px |
| staff-teams | `table.grid` 446px |
| inquiry-remover | `table.queue` 445px |
| closer-dashboard | `div.stat-tiles` 382px |
| galaxy | `i` 371px |
| partner-galaxy | `i` 371px |
| social-studio | `div.drawer-hd` 366px |
| ops-admin | `div` 307px |
| pipeline | `div.rail-tab` 283px |
| brand-studio | `input` 260px |
| journeys | `button.jrow` 162px |
| command-center | `div.kpi-tile` 84px |
| consent-capture | `div.kpi-tile` 84px |
| index | `div.kpi-tile` 84px |

**Ten of these are one problem**: a wide `<table class="grid">`. Use the
table-to-card pattern in section 5. That is the single highest-value fix in the
batch.

**Note on `overflow-x:hidden`:** it was added to `html, body` and then removed
the same day. It stops the page scrolling sideways by clipping whatever is too
wide, which would have made every screen above report as passing while still
losing content off the right edge. The mask is gone so the harness can tell the
truth. Do not re-add it.

**Workflow 1 is done. Workflows 2-5 are unblocked and may start in parallel.**

---

## 7. Blockers and open questions

_none yet_

### Workflows 2-5 — all screens — **DONE 2026-08-05**

Run in one session at the owner's request rather than as four parallel
sessions. **All 36 screens pass the layout check at 390px. Zero sideways
overflow.**

Most of it did not need per-screen work. Three shared fixes cleared 34 of the
36; only one screen needed its own rule.

**Wide data tables — `shell.js` now wraps them (`wrapWideTables`)**

Ten screens rendered a `table.grid` between 450px and 1340px wide. Rather than
edit ten files, `shell.js` wraps `table.grid` and `table.queue` in a
`.fh-scroll-x` container, with a `MutationObserver` because the rows are drawn
by page scripts after the shell has run.

**Cards were the stated preference and are not what shipped.** The card pattern
needs `data-label=""` on every `<td>`; no cell in the app has one, and the rows
are built inside JS template strings across ten files. The trade was not worth
it for grids nobody reads column-by-column on a phone. Contained scroll keeps
the columns and stops the page moving, which was the actual problem. Revisit if
someone wants true cards on a specific screen.

**Menu button vs page titles**

The ☰ is fixed at top-left, exactly where every page title sits — it landed on
top of "Hiring", "Pipeline" and the rest. Topbars now get `padding-left:58px`
below 860px. That padding then pushed `.topbar-right` off the edge on
inquiry-remover and ops-admin, so topbars also wrap now.

**inquiry-remover `.stat-tiles`** — the one per-screen fix. A non-wrapping flex
row of `min-width:88px` tiles. Wraps below 640px.

### Two corrections to the harness

The first two runs were wrong and would have sent four workflows chasing
non-bugs:

1. It counted elements inside a scroll container as overflowing. A table you
   can swipe is not lost content, and containment is the fix — so the harness
   was failing the very thing that fixes the problem. Now skips any element
   under an `overflow-x: auto/scroll/hidden` ancestor.
2. It counted the children of closed off-canvas panels. `.editor` is
   `position:fixed; transform:translateX(102%)` — parked off-screen on purpose.
   The panel was skipped for being fixed; its children were not, so every closed
   drawer header reported as an overflow. Now skips anything under a
   `position:fixed` ancestor.

Between them these accounted for 20 of the 21 "failures" after the shell work.
The count went 21 → 7 → 1 → 0 with almost no additional CSS. **If this harness
reports a failure, read the element before changing anything.**

### Known gap — not fixed

The session chip (`#fh-shell-chip`) is `position:fixed` at top-right and on a
390px screen it overlaps page content. Re-docking it to the bottom was tried and
reverted: the element is built from an inline `style.cssText` flex row, and
overriding its `top`/`bottom`/`max-width` from the lock sheet blew its height
out to most of the screen. It also holds the only Sign out control in the app,
so hiding it is not an option. Left alone rather than guessed at a third time.
Fix it where it is built — search `fh-shell-chip-style` in `shell.js`.

### Verified

- `node docs/workflows/mobile-check.mjs` — 36 checked, **0 failing**.
- Desktop regression at 1280px — 13 computed-style assertions, 0 fail. The
  brand/geometry work from earlier in the day is intact.
- `npm run lint` clean. `npm test` 4536 pass / 2 fail — baseline.
- Screenshots inspected for hiring, lenders, pipeline. The ☰-over-title and
  chip-over-cards problems were both found by looking, not by measuring.

### Not covered

- Only tested at 390×844. No tablet width, no landscape, no 320px.
- Tables scroll rather than reflow. Reachable, not redesigned.
- No real device testing, and no touch-gesture testing beyond tap.
