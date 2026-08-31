import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NEED_ME_STAGES,
  stageLabel,
  isNeedMeStage,
  countNeedMe,
  listRepairCases
} from "./cases.mjs";

describe("repair desk labels", () => {
  it("names ready_to_send in plain words", () => {
    assert.equal(stageLabel("ready_to_send"), "Ready to send");
    assert.equal(stageLabel("stalled"), "Stuck");
  });

  it("counts files that need a person", () => {
    assert.equal(isNeedMeStage("ready_to_send"), true);
    assert.equal(isNeedMeStage("program_complete"), false);
    assert.equal(
      countNeedMe([
        { need_me: true },
        { need_me: false },
        { need_me: true }
      ]),
      2
    );
    assert.ok(NEED_ME_STAGES.includes("stalled"));
  });
});

/* The tiles are counted over the rows that came back. Past the reader's cap that
   is a PAGE count wearing a caseload count's label — "17 need me" after looking
   at the first 100 of 143 files under-reports on exactly the day the desk is
   busiest. COUNT(*) OVER () rides along with the page so the screen can say which
   of the two it is showing instead of quietly claiming the wrong one. */
describe("the repair queue reports its real size", () => {
  const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function fakeDb(rows) {
    return {
      calls: [],
      async query(sql, params) {
        this.calls.push({ sql, params });
        if (/FROM cards/i.test(String(sql))) return { rows };
        return { rows: [] };
      }
    };
  }

  it("counts the whole caseload, not the page it fetched", async () => {
    const out = await listRepairCases(
      fakeDb([
        { card_id: "c1", client_id: "11111111-1111-4111-8111-111111111111", stage_key: "ready_to_send", queue_total: "143" },
        { card_id: "c2", client_id: "22222222-2222-4222-8222-222222222222", stage_key: "awaiting_response", queue_total: "143" }
      ]),
      { orgId: ORG, limit: 2 }
    );
    assert.equal(out.total, 143);
    assert.equal(out.files.length, 2);
    assert.ok(!("queue_total" in out.files[0]), "queue_total leaked onto a file row");
  });

  it("an empty queue is honestly zero, and a missing count falls back to the rows in hand", async () => {
    assert.equal((await listRepairCases(fakeDb([]), { orgId: ORG })).total, 0);
    const noWindow = await listRepairCases(
      fakeDb([{ card_id: "c1", client_id: "11111111-1111-4111-8111-111111111111", stage_key: "stalled" }]),
      { orgId: ORG }
    );
    assert.equal(noWindow.total, 1, "never NaN on a screen");
  });
});
