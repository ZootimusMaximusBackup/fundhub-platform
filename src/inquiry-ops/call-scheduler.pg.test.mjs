// Real-Postgres: PostGrid delivery.confirmed + portal scheduleFromDelivery
// → first_delivery_at + call_due_at. SKIPS without DATABASE_URL.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createCase } from "./cases.mjs";
import { onMailDelivered, scheduleFromDelivery } from "./call-scheduler.mjs";
import { addBusinessDays } from "./business-days.mjs";
import { handleWebhook } from "../http/router.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = "inqcall_pg";

describe("PostGrid delivery webhook → call clock", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgId;

  async function wipe() {
    const clients = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`, [`${MARK}%`]
    )).rows.map((r) => r.id);
    if (clients.length) {
      await db.query(`DELETE FROM inquiry_removal_cases WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
    }
  }

  before(async () => {
    orgId = await resolveDefaultOrg(db);
    await wipe();
    // Ensure mail wait is 3 business days for EX on this org.
    await db.query(
      `INSERT INTO ai_bureau_config (
         org_id, bureau_code, bureau_name,
         portal_wait_business_days, mail_wait_business_days, mail_service_level,
         mail_company_name, mail_address_line1, mail_address_city,
         mail_address_state, mail_address_zip, mail_address_country
       ) VALUES (
         $1, 'EX', 'Experian', 1, 3, 'first_class',
         'Experian', 'P.O. Box 4500', 'Allen', 'TX', '75013', 'US'
       )
       ON CONFLICT (org_id, bureau_code) DO UPDATE
         SET portal_wait_business_days = 1,
             mail_wait_business_days = 3,
             mail_service_level = 'first_class',
             updated_at = now()`,
      [orgId]
    );
  });

  after(async () => {
    await wipe();
    await close().catch(() => {});
  });

  test("delivery.confirmed Friday → call_due_at Wednesday (3 business days)", async () => {
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,'Call','Clock') RETURNING id`,
      [orgId, `${MARK}.weekend@example.com`]
    )).rows[0].id;

    const c = await createCase(db, {
      orgId,
      row: {
        client_id: clientId,
        case_status: "In Progress",
        selected_bureaus_raw: "EX",
        open_inquiry_count: 1
      }
    });
    await db.query(
      `UPDATE inquiry_removal_cases SET letter_provider_id = $2 WHERE id = $1`,
      [c.id, "letter_weekend_1"]
    );

    // Friday delivery — never schedule off send time.
    const deliveredAt = "2026-08-07T14:00:00.000Z";
    const result = await onMailDelivered(db, {
      orgId,
      providerId: "letter_weekend_1",
      deliveredAt
    });
    assert.equal(result.scheduled, true);
    assert.equal(result.waitDays, 3);

    const expected = addBusinessDays(deliveredAt, 3).toISOString();
    // Fri + 3 bd → Wed
    assert.equal(expected, "2026-08-12T14:00:00.000Z");
    assert.equal(result.callDueAt.toISOString(), expected);

    const row = (await db.query(
      `SELECT first_delivery_at, first_delivery_channel, call_due_at, letter_provider_id
         FROM inquiry_removal_cases WHERE id = $1`,
      [c.id]
    )).rows[0];
    assert.equal(new Date(row.first_delivery_at).toISOString(), deliveredAt);
    assert.equal(row.first_delivery_channel, "mail");
    assert.equal(new Date(row.call_due_at).toISOString(), expected);
    assert.equal(row.letter_provider_id, "letter_weekend_1");
  });

  test("router /api/webhooks/postgrid resolves and writes call clock", async () => {
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,'Hook','Route') RETURNING id`,
      [orgId, `${MARK}.hook@example.com`]
    )).rows[0].id;

    const c2 = await createCase(db, {
      orgId,
      row: {
        client_id: clientId,
        case_status: "In Progress",
        selected_bureaus_raw: "EX",
        open_inquiry_count: 1
      }
    });
    await db.query(
      `UPDATE inquiry_removal_cases SET letter_provider_id = $2 WHERE id = $1`,
      [c2.id, "letter_hook_99"]
    );

    const secret = "pg_test_secret";
    const deliveredAt = "2026-08-07T16:30:00.000Z";
    const raw = JSON.stringify({
      event: "delivery.confirmed",
      job_id: "letter_hook_99",
      status: "delivered",
      timestamp: deliveredAt
    });
    const sig = createHmac("sha256", secret).update(raw).digest("hex");

    const out = await handleWebhook({
      db,
      provider: "postgrid",
      rawBody: raw,
      headers: { "postgrid-signature": sig },
      url: "https://x/api/webhooks/postgrid",
      env: { POSTGRID_WEBHOOK_SECRET: secret }
    });

    assert.notEqual(out.status, 404, "postgrid webhook must resolve in the router");
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
    assert.equal(out.body.scheduled, true);

    const expected = addBusinessDays(deliveredAt, 3).toISOString();
    assert.equal(new Date(out.body.callDueAt).toISOString(), expected);
  });

  // W4: portal confirm clock (no live bureau) — mirrors mail webhook prove.
  test("portal scheduleFromDelivery → first_delivery_channel=portal + call_due_at", async () => {
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,'Portal','Clock') RETURNING id`,
      [orgId, `${MARK}.portal@example.com`]
    )).rows[0].id;

    const c = await createCase(db, {
      orgId,
      row: {
        client_id: clientId,
        case_status: "In Progress",
        selected_bureaus_raw: "EX",
        open_inquiry_count: 1
      }
    });

    const deliveredAt = "2026-08-04T16:00:00.000Z";
    const result = await scheduleFromDelivery(db, {
      caseId: c.id,
      orgId,
      deliveredAt,
      channel: "portal"
    });
    assert.equal(result.scheduled, true);
    assert.equal(result.waitDays, 1);

    const expected = addBusinessDays(deliveredAt, 1).toISOString();
    assert.equal(result.callDueAt.toISOString(), expected);

    const row = (await db.query(
      `SELECT first_delivery_at, first_delivery_channel, call_due_at
         FROM inquiry_removal_cases WHERE id = $1`,
      [c.id]
    )).rows[0];
    assert.equal(new Date(row.first_delivery_at).toISOString(), deliveredAt);
    assert.equal(row.first_delivery_channel, "portal");
    assert.equal(new Date(row.call_due_at).toISOString(), expected);
  });
});
