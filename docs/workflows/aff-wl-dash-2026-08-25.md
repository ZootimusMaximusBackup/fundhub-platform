# Affiliate + white-label dash — 2026-08-25

**Door:** Fixer (named: aff / WL dash + backend). Isolated `fix/aff-wl-dash`.
**Live:** `https://fundhub.ai` · ClickFunnels apply **not run**.
**People:** seeded `affiliate@fundhub.ai` and `partner@fundhub.ai` (not locked). Staff `chris@fundhub.ai`. Plus-tag people in CRM were reused for reads only; their passwords do not match the staff test password, so they were not used to sign in.
**Clicks:** agent, twice. Chris was not asked.

## Score

| Path | Pass 1 | Pass 2 | Notes |
|---|---|---|---|
| Staff affiliate desk `/app/affiliate.html` | PASS | PASS | Owner can open it. No personal code (owner is not an affiliate). Backend roster read 200 (18 rows). |
| Staff Galaxy `/app/galaxy.html` | PASS | PASS | LIVE · 20 workers. Activity feed 200. |
| Staff partner home `/app/partner-galaxy.html` | PASS | PASS | Page opens. |
| Affiliate desk load + code + link | PASS | PASS | `AFF-000001` · `https://fundhub.ai/start?ref=AFF-000001` |
| Affiliate Copy link / Copy code | PASS | PASS | Both say Copied. |
| Affiliate tabs (leads / payouts / terms) | PASS | PASS | Payouts say history is not wired yet (honest empty). |
| Affiliate Ask (company brain) | PASS | PASS | Answer came back. Allowlist had no matching doc for the test question. |
| Affiliate Message Blaster download | PASS | PASS | File started. API 200. Already shipped (#146). Not re-fixed. |
| Partner Galaxy home | PASS | PASS | Own page: draft, not live. 1 partner on file. |
| Partner Download (live, before fix) | FAIL | — | Header sat on the button. A person could not click Download. |
| Partner Download (after header fix) | PASS | PASS | Click hit the button. File started. |
| Partner Brand Studio | PASS | PASS | Save said saved. `/sites/` path shown. |
| ClickFunnels apply | skipped | skipped | Owner said do not run. |
| Live CRS / card charge | skipped | skipped | Not this job. |

## Backend (live)

All 200 with a real token:

- `/api/auth/session` — staff / affiliate / partner
- `/api/read/affiliates` — staff sees roster; affiliate sees only their row
- `/api/read/partners` — partner sees only their book
- `/api/partner-pages` · `/api/partner-brand` · `/api/partner-marketing/usage`
- `/api/read/company-brain-affiliate`
- `/api/read/company-activity` — live, not fake
- `/api/gifts/message-blaster` — ~1.3 MB disk image for affiliate and partner

## What was broken

Partner Home header (long “Your page” line + sign-out chip) spilled over the Download button. The download itself already worked.

## What was fixed

`public/app/partner-galaxy.html` — keep the header in its box so Download can be clicked. Small test added so it cannot come back.

Live site still has the old header until this branch is merged.

## Left as-is (not a dash break)

- Affiliate payout table is empty on purpose (“not connected to payout history yet”).
- Partner apply page is still a draft. Banner says so and points at Brand Studio.
- Brand Studio rail row is hidden by design (type the address, or use the banner link).
- Seeded plus-tag `e2e+aff-*` / `e2e+wl-*` people exist in CRM but do not share the staff test password.
