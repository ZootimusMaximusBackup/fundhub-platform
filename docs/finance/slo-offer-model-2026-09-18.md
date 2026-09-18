# SLO offer — financial model

Date: **2026-09-18**
Owner-set inputs: Chris, direct, this session.
Status: planning model. Nothing here is measured. Every number is labelled
either **owner-set**, **from the repo**, or **assumption**.

---

## 1. The offer in one paragraph

We sell a **$297 blueprint**: a custom, AI-built plan that tells a person
exactly what to fix on their own credit, in what order, to be ready for funding
as fast as possible. They buy it from an ad, fill in their information, and get
the plan. They keep portal access. From there two things happen: our outbound
people call every buyer, and the buyer can book a call themselves. On that call
we sell the funding engagement — **$3,000 deposit against a 10% success fee**.

So the $297 is not the business. It is how we buy a qualified funding lead for
less than nothing.

---

## 2. Inputs

### Owner-set (Chris)

| Input | Value |
|---|---|
| Front-end price | $297 |
| Target cost to get one $297 sale | $150 |
| Funding deposit | $3,000 |

### From the repo (already decided, not assumptions)

| Input | Value | Source |
|---|---|---|
| Success fee | **10% of confirmed approvals** | `docs/CLOSEOUT-FEE-BASIS.md` (owner-set 2026-08-30) |
| Deposit counts toward the fee | Yes — the $3,000 is part of the 10%, not on top | `docs/company-resources/closer-playbook-2026-08-24.md` |
| "Confirmed approval" | A bank yes **with a dollar amount recorded**. A yes with no amount bills nothing. | `docs/CLOSEOUT-FEE-BASIS.md` |

### Assumptions (marked because they are not measured anywhere in this repo)

| Assumption | Low | Expected | High |
|---|---|---|---|
| Buyer books a call (inbound + our outbound combined) | 35% | 45% | 55% |
| Shows up to the call | 60% | 70% | 80% |
| Qualifies (credit + situation good enough to pursue funding now) | 50% | 60% | 70% |
| Closes the $3,000 deposit | 20% | 30% | 40% |
| **Buyer → funding client** (the four above, multiplied) | **2.1%** | **5.7%** | **12.3%** |
| Funding client reaches a confirmed approval | 55% | 70% | 85% |
| Average confirmed approval amount | $40,000 | $60,000 | $75,000 |
| Balance of the fee actually collected | 70% | 85% | 95% |
| Card processing | 3% of everything collected | | |
| Front-end delivery cost per buyer (AI generation + portal) | $8 | | |

**The one number we cannot source.** Average confirmed approval amount. The
$75,000 figure used across the closer material is written there as an *example,
not a promise* — it is not an average and must not be treated as one. Until we
have run enough rounds to measure it, the model carries it as a range. This is
the single input that most changes the answer.

---

## 3. What one buyer is worth

**Front end, per $297 buyer:**

| | |
|---|---|
| Revenue | $297 |
| Ad cost | −$150 |
| Processing (3%) | −$9 |
| Delivery | −$8 |
| **Net** | **+$130** |

The front end pays for itself and then some. **Every funding client after this
point is bought with money the front end already made.**

**Break-even cost per sale is $280.** We can pay up to $280 to get a $297 buyer
and still not lose a dollar on the front end. At $150 we have $130 of room per
buyer. That is the number to watch when ads get expensive — not $150.

**Back end, per funding client (expected case):**

| | |
|---|---|
| Deposit | $3,000 |
| Confirmed approval (70% of clients × $60,000) | $42,000 average across all clients |
| 10% fee on that | $4,200 |
| Less the deposit already paid | −$2,100 (only for the 70% who got approved) |
| Balance billed | $2,100 per client on average |
| Collected at 85% | **$1,785** |
| **Total per funding client** | **$4,785** |

**Back end, per $297 buyer (expected case):** 5.7% × $4,785 = **$273**.

**So one $297 buyer is worth about $403 in total, and costs $167 to acquire and
deliver.** That is a 2.4× return before staff pay.

---

## 4. Monthly model — expected case

| | $30,000/mo ads | $60,000/mo ads | $100,000/mo ads |
|---|---|---|---|
| $297 buyers | 200 | 400 | 667 |
| Calls booked | 90 | 180 | 300 |
| Calls held | 63 | 126 | 210 |
| Qualified on the call | 38 | 76 | 126 |
| **Funding clients closed** | **11** | **23** | **38** |
| Front-end revenue | $59,400 | $118,800 | $198,000 |
| Deposits collected | $33,000 | $69,000 | $114,000 |
| Fee balances collected | $19,635 | $41,055 | $67,830 |
| **Total collected** | **$112,035** | **$228,855** | **$379,830** |
| Ad spend | −$30,000 | −$60,000 | −$100,000 |
| Processing + delivery | −$4,961 | −$10,066 | −$16,731 |
| **Before staff pay** | **+$77,074** | **+$158,789** | **+$263,099** |

## 5. Monthly model — all three cases at $60,000/mo ad spend

| | Low | Expected | High |
|---|---|---|---|
| $297 buyers | 400 | 400 | 400 |
| **Funding clients closed** | **8** | **23** | **49** |
| Front-end revenue | $118,800 | $118,800 | $118,800 |
| Deposits collected | $24,000 | $69,000 | $147,000 |
| Fee balances collected | $6,160 | $41,055 | $141,491 |
| **Total collected** | **$148,960** | **$228,855** | **$407,291** |
| Ad spend | −$60,000 | −$60,000 | −$60,000 |
| Processing + delivery | −$7,669 | −$10,066 | −$15,419 |
| **Before staff pay** | **+$81,291** | **+$158,789** | **+$331,872** |

**The low case still works.** That is the point of this offer. Even if only 8 of
400 buyers ever become funding clients, the front end covers the ads and the
deposits are profit.

---

## 6. When the cash actually lands

Not all of this arrives the same month.

| Money | Timing |
|---|---|
| $297 | Same day |
| $3,000 deposit | Days 3–30 after the buy (outbound takes time to reach them) |
| Fee balance | 45–90 days after the deposit — a funding round has to run and approvals have to come back with amounts on them |

So month one collects the front end and some deposits. **Balances do not show up
until roughly month three.** Do not read month one and conclude the back end is
broken.

Rough ramp at $60,000/mo ad spend, expected case:

| | Month 1 | Month 2 | Month 3 | Month 4+ |
|---|---|---|---|---|
| Collected | $164,000 | $198,000 | $229,000 | $229,000 |
| After ads and processing | $94,000 | $128,000 | $159,000 | $159,000 |

---

## 7. What breaks this

In the order that matters.

1. **Cost per $297 sale climbs past $280.** Then the front end stops paying for
   the leads and every funding client starts costing real money. Watch this
   weekly. $150 is the target, $280 is the wall.
2. **The qualified rate.** If most buyers are people whose credit is too far
   gone to fund in the next 90 days, the call volume looks great and the close
   rate looks terrible. This is what the survey is for (section 8).
3. **Confirmed approvals with no dollar amount.** A bank yes with no amount
   recorded bills **nothing** — that is the rule in `docs/CLOSEOUT-FEE-BASIS.md`.
   If advisors do not write the amounts in, the back end silently disappears
   from the model even though the work got done.
4. **Balance collection.** The $3,000 is in hand. The remaining $1,000–$4,500 is
   an invoice, and invoices need chasing.

---

## 8. The survey — yes, before the call

Chris asked out loud whether to survey. Yes, and put it **between the purchase
and the booking**, not after the booking. It costs nothing and it sorts every
buyer into "call this person today" or "nurture."

Six questions, all one tap:

1. What is your credit score right now? (under 600 / 600–679 / 680–719 / 720+)
2. Any collections, charge-offs, or late payments in the last 12 months? (yes /
   no / not sure)
3. Do you have a registered business? (yes, over 2 years / yes, under 2 years /
   no, not yet)
4. How much funding are you trying to get? (under $25k / $25–50k / $50–100k /
   $100k+)
5. How fast do you need it? (this month / 1–3 months / just planning)
6. If we showed you the fastest path, could you start this week? (yes / need to
   talk to someone / no)

**Route on it:** 680+ with a business and "this month" goes straight to a booked
call with the closer. Under 600 goes to nurture and the do-it-yourself path, and
gets re-scored in 60 days. Everyone in between gets outbound.

That single split is worth more than any change to the ad.

---

## 9. What I need from you to make this real

One number, and it changes the whole back end: **the average confirmed approval
amount** across rounds we have actually closed. If nobody has it yet, say so and
we run on the $60,000 middle figure until we have measured ten rounds.

---

## Related

* `docs/CLOSEOUT-FEE-BASIS.md` — how the 10% is calculated
* `docs/ops/2026-09-18-outside-financing-not-approved.md` — why the SLO is the
  funding path now
* `docs/company-resources/closer-slo-pipeline-2026-09-18.md` — the one-pager for
  the closer
