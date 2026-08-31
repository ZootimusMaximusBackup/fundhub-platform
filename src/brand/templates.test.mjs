import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FUNNELS, legalBlocks, defaultBody, mergeBodyJson, isLockedSection } from "./templates.mjs";

/* THE LOCKED-BLOCK COUNT IS DERIVED, NEVER TYPED. It was hard-coded at 3 until
   the day-1 fulfilment disclosure was added as a fourth locked block
   (docs/specs/W4-live-trial.md §5.4), and a hard-coded count turns "we added a
   required disclosure" into three unrelated-looking failures. Counting
   legalBlocks() itself keeps the real assertions — that every locked section is
   legal, that a PATCH cannot rewrite one, and that a dropped one comes back —
   and stops the count from being the thing under test. */
const LOCKED_COUNT = legalBlocks("Acme LLC").length;

describe("funnel templates", () => {
  test("five keys the partner_pages check already allows — no mail", () => {
    assert.deepEqual(Object.keys(FUNNELS).sort(), ["aff", "apply", "book", "diag", "edu"]);
  });

  test("every template ships locked legal blocks", () => {
    for (const key of Object.keys(FUNNELS)) {
      const body = defaultBody(key, { entity_name: "Acme LLC" });
      const locked = body.sections.filter(isLockedSection);
      assert.equal(locked.length, LOCKED_COUNT, key);
      assert.ok(locked.every((s) => s.type === "legal"));
      assert.ok(body.sections.some((s) => /not a direct lender/i.test(s.text || "")));
      assert.ok(body.sections.some((s) => /does not guarantee/i.test(s.text || "")));
      // Who actually performs the work. Required on every white-label surface
      // from day one, and locked so neither the AI copywriter nor a partner's
      // own page editor can reach it.
      assert.ok(body.sections.some((s) => /provided and performed by FundHub/i.test(s.text || "")));
    }
  });

  test("mergeBodyJson keeps locked legal copy even if PATCH overwrites it", () => {
    const current = defaultBody("apply", { entity_name: "Acme LLC" });
    const incoming = {
      sections: current.sections.map((s) => s.locked
        ? { ...s, text: "You are approved. Score up 100 points." }
        : s)
    };
    const merged = mergeBodyJson(current, incoming);
    const legal = merged.sections.filter(isLockedSection);
    assert.equal(legal.length, LOCKED_COUNT);
    assert.ok(legal.every((s) => !/approved|score up/i.test(s.text || "")));
    assert.deepEqual(legal, legalBlocks("Acme LLC"));
  });

  test("mergeBodyJson re-appends a locked block the PATCH dropped", () => {
    const current = defaultBody("book", { entity_name: "Acme LLC" });
    const incoming = { sections: current.sections.filter((s) => !s.locked) };
    const merged = mergeBodyJson(current, incoming);
    assert.equal(merged.sections.filter(isLockedSection).length, LOCKED_COUNT);
  });
});
