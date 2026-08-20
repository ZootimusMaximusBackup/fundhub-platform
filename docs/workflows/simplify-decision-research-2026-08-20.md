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
