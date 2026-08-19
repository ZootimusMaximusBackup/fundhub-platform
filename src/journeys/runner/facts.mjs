/* What the CODE actually holds — gathered once, so the diff can be pure.
 *
 * Split out from diff.mjs deliberately. Gathering means touching the database,
 * the filesystem and half a dozen modules; comparing is arithmetic over the
 * result. Keeping them apart means the comparison can be tested against
 * fixtures, which matters for one check in particular:
 *
 *   THE SALES MANAGER CANARY. The diff must flag `Sales Manager` as a role the
 *   editor offers and the code does not implement. If the test for that read
 *   the live role list, it would stop catching anything the moment the role
 *   was built — and the role IS being built. So the test pins a fixture, the
 *   check stays honest forever, and this module is what supplies the real
 *   thing at run time.
 *
 * Every field here answers "what does the code do", never "what should it do".
 * Absence is recorded as absence. Nothing is defaulted into existence.
 */

import fs from "node:fs";
import path from "node:path";

import { ROLE_SETS } from "../../http/read-api.mjs";
import { PRODUCT } from "../../adapters/commas.mjs";

const APP_DIR = path.join(process.cwd(), "public/app");

/* Screens on disk, each classified.
 *
 *   wired     — reaches real data (FHData.wire/read/client/write, or its own
 *               fetch of an /api/ path)
 *   wireframe — renders sample markup and calls nothing
 *
 * The classifier looks for a CALL, not a mention: several screens carry /api/
 * paths inside explanatory prose or <code> blocks and call nothing, and
 * counting those as wired would report a wireframe as a working screen.
 *
 * RETURNS null, NEVER [], WHEN THE DIRECTORY CANNOT BE READ. It used to swallow
 * the failure and hand back an empty array, which the diff then reported as
 * "there are genuinely no screens" — every screen a journey touches became a
 * mismatch, and the screen inventory read as a clean zero. Every
 * database-backed field in this module already returns null for exactly this
 * reason (see gather()'s header); the filesystem gets the same treatment. */
export function gatherScreens(dir = APP_DIR) {
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));
  } catch {
    return null; // could not look — the diff reports UNVERIFIED, not "none"
  }
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const title = (/<title>([^<]*)<\/title>/i.exec(src)?.[1] || "").replace(/^Fundhub\s*[—-]\s*/i, "").trim();

    const calls = [];
    if (/FHData\.(wire|read|client|clients|pipeline|write|tasks|taskQueue|documents|commissions|invoices|affiliates|partners|staff|entitlements|failedEvents|inquiries|messageTemplates|fundingRounds|brand)\s*\(/.test(src)) {
      calls.push("FHData");
    }
    // A fetch whose target is an /api/ path — the string and the call in one
    // expression, so a documented path in prose does not qualify.
    if (/fetch\s*\(\s*[`"'][^`"']*\/api\//.test(src)) calls.push("fetch(/api/)");
    // A screen that builds its path in a variable then fetches it.
    if (/fetch\s*\(\s*(path|url|ENDPOINT|spec\.path)\b/.test(src) && /["'`]\/api\//.test(src)) calls.push("fetch(var)");

    out.push({
      file,
      title,
      wired: calls.length > 0,
      evidence: calls.join(", ") || "no data call found"
    });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/* The route table, read from the adapter itself so it cannot drift from what
   actually serves. Imported lazily: netlify/functions/api.mjs pulls in ~100
   handlers and the diff should not pay that cost unless it is asked to. */
export async function gatherRoutes() {
  try {
    const mod = await import("../../../netlify/functions/api.mjs");
    return new Set(Object.keys(mod.ROUTES || {}));
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

/* Rails — a "Rail" touch names a payment or data integration. A rail is
   configured when an adapter is registered in src/http/router.mjs AND its
   secret is set. Both halves matter: an adapter with no secret fails closed
   and is not usable, which is a different finding from an absent adapter. */
export function gatherRails(env = process.env) {
  // Mirrors the STD table in src/http/router.mjs plus the two special-cased
  // adapters. Read from the module would be better; it exports no table.
  const RAILS = {
    commas: "COMMAS_WEBHOOK_SECRET",
    clickfunnels: "CLICKFUNNELS_WEBHOOK_SECRET",
    bland: "BLAND_WEBHOOK_SECRET",
    calcom: "CALCOM_WEBHOOK_SECRET",
    lendflow: "LENDFLOW_WEBHOOK_SECRET",
    twilio: "TWILIO_AUTH_TOKEN",
    mailgun: "MAILGUN_SIGNING_KEY"
  };
  const out = {};
  for (const [name, envKey] of Object.entries(RAILS)) {
    const adapter = fs.existsSync(path.join(process.cwd(), "src/adapters", `${name}.mjs`));
    out[name] = { adapter, secretEnv: envKey, secretSet: Boolean(env[envKey]) };
  }
  return out;
}

/* gather() fires several read queries at once, and when the caller already has
   an open transaction (api/journeys/run.mjs's BEGIN, always the case in
   practice — see the header on gather() below), they all share it. Postgres
   aborts an ENTIRE transaction on the first statement error, so one bad query
   (originally: this file asking for a table named "stages" that has never
   existed — the real name is pipeline_stages) silently failed every query
   issued after it too, not just its own. Two tables that were perfectly
   readable on their own (agents, message_templates) came back as "could not
   read" in the diagnostic report as pure collateral damage.

   Each query now runs inside its own SAVEPOINT, so a failure rolls back only
   that one query's place in the transaction and leaves the rest able to run.
   Outside an explicit transaction — SAVEPOINT with none open errors as
   "25P01" — this just falls through to running the query directly, same as
   before; nothing there was ever poisoned in the first place. */
let savepointCounter = 0;

/* Exported because src/journeys/runner/index.mjs needs the same protection when
   it reads the messages table mid-run: it runs inside the very same open
   transaction, so an unguarded failing read there would abort every statement
   after it — including this module's. One helper, one savepoint discipline. */
export async function queryOrNull(db, sql, params = []) {
  const savepoint = `journey_facts_sp_${savepointCounter++}`;
  let hasSavepoint = false;
  try {
    await db.query(`SAVEPOINT ${savepoint}`);
    hasSavepoint = true;
  } catch {
    // No open transaction (or db does not support savepoints) — a failure
    // below cannot poison anything else, so proceed without one.
  }

  try {
    const r = await db.query(sql, params);
    if (hasSavepoint) await db.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => {});
    return r?.rows || [];
  } catch {
    if (hasSavepoint) {
      try {
        await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await db.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch {
        // Best effort — if this fails too the transaction was already in
        // worse shape than this function can recover from.
      }
    }
    return null; // table absent or unreadable — the caller reports that, not a zero
  }
}

/* gather(db, { orgId, env, journeys }) → facts
 *
 * A null in any database-backed field means "could not read", which the diff
 * reports as UNVERIFIED. It never collapses to an empty list — "no templates
 * exist" and "the templates table could not be read" are different findings
 * and conflating them is how a runner reports confidently about nothing. */
export async function gather(db, { orgId, env = process.env, journeys = {} } = {}) {
  /* SEQUENTIAL, NOT Promise.all. Each rows() call opens and closes its own
     SAVEPOINT (see above) so one bad query can't poison the rest — but
     savepoints nest LIFO, and five of them opened concurrently on one shared
     connection (which is what these all run on, inside gather()'s caller's
     transaction) can interleave in submission order in ways that invalidate a
     sibling's still-open savepoint. None of these five queries is expensive
     enough for the concurrency to matter; running them one at a time keeps
     every savepoint's open/close strictly nested and easy to reason about. */
  const pipelines = await queryOrNull(db, `SELECT key, name FROM pipelines WHERE org_id = $1`, [orgId]);
  const stages = await queryOrNull(
    db,
    `SELECT p.name AS pipeline, s.name AS stage, s.key AS stage_key
       FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
      WHERE p.org_id = $1`,
    [orgId]
  );
  const agents = await queryOrNull(db, `SELECT code, name, status, prompt FROM agents WHERE org_id = $1`, [orgId]);
  const templates = await queryOrNull(db, `SELECT template_key, channel, compliance_passed FROM message_templates WHERE org_id = $1`, [orgId]);
  const clientColumns = await queryOrNull(
    db,
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'clients'`,
    []
  );

  return {
    orgId,
    // Staff roles the code actually implements. ROLE_SETS.STAFF is the set the
    // read API admits; a role absent from it cannot be assigned work.
    roles: {
      staff: [...(ROLE_SETS.STAFF || [])],
      finance: [...(ROLE_SETS.FINANCE || [])]
    },
    pipelines,
    stages,
    agents,
    templates,
    clientColumns: clientColumns ? clientColumns.map((r) => r.column_name) : null,
    products: Object.entries(PRODUCT).map(([bucket, def]) => ({ bucket, nameIncludes: def.nameIncludes })),
    screens: gatherScreens(),
    routes: await gatherRoutes(),
    rails: gatherRails(env),
    journeyKeys: Object.keys(journeys),
    journeys
  };
}

export default gather;
