/**
 * U7 — inquiry complete → next round. Read-only prove. No fake event. No Mark Cleared.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u7");
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";

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
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
fs.mkdirSync(OUT, { recursive: true });

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

async function q(sql, params = []) {
  try {
    const r = await c.query(sql, params);
    return { ok: true, n: r.rows.length, rows: r.rows };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 240) };
  }
}

const out = {
  at: new Date().toISOString(),
  test_client: TEST_CLIENT,
  opened_forbidden: false,
  env_names: {
    INNGEST_EVENT_KEY: !!String(process.env.INNGEST_EVENT_KEY || "").trim(),
    INNGEST_SIGNING_KEY: !!String(process.env.INNGEST_SIGNING_KEY || "").trim()
  },
  did_not_press_mark_cleared: true,
  did_not_write_inquiry_removed: true
};

out.inquiry_removed_all = await q(
  `SELECT count(*)::int AS n, max(created_at) AS last FROM events WHERE name = 'inquiry.removed'`
);
out.inquiry_removed_test = await q(
  `SELECT count(*)::int AS n FROM events WHERE name = 'inquiry.removed' AND client_id = $1`,
  [TEST_CLIENT]
);
out.inquiry_events_test = await q(
  `SELECT name, count(*)::int AS n, max(created_at) AS last
     FROM events WHERE client_id = $1 AND name ILIKE '%inquir%'
     GROUP BY name ORDER BY name`,
  [TEST_CLIENT]
);

out.cases_test = await q(
  `SELECT id, case_status, call_fired_at IS NOT NULL AS call_fired,
          first_delivery_at IS NOT NULL AS delivered
     FROM inquiry_removal_cases WHERE client_id = $1 ORDER BY created_at DESC`,
  [TEST_CLIENT]
);
out.cases_completed_all = await q(
  `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE case_status = 'Completed')::int AS completed,
          count(*) FILTER (WHERE case_status = 'Queued')::int AS queued
     FROM inquiry_removal_cases`
);
out.cases_completed_test = await q(
  `SELECT count(*)::int AS n FROM inquiry_removal_cases
     WHERE client_id = $1 AND case_status = 'Completed'`,
  [TEST_CLIENT]
);

out.tasks_c03 = await q(
  `SELECT id, title, source_workflow, created_at
     FROM tasks
     WHERE source_workflow = 'c-03-inquiry-removed-resume-or-hold'
        OR title ILIKE '%next funding%'
        OR title ILIKE '%Start next funding%'
     ORDER BY created_at DESC LIMIT 20`
);
out.tasks_c03_test = await q(
  `SELECT id, title, source_workflow
     FROM tasks WHERE client_id = $1
       AND (source_workflow = 'c-03-inquiry-removed-resume-or-hold'
            OR title ILIKE '%next funding%')`,
  [TEST_CLIENT]
);

out.tags_completed = await q(
  `SELECT client_id = $1 AS is_test, count(*)::int AS n
     FROM client_tags
     WHERE tag = 'inquiry:completed'
     GROUP BY 1`,
  [TEST_CLIENT]
);

out.failed_c03 = await q(
  `SELECT count(*)::int AS n, max(last_seen_at) AS last
     FROM failed_events
     WHERE event_name = 'inquiry.removed'
        OR handler_name ILIKE '%c-03%'`
);

out.funding_rounds_test = await q(
  `SELECT id, round_number, status, created_at
     FROM funding_rounds WHERE client_id = $1 ORDER BY created_at DESC LIMIT 10`,
  [TEST_CLIENT]
);

out.custom_next = await q(
  `SELECT
     (custom_fields->>'ready_for_next_round') AS ready_for_next_round,
     (custom_fields->>'employee_next_action') AS employee_next_action
     FROM clients WHERE id = $1`,
  [TEST_CLIENT]
);

out.forbidden_untouched = true;
await c.end();

fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  wrote: "u7/db.json",
  inquiry_removed_all: out.inquiry_removed_all.rows?.[0] || out.inquiry_removed_all,
  inquiry_removed_test: out.inquiry_removed_test.rows?.[0] || out.inquiry_removed_test,
  cases_test: out.cases_test.rows || [],
  completed_all: out.cases_completed_all.rows?.[0] || null,
  tasks_c03_n: out.tasks_c03.n,
  tasks_c03_test: out.tasks_c03_test.n,
  tags: out.tags_completed.rows || out.tags_completed,
  failed_c03: out.failed_c03.rows?.[0] || out.failed_c03,
  rounds: out.funding_rounds_test.n,
  custom: out.custom_next.rows?.[0] || out.custom_next,
  inngest_key_set: out.env_names.INNGEST_EVENT_KEY
}, null, 2));
