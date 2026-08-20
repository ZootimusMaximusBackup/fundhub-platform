// GET/POST /api/commission-rules — effective-dated commission configuration.
import { db, pool } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS, isUuid } from "../src/http/read-api.mjs";
import { requireSessionOrg } from "../src/http/session-org.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { safeError } from "../src/http/health.mjs";
import { SQL_SUPERSEDE_RULE } from "../src/commissions/sql.mjs";

function rateValue(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function listCommissionRules(query, orgId) {
  const result = await query(
    `SELECT r.id, r.name, r.description, r.basis, r.stacking,
            r.product_id, p.code AS product_code, p.name AS product_name,
            r.role, r.staff_id, s.name AS staff_name,
            r.calc_method, r.percent, r.flat_amount, r.per_unit_amount,
            r.tier_mode, r.amount_basis, r.min_amount, r.max_amount,
            r.effective_from, r.effective_to, r.active, r.notes,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', t.id,
                  'min_amount', t.min_amount,
                  'max_amount', t.max_amount,
                  'percent', t.percent,
                  'flat_amount', t.flat_amount,
                  'per_unit_amount', t.per_unit_amount
                ) ORDER BY t.min_amount
              ) FILTER (WHERE t.id IS NOT NULL),
              '[]'::json
            ) AS tiers
       FROM commission_rules r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN staff s ON s.id = r.staff_id
       LEFT JOIN commission_rule_tiers t ON t.rule_id = r.id
      WHERE r.org_id = $1::uuid
      GROUP BY r.id, p.code, p.name, s.name
      ORDER BY r.name, r.effective_from`,
    [orgId]
  );
  return result.rows;
}

export async function supersedeCommissionRule(query, { orgId, ruleId, effectiveFrom, rate, reason }) {
  const current = await query(
    `SELECT *
       FROM commission_rules
      WHERE id = $1::uuid
        AND org_id = $2::uuid
      FOR UPDATE`,
    [ruleId, orgId]
  );
  const old = current.rows[0];
  if (!old) return { status: 404, error: "not_found" };
  if (old.effective_to != null) return { status: 409, error: "rule_already_closed" };
  if (old.calc_method === "tiered") return { status: 400, error: "tier_editor_not_ready" };

  const start = new Date(effectiveFrom);
  const oldStart = new Date(old.effective_from);
  if (!Number.isFinite(start.getTime()) || start <= oldStart) {
    return { status: 400, error: "invalid_effective_from" };
  }
  const nextRate = rateValue(rate);
  if (nextRate == null) return { status: 400, error: "invalid_rate" };

  const closed = await query(SQL_SUPERSEDE_RULE, [ruleId, start.toISOString()]);
  if (!closed.rows[0]) return { status: 409, error: "rule_already_closed" };

  const percent = old.calc_method === "percent" ? nextRate : old.percent;
  const flatAmount = old.calc_method === "flat" || old.calc_method === "flat_per_unit"
    ? nextRate
    : old.flat_amount;
  const note = String(reason || "").trim();
  const inserted = await query(
    `INSERT INTO commission_rules (
       org_id, name, description, basis, stacking, product_id, role, staff_id,
       calc_method, percent, flat_amount, per_unit_amount, tier_mode, amount_basis,
       min_amount, max_amount, effective_from, effective_to, active, notes
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NULL,$18,$19
     )
     RETURNING *`,
    [
      old.org_id, old.name, old.description, old.basis, old.stacking,
      old.product_id, old.role, old.staff_id, old.calc_method, percent,
      flatAmount, old.per_unit_amount, old.tier_mode, old.amount_basis,
      old.min_amount, old.max_amount, start.toISOString(), old.active !== false,
      note || old.notes || null
    ]
  );
  return { status: 200, old: closed.rows[0], rule: inserted.rows[0] };
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;

  try {
    if (req.method === "GET") {
      const rules = await listCommissionRules(db.query, orgId);
      return res.status(200).json({ ok: true, count: rules.length, rules });
    }

    const ruleId = String(req.body?.rule_id || "").trim();
    if (!isUuid(ruleId)) {
      return res.status(400).json({ ok: false, error: "rule_id_required" });
    }
    const effectiveFrom = req.body?.effective_from;
    const rate = req.body?.rate;
    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      return res.status(400).json({
        ok: false,
        error: "reason_required",
        message: "Add a reason for the rate change."
      });
    }

    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      const result = await supersedeCommissionRule(client.query.bind(client), {
        orgId, ruleId, effectiveFrom, rate, reason
      });
      if (result.status !== 200) {
        await client.query("ROLLBACK");
        return res.status(result.status).json({ ok: false, error: result.error });
      }
      await client.query("COMMIT");
      return res.status(200).json({ ok: true, closed: result.old, rule: result.rule });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err?.code === "23P01") {
      return res.status(409).json({
        ok: false,
        error: "overlapping_rule",
        message: "Another rule already covers that date."
      });
    }
    if (dbDown(err)) {
      return res.status(503).json({ ok: false, error: "database_unavailable", db: "down" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
