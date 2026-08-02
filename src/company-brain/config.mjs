// Company Brain config — Drive connector credentials from env.
//
// Owner-set 2026-08-02 (H-1): pgvector (not Cognee) for v1 store.
// Owner-set 2026-08-02 (H-2): index everything. No folder exclusion list.
// Owner-set 2026-08-02 (H-3): only the owner role approves owner/affiliate classifications.

export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

/**
 * Read Drive connector settings from env.
 * Returns { ready, missing[], serviceAccount, delegateEmail }.
 * Does not throw — callers branch on `ready`.
 *
 * Env:
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON — full service-account JSON string
 *   GOOGLE_DRIVE_DELEGATE_EMAIL — Workspace user to impersonate (domain-wide delegation)
 */
export function driveConfigFromEnv(env = process.env) {
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

  if (!delegateEmail) missing.push("GOOGLE_DRIVE_DELEGATE_EMAIL");

  return {
    ready: missing.length === 0,
    missing,
    serviceAccount,
    delegateEmail,
    // H-2 owner-set: empty = index everything
    excludedFolderIds: []
  };
}
