import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handle, EMAIL_TEMPLATE_KEY } from "./ds-02-diy-letters.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const DS02_SOURCE_PATH = fileURLToPath(new URL("./ds-02-diy-letters.mjs", import.meta.url));
const BANNED_UIQ_URL = "https://underwrite-iq-lite.vercel.app/api/lite/deliver-letters";

function stripCommentLines(source) {
  return source.split("\n").filter((line) => {
    const t = line.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  }).join("\n");
}

function isBannedLetterUrl(url) {
  const s = String(url || "");
  const envUrl = process.env.UIQ_DELIVER_LETTERS_URL || "";
  if (/vercel\.app/i.test(s)) return true;
  if (/underwrite-iq-lite/i.test(s)) return true;
  if (envUrl && (s === envUrl || s.startsWith(envUrl))) return true;
  if (/deliver-letters/i.test(s) && /^https?:/i.test(s)) return true;
  return false;
}

async function withFetchTrap(fn) {
  const prevFetch = globalThis.fetch;
  const prevUrl = process.env.UIQ_DELIVER_LETTERS_URL;
  const calls = [];
  const trap = (via) => async (...args) => {
    const url = String(args[0]);
    calls.push({ url, via });
    if (isBannedLetterUrl(url)) {
      throw new Error(`DS-02 must not fetch ${via} (${url})`);
    }
    throw new Error(`DS-02 must not fetch (${url})`);
  };
  globalThis.fetch = trap("globalThis.fetch");
  process.env.UIQ_DELIVER_LETTERS_URL = BANNED_UIQ_URL;
  const fetchImpl = trap("fetchImpl");
  try {
    return await fn({ calls, fetchImpl });
  } finally {
    globalThis.fetch = prevFetch;
    if (prevUrl === undefined) delete process.env.UIQ_DELIVER_LETTERS_URL;
    else process.env.UIQ_DELIVER_LETTERS_URL = prevUrl;
  }
}

const withTemplate = () => [{ org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "letters ready", compliance_passed: true }];
const DIY_FILES = [{ filename: "round1_experian.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.4 stub") }];
const stubDiyPack = async () => ({ delivered: true, files: DIY_FILES });
/* These tests assert that letters ARE delivered, so the adapters fence has to be
   named as down. It defaults to blocked (src/lib/dry-run.mjs), and handle()
   takes no env, so the fence reads the process environment. Node runs each test
   file in its own process, so this cannot leak into another file. */
process.env.ADAPTERS_DRY_RUN = "0";

// text() is required: outbound calls now read the body once as text.
const fakeFetch = (ok = true) => async () => ({ ok, status: ok ? 200 : 500, text: async () => "{}" });

// HARD RULE 1 — the whole point of this file: prove BOTH directions.
test("HARD RULE 1 — fires on the not-qualified downsell path (DIY product, non-funding tier)", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: withTemplate() });
  const res = await handle({
    event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 }, { clientId: "cl-1" }),
    db, step: fakeStep(), fetchImpl: fakeFetch(true), deliverPack: stubDiyPack
  });
  assert.equal(res.done, true);
  assert.equal(res.delivery.delivered, true);
  assert.deepEqual(db.clients[0].tags, ["client:diy-letters"]);
  assert.equal(db.clients[0].custom_fields.diy_status, "Delivered");
  assert.equal(db.messages.length, 1);
  assert.equal(db.tasks.length, 1);
});

test("HARD RULE 1 — NEVER fires on the funding route, even for the DIY product name", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }], templates: withTemplate() });
  const res = await handle({
    event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 }, { clientId: "cl-1" }),
    db, step: fakeStep(), fetchImpl: fakeFetch(true)
  });
  assert.equal(res.done, false);
  assert.match(res.reason, /^blocked_not_repair_only:/);
  assert.equal(db.messages.length, 0);
  assert.equal(db.tasks.length, 0);
  assert.equal(db.clients[0].tags, undefined, "never tagged client:diy-letters on the funding route");
});

test("HARD RULE 1 — fail-closed: null tier (pre-CRS) must NOT send DIY letters", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }], templates: withTemplate() });
  const res = await handle({
    event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 }, { clientId: "cl-1" }),
    db, step: fakeStep(), fetchImpl: fakeFetch(true)
  });
  assert.equal(res.done, false);
  assert.match(res.reason, /blocked_not_repair_only:null/);
  assert.equal(db.messages.length, 0, "no email on null tier");
  assert.equal(db.tasks.length, 0, "no task on null tier");
});

test("HARD RULE 1 — fail-closed: unrecognized tier must NOT send DIY letters", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FRAUD_HOLD", custom_fields: {} }], templates: withTemplate() });
  const res = await handle({
    event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 }, { clientId: "cl-1" }),
    db, step: fakeStep(), fetchImpl: fakeFetch(true)
  });
  assert.equal(res.done, false);
  assert.match(res.reason, /blocked_not_repair_only:FRAUD_HOLD/);
  assert.equal(db.messages.length, 0, "no email on unrecognized tier");
  assert.equal(db.tasks.length, 0, "no task on unrecognized tier");
});

test("branch: non-DIY product is ignored regardless of path", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY" }], templates: withTemplate() });
  const res = await handle({ event: ev("payment.received", { productName: "Consulting Services Deposit", amount: 3000 }, { clientId: "cl-1" }), db, step: fakeStep(), fetchImpl: fakeFetch(true) });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_diy_product");
});

test("branch: letter delivery failure still tags + tasks, marks status for retry", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: withTemplate() });
  const res = await handle({
    event: ev("payment.received", { productName: "Consulting Services Package" }, { clientId: "cl-1" }),
    db, step: fakeStep(),
    deliverPack: async () => ({ delivered: false, files: [], reason: "forced_fail" })
  });
  assert.equal(res.delivery.delivered, false);
  assert.equal(db.clients[0].custom_fields.diy_status, "Delivery Failed — Retry");
});

test("repair pack with 0 letters does not send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: withTemplate() });
  const res = await handle({
    event: ev("payment.received", { productName: "Consulting Services Package" }, { clientId: "cl-1" }),
    db, step: fakeStep(),
    deliverPack: async () => ({ delivered: true, files: [] })
  });
  assert.equal(res.delivery.delivered, false);
  assert.equal(res.email.sent, false);
  assert.equal(res.email.reason, "no_letter_pack");
  assert.equal(db.messages.length, 0);
  assert.equal(db.clients[0].custom_fields.diy_status, "Delivery Failed — Retry");
});

test("missing client does not throw and does not send", async () => {
  const db = pgFake({ templates: withTemplate() });
  const res = await handle({
    event: ev("payment.received", { productName: "Consulting Services Package" }, { clientId: null }),
    db, step: fakeStep(), deliverPack: stubDiyPack
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_client");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying the same event does not double-send, double-task, or double-tag", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: withTemplate() });
  const event = ev("payment.received", { productName: "Consulting Services Package" }, { id: "evt-dup-ds02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep(), deliverPack: stubDiyPack });
  await handle({ event, db, step: fakeStep(), deliverPack: stubDiyPack });
  assert.equal(db.messages.length, 1);
  assert.equal(db.tasks.length, 1);
  assert.deepEqual(db.clients[0].tags, ["client:diy-letters"]);
});

test("source: DS-02 has no Vercel / UIQ deliver-letters POST", () => {
  const raw = readFileSync(DS02_SOURCE_PATH, "utf8");
  assert.ok(raw.includes("deliver-letters"), "canary: DS-02 source was actually read");
  const code = stripCommentLines(raw);
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\bglobalThis\.fetch\b/);
  assert.doesNotMatch(code, /\bpostJsonTo\b/);
  assert.doesNotMatch(code, /outbound-fetch/);
  assert.doesNotMatch(code, /DELIVER_LETTERS/);
  assert.doesNotMatch(code, /UIQ_DELIVER/);
  assert.doesNotMatch(code, /vercel\.app/i);
  assert.doesNotMatch(code, /underwrite-iq-lite/);
  assert.doesNotMatch(code, /deliverLettersUiq/);
});

test("empty repair pack does not fetch vercel.app or UIQ_DELIVER_LETTERS_URL and does not email", async () => {
  await withFetchTrap(async ({ fetchImpl, calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: withTemplate() });
    const res = await handle({
      event: ev("payment.received", { productName: "Consulting Services Package" }, { clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl,
      deliverPack: async () => ({ delivered: true, files: [] })
    });
    assert.equal(res.delivery.delivered, false);
    assert.equal(res.email.sent, false);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0, "handle must not call fetch even when UIQ_DELIVER_LETTERS_URL is set");
    assert.equal(calls.some((c) => isBannedLetterUrl(c.url)), false);
  });
});

test("in-repo pack with 0 PDFs (no deliverPack stub) does not POST Vercel and does not email", async () => {
  await withFetchTrap(async ({ fetchImpl, calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: withTemplate() });
    const res = await handle({
      event: ev("payment.received", { productName: "Consulting Services Package" }, { clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl
    });
    assert.equal(res.done, true);
    assert.equal(res.delivery.delivered, false);
    assert.equal(res.email.sent, false);
    assert.match(res.email.reason, /^(no_letter_pack|no_client|empty_pack)$/);
    assert.equal(db.messages.length, 0);
    assert.equal(db.clients[0].custom_fields.diy_status, "Delivery Failed — Retry");
    assert.equal(calls.length, 0, "empty in-repo pack must not last-resort POST vercel.app");
    assert.equal(calls.some((c) => isBannedLetterUrl(c.url)), false);
  });
});

test("happy path with UIQ_DELIVER_LETTERS_URL set still does not fetch", async () => {
  await withFetchTrap(async ({ fetchImpl, calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }], templates: withTemplate() });
    const res = await handle({
      event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 }, { clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl, deliverPack: stubDiyPack
    });
    assert.equal(res.delivery.delivered, true);
    assert.equal(db.messages.length, 1);
    assert.equal(calls.length, 0, "in-repo pack must not fetch vercel.app or UIQ_DELIVER_LETTERS_URL");
  });
});

test("funding-path DIY product does not fetch vercel.app even when UIQ_DELIVER_LETTERS_URL is set", async () => {
  await withFetchTrap(async ({ fetchImpl, calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }], templates: withTemplate() });
    const res = await handle({
      event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 }, { clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl
    });
    assert.equal(res.done, false);
    assert.match(res.reason, /^blocked_not_repair_only:/);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
    assert.equal(calls.some((c) => isBannedLetterUrl(c.url)), false);
  });
});
