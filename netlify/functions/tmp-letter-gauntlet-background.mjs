/**
 * Draft-only background prove. Auth: x-crs-prove-token === DASHBOARD_SECRET.
 * Not production. Delete after the prove.
 */
import { fenceProcessEnv, runGauntlet, retryHeldSampleMail, sendUiqDeliverables } from "../../scripts/tmp-letter-gauntlet.mjs";
import { close } from "../../src/db.mjs";

export async function handler(event) {
  const token = event.headers?.["x-crs-prove-token"]
    || event.headers?.["X-Crs-Prove-Token"]
    || "";
  const allowed = [process.env.DASHBOARD_SECRET, process.env.COMMAS_API_KEY].filter(Boolean);
  if (!allowed.length || !allowed.includes(token)) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: "unauthorized" }) };
  }
  fenceProcessEnv();
  try {
    let body = {};
    try { body = event.body ? JSON.parse(event.body) : {}; } catch { body = {}; }
    console.log("letter-gauntlet", {
      deliverables: !!body.deliverables,
      retry: !!body.retry,
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY)
    });
    const out = body.deliverables
      ? await sendUiqDeliverables({ emails: body.emails })
      : body.retry
        ? await retryHeldSampleMail()
        : await runGauntlet();
    return { statusCode: 200, body: JSON.stringify(out) };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(err && err.message || err).slice(0, 400) })
    };
  } finally {
    await close().catch(() => {});
  }
}
