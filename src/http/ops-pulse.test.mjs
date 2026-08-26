import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_SETS } from "./read-api.mjs";
import readOpsPulse from "../../api/read/ops-pulse.mjs";
import hireCloser from "../../api/ops/hire-closer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const makeRes = () => {
  const r = { statusCode: 0, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

describe("ops pulse HTTP", () => {
  it("GET refuses anyone who is not owner or admin", async () => {
    const res = makeRes();
    await readOpsPulse(
      { method: "GET", query: { period: "7d" } },
      res,
      { staff: { id: "s1", role: "closer", org_id: "11111111-1111-4111-8111-111111111111" } }
    );
    assert.equal(res.statusCode, 403);
  });

  it("GET passes the signed-in company into computePulse", () => {
    const src = fs.readFileSync(path.join(ROOT, "api/read/ops-pulse.mjs"), "utf8");
    assert.match(src, /orgId:\s*staff\.org_id/);
  });

  it("GET is limited to ROLE_SETS.OPS", () => {
    assert.deepEqual([...ROLE_SETS.OPS].sort(), ["admin", "owner"]);
    const src = fs.readFileSync(path.join(ROOT, "api/read/ops-pulse.mjs"), "utf8");
    assert.match(src, /ROLE_SETS\.OPS/);
    assert.doesNotMatch(src, /ROLE_SETS\.STAFF/);
    assert.doesNotMatch(src, /actOnPacked/);
    assert.doesNotMatch(src, /actOnBrain/);
    assert.doesNotMatch(src, /createCsuiteTask/);
  });

  it("GET refuses POST", async () => {
    const res = makeRes();
    await readOpsPulse({ method: "POST", query: {} }, res, {
      staff: { id: "s1", role: "owner", org_id: "11111111-1111-4111-8111-111111111111" }
    });
    assert.equal(res.statusCode, 405);
  });

  it("POST hire-closer refuses a closer and refuses a packed flag on the body", async () => {
    const closer = makeRes();
    await hireCloser(
      { method: "POST", body: {} },
      closer,
      { staff: { id: "s1", role: "closer", org_id: "11111111-1111-4111-8111-111111111111" } }
    );
    assert.equal(closer.statusCode, 403);

    const forced = makeRes();
    await hireCloser(
      { method: "POST", body: { packed: true } },
      forced,
      { staff: { id: "s1", role: "owner", org_id: "11111111-1111-4111-8111-111111111111" } }
    );
    assert.equal(forced.statusCode, 400);
    assert.equal(forced.body.error, "packed_not_accepted");
  });

  it("write path does not import suspendStaff", () => {
    const src = fs.readFileSync(path.join(ROOT, "api/ops/hire-closer.mjs"), "utf8");
    assert.doesNotMatch(src, /^import .*suspendStaff/m);
    assert.doesNotMatch(src, /^import .*inviteStaff/m);
    assert.match(src, /actOnBrain/);
  });
});
