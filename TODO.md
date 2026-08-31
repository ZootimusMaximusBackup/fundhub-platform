# Post-Build Tasks

## Credit Repair / Education
- [ ] **Update repair system + education** from `docs/metro2/AI-CREDIT-REPAIR-LETTER-GENERATION-PROMPT.md` (captured 2026-08-14 from the Haitian CEO letter-generator PDF). Dispute fields, not categories. Cross-bureau forensic audit + timing safeguard. **COMPLIANCE REVIEW REQUIRED** before any live letter or education page uses it. Not wired yet.

## Marketing Flywheel
Stages: Avatar → Ad research → Offer → Copy → Ad strategy → spend data → back to the top.
Plan: `~/.claude/plans/merry-noodling-mist.md`. Board: `docs/workflows/flywheel-partner.md` (not created yet).

- [x] Merge the flywheel dependencies to main — PR #319. Workflow scripts plus the avatar, ads and copy docs. PR #318 was closed: it conflicted because main already had newer `public/partner/` pages, and the branch's `public/affiliates/index.html` was older and would have re-added a bug that disclosed which email addresses have a login.
- [x] Staleness gate — `scripts/flywheel/status.mjs`, `npm run flywheel:status`. Tells you which stages went out of date after you changed an earlier one. 8 tests.
- [ ] **BLOCKED on Chris — Meta Ad Library API access.** Needed to pull competitor ads automatically instead of reading them in a browser. Two steps: confirm identity at https://www.facebook.com/ID (takes a few days), then request access at https://www.facebook.com/ads/library/api. Existing app: https://developers.facebook.com/apps/
  - **Worth knowing before spending time on it:** Meta's docs say ads that never reached the EU only come back if they are about social issues, elections or politics — which would exclude US competitor funding ads entirely. But the API also has a `FINANCIAL_PRODUCTS_AND_SERVICES_ADS` type, and credit ads are a special category Meta committed to archiving in the US. Cannot test which is true: `META_ACCESS_TOKEN` is valid and never expires, but the app is rejected (`code 10, subcode 2332002`) before scope is resolved. Apply anyway, it is free.
- [ ] `.claude/workflows/ad-research.js` — build browser-first so it does not wait on the key above. Ranks by how long an ad has been running, because competitor spend is not observable at any price. Evidence tiers A–E so a thin run reports itself as thin instead of reading confident.
- [ ] `.claude/workflows/offer.js` — six offer candidates from assigned archetypes, four judges with different jobs (buyer, operator, accountant, competitor), synthesize the winner while grafting the best parts of the losers.
- [ ] `.claude/workflows/copy.js` — the humanizer pass runs as a regex in the script, not as an instruction an agent can believe it followed. Loop until clean, max three passes, drop anything still dirty.
- [ ] `.claude/workflows/ad-strategy.js` — small. Picking among six named strategies is a lookup; this exists for the budget and creative-supply checks. The playbook's lowest chapter assumes $1,000/day and Chris models $200/day.
- [ ] `.claude/commands/flywheel.md` + `docs/flywheel/README.md` — the runner and the contract. Write last, after the procedure has been walked by hand once.
- [ ] Seed stage 1 by copying the existing `docs/avatars/partner/` docs into the flywheel folder with a stamp. Saves re-running 33 agents.
- [ ] **Bonus found while testing:** `META_ACCESS_TOKEN` already works for Fundhub's *own* ads — it sees the Fundhub.ai account and its spend. So the feedback leg needs no manual spreadsheet export from Ads Manager, which the plan had assumed.

## Staff & Teams
- [ ] **ST-07 Effective permissions** — leave as copy only. Role rules live in server code; this screen cannot show or edit them. Change access by changing **Role**, not a permission matrix. Only revisit if we later publish a real role→action list from code.

## UX/UI Refinement (High Priority)
- [ ] Once/twice pass through all Finance OS screens (v1 + v2)
- [ ] Refine cards UI — clear labeling, no overcomplication
- [ ] Refine alerts display — severity hierarchy, action clarity
- [ ] Refine subscription tier display — pricing transparency
- [ ] Test on mobile, tablet, desktop
- [ ] Affiliate portal UX review
- [ ] Client-facing screens review
- [ ] Team internal screens review
- [ ] Documentation clarity — no jargon without explanation

## Ops / Infrastructure
- [ ] **PAUSED 2026-08-14 — Mailgun bank-inbox → Netlify.** Route already moved: catch-all `F-10R-IN Bank Inbox → Netlify CRM` now forwards to `https://fundhub.ai/api/webhooks/mailgun` (was Vercel inquiry-removal). `MAILGUN_SIGNING_KEY` is set on Netlify. **Blocked on unpaid Mailgun balance** (red banner — pay + retry charge). After pay: prove one bank/forwarded email lands in CRM (`mail.response` / bank inbox), then document closer 5-sec latch + keyword sorter in `docs/sops/` (keywords live in `src/adapters/mailgun.mjs`, not Mailgun UI). Keep Mailgun for inbound; Resend stays outbound.
- [ ] Seed initial partner row (partners table is empty)
- [ ] Plaid API key + environment secrets setup
- [ ] Verify Netlify deploy includes latest shell.js (cache-buster test)
- [ ] SOC 2 audit status for Finance OS v2 gate

## Connector Wiring (Post-Telemetry W1 Merge)
- [ ] Wire Twilio SMS handler into `logStaffEvent(text_sent, ...)`
- [ ] Wire Mailgun email handler into `logStaffEvent(letter_issued, ...)`
- [ ] Wire Cal.com call events into `logStaffEvent(call_made, ...)`
- [ ] Wire Plaid webhook into `logStaffEvent(pull_run, ...)` (after W5-W8 merge)

## Merge Checklist
- [ ] W1-W10 PRs reviewed and merged
- [ ] Migrations applied (075-079 from W2-W4)
- [ ] Main branch CI green
- [ ] Database schema live on production
