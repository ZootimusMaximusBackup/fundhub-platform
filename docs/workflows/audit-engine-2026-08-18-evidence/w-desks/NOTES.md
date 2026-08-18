# W-DESKS

Inquiry desk and Repair desk on the simulated file. Findings only. Send was never pressed.

The named spec `spec-inquiry-remover-dashboard.md` is still missing from `fundhub-docs/sources/`. Ground truth used here is Chris’s 2026-08-18 order plus `docs/journeys/role-inquiry-remover-intended.md` “Specialist desk (observable)”.

## Inquiry

1. Simulate does **not** plant inquiries. `inquiry_log`, `inquiry_prep`, and `inquiry_removal_cases` were empty for this client before we made a case. The credit result has tradelines and **no inquiries key**. Empty is correct for this seed.

2. The machine can open a case with no live bureau. `POST /api/inquiry-cases` with `action: create` made case `d1635579-eda9-4961-8ca8-50abe7151ecf` for this client only. Status Queued. Bureau EX. Notes say do not send.

3. That case shows on Specialist → Inquiries as **Simulated Client**. Send is a button. We did not press it. `buildCaseSendRequest` matches its tests: `POST /api/inquiry-cases`, `action: send`, `mail: true`. Payload saved.

## Repair — this is the G2 gap

4. Live `GET /api/read/repair-cases` as owner: **0 files**. This client is not in the list. Detail for this client: no file, no letters.

5. Simulate does **not** seed repair data. No `dispute_cases`, `dispute_letters`, or `dispute_items`. No `letters_generated` table. The only card is sales / new_lead. Repair tab copy: **“No repair files yet.”** Same empty G2 saw. That empty is a gap, not a seed.

6. FTC / police report upload path is `POST /api/documents-upload` (multipart). Fields: `client_id`, `subtype=additional_fraud_docs`. File must be a real pdf/jpg/png. A tiny pdf on **this client** stored `documents.id=bf55375a-b4c7-48aa-8241-9b818bc60c82`.

7. `buildRepairSendRequest` matches its tests. This file has **no** ready letters, so a real Send letters click would have nothing to mail. Dummy payload saved. Not sent.

8. `POST /api/repair/send` needs staff login, `mail: true`, this client’s id, and letters with a bureau plus html or pdf. Next call would be PostGrid (`sendLetter` → `api.postgrid.com/print-mail/v1/letters`). `mail: false` came back 400 `no_channel` (“mail required — human must press send”). Local names: `POSTGRID_API_KEY` and `POSTGRID_WEBHOOK_SECRET` are set. `POSTGRID_API_BASE` is not (default is fine). Did not mail.

W-TEAR must also delete the case row and the documents row above.
