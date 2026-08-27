# Decommission Message Copy — 2026-08-21

Owner: remove Message Copy (`template-editor.html`) from the product.
Not a nav-hide — delete the screen. Typed URL must 404. APIs for message
templates stay (messaging still sends copy).

## Status

| Unit | Owner | Status |
|---|---|---|
| Drop nav row + Automation empty-group falls away | this session | done |
| Remove from shell `ALL` | this session | done |
| Delete `public/app/template-editor.html` | this session | done |
| Update reachability / crm-html / e2e lists | this session | done |
| Prove: rail clean, URL gone | this session | done — live 404 + owner rail has no Message Copy / Automation |

## Change manifest

- `public/app/sidebar.fragment.html` — remove Message Copy row
- `public/app/shell.js` — drop from `ALL` + synced `SIDEBAR_HTML`
- `public/app/*.html` — sidebar sync (30 screens)
- `public/app/template-editor.html` — deleted
- `src/http/app-nav-reachability.test.mjs` — drop from `KEEP_ON_MENU`
- `src/http/crm-html.test.mjs` — stop reading deleted file
- `e2e/screens-smoke.spec.mjs`, `e2e/crm-flows.spec.mjs`, `e2e/verification-roles.spec.mjs` — drop screen
- `scripts/tmp-full-live-verify.mjs` — drop screen

## Not touched

- `api/message-templates.mjs` / `api/read/message-templates.mjs`
- Journeys / messaging send path
- Agent Editor / Workflows / Journeys (still URL-ok, still NAV_HIDDEN)
