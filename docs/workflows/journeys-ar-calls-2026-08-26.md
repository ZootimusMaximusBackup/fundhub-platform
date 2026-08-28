# Journeys — AR / calls — 2026-08-26

**Lane:** AR / calls. Done. This file is **facts**. Not a fixer list.  
**Do not** retry Bland tonight (two tries, stuck rule). **Do not** merge PR #174. **Do not** change the live voice URL (back on the 120s twimlet).

---

## Talk

**FAIL.**

- Demo URL caused a **0.13s** hang-up.
- Real Fundhub Twilio door (PR #174) signed-probe **OK**.
- Live inbound rang **60s**, no pickup.
- Bland: **no-answer**, no talk length.
- A hang-up under 5 seconds is not a talk. Do not retry Bland tonight.

## Book sequence (live fire — not in intended files)

**Booked:** confirm + Josh + 24h + 2h + 15-min handoff.  
**No-answer:** now, +30m, +2h.

`docs/journeys/*-intended.md` does **not** name this order. There is **no** repair intended talk file. Sequence vs intended = **UNVERIFIED**. Do not invent steps into intended.

## Fund Horse

- **No** `booking.created`. Book sequence **never started**.
- Staff Josh went out anyway.
- **No** book texts.

## AR

- Two unpaid **success-fee** invoices.
- First notice **already sent**.
- Next notice **sleeps 7 days**.
- A new pay link was minted **unpaid**.
- **Present Invoice does not start AR.**
- FAIL left alone: no-answer texts 2 and 3 almost never leave (rebook treat).

## Repair

- Trial cap **2**. Full cap **6**.
- **R2 holds** on trial.
- **30-day** bureau wait after send.

---

Ingested into the overnight five-sim board: `docs/workflows/overnight-e2e-learn-2026-08-26.md`.
# Journeys / AR / call sequences — 2026-08-26

**Door:** prove + finish half-wired holes only.  
**Worktree:** `/Users/zootimusmaximus/fundhub-journeys-ar-calls` · branch `prove/journeys-ar-calls` off `origin/main`.  
**Did not** use `gitbutler/workspace` or `vc/save-2026-08-25`.  
**Did not** touch letters #170, aff drips, Oxylabs, B1–B4.

**COMPLIANCE REVIEW REQUIRED** — fee talk, repair rounds, voice.

**Evidence:** `docs/workflows/journeys-ar-calls-2026-08-26-evidence/`  
**Reuse:** Sim Fund Horse `614927f7-95a9-4623-86e8-cd85420d9716` · agent phone `+16616054248`.

No live CRS. No paper. No card charge.

---

## Ground truth (from files, not a desk glance)

### 1. Call order

`docs/journeys/client-intended.md`, `role-closer-intended.md`, and `role-funding-advisor-intended.md` are **route lists**. They do **not** name which agent calls, or what happens on no answer. There is **no** `*repair*-intended.md`.

The written order lives in `docs/workflows/comms-logic-2026-08-23.md` and the workflow files it cites. Closer playbook (`docs/company-resources/closer-playbook-2026-08-24.md`) is the **human** sales script. It says the setter is AI. It does not list Josh → reminder → handoff times.

**Correct order after they book** (`booking.created`):

| When | What | File |
|---|---|---|
| Right away | Confirm text `SMS-S04-01-CONFIRM` + confirm email `EMAIL-S04-01-CONFIRM` | `src/workflows/s-04b-booking-reminders.mjs` |
| Right away, or 11am Eastern if night | Josh (`AG-04`) robot call | `src/workflows/ai-set-01-josh-setter.mjs` |
| Right away | Funding pre-call emails only if a funding path is already set | `src/workflows/bs-01-precall-launcher.mjs` |
| 24h before the call | Remind text `SMS-S04-02-REMIND-24H` | s-04b |
| 2h before the call | Remind text `SMS-S04-03-REMIND-2H` | s-04b |
| 15 min before the call | Handoff text `SMS-AISET04-HANDOFF` + closer task | `src/workflows/ai-set-04-3way-handoff.mjs` |
| +72h after book, if stalled **and** already tagged as a client | DPC-05 email + SMS | `src/workflows/dpc-05-no-progress-escalation.mjs` |

**If Josh gets no answer** (`call.completed` with `no_answer` / `voicemail`):

| When | What | File |
|---|---|---|
| At once | `SMS-AISET03-MSG1` | `src/workflows/ai-set-03-no-answer-cadence.mjs` |
| +30 min | `SMS-AISET03-MSG2` unless they book **again** | same |
| +2h more | `SMS-AISET03-MSG3` unless they book **again** | same |

File comment says MSG2/MSG3 stop if they rebook **during** the wait. Code checks “does this person have **any** `booking.created`.” Josh’s people already do. So MSG2 and MSG3 almost never leave after a Josh miss. **FAIL** (step exists; it does not run as written). Did not add a new step. Intended journey files do not name this cadence.

**Not in that book sequence**

- Inquiry Removal AI (`AG-09`) — staff press on `/api/agent-call`, not `booking.created`.
- Bureau dials — `src/inquiry-ops/bureau-call.mjs`, staff, not this sequence.
- Closer human call — staff cockpit. Save can emit `call.completed` with disposition `closer` (does **not** start the no-answer texts).

### 2. Credit-repair escalation

No repair intended journey. Spec: `docs/workflows/repair-build-spec-2026-08-21.md` §2.2–2.3 and §5. Code:

- Engine rounds **R1–R6** (`src/metro2/rounds/state.mjs` `BUREAU_ROUNDS`).
- **Trial = 2 rounds.** `src/repair/enroll.mjs`: `roundsCap = program === "trial" ? 2 : 6`.
- **Full = 6.** Same file.
- **R2 holds on trial.** `nextRound("R2", 2)` is `null`. Open items at cap → `upsell_pending` + `repair.program.complete` (`src/metro2/rounds/program-cap.mjs`).
- Bureau wait copy is **30 days** (`src/metro2/letters/prompts.mjs`). Desk uses `response_due_at`.
- Verified item → next round or closed at cap (`applyItemOutcome`).
- Trial $200 / full $1,000 are **closer cash prices** (playbook). Engine stores `price_total` per enroll. Desk shows program + round, not dollars (`role-inquiry-remover-intended.md`).
- Paper mail only on a human **Send letters** click (`POST /api/repair/send` `mail: true`). Not run tonight.

### 3. AR workflows

| Step | In code? | Live? |
|---|---|---|
| Success-fee invoice mint | **Yes** — `f-07-funding-locked.mjs` after a funded round | Only that path writes `invoice.sent` for AR |
| Present “Invoice this client” | **Yes** — mints a **pay link** (`/api/payment-links` purpose `invoice`) | **Not** an `invoices` row. Does **not** start AR |
| First notice AR-01 email + SMS | **Yes** — `src/workflows/ar-collections.mjs` on `invoice.sent` if source is `funding_success_fee` or type `success_fee` | Wired. Sweeper already registered (`message-dispatch-sweeper`). Did not duplicate aff drips |
| Reminder AR-02 | **Yes** — same job, sleep **7 days**, then `EMAIL-AR-02` + `SMS-AR-02` | Sleeping. No extra `messages` row until day 7 |
| Final AR-03 | **Yes** — another 7 days | Same |
| AR-04 handoff | **Yes** — mark `escalated`, tag `ar:collections-handoff`. No staff task | Same |
| Stop on pay | **Yes** — cancel on `invoice.paid`; `payment.received` allocates | Real pay only. **No assume-paid** in invoices / pay-links |
| Repair / DIY invoice | Created by other jobs | AR chase **skips** them (`not_success_fee`) |

### 4. In code vs missing

| Missing | Finding |
|---|---|
| Customer-journey intended files | Route dumps only. Call order is not in `*-intended.md` |
| Repair intended journey | Absent |
| Assume-paid | Absent. Pay is webhook `markPaid` only |
| Staff “create invoices row” door | Absent. Present mints a pay link |
| Agent-line voice answer on Fundhub | **Was** Twilio demo, then a twimlet pause. SMS already hits `/api/webhooks/twilio`. Voice did not return TwiML there — JSON hang-up. This lane wires TwiML on that same door |

---

## Half-wired hole closed (this worktree)

Agent line `+16616054248`:

- SMS URL was already `https://fundhub.ai/api/webhooks/twilio`
- Voice URL was `demo.twilio.com` (0.13s hang-up), then a 120s **twimlet** (not in the repo)
- **Fix:** same Fundhub Twilio door now answers a `CallSid` with a 120s TwiML pause. Voice URL pointed at that door after deploy.

Did not add a new phone vendor. Did not rebuild B1–B4. Did not touch letters.

---

## Live prove (fill after walk)

| Path | Result | Evidence |
|---|---|---|
| Call order (book → Josh → no-answer texts) | | |
| Bland talk time > 5s | | |
| AR mint pay link / invoice (do not pay) | | |
| Next AR event (AR-02 queued or not-live) | | |
| Repair rounds cite | Confirmed in code. No paper. | this board |

---

## PRs

| PR | What | Merge? |
|---|---|---|
| (this branch) | Twilio voice answer on existing `/api/webhooks/twilio` | Open. Isolated. **Do not merge vc/save.** |
