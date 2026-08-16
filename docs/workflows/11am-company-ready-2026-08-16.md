# 11 AM company ready — 2026-08-16

**Shared board for overnight P0 agents.**  
**Deadline meaning:** every role can log in; core walk does not lie. Not Inngest, not Twilio, not Meta.

| Agent | Owns | Status |
|-------|------|--------|
| 1 Accounts + ship | Report wording, commit/merge, one Netlify deploy, seed/unsuspend, login probes | **done** |
| 2 Honest UI | Scrub fake names on calendar, template-editor, hiring | **done** |
| 3 Template seed | Missing EMAIL/SMS keys; leave `compliance_passed` false | **done** (2 missing keys only) |
| 4 Re-audit | Browser-click sidebar after #2 deploys (not Playwright) | **partial** — core screens clicked; full 40 still Agent 4 |

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
| Merge to `main` | **done** | `c5c7dfd` |
| Prod deploy | **done** | Deploy id `6a8190b6c66dcdd3da0d932c` — live HTML confirmed scrubbed |
| Browser-click 5 pages | **done** | Signed in as `chris@`. No Jordan Blake / Marcus Webb / Carlos Bettencourt / Meredith Yao / Nina Torres on any of the five |

### Live click results (`https://fundhub.ai`, after deploy `6a8190b6c66dcdd3da0d932c`)

| Page | What I did | What I saw |
|------|------------|------------|
| Calendar | Opened, expanded Demonstration states, clicked a real booking | Demo copy says “Two bookings sit in the same 4:30 slot.” Real names on the board (Sarah Blankstein etc.). No furniture names. |
| Message Copy | Opened EMAIL-S02 draft, then `payment_link_notice` | Preview: “Hi Preview, here is your payment link…” — not Marcus Webb. 200 pieces of copy. |
| Hiring | Dismissed banner, clicked Applied | 3 live open applications. No Jordan Blake. No Priya sample row. |
| Pipeline | Typed “Chris” in search | R-01 Sales 16 cards. “Select a card.” No furniture names. |
| Client Control Panel | Opened with no `?id=`, expanded Credit & Hold | “Open with ?id=<client id>”. Dashes. No fake person. |

Agent 4 can start the full sidebar re-audit — this ship is live.

### For Chris when you wake

1. One owner manual pass on live (agent already click-audited 40 screens earlier — not Playwright).
2. Agents 2–4 own honest UI / templates / re-audit.
3. Optional: `npm run test:e2e:live` as regression only.

### Left for other agents / out of scope

- Agent 4 can finish remaining BETA sidebar screens (this chat clicked core + campaigns/staff/automations)
- Inngest / outbound / compliance flips — owner only
- P1 money/mail (Twilio A2P, Commas, GHL contacts, Resend DNS) — needs live provider setup
- P2 unit hygiene (diagrams, workflow count 51, outbound-fetch fence) — not 11 AM blockers

### Agent 2 follow-up (same night)

| Step | Status | Notes |
|------|--------|-------|
| 2h leftover loop | **fired 5:35 AM PT** | One-shot done. Furniture still gone in repo + live. Agent 4 full 40-screen still partial. |
| Template seed | **done** | Inserted only missing `EMAIL-S05A-NOSHOW-RECOVERY` + `SMS-S05A-NOSHOW-RECOVERY`. `compliance_passed=false`. Did **not** overwrite 16 already-approved rows. |
| Dana Reyes on Campaigns | **done in repo** | Sample action log now says Staff. Needs this deploy to be live. |
| Extra live clicks | **done** | closer-dashboard, closer-call, my-numbers, sales-floor, messaging, campaigns, staff-teams, automations |

---

## P2 unit hygiene (Workflow retry — rate-limit relaunch)

| Agent | Owns | Status |
|-------|------|--------|
| P2 unit hygiene | Fix 11 known `npm test` failures; no weaken/delete; no flip of Inngest/outbound/compliance; no key rotation | **done** |

**Branch:** `cursor/p2-unit-hygiene-7635`

### Scoreboard (11/11)

| # | Item | Result | Fix |
|---|------|--------|-----|
| 1 | `docs/diagrams` sync | **pass** | `npm run diagrams` — regenerated README, agent-triggers, event-flow |
| 2 | homepage-survey titles | **pass** | Titles → CF ground truth: "Set Your Target Amount", "Your Current Score" |
| 3–4 | Sidebar sync | **pass** | Excluded `payment-success.html` + `soft-pull-approve.html` (public, no CRM shell) |
| 5–7 | Journey runner 50→51 | **pass** | Counts → 51; dropped ghost `s-02-incomplete-survey-nudge` from pretendFired |
| 8 | Outbound-fetch fence | **pass** | Allow-list: c-06, ds-02 (CLAUDE.md §12), climate/connectors (macro data, no client) |
| 9 | SMS dry-run fence | **pass** | Fence test routes SMS via Twilio (transmitting); GHL stub skips fence by design |
| 10 | GHL SMS routing | **pass** | Expect `REJECTED` + zero network (GHL stubbed off, owner 2026-08-14) |
| 11 | Underwrite FIXTURE 2 | **pass** | Pin: unknown stays null → not fundable (`neg === 0` required) |

**Verify:** touched test files 147/147 pass (+ adjacent underwrite/messaging/workflows 102/102).

**Not flipped:** `INNGEST_EVENT_KEY`, `outbound_enabled`, `compliance_passed`. No key rotation.

### Change manifest

| Path | Change |
|------|--------|
| `docs/diagrams/{README,agent-triggers,event-flow}.md` | Regenerated |
| `public/js/homepage-survey.js` | CF ground-truth titles |
| `src/http/app-nav-matches-shell.test.mjs` | NO_SIDEBAR exclusions + comments |
| `src/journeys/runner/index.test.mjs` | 51 workflows; pretendFired cleanup |
| `src/lib/no-unfenced-transmit.test.mjs` | ALLOWED_RAW_FETCH entries |
| `src/messaging/dispatch-fence.test.mjs` | SMS fence via Twilio |
| `src/messaging/dispatch.test.mjs` | GHL stub rejection pin |
| `src/underwrite/fixtures.test.mjs` | FIXTURE 2 product-rule pin |

### Blocked

None.
