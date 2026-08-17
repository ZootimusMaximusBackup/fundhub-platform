#!/usr/bin/env node
// Auditor follow-up — READ-ONLY, NO LOGIN. Plain GETs on the "anyone" reach
// routes whose method column in affiliate-actual.md is "—" (unknown), so the
// main probe skipped them. No token is sent (login budget for this email is
// spent). Records status + error + top-level body key names only.
import fs from "node:fs";
import path from "node:path";
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const OUT = path.join(process.cwd(), "docs/workflows/e2e-verify-run5-evidence/affiliate/extra-get-probe.json");
const routes = ["/api/health", "/api/climate/config"];
const out = { ranAt: new Date().toISOString(), base: BASE, token: "none (login budget spent)", results: [] };
for (const route of routes) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + route, { headers: { accept: "application/json" }, redirect: "manual" });
    const text = await res.text().catch(() => "");
    let keys = [], error = "";
    try { const j = JSON.parse(text); keys = Object.keys(j || {}); error = j?.error || ""; } catch { keys = ["<non-json>"]; }
    out.results.push({ route, method: "GET", status: res.status, ms: Date.now() - started, error, keys, bytes: text.length });
  } catch (e) {
    out.results.push({ route, method: "GET", status: 0, error: String(e?.message || e).slice(0, 80) });
  }
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
