// The facts the portal assistant is given about where a file stands — and the
// two it is forbidden to state.
//
// These are pure-function tests over the prompt builder. The database read has
// its own test against a real Postgres in progress-facts.pg.test.mjs; what is
// under test here is the part that decides what the model is TOLD, because that
// is where a wrong sentence becomes a promise a regulated lender did not make.

import { test, describe } from "node:test";
import assert from "node:assert";
import { roundNumber, roundIsEscalation, progressFactLines } from "./progress-facts.mjs";
import { portalAssistantContext, portalAssistantSystemPrompt } from "./portal-assistant.mjs";

const facts = (over = {}) => ({
  known: true, roundCurrent: 2, roundCap: 6, stageWords: "with the bureaus, waiting on their reply",
  expectedResponseBy: "2026-04-02", nextStep: null, ...over
});

describe("round parsing", () => {
  test("R1 to R6 read as numbers", () => {
    assert.equal(roundNumber("R1"), 1);
    assert.equal(roundNumber("R6"), 6);
    assert.equal(roundNumber("r3"), 3);
  });

  test("FURNISHER is not squeezed into the ladder", () => {
    // It has no round number. Reporting it as one would put a client on a rung
    // of a six-step ladder they are not on.
    assert.equal(roundNumber("FURNISHER"), null);
    assert.equal(roundNumber(""), null);
    assert.equal(roundNumber(null), null);
    assert.equal(roundNumber("R7"), null);
  });

  test("escalation starts at 4", () => {
    assert.equal(roundIsEscalation(3), false);
    assert.equal(roundIsEscalation(4), true);
    assert.equal(roundIsEscalation(5), true);
    assert.equal(roundIsEscalation(null), false);
  });
});

describe("what the model is told", () => {
  test("nothing known produces no lines at all", () => {
    // Not a block of "we do not know" lines — those would teach the model to
    // start talking about a file it has no facts on.
    assert.deepEqual(progressFactLines(null), []);
    assert.deepEqual(progressFactLines({ known: false }), []);
  });

  test("the round and the cap are stated together", () => {
    const lines = progressFactLines(facts()).join("\n");
    assert.match(lines, /round 2 of 6/);
  });

  test("a missing cap is not filled in with 6", () => {
    const lines = progressFactLines(facts({ roundCap: null })).join("\n");
    assert.match(lines, /round 2\b/);
    assert.doesNotMatch(lines, /of 6/, "an unknown cap was reported as six rounds");
    assert.match(lines, /do not say/i);
  });

  test("a missing reply date is stated as missing, never invented", () => {
    const lines = progressFactLines(facts({ expectedResponseBy: null })).join("\n");
    assert.match(lines, /no reply date/i);
    // No date-shaped string may appear when there is no date.
    assert.doesNotMatch(lines, /\d{4}-\d{2}-\d{2}/, "a date was invented");
  });

  test("the reply date is framed as the bureaus' deadline, not a promise", () => {
    const lines = progressFactLines(facts()).join("\n");
    assert.match(lines, /2026-04-02/);
    assert.match(lines, /not a promise about the outcome/i);
  });
});

describe("the refusals", () => {
  test("rounds 4 and up carry the do-not-say-lodged instruction", () => {
    for (const r of [4, 5, 6]) {
      const lines = progressFactLines(facts({ roundCurrent: r })).join("\n");
      assert.match(lines, /Never say or imply that one has been/i,
        `round ${r} was described without the escalation refusal`);
      assert.match(lines, /do NOT know whether any complaint/i);
    }
  });

  test("rounds 1 to 3 do not carry it, because there is nothing to refuse", () => {
    for (const r of [1, 2, 3]) {
      const lines = progressFactLines(facts({ roundCurrent: r })).join("\n");
      assert.doesNotMatch(lines, /attorney general/i);
    }
  });

  test("an overdue step is a single kind reminder, explicitly not a nag", () => {
    const lines = progressFactLines(facts({
      nextStep: { title: "Proof of address", overdue: true }
    })).join("\n");
    assert.match(lines, /Proof of address/);
    assert.match(lines, /Do not nag/i);
  });

  test("nothing outstanding is said plainly rather than left silent", () => {
    const lines = progressFactLines(facts({ nextStep: null })).join("\n");
    assert.match(lines, /nothing waiting on them/i);
  });
});

describe("the system prompt", () => {
  test("the facts reach it", () => {
    const ctx = portalAssistantContext({
      client: { first_name: "Dana" },
      progress: facts({ nextStep: { title: "Photo ID", overdue: false } })
    });
    const prompt = portalAssistantSystemPrompt(ctx);
    assert.match(prompt, /round 2 of 6/);
    assert.match(prompt, /Photo ID/);
  });

  test("a client with no programme gets the prompt unchanged", () => {
    // The four original facts, and no round talk at all.
    const prompt = portalAssistantSystemPrompt(
      portalAssistantContext({ client: { first_name: "Dana" } }));
    assert.match(prompt, /Dana/);
    assert.doesNotMatch(prompt, /round \d/i);
  });

  test("the hard rules forbid inventing a round, filing a complaint, and selling", () => {
    const prompt = portalAssistantSystemPrompt(portalAssistantContext({ client: {} }));
    assert.match(prompt, /Never state a round number, a date, or a step that is not in the list/);
    assert.match(prompt, /Never say a complaint has been filed, received, accepted or opened/);
    assert.match(prompt, /Never sell anything/);
    // The rules that were already there must still be there.
    assert.match(prompt, /Never promise, guarantee, or predict a funding amount/);
  });
});
