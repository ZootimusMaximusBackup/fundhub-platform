// GET /api/read/slo-connections — owner list of live ClickFunnels maps.
// COMPLIANCE REVIEW REQUIRED — payment rails (which paid products unlock).

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";
import { listConnections } from "../../src/slo/connections.mjs";

export const run = readHandler({
  roles: ROLE_SETS.OPS,
  fetch: async (db, { staff }) => {
    const args = { orgId: staff.org_id };
    return listConnections(db, args.orgId);
  }
});

export default (req, res) => run(req, res, { db, requireAuth });
