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

### 2 — Command Center tiles

- `public/app/command-center.html` — wait for the data script before writing cash / close / funded. The page was not writing the numbers in. The numbers come from `/api/dashboard/kpis` (transactions, events, funded clients). If a number is zero or missing in the database, the tile will say so — nothing is invented.

### 3 — Content save

- `api/content/tiles.mjs` — read + save locked tiles and the welcome-video map. Owner/admin only.
- `api/content/upload.mjs` — store a welcome video. Owner/admin only.
- `db/migrations/171_content.sql` — video library, tier map, optional tile price.
- `netlify/functions/api.mjs` — both routes registered.
- `public/app/content-admin.html` — upload + save wired. Tiles come from the catalog; no built-in fake tiles.
- `src/http/content-tiles.test.mjs`, `src/http/content-upload.test.mjs`

## Journeys

Content and Campaigns have no intended pair. Owner actual journey regenerates when routes are added (`npm run journeys`).
