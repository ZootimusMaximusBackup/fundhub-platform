import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NEED_ME_STAGES,
  stageLabel,
  isNeedMeStage,
  countNeedMe
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
