# SLO offer — financial model

Date: **2026-09-18**
Owner-set inputs: Chris, direct, this session.
Status: planning model. Every number is labelled either **owner-set**, **from
the repo**, or **assumption**.

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
| **Average funding deal** | **$100,000** (owner-set 2026-09-18; Chris expects it to run higher, $100k is the round number for planning) |
| **Closer front-end pay** | **16.67% of the deposit collected** (owner-set 2026-09-18 — see §5a; this replaces the flat $500) |

### From the repo (already decided, not assumptions)

| Input | Value | Source |
|---|---|---|
| Credit repair, done for you | **$1,000, charged once** (not monthly — owner-set) | `src/config/offers.mjs` `REPAIR_DFY` |
| Credit repair trial | **$200, charged once**, capped at 2 dispute rounds | `src/config/offers.mjs` `REPAIR_TRIAL`; cap owner-set 2026-09-04 |
| Success fee | **10% of confirmed approvals** | `docs/CLOSEOUT-FEE-BASIS.md` (owner-set 2026-08-30) |
| Deposit counts toward the fee | Yes — the $3,000 is part of the 10%, not on top | `docs/company-resources/closer-playbook-2026-08-24.md` |
| "Confirmed approval" | A bank yes **with a dollar amount recorded**. A yes with no amount bills nothing. | `docs/CLOSEOUT-FEE-BASIS.md` |
| Closer back end | **0.25% of amount funded**, per round, paid whether or not the fee is collected | `src/commissions/commission-model-open-questions.md` #2, #3 |
| Funding advisor back end | **0.25% of amount funded** | same |

### Assumptions (marked because they are not measured anywhere in this repo)

| Assumption | Low | Expected | High |
|---|---|---|---|
| Buyer books a call (inbound + our outbound combined) | 35% | 45% | 55% |
| Shows up to the call | 60% | 70% | 80% |
| Qualifies (credit + situation good enough to pursue funding now) | 50% | 60% | 70% |
| Closes the $3,000 deposit | 20% | 30% | 40% |
| **Buyer → funding client** (the four above, multiplied) | **2.1%** | **5.7%** | **12.3%** |
| Buyer takes the **$200 repair trial** | 6% | 12% | 20% |
| Buyer takes **$1,000 repair done-for-you** | 3% | 6% | 10% |
| Funding client reaches a confirmed approval | 55% | 70% | 85% |
| Balance of the fee actually collected | 70% | 85% | 95% |
| Card processing | 3% of everything collected | | |
| Front-end delivery cost per buyer (AI generation + portal) | $8 | | |
| **Repair fulfillment** | **20% of repair revenue** (owner-set 2026-09-18) | | |
| **Funding fulfillment** | **$1,000 per funding client** (owner-set 2026-09-18) | | |

**The average deal size is no longer the open question.** Chris set it at
$100,000 on 2026-09-18. What is still unmeasured is how many clients reach a
**confirmed** approval — a bank yes with an amount actually written against it.
That is now the number that moves the answer most.

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
| 10% of a $100,000 approval | $10,000 |
| Less the $3,000 already paid | balance of $7,000 |
| Only 70% of clients reach a confirmed approval | $4,900 average balance billed |
| Collected at 85% | **$4,165** |
| **Total per funding client** | **$7,165** |

**Back end, per $297 buyer (expected case):** 5.7% × $7,165 = **$408**.

### The whole stack — every line a buyer can pay us

This is the answer to "how much does one $297 buyer actually generate." Five
revenue lines, expected case, per **1,000 buyers**:

| Line | Take-up | Per 1,000 buyers | **Per buyer** |
|---|---|---|---|
| $297 blueprint | 100% | $297,000 | **$297** |
| $200 repair trial | 12% | $24,000 | **$24** |
| $1,000 repair done-for-you | 6% | $60,000 | **$60** |
| $3,000 funding deposit | 5.7% | $171,000 | **$171** |
| ~$7,000 success-fee balance | 5.7% × 70% reach × 85% collected | $237,405 | **$237** |
| **Total** | | **$789,405** | **$789** |

**One $297 buyer generates about $789. We pay $150 to get them. That is 5.3× on
ad spend, gross.**

### And what it costs — per buyer

| Cost | Per buyer |
|---|---|
| Ad spend | $150.00 |
| Card processing, 3% of everything collected | $23.67 |
| Blueprint delivery | $8.00 |
| Repair fulfillment, 20% of $84 of repair revenue | $16.80 |
| Funding fulfillment, $1,000 × 5.7% of buyers | $57.00 |
| Sales commission, $850 × 5.7% of buyers | $48.45 |
| **Total cost per buyer** | **$303.92** |

**Net: about $485 per buyer, on $150 of ad spend. That is 3.2× net, after
everything except payroll, software and overhead.**

**Per funding client, once its own costs come out:**

| | |
|---|---|
| Deposit + collected fee balance | $7,165 |
| Commission | −$850 |
| Fulfillment | −$1,000 |
| Processing | −$215 |
| **Net per funding client** | **$5,100** |

Where that money sits: **38% of it is the front end and repair** — cash that
lands within thirty days and does not depend on a single funding deal closing.
**62% is the funding engagement**, and $237 of it is the fee balance, which is
an invoice somebody has to chase 90 days later.

### The repair lines and the funding line are mostly different people

Worth saying plainly, because it changes how the survey should route. The buyer
who scores 680+ with a business goes to the closer for the $3,000 engagement.
The buyer at 560 with recent charge-offs cannot be funded now — that person is
the $200 trial or the $1,000 done-for-you. **Right now that second group is
worth nothing to us; with the repair offers in the flow they are worth $24 and
$60 a head across the whole buyer base.** Same ads, same $297, no extra
acquisition cost.

---

## 4. Monthly model — expected case

| | $30,000/mo ads | $60,000/mo ads | $100,000/mo ads |
|---|---|---|---|
| $297 buyers | 200 | 400 | 667 |
| Calls booked | 90 | 180 | 300 |
| Calls held | 63 | 126 | 210 |
| Qualified on the call | 38 | 76 | 126 |
| **Funding clients closed** | **11** | **23** | **38** |
| $297 blueprints | $59,400 | $118,800 | $198,000 |
| $200 repair trials | $4,800 | $9,600 | $16,000 |
| $1,000 repair done-for-you | $12,000 | $24,000 | $40,000 |
| $3,000 deposits | $33,000 | $69,000 | $114,000 |
| Success-fee balances | $45,815 | $95,795 | $158,270 |
| **Total collected** | **$155,015** | **$317,195** | **$526,270** |
| Ad spend | −$30,000 | −$60,000 | −$100,000 |
| Processing + blueprint delivery | −$6,250 | −$12,716 | −$21,124 |
| Repair fulfillment (20%) | −$3,360 | −$6,720 | −$11,200 |
| Funding fulfillment ($1,000/client) | −$11,000 | −$23,000 | −$38,000 |
| Sales commission (§5a) | −$9,350 | −$19,550 | −$32,300 |
| **Left over** | **+$95,055** | **+$195,209** | **+$323,646** |

**The two repair lines add $16,800 a month at $30,000 of ad spend and $33,600 at
$60,000** — off buyers we already paid for, who were never going to close a
funding deal anyway.

**Fulfillment is now costed** (owner-set 2026-09-18): repair runs at **20% of
repair revenue**, funding at **$1,000 per funding client**. Both are in the
tables above. Neither is measured — they are Chris's working figures, and the
repair one in particular should be checked against a real dispute round, since
the $200 trial is capped at 2 rounds and priced as a proof of concept.

## 5. Monthly model — all three cases at $60,000/mo ad spend

| | Low | Expected | High |
|---|---|---|---|
| $297 buyers | 400 | 400 | 400 |
| **Funding clients closed** | **8** | **23** | **49** |
| $297 blueprints | $118,800 | $118,800 | $118,800 |
| $200 repair trials | $4,800 | $9,600 | $16,000 |
| $1,000 repair done-for-you | $12,000 | $24,000 | $40,000 |
| $3,000 deposits | $24,000 | $69,000 | $147,000 |
| Success-fee balances | $21,560 | $95,795 | $276,973 |
| **Total collected** | **$181,160** | **$317,195** | **$598,773** |
| Ad spend | −$60,000 | −$60,000 | −$60,000 |
| Processing + blueprint delivery | −$8,635 | −$12,716 | −$21,163 |
| Repair fulfillment (20%) | −$3,360 | −$6,720 | −$11,200 |
| Funding fulfillment ($1,000/client) | −$8,000 | −$23,000 | −$49,000 |
| Sales commission | −$6,200 | −$19,550 | −$45,325 |
| **Left over** | **+$94,965** | **+$195,209** | **+$412,085** |

**The low case still works.** That is the point of this offer. Even if only 8 of
400 buyers ever become funding clients, the front end covers the ads and the
deposits are profit.

---

## 5a. Sales commission

**Owner change, 2026-09-18.** The closer's front-end pay moves from a **flat
$500 per deposit** to **a percentage of the deposit collected, hardened at the
rate $500 is of $3,000: 16.67%.**

On a full $3,000 deposit the two are the same money — $500. The difference shows
up on a part-paid deposit:

| Deposit collected | Old flat rule | New percentage rule |
|---|---|---|
| $3,000 | $500 | $500 |
| $1,500 | $500 | $250 |
| $1,000 | $500 | $167 |

The old rule paid the whole $500 the moment any deposit landed. The new one pays
in step with the money. **This is a configuration change, not a code change** —
the commission rule moves from `calc_method = 'flat'` to `percent` 16.67 on
`amount_basis = 'deposit_collected'`. `src/commissions/commission-model-open-questions.md`
#1 anticipated exactly this swap.

Everything else is unchanged: closer 0.25% of funded, funding advisor 0.25% of
funded, both earned on the funding date whether or not we collect the fee.

Per funding client, expected case:

| | |
|---|---|
| Closer, front end — 16.67% of a $3,000 deposit | $500 |
| Closer, back end — 0.25% of $100,000 funded (70% of clients) | $175 |
| Funding advisor, back end — 0.25% of funded | $175 |
| **Total commission per funding client** | **$850** |

Monthly: −$9,350 at $30k ad spend, −$19,550 at $60k, −$32,300 at $100k. Those
are the rows already in §4.

That is before hourly pay, outbound staff, software, and fulfillment labour —
none of which exist in this repo as numbers I can use.

**Two things about the commission rules worth knowing:**

1. **No deposit, no closer commission.** Pay fires on money in the door, not on
   the signature. A closed deal with nothing collected pays nothing at all — not
   a pending amount. The closer's dashboard will show a closed deal with no
   commission against it, and somebody will ask about it.
2. **Back-end commission is paid whether or not we collect the fee.** It is
   earned when the round funds. So if balance collection slips, we still pay the
   0.5% on it. That makes §7's point about collection a real cost, not just
   missed revenue.

**Still not loaded.** `013_commission_rules.sql` seeds zero rates. The decision
exists in two places and the system calculates nothing for anybody until
somebody enters the rows.

---

## 6. When the cash actually lands

Not all of this arrives the same month.

| Money | Timing |
|---|---|
| $297 | Same day |
| $3,000 deposit | Days 3–30 after the buy (outbound takes time to reach them) |
| Fee balance | 45–90 days after the deposit — a funding round has to run and approvals have to come back with amounts on them |

Month one collects the front end and the deposits. **Balances do not show up
until roughly month three.** Do not read month one and conclude the back end is
broken.

Ramp at $60,000/mo ad spend, expected case, after ads, processing and
commission:

| | Month 1 | Month 2 | Month 3+ |
|---|---|---|---|
| Collected | $187,800 | $235,800 | $283,595 |
| **Left over** | **+$107,466** | **+$150,001** | **+$192,337** |

---

## 7. What breaks this

In the order that matters.

1. **Cost per $297 sale climbs past $280.** Then the front end stops paying for
   the leads and every funding client starts costing real money. Watch this
   weekly. $150 is the target, $280 is the wall.
2. **Confirmed approvals with no dollar amount.** A bank yes with no amount
   recorded bills **nothing** — that is the rule in `docs/CLOSEOUT-FEE-BASIS.md`.
   If advisors do not write the amounts in, the back end silently disappears
   from the model even though the work got done, **and we still pay the 0.5%
   back-end commission on it.** This is the most expensive failure available
   here and it is an admin failure, not a sales one.
3. **The qualified rate.** If most buyers are people whose credit is too far
   gone to fund in the next 90 days, the call volume looks great and the close
   rate looks terrible. This is what the survey is for (§8).
4. **Balance collection.** At a $100,000 deal the balance is **$7,000** — more
   than twice the deposit. This is no longer a rounding error. Most of the money
   in this business is now an invoice that has to be chased.

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

## 9. Can we afford $60,000 a month?

Yes, but not in week one. We have **$15,000 available for ads**, and the money
recycles in seven days — Commas holds 72 hours, then 2–3 business days to the
checking account. So the cash tied up at any moment is **seven days of ad
spend**, not a month of it.

**Rule: daily ad spend = cash on hand ÷ 10.** Seven days of float plus a buffer.
$15,000 supports $1,500/day today, which is $45,000 a month.

$60,000/month is **$2,500/day, and that lands in week 6** — the float grows into
it out of front-end revenue. We start at $500/day, which risks $3,500 before the
first money comes back. Week-by-week ramp with the bank balance at each step:
**`docs/finance/slo-cash-flow-scaling-2026-09-18.md`**.

---

## 10. What I still need

**How many funding clients reach a confirmed approval** — a bank yes with a
dollar amount actually recorded. The model runs on 70%. Nobody has measured it.
At $100,000 deals this single percentage swings the monthly result by roughly
$50,000 at $60,000/mo ad spend.

---

## Related

* `docs/finance/slo-calculator.html` — the interactive version of this model.
  Open it in a browser, drag the sliders. Same numbers, no spreadsheet.
* `docs/CLOSEOUT-FEE-BASIS.md` — how the 10% is calculated
* `src/commissions/commission-model-open-questions.md` — the comp decisions
* `docs/ops/2026-09-18-outside-financing-not-approved.md` — why the SLO is the
  funding path now
* `docs/company-resources/closer-slo-pipeline-2026-09-18.md` — the one-pager for
  the closer
