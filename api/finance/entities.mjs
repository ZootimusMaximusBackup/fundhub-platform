// /api/finance/entities — grouping a client's accounts into wallets: personal,
// or one or more businesses. Added by 106_entities.sql. Entity is additive on
// top of bank_accounts/card_liabilities/recurring_bills (entity_id nullable) —
// existing rows keep working with entity_id = NULL ("not yet assigned").
//
//   GET  ?client_id=<uuid>                         → { ok, client_id, entities }
//   POST { action: "create",  client_id, kind, name }
//   POST { action: "rename",  entity_id, name }
//   POST { action: "archive", entity_id }
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

const ENTITY_ROLES = ROLE_SETS.STAFF;
const KINDS = ["personal", "business"];

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ENTITY_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      const clientId = String(q.client_id).trim();
      return res.status(200).json({ ok: true, client_id: clientId, entities: await list(orgId, clientId) });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      switch (body.action) {
        case "create": {
          if (!isUuid(body.client_id)) {
            return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
          }
          if (!(await ownsClient(orgId, body.client_id))) {
            return res.status(403).json({ ok: false, error: "forbidden" });
          }
          const kind = String(body.kind || "").trim().toLowerCase();
          if (!KINDS.includes(kind)) {
            return res.status(400).json({ ok: false, error: `kind must be one of ${KINDS.join(", ")}` });
          }
          const name = String(body.name || "").trim();
          if (!name) {
            return res.status(400).json({ ok: false, error: "name is required" });
          }
          const clientId = String(body.client_id).trim();
          const inserted = (await db.query(
            `INSERT INTO entities (org_id, client_id, kind, name)
             VALUES ($1,$2,$3,$4) RETURNING id`,
            [orgId, clientId, kind, name]
          )).rows[0];
          return res.status(201).json({
            ok: true, action: "create", entity_id: inserted.id, client_id: clientId,
            entities: await list(orgId, clientId)
          });
        }
        case "rename": {
          if (!isUuid(body.entity_id)) {
            return res.status(400).json({ ok: false, error: "entity_id must be a uuid" });
          }
          const name = String(body.name || "").trim();
          if (!name) return res.status(400).json({ ok: false, error: "name is required" });
          const updated = (await db.query(
            `UPDATE entities SET name = $3, updated_at = now()
              WHERE id = $1 AND org_id = $2 RETURNING id, client_id`,
            [String(body.entity_id).trim(), orgId, name]
          )).rows[0];
          if (!updated) return res.status(404).json({ ok: false, error: "entity_not_found" });
          return res.status(200).json({
            ok: true, action: "rename", entity_id: updated.id, client_id: updated.client_id,
            entities: await list(orgId, updated.client_id)
          });
        }
        case "archive": {
          if (!isUuid(body.entity_id)) {
            return res.status(400).json({ ok: false, error: "entity_id must be a uuid" });
          }
          const updated = (await db.query(
            `UPDATE entities SET archived_at = COALESCE(archived_at, now()), updated_at = now()
              WHERE id = $1 AND org_id = $2 RETURNING id, client_id`,
            [String(body.entity_id).trim(), orgId]
          )).rows[0];
          if (!updated) return res.status(404).json({ ok: false, error: "entity_not_found" });
          return res.status(200).json({
            ok: true, action: "archive", entity_id: updated.id, client_id: updated.client_id,
            entities: await list(orgId, updated.client_id)
          });
        }
        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof TypeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (e && e.code === "23514") {
      return res.status(400).json({
        ok: false, error: "rejected_by_a_column_rule",
        message: String(e.constraint || "a CHECK constraint") + " refused this value"
      });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    /* A DATABASE THAT DID NOT ANSWER IS NOT OUR CODE THROWING, AND THE SCREEN
       MUST NOT BE TOLD IT WAS. Everything above this line has already claimed
       the faults it can name; what is left reaches netlify/functions/api.mjs as
       a bare 500 internal_error, which public/app/data.js words as "something
       went wrong on our side ... The database did not report a problem." That
       sentence is false during an outage and it is how the funding-capacity read
       reported a dead database as a bug in this file. 503 + db:"down" is the
       shape data.js already reads as "the database is not answering".
       See src/http/db-down.mjs — it stays narrow, so anything it cannot
       positively identify still falls through to the 500 it got before. */
    if (dbDown(res, e)) return;

    throw e;
  }
}

async function list(orgId, clientId) {
  const rows = (await db.query(
    `SELECT id, kind, name, archived_at, created_at
       FROM entities
      WHERE org_id = $1 AND client_id = $2
      ORDER BY archived_at NULLS FIRST, kind, name`,
    [orgId, clientId]
  )).rows;
  return rows;
}

async function ownsClient(orgId, clientId) {
  const r = await db.query(`SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`, [String(clientId).trim(), orgId]);
  return r.rows.length > 0;
}
