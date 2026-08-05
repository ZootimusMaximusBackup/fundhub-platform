// Postgres-backed tests for Galaxy company-activity feed.
// Handler lives at api/read/company-activity.mjs; suite glob is src/** only.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { companyActivity } from "./company-activity.mjs";
import { seedPlatformDemo, wipeDemoData, setDemoMode } from "../demo/platform-seed.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const EMAIL = "galaxy_activity_pg@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  return r;
};

describe("company-activity", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let orgId, handler, staffId, token;

  before(async () => {
    ({ default: handler } = await import("../../api/read/company-activity.mjs"));
    orgId = await resolveDefaultOrg(db);
    await db.query(`DELETE FROM staff WHERE org_id=$1 AND email=$2`, [orgId, EMAIL]);
    const staff = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status, is_demo)
       VALUES ($1,$2,'Galaxy Activity Tester','owner','active',false)
       RETURNING id`,
      [orgId, EMAIL]
    )).rows[0];
    staffId = staff.id;
    token = (await createSession(db, { staffId, orgId })).token;
  });

  after(async () => {
    await db.query(`DELETE FROM staff WHERE id=$1`, [staffId]).catch(() => {});
    await close().catch(() => {});
  });

  test("returns nodes when open demo shifts exist and Demo Mode is on", async () => {
    await wipeDemoData(db, { orgId });
    await seedPlatformDemo(db, { orgId });
    await setDemoMode(db, { orgId, enabled: true });

    const data = await companyActivity(db, { orgId });
    assert.equal(data.simulated, false);
    assert.equal(data.demo_mode, true);
    assert.ok(Array.isArray(data.nodes));
    assert.ok(data.nodes.length > 0, "expected presence nodes with demo open shifts");

    const humans = data.nodes.filter((n) => n.kind === "human");
    assert.ok(humans.some((n) => n.state === "active"), "expected at least one active human");
    assert.ok(humans.some((n) => String(n.name).startsWith("DEMO ·")), "demo staff labeled");
    const sample = humans[0];
    for (const key of ["id", "name", "ini", "role", "kind", "c", "state", "out", "unit", "tempo", "pool", "shift", "on"]) {
      assert.ok(key in sample, `missing node field ${key}`);
    }
    assert.ok(["lead", "sales", "inq", "cfa", "ops"].includes(sample.c));

    const open = (await db.query(
      `SELECT count(*)::int n FROM shifts WHERE org_id=$1 AND is_demo AND ended_at IS NULL`,
      [orgId]
    )).rows[0].n;
    assert.ok(open >= 1, "seed should create open demo shifts");
  });

  test("hides demo staff when Demo Mode is off; money KPIs never include demo cash", async () => {
    await setDemoMode(db, { orgId, enabled: false });
    const data = await companyActivity(db, { orgId });
    assert.equal(data.demo_mode, false);
    const demoHumans = data.nodes.filter((n) => n.kind === "human" && String(n.name).startsWith("DEMO ·"));
    assert.equal(demoHumans.length, 0, "demo workers must disappear when toggle is off");

    const cashKpi = data.kpis.find((k) => k.id === "cash");
    assert.ok(cashKpi);
    // Seeded demo call_outcomes have cash; money KPIs must still exclude them.
    const demoCash = (await db.query(
      `SELECT COALESCE(SUM(cash_collected_cents),0)::bigint n FROM call_outcomes
        WHERE org_id=$1 AND is_demo AND logged_at >= date_trunc('day', now())`,
      [orgId]
    )).rows[0].n;
    assert.ok(Number(demoCash) > 0, "fixture: demo cash today should exist after seed");
    assert.equal(cashKpi.v, 0, "cash KPI must ignore is_demo rows");
  });

  test("GET /api/read/company-activity requires staff auth and returns ok", async () => {
    await setDemoMode(db, { orgId, enabled: true });
    const denied = res();
    await handler({ method: "GET", headers: {} }, denied);
    assert.equal(denied.code, 401);

    const ok = res();
    await handler({
      method: "GET",
      headers: { authorization: "Bearer " + token }
    }, ok);
    assert.equal(ok.code, 200);
    assert.equal(ok.body.ok, true);
    assert.equal(ok.body.simulated, false);
    assert.ok(Array.isArray(ok.body.nodes));
  });
});
