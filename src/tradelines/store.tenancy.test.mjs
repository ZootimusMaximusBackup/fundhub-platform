// Tenancy on the tradeline read path. NO DATABASE — a fake db records the SQL,
// so this runs on every pass and not only the ones with DATABASE_URL set. That
// matters here: the bug this file guards is invisible with one org in the
// table, and the seed ships exactly one, so a live-Postgres test would have
// passed against the broken code too.
//
// THE BUG. listTradelines filtered on client_id alone. Every row records the
// org that owns it and every authenticated request knows the caller's org, but
// the read never compared them. With a second org in `orgs`, any signed-in
// staff member of org A could hand a client id belonging to org B to
// GET /api/read/tradelines (or /api/read/finance-os, which shares this reader)
// and receive that consumer's credit limits, balances and APRs.
//
// TWO ASSERTIONS, BOTH LOAD-BEARING:
//   1. Behaviour — the reader refuses to run without an org id, and scopes the
//      query to it. Refusing is the point: a silent default would put the next
//      caller back where we started.
//   2. Call sites — every caller actually passes one. A required argument only
//      helps if the failure is loud, and the source scan proves nobody has
//      quietly reintroduced an unscoped read.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listTradelines } from "./store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG_CLIENT = "22222222-2222-2222-2222-222222222222";

function fakeDb() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    }
  };
}

test("listTradelines refuses to read without an org id", async () => {
  const db = fakeDb();
  await assert.rejects(
    () => listTradelines(db, { clientId: OTHER_ORG_CLIENT }),
    (e) => e instanceof TypeError && /orgId/.test(e.message),
    "an omitted org id must throw, not fall back to reading every org"
  );
  assert.equal(db.calls.length, 0, "nothing may reach the database on the unscoped path");
});

test("listTradelines scopes the read to the caller's org", async () => {
  const db = fakeDb();
  await listTradelines(db, { orgId: ORG, clientId: OTHER_ORG_CLIENT });

  assert.equal(db.calls.length, 1);
  const { sql, params } = db.calls[0];
  assert.match(sql, /org_id\s*=\s*\$\d/, "the WHERE clause must compare org_id");
  assert.ok(params.includes(ORG), "the caller's org id must be bound as a parameter");
});

test("every caller of listTradelines passes an org id", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".mjs") && !entry.name.includes(".test.")) files.push(full);
    }
  };
  walk(path.join(ROOT, "api"));
  walk(path.join(ROOT, "src"));

  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (file.endsWith(path.join("tradelines", "store.mjs"))) continue;
    // Crude on purpose, in the spirit of src/http/auth-gate.test.mjs: any call
    // site without an org id is worth a human look, and a false positive costs
    // a reword while a false negative costs a data exposure.
    const re = /listTradelines\s*\(([^;]*?)\)\s*;/gs;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (!/\borgId\b/.test(m[1])) offenders.push(path.relative(ROOT, file));
    }
  }

  assert.deepEqual(offenders, [], `these call sites read tradelines without an org scope: ${offenders.join(", ")}`);
});
