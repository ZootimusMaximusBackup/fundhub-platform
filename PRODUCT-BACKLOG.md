# Product backlog — captured Jul 28 (nothing here ships today; nothing here gets lost)

## Access levels (the tier model)
Live today: staff roles (owner / admin / closer / funding_advisor /
inquiry_specialist / setter) gate both nav and API — verified with a closer
blocked from the inquiry console.

Next tiers, in order:
1. **White-label partner** — 50% economics, zero fulfillment (Chris fulfills).
   Their portal: THEIR clients only, their branding, no staff/team/dev areas,
   no pricing internals beyond their split. New principal type (`partners`
   table + partner sessions), not a staff role — keeps requireRole clean.
2. **Affiliates** — tier1/tier2 per the a1/a2 sticky-attribution model (033
   already models referrals/payouts; AF-04 rate formula still an open human
   question). Affiliate portal = links, referral list, balance, payout status.
3. **Client portal** — entitlement-gated tiles (wireframe + entitlements land
   with Wave 2's 032).
Endgame framing: Fundhub as the in-house CRM for US funders — partner tier IS
the product. Permissions matrix doc before building tier 1.

## Developer access — simulated credit files
Seed exists (`api/dashboard/seed.mjs`, owner/admin-gated, generates realistic
clients incl. tiers + booked-call tasks). Extend into a proper simulator:
pick a CRS payload fixture (EX/TU/EQ tri-merge, business, LexisNexis when
added) → inject through the real adapter path → watch the whole pipeline
react. Dev-role-gated screen.

## Closer sales assets
Upload own decks/one-pagers; one button pulls up presentation mode on a call.
Backed by the documents module (030) + entitlements. Slot: after Wave-2 merge.

## Call recording (Fathom or native)
Auto-record Zoom/Meet sales calls → transcript → `conversations` table →
Context Fetcher. Evaluate Fathom API vs. recall.ai-style bot. Feeds closer
coaching + the labeled dataset mindset.

## Recruiting pipeline (separate from affiliates)
Always-on hiring funnel: Sarah's lane (closers) + Chris's lane. LinkedIn
sourcing integration, own pipeline in `cards`/`pipelines` (seed 002 already
defines pipelines — add a Hiring pipeline row, not a new system).

## UX bar
"Never used a CRM → gets it in one minute." Every screen: one obvious job,
blockers first, no dead buttons without a tooltip that says when they go live.
Next.js port continues; today's v0 screens define the interaction pattern.
