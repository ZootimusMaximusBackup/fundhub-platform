---
stage: 5
version: 1
status: draft
inputs:
  03-offer.md: 4596bcc6
  04-copy.md: 1f88e810
counts:
  strategyNamed: 1
  dailyBudgetStated: 1
  plansBuilt: 1
  creativeAvailable: 33
---

COMPLIANCE REVIEW REQUIRED — this document sets ad copy and targeting for an offer that runs in Meta's credit category.

# Partner ads — what to run
As of 2026-09-01

Meaning of a few words used below, once: an **ad set** is one audience with its own daily budget. A **campaign** holds ad sets. A **pixel** is a small tag on a web page that tells Meta someone got there. **Warm** means people who already watched or touched our stuff. **Cold** means everybody else.

---

## 1. Which strategy, and why that one

**The Forester.** We run a bin of six cheap content ads to build an audience, and one direct ad that books calls, and we run them at the same time.

Why this one and not the others:

- We are just starting ads and the budget is small. That is the exact line in the playbook's own pick-list that says Forester.
- The other five strategies were checked and each fails on a hard number, not on taste. Venus Fly Trap 1.0 and 2.0 and the Tornado need far more finished creative than we have. The Harvester needs a bigger daily budget than $200. Hammer Them needs a working email follow-up sequence, and ours is broken — 23 of our 24 email pieces failed review and the one survivor is a subject line with no body.
- The Forester is the only one that works while the creative library is thin, because the content bin is cheap to run and its job is to build the audience we will need later.

**One honest caveat up front.** Month one is a cold content bin plus one cold booking ad. The warm half of the Forester is not in month one — see section 6 for why the budget cannot reach it. So this is the Forester's opening phase held longer than usual. It is not the full shape yet, and I am not going to call it one.

---

## 2. What it costs on day one, before anything is learned

**$200 a day.** That is your own set starting number, from the locked-inputs table in `docs/workflows/ads-waterfall-projections-2026-08-26.md`. Ten days of it is **$2,000**. A full month at that rate is **$6,000**.

It splits like this on day one:

| What | Per day |
|---|---|
| Six content ads, $15 each | $90 |
| One booking ad | $110 |
| **Total** | **$200** |

What that buys, on the model in the waterfall file: about **182 booked calls a month**, about **57 sales**, about **$77,670** booked. Every one of those numbers is a model. Zero paid sales have come from ads so far.

**Two warnings on that $77,670.** First, roughly 64% of it is course-finance money — a lender pays us later instead of the buyer paying now — and nobody has written down how long "later" is. The part that is real cash in the month is nearer **$27,600**. That still covers $6,000 of ads several times over, so this is not a problem, it is just a number that should stop being described as in-month money. Second, the $33-per-booked-call figure the model runs on is a hand-supplied number from a thin sample on Aug 24. The only figure our own records support is **$42.50** ($680 spent, 16 calls booked).

**What is NOT in the $200.** A video shoot. Nothing has been filmed. There is no price for it anywhere in our files, and it is not in this budget. See section 7.

---

## 3. The campaign structure — what to build, in order

**Build in this order. Do not skip step 1 or step 2.**

**Step 1 — fix three lines of copy.** Nothing goes live until these are done. They are word swaps, not rewrites.
1. Every bare "nothing monthly" becomes *the partner program itself carries no repeating charge*. There is a live monthly menu ($297/mo, $2,497/mo, plus lead flow), so the bare phrase is untrue.
2. Wherever the ten-a-month floor appears, add what happens if you miss it: warning, then a cure window, then the partner share drops from 50% to 20%.
3. In PAPER-PROMISE-VS-RULE-LONG and NOT-A-COURSE-LONG, change "in their agreement" to "on their site." We know what those four companies say on their websites. We do not know what is in their signed contracts.

**Step 2 — book the video shoot and start the closer class.** Both on day one. Details in section 7 and section 6.

**Step 3 — build four audience lists now, so they start filling.** They cost nothing and they take time to fill up. All four use a 365-day window.
- CA_VIDEO_10S_365D — people who watched 10 seconds of a video
- CA_FB_PAGE_ENGAGERS_365D — people who touched the Facebook page (all options on)
- CA_IG_ENGAGERS_365D — people who touched Instagram
- CA_EXCLUDE_EXISTING — current partners, applicants, already-booked. This one is only ever used to keep people OUT of the ads.

**Step 4 — put the tracking tag on the booking page.** Bookings come from ClickFunnels, not Cal.com, whatever the code names say. The tag and the SCHEDULE event go on the ClickFunnels booking confirmation page.

**Step 5 — build two campaigns. Seven ad sets total.**

**C1 — CYCLE-BIN-1 (cold content). $90/day, six ad sets at $15.**
- Goal: engagement. Meta setting: objective OUTCOME_ENGAGEMENT, optimisation POST_ENGAGEMENT.
- Same audience in all six ad sets. One video per ad set. That is the point — six different messages against the same people, so we find out which message works.
- Budget sits on each ad set, not on the campaign.
- Once it has run one full cycle, copy the whole campaign and change one thing: optimise for THRUPLAY instead.

**C4 — DR-COLD (cold, books calls). $110/day, one ad set.**
- Goal: bookings. Objective OUTCOME_LEADS, optimisation OFFSITE_CONVERSIONS, event SCHEDULE.
- One creative at a time. Not four.

**Both campaigns must declare the credit category.** `special_ad_categories: ["CREDIT"]`. Our own code refuses to build the campaign without it, before Meta is ever contacted. Someone also has to fill in the `ad_platform_category_map` row for this offer type, or the launch is blocked even with the category set.

**Two things that are changes to how the account runs today, so hear them as changes:**
- Today the account puts one budget on the whole campaign. This plan puts a budget on each ad set. That is correct for a content bin, but Paul should be told, not left to discover it.
- **Dynamic creative is OFF.** That is Meta's "give me four videos and I'll mix them" setting. At our budget it splits the results so thin that no video ever gets a readable score, so we could never tell which one to keep. One video per ad set, rotated by hand.

**Ad naming, exactly.** Every ad name starts with the pieceId, then the ad set code, then the month:
`SHOW-ME-THE-LINE-SHORT__BIN1-06__2026-09`
Without that prefix we cannot tell later which message the money went to.

---

## 4. Which creative goes where, by pieceId

Seven pieces at launch. Six content, one booking.

| Ad set | Angle | pieceId | Note |
|---|---|---|---|
| BIN1-01 | The funder went quiet | FUNDER-WENT-QUIET-SHORT | Widest net. Works on a broker who has never heard of us. |
| BIN1-02 | The price is on the page | PRICE-ON-THE-PAGE-SHORT | Nobody else in this lane can run it. They have no price to print. |
| BIN1-03 | This is not a course | NOT-A-COURSE-SHORT | |
| BIN1-04 | The system pays, not a person | SYSTEM-PAYS-NOT-A-PERSON-SHORT | |
| BIN1-05 | Hardest term first | HARDEST-TERM-FIRST-SHORT | **Runs only after the floor-penalty fix.** This angle's whole promise is "you get the hard part first," so leaving the penalty out is the one thing it cannot do. |
| BIN1-06 | Show me the line | SHOW-ME-THE-LINE-SHORT | The strongest hook we have. Nothing in it was flagged. |
| DR-COLD | The funder went quiet, long form | FUNDER-WENT-QUIET-LONG | One at a time. Start here. |

**What we actually own.** 24 finished ad pieces, not 33. The 33 in the copy file is wrong and should not be used to size anything. Four of the 24 are held back and are not swap-in options: all three RENEWAL-BOOK-IS-YOURS pieces (five separate problems including an income promise and made-up scarcity) and SEAT-THE-NEXT-PARTNER-SHORT (no call to action, and it describes the affiliate pay wrong). Those need rewrites.

**So: 20 usable, 7 committed, 13 on the bench for swapping in:** SHOW-ME-THE-LINE-MID and LONG, FUNDER-WENT-QUIET-MID, PAPER-PROMISE-VS-RULE-MID and LONG, SYSTEM-PAYS-NOT-A-PERSON-MID and LONG, NOT-A-COURSE-MID and LONG, HARDEST-TERM-FIRST-MID and LONG, PRICE-ON-THE-PAGE-MID and LONG.

**There is no refresh plan and there should be.** Ads wear out. Thirteen spares is a few weeks, not a year, and the "copy the campaign and switch to THRUPLAY" step reuses the same videos, so it does not solve wear-out. Plan a second writing round now rather than when the ads go flat.

---

## 5. Tactics that would get the ads rejected, and what to use instead

Meta puts credit offers in a locked-down bucket. These were checked against our own compliance tool and against Meta's rules.

**1. Age 25 to 64. Rejected.** Every one of the 14 ad sets in the first draft used it, so every ad set would have been rejected. Use **18 to 65**. In Meta's system 65 means "65 and over," there is no top cut. This is not a choice with a better answer. There is one legal setting and that is it.

**2. Lookalike audiences. Rejected, permanently.** A lookalike is a list Meta builds of people who resemble your buyers. Credit offers cannot use them, at any list size, ever. Selling seats does not unlock it later. Any note in an older plan saying "build the lookalike once seats are sold" should be deleted so nobody acts on it in three months.
**Use instead:** broad United States targeting plus lots of different messages. Six different angles against everyone is how we find the buyer. That is exactly what the content bin does.

**3. Audience expansion switched on. Must be turned off.** That is the setting that lets Meta deliver outside the audience you named. Turn every version of it off: `targeting_relaxation_types` both flags to `0`, and add `targeting_automation: { detailed_targeting_expansion: 0, advantage_audience: 0 }` to both audience blocks.
**Important:** our compliance checker did NOT complain about this one. It cannot — it does not know that spelling. It catches four other names for the same switch and rejects all four. A green run from the checker is not permission on this setting until the tool is fixed.

**4. No credit category declared. Blocked before Meta even sees it.** Declare `special_ad_categories: ["CREDIT"]` on both campaigns. Confirm the exact word `CREDIT` against the live Meta version before launch — a wrong word fails loudly at build time.

**These are fine and stay as they are:**
- Broad United States, home and recent location, no ZIP codes, no radius, no location exclusions.
- Gender left blank, so it goes to everyone.
- No interest or behaviour or language layer at all.
- The three 365-day engagement lists (video watchers, Facebook engagers, Instagram engagers).
- Our own customer list used **only** to keep existing partners out. Excluding your own customer list is allowed. Excluding a location is not. Do not stretch this one into geography.
- Placements (feeds, stories, reels, marketplace, search, explore), mobile and desktop.

**Two things to log, not to fix in this plan:**
- `src/compliance/targeting.mjs` has a hole at `targeting_relaxation_types`. A payload can turn expansion on and pass. Someone should add that name to the check and a test case.
- The checker reads targeting only. It has **no opinion on ad copy**, landing pages, the booking event, or income language. Do not read a green targeting run as approval of anything else. Copy in this category gets its own separate pass.

**One trap in how the check is run.** Running the checker once on the whole targeting file gives a fake green, because the file is a wrapper around two named blocks and the wrapper itself has no age or geography to object to. Run it on each block separately. Those two runs are the real answer.

---

## 6. When to spend more, when to stop

### Spend more: two gates, both must be true

**Gate 1 — three closers seated.** $500 a day at $33 a booking is about 455 bookings a month, about 21 every weekday. The waterfall file says it flatly: hire three closers before you hold $500 a day. Two closers are already over 90% packed. With one closer, roughly 60% of the calls we paid for have nobody to take them. That is the most expensive mistake available here, because unlike a bad targeting setting it wastes 100% of the extra money instead of spending it badly.
The closer class is five days, so hiring can finish inside the ten-day first phase — **only if it starts on day one.** Put it on day one.

**Gate 2 — the cost per booked call is holding.** If DR-COLD at $110/day is running above the ceiling below, spending more per day does not fix it. It just costs more.

**When both are true, Phase B is $500/day:**

| Campaign | Per day | Ad sets |
|---|---|---|
| CYCLE-BIN-1 | $180 | 6 at $30 |
| DR-COLD | $320 | 1 |

Six content ad sets at $30 is the playbook's own worked example, exactly. The $320 matters for a specific reason: Meta needs about 50 bookings a week in one ad set before it stops guessing, and at our real $42.50 cost that is $304 a day. DR-COLD at $320 is the only ad set in this whole plan that ever clears that bar, and it only clears it because it is the only one.

### Why the warm campaigns are not in month one

This is the biggest change from the earlier draft and it needs to be plain. Two warm booking ad sets at $45 a day each would each get about 9.5 bookings a week against the 50 they need. They would sit in the guessing phase forever and never produce a readable result.

The warm audience is also far too small. To show warm ads three times a week per person, the pool needs about **17,500 people**. Ten days of $90-a-day content spend builds roughly 450 to 1,350 people. The earlier plan's gate of 1,000 people was not what warm ads need — it was what the cold spend could reach in ten days.

So the warm campaigns come back when the warm pool passes roughly **17,500 people**. On this content spend that is months away, not day 11. The warm audience settings stay written down and stay fixed, ready to go.

### When to stop

**These numbers need your sign-off. Nothing in our files sets them. I am proposing them.**

- **Target cost per booked call: $42.50.** The only figure our own records support ($680 ÷ 16 bookings).
- **Hard ceiling: $64.** About 1.5 times that. Any ad set above $64 per booked call for a full week gets paused, not tinkered with.
- **Content ad set kill rule:** an ad set that has spent $150 with no 10-second video views and no page or profile engagement gets switched off, and its budget moves to the ones that are working.
- **Weekly review, every Monday. Three numbers only:** cost per booked call, cost per 10-second view, warm pool size.
- **Whole-plan stop:** if cost per booked call is over $64 for two weeks running, spend goes back to $200 a day and does not move again until it is under $42.50 for a week.

Without these, a cost that lands at double the assumed $33 burns about $7,500 a month before anyone notices.

---

## 7. What this plan assumes, and what it needs that we do not have

### Assumptions — every one of these is a guess, not a measurement

1. **$33 per booked call.** Hand-supplied on Aug 24 from a thin sample. Our own records say $42.50. The waterfall file itself warns: if this goes to $50, every cash number drops by a third.
2. **31% of booked calls become sales.** Model only. Zero paid sales have come from ads. You said on Aug 27 it should be 70%. The sheet keeps 31% as the scared case.
3. **77% of booked calls show up.** Model only. Used for staffing, never for revenue.
4. **$20 to show an ad to 1,000 people.** This one is worth flagging hard: **there is no recorded price-per-1,000 anywhere in our files.** Every audience-size and reach calculation in this document rests on a number nobody has measured. If it is $40, the warm pool takes twice as long.
5. **A 1% to 3% engagement rate on the content ads.** Assumption.
6. **The lender pays out course-finance money inside the month.** Nobody has written down the payout timing. Not one business-day count exists in the file.

### What we do not have

1. **Zero videos exist.** All 24 pieces are written scripts. Nothing has been filmed. The six content ad sets exist for exactly one purpose — to make 10-second video views that fill the warm list. **Without video, the whole plan collapses to page and Instagram engagers only, and it does not work the way it is written.** No shoot is scheduled. No shoot is budgeted. This is the single thing standing between this document and a live campaign.
2. **Zero images exist.** The obvious fallback — text-and-picture ads instead of video — still needs pictures. There is no image library recorded anywhere.
3. **No live ad data of any kind.** The CRM holds zero spend rows, zero impression rows, zero click rows, zero ad-platform connections. Everything above is modelled.
4. **No measured close rate, show rate, or funding rate.** All three are guesses.
5. **No creative-level results.** Nothing exists to tell us which hook or angle has ever worked.
6. **No email follow-up.** 23 of 24 email pieces failed review. This does not stop the Forester — it needs no email to launch. It does mean anyone who books a call and does not buy has nothing catching them afterwards.
7. **A broken link.** `docs/workflows/ads-revenue-model-2026-08-24.md` was moved to `docs/workflows/archive/`, so every link to it inside the waterfall file points at nothing.

### The three things to do first

1. **Book the video shoot.** Nothing launches without it. It is not scheduled and not budgeted.
2. **Start the closer class on day one.** Five days, so it finishes inside the first ten. Phase B does not start without three seated.
3. **Set the cost ceiling.** I propose $42.50 target and $64 hard stop. Those need to be your numbers before a dollar moves.

---

## Review card

**What this decided:** Run the Forester at $200/day — six cold content ads at $15 and one booking ad at $110 — with all ages set to 18–65, the credit category declared, lookalikes and audience expansion off, warm ads held until the warm list passes 17,500 people, and $500/day locked behind three seated closers.

**Three things to check:** This needs 7 videos and $200/day - do we have that? · Day one costs $200 before we learn anything - yes? · Where does the traffic land?

**What I wasn't sure about:** Four things. The video shoot has no price and no date anywhere, so I could not put a real day-one total in front of you — $200 is ads only. The $42.50 target and $64 ceiling in section 6 are mine, not yours; nothing in our files sets a cost limit. Every reach and audience-size number rests on a $20-per-1,000-views figure that has never been measured here. And the earlier draft was handed to me cut off mid-way, so the last ad set of the old plan and one creative list were never supplied and could not be checked line by line.

**Say one of:** approve · tweak: <what to change> · redo
