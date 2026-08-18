# F-FUNNEL — Finish apply extras + book a live slot

Date: 2026-08-18  
Live: https://apply.fundhub.ai  
Read only. No app change. No deploy. No pay. One slot.

**Ground truth:** No written intended funnel / book-call journey. **MISSING.** Scored against Chris’s claim on the board.

Chris’s claim: finish every extra apply card, then book a live slot on `/funding-book-call`. He knows it may land on his calendar.

**Score: PASS.** Extras finished. Confirm did not error. The thank-you page says the call is booked. A `booking.created` row and a “Strategy session booked” task landed.

---

## PASS (with proof)

### `/watch` opens

- HTTP **200**.
- Copy: “Get $50,000 to $1,000,000 in Funding in 14 Days or Less.” TAP FOR SOUND.
- **Evidence:** `01-watch.png` · `walk.json`

### Step 1 fills with fake e2e only

- HTTP **200**. Header: **APPLICATION · STEP 1 OF 2**.
- Fields: First Name, Last Name, Email, Phone. No Social Security number.
- Filled **E2e / Fire**, `e2e+aff-fire-*@fundhub.ai`, phone `201-555-0123` (form example, not a real person).
- Next moved to the amount card.
- **Evidence:** `02-apply-step1.png` · `03-apply-step1-filled.png` · `04-after-contact-next.png`

### Every extra card finished

No Social Security number on any card. Did not type one.

| # | Card | Pick | Shot |
|---|---|---|---|
| 1 | Set Your Target Amount | Less than $50k | `05-extra-01.png` |
| 2 | Planned Use | Not sure yet | `05-extra-02.png` |
| 3 | What Would This Money Change For You Right Now? | Peace of mind (stop stressing about cash) | `05-extra-03.png` |
| 4 | Your Current Score | Not sure | `05-extra-04.png` |
| 5 | Do You Have a Business? | No, personal funding only | `05-extra-05.png` |
| 6 | Annual Personal Income | Less than $50k | `05-extra-06.png` |
| 7 | Can You Verify Income? | Not right now | `05-extra-07.png` |
| 8 | Available Capital | Less than $1k | `05-extra-08.png` |

Last Next landed on `/funding-book-call`. Header still said **STEP 1 OF 2** on every extra card.

- **Evidence:** `05-extra-01.png` … `05-extra-08.png` · `06-landed-book.png` · `walk.json`

### A ClickFunnels client row was written

- Client `edca0767-88e9-4cf4-8837-47382049503a`
- Channel `clickfunnels`. Email prefix `e2e+aff-fire-`. Domain `fundhub.ai`.
- Survey keys present: `cf_svy_funding_target_amount`, `cf_svy_available_capital`.
- `entry.captured` and `survey.submitted` rows landed (source `clickfunnels`). Those event rows have **no** `client_id`.
- Left the row.
- **Evidence:** `db-after-book.json` · `db-booking-row.json`

### Confirm did not error. The slot booked.

- Host: **Chris Stanbridge**. 30 minutes. Google Meet. Phoenix.
- Picked **8:00 PM – 8:30 PM (MST)** Tuesday Aug 18, 2026. One slot only.
- Confirm opened the name / email / phone form. No error on screen.
- Filled **E2e Fire** and the same fake e2e email / `201-555-0123`.
- Pressed **Book Appointment** once.
- Landed on `/thank-you`. Copy: **“You're All Set. Your Call Is Booked.”** Calendar line: Tuesday, August 18, 2026 at 8:00 PM – 8:30 PM (America/Phoenix).
- HTTP: `GET /watch` 200 · `GET /apply` 200 · `POST /user_pages/api/v1/appointments/event_types/14234/calendar_config` 200 · `POST /funding-book-call` 200 · final `https://apply.fundhub.ai/thank-you`.
- **Evidence:** `07-funding-book-call.png` · `08-slot-opened.png` · `09-confirm-ready.png` · `10-after-confirm.png` · `14-form-filled.png` · `15-after-book-appointment.png` · `book-complete.json`

### `booking.created` and a task landed (~80s later)

- No `bookings` table (same as U10).
- `booking.created` ClickFunnels count **26 → 27**. New row `f370a046-46a4-4d8a-a58e-d0d421a73d98` at 21:46:13Z. Source `clickfunnels`. Mentions the fire e2e email. Has `startTime`, `endTime`, `meetingUrl`, `bookingUid`. Event `client_id` is empty.
- Task `d5300a31-7620-4abf-8ca7-c9295d1ebbaf` title **Strategy session booked**. Due `2026-08-19T03:00:00Z` (= 8:00 PM Phoenix). Has a client. Workflow label `calcom`.
- Strategy-session tasks **15 → 16**.
- ClickFunnels webhook captures after 21:40Z: **22**. Last at 21:46:13Z.
- **Evidence:** `db-before.json` · `db-after-wait.json` · `db-booking-row.json`

---

## MISSING

No `docs/journeys/*-intended.md` names this apply or book path.

---

## Owner WONTFIX (not retested)

`/book` 404. Canonical book is `/funding-book-call`.

---

## What I did not do

- Did not type a Social Security number
- Did not pay
- Did not use a real person’s name or phone
- Did not book a second slot
- Did not open client `9af65808-…`

---

## File list

All under `docs/workflows/audit-untested-fire-2026-08-18-evidence/f-funnel/`

- `REPORT.md` (this file)
- `walk.json` · `book-complete.json` · `email.txt`
- `db-before.json` · `db-after-apply.json` · `db-after-book.json` · `db-after-wait.json` · `db-booking-row.json`
- shots `01-watch.png` through `15-after-book-appointment.png`
