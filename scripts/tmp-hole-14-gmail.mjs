#!/usr/bin/env node
// Scratch Gmail search for hole 14 VERIFY. Do not commit.
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
  console.log(JSON.stringify({ ok: false, reason: "not_configured", missing: config.missing }));
  process.exit(1);
}

const client = createGmailClientFromConfig(config);
const q = 'in:anywhere to:stanbridgejchris+sim-course-20260825h@gmail.com subject:"Funding Mastery"';
const listed = await client.listMessages({ maxResults: 20, q });
const rows = [];
for (const row of listed.messages || []) {
  const msg = await client.getMessage(row.id);
  rows.push({
    id: row.id,
    subject: client.headerValue(msg, "Subject"),
    to: client.headerValue(msg, "To"),
    date: client.headerValue(msg, "Date"),
    from: client.headerValue(msg, "From")
  });
}
console.log(JSON.stringify({
  ok: true,
  q,
  count: rows.length,
  resultSizeEstimate: listed.resultSizeEstimate,
  rows
}, null, 2));
