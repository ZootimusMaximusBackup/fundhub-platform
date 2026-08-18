# Whole-CRM audit — 2026-08-18

Ground truth for *who can open what*: `docs/journeys/*-intended.md`.
Ground truth for *does the control do what it claims*: Chris’s 2026-08-18 order (this board).
If a screen has no intended journey for the claimed action, that is **MISSING ground truth**. Do not invent one.

Live: `https://fundhub.ai`
Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/`

## Tasks

| id | owns | status |
| W1 | 8 live proofs | done |
| W2 | sales desk screens | done |
| W3 | money / ops / specialist | done |
| W4 | marketing + portals | done |
| W5 | automation + role matrix | done |
| W6 | fire withheld + delivery + portal + money + inbound | done |
| W-layout | page width / gutter / sidebar | done |
| W10 | signature trigger chain | done |
| W11 | Supabase as a database | done |
| W12 | security delta vs Fable Aug 16 | done |
| W13 | Agent Editor — 22 agents | done |
| W14 | Finance OS recovery | done |
| W15 | GHL side | done |
| W16 | payment → event → unlock (6 offers) | done |
| W13R | Agent Editor vs Bland (re-measure) | done |

# Findings — whole CRM 2026-08-18

Merge of W1–W5, plus a short W6 adds note, plus W-layout (page width). W1–W5 lists below were not rewritten.

**COMPLIANCE REVIEW REQUIRED** — dispute-letter sign, soft pull, inquiry Send.

- Dispute-letter sign: W4 showed the card. Nobody pressed Sign. W1 did not sign a dispute letter. **W6 opened the same card as the test client (unsigned). Did not press Sign.**
- Soft pull: W1. Did not come back.
- Inquiry Send: W1. Did not fire. W3 saw the Send button after opening a case. Did not press it. **W6 pressed it. The button turned into “VIEW IS NOT DEFINED.” No mail. No call to inquiry-removal-ai-sigma.vercel.app.**

No walk called a break lost-in-merge. Every break below is **built-wrong**.

### W6 adds (short)

- Email-link login is still broken (W1). A minted test-client session **does** open their own file. Welcome video still missing. Dispute card still unsigned.
- Issue Inquiry Removal only opens a Queued case. The phone runtime is not configured. The vercel schedule-call never left.
- No `.env` test inbox or test phone, so inbox/SMS landing is still unproven. Messaging Send on the test client failed (no phone; compose also said no email).
- Payment link create returns `commas_not_configured`. No Stripe keys. Oxylabs launch returns `oxylabs_credentials_missing`.
- GHL and Plaid have no inbound webhook provider. Bland and PostGrid receivers exist but have never stored a capture.
- Screen vs table: 17 pipeline cards match. Products tile still says 3 variable (table/DB have 4). Sales Floor still says 0 closers (1 active closer is named like a test and hidden). Ops People still says no staff (Staff & Teams: 23 hidden).

### Page width (W-layout)

Every CRM page does **not** use the same width. The house rule (`docs/UI-STANDARDS.md` §1) is **1800px wide, centered**. The token is `--fh-maxw`.

**Majority (31 nav screens, owner, live `https://fundhub.ai`):**
- Widest the page will go: **1800px** on **18 of 31**
- Side empty space: **24px** left and right on **14 of 31** (the biggest single gutter). About 20 pages use 24px on the thing you actually read.
- Left menu: **yes** on **29 of 31**. Only Client Portal skips it. Present (not in the nav table) also has no left menu.

**The four you named**

| Screen | Max width | Side pad | Left menu | Why it looks different |
| Staff & Teams | 1800px | 24px | yes | The top bar is **not** inside the 1800 box. It goes wall to wall. On a 1440 laptop the 1800 cap never kicks in, so the page looks full-bleed. `w-layout/staff-teams-1440.png` `w-layout/staff-teams-2560.png` |
| Pipeline | 1800px | 0px on the shell; filter bar 14px | yes | The top bar **is** inside the 1800 box. The board columns do not stretch, so you see gray on the right. Looks boxed. `w-layout/pipeline-1440.png` `w-layout/pipeline-2560.png` |
| Sales Floor | **1280px** (old number) | **22px** | yes | Narrower cap. On a wide screen it sits in the middle with big empty sides. `w-layout/sales-floor-1440.png` `w-layout/sales-floor-2560.png` |
| Client Control Panel | 1800px | 0px on the shell; inside columns **16px / 14px** | yes | Same 1800 box as Pipeline, but a tighter inner gutter. `w-layout/client-control-panel-1440.png` `w-layout/client-control-panel-2560.png` |

Full table and the rest of the screens: `## W-layout` at the bottom. Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w-layout/`.

## WORKS

### Sign-in

- Owner lands on Pipeline. W2 `w2/owner-login.png`. W4 `w4/00-owner-login.png`.
- Closer lands on Closer Dashboard. `w2/closer-login.png`.
- Sales lands on Sales Floor. `w2/sales-login.png`.
- Advisor lands on Client Control Panel. `w2/advisor-login.png`.
- Affiliate lands on Affiliate. Code `AFF-000001`. Link `https://fundhub.ai/start?ref=AFF-000001`. License-unsigned banner is on. `w4/affiliate-affiliate.png`.
- Client portal login is email-link only. No password box. Copy matches. W4 `w4/portal-login.png`. W5 `w5/role-client-portal-login.png`.
- W4 did not send a third sign-in link (two already in 15 minutes). Correct.

### Contract send + sign (W1)

- This morning’s SOFT-PULL-CONSENT was already sent. Did not send a second. Opened the sign link from the mail body. Typed the test name. Signed. Screen: “This document is signed.” Database status signed. `w1/01b-contract-after.png`.

### Who can open

W5 opened every CRM nav screen as owner, closer, sales, advisor, and affiliate. Shots: `w5/role-{role}-{screen}.png`. W2 and W3 proved the same opens on the screens they walked. Extra roles and screens sit under the table.

| Screen | owner | closer | sales | advisor | affiliate |
|---|---|---|---|---|---|
| Home | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Pipeline | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Closer Dashboard | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Call cockpit | OPEN | OPEN | BOUNCE | BOUNCE | BOUNCE |
| My numbers | OPEN | OPEN | BOUNCE | BOUNCE | BOUNCE |
| Sales floor | OPEN | BOUNCE | OPEN | BOUNCE | BOUNCE |
| Calendar | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Lenders | OPEN | BOUNCE | BOUNCE | OPEN | BOUNCE |
| Finance OS | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Client Control Panel | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Messaging | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Documents | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Specialist | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Company Brain | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Galaxy | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Ops & Admin | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Agent Editor | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Workflows | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Journeys | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Message Copy | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Campaigns | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Social Studio | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Creative Factory | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Staff & Teams | OPEN | BOUNCE | OPEN | BOUNCE | BOUNCE |
| Hiring | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Products & Commissions | OPEN | BOUNCE | OPEN | BOUNCE | BOUNCE |
| Contract templates | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Brand Studio | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Client Portal | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Affiliate | OPEN | BOUNCE | BOUNCE | BOUNCE | OPEN |

Hiring bounce matches intended (hiring blocked). W2 + W5. `w2/owner-hiring.png`, `w2/closer-hiring.png`, `w2/sales-hiring.png`, `w2/advisor-hiring.png`, `w5/role-closer-hiring.png`, `w5/role-sales-hiring.png`, `w5/role-advisor-hiring.png`. Affiliate bounced Hiring and Journeys. `w5/role-affiliate-journeys.png`.

Journeys bounce for closer and advisor matches intended (journeys blocked). `w5/role-closer-journeys.png`, `w5/role-advisor-journeys.png`.

Owner opened every CRM nav screen. `w5/role-owner-*.png`.

Affiliate typed Pipeline (and every other staff screen) and landed on Affiliate. `w5/role-affiliate-pipeline.png`.

Lenders: owner + advisor opened; closer + sales bounced. W2 + W5. `w5/role-advisor-lenders.png`, `w5/role-closer-lenders.png`.

Documents: owner, closer, sales, advisor stay. W2 `w2/owner-documents.png`, `w2/closer-documents.png`, `w2/sales-documents.png`, `w2/advisor-documents.png`.

Contracts: all four stay (title “Contract templates”). W2 `w2/owner-contracts.png`, `w2/closer-contracts.png`, `w2/sales-contracts.png`, `w2/advisor-contracts.png`.

Pipeline: all four open. W2 `w2/owner-pipeline.png`, `w2/closer-pipeline.png`, `w2/sales-pipeline.png`, `w2/advisor-pipeline.png`.

Closer Dashboard: all four open. W2 `w2/owner-closer-dashboard.png`, `w2/closer-closer-dashboard.png` (sales and advisor same-named shots).

Client Control Panel: all four open on the test client (W2).

**Present (W2 only — not in the W5 table):** owner, closer, and sales stay. Advisor is BROKEN.

**Inquiry specialist (W3 only):** stays on Calendar, Messaging, Specialist. Inquiry home is Specialist. Bounces off Finance OS, Ops & Admin, Products & Commissions, Staff & Teams. `w3/inquiry-finance.png`, `w3/inquiry-ops.png`, `w3/closer-finance.png`, `w3/advisor-finance.png`, `w3/sales-finance.png`, `w3/inquiry-specialist.png`. Calendar / Messaging / Specialist shots: `w3/*-calendar.png`, `w3/*-messaging.png`, `w3/*-specialist.png`.

Finance OS: owner stays. Closer / advisor / sales / inquiry bounce. W3 `w3/owner-finance.png`, `w3/closer-finance.png`, `w3/advisor-finance.png`, `w3/sales-finance.png`, `w3/inquiry-finance.png`.

Ops & Admin: owner only. Same bounce map. W3 `w3/owner-ops.png`, `w3/closer-ops.png`, `w3/advisor-ops.png`, `w3/sales-ops.png`, `w3/inquiry-ops.png`.

Products & Commissions: owner + sales. Others bounce. W3 `w3/owner-products.png`, `w3/sales-products.png`.

Staff & Teams: owner + sales. Others bounce. W3 `w3/owner-staff.png`, `w3/sales-staff.png`.

W4 marketing URLs: closer sent to Closer Dashboard. Sales sent to Sales Floor. Advisor sent to Client Control Panel. Affiliate sent to Affiliate. Campaigns and Creative stay blocked for affiliate (matches affiliate intended). `w4/*-closer.png`, `w4/*-sales.png`, `w4/*-advisor.png`, `w4/*-affiliate.png`.

### Pipeline (W2, owner)

- Search: typed `test`. `w2/owner-pipeline-search.png`. No database write.
- Filter: opened, changed Owner, Clear all. `w2/owner-pipeline-filter.png`. No database write.
- Open a card: drawer opened (Francis Rawlins). Close worked. `w2/owner-pipeline-card.png`. 17 cards on the live board. No archive.

### Call cockpit (W2, owner, test client)

- Join call: disabled. Title “No call link on this appointment.” Honest. `w2/owner-call.png`.
- Present button is on the screen.
- Disclosure boxes d1–d4 toggle.
- Outcome buttons 1–5 and belief buttons toggle. `w2/owner-call-after.png`.
- Save · next call: picked Downsell, saved. Database row `call_outcomes` `c54cc851-…` outcome downsell, test client, logged 2026-08-18. Then the page moved to the next booked call. `w2/owner-call-save-downsell.png`. No email / SMS.

### Present (W2, owner, test client)

- Next screen advanced one slide.
- Client screen only / Show cockpit toggled. `w2/owner-present-after.png`.
- Send-contract / soft-pull / pay / letters buttons were not clicked.

### My Numbers (W2)

- Owner and closer: offer stack on screen ($32 Diagnostic, Card Stacking DFY, Consulting, Credit Repair, Inquiry Removal). `w2/owner-my-numbers.png`, `w2/closer-my-numbers.png`. No clickable desk controls besides chrome. No database write.

### Hiring (W2, owner)

- Reset filters. `w2/owner-hiring-reset.png`.
- Role filter. `w2/owner-hiring-role.png`. Numbers painted (Short by 12, 3 open applications).
- Beta Dismiss.
- Flagged only. `w2/owner-hiring-flagged.png`.
- No hire / reject click.

### Lenders (W2, owner + advisor)

- Tabs: Lender list, Bureau mismatch queue, AI bureau config. `w2/owner-lenders-list.png`, `w2/owner-lenders-review.png`, `w2/owner-lenders-bureau.png` (advisor twins too).
- Apply filters (typed test).
- Export CSV clicked.
- Import CSV opened then cancelled. Import now not run.
- List is empty on purpose (“import from Airtable”). No lender row saved.

### Documents (W2)

- Pending only. All four roles.
- CONTRACTS tab. `w2/owner-documents-tab-contracts.png`.
- Open PDF: first contract badge went to OPENED. No new tab (page downloads a file in place). `w2/owner-documents-open-pdf.png`. Remind / Void not clicked.

### Contracts (W2)

- New wording opened, then Cancel. No save. All four roles. `w2/owner-contracts-new.png`.
- Upload a PDF control is on the screen (picker not finished).
- Clicked SOFT-PULL-CONSENT row: editor opened with the words. `w2/owner-contracts-row.png`. No save / archive.

### Client Control Panel (W2, test client)

- Pick a client: test client `8556bedc-…`. All four roles.
- Five group titles expand.
- Open Pipeline → Pipeline. `w2/owner-ccp-open-pipeline.png`.
- Open Messaging → Messaging with that client. `w2/owner-ccp-open-messaging.png`.
- Open Inquiry Remover → Specialist. `w2/owner-ccp-open-inquiry-remover.png`.

### Sales Floor extras (W2, owner)

- Page opens. Funnel and offer stack paint. `w2/owner-sales-floor.png`.
- Today's recordings: clicked; panel says “No Meet recordings in the last 7 days.” Honest empty. `w2/owner-sales-floor-recordings.png`.

### Finance OS (W3, owner)

- Opens. Honest empty: “The bank is not linked. Nothing here is a made-up balance.” Personal / Business / Investment / Subscriptions all say none. No connect-bank button that lies. `w3/owner-finance.png`.
- Same empty with test client `8556bedc-…`. Bank and bills reads succeeded. No made-up balances. `w3/owner-finance-test-client.png`.
- Beta Dismiss hides the yellow bar. `w3/owner-finance-dismiss.png`. No database write.

### Products & Commissions (W3, owner + sales)

- Page loads 5 products. Product and commission reads succeeded. `w3/owner-products.png`.
- Products / Commission rules tabs switch. Rules tab honest: “Commission rules are not held on this screen.” 0 active rules, so Change rate / See these payouts are not on the page. `w3/owner-products-rules.png`.
- View payout ledger → empty ledger (“No payouts on file.”). Back to rules works. Status filter changes. `w3/owner-products-ledger.png`.
- + Add product opens the New product drawer. Cancel closes it. No save. `w3/owner-products-add.png`.
- Click $32 Diagnostic opens Edit product. Cancel closes it. No save. `w3/owner-products-row-edit.png`.

### Ops & Admin (W3, owner)

- Period picker opens. Pick another range reloads the numbers. `w3/owner-ops-period-pick.png`.
- Money / People tabs switch. `w3/owner-ops-people.png`, `w3/owner-ops-money.png`.
- Affiliates + Hiring expands. Open Affiliates ↗ is a real link.
- Outbox reads the queue: “1 message waiting… Set up to send: email via resend, sms via twilio.” Buttons appear. `w3/owner-ops-outbox.png`.
- Pause sending: confirm “Nothing goes out… 1 message(s) will sit.” Dismissed. No write.
- Send what is waiting: confirm “They go out to real clients and cannot be pulled back.” Dismissed. No write. `w3/owner-ops-outbox-send.png`.
- Email unsent invoices stayed hidden (none waiting). Honest.

### Specialist (W3; deep click as inquiry)

- Inquiries / Repair toggle. Repair: “No repair files yet.” Need-me tiles on Repair paint 0. `w3/owner-spec-repair.png`.
- Sales cannot confirm stuck files. Matches intended: stuck-file confirm is Specialist + owner + admin only.
- Two Queued test-client cases show for inquiry (`e235efc2-…` and `1d212e99-…`). `w3/inquiry-specialist.png`.
- Click a Queued row opens upload, draft letter, Download packet, Send, Mark cleared, Close. `w3/inquiry-spec-case-open.png`.
- Download packet opened the client’s documents. `w3/inquiry-spec-packet.png`.
- All letters ↗ goes to Documents. `w3/inquiry-spec-all-letters.png`.
- Send / Upload / Mark cleared / Close were not clicked. Fire stays with W1.

### Calendar (W3, all five roles)

- Day / Week switch. `w3/owner-cal-week.png` (week of Aug 16–22).
- ‹ › and Today move the date. Week-strip day sets “Tuesday, August 18.” `w3/owner-cal-strip.png`.
- Empty day: “Nothing booked.” Honest. Join Call hidden (no appointment). Client file disabled, title “No client linked.” Honest. `w3/owner-calendar.png`.
- Who’s on today: “Nobody clocked in right now.”

### Messaging (W3, all five roles)

- Default tab is Needs reply. Empty copy: “Nothing is waiting on a reply.” `w3/owner-messaging.png`.
- All tab lists 8 threads. Search “test” leaves 2. `w3/owner-msg-all.png`, `w3/owner-msg-search.png`.
- Open Karl Elliott: thread loads, channel says Text, Send enables, texting-hours note shows. `w3/owner-msg-thread.png`. Typed only. Send not clicked.

### Staff & Teams (W3, owner + sales)

- Roster loads, then hides owner + seeded test logins. Footer: “no staff on the roster yet · 23 hidden.” Filter `chris` still empty (Chris is hidden). `w3/owner-staff-filter.png`, `w3/sales-staff.png`.
- Roster / Permissions / Clock & consent / Telemetry tabs switch. Permissions tab says there is no list and nothing here changes what a role may do. `w3/owner-staff-perms.png`.
- + Add person opens New person. Cancel closes it. No save. `w3/owner-staff-add.png`.
- Permissions → jumps to the Permissions tab.

### Campaigns (W4, owner)

- Opens. DEMO partner shows in the picker. Honest empty: no ads, no connection. After a wait, footer says “5 of 5 panels loaded.” `w4/campaigns-owner-demo.png`, `w4/campaigns-after-wait.png`.
- Filters do what they say (platform, offer, limit, window, action-log target, action-log rule).
- Reload reloads the page.
- Sync Meta now claims it will pull from Meta. Happened: “Nothing was pulled from Meta. no active Meta connection for this partner.” No outside pull. `w4/campaigns-sync-meta.png`.
- Clicking a campaign / attention tile opens the detail drawer. Drawer was empty because there is no campaign. `w4/campaigns-detail.png`.

### Social Studio (W4, owner)

- Opens on DEMO. Says 0 of 8 connected accounts. Queue is empty. That is the finding Chris named: no connected account. `w4/social-owner-demo.png`.
- Write a post opens compose.
- The five count tiles and the Waiting / Needs a rewrite / Could not be sent / Sent / Send history tabs switch the list.
- Queue post claims it will save a draft. Happened: “Pick an account to post to first.” No social post row. Honest refuse.
- Clear the form clears the caption.
- Send anything due now asks first. Confirm was dismissed. Nothing published.
- After Turn on for this partner, Social Write 3 posts for me and Creative Enqueue go from dead to live. Matches white-label intended (owner flip). `w4/social-after-enable.png`, `w4/creative-after-enable.png`.

### Brand Studio (W4, owner)

- Create pages from selected funnels claims it writes drafts. Happened: “Page drafts created.” Database row written, slug `apply`, status draft. `w4/brand-create-pages.png`.
- Save & apply claims it saves. Happened: “Legal entity is required — it goes into every disclosure.” Did not wipe the existing DEMO brand row. Honest refuse.
- Submit for approval says, on screen, review is not set up and the brand stays a draft. Did not send mail. `w4/brand-submit.png`.

### Galaxy (W4, owner)

- Opens as LIVE. It draws workers from the activity feed. Footer says read-only. Clicking the sky zooms into a cluster. `w4/galaxy-owner.png`, `w4/galaxy-cluster.png`.

### Company Brain page chrome (W4)

- Page opens. New chat, Documents, Refresh, Close work. Docs list says an owner must approve a file first. `w4/brain-owner.png`, `w4/brain-docs.png`.
- Ask and upload do not work. See BROKEN (W1 + W4).

### Affiliate page (W4)

- Owner can open the Affiliate page. Copy link / Copy code / tabs / status filter / business filter all respond. Ask and Download refuse for owner. That refuse is correct for a staff session.
- Affiliate Download Message Blaster claims a Mac download. Happened: “Download started — open the file on your Mac.” Download succeeded. `w4/affiliate-affiliate-blaster.png`.

### Client Portal (W4, staff)

- Staff Client Portal with the test client id shows the welcome block and the dispute-sign card, in that order. `w4/portal-staff-testid.png`. Sign was not pressed.

### Message Copy (W5)

- Owner / closer / sales / advisor opened it. Affiliate bounced to Affiliate.
- List loaded: 200 messages, 18 texts, 182 emails, 190 off, 2 drafts. `w5/owner-copy-01-loaded.png`.
- “How this works” opened. Live copy: edit switches the message off; owner/admin must approve; short names cannot change; “nothing on this screen transmits.” `w5/owner-copy-02-explain.png`, `w5/owner-copy-03-editor.png`.
- Click a list row opened the editor (`EMAIL-S02-FINISH-APPLICATION`, switched off, never approved).
- “First name” tag inserted locally. “Undo my changes” put the wording back. No database write.
- Next page worked. Previous was disabled on page 1.
- Approve card: visible for owner, hidden for closer. Approve button stayed disabled until the “I have read” box (not ticked).
- Draft banner: dispatcher refuses `[DRAFT]` even if approved.

### Workflows (W5)

- Owner / closer / sales / advisor opened it. Affiliate bounced.
- Tiles: 51 workflows, Engine ON, Ever triggered 42 of 51. Banner: engine is on; this screen does not say a workflow ran. `w5/owner-wf-01-loaded.png`.
- Click a row opened registry details (`af-02-referral-ownership-capture`, engine active, last trigger today). `w5/owner-wf-02-expand.png`.
- Rail filter “AF” hid the other groups. `w5/owner-wf-03-rail.png`.
- No send button. Nothing queued. Nothing sent. Read only.

### Journeys controls that did what they said (W5, owner)

- Owner opened Journeys. Closer / sales / advisor / affiliate bounced to home.
- Step / Simulate / History tabs switched the panel. `w5/owner-jny-02-tabs.png`.
- “Run the journey” (Simulate) ran in the browser. No database row. No mail. `w5/owner-jny-03-sim.png`.
- “Apply to code” with nothing dirty: toast “Nothing to apply. Change a step first.” `w5/owner-jny-04-apply.png`.
- “Save version” opened a name prompt (dismissed). Versions are in the browser only.
- Undo was disabled when there was nothing to undo.
- “Test against the code” ran, then undid the run. Panel: “Nothing was saved — the run was undone.” `w5/owner-jny-05-runcode.png`. The send claim on that run is BROKEN.
- Click a step selected it. “+” opened the add-step menu (no type inserted).

### Agent Editor controls that did what they said (W5, owner)

- Owner opened Agent Editor. Other roles bounced.
- List loaded 22 agents. Click a row loaded that agent. `w5/owner-agt-01-loaded.png`.
- Identity / triggers / prompt / escalation / shadow log cards opened.
- A guardrail switch flipped locally. Revert put it back. No database write.
- “Return to shadow” asked to confirm (“It stops acting on real clients…”). Dismissed. Row stayed live.
- “+ New agent” asked for a name. Dismissed. No row created.
- Promote gate on Setter Josh: blocked (no trigger, empty prompt, empty guardrail). Did not promote.

## BROKEN

No item below is lost-in-merge. Each walk already said **built-wrong**.

1. **Client sign-in does not open their file** — built-wrong. W1.
   - Expected: email-link only; after the link they see their own file.
   - Observed: no password field (good). Form asks for a link. After a working link this morning they landed signed in as the test client and the page said “We could not load your file.” Sign card still said “Sign in.” Portal login never stores the signed-in account; the staff login page does. Extra link asks later hit the 15-minute cap.
   - Evidence: `docs/workflows/audit-sixteen-prove4-2026-08-18-evidence/05b-portal-signed-in.png`, `w1/02-portal-form.png`, `w1/02-portal-no-link.png`.

2. **Company Brain upload and Ask fail** — built-wrong. W1 (Ask) and W4 (upload + Ask). Listed once.
   - Expected: + adds a file. Send answers against a document on that page. Docs list shows the file.
   - Observed: upload failed on the server. Ask failed on the server. Docs list still “No files added yet.” No brain file row. Chat code is on the live site and still fails. Page chrome still works (see WORKS).
   - Evidence: `w1/03-brain-ask.png`, `w4/brain-upload.png`, `w4/brain-ask.png`.

3. **Soft pull does not come back** — built-wrong. W1. `COMPLIANCE REVIEW REQUIRED`
   - Expected: TransUnion on the test client runs and returns.
   - Observed: button refused: “no soft-pull consent on file.” Consent screen was opened and Record was clicked; pull still refused. No soft-pull row. Never the gmail file.
   - Evidence: `w1/04-soft-pull-after.png`, `w1/04b-soft-pull-after-consent.png`.

4. **Inquiry Send does not fire** — built-wrong. W1. W3 only proves the button is there after a click. `COMPLIANCE REVIEW REQUIRED`
   - Expected: Send on a case actually fires (specialist desk item 4).
   - Observed: “Open a case” created two Queued rows. Send exists in the page but is not shown until the row is opened. Send was not shown on the W1 desk shot. Call-fired time stayed empty.
   - Evidence: `w1/05-inquiry-desk.png`. W3 button-visible: `w3/inquiry-spec-case-open.png`. Cases `e235efc2-…`, `1d212e99-…`.

5. **Closer math stays blank on a live file** — built-wrong (after the speed pass). W1 and W2. Listed once.
   - Expected: open the closer dashboard with a client and a typed draw / deposit. See funded, net, monthly. Copy says “Net cash uses the numbers you type.”
   - Observed: file id stayed in the URL. Boxes stayed “—”. W2 typed draw `5000` and deposit `3000` on the test client; same dashes on the live gmail file (read-only). The page boots before its number file is ready, then quits. The wiring is still in the file. Sample recompute also returns when there are no cards.
   - Evidence: `w1/06-closer-math.png`, `w2/owner-closer-dashboard-math.png`, `w2/owner-closer-dashboard-math-file.png`.

6. **Cannot prove an email landed** — built-wrong. W1.
   - Expected: a message arrives in an inbox. Queue-only is broken.
   - Observed: this morning’s contract mail row says sent and has a provider id. That is transmit, not inbox. Provider read refused the key. No inbox proof.
   - Evidence: `w1/proofs.json` p7.

7. **Cannot prove an SMS landed** — built-wrong. W1.
   - Expected: a text arrives on a phone.
   - Observed: test client has no phone. Did not text the opt-out e2e file. Messaging opened. Older rows exist as sent. No new send, no phone proof.
   - Evidence: `w1/08-messaging.png`.

8. **Sales Floor has no closer scroller** — built-wrong. W2.
   - Expected: move between closers (arrows / picker).
   - Observed: “0 CLOSERS ON SHIFT”. No arrows. Same fail as the 2026-08-17 sixteen audit. Database has 1 active closer and 5 closer rows; the active one is named like a test closer and the page hides names that start with “test.” The control never appears.
   - Evidence: `w2/owner-sales-floor.png`, `w2/sales-sales-floor.png`.

9. **Advisor Present dumps them on Sign in** — built-wrong. W2.
   - Expected: open Present for a contact.
   - Observed: advisor was already signed in. Present sent them to Sign in. The page treats a closer-deck “not allowed” read as “log out.” Closer and sales keep the deck. Intended files do not name Present, so who should open it is MISSING. The login dump is still wrong for a signed-in advisor.
   - Evidence: `w2/advisor-present.png`.

10. **Client Control Panel “Open Bank Inbox / GHL Contact / Raw Report”** — built-wrong. W2.
    - Expected: those buttons open those places.
    - Observed: three disabled buttons. Titles: “Not wired on this screen” / “GHL cut over — use Messaging” / “Raw bureau PDF not linked here yet.” Click does nothing. Code is on the page and still does nothing.
    - Evidence: `w2/owner-ccp-expanded.png`.

11. **Specialist work queue never leaves “Loading inquiry queue…”** — built-wrong after the speed pass. W3.
    - Expected: the work queue lists inquiries; Need me / bureau chips / Log an attempt / Mark confirmed run on those rows (specialist desk items 3–4).
    - Observed: status row stays “Loading inquiry queue…” after 4s. Need me / Worked / Calls / Confirmed stay “—”. Bureau chips stay 0. The inquiry list never loads. Only cases load. Same class of miss W1 logged on closer math. Ops & Admin was later patched to wait; this screen was not.
    - Evidence: `w3/inquiry-spec-queue-wait.png`, `w3/owner-spec-inq.png`. `w3/followup.json`.

12. **Ops & Admin People tables stay empty while staff exist** — built-wrong. W3.
    - Expected: People tab shows staff, comp, and consent.
    - Observed: “No staff rows.” The staff read succeeded. Staff & Teams on the same login says 23 people are hidden. This tab does not say that. Comp stays “—”.
    - Evidence: `w3/owner-ops-people.png`.

13. **Products tile says “3 with variable pricing” while the table shows 4 VARIABLE** — built-wrong. W3.
    - Expected: the tile counts variable-price products.
    - Observed: copy is hardcoded (“3 with variable pricing”). Live table: Diagnostic FIXED; four others VARIABLE.
    - Evidence: `w3/owner-products.png`.

14. **Calendar “Move one booking” / “Reschedule the other” do nothing** — built-wrong. W3.
    - Expected: those labels sit on the double-booking sample and look like actions.
    - Observed: they are plain text in the Demonstration states block. Click: no save, no dialog, no date change.
    - Evidence: `w3/owner-cal-demo-act-0.png`, `w3/owner-cal-demo-act-1.png`.

15. **Creative Enqueue does not create a job** — built-wrong. W4.
    - Expected: Enqueue puts a job on the queue.
    - Observed: After the suite was on, the button was live. Click failed on requested-by (staff id is not an account id). No generation job row. Run then said “Ran 0 jobs.”
    - Evidence: `w4/creative-enqueue-after.png`.

16. **Affiliate Ask does not answer** — built-wrong. W4.
    - Expected: Ask uses owner-approved affiliate docs.
    - Observed: “Could not answer — embed_http_401 … token is not from a valid issuer.” No answer. Outside call failed.
    - Evidence: `w4/affiliate-affiliate-brain.png`.

17. **Connect Facebook / Instagram / LinkedIn do not connect** — built-wrong. W4.
    - Expected: start a real sign-in for DEMO.
    - Observed: start was not configured. Stayed on Social Studio. Zero connected accounts. Chris said: if there is no connected account, that is the finding.
    - Evidence: `w4/social-oauth-fb.png`, `w4/social-owner-demo.png`.

18. **Write 3 posts for me did not land a draft** — built-wrong. W4.
    - Expected: three drafts in the waiting list.
    - Observed: button went live after the suite flip. Click stayed on “Writing…”. No marketing queue row. No social post row.
    - Evidence: `w4/social-generate-after.png`, `w4/db.json`.

19. **Affiliate numbers are not connected** — built-wrong. W4.
    - Expected: referred / clicks / converted / paid count real referrals.
    - Observed: page says those numbers “come from your referral tracking, not connected to this page yet.” Clicks 30d is “—”. Funnel says it cannot count clicks.
    - Evidence: `w4/affiliate-affiliate.png`.

20. **Client Portal welcome video is missing** — built-wrong. W4.
    - Expected: a welcome video at the top.
    - Observed: gray box “Welcome video is not available.” Sign card is under it (order is right). Same fail as the 2026-08-17 sixteen audit.
    - Evidence: `w4/portal-staff-testid.png`.

21. **Agent Editor says two agents are live on real people — they have no prompt and no trigger** — built-wrong. W5.
    - Expected: “LIVE / acting on real clients” means the agent can actually act.
    - Observed: LIVE = 2. Mode: “Acting on real clients on Voice. 0 runs.” Setter Josh and Inquiry Removal AI are marked live, prompt empty, 0 triggers. Banner: “2 running with no stored prompt/guardrails.” Screen also says promotion is blocked for those same missing pieces — but they are already marked live. Seeded live on purpose with an empty prompt. Not a later merge loss. The live badge still claims action that this row cannot do.
    - Evidence: `w5/owner-agt-01-loaded.png`. Database: agents `AG-04`, `AG-09`.

22. **Journeys “Test against the code” — journey says send a text, no message row** — built-wrong. W5.
    - Expected: a step that claims to send a text writes a message row (test then rolls it back). Claim-to-send that only queues / writes nothing is broken.
    - Observed: “1 MESSAGES THAT WOULD SEND” and also “the journey sends a sms here and no message row was written” (`demo-platform-nurture · sms`). 0/51 automations reached. Two waits have unit `undefined`. Run was rolled back (good). The send claim failed. Runner is on the live site and reported the miss. Not a deleted send path from a merge.
    - Evidence: `w5/owner-jny-05-runcode.png`.

## MISSING

### Missing ground truth (do not invent a spec)

- No intended journey names these **screens**: Pipeline, Closer Dashboard, Call cockpit, Present, My Numbers, Sales Floor, Lenders, Client Control Panel, Finance OS, Products & Commissions, Ops & Admin, Calendar, Messaging, Staff & Teams, Social Studio, Brand Studio, Galaxy, Company Brain page, Affiliate Portal, Client Portal, Message Copy, Workflows, Agent Editor. W5: no intended file names the 31 CRM HTML screens. Who-can-open above is live only.
- W1 action steps also have no intended journey: contract send + sign, magic-link → own file, Company Brain ask, soft pull, closer calculator, mail transmits, SMS transmits.
- Intended closer / advisor / sales files still list Campaigns, Creative Factory, and some Finance API groups as reachable. Live HTML for Campaigns / Social / Creative / Finance OS / Company Brain / Galaxy / Ops / Agent Editor is owner-only (2026-08-17 nav lock). That gap is missing ground truth, not a new product call.
- Sales manager intended can reach 1 journeys route. Live: typing Journeys bounces to Sales Floor, so they cannot press “Test against the code.” `w5/role-sales-journeys.png`.
- Affiliate intended lists contracts and Documents API groups. Live HTML for those pages bounces the affiliate to Affiliate.
- White-label intended covers Brand / Social / Creative for a **partner**. W4 did not walk `partner@`.

### Missing product (already on the walks)

- Client Control Panel Notes: the notes box is read-only. Screen also says notes do not save from this screen. `w2/owner-ccp-notes.png`.
- Brand review is not built. Submit for approval says so on the screen. Nothing is sent.
- Five social networks are labeled “not ready to connect.” TikTok, X, YouTube Shorts, Threads, Pinterest. Picture attach is also “not ready.”
- Social “must approve before it goes out” cannot be read. Screen: “SETTING NOT READ.” It also says posts are lined up and sent anyway because there is nowhere to record an approval.
- Finance OS has no “connect the bank” control. Empty is honest. There is no intended journey for company-money connect.
- Clock in/out is not reachable for the signed-in owner because that person is in the 23 hidden rows.

### Seen, not fired this pass

- Pull TransUnion / Experian / Equifax, Generate Apps, Issue Inquiry Removal: buttons are live on the test client. Not clicked (W1 owns live pull / inquiry; no pull on the gmail file).
- Send contract on Call / Present: button is there. Not clicked (W1 already sent and signed SOFT-PULL-CONSENT this morning).
- Documents Remind / Void: not clicked.
- Lenders Import now / Save / Add blank row: not run.
- Hiring hire / reject: not clicked.
- Pipeline Archive / MOVE / DEL / Text: not clicked.
- Specialist Send is on the expanded test case. Not fired (W1 owns FIRE). W1 already marked Send BROKEN.
- Messaging Send, Ops outbound dispatch / pause, product Save, staff Save / Reset password / Revoke login / Clock / consent: seen, not written.
- Save wording, Approve this wording, Save agent, Make the change (Claude), Apply to code with a real edit: buttons seen, not fired.
- Client magic-link own file is W1. W4 and W5 did not open a third link. W1 already marked that proof BROKEN.
- Roles W5 did not walk: admin, setter, partner. W3 did walk inquiry specialist. W5 did not.

## W1 — 8 live proofs

Owner: this session.
Test client only for send/pull/sign: `8556bedc-46e1-4d85-b0cd-a24adfee1521` (`client@fundhub.ai`).
Closer math file is read-only. Do not name that person.

| # | Proof | Ground truth | Status |
| 1 | Contract sends and can be signed (SOFT-PULL-CONSENT) | Owner order. Journeys say owner can reach contracts. No intended step for “send + sign.” **MISSING** journey step. | WORKS |
| 2 | Client email-link sign-in; they see their own file | `docs/journeys/client-intended.md` (client can reach portal routes). No intended step for magic-link → own file. **MISSING** journey step. | BROKEN |
| 3 | Company Brain answers against a document on that page | Owner can reach “Everything else.” No intended Company Brain ask path. **MISSING** journey step. | BROKEN |
| 4 | Soft pull runs and comes back (test client only) | Owner order. `COMPLIANCE REVIEW REQUIRED`. No intended soft-pull step. **MISSING** journey step. | BROKEN |
| 5 | Inquiry removal request fires (test / specialist path) | `docs/journeys/role-inquiry-remover-intended.md` § Specialist desk item 4: Send on a case requires a click. `COMPLIANCE REVIEW REQUIRED`. | BROKEN |
| 6 | Closer calculators show real numbers on the live file | Owner order. Closer intended lists dashboard routes, not the calculator. **MISSING** journey step. | BROKEN |
| 7 | An email actually lands in an inbox | Owner order. No intended “mail transmits” journey. **MISSING** journey step. | BROKEN |
| 8 | An SMS actually lands on a phone | Owner order. No intended “SMS transmits” journey. **MISSING** journey step. | BROKEN |

Reuse: do not send a second SOFT-PULL-CONSENT if one already went this morning.

## Findings

Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w1/` plus reused portal shots under `docs/workflows/audit-sixteen-prove4-2026-08-18-evidence/`.

**COMPLIANCE REVIEW REQUIRED** on proofs 4 (soft pull) and 5 (inquiry removal). No dispute letter was signed in this pass.

### Passes

1. **WORKS — Contract send + sign.** This morning’s SOFT-PULL-CONSENT (`16b29639-…`) was already sent. Did not send a second. Opened the sign link from the mail body, typed the test name, signed. Screen: “This document is signed.” DB `contracts.status=signed`. Shot: `w1/01b-contract-after.png`.

### Failures

2. **BROKEN — Client sign-in does not open their file.** (built-wrong)
   - Expected: email-link only; after the link they see their own file.
   - Observed: no password field (good). Form asks for a link. After a working link this morning they landed signed in as the test client and the page said “We could not load your file.” Sign card still said “Sign in.” `portal-login.html` never stores `fh_account`; `login.html` does. Extra link asks later hit the 15-minute cap.
   - Evidence: `audit-sixteen-prove4-2026-08-18-evidence/05b-portal-signed-in.png`, `w1/02-portal-form.png`, `w1/02-portal-no-link.png`.

3. **BROKEN — Company Brain Ask.** (built-wrong)
   - Expected: an answer that uses a document on that page.
   - Observed: live Ask `POST /api/read/company-brain` failed on the server (502). No documents listed. Code is on main (`13d1b8d`, `a41f2fe`) and still fails live.
   - Evidence: `w1/03-brain-ask.png`.

4. **BROKEN — Soft pull does not come back.** (built-wrong) `COMPLIANCE REVIEW REQUIRED`
   - Expected: TransUnion on the test client runs and returns.
   - Observed: button refused: “no soft-pull consent on file.” Consent screen was opened and Record was clicked; pull still refused. No `soft_pull_requests` row. Never the gmail file.
   - Evidence: `w1/04-soft-pull-after.png`, `w1/04b-soft-pull-after-consent.png`.

5. **BROKEN — Inquiry Send does not fire.** (built-wrong) `COMPLIANCE REVIEW REQUIRED`
   - Expected: Send on a case actually fires (`role-inquiry-remover-intended.md` item 4).
   - Observed: “Open a case” created two `Queued` rows. Send exists in the page but is not shown. `call_fired_at` stayed empty.
   - Evidence: `w1/05-inquiry-desk.png`. DB cases `e235efc2-…`, `1d212e99-…`.

6. **BROKEN — Closer math stays blank on a live file.** (built-wrong, after the speed pass)
   - Expected: `closer-dashboard.html?client_id=` plus a $5000 draw shows real credit / net / monthly.
   - Observed: file id stayed in the URL. Boxes stayed “—”. `data.js` is `defer`; the page boots before it and quits. Tradelines API answers if asked later. Introduced with `f23ced1` (“defer shell scripts”). The wiring is still in the file.
   - Evidence: `w1/06-closer-math.png`.

7. **BROKEN — Cannot prove an email landed.** (built-wrong / unproven inbox)
   - Expected: a message arrives in an inbox. Queue-only is broken.
   - Observed: this morning’s contract mail row is `status=sent`, provider `resend`, has a provider id. That is transmit, not inbox. Provider read API refused the key (`restricted_api_key`). No inbox proof.
   - Evidence: `w1/proofs.json` p7.

8. **BROKEN — Cannot prove an SMS landed.** (built-wrong for this prove)
   - Expected: a text arrives on a phone.
   - Observed: test client has no phone. Did not text the opt-out e2e file. Messaging opened. Older rows exist as `sent` / Twilio. No new send, no phone proof.
   - Evidence: `w1/08-messaging.png`.

### W1 stop

No app, test, config, env, or intended-journey edits. No deploy. No second contract. No public social post. No gmail credit file was pulled, mailed, or signed.

## W2 findings

Walked 2026-08-18 on `https://fundhub.ai` as `chris@fundhub.ai`, `closer@fundhub.ai`, `sales@fundhub.ai`, `advisor@fundhub.ai`.
Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w2/`.
W1 already sent SOFT-PULL-CONSENT `16b29639-…` (status signed). W2 did not send a second. No pull / mail / contract on the gmail credit file.

Ground truth for *who can open what* is only in `docs/journeys/*-intended.md`. Those files name **Hiring**, **Documents**, and **Contracts**. They do **not** name Pipeline, Closer Dashboard, Call cockpit, Present, My Numbers, Sales Floor, Lenders, or Client Control Panel.

### WORKS

**Sign-in**
- Owner `chris@fundhub.ai` lands on Pipeline. Shot: `owner-login.png`.
- Closer lands on Closer Dashboard. Shot: `closer-login.png`.
- Sales lands on Sales Floor. Shot: `sales-login.png`.
- Advisor lands on Client Control Panel. Shot: `advisor-login.png`.

**Who can open (intended files)**
- Hiring: owner opens (`owner-hiring.png`). Closer / sales / advisor bounce off. Matches intended (hiring blocked for those roles). Shots: `closer-hiring.png`, `sales-hiring.png`, `advisor-hiring.png`.
- Documents: owner, closer, sales, advisor all stay on `/app/documents.html`. Shots: `owner-documents.png`, `closer-documents.png`, `sales-documents.png`, `advisor-documents.png`.
- Contracts: all four stay on `/app/contracts.html` (title “Contract templates”). Shots: `owner-contracts.png`, `closer-contracts.png`, `sales-contracts.png`, `advisor-contracts.png`.

**Who can open (live only — screen not named in intended)**
- Pipeline: all four open. Shots: `owner-pipeline.png`, `closer-pipeline.png`, `sales-pipeline.png`, `advisor-pipeline.png`.
- Closer Dashboard: all four open. Shots: `owner-closer-dashboard.png`, `closer-closer-dashboard.png`, `sales` and `advisor` same-named shots.
- Call cockpit: owner + closer open. Sales bounce to Sales Floor. Advisor bounce to Client Control Panel.
- Present: owner + closer + sales open. Advisor is **BROKEN** (see below).
- My Numbers: owner + closer open (offer stack on screen). Sales + advisor bounce.
- Sales Floor: owner + sales open. Closer + advisor bounce.
- Lenders: owner + advisor open. Closer + sales bounce.
- Client Control Panel: all four open on the test client.

**Pipeline (owner clicks)**
- Search: typed `test`. Shot: `owner-pipeline-search.png`. No DB write.
- Filter: opened, changed Owner, Clear all. Shot: `owner-pipeline-filter.png`. No DB write.
- Open a card: drawer opened (Francis Rawlins). Close worked. Shot: `owner-pipeline-card.png`. 17 cards on the live board. No archive.

**Call cockpit (owner, test client)**
- Join call: disabled, title “No call link on this appointment.” Honest. Shot: `owner-call.png`.
- Present button is on the screen.
- Disclosure boxes d1–d4 toggle.
- Outcome buttons 1–5 and belief buttons toggle. Shot: `owner-call-after.png`.
- Save · next call: picked Downsell, saved. **DB row** `call_outcomes` `c54cc851-a49d-409b-a737-203d4962107a` `outcome=downsell` `client_id=8556bedc-…` `logged_at=2026-08-18T16:21:10Z`. Then the page moved to the next booked call. Shot: `owner-call-save-downsell.png`. No email / SMS.

**Present (owner, test client)**
- Next screen advanced one slide.
- Client screen only / Show cockpit toggled. Shot: `owner-present-after.png`.
- Send-contract / soft-pull / pay / letters buttons were **not** clicked.

**My Numbers**
- Owner and closer: offer stack on screen ($32 Diagnostic, Card Stacking DFY, Consulting, Credit Repair, Inquiry Removal). Shots: `owner-my-numbers.png`, `closer-my-numbers.png`. No clickable desk controls besides chrome. No DB write.

**Hiring (owner)**
- Reset filters. Shot: `owner-hiring-reset.png`.
- Role filter. Shot: `owner-hiring-role.png`. Numbers painted (Short by 12, 3 open applications).
- Beta Dismiss.
- Flagged only. Shot: `owner-hiring-flagged.png`.
- No hire / reject click.

**Lenders (owner + advisor)**
- Tabs: Lender list, Bureau mismatch queue, AI bureau config. Shots: `owner-lenders-list.png`, `owner-lenders-review.png`, `owner-lenders-bureau.png` (advisor twins too).
- Apply filters (typed test).
- Export CSV clicked.
- Import CSV opened then cancelled. Import now not run.
- List is empty on purpose (“import from Airtable”). No lender row saved.

**Documents**
- Pending only. All four roles.
- CONTRACTS tab. Shot: `owner-documents-tab-contracts.png`.
- Open PDF: first contract badge went to **OPENED**. No new tab (page downloads a file in place). Shot: `owner-documents-open-pdf.png`. Remind / Void not clicked.

**Contracts**
- New wording opened, then Cancel. No save. All four roles. Shot: `owner-contracts-new.png`.
- Upload a PDF control is on the screen (picker not finished).
- Clicked SOFT-PULL-CONSENT row: editor opened with the words. Shot: `owner-contracts-row.png`. No save / archive.

**Client Control Panel (test client)**
- Pick a client: test client `8556bedc-…`. All four roles.
- Five group titles expand.
- Open Pipeline → `/app/pipeline.html`. Shot: `owner-ccp-open-pipeline.png`.
- Open Messaging → `/app/messaging.html?client_id=8556bedc-…`. Shot: `owner-ccp-open-messaging.png`.
- Open Inquiry Remover → `/app/inquiry-remover.html`. Shot: `owner-ccp-open-inquiry-remover.png`.

**Sales Floor extras (owner)**
- Page opens. Funnel and offer stack paint. Shot: `owner-sales-floor.png`.
- Today's recordings: clicked; panel says “No Meet recordings in the last 7 days.” Honest empty. Shot: `owner-sales-floor-recordings.png`.

### BROKEN

1. **Closer Dashboard math stays blank** — built wrong (not a merge loss).
   - Claim: type a draw / deposit and see funded, net, monthly change. Copy says “Net cash uses the numbers you type.”
   - Observed: on the test client, draw `5000` and deposit `3000` typed; credit / net / monthly / funded stayed `—`. Same dashes on the live gmail file open (read-only). W1 already logged this (`f23ced1` defer of `data.js`; the page boots and quits before the live calc runs). Code is still in `closer-dashboard.html`. Sample `recompute()` also returns when there are no cards.
   - DB: none. Outside service: none.
   - Evidence: `owner-closer-dashboard-math.png`, `owner-closer-dashboard-math-file.png`.

2. **Sales Floor has no closer scroller** — built wrong (not a merge loss).
   - Claim: move between closers (arrows / picker). Code for that shipped in `63a0241`.
   - Observed: “0 CLOSERS ON SHIFT”. No arrows. Same fail as the 2026-08-17 sixteen audit. DB has **1 active closer** and **5 closer rows**; the active one is named like a test closer and `isBlockedCloserIdentity` hides `/^test\b/` names. The control never appears.
   - Evidence: `owner-sales-floor.png`, `sales-sales-floor.png`.

3. **Advisor Present dumps them on Sign in** — built wrong (not a merge loss).
   - Claim: open Present for a contact.
   - Observed: advisor was already signed in. `/app/present.html?contact=8556bedc-…` sent them to `/login.html`. `present.js` treats a `closer-deck` unauthorized read as “log out.” Closer and sales keep the deck.
   - Intended files do not name Present, so *who should open it* is MISSING. The login dump is still wrong for a signed-in advisor.
   - Evidence: `advisor-present.png`.

4. **Client Control Panel “Open Bank Inbox / GHL Contact / Raw Report”** — built wrong (not a merge loss).
   - Claim: those buttons open those places.
   - Observed: three disabled buttons. Titles: “Not wired on this screen” / “GHL cut over — use Messaging” / “Raw bureau PDF not linked here yet.” Click does nothing. Code is on the page and still does nothing.
   - Evidence: `owner-ccp-expanded.png`.

### MISSING

- Intended journeys do **not** name Pipeline, Closer Dashboard, Call cockpit, Present, My Numbers, Sales Floor, Lenders, or Client Control Panel. Live who-can-open for those screens is reported above. Do not treat that as intended.
- CCP Notes: `textarea#notes` is **readonly**. Screen also says notes do not save from this screen. Shot: `owner-ccp-notes.png`.
- Pull TransUnion / Experian / Equifax, Generate Apps, Issue Inquiry Removal: buttons are live on the test client. Not clicked (W1 owns live pull / inquiry; no pull on the gmail file).
- Send contract on Call / Present: button is there. Not clicked (W1 already sent and signed SOFT-PULL-CONSENT this morning).
- Documents Remind / Void: not clicked (would mail or void a live prove send).
- Lenders Import now / Save / Add blank row: not run (would write the live lender list).
- Hiring hire / reject: not clicked.
- Pipeline Archive / MOVE / DEL / Text: not clicked (would move or archive a live person).

### W2 stop

No app, test, config, env, or intended-journey edits. No deploy. No second contract. No bureau pull. No mail to the gmail credit file.

## W3 findings

Walked 2026-08-18 on `https://fundhub.ai` as `chris@fundhub.ai` (owner), `closer@`, `advisor@`, `sales@`, `inquiry@`.
Password from gitignored `.env` (`STAFF_E2E_PASSWORD`). Never printed.
Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w3/` (walk + follow-up shots). Logs: `w3/walk.json`, `w3/followup.json`.

Did not fire inquiry Send / Mark cleared / Close. Did not send Messaging. Did not confirm Ops “Send what is waiting” / “Pause sending” / “Email unsent invoices.” Did not Save / Reset password / Revoke login. Never touched the live gmail credit file `9af65808-…`.

Ground truth for who can open: `docs/journeys/*-intended.md`. Only the Specialist desk is named as a screen (`role-inquiry-remover-intended.md`). Finance OS, Products & Commissions, Ops & Admin, Calendar, Messaging, and Staff & Teams are **not** named.

### WORKS

**Who can open (live)**

- Finance OS: owner stays on `/app/finance-os.html`. Closer → Closer Dashboard. Advisor → Client Control Panel. Sales → Sales Floor. Inquiry → Specialist. Shots: `owner-finance.png`, `closer-finance.png`, `advisor-finance.png`, `sales-finance.png`, `inquiry-finance.png`.
- Ops & Admin: owner only. Same bounce map. Shots: `owner-ops.png`, `closer-ops.png`, `advisor-ops.png`, `sales-ops.png`, `inquiry-ops.png`.
- Products & Commissions: owner + sales. Closer / advisor / inquiry bounce. Shots: `owner-products.png`, `sales-products.png`.
- Staff & Teams: owner + sales. Closer / advisor / inquiry bounce. Shots: `owner-staff.png`, `sales-staff.png`.
- Calendar, Messaging, Specialist: owner, closer, advisor, sales, inquiry all stay. Inquiry home is Specialist. Shots: `*-calendar.png`, `*-messaging.png`, `*-specialist.png`.

**Finance OS (owner)**

- Opens. Honest empty: “The bank is not linked. Nothing here is a made-up balance.” Personal / Business / Investment / Subscriptions all say none. No connect-bank button that lies. Shot: `owner-finance.png`.
- Same empty with test client id `8556bedc-…`. GET `/api/finance/bank-accounts` and `/api/finance/bills` 200. No made-up balances. Shot: `owner-finance-test-client.png`.
- Beta Dismiss hides the yellow bar. Shot: `owner-finance-dismiss.png`. No DB write.

**Products & Commissions (owner + sales)**

- Page loads 5 products. GET `/api/read/products` and `/api/read/commissions` 200. Shot: `owner-products.png`.
- Products / Commission rules tabs switch. Rules tab honest: “Commission rules are not held on this screen.” 0 active rules, so Change rate / See these payouts are not on the page. Shot: `owner-products-rules.png`.
- View payout ledger → shows an empty ledger (“No payouts on file.”). Back to rules works. Status filter changes. Shot: `owner-products-ledger.png`.
- + Add product opens the New product drawer. Cancel closes it. No save. Shot: `owner-products-add.png`.
- Click `$32 Diagnostic` opens Edit product. Cancel closes it. No save. Shot: `owner-products-row-edit.png`.

**Ops & Admin (owner)**

- Period picker opens. Pick another range reloads KPIs (`GET /api/dashboard/kpis?period=today` 200). Shot: `owner-ops-period-pick.png`.
- Money / People tabs switch. Shot: `owner-ops-people.png`, `owner-ops-money.png`.
- Affiliates + Hiring expands. Open Affiliates ↗ is a real link.
- Outbox reads the queue: “1 message waiting… Set up to send: email via resend, sms via twilio.” Buttons appear. Shot: `owner-ops-outbox.png`.
- Pause sending: confirm “Nothing goes out… 1 message(s) will sit.” Dismissed. No write.
- Send what is waiting: confirm “They go out to real clients and cannot be pulled back.” Dismissed. No write. Shot: `owner-ops-outbox-send.png`.
- Email unsent invoices stayed hidden (none waiting). Honest.

**Specialist (all five roles; deep click as inquiry)**

- Inquiries / Repair toggle. Repair: “No repair files yet.” Need-me tiles on Repair paint 0. Shot: `owner-spec-repair.png`.
- Sales `GET /api/repair/exceptions` 403. Matches intended: stuck-file confirm is Specialist + owner + admin only.
- Two Queued test-client cases show for inquiry (`e235efc2-…` and `1d212e99-…`, client `8556bedc-…`). Shot: `inquiry-specialist.png`.
- Click a Queued row opens upload, draft letter, Download packet, Send, Mark cleared, Close. Shot: `inquiry-spec-case-open.png`.
- Download packet opened `GET /api/read/documents?client_id=8556bedc-…`. Shot: `inquiry-spec-packet.png`.
- All letters ↗ goes to `/app/documents.html`. Shot: `inquiry-spec-all-letters.png`.
- Send / Upload / Mark cleared / Close were **not** clicked. FIRE stays with W1.

**Calendar (all five roles)**

- Day / Week switch. Shot: `owner-cal-week.png` (week of Aug 16–22).
- ‹ › and Today move the date. Week-strip day sets “Tuesday, August 18.” Shot: `owner-cal-strip.png`.
- Empty day: “Nothing booked.” Honest. Join Call hidden (no appointment). Client file disabled, title “No client linked.” Honest. Shot: `owner-calendar.png`.
- GET `/api/shifts?roster=1` 200. Who’s on today: “Nobody clocked in right now.”

**Messaging (all five roles)**

- Default tab is Needs reply. Empty copy: “Nothing is waiting on a reply.” GET `/api/read/inbox?limit=200&needs_reply=1` 200. Shot: `owner-messaging.png`.
- All tab lists 8 threads. Search “test” leaves 2. Shot: `owner-msg-all.png`, `owner-msg-search.png`.
- Open Karl Elliott: thread loads, channel says Text, Send enables, texting-hours note shows. Shot: `owner-msg-thread.png`. Typed only. Send **not** clicked (would POST `/api/messages`).

**Staff & Teams (owner + sales)**

- Roster loads, then hides owner + seeded test logins. Footer: “no staff on the roster yet · 23 hidden.” Filter `chris` still empty (Chris is hidden). Shot: `owner-staff-filter.png`, `sales-staff.png`.
- Roster / Permissions / Clock & consent / Telemetry tabs switch. Permissions tab says there is no list and nothing here changes what a role may do. Shot: `owner-staff-perms.png`.
- + Add person opens New person. Cancel closes it. No save. Shot: `owner-staff-add.png`.
- Permissions → jumps to the Permissions tab.

### BROKEN

1. **Specialist work queue never leaves “Loading inquiry queue…”** — built wrong after the speed pass (not a later silent merge delete).
   - Claim: the work queue lists inquiries; Need me / bureau chips / Log an attempt / Mark confirmed run on those rows (`role-inquiry-remover-intended.md` items 3–4).
   - Observed: status row stays “Loading inquiry queue…” after 4s. Need me / Worked / Calls / Confirmed stay `—`. Bureau chips stay 0. No `GET /api/inquiries` (or `FHData.inquiries`) ever fires. Only cases load (`/api/read/inquiry-cases` 200).
   - Why: `inquiry-remover.html` line 1119 `if (!table || !window.FHData) return Promise.resolve();` runs in a non-deferred script. `data.js` is `defer` since `f23ced1` (“Speed up CRM screens: defer shell scripts”). The loader quits before `FHData` exists. Same class of miss W1 logged on closer math. Ops & Admin was later patched to wait for `DOMContentLoaded`; this screen was not.
   - Evidence: `inquiry-spec-queue-wait.png`, `owner-spec-inq.png`. `followup.json`.

2. **Ops & Admin People tables stay empty while staff exist** — built wrong (same hide as Staff & Teams, no note).
   - Claim: People tab shows staff, comp, and consent.
   - Observed: “No staff rows.” GET `/api/read/staff?limit=200` 200. Staff & Teams on the same login says 23 people are hidden. This tab does not say that. Comp stays `—`.
   - Evidence: `owner-ops-people.png`.

3. **Products tile says “3 with variable pricing” while the table shows 4 VARIABLE** — built wrong.
   - Claim: the tile counts variable-price products.
   - Observed: copy is hardcoded in `products-commissions.html` (`3 with variable pricing`). Live table: Diagnostic FIXED; four others VARIABLE.
   - Evidence: `owner-products.png`.

4. **Calendar “Move one booking” / “Reschedule the other” do nothing** — built wrong.
   - Claim: those labels sit on the double-booking sample and look like actions.
   - Observed: they are plain spans in the Demonstration states block. Click: no API, no dialog, no date change.
   - Evidence: `owner-cal-demo-act-0.png`, `owner-cal-demo-act-1.png`.

### MISSING

- No intended journey names Finance OS, Products & Commissions, Ops & Admin, Calendar, Messaging, or Staff & Teams as **screens**. Who-can-open above is live only. Do not treat it as a new intended spec.
- Intended closer / advisor / inquiry / sales files still list Finance **API groups** as reachable. Live HTML for Finance OS and Ops & Admin is owner-only (2026-08-17 nav lock in `shell.js` `OWNER_ADMIN_ONLY`). That gap is missing ground truth, not a new product call.
- Specialist Send is on the expanded test case. **Not fired** (W1 owns FIRE). W1 already marked Send as BROKEN for `call_fired_at`. W3 only proves the button is there after a click.
- Messaging Send, Ops outbound dispatch / pause, product Save, staff Save / Reset password / Revoke login / Clock / consent: seen, **not written**.
- Finance OS has no “connect the bank” control. Empty is honest. There is no intended journey for company-money connect.
- Clock in/out is not reachable for the signed-in owner because that person is in the 23 hidden rows.

### W3 stop

No app, test, config, env, or intended-journey edits. No deploy. No inquiry fire. No live mail or SMS. No staff revoke. No gmail credit file.

## W5 findings

Walked 2026-08-18 ~12:13–12:18 EDT on `https://fundhub.ai`.
Staff: `chris@fundhub.ai`, `closer@`, `sales@`, `advisor@`, `affiliate@`.
Password from gitignored `.env` (`STAFF_E2E_PASSWORD`). Never printed.
Client: email-link only. Did not invent a password. Unsigned `/portal-login.html` only.
Did not turn sending on. Did not promote an agent. Did not fire a soft pull, inquiry removal, or contract send.
Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w5/`
Walk log: `w5/report.json`. Matrix shots: `w5/role-{role}-{screen}.png`.

Ground truth for who can open what is `docs/journeys/*-intended.md`. Those files name **API route groups**, not the 31 CRM nav screens. Screen-level “who can open” is **MISSING** except where a group maps (journeys, hiring). Observed open/bounce is in the table below.

### WORKS

**Role matrix — owner** (`role-owner-intended.md`: nothing blocked)

- Owner opened every CRM nav screen. Landed on the named file. `w5/role-owner-*.png`.

**Role matrix — hiring / journeys bounce (intended names these groups)**

- Closer / sales / advisor bounced from Hiring. Matches intended “hiring blocked.” Shots: `w5/role-closer-hiring.png`, `role-sales-hiring.png`, `role-advisor-hiring.png`.
- Closer / advisor bounced from Journeys to their home. Matches intended “journeys blocked.” `w5/role-closer-journeys.png` (lands Closer Dashboard), `w5/role-advisor-journeys.png`.
- Affiliate bounced from Journeys and Hiring. Matches intended blocked groups. `w5/role-affiliate-journeys.png`.

**Role matrix — other observed opens (no screen-level intended; still happened)**

- Closer opened: Pipeline, Closer Dashboard, Call cockpit, My numbers, Calendar, Client Control Panel, Messaging, Documents, Specialist, Workflows, Message Copy, Contract templates.
- Sales opened: Pipeline, Closer Dashboard, Sales floor, Calendar, Client Control Panel, Messaging, Documents, Specialist, Workflows, Message Copy, Staff & Teams, Products & Commissions, Contract templates.
- Advisor opened: Pipeline, Closer Dashboard, Calendar, Lenders, Client Control Panel, Messaging, Documents, Specialist, Workflows, Message Copy, Contract templates.
- Affiliate opened Affiliate only. Typed Pipeline (and every other staff screen) and landed on Affiliate. `w5/role-affiliate-pipeline.png`.
- Lenders: owner + advisor opened; closer + sales bounced. `w5/role-advisor-lenders.png`, `w5/role-closer-lenders.png`.
- Client unsigned portal login shows “Email me a sign-in link” and “No password needed.” `w5/role-client-portal-login.png`.

**Message Copy** (`/app/template-editor.html`)

- Owner / closer / sales / advisor opened it. Affiliate bounced to Affiliate.
- List loaded: 200 messages, 18 texts, 182 emails, 190 off, 2 drafts. `w5/owner-copy-01-loaded.png`.
- “How this works” opened. Live copy: edit switches the message off; owner/admin must approve; short names cannot change; **“nothing on this screen transmits.”** `w5/owner-copy-02-explain.png`, `w5/owner-copy-03-editor.png`.
- Click a list row opened the editor (`EMAIL-S02-FINISH-APPLICATION`, switched off, never approved).
- “First name” tag inserted locally. “Undo my changes” put the wording back. No database write.
- Next page worked. Previous was disabled on page 1.
- Approve card: visible for owner, hidden for closer. Approve button stayed disabled until the “I have read” box (not ticked).
- Draft banner: dispatcher refuses `[DRAFT]` even if approved.

**Workflows** (`/app/automations.html`)

- Owner / closer / sales / advisor opened it. Affiliate bounced.
- Tiles: 51 workflows, Engine **ON**, Ever triggered **42 of 51**. Banner: engine is on; this screen does not say a workflow ran. `w5/owner-wf-01-loaded.png`.
- Click a row opened registry details (`af-02-referral-ownership-capture`, engine_active yes, last trigger today). `w5/owner-wf-02-expand.png`.
- Rail filter “AF” hid the other groups. `w5/owner-wf-03-rail.png`.
- No send button. Nothing queued. Nothing sent. Read only.

**Journeys — controls that did what they said** (owner only)

- Owner opened `/app/journeys.html`. Closer / sales / advisor / affiliate bounced to home.
- Step / Simulate / History tabs switched the panel. `w5/owner-jny-02-tabs.png`.
- “Run the journey” (Simulate) ran in the browser. No database row. No mail. `w5/owner-jny-03-sim.png`.
- “Apply to code” with nothing dirty: toast **“Nothing to apply. Change a step first.”** `w5/owner-jny-04-apply.png`.
- “Save version” opened a name prompt (dismissed). Versions are in the browser only.
- Undo was disabled when there was nothing to undo.
- “Test against the code” ran, then undid the run. Panel: “Nothing was saved — the run was undone.” `w5/owner-jny-05-runcode.png`.
- Click a step selected it. “+” opened the add-step menu (no type inserted).

**Agent Editor — controls that did what they said** (owner only)

- Owner opened `/app/agent-editor.html`. Other roles bounced.
- List loaded 22 agents. Click a row loaded that agent. `w5/owner-agt-01-loaded.png`.
- Identity / triggers / prompt / escalation / shadow log cards opened.
- A guardrail switch flipped locally. Revert put it back. No database write.
- “Return to shadow” asked to confirm (“It stops acting on real clients…”). Dismissed. Row stayed live.
- “+ New agent” asked for a name. Dismissed. No row created.
- Promote gate on Setter Josh: blocked (no trigger, empty prompt, empty guardrail). Did not promote.

### BROKEN

#### Agent Editor says two agents are live on real people — they have no prompt and no trigger

- **Journey / step:** Agent Editor · LIVE tile + mode line.
- **Expected:** “LIVE / acting on real clients” means the agent can actually act.
- **Observed:** LIVE = 2. Mode: “Acting on real clients on Voice. 0 runs.” Setter Josh and Inquiry Removal AI are `status=live`, prompt empty, 0 triggers. Banner: “2 running with no stored prompt/guardrails.” Screen also says promotion is blocked for those same missing pieces — but they are already marked live.
- **Lost in a merge vs built wrong:** **built wrong.** Seeded live on purpose in `db/migrations/037_agent_registry.sql` (prompt left empty on purpose). Not a later merge loss. The live badge still claims action that this row cannot do.
- **Evidence:** `w5/owner-agt-01-loaded.png`. Database: `agents.status=live` for `AG-04`, `AG-09`.

#### Journeys “Test against the code” — journey says send a text, no message row

- **Journey / step:** Journeys · Test against the code.
- **Expected:** a step that claims to send a text writes a message row (test then rolls it back). Chris: claim-to-send that only queues / writes nothing is broken.
- **Observed:** “1 MESSAGES THAT WOULD SEND” and also “the journey sends a sms here and no message row was written” (`demo-platform-nurture · sms`). 0/51 automations reached. Two waits have unit `undefined`. Run was rolled back (good). The send claim failed.
- **Lost in a merge vs built wrong:** **built wrong.** Runner is on main (`src/journeys/runner/diff.mjs`) and reported the miss. Not a deleted send path from a merge.
- **Evidence:** `w5/owner-jny-05-runcode.png`.

### MISSING

- No intended journey file names the 31 CRM **HTML** screens. Role table below is live observation. Do not treat it as a new intended spec.
- No intended journey for Message Copy, Workflows, or Agent Editor as screens. Journeys APIs exist (`role-owner-intended.md` journeys 2 routes; closer/advisor blocked; sales manager 1 route).
- Sales manager intended can reach **1 journeys route** (`/api/journeys/run`). Live: typing Journeys bounces to Sales Floor, so they cannot press “Test against the code.” Screen-level intended is missing. Shot: `w5/role-sales-journeys.png`.
- Intended closer / advisor / sales files list Campaigns, Creative Factory, and some Finance **API** groups as reachable. Live HTML for Campaigns / Social / Creative / Finance OS / Company Brain / Galaxy / Ops / Agent Editor is owner-only (bounce). That is the 2026-08-17 nav lock, not an intended HTML rule. Do not invent one.
- Affiliate intended lists contracts (1 route) and Documents (1 route). Those are API groups (`/api/contracts/sign` is open to anyone). Live HTML `contracts.html` and `documents.html` bounce the affiliate to Affiliate. Screen-level intended missing.
- Client was not signed in. Email-link only.
- **Save wording**, **Approve this wording**, **Save agent**, **Make the change** (Claude), **Apply to code** with a real edit: buttons seen, **not fired**. A write would change live copy or live agents. No database proof those writes work.
- Roles not walked: admin, setter, inquiry specialist, partner.

### Role matrix (live HTML)

OPEN = stayed on that screen. BOUNCE = sent to that role’s home.

| Screen | owner | closer | sales | advisor | affiliate |
|---|---|---|---|---|---|
| Home | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Pipeline | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Closer Dashboard | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Call cockpit | OPEN | OPEN | BOUNCE | BOUNCE | BOUNCE |
| My numbers | OPEN | OPEN | BOUNCE | BOUNCE | BOUNCE |
| Sales floor | OPEN | BOUNCE | OPEN | BOUNCE | BOUNCE |
| Calendar | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Lenders | OPEN | BOUNCE | BOUNCE | OPEN | BOUNCE |
| Finance OS | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Client Control Panel | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Messaging | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Documents | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Specialist | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Company Brain | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Galaxy | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Ops & Admin | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Agent Editor | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Workflows | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Journeys | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Message Copy | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Campaigns | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Social Studio | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Creative Factory | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Staff & Teams | OPEN | BOUNCE | OPEN | BOUNCE | BOUNCE |
| Hiring | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Products & Commissions | OPEN | BOUNCE | OPEN | BOUNCE | BOUNCE |
| Contract templates | OPEN | OPEN | OPEN | OPEN | BOUNCE |
| Brand Studio | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Client Portal | OPEN | BOUNCE | BOUNCE | BOUNCE | BOUNCE |
| Affiliate | OPEN | BOUNCE | BOUNCE | BOUNCE | OPEN |

### W5 stop

No app, test, config, env, or intended-journey edits. No deploy. No outbound switch change. No agent promote. No contract / pull / inquiry fire.

## W4 findings

Walked 2026-08-18 on https://fundhub.ai. Owner `chris@fundhub.ai`, closer, sales, advisor, affiliate. Client portal as staff, plus the login page. No second magic-link storm (2 links already in 15 min; W1 already has client shots). No live social publish. DEMO partner only: `94796e0e-d012-4987-8721-676093aaed79`.

Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w4/` (90 screenshots). DB: `w4/db.json`.

Ground truth for who can open: `docs/journeys/*-intended.md`. Control truth: Chris 2026-08-18 — every control does what it claims.

**COMPLIANCE REVIEW REQUIRED** on the Client Portal “Sign to authorize dispute letters” card. W4 did not press Sign. W1 owns that proof.

### WORKS

1. Owner sign-in lands on Pipeline. `00-owner-login.png`
2. Campaigns opens for owner. DEMO partner shows in the picker. Honest empty: no ads, no connection. After a wait, footer says “5 of 5 panels loaded.” `campaigns-owner-demo.png` `campaigns-after-wait.png`
3. Campaigns filters do what they say (platform, offer, limit, window, action-log target, action-log rule).
4. Reload reloads the page.
5. **Sync Meta now** claims it will pull from Meta. Happened: “Nothing was pulled from Meta. no active Meta connection for this partner.” POST `/api/campaigns/sync` 400. No outside pull. `campaigns-sync-meta.png`
6. Clicking a campaign / attention tile opens the detail drawer. Drawer was empty because there is no campaign. `campaigns-detail.png`
7. Social Studio opens for owner on DEMO. Says **0 of 8** connected accounts. Queue is empty. That is the finding Chris named: no connected account. `social-owner-demo.png`
8. **Write a post** opens compose.
9. The five count tiles and the Waiting / Needs a rewrite / Could not be sent / Sent / Send history tabs switch the list.
10. **Queue post** claims it will save a draft. Happened: “Pick an account to post to first.” No `social_posts` row. Honest refuse.
11. **Clear the form** clears the caption.
12. **Send anything due now** asks first. Confirm was dismissed. Nothing published. No `/api/social/publish` write.
13. After **Turn on for this partner**, Social **Write 3 posts for me** and Creative **Enqueue** go from dead to live. POST `/api/partner-marketing/enable` 200. Matches white-label intended (owner flip). `social-after-enable.png` `creative-after-enable.png`
14. Brand Studio **Create pages from selected funnels** claims it writes drafts. Happened: “Page drafts created.” DB row `partner_pages.id=c1a641e5-…` slug `apply` status `draft`. `brand-create-pages.png`
15. Brand Studio **Save & apply** claims it saves. Happened: “Legal entity is required — it goes into every disclosure.” Did not wipe the existing DEMO brand row. Honest refuse.
16. Brand Studio **Submit for approval** says, on screen, review is not set up and the brand stays a draft. Did not send mail. `brand-submit.png`
17. Galaxy opens as LIVE. It draws workers from the activity feed. Footer says read-only. Clicking the sky zooms into a cluster. `galaxy-owner.png` `galaxy-cluster.png`
18. Company Brain page opens. **New chat**, **Documents**, **Refresh**, **Close** work. Docs list says an owner must approve a file first. `brain-owner.png` `brain-docs.png`
19. Owner can open the Affiliate **page**. Copy link / Copy code / tabs / status filter / business filter all respond. Ask and Download refuse for owner (403). That refuse is correct for a staff session.
20. Closer typed every W4 URL and was sent home to Closer Dashboard. `*-closer.png`
21. Sales manager typed every W4 URL and was sent home to Sales Floor. `*-sales.png`
22. Advisor typed every W4 URL and was sent home to Client Control Panel. `*-advisor.png`
23. Affiliate typed Campaigns / Social / Creative / Brand / Galaxy / Company Brain / Client Portal and was sent home to Affiliate. Matches `affiliate-intended.md` (Campaigns and Creative Factory stay blocked). `*-affiliate.png`
24. Affiliate sign-in shows code `AFF-000001` and link `https://fundhub.ai/start?ref=AFF-000001`. License-unsigned banner is on. `affiliate-affiliate.png`
25. Affiliate **Download Message Blaster** claims a Mac download. Happened: “Download started — open the file on your Mac.” GET `/api/gifts/message-blaster` succeeded. `affiliate-affiliate-blaster.png`
26. Staff Client Portal with the test client id shows the welcome block and the dispute-sign card, in that order. `portal-staff-testid.png`
27. Portal login is email-link only. Zero password fields. Copy matches the claim. `portal-login.png`
28. W4 did not fire a third magic link (2 already in 15 min). Correct.

### BROKEN

1. **Creative Enqueue does not create a job.** (built wrong, not a merge loss)
   - Expected: Enqueue puts a job on the queue.
   - Observed: After the suite was on, the button was live. Click: `generation_jobs_requested_by_fkey`. No `generation_jobs` row. Run then said “Ran 0 jobs.”
   - Why: `api/creative/generate.mjs` writes `principal.staffId` into `generation_jobs.requested_by`, which points at `accounts(id)` (`045_creative_factory.sql`). A staff id is not an account id. Code is still on main (`255ee32` / `a57d9c3` suite).
   - Evidence: `w4/creative-enqueue-after.png`

2. **Company Brain upload and Ask fail on the live site.** (built wrong — same as W1)
   - Expected: + adds a file. Send answers. Docs list shows the file.
   - Observed: upload POST `/api/company-brain/upload` **502**. Ask POST `/api/read/company-brain` **502**. Docs list still “No files added yet.” No `brain_files` row. Chat is on main (`13d1b8d`). W1 owns “does it answer against a doc.”
   - Evidence: `w4/brain-upload.png` `w4/brain-ask.png`

3. **Affiliate Ask does not answer.** (built wrong)
   - Expected: Ask uses owner-approved affiliate docs.
   - Observed: “Could not answer — embed_http_401 … token is not from a valid issuer.” No answer. Outside call failed.
   - Evidence: `w4/affiliate-affiliate-brain.png`

4. **Connect Facebook / Instagram / LinkedIn do not connect.** (built wrong / not set up)
   - Expected: start a real sign-in for DEMO.
   - Observed: GET `/api/social/oauth?action=start&channel=facebook&partner_id=…` **503** `not_configured`. Stayed on Social Studio. Zero `social_channels` rows. Chris said: if there is no connected account, that is the finding.
   - Evidence: `w4/social-oauth-fb.png` `w4/social-owner-demo.png`

5. **Write 3 posts for me did not land a draft.** (built wrong or hung)
   - Expected: three drafts in the waiting list.
   - Observed: button went live after the suite flip. Click stayed on “Writing…”. No `marketing_content_queue` row. No `social_posts` row.
   - Evidence: `w4/social-generate-after.png` `w4/db.json`

6. **Affiliate numbers are not connected.** (built wrong — never wired)
   - Expected: referred / clicks / converted / paid count real referrals.
   - Observed: page says those numbers “come from your referral tracking, not connected to this page yet.” Clicks 30d is “—”. Funnel says it cannot count clicks.
   - Evidence: `w4/affiliate-affiliate.png`

7. **Client Portal welcome video is missing.** (built wrong — still on live)
   - Expected: a welcome video at the top.
   - Observed: gray box “Welcome video is not available.” Sign card is under it (order is right). Same fail as the 2026-08-17 sixteen audit.
   - Evidence: `w4/portal-staff-testid.png`

### MISSING

1. **No intended journey names these screens:** Social Studio, Brand Studio, Galaxy, Company Brain **page**, Affiliate Portal, Client Portal. Who-can-open for those is **MISSING ground truth**. Do not invent. White-label intended covers Brand / Social / Creative for a **partner**, which W4 did not walk (`partner@` was not assigned).
2. **Intended vs live for Campaigns and Creative Factory.** `role-closer-intended.md`, `role-sales-manager-intended.md`, and `role-funding-advisor-intended.md` still say those roles can reach Campaigns (6) and Creative Factory (4). Live bounces them home. Owner call 2026-08-17 hid beta screens from staff nav (`public/app/shell.js` `OWNER_ADMIN_ONLY`). The intended files were not updated. That gap is missing ground truth, not a new product break.
3. **Brand review is not built.** Submit for approval says so on the screen. Nothing is sent.
4. **Five social networks are labeled “not ready to connect.”** TikTok, X, YouTube Shorts, Threads, Pinterest. Picture attach is also “not ready.”
5. **Social “must approve before it goes out” cannot be read.** Screen: “SETTING NOT READ.” It also says posts are lined up and sent anyway because there is nowhere to record an approval.
6. Client magic-link **own file** is W1. W4 did not open a third link. W1 already marked that proof BROKEN.

### W4 stop

No app, test, config, env, or intended-journey edits. No deploy. No live brand publish. DEMO suite was turned **on** (owner flip, required to test write buttons). One DEMO apply page draft was created. Company Brain Ask-against-doc and client dispute sign stay with W1.

## W6 findings

Walked 2026-08-18 on `https://fundhub.ai`. Owner `chris@fundhub.ai`. Test client only for fires: `8556bedc-…` (`client@fundhub.ai`).
Never opened the live gmail credit file. Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w6/`.
Ground truth for *does the control do what it claims*: Chris’s 2026-08-18 order. No intended journey names these fire steps.

**COMPLIANCE REVIEW REQUIRED** — dispute-letter sign card was shown as the test client. Sign was not pressed. Inquiry Send was pressed and did not mail or call a bureau.

No W6 break is lost-in-merge. Each one below is **built-wrong** (or missing product / missing destination).

### WORKS

**Owner sign-in**
- Lands on Pipeline. `w6/00-owner-login.png`.

**Generate Apps (test client)**
- Button ran. It only refreshes the lender apply list (`GET /api/read/lender-matches`). No new app row. Screen: “Lender list is empty — import CSV on Lenders.” Honest. `w6/01-generate-apps.png`.

**Issue Inquiry Removal — case create only**
- Click posted `POST /api/inquiry-cases` 200 and opened Specialist. New Queued row `f872cc9d-…` on the test client. `call_fired_at` stayed empty. No request left for `inquiry-removal-ai-sigma.vercel.app`. `w6/01-issue-ir.png`. `w6/fire.json` `after.inquiry`.

**Outbox pause / send**
- Queue: “All caught up. 6 sent today.” Send button hidden (nothing waiting). Pause ran, then sending was turned back on. `messaging_settings.outbound_enabled` is still true. `w6/01-outbox-before.png`.

**Lender Import now (empty box)**
- Empty CSV posted `POST /api/lenders` 400. Screen: “Paste or upload a CSV with lender_table and name columns.” Did not overwrite the empty lender table (0 rows). `w6/01-lenders-import-now.png`.

**Agent Editor Save (draft AG-01 only)**
- Setter Josh and Inquiry Removal AI were not saved. Draft “Agent 1 Lead Follow-up” saved. `POST /api/agents` 200. Row `updated_at` moved to 2026-08-18. Still draft. `w6/01-agent-save.png`. `w6/agent-save.json`.

**Client session (minted — email-link still broken)**
- Email-link login is still W1 BROKEN. W6 minted a session with the same primitive the app uses (`createAccountSession`) and did not print the token. Session revoked after the walk.
- Test client sees their own file: “Welcome back, TEST”. Soft Pull Authorization shows Signed. Payments: “No payments yet.” 0 unlocked / 6 locked. Advisor name not shown. `w6/03-portal-home.png`, `w6/03-portal-tab-agree.png`, `w6/03-portal-tab-pay.png`.
- Account & history tabs (Payments / Agreements / Documents / Activity / Messages) open. `w6/03-portal-acct-open.png`.
- Dispute-letter sign card is on the page, wording loaded, form unsigned. Not pressed. `w6/03-portal-home.png`.
- Putting the live credit-file id in the URL did **not** show that file. Page said “We could not load your file.” No other-file name. `w6/03-portal-isolation.png`.
- Typing Pipeline as that client bounced back to Client Portal. `w6/03-portal-pipeline-bounce.png`.

**Remind (Documents)**
- First Remind on the contracts list posted `POST /api/contracts` 200. A `CONTRACT-REMIND-EMAIL` row went `status=sent` on Resend with a provider id. That is transmit, not inbox proof. That row was **not** the test client. Do not treat it as a test-inbox landing.

**Inbound receivers that exist**
- Bland `POST /api/webhooks/bland` → 401 bad_signature (wired).
- PostGrid `POST /api/webhooks/postgrid` → 401 invalid_signature (wired).
- ClickFunnels and Commas same shape (wired). `webhook_captures` has 418 ClickFunnels rows, last today. `w6/hooks-probe.json`.

**Reconcile that matches**
- Pipeline: screen 17 cards. `cards` table 17 live non-demo on sales. Header “$50,000 est.” is the one card on Decision Rendered with `total_funding_estimate=50000`. Other stages show $0 because those cards have no estimate stored. `w6/07-pipeline.png`. `w6/db2.json`.

### BROKEN

No item below is lost-in-merge.

1. **Issue Inquiry Removal does not schedule a bureau call** — built-wrong. `COMPLIANCE REVIEW REQUIRED`
   - Expected: a POST to `inquiry-removal-ai-sigma.vercel.app/api/schedule-call` leaves, and we can report the payload and response (stop before a live bureau call).
   - Observed: the button only creates a local Queued case. `GET /api/inquiry?action=cases` → 503 `not_configured` / “Inquiry phone runtime is not configured.” Zero hits to the vercel host. `INQUIRY_API_BASE` is not in local `.env`.
   - Evidence: `w6/01-issue-ir.png`. `w6/fire.json` `inquiry-proxy-get`.

2. **Specialist Send does not fire** — built-wrong. Same class as W1. `COMPLIANCE REVIEW REQUIRED`
   - Expected: Send on a test case actually fires (mail/portal or schedule).
   - Observed: case opens. Mail letter (PostGrid) is checked by default. Clicking Send changed the button to **“VIEW IS NOT DEFINED.”** No `/api/inquiry-cases` send write. No PostGrid letter. No vercel call. Work queue still “Loading inquiry queue…”.
   - Evidence: `w6/01-inquiry-send2.png`. `w6/01-inquiry-desk.png`.

3. **Messaging Send cannot reach the test client** — built-wrong
   - Expected: Send on the test client queues or transmits.
   - Observed: test client has email `client@fundhub.ai` and no phone. Screen: “Not sent. We do not have a phone number or email address for this person.” `POST /api/messages` 200 wrote a failed SMS (`the client has no phone to send to`). No conversation row. Compose stays “Pick a conversation first.”
   - Evidence: `w6/01-messaging-send.png`.

4. **Cannot prove an email or SMS landed** — built-wrong / unproven inbox
   - Expected: a message arrives in the `.env` test inbox and on the `.env` test phone. A vendor row is not delivery.
   - Observed: **MISSING destination** — local `.env` has no test inbox or test phone (only send-from / API keys). Did not text a real person. 237 templates in `message_templates`. 32 still contain “lorem ipsum” (all `BS-EMAIL-*`, `BS-FUND-*`, `BS-REPAIR-*`). Did not send one from every category: no safe destination. Outbox is not sitting uncleared (0 queued; 6 sent today). Dispatcher sweeper **is** registered in code; `outbound_enabled=true`. That does not prove an inbox.
   - Evidence: `w6/db2.json` `templates_lorem`. `w6/01-outbox-before.png`.

5. **Void on the unused test draft fails** — built-wrong
   - Expected: Void on draft `8988b582-…` (never sent) voids the row.
   - Observed: Void button was not shown on that row. Same API the button calls (`POST /api/contracts` `{action:void}`) returned 500 `write_failed`. Row still `draft`.
   - Evidence: `w6/01-documents-contracts.png`. `w6/follow.json`.

6. **Payment link does not generate** — built-wrong
   - Expected: a checkout link for the $32 diagnostic (Stripe test mode if that is the rail).
   - Observed: no `STRIPE_*` in `.env`. The live API is Commas/Fanbasis, not Stripe. `GET /api/payment-links?client_id=` test client → 200, 0 items. `POST` create $32 diagnostic → 503 `commas_not_configured`. No charge. No write-back. Older payment_links exist for other files (not opened).
   - Evidence: `w6/fire.json` `money-create`. Portal pay tab: “No payments yet.” `w6/03-portal-tab-pay.png`.

7. **Oxylabs proxy is not live** — built-wrong / not configured
   - Expected: CRM can reach the proxy launcher and see what it returns. Do not submit a bank app.
   - Observed: `POST /api/proxy/launch` with the test client → 400 `lender_id or application_id is required`. With a dummy lender id → 503 `oxylabs_credentials_missing`. `proxy_sessions` count 0. Route exists. Credentials do not.
   - Evidence: `w6/follow.json` `oxylabs-launch2`. `w6/hooks-probe.json`.

8. **Client welcome video still missing** — built-wrong (same as W4)
   - Expected: a welcome video at the top.
   - Observed: as the real test-client session: “Welcome video is not available.”
   - Evidence: `w6/03-portal-home.png`.

9. **Products tile still says “3 with variable pricing”** — built-wrong (same as W3)
   - Screen: PRODUCTS 5, subtext “3 with variable pricing.” Table: Diagnostic FIXED; four VARIABLE. DB `products.price_is_variable`: 1 false, 4 true. The tile copy is hardcoded. The table matches the database. The tile is wrong.
   - Evidence: `w6/07-products.png`. `w6/db2.json` `products`.

10. **Sales Floor still says 0 closers** — built-wrong (same as W2)
    - Screen: “0 CLOSERS ON SHIFT.” No closer scroller. DB `staff`: 23 people. Closers: 1 `status=active` whose name starts with “test” (page hides those), plus 4 suspended. The only active closer is hidden on purpose. The control never appears.
    - Evidence: `w6/07-sales-floor.png`. `w6/db2.json` `closers`.

11. **Ops People still says no staff** — built-wrong (same as W3)
    - Screen People tab: “No staff rows” on Staff & Comp and on Monitoring consent. Staff & Teams on the same login: headcount 0, footer “23 people are hidden (owner and seeded test logins).” `staff` table count 23. Ops People does not say they are hidden. The staff read is empty here; the other screen tells the truth.
    - Evidence: `w6/07-ops-people-tab.png`. `w6/07-staff-teams.png`.

12. **GHL inbound is not wired** — built-wrong
    - Expected: GHL can post back to the platform.
    - Observed: `POST /api/webhooks/ghl` → 404 `unknown provider: ghl`. No GHL rows in `webhook_captures`. Owner already canceled GHL; `ghl_relay` send is a no-op. There is no inbound GHL door.
    - Evidence: `w6/hooks-probe.json`.

13. **Plaid inbound is not wired** — built-wrong / empty seam
    - Expected: Plaid can post back.
    - Observed: `POST /api/webhooks/plaid` → 404 `unknown provider: plaid`. `plaid_items` 0. No Plaid webhook in the router. Banking surface already 403 “requires plaid configuration” (W3/W5).
    - Evidence: `w6/hooks-probe.json`. `w6/db2.json` `plaid`.

14. **Bland and PostGrid have never been received** — built-wrong as “live callbacks”
    - Receivers exist (401 on a forged POST — not replayed). `webhook_captures` has no bland or postgrid provider. `outbound_calls` 0. Inquiry cases: 0 letters with a provider id, 0 `first_delivery_at`.
    - Evidence: `w6/hooks-probe.json`. `w6/db2.json` `webhooks` / `outbound_calls`.

### MISSING

**Missing destination (do not invent one)**
- The prompt’s `[YOUR TEST INBOX]` / `[YOUR TEST PHONE]` are not in local `.env`. Did not send to a real person. Inbox and SMS landing stay unproven.

**Missing ground truth**
- No intended journey names Generate Apps, Issue Inquiry Removal, Outbox send/pause, Void/Remind, Pipeline Archive/MOVE, Lender Import now, Hire/reject, Agent Editor Save, payment-link create, Oxylabs Apply, or inbound GHL/Bland/PostGrid/Plaid. Do not invent those steps.

**Missing product**
- Hire / reject: Hiring drawer is read-only (“Nothing in this panel can be changed”). Three demo candidates sit in `candidates`. No hire/reject write API under `api/hiring/` (reads only). Did not reject anyone. `w6/01-hiring.png`.
- Pipeline Archive / MOVE: test client has **no** `cards` row. The 17 board cards are real non-demo files. Withheld so a real person is not moved or deleted. `w6/01-pipeline-board.png`.
- Stripe test mode: not the payment rail. Commas checkout base is unset, so no link to charge.
- Client portal checkout: “Online checkout is not available yet.” Talk-to-advisor only. `w6/03-portal-tab-pay.png`.

### W6 stop

No app, test, config, env, or intended-journey edits. No deploy. No gmail credit file. No bureau call. No dispute sign. No real card charge. No real applicant rejected. Setter Josh / Inquiry Removal AI prompts were not saved. Outbound switch left on. One unused test draft was not voided (API 500). One contract Remind left a sent email on a non-test file — transmit only.

## W-layout findings

Walked 2026-08-18 on `https://fundhub.ai` as `chris@fundhub.ai`.
Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w-layout/`.
Log: `w-layout/measure.json`.
Shots of the four named pages at 1440, 2560, and 390.

Ground truth for width is `docs/UI-STANDARDS.md` §1: content column **1800px, centered**. Token `--fh-maxw` in `public/app/fundhub-brand.css`. Side space should follow the 8px scale (§2): 8 / 16 / 24 / 32 / 48 / 64. Phone width is 390 (§11). Left menu geometry is shared: 228px rail, content cleared by `padding-left: 228px` (`crm-sidebar.css`).

No app, test, config, or intended-journey edits.

### Majority

31 CRM nav screens. Present counted separately.

| What | Majority value | Count |
| Widest the page will go | **1800px** | 18 of 31 |
| Side pad on the measured wrap | **24px / 24px** | 14 of 31 |
| Side pad on the thing you read | **24px** | about 20 of 31 |
| Left menu | **yes, 228px** | 29 of 31 |

Outliers from 1800: Sales Floor 1280, My Numbers 1240, Client Portal 780, plus 9 screens with no cap (they fill whatever is left beside the menu).

### The four you named

Live owner. Numbers are what the page **sets**, then what it **painted**.

**Staff & Teams** — looks full-bleed
- Sets: wrap `.content.fh-maxw` → max-width **1800px**, pad **24px / 24px**. Left menu yes.
- Top bar is **outside** that box. It spans the whole leftover column.
- 1440: leftover column is 1212px, so the 1800 cap never starts. Painted width 1212. Looks wall-to-wall. `staff-teams-1440.png`
- 2560: painted width 1800, starts at x=494. Cap is on. Header still goes wider than the cards. `staff-teams-2560.png`
- 390: menu hidden off-canvas. Pad stays 24px. `staff-teams-390.png`

**Pipeline** — boxed
- Sets: wrap `.shell.fh-maxw` → max-width **1800px**, pad **0 / 0**. Filter bar pad **14px**. Left menu yes.
- Top bar **is** inside the 1800 box.
- 1440: painted width 1212 (cap unused). Board columns do not stretch, so gray sits on the right. `pipeline-1440.png`
- 2560: painted width 1800, starts at x=494. `pipeline-2560.png`

**Sales Floor** — narrow centered
- Sets: wrap `.shell` → max-width **1280px** (hardcoded, not the 1800 token), pad **22px / 22px**. Left menu yes.
- Header is outside the 1280 box (same trick as Staff).
- 1440: leftover is 1212, so 1280 does not shrink it. Painted width 1212. `sales-floor-1440.png`
- 2560: painted width 1280, starts at x=754. Big empty sides. `sales-floor-2560.png`
- 22px is not on the 8px scale (§2).

**Client Control Panel** — boxed, different gutter
- Sets: wrap `.shell.fh-maxw` → max-width **1800px**, pad **0 / 0**. Left menu yes.
- Inside: record head **18px**; main column **16px**; right column **14px**.
- 1440: painted width 1212. `client-control-panel-1440.png`
- 2560: painted width 1800, starts at x=494. Same outer box as Pipeline. Tighter inner pad. `client-control-panel-2560.png`
- 18px and 14px are not on the 8px scale (§2).

### All 31 nav screens + Present

Owner, live. “Painted @2560” is the wrap width when the window is 2560px (menu 228px, leftover 2332px). That is when the cap shows.

| Screen | Max width set | Side pad set | Left menu | Painted @2560 |
| Home | none | 0 | yes 228 | 2332 (fills leftover) |
| Pipeline | 1800 | 0 (filter 14) | yes 228 | 1800 |
| Closer Dashboard | none | 0 (main 24) | yes 228 | 2332 |
| Call cockpit | none | 0 (main 28) | yes 228 | 2332 |
| My numbers | **1240** | **22** | yes 228 | 1240 |
| Sales floor | **1280** | **22** | yes 228 | 1280 |
| Calendar | none | 0 (subhead 16) | yes 228 | 2332 |
| Lenders | 1800 | 24 | yes 228 | 1589 |
| Finance OS | 1800 (`#fosWrap`) | 0 on wrap (content 24) | yes 228 | 1800 |
| Client Control Panel | 1800 | 0 (inside 16 / 14) | yes 228 | 1800 |
| Messaging | 1800 | 0 (full three columns) | yes 228 | 1800 |
| Documents | 1800 | 24 | yes 228 | 1800 |
| Specialist | none | 0 (main 24) | yes 228 | 2332 |
| Company Brain | none | message pane 24 | yes 228 | full leftover (no wrap) |
| Galaxy | none | 0 | yes 228 | 2332 |
| Ops & Admin | none on shell (zones 1800) | 0 (main 24) | yes 228 | 2332 |
| Agent Editor | 1800 | 24 | yes 228 | 991 (list column) |
| Workflows | 1800 | 0 (main 24) | yes 228 | 1800 |
| Journeys | 1800 | 0 (canvas 24) | yes 228 | 1800 |
| Message Copy | 1800 | 24 | yes 228 | 1394 |
| Campaigns | 1800 | 24 | yes 228 | 1598 |
| Social Studio | 1800 | 24 (16 on phone) | yes 228 | 1800 |
| Creative Factory | 1800 | 24 | yes 228 | 1800 |
| Staff & Teams | 1800 | 24 | yes 228 | 1800 |
| Hiring | 1800 | 24 | yes 228 | 1800 |
| Products & Commissions | 1800 | 24 | yes 228 | 1800 |
| Contract templates | **none** | 24 | yes 228 | 2332 |
| Brand Studio | 1800 | 24 | yes 228 | 1420 |
| Client Portal | **780** | 24 | **no** | 780 |
| Affiliate | 1800 | 24 | yes 228 | 1800 |
| Present | none | slide pad (fluid) | **no** | full window |

### Findings vs the house rule

| Screen | Role | Standard | Expected | Observed | Evidence | Severity |
| Staff & Teams | owner | §1 1800 centered, chrome with content | One box. Header lines up with cards. | Header is full leftover. Cards cap at 1800. On 1440 it reads full-bleed. | `w-layout/staff-teams-1440.png` `w-layout/staff-teams-2560.png` | MEDIUM |
| Pipeline | owner | §1 + §2 8px scale | 1800 box, pad 16 or 24 | 1800 box, pad 0 / filter 14 | `w-layout/pipeline-1440.png` `w-layout/pipeline-2560.png` | MEDIUM |
| Sales Floor | owner | §1 1800 | 1800 centered | 1280 + 22px pad | `w-layout/sales-floor-2560.png` | MEDIUM |
| Client Control Panel | owner | §1 + §2 | 1800 + 16 or 24 | 1800 + 16 / 14 / 18 | `w-layout/client-control-panel-2560.png` | MEDIUM |
| My numbers | owner | §1 | 1800 | 1240 + 22px | `w-layout/measure.json` | MEDIUM |
| Contract templates + 8 no-cap screens | owner | §1 no full-bleed dashboards | 1800 | fill leftover (2332 at 2560) | `w-layout/measure.json` | MEDIUM |
| Documents / Campaigns | owner | §11 no sideways page scroll | 390 fits | wrap painted 1484 and 1449 at 390 | `w-layout/measure.json` | HIGH |
| Client Portal | owner | §1 | OPEN-QUESTION | 780, no left menu. May be on purpose for reading. | `w-layout/measure.json` | OPEN-QUESTION |

### Phone (390)

Menu is off-canvas (content pad-left goes to 0). That matches §11. Staff / Pipeline / Sales Floor / CCP do not keep a 228 strip of icons on the page. Shots: `*-390.png`.

Documents and Campaigns still paint wider than 390. That is a sideways scroll.

### W-layout stop

No app, test, config, env, or intended-journey edits. No deploy. No writes. W1–W6 lists were not rewritten.

## W14 findings

Git history only. [W14 Finance OS](ac365827-fe4c-420b-92ac-0545d64563f1). Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w14/`.

**Answer:** The old Finance OS is still in git. Checking it out would restore a **client credit desk**, not Chris’s company Plaid screen. No version in git ever had a Connect-bank button. The spec still has to be built.

| What | Fact |
|---|---|
| Last full page | `75ba39a` (2026-08-17 22:12). One client’s money file. Soft pull, type-in accounts, deal math, Ask it. |
| What replaced it | `0f51860` (2026-08-17 22:19). Cut 712 lines. Empty “Company money” buckets. |
| Today’s file | `8e89fa5` (nav only). Same empty page. |
| Plaid connect, any version | Never. |
| Subscriptions then | Separate **client billing** page. Deleted `58adb8a`. Not company charges inside Finance OS. |
| Spec match | No. Old = client file. Current = company words, still reads `client_id`. No bank link. |

Look without changing the tree: `git show 75ba39afd9eaf76db2ad66060b5e6c1c6c00135d:public/app/finance-os.html`

### W14 stop

No app, test, config, env, or intended-journey edits. No deploy. No checkout.

## W11 findings

Live database, read-only. [W11 Supabase](2cec5f0e-26c5-4699-926a-55a8cfa50d28). Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w11/`.

**Answer:** The live site already logs in as `fundhub_app`, not a superuser. Migrations **170 and 171 landed Aug 17** and the new columns and tables are real. Six credit-dispute tables are locked with no key (the app sees nothing). Almost all client-data tables have a lock that allows every row. No child points at a missing parent. No fully dead table.

| Check | Result |
|---|---|
| 170 `call_outcomes.checklist` | Applied 2026-08-17 22:14:41 UTC. Column exists. All 6 call rows empty. Save writes the boxes into notes, not this column. |
| 171 videos + display price | Applied 2026-08-17 22:14:42 UTC. Tables exist. 0 videos. 0 prices filled. |
| Migrations on disk vs applied | All files landed. Through 176 (176 on Aug 18). Nothing sitting unapplied. |
| Orphans | 0 broken parent links. 18 bank money rows have no client and no bank account (never linked). |
| Dead tables | None with zero reads and zero writes. 11 unused by the running app (tests/migrations still name them). |
| PII + row lock | Every public table has the lock **on**. 147 use “allow all.” A stolen app password sees every client row. |
| Credit-dispute tables | 6 tables locked with **no key**. App count is 0. Built-wrong (lock on, no door). |

### W11 stop

No app, test, config, env, or intended-journey edits. No deploy.

## W13 findings

Live Agent Editor + live database. [W13 Agents](7808fbad-1670-4d75-9d58-12900aa3a108). Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13/`.

**Answer:** The two LIVE agents **cannot** text, call, or charge anyone today. They are a green badge that tells a lie.

| Fact | Proof |
|---|---|
| Who is live | Setter Josh (`AG-04`) and Inquiry Removal AI (`AG-09`). Empty prompt. No trigger. 0 runs. Seeded live on purpose. |
| Can they fire now | No. Runtime is Bland (blocked). Channel is voice (reply robot only does text/email). Empty prompt cannot be picked. |
| Phone path | None on this site. No Bland dialer. Inquiry phone runtime unset. Outbound call rows: 0. |
| All 22 ever ran | Nobody. 0 shadow-log rows. 0 messages sent as an agent. |
| Screen lie besides LIVE | Screen says 20 draft. Database: 12 draft + **8 retired** GoHighLevel agents (owner canceled GHL). Screen paints retired as draft. |
| Later risk, not these two | Model key is on. Outbound is on. A *different* messaging agent with a real prompt could text later. None of the 22 can today. |

### W13 stop

No app, test, config, env, or intended-journey edits. No deploy.

## W15 findings

Read-only on GoHighLevel and the platform. [W15 GHL](1b876ead-f0b1-4891-9e22-5bc8d612d82d). Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w15/`.

**Answer:** GoHighLevel is a leftover box. It is not driving the live site. Live GHL list APIs all said **401**, so every GHL workflow, field, pipeline, and A2P status is **UNVERIFIED**.

| Check | Result |
|---|---|
| Who sends texts / mail now | Twilio and Resend. Old GHL text sender is a dead stub. |
| GHL → platform | `POST /api/webhooks/ghl` → **404**. Capture table: 0 GHL rows (418 ClickFunnels). |
| Platform → GHL | Nothing lands. Field writes stay local. 28 of 38 clients still have an old GHL id. |
| Workflows on GHL | List refused (401). Will not invent the 140-name list. Code comments still name 18 old GHL ids. On/off UNVERIFIED. |
| A2P 10DLC | UNVERIFIED. Last written note: brand + campaign submitted 2026-08-14. Not proven approved. |
| C-03 on GHL | Not found. No GHL id. String `inquiry_removal_complete` is not in this repo. Platform C-03 exists; it has never run live (`inquiry.removed` count 0). |
| Pipelines | Live GHL boards refused. Platform boards exist. Cannot match them. |
| Fires we never hear | If GHL still runs anything, we do not hear it. Old GHL catch-doors still answer “send a body.” I did not POST. |

### W15 stop

No changes on either side. W12 still running.

## W10 findings

Signature trigger chain. Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w10/`.
`FUNDHUB_TEST_INBOX` and `FUNDHUB_TEST_PHONE` set in local `.env` (names only). Inbox file is client `9af65808-…` — **read only**. Test file is `8556bedc-…`.

**COMPLIANCE REVIEW REQUIRED** — soft-pull consent and dispute-letter authorization.

Two live signatures today. Nothing else was signed. Twilio A2P is still pending — SMS fail is expected.

No W10 before shots. After shots: `w10/after-*.png`. Prior before for the test control panel: `w1/04-ccp-before-pull.png`. Prior sign screen: `w1/01b-contract-after.png`.

Intended journeys (`docs/journeys/*-intended.md`) do **not** name what a signature should unlock. That chain is **MISSING ground truth**. Do not invent one. Below is what the **code** listens for, vs what the live rows did.

No walk called a break lost-in-merge. Every break below is **built-wrong**.

### WORKS

- Both signatures wrote `events` row `contract.signed`. Payload is ids + template key + status only. No body. No secrets.
  - Soft-pull consent `16b29639-…` on test file `8556bedc-…` at 16:12:37Z. Event `13313d55-…`.
  - Funding agreement `e2bd8fba-…` on inbox file `9af65808-…` at 16:55:17Z. Event `99d08e51-…`. Read only.
- Each sign built a signed PDF and marked the sent copy SIGNED. Documents after: 7 rows, two SIGNED, two generated copies NOT SENT. `w10/after-documents.png` `w10/chains.json`.
- Portal on the test file shows 1 agreement on file and 2 documents. `w10/after-portal-test.png`.
- Inbox keys named above are set locally. Not committed.

### BROKEN

1. **`contract.signed` fired. Nothing listened.**
   - Journey: `client` / `role-owner` / `role-funding-advisor` — no signature-unlock step. **MISSING ground truth.**
   - Expected (code): a handler or workflow reacts. `src/events/canonical.mjs` says no handler on purpose. `src/register-all.mjs` registers none. No Inngest function listens.
   - Observed: after each sign, the only new event on that client is `contract.signed`. No stage move. No new task. No follow-up email or SMS. No GHL write. Client `updated_at` did not change.
   - Link class: **fired but nothing listened.** Built-wrong (never wired).
   - Evidence: `w10/followup.json` `w10/chains.json`.

2. **Soft-pull consent contract signed. Soft pull still locked.**
   - Journey: no step. **MISSING.**
   - Expected (code): pull gate reads `client_consents`, not `contracts`. `captureConsent` is a separate POST. `sign()` never writes a consent row.
   - Observed: 0 consent rows on the test file. 0 soft-pull requests after the sign. Scores still empty. Portal still `0 unlocked · 6 locked`. Same refuse W1 already saw.
   - Link class: **fired but nothing listened** (event) **and** the sign path never writes the table the gate reads. Built-wrong.
   - Evidence: `w10/after-ccp-test.png` `w10/after-portal-test.png` `w1/04-soft-pull-after.png`.

3. **Funding agreement signed. Pipeline did not move.**
   - Inbox file card is still `sales` / `decision_rendered` (entered 2026-08-16). Control panel still says Diagnostic paid. Next action still “Awaiting CRS” plus the old UnderwriteIQ tasks. No new task. Remind email at 16:54:53Z was **before** the 16:55:17Z sign — a chase, not a trigger.
   - Link class: **fired but nothing listened.** Built-wrong.
   - Evidence: `w10/after-ccp-protected.png` `w10/after-pipeline.png` `w10/discover.json`.

4. **Signed copy is generated and not sent.**
   - Documents: “(signed)” rows show NOT SENT / signature N/A. `delivery_status=not_delivered`.
   - Link class: listener-less complete path. Built-wrong.

5. **Diagnostic payment events cannot find the client.**
   - Live `diagnostic.paid` / `payment.received` rows have `client_id` null and no email in the payload. `resolveClient` then returns null. Handlers no-op.
   - The inbox file already shows Diagnostic paid / $50k / scores from the Aug 14–16 prove — not from a clean landing today. Do not treat that as today’s unlock.
   - Link class: **fired but the listener could not resolve a client.** Built-wrong.
   - Evidence: `w10/discover.json` payment_events.

### MISSING

- **Dispute-letter authorization was never signed.** 0 `dispute_authorization` consent rows ever. Portal card still open. Welcome video still missing. `w10/after-portal-test.png`. W6 left it unsigned. W10 did not press Sign.
- **Unsigned leftovers on the inbox file (read only):** `f59d6197-…` SOFT-PULL-CONSENT sent, never viewed. `b1503fd1-…` FUNDING-AGREEMENT sent, never viewed. `0a3b154e-…` SOFT-PULL-CONSENT viewed Aug 17, not signed.
- **Intended journey for “signature unlocks X”** — not written. Same for diagnostic-payment unlocks and inquiry-complete → advisor next round.
- **Inquiry removal completing — UNVERIFIED.** `inquiry.removed` has never been written. Test file has 3 Queued cases from W1/W6. None cleared. Code that *would* listen: Inngest `c-03-inquiry-removed-resume-or-hold` (task “Start next funding round — clean file”, tag `inquiry:completed`, `ready_for_next_round`). No bus handler in `register-all.mjs`. If Inngest is on, C-03 still never ran because the event never fired. Link class: **event never fired.**
- **Diagnostic payment landing today — UNVERIFIED.** Did not fake a payment. Code that *would* listen: `onDiagnosticPaid` (stamp `crs_paid`, move card to `diagnostic_paid`), `onDiagnosticPaidSoftPull` / C-00 (consent-gated pull), `onDiagnosticPaidMoney` (sale row), `af-02`. Live rows cannot attach a client (see BROKEN 5).
- **SMS after a signature.** Not attempted by this chain. A later Twilio send on the test file failed. Expected: A2P pending. Not a surprise product bug beyond that.

### Per-document chain

**SOFT-PULL-CONSENT `16b29639-…` (test file)**
1. What fired: `events.contract.signed` `13313d55-…`. Payload: contract/client/document ids, `SOFT-PULL-CONSENT`, status signed. Nobody listened. Sign also wrote a signed PDF `f13993df-…`.
2. Downstream: stage no (no card). Task no. Email/SMS no. Screen unlock no (0/6 entitlements). Pull buttons still on the desk; pull still has no consent row. GHL no.
3. Should have, per code not journeys: write `client_consents` so the pull gate opens. Did not.

**FUNDING-AGREEMENT `e2bd8fba-…` (inbox file, read only)**
1. What fired: `events.contract.signed` `99d08e51-…`. Same empty listener list. Signed PDF `5dfb4bde-…`.
2. Downstream: stage still `decision_rendered`. Tasks still the Aug 16 UnderwriteIQ rows. No new mail after the sign. GHL no. Control panel still Diagnostic paid. `w10/after-ccp-protected.png`.
3. Should have, per journeys: not named. Per code: nothing is registered.

**Dispute-letter authorization**
Never signed. Capture path is `POST /api/consent/capture` (`captureConsent`), not `contract.signed`. Letters stay gated on `hasDisputeAuthorization`. Event never fired.

### W10 stop

No app, test, config, or intended-journey edits. No deploy. `.env` only: `FUNDHUB_TEST_INBOX` and `FUNDHUB_TEST_PHONE` (replaced/appended; rest of file left alone). No writes to client `9af65808-…`. W1–W6 / merged Findings were not rewritten.

## W16 findings

Payment → event → unlock. [W16 payment unlock](5c649aac-111e-4f4e-8cd2-8b7910cd72e1). Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w16/`.

**COMPLIANCE REVIEW REQUIRED** — dispute letters, credit-repair copy, fees, payments, consent, credit-pull type.

**MISSING ground truth.** Intended journeys do not name payment → unlock. Scored Chris’s W16 claim.

**Answer:** All six portal tiles stay locked. Money can land. Nothing opens.

Events were simulated on the TEST file only. No card charge. No payment-settings change. Inngest not sent. This file has **0 payment links**. The map that turns a product into a tile (`product_entitlements`) has **0 rows**. Held 0 before and after.

| Offer | Where it dies | Break type | What the client would see |
|---|---|---|---|
| $32 soft pull | Unlock | Listened but unlock has nothing to show | No score, inquiries, or tradelines on the client page. Live pay title never fires `diagnostic.paid`. |
| $3,000 funding DFY | Unlock | Listened but unlock has nothing to show | Stepper text only. No applications. No results. Live title never fires `deposit.paid`. |
| $1,000 repair DFY | Unlock | Listened but unlock has nothing to show | Sign box only. No letters, sent log, bureau replies, or round. |
| $200 repair test | Unlock | Listened but unlock has nothing to show | Same lock as $1,000. No $200 product. No one-round screen. |
| $1,000+ deliverables | Unlock | Listened but unlock has nothing to show | Download buttons do nothing. No mini course. |
| $5,000 Funding Mastery | Unlock | Listened but unlock has nothing to show | Tile has no unlock code. No course player in the app. |

Close path (all six): outcome save only writes a note. Contract send and pay link are separate buttons. `contract.signed` has **zero** listeners. Live checkout titles do not match the four old Commas names, so `diagnostic.paid` / `deposit.paid` / `sale.closed` never fire from a real closer link.

### W16 stop

No app, test, config, env, or intended-journey edits. No deploy. Test-file event/sale rows left in place (ids in `w16/REPORT.md`).

## W13R findings

Agent Editor vs Bland. [W13R Agent Editor](1f899633-973c-4e32-a03f-c3367788f132). Evidence: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/`.

**MISSING ground truth.** No intended journey names Agent Editor. Scored Chris’s claim: Editor should steer Bland the way Workflows shows the engine. **It does not.**

**Answer:** Not the same place. Save writes the `agents` table. Bland never reads it. Live calls get their script from vendor JS files, sent as a one-time `task` on each call.

Bland is the phone-robot company that places the calls.

| Fact | Proof |
|---|---|
| Editor Save | Writes `agents.prompt` / `guardrails` via `POST /api/agents`. W6 Save on AG-01 moved `updated_at` today. Not “Save does nothing.” |
| Bland reads | `vendor/inquiry-remover` prompt files. This site’s Bland adapter **listens only**. Does not start a call. Does not read the table. |
| Bland dashboard | 0 saved pathways. 0 saved Bland agents. The script is not stored there. |
| Two LIVE empty rows | AG-04 Josh, AG-09 Inquiry. 0 prompt chars. Those **rows** cannot fire on the Bland path. A vendor/local send still uses the **file** script, not the empty tile. |
| This site start a call | No. `INQUIRY_API_BASE` unset. `src/` has no dialer. Last Bland call on this key: 2026-08-16. |

### W13R stop

No app, test, config, env, or intended-journey edits. No deploy. Did not Save. Did not start a call.
