// GET/POST /api/contracts/sign?id=<uuid>&exp=<unix>&sig=<hex>
//
// The one endpoint a client ever touches. It is what public/contract.html talks
// to, and it is the only route in this repository besides api/documents/[id].mjs
// that serves somebody with no session at all.
//
//   GET   → { ok, contract }  the words, and whether they can still be signed.
//           Records the view: first one stamps viewed_at, every one bumps
//           view_count.
//   POST  → { ok, contract }  the signature: typed name + ticked box + the time
//           + the IP. Refused if the words have changed since they were sent.
//
// ─────────────────────────────────────────────────────────────────────────────
// AUTH IS THE SIGNATURE, NOT A SESSION — copied from api/documents/[id].mjs,
// which the brief named as the pattern to follow, and for the identical reason:
// a link in an email has to work for a person who is not signed in and never
// will be, so the HMAC and its expiry ARE the credential.
//
// Consequences, all deliberate and all inherited from that file:
//
//   - FAIL CLOSED with no signing secret. No secret, no links, no signing —
//     never an unauthenticated open door. That case answers 503 not_configured,
//     because it is OUR misconfiguration and not the caller's.
//   - Constant-time signature comparison, done inside signed-link.mjs.
//   - A bad signature, an expired link, an unknown id and a draft contract are
//     ALL 404 with the same body. Distinguishing them turns this endpoint into
//     an oracle for which contract ids exist.
//   - No org_id is read from anywhere. The anonymous caller has no org, and
//     asking them to name one is an invitation to guess.
//
// WHAT IT NEVER RETURNS: sent_by, created_by, org_id, the document ids, or the
// merge values. src/contracts/sign.mjs shapes the response to the fields the
// page actually renders; the rest is internal and goes nowhere near a client.
//
// SIGNING IS A POST AND VIEWING IS A GET, and the split is not cosmetic. A GET
// is prefetched by link scanners, retried by browsers, cached and logged with
// its query string. Recording a view that way is harmless and useful. Recording
// a SIGNATURE that way would let a corporate mail scanner sign somebody's
// funding agreement for them. Same reasoning api/consent/capture.mjs and
// api/pii.mjs both record for their own writes.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../../src/db.mjs";
import { isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { verifyContractUrl } from "../../src/contracts/signed-link.mjs";
import { viewForSigning, sign } from "../../src/contracts/sign.mjs";
import { ContractError } from "../../src/contracts/errors.mjs";

const GONE = (res) => res.status(404).json({ ok: false, error: "not_found" });

/* The client's IP, as the record of where a signature came from.
   netlify/functions/api.mjs already resolves x-nf-client-connection-ip and the
   first x-forwarded-for hop onto req.socket.remoteAddress; the header fallbacks
   are here so the handler is not wrong when it runs under a different adapter
   (scripts/dev-server.mjs, or a test calling it directly). */
function clientIp(req) {
  const h = req.headers || {};
  const raw =
    req.socket?.remoteAddress ||
    h["x-nf-client-connection-ip"] ||
    String(h["x-forwarded-for"] || "").split(",")[0].trim() ||
    null;
  const ip = raw ? String(raw).trim() : "";
  return ip ? ip.slice(0, 100) : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  /* The link's parameters ride the query string on BOTH methods. A signed link
     is a URL; putting half of it in a POST body would mean the page had to hold
     the signature somewhere and re-send it, and a page that can be induced to
     re-send a credential is a worse shape than one that never handles it. */
  const q = req.query || {};
  const contractId = q.id;

  // Shape check first: a malformed id must not reach Postgres as a 22P02.
  if (!isUuid(contractId)) return GONE(res);

  const verdict = verifyContractUrl({
    contractId, expiresAt: q.exp, sig: q.sig
  });
  if (!verdict.valid) {
    if (verdict.reason === "no_secret") {
      return res.status(503).json({
        ok: false, error: "not_configured",
        message: "This link cannot be checked right now. Please contact the person who sent it."
      });
    }
    if (verdict.reason === "expired") {
      /* THE ONE FAILURE THAT IS TOLD APART FROM THE REST, and it is a
         deliberate exception to the oracle rule above. An expired link is the
         commonest thing that goes wrong here and it is entirely benign: the
         holder had a valid link, time passed. Telling them "this link has
         expired, ask for a new one" is the difference between a two-minute fix
         and a lost client. It leaks that a contract exists — which the person
         holding a validly-signed link already knew, because they were sent it.
         A forged or wrong signature still gets the undifferentiated 404. */
      return res.status(410).json({
        ok: false, error: "link_expired",
        message: "This link has expired. Please ask for a new one — nothing has been lost."
      });
    }
    return GONE(res);
  }

  try {
    if (req.method === "GET") {
      const out = await viewForSigning(db, { contractId });
      res.setHeader("cache-control", "private, no-store");
      res.setHeader("x-content-type-options", "nosniff");
      return res.status(200).json({ ok: true, contract: out.contract });
    }

    const body = req.body || {};
    const out = await sign(db, {
      contractId,
      signerName: body.signer_name,
      agreed: body.agreed === true,
      ip: clientIp(req),
      userAgent: (req.headers || {})["user-agent"] || null
    });
    res.setHeader("cache-control", "private, no-store");
    return res.status(200).json({
      ok: true, contract: out.contract,
      message: "Signed. A copy is saved with the time you signed it."
    });
  } catch (err) {
    if (err instanceof ContractError) {
      // A contract that does not exist, or is still a draft, is a 404 with the
      // same body as a forged link — see the oracle note in the header.
      if (err.status === 404) return GONE(res);
      return res.status(err.status).json({
        ok: false, error: err.code, message: err.message
      });
    }
    if (err && CLIENT_DATA_ERRORS.has(err.code)) return GONE(res);
    return res.status(500).json({ ok: false, error: "sign_failed", message: safeError(err) });
  }
}

export const __test = { clientIp };
