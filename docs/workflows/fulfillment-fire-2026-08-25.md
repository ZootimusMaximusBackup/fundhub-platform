# Fulfillment fire — Funding + Repair — 2026-08-25 night

**Honest first:** Prior horsemen / beta did **not** fully walk this. This is the first live fulfillment fire for credit repair and funding: staff desk motion, mint-only invoices, AI call, AI doc chase, FTC / upload doors.

**Door:** verify only. No fixes.  
**Who clicked:** the agent. Chris was not asked to open a page, check mail, or take the call.  
**People:** reused horsemen plus-tags (not new funnel people).  
- Funding: **Sim Fund Horse** `614927f7-95a9-4623-86e8-cd85420d9716` · `stanbridgejchris+sim-fund-20260825h@gmail.com` · `+16616054248`  
- Repair: **Sim Repair Horse** `5ce80871-0b70-4d2d-89e0-efdd62aa2e2f` · `stanbridgejchris+sim-repair-20260825h@gmail.com` · `+16616054248`  
**COMPLIANCE REVIEW REQUIRED** — consent, fee timing, payment rails, repair enroll.

**Hard stops kept:** no live credit pull. No card charge. No $1 re-pay. No PostGrid. No personal prove phone. No ClickFunnels nag.

**How this was proved:** signed in as `chris@fundhub.ai` on `https://fundhub.ai`. Clicked Pipeline, Client Control Panel, Documents, Lenders (Apply), Specialist, staff Client Portal. Live APIs minted pay links and placed the Bland call. Gmail searched **anywhere**. SMS proved on the agent number. Bland lookup: call **completed** to `+16616054248`.

**Evidence:** `docs/workflows/fulfillment-fire-2026-08-25-evidence/` (`VERDICT.json`, `followup.json`, `click-desks.json`, `portal-doors.json`). Marked shots: `shots/*-MARKED.png`.

---

## Score (this pass)

| Result | Count |
|---|---|
| **PASS** | 13 |
| **FAIL** | 4 |
| **not-live** | 2 |

---

## The answers Chris asked for

| Question | Answer |
|---|---|
| Had we run this before? | **No.** Horsemen proved welcome / pay-link mail and sample credit. They did not walk fulfillment desks, the AI phone call, doc chase, or upload doors. |
| Did the AI call the agent phone? | **Yes.** Setter Josh (`AG-04`, Bland) placed call `32c76f04-9d7c-4f5f-b9aa-fa7ce02c54bd`. Bland says **completed**. Dialed **`+16616054248`**. |
| Did uploads land? | **Yes.** Funding file now has **7** docs. Repair file has **9**. Includes bank statement, FTC report, bureau response, and portal uploads. |
| Extra SMS? | **Yes.** 23 new texts hit the agent number in about one minute. Intended chases and pay-link texts left. Extra: a burst of “got your upload — one thing needs fixing” after the sim pack, plus invoice billing texts. All to the agent number, not a real customer. |

---

## Scorecard

| # | Step | Result | What happened |
|---|---|---|---|
| 1 | Funding staff queue | **PASS** | Pipeline search found **Sim Fund Horse**. Phone and plus-tag match the file. Card is in Survey Complete. |
| 2 | Funding next action → docs | **PASS** | Client Control Panel next action is **Remove Inquiries**. Blockers: document hold + unpaid **$100**. 22 messages on the file. Scores 718 / 724 / 731. |
| 3 | Repair staff queue → next action | **PASS** | Client Control Panel next action is **Remove Inquiries**. Blockers: sim FTC held for a person, unpaid **$200**, no written permission. Scores 630 / 636. Specialist Repair desk lists Sim Repair Horse (trial, needs agreement, no address). |
| 4 | Lenders Apply | **PASS** | Lenders desk live. Banner scoped to Funding Horse. **307** lenders. Apply clicked. Did not finish an outside bank form. |
| 5 | Documents screen shows the uploads | **FAIL** | The Documents class list (authorizations / contracts / invoices / reports) does **not** show client uploads. Filter “Sim Repair Horse” said **Nothing matches**. The files are on the person (API + Control Panel blockers). Staff cannot see them on this screen. |
| 6 | Mint / send pay links (do not pay) | **PASS** | Funding $3,000 and Repair $1,000 links minted and sent. Email **sent**. SMS **sent**. Gmail has both. Card not charged. |
| 7 | Staff “create invoice” purpose | **FAIL** | `purpose: invoice` is refused. Allowed words are deposit / diagnostic / repair / custom. |
| 8 | Invoices emailed, not paid | **PASS** | Funding got invoice **$100** (success fee). Repair got invoice **$200** (repair bundle). Both **sent**. Gmail has both. Neither paid. |
| 9 | AI agent outbound call | **PASS** | `AG-04` Setter Josh ready, then placed. Bland **completed** to `+16616054248`. Attributed to Sim Fund Horse. |
| 10 | AI / staff doc follow-up email | **PASS** | “We still need a few documents” left for both people. Gmail anywhere: 2 hits. |
| 11 | AI / staff doc follow-up SMS | **PASS** | Same chase accepted by Twilio (`SM142e…` Funding, `SM7b86…` Repair), **delivered**. Night quiet hours did **not** hold these `+sim-` files. |
| 12 | Workflow chase after upload | **PASS** | After the sim pack, live mail said “Please retake your bureau letter photo.” Texts said the upload needs fixing, and “we need a few documents.” That is the chase engine firing. |
| 13 | Uploads land on the file | **PASS** | Funding 7 docs. Repair 9 docs. Kinds include `bank_statement`, `ftc_report`, `bureau_response`, `additional_fraud_docs`. Portal upload ids are in the list. |
| 14 | Repair portal bureau door | **PASS** | After trial enroll, Repair has **metro2-letter-pack**. Portal body hides funding + inquiry doors and **shows** “Upload your bureau response.” Welcome says Sim Repair Horse. |
| 15 | Funding portal upload doors | **FAIL** | Funding has **0** unlocked entitlements. Portal hides the upload doors. API upload still saved (staff / magic-link). Client cannot see a funding or inquiry door until a paid unlock. |
| 16 | Inquiry portal door | **FAIL** | Needs `credit-analysis-report` (or funding unlock). Neither horseman has it (no pull / no pay). Door stays hidden. Staff can still attach an FTC file from Specialist / upload API. |
| 17 | Specialist FTC upload control | **PASS** | Inquiry cases list includes both horses. “Upload FTC or police report” is on the open case. Clicked the control path; sim pack already on the file. Did not mail. Did not call a bureau. |
| 18 | Live CRS | **not-live** | Sandbox rule. No bureau pull. |
| 19 | Live PostGrid / pay the invoice | **not-live** | Forbidden this pass. |

---

## Quiet hours

It was after **11:00 p.m. Eastern**. Real-customer texts stay held. These `+sim-` files **did** leave. That matches PR 143.

---

## Extra SMS (yes)

New Twilio rows to `+16616054248` during this pass (accept is the bar):

- Pay-link texts ($3,000 funding, $1,000 repair)
- Doc-chase texts we sent
- Invoice billing text for the $100
- **Extra:** many “Got your upload — one thing needs fixing”
- **Extra:** “Before we can start, we need a few documents”
- Welcome leftovers also left (held from horsemen, now allowed for `+sim-`)

No loop onto a real customer phone. The agent number is both the send target and the inbox, so many rows show as received **and** delivered.

---

## File vs screen

| Thing | Stored | On screen |
|---|---|---|
| Sim Fund Horse name / phone | Sim Fund Horse · +16616054248 | Pipeline + Control Panel |
| Sim Repair Horse name | Sim Repair Horse | Control Panel + portal “Welcome back, Sim” |
| Funding next action | Remove Inquiries | Same |
| Repair next action | Remove Inquiries | Same |
| Funding invoice | $100 sent, unpaid | Blocker “USD 100.00” |
| Repair invoice | $200 sent, unpaid | Blocker “USD 200.00” |
| Repair unlock | metro2-letter-pack | Portal: 2 unlocked · bureau door on |
| Funding unlock | none | Portal: 0 unlocked · upload doors off |
| Docs on file | 7 / 9 | Control Panel sees the hold. Documents class list does not. |
| AI call | Bland completed to agent phone | Not a Fundhub screen |

---

## Worst FAILs (plain words)

1. **The Documents screen does not show the files we uploaded.** They are on the person. Staff looking at Documents see an empty filter.
2. **You cannot mint an invoice by typing purpose “invoice.”** Pay links work. A $100 / $200 invoice still appeared from enroll / success-fee, and those emails left.
3. **Funding and inquiry upload doors stay off until a paid unlock.** Repair bureau door turns on after trial enroll. Inquiry door still needs a credit-analysis report we did not buy (no pull).

---

## What I did not do (on purpose)

- No live credit pull. No card charge. No $1 re-pay. No paper mail.
- Did not finish an outside lender application.
- Did not sign a legal contract as the client.
- Did not call a bureau.
- Did not mint a new funnel person.

## Next

Stop. Do not fix in this pass. Name what you want fixed.
