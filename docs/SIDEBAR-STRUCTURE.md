# Sidebar structure

This is the living map of the CRM left rail. Edit `public/app/sidebar.fragment.html`, then run `node scripts/sync-sidebar.mjs`. Do not hand-edit a screen's `<aside>`.

## Why the rail no longer moves

Three things used to shift it between pages:

1. **Different geometry** — most screens used `width: 228px` in a flex `.app`; `finance-os.html` used `230px` + `position: sticky`; the three sales dashboards used `.app-shell` with little or no rail CSS.
2. **Page CSS hitting the rail** — bare `aside { padding… }` on sales screens styled the nav rail as a content column.
3. **Copied chrome** — each HTML file duplicated `.side` / `.navitem` rules, so one drift moved the rail on that page only.

**Fix (shell-level):**

- Geometry lives only in `public/app/crm-sidebar.css`: `position: fixed; left: 0; top: 0; bottom: 0; width: var(--fh-side-w)` with `!important` on the lock properties.
- Content clears the rail via `padding-left: var(--fh-side-w)` on `.app` / `.app-shell`.
- `shell.js` mounts the canonical markup, ensures the CSS link exists, injects a tiny lock stylesheet, and owns the collapse control (`html.fh-side-mini`).

No page can redefine the rail's left edge without losing to those rules.

## Final structure (most-used first)

Ordered by how a Fundhub day actually runs: sell → fund → serve the client → watch the book → automate → market → administer. Within a section, order is workflow sequence, not A–Z.

| Section | Items (in order) | Why this order |
|---|---|---|
| **Sales** | Pipeline → Closer Dashboard → Call cockpit → My numbers → Sales floor → Calendar | Desk work starts on the board; closers then open a call, check personal numbers; managers open the floor; calendar closes the booking loop. |
| **Funding** | Lenders → Finance OS → Contracts | Match a lender, read money, send the agreement. |
| **Client ops** | Client Control Panel → Messaging → Documents → Inquiry Remover → Company Brain | One client, talk to them, file, clear inquiries, firm knowledge. |
| **Watch** | Command Center → Galaxy → Ops & Admin | Roll-up KPIs, relationship graph, then platform health. |
| **Automation** | Agent Editor → Workflows → Journeys → Message Copy | Who speaks → what runs → drip journeys → the words themselves. |
| **Marketing** | Campaigns → Social Studio → Creative Factory → Content | Paid → organic → asset production → content library. |
| **Admin** | Staff & Teams → Hiring → Products & Commissions → Demo Mode → Brand Studio | People, then recruiting, then what we sell, then demo toggle, then partner brand. |
| **Portals** | Client Portal → Affiliate | External principal surfaces (hidden from ordinary staff). |

`partner-galaxy.html` stays out of the rail on purpose — partners land there from login; employees use Galaxy.

## Role visibility (nav)

Aligned with `ROLE_SETS` in `src/http/read-api.mjs` and the sales-screen rules:

| Screens | Who sees the nav row |
|---|---|
| Shared staff surface | Every `ROLE_SETS.STAFF` role |
| `closer-call.html`, `my-numbers.html` | `closer` (+ `owner` / `admin` via `*`) |
| `sales-floor.html` | `sales_manager` (+ `owner` / `admin`) |
| `journeys.html` | `owner` / `admin` |
| `hiring.html` | `owner` / `admin` (`ROLE_SETS.HIRING`) |
| `client-portal.html`, `affiliate.html` | those principal roles only |
| `partner-galaxy.html`, `brand-studio.html` | `partner` (brand-studio also on owner/admin `*`) |

## Redundancies inventory

Read every `public/app/*.html` screen. Pairs that look similar and the call made:

| Pair / group | Same job? | Call |
|---|---|---|
| `closer-dashboard.html` vs `my-numbers.html` | Related, not the same. Dashboard = legacy closer home + calculators. My numbers = live personal metrics API. | **Keep both.** Nav lists Dashboard then My numbers (workflow: land → check pace). Reversible: drop My numbers from Sales if the dashboard absorbs the API later. |
| `sales-floor.html` vs `command-center.html` | No. Floor = sales-team roll-up; Command Center = whole-book KPIs. | Keep both. |
| `automations.html` vs `journeys.html` | No. Workflows = Inngest/ops automations; Journeys = SMS/email journey editor. | Keep both. |
| `agent-editor.html` vs `template-editor.html` | No. Agents vs message copy. | Keep both. |
| `content-admin.html` vs `creative-factory.html` vs `social-studio.html` | No. Library vs creative production vs social publishing. | Keep all three; Content moved under Marketing. |
| `company-brain.html` vs `documents.html` | No. Firm knowledge vs client files. | Keep both. |
| `galaxy.html` vs `partner-galaxy.html` | Same metaphor, different audience/scope. | Keep both; partner view stays unlinked for staff. |
| `finance-os.html` vs old money-map / card-stack suite | Already consolidated earlier into Finance OS. | No further merge. |
| `consent-capture.html` | Soft-pull consent flow; not a CRM desk screen. | **Not in the sidebar** (unchanged). Page remains reachable by URL. |

No screen was deleted. No unique functionality was folded away.

## How to change the sidebar

1. Edit `public/app/sidebar.fragment.html`.
2. Run `node scripts/sync-sidebar.mjs`.
3. If roles change, update `ROLE_TABS` / allow-lists in `public/app/shell.js` and the Playwright spec `e2e/sidebar-roles.spec.mjs`.
4. Keep `src/http/app-nav-reachability.test.mjs` green.
