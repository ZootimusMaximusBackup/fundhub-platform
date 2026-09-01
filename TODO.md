# TODO

**Friday 2026-09-04 launches the FUNDING offer and the e-products.**
Today is Monday 2026-08-31. Tomorrow is the shoot.

**White label is NOT Friday.** It is ~30 days out and still being built. All the
flywheel output — the Locked Book offer, the 24 scripts, the ad plan — is white
label. It is good work aimed at the wrong date, so it moves down this list.

---

# TOMORROW — Tuesday 2026-09-01

- [ ] **Shoot 60–80 videos.** Different ad variations, one complete ad per angle.
      Ambitious and Chris knows it. Everything else on this page waits behind it.
- [ ] **Assets ready before the camera turns on:**
  - [ ] Copy angles we already hold
  - [ ] The additional angles from **Paul Tancredi**
  - [ ] White-label angles too — Chris wants to shoot those tomorrow even though
        white label launches later. Shooting once beats shooting twice.
- [ ] **Andromeda shape, since this is what the volume is for.** One reason per
      ad, hook and body and close all built for that one reason, filmed start to
      finish. Do NOT film one body and swap hooks onto it — that is the approach
      that stopped working when Meta's algorithm changed. Meta's floor is 15–20
      genuinely different reasons; 60–80 videos clears it easily as long as they
      are different *arguments* and not different *lengths*.

---

# BLOCKS FRIDAY

## The funnel

- [ ] **Push the SLO live for the funding offer. Up, not running.** The pages are
      built at `clickfunnels-fragments/slo/` — `slo-01-sales.html`,
      `slo-02-order.html`, `slo-03-thank-you.html`, all ClickFunnels-ready with
      split markers where CF's native checkout and scheduler go.
      Its own README has a **SWAP BEFORE LAUNCH** list that must be cleared:
  - [ ] Video files: `slo-vsl.mp4` + poster, `slo-vsl2-funding.mp4`, `slo-vsl3-repair.mp4`
        — these come out of tomorrow's shoot
  - [ ] CTA hrefs: `/order` → the live order path
  - [ ] Proof: replace the bracket placeholders in Section 5 with real results
        (they auto-hide until then, so the page is safe to put up early)
  - [ ] Turn SIM MODE off
- [ ] **All the other funnels and materials up**, after the offers are refined.

## The offers

- [ ] **Refine the offers before the funnels go up.** Chris's call: each offer
      answers a different market pain, and they need a pass. The e-product
      catalogue is live in `src/config/offers.mjs`: Soft Pull $32 · Decline
      Autopsy $27 · Winner's Board $47 · Live Trial $297 · Repair Trial $200 ·
      Repair DFY $1,000 · UWIQ Deliverables $1,000–5,000 · Funding DFY $3,000 +
      10% · Funding Mastery $5,000.
- [ ] **Winner's Board becomes a subscription.** Owner decision 2026-08-31. It is
      currently one-time in `src/config/offers.mjs:175-184` with no `billing`
      field, and a subscription in `docs/ads/ascension-ads.md:114`. The code is
      the half that is wrong. Chris wants it recurring so it sits inside the
      ecosystem rather than beside it.

## APIs — "every single detail is essential"

- [ ] **Meta API fully operational.** The token works today and reads the
      Fundhub.ai ad account. What is not wired: nothing writes campaigns, and
      `ad_metrics_daily` and `ad_platform_connections` are both empty, so no
      spend, impression or click data has ever landed.
- [ ] **Google API**
- [ ] **Google Ads API**
- [ ] **Partner API for Google Ads and YouTube integration**

## The database underneath it

- [ ] **It has to work perfectly.** Chris's words, and it is the foundation
      everything else sits on. Two things already known:
  - [ ] Migrations only run on the production deploy context, so a schema change
        is not live until the branch merges. Check `/api/health` — `pending` is
        the honest answer.
  - [ ] The `.pg.test.mjs` suite skips silently without `DATABASE_URL`. A green
        `npm test` proves nothing about anything that touches the database.

## Merges

- [ ] **[#326](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/326)** — credit repair: the 30-day bureau clock, delivery routing,
      Round 2. **Watch the first week after it lands** — the deadline alarm has
      never fired in the product's life, so new sends will start creating breach
      tasks.
- [ ] **[#327](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/327)** — this file.
- [ ] **[#321](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/321)** — the marketing flywheel. Tooling and docs, no product code.
      Not urgent for Friday but harmless to land.

---

# DECIDED — do not re-raise

- **Build guarantee sign-off: Chris.** Owner decision 2026-08-31. `docs/specs/W4-live-trial.md:208`
  wanted a named holder and `:756` recorded that nobody held it. Chris holds it.
- **Winner's Board: subscription.** Owner decision 2026-08-31.
- **Cost ceiling: $42.50 target, $64 hard stop.** Chris repeated these back on
  2026-08-31. If he meant to leave them open, say so — otherwise they are set.
- **The avatar is assumed and that is fine.** Spend is the validation. Never
  attach a "validate this first" rider to anything built on it.
- **No compliance checking in the flywheel.** The product already screens ads
  before they send, in `src/compliance/`.

---

# WHITE LABEL — ~30 days, not Friday

Being built now, launches later. The flywheel produced a complete package for it
and that work stands; it just is not this week's deadline.

- [ ] **Refine the white-label offers.** Chris likes them and wants a pass — each
      one answers a different market pain.
- [ ] **The Locked Book offer** — `docs/flywheel/partner/03-offer.md`. $10,000
      once, sold on the Owner Lock. Needs its two guarantee numbers:
  - [ ] The Build Clock: how many business days
  - [ ] The First File: how many files in the first 30 days
- [ ] **Non-circumvention clause into the partner license.** A NEW migration —
      never edit 283. Gates the strongest guarantee (The Lock Stands) and any
      copy claiming the protection is contractual.
- [ ] **Three copy fixes before a white-label ad runs.** Word swaps.
  1. Bare "nothing monthly" → "the partner program itself carries no repeating
     charge". There IS a live monthly menu ($297, $2,497, lead flow).
  2. Wherever the ten-clients-a-month floor appears, add the penalty: warning,
     cure window, share drops 50% → 20%.
  3. `PAPER-PROMISE-VS-RULE-LONG` and `NOT-A-COURSE-LONG`: "in their agreement"
     → "on their site".
- [ ] **Seed the initial partner row** — the partners table is empty.
- [ ] Re-run copy stage 4 for Andromeda if the 24 scripts are not replaced by
      tomorrow's shoot. The workflow is already fixed and gates on 15 distinct
      reasons.

---

# VERIFIED WORKING — do not re-fix

Re-checked 2026-08-31 against main at `3b475761`, 161 commits past the 8/29
audit. Three of its four findings were already closed:

- **CC stacking** — approved-dollar-amount inputs exist in three places
  (`65bcaf36`, `11f73101`, PR #294). Billing can fire. Fee basis moved to
  confirmed approvals on 2026-08-30 (`src/funding/success-fee.mjs`).
- **UnderwriteIQ deliverables** — letters persisted (`2dc54e60`), email no longer
  claims attachments it cannot have.
- **Uploads** — `api/documents-download.mjs` mints a fresh link for a saved file,
  staff and owning client, both screens wired.

Also live: message dispatcher on cron, `public/funnel-checkout` routed,
`PARTNER_ENTRY` purchasable.

---

# AFTER FRIDAY

- [ ] **No email follow-up.** 23 of 24 email pieces failed review. Anyone who
      books and does not buy has nothing catching them.
- [ ] **Mailgun bank-inbox → Netlify.** PAUSED, blocked on an unpaid Mailgun
      balance. Route moved, `MAILGUN_SIGNING_KEY` set. After paying: prove one
      forwarded email lands in the CRM, then document the closer latch and
      keyword sorter in `docs/sops/`.
- [ ] **Plaid API key** and environment secrets.
- [ ] **Re-extract `$100M Offers`** — the PDF truncated before the guarantees
      chapter, which is why the first offer run produced one vague guarantee.
- [ ] **Meta Ad Library API access** — may not help, since Meta's docs say non-EU
      ads only return if political. Competitor research already works through
      `r.jina.ai`.
- [ ] **ST-07 Effective permissions** — copy only, role rules live in server code.
- [ ] **Repair system + education** from `docs/metro2/AI-CREDIT-REPAIR-LETTER-GENERATION-PROMPT.md`.
      **COMPLIANCE REVIEW REQUIRED** before any live letter uses it.
- [ ] UX pass across the Finance OS screens, mobile and tablet included.
- [ ] **Repo hygiene.** 21 agent worktrees, 37 stashes, stranded `vc/save-*`
      branches. Chris raised it and said plainly he was not asking for action.
      After Friday, never during — the commands that clean it are the ones that
      eat another session's uncommitted work.

---

## Where the flywheel output lives

| Stage | File |
|---|---|
| Avatar | `docs/flywheel/partner/01-avatar.md` |
| Ad research | `docs/flywheel/partner/02-ad-research.md` |
| Offer | `docs/flywheel/partner/03-offer.md` |
| Copy | `docs/flywheel/partner/04-copy.md` |
| Ad strategy | `docs/flywheel/partner/05-ad-strategy.md` |

`npm run flywheel:status partner`. All of it is white label, and all of it is on
branch `feat/flywheel-runner` until #321 merges.
