// GET /api/read/portal-summary — client-safe file summary for the portal.
//
// Returns pre-qual, 3-bureau + Experian business scores, client-safe document
// metadata, and whether an inquiry case is open (the portal's inquiry upload
// door hangs off that one flag). Clients read their own file only; staff may
// pass ?client_id= when previewing the portal.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, redact } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { listClientLibrary } from "../../src/documents/retrieve.mjs";
import { secretFromEnv, DEFAULT_TTL_SECONDS } from "../../src/documents/signed-url.mjs";
import {
  formatPrequalUsd,
  portalCreditScores,
  prequalFromCustomFields
} from "../../src/http/portal-prequal.mjs";

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["staff", "client"], { db });
  if (!principal) return;

  let orgId = null;
  let clientId = null;

  if (principal.kind === "client") {
    clientId = principal.clientId || null;
    orgId = principal.orgId || null;
    if (!clientId || !orgId) {
      return res.status(403).json({
        ok: false,
        error: "forbidden",
        message: "Your login is not attached to a client file."
      });
    }
  } else {
    const staff = principal.staff || { role: principal.role };
    if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
    orgId = staff.org_id || null;
    if (!orgId) {
      return res.status(400).json({ ok: false, error: "org_required" });
    }
    const qid = req.query && req.query.client_id;
    if (qid != null && qid !== "" && !isUuid(qid)) {
      return res.status(400).json({ ok: false, error: "invalid_client_id" });
    }
    clientId = qid || null;
    if (!clientId) {
      return res.status(400).json({
        ok: false,
        error: "client_id_required",
        message: "Pick a client to load portal summary."
      });
    }
  }

  /* FAIL CLOSED ON THE LINK, NOT ON THE PAGE.
     secretFromEnv() throws when DOCUMENT_URL_SECRET is missing or too short —
     that is the "no secret, no links" rule and it is correct. But signing runs
     inside the documents query here, so letting it throw would turn a missing
     config into a 500 for the client's ENTIRE file summary: scores, pre-qual,
     upload doors, all of it, gone because a link could not be signed. So the
     secret is checked once, up front. No secret means unsigned rows, which is
     exactly today's behaviour — the list still renders, and paintDocs() falls
     back to plain text for every row rather than offering a dead link.

     TTL: DEFAULT_TTL_SECONDS, fifteen minutes. These links are minted on every
     portal load whether or not anybody clicks one, so they are cheap to reissue
     and a reload always brings fresh ones — which argues for short. Fifteen
     minutes is the shortest window that still comfortably covers the real
     journey: land on the portal, read the page, open "Account & history",
     switch to the Documents tab, then click. Anything shorter starts expiring
     links under a client who is simply reading. Deliberately NOT the 7-day
     MAX_TTL_SECONDS: that is for a link inside an email, which has to survive a
     weekend; a link in a page the reader already has open does not.

     NO baseUrl, so the link is a same-origin PATH. Working an origin out from
     request headers means guessing a protocol — with no x-forwarded-proto it
     has to assume https, which is right behind Netlify and wrong against a
     plain-http dev server, where the link then will not load at all. The portal
     renders this link inside a page already served from this origin, so a path
     is both correct everywhere and one less thing to get wrong. */
  let signing = false;
  try {
    secretFromEnv();
    signing = { ttlSeconds: DEFAULT_TTL_SECONDS };
  } catch {
    signing = false;               // no secret, no links — the page still loads
  }

  try {
    const clientRes = await db.query(
      `SELECT id, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    const client = clientRes.rows[0];
    if (!client) {
      return res.status(404).json({ ok: false, error: "client_not_found" });
    }

    const [documentsRes, crsRes, bizRes, inquiryRes] = await Promise.all([
      /* THE DOCUMENTS LIST NOW CARRIES A WORKING LINK.
         This was a hand-written SELECT over `documents` that signed nothing, so
         every row reached the portal with `download` undefined and
         paintDocs() (public/app/client-portal.html) silently fell back to plain
         text. The front end has always been built to render the link; there was
         simply never a link in the payload, so a client's uploaded ID or a
         letter we generated for them was openable exactly once — in the reply to
         its own upload, for fifteen minutes — and never again.

         listClientLibrary() is the reader that was written for this and had zero
         callers. It takes orgId AND clientId and throws without both, so the
         two-key scoping this endpoint depends on cannot be forgotten here the
         way src/http/read-api.mjs:150-153 records it being forgotten in ten
         other endpoints. */
      listClientLibrary(db, { orgId, clientId, sign: signing }),
      db.query(
        `SELECT id, outcome_tier, result, created_at, is_demo
           FROM crs_results
          WHERE client_id = $1 AND org_id = $2
            AND is_demo IS NOT TRUE
          ORDER BY created_at DESC`,
        [clientId, orgId]
      ),
      db.query(
        `SELECT name, age_months, entity_data
           FROM businesses
          WHERE client_id = $1 AND org_id = $2
          ORDER BY updated_at DESC
          LIMIT 5`,
        [clientId, orgId]
      ),
      /* THE INQUIRY UPLOAD DOOR HANGS OFF THIS ONE ROW.
         The portal's "Send a file" doors were gated only on entitlements, and
         the inquiry-removal product deliberately grants none
         (db/migrations/180_product_entitlements_seed.sql: "no shipped code
         anywhere says what an inquiry removal entitles the client to").
         So a client whose file says `inquiry:docs_needed` — asked by DOC-01 for
         an ID, proof of address and an authorization — read "0 unlocked" and
         had no door to send them through. An open case is a fact on the file,
         not an offer decision, so it is the honest gate. */
      db.query(
        `SELECT 1
           FROM inquiry_removal_cases
          WHERE client_id = $1 AND org_id = $2
            AND closed_at IS NULL
            AND is_demo IS NOT TRUE
          LIMIT 1`,
        [clientId, orgId]
      )
    ]);

    const cf = client.custom_fields || {};
    const prequalAmount = prequalFromCustomFields(cf);
    const scores = portalCreditScores({
      client,
      crsResults: crsRes.rows,
      businesses: bizRes.rows
    });

    return res.status(200).json(redact({
      ok: true,
      prequal_amount: prequalAmount,
      prequal_display: formatPrequalUsd(prequalAmount),
      scores,
      soft_pull_complete: cf.crs_paid === true
        || String(cf.analyzer_status || "").toLowerCase() === "complete",
      doc_agent_message: cf.doc_agent_message || null,
      inquiry_open: inquiryRes.rows.length > 0,
      documents: portalDocuments(documentsRes)
    }));
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "read_failed",
      message: "Something went wrong loading your file summary.",
      detail: safeError(err)
    });
  }
}

/* portalDocuments — listClientLibrary()'s rows, narrowed back to exactly the
 * fields this endpoint has always returned, plus `download`.
 *
 * THE NARROWING IS THE SECURITY-RELEVANT PART, not a tidy-up. listClientLibrary
 * selects the registry's full public column set, which is right for its other
 * callers and wrong to hand a consumer: it carries `metadata` — for an upload
 * that holds the original filename and an `uploaded_by` object naming the STAFF
 * MEMBER's id — plus `checksum`, `generated_by`, `signer_ref`, `org_id` and
 * `current_version_id`. None of that was in this response yesterday and none of
 * it is anything a client's portal needs. Passing the rows straight through
 * would have been a quiet widening of what a consumer can read about their own
 * file and about the people handling it. The allow-list below is the whole
 * defence, so add to it only deliberately.
 *
 * ORDER AND LIMIT ARE PRESERVED DELIBERATELY. The old SELECT was
 * `ORDER BY created_at DESC LIMIT 50`; listClientLibrary orders by kind and
 * takes everything. Re-sorting and slicing here keeps the portal's list in the
 * order the client already knows and keeps the payload the same size, so this
 * change adds a link and changes nothing else on the screen.
 *
 * AN EXPIRED DOCUMENT GETS NO LINK. api/documents/[id].mjs refuses an expired
 * document even with a valid signature, so a link on one of those rows would be
 * a control that cannot finish. The row still appears — an expired soft-pull
 * authorization is still something the client owns and may need to see.
 */
function portalDocuments(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 50)
    .map((d) => ({
      id: d.id,
      document_key: d.document_key,
      kind: d.kind,
      subtype: d.subtype,
      title: d.title,
      mime_type: d.mime_type,
      byte_size: d.byte_size,
      generated_at: d.generated_at,
      delivered_at: d.delivered_at,
      delivery_channel: d.delivery_channel,
      delivery_status: d.delivery_status,
      signature_required: d.signature_required,
      signed_at: d.signed_at,
      created_at: d.created_at,
      download: d.expired ? null : (d.download || null)
    }));
}
