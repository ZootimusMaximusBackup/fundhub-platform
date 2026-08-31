import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFromCrsResult } from "./extract-disputables.mjs";
import { renderLetterDraft } from "./letter-draft.mjs";
import { checkDocPacket, disputeNeedsSsn, loadDocPackets } from "./doc-gate.mjs";

test("extractFromCrsResult: inquiries grouped per bureau", () => {
  const buckets = extractFromCrsResult({
    normalized: {
      inquiries: [
        { creditorName: "Capital One", source: "ex", date: "2024-01-15" },
        { creditorName: "Chase", source: "tu", date: "2024-02-01" }
      ]
    }
  });
  assert.equal(buckets.EX.inquiries.length, 1);
  assert.equal(buckets.TU.inquiries.length, 1);
  assert.equal(buckets.EQ.inquiries.length, 0);
});

test("extractFromCrsResult: personal-info mismatches", () => {
  const buckets = extractFromCrsResult({
    personalInfo: {
      EX: {
        names: ["John A Smith"],
        formerAddresses: ["1 Old St"],
        formerEmployers: ["Acme"]
      }
    }
  });
  assert.equal(buckets.EX.pii.length, 3);
});

test("renderLetterDraft: varies by client and includes statute cite", () => {
  const a = renderLetterDraft({
    client: { first_name: "Ada", last_name: "Lovelace", email: "a@x.com" },
    bureau: "EX",
    inquiries: [{ inquiry_name: "Bank A", inquiry_date: "2024-01-01" }],
    pii: [{ category: "name", value: "Ada B Lovelace" }],
    today: "2026-08-06"
  });
  const b = renderLetterDraft({
    client: { first_name: "Grace", last_name: "Hopper", email: "g@x.com" },
    bureau: "TU",
    inquiries: [{ inquiry_name: "Bank B", inquiry_date: "2024-02-01" }],
    pii: [],
    today: "2026-08-06"
  });
  assert.match(a, /§1681i/);
  assert.match(a, /Capital One|Bank A|Ada/);
  assert.notEqual(a, b);
});

test("checkDocPacket: incomplete until all required present", () => {
  assert.equal(checkDocPacket([]).complete, false);
  const complete = checkDocPacket([
    { kind: "client_upload", subtype: "id_document" },
    { kind: "client_upload", subtype: "proof_of_address" },
    { kind: "authorization", subtype: "soft_pull_consent" }
  ]);
  assert.equal(complete.complete, true);
});

/* Hole 17 opened an inquiry upload door on the client portal, and the packet
   gate did not count what came through it — the client sent their ID and the
   case still said the ID was missing. These pin that the door and the gate
   agree, so it cannot silently come apart again. */

test("checkDocPacket: an ID sent through the inquiry door counts as the ID", () => {
  const complete = checkDocPacket([
    { kind: "inquiry_doc", subtype: "id_document" },
    { kind: "client_upload", subtype: "proof_of_address" },
    { kind: "authorization", subtype: "soft_pull_consent" }
  ]);
  assert.equal(complete.complete, true,
    "hole 17 opened the inquiry door; a photo ID that arrives through it is still a photo ID");
  assert.equal(complete.present.id_document, true);
});

test("checkDocPacket: an untyped inquiry upload still does not complete the packet", () => {
  // The portal defaults an unanswered type picker to "other". That must not
  // count as an ID — otherwise the gate passes on a file nobody identified.
  const res = checkDocPacket([
    { kind: "inquiry_doc", subtype: "other" },
    { kind: "authorization", subtype: "soft_pull_consent" }
  ]);
  assert.equal(res.complete, false);
  assert.deepEqual(res.missing, ["id_document", "proof_of_address"]);
});

test("checkDocPacket: SSN required only when opted in", () => {
  const docs = [
    { kind: "client_upload", subtype: "id_document" },
    { kind: "client_upload", subtype: "bank_statement" },
    { kind: "authorization", subtype: "soft_pull_consent" }
  ];
  assert.equal(checkDocPacket(docs).complete, true);
  assert.equal(checkDocPacket(docs, { requireSsn: true }).complete, false);
  assert.equal(disputeNeedsSsn([{ category: "ssn", value: "xxx" }]), true);
});

/* ── loadDocPackets — the same answer, for a whole queue, in one query ──────
 *
 * The Specialist's case list needs the identity packet per row, and the screen
 * used to invent it: it printed "complete" for every case that was not already
 * Blocked, and Blocked is only set at send time. So a packet nobody had looked
 * at read "complete" on the screen that decides whether to press Send.
 *
 * The point of these three tests is the last one. A failed read must come back
 * as NULL, so the caller says "not checked" — never "complete".
 */

function fakeDb(rows, { fail = false } = {}) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      if (fail) throw new Error("relation \"documents\" does not exist");
      return { rows };
    }
  };
}

test("loadDocPackets: one query for the page, grouped per client", async () => {
  const A = "aaaaaaaa-1111-4111-8111-111111111111";
  const B = "bbbbbbbb-2222-4222-8222-222222222222";
  const db = fakeDb([
    { client_id: A, kind: "client_upload", subtype: "id_document" },
    { client_id: A, kind: "client_upload", subtype: "proof_of_address" },
    { client_id: A, kind: "authorization", subtype: "soft_pull_consent" },
    { client_id: B, kind: "client_upload", subtype: "id_document" }
  ]);
  const out = await loadDocPackets(db, { orgId: "org-1", clientIds: [A, B] });
  assert.equal(db.calls.length, 1, "one lift for the whole page, not one per row");
  assert.equal(out.get(A).complete, true);
  assert.equal(out.get(B).complete, false);
  assert.deepEqual(out.get(B).missing, ["proof_of_address", "authorization"]);
});

test("loadDocPackets: a client with no documents is answered, not skipped", async () => {
  const A = "aaaaaaaa-1111-4111-8111-111111111111";
  const out = await loadDocPackets(fakeDb([]), { orgId: "org-1", clientIds: [A] });
  assert.equal(out.get(A).complete, false);
  // and nothing to ask about asks nothing
  assert.equal((await loadDocPackets(fakeDb([]), { orgId: "org-1", clientIds: [] })).size, 0);
});

test("loadDocPackets: a failed read is null, so nothing can read as complete", async () => {
  // "We could not look" and "we looked and it is short" are different sentences
  // to the person deciding whether to mail a dispute letter. A thrown query that
  // came back as an empty Map would have quietly said "chasing" for everyone;
  // one that came back as a populated Map would have said "complete".
  const out = await loadDocPackets(fakeDb([], { fail: true }), {
    orgId: "org-1",
    clientIds: ["aaaaaaaa-1111-4111-8111-111111111111"]
  });
  assert.equal(out, null);
});
