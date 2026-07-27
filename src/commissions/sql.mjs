// SQL text for the commission model.
//
// Constants only — no connection, no execution, no side effects. The calculator
// stays pure; this file exists so whoever wires the event handlers does not have
// to reverse-engineer the joins, and so the joins live next to the model they
// belong to.
//
// Every query is parameterised. Nothing here interpolates a value.

/** Every rule in force for an org + basis at a point in time, tiers attached.
 *  Params: $1 org_id, $2 basis, $3 as_of timestamptz.
 *  Scope filtering (product/role/staff) is done in rules.mjs, not here — the
 *  precedence logic is unit-tested JS, not a query nobody can test. */
export const SQL_RULES_IN_FORCE = `
SELECT r.*,
       COALESCE(
         json_agg(
           json_build_object(
             'id', t.id, 'min_amount', t.min_amount, 'max_amount', t.max_amount,
             'percent', t.percent, 'flat_amount', t.flat_amount,
             'per_unit_amount', t.per_unit_amount
           ) ORDER BY t.min_amount
         ) FILTER (WHERE t.id IS NOT NULL),
         '[]'::json
       ) AS tiers
  FROM commission_rules r
  LEFT JOIN commission_rule_tiers t ON t.rule_id = r.id
 WHERE r.org_id = $1
   AND r.basis  = $2
   AND r.active
   AND r.effective_from <= $3
   AND (r.effective_to IS NULL OR r.effective_to > $3)
 GROUP BY r.id`;

/** Params: $1 sale_id. */
export const SQL_ATTRIBUTIONS_FOR_SALE = `
SELECT a.id, a.sale_id, a.staff_id, a.employee_code, a.role, a.basis,
       a.split_percent, a.attributed_at
  FROM sale_attributions a
 WHERE a.sale_id = $1
 ORDER BY a.basis, a.attributed_at`;

/** Params: $1 sale_id. */
export const SQL_SALE_CONTEXT = `
SELECT s.id, s.org_id, s.client_id, s.product_id, s.agreed_price,
       s.agreed_success_fee_percent, s.currency, s.sold_at, s.status,
       p.name  AS product_name,
       p.category AS product_category,
       c.client_code
  FROM sales s
  JOIN products p ON p.id = s.product_id
  LEFT JOIN clients c ON c.id = s.client_id
 WHERE s.id = $1`;

/** Params: $1 sale_id. */
export const SQL_PAYMENTS_FOR_SALE = `
SELECT id, sale_id, transaction_id, kind, amount, paid_at
  FROM sale_payments
 WHERE sale_id = $1
 ORDER BY paid_at`;

/** The frozen chain: round -> sale. Params: $1 funding_round_id. */
export const SQL_SALE_FOR_ROUND = `
SELECT frs.sale_id, frs.link_method, frs.linked_at
  FROM funding_round_sales frs
 WHERE frs.funding_round_id = $1`;

/** Route an inbound product string to a product record — current name first,
 *  then any alias (including names the product used to have).
 *  Params: $1 org_id, $2 product name string. */
export const SQL_RESOLVE_PRODUCT = `
SELECT resolve_product_id($1, $2) AS product_id`;

/** Freeze the round -> sale association at round start. Runs once per round;
 *  the unique index on funding_round_id makes a replay a no-op.
 *  Resolution rule: the client's most recent funding-category sale at or before
 *  the round's creation. Explicit links should be inserted directly instead.
 *  Params: $1 org_id, $2 funding_round_id. */
export const SQL_LINK_ROUND_TO_SALE = `
INSERT INTO funding_round_sales (org_id, funding_round_id, sale_id, link_method)
SELECT $1, fr.id, s.id, 'resolved'
  FROM funding_rounds fr
  JOIN sales s
    ON s.client_id = fr.client_id
   AND s.org_id    = fr.org_id
   AND s.status    = 'active'
   AND s.sold_at  <= fr.created_at
  JOIN products p
    ON p.id = s.product_id
   AND p.category = 'funding'
 WHERE fr.id = $2
 ORDER BY s.sold_at DESC
 LIMIT 1
ON CONFLICT (funding_round_id) DO NOTHING
RETURNING sale_id`;

/** Write a commission draft. ON CONFLICT DO NOTHING against the idempotency
 *  index makes a replayed event a no-op rather than a double payment (Rule 9).
 *  Params in the column order below. */
export const SQL_INSERT_LEDGER = `
INSERT INTO commission_ledger (
  org_id, staff_id, employee_code, client_id, client_code,
  sale_id, funding_round_id, product_id, product_name_at_earning,
  basis, role, rule_id, rule_snapshot, stacking,
  base_amount, split_percent, amount, currency,
  status, earned_at, reverses_ledger_id, source_event, idempotency_key, notes
) VALUES (
  $1, $2, $3, $4, $5,
  $6, $7, $8, $9,
  $10, $11, $12, $13, $14,
  $15, $16, $17, $18,
  $19, $20, $21, $22, $23, $24
)
ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL
DO NOTHING
RETURNING id`;

/** Column order for SQL_INSERT_LEDGER, so a caller can build the params array
 *  from a draft without counting placeholders. */
export const LEDGER_INSERT_COLUMNS = Object.freeze([
  "org_id", "staff_id", "employee_code", "client_id", "client_code",
  "sale_id", "funding_round_id", "product_id", "product_name_at_earning",
  "basis", "role", "rule_id", "rule_snapshot", "stacking",
  "base_amount", "split_percent", "amount", "currency",
  "status", "earned_at", "reverses_ledger_id", "source_event", "idempotency_key", "notes"
]);

/** Turn a draft from calculate.mjs into the params array for SQL_INSERT_LEDGER.
 *  Pure: a projection, nothing more. */
export function ledgerInsertParams(draft) {
  return LEDGER_INSERT_COLUMNS.map((c) => {
    const v = draft[c];
    if (v === undefined) return null;
    return c === "rule_snapshot" && v !== null ? JSON.stringify(v) : v;
  });
}

/** Changing a rate: close the live row, then insert the replacement. Never an
 *  UPDATE of the rate itself — that is what would rewrite history.
 *  Params: $1 rule_id, $2 effective_to timestamptz. */
export const SQL_SUPERSEDE_RULE = `
UPDATE commission_rules
   SET effective_to = $2
 WHERE id = $1
   AND effective_to IS NULL
RETURNING id, effective_from, effective_to`;

/** Payout report. Params: $1 org_id, $2 period start, $3 period end. */
export const SQL_PAYOUT_REPORT = `
SELECT staff_id, employee_code, staff_name, basis, status,
       COUNT(*) AS rows, SUM(amount) AS total
  FROM v_commission_statement
 WHERE org_id = $1
   AND earned_at >= $2
   AND earned_at <  $3
 GROUP BY staff_id, employee_code, staff_name, basis, status
 ORDER BY staff_name, basis, status`;
