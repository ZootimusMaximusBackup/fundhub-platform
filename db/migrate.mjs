// Migrations runner (Spec §16 Phase 0). Applies db/schema/*.sql then db/seed/*.sql
// in filename order, tracking applied files in a schema_migrations table so it's
// idempotent + safe to re-run. Each file runs in its own transaction.
//
// Usage: MIGRATION_DATABASE_URL=postgres://... node db/migrate.mjs
//    or: DATABASE_URL=postgres://... node db/migrate.mjs   (see below)
//
// Inside a Netlify build this runs on the production context ONLY — every other
// context exits 0 without touching the database. See the rule below.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, close, dbTarget } from "../src/db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIRS = ["schema", "migrations", "seed"];

/* MIGRATIONS RUN ON THE PRODUCTION DEPLOY ONLY. Owner rule, set 2026-08-19.

   netlify.toml is the primary control: only [context.production] invokes this
   file. This is the second lock, and it exists because the first one is a
   config line anyone can change without noticing what it protects.

   The hazard it closes: Netlify hands MIGRATION_DATABASE_URL to deploy previews
   and branch deploys as readily as to production, and there is only one
   database behind it. So until today, merely OPENING a pull request applied its
   migrations to the live database. Measured 2026-08-19: PR #86's three
   migrations landed on production at 03:20, twenty minutes before anyone merged
   them at 03:42. Those three were safe. The next ones might not be, and by the
   time a reviewer reads the diff the database has already obeyed it.

   Scope, deliberately narrow. This only fires inside a Netlify build. Running
   `node db/migrate.mjs` on a laptop, in CI, or by hand against a scratch
   database is untouched — CONTEXT is unset there and the rule does not apply.
   The command in CLAUDE.md §11 still works exactly as written.

   Exit 0, not 1. A skipped migration is the intended outcome in a preview, not
   a failure, and it must not red the build. The preview will run against a
   database that does not have the new shape yet; /api/health will report
   `pending` above zero. That is the honest signal, and it belongs to the
   preview rather than to production. */
const NETLIFY_CONTEXT = String(process.env.CONTEXT || "").trim();
const NETLIFY_CONTEXTS = ["production", "deploy-preview", "branch-deploy", "dev"];
const IN_NETLIFY_BUILD =
  !!process.env.NETLIFY || NETLIFY_CONTEXTS.includes(NETLIFY_CONTEXT);

if (IN_NETLIFY_BUILD && NETLIFY_CONTEXT !== "production") {
  console.log(
    `→ skipping migrations: Netlify context is ` +
    `"${NETLIFY_CONTEXT || "(unset)"}", not "production".\n` +
    `  Migrations run on the production deploy only (owner rule, 2026-08-19).\n` +
    `  This build shares the live database; a preview must not reshape it.`
  );
  process.exit(0);
}

/* WHICH CONNECTION MIGRATIONS USE, AND WHY IT IS NO LONGER DATABASE_URL.

   104_app_role.sql splits one connection string into two identities. The app
   runs as `fundhub_app`, which holds SELECT/INSERT/UPDATE/DELETE and nothing
   else — deliberately no CREATE on the schema, because a web request has no
   business reshaping tables. Migrations do exactly that, so they cannot run as
   the app.

   Without this preference, the first migration written after the switch fails
   with a permission error, and it fails at the least convenient moment: after
   the deploy, when someone is trying to ship. So the runner asks for the admin
   connection by name.

   The fallback to DATABASE_URL is what keeps every existing habit working —
   a local scratch database, a fresh clone, and the command in CLAUDE.md §11 all
   still run unchanged. This is a preference, not a requirement.

   Set before pool() is ever called. src/db.mjs reads process.env.DATABASE_URL
   lazily on first use, not at import time, so assigning here is what the pool
   picks up.

   Local `netlify deploy --build --prod` injects secret env as asterisks
   (`netlify env:get` does the same). Those strings are not connections — they
   parsed as host `base` and died with ENOTFOUND. Treat `*` as unset, then read
   the same names from gitignored `.env` when that file has a real URL. Never
   log the value. */
function looksMasked(value) {
  return typeof value === "string" && value.includes("*");
}

function usableUrl(value) {
  if (!value || looksMasked(value)) return "";
  try {
    const host = new URL(value).hostname || "";
    if (!host || host === "base") return "";
    return value;
  } catch {
    return "";
  }
}

function urlsFromDotenv() {
  const envPath = path.join(HERE, "..", ".env");
  const out = { DATABASE_URL: "", MIGRATION_DATABASE_URL: "" };
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== "DATABASE_URL" && key !== "MIGRATION_DATABASE_URL") continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

(function resolveMigrateUrl() {
  let admin = usableUrl(process.env.MIGRATION_DATABASE_URL);
  let app = usableUrl(process.env.DATABASE_URL);
  // Only read `.env` when the CLI injected asterisks. Empty means unset, and
  // tests rely on that staying unset.
  if (
    looksMasked(process.env.MIGRATION_DATABASE_URL) ||
    looksMasked(process.env.DATABASE_URL)
  ) {
    const fromFile = urlsFromDotenv();
    if (looksMasked(process.env.MIGRATION_DATABASE_URL)) {
      admin = usableUrl(fromFile.MIGRATION_DATABASE_URL) || admin;
    }
    if (looksMasked(process.env.DATABASE_URL) || !app) {
      app = usableUrl(fromFile.DATABASE_URL) || app;
    }
  }
  if (admin) {
    process.env.DATABASE_URL = admin;
    console.log("→ connecting with MIGRATION_DATABASE_URL (admin/owner identity)");
  } else if (app) {
    process.env.DATABASE_URL = app;
    console.log("→ MIGRATION_DATABASE_URL not set; falling back to DATABASE_URL");
    console.log("  If that is now the restricted app role, migrations creating or");
    console.log("  altering tables will fail with a permission error. See");
    console.log("  docs/runbooks/postgres-least-privilege.md");
  }
  const url = process.env.DATABASE_URL || "";
  if (!url) return;
  const ok = usableUrl(url);
  if (!ok) {
    console.error(
      "FATAL: DATABASE_URL/MIGRATION_DATABASE_URL looks masked or is not a " +
        "real Postgres address. Do not export `netlify env:get` into the shell. " +
        "Unset both so `.env` or the production build can supply the real values."
    );
    process.exit(1);
  }
  console.log(`→ migrate target ${dbTarget(ok)}`);
})();

function collect() {
  const files = [];
  for (const d of DIRS) {
    const dir = path.join(HERE, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      files.push({ key: `${d}/${f}`, path: path.join(dir, f) });
    }
  }
  return files;
}

async function main() {
  const p = pool();
  try {
    await p.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  } catch (err) {
    // App-role fallback: CREATE is denied, but an already-migrated database
    // still has the table. New files still need the admin URL.
    try {
      await p.query(`SELECT 1 FROM schema_migrations LIMIT 1`);
      console.log("→ schema_migrations already exists; continuing without CREATE");
    } catch {
      throw err;
    }
  }
  const applied = new Set((await p.query(`SELECT key FROM schema_migrations`)).rows.map((r) => r.key));

  let ran = 0;
  for (const f of collect()) {
    if (applied.has(f.key)) { console.log(`· skip ${f.key} (already applied)`); continue; }
    const sql = fs.readFileSync(f.path, "utf8");
    const client = await p.connect();
    // Postgres NOTICE messages (RAISE NOTICE inside a migration's own DO
    // blocks — 090/104/105/106 all use this to report what they verified) were
    // never surfaced anywhere: node-postgres emits them as a 'notice' event
    // on the client, and nothing here was listening. A migration could report
    // success on stdout while its own RAISE NOTICE, containing the actual
    // finding, went straight to /dev/null. Print it, prefixed so it reads as
    // coming from inside the file rather than from this runner.
    //
    // MUST BE REMOVED BEFORE THE CLIENT GOES BACK TO THE POOL. `p.connect()`
    // hands back a pooled Client that gets REUSED across later iterations of
    // this same loop, not a fresh one per file. A bound closure that is never
    // unbound accumulates on whichever underlying client this happens to be —
    // confirmed while testing this exact change: by file ~91 of 106,
    // node-postgres logs "MaxListenersExceededWarning: 11 notice listeners
    // added to [Client]", and one real notice on a later file fires every
    // stale listener still attached, each printing with the WRONG file's key.
    // Keeping the handler in a named variable so `.off()` can find the exact
    // one `.on()` just added, not any other file's.
    const onNotice = (msg) => console.log(`  [${f.key}] ${msg.message}`);
    client.on("notice", onNotice);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (key) VALUES ($1)`, [f.key]);
      await client.query("COMMIT");
      console.log(`✔ applied ${f.key}`);
      ran += 1;
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`✗ FAILED ${f.key}: ${e.message}`);
      throw e;
    } finally {
      client.off("notice", onNotice);
      client.release();
    }
  }
  console.log(`\nDone. ${ran} migration(s) applied.`);
  await close();
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
