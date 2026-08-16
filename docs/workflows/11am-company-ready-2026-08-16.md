# 11 AM company ready — 2026-08-16

**Shared board for overnight P0 agents.**  
**Deadline meaning:** every role can log in; core walk does not lie. Not Inngest, not Twilio, not Meta.

| Agent | Owns | Status |
|-------|------|--------|
| 1 Accounts + ship | Report wording, commit/merge, one Netlify deploy, seed/unsuspend, login probes | **done** |
| 2 Honest UI | Scrub fake names on calendar, template-editor, hiring | claimed |
| 3 Template seed | Missing EMAIL/SMS keys; leave `compliance_passed` false | pending |
| 4 Re-audit | Browser-click sidebar after #2 deploys (not Playwright) | pending |

**Do not flip:** `INNGEST_EVENT_KEY`, `outbound_enabled`, `compliance_passed`. Do not rotate keys.

---

## Agent 1 log

| Step | Status | Notes |
|------|--------|-------|
| Fix Playwright wording | **done** | Report + screen-audit + verification-rerun: 40-screen audit = agent browser clicks, not Playwright |
| Commit staged + merge main | **done** | `06d96b8` on `main` (fast-forward from `4e09dbc`) |
| Push `origin/main` | **done** | |
| One Netlify `--build --prod` | **done** | Deploy id `6a818f81b24a4a4391828c79` — live https://fundhub.ai |
| Seed `sales@` + `client@` | **done** | `created` via `scripts/seed-role-accounts.mjs --reset-passwords` |
| Unsuspend closer/advisor/inquiry/setter | **done** | `password-reset` also sets `status=active` (same E2E password) |
| Probe all role logins | **done** | **11/11 OK** — evidence `e2e-verify-run4-evidence/role-login-probe-after-seed.json` |
| `npm test` on touched files | **done** | `src/auth/seed-staff.test.mjs` 2/2 pass; 11 known suite fails untouched |

**Chris@ not touched.** Owner password unchanged.

**Not flipped:** `INNGEST_EVENT_KEY`, `outbound_enabled`, `compliance_passed`. No key rotation.

### Login probe results (live `https://fundhub.ai`, ~3:24 AM PT)

Password: same as E2E (`STAFF_E2E_PASSWORD`). Probes spaced ~2.5s to avoid 429.

| Role | Email | HTTP | Result |
|------|-------|------|--------|
| Owner | `chris@fundhub.ai` | 200 | **OK** — staff/owner |
| Owner test | `owner@fundhub.ai` | 200 | **OK** — staff/owner |
| Admin test | `admin@fundhub.ai` | 200 | **OK** — staff/admin |
| Sales manager | `sales@fundhub.ai` | 200 | **OK** — staff/sales_manager (was missing; now seeded) |
| Closer | `closer@fundhub.ai` | 200 | **OK** — staff/closer (was suspended) |
| Funding advisor | `advisor@fundhub.ai` | 200 | **OK** — staff/funding_advisor (was suspended) |
| Inquiry | `inquiry@fundhub.ai` | 200 | **OK** — staff/inquiry_specialist (was suspended) |
| Setter | `setter@fundhub.ai` | 200 | **OK** — staff/setter (was suspended) |
| Affiliate | `affiliate@fundhub.ai` | 200 | **OK** |
| White-label partner | `partner@fundhub.ai` | 200 | **OK** |
| Client portal | `client@fundhub.ai` | 200 | **OK** — client (was missing; now seeded) |

**Summary: 11/11 pass. Company role-login gate is unblocked.**

---

## Agent 2 log (Honest UI)

| Step | Status | Notes |
|------|--------|-------|
| Claim | **done** | Branch `cursor/honest-ui-furniture-2026-08-16` |
| Scrub `calendar.html` | **done** | Double-book demo copy no longer names Jordan Blake / Carlos Bettencourt / Meredith Yao |
| Scrub `template-editor.html` | **done** | Preview sample is "Preview Name" / preview@example.com, not Marcus Webb |
| Scrub `hiring.html` | **done** | Demo referral source no longer names Jordan Blake |
| `crm-html` tests | **done** | 17/17 pass, including new furniture-name test |
| Merge + deploy | pending | Tab 1 already deployed `6a818f81b24a4a4391828c79` without this scrub — need a second prod deploy after merge |
| Browser-click 5 pages | pending | calendar, template-editor, hiring, pipeline, client-control-panel |

### For Chris when you wake

1. One owner manual pass on live (agent already click-audited 40 screens earlier — not Playwright).
2. Agents 2–4 own honest UI / templates / re-audit.
3. Optional: `npm run test:e2e:live` as regression only.

### Left for other agents / out of scope

- Furniture names still on `calendar.html`, `template-editor.html`, `hiring.html` (Agent 2)
- Template seed (Agent 3)
- Browser re-audit after UI ship (Agent 4)
- Inngest / outbound / compliance flips — owner only
