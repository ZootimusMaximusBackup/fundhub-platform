import { test } from "node:test";
import assert from "node:assert";
import { recordOptOut, recordOptIn, isOptedOut } from "./opt-out.mjs";

// In-memory DB fake for opt_outs queries.
function pgFake() {
  const rows = [];
  return {
    rows,
    async query(sql, params) {
      if (/INSERT INTO opt_outs/.test(sql)) {
        const existing = rows.find((r) => r.client_id === params[0] && r.channel === params[2]);
        if (existing) {
          existing.opted_out_at = new Date();
          existing.opted_in_at = null;
          existing.source = params[3];
        } else {
          rows.push({ client_id: params[0], org_id: params[1], channel: params[2], source: params[3], opted_out_at: new Date(), opted_in_at: null });
        }
        return { rows: [] };
      }
      if (/UPDATE opt_outs SET opted_in_at/.test(sql)) {
        const r = rows.find((r) => r.client_id === params[0] && r.channel === params[1]);
        if (r) r.opted_in_at = new Date();
        return { rows: [] };
      }
      if (/SELECT 1 FROM opt_outs/.test(sql)) {
        const r = rows.find((r) => r.client_id === params[0] && r.channel === params[1] && r.opted_in_at == null);
        return { rows: r ? [{ 1: 1 }] : [] };
      }
      return { rows: [] };
    }
  };
}

test("recordOptOut: marks contact opted out", async () => {
  const db = pgFake();
  await recordOptOut(db, "cl-1", "org-1", "sms");
  assert.equal(await isOptedOut(db, "cl-1", "sms"), true);
});

test("isOptedOut: returns false when no opt-out row exists", async () => {
  const db = pgFake();
  assert.equal(await isOptedOut(db, "cl-1", "sms"), false);
});

test("recordOptIn: resumes after opt-out (sets opted_in_at)", async () => {
  const db = pgFake();
  await recordOptOut(db, "cl-1", "org-1", "sms");
  await recordOptIn(db, "cl-1", "sms");
  assert.equal(await isOptedOut(db, "cl-1", "sms"), false);
});

test("opt-out is per-channel: sms opt-out does not affect email", async () => {
  const db = pgFake();
  await recordOptOut(db, "cl-1", "org-1", "sms");
  assert.equal(await isOptedOut(db, "cl-1", "email"), false);
});

test("recordOptOut: upsert re-opts-out a re-enrolled contact", async () => {
  const db = pgFake();
  await recordOptOut(db, "cl-1", "org-1", "sms");
  await recordOptIn(db, "cl-1", "sms");
  await recordOptOut(db, "cl-1", "org-1", "sms", "api");
  assert.equal(await isOptedOut(db, "cl-1", "sms"), true);
});
