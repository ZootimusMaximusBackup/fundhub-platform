// Zoho Recruit — jobs out, applicants in.
//
// ══════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
//
// Owner-set 2026-09-05 (docs/workflows/hiring-ats-decision-2026-09-05.md): Zoho
// Recruit is the applicant tracking system and it owns the LinkedIn bridge. It is
// an approved LinkedIn source, so it can post a job to LinkedIn. Our own code
// never can — LinkedIn's Job Posting API is closed to new partners.
//
// So: we push a job into Zoho, Zoho syndicates it to LinkedIn, people apply over
// there, and this module pulls them back. src/hiring/linkedin.mjs is the record of
// the route that closed; it is not called from here and must not be revived.
//
// ══════════════════════════════════════════════════════════════════════════════
// THIS FEEDS AN AUTOMATED EMPLOYMENT DECISION TOOL. 051_hiring.sql's invariant:
//
//   NO CANDIDATE IS EVER REJECTED BY SOFTWARE.
//
// There is no scoring here, no ranking, no filter, no auto-decline, and no place
// to add one. The only thing this module can do to an applicant is create them.
//
// Two specific refusals worth naming, because both look like features:
//
//   * Zoho's `Candidate_Status` is NOT imported. It is Zoho's pipeline state, and
//     copying it would let an outside system move a person through OUR stages
//     without a human ever looking at them.
//   * Nothing here writes to `candidates` or `candidate_applications` directly.
//     Every applicant goes through apply() in ./pipeline.mjs, so a Zoho applicant
//     is graded by the same rubric, held to the same human gate and audited the
//     same way as one who walked in the front door. A second ingest path would be
//     a second, unaudited front door, which is the exact thing 051 was written to
//     prevent.
//
// PROTECTED CHARACTERISTICS ARE DROPPED TWICE. Once here, against the same
// deny-list the grader uses (./grading.mjs isProtected), and again inside apply().
// The count is written to hiring_zoho_candidate_links.protected_fields_dropped so
// that a Zoho form which starts collecting date-of-birth is visible in the data
// rather than only in a log line nobody reads.
//
// ══════════════════════════════════════════════════════════════════════════════
// THE FOUR WAYS A CONNECTOR LIKE THIS SILENTLY LOSES PEOPLE
//
// Each of these fails without an error. "A quiet week" and "we dropped eleven
// applicants" look identical from the outside, which is what makes them
// expensive. Every one has a named guard below and a test.
//
//   1. PAGINATION. per_page caps at 200 and `info.more_records` is the flag. Stop
//      reading at one page and everybody past record 200 is gone. See fetchPages,
//      and note that hitting MAX_PAGES sets `truncated` rather than returning a
//      short list that looks complete.
//
//   2. TIMEZONE. Zoho's own examples carry an explicit offset (-07:00 is Arizona,
//      which does not observe daylight saving — see
//      docs/workflows/arizona-time-2026-08-28.md). A cursor sent as a bare local
//      time is read by Zoho in some other zone and silently skips or re-reads
//      hours of applicants. Everything here is UTC end to end and sent as ISO 8601
//      with an explicit offset.
//
//   3. CURSOR OVERLAP. `greater_equal` on the exact instant of the last run loses
//      anything created in the same second, and any clock skew between us and Zoho
//      widens that hole. So the poll deliberately re-reads OVERLAP_MINUTES before
//      the cursor and leans on the id map instead. Duplicates are free; gaps are
//      invisible. The cursor advances only after every page has been processed.
//
//   4. IDEMPOTENCY. Zoho's `id` is the dedupe key. It is carried into
//      external_application_id, which apply() already treats as a UNIQUE guard, and
//      recorded in hiring_zoho_candidate_links under a unique index. A re-run, a
//      re-poll and an overlapping window all converge on one candidate and one
//      application.
//
// ══════════════════════════════════════════════════════════════════════════════
// FREE TIER. WE ARE ON IT, AND ONE LIMIT CHANGES THE DESIGN.
//
// Zoho Recruit's free edition allows ONE ACTIVE JOB OPENING AT A TIME
// (https://www.zoho.com/recruit/pricing.html, fetched 2026-09-05: Free =
// "1 active job/ recruiter license"). After migration 294 there are four open
// reqs. So posting is a QUEUE, not a fan-out: postJob refuses cleanly when the
// slot is taken and leaves the request sitting as a draft, visible in
// v_zoho_posting_queue.
//
// The number lives in hiring_channel_connections.max_active_postings, defaulted to
// 1 by migration 298, so upgrading a plan is an UPDATE rather than a deploy.
// FREE_TIER_MAX_ACTIVE_POSTINGS below is only the default for a connection row
// that predates that column — it is a PLAN limit, never a Zoho-wide rule.
//
// Webhooks are NOT available to us. On the Corporate HR edition they require
// Enterprise (https://www.zoho.com/recruit/corporate-plan-comparison.html, fetched
// 2026-09-05), and the free edition has no workflow rules to hang one on. So this
// is a poll. See docs/workflows/zoho-connector-notes-2026-09-05.md for the daily
// call-budget arithmetic, which is not comfortable under every reading of Zoho's
// published limits.

import { encryptToken, decryptToken } from "../adplatforms/tokens.mjs";
import { transmit, ADAPTERS } from "../lib/outbound-fetch.mjs";
import { apply } from "./pipeline.mjs";
import { isProtected } from "./grading.mjs";

/* ─────────────────────────── constants ─────────────────────────── */

/* FREE-TIER PLAN LIMIT, not a Zoho-wide rule. Only used when a connection row has
   no max_active_postings of its own. Raising the plan means updating the column. */
export const FREE_TIER_MAX_ACTIVE_POSTINGS = 1;

/* per_page is capped at 200 by Zoho for both Get Records and Search Records.
   https://www.zoho.com/recruit/developer-guide/apiv2/search-records.html */
export const PER_PAGE = 200;

/* A ceiling so a runaway loop cannot burn the day's whole API allowance. Hitting
   it is reported as `truncated`, never swallowed — a short list that looks
   complete is the failure this module exists to avoid. */
export const MAX_PAGES = 25;

/* Deliberate re-read window. See hazard 3 in the header. */
export const OVERLAP_MINUTES = 5;

/* How far back a first-ever sync reaches when there is no cursor yet. */
export const COLD_START_DAYS = 30;

/* Refresh a little before the token actually dies, so a slow request cannot
   straddle the expiry. */
export const REFRESH_SKEW_SECONDS = 120;

/* Zoho module API names. Constants because the associate endpoint's spelling is
   the one thing in this file the docs disagree with themselves about — see
   ASSOCIATE_MODULE. */
export const MODULE_CANDIDATES = "Candidates";
export const MODULE_JOB_OPENINGS = "Job_Openings";

/* UNVERIFIED. The v2 module API name for job openings is `Job_Openings`, and that
   is what create/update use. Zoho's associated-records page renders the same
   module as `JobOpenings` (no underscore) in its example URL. One of the two is a
   documentation error and we cannot tell which without a live account, so it is an
   env-overridable constant rather than a string buried in a URL — when the first
   real call 404s, this is the single line to change.
   https://www.zoho.com/recruit/developer-guide/apiv2/get-associated-records.html */
export const ASSOCIATE_MODULE =
  process.env.ZOHO_ASSOCIATE_MODULE || MODULE_JOB_OPENINGS;

/* Zoho runs the same product in several regions and a token from one is
   meaningless in another — a wrong domain is a SILENT auth failure, which is why
   api_domain is stored per connection (migration 298) rather than assumed.
   The US host is the documented default when nothing has been recorded.
   https://www.zoho.com/recruit/developer-guide/apiv2/multi-dc.html */
export const DEFAULT_API_DOMAIN = "https://www.zohoapis.com";

/* Which accounts host issues tokens for which API host. VERIFIED from the multi-DC
   page for US, EU and CN; AU, IN and JP follow the documented accounts hostnames
   with the standard zohoapis pattern for the API side and are marked UNVERIFIED in
   the notes. An unknown domain throws rather than falling back — quietly refreshing
   against the wrong region is the failure this map exists to prevent. */
const ACCOUNTS_BY_API_DOMAIN = Object.freeze({
  "https://www.zohoapis.com": "https://accounts.zoho.com",
  "https://www.zohoapis.eu": "https://accounts.zoho.eu",
  "https://www.zohoapis.com.cn": "https://accounts.zoho.com.cn",
  "https://www.zohoapis.com.au": "https://accounts.zoho.com.au",
  "https://www.zohoapis.in": "https://accounts.zoho.in",
  "https://www.zohoapis.jp": "https://accounts.zoho.jp"
});

/* Zoho's own bookkeeping. Not application answers, so they never reach `answers`.
   Candidate_Status is in here for a reason bigger than tidiness: it is Zoho's
   pipeline stage, and importing it would let an outside system advance or park a
   candidate in ours with no human in the loop. */
const ZOHO_SYSTEM_FIELDS = new Set([
  "id", "Created_Time", "Modified_Time", "Created_By", "Modified_By", "Owner",
  "Is_Locked", "Layout", "Tag", "Associated_Tags", "Last_Activity_Time",
  "Record_Image", "Is_Attachment_Present", "Locked__s", "Candidate_Status",
  "Source", "Updated_On", "Is_Unqualified", "Candidate_ID"
]);

/* Consumed into top-level apply() arguments, so they must not be duplicated into
   the answer set as well. */
const ZOHO_CONTACT_FIELDS = new Set([
  "First_Name", "Last_Name", "Full_Name", "Email", "Secondary_Email",
  "Phone", "Mobile", "Other_Phone"
]);

/* UNVERIFIED FIELD NAMES. The insert-records docs do not list Job_Openings' own
   fields, and no official page documents a `Publish` flag. These come from the
   owner-supplied v2 spec (2026-09-05) and are named here so a rename is one edit.
   Getting Job_Status wrong means a job that posts but never syndicates. */
export const JOB_STATUS_OPEN = "In-progress";
export const JOB_STATUS_CLOSED = "Closed";

/* ─────────────────────────── connection ─────────────────────────── */

const normaliseDomain = (d) =>
  String(d ?? "").trim().replace(/\/+$/, "") || null;

export function apiDomainFor(conn) {
  return normaliseDomain(conn?.api_domain) || DEFAULT_API_DOMAIN;
}

export function accountsDomainFor(conn) {
  const override = normaliseDomain(process.env.ZOHO_ACCOUNTS_DOMAIN);
  if (override) return override;
  const api = apiDomainFor(conn);
  const accounts = ACCOUNTS_BY_API_DOMAIN[api];
  if (!accounts) {
    throw new Error(
      `zoho: unrecognised api_domain "${api}" — add it to ACCOUNTS_BY_API_DOMAIN ` +
      `or set ZOHO_ACCOUNTS_DOMAIN. Refreshing against the wrong region fails silently.`);
  }
  return accounts;
}

const apiUrl = (conn, path) => `${apiDomainFor(conn)}/recruit/v2${path}`;

/* connectionFor — the active Zoho connection, or a clear error.
   Mirrors connectionFor in ./linkedin.mjs deliberately: same table, same shape,
   same failure message style, so neither is a special case to learn. */
export async function connectionFor(tx, { orgId } = {}) {
  if (!orgId) throw new Error("connectionFor: orgId is required");
  const { rows } = await tx.query(
    `SELECT * FROM hiring_channel_connections
      WHERE org_id = $1 AND channel = 'zoho' AND connection_state = 'active'
      ORDER BY updated_at DESC
      LIMIT 1`, [orgId]);
  const conn = rows[0];
  if (!conn) {
    throw new Error(
      "no active Zoho Recruit connection — complete the Zoho OAuth flow before posting or polling");
  }
  return conn;
}

/* The AAD for hiring-channel tokens is the ORG id, not a partner id — these are
   FundHub's own credentials and there is no tenant to bind to. Stated here because
   using the wrong AAD is a silent decryption failure, and ./linkedin.mjs carries
   the same note for the same reason. */
const accessTokenFor = (conn) => {
  const t = decryptToken(conn.encrypted_access_token, { partnerId: conn.org_id });
  if (!t) throw new Error("Zoho connection has no access token");
  return t;
};

const refreshTokenFor = (conn) =>
  decryptToken(conn.encrypted_refresh_token, { partnerId: conn.org_id });

/* refreshIfNeeded(tx, spec) → connection row

   Zoho access tokens last one hour. Refresh tokens do not expire until revoked
   (https://www.zoho.com/recruit/developer-guide/apiv2/oauth-overview.html), so the
   refresh token is the durable credential and losing it means a human has to
   re-authorise.

   THE TRAP: Zoho's token endpoint answers HTTP 200 with {"error":"..."} on
   failure. Checking res.ok alone stores the string "undefined" as an access token
   and every later call 401s with no clue why. */
export async function refreshIfNeeded(tx, { orgId, ctx = {}, now = new Date() } = {}) {
  const conn = await connectionFor(tx, { orgId });

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at) : null;
  const stillGood = expiresAt &&
    expiresAt.getTime() - now.getTime() > REFRESH_SKEW_SECONDS * 1000;
  if (stillGood && conn.encrypted_access_token) return conn;

  const refreshToken = refreshTokenFor(conn);
  if (!refreshToken) {
    await markConnection(tx, conn.id, {
      state: "expired",
      error: "no refresh token stored — the Zoho account must be re-authorised"
    });
    throw new Error("Zoho connection has no refresh token — re-authorise the account");
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set to refresh a Zoho token");
  }

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token"
  });

  /* Behind the SAME fence as the calls it buys a token for. Getting a token is
     harmless on its own, so INTERNAL was tempting — but the INTERNAL set is
     pinned by src/lib/no-unfenced-transmit.mjs's test and this module is not in
     it, and a refresh that succeeds while every real call is held would burn a
     refresh token to do nothing. One fence, one answer. */
  const res = await transmit(`${accountsDomainFor(conn)}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  }, {
    fence: ADAPTERS,
    what: "zoho token refresh",
    fetchImpl: ctx.fetch,
    env: ctx.env,
    asText: true
  });

  if (res.blocked) {
    // NOT marked expired. The token is fine; the fence is up. Writing 'expired'
    // here would make a flag someone forgot to set look like a dead Zoho
    // account, and send whoever debugs it off to re-authorise for no reason.
    const e = new Error(`Zoho token refresh held by the outbound fence: ${res.error}`);
    e.retryable = true;
    e.blocked = true;
    throw e;
  }

  if (res.status === 0) {
    const e = new Error(`Zoho accounts unreachable: ${scrub(String(res.error || "no response"))}`);
    e.retryable = true;
    throw e;
  }

  const text = typeof res.body === "string" ? res.body : "";
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }

  if (!res.ok || json.error || !json.access_token) {
    const reason = scrub(String(json.error || text || `HTTP ${res.status}`)).slice(0, 300);
    await markConnection(tx, conn.id, { state: "expired", error: `refresh failed: ${reason}` });
    throw new Error(`Zoho token refresh failed: ${reason}`);
  }

  const lifetime = Number(json.expires_in) > 0 ? Number(json.expires_in) : 3600;
  const nextExpiry = new Date(now.getTime() + lifetime * 1000);

  const { rows } = await tx.query(
    `UPDATE hiring_channel_connections
        SET encrypted_access_token = $2,
            token_expires_at = $3,
            api_domain = COALESCE($4, api_domain),
            connection_state = 'active',
            last_error = NULL,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [conn.id,
     encryptToken(json.access_token, { partnerId: conn.org_id }),
     nextExpiry.toISOString(),
     normaliseDomain(json.api_domain)]);

  return rows[0];
}

async function markConnection(tx, id, { state, error }) {
  await tx.query(
    `UPDATE hiring_channel_connections
        SET connection_state = COALESCE($2, connection_state),
            last_error = $3, updated_at = now()
      WHERE id = $1`,
    [id, state || null, error ? String(error).slice(0, 1000) : null]);
}

/* ─────────────────────────── the wire ─────────────────────────── */

/* EVERY BYTE LEAVES THROUGH transmit(). Not because this module chose to be
   polite — src/lib/no-unfenced-transmit.test.mjs fails the build for any module
   that can reach the network on its own, and a raw fetch here was exactly that.

   THE FENCE IS "adapters", NOT "messaging". Zoho is a vendor whose records we
   change: postJob creates a real job opening that Zoho then syndicates to
   LinkedIn. That is the same class as src/adapters/lendflow.mjs submitting an
   application, and it is not a message to a client. Naming the wrong fence would
   put job posting behind the switch that governs client email and SMS.

   ADAPTERS_DRY_RUN DEFAULTS TO BLOCKED. An unset flag holds the request and
   returns blocked:true rather than sending. That is deliberate upstream design,
   so this function surfaces it as a retryable error naming the flag — a held
   call must never look like "Zoho had nothing for us". */
async function call({ conn, path, method = "GET", body, ctx = {} }) {
  const token = accessTokenFor(conn);
  const url = apiUrl(conn, path);

  const res = await transmit(url, {
    method,
    headers: {
      authorization: `Zoho-oauthtoken ${token}`,
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, {
    fence: ADAPTERS,
    what: `zoho ${method} ${path.split("?")[0]}`,
    // ctx.fetch keeps every test off the network. It does NOT bypass the fence:
    // a test that wants a send still has to set ADAPTERS_DRY_RUN explicitly.
    fetchImpl: ctx.fetch,
    env: ctx.env,
    asText: true
  });

  if (res.blocked) {
    const e = new Error(`Zoho call held by the outbound fence: ${res.error}`);
    // Retryable because the fix is a flag, not a code change — the next cron
    // pass after someone sets ADAPTERS_DRY_RUN=0 succeeds with no redeploy.
    e.retryable = true;
    e.blocked = true;
    throw e;
  }

  // status 0 with no block is a transport failure: DNS, TLS, timeout, abort.
  if (res.status === 0) {
    const e = new Error(`Zoho unreachable: ${scrub(String(res.error || "no response"), token)}`);
    e.retryable = true;
    throw e;
  }

  // 204 IS NOT AN ERROR. Zoho answers a search that matched nothing with
  // "204 No Content" and an empty body. Treating that as a failure turns "nobody
  // applied in the last fifteen minutes" — the normal case — into an alert.
  if (res.status === 204) return { data: [], info: { count: 0, more_records: false } };

  const text = typeof res.body === "string" ? res.body : "";
  if (!res.ok) {
    const e = new Error(scrub(`Zoho ${res.status}: ${text}`, token).slice(0, 500));
    e.platformMessage = scrub(text, token).slice(0, 1000) || `HTTP ${res.status}`;
    e.status = res.status;
    // 429 is the rate limiter. Retrying is correct; retrying immediately is not,
    // and that is the caller's cron interval, not this function's business.
    e.retryable = res.status === 429 || res.status >= 500;
    throw e;
  }

  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

/* fetchPages — follow info.more_records to the end, or say we did not.

   HAZARD 1 FROM THE HEADER LIVES HERE. Returning page one and stopping loses
   everybody past record 200 and looks exactly like a normal result. So the loop
   runs until Zoho says there is no more, and if it hits MAX_PAGES first it says
   `truncated: true` rather than handing back a short list that reads as complete. */
async function fetchPages({ conn, path, ctx, maxPages = MAX_PAGES }) {
  const records = [];
  let page = 1;
  let truncated = false;

  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await call({
      conn,
      path: `${path}${sep}per_page=${PER_PAGE}&page=${page}`,
      ctx
    });
    const batch = Array.isArray(res?.data) ? res.data : [];
    records.push(...batch);

    if (!res?.info?.more_records) break;
    if (page >= maxPages) { truncated = true; break; }
    page += 1;
  }

  return { records, pages: page, truncated };
}

/* ─────────────────────────── time ─────────────────────────── */

/* HAZARD 2 FROM THE HEADER. Zoho wants ISO 8601 with an explicit offset. A bare
   local time is read in whatever zone Zoho feels like and silently shifts the
   window by hours. Date#toISOString always produces UTC with a literal "Z", which
   IS an explicit offset, so this is the safe spelling and the only one used. */
export function zohoTimestamp(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`zohoTimestamp: invalid date ${String(value)}`);
  return d.toISOString();
}

/* HAZARD 3. Where the poll actually starts reading: the stored cursor pulled BACK
   by the overlap window, or a cold-start lookback when there is no cursor. */
export function windowStart({ cursor, now = new Date(), overlapMinutes = OVERLAP_MINUTES } = {}) {
  if (cursor) {
    const c = cursor instanceof Date ? cursor : new Date(cursor);
    if (!Number.isNaN(c.getTime())) {
      return new Date(c.getTime() - overlapMinutes * 60 * 1000);
    }
  }
  return new Date(now.getTime() - COLD_START_DAYS * 24 * 60 * 60 * 1000);
}

/* ─────────────────────────── normalising ─────────────────────────── */

const slug = (s) => String(s ?? "")
  .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || null;

const cleanString = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/* externalKeyFor — the idempotency key handed to apply().

   Zoho's candidate id is the dedupe key, exactly as specified. The role key is
   appended because one person may legitimately apply for two reqs — 051's own
   header says so ("a candidate declined for closer today may be the right setter
   next quarter") — and (org, external_application_id) is UNIQUE, so keying on the
   Zoho id alone would let the first application block the second one forever.
   A re-run for the same person and the same req still produces the same string,
   which is what idempotency actually requires. */
export function externalKeyFor(zohoCandidateId, roleKey) {
  const id = cleanString(zohoCandidateId);
  const role = cleanString(roleKey);
  if (!id || !role) return null;
  return `zoho:${id}:${String(role).toLowerCase()}`;
}

/* normaliseCandidate(raw, spec) → apply()-shaped record

   Zoho's shape in, ours out. Pure: no network, no database, no clock beyond what
   the record carries. Exported so the mapping is testable against a fixture, which
   is the only way the stripping below can be proven rather than asserted.

   WHAT CROSSES AND WHAT DOES NOT
   ──────────────────────────────
   Contact details become top-level apply() arguments. Everything else that the
   applicant actually supplied becomes an entry in `answers`, EXCEPT:

     * Zoho's own bookkeeping (ZOHO_SYSTEM_FIELDS, and anything starting with "$").
       Not applicant data.
     * Nested objects. Zoho renders lookups as {name, id}; those are references to
       Zoho records, not answers, and flattening them would drag Zoho's internal
       ids into an evidence table.
     * PROTECTED CHARACTERISTICS. Checked against ./grading.mjs isProtected on both
       the raw Zoho field name and its slugged form, then DROPPED and COUNTED.
       Counting matters: zero is the expected number, and a number that starts
       climbing means Zoho's application form is collecting something it should
       not. Silent stripping would hide that.

   A record with no usable id, name or email is not an error — it is returned with
   those fields null so the caller can record it as skipped. See syncCandidates. */
export function normaliseCandidate(raw, { roleKey = null, jobPostingId = null, sourceDetail = null } = {}) {
  const record = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};

  const zohoCandidateId = cleanString(record.id);

  const first = cleanString(record.First_Name);
  const last = cleanString(record.Last_Name);
  const fullName = cleanString(record.Full_Name) ||
    ([first, last].filter(Boolean).join(" ").trim() || null);

  const rawEmail = cleanString(record.Email);
  const email = rawEmail ? rawEmail.toLowerCase() : null;

  const phone = cleanString(record.Phone) || cleanString(record.Mobile) || null;

  const answers = {};
  const droppedProtected = [];

  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("$")) continue;
    if (ZOHO_SYSTEM_FIELDS.has(key)) continue;
    if (ZOHO_CONTACT_FIELDS.has(key)) continue;

    // Protected first, so a protected field is COUNTED even when its value is
    // empty. "We dropped nothing because it happened to be blank today" is not
    // the same finding as "the form does not ask".
    if (isProtected(key) || isProtected(slug(key) || key)) {
      droppedProtected.push(key);
      continue;
    }

    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const scalars = value.filter((v) => v === null || typeof v !== "object");
      if (scalars.length !== value.length) continue;   // array of lookups, not answers
      if (!scalars.length) continue;
      const k = slug(key);
      if (k) answers[k] = scalars;
      continue;
    }
    if (typeof value === "object") continue;           // Zoho lookup {name, id}

    const cleaned = typeof value === "boolean" ? value : cleanString(value);
    if (cleaned === null) continue;
    const k = slug(key);
    if (k) answers[k] = cleaned;
  }

  const modified = cleanString(record.Modified_Time) || cleanString(record.Created_Time);

  return {
    zohoCandidateId,
    externalApplicationId: externalKeyFor(zohoCandidateId, roleKey),
    zohoModifiedTime: modified,
    roleKey,
    jobPostingId,
    fullName,
    email,
    phone,
    source: "zoho",
    sourceDetail: cleanString(sourceDetail),
    answers,
    droppedProtected
  };
}

/* ─────────────────────────── reading ─────────────────────────── */

/* fetchCandidates(tx, spec) → { records, pages, truncated }

   The incremental pull. `since` is anything Date can read; it is sent as UTC with
   an explicit offset (hazard 2) and compared with greater_equal, which is inclusive
   — that plus the overlap window is hazard 3's guard.

   Created_Time, not Modified_Time: this connector's job is to notice NEW
   applicants. An edit to somebody already ingested changes nothing on our side,
   because their application is ours from the moment it lands. */
export async function fetchCandidates(tx, { orgId, since, ctx = {} } = {}) {
  const conn = await refreshIfNeeded(tx, { orgId, ctx });
  const from = zohoTimestamp(since || windowStart({}));
  const criteria = encodeURIComponent(`(Created_Time:greater_equal:${from})`);
  return fetchPages({
    conn,
    path: `/${MODULE_CANDIDATES}/search?criteria=${criteria}`,
    ctx
  });
}

/* fetchCandidatesForJob(tx, spec) → { records, pages, truncated }

   Everyone associated with one Zoho job opening. Slower to no-op than the search
   (there is no "since" on this endpoint) but it answers a question the flat search
   cannot: WHICH REQ this person applied for. That is what ties an applicant to a
   hiring_job_postings row and therefore, through assigneeFor, to the right owner. */
export async function fetchCandidatesForJob(tx, { orgId, zohoJobId, ctx = {} } = {}) {
  if (!zohoJobId) throw new Error("fetchCandidatesForJob: zohoJobId is required");
  const conn = await refreshIfNeeded(tx, { orgId, ctx });
  return fetchPages({
    conn,
    path: `/${ASSOCIATE_MODULE}/${encodeURIComponent(zohoJobId)}/associate`,
    ctx
  });
}

/* ─────────────────────────── postings ─────────────────────────── */

async function livePostings(tx, orgId) {
  const { rows } = await tx.query(
    `SELECT p.*, r.key AS role_key, r.name AS role_name
       FROM hiring_job_postings p
       JOIN hiring_roles r ON r.id = p.role_id
      WHERE p.org_id = $1 AND p.channel = 'zoho' AND p.status = 'posted'
      ORDER BY p.posted_at NULLS LAST`, [orgId]);
  return rows;
}

/* postingQueue(tx, spec) → rows

   "One live, three waiting" in a form a person can read. Backed by
   v_zoho_posting_queue (migration 298). It reports; it never promotes — which req
   goes live when the current one closes is the owner's call, because somebody may
   be halfway through applying to the live one. */
export async function postingQueue(tx, { orgId } = {}) {
  const { rows } = await tx.query(
    `SELECT * FROM v_zoho_posting_queue WHERE org_id = $1
      ORDER BY (status = 'posted') DESC, role_key`, [orgId]);
  return rows;
}

/* jobOpeningPayload(spec) → { record, omitted[] } | throws

   Zoho's create body must be wrapped in a "data" array
   (https://www.zoho.com/recruit/developer-guide/apiv2/insert-records.html).

   NOTHING IN HERE IS INVENTED. Job_Description is hiring_roles.role_brief, written
   by a human through reviseBrief; if it is empty this function is never reached,
   because postJob refuses first. Location and salary are passed in by the caller
   or omitted entirely — never filled with a plausible guess. A made-up job
   description or a made-up salary becomes something a real person is judged
   against, and later, evidence. */
export function jobOpeningPayload({ roleName, brief, location = {}, salary = null, jobType = null } = {}) {
  const name = cleanString(roleName);
  const description = cleanString(brief);
  if (!name) throw new Error("jobOpeningPayload: roleName is required");
  if (!description) throw new Error("jobOpeningPayload: brief is required — never post an invented description");

  const record = {
    Job_Title: name,
    Job_Description: description,
    Job_Status: JOB_STATUS_OPEN,
    // Publish is what hands the job to Zoho's syndication, which is what puts it
    // in front of LinkedIn. UNVERIFIED against Zoho's own field list — see the
    // constants block.
    Publish: true
  };

  const omitted = [];
  const optional = {
    City: cleanString(location.city),
    State: cleanString(location.state),
    Zip_Code: cleanString(location.postalCode),
    Country: cleanString(location.country),
    Salary: cleanString(salary),
    Job_Type: cleanString(jobType)
  };
  for (const [k, v] of Object.entries(optional)) {
    if (v === null) omitted.push(k);
    else record[k] = v;
  }

  return { record, omitted };
}

/* postJob(tx, spec) → { ok, reason?, posting, ... }

   Push one req to Zoho. REFUSES rather than throwing for every condition a human
   can fix, because a thrown error in a cron job is a stack trace nobody reads and
   a refusal is a sentence somebody can act on.

   THE THREE REFUSALS, all tested:

     no_role_brief      — hiring_roles.role_brief is empty. We do not write job
                          descriptions. See migration 294 and reviseBrief.
     no_location        — LinkedIn's Limited Listings drop a posting that is
                          missing mandatory fields, Location among them, and they
                          do it silently
                          (https://help.zoho.com/portal/en/kb/recruit/talent-sourcing/job-boards/linkedin-limited-listings/articles/linkedin,
                          fetched 2026-09-05). A job that posts to Zoho and never
                          reaches LinkedIn is the worst outcome available here: it
                          looks like success. So location is required, and it is
                          supplied, never guessed.
     active_job_limit   — the free tier allows one live job. The request is left
                          as a draft (which is what "queued" means on this channel)
                          and reported, never silently dropped and never allowed to
                          replace a live job somebody is mid-hire on. */
export async function postJob(tx, {
  orgId, roleKey, location = {}, salary = null, jobType = null, ctx = {}
} = {}) {
  if (!orgId) throw new Error("postJob: orgId is required");
  const key = String(roleKey || "").trim().toLowerCase();
  if (!key) throw new Error("postJob: roleKey is required");

  const role = (await tx.query(
    `SELECT id, key, name, role_brief FROM hiring_roles
      WHERE org_id = $1 AND key = $2 AND active`, [orgId, key])).rows[0];
  if (!role) throw new Error(`postJob: no active hiring role "${roleKey}"`);

  // The posting row exists before anything is sent, and survives every refusal, so
  // an intent to post is never invisible. Same ordering as ./linkedin.mjs postJob
  // and for the same reason: a job that exists on the outside and nowhere in our
  // database is one nobody can find or close.
  const posting = await ensurePosting(tx, { orgId, role });

  const brief = cleanString(role.role_brief);
  if (!brief) {
    return refuse(posting, "no_role_brief",
      `${role.name} has no written job description. Write one before posting — this connector will not invent it.`);
  }

  if (!cleanString(location.city) || !cleanString(location.country)) {
    return refuse(posting, "no_location",
      `${role.name} has no city and country to post with. LinkedIn silently drops listings with no location, so nothing is sent.`);
  }

  const conn = await refreshIfNeeded(tx, { orgId, ctx });
  const limit = Number(conn.max_active_postings) > 0
    ? Number(conn.max_active_postings)
    : FREE_TIER_MAX_ACTIVE_POSTINGS;

  const live = await livePostings(tx, orgId);
  const alreadyLive = live.find((p) => p.id === posting.id);
  if (!alreadyLive && live.length >= limit) {
    return refuse(posting, "active_job_limit",
      `Zoho allows ${limit} live job${limit === 1 ? "" : "s"} on this plan and ${live.map((p) => p.role_name).join(", ")} ` +
      `${live.length === 1 ? "is" : "are"} using ${limit === 1 ? "it" : "them"}. ` +
      `${role.name} is queued; close the live job to free the slot.`);
  }

  const { record, omitted } = jobOpeningPayload({
    roleName: role.name, brief, location, salary, jobType
  });

  try {
    const res = await call({
      conn, path: `/${MODULE_JOB_OPENINGS}`, method: "POST",
      body: { data: [record] }, ctx
    });

    const first = Array.isArray(res?.data) ? res.data[0] : null;
    const externalId = cleanString(first?.details?.id) || cleanString(res?.id);
    if (!externalId) {
      // Zoho reports per-record failures inside a 200. Without an id there is no
      // job, and calling it posted would leave us polling a requisition that does
      // not exist.
      const message = scrub(String(first?.message || first?.code || "Zoho returned no record id"));
      return failPosting(tx, posting, message);
    }

    const { rows } = await tx.query(
      `UPDATE hiring_job_postings
          SET status = 'posted', external_id = $2, title = $3, description = $4,
              location = $5, posted_at = now(), last_synced_at = now(), last_error = NULL,
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [posting.id, externalId, role.name, brief,
       [cleanString(location.city), cleanString(location.state), cleanString(location.country)]
         .filter(Boolean).join(", ") || null]);

    return { ok: true, posting: rows[0], zohoJobId: externalId, omittedFields: omitted };
  } catch (err) {
    return failPosting(tx, posting, scrub(String(err.platformMessage || err.message)), err.retryable === true);
  }
}

async function ensurePosting(tx, { orgId, role }) {
  const existing = (await tx.query(
    `SELECT * FROM hiring_job_postings
      WHERE org_id = $1 AND role_id = $2 AND channel = 'zoho' AND status <> 'closed'
      ORDER BY created_at DESC LIMIT 1`, [orgId, role.id])).rows[0];
  if (existing) return existing;

  const { rows } = await tx.query(
    `INSERT INTO hiring_job_postings (org_id, role_id, channel, title, status)
     VALUES ($1, $2, 'zoho', $3, 'draft')
     RETURNING *`, [orgId, role.id, role.name]);
  return rows[0];
}

const refuse = (posting, reason, message) =>
  ({ ok: false, reason, message, queued: posting.status === "draft", posting });

async function failPosting(tx, posting, message, retryable = false) {
  const text = String(message).slice(0, 1000);
  const { rows } = await tx.query(
    `UPDATE hiring_job_postings
        SET status = 'failed', last_error = $2, last_synced_at = now(), updated_at = now()
      WHERE id = $1 RETURNING *`, [posting.id, text]);
  return { ok: false, reason: "zoho_error", message: text, retryable, posting: rows[0] };
}

/* closeJob(tx, spec) → { ok, posting }

   Frees the one slot the free tier gives us. Zoho is told first: a posting closed
   in our database but still live on LinkedIn keeps collecting applicants we have
   stopped polling for. */
export async function closeJob(tx, { orgId, postingId, ctx = {} } = {}) {
  const posting = (await tx.query(
    `SELECT * FROM hiring_job_postings WHERE id = $1 AND org_id = $2`,
    [postingId, orgId])).rows[0];
  if (!posting) { const e = new Error("closeJob: posting not found"); e.code = "NOT_FOUND"; throw e; }

  if (posting.external_id) {
    const conn = await refreshIfNeeded(tx, { orgId, ctx });
    await call({
      conn, path: `/${MODULE_JOB_OPENINGS}`, method: "PUT",
      body: { data: [{ id: posting.external_id, Job_Status: JOB_STATUS_CLOSED, Publish: false }] },
      ctx
    });
  }

  const { rows } = await tx.query(
    `UPDATE hiring_job_postings
        SET status = 'closed', closed_at = now(), updated_at = now()
      WHERE id = $1 RETURNING *`, [postingId]);
  return { ok: true, posting: rows[0] };
}

/* ─────────────────────────── the sync ─────────────────────────── */

/* syncCandidates(tx, spec) → summary

   The poll. Runs on a cron (see the notes doc for the registration the workflows
   lane needs to add) and is safe to run at any interval, from any number of
   sessions, in any order.

   WHY IT READS TWICE. The union of two reads is deliberate, not redundancy:

     * The ASSOCIATE read, per live posting, is the one that knows WHICH REQ a
       person applied for. It also has no "since", so it catches anybody who
       applied before our first ever sync — the cold-start gap that a
       cursor-only design loses permanently and silently.
     * The SEARCH read is incremental and cheap, and catches somebody who is in
       Zoho without being attached to one of our postings.

   Idempotency makes the overlap free, which is the whole reason it can be this
   generous. Duplicates cost nothing; a gap is invisible forever.

   THE CURSOR MOVES LAST, and only on a clean run. `runStartedAt` is captured
   BEFORE the first read so that anything created while the run was in flight is
   re-read next time rather than skipped. A truncated page set, or any failure,
   leaves the cursor where it was — re-reading a thousand records costs a few API
   calls, and missing one costs a hire. */
export async function syncCandidates(tx, { orgId, ctx = {}, now = new Date() } = {}) {
  if (!orgId) throw new Error("syncCandidates: orgId is required");

  const conn = await refreshIfNeeded(tx, { orgId, ctx, now });
  const runStartedAt = new Date(now.getTime());
  const from = windowStart({ cursor: conn.sync_cursor, now });

  const summary = {
    created: 0, duplicates: 0, skipped: 0, protectedDropped: 0,
    pages: 0, truncated: false, errors: [], results: [],
    from: from.toISOString(), cursorAdvancedTo: null
  };

  // Which req does an unattached candidate belong to? With one live posting the
  // answer is obvious. With none, or with several (a paid plan), it is not, and
  // guessing would file somebody against the wrong role.
  const live = await livePostings(tx, orgId);

  // zoho candidate id → { raw, posting }. The associate read populates the
  // posting; the search read fills in anybody it did not cover.
  const merged = new Map();
  const unkeyed = [];

  for (const posting of live) {
    if (!posting.external_id) continue;
    try {
      const res = await fetchCandidatesForJob(tx, { orgId, zohoJobId: posting.external_id, ctx });
      summary.pages += res.pages;
      if (res.truncated) {
        summary.truncated = true;
        summary.errors.push(`associate read for ${posting.role_key} hit the ${MAX_PAGES}-page ceiling`);
      }
      for (const raw of res.records) {
        const id = cleanString(raw?.id);
        if (id) merged.set(id, { raw, posting });
        else unkeyed.push({ raw, posting });
      }
    } catch (err) {
      summary.errors.push(`associate read for ${posting.role_key} failed: ${scrub(String(err.message))}`);
    }
  }

  let searched = { records: [], pages: 0, truncated: false };
  try {
    searched = await fetchCandidates(tx, { orgId, since: from, ctx });
    summary.pages += searched.pages;
    if (searched.truncated) {
      summary.truncated = true;
      summary.errors.push(`candidate search hit the ${MAX_PAGES}-page ceiling — the window is too wide`);
    }
  } catch (err) {
    summary.errors.push(`candidate search failed: ${scrub(String(err.message))}`);
  }

  for (const raw of searched.records) {
    const id = cleanString(raw?.id);
    if (!id) { unkeyed.push({ raw, posting: null }); continue; }
    const prior = merged.get(id);
    // The associate read already knows the requisition, so its posting wins. Its
    // record is kept too: both endpoints return Candidate objects, and swapping
    // one for the other would make the answer set depend on read order.
    if (prior) merged.set(id, { raw: prior.raw || raw, posting: prior.posting });
    else merged.set(id, { raw, posting: null });
  }

  for (const entry of [...merged.values(), ...unkeyed]) {
    if (!entry.raw) continue;
    const outcome = await ingestOne(tx, {
      orgId, raw: entry.raw, posting: entry.posting, live
    });
    summary.results.push(outcome);
    if (outcome.status === "skipped") summary.skipped += 1;
    else if (outcome.created) summary.created += 1;
    else summary.duplicates += 1;
    summary.protectedDropped += outcome.protectedDropped || 0;
  }

  const clean = !summary.truncated && summary.errors.length === 0;
  if (clean) {
    await tx.query(
      `UPDATE hiring_channel_connections
          SET sync_cursor = $2, last_synced_at = now(), updated_at = now()
        WHERE id = $1`, [conn.id, runStartedAt.toISOString()]);
    summary.cursorAdvancedTo = runStartedAt.toISOString();
  } else {
    await tx.query(
      `UPDATE hiring_channel_connections SET last_synced_at = now(), updated_at = now()
        WHERE id = $1`, [conn.id]);
  }

  return summary;
}

/* ingestOne — one Zoho record through the front door.

   Never inserts into candidates or candidate_applications. apply() is the only
   write path, so this applicant is graded, gated and audited identically to one
   who came through our own careers form. */
async function ingestOne(tx, { orgId, raw, posting, live }) {
  const resolved = posting || (live.length === 1 ? live[0] : null);
  const roleKey = resolved?.role_key || null;

  const normalised = normaliseCandidate(raw, {
    roleKey,
    jobPostingId: resolved?.id || null,
    sourceDetail: resolved?.title || resolved?.role_name || null
  });

  const dropped = normalised.droppedProtected.length;

  if (!normalised.zohoCandidateId) {
    // Nothing to key on, so it cannot even be recorded as skipped without
    // creating a duplicate row on every poll. Reported up, not written down.
    return { status: "skipped", reason: "no_zoho_id", protectedDropped: dropped };
  }

  if (!roleKey) {
    return recordLink(tx, {
      orgId, normalised, roleId: null, status: "skipped",
      reason: live.length ? "ambiguous_role" : "no_live_posting", dropped
    });
  }

  const roleId = resolved.role_id;

  if (!normalised.email || !normalised.fullName) {
    // RECORDED, NOT DROPPED. A mapping bug that loses the email field would
    // otherwise be indistinguishable from a quiet week — the most expensive
    // failure this connector has, because it stays invisible.
    const reason = !normalised.email ? "missing_email" : "missing_name";
    return recordLink(tx, { orgId, normalised, roleId, status: "skipped", reason, dropped });
  }

  const out = await apply(tx, {
    orgId,
    roleKey,
    fullName: normalised.fullName,
    email: normalised.email,
    phone: normalised.phone,
    source: "zoho",
    sourceDetail: normalised.sourceDetail,
    answers: normalised.answers,
    jobPostingId: normalised.jobPostingId,
    externalApplicationId: normalised.externalApplicationId
  });

  // apply()'s redelivery early-return carries the application but no candidate
  // row, so the candidate id is read off the application either way.
  const application = out.application || null;
  const strippedAgain = Array.isArray(out.strippedProtected) ? out.strippedProtected.length : 0;

  return recordLink(tx, {
    orgId, normalised, roleId,
    status: application ? "linked" : "skipped",
    reason: application ? null : "apply_returned_no_application",
    dropped: dropped + strippedAgain,
    candidateId: out.candidate?.id || application?.candidate_id || null,
    applicationId: application?.id || null,
    created: out.created === true
  });
}

/* recordLink — the id map row. Upsert, so a redelivery updates last_seen_at
   instead of failing on the unique index. */
async function recordLink(tx, {
  orgId, normalised, roleId, status, reason = null, dropped = 0,
  candidateId = null, applicationId = null, created = false
}) {
  // A skipped row with no role cannot be stored: role_id is NOT NULL because a
  // link with no requisition is not a link. Reported up instead.
  if (!roleId) {
    return {
      status: "skipped", reason, created: false, protectedDropped: dropped,
      zohoCandidateId: normalised.zohoCandidateId, recorded: false
    };
  }

  const { rows } = await tx.query(
    `INSERT INTO hiring_zoho_candidate_links
       (org_id, zoho_candidate_id, role_id, candidate_id, application_id,
        external_application_id, status, skip_reason, protected_fields_dropped,
        zoho_modified_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (org_id, zoho_candidate_id, role_id) DO UPDATE
       SET candidate_id   = COALESCE(EXCLUDED.candidate_id, hiring_zoho_candidate_links.candidate_id),
           application_id = COALESCE(EXCLUDED.application_id, hiring_zoho_candidate_links.application_id),
           external_application_id = COALESCE(EXCLUDED.external_application_id,
                                              hiring_zoho_candidate_links.external_application_id),
           status         = EXCLUDED.status,
           skip_reason    = EXCLUDED.skip_reason,
           -- The COUNT of protected fields is a high-water mark, not a running
           -- total: the same record seen twice dropped the same fields once.
           protected_fields_dropped = greatest(EXCLUDED.protected_fields_dropped,
                                               hiring_zoho_candidate_links.protected_fields_dropped),
           zoho_modified_time = COALESCE(EXCLUDED.zoho_modified_time,
                                         hiring_zoho_candidate_links.zoho_modified_time),
           last_seen_at   = now(),
           updated_at     = now()
     RETURNING *`,
    [orgId, normalised.zohoCandidateId, roleId, candidateId, applicationId,
     normalised.externalApplicationId, status, reason, dropped,
     normalised.zohoModifiedTime]);

  return {
    status, reason, created, protectedDropped: dropped, recorded: true,
    zohoCandidateId: normalised.zohoCandidateId,
    applicationId: rows[0]?.application_id || null,
    link: rows[0]
  };
}

/* ─────────────────────────── logging safety ─────────────────────────── */

/* Nothing in this module may put a token or a candidate's details into an error
   string. Zoho echoes request context into some error bodies, so the token is
   removed by value as well as by pattern. */
function scrub(text, token) {
  let out = String(text ?? "");
  if (token) out = out.split(token).join("[redacted]");
  return out
    .replace(/Zoho-oauthtoken\s+[A-Za-z0-9._\-]{6,}/gi, "Zoho-oauthtoken [redacted]")
    .replace(/\b1000\.[A-Za-z0-9]{16,}\.[A-Za-z0-9]{16,}\b/g, "[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email redacted]");
}

export default {
  connectionFor, refreshIfNeeded, fetchCandidates, fetchCandidatesForJob,
  normaliseCandidate, syncCandidates, postJob, closeJob, postingQueue,
  jobOpeningPayload, externalKeyFor, windowStart, zohoTimestamp,
  apiDomainFor, accountsDomainFor
};
