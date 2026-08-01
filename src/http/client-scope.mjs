// requireClientInOrg — the org boundary for every endpoint that serves ONE named
// client's financial detail.
//
// *** THE HOLE THIS CLOSES. ***
//
// Three endpoints took a client_id from the query string and read that client's
// money without ever checking which company the caller belonged to:
//
//   api/read/banking-surface.mjs   SELECT ... FROM bank_accounts WHERE client_id = $1
//   api/read/finance-os.mjs        listTradelines(db, { clientId })
//   api/read/tradelines.mjs        listTradelines(db, { clientId })
//
// All three are gated on ROLE_SETS.STAFF, so the effective rule was: any
// authenticated employee of ANY company could read ANY client's bank balances,
// credit limits, utilisation and APRs, given only that client's id. The role gate
// looked like the control and was not one — it answers "are you staff", never
// "are they yours".
//
//
// *** WHY THE CHECK IS ON THE CLIENT AND NOT ON EACH TABLE. ***
//
// The obvious fix is to add `AND org_id = $2` to each query. It is the wrong
// place here, for one specific reason: two of the three read through
// listTradelines() in src/tradelines/, and that module is on the CRS path, which
// is live, compliant, and explicitly not to be modified. Changing a shared read
// used by the credit-report pipeline to close a hole in a dashboard endpoint is
// a large blast radius for a small fix.
//
// Every one of these endpoints answers the same shape of question — "show me
// everything about THIS PERSON" — so the boundary that matters is whether the
// person belongs to the caller's company. Check it once, up front, and every
// downstream read is inside the boundary by construction. One query, three call
// sites, nothing in src/tradelines/ touched.
//
// This does NOT replace per-table org scoping where it already exists.
// src/banking/accounts.mjs still binds org_id into every WHERE and every INSERT,
// and should: defence in depth is the point, and a future endpoint that lists
// across clients needs the table-level filter because there is no single client
// to check.
//
//
// *** 404, NOT 403. ***
//
// A caller from another company gets "no such client", identical to the answer
// for an id that never existed. 403 would confirm the client is real and simply
// not theirs, which turns the endpoint into an oracle: feed it ids, read the
// status codes, and learn your competitor's client list without ever seeing a
// balance. api/banking/accounts.mjs makes the same call for the same reason.
//
// FAILS CLOSED ON A SESSION WITH NO ORG. `org_id = NULL` matches no row in
// Postgres, so a session without an org already finds nothing — but that is an
// emergent property of the query, and an emergent protection is one refactor away
// from being gone. It is refused explicitly.

/**
 * requireClientInOrg(res, db, staff, clientId) → true if the request may proceed,
 * else writes the refusal and returns false.
 *
 * Mirrors requireRole()'s shape exactly, so call sites read the same way:
 *
 *     if (!await requireClientInOrg(res, db, staff, clientId)) return;
 */
export async function requireClientInOrg(res, db, staff, clientId) {
  if (!staff || !staff.org_id) {
    res.status(403).json({ ok: false, error: "no_org_on_session" });
    return false;
  }

  const found = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, staff.org_id]
  );

  if (found.rows.length === 0) {
    // Deliberately indistinguishable from "no such id". See the header.
    res.status(404).json({ ok: false, error: "not_found" });
    return false;
  }

  return true;
}

export default requireClientInOrg;
