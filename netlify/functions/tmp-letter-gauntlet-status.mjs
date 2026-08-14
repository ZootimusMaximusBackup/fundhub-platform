/**
 * Poll sample-roster prove evidence from clients.custom_fields.prove_letter_pack.
 */
import { db, close } from "../../src/db.mjs";
import { ORG, ROSTER } from "../../scripts/tmp-letter-gauntlet.mjs";

export async function handler(event) {
  const token = event.headers?.["x-crs-prove-token"]
    || event.headers?.["X-Crs-Prove-Token"]
    || "";
  const allowed = [process.env.DASHBOARD_SECRET, process.env.COMMAS_API_KEY].filter(Boolean);
  if (!allowed.length || !allowed.includes(token)) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: "unauthorized" }) };
  }
  try {
    const emails = ROSTER.map((r) => r.email);
    const res = await db.query(
      `SELECT email, outcome_tier,
              custom_fields->'prove_letter_pack' AS prove,
              custom_fields->'prove_uiq_deliverables' AS uiq
         FROM clients
        WHERE org_id = $1 AND lower(email) = ANY($2::text[])
        ORDER BY email`,
      [ORG, emails.map((e) => e.toLowerCase())]
    );
    return { statusCode: 200, body: JSON.stringify({
      ok: true,
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      rows: res.rows
    }) };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(err && err.message || err).slice(0, 400) })
    };
  } finally {
    await close().catch(() => {});
  }
}
