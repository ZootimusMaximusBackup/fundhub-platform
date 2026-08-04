# Lender database (session 2026-08-04)

**Owner:** this session (Grok, one-shot — §0 split waived by owner).  
**Migration:** `138_lenders.sql`.

## Decisions (owner said decide, document, continue)

1. **lender_table enum** uses APPLICATIONS exact Airtable single-select values:
   `OnlineBizCC`, `InBranchBizCC`, `BizLOC_Stated`, `BizLOC_Documented`,
   `PersonalCC`, `PersonalLoans`, `PersonalLOC`.
2. **One `lenders` table** + discriminator; product-only columns nullable.
3. **`applications` already exists** — ALTER to Airtable shape; keep `bank`
   as legacy alias synced from `lender_name` on backfill.
4. **No seed lender rows** — empty tables + CSV import. Real data from Airtable
   by owner/funding advisor (`docs/STILL-MISSING.md`).
5. **`active` boolean** is the list "status" filter (Airtable lender tables have
   no separate status field).
6. **Money on lenders/apps** stays `numeric(14,2)` to match existing
   `applications.approved_amount` (not cents).
7. **Matching** is pure (`src/lenders/match.mjs`): eligible state, inquiry
   sensitivity (skip bureaus with open/recent inquiries), bureau rotation
   (prefer underused bureau). No invented criteria beyond those structural rules.

## Task board

| Unit | Status | Notes |
|---|---|---|
| Schema `138_lenders.sql` | done | lenders + observations + apps ALTER |
| Core `src/lenders/*` | done | csv, match, observations, store |
| API read/write + routes | done | lenders, observations, matches |
| CRM `lenders.html` + Funding nav | done | all sidebars + shell.js ALL |
| Wire deal-funding / closer / rounds | done | match count + Card Stacking panel |
| Tests + Playwright + STILL-MISSING + journeys | done | |

## Change manifest

### Schema
- `db/migrations/138_lenders.sql` — enums, `lenders`, `lender_bureau_observations`, applications columns
- `db/expected-migrations.mjs` — regenerated

### Modules
- `src/lenders/tables.mjs`, `csv.mjs`, `match.mjs`, `observations.mjs`, `store.mjs`, `lenders.test.mjs`
- `src/calculators/deal-funding.mjs` — optional `lenderMatchCount` from real lenders list

### API (routed in `netlify/functions/api.mjs`)
- `GET /api/read/lenders` (+ `?format=csv`)
- `GET /api/read/lender-matches?client_id=`
- `GET /api/read/lender-observations`
- `POST /api/lenders` — save / create / import
- `POST /api/lender-observations` — log / review
- `GET /api/read/funding-rounds?include_matches=1` — attaches fits for round planning

### CRM
- `public/app/lenders.html` — filters, inline edit, import/export, mismatch tab
- Funding sidebar group + Lenders link on all staff screens
- `public/app/shell.js` — `lenders.html` in ALL
- closer-dashboard lender match count tile
- pipeline Card Stacking click → round-planning fit panel

### Docs / journeys
- `docs/STILL-MISSING.md` — Airtable export/import required
- `docs/journeys/*` regenerated + CHANGELOG
- `docs/workflows/lender-database.md` (this file)

### Tests
- unit: `src/lenders/lenders.test.mjs`, deal-funding match cases
- e2e: `e2e/lenders.spec.mjs` + smoke includes lenders.html
