// GET /api/push/key — the public half of the VAPID key, for the browser.
//
// WHAT THIS IS. Before a browser can subscribe to push it must be handed the
// application server's PUBLIC key. It is public by definition: it travels to
// every phone that ever installs the portal, and the push services publish it
// back in their own diagnostics. Serving it is not a leak.
//
// WHAT IT IS NOT. The private half never leaves the server and is never in this
// response. If you are reading this because you are adding a field, the answer
// is no.
//
// SIGNED IN, EVEN THOUGH THE VALUE IS PUBLIC. Not to protect the key — to keep
// an unauthenticated caller from using this route to find out whether push is
// configured on a deployment. It costs nothing: the only caller is the portal,
// which is behind a login already.
//
// `configured: false` IS AN HONEST ANSWER, NOT AN ERROR. A deployment with no
// VAPID key set should tell the screen so, so the screen can hide the button
// rather than offering a control that cannot work — UI-STANDARDS §5.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { vapidConfig } from "../../src/messaging/providers/web-push.mjs";
import { isPushStorageConfigured } from "../../src/push/store.mjs";

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["client"], { db });
  if (!principal) return;

  const cfg = vapidConfig(process.env);
  // BOTH halves must be ready before the screen offers the button. A VAPID key
  // with no PUSH_SUB_ENC_KEY means a browser could subscribe and the server
  // would then refuse to store what it got — a permission prompt spent for
  // nothing, and a permission prompt is spent exactly once per browser.
  const storage = isPushStorageConfigured(process.env);

  return res.status(200).json({
    ok: true,
    configured: cfg.ok === true && storage === true,
    // Present only when it is real. Null rather than an empty string so a
    // screen cannot pass a falsy-but-defined value to the subscribe call.
    public_key: cfg.ok ? cfg.publicKey : null
  });
}
