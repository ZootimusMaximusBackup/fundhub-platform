# Real staff only — 2026-08-16

**Owner-set:** The only real staff person is **Chris Stanbridge**. Alvin Torres is not staff. Other seed/demo names are not staff.

**Email call:** Login only (`name@fundhub.ai`). Real mailbox later — Google Workspace costs money per seat. Not now.

## Task list

| ID | Owner | Status | What |
|----|-------|--------|------|
| 1 purge | this session | done | Demo people revoked. Seed is Chris only. Roster hides furniture. |
| 2 api | this session | done | `POST /api/auth/invite` + `POST /api/auth/suspend`. Auto company email. |
| 3 ui | this session | done | Staff & Teams: add person, copy set-password link, revoke. |

## Later (not now)

- Real company mailbox (Google / Microsoft). Costs money. Add when Chris wants to pay for seats.

## Change manifests

**Files**
- `src/auth/seed-staff.mjs` — `FOUNDING_STAFF` is only Chris. `SEED_FURNITURE_EMAILS` lists Alvin and the other seed names.
- `src/auth/company-email.mjs` — `sam.rivera@fundhub.ai` from the name.
- `api/auth/invite.mjs` — owner/admin create login, get a copy-link.
- `api/auth/suspend.mjs` — owner/admin revoke. Org-scoped.
- `api/auth/reset.mjs` — set-password page accepts invite tokens too.
- `api/read/staff.mjs` — hides seed furniture, DEMO, TEST —, example.com.
- `public/app/staff-teams.html` — empty seed, add + revoke hit the API.
- `netlify/functions/api.mjs` — routes.
- Live DB: every active login except `chris@`, `owner@`, `admin@` set to suspended. `owner@` / `admin@` stay for live checks only and do not show on the roster.

**Verify:** `node --test` on company-email, seed-staff, invite, staff-invite, crm-html, routes. Playwright `e2e/staff-teams.spec.mjs`.
