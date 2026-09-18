# The new lead flow — what's coming to your calendar

Date: 2026-09-18. For the closer. Send as-is.

## What changed

We are running ads to a **$297 blueprint**. A person pays $297, tells us about
their situation, and gets a custom plan for fixing their own credit and getting
funding-ready fast. They keep portal access.

**Nobody hits your calendar until they have paid us $297.** That is the whole
point. You are not calling cold leads and you are not calling people who
downloaded a free thing. Everyone you talk to has already taken out a card and
paid us money.

## Where your calls come from

Two ways:

1. **They book themselves.** After they buy, they answer six questions and get
   offered a call.
2. **Our outbound people call them.** Every buyer gets called whether they
   booked or not.

Before the call you will see their six answers: credit score range, recent
derogatory marks, whether they have a business and how old it is, how much
funding they want, how fast they need it, and whether they can start this week.

**680 or better, has a business, needs it this month → straight to you.** The
rest get worked first.

## What you are selling

Same thing as always. **$3,000 to start, and it counts toward the 10%.**

The math you can say out loud — an example, not a promise:

> Funded for $75,000 → 10% is $7,500 → you already paid $3,000 → the rest is
> $4,500.

Nothing about the offer changed. Only where the person came from changed.

## Volume you should expect

At the ad spend we are planning, per month:

| Ad spend | Calls booked | Calls you hold | Qualified | Deals you should close |
|---|---|---|---|---|
| $30,000 | 90 | 63 | 38 | 11 |
| $60,000 | 180 | 126 | 76 | 23 |
| $100,000 | 300 | 210 | 126 | 38 |

These are planning numbers, not a promise. The line that matters to you is the
last one: **about 3 in 10 qualified calls should close.** If you are under that
for two weeks running, something upstream is wrong and we want to know — it is
probably the ad bringing the wrong person, not you.

## Two things to watch for

1. **Some of these people want to do it themselves.** That is fine. They bought
   the do-it-yourself plan. Your job is to find the ones who want it done for
   them and are ready now. Do not fight the others — they stay in the portal and
   can upgrade themselves later with a button.
2. **Small requests are still worth your time.** We do not cancel people who
   want under $50,000. That was somebody else's rule. It is not ours.

## Your pay

Two pieces, and they arrive at different times.

| | What | When |
|---|---|---|
| Front end | **$500 flat per deposit collected** | The day the deposit lands |
| Back end | **0.25% of the amount the client gets funded** | The day the round funds — usually 45–90 days later |

$500 is per deposit, not per $1,000. One deposit, one $500. A part-paid deposit
still fires the whole $500.

**You are paid on money in the door, not on the signature.** A closed deal with
no deposit yet pays nothing — not a pending amount, nothing. The $500 appears
the moment the first deposit is recorded. If you have closed a deal and see no
commission against it, that is why, and it is working as designed.

The back end is paid whether or not we ever collect the fee balance. Once the
round funds, you have earned it. Chasing the invoice is not your problem.

### What that looks like per month

Planning numbers, expected case:

| Ad spend | Deposits you close | Front end | Back end | **Your month** |
|---|---|---|---|---|
| $30,000 | 11 | $5,500 | $1,155 | **~$6,655** |
| $60,000 | 23 | $11,500 | $2,415 | **~$13,915** |
| $100,000 | 38 | $19,000 | $3,990 | **~$22,990** |

Back-end figures assume 7 in 10 clients get funded, at an average of $60,000.
Both of those are estimates, not measured. And remember the back end lags — in
month one you get the front end only.

**Source:** `src/commissions/commission-model-open-questions.md` (Chris, 2026-07-26).
These rates are marked provisional pending Darwin's sign-off, and **no rates are
loaded in the system yet** — `013_commission_rules.sql` seeds zero. Somebody has
to enter them before a commission actually calculates.

## The full model

`docs/finance/slo-offer-model-2026-09-18.md`
