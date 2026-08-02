// The boxes on the page — where they are, who fills them, and what a signer is
// allowed to write into them.
//
// THE POSITION RULE IS THE ONE TO PROTECT. A box is stored as fractions of its
// page, from the top left. If that ever silently becomes pixels, every contract
// still renders in the editor and every signature lands in the wrong place on
// the finished PDF — which nobody notices until a client asks why they signed
// the margin. These tests pin the arithmetic and the refusals around it.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  FIELD_TYPES, SIGNING_TYPES, FIELD_SOURCES, normaliseFields, applyAutoFill,
  fieldsForSigner, openFieldsForSigner, missingForSigner, mergeSignerValues, assertSignable
} from "./fields.mjs";

const box = (over = {}) => ({
  id: "f1", page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.04,
  type: "text", signer: 0, source: "manual", label: "Name", ...over
});

describe("normaliseFields — what a valid box is", () => {
  test("keeps a good box and fills in the defaults", () => {
    const [f] = normaliseFields([{ page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.03, type: "date" }]);
    assert.equal(f.id, "f1");
    assert.equal(f.type, "date");
    assert.equal(f.signer, 0);
    assert.equal(f.source, "manual");
    assert.equal(f.required, true);
    assert.equal(f.label, "Date");
  });

  test("accepts the jsonb column as a string, and null as no boxes", () => {
    assert.equal(normaliseFields('[{"id":"a","page":0,"x":0,"y":0,"w":0.1,"h":0.1}]').length, 1);
    assert.deepEqual(normaliseFields(null), []);
  });

  /* ── the position rules ─────────────────────────────────────────────────── */

  test("refuses a position outside 0..1 — that is a pixel value leaking in", () => {
    for (const k of ["x", "y", "w", "h"]) {
      assert.throws(() => normaliseFields([box({ [k]: 42 })]), /fraction of the page/,
        `${k}=42 should have been refused`);
      assert.throws(() => normaliseFields([box({ [k]: -0.1 })]), /fraction of the page/);
    }
  });

  test("refuses a box that hangs off the edge — half a signature is not a signature", () => {
    assert.throws(() => normaliseFields([box({ x: 0.9, w: 0.3 })]), /hangs off the edge/);
    assert.throws(() => normaliseFields([box({ y: 0.98, h: 0.1 })]), /hangs off the edge/);
  });

  test("a box that ends exactly at the edge is fine", () => {
    assert.equal(normaliseFields([box({ x: 0.7, w: 0.3 })]).length, 1);
  });

  test("refuses a box with no size", () => {
    assert.throws(() => normaliseFields([box({ w: 0 })]), /no size/);
  });

  test("refuses a page that does not exist in the document", () => {
    assert.throws(() => normaliseFields([box({ page: 5 })], { pageCount: 2 }),
      /only has 2/);
    assert.equal(normaliseFields([box({ page: 1 })], { pageCount: 2 }).length, 1);
  });

  test("refuses a signer the contract does not have", () => {
    assert.throws(() => normaliseFields([box({ signer: 3 })], { signerCount: 2 }),
      /only has 2/);
  });

  /* ── the kind and the source ────────────────────────────────────────────── */

  test("refuses an unknown kind of box", () => {
    assert.throws(() => normaliseFields([box({ type: "fingerprint" })]), /kind we do not have/);
    for (const t of FIELD_TYPES) assert.equal(normaliseFields([box({ type: t })])[0].type, t);
  });

  test("refuses a source nothing supplies", () => {
    assert.throws(() => normaliseFields([box({ source: "moon.phase" })]), /does not exist/);
    for (const s of FIELD_SOURCES) assert.equal(normaliseFields([box({ source: s })])[0].source, s);
    assert.equal(normaliseFields([box({ source: "contact.anything" })])[0].source, "contact.anything");
  });

  /* THE MOST IMPORTANT REFUSAL IN THIS FILE. A signature that could be
     auto-filled would mean the CRM typing somebody's signature on their behalf,
     which is not a signature at all. */
  test("A SIGNATURE CANNOT BE FILLED IN FOR SOMEBODY", () => {
    for (const t of SIGNING_TYPES) {
      assert.throws(() => normaliseFields([box({ type: t, source: "contact.full_name" })]),
        /filled in by the person signing/);
      assert.throws(() => normaliseFields([box({ type: t, source: "today" })]),
        /filled in by the person signing/);
      assert.equal(normaliseFields([box({ type: t, source: "manual" })])[0].type, t);
    }
  });

  test("refuses two boxes with the same name", () => {
    assert.throws(() => normaliseFields([box(), box()]), /share the name/);
  });

  test("refuses a shape the editor could not render", () => {
    assert.throws(() => normaliseFields({ id: "a" }), /stored wrongly/);
    assert.throws(() => normaliseFields(["a"]), /stored wrongly/);
  });
});

describe("applyAutoFill — everything the CRM already knows", () => {
  const contact = { full_name: "Ada Lovelace", email: "ada@example.com", phone: "" };
  const signers = [{ name: "Ada Lovelace", email: "ada@example.com" }, { name: "Bo Lender", email: "bo@x.test" }];
  const run = (fields) => applyAutoFill(normaliseFields(fields), { contact, signers, today: "2026-08-02" });

  test("fills from the client record", () => {
    assert.equal(run([box({ source: "contact.full_name" })])[0].value, "Ada Lovelace");
  });

  test("fills today's date", () => {
    assert.equal(run([box({ type: "date", source: "today" })])[0].value, "2026-08-02");
  });

  test("fills that signer's own name and email — not the first signer's", () => {
    const out = run([
      box({ id: "a", source: "signer.name", signer: 1 }),
      box({ id: "b", source: "signer.email", signer: 1, x: 0.5 })
    ]);
    assert.equal(out[0].value, "Bo Lender");
    assert.equal(out[1].value, "Bo Lender" && "bo@x.test");
  });

  test("a manual box is left alone", () => {
    assert.equal(run([box({ source: "manual", value: "" })])[0].value, "");
  });

  test("an unknown contact field fills blank rather than the word undefined", () => {
    assert.equal(run([box({ source: "contact.nope" })])[0].value, "");
  });

  test("a client field that exists but is empty fills blank", () => {
    assert.equal(run([box({ source: "contact.phone" })])[0].value, "");
  });
});

describe("who sees and fills what", () => {
  const fields = normaliseFields([
    box({ id: "a", signer: 0 }),
    box({ id: "b", signer: 1, x: 0.5 }),
    box({ id: "c", signer: 0, y: 0.4, source: "contact.full_name" }),
    box({ id: "sig", signer: 0, y: 0.6, type: "signature" })
  ]);

  test("a signer only ever sees their own boxes", () => {
    assert.deepEqual(fieldsForSigner(fields, 0).map((f) => f.id), ["a", "c", "sig"]);
    assert.deepEqual(fieldsForSigner(fields, 1).map((f) => f.id), ["b"]);
  });

  test("auto-filled boxes are not theirs to type into", () => {
    assert.deepEqual(openFieldsForSigner(fields, 0).map((f) => f.id), ["a", "sig"]);
  });

  test("a signature box is not asked for separately — typing your name is signing", () => {
    assert.deepEqual(missingForSigner(fields, 0, {}), ["Name"]);        // "a" only, not "sig"
    assert.deepEqual(missingForSigner(fields, 0, { a: "x" }), []);
  });

  test("a required tick box has to be ticked", () => {
    const withChk = normaliseFields([box({ id: "t", type: "checkbox", label: "I agree" })]);
    assert.deepEqual(missingForSigner(withChk, 0, {}), ["I agree"]);
    assert.deepEqual(missingForSigner(withChk, 0, { t: "true" }), []);
    assert.deepEqual(missingForSigner(withChk, 0, { t: true }), []);
  });

  test("an optional box is never demanded", () => {
    const opt = normaliseFields([box({ id: "o", required: false })]);
    assert.deepEqual(missingForSigner(opt, 0, {}), []);
  });
});

describe("mergeSignerValues — what a signer may write", () => {
  const fields = normaliseFields([
    box({ id: "mine", signer: 0 }),
    box({ id: "theirs", signer: 1, x: 0.5 }),
    box({ id: "auto", signer: 0, y: 0.4, source: "contact.full_name" })
  ]);

  /* THE ONE THAT MATTERS. A client posting values for the sender's fee box, or
     for the other party's boxes, must change nothing at all. */
  test("A SIGNER CANNOT WRITE INTO SOMEBODY ELSE'S BOX", () => {
    const out = mergeSignerValues(fields, 0, { mine: "ok", theirs: "FORGED" });
    assert.equal(out.find((f) => f.id === "mine").value, "ok");
    assert.equal(out.find((f) => f.id === "theirs").value, "");
  });

  test("and cannot overwrite a box the CRM filled in for them", () => {
    const filled = applyAutoFill(fields, { contact: { full_name: "Ada Lovelace" }, signers: [] });
    const out = mergeSignerValues(filled, 0, { auto: "Somebody Else" });
    assert.equal(out.find((f) => f.id === "auto").value, "Ada Lovelace");
  });

  test("a tick box stores a real yes or a real blank, never a stray string", () => {
    const chk = normaliseFields([box({ id: "t", type: "checkbox" })]);
    assert.equal(mergeSignerValues(chk, 0, { t: "on" })[0].value, "true");
    assert.equal(mergeSignerValues(chk, 0, { t: "nope" })[0].value, "");
  });

  test("a very long value is cut rather than stored whole", () => {
    const out = mergeSignerValues(fields, 0, { mine: "x".repeat(5000) });
    assert.equal(out.find((f) => f.id === "mine").value.length, 500);
  });

  test("a box the payload does not mention keeps what it had", () => {
    const seeded = fields.map((f) => (f.id === "mine" ? { ...f, value: "kept" } : f));
    assert.equal(mergeSignerValues(seeded, 0, {}).find((f) => f.id === "mine").value, "kept");
  });
});

describe("assertSignable — everybody has somewhere to sign", () => {
  test("refuses a contract where a signer has no signature box", () => {
    const fields = normaliseFields([box({ id: "s0", type: "signature", signer: 0 })]);
    assert.throws(() => assertSignable(fields, 2), /Signer 2 has nowhere to sign/);
  });

  test("passes when every signer has one", () => {
    const fields = normaliseFields([
      box({ id: "s0", type: "signature", signer: 0 }),
      box({ id: "s1", type: "signature", signer: 1, x: 0.5 })
    ]);
    assert.equal(assertSignable(fields, 2), true);
  });

  test("initials count as somewhere to sign", () => {
    assert.equal(assertSignable(normaliseFields([box({ type: "initials" })]), 1), true);
  });
});
