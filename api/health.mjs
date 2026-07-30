// GET /api/health — always 200, with a JSON body that names the state.
//
// Thin mount over src/http/health.mjs, which carries the classification and the
// reasoning for why this must never answer 5xx. Read that file first.

import { db } from "../src/db.mjs";
import { healthState } from "../src/http/health.mjs";

export default async function handler(req, res) {
  const body = await healthState(db);
  // Never cached: a health answer one minute stale is worse than none.
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(body);
}
