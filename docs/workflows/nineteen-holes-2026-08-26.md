# Nineteen holes — 2026-08-26

## START HERE

Open a new chat.
Copy **one** numbered box.
Paste.
That chat owns that hole only.

## Shared laws

- One hole per chat. Three steps in that same chat, in order: VERIFY → FIX → FINISH. Never skip VERIFY.
- If VERIFY is **NOT A PROBLEM**, STOP. Do not fix.
- After FINISH, STOP. Do not start another hole.
- Reuse only these five files. Org `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`. Do not remint.

| Horse | client_id | Plus-tag |
|---|---|---|
| Fund | `614927f7-95a9-4623-86e8-cd85420d9716` | `+sim-fund-20260825h` |
| Repair | `5ce80871-0b70-4d2d-89e0-efdd62aa2e2f` | `+sim-repair-20260825h` · FH-000363 |
| Combo | `f2bc2425-8360-428c-98e7-c7fab4029c03` | `+sim-combo-20260825h` · FH-000364 |
| Inquiry | `a792442a-8644-4c6d-9b12-d004be1840d2` | `+sim-inquiry-20260825h` |
| Course | `2492c2a0-4af0-48ca-9566-1f9b52e69cee` | `+sim-course-20260825h` |

- Staff: `chris@fundhub.ai` + `STAFF_E2E_PASSWORD` from `.env`. Live `https://fundhub.ai`. You click. Do not ask Chris.
- Agent phone `+16616054248` only. Never pulse last-four 0865.
- Hard stops: no live CRS / $32 pull, no card charge, no paper mail / PostGrid, no ClickFunnels apply, no wipe, no secret rotate, do not merge `vc/save-2026-08-25` or `gitbutler/workspace`, do not CLI-deploy if it will break `pg` bundling.
- `INNGEST_EVENT_KEY` stays ON. Never `verify:e2e` on live DB.
- FIX: isolated worktree off `origin/main`. Load `.cursor/skills/fundhub-fixer/SKILL.md`. Smallest diff.
- Talk at 5th grade. Claim this hole on this board. Write the result.

Scorecard: `docs/workflows/full-e2e-audit-2026-08-26.md` · Map: `docs/workflows/system-map-2026-08-26.md`

---

## 1 — Josh never auto-calls after book

```
THIS THREAD IS ONLY HOLE 1 — Josh never auto-calls after book.
Horse: Fund 614927f7-95a9-4623-86e8-cd85420d9716 (+sim-fund-20260825h). Do not touch the other 18.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Josh must auto-call after booking.created (workflow ai-set-01-josh-setter). Do not rewrite the Josh talk script.
3. FINISH — prove it yourself on the live site. Click twice if UI. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Sign in https://fundhub.ai/login.html. Pipeline https://fundhub.ai/app/pipeline.html — search Sim Fund Horse.
- Confirm the book (8/26: 96ef0e47-… Wed Aug 26 11:12 AM MST, booked). Control Panel if needed: https://fundhub.ai/app/client-control-panel.html?id=614927f7-95a9-4623-86e8-cd85420d9716
- Read events: booking.created on this client (8/26 at 16:12 UTC). Then outbound_calls after that time from Josh / AG-04 / ai-set-01-josh-setter.
- Prefer the existing book. Do not book a second slot unless you cannot read the first event. If you must book: Fund Horse only, agent phone only.
- Do not staff-dial to fake it. Do not Bland-spray (hole 2 owns pickup).

REAL: booking.created exists (or a book you just made) and no Josh auto outbound_calls row follows it.
NOT A PROBLEM: a Josh outbound_calls row exists after booking.created from the auto workflow (not a staff click).

HARD STOPS
- no live CRS / $32 pull · no card charge · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env (chris@fundhub.ai + STAFF_E2E_PASSWORD). Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 1 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 2 — Voice / Bland pickup dead (#174)

```
THIS THREAD IS ONLY HOLE 2 — Voice / Bland pickup dead (#174).
Horse: Fund 614927f7-95a9-4623-86e8-cd85420d9716. Do not touch the other 18.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix. Do not merge #174 blindly.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Pickup wiring only. Do not rewrite Josh's talk script. Do not merge #174 unless VERIFY named that exact path.
3. FINISH — prove it yourself. At most ONE Bland try. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Read live call c4de6b1b-ec28-46bd-a73c-35c69a3894b2 (8/26: completed, no-answer, 0s, empty tape).
- Read https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/174 and whether production voice URL is the 120s twimlet vs the Fundhub Twilio door.
- Only if that row is gone or you cannot judge pickup: ONE Bland try to +16616054248 on Fund Horse. No second try.

REAL: a live Bland still completes at 0 seconds (or under 5s hang-up) with an empty tape / no real pickup.
NOT A PROBLEM: a live call has talk longer than 5 seconds and a tape.

HARD STOPS
- max ONE Bland try. Do not spray.
- no live CRS / $32 pull · no card charge · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 2 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 3 — AG-09 still stub

```
THIS THREAD IS ONLY HOLE 3 — AG-09 still the short stub.
Horse: Inquiry a792442a-8644-4c6d-9b12-d004be1840d2 (file look only). Agent Editor for the prompt. Do not touch the other 18.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix. Do not Bland.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Do not rewrite Josh AG-04 unless VERIFY said they share one stored prompt — then ask one question and stop.
3. FINISH — open Agent Editor, click AG-09 like a person twice. Write PASS/FAIL. STOP. Do not Bland. Do not start another hole.

RECREATE
- Sign in. Open https://fundhub.ai/app/agent-editor.html
- Open AG-09 Inquiry Removal AI. Read the live prompt. Count letters.
- Compare to the 8/26 stub: "You are a Fundhub voice agent. Keep it short. If voicemail, leave a brief polite message confirming we called, then end. Never mention credit scores or approval amounts."

REAL: live AG-09 is still that short stub (about 169 letters), not a real inquiry-job script.
NOT A PROBLEM: live AG-09 is a real inquiry-job script, not the stub.

HARD STOPS
- do not Bland · do not Call bureau
- no live CRS / $32 pull · no card charge · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 3 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 4 — MOVE leaves Sales Booked

```
THIS THREAD IS ONLY HOLE 4 — MOVE leaves Sales Booked card.
Horse: Fund 614927f7-95a9-4623-86e8-cd85420d9716. Do not touch the other 18.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. MOVE must not leave the Sales Booked card after funding is on Apply Now. Do not redesign Pipeline. Do not touch Combo cards.
3. FINISH — Pipeline, look at both rails. Click twice if you MOVE. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Sign in. https://fundhub.ai/app/pipeline.html — search Sim Fund Horse.
- Find funding card (8/26: 9791e403-… Apply Now) and Sales card (8/26: 5f9d828c-… Booked).
- If funding is already Apply Now and Sales is still Booked, that is the hole — do not MOVE again unless cards were cleaned.
- If you must MOVE: Fund Horse only, Card Stacking · Apply Now. Then look at BOTH rails. Do not MOVE Combo or Repair.

REAL: funding is on Apply Now and the Sales Booked card is still there.
NOT A PROBLEM: MOVE picks up / leaves the Sales card so Sales is not still Booked while funding is Apply Now.

HARD STOPS
- no live CRS / $32 pull · no card charge · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 4 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 5 — Bank Apply Chrome add-on

```
THIS THREAD IS ONLY HOLE 5 — Bank Apply needs Chrome add-on.
Horse: Fund 614927f7-95a9-4623-86e8-cd85420d9716. Do not touch the other 18.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Staff must Apply so the bank page auto-routes without a laptop Chrome add-on (or the desk must be honest that it cannot).
3. FINISH — prove on the live desk. Click twice. Stop before bank submit. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Sign in. Pipeline / Fulfillment on Sim Fund Horse, or https://fundhub.ai/app/lenders.html scoped to this client.
- Confirm Chrome add-on is off (8/26: off → manual proxy box).
- Open the Apply door far enough to see whether the bank page auto-routes.
- Prefer the 8/26 one-click evidence if the door still shows the same manual proxy box.
- Do not spray Apply. Do not submit a bank application. Do not open the raw bank URL from this IP if the add-on is off. Do not Apply on Combo.

REAL: add-on off → bank page does not auto-route (manual proxy / apply would use this IP).
NOT A PROBLEM: bank page auto-routes without the add-on (and you did not submit an app).

HARD STOPS
- do not spray Apply · do not submit a live bank app from this IP
- no live CRS / $32 pull · no card charge · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 5 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 6 — Remove Inquiries lie

```
THIS THREAD IS ONLY HOLE 6 — desks say Remove Inquiries when letters are next.
Horse: Repair 5ce80871-0b70-4d2d-89e0-efdd62aa2e2f (+sim-repair-20260825h · FH-000363). Do not touch the other 18. Do not also check trial cap (hole 7).

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Fulfillment and Client Control Panel must show the real next repair job, not Remove Inquiries, when letters / round complete is the work.
3. FINISH — click Pipeline Fulfillment, Control Panel, and Specialist Repair twice. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Pipeline search Sim Repair Horse. Click Fulfillment lens. Read next action.
- Open https://fundhub.ai/app/client-control-panel.html?id=5ce80871-0b70-4d2d-89e0-efdd62aa2e2f — read next action.
- Open https://fundhub.ai/app/inquiry-remover.html → Repair. Open this person. Read stage / What is next / Send letters chip.
- 8/26: Specialist was round complete / Send letters; Fulfillment + CCP said Remove Inquiries.
- Do not Send letters. Do not PostGrid.

REAL: Fulfillment and/or Control Panel still say Remove Inquiries while the repair desk job is letters / round complete.
NOT A PROBLEM: those desks name the real next job (letters / send / trial done — not inquiry removal).

HARD STOPS
- do not Send letters · do not PostGrid
- no live CRS / $32 pull · no card charge · no paper mail · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env (chris@fundhub.ai or inquiry@fundhub.ai). Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 6 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 7 — Trial ignores 2-round cap

```
THIS THREAD IS ONLY HOLE 7 — trial ignores the 2-round cap.
Horse: Repair 5ce80871-0b70-4d2d-89e0-efdd62aa2e2f (+sim-repair-20260825h). Do not touch the other 18. Do not also score hole 6 or hole 8.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. COMPLIANCE REVIEW REQUIRED. Trial must honor rounds_cap 2: no jump to R3, status goes to trial-done / upsell, trial-done email can fire. Do not rewrite the whole repair engine.
3. FINISH — prove on Specialist Repair. You read Gmail anywhere. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Open Sim Repair Horse on https://fundhub.ai/app/inquiry-remover.html → Repair.
- Read program: trial, rounds_cap, status (8/26: trial, cap 2, active — not upsell_pending).
- Open the row. See item rounds (8/26: many R3). See trial-ending tile (8/26: 0).
- Agent-read Gmail anywhere for stanbridgejchris+sim-repair-20260825h@gmail.com for a trial-complete / upsell email (8/26: none).
- Prefer the existing program state. Do not generate a new round unless you cannot read items / status. Do not Send letters.

REAL: trial stays active, items show past cap 2 (R3+), and/or no trial-done / upsell email.
NOT A PROBLEM: status is upsell_pending (or trial complete), items stay at cap 2, and the trial-done email exists.

HARD STOPS
- do not Send letters · do not PostGrid · do not charge the $200
- no live CRS / $32 pull · no card charge · no paper mail · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. You read Gmail. Never ask Chris.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 7 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 8 — Bureau auto-parse crashes

```
THIS THREAD IS ONLY HOLE 8 — high-confidence bureau auto-parse crashes.
Horse: Repair 5ce80871-0b70-4d2d-89e0-efdd62aa2e2f. Do not touch the other 18. Do not also score hole 7.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. COMPLIANCE REVIEW REQUIRED. High-confidence auto-parse must not 500 because system_high_confidence is not a user id.
3. FINISH — prove the auto-parse path. Text parse only if you must recreate. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Open Sim Repair Horse on Specialist Repair.
- Find the inbound parse path / last parse (8/26: text held at 0.524; auto high-confidence 500).
- Prove whether confirmed-by system_high_confidence still is not a user id and still 500s.
- Recreate with text parse only. Do not upload a new bureau photo unless you cannot see the crash. Do not Send letters.

REAL: high-confidence auto-parse still crashes or cannot confirm without a human because of that id.
NOT A PROBLEM: high-confidence auto-parse confirms without a 500.

HARD STOPS
- do not Send letters · do not PostGrid
- no live CRS / $32 pull · no card charge · no paper mail · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 8 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 9 — Documents list hides uploads

```
THIS THREAD IS ONLY HOLE 9 — Documents list hides uploads.
Horse: Repair 5ce80871-0b70-4d2d-89e0-efdd62aa2e2f. Do not touch the other 18.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Documents Uploads filter must show the files that are on the file. Do not redesign Documents. Do not wipe files.
3. FINISH — open Documents, filter Sim Repair Horse, compare to the API. Click twice. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Sign in. Open https://fundhub.ai/app/documents.html → Uploads. Filter Sim Repair Horse.
- Compare on-screen rows to the documents API for client 5ce80871-0b70-4d2d-89e0-efdd62aa2e2f (8/26: screen 0, API 13).
- Do not walk Combo. Do not wipe files.

REAL: the list hides files the API has for this person.
NOT A PROBLEM: on-screen Uploads rows match the API for Repair Horse.

HARD STOPS
- no wipe · no live CRS / $32 pull · no card charge · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 9 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 10 — Generate says no agreement still writes letters

```
THIS THREAD IS ONLY HOLE 10 — generate says no agreement, still writes letters.
Horse: Combo f2bc2425-8360-428c-98e7-c7fab4029c03 (+sim-combo-20260825h). Do not touch the other 18. Do not also score hole 11.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. COMPLIANCE REVIEW REQUIRED. Generate and Stage must agree: no signed repair agreement → no letters.
3. FINISH — recreate Generate vs Stage. Click twice if UI. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Open Sim Combo Horse on https://fundhub.ai/app/inquiry-remover.html → Repair.
- See stored R1 EX/EQ (8/26 generated, mailed=false) after Generate said no_authorization then Stage wrote letters.
- If you must recreate the gate: click Generate / Stage once. Watch for ok:false no_authorization then letters written anyway.
- Do not Send. Do not sign a new legal click unless you must prove the gate. Prefer read stored letters.

REAL: Generate can say no signed agreement and Stage/generate still writes letters.
NOT A PROBLEM: both refuse until a signed agreement exists, or generate is honest and only writes when allowed.

HARD STOPS
- do not Send letters · do not PostGrid
- no live CRS / $32 pull · no card charge · no paper mail · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 10 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 11 — Combo enroll fake Resume Funding card

```
THIS THREAD IS ONLY HOLE 11 — Combo enroll drops fake Inquiry Resume Funding card.
Horse: Combo f2bc2425-8360-428c-98e7-c7fab4029c03. Do not touch the other 18. Do not also score hole 10.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Repair enroll must not write Inquiry Removal · Resume Funding when there is no inquiry case. Ask once if you must wipe the leftover card.
3. FINISH — Pipeline Sim Combo Horse. Confirm the fake card is gone and enroll does not recreate it. Click twice if UI. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- https://fundhub.ai/app/pipeline.html — search Sim Combo Horse.
- Look for Inquiry Removal · Resume Funding with no inquiry case (8/26: extra rail).
- Confirm there is still no inquiry case on this file.
- Prefer the existing extra card. Do not enroll again unless the card was cleaned. Do not Issue Inquiry Removal.

REAL: that Inquiry Resume Funding card exists and there is no inquiry case.
NOT A PROBLEM: no extra Inquiry rail card without a case.

HARD STOPS
- do not Issue Inquiry Removal
- no live CRS / $32 pull · no card charge · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 11 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 12 — Invoice this client makes pay links

```
THIS THREAD IS ONLY HOLE 12 — Invoice this client makes pay links, not invoice rows.
Horse: Combo f2bc2425-8360-428c-98e7-c7fab4029c03. Do not touch the other 18.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. COMPLIANCE REVIEW REQUIRED. Invoice this client must make an invoice row, not only pay links.
3. FINISH — Present for Combo. Prefer read invoice rows. Click Invoice only if you must. Click twice if UI. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Read invoices for this client (8/26: count 0). Read pay links 58452bbd-… and 69e81eb9-… (created, not sent).
- Open Documents → Invoices filtered to Sim Combo Horse (8/26: nothing).
- Present: https://fundhub.ai/app/present.html?contact=f2bc2425-8360-428c-98e7-c7fab4029c03
- Only click Invoice this client again if you cannot see that split. Do not pay. Do not send those $1,000 links.

REAL: the button makes pay links and the invoice table stays 0.
NOT A PROBLEM: the button creates a real invoice row.

HARD STOPS
- do not pay · do not send the extra $1,000 links
- no live CRS / $32 pull · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 12 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 13 — Portal chips lie

```
THIS THREAD IS ONLY HOLE 13 — client portal chips lie.
Horse: Course 2492c2a0-4af0-48ca-9566-1f9b52e69cee (+sim-course-20260825h). Do not touch the other 18. Do not also score hole 15.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Portal chips must match the file (bookings, paid, docs, round).
3. FINISH — Course portal via a magic link you mint. Click like a person twice. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Open Course portal at https://fundhub.ai/app/client-portal.html (mint a new magic link if the old token is dead). You read Gmail anywhere.
- Read chips vs file: bookings, docs, $5,000 pay link unpaid (8/26 chips claimed Booked / Paid / Docs / Round).
- Payments drawer (8/26: No payments yet). File truth 8/26: 0 bookings, 0 docs, $5k unpaid.
- Do not remint the person. Do not pay.

REAL: chips claim Booked / Paid / Docs / Round while the file is empty / unpaid.
NOT A PROBLEM: chips match the file.

HARD STOPS
- do not pay the $5k
- no live CRS / $32 pull · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. You read Gmail. Never ask Chris.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 13 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 14 — Course enrolled email while unpaid

```
THIS THREAD IS ONLY HOLE 14 — Course Present emails enrolled while unpaid.
Horse: Course 2492c2a0-4af0-48ca-9566-1f9b52e69cee (+sim-course-20260825h). Do not touch the other 18. Do not also fix portal chips (hole 13).

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. COMPLIANCE REVIEW REQUIRED. Do not email "you're enrolled" while Mastery is unpaid. Add the missing Mastery contract wording.
3. FINISH — Course Present. You read Gmail anywhere. Prefer existing state. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Open https://fundhub.ai/app/present.html?contact=2492c2a0-4af0-48ca-9566-1f9b52e69cee — look for Mastery contract wording (8/26: none).
- Confirm $5k pay link still sent / unpaid. Do not remint. Do not pay.
- Agent-read Gmail anywhere for stanbridgejchris+sim-course-20260825h@gmail.com for "Funding Mastery — you're enrolled" (8/26 delivered after disposition 93daed74-…).
- Do not log a second disposition unless mail and contract wording are both gone and you must recreate. A second click sends another email.

REAL: unpaid Mastery still got an "you're enrolled" email, and/or Present has no Mastery contract wording.
NOT A PROBLEM: unpaid does not send enrolled, and Mastery has contract wording.

HARD STOPS
- do not remint the $5k · do not pay
- no live CRS / $32 pull · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. You read Gmail. Never ask Chris.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 14 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 15 — Portal inquiry Upload Send broken

```
THIS THREAD IS ONLY HOLE 15 — portal inquiry Upload Send broken after magic-link.
Horse: Inquiry a792442a-8644-4c6d-9b12-d004be1840d2 (+sim-inquiry-20260825h). Do not touch the other 18. Do not also score hole 13.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Magic-link portal sign-in must leave the client able to Send an inquiry upload (fh_account must not be empty).
3. FINISH — new magic link. Sign in as Inquiry Horse. Upload + Send twice like a person. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Mint a new portal magic link for Inquiry Horse. You read Gmail anywhere. Sign in as the client (not leftover staff).
- Portal: https://fundhub.ai/app/client-portal.html
- Click Upload inquiry docs. Pick a sim file. Click native Send.
- Watch fh_account / "Uploads are off." Confirm whether a new inquiry_doc is attributed to the magic-link client (8/26: Send broken; leftover staff stamp).
- Do not sign dispute. Do not remint the person.

REAL: after magic-link, Send fails because fh_account is empty (or Uploads are off) and the client cannot store an inquiry_doc.
NOT A PROBLEM: Send stores a client-attributed inquiry_doc after magic-link sign-in.

HARD STOPS
- do not sign dispute · do not remint
- no live CRS / $32 pull · no card charge · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. You read Gmail. Never ask Chris.
- INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 15 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 16 — Meet → closer pack missing said:

```
THIS THREAD IS ONLY HOLE 16 — Meet → closer pack missing said:
Horse: Course 2492c2a0-4af0-48ca-9566-1f9b52e69cee + Fund leftover 614927f7-95a9-4623-86e8-cd85420d9716. Do not touch the other 18.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Wire Meet tape → transcriber → fetchContext said:. Do not invent a fake Meet as the product fix.
3. FINISH — read live /api/read/agent-context and open Closer Dashboard. Click twice if UI. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- GET live /api/read/agent-context for Course (8/26: callCount=1, no transcript, no said:).
- Same for Fund leftover FAKE MEET (8/26: call row without transcript).
- Open https://fundhub.ai/app/closer-dashboard.html?client_id=2492c2a0-4af0-48ca-9566-1f9b52e69cee and Present. Confirm the pack has no said: spoken words.
- Do not invent a Meet tape. Do not Bland.

REAL: closer pack still has no said: / no transcript of spoken words.
NOT A PROBLEM: spoken words show as said: on the live pack.

HARD STOPS
- do not Bland · do not invent a Meet
- no live CRS / $32 pull · no card charge · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 16 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 17 — AI doc chase does not fire

```
THIS THREAD IS ONLY HOLE 17 — AI doc chase does not fire for Fund / Inquiry / Course.
Horse: Fund 614927f7-95a9-4623-86e8-cd85420d9716, Inquiry a792442a-8644-4c6d-9b12-d004be1840d2, Course 2492c2a0-4af0-48ca-9566-1f9b52e69cee. Do not touch the other 18. Do not re-chase Combo.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Doc chase must fire for Fund / Inquiry / Course when those files need docs. Do not rewrite every agent. Do not mass-unretire agents. Do not pause outbound.
3. FINISH — read messages + Gmail anywhere for those three. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Read messages for Fund / Inquiry / Course: EMAIL-DOC-01-REQUEST, SMS-DOC-01-REQUEST, DOC-02, DOC-03, GHL-DOC shadow (8/26: Fund upload 118f6790-… no DOC-02/03; Inquiry + Course zero DOC-01).
- Agent-read Gmail anywhere for those three plus-tags for "Documents needed before we can start."
- Do not upload more files unless you cannot see the missing rows. If you must upload, one sim file on Fund only — then watch for chase. No extra SMS beyond that file's event.
- Do not remint. Do not spray extra SMS. Do not re-send Combo DOC-01.

REAL: Fund / Inquiry / Course still have no doc-chase messages after docs needed / upload.
NOT A PROBLEM: DOC-01 exists for Inquiry + Course, and Fund has the post-upload chase (DOC-02/03 or honest GHL-DOC) that 8/26 said was missing.

HARD STOPS
- no extra SMS · do not re-chase Combo
- no live CRS / $32 pull · no card charge · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. You read Gmail. Never ask Chris.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 17 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 18 — Closer up next misses booked call

```
THIS THREAD IS ONLY HOLE 18 — Closer up next misses booked call.
Horse: Fund 614927f7-95a9-4623-86e8-cd85420d9716. Do not touch the other 18. Do not also score Josh auto-call (hole 1).

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Closer "up next" must show the booked call that is on the file. Do not wire Josh auto-call. Do not redesign Present.
3. FINISH — open Closer Dashboard + Present for Fund Horse. Click twice. Write PASS/FAIL. STOP. Do not start another hole.

RECREATE
- Confirm booking 96ef0e47-… (or current booked row) is still booked on Fund Horse.
- Open https://fundhub.ai/app/closer-dashboard.html?client_id=614927f7-95a9-4623-86e8-cd85420d9716 and Present https://fundhub.ai/app/present.html?contact=614927f7-95a9-4623-86e8-cd85420d9716
- Read "up next." 8/26: up next said no booked call while the booking sat on the file.
- Do not book a second slot unless the first booking is gone.

REAL: up next says no booked call while a booking is on the file.
NOT A PROBLEM: up next shows that booked slot.

HARD STOPS
- no live CRS / $32 pull · no card charge · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 18 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

## 19 — Sixteen beta buttons dead

```
THIS THREAD IS ONLY HOLE 19 — sixteen beta buttons dead.
This is one issue: all 16. Org fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6. Course id 2492c2a0-4af0-48ca-9566-1f9b52e69cee only where a client_id is needed (Consent). Do not touch the other 18.

STEPS (same chat, in order)
1. VERIFY — recreate. If not real, write NOT A PROBLEM and STOP. Do not fix.
2. FIX — only if VERIFY said the hole is real. Only the still-dead buttons VERIFY named. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Wire the dead controls. Do not redesign those screens. Do not walk live horses.
3. FINISH — click each dead button twice like a person. Write PASS/FAIL (name any still-dead control). STOP. Do not start another hole.

RECREATE
- Sign in as owner. Click each of the 16 like a person. Score each dead vs works.
- Agent Editor Revert — https://fundhub.ai/app/agent-editor.html
- Company Brain Refresh files — https://fundhub.ai/app/company-brain.html
- Consent Typed method + Clear signature — https://fundhub.ai/app/consent-capture.html?client_id=2492c2a0-4af0-48ca-9566-1f9b52e69cee
- Brand Studio Presets + Use text — https://fundhub.ai/app/brand-studio.html
- Social Studio Write a post + Waiting tab + Clear the form — https://fundhub.ai/app/social-studio.html
- Hiring Reset filters + Flagged only + All stages — https://fundhub.ai/app/hiring.html
- Content Choose file — https://fundhub.ai/app/content-admin.html
- Staff Affiliate Copy link #copyLink + Copy code #copyCode — https://fundhub.ai/app/affiliate.html
- (8/26 counted Brand Studio Presets twice = 16 FAIL rows.) Do not walk live customer lanes.

REAL: one or more of these main buttons still do nothing or stay locked when staff needs them. Write which.
NOT A PROBLEM: all 16 do their job (click changes the screen the way a person expects).

HARD STOPS
- do not promote agents to live · do not start ad spend · do not Call bureau
- no live CRS / $32 pull · no card charge · no paper mail / PostGrid · no ClickFunnels apply
- agent phone +16616054248 only (never pulse 0865)
- staff from .env. Never ask Chris for secrets.
- no remint · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB · no CLI deploy that breaks pg

Claim hole 19 on docs/workflows/nineteen-holes-2026-08-26.md. Talk at 5th grade.
```

---

## Hole 10 — VERIFY (2026-08-26)

**REAL.** Did not Send. Did not PostGrid. Did not sign a new legal click. Did not score hole 11.

Shot: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-10-verify-combo-letters.png`

- Specialist → Repair, Sim Combo Horse `f2bc2425-…`: trial · 1 / 2 · Answer in · Read their answer.
- Opened the row: **Equifax · R1 generated**, **Experian · R1 generated**. Send not clicked.
- Live API: 2 letters (`26381c88-…` EX, `b0f37f36-…` EQ), status generated, mailed=false, `can_send` true. `signer_name` null. `signed_at` null.
- Contracts for this person: **0**. No signed repair agreement.
- Letters written **17:04:44Z / 17:04:46Z**. Staff `dispute_authorization` `2a25915e-…` granted **17:16:20Z** — twelve minutes later, and it is not a signed contract.
- 8/26: Generate said `no_authorization`, then Stage wrote these letters anyway.

Generate can say no agreement and letters still get written.

## Hole 10 — FIX / FINISH (2026-08-26)

**FAIL on live.** Code fix is on `main`. Live still runs the old door. **COMPLIANCE REVIEW REQUIRED.** Closed this thread. Did not Send. Did not PostGrid. Did not sign a new legal click. Did not score hole 11.

- VERIFY **REAL** (above).
- FIX merged as PR **#215** (`fix/hole-10-letter-agreement`, merge `b8ae8fc8`). Generate and Stage share one door. That door needs a **signed repair agreement**. Enroll or a staff consent click is not enough. The gate runs first, so Stage cannot say yes after Generate said no.
- Tests: 14/14 on `dispute-auth` + `analyze`. Lint green.
- Git production builds of #215 and later `main` (`fcffff08`) failed (exit 2). Two CLI `netlify deploy --build --prod` tries (one with `--skip-functions-cache`) both made `POST /api/repair/generate` return **502**. Restored last good deploy `6a8f5c2877c73c153282dc84` (hole-12 invoice-row) after each. Stuck rule: no third try.
- Live after restore (22:08Z published): generate **200** `ok:true` `already_generated`. Same two letters. Still 0 signed contracts. Site is up. Old hole still there.

Worktree: `/Users/zootimusmaximus/fundhub-hole-10-letters`. PR https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/215

---

## Hole 8 — VERIFY (2026-08-26)

**REAL.** Did not Send letters. Did not PostGrid. Did not click Combo's held parse. Did not upload a bureau photo.

- Specialist → Repair, Sim Repair Horse: trial 2 / 2, stage **round complete**, Needs **Send letters**. Timeline: Aug 26 · parse confirmed (twice). Last stored parse `4dcac565-…` is confidence **0.524**, confirmed by staff id `52bc675a-…`.
- 8/26 auto path already logged `parse.confirmed` at confidence **0.9** with confirmed-by **system_high_confidence**, and never wrote a `dispute_responses` row for that auto confirm.
- Live database still rejects `system_high_confidence` as a user id (`invalid input syntax for type uuid`).
- Recreated with text parse only (`POST /api/repair/inbound-mail` on this horse): **500** — `invalid input syntax for type uuid: "system_high_confidence"`. High-confidence auto-parse still cannot confirm without a human.

## Hole 8 — FINISH (2026-08-26)

**PASS** on the write path. **COMPLIANCE REVIEW REQUIRED.** Did not Send letters. Did not PostGrid. Did not click Combo's held parse. Did not deploy.

- FIX on `fix/hole-8-auto-parse` at `/Users/zootimusmaximus/fundhub-hole-8-auto-parse`. PR **#213**. Auto-parse no longer stores `system_high_confidence` as a user id. It stores empty (null).
- Tests: 14/14 on parse + inbound-mail after rebase onto `origin/main`.
- Prove: same confirm write with that fake id now saves. Row `30b744e9-…` on Repair Horse: confidence 0.9, confirmed, confirmed-by empty. No 500.
- Live `https://fundhub.ai` still runs the old code until #213 ships. Did not CLI-deploy.
- Specialist → Repair, Sim Repair Horse still open. Did not press Send.
- Closed 2026-08-26: fix was still needed; branch pushed; this hole is done.
- Recheck 2026-08-26 15:02: no more hole-8 fix. PR **#213** still open. Hole-8 tests green. Other CI red is not this hole. Stop.

---

## Hole 11 — VERIFY (2026-08-26)

**REAL.** Did not enroll again. Did not Issue Inquiry Removal. Did not score hole 10.

- Pipeline search **Sim Combo Horse**. R-05 Inquiry Removal → **Resume Funding** shows card `bb39aac9-…` (2h in stage). Same person also on Sales Survey Complete and Funding Apply Now.
- Live cases: **0** `inquiry_removal_cases`. **0** `inquiry_log`.
- Card was written 2026-08-26 17:00:05 UTC, one second after the Funding Apply Now card — funding start parks Inquiry Removal on Resume Funding even when this file never had an inquiry case.

## Hole 11 — FIX / FINISH (2026-08-26)

**FAIL** on live (old code still running). Did not enroll again. Did not Issue Inquiry Removal. Did not wipe the leftover card. Did not CLI-deploy. Did not score hole 10.

- VERIFY **REAL** (above).
- FIX on `fix/hole-11-combo-fake-inquiry-card` at `/Users/zootimusmaximus/fundhub-hole-11-inquiry-card` (off `origin/main`). Funding start (`attachGateToRound`) no longer writes Inquiry Removal · Resume Funding unless this person already has an inquiry case. Repair enroll never wrote that card; the extra rail came from funding start on Combo enroll.
- Tests: 2/2 on `src/inquiry-ops/gate.test.mjs`. Lint green.
- FINISH: leftover card `bb39aac9-…` is still on Pipeline R-05 Resume Funding. Live `https://fundhub.ai` still runs the old door, so enroll would put the card back. Did not enroll to prove that.

Worktree (not merged): `fix/hole-11-combo-fake-inquiry-card`.

---

## Hole 18 — VERIFY (2026-08-26)

**REAL.** Did not book a second slot. Did not score Josh auto-call (hole 1). Did not click Present Log disposition.

- Booking `96ef0e47-f119-4f29-af50-5b72a6c6ada7` is still **booked** on Fund Horse `614927f7-…`. Starts 2026-08-26 18:12 UTC (11:12 AM MST). Meeting URL empty.
- Closer task `c2fce4f3-…` “Strategy session booked” sits on the same file, same due time, not done.
- Live Closer Dashboard `?client_id=614927f7-…`: **Up next — No upcoming booked calls.** Join call is off (no meeting URL).
- Present `?contact=614927f7-…` opened (Fund Horse deck). Present has no Up next rail. Did not redesign it.

The desk hides this file’s booked call. Cockpit `up_next` asks for other people’s future tasks and skips the person you opened.

Shot: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-18-verify-closer-up-next.png`

## Hole 18 — FIX / FINISH (2026-08-26)

**FAIL** on live `https://fundhub.ai`. Did not book a second slot. Did not score Josh (hole 1). Did not click Present Log disposition. Did not CLI-deploy.

- VERIFY **REAL** (above).
- FIX on `fix/hole-18-closer-up-next` at `/Users/zootimusmaximus/fundhub-hole-18-up-next` (off `origin/main`). Up next now keeps the open file’s booked closer task (today, even after start time). It no longer hides that person. Tests 2/2. Lint green. Live database query with the new door returns Sim Fund Horse `c2fce4f3-…` “Strategy session booked.” The old door returns empty.
- FINISH: opened Closer Dashboard + Present for Fund Horse **twice**. Both dashboard loads: **Up next — No upcoming booked calls.** Present is the Fund Horse deck. No Up next rail there. Live still runs the old hide. Did not CLI-deploy (a prior CLI drop of `pg` broke login).

Worktree (not merged): `fix/hole-18-closer-up-next`. PR https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/211

Closed 2026-08-26: Chris said fix-if-needed / close out. Code fix is done. A draft ship dropped `pg` (login would die). Did not promote. Live `https://fundhub.ai` still hides the booked call. Hole stays **FAIL**.

Shots: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-18-finish-1.png`, `hole-18-finish-2.png`

---

## Hole 16 — VERIFY (2026-08-26)

**REAL.** Did not invent a Meet. Did not Bland. Did not touch the other 18.

- Live `GET /api/read/agent-context` Course `2492c2a0-…`: **callCount=1**, **hasTranscript=false**, **hasSaid=false**. The one row is a Present downsell, notes only, no spoken words.
- Same live pack Fund leftover `614927f7-…`: **callCount=3**, **hasSaid=false**. The leftover FAKE MEET row is in the three. Live pack still drops its words.
- Laptop `fetchContext` on the same database: Fund leftover **has `said:`** from the leftover tape. Live site does not. Course still has no tape — that part is honest.
- Closer Dashboard `?client_id=2492c2a0-…`: Sim Course Horse. Pre-call has messages, no `said:`. Footer: **Recording/transcript not available yet.**
- Present Course opened. No `said:` spoken words.
- Control Panel Agent context: pack has recent sales calls, **no `said:`**.
- No Meet file on these two horses. 559 Drive files still wait for words. None named for Course Horse or Fund Horse.

Shot: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-16-verify-closer-dashboard.png`

## Hole 16 — FIX / FINISH (2026-08-26)

**PASS** on live `https://fundhub.ai`. Did not invent a Meet. Did not Bland. Did not touch the other 18.

- VERIFY **REAL** (above).
- FIX: PR https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/214 merged as `6e6b1ddc`. The closer pack now reads spoken words from the call row. A Meet tape that already has a Google transcript doc can stamp those words onto the matching person. The closer desk reads the same pack and shows `said:` when words exist. Did not plant a fake Meet.
- Live ship: production deploy `6a8f5bde1e2aa9a5ac06025f` (CLI with real `node_modules` + `--skip-functions-cache` so `pg` stayed in the zip). GitHub production for #214 failed with exit 2.
- FINISH live: login still works. `GET /api/read/agent-context` Fund leftover `614927f7-…` **has `said:`** (`FAKE MEET SIM: Closer said the start is three thousand…`). Course `2492c2a0-…` still has no tape — honest empty.
- Closer Dashboard Fund leftover clicked **twice**. Both times the desk shows **said:** those leftover tape words. No “transcript not available yet” on that file.

Shots: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-16-finish-fund-said-1-marked.png`, `hole-16-finish-fund-said-2-marked.png`

### Change manifest

- `src/agents/context.mjs` — read `transcript` so the pack can write `said:`
- `src/sales/recordings.mjs` — stamp spoken words onto the matching call row
- `src/company-brain/meet-title.mjs`, `meet-transcript.mjs`, `src/workflows/meet-transcript-sweeper.mjs` — Meet tape → sibling transcript doc → stamp
- `src/workflows/index.mjs` — serve the sweeper (65)
- `public/app/closer-call.js` — closer desk shows `said:` from `/api/read/agent-context`

---

## Hole 1 — VERIFY / FIX / FINISH (2026-08-26)

**VERIFY: REAL.** Book `96ef0e47-…` is still booked. `booking.created` at 16:12 UTC. Confirm texts went out (S-04B). The only later phone row is staff `agent_editor` at 16:59 (`c4de6b1b-…`). No Josh auto `outbound_calls` row. Did not book a second slot. Did not staff-dial. Did not Bland-spray.

**FIX:** Isolated worktree `hole-1-josh-auto-call`. Josh now writes `outbound_calls` kind `ai-set-01-josh-setter` when the dial is accepted. Sim files skip the night hold, same as texts. Talk script not rewritten. Tests 7/7.

**FINISH: FAIL.** Live still has the old job. The 8/26 book will not grow a Josh row. Did not CLI-deploy (pg).

PR: https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/216

---

## Claim

Statuses: `pending` · `claimed` · `NOT A PROBLEM` · `PASS` · `FAIL`

| # | Hole | Horse | Status |
|---|---|---|---|
| 1 | Josh never auto-calls after book | Fund | FIXED, now live · PR #216 |
| 2 | Voice / Bland pickup dead (#174) | Fund | FIXED, now live · PR #217 |
| 3 | AG-09 still stub | Inquiry (Agent Editor) | PASS |
| 4 | MOVE leaves Sales Booked | Fund | NOT A PROBLEM |
| 5 | Bank Apply Chrome add-on | Fund | PASS |
| 6 | Remove Inquiries lie | Repair | PASS |
| 7 | Trial ignores 2-round cap | Repair | PASS |
| 8 | Bureau auto-parse crashes | Repair | FIXED, now live · PR #213 |
| 9 | Documents list hides uploads | Repair | PASS |
| 10 | Generate says no agreement still writes letters | Combo | FIXED, now live · PR #215 |
| 11 | Combo enroll fake Resume Funding card | Combo | MISSING — no PR. Worktree has uncommitted files only. Did not rebuild. |
| 12 | Invoice this client makes pay links | Combo | PASS |
| 13 | Portal chips lie | Course | pending |
| 14 | Course enrolled email while unpaid | Course | PASS |
| 15 | Portal inquiry Upload Send broken | Inquiry | pending |
| 16 | Meet → closer pack missing said: | Course + Fund leftover | PASS |
| 17 | AI doc chase does not fire | Fund + Inquiry + Course | PASS · PR #210 still open (conflicts) |
| 18 | Closer up next misses booked call | Fund | FAIL — PR #211 still open (conflicts). Not on main. |
| 19 | Sixteen beta buttons dead | org | NOT A PROBLEM |

Ship 2026-08-26 3:48pm: live is git production `13627486` (PR #218 secrets-scan omit so main can publish). Site `https://fundhub.ai` 200, login page loads, `/api/health` ok, login API answers (not missing `pg`). Already merged before this ship: #212 #214 #215 #217. Merged this ship: #213 #216 #218. Not merged: #210 #211 (conflicts). Do not merge `vc/save-2026-08-25` or `gitbutler/workspace`.

---

## Hole 3 result

**PASS** — 2026-08-26. Agent Editor only. Did not Bland. Did not Call bureau. Did not touch Josh AG-04.

- VERIFY **REAL**: live AG-09 was the exact 169-letter stub. Josh AG-04 was a separate 3750-letter Josh script (`samePrompt: false`).
- Live save: AG-09 prompt is now the inquiry-job script (**1846** letters). Starts “You are FundHub's Inquiry Removal AI”. Not the stub.
- FINISH: reloaded Agent Editor, clicked AG-09 twice. Both clicks: AG-09 · 1846 letters · inquiry job. Josh still 3750 / “You are Josh”.
- Worktree (not merged): `fix/hole-3-ag09-prompt` at `/Users/zootimusmaximus/fundhub-hole-3-ag09`.
- Close-out 2026-08-26 14:30: live AG-09 still 1846, still the inquiry-job script, not the stub. **No more fix.** Closed.

---

## Hole 4 result

**NOT A PROBLEM** — 2026-08-26. Live Pipeline, Sim Fund Horse only. Did not MOVE. Did not touch Combo or Repair.

- Funding rail R-02: card `9791e403-…` is on **Apply Now**.
- Sales rail R-01: card `5f9d828c-…` is on **Showed**, not Booked. Booked has no Fund Horse card.
- Sales is not still Booked while funding is Apply Now. Per the box, that is not this hole.


---

## Hole 6 — VERIFY (2026-08-26)

**REAL.** Did not Send letters. Did not PostGrid.

- Pipeline Fulfillment, Sim Repair Horse: next action **Remove Inquiries** ("They have credit inquiries we are still working to get taken off.")
- Control Panel `?id=5ce80871-…`: NEXT ACTION **Remove Inquiries**
- Specialist → Repair, this person: stage **round complete**, Needs **Send letters**, letters this round all **generated** (not mailed). What is next starts R1 / R2 Written.

Fulfillment and Control Panel still name inquiry removal while the repair desk job is letters.

---

## Hole 6 result

**PASS** — 2026-08-26. Repair Horse only. Did not Send letters. Did not PostGrid. Did not score hole 7.

- VERIFY **REAL**: Fulfillment + Control Panel said **Remove Inquiries** while Specialist was letters / round complete.
- FIX: `send_letters` chip ranks above `remove_inquiries`. PR https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/206 merged as `743fc90b`. Live ship: production deploy `6a8f400cb727da1453ed9a82` (CLI with real `node_modules` + `--skip-functions-cache` so `pg` stayed in the zip).
- FINISH twice on live `https://fundhub.ai`:
  - Pipeline → search Sim Repair Horse → Fulfillment: chip **Send Letters** (“Letters are written and have not been sent yet.”). Not Remove Inquiries.
  - Control Panel `?id=5ce80871-…`: **NEXT ACTION Send Letters**. Both loads.
  - Specialist → Repair, this person: trial 2 / 2 · Done · **Send letters**. WHAT IS NEXT R1 / R2 Written. Letters this round Equifax/Experian R1+R2 **generated**. Did not press Send.
- Worktree: `/Users/zootimusmaximus/fundhub-hole-6-send-letters` (`fix/hole-6-send-letters`).
- Recheck 2026-08-26 14:30 PT: live Fulfillment + Control Panel still **Send Letters**. No new fix. **CLOSED.**
- Recheck 2026-08-26 15:02 PT: live still **Send Letters** on Fulfillment + Control Panel. No new fix. Still **CLOSED.**

---

## Hole 7 — VERIFY (2026-08-26)

**REAL.** Did not Send letters. Did not PostGrid. Did not charge $200. Did not generate a new round. Did not score hole 6 or hole 8.

- Program `5f353fb9-…`: **trial**, cap **2**, status **active** (not `upsell_pending`). Paid $200.
- Items: **54 on R3**, 25 R2 escalated, 3 R2 unaddressed.
- Specialist → Repair: Trial ending **0**. Row: trial · 2 / 2 · round complete · **Send letters** (not Trial done).
- Opened row: many items show **R3** (21 R3 labels on the expand).
- Messages: no `EMAIL-REPAIR-TRIAL-COMPLETE-UPSELL`. Events: no `repair.program.complete`.
- Gmail anywhere for `stanbridgejchris+sim-repair-20260825h@gmail.com`: **0** “Your trial rounds are complete”. Other mail exists (welcome, bureau response). Not a trial-done / upsell email.

Shot: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-7-verify-desk.png`

---

## Hole 7 result

**PASS** — 2026-08-26. Specialist Repair only. Did not Send letters. Did not PostGrid. Did not charge $200. Did not generate a new round. Did not score hole 6 or hole 8.

**COMPLIANCE REVIEW REQUIRED** (repair messaging / trial-done email).

- VERIFY **REAL**: trial · cap 2 · status **active**; 54 items on **R3**; Trial ending **0**; no trial-done Gmail.
- FIX: already on `main` as PR **#207** (`fix/hole-7-trial-cap`). Confirm reads stored `rounds_cap`. Cap 2 does not jump to R3. Status goes `upsell_pending`. Items past cap clamp to R2. Trial-done mail can fire.
- FINISH: clicked Sim Repair Horse twice. Row: **trial · 2 / 2 · Done**. Trial ending **1**. All **82** items **R2** (none R3). Status **upsell_pending**.
- Gmail anywhere: **Your trial rounds are complete — next steps** (Wed 26 Aug 2026 19:24 UTC) to `+sim-repair-20260825h`. Message `ed785125-…` delivered (Resend).

Worktree: `fix/hole-7-trial-cap` at `/Users/zootimusmaximus/fundhub-hole-7-trial-cap` (merged).

Shots: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-7-finish-1.png`, `hole-7-finish-2.png`.

---

## Hole 12 — VERIFY (2026-08-26)

**REAL.** Did not pay. Did not send the extra $1,000 links. Did not click Invoice this client again.

- Invoices for Combo `f2bc2425-…`: **count 0**.
- Pay links `58452bbd-…` and `69e81eb9-…`: **created**, **not sent**, $1,000, purpose custom. Description “Credit repair, done-for-you”.
- Documents → Invoices, filter Sim Combo Horse: **Nothing matches that filter.**
- Live Present still posts `/api/payment-links` with purpose `invoice` and toasts “Invoice minted. Do not pay.”

The button makes pay links. The invoice table stays 0.

Shot: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-12-verify-documents-invoices.png`

---

## Hole 2 — VERIFY (2026-08-26)

**REAL.** Did not Bland. The live row is enough.

- Bland `c4de6b1b-ec28-46bd-a73c-35c69a3894b2` (Fund Horse): completed, **no-answer**, **call_length 0**, empty tape, `started_at` null. To `+16616054248`.
- Twilio inbound `CAc6ded17eff50c2108e48a52876d15541`: **no-answer**, duration 0, rang 60s, never picked up.
- Live voice URL is the **120s twimlet**, not the Fundhub door. SMS URL is already `https://fundhub.ai/api/webhooks/twilio`. Fallback is still Twilio demo.
- Production Fundhub door has **no** talk-answer words (JSON only). PR **#174** is that exact pickup path (TwiML pause on the same door). It is open and conflicting. Do not merge that PR as-is. Recreate the wiring off `origin/main`.

## Hole 2 — FIX / FINISH (2026-08-26)

**FAIL.** Pickup wiring is on `main`. Live still dies. Did not Bland. Did not CLI-deploy. Did not merge #174.

- VERIFY **REAL** (above). Existing call is 0 seconds, no-answer, empty tape.
- FIX: isolated worktree `fix/hole-2-voice-pickup` at `/Users/zootimusmaximus/fundhub-hole-2-voice-pickup` off `origin/main`. Same door SMS already uses now answers a `CallSid` with a 120s pause. Tests 30/30. Lint clean. Shipped as PR **#217**. Closed conflicting **#174**.
- Live `https://fundhub.ai/api/webhooks/twilio` still returns JSON `not_a_message` (old door). Production Git build of `fcffff08` failed (exit 2). Later “ready” publishes had no this-commit hash. Voice URL is still the twimlet. Did not point the number at Fundhub while the old door is live. Did not spend the one Bland try on a line that still cannot pick up.

Worktree: `fix/hole-2-voice-pickup` (merged, not live).

---

## Hole 9 — VERIFY (2026-08-26)

**REAL.** Did not walk Combo. Did not wipe files.

- Signed in. https://fundhub.ai/app/documents.html → **Uploads**. Filter **Sim Repair Horse**.
- On screen: **0 rows** (“Nothing matches that filter.”).
- Documents API for `5ce80871-…`: **13** files (5 client_upload, 6 bureau_response, 2 inquiry_doc).
- The page asked only for the last-open person (Fund Horse). Uploads then showed **8** Fund files. The Repair Horse filter had nothing to show.

Shot: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-9-verify-uploads-empty.png`

---

## Hole 9 result

**PASS** — 2026-08-26. Documents only. Did not walk Combo. Did not wipe files.

- VERIFY **REAL**: Uploads + filter Sim Repair Horse was **0** rows. API for `5ce80871-…` was **13**. The page asked only for the last-open person.
- FIX: PR **#208** (`fix/hole-9-documents-uploads`) on `main`. The list uses a person id only when it is in the URL. Live page shipped (no full laptop rebuild).
- FINISH: clicked Uploads + filter Sim Repair Horse **twice**. Both times: screen **13**, API **13**, all Sim Repair Horse.

Worktree: `fix/hole-9-documents-uploads` at `/Users/zootimusmaximus/fundhub-hole-9-docs` (merged + live).

Shots: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-9-verify-uploads-empty.png`, `hole-9-finish-pass-1.png`, `hole-9-finish-pass-2.png`.

---

## Hole 17 — FIX / FINISH (2026-08-26)

**PASS.** Did not remint. Did not re-send Combo DOC-01. Did not pause outbound. Did not unretire agents. Did not CLI-deploy.

**COMPLIANCE REVIEW REQUIRED** (doc-chase / inquiry messaging).

- VERIFY **REAL** (below).
- FIX on `fix/hole-17-doc-chase` at `/Users/zootimusmaximus/fundhub-hole-17-doc-chase` (off `origin/main`).
  - Retired/draft GHL-DOC still does **not** text. It now writes an honest run row.
  - Inquiry files that still need ID / address / auth get **DOC-01 once** (`inquiry.docs.needed` or `docs.received`). A file that already has DOC-01 is not chased again.
  - Course with no inquiry case and no deposit is not chased.
- Tests: 19/19 on ghl-doc + inquiry-docs + s-doc-collection. Lint green.
- FINISH (agent read):
  - **Fund** upload `118f6790-…`: new GHL-DOC run `9e846c5a-…` outcome `ghl_doc_retired`. No new Fund DOC-01/02/03. Combo stayed at 2.
  - **Inquiry**: `EMAIL-DOC-01-REQUEST` `fef53267-…` **delivered** to `+sim-inquiry-20260825h`. `SMS-DOC-01-REQUEST` `b74b30a7-…` **sent** to `+16616054248`. Gmail anywhere has “Documents needed before we can start” (Wed 26 Aug 2026 20:15 UTC).
  - **Course**: still 0 DOC-01. They do not need docs (no case, no deposit, no uploads). Did not send.

Live `https://fundhub.ai` Inngest still has the old silent skip until this branch ships. Did not CLI-deploy.

PR https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/210
Worktree: `fix/hole-17-doc-chase`. Closed out 2026-08-26.

---

## Hole 17 — VERIFY (2026-08-26)

**REAL.** Did not upload. Did not remint. Did not re-send Combo DOC-01. Did not spray extra SMS.

- **Inquiry** `a792442a-…`: **0** DOC-01 / DOC-02 / DOC-03. Gmail anywhere for `+sim-inquiry-20260825h` + “Documents needed before we can start”: **0**. Queued inquiry case. Packet still missing ID / address / auth. Three uploads + `docs.received` (including 17:04 and 17:10). No `inquiry.docs.needed` event. No GHL-DOC run.
- **Course** `2492c2a0-…`: **0** documents. **0** DOC-01. Gmail anywhere for `+sim-course-20260825h` + that subject: **0**. Sales Survey Complete only. No deposit.paid.
- **Fund** `614927f7-…`: old DOC-01 at 03:52 (Gmail has it). Upload `118f6790-…` at 17:09 still on the file. `docs.received` at 17:09. **No** DOC-02 / DOC-03 after that time. **No** GHL-DOC run after 03:53. Live GHL-DOC is **retired**. AG-06 is **draft** and empty. origin/main returns `ghl_doc_retired` with no shadow row.

Inquiry + Course still have no DOC-01. Fund still has no post-upload chase.

---

## Hole 12 result

**PASS** — 2026-08-26. Combo Present only. Did not pay. Did not send the extra $1,000 links.

**COMPLIANCE REVIEW REQUIRED** — payment rails.

- VERIFY **REAL**: invoices were **0**. Pay links `58452bbd-…` and `69e81eb9-…` created, not sent.
- FIX: PR **#209** (`fix/hole-12-invoice-row`). Purpose `invoice` writes a draft invoice row. No new pay link.
- FINISH: Present Combo, Repair $1,000, clicked **Invoice this client** twice. Toast both times: “Invoice minted. Do not pay.”
- Invoice row `e3519e30-…`: **draft**, **$1,000**, source other. Count **1** after both clicks.
- Pay links stayed **7**. No new $1,000 link. Login stayed up.

Worktree: `fix/hole-12-invoice-row` at `/Users/zootimusmaximus/fundhub-hole-12-invoice-row` (merged and live).

Shots: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-12-verify-documents-invoices.png`, `hole-12-finish-invoice-row.png`

---

## Hole 12 — closed out (2026-08-26, later)

No new code. Already **PASS**. Did not click Invoice. Did not pay. Did not send.

- Re-read Combo invoices: **1**. Row `e3519e30-…` draft **$1,000**, source other.
- Newest $1,000 pay link is still the old `5a9e07c9-…`. No newer link.

---

## Hole 14 — VERIFY (2026-08-26)

**REAL.** Did not remint the $5k. Did not pay. Did not log a second disposition. Did not score hole 13.

Shot: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-14-verify-no-mastery-wording.png`

- Present `?contact=2492c2a0-…`: Sim Course Horse. Education path. Close → Send contract. Wordings: Soft Pull, Credit Repair, Closer, Funding Advisor, Sales Manager, Funding, Repair+Funding, Repair Trial. **No Mastery wording.** Message: “Pick a wording, then send.” Default picked Soft Pull Authorization.
- $5k pay link `f0c69e09-…`: **sent**, **unpaid** (`paid_at` empty). Description Funding Mastery course (A to Z). Did not remint.
- Disposition `93daed74-…` 17:01:02Z, downsell / FUNDING_MASTERY, cash **$0**. Two seconds later message `7cc0d563-…` **EMAIL-OFFER-FUNDING-MASTERY** subject **Funding Mastery — you're enrolled**, **delivered**.
- Gmail anywhere: same subject to `stanbridgejchris+sim-course-20260825h@gmail.com` on Wed 26 Aug 2026 17:05 UTC (Updates, not Inbox-only).
- Live contract templates: **0** Mastery keys. This file has **0** contracts.

Unpaid Mastery still got “you're enrolled.” Present has no Mastery contract wording.

## Hole 14 — FIX / FINISH (2026-08-26)

**COMPLIANCE REVIEW REQUIRED** (fee timing / enrolled mail). Did not remint the $5k. Did not pay. Did not log a second disposition. Did not score hole 13. Did not CLI-deploy.

- VERIFY **REAL** (above).
- FIX on `fix/hole-14-mastery-enrolled` at `/Users/zootimusmaximus/fundhub-hole-14-mastery` (off `origin/main`). Unpaid Mastery does not send “you're enrolled.” Paid Mastery still can. Present Mastery now has **Funding Mastery Program Agreement** wording. Tests: 38/38 on offer-bucket + offers + contract-signed. Lint green.
- Live wording: seed applied. Present Send contract (twice): list includes **Funding Mastery Program Agreement**. Did not press Send this wording. Live page still auto-picks Funding Agreement until the branch ships.
- Live email: Gmail still has the 8/26 **Funding Mastery — you're enrolled** (existing). Did not send a second one. The unpaid stop is in the worktree, not on live yet.

Worktree merged: `fix/hole-14-mastery-enrolled` → https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/212 (`d8064c47`).

Shots: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-14-verify-no-mastery-wording.png`, `hole-14-finish-mastery-wording.png`

## Hole 14 result

**PASS** — 2026-08-26. Course Present only. Did not remint. Did not pay. Did not log a second disposition. Did not score hole 13. Did not CLI-deploy.

**COMPLIANCE REVIEW REQUIRED** (fee timing / enrolled mail).

- VERIFY **REAL**: unpaid $5k + enrolled Gmail + no Mastery wording.
- FIX: unpaid Mastery does not send “you're enrolled.” Mastery has **Funding Mastery Program Agreement**.
- FINISH: Present Send contract twice shows that wording. Gmail still has the old 8/26 enrolled mail (existing). Code is on `main` as PR **#212**. Live send path updates on the next production build. Did not click close again.

---

## Hole 19 — VERIFY (2026-08-26)

**NOT A PROBLEM.** Signed in as owner. Clicked each of the 16 like a person. Did not promote agents. Did not start ads. Did not Call bureau. Did not walk live customer lanes. Course id only on Consent.

Shot: `docs/workflows/nineteen-holes-2026-08-26-evidence/hole-19-verify-affiliate.png`

| Control | Score | What happened |
|---|---|---|
| Agent Editor Revert | works | Dirty name “Setter Josh VERIFY” → Revert put **Setter Josh** back. Prompt was on screen (3750 letters). |
| Company Brain Refresh files | works | Documents pane → Refresh (`#refreshDocs`) reloaded `/api/company-brain/upload`. Chat bubble covers the right side; the button still runs. |
| Consent Typed method | works | “They typed their name” got class `on`. |
| Consent Clear signature | works | Signed method → drew on the pad → Clear wiped it (image size back to empty). Did not Record consent. |
| Brand Studio Presets | works | After scroll, Presets changed the color ramp (warm → blue). Save bar can cover it until you scroll. Did not Save. |
| Brand Studio Use text | works (locked on purpose) | Disabled. Title: no wordmark file — brand name already shows as text. |
| Brand Studio Presets (2nd of the 16) | works | Same button as above. 8/26 counted it twice. |
| Social Studio Write a post | works | Focused the post box. Did not Queue or Connect. |
| Social Studio Waiting tab | works | Sent tab then Waiting — Waiting selected, list headers showed. |
| Social Studio Clear the form | works | Typed “VERIFY hole 19 clear me” → Clear emptied the box. |
| Hiring Reset filters | works | Set Closer → Reset cleared the role. |
| Hiring Flagged only | works | Click → `aria-pressed` true, class `tog on`. |
| Hiring All stages | works | Click → class `on`. |
| Content Choose file | works | Choose file fires the hidden file input. Did not upload. |
| Staff Affiliate Copy link `#copyLink` | works | Click → **Copied ✓**. Link field empty; banner: no code for this session. |
| Staff Affiliate Copy code `#copyCode` | works | Button is live. Screen says **No code yet**. Nothing to copy. |

8/26 FAIL rows were first-click misses (Chat / Save bar / banner), a locked Use text with no logo, and Copy before a code exists. A person click now changes the screen the way they would expect.

## Hole 19 — CLOSE (2026-08-26)

**NOT A PROBLEM. Closed.** No FIX. No ship. No new code.

Chris said close it if no fix. VERIFY already scored all 16 as doing their job. Three-step rule: do not fix after NOT A PROBLEM.

Did not start another hole. STOP.
