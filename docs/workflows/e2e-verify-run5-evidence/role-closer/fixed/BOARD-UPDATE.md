# Ticket 1 — BOARD UPDATE

- ticket: 1
- journey: role-closer
- step match text: S4 UI: every screen — /api/demo/mode
- observed: closer@fundhub.ai on http://localhost:8888 signed in, landed on /dashboard.html, then /app/pipeline.html. GET /api/demo/mode was never requested (empty list). No 403. Role=closer. Shell no longer polls demo mode for non-owner/admin.
- evidence path: docs/workflows/e2e-verify-run5-evidence/role-closer/fixed/
- status: FIXED-UNCLICKED
- files changed:
  - public/app/shell.js (mountDemoBanner: skip fetch unless role is owner or admin)
  - docs/workflows/e2e-verify-run5-evidence/role-closer/fixed/shot.png
  - docs/workflows/e2e-verify-run5-evidence/role-closer/fixed/pipeline.png
  - docs/workflows/e2e-verify-run5-evidence/role-closer/fixed/network.json
  - docs/workflows/e2e-verify-run5-evidence/role-closer/fixed/notes.md
  - docs/workflows/e2e-verify-run5-evidence/role-closer/fixed/capture.mjs
  - docs/workflows/e2e-verify-run5-evidence/role-closer/fixed/BOARD-UPDATE.md
