// GET /api/read/underwrite?client_id=<uuid> — the UnderwriteIQ funding read.
//
// Returns the vendored engine's assessment, its own suggestion sentences, THE
// NUMBERS BEHIND EACH SENTENCE, and a named list of every field the owner has not
// entered that a sentence is leaning on. See src/underwrite/engine.mjs for what
// the engine is and the four things about it that bite a caller.
//
// ALL THE I/O IS HERE. The engine, the adapter and the report assembler are pure
// functions over rows — same split as src/tradelines/store.mjs vs
// src/tradelines/index.mjs, and for the same reason: the rules that decide what a
// client is told have to be testable without Postgres.
//
// THE SENTENCES ARE RETURNED VERBATIM. This endpoint does not rewrite, soften,
// extend or summarise them, and it adds no approval claim of its own. The
// engine's strings are the product; everything this file adds sits beside them.
//
// ── THE ROLE GATE IS TWO CALLS, NOT ONE ARGUMENT ──
// requireAuth's third parameter is { db, env }, forwarded to authenticate(),
// which destructures exactly those two names — a `roles` key is accepted by the
// object literal and silently dropped. api/read/tradelines.mjs shipped that once
// and the effective gate became "any authenticated staff session, any role" on a
// named client's credit data. Written out as a real requireRole() call here, the
// same way api/read/finance-os.mjs does it.
//
// ROLE_SETS.STAFF, matching api/read/tradelines.mjs and api/read/finance-os.mjs,
// which serve the same underlying rows this endpoint reasons over. Gating this
// more tightly would buy nothing: anyone refused here can read the lines next
// door.
//
// ── ORG SCOPING COMES FROM THE SESSION, AND IT FAILS CLOSED ──
// `staff.org_id` is set by verifySession from the staff row. It is never read
// from the query string or the body, because a caller-supplied org is not a
// scope, it is a request to be trusted.
//
// ⚠️ FINDING, NOT FIXED HERE: api/read/tradelines.mjs and api/read/finance-os.mjs
// filter on client_id ALONE — listTradelines() takes no org and neither endpoint
// checks one, so a staff session in org A can read a client in org B by knowing
// the uuid. That is a real hole and it is out of this task's scope to change
// those files. This endpoint does not copy the pattern: the client is looked up
// under the session's org first, and every subsequent query carries org_id too.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { evaluateUtilization } from "../../src/alerts/evaluate.mjs";
import { UPSTREAM, computeUnderwrite, buildSuggestions } from "../../src/underwrite/engine.mjs";
import { toBureaus } from "../../src/underwrite/adapter.mjs";
import { linesForEngine } from "../../src/tradelines/index.mjs";
import { applyStackedBusinessFunding } from "../../src/underwrite/business-funding.mjs";
import { buildReport } from "../../src/underwrite/report.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

/**
 * @param {object} req
 * @param {object} res
 * @param {object} [deps]  { db } — the seam the endpoint test drives. Netlify and
 *        Vercel both call handler(req, res), so the third parameter is never
 *        supplied in production and the real pool is used.
 */
export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  // FAIL CLOSED. A session with no readable org scopes to nothing, and scoping to
  // nothing must be a refusal rather than an unscoped query. There is no code
  // path here where a missing org_id widens the result set.
  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const query = req.query || {};
  if (!isUuid(query.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }
  const clientId = String(query.client_id).trim();

  try {
    // The client, under this session's org. A client in another org is reported
    // as not found rather than forbidden — "wrong org" would confirm the uuid
    // names a real client somewhere, which is the thing the scope is hiding.
    const clientRes = await database.query(
      `SELECT id, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    const client = clientRes.rows[0];
    if (!client) {
      return res.status(404).json({ ok: false, error: "client_not_found" });
    }

    // Every read below carries org_id as well as client_id. Redundant given the
    // check above, and kept anyway: it means no single missing guard turns this
    // into a cross-org read.
    const [tradelinesRes, liabilitiesRes, crsRes, businessesRes] = await Promise.all([
      database.query(
        `SELECT * FROM tradelines
          WHERE client_id = $1 AND org_id = $2
          ORDER BY apr ASC NULLS LAST, lender ASC`,
        [clientId, orgId]
      ),
      database.query(
        `SELECT * FROM card_liabilities
          WHERE client_id = $1 AND org_id = $2
          ORDER BY as_of DESC`,
        [clientId, orgId]
      ),
      database.query(
        `SELECT id, result, created_at FROM crs_results
          WHERE client_id = $1 AND org_id = $2
          ORDER BY created_at DESC`,
        [clientId, orgId]
      ),
      database.query(
        `SELECT age_months FROM businesses
          WHERE client_id = $1 AND org_id = $2
          ORDER BY created_at ASC`,
        [clientId, orgId]
      )
    ]);

    /* ── THE ACCOUNTS MUST COME OUT OF THE SAME FILE THE SCORES DID ──

       `tradelines` rows are written at pull time by ingestCrsResult()
       (src/tradelines/store.mjs). Every write path into `crs_results` calls it
       — recordPull(), fulfilWithin() and coordinateCrsResult() in
       src/finance/soft-pulls.mjs — so in the ordinary case the table and the
       stored payload agree and nothing below changes anything.

       WHEN THAT INGEST DID NOT RUN, THIS ENDPOINT TOLD TWO STORIES FROM ONE
       FILE. The `crs_results` row is still there, so three scores were read out
       of it; no accounts were, because accounts were only ever read from the
       table. Measured on live 2026-08-27 for client 89f1a12f-f824-4451-9a53-
       5705b55374ca: the stored pull lists four open accounts (a $25,000 Amex
       opened 2020-08, a $12,000 Chase opened 2019-04, an $8,000 Capital One
       opened 2021-01 and a $28,000 auto loan opened 2022-06) and `tradelines`
       held none of them, so the same read reported 718 / 724 / 731 AND "your
       file is thin", $0 personal, $0 business. Two of that night's four planted
       clients were in this state.

       So: fall back to the accounts already inside the newest stored pull that
       carries any, through the SAME normalizer the ingest uses. One reader of a
       pull payload, which is the rule src/finance/soft-pulls.mjs already states.
       Nothing is invented, nothing is inferred and nothing is written — these
       are lines that were in the file this endpoint was already reading.

       ONLY WHEN THE TABLE IS EMPTY. A client with stored rows is untouched, so
       this can neither double-count nor disagree with the screens that read
       `tradelines` directly (api/read/tradelines.mjs, api/read/finance-os.mjs).

       THE RULE LIVES IN ONE PLACE — src/tradelines/index.mjs's linesForEngine.
       src/sales/closer-deck.mjs runs the same three engine calls to produce the
       pre-approval a closer reads out to the client, and the two must never be
       able to answer "how much can this person get" differently.

       `tradelineSource` is returned so a reader can always tell which of the two
       they are looking at. It is never a guess: "none" means the file carried no
       accounts either, and the adapter still reports that as a missing field. */
    const { tradelines, source: tradelineSource } =
      linesForEngine(tradelinesRes.rows, crsRes.rows);

    // ── pure from here down ──
    const adapter = toBureaus({
      tradelines,
      liabilities: liabilitiesRes.rows,
      crsResults: crsRes.rows,
      customFields: client.custom_fields || {},
      businesses: businessesRes.rows
    });

    const underwrite = applyStackedBusinessFunding(
      computeUnderwrite(adapter.bureaus, adapter.businessAgeMonths),
      adapter.businessAges
    );

    // Company on file (`businesses`) is "has a company." Stored age is
    // `businesses.age_months`. No company still leaves hasLLC missing, so the
    // report marks the engine's "no LLC" default as a default.
    const suggestions = buildSuggestions(underwrite, {
      hasLLC: adapter.hasLLC,
      llcAgeMonths: adapter.llcAgeMonths ?? 0
    });

    // fundhub's own utilization reading, from the four rules that already exist.
    // Included so both engines' utilization lines appear together, each stamped
    // with the engine that produced it. src/alerts/evaluate.mjs is unchanged by
    // this integration and gains no rule from it.
    //
    // No threshold is passed, so evaluateUtilization applies its documented
    // default. An explicit null would mean "configured but unset" and is what a
    // caller reading a 079 upsell_triggers row would pass; there is no such row
    // here and inventing one would be worse than using the stated default.
    const fundhubUtilization = evaluateUtilization(tradelines);

    const report = buildReport({ underwrite, suggestions, adapter, fundhubUtilization });
    report.engine.upstreamCommit = UPSTREAM.commit;

    return res.status(200).json({ ok: true, clientId, tradelineSource, ...report });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    /* A DATABASE THAT DID NOT ANSWER IS NOT OUR CODE THROWING, AND THE SCREEN
       MUST NOT BE TOLD IT WAS. Everything above this line has already claimed
       the faults it can name; what is left reaches netlify/functions/api.mjs as
       a bare 500 internal_error, which public/app/data.js words as "something
       went wrong on our side ... The database did not report a problem." That
       sentence is false during an outage and it is how the funding-capacity read
       reported a dead database as a bug in this file. 503 + db:"down" is the
       shape data.js already reads as "the database is not answering".
       See src/http/db-down.mjs — it stays narrow, so anything it cannot
       positively identify still falls through to the 500 it got before. */
    if (dbDown(res, e)) return;

    throw e;
  }
}
