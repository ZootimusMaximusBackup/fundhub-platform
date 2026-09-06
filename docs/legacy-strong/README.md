# Legacy Strong — shared datapoints (Alec / Notion scrape)

Tracked copies of Alec's Legacy Strong **shared datapoints** tables and inquiry/lender exports. Scraped 2026-09-05 from Notion via `scripts/notion-rescrape-datapoints.mjs`.

## Files in this folder

| File | Rows | What it is |
|------|------|------------|
| `bank-datapoints-active-banks.md` | 26 | Active bank datapoints (issuer, heat, bureaus, limits, etc.) |
| `state-funding-boards.md` | 29 | State × lender/board offers and links |
| `bankers-rms.md` | 10 | Relationship managers / bankers and their banks |
| `inquiry-master-database.csv` | 5,472 | State, Creditor Name, Bureau |
| `full-inquiry-database.csv` | 51 | Inquiry database shell (states list; not the full creditor grid) |
| `lenders-legacy-strong.csv` | 313 | Lender catalog from earlier scrape (Aug 2026) |

## Gitignored — full scrape still lives there

Page bodies, videos, transcripts, JSON mirrors, and the rest of the Notion tree:

`credentials/notion-scrape/output/`

Key subfolders for these tables:

- `bank-datapoints--0f247723/`
- `state-funding-boards--409f6157/`
- `rms--d42db2db/` (+ `bankers--58819778/` — same 10 RM rows)
- `shared-datapoints-summary.json` — scrape manifest with row counts

## Notion view URLs (shared datapoints)

Shared-datapoints scrapes require the **view** URL (`?v=…`), not the bare page URL. Bank Datapoints in particular is the **ACTIVE BANKS** view:

- Bank Datapoints (ACTIVE BANKS): `https://app.notion.com/p/legacystrong/0f24772388034f8daa72266efe32faa0?v=37dc3aa761d280b9ac6c000c07c7a1d5`
- State Funding Boards: `https://app.notion.com/p/legacystrong/409f6157c310494f8308c87f2f0944a9?v=ff6b386d723e4b68a2c9425326f4e9d3`
- Bankers: `https://app.notion.com/p/legacystrong/58819778a99a44b5b7ffea2597d4cba1?v=4b5d94f9d670424ab2d11a0270212893`
