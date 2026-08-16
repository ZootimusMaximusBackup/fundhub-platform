// THE COORDINATOR. One pull, one stored result, one event.
//
// It orders every bureau, hands the answers to coordinateCrsResult() to be
// stored, and emits one event to say the row exists. It does not decide who to
// pull, it does not decide what the result means, and it does not write to the
// database itself.
//
// WHY IT DOES NOT WRITE. There were already two half-paths to a stored credit
// result and calling both wrote the row twice: recordPull() stored and ingested
// but emitted nothing, while the analysis.completed handler emitted and stored
// AGAIN — a second row with no tradelines and no ledger link, newer than the
// real one, so every "latest pull" reader would have picked the emptier of the
// two. coordinateCrsResult() in src/finance/soft-pulls.mjs closed that: it
// anchors the row on the provider's own response id, stores it, closes the
// request and ingests the tradelines in ONE transaction, and refuses a second
// result for the same request. This file uses it and adds nothing of its own.
//
// THE TIER ENGINE RUNS AFTER THE ROW IS STORED. crs-tier.mjs unwraps the raw
// Softview bodies under result.bureaus.TU|EX|EQ and calls the vendored
// runCRSEngine (normalizeSoftPull → routeOutcome). analysis.completed still
// means "the bureaus answered"; decision.rendered means "we chose a tier".
// emitCrsResult() is not used here — it would emit analysis.completed a second
// time on top of finishStored.
//
// PARTIAL PULLS ARE REAL RESULTS. Two bureaus answering and one failing is a
// worse answer than three, but it is still an answer, and the failure is stored
// beside the data. All three failing is not a result: the request is closed as
// failed and no row is written, because a row with no payload would read as "we
// pulled and they have no credit".

import { createHash } from "node:crypto";
import { emit } from "../events/bus.mjs";
import {
  claimSoftPull,
  coordinateCrsResult,
  getSoftPullRequest,
  closeSoftPull,
  SoftPullError
} from "./soft-pulls.mjs";
import { createCrsClient, CrsError } from "./crs-client.mjs";
import {
  activeBureausFromEnv,
  CrsIdentityError,
  identityForBureau,
  isoBirthDate,
  isSandboxHost,
  isProductionHost,
  SANDBOX_TEST_IDENTITIES
} from "./crs-identities.mjs";
import { mergeBureauReports, newInquiriesFor } from "./crs-map.mjs";
import {
  runTierEngineFromCrsResult,
  submittedAddressFromIdentity,
  submittedNameFromIdentity
} from "./crs-tier.mjs";
import { revealSsn, PiiError } from "../pii/index.mjs";

/** The provider namespace for `crs_results.provider`. The vendor, not the
 *  product: "CRS" is verifiable from the credentials and the host, and a
 *  product name nobody has confirmed would be a guess stored as fact. */
export const CRS_PROVIDER = "crs_softview";

/** What `reason` a pull requested by the paid diagnostic records in the ledger. */
export const DIAGNOSTIC_PULL_REASON =
  "automated tri-bureau soft pull after the paid credit diagnostic";

/** Who the PII access log names when a workflow reads an SSN to order a report. */
export const PULL_ACTOR = "workflow:crs-pull";

/** Which environment a host is, recorded on the stored payload. */
export function environmentFor(host) {
  if (isSandboxHost(host)) return "sandbox";
  if (isProductionHost(host)) return "production";
  return null;
}

/**
 * providerResultIdFor — stable, non-PII identity for one bureau bundle.
 * RequestIDs are trimmed, sorted, encoded unambiguously and hashed. No fallback
 * exists: without at least one provider RequestID there is no provider result
 * identity and the result must not be stored.
 */
export function providerResultIdFor({ requestIds = {} } = {}) {
  const ids = Object.values(requestIds)
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim())
    .sort();
  if (ids.length === 0) return null;
  const digest = createHash("sha256").update(JSON.stringify(ids)).digest("hex");
  return `crs-request-bundle:${digest}`;
}

function identityForTier({ identity, realIdentity, merged }) {
  if (realIdentity) return realIdentity;
  if (identity) return identity;
  const first = Array.isArray(merged?.bureausPulled) ? merged.bureausPulled[0] : null;
  if (first && SANDBOX_TEST_IDENTITIES[first]) return SANDBOX_TEST_IDENTITIES[first];
  return null;
}

async function persistOutcomeTier(db, { clientId, crsResultId, outcomeTier }) {
  await db.query(`UPDATE clients SET outcome_tier = $2 WHERE id = $1`, [clientId, outcomeTier]);
  await db.query(
    `UPDATE crs_results
        SET outcome_tier = COALESCE(outcome_tier, $2),
            updated_at = now()
      WHERE id = $1`,
    [crsResultId, outcomeTier]
  );
}

async function finishStored(db, {
  orgId,
  clientId,
  requestId,
  stored,
  identity = null,
  realIdentity = null,
  runTierEngine = runTierEngineFromCrsResult
}) {
  const merged = stored.crsResult.result || {};
  const tierIdentity = identityForTier({ identity, realIdentity, merged });
  const tierResult = runTierEngine(merged, {
    submittedName: submittedNameFromIdentity(tierIdentity),
    submittedAddress: submittedAddressFromIdentity(tierIdentity),
    formData: {
      name: submittedNameFromIdentity(tierIdentity) || null,
      email: tierIdentity?.email || null,
      phone: null
    }
  });
  const outcomeTier = tierResult.outcome;
  const fundingEstimate = tierResult.preapprovals?.totalCombined ?? null;

  await persistOutcomeTier(db, {
    clientId,
    crsResultId: stored.crsResult.id,
    outcomeTier
  });

  const inquiries = newInquiriesFor(merged);
  const analysis = await emit(db, "analysis.completed", {
    crsResultId: stored.crsResult.id,
    requestId,
    source: "crs",
    scores: merged.scores || { ex: null, eq: null, tu: null },
    bureaus: merged.bureaus || {},
    inquiries,
    outcomeTier
  }, {
    orgId,
    clientId,
    idempotencyKey: `crs-result:${stored.crsResult.id}:analysis.completed:v1`
  });

  const decision = await emit(db, "decision.rendered", {
    crsResultId: stored.crsResult.id,
    requestId,
    source: "crs",
    outcomeTier,
    fundingEstimate
  }, {
    orgId,
    clientId,
    idempotencyKey: `crs-result:${stored.crsResult.id}:decision.rendered:v1`
  });

  return {
    ok: true,
    crsResultId: stored.crsResult.id,
    request: stored.request,
    replayed: !!stored.replayed,
    bureausPulled: merged.bureausPulled || [],
    bureauErrors: merged.bureauErrors || {},
    scores: merged.scores || { ex: null, eq: null, tu: null },
    outcomeTier,
    fundingEstimate,
    tradelinesIngested: stored.ingested,
    event: { id: analysis.id, deduped: !!analysis.deduped },
    events: {
      analysis: { id: analysis.id, deduped: !!analysis.deduped },
      decision: { id: decision.id, deduped: !!decision.deduped }
    }
  };
}

/**
 * loadClientIdentity — the real person, for a production pull only.
 *
 * Reads the full SSN through revealSsn(), which writes an access-log row in the
 * same transaction. That entry is the point: an automated pull is still a
 * disclosure of a protected value, and "a workflow did it" is an actor like any
 * other. It is NOT called on sandbox — see runCrsPull, which does not ask.
 *
 * Returns null when there is no identity on file. That is a refusal, not an
 * empty identity: a credit report cannot be ordered on a blank SSN.
 */
export async function loadClientIdentity(db, {
  clientId, env = process.env, accessedBy = PULL_ACTOR
} = {}) {
  const row = (await db.query(
    `SELECT c.first_name, c.last_name, c.email, p.dob, p.addresses
       FROM clients c
       LEFT JOIN pii_identity p ON p.client_id = c.id
      WHERE c.id = $1`,
    [clientId]
  )).rows[0];
  if (!row) return null;

  let ssn = null;
  try {
    ({ ssn } = await revealSsn(db, {
      clientId, accessedBy, reason: "automated CRS soft pull", env
    }));
  } catch (e) {
    // No identity, no SSN, or no decryption key. All three mean "we cannot
    // order this report", and none of them should look like a vendor outage.
    if (e instanceof PiiError) return null;
    throw e;
  }
  if (!ssn) return null;

  return {
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    middleName: "",
    suffix: "",
    birthDate: isoBirthDate(row.dob) || "",
    ssn,
    email: row.email ?? undefined,
    addresses: Array.isArray(row.addresses) ? row.addresses : []
  };
}

/**
 * runCrsPull — order every bureau, store one result, emit one event.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.orgId
 * @param {string} opts.clientId
 * @param {string} opts.requestId    The queued soft_pull_requests row. REQUIRED.
 * @param {object} [opts.identity]   Overrides the lookup. Ignored on sandbox.
 * @param {object} [opts.client]     Injected CRS client (tests).
 * @param {object} [opts.env]
 * @param {Function} [opts.fetchImpl]
 * @param {string[]} [opts.bureaus]
 */
export async function runCrsPull(db, {
  orgId,
  clientId,
  requestId,
  identity = null,
  client,
  env = process.env,
  fetchImpl,
  bureaus,
  accessedBy = PULL_ACTOR,
  runTierEngine = runTierEngineFromCrsResult
} = {}) {
  if (!orgId || !clientId) throw new TypeError("runCrsPull: orgId and clientId are required");
  /* REQUIRED, not optional. The ledger row is what makes a pull attributable and
     what stops a second one running; coordinateCrsResult() will not store a
     result without it, and quietly falling back to a path that does would put an
     unattributed credit pull in the history. */
  if (!requestId) throw new TypeError("runCrsPull: requestId is required");
  const order = (Array.isArray(bureaus) && bureaus.length)
    ? bureaus
    : activeBureausFromEnv(env);

  // This check happens before client construction or any provider call. A normal
  // replay of a fulfilled ledger request reuses its stored row and event.
  const ledger = await getSoftPullRequest(db, requestId);
  if (!ledger) throw new SoftPullError("no such soft pull request", { status: 404 });
  if (String(ledger.org_id) !== String(orgId) || String(ledger.client_id) !== String(clientId)) {
    throw new SoftPullError("soft pull request belongs to a different org or client", { status: 409 });
  }
  if (ledger.status === "fulfilled") {
    const prior = (await db.query(
      `SELECT id, org_id, client_id, provider, provider_result_id, result, outcome_tier, created_at
         FROM crs_results WHERE id = $1`,
      [ledger.crs_result_id]
    )).rows[0];
    if (!prior || !prior.provider || !prior.provider_result_id) {
      throw new SoftPullError("fulfilled request has no anchored provider result", { status: 409 });
    }
    const replayed = await coordinateCrsResult(db, {
      orgId,
      clientId,
      requestId,
      provider: prior.provider,
      providerResultId: prior.provider_result_id,
      result: prior.result,
      outcomeTier: prior.outcome_tier
    });
    return finishStored(db, {
      orgId,
      clientId,
      requestId,
      stored: replayed,
      identity,
      realIdentity: null,
      runTierEngine
    });
  }

  /* CLAIM BEFORE ANY PROVIDER CALL. coordinateCrsResult only fulfils a
     processing row, and claiming here is what makes a concurrent second runner
     lose the race instead of ordering the same consumer twice. A row already
     claimed by this worker is fine to continue; any other open state is not. */
  if (ledger.status === "queued") {
    const claim = await claimSoftPull(db, { requestId, orgId, clientId });
    if (!claim.claimed && claim.reason !== "already_claimed") {
      throw new SoftPullError(`soft pull request is already ${claim.reason}`, { status: 409 });
    }
  } else if (ledger.status !== "processing") {
    throw new SoftPullError(`soft pull request is already ${ledger.status}`, { status: 409 });
  }

  const crs = client || createCrsClient({ env, fetchImpl });

  // A configuration fault is permanent until configuration changes. Failing the
  // request rather than throwing keeps a workflow from retrying a condition no
  // retry can fix, and leaves the reason where a human will read it.
  if (!crs.isConfigured()) {
    return finishFailed(db, {
      requestId,
      code: "not_configured",
      reason: `CRS is not configured — missing ${crs.config.missing.join(", ")}`
    });
  }

  const host = crs.host;
  const environment = environmentFor(host);

  /* The real client is loaded ONLY when the host is production. On sandbox the
     vendor's canned people are used and the client's SSN is never decrypted,
     never logged as accessed, and never sent anywhere. That is the difference
     between "we do not send it" and "we cannot send it". */
  let realIdentity = identity;
  if (isProductionHost(host) && !realIdentity) {
    realIdentity = await loadClientIdentity(db, { clientId, env, accessedBy });
    if (!realIdentity) {
      return finishFailed(db, {
        requestId,
        code: "identity_required",
        reason: "no identity on file for this client — a credit report cannot be ordered"
      });
    }
  }

  const reports = {};
  const errors = {};
  const requestIds = {};

  for (const bureau of order) {
    let bureauIdentity;
    try {
      bureauIdentity = identityForBureau({
        host, bureau, identity: realIdentity, env
      });
    } catch (e) {
      if (e instanceof CrsIdentityError) {
        return finishFailed(db, { requestId, code: e.code, reason: e.message });
      }
      throw e;
    }
    if (!bureauIdentity) {
      return finishFailed(db, {
        requestId,
        code: "identity_required",
        reason: "no identity on file for this client — a credit report cannot be ordered"
      });
    }

    let out;
    try {
      out = await crs.orderPrequal({ bureau, identity: bureauIdentity });
    } catch (e) {
      /* A refused identity or an unconfigured client is a fault about the whole
         pull, not weather at one bureau. Stopping means the same refused
         identity is never offered to the other two. */
      if (e instanceof CrsIdentityError
          || (e instanceof CrsError && e.code === "not_configured")) {
        return finishFailed(db, { requestId, code: e.code, reason: e.message });
      }
      if (e instanceof CrsError) { errors[bureau] = e.message; continue; }
      throw e;
    }

    if (out.requestId) requestIds[bureau] = out.requestId;
    if (out.ok && out.report) reports[bureau] = out.report;
    else errors[bureau] = out.error || `no report returned by ${bureau}`;
  }

  if (Object.keys(reports).length === 0) {
    const detail = Object.entries(errors).map(([b, e]) => `${b}: ${e}`).join(" | ");
    return finishFailed(db, {
      requestId,
      code: "no_reports",
      reason: detail ? `no bureau returned a report — ${detail}` : "no bureau returned a report"
    });
  }

  const providerResultId = providerResultIdFor({ requestIds });
  if (!providerResultId) {
    return finishFailed(db, {
      requestId,
      code: "provider_result_id_required",
      reason: "CRS returned reports without any RequestID; the result cannot be safely stored"
    });
  }

  const merged = mergeBureauReports({ reports, errors, requestIds, environment });

  /* ONE ROW, ONE TRANSACTION. Storing the result, closing the request and
     ingesting the tradelines either all land or none do. A replay of the same
     provider response comes back as `replayed: true` with the original row
     rather than a second one. */
  let stored;
  try {
    stored = await coordinateCrsResult(db, {
      orgId,
      clientId,
      requestId,
      provider: CRS_PROVIDER,
      providerResultId,
      result: merged,
      outcomeTier: null
    });
  } catch (e) {
    /* The bureaus answered; the ledger would not take the answer. Not closed as
       failed here: coordinateCrsResult refuses precisely when the row is
       already fulfilled or contested, and stamping 'failed' over that would
       overwrite a good record with a wrong one. */
    if (e instanceof SoftPullError) {
      return { ok: false, code: "not_stored", reason: e.message, request: null, crsResultId: null };
    }
    throw e;
  }

  return finishStored(db, {
    orgId,
    clientId,
    requestId,
    stored,
    identity,
    realIdentity,
    runTierEngine
  });
}

/* finishFailed — record why nothing was stored, then say so.
   Closing the ledger row matters more than it looks: a row left at 'queued'
   blocks the next request (090's one-open-per-client index), so a pull that
   quietly died would lock the client out of ever being pulled again. */
async function finishFailed(db, { requestId, reason, code }) {
  let closed = null;
  if (requestId) {
    try {
      closed = await closeSoftPull(db, { requestId, status: "failed", reason });
    } catch (e) {
      // Already resolved, or gone. The pull still failed and the caller still
      // needs the reason; losing it to a bookkeeping error is the worse outcome.
      if (!(e instanceof SoftPullError)) throw e;
    }
  }
  return { ok: false, code: code || "failed", reason, request: closed, crsResultId: null };
}
