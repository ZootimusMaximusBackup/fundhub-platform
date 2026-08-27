# Simplify decision research — 2026-08-20

Read-only findings. No app code, tests, config, journeys, or evidence changed.

## Workflow 1 — duplicate survivor check

**Status:** done  
**Owned rows:** 1–22 and 34–45  
**Rule used:** same fact/action in the same work moment → keep one home and kill the extra. Different role, actor, or work moment → keep both. A dead control is not called a duplicate.

Sources:
- `docs/workflows/simplify-review-2026-08-19.md`
- `docs/workflows/display-redundancy-2026-08-19.md`
- `docs/workflows/button-redundancy-2026-08-19.md`
- `docs/workflows/action-redundancy-2026-08-19.md`
- `docs/workflows/data-redundancy-2026-08-19.md`
- Relevant `docs/journeys/*-intended.md` role files

### Rows 1–22

| Item | Verdict | Keep | Kill / demote | Why |
|---|---|---|---|---|
| 1 · Pipeline count | **KILL extras** | Header `17 cards` | Count badges in pipeline tabs; footer `17 cards across 10 stages` | Header is the active board summary. The other two repeat it during the same scan. |
| 2 · CCP scores | **KILL extra** | Top SCORES strip | Next Action `Credit EX/EQ/TU` badge | Same scores, same client, same screen. |
| 3 · CCP client name | **KILL extra** | Page title; current value inside the client picker because it is also the selector | Footer `live file · Francis Rawlins` | Title orients; picker switches files. Footer adds no job. |
| 4 · Messaging phone | **KILL extra** | Composer `Send this one to` phone | Phone repeat in right CONTACT panel | Composer is the safety check before sending. |
| 5 · Messaging name | **KILL extras** | Thread header name | Right-panel name title; client name inside composer placeholder | One thread header identifies the conversation. Placeholder can say `Write a message…`. |
| 6 · Messaging inbox count | **KILL extra** | All / Needs reply tab counts | Footer `live conversations · 1` | Tabs use the counts as filters; footer only repeats them. |
| 7 · Documents total | **KILL extra** | TOTAL KPI card and records table | Footer `13 records` | KPI is the summary; footer adds nothing. |
| 8 · Oldest pending document | **KILL extra** | Document table row | OLDEST PENDING spotlight card | The table is the work queue and already contains the same document. |
| 9 · Specialist dual case lists | **KILL extra list** | Inquiry Removal Cases table | Active Cases card list | One case queue is enough; table supports scanning without a second paint of the same cases. |
| 10 · Specialist open-inquiry zeros | **KILL conditional repeats** | Table ITEMS count; bureau queue only when it contains real non-zero work | Active Case `open inquiries 0`; hide empty bureau zero cards behind one `No open inquiries` state | Item 9 removes one repeat. Empty-data evidence does not prove the bureau totals are redundant when non-zero, so keep their real drill-down function. |
| 11 · Calendar empty today | **KILL extras** | Main-body `Nothing booked` empty state; keep week strip as date navigation | BOOKED 0 KPI; footer `0 today` | One plain empty message is enough. The week strip is navigation, not a second feature. |
| 12 · Product count | **KILL extra** | PRODUCTS KPI card | Footer `7 products` | Same count, same screen. |
| 13 · Empty lender state | **KEEP split** | CCP APPLY empty state and Closer Dashboard LENDER MATCHES empty state | Nothing | CCP is the application door. Closer Dashboard is deal math. Different jobs need honest empty states. |
| 14 · Client stage | **KEEP split** | Pipeline column/card, CCP MAIN STATUS, and Call header | Nothing | Board location, file status, and live-call orientation are different moments. |
| 15 · On-shift count | **KEEP split** | Sales Floor, Staff & Teams, and Calendar coverage | Nothing | Floor pace, staff roster, and schedule coverage are different manager jobs. |
| 16 · Default/min/max price | **FIX display** | One Price column for fixed-price products | Hide MIN and MAX when all three values are equal; show a range only when values differ | Three equal columns are noise, but real variable ranges must survive. |
| 17 · Pipeline Archive | **KILL extra action** | Drawer Archive; card DEL as a justified board shortcut | Top-bar `#boardArchiveTop` | Top bar appears only after selection and adds nothing beyond the drawer. |
| 18 · Specialist Mark Cleared | **KILL extra action** | Case-detail Mark cleared | Active Cases list Mark Cleared | Clearing should happen after reading case detail. |
| 19 · Specialist Close Case | **KILL extra action** | Case-detail Close | Active Cases list Close Case | Closing should happen after reading case detail. |
| 20 · Content Admin Save | **KILL extra action** | Top `#saveBtn` | `#saveTilesBtn` | Both perform the same tiles write. |
| 21 · Pipeline dead Apply | **DEFER — not redundancy** | Live CCP Funding Apply; Lenders Apply only when deep-linked with `client_id` | No Workflow 1 kill | Pipeline Apply never appears. Workflow 2 must decide whether its dead code is abandoned or intended to be wired. |
| 22 · Refresh from Drive | **DEFER — not redundancy** | Keep current control temporarily | No Workflow 1 kill | It is the only surviving click home, but its Company Brain label is orphaned. Workflow 2 must decide rename, relocate, hide, or wire. |

### Rows 34–45

| Item | Verdict | Keep | Kill / demote | Why |
|---|---|---|---|---|
| 34 · Client identity | **KEEP split** | CCP as full identity home; Pipeline, Messaging, Call, Portal, Specialist, and legal-capture context | Only the within-screen repeats already named in Items 3 and 5 | Each satellite identifies the person during a different job or for a different actor. |
| 35 · Credit scores | **KILL one extra; keep role views** | CCP full credit home; Pipeline card band for triage; Call panel for live talk; Closer Dashboard for math | Pipeline drawer full SCORES panel | The card band already handles board triage. Full drawer scores duplicate CCP; the call and calculator views serve different jobs. |
| 36 · Contract instances | **KEEP split** | Documents staff watch; Portal client agreements; shell search jump; send confirmation in Call/Present | Nothing | Staff watch, client signing, navigation, and sending are different jobs. |
| 37 · Documents / files | **KEEP split** | Documents master list; CCP staff upload; Specialist fraud-packet upload; Portal client upload/view | Nothing in this row | One table serves different actors and case moments. Door cleanup is Item 41. |
| 38 · Message teasers | **KEEP split** | Messaging inbox; CCP activity teaser; Call activity teaser | Messaging footer count already dies in Item 6 | Full inbox vs “activity exists” during file/call work are different jobs. |
| 39 · Tasks / bookings | **KEEP split** | Calendar master schedule; Call up-next; My Numbers owed; Pipeline booking; CCP blocker; Sales Floor rollup | Nothing | Each surface answers a different person’s immediate question. |
| 40 · Commissions / offers | **KEEP split** | Products org ledger/catalog; My Numbers personal rollup; Sales Floor team view | Nothing | Owner, closer, and manager views are different jobs. |
| 41 · Three document doors | **KILL weak staff doors** | Documents as staff view home; keep actual client Portal documents | Portal’s staff-only duplicate list; Specialist raw-JSON “open documents” door — replace both with a client-filtered link to Documents | Staff should use one real document list. Client self-service and Specialist upload actions still stay. |
| 42 · Four schedule surfaces | **KEEP split** | Calendar, My Numbers owed, Call up-next, Sales Floor unlogged | Nothing | Full schedule, personal debt, next call, and manager exception count are different jobs. |
| 43 · Three offer presentations | **KEEP split** | Products catalog, My Numbers personal stack, Sales Floor sold view | Nothing | Catalog, personal results, and floor results are not the same work moment. |
| 44 · Send contract | **KEEP justified shortcut** | Call cockpit Send and Present Send | Nothing | Both happen during a live pitch/call; removing either forces a screen hop. They share code but serve two active work surfaces. |
| 45 · Upload file | **KEEP split** | CCP staff upload; Portal client upload; Specialist fraud-packet upload | Nothing | Different actors and document subtypes. Do not add a fourth upload home. |

### Workflow 1 handoff

- **Clear duplicate removals:** 1–12, 17–20, 35, 41.
- **Display fix, not deletion:** 16.
- **Keep because jobs/actors differ:** 13–15, 34, 36–40, 42–45.
- **Not redundancy; Workflow 2 decides intent:** 21–22.
- **Evidence limit:** Item 10 was captured with all-zero data. The safe decision is to remove repeated zero paint, not delete useful non-zero bureau drill-downs without proof.

## Workflow 2 — dead-control intent check

**Status:** done  
**Owned rows:** 21–33  
**Rule used:** keep the product job when real data, a real route, or an intended journey supports it. Hide the control until it works. Kill demo-only UI, unreachable copies, and fake controls that already have a real home elsewhere.

| Item | Verdict | Keep | Immediate decision | Internal proof |
|---|---|---|---|---|
| 21 · Pipeline dead Apply | **KILL dead third path** | CCP Funding Apply; Lenders Apply with `client_id` | Delete the unreachable Pipeline lender-match panel and Apply code | `showLenderMatches()` is defined but never called. The same application job already works from CCP and Lenders. |
| 22 · Refresh from Drive | **KEEP + FIX label** | Sales Floor recordings sync | Rename to **Sync recordings from Drive** (or **Refresh recordings**) and keep it beside Today’s recordings | It is fully wired to `POST /api/company-brain/sync`. The endpoint indexes Meet recording metadata and links; Sales Floor is the right surviving home even though Company Brain left nav. |
| 23 · Open Bank Inbox | **WIRE-UP; hide until ready** | The Bank Inbox product job | Build a client-scoped read view, then show the button. Hide the disabled placeholder until that view exists | Mailgun events already write real `bank_inbox` rows through `src/handlers/comms.mjs`. No bank-inbox read route or UI exists. Provider proof is paused on the unpaid Mailgun balance, but the feature is not imaginary. |
| 24 · Raw Report | **HIDE — prerequisite missing** | The future raw-report idea, not today’s button | Remove/hide the disabled control. Re-add only when a bureau PDF/document actually exists | CRS pull writes `crs_results`; it creates no document, storage link, or readable PDF route. There is nothing current code can wire the button to. |
| 25 · CCP Notes | **WIRE-UP** | Notes field on the client file | Save to the client’s `custom_fields.staff_notes` (or the existing `notes` key) through an org-scoped write; keep read-only until that write exists | The CCP already reads `cf.notes || cf.staff_notes` and says the field is for context for the next person. The database has `custom_fields`; only the write route is missing. |
| 26 · Calendar day events | **WIRE-UP locally** | Day event blocks and the existing Up Next rail | Clicking an event should select that task and populate Up Next; then existing Join Call / Client file buttons work | Calendar already has `selectedId`, task lookup, and rail paint logic. “Then” rows do this today; `.evt` blocks simply lack the matching click binding. No new backend is needed. |
| 27 · Commission Close vN | **WIRE-UP; hide editor until ready** | Real commission rule versioning | Read real `commission_rules`; close the live row and insert its replacement through a real API. Do not show Change rate / Close vN until that path exists | `commission_rules` and tiers are real schema. `SQL_SUPERSEDE_RULE` already defines history-safe closing. The screen currently keeps an empty local `RULES` array and never writes. |
| 28 · Staff profile Save | **FIX to honest scope** | Invite, role, monitoring consent, suspend, reset, and self-clock actions that already work | Existing staff name/email/phone/start fields become read-only. Save remains only for role/consent. New-person name/email stay editable for Invite | Existing Save writes role and consent only. Staff has no phone column or profile-update endpoint; email is also the login identity. Do not pretend all profile fields save. |
| 29 · Staff active/clock switches | **KILL fake switches** | Revoke login button for access; Clock tab for self clock-in/out | Remove Active and Clock switches from the profile editor | Real access and shift actions already have separate, gated controls. The editor switches are never posted and conflict with those real homes. |
| 30 · Portal Unlock / pay now | **KEEP feature hidden until checkout exists** | Locked product tiles and advisor handoff | Keep pay/unlock hidden when no `checkoutUrl`; show it only for a product with a real checkout URL | Current source already uses `canCheckout` and hides the buy button when checkout is absent. If deployed UI still shows it, that is a deploy/version gap, not a reason to delete the future payment job. |
| 31 · Portal wireframe states | **KILL demo controls** | Real portal data and entitlement-driven states | Remove Before call / In progress / Just funded toggles and their local sample-state switcher | The buttons only repaint local copy. No journey, route, or stored portal-state field supports them. |
| 32 · Specialist letter draft | **FIX read-only; do not send edits** | Generated letter preview, Generate letters, and Send letters | Render the generated draft as read-only text. Do not offer editing until a separate approved edit/save/send design exists | The intended journey says Send letters appears when a body is ready and only a click mails it. `.letter-edit` is never read; send uses stored `letter_draft_html` / repair-letter HTML. Future editable credit-repair copy is a compliance-flagged build. |
| 33 · Sales Floor static Flag | **KILL dead fallback markup** | JS-painted, wired Flag to marketing and recordings controls | Remove the raw static Flag / recordings buttons | `paint()` replaces that HTML. The live `#fh-flag-mkt` and `#fh-drive-refresh` controls are wired; the fallback buttons can only mislead when paint fails. |

### Workflow 2 handoff

- **Kill dead/demo UI:** 21, 29, 31, 33.
- **Keep and wire real jobs:** 23, 25, 26, 27.
- **Keep but make honest now:** 22, 28, 32.
- **Hide until a real prerequisite exists:** 24, 30.
- **Compliance marker for a later Fixer:** Item 30 touches payment rails; Item 32 touches credit-repair messaging. Their fixes require `COMPLIANCE REVIEW REQUIRED` in the change summary.

## Combined recommendation — ready for owner approval

1. Apply every Workflow 1 **KILL extra**, **FIX display**, and **KILL weak staff doors** row.
2. Apply Workflow 2 exactly as classified above: kill fake/dead copies, wire jobs backed by real data, and hide jobs with missing prerequisites.
3. Preserve every Workflow 1 **KEEP split** row. Those are different actors or work moments, not duplicates.
4. Run the separate UI-polish audit only after this simplify pass is applied.

## Owner decision — protected sales presentation flow

**Owner-set 2026-08-20:** Do not remove, merge, hide, demote, or “simplify” the sales-rep presentation flow.

Protected as core company workflow:
- Present / screen-share deck (`present.html` + its client-scoped data).
- Call cockpit → Present handoff.
- Closer context reads and context fetchers that feed the rep before and during the call.
- Contract, pay-link, credit, offer, and disposition actions used from the closer/presentation flow.

**Owner-set requirement:** the context fetcher is not merely protected. It must be wired and proven working before launch.

Current code trace:
1. Call cockpit Save posts `/api/call-outcomes` → `logCallOutcome()` → `call_outcomes`.
2. Present `log_disposition` posts `/api/closer-deck` → `logDeckDisposition()` → the same `logCallOutcome()` and `call_outcomes` table.
3. `fetchContext()` reads recent `call_outcomes`, customer insights, recordings, messages, pipeline stage, funding round, survey answers, credit snapshot, and the client.
4. Agent runtime calls `fetchContext()` on every eligible agent turn and injects `context.as_prompt_block` into the system prompt.
5. `/api/read/agent-context` calls the same fetcher; CCP displays that exact prompt block for staff.

**Code verdict:** wired.  
**Targeted test verdict:** 51/51 context, runtime, closer-call, and Present tests passed on 2026-08-20.  
**Launch proof still required:** no real-Postgres or live browser test currently proves the full chain “closer saves outcome → context API shows it → next agent turn receives it.” Run that proof before calling the protected flow launch-ready. If it fails, fix the context path; do not simplify or redesign the deck.

Workflow 1 already matches this decision:
- Item 14 keeps the stage/context on the Call cockpit.
- Item 35 keeps credit context on the Call panel and Closer Dashboard.
- Item 44 keeps Send contract on both Call cockpit and Present.

These surfaces may be repaired when Chris names a specific defect. They are **not** cleanup or redundancy targets. Extra dashboards and fake/dead controls outside this flow remain in scope.

## Implementation manifest — 2026-08-20

**Status:** independent-review repairs complete; ready for parent review with the held items and repository-wide baseline failures below.
**COMPLIANCE REVIEW REQUIRED:** Item 32 changes the Specialist credit-repair letter display from an editable-looking box to read-only. Letter generation and sending were not changed.

Implemented decisions:
- Rows 1–12, 17–21, 24, 29, 31, 33, 35, and 41: removed only the named duplicate, dead, demo, or prerequisite-free controls.
- Row 16: one Price column now shows a single fixed price or a real range.
- Rows 22, 23, 25–28, and 32: fixed the label or wired the existing job to real data and writes.
- Row 30: pay/unlock remains hidden without a real checkout URL.
- Rows 13–15, 34, 36–40, and 42–45 remain split by actor or work moment.
- Row 37 stays intact: client sessions now receive their own file metadata from the session-bound `portal-summary` read and do not call the staff-only Documents read. Row 41 removes only the duplicate staff door and sends staff to the filtered Documents home.
- The simplify work did not edit Present, Call cockpit, closer-context, context-fetcher, pay-link, credit, offer, or disposition files. The pending merge was advanced to `origin/main` at `e09d6263`; it is the only source of the staged Contracts permission and live-gate files.

App and route files changed:
- `public/app/pipeline.html`
- `public/app/client-control-panel.html`
- `public/app/messaging.html`
- `public/app/documents.html`
- `public/app/inquiry-remover.html`
- `public/app/calendar.html`
- `public/app/products-commissions.html`
- `public/app/content-admin.html`
- `public/app/staff-teams.html`
- `public/app/sales-floor.html`
- `public/app/sales-floor.js`
- `public/app/client-portal.html`
- `public/app/data.js`
- `api/read/bank-inbox.mjs` (new)
- `api/read/portal-summary.mjs`
- `api/client-notes.mjs` (new)
- `api/commission-rules.mjs` (new)
- `netlify/functions/api.mjs`

Commission configuration:
- `db/migrations/246_owner_commission_rates_20260820.sql` adds effective-dated 2026-08-20 rows for closer 16.67% of collected deposit, closer 0.25% of funded amount, manager 5% of collected deposit, and manager 0.25% of funded amount.
- `db/expected-migrations.mjs` was regenerated.
- No manager upsell rule was invented.
- The closer 20% downsell/upsell and manager 5% downsell formulas are owner-set but remain pending. They need a durable `sale_motion` plus product identity source; ordinary cash collected, UI labels, default prices, agreed amounts, and requested amounts are not safe substitutes.
- **End-to-end blocker:** part payments can reuse the same commission ledger key, so a later payment can collide with the earlier payment.
- **End-to-end blocker:** closer and `sales_manager` attribution is not assigned automatically on every supported sale/funding event. The four dated rules are safe configuration, but missing attribution can prevent a real payout row from being created.
- Funded commission uses `funding_rounds.funded_amount` only. This diff contains no fallback to approved, agreed, or requested amounts.

Tests, journeys, and evidence changed:
- `src/http/simplify-implementation.test.mjs` (new)
- `src/http/pipeline-screen.test.mjs`
- `src/http/documents-screen.test.mjs`
- `src/http/crm-html.test.mjs`
- `e2e/controls-persist.spec.mjs`
- `e2e/client-portal-ux.spec.mjs`
- Generated `docs/journeys/*-actual.md` pages and `docs/journeys/README.md`
- `docs/journeys/CHANGELOG.md`
- `docs/workflows/simplify-implementation-2026-08-20-evidence/_mark-proof.py`
- `docs/workflows/simplify-implementation-2026-08-20-evidence/shots/calendar-event-click-MARKED.png`

Verification recorded so far:
- Focused handler and screen tests: 129 passed, 0 failed, 0 skipped. The Bank Inbox, notes, commission, and portal-summary tests call the real handlers and prove missing auth, denied roles, missing org, session-org scope, and route registration.
- Client Portal browser suite: 10 passed, 0 failed. The client file check proves the staff-only Documents read was never requested.
- Named repair browser checks: 6 passed, 0 failed after the two commission checks were corrected to open the Commission Rules tab. These prove real tier field names, hidden tiered write controls, the read-error state, Raw Report absence, notes save, and Bank Inbox.
- Syntax lint: 1,368 files and inline scripts parse clean.
- Generated journey check: all 9 files are up to date.
- `npx tsc --noEmit`: unavailable because this repository has no `tsconfig.json`; the command prints TypeScript help and exits 1.
- Full repository suite baseline: 6,270 passed, 3 failed, 3 skipped. All three failures are the unrelated blockers listed below.
- Calendar automated proof remains **UNVERIFIED**. Attempt 2 visibly selected Dana Whitfield and repainted Up Next, but its expected copy was wrong. No third run was made under the stuck rule. The existing marked screenshot remains observational evidence only: `shots/calendar-event-click-MARKED.png`.

Commit-safe simplify set:
- App/API: the 13 screen/script files, four handlers, and route table listed above.
- Data: `db/migrations/246_owner_commission_rates_20260820.sql`, `db/expected-migrations.mjs`.
- Tests: `src/http/simplify-implementation.test.mjs`, `src/http/crm-html.test.mjs`, `src/http/pipeline-screen.test.mjs`, `src/http/documents-screen.test.mjs`, `e2e/client-portal-ux.spec.mjs`, `e2e/controls-persist.spec.mjs`.
- Records: generated journey actuals/README, `docs/journeys/CHANGELOG.md`, this board, and `docs/workflows/simplify-implementation-2026-08-20-evidence/`.

Exclude from the simplify commit:
- `package.json`.
- Notion/lender work: `scripts/notion-lenders-to-csv.mjs`, `scripts/notion-scrape/lenders-extract.mjs`, `src/lenders/notion-lenders-extract.test.mjs`.
- Old audit/review packs: `docs/workflows/display-redundancy-2026-08-19*`, `docs/workflows/simplify-review-2026-08-19*`.
- UI standards, SMS, and offer research: `docs/workflows/ui-standards-audit-2026-08-20*`, `docs/workflows/sms-audit-2026-08-20.md`, `docs/workflows/slo-offers-architecture-2026-08-20.md`.
- The staged Contracts permission and live-gate files are `origin/main` carry-in from the pending merge, not simplify changes.

Repository-wide blockers observed in the full suite and not changed by this simplify scope:
- Journey extraction still cannot trace the pre-existing `finance/crs-pull` and `gifts/message-blaster` gate shapes.
- `api/read/company-brain-affiliate.mjs` fails the pre-existing org-scope source check.
- `api/social/generate.mjs` fails the pre-existing outbound-fetch fence.

## Launch-proof gap closure — 2026-08-20

**Branch:** `cursor/launch-proof-gaps-89ad`
**Status:** proof support complete. Rollback-only real-Postgres chain passed. Live 31/31 and human browser proof are blocked because this cloud run has no live database or login credentials.

Task list:

| Unit | Owner | Status |
|---|---|---|
| One-database Call → context → model-request proof | this cloud run | **done — real PostgreSQL PASS** |
| One-database Present → context → model-request proof | this cloud run | **done — real PostgreSQL PASS** |
| Marked Pipeline card/drawer fixture | this cloud run | implemented; live proof blocked by missing database and login |
| Inactive read-only tier fixture | this cloud run | implemented; live proof blocked by missing database and login |
| Real e2e client Portal session with cleanup | this cloud run | implemented; live proof blocked by missing database and password |
| Existing required live suite | this cloud run | blocked by missing staff password; not run |
| Human browser walk after 100/100 | this cloud run | blocked because the live gate could not run |

Change manifest:
- `src/http/launch-proof-chain.pg.test.mjs` — rollback-only real-Postgres proof. Call and Present handlers write to `call_outcomes`; the actual agent-context handler reads each marker; the next runtime turn sends the same marker to a model spy through the real `system` request.
- `scripts/launch-proof-fixtures.mjs` — fixed-id E2E fixtures with exact marker checks and cleanup. The script refuses unmarked collisions.
- `src/http/launch-proof-fixtures.test.mjs` — source guard for fixture labels, inactive tier status, exact cleanup predicates, and separation from the required live suite.
- `e2e/launch-proof-live.spec.mjs`, `playwright.launch-proof.config.mjs`, and the one-line `playwright.config.mjs` ignore — deployed-site read proof for Pipeline, commission rules, and a client Portal session, isolated from both existing suites. The spec registers cleanup and never clicks move, archive, rate edit, send, pull, letter, payment, or delete actions.
- `.github/workflows/tests.yml` — uses the pgvector PostgreSQL image required by existing migrations and runs the focused chain proof before older full-suite failures.

Safety:
- Pipeline creates a new marked E2E client and card. It never updates a real card or stage.
- The tier rule is `active=false`, uses a fixed E2E name, and is read only.
- Portal uses a client account named `E2E LAUNCH PROOF TEST FIXTURE` at the allowed `e2e+aff-*` address. Account sessions and login attempts are removed with the client.
- The database integration proof uses one transaction and ends with `ROLLBACK`.
- No Present or Call product file changed. No commission formula or rate changed.

Evidence folder:
- `docs/workflows/launch-proof-2026-08-20-evidence/`
- Real-Postgres run: `https://github.com/ZootimusMaximusBackup/fundhub-platform/actions/runs/32422552899`; focused Call + Present step passed.
- Live fixture rows were not created. No unmarked or mocked screenshot is presented as live evidence.
