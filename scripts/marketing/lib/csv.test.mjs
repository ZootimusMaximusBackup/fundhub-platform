// CSV reader/writer edge cases. Federal bulk files contain every one of these.

import { test } from "node:test";
import assert from "node:assert";
import { parseCsv, readMapped, resolveFields, headerToken, csvEscape, csvLine } from "./csv.mjs";

/** Feed a string through the parser in awkward chunk sizes. */
async function rows(text, chunkSize = 7) {
  const chunks = (async function* () {
    for (let i = 0; i < text.length; i += chunkSize) {
      yield Buffer.from(text.slice(i, i + chunkSize));
    }
  })();
  const out = [];
  for await (const r of parseCsv(chunks)) out.push(r);
  return out;
}

test("parseCsv: basic rows, split across arbitrary chunk boundaries", async () => {
  const got = await rows("a,b,c\r\n1,2,3\r\n4,5,6\r\n", 3);
  assert.deepEqual(got, [["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]]);
});

test("parseCsv: quoted fields with commas, quotes and newlines", async () => {
  const text = 'name,note\r\n"Smith, Jones & Co","He said ""hi"""\r\n"Multi\nLine Co",ok\r\n';
  const got = await rows(text, 5);
  assert.deepEqual(got, [
    ["name", "note"],
    ["Smith, Jones & Co", 'He said "hi"'],
    ["Multi\nLine Co", "ok"],
  ]);
});

test("parseCsv: strips a UTF-8 BOM", async () => {
  const got = await rows("﻿a,b\r\n1,2\r\n");
  assert.equal(got[0][0], "a");
});

test("parseCsv: bare LF, and a final row with no terminator", async () => {
  const got = await rows("a,b\n1,2\n3,4");
  assert.deepEqual(got, [["a", "b"], ["1", "2"], ["3", "4"]]);
});

test("parseCsv: empty trailing fields are preserved", async () => {
  const got = await rows("a,b,c\r\n1,,\r\n");
  assert.deepEqual(got[1], ["1", "", ""]);
});

test("parseCsv: CRLF inside a quoted field is data, not a row break", async () => {
  const got = await rows('a,b\r\n"x\r\ny",z\r\n', 2);
  assert.equal(got.length, 2);
  assert.equal(got[1][0], "x\r\ny");
});

test("headerToken: folds the spellings agencies actually ship", () => {
  const t = headerToken("BorrowerName");
  assert.equal(headerToken("Borrower Name"), t);
  assert.equal(headerToken("BORROWER_NAME"), t);
  assert.equal(headerToken("borrower-name"), t);
});

test("resolveFields: alias order wins, misses are reported not thrown", () => {
  const header = ["LoanNumber", "Borrower Name", "BorrowerCity"];
  const { index, missing } = resolveFields(header, {
    id: ["LoanNumber"],
    name: ["BorrowerName", "Borrower Name"],
    city: ["BorrowerCity"],
    phone: ["Telephone"],
  });
  assert.equal(index.id, 0);
  assert.equal(index.name, 1);
  assert.equal(index.city, 2);
  assert.deepEqual(missing, ["phone"]);
});

test("readMapped: maps by alias and tolerates short rows", async () => {
  const text = "BorrowerName,BorrowerCity,BorrowerZip\r\nAcme LLC,Reno,89502\r\nShort Row\r\n";
  const chunks = (async function* () { yield Buffer.from(text); })();
  const out = [];
  for await (const r of readMapped(chunks, {
    name: ["BorrowerName"], city: ["BorrowerCity"], zip: ["BorrowerZip"], phone: ["Telephone"],
  })) out.push(r);

  assert.equal(out.length, 2);
  assert.equal(out[0].values.name, "Acme LLC");
  assert.equal(out[0].values.phone, null);      // column absent from header
  assert.equal(out[0].rowNumber, 1);
  assert.equal(out[1].values.city, null);       // row ran out of cells
  assert.deepEqual(out[0].missing, ["phone"]);
});

test("readMapped: keepRaw off by default, on by request", async () => {
  const text = "A,B\r\n1,2\r\n";
  const mk = () => (async function* () { yield Buffer.from(text); })();
  const spec = { a: ["A"] };

  for await (const r of readMapped(mk(), spec)) assert.equal(r.raw, null);
  for await (const r of readMapped(mk(), spec, { keepRaw: true })) {
    assert.deepEqual(r.raw, { A: "1", B: "2" });
  }
});

test("csvEscape: quotes what needs quoting", () => {
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape("a,b"), '"a,b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(["ppp", "fmcsa"]), "ppp;fmcsa");
});

test("csvEscape: neutralizes spreadsheet formula injection", () => {
  // A business named "=cmd|..." must not execute when the mail house opens
  // the export in Excel.
  assert.equal(csvEscape("=1+1"), "'=1+1");
  assert.equal(csvEscape("+44 Ltd"), "'+44 Ltd");
  assert.equal(csvEscape("-Acme"), "'-Acme");
  assert.equal(csvEscape("@handle"), "'@handle");
  assert.equal(csvEscape("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
});

test("csvLine round-trips through the parser", async () => {
  const values = ["Smith, Jones & Co", 'He said "hi"', "", "ok"];
  const got = await rows(csvLine(values));
  assert.deepEqual(got[0], values);
});
