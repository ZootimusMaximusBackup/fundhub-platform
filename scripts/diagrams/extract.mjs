// Extraction layer for docs/diagrams — reads the CODE, never a spec document.
//
// Every fact a diagram states has exactly one source in this repo:
//
//   canonical events  src/events/canonical.mjs      (imported, not parsed)
//   workflow triggers src/workflows/index.mjs       (imported — real Inngest opts)
//   pipelines/stages  db/seed/002_pipelines.sql     (parsed)
//   adapter surface   src/adapters/*.mjs            (parsed)
//   bus handlers      src/handlers/*.mjs            (parsed)
//
// Where the fact is available as a JS value it is IMPORTED rather than
// regex-matched, so a rename shows up as a changed diagram instead of a silently
// empty section. src/db.mjs builds its pool lazily, so importing the workflow
// index has no side effects and needs no DATABASE_URL.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../..");

const read = (p) => fs.readFileSync(path.resolve(REPO, p), "utf8");
const listMjs = (dir) =>
  fs.readdirSync(path.resolve(REPO, dir))
    .filter((f) => f.endsWith(".mjs") && !f.includes(".test."))
    .sort();

/** Canonical event names, in spec order. */
export async function extractCanonicalEvents() {
  const { CANONICAL_EVENTS } = await import(path.resolve(REPO, "src/events/canonical.mjs"));
  return [...CANONICAL_EVENTS];
}

/**
 * The groups CANONICAL_EVENTS is already divided into — journey spine, side
 * events, commission + billing. The array is flat, so the grouping is read from
 * the section comments that structure it. Any event not under a section comment
 * falls into "other" rather than being dropped.
 */
export function extractCanonicalGroups(src = read("src/events/canonical.mjs")) {
  const groups = [];
  let current = null;
  for (const line of src.split(/\r?\n/)) {
    // Section labels are the INDENTED comments inside the array literal; the
    // file-header comments start at column 0 and are not group headings.
    const heading = line.match(/^ {2,}\/\/\s*(.+?)\s*$/);
    const entry = line.match(/^\s*"([a-z.]+)",?/);
    if (heading && !entry) {
      // Drop a trailing parenthetical aside — "commission + billing (proposed
      // in ...)" is the group "commission + billing".
      current = { title: heading[1].replace(/\s*\(.*\)\s*$/, ""), events: [] };
      groups.push(current);
    } else if (entry) {
      if (!current) { current = { title: "other", events: [] }; groups.push(current); }
      current.events.push(entry[1]);
    }
  }
  return groups.filter((g) => g.events.length > 0);
}

/**
 * Registered Inngest functions and the events that trigger them.
 * Read off the real function objects, so this cannot drift from what boots.
 */
export async function extractWorkflows() {
  const { functions } = await import(path.resolve(REPO, "src/workflows/index.mjs"));
  return functions
    .map((f) => ({
      id: f.opts.id,
      name: f.opts.name || f.opts.id,
      events: (f.opts.triggers || []).map((t) => t.event).filter(Boolean),
      crons: (f.opts.triggers || []).map((t) => t.cron).filter(Boolean)
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The rails and their stages, from the seed that defines them.
 * Stage order is the seeded sort_order, not the order they happen to appear.
 */
export function extractPipelines(sql = read("db/seed/002_pipelines.sql")) {
  const pipelinesBlock = sql.slice(sql.indexOf("INSERT INTO pipelines"), sql.indexOf("-- Stages per pipeline"));
  const stagesBlock = sql.slice(sql.indexOf("INSERT INTO pipeline_stages"));

  const pipelines = [];
  for (const m of pipelinesBlock.matchAll(/\('([a-z_]+)',\s*'([^']+)'\)/g)) {
    pipelines.push({ key: m[1], name: m[2], stages: [] });
  }

  const byKey = new Map(pipelines.map((p) => [p.key, p]));
  for (const m of stagesBlock.matchAll(/\('([a-z_]+)','([a-z_]+)','([^']+)',(\d+)\)/g)) {
    const [, pkey, key, name, ord] = m;
    byKey.get(pkey)?.stages.push({ key, name, sort: Number(ord) });
  }
  for (const p of pipelines) p.stages.sort((a, b) => a.sort - b.sort);

  return pipelines;
}

/**
 * Card moves the platform performs itself: which workflow drives which rail into
 * which stage. Read from the moveCardToStage call sites.
 *
 * A rail with no entries here is one nothing in this repo moves — for Alt-Fin that
 * is the documented rule (Spec §5: those cards move ONLY from Lendflow webhooks),
 * so the absence is itself worth drawing.
 */
export function extractStageMoves(dir = "src/workflows") {
  const moves = [];
  for (const file of listMjs(dir)) {
    const src = read(path.join(dir, file));
    for (const m of src.matchAll(/pipelineKey:\s*"([a-z_]+)"\s*,\s*stageKey:\s*"([a-z_]+)"/g)) {
      moves.push({ workflow: file.replace(/\.mjs$/, ""), pipeline: m[1], stage: m[2] });
    }
  }
  return moves;
}

/**
 * The adapter boundary: what each adapter accepts, how it authenticates, and which
 * canonical events it is capable of emitting.
 *
 * `unverified` reflects the ⚠️ CONFIRM banners the adapter authors left in place —
 * a boundary map that hides which edges have never been proven against a real
 * payload would be worse than no map.
 */
export function extractAdapters(canonicalEvents, dir = "src/adapters") {
  return listMjs(dir).map((file) => {
    const src = read(path.join(dir, file));
    const name = file.replace(/\.mjs$/, "");

    const events = canonicalEvents.filter((e) =>
      new RegExp(`"${e.replace(/\./g, "\\.")}"`).test(src));

    /* A verifier counts whether this file DEFINES it or IMPORTS it.

       Only the `export function` half existed, so an adapter that reuses another
       adapter's verifier — twilio-status.mjs imports twilio.mjs's, because the
       inbound and delivery webhooks are signed identically and two copies of one
       signature check is two places for one of them to rot — was drawn as
       "no signature / direct call". That is the single most misleading thing
       this diagram can say: it is read to answer "which adapters fail closed",
       and it was answering "no" for one that does. */
    const verifiers = [
      ...[...src.matchAll(/export function (verify\w*Signature)/g)].map((m) => m[1]),
      ...[...src.matchAll(/import\s*\{[^}]*?\b(verify\w*Signature)\b[^}]*?\}\s*from/g)].map((m) => m[1])
    ];
    const scheme =
      /HMAC-SHA256/.test(src) ? "HMAC-SHA256" :
      /HMAC-SHA1/.test(src) ? "HMAC-SHA1" : null;

    // Each adapter's first line names the system it fronts — "// Bland AI
    // voice-call adapter — inquiry-removal bureau calls." Take the part before the
    // em dash so the boundary map can label the outside world with the vendor
    // rather than repeating our own module name back at the reader.
    const first = src.split(/\r?\n/)[0] || "";
    const title = first.replace(/^\/\/\s*/, "").split(" — ")[0].replace(/\s+adapter$/i, "").trim() || name;

    return {
      name,
      title,
      file: `${dir}/${file}`,
      inbound: verifiers.length > 0,
      verifiers,
      scheme: verifiers.length ? scheme : null,
      outbound: /export async function submit\w+|fetch\(/.test(src),
      events,
      unverified: /⚠️[^\n]*CONFIRM|⚠️ CONFIRM/.test(src)
    };
  });
}

/** Synchronous bus handlers registered via on("event", fn). */
export function extractBusHandlers(dir = "src/handlers") {
  const handlers = [];
  for (const file of listMjs(dir)) {
    const src = read(path.join(dir, file));
    for (const m of src.matchAll(/\bon\("([a-z.]+)",\s*(\w+)\)/g)) {
      handlers.push({ module: file.replace(/\.mjs$/, ""), event: m[1], fn: m[2] });
    }
  }
  return handlers;
}

/** Everything the renderers need, gathered once. */
export async function extractAll() {
  const canonicalEvents = await extractCanonicalEvents();
  return {
    canonicalEvents,
    canonicalGroups: extractCanonicalGroups(),
    workflows: await extractWorkflows(),
    pipelines: extractPipelines(),
    stageMoves: extractStageMoves(),
    adapters: extractAdapters(canonicalEvents),
    busHandlers: extractBusHandlers()
  };
}
