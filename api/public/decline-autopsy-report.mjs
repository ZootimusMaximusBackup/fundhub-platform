// GET/DELETE /api/public/decline-autopsy-report — the report, and the buyer's
// own delete button.
//
// COMPLIANCE REVIEW REQUIRED. Spec: docs/specs/W3-decline-autopsy.md §8.5, §9.
//
// NO AUTH, AND THE SIGNATURE IS THE CREDENTIAL. A $27 buyer is a stranger with
// no login, exactly like the person clicking an unsubscribe link. The link is
// HMAC-signed and expiring (src/autopsy/link.mjs); an unsigned or expired one
// gets the same answer as an unknown one, so the endpoint cannot be used to
// find out which references exist.
//
// GET    — the report, assembled from the stored rows.
// DELETE — "Delete my upload". Immediate, hard delete of the rows and any
//          attachment, keeping the purchase record and a stamped reason. A
//          financial record of a $27 sale is not erasable and pretending
//          otherwise would be worse.
//
// NO OUTBOUND SMS OR EMAIL FROM THIS HANDLER. The spec's "confirmed by e-mail"
// belongs to the dispatcher, not here: outbound transmission is permitted in
// src/messaging/providers/* and nowhere else, and sendTemplated only queues a
// row. NOT WIRED — named in the change manifest as a gap.

import { db } from "../../src/db.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { safeError } from "../../src/http/health.mjs";
import { storeFromEnv } from "../../src/documents/store.mjs";
import { verifyReportToken } from "../../src/autopsy/link.mjs";
import { buildAutopsyReport } from "../../src/autopsy/report.mjs";
import { deleteUpload, getAutopsyByRef, listRows } from "../../src/autopsy/store.mjs";

const cleanStr = (v, max = 200) => (v == null ? "" : String(v).trim().slice(0, max));

/** Every refusal answers the same way. An unknown ref, a forged signature and an
 *  expired link must be indistinguishable, or the endpoint becomes a way to
 *  enumerate buyers. */
const REFUSED = { ok: false, error: "not_found", message: "That link is not valid any more." };

function queryOf(req) {
  if (req?.query && typeof req.query === "object") return req.query;
  try {
    return Object.fromEntries(new URL(req?.url || "", "https://internal.invalid").searchParams);
  } catch {
    return {};
  }
}

/**
 * loadAutopsyReport — verify, read, assemble. Returns null for every kind of
 * refusal so the caller cannot accidentally leak which one it was.
 */
export async function loadAutopsyReport({ query, orgId, dbh = db, env = process.env, now = new Date() } = {}) {
  const token = verifyReportToken({
    orgId: query.org ?? orgId,
    ref: query.ref,
    exp: query.exp,
    sig: query.sig,
    env
  });
  if (!token) return null;
  if (String(token.orgId) !== String(orgId)) return null;

  const upload = await getAutopsyByRef(dbh, { orgId, ref: token.ref });
  if (!upload || upload.deleted_at) return null;

  const rows = await listRows(dbh, { orgId, autopsyId: upload.id });
  return {
    upload,
    report: buildAutopsyReport({ rows, buyerName: upload.buyer_name, reviewedAt: upload.scored_at || now })
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const method = String(req.method || "GET").toUpperCase();
  if (!["GET", "DELETE"].includes(method)) {
    res.setHeader("allow", "GET, DELETE");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const orgId = await resolveDefaultOrg(db);
    const query = queryOf(req);

    if (method === "GET") {
      const loaded = await loadAutopsyReport({ query, orgId });
      if (!loaded) return res.status(404).json(REFUSED);
      return res.status(200).json({
        ok: true,
        ref: loaded.upload.autopsy_ref,
        rawFileDeletedAt: loaded.upload.raw_deleted_at,
        ...loaded.report
      });
    }

    /* DELETE — the buyer's own button. The signature is what proves it is him. */
    const token = verifyReportToken({
      orgId: query.org ?? orgId, ref: query.ref, exp: query.exp, sig: query.sig
    });
    if (!token || String(token.orgId) !== String(orgId)) return res.status(404).json(REFUSED);

    const reason = cleanStr(query.reason, 200) || "buyer used the delete button on the report page";
    const out = await deleteUpload(db, {
      orgId,
      ref: token.ref,
      reason,
      store: storeFromEnv(process.env)
    });
    if (!out) return res.status(404).json(REFUSED);

    return res.status(200).json({
      ok: true,
      ref: out.autopsy_ref,
      deletedAt: out.deleted_at,
      rowsDeleted: out.rowsDeleted,
      keptWithReason: out.kept_with_reason,
      message: "Your upload is gone — the rows and any file you attached. We keep the record that you bought the report, and nothing else."
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
