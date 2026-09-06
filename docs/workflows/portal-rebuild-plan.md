# Client portal rebuild — execution plan

**All architecture below is owner-set (2026-09-05). Do not re-raise it, do not re-litigate it,
do not attach advice to it.** Back end and flow diagrams first, front end last and treated as
throwaway (CLAUDE.md §3a).

## Context

A client pays up to $10,000 and receives four PDFs that are true for about a day, and on the live
site they are the short 4-6 page fallback rather than the designed 9-15, because Netlify cannot
run the Python that makes the real ones.

**Owner decision: stop making PDFs.** The deliverables become hosted web pages. No Python render
service, no Paged.js, no Puppeteer, no new npm dependency. The design is already HTML and CSS —
`scripts/black-reports/fundhub_gen.py:572` is one line handing a built HTML string and a CSS
string to a renderer — so the page is the product and the PDF was only ever a wrapper.

Around it: a living progress page, a checklist of waypoints, a paid "do it for me" on any
waypoint the client stalls on, AI support across the whole thing, and referral. **This is an
upsell and accountability ecosystem, not a document.**

---

## 1. Security and pre-existing bugs — do these first, on their own

**F46 — the fifth deliverable is dropped.** `PRINTER_FILES`
(`src/underwrite/black-report-pdf.mjs:15-20`) and `FUNDING_ANALYSIS_SUBTYPE`
(`src/underwrite/funding-letter-pdf.mjs:24-29`) both list four entries. The Capital Readiness
Summary is built and then never persisted, and the delivery email
(`src/messaging/templates/u02-funding-delivery.html:40`) promises it. Expand both to five.
Prove five rows land in `documents`, not four.

**Stored-HTML XSS.** `src/contracts/send.mjs:50` already stores contracts as `text/html`, and
`api/documents/[id].mjs:92` serves the stored content type with no `Content-Disposition`, so they
render on the app origin. There is no CSP anywhere in the repo, `fh_token` sits in `localStorage`
(`public/app/client-portal.html:2049`), and `src/lib/render-template.mjs:46` is
`return String(val);` with no escaping over 252 CRM merge fields.

At `api/documents/[id].mjs:64-65`, when `mime_type` is `text/html`, send:
```
Content-Security-Policy: sandbox; default-src 'none'
Content-Disposition: attachment
```
Write the test. This closes today's contract exposure and hardens the route before anything else
HTML-shaped goes near it.

---

## 2. Deliverables engine — HTML pages, no PDFs

**Port `scripts/black-reports/fundhub_gen.py` (1,614 lines) into Node.** Feed it from
`src/underwrite/black-report-client.mjs`, which already maps engine output into exactly the shape
the Python consumes — **25 of 25 top-level keys match**. The data side is finished; do not rebuild
it.

What ports mechanically: the 209 lines of CSS across two literals (`:316-481`, `:483-525`) with
nine `%%` → `%` and two `%(name)s` → interpolation; the 9 SVG charts (`:602-805`, 204 lines) which
are hand-written strings with float arithmetic and **no charting library** behind them; the four
document builders and their ~394 lines of static prose.

**CSS adjustments, owner-set:**
* Strip every `@page` rule.
* Convert the full-bleed black cover and CTA pages into ordinary `<header>` / `<div>` elements
  with `min-height: 100vh`.
* Move the running footers out of `@page` margin boxes and into normal web flow.

**Fonts.** The CSS names Inter and JetBrains Mono with no `@font-face`, relying on the Mac's
installed fonts. The nine `.ttf` files are git-tracked at
`docs/workflows/gold-deliverables-v5/fonts/` and referenced by nothing. Add `@font-face` pointing
at them and ship them, so a browser renders the real faces rather than falling back to Arial.

**QR code.** Keep the existing `[ QR CODE ]` text placeholder (`fundhub_gen.py:216-226` already
degrades to it). No new npm dependency.

**Reference for correctness:** `docs/workflows/gold-deliverables-v5/` holds the designed PDFs.
Compare section by section, not page by page — pages stop existing.

---

## 3. Progress page and the self-serve round

**Architecture.** A client-side renderer over JSON facts from a new
`api/read/client-progress.mjs`. **Never store server-rendered HTML.** This is the pattern
`public/contract.html` already uses and explains at `:14-24`. Gate with
`requirePrincipal(req, res, ["staff","client"], { db })` pinned to self, exactly as
`api/read/portal-summary.mjs:43-51` does. One import plus one ROUTES line in
`netlify/functions/api.mjs`, and **the key must not start with `documents/`** —
`src/http/routes.test.mjs:239` forbids it.

**Un-hardcode the ladder.** `src/optimize-page/roadmap.mjs:146` passes `letters: []`, which pins
every client to "Round 1, current" forever. Pass the real letters array so `buildRoundPlan`
returns true states.

**Payments.** No silent card capture — nothing in this repo can charge a stored token
(`src/subscriptions/charger.mjs:25`, `:88`). Every "do it for me" button mints a **hosted
checkout link**, the rail that works today (`src/payments/commas-api.mjs:337`).

**Mailing invariant, respected.** `src/metro2/delivery/send.mjs:3` and `api/repair/send.mjs:3`
both forbid mailing from `payment.received`. **Payment stages the round as ready to mail. A human
staff member still executes the send.** Do not route around this.

**Double-billing guard.** `dispute_letters` has no unique index and `src/repair/send.mjs:193`
sets `status='sent'` with no check of current status, so a re-POST mails and bills again. Add the
unique index and the status check. This ships before any client-facing button exists.

**Pricing, owner-set:** $100 flat per round covering all three bureaus, **+$10** when a creditor
letter is required, **+$20** when CFPB and state AG are required. A paid round **does not consume**
a purchased round from `repair_programs.rounds_cap`. Every paid round re-pulls credit first and
builds the dispute from the freshest data and the client's submission history.

**Schema migrations** (reserve a range at build time):
* `client_waypoints` — the checklist and the spine of the ecosystem. Per client: order, whose job
  it is, state, completed_at, due_at so "overdue" is a fact, and **`paid_alternative_price`**.
  That column is what makes this an upsell system rather than a to-do list; it is there from the
  first migration. New table — do not fight `tasks_assignee_role_ck`
  (`db/migrations/041_task_routing.sql:57`), which blocks a client from owning a task.
* `paid_service_requests` — one row per request, general enough for a round, a pull, and later a
  funding application. Records the priced components, the charge, what it produced, and a natural
  idempotency key so a double press is one row. Hang it off the proven
  `events(org_id, idempotency_key)` unique index.
* Per-piece mail cost on `dispute_letters`, so the margin on the $100 is knowable. Nothing records
  it today.

---

### Score panels — owner-set 2026-09-05

The progress page carries score panels for **both** files, not just the personal one.

* **Three personal bureaus** — Experian, Equifax, TransUnion — plus **business credit** beside
  them. `api/read/portal-summary.mjs:213-234` already returns `scores` with those three and
  `experian_business`, so part of the read exists; the panel does not.
* **Multiple businesses: tapping the business panel toggles between them.** So the endpoint must
  return a business score **per business**, keyed on a stable business id — not one blended
  number. Check what the `businesses` table actually stores per row first;
  `src/underwrite/business-funding.mjs` already owns the rule for what counts as a business on
  file, and F44 in the walkthrough was caused by business age never reaching the engine, so do
  not trust that path without running it.
* **Tapping any panel opens that bureau's report.** A personal panel opens the personal report
  for that bureau; a business panel opens the business report for that business. Those are the
  deliverables being ported in section 2 — the panel is a link into that document view, **not a
  second report renderer**. Do not build one.
* Unknown must survive. A bureau with no pull reads as not pulled — never zero, and never a blank
  that a client mistakes for a low score.

## 4. Referral — clients become light affiliates

**Owner decision: option 2.** Clicking "Refer a friend" generates the client's unique share link
and affiliate code and **instantly provisions their access to `affiliate.html`**.

Wire them into the existing tables: `affiliate_commission_rules` at **20% direct, 5% downline**,
and `affiliate_payouts`. Enforce the standard payout hold and the tax-compliance gate in the UI.

**Known broken on that screen and in scope to fix**, since a client will now land on it:
`affiliate.html` declares `LEADS=[]` (line 398) and `PAYOUTS=[]` (line 477) and never assigns
either, so both tables permanently read "No referrals on file"; no endpoint returns
`affiliate_referrals` or `affiliate_payouts` rows; the RATE and COOKIE tiles are hardcoded strings
("Per agreement", "60d") while the real rates sit in `affiliate_commission_rules`; and the payout
hold gated by `affiliates.partner_license_signed_at` is reduced to a bare boolean with no
explanation and no route to the document.

---

## 5. Public branding guardrail

**Owner-set: the term "credit repair" appears nowhere** in front-end copy on the ported
deliverables, the progress timeline, or the affiliate portal. Use funding-optimization and
capital-readiness language.

Scope boundary, so nobody over-applies it: this governs **client-facing copy on those three
surfaces only**. Do not rename the dispute letters themselves, the FCRA statutory language inside
them, the `repair_*` tables, entitlement codes, event names, or internal staff screens. Renaming a
stored value without a migration breaks the feature silently, and the letters' legal wording is
not marketing copy.

---

## Build order

1. **Section 1 in full** — F46 and the CSP header. Independent, ships alone.
2. **Schema and migrations** — waypoints, paid service requests, the mail-cost column, and the
   `dispute_letters` unique index plus the send-loop status check.
3. **Read endpoints with tests that prove them** — `api/read/client-progress.mjs`, and
   un-hardcoding the ladder. Green against a real `DATABASE_URL`; a skipped `.pg.test.mjs` is not
   green.
4. **Flow diagrams** — `docs/journeys/client-progress-flow.md` and
   `docs/journeys/self-serve-round-flow.md`. Mermaid in fenced blocks. Every state a request moves
   through and the event that fires each transition, including the refusals: payment failed, a
   round already staged, cap reached, pull failed, no letters to send.
5. **The Node deliverables renderer** — section 2.
6. **Front end, last** — the progress page, the waypoint list with its paid alternatives, the
   round button with its price breakdown and double-confirm, the referral button, and the
   affiliate screen fixes. Fix the portal's Activity tab in the same pass; `#tp-act`
   (`public/app/client-portal.html:767`) has no painter and always reads "No activity recorded."
   Retire the fake stepper at `:506` — five hardcoded ticks, labelled with the **funding** journey
   and shown to repair clients.
7. **AI support** — `api/chat/*` already reaches a client principal. Give it the progress facts as
   context, then the nudge on a stalled waypoint, reusing the existing agent runtime.

## Assets to wire, not rebuild

`src/repair/portal.mjs:3-19` client-safe stage titles and honest expected dates, written and
tested with **zero callers**. `timelineLine()` (`src/repair/lens.mjs:206`) renders
`repair_decision_log` in plain English, staff-only today. `roundLadderEntry()`
(`src/metro2/letters/catalog.mjs:124`). `OUTCOME_WORDS` (`src/repair/notify.mjs:41`).
`negativeKeysFromResult()` (`src/crs/snapshot-negatives.mjs:63`) already diffs pull to pull.
`api/read/portal-summary.mjs:140-147` already loads **every** `crs_results` row with no LIMIT and
discards all but the newest — the score series costs one mapping function.

**Do not extend `public/optimize.html`.** Despite the name it is a SmartCredit affiliate signup
page for strangers with no credit file, no auth, and contractually barred from bundling our
service with theirs (`:263-264`).

## Verification

Nothing counts until it is watched, not read. A real client on a scratch Postgres driven through
the whole path — enroll, upload, generate, stage, mail, record a bureau response, buy a round,
refer a friend — with the page read at each point. Two real pulls for the score series. Prove the
page **never** shows R4 or R5 as filed; nothing in the system knows whether a CFPB or AG complaint
was actually submitted (`src/metro2/letters/catalog.mjs:57-65`). Prove a double press produces one
charge and one mailing. Prove five deliverables persist, not four.

Baseline: unit half about 8,721 tests, 0 failures; database half 15 pre-existing failures. Compare
failure **names** with `(1.23ms)` durations stripped, never counts. `npx tsc --noEmit` is a no-op
in this repo and is not a gate.

Confirm before promising a long score chart: `src/retention/classes.mjs:147` tombstones
`crs_results.result` after a configured `retainDays`.
