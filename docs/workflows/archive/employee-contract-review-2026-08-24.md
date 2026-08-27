# Employee contract review — 2026-08-24

**Owner:** Chris  
**COMPLIANCE REVIEW REQUIRED** — employment / independent-contractor agreement + sales compliance language.

**Why this exists:** An agent created starter employment wording and emailed a closer agreement to Justice Nikkel **without Chris approving the text**. That sent contract is **void**. No more employment emails until Chris says **“send Justice contract.”**

---

## Sarah reference (found)

| Field | Value |
|-------|--------|
| Who | Sarah Blankstein — Sales Manager |
| Local path (preferred) | `~/Documents/File-Sweep/Legal/Fundhub Sales Manager Agreement Sarah Blankstein-1.docx` |
| Also | `~/Documents/File-Sweep/Review/CLEAN-OUT/Fundhub Sales Manager Agreement Sarah Blankstein.pdf` (+ matching `.docx`) |
| Extract for agents | `docs/workflows/company-sim-2026-08-24-evidence/sarah-sm-agreement-from-pdf.txt` |
| Shape | Independent contractor SM agreement · AZ · numbered §§1–9 · commissions · confidentiality · IP · non-solicit · term · general · signature blocks |

Closer / FA templates were **rewritten from that structure and tone** (role adapted). Comp dollar rates for Closers are **not** copied from Sarah’s SM rates — they use Exhibit A / `{{field.comp_terms}}`.

---

## Honest answer

| Question | Answer |
|----------|--------|
| Was the old stub Chris’s approved template? | **No.** Agent starter text. |
| Is the live template now Sarah-based long-form? | **Yes** (live DB updated 2026-08-24). Still **owner review** before send. |
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
3. Open **Closer Agreement** (`EMPLOYEE-CLOSER-AGREEMENT`) and **Funding Advisor Agreement** (`EMPLOYEE-FUNDING-ADVISOR-AGREEMENT`).

---

## Template A — Closer (live; Sarah-structure rewrite)

- **DB id:** `f47da963-02cc-4ddd-bf54-77648a05c8a1`  
- **Key:** `EMPLOYEE-CLOSER-AGREEMENT`  
- **Name:** Closer Agreement  
- **Subtype:** `employment_agreement`  
- **Body length:** ~10.5k chars (full text in review companion file)

Full body for owner review:  
`docs/workflows/company-sim-2026-08-24-evidence/EMPLOYEE-CLOSER-AGREEMENT-FOR-REVIEW.md`

---

## Template B — Funding Advisor (live twin; never sent)

- **DB id:** `257a85f7-b481-4708-aa17-8fc7823e023f`  
- **Key:** `EMPLOYEE-FUNDING-ADVISOR-AGREEMENT`  
- **Name:** Funding Advisor Agreement  

---

## Standing rules for agents

1. **Do not send** any employment / hire contract email until Chris says **“send Justice contract”** (or equivalent) after approving the template.  
2. Do not invent thin starter wording and treat it as live.  
3. On send/draft for a hire: set **`staff_id`** on the contract so Staff & Teams can open the signed copy later.  
4. Never commit signed agreements to git.

---

## Next (one action for Chris)

Read the Closer Agreement review file (or Contract templates UI), then either **approve** or say **send Justice contract**.
