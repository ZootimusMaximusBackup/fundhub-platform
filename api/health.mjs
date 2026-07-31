// GET /api/health — the state of this deployment, as a JSON body.
//
// Thin mount over src/http/health.mjs, which carries the classification, the
// migration comparison, and the reasoning for why the DEFAULT answer must never
// be a 5xx. Read that file first.
//
// TWO CALLERS, TWO CONTRACTS.
//
//   GET /api/health            → always 200. public/app/shell.js:283 and
//                                public/crm.html:338 fetch exactly this, and
//                                both read any non-200 as "NO API — /api/* is
//                                not deployed". Changing this default would
//                                relabel a database outage as a missing deploy
//                                on every screen in the CRM.
//
//   GET /api/health?strict=1   → 200 when ok, 503 when not, and the body gains
//                                `missingMigrations` — the pending migrations by
//                                name. This is the URL to point an uptime
//                                monitor at (M19a). Without it there was no way
//                                for any machine to notice the database had
//                                stopped answering: the repo has no error
//                                reporting, no metrics and no CI, so /api/health
//                                is the only signal that exists, and it was
//                                pinned at 200 forever.
//
// docs/RUNBOOK.md is the human half of this: what each state means and what to
// do about it.

import { db } from "../src/db.mjs";
import { healthState, httpStatus, wantsStrict } from "../src/http/health.mjs";

/* queryOf — the parsed query string, whichever host mounted this handler.
   The Netlify adapter always supplies req.query (netlify/functions/api.mjs:210)
   and so does Vercel, but this endpoint is the one an operator is most likely to
   curl through some other harness while the site is already broken, and a health
   check that silently ignores its own flag because req.query was absent is the
   same class of defect as one that always answers up. Falling back to the raw
   URL costs one line and removes the assumption. */
function queryOf(req) {
  if (req && req.query && typeof req.query === "object") return req.query;
  try {
    return Object.fromEntries(new URL(String(req && req.url), "http://localhost").searchParams);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  const query = queryOf(req);
  const strict = wantsStrict(query);
  const body = await healthState(db, undefined, undefined, strict);
  // Never cached: a health answer one minute stale is worse than none.
  res.setHeader("Cache-Control", "no-store");
  return res.status(httpStatus(body, query)).json(body);
}
