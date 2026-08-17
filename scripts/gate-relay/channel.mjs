// Phone-channel adapter for the gate relay.
//
// WHY A SEPARATE ADAPTER. Telegram is the channel that works today. SMS via
// Twilio is the eventual preferred channel, but Twilio is not working right
// now. The watcher, promptify, and gate files talk only to send() / onReply().
// Swapping channels is a new adapter, not a rewrite.
//
// THIS IS NOT src/messaging/providers/twilio.mjs. That module texts clients.
// This module texts Chris. Same vendor later, opposite audience. Do not merge.

export function createChannel({
  kind,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const resolved = String(kind || env.GATE_RELAY_CHANNEL || "telegram").toLowerCase();
  if (resolved === "sms" || resolved === "twilio") return createSmsChannel();
  return createTelegramChannel({ env, fetchImpl });
}

export function createSmsChannel() {
  async function notWired() {
    throw new Error(
      "SMS channel is not wired. Twilio is the eventual phone channel; Telegram is current."
    );
  }
  return {
    name: "sms",
    send: notWired,
    onReply: notWired,
    downloadVoice: notWired,
    pollOnce: notWired,
    answerCallback: notWired
  };
}

export function createTelegramChannel({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const token = env.TELEGRAM_BOT_TOKEN || "";
  const allowedUserId = String(env.TELEGRAM_USER_ID || "");
  const chatId = env.TELEGRAM_CHAT_ID || env.TELEGRAM_USER_ID || "";

  async function api(method, body) {
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => null);
    if (!json || json.ok !== true) {
      throw new Error(`telegram ${method} failed`);
    }
    return json.result;
  }

  return {
    name: "telegram",
    allowedUserId,
    chatId,

    async send(message, { options, id } = {}) {
      const payload = { chat_id: chatId, text: String(message) };
      if (Array.isArray(options) && options.length) {
        payload.reply_markup = optionKeyboard(options, { id });
      }
      return api("sendMessage", payload);
    },

    async answerCallback(callbackQueryId) {
      if (!callbackQueryId) return null;
      return api("answerCallbackQuery", { callback_query_id: callbackQueryId });
    },

    async pollOnce(offset = 0, { timeout = 30 } = {}) {
      const result = await api("getUpdates", {
        offset,
        timeout,
        allowed_updates: ["message", "callback_query"]
      });
      return Array.isArray(result) ? result : [];
    },

    async downloadVoice(fileId) {
      const file = await api("getFile", { file_id: fileId });
      const filePath = file && file.file_path;
      if (!filePath) throw new Error("telegram voice file missing");
      const res = await fetchImpl(
        `https://api.telegram.org/file/bot${token}/${filePath}`
      );
      if (!res.ok) throw new Error("telegram voice download failed");
      const buf = Buffer.from(await res.arrayBuffer());
      const name = String(filePath).split("/").pop() || "voice.ogg";
      return { bytes: buf, filename: name };
    },

    async onReply(handler, { signal, offset = 0, sleepMs = 1000 } = {}) {
      let next = offset;
      while (!signal?.aborted) {
        try {
          const updates = await this.pollOnce(next);
          for (const update of updates) {
            next = Number(update.update_id) + 1;
            await handler(update);
          }
        } catch {
          await sleep(sleepMs);
        }
      }
      return next;
    }
  };
}

export function callbackData(id, option) {
  const data = `${id}|${option}`;
  return data.length <= 64 ? data : data.slice(0, 64);
}

export function parseCallbackData(data) {
  const raw = String(data || "");
  const i = raw.indexOf("|");
  if (i <= 0) return null;
  return { id: raw.slice(0, i), answer: raw.slice(i + 1) };
}

export function optionKeyboard(options, { id } = {}) {
  const rows = [];
  if (id) {
    for (let i = 0; i < options.length; i += 2) {
      rows.push(
        options.slice(i, i + 2).map((text) => ({
          text: String(text),
          callback_data: callbackData(id, text)
        }))
      );
    }
    return { inline_keyboard: rows };
  }
  for (let i = 0; i < options.length; i += 2) {
    rows.push(options.slice(i, i + 2).map((text) => ({ text: String(text) })));
  }
  return {
    keyboard: rows,
    one_time_keyboard: true,
    resize_keyboard: true
  };
}

export function extractInbound(update) {
  if (!update) return null;
  if (update.callback_query) {
    const cq = update.callback_query;
    const parsed = parseCallbackData(cq.data);
    const from = cq.from || {};
    const msg = cq.message || {};
    const chat = msg.chat || {};
    return {
      userId: from.id != null ? String(from.id) : "",
      chatId: chat.id != null ? String(chat.id) : "",
      text: parsed ? parsed.answer : "",
      voiceFileId: null,
      messageId: msg.message_id,
      updateId: update.update_id,
      replyToMessageId: msg.message_id != null ? Number(msg.message_id) : null,
      callbackGateId: parsed ? parsed.id : null,
      callbackQueryId: cq.id != null ? String(cq.id) : null
    };
  }
  const msg = update.message || update.edited_message;
  if (!msg) return null;
  const userId = msg.from && msg.from.id != null ? String(msg.from.id) : "";
  const chatId = msg.chat && msg.chat.id != null ? String(msg.chat.id) : "";
  const text = typeof msg.text === "string" ? msg.text : "";
  const voiceFileId =
    (msg.voice && msg.voice.file_id) ||
    (msg.audio && msg.audio.file_id) ||
    null;
  const replyTo = msg.reply_to_message && msg.reply_to_message.message_id;
  return {
    userId,
    chatId,
    text,
    voiceFileId,
    messageId: msg.message_id,
    updateId: update.update_id,
    replyToMessageId: replyTo != null ? Number(replyTo) : null,
    callbackGateId: null,
    callbackQueryId: null
  };
}

export function isAllowedSender(inbound, allowedUserId) {
  if (!inbound || !allowedUserId) return false;
  return String(inbound.userId) === String(allowedUserId);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
