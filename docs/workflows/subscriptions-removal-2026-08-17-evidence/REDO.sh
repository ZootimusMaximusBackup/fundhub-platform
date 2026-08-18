#!/usr/bin/env bash
# Re-apply the Subscriptions screen removal from a CLEAN working tree.
# Owner decision 2026-08-17: delete the screen, keep every API and table.
# Run from the repo root. Verified twice; suite went 18 failures -> 11
# (it fixed 2 pre-existing stale-sidebar suites and added none).
set -euo pipefail

# 1. the screen and the test that reads only that screen
git rm -q public/app/subscriptions.html src/http/subscriptions-screen.test.mjs

# 2. the nav row — canonical fragment ONLY, then regenerate all screens.
#    Never hand-edit the per-screen copies.
sed -i '' '/<a class="navitem" href="subscriptions.html">/d' public/app/sidebar.fragment.html
node scripts/sync-sidebar.mjs

# 3. shell.js — four lists plus the comments that exist only to explain the screen
python3 - <<'PY'
p='public/app/shell.js'; s=open(p).read()
a='    "finance-os.html", "subscriptions.html", "company-brain.html",\n'
assert a in s; s=s.replace(a,'    "finance-os.html", "company-brain.html",\n')
a='''    /* subscriptions.html is the one Finance-adjacent screen that survived the
       consolidation, because it isn't the client's money — it's Fundhub
       billing THE CLIENT for the service, same kind of thing as
       products-commissions.html one row down in Setup. Moved there instead of
       folded into Finance OS or deleted. Its own role gate (FINANCE, in
       OWNER_ADMIN_ONLY below) did not change, only which sidebar group it
       renders in. */
    "subscriptions.html",
'''
assert a in s; s=s.replace(a,'')
a='''     subscriptions.html IS here, unchanged by the Finance OS consolidation.
     /api/finance/subscriptions and /api/finance/cards both gate on
     ROLE_SETS.FINANCE — a subscription row carries a price and a payment
     instrument, which is the narrowest thing that API serves. It moved to the
     Setup group in the sidebar (next to products-commissions.html, since this
     is Fundhub billing the client rather than the client's own money), but the
     role gate that put it here never changed.

'''
assert a in s; s=s.replace(a,'')
a='  var OWNER_ADMIN_ONLY = [\n    "subscriptions.html",\n'
assert a in s; s=s.replace(a,'  var OWNER_ADMIN_ONLY = [\n')
a='''     The sidebar markup itself carries more rows than this: subscriptions
     .html, closer-call, my-numbers, and sales-floor sit in the markup so'''
assert a in s; s=s.replace(a,'''     The sidebar markup itself carries more rows than this: closer-call,
     my-numbers, and sales-floor sit in the markup so''')
a='    "subscriptions.html":        "client_id",\n'
assert a in s; s=s.replace(a,'')
open(p,'w').write(s); print("shell.js done")
PY

# 4. app-client-carry.test.mjs — REPOINT, never delete assertions.
#    finance-os.html sits in BOTH CLIENT_SCREENS and OWNER_ADMIN_ONLY, exactly
#    as subscriptions.html did, so every gate and carry case keeps a real screen.
python3 - <<'PY'
p='src/http/app-client-carry.test.mjs'; s=open(p).read()
a='    const screens = ["finance-os.html", "subscriptions.html"];\n'
assert a in s; s=s.replace(a,'    const screens = ["finance-os.html", "closer-dashboard.html"];\n')
a=''' * regression. subscriptions.html stayed, moved to Setup. The tests below used
 * to reach for whichever of those eleven happened to fit each scenario; they now
 * reach for finance-os.html or subscriptions.html, the two CLIENT_SCREENS this
 * app still has, since the mechanism under test — carrying the open client
 * across a query string — has nothing to do with which specific screen it runs
 * against.
'''
assert a in s; s=s.replace(a,''' * regression. subscriptions.html was deleted outright on 2026-08-17, also an
 * owner decision: client payment tracking belongs in Finance OS, which is being
 * rebuilt. The tests below now reach for finance-os.html, which sits in BOTH
 * CLIENT_SCREENS and OWNER_ADMIN_ONLY exactly as subscriptions.html did, so
 * every gate and carry case still has a real screen behind it. The mechanism
 * under test — carrying the open client across a query string — has nothing to
 * do with which specific screen it runs against.
''')
s=s.replace("subscriptions.html","finance-os.html")
open(p,'w').write(s); print("app-client-carry done")
PY

# 5. browser tests + the live verify script.
#    These are the FALSE GREENS: page.goto does not throw on 404 and the 404
#    body is visible, so they would keep "passing" against a deleted page.
python3 - <<'PY'
def edit(path, old, new):
    t=open(path).read(); assert old in t, "MISS "+path
    open(path,'w').write(t.replace(old,new,1)); print("ok:", path)
edit('e2e/sidebar-roles.spec.mjs',
     'const OWNER_ADMIN_ONLY = ["subscriptions.html", "journeys.html"];',
     'const OWNER_ADMIN_ONLY = ["journeys.html"];')
edit('e2e/screens-smoke.spec.mjs', '  "/app/subscriptions.html",\n', '')
edit('e2e/crm-flows.spec.mjs', '    "/app/subscriptions.html"\n', '')
edit('scripts/tmp-full-live-verify.mjs', '"subscriptions.html", ', '')
PY

# 6. docs that go wrong the moment this ships
python3 - <<'PY'
p='docs/SIDEBAR-STRUCTURE.md'; s=open(p).read()
a='| **Funding** | Lenders → Finance OS → Contracts → Subscriptions | Match a lender, read money, send the agreement, then Fundhub billing. |'
assert a in s; s=s.replace(a,'| **Funding** | Lenders → Finance OS → Contracts | Match a lender, read money, send the agreement. |')
a='| `subscriptions.html`, `journeys.html` | `owner` / `admin` |'
assert a in s; s=s.replace(a,'| `journeys.html` | `owner` / `admin` |')
open(p,'w').write(s); print("SIDEBAR-STRUCTURE done")

p='api/finance/cards.mjs'; s=open(p).read()
a='''/* ROLE_SETS.FINANCE — {owner, admin}. A payment instrument is the narrowest
   thing this API serves. It shares subscriptions.html, whose row in
   public/app/shell.js OWNER_ADMIN_ONLY mirrors this gate. */'''
assert a in s; s=s.replace(a,'''/* ROLE_SETS.FINANCE — {owner, admin}. A payment instrument is the narrowest
   thing this API serves. It had no screen of its own: it shared
   subscriptions.html, which was deleted on 2026-08-17 (owner decision — client
   payment tracking moves into Finance OS). The API and its gate are unchanged
   and still routed; whatever screen Finance OS grows for cards must carry the
   matching OWNER_ADMIN_ONLY row in public/app/shell.js. See
   docs/FINANCE-OS-REBUILD-HANDOVER.md. */''')
open(p,'w').write(s); print("cards.mjs done")
PY

echo
echo "NOW VERIFY:"
echo "  npm run lint"
echo "  npm test          # compare failures against a baseline taken FIRST"
echo "  node --test src/http/routes.test.mjs src/http/app-nav-reachability.test.mjs \\"
echo "              src/http/app-nav-matches-shell.test.mjs src/http/app-client-carry.test.mjs"
echo
echo "DO NOT delete: any api/, any db/migrations, src/subscriptions/*,"
echo "  src/handlers/payment-links.mjs. See docs/FINANCE-OS-REBUILD-HANDOVER.md."
