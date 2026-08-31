// Decline Autopsy — the database layer. Every read and every write carries
// org_id AND the autopsy's own id. Nothing here ever touches `clients`.
//
// COMPLIANCE REVIEW REQUIRED. Spec: docs/specs/W3-decline-autopsy.md §5.4, §8.6.
//
// WHY THIS IS ITS OWN FILE AND NOT api/documents-upload.mjs. That endpoint gates
// on requirePrincipal(["staff","client"]) and every row it writes hangs off a
// client_id. A $27 buyer is a stranger — not staff, not a client, with no client
// record. Widening that endpoint's principal set would let a stranger in through
// a door whose tenancy rules are load-bearing. So: a separate table, a separate
// endpoint, and the SHARED PIECES reused as libraries (the blob store, the size
// cap), not the shared endpoint.

import { randomBytes } from "node:crypto";
import { ATTESTATION_VERSION } from "./fields.mjs";

/** The public handle. 32 hex-ish characters from crypto randomness — matches the
 *  `^[a-z0-9]{24,64}$` CHECK on the column. Not a sequence: a countable id would
 *  let anyone measure how many brokers bought. */
export function newAutopsyRef() {
  return randomBytes(16).toString("hex");
}

const ROW_COLUMNS = [
  "row_label",
  "fico_band",
  "state",
  "business_age_months",
  "annual_revenue_cents",
  "requested_amount_cents",
  "highest_revolving_limit_cents",
  "declined_by",
  "decline_reason",
  "declined_on_month",
  "revolving_opened_month",
  "bureaus_pulled",
  "open_tradelines",
  "revolving_utilization_pct",
  "bucket",
  "estimated_capacity_cents",
  "estimated_fee_cents",
  "estimated_partner_share_cents",
  "lender_match_count"
];

/**
 * createAutopsy — the purchase record, written when checkout is minted. The
 * upload endpoint refuses to accept rows until paid_at is stamped: pay first,
 * upload second, so we are never holding somebody else's consumer records from
 * a person who did not become a customer.
 */
export async function createAutopsy(db, { orgId, buyerEmail, buyerName = null, checkoutSession = null, ref = null }) {
  if (!orgId) throw new Error("createAutopsy requires orgId");
  if (!buyerEmail) throw new Error("createAutopsy requires buyerEmail");
  const autopsyRef = ref || newAutopsyRef();
  const { rows } = await db.query(
    `INSERT INTO decline_autopsy_uploads (org_id, autopsy_ref, buyer_email, buyer_name, checkout_session)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, autopsy_ref, buyer_email, buyer_name, paid_at, created_at`,
    [orgId, autopsyRef, String(buyerEmail).trim().toLowerCase(), buyerName, checkoutSession]
  );
  return rows[0];
}

/** getAutopsyByRef — org-scoped, and it never returns a soft-deleted upload's
 *  rows. The purchase record survives a delete; the data does not. */
export async function getAutopsyByRef(db, { orgId, ref }) {
  if (!orgId || !ref) return null;
  const { rows } = await db.query(
    `SELECT id, org_id, autopsy_ref, buyer_email, buyer_name, payment_link_ref, checkout_session,
            paid_at, attestation_version, attestation_name, attestation_at,
            rows_submitted, columns_dropped, raw_storage_key, raw_deleted_at,
            scored_at, deleted_at, deleted_reason, created_at
       FROM decline_autopsy_uploads
      WHERE org_id = $1 AND autopsy_ref = $2`,
    [orgId, ref]
  );
  return rows[0] || null;
}

/** markPaid — reconciliation on the way back from checkout. Idempotent: a second
 *  webhook for the same session does not move paid_at. */
export async function markPaid(db, { orgId, ref, paymentLinkRef = null }) {
  const { rows } = await db.query(
    `UPDATE decline_autopsy_uploads
        SET paid_at = COALESCE(paid_at, now()),
            payment_link_ref = COALESCE($3, payment_link_ref)
      WHERE org_id = $1 AND autopsy_ref = $2 AND deleted_at IS NULL
      RETURNING id, autopsy_ref, paid_at`,
    [orgId, ref, paymentLinkRef]
  );
  return rows[0] || null;
}

/** recordAttestation — the broker's warranty about somebody else's file. Stored
 *  HERE, on the autopsy row, and NOT in client_consents. See fields.mjs. */
export async function recordAttestation(db, { orgId, ref, typedName, ip = null, version = ATTESTATION_VERSION }) {
  const { rows } = await db.query(
    `UPDATE decline_autopsy_uploads
        SET attestation_version = $3,
            attestation_name = $4,
            attestation_ip = $5,
            attestation_at = now()
      WHERE org_id = $1 AND autopsy_ref = $2 AND deleted_at IS NULL
      RETURNING id, attestation_at`,
    [orgId, ref, version, String(typedName).slice(0, 120), ip]
  );
  return rows[0] || null;
}

/**
 * saveScoredRows — the cleaned, scored rows, replacing anything already there.
 *
 * One statement per row rather than a single multi-row VALUES: 25 rows is the
 * cap, the readability is worth more than the round trips here, and a row that
 * violates a CHECK names itself instead of failing an opaque batch.
 *
 * NULL SURVIVES. estimated_capacity_cents is passed through untouched — a row we
 * could not model is written as NULL, not 0.
 */
export async function saveScoredRows(db, { orgId, autopsyId, rows, columnsDropped = 0 }) {
  if (!orgId || !autopsyId) throw new Error("saveScoredRows requires orgId and autopsyId");
  const list = Array.isArray(rows) ? rows : [];

  await db.query(`DELETE FROM decline_autopsy_rows WHERE org_id = $1 AND autopsy_id = $2`, [orgId, autopsyId]);

  const cols = ["org_id", "autopsy_id", ...ROW_COLUMNS, "assumptions"];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");

  for (const r of list) {
    const values = [orgId, autopsyId, ...ROW_COLUMNS.map((c) => (r[c] === undefined ? null : r[c]))];
    values.push(JSON.stringify(Array.isArray(r.assumptions) ? r.assumptions : []));
    await db.query(
      `INSERT INTO decline_autopsy_rows (${cols.join(",")}) VALUES (${placeholders})`,
      values
    );
  }

  const { rows: out } = await db.query(
    `UPDATE decline_autopsy_uploads
        SET rows_submitted = $3, columns_dropped = $4, scored_at = now()
      WHERE org_id = $1 AND id = $2
      RETURNING id, rows_submitted, columns_dropped, scored_at`,
    [orgId, autopsyId, list.length, columnsDropped]
  );
  return out[0] || null;
}

/** listRows — one autopsy's rows, org-scoped, in upload order. */
export async function listRows(db, { orgId, autopsyId }) {
  const { rows } = await db.query(
    `SELECT ${ROW_COLUMNS.join(",")}, assumptions
       FROM decline_autopsy_rows
      WHERE org_id = $1 AND autopsy_id = $2
      ORDER BY created_at, row_label`,
    [orgId, autopsyId]
  );
  /* *** node-postgres hands bigint AND numeric back as STRINGS. ***
     This bit them for real: fromCents() refuses anything that is not an
     integer, so the report threw `fromCents: not an integer` the first time it
     summed capacities read back out of the database — `0 + "16500000"` is the
     string "016500000", not a number. Every money column here is int8.

     NULL MUST STILL SURVIVE THE CONVERSION. Number(null) is 0, which is exactly
     the collapse this whole feature is written to prevent, so each field is
     tested for null BEFORE it is converted. */
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return rows.map((r) => ({
    ...r,
    annual_revenue_cents: num(r.annual_revenue_cents),
    requested_amount_cents: num(r.requested_amount_cents),
    highest_revolving_limit_cents: num(r.highest_revolving_limit_cents),
    estimated_capacity_cents: num(r.estimated_capacity_cents),
    estimated_fee_cents: num(r.estimated_fee_cents),
    estimated_partner_share_cents: num(r.estimated_partner_share_cents),
    // Utilisation is compared against 30 downstream, and "45.00" > 30 is a
    // string comparison that would silently answer the wrong question.
    revolving_utilization_pct: num(r.revolving_utilization_pct),
    assumptions: Array.isArray(r.assumptions) ? r.assumptions : []
  }));
}

/** setRawStorageKey — the blob key of the file as uploaded, held only until
 *  parsing succeeds. */
export async function setRawStorageKey(db, { orgId, autopsyId, storageKey }) {
  await db.query(
    `UPDATE decline_autopsy_uploads SET raw_storage_key = $3 WHERE org_id = $1 AND id = $2`,
    [orgId, autopsyId, storageKey]
  );
}

/**
 * clearRawFile — DELETE THE ORIGINAL. Called the moment parsing succeeds.
 *
 * This is the single highest-value minimisation step in the design (spec §8.3):
 * we keep the parsed, cleaned rows and not the file that arrived. The bytes go
 * from blob storage first, then the key is cleared and stamped — that order, so
 * a crash between the two leaves a stale key pointing at nothing rather than a
 * live file nobody knows about.
 */
export async function clearRawFile(db, { orgId, autopsyId, store = null }) {
  const { rows } = await db.query(
    `SELECT raw_storage_key FROM decline_autopsy_uploads WHERE org_id = $1 AND id = $2`,
    [orgId, autopsyId]
  );
  const key = rows[0]?.raw_storage_key || null;
  if (key && store && typeof store.del === "function") {
    await store.del(key);
  }
  await db.query(
    `UPDATE decline_autopsy_uploads
        SET raw_storage_key = NULL, raw_deleted_at = COALESCE(raw_deleted_at, now())
      WHERE org_id = $1 AND id = $2`,
    [orgId, autopsyId]
  );
  return { deletedKey: key };
}

/**
 * deleteUpload — the buyer's own delete button, and what a refund calls.
 *
 * HARD-DELETES the rows and any attachment; KEEPS the purchase record with a
 * deleted_at and a reason. src/privacy/erasure.mjs's eraseClient() does NOT
 * apply here — it is keyed on clientId and an autopsy buyer is not a client, and
 * bending it to take a non-client id would weaken the one function whose whole
 * job is being precise. This follows its POSTURE instead: record what was kept
 * and why, because a financial record of a $27 sale is not erasable.
 */
export async function deleteUpload(db, { orgId, ref, reason, store = null }) {
  if (!reason) throw new Error("deleteUpload requires a reason — a delete with no reason is not a record");
  const upload = await getAutopsyByRef(db, { orgId, ref });
  if (!upload) return null;

  if (upload.raw_storage_key && store && typeof store.del === "function") {
    await store.del(upload.raw_storage_key);
  }

  const del = await db.query(
    `DELETE FROM decline_autopsy_rows WHERE org_id = $1 AND autopsy_id = $2`,
    [orgId, upload.id]
  );

  const { rows } = await db.query(
    `UPDATE decline_autopsy_uploads
        SET deleted_at = COALESCE(deleted_at, now()),
            deleted_reason = COALESCE(deleted_reason, $3),
            raw_storage_key = NULL,
            raw_deleted_at = COALESCE(raw_deleted_at, now())
      WHERE org_id = $1 AND id = $2
      RETURNING id, autopsy_ref, deleted_at, deleted_reason`,
    [orgId, upload.id, String(reason).slice(0, 200)]
  );

  return {
    ...rows[0],
    rowsDeleted: del.rowCount ?? 0,
    kept_with_reason: {
      decline_autopsy_uploads:
        "the purchase record of a $27 sale is a financial record and is not erasable; the uploaded rows and any attachment are gone"
    }
  };
}

export default {
  newAutopsyRef,
  createAutopsy,
  getAutopsyByRef,
  markPaid,
  recordAttestation,
  saveScoredRows,
  listRows,
  setRawStorageKey,
  clearRawFile,
  deleteUpload
};
