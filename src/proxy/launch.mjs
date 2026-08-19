// Orchestrate an Oxylabs Apply session: resolve client geo → verify exit → audit row.

import { launchCredentials, generateSessid } from "../adapters/oxylabs.mjs";
import {
  ProxySessionError,
  insertProxySession,
  updateProxySession,
  endProxySession,
  resolveClientLocation,
  loadClientForProxy,
  loadLenderForProxy,
  loadApplicationForProxy
} from "./sessions.mjs";

export { ProxySessionError };

/**
 * Launch a geo-targeted residential proxy for Apply.
 * Input: { orgId, staffId, clientId, lenderId?, applicationId? }
 * Returns connection details + verification — never claims in-browser routing is on.
 */
export async function launchProxySession(db, {
  orgId,
  staffId,
  clientId,
  lenderId = null,
  applicationId = null,
  env = process.env,
  fetchFn
} = {}) {
  if (!orgId || !staffId || !clientId) {
    throw new ProxySessionError("invalid_args", "org, staff and client are required", 400);
  }

  // Do NOT short-circuit on missing Oxylabs credentials here. launchCredentials()
  // returns the same `oxylabs_credentials_missing` error below, AFTER the pending
  // proxy_sessions row exists — so a refused launch still leaves an audit row.
  // Throwing here left proxy_sessions at 0 rows and hid the attempt entirely.
  const client = await loadClientForProxy(db, { orgId, clientId });
  if (!client) {
    throw new ProxySessionError("client_not_found", "Client not found in this org", 404);
  }

  let lender = null;
  let application = null;
  let applicationUrl = null;
  let resolvedLenderId = lenderId;

  if (applicationId) {
    application = await loadApplicationForProxy(db, { orgId, applicationId });
    if (!application) {
      throw new ProxySessionError("application_not_found", "Application not found", 404);
    }
    if (application.client_id && application.client_id !== clientId) {
      throw new ProxySessionError("client_mismatch", "Application belongs to a different client", 400);
    }
    applicationUrl = application.application_url || null;
    if (!resolvedLenderId && application.lender_id) resolvedLenderId = application.lender_id;
  }

  if (resolvedLenderId) {
    lender = await loadLenderForProxy(db, { orgId, lenderId: resolvedLenderId });
    if (!lender) {
      throw new ProxySessionError("lender_not_found", "Lender not found in this org", 404);
    }
    if (!applicationUrl) applicationUrl = lender.application_url || null;
  }

  if (!applicationUrl) {
    throw new ProxySessionError(
      "application_url_missing",
      "This lender has no application URL. Add application_url on the lender row before Apply.",
      400
    );
  }

  const loc = resolveClientLocation(client.custom_fields);
  if (!loc.city && !loc.state) {
    throw new ProxySessionError(
      "client_location_missing",
      "Client has no city or state on file (business_city / home_city / city and business_state / state). Cannot geo-target.",
      400
    );
  }

  const sessid = generateSessid();

  const pending = await insertProxySession(db, {
    orgId,
    clientId,
    staffId,
    lenderId: lender?.id || null,
    applicationId: application?.id || null,
    requestedCity: loc.city,
    requestedState: loc.state,
    sessid,
    applicationUrl,
    status: "verifying"
  });

  const launched = await launchCredentials({
    city: loc.city,
    state: loc.state,
    sessid,
    env,
    fetchFn
  });

  if (!launched.ok) {
    await updateProxySession(db, {
      orgId,
      id: pending.id,
      patch: {
        status: launched.error === "geo_unavailable" ? "mismatch" : "failed",
        errorCode: launched.error,
        errorMessage: launched.message || launched.error,
        verification: { attempts: launched.attempts || [] },
        endedAt: new Date().toISOString()
      }
    });
    const err = new ProxySessionError(
      launched.error || "launch_failed",
      launched.message || "Proxy launch failed",
      launched.error === "oxylabs_credentials_missing" ? 503 : 422
    );
    err.sessionId = pending.id;
    err.attempts = launched.attempts || [];
    throw err;
  }

  const active = await updateProxySession(db, {
    orgId,
    id: pending.id,
    patch: {
      status: "active",
      grantedCity: launched.granted_city,
      grantedRegion: launched.granted_region,
      targetingLevel: launched.targeting_level,
      exitIp: launched.exit_ip,
      proxyUsername: launched.proxy_username,
      verification: {
        exit_ip: launched.exit_ip,
        city: launched.granted_city,
        region: launched.granted_region,
        targeting_level: launched.targeting_level,
        raw: launched.verification?.raw || null
      }
    }
  });

  return {
    session: active || { ...pending, status: "active", sessid },
    connection: {
      host: launched.host,
      port: launched.port,
      username: launched.proxy_username,
      password: launched.password,
      sessid: launched.sessid,
      sesstime: launched.sesstime
    },
    verification: {
      exit_ip: launched.exit_ip,
      city: launched.granted_city,
      region: launched.granted_region,
      targeting_level: launched.targeting_level,
      requested_city: launched.requested_city,
      requested_state: launched.requested_state
    },
    application_url: applicationUrl,
    lender: lender
      ? { id: lender.id, name: lender.name, product_name: lender.product_name }
      : null,
    // Only the Chrome extension can turn routing on in the advisor's browser.
    routing_active: false,
    extension_required: true
  };
}

export async function endActiveProxySession(db, { orgId, sessionId, staffId = null }) {
  const row = await endProxySession(db, { orgId, id: sessionId, staffId });
  if (!row) {
    throw new ProxySessionError("session_not_found", "No active proxy session with that id", 404);
  }
  return row;
}
