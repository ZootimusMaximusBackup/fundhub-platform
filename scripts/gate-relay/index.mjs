#!/usr/bin/env node
// Gate relay — thin bridge from a waiting skill to Chris's phone.
//
// Three jobs, nothing more:
//   1. Watch .fundhub-relay/gates/ for a decision the machine needs
//   2. Push a decision-shaped Telegram message
//   3. Take the reply (text or voice), promptify it, write the decision file
//
// Read-only against the repo. Writes decision files only. Never edits app code.
// Messenger, not assistant: no memory, no history, no personality.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createChannel, extractInbound, isAllowedSender } from "./channel.mjs";
import { promptify, transcribe } from "./promptify.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../..");

export const COPY = {
  transcribeFail: "Couldn't hear that. Reply in text?",
  whichOne:
    "I have more than one question open. Reply to the text I sent, or tap the button under it.",
  wentDown: "The messenger went down. I can't text you until it's back.",
  cameBack: "The messenger was down. It's back now."
};

export const REMIND_AFTER_MS = 15 * 60 * 1000;
export const HEARTBEAT_EVERY_MS = 15 * 1000;
export const STALE_MS = 90 * 1000;

export function relayDirs(root = path.join(REPO_ROOT, ".fundhub-relay")) {
  return {
    root,
    gates: path.join(root, "gates"),
    decisions: path.join(root, "decisions"),
    outbox: path.join(root, "outbox")
  };
}

export function ensureDirs(dirs) {
  fs.mkdirSync(dirs.gates, { recursive: true });
  fs.mkdirSync(dirs.decisions, { recursive: true });
  fs.mkdirSync(dirs.outbox, { recursive: true });
  return dirs;
}

export function parseGate(raw) {
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, error: "malformed_json" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "not_object" };
  }
  const question = String(data.question || "").trim();
  if (!question) return { ok: false, error: "missing_question" };
  const options = Array.isArray(data.options)
    ? data.options.map((o) => String(o).trim()).filter(Boolean)
    : [];
  if (!options.length) return { ok: false, error: "missing_options" };
  return {
    ok: true,
    gate: {
      id: data.id != null ? String(data.id) : null,
      question,
      options,
      context: data.context ?? null,
      session: data.session ?? null
    }
  };
}

export function threadLabel(gate) {
  const raw = String((gate && (gate.session || gate.id)) || "").trim();
  if (!raw) return "";
  return raw.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function formatDecisionMessage(gate) {
  const q = String(gate.question || "").trim();
  const context = gate.context != null ? String(gate.context).trim() : "";
  const options = Array.isArray(gate.options) ? gate.options.map(String) : [];
  let body = q;
  if (context && context !== q) {
    if (!q || (q.length <= 20 && context.length > q.length)) body = context;
    else if (context.toUpperCase().includes(q.toUpperCase())) body = context;
    else body = `${context}\n\n${q}`;
  }
  const label = threadLabel(gate);
  if (label && !body.toLowerCase().includes(label.toLowerCase())) {
    body = `This is for ${label}. ${body}`;
  }
  if (!options.length) return body;
  const already = options.every((o) => body.toUpperCase().includes(o.toUpperCase()));
  if (already) return body;
  return `${body} Reply ${options.join(" or ")}.`;
}

export function writeGateFile(dirs, gate) {
  ensureDirs(dirs);
  const id = String(gate.id || `gate-${Date.now()}`);
  const parsed = parseGate({ ...gate, id });
  if (!parsed.ok) throw new Error(parsed.error);
  const file = path.join(dirs.gates, `${id}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ ...parsed.gate, id }, null, 2) + "\n",
    "utf8"
  );
  return { id, file };
}

export function writeDecisionFile(dirs, id, decision) {
  ensureDirs(dirs);
  const file = path.join(dirs.decisions, `${id}.json`);
  const body = {
    answer: decision.answer,
    promptified: decision.promptified,
    raw: decision.raw,
    timestamp: decision.timestamp || new Date().toISOString()
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n", "utf8");
  return { id, file, body };
}

export function readDecisionFile(dirs, id) {
  const file = path.join(dirs.decisions, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function assertQuestionFile(dirs, id) {
  const file = path.join(dirs.gates, `${id}.json`);
  if (!fs.existsSync(file)) {
    throw new Error("wait needs a question file first");
  }
}

export async function waitForDecision(dirs, id, { timeoutMs = 0, intervalMs = 500 } = {}) {
  assertQuestionFile(dirs, id);
  const started = Date.now();
  for (;;) {
    const body = readDecisionFile(dirs, id);
    if (body) return body;
    if (timeoutMs > 0 && Date.now() - started >= timeoutMs) {
      throw new Error("wait_timeout");
    }
    await sleep(intervalMs);
  }
}

export function alreadyHandled(dirs, id) {
  return (
    fs.existsSync(path.join(dirs.decisions, `${id}.json`)) ||
    fs.existsSync(path.join(dirs.outbox, `${id}.json`))
  );
}

export function readOutbox(dirs, id) {
  const file = path.join(dirs.outbox, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function outboxMessageIds(outbox) {
  if (!outbox) return [];
  const ids = [];
  if (Array.isArray(outbox.messageIds)) ids.push(...outbox.messageIds);
  if (outbox.messageId != null) ids.push(outbox.messageId);
  return [...new Set(ids.map(Number).filter((n) => Number.isFinite(n)))];
}

export function markSent(dirs, id, meta = {}) {
  ensureDirs(dirs);
  const prev = readOutbox(dirs, id) || {};
  const messageIds = outboxMessageIds({ ...prev, ...meta });
  const body = {
    ...prev,
    ...meta,
    messageIds,
    sentAt: prev.sentAt || meta.sentAt || new Date().toISOString()
  };
  fs.writeFileSync(path.join(dirs.outbox, `${id}.json`), JSON.stringify(body, null, 2) + "\n", "utf8");
}

export async function ingestGateFile(filePath, ctx) {
  const lockId = path.basename(filePath, ".json");
  if (!ctx.inflight) ctx.inflight = new Set();
  if (ctx.inflight.has(lockId) || alreadyHandled(ctx.dirs, lockId)) {
    return { skipped: true, error: "already_handled" };
  }
  ctx.inflight.add(lockId);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseGate(raw);
    if (!parsed.ok) return { skipped: true, error: parsed.error };
    const id = parsed.gate.id || lockId;
    const gate = { ...parsed.gate, id };
    if (alreadyHandled(ctx.dirs, id)) return { skipped: true, error: "already_handled" };
    const text = formatDecisionMessage(gate);
    const sent = await ctx.channel.send(text, { options: gate.options, id });
    const messageIds = sent && sent.message_id != null ? [sent.message_id] : [];
    markSent(ctx.dirs, id, { messageId: sent && sent.message_id, messageIds });
    ctx.pending.set(id, { ...gate, messageIds });
    return { skipped: false, id, text };
  } catch (err) {
    return { skipped: true, error: redact(err) };
  } finally {
    ctx.inflight.delete(lockId);
  }
}

export function findGateIdByMessageId(ctx, messageId) {
  const want = Number(messageId);
  if (!Number.isFinite(want)) return null;
  for (const [id, gate] of ctx.pending.entries()) {
    const ids = Array.isArray(gate.messageIds) ? gate.messageIds.map(Number) : [];
    if (ids.includes(want)) return id;
  }
  if (!ctx.dirs) return null;
  if (!fs.existsSync(ctx.dirs.outbox)) return null;
  for (const name of fs.readdirSync(ctx.dirs.outbox)) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    const ids = outboxMessageIds(readOutbox(ctx.dirs, id));
    if (ids.includes(want)) return id;
  }
  return null;
}

export function matchPending(inbound, ctx) {
  const pending = ctx.pending;
  if (!pending || pending.size === 0) return { gate: null, reason: "no_open_gate" };

  if (inbound.callbackGateId && pending.has(inbound.callbackGateId)) {
    return { gate: pending.get(inbound.callbackGateId), reason: "callback" };
  }

  if (inbound.replyToMessageId != null) {
    const id = findGateIdByMessageId(ctx, inbound.replyToMessageId);
    if (id && pending.has(id)) return { gate: pending.get(id), reason: "reply_to" };
  }

  if (pending.size === 1) {
    return { gate: pending.values().next().value, reason: "only_one" };
  }

  return { gate: null, reason: "ambiguous" };
}

export async function handleUpdate(update, ctx) {
  const inbound = extractInbound(update);
  if (!inbound) return { ignored: true, reason: "no_message" };
  if (!isAllowedSender(inbound, ctx.allowedUserId)) {
    return { ignored: true, reason: "unknown_sender" };
  }

  if (inbound.callbackQueryId && ctx.channel.answerCallback) {
    try {
      await ctx.channel.answerCallback(inbound.callbackQueryId);
    } catch {
      // Ack failure must not drop a good tap.
    }
  }

  const matched = matchPending(inbound, ctx);
  if (!matched.gate) {
    if (matched.reason === "ambiguous") {
      await ctx.channel.send(COPY.whichOne);
      return { ignored: true, reason: "ambiguous" };
    }
    return { ignored: true, reason: matched.reason };
  }
  const pending = matched.gate;

  let rawText = inbound.text.trim();
  if (inbound.voiceFileId) {
    try {
      const voice = await ctx.channel.downloadVoice(inbound.voiceFileId);
      const heard = await transcribe({
        bytes: voice.bytes,
        filename: voice.filename,
        env: ctx.env,
        fetchImpl: ctx.fetchImpl
      });
      if (!heard.ok) {
        await ctx.channel.send(COPY.transcribeFail);
        return { ignored: false, reason: "transcribe_failed", id: pending.id };
      }
      rawText = heard.text;
    } catch {
      await ctx.channel.send(COPY.transcribeFail);
      return { ignored: false, reason: "transcribe_failed", id: pending.id };
    }
  }

  if (!rawText) return { ignored: true, reason: "empty" };

  const cleaned = await promptify({
    text: rawText,
    options: pending.options,
    question: pending.question,
    env: ctx.env,
    fetchImpl: ctx.fetchImpl
  });

  writeDecisionFile(ctx.dirs, pending.id, {
    answer: cleaned.answer,
    promptified: cleaned.promptified,
    raw: cleaned.raw
  });
  ctx.pending.delete(pending.id);
  return { ignored: false, id: pending.id, answer: cleaned.answer };
}

export function loadUnanswered(dirs, ctx) {
  if (!fs.existsSync(dirs.gates)) return;
  for (const name of fs.readdirSync(dirs.gates)) {
    if (!name.endsWith(".json")) continue;
    const lockId = name.slice(0, -5);
    if (readDecisionFile(dirs, lockId)) continue;
    let parsed;
    try {
      parsed = parseGate(fs.readFileSync(path.join(dirs.gates, name), "utf8"));
    } catch {
      continue;
    }
    if (!parsed.ok) continue;
    const id = parsed.gate.id || lockId;
    const messageIds = outboxMessageIds(readOutbox(dirs, id));
    ctx.pending.set(id, { ...parsed.gate, id, messageIds });
  }
}

export function shouldRemind(outbox, nowMs, afterMs = REMIND_AFTER_MS) {
  if (!outbox) return false;
  const last = Date.parse(outbox.remindedAt || outbox.sentAt || "");
  if (!Number.isFinite(last)) return false;
  return nowMs - last >= afterMs;
}

export async function remindUnanswered(ctx, { nowMs = Date.now(), afterMs = REMIND_AFTER_MS } = {}) {
  const dirs = ctx.dirs;
  const sent = [];
  if (!fs.existsSync(dirs.gates)) return sent;
  for (const name of fs.readdirSync(dirs.gates)) {
    if (!name.endsWith(".json")) continue;
    const lockId = name.slice(0, -5);
    if (readDecisionFile(dirs, lockId)) continue;
    let parsed;
    try {
      parsed = parseGate(fs.readFileSync(path.join(dirs.gates, name), "utf8"));
    } catch {
      continue;
    }
    if (!parsed.ok) continue;
    const id = parsed.gate.id || lockId;
    const outbox = readOutbox(dirs, id);
    if (!shouldRemind(outbox, nowMs, afterMs)) continue;
    const gate = { ...parsed.gate, id };
    const text = formatDecisionMessage(gate);
    const result = await ctx.channel.send(text, { options: gate.options, id });
    const messageId = result && result.message_id;
    markSent(dirs, id, {
      messageId,
      remindedAt: new Date(nowMs).toISOString()
    });
    const prev = ctx.pending.get(id) || gate;
    const messageIds = outboxMessageIds(readOutbox(dirs, id));
    ctx.pending.set(id, { ...prev, ...gate, messageIds });
    sent.push(id);
  }
  return sent;
}

export function heartbeatPath(dirs) {
  return path.join(dirs.root, "heartbeat.json");
}

export function readHeartbeat(dirs) {
  const file = heartbeatPath(dirs);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeHeartbeat(dirs, body) {
  ensureDirs(dirs);
  fs.writeFileSync(heartbeatPath(dirs), JSON.stringify(body, null, 2) + "\n", "utf8");
  return body;
}

export function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

export function shouldNotifyWentDown(hb, { pidAlive } = {}) {
  if (!hb || hb.pid == null) return false;
  if (hb.downNotifiedAt) return false;
  return pidAlive === false;
}

export function shouldNotifyCameBack(lastTickAt, now, staleMs = STALE_MS) {
  if (lastTickAt == null) return false;
  return now - lastTickAt >= staleMs;
}

export function shouldNotifyCameBackOnStart(hb, now, staleMs = STALE_MS) {
  if (!hb) return false;
  if (hb.downNotifiedAt) return true;
  const at = Date.parse(hb.at || "");
  if (!Number.isFinite(at)) return false;
  return now - at >= staleMs;
}

export async function notifyGoingDown(ctx, { now = new Date() } = {}) {
  const hb = readHeartbeat(ctx.dirs) || {};
  if (hb.downNotifiedAt) return { sent: false };
  await ctx.channel.send(COPY.wentDown);
  const stamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  writeHeartbeat(ctx.dirs, { ...hb, at: stamp, pid: null, downNotifiedAt: stamp });
  return { sent: true };
}

export async function notifyIfReturning(ctx, { nowMs = Date.now(), staleMs = STALE_MS } = {}) {
  const hb = readHeartbeat(ctx.dirs);
  if (!shouldNotifyCameBackOnStart(hb, nowMs, staleMs)) return { sent: false };
  await ctx.channel.send(COPY.cameBack);
  return { sent: true };
}

export async function watchdogTick(ctx, { nowMs = Date.now(), pidAlive = isPidAlive } = {}) {
  const hb = readHeartbeat(ctx.dirs);
  const alive = hb && hb.pid != null ? pidAlive(hb.pid) : false;
  if (!shouldNotifyWentDown(hb, { pidAlive: alive })) return { sent: false };
  await ctx.channel.send(COPY.wentDown);
  writeHeartbeat(ctx.dirs, {
    ...hb,
    downNotifiedAt: new Date(nowMs).toISOString()
  });
  return { sent: true };
}

export async function runWatchdog(ctx, { signal, intervalMs = HEARTBEAT_EVERY_MS } = {}) {
  while (!signal?.aborted) {
    try {
      await watchdogTick(ctx);
    } catch {
      // Watchdog failures never take the process down.
    }
    await sleep(intervalMs);
  }
}

export function startHeartbeatLoop(ctx, { intervalMs = HEARTBEAT_EVERY_MS, staleMs = STALE_MS } = {}) {
  let lastTickAt = Date.now();
  writeHeartbeat(ctx.dirs, {
    at: new Date(lastTickAt).toISOString(),
    pid: process.pid
  });
  const tick = async () => {
    const now = Date.now();
    if (shouldNotifyCameBack(lastTickAt, now, staleMs)) {
      try {
        await ctx.channel.send(COPY.cameBack);
      } catch {
        // A missed "back" text must not stop the beat.
      }
    }
    lastTickAt = now;
    writeHeartbeat(ctx.dirs, {
      at: new Date(now).toISOString(),
      pid: process.pid
    });
  };
  const handle = setInterval(() => {
    tick().catch(() => {});
  }, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}

export function spawnWatchdog(env = process.env) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "watchdog"], {
    detached: true,
    stdio: "ignore",
    cwd: REPO_ROOT,
    env: { ...env, GATE_RELAY_WATCHDOG: "1" }
  });
  child.unref();
  return child;
}

export function startRemindLoop(ctx, { intervalMs = 60 * 1000, afterMs = REMIND_AFTER_MS } = {}) {
  const handle = setInterval(() => {
    remindUnanswered(ctx, { afterMs }).catch(() => {});
  }, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}

export function startWatch(dirs, ctx) {
  ensureDirs(dirs);
  loadUnanswered(dirs, ctx);
  const onFile = async (filename) => {
    if (!filename || !filename.endsWith(".json")) return;
    const filePath = path.join(dirs.gates, filename);
    try {
      await ingestGateFile(filePath, ctx);
    } catch {
      // Malformed or unreadable files never take the process down.
    }
  };

  for (const name of fs.readdirSync(dirs.gates)) {
    onFile(name);
  }

  const watcher = fs.watch(dirs.gates, (_event, filename) => {
    onFile(filename);
  });
  watcher.on("error", () => {});
  return watcher;
}

export function parseCli(argv) {
  const [cmd = "watch", ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok.startsWith("--") && rest[i + 1] && !rest[i + 1].startsWith("--")) {
      flags[tok.slice(2)] = rest[++i];
    } else if (tok.startsWith("--")) {
      flags[tok.slice(2)] = true;
    } else {
      positional.push(tok);
    }
  }
  return { cmd, flags, positional };
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const { cmd, flags, positional } = parseCli(argv);
  const dirs = ensureDirs(deps.dirs || relayDirs());

  if (cmd === "write") {
    const options = String(flags.options || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const written = writeGateFile(dirs, {
      id: flags.id || positional[0],
      question: flags.question || "",
      options,
      context: flags.context ?? null,
      session: flags.session ?? null
    });
    process.stdout.write(JSON.stringify(written) + "\n");
    return written;
  }

  if (cmd === "wait") {
    const id = flags.id || positional[0];
    if (!id) throw new Error("wait needs a gate id");
    const timeoutMs = flags.timeout ? Number(flags.timeout) : 0;
    const body = await waitForDecision(dirs, id, { timeoutMs });
    process.stdout.write(JSON.stringify(body) + "\n");
    return body;
  }

  if (cmd === "ask") {
    const options = String(flags.options || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const written = writeGateFile(dirs, {
      id: flags.id || positional[0],
      question: flags.question || "",
      options,
      context: flags.context ?? null,
      session: flags.session ?? null
    });
    const timeoutMs = flags.timeout ? Number(flags.timeout) : 0;
    const body = await waitForDecision(dirs, written.id, { timeoutMs });
    process.stdout.write(JSON.stringify({ ...written, decision: body }) + "\n");
    return { ...written, decision: body };
  }

  const env = deps.env || process.env;
  const channel = deps.channel || createChannel({ env, fetchImpl: deps.fetchImpl });
  const ctx = {
    dirs,
    channel,
    env,
    fetchImpl: deps.fetchImpl || globalThis.fetch,
    allowedUserId: String(env.TELEGRAM_USER_ID || ""),
    pending: new Map()
  };

  if (cmd === "watchdog") {
    return runWatchdog(ctx, {
      signal: deps.signal,
      intervalMs: deps.sleepMs ?? HEARTBEAT_EVERY_MS
    });
  }

  if (cmd !== "watch") throw new Error(`unknown command: ${cmd}`);

  await notifyIfReturning(ctx);
  startWatch(dirs, ctx);
  const remind = startRemindLoop(ctx);
  const beat = startHeartbeatLoop(ctx);
  if (!env.GATE_RELAY_WATCHDOG && deps.spawnWatchdog !== false) {
    spawnWatchdog(env);
  }
  if (deps.installSignals !== false) {
    const goingDown = async () => {
      try {
        await notifyGoingDown(ctx);
      } catch {
        // Best effort. The watchdog still has the heartbeat file.
      }
      process.exit(0);
    };
    process.once("SIGTERM", goingDown);
    process.once("SIGINT", goingDown);
  }
  const signal = deps.signal;
  if (signal) {
    signal.addEventListener("abort", () => {
      clearInterval(remind);
      clearInterval(beat);
    });
  }
  const offsetPath = path.join(dirs.root, "telegram-offset");
  let offset = 0;
  if (fs.existsSync(offsetPath)) {
    offset = Number(fs.readFileSync(offsetPath, "utf8")) || 0;
  }

  await channel.onReply(
    async (update) => {
      try {
        await handleUpdate(update, ctx);
      } catch {
        // Inbound failures never take the process down.
      }
      const next = Number(update.update_id) + 1;
      fs.writeFileSync(offsetPath, String(next), "utf8");
    },
    { signal, offset, sleepMs: deps.sleepMs ?? 1000 }
  );
}

function redact(err) {
  return String((err && err.message) || err)
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot<redacted>")
    .slice(0, 200);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  import("../load-env.mjs")
    .then(() => main())
    .catch((err) => {
      process.stderr.write(redact(err) + "\n");
      process.exitCode = 1;
    });
}
