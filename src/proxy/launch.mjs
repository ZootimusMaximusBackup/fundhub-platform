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

  const loc = resolveClientLocation(client.custom_fields, client.businesses);
  if (!loc.city && !loc.state) {
    throw new ProxySessionError(
      "client_location_missing",
      "Client has no city or state on the person or any company on the file. Cannot geo-target.",
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

  // If anything between here and the status update throws, the row is left at
  // 'verifying' forever — nothing in this repo sweeps stale 'verifying' rows
  // (endProxySession only touches 'active'). Always close the row.
  let launched;
  try {
    launched = await launchCredentials({
      city: loc.city,
      state: loc.state,
      sessid,
      env,
      fetchFn
    });
  } catch (cause) {
    await updateProxySession(db, {
      orgId,
      id: pending.id,
      patch: {
        status: "failed",
        errorCode: "launch_threw",
        errorMessage: cause?.message || "Proxy launch threw",
        endedAt: new Date().toISOString()
      }
    }).catch(() => {});
    throw cause;
  }

  if (!launched.ok) {
    const closed = await updateProxySession(db, {
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
    // Only quote a session id the audit row actually reflects. A zero-row UPDATE
    // would otherwise hand back an id still sitting at status='verifying'.
    err.sessionId = closed ? pending.id : null;
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
