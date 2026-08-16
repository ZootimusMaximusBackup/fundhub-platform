"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { contentToNodes, parseMarkdown } = require("../crs/render-pdf");

function visible(node) {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || "").join("");
  return "";
}

function assertNotDumped(nodes) {
  assert.ok(Array.isArray(nodes), "contentToNodes must return an array");
  const blob = JSON.stringify(nodes);
  assert.equal(blob.includes("```"), false, "must never print a code fence");
  for (const n of nodes) {
    const v = visible(n);
    assert.equal(/```json/i.test(v), false, "must never print ```json");
    assert.equal(/\{\s*"t"\s*:\s*"sec"/.test(v), false, "must never print raw { t: sec } blobs");
    if (n.type === "paragraph") {
      assert.equal(JSON.stringify(n).includes('"sections"'), false);
    }
  }
}

test("contentToNodes renders JSON sections instead of dumping raw JSON", () => {
  const raw = "```json\n" + JSON.stringify({
    sections: [
      { type: "heading", content: "Bureau Health Summary" },
      { type: "paragraph", content: "TransUnion is clean." },
      {
        type: "table",
        content: {
          headers: ["Bureau", "Status"],
          rows: [["TransUnion", "CLEAN"], ["Experian", "DIRTY"]]
        }
      },
      { type: "callout", style: "green", content: "You can fund." },
      { type: "metric_row", content: { value: "$50,000", label: "Projected" } }
    ]
  }) + "\n```";
  const nodes = contentToNodes(raw);
  assertNotDumped(nodes);
  assert.ok(!nodes.some((n) => n.type === "paragraph" && JSON.stringify(n).includes("sections")));
  assert.equal(nodes[0].type, "h2");
  assert.equal(nodes[0].text, "Bureau Health Summary");
  assert.equal(nodes[1].type, "paragraph");
  assert.equal(nodes[2].type, "table");
  assert.deepEqual(nodes[2].headers, ["Bureau", "Status"]);
  assert.equal(nodes[3].type, "callout");
  assert.equal(nodes[4].type, "metric");
  assert.equal(nodes[4].value, "$50,000");
});

test("contentToNodes refuses unusable JSON instead of printing it", () => {
  const nodes = contentToNodes('```json\n{"heading":"x","paragraph":"y"}\n```');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, "callout");
  assert.match(nodes[0].text, /could not be formatted/i);
  assertNotDumped(nodes);
});

test("contentToNodes parses gold t:sec body instead of dumping it", () => {
  const raw = "```json\n" + JSON.stringify({
    body: [
      { t: "lead", body: "Warm open." },
      {
        t: "sec",
        code: "02",
        tag: "SCORES",
        title: "Three bureaus",
        blocks: [{ t: "table", headers: ["Bureau"], rows: [["TransUnion"]] }]
      }
    ]
  }) + "\n```";
  const nodes = contentToNodes(raw);
  assertNotDumped(nodes);
  assert.equal(nodes[0].type, "lead");
  assert.equal(nodes[1].type, "section");
  assert.equal(nodes[1].code, "02");
  assert.equal(nodes[2].type, "table");
});

test("contentToNodes still parses normal markdown", () => {
  const nodes = contentToNodes("## Hello\n\nWorld");
  assert.deepEqual(
    nodes.map((n) => n.type).filter((t) => t !== "blank"),
    parseMarkdown("## Hello\n\nWorld").map((n) => n.type).filter((t) => t !== "blank")
  );
});

test("contentToNodes turns a big fenced sections array into headings and tables", () => {
  const sections = [];
  for (let i = 0; i < 12; i++) {
    sections.push({ type: "heading", content: "Section " + i });
    sections.push({
      type: "table",
      content: {
        headers: ["Bureau", "Status"],
        rows: [["TransUnion", "CLEAN"], ["Experian", "DIRTY"]]
      }
    });
    sections.push({ type: "paragraph", content: "Notes for section " + i + "." });
  }
  const raw = "```json\n" + JSON.stringify({ sections }) + "\n```";
  const nodes = contentToNodes(raw);
  assertNotDumped(nodes);
  assert.equal(nodes.filter((n) => n.type === "h2").length, 12);
  assert.equal(nodes.filter((n) => n.type === "table").length, 12);
  assert.equal(nodes[0].text, "Section 0");
});

test("contentToNodes recovers trailing commas and nested wrappers without dumping", () => {
  const trailing = contentToNodes('```json\n{"sections":[{"type":"heading","content":"Hi",},]}\n```');
  assertNotDumped(trailing);
  assert.equal(trailing[0].type, "h2");
  assert.equal(trailing[0].text, "Hi");

  const nested = contentToNodes(
    "```json\n" + JSON.stringify({ report: { sections: [{ type: "heading", content: "Nested Head" }] } }) + "\n```"
  );
  assertNotDumped(nested);
  assert.equal(nested[0].type, "h2");
  assert.equal(nested[0].text, "Nested Head");

  const doubled = contentToNodes(
    "```json\n" + JSON.stringify(JSON.stringify({ sections: [{ type: "heading", content: "Dbl" }] })) + "\n```"
  );
  assertNotDumped(doubled);
  assert.equal(doubled[0].type, "h2");
  assert.equal(doubled[0].text, "Dbl");
});

test("contentToNodes truncated JSON does not throw and does not dump the fence", () => {
  const raw = '```json\n{"sections":[{"type":"heading","content":"Hi"';
  const nodes = contentToNodes(raw);
  assertNotDumped(nodes);
  assert.ok(nodes.length >= 1);
  assert.ok(nodes.every((n) => n.type !== "paragraph" || !visible(n).includes("sections")));
  assert.equal(nodes.some((n) => n.type === "callout"), true);
});

test("contentToNodes empty null and whitespace do not throw", () => {
  assert.deepEqual(contentToNodes(""), []);
  assert.deepEqual(contentToNodes(null), []);
  assert.deepEqual(contentToNodes(undefined), []);
  assert.deepEqual(contentToNodes("   \n\t  "), []);
});

test("contentToNodes keeps markdown around a json fence", () => {
  const raw =
    "## Hello\n\nWorld\n\n```json\n" +
    JSON.stringify({ sections: [{ type: "heading", content: "From JSON" }] }) +
    "\n```\n\nTail paragraph.";
  const nodes = contentToNodes(raw);
  assertNotDumped(nodes);
  const types = nodes.map((n) => n.type).filter((t) => t !== "blank");
  assert.deepEqual(types, ["h2", "paragraph", "h2", "paragraph"]);
  assert.equal(nodes.find((n) => n.type === "h2").text, "Hello");
  assert.equal(nodes.filter((n) => n.type === "h2")[1].text, "From JSON");
  assert.match(visible(nodes.filter((n) => n.type === "paragraph").at(-1)), /Tail paragraph/);
});

test("contentToNodes accepts a gold t:sec document object", () => {
  const nodes = contentToNodes({
    t: "sec",
    code: "02",
    tag: "SCORES",
    title: "Three bureaus",
    blocks: [{ t: "table", headers: ["Bureau"], rows: [["TransUnion"]] }]
  });
  assertNotDumped(nodes);
  assert.equal(nodes[0].type, "section");
  assert.equal(nodes[0].code, "02");
  assert.equal(nodes[1].type, "table");
});

test("contentToNodes does not print a raw t:sec blob sitting in markdown", () => {
  const raw =
    'Intro line\n{"t":"sec","code":"02","tag":"SCORES","title":"Three bureaus","blocks":[{"t":"paragraph","body":"Clean."}]}\nOutro line';
  const nodes = contentToNodes(raw);
  assertNotDumped(nodes);
  const types = nodes.map((n) => n.type).filter((t) => t !== "blank");
  assert.ok(types.includes("section"));
  assert.ok(nodes.some((n) => n.type === "paragraph" && visible(n) === "Clean."));
  assert.ok(nodes.some((n) => n.type === "paragraph" && visible(n) === "Intro line"));
  assert.ok(nodes.some((n) => n.type === "paragraph" && visible(n) === "Outro line"));
});

test("contentToNodes caps huge markdown instead of hanging", () => {
  const raw = "# Head\n\n" + "word ".repeat(42000);
  const t0 = Date.now();
  const nodes = contentToNodes(raw);
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, "200KB markdown took " + ms + "ms");
  assertNotDumped(nodes);
  assert.equal(nodes[0].type, "h1");
});

test("parseMarkdown skips json fences instead of printing them", () => {
  const nodes = parseMarkdown('```json\n{"foo":1}\n```\n\n## After');
  const blob = JSON.stringify(nodes);
  assert.equal(blob.includes("```"), false);
  assert.ok(nodes.some((n) => n.type === "h2" && n.text === "After"));
});
