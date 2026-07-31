/* Tests for src/http/inquiry-remover-view.mjs — the Inquiry Remover's write
 * path and PII reveal, as pure functions.
 *
 * WHY THESE TESTS EXIST AT ALL. The screen is a static page and there is no
 * browser harness in this repo; npm test globs src/** and scripts/** only, so a
 * test placed under public/ or api/ would silently never run. The logic that
 * decides whether a consumer's credit-report action is shown as having happened
 * therefore lives in a module here, and the screen carries a verbatim copy of
 * it. The last two tests are what makes that copy safe: they read
 * public/app/inquiry-remover.html and fail if it has drifted a character.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  ATTEMPT_KINDS, COUNTING_KINDS, ViewError, isUuid, blankToNull, pill,
  buildAttemptRequest, buildConfirmRequest, buildStatusRequest,
  buildAttemptsRequest, buildIdentityRequest, buildRevealRequest,
  describeFailure, interpretWrite, interpretIdentity, interpretReveal,
  maskedSsnLabel, canReveal, formatRevealed,
  createRowState, beginWrite, settleWrite, failWrite,
  attemptsDelta, attemptLine, formatWhen, interpretAttempts, pendingLabel, VIEW
} from "./inquiry-remover-view.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.resolve(HERE, "inquiry-remover-view.mjs");
const HTML_PATH = path.resolve(HERE, "../../public/app/inquiry-remover.html");

const ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const CLIENT = "9c858901-8a57-4791-81fe-4c455b099bc9";

/* ── the kinds ─────────────────────────────────────────────────────────────── */

test("ATTEMPT_KINDS is exactly the four kinds migration 055's CHECK constraint allows", () => {
  assert.deepEqual(ATTEMPT_KINDS, ["call", "letter", "portal", "note"]);
});

test("COUNTING_KINDS excludes 'note', because a working note is not an attempt", () => {
  assert.deepEqual(COUNTING_KINDS, ["call", "letter", "portal"]);
  assert.equal(COUNTING_KINDS.includes("note"), false);
});

/* ── request shaping ───────────────────────────────────────────────────────── */

test("buildAttemptRequest: posts the row's uuid, the action and the chosen kind to /api/inquiries", () => {
  const r = buildAttemptRequest({ inquiryId: ID, kind: "letter" });
  assert.equal(r.method, "POST");
  assert.equal(r.path, "/api/inquiries");
  assert.deepEqual(r.body, { inquiry_id: ID, action: "attempt", kind: "letter" });
});

test("buildAttemptRequest: defaults to a call, the same default the endpoint applies", () => {
  assert.equal(buildAttemptRequest({ inquiryId: ID }).body.kind, "call");
});

test("buildAttemptRequest: a kind the database would reject is refused before it is sent", () => {
  assert.throws(() => buildAttemptRequest({ inquiryId: ID, kind: "email" }), ViewError);
  assert.throws(() => buildAttemptRequest({ inquiryId: ID, kind: "sms" }), /unknown attempt kind/);
});

test("buildAttemptRequest: an empty note is omitted rather than sent as an empty string", () => {
  const r = buildAttemptRequest({ inquiryId: ID, note: "   ", outcome: "" });
  assert.equal("note" in r.body, false);
  assert.equal("outcome" in r.body, false);
});

test("buildAttemptRequest: an outcome the user actually typed is sent, trimmed", () => {
  const r = buildAttemptRequest({ inquiryId: ID, outcome: "  no answer  ", note: "voicemail" });
  assert.equal(r.body.outcome, "no answer");
  assert.equal(r.body.note, "voicemail");
});

test("buildAttemptRequest: a row with no database id is refused rather than posted at a made-up uuid", () => {
  assert.throws(() => buildAttemptRequest({ inquiryId: null }), ViewError);
  assert.throws(() => buildAttemptRequest({ inquiryId: "sample-row-3" }), /must be a uuid/);
  assert.throws(() => buildAttemptRequest({}), /must be a uuid/);
});

test("buildConfirmRequest: sends no status, leaving the server's own default rather than restating it", () => {
  const r = buildConfirmRequest({ inquiryId: ID });
  assert.deepEqual(r.body, { inquiry_id: ID, action: "confirm" });
  assert.equal("status" in r.body, false);
});

test("buildConfirmRequest: a status a human typed is passed through", () => {
  assert.equal(buildConfirmRequest({ inquiryId: ID, status: "Removed by TU" }).body.status, "Removed by TU");
});

test("buildStatusRequest: a blank status is refused — free text does not mean any text", () => {
  assert.throws(() => buildStatusRequest({ inquiryId: ID, status: "   " }), /status is required/);
  assert.throws(() => buildStatusRequest({ inquiryId: ID }), /status is required/);
});

test("buildStatusRequest: names the status action so it cannot be confused with confirm", () => {
  const r = buildStatusRequest({ inquiryId: ID, status: "Awaiting CRS" });
  assert.deepEqual(r.body, { inquiry_id: ID, action: "status", status: "Awaiting CRS" });
});

test("buildAttemptsRequest: reads the row history with a GET, not a write", () => {
  const r = buildAttemptsRequest({ inquiryId: ID });
  assert.equal(r.method, "GET");
  assert.equal(r.path, "/api/inquiries?inquiry_id=" + ID);
  assert.equal(r.body, undefined);
});

test("buildIdentityRequest: the masked read is a GET against /api/pii", () => {
  const r = buildIdentityRequest({ clientId: CLIENT });
  assert.equal(r.method, "GET");
  assert.equal(r.path, "/api/pii?client_id=" + CLIENT);
});

test("buildRevealRequest: a reveal with no reason is refused rather than sent with filler", () => {
  assert.throws(() => buildRevealRequest({ clientId: CLIENT }), /reason is required/);
  assert.throws(() => buildRevealRequest({ clientId: CLIENT, reason: "  " }), /reason is required/);
});

test("buildRevealRequest: the reason and the client id travel in the body, never in the URL", () => {
  const r = buildRevealRequest({ clientId: CLIENT, reason: "TU dispute for inquiry 4491" });
  assert.equal(r.method, "POST");
  assert.equal(r.path, "/api/pii");
  assert.equal(r.path.includes("?"), false);
  assert.deepEqual(r.body, {
    client_id: CLIENT, action: "reveal", reason: "TU dispute for inquiry 4491"
  });
});

test("buildRevealRequest: a client id that is not a uuid is refused", () => {
  assert.throws(() => buildRevealRequest({ clientId: "wei-chen", reason: "x" }), /must be a uuid/);
});

test("blankToNull: whitespace-only input is nothing, not a value", () => {
  assert.equal(blankToNull("  "), null);
  assert.equal(blankToNull(""), null);
  assert.equal(blankToNull(null), null);
  assert.equal(blankToNull(undefined), null);
  assert.equal(blankToNull(" note "), "note");
});

test("isUuid: only a real uuid passes", () => {
  assert.equal(isUuid(ID), true);
  assert.equal(isUuid(ID.toUpperCase()), true);
  assert.equal(isUuid("3f2504e0-4f89-11d3-9a0c"), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(42), false);
});

/* ── status pills ──────────────────────────────────────────────────────────── */

test("pill: an unmapped status keeps its real text on a neutral pill rather than being guessed", () => {
  const p = pill("Awaiting CRS", null);
  assert.equal(p.text, "Awaiting CRS");
  assert.equal(p.cls, "");
  assert.equal(p.known, false);
  assert.equal(p.done, false);
});

test("pill: a row with no status says so instead of inventing one", () => {
  const p = pill(null, null);
  assert.equal(p.text, "No status recorded");
  assert.equal(p.known, false);
});

test("pill: 'Pending Removal' does not read as removed", () => {
  const p = pill("Pending Removal", null);
  assert.equal(p.done, false);
  assert.equal(p.cls, "progress");
});

test("pill: a confirmed removal is the only thing that turns a row green", () => {
  assert.equal(pill("Confirmed · Removed").done, true);
  assert.equal(pill("Removed").cls, "confirmed");
  assert.equal(pill("Called 3 times — no answer").cls, "noanswer");
});

/* ── failure → banner copy ─────────────────────────────────────────────────── */

test("describeFailure: a router 404 naming the unmatched path reads as not deployed, not as a missing row", () => {
  const f = describeFailure({ status: 404, body: { ok: false, error: "not_found", path: "inquiries" } });
  assert.equal(f.code, "unrouted");
  assert.match(f.text, /not deployed/);
  assert.match(f.text, /\/api\/inquiries/);
});

test("describeFailure: a handler 404 reads as a missing row, not as a dead backend", () => {
  const f = describeFailure({ status: 404, body: { ok: false, error: "inquiry not found" } });
  assert.equal(f.code, "not_found");
  assert.match(f.text, /no longer in the database/);
  assert.equal(/not deployed/.test(f.text), false);
});

test("describeFailure: 401 tells the user their session expired rather than blaming their role", () => {
  const f = describeFailure({ status: 401, body: { ok: false, error: "unauthorized" } });
  assert.equal(f.code, "unauthorized");
  assert.match(f.text, /sign in again/);
});

test("describeFailure: 403 on /api/pii names the four roles that may see identity data", () => {
  const f = describeFailure({ status: 403, body: { ok: false, error: "forbidden" } }, { scope: "identity" });
  assert.equal(f.code, "forbidden");
  assert.match(f.text, /owner, admin, inquiry specialist and funding advisor/);
});

test("describeFailure: 403 on a write says the role cannot write, not that identity is hidden", () => {
  const f = describeFailure({ status: 403, body: { ok: false, error: "forbidden" } });
  assert.match(f.text, /cannot write to the inquiry queue/);
  assert.equal(/identity/.test(f.text), false);
});

test("describeFailure: 503 auth_unavailable reads as the database being down", () => {
  const f = describeFailure({ status: 503, body: { ok: false, error: "auth_unavailable", db: "down" } });
  assert.equal(f.code, "db_down");
  assert.match(f.text, /database is unreachable/);
});

test("describeFailure: the PII key 503 surfaces the server's own reason instead of a generic outage", () => {
  const f = describeFailure(
    { status: 503, body: { ok: false, error: "PII_ENC_KEY is not set — refusing to store identity data unencrypted" } },
    { scope: "identity" });
  assert.equal(f.code, "unavailable");
  assert.match(f.text, /PII_ENC_KEY is not set/);
});

test("describeFailure: a 400 quotes what the server objected to", () => {
  const f = describeFailure({ status: 400, body: { ok: false, error: "inquiry_id must be a uuid" } });
  assert.equal(f.code, "bad_request");
  assert.match(f.text, /inquiry_id must be a uuid/);
});

test("describeFailure: a transport error never claims nothing was saved", () => {
  const f = describeFailure({ transport: true, detail: "Failed to fetch" });
  assert.equal(f.code, "offline");
  assert.equal(f.saved, "unknown");
  assert.equal(/[Nn]othing was saved/.test(f.text), false);
  assert.match(f.text, /reload before assuming/);
});

test("describeFailure: a 500 never claims nothing was saved — the write may have committed", () => {
  const f = describeFailure({ status: 500, body: { ok: false, error: "internal_error" } });
  assert.equal(f.code, "server_error");
  assert.equal(f.saved, "unknown");
  assert.equal(/[Nn]othing was saved/.test(f.text), false);
});

test("describeFailure: a request the server rejected does say nothing was saved", () => {
  for (const res of [
    { status: 401, body: { error: "unauthorized" } },
    { status: 403, body: { error: "forbidden" } },
    { status: 400, body: { error: "bad" } },
    { status: 404, body: { error: "not_found", path: "inquiries" } },
    { status: 503, body: { error: "auth_unavailable", db: "down" } }
  ]) {
    const f = describeFailure(res);
    assert.equal(f.saved, "no", "status " + res.status);
  }
});

test("describeFailure: every failure carries the error tone and its http status", () => {
  const f = describeFailure({ status: 418, body: null });
  assert.equal(f.tone, "error");
  assert.equal(f.status, 418);
  const t = describeFailure({ transport: true });
  assert.equal(t.tone, "error");
});

test("describeFailure: a body that is not an object does not crash the mapping", () => {
  const f = describeFailure({ status: 502, body: "<html>gateway</html>" });
  assert.equal(f.code, "server_error");
});

/* ── interpreting responses ────────────────────────────────────────────────── */

test("interpretWrite: a 200 whose body is not ok:true is a failure, not a success", () => {
  const out = interpretWrite({ status: 200, body: { ok: false, error: "inquiry not found" } });
  assert.equal(out.ok, false);
  assert.equal(out.failure.code, "unexpected");
});

test("interpretWrite: a successful write hands back the row the server returned", () => {
  const row = { id: ID, status: "Removed", call_attempts: 3, confirmed_at: "2026-07-30T12:00:00Z" };
  const out = interpretWrite({ status: 200, body: { ok: true, inquiry: row } });
  assert.equal(out.ok, true);
  assert.deepEqual(out.inquiry, row);
});

test("interpretIdentity: a client with no identity row is an answer, not a failure", () => {
  const out = interpretIdentity({ status: 200, body: { ok: true, identity: null } });
  assert.equal(out.ok, true);
  assert.equal(out.identity, null);
});

test("interpretReveal: a 200 without an ssn string is a failure rather than an empty reveal", () => {
  assert.equal(interpretReveal({ status: 200, body: { ok: true } }).ok, false);
  assert.equal(interpretReveal({ status: 200, body: { ok: true, ssn: null } }).ok, false);
  assert.equal(interpretReveal({ status: 200, body: { ok: true, ssn: "123456789" } }).ok, true);
});

test("interpretReveal: a 403 is reported against the identity endpoint, not the queue", () => {
  const out = interpretReveal({ status: 403, body: { ok: false, error: "forbidden" } });
  assert.equal(out.failure.scope, "identity");
});

/* ── identity display ──────────────────────────────────────────────────────── */

test("maskedSsnLabel: no identity row and no SSN on file are different sentences", () => {
  assert.equal(maskedSsnLabel(null).text, "no identity record on file");
  assert.equal(maskedSsnLabel({ ssn_present: false }).text, "no SSN on file");
});

test("maskedSsnLabel: an unopenable ciphertext reads as unavailable, never as no SSN", () => {
  const m = maskedSsnLabel({ ssn_present: true, ssn_last4: null });
  assert.match(m.text, /unavailable/);
  assert.equal(m.present, true);
  assert.equal(m.degraded, true);
});

test("maskedSsnLabel: the masked form shows the last four and nothing else", () => {
  const m = maskedSsnLabel({ ssn_present: true, ssn_last4: "6789" });
  assert.equal(m.text, "SSN ***-**-6789");
  assert.equal(m.text.includes("12345"), false);
});

test("canReveal: a client with no SSN on file offers no reveal", () => {
  assert.equal(canReveal(null), false);
  assert.equal(canReveal({ ssn_present: false }), false);
  assert.equal(canReveal({ ssn_present: true }), true);
});

test("formatRevealed: nine digits are grouped for reading", () => {
  assert.equal(formatRevealed("123456789"), "123-45-6789");
});

test("formatRevealed: a value that is not nine digits is returned untouched rather than reshaped", () => {
  assert.equal(formatRevealed("12345"), "12345");
  assert.equal(formatRevealed(""), "");
  assert.equal(formatRevealed(null), "");
});

/* ── the row state machine ─────────────────────────────────────────────────── */

test("createRowState: a null call_attempts stays null rather than becoming zero", () => {
  const s = createRowState({ status: "New", call_attempts: null });
  assert.equal(s.attempts, null);
});

test("createRowState: a row confirmed only by its free-text status still reads as done", () => {
  assert.equal(createRowState({ status: "Confirmed · Removed" }).done, true);
});

test("createRowState: confirmed_at makes a row done whatever its status text says", () => {
  assert.equal(createRowState({ status: "Awaiting CRS", confirmed_at: "2026-07-30T00:00:00Z" }).done, true);
});

test("beginWrite: a confirm that has not returned yet leaves the row un-confirmed", () => {
  const before = createRowState({ status: "Filed — waiting on TransUnion", call_attempts: 1 });
  const armed = beginWrite(before, "confirm");
  assert.equal(armed.phase, "pending");
  assert.equal(armed.done, false);
  assert.equal(armed.status, "Filed — waiting on TransUnion");
  assert.equal(armed.attempts, 1);
});

test("beginWrite: a second click while a write is in flight is refused rather than sent twice", () => {
  const armed = beginWrite(createRowState({ status: "New" }), "attempt");
  const again = beginWrite(armed, "attempt");
  assert.equal(again.refused, "busy");
  assert.equal(again.phase, "pending");
  assert.equal(again.pending, "attempt");
});

test("settleWrite: the attempt count comes from the server, never from incrementing the screen's copy", () => {
  const armed = beginWrite(createRowState({ status: "New", call_attempts: 2 }), "attempt");
  const s = settleWrite(armed, { status: "New", call_attempts: 7, confirmed_at: null });
  assert.equal(s.attempts, 7);
});

test("settleWrite: a response that omits call_attempts leaves the previous count rather than resetting to zero", () => {
  const armed = beginWrite(createRowState({ status: "New", call_attempts: 3 }), "attempt");
  assert.equal(settleWrite(armed, { status: "New" }).attempts, 3);
  assert.equal(settleWrite(armed, { status: "New", call_attempts: null }).attempts, 3);
});

test("settleWrite: confirmed_at is what turns a row into a removal", () => {
  const armed = beginWrite(createRowState({ status: "Filed", call_attempts: 1 }), "confirm");
  const s = settleWrite(armed, { status: "Removed", call_attempts: 1, confirmed_at: "2026-07-30T12:00:00Z" });
  assert.equal(s.done, true);
  assert.equal(s.phase, "idle");
  assert.equal(s.status, "Removed");
});

test("settleWrite: reopening a row — status off 'Removed' with confirmed_at cleared — un-confirms it", () => {
  const armed = beginWrite(createRowState({ status: "Removed", confirmed_at: "2026-07-01T00:00:00Z" }), "status");
  const s = settleWrite(armed, { status: "Pending Removal", confirmed_at: null, call_attempts: 4 });
  assert.equal(s.done, false);
  assert.equal(s.status, "Pending Removal");
});

test("settleWrite: an ok response with no row leaves the display alone and marks it stale", () => {
  const before = createRowState({ status: "New", call_attempts: 2 });
  const s = settleWrite(beginWrite(before, "confirm"), null);
  assert.equal(s.stale, true);
  assert.equal(s.done, false);
  assert.equal(s.status, "New");
  assert.equal(s.attempts, 2);
  assert.equal(s.phase, "idle");
});

test("failWrite: a failed confirm restores the row exactly as it was before the click", () => {
  const before = createRowState({ status: "Called 3 times — no answer", call_attempts: 3 });
  const armed = beginWrite(before, "confirm");
  const s = failWrite(armed, describeFailure({ status: 403, body: { error: "forbidden" } }));
  assert.equal(s.status, before.status);
  assert.equal(s.attempts, before.attempts);
  assert.equal(s.done, before.done);
  assert.equal(s.phase, "idle");
  assert.equal(s.error.code, "forbidden");
});

test("failWrite: the pending phase is cleared so the buttons come back", () => {
  const armed = beginWrite(createRowState({ status: "New" }), "attempt");
  const s = failWrite(armed, describeFailure({ transport: true }));
  assert.equal(s.phase, "idle");
  assert.equal(s.pending, null);
  assert.equal(s.snapshot, null);
});

test("failWrite then a fresh write: the restored row is writable again", () => {
  const s0 = createRowState({ status: "New", call_attempts: 0 });
  const s1 = failWrite(beginWrite(s0, "attempt"), describeFailure({ status: 500, body: null }));
  const s2 = beginWrite(s1, "attempt");
  assert.equal(s2.refused, null);
  assert.equal(s2.phase, "pending");
});

test("attemptsDelta: an unknown count on either side moves the Calls tile by nothing", () => {
  assert.equal(attemptsDelta(null, 3), 0);
  assert.equal(attemptsDelta(2, null), 0);
  assert.equal(attemptsDelta(undefined, undefined), 0);
});

test("attemptsDelta: a server recount that did not change moves the tile by nothing", () => {
  assert.equal(attemptsDelta(4, 4), 0);
  assert.equal(attemptsDelta(2, 3), 1);
  assert.equal(attemptsDelta(5, 2), -3);
});

/* ── the attempt history ───────────────────────────────────────────────────── */

test("interpretAttempts: a row nobody has worked yet is an empty list, not a failure", () => {
  const out = interpretAttempts({ status: 200, body: { ok: true, attempts: [] } });
  assert.equal(out.ok, true);
  assert.deepEqual(out.attempts, []);
});

test("interpretAttempts: a 200 with no attempts array is a failure rather than an empty history", () => {
  assert.equal(interpretAttempts({ status: 200, body: { ok: true } }).ok, false);
});

test("attemptLine: an attempt with no outcome and no note renders as a kind and a date, not as filler", () => {
  const line = attemptLine({ kind: "call", outcome: null, note: null, created_at: "2026-07-29T15:04:00Z" });
  assert.match(line, /^call · /);
  assert.equal(/no outcome|unknown|n\/a/i.test(line), false);
});

test("attemptLine: the outcome is preferred over the note, and the staff name is shown when the join found one", () => {
  const line = attemptLine({
    kind: "letter", outcome: "mailed certified", note: "second request",
    staff_name: "Alvin Torres", created_at: "2026-07-29T15:04:00Z"
  });
  assert.match(line, /letter/);
  assert.match(line, /mailed certified/);
  assert.match(line, /Alvin Torres/);
  assert.equal(line.includes("second request"), false);
});

test("attemptLine: a blank staff name from the TRIM in the query is dropped rather than rendered as an empty field", () => {
  const line = attemptLine({ kind: "portal", staff_name: "   ", created_at: null });
  assert.equal(line, "portal");
});

test("formatWhen: a timestamp that will not parse renders as nothing rather than 'Invalid Date'", () => {
  assert.equal(formatWhen(null), null);
  assert.equal(formatWhen(""), null);
  assert.equal(formatWhen("not a date"), null);
  assert.equal(typeof formatWhen("2026-07-29T15:04:00Z"), "string");
});

test("pendingLabel: each action names itself while it is in flight", () => {
  assert.equal(pendingLabel("attempt"), "logging attempt...");
  assert.equal(pendingLabel("confirm"), "confirming removal...");
  assert.equal(pendingLabel("status"), "saving status...");
  assert.equal(pendingLabel(null), "saving...");
});

/* ── the screen's embedded copy ────────────────────────────────────────────── */

const MODULE_SRC = fs.readFileSync(MODULE_PATH, "utf8");
const HTML_SRC = fs.readFileSync(HTML_PATH, "utf8");
const EMBEDDED = (HTML_SRC.match(
  /\/\* ==FHVIEW-BEGIN== \*\/\n([\s\S]*?)\n\/\* ==FHVIEW-END== \*\//
) || [])[1];

test("the screen's embedded copy of this module is this module, with `export ` stripped", () => {
  assert.ok(EMBEDDED, "no FHVIEW block found in public/app/inquiry-remover.html");
  const body = MODULE_SRC
    .slice(MODULE_SRC.indexOf("export const ATTEMPT_KINDS"))
    .replace(/^export /gm, "")
    .trimEnd();
  assert.equal(EMBEDDED, body,
    "public/app/inquiry-remover.html has drifted from inquiry-remover-view.mjs — " +
    "edit the module and paste it back between the FHVIEW markers");
});

test("the embedded copy runs in a browser-shaped sandbox and exposes every export", () => {
  const sandbox = {};
  vm.createContext(sandbox);
  const VIEW_IN_BROWSER = vm.runInContext(
    '(function () { "use strict";\n' + EMBEDDED + "\nreturn VIEW; })()",
    sandbox, { filename: "inquiry-remover.html#FHVIEW" }
  );
  assert.deepEqual(Object.keys(VIEW_IN_BROWSER).sort(), Object.keys(VIEW).sort());
  // and it behaves the same, since it is the same source
  assert.deepEqual(
    VIEW_IN_BROWSER.buildConfirmRequest({ inquiryId: ID }),
    buildConfirmRequest({ inquiryId: ID })
  );
  assert.equal(VIEW_IN_BROWSER.beginWrite(VIEW_IN_BROWSER.createRowState({ status: "New" }), "confirm").done, false);
});

test("VIEW exposes every export the screen calls, so a rename cannot half-land", () => {
  for (const name of [
    "ATTEMPT_KINDS", "isUuid", "pill", "buildAttemptRequest", "buildConfirmRequest",
    "buildStatusRequest", "buildIdentityRequest", "buildRevealRequest",
    "interpretWrite", "interpretIdentity", "interpretReveal",
    "maskedSsnLabel", "canReveal", "formatRevealed",
    "createRowState", "beginWrite", "settleWrite", "failWrite",
    "attemptsDelta", "pendingLabel"
  ]) {
    assert.ok(VIEW[name], name + " is missing from VIEW");
  }
});

/* ── rules that live in the HTML itself ────────────────────────────────────── */

test("the screen never writes to the browser console, so a revealed SSN cannot land in one", () => {
  assert.equal(/console\s*\./.test(HTML_SRC), false,
    "public/app/inquiry-remover.html contains a console call — a revealed SSN must never reach it");
});

test("the screen offers exactly the four attempt kinds, taken from the module rather than retyped", () => {
  // The <option> list is built by iterating V.ATTEMPT_KINDS; a hand-written
  // list of kinds anywhere in the screen would be a second source of truth.
  assert.match(HTML_SRC, /V\.ATTEMPT_KINDS\.forEach/);
});

test("the screen tells the user the reveal is logged before they click it", () => {
  assert.match(HTML_SRC, /Revealing writes your name and this reason to the access log\./);
});

test("the screen arms a pending state instead of painting a confirmation it has not got", () => {
  assert.match(HTML_SRC, /V\.beginWrite\(/);
  assert.match(HTML_SRC, /V\.settleWrite\(/);
  assert.match(HTML_SRC, /V\.failWrite\(/);
  // The old local-only handler wrote the confirmed pill straight into the cell.
  assert.equal(/status-pill confirmed">Confirmed · Removed<\/span>';/.test(HTML_SRC), false,
    "a hardcoded confirmed pill is still being painted without the server");
});
