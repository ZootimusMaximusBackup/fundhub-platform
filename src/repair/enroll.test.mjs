// Unit tests for repair enroll (no database).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { enrollRepairProgram, RepairEnrollError } from "./enroll.mjs";

describe("enrollRepairProgram", () => {
  it("refuses without db", async () => {
    await assert.rejects(
      () => enrollRepairProgram(null, { orgId: "o", clientId: "c", program: "trial", priceTotal: 200 }),
      (err) => err instanceof RepairEnrollError && err.code === "db_required"
    );
  });

  it("refuses a bad program", async () => {
    const db = { async query() { return { rows: [] }; } };
    await assert.rejects(
      () => enrollRepairProgram(db, { orgId: "o", clientId: "c", program: "diy", priceTotal: 200 }),
      (err) => err instanceof RepairEnrollError && err.code === "invalid_program"
    );
  });

  it("upserts trial with rounds_cap 2 and emits repair.enrolled", async () => {
    const calls = [];
    const db = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (String(sql).includes("INSERT INTO repair_programs")) {
          return {
            rows: [{
              id: "p1",
              org_id: params[0],
              client_id: params[1],
              program: params[2],
              rounds_cap: params[3],
              price_total: params[4],
              amount_paid: params[5],
              status: "active",
              created_at: "2026-08-21T00:00:00Z"
            }]
          };
        }
        return { rows: [] };
      }
    };
    const r = await enrollRepairProgram(db, {
      orgId: "11111111-1111-4111-8111-111111111111",
      clientId: "22222222-2222-4222-8222-222222222222",
      program: "trial",
      priceTotal: 200,
      amountPaid: 200,
      staffId: "s1"
    });
    assert.equal(r.ok, true);
    assert.equal(r.program.program, "trial");
    assert.equal(r.program.rounds_cap, 2);
    assert.equal(r.program.price_total, 200);
    assert.equal(calls[0].params[3], 2);
  });

  it("full program uses rounds_cap 6", async () => {
    const db = {
      async query(sql, params) {
        if (String(sql).includes("INSERT INTO repair_programs")) {
          return {
            rows: [{
              id: "p1",
              org_id: params[0],
              client_id: params[1],
              program: params[2],
              rounds_cap: params[3],
              price_total: params[4],
              amount_paid: params[5],
              status: "active",
              created_at: "2026-08-21T00:00:00Z"
            }]
          };
        }
        return { rows: [] };
      }
    };
    const r = await enrollRepairProgram(db, {
      orgId: "11111111-1111-4111-8111-111111111111",
      clientId: "22222222-2222-4222-8222-222222222222",
      program: "full",
      priceTotal: 1000,
      amountPaid: 200
    });
    assert.equal(r.program.rounds_cap, 6);
    assert.equal(r.program.program, "full");
  });
});
