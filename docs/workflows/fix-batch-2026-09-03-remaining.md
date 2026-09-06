# What is STILL broken after the 2026-09-03 fix batch

Written 2026-09-03, right after the batch landed (commit `a733801b`).

**30 of the 37 defects are fixed.** This file is everything that is not, plus the
things the fixes uncovered. It is the input to the next batch.

Source of truth for the defects themselves stays
`docs/workflows/manual-walkthrough-2026-09-03.md`. The board with what each lane
did is `docs/workflows/fix-batch-2026-09-03.md`.

**Nothing in this file needs a decision re-litigated.** Where Chris already
decided, it says so.

---

## 1. CHRIS ONLY — nobody else can do these

| # | What | Why it is his |
|---|---|---|
| 1 | **DONE for two of four** — see 1.1. Still owed: the text for **FUNDING-AGREEMENT** ($3,000 deposit) and **CREDIT-REPAIR-AGREEMENT** ($1,000), plus a ruling on the **Blueprint price conflict**. | Executed legal text. Agents never draft it (F30, owner-set). |
| 2 | **Fix two ClickFunnels questions in the CF editor.** "Annual Business Revenue" saves into nothing at all, so that answer never reaches us and cannot be recovered. "Can You Verify Revenue?" is saving into `cf_svy_business_revenue`, which is the other question's slot. | The bug is inside ClickFunnels, not in this repo. |
| 3 | **Name 21 ads.** | An agent may not invent an ad title. |
| 4 | **Buy a Bland phone number.** The account owns none, so every call dials from a shared pool line. | A purchase, not a code change. |
| 5 | **Read the new Josh script** before it goes near a phone. | Owner reviews setter copy. |
| 6 | **Turn off the Gmail "FS Auto" filter** before the re-walk (F17). | His inbox. |

### 1.1 Contract text — two down, two to go

**UPDATE 2026-09-03, later the same evening.** Chris put the source documents in
the repo at `docs/contracts/source-2026-08-28/`, so this is now mostly closed.

**Seeded, real, done** (`db/migrations/288_real_contract_text.sql` plus
`db/seed/021_funding_mastery_agreement.sql`, text copied verbatim out of the
`.docx`):

* **Capital Academy** → `FUNDING-MASTERY-AGREEMENT`
* **Capital Blueprint** → `CAPITAL-BLUEPRINT-AGREEMENT`

Both name Fundhub LLC as the seller in their own first sentence and end in their
own signature block, so F28 and F29 are answered by the documents themselves.
Neither has any blank left to type, which is what makes send one click (F27).

**Still placeholder, and they will refuse to be sent by accident** — no text
exists for either, and the packet PDF does not contain them (it holds Academy on
pages 1-4, Blueprint on 5-8 and White Label on 9-19, checked page by page):

* `FUNDING-AGREEMENT` ($3,000 deposit)
* `CREDIT-REPAIR-AGREEMENT` ($1,000)

Both still carry `THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS.`, and
the migration raises a notice naming them on every production deploy.

#### The Blueprint price conflict — RESOLVED, owner-set 2026-09-03

**Capital Blueprint is $5,000.** Chris ruled: the contract was right, the price
list was wrong. The catalogue moved to match the document, not the other way
round — no word of the agreement was changed.

Changed: `src/config/offers.mjs` `UWIQ_DELIVERABLES.priceCents` 100000 → 500000,
and `db/migrations/289_capital_blueprint_price.sql` moves the second copy of that
number, `products.default_price` for `consulting-package`, from $1,000 to $5,000.
That column is only read when a payment arrives carrying no amount of its own,
which is exactly why it sat wrong unnoticed — and leaving it would have gone on
recording Blueprint sales at a fifth of their price on the one path that reads it.

`priceMinCents` stays $1,000. That is the floor a closer may discount to on a
custom-priced offer, not the list price, and moving a floor is a separate decision.

#### KNOWN CONSEQUENCE — the education ladder now has two rungs at one price

Capital Academy is also $5,000. So on the deck's education ladder, Blueprint and
Academy now cost the same and "step down on a no" has nothing to step down to.

The deck no longer lies about it: the ladder hint reads both prices and, when they
match, says *"Both courses are $5,000. Lead with Funding Mastery; this is a choice
of course, not a step down on price."* rather than the old *"Lead with the $5,000.
Only offer the $5,000 if it's a no."*

**Whether Blueprint should still be a rung on that ladder is a sales question, not
a code one.** Nobody has answered it. Options, none chosen: keep both at $5,000 as
a choice of course; make Blueprint a bridge into Academy rather than an
alternative to it; or price the ladder deliberately.

**Two smaller contract gaps, deliberately left:**

* `PARTNER-LICENSE` (white label) is untouched. Its real text exists twice now —
  in the packet PDF and already in `283_partner_license_template.sql` — and
  reconciling the two is its own task. White label is last in the ecosystem order.
* `REPAIR-TRIAL-AGREEMENT` and `REPAIR-AND-FUNDING-AGREEMENT` got the seller fix
  and a signature block but keep provisional wording. They were not among the four
  named agreements.
* The client's own business name is now on NO contract. F28 said the typed company
  name must never be the seller; it was removed rather than re-pointed at the
  client. If a client's company should appear as the buying party, that is a small
  follow-up.

### 1.2 The 21 unnamed ads

Ad ids with no title in `docs/ads/registry.json`:

```
27 28 29 30 31 43 44 45 46 72 73 74 75 76 77 78 79 80 81 82 83
```

Already named: 16 = phase, 26 = underwriter, 42 = ringlights.

Naming one is two edits: add `"title": "<the word after the dash in utm_content>"`
to that ad in `docs/ads/registry.json`, and delete its id from
`UNTITLED_ALLOW_LIST` in `src/ads/registry.test.mjs`. A check now fails while any
ad is still unnamed, so they cannot quietly stay blank.

---

## 2. ONE QUESTION EACH — small, blocked on a single answer

### 2.1 How should booking confirmations skip the 5-minute wait? (F1)

Built and tested, switched OFF, waiting on the answer.

* **Option A (recommended)** — turn the new send-now path on for the three
  booking-confirm messages ONLY. Nothing else in the system changes.
* **Option B** — make the sweeper run every 1 minute instead of every 5. That
  speeds up every outbound message in the product and multiplies the scheduled
  runs by five.

**Even with the answer, 60 seconds is not reached.** Measured on live: the booking
workflow took **44 to 188 seconds** just to write the messages down, before the
queue was ever involved, and it gets slower the more bookings land at once. That
half lives in `src/workflows/s-04b-booking-reminders.mjs` and the workflow engine
and nobody has taken it yet.

**And the AI phone call is a third thing again.** It is not in the message queue at
all — it dials directly. Whatever made it late is neither the sweeper nor the
booking workflow. Not diagnosed.

### 2.2 What counts as a "confirmed" booking? (F3)

Nothing moves a card from Booked to Confirmed, and the calendar RSVP is never
captured at all. Chris said only that it "should be tracked", which is not yet a
specification, and no intended journey has the step, so nothing was built.

One decision turns it into work — what counts as the confirmation:

* the **Yes on the Google calendar invite** (reaches Google only today; needs a new
  ingest), or
* the **YES text the client sends back** (already sets `call_confirmed=true` and
  could simply move the card too), or
* both.

### 2.3 Should "Generate Apps" create rows, or is the SOP wrong?

The button creates ZERO application rows; it only redraws the lender list. The SOP
says rows are created. One of the two is wrong. The SOP half is corrected; the
button half is a one-decision change in `public/app/client-control-panel.html`.

### 2.4 Which model tier should Josh run on?

This repository never sends a model to Bland, so the tier is a Bland account
setting, not a code change here. No agent will guess a model id off a list it
cannot see.

---

## 3. REAL WORK, NOT BLOCKED — the next batch

### 3.1 The lender matcher still ignores the credit file (funding finding 7) — BIGGEST

`matchLenders` filters on state eligibility, bureau sensitivity and the active flag
and **nothing else**, so a lender who only takes 700+ still matches a 588 file.

The count can no longer show before a pull (F10 is fixed), so this is now about
what a count MEANS after a pull — today, the same list for a 588 repair file and a
780 funding file.

What it needs:

1. extend `resolveMatchState` (`src/lenders/match.mjs:45`) to carry the credit file —
   score, tier, card use, stored estimate;
2. in `src/lenders/store.mjs` `matchForClient`, read the newest `crs_results` row and
   pass those signals in;
3. in `matchLenders`, skip a lender the file excludes, with a `reason` in `skipped`
   alongside the existing `state_ineligible` and `inquiry_sensitive`;
4. then tighten the `lenders_basis` string in `src/sales/cockpit.mjs`
   `gateLenderMatch()`, which currently says out loud that the match ignores credit.

### 3.2 Three other surfaces still produce zero letters

The repair-path gate was wired into the specialist desk path
(`src/repair/analyze.mjs`) only. Three others call the same engine bridge and still
see only Metro 2 findings, so a clean-but-derogatory file still yields nothing:

* `src/optimize-page/roadmap.mjs`
* `src/metro2/diy/deliver.mjs` (the DIY letter pack)
* `src/underwrite/letter-pack.mjs`

Each has its own gate and its own client context. Separate task.

### 3.3 The owner "send portal sign-in link" button

The endpoint exists, is routed and is monitored (`api/auth/send-portal-link.mjs`).
What is missing is the button on the Client Control Panel that calls it — the
client-facing reset screen tells people to ask an admin for a link, so an admin
needs somewhere to press.

### 3.4 The advisor will often still be empty (F34)

F34 is fixed in the sense that the portal now shows the advisor or an honest empty
state. But **nothing in this repository ever WRITES an advisor assignment.** Until
something does, the honest empty state is what most clients will see.

### 3.5 F22 was proven at the wrong zoom

The slides were checked by rendering the real page against a stubbed payload at
1440x820 — not against the live site, and not at the 50% browser zoom Chris was
actually using when he saw the empty slides. Worth re-checking during the re-walk.

### 3.6 Screenshots are unmarked

CLAUDE.md §8 requires red boxes, numbers and a legend before a screenshot counts as
evidence. The batch's screenshots do not have them.

---

## 4. DATA GAPS — no code will fix these

### 4.1 There are no personal lenders at all

313 lenders in the book: **196 InBranchBizCC + 117 OnlineBizCC, zero personal.**
Meanwhile the funding estimate promises **$199,350 of PERSONAL money**
($123,750 card + $75,600 loan) with no personal lender to apply to.

Business decision, not a code change. Nobody invented lenders.

### 4.2 Bureau rotation is dead because the column is empty

**310 of 313 lenders** have a blank `bureaus_pulled` field in
`credentials/lenders-audit/lenders-audited.csv`. Only American Express (EX),
Citizens Bank (EQ) and Goldman Sachs (TU) are filled in. All 313 have a blank
`business_bureau_pulled`.

So no lender is ever skipped to protect a bureau, and the rotation sort has nothing
to sort on. **The matcher code itself is correct.** Somebody has to fill the column
in.

**Unverified:** every lender number above is counted from the spreadsheet in the
repo. Nobody queried the live database.

---

## 5. CLOSED — do not re-open these

| Ref | Verdict |
|---|---|
| **F14** | **NOT a defect.** The funding estimate is *supposed* to ignore the credit score. Owner-set: follow the UnderwriteIQ rules exactly, and they have no score factor here. 724 and 762 yielding the same figure is correct. |
| **Funding 11** | **NOT a defect.** Business money is supposed to be $0 without a real business credit report. |
| F6, F12, F19, F20 | Retracted during the walk itself. Each is written up in the log with why it was wrong. |

---

## 6. THE SETTER — what is known and what is not

**Fixed, and it was a real regression.** `src/messaging/providers/bland-voice.mjs`
built `first_sentence` from the agent's own prompt, and Bland speaks that field
word for word, so Josh opened every call by reading his instruction sheet out loud:
*"You are a Fundhub voice agent."* Introduced 2026-08-26. Removed.

The same line meant the "this call is recorded" notice was never the first thing
said on a call that was being recorded, even though `record` is true.

**Still unknown: which symptom Chris actually heard.** Nothing in the walk log
records whether a Josh call was even placed, and there is no Bland call id for it.
Nobody queried the live database.

**Likeliest remaining cause of "it rings and nobody speaks":** the Bland account
owns no phone number, so every call dials from a shared pool line. Five consecutive
AG-04 calls to the same handset came back `no-answer` with `started_at: null` —
the carrier never completed the call, so the robot never got to talk. Measured
2026-08-27. That is a purchase.

**Placeholders are a trap.** `placeCall` sends no `request_data`, so any `{{key}}`
in a prompt reaches Bland as literal text. The vendor Josh script has 27 of them.
Either `placeCall` learns to pass `request_data`, or the AG-04 prompt stays
placeholder-free forever.

---

## 7. TEST AND PROOF STATUS, stated honestly

* Unit suite: **8549 tests, 8546 pass, 0 fail, 3 skipped.**
* **The database (`.pg.test.mjs`) phase did NOT run** — no `DATABASE_URL` was set,
  so 693 of them skipped. Per CLAUDE.md §12 that number proves nothing about
  anything needing a database. Somebody must re-measure against a scratch Postgres.
* `npm run lint`: clean, 1780 files.
* **No Playwright run against the live site.** Seven agents were editing one
  checkout, so browser proof was deliberately skipped. Every screen fix in this
  batch is unproven in a real browser until the re-walk.

---

## 8. NEXT — in order

1. Chris pastes the contract text and fixes the two ClickFunnels questions.
2. Re-walk from the ad click, **in a different thread from the one that fixed it**,
   with the expected-output specs open beside the real output (owner-set).
3. Lender matcher reads the credit file (§3.1).
4. The three remaining letter surfaces (§3.2).
5. Booking-confirmation speed, once Option A or B is chosen (§2.1).

---

## 9. The survey-field bug, split in two (measured 2026-09-04, live)

Chris's read was right that part of this is code. Measured against the production
database and his live ClickFunnels editor, it is **two separate faults**, and only
one of them is his to fix.

**Survey builder, for anyone who needs it again:**
`https://chrisstanbridgestea3f77f.myclickfunnels.com/account/survey_workflows/vklXEJ/builder`
(workflow id `vklXEJ`, site `NOpbbd`). This was not written down anywhere, which is
why "fix the two CF questions" cost a hunt.

### 9.1 Raw row ids instead of words — CODE, already fixed, NOT PROVEN

All five sim clients store every answer as a ClickFunnels row id, not the answer:

```
cf_svy_funding_target_amount = 207883      (not "$200k - $400k")
cf_svy_planned_use           = 207888      (not "Growth (marketing, inventory, hiring)")
```

The ids are per-submission, not per-option — the same answer text carries a different
number on each client (sim-02 and sim-04 both answered "Under $100k" and stored 208008
and 208009). So the words are not recoverable from what we kept.

`pickSurveyAnswers` in `src/adapters/clickfunnels.mjs` resolves this now, using the
`_label` / `_labels` siblings CF sends beside each id. It landed in `a733801b` on
2026-09-03 and is on `main`.

**But the sims were created at 00:47-01:08 UTC on 2026-09-04, during the walk and
BEFORE that fix deployed. So their data proves nothing about whether the fix works.**
And the fix degrades silently: `if (words == null) continue;` keeps the id when no
label arrives. If ClickFunnels does not actually send `_label` siblings, the screens
still show numbers and nothing complains. **Nobody has confirmed CF sends them.**
One real submission through the funnel, then read the raw payload, settles it.

### 9.2 "Can You Verify Revenue?" overwrites the revenue answer — CLICKFUNNELS

"Annual Business Revenue" **is mapped correctly** — its Contact Attribute reads
`Cf Svy Business Revenue` in the live editor, checked 2026-09-04. The claim in §1
that it "saves into nothing at all" is wrong; delete it.

What is wrong is the other one. Across all five sims:

* `cf_svy_business_revenue` — has a value on all four business-branch clients
* `cf_svy_revenue_verifiable` — **null on every one of them**

If the verify question were mapped to its own attribute, those four rows would carry
a number. They are empty, and F8 recorded the panel showing the verify answer
("Yes, both") under Business revenue. So the second question is still pointing at the
first question's attribute, and the revenue figure is destroyed by the answer that
follows it.

**Chris's one job here:** open the builder link above, click **Can You Verify
Revenue?**, and set Contact Attribute to `cf_svy_revenue_verifiable`. That is the
whole fix. The "Annual Business Revenue" question needs nothing.
