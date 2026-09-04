# What the funding path SHOULD produce — Sim One-Funding

Written 2026-09-03. Read-only study of the code. Nothing was run and nothing was changed.

Use this page during the live walkthrough. Read the number the screen shows, then
check it against the number here. If they differ, that is a finding.

Everything below was traced in the code. Where the code did not answer, it says
**UNVERIFIED** and stops there.

---

## 1. What goes in

The script `scripts/sim/push-credit.mjs`, run with `--profile funding`, puts a
pretend credit report on a real client. No bureau is touched.

### Scores it writes

| Bureau | Score |
|---|---|
| Experian | 718 |
| Equifax | 724 |
| TransUnion | 731 |

All three are FICO 9. The middle score (the median) is **724**.

### The four accounts it writes

Every account is in the client's own name, open, and paid as agreed. None is late,
in collection, or charged off.

| Creditor | Kind | Credit limit | Balance | Opened |
|---|---|---|---|---|
| Chase Sapphire Preferred | credit card | $12,000 | $2,100 | Apr 2019 |
| American Express Blue Business Cash | credit card | $25,000 | $4,800 | Aug 2020 |
| Capital One Spark | credit card | $8,000 | $950 | Jan 2021 |
| Toyota Motor Credit | car loan | $28,000 (high balance) | $14,200 | Jun 2022 |

Important: the script copies **all four accounts onto each of the three bureau
reports**, and the engine does not remove duplicates. So the engine actually sees
**12 accounts**, not 4. That is by design of how the file is built, and it is what
the maths below uses.

### Other things it writes

- 7 inquiries: 4 on Experian, 2 on Equifax, 1 on TransUnion. Dates run Nov 2025 to May 2026.
- No public records, no bankruptcies, no collections.
- Custom fields on the client: inquiry counts per bureau (4 / 2 / 1), negative
  items 0, late payments 0, business age 30 months, card use 0% (see Finding 1).
- The report is stamped "simulated" so every screen can tell it was not a real pull.

---

## 2. What should come out

### The tier

The tier engine (`vendor/underwriteiq-full/api/lite/crs/route-outcome.js`) works
down a list. The first rule that fits wins.

1. **Fraud hold** — needs a fraud alert or a credit freeze on the report. There is none. Skip.
2. **Manual review** — needs a missing score or a name that does not match. Scores are present. Skip.
3. **Repair only** — needs a charge-off, collection, or serious late. There are none. Skip.
4. **Funding plus repair** — same, needs a bad item. There are none. Skip.
5. **Full funding** — needs: every bureau clean, card use under 30%, no bad items, and
   at least 3 accounts in the client's own name. All four are true. **This one fits.**
6. **Premium stack** — only if the middle score is 760 or higher. 724 is lower. Does not fit.

**Expected tier: FULL_FUNDING.** On screen this reads "Approved for Funding".

### The card use figure

Only open credit cards in the client's own name count.

- Balances: ($2,100 + $4,800 + $950) x 3 bureaus = **$23,550**
- Limits: ($12,000 + $25,000 + $8,000) x 3 bureaus = **$135,000**
- 23,550 ÷ 135,000 = 17.4%, rounded to **17%**

17% falls in the "good" band (10% to 29%), which carries a 0.9 multiplier.

### The funding estimate

From `estimate-preapprovals.js`.

The engine picks one "anchor" card — the biggest limit on a card in the client's
own name, open, clean, and at least 24 months old. That is the **American Express
at $25,000**. It picks one anchor loan the same way: the **Toyota loan at $28,000**.

**Card money**
- 25,000 x 5.5 = 137,500
- x 1.0 (full funding) x 0.9 (card use "good") x 1.0 (file is not thin) = **$123,750**

**Loan money**
- 28,000 x 3.0 = 84,000
- x the same 0.9 = **$75,600**

**Business money**
- The script passes no business credit report at all, so the business side is
  blocked and comes out **$0**. The 30-month business age it writes to the client
  record is never seen by the engine (Finding 2).

**Expected funding estimate: 123,750 + 75,600 + 0 = $199,350.**

That figure is written onto the client record in two places,
`total_funding_estimate` and `analyzer_prequal_amount`
(`src/handlers/client-lifecycle.mjs`, on the `decision.rendered` event).

### Reason codes

The engine should attach **REPORT_FRESHNESS_UNKNOWN** — the simulated report
carries no "date requested" field, so the freshness check has nothing to read.
This is a note, not a block. No other reason codes should appear.

---

## 3. The checkable table

| Thing to check | Where to look | Expected |
|---|---|---|
| Tier | Client Control Panel, and `clients.outcome_tier` | `FULL_FUNDING` |
| Decision wording | Client-facing screen | "Approved for Funding" |
| Middle score | Scores tile | 724 (718 / 724 / 731) |
| Card use | "Card Use" tile | 17% — but see Finding 1, it will likely show 0% |
| Funding estimate | "Prequal" tile / `total_funding_estimate` | **$199,350** |
| Accounts stored | tradelines on the client | 12 rows (4 accounts x 3 bureaus) |
| Sales board | Pipeline | card moved to "Decision rendered" |
| Lender list after Generate Apps | Apply list on Client Control Panel | see below |
| Application rows after Generate Apps | applications table | **0 — none are created** (Finding 3) |

### Expected lender count

The matcher (`src/lenders/match.mjs`) does **not** look at credit score, card use,
income, or funding estimate. It only checks four things:

1. Is the lender switched on.
2. Does the client's state appear in the lender's list of states.
3. Does the lender pull a bureau we are trying to protect (from open inquiry work).
4. Then it sorts to spread the pulls across bureaus.

Against the lender list in the repo (`credentials/lenders-audit/lenders-audited.csv`,
313 lenders, all switched on):

| Situation | Expected matches |
|---|---|
| Client has no state on file | **313** — every lender, because an unknown state blocks nothing |
| Client's state is known, e.g. Texas | about **20** |
| Client's state is known, e.g. California | about **26** |

The screen only draws the first **25** rows whatever the number, and about a third
of the lenders have no application link, so those rows show "No URL" instead of an
Apply button.

**Is the SOP's "30-50 lenders" claim supported? No.** The code and the lender list
give either ~313 (state unknown) or roughly 19-26 (state known). Nothing in the
code produces a range of 30 to 50. `docs/workflows/manual-walkthrough-SOP.md`
line 146 should be corrected once the live number is read.

---

## 4. What the application rows should contain

Application rows are **not** created by Generate Apps. They are created one at a
time, when someone presses **Bank yes** or **Bank no** on a lender row
(`src/applications/status.mjs`, `logBankDecision`).

When the first one is pressed for a lender, one row is created with:

| Field | Comes from |
|---|---|
| bank / lender_name | the lender's name |
| product_name | the lender's product name |
| application_url | the lender's apply link |
| lender_table | which lender book the lender sits in |
| status | starts at "Apply", then set to "Approved" or "Denied" |
| funding_round_id | the newest open funding round; one is created if there is none |
| approved_amount | typed by hand. Blank is allowed and stays blank — it is not 0 |
| play_name | typed by hand, optional |

No documents are attached and none are generated at this step.

---

## 5. UNVERIFIED

These could not be settled from the code alone.

1. **Whether the test client has a state on file.** The matcher reads the business
   record first, then the client fields `business_state`, `state`, `home_state`.
   Nothing in the simulation script writes any of them. Whether the ClickFunnels
   opt-in writes one is not traceable here. This single fact decides whether the
   lender count is ~313 or ~20.
2. **How many lenders are actually in the live database.** The 313 figure is the
   spreadsheet in the repo. An earlier audit note records 307 live. Read the real
   number during the walkthrough.
3. **Whether Demo Mode is on for the company.** If it is, sample lenders are added
   to the count.
4. **Whether any inquiry-removal case is open on the test client.** An open case
   marks that bureau "do not touch" and drops matching lenders — but since 310 of
   313 lenders have no bureau recorded, this filter does almost nothing either way.
5. **What the "Card Use" tile reads from.** Traced as far as the client detail
   endpoint; the exact stored field it prefers was not followed to the end.

---

## 6. Findings

**Finding 1 — the card use figure the script writes is 0%, but the real answer is 17%.**
In `push-credit.mjs`, the script adds up card balances by looking for accounts of
type `revolving` in lower case. The accounts are actually typed `Revolving` with a
capital R. Nothing matches, so it records **0%** card use into the client's custom
fields and into the report's own summary. The tier engine does its own sum and gets
17%, so the tier and the dollar estimate are still right — but any screen reading
the stored 0% will show a wrong, flattering number. Same block writes a total limit
of $73,000 that includes the car loan, which is not a credit limit.

**Finding 2 — the business age is written but never used.**
The script stores `business_age_months: 30` on the client, and the estimator has a
rule that would multiply business funding by 1.0 at 30 months. It never fires,
because the script passes no business credit report, so the whole business side is
blocked at $0 before the age is looked at. The business half of the funding
estimate can never be anything but zero on this path.

**Finding 3 — "Generate Apps" does not generate any applications.**
The button only re-reads the lender match list from `/api/read/lender-matches` and
redraws the rows. It creates nothing in the database. The SOP says "Applications
rows created" — that does not happen until a human presses Bank yes or Bank no on
an individual lender. The wireframe's own placeholder text ("6 apps generated")
reinforces the wrong expectation.

**Finding 4 — the lender matcher ignores the credit file entirely.**
Score, card use, funding estimate, tier — none of them are read. A 588-score repair
client and this 724-score funding client get the same lender list, if they live in
the same state. This is deliberate in the code ("structural rules only — no
invented approval criteria"), but it means the lender list is not evidence that the
funding decision worked.

**Finding 5 — the bureau-rotation and inquiry-protection logic is effectively dead.**
It works off each lender's `bureaus_pulled` field. In the repo's lender list, 310
of 313 lenders have that field blank. So no lender is ever skipped for inquiry
sensitivity, and the rotation sort has nothing to sort on.

**Finding 6 — the 7 simulated inquiries are never logged as inquiries.**
The script fires the `analysis.completed` event with the inquiries under a key
named `inquiries`. The workflow that writes inquiry records (`c-02-inquiry-created`)
looks for a key named `newInquiries`. The names do not match, so no inquiry records
are created, no specialist task is raised, and the "Open Inquiries" tile stays
empty. **This is not a simulation-only problem** — the real bureau pull
(`src/finance/crs-pull.mjs`) sends exactly the same key, so a real pull does not log
inquiries either.

**Finding 7 — no personal-card or personal-loan lenders exist in the list.**
The lender book has only business card lenders (196 in-branch, 117 online). The
estimate says $123,750 of personal card money and $75,600 of personal loan money,
but there is not a single lender in the file to apply to for either.

**Finding 8 — the SOP's lender count is wrong.**
See section 3. "30-50" matches neither the code nor the data.
