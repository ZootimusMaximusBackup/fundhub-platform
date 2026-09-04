# What the UnderwriteIQ deliverables package SHOULD contain — Sim Five-Academy

Written 2026-09-03 for the live walkthrough. Read-only. Nothing was changed or committed.

**Client:** Sim Five-Academy · id `823c850e-deee-4022-bf80-27ec23f77915` · stanbridgejchris+sim-05@gmail.com
**File on record (simulated, profile `academy`):** scores Experian 762 / Equifax 770 / TransUnion 758 · 4 clean accounts · 0 inquiries · 0 negatives · business age 72 months (typed into the sim only)
**Tier stamped:** FULL_FUNDING · stored estimate 199,350

**How this was derived:** I ran the same engine and the same document builders the live site uses, on the same simulated file, with no database. Every number below is what the code produced. Where I could not see the live server, I say UNVERIFIED.

---

## 1. What the "Send deliverables package now" button does

The button is on the Present deck (`public/app/present.js`). It posts `action: generate_letters` to `/api/closer-deck`, which calls `generateDeckLetters` in `src/sales/closer-deck.mjs`.

**Is it gated on payment or entitlement? No.** The only checks are:

1. You are signed in as a closer, sales manager, owner, or admin.
2. The client belongs to your company.
3. The offer is known and allows letters (`UWIQ_DELIVERABLES` — "Capital Blueprint" — does).
4. It is not the paid funding route (`FUNDING_DFY` on a funding tier). With the education path on, this check always passes.

No invoice, no payment, no entitlement is checked. Anyone with a closer login can press it on any client, paid or not.

**What it does, in order:**

1. Builds the **repair** letter pack for the client (`buildLetterPackForClient(db, { clientId, pack: "repair" })`). Not the funding pack. Not the four analysis reports.
2. If the pack has files, saves them into the client's Documents list.
3. Sends one email, template `EMAIL-DS02-DIY-LETTERS-READY`. Subject: **"Your correction letters are ready."** Body says "Log into your client portal to view and download them" with the portal link. It sends this email whether or not any files were made.
4. Tags the client `client:diy-letters`.
5. Sets the client's `diy_status` to "Delivered" if there were files, or **"Delivery Failed — Retry"** if there were none.

**For THIS client the repair pack is empty (0 files).** Here is why, from the code:

* Dispute letters need a negative account. This file has none.
* Personal-info letters need a name, address, SSN, employer, or birth date on the bureau file. The simulated file has none of those (the sim writes empty lists).
* Repair summaries (Optimization Plan Summary, Issue Priority Sheet) are only made when the tier is REPAIR_ONLY. This tier is FULL_FUNDING.
* The four analysis reports are skipped on the repair pack (`deliverableSkip: "not_funding"`).

So the expected result of pressing the button on this client is:

| What | Expected |
|---|---|
| Files saved to the portal | **0** |
| Email to the client | 1 — "Your correction letters are ready" (sent anyway) |
| Toast the presenter sees | "Deliverables sent to client." and the button flips to "sent" (the screen only checks that the call did not error; it never reads `delivered`) |
| Client record | `diy_status = "Delivery Failed — Retry"`, tag `client:diy-letters`, `closer_deck_letters_offer = UWIQ_DELIVERABLES` |
| API answer | `delivered: false, letterCount: 0, engineSkip: null` |

---

## 2. Where the real package comes from

The four analysis reports (the things the offer promises) are built by the **funding** pack. Only one thing in the code builds the funding pack: the automatic workflow **C-06 CRS Results Router** (`src/workflows/c-06-crs-results-router.mjs`). It runs when the credit file lands (event `analysis.completed`), sees the funding tier, builds the pack, and saves it to the client's Documents list. **It sends no email.**

The sim push script fires that event, so C-06 should have run when the file was pushed. **UNVERIFIED:** I could not read the live database to confirm it ran and saved the files.

The funding pack for this client produces **5 files**. Only **4 are saved**:

| # | File | Saved to portal as | Saved? |
|---|---|---|---|
| 1 | Credit-Analysis-Report.pdf | "Credit Analysis Report" | Yes |
| 2 | Funding-Snapshot.pdf | "Funding Snapshot" | Yes |
| 3 | Bank-Lender-Match-List.pdf | "Bank and Lender Match List" | Yes |
| 4 | Credit-Optimization-Roadmap.pdf | "Credit Optimization Roadmap" | Yes |
| 5 | Capital-Readiness-Summary.pdf | — | **No.** The saver (`persistFundingLetterFiles`) only knows the four report types and the two letter types. This file is built, then dropped. |
| — | Inquiry-removal letters | — | None made. 0 inquiries on file. Correct. |
| — | Personal-info letters | — | None made. Sim file has no names/addresses/SSN. A real pull would make 3 (one per bureau). |
| — | Dispute letters | — | None. Clean file. Correct. |

The offer card in the deck lists 6 items: Credit Analysis Report, Dispute Letter Pack, Credit Optimization Roadmap, Funding Snapshot, Bank & Lender Match List, "How To Use This mini course." For this client the Dispute Letter Pack is correctly empty. The mini course is not part of the file package (portal entitlement, not checked here).

The portal lists these under Documents (`public/app/client-portal.html`, data from `api/read/portal-summary.mjs`, newest first, with a download link).

---

## 3. The four numbers that matter most

| Value | Expected | Where it comes from |
|---|---|---|
| Tier / label | **FULL_FUNDING** — label **"Approved for Funding"** | Engine. Not PREMIUM_STACK because card use is 17% (needs 10% or less). |
| Pre-approval today | **$199,350** | Engine recomputes it each time and gets the same answer as the stored 199,350. Math: Amex $25,000 limit × 5.5 = $137,500; Toyota $28,000 × 3 = $84,000; both × 0.9 (card use is "good", not "excellent"); business $0. |
| Pre-approval after paydown | **$221,500** | Same math with the 0.9 penalty removed. Gap shown as **$22,150**. |
| Card use (utilization) | **17%** | 7,850 owed on 45,000 of limits. |

Other values you will see: median score **762**; **3 bureaus CLEAN, 0 negative items**; **15 lenders** listed (6 personal you qualify for now, 9 business that need a company); confidence **high**.

---

## 4. Checkable table — every document, what it should say

All four reports share the same cover: applicant **Sim Five-Academy**, DATE **blank**, OUTCOME **FULL_FUNDING** (the raw code, not the words "Approved for Funding"), MEDIAN SCORE **762**. Last page of each is a black "Let Us Build Your Game Plan Together" page with the link **fundhub.ai** (see §5 #10).

### 4.1 Credit Analysis Report (cover title "Financial Profile Assessment")

| Section | Expected content |
|---|---|
| Opening line | "Sim, this report is built from your UnderwriteIQ file. Scores, cards, and lenders below are this file - not a sample person." |
| 01 Bureaus | 3 rows: Experian / Equifax / TransUnion — CLEAN — 0 — "No derogatory items." |
| 02 Scores | Experian **762**, Equifax **770**, TransUnion **758**, Median **762** |
| 03 Utilization table | **9 rows** (each card appears 3 times, once per bureau): Chase Sapphire Preferred $2,100 / $12,000 / 18% / target "$1200 or less" / MONITOR · Amex Blue Business Cash $4,800 / $25,000 / 19% / "$2500 or less" / MONITOR · Capital One Spark $950 / $8,000 / 12% / "$800 or less" / MONITOR |
| 03 callout | "Overall revolving utilization is 17%. Target: get balances to **$13,500** or under 10%." (the $13,500 is 3× too high — see §5 #3) |
| 04 Negatives | "No derogatory items are listed on this file." |
| 05 Inquiries | "Inquiries do not affect funding decisions at FundHub." Then a table with headers and **no rows**. |
| 06 Bottom line | Current **$199,350** · Projected **$221,500** · Delta **$22,150** |

### 4.2 Funding Snapshot (cover title "Capital Readiness Snapshot")

| Section | Expected content |
|---|---|
| 01 Numbers | Median score 762 (after-optimization column blank) · Experian 762 (blank) · Pre-approval **$199,350** → **$221,500** |
| 02 Personal cards | Same 9 rows as above, status MONITOR |
| 02 Installment loans | **3 rows**, all "Toyota Motor Credit — open — $14,200 — AsAgreed" (one account, shown 3 times) |
| 02 Mortgage | headers only, no rows |
| 03 Next step | "Do not open new accounts before funding. Lock this file first." then: Pay Chase Sapphire Preferred from $2,100 toward $1200 or less · Pay American Express Blue Business Cash from $4,800 toward $2500 or less · Pay Capital One Spark from $950 toward $800 or less |

### 4.3 Bank & Lender Match List (cover title "Capital Partner Shortlist")

| Section | Expected content |
|---|---|
| 01 File | "Sim, Experian is 762. Median is 762. Utilization is 17%." — nothing else under "Available right now" |
| 02 Shortlist | "These **15** lenders come from this file's match list." One block per lender, in this order: |
| Personal (qualifies now) | Chase Sapphire Preferred ($5K-$25K, 700) · Amex Gold ($5K-$25K, 700) · Lending Club ($5K-$40K, 700) · SoFi ($5K-$100K, 700) · Navy Federal* ($5K-$15K, 650) · Marcus by Goldman Sachs ($3,500-$40K, 660) |
| Business (needs a company) | Chase Ink Preferred ($10K-$25K, 700, 12 mo) · Amex Blue Business Plus ($10K-$30K, 700, 12 mo) · Capital One Spark Cash ($5K-$20K, 680, 6 mo) · OnDeck ($5K-$250K, 660, 12 mo, $100,000/yr) · Bluevine ($5K-$250K, 700, 24 mo, $120,000/yr) · Fundbox ($1K-$150K, 680, 12 mo) · Kabbage (Amex) ($2K-$250K, 640, 12 mo, $50,000/yr) · SBA 7(a) ($25K-$350K, 680, 24 mo) · Credibly ($5K-$400K, 650, 12 mo, $180,000/yr) |
| "why" line | Always the lender's sales blurb ("Strong personal card. Good starting point." etc.). The business ones never say "Business entity required" even though that is why they are not available now. |

### 4.4 Credit Optimization Roadmap (cover title "Sim's 6-Month Business Readiness Roadmap")

| Section | Expected content |
|---|---|
| 01 Projection | Today **$199,350** · Month 6 **$221,500** |
| 02 Month 1 | 9-row table (same 3 cards × 3 bureaus) with balance / limit / target. Then: "No derogatory items are listed. Month 1 is paydown and LLC setup." |
| 03 Months 2-6 | Fixed text: "Month 2-3: balances report. Dispute results come back." · "Month 4: escalate anything still on the file." · "Month 5: EIN, DUNS, business checking." · "Month 6: fresh tri-merge. Re-check pre-approval." |
| 04 Checklist | Month 1 pay lines for the 3 cards · "Month 1 - File LLC if this file has no entity." · "Month 1 - Apply for the personal loan this file already qualifies for." |

### 4.5 Capital Readiness Summary (built, NOT saved — you will not see it in the portal)

Plain one-page PDF: date · "Capital Readiness Summary" · Applicant: Sim Five-Academy · **Decision: Approved for Funding** · Personal Capital **$199,350** · Business Capital **$0** · Total Combined **$199,350** · Confidence: high · Median Score: 762 · Summary: "Credit score: 762 (excellent). Utilization at 17% (good). No active derogatories." · "This is a pre-qualification estimate, not a guarantee of capital or approval." The utilization bullet is missing (code reads a field that does not exist).

### 4.6 Findings / "what to optimize"

The engine finds **14 items**, but 9 of them are the same 3 card findings repeated 3 times (once per bureau). The real list is:

| Code | Says |
|---|---|
| FUNDING_FIRST (high) | "You qualify for funding. Do NOT open new accounts before applying." |
| UTIL_CARD_OVER_10 ×3 (medium) | Chase 18% → pay to $1,200 · Amex 19% → pay to $2,500 · Capital One 12% → pay to $800 |
| UTIL_MODERATE (medium) | "Your utilization is at 17%... Get total balances under $13,500." (3× too high; true figure $4,500) |
| NO_BUSINESS_ENTITY (low) | "You do not have a registered business entity on file." |
| DONT_CLOSE_OLDEST (info) | Chase Sapphire Preferred, open 88 months — do not close it |
| STRONG_ANCHOR (info) | Amex Blue Business Cash, $25,000 limit, 74 months — your strongest card |

**There is nothing to dispute** and no negatives, inquiries, or personal-data problems. That is the correct output for this file. The only "work" the documents should ask for is paying three cards down and forming a company.

These findings feed the two summary PDFs only. The four reports do not print the findings list; they print the card tables and the two pre-approval numbers.

---

## 5. Likely wrong or empty spots (given this input)

1. **The deck button delivers nothing but says it did.** 0 files, yet the client gets "Your correction letters are ready," the presenter sees "Deliverables sent to client.", and the client record reads "Delivery Failed — Retry." The email wording is also the repair product's wording ("correction letters"), not the Capital Blueprint's.
2. **Cover page DATE is blank** and **OUTCOME shows the raw code `FULL_FUNDING`**, not "Approved for Funding." (The pdf-lib printer never fills `date`; the cover prints the outcome code as-is.)
3. **Everything is counted three times.** The engine does not merge the same account across bureaus, so 3 cards become 9 rows, 1 car loan becomes 3 rows, and the totals triple: balances **$23,550** (true $7,850), limits **$135,000** (true $45,000), paydown target **$13,500** (true $4,500). The 17% is still right because both sides triple. The pre-approval is unaffected (it uses the single biggest account). A real three-bureau pull would show the same tripling.
4. **Business age 72 months never reaches the engine.** The sim writes it only to a CRM field. The engine gets no business report, so: "No business entity found," Business Capital $0, all 9 business lenders held back, and the roadmap tells a 6-year-old business to "File LLC." Expected given the input, but wrong for the person the sim is meant to be.
5. **Lender list headings mislead.** All 15 lenders sit under "After optimization — your shortlist." The "Available right now" section lists nobody, even though 6 lenders qualify now. Business lenders never show the "Business entity required" note.
6. **Inquiries table has headers and no rows** (the mapper adds nothing when there are no inquiries anywhere). The known inquiry-logging bug does not bite here — there are 0 inquiries to log.
7. **No personal-info letters** because the sim file carries no names, addresses, SSN, DOB, or employer. A real pull normally yields 3. Do not read "0 letters" as a bug on this client.
8. **Capital Readiness Summary is built and thrown away** (not saved). It is the only document that prints the words "Approved for Funding."
9. **Roadmap boilerplate talks about disputes** ("Dispute results come back," "escalate anything still on the file") on a file with nothing disputed.
10. **Last page link shows "fundhub.ai"** when the `BOOKING_URL` setting is empty. UNVERIFIED whether it is set on the live server.
11. **Sender address is blank** if the client row has no address fields; the sim opt-in likely has none. Only matters for letters, and none are produced here.
12. **CRM card-use fields may disagree with the PDFs.** The sim script was edited today. The committed version stored `crs_utilization = 0` and `crs_total_limit = 73,000` (a matching bug); the edited version stores 17 and 45,000. The PDFs say 17% either way. UNVERIFIED which version pushed this file.
13. **"Sim" is used as a first name** in the prose ("Sim, this report is built from...").
14. **"After optimization" score columns are blank** in the Funding Snapshot (`score_targets` is never filled by the Node printer).

---

## 6. UNVERIFIED — could not trace or could not see

* **Whether C-06 actually ran on the live site** for this client and saved the 4 reports. The read-only database check was blocked in this session. Look in the client's Documents list: four rows titled Credit Analysis Report / Funding Snapshot / Bank and Lender Match List / Credit Optimization Roadmap, generated by `c-06-crs-results-router`.
* **Which printer the live server used.** The code falls back to the Node (pdf-lib) printer when Python/WeasyPrint is missing, and Netlify has no WeasyPrint, so the wording above is the Node printer's. If the WeasyPrint printer somehow ran, the wording differs and includes two wrong statements for this file: "your utilization is at 17% - that's critical" and "No lenders are matched for immediate funding right now."
* **Whether the email actually leaves.** `sendTemplated` refuses if the client opted out or the template is not compliance-approved; the outbox also has a company-level send switch (`messaging_settings.outbound_enabled`). All three are live-database state.
* **The client's stored address / city / state / zip** (affects letters only).
* **`BOOKING_URL`** on the live server.
* **Which version of `scripts/sim/push-credit.mjs`** pushed this file (see §5 #12).

---

## 7. Sources read

`public/app/present.js` · `api/closer-deck.mjs` · `src/sales/closer-deck.mjs` · `src/underwrite/letter-pack.mjs` · `src/underwrite/letter-pack-filter.mjs` · `src/underwrite/funding-letter-pdf.mjs` · `src/underwrite/black-report-client.mjs` · `src/underwrite/black-report-pdf.mjs` · `src/underwrite/black-report-node.mjs` · `src/workflows/c-06-crs-results-router.mjs` · `src/workflows/ds-02-diy-letters.mjs` · `src/workflows/u-02-analyzer-complete-delivery.mjs` (retired) · `src/metro2/diy/persist.mjs` · `src/metro2/diy/from-crs.mjs` · `src/config/offers.mjs` · `src/finance/crs-tier.mjs` · `scripts/sim/push-credit.mjs` · `db/seed/023_ds02_letters_portal_copy.sql` · `api/read/portal-summary.mjs` · `vendor/underwriteiq-full/api/lite/letter-generator.js` · `vendor/underwriteiq-full/api/lite/crs/{engine,derive-consumer-signals,route-outcome,estimate-preapprovals,optimization-findings,build-suggestions,build-cards,build-documents,summary-doc-generator,lender-matrix,generate-deliverables,identity-fraud-gate,normalize-soft-pull}.js`

Derivation run: engine + `buildLetterPack` (repair and funding) + both printers on the `academy` payload, no database. Outputs kept in the session scratchpad only.
