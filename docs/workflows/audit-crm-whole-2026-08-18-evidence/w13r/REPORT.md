# W13R — Agent Editor vs Bland

Read-only. 2026-08-18. Did not Save. Did not Promote. Did not start a call.

Bland is the phone-robot company that places the calls.

Chris’s claim: Agent Editor should steer Bland the way Workflows shows the engine. **It does not.** They are not the same place.

## Answer first

**Not the same place.** Mix of two facts (not one bucket):

1. **Agent Editor does save** — it writes the `agents` table.
2. **Nothing that places a Bland call reads that table.** Working calls get their script from **files under `vendor/inquiry-remover`**, sent to Bland as a one-time `task` on each call.

It is **not** “Save does nothing.”  
It is **not** “the script lives only in Bland’s dashboard.” Bland’s own list of saved pathways is **empty**. Saved Bland web-agents is **empty**.

## Bland reads from

**Right now:** a JS file builds a `task` (the script). Vendor code posts it to Bland `POST /v1/calls`. Guardrails are words inside that same file, not the Editor’s guardrail box.

| Kind | Where |
|---|---|
| Setter Josh script | `vendor/inquiry-remover/src/agents/setter-prompt.js` |
| Bureau / inquiry script | `experian-prompt.js`, `equifax-prompt.js`, `transunion-prompt.js` |
| This site’s Bland adapter | `src/adapters/bland.mjs` — **listen only** (finished-call ping). Does not start a call. Does not read a prompt. |
| `agents` table prompt | **not read** by any Bland send path |
| Bland dashboard pathway / agent id | **none stored** on this key (GET count 0) |
| Env | `BLAND_API_KEY` is the login to Bland. It is not the script. |

This site cannot start those calls. `INQUIRY_API_BASE` is unset, so `/api/inquiry` says not configured. `src/` never calls `api.bland.ai`.

The calls that already happened (30 on this Bland key; newest 2026-08-16) have **no pathway id**. A later Josh-shaped call’s notes mention Josh / Fundhub. The Experian prove call’s notes mention Experian. Bland’s GET does **not** send the `task` text back, so the exact file words on those calls are **UNVERIFIED** from the GET body. The send code and the Aug 14–15 prove board say they used `buildSetterCallConfig` / Experian config.

## Agent Editor writes to

Save on `https://fundhub.ai/app/agent-editor.html` posts `POST /api/agents` with `action=save`.

Handler `api/agents.mjs` updates table **`agents`**: name, channel, class, owner, **prompt**, **guardrails**, `updated_at`.

Save does **not** write `runtime` or a Bland id.

**Proof Save works:** W6 clicked Save on draft **AG-01** today. Row `updated_at` moved to `2026-08-18T16:58:31.954Z`. HTTP 200. See `save-path-proof.json`.

**Not proven today:** a human Save on LIVE AG-04 / AG-09. Those two still have `updated_at` = `created_at` (2026-07-31). Did not click Save on them.

## Same?

**No.**

Editor → `agents.prompt`.  
Bland → vendor file `task`.

Change the Editor. Next real call still uses the file. Change the file. The Editor tile stays empty.

## 22 agents

| Code | Name | Status | Runtime | Who reads it | Can it fire today |
|---|---|---|---|---|---|
| AG-04 | Setter Josh | live | bland | Editor paint only. Bland send does not read this row. | Not from fundhub.ai. Yes if vendor/local one-shot runs — uses the **file**, not this empty row. |
| AG-09 | Inquiry Removal AI | live | bland | Same | Same (bureau **files**) |
| AG-01 | Agent 1 Lead Follow-up | draft | none | Editor. SMS robot would, if live + prompt | no |
| AG-02 | Agent 2 Billing | draft | none | Editor | no |
| AG-03 | Agent 3 Nurture | draft | none | Editor | no |
| AG-05 | Agent 5 Onboarding | draft | none | Editor | no |
| AG-06 | Document Check | draft | none | Editor | no |
| AG-07 | Recon | draft | none | Editor | no |
| AG-08 | Context Fetcher | draft | none | Editor | no |
| OP-01 | Heartbeat | draft | none | Editor. SMS robot skips ops | no |
| OP-02 | Fixer | draft | none | same | no |
| OP-03 | Daily Brief | draft | none | same | no |
| OP-04 | Compliance Gate | draft | none | same | no |
| OP-05 | Data + Models | draft | none | same | no |
| GHL-A1 | Lead Follow-up & Booking | retired | ghl | Editor (paints as draft). Picker rejects ghl | no |
| GHL-A2 | AR / Collections | retired | ghl | same | no |
| GHL-A3 | Non-Buyer & Nurture | retired | ghl | same | no |
| GHL-A4 | Backend Pre-Call | retired | ghl | same | no |
| GHL-A5 | Onboarding & Doc-Chasing | retired | ghl | same | no |
| GHL-A7 | Affiliate Re-engagement | retired | ghl | same | no |
| GHL-DOC | Document Check | retired | ghl | same | no |
| GHL-RECON | Recon | retired | ghl | same | no |

SMS/email robot = `src/agents/select.mjs` + `runtime.mjs`. It only wakes on `message.inbound`. That event count is still **0**.

## The two LIVE empty ones — Bland path

W13 asked the SMS picker. This pass asks the path Bland actually uses.

**If AG-04 / AG-09 “fire” as those table rows:** they do not. Bland’s send path never loads `agents` by code. Empty prompt on the tile is not sent. You do **not** get a silent empty-script call from this CRM.

**If someone runs the vendor / local Bland send (the path that already called Chris):** a call goes out. The robot speaks the **file** script (Josh file or bureau file). The empty LIVE tile is ignored. Inquiry cases on this database: **3**. Calls fired from those rows: **0**. Last Bland call on the key: **2026-08-16** (roleplay / test tags), not today.

## Intended vs actual

No intended journey file names Agent Editor. **MISSING ground truth.** Did not invent one. Scored Chris’s claim above: Editor does not steer Bland.

## Findings (short)

**1. Editor and Bland are split**  
Step: Save a prompt, then a Bland call.  
Expected: same script.  
Observed: Save → `agents`. Call → vendor file `task`.  
Evidence: `prompt-source-map.json`, `save-path-proof.json`, `bland-api.json`

**2. Bland dashboard is not the store**  
Step: GET saved pathways / agents.  
Expected: ids that match AG-04 / AG-09.  
Observed: 0 pathways, 0 Bland agents, 0 inbound numbers, 0 pathway ids on calls.  
Evidence: `bland-api.json`, `bland-stored-ids.json`

**3. LIVE badge is not the Bland control**  
Step: Open Agent Editor.  
Expected: LIVE Josh / Inquiry hold the live script.  
Observed: 0 prompt chars, 0 guardrail chars, never updated since seed. Footer: “2 running with no stored prompt/guardrails.”  
Evidence: `02-ag-04.png`, `db.json`

## Evidence paths

- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/REPORT.md`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/prompt-source-map.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/save-path-proof.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/agents-runtime.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/db.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/bland-api.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/bland-call-keys.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/bland-stored-ids.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/screen.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/01-list.png`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/02-ag-04.png`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r/03-ag-09.png`
- Prior Save proof: `docs/workflows/audit-crm-whole-2026-08-18-evidence/w6/agent-save.json`

Keys confirmed by name only: `BLAND_API_KEY`, `BLAND_WEBHOOK_SECRET`, `DATABASE_URL`. `INQUIRY_API_BASE` unset.

## Stop line

W13R stop. Findings only. Chris names what to fix.
