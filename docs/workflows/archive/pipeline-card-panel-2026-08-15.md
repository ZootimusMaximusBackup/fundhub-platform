# Pipeline card panel + leftover prove thread — 2026-08-15

Owner go: fix everything from conversation (pipeline UX, collections AR, pay success).

## Split

| Unit | Owner | Status |
| --- | --- | --- |
| A Card right drawer (scores, survey, prequal, tier) | this chat | done — tile shows survey score range; panel has business credit |
| B Type-DELETE on tile + board | this chat | done |
| C AR collections Bland D0–D7 + board | this chat | done (prompt + board; invoice clocks follow-on) |
| D Fundhub payment-success on checkout | this chat | done (page + success_url) |
| E Pay→board→soft-pull sync path | done earlier this session | done |

## Delete law (owner-set this turn)

Delete = remove sales card + mark client `custom_fields.crm_archived_at` (not hard wipe of payments/CRS history). Type `DELETE` to confirm.

## Change manifest

- `public/app/pipeline.html` — right drawer (scores / survey / prequal / tier + deep links); DEL on tile; Archive top-right + drawer; type-DELETE modal → `POST /api/dashboard/client-archive`
- `api/dashboard/client-archive.mjs` + route + `src/http/client-archive.test.mjs`
- `api/dashboard/pipeline.mjs` — hide archived (`crm_archived_at`)
- AR board: `docs/workflows/ar-success-fee-2026-08-15.md`
- Collections prompt: D0–D7 + authority matrix

## Board notes

- Prefer product path in drawer (outcome_tier).
- No redundant full CCP dump — summary only + deep links.
- Tile score line is the survey band (`cf_svy_self_reported_fico` label), not bureau FICO.
- Panel Credit section: they-said band + business Intelliscore / FSR when stored. No stored business scores yet → dashes.
- Francis + Vinesh (2026-08-13): Facebook ad → `/watch` VSL opt-in. No survey webhook. Vinesh booked. Attribution stamped on the file. New CF leads keep UTM.
