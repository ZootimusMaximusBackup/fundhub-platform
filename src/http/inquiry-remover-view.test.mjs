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
  buildAttemptRequest, buildConfirmRequest, buildStatusRequest, buildExpectedRequest,
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

test("buildExpectedRequest: staff type the expected name; actual stays on the file", () => {
  const r = buildExpectedRequest({ inquiryId: ID, expectedName: "Chase Ink" });
  assert.deepEqual(r.body, { inquiry_id: ID, action: "expected", expected_name: "Chase Ink" });
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
    "buildStatusRequest", "buildExpectedRequest", "buildIdentityRequest", "buildRevealRequest",
    "interpretWrite", "interpretIdentity", "interpretReveal",
    "maskedSsnLabel", "canReveal", "formatRevealed",
    "createRowState", "beginWrite", "settleWrite", "failWrite",
    "attemptsDelta", "pendingLabel",
    "caseUiStatus", "caseCallState", "buildCaseSendRequest", "buildInquiryGenerateRequest",
    "bureauKey", "bureauLabel", "countByBureau", "repairStagePill", "buildRepairSendRequest",
    "buildRepairConfirmParseRequest",
    "caseIsReadyToSend", "casesNeedingAPerson", "waitingDays", "waitingLabel", "sortCasesOldestFirst",
    "nextInquiryAction", "docsPacketLabel", "docsMissingWords",
    "inquiryHeadline", "repairHeadline", "nextRepairAction"
  ]) {
    assert.ok(VIEW[name], name + " is missing from VIEW");
  }
});

test("buildInquiryGenerateRequest: posts generate to /api/inquiry-cases", () => {
  const r = VIEW.buildInquiryGenerateRequest({ caseId: ID });
  assert.equal(r.method, "POST");
  assert.equal(r.path, "/api/inquiry-cases");
  assert.deepEqual(r.body, { id: ID, action: "generate" });
  assert.throws(() => VIEW.buildInquiryGenerateRequest({ caseId: "not-a-uuid" }), /must be a uuid/);
});

test("buildCaseSendRequest: human send only, portal needs reference", () => {
  const r = VIEW.buildCaseSendRequest({ caseId: ID, mail: true });
  assert.equal(r.path, "/api/inquiry-cases");
  assert.equal(r.body.action, "send");
  assert.equal(r.body.mail, true);
  assert.throws(
    () => VIEW.buildCaseSendRequest({ caseId: ID, portal: true }),
    /reference number/
  );
  const p = VIEW.buildCaseSendRequest({
    caseId: ID, portal: true, portalConfirmation: "REF-1", mailServiceLevel: "priority"
  });
  assert.equal(p.body.portal_confirmation, "REF-1");
  assert.equal(p.body.mail_service_level, "priority");
});

test("buildRepairSendRequest: human mail only, letters required", () => {
  const r = VIEW.buildRepairSendRequest({
    clientId: CLIENT,
    mail: true,
    letters: [{ id: ID, bureau: "EX", html: "<p>Round 1</p>" }]
  });
  assert.equal(r.path, "/api/repair/send");
  assert.equal(r.body.mail, true);
  assert.equal(r.body.client_id, CLIENT);
  assert.equal(r.body.letters[0].bureau, "EX");
  assert.equal(r.body.letters[0].letter_id, ID);
  assert.throws(
    () => VIEW.buildRepairSendRequest({ clientId: CLIENT, mail: true, letters: [] }),
    /no letters ready/
  );
  assert.throws(
    () => VIEW.buildRepairSendRequest({ clientId: CLIENT, letters: [{ bureau: "EX", html: "x" }] }),
    /press send/
  );
});

test("buildRepairConfirmParseRequest: posts the parse id", () => {
  const r = VIEW.buildRepairConfirmParseRequest({ responseId: ID });
  assert.equal(r.path, "/api/repair/exceptions");
  assert.equal(r.body.action, "confirm_parse");
  assert.equal(r.body.responseId, ID);
});

test("repair pane calls the copied VIEW, not a missing window.VIEW", () => {
  assert.match(HTML_SRC, /var V = window\.FHInquiryView;/);
  assert.match(HTML_SRC, /V\.buildRepairSendRequest/);
  assert.match(HTML_SRC, /V\.buildRepairConfirmParseRequest/);
});

test("Inquiries Generate posts generate to inquiry-cases, not repair generate", () => {
  assert.match(HTML_SRC, /buildInquiryGenerateRequest\(\{\s*caseId:/);
  const start = HTML_SRC.indexOf('if (act === "generate-letters")');
  const end = HTML_SRC.indexOf('if (act === "upload-fraud")');
  assert.ok(start > 0 && end > start, "generate-letters handler missing");
  const inquiriesGen = HTML_SRC.slice(start, end);
  assert.equal(inquiriesGen.includes("/api/repair/generate"), false);
  assert.match(inquiriesGen, /inquiry items on this case/);
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

/* ── the Work Queue's column map ─────────────────────────────────────────────
 *
 * Not a view-model test. It lives here because this is the file that already
 * reads the screen, and because the thing it pins is the one the module's
 * header calls the worst outcome available: an action that appears to have
 * happened and did not.
 *
 * paintRow() used to write the attempt count into cells[3] and the status pill
 * into cells[4] — Expected and Call State — indices left over from a
 * five-column table. So "Mark confirmed" put "Removed" under Call State while
 * the real Status column still read open, and the desk could not be trusted
 * after a write. The count is derived from the header itself, so reordering the
 * columns without moving the constants fails here rather than on somebody's
 * credit report. The browser proof is e2e/specialist-desk.spec.mjs.
 */

const WORK_QUEUE_COLUMNS = [
  "Client", "Bureau", "Actual", "Expected", "Call State", "Hold", "Attempts", "Status"
];

test("the Work Queue header still declares its eight columns in this order", () => {
  const header = (HTML_SRC.match(/<table class="queue" id="workQueueTable">\s*<tr>([\s\S]*?)<\/tr>/) || [])[1];
  assert.ok(header, "no Work Queue header row found");
  const cols = [...header.matchAll(/<th>([^<]+)<\/th>/g)].map((m) => m[1].trim());
  assert.deepEqual(cols, WORK_QUEUE_COLUMNS);
});

test("paintRow writes into the columns the header actually declares", () => {
  const attempts = WORK_QUEUE_COLUMNS.indexOf("Attempts");
  const status = WORK_QUEUE_COLUMNS.indexOf("Status");
  assert.equal(attempts, 6);
  assert.equal(status, 7);

  assert.match(
    HTML_SRC,
    new RegExp(`var COL_ATTEMPTS = ${attempts}, COL_STATUS = ${status};`),
    "the column constants no longer match the header the table renders"
  );
  assert.match(HTML_SRC, /attemptsCell = r\.cells\[COL_ATTEMPTS\]/);
  assert.match(HTML_SRC, /statusCell   = r\.cells\[COL_STATUS\]/);

  // The stale five-column indices, in either of the two places they lived.
  assert.equal(/attemptsCell = r\.cells\[3\]/.test(HTML_SRC), false);
  assert.equal(/statusCell   = r\.cells\[4\]/.test(HTML_SRC), false);
  assert.equal(/status: r\.cells\[4\]\.textContent/.test(HTML_SRC), false);
});

test("the fallback row state reads the same two columns paintRow writes", () => {
  // rowState() seeds from the DOM when there is no database row behind it. It
  // read cells[3] and cells[4] too, so a row seeded that way disagreed with
  // every row seeded from the server.
  assert.match(HTML_SRC, /var txt = r\.cells\[COL_ATTEMPTS\]\.textContent\.trim\(\);/);
  assert.match(HTML_SRC, /status: r\.cells\[COL_STATUS\]\.textContent\.trim\(\),/);
});

test("the comment above paintRow no longer points at a cell that was deleted", () => {
  // It described a "2d 14h" stuck age living in the cell paintRow writes. That
  // column and its sample rows are gone; the sentence outlived the markup and
  // sent the next reader to the wrong two cells.
  assert.equal(
    /so expanding a sample row never rewrites the\s*\n\s*markup it came with \(the "2d 14h" stuck age lives in that cell\)/.test(HTML_SRC),
    false,
    "the stale stuck-age comment is back"
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE SPECIALIST DESK'S TWO RHYTHMS (2026-08-30)

   Inquiry removal is a QUEUE YOU EMPTY: a one-to-three-day errand, worked
   oldest first, and the headline goes DOWN when the person works. Credit repair
   is a CASELOAD YOU NURSE: thirty days a round, up to six rounds, and its
   headline never reaches zero — which is why it needs a comparison beside it to
   mean anything at all.

   Every test below is about a number the screen puts in front of somebody, and
   every one of them is a number that used to be wrong.
   ═══════════════════════════════════════════════════════════════════════════ */

const NOW = new Date("2026-08-30T12:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

test("bureauKey folds a code and a full name onto the same key", () => {
  // THE BUG THIS ENDS: the screen's three chips carried data-bureau="Equifax"
  // and the rows carry inquiry_log.bureau, which today holds the two-letter
  // code. The keys could never match, so all three chips read 0 and "none in
  // queue" while thirty inquiries were open — and pressing one emptied the
  // table under the words "all done for today".
  assert.equal(VIEW.bureauKey("EX"), "EX");
  assert.equal(VIEW.bureauKey("Experian"), "EX");
  assert.equal(VIEW.bureauKey(" experian "), "EX");
  assert.equal(VIEW.bureauKey("Equifax"), "EQ");
  assert.equal(VIEW.bureauKey("TransUnion"), "TU");
  assert.equal(VIEW.bureauKey("Trans Union"), "TU");
  assert.equal(VIEW.bureauKey(""), "");
  assert.equal(VIEW.bureauKey(null), "");
  // An unrecognised bureau keeps its own identity rather than being folded into
  // one of the three. A wrong count is worse than an obviously unknown one.
  assert.equal(VIEW.bureauKey("Innovis"), "INNOVIS");
});

test("bureauLabel names a bureau however the record spelled it", () => {
  assert.equal(VIEW.bureauLabel("EX"), "Experian");
  assert.equal(VIEW.bureauLabel("Experian"), "Experian");
  assert.equal(VIEW.bureauLabel("EQ"), "Equifax");
  assert.equal(VIEW.bureauLabel("TU"), "TransUnion");
  assert.equal(VIEW.bureauLabel(null), "—");
});

test("countByBureau counts codes and names as one bureau, and skips blanks", () => {
  const counts = VIEW.countByBureau([
    { bureau: "EX" }, { bureau: "Experian" }, { bureau: "EQ" },
    { bureau: null }, { bureau: "" }
  ]);
  assert.deepEqual(counts, { EX: 2, EQ: 1 });
  assert.deepEqual(VIEW.countByBureau(null), {});
  // and it can be pointed at a different field on the row
  assert.deepEqual(
    VIEW.countByBureau([{ selected_bureaus_raw: "TransUnion" }], (r) => r.selected_bureaus_raw),
    { TU: 1 }
  );
});

test("caseIsReadyToSend is true only while a case is still waiting on a person", () => {
  // The whole reason the inquiry headline can go down when she works: a case in
  // the mail, or one the sweeper is already phoning the bureau about, is not
  // hers to move.
  assert.equal(VIEW.caseIsReadyToSend({ case_status: "Queued" }), true);
  assert.equal(VIEW.caseIsReadyToSend({ case_status: "Scheduled" }), true);
  assert.equal(VIEW.caseIsReadyToSend({ case_status: "Queued", first_delivery_at: daysAgo(1) }), false);
  assert.equal(VIEW.caseIsReadyToSend({ case_status: "Queued", letter_provider_id: "pg_1" }), false);
  assert.equal(VIEW.caseIsReadyToSend({ case_status: "Queued", call_fired_at: daysAgo(0) }), false);
  assert.equal(VIEW.caseIsReadyToSend({ case_status: "Blocked" }), false);
  assert.equal(VIEW.caseIsReadyToSend({ case_status: "Completed" }), false);
});

test("waitingDays and waitingLabel: unknown stays unknown, never zero", () => {
  assert.equal(VIEW.waitingDays(daysAgo(6), NOW), 6);
  assert.equal(VIEW.waitingDays(daysAgo(0), NOW), 0);
  assert.equal(VIEW.waitingDays(null, NOW), null);
  assert.equal(VIEW.waitingDays("not a date", NOW), null);
  // A clock skew must not read as "waiting -1 days".
  assert.equal(VIEW.waitingDays(new Date(NOW.getTime() + 86400000).toISOString(), NOW), 0);
  assert.equal(VIEW.waitingLabel(6), "6 days");
  assert.equal(VIEW.waitingLabel(1), "1 day");
  assert.equal(VIEW.waitingLabel(0), "today");
  assert.equal(VIEW.waitingLabel(null), "—");
});

test("sortCasesOldestFirst: waiting-on-a-person first, oldest first, undated last", () => {
  // The reader used to order requested_at DESC, so the case she had just worked
  // jumped to the top and the one nobody had touched sank out of sight.
  const sorted = VIEW.sortCasesOldestFirst([
    { id: "recent", case_status: "Queued", requested_at: daysAgo(1) },
    { id: "sent-old", case_status: "Queued", requested_at: daysAgo(20), first_delivery_at: daysAgo(19) },
    { id: "oldest", case_status: "Queued", requested_at: daysAgo(9) },
    { id: "undated", case_status: "Queued" }
  ]);
  assert.deepEqual(sorted.map((r) => r.id), ["oldest", "recent", "undated", "sent-old"]);
  // and the input array is not mutated
  const input = [{ id: "a", case_status: "Queued", requested_at: daysAgo(2) },
                 { id: "b", case_status: "Queued", requested_at: daysAgo(5) }];
  VIEW.sortCasesOldestFirst(input);
  assert.deepEqual(input.map((r) => r.id), ["a", "b"]);
});

test("nextInquiryAction names the oldest case that is waiting on a person", () => {
  const next = VIEW.nextInquiryAction([
    { id: "b", case_status: "Queued", requested_at: daysAgo(2), client_name: "Sam Rivera", selected_bureaus_raw: "EQ" },
    { id: "a", case_status: "Queued", requested_at: daysAgo(6), client_name: "Dana Whitfield", selected_bureaus_raw: "EX" },
    { id: "z", case_status: "Queued", requested_at: daysAgo(40), first_delivery_at: daysAgo(39), client_name: "Already Sent" }
  ], { now: NOW });
  assert.equal(next.caseId, "a");
  assert.equal(next.text, "Send the oldest — Dana Whitfield, Experian, waiting 6 days");
  // Nothing to do is null, not a sentence about an imaginary case.
  assert.equal(VIEW.nextInquiryAction([{ case_status: "Completed" }], { now: NOW }), null);
  assert.equal(VIEW.nextInquiryAction([], { now: NOW }), null);
  assert.equal(VIEW.nextInquiryAction(null), null);
  // An undated case is still workable, and is still named.
  const undated = VIEW.nextInquiryAction([{ id: "u", case_status: "Queued", case_id: "IRC-9" }], { now: NOW });
  assert.equal(undated.caseId, "u");
  assert.equal(undated.text, "Send the oldest — IRC-9");
});

test("docsPacketLabel has three states, and 'not checked' is one of them", () => {
  // THE BUG THIS ENDS: the screen returned "complete" for every case that was
  // not already Blocked, and Blocked is only ever set at send time. So a packet
  // nobody had looked at read "complete" on the screen whose whole job is
  // deciding whether to press Send.
  assert.equal(VIEW.docsPacketLabel({ docs_complete: true }), "complete");
  assert.equal(VIEW.docsPacketLabel({ docs_complete: false }), "chasing");
  assert.equal(VIEW.docsPacketLabel({ case_status: "Blocked" }), "chasing");
  assert.equal(VIEW.docsPacketLabel({ case_status: "Queued" }), "not checked");
  assert.equal(VIEW.docsPacketLabel({}), "not checked");
  assert.equal(VIEW.docsPacketLabel(null), "not checked");
  // A failed read arrives as an absent field, and must NOT read as complete.
  assert.equal(VIEW.docsPacketLabel({ case_status: "In Progress", docs_complete: undefined }), "not checked");
});

test("docsMissingWords says what is missing in the client's words", () => {
  assert.equal(
    VIEW.docsMissingWords(["id_document", "proof_of_address", "authorization"]),
    "photo ID, proof of address, signed authorization"
  );
  assert.equal(VIEW.docsMissingWords(["ssn_card"]), "Social Security card");
  assert.equal(VIEW.docsMissingWords([]), "");
  assert.equal(VIEW.docsMissingWords(undefined), "");
  // an unmapped key is said, not swallowed
  assert.equal(VIEW.docsMissingWords(["utility_bill"]), "utility bill");
});

test("inquiryHeadline counts what a person can act on, and says how old it is", () => {
  const rows = [
    { id: "a", case_status: "Queued", requested_at: daysAgo(6) },
    { id: "b", case_status: "Queued", requested_at: daysAgo(2) },
    { id: "c", case_status: "Queued", requested_at: daysAgo(30), first_delivery_at: daysAgo(29) }
  ];
  const h = VIEW.inquiryHeadline(rows, { now: NOW, total: 3 });
  assert.equal(h.label, "Ready to send");
  assert.equal(h.value, "2");
  assert.equal(h.sub, "oldest waiting 6 days");
});

test("inquiryHeadline says when it only counted a page, instead of under-reporting", () => {
  // api/read/inquiry-cases.mjs returns COUNT(*) over the whole queue. When the
  // page is smaller than the queue, the headline is a page count and has to say
  // so — silently under-reporting is worst on the busiest day.
  const rows = [{ id: "a", case_status: "Queued", requested_at: daysAgo(4) }];
  const h = VIEW.inquiryHeadline(rows, { now: NOW, total: 143 });
  assert.equal(h.value, "1");
  assert.match(h.sub, /counted over the first 1 of 143/);
  // A total that matches the page says nothing extra.
  assert.equal(VIEW.inquiryHeadline(rows, { now: NOW, total: 1 }).sub, "oldest waiting 4 days");
  // A missing total is unknown, and unknown adds no claim.
  assert.equal(VIEW.inquiryHeadline(rows, { now: NOW }).sub, "oldest waiting 4 days");
});

test("inquiryHeadline never invents an age it does not have", () => {
  const h = VIEW.inquiryHeadline([{ id: "a", case_status: "Queued" }], { now: NOW });
  assert.equal(h.value, "1");
  assert.equal(h.sub, "oldest waiting — no request date on file");
  // Empty and "all sent" are different sentences.
  assert.equal(VIEW.inquiryHeadline([], { now: NOW }).sub, "no active cases");
  assert.equal(
    VIEW.inquiryHeadline([{ case_status: "Completed" }], { now: NOW }).sub,
    "nothing is waiting on you"
  );
});

/* ── the zero that was standing in for work ────────────────────────────────── */

test("casesNeedingAPerson: Blocked and Escalated are work, not settled", () => {
  // src/inquiry-ops/cases.mjs ACTIVE admits five statuses. Two of them are
  // neither ready to send nor out of the building.
  const rows = [
    { id: "queued", case_status: "Queued" },
    { id: "blocked", case_status: "Blocked" },
    { id: "escalated", case_status: "Escalated" },
    { id: "sent", case_status: "In Progress" },
    { id: "calling", case_status: "Queued", call_fired_at: daysAgo(1) },
    { id: "done", case_status: "Completed" }
  ];
  assert.deepEqual(VIEW.casesNeedingAPerson(rows).map((r) => r.id), ["blocked", "escalated"]);
  assert.deepEqual(VIEW.casesNeedingAPerson([]), []);
  assert.deepEqual(VIEW.casesNeedingAPerson(null), []);
});

test("casesNeedingAPerson: a status this screen has never been taught is work, not nothing", () => {
  // caseUiStatus falls back to `st || "Unknown"`. A case in a state nobody has
  // explained is exactly the one a person should look at, so it must not be
  // quietly absorbed into "everything is sent".
  assert.equal(VIEW.casesNeedingAPerson([{ id: "x", case_status: "Waiting On Legal" }]).length, 1);
  assert.equal(VIEW.casesNeedingAPerson([{ id: "x" }]).length, 1);
});

test("casesNeedingAPerson: a Blocked case that already went out is not counted twice", () => {
  // caseUiStatus reads Blocked FIRST, before the delivery columns, so a case
  // that was blocked stays blocked here even with a letter id on it. That is the
  // gate's own order and this follows it rather than inventing a second one.
  assert.equal(VIEW.casesNeedingAPerson([{ case_status: "Blocked", letter_provider_id: "L1" }]).length, 1);
  // An Escalated case that HAS been sent is out of her hands, and is not counted.
  assert.equal(VIEW.casesNeedingAPerson([{ case_status: "Escalated", first_delivery_at: daysAgo(2) }]).length, 0);
});

test("inquiryHeadline does not let a zero stand in for three blocked cases", () => {
  /* THE BUG. Blocked is written by src/inquiry-ops/send.mjs when the identity
     packet is short: the send was REFUSED and somebody has to chase documents.
     With three such cases and nothing ready, the sub-line said "nothing is
     waiting on you" — the screen telling her she could go home while its own
     Docs column printed "chasing" on the rows underneath. */
  const rows = [
    { id: "a", case_status: "Blocked", requested_at: daysAgo(10) },
    { id: "b", case_status: "Blocked", requested_at: daysAgo(12) },
    { id: "c", case_status: "Escalated", requested_at: daysAgo(20) }
  ];
  const h = VIEW.inquiryHeadline(rows, { now: NOW, total: 3 });
  // The NUMBER is still honest: none of these is ready to send, and folding them
  // in would be the same lie pointing the other way.
  assert.equal(h.value, "0");
  assert.equal(h.sub, "3 cases need a person before they can be sent");
  assert.equal(h.sub.includes("nothing is waiting on you"), false);

  // One reads as one.
  assert.equal(
    VIEW.inquiryHeadline([{ id: "a", case_status: "Blocked" }], { now: NOW }).sub,
    "1 case needs a person before it can be sent"
  );
});

test("inquiryHeadline names the uncounted cases even when something IS ready", () => {
  const rows = [
    { id: "a", case_status: "Queued", requested_at: daysAgo(6) },
    { id: "b", case_status: "Blocked", requested_at: daysAgo(12) }
  ];
  const h = VIEW.inquiryHeadline(rows, { now: NOW, total: 2 });
  assert.equal(h.value, "1");
  assert.equal(h.sub, "oldest waiting 6 days · 1 case needs a person before it can be sent");
});

test("inquiryHeadline still says 'nothing is waiting on you' when that is true", () => {
  // The guard against the fix over-firing: everything open really is in the mail.
  const rows = [
    { id: "a", case_status: "In Progress" },
    { id: "b", case_status: "Queued", first_delivery_at: daysAgo(3) },
    { id: "c", case_status: "Queued", call_fired_at: daysAgo(1) }
  ];
  assert.equal(VIEW.inquiryHeadline(rows, { now: NOW, total: 3 }).sub, "nothing is waiting on you");
});

test("repairHeadline pairs a number that never reaches zero with what it is out of", () => {
  const h = VIEW.repairHeadline({ need_me: 17, total: 40, files: new Array(40).fill({}) });
  assert.equal(h.label, "Need me");
  assert.equal(h.value, "17");
  assert.equal(h.sub, "of 40 open");
  // Past the reader's cap it says which of the two it counted.
  const capped = VIEW.repairHeadline({ need_me: 17, total: 143, files: new Array(100).fill({}) });
  assert.equal(capped.sub, "counted over the first 100 of 143 open");
  // A missing rollup is an em-dash. Never a zero standing in for unknown.
  assert.equal(VIEW.repairHeadline({ files: [] }).value, "—");
  assert.equal(VIEW.repairHeadline({ need_me: null, files: [] }).value, "—");
  assert.equal(VIEW.repairHeadline({}).value, "—");
  assert.equal(VIEW.repairHeadline({ need_me: 0, total: 12, files: [] }).value, "0");
});

test("nextRepairAction names the first file the rows themselves say needs a person", () => {
  const files = [
    { client_id: "c1", name: "Quiet File" },
    { client_id: "c2", name: "Dana Whitfield" },
    { client_id: "c3", name: "Also Needs" }
  ];
  const needs = (f) => (f.client_id === "c1" ? "" : "Send letters");
  const next = VIEW.nextRepairAction(files, needs);
  assert.equal(next.clientId, "c2");
  assert.equal(next.text, "Dana Whitfield — Send letters");
  assert.equal(VIEW.nextRepairAction(files, () => ""), null);
  assert.equal(VIEW.nextRepairAction(files), null);
  assert.equal(VIEW.nextRepairAction(null, needs), null);
});

/* ── the screen itself ─────────────────────────────────────────────────────── */

test("the bureau chips are keyed the way the rows are keyed", () => {
  // The chips carried full names; the rows carry codes. Both sides now go
  // through bureauKey, and the chip's own data-bureau is the key.
  const keys = [...HTML_SRC.matchAll(/<button[^>]*data-bureau="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    keys.sort(), ["EQ", "EX", "TU"],
    "a bureau chip is keyed by something other than the code the rows carry"
  );
  assert.ok(HTML_SRC.includes("byBureau[VIEW.bureauKey(c.dataset.bureau)]"));
  assert.ok(HTML_SRC.includes("var bkey = VIEW.bureauKey(it.bureau);"));
});

test("the docs column asks the reader instead of assuming", () => {
  assert.ok(HTML_SRC.includes("return window.FHInquiryView.docsPacketLabel(C);"));
  assert.ok(
    !HTML_SRC.includes('return C.case_status === "Blocked" ? "chasing" : "complete";'),
    "the invented 'complete' is back on the docs column"
  );
});

test("Recent Letters Issued has a reader, and waits for the data layer", () => {
  // The block was static markup: it said "No letters issued yet" after the
  // fortieth letter went out, because nothing ever wrote into .letters-list.
  assert.ok(HTML_SRC.includes("FHData.recentLetters(8)"));
  assert.ok(HTML_SRC.includes("FHData.wire(FHData.recentLetters"));
  // data.js is deferred, so a read at parse time is a read that never happens.
  assert.ok(HTML_SRC.includes('document.addEventListener("DOMContentLoaded", loadRecentLetters)'));
});

test("the top-left slot is a metric class, not a px size the brand file eats", () => {
  // fundhub-brand.css hands 32px back to .vl for free; a px size written here
  // would be discarded. UI-STANDARDS §12.7.
  assert.ok(HTML_SRC.includes('<div class="vl dh-value" id="deskValue">—</div>'));
  assert.match(HTML_SRC, /id="deskLabel"/);
  assert.match(HTML_SRC, /id="deskSub"/);
  assert.match(HTML_SRC, /id="deskNext"/);
});

test("the screen spends exactly one font-size escape hatch", () => {
  // §12.7: one rule per screen, with !important, with the reason above it. A
  // second one is how a screen ends up with six sizes and no hierarchy.
  const styles = (HTML_SRC.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join("\n");
  const hatches = styles.match(/font-size\s*:[^;}]*!important/gi) || [];
  assert.equal(hatches.length, 1, "expected exactly one !important font-size rule, found " + hatches.length);
  // and it names only classes this screen owns — never the shared chrome.
  const rule = HTML_SRC.slice(HTML_SRC.indexOf(".app :is(.who-name"), HTML_SRC.indexOf("font-size:var(--fs-caption) !important"));
  for (const shared of [".chip", ".eyebrow", ".av", ".mono", ".statusbar", ".clock", ".live-pill", ".stat-label"]) {
    assert.ok(
      !new RegExp("[(,\\s]" + shared.replace(".", "\\.") + "[,)\\s]").test(rule),
      shared + " belongs to the brand file or shell.js — resizing it here resizes it app-wide"
    );
  }
});

test("the tables scroll inside their own box instead of being clipped by the page", () => {
  // Measured before this: the repair table's right edge sat at 1478px in a
  // 1440px viewport, #repairTableWrap was overflow-x:visible, and
  // body{overflow:hidden} swallowed the rest. The cut-off column was Due.
  assert.match(HTML_SRC, /\.fh-scroll-x\{overflow-x:auto/);
  assert.match(HTML_SRC, /<div id="repairTableWrap" class="fh-scroll-x">/);
  assert.match(HTML_SRC, /<div class="fh-scroll-x">\s*<table class="queue" id="caseQueueTable">/);
});

test("the case queue paginates and rebuilds one row per click, not forty", () => {
  assert.ok(HTML_SRC.includes("var PAGE_ROWS = 25;"));
  assert.match(HTML_SRC, /id="caseMoreBtn"/);
  // The old shape: every click re-rendered the whole list, throwing away every
  // hidden detail including an 8,000-character letter textarea per case.
  assert.ok(
    !HTML_SRC.includes("renderCases(cases);"),
    "clicking a case row rebuilds the whole table again"
  );
  assert.ok(HTML_SRC.includes("tr.parentNode.insertBefore(detail, tr.nextSibling);"));
});
