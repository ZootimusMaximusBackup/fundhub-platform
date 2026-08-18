# G4 findings — apply, affiliate link, content admin, public pages

Date: 2026-08-18  
Live apply site: https://apply.fundhub.ai  
Live CRM: https://fundhub.ai  
Walked as a person in a real browser. No app code was changed. No deploy.

**Ground truth:** There is no written intended funnel journey. Same for G4b, G4c, and G4d. Scored against what this board asked, not against a made-up spec.

ClickFunnels is the tool that hosts the apply pages. It did **not** bounce this walk as a bot on `/watch`, `/apply`, `/funding-book-call`, or `/thank-you`.

---

## FAIL

### G4c — owner cannot stay on Content Admin

- **Journey:** G4c Content Admin welcome video
- **Step:** Open https://fundhub.ai/app/content-admin.html as owner
- **Expected (board):** Walk every control that claims to set a welcome video or portal tiles
- **Observed:** The file itself answers HTTP 200. About 0.1 seconds later the signed-in owner is sent to Pipeline. There is no “Content” row in the left nav. So the upload box, save buttons, and tile switches cannot be used.
- **Also:** The live content list answers HTTP 200 and has **0 videos**. Tile map is empty. Five tile names exist in the list. There is no video file to attach. I did not invent one.
- **Evidence:** `g4c-content-admin-bounce.png` · `g4c-nav-marketing.png` · `g4c-nav-admin.png` · `g4c-follow.json` · `g4c-content-admin.png`

### G4c — test portal still has no welcome video

- **Journey:** G4c
- **Step:** Open the test client portal (`?id=8556bedc-46e1-4d85-b0cd-a24adfee1521`)
- **Expected (board):** Say whether the hero still says the welcome video is not available
- **Observed:** Hero still says **“Welcome video is not available.”** No play button. No video on the page.
- **Evidence:** `g4c-test-portal.png` · `walk.json` id `g4c-test-portal`

---

## PASS (with proof)

### G4a `/watch` — the video plays

- HTTP **200**. A person sees the funding video, captions, and a blue **TAP FOR SOUND** button. The video file is `https://fundhub.ai/funnel/vsl.mp4` (HTTP 200, video/mp4). After a few seconds the player had moved to about 10 seconds and was not paused.
- **Evidence:** `g4a-watch.png` · `g4a-watch-after-play.png` · `g4c-follow.json` `vslMeta` · `http-status.json`

### G4a `/apply` — step 1 can be filled

- HTTP **200**. Person sees “APPLICATION · STEP 1 OF 2”, name, email, phone. No Social Security number and no date of birth on this step. Filled fake e2e values only. Did **not** press Next (that would send a real lead).
- **Evidence:** `g4a-apply.png` · `g4a-apply-step1-filled.png`

### G4a `/funding-book-call` — page opens

- HTTP **200**. Person sees “You Are Qualified. Book Your Funding Call Below” and a live calendar with open times. Did **not** book a slot (that would email staff).
- **Evidence:** `g4a-funding-book-call.png`

### G4a `/thank-you` — reachable without paying

- HTTP **200** if you just type the URL. No payment was made. The page still says “Your Call Is Booked.”
- **Evidence:** `g4a-thank-you.png`

### G4b — affiliate link lands on the right apply page

- `https://fundhub.ai/start?ref=AFF-000001` is HTTP **200**, then the page itself sends you to  
  `https://apply.fundhub.ai/apply?a1=AFF-000001&ref=AFF-000001`  
  That is the Fundhub apply form (same look as `/apply`), not a wrong ClickFunnels shop theme.
- **Evidence:** `g4b-start-ref.png` · `walk.json` id `g4b-affiliate-ref`

### G4d — public pages answer

| URL | Status | What a person sees | Broken pictures | Form sent |
|---|---|---|---|---|
| `/education/` | 200 | Education home, “Credit and capital, taught properly.” | none | no |
| `/education/enroll/` | 200 | Enroll form (program, name, email, phone) | none | no |
| `/education/terms/` | 200 | Education terms | none | no |
| `/education/privacy/` | 200 | Education privacy | none | no |
| `/education/refund/` | 200 | Education refund rules | none | no |
| `/terms/` | 200 | Fundhub terms | none | no |
| `/privacy/` | 200 | Fundhub privacy | none | no |
| `/affiliates/` | 200 | Partner page + apply-to-partner form | none | no |

Shots: `g4d-education.png` · `g4d-education-enroll.png` · `g4d-education-terms.png` · `g4d-education-privacy.png` · `g4d-education-refund.png` · `g4d-terms.png` · `g4d-privacy.png` · `g4d-affiliates.png`

---

## Noted, not a new fail

### `/book` is 404

Owner already said this is **WONTFIX**. Canonical book URL is `/funding-book-call`. The 404 page is a ClickFunnels “Logoipsum / Page not found” screen, not Fundhub.

- **Evidence:** `g4a-book-404.png` · HTTP 404 in `http-status.json`

### Thank-you copy

The thank-you page says the call is booked even when nobody booked and nobody paid. No intended journey says what that page should say.

---

## UNVERIFIED

- **Booking a real sales call.** The book page shows real open times. I did not pick one.
- **Apply step 2.** I filled step 1 and stopped. I did not press Next.
- **Long public pages below the first screen.** Education and Affiliates fade blocks in as you scroll. I have first-screen + full-page shots and the page text. I did not scroll every block like a person.

---

## What I did not do

- Did not book Chris’s calendar
- Did not send a real person’s name, Social Security number, or address
- Did not submit the education or affiliate forms
- Did not open client `9af65808-a619-4e65-ae91-239766a006b7`
- Did not invent a video file
- Did not fix anything

---

## File list

All under `docs/workflows/audit-gaps-2026-08-18-evidence/g4/`

- `REPORT.md` (this file)
- `walk.json` · `pages.json` · `http-status.json` · `http-curl.json` · `findings.json` · `g4c-follow.json`
- screenshots named `g4a-*`, `g4b-*`, `g4c-*`, `g4d-*`
