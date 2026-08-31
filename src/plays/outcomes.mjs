/* Bank / file yes-no for later plays.
   Not a model. Not a chatbot. Not the play-name stamp (that write is
   setApplicationStatus). This is the read later plays import. */

export const YES_STATUSES = new Set(["Approved"]);
export const NO_STATUSES = new Set(["Denied"]);

export function outcomeFromStatus(status) {
  const s = String(status || "").trim();
  if (YES_STATUSES.has(s)) return "yes";
  if (NO_STATUSES.has(s)) return "no";
  return null;
}

/**
 * Past bank yes/no later plays can read. Includes rows with no play name.
 *
 * @param {import("pg").Pool|object} db
 * @param {{ orgId: string, clientId?: string|null, limit?: number }} opts
 */
export async function listOutcomesForLaterPlays(db, { orgId, clientId = null, limit = 200 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const params = [orgId];
  let clientClause = "";
  if (clientId) {
    params.push(clientId);
    clientClause = `AND a.client_id = $${params.length}::uuid`;
  }
  params.push(lim);
  const r = await db.query(
    `SELECT
        d.id,
        d.application_id,
        d.status,
        d.play_name,
        d.decided_at,
        a.client_id,
        a.lender_id,
        COALESCE(NULLIF(btrim(a.lender_name), ''), NULLIF(btrim(a.bank), '')) AS bank
       FROM application_decisions d
       JOIN applications a ON a.id = d.application_id AND a.org_id = d.org_id
      WHERE d.org_id = $1::uuid
        AND d.status IN ('Approved', 'Denied')
        ${clientClause}
      ORDER BY d.decided_at DESC
      LIMIT $${params.length}`,
    params
  );
  return r.rows.map((row) => ({
    ...row,
    outcome: outcomeFromStatus(row.status)
  }));
}
