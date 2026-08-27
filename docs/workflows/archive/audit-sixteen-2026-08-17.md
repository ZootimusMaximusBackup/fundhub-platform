# Audit of the 16 Fixer prompts — 2026-08-17

Read-only. Auditor only. No app/test/env/intended-journey edits.

Ground truth Chris named: the 16 prompts in transcript
`0134ba58-f363-446a-92d0-1240b7112487` (“Sixteen. Here they are.”)
plus `docs/journeys/*-intended.md`. Walk notes:
`/Users/zootimusmaximus/Downloads/crm-ux-walkthrough-2026-08-17.md`.

The intended journey files only say which roles can reach which routes.
They do **not** define these 16 screen fixes. So each row’s “working”
meaning is the prompt itself. Journey files are only the role-reach pointer.

Live walk: 2026-08-18 ~01:48 EDT. Signed in as owner (`chris@fundhub.ai`)
and the seeded role logins (`closer@`, `advisor@`, `sales@`, `affiliate@`).
Password from gitignored `.env` (`STAFF_E2E_PASSWORD`). Never printed.
Client portal as a client: **not signed in** — `/portal-login.html` is
magic-link only. No live magic-link email was sent.

Evidence folder: `docs/workflows/audit-sixteen-2026-08-17-evidence/`

---

## Discovery board

| # | Prompt | Ground truth | Live check |
|---|--------|--------------|------------|
| 1 | Pipeline speed | Prompt 1 + walkthrough Pipeline #1 + `role-owner-intended.md` / `role-closer-intended.md` (pipeline reachable) | Open `/app/pipeline.html` as owner. Time until cards paint. Screenshot. |
| 2 | Global polish | Prompt 2 + walkthrough Global #1–5 | Look at shared chrome at 1440. Font, seams, jump. Zoom-out not fully walked. |
| 3 | Beta banner | Prompt 3 + walkthrough Global #6 | Owner keeps yellow bar on beta screens. Closer / advisor / sales manager / affiliate do not. Beta screens off staff nav. |
| 4 | Delete Subscriptions | Prompt 4 + walkthrough Funding · Subscriptions | Nav has no Subscriptions. `/app/subscriptions.html` is gone. |
| 5 | Delete Demo Mode | Prompt 5 + walkthrough Admin · Demo Mode | Nav has no Demo Mode. `/app/demo-mode.html` is gone. |
| 6 | Delete Command Center | Prompt 6 + walkthrough Watch · Command Center | Nav has no Command Center. `/app/command-center.html` is gone. |
| 7 | Contracts rebuild + Documents de-dup | Prompt 7 + walkthrough Funding · Contracts + Client Ops · Documents + `role-owner-intended.md` (contracts + documents reachable) | Contracts is a template loader in Admin, not Funding. Documents is the sent-file list. |
| 8 | Lenders role restriction | Prompt 8 + walkthrough Funding · Lenders + `role-funding-advisor-intended.md` / `role-closer-intended.md` / `role-sales-manager-intended.md` | Owner + advisor can open Lenders and the read API. Closer + sales manager cannot. |
| 9 | Company Brain | Prompt 9 + walkthrough Client Ops · Company Brain | Full-width chat, history, ask box, file add. |
| 10 | Campaigns refresh | Prompt 10 + walkthrough Marketing · Campaigns | Product layout, no db-column essay, empty state honest. |
| 11 | Social Studio refresh | Prompt 11 + walkthrough Marketing · Social Studio | Same bar as 10. Strip column names / file paths / internal footer. |
| 12 | Creative Factory refresh | Prompt 12 + walkthrough Marketing · Creative Factory | Same bar as 10. No CROA table. No leftover ids / robot-token copy. |
| 13 | Closer Dashboard | Prompt 13 + walkthrough Sales · Closer Dashboard + `role-closer-intended.md` | As closer: calculators stay. Extra call clutter gone. |
| 14 | My Numbers + Sales Floor | Prompt 14 + walkthrough Sales · My Numbers + Sales Floor | Offer stack on both. Sales Floor lets you move between closers. |
| 15 | Hiring | Prompt 15 + walkthrough Admin · Hiring + `role-owner-intended.md` (hiring reachable) | Usable hiring screen. No developer essay in the body. |
| 16 | Client Portal | Prompt 16 + walkthrough Portals · Client Portal + `client-intended.md` | Welcome video at top. Dispute-sign card after. No staff-only help text. Signed in as client. |

---

## Score table (live)

| # | Prompt | Score | Evidence |
|---|--------|-------|----------|
| 1 | Pipeline speed | **PASS** | `01-pipeline-owner.png`. HTTP 200. Shell 383 ms. Cards painted in 783 ms. 16 cards on the board. |
| 2 | Global polish | **UNVERIFIED** | 1440 shots look like one product (`01-pipeline-owner.png`, `02-closer-dashboard-1440.png`). Zoomed-out seams and 1920/2560 were not walked. |
| 3 | Beta banner | **PASS** | Owner still has the yellow bar on Campaigns / Social / Creative / Hiring / Company Brain (`03-campaigns-owner.png`). Closer / advisor / sales manager / affiliate have no yellow bar. Closer visible nav has no Campaigns / Social / Creative / Hiring (`13-closer-dashboard-closer.png`). Affiliate rail is Affiliate only (`03-affiliate-landing.png`). |
| 4 | Delete Subscriptions | **PASS** | HTTP 404. Copy: “That page isn't here.” Path `/app/subscriptions.html`. Not in owner nav. `04-subscriptions-url.png`. |
| 5 | Delete Demo Mode | **PASS** | HTTP 404. Path `/app/demo-mode.html`. Not in owner nav. `05-demo-mode-url.png`. |
| 6 | Delete Command Center | **PASS** | HTTP 404. Path `/app/command-center.html`. Not in owner nav. `06-command-center-url.png`. |
| 7 | Contracts + Documents | **PASS** | Contracts title “Contract templates”, under Admin, Upload PDF + wording list, no waiting-count tiles. `07-contracts-owner.png`. Documents is the sent-file list with awaiting-signature counts. `07-documents-owner.png`. Funding group has no Contracts link. |
| 8 | Lenders role lock | **PASS** | Owner: page + `/api/read/lenders` 200. `08-lenders-owner.png`. Advisor: page + API 200. `08-lenders-advisor.png`. Closer: typed Lenders URL, shell sent them to Closer Dashboard; API 403. `08-lenders-closer.png`. Sales manager: same bounce to Sales Floor; API 403. `08-lenders-sales-manager.png`. |
| 9 | Company Brain | **PASS** | Full-width chat, “New chat”, history rail, ask box, “+” file add, Send. `09-company-brain-owner.png`. |
| 10 | Campaigns refresh | **PASS** | Partner picker, spend tiles, honest empty “Pick a partner”. No database-column essay. `10-campaigns-owner.png`. |
| 11 | Social Studio refresh | **FAIL** | Page reads as a product, but the live footer still says `social_post action log - api`. That is an internal name. `11-social-studio-owner.png`. |
| 12 | Creative Factory refresh | **FAIL** | No CROA table seen. Partner UUID still printed in the body. Copy still talks about the “writing robot's tokens”. `12-creative-factory-owner.png`. |
| 13 | Closer Dashboard | **PASS** | As closer: two calculators only. Call cockpit is its own nav item, not piled on this page. `13-closer-dashboard-closer.png`. |
| 14 | My Numbers + Sales Floor | **FAIL** | My Numbers shows a full offer stack (diagnostic, card stacking, consulting, credit repair, inquiry). `14-my-numbers-owner.png`. Sales Floor also lists offers. There is **no** closer list to scroll — only “0 CLOSERS ON SHIFT”. `14-sales-floor-owner.png`. |
| 15 | Hiring | **PASS** | Bench / short-by / roles table. No SQL or file-path essay. `15-hiring-owner.png`. LinkedIn is not on the page (not scored as a shipped claim). |
| 16 | Client Portal | **FAIL** | Staff-opened portal: hero says “Welcome video is not available”. Dispute-sign card is under the welcome block. Staff phrases “Open this from a client file” / “?id=” were not on screen. Client magic-link sign-in was not completed. `16-client-portal-owner-staff.png`. |

Counts: **11 PASS · 4 FAIL · 1 UNVERIFIED**

---

## Capped FAIL blocks

### 11 — Social Studio refresh

- **Step:** Open `/app/social-studio.html` as owner.
- **Expected:** No database names, file paths, or internal labels in the body.
- **Observed:** Green footer still reads `social_post action log - api`.
- **Evidence:** `docs/workflows/audit-sixteen-2026-08-17-evidence/11-social-studio-owner.png`

### 12 — Creative Factory refresh

- **Step:** Open `/app/creative-factory.html` as owner with a partner selected.
- **Expected:** Product layout. No leftover ids or internal “how this works” about tokens.
- **Observed:** A partner UUID is printed under the partner picker. Body still explains the writing robot’s monthly token cap.
- **Evidence:** `docs/workflows/audit-sixteen-2026-08-17-evidence/12-creative-factory-owner.png`

### 14 — My Numbers + Sales Floor

- **Step:** Open `/app/sales-floor.html` as owner.
- **Expected:** A way to scroll between closers and see each person’s numbers.
- **Observed:** Banner says “0 CLOSERS ON SHIFT”. No closer cards, no scroller. Offer stack on My Numbers did show.
- **Evidence:** `docs/workflows/audit-sixteen-2026-08-17-evidence/14-sales-floor-owner.png` and `14-my-numbers-owner.png`

### 16 — Client Portal

- **Step:** Open the client portal the way a person would.
- **Expected:** Welcome video at the top. “Sign to authorize dispute letters” after that. No staff-only help text. Capture while signed in as a client.
- **Observed:** Hero is a gray box: “Welcome video is not available”. Sign card is below (order is right). Client session not proven — portal login is email-link only; no link was sent.
- **Evidence:** `docs/workflows/audit-sixteen-2026-08-17-evidence/16-client-portal-owner-staff.png`

---

## Notes (not extra jobs)

- Intended journeys still say closer / advisor can reach Campaigns. Live staff nav hides those beta screens. That is a gap between `*-intended.md` and the prompt. Not scored as a 16-prompt fail.
- Hiring still mentions “Demo Mode rows” even though the Demo Mode **screen** is gone.
- My Numbers / Sales Floor still print `staff_targets` in empty-target copy. Not in the 16 as its own job.
- Pipeline screenshot includes live board names. Do not paste those names into chat or tickets.

## COMPLIANCE REVIEW REQUIRED

Prompt 16 is about the “Sign to authorize dispute letters” card on the client portal.
The fail is the missing welcome video and the unproven client session.
That card is dispute-letter consent. Any fix of 16 needs a human look before it ships.

---

## Next

Chris names which FAIL to fix first. Auditor stops here.
