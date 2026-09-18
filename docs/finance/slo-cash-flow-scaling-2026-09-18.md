# Scaling the SLO offer on $20,000 — the cash cycle model

Date: **2026-09-18**
Owner-set inputs: Chris, direct.
Companion to `docs/finance/slo-offer-model-2026-09-18.md`, which answers "what
does this make." This one answers **"how fast can we grow it with the cash we
actually have."**

---

## The problem in one paragraph

We have **$15,000** to spend (owner-corrected 2026-09-18 — $20,000 is the
account balance, $15,000 is what is actually available for ads). Money spent on
ads leaves the account today. Money a
customer pays comes back **seven days later** — Commas holds it 72 hours, then
it takes 2–3 business days to reach the checking account, usually next day once
released. So every dollar of ad spend is locked up for a week before it can be
spent again. Growth is not limited by whether the offer works. It is limited by
how many times we can turn the same $20,000 over.

---

## The one number that governs everything

**Money in flight = daily ad spend × 7.**

That is the amount of our own cash sitting in Commas at any moment, already
spent on ads and not yet available. It never goes down while ads are running.

| Daily ad spend | Monthly ad spend | Cash locked in flight |
|---|---|---|
| $500 | $15,000 | $3,500 |
| $1,000 | $30,000 | $7,000 |
| $1,500 | $45,000 | $10,500 |
| $2,143 | $64,300 | $15,000 — **every dollar we have** |
| $3,500 | $105,000 | $24,500 — far more than we have |

**The rule to remember: daily ad spend = cash on hand ÷ 10.**

That is seven days of float plus a 30% buffer for a slow Commas release, a
chargeback, a weekend, or a bank holiday. At $15,000 available that is **$1,500 a
day, which is $45,000 a month** — and that is the ceiling on day one, not the
starting point.

**$60,000/month is reachable, but it is a week 6 number, not a week 1 number.**
The float has to grow into it, and it does that on its own out of front-end
revenue. See the ramp below.

---

## What comes back, and when

Per **$1** of ad spend, at a $150 cost per sale:

| Money | Arrives | Per $1 of ad spend |
|---|---|---|
| $297 front end, less 3% processing | **Day 7** | **$1.92** |
| $200 and $1,000 repair sales, less processing | **Day ~28** | **$0.54** |
| $3,000 deposit, less processing and the closer's 16.67% | **Day ~28** | **$0.92** |
| Fee balance, less processing | **Day ~90** | **$1.75** |
| | | **$5.13 total** |

**The ramp table below leaves the repair lines out.** They were added to the
model after the ramp was built, and leaving them out makes the table
conservative rather than wrong — about **$0.54 more per dollar of ad spend
arrives around day 28** than the table shows. Every week from 5 onward has more
cash in it than the number printed.

**The front end alone returns $1.92 for every $1, seven days later.** That is
what makes this scalable on a small bankroll. We are not waiting on funding
deals to recycle ad money — the blueprint sale does it inside a week, and every
deposit and fee balance after that is growth on top.

### How far the cost per sale can slip before the cycle breaks

| Cost per sale | Day-7 return per $1 |
|---|---|
| $150 (target) | $1.92 |
| $200 | $1.44 |
| $250 | $1.15 |
| **$288** | **$1.00 — the wall** |
| $350 | $0.82 |

Above **$288** a sale, the front end no longer returns the ad money and the
float starts shrinking every week. That is the number to watch daily in the
first three weeks. Everything below it still recycles, just slower.

---

## The ramp — eight weeks from $15,000

Ads start small because the cost per sale is unproven, and step up only once the
previous week's money has landed. Every figure below is **cash actually in the
checking account**, with the 7-day delay applied and the closer's commission
already taken out of the deposits.

| Week | Daily budget | Ad spend | Front end in (from 7 days ago) | Deposits in (net of commission) | **Bank at week end** |
|---|---|---|---|---|---|
| Start | — | — | — | — | **$15,000** |
| 1 | $500 | $3,500 | $0 | $0 | $11,500 |
| 2 | $750 | $5,250 | $6,720 | $0 | $12,970 |
| 3 | $1,100 | $7,700 | $10,080 | $0 | $15,350 |
| 4 | $1,500 | $10,500 | $14,784 | $0 | $19,634 |
| 5 | $1,800 | $12,600 | $20,160 | $3,205 | $30,399 |
| 6 | $2,500 | $17,500 | $24,192 | $4,808 | $41,899 |
| 7 | $3,000 | $21,000 | $33,600 | $7,052 | $61,551 |
| 8 | $3,500 | $24,500 | $40,320 | $11,539 | **$88,910** |

**Month 1 ad spend: $26,950. Month 2 ad spend: $75,600.**

Every week's daily budget obeys the ÷10 rule against the cash on hand at the
start of that week. Weeks 3 and 4 are the tight ones — $15,350 backing $1,500 a
day is right on the line. **Do not get ahead of the table in weeks 3 and 4.**
That is where an early step-up would actually run the account dry.

By the end of week 8 the daily budget is $3,500 — a **$105,000/month run rate** —
with $88,910 in the bank behind it. The ÷10 rule says that supports $8,891 a
day, so from week 9 the cash stops being the limit at all.

**The $60,000/month you asked about lands in week 6**, at $2,500/day, with
$41,899 in the bank. Five weeks from the day the first ad turns on.

**None of the above counts fee balances.** Those start landing around week 13
and are the largest single inflow in the business — roughly $1.75 per dollar of
ad spend from three months earlier. Week 13 onward the model gets a second
engine that the table above does not show.

### The low point is week 1

The bank dips to **$11,500** at the end of week 1 and never goes lower. That is
the entire downside exposure of starting: **$3,500 at risk before the first
money comes back.** If the cost per sale comes in at $400 and the offer is
broken, we find out having spent $3,500, not $15,000.

---

## Why the budget steps up slowly and not all at once

Two reasons, and only one of them is about cash.

1. **The cost per sale is unproven.** Weeks 1–2 buy that number. Everything after
   is sized off it. If it lands at $150, follow the table. If it lands at $220,
   the returns are thinner and every step should be about 25% smaller.
2. **Meta resets its learning when a budget jumps.** Roughly +50% a week is the
   most a campaign absorbs without the cost per sale spiking. The table follows
   that. Doubling overnight usually costs more than waiting a week.

Note that the bank balance in the table grows **faster** than the budget does
from week 5 on. That is deliberate. The cash stops being the constraint before
the ramp finishes, which is the right way round.

---

## Two things that would break this

1. **Commas holds longer than 72 hours.** Every extra day of hold is another day
   of ad spend locked up. At $1,500/day a 10-day hold instead of 7 needs $15,000
   in flight instead of $10,500 — the entire bankroll, with nothing spare. On
   $15,000 this is the single most dangerous variable in the plan. **Confirm the
   real release timing on the first batch in week 1, before week 3 raises the
   budget to $1,100/day.**
2. **A chargeback spike.** Front-end refunds on a $297 impulse purchase are
   normal, and each one is money that never arrives on day 7 even though the ad
   for it was already paid for. Not modelled here — the assumption is a clean
   month. Watch the refund rate through week 4.

---

## What to do Monday

Start at **$500/day**. Hold it for seven days without touching it. When the
first money lands on day 8, the cost per sale is a known number instead of an
assumption, and the rest of the ramp sizes itself off that one figure.

The step-up rule after that: **raise the daily budget only when last week's
money has landed, and never above cash on hand ÷ 10.**
