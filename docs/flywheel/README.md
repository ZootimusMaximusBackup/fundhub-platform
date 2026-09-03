# The marketing flywheel

Five stages that hand off to each other. Each one takes the stage before it as
input, so a mistake early is a mistake everywhere unless it gets caught.

```
Avatar → Ad research → Offer → Copy → Ad strategy → spend → back to the top
```

Spend data at the end is what corrects the start. That is why the avatar being
**assumed** is fine, and it is a decision, not an oversight: it comes from public
forum voices who resemble the buyer, not from closed and lost deals. Real money
is the validation. Nothing here carries a "validate this first" warning.

## How to run it

```bash
npm run flywheel:status
```

That tells you where things stand and what to run next. Then say to Claude:

```
/flywheel stage 2 partner
```

or `/flywheel run partner` to go through all five, stopping after each for you
to look.

## What you actually read

Every stage writes a long document, and you do not read it. You read the block
at the bottom:

```markdown
## Review card

**What this decided:** one sentence
**Three things to check:** the three claims that, if wrong, break everything below
**What I wasn't sure about:** or "nothing"
**Say one of:** approve · tweak: <what to change> · redo
```

Say `approve`, or `tweak: the price stays at 10k`, or `redo`.

A tweak gets written into `00-OWNER-NOTES.md` as one line, and it is fed back
into that stage every time it runs again from then on. That file is the reason
the loop settles instead of going in circles. **Agents append to it. They never
rewrite it.**

## The files

```
docs/flywheel/partner/
  00-OWNER-NOTES.md     your corrections, one line each, append only
  01-avatar.md          who the buyer is
  01-avatar/            the supporting research, including the language bank
  02-ad-research.md     what the market already sells, and for how much
  03-offer.md           what we sell and what it costs
  04-copy.md            the ads and emails
  05-ad-strategy.md     which campaign, at what budget
  06-spend.md           what actually happened, and what to fix
```

## How a stage knows it is out of date

Every file starts with a stamp recording which version of its inputs it was
built from:

```
---
stage: 3
version: 4
status: approved
inputs:
  01-avatar.md: a3f9c2e1
  02-ad-research.md: 77bd014c
counts:
  priceSet: 1
  bonuses: 3
---
```

Those input codes are a fingerprint of the file's contents. Re-run stage 2 and
its fingerprint changes, so stages 3, 4 and 5 are now built on something that no
longer exists. `npm run flywheel:status` says so:

```
  1 avatar         ready       approved     133 quotes
  2 ad research    ready       approved     14 ads       (rebuilt today)
  3 offer          STALE — built on the old ad research
  4 copy           STALE — built on the old offer
  5 ad strategy    STALE — built on the old offer
```

The fingerprint covers the **body only**, everything after the closing `---`.
That matters: approving a file changes its stamp but not its body, so saying
`approve` never marks anything downstream stale.

## The check that catches a bad run

This already went wrong once. A real avatar run produced a document with zero
verified findings and the run carried on regardless. So each stage has to clear
a minimum before the next one may start:

| Stage | Must clear |
|---|---|
| 1 avatar | 20+ quotes, 100+ sourced phrases |
| 2 ad research | 8+ verified findings, half with a stated price, 3+ competitors |
| 3 offer | one price set, 3+ bonuses, all four value scores |
| 4 copy | 5+ hooks, the humanizer pass actually run |
| 5 ad strategy | a strategy named, a daily budget stated |

Plus: a review card on every stage, and no `TODO` or placeholder text left in.

Those counts come from what each workflow returns, not from reading the prose.

## Two things worth knowing

**Competitor spend is not visible.** Meta reports spend only for political ads.
Ad research ranks by how long something has been running and how many versions
of it exist, because those are the only signals that can actually be seen. It
says so in its own output rather than implying it measured money.

**The ad library is not being used.** The key is valid but the app is rejected
for it, and Meta's own documentation suggests US commercial ads may be out of
scope for that endpoint entirely. Ad research reads what competitors *sell* —
their funnels, prices, promises and guarantees — which is most of what the offer
and copy stages need anyway.

## Running one stage on its own

Every stage is a separate workflow and can be run alone. Change the offer and
you do not re-run the avatar; you re-run stages 3, 4 and 5, and the status
command tells you exactly which ones went stale.
