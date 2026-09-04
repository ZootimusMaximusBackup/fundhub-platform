# TODO

## Tomorrow 9/4 — read this first

The 2026-09-03 fix batch shipped overnight. 30 of 37 walkthrough defects fixed,
your real Capital Academy and Capital Blueprint contracts seeded, Blueprint
repriced to $5,000. All live and verified in the production database.

**Do not send a funding-deposit or credit-repair contract.** Those two still carry
"THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS." on purpose, because no
text exists for them. Academy and Blueprint are safe.

### Yours, in the order they unblock things

1. **Two contract texts.** FUNDING-AGREEMENT ($3,000 deposit) and
   CREDIT-REPAIR-AGREEMENT ($1,000). Neither is in the packet you supplied —
   Academy, Blueprint and White Label are, and those are handled. Drop them in
   `docs/contracts/source-2026-08-28/` and an agent seeds them.
2. **Two ClickFunnels questions**, in the CF editor. "Annual Business Revenue"
   saves into nothing at all, so that answer never reaches us and cannot be
   recovered. "Can You Verify Revenue?" is saving into the other question's slot.
   Part B of `docs/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md`.
3. **A Bland phone number.** The account owns none, so every call dials from a
   shared pool line — the likeliest reason a call rings and nobody speaks.
4. **21 ad names.** Ids in `docs/workflows/fix-batch-2026-09-03-remaining.md` §1.2.
   A check now fails while any is blank, so they cannot quietly stay unnamed.
5. **Turn off the Gmail "FS Auto" filter** before the re-walk, or it hides Fundhub
   mail from your Inbox and the walk lies to you again.
6. **Read the new Josh script** before it goes near a phone.

### Four questions, one line each

- Booking confirmations: send-now for the three booking messages only
  (recommended), or run the sweeper every minute for everything?
- What counts as a confirmed booking — the Google calendar Yes, the YES text back,
  or both? Nothing moves Booked → Confirmed today.
- Should "Generate Apps" create application rows, or is the SOP wrong?
- Capital Academy is also $5,000, so the education ladder now has two rungs at one
  price and "step down on a no" has nothing to step down to. Keep both as a choice
  of course, make Blueprint a bridge into Academy, or reprice?

### Known and not fixed

- **No lender in the book records a minimum credit score.** All 313 rows checked.
  The matcher now reads the credit file but screens nobody until that data exists.
- **No personal lenders at all** — 196 + 117 business cards, zero personal, while
  the estimate promises $199,350 of personal money.
- **Bureau rotation is inert** — 310 of 313 lenders have a blank bureaus_pulled.
- **The DIY letter pack fix was deliberately not shipped.** It turns 7 working
  letters into 0. Measurement recorded in `src/metro2/diy/deliver.mjs`.
- **Nothing writes an advisor assignment**, so the portal's advisor line will
  usually show its empty state honestly rather than a name.

### Two honest gaps in what shipped

- **No browser touched the live site.** Every screen fix is unproven until the
  re-walk. Seven agents shared one checkout, so browser proof was skipped on purpose.
- **The database test phase never ran** — no DATABASE_URL, 693 tests skipped. The
  8,594 passing are the unit phase only.

Full detail: `docs/workflows/fix-batch-2026-09-03-remaining.md`.

---

## Chris — launch list, 2026-09-03 (launch Mon 9/7; financing approves Fri 9/4)

### Today 9/3
- [x] Six Sedona ads to Paul (16, 6, 26, 51, 42, 45)
- [x] CRS soft pull live
- [x] Ad attribution + registry (Claude Code, PR #330/#331)
- [ ] Manual walkthrough 1–5pm: one client, ad → call → payment → fulfillment
- [ ] Mail forward at usps.com
- [ ] Calls after 5: credit optimization leads, Brandon Elliot (set Build Clock + First File numbers first; lead with 50% split, no clawback), Smart Start, storage unit
- [ ] Apply: Meta Marketing API, Google Ads API, Partner API
- [ ] If time: tweak 14 ads for Monday, VSL, Capital Blueprint + Capital Academy filming

### Before Fri 9/4
- [ ] Film VSL, send to Paul
- [ ] SLO live: VSL in, SIM MODE off
- [x] Merge #326, #327, #321 (all three on main as of 2026-09-03; #321 landed via #333)
- [ ] Payouts + waterfall walked end to end
- [ ] Quizzes working
- [ ] Closer on the script

### Sat–Sun
- [ ] Lender list optimized and fixed
- [ ] Filter 83 ads → top 30 = source of truth
- [ ] Cut ad 41 (built on a guarantee we don't offer)

### Mon 9/7
- [ ] Launch primary offer
- [ ] Film 14 in Sedona

### White label — not Monday
- [ ] Sell as-is: your brand, your ads, we fulfill; marketing = paid add-on. Drop Meta ad-library dependency.
- [ ] Set Build Clock days + First File count
- [ ] clients.partner_id attribution (0 of 29)
- [ ] Non-circumvention clause, migration

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
- [x] **[#321](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/321)** — the marketing flywheel. Tooling and docs, no product code.
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

## The one that decides whether white label works at all

- [ ] **Nothing ever attributes a lead to a partner.** `clients.partner_id` is
      the column that links a client to the partner who brought them. It is set
      on **0 of 29** clients. Every production writer of `clients` was traced —
      `src/auth/seed-role-accounts.mjs:84`, `src/contracts/upload.mjs:182`,
      `src/journeys/runner/synthetic.mjs:82`, and the event-bus creator
      `src/handlers/client-lifecycle.mjs:184` — and **not one sets it**. The
      public funnel intake `api/public/survey-submit.mjs` does not contain the
      word "partner". The only writer that has ever set it is the demo seeder.

      So a white-label partner sees no leads because **no lead can reach them**.
      Every dashboard complaint below is downstream of this. Fixing the screens
      without fixing this produces a prettier empty page.

## Dashboard findings — traced 2026-09-01, read-only

The back end is in better shape than the screens. Every endpoint checked is
routed, correctly gated with `requirePrincipal`, and scoped server-side. The
accrual writer (`src/partners/revenue.mjs`) is genuinely good: rate frozen at
accrual, no clawback possible, refunds expressed as voids, front and back end
allow-listed to the three right product codes.

- [ ] **The partner home's centrepiece is permanently empty.**
      `partner-galaxy.html:523-532` hardcodes `CLIENTS`/`NODES`/`ROUTES`/`STANDING`
      as empty arrays with no assignment anywhere. The canvas is the largest
      element on the page (`.sky-wrap{flex:1}`, line 188) and ships with a legend
      explaining how to read it and instructions to click things in it. This is
      why it "looks poor" — not thin content, a dressed-up blank.

- [ ] **`partner-training.html` works and nothing links to it.** It renders the
      13 seeded `training_modules` and 4 `training_gates` correctly.
      `grep -rn "partner-training" public/` returns only `shell.js` constants and
      a CSS comment; `partner-galaxy.html` says "training" zero times. Built,
      seeded, unreachable.

- [ ] **Two more endpoints built, routed, and called by nobody:**
      `/api/read/partner-production` and `/api/trials/dashboard`.

- [ ] **The accrued balance is fetched and thrown away.**
      `partner-galaxy.html:1755` asks for it; `data.js:579` drops it.

- [ ] **The affiliate's two most useful tables have no data path.**
      `affiliate.html` declares `var LEADS=[]` (line 398) and `var PAYOUTS=[]`
      (line 477) and never assigns either, so they permanently print "No
      referrals on file" and "not connected to your payout history yet." No
      endpoint anywhere returns `affiliate_referrals` or `affiliate_payouts`
      rows — the file's own comment at 526-529 says so. Not broken; never built.

- [ ] **Two tiles are hardcoded strings.** RATE is the literal "Per agreement"
      and COOKIE is "60d" (`affiliate.html:212-213`), while the real rates —
      direct 20%, downline 5% — sit in `affiliate_commission_rules`.

- [ ] **The payout hold is invisible.** `affiliates.partner_license_signed_at`
      gates every release (`033_affiliates.sql:88-95`) and the endpoint reduces
      it to a bare `license_signed` boolean with no explanation and no route to
      the document.

- [ ] **Nobody can log in as the one affiliate with real numbers.** AFF-000063
      has the only referral and the only payout in the database and has no
      `accounts` row. `affiliate@fundhub.ai` — the account that does work — has
      3 clicks and nothing else. Testing this felt useless because it was.

- [ ] **11 of 13 partners have `agreement_signed_at` NULL**, so the training
      page returns 403 `not_entitled` for them, including the test-role partner
      an auditor would sign in as.

- [ ] **Two stale comments that mislead a reader**, both about the leads path:
      `affiliate.html:817-825` says nothing records clicks (false — 9 rows exist
      and `public/start.html:52,56` POST them), and `api/read/affiliates.mjs:24-27`
      says af-02 has never written a referral row (false — it is registered and
      wired at `src/workflows/index.mjs:5,74`).

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

## Chris — owed to the 2026-09-03 fix batch
- [ ] Real contract text for each agreement (Funding Mastery, FUNDING-AGREEMENT, CREDIT-REPAIR-AGREEMENT; decide whether Capital Blueprint needs one). It may already be in the repo — W3 will search and tell you. See docs/workflows/fix-batch-2026-09-03.md W3.
- [ ] Tell W7 the exact AI setter symptom (call not placed / silent / hangs up / ignores prompt).
- [ ] Tell W4 whether the dispute-letter consent belongs on every client's portal or only repair clients (F35).
- [ ] Turn off the Gmail "FS Auto" filter before the re-walk (F17).
- [ ] Accountability upsell — Chris's idea 2026-09-03, note only. Revisit after the fix batch and fulfillment. See manual-walkthrough-2026-09-03.md.
