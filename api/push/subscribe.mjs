// POST /api/push/subscribe — register this device for notifications.
// GET  /api/push/subscribe — how many devices this client has on, and nothing else.
//
// ═══════════════════════════════════════════════════════════════════════════
// PINNED TO SELF. THERE IS NO client_id PARAMETER AND THERE MUST NEVER BE ONE.
//
// The client id comes from the SESSION and from nowhere else. Not from the
// body, not from the query string, not for staff "previewing the portal" —
// api/read/portal-summary.mjs accepts `?client_id=` for staff because reading
// somebody's file summary is a support action; REGISTERING A PHONE is not, and
// a staff-supplied client_id here would let one call point a client's
// notifications at a device that client does not hold.
//
// So the principal kinds are ["client"] alone. A staff token gets 403, and that
// is the whole access rule: there is no second path to this table.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT A SUBSCRIPTION IS. Endpoint plus two keys. Together they are enough for
// anyone holding them to put a banner on that phone's lock screen with our name
// on it, which is why src/push/store.mjs encrypts all three at rest and why
// nothing in this file logs the body, echoes it back, or puts it in an error.
//
// THE RESPONSE CARRIES NO CREDENTIAL. It says whether a row was created and how
// many devices are now on. A client does not need their own endpoint read back
// to them — they have it, the browser gave it to them.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  saveSubscription,
  listSubscriptionsForClient,
  isPushStorageConfigured,
  PushStoreError
} from "../../src/push/store.mjs";

export default async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "POST" && method !== "GET") {
    res.setHeader("Allow", "GET, POST");
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

  if (method === "GET") {
    try {
      const devices = await listSubscriptionsForClient(db, { orgId, clientId });
      return res.status(200).json({ ok: true, devices, count: devices.length });
    } catch (err) {
      return res.status(500).json({
        ok: false, error: "read_failed",
        message: "We could not check your notification settings just now.",
        detail: safeError(err)
      });
    }
  }

  /* FAIL CLOSED WITH A CLEAR REASON. Without the encryption key there is
     nowhere safe to put what the browser just handed over, and storing it in
     the clear is not an option. 503 rather than 500: the deployment is
     unconfigured, the request was fine. */
  if (!isPushStorageConfigured(process.env)) {
    return res.status(503).json({
      ok: false,
      error: "push_storage_unconfigured",
      message: "Notifications are not switched on for this site yet."
    });
  }

  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const subscription = body.subscription && typeof body.subscription === "object"
    ? body.subscription
    : body;

  try {
    const { id, created } = await saveSubscription(db, {
      orgId,
      clientId,
      accountId: principal.accountId || null,
      subscription,
      deviceLabel: body.device_label || body.deviceLabel || null
    });

    const devices = await listSubscriptionsForClient(db, { orgId, clientId });
    // 201 for a new device, 200 for one we already had. Re-registering is the
    // normal case — a browser mints a fresh subscription whenever permission is
    // re-granted — so it must not read as an error.
    return res.status(created ? 201 : 200).json({
      ok: true,
      created,
      subscription_id: id,
      count: devices.length
    });
  } catch (err) {
    if (err instanceof PushStoreError) {
      // The message names a field and a rule; it never contains the value. The
      // browser handed us this, so the caller can fix it.
      return res.status(err.status || 400).json({ ok: false, error: "invalid_subscription", message: err.message });
    }
    return res.status(500).json({
      ok: false,
      error: "save_failed",
      message: "We could not switch notifications on just now.",
      detail: safeError(err)
    });
  }
}
