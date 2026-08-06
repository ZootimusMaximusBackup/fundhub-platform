// Send-gate + doc-flip against real Postgres. SKIPS without DATABASE_URL.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { onDocsReceivedFlipInquiryGate } from "../handlers/inquiry-docs.mjs";
import { sendCase, SendGateError } from "./send.mjs";
import { createCase } from "./cases.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = "inqsend_pg";

describe("inquiry send + doc flip", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, staffId, clientId;

  async function wipe() {
    const clients = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`, [`${MARK}%`]
    )).rows.map((r) => r.id);
    if (clients.length) {
      await db.query(`DELETE FROM inquiry_attempts WHERE inquiry_id IN (SELECT id FROM inquiry_log WHERE client_id = ANY($1))`, [clients]);
      await db.query(`DELETE FROM inquiry_log WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM inquiry_prep WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM inquiry_removal_cases WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM cards WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${MARK}%`]);
  }

  before(async () => {
    clearHandlers();
    org = await resolveDefaultOrg(db);
    await wipe();
    staffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Send Tester','inquiry_specialist','active') RETURNING id`,
      [org, `${MARK}.staff@example.com`]
    )).rows[0].id;
  });

  after(async () => {
    await wipe();
    await close().catch(() => {});
  });

  async function seedClient(suffix) {
    return (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,'Send',$3) RETURNING id`,
      [org, `${MARK}.${suffix}@example.com`, suffix]
    )).rows[0].id;
  }

  async function seedPacket(client) {
    for (const [kind, subtype, title] of [
      ["client_upload", "id_document", "ID"],
      ["client_upload", "proof_of_address", "Address"],
      ["authorization", "soft_pull_consent", "Auth"]
    ]) {
      await db.query(
        `INSERT INTO documents (
           org_id, client_id, document_key, kind, subtype, title,
           storage_key, mime_type, byte_size
         ) VALUES (
           $1,$2,$3,$4,$5,$6,
           $7,'application/pdf',100
         )`,
        [
          org, client, `${kind}|${subtype}|${client}|${Date.now()}`,
          kind, subtype, title, `memory://test/${client}/${subtype}`
        ]
      );
    }
  }

  test("no letter attempt until send runs", async () => {
    clientId = await seedClient("nosend");
    const c = await createCase(db, {
      orgId: org,
      row: {
        client_id: clientId,
        case_status: "Queued",
        selected_bureaus_raw: "EX",
        open_inquiry_count: 1
      }
    });
    const before = (await db.query(
      `SELECT count(*)::int AS n FROM inquiry_attempts a
         JOIN inquiry_log i ON i.id = a.inquiry_id
        WHERE i.client_id = $1 AND a.kind = 'letter'`,
      [clientId]
    )).rows[0].n;
    assert.equal(before, 0);
    assert.ok(c.id);
  });

  test("send with complete packet writes letter attempt", async () => {
    clientId = await seedClient("mail");
    await seedPacket(clientId);
    const c = await createCase(db, {
      orgId: org,
      row: {
        client_id: clientId,
        case_status: "Queued",
        selected_bureaus_raw: "TU",
        open_inquiry_count: 1
      }
    });
    const result = await sendCase(db, {
      caseId: c.id,
      staffId,
      orgId: org,
      mail: true
    });
    assert.equal(result.case.case_status, "In Progress");
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM inquiry_attempts a
         JOIN inquiry_log i ON i.id = a.inquiry_id
        WHERE i.client_id = $1 AND a.kind = 'letter'`,
      [clientId]
    )).rows[0].n;
    assert.ok(n >= 1);
  });

  test("send blocked without packet", async () => {
    clientId = await seedClient("block");
    const c = await createCase(db, {
      orgId: org,
      row: {
        client_id: clientId,
        case_status: "Blocked",
        selected_bureaus_raw: "EQ",
        open_inquiry_count: 1
      }
    });
    await assert.rejects(
      () => sendCase(db, { caseId: c.id, staffId, orgId: org, mail: true }),
      (e) => e instanceof SendGateError && e.code === "docs_blocked"
    );
  });

  test("last doc flips Blocked cases to Queued", async () => {
    clientId = await seedClient("flip");
    await createCase(db, {
      orgId: org,
      row: {
        client_id: clientId,
        case_status: "Blocked",
        selected_bureaus_raw: "EX",
        open_inquiry_count: 1
      }
    });
    // incomplete — flip should no-op
    let res = await onDocsReceivedFlipInquiryGate(
      { orgId: org, clientId, payload: {} },
      db
    );
    assert.equal(res.flipped, 0);

    await seedPacket(clientId);
    res = await onDocsReceivedFlipInquiryGate(
      { orgId: org, clientId, payload: { document_id: "x" } },
      db
    );
    assert.equal(res.flipped, 1);
    const st = (await db.query(
      `SELECT case_status FROM inquiry_removal_cases WHERE client_id = $1`,
      [clientId]
    )).rows[0].case_status;
    assert.equal(st, "Queued");
  });
});
