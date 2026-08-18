# Five wave prompts — paste one per thread

Board: `docs/workflows/audit-untested-2026-08-18.md`  
Each unit’s full rules sit under `## Uxx` on that board. Follow those rules exactly.

Do not run the same wave in two threads.

---

## WAVE A

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence + board findings. Change nothing in the app.

You own WAVE A. Board: docs/workflows/audit-untested-2026-08-18.md
Run these units IN ORDER. Claim each row before you start it. Never touch B/C/D/E rows.

U1  Client magic-link → own file / video / 6 tiles
    evidence: docs/workflows/audit-untested-2026-08-18-evidence/u1/
U8  Bank-app launcher (do not file)
    evidence: …/u8/
U14 Background jobs actually ran
    evidence: …/u14/
U15 GoHighLevel live list
    evidence: …/u15/
U16 Bland call started from this site
    evidence: …/u16/
U17 PostGrid capture received
    evidence: …/u17/
U18 Plaid Connect bank
    evidence: …/u18/
U19 Live Playwright 100/100
    evidence: …/u19/
U20 Galaxy screens
    evidence: …/u20/

For each unit: open ## Uxx on the board and follow that prompt word for word.

Hard stops for the whole wave:
- Never open / write client 9af65808-… (live credit file).
- Do not send a magic link to the bare FUNDHUB_TEST_INBOX address.
- Do not mint a portal session and call it a magic-link PASS.
- Do not charge a card. Do not file a bank app. Do not start a Bland call to any real number.
- Do not turn on INNGEST_EVENT_KEY. Do not POST a fake webhook body.
- Do not put any live vendor in demo / sandbox.
- Do not connect social. Do not publish a post.
- Do not click Plaid Link if it would attach a real bank.
- Passwords from .env (STAFF_E2E_PASSWORD). Never print secrets.
- No PASS without a shot, network response, or database row.
- If a step is not in docs/journeys/*-intended.md, mark MISSING. Score Chris’s claim on the board.

U19 may run Playwright. Do not edit the app, spec, baseline, or hook to turn red green.

After each unit: REPORT.md in that folder + append ## Uxx findings on the board. Mark the row done.
When all A units stop: one short WAVE A rollup at the top of your last REPORT. Stop.
```

---

## WAVE B

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence + board findings. Change nothing in the app.

You own WAVE B. Board: docs/workflows/audit-untested-2026-08-18.md
Run these units ONE AT A TIME in this order. Same inbox / phone. Claim each row first.

U2  Client Gmail reply → staff Messaging
    evidence: docs/workflows/audit-untested-2026-08-18-evidence/u2/
U3  Email STOP / unsubscribe
    evidence: …/u3/
U13 SMS lands on the test phone
    evidence: …/u13/

For each unit: open ## Uxx on the board and follow that prompt word for word.

Hard stops for the whole wave:
- Never open / write client 9af65808-… (live credit file).
- Do not send a reply From the bare FUNDHUB_TEST_INBOX. That From matches the live file.
- Do not write the bare inbox or a real phone onto any client.
- Plus-tag only, and only if it cannot collide with the live file. If it would collide, do not send. That is the finding.
- Do not text a real person. U13 To = FUNDHUB_TEST_PHONE from .env only. Confirm the name, never print the number.
- TEST client 8556bedc-… has no phone. Do not patch the client to make SMS work.
- One SMS send. A2P fail is expected. Do not retry twice more.
- Fake e2e emails only: e2e+aff-*@, e2e+wl-*@.
- Do not put mail/SMS vendors in sandbox.
- No PASS without a shot, network response, or database row.

After each unit: REPORT.md + ## Uxx findings. Mark done.
When U2, U3, and U13 stop: short WAVE B rollup. Stop.
```

---

## WAVE C

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence + board findings. Change nothing in the app.

You own WAVE C. Board: docs/workflows/audit-untested-2026-08-18.md
Run these units ONE AT A TIME in this order. They share TEST client 8556bedc-….
Claim each row first. Never touch the live credit file 9af65808-….

U4  Real pay rail (no card charge)
    evidence: docs/workflows/audit-untested-2026-08-18-evidence/u4/
U5  Bureau pull that comes back
    evidence: …/u5/
U6  Inquiry Send leaves the building
    evidence: …/u6/
U7  Inquiry complete → next funding round
    evidence: …/u7/

For each unit: open ## Uxx on the board and follow that prompt word for word.

COMPLIANCE REVIEW REQUIRED — payment rails (U4), credit-pull / consent (U5), inquiry (U6, U7).
Flag that at the top of each REPORT.

Hard stops for the whole wave:
- TEST client 8556bedc-… only.
- Do NOT charge a real card. Do not type a card number. Do not invent a paid event.
- Do not put Commas / Stripe / bureau / inquiry vendor in sandbox.
- TransUnion is owner-off (E1006). One refuse is enough. Do not retry.
- Do not mail a bureau letter.
- U6: one Send on a TEST Queued case only. If it fails, do not press a third time.
- U7: do NOT fake-write inquiry.removed. Do NOT press Mark Cleared if that fakes a complete. Record the button. Leave it.
- Do not turn on INNGEST_EVENT_KEY.
- No PASS without a shot, network response, or database row.

After each unit: REPORT.md + ## Uxx findings. Mark done.
When U4–U7 stop: short WAVE C rollup. Stop.
```

---

## WAVE D

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence + board findings. Change nothing in the app.

You own WAVE D. Board: docs/workflows/audit-untested-2026-08-18.md
Run U9 first, then U10. Claim each row first.

U9  Apply step 2
    evidence: docs/workflows/audit-untested-2026-08-18-evidence/u9/
U10 Book a live call slot
    evidence: …/u10/

For each unit: open ## Uxx on the board and follow that prompt word for word.

Hard stops for the whole wave:
- Live funnel: https://apply.fundhub.ai
- Fake e2e email only: e2e+aff-*@ or e2e+wl-*@.
- Do not use a real person’s name, SSN, DOB, or phone.
- U9: if step 2 asks for SSN, STOP. Do not type a real or invented SSN. Shot the fields. That is the finding.
- U9: do not book (that is U10). Do not pay.
- /book 404 is owner WONTFIX. Canonical book is /funding-book-call.
- U10: if booking would email a real closer / Chris / a real lead, do NOT book. Mark UNVERIFIED.
- Do not create a booking on a real person’s calendar.
- No PASS without a shot, network response, or database row.
- No intended funnel journey. Mark MISSING. Score Chris’s claim.

After each unit: REPORT.md + ## Uxx findings. Mark done.
When U9 and U10 stop: short WAVE D rollup. Stop.
```

---

## WAVE E

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence + board findings. Change nothing in the app.

You own WAVE E. Board: docs/workflows/audit-untested-2026-08-18.md
Run U11 first, then U12. Claim each row first. One at a time.

U11 Pipeline MOVE / archive (test card only)
    evidence: docs/workflows/audit-untested-2026-08-18-evidence/u11/
U12 Hire or reject (demo candidate only)
    evidence: …/u12/

For each unit: open ## Uxx on the board and follow that prompt word for word.

Hard stops for the whole wave:
- Never open / write client 9af65808-….
- U11: only a card for TEST client 8556bedc-…. If 0 cards, do NOT move a real person’s card. UNVERIFIED.
- U12: only a candidate whose name or email is clearly test/demo/e2e. If every row looks real, do NOT press Hire or Reject. UNVERIFIED.
- Prefer Reject over Hire if a demo row exists.
- Do not email a real applicant. Do not reset passwords. Do not revoke a real login.
- No PASS without a shot, network response, or database row.

After each unit: REPORT.md + ## Uxx findings. Mark done.
When U11 and U12 stop: short WAVE E rollup. Stop.
```
