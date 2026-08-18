# W-UW findings (UnderwriteIQ)

Ground truth for this machine is Chris’s 2026-08-18 board. Intended journeys do **not** name UnderwriteIQ. That gap is **MISSING**. Nothing here was invented to fill it.

Simulated client was **not** torn down.

## What ran

Same path as the Postgres test and the live read: load stored lines + CRS row → `toBureaus` → `computeUnderwrite` → suggestions → report.

## Findings

1. **Engine ran. It said $0 and not fundable.** Seed said $125,000 and FULL_FUNDING. Evidence: `engine-output.json`.

2. **The engine never saw the scores.** Stored scores are 718 / 724 / 731, but they sit under `consumerSignals.scores.perBureau` and `crm_payload.scores`. The adapter only looks at `result.scores` (top level). That key is empty. So every bureau is “not available.” The engine then paints score **0**. Evidence: `stored-crs.json`, `engine-output.json`.

3. **The engine does not print tiers, reason codes, or preapprovals.** Those live only on the CRS seed (`sim_demo`, `low_util`, `totalCombined: 125000`) and on `clients.outcome_tier` / `crs_results.outcome_tier`. The engine output has `fundable`, money totals, and suggestion sentences instead. Evidence: `tiers-reasons-preapprovals.json`.

4. **The engine does not read the seed outcome.** It also did not use the stored cards on this run, because no bureau was handed in. It did **not** copy FULL_FUNDING / $125k and skip the file. It assessed an empty file. Evidence: `plausibility.json`.

5. **The stored file itself looks right.** Four lines match the seed. Chase / Amex / Cap One are revolving. Toyota is installment (not a card). Open dates are present. Revolving math is 2100+4800+950 on 12000+25000+8000 = **17.44%** (seed said 18%). The adapter computed that 17.44%. The engine never used it. Bureaus on the raw lines are EX / EQ / TU as seeded — not swapped. Evidence: `stored-tradelines.json`.

6. **Funding letter file does not make a PDF from the engine result.** `funding-letter-pdf.mjs` only saves or loads an already-made PDF. Calling it with this engine result stored nothing and loaded nothing. No email sent. Evidence: `letter-error.txt`, `letter-result.json`.

7. **Simulate writes the tier. The engine write writes nothing.** After simulate: `clients.outcome_tier=FULL_FUNDING`, `crs_results.outcome_tier=FULL_FUNDING`, seed reason codes + $125k preapproval on the CRS JSON. `clients.custom_fields` funding keys are empty. `client_custom_fields` has no row. `funding_rounds` is empty. `documents` is empty. Running the engine did not change those rows. Evidence: `funding-columns.json`, `documents.json`.

## Score

| step | result |
|---|---|
| engine run | PASS (artifact exists) |
| tiers / reason codes / preapprovals | FAIL |
| letter PDF | FAIL |
| plausible vs seed | FAIL ($0, missed scores) |
| column dump | PASS (artifact exists) |
| intended journey | MISSING |
