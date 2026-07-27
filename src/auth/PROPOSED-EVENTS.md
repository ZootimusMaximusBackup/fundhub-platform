# Proposed canonical events — staff authentication

**Proposal only. `src/events/canonical.mjs` has not been edited.**

Staff auth needs events that do not exist in `CANONICAL_EVENTS` today. Per the
build rules they are proposed here rather than added unilaterally — `canonical.mjs`
is the spec §4 event spine and adding to it is Darwin's call.

Nothing in `db/schema/020_auth.sql`, `src/auth/` or `src/http/middleware/`
depends on these existing. The auth modules take `db` as an argument and write
their own tables directly; not one of them calls `emit()`. These are what a
handler would naturally emit if the spine is extended, and the auth surface is
fully functional without them.

---

## Why the existing spine is not enough

The journey spine is about a *client* moving toward funding. Every existing
event carries a `client_id`. Authentication is about a *staff member*, and there
is currently no event in the spine whose subject is a staff member at all —
`staff_events` (001_init.sql) is a table written directly, not an event stream.

That is the gap. It is worth deciding deliberately rather than by default,
because §14 telemetry ("who was on the file, when") reads more naturally off an
event stream than off scattered table writes.

---

## Proposed: session lifecycle

### `staff.logged_in`

The one this build actually wants. Emitted by a login endpoint after
`src/auth/login.mjs` returns `ok: true`.

```jsonc
{
  "name": "staff.logged_in",
  "version": 1,
  "idempotency_key": "session|<session_id>",
  "client_id": null,
  "payload": {
    "staff_id": "<uuid>",
    "employee_code": "EMP-000001",   // present once 012_attribution.sql has landed
    "session_id": "<uuid>",
    "role": "closer",
    "ip": "203.0.113.9",
    "user_agent": "Mozilla/5.0 ...",
    "at": "2026-07-27T12:00:00Z"
  }
}
```

**The payload carries no token and no hash.** The session token is not a fact
about the login, it is a credential; `session_id` identifies the session for
audit without being usable to assume it. Anything that emits this event must
keep it that way — the events table is queried, exported and replayed, and a
token in a payload is a token in a backup.

The idempotency key is the session id, so a replayed emit collapses onto the
same row via the existing `idx_events_idem` unique index. Replay-safe (Rule 9).

### `staff.logged_out`

Emitted on explicit sign-out, i.e. `revokeSession()`. Payload: `staff_id`,
`session_id`, `reason` (`"user"` | `"password_change"` | `"suspended"` |
`"expired"`). The distinction matters for §14: a session that ended because
someone went home is a different signal from one killed by a suspension.

Worth deciding whether passive expiry emits at all. It probably should not —
expiry is the absence of an event, and emitting one per lapsed session turns a
quiet Sunday into thousands of rows.

### `staff.login_failed`

Deliberately **not** proposed as a canonical event. Failed logins already land
in `auth_attempts`, which is what the rate limiter reads; duplicating them into
the append-only events table would let anyone with a login form inflate it
without bound. If failure telemetry is wanted, it should be an aggregate read
over `auth_attempts`, not an event per attempt.

---

## Proposed: account lifecycle

### `staff.invited`

Emitted by `inviteStaff()`. Payload: `staff_id`, `email`, `role`, `invited_by`,
`expires_at`. **Never the invite token** — same rule as above, and more sharply,
because the invite token is a password-setting capability.

### `staff.activated`

Emitted when an invite is accepted and the staff member sets their own password.
Payload: `staff_id`, `role`, `at`. This is the event a "new hire onboarded"
dashboard tile hangs off.

### `staff.suspended`

Emitted by `suspendStaff()`. Payload: `staff_id`, `suspended_by`,
`sessions_revoked`. Notable because it is the one account event with an
immediate security consequence: every live session for that person is revoked in
the same call.

---

## The §14 question I could not answer

The brief pointed at `fundhub-docs/sources/fundhub-master-rebuild-spec.md` §14
(clock-in and monitoring consent). **That file is not in this repository** — not
on `main`, not on `b3-import`, not anywhere on disk — so I could not read it, and
I have not guessed at what it requires.

What I did instead: left the seam clean rather than inventing a shape for it.

- `shifts` and `staff_events` (001_init.sql) already exist and are the obvious
  home for clock-in. `sessions` deliberately does **not** reference `shifts`.
- A login is not a clock-in. Someone checking a file from their phone at 9pm has
  authenticated, not started a shift. Collapsing the two would corrupt the hours
  data that §14 presumably drives.
- If §14 wants "clock in at first login of the day", that belongs in a handler
  on `staff.logged_in` writing a `shifts` row — not in `login.mjs`, and not as a
  foreign key on `sessions`.
- Monitoring consent almost certainly needs a recorded, timestamped, versioned
  acceptance per staff member. That is a table (`staff_consents`?), not a boolean
  on `staff`, and it should be designed against the actual §14 text rather than
  from the name of the section.

**Whoever has §14 should confirm this split before a clock-in handler is written.**

---

## Summary for `canonical.mjs`, if approved

```js
// staff auth
"staff.logged_in",
"staff.logged_out",
"staff.invited",
"staff.activated",
"staff.suspended",
```

Five names. `staff.login_failed` is deliberately excluded — see above. They
belong under a new `// staff auth` grouping alongside the existing
`// side events` block; none of them is part of the client journey spine, and
none of them carries a `client_id`.

**One structural note for that decision:** every event in the spine today is
about a client, and `events.client_id` is a real FK. These five would be the
first events with a NULL `client_id` as the normal case. That is allowed by the
schema (the column is nullable) but it is a genuine widening of what the events
table is for, and it is the actual decision being asked for here — not the five
names.
