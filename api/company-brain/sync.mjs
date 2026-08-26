// GET/POST /api/company-brain/sync — pick up Meet recordings from Drive.
// ROLE_SETS.FINANCE: owner, admin, sales_manager.
// Files stay in Drive. This only indexes metadata + stores the link.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { driveConfigFromEnv } from "../../src/company-brain/config.mjs";
import { syncDriveIncremental, getSyncState } from "../../src/company-brain/sync.mjs";
import { processOrgMeetWords } from "../../src/company-brain/meet-transcript.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const auth = deps.requireAuth || requireAuth;

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;

  const orgId = staff.org_id;
  if (!orgId) return res.status(403).json({ ok: false, error: "no_org_scope" });

  const env = deps.env || process.env;
  const config = driveConfigFromEnv(env);

  if (req.method === "GET") {
    try {
      const getState = deps.getSyncState || getSyncState;
      const state = await getState(database, orgId);
      return res.status(200).json({
        ok: true,
        drive_ready: config.ready,
        missing: config.ready ? [] : config.missing,
        last_sync_at: state?.last_sync_at || null,
        last_error: state?.last_error || null
      });
    } catch (e) {
      if (dbDown(res, e)) return;
      throw e;
    }
  }

  if (req.method === "POST") {
    if (!config.ready) {
      return res.status(200).json({
        ok: true,
        drive_ready: false,
        synced: false,
        reason: "not_configured",
        missing: config.missing
      });
    }
    try {
      const sync = deps.syncDriveIncremental || syncDriveIncremental;
      const wordsFn = deps.processOrgMeetWords || processOrgMeetWords;
      const out = await sync(database, { orgId, env });
      let wordsReady = 0;
      if (out.ok) {
        const words = await wordsFn(database, { orgId, env });
        wordsReady = (words.paired || 0) + (words.whispered || 0);
      }
      return res.status(200).json({
        ok: true,
        drive_ready: true,
        synced: !!out.ok,
        reason: out.ok ? null : (out.reason || "sync_failed"),
        missing: [],
        mode: out.mode || null,
        upserted: out.upserted || 0,
        deleted: out.deleted || 0,
        words_ready: wordsReady
      });
    } catch (e) {
      if (dbDown(res, e)) return;
      throw e;
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}
