// Health check — verifies the DB is reachable + reports migration count.
import { db } from "../src/db.mjs";

export default async function handler(req, res) {
  try {
    const r = await db.query("SELECT count(*)::int AS n FROM schema_migrations");
    res.status(200).json({ ok: true, db: "up", migrations: r.rows[0].n });
  } catch (err) {
    res.status(503).json({ ok: false, db: "down", error: err.message });
  }
}
