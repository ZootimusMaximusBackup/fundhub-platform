// Inbound MMS photos → the same docs.received path portal uploads use.
// Spec 4.6: texts with photo attachments must reach GHL-DOC. Does not mint clients.

import { on } from "../events/registry.mjs";
import { emit } from "../events/bus.mjs";
import { storeAndRegister } from "../documents/register.mjs";
import { storeFromEnv } from "../documents/store.mjs";
import { KINDS } from "../documents/kinds.mjs";
import { phoneCandidates } from "../mail/suppression.mjs";
import { byCode } from "../agents/registry.mjs";
import { callModel } from "../agents/model.mjs";
import { mediaFromBytes } from "../repair/response-agent.mjs";
import { AGENT_CODE as DOC_AGENT_CODE, parseAgentJson } from "./ghl-doc.mjs";

export const FALLBACK_SUBTYPE = "other";

/* WHAT KIND OF PHOTO IS THIS?
 *
 * Every inbound MMS image used to be filed as "other", so the document agent
 * and src/inquiry-ops/doc-gate.mjs could not tell a driver's licence from a gas
 * bill from a picture of a dog. A client who texted their ID had, as far as
 * every downstream check was concerned, sent nothing.
 *
 * The answer is not guessed. GHL-DOC — the same seeded agent that already reads
 * these images (db/migrations/114_ghl_agent_seed.sql) — is asked, and its own
 * `documents_reviewed` output is mapped onto the client_upload subtypes in
 * src/documents/kinds.mjs. THE FILENAME IS NEVER READ: an MMS filename is
 * `mms-<sid>-<n>` and carries no information at all.
 *
 * Patterns are tried in this order, and a phrase that matches TWO of them (or
 * none) falls back to "other". A wrong subtype is worse than an unclassified
 * one: it would put a gas bill on a dispute letter as a government ID. */
const SUBTYPE_PATTERNS = Object.freeze([
  ["ssn_card", /social security card|\bssn\b|social security number card/i],
  ["bank_statement", /bank statement|checking statement|savings statement/i],
  ["tax_return", /tax return|form 1040|\b1040\b/i],
  ["proof_of_income", /pay ?stub|paycheck stub|w-?2\b|1099\b|proof of income|earnings statement/i],
  ["id_document", /driver'?s? licen[cs]e|state id\b|photo id\b|government id\b|identification card|passport|\bid card\b|\bid\b/i],
  ["proof_of_address", /utility bill|proof of address|electric(ity)? bill|gas bill|water bill|internet bill|phone bill|lease agreement|mortgage statement/i]
]);

/** documents_reviewed → one client_upload subtype, or "other" when unsure. */
export function subtypeFromAgentJson(json) {
  const reviewed = json && json.documents_reviewed;
  const text = (Array.isArray(reviewed) ? reviewed : [reviewed])
    .filter((v) => typeof v === "string")
    .join(" | ");
  if (!text.trim()) return FALLBACK_SUBTYPE;
  const hits = SUBTYPE_PATTERNS.filter(([, re]) => re.test(text)).map(([sub]) => sub);
  const unique = [...new Set(hits)];
  return unique.length === 1 ? unique[0] : FALLBACK_SUBTYPE;
}

/* classifyMmsImage — one call to the seeded Document Check agent, asking only
 * what the image IS. It never messages the client and never routes an outcome;
 * outcome routing stays where it already lives, on docs.received in
 * src/handlers/ghl-doc.mjs, which now receives a correctly typed document.
 *
 * Runs whatever the agent's status is. That switch exists to stop a retired
 * agent TEXTING people (see ghl-doc.mjs); filing an image under the right name
 * sends nothing to anyone. With no model key configured callModel() returns a
 * shadow result, parseAgentJson gets nothing, and the subtype stays "other" —
 * exactly the old behaviour, never a guess. */
export async function classifyMmsImage(db, {
  orgId,
  buffer,
  mimeType,
  env = process.env,
  fetchImpl,
  callModelImpl = callModel
} = {}) {
  if (!db?.query || !orgId || !buffer) return { subtype: FALLBACK_SUBTYPE, reason: "no_input" };
  let agent = null;
  try {
    agent = await byCode(db, { orgId, code: DOC_AGENT_CODE });
  } catch (err) {
    console.warn("[inbound-mms] document agent lookup failed:", err && err.message);
    return { subtype: FALLBACK_SUBTYPE, reason: "agent_lookup_failed" };
  }
  if (!agent || !String(agent.prompt || "").trim()) {
    return { subtype: FALLBACK_SUBTYPE, reason: "agent_unavailable" };
  }
  const result = await callModelImpl({
    system: String(agent.prompt),
    user: [
      "A client texted us this photo. Do not review it and do not write to the client.",
      "Name what the document IS, in documents_reviewed, using the plainest name for it",
      "(for example: driver's license, passport, utility bill, bank statement,",
      "social security card, pay stub, tax return). If the photo is not one of those,",
      "or you cannot tell, put \"unknown\" in documents_reviewed.",
      "Reply with ONLY a JSON object of the form:",
      '{"documents_reviewed":["..."]}'
    ].join("\n"),
    media: mediaFromBytes(mimeType, buffer),
    env,
    fetchImpl,
    maxTokens: 200
  }).catch((err) => ({ text: "", error: String(err?.message || err) }));

  const json = parseAgentJson(result?.text);
  const subtype = subtypeFromAgentJson(json);
  return { subtype, reason: subtype === FALLBACK_SUBTYPE ? "unclassified" : "classified", mode: result?.mode || null, json };
}

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
  const classify = deps.classifyImpl || classifyMmsImage;
  const registered = [];
  const subtypes = [];

  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    const got = await download(item.url, { env: deps.env || process.env, fetchImpl: deps.fetchImpl });
    if (!got?.buffer) continue;
    /* Classify BEFORE filing, so the document is registered under its real
       subtype and docs.received carries it. Filing first and patching after
       would hand every downstream listener a document typed "other". */
    const seen = await classify(db, {
      orgId,
      buffer: got.buffer,
      mimeType: item.contentType || got.mimeType,
      env: deps.env || process.env,
      fetchImpl: deps.fetchImpl
    }).catch((err) => ({ subtype: FALLBACK_SUBTYPE, reason: String(err?.message || err) }));
    const subtype = seen?.subtype || FALLBACK_SUBTYPE;
    const { document, version } = await register(db, store, {
      orgId,
      clientId,
      kind: KINDS.CLIENT_UPLOAD,
      subtype,
      discriminator: `${sid}:${i}`,
      body: got.buffer,
      filename: `mms-${sid}-${i}`,
      mimeType: item.contentType || got.mimeType,
      generatedBy: "inbound-mms",
      reason: "initial",
      sourceEventId: `inbound-mms:${sid}:${i}`,
      metadata: {
        uploaded_by: { kind: "client", id: clientId },
        original_filename: `mms-${sid}-${i}`,
        // Who decided the subtype, so a wrong one is traceable to the agent
        // rather than looking like something the client picked.
        classified_by: DOC_AGENT_CODE,
        classification: seen?.reason || null
      }
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
    subtypes.push(document.subtype);
  }

  return { done: registered.length > 0, documents: registered, subtypes };
}

export function register() {
  on("message.inbound", onInboundMmsDocs);
}

export default onInboundMmsDocs;
