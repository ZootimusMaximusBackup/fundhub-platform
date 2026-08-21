# Post-Build Tasks

## Credit Repair / Education
- [ ] **Update repair system + education** from `docs/metro2/AI-CREDIT-REPAIR-LETTER-GENERATION-PROMPT.md` (captured 2026-08-14 from the Haitian CEO letter-generator PDF). Dispute fields, not categories. Cross-bureau forensic audit + timing safeguard. **COMPLIANCE REVIEW REQUIRED** before any live letter or education page uses it. Not wired yet.

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
