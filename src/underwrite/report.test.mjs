import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGINES,
  SUGGESTION_CATALOGUE,
  annotateSuggestions,
  buildReport
} from "./report.mjs";

const CATALOGUE_LINE = Object.keys(SUGGESTION_CATALOGUE)[0];

function assertSafeShape(report) {
  assert.equal(typeof report, "object");
  assert.ok(report);
  assert.equal(report.engine.name, ENGINES.UNDERWRITE_IQ);
  assert.ok(Array.isArray(report.suggestions));
  assert.ok(Array.isArray(report.utilizationVoices));
  assert.ok(report.dataCompleteness);
  assert.ok(report.caveats);
  for (const s of report.suggestions) {
    assert.equal(typeof s.text, "string");
    assert.ok(!/```\s*json\b/i.test(s.text), "suggestion must not carry a json fence");
    const t = s.text.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      assert.throws(() => JSON.parse(t), "suggestion must not be parseable JSON");
    }
  }
}

test("buildReport(null) does not throw — empty safe shape", () => {
  const report = buildReport(null);
  assertSafeShape(report);
  assert.deepEqual(report.underwrite, {});
  assert.deepEqual(report.suggestions, []);
  assert.equal(report.utilizationVoices[0].value, null);
  assert.equal(report.caveats.bannerFundingIsFallback, true);
});

test("buildReport() / undefined / empty engine — no throw", () => {
  for (const input of [undefined, {}, { underwrite: null, suggestions: null, adapter: null }]) {
    assertSafeShape(buildReport(input));
  }
  assertSafeShape(buildReport());
});

test("empty engine + missing scores — no throw, nulls stay null", () => {
  const report = buildReport({
    underwrite: {
      metrics: {},
      personal: {},
      optimization: {},
      per_bureau: {},
      primary_bureau: null,
      lite_banner_funding: null,
      fundable: null
    },
    suggestions: [],
    adapter: { missing: {}, available: [], scoreSource: null, scoreAsOf: null }
  });
  assertSafeShape(report);
  assert.equal(report.utilizationVoices[0].value, null);
  assert.equal(report.dataCompleteness.scoreSource, null);
  assert.deepEqual(report.dataCompleteness.bureausUnavailable, [
    "experian",
    "equifax",
    "transunion"
  ]);
});

test("non-array adapter.available does not throw", () => {
  for (const available of [1, true, {}, "experian"]) {
    const report = buildReport({ underwrite: {}, suggestions: [], adapter: { available } });
    assertSafeShape(report);
    assert.deepEqual(report.dataCompleteness.bureausAssessed, []);
    assert.deepEqual(report.dataCompleteness.bureausUnavailable, []);
  }
});

test("JSON dump / object suggestions are dropped, not shipped as text", () => {
  const report = buildReport({
    underwrite: {},
    suggestions: [
      CATALOGUE_LINE,
      { sections: [{ type: "heading", content: "nope" }] },
      "```json\n{\"a\":1}\n```",
      JSON.stringify({ sections: [{ type: "paragraph", content: "dump" }] }),
      "[1,2,3]",
      "You're close to approval. A few targeted improvements will push you into approval range."
    ],
    adapter: {}
  });
  assertSafeShape(report);
  assert.equal(report.suggestions.length, 2);
  assert.equal(report.suggestions[0].text, CATALOGUE_LINE);
  assert.equal(report.suggestions[0].recognised, true);
  assert.equal(report.suggestions[1].recognised, true);
  assert.ok(!JSON.stringify(report.suggestions).includes("```"));
  assert.ok(!JSON.stringify(report.suggestions).includes('"sections"'));
});

test("annotateSuggestions null engine / missing — catalogue line still labels", () => {
  const [row] = annotateSuggestions([CATALOGUE_LINE], null, null);
  assert.equal(row.recognised, true);
  assert.equal(row.id, SUGGESTION_CATALOGUE[CATALOGUE_LINE].id);
  assert.equal(row.engine, ENGINES.UNDERWRITE_IQ);
  assert.ok(row.basis);
});

test("annotateSuggestions drops JSON dumps", () => {
  const rows = annotateSuggestions(
    ["```json\n{}\n```", CATALOGUE_LINE, { foo: 1 }, ""],
    {},
    {}
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, CATALOGUE_LINE);
});
