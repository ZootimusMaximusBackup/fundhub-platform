# Gap audits — 2026-08-18

Read-only except the FIRE rows named below. Auditor only. No app / test / env / intended-journey edits.

These are the doors the whole-CRM pass (W1–W15) never walked as that person, or never fired.

Live CRM: `https://fundhub.ai`
Live funnel: `https://apply.fundhub.ai`
Prior board (do not rewrite): `docs/workflows/audit-crm-whole-2026-08-18.md`
Evidence: `docs/workflows/audit-gaps-2026-08-18-evidence/`

**Never open / never write** client `9af65808-a619-4e65-ae91-239766a006b7` (live credit file).

**Test client only for writes:** `8556bedc-46e1-4d85-b0cd-a24adfee1521` (`client@fundhub.ai`).

Passwords from gitignored `.env` (`STAFF_E2E_PASSWORD`). Never print.

Logins: `chris@fundhub.ai` (owner), `admin@fundhub.ai`, `setter@fundhub.ai`, `inquiry@fundhub.ai`, `partner@fundhub.ai`, `affiliate@fundhub.ai`.

`COMPLIANCE REVIEW REQUIRED` on G3 (payment, dispute sign, bureau pull, inquiry complete).

## Tasks

| id | owns | status |
| G1 | white-label partner as partner@ | done |
| G2 | admin + setter + inquiry specialist roles | done |
| G3 | payment / dispute sign / inquiry-complete / bureau / mail-SMS / pipeline move | done |
| G4 | apply funnel + affiliate ref + content-admin + public pages | done |
| G5 | background jobs + calendar booking + bank-app launcher | done |

# Discovery — ground truth

If a step has no intended journey, that is **MISSING**. Do not invent. Score against what Chris named on this board.

| id | What to prove | Ground truth | Live check |
|---|---|---|---|
| G1 | Partner can use Brand / Social / Creative / their public page | `docs/journeys/white-label-intended.md` (marketing suite + who can reach) | Sign in `partner@`. Walk Brand Studio, Social, Creative, Galaxy / live `/sites/{id}/{slug}`. Do not turn the owner flip. |
| G2a | Admin can open owner-set screens and is blocked from client file | **MISSING** intended file. `docs/journeys/README.md` puts admin in FINANCE / STAFF / OPS / HIRING / LENDERS. | Sign in `admin@`. Open every visible nav row. Record bounce vs open. Do not write staff / hire / reset. |
| G2b | Setter can do setter work | **MISSING** intended file. README maps setter into STAFF only. | Sign in `setter@`. Same walk. |
| G2c | Inquiry specialist desk as that login | `docs/journeys/role-inquiry-remover-intended.md` (desk items 1–7) | Sign in `inquiry@`. Land on Specialist. Toggle Inquiries / Repair. Open a **test** case only. Do **not** press Send (G3 owns FIRE). |
| G3a | A test payment lands and unlocks the file | **MISSING** journey for “paid → stage / unlock.” `client-intended.md` only lists finance reach. | Owner on test client. Create $32 diagnostic link if the rail answers. **Do not charge a real card.** If create fails, that is the finding. Do not invent a paid event. |
| G3b | Dispute-letter Sign on the test portal | **MISSING** journey step. Card exists. W6 left it unsigned. | Mint or magic-link the **test** client only. Press Sign **once** on that test file. Record consent row + what unlocked. Never the live credit file. |
| G3c | Inquiry complete → next funding round | **MISSING.** Code listen: `c-03-inquiry-removed-resume-or-hold`. Live `inquiry.removed` count was 0. | Do not fake `inquiry.removed`. Prove whether any test case can complete. If the event still never fires, UNVERIFIED / event never fired. |
| G3d | Bureau pull besides the broken soft pull | **MISSING.** `COMPLIANCE REVIEW REQUIRED`. | Test client only. Click TransUnion / Experian / Equifax **or** soft pull if those buttons are live. Record refuse vs return. No gmail file. No live bureau letter mail. |
| G3e | Mail or SMS arrives | **MISSING** “transmits” journey. Keys `FUNDHUB_TEST_INBOX` / `FUNDHUB_TEST_PHONE` are in local `.env` (names only). | One test-client message to those destinations if the screen will send. Inbox/phone proof or honest fail. Do not text a real person. Twilio A2P may still fail — note it. |
| G3f | Pipeline Archive / MOVE | **MISSING.** | Only if a **test** card exists for `8556bedc-…`. If the only cards are real people, do not move them. Mark UNVERIFIED. |
| G4a | Apply funnel as a person | **MISSING** intended funnel journey. Prior speed audit only. Owner: `/book` 404 is WONTFIX. Canonical book is `/funding-book-call`. | `apply.fundhub.ai` watch → apply → book-call → thank-you. Fake e2e email only (`e2e+aff-*@` or `e2e+wl-*@`). Do not use a real person’s name/SSN. |
| G4b | Affiliate link lands on apply | **MISSING** as a written step. Affiliate intended is route reach only. | Open `https://fundhub.ai/start?ref=AFF-000001` (or the live affiliate code). Follow to apply. Record the URL. Fake e2e only if a form is filled. |
| G4c | Content Admin can set a welcome video the client sees | **MISSING.** Portal still said video missing (W4/W6). | Owner opens `/app/content-admin.html`. Walk upload / attach. Do not invent a video file. If there is no video to attach, that is the finding. Then open the **test** portal and say whether the hero changed. |
| G4d | Education / enroll + public legal / affiliate marketing | **MISSING.** | GET + open: `/education/`, `/education/enroll/`, `/education/terms/`, `/education/privacy/`, `/education/refund/`, `/terms/`, `/privacy/`, `/affiliates/`. 200 vs 404. One screenshot each. No form submit with real PII. |
| G5a | The 47 background jobs — on or not, ever ran | **MISSING.** Owner law: do **not** turn on `INNGEST_EVENT_KEY`. | List functions in `src/workflows/`. Check whether the live serve path answers. Count live events vs function names. Do not flip the key. Do not send test events that write client rows. |
| G5b | Calendar as a real booking | **MISSING.** W3 only clicked fake “Move” labels. | Owner Calendar. Prove whether an outside book (Cal.com or the live book URL) has ever written a row. Do not create a booking on a real person’s calendar if that emails them. If no safe test slot, UNVERIFIED. |
| G5c | Bank-app launcher (Oxylabs) | **MISSING.** W6: credentials missing. | Owner on test client. `POST /api/proxy/launch` only as far as the error. Do **not** submit a bank application. |

## Hard rules for every workflow

- Read `.cursor/skills/fundhub-auditor/SKILL.md` first.
- Findings only. No app/code/config/env/test/hook/intended edits.
- No PASS without a shot, network status, or database row.
- Do not print secrets, passwords, or live client names from the gmail file.
- Do not rewrite this board’s G1–G5 lists owned by others. Append only your `## Gx findings` section.
- Write `REPORT.md` in your evidence folder. Plain language. 5th grade.
- Stop when your rows are proven. Chris names fixes later.

## Findings

All five gap walks stopped 2026-08-18. Details stay in each `## Gx findings` block. Do not invent.

**COMPLIANCE REVIEW REQUIRED** — G3 payment, dispute-letter sign, bureau pull, inquiry complete.

| Door | Result |
|---|---|
| G1 Partner | Login works. They stay out of staff desks. Brand save, social queue, Enqueue, and public page fail. |
| G2 Admin | Lands on Pipeline. Every nav row opens, including Client Portal. |
| G2 Setter | Lands on Pipeline. Call bounces. Present stays open. |
| G2 Inquiry | Lands on Specialist. Need me is a dash. Work Queue never loads. Send not pressed. |
| G3a Pay link | BROKEN. `commas_not_configured`. No charge. |
| G3b Dispute Sign | Wrote a consent row. Nothing unlocked. |
| G3c Inquiry complete | UNVERIFIED. Event never fired. |
| G3d Bureau pull | BROKEN. All three refuse. |
| G3e Mail / SMS | BROKEN. Client has no phone/email on the send path. Inbox not proven. |
| G3f Pipeline MOVE | UNVERIFIED. No test card. Real cards not moved. |
| G4a–b Funnel | Watch plays. Affiliate link lands on apply. Thank-you loads without paying and still says booked. |
| G4c Welcome video | Content Admin bounces owner to Pipeline. Portal still has no video. |
| G4d Public pages | All eight load. |
| G5a Jobs | 51 on the live list. Two written jobs left off. Real run UNVERIFIED. |
| G5b Calendar | 15 books in the database. Screen says nothing booked. |
| G5c Bank-app | BROKEN. Proxy login missing. |

## G3 findings

**COMPLIANCE REVIEW REQUIRED** — dispute-letter sign, bureau pull, inquiry complete.

Walked 2026-08-18 on `https://fundhub.ai`. Owner. Test client only: `8556bedc-…`. Never the live credit file.
Evidence: `docs/workflows/audit-gaps-2026-08-18-evidence/g3/`. Report: `g3/REPORT.md`.
Ground truth for these steps is **MISSING**. Do not invent.

| id | Result | One line |
|---|---|---|
| G3a | **BROKEN** | Live `POST /api/payment-links` create $32 diagnostic → 503 `commas_not_configured`. 0 links. No charge. No invented paid row. `g3a-ccp-before-pay.png` `walk.json` |
| G3b | Sign wrote a row. Nothing unlocked. | Pressed Sign once. Consent `d81a91d7-…` `dispute_authorization`. Video still missing. 0 unlocked / 6 locked. `g3b-dispute-after.png` `portal.json` |
| G3c | **UNVERIFIED** — event never fired | Live `inquiry.removed` count still 0. 3 Queued test cases. Mark Cleared exists and would emit with no bureau call. Did not press it. Listener: Inngest `c-03-inquiry-removed-resume-or-hold`. No bus handler in `register-all.mjs`. `g3c-inquiry-desk.png` |
| G3d | **BROKEN** | Pull TU / EX / EQ each → 403. Screen: no soft-pull consent on file. Signed SOFT-PULL-CONSENT contract is not a `client_consents` `soft_pull_consent` row. Scores still dashes. No letter mail. `g3d-pull-transunion.png` |
| G3e | **BROKEN** | Messaging Send → “Not sent. We do not have a phone number or email address for this person.” Failed SMS row `0b1d9316-…` `has_to=false`. Test dest keys are set; they do not match the client record. Did not rewrite the client. Did not text a real person. Inbox unproven. `g3e-messaging-send.png` |
| G3f | **UNVERIFIED** | Test client has **0** `cards` rows. Board has 17 real cards. Did not move them. `g3f-pipeline.png` |

### G3 stop

No app, test, config, env, or intended-journey edits. No deploy. No real card charge. No fake `inquiry.removed`. No live credit file.

## G2 findings

Evidence: `docs/workflows/audit-gaps-2026-08-18-evidence/g2/` (`REPORT.md`, `matrix.md`, `walk.json`, shots).

Admin/setter: **MISSING** intended file. Live OPEN/BOUNCE still recorded. Inquiry scored on desk items 1–7.

**Lands:** admin → Pipeline. setter → Pipeline. inquiry → Specialist (side-menu row says Specialist).

**Nav:** admin 29 rows all OPEN (Finance OS, Staff, Ops, Hiring, Lenders included). setter + inquiry 10 staff rows all OPEN. Same bounce list: Finance / Ops / Hiring / Lenders / portals / closer Call / Sales floor / marketing beta.

**Setter named screens:** Pipeline OPEN. Messaging OPEN. Call typed BOUNCE. Present typed OPEN (no nav, no role gate).

**Inquiry desk:** toggle works. Need me shows "—". Case list loaded (3 test-client rows). SEND seen, not pressed. Work Queue stuck on "Loading inquiry queue…". Repair empty ("No repair files yet."). Stuck-files / bureau-confirm not shown.

```
FAIL — role-inquiry-remover / desk item 3 (Need me)
Expected: Need me is a number for files that need a person today
Observed: tile shows "—" with 3 queued test cases on the page
Evidence: g2/inquiry-desk-inquiries.png
```

```
FAIL — role-inquiry-remover / desk item 4 (Work Queue)
Expected: queue finishes or says work is on hold
Observed: "Loading inquiry queue…" after 8s
Evidence: g2/inquiry-desk-inquiries.png
```

```
FAIL — G2a admin / client file
Expected: admin blocked from the client file
Observed: Client Portal is in the admin nav and opens. "We could not load your file."
Evidence: g2/admin-nav-client-portal.png
```

Also recorded: Present and `/portal-login.html` stay open for all three logins. Admin Home hidden in nav but OPEN if typed. Repair-row and stuck-files UNVERIFIED (empty). Send not pressed (G3). No fix.

## G1 findings

Partner `partner@` lands on Home. Four menu rows open: Home, Social Studio, Creative Factory, Brand Studio. Content is missing and bounces. Pipeline / Finance OS / Staff / Hiring / Client Control Panel all bounce. Marketing is already on. No Connect buttons. Usage card shows 1,458 / 250,000.

**FAIL (4):**
1. Brand save blocked — fields empty (placeholders only); server already has a legal name. `shots/85-brand-save-retry.png`
2. Cannot queue / time / throw away a post — no connected account, partner cannot connect, no discard. `shots/90-social-after-queue.png`
3. Creative Enqueue card is hidden (`display:none`). Did not click. `shots/40-creative-factory-full.png`
4. Home calls `/sites/{id}/apply` “Your page”; GET is 404 “This page is not published.” `shots/60-public-_sites_9defaf28-47c5-43a0-8f5e-f41ef90f360a_apply.png`

Report: `docs/workflows/audit-gaps-2026-08-18-evidence/g1/REPORT.md`

## G4 findings

Report: `docs/workflows/audit-gaps-2026-08-18-evidence/g4/REPORT.md`

Ground truth for G4a–G4d is **MISSING**. Scored against this board. ClickFunnels did not bounce the walk as a bot.

**FAIL**

- **G4c Content Admin.** Owner opens `/app/content-admin.html` (HTTP 200) and is sent to Pipeline in ~0.1s. No Content row in the nav. Upload / tile controls cannot be used. Live content list: **0 videos**, empty map. Evidence: `g4c-content-admin-bounce.png` · `g4c-follow.json`.
- **G4c test portal.** Test client `8556bedc-…` hero still says **“Welcome video is not available.”** No play button. Evidence: `g4c-test-portal.png`.

**PASS**

- **G4a `/watch`.** HTTP 200. Video plays (`/funnel/vsl.mp4` HTTP 200). Shot: `g4a-watch.png`.
- **G4a `/apply`.** HTTP 200. Step 1 filled with fake `e2e+aff-*@` only. No SSN/DOB on this step. Did not press Next. Shot: `g4a-apply-step1-filled.png`.
- **G4a `/funding-book-call`.** HTTP 200. Live slots shown. Did not book. Shot: `g4a-funding-book-call.png`.
- **G4a `/thank-you`.** HTTP 200 without paying. Copy says the call is booked anyway. Shot: `g4a-thank-you.png`.
- **G4b.** `/start?ref=AFF-000001` lands on `https://apply.fundhub.ai/apply?a1=AFF-000001&ref=AFF-000001` (right Fundhub apply, not a wrong theme). Shot: `g4b-start-ref.png`.
- **G4d.** All eight public URLs HTTP 200. No broken pictures. Forms not submitted. Shots: `g4d-*.png`.

**Noted / UNVERIFIED**

- `/book` HTTP 404 — owner **WONTFIX**. Shot: `g4a-book-404.png`.
- Real calendar book not taken (would email staff).
- Apply step 2 not opened.

## G5 findings

G5 claimed. Read-only. Ground truth MISSING. Evidence: `docs/workflows/audit-gaps-2026-08-18-evidence/g5/REPORT.md`

**G5a Background jobs.** 53 jobs defined, 51 on the serve list, 2 left off (`s-02-incomplete-survey-nudge`, `inquiry-call-sweeper`). `message-dispatch-sweeper` **is** registered (old “not registered” note is stale). Live `GET`/`HEAD` `/api/inngest` = **401** (door exists, locked). Live `GET /api/read/workflows` says `engine_active: true` for all 51. The key **name** is present on Netlify. I did not flip it and did not send a test event. Whether the job service actually ran a function is **UNVERIFIED**. Seven registered jobs have never seen their event (`deposit.paid`, `inquiry.removed`, `message.inbound`, `mail.response`, `docs.received` are all 0).

**G5b Calendar.** No `bookings` table. Calendar reads dated `tasks`. 15 “Strategy session booked” rows exist (Aug 12–18). 26 live `booking.created` rows came from **ClickFunnels**. **0** from Cal.com. `CALCOM_WEBHOOK_SECRET` missing. Forged `POST /api/webhooks/calcom` = 401. `POST /api/webhooks/cal` = 404. Owner calendar still says **“Nothing booked.”** today and on Aug 14 (the day with 4 task rows). Demo drawer still has fake “Move one booking” copy. Did not create a booking.

**G5c Bank-app launcher.** Owner + test client + dummy lender id. `POST /api/proxy/launch` = **503** `oxylabs_credentials_missing`. `proxy_sessions` = **0**. Did not file a bank app.
