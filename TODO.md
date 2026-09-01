# TODO

**Launch target: Friday 2026-09-04.** Today is Monday 2026-08-31. Four days.

Everything above the line blocks launch. Everything below it does not, however
much it looks like it should.

---

# BLOCKS FRIDAY

## Yours — nobody else can decide these

- [ ] **Book the video shoot.** This is the one that stops everything. All 24 ad
      pieces are written scripts and zero videos exist. The whole ad plan builds
      its warm audience from 10-second video views, so with no video it collapses
      to page engagers and does not work as written. No shoot is scheduled and
      none is budgeted — the $200/day is ads only, it does not include making the
      ads. Nothing else on this list matters if this slips.

- [ ] **Two guarantee numbers.** The Build Clock needs a number of business days.
      The First File needs a file count. Nothing in the repo sets either and
      nobody should invent them. See `docs/flywheel/partner/03-offer.md`.

- [ ] **The cost ceiling.** Proposed: $42.50 target per booked call, $64 hard
      stop. Those are the workflow's numbers, not yours. Your own records say
      $42.50 ($680 ÷ 16 booked); the $33 everything is modelled on was hand-
      supplied from a thin sample. Without a ceiling, a cost at double the
      assumption burns ~$7,500/month before anyone notices.

- [ ] **Who signs off on the build guarantee.** One name. `docs/specs/W4-live-trial.md:208`
      requires a holder and `:756` records that nobody holds it.

- [ ] **Winner's Board: one-time or subscription?** It is $47 one-time in
      `src/config/offers.mjs:175-184` and a subscription in `docs/ads/ascension-ads.md:114`.
      The bonus stack cannot be printed until one wins.

## Mine — waiting on a merge or a decision above

- [ ] **Merge [#326](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/326)** — credit repair: the 30-day bureau clock, delivery
      routing, and Round 2. Mergeable, blocked only by the usual CI state.
      **Watch the first week after this lands:** the deadline alarm has never
      fired in the product's life. New sends will start creating breach tasks.

- [ ] **Merge [#321](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/321)** — the marketing flywheel: four workflows, the runner,
      the staleness gate. Docs and tooling, no product code.

- [ ] **Non-circumvention clause into the partner license.** A NEW migration —
      never edit 283. This gates the strongest guarantee (The Lock Stands) and
      gates any copy claiming the protection is contractual. Today the copy is
      careful to claim only the database rule, which is true, but the guarantee
      cannot ship without the clause.

- [ ] **Three copy fixes before a single ad runs.** Word swaps, not rewrites.
      1. Every bare "nothing monthly" → "the partner program itself carries no
         repeating charge". There IS a live monthly menu ($297, $2,497, lead flow).
      2. Wherever the ten-clients-a-month floor appears, add the penalty:
         warning, cure window, then the share drops 50% → 20%.
      3. In `PAPER-PROMISE-VS-RULE-LONG` and `NOT-A-COURSE-LONG`, "in their
         agreement" → "on their site". We know what four competitors say on their
         websites, not what is in their contracts.

- [ ] **Rebuild the creative for Andromeda.** The current set is 7 committed ads
      against Meta's 15–20 floor, and the 13 on the bench are length variants of
      the same seven arguments, which do not count. The sameness check already
      found 20 of 21 closes were the same sentence with the verbs swapped. Re-run
      stage 4 — the workflow is fixed and now gates on 15 distinct reasons, so
      the next run produces the right shape. **This is a re-run, not a rewrite.**

- [ ] **Start the closer class day one.** Five days, so it finishes inside the
      first ten. Three closers must be seated before $500/day, or ~60% of the
      calls you paid for have nobody to take them.

---

# DOES NOT BLOCK FRIDAY

## Verified working — do not re-fix these

Re-checked 2026-08-31 against main at `3b475761`, 161 commits past the 8/29
audit. Three of its four findings were already closed:

- **CC stacking** — the approved-dollar-amount inputs exist in three places now
  (`65bcaf36`, `11f73101`, PR #294). Billing can fire. Note the fee basis moved
  to confirmed approvals on 2026-08-30 (`src/funding/success-fee.mjs`).
- **UnderwriteIQ deliverables** — letters are persisted (`2dc54e60`) and the
  email stopped claiming attachments it could not have.
- **Uploads** — `api/documents-download.mjs` mints a fresh link for a saved file,
  for staff and for the owning client. Both screens wired.

Also confirmed live: the message dispatcher is on cron, `public/funnel-checkout`
is routed, and `PARTNER_ENTRY` is purchasable.

## Real, but after launch

- [ ] **Re-extract `$100M Offers`.** The PDF truncated about a third in, before
      the guarantees chapter, which is why the first offer run produced one vague
      guarantee instead of a stack. `~/.claude/skills/offer/references/proof-and-guarantees.md`
      says so at its own bottom. Fixing the source fixes every future offer.
- [ ] **Meta Ad Library API access.** Confirm identity at facebook.com/ID, then
      request at facebook.com/ads/library/api. May not even help — Meta's docs say
      non-EU ads only return if political. Nothing waits on it; competitor
      research already works through `r.jina.ai`.
- [ ] **agent-reach install**, if you want Reddit and Twitter. The web and
      YouTube backends already work without it.
- [ ] **No email follow-up.** 23 of 24 email pieces failed review. The ad plan
      does not need email to launch, but anyone who books and does not buy has
      nothing catching them.
- [ ] **Ad refresh plan.** Thirteen spare pieces is a few weeks, not a year.
- [ ] `docs/workflows/ads-revenue-model-2026-08-24.md` was archived, so every
      link to it inside the waterfall file is broken.

## Older, still open

- [ ] **ST-07 Effective permissions** — copy only. Role rules live in server code;
      the screen cannot show or edit them. Change access by changing **Role**.
- [ ] **Mailgun bank-inbox → Netlify.** PAUSED 2026-08-14, blocked on an unpaid
      Mailgun balance. Route already moved; `MAILGUN_SIGNING_KEY` is set. After
      paying: prove one forwarded email lands in the CRM, then document the
      closer latch and keyword sorter in `docs/sops/`.
- [ ] Seed the initial partner row (the partners table is empty).
- [ ] Plaid API key and environment secrets.
- [ ] Update the repair system and education from
      `docs/metro2/AI-CREDIT-REPAIR-LETTER-GENERATION-PROMPT.md`.
      **COMPLIANCE REVIEW REQUIRED** before any live letter uses it.
- [ ] UX pass across the Finance OS screens, mobile and tablet included.

## Repo hygiene — noted, not scheduled

You raised this and explicitly did not ask for action. Recording it so it is not
lost: there are 21 agent worktrees under `.claude/worktrees/`, 37 stashes, and
several `vc/save-*` branches that never merged. None of it is dangerous, all of
it is confusing. Worth a deliberate pass **after** Friday, never during — the
destructive git commands are exactly the ones that eat another session's
uncommitted work.

---

## Where the flywheel output lives

| Stage | File |
|---|---|
| Avatar | `docs/flywheel/partner/01-avatar.md` |
| Ad research | `docs/flywheel/partner/02-ad-research.md` |
| Offer | `docs/flywheel/partner/03-offer.md` |
| Copy | `docs/flywheel/partner/04-copy.md` |
| Ad strategy | `docs/flywheel/partner/05-ad-strategy.md` |

`npm run flywheel:status partner` says which are current. All of it is on branch
`feat/flywheel-runner` until #321 merges.
