import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AFFILIATE_WELCOME_KEY,
  SWEEP_CAP,
  isAffiliatePlusTag,
  queueAffiliateTemplate,
  sweepAffiliateDrips
} from "./drip.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("welcome key is the catalog AF1 template, not a new sequence", () => {
  assert.equal(AFFILIATE_WELCOME_KEY, "AF1");
  assert.equal(SWEEP_CAP, 5);
  const src = fs.readFileSync(path.join(HERE, "drip.mjs"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/AFFILIATE_WELCOME_KEY = "AF3"/.test(code));
  assert.equal(src.includes('templateKey = AFFILIATE_WELCOME_KEY'), true);
});

test("plus-tag helper matches prove addresses only", () => {
  assert.equal(isAffiliatePlusTag("e2e+aff-click26@fundhub.ai"), true);
  assert.equal(isAffiliatePlusTag("e2e+sim-wl@fundhub.ai"), true);
  assert.equal(isAffiliatePlusTag("affiliate@fundhub.ai"), false);
  assert.equal(isAffiliatePlusTag("partner@fundhub.ai"), false);
});

function templateDb({
  body = "Hey {{contact.first_name}} {{affiliate_link}}",
  subject = "AF1 — Affiliate Activation",
  compliance = true,
  insertId = "msg-1"
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM message_templates/.test(sql)) {
        return { rows: [{ body, subject, compliance_passed: compliance }] };
      }
      if (/INSERT INTO messages/.test(sql)) {
        return { rows: insertId ? [{ id: insertId }] : [] };
      }
      return { rows: [] };
    }
  };
}

test("queueAffiliateTemplate writes a queued email with to_address", async () => {
  const db = templateDb();
  const out = await queueAffiliateTemplate(db, {
    orgId: "org-1",
    email: "e2e+aff-click26@fundhub.ai",
    name: "Sam Rivera",
    trackingId: "AFF-000099",
    eventId: "aff-1"
  });
  assert.equal(out.queued, true);
  assert.equal(out.messageId, "msg-1");
  assert.equal(out.templateKey, "AF1");
  const ins = db.calls.find((c) => /INSERT INTO messages/.test(c.sql));
  assert.equal(ins.params[1], "AF1");
  assert.match(ins.params[2], /Sam/);
  assert.match(ins.params[2], /AFF-000099/);
  assert.equal(ins.params[4], "e2e+aff-click26@fundhub.ai");
  assert.match(ins.sql, /'queued'/);
});

test("queueAffiliateTemplate no-ops when the catalog row is missing", async () => {
  const db = {
    async query(sql) {
      if (/FROM message_templates/.test(sql)) return { rows: [] };
      throw new Error("must not insert: " + sql);
    }
  };
  const out = await queueAffiliateTemplate(db, {
    orgId: "org-1",
    email: "e2e+aff-x@fundhub.ai"
  });
  assert.deepEqual(out, { queued: false, reason: "template_pending" });
});

test("sweeper only selects plus-tag affiliates and caps the batch", async () => {
  const seen = [];
  const db = {
    async query(sql, params = []) {
      seen.push({ sql, params });
      if (/FROM accounts a/.test(sql)) {
        assert.match(sql, /\+aff-/);
        assert.match(sql, /\+sim-/);
        assert.equal(params[0], "AF1");
        assert.equal(params[1], 5);
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  const out = await sweepAffiliateDrips(db);
  assert.equal(out.ok, true);
  assert.equal(out.scanned, 0);
  assert.equal(out.queued, 0);
});

test("sweeper queues AF1 for one plus-tag row", async () => {
  const db = {
    async query(sql, params = []) {
      if (/FROM accounts a/.test(sql)) {
        return {
          rows: [{
            org_id: "org-1",
            id: "acct-1",
            email: "e2e+aff-click26@fundhub.ai",
            name: "Sam",
            tracking_id: "AFF-1"
          }]
        };
      }
      if (/FROM message_templates/.test(sql)) {
        return { rows: [{ body: "hi {{contact.first_name}}", subject: "AF1", compliance_passed: true }] };
      }
      if (/INSERT INTO messages/.test(sql)) {
        assert.equal(params[4], "e2e+aff-click26@fundhub.ai");
        return { rows: [{ id: "msg-9" }] };
      }
      return { rows: [] };
    }
  };
  const out = await sweepAffiliateDrips(db);
  assert.equal(out.queued, 1);
  assert.equal(out.results[0].messageId, "msg-9");
});
