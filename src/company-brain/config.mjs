// Company Brain config — Drive connector credentials from env.
//
// Owner-set 2026-08-02 (H-1): pgvector (not Cognee) for v1 store.
// Owner-set 2026-08-02 (H-2): index everything. No folder exclusion list.
// Owner-set 2026-08-02 (H-3): only the owner role approves owner/affiliate classifications.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

function resolveTokenPath(pathRaw) {
  const trimmed = String(pathRaw || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("~/")) {
    return join(process.env.HOME || "", trimmed.slice(2));
  }
  return trimmed;
}

function parseOAuthTokenJson(parsed) {
  const missing = [];
  const refreshToken = parsed?.refresh_token ? String(parsed.refresh_token) : "";
  const clientId = parsed?.client_id ? String(parsed.client_id) : "";
  const clientSecret = parsed?.client_secret ? String(parsed.client_secret) : "";
  const tokenUri = parsed?.token_uri ? String(parsed.token_uri) : GOOGLE_TOKEN_URL;
  if (!refreshToken) missing.push("GOOGLE_DRIVE_OAUTH_TOKEN(refresh_token)");
  if (!clientId) missing.push("GOOGLE_DRIVE_OAUTH_TOKEN(client_id)");
  if (!clientSecret) missing.push("GOOGLE_DRIVE_OAUTH_TOKEN(client_secret)");
  if (missing.length) return { missing, credentials: null };
  return {
    missing: [],
    credentials: { refreshToken, clientId, clientSecret, tokenUri }
  };
}

function oauthCredentialsFromEnv(env) {
  const pathRaw = String(env.GOOGLE_DRIVE_OAUTH_TOKEN_PATH || "").trim();
  const inlineRaw = env.GOOGLE_DRIVE_OAUTH_TOKEN_JSON || "";
  if (!pathRaw && !inlineRaw) return null;

  if (inlineRaw) {
    try {
      const parsed = typeof inlineRaw === "string" ? JSON.parse(inlineRaw) : inlineRaw;
      return parseOAuthTokenJson(parsed);
    } catch {
      return { missing: ["GOOGLE_DRIVE_OAUTH_TOKEN_JSON(invalid_json)"], credentials: null };
    }
  }

  const resolved = resolveTokenPath(pathRaw);
  if (!resolved || !existsSync(resolved)) {
    return { missing: ["GOOGLE_DRIVE_OAUTH_TOKEN_PATH(not_found)"], credentials: null };
  }
  try {
    const parsed = JSON.parse(readFileSync(resolved, "utf8"));
    return parseOAuthTokenJson(parsed);
  } catch {
    return { missing: ["GOOGLE_DRIVE_OAUTH_TOKEN_PATH(invalid_json)"], credentials: null };
  }
}

/**
 * Read Drive connector settings from env.
 * Returns { ready, missing[], authMode, serviceAccount, oauthCredentials, delegateEmail }.
 * Does not throw — callers branch on `ready`.
 *
 * Env (personal Gmail / desktop OAuth — takes precedence when set):
 *   GOOGLE_DRIVE_OAUTH_TOKEN_PATH — path to token.json from desktop OAuth
 *   GOOGLE_DRIVE_OAUTH_TOKEN_JSON — inline token.json string (for hosted deploys)
 *
 * Env (Workspace service account):
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON — full service-account JSON string
 *   GOOGLE_DRIVE_DELEGATE_EMAIL — optional Workspace user (domain-wide
 *     delegation). If unset, the robot reads files shared with it.
 */
export function driveConfigFromEnv(env = process.env) {
  const oauth = oauthCredentialsFromEnv(env);
  if (oauth) {
    return {
      ready: oauth.missing.length === 0,
      missing: oauth.missing,
      authMode: "oauth",
      oauthCredentials: oauth.credentials,
      serviceAccount: null,
      delegateEmail: null,
      excludedFolderIds: []
    };
  }

  const raw = env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || "";
  const delegateEmail = String(env.GOOGLE_DRIVE_DELEGATE_EMAIL || "").trim() || null;

  const missing = [];
  let serviceAccount = null;

  if (!raw) {
    missing.push("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON");
  } else {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      if (!parsed.client_email || !parsed.private_key) {
        missing.push("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON.client_email|private_key");
      } else {
        serviceAccount = {
          clientEmail: String(parsed.client_email),
          privateKey: String(parsed.private_key).replace(/\\n/g, "\n"),
          projectId: parsed.project_id ? String(parsed.project_id) : null
        };
      }
    } catch {
      missing.push("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON(invalid_json)");
    }
  }

  return {
    ready: missing.length === 0,
    missing,
    authMode: "service_account",
    oauthCredentials: null,
    serviceAccount,
    delegateEmail,
    // H-2 owner-set: empty = index everything
    excludedFolderIds: []
  };
}
