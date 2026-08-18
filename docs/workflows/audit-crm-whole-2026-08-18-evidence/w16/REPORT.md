# W16 — payment → unlock (six offers)

**COMPLIANCE REVIEW REQUIRED** — this walk touches dispute-letter sign, credit-repair copy, fee timing, payment rails, consent, and credit-pull type. Findings only. No card was charged.

**MISSING ground truth.** `docs/journeys/client-intended.md` and `role-closer-intended.md` are route lists. They do not say that a payment unlocks a tile. Neither does `*-actual.md`. Scored against Chris’s W16 claim, same pattern as W13.

I simulated the payment events on the TEST file only (`8556bedc-46e1-4d85-b0cd-a24adfee1521`). I did not charge a card. I did not change payment settings. I did not send Inngest.

## Answer first

All six tiles stay locked. Money can land. Nothing opens.

1. **$32 soft pull** — dies at unlock. **Listened but the unlock has nothing to show.** Live pay-link title also never fires `diagnostic.paid`.
2. **$3,000 funding done-for-you** — dies at unlock. **Listened but the unlock has nothing to show.** Live title never fires `deposit.paid`.
3. **$1,000 credit repair done-for-you** — dies at unlock. **Listened but the unlock has nothing to show.** No client letter screen.
4. **$200 repair test run** — dies at unlock. **Listened but the unlock has nothing to show.** Same lock as #3. No one-round screen.
5. **$1,000+ deliverables pack** — dies at unlock. **Listened but the unlock has nothing to show.** Download buttons do nothing. No mini course.
6. **$5,000 Funding Mastery** — dies at unlock. **Listened but the unlock has nothing to show.** This tile has no unlock code at all. No course player in the app.

A real close on this file dies even earlier: **0 payment links.** The pay button never made a row. Board already saw `commas_not_configured`. I skipped that door and fired the money events myself.

## What I did

Local `registerAll` + `emit` on the TEST file. Offer names taken from the portal / `src/config/offers.mjs`. Product codes taken from the live `products` table. No invented codes.

Before: 0 entitlements held. After: still 0. Catalog is 5 codes. Portal paints 6 tiles.

The map that turns a product into a tile (`product_entitlements`) has **0 rows**. That is why money cannot open a tile.

## The six offers

### 1. $32 UnderwriteIQ soft-pull

- **Close:** Closer can send a $32 link (`send_soft_pull`). This file has no pay-link row. Soft-pull contract `16b29639-…` is signed. That sign wrote `contract.signed`. **Nothing listens.** Sign also did not write a `soft_pull` consent row.
- **Event:** Live title “UnderwriteIQ soft-pull assessment” does not match “business financial assessment.” Commas would emit `payment.received` only. I fired that (`41da5328-…`) and also forced `diagnostic.paid` (`ac3352a1-…`) to test unlock. Three handlers ran on each. Sale `39361bbe-…` (`diagnostic`) was written. `crs_paid` stamped true. Board card moved to Diagnostic Paid. No entitlement row. No bureau pull (no `soft_pull` consent; `soft_pull_requests` still empty).
- **Unlock:** Tile needs `credit-analysis-report`. Still locked.
- **Delivery surface:** Partial. Portal can show a pre-qual dollar amount. It does **not** show score, inquiries, or tradelines. Those live on the staff deck.
- **Intended vs actual:** Not named. MISSING.

### 2. $3,000 Funding, done-for-you

- **Close:** `send_pay_link` emails a pay link. The toast says the agreement went too. **It does not send a contract.** No FUNDING-AGREEMENT on this file. No pay-link row.
- **Event:** Live title unmatched → `payment.received` only (`38bd8c82-…`). I also forced `deposit.paid` (`5eba4879-…`). Four handlers ran. Sale `c88d9172-…` (`card-stacking-dfy`). `deposit_paid` stamped true. Inquiry gate wrote `inquiry.gate.clear` (`d638be3c-…`) because this file has no inquiries to work. Still 0 entitlements.
- **Unlock:** Tile needs `funding-snapshot`. Still locked.
- **Delivery surface:** Partial. If it unlocked, the client would see a stepper that says the file is open. No application list. No results. The portal never calls the funding-rounds read.
- **Intended vs actual:** Not named. MISSING.

### 3. $1,000 Credit repair, done-for-you

- **Close:** Same pay-link action. CREDIT-REPAIR-AGREEMENT is in the offer list. None on this file.
- **Event:** Live title unmatched (`03eccc8d-…`). Forced `sale.closed` (`257fcd7c-…`) wrote a **consulting-package** sale (`ee7b9598-…`), not `repair-bundle`. Listeners ran. No entitlement.
- **Unlock:** Tile needs `metro2-letter-pack`. Still locked.
- **Delivery surface:** No. Client sees a sign box for dispute letters. After unlock, “View status” says progress will show later. No letter list, no “what we sent,” no bureau replies, no round.
- **Intended vs actual:** Not named. MISSING.

### 4. $200 Repair test run

- **Close:** Same. REPAIR-TRIAL-AGREEMENT is in the offer list. None on this file. There is **no $200 product** in `products`.
- **Event:** Unmatched `payment.received` (`d1d09471-…`) + forced `sale.closed` (`b6b606a6-…`). Same consulting-package sale as #3.
- **Unlock:** Same `metro2-letter-pack` key as #3. Unlocking one would unlock both. Still locked.
- **Delivery surface:** No. No one-round status screen.
- **Intended vs actual:** Not named. MISSING.

### 5. $1,000+ UnderwriteIQ Deliverables Package

- **Close:** No contract template on this offer. No product row. No pay-link row.
- **Event:** `payment.received` only (`dcb10b34-…`). Handlers ran. No sale (no product match). No entitlement.
- **Unlock:** Tile needs only `credit-optimization-roadmap` (one of six pieces). Still locked.
- **Delivery surface:** Partial placeholders. “What You Own” can list five PDF names. Download buttons have no click action. Mini course is not in that list. There is no player.
- **Intended vs actual:** Not named. MISSING.

### 6. $5,000 Funding Mastery course

- **Close:** No contract template. No product row. No pay-link row.
- **Event:** `payment.received` only (`44eb6a4b-…`). Handlers ran. No sale. No entitlement.
- **Unlock:** Portal map is `null`. This tile **cannot** turn included. It stays locked even if money worked.
- **Delivery surface:** No. `public/education/` is a sales page that talks about 10 modules. There is no clickable, playable course in this repo.
- **Intended vs actual:** Not named. MISSING.

## Close path (all six)

Closer marks an outcome (`log_disposition`) — that only writes a note. It does not make a contract or a pay link.

Contract send is a **separate** button. Pay link is a **separate** button. `contract.signed` and `contract.sent` have **zero** bus listeners.

Live names the closer puts on checkout do not match the four old Commas names (`business financial assessment`, `consulting services deposit`, `consulting services package`, `consulting success fee`). So the extra events (`diagnostic.paid`, `deposit.paid`, `sale.closed`) **never fire** from a real closer link.

## Evidence paths

- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w16/REPORT.md`
- `w16/chains.json`
- `w16/catalog.json` — products, aliases, empty `product_entitlements`, offer name match
- `w16/before.json` / `w16/after.json` / `w16/delta.json`
- `w16/emits.json` / `w16/events-fired.json` — event ids
- `w16/listeners.json`
- `w16/delivery-surfaces.json`
- `w16/soft-pull-rows.json` — 0 bureau pulls
- `w16/env-flags.json` — env **names** only
- Prior pointers (not copied as proof): W-PAY, W10, portal-spot 0/6

Rows left on the TEST file (do not clean up): events above; transactions `c6c29da0-…` `$32`, `25c220a1-…` `$3000`, `88e3a062-…` `$1000`, `22f5dda2-…` `$200`, `5dbe9910-…` `$1000`, `f499f694-…` `$5000`; sales `39361bbe-…`, `c88d9172-…`, `ee7b9598-…`; card `5410b98b-…`; `inquiry.gate.clear` `d638be3c-…`.

## Left undone

- Live portal screenshot after the sim. Browser tab would not open. Unlock is still proven by the database: held 0 before and after. Same 0/6 the portal paints from that list.
- Did not press Sign on dispute. Did not send a magic link. Did not mint a live checkout.

W16 stop. Findings only. Chris names what to fix.
