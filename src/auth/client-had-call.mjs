// Whether a client has already been on a sales call.
//
// Source of truth: a row in call_outcomes for that org + client_id. Closers
// write that row when they log a held call (db/migrations/147_call_outcomes.sql).
//
// outbound_calls is NOT used. That table records Bland AI dispatch and never
// updates status past the default 'initiated' (src/lib/outbound-calls.mjs),
// so a completed/done check would be fiction.

/**
 * @param {object} db
 * @param {{ orgId?: string|null, clientId?: string|null }} opts
 * @returns {Promise<{ had_call: boolean, had_call_at: string|null }>}
 */
export async function clientHadCall(db, { orgId, clientId } = {}) {
  if (!db || !orgId || !clientId) {
    return { had_call: false, had_call_at: null };
  }
  try {
    const r = await db.query(
      `SELECT logged_at
         FROM call_outcomes
        WHERE org_id = $1 AND client_id = $2
        ORDER BY logged_at DESC
        LIMIT 1`,
      [orgId, clientId]
    );
    const row = r.rows[0];
    if (!row || !row.logged_at) {
      return { had_call: false, had_call_at: null };
    }
    const at = row.logged_at instanceof Date
      ? row.logged_at.toISOString()
      : String(row.logged_at);
    return { had_call: true, had_call_at: at };
  } catch {
    // Session must still answer. Unknown is treated as no call so the
    // pre-call greeting can still open.
    return { had_call: false, had_call_at: null };
  }
}
