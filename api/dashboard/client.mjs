// GET /api/dashboard/client?id=<uuid>
// Read-only closer dashboard — full detail for one client.
// Returns the client row + related transactions[], crs_results[], messages[], tasks[].
// No writes. SELECT only. ESM. Mirrors api/health.mjs style.
import { db } from "../../src/db.mjs";

export default async function handler(req, res) {
  const { id } = req.query ?? {};
  if (!id) return res.status(400).json({ ok: false, error: "?id= required" });

  try {
    const [clientRes, txRes, crsRes, msgRes, taskRes] = await Promise.all([
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
        `SELECT id, assignee, title, body, due_at, done, source_workflow, created_at
         FROM tasks WHERE client_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
    ]);

    if (!clientRes.rows.length) {
      return res.status(404).json({ ok: false, error: "client not found" });
    }

    res.status(200).json({
      ok: true,
      client:      clientRes.rows[0],
      transactions: txRes.rows,
      crs_results:  crsRes.rows,
      messages:     msgRes.rows,
      tasks:        taskRes.rows,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
