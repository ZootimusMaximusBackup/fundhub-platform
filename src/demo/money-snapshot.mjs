export async function moneyReportingSnapshot(db, orgId) {
  const r = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(agreed_price), 0)::numeric FROM sales WHERE org_id = $1 AND COALESCE(is_demo, false) = false) AS sales_total,
       (SELECT COALESCE(SUM(amount), 0)::numeric FROM commission_ledger WHERE org_id = $1 AND COALESCE(is_demo, false) = false) AS commission_total,
       (SELECT COALESCE(SUM(amount_due), 0)::numeric FROM invoices WHERE org_id = $1 AND COALESCE(is_demo, false) = false) AS invoice_total,
       (SELECT COALESCE(SUM(cash_collected_cents), 0)::bigint FROM call_outcomes WHERE org_id = $1 AND COALESCE(is_demo, false) = false) AS call_cash_cents,
       (SELECT COALESCE(SUM(total_fee), 0)::numeric FROM funding_closeout WHERE org_id = $1 AND COALESCE(is_demo, false) = false) AS closeout_fees,
       (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM payment_links WHERE org_id = $1 AND COALESCE(is_demo, false) = false) AS payment_link_cents,
       (SELECT count(*)::int FROM clients WHERE org_id = $1 AND COALESCE(is_demo, false) = false) AS real_clients`,
    [orgId]
  );
  const row = r.rows[0];
  return {
    sales_total: Number(row.sales_total || 0),
    commission_total: Number(row.commission_total || 0),
    invoice_total: Number(row.invoice_total || 0),
    call_cash_cents: Number(row.call_cash_cents || 0),
    closeout_fees: Number(row.closeout_fees || 0),
    payment_link_cents: Number(row.payment_link_cents || 0),
    real_clients: Number(row.real_clients || 0)
  };
}
