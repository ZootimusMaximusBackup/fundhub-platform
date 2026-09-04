# Contract source files — from Chris, 2026-08-28 (copied into the repo 2026-09-03)

Real agreement text, supplied by the owner. Agents seed FROM these; they never draft legal text.

| File | Maps to template_key | Offer |
|---|---|---|
| Fundhub-Capital-Academy-Enrollment-Agreement.docx / .pdf | FUNDING-MASTERY-AGREEMENT (Funding Mastery Program Agreement) | Capital Academy, $5,000 |
| Fundhub-Capital-Blueprint-Service-Agreement.docx / .pdf | (new) CAPITAL-BLUEPRINT-AGREEMENT | Capital Blueprint, $1,000 |
| Fundhub-White-Label-Partner-Agreement.docx / .pdf | white-label partner | out of scope until white label |
| Fundhub-Service-Agreements-Packet.pdf | packet — check whether it holds the FUNDING-AGREEMENT ($3,000 deposit) and CREDIT-REPAIR-AGREEMENT ($1,000) texts | funding DFY, repair DFY |

Workflow 3 on `docs/workflows/fix-batch-2026-09-03.md`: replace every
"THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS." block
(db/migrations/287_contract_seller_signature_and_real_text.sql, db/seed/007_contract_templates.sql,
db/seed/021_funding_mastery_agreement.sql) with the matching text from these files, via a new
migration — never by editing an applied one. Migrations go live on the production deploy only.
