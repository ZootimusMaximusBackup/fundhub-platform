import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFromCrsResult } from "./extract-disputables.mjs";
import { renderLetterDraft } from "./letter-draft.mjs";
import { checkDocPacket, disputeNeedsSsn } from "./doc-gate.mjs";

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
