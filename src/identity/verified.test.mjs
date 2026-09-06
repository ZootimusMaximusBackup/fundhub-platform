import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_IDENTITY,
  extractVerifiedIdentity,
  formatVerifiedAddress,
  normalizeDateOfBirth,
  normalizeVerifiedAddress,
  recordVerifiedIdentity,
  verifiedIdentity
} from "./verified.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

/* A model answers a missing field with a word, not with a JSON null, far more
   often than anybody expects. Each of these has to end up NULL, because the
   alternative is a letter to a credit bureau that says the client's legal name
   is "N/A". */
test("a word standing in for an absent value is not a value", () => {
  for (const word of ["null", "N/A", "n/a", "none", "unknown", "not shown", "not legible", "—", "", "   "]) {
    const got = extractVerifiedIdentity({ verified_legal_name: word });
    assert.equal(got.legalName, null, `"${word}" must read as absent`);
  }
});

test("extractVerifiedIdentity: reads only the three fields, from the names the agent may use", () => {
  const got = extractVerifiedIdentity({
    outcome: "accept",
    verified_legal_name: "  Christopher J Stanbridge  ",
    verified_address: { line1: "1005 W Hudson Way", city: "Gilbert", state: "az", zip: "85233" },
    verified_date_of_birth: "1985-04-02",
    // none of these may leak into a verified field
    documents_reviewed: ["Arizona driver licence"],
    message_to_client: "all good",
    hold_reason: null
  });
  assert.equal(got.legalName, "Christopher J Stanbridge");
  assert.equal(got.dateOfBirth, "1985-04-02");
  assert.deepEqual(got.address, {
    line1: "1005 W Hudson Way",
    line2: null,
    city: "Gilbert",
    state: "AZ",
    zip: "85233",
    formatted: "1005 W Hudson Way Gilbert, AZ 85233"
  });
});

test("extractVerifiedIdentity: an agent that returned nothing gives three nulls", () => {
  const got = extractVerifiedIdentity({ outcome: "accept", issues: [] });
  assert.deepEqual(got, { legalName: null, address: null, dateOfBirth: null });
});

test("normalizeDateOfBirth: takes an unambiguous date and refuses everything else", () => {
  assert.equal(normalizeDateOfBirth("1985-04-02"), "1985-04-02");
  assert.equal(normalizeDateOfBirth("04/02/1985"), "1985-04-02");
  assert.equal(normalizeDateOfBirth("4/2/1985"), "1985-04-02");
  // ambiguous, partial, impossible, or out of range — all NULL, never a guess
  assert.equal(normalizeDateOfBirth("02-04-85"), null);
  assert.equal(normalizeDateOfBirth("April 2 1985"), null);
  assert.equal(normalizeDateOfBirth("1985"), null);
  assert.equal(normalizeDateOfBirth("1985-02-31"), null);
  assert.equal(normalizeDateOfBirth("1985-13-01"), null);
  assert.equal(normalizeDateOfBirth("1800-01-01"), null);
  assert.equal(normalizeDateOfBirth(null), null);
});

test("normalizeVerifiedAddress: an unparsed address is kept whole rather than invented into parts", () => {
  const got = normalizeVerifiedAddress("1005 W Hudson Way, Gilbert AZ 85233");
  assert.deepEqual(got, {
    line1: null, line2: null, city: null, state: null, zip: null,
    formatted: "1005 W Hudson Way, Gilbert AZ 85233"
  });
  assert.equal(normalizeVerifiedAddress({}), null);
  assert.equal(normalizeVerifiedAddress({ line1: "", city: "  " }), null);
  assert.equal(normalizeVerifiedAddress(null), null);
  assert.equal(normalizeVerifiedAddress(["1005 W Hudson Way"]), null);
});

test("normalizeVerifiedAddress: a part the document did not show stays missing", () => {
  const got = normalizeVerifiedAddress({ line1: "1005 W Hudson Way", city: "Gilbert" });
  assert.equal(got.state, null);
  assert.equal(got.zip, null);
  assert.equal(got.formatted, "1005 W Hudson Way Gilbert");
});

test("formatVerifiedAddress: one printable line, or null when nothing is proved", () => {
  assert.equal(formatVerifiedAddress(null), null);
  assert.equal(formatVerifiedAddress({}), null);
  assert.equal(
    formatVerifiedAddress({ line1: "1005 W Hudson Way", line2: "Apt 4", city: "Gilbert", state: "AZ", zip: "85233" }),
    "1005 W Hudson Way Apt 4 Gilbert, AZ 85233"
  );
});

test("recordVerifiedIdentity: an agent that read nothing writes nothing", async () => {
  let queries = 0;
  const db = { async query() { queries += 1; return { rows: [] }; } };
  const res = await recordVerifiedIdentity(db, { orgId: ORG, clientId: CLIENT, agent: "DOC-CHECK" });
  assert.equal(res.written, false);
  assert.equal(res.reason, "nothing_verified");
  assert.equal(queries, 0, "a blank result must not touch the database at all");
});

test("recordVerifiedIdentity: a name with no address writes the name and leaves the address alone", async () => {
  const seen = [];
  const db = {
    async query(sql, params) { seen.push({ sql, params }); return { rows: [] }; }
  };
  const res = await recordVerifiedIdentity(db, {
    orgId: ORG, clientId: CLIENT, agent: "DOC-CHECK",
    documentId: "doc-1", versionId: "ver-1",
    legalName: "Christopher J Stanbridge",
    address: null,
    dateOfBirth: "bad date"
  });
  assert.equal(res.written, true);
  assert.deepEqual(res.fields, ["legal_name"]);
  const [, , name, address, dob, agent, , sources] = seen[0].params;
  assert.equal(name, "Christopher J Stanbridge");
  assert.equal(address, null, "an address nobody read must go in as NULL");
  assert.equal(dob, null, "an unparseable date of birth must go in as NULL, not as text");
  assert.equal(agent, "DOC-CHECK");
  const parsed = JSON.parse(sources);
  assert.deepEqual(Object.keys(parsed), ["legal_name"]);
  assert.equal(parsed.legal_name.document_version_id, "ver-1");
  assert.match(seen[0].sql, /COALESCE\(EXCLUDED\.verified_address, pii_identity\.verified_address\)/);
});

test("recordVerifiedIdentity: without ids there is nothing to write against", async () => {
  const res = await recordVerifiedIdentity({ async query() { throw new Error("must not run"); } },
    { clientId: CLIENT });
  assert.equal(res.written, false);
  assert.equal(res.reason, "missing_ids");
});

test("verifiedIdentity: a client with no row reads back as all nulls, never as a fallback", async () => {
  const db = { async query() { return { rows: [] }; } };
  const got = await verifiedIdentity(db, { orgId: ORG, clientId: CLIENT });
  assert.deepEqual(got, { ...EMPTY_IDENTITY, fieldSources: {} });
  assert.equal(got.legalName, null);
  assert.equal(got.address, null);
  assert.equal(got.dateOfBirth, null);
});

test("verifiedIdentity: reads the row back in the shape the letters consume", async () => {
  const db = {
    async query() {
      return {
        rows: [{
          verified_legal_name: "Christopher J Stanbridge",
          verified_address: { line1: "1005 W Hudson Way", city: "Gilbert", state: "AZ", zip: "85233" },
          verified_dob: new Date(1985, 3, 2),
          verified_by: "DOC-CHECK",
          verified_at: new Date("2026-09-04T12:00:00.000Z"),
          verified_field_sources: { legal_name: { document_id: "doc-1" } }
        }]
      };
    }
  };
  const got = await verifiedIdentity(db, { orgId: ORG, clientId: CLIENT });
  assert.equal(got.legalName, "Christopher J Stanbridge");
  assert.equal(got.dateOfBirth, "1985-04-02", "a date must not slide a day across the timezone");
  assert.equal(got.address.formatted, "1005 W Hudson Way Gilbert, AZ 85233");
  assert.equal(got.source, "DOC-CHECK");
  assert.equal(got.verifiedAt, "2026-09-04T12:00:00.000Z");
  assert.equal(got.fieldSources.legal_name.document_id, "doc-1");
});

test("verifiedIdentity: no client id is not an error, it is three nulls", async () => {
  const got = await verifiedIdentity({ async query() { throw new Error("must not run"); } }, {});
  assert.equal(got.legalName, null);
  assert.equal(got.verifiedAt, null);
});
