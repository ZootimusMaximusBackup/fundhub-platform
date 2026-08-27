# Action redundancy audit — 2026-08-19

**Mode:** Auditor · read-only · findings only · no app edits  
**Chris definition (only this):** redundant = a person can **do the same human task** from more than one place. Not “same API.”  
**Feng-shui rule:** ONE job = ONE home. Building a thing, sending a thing, and watching its status are **three jobs** — correctly in three places.

**Evidence:** static walk of `public/app/` for the 18 survivors (+ Present only where Call cockpit opens it). No live click. Runtime success = **UNVERIFIED**.

---

## Scope

**Skip (14 decommissioned / nav-kill — do not inventory):**  
`finance-os.html`, `consent-capture.html`, `company-brain.html`, `galaxy.html`, `partner-galaxy.html`, `ops-admin.html`, `automations.html`, `journeys.html`, `brand-studio.html`, `campaign-manager.html`, `social-studio.html`, `creative-factory.html`, `hiring.html`, `affiliate.html`

**Walk (18 survivors):**

| # | Screen | Role |
|---|---|---|
| 1 | `pipeline.html` | Sales board |
| 2 | `closer-dashboard.html` | Closer home (read) |
| 3 | `closer-call.html` | Call cockpit |
| 4 | `my-numbers.html` | Closer numbers (read) |
| 5 | `sales-floor.html` | Floor / recordings |
| 6 | `calendar.html` | Calendar |
| 7 | `lenders.html` | Lender book |
| 8 | `client-control-panel.html` | Client file |
| 9 | `messaging.html` | Inbox |
| 10 | `documents.html` | Sent files + contract watch |
| 11 | `inquiry-remover.html` | Specialist |
| 12 | `agent-editor.html` | Agents |
| 13 | `template-editor.html` | Message wording |
| 14 | `content-admin.html` | Portal tiles / video |
| 15 | `staff-teams.html` | Staff / clock |
| 16 | `products-commissions.html` | Products |
| 17 | `contracts.html` | Contract templates (build) |
| 18 | `client-portal.html` | Client portal |

**Reachable off a survivor (not a nav row):** `present.html` — opened from Call cockpit `#fh-present`. Counted only when it offers the **same human task** as a survivor.

---

## Correct splits (NOT redundant)

These look like “the same endpoint family” but are **different jobs**. Leave alone under Chris’s rule.

| Job A (build / create) | Job B (send / act) | Job C (watch / status) |
|---|---|---|
| **Contracts** — build wording/PDF on `contracts.html` | **Send** contract from Call cockpit (and Present) | **Remind / Void / Open PDF** on Documents |
| **Message Copy** — save/approve templates on `template-editor.html` | **Send** SMS/email on Messaging | — |
| **CCP** — Issue Inquiry Removal (create case) | **Specialist** — work / send / clear / close case | — |
| **Products** — create/edit product | **Present** — send pay link for an offer | **Portal** — see what you own (entitlements) |
| **Content Admin** — map tiles to entitlement codes | — | **Portal** — client sees unlocked tiles |

---

## Master table — same human task, every place

| Task (what a person does) | Every place they can do it | ONE canonical home | What each extra adds | Verdict |
|---|---|---|---|---|
| **Archive a client** | Pipeline card **DEL** · drawer **Archive** · top bar **Archive** (all → same confirm, same `POST /api/dashboard/client-archive`) | **Pipeline drawer Archive** (full card open) | Card DEL: archive without opening drawer. Top bar: same as drawer once a card is selected — **nothing new**. | Card DEL → **JUSTIFIED-SHORTCUT** (board triage). Top bar → **REMOVE-CANDIDATE**. |
| **Send a contract** | Call cockpit **Send** (`#fh-contract-go`) · Present **Send this wording** (`data-act="contract-go"`) — same `create_draft` + `send` | **Call cockpit** | Present: send without leaving the pitch deck mid-call. | Present → **JUSTIFIED-SHORTCUT** (live pitch moment). |
| **Start a lender application (Apply)** | CCP Funding **Apply** · Lenders row **Apply** (needs `?client_id=`) · Pipeline match **Apply** | **Client Control Panel · Funding** | Lenders: Apply while browsing the book with a client already in the URL. Pipeline Apply: **unreachable** (`showLenderMatches` never called). | Lenders → **JUSTIFIED-SHORTCUT** (book + client deep-link). Pipeline Apply → **REMOVE-CANDIDATE** (dead). |
| **Upload a file for a client** | CCP staff dropzone · Specialist fraud/police upload · Portal client upload | **Staff general → CCP**. **Client → Portal**. | Specialist: same upload API but subtype `additional_fraud_docs` in the IR case workflow. Portal: **different actor** (client). | Specialist → **JUSTIFIED-SHORTCUT** (case packet moment). Portal client upload → **not staff redundancy** (different user). |
| **Mark IR case cleared** | Specialist Active Cases **Mark Cleared** · case detail **Mark cleared** | **Case detail** | List button: clear without opening the case. | List → **REMOVE-CANDIDATE** (no extra workflow moment; skips reading the case). |
| **Close IR case** | Specialist Active Cases **Close Case** · case detail **Close** | **Case detail** | Same as clear — skip the detail read. | List → **REMOVE-CANDIDATE**. |
| **Save portal content tiles** | Content Admin `#saveBtn` · `#saveTilesBtn` (same `POST /api/content/tiles` save) | **One Save** (top `#saveBtn`) | Second button: same save, different spot on the page. | Extra Save → **REMOVE-CANDIDATE**. |
| **Join a live call** | Call cockpit **Join call** · Calendar **Join Call** | **Call cockpit** | Calendar: join from the day’s schedule without opening the cockpit first. | Calendar → **JUSTIFIED-SHORTCUT** (schedule moment). |
| **Move a pipeline card** | Drag to column · **MOVE** menu | **Pipeline** (one screen; two controls) | Drag: fast board move. MOVE menu: pick a named destination when drag is awkward. | MOVE menu → **JUSTIFIED-SHORTCUT** (precision move). |

---

## Chris’s named tasks — one-line score

| Task | Multi-home? | Note |
|---|---|---|
| Send a contract | Yes | Cockpit + Present — Present justified |
| Archive a client | Yes (×3 on Pipeline) | Drop top bar |
| Upload a file | Yes for staff | CCP + Specialist (justified); Portal = client |
| Clear a case | Yes (×2 on Specialist) | Drop list clear |
| Start an application | Yes | CCP + Lenders; kill dead Pipeline Apply |
| Record consent | **No** on survivors | Only Portal dispute-auth sign among the 18. Soft-pull approve is client link from CCP (client does the task, not staff). Staff monitoring consent on Staff & Teams is a **different** job (employee monitoring). |
| Pull credit | **No** | CCP TU / EX / EQ only (three bureaus = one home, required picks) |

---

## Dead / fake controls (clickable or look clickable — do nothing or lie)

| Screen | Control | What it pretends | Reality |
|---|---|---|---|
| `pipeline.html` | Lender-match **Apply** | Start bank Apply | **Dead** — panel code never shown (`showLenderMatches` unused) |
| `client-control-panel.html` | **Open Bank Inbox** | Open banking inbox | **Dead** — `disabled`, “Not wired” |
| `client-control-panel.html` | **Raw Report** | Open bureau PDF | **Dead** — `disabled` by design |
| `client-control-panel.html` | **Notes** `#notes` | Edit client notes | **Fake** — read-only; UI says notes do not save |
| `calendar.html` | Day timeline `.evt` blocks | Open / act on appointment | **Dead** — painted, no click handler |
| `products-commissions.html` | **Close vN · open vN+1** | Save commission rule version | **Fake** — in-memory `RULES` only; never posts |
| `staff-teams.html` | **Save** after editing name / email / phone | Update staff profile | **Fake** — those fields are not written; only role / monitoring consent / invite paths write |
| `staff-teams.html` | Editor **active** / **clock** switches | Toggle active or clock | **Fake** — not posted on Save |
| `client-portal.html` | **Unlock — pay now** / checkout | Pay for a product | **Fake today** — checkout URL absent; buttons hidden / modal says unavailable |
| `client-portal.html` | Staff wireframe **Before call / In progress / Just funded** | Change real portal state | **Fake** — local paint only |
| `inquiry-remover.html` | Letter draft `.letter-edit` textarea | Edit letter before send | **Fake** — edits not included in send body |
| `sales-floor.html` | Static Flag / recordings markup in raw HTML | Flag / jump | Replaced when JS paints; bare HTML has no listeners if paint fails |

---

## Single-home tasks (no action redundancy)

Listed so the walk is complete. Not candidates.

| Task | Only home |
|---|---|
| Pull TU / EX / EQ credit | CCP |
| Copy soft-pull approve link | CCP |
| Generate Apps (refresh matches) | CCP |
| Issue Inquiry Removal (create) | CCP |
| Send SMS / email | Messaging |
| Remind / Void / Open contract PDF | Documents |
| Build / archive contract templates · upload PDF · save boxes | Contracts |
| Log call outcome (Deposit / … / next) | Call cockpit → `/api/call-outcomes` |
| Present: soft-pull email, ebook, pay link, generate letters, deck disposition | Present only (deck jobs; disposition ≠ call-outcome) |
| Log inquiry attempt / confirm / set status | Specialist |
| Reveal SSN | Specialist |
| Send IR case / generate repair letters / send repair letters | Specialist |
| Save / approve message wording | Message Copy |
| Create / save / promote / demote agent | Agent Editor |
| Invite staff / change role / suspend / reset password / clock / monitoring consent | Staff & Teams |
| Create / save product | Products & Commissions |
| Add / save / import lender · review mismatch · save bureau config | Lenders |
| Upload welcome video | Content Admin |
| Flag belief to marketing · Refresh from Drive | Sales Floor |
| Client: sign dispute auth · upload docs · open sign URL | Client Portal |
| Closer Dashboard / My numbers | No write tasks (read dashboards) |

---

## Highest-signal REMOVE-CANDIDATE list

Chris decides. Auditor does not fix.

1. Pipeline **top-bar Archive** (same as drawer once a card is open).  
2. Specialist list **Mark Cleared** / **Close Case** (keep on case detail only).  
3. Content Admin second **Save** button.  
4. Pipeline dead **Apply** path (unreachable code).  
5. Fake controls above that still look live (commission Close vN, staff profile Save, CCP Notes, portal checkout if shown, letter textarea).

## Highest-signal JUSTIFIED-SHORTCUT list (keep if the moment still matters)

1. Pipeline card **DEL** — archive from the board without opening the drawer.  
2. Present **Send contract** — pitch-deck moment.  
3. Lenders **Apply** with `?client_id=` — book-browsing moment.  
4. Specialist **fraud upload** — case-packet moment.  
5. Calendar **Join Call** — schedule moment.  
6. Pipeline **MOVE** menu — precision move vs drag.

---

## Left undone

- No Playwright / human click on this pass.  
- Did not re-open the 14 skipped screens.  
- Shared chrome (Sign out, search, chat) counted as shared once — not cross-screen task bloat.  
- Whether Present `log_disposition` and Call cockpit `call-outcomes` ever confuse closers in practice: different jobs in code; product confusion = separate UX question, not scored as same-task redundancy here.

## Status

`done` — findings board only. Chris names what becomes Fixer work.
