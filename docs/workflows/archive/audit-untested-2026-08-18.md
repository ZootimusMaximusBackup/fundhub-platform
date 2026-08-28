# Untested doors — audit prompts — 2026-08-18

Findings only. Auditor. No app / config / env / test / intended-journey edits. No deploy.

These are the doors later audits **never proved**. Already-broken doors (pay link, empty unlock map, Agent Editor ≠ Bland) are **not** on this list.

Live CRM: `https://fundhub.ai`  
Live funnel: `https://apply.fundhub.ai`  
Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/`  
Skill: `.cursor/skills/fundhub-auditor/SKILL.md`

**Never open / never write** client `9af65808-a619-4e65-ae91-239766a006b7` (live credit file).  
**No prompt exists for that file.** Do not write one.

**Test client for CRM writes:** `8556bedc-46e1-4d85-b0cd-a24adfee1521`.  
Passwords from gitignored `.env` (`STAFF_E2E_PASSWORD`). Never print. Confirm env **names** only.

Ground truth: `docs/journeys/*-intended.md` only name who can open routes. If a step is not written there, mark **MISSING**. Score Chris’s claim on this board. Do not invent a journey.

## Hard rules (every prompt)

- Read the auditor skill first.
- Claim your row before you start. Never work an unclaimed or already-claimed row.
- Write only to your evidence folder + append `## Uxx findings` on this board.
- No PASS without a screenshot, network response, or database row.
- Do not put a live integration into demo / mock / sandbox.
- Do not charge a real card.
- Do not turn on `INNGEST_EVENT_KEY`.
- Do not start a Bland call to any real number.
- Do not text or email a real person. Fake e2e only: `e2e+aff-*@`, `e2e+wl-*@`. Plus-tag on the watched inbox is OK only if it cannot collide with the live file.
- Do not send a magic link to the bare `FUNDHUB_TEST_INBOX` address. That address is the live file.
- Do not press Sign on the live file. Dispute sign on the test file was already done (G3).
- Twilio A2P may fail. That is expected. Record it. Do not try a third time.
- `COMPLIANCE REVIEW REQUIRED` on U5, U6, U7 (bureau / inquiry / credit-repair).
- REPORT.md in 5th-grade English. Report and stop. Change nothing else.

## Tasks

| id | owns | status | wave |
|---|---|---|---|
| U1 | Client magic-link → own file / video / 6 tiles | done | A |
| U2 | Client Gmail reply → staff Messaging | done | B |
| U3 | Email STOP / unsubscribe | done | B |
| U4 | Real pay rail (no card charge) | done | C |
| U5 | Bureau pull that comes back | done | C |
| U6 | Inquiry Send leaves the building | done | C |
| U7 | Inquiry complete → next funding round | done | C |
| U8 | Bank-app launcher (do not file) | done | A |
| U9 | Apply step 2 | done | D |
| U10 | Book a live call slot | done | D |
| U11 | Pipeline MOVE / archive (test card only) | done | E |
| U12 | Hire or reject (demo candidate only) | done | E |
| U13 | SMS lands on the test phone | done | B |
| U14 | Background jobs actually ran | done | A |
| U15 | GoHighLevel live list | done | A |
| U16 | Bland call started from this site | done | A |
| U17 | PostGrid capture received | done | A |
| U18 | Plaid Connect bank | done | A |
| U19 | Live Playwright 100/100 | done | A |
| U20 | Galaxy screens (owner skipped UI) | done | A |

**Waves:** A is read-only / no shared writes — all parallel. B shares the watched inbox — one at a time. C shares the TEST client — one at a time. D is the funnel — one at a time (or U9 then U10). E writes hiring / pipeline — one at a time. Cap 5 live agents.

**No dependencies across waves** except: do not run two of B at once, two of C at once, or U9+U10 at once.

---

## U1 — Client magic-link paints their file

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U1. Write to docs/workflows/audit-untested-2026-08-18-evidence/u1/

Chris’s claim: a client gets a sign-in link, opens it, and sees THEIR file, the welcome video, and the six offer tiles (n unlocked / 6 locked). Staff-open does not count.

Hard stops:
- Never open client 9af65808-…
- Do not send a magic link to the bare FUNDHUB_TEST_INBOX address (that is the live file).
- Test client 8556bedc-… email is @fundhub.ai, not the watched inbox. P1 already proved a link to that address cannot be opened in Gmail.
- Do not mint a fake portal session and call it a magic-link PASS.
- Do not press dispute Sign on the live file.

Prove, or mark UNVERIFIED with why:
1. Can a real magic-link be received in a mailbox a person can open, for a NON-live client, without writing the live file’s email onto that client?
2. After that link: file paint (name / “could not load”), hero video play or “not available”, footer entitlements n/6, dispute card text.
3. If it cannot be done safely, that is the finding. Do not invent a workaround that touches the live file.

Read docs/journeys/client-intended.md. If magic-link → own file is not named, MISSING. Score this claim.

Prior: audit-2026-08-19 P1 (UNVERIFIED). W1 portal “could not load.” Staff-open 0/6.

REPORT.md. Shots. Report and stop.
```

---

## U2 — Client reply lands in Messaging

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U2. Write to docs/workflows/audit-untested-2026-08-18-evidence/u2/

Chris’s claim: a client replies to a Fundhub email. That reply shows in staff Messaging.

Hard stops:
- Never open / write client 9af65808-…
- Do not send a reply From the bare FUNDHUB_TEST_INBOX address. The code matches From to the oldest client with that email. The live file would win.
- Do not overwrite any client’s email to the bare inbox.
- Plus-tag only, on a sim or test client that is not the live file.
- Do not text.

Prove:
1. Where outbound mail is sent from (Resend vs Mailgun).
2. Whether a reply to that From would hit Mailgun (mg.fundhub.ai) or Cloudflare (fundhub.ai).
3. If a SAFE reply can be sent (plus-tag From that cannot match the live file): send one. Watch /api/webhooks/mailgun, events.message.inbound, staff Messaging.
4. If a safe reply cannot be sent, do not send. UNVERIFIED or BROKEN with the reason.

Read client-intended.md. Reply → inbox is MISSING if not named.

Prior: P3 — Mailgun catch_all exists for mg.fundhub.ai; contract went out Resend; reply not sent.

REPORT.md. Report and stop.
```

---

## U3 — Email STOP / unsubscribe

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U3. Write to docs/workflows/audit-untested-2026-08-18-evidence/u3/

Chris’s claim: a client can stop email. After STOP, Fundhub does not keep mailing them.

Hard stops:
- Never touch client 9af65808-…
- Do not click unsubscribe on a live person’s mail.
- Use a sim / plus-tag client only. Do not write the bare inbox onto anyone.
- No SMS STOP in this unit (U13 owns SMS).

Prove:
1. Does outbound mail have an unsubscribe link?
2. What happens if that link is clicked (or if the word STOP is emailed)?
3. Is an opt_outs row written? Does Mailgun unsubscribed get ignored?
4. If there is no link and no safe STOP path, that is the finding. Do not invent one.

Prior: P3 — no unsubscribe link; email STOP does not write opt_outs; Mailgun unsubscribed ignored.

Read client-intended.md. MISSING if not named.

REPORT.md. Report and stop.
```

---

## U4 — Pay rail, no card charge

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U4. Write to docs/workflows/audit-untested-2026-08-18-evidence/u4/

Chris’s claim: a closer can make a live pay link and a card can be charged. This unit proves the RAIL, not a charge.

Hard stops:
- TEST client 8556bedc-… only.
- Never the live credit file.
- Do NOT charge a real card. Do not enter a card number. Do not put Commas/Stripe in sandbox.
- Do not invent a paid event (W16 already simulated events). This unit is the live create/checkout door only.

Prove:
1. Closer or owner on the TEST file. Create a $32 diagnostic pay link.
2. Exact HTTP status and body key (commas_not_configured or a URL).
3. If a hosted checkout URL appears, open it. Stop before any card fields are submitted. Screenshot the page.
4. Is there any other live pay door (Stripe, invoice, portal pay)? Open it to the same stop line.

COMPLIANCE REVIEW REQUIRED — payment rails.

Prior: W6 / G3a / W16 — create returns commas_not_configured. 0 payment links on the TEST file.

REPORT.md. Report and stop.
```

---

## U5 — Bureau pull that comes back

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U5. Write to docs/workflows/audit-untested-2026-08-18-evidence/u5/

Chris’s claim: a bureau pull runs on the TEST file and a score / inquiries / tradelines come back.

COMPLIANCE REVIEW REQUIRED — credit-pull type, consent.

Hard stops:
- TEST client 8556bedc-… only. Never 9af65808-…
- Owner 2026-08-16: TransUnion off (E1006). If the button is still there, click once, record refuse, do not retry.
- Do not mail a bureau letter. Do not pull the live gmail file.
- Do not put the bureau vendor in sandbox.

Prove:
1. Soft-pull consent row on this file — yes/no (W10: sign did not write consent).
2. Click Soft pull, then Experian, Equifax, TransUnion — one click each or the first honest refuse.
3. Did a soft_pull_requests row write? Did scores leave dashes?
4. If every button refuses, that is the finding. Do not force a live pull around the gate.

Prior: W1 soft pull did not come back. G3d each bureau → 403. No consent row.

Read intended journeys. Soft-pull step is MISSING.

REPORT.md. Report and stop.
```

---

## U6 — Inquiry Send leaves the building

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U6. Write to docs/workflows/audit-untested-2026-08-18-evidence/u6/

Chris’s claim: Inquiry Send on a TEST case actually calls the phone runtime / bureau path (not a dead button).

COMPLIANCE REVIEW REQUIRED — inquiry removal.

Hard stops:
- TEST client cases only (8556bedc-…). Never a real person’s case.
- Do not open 9af65808-…
- One Send press. If it fails, do not press a third time (stuck rule).
- Do not mark Cleared (U7 owns complete).

Prove:
1. Open Specialist as inquiry@ or owner. Open a TEST Queued case.
2. Press Send once. Record on-screen text, network call, and whether inquiry-removal-ai-sigma.vercel.app or INQUIRY_API_BASE was hit.
3. Mail? Call row? Event?
4. W6 saw “VIEW IS NOT DEFINED” and no outbound. Re-prove live today. Do not copy W6 as proof.

Read role-inquiry-remover-intended.md desk items.

REPORT.md. Report and stop.
```

---

## U7 — Inquiry complete → next funding round

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U7. Write to docs/workflows/audit-untested-2026-08-18-evidence/u7/

Chris’s claim: when inquiry work is done, the next funding round starts by itself.

COMPLIANCE REVIEW REQUIRED — inquiry complete.

Hard stops:
- Do NOT fake-write inquiry.removed.
- Do NOT press Mark Cleared if that emits a complete with no bureau work. Record that the button exists. Leave it.
- TEST cases only. Never a real person’s case.
- Do not turn on INNGEST_EVENT_KEY.

Prove:
1. Live count of inquiry.removed (was 0).
2. Can any TEST case reach a real complete without a fake event? If no, UNVERIFIED / event never fired.
3. What would listen: Inngest c-03-inquiry-removed-resume-or-hold, bus handlers, tasks tagged inquiry:completed.
4. Has that listener ever run for anyone?

Prior: G3c / W10 — event never fired. 3 Queued test cases.

Read intended. Step is MISSING.

REPORT.md. Report and stop.
```

---

## U8 — Bank-app launcher (do not file)

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U8. Write to docs/workflows/audit-untested-2026-08-18-evidence/u8/

Chris’s claim: from the TEST file, staff can launch a bank application.

Hard stops:
- TEST client only.
- POST /api/proxy/launch only as far as the error.
- Do NOT submit a bank application. Do not type real bank login.
- Do not put Oxylabs in sandbox.

Prove:
1. Owner + TEST client + a dummy lender id if needed.
2. Exact status and key (oxylabs_credentials_missing or further).
3. proxy_sessions count before/after.
4. Is there any other “apply to lender” door on CCP / Lenders?

Prior: W6 / G5c — 503 oxylabs_credentials_missing. 0 sessions.

REPORT.md. Report and stop.
```

---

## U9 — Apply step 2

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U9. Write to docs/workflows/audit-untested-2026-08-18-evidence/u9/

Chris’s claim: a new person can get past apply step 1 and complete step 2 (the extra fields).

Hard stops:
- Fake e2e email only: e2e+aff-*@ or e2e+wl-*@.
- Do not use a real person’s name, SSN, DOB, or phone.
- If step 2 asks for SSN, STOP. Do not type a real or invented SSN. Screenshot the fields. That is the finding (cannot finish safely).
- Do not book a call (U10). Do not pay.
- /book 404 is owner WONTFIX. Canonical book is /funding-book-call.

Prove:
1. apply.fundhub.ai /watch → /apply. Fill step 1 with fake e2e only.
2. Press Next. What is step 2? Shot of every field.
3. Can it be finished with no real PII? If yes, finish with fake data only. If no, stop.
4. What row was written (client / survey / ClickFunnels)? Leave it. Record the id.

Prior: G4a filled step 1, did not press Next.

No intended funnel journey. MISSING. Score this claim.

REPORT.md. Report and stop.
```

---

## U10 — Book a live call slot

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U10. Write to docs/workflows/audit-untested-2026-08-18-evidence/u10/

Chris’s claim: a person can pick a live slot on /funding-book-call and a booking row appears.

Hard stops:
- If booking would email a real closer / Chris / a real lead, do NOT book. Mark UNVERIFIED. That is an honest stop, not a fail to try.
- Fake e2e email only if a form is required.
- Do not use a real person’s name or phone.
- Do not create a booking on a real person’s calendar.

Prove:
1. Open https://apply.fundhub.ai/funding-book-call. Slots shown? Whose calendar?
2. Has Cal.com ever written a row? (G5b: 0 Cal.com, 26 ClickFunnels booking.created). Re-prove counts.
3. Owner Calendar still “Nothing booked”?
4. If a SAFE slot exists that emails only a test inbox, book it. Else do not.

Prior: G4a showed slots, did not book. G5b no bookings table; calendar reads tasks.

REPORT.md. Report and stop.
```

---

## U11 — Pipeline MOVE / archive

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U11. Write to docs/workflows/audit-untested-2026-08-18-evidence/u11/

Chris’s claim: a pipeline card can be moved or archived, and the board updates.

Hard stops:
- Only a card for TEST client 8556bedc-…
- If that client has 0 cards, do NOT move a real person’s card. UNVERIFIED.
- Never open 9af65808-…

Prove:
1. Does the TEST file have a cards row? Count.
2. If yes: Move or Archive once. Shot before/after. Database stage/status.
3. If no: say so. Do not create a card unless simulate already exists for this id and is safe. Prefer UNVERIFIED over writing a new real-looking card.

Prior: G3f — 0 cards on TEST. 17 real cards not moved.

REPORT.md. Report and stop.
```

---

## U12 — Hire or reject (demo only)

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U12. Write to docs/workflows/audit-untested-2026-08-18-evidence/u12/

Chris’s claim: Hiring Hire / Reject does what the button says.

Hard stops:
- Only a candidate whose name or email is clearly test/demo/e2e.
- If every candidate looks like a real person, do NOT press Hire or Reject. UNVERIFIED.
- Do not email a real applicant.
- Do not reset passwords. Do not revoke a real login.

Prove:
1. Owner Hiring. Is the drawer read-only (“Nothing in this panel can be changed”)? W6 said yes.
2. Is there a hire/reject API?
3. If a demo candidate exists and a write path exists: press Reject (safer than Hire) once. Record the row.
4. If not, that is the finding.

Prior: W6 — read-only drawer. No hire/reject write API under api/hiring/. 3 demo candidates.

REPORT.md. Report and stop.
```

---

## U13 — SMS lands on the test phone

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except evidence. Change nothing in the app.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U13. Write to docs/workflows/audit-untested-2026-08-18-evidence/u13/

Chris’s claim: a text actually arrives on the test phone.

Hard stops:
- Destination = FUNDHUB_TEST_PHONE from local .env only. Confirm the name, never print the number.
- Do not text a real person. Do not text the live file.
- TEST client 8556bedc-… has no phone (W1). Do not rewrite the live file’s phone onto anyone.
- If the TEST client has no phone, you may send only if the screen lets you type FUNDHUB_TEST_PHONE as the To. If it will not, do not patch the client. Finding: cannot send.
- One send. A2P pending fail is expected. Do not retry twice more.

Prove:
1. Messaging Send (or template send) to the test phone.
2. messages row: status, provider, error.
3. Phone proof: screenshot of the device or an inbound Twilio log that shows delivered. Provider “sent” alone is not inbox proof.
4. A2P status if the send fails.

Prior: W1/G3e — no phone on TEST; send refused; A2P pending.

REPORT.md. Report and stop.
```

---

## U14 — Background jobs actually ran

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only. Change nothing.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U14. Write to docs/workflows/audit-untested-2026-08-18-evidence/u14/

Chris’s claim: the background job service is on and jobs have actually run.

Hard stops:
- Do NOT turn on INNGEST_EVENT_KEY.
- Do not send test events that write client rows.
- Do not PUT the live serve path into demo mode.

Prove:
1. How many jobs are defined vs on the live list (G5a: 53 defined, 51 listed, 2 left off).
2. Live GET /api/inngest and GET /api/read/workflows. engine_active claim vs a real run log.
3. For each of these events, live count: deposit.paid, inquiry.removed, message.inbound, mail.response, docs.received, diagnostic.paid, payment.received, contract.signed.
4. Name any job that has a live run row (success or error). If none, UNVERIFIED / never ran.

Prior: G5a — door 401, key name present, real run UNVERIFIED.

REPORT.md. Report and stop.
```

---

## U15 — GoHighLevel live

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only. Change nothing.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U15. Write to docs/workflows/audit-untested-2026-08-18-evidence/u15/

Chris’s claim: we still do not know what GHL is doing. Get a live list or prove we still cannot.

Hard stops:
- Do not POST a body to old GHL catch-doors “to see.”
- Do not rotate keys. If 401, 401 is the finding.
- Read .env / Netlify names only. Never print key values.
- Do not put GHL in sandbox.

Prove:
1. Retry live GHL list APIs with the keys that exist (names only).
2. If still 401: UNVERIFIED, same as W15. Do not invent the 140-name list.
3. If a list returns: workflows on/off, A2P 10DLC, pipelines. Table.
4. POST https://fundhub.ai/api/webhooks/ghl still 404?

Prior: W15 — all list APIs 401. Platform webhook 404. 0 GHL capture rows.

REPORT.md. Report and stop.
```

---

## U16 — Bland call started from this site

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only. Change nothing.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U16. Write to docs/workflows/audit-untested-2026-08-18-evidence/u16/

Chris’s claim: fundhub.ai can start a Bland call (Bland is the phone-robot company).

Hard stops:
- Do NOT start a call to Chris or any real number.
- Do not Save or Promote on Agent Editor.
- Do not put Bland in sandbox.

Prove:
1. Is there a dial / start-call button on Agent Editor, Specialist, or CCP?
2. Does src/ call api.bland.ai, or only vendor/inquiry-remover?
3. INQUIRY_API_BASE set? /api/inquiry configured?
4. Walk the start path to the last safe refuse (not configured / no number). Do not place the call.
5. Last Bland call on this key: date only. Not from this CRM?

Prior: W13R — vendor files send the script; this site has no dialer; last call 2026-08-16.

REPORT.md. Report and stop.
```

---

## U17 — PostGrid capture received

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only. Change nothing.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U17. Write to docs/workflows/audit-untested-2026-08-18-evidence/u17/

Chris’s claim: PostGrid (the letter-mail company) can tell Fundhub a letter landed.

Hard stops:
- Do not send a real letter. Do not POST a fake webhook body to the live door.
- Do not put PostGrid in sandbox.

Prove:
1. Is there a PostGrid webhook route? What URL?
2. Capture table: PostGrid row count (W6: 0).
3. Has any letter send path ever called PostGrid from this repo?
4. If the receiver exists but has never stored a capture, that is the finding (event never fired).

Prior: W6 — Bland and PostGrid receivers exist; 0 captures.

REPORT.md. Report and stop.
```

---

## U18 — Plaid Connect bank

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only. Change nothing.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U18. Write to docs/workflows/audit-untested-2026-08-18-evidence/u18/

Chris’s claim: Finance OS can Connect a bank (personal / business / investment) through Plaid.

Hard stops:
- Do not click Connect if it would open Plaid Link and attach a real bank.
- Do not put Plaid in sandbox.
- Never the live credit file.

Prove:
1. Open Finance OS as owner. Is there a Connect bank button?
2. Search the repo / git history for Plaid.create, link_token, Connect bank (W14: never).
3. plaid_items count. Plaid inbound webhook — 404 or live?
4. If there is no button and no link_token path, that is the finding. Do not start a Link session.

Prior: W14 — no version ever had Connect. W6 — Plaid webhook 404, plaid_items 0.

REPORT.md. Report and stop.
```

---

## U19 — Live Playwright 100/100

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
You may RUN Playwright only to gather a score. Do not edit the app, the spec, a baseline, or a hook to turn red into green.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U19. Write to docs/workflows/audit-untested-2026-08-18-evidence/u19/

Chris’s claim: the live suite against https://fundhub.ai (and apply.fundhub.ai if in the board) scores 100/100.

Required ids: docs/workflows/live-playwright-100.md
Command: npm run test:e2e:live (or the board’s current live command).
Credentials from .env only. Never print passwords.
Fake e2e emails only.

Prove:
1. Run the live suite once.
2. score = (passed_required / required) * 100
3. List failed required ids only (capped). Do not fix them.
4. This is still a script. Do not tell Chris to click until 100. You will not reach human-click in this unit.

If the command is missing or the id list is empty, that is the finding.

REPORT.md with the score. Report and stop.
```

---

## U20 — Galaxy screens

```
You are Fundhub Auditor. Read .cursor/skills/fundhub-auditor/SKILL.md first.
Read only except viewing live pages. Change nothing.

Board: docs/workflows/audit-untested-2026-08-18.md
Claim U20. Write to docs/workflows/audit-untested-2026-08-18-evidence/u20/

Chris’s claim: Galaxy and partner Galaxy are real screens a person can use. The Aug 17 UI audit skipped them on purpose. This unit walks them.

Hard stops:
- Owner on https://fundhub.ai/app/galaxy.html
- Partner on partner Galaxy / Galaxy as partner@ if that is the door. Do not turn marketing-enable.
- Do not connect Facebook / Instagram / LinkedIn.
- Do not publish a live post.
- Never the live credit file.

Prove:
1. Who can open Galaxy? Owner / partner / others. Bounce vs stay.
2. What does the page actually show? Shot 1440.
3. Every visible control: click once if it does not publish or connect. Record claim vs what happened.
4. Partner public page /sites/{id}/{slug} — 200 or 404 (G1 was 404).

Read white-label-intended.md. Galaxy as a named step may be MISSING.

REPORT.md. Report and stop.
```

---

## Findings

## U1 findings

- Journey step **MISSING** in `docs/journeys/client-intended.md`.
- Chris’s claim: **UNVERIFIED — cannot be done safely.**
- TEST email ≠ inbox; live file email = inbox; TEST is `@fundhub.ai`. Gmail: no session.
- Did not send to bare `FUNDHUB_TEST_INBOX`. Did not mint a session.
- Staff-open extra (not a PASS): “Welcome back, TEST”; video not available; **0/6**; “You already signed.”
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u1/`

---

## U8 findings

- Journey step **MISSING**.
- Chris’s claim: **BROKEN.**
- Owner `POST /api/proxy/launch` TEST + dummy lender → **503** `oxylabs_credentials_missing`. `proxy_sessions` **0→0**.
- CCP / Lenders: apply script present; lender list empty; 0 Apply buttons pressed. Did not file.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u8/`

---

## U14 findings

- Journey step **MISSING**.
- Chris’s claim: **UNVERIFIED — no Inngest run row.**
- 53 defined / 51 listed / 2 left off (`s-02-incomplete-survey-nudge`, `inquiry-call-sweeper`).
- `GET /api/inngest` **401**. `GET /api/read/workflows` 51, `engine_active` true, 44 live / 7 never_triggered (events table, not a run).
- Named counts: deposit.paid 1; inquiry.removed / message.inbound / mail.response / docs.received **0**; diagnostic.paid 5; payment.received 11; contract.signed 3.
- Did not flip `INNGEST_EVENT_KEY`. Did not send a test event.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u14/`

---

## U15 findings

- Journey step **MISSING**.
- Chris’s claim: **UNVERIFIED — same as W15.** No live list. Did not invent the 140-name list.
- `GHL_RELAY_API_KEY` → **401** scope. `GHL_API_KEY` / `GHL_PRIVATE_API_KEY` → **401** Invalid JWT. Workflows / pipelines / phones all refused.
- `POST /api/webhooks/ghl` **404** `unknown provider: ghl`. GHL captures **0**.
- Did not POST a catch-door. Did not rotate keys. Did not sandbox.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u15/`

---

## U16 findings

- Journey step **MISSING**.
- Chris’s claim: **BROKEN.** This site cannot start a Bland call.
- No start-call button on Agent Editor / Specialist / CCP. Did not Save or Promote. Did not dial.
- `src/` never calls `api.bland.ai`. Vendor `inquiry-remover` does. `INQUIRY_API_BASE` unset. `GET /api/inquiry?action=cases` **503** `not_configured`.
- Last Bland call on this key: **2026-08-16**. Not proven from this CRM.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u16/`

---

## U17 findings

- Journey step **MISSING**.
- Chris’s claim: **UNVERIFIED — event never fired.**
- Door `https://fundhub.ai/api/webhooks/postgrid` exists (GET **405**). Did not POST a fake body.
- `webhook_captures` PostGrid **0**. `dispute_letters` **0**. Inquiry `first_delivery_at` **0**.
- Send path exists in `mail-letter.mjs`. No live send proven.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u17/`

---

## U18 findings

- Journey step **MISSING**.
- Chris’s claim: **BROKEN.** No Connect bank door.
- Finance OS: “Not connected” / “The bank is not linked.” 0 Connect buttons. Did not open Plaid Link.
- Repo + git: `Plaid.create` / `link_token` / `Connect bank` / `cdn.plaid.com` never. `plaid_items` **0**. `POST /api/webhooks/plaid` **404**.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u18/`

---

## U19 findings

- Required-id score: **100/100**. Failed required ids: none.
- Full `npm run test:e2e:live`: **26/29**. Extra red (not required): 3 Company Brain tests (ERR_ABORTED / 502 embed_failed). Did not fix.
- Did not tell Chris to click.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u19/`

---

## U20 findings

- Journey step **MISSING** in `docs/journeys/white-label-intended.md` (names `/sites/{partnerId}/{slug}`, not “Galaxy”).
- Chris’s claim: **PASS.** Owner Galaxy stays. Partner Galaxy stays. Both paint a sky.
- Owner `chris@` `/app/galaxy.html`: stayed, 1440 shot, read-only. Sky click zoomed; no write.
- Partner `partner@` `/app/galaxy.html` → `/app/partner-galaxy.html`. Stayed. Download stayed on page. No connect / no publish.
- Closer `closer@` `/app/galaxy.html` → closer dashboard (bounce).
- Public `/sites/9defaf28-…/apply` still **404** (G1). Three published e2e pages **200**. Did not publish.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u20/`

## WAVE A stop

[Wave A](7cf0b029-cb7d-4597-801e-66339a053f1e) done. U1 **UNVERIFIED**. U8 **BROKEN**. U14 **UNVERIFIED**. U15 **UNVERIFIED**. U16 **BROKEN**. U17 **UNVERIFIED**. U18 **BROKEN**. U19 **100/100** required. U20 **PASS**. No app edits.

## All five waves

All 20 rows **done**. Findings only. Chris names what to fix.

| Wave | Result |
|---|---|
| A | U20 PASS. U19 required 100/100. U8 / U16 / U18 BROKEN. U1 / U14 / U15 / U17 UNVERIFIED. |
| B | U2 BROKEN (not sent). U3 BROKEN. U13 UNVERIFIED. |
| C | U4 / U5 / U6 BROKEN. U7 UNVERIFIED. COMPLIANCE REVIEW REQUIRED. |
| D | U9 PARTIAL. U10 UNVERIFIED. |
| E | U11 PASS (MOVE). U12 BROKEN. |

## U4 findings

**COMPLIANCE REVIEW REQUIRED** — payment rails.

- Score: **BROKEN**. Owner `POST /api/payment-links` create $32 diagnostic on TEST `8556bedc-…` → **503** `commas_not_configured`. No checkout URL. `payment_links` on this file still **0**.
- Closer same create → **403** `forbidden`. Present opened TEST. Did not press Send.
- Other doors: no Stripe keys; TEST invoices **0**; portal 0 checkout URLs (“Online checkout is not available yet”).
- Journey step **MISSING**. Did not charge. Did not invent a paid event.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u4/REPORT.md`

## U5 findings

**COMPLIANCE REVIEW REQUIRED** — credit-pull type, consent.

- Score: **BROKEN**. TEST file scores stay `EX — · EQ — · TU —`.
- No Soft Pull button. Experian, Equifax, TransUnion — one click each → `POST /api/finance/crs-pull` **403** “no soft-pull consent on file”.
- `soft_pull_consent` row **0**. Signed SOFT-PULL-CONSENT contract does not count. `soft_pull_requests` **0**. `crs_results` **0**.
- TransUnion: one refuse, no retry. No letter mailed. Journey step **MISSING**.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u5/REPORT.md`

## U6 findings

**COMPLIANCE REVIEW REQUIRED** — inquiry removal.

- Score: **BROKEN**. Specialist Send on a TEST Queued case → button **VIEW IS NOT DEFINED**. No `/api/inquiry-cases` write. No vercel host. No call row.
- `GET /api/inquiry?action=cases` → **503** `not_configured`. `INQUIRY_API_BASE` unset.
- 3 TEST cases still `Queued`. Mail unchecked. Did not press Mark Cleared. Did not press Send again.
- Send is named on the Specialist intended desk. The live click does not leave the building. Re-proved today.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u6/REPORT.md`

## U7 findings

**COMPLIANCE REVIEW REQUIRED** — inquiry complete.

- Score: **UNVERIFIED** — `inquiry.removed` count **0** (all files). Event never fired.
- 3 inquiry cases in the whole table, all TEST, all `Queued`. Completed **0**. `c-03` tasks **0**. TEST funding rounds **0**.
- Mark Cleared exists on the TEST case. Recorded. Not pressed. Pressing it would fake a complete.
- Listener: Inngest `c-03-inquiry-removed-resume-or-hold`. Journey step **MISSING**.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u7/REPORT.md`

## WAVE C stop

[Wave C](3ff2c260-1a86-4f90-a46a-4a9297acb1cf) done. **COMPLIANCE REVIEW REQUIRED** — pay, pull, inquiry. U4 **BROKEN**. U5 **BROKEN**. U6 **BROKEN**. U7 **UNVERIFIED** (event never fired). TEST file only. No app edits.

## U11 findings

- Journey: **MISSING.** No intended step for pipeline MOVE / archive.
- Chris’s claim: **PASS** on MOVE. Archive not tried.
- TEST `8556bedc-…` now has **1** `cards` row (`5410b98b-…`, Sales). G3f had 0. Did not create it.
- Dragged that card Diagnostic Paid → Decision Rendered. `POST /api/pipeline-cards` **200**. DB stage now `decision_rendered`. Board still 18 cards.
- Did not archive. Did not move a real person’s card. Did not open `9af65808-…`.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u11/REPORT.md`

## U2 findings

**BROKEN / not sent.** Claim: client reply shows in staff Messaging.

- Journey: **MISSING** (`client-intended.md` has no reply → inbox step).
- Outbound: Resend / `fundhub.ai` (49 sent). Reply to that From hits Cloudflare, not Mailgun.
- Mailgun catch_all → `https://fundhub.ai/api/webhooks/mailgun` is live. It only hears `mg.fundhub.ai`.
- Bare `FUNDHUB_TEST_INBOX` = live file `9af65808-…`. Exact From match. Reply not sent.
- `message.inbound` 0. Inbound messages 0.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u2/`

## U3 findings

**BROKEN.** Claim: a client can stop email.

- Journey: **MISSING.**
- 173 templates say “Unsubscribe.” **0** have a link. Last 20 sent bodies have no URL. `/api/unsubscribe` **404**.
- Email STOP does not write `opt_outs` (SMS only). Mailgun `unsubscribed` is ignored.
- `opt_outs` = **0**. Did not click. Did not email STOP. Did not text.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u3/`

## U12 findings

- Journey: owner can **open** Hiring. Hire / Reject write step **MISSING.**
- Chris’s claim: **BROKEN.** Drawer is read-only. No Hire / Reject write API.
- **3 / 3** candidates are demo (`DEMO…`, `demo.fundhub.local`). Board hides them (demo mode off).
- Opened DEMO Applied drawer. Text: “Nothing in this panel can be changed.” Only button is close.
- `POST` all six `/api/hiring/*` → **405**. `hiring_decisions` still **0**.
- Did not press Hire or Reject. Did not email. Did not reset a password.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u12/REPORT.md`

## WAVE E stop

[Wave E](d8650483-d2d1-4831-91e0-6267dd4e9032) done. U11 **PASS** (MOVE). U12 **BROKEN** (no Hire/Reject write). No app edits.

## U9 findings

- Journey: **MISSING.** No intended funnel journey.
- Chris’s claim: **PARTIAL.** Past step 1 is proven. Extra fields show and do not ask for a Social Security number. Finishing every extra question is **UNVERIFIED**.
- `/watch` **200**. `/apply` **200**. Step 1: name, email, phone. Fake `e2e+aff-u9-*@` only.
- `(555) 010-0199` → “Phone Number has an invalid country code.” Example `201-555-0123` then Next → **Set Your Target Amount** (5 amount choices). Header still says STEP 1 OF 2.
- No SSN on the extra card. Did not type one. Did not book. Did not pay.
- Clients written (left): `4ab123c6-…` (u9c), `f500ddf3-…` (u9d), `channel_source=clickfunnels`. `survey.submitted` 0. `entry.captured` e2e rows have `client_id` null.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u9/REPORT.md`

## U13 findings

**UNVERIFIED — cannot send.** Claim: a text arrives on the test phone.

- Journey: **MISSING.**
- TEST `8556bedc-…` has no phone. Messaging has no To box. Did not patch. Did not press Send.
- `FUNDHUB_TEST_PHONE` equals the live file’s phone. Do not text the live file.
- Two old TEST SMS: failed, “no phone.” Three 2026-08-16 rows to that number are on the live file (`sent`). Not device proof.
- Twilio auth token names unset. A2P not asked.
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u13/`

## WAVE B stop

[Wave B](75998b17-21bf-4a5e-bb6b-0fab202ee710) done. U2 **BROKEN / not sent**. U3 **BROKEN**. U13 **UNVERIFIED — cannot send**. Same inbox/phone. No app edits. Did not text. Did not reply from the bare inbox.

## U10 findings

- Journey: **MISSING.** No intended funnel / book-call journey.
- Chris’s claim: **UNVERIFIED.** Slots show. Did not book — host is Chris Stanbridge.
- `/funding-book-call` **200**. Live times today 3:30–9:00 PM MST. Google Meet. Not Cal.com.
- Confirm shown after 3:30 PM pick. Confirm not pressed.
- Counts: `booking.created` **26** ClickFunnels, **0** Cal.com. No `bookings` table. `CALCOM_WEBHOOK_SECRET` missing. Strategy tasks **15**, 0 future.
- Owner Calendar Aug 18 still **“Nothing booked.”**
- Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u10/REPORT.md`

## WAVE D stop

[Wave D](4efd172b-9767-483c-b8c3-e6170be47d72) done. U9 **PARTIAL**. U10 **UNVERIFIED** (did not book Chris’s calendar). No app edits. No deploy. No commits.

## Left out on purpose

- Live credit file `9af65808-…` — owner law. No prompt.
- Doors already proven broken (pay-link create, unlock map empty, Editor ≠ Bland, Content Admin bounce, welcome video missing). Do not re-audit unless Chris names them.
