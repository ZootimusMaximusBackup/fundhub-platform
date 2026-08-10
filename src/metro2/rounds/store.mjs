// Thin DB helpers for dispute_* tables. Pure SQL — no clock in business logic beyond DEFAULT now().

export async function createCase(db, {
  orgId, clientId, bureau, round = "R1", pipelineCardId = null, responseDueAt = null
}) {
  const r = await db.query(
    `INSERT INTO dispute_cases (org_id, client_id, bureau, round, pipeline_card_id, response_due_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [orgId, clientId, bureau, round, pipelineCardId, responseDueAt]
  );
  return r.rows[0];
}

export async function insertItems(db, caseRow, items = []) {
  const out = [];
  for (const it of items) {
    const r = await db.query(
      `INSERT INTO dispute_items
         (case_id, org_id, client_id, rule_id, severity, field, creditor, account_last4, round, violation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
      [
        caseRow.id, caseRow.org_id, caseRow.client_id,
        it.ruleId, it.severity, it.field, it.creditor || null, it.account_last4 || null,
        caseRow.round, JSON.stringify(it)
      ]
    );
    out.push(r.rows[0]);
  }
  return out;
}

export async function saveLetter(db, {
  caseId, orgId, clientId, bureau, round, bodyText, fingerprint, ruleIds, status = "generated"
}) {
  const r = await db.query(
    `INSERT INTO dispute_letters
       (case_id, org_id, client_id, bureau, round, status, body_text, fingerprint, rule_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [caseId, orgId, clientId, bureau, round, status, bodyText, fingerprint || [], ruleIds || []]
  );
  return r.rows[0];
}

export async function logDecision(db, { orgId, clientId, caseId, decision, payload }) {
  await db.query(
    `INSERT INTO repair_decision_log (org_id, client_id, case_id, decision, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [orgId, clientId || null, caseId || null, decision, JSON.stringify(payload || {})]
  );
}

export async function findFurnisherAddress(db, name, orgId = null) {
  const norm = String(name || "").trim().toLowerCase();
  const r = await db.query(
    `SELECT * FROM furnisher_mail_addresses
      WHERE active AND name_norm = $1 AND (org_id IS NULL OR org_id = $2)
      ORDER BY org_id NULLS LAST LIMIT 1`,
    [norm, orgId]
  );
  return r.rows[0] || null;
}
