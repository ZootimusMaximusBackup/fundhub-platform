---
stage: 3
version: 1
status: draft
inputs:
  01-avatar.md: d9a21ad8
  02-ad-research.md: ee90186f
counts:
  priceSet: 1
  bonuses: 3
  valueEquationScores: 4
---

# THE LOCKED BOOK — FINAL PARTNER OFFER

Written 2026-08-31. Every claim below names the file that proves it. Where there was no proof, the claim is gone, not softened.

---

## 1. The offer in one sentence

**You get a funding company under your own name, and every client you bring is locked to you by a rule inside the database — not by a promise in a contract — and we will show you the exact line that does it, on the call, before you pay a dollar.**

---

## 2. The price, and why that number

**$10,000. Once. Nothing monthly. HELD — no change proposed.**

Proof: `src/config/offers.mjs:197-208` — `PARTNER_ENTRY`, `priceCents: 1000000`.

Why that number:

- It is already the number in the code and already the number in the signed agreement. `db/migrations/283_partner_license_template.sql` says it in plain words: "You pay $10,000 to join. You pay it one time. There is nothing ongoing."
- You can pay it over time. `financing: true` in the code, and the license says why: "A payment plan is a way to pay. It is not a test you have to pass, and no lender decides whether you become a partner. The review call decides that."
- **What it costs us in ads to get one partner buyer is not on file. PROOF: NONE ON FILE.** The only acquisition numbers in this repo model the funding-client funnel, not a $10,000 seat. See section 8.

**One thing that changed from the draft: the $297 trial is not the front door.** It is held out of this offer, and I have to be straight about why, because both reasons the draft printed are gone:

- The draft said a trial buyer costs $2,000 to acquire. **PROOF: NONE ON FILE — that number appears nowhere in this repo. Deleted.**
- The draft said the trial was blocked on unbuilt code (`docs/specs/W4-live-trial.md:765`, "Blocked until W1 ships the accrual writer (F1)"). **That code has since shipped** — `src/partners/revenue.mjs`, wired into `src/handlers/money-chain.mjs:46` and fired at `:469`. The blocker no longer blocks.

So the honest position is not "the trial fails." It is: nobody has measured what a trial buyer costs or how many upgrade, so nobody can say whether it clears any bar. It stays out of this offer until somebody measures it. Not cancelled — held.

The front doors that stay open are the two cheap ones that are built and are 100% ours:
- Decline Autopsy — **$27** (`src/config/offers.mjs:164-173`)
- Winner's Board — **$47** (`src/config/offers.mjs:175-184`)

---

## 3. What they get — the actual list

### 1. THE OWNER LOCK

When you bring someone in, your name goes next to that person in the book. **Nobody can be put in your place.** Not our staff, not another partner, not us.

The technical version, which we put on screen during the call:

- `db/migrations/033_affiliates.sql:375-376` — a unique index on the pair (client, tier). The database physically refuses a second owner.
- `src/affiliates/economics.mjs:73-81` — every write goes through one function, and it ends `ON CONFLICT (client_id, tier) DO NOTHING`. A second person's link on your client does not overwrite you. It does nothing and dies.
- There is no UPDATE path to that column anywhere in the codebase. I looked.
- The migration says in its own comment why it was built: so "a bug in a handler, a replayed webhook, or a second affiliate's link cannot silently move somebody's commission" (`033_affiliates.sql:372-373`).

**The one thing staff can do, said before you find it.** There is a function that marks a referral void with a written reason — `voidReferral()` at `src/affiliates/economics.mjs:482`, its own comment reads "disqualify or claw back." A voided row stops counting toward your balance. It is called today from `src/trials/conversion.mjs:131`. So the accurate promise is narrow and I am not going to widen it: **your client cannot be handed to somebody else.** A referral can be killed with a reason on the record. It cannot be moved.

This part is **wired and shipped** — `src/workflows/af-02-referral-ownership-capture.mjs` is what calls it, and it is registered in `src/workflows/index.mjs` (line 5 import, line 74 registration). It has not been run against a paid partner referral, because there have not been any. Wired and shipped is what I can prove. Traffic is not.

The picture: a non-circumvention clause is a lock on a door. It works until somebody kicks it. This is a deed at the county office. Moving your client is not against the rules — there is no form to fill in.

### 2. THE SPLIT: 50% OF EVERY PAYMENT, FRONT AND BACK

Half of what your clients pay for funding work, and half of what they pay for credit repair. That covers the money paid at the start and the money paid later, and it includes half of the 10% success fee when a client gets funded.

Proof, in the agreement you sign: `db/migrations/283_partner_license_template.sql` — "You keep 50%. We keep 50%… It **includes** half of the 10% success fee a client pays when they get funded."

**Read that word "includes" carefully, because it is the thing people get wrong.** The $3,000 funding deposit is *part of* the 10%, not on top of it. `docs/specs/W1-money-model.md:257`: "The $3,000 deposit **counts toward** the 10%. It is not additional." `docs/specs/W3-decline-autopsy.md:600` says the same sentence. So on a $120,000 funded deal the client owes $12,000 in total, $3,000 of it already paid, and $9,000 is invoiced at funding (`docs/specs/W5-offer-page-funnel.md:586`). Your half is half of the $12,000 total, not half of the deposit plus half of a fresh 10%.

Spec: `docs/specs/W1-money-model.md:45-46` and `:184-186`.

**The split is written by the system, not by a person.** The accrual writer has shipped: `src/partners/revenue.mjs`, tested by `revenue.pg.test.mjs` and `revenue.test.mjs`, imported at `src/handlers/money-chain.mjs:46` and fired inside the payment settle path at `:469`. The draft said this was hand arithmetic and named `W1-money-model.md:71` as proof. That line is a finding that has since been fixed, and quoting it now would be quoting a stale to-do list. **Corrected.**

**What the license does and does not say about the split changing.** The license sentence is: "This split does not change. **Nothing you add on, buy, or stop buying** moves it, in either direction." That qualifier is real and I am leaving it in, because the production floor in item 9 *does* move the rate on new business if you miss three months in a row. Buying or dropping add-ons cannot move your split. Production can. Both are printed here so you do not find the seam later and think you were played.

### 3. THREE MONEY RULES THAT ARE ALREADY IN THE SIGNED AGREEMENT

All three from `283_partner_license_template.sql`, and all three are unusual in this market:

- **No hold-back.** "Once your share is recorded it goes into the next payout run — we do not park a percentage of it somewhere to be released later."
- **No clawback.** "Money we have already paid you is yours. If a client later refunds or reverses a charge, that is our loss and we do not take it back out of you."
- **Your rate freezes on each payment when you earn it.** So a rate change next year cannot re-cut money you already earned. Proof: `docs/specs/W1-money-model.md:84` and `:504`, and the `share_pct_applied` column in `db/migrations/042_partners.sql`.

### 4. REFUNDS ARE MATCHED, NEVER GUESSED

If a client refunds, the system matches the reversal back to that exact payment. If it cannot find it, it refuses and shouts rather than guessing. Nobody else's refund can come out of your money. Proof: `src/handlers/money-chain.mjs:1317` (`reversePartnerRevenue`) — the code says "matching a reversal to an accrual by amount would eventually reverse somebody else's deal."

**This path is wired, not idle.** `voidForRefund` from `src/partners/revenue.mjs` is imported at `money-chain.mjs:46` and called at `:1365`, inside the refund and chargeback handlers. The draft said it had nothing to reverse yet. **Corrected.**

### 5. YOUR COMPANY, NOT YOUR AFFILIATE LINK

Brand Studio builds it: your entity name and address, your wordmark, your two brand colours, your type, your voice, your own verified domain, your support email, and up to five funnel pages — application, diagnostic, education, affiliate recruit, booking.

Proof: `db/migrations/043_partner_brand.sql:34-66` and `src/brand/templates.mjs`.

The legal blocks on those pages are locked and cannot be edited or rewritten by a model. That is deliberate. It is what makes your own name safe to put on them.

### 6. THE BACK OFFICE — WE DO ALL THE WORK

The license says it: "FundHub performs all fulfilment — the whole of the funding work and the whole of the credit repair work, from the first call to the last step. You are not asked to deliver any part of it yourself."

That means: underwriting (the UnderwriteIQ soft-pull assessment, `src/config/offers.mjs:83-93`), the funding pipeline, dispute letters, messaging, the client portal, the money ledger, refunds, chargebacks. It is the same machine that runs our own clients.

**Word removed from the draft: "tri-bureau."** The lines cited say only the product name and its price. **PROOF: NONE ON FILE at that citation — the word is deleted rather than re-cited from somewhere else, because what the buyer's clients actually get is a factual claim and it needs the right file, not a nearby one.**

### 7. YOUR OWN AFFILIATE TIER

You can sign your own affiliates. What you pay them comes out of your half, not ours. License: "You may bring on your own affiliates. What we pay them comes out of your half, not out of ours. FundHub's 50% never moves."

The two-level machinery is built — direct and downline, with the same lock on both (`src/affiliates/economics.mjs:54, 442-474`).

**The rates are live and they are owner-set: Tier 1 direct 20%, Tier 2 downline 5%.** This was wrongly deleted from the draft as unproven. It is proven, and the proof is not the code comment the draft looked at — it is two migrations:

- `db/migrations/260_affiliate_commission_rates_20260824.sql` seeds the schedule, marked "OWNER-SET (Chris 2026-08-24)."
- `db/migrations/261_affiliate_tier1_20pct_20260824.sql` raises Tier 1 from 15% to 20% effective 2026-08-24T17:00Z, inserting live `affiliate_commission_rules` rows at percent 20 for direct funding and direct repair and retagging the live 5% downline rows — every row marked "Owner-set 2026-08-24 AF-04. Tier1 20% / Tier2 5%."
- `docs/specs/W1-money-model.md:63-65` (decision D9): "Live affiliate schedule: Tier 1 direct 20%, Tier 2 downline 5%… Already applied," naming both migrations.

**Restored.** The draft replaced these with "your rates are set on your record at signup," which quietly loosened a locked term.

### 8. THE PRINTED LIMITS — what you do NOT get

This is in the agreement, before you pay, because you have been lied to before:

- You do not get the client management system. You cannot open, move or edit a client file inside it.
- You are never shown lender data. Not which lenders, not their names, not their rules, not what any of them said about anybody's file.
- We do not sell you phone lines. There is no phone number field anywhere in the brand record (`db/migrations/043_partner_brand.sql` — checked, none).
- We do not promise you any amount of money, any number of clients, any sale, any funding approval, or any credit score change.

All four are the license's own words or its own structure.

### 9. THE PRODUCTION MINIMUM — the one bar you have to clear

Ten funding clients a month. This is real, it is coded, and it is in the agreement.

Proof: `src/partners/floors.mjs` — `FLOOR_CLIENTS_PER_MONTH = 10`, `DOWNGRADED_SHARE_PCT = 20`, `CURE_DAYS = 30`.

The ladder, in the license's own words:
1. Miss once — a warning letter with your number and the next check date.
2. Miss twice in a row — final notice, and a 30-day window to fix it.
3. Miss three times in a row — your share moves from 50% to 20%, **on new business only**. Nothing already paid is taken back. Nothing already recorded is recalculated.
4. Clear it again for one full check — you go back to 50% on new business.

You keep your book, your brand, your clients and your balance either way. The code never touches your status and never blocks a payout you earned (`floors.mjs`, the "two things this deliberately does not do" note).

---

## 4. The guarantee

**One guarantee we can make today, and one make-good that is not in the signed document yet and therefore is not promised here.**

### THE LOCK — WHAT IS PROVEN, AND WHAT IS NOT PROMISED

The lock itself is proven and it is section 3, item 1: a unique index and an `ON CONFLICT DO NOTHING`, with no UPDATE path to the owner column anywhere in the codebase. Your client cannot be handed to somebody else.

**What the draft promised here and what I removed.** The draft said that if a client attributed to you was ever paid out to somebody else, we would pay you 100% of the commission on that client out of our own half and refund your $10,000 in full. That is deleted, and here is exactly why:

- **Nothing in the signed license contains it.** `db/migrations/283_partner_license_template.sql` has no such clause, and no code implements it. **PROOF: NONE ON FILE.**
- **The license contradicts the money half of it.** The license says "FundHub's 50% never moves" and "This split does not change." A make-good paid out of our half is precisely the movement the contract rules out.
- **The license contradicts the refund half of it.** "You have 3 days from the day you pay to ask for the joining fee back… After the third day the joining fee is not refundable" (`283_partner_license_template.sql:163-165`). An open-ended refund of that same fee sits outside the signed document.

A guarantee the signed paperwork denies is the exact failure this offer exists to avoid. So it is a build item, not a promise: **the lock make-good has to be written into the license as a new migration before anybody is told about it.** See "Before this sells."

**How you check the lock yourself, rather than trusting us.** You get read access to your own partner record and your accrued balance. `api/read/partners.mjs` is routed in `netlify/functions/api.mjs` as "read/partners" and uses `scopeFor` from `src/partners/scope.mjs` to confine you to your own row. That is real and you can use it.

**What does not exist yet, said plainly because it is the thing you would check with:** there is no monthly statement in this repo — no generator, no template, no endpoint — and no partner-scoped client list. So "you can see your own book" overstates it today. What you can see is your record and your balance. The statement and the book view are build items.

**The honest gap, said before you ask.** This lock is a row in a database we own and we host. There is no escrow. There is no outside arbitrator. If we ever decided to break it, code would not stop us — we would have to write a migration to do it, and that is a thing that leaves fingerprints, but it is not a wall. What actually protects you is the agreement, and the agreement is saved word-for-word with the moment you signed it, so the terms on your deal cannot be quietly rewritten later.

### GUARANTEE — THE BUILD

Your company goes live under your name — domain verified, pages published, portal open — inside a fixed number of days from you finishing brand intake and pointing your DNS.

**The number of days is not set yet, and I am not going to invent one.** The draft said 14 days. **PROOF: NONE ON FILE — no 14-day figure appears anywhere in this repo, and no partner build has ever been timed.** The nearest thing on file is `docs/specs/W4-live-trial.md`, which describes a same-day (H+0 to H+6) provisioning sequence for the *trial*, which is not a brand build. Chris sets the number as an owner decision and it gets logged as owner-set. Until he does, this guarantee ships with a blank in it and cannot be sold.

If we miss it: we run **Done-For-You Marketing** for you, and we waive the fee every single month until your brand is live. Retail on that is **$2,497 a month** (`src/config/offers.mjs:283-298`). Your ad spend is still yours.

**This changed from the draft, on purpose.** The draft refunded your $10,000. That put our own money at risk instead of our labour, which is the wrong place for a guarantee to sit. Now, if we miss, we work for free until we fix it. That costs us more effort and less cash, and it means you end up with the thing you bought instead of your money back.

The clock starts when your intake is complete and your DNS is pointed, and pauses if either is not. That is not a dodge — we cannot verify a DNS record you have not created.

### WHAT WE DO NOT GUARANTEE, IN PLAIN WORDS

A deal. An amount. A date for your first commission. Any income at all.

**There are zero paid partner closes on record.** The code says it to itself so nobody can forget: `src/trials/constants.mjs` — "NO EARNINGS CLAIMS. There are zero measured paid closes on record, so nothing in this module may state, imply or model a booked call rate, a typical result, a range, or another buyer's result."

Anybody in this category quoting you a number is either measuring something we cannot see, or making it up.

---

## 5. The bonuses

Three. All built. All capped.

The draft claimed $10,000 of bonus value and half of it was a course that does not exist. That is gone — see section 9.

**BONUS 1 — Decline Autopsy on your own dead files. 25 of them, in your first 90 days.**
Retail $27 each (`src/config/offers.mjs:164-173`) = **$675**.

**Correction to the draft, and it matters.** The draft said each autopsy "runs a real soft pull that costs us $32 wholesale." Both halves of that are wrong:

- **The autopsy runs no credit pull at all.** `docs/specs/W3-decline-autopsy.md` section 8.2 is titled "No credit pull. Ever. On anybody in this file," and it lists every soft-pull file the autopsy does not touch. The report is specified to say on its face: "We did not look at anyone's credit."
- **The $32 is our sell price, not our cost.** `src/config/offers.mjs:83-93` is the UnderwriteIQ soft-pull assessment at `priceCents: 3200` — what a customer pays. `src/partners/floors.mjs` names it the same way. **PROOF: NONE ON FILE for what a soft pull costs FundHub — there is no wholesale, cost-of-goods or COGS figure for one anywhere in this repo.**

So the "$800 worst case" is deleted too. The cap of 25 stays, and the honest reason is a different one: **what it costs us to deliver an autopsy is not on file, and you do not hand out an uncapped promise against an unknown cost.** A cap we can honour beats "unlimited" that gets quietly rationed the first time somebody sends 300 files.

**BONUS 2 — Creative Intelligence, free for your first 90 days.**
Retail $297/month (`src/config/offers.mjs:269-282`) = **$891**.
Hooks written for your offer, your own ad segment so partners never bid against each other, the Winner's Board, and your numbers read back to you.

**BONUS 3 — Winner's Board, included.**
Retail $47 (`src/config/offers.mjs:175-184`).

**Stack total: $675 + $891 = $1,566, plus Winner's Board.** I am not printing a single headline number, because the third line is unresolved: the code prices Winner's Board as one-time (no `billing` field), and `docs/ads/ascension-ads.md:114` talks about "board subscribers." If it is a subscription, its retail is not $47 and the total is not $1,613. **Somebody picks one before this ships. Until then the stack is $1,566 plus one line we cannot value.**

---

## 6. What we took from the offers that lost, and why

**From A-dream — the seat you can hand out.** You can sign your own affiliates, and what they cost comes out of your half. That is the only part of any offer that makes you the house instead of a nicer-looking middleman. Taken as-is: the 20% / 5% rates are live and owner-set (migrations 260 and 261), and the $2,000 recruit bonus is built — `src/partners/recruit.mjs`, backed by `db/migrations/281_partner_recruited_by.sql`, calling `accrueRecruitBonus` / `ENTRY_FEE_CENTS` / `RECRUIT_BONUS_PCT` from `src/partners/revenue.mjs`, and registered in `src/register-all.mjs`. The draft called both of these "specified, not seeded." **Both were wrong. Corrected.**

**From A-dream — the printed limits.** "You do not get the client management system." "You are never shown lender data." "We do not promise you any amount of money." Kept word for word. To somebody who has already been lied to, a written list of what you are NOT getting is worth more than another list of what you are.

**From A-dream — the production floor, welded to the limits.** Ten funding clients a month, the 50%-to-20% ladder, the 30-day cure, new business only. This is the only demand filter in any of the offers. It stops dead seats eating capacity we have never measured, and it does it without ever taking money back.

**From C-risk — the make-good pays in a waived fee, not a refunded price.** This is the single biggest change from the draft. Our risk on the build guarantee comes out of what it costs us to work, not out of the $10,000 you paid. That is where a guarantee belongs.

**From C-risk — the seat-live make-good.** If your brand cannot take a paying client under your own name inside the promised window, we run your marketing free until it can. It guarantees the one thing we actually control, it costs us real money when we miss, and it turns the one claim we could not prove — how fast we set up — into an obligation we carry instead of a promise you have to believe. The window itself is still an owner decision, not a measurement.

---

## 7. What the judges wanted to kill, and what we did about each one

**KILL 1 — "The lock protects your commission, not your client relationship. There is no non-circumvention clause anywhere."**
Correct, and I checked: I searched every migration, every source file and every doc. **PROOF: NONE ON FILE — there is no non-circumvention clause in the signed license.** The only hits are prose in `docs/specs/W4-live-trial.md:729`.
What we did: this is now a build item, not a claim. **Add a non-circumvention clause to the PARTNER-LICENSE template as a NEW migration (285).** Not an edit to 283 — editing an applied migration does nothing at all (`CLAUDE.md §12`). **This offer should not be sold until that clause is in the signed document.** Until then, the code protects your commission and nothing protects the relationship, and saying otherwise would be the exact lie this offer is built to avoid.

**KILL 2 — "Zero paid partner closes, and the person who signs off on the build guarantee has not been named."**
The zero stays in the offer, in the guarantee section, in our own words. We are not hiding it.
The unnamed reviewer is a staffing decision, not a build. `docs/specs/W4-live-trial.md:208` requires a named reviewer; `docs/specs/W4-live-trial.md:756` (row U7 in that file's uncertainty table) records that nobody holds it — "A gate nobody owns is not a gate." **Chris names a person before the first seat sells.** One decision, one minute. *(The draft cited this as "`U7:756`". There is no file called U7 — it is a row label. Pointer fixed, because a document that names its proof has to name something a reader can open.)*

**KILL 3 — "Nothing in production writes the partner ledger. Every split is a human doing arithmetic."**
**No longer true, and the draft was quoting a stale finding.** The accrual writer shipped: `src/partners/revenue.mjs`, tested by `revenue.pg.test.mjs` and `revenue.test.mjs`, imported at `src/handlers/money-chain.mjs:46` and fired at `:469`. The reversal half is wired at `:1365`. `W1-money-model.md:71` records the old gap; it has been closed. This is no longer a launch gate and it is no longer stated as a weakness in the offer.

**KILL 4 — "The $297 trial front door does not clear 2x."**
**Both supports for that kill have collapsed and I am not going to pretend otherwise.** The 2x arithmetic rested on a $2,000 acquisition cost that appears nowhere in this repo, and the unbuilt-code blocker has been cleared by the accrual writer shipping. The trial is still out of this offer, but for the honest reason: **nobody has measured what a trial buyer costs or what share upgrade, so nobody can say whether it passes or fails.** Held, not killed.

**KILL 5 — "Unlimited Decline Autopsy is uncapped cost against a $32 soft pull."**
The premise was wrong: the autopsy runs no credit pull at all (`W3-decline-autopsy.md` §8.2), and the $32 is our sell price, not our cost. **What one autopsy costs us is not on file.** The cap of 25 in the first 90 days stays anyway, because an uncapped promise against an unknown cost is a bad promise regardless of which way the unknown lands.

**KILL 6 — "The build guarantee refunds the $10,000, so your principal is at risk."**
Changed. The build guarantee now waives a fee instead. Principal is no longer at risk on that one.

**KILL 7 — "Funding Mastery is in the bonus stack and W7 says nothing is built."**
Removed entirely. `docs/specs/W7:7` — "Status: specification only. Nothing built." The bonus stack dropped from a claimed $10,000 to $1,566 plus one unresolved line.

**KILL 8 — "The deed is recorded in FundHub's own county, and you brag that the guarantee is cheap."**
The best answer available is not a better argument, it is admitting it. Section 4 now says out loud: there is no escrow, there is no outside arbitrator, and code would not stop us if we decided to break it. It also says that staff can void a referral with a reason, which is the nearest thing to a lever that exists. What you actually have is the index, your own read access, and the agreement saved word-for-word at signature. A man who has been backdoored can smell a confident answer to this question. He cannot smell an honest one, because he has never heard one.

**KILL 9 — "You volunteer 'we do not sell you phone lines,' which hands him the one thing he asked for by name."**
Moved. It is no longer a standalone brag. It sits in the printed limits list with the other three things you do not get, where it reads as honesty instead of a boast.

---

## 8. The cash arithmetic, and the hole in the middle of it

**Start with what is missing, because it is the biggest number in the section.**

**We do not know what it costs to acquire a partner buyer. PROOF: NONE ON FILE.**

The draft used $105.16, derived as $33 per booked call divided by a 31.38% close rate, both taken from `docs/workflows/ads-waterfall-projections-2026-08-26.md`. That file models the **survey / funding-client** funnel: $33 per booked call from a thin Aug 24 sample, and a 31.38% modelled close rate on funding buyers at $3,000. Its own header says: "This is a model. Assumptions are named. They are not live rates. That ad group still had 0 paid closes when the mix was built."

Spending a funding-client cost-per-buyer on a $10,000 partner seat is a category swap, not a measurement. **So the $105.16, the 95.09x, the 5.60x, and every multiple built on them are deleted.** There is no "2x bar" verdict in this section, because a multiple needs a spend figure and we do not have one for this product.

What follows is delivery cost only.

**What one sale costs us to deliver — the part we can name**

```
build guarantee, if we miss                 $281.25   ASSUMED: $1,250/mo marketing cost of goods
                                                      x 1.5 months x a 15% miss rate. All three
                                                      are assumptions. Nothing has ever been built
                                                      for a partner, so no miss rate can exist yet.
3-day refund reserve                        $500.00   The 3-day window is real and proven
                                                      (283_partner_license_template.sql:163-165).
                                                      The 5% rate is ASSUMED — zero seats have sold,
                                                      so no refund rate has ever been observed.
                                        -----------
NAMEABLE delivery cost per sale             $781.25
```

**What we cannot put a number on, and are not going to invent:**

- Cost to acquire the buyer. **NONE ON FILE.**
- Cost to deliver 25 Decline Autopsies. **NONE ON FILE** — and since the autopsy runs no credit pull, the draft's $800 line was costing something that does not happen.
- The lock make-good. Not in the signed license, therefore not promised, therefore not reserved. If Chris puts it in the license (new migration), it has two legs, not one: the $10,000 refund **and** the full commission on that client. At a 1% assumed claim rate that is roughly $150 a sale using a $5,000 illustrative commission — not the $100 the draft carried, which priced the commission leg at zero.

**Cash per sale after nameable delivery cost, by lender band.** Bands from `W1-money-model.md §5`. These are before any acquisition cost, which is unknown.

```
band            we receive    minus nameable delivery
paid in full      $10,000            $9,218.75
50%                $5,000            $4,218.75
42%                $4,200            $3,418.75
30%                $3,000            $2,218.75
```

**A seat sold BY an existing partner** — the $2,000 recruit bonus on top:

```
band            we receive    minus delivery and bonus
paid in full      $10,000            $7,218.75
50%                $5,000            $2,218.75
42%                $4,200            $1,418.75
30%                $3,000              $218.75
```

**Every band is positive, and the draft's recommendation is withdrawn.** The draft recommended paying the $2,000 recruit bonus only on a seat that paid in full, on the grounds that the 30% band turned into a $786 loss. That loss only appeared because the draft loaded in the $800 autopsy cost that does not exist. The shipped code says the opposite in its own comment: at the worst band FundHub receives $3,000 and pays $2,000, netting $1,000, which is "positive at every band on the D5 table and negative at none" (`src/partners/recruit.mjs`), proved band by band in `recruit.test.mjs`, and specified as a flat $2,000 at `W1-money-model.md:438ff`. **Recommending a change to a live, tested, owner-set term on the strength of an invented cost is exactly the mistake this document exists to catch. Withdrawn.**

**If three people claim at once**

```
3 build-guarantee misses     $5,625   labour, not cash out the door. ASSUMED COGS x 3.
3 three-day refunds         $30,000   cash out the door.
                          ----------
combined                    $35,625
sales needed to cover, at $9,218.75 net per full-price sale:   4
cash-out leg alone ($30,000), same basis:                      4
```

The draft answered this block with "1 sale," which was the answer to the cheapest of the rows it listed, not to the question it asked. Four is the answer to the question. Neither figure includes acquisition cost, because there isn't one on file.

**Why the $297 trial is out** — see section 2. The draft's table (0.65x / 1.15x / 2.15x, break-even at 40%) is deleted in full: it rested on a $2,000 acquisition cost with no source. For the record, the draft's own threshold was also wrong on its own terms — at $2,000 and a $297 trial price, break-even is 17.03% and the 2x bar is 37.03%, not 40%. Both numbers are moot now. **Nothing on file supports any threshold, so no threshold is printed.**

---

## 9. What we could not prove — claims removed, and three the draft removed by mistake

**Removed and staying removed:**

1. **"$10,000 of bonuses."** → Half of it was Funding Mastery. `docs/specs/W7:7` — "specification only. Nothing built." **Removed. Bonus stack restated at $1,566 plus one unresolved line.**

2. **"We can't backdoor you — it's in the agreement."** → There is no non-circumvention clause. I searched everything. **PROOF: NONE ON FILE — claim removed, and the clause is now a build item that gates the launch.**

3. **Anything about earnings, timelines, close rates, or "typical results."** → Zero paid partner closes on record. `src/trials/constants.mjs` forbids it in code. **PROOF: NONE ON FILE — all removed.**

4. **"Live in 7 days" — and "live in 14 days."** → Never measured; no such figure exists in this repo. **Removed as a claim. The make-good stays; the number is an owner decision Chris has not made yet.**

5. **"Unlimited Decline Autopsy."** → Removed, replaced with a cap of 25. Note the reason changed: not because each one costs $32, but because what it costs is unknown.

6. **The lock make-good — 100% of the commission plus a full $10,000 refund.** → Not in the signed license, and contradicted by two clauses in it. **PROOF: NONE ON FILE — removed from the offer, moved to the build list.**

7. **"A monthly statement, so you can see your own book."** → Read access to your own record and balance is real (`api/read/partners.mjs`). The statement and the client-list view do not exist. **PROOF: NONE ON FILE — half the claim removed, half kept, both said plainly.**

8. **The $33 cost per booked call and the $105 derived from it, as facts about a partner seat.** → One thin Aug 24 sample from a different funnel with zero paid closes behind it. **Removed from this offer entirely, not labelled and kept.**

**Removed by the draft, and now restored because the proof exists:**

9. **"20% tier one and 5% tier two, already live."** → **TRUE.** `db/migrations/260_...` and `261_...`, both owner-set 2026-08-24; `W1-money-model.md:63-65` D9 says "Already applied." The draft looked at a code comment (`economics.mjs:225-226`) and concluded the numbers were only an example. The migrations are the source. **Restored.**

10. **"You get paid 50% by the system."** → **TRUE.** The accrual writer shipped (`src/partners/revenue.mjs` → `money-chain.mjs:46, 469`), and the reversal is wired (`:1365`). The draft quoted `W1-money-model.md:71`, a finding that has since been fixed. **Restored.**

11. **"$2,000 for seating another partner."** → **TRUE and built.** `src/partners/recruit.mjs`, `db/migrations/281_partner_recruited_by.sql`, registered in `src/register-all.mjs`. The draft ruled it out because it is not in `offers.mjs` — but `offers.mjs` prices what we sell, and this is money we pay out. Absence there is not evidence of absence. **Restored.**

---

## BEFORE THIS SELLS

1. **Write the non-circumvention clause into the license** as a NEW migration (285). Never edit 283. This gates the launch.
2. **Decide the lock make-good.** As written in the draft it pays from FundHub's half and refunds the joining fee after the 3-day window — two things the signed license forbids. Either it goes into the license as a new migration (disclosed, and the 3-day clause moves with it), or it stays out of the offer. It is out until then.
3. **Set the build-guarantee window.** Chris picks the number of days, it gets logged as owner-set. There is no measurement to derive it from and nobody should invent one.
4. **Name the person who signs off on the build guarantee.** `docs/specs/W4-live-trial.md:208` requires one; `:756` records that nobody holds it. One decision.
5. **Pick one on Winner's Board** — one-time in the code, subscription in the ads doc. The bonus total cannot be printed until somebody does.

Not on this list any more: the accrual writer. It shipped.

---

## Review card

**What this decided:** The partner offer is a $10,000 one-time seat sold on the Owner Lock — a database rule we can show on screen — with the 50/50 split, the no-clawback and no-hold-back terms, and the ten-clients-a-month floor exactly as they already exist in the signed license, guaranteed by one build guarantee that pays in free work instead of your money back. The lock make-good is not promised until it is in the signed document.

**Three things to check:** The price is **$10,000, paid once, no monthly** — yes or no? · How many days for the build guarantee, and who signs off on it? · Do we put the lock make-good into the license, or drop it?

**What I wasn't sure about:** Four things. (1) What it costs to acquire a partner buyer — **no figure exists**, and the $105 the draft used was borrowed from the funding-client funnel; every multiple in the draft's section 8 died with it. (2) What a Decline Autopsy costs us to deliver — **no figure exists**; the draft's $32 was our sell price for a different product, and the autopsy runs no credit pull at all (`W3` §8.2). (3) The cost of goods on Done-For-You Marketing, the 15% miss rate and the 5% refund rate — all three are assumptions, all three are labelled in section 8, and none has ever been observed. (4) Winner's Board is one-time in the code and a subscription in the ads doc; those two disagree and somebody has to pick.

**Say one of:** approve · tweak: \<what to change\> · redo
