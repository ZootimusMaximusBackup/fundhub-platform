# WAVE D rollup + U10 — Book a live call slot

Date: 2026-08-18  
Live book page: https://apply.fundhub.ai/funding-book-call  
Read only. No app change. No deploy. Did not book.

## WAVE D rollup

| id | Score | One line |
|---|---|---|
| U9 | **PARTIAL** | Past apply step 1 proven. Extra fields show. No Social Security number. Did not finish every extra question. |
| U10 | **UNVERIFIED** | Slots show on Chris’s calendar. Did not book. That would put a meeting on a real person’s calendar. |

No intended funnel journey. **MISSING** for both.

---

# U10 — Book a live call slot

**Ground truth:** No written intended funnel / book-call journey. **MISSING.** Scored against Chris’s claim on the board.

Chris’s claim: a person can pick a live slot on `/funding-book-call` and a booking row appears.

**Score: UNVERIFIED.** Slots are real. Host is Chris Stanbridge. Confirm was not pressed.

---

## PASS (with proof)

### The book page opens and shows live times

- HTTP **200**.
- Copy: “You Are Qualified. Book Your Funding Call Below.”
- Meeting: **Funding Strategy Meeting**. Host: **Chris Stanbridge**. 30 minutes. Google Meet.
- Open times today (Aug 18, Phoenix): 3:30 PM through 9:00 PM MST.
- Not Cal.com. No calendar iframe.
- **Evidence:** `u10-funding-book-call.png` · `walk.json`

### Owner Calendar still says nothing is booked

- Signed in as owner on https://fundhub.ai/app/calendar.html.
- Tuesday Aug 18: **“Nothing booked.”** Counts are dashes.
- **Evidence:** `u10-owner-calendar.png` · `calendar.json`

### Counts re-proved (same shape as G5b)

- No `bookings` table.
- `booking.created`: **26** ClickFunnels. **0** Cal.com. Also 4 old test/gauntlet/sim rows.
- Cal.com idempotency keys: **0**.
- `CALCOM_WEBHOOK_SECRET` name: **missing**.
- ClickFunnels webhook captures: **430**.
- “Strategy session booked” tasks: **15**. 1 due today. **0** in the future.
- **Evidence:** `db.json`

---

## UNVERIFIED

### A new booking row from this walk

- Picked 3:30–4:00 PM MST. Confirm / Cancel showed.
- Host is Chris. Booking that slot would land on his calendar and would email him.
- Hard stop: did **not** press Confirm.
- No safe slot that emails only a test inbox.

---

## MISSING

No `docs/journeys/*-intended.md` names this book path.

---

## What I did not do

- Did not press Confirm
- Did not create a booking on Chris’s calendar
- Did not use a real lead’s name or phone
- Did not forge a Cal.com webhook

---

## File list

All under `docs/workflows/audit-untested-2026-08-18-evidence/u10/`

- `REPORT.md` (this file)
- `walk.json` · `db.json` · `calendar.json`
- `u10-funding-book-call.png` · `u10-slot-opened.png` · `u10-owner-calendar.png`
