# Staff accounts fix — 2026-08-17

Shared board for the named repair: role save, hidden count, Auditprobe delete, reset mail, invite mail, link lifetimes.

## Task list

| Unit | Owner | Status |
|------|-------|--------|
| 1 Role change persists | this thread | done |
| 2 Hidden-count line | this thread | done |
| 3 Remove E2e Auditprobe | this thread | done |
| 4 Forgot-password send | this thread | done |
| 5 Invite email + copy-link | this thread | done |
| 6 Link lifetime copy | this thread | done |
| 7 Prove, push, deploy | this thread | done |

## Shared context

Invite links last 7 days. Reset links last 1 hour. Login is `name@fundhub.ai`. Mail goes to the Email field (`notify_email`) or the typed forgot-password address. Resend is already in the tree. Revoke stays final.

## Change manifest

- `api/auth/staff-role.mjs` — owner/admin writes a staff job
- `src/auth/invite.mjs` — `setStaffRole`
- `src/auth/staff-mail.mjs` — Resend words + send
- `api/auth/invite.mjs` — mail the invite, keep the copy-link
- `api/auth/reset.mjs` — mail the reset; `mailed` is only true when Resend accepted
- `api/read/staff.mjs` — `hiddenCount`
- `public/app/staff-teams.html` — save role, hidden line, notify email, 7-day / 1-hour words
- `public/login.html` — honest forgot-password words
- `public/reset-password.html` — both lifetimes
- `netlify/functions/api.mjs` — `auth/staff-role` routed

## Blockers

none

## Live prove

- Commit `6f41ca4` is live. `staff-teams.html`, `login.html`, and `reset-password.html` hashes match local.
- Role write to Funding Advisor stayed on the server after a fresh roster read.
- Invite to `chris@fundhub.ai` was accepted by Resend. Copy-link still comes back.
- Forgot-password for `chris@fundhub.ai` was accepted by Resend. No token in the public reply.
- Prove hire was deleted after the check. E2e Auditprobe is gone.
- Hidden line on the live roster: 23 people are hidden.
- Live Playwright: 26/26, 100/100.
