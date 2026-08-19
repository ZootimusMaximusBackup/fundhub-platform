// POST /api/creative/generate — enqueue a creative generation job.
// Wraps src/creative/generate.mjs enqueue().

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { enqueue } from "../../src/creative/generate.mjs";
import { resolve } from "../../src/creative/providers/index.mjs";
import { safeError } from "../../src/http/health.mjs";
import { assertSuiteEnabled, SUITE_OFF } from "../../src/brand/meter.mjs";

/* WHO ASKED, translated from the principal into the columns 241 added.

   This used to be `requestedBy: principal.staffId || null` against a single
   requested_by column that referenced accounts(id). An employee's id lives in
   `staff`, not in `accounts`, so every enqueue from an owner or admin session
   raised a foreign key violation and the screen showed a 500. A partner session
   has no staffId at all, so it wrote NULL and looked fine — which is why the
   fault only ever showed up for staff.

   A principal kind this function does not recognise records nobody rather than
   guessing. An unattributed job is legal here (045: "NULL for a
   scheduled/agent-initiated batch"); a wrongly attributed one is not. */
function requesterOf(principal) {
  if (principal?.kind === "staff" && principal.staffId) {
    return { requestedByKind: "staff", requestedByStaffId: principal.staffId };
  }
  if (principal?.kind === "partner" && principal.accountId) {
    return { requestedByKind: "partner", requestedByAccountId: principal.accountId };
  }
  return { requestedByKind: null };
}

/* checkProvider — is there a service that could run this job, and if not, why not.

   resolve() throws for TWO different reasons and they are not the same news:
   nothing configured at all, or a configured provider key with no module behind
   it (src/creative/providers/index.mjs:55 and :62). A bare catch treated both —
   and every unexpected failure, a dropped connection included — as "no ad-making
   service is switched on for this account", which for two of those three is
   simply false. api/creative/run.mjs:20 already tells them apart; this is the
   same ladder, worded for the moment just after a job was saved.

   READY IS null, NOT false, WHEN THE CHECK ITSELF FAILED. The job is saved
   either way; what we do not know is whether it can run, and saying "it cannot"
   would be a claim nobody checked. */
async function checkProvider(orgId, assetKind) {
  const QUEUED = "Saved to the queue. It is picked up within a few minutes, or press \"Run queued jobs now\".";
  const CANNOT = " The next try will be recorded as a failure and nothing will be made.";
  try {
    await resolve(db, { orgId, assetKind });
    return { ready: true, note: QUEUED };
  } catch (err) {
    const text = String(err?.message || err || "");
    if (/no active provider configured/i.test(text)) {
      return { ready: false, note:
        "Saved to the queue, but it cannot run yet: no ad-making service is switched on for this account." + CANNOT };
    }
    if (/has no module/i.test(text)) {
      return { ready: false, note:
        "Saved to the queue, but it cannot run yet: the ad-making service on file is one this system does not know how to use." + CANNOT };
    }
    return { ready: null, note:
      "Saved to the queue. We could not check whether an ad-making service is switched on, so we cannot say yet whether it will run." };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
  if (!principal) return;

  const body = req.body || {};
  const partnerId = resolvePartnerId(principal, {
    partner_id: body.partner_id || (req.query || {}).partner_id
  });
  if (!partnerId) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }

  const assetKind = body.asset_kind || body.assetKind || "static";
  const idempotencyKey = body.idempotency_key || body.idempotencyKey;
  if (!idempotencyKey) {
    return res.status(400).json({
      ok: false,
      error: "idempotency_key_required",
      message: "Pass a stable idempotency_key so retries do not double-bill."
    });
  }

  try {
    const result = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      const org = (await tx.query(
        `SELECT org_id FROM partners WHERE id = $1`, [partnerId]
      )).rows[0];
      if (!org) {
        const e = new Error("partner not found");
        e.code = "NOT_FOUND";
        throw e;
      }
      await assertSuiteEnabled(tx, partnerId);
      const out = await enqueue(tx, {
        orgId: org.org_id,
        partnerId,
        brandKitId: body.brand_kit_id || null,
        ...requesterOf(principal),
        assetKind,
        idempotencyKey,
        spec: body.spec || {
          prompt: body.prompt || "",
          formats: body.formats || ["1x1"],
          variants: body.variants || 1
        }
      });
      return { ...out, orgId: org.org_id };
    });

    /* CAN THIS JOB ACTUALLY RUN? Asked with the same resolve() the runner uses,
       so the answer the screen shows is the real one rather than a hedge. There
       is no creative_providers row in any migration or seed file, so on a fresh
       install the answer is no — and src/creative/generate.mjs treats that as a
       permanent failure, not an outage. Saying "queued" and stopping there would
       let the screen imply pictures are coming when nothing can make them.

       ASKED OUTSIDE THE TRANSACTION, ON PURPOSE. This used to run inside the
       withPartnerScope callback, on the same transaction that had just written
       the job. A throw there — and resolve() throws for more than one reason —
       could take the enqueue down with it. Out here the job is already
       committed, so no answer this check gives, and no way it fails, can undo
       the row. A plain db read is enough: creative_providers is keyed by org,
       not by partner, so it needs no partner scope. */
    const readiness = await checkProvider(result.orgId, assetKind);

    return res.status(200).json({
      ok: true,
      created: result.created,
      job: result.job,
      provider_ready: readiness.ready,
      note: readiness.note
    });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: err.message });
    if (err.code === SUITE_OFF) {
      return res.status(403).json({ ok: false, error: "suite_off",
        message: "The owner has not turned this on for this partner." });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
