# Proposed rollout — `requireActiveShift`

> ## SUPERSEDED IN PART — 2026-07-31 (workflow W2)
>
> The gate is now applied. **Two endpoints are gated and only two:
> `api/inquiries.mjs` POST and `api/tasks.mjs` PATCH.** The decision this document
> was waiting on has been made, so what follows is no longer a description of the
> code.
>
> The owner ruled, verbatim: *"Gate writes that affect attribution or pay:
> claiming a lead, logging a call outcome, moving a pipeline stage, sending
> client messages. Do not gate read-only screens."* He then confirmed separately
> that `api/tasks.mjs PATCH { claim: true }` is what "claiming a lead" meant here.
>
> Measured against that rule, **§1's list of four is two right and two wrong.**
> `api/inquiries.mjs` and `api/tasks.mjs` are the two right — though §1 reaches
> `api/tasks.mjs` by arguing from "the most literal reading of *dashboard
> action*", a term the owner never used, so it is the right answer on an argument
> that did not establish it; it was held for a ruling rather than adopted on that
> reasoning. `api/pii.mjs` and `api/inquiry.mjs` are the two wrong — argued below
> on sensitivity and on cost, and neither is attribution or pay. **§3a is closed**
> — reads are not gated. §2 was re-checked and is correct in full. §4 questions
> 2–4 remain open.
>
> **`api/tasks.mjs` claims a TASK, not a lead.** Real lead-claiming does not exist
> in this repository: `cards.owner` (`db/schema/001_init.sql:214`) is never written
> by anything, and `clients` has no assignee column. That is logged as a gap for a
> later thread, not built.
>
> Two of the owner's four categories have **no endpoint in this repository at
> all** — pipeline-stage moves and client messaging both happen inside Inngest
> workflows and webhook handlers, which have no staff principal.
>
> **The record of what was decided, and why, is `docs/workflows/comp-and-shift-gate.md`
> section `## W2`.** Everything below is left exactly as written, as the reasoning
> that preceded the ruling. Read it as history, not as the current list.

**Proposal only. Not one endpoint has been edited.** `src/http/middleware/requireActiveShift.mjs`
exists, is tested, and is currently called from nowhere.

The gate is built and green. What is *not* decided is which endpoints it goes on,
and that decision is not mine to make — see "Why this is a proposal" below. Per
the repo convention (`src/auth/PROPOSED-EVENTS.md`), the list is written down for
an operator to approve rather than applied unilaterally.

---

## What the source actually says

`fundhub-docs/sources/fundhub-master-rebuild-spec.md` §14, Team Telemetry + Clock-In:

> **Clock-in:** button starts a `shifts` row and gates the dashboard (no active
> shift, no dashboard actions). Clock-out or auto-close on inactivity ends it.

That is the entire source. It is one sentence and it contains one undefined term:
**"dashboard actions"**. §14 does not enumerate them, no other section of the spec
does, and nothing in this repository does — there is no route manifest tagged by
surface, no `dashboard: true` flag on a handler, no ADR. `netlify/functions/api.mjs`
maps paths to handlers and nothing else.

So the split below is *my reading of what each endpoint does*, with the file and the
behaviour cited for each so the reading can be checked. Section 3 is the part that
needs a human answer.

## Why this is a proposal

Three reasons, in order of how much they cost if ignored:

1. **Wrong here locks people out of their job.** This gate's failure mode is a 403
   on a working day. An endpoint gated that should not have been is not a subtle
   regression; it is an employee who cannot do the thing they are paid to do, and
   whose remedy ("clock in") may not even apply to them.
2. **"Dashboard action" is a product decision with no source.** Deciding it in code
   would be inventing a value the schema and the spec do not contain — the repo's
   headline rule (HANDOFF.md) says report the gap instead.
3. **Three other threads are writing in these files right now.** Editing
   `api/inquiries.mjs`, `api/tasks.mjs` or `api/pii.mjs` from here would collide
   with whoever owns them this hour.

---

## 1. Clearly a dashboard action — adopt

Staff-session **write** endpoints, reached from the internal dashboard, whose effect
is a thing a person did during a shift. These are the ones §14's telemetry sentence
is about ("files touched, time per stage, pulls run, letters issued, texts sent,
calls made, minutes per close, **per staff member per shift**") — a write with no
shift to attribute it to is exactly the hole the gate closes.

| Endpoint | Evidence |
| --- | --- |
| `api/inquiries.mjs` — POST only | Inquiry Remover's write path. `POST {inquiry_id, action:"attempt"\|"confirm"\|"status"}` records dispute attempts and moves `inquiry_log` status. Auth is `requirePrincipal(req,res,["staff"],{db})`, so a staff principal is already in hand and can be passed straight to the gate. Its GET (`?inquiry_id=` → attempt history) is a read and is covered in §3. |
| `api/tasks.mjs` — PATCH only | The work queue. `PATCH {id, done}` / `{id, claim:true}` / `{id, assignee_staff_id}`. Claiming and completing work items is the single most literal reading of "dashboard action", and `claim` writes `assignee_staff_id` = the caller — an assignment recorded against someone who is not on the clock is a timesheet contradiction. Auth is `requirePrincipal(…["staff"]…)`. Its GET is a read; see §3. |
| `api/pii.mjs` — POST only | `POST {client_id, action:"reveal", reason}` returns a full SSN and writes an access-log row; `action:"store"` writes identity data. The file's own header says the role gate is deliberately narrower than `ROLE_SETS.STAFF` because this is the most sensitive surface in the product. An SSN reveal that no shift can account for is the worst row this gate can prevent from existing. |
| `api/inquiry.mjs` — POST only | Authed proxy to the external inquiry-removal-ai runtime: `?action=schedule` books a call, `?action=launch` starts one, `?action=update` writes case notes/status. These reach outside the system and cost money. Already role-gated (`requireRole("inquiry_specialist","admin")`), which means `req.staff` is attached and the gate needs no extra argument. GET actions (`cases`, `status`) are reads; see §3. |

**Adoption shape**, for each of the four — inserted after the existing auth call,
before the method switch, and *inside* the `POST`/`PATCH` branch only, so GET keeps
working:

```js
import { requireActiveShift } from "../src/http/middleware/requireActiveShift.mjs";
// … after the existing principal/staff resolution:
if (req.method === "POST") {
  const shift = await requireActiveShift(req, res, { db, principal });  // or { db } after requireAuth
  if (!shift) return;
  …
}
```

No route change, no registration change, no migration. The gate reads
`req.staff` when the handler used `requireAuth`, and takes `{ principal }` when it
used `requirePrincipal` (which attaches nothing to the request).

---

## 2. Clearly must NOT adopt — gating these breaks the product

| Endpoint | Why not |
| --- | --- |
| `api/shifts.mjs` | **The clock itself.** `POST {action:"clock_in"}` is how a shift starts. Gating it means you need a shift to get a shift, and nobody can ever work again. This is the one entry on the list that is not a judgement call at all. `clock_out` too: it is reached *from* a shift but must keep working if the shift was auto-closed underneath the browser. |
| `api/auth/login.mjs`, `api/auth/logout.mjs`, `api/auth/session.mjs` | You sign in before you clock in. Same deadlock as above, one step earlier. `logout` in particular must never be gated — an employee who cannot sign out is a live credential nobody can revoke from the UI. |
| `api/health.mjs` | Unauthenticated by design; it is what tells you the database is down. Gating it on a database read inverts its purpose. |
| `api/webhooks/[provider].mjs` | Inbound Twilio/Mailgun/Cal.com/Bland/Commas/ClickFunnels traffic. No staff, no session, no principal — the gate would 401 every provider callback and silently stop the whole event spine. |
| `api/inngest.mjs` | The workflow runtime's own entry point. Same reason. |
| `api/documents/[id].mjs` | Its header is explicit: "AUTH IS THE SIGNATURE, not a session" — a signed link in an email must work for a client who is not signed in. |
| `api/campaigns/*` (6 files), `api/creative/*` (4 files) | All `partnerReadHandler`. The principal is a partner/client account, not staff. **A partner has no clock-in button and no `staff` row**, so the gate would answer 403 forever. `requireActiveShift` returns `forbidden` rather than `no_active_shift` for exactly this case, but the right answer is not to gate them. |
| `api/dashboard/client.mjs`, `clients.mjs`, `pipeline.mjs`, `seed.mjs` | Gated by `requireDashboardAccess` (the `DASHBOARD_SECRET`), not by a staff session, so there is frequently no principal to gate on and the middleware would 401. `seed.mjs` is additionally a dev/demo tool. Note the naming trap: these live under `api/dashboard/` and are **not** the "dashboard actions" §14 means. |

---

## 3. Judgement calls — an operator has to decide

### 3a. Reads. The big one.

§14 says "no dashboard **actions**". The read surface is `api/read/*` (15 files),
`api/hiring/*` (6 files), and the GET halves of the four endpoints in §1. All but one
go through `readHandler`, which is GET-only and 405s anything else;
`api/read/tradelines.mjs` is hand-rolled but is still read-only (`requireAuth` +
`listTradelines` + `calcFunding`, no write). None of them changes anything.

**My reading: do not gate reads.** Three reasons.

- "Action" most naturally means "thing you did", not "screen you looked at", and
  §14's telemetry list is entirely of *doings*.
- A dashboard whose reads are gated cannot render the screen containing the
  clock-in button. The user sees a wall of 403s and no way out. (`api/shifts.mjs`
  GET stays open under this reading, which is what makes the button renderable.)
- Gating reads would put a shift check in front of `api/hiring/decisions.mjs`, the
  **NYC Local Law 144 AEDT audit trail**. An auditor is not an employee on a shift.
  Gating that endpoint has a compliance consequence and it should not be acquired
  by accident.

**But it is genuinely arguable the other way** for a narrow set — `api/read/pii`-adjacent
data, `api/read/conversations.mjs`, `api/read/commissions.mjs` — where *looking* is
itself the sensitive act. If the operator wants "you cannot browse client
conversations off the clock", that is a coherent policy and this gate implements it
unchanged; it just is not what the one sentence in §14 says.

**Needs a decision. I have not implemented either reading.**

### 3b. `api/partner-brand.mjs` — PUT

`requireAuth` then a principal check; today it reduces to owner/admin because
partner sessions do not exist yet. A `PUT` that rewrites a white-label partner's
brand tokens is a write performed by a staff member from a dashboard, so it fits §1
on the letter. Against: it is an administrative/configuration change, likely done
by an owner who does not clock in at all. **Whether owners and admins clock in is
the actual question, and it has no source** — see §4.

### 3c. Role-scoped exemption

Does an `owner` bypass this gate the way `SUPER_ROLES` bypasses `requireRole`?
`requireRole` has an explicit `SUPER_ROLES = ["owner"]` escape hatch. This gate has
**none**, deliberately: the shift record is an hours record, and an exemption is a
policy choice, not a default. If Chris does not clock in, gating anything he touches
locks him out of his own product. If exemptions are wanted, the clean form is an
option on the gate (`requireActiveShift(req, res, { db, exempt: SUPER_ROLES })`),
not a second copy of the check. **Not built. Needs a decision.**

### 3d. Where the gate sits relative to the role gate

Currently the gate composes *after* whatever auth the handler already does, so a
staff member with the wrong role gets 403 `forbidden` and never learns whether they
were also off the clock. That is the right order (do not leak which gate you failed
to someone who fails both), but it is worth confirming that is the intent.

---

## 4. Open questions with no source anywhere in this repository

1. **Which endpoints are "dashboard actions".** §14 does not say. §3a and §3b above.
2. **Do owners and admins clock in?** Nothing in `staff`, `shifts`, `db/schema/001_init.sql`,
   `db/migrations/060_shifts_one_open.sql` or the spec distinguishes roles for the
   purpose of shifts. Left unimplemented rather than guessed.
3. **What happens to work in flight when a shift auto-closes underneath someone.**
   `autoCloseStale()` (`src/shifts/store.mjs`) exists and its threshold is now a
   decided policy: `STALE_SHIFT_HOURS = 12`, set by the owner on 2026-07-31. The
   number is settled; this question is not. Once these endpoints are gated, that
   sweep acquires a second, larger consequence: it revokes dashboard access
   mid-task. §14 says "auto-close on **inactivity**", which is a different trigger
   from the elapsed-time one that is implemented. **That mismatch is worth a look
   independently of this gate.** Nothing calls `autoCloseStale()` today — there is
   no scheduler and no caller — so no shift is being swept at any threshold yet.
4. **Whether a refused action should be recorded.** `staff_events` is the obvious
   home for "tried to act off the clock", and it would be a genuinely useful
   telemetry signal (people repeatedly forgetting to clock in is a fixable process
   problem). Not implemented: `staff_events.staff_id` is `NOT NULL` and
   `shift_id` would be NULL by definition here, and writing rows on a refusal path
   is an unbounded write driven by unauthenticated-adjacent traffic. Needs a
   decision before it is built.

---

## 5. What is done and needs nothing

- `src/http/middleware/requireActiveShift.mjs` — the gate. `requireActiveShift`,
  plus `activeShift` / `attachShift` / `staffIdFrom` / `SHIFT_UNAVAILABLE` for
  callers that want the answer without the refusal.
- `src/http/middleware/requireActiveShift.test.mjs` — 23 tests, no database.
- `src/http/middleware/requireActiveShift.pg.test.mjs` — 12 tests against real
  Postgres, skipped without `DATABASE_URL`. The outage case uses a real aborted
  transaction (SQLSTATE 25P02), not a stub that throws.
- No migration. `shifts` is in `001_init.sql`, `uq_shifts_one_open` is in
  migration 060, and `currentShift()` already exists in `src/shifts/store.mjs`.
- No route. No handler registration. The gate is a library, not an endpoint.
