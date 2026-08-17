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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createChannel, extractInbound, isAllowedSender } from "./channel.mjs";
import { promptify, transcribe } from "./promptify.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../..");

export const COPY = {
  transcribeFail: "Couldn't hear that. Reply in text?"
};

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

export function formatDecisionMessage(gate) {
  const q = String(gate.question || "").trim();
  const options = Array.isArray(gate.options) ? gate.options.map(String) : [];
  if (!options.length) return q;
  const already = options.every((o) => q.toUpperCase().includes(o.toUpperCase()));
  if (already) return q;
  return `${q} Reply ${options.join(" or ")}.`;
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

export async function waitForDecision(dirs, id, { timeoutMs = 0, intervalMs = 500 } = {}) {
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

export function markSent(dirs, id, meta = {}) {
  ensureDirs(dirs);
  fs.writeFileSync(
    path.join(dirs.outbox, `${id}.json`),
    JSON.stringify({ sentAt: new Date().toISOString(), ...meta }, null, 2) + "\n",
    "utf8"
  );
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
    const sent = await ctx.channel.send(text, { options: gate.options });
    markSent(ctx.dirs, id, { messageId: sent && sent.message_id });
    ctx.pending.set(id, gate);
    return { skipped: false, id, text };
  } catch (err) {
    return { skipped: true, error: redact(err) };
  } finally {
    ctx.inflight.delete(lockId);
  }
}

export async function handleUpdate(update, ctx) {
  const inbound = extractInbound(update);
  if (!inbound) return { ignored: true, reason: "no_message" };
  if (!isAllowedSender(inbound, ctx.allowedUserId)) {
    return { ignored: true, reason: "unknown_sender" };
  }

  const pending = oldestPending(ctx.pending);
  if (!pending) return { ignored: true, reason: "no_open_gate" };

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

export function startWatch(dirs, ctx) {
  ensureDirs(dirs);
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

  if (cmd !== "watch") throw new Error(`unknown command: ${cmd}`);

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

  startWatch(dirs, ctx);

  const signal = deps.signal;
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

function oldestPending(pending) {
  for (const gate of pending.values()) return gate;
  return null;
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
