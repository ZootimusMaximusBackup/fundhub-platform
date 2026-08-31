// POST /api/public/decline-autopsy-upload — THE BOUNDARY.
//
// COMPLIANCE REVIEW REQUIRED. Spec: docs/specs/W3-decline-autopsy.md §5, §8.
//
// This is the one place in the system where a stranger's file meets the
// database, and the people described in that file never agreed to anything. So
// the order below is not arbitrary and must not be rearranged:
//
//   1. The autopsy must exist AND be PAID. Pay first, upload second — otherwise
//      we would be holding other people's records from someone who never became
//      a customer.
//   2. The merchant attestation is REQUIRED. It is not a consumer consent and it
//      is not stored in client_consents; it goes on the autopsy row.
//   3. The file is size-capped and sniffed.
//   4. The file is PARSED AND REFUSED — refused column names dropped and
//      counted, refused cell values killing the whole upload — BEFORE anything
//      is written to storage or to the database.
//   5. Only then are the raw bytes stored, the rows scored, and the raw file
//      DELETED again. We keep the cleaned rows, never the original.
//
// NO AUTH. A stranger from an ad who has paid $27. NO CREDIT PULL happens here
// or anywhere downstream of here. NO OUTBOUND SMS OR EMAIL.
//
// WHY NOT api/documents-upload.mjs: it gates on requirePrincipal(["staff",
// "client"]) and every row it writes hangs off a client_id. A $27 buyer is
// neither. Its tenancy rules are load-bearing and letting a stranger in through
// it would be the wrong door. The VALIDATORS and the BLOB STORE are reused as
// libraries; the endpoint is not.

import { db } from "../../src/db.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { safeError } from "../../src/http/health.mjs";
import { maxUploadBytes, validateCsvUpload } from "../../src/documents/upload-validate.mjs";
import { storeFromEnv } from "../../src/documents/store.mjs";
import { listLenders } from "../../src/lenders/store.mjs";
import { parseAutopsyRows } from "../../src/autopsy/parse.mjs";
import { scoreAutopsyRows } from "../../src/autopsy/score.mjs";
import { buildAutopsyReport } from "../../src/autopsy/report.mjs";
import { signReportUrl } from "../../src/autopsy/link.mjs";
import { ATTESTATION_VERSION, MAX_ROWS } from "../../src/autopsy/fields.mjs";
import {
  clearRawFile,
  getAutopsyByRef,
  recordAttestation,
  saveScoredRows,
  setRawStorageKey
} from "../../src/autopsy/store.mjs";

const cleanStr = (v, max = 200) => (v == null ? "" : String(v).trim().slice(0, max));

function readJson(req) {
  if (req?.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = typeof req?.body === "string" ? req.body : (typeof req?.rawBody === "string" ? req.rawBody : "");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Multipart arrives from netlify/functions/api.mjs as { fields, files }. */
function readMultipart(req) {
  const b = req?.body;
  if (b && typeof b === "object" && Array.isArray(b.files) && b.fields && typeof b.fields === "object") {
    return { fields: b.fields, files: b.files };
  }
  return null;
}

/**
 * The client's IP, for the attestation stamp. Same read the adapter does.
 * Stored against the BUYER's own record — he consented, he bought.
 */
function ipOf(req) {
  return req?.socket?.remoteAddress
    || req?.headers?.["x-nf-client-connection-ip"]
    || (req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim()
    || null;
}

/**
 * runAutopsyUpload — the whole boundary, as one testable function.
 *
 * Every failure returns { ok:false, status, ... } and NOTHING HAS BEEN WRITTEN.
 * That is the compliance argument in one line: we cannot mishandle data we never
 * took.
 */
export async function runAutopsyUpload({
  orgId,
  ref,
  attestationName,
  attestationAccepted,
  csvText = null,
  rows = null,
  fileBuffer = null,
  fileName = null,
  declaredMimeType = null,
  ip = null,
  dbh = db,
  store = null,
  env = process.env,
  now = new Date()
} = {}) {
  if (!ref) return { ok: false, status: 400, error: "ref_required", message: "That link is missing its reference. Start again from the checkout link." };

  const upload = await getAutopsyByRef(dbh, { orgId, ref });
  if (!upload) return { ok: false, status: 404, error: "not_found", message: "We could not find that purchase." };
  if (upload.deleted_at) return { ok: false, status: 410, error: "deleted", message: "That upload was deleted." };

  /* 1. PAID FIRST. */
  if (!upload.paid_at) {
    return {
      ok: false, status: 402, error: "payment_required",
      message: "We have not seen the payment for this yet. Once it lands you can upload."
    };
  }

  /* 2. THE ATTESTATION. Required, both the tick and the typed name. */
  const typedName = cleanStr(attestationName, 120);
  if (attestationAccepted !== true || !typedName) {
    return {
      ok: false, status: 400, error: "attestation_required",
      message: "Tick the box and type your name to confirm these are your own records with the names taken off."
    };
  }

  /* 3. THE FILE, if there is one. Size cap and CSV sniff, on the bytes. */
  let text = typeof csvText === "string" ? csvText : null;
  if (fileBuffer && fileBuffer.length) {
    const verdict = validateCsvUpload({
      buffer: fileBuffer,
      declaredMimeType,
      maxBytes: maxUploadBytes(env)
    });
    if (!verdict.ok) return { ok: false, status: 400, error: verdict.code, message: verdict.message };
    text = fileBuffer.toString("utf8");
  }

  /* 4. PARSE AND REFUSE, BEFORE ANY STORAGE. */
  const parsed = parseAutopsyRows({ csvText: text, rows, maxRows: MAX_ROWS });
  if (!parsed.ok) {
    return {
      ok: false, status: 400, error: parsed.error, message: parsed.message,
      column: parsed.column ?? undefined, row: parsed.row ?? undefined,
      stored: false
    };
  }

  /* 5. NOW we may write. Attestation first, so the record of why we were allowed
     to hold this exists before the thing it justifies. */
  await recordAttestation(dbh, { orgId, ref, typedName, ip, version: ATTESTATION_VERSION });

  const blobStore = store || storeFromEnv(env);
  let storedKey = null;
  if (fileBuffer && fileBuffer.length && blobStore?.provider?.put) {
    const safeName = cleanStr(fileName, 80).replace(/[^A-Za-z0-9._-]/g, "_") || "upload.csv";
    const pathname = `autopsy/${orgId}/${ref}/${safeName}`;
    storedKey = await blobStore.provider.put(pathname, fileBuffer, { contentType: "text/csv" });
    await setRawStorageKey(dbh, { orgId, autopsyId: upload.id, storageKey: storedKey });
  }

  /* The live lender list. NULL IS NOT AN EMPTY LIST — if we could not read it,
     scoreAutopsyRow reports the row as "not enough information" rather than
     claiming nobody would have taken the deal. */
  let lenders = null;
  try {
    const listed = await listLenders(dbh, { orgId });
    lenders = Array.isArray(listed) ? listed : (Array.isArray(listed?.rows) ? listed.rows : null);
  } catch {
    lenders = null;
  }

  const scored = scoreAutopsyRows(parsed.rows, { lenders, now });
  await saveScoredRows(dbh, {
    orgId,
    autopsyId: upload.id,
    rows: scored,
    columnsDropped: parsed.droppedColumns.length
  });

  /* THE HIGHEST-VALUE MINIMISATION STEP: the original file is deleted the moment
     parsing succeeded. We keep the cleaned rows, not what arrived. */
  const cleared = await clearRawFile(dbh, { orgId, autopsyId: upload.id, store: blobStore });

  let link = null;
  try {
    link = signReportUrl({ orgId, ref, env, baseUrl: env.PUBLIC_BASE_URL || null });
  } catch {
    link = null; // no secret configured — the report is still readable by ref+sig once one is set
  }

  return {
    ok: true,
    status: 200,
    ref,
    rowsAccepted: scored.length,
    droppedColumns: parsed.droppedColumns,
    ignoredColumns: parsed.ignoredColumns,
    rawFileDeleted: Boolean(cleared.deletedKey) || storedKey === null,
    report: buildAutopsyReport({ rows: scored, buyerName: upload.buyer_name, reviewedAt: now }),
    reportUrl: link?.url ?? null,
    reportExpiresAt: link?.expiresAtIso ?? null
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (String(req.method || "").toUpperCase() !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const orgId = await resolveDefaultOrg(db);
    const multi = readMultipart(req);
    const json = multi ? null : readJson(req);
    const fields = multi ? multi.fields : (json || {});
    const file = multi ? multi.files.find((f) => f?.buffer?.length) : null;

    const result = await runAutopsyUpload({
      orgId,
      ref: cleanStr(fields.ref, 64),
      attestationName: fields.attestation_name,
      attestationAccepted: fields.attestation_accepted === true || fields.attestation_accepted === "true",
      csvText: typeof fields.csv_text === "string" ? fields.csv_text : null,
      rows: Array.isArray(json?.rows) ? json.rows : null,
      fileBuffer: file?.buffer ?? null,
      fileName: file?.filename ?? null,
      declaredMimeType: file?.mimeType ?? null,
      ip: ipOf(req)
    });

    const { status, ...payload } = result;
    return res.status(status || (result.ok ? 200 : 400)).json(payload);
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
