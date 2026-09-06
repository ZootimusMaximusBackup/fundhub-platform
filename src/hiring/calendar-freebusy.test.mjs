import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  CALENDAR_READONLY_SCOPE,
  calendarConfigFromEnv,
  createFreeBusyCache,
  queryFreeBusy,
  hostCalendarClear
} from "./calendar-freebusy.mjs";
import { buildServiceAccountJwt } from "../company-brain/auth.mjs";

const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

const SA = {
  client_email: "hiring-cal@test.iam.gserviceaccount.com",
  private_key: privateKey,
  project_id: "p"
};

const TEST_ENV = {
  GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify(SA)
};

const HOST = "sarah@fundhub.test";
const START = new Date("2026-10-15T14:00:00.000Z");

function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    const hit = routes.find((r) => r.match(u, init));
    if (!hit) throw new Error(`unexpected fetch: ${u}`);
    const body = typeof hit.body === "function" ? hit.body(u, init) : hit.body;
    const status = hit.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { forEach() {} },
      async text() {
        if (Buffer.isBuffer(body)) return body.toString("utf8");
        return typeof body === "string" ? body : JSON.stringify(body);
      }
    };
  };
  return { fetchImpl, calls };
}

test("calendarConfigFromEnv requires service account JSON", () => {
  const missing = calendarConfigFromEnv({});
  assert.equal(missing.ready, false);
  const oauth = calendarConfigFromEnv({
    GOOGLE_DRIVE_OAUTH_TOKEN_JSON: JSON.stringify({
      refresh_token: "r", client_id: "c", client_secret: "s"
    })
  });
  assert.equal(oauth.ready, false);
  const ready = calendarConfigFromEnv(TEST_ENV);
  assert.equal(ready.ready, true);
});

test("buildServiceAccountJwt accepts calendar.readonly scope", () => {
  const jwt = buildServiceAccountJwt({
    clientEmail: SA.client_email,
    privateKey: SA.private_key,
    delegateEmail: HOST,
    scope: CALENDAR_READONLY_SCOPE,
    nowSec: 1_700_000_000
  });
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.scope, CALENDAR_READONLY_SCOPE);
  assert.equal(payload.sub, HOST);
});

test("hostCalendarClear is clear when freeBusy returns no busy blocks", async () => {
  const { fetchImpl } = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "tok", expires_in: 3600 }
    },
    {
      match: (u) => u.includes("calendar/v3/freeBusy"),
      body: { calendars: { [HOST]: { busy: [] } } }
    }
  ]);
  const out = await hostCalendarClear({
    hostEmail: HOST,
    startsAt: START,
    durationMin: 60,
    env: TEST_ENV,
    fetchImpl
  });
  assert.equal(out.clear, true);
  assert.equal(out.unreadable, false);
});

test("hostCalendarClear fails closed when freeBusy is busy", async () => {
  const { fetchImpl } = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "tok", expires_in: 3600 }
    },
    {
      match: (u) => u.includes("calendar/v3/freeBusy"),
      body: {
        calendars: {
          [HOST]: {
            busy: [{ start: "2026-10-15T14:00:00Z", end: "2026-10-15T15:00:00Z" }]
          }
        }
      }
    }
  ]);
  const out = await hostCalendarClear({
    hostEmail: HOST,
    startsAt: START,
    durationMin: 60,
    env: TEST_ENV,
    fetchImpl
  });
  assert.equal(out.clear, false);
  assert.equal(out.unreadable, false);
  assert.equal(out.busy.length, 1);
});

test("hostCalendarClear fails closed when calendar is not configured", async () => {
  const out = await hostCalendarClear({
    hostEmail: HOST,
    startsAt: START,
    durationMin: 60,
    env: {}
  });
  assert.equal(out.clear, false);
  assert.equal(out.unreadable, true);
  assert.match(out.reason, /not_configured/);
});

test("queryFreeBusy caches within one request", async () => {
  let freeBusyHits = 0;
  const { fetchImpl } = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "tok", expires_in: 3600 }
    },
    {
      match: (u) => u.includes("calendar/v3/freeBusy"),
      body: () => {
        freeBusyHits += 1;
        return { calendars: { [HOST]: { busy: [] } } };
      }
    }
  ]);
  const cache = createFreeBusyCache();
  const window = {
    emails: [HOST],
    timeMin: START.toISOString(),
    timeMax: new Date(START.getTime() + 3600_000).toISOString(),
    env: TEST_ENV,
    fetchImpl,
    cache
  };
  await queryFreeBusy(window);
  await queryFreeBusy(window);
  assert.equal(freeBusyHits, 1);
});

test("freeBusy POST goes through transmit INTERNAL fence", async () => {
  const { fetchImpl, calls } = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "tok", expires_in: 3600 }
    },
    {
      match: (u) => u.includes("calendar/v3/freeBusy"),
      body: { calendars: { [HOST]: { busy: [] } } }
    }
  ]);
  await queryFreeBusy({
    emails: [HOST],
    timeMin: START.toISOString(),
    timeMax: new Date(START.getTime() + 3600_000).toISOString(),
    env: TEST_ENV,
    fetchImpl
  });
  const fb = calls.find((c) => c.url.includes("calendar/v3/freeBusy"));
  assert.ok(fb);
  assert.equal(fb.init.method, "POST");
});
