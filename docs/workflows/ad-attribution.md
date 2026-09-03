# Ad attribution — Meta → ClickFunnels → CRM, 2026-09-03

One session ran every unit (owner said: no questions, land it all this session).
Branch `feat/ad-attribution`.

## Status

| # | Unit | Owner | Status |
|---|---|---|---|
| 1 | Migration `286_client_ad_attribution.sql` — enum `ad_lane`, table, generated `lane`/`ad_id`/`variant`, CHECKs, RLS, grants | this session | done |
| 2 | Registry `docs/ads/registry.json` + loader `src/ads/registry.mjs` | this session | done |
| 3 | Reads `api/read/ad-attribution.mjs`, `api/read/ad-books.mjs`, routed | this session | done |
| 4 | Tests `src/ads/registry.test.mjs` (6) + `src/http/ad-attribution.pg.test.mjs` (8, real Postgres, 0 skipped) | this session | done |
| 5 | Diagram `docs/journeys/ad-attribution-flow.md` | this session | done |
| 6 | Closer view — four lines under the name on `closer-dashboard.html` | this session | done |
| 7 | Fragment `clickfunnels-fragments/06-utm-hidden-fields.html` | this session | done |
| 8 | Offer display names: `UWIQ_DELIVERABLES` → "Capital Blueprint", `FUNDING_MASTERY` → "Capital Academy" (name strings only) | this session | done |

## Context brief

- Attribution used to land ONLY in `clients.custom_fields` (jsonb) via `attributionFields()` in `src/handlers/client-lifecycle.mjs`. That stays. The typed row is written beside it, non-fatally.
- The adapter's `pickVisitAttribution` read only CF's `visits.first_visit`. It now reads an explicit `attribution` object first, then hidden form fields (`custom_attributes` / `custom_fields`), then `first_visit`, field by field.
- `docs/ads/scripts/2026-09-02-ad-scripts.md` does not exist in the repo or on any branch. Registry seeded from the owner's brief: ids 16, 26–31, 42–46, 72–83. All other ids resolve to the sorting default and are logged.

## Change manifest

Files added: `db/migrations/286_client_ad_attribution.sql`, `docs/ads/registry.json`, `src/ads/registry.mjs`, `src/ads/store.mjs`, `src/ads/registry.test.mjs`, `api/read/ad-attribution.mjs`, `api/read/ad-books.mjs`, `src/http/ad-attribution.pg.test.mjs`, `docs/journeys/ad-attribution-flow.md`, `clickfunnels-fragments/06-utm-hidden-fields.html`, this file.

Files changed: `src/adapters/clickfunnels.mjs` (pickVisitAttribution), `src/handlers/client-lifecycle.mjs` (onEntryCaptured writes the row), `netlify/functions/api.mjs` (two routes), `src/config/offers.mjs` (two name strings), `public/app/closer-dashboard.html` + `public/app/closer-call.js` (four lines), `db/expected-migrations.mjs` (manifest), `docs/journeys/*-actual.md` (regenerated for the two new routes), `docs/journeys/CHANGELOG.md`.

Routes added: `GET /api/read/ad-attribution?client_id=` and `GET /api/read/ad-books?group_by=…` — both `ROLE_SETS.STAFF`, org from session.

Exports added: `src/ads/registry.mjs` (`loadRegistry`, `resolveAd`, `adsWithTag`, `laneOf`, `adIdOf`, `variantOf`, `UNKNOWN_AD`, `parseRegistry`, `_resetRegistry`), `src/ads/store.mjs` (`upsertClientAdAttribution`, `readClientAdAttribution`, `adAttributionRollup`).

Journeys impacted: new `ad-attribution-flow`; all eight role `-actual.md` pages regenerate because two STAFF routes were added.

## Open

- `public/app/client-portal.html` hardcodes the OLD offer names ("UnderwriteIQ Deliverables Package", "Funding Mastery course (A to Z)") in four places. Out of scope per the brief (name strings in offers.mjs only). Left as a finding.
- Which CF payload key the live workspace uses for hidden inputs is unverified until a real submission lands. Adapter reads both.
- The migration is live only after merge to `main` (CLAUDE.md §11). Check `/api/health` for `pending` after the deploy.
