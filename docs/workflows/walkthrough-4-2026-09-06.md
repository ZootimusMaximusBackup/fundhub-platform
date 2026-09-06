# Walkthrough 4 — 2026-09-06 — funding + repair fulfillment, and what the sweep found

Board for the 4A/4B/4C walk. Chris clicks the live site; Claude watches production read-only.
Everything below is measured, not assumed. Where a number is quoted, the query ran against production.

## What actually blocked the walk

**Nothing merged to main between 10:25 and 17:48 ever reached the site.** Six main builds failed
in a row with a bare exit code. Cause: three hiring tables (`candidate_outreach`,
`hiring_role_brief_revisions`, `hiring_zoho_candidate_links`) had row-level security switched on
with no policy attached — flipped out of band, not in any migration — and `guard:rls` in
`build.command` refused to ship it. Branch previews skip that step, so every preview was green.
Fixed by migration 364 (PR #351, merged 17:48). Fourth occurrence of this class (109, 154, 200, 364).

The laptop's own `netlify deploy` failed differently: it built the laptop's checkout (141 commits
behind main, plus an untracked migration 299) and hit `permission denied` because a local run
falls back to the restricted app role. Nothing landed.

## Version control, accounted for

- 82 files / 12,707 lines existed only on the laptop → committed, PR #353 (draft).
- `fix/nudge-r4-2026-09-06`, 9 commits / 7,108 lines, had no pull request → PR #352 (draft).
- 5 branches fully contained in newer ones (zero unique commits): nudge-r2, nudge-r3,
  waypoint-nudge-ladder, letters/r2-w8b-p2, lane2/r2-w10-docs-p2 → delete.
- Everything else has a PR. Nothing orphaned.

## Data that was never loaded (same shape as the bureau gap)

| Built | Holds |
|---|---|
| `client_waypoints` for Walk1 | 0 rows |
| `client_push_subscriptions` | 0 |
| `paid_service_requests` | 0 |
| `customer_insights` | 0 |
| `lender_bureau_observations` | 0 |
| `candidate_outreach`, `hiring_role_brief_revisions` | 0 |
| `lenders.bureaus_pulled` | 46 of 307 (365 adds 70; 237 stay null — no source names them) |
| `invoices.due_at` | 0 of 1 |
| `clients.funded_amount` | 0 of 37 |
| `pii_identity.verified_legal_name / verified_address` | 0 of 5 |
| `application_decisions.play_name` | 0 of 5 (write-only field; dropdown removed) |

## Walk findings (before the sweep)

- Walk2 ($1,000 six-round) never enrolled: events stop at `payment.received`. Walk3 only looked
  enrolled because a person pressed the Specialist-desk button at 11:11, ninety minutes before its
  payment. Neither payment enrolled anyone. Fixed on main today; **does not retro-fix either client**
  — enrol by hand from the Present deck, not the desk button (hardcoded to 2 rounds).
- Walk1 has 11 tasks, two exact duplicates (`Assign pod roles`, `Pre-funding review`), created
  twice by `f-01-funding-intake` and `c-05-pre-funding-review`. Data, not display.
- Blocker cards painted green under a heading reading ACTIVE BLOCKERS; two contradicting
  "owner-set 2026-09-06" notes in the same file. → yellow (PR #354).
- "Remove Inquiries" was the biggest text on the page with nothing under it; the four banks were a
  run-on footnote three sections down. → listed under the step (PR #354).
- "How did you apply?" dropdown fed a column nothing reads. → removed. Bank yes/no → Approved /
  Declined / Pending (PR #354).
- Apply-door rows showed no bureau; the row already knew how to print it. → 365/366/seed 025.

## Sweep: 28 confirmed rule-versus-reality defects

Six finders, one angle each; every candidate attacked by a verifier told to refute it and to
default to "refuted" unless both halves were visible on origin/main. 47 in, 28 survived.
Line numbers are origin/main at bc1ae968.

### 1. Credit-score bars on the client-facing deck are coloured by bureau, not by score — Experian's bar is always the red one  `high`

**What you see:** On the slide a closer shows the client — "Here's what the AI found" — there are three score bars, one per credit bureau. The Experian bar is ALWAYS the red/coral one, the TransUnion bar is ALWAYS the green one, and the Equifax bar is ALWAYS blue. The colour is picked by which row it is, never by the number. A client with a great 790 Experian score sees a red bar for it, and a client with a poor 520 TransUnion score sees a green bar. Red is supposed to mean "blocked, failed" and green is supposed to mean "healthy", so the deck is telling a customer something about their own credit that is not true. This is the screen we show a paying customer during a sales call.

**The rule:** `public/app/fundhub-brand.css:15-19` — "/* Status colors are spectrum stops. Do not invent others. */ --ok:#A8D8B0; /* sage - active, on pace, success, healthy */ --warn:#F5CE8F; /* peach - in progress, behind, warning */ --alert:#F2A69B; /* coral - blocked, failed, alert */ --info:#A9C6E8; /* blue - informational */"

**The code:** `public/app/present.js:350 (used by the "Your results" slide at present.js:499)`

**Verified:** On the closer deck's customer-facing "Your results" slide (public/app/present.js:499, rendered into the client pane at present.js:1020), the three credit-score bars are coloured by row position rather than by score — present.js:350 hardcodes `["var(--alert)", "var(--ok)", "var(--info)"]` against the fixed row order Experian, TransUnion, Equifax at present.js:351 and indexes it by `i` at present.js:355, never by the value `v` — so Experian's bar is always coral, TransUnion's always sage and Equifax's always blue, contradicting fundhub-brand.css:16-18, which define those exact tokens as "succes…

### 2. The two contracts stamped "DO NOT SEND THIS" are one click away from a real client  `high`

**What you see:** A closer finishes a funding call or a credit-repair call, presses the one button that sends the agreement, and the client opens a contract whose terms section reads "PLACEHOLDER. THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS." Nothing stops it. Migration 288 states in writing that these two "still refuse to be sent by accident" — that sentence is not true; the only thing standing between them and a client is somebody remembering TODO.md. The same product already knows how to do this: the text-message sender refuses unfinished copy at src/messaging/dispatch.mjs:63. The contract sender does not.

**The rule:** `db/seed/007_contract_templates.sql:149 (same string at db/migrations/287_contract_seller_signature_and_real_text.sql:296 and :343); TODO.md:9-11; db/migrations/288_real_contract_text.sql:26-29` — ">>> PLACEHOLDER. THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS. <<< ...and, in TODO.md: "**Do not send a funding-deposit or credit-repair contract.** Those two still carry \"THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS.\" on purpose, because no text exists for them." ...and, in migration 288: "NOT SUP…"

**The code:** `src/contracts/send.mjs:312-400 (the send path checks only that the template is not archived, at :180-185, and that no manual blanks are unfilled, at :373-379 — nothing looks for the placeholder marker); the two template keys are wired to the closer's one-click send at src/config/offers.mjs:104 and :115, and sent by public/app/contract-send.js:110 from public/app/present.js:1109`

**Verified:** Migration 288 says in writing that the $3,000 funding agreement and the $1,000 credit-repair agreement "still refuse to be sent by accident" (db/migrations/288_real_contract_text.sql:26-29), but nothing in the code refuses: the send path (src/contracts/send.mjs, which only checks voided/signed/blanks/empty-body) will happily freeze and mail a contract whose terms section reads "PLACEHOLDER. THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS.", and a closer reaches it with one press of the "Send contract" button on the pitch screen (public/app/present.js:932 → :1109, offer keys wired at src…

### 3. The affiliate terms page tells partners they earn nothing on the 10% success fee — the opposite of the owner's decision  `high`

**What you see:** A partner opens the Terms tab of their affiliate screen and reads that the 10% success fee does not earn them anything, and that funding pays only on the deposit. The database pays them the opposite — 20% of the partner's half of every payment on the funding sale, deposit and success fee both. On a $120,000 funding, that is the difference between a partner expecting about $600 and actually being owed $1,200. Whichever number they see first is the one they will argue from.

**The rule:** `docs/specs/W0-decisions.md:54-56; db/migrations/272_affiliate_success_fee_share_20260831.sql:3-4 and :127` — ""## Affiliates earn on the back end — **Yes.** An affiliate earns on the 10% success fee, not only on the deposit." ...and, in the migration that implemented it: "OWNER-SET (Chris 2026-08-31, docs/specs/W0-decisions.md \"Affiliates earn on the back end\"): an affiliate earns on the 10% success fee, not only on the dep…"

**The code:** `public/app/affiliate.html:421 ("The 10% success fee is not a qualifying product.") and :400 ("Funding pays on deposit collected once funded"); the stale wording also survives in the file's own comment at :476. git blame: line 421 was written 2026-07-29, five weeks before the 2026-08-31 decision, and was never updated.`

**Verified:** The affiliate portal's own text still promises the pre-2026-08-31 deal: public/app/affiliate.html:400 tells a partner "Funding pays on deposit collected once funded" and :421 tells them "The 10% success fee is not a qualifying product", but migration 272 (db/migrations/272_affiliate_success_fee_share_20260831.sql:107-118) switched off the `deposit_collected` rule those sentences describe and replaced it with `partner_share_of_cash`, which pays 20% of the partner's half of every non-refund payment on the funding sale — the deposit and the success fee both. On a $120,000 funding the screen impl…

### 4. Galaxy invents funded/deposit dollars and prints them over real staff names — the owner's "no invented money" ruling was applied to partner-galaxy.html only  `high`

**What you see:** Open Galaxy. The pill says LIVE and the banner says "Live — Open shifts, recent events, and agents". Every ten to twenty seconds a big "+$18,500" and the words ROUND FUNDED rise off one of your real staff members on the sky, and the legend beside it says "flare = money landing". Click that person and their timeline reads "Round funded — $18,500" with a real Arizona timestamp. None of it happened. The amount is a random number the browser made up; the same code also quietly adds it to the real "Cash collected" and "Funded today" figures the server sent. The rail lines also pair a real client's name with a randomly picked stage, so it looks like named clients are moving through funding when n…

**The rule:** `public/app/partner-galaxy.html:453-468 (owner ruling T10-02, 2026-08-19); same rule stated in docs/UI-STANDARDS.md:48` — "NO NUMBERS LIVE ON THIS CANVAS. (T10-02, owner ruling 2026-08-19.) … every one of their values was made up. They started at zero and the only thing that ever changed them was a dice roll: a scheduled evMoney() picked `3000 + (Math.random()<0.5?300:0)` or `8500 + Math.round(Math.random()*7)*2500` and flew that figure i…"

**The code:** `public/app/galaxy.html:626-651 (evMoney, identical dice rolls at :634 and :637, node timeline stamp at :645), :1424-1441 (draws "+$18,500" / "ROUND FUNDED" over the worker, then bumpKPI(f.k.id, f.amt, true)), :1799 (evMoney registered in the live scheduler); client names for the fake rail pulses come from src/galaxy/company-activity.mjs:257-269, which returns simulated:false`

**Verified:** On galaxy.html — the screen shell.js:1322 calls the owner's and staff's own Galaxy — a scheduled evMoney() (public/app/galaxy.html:626-651, dice rolls at :634 and :637 identical to the ones the owner killed on the partner screen) invents a dollar amount every 10-22 seconds, paints "+$18,500 / ROUND FUNDED" over a real staff member's node (:1430-1434) and writes "Round funded — $18,500" into that person's timeline with a real Phoenix timestamp (:645, rendered :1698), all while the pill says LIVE (:1806-1809) and the feed behind it returns simulated:false (src/galaxy/company-activity.mjs:302) —…

### 5. A client's portal Payments tab always says "No payments yet" — it is never painted for a client, and the invoice the server now returns is read by nothing  `high`

**What you see:** A client signs in to their portal, opens Account & history, and the Payments tab says "No payments yet — They show here after you pay." It says that for every client, always. It says it to someone who paid you last week, and it says it to someone you are emailing right now chasing a $5,000 success fee. The server was fixed on 2026-09-06 to send the amount owed, the invoice number and the checkout link — but the screen never asks for it, and the painting code only ever runs when a staff member is looking at the page, never for the client themselves.

**The rule:** `api/read/portal-summary.mjs:399-406 (and the same principle restated in public/app/client-portal.html:2717-2719: "This must never leave 'No activity recorded on this file yet.' on screen, because that sentence claims something about the file that a failed read cannot know.")` — "WHAT WAS WRONG (walk finding, 2026-09-06). Walk1 Funding's round funded, the platform raised a $5,000 success-fee invoice, marked it sent, minted a working checkout link for it, and emailed her chasing payment at 11:21. She then opened her portal to pay and the Payments tab showed the words "Success Fee" with a DASH w…"

**The code:** `public/app/client-portal.html:843-852 (the shipped Payments markup: "No payments yet" / "They show here after you pay", and #fee-row is hidden and never unhidden) with public/app/client-portal.html:2243-2252 (paintPays runs only inside `if (STAFF_ROLES[roleHint()])`); the portal never reads data.invoice_due anywhere — grep across public/ finds zero uses`

**Verified:** Every client's Payments tab shows a "Success Fee" line with a dash where the amount belongs and "No payments yet" underneath it, forever — the server was fixed on 2026-09-06 to send the exact amount owed, the invoice number and a working checkout link in `invoice_due` (api/read/portal-summary.mjs:254), but nothing in public/ reads that field (zero hits repo-wide), the only code that paints the tab with real data runs behind a staff-only branch a client can never enter (public/app/client-portal.html:2243), and the "Success Fee" row's `hidden` attribute at line 844 does nothing because `.pay-ro…

### 6. Brand Studio tells a partner their SSL certificate is issued automatically, and stamps "Verified · SSL issued" — nothing issues any certificate  `high`

**What you see:** A partner adds their domain, adds the TXT record we give them, presses Verify, and the Domain card turns green and reads "Verified · SSL issued". They believe their branded site is live and secure. Nothing has issued a certificate and nothing ever will on its own — somebody has to add that domain in Netlify by hand. Until they do, visitors to the partner's domain get a browser security warning or nothing at all, while our screen says it is done. The same screen's own success message one line of code away says "Add the domain in Netlify for SSL", so the page contradicts itself.

**The rule:** `public/app/brand-studio.html:404 (the hint under the "Your domain" box, BS-03)` — "You own it, you point it here. SSL is issued automatically once DNS resolves."

**The code:** `public/app/brand-studio.html:673 (`dt.textContent = D.verified ? "Verified · SSL issued" : …`); contradicted by the same file at :817 ("DNS verified for " + D.domain + ". Add the domain in Netlify for SSL, then publish pages.") and by api/partner-brand/verify-domain.mjs:44-72, which only does a DNS TXT lookup and replies "Domain verified. Point the domain (CNAME/ALIAS) at this Netlify site so SSL and Host-based routing work."`

**Verified:** Brand Studio's Domain card promises "SSL is issued automatically once DNS resolves" (brand-studio.html:404) and then, on a successful TXT check, permanently stamps "Verified · SSL issued" plus a "Live" tile (:673, :667) — both re-rendered from the saved database flag on every future page load (:1270) — even though no code in the repository issues a certificate (verify-domain.mjs does a DNS TXT lookup only), and the page's own one-shot success message that disappears on reload says the opposite: "Add the domain in Netlify for SSL" (:817). The partner sees a permanent green "SSL issued / Live" …

### 7. Four wide-open public endpoints are documented as "NOT open" and signature-checked  `high`

**What you see:** The journey pages tell you four public web addresses are protected — that a stranger who calls them without the right secret handshake gets turned away. Not true. Nothing is checked. Anyone on the internet can post to the funnel checkout, the survey, the education enrollment and the /optimize form and create records in your system. The generator only decided they were protected because the word "providers" happens to appear in an unrelated import line inside each file. Grep proves it: not one of the four files contains the words verify, hmac, secret, token or signature anywhere.

**The rule:** `scripts/journeys/extract.mjs:19-22 and :326-331; printed by scripts/journeys/render.mjs:262` — "extract.mjs states the rule twice. Lines 19-22: "returns kind \"unverified\" with the reason. It never guesses, never falls back to \"probably staff\", and never omits the route to keep the picture tidy. An unverified gate is a finding — possibly a real hole — and hiding it in a generator would be the most expensive k…"

**The code:** `Detector: scripts/journeys/extract.mjs:363. Handlers with zero verification: api/public/optimize.mjs:221, api/public/survey-submit.mjs:170, api/public/education-enroll.mjs:162, api/public/funnel-checkout.mjs:330. False claim rendered at docs/journeys/client-actual.md:95-100 and :117, docs/journeys/role-owner-actual.md:193-198 and :291, and the same two places in all six other -actual.md pages, plus docs/journeys/README.md:56.`

**Verified:** The journey generator's own rule says never to guess a gate and never to call an open route protected "in the dangerous direction" (scripts/journeys/extract.mjs:19-22, :326-331), yet its detector at extract.mjs:363 fires on nothing more than the word "rawBody" plus "provider"/"adapter" appearing in an import path — so every journey page on main tells the owner that /api/public/funnel-checkout, /api/public/survey-submit, /api/public/education-enroll and /api/public/optimize are signature-checked ("Anyone can call these, but a caller without the right signature is refused", render.mjs:262, rend…

### 8. Journey pages overstate who can reach three staff endpoints, because the generator only recognises a role list whose name ends in ROLES  `high`

**What you see:** The role pages say a closer, a setter, a sales manager and a funding advisor can all reach the repair-exceptions desk, the social media connect screen, and the owner-only switch that turns the partner marketing suite on. They cannot — the code refuses every one of them. So if you use these pages to answer "who can touch what", they hand you the wrong answer, in the direction that makes your permissions look sloppier than they are. The whole cause is a naming accident: the generator looks for a list called something-ROLES, and these three files call theirs ALLOWED and STAFF_OK.

**The rule:** `scripts/journeys/extract.mjs:19-22; docs/journeys/README.md:55; /Users/zootimusmaximus/fundhub-platform/CLAUDE.md §4 "Rules"` — ""WHAT IT WILL NOT DO. When a handler's gate does not match a known shape, this returns kind \"unverified\" with the reason. It never guesses, never falls back to \"probably staff\", and never omits the route to keep the picture tidy." And in the generated index: "**0 routes have gates that could not be traced.** Every…"

**The code:** `Cause: scripts/journeys/extract.mjs:298 — `/const\s+(\w*ROLES)\s*=\s*new Set\(\[([^\]]*)\]\)/`. Real gates it cannot see: api/repair/exceptions.mjs:10 `const ALLOWED = new Set(["owner","admin","inquiry_specialist",...SUPER_ROLES])` refusing with `role_forbidden` at :23-24; api/social/oauth.mjs:15 `const STAFF_OK = new Set(["owner","admin","partner"])` refusing at :45-48; api/partner-marketing/enable.mjs:44 `if (!isOwner(principal))` and api/social/settings.mjs:172 same. Wrong rows, all inside the "What they can reach" table (docs/journeys/role-closer-actual.md:69 starts it, :233 ends it): role-closer-actual.md:208 `/api/repair/exceptions | GET, POST | staff`, :215 `/api/social/oauth | — | staff`, :147 `/api/partner-marketing/enable | GET, POST | staff, partner`. Same rows in role-sales-manager-actual.md:225, role-funding-advisor-actual.md:215, role-inquiry-remover-actual.md:206, white-label-actual.md:105.`

**Verified:** The journey generator promises in its own header that it "never falls back to 'probably staff'", but scripts/journeys/extract.mjs:298 only recognises an in-file role list whose name ends in ROLES — so the eight handlers that call theirs ALLOWED, STAFF_OK, isOwner() or canAccessPartnerMarketing() are published as plain "staff" with the reason "no role limit", and the closer, setter, sales manager and funding advisor pages all list the repair-exceptions desk, the social connect screen and the whole five-route partner marketing suite under "What they can reach" when the code returns 403 to every…

### 9. The browser check that blocks every merge secretly drives the real fundhub.ai site  `high`

**What you see:** There are meant to be two kinds of browser test: fake ones that run on a copy of the site on the test machine, and real ones that touch the live site. The rule says the merge check only runs the fake ones. It does not. Six files that log in to the real fundhub.ai got mixed into the fake pile. Two things follow. On GitHub the check has no password for the live site, so those tests die and the check goes red - and even if it did not, one of them waits up to 18 minutes for a rate limit while the whole job is capped at 15, so the job gets killed anyway. That is a red merge light nobody can fix by fixing code. And on a laptop, where the password is sitting in the .env file, typing the ordinary t…

**The rule:** `playwright.config.mjs:22-32 (also playwright.live.config.mjs:1-2 and :65)` — ""NO DOWNLOAD, NO NETWORK. Chromium is already on the machine and PLAYWRIGHT_BROWSERS_PATH points at it." ... "NO BACKEND. A forty-line static server hands over public/ (see e2e/static-server.mjs for why file:// does not work), and each spec answers /api/** itself with page.route(). That is deliberate rather than a sho…"

**The code:** `playwright.config.mjs:110-111 — `testDir: "./e2e"` with `testIgnore: ["**/launch-proof-live.spec.mjs"]` and NO testMatch, so the default run also collects e2e/live-run4-pass.spec.mjs, e2e/live-hole10.spec.mjs, e2e/live-affiliate-onboard.spec.mjs, e2e/live-white-label-onboard.spec.mjs, e2e/live-company-brain-chat.spec.mjs and e2e/live-hole17-inquiry-upload.spec.mjs. Those specs point at https://fundhub.ai via e2e/live-auth.mjs:5 and sign in as chris@fundhub.ai / owner@fundhub.ai / admin@fundhub.ai / partner@fundhub.ai (e2e/live-run4-pass.spec.mjs:10-21, e2e/live-white-label-onboard.spec.mjs:13-16). Verified by running the real collector: `npx playwright test --list` returns 454 tests in 44 files, 40 of them from those six live files. That command is what CI runs in the job the workflow calls blocking (.github/workflows/tests.yml:149 "IT BLOCKS", :182 `run: npm run test:e2e`).`

**Verified:** The everyday browser-test command is supposed to run only fake tests against a copy of the site on the machine — its own header says "NO DOWNLOAD, NO NETWORK" and "NO BACKEND ... a browser test never needs a database, never needs a session" (playwright.config.mjs:22-32) — but because playwright.config.mjs:111 blocks one live test file by name and forgets the other six, `npm run test:e2e` actually collects 40 tests that open the real fundhub.ai and try to sign in as Chris, owner, admin and partner; on GitHub that merge check (.github/workflows/tests.yml:149 "IT BLOCKS", :182) has no password f…

### 10. A leftover debugging beacon is live in production, and the guard that promises this is impossible cannot see it  `high`

**What you see:** Nothing on the screen, which is the problem. Somebody was debugging the Connect-a-social-account button, left the debugging line in, and it shipped. Every time a staff member clicks Connect, the server tries to phone a note home to a listener on the machine that was doing the debugging - including a list of which of your secret keys are filled in. On the live server nothing is listening, so it silently fails and no one notices. Meanwhile the automatic check that is supposed to make this exact thing impossible reports all clear, because it only looks for the word "await" in front of the call, and this one does not have it.

**The rule:** `src/lib/no-unfenced-transmit.test.mjs:1-21 and :33-43` — ""STRUCTURAL PROOF: nothing can reach the network except through the fence." ... "this test does not exercise behaviour. It reads the source tree and asserts that every module capable of an outbound call either routes through src/lib/outbound-fetch.mjs or is named on a list below with a written reason. A new file that …"

**The code:** `api/social/oauth.mjs:110-132 — a `// #region agent log` block that calls `fetch("http://127.0.0.1:7854/ingest/d6f5d062-daec-4ccb-b29c-871a05f553ca", {...}).catch(() => {})` and posts which API keys are set (hasMetaAppId, hasMetaAppSecret, hasLinkedInClientId). The file is not on ALLOWED_RAW_FETCH (no-unfenced-transmit.test.mjs:54-152) and never imports the chokepoint. It slips through because every token in the list needs the word `await` in front (`/\bawait\s+fetch\s*\(/`, :38) or a call named fetchImpl/fetchFn/doFetch/ctx.fetch — and this call is a bare, un-awaited `fetch(`. The only other `fetchImpl` mention in the file is `const fetchImpl = deps.fetchImpl;` (:37), which is not a call, so the whole file reads as "cannot reach the network".`

**Verified:** A leftover debugging beacon at api/social/oauth.mjs:110-132 fires on every live "Connect a social account" click, POSTing to a developer's laptop (http://127.0.0.1:7854) a report of which secret keys are configured — and the guard at src/lib/no-unfenced-transmit.test.mjs:1 that promises "nothing can reach the network except through the fence" passes 5/5 green because its detector at :38 only matches `await fetch(`, and this call is a bare un-awaited `fetch(`.

### 11. Two screens print the word "Fundhub" where the standard says the brand logo goes  `high`

**What you see:** On Pipeline and the Closer Dashboard, the top-left corner is the word "Fundhub" typed in bold letters. On the Client Control Panel and the Specialist screen it is the real Fundhub logo picture. Same app, two different-looking top bars. Worse: when a white-label partner signs in, every other screen swaps in their logo, but those two screens still say "Fundhub" in writing. The partner sees our name on their own staff screens.

**The rule:** `docs/UI-STANDARDS.md:219-221` — "docs/UI-STANDARDS.md §12.8: "Read `client-control-panel.html:64-84`. A topbar carries, left to right: 1. **Identity** — the wordmark from `--logo` (`.brand .logo`, `.inv` to flip it on the dark bar), then a separator, then this screen's name in `.brand .sub`.""

**The code:** `public/app/pipeline.html:667 and public/app/closer-dashboard.html:525 — both `<div class="name">Fundhub</div>`, typed text. The two screens that obey are client-control-panel.html:761 and inquiry-remover.html:459, both `<div class="logo inv">`. The logo image comes from fundhub-brand.css:26 `.logo{background:var(--logo)}`, and shell.js:2422 replaces `--logo` with the partner's own wordmark for a white-label company.`

**Verified:** The standard says the top bar must start with the Fundhub logo picture, but seven screens type the word "Fundhub" in bold letters instead (pipeline.html:667, closer-dashboard.html:525, calendar.html:446, messaging.html:429, galaxy.html:340, lenders.html:134, partner-galaxy.html:389) — so the owner's own home screen has a different-looking top-left corner from the Client Control Panel, and worse, a white-label partner's home screen shows their logo in the sidebar and our name written out in the bar right above it, because the code that swaps in a partner's logo only changes pictures and cannot…

### 12. On Social Studio a post that failed and an account whose sign-in has died both paint peach, and the same screen paints that same dead account coral one panel over  `medium`

**What you see:** "Could not be sent" — a post the system tried three times and gave up on — is yellow on Social Studio, but the identical outcome is red on Documents, Creative Factory, Hiring and Campaign Manager. Worse, on Social Studio itself an account whose sign-in has run out shows a yellow badge in the Accounts panel and a red warning in the post's pre-flight check, on the same page, about the same account. He cannot learn one colour and carry it from screen to screen.

**The rule:** `public/app/fundhub-brand.css:17-18` — "--warn:#F5CE8F; /* peach - in progress, behind, warning */ --alert:#F2A69B; /* coral - blocked, failed, alert */"

**The code:** `public/app/social-studio.html:859 (`failed:'b-warn'`) and :866 (`expired:'b-warn'`), rendered at :1280 and legended at :605. The same file paints a non-active connection coral at :1157 (`cls:'b-alert'`). Every other screen paints the same states coral: documents.html:273/:275, creative-factory.html:964, hiring.html:1432, campaign-manager.html:687 and :692.`

**Verified:** fundhub-brand.css:18 states coral means "blocked, failed, alert" and :17 states peach means "in progress, behind, warning", but social-studio.html:859 maps `failed` to peach (`b-warn`) and :866 maps `expired` to peach too — so the owner sees a post the system permanently gave up on labelled "Could not be sent" in calm peach in the always-on legend (:605) and its own tab (:581), sees an expired account painted peach in the Accounts panel (:1280) while the very same account is painted alarm coral one panel over at :1157 beneath text reading "The post waits, it has not failed", and sees those id…

### 13. Affiliate terms promise last-touch attribution with a 60-day window; the system is first-touch, forever  `medium`

**What you see:** Two partners refer the same person. The screen tells both of them that whoever's link was clicked last inside 60 days gets paid. The system pays the one who was clicked first, permanently, and never re-checks. The partner who was told he would win, and lost, is reading a promise the platform never made good on — in writing, on our own screen.

**The rule:** `src/affiliates/economics.mjs:9-15 (the index it names is db/migrations/033_affiliates.sql:375-376; the write is economics.mjs:74-80)` — ""1. FIRST TOUCH IS IMMUTABLE. Enforced by the database, not here: the unique index affiliate_referrals_client_tier_uniq means one direct owner and one downline owner per client, forever, and every write uses ON CONFLICT DO NOTHING. That single statement is both replay-idempotent and incapable of stealing an existing a…"

**The code:** `public/app/affiliate.html:420 — "Attribution window: 60 days from first click. Last-touch: if another affiliate's link is clicked after yours inside the window, the later click takes the commission." No 60-day window and no last-touch override exists anywhere in src/, db/ or api/.`

**Verified:** On one screen the affiliate portal states both answers about who gets paid: the tile at public/app/affiliate.html:232 says "First touch · credited on the first visit · no expiry is recorded", while the Terms tab 188 lines below at public/app/affiliate.html:420 promises "60 days from first click. Last-touch: if another affiliate's link is clicked after yours inside the window, the later click takes the commission" — and the second one is a promise the platform cannot keep, because src/affiliates/economics.mjs:9-15 states first touch is immutable and db/migrations/033_affiliates.sql:375 plus th…

### 14. Times on staff screens are drawn in the viewer's own clock while the topbar beside them claims Arizona  `medium`

**What you see:** A closer whose laptop is not set to Arizona sees his next appointment card say "5:00 PM" while the clock in the same top bar says 2:00 PM MST. Same screen, same booking, three hours apart, with nothing saying which one to trust. Anyone on the team outside Arizona is reading a schedule that disagrees with the company clock printed next to it.

**The rule:** `src/http/crm-html.test.mjs:337-350; public/app/shell.js:1888-1892` — ""ARIZONA TIME (owner-set 2026-08-28) — The CRM ran on America/New_York everywhere. Arizona is where the work happens, so every clock, every timestamp and the quiet-hours window moved to America/Phoenix." The test beneath it is named: "every clock and timestamp on a staff screen is Arizona — no exceptions". shell.js re…"

**The code:** `public/app/closer-call.js:47 and :52 and :379; public/app/sales-floor.js:382; public/app/client-control-panel.html:2672 and :2971; public/app/present.js:665 — all use toLocaleTimeString([]), which is the viewer's own machine zone. The guard misses them: it only looks for an explicit timeZone: "..." string (crm-html.test.mjs:369-371), and it only scans .html files plus shell.js and data.js (:361), so closer-call.js, sales-floor.js and present.js are never read at all.`

**Verified:** On the Closer Dashboard the topbar clock is hard-coded to Arizona (closer-dashboard.html:1291, timeZone: "America/Phoenix") while the appointment times printed inches away are drawn in whatever zone the viewer's own laptop is set to (closer-call.js:47, :52, :379 use toLocaleTimeString([]) with no zone), so a closer outside Arizona reads "5:00 PM" for his next call beside a company clock reading 2:00 PM MST - and the guard that is supposed to stop this (src/http/crm-html.test.mjs:350) never opens closer-call.js, sales-floor.js or present.js because it only scans .html files plus shell.js and d…

### 15. The Journeys simulator reports "Messages sent 4 · Everything went to <your phone>" while sending nothing anywhere  `medium`

**What you see:** You open a journey, go to Simulate, type your own mobile number into "Texts go to", press "Run the journey", and watch texts and emails appear in the feed. When it finishes the report says "Messages sent: 4" and "Everything went to: +1 (480) 555-0142". Nothing was sent to that number or that inbox — not one message left the browser. You will sit waiting for a test text that is never coming, and conclude the texting is broken when the journey itself may be fine. The two address boxes do nothing at all except get echoed back to you.

**The rule:** `public/app/journeys.html:1055-1056 (the banner at the top of the Simulate tab, above the "Texts go to" and "Emails go to" boxes)` — "Test mode. Everything goes to the two destinations below and nowhere else. A simulated run can never reach a real client record."

**The code:** `public/app/journeys.html:830-885 (startSim: the whole run is a setTimeout loop that pushes strings into the local `sim.feed` array — there is no fetch, no POST, no provider call anywhere in it) and :1081-1083 (the run report prints "Messages sent" = sim.report.messages and "Everything went to" = the phone number you typed)`

**Verified:** The Journeys Simulate tab shows a green "Test mode" banner promising "Everything goes to the two destinations below and nowhere else" (public/app/journeys.html:1055-1056) and finishes with "Messages sent: 4 / Everything went to: +1 (480) 555-0142" (:1081-1083), but startSim (:830-885) contains no network call of any kind — it only pushes strings into a local array (:862, :864) — so the two address boxes, pre-filled with the owner's own phone and his real chris@fundhub.ai inbox (:612), are decorative: Chris presses Run, watches four texts and emails appear, then waits for a test message that w…

### 16. The Documents screen states in capitals that age counts from the last state change; it counts from the day the document was generated  `medium`

**What you see:** The Documents screen has a column called "Age pending" and a red chip at the top saying how many documents are past 14 days. The legend promises the clock starts when the document last changed state. It does not — it starts the day the document was first generated. So a contract that was made in June and only sent to the client yesterday shows as "78d" and gets flagged red as stale, when in truth it has been waiting one day. Anything that sat in a drawer before it went out looks urgent, and the genuinely stuck paperwork is buried among false alarms.

**The rule:** `public/app/documents.html:239 (the legend under the table; restated at :269 as "age: days in the current pending state (0 when nothing is pending)")` — "AGE COUNTS FROM THE LAST STATE CHANGE, NOT FROM CREATION"

**The code:** `public/app/documents.html:730 (`var born = new Date(r.generated_at || r.created_at || Date.now());`) and :747 (`age: Math.max(0, Math.floor((Date.now() - born.getTime()) / DAY))`) — no state-change timestamp is read at all; the same number drives the "Age pending" column at :386, the red stale row at :379, and the "N past 14 days" chip at :401-403`

**Verified:** The Documents screen prints "AGE COUNTS FROM THE LAST STATE CHANGE, NOT FROM CREATION" under the table (public/app/documents.html:239) but computes age from the generation date (:730, :747) while ignoring the delivered_at and signed_at timestamps its own endpoint already returns (api/read/documents.mjs), so a contract written in June and sent to the client yesterday shows "78d", turns red as stale (:379, :386), and inflates the "N past 14 days" alarm chip (:401-403) — burying the genuinely stuck paperwork among false alarms.

### 17. The contract signing page tells the signer they can come back to the link "at any time"; the link stops working 30 days after it was sent  `medium`

**What you see:** A client signs their funding agreement and the page tells them: this is your copy, come back and read it any time. Thirty days after we sent it, the same link is dead and the page says it has expired. The client has no copy of what they signed unless they pressed "Download a copy" in that one session — and that button silently does nothing if the download call fails, with no message. Expect calls asking for a copy of an agreement we told them they already had.

**The rule:** `public/contract.html:146 (the note in the panel shown after a client signs)` — "This page is your copy. You can come back to this link and read it again at any time."

**The code:** `src/contracts/signed-link.mjs:39 (`export const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;  // 30 days`), applied to every non-employment contract by src/contracts/send.mjs:313 and :577; after that the link returns 410 and public/contract.html:495 shows "This link has expired. Please ask for a new one — nothing has been lost."`

**Verified:** public/contract.html:146 tells a client the moment they sign "This page is your copy. You can come back to this link and read it again at any time", but the link carries a 30-day expiry counted from the day it was SENT (src/contracts/signed-link.mjs:39, applied by src/contracts/send.mjs:577 and never re-issued to a signer who has already signed), so from day 31 that exact bookmarked URL answers 410 (api/contracts/sign.mjs:109) and the same page reads "This link has expired. Please ask for a new one" — the copy of the agreement does still exist in the client's portal documents, so the fix is e…

### 18. A client's portal Messages tab always says "No messages yet", because the painter only runs for staff  `medium`

**What you see:** A client opens Account & history and the Messages tab reads "No messages yet." It reads that for everybody, always — including the client we emailed a sign-in link, a booking confirmation and an invoice chase. Their portal tells them we have never contacted them. The page's own rule, written a few hundred lines further down for the Activity tab, says a sentence like that must never be left standing when nothing was actually read.

**The rule:** `public/app/client-portal.html:2717-2719 (the rule this file states for its own tabs; expanded at :2636-2643 — "That sentence is a STATEMENT ABOUT THE FILE, and a read that never answered proves nothing about the file. A client with a year of history would have been told nothing had happened.")` — "THE READ DID NOT ANSWER. Say that, and only that. This must never leave "No activity recorded on this file yet." on screen, because that sentence claims something about the file that a failed read cannot know."

**The code:** `public/app/client-portal.html:881 (shipped markup: "No messages yet.") with :2243 and :2251 — paintMessages(res.data.messages) sits inside `if (STAFF_ROLES[roleHint()])`, and a client's role is never in STAFF_ROLES (defined at :1430-1433), so no read is ever made and the shipped sentence stands forever`

**Verified:** A signed-in client's Messages tab in the portal is never painted — paintMessages() is only ever reached inside `if (STAFF_ROLES[roleHint()])` (public/app/client-portal.html:2243, :2250), and a client's role is never in STAFF_ROLES (:1430-1433) — so the hardcoded sentence "No messages yet." (:881) stands forever, telling a client we have never contacted them even after we emailed them a sign-in link, a booking confirmation and an invoice chase; the file's own rule at :2717-2719 says a sentence that makes a claim about the file must never be left standing when nothing was actually read. (Two co…

### 19. The Decline Autopsy journey draws three live routes; all three are commented out of the router and 404  `medium`

**What you see:** You shelved this $27 offer on 2026-08-31 and the router was correctly switched off. But the journey page was never touched, so it still reads as a shipped, working product with ten small gaps. Anyone reading it — you, or an agent picking up the work — concludes the back end is done and only the web pages are missing. In fact all three addresses answer "not found". The safety test written specifically to catch this is switched off in the normal test run, so nothing tells you.

**The rule:** `docs/journeys/decline-autopsy-actual.md:87-101 and :180-181` — "The page states, as fact: "`netlify/functions/api.mjs` maps three **flat** keys", then tables `public/decline-autopsy`, `public/decline-autopsy-upload` and `public/decline-autopsy-report` against their handlers, then: "`src/http/decline-autopsy.pg.test.mjs` calls the adapter, not the handlers, so a missing map entry f…"

**The code:** `netlify/functions/api.mjs:700-709 — the three ROUTES entries sit inside a block comment ("DECLINE AUTOPSY — SHELVED BY THE OWNER 2026-08-31. Routes deliberately removed so the offer cannot go live on the next deploy."), and src/http/routes.test.mjs:79-81 adds all three to the unrouted allow-list. The test the page cites, src/http/decline-autopsy.pg.test.mjs:92-95, asserts "all three routes are reachable through the real ROUTES map" and is skipped whenever DATABASE_URL is unset (:33).`

**Verified:** The Decline Autopsy journey page still says, as present-tense fact, that the router maps its three routes (docs/journeys/decline-autopsy-actual.md:89 and the table at :94-98) and that a missing map entry would fail a test rather than ship a 404 (:100-101) — but the owner shelved the offer ten hours after that page was written and the three entries have sat inside a block comment ever since (netlify/functions/api.mjs:700-709, allow-listed as unrouted at src/http/routes.test.mjs:71-82), so all three addresses answer "not found"; the spec next door got a "SHELVED — DO NOT BUILD" banner (docs/spe…

### 20. Two signed, expiring links are printed on every journey page as "genuinely open" and lumped in with the login and health-check routes  `medium`

**What you see:** This one errs the other way. Your contract-signing link and your email unsubscribe link are both properly protected — the link itself is the key, it expires, and a forged one is rejected. But every journey page lists them under "17 routes are genuinely open ... reachable by anyone" and then adds "These are the sign-in routes and the health check." Read plainly, that says anyone on the internet can open and sign one of your contracts. They cannot. If you or an auditor read these pages, you would go hunting for a hole that does not exist.

**The rule:** `scripts/journeys/render.mjs:252-255 (the comment) and :246-249 (the printed line)` — ""Counted separately from \"open\" deliberately. These need no sign-in and are NOT open: a signed link, a provider signature, Inngest's own request signing. Listing them as open would be a false claim in the direction that causes harm — a reader would either panic or believe it." The sentence actually printed (render.m…"

**The code:** `Cause: scripts/journeys/extract.mjs:332 matches only `verifyDocumentUrl|signed-url`, and :351 only `verify…Token(`. api/contracts/sign.mjs:46 imports `verifyContractUrl` from src/contracts/signed-link.mjs (constant-time signature, expiry, fail-closed with no secret — see its header at :21-25); api/public/unsubscribe.mjs:54 calls `verifyUnsubscribeRequest`, which checks `sig` and `exp` at src/messaging/unsubscribe.mjs:182-184. Neither name matches, so both fall through to extract.mjs:386 "no session gate in this handler". Wrong rows: docs/journeys/client-actual.md:84 and :116; docs/journeys/role-owner-actual.md:116 and :290; the same two lines in all six other -actual.md pages and docs/journeys/README.md:55.`

**Verified:** The journey generator states out loud at scripts/journeys/render.mjs:252-255 that a signed, expiring link must never be listed as "open" because "Listing them as open would be a false claim in the direction that causes harm — a reader would either panic or believe it", yet its own detector at extract.mjs:332 and :351 recognises a signed link only by the names verifyDocumentUrl/signed-url or verify…Token(, so /api/contracts/sign (gated by verifyContractUrl, api/contracts/sign.mjs:90-93) and /api/public/unsubscribe (gated by verifyUnsubscribeRequest, api/public/unsubscribe.mjs:54-61) both drop …

### 21. The screen-frame guard misses the short way of writing a text size, so the pipeline drawer buttons are the wrong size on its own reference screen  `medium`

**What you see:** Open a card in the Pipeline drawer and the two small buttons at the top, Close and Archive, are drawn at full body text size instead of the small size they were written for, so they look oversized next to the same buttons elsewhere. The check that exists to catch exactly this says the screen is clean, because it only looks for text written the long way and these are written the short way - and the check's own error message admits the short way has the same problem.

**The rule:** `src/ui/screen-standard.test.mjs:86 and :127-128` — "Test name: "no screen writes a px font-size that the brand file will throw away". Its own failure message ends: "The same trap eats the `font:` shorthand (`font:600 11px var(--sans)`) and inline style=\"font-size:12px\" in the markup.""

**The code:** `src/ui/screen-standard.test.mjs:96 — the scan is `block.matchAll(/font-size\s*:\s*([^;}]*)/gi)`, which only ever matches the long form `font-size:`. The shorthand it names two lines later is never searched for. Live consequence at public/app/pipeline.html:300 — `.fh-drawer-x,.fh-drawer-del{...font:600 11px var(--sans);...}` (and the same shape at :311). Those two classes are the Close and Archive buttons at pipeline.html:862-863, which sit inside `<div class="app">` (opens :596, closes :950), so public/app/fundhub-brand.css:184-185 `:is(.app, .app-shell, .shell, .main, .fh-maxw) *{ font-size:inherit !important; }` throws the 11px away. pipeline.html is the screen this same test file pins as the standard's reference (screen-standard.test.mjs:271: "pipeline.html is the §12 reference and must be in scope").`

**Verified:** The §12 type-size guard only searches for the long form `font-size:`, so it passes green on pipeline.html — the very screen it names as the standard's reference — while that screen's Close and Archive buttons (pipeline.html:300, and the drawer's link buttons at :311) are written `font:600 11px var(--sans)`, the exact shorthand docs/UI-STANDARDS.md:213 and the guard's own failure message at screen-standard.test.mjs:127-128 both say the brand file throws away; sitting inside `<div class="app">` (:596-:950), fundhub-brand.css:185 `font-size:inherit !important` discards the 11px and the owner see…

### 22. The guard against a test permanently repointing live message routing excuses the offence using the offence itself  `medium`

**What you see:** Someone once ran a test that switched real message sending over to a fake, do-nothing sender and never switched it back, so real texts and emails stopped going out. This guard was written to stop that happening again. It does not. The way it checks for "did they put it back" matches the very line that broke it, as long as the line is written in the ordinary style everyone here uses. So the guard is green whether or not anyone puts the routing back, and the way you would find out is clients not getting messages.

**The rule:** `src/messaging/routing-restore.guard.test.mjs:1-3 and :66` — ""Guard: a test must not leave message_channel_routing pointing at `memory` on a real (non-test) org — and must not UPDATE shared routing without a teardown that puts it back." Test name: "no test UPDATEs message_channel_routing without restoring it"."

**The code:** `src/messaging/routing-restore.guard.test.mjs:81 vs :84 — the offence is `/UPDATE\s+message_channel_routing\s+SET\s+provider/i` and the very first thing that counts as a restore is `/UPDATE\s+message_channel_routing\s+SET\s+provider\s*=\s*\$/i`. The restore pattern is the offence pattern plus a `$`, so any file that writes the statement the normal, parameterised way — `UPDATE message_channel_routing SET provider = $2 WHERE org_id = $1` — is flagged on line 81 and instantly forgiven on line 84 by that same line of SQL. Only the hardcoded-literal form (`SET provider = 'memory'`) can ever be reported. A second escape sits alongside it: the offence regex requires `provider` to be the FIRST column after SET, so `SET enabled = false, provider = 'memory'` is not seen at all.`

**Verified:** src/messaging/routing-restore.guard.test.mjs:84 accepts `UPDATE message_channel_routing SET provider = $` as proof that routing was put back, but that is the same statement line 81 flags as the offence — so one line of ordinary parameterised SQL is simultaneously the crime and its own alibi, and a test that repoints shared message routing and never restores it keeps the guard green; the runtime backstop at :104/:140 cannot close the gap because the guard is a plain .test.mjs and scripts/run-suite.mjs:81 runs it, and the whole unit phase, before any of the 182 .pg.test.mjs files at :86, so it …

### 23. CLAUDE.md still says outbound calls may only live in the messaging providers folder, but the enforced design puts them all in src/lib/  `medium`

**What you see:** Nothing on screen. This is the instruction file that every agent reads before it touches anything, and on this point it tells them the opposite of what the code enforces. An agent following the written rule would add a brand-new sending path inside the messaging providers folder instead of routing it through the single gate everything else goes through — which is how you end up with a fourth place that can text a client with nobody watching it.

**The rule:** `CLAUDE.md:367` — ""**Outbound transmission is permitted in `src/messaging/providers/*` and nowhere else.** That directory is the only place new outbound `fetch` may be added. `src/lib/`, `src/handlers/` and `src/mail/` contain none, and none may be added to them.""

**The code:** `src/lib/outbound-fetch.mjs:1-3 — "THE CHOKEPOINT. Every outbound call that can have an effect on a real client or a real vendor account goes through transmit(), and transmit() is the only function in this repository permitted to hold a live `fetch` for that purpose." That file is in src/lib/, which CLAUDE.md says contains none. And src/lib/no-unfenced-transmit.test.mjs:221-235 fails the build for any module that transmits WITHOUT routing through src/lib/outbound-fetch.mjs — the opposite instruction from the one CLAUDE.md gives.`

**Verified:** CLAUDE.md:367 still tells every agent that outbound sending belongs in src/messaging/providers/ "and nowhere else" and that src/lib/ and src/handlers/ "contain none" — but since 2026-08-07 the single live fetch in the whole repo has been src/lib/outbound-fetch.mjs:188-204, src/handlers/inbound-mms-docs.mjs:225 holds a second one, the providers folder holds zero, and src/lib/no-unfenced-transmit.test.mjs:221-234 fails the build on anything that does NOT route through src/lib/ — so the instruction file states the opposite of what the build enforces, and line 369 compounds it by naming src/adapt…

### 24. Pipeline shows a "— held" figure that can never be a number  `medium`

**What you see:** On every board, in the summary row next to "12 cards" and "$450,000 funding est.", there is a bold "— held". It will never show a number, because the system that feeds the board does not send hold information at all. He has to hover it to find out. The same screen already hides the money figure when it is meaningless — this one was missed.

**The rule:** `docs/UI-STANDARDS.md:40 and :54 (the screen's own restatement: public/app/pipeline.html:760-761)` — "docs/UI-STANDARDS.md §5: "**Every visible control works.** No buttons wired to nothing, no controls the role lacks permission for, no 'coming soon' UI in production. If it doesn't do anything today, it does not render today." And §7: "**Data-ink (Tufte):** … If deleting a pixel loses no information, delete it." The sc…"

**The code:** `public/app/pipeline.html:728 renders `<span class="held-n" id="sumHeld" title="the pipeline API does not return hold status">— held</span>`. pipeline.html:1701-1705 states outright "the board-summary's 'held' stat stays a dash always", and setSummary() at :1709-1716 never writes to it. Two lines away, :1715 HIDES the money figure for exactly this reason (`sumMoneyWrap.hidden = !railHasMoney()`), and the Owner filter at :763 is hidden and the Hold filter deleted at :764-770, both citing §5.`

**Verified:** On the Pipeline board — the owner's and admin's landing screen — the summary row prints a bold "— held" beside the card count and funding estimate that can never become a number, because /api/dashboard/pipeline returns no hold field at all; the screen's own comment says it "stays a dash always" (public/app/pipeline.html:1703) and a test at src/http/pipeline-screen.test.mjs:328 now requires the markup to stay, even though docs/UI-STANDARDS.md:40 states "no 'coming soon' UI in production. If it doesn't do anything today, it does not render today" — the rule this same file cited when it hid the …

### 25. The sales presentation deck sets seven text sizes below the standard's floor, including the legal small print  `medium`

**What you see:** On the deck a closer shares live with a client, the big pre-approval dollar number can be 64px tall and the legal line under it ("Not a guarantee of approval, amounts, rates, or terms") is 9.5px — about a seventh the size, and below the standard's own readable floor. The "sent at" confirmation line the closer relies on to know a text actually went out is the same 9.5px. On a phone all of it is close to unreadable.

**The rule:** `docs/UI-STANDARDS.md:87` — "docs/UI-STANDARDS.md §11 (PHONE, 390px): "**Hit targets stay 40px+.** Text stays at least 11px.""

**The code:** `public/app/present.html:28 (.mono 9.5px), :29 (.btn-ghost 9.5px), :48 (.fine 9.5px), :81 (.prog .nm 9.5px), :99 (.sent-at 9.5px), :104 (.toast 10.5px), :106 (.fin 9.5px); plus clamp floors at :60 (10.5px) and :71 (9.5px). These really paint: the brand file's size override only reaches `.app/.app-shell/.shell/.main/.fh-maxw` (fundhub-brand.css:181-186) and this page's root is `<div id="app">` at present.html:110. The `.fine` class carries the disclaimers — present.js:556 "Projection based on your current file. Not a guarantee of approval, amounts, rates, or terms.", :575, and :605 — printed under a headline that grows to 64px (present.js:497).`

**Verified:** docs/UI-STANDARDS.md:87 sets a floor — "Text stays at least 11px" — for a phone section that names Present in scope at line 85, yet public/app/present.html sets nine text sizes below it (9.5px at :28, :29, :48, :81, :99, :106; 10.5px at :104; clamp floors of 10.5px at :60 and 9.5px at :71), and these genuinely paint because the brand file's size override reaches only `.app/.app-shell/.shell/.main/.fh-maxw` (fundhub-brand.css:184-186) while this page roots on `<div id="app">` (present.html:110) — a carve-out fundhub-brand.css:169 states on purpose — so on the deck a closer shares live, present…

### 26. Pipeline and Specialist top bars are missing all three rules that stop them overflowing  `medium`

**What you see:** On Pipeline and Specialist, once the app finishes loading there are eight things crammed into the top bar (logo, screen name, clock, LIVE pill, search, role chip, sign out). Because the screen name cannot shrink or cut itself off with a "…", it pushes everything to its right toward the edge of the window. This is the exact fault that was measured and fixed on the Client Control Panel at 1440px last month; these two screens never got the fix.

**The rule:** `docs/UI-STANDARDS.md:227-229` — "docs/UI-STANDARDS.md §12.8: "- `.brand{min-width:0;flex:0 1 auto}` — the left side is allowed to shrink. - `.brand .sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}` — the screen name truncates instead of wrapping onto three lines. Measured on the live page at 1440px, 2026-08-27. - `.topbar-right{flex:0 …"

**The code:** `public/app/pipeline.html:46 `.brand{display:flex;align-items:center;gap:9px;}` (no min-width, no flex), :49 `.brand .sub{font-weight:600;font-size:var(--fs-body);color:var(--dark-text-dim);}` (no ellipsis), :50 `.topbar-right{...}` (no flex:0 0 auto). Identical omissions at inquiry-remover.html:64, :69, :70. The two screens that carry all three are client-control-panel.html:72, :77, :78 and closer-dashboard.html:76, :79, :80.`

**Verified:** Pipeline (pipeline.html:46,49,50) and Specialist (inquiry-remover.html:64,69,70) are missing the two load-bearing declarations UI-STANDARDS.md:227-228 requires — `.brand{min-width:0}` and an ellipsis on `.brand .sub` — plus `.topbar-right{flex:0 0 auto}` at :229, so the screen name can neither shrink nor cut itself off with a "…" while shell.js keeps stuffing Search, the account chip and Sign out into the same bar (shell.js:1698, 2249, 1822) and forces the clock back on above 1100px (shell.js:1961-1968) over pipeline's own 1600px hide; it is the exact fault measured and fixed on Client Contro…

### 27. A caption tells the owner to read a colour, which the standards file forbids in copy  `low`

**What you see:** Under the "Today's spend vs ceilings" table the note reads "Green means our own copy looks fine — only breached checks the ad platform itself." It sends him hunting for a colour instead of naming the badge, and the badge it means actually says the word "ok" (campaign-manager.html:798). Green also appears on that screen in the Disclosure, Can launch and Blockers columns meaning entirely different things, so "green means" points at four things at once.

**The rule:** `docs/UI-STANDARDS.md:160` — "Never ship a legend whose only key is colour, and never write "the red ones need attention" in copy."

**The code:** `public/app/campaign-manager.html:386`

**Verified:** The standards file bans naming a colour in copy (docs/UI-STANDARDS.md:160), yet the note under "Today's spend vs ceilings" tells the owner "Green means our own copy looks fine" (public/app/campaign-manager.html:386) — so he has to hunt for a colour instead of reading the badge, which already says the word "ok" (:798), and the same green stands for three other unrelated things on that one screen: "linked" under Disclosure (:982), "yes" under Can launch (:1101) and "none" under Blockers (:1087).

### 28. The client portal writes its own card shadow instead of using the shared one  `low`

**What you see:** The cards on the customer's own portal sit visibly flatter against the page than the identical-looking cards on every staff screen. It is the one screen a paying client actually looks at, and it is the one screen not covered by the automatic check.

**The rule:** `docs/UI-STANDARDS.md:116` — "docs/UI-STANDARDS.md §12.2: "**A new container takes one of those class names, or gets added to that list. It never hand-rolls a shadow value.** Two screens carrying two slightly different shadows is the drift this whole section exists to stop, and it is invisible in review — nobody compares `0 2px 8px rgba(10,10,10,.…"

**The code:** `public/app/client-portal.html:86 `.card{...box-shadow:0 1px 2px rgba(0,0,0,.02)}` against the shared value at fundhub-brand.css:121 `--panel-shadow:0 1px 2px rgba(10,10,10,.04), 0 2px 8px rgba(10,10,10,.06)`. Twenty cards on the page use it. The check that would catch this, src/ui/screen-standard.test.mjs:48-53, only looks at screens that load crm-sidebar.css, and client-portal.html does not load it.`

**Verified:** The client portal writes its own near-invisible card shadow (public/app/client-portal.html:86, `box-shadow:0 1px 2px rgba(0,0,0,.02)`) in direct breach of docs/UI-STANDARDS.md:116 — "It never hand-rolls a shadow value" — and because the screen has no `.app`/`.app-shell` wrapper the shared `--panel-shadow` rule at fundhub-brand.css:130-137 never reaches it either, so this faint value is the only shadow that paints and the cards on the one screen a paying client actually logs into sit visibly flatter than the identical cards on every staff screen, with the guard at src/ui/screen-standard.test.m…

## Not fixed anywhere, known

- Dispute letters carry no mailing address and are signed with the client-record name; the verified
  legal name / address columns exist and nothing reads them.
- A wrong-person document counts toward a complete packet the instant it lands.
- "YOUR FUNDING ADVISOR — Not assigned yet": nothing assigns one.
- Letter-pack entitlement granted twice on one purchase (two grant paths, one with no transaction id).
