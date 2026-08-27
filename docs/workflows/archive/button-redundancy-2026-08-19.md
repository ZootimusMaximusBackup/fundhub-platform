# Button redundancy audit — 2026-08-19

**Mode:** Auditor · read-only · findings only · no code edits  
**Evidence:** static inventory of `public/app/*.html` + shared `public/app/*.js` against `netlify/functions/api.mjs` `ROUTES`  
**Date:** 2026-08-19

## Scope

**Skipped (14 retired / nav-kill KILL list):**  
`finance-os.html`, `consent-capture.html`, `company-brain.html`, `galaxy.html`, `partner-galaxy.html`, `ops-admin.html`, `automations.html`, `journeys.html`, `brand-studio.html`, `campaign-manager.html`, `social-studio.html`, `creative-factory.html`, `hiring.html`, `affiliate.html`

**Audited (18 survivors = sidebar minus those 14):**  
nav-kill KEEP 16 + two still-on-nav screens not in KEEP:

| # | Screen | Role in product |
|---|---|---|
| 1 | `pipeline.html` | Sales board |
| 2 | `closer-dashboard.html` | Closer home (read-only) |
| 3 | `closer-call.html` | Call cockpit |
| 4 | `my-numbers.html` | Closer numbers (read-only) |
| 5 | `sales-floor.html` | Floor / recordings |
| 6 | `calendar.html` | Calendar |
| 7 | `lenders.html` | Lender book (+ Apply) |
| 8 | `client-control-panel.html` | Client file |
| 9 | `messaging.html` | Inbox |
| 10 | `documents.html` | Doc list + contract remind/void |
| 11 | `inquiry-remover.html` | Specialist desk |
| 12 | `agent-editor.html` | Agent copy / promote |
| 13 | `template-editor.html` | Message wording |
| 14 | `content-admin.html` | Portal tiles / video |
| 15 | `staff-teams.html` | Staff / clock / invite |
| 16 | `products-commissions.html` | Products + rules UI |
| 17 | `contracts.html` | Contract templates |
| 18 | `client-portal.html` | Client portal |

**Shared chrome on every staff screen (`shell.js` + `chat-widget.js`):** Sign out, global search, chat fab — listed once under Shared, not repeated per screen.

**Not click→API:** page-load reads, accordion/tab toggles, filters that only change local paint, unless they are the only way an action is reached.

---

## Flags summary

| Kind | Count (groups) | Highest signal |
|---|---|---|
| Exact duplicates | 6 | Archive ×3 on Pipeline; Save tiles ×2 on Content; Mark Cleared / Close ×2 on Specialist; Apply on CCP + Lenders (+ dead Pipeline) |
| Near-duplicates | 8 | Same endpoint, different `action` / bureau / filter |
| Dead / fake | 7 | Pipeline Apply never shown; CCP Bank Inbox + Raw Report disabled; commission “Close vN” never posts; calendar day events not clickable; staff Save skips name/email/phone |

**ROUTES:** Every live click path below is present in `ROUTES`. No wired handler was found that hits a missing route key (would 404 at the API router).

---

## Master table — action fired → every button → screen + location

| Action fired | Buttons that trigger it | Screen · location | Flag |
|---|---|---|---|
| **Shared chrome** | | | |
| `POST /api/auth/logout` | `#fh-shell-out` Sign out | All staff screens · shell foot | shared (ok) |
| `GET /api/read/search?q=` | Global search submit | All staff screens · shell search | shared (ok) |
| `POST /api/chat/ask` | Chat Send (Ask / Knowledge mode) | All staff · chat widget | shared (ok) |
| `POST /api/chat/messages` | Chat Send (Message mode) | All staff · chat widget | shared (ok) |
| `POST /api/chat/portal-message` | Chat Send | `client-portal.html` · chat widget | portal-only |
| **Pipeline** | | | |
| `GET /api/dashboard/pipeline?key=` | Rail tabs R-01…R-09 | `pipeline.html` · left rail | — |
| `GET /api/dashboard/client?id=` | Click card body | `pipeline.html` · board card | — |
| `POST /api/pipeline-cards` `{action:"move"}` | MOVE menu items; drag card → column | `pipeline.html` · card / columns | near-dup (stage targets) |
| `POST /api/dashboard/client-archive` `{confirm:"DELETE"}` | Card **DEL**; drawer **Archive** `#fhDrawerDel`; bar **Archive** `#boardArchiveTop` → confirm `#fhDelGo` | `pipeline.html` · card / drawer / top bar | **EXACT DUP** |
| `POST /api/proxy/launch` (+ optional `POST /api/proxy/end`) | Match panel **Apply** (via `FHProxyApply`) | `pipeline.html` · lender match panel | **DEAD** — `showLenderMatches()` never called |
| **Client Control Panel** | | | |
| `GET /api/dashboard/clients` | Client `#ccp-pick` (list load) | `client-control-panel.html` · top pick | — |
| `POST /api/finance/crs-pull` `{bureau}` | `#ccp-pull-tu` / `#ccp-pull-ex` / `#ccp-pull-eq` | CCP · Soft pull | near-dup (bureau) |
| `GET /api/read/lender-matches` | `#ccp-generate-apps` Generate Apps | CCP · Funding | — |
| `POST /api/proxy/launch` (+ `/proxy/end`) | Per-lender **Apply** | CCP · Funding list | **EXACT DUP** w/ lenders (live) |
| `POST /api/inquiry-cases` `{action:"create"}` | `#ccp-issue-ir` Issue Inquiry Removal | CCP · actions | near-dup (cases) |
| `POST /api/documents-upload` | Staff dropzone upload | CCP · Upload | **EXACT DUP** group |
| *(none)* | **Open Bank Inbox** | CCP · link row | **DEAD** — `disabled`, no listener |
| *(none)* | **Raw Report** | CCP · Soft pull | **DEAD** — `disabled` by design |
| Clipboard only | `#ccp-approve-copy` | CCP · consent link | UI-only |
| **Closer / sales** | | | |
| *(no click→API)* | — | `closer-dashboard.html` | read-only screen |
| *(no click→API)* | — | `my-numbers.html` | read-only screen |
| `POST /api/call-outcomes` | `#fh-save-next` Save · next call | `closer-call.html` · outcome bar | — |
| `POST /api/contracts` `create_draft` then `send` | `#fh-send-contract` → `#fh-contract-go` | `closer-call.html` · contract panel | near-dup (contracts) |
| Clipboard only | `#fh-contract-copy` | closer-call · contract panel | UI-only |
| UI `window.open` | `#fh-join` Join call | closer-call | UI-only |
| Nav | `#fh-present` Present | closer-call → `present.html` | nav |
| `POST /api/marketing-flags` | `#fh-flag-mkt` Flag {belief} | `sales-floor.html` · after paint | — |
| `POST /api/company-brain/sync` | `#fh-drive-refresh` Refresh from Drive | `sales-floor.html` · recordings | odd home (see below) |
| UI scroll | `#fh-recordings-jump` | sales-floor | UI-only |
| **Calendar / messaging** | | | |
| `GET /api/tasks`, `GET /api/shifts?roster=1` | *(boot only)* | `calendar.html` | — |
| UI `window.open` | `#unJoin` Join Call | calendar · Up Next | UI-only |
| Nav | `#unFile` Client file | calendar → CCP | nav |
| *(none)* | Day timeline `.evt` blocks | calendar · day view | **DEAD** — painted, no click listener |
| `GET /api/read/inbox` (± `needs_reply`) | Tabs All / Needs reply | `messaging.html` | near-dup (filter) |
| `GET /api/read/messages?conversation_id=` | Convo row | messaging · list | — |
| `POST /api/messages` | `#sendBtn` / Enter | messaging · composer | — |
| **Lenders** | | | |
| `GET /api/read/lenders` | `#btnFilter` Apply filters; export uses same + `format=csv` | `lenders.html` | near-dup (query) |
| `POST /api/lenders` `{action:"import"\|"create"\|"save"}` | Import / Add / row Save | lenders | near-dup (action) |
| `POST /api/proxy/launch` | Row **Apply** (needs `?client_id=`) | lenders · list | **EXACT DUP** w/ CCP |
| `POST /api/lender-observations` `{action:"review"}` | Confirm / Corrected / Dismiss | lenders · mismatch queue | — |
| `POST /api/ai-bureau-config` | Bureau row Save | lenders · AI bureau tab | — |
| **Documents / contracts / templates** | | | |
| `POST /api/contracts` `{action:"remind"}` | Row **Remind** | `documents.html` · contract col | near-dup (contracts) |
| `POST /api/contracts` `{action:"void"}` | Row **Void** | documents · contract col | near-dup (contracts) |
| `GET /api/read/contracts` (PDF blob) | **Open PDF** | documents | — |
| `POST /api/contracts` create/save/archive/upload/save_fields | `#btnSaveTpl`, `#btnArchive`, `#btnUpload`, `#btnSaveFields` | `contracts.html` · editor | near-dup (contracts) |
| `POST /api/message-templates` `{action:"save"}` | `#saveBtn` Save wording | `template-editor.html` | near-dup (templates) |
| `POST /api/message-templates` `{action:"approve"}` | `#apprBtn` Approve | template-editor | near-dup (templates) |
| **Inquiry Remover** | | | |
| `POST /api/inquiries` attempt / confirm / status | Log attempt / Mark confirmed / Set status | `inquiry-remover.html` · work queue | near-dup (inquiries) |
| `POST /api/pii` | Reveal SSN | inquiry-remover · identity | — |
| `POST /api/inquiry-cases` `{action:"mark_cleared"}` | Active Cases **Mark Cleared**; case detail **Mark cleared** | inquiry-remover · two panels | **EXACT DUP** |
| `POST /api/inquiry-cases` `{action:"close"}` | Active Cases **Close Case**; case detail **Close** | inquiry-remover · two panels | **EXACT DUP** |
| `POST /api/inquiry-cases` `{action:"send",…}` | Case detail **Send** | inquiry-remover · case detail | — |
| `POST /api/documents-upload` | Upload FTC / police report | inquiry-remover · case detail | **EXACT DUP** group |
| `POST /api/repair/generate` | Generate letters | inquiry-remover · repair | — |
| `POST /api/repair/send` | Send letters | inquiry-remover · repair | — |
| `POST /api/repair/exceptions` `{action:"confirm_parse"}` | Stuck-file confirm | inquiry-remover · repair | — |
| `GET /api/read/documents` | Download packet | inquiry-remover | — |
| **Content / products / staff / agents** | | | |
| `POST /api/content/tiles` `{action:'save'}` | `#saveBtn` Save changes; `#saveTilesBtn` Save tiles | `content-admin.html` · top + tiles | **EXACT DUP** |
| `POST /api/content/upload` | `#doUpload` Upload | content-admin | — |
| `POST /api/products` `{action:"save"\|"create"}` | `#edSave` Save | `products-commissions.html` · product editor | near-dup (products) |
| *(none — local `RULES` only)* | Change rate → **Close vN · open vN+1** | products-commissions · Commission rules | **DEAD / fake** |
| `POST /api/auth/invite` | `#edSave` (new person) | `staff-teams.html` · editor | — |
| `POST /api/auth/staff-role` | `#edSave` (role change) | staff-teams · editor | — |
| `POST /api/staff/monitoring-consent` | `#edSave` consent / Record / Revoke | staff-teams | — |
| `POST /api/auth/suspend` | `#edDeact` Revoke login | staff-teams | — |
| `POST /api/auth/admin-reset` | `#edReset` Reset password | staff-teams | — |
| `POST /api/shifts` | Clock in/out | staff-teams · Clock tab | — |
| `GET /api/staff/telemetry` | `#teleRefresh` | staff-teams · Telemetry | — |
| Partial UI close | `#edSave` with no role/consent change | staff-teams · editor | **DEAD (partial)** — name/email/phone not written |
| `POST /api/agents` save / promote / demote / create | `#saveBtn`, `#promoteBtn`, `#demoteBtn`, `#newBtn` | `agent-editor.html` | near-dup (agents) |
| **Client portal** | | | |
| `POST /api/consent/capture` `{action:"grant",…}` | `#cpSignSubmit` sign card | `client-portal.html` · dispute auth | near-dup vs retired consent-capture screen |
| `POST /api/documents-upload` | `#upload-btn` Upload Documents | client-portal · action card | **EXACT DUP** group |
| Checkout / book / unlock | `#um-go`, `data-book`, `data-unlock` | client-portal · tiles / modals | UI / external URL |

---

## Exact duplicate groups → one canonical home

| # | Action | Where it appears today | Canonical home (recommend) | What to drop / hide |
|---|---|---|---|---|
| D1 | `POST /api/dashboard/client-archive` | Pipeline: card DEL, drawer Archive, top-bar Archive (all → same confirm) | **Pipeline drawer Archive** (full context) | Keep card DEL as shortcut *or* top bar — not both. Prefer card DEL + drawer; remove `#boardArchiveTop` |
| D2 | `POST /api/proxy/launch` Apply | CCP Funding Apply (live); Lenders row Apply when `?client_id=`; Pipeline match Apply (**unreachable**) | **Client Control Panel · Funding Apply** for a known client. Lenders Apply only when deep-linked with `client_id` is OK as secondary | Delete or wire Pipeline `showLenderMatches` — do not leave a third Apply |
| D3 | `POST /api/content/tiles` save | Content Admin `#saveBtn` + `#saveTilesBtn` | **One Save** at top (`#saveBtn`) | Remove `#saveTilesBtn` or make it a sticky alias of the same control, not a second button |
| D4 | `POST /api/inquiry-cases` mark_cleared | Specialist Active Cases panel + case detail | **Case detail** (full context before clear) | Keep Active Cases list read-only for status; clear only from detail |
| D5 | `POST /api/inquiry-cases` close | Same two places | **Case detail** | Same as D4 |
| D6 | `POST /api/documents-upload` | CCP staff upload; Specialist FTC/police upload; Portal client upload | **Three audiences, one endpoint — OK.** Canonical *UI* per role: staff → CCP; specialist packet → Inquiry Remover; client → Portal | Do not add a fourth upload surface. Do not put client upload on CCP |

---

## Near-duplicate groups → one canonical home

| # | Endpoint | Variants | Canonical home | Note |
|---|---|---|---|---|
| N1 | `POST /api/contracts` | closer-call send; documents remind/void; contracts.html template CRUD | **Send** → closer-call (or CCP later). **Template authoring** → `contracts.html`. **Remind/void** → `documents.html` | Keep split by job; do not put template editor on closer-call |
| N2 | `POST /api/finance/crs-pull` | TU / EX / EQ buttons | **CCP Soft pull** (three bureau buttons are intentional) | Not redundancy — same action, required params |
| N3 | `POST /api/inquiry-cases` | CCP `create` vs Specialist send/clear/close | **Create** → CCP. **Work the case** → Inquiry Remover | Correct split |
| N4 | `POST /api/message-templates` | save vs approve | **template-editor.html** only | Approve stays owner/admin on same screen |
| N5 | `POST /api/agents` | save / promote / demote / create | **agent-editor.html** only | OK |
| N6 | `POST /api/products` | save vs create | **products-commissions.html** product editor | OK |
| N7 | `GET /api/read/inbox` | all vs needs_reply | **messaging.html** tabs | OK |
| N8 | `POST /api/company-brain/sync` from Sales Floor “Refresh from Drive” | Only click home found on surviving screens | **Move to a Watch/ops home when one exists**; until then leave on Sales Floor *or* rename so it does not sound like Company Brain** | Company Brain screen is retired — this button is now an orphan label on Sales Floor |

---

## Dead / fake buttons

| Screen | Control | Why dead | Evidence |
|---|---|---|---|
| `pipeline.html` | Lender-match **Apply** (+ panel) | `showLenderMatches()` defined, never called | `pipeline.html:1117` (sole hit) |
| `client-control-panel.html` | Open Bank Inbox | `disabled`, title “Not wired” | `:626` |
| `client-control-panel.html` | Raw Report | `disabled` by design (no PDF link) | `:641` |
| `calendar.html` | Day `.evt` appointment blocks | Rendered, no click handler | paint ~770 |
| `products-commissions.html` | Close vN · open vN+1 | Mutates in-memory `RULES` only; never `FHData.write` | `:556–571`; comment `:405` “no live rules read” |
| `staff-teams.html` | Save with only profile field edits | Closes UI; does not persist name/email/phone | editor save path ~599–633 |
| `sales-floor.html` | Static Flag / recordings markup (no ids) | Replaced when `paint()` runs; bare HTML is unreachable | HTML ~274–275 vs JS wire `#fh-flag-mkt` |

---

## Screens with no action buttons (beyond shared chrome)

| Screen | Click→API actions | Notes |
|---|---|---|
| `closer-dashboard.html` | 0 | Load-only reads |
| `my-numbers.html` | 0 | Load-only reads |

These are not dead — they are read dashboards. Redundancy risk is low unless someone adds a second “same numbers” write surface later.

---

## Recommended Fix order (for a later Fixer pass — not done here)

1. **D3** Content Admin — one Save button (tiny, safe).  
2. **D1** Pipeline Archive — drop one of three entry points.  
3. **D4/D5** Specialist — clear/close only on case detail.  
4. **D2** Remove dead Pipeline Apply path (`showLenderMatches` dead code).  
5. **Fake commission Close vN** — either wire a real rules API or remove the button.  
6. **N8** Relabel or relocate Sales Floor “Refresh from Drive” now that Company Brain is off the nav.

---

## Out of scope / left undone

- Did not run Playwright or live clicks (static code inventory only).  
- Did not inventory the 14 KILL screens.  
- Shared chat / search / logout counted once (not as cross-screen button bloat).  
- `present.html` and other non-nav helpers only appear as navigation targets, not as audited screens.

## Status

`done` — findings board only. Chris names what to fix before any Fixer work.
