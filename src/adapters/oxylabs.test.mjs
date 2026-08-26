import { test } from "node:test";
import assert from "node:assert/strict";
import {
  oxylabsConfigFromEnv,
  stripCustomerPrefix,
  normalizeCity,
  normalizeState,
  buildProxyUsername,
  citiesMatch,
  statesMatch,
  parseLocationPayload,
  generateSessid,
  launchCredentials,
  isOxylabsAuthFailure,
  OXYLABS_HOST,
  OXYLABS_PORT
} from "./oxylabs.mjs";

test("oxylabsConfigFromEnv reports missing credentials without throwing", () => {
  const bare = oxylabsConfigFromEnv({});
  assert.equal(bare.ready, false);
  assert.deepEqual(bare.missing, ["OXYLABS_USERNAME", "OXYLABS_PASSWORD"]);
  assert.equal(bare.host, OXYLABS_HOST);
  assert.equal(bare.port, OXYLABS_PORT);

  const ready = oxylabsConfigFromEnv({
    OXYLABS_USERNAME: "acct",
    OXYLABS_PASSWORD: "secret"
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missing, []);
});

test("normalizeCity lowercases and turns spaces into underscores", () => {
  assert.equal(normalizeCity("Los Angeles"), "los_angeles");
  assert.equal(normalizeCity("Fort Lauderdale"), "fort_lauderdale");
  assert.equal(normalizeCity("Mesa"), "mesa");
  assert.equal(normalizeCity("  St. Petersburg "), "st_petersburg");
  assert.equal(normalizeCity(""), null);
  assert.equal(normalizeCity(null), null);
});

test("normalizeState maps abbreviations and full names to us_*", () => {
  assert.equal(normalizeState("AZ"), "us_arizona");
  assert.equal(normalizeState("Arizona"), "us_arizona");
  assert.equal(normalizeState("us_california"), "us_california");
  assert.equal(normalizeState("ca"), "us_california");
  assert.equal(normalizeState(""), null);
});

test("buildProxyUsername encodes city targeting and sessid", () => {
  const u = buildProxyUsername({
    username: "myuser",
    city: "Los Angeles",
    sessid: "abc123",
    sesstime: 30,
    level: "city"
  });
  assert.equal(u, "customer-myuser-cc-US-city-los_angeles-sessid-abc123-sesstime-30");
});

test("stripCustomerPrefix and buildProxyUsername do not double-prefix", () => {
  assert.equal(stripCustomerPrefix("customer-myuser"), "myuser");
  assert.equal(stripCustomerPrefix("myuser"), "myuser");
  const u = buildProxyUsername({
    username: "customer-myuser",
    city: "Mesa",
    sessid: "abc123",
    sesstime: 30,
    level: "city"
  });
  assert.equal(u, "customer-myuser-cc-US-city-mesa-sessid-abc123-sesstime-30");
});

test("buildProxyUsername encodes state targeting", () => {
  const u = buildProxyUsername({
    username: "myuser",
    state: "AZ",
    sessid: "xyz9",
    sesstime: 15,
    level: "state"
  });
  assert.equal(u, "customer-myuser-cc-US-st-us_arizona-sessid-xyz9-sesstime-15");
});

test("buildProxyUsername rejects missing pieces", () => {
  assert.throws(() => buildProxyUsername({ username: "", city: "mesa", sessid: "a" }), /username/);
  assert.throws(() => buildProxyUsername({ username: "u", city: "mesa", sessid: "" }), /sessid/);
  assert.throws(() => buildProxyUsername({ username: "u", sessid: "a", level: "city" }), /city/);
  assert.throws(() => buildProxyUsername({ username: "u", sessid: "a", level: "state" }), /state/);
});

test("citiesMatch and statesMatch compare normalized geo", () => {
  assert.equal(citiesMatch("Mesa", "mesa"), true);
  assert.equal(citiesMatch("Los Angeles", "Los Angeles"), true);
  assert.equal(citiesMatch("Mesa", "Phoenix"), false);
  assert.equal(statesMatch("AZ", "Arizona"), true);
  assert.equal(statesMatch("AZ", "AZ"), true);
  assert.equal(statesMatch("AZ", "California"), false);
});

test("parseLocationPayload reads Oxylabs JSON and plain IP", () => {
  const j = parseLocationPayload({
    json: { ip: "1.2.3.4", city: "Mesa", region: "Arizona", country: "US" }
  });
  assert.equal(j.exitIp, "1.2.3.4");
  assert.equal(j.city, "Mesa");
  assert.equal(j.region, "Arizona");

  const plain = parseLocationPayload({ body: "8.8.8.8", json: null });
  assert.equal(plain.exitIp, "8.8.8.8");
});

test("parseLocationPayload reads city from providers.* (current Oxylabs shape)", () => {
  const j = parseLocationPayload({
    json: {
      ip: "203.0.113.9",
      providers: {
        dbip: { country: "US", city: "Waco" },
        ip2location: { country: "US", city: "Austin" },
        ipinfo: { country: "US", city: "" },
        maxmind: { country: "US", city: "Austin" }
      }
    }
  });
  assert.equal(j.exitIp, "203.0.113.9");
  assert.equal(j.city, "Austin");
  assert.equal(j.country, "US");
  assert.ok(j.cities.includes("Austin"));
});

test("generateSessid is alphanumeric hex", () => {
  const s = generateSessid();
  assert.match(s, /^[a-f0-9]{16}$/);
});

test("launchCredentials fails closed when env credentials are unset", async () => {
  const out = await launchCredentials({
    city: "Mesa",
    state: "AZ",
    env: {},
    fetchFn: async () => { throw new Error("should not call"); }
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "oxylabs_credentials_missing");
  // launchProxySession stores `message || error` on the audit row and throws
  // `message || "Proxy launch failed"`. Without a message the row's error_message
  // just repeats error_code and the advisor is told nothing useful.
  assert.match(out.message, /OXYLABS_USERNAME/);
  assert.match(out.message, /OXYLABS_PASSWORD/);
  assert.deepEqual(out.missing, ["OXYLABS_USERNAME", "OXYLABS_PASSWORD"]);
});

test("launchCredentials succeeds on city match", async () => {
  const out = await launchCredentials({
    city: "Mesa",
    state: "AZ",
    sessid: "sess1",
    env: { OXYLABS_USERNAME: "u", OXYLABS_PASSWORD: "p" },
    fetchFn: async () => ({
      status: 200,
      body: "{}",
      json: { ip: "203.0.113.9", city: "Mesa", region: "Arizona", country: "US" }
    })
  });
  assert.equal(out.ok, true);
  assert.equal(out.targeting_level, "city");
  assert.equal(out.exit_ip, "203.0.113.9");
  assert.equal(out.granted_city, "Mesa");
  assert.match(out.proxy_username, /city-mesa/);
  assert.match(out.proxy_username, /sessid-sess1/);
});

test("launchCredentials falls back to state when city mismatches", async () => {
  let n = 0;
  const out = await launchCredentials({
    city: "Mesa",
    state: "AZ",
    sessid: "sess2",
    env: { OXYLABS_USERNAME: "u", OXYLABS_PASSWORD: "p" },
    fetchFn: async (_url, opts) => {
      n += 1;
      if (String(opts.proxyUsername).includes("city-mesa")) {
        return {
          status: 200,
          body: "{}",
          json: { ip: "203.0.113.1", city: "Phoenix", region: "Arizona", country: "US" }
        };
      }
      return {
        status: 200,
        body: "{}",
        json: { ip: "203.0.113.2", city: "Tucson", region: "Arizona", country: "US" }
      };
    }
  });
  assert.equal(out.ok, true);
  assert.equal(out.targeting_level, "state");
  assert.equal(out.exit_ip, "203.0.113.2");
  assert.match(out.proxy_username, /st-us_arizona/);
  assert.equal(n, 2);
});

test("launchCredentials matches city when only providers.* have it", async () => {
  const out = await launchCredentials({
    city: "Austin",
    state: "TX",
    sessid: "sess4",
    env: { OXYLABS_USERNAME: "u", OXYLABS_PASSWORD: "p" },
    fetchFn: async () => ({
      status: 200,
      body: "{}",
      json: {
        ip: "203.0.113.9",
        providers: {
          dbip: { country: "US", city: "Waco" },
          ip2location: { country: "US", city: "Austin" },
          maxmind: { country: "US", city: "Austin" }
        }
      }
    })
  });
  assert.equal(out.ok, true);
  assert.equal(out.targeting_level, "city");
  assert.equal(out.granted_city, "Austin");
  assert.equal(out.exit_ip, "203.0.113.9");
});

test("launchCredentials reports auth failed instead of geo miss on 407", async () => {
  assert.equal(isOxylabsAuthFailure("oxylabs_connect_failed:407"), true);
  const out = await launchCredentials({
    city: "Austin",
    state: "TX",
    sessid: "sess5",
    env: { OXYLABS_USERNAME: "u", OXYLABS_PASSWORD: "p" },
    fetchFn: async () => {
      throw new Error("oxylabs_connect_failed:407");
    }
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "oxylabs_auth_failed");
  assert.equal(out.attempts.length, 1);
});

test("launchCredentials refuses silent wrong geo when both levels fail", async () => {
  const out = await launchCredentials({
    city: "Mesa",
    state: "AZ",
    sessid: "sess3",
    env: { OXYLABS_USERNAME: "u", OXYLABS_PASSWORD: "p" },
    fetchFn: async () => ({
      status: 200,
      body: "{}",
      json: { ip: "203.0.113.3", city: "Denver", region: "Colorado", country: "US" }
    })
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "geo_unavailable");
  assert.ok(out.attempts.length >= 1);
});
