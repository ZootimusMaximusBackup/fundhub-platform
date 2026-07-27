// The canonicalization contract. If these break, the warehouse starts paying
// for duplicates again.

import { test } from "node:test";
import assert from "node:assert";
import {
  canonicalName, canonicalStreet, canonicalCity, addressKey,
  normalizeState, normalizeZip5, normalizePhone, normalizeEmail,
  normalizeNaics, normalizeAmount, normalizeInt, normalizeDate,
  cleanText, normalizeBusiness,
} from "./normalize.mjs";

test("canonicalName: the headline case from the spec", () => {
  // "ABC LLC" and "A.B.C., L.L.C." must dedupe.
  assert.equal(canonicalName("ABC LLC"), canonicalName("A.B.C., L.L.C."));
  assert.equal(canonicalName("ABC LLC"), "ABC");
});

test("canonicalName: legal suffixes strip, including stacked ones", () => {
  const forms = [
    "Acme Trucking LLC", "ACME TRUCKING, L.L.C.", "Acme Trucking, Inc.",
    "The Acme Trucking Company", "Acme Trucking Co., Inc.", "acme trucking corp",
    "Acme Trucking Co Inc", "ACME TRUCKING LIMITED",
  ];
  const keys = new Set(forms.map(canonicalName));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(" | ")}`);
  assert.equal([...keys][0], "ACME TRUCKING");
});

test("canonicalName: ampersand is a word, not punctuation", () => {
  assert.equal(canonicalName("Smith & Sons LLC"), canonicalName("Smith and Sons, LLC"));
});

test("canonicalName: apostrophes close up, they do not split", () => {
  assert.equal(canonicalName("O'Brien Hauling LLC"), "OBRIEN HAULING");
  assert.equal(canonicalName("Joe's Diner Inc"), "JOES DINER");
});

test("canonicalName: diacritics fold to ASCII", () => {
  assert.equal(canonicalName("Café Münchén Ltd"), canonicalName("Cafe Munchen"));
});

test("canonicalName: leading article dropped", () => {
  assert.equal(canonicalName("The Home Depot"), canonicalName("Home Depot"));
});

test("canonicalName: a name that is ONLY suffixes survives", () => {
  // Guard against stripping a real business down to nothing.
  assert.notEqual(canonicalName("The Company"), "");
  assert.notEqual(canonicalName("LLC"), "");
});

test("canonicalName: unusable input yields empty string, never a fake name", () => {
  for (const junk of ["", "   ", "N/A", "n/a", "UNKNOWN", "None", "-", null, undefined]) {
    assert.equal(canonicalName(junk), "", `expected '' for ${JSON.stringify(junk)}`);
  }
});

test("canonicalName: ordinals normalize to digits", () => {
  assert.equal(canonicalName("First Choice Freight LLC"), canonicalName("1st Choice Freight LLC"));
});

test("canonicalStreet: USPS suffixes, directionals and units converge", () => {
  const forms = [
    "123 North Main Street, Suite 200",
    "123 N. Main St. #200",
    "123 N Main St Ste 200",
    "123 N MAIN STREET UNIT 200",
    "123 n main st apt 200",
  ];
  const keys = new Set(forms.map(canonicalStreet));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(" | ")}`);
  assert.equal([...keys][0], "123 N MAIN ST STE 200");
});

test("canonicalStreet: PO Box forms converge, and BOX is not eaten as a unit word", () => {
  const forms = ["P.O. Box 47", "PO BOX 47", "Post Office Box 47", "P O Box 47"];
  const keys = new Set(forms.map(canonicalStreet));
  assert.equal(keys.size, 1, `got ${[...keys].join(" | ")}`);
  assert.equal([...keys][0], "PO BOX 47");
});

test("canonicalStreet: a dangling unit designator is dropped", () => {
  assert.equal(canonicalStreet("123 Main St Ste"), "123 MAIN ST");
});

test("canonicalStreet: different suites stay different", () => {
  assert.notEqual(canonicalStreet("123 Main St Ste 200"), canonicalStreet("123 Main St Ste 300"));
});

test("canonicalCity: SAINT and ST converge", () => {
  assert.equal(canonicalCity("Saint Louis"), canonicalCity("St. Louis"));
});

test("addressKey: keys on ZIP, so city spelling cannot split a record", () => {
  const a = addressKey({ street: "123 N Main St", city: "Saint Louis", state: "MO", zip: "63101" });
  const b = addressKey({ street: "123 North Main Street", city: "ST LOUIS", state: "MO", zip: "63101-4455" });
  assert.equal(a, b);
});

test("addressKey: same street in different ZIPs stays distinct", () => {
  assert.notEqual(
    addressKey({ street: "123 Main St", zip: "63101" }),
    addressKey({ street: "123 Main St", zip: "90210" })
  );
});

test("addressKey: no street yields '' — a real value the unique index can hold", () => {
  assert.equal(addressKey({ city: "Reno", state: "NV", zip: "89502" }), "");
  assert.equal(addressKey({}), "");
});

test("addressKey: falls back to city+state when ZIP is absent", () => {
  const k = addressKey({ street: "123 Main St", city: "Reno", state: "NV" });
  assert.equal(k, "123 MAIN ST|RENO-NV");
});

test("normalizeState: codes and full names both resolve", () => {
  assert.equal(normalizeState("tx"), "TX");
  assert.equal(normalizeState("Texas"), "TX");
  assert.equal(normalizeState("District of Columbia"), "DC");
  assert.equal(normalizeState("Freedonia"), null);
  assert.equal(normalizeState(""), null);
});

test("normalizeZip5: truncates ZIP+4 and restores dropped leading zeros", () => {
  assert.equal(normalizeZip5("63101-4455"), "63101");
  assert.equal(normalizeZip5("2116"), "02116");     // spreadsheet ate the zero
  assert.equal(normalizeZip5("00000"), null);
  assert.equal(normalizeZip5("N/A"), null);
});

test("normalizePhone: keeps real numbers, rejects the placeholders", () => {
  assert.equal(normalizePhone("(512) 555-0100".replace("555", "477")), "5124770100");
  assert.equal(normalizePhone("1-512-477-0100"), "5124770100");
  assert.equal(normalizePhone("512.477.0100"), "5124770100");
  // placeholders and invalid NANP
  assert.equal(normalizePhone("5555555555"), null);
  assert.equal(normalizePhone("512-555-0100"), null);   // 555 exchange
  assert.equal(normalizePhone("0000000000"), null);
  assert.equal(normalizePhone("1111111111"), null);
  assert.equal(normalizePhone("012-345-6789"), null);   // area code cannot start 0
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("UNKNOWN"), null);
});

test("normalizeEmail: lowercases and rejects free text", () => {
  assert.equal(normalizeEmail("  Dispatch@Example.COM "), "dispatch@example.com");
  assert.equal(normalizeEmail("UNKNOWN"), null);
  assert.equal(normalizeEmail("none"), null);
  assert.equal(normalizeEmail("no email on file"), null);
  assert.equal(normalizeEmail("a@b"), null);
  assert.equal(normalizeEmail("a@b.com, c@d.com"), null);
});

test("normalizeNaics / Amount / Int / Date", () => {
  assert.equal(normalizeNaics("484121.0"), "484121");
  assert.equal(normalizeNaics(""), null);
  assert.equal(normalizeAmount("$1,234.56"), 1234.56);
  assert.equal(normalizeAmount("N/A"), null);
  assert.equal(normalizeInt("42.9"), 42);
  assert.equal(normalizeInt("-3"), null);
  assert.equal(normalizeDate("5/7/2021"), "2021-05-07");
  assert.equal(normalizeDate("2021-05-07T00:00:00"), "2021-05-07");
  assert.equal(normalizeDate("garbage"), null);
});

test("normalizeBusiness: two federal spellings produce one identity", () => {
  const ppp = normalizeBusiness({
    name: "Rivera Hauling LLC",
    street: "1420 N. Industrial Blvd. Ste 4",
    city: "Laredo", state: "TX", zip: "78045",
    loanAmount: "150000", naics: "484121",
  });
  const fmcsa = normalizeBusiness({
    name: "RIVERA HAULING, L.L.C.",
    street: "1420 North Industrial Boulevard, Suite 4",
    city: "LAREDO", state: "Texas", zip: "78045-1234",
    phone: "(956) 723-0100", email: "DISPATCH@Rivera.example", fleetSize: "12",
  });

  assert.equal(ppp.nameKey, fmcsa.nameKey);
  assert.equal(ppp.addressKey, fmcsa.addressKey);
  // Display form is preserved separately — this is what goes on the mail piece.
  assert.equal(ppp.name, "Rivera Hauling LLC");
  assert.equal(fmcsa.phone, "9567230100");
  assert.equal(fmcsa.email, "dispatch@rivera.example");
});

test("normalizeBusiness: returns null when there is no usable name", () => {
  assert.equal(normalizeBusiness({ name: "N/A", street: "123 Main St", zip: "63101" }), null);
  assert.equal(normalizeBusiness({ name: "" }), null);
});

test("cleanText: collapses whitespace, preserves case", () => {
  assert.equal(cleanText("  Acme   Trucking\tLLC "), "Acme Trucking LLC");
  assert.equal(cleanText("N/A"), null);
});
