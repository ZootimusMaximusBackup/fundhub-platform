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

---

## UI — Client Control Panel, owner-set 2026-09-06

From Chris walking Walk1 Funding live.

### 1. The headline slot is answering the wrong question — move it or cut it

The biggest text on the page reads "Nothing waiting on this file. No bank yes on this
file carries a dollar amount yet." Directly beneath it sits ACTIVE BLOCKERS 5.

Both are true. They answer different questions. That slot is counting **bank answers
that still need a dollar amount typed in** — a bookkeeping counter — while looking like
the file's status. `public/app/client-control-panel.html:3031`.

**Chris: "This English here needs to go."** Delete it from the headline. If the count is
still wanted, it belongs beside the bank rows it describes, not at the top of the file.

### 2. The caveat sentence is not English

> "Counts bank answers we have been told about. Applications still out with a bank are
> not recorded anywhere, so they cannot be counted here."

`client-control-panel.html:680`. The comment above it (lines 674-679) explains why it
exists: nothing records an application at the moment somebody applies, so the count can
only cover answers already received. That reasoning is sound and the sentence is not how
a person talks. Rewrite or delete with the headline.

### 3. Three colours only, and they mean one thing each — owner-set

Operations screens use **green, yellow, red**. Nothing else. Chris: "all this orange and
yellow shit on the side of it needs to be green... hella confusing."

| Colour | Meaning |
|---|---|
| **Green** | Go. Nothing stopping this. |
| **Yellow** | A blocker. Somebody has to do something. |
| **Red** | Hard stop. Something is wrong with the file itself — a negative item on the credit report, for example. |

The five blocker cards currently carry orange/yellow left borders. Those are ordinary
open tasks on a clean file, so they are **green**. Applies across every operations
screen, not just this panel. `docs/UI-STANDARDS.md` is the home for the rule.

### Also found on the same walk (not UI — data and wiring)

- Next action says "Apply for Funding", the record says "Collect Documents". The screen
  prints a paragraph explaining the disagreement instead of resolving it.
- Open Inquiries reads **1**. The credit file has **4** (Capital One, SYNCB/PayPal,
  Navy Federal, Citibank).
- `inquiry_log` is **empty** for this client. The lender matcher builds its avoid-list
  from that table, so bureau avoidance has nothing to work with.
- **Income (Experian) $37,000/yr is not a bureau figure.** The stored credit file
  contains no income data at all. It is an estimate labelled as an Experian fact.
  `client-control-panel.html:1956-1958` reads `income_estimates`.
- The lender list shows **no bureau and no ranking** and is still alphabetical, though
  bureau data for 46 banks and rankings for 37 shipped on 2026-09-05 (PR #337).

### 4. The Apply button cannot open a bank page — CHRIS ONLY

Clicking Apply returns "Could not start Apply proxy. Oxylabs rejected the proxy login
(407)." The bank page never opens, and the dialog correctly warns not to apply from a
normal connection because the bank would see the wrong location.

**The error's advice is wrong.** It says the username is "the account id without the
customer- prefix". Checked 2026-09-06: the stored `OXYLABS_USERNAME` has no such prefix
and is already in the documented shape. So the credential is dead or expired, not
misformatted, and anyone following that hint will change nothing and conclude the code
is broken.

Two things:
1. Chris logs into Oxylabs → Residential Proxies → user credentials, and the real
   `OXYLABS_USERNAME` / `OXYLABS_PASSWORD` get set. Nobody else can reach that dashboard
   (`docs/STILL-MISSING.md:19`).
2. Rewrite that error so it reports what actually happened — the proxy refused the
   login — instead of naming a formatting fix that does not apply.

### Working correctly, do not re-test

- **The lender match narrows properly.** "18 fit" for an Arizona client, down from 313.
- The play dropdown on each bank row works: Card stacking first pull, In-branch visit,
  Online only, Docs first.
- All five tasks, the funding round, the sale and the payment are correct on screen.

### 5. The bank list looks like a spreadsheet, not a product — owner-set 2026-09-06

Chris walking Walk1 Funding: "There's no bank logo, the Apply button is massive, what's
play name." The FUNDING · APPLY DOOR section of `public/app/client-control-panel.html`.

**Confirmed hierarchy, for anyone touching this:** the Client Control Panel IS the main
file. Repair and Inquiry are sub-desks reached from it. Chris's read was right.

**a. The logos exist and this screen was never given them.** 244 PNG files sit in
`public/assets/lenders/`, and 21 wrong ones were corrected on 2026-09-05. But
`src/lenders/match.mjs` does not return `logo_path` in a match row, so the panel cannot
draw one. One field on the match payload, then render it beside the bank name.

**b. The Apply button is the widest thing on the row.** Bank name gets about 90 pixels
and wraps onto two lines ("Bank of / America", "Comerica / Bank"); Apply stretches the
remaining width. Invert it: the bank name and its logo lead, Apply is a normal button.

**c. "Play name" means nothing to anyone.** It records which tactic was used — the
dropdown offers Card stacking first pull, In-branch visit, Online only, Docs first.
Call it what it is. "How did you apply?" or "Approach".

**d. "No URL" is shown where an Apply button would be**, with no explanation. Those banks
take applications in branch or by phone. Say that instead of showing an absence.

### 6. The Specialist screen has no empty state

`public/app/inquiry-remover.html`, Repair tab. With zero rows it spins on "reading the
repair queue..." forever, every tile reading "—". Measured 2026-09-06: there are genuinely
0 dispute cases, so the queue is correctly empty — but an empty queue is indistinguishable
from a broken page, and Chris reasonably read it as broken.

Say "Nothing in the repair queue" and stop the spinner.

### 7. Delete the Generate Apps button — OWNER-SET 2026-09-06

Chris: "I don't think we're gonna need a Generate Apps button. That doesn't make any
fucking sense. Just delete that."

It creates nothing. Pressing it re-reads the lender match list, redraws the same rows,
and prints "apps ready — use Apply on each lender". An application record is only ever
created when somebody presses Bank yes or Bank no on a single lender row
(`src/applications/status.mjs`, `logBankDecision`). So the button promises an action it
does not perform, which is exactly why it reads as nonsense.

Remove the control from `public/app/client-control-panel.html`. The lender list already
loads on page open. Nothing downstream depends on the button.

This also closes the open question from the 2026-09-03 walk — "Should Generate Apps
create application rows?" The answer is no, and the button goes.

### 8. Open Inquiries shows the wrong number, and it changes on its own

Same file, same session, 2026-09-06:

| Time | Open Inquiries | Inquiry Removal |
|---|---|---|
| 3:39 AM | **1** | Blocked |
| 3:51 AM | **0** | Queued |

The credit file has **4**: Capital One (EX), SYNCB/PayPal (EX), Navy Federal (TU),
Citibank (EQ). Neither 1 nor 0 is right, nothing was done to the file between those two
readings, and the Inquiry Removal state moved from Blocked to Queued on its own.

Two things to find: what that tile is actually counting, and what changed the case state
with no human action.

### 9. Three funding numbers, and the client-facing one is 3x too big

Closer Dashboard for Walk1 Funding, 2026-09-06:

| Label | Shows |
|---|---|
| Conservative | $110,000 |
| Realistic · round 1 | **$636,000** |
| Personal + business stacked | **$636,000** |

The Client Control Panel shows **$212,000** for the same client, same moment.

**$636,000 is $212,000 × 3.** There is a `PERSONAL_LOAN_MULTIPLIER = 3.0` in
`vendor/underwriteiq-full/api/lite/crs/estimate-preapprovals.js`. The closer screen runs
the card estimate through it and prints the result as the headline a closer reads aloud.
Chris: "Nobody gets 600K in funding."

The two right-hand columns are identical because business funding is correctly $0 — no
company on file, so nothing stacks. Two labels, one number.

**Owner-set replacement — three numbers, nothing else:**

```
Personal      what they get on their own credit
Business      what the company adds ($0 with no company on file)
Total         the two added together
```

One source feeding all three. No multiplier presented as a forecast, no "conservative /
realistic" bands. Same numbers must appear on the Client Control Panel and the Closer
Dashboard.

Note this is the F15 defect returning in a new place — a client with no business was
quoted ~$740,000 on 2026-09-03. `src/underwrite/business-funding.mjs` fixed the business
half correctly; the personal half is now the one that is wrong.

### 10. No business means no business credit cards — OWNER-SET 2026-09-06

Chris: "When there's only personal funding qualified, they only get personal funding
banks. No business, no business credit cards. Duh."

Nothing in `src/lenders/match.mjs` checks this. Walk1 Funding has **no businesses on
file** and matched **18 business credit cards**.

Worse: all 313 rows in the book are business cards (`InBranchBizCC` 196, `OnlineBizCC`
117). `PersonalCC`, `PersonalLoans`, `PersonalLOC`, `BizLOC_Stated` and
`BizLOC_Documented` are **0 rows each**. So under this rule a personal-only client
currently matches nothing at all.

### 11. The personal card data is already in the repo and was filed under the wrong table

Corrected 2026-09-06. These pages exist in `credentials/notion-scrape/output/`:

```
alec-s-favorite-personal-cards--26a2ec40
high-limit-personal-cards--9cafa36e
best-balance-transfer-cards--f9e698f9
personal-loans--677b0a52
balance-transfers--6aaef26e
```

`LENDERS-REVIEW.md` shows the extractor read them and merged them into **business** rows
as hub enrichment — "High limit personal cards" and "Alec's favorite personal cards" are
listed as sources that enriched American Express, Chase and Capital One's business
entries. The personal cards became notes on business rows instead of `PersonalCC` rows.

Re-extract those five pages into the correct `lender_table` values. The bureau data for
them is already available: the inquiry database carries Navy Federal, Discover, Ally and
hundreds of other personal creditors.

### Not a bug — do not chase

**SMS is off on purpose (owner-set 2026-09-06).** Three texts sit at `attempts=0` and
will never send. Chris: "we turned off the text messages." Email delivers normally. The
portal sign-in link is email, not text.

### 12. Client portal copy — owner-set 2026-09-06

**a. "SALES CONVERSATION" comes off.** Chris: "replace w something less aggressive."
It labels the "Want more funding?" card on the client's own portal. The card itself is
fine — 20 minutes on what a bigger approval would take. The label announces the pitch.

Suggested: **"Talk it through"**, or drop the label and let the card speak. The body copy
already says what it is.

**b. "questions? text us anytime" is in the portal footer and texting is OFF.**
Owner-set 2026-09-06: outbound SMS is disabled. Inbound is built and never replies — a
text lands as an event and sits in Messaging until a human opens it. So the portal
invites every client to text and nothing answers.

Either cut the line, or build the inbound auto-reply (see below). Not both ways.

**c. "YOUR FUNDING ADVISOR — Not assigned yet"** on every client. Nothing in the system
writes an advisor assignment, so this never fills in. The copy underneath is honest about
it, which is the right call for now, but the assignment itself does not exist.

### 13. Inbound texts arrive and nobody answers

`src/adapters/twilio.mjs` handles inbound SMS properly — signature verified, turned into
a `message.inbound` event, threaded into the client's conversation, media URLs carried so
photos come through. Then it sits until a human opens Messaging.

There is no reply of any kind. A client who texts gets silence.

**The fix does not touch the outbound queue Chris turned off.** Twilio accepts a reply in
the webhook response itself and sends it directly. The same file already does this for
voice calls (`VOICE_ANSWER_TWIML`), so it is the identical pattern one level down.

Needs: a short acknowledgement pointing at the right place, plus STOP and HELP branches,
which carriers require regardless. Wording is Chris's call.

### 14. Assign advisors, and fill a pod to capacity

Chris, 2026-09-06: "We need to assign advisors. We basically fill up a role to capacity,
which we track through KPIs."

**Nothing exists.** `pod_assigned` and `pod_name` are fields on the client record and
nothing ever writes them. There is no capacity column anywhere — `src/hiring/booking.mjs:323`
says so outright: *"NO SEAT LIMIT IS ENFORCED, and none is invented."* Every client sees
"YOUR FUNDING ADVISOR — Not assigned yet" and always will.

**The capacity rule is already locked** and does not need re-deciding. From
`docs/workflows/archive/fundhub-conveyor-kpis-2026-08-23.md` §3, owner-set 2026-08-24:

| Seat | Bar | Time-max if they do nothing else |
|---|---|---|
| Closer | **27 deposits / month per pod** | ~213 calls (160h) |
| Funding advisor | **27 funded files / month per pod** | ~54 files; half a desk = 27 |
| Inquiry remover | file clock only — healthy ~15 days, hard stop 30 | **no monthly count. Do not invent one.** |
| Credit repair | same clock | **no monthly count. Do not invent one.** |

**One pod = one closer + one funding advisor.** Company bar = 27 × complete pods.

**So the rule for assignment:** a new funding client goes to the pod with room under 27
funded files this month. No pod with room is the hire signal, and the same doc says which
half to hire — uneven seats, hire the missing half; packed calendar, hire a full pod.

Build order per CLAUDE.md §3a: pods and assignment in the schema first, a read endpoint
that proves the count, then the screen. The client portal advisor line is the last thing
to change, not the first.

---

## Walk findings, 30 agents, 2026-09-06

Every item below was found by one agent and reproduced by a second before it was written
down. Ordered by what costs the most.

### THE CUSTOMER'S SCREEN IS THE WORST OF IT

**15. "See exactly where your file stands" is a dead page.** The main link on the client
portal opens three lines: the header, a back link, and *"We could not load your file just
now. Please refresh in a moment."* Refreshing never helps. This is the customer's primary
"where am I" link.

**16. The customer never sees her $212,000.** Your screens show it. Hers shows no funding
number anywhere — just "Your funding file is open." The number is in the page's own data
and is never drawn.

**17. The Activity tab tells the customer her history is broken.** *"We could not load
your activity just now."* Permanent.

**18. The portal tries to sell her a $32 credit pull she has already had** — and the card
sits a few inches below the three scores that pull produced.

**19. "Yours to keep, always downloadable" has nothing to download.** The Funding Snapshot
reads "ask your advisor in chat for a copy". No link, no button, and the advisor line on
the same page says nobody is assigned.

**20. Two document requests went out and the portal never says which document is missing.**
Two generic upload boxes and a dropdown of every possible type. The page has a slot built
for naming the missing document and nothing fills it.

### MONEY AND STATE DISAGREE ACROSS SCREENS

**21. The Sales board never marks this client won.** $3,000 is paid and the sale is
active. "Closed Won (deposit)" reads **0** and the card sits in "Decision Rendered".

**22. Finance OS cannot open a client at all.** Clicking it in the sidebar always lands on
a blank "Not connected" page. There is no dropdown, no search, no client list — zero
clickable elements. The $3,000 sale, the paid link and the fee appear nowhere on it.

**23. The $212,000 funding estimate is printed on the Inquiry Removal board** as the
column and board total, as though it were inquiry-removal money. Every card on every board
carries the same number.

**24. Two screens count inquiries differently under the same label.** The closer screen
says 4 — real bureau inquiries, correct. The Client Control Panel says 1 — it is counting
something inside one removal case. Neither screen says which it means.

**25. "Derogatories: —" on a clean file.** The system knows the answer is zero. The
summary looks for a field named `derogatories` in the raw bureau data, does not find that
exact name, and prints unknown. On a call where a clean file is the whole pitch, the
screen refuses to say it is clean.

### THE PIPELINE AND THE CALENDAR

**26. The pipeline card shows no credit scores.** 771 / 778 / 766 are on the page's data
and the panel prints "They said —" instead. It does print the invented $37,000 income.

**27. The calendar can only ever show 2 of the 5 tasks.** The other three were created
with no date, and this screen only draws dated work. They are permanently invisible here.

**28. Nothing on the calendar can tick a task off or claim it.** All five tasks have
nobody attached, every row says "unclaimed", and there is no control to change either.

**29. "LEFT TODAY" is not today.** It shows whichever day you clicked. "NO-SHOW" and
"SHOW RATE" are hardcoded dashes and take two of the five tiles in the best spot on the
page.

**30. "ON SHIFT · 370H 28M"** on the closer dashboard. That is 15 and a half days. It
counts from 22 August and never resets.

**31. The "Held only" filter wipes every board, every time**, while the summary directly
above it says the held count is unknown.

**32. "Up next" is not clickable.** The next booked call is plain text with no link, so
between calls you have to navigate back through Pipeline.

### THINGS THAT ARE INVISIBLE RATHER THAN BROKEN

**33. Two Quick Launch buttons are hidden from everyone, owner included.** "Open Closer
Deck" and "Open Credit Snapshot" are in the page with `display:none` written by the shared
menu script, because `present.html` is not on the allowed-screens list for any role. The
page itself loads fine if you type the address. Open Credit Snapshot is the button that
would reach the credit detail missing everywhere else.

**34. Every desk action reports its result under the wrong button.** Generate Apps, and
all three Pull buttons, print their message underneath "Issue Inquiry Removal" — so
pressing Generate Apps looks like the inquiry removal ran.

**35. "NEED ACTION" lists the same client three times** and all three rows link back to
the page you are already on.
