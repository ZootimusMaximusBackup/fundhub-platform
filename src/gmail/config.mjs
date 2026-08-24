// Personal Gmail OAuth config — same desktop token.json as Company Brain Drive.
//
// Env (first match wins):
//   GOOGLE_GMAIL_OAUTH_TOKEN_PATH / GOOGLE_GMAIL_OAUTH_TOKEN_JSON
//   GOOGLE_OAUTH_TOKEN_PATH / GOOGLE_OAUTH_TOKEN_JSON  (shared alias)
//   GOOGLE_DRIVE_OAUTH_TOKEN_PATH / GOOGLE_DRIVE_OAUTH_TOKEN_JSON  (fallback)

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GOOGLE_TOKEN_URL } from "../company-brain/config.mjs";

export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

const OAUTH_ENV_KEYS = [
  ["GOOGLE_GMAIL_OAUTH_TOKEN_PATH", "GOOGLE_GMAIL_OAUTH_TOKEN_JSON"],
  ["GOOGLE_OAUTH_TOKEN_PATH", "GOOGLE_OAUTH_TOKEN_JSON"],
  ["GOOGLE_DRIVE_OAUTH_TOKEN_PATH", "GOOGLE_DRIVE_OAUTH_TOKEN_JSON"]
];

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
  if (!refreshToken) missing.push("oauth(refresh_token)");
  if (!clientId) missing.push("oauth(client_id)");
  if (!clientSecret) missing.push("oauth(client_secret)");
  if (missing.length) return { missing, credentials: null };
  return {
    missing: [],
    credentials: { refreshToken, clientId, clientSecret, tokenUri }
  };
}

function oauthCredentialsFromKeys(env, pathKey, jsonKey) {
  const pathRaw = String(env[pathKey] || "").trim();
  const inlineRaw = env[jsonKey] || "";
  if (!pathRaw && !inlineRaw) return null;

  if (inlineRaw) {
    try {
      const parsed = typeof inlineRaw === "string" ? JSON.parse(inlineRaw) : inlineRaw;
      return { ...parseOAuthTokenJson(parsed), tokenSource: jsonKey };
    } catch {
      return { missing: [`${jsonKey}(invalid_json)`], credentials: null, tokenSource: jsonKey };
    }
  }

  const resolved = resolveTokenPath(pathRaw);
  if (!resolved || !existsSync(resolved)) {
    return { missing: [`${pathKey}(not_found)`], credentials: null, tokenSource: pathKey };
  }
  try {
    const parsed = JSON.parse(readFileSync(resolved, "utf8"));
    return { ...parseOAuthTokenJson(parsed), tokenSource: pathKey };
  } catch {
    return { missing: [`${pathKey}(invalid_json)`], credentials: null, tokenSource: pathKey };
  }
}

/**
 * Read personal Gmail OAuth settings from env.
 * Returns { ready, missing[], authMode, oauthCredentials, tokenSource }.
 */
export function gmailConfigFromEnv(env = process.env) {
  for (const [pathKey, jsonKey] of OAUTH_ENV_KEYS) {
    const oauth = oauthCredentialsFromKeys(env, pathKey, jsonKey);
    if (!oauth) continue;
    if (oauth.missing.length) {
      return {
        ready: false,
        missing: oauth.missing,
        authMode: "oauth",
        oauthCredentials: null,
        tokenSource: oauth.tokenSource
      };
    }
    return {
      ready: true,
      missing: [],
      authMode: "oauth",
      oauthCredentials: oauth.credentials,
      tokenSource: oauth.tokenSource
    };
  }

  return {
    ready: false,
    missing: [
      "GOOGLE_GMAIL_OAUTH_TOKEN_PATH|GOOGLE_OAUTH_TOKEN_PATH|GOOGLE_DRIVE_OAUTH_TOKEN_PATH"
    ],
    authMode: null,
    oauthCredentials: null,
    tokenSource: null
  };
}
