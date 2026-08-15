#!/usr/bin/env node
// One-shot Bland prove call to Chris. Uses the product provider so voicemail
// cannot drift. Not registered. Do not drain anything. Do not --prod.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  placeCall,
  DEFAULT_PROVE_TASK,
  DEFAULT_PROVE_FIRST_SENTENCE,
  DEFAULT_PROVE_VOICEMAIL
} from "../src/messaging/providers/bland-voice.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2];
}

const phone = process.argv[2] || "+16616180865";
const out = await placeCall({
  phone,
  task: DEFAULT_PROVE_TASK,
  firstSentence: DEFAULT_PROVE_FIRST_SENTENCE,
  voicemailMessage: DEFAULT_PROVE_VOICEMAIL,
  kind: "prove",
  maxDuration: 2,
  metadata: { prove: "p2-bland-voicemail-2026-08-15" },
  env: { ...process.env, MESSAGING_DRY_RUN: "0" }
});

console.log(JSON.stringify({
  ok: out.status === "sent",
  status: out.status,
  call_id: out.providerMessageId,
  error: out.error || null,
  voicemail: true
}));
if (out.status !== "sent") process.exit(2);
