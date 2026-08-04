/* AI bureau IVR routing config — editable from CRM. Ships empty. */

const WRITABLE = new Set([
  "bureau_code", "bureau_name", "service_number", "ivr_version", "menu_path",
  "expected_hold_minutes", "transfer_phrase", "hours_of_operation",
  "retry_limit", "retry_delay_minutes", "active", "notes",
  "last_verified_at", "last_verified_by"
]);

function publicRow(row) {
  if (!row) return null;
  const out = { ...row };
  if (out.expected_hold_minutes != null) out.expected_hold_minutes = Number(out.expected_hold_minutes);
  if (out.retry_limit != null) out.retry_limit = Number(out.retry_limit);
  if (out.retry_delay_minutes != null) out.retry_delay_minutes = Number(out.retry_delay_minutes);
  out.active = out.active !== false;
  return out;
}

export async function listAiBureauConfig(db, { orgId }) {
  const r = await db.query(
    `SELECT *
       FROM ai_bureau_config
      WHERE org_id = $1::uuid
      ORDER BY bureau_code`,
    [orgId]
  );
  return r.rows.map(publicRow);
}

export async function upsertAiBureauConfig(db, { orgId, row, staff }) {
  const code = String(row?.bureau_code || "").trim().toUpperCase();
  const name = String(row?.bureau_name || "").trim();
  if (!code || !name) {
    const err = new Error("bureau_code and bureau_name required");
    err.code = "bureau_required";
    throw err;
  }

  const existing = await db.query(
    `SELECT id FROM ai_bureau_config
      WHERE org_id = $1::uuid AND bureau_code = $2
      LIMIT 1`,
    [orgId, code]
  );

  if (existing.rows[0]) {
    return updateAiBureauConfig(db, {
      orgId,
      id: existing.rows[0].id,
      patch: { ...row, bureau_code: code, bureau_name: name },
      staff
    });
  }

  const r = await db.query(
    `INSERT INTO ai_bureau_config (
       org_id, bureau_code, bureau_name, service_number, ivr_version, menu_path,
       expected_hold_minutes, transfer_phrase, hours_of_operation,
       retry_limit, retry_delay_minutes, active, notes,
       last_verified_by
     ) VALUES (
       $1::uuid, $2, $3, $4, $5, $6,
       $7, $8, $9,
       COALESCE($10, 3), COALESCE($11, 30), COALESCE($12, true), $13,
       $14
     ) RETURNING *`,
    [
      orgId,
      code,
      name,
      row.service_number || null,
      row.ivr_version || null,
      row.menu_path || null,
      row.expected_hold_minutes != null ? Number(row.expected_hold_minutes) : null,
      row.transfer_phrase || null,
      row.hours_of_operation || null,
      row.retry_limit != null ? Number(row.retry_limit) : null,
      row.retry_delay_minutes != null ? Number(row.retry_delay_minutes) : null,
      row.active === false || row.active === "false" ? false : true,
      row.notes || null,
      staff ? String(staff.name || staff.email || staff.id || "").slice(0, 200) : null
    ]
  );
  return publicRow(r.rows[0]);
}

export async function updateAiBureauConfig(db, { orgId, id, patch, staff }) {
  const sets = [];
  const params = [orgId, id];
  for (const [k, v] of Object.entries(patch || {})) {
    if (!WRITABLE.has(k)) continue;
    let val = v;
    if (k === "active") val = v === true || v === "true" || v === 1;
    if (k === "bureau_code") val = String(v || "").trim().toUpperCase();
    if (["expected_hold_minutes", "retry_limit", "retry_delay_minutes"].includes(k) && v != null && v !== "") {
      val = Number(v);
    }
    params.push(val);
    if (k === "last_verified_at") sets.push(`${k} = $${params.length}::timestamptz`);
    else sets.push(`${k} = $${params.length}`);
  }
  if (staff && patch?.mark_verified) {
    params.push(new Date().toISOString());
    sets.push(`last_verified_at = $${params.length}::timestamptz`);
    params.push(String(staff.name || staff.email || staff.id || "").slice(0, 200));
    sets.push(`last_verified_by = $${params.length}`);
  }
  if (!sets.length) {
    const cur = await db.query(
      `SELECT * FROM ai_bureau_config WHERE org_id = $1::uuid AND id = $2::uuid`,
      [orgId, id]
    );
    return publicRow(cur.rows[0] || null);
  }
  const r = await db.query(
    `UPDATE ai_bureau_config
        SET ${sets.join(", ")}, updated_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid
      RETURNING *`,
    params
  );
  return publicRow(r.rows[0] || null);
}
