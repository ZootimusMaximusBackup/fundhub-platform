// Removes the test/verification data that accumulated in the production database
// as real-looking clients, contracts, messages and documents (2026-08-27).
//
//   npm run sim:report   — count it, change nothing
//   npm run sim:hide     — mark it demo so every screen hides it (reversible)
//   npm run sim:purge    — remove it permanently
//
// RUN sim:report AFTER EVERY END-TO-END AUDIT. An audit run leaves fixtures
// behind; this tells you how many in one line. sim:purge then clears them.
//
// Both were run against production on 2026-08-28: 100 clients and 1,726 child
// rows removed. One test client remains on purpose — see the paid-payout note in
// the FAKE predicate below.
//
// The whole delete runs in ONE transaction: if any part of it fails, nothing is
// removed. It also turns row security off for its session, because a foreign key
// is checked by the database itself and sees rows an ordinary query cannot —
// without that, the delete fails citing a table that looks empty. Every statement
// is pinned to the Fundhub org id so a tenant added later can never be caught.
//
// See docs/workflows/sim-data-removal.md for what was found and why.
import fs from "node:fs";
import pg from "pg";
import { clientChildTables } from "../src/demo/simulate-client.mjs";

const phase = process.argv[2] || "report";
const url = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

// Stamp the staff context the row-security policies read (src/partners/rls.mjs,
// 045_creative_factory.sql). Without it this connection is an anonymous one and
// the policies hide rows from it — but a foreign key is checked by the database
// itself and still sees them, so a delete fails citing a table that our own
// SELECT reports as empty. That was the mismatch, not a missing privilege.
//
// This is the same context the app runs under, NOT a bypass: `SET row_security
// = off` is refused for fundhub_app anyway (it holds neither BYPASSRLS nor
// table ownership, by design — 104_app_role.sql).
await c.query("SELECT set_config('fundhub.actor', 'staff', false)");
await c.query("SELECT set_config('fundhub.partner_id', '', false)");

// One definition of "fake", used by every phase so the count and the delete
// can never drift apart.
// Row security is off for this run, so these statements can see every tenant.
// Today there is exactly one org, but pinning it means a second tenant added
// later can never be caught by a rerun of this script.
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";

const FAKE = `(
  org_id = '${ORG}' AND (
  COALESCE(is_demo,false)
  OR COALESCE(first_name,'') ~* '^(sim|gauntlet|mock|test|demo|probe)'
  OR COALESCE(last_name,'')  ~* '^(sim|gauntlet|mock|test|demo)'
  OR COALESCE(email,'') ~* '(\\+(sim|test|gauntlet|probe|horseman|qa)|@example\\.|@test\\.|demo\\.fundhub\\.local|mailinator|\\.invalid)'
  OR COALESCE(channel_source,'') ~* '^(sim|gauntlet|probe|pipeline|five-|crs-company-prove|live-send-window|platform_demo|simulated)'
  )
  -- …except a client caught up in a PAID affiliate payout run. Deleting it would
  -- cascade to its referral and force a change to a line on a paid statement,
  -- which 033_affiliates.sql forbids outright: a paid run's lines ARE the
  -- statement. One test client (T10 payeelead) is in this position. It stays,
  -- flagged as demo so no screen shows it. Money records win over tidiness.
  AND id NOT IN (
    SELECT ar.client_id FROM affiliate_referrals ar
      JOIN affiliate_payout_lines apl ON apl.referral_id = ar.id
      JOIN affiliate_payouts ap ON ap.id = apl.payout_id
     WHERE ap.status = 'paid' AND ar.client_id IS NOT NULL)
)`;
const FAKE_IDS = `SELECT id FROM clients WHERE ${FAKE}`;

// Contracts on REAL clients that are still test artifacts. The two real
// employment agreements (Sarah Blankstein, Justice Nikkel) are excluded by name.
const FAKE_CONTRACT_EXTRA = `
  client_id NOT IN (${FAKE_IDS})
  AND signer_name IS DISTINCT FROM 'Sarah Blankstein'
  AND signer_name IS DISTINCT FROM 'Justice Nikkel'`;

const kids = await clientChildTables(c);
const n = async (sql) => (await c.query(sql)).rows[0].n;

// Every non-cascading foreign key pointing AT `table`, so a delete can clear
// its dependants first. Patching these one at a time is whack-a-mole:
// contract_signers pointed at contracts, document_versions points at documents,
// and there is no reason to believe those are the last two.
async function referrers(table) {
  const { rows } = await c.query(`
    SELECT cl.relname AS child_table, a.attname AS child_column
      FROM pg_constraint con
      JOIN pg_class cl    ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN LATERAL unnest(con.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
     WHERE con.contype = 'f' AND ns.nspname = 'public'
       AND con.confrelid = ('public.' || $1)::regclass
       AND array_length(con.conkey, 1) = 1
       AND con.confdeltype <> 'c'`, [table]);
  return rows;
}

// Delete rows from `table` matching `whereSql`, clearing anything that points
// at them first. `seen` breaks cycles (a table that references itself, or a
// pair that reference each other).
async function deleteWithDependants(table, whereSql, tally, seen = new Set()) {
  const key = table + "|" + whereSql;
  if (seen.has(key)) return;
  seen.add(key);
  for (const r of await referrers(table)) {
    const sub = `"${r.child_column}" IN (SELECT id FROM "${table}" WHERE ${whereSql})`;
    await deleteWithDependants(r.child_table, sub, tally, seen);
  }
  const res = await c.query(`DELETE FROM "${table}" WHERE ${whereSql}`);
  if (res.rowCount) {
    tally.total += res.rowCount;
    tally.lines.push(String(res.rowCount).padStart(6) + " " + table);
  }
}

if (phase === "report" || phase === "flag") {
  console.log("fake clients:", await n(`SELECT count(*)::int n FROM clients WHERE ${FAKE}`));
  console.log("real clients kept:", await n(`SELECT count(*)::int n FROM clients WHERE NOT ${FAKE}`));
  console.log("\ncontracts on real clients that are still test artifacts:");
  console.log((await c.query(`SELECT template_key, status, signer_name FROM contracts WHERE ${FAKE_CONTRACT_EXTRA} ORDER BY created_at`)).rows);
  console.log("\ncontracts KEPT:");
  console.log((await c.query(`SELECT template_key, status, signer_name FROM contracts
     WHERE signer_name IN ('Sarah Blankstein','Justice Nikkel')`)).rows);
}

if (phase === "flag") {
  await c.query("BEGIN");
  let flagged = 0;
  const r0 = await c.query(`UPDATE clients SET is_demo = true WHERE ${FAKE} AND COALESCE(is_demo,false) = false`);
  console.log("clients flagged:", r0.rowCount);
  for (const k of kids) {
    const hasFlag = await n(`SELECT count(*)::int n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='${k.table}' AND column_name='is_demo'`);
    if (!hasFlag) { console.log("  no is_demo column:", k.table); continue; }
    const r = await c.query(`UPDATE "${k.table}" SET is_demo = true
      WHERE "${k.column}" IN (${FAKE_IDS}) AND COALESCE(is_demo,false) = false`);
    if (r.rowCount) { flagged += r.rowCount; console.log(String(r.rowCount).padStart(6), k.table); }
  }
  const rc = await c.query(`UPDATE contracts SET is_demo = true WHERE ${FAKE_CONTRACT_EXTRA} AND COALESCE(is_demo,false) = false`);
  console.log("extra contracts flagged:", rc.rowCount);
  console.log("child rows flagged:", flagged);
  await c.query("COMMIT");
  console.log("\nFLAGGED. Nothing deleted. Screens hide flagged rows from here.");
}

if (phase === "delete") {
  await c.query("BEGIN");
  // Build the work list by walking the foreign-key graph outward from clients,
  // visiting each table+column link ONCE. Recursing per predicate instead never
  // terminates: the graph has cycles, and a predicate that grows each hop makes
  // every revisit look new.
  const work = [];
  const seen = new Set();
  const queue = [
    { table: "contracts", where: FAKE_CONTRACT_EXTRA, depth: 0 },
    ...kids.map(k => ({ table: k.table, where: `"${k.column}" IN (${FAKE_IDS})`, depth: 0 })),
  ];
  for (const q of queue) seen.add(q.table + "|root");
  while (queue.length) {
    const item = queue.shift();
    work.push(item);
    if (item.depth >= 4) continue;
    for (const r of await referrers(item.table)) {
      const key = r.child_table + "|" + r.child_column;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({
        table: r.child_table,
        where: `"${r.child_column}" IN (SELECT id FROM "${item.table}" WHERE ${item.where})`,
        depth: item.depth + 1,
      });
    }
  }
  console.log("work list:", work.length, "table links");

  // --- three blockers the plain walk cannot solve, each handled at its cause ---

  // 1. documents and document_versions point at each other (a document names its
  //    current version, a version names its document), so neither can go first.
  //    Drop the "current version" pointer and the cycle opens.
  const rcv = await c.query(`UPDATE documents SET current_version_id = NULL
     WHERE client_id IN (${FAKE_IDS}) AND current_version_id IS NOT NULL`);
  console.log("documents unpinned from their current version:", rcv.rowCount);

  // 2. contract_signers reaches contracts by a link the client-side walk misses
  //    (a signer whose own client_id is null). Clear it by contract directly.
  const rcs = await c.query(`DELETE FROM contract_signers WHERE contract_id IN (
     SELECT id FROM contracts WHERE client_id IN (${FAKE_IDS}) OR (${FAKE_CONTRACT_EXTRA}))`);
  console.log("contract signatures cleared:", rcs.rowCount);

  // 3. failed_events rows are undeletable BY DESIGN (039_failed_events.sql) and,
  //    unlike the other guarded tables, have no is_demo escape hatch. The
  //    sanctioned move is to mark them, not remove them. They are internal error
  //    logs, not customer-facing history.
  // A terminal status must say when it became terminal (failed_events_resolved_at_ck).
  const rfe = await c.query(`UPDATE failed_events SET status = 'ignored', resolved_at = now()
     WHERE client_id IN (${FAKE_IDS}) AND status <> 'ignored'`);
  console.log("failed_events marked ignored (cannot be deleted by design):", rfe.rowCount);
  for (let i = work.length - 1; i >= 0; i--) if (work[i].table === "failed_events") work.splice(i, 1);

  // Those undeletable error logs pin the events they were raised against, and
  // those events carry the client id, which blocks the client delete. Cut the
  // client link on just those events. The error log keeps its detail; the fake
  // client history stops existing.
  const rev = await c.query(`UPDATE events SET client_id = NULL
     WHERE client_id IN (${FAKE_IDS}) AND id IN (SELECT event_id FROM failed_events WHERE event_id IS NOT NULL)`);
  console.log("events detached from fake clients (pinned by error logs):", rev.rowCount);

  // affiliate_payout_lines is a money record. Its guard CANCELS a delete rather
  // than raising, so the delete reported success and changed nothing. Money rows
  // are never destroyed in this system — detach it from the fake client instead.
  const rap = await c.query(`UPDATE affiliate_payout_lines SET client_id = NULL WHERE client_id IN (${FAKE_IDS})`);
  console.log("affiliate payout lines detached (money rows are never deleted):", rap.rowCount);

  // Deepest-first, then repeat passes: a delete blocked by a foreign key simply
  // waits for the pass that clears whatever is pointing at it.
  work.sort((a, b) => b.depth - a.depth);
  const tally = { total: 0, lines: [] };
  let pending = work;
  for (let pass = 1; pass <= 6 && pending.length; pass++) {
    const failed = [];
    for (const w of pending) {
      await c.query("SAVEPOINT sp");
      try {
        const res = await c.query(`DELETE FROM "${w.table}" WHERE ${w.where}`);
        await c.query("RELEASE SAVEPOINT sp");
        if (res.rowCount) { tally.total += res.rowCount; tally.lines.push(String(res.rowCount).padStart(6) + " " + w.table); }
      } catch (e) {
        await c.query("ROLLBACK TO SAVEPOINT sp");
        w.err = `${e.table || "?"} :: ${e.constraint || e.message}`;
        failed.push(w);
      }
    }
    console.log(`pass ${pass}: ${pending.length - failed.length} cleared, ${failed.length} still blocked`);
    if (failed.length === pending.length) {
      console.log("STILL BLOCKED:");
      for (const f of failed) console.log("  ", f.table, "<-", f.err);
      break;
    }
    pending = failed;
  }

  // The payout line that blocks the client delete is attached by REFERRAL, not by
  // client: deleting the client cascades to its affiliate_referrals row, and the
  // payout line points at that. Sweeping the table by client_id finds nothing and
  // the delete still fails — the constraint named in the error is
  // affiliate_payout_lines_referral_id_fkey, not the client one.
  const rref = await c.query(`DELETE FROM affiliate_payout_lines WHERE referral_id IN (
     SELECT id FROM affiliate_referrals WHERE client_id IN (${FAKE_IDS}))`);
  console.log("payout lines removed by referral:", rref.rowCount);

  // affiliate_payout_lines has an AFTER trigger that recomputes payout lines
  // when the rows they were derived from are removed — so clearing it early is
  // pointless, it comes straight back during the sweep. Detach it LAST, once
  // nothing is left that could regenerate it.
  const rap2 = await c.query(`UPDATE affiliate_payout_lines SET client_id = NULL WHERE client_id IN (${FAKE_IDS})`);
  console.log("affiliate payout lines detached, final sweep:", rap2.rowCount);

  if (process.env.DIAGNOSE2) {
    const ids = (await c.query(FAKE_IDS)).rows.map(r => r.id);
    const stuck = [];
    for (const id of ids) {
      await c.query("SAVEPOINT s1");
      try { await c.query(`DELETE FROM clients WHERE id = $1`, [id]); await c.query("ROLLBACK TO SAVEPOINT s1"); }
      catch (e) { await c.query("ROLLBACK TO SAVEPOINT s1"); stuck.push({ id, c: e.constraint, d: e.detail }); }
    }
    console.log("DIAGNOSE2 — clients that cannot be deleted:", stuck.length);
    console.log(stuck.slice(0, 5));
    if (stuck.length) {
      const one = stuck[0].id;
      console.log("rows in affiliate_payout_lines for that client:",
        (await c.query(`SELECT id, client_id, payout_id FROM affiliate_payout_lines WHERE client_id = $1`, [one])).rows);
      console.log("is that client visible to me?",
        (await c.query(`SELECT id, first_name, last_name FROM clients WHERE id = $1`, [one])).rows);
    }
  }

  if (process.env.DIAGNOSE) {
    const d = await c.query(`SELECT id, client_id, payout_id FROM affiliate_payout_lines WHERE client_id IS NOT NULL`);
    console.log("DIAGNOSE — payout lines still holding a client, inside the transaction:", d.rows);
    const d2 = await c.query(`SELECT count(*)::int n FROM affiliate_payout_lines a WHERE a.client_id IN (${FAKE_IDS})`);
    console.log("DIAGNOSE — of those, pointing at a fake client:", d2.rows[0]);
  }

  await c.query("SAVEPOINT spc");
  let r1;
  try {
    r1 = await c.query(`DELETE FROM clients WHERE ${FAKE}`);
    await c.query("RELEASE SAVEPOINT spc");
  } catch (e) {
    await c.query("ROLLBACK");
    console.log("\nABORTED — clients still referenced, nothing deleted:", e.detail || e.message);
    await c.end();
    process.exit(1);
  }
  for (const l of tally.lines) console.log(l);
  console.log("clients deleted:", r1.rowCount, "| child rows deleted:", tally.total);
  await c.query("COMMIT");

  console.log("\n-- after --");
  console.log("clients left:", await n(`SELECT count(*)::int n FROM clients`));
  console.log("contracts left:", await n(`SELECT count(*)::int n FROM contracts`));
  console.log((await c.query(`SELECT template_key, status, signer_name FROM contracts ORDER BY created_at`)).rows);
}

await c.end();
