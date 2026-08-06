import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWaitBusinessDays, loadMailServiceLevel, scheduleFromDelivery } from "./call-scheduler.mjs";
import { addBusinessDays } from "./business-days.mjs";

test("loadWaitBusinessDays uses defaults when no config row", async () => {
  const db = {
    async query() { return { rows: [] }; }
  };
  assert.equal(await loadWaitBusinessDays(db, { orgId: "o", bureau: "EX", channel: "portal" }), 1);
  assert.equal(await loadWaitBusinessDays(db, { orgId: "o", bureau: "EX", channel: "mail" }), 3);
});

test("loadWaitBusinessDays reads per-bureau config", async () => {
  const db = {
    async query() {
      return { rows: [{ portal_wait_business_days: 2, mail_wait_business_days: 5 }] };
    }
  };
  assert.equal(await loadWaitBusinessDays(db, { orgId: "o", bureau: "TU", channel: "portal" }), 2);
  assert.equal(await loadWaitBusinessDays(db, { orgId: "o", bureau: "TU", channel: "mail" }), 5);
});

test("loadMailServiceLevel: config default and per-send override", async () => {
  const db = {
    async query() {
      return { rows: [{ mail_service_level: "first_class" }] };
    }
  };
  assert.equal(await loadMailServiceLevel(db, { orgId: "o", bureau: "EX" }), "first_class");
  assert.equal(
    await loadMailServiceLevel(db, { orgId: "o", bureau: "EX", override: "priority_express" }),
    "priority_express"
  );
  assert.equal(
    await loadMailServiceLevel(db, { orgId: "o", bureau: "EX", override: "ups_express_overnight" }),
    "first_class"
  );
});

test("scheduleFromDelivery sets call_due_at from channel wait, not send", async () => {
  const deliveredAt = "2026-08-04T16:00:00.000Z";
  const updates = [];
  const caseRow = {
    id: "c1",
    org_id: "o1",
    client_id: "cl1",
    selected_bureaus_raw: "EX",
    first_delivery_at: null,
    case_id: "IG-1"
  };
  const db = {
    async query(sql, params) {
      const s = String(sql);
      if (s.includes("FROM ai_bureau_config")) {
        return { rows: [{ portal_wait_business_days: 1, mail_wait_business_days: 3 }] };
      }
      if (s.includes("FROM inquiry_removal_cases") && s.includes("SELECT")) {
        return { rows: [caseRow] };
      }
      if (s.includes("UPDATE inquiry_removal_cases")) {
        updates.push(params);
        const due = params[3];
        return {
          rows: [{
            ...caseRow,
            first_delivery_at: params[1],
            first_delivery_channel: params[2],
            call_due_at: due
          }]
        };
      }
      if (s.includes("pipeline_stages") || s.includes("cards")) {
        return { rows: [{ stage_id: "s", pipeline_id: "p", id: "card" }] };
      }
      return { rows: [] };
    }
  };

  const res = await scheduleFromDelivery(db, {
    caseId: "c1",
    orgId: "o1",
    deliveredAt,
    channel: "mail"
  });
  assert.equal(res.scheduled, true);
  assert.equal(res.waitDays, 3);
  const expected = addBusinessDays(deliveredAt, 3).toISOString();
  assert.equal(res.callDueAt.toISOString(), expected);
  assert.equal(res.case.call_due_at, expected);
});

test("scheduleFromDelivery ignores second delivery (first wins)", async () => {
  const caseRow = {
    id: "c1",
    org_id: "o1",
    client_id: "cl1",
    selected_bureaus_raw: "EX",
    first_delivery_at: "2026-08-01T12:00:00.000Z",
    call_due_at: "2026-08-04T12:00:00.000Z"
  };
  const db = {
    async query(sql) {
      if (String(sql).includes("SELECT")) return { rows: [caseRow] };
      return { rows: [] };
    }
  };
  const res = await scheduleFromDelivery(db, {
    caseId: "c1",
    orgId: "o1",
    deliveredAt: "2026-08-10T12:00:00.000Z",
    channel: "portal"
  });
  assert.equal(res.scheduled, false);
  assert.equal(res.reason, "already_scheduled");
});
