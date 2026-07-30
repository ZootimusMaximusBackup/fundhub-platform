# Audit findings — independent sign-off pass

## STATUS: all blocking, high, medium and low findings are FIXED.

Every finding below has been addressed, verified and pushed. The git log from
`Independent audit: 53 findings` to `Wire the tenancy boundary` is the record.
This document is kept as written — including the findings' original wording —
because the *shape* of the mistakes is more useful than the list.

Verification at close:

```
1348 tests · 1340 pass · 0 fail · 8 skipped   (was 1178 at the start)
1127 tests pass with DATABASE_URL unset — pg tests skip cleanly
33 migrations apply clean from scratch; re-run applies 0
216 hostile-input cases  · 0 problems
119 leak-sweep cases     · 0 leaking 5xx
full outage matrix       · no leaks, nobody told they are signed out
all 7 webhook providers  · 401 unsigned, none 500, none accepting
20 app screens driven in Chromium · 0 console errors, 0 failed requests
layout identical to the pre-wiring commit on every wired screen
```

Four things remain OPEN and are deliberate, not oversights:

1. **Nothing transmits.** `sendTemplated` writes `messages` rows with
   `status='queued'` and nothing sends them — there is no outbound fetch in
   `src/adapters/` or `src/lib/`. Turning on the Inngest keys runs 47 workflows
   and produces zero SMS or email. Needs a provider decision.
2. **Six screens have no data source** — see HANDOFF. Each needs a modelling
   decision first, not wiring.
3. **`inquiry-remover` and `brand-studio` read but do not fully write.** There is
   no write endpoint for `inquiry_log`.
4. **`DATABASE_URL` and the Inngest keys are operator actions.**

The five most useful lessons, in the order they cost the most time:

1. **A fake that models the schema you wish you had cannot fail when the schema
   moves.** Every money path now has a `*.pg.test.mjs` against real Postgres.
2. **A structural check can pass over a half-dead feature.** `diagrams:check`
   reported "up to date" for an adapter that answered 404.
3. **"Absent config" must never mean "no gate."**
4. **Banner tone plus "no console errors" does not mean a screen works.** Ask
   whether the data is visible in the right element and survives the screen's own
   controls.
5. **Mutation-test the OVER-broad direction too.** Several tests here asserted
   the defect — "fails open w/o signing key", "re-purchasing reinstates" — and
   passed happily for months.

---

Produced by a seven-lens adversarial audit run against main at `a2625f9`, after the
build queue was declared complete. Every lens ran on its own scratch Postgres and was
required to RUN its checks rather than reason about them.

**Headline: the build queue is done, but the system is not shippable as-is.** The unit
tests are green and largely meaningful; the defects are concentrated at the seams the
unit tests fake out — the Netlify adapter, the schema/code boundary, and the
screen/DOM boundary.

Status key: **[V]** independently verified by two adversarial skeptics.
**[U]** reported by one lens with evidence, not yet independently re-verified
(the verification budget covered the 8 most severe).

---


## BLOCKING

### [V] Every inbound provider webhook returns 500 on Netlify — the adapter's req is not a stream, and APPLY-NOTES.md says the route works

`api/webhooks/[provider].mjs:18` · lens: Route reachability and liveness: every ROUTES entry in netli

**What is wrong.** api/webhooks/[provider].mjs reads its body with `for await (const chunk of req)`, but netlify/functions/api.mjs hands handlers a plain object literal, not a Node stream. Every POST /api/webhooks/* on the Netlify deploy target throws TypeError before signature verification and is converted to a 500. The adapter already computes the correct `rawBody` string (api.mjs:110) and simply never passes it.

**How it fails.** Commas POSTs a signed payment.succeeded webhook to https://<site>.netlify.app/api/webhooks/commas. readRawBody() iterates the adapter's plain-object req, throws `req is not async iterable`, api.mjs's catch returns 500. The payment is never verified, never emitted on the bus, never written to transactions. Identical for twilio (inbound SMS), mailgun (bank inbox), calcom (bookings), bland (voice calls) and clickfunnels (funnel entry/survey) — the platform's entire inbound integration path. Providers retry, then dead-letter on their side; nothing lands in the dead-letter queue here because the handler never reaches the bus. APPLY-NOTES.md:95 tells the operator "Webhooks route exists on Netlify too (/api/webhooks/:provider) but providers still point at the old URLs — repointing is a separate, deliberate step", so following the documented cutover step silently destroys every inbound event.

**Evidence.** Through the real adapter (all providers, both URL shapes, valid HMAC signature):
  500 POST /api/webhooks/commas        {"ok":false,"error":"internal_error","message":"req is not async iterable"}
  500 POST /api/webhooks/twilio        (same; also with content-type: application/x-www-form-urlencoded)
  500 POST /api/webhooks/mailgun / calcom / bland / clickfunnels  (same)
  500 POST /.netlify/functions/api/webhooks/commas               (same)

Root cause isolated — the underlying stack is fine, only the Netlify shim is wrong:
  A) src/http/router.mjs handleWebhook() with rawBody   -> 200 {"ok":true,"emitted":[{"name":"payment.received",...}]}
  B) api/webhooks/[provider].mjs with a real stream req -> 200 {"ok":true,"emitted":[...]}
  C) same handler, the exact req netlify/functions/api.mjs builds:
       req[Symbol.asyncIterator] === undefined
       THREW TypeError: req is not async iterable
       (adapter already built rawBody: "{\"event\":\"payment.succeeded\",..." and never passes it)

netlify/functions/api.mjs:6 asserts "Handlers here only ever use res.status().json() / setHeader / end" — factually wrong for this handler, which reads the request stream. No test covers the adapter (src/http/data-js.test.mjs only mocks fetch), so npm test stays green.

### [V] Every provider webhook returns 500 on the Netlify function — the deployed adapter hands the handler a plain object, not a stream

`api/webhooks/[provider].mjs:18` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** `readRawBody()` does `for await (const chunk of req)`, but netlify/functions/api.mjs builds `req` as a plain object with `body`/`rawBody` and no async iterator. The call is also outside the handler's try block, so it escapes to the adapter's generic catch and every POST to /api/webhooks/{commas,twilio,mailgun,calcom,bland,clickfunnels} answers 500 before signature verification is ever reached. Netlify is the only deployed target (netlify.toml, HANDOFF §3), and APPLY-NOTES.md:95 states the route works there.

**How it fails.** Commas POSTs a payment.received webhook to https://<site>.netlify.app/api/webhooks/commas. The function answers 500 {"error":"internal_error","message":"req is not async iterable"} and emits nothing onto the event bus. The payment is silently lost; the provider sees a 5xx and retries into the same 500. Identical for Twilio SMS, Cal.com bookings, Mailgun, Bland calls and ClickFunnels entries — all six inbound integrations are dead on the deployed target.

**Evidence.** $ node webhook.mjs
vercel-shaped req  -> 401 {"ok":false,"status":401,"reason":"bad_signature","emitted":[]}
netlify adapter    -> commas         500 {"ok":false,"error":"internal_error","message":"req is not async iterable"}
netlify adapter    -> twilio         500 {...same}
netlify adapter    -> mailgun        500 {...same}
netlify adapter    -> calcom         500 {...same}
netlify adapter    -> bland          500 {...same}
netlify adapter    -> clickfunnels   500 {...same}

The handler itself is fine — given a Node Readable (the Vercel shape) it correctly rejects an unsigned body with 401 bad_signature. The break is purely the adapter contract. No test in src/ drives netlify/functions/api.mjs (grep: only a string comparison in src/http/data-js.test.mjs:76), which is why this passes CI.

Docs that are factually wrong as a result: APPLY-NOTES.md:95 "Webhooks route exists on Netlify too (/api/webhooks/:provider) but providers still point at the old URLs — repointing is a separate, deliberate step" (repointing would produce 500s, not traffic); netlify.toml:3 "when that account clears, both targets work".

### [V] calendar.html paints the live schedule into a hidden "Demonstration states" drawer — visible calendar is 100% sample under a mint "live schedule" banner

`public/app/calendar.html:953` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** The wire target is document.getElementById("demoBody"), which is the collapsed, hidden <div class="demo-body" id="demoBody" hidden> demonstration-states section (calendar.html:777). The real dated tasks are written there and are invisible; the day view, week strip and BOOKED/DONE/NO-SHOW/SHOW RATE tiles stay entirely sample, while the banner turns mint and claims live data.

**How it fails.** Three tasks exist with due_at set. The screen shows a mint banner "live schedule · 3 dated task(s)" while displaying a fabricated Sunday July 26 with Trevor Nakamura / Amara Nwosu / Marcus Ibe / Maria Delgado / Devon Marsh appointments that do not exist in the database. None of the three real tasks appears anywhere on the visible page. A user trusts the mint badge and works a fictional calendar.

**Evidence.** In-browser evaluate after load against the seeded DB:
{"demoBodyHidden": true, "demoBodyOffsetParentNull": true,
 "demoBodyHTML": "Thu, Jul 30 Call Grace about deposit Grace Hopper closer Fri, Jul 31 Collect bank statements Ada Lovelace funding_advisor Sun, Aug 2 Dispute Discover inquiry Alan Turing inquiry_specialist",
 "demoToggleLabel": "DEMONSTRATION STATES double-booking alert · empty day · open hour ▾",
 "realTaskTitlesVisibleInBodyText": [],
 "banner": ["live schedule · 3 dated task(s)"],
 "dayViewSample": true}
realTaskTitlesVisibleInBodyText is empty: zero real rows are visible. The paint also destroys the demonstration content the toggle advertises.

### [V] /api/dashboard/* serves client PII and accepts writes with no credential of any kind

`src/http/dashboard-auth.mjs:13` · lens: authentication and tenancy

**What is wrong.** `checkDashboardAuth()` returns `true` whenever `DASHBOARD_SECRET` is unset and `NODE_ENV !== "production"`, so the four `/api/dashboard/*` routes fall through to a fully open path: they answer an anonymous request, a request carrying an expired or revoked staff token, and a request carrying a client/affiliate/partner account session, all identically.

**How it fails.** With no `Authorization` header at all: `GET /api/dashboard/clients` -> 200 with the full client book (names, emails, journey flags, message metadata); `GET /api/dashboard/client?id=<uuid>` -> 200 with that client's phone, transactions, CRS results, message bodies, tasks, funding rounds and invoice balances; `POST /api/dashboard/seed` -> 200 and WRITES a new client plus a full lifecycle event chain into the database. The same 200s come back for a revoked staff session and for a client-account session. This is the exact configuration the repo produces: HANDOFF.md's "Get running locally" sets neither variable, and `netlify.toml` - the live deploy config - sets neither either (only NODE_VERSION), while DEPLOY.md documents the DASHBOARD_SECRET/NODE_ENV pair only for the Vercel target. Today the deployed site is masked by HANDOFF's documented "no DATABASE_URL in production" (the query throws before returning rows); the moment DATABASE_URL is set - the documented next step - the client book is world-readable.

**Evidence.** $ curl -s -i http://127.0.0.1:18971/api/dashboard/clients | head -3
HTTP/1.1 200 OK
content-type: application/json

$ curl -s http://127.0.0.1:18971/api/dashboard/clients
{"ok":true,"count":9,"clients":[{"id":"26bba751-...","first_name":"Dana","last_name":"Cruz","email":"sample+1785390386238@fundhub.demo","outcome_tier":"FUNDING_PLUS_REPAIR",...

$ curl -s -X POST http://127.0.0.1:18971/api/dashboard/seed      # no headers whatsoever
{"ok":true,"seeded":{"id":"1a6cb51a-1478-4edf-bc83-67aba02c3a8b","email":"sample+1785391063233@fundhub.demo","outcome_tier":"PREMIUM_STACK"}}

Matrix row (columns = no-token, owner, admin, ..., client-acct, affiliate-acct, partnerA, partnerB):
GET /api/dashboard/clients            200 200 200 200 200 200 200 200 200 200 200 200
GET /api/dashboard/client?id=...      200 200 200 200 200 200 200 200 200 200 200 200
GET /api/dashboard/pipeline           200 200 200 200 200 200 200 200 200 200 200 200
POST /api/dashboard/seed              200 200 200 403 403 403 403 403 200 200 200 200

Expired staff session still gets in via the same path:
EXPIRED staff -> /api/auth/session 401 | /api/tasks 401 | /api/read/commissions 401 | /api/dashboard/clients 200

Isolated the cause by re-running the same harness under three envs:
NODE_ENV=production, no secret : /api/dashboard/clients 401, /api/dashboard/pipeline 401, POST seed 401
DASHBOARD_SECRET=supersecret   : 401 without the key, 200 with ?key=supersecret
default (neither set)          : 200 for everything, no credential needed

### [V] 031_invoices.sql renamed three invoice columns and no code followed: createInvoice/markSent are dead, taking the F-07 and DS-02 workflows down with them

`src/invoices/index.mjs:27` · lens: schema integrity

**What is wrong.** Migration 031_invoices.sql renamed invoices.amount -> amount_due, provider_ref -> external_ref and issued_at -> sent_at, but src/invoices/index.mjs — the only writer of the invoices table in the entire codebase — was never updated. createInvoice() (line 27) and markSent() (line 46) now fail with Postgres error 42703 on every call. Both registered Inngest workflows that create invoices (f-07-funding-locked, ds-02-diy-letters) throw at that step against real Postgres. Their unit tests are green only because they run against in-memory fakes (src/workflows/test-support.mjs pgFake, and the stub inside src/invoices/index.test.mjs) that still model the pre-031 column names — the exact 'structural check passes while the feature is half-dead' failure mode.

**How it fails.** A round.funded event reaches F-07 in any environment with a real DATABASE_URL. The workflow sets the funding-locked date, sends the client email and the SMS, then hits step 'create-success-fee-invoice' and throws `column "amount" of relation "invoices" does not exist`. The client has been told they are funded, but no success-fee invoice row and no invoice task are ever created — the fee is silently never billed. DS-02 is worse: createInvoice is step 2 of the workflow, so a sale.paid event dies before 'deliver-letters', 'send-email' and 'tag-diy-letters' — a paying DIY client receives no letters, no email and no tag. Because createInvoice and markSent are the only producers of invoice rows and the only draft->sent transition, the whole AR surface downstream (v_invoice_aging, v_invoice_balance, /api/read/invoices) can never have a single row to report on; shared dev confirms invoices has 0 rows.

**Evidence.** Ran every export against real Postgres on a freshly migrated DB:
  $ node /tmp/signoff-scratch/inv-all.mjs
    FAIL  createInvoice  [42703] column "amount" of relation "invoices" does not exist
    FAIL  markSent       [42703] column "issued_at" of relation "invoices" does not exist
    OK    markPaid / voidInvoice / getInvoice

End-to-end proof the live workflow breaks (real db, real client, real step runner):
  $ node /tmp/signoff-scratch/f07-real.mjs
    f-07 handle THREW [42703]: column "amount" of relation "invoices" does not exist

The renames that caused it (db/migrations/031_invoices.sql:69,77,85):
  ALTER TABLE invoices RENAME COLUMN amount TO amount_due;
  ALTER TABLE invoices RENAME COLUMN provider_ref TO external_ref;
  ALTER TABLE invoices RENAME COLUMN issued_at TO sent_at;

Applied schema has no such columns (psql \d invoices): amount_due, external_ref, sent_at — no 'amount', no 'provider_ref', no 'issued_at'.

Only the renames are at fault — the NOT NULL 'source' column is auto-derived by trg_invoices_sync_legacy_type, proven by inserting with corrected names and omitting source:
  $ psql -c "INSERT INTO invoices (org_id,client_id,invoice_type,amount_due,currency) ..."
    insert with CORRECTED names succeeded; source auto-derived=other invoice_type=platform_fee

Root cause — the migration shipped alone, with no code change:
  $ git log --oneline --name-only -1 07373a3
    07373a3 031: invoice model — money owed, with a balance that cannot drift
    db/migrations/031_invoices.sql      <-- only file in the commit

Only writer in the tree:
  $ grep -rn "INSERT INTO invoices" --include=*.mjs src api scripts | grep -v test
    src/invoices/index.mjs:27

Why no test catches it: src/invoices/index.test.mjs builds an in-memory stub storing `amount`/`provider_ref`/`issued_at` (pre-031 names), and src/workflows/f-07-funding-locked.test.mjs uses pgFake from test-support.mjs. Full suite against my own migrated DB is green: 1210 tests, 0 fail, 8 skipped, exit 0.

Not a documented gap: `grep -ci invoice` returns 0 for HANDOFF.md, VERIFICATION.md, APPLY-NOTES.md, README.md, PRODUCT-BACKLOG.md and DEPLOY.md.

Secondary doc inaccuracy from the same root cause — 031_invoices.sql:148 states the legacy column is kept truthful so "any writer still passing the old vocabulary keeps working". The only such writer does not keep working; it fails at parse time on the renamed amount column.

### [V] createInvoice writes to columns migration 031 renamed — every invoice write throws, and it kills DS-02 and F-07 mid-workflow

`src/invoices/index.mjs:27` · lens: Replay safety and money correctness — every INSERT path into

**What is wrong.** 031_invoices.sql renamed `amount`→`amount_due`, `provider_ref`→`external_ref`, `issued_at`→`sent_at` and added a NOT NULL `source` column, but src/invoices/index.mjs was never updated. createInvoice (line 27) and markSent (line 47) raise SQLSTATE 42703 on every call against the real schema, so the only writer of the `invoices` table cannot write a row — and because the invoice step sits in the middle of both calling workflows, everything after it is dead too.

**How it fails.** A REPAIR_ONLY client pays for the $1,000 DIY package. Commas emits payment.received, DS-02 fires, sets diy_status='Processing', then calls createInvoice → 42703. The step throws and the handler aborts: no invoice, no "Send DIY invoice" task, no letter-delivery POST to underwrite-iq-lite, no ready email, no client:diy-letters tag. The client is left permanently at diy_status='Processing' having paid $1,000. F-07 is worse ordered: on a fee-ready round.funded it sends the client the "funding locked" email and SMS first, THEN throws on the invoice, so the client is told funding is locked and neither the invoice nor the "Invoice client" task ever exists.

**Evidence.** $ node -e '<call every exported fn against the migrated DB>'
createInvoice(deposit): THREW 42703 — column "amount" of relation "invoices" does not exist
markSent:               THREW 42703 — column "issued_at" of relation "invoices" does not exist
markPaid: OK   voidInvoice: OK   getInvoice: OK

--- DS-02 end to end on real Postgres (REPAIR_ONLY client, DIY product) ---
ds-02 THREW: 42703 column "amount" of relation "invoices" does not exist
downstream steps after the invoice step: {"invoices":0,"tasks":0,"messages":0,"tags":{"tags":[],"d":"Processing"}}  letter-delivery POSTs: 0

--- F-07 with a fee-ready round.funded payload ---
f-07 THREW: 42703 column "amount" of relation "invoices" does not exist

$ psql -c '\d invoices'   →  amount_due numeric(14,2) NOT NULL,  external_ref, sent_at,  source text NOT NULL  (no `amount`, no `provider_ref`, no `issued_at`)

Why the suite is green:
$ node --test src/invoices/index.test.mjs src/workflows/ds-02-diy-letters.test.mjs src/workflows/f-07-funding-locked.test.mjs
# tests 25 # pass 25 # fail 0
src/invoices/index.test.mjs:18 matches `s.startsWith("INSERT INTO INVOICES")` on an in-memory stub and asserts on an `amount` field it invents itself; src/workflows/test-support.mjs pgFake has no `invoices` branch at all and falls through to `return { rows: [] }` (test-support.mjs:~265), so the workflow tests see the failed write as a silent success. The READ side was migrated — api/read/invoices.mjs:14 already selects `amount_due` — which is what makes this one-sided drift rather than a naming choice. Note `source` is NOT NULL with no default, so renaming amount→amount_due alone still will not insert.


## HIGH

### [U] HANDOFF.md lists content-admin as having "no table", but products and entitlement_catalog are both migration-seeded sources for it — the exact inquiry-remover mistake, repeated

`HANDOFF.md:91` · lens: Factual accuracy of HANDOFF.md and VERIFICATION.md — every f

**What is wrong.** The blocked-screens table says `content-admin` needs "the tier/tile content model has no table", and VERIFICATION.md:175 asserts the other five blocked screens were "Re-checked ... against the schema rather than the notes. They are genuinely blocked." Checking the schema shows content-admin's tier list maps 1:1 onto the populated `products` table and its locked-tile catalog maps onto the populated `entitlement_catalog` table. Both are seeded by migrations, so they are present on every fresh database, and both already have shipped read endpoints. Only the welcome-video library genuinely lacks a table.

**How it fails.** A new engineer reads HANDOFF.md:91 and VERIFICATION.md:175, believes content-admin is blocked on a modelling decision, and either leaves it unwired or designs and migrates a new tier/tile table. That new table duplicates `products` and `entitlement_catalog`, which are already the source of truth and already seeded with the same five rows — producing a second, drifting copy of the product ladder and the deliverable catalog. This is the same failure the repo already had with inquiry-remover (commit a2625f9, "the screen I had wrongly recorded as blocked"), where the note had checked the endpoint and never checked the schema.

**Evidence.** All 4 content-admin TIERS match products by exact name:
$ psql -d audit_docs -c "select ... from (values ('Card Stacking DFY'),('Consulting Services Package'),('Credit Repair Bundle'),('Inquiry Removal')) t(n) left join products p on lower(p.name)=lower(t.n)"
TIER-MATCH: Inquiry Removal -> products.code=inquiry-removal
TIER-MATCH: Consulting Services Package -> products.code=consulting-package
TIER-MATCH: Credit Repair Bundle -> products.code=repair-bundle
TIER-MATCH: Card Stacking DFY -> products.code=card-stacking-dfy

TILES match entitlement_catalog (which is populated, 5 rows):
TILE-MATCH: Credit Optimization Roadmap -> catalog.code=credit-optimization-roadmap
TILE-MATCH: Metro 2 Dispute Letter Pack -> catalog.code=metro2-letter-pack
(the other two tiles, "Consulting Services Package" and "Inquiry Removal", are products rows)

Both are seeded by migrations, not by me:
$ grep -c 'INSERT INTO entitlement_catalog' db/migrations/032_entitlements.sql -> 1
$ grep -c 'INSERT INTO products' db/migrations/015_seed_products.sql -> 1

content-admin's tile price 1000 for "Consulting Services Package" equals products.default_price=1000.00.

Read endpoints already exist. api/read/entitlements.mjs header line 1:
  "// GET /api/read/entitlements — what a client holds, and what is still locked — the upsell surface"
which is precisely content-admin's locked-tile editor. api/read/products.mjs returns code/name/description/default_price/sort_order.

Only genuinely absent piece: no video/media/content table exists —
$ select ... where table_name ~* 'video|media|content' -> VIDEOS TABLE: NONE

### [U] HANDOFF.md's opening summary gives the wrong screen counts and contradicts its own detail section 70 lines later

`HANDOFF.md:9` · lens: Factual accuracy of HANDOFF.md and VERIFICATION.md — every f

**What is wrong.** The one-line summary says "14 of 21 screens read real data" and "What remains is 7 screens with no data source yet". The measured figures are 15 wired and 6 unwired, which is what the document's own section 1 says ("### 1. Six screens are still on sample data", "**15 of 21** read real data" with 15 names listed, and a 6-row blocked table). VERIFICATION.md:186 also says 15. The summary is the outlier and it is wrong in both numbers.

**How it fails.** The summary is the first thing a new engineer reads and the only part many will read. Believing 7 screens are unwired, they go looking for a seventh blocked screen that does not exist, or they conclude one of the 15 verified-wired screens has regressed and start debugging working code. The two numbers in the same document disagree, so the reader also cannot tell which to trust.

**Evidence.** Measured directly — 21 screens in public/app, split by whether they load data.js and call FHData.*:
$ for f in public/app/*.html; do ... done
WIRED: affiliate, agent-editor, brand-studio, calendar, client-control-panel, client-portal, command-center, documents, inquiry-remover, messaging, ops-admin, partner-galaxy, pipeline, products-commissions, staff-teams = 15
UNWIRED: automations, closer-dashboard, content-admin, galaxy, index, sample-data = 6

The 15 measured names are byte-for-byte the 15 listed at HANDOFF.md:78-81.

So HANDOFF.md:9 ("14 of 21", "7 screens") contradicts HANDOFF.md:76 ("### 1. Six screens"), HANDOFF.md:78 ("**15 of 21**"), and VERIFICATION.md:186 ("15 of 21 screens verified in Chromium").

### [U] The "5 minutes, verified from scratch" setup has no step that serves the API, so the seeded logins are rejected with "Wrong email or password" and no screen can reach real data

`HANDOFF.md:15` · lens: Factual accuracy of HANDOFF.md and VERIFICATION.md — every f

**What is wrong.** Steps 1-4 of the local setup work exactly as written. Step 5 (`npx http-server public`) serves static files only — nothing in the section, or anywhere else in the repo's docs, starts the `api/` handlers. The result is that /api/* 404s, the app bounces every screen to login.html, and signing in with the credentials step 3 just told you to create fails with the message "Wrong email or password." Zero of the 21 screens can read real data under the documented setup, despite the document's headline claim that 15 do.

**How it fails.** A new engineer runs the five steps verbatim tonight. Migrations apply, six staff accounts are created with the password they chose. They open http://127.0.0.1:8899/login.html, type that exact password, and are told the password is wrong. The failure message points at credentials, so they re-run seed-staff.mjs with --reset-passwords, check the scrypt hash, and suspect the auth code — none of which is the problem. The actual cause (no API server was ever started) is never stated anywhere in HANDOFF.md, README.md, DEPLOY.md or APPLY-NOTES.md.

**Evidence.** Followed the steps literally against scratch db audit_docs. Steps 1-4 pass (33 migrations applied, 6 accounts created, 1210 tests green).

Step 5 serves static files but no API:
$ curl -o /dev/null -w '%{http_code}' http://127.0.0.1:8917/login.html   -> 200
$ curl -o /dev/null -w '%{http_code}' http://127.0.0.1:8917/api/read/staff -> 404
$ curl -o /dev/null -w '%{http_code}' http://127.0.0.1:8917/api/health     -> 404

Chromium (playwright), navigating to a wired screen:
  final URL: http://127.0.0.1:8917/login.html?next=/app/staff-teams.html
  [api] 404 /api/auth/session   [api] 404 /api/read/staff?limit=200

Chromium, signing in with the step-3 seeded credentials (chris@fundhub.ai / auditpassword123 — the same password login() accepts programmatically, 6/6 OK):
  [api] 405 /api/auth/login
  page msg: "Wrong email or password."
  token stored: null

No local API server exists or is documented:
$ which netlify vercel -> (nothing)
$ ls scripts/ -> create-staff, demo-journey, extract-airtable, gen-custom-field-migration, seed-staff (no serve/dev script)
$ grep -in 'http-server|localhost|netlify dev|npm start' README.md APPLY-NOTES.md DEPLOY.md -> (no matches)

### [U] POST /api/auth/logout returns ok:true but never revokes a client/affiliate/partner session

`api/auth/logout.mjs:14` · lens: authentication and tenancy

**What is wrong.** The handler calls only `revokeSession()`, which updates the staff `sessions` table. `revokeAccountSession()` exists in src/auth/account-session.mjs but has zero production call sites, so an account token survives logout with its full 7-day sliding TTL while the endpoint reports success.

**How it fails.** A client, affiliate or partner signs out on a shared or public machine. `POST /api/auth/logout` answers `{"ok":true}` and clears the cookie, but `account_sessions.revoked_at` stays NULL and the bearer token keeps authenticating - and keeps sliding its expiry forward on every use. Anyone who recovers the token (browser storage, proxy log, XSS) holds a live session indefinitely, and there is no code path anywhere in the product that can revoke it. There is also no account equivalent of `revokeAllForStaff`, so "sign out everywhere" and "revoke on password change" do not exist for three of the four principal kinds.

**Evidence.** $ grep -rn "revokeAccountSession" --include=*.mjs . | grep -v node_modules
src/auth/account-session.mjs:77:export async function revokeAccountSession(db, token) {
src/auth/account-session.pg.test.mjs:204:    assert.equal(await revokeAccountSession(db, out.token), true);
(no production caller)

Driven against the live harness:
login ok, kind = partner
verifyAccountSession BEFORE logout: VALID (partner)
POST /api/auth/logout -> 200 {"ok":true}
verifyAccountSession AFTER  logout: STILL VALID (partner) <-- session survived logout
account_sessions.revoked_at: null
STAFF sessions.revoked_at after logout: 2026-07-30T05:50:40.206Z    <-- staff path works, account path does not

And over HTTP, post-logout the token still resolves as a principal (403 "this endpoint serves staff", not 401):
after logout /api/tasks: {"status":403,"body":"{\"ok\":false,\"error\":\"forbidden\",\"message\":\"this endpoint serves staff\"}"}
(contrast: expired session -> 401, suspended account -> 401)

### [U] /api/inngest is not registered in the Netlify router — all 47 workflow functions are unreachable on the deploy target

`netlify/functions/api.mjs:40` · lens: Route reachability and liveness: every ROUTES entry in netli

**What is wrong.** api/inngest.mjs is the only handler under api/ absent from ROUTES, so GET/POST /api/inngest returns 404 on Netlify. This is a separate gap from the documented "Inngest keys unset": setting INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY does not make the workflows live, because Inngest has no endpoint to sync or invoke.

**How it fails.** An operator follows HANDOFF.md:167, which frames enabling workflows as "an operator action, not a commit", sets both Inngest keys on Netlify, then syncs the app endpoint at https://<site>.netlify.app/api/inngest as .env.example:7 and DEPLOY.md:51 instruct. Inngest gets 404 {"ok":false,"error":"not_found","path":"inngest"}, registers zero functions, and every one of the 47 workflows stays inert with no error surfaced anywhere in the platform. The operator believes the workflow layer is live; it is not, and no code change was thought to be needed.

**Evidence.** Handler-file vs ROUTES diff: 24 ROUTES keys, 0 pointing at a missing file; the only unregistered handler is api/inngest.mjs.

Through the real adapter:
  404 GET  /api/inngest   {"ok":false,"error":"not_found","path":"inngest"}
  404 POST /api/inngest   {"ok":false,"error":"not_found","path":"inngest"}

The handler itself is healthy — called directly with the adapter's own req/res shape it answers:
  end 200 {"has_event_key":false,"has_signing_key":false,"function_count":47,"mode":"dev",...}
So all 47 functions are registered and serveable; only the route-table entry is missing. netlify.toml bundles only netlify/functions/, so api/inngest.mjs is never deployed as its own function either.

Docs that are wrong for the live target: .env.example:7 "(47 functions at /api/inngest)", DEPLOY.md:41/51, and HANDOFF.md:159-167, which lists only the unset keys as the remaining gate.

### [U] /api/inngest is not registered in the Netlify function — 404 on every method, so the 47 workflows can never be turned on there

`netlify/functions/api.mjs:40` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** The ROUTES map registers 24 handlers and the webhooks fallback, but `api/inngest.mjs` (the `serve()` endpoint for all 47 workflow functions) is neither imported nor mapped. On the Netlify target /api/inngest 404s for GET, POST and PUT — Inngest can never sync the app or invoke a function. This is a wiring gap, not the documented "Inngest keys unset" gap: setting the keys cannot fix a route that does not exist.

**How it fails.** An operator follows HANDOFF §4 — 'setting those keys turns 47 functions live ... an operator action, not a commit' — and sets INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY on Netlify. Inngest's dashboard sync PUTs https://<site>.netlify.app/api/inngest and receives 404 {"error":"not_found","path":"inngest"}. No function is registered, no function ever fires, and the operator has no signal beyond the sync failure. The commit HANDOFF says is not needed is in fact required.

**Evidence.** $ node methods2.mjs
/api/inngest    GET=404 POST=404 PUT=404 DELETE=404 PATCH=404 HEAD=404 OPTIONS=404
body: {"ok":false,"error":"not_found","path":"inngest"}

netlify/functions/api.mjs imports 24 handlers (lines 12-36) and maps them at lines 40-65; "inngest" appears in neither list. api/inngest.mjs exists and exports `serve({client: inngest, functions})`. The only non-mapped path the adapter tolerates is the `webhooks/` prefix (line 90).

Contradicted doc: HANDOFF.md:167 "an operator action, not a commit".

### [U] A database outage leaks the database host and port to an unauthenticated caller

`netlify/functions/api.mjs:158` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** Three error paths echo `err.message` verbatim instead of using the existing `safeError()` scrubber: the adapter's generic catch (line 158), api/dashboard/clients.mjs:86, and api/dashboard/pipeline.mjs:106. A pg connection failure puts the DSN host:port straight into the driver message, so it reaches the client. /api/auth/login is unauthenticated, so this is world-readable.

**How it fails.** Postgres becomes unreachable (Neon suspend, network partition, wrong DATABASE_URL). An anonymous caller POSTs {} to /api/auth/login and gets back 500 {"error":"internal_error","message":"connect ECONNREFUSED 127.0.0.1:5999"} — the production database endpoint and port. With a Neon DSN the same path yields the full `ep-<project>.<region>.aws.neon.tech` hostname via getaddrinfo ENOTFOUND. src/http/health.mjs:safeError() exists precisely to prevent this and is applied on /api/health and /api/dashboard/client, but not here.

**Evidence.** $ DATABASE_URL=postgres://fundhub:localdev@127.0.0.1:5999/audit_hostile node outage.mjs
200 GET  /api/health           {"state":"unreachable","error":"connect ECONNREFUSED [redacted]"}      <- correctly scrubbed
500 GET  /api/dashboard/clients {"ok":false,"error":"connect ECONNREFUSED 127.0.0.1:5999"}            <- LEAK
500 GET  /api/dashboard/client?id=... {"error":"connect ECONNREFUSED [redacted]"}                     <- correctly scrubbed
503 GET  /api/dashboard/pipeline {"ok":false,"db":"down","error":"connect ECONNREFUSED 127.0.0.1:5999"} <- LEAK
500 POST /api/auth/login        {"error":"internal_error","message":"connect ECONNREFUSED 127.0.0.1:5999"} <- LEAK, unauthenticated

api/dashboard/seed.mjs:56 has the same raw `error: err.message`.

### [U] Netlify function adapter echoes raw error messages — unauthenticated POST /api/auth/login leaks the database host and port

`netlify/functions/api.mjs:158` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** The adapter's catch-all returns { error: "internal_error", message: err?.message } verbatim for any handler that throws. api/auth/login.mjs has no try/catch, so a database failure surfaces the raw driver message to an anonymous caller. src/http/health.mjs already redacts exactly this string, so the redaction exists and is not applied on this path.

**How it fails.** An anonymous request to POST /api/auth/login on the deployed site while the database is down (or DATABASE_URL is unset, which HANDOFF.md:150 says is the current production state) returns 500 with the internal connection detail. The same message is also rendered to the user in pipeline.html's bottom banner.

**Evidence.** curl -X POST /api/auth/login (no auth) against DATABASE_URL=…127.0.0.1:59999:
  500 {"ok":false,"error":"internal_error","message":"connect ECONNREFUSED 127.0.0.1:59999"}
curl same against DATABASE_URL unset:
  500 {"ok":false,"error":"internal_error","message":"DATABASE_URL not set"}
Route sweep on the same server also leaked it: /api/dashboard/clients -> 500 {"error":"connect ECONNREFUSED 127.0.0.1:59999"}; /api/dashboard/pipeline -> 503 same string.
For contrast /api/health -> 200 {"error":"connect ECONNREFUSED [redacted]"} — redaction applied there only.
Rendered in the UI: pipeline.html banner read "sample board — backend unavailable (nodb: connect ECONNREFUSED 127.0.0.1:59999)".

### [U] documents.html: every filter, search and sort interaction replaces the real rows and real KPI tiles with sample data while the mint banner stays up

`public/app/documents.html:342` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** The live wire (line 413) replaces #body with real rows and sets the KPI tiles. The screen's own render() (line 342) rebuilds #body from the sample DOCS array and renderStats() (line 365) rewrites kTotal/kSign/kUndel/kOld/kOldWho from DOCS. render() is bound to statusFilter change, #q input, #pendingBtn click, every sortable <th>, and every class tab/chip (lines 303, 312, 386-388). Nothing re-runs the wire, so the banner keeps saying "live".

**How it fails.** Three real documents load, banner mint "live documents · 3 records". The user clicks the "Invoices" class tab to narrow the list. The table is replaced by 7 sample invoices that do not exist in the database; "All" gives 38 sample rows. The banner still reads "live documents · 3 records" in mint. The user is now reading fabricated documents believing they are database rows.

**Evidence.** Playwright, seeded DB:
initial rows: [["Invoice 9001 — Ada Lovelace","invoice_document","generated","Jul 29, 26","—"], ["DS-02 Letter — Grace Hopper",…], ["Consulting Agreement — Alan Turing",…]]  banner [{"t":"live documents · 3 records","bg":"rgb(168, 216, 176)"}]
click "Invoices" -> 7 rows ["Invoice — Credit Optimization Bundle","Invoice — Inquiry Removal ×6$570","Invoice — Business Financial Assessment","Invoice — Consulting Services Deposit",…]
banner after: [{"t":"live documents · 3 records","bg":"rgb(168, 216, 176)"}]   (mint = "real" tone)
click "All" -> 38 sample rows. statusFilter change -> 4 sample rows.

### [U] partner-galaxy.html live census is overwritten by a 1-second sample ticker — mint banner over sample text

`public/app/partner-galaxy.html:1912` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** FHData.wire (line 1937) writes the real partner census into #census, but the screen's own chrome() runs on setInterval(chrome, 1000) (line 1912) and rewrites #census from the sample NODES array every second. Within one tick the real numbers are gone; the mint "live partner census" banner stays forever.

**How it fails.** One partner row exists. Two seconds after load the census line reads the sample "20 workers · 14 working · 1 blocked · 5 idle" while the bottom banner reads mint "live partner census · 1 partner(s)". The screen shows no real data at all yet advertises itself as live.

**Evidence.** page.evaluate 2.6s after networkidle against the seeded DB:
{"census":"20 workers · 14 working · 1 blocked · 5 idle","sub":"Galaxy"}
banner: ["live partner census · 1 partner(s)"]
The expected wire output was "1 partner(s) · $0 accrued · …" (partner-galaxy.html:1945-1950). partner-galaxy.html:1912 is `chrome(); setInterval(chrome, 1000);` and chrome() at 1909 sets censusEl.innerHTML from NODES.

### [U] pipeline.html renders only 5 of the 10 sales stages — cards in Confirmed, Showed, Closed Won, Downsell and Lost are silently dropped and under-counted

`public/app/pipeline.html:403` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** paint() only writes into .col elements that already exist in the markup, and .board contains just five columns (New Lead, Survey Complete, Booked, Diagnostic Paid, Decision Rendered). The API returns all ten sales stages. Cards in the other five stages are never rendered, never counted, and produce no warning — and the banner reports the painted count as if it were the board total.

**How it fails.** Three cards exist in the sales pipeline: one in new_lead, one in booked, one in closed_won. The board shows two cards and the mint banner reads "live board · sales pipeline · 2 cards across 10 stages". The Closed Won (deposit) card — the one that matters most commercially — is invisible, and the count is wrong. Any card that advances past Decision Rendered disappears from the board.

**Evidence.** API: GET /api/dashboard/pipeline?key=sales -> total 3; stages new_lead 1 / booked 1 / closed_won 1 (all ten stages returned).
DOM after load: board columns present = ["New Lead","Survey Complete","Booked","Diagnostic Paid","Decision Rendered"]; real cards on board = ["Ada Lovelace","Grace Hopper"]; banner = "live board · sales pipeline · 2 cards across 10 stages" (mint).
Markup: pipeline.html has exactly five <section class="col"> inside <div class="board"> (lines 406, 489, 544, 614, 683); the two further .col at 824/832 are in the demonstration strip, outside .board.

### [U] products-commissions.html live product rows are column-misaligned and lose the "CLICK A ROW TO EDIT" handler

`public/app/products-commissions.html:697` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** The products table declares 7 columns (Product, Category, Default price, Variable, Min, Max, Rails) at line 239. The live paint emits 5 <td> with no colspan, so the success-fee percentage lands under "Variable" and the active-rule count under "Min", and Max/Rails are absent. The sample renderer also attaches per-row click handlers via tr[data-p] (line 447); the live rows carry no data-p and no handler, so the advertised row editor is dead.

**How it fails.** An owner opens the product ladder. "Card Stacking DFY" shows 10.0000% in the Variable column (that is the default success fee, not a variable-pricing flag) and 0 in the Min column (that is the rail count). They then click the row, as the header instructs, to edit the product — nothing happens; the editor stays empty.

**Evidence.** Playwright, seeded DB:
headers: ["Product","Category","Default price","Variable","Min","Max","Rails"]
firstRowCells: [{"txt":"$32 Diagnostic"},{"txt":"diagnostic"},{"txt":"$32"},{"txt":"—"},{"txt":"0"}]  ← 5 cells, no colspan
Controlled A/B on the same page:
  SAMPLE rows (:8932, DB dead)  -> {"rows":5,"withDataP":5,"cellsFirstRow":7}; click row 1 -> p_name = "Business Financial Assessment"
  LIVE rows   (:8931, DB up)    -> {"rows":5,"withDataP":0,"cellsFirstRow":5}; click row 1 -> p_name = ""

### [U] The app's Sign out button never calls /api/auth/logout, so no session is ever revoked server-side

`public/app/shell.js:284` · lens: authentication and tenancy

**What is wrong.** `signOut()` only removes `fh_token` from localStorage and navigates to /login.html. Nothing under public/ references `/api/auth/logout` at all, so the only sign-out affordance in the product leaves every session - staff included - live on the server for its full sliding TTL.

**How it fails.** An owner signs out of the CRM on a shared machine. The browser forgets the token but `sessions.revoked_at` is never stamped; the token remains valid for 7 days and each use pushes expiry forward again. Anyone who obtains the token from browser storage, a synced profile, a proxy log or an XSS payload has an owner session that survives the victim clicking Sign out. `signOut()` is also invoked internally as the recovery path for "a role with no screens" (shell.js:454), so that branch leaves a live session behind too. The backend endpoint that would fix this (`api/auth/logout.mjs`) is correct for staff and simply unreachable from the UI.

**Evidence.** $ grep -rn "auth/logout" public/
(no matches)

public/app/shell.js:284-290
  function signOut() {
    localStorage.removeItem("fh_token");
    localStorage.removeItem("fh_demo");
    localStorage.removeItem("fh_demo_staff");
    writeCachedRole("");
    location.href = "/login.html";
  }

shell.js:355  document.getElementById("fh-shell-out").addEventListener("click", signOut);

Confirmed the server side does revoke when actually called, so the gap is purely that nothing calls it:
POST /api/auth/logout (staff token) -> 200, sessions.revoked_at = 2026-07-30T05:50:40.206Z, subsequent /api/auth/session -> 401.

### [U] staff-teams.html: typing in the roster filter replaces the 6 real staff rows with the 7-person sample roster

`public/app/staff-teams.html:602` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** The live wire (line 626) writes the real roster into #rosterBody. #qFilter (input) and #roleFilter (change) are bound to renderRoster(), which rebuilds the table from the built-in sample PEOPLE array. The banner is written once by wire() and is never recomputed, so it keeps claiming "live roster".

**How it fails.** Six real staff rows load under a mint "live roster · 6 staff" banner. An admin types "chris" into the roster filter to find one person. The table is rebuilt from sample data; clearing the box leaves 7 sample people including "Dana Kowalczyk / dana@kowalczykpartners.com", who has no row in the staff table. The banner still says live.

**Evidence.** Playwright against the seeded DB:
rows before: [["Alvin Torres","alvin@fundhub.ai","Inquiry Specialist","active","0"], … 6 real rows]
after page.fill("#qFilter","chris"): [["CSChris Stanbridgechris@fundhub.ai","OwnerClients · Money · Messaging · Setup · Admin18 of 18","On file","In · 06:41","Active"]]  ← sample-shaped row
after clearing the filter: ["CSChris Stanbridge…","SWSarah Whitfield…","JBJordan Blake…","NCNina Castellano…","MWMarcus Webb…","ATAlvin Torres…","DKDana Kowalczykdana@kowalczykpartners.com"] — 7 sample rows; the DB has 6 staff and no Dana Kowalczyk.

### [U] staff-teams.html live roster writes every value into the wrong column — role appears under "Consent", account status under "Clock"

`public/app/staff-teams.html:631` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** The table header is <th>Person</th><th>Access — role preset</th><th>Consent</th><th>Clock</th><th>Status</th> (line 255). The live paint emits name / email / role / status / open_tasks. Every column after the first is mislabeled, including the compliance-relevant "Consent" column.

**How it fails.** An admin opens Staff & Teams to check who has monitoring consent on file. The Consent column reads "Owner", "Closer", "Admin", "Funding Advisor" — those are roles, not consent. The Clock column reads "active" for everyone — that is staff.status, not clock state. The Status column reads "0" — that is the open-task count. Every one of those is a wrong answer to the question the header asks.

**Evidence.** Playwright, seeded DB:
headers: ["Person","Access — role preset","Consent","Clock","Status"]
rows   : [["Alvin Torres","alvin@fundhub.ai","Inquiry Specialist","active","0"],["Chris Stanbridge","chris@fundhub.ai","Owner","active","0"],["Jordan Blake","jordan@fundhub.ai","Closer","active","0"],…]
Source: staff-teams.html:631-635 emits esc(s.name) / esc(s.email) / esc(label(s.role)) / esc(s.status) / esc(s.open_tasks) against that 5-header row.

### [U] A re-delivered Commas webhook with no event id double-counts money in `transactions`

`src/adapters/commas.mjs:190` · lens: Replay safety and money correctness — every INSERT path into

**What is wrong.** When a Commas payload carries none of the id fields normalizeCommasEvent looks for, the adapter sets `idKey = undefined` (line 190) AND `providerRef = null` (line 187). Both of the system's dedupe layers vanish at once: the `events` insert has no idempotency key, and the transactions insert's guard is `ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL` (client-lifecycle.mjs:92), which is inert on NULL. The adapter fails open on the one event class that records money.

**How it fails.** Commas times out waiting for a 200 and re-delivers the payment webhook (every processor does). The body carries no id/event_id/transaction_id/checkout_session_id. Two `transactions` rows are written for one $5,000 payment. Any later `replay()` doubles it again. Every downstream read of money-in — the dashboard, v_client_ar_balance, any future commission basis — is now overstated with no way to tell the duplicate from the original.

**Evidence.** $ node <signed the same body twice through handleCommasWebhook>
webhook#1: [{"name":"payment.received","deduped":false},{"name":"deposit.paid","deduped":false}]
webhook#2: [{"name":"payment.received","deduped":false},{"name":"deposit.paid","deduped":false}]
TRANSACTIONS after 2 identical webhook deliveries: {"n":2,"total":"10000.00"}
replay dispatched=2; transactions before=2 after={"n":4,"total":"20000.00"}

Replay matrix, same events with provider refs absent:
1st delivery          : {"transactions":1,"tasks":1,"messages":1}
2nd identical delivery: {"transactions":2,"tasks":1,"messages":2}   -> transactions {"n":2,"total":"6000.00"} (one $3000 payment was made)
replay(21)            : -> transactions {"n":4,"total":"12000.00"}
(`tasks` stayed at 1 — tasks_idempotency_idx is NULLS NOT DISTINCT, so that writer survives.)

The repo already knows the right answer: src/adapters/lendflow.mjs:381 refuses the identical case — `if (!evt.applicationId) return { ok:false, status:400, reason:"missing_application_id" }` with the comment "Refuse rather than risk duplicate milestone sends." commas.mjs, the only adapter that records money, does not.

VERIFICATION.md:24 states: "| 7 | Every money/work writer carries an idempotency guard | **PASS** — none unguarded |". That is factually wrong.

### [U] POST /api/webhooks/mailgun accepts unsigned requests and injects canonical events when MAILGUN_SIGNING_KEY is unset

`src/adapters/mailgun.mjs:242` · lens: authentication and tenancy

**What is wrong.** `handleMailgunWebhook` wraps its signature check in `if (signingKey)`, so with the key unset it skips verification entirely and returns 200. The other five adapters (commas, clickfunnels, bland, calcom, twilio) return 401 `bad_signature` under the same condition, and this file's own section header says "1. Signature verification (fail-closed)".

**How it fails.** `MAILGUN_SIGNING_KEY` is blank in .env.example and DEPLOY.md says webhook secrets are added "later, only when wiring a live source". In that state anyone who can reach the deployment POSTs an unsigned JSON body to `/api/webhooks/mailgun` naming a real client's email as `recipient` and gets a canonical `mail.response` event written to the `events` table with attacker-chosen classification (APPROVED / DENIED / MISSING_DOCS), resolved to that client. Those events are what F-11 bank-email-event-router consumes, so the moment INNGEST_EVENT_KEY is set an unauthenticated caller can drive a client's funding state. No session, no signature, no shared secret.

**Evidence.** All six adapters, no secrets set, no signature header (via src/http/router.mjs):
commas         401 {"ok":false,"reason":"bad_signature"}
clickfunnels   401 {"ok":false,"reason":"bad_signature"}
bland          401 {"ok":false,"reason":"bad_signature"}
calcom         401 {"ok":false,"reason":"bad_signature"}
twilio         401 {"ok":false,"reason":"bad_signature"}
mailgun        200 {"ok":true,"emitted":[{"name":"mail.response",...}]}   <-- fail-open

Driving the real Vercel entry api/webhooks/[provider].mjs with a Node stream, no signature fields:
MAILGUN_SIGNING_KEY set? false
POST /api/webhooks/mailgun with NO signature -> 200 {"ok":true,"status":200,"emitted":[{"name":"mail.response","id":"63da3c02-...","deduped":false}]}
events table (newest): mail.response | classification = APPROVED | to = alpha.client@audit.test

Code: `if (signingKey) { if (!verifyMailgunSignature(...)) return 401 }` - no else branch.

### [U] Nothing in production ever writes a sale, a funding round, a commission, an entitlement or an affiliate referral

`src/commissions/sql.mjs:101` · lens: Replay safety and money correctness — every INSERT path into

**What is wrong.** `sales`, `sale_payments`, `sale_attributions`, `funding_rounds` and `partner_revenue` have no INSERT anywhere outside migrations and test fixtures. SQL_INSERT_LEDGER has no caller. grantFromTransaction/grant, and attribute/convert, have no caller. The entire money-accrual layer is unreachable from the event bus — sale.closed only flips a boolean in clients.custom_fields.

**How it fails.** Drive the complete happy path — lead captured, call booked, $32 diagnostic paid, analysis, decision, $3,000 deposit paid, sale closed — and no sale is recorded, so no attribution exists, so no commission draft can be computed, no invoice can reference a sale, no entitlement is granted and no affiliate referral is attributed or converted. A closed deal earns nobody anything and unlocks nothing in the client portal. Because `sales` is empty, economics.qualifyingOutcome() returns `sale_not_found` for every input, so `unratedConversions()` — the reporting surface HANDOFF.md says keeps the AF-04 gap visible — can never return a row.

**Evidence.** $ node scripts/demo-journey.mjs   (11 canonical events, all ✔)
$ psql -tAc 'SELECT ... counts ...'
commission_ledger|0
entitlements|0
affiliate_referrals|0
sales|0
sale_payments|0
sale_attributions|0
funding_rounds|0
invoices|0
partner_revenue|0
transactions|8
tasks|1

$ grep -rniE 'insert into +(commission_ledger|partner_revenue|sales|funding_rounds|sale_payments|sale_attributions)' --include=*.mjs --include=*.sql . | grep -v node_modules | grep -v .test.mjs | grep -v /db/migrations/
./src/commissions/sql.mjs:101:INSERT INTO commission_ledger (     <- SQL text only
(nothing else)

$ grep -rn 'SQL_INSERT_LEDGER|ledgerInsertParams|computeCommission|grantFromTransaction|economics' src/ api/ netlify/ scripts/ | grep -v .test.mjs
-> only the definitions and src/commissions/index.mjs re-exports. No call site.

This is not covered by the documented gaps. HANDOFF.md's "What is actually done" table lists "Affiliate economics | src/affiliates/economics.mjs | Attribution, accrual, tier 2" and "Entitlements | src/entitlements/ | Grants, catalog, locked tiles", and the documented omissions are the empty *config* tables (product_entitlements, affiliate_commission_rules) — a different thing from having no caller. Nothing anywhere records that `sales` has no writer.

### [U] A malformed session cookie 500s every authenticated route, including logout, and cannot be cleared from inside the app

`src/http/middleware/requireAuth.mjs:49` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** `bearerToken()` calls `decodeURIComponent()` on the fundhub_session cookie value with no guard. Any invalid percent sequence throws URIError, which no caller catches (`authenticate()`'s try only wraps `verifySession`), so it escapes to the Netlify adapter's generic catch as a 500. A caller-supplied value produces a server fault on 10 of 11 routes.

**How it fails.** A browser holds a truncated or corrupted cookie — `Cookie: fundhub_session=%E0%A4%A` (also `%`, `%zz`, `a%FF`). Every request that browser makes to /api/auth/session, all 13 /api/read/*, /api/tasks, /api/dashboard/*, /api/partner-brand returns 500 {"message":"URI malformed"}. POST /api/auth/logout — the one call that would clear the cookie — 500s too and never emits its Set-Cookie, so the user is wedged out of the entire application with no in-app recovery. An attacker able to set a cookie on the domain (e.g. from a subdomain) can do this to any user.

**Evidence.** $ node cookie.mjs   (header: Cookie: fundhub_session=%E0%A4%A)
500 GET  /api/auth/session      {"ok":false,"error":"internal_error","message":"URI malformed"}
500 GET  /api/read/staff        {...same}
500 GET  /api/read/invoices     {...same}
500 GET  /api/read/products     {...same}
500 GET  /api/tasks             {...same}
500 GET  /api/dashboard/clients {...same}
500 GET  /api/dashboard/client?id=00000000-...  {...same}
500 GET  /api/dashboard/pipeline {...same}
500 GET  /api/partner-brand?partner_id=00000000-...  {...same}
500 POST /api/auth/logout       {...same}
200 GET  /api/health           (only route that does not authenticate)

Variants: fundhub_session=% -> 500; =%zz -> 500; =a%FF -> 500.
A malformed value on a DIFFERENT cookie name is harmless: "other=%E0%A4%A; fundhub_session=ok" -> 401. So it is specifically the decode of the session cookie.

### [U] A total database outage is reported to every session-gated route as 401 unauthorized

`src/http/middleware/requireAuth.mjs:56` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** `authenticate()` wraps verifySession in a bare `catch { return null }`, so a connection failure is indistinguishable from a bad token. Every route behind requireAuth/requirePrincipal answers 401 during an outage — our fault reported as the caller's. The code comment justifies this by 'the shared-secret fallback in the dashboard routes still has a chance to answer', but the 13 read APIs, /api/tasks, /api/auth/session and /api/partner-brand have no such fallback, so for them the 401 is simply a wrong status with no compensating behaviour.

**How it fails.** Postgres goes down. A signed-in staff member's screen calls /api/read/invoices and gets 401 unauthorized. shell.js treats that as an expired session and bounces the user to login.html. Login then 500s (the same outage). Uptime monitors watching the read APIs see 401s, not 5xx, so no alert fires; the on-call engineer sees 'everyone got logged out' rather than 'the database is down'. /api/health is the only route that tells the truth, and nothing in the read path consults it.

**Evidence.** $ DATABASE_URL=postgres://fundhub:localdev@127.0.0.1:5999/audit_hostile node outage.mjs   (valid, unexpired token attached)
401 GET /api/auth/session       {"ok":false,"error":"unauthorized"}
401 GET /api/read/staff         {"ok":false,"error":"unauthorized"}
401 GET /api/read/invoices      {"ok":false,"error":"unauthorized"}
401 GET /api/tasks              {"ok":false,"error":"unauthorized"}
401 GET /api/partner-brand?partner_id=00000000-...   {"ok":false,"error":"unauthorized"}
200 GET /api/health             {"state":"unreachable"}   <- the only honest answer

The same token returns 200 on all of these against a healthy database, so the 401 is caused solely by the outage.


## MEDIUM

### [U] HANDOFF.md claims a client/affiliate/partner who signs in lands on real rows; in Chromium they are bounced straight back to the login page

`HANDOFF.md:140` · lens: authentication and tenancy

**What is wrong.** No registered route accepts a non-staff principal - `/api/auth/session` 401s for them, every `/api/read/*` and `/api/partner-brand` 401s (they use staff-only `requireAuth`), and `/api/tasks` 403s. `login.html` never reads the `principal` field it is documented to route on, and shell.js's `getSession()` requires `d.staff`, so a successful principal login redirects to /login.html - a sign-in loop.

**How it fails.** A partner is invited, activates, and signs in. `/api/auth/login` returns 200 with a valid token and `principal:"partner"`. `login.html` stores the token, finds no `data.staff.role`, clears `fh_role` and sends the browser to `/app/`. shell.js calls `/api/auth/session`, gets 401 (it resolves staff sessions only), falls through to a null session and redirects to `/login.html?next=/app/`. The partner never reaches partner-galaxy.html; a client never reaches client-portal.html. HANDOFF.md:136-141 states they "sign in through /api/auth/login, which returns a `principal` field so the frontend can route" and that "a principal who signs in lands on real rows rather than a wireframe" - both are false as shipped. (The doc's hedge is only that this was "not exercised end-to-end", not that it does not work.) Separately, the two screens' own data sources are staff-gated anyway: client-portal calls /api/read/entitlements (ROLE_SETS.STAFF) and partner-galaxy calls /api/read/partners (ROLE_SETS.FINANCE = owner/admin).

**Evidence.** Chromium (playwright), real login form at /login.html against the real API:
### client (clientprincipal@audit.test)
  final URL   : /login.html?next=/app/
  page title  : Fundhub - Sign in
  fh_token set: yes (43 chars)
  api calls   : 200 /api/auth/login | 401 /api/auth/session
### affiliate  -> /login.html?next=/app/   (200 login, 401 session)
### partner    -> /login.html?next=/app/   (200 login, 401 session)
### staff/owner-> /app/command-center.html (200 login, no 401)

Matrix, account principals across all 26 routes: /api/auth/session 401, /api/tasks 403, all 13 /api/read/* 401, /api/partner-brand 401, /api/inquiry 401. The only 200s are the fail-open /api/dashboard/* routes (separate finding).

$ grep -n "principal" public/login.html
(no matches - it reads only data.token and data.staff.role)

### [U] VERIFICATION.md check 10 claims a closer gets 403 on inquiry data, but the endpoint added later in the same document grants closers full read access

`VERIFICATION.md:27` · lens: Factual accuracy of HANDOFF.md and VERIFICATION.md — every f

**What is wrong.** Check 10 records "Cross-role API reach | **PASS** — closer 403 on inquiry and on commissions", and the section at line 78 confirms api/inquiry.mjs is gated to inquiry_specialist/admin. But the follow-up pass documented at the bottom of the same file (line 163) added `/api/read/inquiries`, which uses ROLE_SETS.STAFF — a set that includes `closer`. A closer now reads the same `inquiry_log` rows with a 200. The document's stated isolation result no longer describes the platform.

**How it fails.** Someone auditing access control, or deciding whether inquiry data is safe to expose, reads check 10 and concludes closers cannot reach inquiry data. They are wrong: signing in as the real closer account (jordan@fundhub.ai) and calling /api/read/inquiries returns the bureau, inquiry, status, call_attempts and outcome for every row. The narrower gate on api/inquiry.mjs is now bypassable through the newer endpoint, and the document actively conceals that by asserting the opposite.

**Evidence.** Logged in as the real closer against audit_docs and invoked the handlers directly:
  closer login ok: true
  closer -> /api/read/commissions : 403 {"ok":false,"error":"forbidden",...}   <- matches the doc
  closer -> /api/read/staff       : 403 {"ok":false,"error":"forbidden",...}
  closer -> /api/read/inquiries   : 200 {"ok":true,"count":0,...}              <- contradicts the doc

Re-ran after inserting one real inquiry_log row, to prove it returns content and not just an empty list:
  closer -> /api/read/inquiries : 200 {"ok":true,"count":1,...,"items":[{"id":"f7ad6..."}]}

Cause:
  src/http/read-api.mjs:90  STAFF: new Set(["owner","admin","funding_advisor","closer","inquiry_specialist","setter"])
  api/read/inquiries.mjs:19 roles: ROLE_SETS.STAFF
versus the older, narrower gate the doc describes:
  api/inquiry.mjs:28        await requireRole("inquiry_specialist", "admin")(req, res)

### [U] /api/dashboard/clients and /api/dashboard/pipeline echo the raw driver error, leaking the database host, port and username

`api/dashboard/clients.mjs:86` · lens: authentication and tenancy

**What is wrong.** Both handlers return `error: err.message` unscrubbed, while every other handler routes failures through `safeError()` - whose own header names the hostname and address as the leaks that are easy to miss. Because these two routes are also the ones that answer without a credential, the leak is unauthenticated. The Netlify function's catch-all does the same thing for every route.

**How it fails.** With the database unreachable or misconfigured, an anonymous `GET /api/dashboard/clients` returns `{"ok":false,"error":"connect ECONNREFUSED 10.0.3.14:5432"}` or `{"ok":false,"error":"getaddrinfo ENOTFOUND ep-xyz.us-east-2.aws.neon.tech"}` or `{"ok":false,"error":"password authentication failed for user \"fundhub_prod\""}` - handing out the private database endpoint and role name. `/api/health` on the same deployment correctly returns `"connect ECONNREFUSED [redacted]"`. VERIFICATION.md:133 states the error-leak sweep covered "119 route/parameter combinations" and "Re-swept: 0 leaking 5xx"; these are a 500 and a 503 that leak, so that line is not accurate.

**Evidence.** Same harness, DATABASE_URL pointed at three failing targets:

DATABASE_URL=postgres://leakuser:SUPERSECRETPW@127.0.0.1:5999/leakdb
  /api/health            -> "error":"connect ECONNREFUSED [redacted]"          (scrubbed)
  /api/dashboard/clients -> "error":"connect ECONNREFUSED 127.0.0.1:5999"      (500, raw)
  /api/dashboard/pipeline-> "error":"connect ECONNREFUSED 127.0.0.1:5999"      (503, raw)
  POST /api/auth/login   -> "internal_error","message":"connect ECONNREFUSED 127.0.0.1:5999"  (netlify shim catch-all)

DATABASE_URL=postgres://...@nonexistent-host.invalid:5432/leakdb
  /api/health            -> "getaddrinfo ENOTFOUND [redacted]"
  /api/dashboard/clients -> "getaddrinfo ENOTFOUND nonexistent-host.invalid"

DATABASE_URL with a bad role
  /api/dashboard/clients -> "password authentication failed for user \"leakuser\""

Anchors: api/dashboard/clients.mjs:86 `res.status(500).json({ ok: false, error: err.message })`;
api/dashboard/pipeline.mjs:106 `return res.status(503).json({ ok: false, db: "down", error: err.message })`;
netlify/functions/api.mjs:158 `res.status(500).json({ ok:false, error:"internal_error", message: err?.message })`.

(For completeness: the canary sweep found NO ssn / password_hash / token_hash / storage_key in any response body - redact() works, including inside clients.custom_fields jsonb - and raw session tokens are never persisted; token_hash == sha256(token) in both sessions and account_sessions. Login gives no membership oracle: unknown email, wrong staff password and wrong account password all return 401 invalid_credentials at ~190ms.)

### [U] /api/dashboard/pipeline reports every failure, including caller errors, as 503 db:"down"

`api/dashboard/pipeline.mjs:106` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** A single catch maps all exceptions to 503 with the literal body `db: "down"`. There is no CLIENT_DATA_ERRORS classification as in the other handlers, so a bad query parameter is announced to the screen as a database outage — and, conversely, a real outage arrives with the same status as a typo, so the two cannot be told apart.

**How it fails.** GET /api/dashboard/pipeline?limit=-1 -> 503 {"ok":false,"db":"down","error":"LIMIT must not be negative"}. GET ?key=%00 -> 503 {"db":"down","error":"invalid byte sequence ..."}. The pipeline screen renders a 'database down' state and an operator investigates an outage that is not happening; meanwhile a genuine outage produces the identical status, so the signal is worthless in both directions.

**Evidence.** $ node confirm1.mjs
503 GET /api/dashboard/pipeline?limit=-1  {"ok":false,"db":"down","error":"LIMIT must not be negative"}
503 GET /api/dashboard/pipeline?key=%00   {"ok":false,"db":"down","error":"invalid byte sequence for encoding \"UTF8\": 0x00"}
404 GET /api/dashboard/pipeline?key=nope  {"ok":false,"error":"unknown_pipeline"}   <- correct
$ DATABASE_URL=<dead port> node outage.mjs
503 GET /api/dashboard/pipeline {"ok":false,"db":"down","error":"connect ECONNREFUSED 127.0.0.1:5999"}   <- same status as the typo above

### [U] partner-brand PUT returns raw Postgres CHECK-constraint text in a 400, contradicting its own documented behaviour

`api/partner-brand.mjs:138` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** `HEX.test(body.ink)` stringifies its argument, so an array `["#ff0000"]` coerces to "#ff0000" and passes JS validation, then fails the CHECK in migration 043. The catch matches the constraint name and returns `problems: [m]` — the whole raw driver message. The file header says the JS check exists 'so the caller gets a readable error rather than a constraint name' and the catch comment says 'Turn a constraint name into something a person can act on'; the code does neither.

**How it fails.** PUT /api/partner-brand {"partner_id":"<uuid>","ink":["#ff0000"]} -> 400 {"error":"invalid","problems":["new row for relation \"partner_brand\" violates check constraint \"partner_brand_ink_ck\""]}. Same for `paper`. The caller receives a table name and a constraint name instead of the 'ink must be #rrggbb' message the endpoint is documented to produce, and the doc comment is false.

**Evidence.** $ node bodies3.mjs
400  bad ink        {"ok":false,"error":"invalid","problems":["ink must be #rrggbb"]}                  <- correct
400  object ink     {"ok":false,"error":"invalid","problems":["ink must be #rrggbb"]}                  <- correct
400  array ink      {"ok":false,"error":"invalid","problems":["new row for relation \"partner_brand\" violates check constraint \"partner_brand_ink_ck\""]}
$ node nul.mjs
400  brand paper array -> CHECK  {"problems":["new row for relation \"partner_brand\" violates check constraint \"partner_brand_paper_ck\""]}

### [U] partner-brand PUT persists non-string types and unbounded strings without validation

`api/partner-brand.mjs:118` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** Only ink, paper, ramp, display_face, mono_face and selected_funnels are validated. wordmark_url, entity_name, entity_address, support_email, domain and voice take whatever the body contains — numbers, arrays, objects, arbitrary length — and are written straight through with no type, format or length bound.

**How it fails.** PUT /api/partner-brand {"partner_id":"<uuid>","support_email":-1,"domain":1.5,"voice":[1,2],"wordmark_url":"<100kB of A>"} returns 200 ok:true and persists support_email='-1', domain='1.5', voice='{"1","2"}', wordmark_url of 102400 characters. shell.js applyBrand() then renders a partner's white-label shell from a 100kB wordmark URL and a numeric support email. A partner principal can inflate the row without limit on every PUT.

**Evidence.** $ node bodies3.mjs
200  100kB wordmark_url  ok:true
200  object voice        ok:true
200  array voice         ok:true
200  negative support_email ok:true
200  float domain        ok:true
200  sqlmeta domain      ok:true
$ psql -c 'SELECT entity_name, voice, support_email, domain, length(wordmark_url) FROM partner_brand'
 entity_name | voice     | support_email | domain                    | wm_len
 🙈          | {"1","2"} | -1            | '; DROP TABLE partners;-- | 102400

(The SQL metacharacters are parameterised and inert — no injection anywhere in this audit. The defect is the absent type/length validation, not injection.)

### [U] Negative limit is unbounded on the three routes that roll their own pagination, producing a 500/503 with raw Postgres text

`api/tasks.mjs:41` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** `Math.min(parseInt(q.limit) || 100, 200)` only clamps the upper bound; parseInt("-1") is truthy so -1 passes through to LIMIT. src/http/read-api.mjs:pageParams correctly rejects it (`rawLimit > 0`), but api/tasks.mjs:41, api/dashboard/clients.mjs:53 and api/dashboard/pipeline.mjs:57 each reimplement pagination without that guard.

**How it fails.** GET /api/tasks?limit=-1 -> 500 {"error":"query_failed","message":"LIMIT must not be negative"}. GET /api/dashboard/clients?limit=-1 -> 500 with the same raw text. GET /api/dashboard/pipeline?limit=-1 -> 503 {"db":"down"}, i.e. a one-character typo in a URL is reported to the screen as a database outage. GET /api/dashboard/clients?limit=-99999999999999999999 additionally leaks the column type: "value \"-100000000000000000000\" is out of range for type bigint".

**Evidence.** $ node confirm1.mjs
500 GET /api/tasks?limit=-1              {"error":"query_failed","message":"LIMIT must not be negative"}
500 GET /api/dashboard/clients?limit=-1  {"error":"LIMIT must not be negative"}
503 GET /api/dashboard/pipeline?limit=-1 {"ok":false,"db":"down","error":"LIMIT must not be negative"}
$ node run-get.mjs
500 /api/dashboard/clients limit=neg_big {"error":"value \"-100000000000000000000\" is out of range for type bigint"}

Contrast, same input on a read route: 200 GET /api/read/staff?limit=-1 -> {"limit":50,...}. The upper cap does hold everywhere: with 300 staff rows seeded, ?limit=999999 and ?limit=201 both return exactly 200 items; /api/tasks?limit=999999 with 300 tasks returns 200.

### [U] PATCH /api/tasks with a non-existent assignee_staff_id returns 500 and names the table and the foreign-key constraint

`api/tasks.mjs:159` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** A well-formed uuid that does not exist in staff raises SQLSTATE 23503, which is not in CLIENT_DATA_ERRORS, so the handler falls through to the 500 branch. `safeError()` only scrubs DSNs and hostnames, so the constraint-violation text passes through verbatim. This is a caller error (bad reference) reported as a server fault, and it discloses schema internals.

**How it fails.** A staff member reassigns a task to a colleague whose account was just deleted, or the UI posts a stale staff id. PATCH /api/tasks {"id":"<real task>","assignee_staff_id":"00000000-0000-0000-0000-000000000000"} returns 500 {"error":"update_failed","message":"insert or update on table \"tasks\" violates foreign key constraint \"tasks_assignee_staff_fk\""}. The screen shows a backend-down banner instead of 'that person no longer exists', and the response hands the caller a table name and a constraint name. Correct answer is 400 or 404.

**Evidence.** $ node bodies2.mjs
400  bad uuid id               {"ok":false,"error":"invalid_parameter"}          <- handled correctly
400  assignee bad uuid         {"ok":false,"error":"invalid_parameter"}          <- handled correctly
500  assignee nonexistent uuid {"ok":false,"error":"update_failed","message":"insert or update on table \"tasks\" violates foreign key constraint \"tasks_assignee_staff_fk\""}

All 23 other tasks-PATCH hostile bodies (object/array/null/float/negative/100kB/NUL/emoji/SQL-metachar id, non-boolean done, non-boolean claim, invalid JSON, empty body, absent body) returned clean 400s.

### [U] Object.prototype keys resolve as routes — /api/constructor and 7 more return unauthenticated 500 instead of 404

`netlify/functions/api.mjs:89` · lens: Route reachability and liveness: every ROUTES entry in netli

**What is wrong.** `ROUTES[path]` is a plain object-literal lookup, so any Object.prototype member name is truthy and is treated as a handler. Eight unauthenticated URLs return 500 rather than the router's 404 not_found body.

**How it fails.** Any scanner, crawler or user hitting /api/constructor gets `route = Object`, which api.mjs then calls as `await Object(req, res)`; it returns without writing, so the adapter emits 500 handler_no_response. /api/__proto__ resolves to Object.prototype and throws "route is not a function"; /api/valueOf, /api/hasOwnProperty, /api/isPrototypeOf, /api/propertyIsEnumerable and /api/toLocaleString throw on null/undefined; /api/toString returns handler_no_response. All are reachable with no session. Beyond the error-rate noise this breaks the router's 404 contract that public/app/data.js:62-72 depends on: a 500 is classified "nodb" ("backend unavailable") rather than "offline" ("/api/* not deployed"), so screens would report the wrong outage cause.

**Evidence.** Probed through the real adapter, no credentials:
  500 GET /api/constructor            {"ok":false,"error":"handler_no_response"}
  500 GET /api/__proto__              {"ok":false,"error":"internal_error","message":"route is not a function"}
  500 GET /api/toString               {"ok":false,"error":"handler_no_response"}
  500 GET /api/valueOf                {"ok":false,"error":"internal_error","message":"Cannot convert undefined or null to object"}
  500 GET /api/hasOwnProperty         (same)
  500 GET /api/isPrototypeOf          (same)
  500 GET /api/propertyIsEnumerable   (same)
  500 GET /api/toLocaleString         {"...":"Object.prototype.toLocaleString called on null or undefined"}
  500 GET /.netlify/functions/api/constructor  {"ok":false,"error":"handler_no_response"}
Control — real unknown paths behave correctly:
  404 GET /api/nope                   {"ok":false,"error":"not_found","path":"nope"}
  404 GET /api/read/constructor       {"ok":false,"error":"not_found","path":"read/constructor"}
Only single-segment prototype names are affected.

### [U] agent-editor.html LIVE/SHADOW tiles contradict its own live banner and its own list

`public/app/agent-editor.html:671` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** The live wire mutates the AGENTS entries and calls renderList(), but never calls renderStats() (line 537), which is what fills #kLive, #kShadow, #kBreach and the header pill. Those keep the pre-wire sample values while the banner reports the real ones.

**How it fails.** The registry loads from the database. The top-of-page KPI reads "LIVE 11 — acting on real clients" and "SHADOW 3", the header pill reads "11 LIVE · 3 SHADOW", the list underneath shows exactly 2 LIVE badges and 12 DRAFT, and the mint banner reads "2 live". An owner scanning the KPI row believes 11 AI agents are acting on real clients when 2 are.

**Evidence.** Screenshot + DOM against the seeded DB: tiles "AE-00 / LIVE 11 / acting on real clients" and "AE-00 / SHADOW 3"; list shows LIVE only on Setter Josh and Inquiry Removal AI; banner "live registry · 14 agents · 2 live · 2 running with no stored prompt/guardrails" (mint). Identical numbers appear on the empty-database run, so the tiles are never written by the wire. agent-editor.html:654-679 calls renderList() only; renderStats() at 537 is the sole writer of #kLive.

### [U] data.js reports a database outage as "not signed in for real data"

`public/app/data.js:218` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** Because a DB failure surfaces as HTTP 401, get() maps it to source "unauthorized" and explain() renders "sample <what> — not signed in for real data". The tone is correct but the stated cause is wrong, sending the reader to re-authenticate instead of to the database. This is the same class of conflated-status bug VERIFICATION.md records fixing for 404.

**How it fails.** The database is unreachable and the user has a demo-staff fallback so the screen still renders. Nine screens simultaneously display "sample X — not signed in for real data" while the user is signed in with a valid, unexpired session token. Nobody looks at the database.

**Evidence.** Dead-DB run (:8932) with a valid session token present in localStorage:
  affiliate.html   banner rgb(242,166,155) "sample affiliate figures — not signed in for real data"
  documents.html   banner rgb(242,166,155) "sample documents — not signed in for real data"
  staff-teams.html banner rgb(242,166,155) "sample roster — not signed in for real data"
  … 9 screens total.
The same token returns 200 from /api/auth/session on :8931, so the session is valid; only the database is gone. Contrast pipeline.html, which hand-rolls its own branch and correctly said "backend unavailable (nodb: …)".

### [U] pipeline.html board summary and rail counts stay sample under a mint "live board" banner

`public/app/pipeline.html:382` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** The .board-summary strip ("82 cards / $544,200 est. / 4 held") and every .rt-count in the rail switcher are static sample markup that the live wiring never touches, while the columns underneath are rebuilt from the database and the banner turns mint.

**How it fails.** With two cards worth $240,000 visible on the board, the toolbar directly above them reports 82 cards and $544,200 est., and the Sales rail tab reports 82. The mint banner says "live board". A user reading the headline totals gets fabricated numbers presented as live.

**Evidence.** Playwright, seeded DB (3 cards in the DB, 2 painted):
board summary strip : "82 cards $544,200 est. 4 held"
rail tab counts     : ["R-01 Sales 82","R-02 Funding: Card Stacking 33","R-03 Funding: Alt-Fin (Lendflow) 15","R-04 Optimization (Repair) Rounds 44","R-05 Inquiry Removal 27","R-06 AR / Collections 75","R-07 Affiliates + Hiring 0"]
banner              : "live board · sales pipeline · 2 cards across 10 stages" (rgb(168,216,176) = mint/real)
Same strings appear verbatim on the empty-database run, confirming they are never written by the wire.

### [U] pipeline.html Owner filter is built once from the sample cards — real owners are not selectable and any selection hides every real card

`public/app/pipeline.html:1056` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** The #fOwner option list is populated by an IIFE in the interaction script that reads .c-act b from whatever cards exist at init — the sample cards. The live board script runs afterwards and replaces those cards but never rebuilds the select. The file's own comment ("the filters re-query the DOM each time, so cards swapped in underneath them stay fully interactive") is true of search but false of this control.

**How it fails.** Real cards owned by Marcus Webb and Jordan Reyes are on the board. The Owner dropdown offers only Agent 1, Agent 2, Agent 3, Agent 5, Compliance Gate, Context Fetcher, Jordan Blake, Nina Castellano, Setter Josh — none of whom owns a real card. There is no way to filter by an actual owner, and picking any offered name filters the board down to nothing.

**Evidence.** Playwright, seeded DB:
real card owners      : ["Marcus Webb","Jordan Reyes"]
#fOwner select options: ["","Agent 1","Agent 2","Agent 3","Agent 5","Compliance Gate","Context Fetcher","Jordan Blake","Nina Castellano","Setter Josh"]
real owner "Marcus Webb" selectable in #fOwner? false
Control: the search box does work — page.fill("#q","Ada") -> [{"name":"Ada Lovelace","filtered":false},{"name":"Grace Hopper","filtered":true}]

### [U] Affiliate commission accrual computes in floating point and persists a cent less than it owes

`src/affiliates/economics.mjs:165` · lens: Replay safety and money correctness — every INSERT path into

**What is wrong.** commissionFor() multiplies in float (`basis * (percent/100)`) and rounds with `round2()` at line 170, whose `Number.EPSILON` nudge is a no-op for any magnitude above 1 (EPSILON is relative to 1.0). Near-tie products round down, so commission_due is persisted a cent short. The repo already contains an exact integer-cents implementation — src/commissions/money.mjs — which this module does not use.

**How it fails.** AF-04 is decided and a 15% sale_price rule is inserted. An affiliate converts a client on a $1,010.10 sale. commission_due is written as 151.51; the correct half-up answer, and what Postgres itself computes for the same expression, is 151.52. Repeated across a payout run the affiliate statement disagrees with any spreadsheet recomputation, on an accrual table where nothing is ever recalculated because rule_snapshot is frozen at conversion.

**Evidence.** $ node <reused src/affiliates/economics.pg.test.mjs fixtures; same rule shape as the passing suite: percent 15 / sale_price>
convert #1: [{"converted":true,"unrated":false,"commissionDue":151.51,"basisAmount":1010.1}]
PERSISTED   : basis= 1010.10  commission_due= 151.51
Postgres numeric answer for 15% of 1010.10 = 151.52   <-- MISMATCH, short by 0.01
convert #2 (replay): [{"converted":false,"reason":"already_converted"}] -> rows: {"n":1,...}   (replay itself is fine)

Brute force over realistic pairs:
MISMATCH basis=1010.10 pct=15%   -> economics=151.51 exact=151.52 money.mjs=151.52
MISMATCH basis=1060.60 pct=7.5%  -> economics=79.54  exact=79.55  money.mjs=79.55
MISMATCH basis=5048.36 pct=12.5% -> economics=631.04 exact=631.05 money.mjs=631.05
float-path disagreed with exact half-up on 12 of 2730 (price,percent) pairs
economics.commissionFor vs commissions/money.percentOf disagree on 12 pairs

Control — the integer-cents module is exact, so this is a choice of engine, not an unavoidable float problem:
fromCents -> numeric(14,2) -> toCents mismatches: 0 of 401
percentOf vs exact half-up mismatches: 0 of 6024
applySplit vs exact half-up mismatches: 0 of 2510

The documented AF-04 gap is that the *rates* are undecided (affiliate_commission_rules ships empty). The *arithmetic* being wrong is not documented, and economics.mjs's own header asserts "RATES ARE ROWS" while saying nothing about the maths.

### [U] /api/health takes 135s against a host that drops packets — no pg connect timeout, so the "never 5xx" contract breaks on serverless timeout

`src/db.mjs:10` · lens: Route reachability and liveness: every ROUTES entry in netli

**What is wrong.** src/db.mjs constructs pg.Pool with only `max` — no connectionTimeoutMillis. When DATABASE_URL points at a host that silently drops SYNs (firewall DROP, IP allowlist, suspended endpoint) the health query blocks for the OS TCP timeout. Measured 135 seconds, far past any serverless function budget.

**How it fails.** DATABASE_URL is set to a Neon endpoint behind an IP allowlist that does not include the Netlify egress range, so packets are dropped rather than refused. GET /api/health blocks 135s; Netlify kills the function at its 26s ceiling and returns its own 502 error page. public/app/shell.js:267-280 gets a non-JSON 502 and labels the chip "NO API" ("/api/* is not deployed") instead of "NO DB", which is the exact misdiagnosis src/http/health.mjs was written to prevent — its header says a 5xx "trips uptime monitors and Netlify's own error pages" and that the answer must arrive as a body, never a status code. Every other /api/* route inherits the same 135s stall on the same pool.

**Evidence.** Measured empirically, four states:
  DB up              -> HTTP 200 state:"up" migrations:33      leak: none   (<1s)
  DATABASE_URL unset -> HTTP 200 state:"unconfigured"          leak: none   (<1s)
  unresolvable DNS   -> HTTP 200 state:"unreachable" error:"database error"   leak: none   (<1s)
  ECONNREFUSED       -> HTTP 200 state:"unreachable" error:"connect ECONNREFUSED [redacted]"  leak: none   (<1s)
  blackholed IP      -> HTTP 200 state:"unreachable" error:"connect ETIMEDOUT [redacted]"     leak: none   but elapsed=135s

Redaction is correct in all five: scanned each body for the DSN's hostname, password, username and port — zero leaks, Cache-Control: no-store present. The defect is purely the unbounded connect.

grep for connectionTimeoutMillis|statement_timeout|query_timeout across src/, api/ and netlify/ returns nothing; src/db.mjs:10 is `new pg.Pool({ connectionString, max: Number(process.env.PG_POOL_MAX || 10) })`.

### [U] Replaying a purchase event silently un-revokes a revoked entitlement

`src/entitlements/entitlements.mjs:101` · lens: Replay safety and money correctness — every INSERT path into

**What is wrong.** grant()'s conflict branch cannot tell a genuine re-purchase from a replay of the event that already granted. Matching on `source_transaction_id IS NOT DISTINCT FROM $4` it finds the same revoked row and clears revoked_at, revoked_by and revoke_reason (line 101), reinstating access that was deliberately withdrawn.

**How it fails.** A client's payment is charged back. Ops calls revoke() — entitlement gone, revoke_reason 'chargeback' recorded. Later a dead-letter retry, a `replay()` after a merge, or a duplicate webhook re-drives the SAME payment.received. grantFromTransaction runs again with the same transaction id, the row is un-revoked, and the client has their deliverables back with the revocation audit trail wiped. Nothing logs it — the return value says `granted`.

**Evidence.** $ node <reused src/entitlements/entitlements.pg.test.mjs fixtures>
first delivery : {"granted":["metro2-letter-pack"],"unmapped":false} has= true
after revoke   : {"revoked":1,...}                                    has= false
replay of SAME : {"granted":["metro2-letter-pack"],"unmapped":false} has= true
rows: [{"revoked_at":null,"revoke_reason":null,...}]

The module header (entitlements.mjs:10-14) claims the opposite: "IDEMPOTENCE. grantFromTransaction() is safe to replay ... Re-delivering the same payment grants nothing new." It grants back something that was taken away.

Reachability caveat, stated honestly: no production code calls grant/grantFromTransaction today (see the no-writer finding), so this is latent rather than live. It becomes live the moment the purchase path is wired, and the existing pg-test suite does not cover the revoke-then-replay sequence.

### [U] The dead-letter queue is never drained — no code path calls retryDue or retryOne

`src/events/dead-letter.mjs:208` · lens: Replay safety and money correctness — every INSERT path into

**What is wrong.** Recording and isolation work correctly, and next_attempt_at is computed on every failure, but nothing acts on it: retryDue and retryOne have no caller anywhere in the repo, there is no cron, no scheduled Inngest function and no write endpoint (api/read/failed-events.mjs is read-only). HANDOFF.md:61 lists this under "What is actually done ... verified against a real Postgres" as "Handler failures isolated + recorded, retry with backoff".

**How it fails.** A handler that accrues money throws once — a provider blip, a schema drift like the invoices one above. The failure is recorded with status 'pending' and next_attempt_at one minute out, implying an automatic retry. No retry ever comes. The row sits pending forever, attempts stuck at 1, and the owed work is only recovered if a human happens to read /api/read/failed-events. The backoff ladder, MAX_ATTEMPTS and the 'exhausted' state are all unreachable in production.

**Evidence.** $ grep -rn 'retryDue|retryOne' --include=* . | grep -v node_modules | grep -v '^./src/events/dead-letter.mjs' | grep -v dead-letter.pg.test.mjs
(no output — definitions and unit tests only)
$ grep -rn 'cron:' --include=*.mjs --include=*.toml . | grep -v node_modules
(no output)
$ cat api/read/failed-events.mjs   -> readHandler(...), SELECT only

The rest of the dead-letter contract does hold, verified by making a handler throw:
emit resolved: {"dispatched":{"handlers":3,"failed":1,"recorded":1}}
handlers ran : first,boom,third          <- siblings after the throw all ran
failed_events: [{"handler_name":"boomHandler","status":"pending","attempts":1,...}]
redelivery of the same event -> same row, attempts 1 -> 2 (one row, not two)
record() on a broken queue: {"ok":false,"error":"relation ... does not exist"} -> did NOT throw
emit rejected as designed: all 1 handler(s) failed and none could be dead-lettered

So the finding is narrowly the missing drain plus the doc claiming it runs.

### [U] A NUL byte in any string parameter produces a 500 carrying a raw Postgres message

`src/http/read-api.mjs:151` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** No handler rejects U+0000 before it reaches pg. Postgres refuses it with SQLSTATE 22021, which is not in CLIENT_DATA_ERRORS, so every route classifies a caller's malformed input as a server fault and echoes the driver text. Reachable unauthenticated on /api/auth/login, where the throw escapes login() entirely into the adapter's generic catch.

**How it fails.** Anyone sends GET /api/read/staff?role=%00 (or ?status=%00, ?bureau=%00, ?client_id=%00, ?q=%00, ?key=%00 — any text filter on any read route) and receives 500 {"error":"query_failed","message":"invalid byte sequence for encoding \"UTF8\": 0x00"}. Unauthenticated: POST /api/auth/login {"email":"chris@fundhub.ai ","password":"x"} -> 500. On /api/dashboard/pipeline the same input is reported as 503 {"db":"down"} — a caller's bad byte announced as a database outage. Every one of these should be a 400.

**Evidence.** $ node nul.mjs
500 read/staff role NUL      {"error":"query_failed","message":"invalid byte sequence for encoding \"UTF8\": 0x00"}
500 read/invoices status NUL {...same}
500 tasks q NUL              {...same}
503 pipeline key NUL         {"ok":false,"db":"down","error":"invalid byte sequence ..."}
500 brand entity_name NUL    {"error":"write_failed","message":"invalid byte sequence ..."}
$ node bodies.mjs
500 NUL creds     {"error":"internal_error","message":"invalid byte sequence for encoding \"UTF8\": 0x00"}
500 NUL in email  {...same}   <- unauthenticated route

The first GET fuzz pass hit this on 13 of 13 read routes plus /api/tasks and /api/dashboard/pipeline. Emoji/unicode without NUL is handled correctly (200, empty result set).

### [U] read-api's 500 branch echoes raw Postgres messages including relation names

`src/http/read-api.mjs:151` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** The fallback scrubber only rewrites DSN URLs (`postgres://...`). Relation names, column names, constraint names and the rest of the driver message are returned to the caller intact on all 13 read endpoints. src/http/health.mjs:safeError() is the stronger scrubber and is not used here — and even it does not remove schema identifiers.

**How it fails.** A migration is applied out of order, or a view is dropped/renamed during a deploy. GET /api/read/partners answers 500 {"error":"query_failed","message":"relation \"v_partner_balance\" does not exist"}, handing any authenticated caller the internal schema object names. The same branch is what returns the NUL-byte message above, so it is reachable on demand rather than only during a deploy accident.

**Evidence.** $ psql -c 'ALTER VIEW v_partner_balance RENAME TO v_partner_balance_moved'
$ curl /api/read/partners  (via the adapter, owner session)
500 {"ok":false,"error":"query_failed","message":"relation \"v_partner_balance\" does not exist"}
$ psql -c 'ALTER VIEW v_partner_balance_moved RENAME TO v_partner_balance'   (restored)

### [U] Invoices are written with a NULL idempotency key, so the ON CONFLICT guard never fires

`src/workflows/ds-02-diy-letters.mjs:101` · lens: Replay safety and money correctness — every INSERT path into

**What is wrong.** DS-02 passes `idempotencyKey: saleId ? depositKey(saleId) : null` and F-07 passes `(saleId && fundingRoundId) ? successFeeKey(...) : null`. Neither id is ever present: the Commas payload (commas.mjs:183-189) carries no saleId, the Lendflow round payload carries no saleId or fundingRoundId, and nothing in the codebase writes the `sales` or `funding_rounds` rows those ids would come from. createInvoice's guard is `ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL`, which is inert on NULL, so every replay writes another row of money owed.

**How it fails.** Once the column drift is fixed and INNGEST_EVENT_KEY is set, a re-delivered DIY payment.received (Inngest is at-least-once) runs DS-02 again and raises a second $1,000 deposit invoice against the same client. v_client_ar_balance now shows $2,000 owed for a single $1,000 purchase, and the AR ladder chases the client for money they do not owe. Same shape for F-07's success-fee invoice on a re-delivered round.funded.

**Evidence.** $ psql -d audit_replay   (the exact statement from src/invoices/index.mjs:27-36 with 031's column names, run twice with idempotency_key NULL)
                            check                             | count | money_owed
 NULL idempotency_key -> rows written by 2 identical inserts:  |     2 |    2000.00

$ grep -n 'idempotencyKey:' src/workflows/ds-02-diy-letters.mjs src/workflows/f-07-funding-locked.mjs
src/workflows/ds-02-diy-letters.mjs:101:      idempotencyKey: saleId ? depositKey(saleId) : null,
src/workflows/f-07-funding-locked.mjs:83:      idempotencyKey: (saleId && fundingRoundId) ? successFeeKey(saleId, fundingRoundId) : null,

saleId is read from `event.payload` and no emitter supplies it; `grep -rniE 'insert into +sales'` outside migrations/tests returns nothing. The existing replay test (ds-02-diy-letters.test.mjs:75, "duplicate delivery: replaying the same event does not double-send, double-task, or double-tag") asserts messages/tasks/tags only and never counts invoices — and could not, since pgFake has no invoices branch. Every other event-driven writer in this repo (tasks, transactions, entitlements, affiliate_referrals) keys off something guaranteed present; this one keys off an id that never exists.


## LOW

### [U] APPLY-NOTES gives a diagnostic for a missing INQUIRY_API_SECRET that does not match what the endpoint does, and the variable is absent from .env.example

`APPLY-NOTES.md:83` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** APPLY-NOTES.md:83 says 'If it says upstream unreachable, INQUIRY_API_SECRET is missing/wrong.' A missing secret produces 500 {"error":"INQUIRY_API_SECRET not set"} — never 'upstream unreachable', which is the 502 raised only when the fetch itself fails. Following the note sends the operator looking at the secret when the upstream is down, and leaves them with no documented explanation for the 500 they actually get. Neither INQUIRY_API_SECRET nor INQUIRY_API_BASE appears in .env.example.

**How it fails.** An operator deploys without INQUIRY_API_SECRET (it is not in .env.example, so it is easy to miss). Alvin opens the inquiry screen and every call — including a plainly invalid ?action=bogus — returns 500 {"ok":false,"error":"INQUIRY_API_SECRET not set"}. The operator consults APPLY-NOTES, is told to look for 'upstream unreachable', does not find that string, and has no documented path to the real cause. The secret check also runs before action validation, so a caller's bad action is reported as 500 rather than the 400 the endpoint returns once the secret is present.

**Evidence.** $ node run-get.mjs   (no INQUIRY_API_SECRET)
500 /api/inquiry <none>            {"ok":false,"error":"INQUIRY_API_SECRET not set"}
500 /api/inquiry action=bogus      {"ok":false,"error":"INQUIRY_API_SECRET not set"}
$ INQUIRY_API_SECRET=dummy INQUIRY_API_BASE=http://127.0.0.1:59999 node inq.mjs
400 ?action=bogus     {"ok":false,"error":"unknown_action","allowed":["cases","status","schedule","launch","update"]}
502 ?action=cases     {"ok":false,"error":"upstream_unreachable","message":"fetch failed"}
405 GET ?action=schedule {"ok":false,"error":"method_not_allowed","expected":"POST"}
$ grep -n INQUIRY .env.example   -> no match
(The 502 does not leak the upstream hostname — verified with an unresolvable INQUIRY_API_BASE.)

### [U] HANDOFF.md's done-table points at db/migrations/ for "33 files"; that directory holds 21

`HANDOFF.md:60` · lens: Factual accuracy of HANDOFF.md and VERIFICATION.md — every f

**What is wrong.** The row reads "| Schema | `db/migrations/` | 33 files, clean from scratch, idempotent |". 33 is the correct total for a full `node db/migrate.mjs` run, but that total spans three directories — db/schema (10), db/migrations (21) and db/seed (2). The named directory contains 21 files.

**How it fails.** An engineer verifying the handoff runs `ls db/migrations | wc -l`, gets 21 against a documented 33, and concludes twelve migrations are missing from the checkout — or starts hunting for a partial clone. The same mismatch makes it easy to miss that db/schema/ and db/seed/ are also applied by the runner and must be kept in filename order alongside it.

**Evidence.** $ ls db/migrations/*.sql | wc -l   -> 21
$ for d in schema migrations seed; do ls db/$d/*.sql | wc -l; done -> 10, 21, 2
$ ls db/schema/*.sql db/migrations/*.sql db/seed/*.sql | wc -l -> 33

The runner confirms the split — db/migrate.mjs:12 `const DIRS = ["schema", "migrations", "seed"]`, and the applied keys are prefixed by directory ("schema/001_init.sql", "migrations/010_products.sql", "seed/002_pipelines.sql"). Full run: "Done. 33 migration(s) applied."

### [U] HANDOFF.md contradicts itself on how many screens are wired

`HANDOFF.md:9` · lens: Do all 21 screens in public/app/ actually work in a real bro

**What is wrong.** The one-line summary says "14 of 21 screens read real data" and "7 screens with no data source yet"; the body 70 lines later says "15 of 21 read real data" with a 15-name list and heads the section "Six screens are still on sample data". The body is the accurate one.

**How it fails.** The next engineer reads the summary, budgets for 7 unwired screens, and cannot reconcile it with the 15-name list and the "remaining 6" table in the same file.

**Evidence.** grep -n over HANDOFF.md:
  9:  "…14 of 21 screens read real data. What"
 10:  "remains is 7 screens with no data source yet…"
 76:  "### 1. Six screens are still on sample data"
 78:  "**15 of 21** read real data: `client-control-panel`, `pipeline`, …"
Measured in Chromium: 15 screens issue a read — 12 fire one unprompted (affiliate, agent-editor, calendar, command-center, documents, inquiry-remover, messaging, ops-admin, partner-galaxy, pipeline, products-commissions, staff-teams) plus 3 that need a query param (client-control-panel ?id, client-portal ?id, brand-studio ?partner_id). The body count of 15 is correct.

### [U] Three GET-only routes accept every HTTP method instead of answering 405

`api/dashboard/clients.mjs:48` · lens: Hostile input: every registered route in netlify/functions/a

**What is wrong.** api/dashboard/clients.mjs, api/dashboard/pipeline.mjs and api/health.mjs have no method check, so POST/PUT/DELETE/PATCH are served as if they were GET. Every other route in the map answers 405 correctly. No write occurs — verified against pg_stat_user_tables — so the impact is limited to the wrong status and to caches/proxies seeing a 200 on a DELETE.

**How it fails.** DELETE /api/dashboard/clients returns 200 with the full client list (names, emails, tiers, funded amounts). A caller — or an intermediary retrying a failed request with the wrong verb — is told the delete succeeded. The correct answer is 405.

**Evidence.** $ node methods.mjs
/api/health              GET=200 POST=200 PUT=200 DELETE=200 PATCH=200 HEAD=200 OPTIONS=200
/api/dashboard/clients   GET=200 POST=200 PUT=200 DELETE=200 PATCH=200 HEAD=200 OPTIONS=200
/api/dashboard/pipeline  GET=200 POST=200 PUT=200 DELETE=200 PATCH=200 HEAD=200 OPTIONS=200
/api/read/staff          GET=200 POST=405 PUT=405 DELETE=405 PATCH=405 HEAD=405 OPTIONS=405   <- correct
/api/auth/session        GET=200 POST=405 PUT=405 DELETE=405 PATCH=405 HEAD=405 OPTIONS=405   <- correct

Write safety confirmed: pg_stat_user_tables snapshot before and after a 76-request POST/PUT/DELETE/PATCH sweep of all 19 read routes differed only in auth_attempts (+1) and sessions (+1), both from the sweep script's own login.

### [U] /api/inquiry answers 500 for a missing environment variable

`api/inquiry.mjs:32` · lens: Route reachability and liveness: every ROUTES entry in netli

**What is wrong.** When INQUIRY_API_SECRET is unset the route returns 500 with the variable name in the body. A deployment configuration gap is reported as a server fault, and the current production deployment has no env vars set at all.

**How it fails.** An authorized inquiry_specialist or admin hits /api/inquiry?action=cases on the live Netlify site, where APPLY-NOTES.md lists INQUIRY_API_SECRET as a required variable but HANDOFF.md:151 confirms nothing is configured. They get HTTP 500 {"ok":false,"error":"INQUIRY_API_SECRET not set"} rather than a 503/misconfigured signal, so the failure is indistinguishable from a crash in uptime monitoring and in public/app/data.js's classifier. The role gate runs first, so it is not exploitable by an unauthenticated caller.

**Evidence.** Through the real adapter with an owner session and INQUIRY_API_SECRET unset:
  500 GET /api/inquiry?action=cases  {"ok":false,"error":"INQUIRY_API_SECRET not set"}
As a closer the role gate correctly fires first:
  403 GET /api/inquiry?action=cases  {"ok":false,"error":"forbidden","required":["inquiry_specialist","admin"]}
This was the only other 5xx among all 24 registered routes; every other route answered 200/400/403/404 as owner and as closer.

---

## What the audit itself missed, and what that says about the earlier verification

The completeness critic found three things no lens would have caught by construction,
because every lens starts from something *reachable* — a route that exists, a screen that
loads, a migration that applies. None enumerated the inverse.

1. **`src/partners/scope.mjs` has zero production importers.** The tenancy boundary is
   fully written, fully tested, and wired into nothing. `src/http/read-api.mjs` contains no
   reference to partner, scope or principal, and no `api/read/*` query filters `partner_id`.
   `042_partners.sql:89` carries a column comment stating "every partner-facing read filters
   on it via src/partners/scope.mjs" — that is false.

   VERIFICATION.md's mutation test ("scope.mjs gutted -> 13 of 26 failed") gutted the module
   and re-ran *that module's own unit tests*. That proves the tests test the module. It says
   nothing about whether anything calls it. **That is a methodological hole in the earlier
   verification, not a new defect** — and it is the one worth learning from, because the same
   shape of mistake would pass again.

2. **`src/documents/*` is dead code.** Nine files plus five test files, imported by zero
   production modules. `retrieve.mjs` mints links at `/api/documents/<id>` and that route does
   not exist in `netlify/functions/api.mjs`. There is currently no way to fetch a document's
   bytes at all — `api/read/documents.mjs` serves metadata and strips `storage_key`.

3. **`/api/webhooks/lendflow` returns 404.** `src/adapters/lendflow.mjs` is 440 lines, fully
   tested, and is the *sole emitter* of `round.started`, `round.submitted`, `round.approved`
   and `round.funded`. It is not in `src/http/router.mjs`. Eight workflows and back-end
   commission accrual therefore have no trigger at all. `docs/diagrams/adapter-boundary.md`
   documents it as a live HMAC-verified inbound webhook, and `npm run diagrams:check` reports
   "up to date" — because the generator reads `src/adapters/*.mjs`, not the router. A
   structural check passing over a half-dead feature, again.

4. **Nothing transmits.** `sendTemplated` (`src/workflows/messaging.mjs:75`) inserts `messages`
   rows with `provider='internal', status='queued'`. No module selects `status='queued'`, and
   there is not one `fetch()` in `src/adapters/` or `src/lib/` — the adapters are inbound
   parsers only. HANDOFF's "setting the Inngest keys turns 47 functions live" will not produce
   a single outbound SMS or email.

5. **78 tests never run.** `scripts/marketing/lib/*.test.mjs` falls outside the `npm test`
   globs. All 78 pass today, so this is latent rot rather than a live defect.

## Corrections to VERIFICATION.md

The earlier verification pass overstated its coverage in two specific ways, both worth
recording so the same check is not trusted again:

- **"15 of 21 screens verified in Chromium: 0 console errors, 0 failed requests"** was true and
  insufficient. It asserted banner tone and the absence of errors. It did not assert that the
  real data was *visible in the right DOM node*, or that it *survived the screen's own
  interactions*. Seven screens fail one of those two while showing a green "live" banner —
  `calendar` paints into a hidden drawer, `documents` and `staff-teams` revert to sample on the
  first filter keystroke, `pipeline` renders 5 of 10 stages, `staff-teams` is column-shifted.

- **"Partner isolation — mutation-tested three ways"** tested the module, not its integration.
  See point 1 above.
