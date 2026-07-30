// Partner scope, enforced at the database engine.
//
// src/partners/scope.mjs builds the WHERE clause. This module is the second lock:
// it opens a transaction, tells Postgres who is acting, and hands back a client
// whose every query is filtered by the RLS policies that 045 installed. A query
// that forgets its scope predicate returns nothing instead of everything.
//
// WHY BOTH. scope.mjs can only protect a query that remembers to call it. RLS
// protects the query that forgets — including a raw db.query() written in a hurry
// eight months from now, and including one written correctly against the wrong
// partner id. Belt and braces, deliberately, because the spec names cross-partner
// disclosure as the worst bug this module can produce.
//
// SET LOCAL, VIA set_config. `SET LOCAL fundhub.partner_id = $1` is not
// parameterisable — SET takes a literal — so the only safe form is
// set_config(name, value, is_local=true). Interpolating a uuid into a SET
// statement is exactly the injection this codebase already refuses to write
// (see scope.mjs's "PARAMETERISED, NEVER INTERPOLATED").
//
// TRANSACTION-SCOPED, NOT SESSION-SCOPED. is_local=true means the setting dies
// with the transaction. That matters because src/db.mjs is a POOL: a session-level
// SET would outlive the request and leak one partner's scope into whichever
// request next borrowed that connection. That failure mode is silent, intermittent
// and would be catastrophic, so there is no session-scoped option here.
//
// THE UUID IS VALIDATED BEFORE IT REACHES THE GUC. fundhub_current_partner()
// casts the setting to uuid; garbage in there turns every query in the
// transaction into a cast error rather than a clean deny. Validating here keeps
// the failure legible and at the call site that caused it.

import { pool as defaultPool } from "../db.mjs";
import { PRINCIPAL_KINDS } from "./scope.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* scopeContext(principal) → { actor, partnerId }

   Same contract as scopeFor(): a principal is required, an unknown kind throws,
   and a partner without a partnerId throws. An unscoped partner is the exact
   shape of the leak, so it is never allowed to become "sees nothing" by accident
   — that would hide a broken session instead of surfacing it. */
export function scopeContext(principal) {
  if (!principal || typeof principal !== "object") {
    throw new Error("withPartnerScope: a principal is required — refusing to open an unscoped transaction");
  }
  const kind = String(principal.kind || "").trim().toLowerCase();
  if (!PRINCIPAL_KINDS.has(kind)) {
    throw new Error(
      `withPartnerScope: unknown principal kind "${principal.kind}". ` +
      `Refusing to guess — an unrecognised actor must not default to seeing everything.`
    );
  }

  if (kind === "staff") {
    // fundhub staff cross the boundary by design, matching scope.mjs's staff
    // branch. Named here so it is a decision in the code, not an absent filter.
    return { actor: "staff", partnerId: null };
  }

  if (kind !== "partner") {
    throw new Error(
      `withPartnerScope: a "${kind}" principal does not read the partner module. ` +
      `Use its own scoped surface.`
    );
  }

  const partnerId = principal.partnerId || principal.partner_id || null;
  if (!partnerId) {
    throw new Error(
      "withPartnerScope: partner principal has no partnerId — refusing to open a " +
      "transaction that would read another partner's rows"
    );
  }
  if (!UUID_RE.test(String(partnerId))) {
    throw new Error(`withPartnerScope: partnerId "${partnerId}" is not a uuid`);
  }
  return { actor: "partner", partnerId: String(partnerId) };
}

/* withPartnerScope(principal, fn, deps) → fn's return value

   Opens one transaction, stamps the actor onto it, and calls fn with a
   db-shaped { query } bound to that connection. Commits on return, rolls back on
   throw, always releases.

     const kits = await withPartnerScope(partnerPrincipal(id), (tx) =>
       tx.query(`SELECT * FROM brand_kits`).then((r) => r.rows));

   Note what the SQL above does NOT contain: a partner_id filter. Inside this
   callback it is redundant — the policy applies it. Outside, the same query
   returns zero rows. Writing the predicate anyway is still encouraged (use
   scope.mjs) so the intent is legible and so the query is correct if a policy is
   ever dropped. */
export async function withPartnerScope(principal, fn, { pool = defaultPool } = {}) {
  if (typeof fn !== "function") throw new Error("withPartnerScope: a callback is required");
  const { actor, partnerId } = scopeContext(principal);

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    // Empty string rather than NULL for the staff case: set_config rejects NULL,
    // and both helpers in 045 treat '' as unset via nullif().
    await client.query("SELECT set_config('fundhub.actor', $1, true)", [actor]);
    await client.query("SELECT set_config('fundhub.partner_id', $1, true)", [partnerId ?? ""]);

    const tx = {
      query: (sql, params) => client.query(sql, params),
      actor,
      partnerId
    };
    const out = await fn(tx);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* the original error is the one worth throwing */ }
    throw err;
  } finally {
    client.release();
  }
}

/* asPartner / asStaff — the two call forms, so a call site does not hand-roll a
   principal object and typo `partnerID`. Mirrors partnerPrincipal/staffPrincipal
   in scope.mjs. */
export const asPartner = (partnerId, fn, deps) =>
  withPartnerScope({ kind: "partner", partnerId }, fn, deps);
export const asStaff = (fn, deps) =>
  withPartnerScope({ kind: "staff" }, fn, deps);

export default withPartnerScope;
