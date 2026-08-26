# Launch readiness — 2026-08-26

**Door:** dictator prove. No ask. No live CRS. No PostGrid / paper mail. No card charge.  
**People reused:** Sim Repair Horse `5ce80871-0b70-4d2d-89e0-efdd62aa2e2f` (deliverables / five-horsemen). Did not remint. Did not merge `vc/save-2026-08-25`.  
**This lane owns:** CREDIT + LETTERS only.

**COMPLIANCE REVIEW REQUIRED** — repair pay links, dispute letters, fee talk.

---

## CREDIT + LETTERS

**Can we launch credit repair tonight?**  
People can be sent a live pay link. Round 1 letters exist on the Repair Horse file. **Do not say 100%.** Live letters still hide the creditor name. Staff on the live site cannot see the six-round plan until the PR below is merged. This file is a **$200 trial (2 rounds)**. Full $1,000 work is **6 rounds**.

| # | Check | Score | Evidence |
|---|---|---|---|
| 1 | Client can be offered credit repair and get a pay link (mint, no charge) | **PASS** | Repair Horse stored two sent $1,000 links (`Credit repair, done-for-you`) and one $200 trial link. Checkout opened: https://www.fanbasis.com/agency-checkout/fundhub-1/omjzN → https://commas.com/checkout/omjzNn2Onfx0PM (HTTP 200). `paid_at` is empty. No card charged. Gmail already has “Credit repair, done-for-you — $1,000” and “Your invoice from Fundhub — $200.00”. |
| 2 | After assume-paid (sim), Stage letters exist and match the file | **FAIL** (quality) | Trial enroll is on file (`repair_enroll:trial`, `metro2-letter-pack`). Stage letters: Equifax R1 + Experian R1, status `generated`. Bureau and round match the cases. **13 Experian items name creditors** (CAPITAL ONE, BENEFICIAL, FORD MOTOR, …). **Live letter bodies do not print those names.** Existing PDFs `docs/workflows/four-plus-pulse-2026-08-25-evidence/deliverables/repair-EQ-R1-bureau.pdf` and `repair-EX-R1-bureau.pdf` were not remade. |
| 3 | Escalation: round 1 vs later rounds | **PASS** (engine) / **held** (this file) | Not one guess. Catalog + letter pools already say: R1 = 30-day reinvestigate, not a final notice. R2 = method of verification after verified / no answer past 30 days + mail. R3 = last bureau notice. R4/R6 reuse R2. R5 reuses R3. Then CFPB / state AG (catalog only; not mailed). Live file: R1 written. R2 **held** — no bureau answer, no fake mail. This trial **blocks R3–R6** (`rounds_cap=2`). Full program cap is 6. |
| 4 | Repair vs combo vs inquiry — screen matches file | **PASS** | Repair Horse: repair pay links + trial program + 2 letters. Combo Horse `f2bc2425-8360-428c-98e7-c7fab4029c03`: funding $3,000 + repair $1,000 links; **no** repair enroll, **0** Stage letters. Inquiry Horse `a792442a-8644-4c6d-9b12-d004be1840d2`: $32 soft-pull only; **0** repair letters. Specialist repair-cases detail for combo/inquiry has no repair file row. |
| 5 | Portal / Documents / stay signed in | **PASS** (API + prior click) | Staff login `chris@fundhub.ai` on https://fundhub.ai. `GET /api/read/documents?client_id=5ce80871-…` → 200, items listed. Eight-fix harvest already clicked Documents twice with no login bounce. Browser tool was down this pass — I did not re-click the portal HTML tonight. |
| 6 | Staff can finish the repair desk motion | **PASS** (queue → file → letters) / **not-live** (six-round card) | Opened https://fundhub.ai/app/inquiry-remover.html data via `GET /api/read/repair-cases` (list + `?client_id=`). Repair Horse is on the queue. Stage letters are ready. **Send was not clicked** (no paper). Live API has **no** `rounds` array and items have **no** bureau field. That card is in the PR, not on the live page yet. |

### Six rounds on Repair Horse (this sim)

| Round | What the house already says | This file |
|---|---|---|
| R1 | First mail after engine findings | **Written** — EQ + EX letters, 41 attacks |
| R2 | After R1 verified / remains / no answer past 30 days + mail time | **Held** — wait for a bureau answer. Not invented. Not mailed. |
| R3 | After R2 still verified / no MOV | **Blocked** on trial (cap 2) |
| R4 | Same letter pool as R2 | **Blocked** on trial |
| R5 | Same letter pool as R3 | **Blocked** on trial |
| R6 | Same letter pool as R2 | **Blocked** on trial |

Full $1,000 enroll sets `rounds_cap=6`. Then R3–R6 become “later”, then “held”, never fake-mailed.

### Product holes named tonight

1. **Live R1 letters omit creditor / last four** even when the item has them. New generator prints `Account: BENEFICIAL · ending 0283`. Old Stage letters were not rewritten.
2. **Live desk does not show the six-round plan or bureau on each item.** Isolated fix is ready.

### Fix (smallest, isolated worktree)

Branch `fix/letter-rounds-visibility` off `origin/main`. Does not rewrite UnderwriteIQ math. Does not merge `vc/save-2026-08-25`.

- Letters name the creditor when the item has one.
- Repair case read adds `bureau` on items and a `rounds` plan (held / blocked, no fake mail).
- Same Specialist desk grows a **What is next** card. No new app.

### Hard stops kept

No card charge. No live credit pull. No paper mail. No ClickFunnels remint.
