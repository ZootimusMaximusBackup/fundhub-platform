// GET /api/read/inquiry-cases — active inquiry removal case queue.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { listCases, getActiveCaseForClient } from "../../src/inquiry-ops/cases.mjs";
import { loadDocPackets } from "../../src/inquiry-ops/doc-gate.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.SPECIALIST_DESK)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const query = req.query || {};

  try {
    if (query.client_id) {
      if (!isUuid(query.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      const c = await getActiveCaseForClient(database, {
        orgId: staff.org_id,
        clientId: query.client_id
      });
      return res.status(200).json({ ok: true, case: c });
    }

    const { cases, total } = await listCases(database, {
      orgId: staff.org_id,
      activeOnly: query.active_only !== "false",
      case_status: query.case_status || null,
      assigned_remover: query.assigned_remover || null,
      limit: Number(query.limit) || 100,
      offset: Number(query.offset) || 0
    });

    /* THE IDENTITY PACKET, ANSWERED RATHER THAN ASSUMED.
       The screen used to print "Docs: complete" for every case that was not
       already Blocked — and Blocked is only set at send time, so a packet nobody
       had looked at read "complete" on the screen that decides whether to send.
       src/inquiry-ops/doc-gate.mjs has always known the real answer; nothing
       called it. One query for the whole page.

       docs_complete stays UNDEFINED when the read failed (loadDocPackets returns
       null) or when a case has no client. Undefined reaches the screen as "not
       checked". It is never coerced to false — "we could not look" and "we
       looked and it is short" are different sentences to the person deciding. */
    const packets = await loadDocPackets(database, {
      orgId: staff.org_id,
      clientIds: cases.map((c) => c.client_id).filter(Boolean)
    });
    const withDocs = cases.map((c) => {
      const packet = packets && c.client_id ? packets.get(String(c.client_id)) : null;
      if (!packet) return c;
      return { ...c, docs_complete: packet.complete, docs_missing: packet.missing };
    });

    return res.status(200).json({ ok: true, cases: withDocs, total });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
