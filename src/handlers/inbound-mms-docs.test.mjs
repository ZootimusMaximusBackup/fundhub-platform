import { test } from "node:test";
import assert from "node:assert/strict";
import { onInboundMmsDocs } from "./inbound-mms-docs.mjs";

test("inbound MMS with no media is a no-op", async () => {
  const res = await onInboundMmsDocs({
    orgId: "org-1",
    clientId: "cl-1",
    payload: { channel: "sms", from: "+15551234567", mediaUrls: [] }
  }, {});
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_media");
});

test("inbound MMS does not mint a client", async () => {
  const db = { query: async () => ({ rows: [] }) };
  const res = await onInboundMmsDocs({
    orgId: "org-1",
    payload: {
      channel: "sms",
      from: "+15550001111",
      sid: "SM1",
      mediaUrls: [{ url: "https://api.twilio.com/media/1", contentType: "image/jpeg" }]
    }
  }, db);
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_client");
});

test("inbound MMS stores a client_upload and emits docs.received", async () => {
  const emitted = [];
  const res = await onInboundMmsDocs({
    orgId: "org-1",
    clientId: "cl-1",
    payload: {
      channel: "sms",
      from: "+15550001111",
      sid: "SM1",
      mediaUrls: [{ url: "https://api.twilio.com/media/1", contentType: "image/jpeg" }]
    }
  }, {}, {
    downloadImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/jpeg" }),
    registerImpl: async () => ({
      document: { id: "d1", kind: "client_upload", subtype: "other" },
      version: { id: "v1", version: 1, mime_type: "image/jpeg", byte_size: 3, checksum: "abc" }
    }),
    emitImpl: async (_db, name, payload) => {
      emitted.push({ name, payload });
      return { id: "e1" };
    }
  });
  assert.equal(res.done, true);
  assert.deepEqual(res.documents, ["d1"]);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].name, "docs.received");
  assert.equal(emitted[0].payload.kind, "client_upload");
  assert.equal(emitted[0].payload.subtype, "other");
});
