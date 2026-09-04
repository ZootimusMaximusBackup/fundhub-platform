#!/usr/bin/env node
// scripts/sim/set-client-password.mjs — set the portal password on ONE client
// login, so a walkthrough can sign in as that client without a magic link.
//
//   SIM_CLIENT_PASSWORD='…' DATABASE_URL=… \
//     node scripts/sim/set-client-password.mjs --email stanbridgejchris+sim-01@gmail.com
//
//   # or reuse the shared test password already in the local .env
//   TEST_ACCOUNT_PASSWORD='…' DATABASE_URL=… \
//     node scripts/sim/set-client-password.mjs --email … [--dry]
//
// WHY THIS FILE EXISTS (F32, manual walk 2026-09-03). The same reset was being
// done with ad-hoc `node -e "…"` one-liners. Every one of those is a brand-new
// command string, so the agent harness asks for permission every single time,
// and twice on the walk the write was refused outright and Chris had to paste
// the command into his own terminal mid-call-simulation. A named script is a
// stable command: approve it once and it stops interrupting the walk.
//
// THE PASSWORD COMES FROM THE ENVIRONMENT, NEVER FROM AN ARGUMENT. A command
// line lands in shell history, in `ps` output, and in this repo's own session
// transcripts. `--password` is therefore refused rather than ignored, so the
// mistake is loud instead of silent. The value is never printed back, and the
// stored hash is never printed either.
//
// SCOPE. It touches `accounts` rows with kind='client' and nothing else — not
// staff, not affiliates, not partners. It resolves exactly one account by
// email inside the default company and refuses if that email is ambiguous or
// missing, because "which login did I just change?" is not a question worth
// having after the fact.

import { pool, close } from "../../src/db.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { hashPassword, validatePassword } from "../../src/auth/hash.mjs";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

/* readPassword — the environment, in one place, with the reason for each name.
   SIM_CLIENT_PASSWORD is the explicit one and wins. TEST_ACCOUNT_PASSWORD is
   the shared password every seeded test/sim login already uses and lives in the
   local .env, so the common walkthrough case needs nothing exported by hand. */
export function readPassword(env = process.env) {
  const explicit = String(env.SIM_CLIENT_PASSWORD || "");
  if (explicit) return { password: explicit, source: "SIM_CLIENT_PASSWORD" };
  const shared = String(env.TEST_ACCOUNT_PASSWORD || "");
  if (shared) return { password: shared, source: "TEST_ACCOUNT_PASSWORD" };
  return { password: null, source: null };
}

/* passwordOnArgv — is somebody trying to pass the secret on the command line?
   Matches `--password`, `--pass`, `--pw` and their `=value` forms. */
export function passwordOnArgv(argv = process.argv) {
  return argv.some((a) => /^--(password|pass|pw)(=|$)/i.test(String(a)));
}

async function main() {
  const email = String(arg("email", "")).trim().toLowerCase();
  const dry = process.argv.includes("--dry");

  if (!email) {
    console.error("usage: SIM_CLIENT_PASSWORD='…' node scripts/sim/set-client-password.mjs --email <client email> [--dry]");
    console.error("       the password is read from SIM_CLIENT_PASSWORD, or TEST_ACCOUNT_PASSWORD as a fallback.");
    process.exit(2);
  }
  if (passwordOnArgv()) {
    console.error("refusing: the password must not be an argument — a command line is recorded in shell history and in ps.");
    console.error("set SIM_CLIENT_PASSWORD in the environment instead.");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(2); }

  const { password, source } = readPassword();
  if (!password) {
    console.error("no password in the environment — set SIM_CLIENT_PASSWORD (or TEST_ACCOUNT_PASSWORD).");
    process.exit(2);
  }
  // hashPassword throws on a bad password, but the message would arrive after
  // the lookup. Fail before touching the database so nothing half-happens.
  const bad = validatePassword(password);
  if (bad) { console.error(`password rejected: ${bad}`); process.exit(2); }

  /* No `set_config('fundhub.actor', …)` here, deliberately. That stamp is for
     the creative-factory tables (045_creative_factory.sql); `accounts` and
     `clients` carry no row-security policies, so it would buy nothing — and on
     a pool it is actively misleading, because pool.query() checks out a
     different connection per call and a session setting made on one does not
     apply to the next. scripts/purge-sim-data.mjs stamps on a single pg.Client
     for exactly that reason; do not copy the stamp here without the client. */
  const db = pool();
  const orgId = await resolveDefaultOrg(db);
  const { rows } = await db.query(
    `SELECT a.id, a.status, a.client_id, c.first_name, c.last_name
       FROM accounts a
       LEFT JOIN clients c ON c.id = a.client_id
      WHERE a.org_id = $1 AND a.kind = 'client' AND lower(a.email) = $2
      ORDER BY a.created_at DESC`,
    [orgId, email]
  );

  if (rows.length === 0) {
    console.error(`no client login for ${email} in the default company — the client has to be invited to the portal first`);
    process.exit(1);
  }
  // accounts_email_uniq makes this impossible today; if the index ever moves,
  // silently picking one row would change a login nobody meant to change.
  if (rows.length > 1) {
    console.error(`${rows.length} client logins share ${email} — refusing to guess which one to change`);
    process.exit(1);
  }

  const acct = rows[0];
  const name = [acct.first_name, acct.last_name].filter(Boolean).join(" ") || "(no client record)";
  console.log(`account  ${acct.id} · client ${acct.client_id} · ${name}`);
  console.log(`status   ${acct.status}${acct.status === "active" ? "" : " → active"}`);
  console.log(`password read from ${source} (value not shown)`);
  if (dry) { console.log("dry run — nothing written"); await close(); return; }

  const password_hash = await hashPassword(password);

  /* status goes to 'active' and activated_at is stamped if it was not already:
     044_accounts.sql's accounts_active_needs_hash says an active account must be
     able to authenticate, and the mirror of that is that an account which CAN
     authenticate should not be left sitting at 'invited' where login refuses it.
     A suspended account is deliberately left suspended — suspension is a
     decision, and a password reset is not the place to undo it. */
  const updated = (await db.query(
    `UPDATE accounts
        SET password_hash = $2,
            status        = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
            activated_at  = COALESCE(activated_at, now()),
            updated_at    = now()
      WHERE id = $1
      RETURNING id, kind, status`,
    [acct.id, password_hash]
  )).rows[0];

  console.log(`written  account ${updated.id} kind=${updated.kind} status=${updated.status}`);
  console.log("the client can now sign in at /portal with this email and that password");
  await close();
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(async (e) => { console.error(e); try { await close(); } catch { /* noop */ } process.exit(1); });
}
