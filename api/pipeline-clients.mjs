// POST /api/pipeline-clients — staff New Client on the Pipeline board.
//
//   { name, email, phone, product }
//
// Uses the same door the funnel uses: resolveClient + entry.captured.
// Does not write a clients row itself.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireActiveShift } from "../src/http/middleware/requireActiveShift.mjs";
import { SUPER_ROLES } from "../src/http/middleware/requireRole.mjs";
import { requireRole, ROLE_SETS } from "../src/http/read-api.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { safeError } from "../src/http/health.mjs";
import { emit } from "../src/events/bus.mjs";
import { ensureRegistered } from "../src/register-all.mjs";
import { resolveClient } from "../src/handlers/client-lifecycle.mjs";
import { OFFERS } from "../src/config/offers.mjs";

const PRODUCT_CODES = new Set(Object.values(OFFERS).map((o) => o.productCode));

function clean(v, max) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function parsePipelineClientBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid_json", message: "That save was not readable." };
  }
  const name = clean(body.name, 120);
  const email = clean(body.email, 160).toLowerCase();
  const phone = clean(body.phone, 40);
  const product = clean(body.product, 80);
  if (!name || !isEmail(email)) {
    return { ok: false, error: "name_email_required", message: "Name and a real email are required." };
  }
  if (!phone) {
    return { ok: false, error: "phone_required", message: "Phone is required." };
  }
  if (!PRODUCT_CODES.has(product)) {
    return { ok: false, error: "product_required", message: "Pick a product from the list." };
  }
  return { ok: true, name, email, phone, product };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const requireAuthFn = deps.requireAuth ?? requireAuth;
  const emitFn = deps.emit ?? emit;
  const resolve = deps.resolveClient ?? resolveClient;
  const ensure = deps.ensureRegistered ?? ensureRegistered;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      error: "method_not_allowed",
      message: "Creating a client is a save request, not a page load."
    });
  }

  const staff = await requireAuthFn(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const shift = await requireActiveShift(req, res, { db: database, exempt: SUPER_ROLES });
  if (!shift) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false,
      error: "org_required",
      message: "Your sign-in is not attached to a company."
    });
  }

  const parsed = parsePipelineClientBody(req.body || {});
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error, message: parsed.message });
  }

  try {
    ensure();
    const payload = {
      email: parsed.email,
      name: parsed.name,
      phone: parsed.phone,
      product: parsed.product,
      source: "pipeline"
    };
    const clientId = await resolve(database, { orgId, payload });
    if (!clientId) {
      return res.status(400).json({
        ok: false,
        error: "client_not_created",
        message: "The client could not be saved."
      });
    }
    await database.query(
      `UPDATE clients SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [clientId, JSON.stringify({ product: parsed.product })]
    );
    await emitFn(database, "entry.captured", payload, {
      orgId,
      clientId,
      idempotencyKey: `pipeline-client:${orgId}:${parsed.email}`
    });
    return res.status(200).json({ ok: true, client_id: clientId });
  } catch (err) {
    if (dbDown(err)) {
      return res.status(503).json({ ok: false, error: "db_down", message: "The database is not reachable right now." });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
