# Fixer three — 2026-08-17

Shared board for the named repair: campaign partner list, Command Center money tiles, Content save.

## Task list

| Unit | Owner | Status |
|------|-------|--------|
| 1 Campaigns partner dropdown timing | this thread | done |
| 2 Command Center money tiles | this thread | done |
| 3 Content upload + tile save | this thread | done |

## Change manifest

### 1 — Campaigns partner dropdown

- `public/app/campaign-manager.html` — wait for the data script before asking for partners. The partner list itself was already fine.
- Follow-up (`597df13`): campaign reads now take the partner from the address bar, not only from the data script. Picking a partner was putting the name in the address, then the ad list still left that partner off the request.

### 2 — Command Center tiles

- `public/app/command-center.html` — wait for the data script before writing cash / close / funded. The page was not writing the numbers in. The numbers come from `/api/dashboard/kpis` (transactions, events, funded clients). If a number is zero or missing in the database, the tile will say so — nothing is invented.

### 3 — Content save

- `api/content/tiles.mjs` — read + save locked tiles and the welcome-video map. Owner/admin only.
- `api/content/upload.mjs` — store a welcome video. Owner/admin only.
- `db/migrations/171_content.sql` — video library, tier map, optional tile price.
- `netlify/functions/api.mjs` — both routes registered.
- `public/app/content-admin.html` — upload + save wired. Tiles come from the catalog; no built-in fake tiles.
- `src/http/content-tiles.test.mjs`, `src/http/content-upload.test.mjs`

## Live prove (fixer — not the independent verifier)

- Live HTML hashes match local for campaign-manager, command-center, content-admin.
- Live Playwright: 26/26, 100/100.
- Campaigns: partner list filled (8 names). Picking one puts the partner in the address. Campaign list then answers. That partner has no ads yet, so the list is empty on purpose.
- Command Center: the page now writes the numbers it loaded. Cash today is $0, funded today is 0, close rate has no bookings today so it shows a dash. Those numbers are what the database has for today — nothing was invented.
- Content: the save route is live. Follow-up (`597df13`): the tile list now loads even if the new price column is missing. Tile words can save. Welcome videos and a stored price still need the database update (`db/migrations/171_content.sql`) — that update is not applied yet. Upload stays hidden until videos can be stored.

Evidence: `docs/workflows/fixer-three-2026-08-17-evidence/`

## Independent re-verify (not this fixer)

Fresh verifier after `597df13` went live. Write-up: `docs/workflows/fixer-three-2026-08-17-evidence/reverify-2/verify.md`

- Campaigns: partner list fills. After pick, every campaign ask names that partner. Empty list is honest (no ads yet).
- Command Center: tiles paint. Cash today $0, close rate a dash, funded today 0.
- Content: tile words load and save. `171_content.sql` applied 2026-08-17. Video library and price column now exist. No videos uploaded yet. No tile prices saved yet.
- Live Playwright: 26/26, 100/100.

## Journeys

Content and Campaigns have no intended pair. Owner actual journey regenerates when routes are added (`npm run journeys`).

