// GET /api/read/products — the product ladder, with its commission rules count.
//
// Read-only. Prices are configuration and are returned as stored; nothing here
// derives or rounds them.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: (db, { limit, offset }) =>
    db.query(`
      SELECT p.code, p.name, p.description, p.category, p.default_price,
             p.min_price, p.max_price, p.price_is_variable,
             p.default_success_fee_percent, p.sort_order, p.notes,
             (SELECT count(*)::int FROM commission_rules cr
               WHERE cr.product_id = p.id AND cr.active = true) AS active_rules
        FROM products p
       WHERE p.org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
       ORDER BY p.sort_order, p.code
       LIMIT $1 OFFSET $2`, [limit + 1, offset]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
