// GET /api/dashboard/client?id=<uuid>
// Read-only closer dashboard — full detail for one client.
// Returns the client row + related transactions[], crs_results[], messages[], tasks[].
// No writes. SELECT only. ESM. Mirrors api/health.mjs style.
import { db } from "../../src/db.mjs";
import { clientDetailExtras } from "../../src/http/client-detail.mjs";
import { redact, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireDashboardAccess } from "../../src/http/dashboard-auth.mjs";
import { safeError } from "../../src/http/health.mjs";

export default async function handler(req, res) {
  // Staff session first; the DASHBOARD_SECRET gate stays as the fallback until
  // cutover, so existing links keep working while staff accounts roll out.
  const staff = await requireDashboardAccess(req, res, { db });
  if (!staff) return;
  const { id } = req.query ?? {};
  if (!id) return res.status(400).json({ ok: false, error: "?id= required" });
  // A malformed id is a bad request, not a server fault. Without this the seven
  // queries below all fail on SQLSTATE 22P02 and the screen was told the whole
  // backend was unreachable.
  if (!isUuid(id)) return res.status(400).json({ ok: false, error: "invalid_id" });

  try {
    const [clientRes, txRes, crsRes, msgRes, taskRes, roundRes, invRes] = await Promise.all([
      db.query(
        `SELECT id, first_name, last_name, email, phone,
                outcome_tier, funded, funded_amount, days_to_fund,
                channel_source, tags, pipeline_ids,
                dnd_sms, dnd_email, dnd_voice, consent_sms,
                custom_fields, created_at, updated_at
         FROM clients WHERE id = $1`,
        [id]
      ),
      db.query(
        `SELECT id, product_name, amount_paid, status, provider, provider_ref, created_at
         FROM transactions WHERE client_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
      db.query(
        `SELECT id, outcome_tier, result, created_at
         FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
      db.query(
        `SELECT id, direction, channel, template_key, rendered_body,
                provider, status, created_at
         FROM messages WHERE client_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [id]
      ),
      db.query(
        `SELECT id, assignee_role, assignee_staff_id, title, body, due_at, done,
                source_workflow, created_at
         FROM tasks WHERE client_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
      // Two more reads, for the derived fields the Closer Dashboard needs:
      // a funding hold and an outstanding balance are blockers, and neither was
      // reachable from this endpoint before.
      db.query(
        `SELECT id, round_number, status, product, submitted_amount, approved_amount,
                funded_amount, hold_reason, conditions, created_at
         FROM funding_rounds WHERE client_id = $1 ORDER BY round_number DESC`,
        [id]
      ),
      db.query(
        `SELECT invoice_id AS id, status, currency, amount_due, amount_paid,
                balance_due, due_at, paid_at, created_at
         FROM v_invoice_balance WHERE client_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
    ]);

    if (!clientRes.rows.length) {
      return res.status(404).json({ ok: false, error: "client not found" });
    }

    const client = clientRes.rows[0];
    const extras = clientDetailExtras({
      client,
      crsResults: crsRes.rows,
      tasks: taskRes.rows,
      fundingRounds: roundRes.rows,
      invoices: invRes.rows
    });

    res.status(200).json(redact({
      ok: true,
      client,
      transactions:  txRes.rows,
      crs_results:   crsRes.rows,
      messages:      msgRes.rows,
      tasks:         taskRes.rows,
      funding_rounds: roundRes.rows,
      invoices:      invRes.rows,
      // Derived, never stored — see src/http/client-detail.mjs for why each of
      // these explains rather than recomputes.
      ...extras
    }));
  } catch (err) {
    if (CLIENT_DATA_ERRORS.has(err && err.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    // err.message can quote the DSN on a connection failure — scrub it the same
    // way health.mjs does rather than handing a host and password to the client.
    res.status(500).json({ ok: false, error: safeError(err) });
  }
}
