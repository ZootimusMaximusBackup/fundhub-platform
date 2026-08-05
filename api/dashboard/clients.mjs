// GET /api/dashboard/clients
// Read-only closer dashboard — list of clients with aggregated journey state.
// Returns most-recent-first; default limit 50, override via ?limit=N.
// No writes. SELECT only. ESM. Mirrors api/health.mjs style.
import { db } from "../../src/db.mjs";
import { requireDashboardAccess } from "../../src/http/dashboard-auth.mjs";
import { boundedLimit, requireRole, ROLE_SETS } from "../../src/http/read-api.mjs";
import { requireSessionOrg } from "../../src/http/session-org.mjs";

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
  LEFT JOIN transactions t   ON t.client_id = c.id AND t.org_id = c.org_id
  LEFT JOIN crs_results  cr  ON cr.client_id = c.id AND cr.org_id = c.org_id
  LEFT JOIN tasks        tk  ON tk.client_id = c.id AND tk.org_id = c.org_id
  LEFT JOIN messages     m   ON m.client_id  = c.id AND m.org_id = c.org_id
  WHERE c.org_id = $1
  GROUP BY c.id
  ORDER BY c.created_at DESC
  LIMIT $2
`;

export default async function handler(req, res) {
  // Staff session first; the DASHBOARD_SECRET gate stays as the fallback until
  // cutover, so existing links keep working while staff accounts roll out.
  // GET only. These answered POST/PUT/DELETE/PATCH with 200 and the full
  // client book, so any method reached read data that only GET should serve.
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const staff = await requireDashboardAccess(req, res, { db });
  if (!staff) return;
  /* "Signed in" was the whole gate, and every staff row is signed in — including
     role='partner', which is an EXTERNAL white-label operator. That handed the
     entire client book (names, emails, funded amounts) to a party outside the
     company. ROLE_SETS.STAFF already excludes 'partner' and denies unknown roles
     by default; this endpoint simply never called it.
     `true` is the DASHBOARD_SECRET fallback caller, which has no role to check. */
  if (staff !== true && !requireRole(res, staff, ROLE_SETS.STAFF)) return;
  // Org from the session ONLY. Shared-secret callers have no org — refuse rather
  // than dump every company's client book. Confirmed class of the P0 client leak.
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;
  try {
    const limit = boundedLimit(req.query?.limit, { fallback: 50, cap: 500 });
    const { rows } = await db.query(SQL, [orgId, limit]);
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
