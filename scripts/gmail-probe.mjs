#!/usr/bin/env node
// Live probe: personal Gmail inbox via FundHub OAuth path.
// Usage: node scripts/gmail-probe.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gmailConfigFromEnv, createGmailClientFromConfig } from "../src/gmail/index.mjs";

function loadEnv() {
  const p = join(dirname(fileURLToPath(import.meta.url)), "../.env");
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}

loadEnv();

const config = gmailConfigFromEnv(process.env);
if (!config.ready) {
  console.log(JSON.stringify({
    ok: false,
    reason: "not_configured",
    missing: config.missing,
    tokenSource: config.tokenSource
  }, null, 2));
  process.exit(1);
}

try {
  const client = createGmailClientFromConfig(config);
  const profile = await client.getProfile();
  const listed = await client.listMessages({ maxResults: 3 });
  const sample = [];
  for (const row of listed.messages.slice(0, 1)) {
    const msg = await client.getMessage(row.id);
    sample.push({
      id: row.id,
      subject: client.headerValue(msg, "Subject"),
      from: client.headerValue(msg, "From"),
      date: client.headerValue(msg, "Date")
    });
  }

  const email = profile.emailAddress || "";
  const maskedEmail = email.includes("@")
    ? `${email[0]}…@${email.split("@")[1]}`
    : "(unknown)";

  console.log(JSON.stringify({
    ok: true,
    authMode: config.authMode,
    tokenSource: config.tokenSource,
    email: maskedEmail,
    messagesTotal: profile.messagesTotal ?? null,
    inboxListed: listed.messages.length,
    resultSizeEstimate: listed.resultSizeEstimate,
    sample
  }, null, 2));
} catch (err) {
  console.log(JSON.stringify({
    ok: false,
    reason: "gmail_api_error",
    tokenSource: config.tokenSource,
    error: err.message
  }, null, 2));
  process.exit(1);
}
