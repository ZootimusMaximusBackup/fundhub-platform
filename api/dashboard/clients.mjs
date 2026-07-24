// GET /api/dashboard/clients
// Read-only closer dashboard — list of clients with aggregated journey state.
// Returns most-recent-first; default limit 50, override via ?limit=N.
// No writes. SELECT only. ESM. Mirrors api/health.mjs style.
import { db } from "../../src/db.mjs";

const SQL = `
  SELECT
    c.id,
    c.first_name,
    c.last_name,
    c.email,
    c.outcome_tier,
    c.funded,
    c.funded_amount,
    -- custom_fields flags
    (c.custom_fields->>'crs_paid')::boolean          AS crs_paid,
    (c.custom_fields->>'deposit_paid')::boolean       AS deposit_paid,
    (c.custom_fields->>'sale_closed')::boolean        AS sale_closed,
    (c.custom_fields->>'total_funding_estimate')      AS total_funding_estimate,
    c.created_at,
    -- transactions aggregate
    COUNT(DISTINCT t.id)                              AS tx_count,
    (ARRAY_AGG(t.product_name ORDER BY t.created_at DESC))[1] AS tx_latest_product,
    (ARRAY_AGG(t.amount_paid  ORDER BY t.created_at DESC))[1] AS tx_latest_amount,
    (ARRAY_AGG(t.status       ORDER BY t.created_at DESC))[1] AS tx_latest_status,
    -- crs_results count
    COUNT(DISTINCT cr.id)                             AS crs_count,
    -- tasks count
    COUNT(DISTINCT tk.id)                             AS task_count,
    -- latest message
    (ARRAY_AGG(m.channel   ORDER BY m.created_at DESC))[1] AS last_msg_channel,
    (ARRAY_AGG(m.direction ORDER BY m.created_at DESC))[1] AS last_msg_direction,
    (ARRAY_AGG(m.created_at ORDER BY m.created_at DESC))[1] AS last_msg_at
  FROM clients c
  LEFT JOIN transactions t   ON t.client_id = c.id
  LEFT JOIN crs_results  cr  ON cr.client_id = c.id
  LEFT JOIN tasks        tk  ON tk.client_id = c.id
  LEFT JOIN messages     m   ON m.client_id  = c.id
  GROUP BY c.id
  ORDER BY c.created_at DESC
  LIMIT $1
`;

export default async function handler(req, res) {
  try {
    const limit = Math.min(parseInt(req.query?.limit ?? "50", 10) || 50, 500);
    const { rows } = await db.query(SQL, [limit]);
    const clients = rows.map((r) => ({
      id:           r.id,
      first_name:   r.first_name,
      last_name:    r.last_name,
      email:        r.email,
      outcome_tier: r.outcome_tier,
      funded:       r.funded,
      funded_amount: r.funded_amount,
      custom_fields: {
        crs_paid:               r.crs_paid ?? false,
        deposit_paid:           r.deposit_paid ?? false,
        sale_closed:            r.sale_closed ?? false,
        total_funding_estimate: r.total_funding_estimate ?? null,
      },
      transactions: {
        count:          Number(r.tx_count),
        latest_product: r.tx_latest_product ?? null,
        latest_amount:  r.tx_latest_amount  ?? null,
        latest_status:  r.tx_latest_status  ?? null,
      },
      crs_count:  Number(r.crs_count),
      task_count: Number(r.task_count),
      last_message: {
        channel:   r.last_msg_channel   ?? null,
        direction: r.last_msg_direction ?? null,
        at:        r.last_msg_at        ?? null,
      },
      created_at: r.created_at,
    }));
    res.status(200).json({ ok: true, count: clients.length, clients });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
