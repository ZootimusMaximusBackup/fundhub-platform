/**
 * What just got signed. No live-file open. No PII printed.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-today-merge-2026-08-18-evidence");
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FUNNEL = "edca0767-88e9-4cf4-8837-47382049503a";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

function who(id) {
  if (id === TEST) return "TEST";
  if (id === FUNNEL) return "FUNNEL";
  if (id === LIVE) return "LIVE";
  return "OTHER";
}

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

async function q(sql, params) {
  return (await c.query(sql, params)).rows;
}

const recent = await q(
  `SELECT id, client_id, status, template_key, signed_at, created_at
     FROM contracts
    WHERE signed_at >= now() - interval '6 hours'
       OR (status = 'signed' AND updated_at >= now() - interval '6 hours')
    ORDER BY signed_at DESC NULLS LAST
    LIMIT 20`
).catch(async (err) => {
  if (!/updated_at/.test(String(err))) throw err;
  return q(
    `SELECT id, client_id, status, template_key, signed_at, created_at
       FROM contracts
      WHERE signed_at >= now() - interval '6 hours'
      ORDER BY signed_at DESC NULLS LAST
      LIMIT 20`
  );
});

const events = await q(
  `SELECT id, name, client_id, created_at
     FROM events
    WHERE name = 'contract.signed'
      AND created_at >= now() - interval '6 hours'
    ORDER BY created_at DESC
    LIMIT 20`
);

const entitlements = await q(
  `SELECT COUNT(*)::int AS n FROM product_entitlements`
);

const byClient = {};
for (const id of [TEST, FUNNEL, LIVE]) {
  byClient[who(id)] = {
    contracts_signed: await q(
      `SELECT id, status, template_key, signed_at
         FROM contracts
        WHERE client_id = $1 AND status = 'signed'
        ORDER BY signed_at DESC NULLS LAST
        LIMIT 8`,
      [id]
    ),
    events_signed: await q(
      `SELECT id, created_at FROM events
        WHERE client_id = $1 AND name = 'contract.signed'
        ORDER BY created_at DESC LIMIT 5`,
      [id]
    ),
    entitlements: await q(
      `SELECT entitlement_code, granted_at, revoked_at IS NULL AS active
         FROM entitlements
        WHERE client_id = $1
        ORDER BY granted_at DESC LIMIT 12`,
      [id]
    )
  };
}

await c.end();

const out = {
  at: new Date().toISOString(),
  opened_live: false,
  recent_signed: recent.map((r) => ({
    id: r.id,
    who: who(r.client_id),
    status: r.status,
    template_key: r.template_key,
    signed_at: r.signed_at,
    created_at: r.created_at
  })),
  recent_events: events.map((r) => ({
    id: r.id,
    who: who(r.client_id),
    created_at: r.created_at
  })),
  product_entitlements_total: entitlements[0],
  byClient
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "sign.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  recent_n: out.recent_signed.length,
  recent: out.recent_signed,
  events: out.recent_events,
  entitlements_total: out.product_entitlements_total,
  test_signed: byClient.TEST.contracts_signed.map((r) => r.template_key),
  live_signed: byClient.LIVE.contracts_signed.map((r) => r.template_key),
  funnel_signed: byClient.FUNNEL.contracts_signed.map((r) => r.template_key),
  test_entitlements_n: byClient.TEST.entitlements.length,
  live_entitlements_n: byClient.LIVE.entitlements.length
}, null, 2));
