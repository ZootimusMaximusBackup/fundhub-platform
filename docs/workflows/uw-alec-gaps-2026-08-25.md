# UnderwriteIQ vs Alec — gaps

**Date:** 2026-08-25  
**Kind:** Read-only. No live credit pull. No card charge. No secrets. No names.  
**Question:** Does UnderwriteIQ Lite do what Alec Delpuech (Legacy Strong) taught for underwriting?

**Answer in one line:** Lite shares a few big yes/no bars (700, no bad marks, 30% used, 24-month company). It **misses most of Alec’s real playbook**, and on several numbers it **does the opposite**.

---

## What I used (real files only)

| Place | What was there |
|---|---|
| `credentials/notion-scrape/output/` | Alec / Legacy Strong library. Funding-ready list, credit analysis, aged company, extra owners, income, Experian Business, lender notes, July 2026 funding bootcamp. |
| `credentials/lenders-audit/` | Logo/link check of Alec’s **313** lender rows. Not a dollar engine. |
| `docs/company-resources/` | Closer teaching. Sales rules, not Alec’s math. |
| Prior boards (`alec-closer-onboard`, closer pack, KPI reference) | Sales and shop money. **No** card-times formula. |
| Company Brain extracts on disk | **None found.** Brain code is in the repo. No saved Alec extract pack to read. |
| Redacted sample report PDFs in the July 2026 bootcamp folder | On disk. **Not a readable PDF** (broken file). No numbers taken from them. |

I did **not** invent a name, a score, or a formula Alec did not write.

---

## How Lite decides money (so the table makes sense)

Lite = UnderwriteIQ Lite (`src/underwrite/vendor/underwriter.cjs` + `business-funding.mjs` + `adapter.mjs` + `report.mjs`).

In plain words, Lite does this:

1. **Ready flag (“fundable”):** score **700 or more**, used credit **30% or less** (one overall number), **zero** bad marks.
2. **Card dollars:** highest **open card that is 24 months old** and at least **$5,000** × **5.5**.
3. **Loan dollars:** highest **24-month-old** installment/auto/mortgage of **$10,000+** × **3**, and no late pays.
4. **Company dollars:** that same card-dollar pile × **0.5** (under 12 months), **1.0** (12–23 months), or **2.0** (24+ months). Unknown age = **$0**.
5. **Two companies:** add that company slice **once per saved company**.
6. **One bureau only:** personal dollar total is cut to **one-third**.
7. Extra owner, income, LLC on file, Experian Business, DUNS: **not used for the dollars**. LLC talk lines assume “no LLC” because Fundhub stores no LLC field.

Alec **never published** the 5.5×, 3×, or “cut one bureau by three” rules. Those are Lite-only.

---

## Alec rule → Lite

**IN ENGINE** = Lite does that rule with the same number.  
**GAP** = Alec treats it as underwriting; Lite does not use it.  
**CONFLICT** = Lite uses a different number, or does the opposite.

| Alec rule (source) | What Lite does | Tag |
|---|---|---|
| Strong “funding-ready” score **700+** (thin-profile page) | Ready flag needs **700+** | **IN ENGINE** |
| No lates / collections / charge-offs to be ready (thin-profile, RM list) | Ready flag needs **zero** bad marks | **IN ENGINE** |
| Over **30%** used on a card is bad; do not check the box (credit analysis, bootcamp walk) | One **overall** used-% ; over 30 fails the ready flag | **IN ENGINE** (same 30; see per-card row) |
| Need real **open cards**, not only loans, before business cards (July 2026 bootcamp) | Will not stack cards unless it sees an open revolving line | **IN ENGINE** |
| **24 months** is the door for lines of credit and term loans (aged-corp, how-to-finance, BLOC page) | Company dollars **jump at 24 months** (2×) | **IN ENGINE** (door exists; under-24 still pays — see conflict) |
| RM path needs score **740+** (relationship-managers) | Ready at **700** | **CONFLICT** |
| Line of credit **prefers 670** (BLOC page) | Ready flag **fails under 700**, but Lite **still prints big dollars** | **CONFLICT** |
| Sales note: **680** clean file can get yes after pay-down (sales deep-dive) | **680** = not ready; dollars still print | **CONFLICT** |
| Strong results: each card under **10%** used; **0–3%** best (thin-profile) | Target is **30%**. 15% is “ready” | **CONFLICT** |
| Each **card** must be under 30% (credit analysis, RM) | One **file-wide** percent, not each card | **CONFLICT** |
| **4+** open accounts; bootcamp: **4** total with **3+** cards (thin-profile, July 2026) | “Thin” if fewer than **3** good lines | **CONFLICT** |
| RM: **4** primary accounts | Same as above | **CONFLICT** |
| One high-limit card **$10,000+** (thin-profile, RM, no-high-limits, bootcamp) | Stacks at **$5,000** if 24 months old | **CONFLICT** |
| Max **2** recent looks (inquiries) **per bureau** when you fund (thin-profile, RM) | **Any** look turns on “clean inquiries.” Ready flag **ignores** looks. “Many” = **12** total | **CONFLICT** |
| **3+** looks in **6 months** on one bureau = almost sure no (credit analysis, bureau-stacking) | **3** looks, score 720, still **ready** | **CONFLICT** |
| Company **23 months or less** = lines of credit / term loans are off (aged-corp: “≤23 defeats”) | **18** and **23** months still get **1×** company dollars | **CONFLICT** |
| Several companies: pick the **strongest one** first; fund **one** at a time (strongest-entity, application-tips) | Adds the company slice **for every saved company** | **CONFLICT** |
| A big **authorized-user** card is for file build, **not** the same as a primary (bootcamp walk, $25k rule excludes AU) | Lite **cannot see** AU vs primary. A $50k revolving line is treated as a real stack card | **CONFLICT** |
| Average age of accounts **2+ years** (thin-profile; simple average formula) | No average. Only “this one line is 24 months old” for dollars | **GAP** |
| Looks fade after **12 months**; fall off at **24** (bootcamp, bureau-stacking, FICO factors) | Raw count. No time window | **GAP** |
| Under **6** looks in **12 months** on that bureau to apply (bureau-stacking) | Not used | **GAP** |
| Never wipe a look that sits on an **open personal** card | Not used | **GAP** |
| Freeze a bureau / stack looks across bureaus / same-day same bank = one look | Not used | **GAP** |
| Use **FICO**, not free Vantage (credit analysis, bootcamp) | Does not check which score type | **GAP** |
| RM: **99%** on-time pay history | Not used | **GAP** |
| Optimize: **$15k** combined primary limits (no-high-limits) | Not used | **GAP** |
| RM: **$25k** combined primary limits, **no AU** | Not used | **GAP** |
| RM: fewer than **2** new accounts in **6 months** | Not used | **GAP** |
| Space new apps about **30 days** when building (thin-profile) | Not used | **GAP** |
| Extra owner **25%+** can apply on the same company; wait **6 months** at the same bank (multiple-partner) | Extra owners **ignored** | **GAP** |
| Income / sales / profit / monthly spend on apps. Baselines: personal up to **$250k**, business up to **$450k**, profit up to **$300k**, spend about **$30k** if unsure (RM, application-tips) | Income **ignored** | **GAP** |
| Business credit homes: **Experian Business**, Equifax Business, DUNS, NAV (bootcamp, update-biz-info) | **Ignored** | **GAP** |
| Fix company name / industry at Experian Business so it is not high-risk | **Ignored** | **GAP** |
| High-risk company **under 12 months**: get a new one or change it (July 2026) | Only age in months | **GAP** |
| Privacy state, safe industry code, no liens (aged-corp) | **Ignored** | **GAP** |
| Business checking + **30-day** money sit (Chase / Bank of America lender notes) | **Ignored** | **GAP** |
| Match lender by **state** and **which bureau they pull** (313-row Alec list + bureau-stacking) | One closer line: “pick lenders.” **No match** | **GAP** |
| Chase **5/24** (five personal cards in 24 months blocks Chase) | **Ignored** | **GAP** |
| After a new card, ask for up to **3×** the first limit (application-tips, favorite biz cards) | **Ignored** | **GAP** |
| Line of credit size from **stated sales**: about **$50k** stated, **$350k** no collateral, **$1M** with collateral (BLOC page) | Uses **card × age**, not sales | **GAP** |
| Clean extra **names / addresses / jobs** before you apply (bootcamp walk) | **Ignored** | **GAP** |
| Take off self-reported rent / utility lines (bootcamp walk) | **Ignored** | **GAP** |
| LLC / corp is how Alec’s shop applies (business prep, bootcamp) | **Dollars ignore LLC.** Talk line assumes “no LLC” because nothing is stored | **GAP** |
| Alec card-times formula (how many times the highest card) | **Not in his pages.** Lite uses **5.5×** anyway | **GAP** |
| Alec loan-times formula | **Not in his pages.** Lite uses **3×** | **GAP** |
| Cut personal dollars to **1/3** when only one bureau is in | **Not in his pages.** Lite does this | **GAP** |

---

## Numeric runs (real Lite functions)

These are **rule-number** cases from Alec’s pages, not a live person. Ran `computeUnderwrite` and `businessFundingDollars` / `stackedBusinessFunding` on 2026-08-25. Card age used a far-past open date so “24 months old” is stable.

**How to read “Alec $”:** Alec did **not** publish a pre-approval dollar from “card × a number.” His pages say ready / not ready, or a lender range. If the cell says “no dollar,” that is honest.

| Case | Alec’s published bar | Lite ready? | Lite card pile (one bureau) | Lite company $ | Clash |
|---|---|---|---|---|---|
| 720 score, 8% used, $10k 24-mo card, 30-mo company | Thin-profile **ready** | Yes | **$55,000** then personal total cut to **$18,333** | **$110,000** (2×) | Alec never taught 5.5× or the 1/3 cut |
| Same file on **three** bureaus | Ready | Yes | Personal total **$165,000** (three copies added) | **$110,000** | Alec does not add the same card three times |
| 720, 8%, **$5k** 24-mo card | **Not** his high-limit bar ($10k) | Yes | **$27,500** (then $9,167 after 1/3) | $0 (no company age given) | Lite says ready + stacks; Alec wants $10k |
| 720, 8%, **$10k** card **with no open date** | High-limit box can still count | Yes, but **$0** stack | **$0** | **$0** | Lite treats a dated-unknown $10k as no card |
| 720, **15%** used, $10k 24-mo card | Strong list wants **under 10%** | Yes | $55,000 → $18,333 | $0 | Lite ready; Alec “strong” is not |
| 720, 10%, **3 looks** on one bureau | “Guaranteed deny” if 3+ in 6 months | **Yes** | $55,000 → $18,333 | $0 | Opposite of Alec’s deny rule |
| **680** clean, 20%, $10k, 30-mo company | Sales: maybe after pay-down | **No** | **$55,000** (no 1/3 cut — not “ready”) | **$110,000** | Not ready, but **$165,000** still prints |
| **670** (BLOC prefer), 8%, $10k, 24-mo company | BLOC may try | **No** | **$55,000** | **$110,000** | Same: flag no, dollars yes |
| **740**, 10%, $10k, **1 look**, 36-mo company | RM list allows up to **2** looks / bureau | Yes, but “clean inquiries” is **on** | $55,000 → $18,333 | $110,000 | One look is fine for Alec RM; Lite nags |
| $10k card, company **18** months | LOC “more difficult”; aged-corp wants 24 | Yes | $55,000 → $18,333 | **$55,000** (1×) | Alec would not treat this as full LOC money |
| $10k card, company **23** months | Aged-corp: **defeats** LOC / term loan | Yes | $55,000 → $18,333 | **$55,000** (1×) | Lite still pays |
| $10k card, company **24** months | LOC door open | Yes | $55,000 → $18,333 | **$110,000** (2×) | Door matches; 2× is Lite-only |
| **$50k** 24-mo revolving (could be AU) | AU is build, not primary stack | Yes | **$275,000** → $91,667 | $0 | Lite cannot tell AU from owned |
| Credit-analysis style: **623**, **43%** used, $650 + $200 cards, 2 bad marks | Pay down; not ready | No | **$0** | $0 | **Agree** — not ready |
| Two companies, both **30** months, card pile $55,000 | Pick **one** strongest | n/a | n/a | **$220,000** stacked vs **$110,000** for one | Lite doubles; Alec would not |

Age-only check (`businessAgeMultiplier` on a $55,000 card pile):

| Company age (months) | Alec LOC / loan door | Lite multiplier | Lite company $ |
|---|---|---|---|
| unknown | no guess | 0 | $0 |
| 6 | too new | 0.5 | $27,500 |
| 12 | still under 24 | 1.0 | $55,000 |
| 23 | **defeats** purpose | 1.0 | $55,000 |
| 24 | door open | 2.0 | $110,000 |

---

## Extra owner, LLC, income, Experian Business

You asked to confirm these. Confirmed against Alec **and** Lite:

| Topic | Alec | Lite |
|---|---|---|
| Extra owner | Each owner at **25%+** can apply. Same bank: wait **6 months**. New shops: separate companies. | **Ignored.** |
| LLC | His shop applies as a company. 12-month high-risk = change it. 24-month safe industry = BLOC / loans. | **Dollars ignore LLC.** Suggestion text assumes **no LLC** because Fundhub has **no LLC field** (`adapter.mjs` / `report.mjs`). |
| Income | Apps and bankers: personal up to **$250k**, business up to **$450k**, profit up to **$300k**, spend about **$30k** if unsure. | **Ignored.** |
| Experian Business / DUNS | Business file lives at Experian Business, Equifax Business, DUNS. Update name and industry. Watch NAV. | **Ignored.** |

---

## Counts

Counted from the rule table above (one tag per row).

| Tag | Count |
|---|---|
| **IN ENGINE** | **5** |
| **CONFLICT** | **13** |
| **GAP** | **28** |
| **Total Alec rules mapped** | **46** |

---

## Worst 8 (plain words)

1. **Lite invents money Alec never taught.** A $10,000 old card becomes **$55,000** (×5.5). Alec’s pages have no such times-table.
2. **A 23-month company still gets paid.** Alec: lines of credit and term loans need **24 months**; 23 or less **fails**. Lite still pays **1×**.
3. **$5,000 vs $10,000.** Alec will not call the file strong without a **$10k** card. Lite stacks at **$5k**.
4. **10% vs 30% used.** Alec’s strong list wants each card near **0–10%**. Lite calls **15%** ready.
5. **Three looks in six months.** Alec: almost sure **no**. Lite: score 720 still **ready**.
6. **Extra owner, income, and Experian Business are invisible.** Alec underwrites all three. Lite does not.
7. **Two companies.** Alec: pick the **strongest**, fund **one**. Lite: **add** them.
8. **The ready flag and the dollar fight.** A **670–680** file is “not ready” but can show **$165,000**. A **720** file with one bureau is ready but personal dollars are cut to **one-third**. Alec never taught that.

---

## What I did not do

- No live CRS / bureau pull  
- No card charge  
- No secrets, SSN, or full account numbers  
- No ask for Chris to click  
- Did not treat closer-pack **sales** rules as Lite math  
- Did not invent a worked client file; sample PDFs would not parse  

**Nothing for Chris to do.** This is the scorecard only. No fix in this pass.
