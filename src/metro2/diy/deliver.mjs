// In-repo DIY letter package delivery — replaces UnderwriteIQ placeholder path.
// COMPLIANCE REVIEW REQUIRED — dispute letters. Nothing here mails a bureau.

import { buildDiyPackage } from "./package.mjs";
import { collectorsFromViolations } from "./collectors.mjs";
import { persistDiyPackageFiles } from "./persist.mjs";
import { violationsByBureauFromMergedCrs } from "./from-crs.mjs";
import { storeFromEnv } from "../../documents/store.mjs";
import { mergeCustomFields } from "../../workflows/custom-fields.mjs";

/**
 * Build DIY package from violations already on the client (or empty → stalled flag).
 * PDF bytes are stored on the documents registry when db + org + client are present.
 */
export async function deliverDiyPackageInRepo(db, {
  clientId,
  orgId,
  identity,
  violationsByBureau,
  seed,
  store,
  furnishers,
  sourceEventId
} = {}) {
  const vmap = await resolveViolationsByBureau(db, { clientId, violationsByBureau });
  const letterIdentity = await resolveLetterIdentity(db, { clientId, identity });
  const hasAny = Object.values(vmap).some((arr) => Array.isArray(arr) && arr.length > 0);
  if (!hasAny) {
    // Soft-pull often yields few Metro 2 codes — still ship a minimal package only when
    // violations exist. Without detections, refuse rather than mail empty claims.
    if (db && clientId) {
      await mergeCustomFields(db, clientId, {
        diy_status: "Awaiting Violations",
        diy_package_reason: "no_rule_backed_violations"
      });
    }
    return {
      delivered: false,
      blocked: false,
      reason: "no_violations",
      event: "diy.package.generating"
    };
  }

  const pack = await buildDiyPackage({
    violationsByBureau: vmap,
    identity: letterIdentity,
    seed: seed || `${orgId}:${clientId}`,
    furnishers: Array.isArray(furnishers) && furnishers.length
      ? furnishers
      : collectorsFromViolations(vmap)
  });

  if (!pack.ok) {
    if (db && clientId) {
      await mergeCustomFields(db, clientId, {
        diy_status: "Stalled — Variance",
        diy_package_reason: pack.reason || "variance"
      });
    }
    return { delivered: false, reason: pack.reason, stalled: true, event: "repair.stalled" };
  }

  let persisted = { stored: [], skipped: "not_attempted" };
  if (db && orgId && clientId) {
    persisted = await persistDiyPackageFiles(db, store || storeFromEnv(), {
      orgId,
      clientId,
      files: pack.files,
      generatedBy: "ds-02-diy-letters",
      sourceEventId: sourceEventId || seed || `${orgId}:${clientId}`
    });
  }

  if (db && clientId) {
    await mergeCustomFields(db, clientId, {
      diy_status: "Ready",
      diy_letter_count: pack.letterCount,
      diy_pdf_count: persisted.stored.length,
      diy_package_ready_at: new Date().toISOString()
    });
  }

  return {
    delivered: true,
    letterCount: pack.letterCount,
    files: pack.files.map((f) => ({ path: f.path, bytes: f.pdf?.byteLength || (f.text || "").length })),
    documents: persisted.stored,
    persistSkipped: persisted.skipped,
    event: "diy.package.ready"
  };
}

function hasViolationMap(vmap) {
  return Object.values(vmap || {}).some((arr) => Array.isArray(arr) && arr.length > 0);
}

/* MEASURED 2026-09-03 — the owner's "any derogatory deserves a letter" rule
   CANNOT be applied here yet, and the reason is not in this file.

   Merging derogatory claims (./derogatory.mjs) into the map below is a two-line
   change and this function has everything it needs to gate it: db, orgId and
   clientId, so ../../repair/on-repair-path.mjs answers directly. The blocker is
   downstream in ./package.mjs. That builder writes R1, R2 and R3 for all three
   bureaus in ONE batch and runs assertBatchVariance over the whole batch at
   0.45. Derogatory claims name the SAME accounts on all three bureaus and their
   prose is one of three fixed templates, so the letters collide with each other
   and the gate refuses the batch outright — `reason: "batch_variance"`, zero
   files. On the sandbox three-bureau pull that takes a working 7-letter pack to
   NOTHING. Turning zero letters into zero letters and breaking every file that
   works today is not the fix, so it is not applied.

   What has to happen first, in ./package.mjs or ../letters/: the batch gate must
   stop comparing letters that argue the same accounts to different bureaus, or
   the derogatory claim prose must vary per bureau and per round. Then this
   function is a two-line change. */
async function resolveViolationsByBureau(db, { clientId, violationsByBureau } = {}) {
  const given = violationsByBureau || {};
  if (hasViolationMap(given)) return given;
  if (!db || !clientId) return {};
  const crs = await db.query(
    `SELECT result FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [clientId]
  );
  const result = crs.rows?.[0]?.result;
  if (!result) return {};
  return violationsByBureauFromMergedCrs(result);
}

async function resolveLetterIdentity(db, { clientId, identity } = {}) {
  if (identity?.fullName) return identity;
  const fallback = identity && typeof identity === "object" ? { ...identity } : {};
  if (!db || !clientId) {
    return { fullName: "Client", ...fallback };
  }
  const client = await db.query(
    `SELECT first_name, last_name, custom_fields FROM clients WHERE id = $1`,
    [clientId]
  );
  const row = client.rows?.[0];
  if (!row) return { fullName: "Client", ...fallback };
  const cf = row.custom_fields && typeof row.custom_fields === "object" ? row.custom_fields : {};
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return {
    fullName: name || fallback.fullName || "Client",
    addressLine1: String(cf.address_line1 || cf.address || "").trim() || fallback.addressLine1 || "",
    city: String(cf.city || "").trim() || fallback.city || "",
    state: String(cf.state || "").trim() || fallback.state || "",
    zip: String(cf.zip || cf.postal_code || "").trim() || fallback.zip || ""
  };
}
