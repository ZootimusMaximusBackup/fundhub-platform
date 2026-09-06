// GET/POST /api/public/eeo-survey — voluntary EEO self-ID, separate from apply.
//
// COMPLIANCE REVIEW REQUIRED — voluntary demographic self-identification held
// apart from the hiring record (053_eeo_selfid.sql).
//
// NO AUTH. The survey token IS the credential, same class as unsubscribe and
// soft-pull approval. GET never writes. POST calls submit_eeo_response in Postgres,
// which destroys the application link in the same transaction as the insert.

import { db } from "../../src/db.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  parseEeoBody,
  getSurveyStatus,
  submitEeoResponse
} from "../../src/hiring/eeo-selfid.mjs";

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return null; }
  }
  if (typeof req.rawBody === "string") {
    try { return JSON.parse(req.rawBody || "{}"); } catch { return null; }
  }
  return null;
}

function tokenFrom(req) {
  const q = req.query || {};
  const body = readBody(req) || {};
  return String(q.token || body.token || "").trim();
}

const RECEIVED = { ok: true, received: true };

export default async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  res.setHeader("Cache-Control", "no-store");

  if (method === "GET") {
    try {
      const status = await getSurveyStatus(db, tokenFrom(req));
      if (!status.ok) {
        return res.status(400).json({ ok: false, error: status.error });
      }
      return res.status(200).json(status);
    } catch (err) {
      return res.status(500).json({ ok: false, error: safeError(err) });
    }
  }

  const parsed = parseEeoBody(readBody(req));
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error, field: parsed.field || null });
  }

  try {
    const result = await submitEeoResponse(db, parsed);
    if (!result.ok && result.error === "submit_failed") {
      return res.status(400).json({ ok: false, error: "invalid_token" });
    }
    /* Same reply whether first submit or duplicate — no token oracle. */
    return res.status(200).json(RECEIVED);
  } catch (err) {
    if (String(err.message || "").includes("unknown survey token")) {
      return res.status(400).json({ ok: false, error: "invalid_token" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
