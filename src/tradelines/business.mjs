/* Business credit tradelines — mirror of personal tradelines pattern for CRS biz pulls. */

export async function listBusinessTradelines(db, { orgId, clientId, snapshotId = null }) {
  const params = [orgId, clientId];
  let sql = `SELECT *
               FROM business_tradelines
              WHERE org_id = $1::uuid AND client_id = $2::uuid`;
  if (snapshotId) {
    params.push(snapshotId);
    sql += ` AND snapshot_id = $${params.length}::uuid`;
  }
  sql += ` ORDER BY creditor_name, id`;
  const r = await db.query(sql, params);
  return r.rows.map((row) => ({
    ...row,
    balance: row.balance != null ? Number(row.balance) : null,
    dbt: row.dbt != null ? Number(row.dbt) : null,
    utilization_pct: row.utilization_pct != null ? Number(row.utilization_pct) : null
  }));
}

export async function upsertBusinessTradeline(db, { orgId, row }) {
  if (!row?.client_id || !row?.creditor_name) {
    const err = new Error("client_id and creditor_name required");
    err.code = "biz_tradeline_args";
    throw err;
  }
  const r = await db.query(
    `INSERT INTO business_tradelines (
       org_id, client_id, snapshot_id, creditor_name, account_type,
       balance, dbt, utilization_pct, source, source_ref, raw
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5,
       $6, $7, $8, COALESCE($9, 'crs'), $10::uuid, COALESCE($11::jsonb, '{}'::jsonb)
     ) RETURNING *`,
    [
      orgId,
      row.client_id,
      row.snapshot_id || null,
      String(row.creditor_name).trim(),
      row.account_type || null,
      row.balance != null ? Number(row.balance) : null,
      row.dbt != null ? Number(row.dbt) : null,
      row.utilization_pct != null ? Number(row.utilization_pct) : null,
      row.source || "crs",
      row.source_ref || null,
      row.raw ? JSON.stringify(row.raw) : "{}"
    ]
  );
  return r.rows[0];
}
