# F-JOBS — job switch + tonight’s runs

Date: 2026-08-18  
Auditor. Findings only. Did not open `9af65808-…`. Did not charge a card.

Chris said turn the job switch on, then keep auditing.

Env names used: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `DATABASE_URL`, `STAFF_E2E_PASSWORD`. Values not printed.

Ground truth: no intended journey names “jobs ran.” **MISSING.** Scored against Chris’s claim.

---

## What I did

1. Wrote the two Inngest key **names** onto Netlify (all three contexts). Local CLI deploy died (`ENOTFOUND base`). Cloud rebuild `6a84d3bba08d3e85dc48dfd5` is **ready** (published 21:51 UTC).
2. Sent one ping earlier: `fundhub/e2e.ping` id `01M0BDM893W140KNYZ1XBYQYZA`. Inngest stored it. **0** job runs (no job listens for that name). That is honest.
3. Listed live Inngest runs and our `events` rows from tonight’s fires.

The switch was **already on** before that rebuild. Tonight’s book already made real job runs.

---

## Score

| Ask | Result |
|---|---|
| Job switch on? | **PASS** — production already had runs. Keys set. Cloud deploy ready. |
| Book → jobs? | **PASS** — `s-04-call-booked` **COMPLETED**. Four more book jobs started. |
| Mark Cleared → Inngest `c-03` run? | **UNVERIFIED** — our table and a local task exist. No `c-03` run in the last 50 Inngest runs. |
| Reply → Inngest `dpc-03` run? | **UNVERIFIED** in this window. Screen marks it live from our table only. |
| Calendar shows 8:00 PM book? | **FAIL** — still “Nothing booked.” |
| Confirm mail to the apply person? | **FAIL** — bounce. Fake `e2e+aff-fire-*@fundhub.ai` is not a mailbox. |

---

## PASS — book started jobs

- Journey: jobs ran (Chris’s claim; **MISSING** in intended)
- Step: a real Inngest run after tonight’s book
- Expected: success or error for a book job
- Observed:
  - `booking.created` row `f370a046-…` at 21:46 UTC. **No** `client_id` on that row.
  - Inngest: `s-04-call-booked` **COMPLETED** (`01M0BDDP4EZW5PQGMX5EZGHPE1`).
  - Also **RUNNING** (waiting on the 8:00 PM slot): `bs-01-precall-launcher`, `dpc-02-call-outcome-enforcement`, `ai-set-04-3way-handoff`, `dpc-05-no-progress-escalation`.
  - `n-03-hot-nurture` **COMPLETED**.
  - Apply leftovers also ran: `s-01`, `at-01`, `af-02`, `n-01`, `n-02` completed (7 each).
- Evidence: `probe.json` `follow.json`

---

## FAIL — incomplete-survey job dies

- Journey: jobs ran
- Step: leftover apply cards should nudge or stop clean
- Expected: complete or a clear skip
- Observed: last 20 **FAILED** Inngest runs are all `s-02-incomplete-survey-nudge` (7+). Error text not in the list API.
- Evidence: `follow.json`

---

## UNVERIFIED — Mark Cleared did not show an Inngest `c-03` run

- Journey: inquiry complete → next round (Chris’s claim; **MISSING**)
- Step: Inngest run for `c-03-inquiry-removed-resume-or-hold`
- Expected: a run row after `inquiry.removed` `41c26b69-…` at 21:42 UTC
- Observed:
  - Our table has the event. Task `f09e0aff-…` “Start next funding round — clean file” (`source_workflow=c-03-…`).
  - `funding_rounds` on TEST still **0**.
  - Automations screen now says `c-03` is **live** (that only means an `events` row exists + the key name is set).
  - Last 50 Inngest runs have **no** `c-03`.
- Evidence: `probe.json`

**COMPLIANCE REVIEW REQUIRED** — inquiry complete.

---

## FAIL — owner Calendar still empty after a real book

- Journey: book a live slot (Chris’s claim; **MISSING**)
- Step: Tuesday Aug 18 shows the 8:00 PM MST meeting
- Expected: E2e Fire / Strategy session / 8:00 PM
- Observed: Day view still **“Nothing booked.”** Counts are dashes. Join Call locked. Task `d5300a31-…` exists and is due 8:00 PM Phoenix. Inbox got “A new appointment has been scheduled.” The CRM calendar did not.
- Evidence: `docs/workflows/audit-keep-going-2026-08-18-evidence/k1/08-calendar-strip-2026-08-18.json` (other walk, same minute)

---

## FAIL — book confirm cannot land on the apply email

- Journey: book confirm mail
- Step: the person who booked can read the confirm
- Expected: mail to the apply address
- Observed: Chris’s inbox shows a **delivery failure** to `e2e+aff-fire-*@fundhub.ai` (address not found). Host mail did arrive. Sign-in link and “e2e fire thread” also arrived.
- Evidence: `inbox-shot-notes.md` (token not reprinted)

---

## Left undone

- Did not print keys. Did not overwrite keys a second time.
- Did not send `inquiry.removed` or `booking.created` again (that would text / mail again).
- Function-id filter on Inngest returned **400** without an app id. Used the last-50 list instead.

## Next

Consent on TEST, then one bureau pull (K3). Experian only. No TransUnion dump.
