# Post-Build Tasks

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
