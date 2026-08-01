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
 * counting those as wired would report a wireframe as a working screen. */
export function gatherScreens(dir = APP_DIR) {
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));
  } catch {
    return out;
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

async function rows(db, sql, params = []) {
  try {
    const r = await db.query(sql, params);
    return r?.rows || [];
  } catch {
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
  const [pipelines, stages, agents, templates, clientColumns] = await Promise.all([
    rows(db, `SELECT key, name FROM pipelines WHERE org_id = $1`, [orgId]),
    rows(
      db,
      `SELECT p.name AS pipeline, s.name AS stage, s.key AS stage_key
         FROM stages s JOIN pipelines p ON p.id = s.pipeline_id
        WHERE p.org_id = $1`,
      [orgId]
    ),
    rows(db, `SELECT code, name, status, prompt FROM agents WHERE org_id = $1`, [orgId]),
    rows(db, `SELECT template_key, channel, compliance_passed FROM message_templates WHERE org_id = $1`, [orgId]),
    rows(
      db,
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'clients'`,
      []
    )
  ]);

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
