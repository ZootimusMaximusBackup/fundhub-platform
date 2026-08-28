# UnderwriteIQ — full rulebook

**Date:** 2026-08-25  
**Kind:** Read-only writeup from live code. No fix. No deploy. Formula left as-is.

This is the **complete** rulebook. The short sheet at `docs/workflows/underwriteiq-plain-2026-08-25.md` can stay. This file does not skip a threshold, skip, or branch to stay short.

Nothing here was invented. If a rule is not in the files listed at the bottom, it is marked **UNVERIFIED**.

**Words used here**

- **Bureau** — one of the three credit companies: Experian, Equifax, TransUnion.
- **Tradeline** — one account on the credit file (a card, a loan, a line of credit).
- **Seasoned** — the account is at least **24 months** old.
- **Utilization** — how much of the card limits is used, as a percent (30 means 30%).
- **Fundable** — the engine’s “ready” flag. It is **not** a lender yes.
- **Lite** — the live math in `src/underwrite/vendor/underwriter.cjs` (recomputed on read).
- **Present** — the closer deck / screen-share path. It **does not** re-run Lite. It reads numbers already stored on the credit-pull row.

---

## 1. What the number is

UnderwriteIQ Lite prints a **first-look dollar guess**.

It is **not**:

- a lender saying yes
- several cleanup rounds
- a new number after “optimization”
- a promise of approval, rate, or terms

It is **one pass** over the credit file plus saved companies.

The closer-call screen may label three bands “Conservative,” “Realistic · round 1,” and “After optimization.” Those are **labels on the same first-look result**, not a second math pass. “After optimization” is the **combined** personal + company total. It is not a cleaned-up second run.

---

## 2. Two paths (map)

| Path | Where | What it does with dollars |
|---|---|---|
| **Lite** | `GET /api/read/underwrite` and closer cockpit (`src/sales/cockpit.mjs`) | Rebuilds the number **now** from stored cards, scores, and company ages. Then stacks company dollars **once per saved company**. |
| **Present** | Closer deck (`src/sales/closer-deck.mjs`) → Present slides | **Does not** call Lite. Reads **stored** totals on the newest credit-pull row. If two or more companies are saved, it may multiply the **stored company slice** by the company count. |

Same 5.5 / 3.0 / age brackets sit under both stories. Present still does **not** re-run that math at show time.

---

## 3. Inputs — every field the Lite engine reads

### 3.1 What `computeUnderwrite` reads

From `src/underwrite/vendor/underwriter.cjs`.

**Per bureau** (Experian, Equifax, TransUnion). A missing bureau is treated as “not here.”

| Field | Used for dollars / ready? | Notes |
|---|---|---|
| `score` | Ready flag. Picks the **primary** bureau. | Sanitized first (see §4). |
| `utilization_pct` | Ready flag. Advice only after that. | Percent units. `null` does **not** fail the ready check. |
| `inquiries` | Advice only. **Not** in the dollar formula. | Missing bureau slot becomes **0**. Available bureau with no count stays **null**. If any slot is **null**, the **total** is **null**. |
| `negatives` | Ready flag. Advice. | Must be a measured **0** to be ready. `null` fails. |
| `late_payment_events` | Loan dollars. | Must be a measured **0** to allow loan stacking. `null` withholds loan dollars. |
| `tradelines[]` | Card dollars, loan dollars, thin-file flags | See §3.2. |
| `names`, `addresses`, `employers` | **No** | Carried, never read by the dollar engine. |

**One extra input**

| Field | Used for |
|---|---|
| `businessAgeMonthsRaw` | One company-age number for the **engine’s own** one-shop company slice. Not a finite number → treated as no age. |

### 3.2 Each tradeline the engine reads

| Field | How it is read |
|---|---|
| `type` | Lowercased. `"revolving"` = card pile. `"installment"`, `"auto"`, or `"mortgage"` = loan pile. Any other type (including `"loc"`) is **not** a card and **not** a loan. |
| `status` | Lowercased. Must contain `"open"` to be the card-stack pick. Derogatory words (below) mark the line as bad. |
| `limit` | Dollars. Missing → **0** for this line. |
| `balance` | Dollars. Missing → **0**. Used as the loan “original amount” only when limit is missing or 0. |
| `opened` | Must be a **string** starting `YYYY-MM`. Anything else (including a Date object) → age unknown → **not seasoned**. Age uses **today’s clock**. |

**Derogatory status words** (substring match). A hit means the line is “bad”:

- `chargeoff`
- `charge-off`
- `collection`
- `derog`
- `repossession`
- `foreclosure`

A 30-day late is **not** on that list.

### 3.3 What Fundhub feeds Lite (the adapter)

From `src/underwrite/adapter.mjs`. This is the only conversion from our tables into the engine.

| Fundhub source | Engine field |
|---|---|
| Newest non-sandbox credit pull scores (`triMerge` in `src/http/client-detail.mjs`) | Per-bureau `score`. A bureau with **no score is not sent at all** (so the engine cannot report score 0 for “we never pulled this one”). |
| `clients.custom_fields.crs_inquiries_ex` / `_eq` / `_tu` | Per-bureau `inquiries` |
| `clients.custom_fields.crs_negative_items_count` | `negatives` on **every** available bureau (one number, copied) |
| `clients.custom_fields.crs_late_payments_count` | `late_payment_events` on **every** available bureau (one number, copied) |
| Open drawable lines’ limits and balances (`src/finance/os-grid.mjs`) × 100 | `utilization_pct` (same number on every available bureau) |
| `tradelines` + current `card_liabilities.payment_status` | `tradelines[]` |
| `tradelines.opened_on` | `opened` as `YYYY-MM-DD`. A JS Date is converted. Null stays null. |
| `tradelines.kind` | `type`: `revolving` → `revolving`, `installment` → `installment`, `loc` → **`loc` (not a card)** |
| `tradelines.closed_at` + liability status | `status`: `open` / `closed`, or `open chargeoff` / `closed chargeoff` / `open collection` / `closed collection` |
| `businesses.age_months` | One age per saved company |
| `clients.custom_fields.business_age_months` | Fallback age when a company row has no `age_months` |

**Money:** Fundhub stores **cents**. The adapter converts to **dollars once**. The engine never sees cents.

**Utilization:** the finance grid returns a **fraction** (0.25 = 25%). The adapter multiplies by **100** so the engine sees **25**.

**A bureau is “available” only if it has a score.** An empty object would be marked available and show score 0. The adapter refuses that.

**Same cards on every bureau.** Fundhub stores one set of tradelines, not three. Each scored bureau gets the **same** line list. That matters for the one-third rule in §6.

### 3.4 Fields the adapter records as missing (not invented)

If a value is not stored, it stays **null**. It is never filled with 0.

Named gaps include: score, inquiries, utilization, negatives, late payments, tradelines, opened date, `hasLLC`, business age, and “no credit pull.”

`hasLLC` is **always** missing. Fundhub has no LLC field.

---

## 4. Score clamps and which bureau is “primary”

### 4.1 `sanitizeScore`

1. Not a finite number → `null`
2. If score **> 9000** → `Math.floor(score / 10)` (example: 8516 → 851)
3. If score **> 850** → **850**
4. If score **< 300** → `null`
5. Else keep the number

On the way **out**, a bureau summary prints `score ?? 0`. A bureau that was never supplied reports **score 0**, not “unknown.” Screens must use the “bureaus assessed” list to tell a real 0 from “we have no file.”

### 4.2 Primary bureau

1. Start with the first **available** bureau, else Experian’s empty slot.
2. Walk Experian → Equifax → TransUnion.
3. Any **available** bureau with a **higher** score wins.

Ties keep the earlier bureau. Primary card dollars are the company-slice base (see §8).

---

## 5. Personal math

All of this is **per bureau first**, then added (see §6).

### 5.1 Walk every tradeline

For each line:

1. Skip if the line is empty.
2. Count it as a **positive** line unless its status is derogatory.
3. Age = months from `opened` year-month to **this month**. Day is ignored. No date → not seasoned.
4. **Seasoned** = age is a number **and age ≥ 24**.

**Clock:** this uses `new Date()`. The same file can change next year when a line crosses 24 months. Tests pin dates at `1990-01` (always seasoned) or `null` (never seasoned).

### 5.2 Card pile (× 5.5)

Track:

- `hasAnyRevolving` — any line with `type === "revolving"` (open or closed, seasoned or not)
- `highestRevolvingLimit` — among revolving lines that are **open** **and** seasoned, the **highest `limit`**

Then:

- **Can card-stack** = `highestRevolvingLimit >= 5000` **and** `hasAnyRevolving`
- **Card dollars** = that limit × **5.5**, or **$0** if the gate fails

A **$5,000** open seasoned card counts. A **$4,999** card does not.

A closed $20,000 card does **not** become the stack card (`open` required). It can still set `hasAnyRevolving`.

A line with no open date cannot be seasoned, so it cannot be the stack card.

**Line of credit (`loc`)** is not revolving. It does **not** become the stack card. It can still count as a “positive” line for thin-file.

### 5.3 Loan pile (× 3.0)

Types that count: `installment`, `auto`, `mortgage`.

Fundhub’s ingest usually stores auto / mortgage / student as `kind: "installment"`, so they still reach this pile.

For each of those lines:

- Amount = `limit` if it is > 0, else `balance`
- Keep it if amount > 0 **and** seasoned **and** **not** derogatory
- Track the **highest** such amount
- `hasAnyInstallment` = any line of those types (even if it failed the amount/seasoned/derog checks)

Then:

- **Can loan-stack** = highest amount **≥ $10,000** **and** `hasAnyInstallment` **and** `lates === 0`
- **Loan dollars** = that amount × **3.0**, or **$0**

**Lates must be a measured zero.** `null` is not zero. Unknown lates → **$0** loan dollars.

**Open is not required** for the loan pick. Closed seasoned installment can still set the high amount.

There is **no** “no lates on that one loan” check beyond the file-level late count. Derogatory **status** on that line still knocks it out of the high-amount list.

### 5.4 Thin file (not dollars; gates advice)

- `positiveTradelinesCount` = every non-derogatory line (any type, open or closed)
- **Thin file** = that count **< 3**
- **File all negative** = that count is **0** **and** `negatives > 0`  
  (`null > 0` is false, so unknown negatives do **not** trip “all negative”)

### 5.5 Per-bureau personal total

```
card dollars + loan dollars
```

---

## 6. The one-third cut (exact)

This is the most missed rule.

**Step A — add available bureaus**

```
card base  = sum of card dollars on every available bureau
loan base  = sum of loan dollars on every available bureau
```

Unavailable bureaus add **0**.

Because Lite copies the **same** cards to every scored bureau, three scored bureaus with the same $10,000 card make a card base of **3 × ($10,000 × 5.5) = $165,000** before any cut.

**Step B — count “ready” bureaus**

A bureau is ready only if it is **available** **and** **fundable** (see §7).

```
if ready-bureau count === 1:
    scale = 1/3
else:
    scale = 1
```

**Zero** ready bureaus → **no cut** (scale 1).  
**Two or three** ready bureaus → **no cut**.  
**Exactly one** ready bureau → personal card and loan bases are each multiplied by **1/3**.

Then:

```
personal total = (card base × scale) + (loan base × scale)
```

So, when every scored bureau has the **same** cards (the Lite adapter’s real case):

| Scored bureaus | Ready bureaus | Personal vs one bureau’s card+loan |
|---|---|---|
| 1 | 0 | **1×** (not ready, no cut) |
| 1 | 1 | **1/3×** (base is 1×, then cut) |
| 3 | 0 | **3×** (demo seed: $412,500) |
| 3 | 1 | **1×** (3 × 1/3) |
| 3 | 2 or 3 | **3×** (no cut) |

The short sheet’s “one bureau ready → cut personal to one-third” is true. What it skipped: the base is already the **sum across scored bureaus**, and **zero** ready bureaus does **not** cut.

---

## 7. Fundable (the “ready” flag)

**Per bureau** and again on the **primary** bureau. Same three checks:

1. `score != null` **and** `score >= 700`
2. utilization is `null` **or** `utilization <= 30`
3. `negatives === 0` (strict; `null` fails)

Not in the ready flag:

- inquiries
- late payments
- company age
- card / loan dollars
- LLC
- income

A file can be **not ready** and still show a **large** dollar number. Ready and dollars do not have to move together.

**Unknown negatives make the file not ready**, same as a dirty file. The adapter says so on the screen so staff do not hunt a credit problem that was never typed in.

---

## 8. Business math

### 8.1 Age brackets (same in the engine and in `business-funding.mjs`)

| Company age (months) | Multiplier |
|---|---|
| not a number, empty, or negative (stack helper) | **0** → **$0** |
| **0–11** | **0.5** |
| **12–23** | **1.0** |
| **24 or more** | **2.0** |

A **0-month** company is **0.5×**, not $0. Unknown / blank age is **$0**.

### 8.2 Engine one-shop slice (inside `computeUnderwrite`)

Company dollars are built only if:

- age is a finite number, **and**
- **primary** bureau `cardFunding > 0`

Then:

```
company dollars = primary card dollars × multiplier
```

That uses the **primary bureau’s own** card dollars (**not** the summed / scaled personal card total).

If there is no card pile on the primary bureau, company dollars are **$0** even with a known age.

### 8.3 Stacked companies (what staff actually see on Lite)

`applyStackedBusinessFunding` **replaces** that one-shop slice when there is at least one resolved age.

For each saved company:

1. Use that row’s `age_months` if it is a finite number ≥ 0
2. Else use the client fallback `business_age_months`
3. Else that slot is unknown → **$0** for that company

Then:

```
stacked company dollars = sum over companies of (primary card dollars × that company’s multiplier)
```

- No listed companies, but a fallback age exists → **one** age (today’s one-shop path)
- No listed companies and no fallback → ages list is empty → engine output is **left alone**
- Two companies, same known age → company slice **doubles**
- Two companies, one aged and one blank with no fallback → only the aged one pays

`can_business_fund` becomes true if stacked company dollars **> 0**.

### 8.4 Present’s stored-row stack (different helper)

`stackedCombinedFromStored` does **not** re-age companies.

If `businessCount` is an integer **> 1** and both stored personal and stored company slices are real numbers:

```
shown total = stored personal + (stored company × company count)
```

If the company slice was never stored, the stored combined total is **left alone** (even with two companies).

Zero or one company → use the stored combined total as-is.

---

## 9. How the Lite total is built

```
personal  = (sum of available bureaus’ card dollars + loan dollars) × scale
company   = stacked company dollars (or the engine’s one-shop slice if no ages list)
combined  = personal + company
```

**Lite banner** (`lite_banner_funding`):

```
primary card dollars, or if that is 0, the scaled card total
if still 0 → null
```

There is **no $15,000 display floor**. `null` means “no figure,” not $0 and not a placeholder. That floor was removed on 2026-08-01.

Closer-call paint (not math):

| Band label | Field |
|---|---|
| Conservative | `lite_banner_funding` |
| Realistic · round 1 | personal total |
| After optimization | combined total |

---

## 10. Present vs Lite

Chris said the **formula is fine**. Both paths stay. They are still **two paths**.

### 10.1 Lite (recompute now)

**Callers**

1. `api/read/underwrite.mjs` — staff GET, org-scoped.
2. `src/sales/cockpit.mjs` — closer live-call payload.

**Steps (same math)**

1. Load tradelines, card liabilities, credit-pull rows, saved companies, client custom fields.
2. `toBureaus(...)` → engine shape + missing-field list + `businessAges`.
3. `computeUnderwrite(bureaus, firstKnownAge)`.
4. `applyStackedBusinessFunding(result, businessAges)`.

**Small differences between the two Lite callers**

| | Read API | Cockpit |
|---|---|---|
| Credit-pull rows | **All** rows, newest first. `triMerge` picks the newest non-sandbox row that has a score. | **Latest one row only** (`LIMIT 1`). |
| Advice sentences | Yes (`buildSuggestions` + `buildReport`). No LLC object is passed. | **No.** Dollars only, plus lender matches. |
| Second utilization voice | Yes (`evaluateUtilization` at 30% default). **Not dollar math.** | No. |

### 10.2 Present (read stored, do not recompute)

**Caller:** `buildCloserDeck` → `engineFromRow` in `src/sales/closer-deck.mjs`.

**It does not import `computeUnderwrite`.**

From the **newest** `crs_results` row (`LIMIT 1`):

**Shown total** — first real number among:

1. `stackedCombinedFromStored({ totalPersonal, totalBusiness, totalCombined, businessCount })` where
   - `totalPersonal` = `result.preapprovals.totalPersonal`
   - `totalBusiness` = `result.preapprovals.totalBusiness`
   - `totalCombined` = `result.preapprovals.totalCombined`  
     else `result.totalCombined`  
     else `result.fundingEstimate`  
     else `result.projectedPreapproval.currentTotal`
   - `businessCount` = how many `businesses` rows exist (ids only; **ages are not read**)
2. If that total is still null **and** the engine block is already “available,” fall back to client fields `analyzer_prequal_amount` or `total_funding_estimate`.

**After-fix number** (Present slide copy; **not** Lite math):

```
result.projectedPreapproval.totalCombined
  ?? result.projectedTotalCombined
  ?? result.lenderReach.afterOptimization
```

If there is no usable FICO, total, after-fix, or reason list → Present says **engine data unavailable**. It does **not** invent zeros.

**Income** is loaded for “closer leverage” and is **not** added into `engine.total`.

### 10.3 Where Present’s stored totals come from

A **live** pull stores `mergeBureauReports(...)` on `crs_results.result`. That merger writes scores, tradelines, inquiries, public records. It does **not** write `preapprovals`.

The full CRS tier engine **does** compute `preapprovals` at pull finish (`src/finance/crs-pull.mjs` → `runTierEngineFromCrsResult`). That combined total is emitted on the `decision.rendered` event as `fundingEstimate`. This writeup does **not** see those event numbers written back onto `crs_results.result`.

The **demo seed** (`src/demo/simulate-client.mjs`) **does** stamp `preapprovals: { totalCombined: 125000 }` on the stored JSON. Present tests use that same stored shape.

So: Present **can** show a stored total when one was saved on the row (demo, older payloads, or any writer that put `preapprovals` on `result`). A live merge-only row may have **no** `preapprovals` key. Then Present follows the fallback chain above.

The pull-time estimator (different file, not Lite) is in the appendix so it is not mixed into Lite’s 5.5 / 3.0 / one-third rules.

---

## 11. What is ignored (not used for Lite dollars)

| Thing | Where it lives | What happens |
|---|---|---|
| **Extra owner** | `businesses.entity_data.extra_owner_name` | Client detail sets `extra_owners_warning: true` if the name is non-blank. **Not passed to Lite.** Does not change the dollar number. |
| **Income** | Experian Income Insight / Equifax IncomeView+ on the pull; survey income on Present | Shown on Present / client detail. **Not an input** to `computeUnderwrite`. |
| **EIN** | `entity_data.ein` | Listed on the business card. **Not** in the dollar engine. |
| **LLC** | Nowhere in Fundhub | Advice **assumes no LLC** (engine default). Dollars do not change. The read API does **not** pass `{ hasLLC }`. |
| **Experian Business / Intelliscore / FSR** | `businessCredit()` on client detail | Shown as 1–100 business scores. **Not** in Lite dollars. |
| **Line of credit as a card** | `kind: "loc"` | Passed through as `type: "loc"`. Counts toward file depth if not derogatory. **$0** card and **$0** loan from that line. |
| **$15,000 banner floor** | Removed 2026-08-01 | `lite_banner_funding` is **null** when no card dollars exist. |
| **Authorized-user vs primary** | No AU field in the adapter | Advice text says “not AU.” The dollar engine **cannot see** AU. A $50k revolving AU line is treated like a primary card if it is open and seasoned. |
| **Names / addresses / employers** | Empty arrays | Informational gap only. |
| **Inquiry count** | Custom fields | Advice only. Does **not** cut dollars. Does **not** fail “ready.” |
| **Survey revenue / target / capital** | Present survey block | Display only. |

---

## 12. Advice — not dollar math

From `src/underwrite/vendor/suggestions.cjs` and labels in `src/underwrite/report.mjs`.

These sentences **do not change** personal, company, or combined dollars. The read API returns them **verbatim**. Report.mjs only labels them.

### 12.1 Flags the dollar engine sets (`optimization`)

| Flag | When it is true |
|---|---|
| `needs_util_reduction` | Primary utilization **> 30** (null does not trip this) |
| `needs_new_primary_revolving` | No revolving line **or** highest seasoned open revolving limit **< $5,000** |
| `needs_inquiry_cleanup` | Inquiry **total > 0** (null total does **not** trip this) |
| `needs_negative_cleanup` | Primary `negatives > 0` |
| `needs_file_buildout` | Thin file **or** file-all-negative |
| `thin_file` / `file_all_negative` | See §5.4 |

### 12.2 Sentence branches (advice only)

**Utilization** (only if `needs_util_reduction`):

- ≥ **80** → “extremely high (80%+)”
- ≥ **50** → “high (50–80%)”
- else → “below ~30%”

**Primary revolving** (if `needs_new_primary_revolving`):

- “Add a strong primary revolving account (not AU) with a $5,000+ limit…”

**Inquiries** (if `needs_inquiry_cleanup`):

- total **> 12** → “high number of recent hard inquiries”
- else → “unnecessary or duplicate”

Suggestions read `total || 0`. The branch only runs when the engine already set the cleanup flag, so a null total does not get this line.

**Negatives** (if `needs_negative_cleanup`):

- **> 5** → “multiple negative accounts”
- else → “some negative accounts”

**File build-out** (if `needs_file_buildout`):

- all-negative → rebuild line
- else if highest revolving **and** highest installment are both **0** → thin / empty line
- else → “add a couple of additional positive tradelines”

**LLC** (this block **always** runs and always pushes one line):

Engine defaults: `hasLLC = false`, `llcAgeMonths = 0`. Live Lite never passes a user object.

- no LLC + fundable → “You’re approved, but you don’t have an LLC…”
- no LLC + not fundable → “You don’t have an LLC yet…”
- LLC age **< 6**
- LLC age **≥ 6 and < 24**
- LLC age **≥ 24** + fundable
- LLC age **≥ 24** + not fundable

**Fallback** (“profile is strong” / “close to approval”) only if **no** earlier sentence was pushed. On the live Lite path, the no-LLC line **always** fires, so this fallback is not reached.

Report.mjs marks any sentence whose listed field was never entered as `restsOnMissingData`. The words are not rewritten.

### 12.3 Second utilization voice (read API only)

`evaluateUtilization` default threshold **0.30** (fraction). Shown beside Lite’s percent. **Not** used to build the dollar total.

---

## 13. Worked examples (from tests)

### 13.1 Fixture 1 — maxed file (`fixtures.test.mjs`)

One bureau (Experian): score 720, util **85%**, inquiries 14, negatives 6, lates 2.

- Open seasoned card **$20,000** → card dollars **$110,000** (20000 × 5.5). Test asserts this.
- Seasoned installment **$30,000**, but lates = 2 → **cannot** loan-stack. Test asserts this.
- Ready? **No** (85% > 30). Test asserts this.
- Missing Equifax / TransUnion inquiry slots become **0**, so inquiry total = **14**. Test asserts this.
- Age 30 is passed in. Company slice (not asserted in that test) = 110000 × 2 = **$220,000**. Combined = **$330,000**. Derived from the same fixture through the engine; the test pins the card line and the ready flag.

### 13.2 Fixture 2 — score only

Score 700, everything else null, no lines.

- Ready? **No** (`negatives` is null, not 0). Test asserts this.
- Banner? **null**.
- Loan dollars withheld.

### 13.3 Fixture 3 — no bureaus

- Ready **false**. Every bureau unavailable.
- `metrics.score` is **0** (trap: not null).
- Banner **null**. Test asserts this.

### 13.4 Demo seed (`adapter.test.mjs`)

Scores 718 / 724 / 731. Largest seasoned open revolving limit **$25,000**. Custom fields empty → negatives and lates **unknown** → no bureau is ready → **no** one-third cut.

```
25,000 × 5.5 = 137,500 per bureau
× 3 scored bureaus = 412,500
```

Test asserts combined **412500** and primary score **731** (TransUnion). The $28,000 Toyota installment adds **$0** because lates were never entered.

### 13.5 Two companies, Lite (`business-funding.test.mjs` + `underwrite-read.test.mjs`)

Primary card dollars **$100,000**, ages `[30]` vs `[30, 30]`:

- One shop company = 100000 × 2 = **$200,000**; combined with $50,000 personal = **$250,000**
- Two shops company = **$400,000**; combined = **$450,000**

Unknown ages add **$0**.

Stored Present helper: personal 100000 + company 50000, count 1 → **150000**; count 2 → **200000**. Test asserts this.

### 13.6 Present stored row (`closer-deck.test.mjs`)

- `preapprovals.totalCombined = 127500` → `engine.total = 127500`
- `projectedPreapproval.totalCombined = 214000` → `engine.afterFix = 214000`
- Two companies on the same stored 100k + 50k slice → **200000** vs **150000**

### 13.7 Tiny card example (same as the short sheet, with the full add-up)

One **$10,000** open seasoned card. Primary card dollars = **$55,000**.

**One scored bureau, not ready:** personal **$55,000**. Company 30 months: **$110,000**. Combined **$165,000**.

**Three scored bureaus, same card, none ready:** personal **$165,000**. Company still uses **primary** $55,000 × 2 = **$110,000**. Combined **$275,000**.

**Three scored bureaus, exactly one ready:** personal cut to **$55,000**. Company still **$110,000**. Combined **$165,000**.

---

## 14. File paths

| File | Role |
|---|---|
| `src/underwrite/vendor/underwriter.cjs` | Lite dollar engine. Thresholds, seasoning, ready flag, one-third scale, one-shop company slice, banner. |
| `src/underwrite/vendor/suggestions.cjs` | Advice sentences. Not dollar math. |
| `src/underwrite/engine.mjs` | Boundary. Re-exports the vendored functions. Upstream pin `71656f0fe1083429f52eeb0aa095cce076a6b33c`. |
| `src/underwrite/adapter.mjs` | Fundhub rows → engine. Cents→dollars, util fraction→percent, LOC not a card, missing-field map. |
| `src/underwrite/business-funding.mjs` | Age multipliers, per-company add-up, Present stored-row multiply. |
| `src/underwrite/report.mjs` | Labels advice. Does **not** recompute dollars. |
| `api/read/underwrite.mjs` | Lite read API. Auth, org scope, stack companies, suggestions, second util voice. |
| `src/sales/cockpit.mjs` | Lite dollars on the closer live-call payload. |
| `src/sales/closer-deck.mjs` | Present path. Stored totals + company-count multiply. |
| `src/http/client-detail.mjs` | `triMerge` scores; `incomeEstimates` (not dollars); `extra_owners_warning` (not dollars). |
| `src/finance/os-grid.mjs` | Utilization fraction Lite converts. Closed and installment lines excluded from that percent. LOC **is** included if open. |
| `src/finance/crs-pull.mjs` | Live pull store + tier engine for events. |
| `src/finance/crs-map.mjs` | Live stored pull shape. No `preapprovals` key. |
| `src/finance/crs-tier.mjs` | Bridge to the full CRS engine at pull time. |
| `public/app/closer-call.js` | Paints Lite bands (labels only). |
| `public/app/present.js` | Present slides read `total` / `afterFix`. |

**Tests that pin the numbers**

- `src/underwrite/fixtures.test.mjs`
- `src/underwrite/adapter.test.mjs`
- `src/underwrite/business-funding.test.mjs`
- `src/http/underwrite-read.test.mjs`
- `src/sales/closer-deck.test.mjs`
- `src/http/client-detail.test.mjs` (extra-owner warning)

---

## 15. Appendix — pull-time full CRS estimator (NOT Lite)

This is **not** the Lite formula Chris said to leave alone. It is the other engine that can produce `preapprovals` at pull time (`vendor/underwriteiq-full/api/lite/crs/estimate-preapprovals.js`).

Present **reads** stored `preapprovals` if they are on the row. It does **not** call this file at deck time.

If those stored numbers were made here, the **base** still uses 5.5 / 3.0 / $5k / $10k / the same age brackets, then **extra cuts** Lite does **not** apply:

| Piece | Full CRS estimator | Lite |
|---|---|---|
| Card base | `max(anchor × 5.5, $5,000)` if an anchor exists | highest open seasoned revolving **≥ $5,000** × 5.5, else $0 |
| Loan base | `max(anchor × 3.0, $10,000)` if an anchor exists | highest seasoned installment/auto/mortgage **≥ $10,000** × 3.0, else $0 |
| Outcome cut | PREMIUM_STACK / FULL_FUNDING = 1.0; FUNDING_PLUS_REPAIR = **0.6**; REPAIR_ONLY / MANUAL_REVIEW / FRAUD_HOLD = **0** | none |
| Utilization cut | excellent 1.0, good 0.9, moderate 0.75, high 0.6, critical 0.4, unknown 0.75 (default if band missing: 0.8) | none on dollars (30% is ready-flag only) |
| Thin-file cut | thin → **0.6** | none on dollars |
| Personal final | `floor(base × outcome × util × thin)` | sum × optional 1/3 |
| Company | card **base** × age multiplier × biz-util × outcome; **$0** if business report missing, hard-block, biz negatives, or UCC caution | primary card × age (then add per company) |
| AU / Intelliscore overlays | functions exist in the file; **v2 comment says only util + thin** are applied to personal | n/a |

Inquiry-pressure and bureau-confidence tables exist in that file and are **not** in the v2 personal product.

---

## 16. UNVERIFIED / stale comments (in code, not used as rules)

| Claim | Reality in the files above |
|---|---|
| `engine.mjs` comment (2): the engine turns unknown negatives / inquiries / lates into **0** via `numOrZero` | The live vendor uses `measuredCount`. Unknown stays **null** and **fails** `=== 0` gates. `numOrZero` is only for limit/balance. |
| `underwrite-read.test.mjs` comment that an unentered negatives count “counts as zero” | The same test’s assertions match the null / not-fundable behavior. The comment is stale. |
| Adapter comment that no open-date field existed | Corrected in-file: `tradelines.opened_on` exists (migration 095). Old rows can still be null. |
| Whether a live production pull’s `crs_results.result` currently carries `preapprovals` | Not written by `mergeBureauReports`. Not seen written back in `crs-pull.mjs`. **UNVERIFIED** for any given live row. Present will then use the fallback chain. |
| AU vs primary for dollars | No AU field. **Cannot** be verified as excluded. |
| Which score model (FICO vs other) Lite uses | Adapter takes whatever `triMerge` already accepted as a 300–850 FICO-like score. Lite itself does not check the model name. |

---

**This is the full UnderwriteIQ rulebook.** No code was changed.
