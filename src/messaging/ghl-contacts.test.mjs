import { test } from "node:test";
import assert from "node:assert";
import { config, findOrCreateGhlContact } from "./ghl-contacts.mjs";

test("config: missing keys → not ok", () => {
  const c = config({});
  assert.equal(c.ok, false);
  assert.ok(c.missing.includes("GHL_API_KEY"));
});

test("config: GHL_API_KEY preferred", () => {
  const c = config({ GHL_API_KEY: "a", GHL_RELAY_API_KEY: "b" });
  assert.equal(c.ok, true);
  assert.equal(c.apiKey, "a");
});

test("config: falls back to GHL_RELAY_API_KEY", () => {
  const c = config({ GHL_RELAY_API_KEY: "relay" });
  assert.equal(c.ok, true);
  assert.equal(c.apiKey, "relay");
});

test("findOrCreate: not_configured without key", async () => {
  const r = await findOrCreateGhlContact({ email: "a@b.com" }, { env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_configured");
});

test("findOrCreate: no email", async () => {
  const r = await findOrCreateGhlContact({}, { env: { GHL_API_KEY: "k" } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_identifier");
});

test("findOrCreate: upsert success", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ contact: { id: "ghl-99" }, new: true }),
    text: async () => ""
  });
  // postJson uses fetchImpl differently — stub via wrapping post path:
  // Use a custom fetch that returns Response-like for postJson's usage.
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      status: 200,
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ contact: { id: "ghl-99" }, new: true }),
      text: async () => JSON.stringify({ contact: { id: "ghl-99" }, new: true })
    };
  };
  const r = await findOrCreateGhlContact(
    { email: "pat@example.com", firstName: "Pat" },
    { env: { GHL_API_KEY: "k" }, fetchImpl: fakeFetch }
  );
  assert.equal(r.ok, true);
  assert.equal(r.contactId, "ghl-99");
  assert.ok(calls.length >= 1);
});
