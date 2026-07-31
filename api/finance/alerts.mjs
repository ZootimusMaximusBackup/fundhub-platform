// /api/finance/alerts — the raised-alert queue, the four rules that raise them,
// and the owner's trigger configuration.
//
//   GET  [?client_id=<uuid>][&limit=]        → { ok, alerts }   open queue, or one client's history
//   GET  ?view=triggers                      → { ok, triggers }
//   POST { action: "evaluate",    client_id }
//   POST { action: "set_trigger", rule, enabled, threshold_bps?, threshold_score?, severity? }
//   POST { action: "acknowledge" | "resolve" | "dismiss", alert_id[, reason] }
//
// *** SCAFFOLD STUB — TRACK 5 OWNS THIS FILE. ***
// Auth, role gate, org scoping, method switch and error mapping are finished and
// are the contract. Track 5 replaces the `not_implemented` bodies.
//
// *** THE FINDING THIS ENDPOINT EXISTS FOR. *** Before evaluateAndRaise() was
// written, setting a trigger to `enabled = true` changed nothing anywhere in the
// system — the configuration surface existed and nothing read it. This endpoint
// is the other half: without a route, evaluateAndRaise() is a function nobody
// can call, which is the same defect one layer up.
//
// *** NOTHING FIRES ON AN UNKNOWN AND NOTHING FIRES ON AN UNSET THRESHOLD. ***
// evaluateAndRaise returns `{ raised, skipped }` and every skip carries a reason:
// `threshold_unset`, `utilization_unknown`, `score_unknown`, `condition_false`.
// THE SCREEN MUST SHOW THE SKIPS. "No alerts" and "we could not tell" are
// different answers, and a queue that renders only `raised` reports the second
// as the first — it tells an owner their book is clean when the truth is that
// nobody has entered the numbers yet.
//
// *** READING AN ALERT CHANGES NOTHING. *** openAlerts() and alertsForClient()
// are SELECTs: no `surfaced_at` is stamped and no state moves. Acknowledging is
// a POST, deliberately, because reading is not acknowledging.
//
// *** THE ALERT TITLES ARE INTERNAL QUEUE TEXT AND MUST STAY THAT WAY. *** Each
// one restates numbers already on file and nothing else — no adjective about the
// client's credit, no recommendation, no projection. This is a regulated
// consumer-finance product and a claim about somebody's credit needs a human to
// sign it off. Do not render an alert title into anything customer-facing, and
// do not add wording to it here.
//
// *** SEPARATE THE TWO POST FAMILIES WHEN GATING. *** `evaluate`, `acknowledge`,
// `resolve` and `dismiss` are queue work. `set_trigger` is CONFIGURATION — it
// decides which of an owner's clients get flagged and on what number — and
// setTrigger() ships every rule OFF and UNSET on purpose (079's defaults), so a
// rule that arrived switched on would start flagging real clients' credit on a
// number nobody chose. TRIGGER_ROLES below is narrower than the read gate for
// exactly that reason.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, allowsRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { AlertError, TRIGGER_RULES, SEVERITIES } from "../../src/alerts/store.mjs";

/* ROLE_SETS.STAFF — the queue is operational work and the alerts restate
   utilization and score figures api/read/tradelines.mjs already serves to this
   set. alerts.html is in the shared staff surface to match. */
const ALERT_ROLES = ROLE_SETS.STAFF;

/* CONFIGURATION IS NARROWER. Changing a threshold changes who gets flagged
   across the whole book; that is an owner decision, not a queue action. */
const TRIGGER_ROLES = ROLE_SETS.FINANCE;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key.
  if (!requireRole(res, staff, ALERT_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "GET") {
      const q = req.query || {};

      if (q.view === "triggers") {
        // TODO(track 5): listTriggers(db, { orgId }) — every configured rule, on
        // or off. Show the unset ones too: a rule nobody has configured is a
        // rule that will never fire, and that is worth seeing.
        return res.status(501).json({ ok: false, error: "not_implemented" });
      }

      if (q.client_id !== undefined && q.client_id !== "") {
        if (!isUuid(q.client_id)) {
          return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
        }
        if (!(await ownsClient(orgId, q.client_id))) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
        // TODO(track 5): alertsForClient(db, { orgId, clientId, limit }).
        return res.status(501).json({ ok: false, error: "not_implemented" });
      }

      // TODO(track 5): openAlerts(db, { orgId, limit }) — the queue read.
      return res.status(501).json({ ok: false, error: "not_implemented" });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }

      switch (body.action) {
        case "evaluate": {
          if (!isUuid(body.client_id)) {
            return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
          }
          if (!(await ownsClient(orgId, body.client_id))) {
            return res.status(403).json({ ok: false, error: "forbidden" });
          }
          // TODO(track 5): read this client's tradelines and score, then
          // evaluateAndRaise(db, { orgId, clientId, tradelines, score, asOf }).
          //
          // PURE IN, ROWS OUT — it does not go and fetch anything itself, so the
          // reads are this endpoint's job and they must be org-scoped like every
          // other read here. `asOf` is when the underlying data was TRUE; NULL
          // means the source carried no as-of date, which is "unknown", not "now".
          // Return `skipped` alongside `raised`; see the header.
          return res.status(501).json({ ok: false, error: "not_implemented" });
        }

        case "set_trigger": {
          // The narrower gate, checked inline rather than at the top, because
          // this is the only action that needs it. allowsRole() is the same
          // predicate requireRole uses; the 403 body is written here so it can
          // name what was refused.
          if (!allowsRole(TRIGGER_ROLES, staff.role)) {
            return res.status(403).json({
              ok: false,
              error: "forbidden",
              message: "changing a trigger is limited to " + [...TRIGGER_ROLES].join(", ")
            });
          }
          if (!TRIGGER_RULES.includes(String(body.rule || ""))) {
            return res.status(400).json({
              ok: false, error: `rule must be one of ${TRIGGER_RULES.join(", ")}`
            });
          }
          if (body.severity !== undefined && !SEVERITIES.includes(String(body.severity))) {
            return res.status(400).json({
              ok: false, error: `severity must be one of ${SEVERITIES.join(", ")}`
            });
          }
          // TODO(track 5): setTrigger(db, { orgId, rule, enabled, thresholdBps,
          // thresholdScore, severity, notes, signedOffAt, signedOffBy }).
          // It upserts — one row per rule per org, because a second row would be
          // a second threshold and nothing could say which one applied.
          return res.status(501).json({ ok: false, error: "not_implemented" });
        }

        case "acknowledge":
        case "resolve":
        case "dismiss": {
          if (!isUuid(body.alert_id)) {
            return res.status(400).json({ ok: false, error: "alert_id must be a uuid" });
          }
          // TODO(track 5): acknowledgeAlert / resolveAlert / dismissAlert, each
          // (db, { orgId, alertId, ... }). All three are already org-scoped in
          // the store and all three distinguish "no such alert" from "already in
          // that state" — a 404 and a no-op are not the same answer, so pass
          // both through rather than collapsing them.
          return res.status(501).json({ ok: false, error: "not_implemented" });
        }

        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    // AlertError carries its own status: 400 for a missing argument, 409 for a
    // row that changed state mid-write.
    if (e instanceof AlertError) {
      return res.status(e.status || 400).json({ ok: false, error: e.message });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    throw e;
  }
}

async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}
