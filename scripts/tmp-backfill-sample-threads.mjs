#!/usr/bin/env node
// One-shot P6 backfill: link sample-pack outbound rows into Messaging threads.
// Scope ONLY: org fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6 + email ILIKE
// 'stanbridgejchris+%' + messages.conversation_id IS NULL.
// Does NOT backfill the whole table. No send. No --prod. Never prints secrets.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { upsertConversation, linkMessage } from "../src/conversations/store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m || process.env[m[1]]) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  process.env[m[1]] = v;
}

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const url = process.env.DATABASE_URL || "";
if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.log(JSON.stringify({ ok: false, reason: "missing_DATABASE_URL" }));
  process.exit(1);
}

const db = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 15000,
  statement_timeout: 60000
});

await db.connect();
try {
  const { rows } = await db.query(
    `SELECT m.id AS message_id, m.org_id, m.client_id, m.channel, m.created_at, c.email
       FROM messages m
       JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
      WHERE m.org_id = $1
        AND c.email ILIKE 'stanbridgejchris+%'
        AND m.conversation_id IS NULL
        AND m.direction = 'outbound'
      ORDER BY c.email, m.channel, m.created_at`,
    [ORG]
  );

  let linked = 0;
  let failed = 0;
  const byClient = {};
  for (const row of rows) {
    try {
      const convo = await upsertConversation(db, {
        orgId: row.org_id,
        clientId: row.client_id,
        channel: row.channel,
        lastPulseAt: row.created_at || null
      });
      const result = await linkMessage(db, {
        messageId: row.message_id,
        conversationId: convo.id
      });
      if (result.linked) {
        linked += 1;
        byClient[row.email] = (byClient[row.email] || 0) + 1;
      }
    } catch (err) {
      failed += 1;
      console.error(`[backfill] failed message_id=${row.message_id}: ${err && err.message}`);
    }
  }

  console.log(JSON.stringify({
    ok: failed === 0,
    org: ORG,
    candidates: rows.length,
    linked,
    failed,
    byClient
  }));
  if (failed) process.exit(2);
} finally {
  await db.end();
}
