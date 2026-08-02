// Merge fields — what actually reaches a client's eyes.
//
// The failure this file exists to prevent is a contract that goes out with
// "Dear {{contact.first_name}}" on it, or worse, with a fee blank where a number
// should be. Both are silent: renderTemplate substitutes an empty string for an
// unknown tag and warns to a log nobody reads.
//
// Pure unit tests, no database — clientContext() is the only thing here that
// touches one and it is exercised against a real Postgres in lifecycle.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  tagsIn, isoDate, mergeContext, renderContract, missingTags,
  normaliseManualFields, missingRequired
} from "./render.mjs";

const ctx = (values = {}, contact = {}) => mergeContext({ contact, values, at: new Date("2026-08-02T12:00:00Z") });

describe("contract rendering — the three namespaces", () => {
  test("contact.* comes off the client record", () => {
    const out = renderContract("Hello {{contact.first_name}} {{contact.last_name}}.",
      ctx({}, { first_name: "Ada", last_name: "Lovelace" }));
    assert.equal(out, "Hello Ada Lovelace.");
  });

  test("field.* is what the staff member typed into the blanks", () => {
    const out = renderContract("Deposit: {{field.deposit}}", ctx({ deposit: "$997" }));
    assert.equal(out, "Deposit: $997");
  });

  test("{{today}} is the send date in UTC, not the server's local date", () => {
    assert.equal(renderContract("Dated {{today}}.", ctx()), "Dated 2026-08-02.");
    assert.equal(isoDate(new Date("2026-01-09T23:59:59Z")), "2026-01-09");
  });

  test("no braces survive into a document anybody signs", () => {
    const out = renderContract(
      "{{contact.first_name}} {{field.amount}} {{today}} {{nope.at.all}}",
      ctx({ amount: "5" }, { first_name: "A" }));
    assert.ok(!out.includes("{{"), `braces survived: ${out}`);
  });
});

describe("contract rendering — what a manual value may NOT do", () => {
  /* The single most important assertion in this file. If a blank could land on
     `contact`, a staff member could change who a contract appears to be
     addressed to without touching the client record — and the rendered document
     would be the only place that lie existed. */
  test("a blank cannot overwrite a client field, even when it shares the name", () => {
    const c = mergeContext({
      contact: { email: "real@example.com" },
      values: { "contact.email": "attacker@example.com", email: "attacker@example.com" }
    });
    assert.equal(c.contact.email, "real@example.com");
    assert.equal(renderContract("{{contact.email}}", c), "real@example.com");
  });

  test("an object or array blank renders blank rather than [object Object]", () => {
    const out = renderContract("[{{field.x}}][{{field.y}}]", ctx({ x: { a: 1 }, y: [1, 2] }));
    assert.equal(out, "[][]");
  });

  test("a null or undefined blank renders as an empty string, not the word null", () => {
    assert.equal(renderContract("[{{field.a}}][{{field.b}}]", ctx({ a: null, b: undefined })), "[][]");
  });

  test("a number blank keeps its digits", () => {
    assert.equal(renderContract("{{field.n}}", ctx({ n: 0 })), "0");
  });
});

describe("missingTags — telling a typo apart from an empty field", () => {
  test("a tag nothing supplies is reported as unknown", () => {
    const c = ctx({}, { first_name: "Ada" });
    assert.deepEqual(missingTags("Hi {{clint.first_name}}", c), [{ tag: "clint.first_name", reason: "unknown" }]);
  });

  test("a real tag with no value for this client is reported as blank", () => {
    const c = ctx({}, { first_name: "Ada", phone: "" });
    assert.deepEqual(missingTags("{{contact.phone}}", c), [{ tag: "contact.phone", reason: "blank" }]);
  });

  test("a tag that resolves is not reported at all", () => {
    assert.deepEqual(missingTags("{{contact.first_name}} {{today}}", ctx({}, { first_name: "Ada" })), []);
  });

  test("an unfilled blank is reported, so a fee never prints empty unnoticed", () => {
    assert.deepEqual(missingTags("Fee: {{field.fee}}", ctx({})), [{ tag: "field.fee", reason: "unknown" }]);
  });

  test("every distinct tag is reported once, in the order it first appears", () => {
    const out = missingTags("{{field.b}} {{field.a}} {{field.b}}", ctx({}));
    assert.deepEqual(out.map((m) => m.tag), ["field.b", "field.a"]);
  });
});

describe("tagsIn", () => {
  test("matches the renderer's own pattern: whitespace, dots, repeats", () => {
    assert.deepEqual(tagsIn("{{ a }} {{a.b.c}} {{a}}"), ["a", "a.b.c"]);
  });
  test("a lone brace pair with nothing in it is not a tag", () => {
    assert.deepEqual(tagsIn("{{}} {{ }}"), []);
  });
});

describe("normaliseManualFields — the blanks a template declares", () => {
  test("fills in defaults and keeps only the four known properties", () => {
    assert.deepEqual(
      normaliseManualFields([{ key: "fee", extra: "ignored" }]),
      [{ key: "fee", label: "fee", required: false, help: null }]);
  });

  test("accepts the jsonb column as a string", () => {
    assert.deepEqual(normaliseManualFields('[{"key":"a","label":"A","required":true}]'),
      [{ key: "a", label: "A", required: true, help: null }]);
  });

  test("null and an empty list are both no blanks at all", () => {
    assert.deepEqual(normaliseManualFields(null), []);
    assert.deepEqual(normaliseManualFields([]), []);
  });

  /* A key with a dot or a space in it produces {{field.a b}}, which the merge
     pattern cannot match and which therefore renders literally into a signed
     contract. Refused at the point somebody types it, not discovered later. */
  test("refuses a key the merge pattern could never resolve", () => {
    for (const bad of ["a b", "a.b", "", "a-b", "a!"]) {
      assert.throws(() => normaliseManualFields([{ key: bad }]), /short name/,
        `key ${JSON.stringify(bad)} should have been refused`);
    }
  });

  test("refuses a duplicate key — two blanks with one name is a silent overwrite", () => {
    assert.throws(() => normaliseManualFields([{ key: "a" }, { key: "a" }]), /listed twice/);
  });

  test("refuses a shape the screen could not render", () => {
    assert.throws(() => normaliseManualFields({ key: "a" }), /must be an array/);
    assert.throws(() => normaliseManualFields(["a"]), /must be an object/);
  });
});

describe("missingRequired — the blanks a send may not leave empty", () => {
  const fields = [
    { key: "fee", label: "Success fee", required: true },
    { key: "note", label: "Note", required: false }
  ];

  test("reports the LABEL, because that is what is on the form", () => {
    assert.deepEqual(missingRequired(fields, {}), ["Success fee"]);
  });

  test("whitespace is not an answer", () => {
    assert.deepEqual(missingRequired(fields, { fee: "   " }), ["Success fee"]);
  });

  test("a filled required blank passes and an empty optional one is fine", () => {
    assert.deepEqual(missingRequired(fields, { fee: "10%" }), []);
  });

  test("zero is a real answer to a required blank", () => {
    assert.deepEqual(missingRequired(fields, { fee: 0 }), []);
  });
});
