# K5 — Company Brain, Affiliate money, education play, Repair Send

Date: 2026-08-18  
Owner `chris@`. Never opened `9af65808-…`. Did not pay. Did not mail a bureau letter.

Ground truth: `affiliate-intended.md` only says who can open routes. It does **not** name money paint, Company Brain ask, a course player, or Repair Send. **MISSING.** Scored against Chris’s K5 ask.

**COMPLIANCE REVIEW REQUIRED** — Repair Send.

---

## Score

| Ask | Result |
|---|---|
| Company Brain answers a question | **FAIL** — Ask **502**. Screen: “Something went wrong on our side.” |
| Company Brain upload | **FAIL** — **502** `embed_failed` |
| Affiliate money | **FAIL** — page opens. Paid **—**. Clicks / referred / converted **—**. Owed **$0**. Copy says numbers are “not connected to this page yet.” |
| Play a course lesson | **FAIL** — `/education/` is a sales page. No video player. Enroll is a $5,000 form. Did not pay. |
| Repair Send | **FAIL** — Send becomes **VIEW is not defined**. Same as U6. |

---

## FAIL — Company Brain Ask

- Journey: Company Brain ask (**MISSING**)
- Step: type a question, get an answer from files
- Expected: an answer, or a clear “no files”
- Observed: page stayed. `#q` present. Ask once. `POST /api/read/company-brain` **502**. Vendor says the auth token is not from a valid issuer. Upload **502** `embed_failed`. No chat history.
- Evidence: `01-brain.png` `02-brain-ask.png` `walk.json`

---

## FAIL — Affiliate money

- Journey: affiliate money (**MISSING** in intended; intended only names who can open)
- Step: balances show from real payouts
- Expected: paid / owed / referred numbers, or an honest empty
- Observed: `/app/affiliate.html` stayed. `GET /api/read/affiliates` **200**. Paid dash. “not connected to this page yet.”
- Evidence: `04-affiliate.png`

---

## FAIL — Education play

- Journey: course player (**MISSING**)
- Step: open a lesson and play
- Expected: a student player
- Observed: `/education/` **200**, no `<video>`. Enroll page asks for a program and contact. Tuition $5,000. Did not submit. Did not pay. No lesson file exists under `public/education/` except marketing pages.
- Evidence: `05-education.png` `06-enroll.png`

---

## FAIL — Repair Send

- Journey: inquiry Send (**MISSING**)
- Step: Send on Specialist leaves the building
- Expected: a call or a letter starts, or a clear refuse
- Observed: `/app/inquiry-remover.html` stayed. No case row selected (`has_row` false). Send still present. Click → button **VIEW is not defined**. No live file.
- Evidence: `07-repair-send.png`

---

## Left undone

- Did not enroll or pay.
- Did not send a second Repair click.
- Affiliate was opened as owner, not as an affiliate login.
