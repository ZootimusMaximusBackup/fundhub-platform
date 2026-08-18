import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../../");
function readEnvKey(key) {
  const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  let v = m[1];
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
  return v;
}
const client = new pg.Client({
  connectionString: readEnvKey("DATABASE_URL"),
  ssl: { rejectUnauthorized: false },
  statement_timeout: 30000
});
await client.connect();
const q = await client.query(`
  SELECT
    (SELECT count(*) FROM call_outcomes) AS call_outcomes_n,
    (SELECT count(*) FROM call_outcomes WHERE checklist IS NOT NULL) AS call_outcomes_with_checklist,
    (SELECT count(*) FROM entitlement_catalog) AS catalog_n,
    (SELECT count(*) FROM entitlement_catalog WHERE display_price_cents IS NOT NULL) AS catalog_with_price,
    (SELECT count(*) FROM content_videos) AS content_videos_n,
    (SELECT count(*) FROM content_tier_map) AS content_tier_map_n
`);
fs.writeFileSync(path.join(HERE, "confirm_170_171_fill.json"), JSON.stringify(q.rows[0], null, 2) + "\n");
console.log(JSON.stringify(q.rows[0]));
await client.end();
