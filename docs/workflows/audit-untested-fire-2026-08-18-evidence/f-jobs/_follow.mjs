/**
 * F-JOBS follow: named Inngest function runs + one failed s-02 error (no PII).
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-fire-2026-08-18-evidence/f-jobs");

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

async function inn(pathname) {
  const r = await fetch("https://api.inngest.com" + pathname, {
    headers: {
      authorization: "Bearer " + (process.env.INNGEST_SIGNING_KEY || ""),
      accept: "application/json"
    }
  });
  const json = await r.json().catch(() => null);
  const data = json && Array.isArray(json.data) ? json.data : [];
  return {
    path: pathname,
    status: r.status,
    error: json && (json.error || json.message) || null,
    keys: json ? Object.keys(json) : [],
    n: data.length,
    runs: data.slice(0, 8).map((row) => ({
      id: row.run_id || row.id || null,
      status: row.status || null,
      function_id: row.function_id || row.function?.id || null
    })),
    failed_sample: data.filter((row) => row.status === "FAILED").slice(0, 3).map((row) => ({
      id: row.run_id || row.id || null,
      function_id: row.function_id || row.function?.id || null,
      output_type: typeof row.output,
      output_keys: row.output && typeof row.output === "object" ? Object.keys(row.output) : null,
      error_preview: String(
        (row.output && (row.output.error || row.output.message)) ||
        row.error ||
        ""
      ).replace(/\S+@\S+/g, "[email]").replace(/\+1\d{10}/g, "[phone]").slice(0, 180)
    }))
  };
}

const out = {
  at: new Date().toISOString(),
  deploy: {
    id: "6a84d3bba08d3e85dc48dfd5",
    state: "ready",
    published_at: "2026-08-18T21:51:40.938Z"
  },
  probes: {}
};

out.probes.failed = await inn("/v2/runs?limit=20&status=FAILED");
out.probes.c03 = await inn("/v2/runs?limit=10&functionId=c-03-inquiry-removed-resume-or-hold");
out.probes.s04b = await inn("/v2/runs?limit=10&functionId=s-04b-booking-reminders");
out.probes.dpc03 = await inn("/v2/runs?limit=10&functionId=dpc-03-inbound-reply-router");
out.probes.app = await inn("/v1/apps");
out.probes.s02_one = await inn("/v2/runs/01M0BDG138226Z86CT6EWYHNS4");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  const booking = await client.query(
    `SELECT id, name, client_id, created_at,
            (payload ? 'startTime') AS has_start,
            (payload->>'source') AS source
       FROM events WHERE id = 'f370a046-46a4-4d8a-a58e-d0d421a73d98'`
  );
  const bookingByTime = await client.query(
    `SELECT id, client_id IS NOT NULL AS has_client, created_at
       FROM events
      WHERE name = 'booking.created'
        AND created_at >= '2026-08-18T21:40:00Z'
      ORDER BY created_at DESC LIMIT 5`
  );
  const funding = await client.query(
    `SELECT COUNT(*)::int AS n FROM funding_rounds
      WHERE client_id = '8556bedc-46e1-4d85-b0cd-a24adfee1521'`
  );
  out.db = {
    booking_row: booking.rows.map((r) => ({
      id: r.id,
      name: r.name,
      has_client: Boolean(r.client_id),
      created_at: r.created_at,
      has_start: r.has_start,
      source: r.source
    })),
    booking_since_fire: bookingByTime.rows,
    test_funding_rounds: funding.rows[0]
  };
} catch (err) {
  out.db = { ok: false, error: String(err.message || err).slice(0, 220) };
} finally {
  try { await client.end(); } catch { /* ignore */ }
}

fs.writeFileSync(path.join(OUT, "follow.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  failed_n: out.probes.failed.n,
  failed_fns: [...new Set(out.probes.failed.runs.map((r) => r.function_id))],
  failed_err: out.probes.failed.failed_sample,
  c03: { status: out.probes.c03.status, n: out.probes.c03.n, error: out.probes.c03.error },
  s04b: { status: out.probes.s04b.status, n: out.probes.s04b.n, error: out.probes.s04b.error },
  dpc03: { status: out.probes.dpc03.status, n: out.probes.dpc03.n, error: out.probes.dpc03.error },
  s02_one: { status: out.probes.s02_one.status, keys: out.probes.s02_one.keys, error: out.probes.s02_one.error },
  db: out.db
}, null, 2));
