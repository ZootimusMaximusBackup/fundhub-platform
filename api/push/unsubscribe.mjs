// POST /api/push/unsubscribe — turn this device's notifications off.
//
// THE CLIENT MUST BE ABLE TO STOP IT FROM THEIR OWN SIDE, and that is what this
// route is for. A phone that cannot be switched off from the app is switched off
// by the operating system instead — a permanent block that we cannot undo, that
// costs us the only permission prompt that browser will ever give us, and that
// nobody on our side can even see.
//
// PINNED TO SELF, exactly as subscribe is. The row is matched on the caller's
// own org and client id AND the endpoint hash, so a client holding somebody
// else's endpoint still retires nothing.
//
// `{ all: true }` RETIRES EVERY DEVICE. That is the "turn it off everywhere"
// control, and it is deliberately explicit rather than what an empty body does:
// an empty body is a bug in a caller, and the safe reading of a bug is to do
// nothing.
//
// RETIRED, NOT DELETED. revoked_at is stamped and the row stays. "This client
// asked us to stop on the 14th" is a fact worth being able to read later, and it
// is a different fact from "their phone went away", which is expired_at.
//
// ZERO ROWS IS A SUCCESS. Unsubscribing twice, or from a device that was already
// off, is normal — the browser can drop a subscription without telling us. A 404
// here would make the screen say something is wrong when nothing is.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { safeError } from "../../src/http/health.mjs";
import { revokeSubscription, listSubscriptionsForClient } from "../../src/push/store.mjs";

export default async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "POST" && method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["client"], { db });
  if (!principal) return;

  const clientId = principal.clientId || null;
  const orgId = principal.orgId || null;
  if (!clientId || !orgId) {
    return res.status(403).json({
      ok: false,
      error: "forbidden",
      message: "Your login is not attached to a client file."
    });
  }

  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const all = body.all === true;
  const endpoint = String(body.endpoint || "").trim();

  if (!all && !endpoint) {
    return res.status(400).json({
      ok: false,
      error: "endpoint_required",
      message: "Say which device to switch off, or pass all:true."
    });
  }

  try {
    const retired = await revokeSubscription(db, { orgId, clientId, endpoint, all });
    const devices = await listSubscriptionsForClient(db, { orgId, clientId });
    return res.status(200).json({ ok: true, retired, count: devices.length });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "revoke_failed",
      message: "We could not switch notifications off just now.",
      detail: safeError(err)
    });
  }
}
