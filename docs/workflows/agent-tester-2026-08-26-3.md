# Agent tester — Setter Josh (AG-04) — 2026-08-26 (lane 2)

**Door:** `fundhub-agent-tester` inside Full e2e lane 2.  
**Overall: FAIL**

Two AIs talked on the **live** Agent Editor script. One Bland try to `+16616054248`. No second dial. No card charge. No live CRS. No paper mail. Chris was not asked to listen.

## Who

| | |
|---|---|
| Agent | `AG-04` Setter Josh |
| Status / runtime | live / bland / voice |
| Prompt source | **ag-04** (Agent Editor row). **3,750 letters.** Real Josh script (not the old 169 stub). |
| Intended file | `docs/journeys/client-intended.md` |
| Sim | Sim Fund Horse `614927f7-95a9-4623-86e8-cd85420d9716` · `+sim-fund-20260825h` |
| Phone | `+16616054248` |

Live script starts:

> You are Josh, an AI Setter for FundHub. TRIGGER: Lead just booked a Strategy Session. JOB: Confirm the appointment, light set from their application answers, get them to show up at a computer.

## Ordered events from the intended file

Copied from `docs/journeys/client-intended.md`. Not from memory.

1. Client arrives
2. Signed in?
3. Recognised as client?
4. Should reach: signing in and out, consent, contracts, documents, finance, reading data, everything else, incoming webhooks

That file is a **route list**. It has **no talk sequence** for Josh. Journey-sequence is **UNVERIFIED**. Overall cannot be PASS.

Live-fire talk order (system map, not intended): open/confirm → frame (credit pulled **on** the Advisor call) → light set from survey → show-up close. Used only to brief the client seat. Not scored as intended.

## Checklist before talk

- [x] Intended journey read
- [x] Ordered events copied from that file (verbatim)
- [x] Live prompt loaded (source **ag-04**, 3750)
- [x] Sim identity ready (plus-tag + agent phone only)
- [x] Client AI briefed on the event list only

Placeholders from the Fund Horse survey / booking only. Closer name empty — skipped. No invented credit or dollars.

## Talk (roleplay)

Model path: `src/agents/model.mjs` `callModel`. OpenAI 429 / no credits. Talk ran on Anthropic with the **live 3,750-letter** system prompt.

| Turn | Event (from intended) | Agent said (short) | Prompt required | Prompt | Sequence |
|---|---|---|---|---|---|
| 1 | none in intended | “Hey, is this Sim?” | Open / confirm name | **PASS** | **UNVERIFIED** |
| 2 | none | Josh, FundHub, booked Wed Aug 26 11:12 AM MST — time still work? | Confirm slot | **PASS** | **UNVERIFIED** |
| 3 | none | Credit pulled **on** the Advisor call, not yet. $100k–$200k for growth — still right? | Frame + light set | **PASS** | **UNVERIFIED** |
| 4 | none | Grow faster / more reach — still the main thing? | Light set why | **PASS** | **UNVERIFIED** |
| 5 | none | 2–5 years in business. Be at a computer. Anything stop you? | Show-up close | **PASS** | **UNVERIFIED** |
| 6 | none | “Awesome… See you Wednesday at 11:12.” | End allowed | **PASS** | **UNVERIFIED** |

Guardrails held: no pre-approval dollar, no “we already pulled credit,” no $3,000 pitch.

After the goodbye the model dumped an internal debrief. That is extra, not a prompt FAIL.

## Live Bland (one try)

`POST /api/agent-call` check: ready. Then **one** call. `callId` `c4de6b1b-ec28-46bd-a73c-35c69a3894b2`. To `+16616054248`.

Bland: **completed**, **no-answer**, **call_length 0**, empty transcript.

That is **FAIL** for call sequence (0 seconds). Did not spray a second try.

`booking.created` at 16:12 UTC did **not** write a Josh `outbound_calls` row. Staff check/call was the only dial after the book.

## Did the sequence match the intended journey?

**UNVERIFIED** — `client-intended.md` has no Josh talk order.

## Score

| Check | Result |
|---|---|
| Did the agent do what the **live** prompt said? | **PASS** (roleplay) |
| Did events fire in **intended** order? | **UNVERIFIED** |
| Live Bland talk >5s | **FAIL** (0s, no-answer) |
| Live-fire Josh after `booking.created` | **FAIL** (no auto dial) |
| Overall | **FAIL** |

## Left undone

- Intended talk order still missing (agents must not write `*-intended.md`)
- No second Bland try (owner: one if the line dies)
- Pickup / #174 still dead
