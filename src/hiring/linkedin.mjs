// LinkedIn Talent Solutions — job postings out, applications in.
//
// ⚠️ CONFIRM BEFORE THIS RUNS LIVE. Talent Solutions is a partner-gated API and
// the payload shapes below are unverified against a real account — same status as
// the adapters in src/adapters/ carrying this marker. Confirm one real call per
// operation before a posting goes out under the company name.
//
// ══════════════════════════════════════════════════════════════════════════════
// WHAT THIS DELIBERATELY CANNOT DO: READ MEMBER PROFILES.
//
// There is no fetchProfile, no search, no connection-graph walk, and no field
// anywhere in 051_hiring.sql to put a harvested profile in. Two reasons, and the
// second is the one that matters:
//
//   1. Reading or storing LinkedIn member data beyond what an applicant submits
//      through our own posting breaches the platform terms, whatever API tier is
//      held.
//   2. Sourcing data pulled from a profile — photo, school, dates, group
//      memberships, inferred location — is a rich set of proxies for protected
//      characteristics. Feeding that into the same system that scores candidates
//      is how a defensible rubric becomes an indefensible one. src/hiring/grading.mjs
//      filters protected keys, but the cheapest way to not score something is to
//      never hold it.
//
// So the shape is: WE post, THEY apply, we ingest what the applicant chose to send.
// ══════════════════════════════════════════════════════════════════════════════

import { decryptToken } from "../adplatforms/tokens.mjs";
import { apply } from "./pipeline.mjs";

const BASE = "https://api.linkedin.com";
const API_VERSION = process.env.LINKEDIN_API_VERSION || "202405";

/* connectionFor — the active LinkedIn connection, or a clear error.
   Tokens are decrypted per call and never held longer than one request, reusing
   src/adplatforms/tokens.mjs rather than growing a second crypto path. */
export async function connectionFor(tx, { orgId }) {
  const { rows } = await tx.query(
    `SELECT * FROM hiring_channel_connections
      WHERE org_id = $1 AND channel = 'linkedin' AND connection_state = 'active'
      LIMIT 1`, [orgId]);
  const conn = rows[0];
  if (!conn) {
    throw new Error(
      "no active LinkedIn connection — complete the Talent Solutions OAuth flow before posting");
  }
  return conn;
}

/* The AAD for hiring-channel tokens is the ORG id, not a partner id. These are
   fundhub's own credentials; there is no tenant to bind to. Named here because
   using the wrong AAD is a silent decryption failure. */
const tokenFor = (conn) => {
  const t = decryptToken(conn.encrypted_access_token, { partnerId: conn.org_id });
  if (!t) throw new Error("LinkedIn connection has no access token");
  return t;
};

async function call({ url, token, body, method = "POST", ctx = {} }) {
  const doFetch = ctx.fetch || globalThis.fetch;
  if (typeof doFetch !== "function") throw new Error("no fetch available");

  let res;
  try {
    res = await doFetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "LinkedIn-Version": API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (err) {
    const e = new Error(`LinkedIn unreachable: ${scrub(String(err?.message || err), token)}`);
    e.retryable = true;
    throw e;
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const e = new Error(scrub(`LinkedIn ${res.status}: ${text}`, token).slice(0, 500));
    // The platform's own words, kept for last_error and the dashboard.
    e.platformMessage = scrub(text, token).slice(0, 1000) || `HTTP ${res.status}`;
    e.status = res.status;
    e.retryable = res.status === 429 || res.status >= 500;
    throw e;
  }
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

/* postJob(tx, spec) → posting row

   Publishes a posting and records the external id. The posting row is written
   BEFORE the API call and stamped after — same ordering as the ad platform writes,
   and for the same reason: a posting that exists on LinkedIn and nowhere in our
   database is one nobody can find or close. */
export async function postJob(tx, { orgId, postingId, ctx = {} } = {}) {
  const posting = (await tx.query(
    `SELECT p.*, r.name AS role_name FROM hiring_job_postings p
       JOIN hiring_roles r ON r.id = p.role_id
      WHERE p.id = $1`, [postingId])).rows[0];
  if (!posting) { const e = new Error("posting not found"); e.code = "NOT_FOUND"; throw e; }
  if (posting.channel !== "linkedin") {
    throw new Error(`postJob: posting ${postingId} is channel "${posting.channel}", not linkedin`);
  }

  const conn = await connectionFor(tx, { orgId });

  try {
    const res = await call({
      url: `${BASE}/rest/simpleJobPostings`,
      token: tokenFor(conn),
      body: {
        integrationContext: conn.external_account_id,
        companyApplyUrl: posting.apply_url,
        title: posting.title,
        description: posting.description,
        location: posting.location,
        employmentStatus: "FULL_TIME",
        externalJobPostingId: posting.id,
        listedAt: Date.now(),
        // The apply flow stays on our side, which is what keeps the answer set —
        // and therefore what the grader sees — under our control.
        jobPostingOperationType: "CREATE"
      },
      ctx
    });

    const externalId = res?.elements?.[0]?.jobPosting || res?.id || res?.jobPosting || null;
    const { rows } = await tx.query(
      `UPDATE hiring_job_postings
          SET status = 'posted', external_id = COALESCE($2, external_id),
              posted_at = now(), last_synced_at = now(), last_error = NULL
        WHERE id = $1 RETURNING *`,
      [postingId, externalId]);
    return { ok: true, posting: rows[0] };
  } catch (err) {
    const message = String(err.platformMessage || err.message).slice(0, 1000);
    await tx.query(
      `UPDATE hiring_job_postings SET status = 'failed', last_error = $2, last_synced_at = now()
        WHERE id = $1`, [postingId, message]);
    return { ok: false, error: message, retryable: err.retryable === true };
  }
}

export async function closeJob(tx, { orgId, postingId, ctx = {} } = {}) {
  const posting = (await tx.query(
    `SELECT * FROM hiring_job_postings WHERE id = $1`, [postingId])).rows[0];
  if (!posting?.external_id) throw new Error("closeJob: posting has no external id");
  const conn = await connectionFor(tx, { orgId });

  await call({
    url: `${BASE}/rest/simpleJobPostings/${encodeURIComponent(posting.external_id)}`,
    token: tokenFor(conn), method: "POST",
    body: { patch: { $set: { jobPostingOperationType: "CLOSE" } } },
    ctx
  });
  const { rows } = await tx.query(
    `UPDATE hiring_job_postings SET status = 'closed', closed_at = now() WHERE id = $1 RETURNING *`,
    [postingId]);
  return rows[0];
}

/* ingestApplications(tx, spec) → results[]

   Pulls new applications for a posting and turns each into a candidate +
   application through the normal apply() path — so a LinkedIn applicant is graded
   by the same rubric, held to the same human gate and audited the same way as a
   direct one. A separate ingest path would be a second, unaudited front door.

   Idempotent on externalApplicationId, so a re-run or a redelivered webhook
   produces no duplicates. */
export async function ingestApplications(tx, { orgId, postingId, ctx = {} } = {}) {
  const posting = (await tx.query(
    `SELECT p.*, r.key AS role_key FROM hiring_job_postings p
       JOIN hiring_roles r ON r.id = p.role_id
      WHERE p.id = $1`, [postingId])).rows[0];
  if (!posting?.external_id) throw new Error("ingestApplications: posting has no external id");

  const conn = await connectionFor(tx, { orgId });
  const res = await call({
    url: `${BASE}/rest/jobApplications?q=jobPosting&jobPosting=${encodeURIComponent(posting.external_id)}`,
    token: tokenFor(conn), method: "GET", ctx
  });

  const results = [];
  for (const raw of res?.elements || []) {
    const normalised = normaliseApplication(raw, posting);
    if (!normalised.email || !normalised.fullName) {
      // No contact details means nothing we can act on. Recorded rather than
      // dropped silently, so a mapping bug is visible instead of looking like
      // "nobody applied".
      results.push({ external_id: normalised.externalApplicationId, skipped: "missing_contact" });
      continue;
    }
    const out = await apply(tx, { orgId, ...normalised });
    results.push({
      external_id: normalised.externalApplicationId,
      application_id: out.application?.id,
      created: out.created,
      stripped_protected: out.strippedProtected
    });
  }

  await tx.query(
    `UPDATE hiring_job_postings SET last_synced_at = now() WHERE id = $1`, [postingId]);
  return results;
}

/* normaliseApplication — LinkedIn's shape → our apply() shape.
   Exported so it can be tested against a fixture without a network.

   ONLY WHAT THE APPLICANT SUBMITTED IS CARRIED ACROSS. Profile fields that
   LinkedIn may include alongside an application — photo, headline, current
   employer, school, dates — are deliberately not mapped. See the header. */
export function normaliseApplication(raw, posting = {}) {
  const answers = {};
  for (const q of raw?.questionAnswers || raw?.answers || []) {
    const key = slug(q?.question?.localized?.en_US || q?.question || q?.key);
    if (!key) continue;
    answers[key] = q?.answer?.localized?.en_US ?? q?.answer ?? q?.value ?? null;
  }

  return {
    roleKey: posting.role_key,
    jobPostingId: posting.id,
    externalApplicationId: String(raw?.id ?? raw?.entityUrn ?? "") || null,
    fullName: [raw?.firstName, raw?.lastName].filter(Boolean).join(" ").trim()
              || raw?.name || null,
    email: raw?.emailAddress ? String(raw.emailAddress).trim().toLowerCase() : null,
    phone: raw?.phoneNumber?.number || raw?.phoneNumber || null,
    source: "linkedin",
    sourceDetail: posting.title || null,
    // The applicant's own resume, which they chose to attach. Not a scraped
    // profile.
    videoUrl: null,
    answers
  };
}

const slug = (s) => String(s ?? "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || null;

function scrub(text, token) {
  let out = String(text ?? "");
  if (token) out = out.split(token).join("[redacted]");
  return out.replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, "Bearer [redacted]");
}

export default { postJob, closeJob, ingestApplications, normaliseApplication, connectionFor };
