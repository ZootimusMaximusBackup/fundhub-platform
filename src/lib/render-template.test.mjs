import { test } from "node:test";
import assert from "node:assert";
import { renderTemplate } from "./render-template.mjs";

test("replaces known tokens", () => {
  assert.equal(renderTemplate("Hello {{first_name}}!", { first_name: "Alice" }), "Hello Alice!");
});

test("handles whitespace inside braces: {{ first_name }}", () => {
  assert.equal(renderTemplate("Hi {{ first_name }}.", { first_name: "Bob" }), "Hi Bob.");
});

test("unknown tokens become empty string", () => {
  const result = renderTemplate("Hi {{unknown_field}}.", {});
  assert.equal(result, "Hi .");
});

test("multiple tokens replaced", () => {
  const body = "{{greeting}} {{first_name}}, your score is {{score}}.";
  const result = renderTemplate(body, { greeting: "Hey", first_name: "Alice", score: "720" });
  assert.equal(result, "Hey Alice, your score is 720.");
});

test("null value in context renders as empty string", () => {
  assert.equal(renderTemplate("Name: {{name}}", { name: null }), "Name: ");
});

test("non-string body coerced to string", () => {
  assert.equal(renderTemplate(42, {}), "42");
});

test("empty body passes through", () => {
  assert.equal(renderTemplate("", { foo: "bar" }), "");
});
