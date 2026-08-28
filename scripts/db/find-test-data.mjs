#!/usr/bin/env node
// find-test-data — show the test leftovers sitting in a database, and (only when
// explicitly told to) clear them out.
//
// ============================================================================
// *** DRY RUN IS THE DEFAULT. --apply IS THE ONLY WAY THIS TOOL WRITES. ***
// ============================================================================
//
//   Show me what is lingering — changes nothing:
//     DATABASE_URL="..." node scripts/db/find-test-data.mjs
//
//   For real — this DELETES DATA:
//     DATABASE_URL="..." node scripts/db/find-test-data.mjs --apply
//
// ============================================================================
// THE ONE THING THIS TOOL WILL NOT DO
// ============================================================================
//
// It will not delete a row it cannot prove is a test row.
//
// In the schema a hand-made test client and a real paying customer are the same
// shape. Both have a name, an email, documents, contracts. Nothing separates
// them except a marker somebody set at the time. So this tool splits what it
// finds into two lists and treats them completely differently:
//
//   MARKED   — carries a machine-readable test marker (below). --apply deletes.
//   UNMARKED — recent, no marker. Listed for a human to read. NEVER deleted,
//              not even with --apply. There is no flag that changes this.
//
// The UNMARKED list is the honest answer to "just delete the obvious ones".
// A person can look at a name and know. This tool cannot, and a tool that
// guesses at which consumer-credit records to destroy is a defect, not a
// feature. Read the list, then pass the ids you recognise with --client.
//
// ============================================================================
// HOW A ROW GETS DELETED
// ============================================================================
//
// This file contains no DELETE statement. --apply stamps is_demo = true on the
// marked rows and then hands them to teardownSimulated() in
// src/demo/simulate-client.mjs, which is the delete path that already exists,
// already walks every child table by foreign key, and already refuses any
// client whose is_demo is not true. Reusing it means there is one delete path
// to get right instead of two that drift apart.
//
// ============================================================================
// WHAT COUNTS AS A MARKER
// ============================================================================
//
//   is_demo = true                      the simulator's own flag
//   tags @> {e2e_verify}                src/verification/insert-client.mjs
//   channel_source = 'journey-runner'   src/journeys/runner/synthetic.mjs
//   custom_fields->>'synthetic'         same runner, second marker
//   email like 'sim+%'                  DEMO_EMAIL_PREFIX
//   email like '%@demo.fundhub.local'   DEMO_EMAIL_DOMAIN
//
// A marker is proof somebody's code created the row. A real signup sets none of
// them.

import { db, dbTarget, close } from "../../src/db.mjs";
import { teardownSimulated } from "../../src/demo/simulate-client.mjs";
import { testEmailTag } from "../../src/demo/test-identity.mjs";

/* Each marker is one SQL predicate over `clients c`, named so the report can
   say which one caught a row. Kept as data, not branches, so the dry run and
   the delete cannot fall out of step — both read this list. */
export function markers(env = process.env) {
  const out = [
    { name: "is_demo flag",      sql: "COALESCE(c.is_demo, false) = true" },
    { name: "e2e_verify tag",    sql: "c.tags @> ARRAY['e2e_verify']::text[]" },
    { name: "journey runner",    sql: "c.channel_source = 'journey-runner'" },
    { name: "synthetic marker",  sql: "COALESCE(c.custom_fields->>'synthetic','') = 'true'" },
    { name: "simulator email",   sql: "(c.email LIKE 'sim+%' OR c.email LIKE '%@demo.fundhub.local')" },
  ];

  /* The plus-tag from src/demo/test-identity.mjs. Rows created after that landed
     are already is_demo = true and caught by the first marker; this one exists
     for rows a tester tagged BEFORE it shipped, which carry the tag but not the
     flag. Only a tag made of plain word characters is interpolated — anything
     else is dropped rather than escaped, because a marker is a fixed predicate
     and there is no legitimate tag that needs a quote in it. */
  const tag = testEmailTag(env);
  if (tag && /^[a-z0-9._-]+$/.test(tag)) {
    out.push({ name: `+${tag} email tag`, sql: `c.email ILIKE '%+${tag}%@%'` });
  }
  return Object.freeze(out);
}

export const MARKERS = markers();

const markedSql = (env = process.env) => markers(env).map((m) => `(${m.sql})`).join(" OR ");

export function parseArgs(argv) {
  const out = { apply: false, days: 30, org: null, clients: [], help: false };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    switch (a) {
      case "--apply":  out.apply = true; break;
      case "--days":   out.days = Number(rest.shift()); break;
      case "--org":    out.org = rest.shift(); break;
      case "--client": out.clients.push(rest.shift()); break;
      case "-h":
      case "--help":   out.help = true; break;
      default:
        if (a?.startsWith("-")) throw new Error(`unknown option ${a}`);
    }
  }
  if (!Number.isFinite(out.days) || out.days < 0) throw new Error("--days must be a number");
  return out;
}

export function usage() {
  return `
find-test-data — show test leftovers; delete only what is provably a test row.

  Show what is there (changes nothing):
    DATABASE_URL="..." node scripts/db/find-test-data.mjs

  Delete the marked rows:
    DATABASE_URL="..." node scripts/db/find-test-data.mjs --apply

  Delete rows YOU identified from the unmarked list:
    DATABASE_URL="..." node scripts/db/find-test-data.mjs --client <id> --client <id> --apply

  --apply          Actually delete. Without it nothing is written.
  --days <n>       How far back the unmarked review list looks. Default 30.
  --org <uuid>     Limit to one org. Default: every org.
  --client <uuid>  Delete this exact client even though it carries no marker.
                   Repeatable. This is how you act on the unmarked list.
`.trimStart();
}

/* One row per client, plus how much is hanging off it. The counts are what make
   the report readable — "Jane Doe, 4 messages, 1 contract" is a thing a person
   can recognise; a bare uuid is not. */
const ATTACHMENTS = `
  (SELECT count(*) FROM messages  m WHERE m.client_id  = c.id)::int AS messages,
  (SELECT count(*) FROM documents d WHERE d.client_id  = c.id)::int AS documents,
  (SELECT count(*) FROM contracts k WHERE k.client_id  = c.id)::int AS contracts,
  (SELECT count(*) FROM invoices  i WHERE i.client_id  = c.id)::int AS invoices`;

export async function findMarked(dbh, { org = null, env = process.env } = {}) {
  const where = [`(${markedSql(env)})`];
  const params = [];
  if (org) { params.push(org); where.push(`c.org_id = $${params.length}`); }
  const { rows } = await dbh.query(
    `SELECT c.id, c.org_id, c.email, c.first_name, c.last_name, c.created_at,
            ${ATTACHMENTS},
            ARRAY(SELECT m FROM unnest(ARRAY[${markers(env).map((m) =>
              `CASE WHEN ${m.sql} THEN '${m.name}' END`).join(",")}]) AS m
                   WHERE m IS NOT NULL) AS why
       FROM clients c
      WHERE ${where.join(" AND ")}
      ORDER BY c.created_at DESC`, params);
  return rows;
}

export async function findUnmarked(dbh, { days = 30, org = null, env = process.env } = {}) {
  const params = [days];
  const where = [`NOT (${markedSql(env)})`, `c.created_at >= now() - ($1 || ' days')::interval`];
  if (org) { params.push(org); where.push(`c.org_id = $${params.length}`); }
  const { rows } = await dbh.query(
    `SELECT c.id, c.org_id, c.email, c.first_name, c.last_name, c.created_at,
            ${ATTACHMENTS}
       FROM clients c
      WHERE ${where.join(" AND ")}
      ORDER BY c.created_at DESC`, params);
  return rows;
}

function line(r, showWhy) {
  const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || "(no name)";
  const when = new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ");
  const bits = [];
  if (r.messages)  bits.push(`${r.messages} message${r.messages === 1 ? "" : "s"}`);
  if (r.documents) bits.push(`${r.documents} document${r.documents === 1 ? "" : "s"}`);
  if (r.contracts) bits.push(`${r.contracts} contract${r.contracts === 1 ? "" : "s"}`);
  if (r.invoices)  bits.push(`${r.invoices} invoice${r.invoices === 1 ? "" : "s"}`);
  const attached = bits.length ? bits.join(", ") : "nothing attached";
  const why = showWhy ? `  [${(r.why || []).join(", ")}]` : "";
  return `  ${when}  ${name} <${r.email || "no email"}>\n     ${r.id}  —  ${attached}${why}`;
}

export async function main(argv = process.argv.slice(2), { dbh = db, out = console } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (e) { out.error(e.message); return 2; }
  if (args.help) { out.log(usage()); return 0; }

  if (!process.env.DATABASE_URL) {
    out.error("DATABASE_URL is not set — refusing to run.");
    return 2;
  }
  out.log(`Database: ${dbTarget()}`);
  out.log(args.apply ? "Mode:     APPLY — this will delete." : "Mode:     dry run — nothing will be written.");
  out.log("");

  const marked = await findMarked(dbh, { org: args.org });
  out.log(`MARKED AS TEST DATA — ${marked.length} client${marked.length === 1 ? "" : "s"}`);
  out.log("These carry a marker only our own code sets. Safe to delete.");
  out.log("");
  if (!marked.length) out.log("  (none)");
  for (const r of marked) out.log(line(r, true));
  out.log("");

  const unmarked = await findUnmarked(dbh, { days: args.days, org: args.org });
  out.log(`NO MARKER — ${unmarked.length} client${unmarked.length === 1 ? "" : "s"} from the last ${args.days} days`);
  out.log("These look exactly like real customers to this tool. It will NEVER delete them.");
  out.log("Read the list. Re-run with --client <id> for each one you recognise as a test.");
  out.log("");
  if (!unmarked.length) out.log("  (none)");
  for (const r of unmarked) out.log(line(r, false));
  out.log("");

  const named = new Set(args.clients);
  const targets = [...marked.map((r) => r), ...unmarked.filter((r) => named.has(r.id))];

  for (const id of named) {
    if (!targets.some((r) => r.id === id)) out.error(`--client ${id}: no such client in range. Skipped.`);
  }

  if (!args.apply) {
    out.log(`This was a DRY RUN. Nothing changed.`);
    out.log(`Add --apply to delete the ${marked.length} marked client${marked.length === 1 ? "" : "s"}` +
            (named.size ? ` plus the ${named.size} you named.` : "."));
    return 0;
  }

  if (!targets.length) { out.log("Nothing to delete."); return 0; }

  /* Stamp, then hand to the delete path that already exists. teardownSimulated
     re-checks is_demo itself before it removes anything, so the stamp is a
     precondition it verifies rather than a promise it trusts. */
  let removed = 0;
  for (const r of targets) {
    await dbh.query(`UPDATE clients SET is_demo = true WHERE id = $1`, [r.id]);
    const res = await teardownSimulated(dbh, { orgId: r.org_id, clientId: r.id });
    removed += res?.removed?.length ?? (res?.matched ? 1 : 0);
  }
  out.log(`Deleted ${removed} client${removed === 1 ? "" : "s"} and everything attached to them.`);
  return 0;
}

/* Only run when invoked directly, so the tests can import the pieces. */
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(async (code) => { await close(); process.exit(code); })
        .catch(async (e) => { console.error(e); await close(); process.exit(1); });
}
