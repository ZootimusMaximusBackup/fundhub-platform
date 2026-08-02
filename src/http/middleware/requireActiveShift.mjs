// requireActiveShift — "no active shift, no dashboard actions", as ONE gate.
//
// The rule is from the spec, §14 Team Telemetry + Clock-In:
//
//   "Clock-in: button starts a `shifts` row and gates the dashboard (no active
//    shift, no dashboard actions)."
//
// (fundhub-docs/sources/fundhub-master-rebuild-spec.md §14 — note that
// src/auth/PROPOSED-EVENTS.md says that file was not on disk when auth was
// written. It is now, and the sentence above is the whole of what it says about
// this gate. It does NOT say which endpoints count as "dashboard actions" —
// see ACTIVE-SHIFT-ROLLOUT.md, which proposes a list rather than assuming one.)
//
// IT IS ONE FILE ON PURPOSE. A shift check copy-pasted into each handler is a
// check that will be missing from the handler written next month, and nothing
// will fail — the endpoint just quietly works while its neighbours are gated.
// One middleware means "is this endpoint gated?" is answered by reading one
// line at the top of the handler, and means the failure body, the status code
// and the outage behaviour cannot drift between endpoints.
//
// IT COMPOSES AFTER requireAuth / requirePrincipal. It does not authenticate.
// A request that has not been through one of those has no identity here, and
// this file refuses rather than resolving one itself: two places that decide
// who you are is one place too many, and the sibling gates already own that.
//
//   const principal = await requirePrincipal(req, res, ["staff"], { db });
//   if (!principal) return;
//   const shift = await requireActiveShift(req, res, { db, principal });
//   if (!shift) return;
//
// or, downstream of requireAuth (which sets req.staff):
//
//   const staff = await requireAuth(req, res, { db });
//   if (!staff) return;
//   const shift = await requireActiveShift(req, res, { db });
//   if (!shift) return;
//
// The return convention is the siblings' exactly: the thing you asked for on
// success, `null` after the refusal has already been written. Callers keep
// using `if (!x) return;` and nothing new has to be learned.

import { db as defaultDb } from "../../db.mjs";
import { currentShift } from "../../shifts/store.mjs";

/* WHAT "OPEN" MEANS IS NOT DEFINED HERE. currentShift() in src/shifts/store.mjs
   owns the predicate (`ended_at IS NULL`, newest first), the same function
   /api/shifts answers GET with. If the definition of an open shift ever changes
   — a per-org grace period, a break state, a paused shift — it changes in one
   place and this gate follows it. A second SELECT written here would be a
   second definition, and the two would disagree on the day it mattered. */

/* SHIFT_UNAVAILABLE — "I could not check", which is NOT "you are not clocked in".
   Modelled on AUTH_UNAVAILABLE in requireAuth.mjs, for the same reason and with
   the same sharp edge: the previous generation of that code swallowed a database
   failure and answered as though the user were signed out.

   Here the equivalent mistake would be worse in one direction and worse in the
   other, depending on which way you resolve it:

     swallow-and-pass  → the database goes down and the gate silently stops
                         existing. AUDIT-FINDINGS.md lesson 3: "absent config
                         must never mean no gate." An outage is absent config.
     swallow-and-403   → everyone is told to clock in, they click the clock-in
                         button, that write hits the same dead database, and the
                         screen accuses them of not doing the thing they cannot do.

   So it is neither. A failed check is a 503 that says so. */
export const SHIFT_UNAVAILABLE = Symbol("shift_unavailable");

/**
 * staffIdFrom(req, { principal }) — who this gate is about, or null.
 *
 * Two shapes are accepted because the two sibling gates produce two shapes:
 *
 *   requirePrincipal returns { kind: "staff", staffId, orgId, staff, … } and
 *   attaches NOTHING to the request (resolvePrincipal calls authenticate()
 *   directly, not attachStaff()), so that object has to be passed in.
 *
 *   requireAuth attaches req.staff = { id, org_id, role, … } and returns it.
 *
 * An explicitly passed principal wins over req.staff: a caller that handed one
 * over is being specific, and silently preferring something it did not pass
 * would make the gate answer about a different person than the handler is
 * serving.
 *
 * Nothing is guessed. A principal with no `staffId` and no `staff.id` does not
 * get its `id` borrowed — on a client/affiliate/partner principal that `id` is
 * an account id, and looking up shifts by it would be a lookup against the
 * wrong table's key space that happens to return zero rows and read as "not
 * clocked in".
 */
/* roleFrom — the caller's role, lowercased, or "".

   Read from the same two shapes staffIdFrom reads, and for the same reason:
   requirePrincipal hands back a `role` and attaches nothing, requireAuth
   attaches req.staff.role. Used only by the exemption below. */
export function roleFrom(req, { principal } = {}) {
  const p = principal ?? req?.principal ?? null;
  const raw = (p && (p.role ?? p.staff?.role)) ?? req?.staff?.role ?? "";
  return String(raw).trim().toLowerCase();
}

/* EXEMPT_SHIFT — the sentinel a gate returns for somebody who does not clock in.
 *
 * WHY THIS IS AN OBJECT AND NOT `true`, AND NOT null.
 *
 * Every call site is written `const shift = await requireActiveShift(...); if
 * (!shift) return;` and then reads `shift.id` to stamp the work with the clock
 * it happened on. Returning null would refuse the caller. Returning `true` would
 * pass them and then blow up on `.id`.
 *
 * So it is a shift-shaped object whose `id` is null, which is the honest value:
 * this work is not attached to a shift, and `staff_events.shift_id` is nullable
 * precisely because "not linked to a shift" is a legitimate state (see the
 * header of src/shifts/telemetry.mjs). An owner's message is recorded as sent by
 * that owner, on no shift, which is exactly what happened.
 *
 * `exempt: true` is on it so a caller that wants to tell the two apart can,
 * without having to compare ids to null and guess why. */
export const EXEMPT_SHIFT = Object.freeze({ id: null, exempt: true });

export function staffIdFrom(req, { principal } = {}) {
  const p = principal ?? req?.principal ?? null;
  if (p && typeof p === "object") {
    const kind = String(p.kind ?? "").trim().toLowerCase();
    // A non-staff principal is not "not clocked in" — it is a kind of caller
    // this gate has no opinion about, and saying "clock in" to a client would
    // be nonsense. Reported separately so requireActiveShift can answer the way
    // requirePrincipal answers a wrong-kind session.
    if (kind && kind !== "staff") return { staffId: null, kind };
    const id = p.staffId ?? p.staff?.id ?? null;
    if (id) return { staffId: id, kind: "staff" };
  }
  const attached = req?.staff?.id ?? null;
  if (attached) return { staffId: attached, kind: "staff" };
  return { staffId: null, kind: null };
}

/**
 * activeShift(req, opts) — the open shift, `null`, or SHIFT_UNAVAILABLE.
 * Never throws. Never touches `res`.
 *
 * Split out from the gate for the same reason requireAuth splits authenticate()
 * out: it is the part worth testing without a fake HTTP layer, and a handler
 * that wants to know whether someone is on shift WITHOUT refusing them (a
 * banner, a read-only view, a telemetry writer deciding whether to stamp
 * shift_id) needs the answer without the 403.
 */
export async function activeShift(req, { db = defaultDb, principal } = {}) {
  const { staffId } = staffIdFrom(req, { principal });
  // No id ⇒ no query. Calling currentShift(db, { staffId: undefined }) throws a
  // ShiftError from its own argument check, which would arrive here looking
  // exactly like a database failure and turn a wiring bug into a 503 outage
  // report. The two are told apart by asking first.
  if (!staffId) return null;
  try {
    return (await currentShift(db, { staffId })) ?? null;
  } catch {
    // A staff member with no open shift is not an error — currentShift returns
    // null for that. Reaching here means the CHECK failed, which is ours.
    return SHIFT_UNAVAILABLE;
  }
}

/**
 * attachShift(req, opts) — activeShift(), hung off the request. Returns the
 * shift or null, exactly as attachStaff returns the staff or null.
 *
 * req.shift is set only on success. req.shiftUnavailable is the flag that lets
 * requireActiveShift tell an outage from an honest "not clocked in" after the
 * value has collapsed to null, mirroring req.authUnavailable.
 */
export async function attachShift(req, opts = {}) {
  const result = await activeShift(req, opts);
  if (result === SHIFT_UNAVAILABLE) { req.shiftUnavailable = true; return null; }
  if (!result) return null;
  req.shift = result;
  return result;
}

/**
 * requireActiveShift(req, res, { db, principal }) — the gate.
 *
 * Returns the shifts row, or writes the refusal and returns null:
 *
 *   503 { ok:false, error:"shift_unavailable", db:"down" }  the check failed
 *   401 { ok:false, error:"unauthorized" }                  no identity at all
 *   403 { ok:false, error:"forbidden", message }            wrong principal kind
 *   403 { ok:false, error:"no_active_shift", message }      identified, not clocked in
 *
 * THE ORDER OF THOSE FOUR IS THE DESIGN. The outage is checked before anything
 * else because every other answer is a claim about a fact this code could not
 * establish. "You are not clocked in" is only sayable once the database has
 * actually been asked.
 *
 * 401 for a missing identity is what requireAuth says to a request with no
 * session, and it is deliberately the same here even though the likelier cause
 * is a handler that forgot to call requirePrincipal first. Whatever the cause,
 * this gate could not name the person it is supposed to be about, and the one
 * thing it must not do in that state is pass. Failing closed with the sibling's
 * own body keeps a wiring bug from inventing a fifth failure shape.
 *
 * 403 forbidden for a client/affiliate/partner session is requirePrincipal's
 * answer to a session of the wrong kind, reused verbatim. Telling a client to
 * clock in would be advice they cannot act on — there is no client clock.
 *
 * The no_active_shift message names the fix, because this 403 is the one a real
 * employee will see on a real morning, and "forbidden" with no further text is
 * indistinguishable on screen from "you do not have permission", which is a
 * different problem with a different remedy (ask an admin, versus press the
 * button at the top of your own dashboard).
 */
export async function requireActiveShift(req, res, opts = {}) {
  const { staffId, kind } = staffIdFrom(req, opts);

  /* ── THE EXEMPTION ──────────────────────────────────────────────────────
     ACTIVE-SHIFT-ROLLOUT.md §3c left this open: "Does an `owner` bypass this
     gate the way SUPER_ROLES bypasses requireRole? ... Not built. Needs a
     decision." §4 question 2 restated it: "Do owners and admins clock in?
     Nothing in `staff`, `shifts`, the schema or the spec distinguishes roles
     for the purpose of shifts. Left unimplemented rather than guessed."

     DECIDED BY THE OWNER, 2026-08-02, verbatim: "Owners definitely don't clock
     in." Logged as owner-set. The question is closed; do not re-raise it.

     Note it is exactly the shape §3c proposed — an option on the gate, not a
     second copy of the check — so which endpoints grant it stays readable at
     each call site instead of being a rule buried in here. And it is
     ROLE-scoped, not id-scoped: there is no list of exempt people to keep in
     step with the staff table.

     IT IS OPT-IN PER CALL SITE. A gate that exempted owners by default would
     silently widen every future endpoint that adopts it. `exempt` is absent
     unless a handler passes it, so the default is still "everyone clocks in".

     The check runs before the database is touched, which matters: an owner who
     does not clock in has no shift row to find, and asking for one would be a
     query whose only possible answer is the refusal this skips. */
  const exempt = opts.exempt;
  if (staffId && Array.isArray(exempt) && exempt.length) {
    const role = roleFrom(req, opts);
    if (role && exempt.map((r) => String(r).trim().toLowerCase()).includes(role)) {
      req.shift = EXEMPT_SHIFT;
      return EXEMPT_SHIFT;
    }
  }

  if (!staffId) {
    if (kind) {
      res.status(403).json({ ok: false, error: "forbidden",
        message: `this endpoint requires an active staff shift; ${kind} sessions do not clock in` });
      return null;
    }
    res.status(401).json({ ok: false, error: "unauthorized" });
    return null;
  }

  const shift = await attachShift(req, opts);
  if (!shift) {
    if (req.shiftUnavailable) {
      // Ours, not theirs. 503 + db:"down" is the shape public/app/data.js reads
      // as an outage (it keys on the status and the db flag, not on the error
      // string), so the screen says "backend unavailable" rather than telling a
      // clocked-in employee to clock in.
      res.status(503).json({ ok: false, error: "shift_unavailable", db: "down" });
      return null;
    }
    res.status(403).json({ ok: false, error: "no_active_shift",
      message: "clock in to start a shift before using this" });
    return null;
  }
  return shift;
}

export default requireActiveShift;
