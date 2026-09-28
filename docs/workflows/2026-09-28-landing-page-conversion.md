# Landing page conversion — why $200 produced no sale

Batch board. 2026-09-28. Owner: Chris.
Spend given by Chris: **$200**. Sales: **0**. Offer under test: **$297 SLO** (`clickfunnels-fragments/slo/`).

## Tasks

| # | Workflow | Owner | Status |
|---|---|---|---|
| W1 | Meta ad account teardown | unclaimed | `pending` |
| W2 | ClickFunnels funnel analytics | unclaimed | `pending` |
| W3 | Landing page teardown | Claude (this session) | `done` |
| W4 | Tracking integrity | Claude (partly covered by W3) | `blocked` — see below |

---

## The short answer on the money

$200 is not enough spend to learn anything. Here is the arithmetic in plain numbers.

- Meta charges roughly $25–$60 to show an ad 1,000 times to US business owners. Call it $40.
- $200 buys about 5,000 views of the ad.
- A good ad gets about 1.5 out of every 100 people to click. That is about 75 clicks.
- Some drop off before the page finishes loading. Call it 60 people who actually see the page.
- A $297 product sold to strangers converts at about 0.5 to 1 out of every 100 visitors.

**60 visitors x 1% = 0.6 sales.** So the single most likely result of $200 is zero sales.
Zero here is normal. It is not evidence the page is broken.

To actually find out whether the funnel works you need roughly **$1,500–$3,000**, or about
400–800 people on the page. Below that you are reading noise.

**But** the checks below found five things that would hold the page at zero no matter how much
money went in. Those are worth fixing before spending another dollar.

---

## W3 — Landing page teardown (done)

Read from the repo copy of the funnel: `clickfunnels-fragments/slo/`.

### Could not verify live

`fundhub.ai` and `apply.fundhub.ai` are both blocked by this environment's network policy
(proxy answers 403 on connect). Per CLAUDE.md §11 that is a policy denial and was not retried.

So every finding below is about **the copy of the page kept in this repo**. The live
ClickFunnels page was pasted in by hand and may differ. Each finding says how to check it live
in one click.

### Finding 1 — the page has no Meta pixel and fires no Purchase event

`grep` for `fbq`, `gtag`, `dataLayer`, `pixel` across all three SLO pages returns nothing but
the "not affiliated with Meta" legal footer. There is no tracking code and no purchase signal.

Why this matters more than anything else on the list: if the campaign is set to optimise for
purchases and no purchase signal ever reaches Meta, Meta has nothing to learn from. It stops
hunting for buyers and starts buying the cheapest clicks it can find. The ad account gets
worse the longer it runs.

ClickFunnels can hold a pixel at the workspace level, so this may be covered outside these
files. **Check:** open the live sales page, right-click → View Source, search for `fbq`.
Also open Meta Events Manager and look for a Purchase event in the last 7 days.

### Finding 2 — nothing carries the ad id into the order

`clickfunnels-fragments/06-utm-hidden-fields.html` is the script that captures which ad someone
came from. Its own header says to paste it on "the APPLICATION page (the one with the form)".
It is not on any of the three SLO pages, and the sales page's five buttons all point at a bare
`href="/order"` with nothing attached.

So even if a sale happens, there is no record of which ad caused it. `docs/ads/NEXT.md` already
lists "which live ad is winning" as an open question blocking work — this is why it is open.

### Finding 3 — the proof section is empty

Section 5 of the sales page holds three placeholder cards:

    [ CLIENT RESULT — NAME · TYPE · FUNDED $X · TIMELINE X DAYS · "RAW QUOTE" ]

No real client results have been dropped in. A stranger is being asked for $297 with zero
evidence from anyone but Chris. On cold traffic this is usually the largest single drop.

### Finding 4 — sample-data mode is still switched on

`slo-01-sales.html:301` has `var FH_SIM = true;` and `slo-03-thank-you.html:167` the same.
The README says to set both to `false` and delete the block before launch.

With it on, the page prints an amber bar reading:

> "Sample data — layout preview only. Not real clients. Set FH_SIM = false before launch."

and every result card repeats "Sample — not a real client". If that is live, the page is telling
buyers its own proof is fake. Nobody pays $297 after reading that.

**Check:** load the live sales page on your phone and scroll to the results section. If you see
an amber bar, this is live and it is the first thing to fix.

### Finding 5 — the hero video may be a dead box

The sales page points its video at `https://fundhub.ai/funnel/slo-vsl.mp4` with a poster image
at `slo-vsl-poster.jpg`. Neither file is in this repo. `public/funnel/` contains only `vsl.mp4`
(the older funnel's video). The README lists these as a swap to do before launch, and it is not
recorded as done.

The video sits in the top third of the page above the buy button. If it 404s, most visitors
see a black rectangle and leave.

**Check:** paste `https://fundhub.ai/funnel/slo-vsl.mp4` into a browser. If it downloads or
plays, this is fine. If you get "not found", the VSL is dead.

### Finding 6 — the buy buttons may go nowhere

All five buttons use `href="/order"`. The README lists this under "SWAP BEFORE LAUNCH —
CTA hrefs: /order -> live order page path". If ClickFunnels does not serve the order page at
exactly `/order`, every button on the page is a dead end and the sale is impossible.

**Check:** click any orange button on the live page. If it does not land on the checkout, stop
the ads now.

### What is actually good (do not change these)

The copy itself is strong and does not need a rewrite. The headline names the audience and the
exact pain. The pain section is specific. The offer is stacked into six named assets. There is a
money-back guarantee. There is a real price-anchor against $3K–$5K brokers. The FAQ answers the
deposit question honestly. Legal disclaimers are present.

The problem is not the writing. It is that the page appears to have shipped with its
pre-launch checklist unfinished.

### Two things that will cost you money even once the six items above are fixed

1. **$297 is a high price for a first purchase from a stranger.** Most front-end offers of this
   shape sit at $27–$97. At $297 the page has to do the work of a sales call. A cheaper entry
   point, or payments, would convert several times better. This is a business decision, not a bug.
2. **The buyer has to understand a two-step price.** "$297 now, credits toward a $3,000 deposit
   later" is explained four separate times on the page, which means it was hard to explain. Any
   confusion at the price is a lost sale.

---

## W4 — Tracking integrity (blocked)

Partly answered by Findings 1 and 2 above: the funnel pages carry no pixel and no ad id. The
rest needs a database read (`DATABASE_URL`) to see whether any attribution rows exist at all,
and a live page load, which the network policy blocks. Whoever picks this up should run it from
a machine that can reach `fundhub.ai`.

---

## Change manifest

Files touched: this file only. No product code, config, tests, or tracking code changed.

## Open questions for Chris

1. Which page did the $200 actually point at — the $297 SLO sales page, or the older VSL →
   apply → book funnel? The answer changes which of the findings above matter.
