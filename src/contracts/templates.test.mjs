// src/contracts/templates.test.mjs — createTemplate input rules and the insert
// shape that was shipping write_failed when column defaults were missing.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normaliseKey, createTemplate, TEMPLATE_KINDS } from "./templates.mjs";

describe("normaliseKey", () => {
  test("funding_agreement becomes FUNDING-AGREEMENT", () => {
    assert.equal(normaliseKey("funding_agreement"), "FUNDING-AGREEMENT");
  });

  test("spaces and mixed case fold the same way", () => {
    assert.equal(normaliseKey("Funding Agreement"), "FUNDING-AGREEMENT");
    assert.equal(normaliseKey("funding-agreement"), "FUNDING-AGREEMENT");
  });

  test("refuses an empty short name with a plain-English ContractError", () => {
    try {
      normaliseKey("  ");
      assert.fail("expected throw");
    } catch (e) {
      assert.equal(e.name, "ContractError");
      assert.equal(e.code, "invalid_template_key");
      assert.match(e.message, /short name/i);
      assert.equal(e.status, 400);
    }
  });
});

describe("createTemplate insert", () => {
  test("names source_kind and the empty jsonb columns so missing DEFAULTs cannot 500", async () => {
    let sql = "";
    let params = null;
    const db = {
      query: async (q, values) => {
        sql = q;
        params = values;
        return {
          rows: [{
            id: "t1", org_id: values[0], template_key: values[1], name: values[2],
            kind: values[3], subtype: values[4], body: values[5],
            manual_fields: JSON.parse(values[6]), signature_required: values[7],
            signature_statement: values[8], created_by: values[9],
            source_kind: "text", fields: [], page_sizes: [], signer_roles: [],
            active: true, updated_by: null, created_at: new Date(), updated_at: new Date(),
            document_id: null, document_version_id: null, original_filename: null, page_count: null
          }]
        };
      }
    };

    const row = await createTemplate(db, {
      orgId: "00000000-0000-0000-0000-000000000001",
      staffId: "00000000-0000-0000-0000-000000000002",
      templateKey: "funding_agreement",
      name: "Funding Agreement",
      kind: "contract",
      subtype: "funding_agreement",
      body: "Hello {{contact.first_name}} {{contact.last_name}} {{field.funding_amount}} {{field.success_fee}}",
      manualFields: [
        { key: "funding_amount", label: "Funding amount", required: true },
        { key: "success_fee", label: "Success fee", required: true }
      ]
    });

    assert.equal(row.template_key, "FUNDING-AGREEMENT");
    assert.match(sql, /source_kind/);
    assert.match(sql, /'text'/);
    assert.match(sql, /page_sizes/);
    assert.match(sql, /signer_roles/);
    assert.equal(params[1], "FUNDING-AGREEMENT");
    assert.equal(params[3], "contract");
    assert.equal(params[4], "funding_agreement");
    assert.ok(TEMPLATE_KINDS.includes("contract"));
  });

  test("a duplicate key becomes a 409 with a sentence, not a bare pg error", async () => {
    const db = {
      query: async () => {
        const err = new Error("duplicate key");
        err.code = "23505";
        throw err;
      }
    };
    try {
      await createTemplate(db, {
        orgId: "00000000-0000-0000-0000-000000000001",
        staffId: "00000000-0000-0000-0000-000000000002",
        templateKey: "funding_agreement",
        name: "Funding Agreement",
        body: "Words."
      });
      assert.fail("expected throw");
    } catch (e) {
      assert.equal(e.name, "ContractError");
      assert.equal(e.status, 409);
      assert.equal(e.code, "duplicate_template_key");
      assert.match(e.message, /already exists/i);
    }
  });

  test("a missing DEFAULT / NOT NULL violation becomes a clear ContractError", async () => {
    const db = {
      query: async () => {
        const err = new Error('null value in column "source_kind"');
        err.code = "23502";
        err.column = "source_kind";
        throw err;
      }
    };
    await assert.rejects(
      () => createTemplate(db, {
        orgId: "00000000-0000-0000-0000-000000000001",
        staffId: "00000000-0000-0000-0000-000000000002",
        templateKey: "xx", name: "X", body: "Words."
      }),
      (e) => e.code === "write_incomplete" && e.status === 500 && /migration 128/i.test(e.message)
    );
  });
});
