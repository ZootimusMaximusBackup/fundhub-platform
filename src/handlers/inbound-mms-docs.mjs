// Inbound MMS photos → the same docs.received path portal uploads use.
// Spec 4.6: texts with photo attachments must reach GHL-DOC. Does not mint clients.

import { on } from "../events/registry.mjs";
import { emit } from "../events/bus.mjs";
import { storeAndRegister } from "../documents/register.mjs";
import { storeFromEnv } from "../documents/store.mjs";
import { KINDS } from "../documents/kinds.mjs";
import { phoneCandidates } from "../mail/suppression.mjs";

const PHONE_DIGITS_SQL = `regexp_replace(phone, '[^0-9]', '', 'g')`;

async function findClientByPhone(db, orgId, phone) {
  if (!orgId || !phone) return null;
  const r = await db.query(`SELECT id FROM clients WHERE org_id=$1 AND phone=$2 LIMIT 1`, [orgId, phone]);
  if (r.rows[0]) return r.rows[0].id;
  const candidates = phoneCandidates(phone);
  if (!candidates.length) return null;
  const d = await db.query(
    `SELECT id FROM clients WHERE org_id=$1 AND ${PHONE_DIGITS_SQL} = ANY($2) LIMIT 1`,
    [orgId, candidates]
  );
  return d.rows[0]?.id || null;
}

function mediaList(payload) {
  const raw = payload?.mediaUrls;
  if (Array.isArray(raw)) return raw.map((m) => (typeof m === "string" ? { url: m } : m)).filter((m) => m?.url);
  return [];
}

async function downloadTwilioMedia(url, { env = process.env, fetchImpl = fetch } = {}) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetchImpl(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  return { buffer: buf, mimeType: contentType.split(";")[0].trim() };
}

export async function onInboundMmsDocs(event, db, deps = {}) {
  const payload = event?.payload || {};
  if ((payload.channel || "sms") !== "sms") return { done: false, reason: "not_sms" };
  const media = mediaList(payload);
  if (!media.length) return { done: false, reason: "no_media" };

  const orgId = event.orgId;
  const clientId = event.clientId || (await findClientByPhone(db, orgId, payload.from));
  if (!orgId || !clientId) return { done: false, reason: "no_client" };

  const sid = payload.sid || event.id;
  const store = deps.store || storeFromEnv();
  const download = deps.downloadImpl || downloadTwilioMedia;
  const register = deps.registerImpl || storeAndRegister;
  const emitFn = deps.emitImpl || emit;
  const registered = [];

  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    const got = await download(item.url, { env: deps.env || process.env, fetchImpl: deps.fetchImpl });
    if (!got?.buffer) continue;
    const { document, version } = await register(db, store, {
      orgId,
      clientId,
      kind: KINDS.CLIENT_UPLOAD,
      subtype: "other",
      discriminator: `${sid}:${i}`,
      body: got.buffer,
      filename: `mms-${sid}-${i}`,
      mimeType: item.contentType || got.mimeType,
      generatedBy: "inbound-mms",
      reason: "initial",
      sourceEventId: `inbound-mms:${sid}:${i}`,
      metadata: { uploaded_by: { kind: "client", id: clientId }, original_filename: `mms-${sid}-${i}` }
    });
    await emitFn(db, "docs.received", {
      document_id: document.id,
      version_id: version.id,
      version: version.version,
      kind: document.kind,
      subtype: document.subtype,
      client_id: clientId,
      uploaded_by: { kind: "client", id: clientId },
      mime_type: version.mime_type,
      byte_size: version.byte_size,
      checksum: version.checksum,
      original_filename: `mms-${sid}-${i}`
    }, { orgId, clientId, idempotencyKey: `docs.received:inbound-mms:${sid}:${i}` });
    registered.push(document.id);
  }

  return { done: registered.length > 0, documents: registered };
}

export function register() {
  on("message.inbound", onInboundMmsDocs);
}

export default onInboundMmsDocs;
