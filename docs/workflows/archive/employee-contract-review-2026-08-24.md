# Employee contract review — 2026-08-24

**Owner:** Chris  
**COMPLIANCE REVIEW REQUIRED** — employment / independent-contractor agreement + sales compensation / residual forfeiture language.

**Why this exists:** An agent created starter employment wording and emailed a closer agreement to Justice Nikkel **without Chris approving the text**. That sent contract is **void**. No more employment emails until Chris says **“send Justice contract.”**

---

## CALL OUT — now aligned to SIGNED Sarah Jul 9 2026

Ground truth is the **signed** Sales Manager agreement from Gmail (effective **2026-07-08**, certificate completed **July 9, 2026**), not File-Sweep unsigned drafts.

| Piece | Live Closer template now |
|-------|--------------------------|
| Structure / tone | Matches **SIGNED** Sarah SM §§1–9 (IC, confidentiality, IP, non-solicit, term, general) |
| Closer duties | Kept (booked calls, script, close, CRM, coaching, compliance) — not SM team-build duties |
| Pay model | Exhibit A / `{{field.comp_terms}}` — **Sarah’s SM $ rates (5% / 0.25% / 5% downsell) are not closer rates** |
| Refund clawback | §3.4 — same wording as Sarah’s clawback |
| **On exit (HARD)** | **§3.5** — leave → forfeit all recurring / residual / potential recurring (owner law; **not** in Sarah SM) |
| Client non-solicit | §7.2 — **Sarah’s broad form** (no 12-month / material-contact softening) |
| Term / law | §8.2 “for cause”; §9.1 Arizona only (Maricopa venue removed) |
| FA twin | Same alignment + §3.5 on `EMPLOYEE-FUNDING-ADVISOR-AGREEMENT` |

Full body:  
`docs/workflows/company-sim-2026-08-24-evidence/EMPLOYEE-CLOSER-AGREEMENT-FOR-REVIEW.md`

Signed PDF:  
`docs/workflows/company-sim-2026-08-24-evidence/sarah-sm-agreement-SIGNED-from-gmail.pdf`  
OCR: `sarah-sm-agreement-SIGNED-OCR.txt`

**Justice was not emailed.** Voided send stays void.

---

## Sarah reference (SIGNED — preferred)

| Field | Value |
|-------|--------|
| Who | Sarah Blankstein — Sales Manager |
| Signed PDF (Gmail) | `docs/workflows/company-sim-2026-08-24-evidence/sarah-sm-agreement-SIGNED-from-gmail.pdf` |
| Also | `credentials/sarah-sm-search-2026-08-24/gmail-19f44a4a-Fundhub_Sales_Manager_Agreement_Sarah_Blankstein.pdf` |
| Effective / signed | Face date **2026-07-08**; certificate **Jul 9 2026** (Ref `FC1DF6A2-0E4C-4DC7-B4DF-07269B7E1E69`) |
| OCR | `docs/workflows/company-sim-2026-08-24-evidence/sarah-sm-agreement-SIGNED-OCR.txt` |
| Older File-Sweep drafts | Same body terms as signed; use signed path going forward |

Closer / FA templates are now **rewritten from the SIGNED Sarah structure**, with closer/FA duties + Exhibit A pay + owner §3.5 residual forfeiture.

---

## Honest answer

| Question | Answer |
|----------|--------|
| Was the old stub Chris’s approved template? | **No.** Agent starter text. |
| Is live template now from SIGNED Sarah? | **Yes** (live DB updated 2026-08-24). Still **owner review** before send. |
| Does live body forfeit recurring on leave? | **Yes** — §3.5 + §8.3 (self-checked in DB). |
| Was Justice emailed again? | **No.** |

---

## What was sent / revoked (unchanged)

| Field | Value |
|-------|--------|
| Contract id | `e29f0a6b-16f5-4554-8476-4da38ea0e267` |
| Template key | `EMPLOYEE-CLOSER-AGREEMENT` |
| To | justice.nikkel@gmail.com |
| Staff | Justice Nikkel · `968bb01e-0079-4508-aded-8a361d54ecbb` |
| Status | **`void`** · signing link dead (409) |
| staff_id backfill | Linked on voided row for Staff & Teams list dry-check |

**Email already delivered; link is dead. Do not re-send until Chris says so.**

---

## Where signed agreements live (product)

| Layer | What |
|-------|------|
| DB | `contracts` row (status, `rendered_body`, hashes, `signed_at`, `staff_id`) |
| Durable file | `documents` + `document_versions` via `contracts.signed_document_id` (PDF built on sign) |
| **Not** git | Never commit signed PII / contracts to the repo |
| Dashboard door | **Staff & Teams** → open person → **ST-09 Employment agreements** → Open / Open signed |
| Also | **Documents** screen still watches client/contract files the same way |

New column: `contracts.staff_id` (migration `259_contracts_staff_id.sql`). Pass `staff_id` on `create_draft` when hiring so the signed copy shows on that person’s drawer.

---

## How to open templates in the UI

1. Sign in at https://fundhub.ai  
2. Admin → **Contract templates** → https://fundhub.ai/app/contracts.html  
3. Open **Closer Agreement** (`EMPLOYEE-CLOSER-AGREEMENT`), **Funding Advisor Agreement** (`EMPLOYEE-FUNDING-ADVISOR-AGREEMENT`), and **Sales Manager Agreement** (`EMPLOYEE-SALES-MANAGER-AGREEMENT`).

---

## Template A — Closer (live; SIGNED-Sarah-aligned + residual forfeiture)

- **DB id:** `f47da963-02cc-4ddd-bf54-77648a05c8a1`  
- **Key:** `EMPLOYEE-CLOSER-AGREEMENT`  
- **Name:** Closer Agreement  
- **Subtype:** `employment_agreement`  
- **Body length:** ~11.8k chars (full text in review companion file)  
- **Self-check:** §3.5 forfeiture + Sarah-style §7.2 + no Maricopa venue present in live DB

Full body for owner review:  
`docs/workflows/company-sim-2026-08-24-evidence/EMPLOYEE-CLOSER-AGREEMENT-FOR-REVIEW.md`

---

## Template B — Funding Advisor (live twin; never sent; same exit forfeiture)

- **DB id:** `257a85f7-b481-4708-aa17-8fc7823e023f`  
- **Key:** `EMPLOYEE-FUNDING-ADVISOR-AGREEMENT`  
- **Name:** Funding Advisor Agreement  
- **Body length:** ~11.6k chars  
- **Self-check:** same §3.5 forfeiture + Sarah-style §7.2 present in live DB

---


## Template C — Sales Manager (live; Sarah signed terms + Bostick place + residual forfeiture)

- **DB id:** `2b99f948-fad9-4622-a3e7-29226feb5b56`
- **Key:** `EMPLOYEE-SALES-MANAGER-AGREEMENT`
- **Name:** Sales Manager Agreement
- **Subtype:** `employment_agreement`
- **Place of business:** `218 Bostick Rd 64, Bowling Green, FL 33834` (not Hudson/home)
- **Comp:** Sarah signed schedule (§3.1 deposit 5%, §3.2 backend 0.25%, §3.3 downsell 5%)
- **Self-check:** §3.6 forfeiture of recurring/potential recurring on departure + §8.3 echo

## Sarah Blankstein — signed copy on file (CRM)

| Field | Value |
|-------|--------|
| Staff | Sarah Blankstein · `sarah.b@fundhub.ai` · `sales_manager` · `6ccdca88-60af-4b7e-af15-28259ead4786` |
| Contract | `73b06052-4e2f-4a08-802a-450ae1bd90a3` · status **signed** |
| Signed PDF | `documents` `44623069-2c04-4ec0-be22-d72b0517fba8` via `signed_document_id` |
| UI door | **Staff & Teams** → Sarah Blankstein → **ST-09 Employment agreements** → **Open signed** |
| Source | Gmail/Drive signed PDF (Document Ref FC1DF6A2-…) imported 2026-08-24 |

**EIN:** saved gitignored only as `credentials/fundhub-business.env` (`FUNDHUB_EIN`) — **not** in any contract body.

Closer / FA templates: place of business updated to the same Bostick address; residual forfeiture already present.

## Standing rules for agents

1. **Do not send** any employment / hire contract email until Chris says **“send Justice contract”** (or equivalent) after approving the template.  
2. Do not invent thin starter wording and treat it as live.  
3. Prefer the **SIGNED** Sarah PDF over File-Sweep drafts when aligning employment templates.  
4. On send/draft for a hire: set **`staff_id`** on the contract so Staff & Teams can open the signed copy later.  
5. Never commit signed agreements to git.

---

## Next (one action for Chris)

Read **§3.4 / §3.5 / §7.2 / §8.3** in the Closer review file (opened beside chat), then either **approve** or say **send Justice contract**.
