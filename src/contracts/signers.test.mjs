// The signing order.
//
// THE RULE UNDER TEST: under a sequential contract, signer 2 cannot sign until
// signer 1 has. Not "the button is hidden" — refused. The database-backed half
// of this is in esign.pg.test.mjs; these are the pure decisions the endpoint and
// the screen both ask, and getting one of them backwards means somebody signs
// out of turn or a finished contract never reports itself finished.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  normaliseSigners, turnOf, canSign, allSigned, waitingSummary, publicSignerList
} from "./signers.mjs";

const S = (i, status, over = {}) => ({
  id: `s${i}`, signer_index: i, role_label: i === 0 ? "Client" : `Signer ${i + 1}`,
  name: `Person ${i}`, email: `p${i}@x.test`, status, signed_at: status === "signed" ? "2026-08-02" : null,
  ...over
});

describe("normaliseSigners", () => {
  test("the ORDER IS THE POSITION IN THE LIST, never a number anybody types", () => {
    const out = normaliseSigners([{ name: "A" }, { name: "B" }, { name: "C" }]);
    assert.deepEqual(out.map((s) => s.signer_index), [0, 1, 2]);
    // A hand-typed order is a chance to write two 1s and no 2, and then routing
    // has to pick one arbitrarily — a coin toss deciding who signs first.
    const ignored = normaliseSigners([{ name: "A", signer_index: 9 }, { name: "B", signer_index: 9 }]);
    assert.deepEqual(ignored.map((s) => s.signer_index), [0, 1]);
  });

  test("names the roles when nobody did", () => {
    const out = normaliseSigners([{ name: "A" }, { name: "B" }]);
    assert.deepEqual(out.map((s) => s.role_label), ["Client", "Signer 2"]);
  });

  test("refuses a signer with no name", () => {
    assert.throws(() => normaliseSigners([{ name: "  " }]), /has no name/);
  });

  test("refuses an empty party and an absurdly large one", () => {
    assert.throws(() => normaliseSigners([]), /at least one person/);
    assert.throws(() => normaliseSigners(new Array(11).fill({ name: "A" })), /at most 10/);
  });

  test("checks the shape of an email but allows none at all", () => {
    assert.throws(() => normaliseSigners([{ name: "A", email: "not-an-email" }]), /does not look like/);
    assert.equal(normaliseSigners([{ name: "A" }])[0].email, null);
    assert.equal(normaliseSigners([{ name: "A", email: "a@b.co" }])[0].email, "a@b.co");
  });
});

describe("turnOf — who is being waited on", () => {
  test("the lowest position that has not finished", () => {
    assert.equal(turnOf([S(0, "signed"), S(1, "sent"), S(2, "pending")]), 1);
  });
  test("null when everybody has finished", () => {
    assert.equal(turnOf([S(0, "signed"), S(1, "signed")]), null);
  });
  test("a declined signer does not hold the queue open", () => {
    assert.equal(turnOf([S(0, "declined"), S(1, "signed")]), null);
  });
});

describe("canSign — the refusal", () => {
  const party = () => [S(0, "sent"), S(1, "sent"), S(2, "pending")];

  test("SIGNER 2 CANNOT SIGN BEFORE SIGNER 1, and is told who they are waiting for", () => {
    const p = party();
    const v = canSign(p[1], p, "sequential");
    assert.equal(v.ok, false);
    assert.equal(v.reason, "not_your_turn");
    assert.equal(v.waitingOn, "Person 0");
    assert.equal(v.waitingOnRole, "Client");
  });

  test("signer 1 may sign straight away", () => {
    const p = party();
    assert.equal(canSign(p[0], p, "sequential").ok, true);
  });

  test("once signer 1 has signed, signer 2 may", () => {
    const p = [S(0, "signed"), S(1, "sent")];
    assert.equal(canSign(p[1], p, "sequential").ok, true);
  });

  test("a declined signer ahead does not block the rest — the contract is dead anyway", () => {
    const p = [S(0, "declined"), S(1, "sent")];
    assert.equal(canSign(p[1], p, "sequential").ok, false, "an unsigned signer ahead still blocks");
  });

  test("under a parallel contract everybody's turn is now", () => {
    const p = party();
    assert.equal(canSign(p[2], p, "parallel").ok, true);
  });

  test("somebody who has already signed cannot sign again", () => {
    const p = [S(0, "signed")];
    assert.equal(canSign(p[0], p, "sequential").reason, "already_signed");
  });

  test("a signer who declined cannot then sign", () => {
    const p = [S(0, "declined")];
    assert.equal(canSign(p[0], p, "sequential").reason, "declined");
  });

  test("an unknown signer is refused rather than defaulted", () => {
    assert.equal(canSign(null, party(), "sequential").ok, false);
  });
});

describe("allSigned — when a contract is really finished", () => {
  test("true only when every single person has signed", () => {
    assert.equal(allSigned([S(0, "signed"), S(1, "signed")]), true);
    assert.equal(allSigned([S(0, "signed"), S(1, "viewed")]), false);
    // A declined signer means the contract is NOT complete. Treating it as done
    // would produce a "signed" contract one party refused.
    assert.equal(allSigned([S(0, "signed"), S(1, "declined")]), false);
  });
  test("an empty party is never complete", () => {
    assert.equal(allSigned([]), false);
    assert.equal(allSigned(null), false);
  });
});

describe("waitingSummary — what the CRM prints", () => {
  test("names the next person under a sequential contract", () => {
    const out = waitingSummary([S(0, "signed"), S(1, "sent"), S(2, "pending")], "sequential");
    assert.equal(out.name, "Person 1");
    assert.equal(out.remaining, 2);
  });
  test("lists everybody outstanding under a parallel one", () => {
    const out = waitingSummary([S(0, "sent"), S(1, "sent")], "parallel");
    assert.equal(out.name, "Person 0, Person 1");
  });
  test("null when nobody is left", () => {
    assert.equal(waitingSummary([S(0, "signed")], "sequential"), null);
  });
});

describe("publicSignerList — what one signer may know about the others", () => {
  test("names and states only — never an email address or a link", () => {
    const out = publicSignerList([S(0, "signed"), S(1, "sent")]);
    assert.deepEqual(Object.keys(out[0]).sort(), ["name", "role_label", "signed_at", "status"]);
    assert.equal(JSON.stringify(out).includes("@x.test"), false,
      "one signer must not be handed another's email address");
    assert.equal(JSON.stringify(out).includes("s0"), false,
      "one signer must not be handed another's signer id");
  });
});
