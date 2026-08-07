# customer-journey-playwright-ux

Owner order (2026-08-06): ship 1–4 before go-live; 5–6 after. Also sync verify DB.

## Tasks

| Unit | Status |
|------|--------|
| 1. Suppress funding blocks without funding-snapshot | **done** |
| 2. Pay modal honest dead end | **done** |
| 3. Hide STATE toggle for non-staff | **done** |
| 4. INCLUDED → View status | **done** |
| 5. Align product name (after go-live) | deferred |
| 6. Full letter journey (after go-live) | deferred |
| Sync verify DB + re-run | **done — 11 FAILs cleared** |

## Change manifest

- `public/app/client-portal.html` — funding-only suppress, pay honesty, staff-only STATE, included → View status
- `e2e/client-portal-ux.spec.mjs` — 5 Playwright gates for the above
- Local `fundhub_verify`: applied migrations 142–155 (renames marked for 138–141/144–146); columns `lenders.is_demo`, `invoices.is_demo`, `staff.monitoring_consent_at` present

## Verify after migrate

- Before: 362 PASS / **11 FAIL**
- After: **374 PASS / 0 FAIL** / 31 UNVERIFIED
- DIY letters still PASS; DRAFT email guard still correct

## Left for after go-live

- #5 product name ↔ tile alignment
- #6 full letter journey UI
