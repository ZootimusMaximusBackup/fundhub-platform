// Unit tests for the mail intake parser and normalizer. Everything here is
// PURE — no database, no clock, no I/O — so it runs in every environment and
// there is nothing to skip. ingestBatch's database behaviour is proved against
// real Postgres in ingest.pg.test.mjs, not faked here: a stub that models the
// schema you wish you had cannot fail when the schema moves (AUDIT-FINDINGS).
//
// The parser tests are hostile on purpose. A mail file comes from outside and
// gets printed onto envelopes that cannot be recalled, so "it worked on the
// sample" is not a standard.

import { test } from "node:test";
import assert from "node:assert";
import { parseDelimited, normalizeRecord, ingestBatch, fieldToken, FIELD_KINDS, MailIngestError } from "./ingest.mjs";

/** A db that fails the test if anything reaches it. Not a fake database — it
 *  models no schema and answers no query. It exists only to prove that the
 *  argument checks below run BEFORE anything is sent to Postgres. */
const untouchableDb = {
  query() {
    throw new assert.AssertionError({ message: "ingestBatch must not reach the database here" });
  }
};

/* =========================================================================
 * parseDelimited — shape
 * ========================================================================= */

test("parseDelimited: the header row becomes the keys and every later line becomes one object", () => {
  const rows = parseDelimited("name,city\nAda,Leeds\nGrace,Arlington");
  assert.deepStrictEqual(rows, [
    { name: "Ada", city: "Leeds" },
    { name: "Grace", city: "Arlington" }
  ]);
});

test("parseDelimited: an empty file is no records rather than an error or a row of nothing", () => {
  assert.deepStrictEqual(parseDelimited(""), []);
});

test("parseDelimited: a file that is only whitespace and newlines is no records", () => {
  assert.deepStrictEqual(parseDelimited("\n\n   \n\r\n"), []);
});

test("parseDelimited: a header-only file is no records, not one record of empty strings", () => {
  assert.deepStrictEqual(parseDelimited("name,city\n"), []);
  assert.deepStrictEqual(parseDelimited("name,city"), []);
});

test("parseDelimited: a trailing newline does not produce a phantom final record", () => {
  assert.equal(parseDelimited("a\n1\n").length, 1);
  assert.equal(parseDelimited("a\n1").length, 1);
});

test("parseDelimited: a blank line in the middle of a file is skipped, not read as a record", () => {
  assert.deepStrictEqual(parseDelimited("a\n1\n\n2\n"), [{ a: "1" }, { a: "2" }]);
});

test("parseDelimited: a row of empty cells is a real row, unlike a blank line", () => {
  assert.deepStrictEqual(parseDelimited("a,b\n,"), [{ a: "", b: "" }]);
});

/* =========================================================================
 * parseDelimited — quoting
 * ========================================================================= */

test("parseDelimited: a quoted field keeps a delimiter that appears inside it", () => {
  assert.deepStrictEqual(
    parseDelimited('name,address\nAda,"12 King St, Apt 4"'),
    [{ name: "Ada", address: "12 King St, Apt 4" }]
  );
});

test("parseDelimited: a quoted field keeps an embedded newline verbatim rather than starting a new record", () => {
  const rows = parseDelimited('name,address\nAda,"12 King St\nApt 4"');
  assert.equal(rows.length, 1, "the embedded newline must not split the record");
  assert.equal(rows[0].address, "12 King St\nApt 4");
});

test("parseDelimited: an embedded CRLF inside quotes is preserved byte for byte, not rewritten", () => {
  const rows = parseDelimited('a,b\r\n1,"x\r\ny"\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].b, "x\r\ny", "rewriting the inside of a field is the parser inventing data");
});

test('parseDelimited: "" inside a quoted field is one literal quote', () => {
  assert.deepStrictEqual(parseDelimited('a\n"she said ""hi"""'), [{ a: 'she said "hi"' }]);
});

test("parseDelimited: a quoted empty field is an empty value, not a missing column", () => {
  const rows = parseDelimited('a,b\n"",x');
  assert.equal(rows[0].a, "");
  assert.ok(Object.prototype.hasOwnProperty.call(rows[0], "a"));
});

test("parseDelimited: text after a closing quote is appended rather than discarded", () => {
  assert.deepStrictEqual(parseDelimited('a\n"Ada"Lovelace'), [{ a: "AdaLovelace" }]);
});

test("parseDelimited: a quote in the middle of an unquoted field is a literal character", () => {
  assert.deepStrictEqual(parseDelimited('a\n5" pipe'), [{ a: '5" pipe' }]);
});

test("parseDelimited: a file that ends inside a quoted field throws instead of returning the salvage", () => {
  assert.throws(
    () => parseDelimited('a,b\n1,"unterminated'),
    (e) => e instanceof MailIngestError && e.code === "unterminated_quote",
    "a truncated transfer must not read as a smaller campaign"
  );
});

test("parseDelimited: a properly closed quote at end of file is not mistaken for a truncated one", () => {
  assert.deepStrictEqual(parseDelimited('a\n"done"'), [{ a: "done" }]);
});

/* =========================================================================
 * parseDelimited — line endings and the BOM
 * ========================================================================= */

test("parseDelimited: CRLF line endings do not leave a stray carriage return on the last value", () => {
  assert.deepStrictEqual(parseDelimited("a,b\r\n1,2\r\n"), [{ a: "1", b: "2" }]);
});

test("parseDelimited: a bare CR ends a row like a newline does", () => {
  assert.deepStrictEqual(parseDelimited("a\r1\r2"), [{ a: "1" }, { a: "2" }]);
});

test("parseDelimited: LF and CRLF mixed in one file both terminate exactly one row", () => {
  assert.deepStrictEqual(parseDelimited("a\n1\r\n2\n3"), [{ a: "1" }, { a: "2" }, { a: "3" }]);
});

test("parseDelimited: a UTF-8 BOM is stripped so the first column is reachable by its name", () => {
  const rows = parseDelimited("﻿record_slug,city\nabc,Leeds");
  assert.deepStrictEqual(Object.keys(rows[0]), ["record_slug", "city"]);
  assert.equal(rows[0].record_slug, "abc");
});

test("parseDelimited: a BOM-like character in the middle of the file is left alone", () => {
  const rows = parseDelimited("a\nx﻿y");
  assert.equal(rows[0].a, "x﻿y");
});

/* =========================================================================
 * parseDelimited — ragged rows and header oddities
 * ========================================================================= */

test("parseDelimited: a short row leaves the missing column absent rather than empty", () => {
  const rows = parseDelimited("a,b,c\n1,2");
  assert.deepStrictEqual(rows, [{ a: "1", b: "2" }]);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], "c"), false,
    "a column nobody sent is not a column that arrived blank");
});

test("parseDelimited: a long row keeps its extra cells under a positional key instead of dropping them", () => {
  const rows = parseDelimited("a,b\n1,2,3,4");
  assert.deepStrictEqual(rows, [{ a: "1", b: "2", column_2: "3", column_3: "4" }]);
});

test("parseDelimited: the positional key for an extra cell is the same on every row that has one", () => {
  const rows = parseDelimited("a\n1,x\n2,y");
  assert.deepStrictEqual(rows, [{ a: "1", column_1: "x" }, { a: "2", column_1: "y" }]);
});

test("parseDelimited: duplicate header names both survive instead of the second overwriting the first", () => {
  const rows = parseDelimited("zip,city,zip\n11201,Leeds,90210");
  assert.deepStrictEqual(rows, [{ zip: "11201", city: "Leeds", zip__2: "90210" }]);
});

test("parseDelimited: three copies of a header name give three distinct keys", () => {
  const rows = parseDelimited("z,z,z\n1,2,3");
  assert.deepStrictEqual(Object.keys(rows[0]), ["z", "z__1", "z__2"]);
});

test("parseDelimited: a blank header cell gets a positional key so its column is not lost", () => {
  const rows = parseDelimited("a,,c\n1,2,3");
  assert.deepStrictEqual(rows, [{ a: "1", column_1: "2", c: "3" }]);
});

test("parseDelimited: header cells are trimmed but values are not — trimming values is the normalizer's job", () => {
  const rows = parseDelimited("  name ,city\n  Ada  ,Leeds");
  assert.deepStrictEqual(rows, [{ name: "  Ada  ", city: "Leeds" }]);
});

test("parseDelimited: two headers that differ only by whitespace do not collapse onto one key", () => {
  const rows = parseDelimited("zip, zip \n1,2");
  assert.deepStrictEqual(rows, [{ zip: "1", zip__1: "2" }]);
});

test("parseDelimited: a header literally named __proto__ becomes an own property, not a prototype write", () => {
  const rows = parseDelimited("__proto__,a\nhacked,1");
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], "__proto__"), true);
  assert.equal(Object.getOwnPropertyDescriptor(rows[0], "__proto__").value, "hacked");
  assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype, "nothing was written through the prototype");
  assert.equal({}.hacked, undefined);
});

test("parseDelimited: a header named constructor does not disturb the object's constructor", () => {
  const rows = parseDelimited("constructor\nx");
  assert.equal(rows[0].constructor, "x");
  assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype);
});

/* =========================================================================
 * parseDelimited — delimiters and bad input
 * ========================================================================= */

test("parseDelimited: a pipe-delimited file parses when the delimiter is passed", () => {
  assert.deepStrictEqual(parseDelimited("a|b\n1|2", { delimiter: "|" }), [{ a: "1", b: "2" }]);
});

test("parseDelimited: a tab-delimited file parses and a comma inside a value stays put", () => {
  assert.deepStrictEqual(
    parseDelimited("a\tb\n1\tLeeds, UK", { delimiter: "\t" }),
    [{ a: "1", b: "Leeds, UK" }]
  );
});

test("parseDelimited: with a custom delimiter, quoting still protects that delimiter", () => {
  assert.deepStrictEqual(
    parseDelimited('a|b\n1|"x|y"', { delimiter: "|" }),
    [{ a: "1", b: "x|y" }]
  );
});

test("parseDelimited: garbage input throws rather than being coerced into a record", () => {
  for (const bad of [null, undefined, 42, {}, [], Buffer.from("a\n1")]) {
    assert.throws(
      () => parseDelimited(bad),
      (e) => e instanceof MailIngestError && e.code === "text_not_a_string",
      `expected a throw for ${String(bad)}`
    );
  }
});

test("parseDelimited: a delimiter that is not exactly one character is refused", () => {
  for (const bad of ["", ",,", null, 5]) {
    assert.throws(
      () => parseDelimited("a\n1", { delimiter: bad }),
      (e) => e instanceof MailIngestError && e.code === "bad_delimiter"
    );
  }
});

test("parseDelimited: a quote or a line terminator cannot be used as the delimiter", () => {
  for (const bad of ['"', "\r", "\n"]) {
    assert.throws(
      () => parseDelimited("a\n1", { delimiter: bad }),
      (e) => e instanceof MailIngestError && e.code === "bad_delimiter"
    );
  }
});

test("parseDelimited: a 5000-column single row does not lose or duplicate a cell", () => {
  const n = 5000;
  const header = Array.from({ length: n }, (_, i) => `c${i}`).join(",");
  const values = Array.from({ length: n }, (_, i) => String(i)).join(",");
  const rows = parseDelimited(`${header}\n${values}`);
  assert.equal(Object.keys(rows[0]).length, n);
  assert.equal(rows[0].c4999, "4999");
});

/* =========================================================================
 * normalizeRecord — the trims
 * ========================================================================= */

test("normalizeRecord: leading and trailing whitespace is trimmed off every value", () => {
  const { normalized } = normalizeRecord({ name: "  Ada Lovelace  " });
  assert.equal(normalized.name, "Ada Lovelace");
});

test("normalizeRecord: internal runs of whitespace collapse to a single space", () => {
  const { normalized } = normalizeRecord({ name: "Ada    B\t\tLovelace" });
  assert.equal(normalized.name, "Ada B Lovelace");
});

test("normalizeRecord: an embedded newline from a quoted cell collapses into one line", () => {
  const { normalized } = normalizeRecord({ address: "12 King St\r\nApt 4" });
  assert.equal(normalized.address, "12 King St Apt 4");
});

test("normalizeRecord: a non-breaking space is whitespace like any other", () => {
  const { normalized } = normalizeRecord({ city: "New  York" });
  assert.equal(normalized.city, "New York");
});

test("normalizeRecord: a clean record produces no warnings at all", () => {
  const { normalized, warnings } = normalizeRecord({ name: "Ada", state: "NY", zip: "11201" });
  assert.deepStrictEqual(warnings, []);
  assert.deepStrictEqual(normalized, { name: "Ada", state: "NY", zip: "11201" });
});

test("normalizeRecord: normalizing an already-normalized record changes nothing and warns about nothing", () => {
  const once = normalizeRecord({ name: "  Ada  ", state: "ny", zip: "11201-4444", phone: "(212) 555-0100" });
  const twice = normalizeRecord(once.normalized);
  assert.deepStrictEqual(twice.normalized, once.normalized);
  assert.deepStrictEqual(twice.warnings, []);
});

test("normalizeRecord: the input row is never mutated", () => {
  const row = { name: "  Ada  ", state: "ny" };
  normalizeRecord(row);
  assert.deepStrictEqual(row, { name: "  Ada  ", state: "ny" });
});

/* =========================================================================
 * normalizeRecord — state, zip, phone
 * ========================================================================= */

test("normalizeRecord: a state is uppercased", () => {
  assert.equal(normalizeRecord({ state: "ny" }).normalized.state, "NY");
  assert.equal(normalizeRecord({ State: " ca " }).normalized.State, "CA");
});

test("normalizeRecord: a state that is not two letters is reported but kept exactly as sent", () => {
  const { normalized, warnings } = normalizeRecord({ state: "California" });
  assert.equal(normalized.state, "CALIFORNIA", "never corrected — the code is a lookup this module has no source for");
  assert.deepStrictEqual(warnings, [{ field: "state", code: "state_not_two_letters" }]);
});

test("normalizeRecord: a zip keeps only its digits and the plus-four is not truncated", () => {
  assert.equal(normalizeRecord({ zip: "11201-4444" }).normalized.zip, "112014444");
});

test("normalizeRecord: a zip written with spaces or a stray letter still reduces to digits", () => {
  assert.equal(normalizeRecord({ "Zip Code": " 902 10 " }).normalized["Zip Code"], "90210");
});

test("normalizeRecord: a zip with no digits in it is dropped rather than stored as an empty string", () => {
  const { normalized, warnings } = normalizeRecord({ zip: "N/A" });
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "zip"), false);
  assert.deepStrictEqual(warnings, [{ field: "zip", code: "zip_no_digits" }]);
});

test("normalizeRecord: a phone keeps only its digits", () => {
  assert.equal(normalizeRecord({ phone: "(212) 555-0100" }).normalized.phone, "2125550100");
});

test("normalizeRecord: a phone is not promoted to E.164 — no country code is assumed", () => {
  assert.equal(normalizeRecord({ phone: "212-555-0100" }).normalized.phone, "2125550100");
});

test("normalizeRecord: a phone with no digits is dropped and reported", () => {
  const { normalized, warnings } = normalizeRecord({ phone: "none on file" });
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "phone"), false);
  assert.deepStrictEqual(warnings, [{ field: "phone", code: "phone_no_digits" }]);
});

test("normalizeRecord: column names are matched ignoring case, spaces and punctuation", () => {
  for (const key of ["zip", "ZIP", "Zip Code", "zip_code", "ZIP-CODE", "postal code"]) {
    assert.equal(normalizeRecord({ [key]: "11201-4444" }).normalized[key], "112014444", key);
  }
  for (const key of ["phone", "PHONE", "Phone Number", "phone_number"]) {
    assert.equal(normalizeRecord({ [key]: "(212) 555-0100" }).normalized[key], "2125550100", key);
  }
});

test("normalizeRecord: an unrecognised column is kept verbatim rather than reformatted or dropped", () => {
  const { normalized, warnings } = normalizeRecord({ "Household Income Band": "  50k - 75k  " });
  assert.equal(normalized["Household Income Band"], "50k - 75k");
  assert.deepStrictEqual(warnings, []);
});

test("normalizeRecord: ST is deliberately not treated as a state because it may be a street", () => {
  const { normalized, warnings } = normalizeRecord({ st: "12 king street" });
  assert.equal(normalized.st, "12 king street", "a coin-flip mapping does not belong here");
  assert.deepStrictEqual(warnings, []);
});

test("normalizeRecord: a caller who knows the real layout can pass its own column names", () => {
  const kinds = { state: new Set(["STATECODE"]), zip: new Set(), phone: new Set() };
  const { normalized } = normalizeRecord({ state_code: "ny", zip: "11201-4444" }, { kinds });
  assert.equal(normalized.state_code, "NY");
  assert.equal(normalized.zip, "11201-4444", "zip is untouched because this caller's kinds do not claim it");
});

/* =========================================================================
 * normalizeRecord — never invent
 * ========================================================================= */

test("normalizeRecord: a blank value is absent from the record and produces a missing warning", () => {
  const { normalized, warnings } = normalizeRecord({ name: "Ada", city: "" });
  assert.deepStrictEqual(normalized, { name: "Ada" });
  assert.deepStrictEqual(warnings, [{ field: "city", code: "missing" }]);
});

test("normalizeRecord: a whitespace-only value counts as missing, not as a space", () => {
  const { normalized, warnings } = normalizeRecord({ city: "   \t \n " });
  assert.deepStrictEqual(normalized, {});
  assert.deepStrictEqual(warnings, [{ field: "city", code: "missing" }]);
});

test("normalizeRecord: null and undefined values are missing, never the strings null or undefined", () => {
  const { normalized, warnings } = normalizeRecord({ a: null, b: undefined });
  assert.deepStrictEqual(normalized, {});
  assert.deepStrictEqual(warnings, [{ field: "a", code: "missing" }, { field: "b", code: "missing" }]);
});

test("normalizeRecord: a record missing its name, state and address gets none of them invented", () => {
  const { normalized, warnings } = normalizeRecord({
    record_slug: "abc-123", name: "", state: "", address: "   ", city: "Leeds"
  });
  assert.deepStrictEqual(normalized, { record_slug: "abc-123", city: "Leeds" });
  assert.deepStrictEqual(warnings.map((w) => w.field), ["name", "state", "address"]);
  assert.ok(warnings.every((w) => w.code === "missing"));
});

test("normalizeRecord: a required field that is absent entirely is reported as missing", () => {
  const { normalized, warnings } = normalizeRecord({ city: "Leeds" }, { required: ["record_slug", "city"] });
  assert.deepStrictEqual(normalized, { city: "Leeds" });
  assert.deepStrictEqual(warnings, [{ field: "record_slug", code: "missing" }]);
});

test("normalizeRecord: nothing is required by default, because this repo does not say what a mail record must contain", () => {
  assert.deepStrictEqual(normalizeRecord({ anything: "x" }).warnings, []);
});

test("normalizeRecord: a required field that is present and blank is reported once, not twice", () => {
  const { warnings } = normalizeRecord({ city: "" }, { required: ["city"] });
  assert.deepStrictEqual(warnings, [{ field: "city", code: "missing" }]);
});

/* =========================================================================
 * normalizeRecord — hostile values
 * ========================================================================= */

test("normalizeRecord: a numeric cell becomes its digits as text rather than being dropped", () => {
  assert.equal(normalizeRecord({ zip: 11201 }).normalized.zip, "11201");
  assert.equal(normalizeRecord({ n: 0 }).normalized.n, "0", "zero is a value, not an absence");
});

test("normalizeRecord: NaN does not become the string NaN", () => {
  const { normalized, warnings } = normalizeRecord({ zip: NaN });
  assert.deepStrictEqual(normalized, {});
  assert.deepStrictEqual(warnings, [{ field: "zip", code: "unsupported_value" }]);
});

test("normalizeRecord: Infinity is refused the same way NaN is", () => {
  assert.deepStrictEqual(normalizeRecord({ n: Infinity }).warnings, [{ field: "n", code: "unsupported_value" }]);
});

test("normalizeRecord: a nested object or array value is dropped rather than stringified to [object Object]", () => {
  const { normalized, warnings } = normalizeRecord({ a: { deep: 1 }, b: [1, 2] });
  assert.deepStrictEqual(normalized, {});
  assert.deepStrictEqual(warnings, [
    { field: "a", code: "unsupported_value" },
    { field: "b", code: "unsupported_value" }
  ]);
});

test("normalizeRecord: a boolean cell is kept as its text", () => {
  assert.equal(normalizeRecord({ flag: true }).normalized.flag, "true");
});

test("normalizeRecord: a column whose name is blank is dropped and reported", () => {
  const { normalized, warnings } = normalizeRecord({ "  ": "x", a: "1" });
  assert.deepStrictEqual(normalized, { a: "1" });
  assert.deepStrictEqual(warnings, [{ field: "  ", code: "blank_field_name" }]);
});

test("normalizeRecord: two column names that are identical once trimmed keep the first and report the second", () => {
  const { normalized, warnings } = normalizeRecord({ zip: "11201", "zip ": "90210" });
  assert.deepStrictEqual(normalized, { zip: "11201" });
  assert.deepStrictEqual(warnings, [{ field: "zip", code: "duplicate_field" }]);
});

test("normalizeRecord: a __proto__ column becomes an own property and does not reach the prototype", () => {
  const row = {};
  Object.defineProperty(row, "__proto__", { value: " hacked ", enumerable: true, writable: true, configurable: true });
  const { normalized } = normalizeRecord(row);
  assert.equal(Object.getOwnPropertyDescriptor(normalized, "__proto__").value, "hacked");
  assert.equal(Object.getPrototypeOf(normalized), Object.prototype);
  assert.equal({}.hacked, undefined);
});

test("normalizeRecord: garbage in place of a row throws rather than producing an empty record", () => {
  for (const bad of [null, undefined, "a,b", 42, [], [{ a: 1 }]]) {
    assert.throws(
      () => normalizeRecord(bad),
      (e) => e instanceof MailIngestError && e.code === "row_not_an_object",
      `expected a throw for ${String(bad)}`
    );
  }
});

/* =========================================================================
 * fieldToken + the constants
 * ========================================================================= */

test("fieldToken: punctuation, spacing and case all reduce to the same token", () => {
  for (const name of ["Zip Code", "zip_code", "ZIP-CODE", "  zip   code  ", "zip.code"]) {
    assert.equal(fieldToken(name), "ZIPCODE", name);
  }
});

test("fieldToken: a null or undefined column name reduces to the empty token rather than throwing", () => {
  assert.equal(fieldToken(null), "");
  assert.equal(fieldToken(undefined), "");
});

test("FIELD_KINDS: the recognised column names are the short, unambiguous set and nothing was padded out", () => {
  assert.deepStrictEqual([...FIELD_KINDS.state], ["STATE"]);
  assert.deepStrictEqual([...FIELD_KINDS.zip], ["ZIP", "ZIPCODE", "POSTALCODE"]);
  assert.deepStrictEqual([...FIELD_KINDS.phone], ["PHONE", "PHONENUMBER"]);
});

/* =========================================================================
 * ingestBatch — the checks that happen before Postgres is touched
 * (everything ingestBatch does WITH a database is proved in ingest.pg.test.mjs
 *  against real Postgres, because a stub would only prove itself)
 * ========================================================================= */

test("ingestBatch: a missing orgId is refused before a single statement is sent", async () => {
  await assert.rejects(
    () => ingestBatch(untouchableDb, { rows: [{ record_slug: "x" }] }),
    (e) => e instanceof MailIngestError && e.code === "org_id_required"
  );
});

test("ingestBatch: rows that are not an array are refused rather than silently iterated", async () => {
  for (const bad of ["a,b", 7, { 0: { record_slug: "x" } }]) {
    await assert.rejects(
      () => ingestBatch(untouchableDb, { orgId: "org-1", rows: bad }),
      (e) => e instanceof MailIngestError && e.code === "rows_not_an_array"
    );
  }
});

test("ingestBatch: something that is not a database connection is refused", async () => {
  for (const bad of [null, undefined, {}, "postgres://x"]) {
    await assert.rejects(
      () => ingestBatch(bad, { orgId: "org-1", rows: [] }),
      (e) => e instanceof MailIngestError && e.code === "db_required"
    );
  }
});

test("ingestBatch: an empty batch returns zeroes without touching the database", async () => {
  const res = await ingestBatch(untouchableDb, { orgId: "org-1", rows: [] });
  assert.deepStrictEqual(res, { inserted: 0, updated: 0, skipped: 0, errors: [], warnings: [] });
});

test("ingestBatch: a row with no slug column is refused without a statement being sent for it", async () => {
  const res = await ingestBatch(untouchableDb, { orgId: "org-1", rows: [{ name: "Ada", city: "Leeds" }] });
  assert.deepStrictEqual(res.errors, [{ index: 0, reason: "missing_record_slug" }]);
  assert.equal(res.skipped, 1);
  assert.equal(res.inserted, 0);
});

test("ingestBatch: a row that is not an object is one skipped row, not a dead batch", async () => {
  const res = await ingestBatch(untouchableDb, { orgId: "org-1", rows: ["not a row", null] });
  assert.deepStrictEqual(res.errors, [
    { index: 0, reason: "row_not_an_object" },
    { index: 1, reason: "row_not_an_object" }
  ]);
  assert.equal(res.skipped, 2);
});

/* =========================================================================
 * parse -> normalize, end to end and still pure
 * ========================================================================= */

test("a parsed file normalizes into exactly the values the file carried and nothing more", () => {
  const file =
    "﻿record_slug,name,address,city,state,zip,phone\r\n" +
    'DLX-0001,  Ada  Lovelace ,"12 King St, Apt 4",Leeds,ny,11201-4444,(212) 555-0100\r\n' +
    "DLX-0002,Grace Hopper,,Arlington,,,\r\n";

  const rows = parseDelimited(file);
  assert.equal(rows.length, 2);

  const first = normalizeRecord(rows[0]);
  assert.deepStrictEqual(first.normalized, {
    record_slug: "DLX-0001",
    name: "Ada Lovelace",
    address: "12 King St, Apt 4",
    city: "Leeds",
    state: "NY",
    zip: "112014444",
    phone: "2125550100"
  });
  assert.deepStrictEqual(first.warnings, []);

  const second = normalizeRecord(rows[1]);
  assert.deepStrictEqual(second.normalized, {
    record_slug: "DLX-0002",
    name: "Grace Hopper",
    city: "Arlington"
  }, "the empty address, state, zip and phone stay empty — no placeholder, no default state");
  assert.deepStrictEqual(second.warnings.map((w) => w.field), ["address", "state", "zip", "phone"]);
});
