import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  PULSE_CRON,
  PULSE_TZ,
  checkGateRelay,
  formatScorecard,
  runDailyPulse,
  writeScorecard
} from "./daily-pulse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function fakeFetch(routes) {
  return async (url) => {
    const pathOnly = String(url).replace(/^https?:\/\/[^/]+/, "");
    const hit = routes[pathOnly] || routes[url];
    if (hit) {
      return {
        status: hit.status,
        text: async () => hit.text || ""
      };
    }
    if (pathOnly.startsWith("/api/")) return { status: 401, text: async () => "auth" };
    if (pathOnly.endsWith(".html")) return { status: 200, text: async () => "<html>" };
    return { status: 404, text: async () => "missing" };
  };
}

const LIVE_PAGES = {
  "/api/health?strict=1": { status: 200, text: '{"ok":true}' },
  "/login.html": { status: 200, text: "<form>Sign in <input type=password></form>" },
  "/app/client-control-panel.html": {
    status: 200,
    text: "Funding · Apply Generate Apps Apply door"
  },
  "/api/read/underwrite": { status: 401, text: '{"error":"unauthorized"}' }
};

test("cron is 7:00 a.m. Denver during daylight time", () => {
  assert.equal(PULSE_CRON, "0 13 * * *");
  assert.equal(PULSE_TZ, "America/Denver");
});

test("dry-run writes a board and does not send or fix", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-"));
  const sends = [];
  const result = await runDailyPulse({
    dryRun: true,
    now: new Date("2026-08-25T13:00:00Z"),
    fetchImpl: fakeFetch(LIVE_PAGES),
    boardDir: tmp,
    env: {},
    gateRelayDirs: null,
    sendSms: async (msg) => {
      sends.push(msg);
      return { status: "sent" };
    },
    sendWhatsApp: async (msg) => {
      sends.push(msg);
      return { status: "sent" };
    },
    recordRun: false
  });
  assert.equal(result.autoFix, false);
  assert.equal(result.dryRun, true);
  assert.equal(typeof result.wrote, "string");
  assert.ok(fs.existsSync(result.wrote));
  const body = fs.readFileSync(result.wrote, "utf8");
  assert.match(body, /This run does not auto-fix/);
  assert.match(body, /health/);
  assert.match(body, /Uptime/);
  assert.match(body, /\/app\/pipeline\.html/);
  assert.equal(sends.length, 0);
  assert.equal(result.sms.sent, false);
  assert.equal(result.sms.reason, "dry_run");
  assert.match(result.darwin.reason, /DARWIN_WHATSAPP unset/);
  assert.ok(result.checks.every((c) => c.id !== "fix"));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a FAIL writes a suggested fix and still does not auto-fix", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-"));
  const result = await runDailyPulse({
    dryRun: true,
    now: new Date("2026-08-25T13:00:00Z"),
    fetchImpl: fakeFetch({
      ...LIVE_PAGES,
      "/api/health?strict=1": { status: 503, text: '{"ok":false}' }
    }),
    boardDir: tmp,
    env: {},
    gateRelayDirs: null,
    recordRun: false
  });
  assert.equal(result.autoFix, false);
  assert.ok(result.findings.some((f) => /health/.test(f)));
  assert.ok(result.suggestedFixes.some((f) => /health/.test(f)));
  assert.match(fs.readFileSync(result.wrote, "utf8"), /FAIL/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("gate-relay FAIL names the existing start command — not a new watchdog", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relay-"));
  const dirs = {
    root: tmp,
    gates: path.join(tmp, "gates"),
    decisions: path.join(tmp, "decisions"),
    outbox: path.join(tmp, "outbox")
  };
  const row = checkGateRelay({ dirs, nowMs: Date.now() });
  assert.equal(row.status, "FAIL");
  assert.match(row.suggestedFix, /scripts\/gate-relay\/index\.mjs watch/);
  assert.doesNotMatch(row.suggestedFix, /second tripwire|new watchdog/i);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("scorecard writer is a file write, not a product fix", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-"));
  const md = formatScorecard({
    date: "2026-08-25",
    dryRun: true,
    checks: [{ id: "health", status: "PASS", detail: "ok" }],
    sms: { sent: false, reason: "dry_run" },
    darwin: { sent: false, reason: "DARWIN_WHATSAPP unset", ticket: "ticket" }
  });
  const file = writeScorecard(tmp, "2026-08-25", md);
  assert.equal(path.basename(file), "pulse-2026-08-25.md");
  assert.match(fs.readFileSync(file, "utf8"), /does not auto-fix/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("this module does not import the Ops Admin money pulse", () => {
  const src = readFileSync(path.join(HERE, "daily-pulse.mjs"), "utf8");
  assert.doesNotMatch(src, /^import .*from ["'].*ops\/pulse/m);
  assert.doesNotMatch(src, /^import .*ops-pulse/m);
});
