// TCPA opt-out helpers. All three functions are the only sanctioned path to
// read/write opt_outs so the send-path guard and inbound handler stay in sync.

export async function recordOptOut(db, clientId, orgId, channel, source = "inbound_keyword") {
  await db.query(
    `INSERT INTO opt_outs (client_id, org_id, channel, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id, channel) DO UPDATE
       SET opted_out_at = now(), opted_in_at = NULL, source = EXCLUDED.source`,
    [clientId, orgId, channel, source]
  );
}

export async function recordOptIn(db, clientId, channel) {
  await db.query(
    `UPDATE opt_outs SET opted_in_at = now() WHERE client_id = $1 AND channel = $2`,
    [clientId, channel]
  );
}

// Returns true if the contact is currently opted out (row exists AND opted_in_at is NULL).
export async function isOptedOut(db, clientId, channel) {
  const r = await db.query(
    `SELECT 1 FROM opt_outs WHERE client_id = $1 AND channel = $2 AND opted_in_at IS NULL LIMIT 1`,
    [clientId, channel]
  );
  return r.rows.length > 0;
}
