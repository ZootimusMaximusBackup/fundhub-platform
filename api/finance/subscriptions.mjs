// /api/finance/subscriptions — the plan a client is on, and the version chain
// behind it.
//
//   GET  ?client_id=<uuid>                     → { ok, current, history }
//   POST { action: "start",   client_id, tier, price_cents, currency?, notes? }
//   POST { action: "change",  client_id, tier, price_cents, currency?, notes? }
//   POST { action: "cancel",  client_id, at?, ends_at? }
//
// *** SCAFFOLD STUB — TRACK 1 OWNS THIS FILE. ***
// The auth, the role gate, the org scoping, the method switch and the error
// mapping below are FINISHED and are the contract. Track 1 replaces the bodies
// marked `not_implemented` and nothing else. Do not widen SUBSCRIPTION_ROLES and
// do not take org_id or client ownership from the request — see below.
//
// THE MODULE BEHIND THIS DOES NOT CHARGE ANYBODY. src/subscriptions/store.mjs
// opens with that sentence and means it: there is no processor call, no
// scheduler and no billing run anywhere behind this endpoint. Starting a
// subscription here RECORDS what a client is on. A billing run is a payment-rail
// change and needs compliance review before a line of it exists.
//
// ORG COMES FROM THE SESSION, ALWAYS. Every store function in
// src/subscriptions/store.mjs takes `orgId` as a required argument and throws
// without one, so the only question this file answers is WHERE that value comes
// from. It comes from `staff.org_id` and from nowhere else. A body field that
// chose the org would file one company's subscription — and one company's price
// — in another company's table, which is the same class of hole api/shifts.mjs
// refuses a body `org_id` to avoid.
//
// AND THE CLIENT MUST BE IN THAT ORG. An org-scoped write with an unchecked
// client_id still writes a row about a person this company has no relationship
// with. ownsClient() below is the same check api/finance/soft-pull.mjs:144
// makes, for the same reason, and it is not optional.
//
// SubscriptionConflictError CARRIES ITS OWN STATUS (409). Two of the refusals in
// the store are "the record moved under you, look again" and not "the server
// broke"; without the mapping in the catch below they would reach the caller as
// a 500 through netlify/functions/api.mjs:334. See the class docblock at
// src/subscriptions/store.mjs:44.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { SubscriptionConflictError } from "../../src/subscriptions/store.mjs";

/* ROLE_SETS.FINANCE — {owner, admin}. A subscription row carries a price, and
   price is comp-adjacent money the STAFF set does not see anywhere else in this
   API. Widening this is a decision with a sentence attached, not a convenience.
   Whatever it becomes, the screen's row in public/app/shell.js OWNER_ADMIN_ONLY
   has to move with it or the app offers a screen its data refuses. */
const SUBSCRIPTION_ROLES = ROLE_SETS.FINANCE;

/* Fields the session owns. Present in a body ⇒ 400, never merged, never
   silently dropped — api/shifts.mjs:44 explains why ignoring beats nothing and
   refusing beats ignoring. */
const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // A SECOND CALL, DELIBERATELY. requireAuth forwards opts to authenticate(),
  // which reads only { db, env } — passing { roles } to it does nothing at all
  // and has already shipped one hole (see the read/tradelines note in
  // netlify/functions/api.mjs:114). The gate is this line.
  if (!requireRole(res, staff, SUBSCRIPTION_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) {
    // FAIL CLOSED. A session with no company cannot be scoped to one, and the
    // alternatives are both worse: picking a default org files the row under
    // the wrong company, and omitting the filter reads every company's rows.
    return res.status(403).json({ ok: false, error: "org_required" });
  }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      // TODO(track 1): getSubscriptionAt(db, { orgId, clientId }) for `current`
      // and listSubscriptions(db, { orgId, clientId }) for the version chain.
      return res.status(501).json({ ok: false, error: "not_implemented" });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }
      if (!isUuid(body.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, body.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      switch (body.action) {
        case "start":
          // TODO(track 1): startSubscription(db, { orgId, clientId, tier, priceCents, ... }).
          return res.status(501).json({ ok: false, error: "not_implemented" });
        case "change":
          // TODO(track 1): changeTier(db, { orgId, clientId, tier, priceCents, ... }).
          return res.status(501).json({ ok: false, error: "not_implemented" });
        case "cancel":
          // TODO(track 1): cancelSubscription(db, { orgId, clientId, at, endsAt }).
          return res.status(501).json({ ok: false, error: "not_implemented" });
        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    // The store says what the status is, because it is the only thing that
    // knows which rule was broken. 409 means "somebody else got here first".
    if (e instanceof SubscriptionConflictError) {
      return res.status(e.status).json({ ok: false, error: e.message });
    }
    if (e instanceof TypeError) {
      // The store's required() throws TypeError for a missing argument. That is
      // the CALLER's omission, not a fault.
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    throw e;
  }
}

/* ownsClient — this company's client, or nobody's. The org is CHECKED against
   the clients table rather than assumed from the caller having sent an id.
   Same shape as api/finance/soft-pull.mjs:144. */
async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}
