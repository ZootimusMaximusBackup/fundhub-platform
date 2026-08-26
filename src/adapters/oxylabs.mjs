// Oxylabs residential proxy adapter.
//
// Targeting is encoded in the USERNAME string — there is no session-launch API.
// Their Public API is only for sub-user management and usage stats; do not call
// it to open a geo session.
//
// Endpoint: pr.oxylabs.io:7777 (HTTP / HTTPS / SOCKS5)
// Username shape (verified against Oxylabs docs):
//   customer-USERNAME-cc-US-city-CITY-sessid-RANDOM[:sesstime-N]
//   customer-USERNAME-cc-US-st-us_STATE-sessid-RANDOM[:sesstime-N]
// City: lowercase, spaces → underscores. State: us_ + full English name.
// Verify exit IP via https://ip.oxylabs.io/location through the proxy.

import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { URL } from "node:url";

export const OXYLABS_HOST = "pr.oxylabs.io";
export const OXYLABS_PORT = 7777;
export const LOCATION_CHECK_URL = "https://ip.oxylabs.io/location";
export const DEFAULT_SESSTIME_MINUTES = 30;

/** USPS abbreviation → Oxylabs `st` value (us_ + full name, underscores). */
export const US_STATE_TO_OXYLABS = {
  AL: "us_alabama", AK: "us_alaska", AZ: "us_arizona", AR: "us_arkansas",
  CA: "us_california", CO: "us_colorado", CT: "us_connecticut", DE: "us_delaware",
  FL: "us_florida", GA: "us_georgia", HI: "us_hawaii", ID: "us_idaho",
  IL: "us_illinois", IN: "us_indiana", IA: "us_iowa", KS: "us_kansas",
  KY: "us_kentucky", LA: "us_louisiana", ME: "us_maine", MD: "us_maryland",
  MA: "us_massachusetts", MI: "us_michigan", MN: "us_minnesota", MS: "us_mississippi",
  MO: "us_missouri", MT: "us_montana", NE: "us_nebraska", NV: "us_nevada",
  NH: "us_new_hampshire", NJ: "us_new_jersey", NM: "us_new_mexico", NY: "us_new_york",
  NC: "us_north_carolina", ND: "us_north_dakota", OH: "us_ohio", OK: "us_oklahoma",
  OR: "us_oregon", PA: "us_pennsylvania", RI: "us_rhode_island", SC: "us_south_carolina",
  SD: "us_south_dakota", TN: "us_tennessee", TX: "us_texas", UT: "us_utah",
  VT: "us_vermont", VA: "us_virginia", WA: "us_washington", WV: "us_west_virginia",
  WI: "us_wisconsin", WY: "us_wyoming", DC: "us_district_of_columbia"
};

const OXYLABS_STATE_TO_ABBR = Object.fromEntries(
  Object.entries(US_STATE_TO_OXYLABS).map(([abbr, full]) => [full, abbr])
);

/** Env username is the account id only. Strip a pasted `customer-` so we do not double-prefix. */
export function stripCustomerPrefix(username) {
  const s = String(username || "").trim();
  if (!s) return null;
  return s.replace(/^customer-/i, "") || null;
}

export function oxylabsConfigFromEnv(env = process.env) {
  const rawUser = env.OXYLABS_USERNAME;
  const username = stripCustomerPrefix(rawUser);
  const password = env.OXYLABS_PASSWORD ? String(env.OXYLABS_PASSWORD) : null;
  const missing = [];
  if (rawUser == null || rawUser === "") missing.push("OXYLABS_USERNAME");
  if (!password) missing.push("OXYLABS_PASSWORD");
  return {
    host: OXYLABS_HOST,
    port: OXYLABS_PORT,
    username,
    password,
    ready: missing.length === 0,
    missing
  };
}

/** Lowercase English city; spaces → underscores (los_angeles, fort_lauderdale). */
export function normalizeCity(city) {
  if (city == null) return null;
  const s = String(city).trim().toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || null;
}

/** Accept AZ / Arizona / us_arizona → us_arizona. */
export function normalizeState(state) {
  if (state == null) return null;
  const raw = String(state).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/\s+/g, "_");
  if (lower.startsWith("us_")) return lower;
  if (raw.length === 2) {
    return US_STATE_TO_OXYLABS[raw.toUpperCase()] || null;
  }
  const withPrefix = lower.startsWith("us_") ? lower : `us_${lower}`;
  if (OXYLABS_STATE_TO_ABBR[withPrefix]) return withPrefix;
  // "Arizona" already handled; also try stripping "state_of_"
  const stripped = withPrefix.replace(/^us_state_of_/, "us_");
  return OXYLABS_STATE_TO_ABBR[stripped] ? stripped : withPrefix;
}

export function stateAbbrFromOxylabs(st) {
  if (!st) return null;
  const n = normalizeState(st);
  return n ? (OXYLABS_STATE_TO_ABBR[n] || null) : null;
}

export function generateSessid(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Build the Oxylabs proxy username. Level is "city" | "state".
 * Never silently omits targeting — caller must pass city or state for the level.
 */
export function buildProxyUsername({
  username,
  city = null,
  state = null,
  sessid,
  sesstime = DEFAULT_SESSTIME_MINUTES,
  level = "city",
  country = "US"
} = {}) {
  const base = stripCustomerPrefix(username);
  if (!base) throw new Error("oxylabs_username_required");
  const sid = String(sessid || "").trim();
  if (!sid) throw new Error("oxylabs_sessid_required");
  if (!/^[A-Za-z0-9]+$/.test(sid)) throw new Error("oxylabs_sessid_invalid");

  const parts = [`customer-${base}`, `cc-${String(country).toUpperCase()}`];

  if (level === "city") {
    const c = normalizeCity(city);
    if (!c) throw new Error("oxylabs_city_required");
    parts.push(`city-${c}`);
  } else if (level === "state") {
    const st = normalizeState(state);
    if (!st) throw new Error("oxylabs_state_required");
    parts.push(`st-${st}`);
  } else {
    throw new Error("oxylabs_level_invalid");
  }

  parts.push(`sessid-${sid}`);
  const mins = Number(sesstime);
  if (Number.isFinite(mins) && mins > 0) {
    parts.push(`sesstime-${Math.floor(mins)}`);
  }
  return parts.join("-");
}

export function citiesMatch(requested, granted) {
  const a = normalizeCity(requested);
  const b = normalizeCity(granted);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function statesMatch(requested, grantedRegion) {
  const want = normalizeState(requested);
  if (!want) return false;
  const got = normalizeState(grantedRegion);
  if (got && got === want) return true;
  // Location JSON often returns "Arizona" or "AZ"
  const abbr = stateAbbrFromOxylabs(want);
  if (abbr && String(grantedRegion || "").trim().toUpperCase() === abbr) return true;
  const grantedNorm = normalizeCity(grantedRegion); // arizona
  const wantName = want.replace(/^us_/, "");
  return Boolean(grantedNorm && wantName && (grantedNorm === wantName || grantedNorm.includes(wantName)));
}

/**
 * HTTPS GET through an HTTP CONNECT proxy. Injectible for tests.
 * Returns { status, body, json }.
 */
export function fetchThroughProxy(targetUrl, {
  proxyHost = OXYLABS_HOST,
  proxyPort = OXYLABS_PORT,
  proxyUsername,
  proxyPassword,
  timeoutMs = 25000
} = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const auth = Buffer.from(`${proxyUsername}:${proxyPassword}`, "utf8").toString("base64");
    const connectPort = target.port || (target.protocol === "https:" ? 443 : 80);

    const connectReq = http.request({
      host: proxyHost,
      port: proxyPort,
      method: "CONNECT",
      path: `${target.hostname}:${connectPort}`,
      headers: {
        Host: `${target.hostname}:${connectPort}`,
        "Proxy-Authorization": `Basic ${auth}`,
        "Proxy-Connection": "keep-alive"
      },
      timeout: timeoutMs
    });

    const fail = (err) => {
      try { connectReq.destroy(); } catch { /* ignore */ }
      reject(err);
    };

    connectReq.on("timeout", () => fail(new Error("oxylabs_connect_timeout")));
    connectReq.on("error", fail);

    connectReq.on("connect", (res, socket, _head) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`oxylabs_connect_failed:${res.statusCode}`));
        return;
      }

      const lib = target.protocol === "http:" ? http : https;
      const req = lib.request({
        host: target.hostname,
        servername: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        socket,
        agent: false,
        headers: {
          Host: target.hostname,
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "fundhub-oxylabs/1.0"
        },
        timeout: timeoutMs
      }, (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(body); } catch { /* plain text IP */ }
          resolve({ status: resp.statusCode, body, json });
        });
      });
      req.on("timeout", () => {
        req.destroy();
        fail(new Error("oxylabs_request_timeout"));
      });
      req.on("error", fail);
      req.end();
    });

    connectReq.end();
  });
}

function fieldFromGeo(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

function majorityString(values) {
  const counts = new Map();
  for (const raw of values) {
    const s = String(raw || "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    const cur = counts.get(key) || { n: 0, sample: s };
    cur.n += 1;
    counts.set(key, cur);
  }
  let best = null;
  for (const row of counts.values()) {
    if (!best || row.n > best.n) best = row;
  }
  return best ? best.sample : null;
}

export function geoFromProviders(providers) {
  if (!providers || typeof providers !== "object") {
    return { city: null, region: null, country: null, cities: [] };
  }
  const cities = [];
  const regions = [];
  const countries = [];
  for (const p of Object.values(providers)) {
    const city = fieldFromGeo(p, ["city", "city_name"]);
    const region = fieldFromGeo(p, ["region", "regionName", "state", "region_name"]);
    const country = fieldFromGeo(p, ["country", "countryCode", "country_code"]);
    if (city) cities.push(city);
    if (region) regions.push(region);
    if (country) countries.push(country);
  }
  return {
    city: majorityString(cities),
    region: majorityString(regions),
    country: majorityString(countries),
    cities
  };
}

/**
 * Parse ip.oxylabs.io/location body into { exitIp, city, region, country, raw }.
 * Current Oxylabs payload is `{ ip, providers: { dbip, ip2location, ipinfo, maxmind } }`
 * with city/country on each provider — not at the top level.
 */
export function parseLocationPayload(result) {
  const json = result?.json;
  if (json && typeof json === "object") {
    const fromProviders = geoFromProviders(json.providers);
    return {
      exitIp: json.ip || json.query || null,
      city: json.city || json.city_name || fromProviders.city || null,
      region: json.region || json.regionName || json.state || fromProviders.region || null,
      country: json.country || json.countryCode || json.country_code || fromProviders.country || null,
      cities: fromProviders.cities,
      raw: json
    };
  }
  const body = String(result?.body || "").trim();
  // Plain IP fallback
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(body)) {
    return { exitIp: body, city: null, region: null, country: null, cities: [], raw: body };
  }
  return { exitIp: null, city: null, region: null, country: null, cities: [], raw: body || null };
}

export function isOxylabsAuthFailure(reason) {
  return /oxylabs_connect_failed:(401|403|407)\b/.test(String(reason || ""));
}

/**
 * Verify the exit IP for a credential set. Returns verification object.
 * Does not invent a match — caller decides city vs state fallback.
 */
export async function verify({
  proxyUsername,
  proxyPassword,
  fetchFn = fetchThroughProxy,
  env = process.env
} = {}) {
  const cfg = oxylabsConfigFromEnv(env);
  const password = proxyPassword ?? cfg.password;
  if (!proxyUsername) throw new Error("oxylabs_proxy_username_required");
  if (!password) throw new Error("oxylabs_password_required");

  const result = await fetchFn(LOCATION_CHECK_URL, {
    proxyHost: cfg.host,
    proxyPort: cfg.port,
    proxyUsername,
    proxyPassword: password
  });

  if (result.status < 200 || result.status >= 300) {
    const err = new Error(`oxylabs_verify_http_${result.status}`);
    err.status = result.status;
    err.body = result.body;
    throw err;
  }

  const loc = parseLocationPayload(result);
  return {
    ok: Boolean(loc.exitIp),
    exitIp: loc.exitIp,
    city: loc.city,
    region: loc.region,
    country: loc.country,
    cities: loc.cities || [],
    raw: loc.raw
  };
}

/**
 * Build credentials + verify, with city → state fallback.
 * Never returns ok:true for a geo that does not match the achieved level.
 */
export async function launchCredentials({
  city,
  state,
  sessid = generateSessid(),
  sesstime = DEFAULT_SESSTIME_MINUTES,
  env = process.env,
  fetchFn = fetchThroughProxy
} = {}) {
  const cfg = oxylabsConfigFromEnv(env);
  if (!cfg.ready) {
    return {
      ok: false,
      error: "oxylabs_credentials_missing",
      // A `message` is required, not decoration: launchProxySession stores
      // `message || error` on the audit row and throws `message || "Proxy launch
      // failed"`. Without it the row's error_message just repeats error_code and
      // the advisor is told nothing about WHICH credential is absent.
      message: `Oxylabs credentials are not set (${cfg.missing.join(", ")}). See docs/STILL-MISSING.md.`,
      missing: cfg.missing,
      host: cfg.host,
      port: cfg.port
    };
  }

  const requestedCity = normalizeCity(city);
  const requestedState = normalizeState(state);
  if (!requestedCity && !requestedState) {
    return {
      ok: false,
      error: "client_location_missing",
      message: "Client has no city or state on file. Cannot geo-target.",
      host: cfg.host,
      port: cfg.port
    };
  }

  const attempts = [];

  async function tryLevel(level) {
    const proxyUsername = buildProxyUsername({
      username: cfg.username,
      city: requestedCity,
      state: requestedState,
      sessid,
      sesstime,
      level
    });
    try {
      const v = await verify({
        proxyUsername,
        proxyPassword: cfg.password,
        fetchFn,
        env
      });
      const cityHit = [v.city, ...(v.cities || [])].find((c) => citiesMatch(requestedCity, c));
      const cityOk = level === "city" && Boolean(cityHit);
      const stateOk = level === "state" && statesMatch(requestedState, v.region || v.city);
      const matched = level === "city" ? cityOk : stateOk;
      if (cityOk && cityHit) v.city = cityHit;
      const attempt = {
        level,
        proxyUsername,
        verification: v,
        matched,
        reason: matched ? null : (level === "city" ? "city_mismatch" : "state_mismatch")
      };
      attempts.push(attempt);
      return attempt;
    } catch (err) {
      const attempt = {
        level,
        proxyUsername,
        verification: null,
        matched: false,
        reason: err?.message || "verify_failed"
      };
      attempts.push(attempt);
      return attempt;
    }
  }

  let achieved = null;
  if (requestedCity) {
    const cityAttempt = await tryLevel("city");
    if (cityAttempt.matched) achieved = cityAttempt;
    else if (isOxylabsAuthFailure(cityAttempt.reason)) {
      return {
        ok: false,
        error: "oxylabs_auth_failed",
        message: "Oxylabs rejected the proxy login (407). Username is the account id without the customer- prefix. See docs/STILL-MISSING.md.",
        requested_city: requestedCity,
        requested_state: requestedState,
        sessid,
        attempts,
        host: cfg.host,
        port: cfg.port
      };
    }
  }
  if (!achieved && requestedState) {
    const stateAttempt = await tryLevel("state");
    if (stateAttempt.matched) achieved = stateAttempt;
    else if (isOxylabsAuthFailure(stateAttempt.reason)) {
      return {
        ok: false,
        error: "oxylabs_auth_failed",
        message: "Oxylabs rejected the proxy login (407). Username is the account id without the customer- prefix. See docs/STILL-MISSING.md.",
        requested_city: requestedCity,
        requested_state: requestedState,
        sessid,
        attempts,
        host: cfg.host,
        port: cfg.port
      };
    }
  }

  if (!achieved) {
    return {
      ok: false,
      error: "geo_unavailable",
      message: "Could not obtain a residential exit near the client's home. City and state targeting both failed or mismatched.",
      requested_city: requestedCity,
      requested_state: requestedState,
      sessid,
      attempts,
      host: cfg.host,
      port: cfg.port
    };
  }

  const grantedCity = achieved.verification?.city || null;
  return {
    ok: true,
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
    proxy_username: achieved.proxyUsername,
    sessid,
    sesstime,
    targeting_level: achieved.level,
    requested_city: requestedCity,
    requested_state: requestedState,
    granted_city: grantedCity,
    granted_region: achieved.verification?.region || null,
    exit_ip: achieved.verification.exitIp,
    verification: achieved.verification,
    attempts
  };
}
