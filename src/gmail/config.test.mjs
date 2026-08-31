import test from "node:test";
import assert from "node:assert/strict";

import { gmailConfigFromEnv } from "./config.mjs";
import { createGmailClient, plainTextFromMessage } from "./client.mjs";
import { fetchOAuthAccessToken } from "../company-brain/auth.mjs";

function mockFetch(routes) {
  return async (url, init = {}) => {
    const u = String(url);
    const hit = routes.find((r) => r.match(u, init));
    if (!hit) throw new Error(`unexpected fetch: ${u}`);
    const body = typeof hit.body === "function" ? hit.body(u, init) : hit.body;
    const status = hit.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return typeof body === "string" ? body : JSON.stringify(body);
      }
    };
  };
}

test("gmailConfigFromEnv reports missing when no oauth env", () => {
  const c = gmailConfigFromEnv({});
  assert.equal(c.ready, false);
  assert.ok(c.missing.some((m) => m.includes("GOOGLE_GMAIL_OAUTH_TOKEN_PATH")));
});

test("gmailConfigFromEnv reads gmail-specific token JSON", () => {
  const c = gmailConfigFromEnv({
    GOOGLE_GMAIL_OAUTH_TOKEN_JSON: JSON.stringify({
      refresh_token: "rt-gmail",
      client_id: "cid-1",
      client_secret: "sec-1"
    })
  });
  assert.equal(c.ready, true);
  assert.equal(c.authMode, "oauth");
  assert.equal(c.oauthCredentials.refreshToken, "rt-gmail");
  assert.equal(c.tokenSource, "GOOGLE_GMAIL_OAUTH_TOKEN_JSON");
});

test("gmailConfigFromEnv falls back to drive oauth env", () => {
  const c = gmailConfigFromEnv({
    GOOGLE_DRIVE_OAUTH_TOKEN_JSON: JSON.stringify({
      refresh_token: "rt-drive",
      client_id: "cid-2",
      client_secret: "sec-2"
    })
  });
  assert.equal(c.ready, true);
  assert.equal(c.oauthCredentials.refreshToken, "rt-drive");
  assert.equal(c.tokenSource, "GOOGLE_DRIVE_OAUTH_TOKEN_JSON");
});

test("gmailConfigFromEnv prefers gmail env over drive fallback", () => {
  const c = gmailConfigFromEnv({
    GOOGLE_GMAIL_OAUTH_TOKEN_JSON: JSON.stringify({
      refresh_token: "rt-gmail",
      client_id: "cid-1",
      client_secret: "sec-1"
    }),
    GOOGLE_DRIVE_OAUTH_TOKEN_JSON: JSON.stringify({
      refresh_token: "rt-drive",
      client_id: "cid-2",
      client_secret: "sec-2"
    })
  });
  assert.equal(c.oauthCredentials.refreshToken, "rt-gmail");
});

test("createGmailClient lists inbox via mocked fetch", async () => {
  const fetchImpl = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "gmail-tok", expires_in: 3600 }
    },
    {
      match: (u) => u.includes("/gmail/v1/users/me/profile"),
      body: { emailAddress: "owner@example.com", messagesTotal: 42, threadsTotal: 10 }
    },
    {
      match: (u) => u.includes("/gmail/v1/users/me/messages?"),
      body: {
        messages: [{ id: "m1", threadId: "t1" }],
        resultSizeEstimate: 1
      }
    },
    {
      match: (u) => u.includes("/gmail/v1/users/me/messages/m1"),
      body: {
        id: "m1",
        payload: {
          headers: [
            { name: "Subject", value: "Hello" },
            { name: "From", value: "sender@example.com" }
          ]
        }
      }
    }
  ]);

  const client = createGmailClient({
    oauthCredentials: {
      refreshToken: "rt-1",
      clientId: "cid-1",
      clientSecret: "sec-1"
    },
    fetchImpl
  });

  const profile = await client.getProfile();
  assert.equal(profile.emailAddress, "owner@example.com");

  const listed = await client.listMessages({ maxResults: 1 });
  assert.equal(listed.messages.length, 1);

  const msg = await client.getMessage("m1");
  assert.equal(client.headerValue(msg, "Subject"), "Hello");
});

test("listMessages with q does not AND default INBOX labelIds", async () => {
  let listedUrl = "";
  const fetchImpl = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "gmail-tok", expires_in: 3600 }
    },
    {
      match: (u) => u.includes("/gmail/v1/users/me/messages?"),
      body: (u) => {
        listedUrl = u;
        return { messages: [{ id: "m2", threadId: "t2" }], resultSizeEstimate: 1 };
      }
    }
  ]);
  const client = createGmailClient({
    oauthCredentials: {
      refreshToken: "rt-1",
      clientId: "cid-1",
      clientSecret: "sec-1"
    },
    fetchImpl
  });
  await client.listMessages({ maxResults: 5, q: "in:anywhere from:noreply@fundhub.ai" });
  assert.ok(!listedUrl.includes("labelIds="), `unexpected labelIds in ${listedUrl}`);
  assert.ok(listedUrl.includes("q="), "expected q= in list URL");
});

test("listMessages without q still defaults to INBOX", async () => {
  let listedUrl = "";
  const fetchImpl = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "gmail-tok", expires_in: 3600 }
    },
    {
      match: (u) => u.includes("/gmail/v1/users/me/messages?"),
      body: (u) => {
        listedUrl = u;
        return { messages: [], resultSizeEstimate: 0 };
      }
    }
  ]);
  const client = createGmailClient({
    oauthCredentials: {
      refreshToken: "rt-1",
      clientId: "cid-1",
      clientSecret: "sec-1"
    },
    fetchImpl
  });
  await client.listMessages({ maxResults: 3 });
  assert.ok(listedUrl.includes("labelIds=INBOX"), `expected INBOX default in ${listedUrl}`);
});

test("plainTextFromMessage prefers text/plain and keeps newlines", () => {
  const text = "**CLIENT INFO**\nPat Rivera\n202-555-0133\n";
  const message = {
    payload: {
      mimeType: "multipart/alternative",
      parts: [
        {
          mimeType: "text/plain",
          body: { data: Buffer.from(text, "utf8").toString("base64") }
        },
        {
          mimeType: "text/html",
          body: { data: Buffer.from("<p>ignore html</p>", "utf8").toString("base64") }
        }
      ]
    }
  };
  assert.equal(plainTextFromMessage(message), text);
});

test("getOrCreateLabel reuses an existing label then addLabels posts modify", async () => {
  const calls = [];
  const fetchImpl = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "gmail-tok", expires_in: 3600 }
    },
    {
      match: (u) => u.includes("/gmail/v1/users/me/labels") && !u.includes("/modify"),
      body: (u, init) => {
        calls.push({ u, method: init.method || "GET" });
        if (String(init.method || "GET") === "GET") {
          return { labels: [{ id: "lbl1", name: "fundhub-blake-lead" }] };
        }
        return { id: "lbl-new", name: "other" };
      }
    },
    {
      match: (u) => u.includes("/messages/m1/modify"),
      body: (u, init) => {
        calls.push({ u, method: init.method || "GET", body: init.body });
        return { id: "m1" };
      }
    }
  ]);
  const client = createGmailClient({
    oauthCredentials: {
      refreshToken: "rt-1",
      clientId: "cid-1",
      clientSecret: "sec-1"
    },
    fetchImpl
  });
  const id = await client.getOrCreateLabel("fundhub-blake-lead");
  assert.equal(id, "lbl1");
  await client.addLabels("m1", [id]);
  assert.ok(calls.some((c) => String(c.u).includes("/messages/m1/modify")));
});

test("fetchOAuthAccessToken still works for gmail refresh", async () => {
  const fetchImpl = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "tok", expires_in: 3600 }
    }
  ]);
  const tok = await fetchOAuthAccessToken({
    refreshToken: "rt-1",
    clientId: "cid-1",
    clientSecret: "sec-1",
    fetchImpl
  });
  assert.equal(tok.accessToken, "tok");
});
