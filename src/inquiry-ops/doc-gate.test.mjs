import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockingFundingHold, FUNDING_DOC_HOLD, FUNDING_PAUSED_HOLD } from "./doc-gate.mjs";

test("isBlockingFundingHold is the two named hold reasons only", () => {
  assert.equal(isBlockingFundingHold(FUNDING_DOC_HOLD), true);
  assert.equal(isBlockingFundingHold(FUNDING_PAUSED_HOLD), true);
  assert.equal(isBlockingFundingHold("Missing Documents"), false);
  assert.equal(isBlockingFundingHold(null), false);
});

/* ── the signature the desk could not see ──────────────────────────────────
 * Measured 2026-09-06 on the funding walkthrough client: the client signed the
 * dispute authorization at 03:04 and the Inquiry desk reported the signed
 * authorization missing, and would have reported it missing forever.
 *
 * Signing writes ONE row and it is not a document. api/consent/capture.mjs
 * writes into client_consents; this packet only ever read the documents table.
 * Two doors, one signature, and the desk was standing at the wrong door.
 */
import {
  checkDocPacket, loadDocPackets, loadSignedAuthorizations, hasSignedAuthorization,
  evaluateDocGate, AUTHORIZATION_CONSENT_KINDS
} from "./doc-gate.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

const ID_AND_ADDRESS = [
  { client_id: CLIENT, kind: "client_upload", subtype: "id_document" },
  { client_id: CLIENT, kind: "client_upload", subtype: "proof_of_address" }
];

test("checkDocPacket: identification and address alone are short a signature", () => {
  const r = checkDocPacket(ID_AND_ADDRESS);
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, ["authorization"]);
});

test("checkDocPacket: a signature filed as a consent completes the packet", () => {
  const r = checkDocPacket(ID_AND_ADDRESS, { signedAuthorization: true });
  assert.equal(r.complete, true);
  assert.deepEqual(r.missing, []);
  assert.equal(r.present.authorization, true);
});

test("checkDocPacket: the consent flag does not paper over anything else", () => {
  const r = checkDocPacket([], { signedAuthorization: true });
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, ["id_document", "proof_of_address"]);
});

test("the two consent kinds that count as a signed authorization, and no others", () => {
  assert.deepEqual([...AUTHORIZATION_CONSENT_KINDS],
    ["dispute_authorization", "soft_pull_consent"]);
});

function consentDb({ consents = [], documents = [], throwOn = null } = {}) {
  return {
    calls: [],
    async query(sql, params) {
      const s = String(sql).replace(/\s+/g, " ");
      this.calls.push({ s, params });
      if (throwOn && s.includes(throwOn)) throw new Error("read failed");
      if (s.includes("FROM client_consents")) return { rows: consents };
      if (s.includes("FROM documents")) return { rows: documents };
      return { rows: [] };
    }
  };
}

test("loadSignedAuthorizations asks client_consents, scoped to the org, for both kinds", async () => {
  const db = consentDb({ consents: [{ client_id: CLIENT }] });
  const found = await loadSignedAuthorizations(db, { orgId: ORG, clientIds: [CLIENT] });
  assert.equal(found.has(CLIENT), true);
  const call = db.calls[0];
  assert.match(call.s, /FROM client_consents/);
  assert.match(call.s, /org_id = \$1::uuid/);
  assert.equal(call.params[0], ORG);
  assert.deepEqual(call.params[2], ["dispute_authorization", "soft_pull_consent"]);
  // the validity rule is imported, not retyped — revoked and expired rows are excluded
  assert.match(call.s, /revoked_at IS NULL/);
  assert.match(call.s, /expires_at IS NULL OR expires_at > now\(\)/);
});

test("loadSignedAuthorizations returns null when the consent read fails", async () => {
  const db = consentDb({ throwOn: "FROM client_consents" });
  assert.equal(await loadSignedAuthorizations(db, { orgId: ORG, clientIds: [CLIENT] }), null);
});

test("hasSignedAuthorization fails closed — a failed read is not a signature", async () => {
  const db = consentDb({ throwOn: "FROM client_consents" });
  assert.equal(await hasSignedAuthorization(db, { orgId: ORG, clientId: CLIENT }), false);
});

test("evaluateDocGate: the walkthrough client's packet is complete once the consent counts", async () => {
  const db = consentDb({ documents: ID_AND_ADDRESS, consents: [{ client_id: CLIENT }] });
  const r = await evaluateDocGate(db, { orgId: ORG, clientId: CLIENT, items: [] });
  assert.equal(r.complete, true, "the signature exists — the desk must stop asking for it");
});

test("evaluateDocGate: no consent row and no authorization document is still short", async () => {
  const db = consentDb({ documents: ID_AND_ADDRESS, consents: [] });
  const r = await evaluateDocGate(db, { orgId: ORG, clientId: CLIENT, items: [] });
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, ["authorization"]);
});

test("loadDocPackets counts the consent for the queue, one client at a time", async () => {
  const db = consentDb({ documents: ID_AND_ADDRESS, consents: [{ client_id: CLIENT }] });
  const packets = await loadDocPackets(db, { orgId: ORG, clientIds: [CLIENT, "other"] });
  assert.equal(packets.get(CLIENT).complete, true);
  assert.equal(packets.get("other").complete, false, "a client with nothing on file is not complete");
});

test("loadDocPackets says 'we could not look' rather than 'they never signed'", async () => {
  const db = consentDb({ documents: ID_AND_ADDRESS, throwOn: "FROM client_consents" });
  assert.equal(await loadDocPackets(db, { orgId: ORG, clientIds: [CLIENT] }), null);
});
