# CRS credentials + sandbox client — 2026-08-07

**Status: CLOSED — no open tasks in this board.**

Merged into the finished Softview build (`docs/workflows/crs-softview-2026-08-07.md`).

| Unit | Status |
|------|--------|
| Review Downloads credential + Postman files | done |
| Netlify `CRS_API_*` sandbox on all contexts | done |
| Sandbox login smoke | done |
| Identity guard | done |
| CRS HTTP client | done |
| Tri-bureau mapper | done |
| Pull coordinator on `coordinateCrsResult` | done |
| Wire `diagnostic.paid` (C-00 → `runCrsPull`) | done |
| Tier engine → `decision.rendered` | done |
| Unit + pg tests | done (local) |
| Migrations 157–159 on local `fundhub_verify` | done |

Production migrate of 157–159: **blocked outside this machine** — Netlify returns masked `DATABASE_URL` / `MIGRATION_DATABASE_URL`. Same note on the Softview board. Not an open code task.

Owner decisions recorded as fact: sandbox only for testing; production host refused in code until a later deliberate flip.
