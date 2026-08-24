# Ads money model — survey mix, then $20k math

**Date:** 2026-08-24  
**Who this is for:** Chris, deciding whether to turn ads back on.

This is **not** a one-offer shop. Fundhub sells a stack. A booked call can turn into a check, a smaller plan, a course, or a $32 file read. The live list is `src/config/offers.mjs`. The live sell path is the Present deck (`public/app/present.js`).

Numbers Chris gave for ads are the ad truth. Offer prices come from the repo. **The buy mix now comes from real survey scores on booked ClickFunnels people** — not a made-up table.

Evidence: [`ads-revenue-model-2026-08-24-evidence/metrics.json`](ads-revenue-model-2026-08-24-evidence/metrics.json)

---

## 1. His ad numbers (do not swap these)

**Cost per booked call** means: ad spend divided by people who set a call.

| What | Number | Whose number |
|------|--------|--------------|
| Account | Fundhub Portfolio. Budget sits on the campaign. | Chris |
| Pixel | 2403674420141513 | Chris |
| Facebook spend, all in | about **$680** | Chris |
| Spend through Aug 15 | about **$322.89** | Chris |
| Calls Paul booked by Aug 15 | **16** | Chris |
| Cost per booked call | about **$33** | Paul / Chris |
| Scale question | **$20,000** ad spend in a month | Chris |

CRM context only — **not** the $33 math:

- **40** ClickFunnels booking rows now (**35** different people, **34** after dropping one demo). The old sheet said 33. The live count moved.
- **20** of those rows were through Aug 15
- **0** real deposits and **0** funded from this group (one $1 test pull does not count)

Do not treat those zeros as a live close rate. The group is too new and too thin.

---

## 2. What this company is

Fundhub helps a person get money for a business, clean up a credit file, or learn the system and run it themselves.

A booked call is a sit-down. On that call the closer can sell **more than one thing**. The Present deck says it out loud: **every call should make money**, and if they say no to the top offer, step down the ladder.

```text
Ad → booked call
        │
        ├─ $32 soft-pull (often first — a file read on the call)     CASH
        │
        ├─ FUNDING path (usually score 700+, cash $3,000)
        │     $3,000 now + 10% of money they later get from lenders
        │     combo (funding + repair) is still cash — survey cannot size it
        │
        ├─ REPAIR path                                              CASH
        │     full repair $1,000  →  one-round trial $200
        │
        └─ COURSES (the only things they can finance)
              Funding Mastery $5,000
              UnderwriteIQ pack $1,000 (can go up to $5,000)
```

---

## 3. The two courses, and what can be financed

Chris locked this on 2026-08-24. **Only the two courses can go on payments.**

| Course | Plain name | Price | Where it lives |
|--------|------------|-------|----------------|
| Big course | **Funding Mastery course (A to Z)** | **$5,000** | `src/config/offers.mjs` `FUNDING_MASTERY` · product `funding-mastery` |
| Smaller course | **UnderwriteIQ Deliverables Package** | **$1,000** default, **$1,000–$5,000** | `src/config/offers.mjs` `UWIQ_DELIVERABLES` · product `consulting-package` |

There is no third course in the catalog.

**Payments partner:** **Commas** (the payments company in `src/payments`). Not a new name.

**Who can finance a course**

- Score they typed is **500 or higher** → they can finance a course
- Terms Chris said: **12 to 24 months**
- Rate Chris said: **about 20%**. The repo has **no** saved rate. That 20% is owner-said this day.
- **Not sure**, or no score → they pay cash for a course or they do not buy it

**What is cash up front — no financing**

- Funding, we do it — **$3,000**
- Funding + repair combo — **$4,000**
- Full repair — **$1,000**
- Repair trial — **$200**
- Soft-pull — **$32**

The sales file still marks repair and the trial as “financing available.” Chris just overrode that. **Course only.** The deck may still show the old note until someone changes the file.

**Who is a usual funding buyer**

- Score they typed is **700 or higher**
- They do **not** need a business. Personal is fine.
- They pay the **$3,000 in cash**. They cannot put the $3,000 on Commas.

### How the $3,000 and the 10% fit together

The **$3,000 is not extra on top of 10%**. It counts toward the 10%. They pay $3,000 now. After a lender funds them, they pay the **rest** of the 10%.

Example: funded for $75,000 → 10% is $7,500 → they already paid $3,000 → **$4,500 later**.

If 10% is smaller than $3,000, this sheet counts later cash as **$0**.

### Does Commas pay Fundhub up front?

When Commas says the payment went through, Fundhub writes the **full price** as money in. That is “cash now” on this sheet — including a financed course.

The repo does **not** say whether Commas keeps a cut of the ~20%. That cut is **unknown**. If they keep one, cash now is a bit less than the list price.

---

## 4. What the booked people actually typed

Pulled 2026-08-24 from live ClickFunnels bookings. **34** real booked people. **17** typed a score. **17** left it blank.

The mix uses the **17 who answered**. The other 17 are a hole. Half the books have no score on file.

### Score they typed (17 people)

| Score | People | Lane |
|-------|--------|------|
| 750+ | **3** | Usual funding buyer |
| 700–749 | **2** | Usual funding buyer — **thin** |
| 650–699 | **4** | Not the usual funding buyer. Can finance a course. |
| 580–649 | **4** | Same |
| 500–579 | **3** | Same |
| Not sure | **1** | Cannot finance a course. **Thin.** |
| Below 500 | **0** | The form has no box under 500 |

**Lanes**

- **700+ (can buy $3k funding, cash):** **5 of 17**
- **500–699 (course finance, not the usual $3k buyer):** **11 of 17**
- **Not sure (cash only, cheap):** **1 of 17**

### Cash they said they have, next to score

This is why some 700+ people still do not buy the $3k.

| Score | Cash they said they have | People |
|-------|--------------------------|--------|
| 750+ | $5k–$25k | 2 |
| 750+ | $25k–$100k | 1 |
| 700–749 | Less than $1k | **2** |
| 500–699 | Less than $1k | 7 |
| 500–699 | $1k–$5k | 1 |
| 500–699 | $5k–$25k | 3 |
| Not sure | Less than $1k | 1 |

Read that in English:

- All **3** people at 750+ said they have **$5k or more**. They can pay $3k cash.
- Both people at **700–749** said they have **under $1k**. Score says funding. Wallet says they do not have the $3k sitting there. **Thin cell (n=2).**
- **7 of 11** people at 500–699 also said under $1k. They cannot easily cash $1k repair. They **can** finance a course.

### Target amount (what they want later)

Most who answered want **$50k–$100k** (8 people). Four want under $50k. Four want $200k or more.

Target size changes the **later 10%**, not which offer they start on.

### Business

Owner rule: funding does **not** need a business.

In this sample, all **5** people at 700+ said they have a business anyway. The **2** “personal only” people were 500–579 and Not sure — not the usual funding buyer.

---

## 5. Close rate we used

**Close** means: a booked call that **pays for any catalog offer**.

The repo has **no** saved Fundhub close rate. The closer “20 deposits a month” belt is a headcount goal, **not** a close rate. We did not use it.

**Assumed average booked-call close: 15–20%.**  
**Working number: 18%.**  
This is still a guess. This ad group has **0** paid closes.

---

## 6. $20,000 a month at $33 per booked call

```text
$20,000 ÷ $33  ≈  606 booked calls
606 × 18%      ≈  109 people who pay for something
```

| Close we use | Closes from 606 calls |
|--------------|------------------------|
| 15% | **91** |
| **18% (working)** | **109** |
| 20% | **121** |

---

## 7. The educated mix (from the 17 scores)

Each of the 17 rows was placed on the offer they can **actually pay** under the rules above. Percents are **people / 17**.

| What they buy | Share | People of 17 | Why |
|---------------|-------|--------------|-----|
| Funding $3,000 cash | **3/17 (~18%)** | 3 | The three 750+ people with $5k+ on hand. |
| Funding + repair | **0/17** | 0 | Survey never asks about bad items on the file. We did not invent a %. The deck still has this offer. |
| Full repair $1,000 cash | **2/17 (~12%)** | 2 | 500–699 people who have at least $1k and are not the usual funding buyer. |
| Repair trial $200 cash | **1/17 (~6%)** | 1 | One leftover cash-poor 500–699 who does not take a course. **Thin.** |
| UnderwriteIQ pack $1,000 (can finance) | **5/17 (~29%)** | 5 | Cash-poor 500–699. They can finance the smaller course. They cannot easily cash repair. |
| Funding Mastery $5,000 (can finance) | **5/17 (~29%)** | 5 | Two 700–749 people with under $1k (score says funding, no $3k cash) **plus** three 500–699 people with $5k+ who can finance the big course. The n=2 half is **thin.** |
| Soft-pull $32 only | **1/17 (~6%)** | 1 | The one “Not sure.” Cannot finance a course. **Thin n=1.** |

**Fork he can flip:** if those two 700–749 people still pay $3k on a card, funding becomes **5/17** and Mastery becomes **3/17**. This sheet assumes they do **not** pay $3k they said they do not have.

### At 18% close (109 people)

| What they buy | People | Cash now | Later cash **if they get funded** |
|---------------|--------|----------|-----------------------------------|
| Funding $3,000 | 19 | $57,000 | Rest of 10% |
| Combo | 0 | $0 | — |
| Repair $1,000 | 13 | $13,000 | $0 |
| Trial $200 | 6 | $1,200 | $0 |
| UnderwriteIQ $1,000 | 32 | $32,000 | $0 |
| Mastery $5,000 | 32 | $160,000 | $0 |
| Soft-pull $32 | 7 | $224 | $0 |
| **Total** | **109** | **$263,424** | **only the 19 funding people** |

Most of the cash now is the **two courses**, because most booked people are 500–699 and financing is how they buy.

Those 19 funding people, later cash **if they fund**:

| If each is funded for | Rest of 10% each | Later cash from 19 people |
|-----------------------|------------------|---------------------------|
| $50,000 | $2,000 | **$38,000** |
| $75,000 | $4,500 | **$85,500** |
| $100,000 | $7,000 | **$133,000** |

We do **not** know what share get funded. If only half of the 19 get $75,000, later cash is about **$43,000**. That “half” is a what-if.

### Same mix, the 15–20% band

| | Closes | Cash now | Later if **all**  funding people fund at $75k | Later if **half** fund at $75k |
|--|--------|----------|-----------------------------------------------|--------------------------------|
| 15% close | 91 | **$222,160** | $72,000 (16 people) | ~$36,000 |
| **18% close** | **109** | **$263,424** | **$85,500** (19 people) | **~$43,000** |
| 20% close | 121 | **$294,624** | $94,500 (21 people) | ~$47,000 |

**Working read at $20k ads + $33 per booked call + 18% close + this survey mix:**

- About **$263,000** in the door that month (a lot of it is financed courses, booked at full list price when Commas says paid)
- About **$43,000 to $86,000** later from the 10%, **only if** those 19 funding clients actually get funded at about $75,000
- Ads cost **$20,000**

That is a model. It is not a promise. Zero paid closes from this ad group yet. The mix sits on **17** survey answers.

---

## 8. Timing, in one line

| Bucket | When it hits the bank | What it is |
|--------|----------------------|------------|
| Cash now | Same month as the close, give or take | $32, $200, $1,000, $3,000, $5,000. Financed courses count here when Commas says paid. |
| Success-fee cash | After a lender funds them | Rest of 10% on funding only |

Repair, trial, both courses, and the $32 read have **no** success fee.

---

## 9. What this sheet did not do

- Did not use Alec / Legacy Strong prices
- Did not use “20 deposits a month” as a close rate
- Did not treat CRM bookings as the $33 cost-per-call math
- Did not invent a live close rate or fund rate from 0 deposits
- Did not finance the $3k, repair, or trial
- Did not invent a combo % — survey cannot size it
- Did not use the old made-up 18% mix table

---

## 10. What is still a guess

1. **Close rate** — 18% is assumed. Not measured.
2. **Fund rate** — nobody from this ad group has been funded. Later 10% cash is a what-if.
3. **Commas yes vs the score they typed** — 500+ on the form is not the same as Commas saying yes.
4. **Whether Commas keeps a cut** of the ~20% on a financed course.
5. **The 17 people with no score** — half the books. Mix ignores them.
6. **The n=2 and n=1 cells** — 700–749 with no cash, and Not sure. Thin.
7. **UnderwriteIQ price** — this sheet uses **$1,000**. The catalog allows up to **$5,000**.

---

## 11. Knobs Chris can change

1. Cost per booked call (now **$33**)
2. Close rate (now **18%**, band 15–20%)
3. The card-fork: do the two 700–749 people with under $1k still pay $3k?
4. UnderwriteIQ price (now **$1,000**)
5. How many funding clients actually get funded, and for how much
6. Repair $1,000 once vs monthly
