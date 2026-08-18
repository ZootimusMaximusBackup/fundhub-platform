# W-INTAKE

Simulated client exists.

- Live `POST /api/demo/simulate` as owner returned 200.
- New id: `41a3199f-1835-4ac8-91c0-d4f37bd92037`. Email `sim+1787079946953@demo.fundhub.local`. Not the live credit file. Not the old test client.
- Report lives in `crs_results` (one row, outcome FULL_FUNDING) and `tradelines` (4 rows: Amex, Capital One, Chase, Toyota). Money is stored as cents.
- Pipeline card exists. Simulate creates it when the sales pipeline has a first stage.
- One mock bank row also landed: Simulated Checking.

Evidence: `simulate-post.json`, `client-row.json`, `crs-row.json`, `tradelines.json`, `pipeline-card.json`, `bank-accounts.json`, `proofs.json`.
