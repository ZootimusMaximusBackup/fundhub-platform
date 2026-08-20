# Data redundancy audit — 2026-08-19

**Mode:** Auditor, read-only. Findings only. No app edits.  
**Evidence:** `public/app/` + `shell.js` + shared helpers (`data.js`, `contract-send.js`). No live click proof — runtime marked **UNVERIFIED** where code alone is not enough.  
**Owner ask:** Across the ~16 nav screens that touch core entities, inventory DISPLAY vs ACTION, then flag 3+ places / fake-filter twins / duplicate actions.

---

## Status

| Workflow | Status |
|---|---|
| A — Screens inventory | done |
| B — Identity / credit / payments | done |
| C — Contracts / documents / messages | done |
| D — Tasks + redundancy flags | done |

---

## Screens inventory (Workflow A)

Full staff sidebar is **32** rows (`shell.js` `SIDEBAR_HTML` / `ALL`). This audit scopes the **~16 that touch the seven core entities** below. Marketing / hiring / partner-only / brain / galaxy rows are out of scope unless they touch an entity (called out when they do).

| # | Nav label | File | Role gate (nav) | Primary APIs (read) |
|---|---|---|---|---|
| 1 | Pipeline | `pipeline.html` | staff | `/api/dashboard/pipeline`, `/api/dashboard/client` |
| 2 | Closer Dashboard | `closer-dashboard.html` | closer (+ owner/admin) | `/api/read/tradelines`, `/api/read/deal-math`, `/api/read/lender-matches`, `/api/read/closer-call` |
| 3 | Call cockpit | `closer-call.html` | closer (+ owner/admin) | `/api/read/closer-call`, `/api/read/closer-now`, `/api/read/underwrite` |
| 4 | My numbers | `my-numbers.html` | closer (+ owner/admin) | `/api/read/my-numbers` |
| 5 | Sales floor | `sales-floor.html` | sales_manager (+ owner/admin) | `/api/read/sales-floor` |
| 6 | Calendar | `calendar.html` | staff | `/api/tasks`, `/api/shifts?roster=1` |
| 7 | Lenders | `lenders.html` | funding_advisor (+ owner/admin) | `/api/read/lenders`, `/api/read/lender-observations` |
| 8 | Finance OS | `finance-os.html` | owner/admin | `/api/finance/bank-accounts`, `/api/finance/bills` |
| 9 | Client Control Panel | `client-control-panel.html` | staff | `/api/dashboard/client`, `/api/dashboard/clients`, `/api/consent/capture` |
| 10 | Consent | `consent-capture.html` | closer + funding_advisor (+ owner/admin) | `/api/consent/capture` |
| 11 | Messaging | `messaging.html` | staff | `/api/read/inbox`, `/api/read/messages`, `/api/read/conversations` |
| 12 | Documents | `documents.html` | staff | `/api/read/documents`, `/api/read/contracts` |
| 13 | Specialist | `inquiry-remover.html` | staff | `/api/read/inquiries`, `/api/read/inquiry-cases`, `/api/pii` |
| 14 | Contract templates | `contracts.html` | staff (writes owner/admin) | `/api/read/contracts?view=templates` |
| 15 | Products & Commissions | `products-commissions.html` | finance roles | `/api/read/products`, `/api/read/commissions` |
| 16 | Client Portal | `client-portal.html` | client (+ owner walk) | `/api/read/portal-summary`, `/api/read/portal-contracts`, `/api/read/entitlements` |

**Deep-links (not sidebar, still act on entities):**

| File | Why it matters |
|---|---|
| `present.html` | Send contract, soft-pull, pay link, deck scores |
| `soft-pull-approve.html` | Client identity + soft-pull consent intake |
| `payment-success.html` | Entitlements after checkout |
| `template-editor.html` | Message templates (Message Copy) |
| `ops-admin.html` | Outbox + open invoices (owner/admin) |

---

## Entity inventories

Format per row: **screen → shows → actions → API read** (writes noted when present).

### 1. Contracts

| Screen | Shows | Actions | API read |
|---|---|---|---|
| **Contract templates** | Wording library + PDF field placer | Create / save / archive templates; save field boxes | `GET /api/read/contracts?view=templates` (+ `file=template`) |
| **Documents** | Sent contract status on doc rows (`draft`/`sent`/`opened`/`signed`/`void`) | Open PDF · Remind · Void (owner/admin) | `GET /api/read/documents` + `GET /api/read/contracts?view=contracts&document_id=` |
| **Call cockpit** | “Send a contract” panel for current client | Send wording · Copy sign link | templates via `contract-send.js` → `view=templates&active_only=1` |
| **Present** (deep) | Same send UI | Send · Copy link | same as Call cockpit |
| **Client Portal** | “Your agreements” list + sign link | Open sign URL only | `GET /api/read/portal-contracts` |
| Shell search | Contract hits | Navigate | `GET /api/read/search` |

**Writes:** `POST /api/contracts` — templates on Contracts; `create_draft`+`send` on Call cockpit/Present; `remind`/`void` on Documents.

**Already decided (2026-08-17):** Contracts builds the form; Documents watches the paper. Send stays on Present / Call cockpit.

---

### 2. Documents

| Screen | Shows | Actions | API read |
|---|---|---|---|
| **Documents** | Company-wide file list (auth / contract / invoice / deliverable); KPIs awaiting / undelivered | Filter/sort; contract remind/void | `GET /api/read/documents?limit=200` |
| **Client Control Panel** | Upload dropzone (no list) | Upload for client | write: `POST /api/documents-upload` |
| **Specialist** | Link “All letters” → Documents; case docs | Upload fraud packet; open documents JSON in tab | `GET /api/read/documents?client_id=` (raw); write upload |
| **Client Portal** | Staff list when staff role; client upload | Upload | `GET /api/read/documents?client_id=` (staff); write upload |
| Company Brain | Knowledge files | Attach / review | **Different store** — `/api/company-brain/*` (out of CRM documents) |

---

### 3. Messages

| Screen | Shows | Actions | API read |
|---|---|---|---|
| **Messaging** | Inbox + thread + compose | Open thread · Send SMS/email | `GET /api/read/inbox`, `/messages`, `/conversations`; write `POST /api/messages` |
| **Message Copy** (`template-editor`) | Template library by channel | Save · Approve (owner/admin) | `GET /api/read/message-templates`; write `POST /api/message-templates` |
| **Ops & Admin** | Outbox KPIs + compliance-blocked rows | Dispatch / pause / email invoice backlog | `GET /api/read/messages?status=blocked`; write `POST /api/messages-outbound` |
| **Client Control Panel** | Message **count** only | Link → Messaging | via `GET /api/dashboard/client` |
| **Call cockpit** | Precall “N messages on file” | None | embedded in `GET /api/read/closer-call` |
| **Pipeline** | — | Deep-link “Text” → Messaging | none |
| Shell search | Conversation hits | Navigate | `GET /api/read/search` |
| Chat widget (shell) | In-app staff/portal chat | Ask / send | `/api/chat/*` — **separate** from Messaging inbox |

---

### 4. Tasks / bookings

| Screen | Shows | Actions | API read |
|---|---|---|---|
| **Calendar** | Day/week of dated **tasks** (`due_at`); Up Next; Join Call; coverage rail | Navigate · Join · open CCP — **no create/edit/complete** | `GET /api/tasks` (open+done); `GET /api/shifts?roster=1` |
| **Call cockpit** | Current call + Up next task | Join · log disposition | `/api/read/closer-now`, `/api/read/closer-call`; write `POST /api/call-outcomes` |
| **My numbers** | Unlogged / owed task list | Click → Call cockpit | `GET /api/read/my-numbers` |
| **Pipeline** drawer | `latest_booking` When/Status/What | Display only | `GET /api/dashboard/client` (booking derived from **tasks**, not `/api/bookings`) |
| **Client Control Panel** | Open blockers incl. `kind: task` | Display only | `GET /api/dashboard/client` |
| **Sales floor** | Unlogged-call count; follow-ups overdue = dash | None | `GET /api/read/sales-floor` |
| **Client Portal** | `latest_booking` when staff path | Book modal cannot book | dashboard client (staff) |

**Gap (inventory):** `GET /api/bookings` exists and is unused by `public/app`. `PATCH /api/tasks` (done/claim/reassign) has **no** staff UI caller.

---

### 5. Client identity

| Screen | Shows | Actions | API read |
|---|---|---|---|
| **Client Control Panel** | Name, email, phone, tier/path, notes (read-only); identity readiness flags — **no SSN entry** | Pick client; copy soft-pull approve link | `/api/dashboard/clients`, `/api/dashboard/client`, `/api/consent/capture` |
| **Pipeline** | Card name; drawer email/phone | Archive; move stage | `/api/dashboard/pipeline`, `/api/dashboard/client` |
| **Messaging** | Email/phone in side rail | Send | `/api/dashboard/client` + inbox APIs |
| **Call cockpit** | Name, business name, stage | Disposition | `/api/read/closer-call` |
| **Consent** | Granted name + consent history | Record / withdraw | `/api/consent/capture` |
| **Specialist** | Masked SSN; reveal with reason | Reveal · case actions | `/api/pii`, inquiry APIs |
| **soft-pull-approve** (deep) | Legal name, SSN, DOB, address form | Submit identity + consent | `/api/soft-pull-approve` |
| **Client Portal** | Session file; advisor name | Consent · upload | portal + consent APIs |
| Shell search | Client hits | Navigate | `/api/read/search` |

---

### 6. Credit data

| Screen | Shows | Actions | API read |
|---|---|---|---|
| **Pipeline** | EX/EQ/TU + income estimates + prequal | View only | `/api/dashboard/client` |
| **Client Control Panel** | Scores, last pull, inquiries; consent gate | **Pull TU/EX/EQ** · Issue IR case · Generate Apps | dashboard client; write `POST /api/finance/crs-pull` |
| **Present** (deep) | Soft-pull deck / score slides | `send_soft_pull`, letters, etc. | `/api/read/closer-deck`; write `/api/closer-deck` |
| **Call cockpit** | Scores + UnderwriteIQ bands | View | `/api/read/closer-call`, `/api/read/underwrite` |
| **Closer Dashboard** | Tradeline calculators + lender matches | Recalc local inputs | `/api/read/tradelines`, `/api/read/deal-math`, `/api/read/lender-matches` |
| **Consent** | Soft-pull / dispute auth state | Record / withdraw | `/api/consent/capture` |
| **Specialist** | Inquiry queue by bureau + repair | Attempt / confirm / send letters | inquiry + repair APIs |
| **Lenders** | Matrix + mismatch observations | Edit lenders / observations | `/api/read/lenders`, observations |
| **soft-pull-approve** | Client soft-pull consent | Submit | `/api/soft-pull-approve` |

No staff screen opens a raw bureau PDF (CCP Raw Report control is disabled).

---

### 7. Payments / entitlements

| Screen | Shows | Actions | API read |
|---|---|---|---|
| **Products & Commissions** | Product ladder + commission ledger | Create/edit product | `/api/read/products`, `/api/read/commissions`; write `/api/products` |
| **My numbers** | Closer paid commissions + offer stack | View | `/api/read/my-numbers` |
| **Finance OS** | Bank accounts + bills (panel still labeled Subscriptions) | View (client-scoped) | `/api/finance/bank-accounts`, `/api/finance/bills` |
| **Ops & Admin** | Open invoices AR | Email unsent invoices | `/api/read/invoices?status=open` |
| **Present** (deep) | Offer prices | `send_pay_link` / soft-pull | closer-deck APIs |
| **Call cockpit** | Latest payment amount + product | View | closer-call payload |
| **Client Portal** | Entitlement tiles; “What you own”; prices | **No charge** — checkout says unavailable | `/api/read/entitlements`, portal-summary |
| **payment-success** (deep) | Open entitlements only | None | `/api/read/entitlements` |
| **Client Control Panel** | Payment **count** | None | dashboard client |
| **Content** (admin) | Portal tiles ↔ entitlement codes | Edit tiles | `/api/content/tiles` |
| **Affiliate** | Referral commission due | Gift tools | `/api/read/affiliates` |

No staff screen posts a charge (`POST /api/payments` unused by `public/app`).

---

## Redundancy flags (Workflow D)

### (1) Entities shown in 3+ places

| Entity | Places (≥3) | Canonical **view** home | If others removed, they lose… |
|---|---|---|---|
| **Client identity** | Pipeline drawer · CCP · Messaging rail · Call cockpit · Consent · Portal · Specialist (SSN) · soft-pull-approve | **Client Control Panel** | Pipeline: card context without opening a file. Messaging: contact without leaving inbox. Call cockpit: name while dialing. Consent/soft-pull-approve: legal capture context. Specialist: SSN reveal workflow (unique — keep as action surface). |
| **Credit scores / soft-pull summary** | Pipeline · CCP · Present · Call cockpit · Closer Dashboard (tradelines) | **Client Control Panel** (full credit + pull) | Pipeline: board triage without open. Present: deck for live pitch. Call cockpit: scores mid-call. Closer Dashboard: tradeline math (unique — keep as calc surface). |
| **Contract instances** | Documents · Portal agreements · search · (status also on Present after send) | **Documents** | Portal: client self-serve sign list. Search: jump from chrome. Present/Call: send confirmation only (not a list). |
| **Documents / files** | Documents (org) · Portal (client filter, staff) · Specialist open-tab · CCP upload-only | **Documents** | Portal: client-scoped staff peek. Specialist: raw JSON dump shortcut. CCP: upload without leaving the file (upload is an *action* — see below). |
| **Messages** | Messaging · CCP count · Call cockpit count · Ops blocked · search | **Messaging** | CCP/Call: “activity exists” badge without opening inbox. Ops: compliance queue (different filter — see flag 2). |
| **Tasks / bookings** | Calendar · Call cockpit up-next · My numbers owed · Pipeline `latest_booking` · CCP blockers · Sales floor counts | **Calendar** | Call cockpit: live next call. My numbers: personal debt list. Pipeline: booking on card. CCP: task as blocker. Sales floor: manager count. |
| **Commissions / money owed to staff** | Products & Commissions ledger · My numbers · Affiliate | **Products & Commissions** (org ledger) | My numbers: closer’s personal rollup. Affiliate: partner view of dues. |
| **Entitlements / what client owns** | Client Portal · payment-success · Content tile map · Present offer stack (prices, not owned) | **Client Portal** | payment-success: post-pay confirmation. Content: which tiles unlock. Present: offer *prices* to sell (sales surface — keep separate). |

---

### (2) Same list, different filters, pretending to be different features

| Twin | Same underlying rows | How filters differ | Finding |
|---|---|---|---|
| **Documents** vs **Client Portal staff docs** vs **Specialist “open documents”** | `documents` via `/api/read/documents` | Org `limit=200` vs `client_id` vs raw browser GET | Three doors to one table. Portal + Specialist are filtered Documents, not new products. |
| **Calendar** vs **My numbers owed** vs **Call cockpit up-next** vs **Sales floor unlogged** | dated `tasks` (+ dispositions) | All open / personal owed / closer next / past-due unlogged | Four “schedule” products on one task queue. `/api/bookings` never shown. |
| **Messaging** vs **Ops blocked messages** | `messages` | Inbox vs `status=blocked` | Ops is a compliance filter on the same outbox — fair as a *mode*, weak as a separate nav story unless named “Blocked sends”. |
| **Documents contract column** vs old Contracts queue (removed 2026-08-17) | contracts | Already de-duped — **PASS vs prior defect**; keep Documents as watch home. |
| **Finance OS “Subscriptions” panel** vs deleted Subscriptions screen | bills / bank accounts | Client-scoped bills labeled as subscriptions | Name pretends to be the deleted feature; data is bills. |
| **My numbers offer stack** vs **Sales floor offers** vs **Products ladder** | products / offers | Personal vs floor vs catalog | Same offer universe, three presentations. |

---

### (3) Same action from multiple screens

| Action | Screens offering it | Canonical **action** point | If others removed, they lose… |
|---|---|---|---|
| **Send contract** | Call cockpit · Present | **Call cockpit** (or Present if pitch-first — pick one; today both call `contract-send.js`) | Present: send without leaving the deck. Call cockpit: send without opening Present. **Recommend one send surface;** the other keeps a deep-link only. |
| **Upload client file** | CCP · Client Portal · Specialist | **Client Control Panel** | Portal: client self-upload. Specialist: fraud packet subtype without leaving case. |
| **Record soft-pull consent** | Consent screen · soft-pull-approve (client) · Portal consent · CCP “copy approve link” | **Consent** (staff) + **soft-pull-approve** (client — keep; different actor) | CCP: quick link mint without opening Consent. Portal: client-side consent without staff. |
| **CRS bureau pull** | CCP only (among staff) | **Client Control Panel** | — (already single) |
| **Send SMS/email** | Messaging only (staff) | **Messaging** | Pipeline/CCP only deep-link — good. |
| **Remind / void contract** | Documents only | **Documents** | — (already single after 2026-08-17) |
| **Log call outcome** | Call cockpit only | **Call cockpit** | — |
| **Send pay link** | Present (`send_pay_link`) | **Present** | No second staff pay-link UI found. |
| **Create product** | Products & Commissions only | **Products & Commissions** | — |
| **Edit message templates** | Message Copy only | **Message Copy** | — |

---

## Canonical map (one view home + one action point)

| Entity | Canonical VIEW | Canonical ACTION | Keep as satellite (narrow reason) |
|---|---|---|---|
| Contract **templates** | Contract templates | Contract templates (build/save) | — |
| Contract **instances** | Documents | Call cockpit **or** Present (send) — pick one | Portal: client sign list |
| Documents / files | Documents | Client Control Panel (staff upload) | Portal: client upload; Specialist: fraud subtype |
| Messages | Messaging | Messaging (send) | Ops: blocked/dispatch; Message Copy: template authoring |
| Tasks / bookings | Calendar | Call cockpit (disposition / join) | My numbers: personal owed list only |
| Client identity | Client Control Panel | soft-pull-approve (client write) + Consent (staff record) | Specialist: SSN reveal only |
| Credit data | Client Control Panel | CCP (CRS pull) | Closer Dashboard: tradeline math; Specialist: inquiry work; Present: pitch deck |
| Payments / entitlements | Client Portal (owned) / Ops invoices (AR) | Present (`send_pay_link`) — no in-app charge | Products & Commissions: catalog + org ledger; My numbers: closer pay |

---

## What each non-canonical location loses if removed

Short loss notes for the loudest duplicates (decision aid — not a fix list):

1. **Pipeline credit + identity drawer** → lose one-click triage; staff must open CCP for every card.
2. **Call cockpit contract send** *or* **Present contract send** (whichever is demoted) → lose send without a screen hop mid-pitch.
3. **My numbers owed list** → lose personal “calls I owe a log” without Calendar filters.
4. **Sales floor unlogged count** → lose manager rollup without opening each closer’s Calendar.
5. **Portal staff documents list** → lose client-scoped file peek without Documents filters.
6. **CCP message count / Call cockpit message teaser** → lose “has activity” without opening Messaging.
7. **Finance OS “Subscriptions” label** → lose nothing if renamed to Bills; lose confusion if kept.

---

## Evidence pointers

- Nav + role gates: `public/app/shell.js` (`SIDEBAR_HTML`, `ROLE_TABS`, `OWNER_ADMIN_ONLY`, …)
- Shared reads: `public/app/data.js`
- Contract send: `public/app/contract-send.js`
- Prior de-dup decision: `docs/workflows/contracts-dedup-2026-08-17.md`
- Screen sources: `public/app/{pipeline,client-control-panel,documents,contracts,messaging,calendar,closer-call,present,inquiry-remover,finance-os,products-commissions,client-portal,…}.html` (+ matching `.js` where split)

---

## Left undone / UNVERIFIED

- No live Playwright or human click on this pass (code inventory only).
- Ops Admin KPI cash sources beyond invoices: **UNVERIFIED**.
- Whether soft-pull authorizations are *created* only via contract kind `authorization` vs other writers: **UNVERIFIED** from staff HTML alone.
- Exact closer-deck product → `contractTemplateKey` mapping: **UNVERIFIED** beyond UI helpers.

## Next

Chris names which flag(s) become Fixer work (one canonical home/action each). Auditor does not edit until then.
