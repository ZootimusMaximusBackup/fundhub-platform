// /api/finance/liabilities — what a client owes on each card, and the series
// behind it.
//
//   GET  ?client_id=<uuid>                        → { ok, positions }  current per card
//   GET  ?tradeline_id=<uuid>[&limit=]            → { ok, history }    one card's series
//   POST { action: "upsert", client_id, tradeline_id, as_of, ... }
//
// *** SCAFFOLD STUB — TRACK 2 OWNS THIS FILE. ***
// Auth, role gate, org scoping, method switch and error mapping are finished and
// are the contract. Track 2 replaces the `not_implemented` bodies.
//
// *** THE ONE THING TRACK 2 MUST NOT SKIP. ***
// src/liabilities/store.mjs's THREE READ FUNCTIONS TAKE NO orgId AND FILTER ON
// NONE. Read them:
//
//   getCurrentLiability(db, { tradelineId })   → WHERE tradeline_id = $1
//   getCurrentLiabilities(db, { clientId })    → WHERE client_id = $1
//   getLiabilityHistory(db, { tradelineId | clientId }) → the same
//
// Every one of those takes an id straight off the query string and matches on it
// alone. An id is not an authorisation to read a row. With one company in the
// database nothing leaks; the day a second exists, an employee of company A
// passes company B's tradeline_id and reads that consumer's balances, minimum
// payments and payment status. That is finding C1 in a different table.
//
// SO THE OWNERSHIP CHECK BELOW IS THE ORG FILTER, and it runs BEFORE any store
// call. It is not belt-and-braces and it is not a nicety — it is the only thing
// standing between this endpoint and cross-tenant reads, because the store will
// not do it. If Track 2 adds an org filter inside the store instead, keep this
// check as well: two guards on a cross-tenant read is the correct number.
//
// NULL IS UNKNOWN AND MUST SURVIVE TO THE SCREEN. A missing minimum payment, a
// missing balance and a missing APR are written as NULL by the store, on
// purpose, and nothing here may COALESCE one to 0. "We do not know what this
// client owes" and "this client owes nothing" are opposite facts about somebody's
// money and only one of them is a claim. card-stack.html renders unknown as an
// em dash, never as 0.00.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";

/* ROLE_SETS.STAFF — the same gate api/read/tradelines.mjs carries, and for the
   same reason: this is the balance half of the card rows that endpoint already
   serves to that set, and gating the two differently would leave a closer able
   to see a limit but not what is drawn against it while working one file. */
const LIABILITY_ROLES = ROLE_SETS.STAFF;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key.
  if (!requireRole(res, staff, LIABILITY_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "GET") {
      const q = req.query || {};

      if (isUuid(q.tradeline_id)) {
        if (!(await ownsTradeline(orgId, q.tradeline_id))) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
        // TODO(track 2): getLiabilityHistory(db, { tradelineId, limit }) — newest
        // first. An empty array is a card with no observations, which is NOT a
        // zero balance and must not be rendered as one.
        return res.status(501).json({ ok: false, error: "not_implemented" });
      }

      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id or tradeline_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      // TODO(track 2): getCurrentLiabilities(db, { clientId }) — one row per card,
      // most urgent first, unknown due dates sorted LAST.
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
      if (!isUuid(body.tradeline_id)) {
        return res.status(400).json({ ok: false, error: "tradeline_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, body.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      if (!(await ownsTradeline(orgId, body.tradeline_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      switch (body.action) {
        case "upsert":
          // TODO(track 2): recordLiability(db, { orgId, clientId, tradelineId, row }).
          // `row.as_of` is REQUIRED and the call throws without it — as_of is when
          // the position was true, and the projection refuses to move backwards
          // on it, so a hand-entered position with no date cannot be placed in
          // the series at all.
          //
          // PASS THE SHARED `db` HANDLE, NOT A POOL YOU OPEN. recordLiability
          // swaps the shared singleton for its pool internally so its three
          // writes land in one real transaction (src/liabilities/store.mjs:134).
          // Handing it anything else silently loses that.
          return res.status(501).json({ ok: false, error: "not_implemented" });
        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof TypeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
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

/* ownsTradeline — the card belongs to a client of THIS company. Joined through
   clients rather than trusting a tradelines.org_id, so the answer is the same
   one ownsClient gives and there is one definition of "ours" in this file. */
async function ownsTradeline(orgId, tradelineId) {
  const r = await db.query(
    `SELECT 1
       FROM tradelines t
       JOIN clients c ON c.id = t.client_id
      WHERE t.id = $1 AND c.org_id = $2`,
    [String(tradelineId).trim(), orgId]
  );
  return r.rows.length > 0;
}
