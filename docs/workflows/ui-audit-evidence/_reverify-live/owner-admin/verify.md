# Live re-verify — owner-admin (owner) — 2026-08-17 20:12–20:17Z

Live `https://fundhub.ai` as `owner@fundhub.ai`. Harness `--no-clicks`. No 503/bounce (0 retries). Stamps not trusted.

Screens (each HTTP 200, not bounced):

| Screen | Evidence |
|---|---|
| staff-teams.html | `_reverify-live/staff-teams/` |
| products-commissions.html | `_reverify-live/products-commissions/` |
| subscriptions.html | `_reverify-live/subscriptions/` |
| hiring.html | `_reverify-live/hiring/` |
| sample-data.html | `_reverify-live/sample-data/` |
| agent-editor.html | `_reverify-live/agent-editor/` |
| automations.html | `_reverify-live/automations/` |
| journeys.html | `_reverify-live/journeys/` |

Each folder: `1440-fold.png` · `1440-full.png` · `390-fold.png` · `390-full.png` · `audit.json` · `audit.md`

| Line | Screen | Stamp | Expected | Live | Verdict |
|---|---|---|---|---|---|
| 408 | staff-teams.html | CONFIRMED-FIXED CRITICAL | Permission matrix reads and writes real role permissions | Default tab is Roster. Permissions tab is present. No permissions API on load (only `/api/read/staff` + `/api/shifts`). Matrix and writes not opened (`--no-clicks`). | **UNVERIFIED** |
| 409 | staff-teams.html | CONFIRMED-FIXED HIGH | No Revoke login on a person who does not exist yet | Roster shows Chris Stanbridge only. No Revoke login control in the DOM. New-person drawer not opened. | **UNVERIFIED** (drawer). No Revoke on the settled roster. |
| 410 | staff-teams.html | CONFIRMED-FIXED HIGH | New person drawer shows only values that will exist after save | Drawer not opened. | **UNVERIFIED** |
| 411 | staff-teams.html | CONFIRMED-FIXED MEDIUM | Drawer title and close visible; footer actions reachable | Drawer not opened. | **UNVERIFIED** |
| 412 | staff-teams.html | CONFIRMED-FIXED LOW · NO-DATA-SOURCE | Stat cards with a comparison; caption true | HEADCOUNT 1 / ON SHIFT 0 / CONSENT 0/1 / PENDING 0. Captions are descriptions, not vs-yesterday. Footer caption is true: `live roster · 1 staff · signed-in user not on roster · consent 0/1`. | **DOES-NOT-HOLD** (no comparison) |
| 413 | staff-teams.html | CONFIRMED-FIXED LOW | Refresh appears once a person is picked | No person picked. No Refresh control. | **UNVERIFIED** |
| 416 | products-commissions.html | CONFIRMED-FIXED HIGH | Commission rules tab lists rules the owner can edit and save | Products tab is default. ACTIVE RULES 0. Footer: `no commission rows yet`. Commission rules tab not opened. | **UNVERIFIED** |
| 417 | products-commissions.html | CONFIRMED-FIXED HIGH | Dates reflect today (Aug 17, 2026) | PAID MTD caption is `august 2026`. No stale July range. | **HOLDS** |
| 418 | products-commissions.html | CONFIRMED-FIXED MEDIUM | Default price / Min / Max right-aligned tabular | Those cols are `align=start` with tabular-nums. | **DOES-NOT-HOLD** |
| 419 | products-commissions.html | CONFIRMED-FIXED LOW | Header on one line | View payout ledger, + Add product, Search, session chip all sit at y≈11–21. | **HOLDS** |
| 421 | subscriptions.html | CONFIRMED-FIXED CRITICAL | Content in the main column; Beta banner across the top | Beta bar is the top-left element. Main column paints Subscriptions + Payment links (no-client empty). | **HOLDS** |
| 422 | subscriptions.html | CONFIRMED-FIXED HIGH | Sidebar item lands on a usable screen; empty state offers an in-app action | Nav active is Subscriptions. Empty copy + filled **Find a client**. | **HOLDS** |
| 423 | subscriptions.html | CONFIRMED-FIXED MEDIUM | One filled button | 2 filled: Find a client + Chat. | **DOES-NOT-HOLD** |
| 425 | hiring.html | CONFIRMED-FIXED HIGH | Page finishes loading; Reset filters resets | APIs 200. Status: candidates/postings/decisions/bench loaded. Console: `g.hire_rate_pct.toFixed is not a function`. Reset filters is visible (127×35) and not clicked. | **HOLDS** on load. **UNVERIFIED** on Reset. |
| 426 | hiring.html | CONFIRMED-FIXED HIGH | Default view = daily 20%: who needs a human, bench shortfall | Fold KPIs: BENCH 0/12 shortfall 12 · NEEDS A HUMAN 0. | **HOLDS** |
| 427 | hiring.html | CONFIRMED-FIXED HIGH | Demo Mode OFF → demo rows hidden and not counted | Demo Mode is OFF (sample-data). KPIs say `3 demo rows not counted` (OPEN APPLICATIONS 0). Board still shows DEMO Juniper Vale / Cedar Holt / Maple Crest. | **DOES-NOT-HOLD** (shown, not hidden) |
| 428 | hiring.html | CONFIRMED-FIXED MEDIUM | Empty tables say what will appear and how | Funnel table: 0 rows, no empty copy. Decision log: `No decisions in this window`. Neither says what will appear or how. | **DOES-NOT-HOLD** |
| 429 | hiring.html | CONFIRMED-FIXED MEDIUM | 3–4 sizes; even columns | 7 sizes (28/18/14/13/12/11/10). Uneven rows at y=120, 1320, 2368. | **DOES-NOT-HOLD** |
| 431 | sample-data.html | CONFIRMED-FIXED HIGH | Demo Mode OFF → only Turn ON; Wipe apart; confirm names count + irreversibility | DEMO MODE OFF. Only **Turn Demo Mode ON** (no Turn OFF). Wipe is in its own red-bordered card. Card copy names irreversibility and `the demo rows counted above` (clients: 7). Confirm dialog not opened. | **HOLDS** on toggle + separation. **UNVERIFIED** on confirm. |
| 432 | sample-data.html | CONFIRMED-FIXED MEDIUM | Wipe visually separated; confirm names count + irreversibility | Wipe sits in DELETE THE ROWS (y=631) vs Turn ON (y=244). Confirm not opened. | **HOLDS** on separation. **UNVERIFIED** on confirm. |
| 433 | sample-data.html | CONFIRMED-FIXED MEDIUM | Only the state-changing toggle; one filled button | Turn OFF is gone. 2 filled: Turn Demo Mode ON + Chat. Wipe is outline, not filled. | **DOES-NOT-HOLD** (2 filled) |
| 434 | sample-data.html | CONFIRMED-FIXED LOW | Counts as labelled numbers | `clients: 7`, lenders/call_outcomes/sales/tasks/documents/bank_accounts/subscriptions all `0`. | **HOLDS** |
| 435 | agent-editor.html | CONFIRMED-FIXED HIGH | LIVE card shows real prompt/guardrail state; defaults not shown as configured | Setter Josh LIVE selected. Gate: prompt 0 chars · guardrail 0 chars. Footer: `2 running with no stored prompt/guardrails`. Toggles NOT SET. | **HOLDS** |
| 436 | agent-editor.html | CONFIRMED-FIXED HIGH | Return to shadow asks first and names what stops | Return to shadow is visible (150×35, y=280). Confirm not opened. | **UNVERIFIED** |
| 437 | agent-editor.html | CONFIRMED-FIXED MEDIUM | Demoting a live agent confirms the consequence | Same button; confirm not opened. | **UNVERIFIED** |
| 438 | agent-editor.html | CONFIRMED-FIXED MEDIUM | One filled primary, reachable without scrolling | 3 filled: + New agent (fold), Save agent (y=1812, below fold), Chat. | **DOES-NOT-HOLD** |
| 456 | automations.html | CONFIRMED-FIXED HIGH | A LIVE pill and LAST FIRED 19h ago should mean the workflow ran | Those strings are gone. Status is TRIGGER SEEN. Copy: `This screen does not track whether a workflow ran.` | **HOLDS** |
| 457 | automations.html | CONFIRMED-FIXED MEDIUM | Tile values dominate; ≤4 text sizes | Tiles 51 / ON / 42 of 51 at 28px. 8 sizes (28/18/16/14/13/12/11/10). | **DOES-NOT-HOLD** |
| 458 | automations.html | CONFIRMED-FIXED MEDIUM | Sidebar active item and page title say the same thing | Nav active: Workflows. Title/breadcrumb: Automations. | **DOES-NOT-HOLD** |
| 459 | automations.html | CONFIRMED-FIXED LOW | 2d ago should be an absolute date; exact time on tooltip | Rows still show `1d ago` / `2d ago`. Tooltip not hovered. | **DOES-NOT-HOLD** |
| 463 | journeys.html | CONFIRMED-FIXED HIGH | Beta Dismiss and shell Search ⌘K can be clicked at 1440 | Dismiss 64×19 at (1238,10), enabled. Search ⌘K 99×36 at (908,12), enabled. Both above the fold. Click not run. | **HOLDS** on reachable. **UNVERIFIED** on click. |
| 464 | journeys.html | CONFIRMED-FIXED HIGH | Exactly one filled button | 2 filled: Make the change (disabled, still filled) + Chat. | **DOES-NOT-HOLD** |
| 465 | journeys.html | CONFIRMED-FIXED HIGH | Make the change disabled until text, or click says why | `asksend` is `disabled: true` with empty input. | **HOLDS** |
| 466 | journeys.html | CONFIRMED-FIXED MEDIUM | 3–4 sizes; body text readable | 6 sizes (18/14/13/12/11/10). Body is 14px. | **DOES-NOT-HOLD** |
| 467 | journeys.html | CONFIRMED-FIXED MEDIUM | Hit areas ≥40px | 14 targets under 40px (Dismiss 64×19, Make the change 151×35, Search 99×36). | **DOES-NOT-HOLD** |
