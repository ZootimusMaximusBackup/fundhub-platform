import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_UNITS,
  unitById,
  unitsForRole,
  hoursForUnits,
  hoursForFundingRound,
  monthlyMax,
  CAPACITY,
  STARTING_BARS,
  DEFAULT_APPS_PER_ROUND,
  DESK_HOURS_PER_MONTH,
  DEFAULT_ROUNDS_PER_FILE,
  FUNDED_FILE_MINUTES
} from "./role-unit-times.mjs";

describe("role unit times", () => {
  it("names the four jobs the owner asked about", () => {
    assert.equal(unitById("cc_application").unit, "1 credit card application");
    assert.equal(unitById("funding_round").unit, "1 funding round");
    assert.equal(unitById("repair_client_round").unit, "1 repair client, one round, letters already made");
    assert.equal(unitById("inquiry_ftc_upload").unit, "1 FTC or police report upload");
  });

  it("sets model desk minutes for every job", () => {
    assert.equal(unitById("cc_application").desk_minutes, 10);
    assert.equal(unitById("funding_round").desk_minutes, 50);
    assert.equal(unitById("repair_client_round").desk_minutes, 5);
    assert.equal(unitById("inquiry_ftc_upload").desk_minutes, 2);
    assert.equal(unitById("closer_logged_call").desk_minutes, 45);
    assert.equal(DEFAULT_APPS_PER_ROUND, 5);
    assert.equal(hoursForUnits("cc_application", 6), 1);
  });

  it("returns a number of hours for all five units", () => {
    for (const unit of ROLE_UNITS) {
      const hours = hoursForUnits(unit.id, 1);
      assert.equal(typeof hours, "number");
      assert.ok(Number.isFinite(hours));
    }
    assert.equal(hoursForFundingRound(5), hoursForUnits("cc_application", 5));
  });

  it("counts Specialist desk clicks when the work is only in Fundhub", () => {
    assert.equal(unitById("repair_client_round").fundhub_clicks, 4);
    assert.equal(unitById("inquiry_ftc_upload").fundhub_clicks, 4);
    assert.equal(hoursForUnits("inquiry_ftc_upload", 60), 2);
  });

  it("groups units by seat", () => {
    const fa = unitsForRole("funding_advisor").map((u) => u.id);
    assert.deepEqual(fa, ["cc_application", "funding_round"]);
    assert.ok(ROLE_UNITS.length >= 4);
  });

  it("computes monthly max from 160 desk hours", () => {
    assert.equal(DESK_HOURS_PER_MONTH, 160);
    assert.equal(DEFAULT_ROUNDS_PER_FILE, 3.5);
    assert.equal(FUNDED_FILE_MINUTES, 175);
    assert.equal(monthlyMax(45), 213);
    assert.equal(monthlyMax(45, { hours: 80 }), 106);
    assert.equal(monthlyMax(10), 960);
    assert.equal(monthlyMax(50), 192);
    assert.equal(monthlyMax(175), 54);
    assert.equal(monthlyMax(5), 1920);
    assert.equal(monthlyMax(2), 4800);
  });

  it("exports a capacity table with no null ceilings", () => {
    const byId = Object.fromEntries(CAPACITY.map((row) => [row.id, row]));
    assert.equal(byId.closer_logged_call.theoretical_max, 213);
    assert.equal(byId.closer_logged_call.half_time_max, 106);
    assert.equal(byId.closer_deposit.theoretical_max, 213);
    assert.equal(byId.cc_application.theoretical_max, 960);
    assert.equal(byId.funding_round.theoretical_max, 192);
    assert.equal(byId.funded_file.theoretical_max, 54);
    assert.equal(byId.funded_file.half_time_max, 27);
    assert.equal(STARTING_BARS.funding_advisor_files, byId.funded_file.half_time_max);
    assert.equal(STARTING_BARS.closer_deposits, STARTING_BARS.funding_advisor_files);
    assert.equal(STARTING_BARS.per, "pod");
    assert.ok(STARTING_BARS.closer_deposits < byId.closer_logged_call.half_time_max);
    assert.equal(byId.repair_client_round.theoretical_max, 1920);
    assert.equal(byId.inquiry_ftc_upload.theoretical_max, 4800);
    assert.equal(byId.ftc_pdf_obtain.minutes, 15);
    for (const row of CAPACITY) {
      assert.equal(typeof row.theoretical_max, "number");
      assert.equal(typeof row.half_time_max, "number");
    }
  });
});
