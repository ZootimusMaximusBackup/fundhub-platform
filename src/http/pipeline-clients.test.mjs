import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "../db.mjs";
import handler, { parsePipelineClientBody } from "../../api/pipeline-clients.mjs";
import { OFFERS } from "../config/offers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(HERE, "../../api/pipeline-clients.mjs"), "utf8");
const PIPELINE = fs.readFileSync(path.resolve(HERE, "../../public/app/pipeline.html"), "utf8");

const ORG_A = "11111111-1111-4111-8111-111111111111";
const STAFF = "44444444-4444-4444-8444-444444444444";
const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const realQuery = db.query;

function stubDb({ session = null, openShift = true } = {}) {
  db.query = async (text) => {
    if (/FROM live JOIN staff s/i.test(text)) {
      if (!session) return { rows: [] };
      return { rows: [{
        session_id: "sess-1", expires_at: new Date(Date.now() + 3_600_000),
        staff_id: session.staffId || STAFF, org_id: session.orgId || ORG_A,
        role: session.role || "owner", email: "e@example.com",
        name: "A Staffer", status: "active", active_flag: "true"
      }] };
    }
    if (/FROM shifts/i.test(text) || /clocked_in|ended_at IS NULL/i.test(text)) {
      return openShift
        ? { rows: [{ id: "shift-1", staff_id: STAFF, started_at: new Date().toISOString() }] }
        : { rows: [] };
    }
    return { rows: [] };
  };
}

function mkRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }
  };
}

beforeEach(() => { db.query = realQuery; });
afterEach(() => { db.query = realQuery; });

test("pipeline-clients does not INSERT clients itself", () => {
  assert.doesNotMatch(SRC, /INSERT INTO clients/i);
  assert.match(SRC, /resolveClient/);
  assert.match(SRC, /entry\.captured/);
});

test("parsePipelineClientBody requires name, email, phone, and a known product", () => {
  assert.equal(parsePipelineClientBody({}).ok, false);
  assert.equal(parsePipelineClientBody({ name: "A", email: "a@b.com" }).ok, false);
  const ok = parsePipelineClientBody({
    name: "Pat Tester",
    email: "pat+pipe@example.com",
    phone: "5551234567",
    product: "card-stacking-dfy"
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.email, "pat+pipe@example.com");
  assert.ok(Object.values(OFFERS).some((o) => o.productCode === ok.product));
});

describe("/api/pipeline-clients", () => {
  test("refuses non-POST", async () => {
    stubDb({ session: { role: "owner" } });
    const r = mkRes();
    await handler({ method: "GET", headers: { authorization: "Bearer tok" }, body: {} }, r);
    assert.equal(r.statusCode, 405);
  });

  test("unknown product does not emit", async () => {
    stubDb({ session: { role: "owner", orgId: ORG_A } });
    const emitted = [];
    const r = mkRes();
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer tok" },
        body: { name: "Pat", email: "pat+pipe@example.com", phone: "5551234567", product: "not-a-product" }
      },
      r,
      {
        ensureRegistered() {},
        async resolveClient() { throw new Error("must not resolve"); },
        async emit() { emitted.push(1); }
      }
    );
    assert.equal(r.statusCode, 400);
    assert.equal(emitted.length, 0);
  });

  test("emits entry.captured after resolveClient", async () => {
    stubDb({ session: { role: "owner", orgId: ORG_A } });
    const emitted = [];
    const r = mkRes();
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer tok" },
        body: {
          name: "Pat Tester",
          email: "pat+pipe@example.com",
          phone: "5551234567",
          product: "card-stacking-dfy"
        }
      },
      r,
      {
        ensureRegistered() {},
        async resolveClient() { return CLIENT; },
        async emit(_db, name, payload, opts) {
          emitted.push({ name, payload, opts });
          return { id: "evt-1", deduped: false };
        }
      }
    );
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.client_id, CLIENT);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].name, "entry.captured");
    assert.equal(emitted[0].payload.email, "pat+pipe@example.com");
    assert.equal(emitted[0].payload.source, "pipeline");
    assert.equal(emitted[0].opts.clientId, CLIENT);
  });
});

test("pipeline.html has New Client on the existing board", () => {
  assert.match(PIPELINE, /id="fhNewClient"/);
  assert.match(PIPELINE, /id="fhNewName"/);
  assert.match(PIPELINE, /id="fhNewEmail"/);
  assert.match(PIPELINE, /id="fhNewPhone"/);
  assert.match(PIPELINE, /id="fhNewProduct"/);
  assert.match(PIPELINE, /\/api\/pipeline-clients/);
  assert.ok(!/pipeline-new-client\.html/.test(PIPELINE), "must not add a new screen");
});
