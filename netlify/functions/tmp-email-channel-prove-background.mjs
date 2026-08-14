/**
 * Draft-only background prove. Auth: x-crs-prove-token === DASHBOARD_SECRET.
 * Needed because Netlify CLI masks DATABASE_URL. Not production. Delete after prove.
 */
import { fenceProcessEnv, proveEmailChannel } from "../../scripts/tmp-email-channel-prove.mjs";
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
    const out = await proveEmailChannel();
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
