# Agent tester — Setter Josh (AG-04) — 2026-08-26

**Door:** `fundhub-agent-tester`. Roleplay + prompt fulfillment. Not a desk audit.  
**Overall: FAIL**

Two AIs talked. One used the live Agent Editor script. One played the client.
No live Bland call. No card charge. No live credit pull. No paper mail.
Chris was not asked to listen.

## Who

| | |
|---|---|
| Agent | `AG-04` Setter Josh |
| Status / runtime | live / bland / voice |
| Prompt source | **ag-04** (Agent Editor row). 169 letters. |
| Vendor Josh script | 3,750 letters on disk. **Not used.** Production treats this 169-letter row as ready, so Bland gets the stub. |
| Intended file | `docs/journeys/client-intended.md` |
| Sim | `stanbridgejchris+sim-agent-tester-josh-20260826@gmail.com` |
| Phone | `+16616054248` |

Live script, word for word:

> You are a Fundhub voice agent. Keep it short. If voicemail, leave a brief polite message confirming we called, then end. Never mention credit scores or approval amounts.

## Ordered events from the intended file

Copied from `docs/journeys/client-intended.md`. Not from memory.

1. Client arrives
2. Signed in?
3. Recognised as client?
4. Should reach: signing in and out, consent, contracts, documents, finance, reading data, everything else, incoming webhooks

That file is a **route list**. It has **no talk sequence** for Josh. So journey-sequence is **UNVERIFIED**. Overall cannot be PASS.

## Talk (full sequence, not one hello)

Model path: `src/agents/model.mjs` `callModel`. OpenAI had no credits. Talk ran on Anthropic with the **live 169-letter** system prompt. Bland did not ring.

| Turn | Event (from intended) | Agent said (short) | Prompt required | Prompt | Sequence |
|---|---|---|---|---|---|
| 1 | none in intended | “Hello, this is Sarah calling from Fundhub…” | Keep it short. No credit score / approval $. | **PASS** | **UNVERIFIED** |
| 2 | none in intended | Asks if they have a minute to chat about funding | Same | **PASS** | **UNVERIFIED** |
| 3 | none in intended | Offers funding for expansion / equipment / capital; asks business type | Same | **PASS** | **UNVERIFIED** |
| 4 | none in intended | “You may have a strategy session… what type of business?” | Same | **PASS** | **UNVERIFIED** |
| 5 | none in intended | “Thursday at 2 works… we’ll talk then.” | Same | **PASS** | **UNVERIFIED** |
| 6 | none in intended | “Have a great day, Josh. Bye!” | Same | **PASS** | **UNVERIFIED** |

Client answered (not voicemail). Voicemail half of the live script was not in play.

Did not say a credit score or an approval dollar. That guardrail held.

## Did the sequence match the intended journey?

**UNVERIFIED** — `client-intended.md` has no Josh talk order.

## What the live script did *not* do

The live row is not the Josh setter job. The agent:

- Called itself **Sarah**, not Josh
- Did not confirm “is this SimJosh?”
- Did not say credit is pulled **on** the Advisor call
- Did not confirm $150,000 / equipment / hire two people
- Did not ask them to be at a computer

Those beats live in the unused vendor script (`vendor/inquiry-remover/src/agents/setter-prompt.js`). They are **not** in Agent Editor.

## Score

| Check | Result |
|---|---|
| Did the agent do what the **live** prompt said? | **PASS** (short; no score / approval $) |
| Did events fire in **intended** order? | **UNVERIFIED** |
| Overall | **FAIL** |
| A live 8s / 0.1s Bland call as “call sequence” | not run (would be FAIL) |

## Left undone

- Did not roleplay Inquiry Removal (`AG-09`) or doc-chase
- Did not place a live phone call
- Did not write a talk sequence into `client-intended.md` (agents do not edit intended)
- After a named fix: run this roleplay **twice**. This was the first run, not a fix retest.
