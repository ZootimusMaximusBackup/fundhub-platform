import { test } from "node:test";
import assert from "node:assert/strict";

import { findSingleBraceTags, findSingleBraceTagsInNodes } from "./copy-tags.mjs";

test("finds a bare single-brace tag", () => {
  assert.deepEqual(findSingleBraceTags("Hi {first_name}, quick update"), ["first_name"]);
});

test("a correctly double-braced tag is not flagged", () => {
  assert.deepEqual(findSingleBraceTags("Hi {{first_name}}, quick update"), []);
});

test("does not false-positive on the inner substring of a double-brace token", () => {
  // {{first_name}} contains the substring "{first_name}" — a one-pass regex
  // would wrongly flag this as broken. It must not.
  assert.deepEqual(findSingleBraceTags("{{first_name}}"), []);
});

test("a single-brace tag is still caught alongside a correct one", () => {
  assert.deepEqual(findSingleBraceTags("Hi {{first_name}}, see {survey_link}"), ["survey_link"]);
});

test("dotted double-brace tokens are recognized and stripped", () => {
  assert.deepEqual(findSingleBraceTags("Hi {{contact.first_name}}, {portal_link}"), ["portal_link"]);
});

test("null and empty are not violations", () => {
  assert.deepEqual(findSingleBraceTags(null), []);
  assert.deepEqual(findSingleBraceTags(undefined), []);
  assert.deepEqual(findSingleBraceTags(""), []);
});

test("duplicate single-brace tags are reported once, in first-seen order", () => {
  assert.deepEqual(findSingleBraceTags("{first_name} ... {first_name} ... {last_name}"), ["first_name", "last_name"]);
});

test("findSingleBraceTagsInNodes walks sms and email steps only", () => {
  const nodes = [
    { id: "n1", type: "sms", title: "Text them", cfg: { body: "Hi {first_name}" } },
    { id: "n2", type: "wait", title: "Wait a day", cfg: { amount: "1", unit: "days" } },
    { id: "n3", type: "email", title: "Email", cfg: { subject: "Hi {first_name}", body: "All good {{first_name}}" } }
  ];
  const violations = findSingleBraceTagsInNodes(nodes);
  assert.equal(violations.length, 2);
  assert.deepEqual(violations[0], { nodeId: "n1", nodeTitle: "Text them", field: "body", tags: ["first_name"] });
  assert.deepEqual(violations[1], { nodeId: "n3", nodeTitle: "Email", field: "subject", tags: ["first_name"] });
});

test("findSingleBraceTagsInNodes walks every condition branch", () => {
  const nodes = [
    {
      id: "n1",
      type: "condition",
      title: "Did they reply",
      cfg: { field: "x", op: "is true" },
      branches: [
        { label: "Yes", nodes: [{ id: "n2", type: "sms", title: "Good", cfg: { body: "Nice {first_name}" } }] },
        { label: "No", nodes: [{ id: "n3", type: "sms", title: "Nudge", cfg: { body: "Hi {{first_name}}" } }] }
      ]
    }
  ];
  const violations = findSingleBraceTagsInNodes(nodes);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].nodeId, "n2");
});

test("a clean tree reports no violations", () => {
  assert.deepEqual(findSingleBraceTagsInNodes([
    { id: "n1", type: "sms", title: "Text them", cfg: { body: "Hi {{first_name}} — {{survey_link}}" } }
  ]), []);
});

test("nodes with no cfg do not throw", () => {
  assert.deepEqual(findSingleBraceTagsInNodes([{ id: "n1", type: "sms", title: "Text them" }]), []);
  assert.deepEqual(findSingleBraceTagsInNodes(null), []);
  assert.deepEqual(findSingleBraceTagsInNodes(undefined), []);
});
