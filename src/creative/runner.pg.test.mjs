// src/creative/runner.pg.test.mjs
//
// runDue() had no test of its own before tonight. Its discovery query ran
// unscoped against a row-level-secured table, so it always saw zero rows and
// reported success — the cron fired every two minutes and never did any
// work, silently, for as long as the bug existed. Fixed 2026-09-07 by
// scoping that query through asStaff(). This file exists so that fix cannot
// silently regress.

import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db.mjs";
import { asStaff } from "../partners/rls.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { runDue } from "./runner.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const PARTNER_SLUG = "runner-pg-test-partner";
const ACCT_EMAIL_LIKE = "runner-pg-test-%@example.test";

async function purge() {
  const ids = (await db.query(`SELECT id FROM partners WHERE slug = $1`, [PARTNER_SLUG])).rows.map((r) => r.id);
  if (ids.length) {
    await asStaff(async (tx) => {
      for (const t of ["generation_job_assets", "generation_jobs", "partner_module_settings"]) {
        await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
      }
    });
    await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
  }
  await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [ACCT_EMAIL_LIKE]);
}

test("runDue(): the real bug — a plain unscoped db connection must still find a queued job", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, async (t) => {
  const org = await resolveDefaultOrg(db);
  await purge();
  t.after(purge);

  const partnerId = (await db.query(
    `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
     VALUES ($1,'Runner PG Test',$2,'active',now()) RETURNING id`,
    [org, PARTNER_SLUG]
  )).rows[0].id;

  await asStaff((tx) => tx.query(
    `INSERT INTO partner_module_settings
       (org_id, partner_id, approve_before_launch, max_concurrent_jobs, marketing_suite_enabled)
     VALUES ($1,$2,true,2,true) ON CONFLICT (partner_id) DO NOTHING`,
    [org, partnerId]
  ));

  await asStaff((tx) => tx.query(
    `INSERT INTO generation_jobs (org_id, partner_id, status, idempotency_key, spec)
     VALUES ($1,$2,'queued','runner-pg-test-key-1',$3)`,
    [org, partnerId, JSON.stringify({ prompt: "runner test", offerType: "funding", assetKind: "copy" })]
  ));

  // The exact call shape production uses: a plain, unscoped db handle. Before
  // the fix this line would find zero partners and zero jobs, no matter that
  // a queued row was just inserted above.
  const result = await runDue(db, { limitPartners: 25, maxJobsPerPartner: 3 });

  assert.ok(result.partners >= 1, `expected at least the one partner with a queued job to be found; got ${result.partners}`);
  const mine = result.jobs.filter((j) => j.partner_id === partnerId);
  assert.ok(mine.length >= 1, `expected the queued job for ${partnerId} to have been claimed and run; got ${JSON.stringify(result.jobs)}`);

  const row = (await asStaff((tx) => tx.query(
    `SELECT status FROM generation_jobs WHERE org_id = $1 AND partner_id = $2 AND idempotency_key = 'runner-pg-test-key-1'`,
    [org, partnerId]
  ))).rows[0];
  assert.ok(row, "the job row should still exist after runDue processed it");
  assert.notEqual(row.status, "queued", "runDue should have moved the job out of queued — it is still queued, meaning it was never actually found and claimed");
});

test("runDue(): with no queued job of ours in play, it still answers cleanly rather than throwing", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, async (t) => {
  await purge();
  t.after(purge);
  // Not asserting global zero — this scratch database may be shared with
  // other pg-test files' fixtures. The behavior under test is that runDue()
  // completes and returns a sane shape; "does it find OUR job" is covered by
  // the test above.
  const result = await runDue(db, { limitPartners: 25 });
  assert.equal(typeof result.partners, "number");
  assert.ok(Array.isArray(result.jobs));
});
