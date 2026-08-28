# Last list — paste these — 2026-08-27

Open a new chat. Copy **one** numbered box. Paste. That chat owns that hole only.

Cap **5** chats at once. After PASS, paste the next box. Do not remint. Do not start a new audit.

Do **not** paste 8, 14, or 21.

**Skip in Claude Code:** 6 = #231 (open), 7 = #229+#232 (merged), 10 = #230 (open), 11 = #228 (open).

Claim on `docs/workflows/e2e-round-2026-08-27.md`.

Live `https://fundhub.ai`. Org `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`.  
Staff: `chris@fundhub.ai` + `STAFF_E2E_PASSWORD` from `.env`.  
Agent phone `+16616054248` only. No live CRS. No card charge. No paper. No CF apply.  
`INNGEST_EVENT_KEY` stays ON. Never `verify:e2e` on live DB.

| # | Hole |
|---|---|
| 6 | SKIP — PR #231 |
| 7 | SKIP — merged #229 + #232 |
| 9 | MOVE leaves two cards |
| 10 | SKIP — PR #230 |
| 11 | SKIP — PR #228 |
| 12 | Josh hangs up at 0 seconds |
| 13 | Doc chase dead after upload |
| 15 | Messaging hides the person |
| 16 | Present never asks start date |
| 17 | Inquiry portal hides upload |
| 18 | Closer misses Repair downsell |
| 19 | Repair welcome stuck queued |
| 20 | Partner Home / search miss |

---

## 6 — Education enroll never hits Sales

```
THIS THREAD IS ONLY HOLE 6 — Education enroll never hits Sales.
Reuse Sim Edu 27 55d04ebd-ac31-4150-a814-bea76935b5f9. Do not remint. Do not touch other holes.

STEPS (same chat, in order)
1. VERIFY — Pipeline Sales search Sim Edu 27. Confirm education_enrollments row f97fb0ca pending_payment and no Sales card / no entry.captured. If not real, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. /education/enroll/ must create a Sales card the same way the homepage does. Do not also fix phone +1.
3. FINISH — Pipeline Sales twice. Name on the board. Write PASS/FAIL. STOP.

REAL: enroll row exists, R-01 search is empty.
HARD STOPS: no live CRS · no card charge · no extra SMS · INNGEST_EVENT_KEY stays ON.

Claim hole 6 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```

## 7 — White-label apply sends no mail

```
THIS THREAD IS ONLY HOLE 7 — White-label gets no mail and no partner text.
Reuse partner ed962d4b-e373-444d-8e47-8a156446d5be. Do not remint. Do not also fix Pipeline R-08 (hole 3).

STEPS (same chat, in order)
1. VERIFY — Gmail anywhere for +sim-wl-e2e27-wlchat. Confirm 0 messages for this partner. If not real, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Live /affiliates/ White-Label apply must send the partner welcome email (and SMS to +16616054248 if the box is checked). Do not blast. Do not redesign Brand Studio.
3. FINISH — you read Gmail anywhere + messages row. Write PASS/FAIL. STOP.

REAL: form said you are in, Gmail 0, messages 0.
HARD STOPS: no live CRS · no card charge · agent phone only · INNGEST_EVENT_KEY stays ON.

Claim hole 7 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```

## 9 — MOVE leaves two cards

```
THIS THREAD IS ONLY HOLE 9 — MOVE leaves Sales and Funding both open.
Reuse Sim Fund Horse27 89f1a12f-f824-4451-9a53-5705b55374ca. Do not remint. Do not touch other holes.

STEPS (same chat, in order)
1. VERIFY — Pipeline Sales still Survey Complete and Funding Apply Now for the same person. If not real, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. MOVE to Funding Apply Now must leave one card. Do not redesign Pipeline.
3. FINISH — both rails twice. Write PASS/FAIL. STOP.

REAL: same person on Sales Survey Complete and Funding Apply Now.
HARD STOPS: no live CRS · no card charge · INNGEST_EVENT_KEY stays ON.

Claim hole 9 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```

## 10 — Wrong link opens empty

```
THIS THREAD IS ONLY HOLE 10 — Control Panel ?client= and Present ?id= do not open the file.
Reuse Sim Combo 27 ac1ac964-e02b-468b-9cbe-7030e03dd13b. Do not remint. Do not touch other holes.

STEPS (same chat, in order)
1. VERIFY — open client-control-panel.html?client=ac1ac964-e02b-468b-9cbe-7030e03dd13b and present.html?id=ac1ac964-e02b-468b-9cbe-7030e03dd13b. Recreate empty / “needs contact”. If not real, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. ?client= ?id= ?client_id= ?contact= must open the same file. Do not redesign Present.
3. FINISH — click both twice. Write PASS/FAIL. STOP.

REAL: ?id= works on CCP, ?client= does not. Present ?id= fails.
HARD STOPS: no live CRS · no card charge · INNGEST_EVENT_KEY stays ON.

Claim hole 10 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```

## 11 — Money engine says $0

```
THIS THREAD IS ONLY HOLE 11 — Underwrite money / fundable lie.
Reuse Sim Fund Horse27 89f1a12f-f824-4451-9a53-5705b55374ca (scores 718/724/731, fundable false, $0). Combo ac1ac964-e02b-468b-9cbe-7030e03dd13b is evidence only — do not also “fix Combo.”

STEPS (same chat, in order)
1. VERIFY — CCP + Present + live UnderwriteIQ for Fund Horse27. Recreate scores on file + not fundable + $0 / dash. If not real, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Screen money and fundable must match the planted file. Do not live-pull. Do not redesign Present.
3. FINISH — CCP + Present twice. Write PASS/FAIL. STOP.

REAL: scores sit on the page and the engine says not fundable / $0 / two opposite LLC lines.
HARD STOPS: no live CRS · no card charge · INNGEST_EVENT_KEY stays ON.

Claim hole 11 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```

## 12 — Josh hangs up at 0 seconds

```
THIS THREAD IS ONLY HOLE 12 — Josh / Bland hangs up at 0 seconds.
Reuse Sim Fund Horse27 89f1a12f-f824-4451-9a53-5705b55374ca. At most ONE Bland try to +16616054248. Do not touch other holes.

STEPS (same chat, in order)
1. VERIFY — read outbound call aefd5da8-6adc-4429-9dd9-57f12b53f07a (no-answer, 0s, empty tape). If a later Josh call has real talk, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Pickup / voice URL only. Do not rewrite Josh’s talk script. One Bland try max.
3. FINISH — call_length > 0 or a real tape, or write the exact vendor block. Write PASS/FAIL. STOP.

REAL: Bland no-answer, 0 seconds, empty tape.
HARD STOPS: agent phone only · no second Bland spray · no live CRS · INNGEST_EVENT_KEY stays ON.

Claim hole 12 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```

## 13 — Doc chase dead after upload

```
THIS THREAD IS ONLY HOLE 13 — Doc chase dead after upload.
Reuse Sim Fund Horse27 89f1a12f-f824-4451-9a53-5705b55374ca (docs row 3f65f4fe, docs.received, no DOC-02/03). Do not remint.

STEPS (same chat, in order)
1. VERIFY — messages after docs.received. If a real doc-chase SMS/email exists, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Upload must fire the live doc follow-up. Do not mass-unretire agents. Do not pause outbound.
3. FINISH — you read Gmail anywhere + messages. Write PASS/FAIL. STOP.

REAL: file uploaded, no DOC-02/03, GHL-DOC retired.
HARD STOPS: no extra blast · agent phone only · INNGEST_EVENT_KEY stays ON · never verify:e2e on live DB.

Claim hole 13 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```

## 15 — Messaging hides the person

```
THIS THREAD IS ONLY HOLE 15 — Messaging screen hides the person.
Reuse Sim Fund Horse27 89f1a12f-f824-4451-9a53-5705b55374ca (7+ messages in DB). Do not remint.

STEPS (same chat, in order)
1. VERIFY — Messaging search Sim Fund Horse27. Recreate miss while messages rows exist. If the name shows, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Messaging search must find the file that has messages. Do not redesign Messaging.
3. FINISH — search twice. Write PASS/FAIL. STOP.

REAL: messages exist, UI search does not show the card.
HARD STOPS: no extra SMS · INNGEST_EVENT_KEY stays ON.

Claim hole 15 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```

## 16 — Present never asks start date

```
THIS THREAD IS ONLY HOLE 16 — Present never asks incorporation date on multi-biz files.
Reuse Sim Fund Horse27 89f1a12f-f824-4451-9a53-5705b55374ca (3 companies, ages 24/48/79, dates empty). Do not remint.

STEPS (same chat, in order)
1. VERIFY — Present slides 1–12. Recreate no incorporation ask. If the ask is there, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Multi-biz / age-needed files must ask month/year. Do not live-pull. Do not redesign the whole deck.
3. FINISH — Present twice. Write PASS/FAIL. STOP.

REAL: three companies, empty dates, no ask.
HARD STOPS: no live CRS · no card charge · INNGEST_EVENT_KEY stays ON.

Claim hole 16 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```

## 17 — Inquiry portal hides upload

```
THIS THREAD IS ONLY HOLE 17 — Inquiry portal hides the upload door.
Reuse Sim Inquiry 27 40f063e1-27e3-4857-be1a-91640eee90e1. Magic link. Do not remint.

STEPS (same chat, in order)
1. VERIFY — portal as Sim Inquiry 27. Recreate 0 unlocked / inquiry upload hidden / “your call is next” with 0 bookings. If upload Send works, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Client must be able to Send an inquiry upload. Do not also fix Generate (hole 5).
3. FINISH — magic link, upload + Send twice. Write PASS/FAIL. STOP.

REAL: footer 0 unlocked, inquiry upload hidden.
HARD STOPS: no paper · no bureau phone · no live CRS · INNGEST_EVENT_KEY stays ON.

Claim hole 17 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```

## 18 — Closer misses Repair downsell

```
THIS THREAD IS ONLY HOLE 18 — Repair Present and Closer miss a downsell file.
Reuse Sim Repair 27 93b6bd19-54fe-4d1c-bdda-90ddfa57a140. Do not remint.

STEPS (same chat, in order)
1. VERIFY — present.html?client=93b6bd19-54fe-4d1c-bdda-90ddfa57a140 and Closer Dashboard. Recreate empty / needs contact / name missing. If both show the name, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Downsell Repair files must open on Present + Closer. Do not also fix hole 10 unless VERIFY says it is the same bug — then ask one question and stop.
3. FINISH — Present + Closer twice. Write PASS/FAIL. STOP.

REAL: Present needs ?contact=, Closer has no Repair 27.
HARD STOPS: no live CRS · no card charge · INNGEST_EVENT_KEY stays ON.

Claim hole 18 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```

## 19 — Repair welcome stuck queued

```
THIS THREAD IS ONLY HOLE 19 — Repair welcome email stuck queued and repair events missing.
Reuse Sim Repair 27 93b6bd19-54fe-4d1c-bdda-90ddfa57a140. Do not remint. Do not also fix Generate (hole 4).

STEPS (same chat, in order)
1. VERIFY — EMAIL-REPAIR-WELCOME still queued. Events table has no repair.enrolled. If mail delivered and events exist, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Enroll must send the welcome and write repair.enrolled. You read Gmail anywhere. Do not blast.
3. FINISH — Gmail + events. Write PASS/FAIL. STOP.

REAL: welcome queued, no repair.* events.
HARD STOPS: no extra SMS · no paper · INNGEST_EVENT_KEY stays ON.

Claim hole 19 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```

## 20 — Partner Home / search miss

```
THIS THREAD IS ONLY HOLE 20 — Partner Home and CRM search cannot find the partner.
Reuse partner ed962d4b-e373-444d-8e47-8a156446d5be. Do not also fix R-08 cards (hole 3) or mail (hole 7).

STEPS (same chat, in order)
1. VERIFY — Partner Home “No partners on file” while signed in as Sim Wlabel E2e27. Staff search name/company = 0. If both find them, write NOT A PROBLEM and STOP.
2. FIX — only this hole. Smallest diff. Isolated worktree off origin/main. Load .cursor/skills/fundhub-fixer/SKILL.md. Search and Partner Home must see the partner row. Do not redesign Galaxy.
3. FINISH — search + Partner Home twice. Write PASS/FAIL. STOP.

REAL: own partner row exists, Home says none, search 0.
HARD STOPS: no live CRS · no card charge · INNGEST_EVENT_KEY stays ON.

Claim hole 20 on docs/workflows/e2e-round-2026-08-27.md. Talk at 5th grade.
```
