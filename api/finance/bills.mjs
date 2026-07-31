// /api/finance/bills — the recurring bills detected from a client's bank
// transactions, and the button that re-runs the detector.
//
//   GET  ?client_id=<uuid>[&bank_account_id=][&include_candidates=1]
//        → { ok, bills, candidates }
//   GET  ?bill_id=<uuid>                → { ok, evidence }  the charges behind one bill
//   POST { action: "redetect", client_id[, bank_account_id] }
//        → { ok, bills, candidates, evidenceLinked, ... }
//
// *** SCAFFOLD STUB — TRACK 4 OWNS THIS FILE (with cashflow.mjs). ***
// Auth, role gate, org scoping, method switch and error mapping are finished and
// are the contract. Track 4 replaces the `not_implemented` bodies.
//
// *** A CANDIDATE IS NOT A BILL, AND THE TWO MUST NOT SHARE A RENDERING. ***
// detectRecurringBills() returns four lists and they mean different things:
//   bills       medium/high confidence — safe to present as a bill
//   candidates  LOW confidence — stored, but MUST NOT be presented as a bill
//   rejected    no usable cadence was found; never stored, nothing to show
//   excluded    individual input rows that could not be read
// listRecurringBills() defaults `presentableOnly: true` and that default is the
// safety rail: a caller who has not thought about confidence gets only the rows
// that are safe to show a person. `include_candidates=1` is a deliberate act
// with a name attached, and the screen must label what it then draws.
//
// *** TWO VOCABULARIES, AND MIXING THEM FAILS SILENTLY. ***
//   listRecurringBills()    → raw snake_case database rows
//   listRecurringBillsFor() → camelCase, via fromBillRow(), with next_expected_on
//                             RENAMED to nextExpectedDate
// Feeding raw rows to the cash-flow seam threw nothing and produced a client
// with NO BILLS AT ALL — which reads as "you are fine" rather than "we could not
// read your bills". The whole account is at src/banking/recurring.mjs:1169. Use
// listRecurringBillsFor() for anything heading into a projection, and
// listRecurringBills() for anything heading at a screen that expects columns.
//
// *** `now` IS REQUIRED AND HAS NO DEFAULT. *** detectRecurringBills() throws
// without it: "an answer that depends on when it ran cannot be tested or
// audited". Pass an explicit instant on the redetect path.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";

/* ROLE_SETS.FINANCE — {owner, admin}. These rows are derived from bank
   transactions and are exactly as sensitive as the balances
   api/read/banking-surface.mjs already gates this way. bills-cashflow.html sits
   in public/app/shell.js OWNER_ADMIN_ONLY to match. */
const BILL_ROLES = ROLE_SETS.FINANCE;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key.
  if (!requireRole(res, staff, BILL_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "GET") {
      const q = req.query || {};

      if (isUuid(q.bill_id)) {
        if (!(await ownsBill(orgId, q.bill_id))) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
        // TODO(track 4): getBillEvidence(db, billId) — the transactions behind one
        // detected bill, oldest first. This is the "show me the four charges that
        // made you say this" read, and it is what a human uses to check a
        // detected bill by hand before trusting it. NOTE: getBillEvidence takes
        // no orgId and filters on none, which is why the check above runs first.
        return res.status(501).json({ ok: false, error: "not_implemented" });
      }

      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id or bill_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      // TODO(track 4): listRecurringBills(db, { orgId, clientId, bankAccountId,
      // presentableOnly }). orgId is REQUIRED by that function and it throws
      // without one, which is the guarantee this endpoint leans on.
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
        case "redetect":
          // TODO(track 4): read the client's bank_transactions (scoped by org AND
          // client), run detectRecurringBills(rows, { now: new Date(), accountIds })
          // and persist with saveDetection(db, result, { orgId }).
          //
          // saveDetection is UPSERT-based on purpose: detection is a standing
          // inference that gets recomputed, and without the upsert running this
          // weekly would leave fifty-two rows for one subscription and any SUM
          // over the table would report the client's outgoings at fifty-two times
          // their true value (src/banking/store.mjs:100).
          //
          // Pass the shared `db` handle. saveDetection reaches for the pool
          // behind it so the bill and its evidence land in ONE transaction; a
          // half-written detection asserts a client pays $54.99 a month with
          // nothing behind it, which is worse than not writing it at all.
          return res.status(501).json({ ok: false, error: "not_implemented" });
        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) {
      // toBillRow() throws RangeError when a "bill" is not an outflow, and the
      // detector throws TypeError for a missing `now`. Both are the caller's.
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

async function ownsBill(orgId, billId) {
  const r = await db.query(
    `SELECT 1 FROM recurring_bills WHERE id = $1 AND org_id = $2`,
    [String(billId).trim(), orgId]
  );
  return r.rows.length > 0;
}
