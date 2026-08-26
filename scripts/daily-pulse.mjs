#!/usr/bin/env node
// Daily pulse CLI. Default is dry-run: writes the board, does not send, does not fix.
//
//   node scripts/daily-pulse.mjs
//   node scripts/daily-pulse.mjs --dry-run
//
// --live sends the Chris SMS and (only if DARWIN_WHATSAPP is set) Darwin WhatsApp.
// Do not pass --live for prove. Do not point verify:e2e at the live database.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isPidAlive,
  readHeartbeat,
  relayDirs
} from "./gate-relay/index.mjs";
import {
  defaultBoardDir,
  REPO_ROOT,
  runDailyPulse
} from "../src/pulse/daily-pulse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  return {
    dryRun: !argv.includes("--live"),
    startRelay: argv.includes("--start-relay")
  };
}

function startExistingRelay() {
  const child = spawn(process.execPath, [path.join(HERE, "gate-relay/index.mjs"), "watch"], {
    detached: true,
    stdio: "ignore",
    cwd: REPO_ROOT
  });
  child.unref();
  return child.pid;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const { dryRun, startRelay } = parseArgs(argv);
  const dirs = deps.dirs || relayDirs();
  const hb = readHeartbeat(dirs);
  const alive = hb && hb.pid != null && isPidAlive(hb.pid);
  let relay = { running: Boolean(alive), started: false, pid: hb && hb.pid };
  if (!alive && startRelay) {
    // Turn the existing messenger on. Do not build a second tripwire.
    const pid = (deps.startRelay || startExistingRelay)();
    relay = { running: false, started: true, pid };
  }

  const result = await runDailyPulse({
    dryRun,
    env: deps.env || process.env,
    fetchImpl: deps.fetchImpl || globalThis.fetch,
    boardDir: deps.boardDir || defaultBoardDir(deps.env || process.env),
    db: deps.db || null,
    gateRelayDirs: dirs,
    sendSms: deps.sendSms,
    sendWhatsApp: deps.sendWhatsApp,
    recordRun: !dryRun
  });

  process.stdout.write(JSON.stringify({
    dryRun: result.dryRun,
    autoFix: result.autoFix,
    date: result.date,
    wrote: result.wrote,
    findings: result.findings,
    suggestedFixes: result.suggestedFixes,
    sms: { sent: result.sms.sent, reason: result.sms.reason },
    darwin: { sent: result.darwin.sent, reason: result.darwin.reason },
    relay
  }, null, 2) + "\n");
  return { ...result, relay };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    process.stderr.write(String((err && err.message) || err) + "\n");
    process.exitCode = 1;
  });
}
