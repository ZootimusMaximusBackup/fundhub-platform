import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole } from "../../src/http/read-api.mjs";
import { getDemoModeStatus, setDemoMode, wipeDemoData } from "../../src/demo/platform-seed.mjs";
import { safeError } from "../../src/http/health.mjs";
const ROLES = new Set(["owner", "admin"]);
const WIPE_CONFIRM = "WIPE_DEMO_DATA";
export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLES)) return;
  if (!staff.org_id) return res.status(403).json({ ok: false, error: "no_org_scope" });
  try {
    if (req.method === "GET") return res.status(200).json({ ok: true, ...(await getDemoModeStatus(db, { orgId: staff.org_id })) });
    if (req.method === "POST") {
      const enabled = !!(req.body && req.body.enabled);
      return res.status(200).json({ ok: true, ...(await setDemoMode(db, { orgId: staff.org_id, enabled })) });
    }
    if (req.method === "DELETE") {
      const confirm = (req.body && req.body.confirm) || (req.query && req.query.confirm);
      if (confirm !== WIPE_CONFIRM) return res.status(400).json({ ok: false, error: "confirm_required", message: `Pass confirm: "${WIPE_CONFIRM}"` });
      return res.status(200).json({ ok: true, ...(await wipeDemoData(db, { orgId: staff.org_id })) });
    }
    res.setHeader("allow", "GET, POST, DELETE");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
