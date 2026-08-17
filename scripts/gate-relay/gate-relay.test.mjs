// Gate relay unit tests. No Telegram, no OpenAI, no Anthropic — every
// network call is injected. These pin the failure paths in the spec:
// unknown sender ignored, malformed gate does not crash, transcription
// failure speaks instead of going silent.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createChannel,
  createSmsChannel,
  extractInbound,
  isAllowedSender,
  optionKeyboard,
  parseCallbackData
} from "./channel.mjs";
import { lightPass, pickAnswer, promptify, transcribe } from "./promptify.mjs";
import {
  COPY,
  alreadyHandled,
  formatDecisionMessage,
  handleUpdate,
  ingestGateFile,
  loadUnanswered,
  markSent,
  parseGate,
  relayDirs,
  remindUnanswered,
  startWatch,
  threadLabel,
  waitForDecision,
  writeDecisionFile,
  writeGateFile,
  notifyGoingDown,
  notifyIfReturning,
  shouldNotifyCameBack,
  shouldNotifyCameBackOnStart,
  shouldNotifyWentDown,
  watchdogTick,
  writeHeartbeat
} from "./index.mjs";

function tmpRelay() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-relay-"));
  const dirs = relayDirs(root);
  fs.mkdirSync(dirs.gates, { recursive: true });
  fs.mkdirSync(dirs.decisions, { recursive: true });
  fs.mkdirSync(dirs.outbox, { recursive: true });
  return dirs;
}

function fakeChannel() {
  const sent = [];
  return {
    name: "telegram",
    sent,
    async send(message) {
      sent.push(message);
      return { message_id: sent.length };
    },
    async downloadVoice() {
      return { bytes: Buffer.from("ogg"), filename: "voice.ogg" };
    },
    async onReply() {}
  };
}

function ctxFor(dirs, extras = {}) {
  const channel = extras.channel || fakeChannel();
  return {
    dirs,
    channel,
    env: extras.env || {},
    fetchImpl: extras.fetchImpl || (async () => ({ ok: false, json: async () => ({}) })),
    allowedUserId: extras.allowedUserId || "42",
    pending: extras.pending || new Map(),
    inflight: new Set()
  };
}

function textUpdate(userId, text) {
  return {
    update_id: 1,
    message: {
      message_id: 9,
      from: { id: Number(userId) },
      chat: { id: Number(userId) },
      text
    }
  };
}

function replyUpdate(userId, text, replyToMessageId) {
  return {
    update_id: 3,
    message: {
      message_id: 12,
      from: { id: Number(userId) },
      chat: { id: Number(userId) },
      text,
      reply_to_message: { message_id: replyToMessageId }
    }
  };
}

function callbackUpdate(userId, data, messageId) {
  return {
    update_id: 4,
    callback_query: {
      id: "cb-1",
      from: { id: Number(userId) },
      data,
      message: {
        message_id: messageId,
        chat: { id: Number(userId) }
      }
    }
  };
}

function voiceUpdate(userId) {
  return {
    update_id: 2,
    message: {
      message_id: 10,
      from: { id: Number(userId) },
      chat: { id: Number(userId) },
      voice: { file_id: "file-1" }
    }
  };
}

describe("gate file shape", () => {
  test("valid gate parses", () => {
    const parsed = parseGate({
      question: "Plan ready. Reply GO or QUESTIONS.",
      options: ["GO", "QUESTIONS"],
      session: "builder"
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.gate.options[0], "GO");
  });

  test("malformed json is not ok", () => {
    const parsed = parseGate("{not json");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "malformed_json");
  });

  test("missing question is not ok", () => {
    const parsed = parseGate({ options: ["GO"] });
    assert.equal(parsed.ok, false);
  });
});

describe("decision-shaped messages", () => {
  test("appends the choice when the question does not include it", () => {
    const text = formatDecisionMessage({
      question: "Ticket 4 struck out twice.",
      options: ["SKIP", "LOOK"]
    });
    assert.equal(text, "Ticket 4 struck out twice. Reply SKIP or LOOK.");
  });

  test("does not duplicate options already in the question", () => {
    const text = formatDecisionMessage({
      question: "Plan ready. Reply GO or QUESTIONS.",
      options: ["GO", "QUESTIONS"]
    });
    assert.equal(text, "Plan ready. Reply GO or QUESTIONS.");
  });

  test("never puts a file path in the message", () => {
    const text = formatDecisionMessage({
      question: "Plan ready. Reply GO or QUESTIONS.",
      options: ["GO", "QUESTIONS"]
    });
    assert.equal(text.includes(".json"), false);
    assert.equal(text.includes("scripts/"), false);
  });

  test("sends the real ask when question is a stub like Build?", () => {
    const text = formatDecisionMessage({
      question: "Build?",
      options: ["GO", "REVISE"],
      context:
        "Plan ready — closer now-and-next read, one role, no new buttons. Reply GO or REVISE."
    });
    assert.equal(
      text,
      "Plan ready — closer now-and-next read, one role, no new buttons. Reply GO or REVISE."
    );
  });

  test("names the thread when the ask does not already say it", () => {
    assert.equal(threadLabel({ session: "closer-now" }), "closer now");
    const text = formatDecisionMessage({
      question: "Plan ready. Reply GO or REVISE.",
      options: ["GO", "REVISE"],
      session: "sales-desk"
    });
    assert.equal(text, "This is for sales desk. Plan ready. Reply GO or REVISE.");
  });
});

describe("channel adapter", () => {
  test("telegram adapter exposes send and onReply", () => {
    const ch = createChannel({
      kind: "telegram",
      env: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_USER_ID: "42" },
      fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: {} }) })
    });
    assert.equal(ch.name, "telegram");
    assert.equal(typeof ch.send, "function");
    assert.equal(typeof ch.onReply, "function");
  });

  test("sms adapter exists and is not wired", async () => {
    const ch = createSmsChannel();
    assert.equal(ch.name, "sms");
    await assert.rejects(() => ch.send("hi"), /not wired/);
  });

  test("createChannel('sms') returns the stub", async () => {
    const ch = createChannel({ kind: "sms" });
    await assert.rejects(() => ch.onReply(() => {}), /not wired/);
  });

  test("buttons under a named question carry that question id", () => {
    const markup = optionKeyboard(["GO", "REVISE"], { id: "sales-desk" });
    assert.equal(markup.inline_keyboard[0][0].callback_data, "sales-desk|GO");
    assert.deepEqual(parseCallbackData("sales-desk|GO"), {
      id: "sales-desk",
      answer: "GO"
    });
  });

  test("extractInbound keeps a reply-to and a button tap", () => {
    const replied = extractInbound(replyUpdate("42", "GO", 11));
    assert.equal(replied.replyToMessageId, 11);
    const tapped = extractInbound(callbackUpdate("42", "g2|GO", 11));
    assert.equal(tapped.callbackGateId, "g2");
    assert.equal(tapped.text, "GO");
  });
});

describe("unknown sender is ignored silently", () => {
  test("isAllowedSender rejects a different user id", () => {
    const inbound = extractInbound(textUpdate("99", "GO"));
    assert.equal(isAllowedSender(inbound, "42"), false);
  });

  test("handleUpdate does not write a decision or reply", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    c.pending.set("g1", {
      id: "g1",
      question: "Plan ready. Reply GO or QUESTIONS.",
      options: ["GO", "QUESTIONS"]
    });
    const result = await handleUpdate(textUpdate("99", "GO"), c);
    assert.equal(result.reason, "unknown_sender");
    assert.equal(c.channel.sent.length, 0);
    assert.equal(fs.existsSync(path.join(dirs.decisions, "g1.json")), false);
  });
});

describe("malformed gate file does not crash the watcher", () => {
  test("ingestGateFile returns skipped and does not send", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    const bad = path.join(dirs.gates, "bad.json");
    fs.writeFileSync(bad, "{nope", "utf8");
    const result = await ingestGateFile(bad, c);
    assert.equal(result.skipped, true);
    assert.equal(result.error, "malformed_json");
    assert.equal(c.channel.sent.length, 0);
  });

  test("startWatch keeps running after a bad file, then sends a good one", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    fs.writeFileSync(path.join(dirs.gates, "bad.json"), "not json", "utf8");
    writeGateFile(dirs, {
      id: "good",
      question: "Plan ready. Reply GO or QUESTIONS.",
      options: ["GO", "QUESTIONS"]
    });
    const watcher = startWatch(dirs, c);
    const deadline = Date.now() + 2000;
    while (c.channel.sent.length === 0 && Date.now() < deadline) await sleep(50);
    watcher.close();
    assert.equal(c.channel.sent.length, 1);
    assert.match(c.channel.sent[0], /GO/);
  });
});

describe("transcription failure surfaces as a plain message", () => {
  test("failed whisper sends the hear-that line and writes no decision", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs, {
      env: { OPENAI_API_KEY: "sk-test" },
      fetchImpl: async () => ({ ok: false, json: async () => ({ error: { message: "nope" } }) })
    });
    c.pending.set("g1", {
      id: "g1",
      question: "Plan ready. Reply GO or QUESTIONS.",
      options: ["GO", "QUESTIONS"]
    });
    const result = await handleUpdate(voiceUpdate("42"), c);
    assert.equal(result.reason, "transcribe_failed");
    assert.equal(c.channel.sent[0], COPY.transcribeFail);
    assert.equal(fs.existsSync(path.join(dirs.decisions, "g1.json")), false);
  });

  test("transcribe itself reports failure without throwing", async () => {
    const result = await transcribe({
      bytes: Buffer.from("x"),
      env: {},
      fetchImpl: async () => {
        throw new Error("network");
      }
    });
    assert.equal(result.ok, false);
  });
});

describe("promptify", () => {
  test("one-word GO skips the model", async () => {
    const result = await promptify({
      text: "GO",
      options: ["GO", "QUESTIONS"],
      callModelImpl: async () => {
        throw new Error("model should not run");
      }
    });
    assert.equal(result.skippedModel, true);
    assert.equal(result.answer, "GO");
    assert.equal(result.promptified, "GO");
  });

  test("pickAnswer takes the first allowed word", () => {
    assert.equal(pickAnswer("LOOK\ncheck the status filter", ["SKIP", "LOOK"]), "LOOK");
  });

  test("lightPass ignores ramble", () => {
    assert.equal(lightPass("go ahead and also change the button", ["GO"]), null);
  });
});

describe("write and wait", () => {
  test("wait returns the decision once it lands", async () => {
    const dirs = tmpRelay();
    writeGateFile(dirs, {
      id: "w1",
      question: "Plan ready. Reply GO or QUESTIONS.",
      options: ["GO", "QUESTIONS"]
    });
    const pending = waitForDecision(dirs, "w1", { timeoutMs: 2000, intervalMs: 20 });
    writeDecisionFile(dirs, "w1", {
      answer: "GO",
      promptified: "GO",
      raw: "GO"
    });
    const body = await pending;
    assert.equal(body.answer, "GO");
    assert.ok(body.timestamp);
  });

  test("alreadyHandled is true after a send is recorded", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    writeGateFile(dirs, {
      id: "s1",
      question: "Plan ready. Reply GO or QUESTIONS.",
      options: ["GO", "QUESTIONS"]
    });
    await ingestGateFile(path.join(dirs.gates, "s1.json"), c);
    assert.equal(alreadyHandled(dirs, "s1"), true);
    const again = await ingestGateFile(path.join(dirs.gates, "s1.json"), c);
    assert.equal(again.error, "already_handled");
    assert.equal(c.channel.sent.length, 1);
  });
});

describe("text reply writes a decision file", () => {
  test("GO from Chris lands as answer GO", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    c.pending.set("g1", {
      id: "g1",
      question: "Plan ready. Reply GO or QUESTIONS.",
      options: ["GO", "QUESTIONS"]
    });
    const result = await handleUpdate(textUpdate("42", "GO"), c);
    assert.equal(result.answer, "GO");
    const body = JSON.parse(fs.readFileSync(path.join(dirs.decisions, "g1.json"), "utf8"));
    assert.equal(body.answer, "GO");
    assert.equal(body.raw, "GO");
  });

  test("a reply to one of two open questions closes only that one", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    c.pending.set("g1", {
      id: "g1",
      question: "First. Reply GO or REVISE.",
      options: ["GO", "REVISE"],
      messageIds: [10]
    });
    c.pending.set("g2", {
      id: "g2",
      question: "Second. Reply GO or REVISE.",
      options: ["GO", "REVISE"],
      messageIds: [11]
    });
    const result = await handleUpdate(replyUpdate("42", "GO", 11), c);
    assert.equal(result.id, "g2");
    assert.equal(fs.existsSync(path.join(dirs.decisions, "g2.json")), true);
    assert.equal(fs.existsSync(path.join(dirs.decisions, "g1.json")), false);
    assert.equal(c.pending.has("g1"), true);
  });

  test("a button tap on one of two open questions closes only that one", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    c.pending.set("g1", {
      id: "g1",
      question: "First. Reply GO or REVISE.",
      options: ["GO", "REVISE"],
      messageIds: [10]
    });
    c.pending.set("g2", {
      id: "g2",
      question: "Second. Reply GO or REVISE.",
      options: ["GO", "REVISE"],
      messageIds: [11]
    });
    const result = await handleUpdate(callbackUpdate("42", "g2|GO", 11), c);
    assert.equal(result.id, "g2");
    assert.equal(fs.existsSync(path.join(dirs.decisions, "g1.json")), false);
  });

  test("a bare GO with two open questions does not guess", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    c.pending.set("g1", {
      id: "g1",
      question: "First. Reply GO or REVISE.",
      options: ["GO", "REVISE"],
      messageIds: [10]
    });
    c.pending.set("g2", {
      id: "g2",
      question: "Second. Reply GO or REVISE.",
      options: ["GO", "REVISE"],
      messageIds: [11]
    });
    const result = await handleUpdate(textUpdate("42", "GO"), c);
    assert.equal(result.reason, "ambiguous");
    assert.equal(c.channel.sent[0], COPY.whichOne);
    assert.equal(fs.existsSync(path.join(dirs.decisions, "g1.json")), false);
    assert.equal(fs.existsSync(path.join(dirs.decisions, "g2.json")), false);
  });
});

describe("wait needs a question file", () => {
  test("wait with no question file fails out loud", async () => {
    const dirs = tmpRelay();
    await assert.rejects(
      () => waitForDecision(dirs, "missing", { timeoutMs: 50, intervalMs: 10 }),
      /question file first/
    );
  });
});

describe("unanswered question texts again", () => {
  test("startWatch reloads an unanswered question without sending it twice", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    writeGateFile(dirs, {
      id: "open1",
      question: "Plan ready. Reply GO or QUESTIONS.",
      options: ["GO", "QUESTIONS"],
      session: "sales-desk"
    });
    markSent(dirs, "open1", { messageId: 7, sentAt: new Date().toISOString() });
    loadUnanswered(dirs, c);
    assert.equal(c.pending.has("open1"), true);
    assert.deepEqual(c.pending.get("open1").messageIds, [7]);
    const watcher = startWatch(dirs, c);
    await sleep(30);
    watcher.close();
    assert.equal(c.channel.sent.length, 0);
  });

  test("remindUnanswered sends again after the wait, not before", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    writeGateFile(dirs, {
      id: "old1",
      question: "Plan ready. Reply GO or QUESTIONS.",
      options: ["GO", "QUESTIONS"]
    });
    const sentAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    markSent(dirs, "old1", { messageId: 8, sentAt });
    const none = await remindUnanswered(c, { nowMs: Date.parse(sentAt) + 60 * 1000 });
    assert.deepEqual(none, []);
    assert.equal(c.channel.sent.length, 0);
    const again = await remindUnanswered(c, { nowMs: Date.parse(sentAt) + 16 * 60 * 1000 });
    assert.deepEqual(again, ["old1"]);
    assert.equal(c.channel.sent.length, 1);
    assert.match(c.channel.sent[0], /GO/);
  });
});

describe("messenger down is not the same as silence", () => {
  test("a dead process with no down text yet should notify", () => {
    assert.equal(
      shouldNotifyWentDown({ pid: 9, at: new Date().toISOString() }, { pidAlive: false }),
      true
    );
    assert.equal(
      shouldNotifyWentDown({ pid: 9, at: new Date().toISOString() }, { pidAlive: true }),
      false
    );
    assert.equal(
      shouldNotifyWentDown(
        { pid: 9, downNotifiedAt: new Date().toISOString() },
        { pidAlive: false }
      ),
      false
    );
  });

  test("a long gap after a beat means the Mac slept", () => {
    assert.equal(shouldNotifyCameBack(1000, 1000 + 90 * 1000), true);
    assert.equal(shouldNotifyCameBack(1000, 1000 + 10 * 1000), false);
    assert.equal(shouldNotifyCameBack(null, Date.now()), false);
  });

  test("coming back after a down text should notify", () => {
    assert.equal(
      shouldNotifyCameBackOnStart({ downNotifiedAt: new Date().toISOString() }, Date.now()),
      true
    );
    assert.equal(shouldNotifyCameBackOnStart(null, Date.now()), false);
  });

  test("watchdog texts once when the relay pid is dead", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    writeHeartbeat(dirs, { at: new Date().toISOString(), pid: 999999 });
    const first = await watchdogTick(c, { pidAlive: () => false });
    assert.equal(first.sent, true);
    assert.equal(c.channel.sent[0], COPY.wentDown);
    const second = await watchdogTick(c, { pidAlive: () => false });
    assert.equal(second.sent, false);
    assert.equal(c.channel.sent.length, 1);
  });

  test("a clean stop texts that the messenger went down", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    writeHeartbeat(dirs, { at: new Date().toISOString(), pid: 1 });
    const first = await notifyGoingDown(c);
    assert.equal(first.sent, true);
    assert.equal(c.channel.sent[0], COPY.wentDown);
    const second = await notifyGoingDown(c);
    assert.equal(second.sent, false);
  });

  test("a restart after a down text says it is back", async () => {
    const dirs = tmpRelay();
    const c = ctxFor(dirs);
    writeHeartbeat(dirs, {
      at: new Date().toISOString(),
      pid: null,
      downNotifiedAt: new Date().toISOString()
    });
    const result = await notifyIfReturning(c);
    assert.equal(result.sent, true);
    assert.equal(c.channel.sent[0], COPY.cameBack);
  });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
