// src/http/ops-weekly-brief.pg.test.mjs — POST /api/ops/weekly-brief, the
// HTTP door onto src/ops/weekly-brief.mjs. Placed under src/http/, not next
// to the handler in api/ — package.json's test glob is src/** and scripts/**
// only (CLAUDE.md §12); a test under api/ silently never runs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/ops/weekly-brief.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/ops/weekly-brief", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, tokStaff;

  const call = async (body, token) => {
    const r = res();
    await handler({
      method: "POST", query: {}, body: body || {},
      headers: token ? { authorization: "Bearer " + token } : {}
    }, r);
    return r;
  };

  async function wipe() {
    await db.query(
      `DELETE FROM brain_chunks WHERE file_id IN (
         SELECT id FROM brain_files WHERE org_id = $1 AND drive_file_id LIKE 'generated:weekly-ops-brief:%'
       )`, [org]
    );
    await db.query(
      `DELETE FROM brain_files WHERE org_id = $1 AND drive_file_id LIKE 'generated:weekly-ops-brief:%'`,
      [org]
    );
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    const owner = (await db.query(
      `SELECT id, org_id FROM staff WHERE org_id = $1 AND role = 'owner' LIMIT 1`, [org]
    )).rows[0];
    assert.ok(owner, "the default org has an owner staff row (seeded)");
    tokStaff = (await createSession(db, { staffId: owner.id, orgId: owner.org_id })).token;
    await wipe();
  });

  after(wipe);

  test("no session is refused before anything is generated", async () => {
    const r = await call({}, null);
    assert.equal(r.code, 401);
  });

  test("a staff session generates a brief and lands it in Company Brain", async () => {
    const r = await call({ to: "2026-03-09" }, tokStaff);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.match(r.body.sourceKey, /^2026-w\d{2}$/);
    assert.ok(typeof r.body.brief === "string" && r.body.brief.includes("Weekly ops brief"));

    const row = (await db.query(
      `SELECT drive_file_id, access_tier, source FROM brain_files WHERE org_id = $1 AND drive_file_id = $2`,
      [org, `generated:weekly-ops-brief:${r.body.sourceKey}`]
    )).rows[0];
    assert.ok(row, "the brief must actually be a brain_files row");
    assert.equal(row.access_tier, "owner");
    assert.equal(row.source, "generated");
  });

  test("a bad 'to' value is refused with a clear 400, not a 500", async () => {
    const r = await call({ to: "not-a-date" }, tokStaff);
    assert.equal(r.code, 400);
    assert.match(r.body.error, /ISO date/);
  });

  test("re-posting for the same week updates one document, not two", async () => {
    const first = await call({ to: "2026-04-13" }, tokStaff);
    const second = await call({ to: "2026-04-13" }, tokStaff);
    assert.equal(first.body.sourceKey, second.body.sourceKey);
    const count = (await db.query(
      `SELECT count(*) FROM brain_files WHERE org_id = $1 AND drive_file_id = $2`,
      [org, `generated:weekly-ops-brief:${first.body.sourceKey}`]
    )).rows[0].count;
    assert.equal(Number(count), 1);
  });
});
