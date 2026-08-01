// Prints which database DATABASE_URL (and MIGRATION_DATABASE_URL, if set)
// point at — host and database name ONLY, never the password. Safe to run
// anywhere, safe to paste the output anywhere.
//
// WHY THIS EXISTS. scripts/seed-role-accounts.mjs reads DATABASE_URL from
// whatever shell runs it. The live site reads its own DATABASE_URL from
// Netlify's environment variables. Those are two separate places a value gets
// set, and nothing before this compared them — "the seed script ran clean"
// proves it wrote somewhere, not that it wrote to the same database the
// deployed login handler reads from.
//
// Run this in the SAME shell you used to run scripts/seed-role-accounts.mjs:
//
//   node scripts/print-db-target.mjs
//
// Then compare its output to what src/db.mjs now logs on every cold start —
// "db: connecting to <host>/<database>" — in Netlify's function logs for
// /api/auth/login (Netlify dashboard → your site → Logs → Functions, or
// `netlify functions:log api` from a machine that has netlify CLI access,
// which this session does not — see CLAUDE.md §11). If the two don't match,
// that's the whole bug: fix Netlify's DATABASE_URL for the production
// context, not the seed script.

import { dbTarget } from "../src/db.mjs";

console.log("DATABASE_URL           →", dbTarget(process.env.DATABASE_URL));
console.log("MIGRATION_DATABASE_URL →", dbTarget(process.env.MIGRATION_DATABASE_URL));

if (!process.env.DATABASE_URL && !process.env.MIGRATION_DATABASE_URL) {
  console.log("\nNeither is set in this shell.");
}
