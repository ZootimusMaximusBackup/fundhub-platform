// Inquiry Remover — the decision logic behind public/app/inquiry-remover.html.
//
// WHY THIS FILE EXISTS AT ALL. The screen is a static page with an inline
// script; there is no browser test harness in this repo and `npm test` globs
// src/** and scripts/** only, so anything that stays inside the HTML is
// untestable by construction. The parts of that screen that can be WRONG —
// which body a POST sends, when a row is allowed to look confirmed, and what a
// failure means to the person reading the banner — live here instead, as pure
// functions over plain values. The HTML keeps the DOM plumbing and nothing else.
//
// THE SAME SOURCE RUNS IN THE BROWSER. inquiry-remover.html carries a verbatim
// copy of this file's body between /* ==FHVIEW-BEGIN== */ and
// /* ==FHVIEW-END== */ markers, with the word `export ` stripped, wrapped in an
// IIFE that returns VIEW. inquiry-remover-view.test.mjs asserts that the copy is
// exactly that, so the two cannot drift: edit THIS file, then paste it across.
// A second copy that is merely "equivalent" is the failure mode AUDIT-FINDINGS
// describes — a fake modelling the thing you wish you had, which cannot fail
// when the real thing moves.
//
// FOUR RULES THIS FILE ENFORCES, BECAUSE A SCREEN CANNOT BE TRUSTED TO REMEMBER
// THEM ONCE PER CLICK SITE:
//
//   1. NO OPTIMISTIC UI. A row is never shown as Removed until the server has
//      said so. beginWrite() moves a row to "pending" and DOES NOT touch its
//      displayed state; only settleWrite(), fed the row the server returned,
//      changes what the queue claims. failWrite() puts back the snapshot taken
//      before the write. A credit-report action that appears to have happened
//      and did not is the worst failure this screen can produce.
//
//   2. THE SERVER'S NUMBER WINS. call_attempts is recomputed from the attempt
//      log inside the write transaction (see src/inquiries/work.mjs), so the
//      screen adopts what came back rather than incrementing its own copy. Two
//      counters that increment independently disagree the first time a request
//      is retried, and here the disagreement lands on a consumer's dispute
//      record.
//
//   3. NOTHING IS INVENTED. An empty note is omitted from the body rather than
//      sent as "", because "" is a note that says nothing and NULL is no note at
//      all. The confirm action does not restate the server's own default status.
//      A missing call_attempts in a response leaves the previous value alone
//      instead of resetting a row to zero attempts.
//
//   4. A FAILURE SAYS WHICH FAILURE. 404-because-unrouted, 401, 403, 400, a
//      database that is down and a 500 are five different problems with five
//      different fixes, and only one of them is worth a support ticket. They
//      also differ in whether the write is known not to have happened: a
//      rejected request certainly did not save, a transport error might have.
//      describeFailure() carries that distinction as `saved`, and no copy in
//      this file claims "nothing was saved" when that is not knowable.
//
// THE FOUR ATTEMPT KINDS ARE THE FOUR THE DATABASE ALLOWS. Migration 055 puts a
// CHECK constraint on inquiry_attempts.kind; offering a fifth in a dropdown
// would produce a 500 from a constraint violation at the far end of a click.

export const ATTEMPT_KINDS = ["call", "letter", "portal", "note"];

// Mirrors COUNTING_KINDS in src/inquiries/work.mjs: a working note is logged in
// the same timeline but does not count toward call_attempts, because a desk that
// inflates its attempt count is lying to a bureau, slowly.
export const COUNTING_KINDS = ["call", "letter", "portal"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ViewError extends Error {
  constructor(message) {
    super(message);
    this.name = "ViewError";
  }
}

export function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

/* blankToNull — "the user typed nothing" is not a value. Whitespace-only input
   collapses to null so it is omitted from a body rather than stored as text
   nobody wrote. */
export function blankToNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/* pill — status text → the pill class the screen renders.
   Mapped ONLY where the wording is unambiguous. inquiry_log.status is free text
   written by several producers (the external Airtable runtime among them), so an
   unrecognised value keeps its real text on a neutral pill and is counted into
   the banner as unmapped. A complete mapping would be an invention, and 055
   deliberately declined to constrain the column for the same reason. */
export function pill(status, outcome) {
  const s = String(status || outcome || "").trim();
  const k = s.toLowerCase();
  if (!s) return { cls: "new", text: "No status recorded", known: false, done: false };
  if (/removed|confirmed|deleted|cleared/.test(k)) return { cls: "confirmed", text: s, known: true, done: true };
  if (/no answer|unreachable/.test(k)) return { cls: "noanswer", text: s, known: true, done: false };
  if (/filed|sent|progress|pending/.test(k)) return { cls: "progress", text: s, known: true, done: false };
  if (/new|queued/.test(k)) return { cls: "new", text: s, known: true, done: false };
  return { cls: "", text: s, known: false, done: false };
}

/* ── REQUEST SHAPING ──────────────────────────────────────────────────────────
   Every builder returns { method, path, body? } and throws rather than
   producing a request that cannot succeed. The ids come from data- attributes
   the wiring block copies off the read response; a row rendered from the sample
   markup has none, and firing a POST at a missing or malformed id would be a
   write aimed at nothing.                                                     */

function requireInquiryId(id) {
  if (!isUuid(id)) throw new ViewError("inquiry_id must be a uuid — this row is not a database row");
}

function requireClientId(id) {
  if (!isUuid(id)) throw new ViewError("client_id must be a uuid — this row is not a database row");
}

export function buildAttemptRequest(opts) {
  const o = opts || {};
  requireInquiryId(o.inquiryId);
  const kind = o.kind === undefined || o.kind === null ? "call" : String(o.kind);
  if (ATTEMPT_KINDS.indexOf(kind) === -1) {
    throw new ViewError("unknown attempt kind: " + kind);
  }
  const body = { inquiry_id: o.inquiryId, action: "attempt", kind: kind };
  const outcome = blankToNull(o.outcome);
  const note = blankToNull(o.note);
  if (outcome !== null) body.outcome = outcome;
  if (note !== null) body.note = note;
  return { method: "POST", path: "/api/inquiries", body: body };
}

/* confirmRemoval defaults to status "Removed" server-side, chosen there to match
   wording already present in the live data. Restating it here would fork the
   default across two files; the screen sends a status only when a human typed
   one. */
export function buildConfirmRequest(opts) {
  const o = opts || {};
  requireInquiryId(o.inquiryId);
  const body = { inquiry_id: o.inquiryId, action: "confirm" };
  const status = blankToNull(o.status);
  if (status !== null) body.status = status;
  return { method: "POST", path: "/api/inquiries", body: body };
}

export function buildStatusRequest(opts) {
  const o = opts || {};
  requireInquiryId(o.inquiryId);
  const status = blankToNull(o.status);
  if (status === null) throw new ViewError("a status is required");
  return {
    method: "POST",
    path: "/api/inquiries",
    body: { inquiry_id: o.inquiryId, action: "status", status: status }
  };
}

export function buildAttemptsRequest(opts) {
  const o = opts || {};
  requireInquiryId(o.inquiryId);
  return { method: "GET", path: "/api/inquiries?inquiry_id=" + encodeURIComponent(o.inquiryId) };
}

export function buildIdentityRequest(opts) {
  const o = opts || {};
  requireClientId(o.clientId);
  return { method: "GET", path: "/api/pii?client_id=" + encodeURIComponent(o.clientId) };
}

/* buildRevealRequest — the only call in this file that discloses a protected
   value, and the only one that refuses to run on missing input rather than
   defaulting it.

   THE REASON IS NOT OPTIONAL HERE. src/pii/index.mjs states it as rule 4 — "A
   REASON IS REQUIRED. Every reveal records who, what field, and when" — and
   api/pii.mjs now rejects a reveal with no reason with a 400, so this check is
   the screen agreeing with the server rather than substituting for it. Keep
   both: failing here means the user gets told before a request is sent, and
   failing there means curl gets told too. What this must NEVER do is satisfy
   the parameter with filler, which would fill the audit log with a sentence
   nobody wrote and make every entry equally worthless.

   The reason and the client id travel in the BODY. Nothing here goes in a URL:
   query strings are logged, cached and forwarded by things nobody audits. */
export function buildRevealRequest(opts) {
  const o = opts || {};
  requireClientId(o.clientId);
  const reason = blankToNull(o.reason);
  if (reason === null) {
    throw new ViewError("a reason is required — every reveal is written to pii_access_log");
  }
  return {
    method: "POST",
    path: "/api/pii",
    body: { client_id: o.clientId, action: "reveal", reason: reason }
  };
}

/* ── FAILURE → BANNER COPY ────────────────────────────────────────────────────
   `res` is what the HTML's send() produces and never a thrown error:
     { transport: true, detail }        the request never got an answer
     { status, body }                   an answer, body possibly null
   Returns { code, tone, text, status, scope, saved } where `saved` is "no" when
   the request is known to have been rejected before any write, and "unknown"
   when it might have landed.                                                  */

const ENDPOINT = { inquiry: "/api/inquiries", identity: "/api/pii" };

function failure(code, text, extra) {
  return Object.assign({ code: code, tone: "error", text: text, status: null, saved: "no" }, extra || {});
}

export function describeFailure(res, opts) {
  const scope = (opts && opts.scope) === "identity" ? "identity" : "inquiry";
  const endpoint = ENDPOINT[scope];
  const body = res && res.body && typeof res.body === "object" ? res.body : null;
  const detail = body && typeof body.error === "string" ? body.error : null;
  const suffix = detail ? " (" + detail + ")" : "";

  // No answer at all. The request may have reached the server and committed
  // before the connection dropped, so this is the one case that must not tell
  // the user their click did nothing.
  if (!res || res.transport) {
    return failure("offline",
      "could not reach " + endpoint + " — reload before assuming this did not save" +
      (res && res.detail ? " (" + res.detail + ")" : ""),
      { scope: scope, saved: "unknown" });
  }

  const status = Number(res.status) || 0;
  const base = { status: status, scope: scope };

  // TWO DIFFERENT 404s. The router's fallthrough answers {error:"not_found",
  // path:"..."} for a path nothing serves — the endpoint is in the repo and not
  // deployed, which is an ops problem. A 404 from the handler itself means the
  // row is gone, which is a data problem. Telling a closer the backend is down
  // when it is up and answering honestly sends someone hunting a fault that
  // does not exist.
  if (status === 404 && body && body.error === "not_found" && typeof body.path === "string") {
    return failure("unrouted",
      endpoint + " is not deployed — the handler exists but no route serves it. Nothing was saved.",
      base);
  }
  if (status === 404) {
    return failure("not_found",
      scope === "identity"
        ? "no identity on file for this client" + suffix
        : "that inquiry is no longer in the database" + suffix,
      base);
  }
  if (status === 401) {
    return failure("unauthorized", "your session has expired — sign in again. Nothing was saved.", base);
  }
  if (status === 403) {
    return failure("forbidden",
      scope === "identity"
        ? "your role cannot see identity data — /api/pii is limited to owner, admin, inquiry specialist and funding advisor"
        : "your role cannot write to the inquiry queue. Nothing was saved.",
      base);
  }
  if (status === 400) {
    return failure("bad_request", "the request was rejected" + suffix + ". Nothing was saved.", base);
  }
  if (status === 405) {
    return failure("method_not_allowed", endpoint + " refused the method. Nothing was saved.", base);
  }
  // requirePrincipal answers 503 {error:"auth_unavailable", db:"down"} when the
  // session lookup itself could not run — the write never started.
  if (status === 503 && body && (body.error === "auth_unavailable" || body.db === "down")) {
    return failure("db_down", "the database is unreachable — nothing was saved", base);
  }
  // The other 503 on this screen is PiiError's: the encryption key is not set,
  // so the server is refusing to handle identity data at all.
  if (status === 503) {
    return failure("unavailable",
      (detail || "the endpoint is unavailable") + " — nothing was saved", base);
  }
  if (status >= 500) {
    return failure("server_error",
      "the server failed" + suffix + " — reload before assuming this did not save",
      Object.assign({ saved: "unknown" }, base));
  }
  return failure("unexpected", "unexpected response " + status + suffix, Object.assign({ saved: "unknown" }, base));
}

/* interpretWrite — the single place a POST /api/inquiries response becomes
   either a row to render or a banner to show. A 200 whose body is not
   {ok:true} is a failure however friendly its status code was. */
export function interpretWrite(res) {
  if (res && !res.transport && Number(res.status) === 200 &&
      res.body && res.body.ok === true) {
    return { ok: true, inquiry: res.body.inquiry || null };
  }
  return { ok: false, failure: describeFailure(res, { scope: "inquiry" }) };
}

/* interpretAttempts — GET /api/inquiries?inquiry_id=. An empty list is an
   answer: a row nobody has worked yet has no attempts, which is different from
   a history we could not fetch. */
export function interpretAttempts(res) {
  if (res && !res.transport && Number(res.status) === 200 &&
      res.body && res.body.ok === true && Array.isArray(res.body.attempts)) {
    return { ok: true, attempts: res.body.attempts };
  }
  return { ok: false, failure: describeFailure(res, { scope: "inquiry" }) };
}

export function interpretIdentity(res) {
  if (res && !res.transport && Number(res.status) === 200 &&
      res.body && res.body.ok === true) {
    // A client with no identity row is a 200 with identity:null. That is an
    // answer, not a failure — "we have nothing on file" is a fact the screen
    // should state plainly.
    return { ok: true, identity: res.body.identity || null };
  }
  return { ok: false, failure: describeFailure(res, { scope: "identity" }) };
}

export function interpretReveal(res) {
  if (res && !res.transport && Number(res.status) === 200 &&
      res.body && res.body.ok === true && typeof res.body.ssn === "string") {
    return { ok: true, ssn: res.body.ssn };
  }
  return { ok: false, failure: describeFailure(res, { scope: "identity" }) };
}

/* ── IDENTITY DISPLAY ─────────────────────────────────────────────────────────
   Masked is the default and the only thing rendered without a deliberate act.
   Three states, none of them guessed:
     no row at all           → nothing is on file for this person
     row without an SSN      → we hold a DOB/addresses but no number
     row whose key is missing→ readIdentity() returns ssn_last4:null when the
                               ciphertext cannot be opened. That is "unavailable",
                               NOT "this client has no SSN", and the difference
                               decides whether someone goes looking for a key. */
export function maskedSsnLabel(identity) {
  if (!identity) return { text: "no identity record on file", present: false, degraded: false };
  if (!identity.ssn_present) return { text: "no SSN on file", present: false, degraded: false };
  if (!identity.ssn_last4) {
    return { text: "SSN on file · last four unavailable", present: true, degraded: true };
  }
  return { text: "SSN ***-**-" + String(identity.ssn_last4), present: true, degraded: false };
}

export function canReveal(identity) {
  return !!(identity && identity.ssn_present);
}

/* formatRevealed — group nine digits for reading. Anything that is not nine
   digits is returned untouched: reshaping a value we do not recognise would be
   asserting something about it. */
export function formatRevealed(ssn) {
  const raw = ssn === null || ssn === undefined ? "" : String(ssn);
  const d = raw.replace(/\D/g, "");
  if (d.length !== 9) return raw;
  return d.slice(0, 3) + "-" + d.slice(3, 5) + "-" + d.slice(5);
}

/* ── THE ROW STATE MACHINE ────────────────────────────────────────────────────
   idle → pending → idle. Three transitions, no fourth, and the displayed state
   changes on exactly one of them.

   `done` is the flag that decides whether a row reads as Removed, so it has two
   sources and takes either: confirmed_at is the unambiguous one 055 added, and
   the free-text status is what the external runtime writes. Requiring both
   would un-confirm rows that were confirmed before 055 existed.               */

export function createRowState(row) {
  const r = row || {};
  const p = pill(r.status, r.outcome);
  return {
    phase: "idle",
    status: r.status === undefined ? null : r.status,
    outcome: r.outcome === undefined ? null : r.outcome,
    attempts: r.call_attempts === undefined || r.call_attempts === null
      ? null : Number(r.call_attempts),
    done: r.confirmed_at ? true : p.done,
    pending: null,
    error: null,
    refused: null,
    snapshot: null,
    stale: false
  };
}

function idleFrom(base) {
  return {
    phase: "idle",
    status: base.status,
    outcome: base.outcome,
    attempts: base.attempts,
    done: base.done,
    pending: null,
    error: null,
    refused: null,
    snapshot: null,
    stale: false
  };
}

/* beginWrite — arm the write. NOTE WHAT IT DOES NOT DO: it does not change
   status, done or attempts. The row goes on looking exactly as it did until the
   server answers. A second click while one is in flight is refused rather than
   sent, because two attempt POSTs for one human action is a double-count on a
   dispute record. */
export function beginWrite(state, action) {
  if (state.phase === "pending") {
    return Object.assign({}, state, { refused: "busy" });
  }
  return Object.assign({}, state, {
    phase: "pending",
    pending: action || null,
    error: null,
    refused: null,
    stale: false,
    snapshot: {
      status: state.status,
      outcome: state.outcome,
      attempts: state.attempts,
      done: state.done
    }
  });
}

/* settleWrite — adopt the row the server returned. Fields the response did not
   carry keep the value they had; a response is not a statement that everything
   it omitted is now empty. */
export function settleWrite(state, inquiry) {
  const base = state.snapshot || state;
  if (!inquiry || typeof inquiry !== "object") {
    // The write succeeded and we cannot show what it produced. Say so rather
    // than painting a state nobody sent.
    return Object.assign(idleFrom(base), { stale: true });
  }
  const status = inquiry.status === undefined ? base.status : inquiry.status;
  const outcome = inquiry.outcome === undefined ? base.outcome : inquiry.outcome;
  const attempts = inquiry.call_attempts === undefined || inquiry.call_attempts === null
    ? base.attempts
    : Number(inquiry.call_attempts);
  const done = !!inquiry.confirmed_at || pill(status, outcome).done;
  return {
    phase: "idle",
    status: status,
    outcome: outcome,
    attempts: attempts,
    done: done,
    pending: null,
    error: null,
    refused: null,
    snapshot: null,
    stale: false
  };
}

/* failWrite — put the row back exactly as it was and hang the failure off it.
   The restore is from the snapshot beginWrite took, not from re-reading the
   DOM, so a half-applied render cannot survive as the new truth. */
export function failWrite(state, fail) {
  const base = state.snapshot || state;
  return Object.assign(idleFrom(base), { error: fail || null });
}

/* attemptsDelta — how far the Calls tile should move. Derived from the two
   counts rather than assumed to be +1, because the server recomputes the
   counter and a retry can legitimately produce no change at all. Unknown on
   either side means no movement: a tile must not drift on a guess. */
export function attemptsDelta(before, after) {
  if (typeof before !== "number" || typeof after !== "number") return 0;
  if (!isFinite(before) || !isFinite(after)) return 0;
  return after - before;
}

/* ── THE ATTEMPT HISTORY ──────────────────────────────────────────────────────
   The work strip's log used to hold this session's clicks and nothing else, so
   it emptied on reload. listAttempts() serves the real dated trail — which is
   the thing migration 055 added the table for: "a counter cannot answer what
   happened on the second call, and a bureau dispute wants a dated trail".

   attemptLine renders ONLY what the query selected. An attempt with no outcome
   and no note is a kind and a date, and that is what it renders — the blank is
   the record, and filling it with "no outcome recorded" would put words into an
   append-only log of what a human did to a consumer's credit file. */
export function attemptLine(attempt) {
  const a = attempt || {};
  const parts = [String(a.kind || "attempt")];
  // outcome first, note second: an outcome is what happened, a note is colour.
  const detail = blankToNull(a.outcome) || blankToNull(a.note);
  if (detail) parts.push(detail);
  const who = blankToNull(a.staff_name);
  if (who) parts.push(who);
  const when = formatWhen(a.created_at);
  if (when) parts.push(when);
  return parts.join(" · ");
}

/* formatWhen — a timestamp the desk can read, or null. A date that will not
   parse renders as nothing rather than as "Invalid Date". */
export function formatWhen(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function pendingLabel(action) {
  if (action === "attempt") return "logging attempt...";
  if (action === "confirm") return "confirming removal...";
  if (action === "status") return "saving status...";
  return "saving...";
}

/* ── CASE QUEUE (inquiry gate) ───────────────────────────────────────────────
   Expanding-row helpers for inquiry_removal_cases. Send is human-only. */

export function caseUiStatus(row) {
  const r = row || {};
  const st = String(r.case_status || "");
  if (st === "Blocked") return { label: "Blocked (docs)", cls: "noanswer" };
  if (st === "Completed") return { label: "Complete", cls: "confirmed" };
  if (r.call_fired_at) return { label: "Awaiting Call", cls: "progress" };
  if (r.call_due_at || r.first_delivery_at || r.letter_provider_id || r.portal_confirmation) {
    return { label: "Sent", cls: "progress" };
  }
  if (st === "Queued" || st === "Scheduled") return { label: "Ready for Review", cls: "new" };
  if (st === "In Progress") return { label: "Sent", cls: "progress" };
  return { label: st || "Unknown", cls: "" };
}

export function caseCallState(row, now) {
  const r = row || {};
  if (r.call_fired_at) return "done";
  if (!r.call_due_at) return "not due";
  const due = new Date(r.call_due_at).getTime();
  const t = (now || new Date()).getTime();
  if (Number.isFinite(due) && due <= t) return "due";
  return "not due";
}

export function buildCaseSendRequest(opts) {
  const o = opts || {};
  if (!isUuid(o.caseId)) throw new ViewError("case id must be a uuid");
  const mail = o.mail === true;
  const portal = o.portal === true;
  if (!mail && !portal) throw new ViewError("select mail and/or portal");
  const body = { id: o.caseId, action: "send", mail: mail, portal: portal };
  if (portal) {
    const ref = blankToNull(o.portalConfirmation);
    if (ref === null) {
      throw new ViewError("Experian portal reference number is required");
    }
    body.portal_confirmation = ref;
    const uploaded = blankToNull(o.portalUploadedAt);
    if (uploaded !== null) body.portal_uploaded_at = uploaded;
  }
  const note = blankToNull(o.note);
  if (note !== null) body.note = note;
  const serviceLevel = blankToNull(o.mailServiceLevel || o.mail_service_level);
  if (serviceLevel !== null) body.mail_service_level = serviceLevel;
  return { method: "POST", path: "/api/inquiry-cases", body: body };
}

export const VIEW = {
  ATTEMPT_KINDS: ATTEMPT_KINDS,
  COUNTING_KINDS: COUNTING_KINDS,
  ViewError: ViewError,
  isUuid: isUuid,
  blankToNull: blankToNull,
  pill: pill,
  buildAttemptRequest: buildAttemptRequest,
  buildConfirmRequest: buildConfirmRequest,
  buildStatusRequest: buildStatusRequest,
  buildAttemptsRequest: buildAttemptsRequest,
  buildIdentityRequest: buildIdentityRequest,
  buildRevealRequest: buildRevealRequest,
  describeFailure: describeFailure,
  interpretWrite: interpretWrite,
  interpretIdentity: interpretIdentity,
  interpretReveal: interpretReveal,
  maskedSsnLabel: maskedSsnLabel,
  canReveal: canReveal,
  formatRevealed: formatRevealed,
  createRowState: createRowState,
  beginWrite: beginWrite,
  settleWrite: settleWrite,
  failWrite: failWrite,
  attemptsDelta: attemptsDelta,
  attemptLine: attemptLine,
  formatWhen: formatWhen,
  interpretAttempts: interpretAttempts,
  pendingLabel: pendingLabel,
  caseUiStatus: caseUiStatus,
  caseCallState: caseCallState,
  buildCaseSendRequest: buildCaseSendRequest
};
