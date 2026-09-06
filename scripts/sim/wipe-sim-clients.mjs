#!/usr/bin/env node
// scripts/sim/wipe-sim-clients.mjs — remove the simulated walkthrough clients
// and everything attached to them from a database.
//
// Owner-authorised 2026-09-04: the sim-01..07 clients from the 2026-09-03 manual
// walkthrough sit on live dashboards being counted as real people. This removes
// them so the re-walk starts from a clean board.
//
// DRY RUN BY DEFAULT. Nothing is deleted without --confirm.
//
//   scripts/sim/with-prod-env.sh is for the push tools; run this one as:
//   DATABASE_URL="$(netlify env:get DATABASE_URL --context production)" \
//     node scripts/sim/wipe-sim-clients.mjs            # shows what would go
//   ... same, plus --confirm                            # actually deletes
//
// CLAUDE.md §11: deleting data needs Chris's word every time. The --confirm flag
// is that word made explicit; never add a default that skips it.
import pg from 'pg';

const CONFIRM = process.argv.includes('--confirm');
// Matches stanbridgejchris+sim-01@gmail.com .. +sim-99. Deliberately narrow: the
// `+sim-` tag is the walkthrough set. `+fhtest` and real clients never match.
const PATTERN = '%+sim-%@%';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows: sims } = await client.query(
  `select id, first_name, last_name, email, created_at
     from clients where email ilike $1 order by email`, [PATTERN]);

if (!sims.length) {
  console.log('No sim clients match', PATTERN, '- nothing to do.');
  await client.end();
  process.exit(0);
}

console.log(`${sims.length} sim clients matched:\n`);
for (const s of sims) {
  console.log(`  ${s.email.padEnd(38)} ${s.first_name ?? ''} ${s.last_name ?? ''}`.trimEnd());
}

const ids = sims.map((s) => s.id);

// Every table that points at a client, discovered rather than hardcoded, so a
// table added since this was written is still cleaned.
const { rows: refs } = await client.query(
  `select table_name, column_name
     from information_schema.columns
    where table_schema = 'public'
      and column_name in ('client_id', 'contact_id')
      and table_name <> 'clients'
    order by table_name`);

const counted = [];
let total = 0;
for (const r of refs) {
  try {
    const q = await client.query(
      `select count(*)::int n from "${r.table_name}" where "${r.column_name}" = any($1::uuid[])`, [ids]);
    if (q.rows[0].n > 0) { counted.push({ ...r, n: q.rows[0].n }); total += q.rows[0].n; }
  } catch {
    // column is not a uuid, or the relation is a view: nothing to delete there.
  }
}

console.log(`\n${total} attached rows across ${counted.length} tables:\n`);
for (const c of counted) console.log(`  ${c.table_name}.${c.column_name}: ${c.n}`);

if (!CONFIRM) {
  console.log('\nDRY RUN. Nothing deleted. Re-run with --confirm to delete.');
  await client.end();
  process.exit(0);
}

await client.query('begin');
try {
  // Delete in dependency order, discovered by trying. Alphabetical order fails:
  // `accounts` sorts before `client_consents`, but client_consents.granted_by_account_id
  // points AT accounts, so the first pass hits a foreign-key error and the whole
  // transaction rolls back (measured 2026-09-04). Each delete gets its own
  // savepoint so one failure does not abort the others, and we keep sweeping
  // until a pass deletes nothing new.
  const pending = [...counted];
  let deleted = 0;
  let pass = 0;
  while (pending.length) {
    pass += 1;
    const stillBlocked = [];
    let progress = false;
    for (const c of pending) {
      await client.query('savepoint tbl');
      try {
        const q = await client.query(
          `delete from "${c.table_name}" where "${c.column_name}" = any($1::uuid[])`, [ids]);
        await client.query('release savepoint tbl');
        deleted += q.rowCount;
        progress = true;
        console.log(`  deleted ${q.rowCount} from ${c.table_name}`);
      } catch (e) {
        await client.query('rollback to savepoint tbl');
        stillBlocked.push({ ...c, why: e.message.split('\n')[0] });
      }
    }
    if (!progress) {
      console.error(`\nSTUCK after ${pass} passes. These tables will not delete:`);
      for (const b of stillBlocked) console.error(`  ${b.table_name}: ${b.why}`);
      throw new Error('could not resolve delete order');
    }
    pending.length = 0;
    pending.push(...stillBlocked);
  }
  const q = await client.query(`delete from clients where id = any($1::uuid[])`, [ids]);
  console.log(`  deleted ${q.rowCount} clients`);
  await client.query('commit');
  console.log(`\nDONE. ${deleted} attached rows + ${q.rowCount} clients removed.`);
} catch (e) {
  await client.query('rollback');
  console.error('\nROLLED BACK, nothing deleted:', e.message);
  process.exitCode = 1;
}
await client.end();
