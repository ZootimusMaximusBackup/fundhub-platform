# T11 test baseline

Measured by the T11 orchestrator on a CLEAN worktree of origin/main (c860b8c),
at /tmp/wt-T11-base, on 2026-08-18. macOS darwin 25.6.0, node from the repo's
own node_modules. Full output: /tmp/wt-T11-base/BASELINE.txt (38227 lines).

    # tests   5843
    # pass    5838
    # fail    2
    # skipped 3
    EXIT=1

## The two pre-existing failures (NOT caused by T11)

1. `scripts/journeys/generate.test.mjs:146` — "*** no route's gate is left unverified ***"
   Two routes' auth gates cannot be traced by the journey extractor:
     - finance/crs-pull
     - gifts/message-blaster
   Both are outside T11's ownership.

2. line 24636 — "an endpoint excused from the org filter still passes the
   session's org to its store"

Merge bar: no worse than this. T11 must not add a third failure and must not
add a name to the unverified-gate list.

## CONSTRAINT THIS PUTS ON T11's THREE NEW HANDLERS

scripts/journeys/extract.mjs:290-362 recognises ONLY these gate shapes. A new
handler that does not match one of them lands in the "unverified" list above and
makes failure #1 strictly worse:

  - `requirePrincipal(...)`  (optionally plus `const <X>ROLES = new Set([...])`)
  - `requireRole(res, staff, <IDENT>)` as the SECOND call after requireAuth —
    the regex is /requireRole\(\s*res\s*,\s*staff\s*,\s*([\w.]+)\s*\)/ so the
    variable MUST literally be named `staff` and the set MUST be a resolvable
    identifier (e.g. ROLE_SETS.FINANCE), not an inline array literal.
  - `requireAuth(req, res` alone (any signed-in employee)
  - signed-url / provider-signature / inngest / attachStaff / bearerToken
  - no session gate at all

api/social/channels.mjs, api/social/settings.mjs and api/brand/review.mjs must
each match one of these exactly. Verify with `npm test` after the routes land.
