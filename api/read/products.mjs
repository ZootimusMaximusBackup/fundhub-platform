// GET /api/read/products — the product ladder, with its commission rules count.
//
// Read-only. Prices are configuration and are returned as stored; nothing here
// derives or rounds them.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

export const run = readHandler({
  roles: ROLE_SETS.STAFF,
  // The org filter binds the CALLER's org, not orgs.is_default. is_default is
  // one fixed org — with a second org in the table it served org A's rows to
  // org B's staff. A session with no org_id binds null, which matches no row:
  // an empty page, never the whole table and never the default org's.
  fetch: (db, { limit, offset, staff }) =>
    db.query(`
      SELECT p.code, p.name, p.description, p.category, p.default_price,
             p.min_price, p.max_price, p.price_is_variable,
             p.default_success_fee_percent, p.sort_order, p.notes,
             (SELECT count(*)::int FROM commission_rules cr
               WHERE cr.product_id = p.id AND cr.active = true) AS active_rules
        FROM products p
       WHERE p.org_id = $3::uuid
       ORDER BY p.sort_order, p.code
       LIMIT $1 OFFSET $2`, [limit + 1, offset, (staff && staff.org_id) || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
