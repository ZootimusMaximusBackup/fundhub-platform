// The roadmap's opening paragraph used to assert, for EVERY client, that they had
// a mortgage, paid-off auto loans and a clean TransUnion. It was hardcoded prose,
// so it was false for anyone who had none of those — including the fixture the
// deliverables' own hard-cases pack uses. These tests pin it to the client's file.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildRoadmap } from "./roadmap.mjs";

const base = {
  applicant: "Dana Reyes",
  scores: { experian: 601, transunion: 0, equifax: 598 },
  score_targets: {}, negatives: [], bureaus: [], mortgages: [], installments: [], revolving: []
};
const note = (c) => (buildRoadmap(c).match(/A note before we dive in:[^<]*/) || [""])[0];

describe("the roadmap's opening note only says what the file shows", () => {
  test("no mortgage on file, no mortgage in the letter", () => {
    const t = note({ ...base, revolving: [["AMEX", "Experian", 5200, null, "", "", "MONITOR"]] });
    assert.ok(!/mortgage/i.test(t), t);
    assert.ok(!/auto loan/i.test(t), t);
    assert.ok(t.includes("You have revolving cards."), t);
  });

  test("every bureau dirty, so no bureau is called clean", () => {
    const t = note({ ...base, bureaus: [["Experian", "DIRTY", 3, ""], ["TransUnion", "DIRTY", 2, ""]] });
    assert.ok(!/clean/i.test(t), t);
  });

  test("an empty file makes no claim at all, and does not say they are ahead", () => {
    const t = note(base);
    assert.ok(!/You have/.test(t), t);
    assert.ok(!/not starting from zero/.test(t), t);
    assert.ok(t.includes("clearing the road"), t);
  });

  test("what is really there is still said, and named correctly", () => {
    const t = note({
      ...base,
      mortgages: [["Chase Mtg", "open", "210000", ""]],
      installments: [["Ally Auto", "paid", "0", ""]],
      revolving: [["AMEX", "Experian", 5200, 9000, "", "", "MONITOR"]],
      bureaus: [["Experian", "DIRTY", 3, ""], ["TransUnion", "CLEAN", 0, ""], ["Equifax", "CLEAN", 0, ""]]
    });
    assert.ok(t.includes("You have a mortgage."), t);
    assert.ok(t.includes("You have installment loans."), t);
    assert.ok(t.includes("Your TransUnion and Equifax files are clean."), t);
    assert.ok(t.includes("You are not starting from zero."), t);
  });

  test("one clean bureau reads as one, not as a list", () => {
    const t = note({ ...base, bureaus: [["Experian", "DIRTY", 3, ""], ["TransUnion", "CLEAN", 0, ""]] });
    assert.ok(t.includes("You have a clean TransUnion."), t);
  });
});
