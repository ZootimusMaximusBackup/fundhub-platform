import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const { gmailConfigFromEnv, createGmailClientFromConfig } = await import("../../src/gmail/index.mjs");
const cfg = gmailConfigFromEnv(process.env);
const g = createGmailClientFromConfig(cfg);
const q = process.argv[2] || "in:anywhere to:stanbridgejchris+sim-wl-e2e27-wlchat@gmail.com";
const r = await g.listMessages({ q, maxResults: 20 });
console.log("QUERY:", q, "-> count", r.messages.length, "est", r.resultSizeEstimate);
for (const m of r.messages) {
  const full = await g.getMessage(m.id);
  console.log(" -", g.headerValue(full, "Date"), "|", g.headerValue(full, "To"), "|", g.headerValue(full, "Subject"));
}
process.exit(0);
