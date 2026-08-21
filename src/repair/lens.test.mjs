/* Repair desk lens — pure unit tests. Spec §8 chip order + due words + rollups.
 * No dollars. No database.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHIPS,
  TILE_FILTERS,
  deriveChip,
  dueWords,
  roundLabel,
  tileSets,
  rollupCounts,
  warningDots,
  timelineLine
} from "./lens.mjs";

const AS_OF = "2026-08-21T12:00:00Z";

describe("chip dictionary — first match wins, one action chip", () => {
  it("lists eight chips in §8 order", () => {
    assert.deepEqual(CHIPS.map((c) => c.key), [
      "needs_agreement",
      "review_answer",
      "send_letters",
      "stuck",
      "waiting_on_bureau",
      "round_done",
      "trial_done",
      "none"
    ]);
  });

  it("Needs agreement beats everything when authorization is missing", () => {
    const chip = deriveChip({
      authorization_ok: false,
      has_unconfirmed_parse: true,
      letters_ready: 3,
      stage_key: "stalled"
    });
    assert.equal(chip.key, "needs_agreement");
    assert.equal(chip.label, "Needs agreement");
  });

  it("Read their answer beats send when a parse is unconfirmed", () => {
    assert.equal(
      deriveChip({
        authorization_ok: true,
        has_unconfirmed_parse: true,
        letters_ready: 2,
        letters_sent: 0
      }).key,
      "review_answer"
    );
  });

  it("Send letters when ready letters exist and none sent", () => {
    assert.equal(
      deriveChip({
        authorization_ok: true,
        letters_ready: 2,
        letters_sent: 0
      }).key,
      "send_letters"
    );
  });

  it("Stuck on stalled stage or SLA breach", () => {
    assert.equal(
      deriveChip({ authorization_ok: true, stage_key: "stalled" }).key,
      "stuck"
    );
    assert.equal(
      deriveChip({ authorization_ok: true, sla_breached: true, stage_key: "in_transit" }).key,
      "stuck"
    );
  });

  it("Waiting on the bureau for in_transit / awaiting_response", () => {
    assert.equal(
      deriveChip({ authorization_ok: true, stage_key: "awaiting_response" }).key,
      "waiting_on_bureau"
    );
  });

  it("Round done and Trial done — sales", () => {
    assert.equal(
      deriveChip({ authorization_ok: true, stage_key: "round_complete" }).key,
      "round_done"
    );
    assert.equal(
      deriveChip({ authorization_ok: true, upsell_pending: true }).key,
      "trial_done"
    );
    assert.equal(
      deriveChip({ authorization_ok: true, program_status: "upsell_pending" }).key,
      "trial_done"
    );
  });

  it("none when nothing is needed", () => {
    assert.equal(deriveChip({ authorization_ok: true, stage_key: "analysis" }).key, "none");
  });
});

describe("dueWords", () => {
  it("returns dim em-dash when no due date", () => {
    assert.deepEqual(dueWords(null, AS_OF), { text: "—", tone: "dim" });
  });

  it("counts days ahead and overdue from asOf (never invents a clock)", () => {
    assert.equal(dueWords("2026-08-24T12:00:00Z", AS_OF).text, "due in 3 days");
    assert.equal(dueWords("2026-08-21T12:00:00Z", AS_OF).text, "due today");
    const late = dueWords("2026-08-19T12:00:00Z", AS_OF);
    assert.equal(late.text, "overdue 2 days");
    assert.equal(late.tone, "late");
  });
});

describe("roundLabel — never invents dollars", () => {
  it("formats n / cap from R-keys", () => {
    assert.equal(roundLabel({ round: "R1", rounds_cap: 2 }), "1 / 2");
    assert.equal(roundLabel({ round: "R3", rounds_cap: 6 }), "3 / 6");
  });

  it("never mentions a price or dollar amount", () => {
    const text = roundLabel({ round: "R1", rounds_cap: 2, price_total: 200, amount_paid: 200 });
    assert.equal(text, "1 / 2");
    assert.ok(!/\$/.test(text));
    assert.ok(!/200/.test(text));
  });
});

describe("tiles + rollups", () => {
  it("exposes five tile filters including trial", () => {
    assert.deepEqual([...TILE_FILTERS], ["need", "ready", "wait", "stuck", "trial"]);
  });

  it("rollupCounts match tileSets math including trial_ending", () => {
    const files = [
      { authorization_ok: false }, // need
      { authorization_ok: true, letters_ready: 1, letters_sent: 0 }, // need + ready
      { authorization_ok: true, stage_key: "awaiting_response" }, // wait
      { authorization_ok: true, stage_key: "stalled", need_me: true }, // stuck + need
      { authorization_ok: true, upsell_pending: true } // trial
    ];
    const r = rollupCounts(files);
    assert.equal(r.need_me, 3);
    assert.equal(r.ready, 1);
    assert.equal(r.waiting, 1);
    assert.equal(r.stalled, 1);
    assert.equal(r.trial_ending, 1);
  });

  it("tileSets can put send_letters in need and ready", () => {
    const row = { authorization_ok: true, letters_ready: 2, letters_sent: 0 };
    const sets = tileSets(row);
    assert.ok(sets.includes("need"));
    assert.ok(sets.includes("ready"));
  });
});

describe("warning dots + timeline", () => {
  it("warningDots never invent dollars", () => {
    const dots = warningDots({ address_ok: false, no_furnisher_address: true, price_total: 200 });
    assert.deepEqual(dots.map((d) => d.key), ["no_address", "no_furnisher_address"]);
    for (const d of dots) {
      assert.ok(!/\$/.test(d.label));
    }
  });

  it("timelineLine turns a decision into plain words", () => {
    const line = timelineLine({
      decision: "letters_generated",
      created_at: "2026-08-21T18:00:00Z"
    });
    assert.match(line, /letters generated/i);
  });
});
