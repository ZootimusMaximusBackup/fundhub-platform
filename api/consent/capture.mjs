// /api/consent/capture — the consent gate's capture flow.
//
//   GET  ?client_id=<uuid>[&kind=]
//        → { ok, kind, disclosure, status, history }
//        the words to show, whether a live consent exists, and the full trail
//        including revoked rows.
//
//   POST { client_id, action: "grant", capture_method, granted_name?,
//          consent_version?, expires_at?, document_id? }
//        → { ok, consent }
//
//   POST { client_id, action: "revoke", consent_id, reason }
//        → { ok, consent }
//
// *** THIS ENDPOINT DOES NOT PULL ANYBODY'S CREDIT AND SENDS NOTHING. ***
// It writes rows to `client_consents` and returns. The pull path is
// api/finance/soft-pull.mjs, which now refuses unless a row written here says
// the consumer agreed.
//
// A POST, NOT A GET, for grant AND for revoke. Same reasoning as the SSN reveal
// in api/pii.mjs and the soft-pull request next door: both are actions with a
// permanent effect on a consumer-credit record. GETs get prefetched, retried,
// cached and logged with their query strings, and a link-scanner must not be
// able to record that somebody consented — nor to withdraw a consent they are
// relying on.
//
// THE CONSENT TEXT IS NEVER READ FROM THE BODY. The caller sends a VERSION; the
// server looks up the words in src/consent/disclosures.mjs and stores its own
// copy. A body-supplied paragraph would let anybody who can reach this endpoint
// record that a consumer agreed to a sentence they never saw. See that file's
// header — this is the single most important line in this handler.
//
// ORG COMES FROM THE SESSION, ALWAYS. principal.orgId and nothing else. There is
// no org_id parameter on any method here, and a principal without one is
// refused rather than defaulted — a consent filed under a guessed org is a
// consent that gates the wrong tenant's credit pulls.
//
// THE ROLE GATE IS A SECOND CALL, NOT AN ARGUMENT. requireAuth's third
// parameter is { db, env }; a `roles` key there is accepted by the object
// literal and silently dropped, which is how api/read/tradelines.mjs shipped an
// ungated endpoint (see src/http/routes.test.mjs and src/http/auth-gate.test.mjs).
// This file resolves the principal first and then calls requireRole() for real.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid, requireRole, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { disclosureFor } from "../../src/consent/disclosures.mjs";
import {
  captureConsent,
  revokeConsent,
  consentStatus,
  listConsents,
  boundedLimit,
  CONSENT_KINDS,
  ConsentError
} from "../../src/consent/index.mjs";

/* Employees who may RECORD a consent given on a call or on paper, and who may
   revoke one at the consumer's request.

   Deliberately the SAME set as SOFT_PULL_ROLES in api/finance/soft-pull.mjs.
   Whoever may ask for a pull may record the permission that allows it, and
   nobody else: a wider set here would be a way around the narrower set there,
   since a consent is the thing that unlocks the pull. If one set moves, the
   other has to move with it, and somebody has to write down why.

   `owner` is listed explicitly. This file does not go through the
   requireRole(...allowed) middleware, so it does not inherit SUPER_ROLES, and an
   implicit super-role is exactly the kind of thing that should not be implicit
   on a consumer-consent endpoint. */
const CONSENT_ROLES = new Set(["owner", "admin", "closer", "funding_advisor"]);

const DEFAULT_KIND = "soft_pull_consent";

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff", "client"], { db });
  if (!principal) return;

  // THE SECOND GATE. requireRole() writes its own 403 and returns false.
  // Clients are not role-gated — they are gated by ownsClient() below, which is
  // a stronger check: a client principal may only ever act on themself.
  if (principal.kind === "staff" && !requireRole(res, principal.staff, CONSENT_ROLES)) return;

  // Fail closed on the org before any branch runs. A principal with no org
  // cannot have a row written for them and cannot be told about anybody's
  // consent; refusing beats picking a default org and filing under the wrong one.
  const orgId = principal.orgId;
  if (!orgId) {
    return res.status(400).json({ ok: false, error: "org_id is required" });
  }

  try {
    if (req.method === "GET") return await handleGet(req, res, principal, orgId);
    if (req.method === "POST") return await handlePost(req, res, principal, orgId);

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    if (e instanceof ConsentError) {
      return res.status(e.status).json({ ok: false, error: e.message, code: e.code });
    }
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    throw e;
  }
}

/* GET — what to show, and what is already on file.
 *
 * Returns the disclosure text so the screen never holds its own copy of the
 * wording. A screen with a hardcoded paragraph is a second source of truth for
 * the one string that has to be exact. */
async function handleGet(req, res, principal, orgId) {
  const q = req.query || {};
  if (!isUuid(q.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
  }
  // AWAITED. ownsClient() is async, and an un-awaited call returns a Promise,
  // which is truthy — `!promise` is false, so the refusal never fires and the
  // check is silently switched off. Both call sites in this file are awaited;
  // src/http/consent-capture.test.mjs proves it on GET and on POST separately,
  // because one missed await would leave the other test passing.
  if (!(await ownsClient(principal, q.client_id))) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const kind = normalizeKind(q.kind);
  if (!kind) {
    return res.status(400).json({ ok: false, error: `kind must be one of: ${CONSENT_KINDS.join(", ")}` });
  }

  const clientId = String(q.client_id).trim();
  const [status, history] = await Promise.all([
    consentStatus(db, { orgId, clientId, kind }),
    listConsents(db, { orgId, clientId, kind, limit: boundedLimit(q.limit) })
  ]);

  return res.status(200).json({
    ok: true,
    kind,
    disclosure: disclosureFor(kind),
    status,
    history
  });
}

async function handlePost(req, res, principal, orgId) {
  const body = req.body || {};
  if (!isUuid(body.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
  }
  // AWAITED — see the note on the same call in handleGet().
  if (!(await ownsClient(principal, body.client_id))) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const kind = normalizeKind(body.kind);
  if (!kind) {
    return res.status(400).json({ ok: false, error: `kind must be one of: ${CONSENT_KINDS.join(", ")}` });
  }

  const clientId = String(body.client_id).trim();

  // Attribution from the SESSION, never from the body — the same rule
  // api/finance/soft-pull.mjs states for its requester. A caller choosing its
  // own attribution is a caller with no attribution.
  const actor = principal.kind === "staff"
    ? { kind: "staff", id: principal.staffId }
    : { kind: "client", id: principal.accountId };

  const action = String(body.action ?? "grant").trim().toLowerCase();

  if (action === "revoke") {
    if (!isUuid(body.consent_id)) {
      return res.status(400).json({ ok: false, error: "consent_id must be a uuid" });
    }
    const consent = await revokeConsent(db, {
      orgId,
      consentId: String(body.consent_id).trim(),
      reason: body.reason,
      revokedBy: actor
    });
    return res.status(200).json({ ok: true, consent });
  }

  if (action !== "grant") {
    return res.status(400).json({ ok: false, error: "action must be one of: grant, revoke" });
  }

  /* THE WORDS COME FROM THE SERVER. body.consent_text is not read, and an
     unknown version is refused rather than silently upgraded to the current
     one — see src/consent/disclosures.mjs. */
  const disclosure = disclosureFor(kind, body.consent_version ?? null);
  if (!disclosure) {
    return res.status(400).json({
      ok: false,
      error: "unknown consent_version — refusing to record agreement to wording I cannot produce",
      code: "consent_version_unknown"
    });
  }

  const consent = await captureConsent(db, {
    orgId,
    clientId,
    kind,
    consentText: disclosure.text,
    consentVersion: disclosure.version,
    grantedBy: actor,
    captureMethod: body.capture_method,
    grantedName: body.granted_name ?? null,
    // Evidence for a web capture; legitimately absent for one recorded off a
    // phone call. Read from the request, never from the body — a caller-supplied
    // IP is not evidence of anything.
    capturedIp: clientIp(req),
    capturedUserAgent: headerValue(req, "user-agent"),
    documentId: isUuid(body.document_id) ? String(body.document_id).trim() : null,
    expiresAt: body.expires_at ?? null
  });

  return res.status(200).json({ ok: true, consent });
}

/* ownsClient — a staff principal may act on any client IN THEIR ORG, and the
   org is CHECKED, not assumed; a client principal may act only on themself.
   accounts.client_id is the binding, and it is the session's copy of it, not
   the body's.

   THE ORG CHECK IS THE POINT, NOT A FORMALITY. This function used to return
   `true` for any staff principal with no query at all, while the comment above
   it claimed it was lifted from api/finance/soft-pull.mjs and answered
   identically. It did not. The pull endpoint next door and
   api/finance/crs-pull.mjs both run `SELECT 1 FROM clients WHERE id = $1 AND
   org_id = $2`; this one ran nothing. The effect was that an employee at org A
   could name org B's consumer and have a consent row written, stamped with org
   A — and because a consent is the thing that unlocks a credit pull, the
   endpoint that was supposed to be no looser than the pull endpoint was in fact
   the way around it. The query below is now the same query, word for word, and
   src/http/consent-capture.test.mjs asserts that the two files still match. */
async function ownsClient(principal, clientId) {
  if (principal.kind === "staff") {
    if (!principal.orgId) return false;
    const r = await db.query(
      `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
      [String(clientId).trim(), principal.orgId]
    );
    return r.rows.length > 0;
  }
  return !!principal.clientId && String(principal.clientId) === String(clientId).trim();
}

/* normalizeKind — the requested kind, or null. Defaults to soft_pull_consent.
   An unrecognised one is refused rather than coerced to the default, so a typo
   does not silently record a consent of the wrong type. Permitted kinds live
   in CONSENT_KINDS (099 + 167). */
function normalizeKind(raw) {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_KIND;
  const k = String(raw).trim();
  return CONSENT_KINDS.includes(k) ? k : null;
}

function headerValue(req, name) {
  const h = req?.headers || {};
  if (h[name] !== undefined) return String(h[name]);
  const want = name.toLowerCase();
  for (const k of Object.keys(h)) if (k.toLowerCase() === want) return String(h[k]);
  return null;
}

/* clientIp — best effort, and null when there is no honest answer.
 *
 * x-forwarded-for is a list; the FIRST entry is the original client and the
 * rest are proxies. It is also caller-controllable, which is why this is
 * evidence rather than proof and why the column it lands in is nullable — a
 * fabricated IP is no worse than none, but a MISSING one must not be recorded
 * as some default. 099 stores it as inet, so a malformed value would be a
 * database error rather than a silently stored lie; anything that does not look
 * like an address is dropped here first. */
function clientIp(req) {
  const fwd = headerValue(req, "x-forwarded-for");
  const raw = fwd ? String(fwd).split(",")[0].trim() : (req?.socket?.remoteAddress ?? null);
  if (!raw) return null;
  // IPv4, IPv6, or IPv4-mapped IPv6 as Node hands it over ("::ffff:1.2.3.4").
  const candidate = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw)?.[1] ?? raw;
  const looksV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate);
  const looksV6 = /^[0-9a-f:]+$/i.test(candidate) && candidate.includes(":");
  return looksV4 || looksV6 ? candidate : null;
}
