import { test } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { moneyReportingSnapshot } from "./money-snapshot.mjs";
import { seedPlatformDemo, setDemoMode, wipeDemoData, getDemoModeStatus } from "./platform-seed.mjs";

const hasDb = !!process.env.DATABASE_URL;

test("demo mode isolation", { skip: !hasDb }, async () => {
  const orgId = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId);

  await wipeDemoData(db, { orgId });
  const before = await moneyReportingSnapshot(db, orgId);

  await seedPlatformDemo(db, { orgId });
  assert.deepEqual(await moneyReportingSnapshot(db, orgId), before, "money unchanged after seed");

  await seedPlatformDemo(db, { orgId });
  assert.deepEqual(await moneyReportingSnapshot(db, orgId), before, "idempotent seed");

  const status = await getDemoModeStatus(db, { orgId });
  assert.ok(status.counts.clients >= 8, "expected 8+ demo clients");
  assert.ok(status.counts.lenders >= 7, "expected 7 demo lenders");
  assert.ok(status.counts.call_outcomes >= 20, "expected call volume");
  assert.ok((status.counts.tasks || 0) >= 4, "expected calendar tasks");
  assert.ok((status.counts.documents || 0) >= 2, "expected documents");
  assert.ok((status.counts.bank_accounts || 0) >= 2, "expected finance bank accounts");
  assert.ok((status.counts.subscriptions || 0) >= 1, "expected subscriptions");
  assert.ok(status.primary_client_id, "primary demo client for screen bootstrap");

  await setDemoMode(db, { orgId, enabled: true });
  assert.equal((await getDemoModeStatus(db, { orgId })).demo_mode_enabled, true);
  assert.deepEqual(await moneyReportingSnapshot(db, orgId), before, "money unchanged with toggle on");

  await wipeDemoData(db, { orgId });
  const left = (await db.query(
    `SELECT count(*)::int n FROM clients WHERE org_id = $1 AND email LIKE 'demo.client.%@demo.fundhub.local'`,
    [orgId]
  )).rows[0].n;
  assert.equal(left, 0, "platform demo clients wiped");

  /* PUT IT BACK. This file ends by proving the wipe works, which leaves the
     database with no demo data at all — and scripts/run-suite.mjs runs every
     *.pg.test.mjs against ONE database, in filename order. Everything after this
     that needs the demo fixtures (demo-logins, galaxy/company-activity,
     conversations/inbox-read) then failed, describing a seed that was fine as
     broken. The wipe assertion above has already been made, so re-seeding costs
     the test nothing and leaves the database as this file found it. */
  await seedPlatformDemo(db, { orgId });
  await setDemoMode(db, { orgId, enabled: false });

  await close().catch(() => {});
});
