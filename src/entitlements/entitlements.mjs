// Entitlements — what a client has bought and may therefore access.
//
// The client portal cannot gate anything without this, and a locked tile is the
// upsell surface, so "what does this client NOT have" is as much a required
// answer as "what do they have". forClient() returns both.
//
// Everything here takes a db and plain values, in the style of src/lib and
// src/http: no HTTP layer, no live Postgres needed to reason about it.
//
// IDEMPOTENCE. grantFromTransaction() is safe to replay: the unique index on
// (org_id, client_id, entitlement_code, source_transaction_id) NULLS NOT DISTINCT
// absorbs a repeat, and the insert is ON CONFLICT DO NOTHING. Re-delivering the
// same payment grants nothing new; a genuine second purchase is a different
// transaction and so a different row.
//
// NOTHING HARD-DELETES. revoke() stamps revoked_at. A delivered document does not
// stop having been delivered, and "was this ever active" has to stay answerable.

/* forClient — the portal's read. Returns every catalogued entitlement with an
   `active` flag, so the caller can render owned and locked tiles from one query
   without deciding the expiry rules itself.

   { held: [...active], locked: [...never granted or no longer active], all: [...] } */
export async function forClient(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) throw new Error("forClient: orgId and clientId are required");

  const { rows } = await db.query(
    `SELECT c.code, c.name, c.description, c.kind, c.sort_order,
            e.granted_at, e.expires_at, e.revoked_at,
            COALESCE(e.active, false) AS active,
            e.source_transaction_id
       FROM entitlement_catalog c
       LEFT JOIN v_client_entitlements e
              ON e.org_id = c.org_id AND e.entitlement_code = c.code
             AND e.client_id = $2
      WHERE c.org_id = $1 AND c.active = true
      ORDER BY c.sort_order, c.code`,
    [orgId, clientId]
  );

  return {
    held: rows.filter((r) => r.active),
    locked: rows.filter((r) => !r.active),
    all: rows
  };
}

/* has — the single gate. One code, one boolean. Expiry and revocation are
   resolved in the view so no caller re-implements them. */
export async function has(db, { orgId, clientId, code } = {}) {
  if (!orgId || !clientId || !code) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM v_client_entitlements
      WHERE org_id = $1 AND client_id = $2 AND entitlement_code = $3 AND active
      LIMIT 1`,
    [orgId, clientId, String(code).trim().toLowerCase()]
  );
  return rows.length > 0;
}

/* grant — one entitlement, idempotent. Returns
   { granted, id, reason }; granted:false with a reason is a normal outcome. */
export async function grant(db, {
  orgId, clientId, code,
  sourceTransactionId = null, sourceEventId = null,
  grantedBy = null, reason = null, durationDays = null, now = new Date()
} = {}) {
  if (!orgId || !clientId || !code) {
    throw new Error("grant: orgId, clientId and code are required");
  }
  const norm = String(code).trim().toLowerCase();
  const expiresAt = durationDays
    ? new Date(now.getTime() + durationDays * 86_400_000)
    : null;

  const { rows } = await db.query(
    `INSERT INTO entitlements
       (org_id, client_id, entitlement_code, source_transaction_id, source_event_id,
        granted_by, grant_reason, granted_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [orgId, clientId, norm, sourceTransactionId, sourceEventId,
     grantedBy, reason, now, expiresAt]
  );

  if (rows[0]) return { granted: true, id: rows[0].id, reason: null };

  // The index absorbed it. Distinguish "already held" from "previously revoked",
  // because a re-purchase after a revocation SHOULD reinstate.
  const existing = await db.query(
    `SELECT id, revoked_at FROM entitlements
      WHERE org_id = $1 AND client_id = $2 AND entitlement_code = $3
        AND source_transaction_id IS NOT DISTINCT FROM $4`,
    [orgId, clientId, norm, sourceTransactionId]
  );
  const row = existing.rows[0];
  if (row && row.revoked_at) {
    await db.query(
      `UPDATE entitlements
          SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL,
              granted_at = $2, expires_at = $3, updated_at = now()
        WHERE id = $1`,
      [row.id, now, expiresAt]
    );
    return { granted: true, id: row.id, reason: "reinstated" };
  }
  return { granted: false, id: row ? row.id : null, reason: "already_granted" };
}

/* grantFromTransaction — the purchase path. Looks the product's entitlements up
   in configuration and grants each one.

   Returns { productCode, granted: [...codes], skipped: [...], unmapped: boolean }.
   `unmapped` is the important one: a product with NO configured entitlements is
   not an error here, it is an unanswered offer question
   (product_entitlements ships empty on purpose — see 032_entitlements.sql). The
   caller reports it rather than guessing a mapping. */
export async function grantFromTransaction(db, {
  orgId, clientId, transactionId, productCode, sourceEventId = null, now = new Date()
} = {}) {
  if (!orgId || !clientId || !productCode) {
    throw new Error("grantFromTransaction: orgId, clientId and productCode are required");
  }
  const code = String(productCode).trim().toLowerCase();

  const { rows: mapped } = await db.query(
    `SELECT entitlement_code, duration_days
       FROM product_entitlements
      WHERE org_id = $1 AND lower(btrim(product_code)) = $2`,
    [orgId, code]
  );

  if (!mapped.length) {
    return { productCode: code, granted: [], skipped: [], unmapped: true };
  }

  const granted = [], skipped = [];
  for (const m of mapped) {
    const r = await grant(db, {
      orgId, clientId, code: m.entitlement_code,
      sourceTransactionId: transactionId, sourceEventId,
      durationDays: m.duration_days, now,
      reason: `purchase:${code}`
    });
    (r.granted ? granted : skipped).push(m.entitlement_code);
  }
  return { productCode: code, granted, skipped, unmapped: false };
}

/* revoke — stamp it, never remove it. */
export async function revoke(db, {
  orgId, clientId, code, by = null, reason = null, now = new Date()
} = {}) {
  const { rows } = await db.query(
    `UPDATE entitlements
        SET revoked_at = $4, revoked_by = $5, revoke_reason = $6, updated_at = now()
      WHERE org_id = $1 AND client_id = $2 AND entitlement_code = $3
        AND revoked_at IS NULL
      RETURNING id`,
    [orgId, clientId, String(code).trim().toLowerCase(), now, by, reason]
  );
  return { revoked: rows.length, ids: rows.map((r) => r.id) };
}

/* catalog — the grantable things, for an admin screen and for the portal's
   locked tiles when a client has no grants at all. */
export async function catalog(db, { orgId, includeInactive = false } = {}) {
  const { rows } = await db.query(
    `SELECT code, name, description, kind, sort_order, active
       FROM entitlement_catalog
      WHERE org_id = $1 ${includeInactive ? "" : "AND active = true"}
      ORDER BY sort_order, code`,
    [orgId]
  );
  return rows;
}

/* unmappedProducts — the reporting surface for the gap 032 leaves open: which
   sellable products grant nothing yet. An ops screen should show this, because
   until it is empty the portal cannot gate on a purchase. */
export async function unmappedProducts(db, { orgId } = {}) {
  const { rows } = await db.query(
    `SELECT p.code, p.name
       FROM products p
      WHERE p.org_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM product_entitlements pe
           WHERE pe.org_id = p.org_id
             AND lower(btrim(pe.product_code)) = lower(btrim(p.code))
        )
      ORDER BY p.sort_order, p.code`,
    [orgId]
  );
  return rows;
}
