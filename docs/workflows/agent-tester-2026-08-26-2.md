# Agent tester — Inquiry Removal AI (AG-09) — 2026-08-26

**Door:** `fundhub-agent-tester`. Roleplay + prompt fulfillment.  
**Overall: FAIL**

Did not fix Agent Editor. Did not load unused Josh / bureau vendor scripts.  
No live Bland call. No card charge. No live CRS. No paper mail.

## Who

| | |
|---|---|
| Agent | `AG-09` Inquiry Removal AI |
| Status / runtime | live / bland / voice |
| Prompt source | **ag-09** Agent Editor row. **169 letters.** Same stub as AG-04. |
| Intended file | `docs/journeys/role-inquiry-remover-intended.md` |
| Sim | Repair Horse plus-tag `+sim-repair-20260825h` |
| Phone | `+16616054248` |

Live script (same as Josh):

> You are a Fundhub voice agent. Keep it short. If voicemail, leave a brief polite message confirming we called, then end. Never mention credit scores or approval amounts.

That is a stub. Owner rule: stub = FAIL.

## Ordered events from the intended file

Copied from `role-inquiry-remover-intended.md`. That file is a **Specialist desk** path, not a talk script.

1. Specialist opens the desk
2. Toggle Inquiries or Repair
3. Queue / open a person
4. Send only when a letter is ready

**No talk order.** Sequence is **UNVERIFIED**. Overall cannot be PASS.

## Talk

Model path: `src/agents/model.mjs` `callModel`. Provider: OpenAI (live).  
Each turn came back **empty**. OpenAI 429 — no credits. Did not switch the product to another vendor. Did not invent lines.

| Turn | Event (from intended) | Agent said | Prompt required | Prompt | Sequence |
|---|---|---|---|---|---|
| 1 | Specialist opens the desk | *(empty)* | Keep it short. No score / approval $. | **FAIL** | **UNVERIFIED** |
| 2 | Toggle Inquiries or Repair | *(empty)* | Same | **FAIL** | **UNVERIFIED** |
| 3 | Person work on a case | *(empty)* | Same | **FAIL** | **UNVERIFIED** |

Did the sequence match the intended journey? **UNVERIFIED** — no talk list in intended, and the agent said nothing.

## Score

| Check | Result |
|---|---|
| Live prompt is a real job script | **FAIL** (169-letter stub) |
| Agent did what the live prompt said | **FAIL** (no words) |
| Events in intended talk order | **UNVERIFIED** |
| Overall | **FAIL** |
| Sub-5s Bland as talk | not placed (would be FAIL) |

## Left undone

- Did not place a live phone call
- Did not write a talk sequence into intended (agents do not edit that)
- AG-06 empty draft / GHL-DOC retired — not scored as live talk
