// /api/shifts — the clock. A staff member starts and ends their own shift.
//
//   GET  /api/shifts                          → { ok, shift }   the caller's open shift, or null
//   POST /api/shifts { action: "clock_in"  }  → { ok, shift }
//   POST /api/shifts { action: "clock_out" }  → { ok, shift }
//
// WHO IS CLOCKING IN IS NOT A REQUEST PARAMETER. `staff_id` and `org_id` are
// read off the session principal and never off the body. That is the whole
// security surface of this endpoint: shifts are the hours record, so a body
// field that chose the staff_id would let any signed-in employee write hours
// onto somebody else's timesheet — or, with an org_id of their choosing, into
// another tenant's table entirely.
//
// A BODY THAT CARRIES staff_id IS REFUSED, NOT IGNORED. Silently dropping the
// field is the more forgiving behaviour and the worse one: a caller that sent
// it believed it did something, and a 200 confirms that belief. Whatever wrote
// that request — a stale client, a copied curl, an integration built against a
// different endpoint — is wrong about how this one works, and it should find
// out at the point of the mistake rather than after a week of hours have been
// filed under the wrong person. Same for org_id.
//
// EVERY ROW-LEVEL DECISION LIVES IN src/shifts/store.mjs. No SQL here. The
// "one open shift per person" rule, the 409s, and the transaction that makes
// them race-safe are the store's job (and, underneath it, the unique index in
// db/migrations/060_shifts_one_open.sql); this file is the HTTP shell — auth,
// method, shape, status codes.
//
// NOT A readHandler. GET is the smaller half of this endpoint and the POST is
// the point, so it is hand-rolled like api/inquiries.mjs and api/pii.mjs. It
// also returns a single object rather than a page, which readHandler does not
// model.
import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { CLIENT_DATA_ERRORS } from "../src/http/read-api.mjs";
import { clockIn, clockOut, currentShift, listOpenRoster, ShiftError } from "../src/shifts/store.mjs";

/* Own properties only, and safe on a body that is not an object at all — a
   request sent without a JSON content-type arrives here as a raw string, and
   `"staff_id" in "…"` throws. Object() boxes it; a boxed string has no such
   own property, so a non-object body falls through to the action check and
   gets the invalid_action it deserves. */
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

// Fields the session owns. Present in a body ⇒ 400, never merged, never ignored.
const SESSION_OWNED = ["staff_id", "org_id"];

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff"], { db });
  if (!principal) return;

  // The only two identifiers this endpoint will ever use.
  const staffId = principal.staffId;
  const orgId = principal.orgId;

  try {
    if (req.method === "GET") {
      // ?roster=1 → everyone currently clocked in for this company.
      // Calendar coverage rail; not a timesheet export.
      if (req.query?.roster === "1" || req.query?.roster === "true") {
        const roster = await listOpenRoster(db, { orgId });
        return res.status(200).json({ ok: true, roster });
      }
      const shift = await currentShift(db, { staffId });
      // `null` explicitly, not an omitted key: "you are not on shift" is an
      // answer, and a caller reading body.shift must be able to tell it from a
      // response shape it did not understand.
      return res.status(200).json({ ok: true, shift: shift ?? null });
    }

    if (req.method === "POST") {
      const body = req.body || {};

      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }

      switch (body.action) {
        case "clock_in":
          return res.status(200).json({ ok: true, shift: await clockIn(db, { orgId, staffId }) });
        case "clock_out":
          return res.status(200).json({ ok: true, shift: await clockOut(db, { staffId }) });
        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    // The store says what the status is — 409 for the two "already/not open"
    // cases — because it is the only thing that knows which rule was broken.
    if (e instanceof ShiftError) return res.status(e.status).json({ ok: false, error: e.message });
    if (CLIENT_DATA_ERRORS.has(e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    throw e;
  }
}
