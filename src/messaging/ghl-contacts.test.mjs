// Adversarial tests for GHL contact resolution. NO NETWORK IS TOUCHED — every
// case injects `fetchImpl`, the same seam src/messaging/providers/*.test.mjs
// uses, so nothing here needs a live LeadConnector account to be trustworthy.

import { test } from "node:test";
import assert from "node:assert";
import { config, findOrCreateGhlContact, ensureGhlContactId } from "./ghl-contacts.mjs";

/** A fetch stand-in, same shape as src/messaging/providers/providers.test.mjs's
 *  fakeFetch: records every call and returns queued responses in order (or a
 *  single response for every call, if only one was given). */
function fakeFetch(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (typeof next === "function") return next(url, init);
    const { status = 200, body = {} } = next || {};
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  impl.calls = calls;
  return impl;
}

/** A minimal db fake for ensureGhlContactId — records every UPDATE. */
function dbFake() {
  const updates = [];
  return {
    updates,
    async query(sql, params) {
      if (/UPDATE clients SET ghl_contact_id/.test(sql)) {
        updates.push({ contactId: params[0], clientId: params[1] });
      }
      return { rows: [] };
    }
  };
}

// --- config() ----------------------------------------------------------

test("config: missing keys → not ok, names both env vars", () => {
  const c = config({});
  assert.equal(c.ok, false);
  assert.deepEqual(c.missing, ["GHL_API_KEY", "GHL_RELAY_API_KEY"]);
});

test("config: GHL_API_KEY is preferred over GHL_RELAY_API_KEY", () => {
  const c = config({ GHL_API_KEY: "a", GHL_RELAY_API_KEY: "b" });
  assert.equal(c.ok, true);
  assert.equal(c.apiKey, "a");
});

test("config: falls back to GHL_RELAY_API_KEY when GHL_API_KEY is unset", () => {
  const c = config({ GHL_RELAY_API_KEY: "relay" });
  assert.equal(c.ok, true);
  assert.equal(c.apiKey, "relay");
});

test("config: base URL and version default, and both env spellings override", () => {
  const d = config({ GHL_API_KEY: "k" });
  assert.equal(d.baseUrl, "https://services.leadconnectorhq.com");
  assert.equal(d.version, "2021-07-28");

  const viaGhl = config({ GHL_API_KEY: "k", GHL_BASE_URL: "https://a.example/", GHL_VERSION: "v2" });
  assert.equal(viaGhl.baseUrl, "https://a.example"); // trailing slash stripped
  assert.equal(viaGhl.version, "v2");

  const viaRelay = config({ GHL_API_KEY: "k", GHL_RELAY_BASE_URL: "https://b.example", GHL_RELAY_VERSION: "v3" });
  assert.equal(viaRelay.baseUrl, "https://b.example");
  assert.equal(viaRelay.version, "v3");
});

// --- findOrCreateGhlContact() --------------------------------------------

test("findOrCreate: not_configured without any key — never throws", async () => {
  const r = await findOrCreateGhlContact({ email: "a@b.com" }, { env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_configured");
});

test("findOrCreate: no_identifier when neither email nor phone is given", async () => {
  const r = await findOrCreateGhlContact({}, { env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k" } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_identifier");
});

test("findOrCreate: upsert success returns the contact id and created flag", async () => {
  const fetchImpl = fakeFetch({ status: 200, body: { contact: { id: "ghl-99", new: true } } });
  const r = await findOrCreateGhlContact(
    { email: "Pat@Example.com", firstName: "Pat" },
    { env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k" }, fetchImpl }
  );
  assert.equal(r.ok, true);
  assert.equal(r.contactId, "ghl-99");
  assert.equal(r.created, true);
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0].url, /\/contacts\/upsert$/);
  const sent = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sent.email, "pat@example.com", "email is lowercased/trimmed before sending");
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, "Bearer k");
  assert.equal(fetchImpl.calls[0].init.headers.Version, "2021-07-28");
});

test("findOrCreate: phone-only contact (no email) still resolves", async () => {
  const fetchImpl = fakeFetch({ status: 200, body: { id: "ghl-phone-1" } });
  const r = await findOrCreateGhlContact({ phone: "+15551234567" }, { env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k" }, fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.contactId, "ghl-phone-1");
});

test("findOrCreate: a non-2xx, non-404/405 upsert response is reported, not guessed at", async () => {
  const fetchImpl = fakeFetch({ status: 500, body: { message: "boom" } });
  const r = await findOrCreateGhlContact({ email: "a@b.com" }, { env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k" }, fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "upsert_http_500");
});

test("findOrCreate: an upsert response with no contact id is reported, not invented", async () => {
  const fetchImpl = fakeFetch({ status: 200, body: { ok: true } });
  const r = await findOrCreateGhlContact({ email: "a@b.com" }, { env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k" }, fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_contact_id_in_response");
});

test("findOrCreate: upsert 404 falls back to search — finds an existing contact by email", async () => {
  const fetchImpl = fakeFetch([
    { status: 404, body: {} }, // POST /contacts/upsert unavailable
    { status: 200, body: { contacts: [{ id: "ghl-found" }] } } // GET /contacts/?email=...
  ]);
  const r = await findOrCreateGhlContact({ email: "existing@b.com" }, { env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k" }, fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.contactId, "ghl-found");
  assert.equal(r.created, false);
  assert.equal(fetchImpl.calls.length, 2);
  assert.match(fetchImpl.calls[1].url, /\/contacts\/\?email=/);
});

test("findOrCreate: upsert 405 falls back to search-then-create when search finds nothing", async () => {
  const fetchImpl = fakeFetch([
    { status: 405, body: {} },                     // upsert unavailable
    { status: 200, body: { contacts: [] } },        // search: no match
    { status: 200, body: { contact: { id: "ghl-created" } } } // create
  ]);
  const r = await findOrCreateGhlContact({ email: "new@b.com", lastName: "Doe" }, { env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k" }, fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.contactId, "ghl-created");
  assert.equal(r.created, true);
  assert.equal(fetchImpl.calls.length, 3);
});

test("findOrCreate: a transport failure (fetch throws) is reported, never thrown", async () => {
  const fetchImpl = async () => { throw new Error("ECONNRESET"); };
  const r = await findOrCreateGhlContact({ email: "a@b.com" }, { env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k" }, fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.reason, /^request_failed:/);
});

test("findOrCreate: GHL_LOCATION_ID is sent when the env carries one", async () => {
  const fetchImpl = fakeFetch({ status: 200, body: { id: "ghl-loc" } });
  await findOrCreateGhlContact(
    { email: "a@b.com" },
    { env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k", GHL_LOCATION_ID: "loc-123" }, fetchImpl }
  );
  const sent = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sent.locationId, "loc-123");
});

// --- ensureGhlContactId() ------------------------------------------------

test("ensureGhlContactId: writes clients.ghl_contact_id by default", async () => {
  const db = dbFake();
  const fetchImpl = fakeFetch({ status: 200, body: { id: "ghl-write-1" } });
  const r = await ensureGhlContactId(
    db,
    { id: "cl-1", email: "a@b.com", phone: null, first_name: "A", last_name: "B" },
    { fetchImpl, env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k" } }
  );
  assert.equal(r.ok, true);
  assert.equal(r.contactId, "ghl-write-1");
  assert.equal(r.updated, true);
  assert.deepEqual(db.updates, [{ contactId: "ghl-write-1", clientId: "cl-1" }]);
});

test("ensureGhlContactId: dryRun finds/creates but never writes — this is the backfill script's default", async () => {
  const db = dbFake();
  const fetchImpl = fakeFetch({ status: 200, body: { id: "ghl-dry-1" } });
  const r = await ensureGhlContactId(
    db,
    { id: "cl-2", email: "dry@b.com" },
    { fetchImpl, env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k" }, dryRun: true }
  );
  assert.equal(r.ok, true);
  assert.equal(r.contactId, "ghl-dry-1");
  assert.equal(r.updated, false);
  assert.deepEqual(db.updates, [], "dryRun must not touch the database");
});

test("ensureGhlContactId: no email/phone on the row — no_identifier, no GHL call", async () => {
  const db = dbFake();
  const fetchImpl = fakeFetch({ status: 200, body: { id: "should-not-be-called" } });
  const r = await ensureGhlContactId(db, { id: "cl-3" }, { fetchImpl, env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k" } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_identifier");
  assert.equal(fetchImpl.calls.length, 0);
});

test("ensureGhlContactId: never throws, even if the db write itself fails", async () => {
  const fetchImpl = fakeFetch({ status: 200, body: { id: "ghl-x" } });
  const throwingDb = { query: async () => { throw new Error("db is down"); } };
  const r = await ensureGhlContactId(
    throwingDb,
    { id: "cl-4", email: "a@b.com" },
    { fetchImpl, env: { ADAPTERS_DRY_RUN: "0", GHL_API_KEY: "k" } }
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /^unexpected_error:/);
});

test("ensureGhlContactId: propagates not_configured without ever calling the db", async () => {
  const db = dbFake();
  const r = await ensureGhlContactId(db, { id: "cl-5", email: "a@b.com" }, { env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_configured");
  assert.deepEqual(db.updates, []);
});
