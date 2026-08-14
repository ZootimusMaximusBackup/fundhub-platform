#!/usr/bin/env node
// One-shot Bland prove call to Chris. Not registered. Do not drain anything.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2];
}

const key = process.env.BLAND_API_KEY;
if (!key) {
  console.log(JSON.stringify({ ok: false, reason: "missing_BLAND_API_KEY" }));
  process.exit(1);
}

const phone = process.argv[2] || "+16616180865";
const res = await fetch("https://api.bland.ai/v1/calls", {
  method: "POST",
  headers: {
    Authorization: key,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    phone_number: phone,
    wait_for_greeting: true,
    max_duration: 1,
    first_sentence: "Hey Chris, this is a short Fundhub prove call.",
    task: "This is a 30-second Fundhub prove call. Greet Chris. Say you are calling from Fundhub to confirm the phone line works. Do not talk about credit scores or money. Then say goodbye and hang up.",
    record: false,
    metadata: { prove: "p2-bland-2026-08-14" },
  }),
});

const text = await res.text();
let body = null;
try {
  body = JSON.parse(text);
} catch {
  body = { raw_len: text.length };
}

const callId = body?.call_id || body?.callId || null;
console.log(JSON.stringify({
  ok: res.ok,
  status: res.status,
  call_id: callId,
  bland_status: body?.status || body?.message || null,
  error: body?.error || body?.errors || null,
}));
if (!res.ok) process.exit(2);
