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
| 1 | **Paste the real contract text.** Four agreements are waiting. Until then every contract sent from the deck carries the words `THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS.` in the middle of it. | Executed legal text. Agents never draft it (F30, owner-set). |
| 2 | **Fix two ClickFunnels questions in the CF editor.** "Annual Business Revenue" saves into nothing at all, so that answer never reaches us and cannot be recovered. "Can You Verify Revenue?" is saving into `cf_svy_business_revenue`, which is the other question's slot. | The bug is inside ClickFunnels, not in this repo. |
| 3 | **Name 21 ads.** | An agent may not invent an ad title. |
| 4 | **Buy a Bland phone number.** The account owns none, so every call dials from a shared pool line. | A purchase, not a code change. |
| 5 | **Read the new Josh script** before it goes near a phone. | Owner reviews setter copy. |
| 6 | **Turn off the Gmail "FS Auto" filter** before the re-walk (F17). | His inbox. |

### 1.1 The contract text — exactly what to paste and where

The real full-length agreements are NOT in this repo. They are Word and PDF files
on Chris's own machine, and agents did not open them (CLAUDE.md §2, this repo
only):

* `~/Desktop/fundhub-contracts/Fundhub-Capital-Academy-Enrollment-Agreement.docx`
* `~/Desktop/fundhub-contracts/Fundhub-Capital-Blueprint-Service-Agreement.docx`
* `~/Documents/File-Sweep/Work-Bucket/Fundhub-Education-Service-Agreement.pdf`

Each agreement has exactly ONE marked block to paste into, inside
`db/migrations/287_contract_seller_signature_and_real_text.sql`. Everything else —
the seller party, the merge variables, the signature block, the fee lines — is
already correct and does not need touching.

**One warning that matters.** Once migration 287 has run on production it is never
read again (CLAUDE.md §12). Pasting into it AFTER it ships changes nothing. If it
has already deployed, the text goes into a NEW migration that supersedes it.

**No real text exists anywhere for the CREDIT-REPAIR-AGREEMENT.** The other three
have a source document. This one does not. That gap is Chris's to close.

**Two smaller contract gaps, deliberately left:**

* `PARTNER-LICENSE` (white label) is untouched. It still fills the Fundhub side
  from a typed blank and has no signature block in its body. White label is last
  in the ecosystem order, so this was not in scope.
* `REPAIR-TRIAL-AGREEMENT` and `REPAIR-AND-FUNDING-AGREEMENT` got the seller fix
  and the signature block but keep provisional wording. They were not among the
  four named agreements.
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
