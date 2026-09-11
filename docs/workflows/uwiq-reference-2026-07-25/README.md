# The designed UnderwriteIQ deliverables — reference set, 2026-07-25

These four PDFs are the TARGET. Chris had them made. They are the standard the
live site has to hit for every client whose credit file lands (owner-set,
2026-09-03: "I demand that it can be produced by the site").

Applicant on the reference set: **Jordan Sample**, dated **July 25, 2026**,
outcome **FUNDING_PLUS_REPAIR**, median score **636**. Not a real person.

| File | Pages | What it carries |
|---|---|---|
| `funding_snapshot.pdf` | 9 | Numbers-now table with an AFTER OPTIMIZATION column, breakdown by category, "What Is Costing You Money" (ranked, with pay-for-delete guidance), "What Does Not Affect Your Funding", the after-optimization lender table, next-step close, QR page |
| `credit_analysis_report.pdf` | 12 | Two-track plan, bureau health, per-bureau score cards, utilization analysis, AU accounts, negatives one by one, inquiries, personal data cleanup, bottom line |
| `lender_match_list.pdf` | 10 | "Available Right Now" with a score ladder, "After Optimization" shortlist grouped by product with a "fits you because" line each, application order warning, numbers at a glance, QR page |
| `optimization_roadmap.pdf` | 15 | Month 1 through Month 6 with the work in each, before/after transformation table, six-month checklist, call to action |

## Two things in the reference set that are NOT copied

1. **The booking link prints as `www.fundhubbookingurl.template`** — a
   placeholder that was never replaced. The live printer must print the real
   booking page instead (`src/insights/meet.mjs` `salesMeetBookingUrl`).
2. **Jordan Sample's numbers.** Every figure in a printed document comes from
   the client's own credit file. Nothing here is a default.

## What the live path produced before this work

`../expected-deliverables-uwiq-2026-09-03-pack/` — the same five documents built
by the Node/pdf-lib printer Netlify actually runs. Skeleton: blank cover date,
accounts listed three times, no costing-you section, no not-a-factor section,
no after-optimization lender table, and "fundhub.ai" where the booking link goes.

The gap, page by page, is written up in `../w10-proof-2026-09-03.md`.
