# Portal rebuild — handoff. Pick this up and finish it.

Written 2026-09-05 by the session that built waves 1 and 2. Chris is away 1-2 hours. Everything
you need is in this repository; nothing lives only in a chat.

**Read these three, in this order, before you touch anything:**

1. `docs/workflows/portal-rebuild-plan.md` — the approved plan. Owner-set 2026-09-05. Do not
   re-litigate any decision in it.
2. `docs/workflows/portal-progress-contract.md` — the JSON contract for
   `/api/read/client-progress`. Wave 2 built the endpoint TO it. **You build the screen FROM it.**
3. `docs/DELIVERABLES-AND-REPAIR-TRUTH.md` — verified facts, established by running code, not
   reading it. This work was rebuilt three times against the wrong model; that file exists to
   stop a fourth. Do not re-derive it.

Then `CLAUDE.md`. Section 3a is why the back end came first and the front end is last.

---

## Where things stand right now

**LIVE ON fundhub.ai — wave 1, pushed and deployed 2026-09-05.**
Confirmed by `/api/health`: 247 migrations applied, 0 pending. Migrations only run on the
production build, so that is proof the deploy completed.

* All five client deliverables now save, plus a **sixth** (`business_prep_summary`, the Business
  Readiness Guide) that was being silently dropped for thin-file and authorised-user-dominant
  clients. Both were dying at the same `continue` in `src/underwrite/funding-letter-pdf.mjs`.
* Stored `text/html` documents now download with `Content-Security-Policy: sandbox` instead of
  rendering on the app origin. That closed a real hole: contracts are stored as HTML,
  `src/lib/render-template.mjs:46` does no escaping over 252 CRM merge fields, there was no CSP
  anywhere in the repo, and `fh_token` sits in `localStorage`.
* `client_waypoints` and `paid_service_requests` tables exist (migrations 330, 331). Unused until
  the front end.
* Mailing the same dispute letter twice is prevented at the database level (332, 333, 334), and a
  letter the provider accepted is recorded as mailed **whether or not an id comes back**. A send
  that provably never reached the network releases its claim and can be re-sent. A genuinely
  stuck claim can be cleared by a named human with a written reason.
* All four deliverables render as HTML from Node (`src/deliverables/`). **Not wired into the live
  path yet** — that is deliberate and is part of the remaining work.

Measured on that merge: unit half 8,885 tests / 0 fail / 3 skipped. Database half 2,333 tests /
15 fail — the same 15 `origin/main` already had, name for name. Zero regressions.

**IN FLIGHT LOCALLY — wave 2. DO NOT TOUCH THESE BRANCHES.**
A local session is running three lanes right now. If they are still going when you start, leave
them alone; if they have finished, their branches are:

| Branch | What it is |
|---|---|
| `feat/client-progress-endpoint` | `api/read/client-progress.mjs` + the score panels data |
| `feat/paid-round-request` | the paid round back end, no button |
| `docs/portal-flow-diagrams` | `client-progress-flow.md`, `self-serve-round-flow.md` |

Check with `git branch -v` and `git log --oneline origin/main..<branch>`. If a branch does not
exist, that lane has not finished — build the front end against the **contract** anyway, which is
exactly why the contract was written down.

**NOT STARTED — wave 3. This is your job.**

---

## Your scope: wave 3

Plan section 3 (front end), section 4 (referral) and step 7 (AI support). In build order:

### 1. The progress page
A client-side renderer over the JSON in `docs/workflows/portal-progress-contract.md`.

**Never store server-rendered HTML.** Copy the pattern in `public/contract.html`, whose header at
`:14-24` explains why it lives at the site root and not under `/app/`. No generated markup is ever
persisted, escaping lives in one client-side `esc()`, and the data is live on every visit.

It answers three questions, in this order, every visit:
1. **Where am I?** "Round 2 of 6. Mailed 3 March. The bureaus have until 2 April."
2. **What moved?** "Two items are gone. Your middle score is up 36 since January."
3. **What is next, and whose job is it?** Exactly one item, labelled *us* or *you*.

### 2. Score panels
Owner-set. Three personal bureaus plus business credit. **Business is an array — tapping the panel
toggles between businesses**, so never render one blended number. Tapping any panel opens that
bureau's report, which is the deliverable already saved as a document. **Do not build a second
report renderer**; `reportDocumentId` in the contract is a pointer.

A bureau with no pull renders as *not pulled yet* — never zero, never a blank a client could read
as a low score.

### 3. The waypoint list and the paid round button
Each waypoint shows whose job it is and, where one exists, the paid alternative and its price.
That pairing is the product — an accountability list that is also the upsell surface.

The round button: press, see the price broken out, double-confirm, then a **hosted checkout link**.
Owner-set pricing: **$100 flat for the three bureaus, +$10 creditor letter, +$20 CFPB and state
AG.** A paid round does **not** consume a purchased round from `repair_programs.rounds_cap`.

**Two invariants you must not break.** No silent card capture — nothing in this repo can charge a
stored token (`src/subscriptions/charger.mjs:25`, `:88`). And **payment stages the mail, a human
sends it** — `src/metro2/delivery/send.mjs:3` and `api/repair/send.mjs:3` both forbid mailing from
`payment.received`, in those words.

### 4. Referral — clients become light affiliates
Owner decision. Pressing "Refer a friend" generates the client's share link and affiliate code and
**instantly provisions access to `affiliate.html`**. Wire into `affiliate_commission_rules`
(20% direct, 5% downline) and `affiliate_payouts`. Enforce the payout hold and the tax gate in the
UI.

**That screen is visibly broken today and it is in scope now that a client lands on it.**
`affiliate.html` declares `LEADS=[]` (line 398) and `PAYOUTS=[]` (line 477) and never assigns
either, so both tables permanently read "No referrals on file". No endpoint returns
`affiliate_referrals` or `affiliate_payouts` rows. The RATE and COOKIE tiles are hardcoded strings
while the real rates sit in `affiliate_commission_rules`.

### 5. Fix these while you are in the portal
* The Activity tab (`public/app/client-portal.html:767`) has **no painter** and always reads "No
  activity recorded on this file yet." The contract's `timeline` field is one painter away from
  making it real.
* The post-call stepper at `:506-514` is **five hardcoded ticks**, and its labels are the
  **funding** journey shown to repair clients. Retire or correct it.

### 6. AI support and the accountability layer — SEE ITS OWN SPEC
`docs/workflows/portal-accountability-spec.md`. This is the half that makes the page a service
rather than a screen: the client is chased by email and text when they stall, and can ask a
question and get an answer from the truth.

**It is WAVE 4, not wave 3.** It depends on waypoints being real and visible first, and it is the
piece most likely to cause harm if rushed, because it is the one that talks to people. Do not
start it inside wave 3 — read the spec, note it as next, and finish the screen.

Two things from that spec worth knowing even if you do not build it: copy is deliberately
placeholder because Chris is auditing every email and text in a separate thread, so use stable
template keys and let him swap the words. And the exit conditions are the feature, not a detail —
a chase loop in this product once sent 51 identical texts to one phone in two hours.

---

## Rules this project learned the hard way. Ignore them and you will lose a round.

**Never claim an absolute your code does not deliver.** Four lanes have been sent back for exactly
this — "it is now impossible to…", "all five…", "the silence is fixed", "0 out of 270". A verifier
tests every "every", "always", "never" and "N of N" against the code. Write what it does
**including its exceptions**. Chris does not read code; the plain-English summary is all he sees,
so an inaccuracy there is worse than a bug.

**Never pass `--ignore-other-worktrees`.** It moves the shared branch ref and leaves the *other*
worktree staged to revert the whole commit. It happened here — 721 lines, caught by a verifier. If
git refuses a checkout because another worktree holds the branch, stop and say so.

**Never run `git stash`.** Several sessions share this checkout; stash destroys their uncommitted
work.

**The main checkout is often BEHIND `origin/main`.** Read code from a fresh branch off
`origin/main`, not from whatever is sitting in the folder.

**Run it, do not read it.** Three separate read-only investigations in this project concluded
"not built" for things that were built and working — the document-reading agent, the full-length
printer, the inbound-photo path. Findings from execution outrank findings from reading. Say which
you did.

**No new npm dependencies.** No new page, screen, tab or menu row unless the plan says so.

**"credit repair" must not appear** in client-facing copy on the deliverables, the progress
timeline or the affiliate portal — use funding-optimisation and capital-readiness language. Do
**not** rename the dispute letters, their FCRA wording, the `repair_*` tables, entitlement codes,
event names, or staff screens.

**Rounds 4 and 5 must never render as filed.** Nothing in this system records whether a CFPB or
state AG complaint was actually submitted (`src/metro2/letters/catalog.mjs:57-65`).

**NULL means unknown and must survive.** Never zero, never a substituted value from another field,
never a denial. Money is integer cents (`src/commissions/money.mjs`).

---

## Testing — the traps

Baseline on the current `origin/main`, measured 2026-09-05: unit half **8,885 tests / 8,882 pass /
0 fail / 3 skipped**. Database half **15 pre-existing failures**. Compare failure **names** with
the `(1.23ms)` durations stripped — never counts.

```bash
psql -h 127.0.0.1 -U zootimusmaximus -d postgres -c "CREATE DATABASE fundhub_w3"
DATABASE_URL="postgres://zootimusmaximus@127.0.0.1:5432/fundhub_w3" node db/migrate.mjs
export DATABASE_URL="postgres://zootimusmaximus@127.0.0.1:5432/fundhub_w3"
export APP_DATABASE_URL="postgresql://fundhub_app:ci_not_a_secret@localhost/fundhub_w3"
node --test --test-concurrency=1 $(find src -name '*.pg.test.mjs' | sort)
```

Never run `.pg.test.mjs` in parallel — they mutate shared tables. `npx tsc --noEmit` is a no-op
here and is **not** a gate. `npm test` does not bundle the Netlify functions, so a missing export
passes lint and tests and then kills every deploy. A handler absent from the hardcoded `ROUTES`
map in `netlify/functions/api.mjs` 404s, and **no ROUTES key may start with `documents/`**
(`src/http/routes.test.mjs:239`).

Long runs: wrap in `caffeinate -i` or a closed lid kills them. That has happened.

---

## How to finish

Build wave 3 in isolated worktrees, one lane per area, with two adversarial verifiers per lane —
one that re-runs the tests and reads the diff, one that tests every claim in the report against
the code. That pattern has caught, in this project alone: a guard that permanently bricked letters
which provably never sent, a mailed letter recording nothing and therefore mailable twice, a sixth
document silently dropped while the report said the bug was closed, and a worktree staged to
revert 721 lines. It is slow and it is the only reason nothing broken has shipped.

**Chris cannot be asked questions while he is away.** Make the conservative call, record it, keep
going. A blocking question is a failed lane.

**You probably cannot push.** `git push` has been refused by the permission layer in this project.
Merge into a local integration branch, prove it green, and hand Chris one command:

```bash
cd /Users/zootimusmaximus/fundhub-platform && git push origin <your-branch>:main
```

Confirm `git merge-base --is-ancestor origin/main <your-branch>` first so his push is a
fast-forward.

## What to hand back

What shipped, what is held and why, every decision made in Chris's place, and anything only he can
do. Plain English at a fifth-grade reading level — he does not read code. Three sentences for the
status: what is done, what is blocked, what you need from him.
