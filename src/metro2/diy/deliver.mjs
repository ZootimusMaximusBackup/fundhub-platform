// In-repo DIY letter package delivery — replaces UnderwriteIQ placeholder path.

import { buildDiyPackage } from "./package.mjs";
import { mergeCustomFields } from "../../workflows/custom-fields.mjs";

/**
 * Build DIY package from violations already on the client (or empty → stalled flag).
 * Stores package metadata on custom_fields; PDF bytes are not persisted here
 * (caller / document registry can upload). Returns delivery shape compatible with ds-02.
 */
export async function deliverDiyPackageInRepo(db, {
  clientId,
  orgId,
  identity,
  violationsByBureau,
  seed
}) {
  const vmap = violationsByBureau || {};
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
    identity: identity || { fullName: "Client" },
    seed: seed || `${orgId}:${clientId}`
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

  if (db && clientId) {
    await mergeCustomFields(db, clientId, {
      diy_status: "Ready",
      diy_letter_count: pack.letterCount,
      diy_package_ready_at: new Date().toISOString()
    });
  }

  return {
    delivered: true,
    letterCount: pack.letterCount,
    files: pack.files.map((f) => ({ path: f.path, bytes: f.pdf?.byteLength || (f.text || "").length })),
    event: "diy.package.ready"
  };
}
