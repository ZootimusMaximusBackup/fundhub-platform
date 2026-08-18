# U9 — Apply step 2

Date: 2026-08-18  
Live: https://apply.fundhub.ai  
Read only. No app change. No deploy. No book. No pay.

**Ground truth:** There is no written intended funnel journey. **MISSING.** Scored against Chris’s claim on the board.

Chris’s claim: a new person can get past apply step 1 and finish step 2 (the extra fields).

**Score: PARTIAL.** Past step 1 is proven. Extra fields are on screen and do not ask for a Social Security number. Finishing every extra question is **UNVERIFIED**.

---

## PASS (with proof)

### `/watch` opens and the video is there

- HTTP **200**. A person sees the funding video, captions, and **TAP FOR SOUND**.
- **Evidence:** `u9-watch.png` · `walk.json`

### Step 1 can be filled with fake e2e only

- HTTP **200**. Copy says **APPLICATION · STEP 1 OF 2**.
- Fields: First Name, Last Name, Email, Phone. No Social Security number. No date of birth.
- Filled **E2e / AffU9** and `e2e+aff-u9-*@fundhub.ai` only.
- **Evidence:** `u9-apply-step1.png` · `u9-apply-step1-filled.png`

### Next gets a person to the extra fields

- First Next with `(555) 010-0199` stayed on step 1. On-screen error: **Phone Number has an invalid country code**.
- Typed the form’s own example number `201-555-0123` (not a real person). Next then moved the card.
- Extra card: **Set Your Target Amount** / “Enter the capital you want to access.”
- Choices: Less than $50k · $50k–$100k · $100k–$200k · $200k–$400k · $400k+.
- No Social Security number on this card. Did not type one.
- Page header still says **STEP 1 OF 2**.
- **Evidence:** `u9-after-next-scrolled.png` · `u9-after-next-typed.png` · `u9-extra-01.png` · `press-next.json` · `press-next-typed.json`

### A ClickFunnels row was written

- After contact Next, the database has **2** new `clients` rows. Source `clickfunnels`. Left them.
  - `4ab123c6-8da6-4393-948e-d2d811f1828a` (e2e+aff-u9c)
  - `f500ddf3-d508-4bf5-8f4b-3cb24ab840e1` (e2e+aff-u9d)
- `entry.captured` events also landed (e2e flag true). Those event rows have **no** `client_id`.
- `survey.submitted` in the last 2 hours: **0**. Extra questions were not finished.
- **Evidence:** `db.json`

---

## UNVERIFIED

### Finishing all extra fields

- The extra page is multiple-choice. It does not ask for a Social Security number, so a person *could* finish it with no real personal data.
- This walk picked an amount and pressed Next twice. The card did not change. That is not proof a human click fails.
- Did not book. Did not pay.

---

## MISSING

No `docs/journeys/*-intended.md` names this apply path.

---

## What I did not do

- Did not type a Social Security number
- Did not book a call (U10)
- Did not pay
- Did not use a real person’s name or phone
- Did not open client `9af65808-…`

---

## File list

All under `docs/workflows/audit-untested-2026-08-18-evidence/u9/`

- `REPORT.md` (this file)
- `walk.json` · `press-next.json` · `press-next-typed.json` · `finish-extra.json` · `finish-extra-next.json` · `db.json`
- shots named `u9-*`
