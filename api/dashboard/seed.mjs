// POST /api/dashboard/seed  — dev tool (Chris's ask): inject a SAMPLE client through
// the real event bus so the dashboard fills in without pulling live CRS. Each call
// creates one fresh sample client (timestamped email) driven lead → booked → paid →
// analysis → decision → sale. Gated by the same DASHBOARD_SECRET. Writes real rows,
// so it's a staging/demo convenience — not for production data.

import { db } from "../../src/db.mjs";
import { emit } from "../../src/events/bus.mjs";
import { ensureRegistered } from "../../src/register-all.mjs";
import { requireDashboardAccess } from "../../src/http/dashboard-auth.mjs";
import { hasRole } from "../../src/http/middleware/requireRole.mjs";

const TIERS = ["FULL_FUNDING", "PREMIUM_STACK", "FUNDING_PLUS_REPAIR", "REPAIR_ONLY"];
const NAMES = ["Jordan Sample", "Rosa Kim", "Marcus Vale", "Dana Cruz", "Eli Booker"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  // This endpoint writes real rows, so it is the one dashboard route that also
  // carries a role gate. Staff session first; the DASHBOARD_SECRET gate stays as
  // the fallback until cutover. A session that is NOT admin/owner is rejected
  // rather than quietly falling through to the shared secret.
  const who = await requireDashboardAccess(req, res, { db });
  if (!who) return;
  // A real session must ALSO be admin. `true` means the shared-secret caller,
  // which is already an operator credential.
  if (who !== true && !hasRole(who, ["admin"])) {
    return res.status(403).json({ ok: false, error: "forbidden", required: ["admin"] });
  }
  ensureRegistered();

  const stamp = Date.now();
  const email = `sample+${stamp}@fundhub.demo`;
  const name = NAMES[stamp % NAMES.length];
  const tier = TIERS[stamp % TIERS.length];
  const est = [150000, 275000, 90000, 0][stamp % 4];
  const k = (s) => ({ idempotencyKey: `seed:${stamp}:${s}` });
  const P = (extra) => ({ email, ...extra });

  try {
    await emit(db, "entry.captured", P({ name, phone: `+1555${String(stamp).slice(-7)}`, source: "clickfunnels" }), k("entry"));
    await emit(db, "survey.submitted", P({ answers: { cf_svy_why: "grow the business", clarity: "high" } }), k("survey"));
    await emit(db, "booking.created", P({ name, bookingUid: `seed_bk_${stamp}`, startTime: new Date(stamp + 864e5).toISOString(), source: "calcom" }), k("booking"));
    await emit(db, "payment.received", P({ productName: "Business Financial Assessment", amount: 32, providerRef: `seed_t32_${stamp}`, source: "commas" }), k("pay32"));
    await emit(db, "diagnostic.paid", P({}), k("diag"));
    await emit(db, "analysis.completed", P({ outcomeTier: tier, scores: { ex: 700, eq: 705, tu: 712 }, utilization: 14 }), k("analysis"));
    await emit(db, "decision.rendered", P({ outcomeTier: tier, fundingEstimate: est }), k("decision"));
    if (tier !== "REPAIR_ONLY") {
      await emit(db, "payment.received", P({ productName: "Consulting Services Deposit", amount: 3000, providerRef: `seed_tdep_${stamp}`, source: "commas" }), k("paydep"));
      await emit(db, "deposit.paid", P({}), k("deposit"));
      await emit(db, "sale.closed", P({}), k("sale"));
    }
    const row = (await db.query(`SELECT id, email, outcome_tier FROM clients WHERE email = $1`, [email])).rows[0];
    return res.status(200).json({ ok: true, seeded: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
