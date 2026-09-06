# Wave 3 board — portal rebuild front end, referral, AI support

Owner of this batch: the cloud session on `claude/portal-rebuild-wave-3-1qb7qq`.
Started 2026-09-05. Chris away 1-2 hours; conservative calls recorded in "Decisions made in
Chris's place" at the bottom.

Read `docs/workflows/PORTAL-REBUILD-HANDOFF.md` first. This board is the coordination layer.

## Wave 2 is NOT in this checkout

`git branch -a` on the cloud clone shows only `origin/main` and this branch. The three wave 2
branches named in the handoff (`feat/client-progress-endpoint`, `feat/paid-round-request`,
`docs/portal-flow-diagrams`) are local to Chris's Mac and were never pushed.

**Consequence, and the decision that follows from it:** wave 3 builds FROM
`docs/workflows/portal-progress-contract.md` and does not create `api/read/client-progress.mjs`,
`api/paid-services/*`, or the two flow diagrams. Creating them here would collide with wave 2 on
merge and there would be two competing implementations of the same contract. That is exactly the
case the contract was written for.

## Task list

| # | Lane | Owner | Files | Status |
|---|---|---|---|---|
| A | Progress page | cloud/wave-3 | `public/progress.html` | done |
| B | Affiliate screen fixes | cloud/wave-3 | `public/app/affiliate.html`, `api/read/affiliate-portal.mjs` | done |
| C | Referral enrolment | cloud/wave-3 | `api/affiliates/refer.mjs` | done |
| D | Client portal fixes | cloud/wave-3 | `public/app/client-portal.html` | done |
| E | AI support context | cloud/wave-3 | `api/chat/*` | **REVERTED — moved to wave 4 by the handoff mid-run. Code kept at commit a8723521.** |

Shared file, touched by B, C and E: the `ROUTES` map in `netlify/functions/api.mjs`. One line
each. No ROUTES key may start with `documents/` (`src/http/routes.test.mjs:239`).

## Copy-paste prompts, if any lane has to be re-run in a fresh session

Each is self-contained. Read `docs/workflows/PORTAL-REBUILD-HANDOFF.md` and
`docs/workflows/portal-progress-contract.md` before starting any of them.

### Lane A
> Build `public/progress.html`, the client progress page. It is a client-side renderer over the
> JSON in `docs/workflows/portal-progress-contract.md` — never store server-rendered HTML. Copy the
> pattern and the header comment style of `public/contract.html`, which explains at :14-24 why it
> lives at the site root and not under `/app/`. It answers three questions in order: where am I,
> what moved, what is next and whose job is it. Score panels: three personal bureaus plus business
> credit, business is an ARRAY and tapping the panel toggles between businesses; a bureau with no
> pull reads "not pulled yet", never zero and never blank. Tapping a panel opens
> `reportDocumentId` via the existing document route — do not build a second report renderer.
> Waypoint list shows whose job each item is and the paid alternative with its price where one
> exists. Round button: press, price broken out, double-confirm, then a hosted checkout link.
> Rounds 4 and 5 must never render as filed. The words "credit repair" must not appear. All
> escaping through one client-side `esc()`. No new npm dependency.

### Lane B
> `public/app/affiliate.html` declares `LEADS=[]` at line 398 and `PAYOUTS=[]` at line 477 and never
> assigns either, so both tables permanently read "No referrals on file". No endpoint returns
> `affiliate_referrals` or `affiliate_payouts` rows. The RATE and COOKIE tiles are hardcoded
> strings while the real rates sit in `affiliate_commission_rules`. Build a read endpoint that
> returns referrals, payouts and the real commission rates for the calling affiliate, add it to the
> `ROUTES` map in `netlify/functions/api.mjs`, and paint both tables from it. Enforce the payout
> hold and the tax gate in the UI with an explanation and a route to the document, not a bare
> boolean. Money is integer cents. Auth through `requirePrincipal`. The words "credit repair" must
> not appear.

### Lane C
> Build the "Refer a friend" enrolment endpoint. Pressing it generates the client's unique share
> link and affiliate code and instantly provisions their access to `affiliate.html`. Wire into
> `affiliate_commission_rules` at 20% direct and 5% downline, and `affiliate_payouts`. It must be
> idempotent — a second press returns the same code, never a second affiliate row. Add it to the
> `ROUTES` map in `netlify/functions/api.mjs`. Write a `.pg.test.mjs` under `src/http/` that
> imports the handler; a test under `api/` never runs.

### Lane D
> Two fixes in `public/app/client-portal.html`. The Activity tab at line 767 has no painter and
> always reads "No activity recorded on this file yet" — paint it from the `timeline` field of
> `docs/workflows/portal-progress-contract.md`. The post-call stepper at :506-514 is five hardcoded
> ticks labelled with the FUNDING journey and is shown to repair clients — retire or correct it.
> Do not add a page, screen, tab or menu row.

### Lane E
> `api/chat/*` already reaches a client principal. Feed it the progress facts so "where is my file"
> is answered from the truth rather than guessed, then add the nudge on a stalled waypoint, reusing
> the existing agent runtime rather than a new one. Facts only — the shape is
> `docs/workflows/portal-progress-contract.md`. Never claim a CFPB or state AG complaint was filed;
> nothing in this system records that.

## Change manifests

Written by each lane as it completes. See "Manifest" sections appended below.

## Decisions made in Chris's place

Recorded as required by the handoff. Each is the conservative option.

1. **Wave 2's files are not recreated.** See the section above. The progress page calls
   `/api/read/client-progress` and renders an honest "not available yet" state if that endpoint is
   absent, so the page is not broken by the ordering — it is simply empty until wave 2 lands.

2. **A client may now hold an affiliate code, and that needed a migration.** `044_accounts.sql`
   allowed exactly one subject per account, so a client account could not carry an affiliate id at
   all, and one login per email address means a second account was not available either. Migration
   340 relaxes the constraint in one direction only. The alternative — a second account with a
   second email for the same person — would have given one human two passwords and split them
   across two principals. Recorded rather than asked, because the owner decision ("clients become
   LIGHT affiliates") only reads one way.

3. **The tax gate reports an absence, it does not accuse.** Section 4 asks for the tax gate to be
   enforced in the UI. There was no tax column anywhere in `db/` to enforce it from. Migration 340
   adds `affiliates.tax_form_received_at`, nothing writes it, and both the migration and the screen
   say so — so it reads "we have no record of your tax form", never "you have not sent one". An
   affiliate who posted a W-9 last year is in exactly that state and this system cannot tell them
   apart. No payout logic reads the column.

4. **The post-call stepper was retired, not corrected.** The handoff allowed either. Six of its
   eight steps have no fact in that screen's payload, so a corrected version would be eight grey
   circles that never move — less than the status line above it already says.

5. **The COOKIE tile was replaced, not renumbered.** It said "60d" and there is no
   attribution-window column anywhere in `db/`. Attribution is first touch and does not expire, so
   the tile says that. Putting a different number there would have been the same invention.

6. **AI support was built and then reverted.** The handoff moved it to wave 4 while this branch was
   being written. The code is at commit a8723521 for wave 4 to cherry-pick.

## Blockers and open questions

None blocking. Findings, recorded rather than worked around:

1. **A light-affiliate client sees a dash on the four KPI tiles.** REFERRED, CONVERTED, OWED and
   PAID on `public/app/affiliate.html` are painted from `/api/read/affiliates`, which admits staff
   and an `affiliate` principal but not a `client`. A client who pressed "Refer a friend" stays a
   `client` principal by design (migration 340), so that read returns them nothing and the four
   tiles keep whatever the markup ships. The referrals and payouts TABLES below them are correct —
   they come from the new `read/affiliate-portal`. Not worked around, because that file carries a
   written standing rule that these tiles are painted from that read and never from the referral
   rows. The one change made was the OWED tile's shipped default, from `$0` to a dash: `$0` told a
   caller they were owed nothing, which the page could not know. Fixing it properly is either
   widening `read/affiliates` to a light-affiliate client or lifting that standing rule, and both
   are Chris's call.

2. **The demo-login roster check parses comments as roles.** `src/http/demo-logins.test.mjs`
   matches `/^\s*([a-z_]+):/` across the whole `ROLE_TABS` block in `shell.js`, comments included,
   so a comment line beginning with a lowercase word and a colon is read as a role with no demo
   account behind it. Cost one debugging round. The comment was reworded rather than the check
   loosened; noted so the next person does not lose the same round.
