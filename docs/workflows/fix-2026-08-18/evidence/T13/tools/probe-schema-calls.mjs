import pg from "pg";

// Read-only. Point it at whatever database you want to inspect:
//   DATABASE_URL="postgres://..." node probe-agents.mjs
const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL first."); process.exit(1); }
const LOCAL = /localhost|127\.0\.0\.1/.test(url);
const c = new pg.Client({ connectionString: url, ssl: LOCAL ? false : { rejectUnauthorized: false } });
await c.connect();
const q = async (s,p=[]) => (await c.query(s,p)).rows;
const out = { captured_at:new Date().toISOString() };
out.call_completed = await q(
  `SELECT id, created_at, (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(payload) k) AS keys,
   (payload ? 'clientId') AS has_client, payload->>'callId' AS call_id
   FROM events WHERE name='call.completed' ORDER BY created_at`);
out.webhook_capture_providers = await q(
  `SELECT provider, count(*)::int n, max(created_at) newest FROM webhook_captures GROUP BY provider ORDER BY n DESC`);
out.agents_columns = await q(
  `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
   WHERE table_schema='public' AND table_name='agents' ORDER BY ordinal_position`);
out.agents_constraints = await q(
  `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
   WHERE conrelid='public.agents'::regclass ORDER BY conname`);
out.agents_rls = await q(
  `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='public.agents'::regclass`);
out.agents_policies = await q(
  `SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr FROM pg_policy WHERE polrelid='public.agents'::regclass`);
out.latest_migrations = await q(
  `SELECT * FROM schema_migrations ORDER BY 1 DESC LIMIT 6`);
console.log(JSON.stringify(out,null,2));
await c.end();
