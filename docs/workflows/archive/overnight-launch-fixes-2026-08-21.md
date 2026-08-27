# Overnight launch fixes — 2026-08-21

**Mode:** Fixer + Builder · no deploy · one PR · Chris merges in the morning  
**Branch:** `overnight/launch-fixes-2026-08-21`  
**Allowlist / live dials:** none. AI setter prove is stub/dry-run only.

## W1 journey divergences

`npm run journeys` on 2026-08-21 was **byte-identical**. No `*-actual.md` and no `README.md` moved.

Every journey still diverges from its `-intended.md` (those files were a 2026-08-02 copy of the code, never revised). Actual now counts **188** routes. Intended still describes ~88.

| Journey | Intended reach | Actual reach | What is new on actual that intended never named |
|---|---|---|---|
| client | 15 of ~88 | 30 of 188 | chat, climate, content, public; reading 1→3; everything-else 3→6 |
| role-owner | 88 of 88 (blocked 0) | 184 of 188 (blocked 2) | brand, chat, climate, company-brain, content, demo, partner-brand, partner-marketing, proxy, public, repair, social, staff; owner is no longer "reaches everything" |
| role-sales-manager | 71 of ~88 | 144 of 188 | chat, climate, company-brain, content, partner-marketing, public, repair, social, staff |
| role-closer | 59 of ~88 | 127 of 188 | same new groups as sales-manager minus staff; intended still says Campaigns + Creative + the contracts route are reachable |
| role-funding-advisor | 60 of ~88 | 132 of 188 | same new groups as closer, plus proxy |
| role-inquiry-remover | 59 of ~88 | 125 of 188 | same new groups as closer; repair 0→3 (`POST /api/repair/generate` is one of them; intended never names generate) |
| affiliate | 11 of ~88 | 24 of 188 | climate, public, reading data |
| white-label | 22 of ~88 | 53 of 188 | brand, climate, partner-marketing, public, social; Campaigns 6→8, Creative 4→7 |
| gate-relay | independently authored | independently authored | diagrams are not a copy of each other; this pair was never generated from the same extract |

Recorded gaps that this regen did not close (already in `CHANGELOG.md`, intended files not edited): closer contracts screen is owner/admin only while intended still lists that route; sales-manager / closer / funding-advisor intended pages still claim Campaigns and Creative Factory.

## Tasks

| ID | Owner | Status | Files (only these) |
|---|---|---|---|
| W1 journeys | agent | done | `docs/journeys/*-actual.md` unchanged (byte-identical); `docs/journeys/CHANGELOG.md` |
| W2 AI setter | agent | done | `src/workflows/ai-set-01-josh-setter.mjs` (+ test), `src/workflows/index.mjs`, reuse `src/messaging/providers/bland-voice.mjs` / vendor prompt — no live call |
| W3 BLK-008 | agent | done | `src/handlers/money-chain.mjs` + existing money tests only if wiring gap |
| W4 timestamp + calendar | agent | done | confirm SMS time format; `clickfunnels-fragments/05-thank-you.html`; booking ICS/organizer |
| W5 copy + launch doc | agent | done | finish `docs/workflows/live-journey-2026-08-20-evidence/all-template-copy.md`; write `docs/LAUNCH-READINESS.md` |

Do not touch anything not on this list.

## W3 BLK-008 deposit → sale_payments → commission

**Status:** FIXED wiring gap (already in repo) · no handler edit · no migration · no deploy · no commit

Live audit (2026-08-21) saw `INSERT` omit `product_id` and Postgres reject it (`23502`). That was old deployed code. Repo already copies the sale’s product onto the payment:

- `src/handlers/money-chain.mjs:418-426` — `INSERT` includes `product_id`
- `src/handlers/money-chain.mjs:624-626` — `deposit.paid` passes `productId: sale.product_id`
- `db/migrations/247_commission_money_chain_identity.sql:42-53` — live `NOT NULL` (011 had no such column; do not invent another migration)

Commission after the payment is already wired, not a Chris decision:

- `writeFrontEndCommissions` uses `eventRef: paymentRow.id` (`money-chain.mjs:506`)
- Ledger insert includes `sale_payment_id` + idempotency key (`src/commissions/sql.mjs:104-116`)

**Tests**
- `src/handlers/money-chain.test.mjs` — fails if the `INSERT` drops `product_id` (10/10)
- `src/handlers/money-chain.pg.test.mjs` — deposit.paid must write `sale_payments` when a sale exists, with matching `product_id`

Live site will keep dropping payments until this branch (or #117) is deployed.

## W4 timestamp + calendar

**Status:** done · no deploy · no commit · `comms.mjs` unchanged (no named advisor on the booking event)

**Files**
- `src/workflows/messaging.mjs` — `formatAppointmentStart` + format ISO `appointment.start_time` when merge context is built (client tz → booking tz → America/Phoenix)
- `src/workflows/s-04b-booking-reminders.mjs` — pass booking `timezone`/`tzid` onto appointment context
- `src/workflows/messaging.test.mjs` — ISO-Z → human string
- `src/workflows/s-04b-booking-reminders.test.mjs` — confirm SMS body is not raw ISO
- `clickfunnels-fragments/05-thank-you.html` — Fundhub organizer, reschedule URL, prep copy

**SMS print (SMS-S04-01-CONFIRM `{{appointment.start_time}}`)**
- Live ISO `2026-08-23T02:49:58.390Z` in America/Phoenix → `Sat, Aug 22, 2026, 7:49 PM MST`

**ICS**
- Organizer: `ORGANIZER;CN=Fundhub:mailto:noreply@fundhub.ai`
- ATTENDEE only if `advisorEmail` is already on the booking blob (none invented)
- Description / reschedule: `https://apply.fundhub.ai/funding-book-call`

## W5 copy + launch doc

**Status:** done · no app code · no deploy · no commit

- Copy dump complete: `docs/workflows/live-journey-2026-08-20-evidence/all-template-copy.md` — **237** templates (182 email, 55 sms). Re-checked against production 2026-08-21: 0 missing. **165** still `compliance_passed=false`.
- Launch page: `docs/LAUNCH-READINESS.md`

**Top 3 blockers to real money:** (1) deposits do not save (BLK-008 / `product_id` / 23502) (2) card charge + refund never proven (3) credit is sandbox only.
