/* Intent versus code.
 *
 * For each node in the editor's tree, ask whether the code does that thing.
 * Every mismatch is a row. THE RUNNER NEVER REPAIRS A MISMATCH — same posture
 * as src/underwrite/adapter.mjs, where absence is the finding, not a gap to
 * fill. Nothing here writes, edits a journey, or "reconciles" anything.
 *
 * Three verdicts, and the third is not a softer version of the second:
 *
 *   ok         — the code does what the node says
 *   mismatch   — the code demonstrably does not
 *   unverified — the check could not be made. A table that would not read, a
 *                screen label with no confident match, a journey with no
 *                canonical start event. Reported as its own state because
 *                "could not check" collapsed into "fine" is the exact false
 *                green this whole harness exists to prevent.
 *
 * Rule touches are reported and never asserted on. They are human notes in
 * free text; a runner that tried to enforce prose would produce noise, and
 * noise is what stops findings being read.
 */

const WAIT_UNIT_MS = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000
};

const finding = (verdict, category, node, journeyKey, summary, detail = {}) => ({
  verdict,
  category,
  journey: journeyKey,
  nodeId: node?.id ?? null,
  nodeType: node?.type ?? null,
  nodeTitle: node?.title ?? null,
  summary,
  ...detail
});

/* Editor role labels are display names ("Funding Advisor"); the code uses
   snake_case keys ("funding_advisor"). Fold both sides the same way rather
   than carrying a translation table that could itself go stale. */
const roleKey = (label) => String(label || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s) => new Set(norm(s).split(" ").filter((t) => t.length > 2));

// ── node checks ───────────────────────────────────────────────────────────

function checkAssign(node, facts, journeyKey) {
  const label = node.cfg?.role;
  if (!label) return finding("unverified", "assign", node, journeyKey, "node assigns to no role");

  const key = roleKey(label);
  // Client, Affiliate and Partner are principal types, not staff roles — a
  // journey step assigning to one of them is a different thing from assigning
  // to an employee, and checking it against ROLE_SETS.STAFF would be wrong.
  if (["client", "affiliate", "partner"].includes(key)) {
    return finding("ok", "assign", node, journeyKey, `assigns to the ${label} principal, not a staff role`, { role: key });
  }
  if (facts.roles.staff.includes(key)) {
    return finding("ok", "assign", node, journeyKey, `role ${key} exists in ROLE_SETS.STAFF`, { role: key });
  }
  return finding(
    "mismatch",
    "assign",
    node,
    journeyKey,
    `the editor offers "${label}" but the code has no such role — work assigned here is assigned to nobody`,
    { role: key, staffRoles: facts.roles.staff }
  );
}

function checkStage(node, facts, journeyKey) {
  const { stage, pipeline } = node.cfg || {};
  if (facts.stages === null || facts.pipelines === null) {
    return finding("unverified", "stage", node, journeyKey, "pipelines/stages could not be read from the database", { stage, pipeline });
  }
  const pipeOk = facts.pipelines.some((p) => norm(p.name) === norm(pipeline));
  if (!pipeOk) {
    return finding("mismatch", "stage", node, journeyKey, `pipeline "${pipeline}" does not exist`, { stage, pipeline });
  }
  const inPipe = facts.stages.filter((s) => norm(s.pipeline) === norm(pipeline));
  if (inPipe.some((s) => norm(s.stage) === norm(stage))) {
    return finding("ok", "stage", node, journeyKey, `stage "${stage}" exists in "${pipeline}"`, { stage, pipeline });
  }
  const elsewhere = facts.stages.find((s) => norm(s.stage) === norm(stage));
  return finding(
    "mismatch",
    "stage",
    node,
    journeyKey,
    elsewhere
      ? `stage "${stage}" exists, but in "${elsewhere.pipeline}", not "${pipeline}" — the card would have nowhere to land`
      : `stage "${stage}" does not exist in any pipeline`,
    { stage, pipeline, foundIn: elsewhere?.pipeline ?? null }
  );
}

function checkAgent(node, facts, journeyKey) {
  const name = node.cfg?.agent;
  if (facts.agents === null) {
    return finding("unverified", "agent", node, journeyKey, "the agents registry could not be read", { agent: name });
  }
  const row = facts.agents.find((a) => norm(a.name) === norm(name));
  if (!row) {
    return finding("mismatch", "agent", node, journeyKey, `the editor offers agent "${name}" and no such agent is registered`, { agent: name });
  }
  if (row.status !== "live") {
    return finding("mismatch", "agent", node, journeyKey, `agent "${name}" is registered but its status is ${row.status}, not live`, { agent: name, status: row.status });
  }
  if (!row.prompt) {
    // Live with no prompt is a real, deliberate state in this build — worth a
    // row, but not a failure of the journey.
    return finding("ok", "agent", node, journeyKey, `agent "${name}" is live, and ships with no prompt`, { agent: name, status: row.status, promptMissing: true });
  }
  return finding("ok", "agent", node, journeyKey, `agent "${name}" is live`, { agent: name, status: row.status });
}

function checkPayment(node, facts, journeyKey) {
  const product = node.cfg?.product;
  if (!product) return finding("unverified", "payment", node, journeyKey, "payment node names no product");
  // Routing is on NAME only, never amount — src/adapters/commas.mjs states it
  // and productOf() reads only evt.name. So the amount on the node is not
  // checked here, on purpose.
  const hit = facts.products.find((p) => norm(product).includes(norm(p.nameIncludes)));
  if (hit) {
    return finding("ok", "payment", node, journeyKey, `"${product}" routes to the ${hit.bucket} bucket`, { product, bucket: hit.bucket });
  }
  return finding(
    "mismatch",
    "payment",
    node,
    journeyKey,
    `"${product}" matches no Commas product route — a payment for it would land as unmatched`,
    { product, known: facts.products.map((p) => p.nameIncludes) }
  );
}

function checkCondition(node, facts, journeyKey) {
  const field = node.cfg?.field;
  if (!field) return finding("unverified", "condition", node, journeyKey, "condition names no field");
  if (facts.clientColumns === null) {
    return finding("unverified", "condition", node, journeyKey, "the clients table shape could not be read", { field });
  }
  if (facts.clientColumns.includes(field)) {
    return finding("ok", "condition", node, journeyKey, `"${field}" is a column on clients`, { field });
  }
  // custom_fields is jsonb and holds the ported GHL fields. Anything can be
  // written to it, so its presence cannot be proven from the schema — only
  // that this field is not a typed column. Whether anything WRITES it is the
  // real question and it is answered by the run, not the schema.
  const written = facts.customFieldsWritten?.includes(field);
  if (written) {
    return finding("ok", "condition", node, journeyKey, `"${field}" is written into custom_fields by the code`, { field });
  }
  return finding(
    "mismatch",
    "condition",
    node,
    journeyKey,
    `nothing in the code writes "${field}" — this branch can never be taken`,
    { field }
  );
}

function checkWait(node, facts, journeyKey, runIndex) {
  const { amount, unit } = node.cfg || {};
  const unitMs = WAIT_UNIT_MS[unit];
  if (!unitMs) {
    return finding("unverified", "wait", node, journeyKey, `wait unit "${unit}" is not one of minutes/hours/days`, { amount, unit });
  }
  const declared = Number(amount) * unitMs;
  if (!Number.isFinite(declared)) {
    return finding("unverified", "wait", node, journeyKey, `wait amount "${amount}" is not a number`, { amount, unit });
  }
  const observed = runIndex?.sleepsByJourney?.get(journeyKey) ?? null;
  if (observed === null) {
    return finding("unverified", "wait", node, journeyKey, "no walk data for this journey, so no workflow sleep to compare against", { declaredMs: declared });
  }
  if (observed === 0 && declared > 0) {
    return finding(
      "mismatch",
      "wait",
      node,
      journeyKey,
      `the journey declares a ${amount} ${unit} wait and no workflow on this path sleeps at all`,
      { declaredMs: declared, observedMs: observed }
    );
  }
  return finding("ok", "wait", node, journeyKey, `declared ${amount} ${unit}; workflows on this journey slept ${Math.round(observed / 3600000)}h in total`, {
    declaredMs: declared,
    observedMs: observed
  });
}

function checkMessage(node, facts, journeyKey, runIndex) {
  // A journey's sms/email node does not name a template — the code chooses the
  // template key. So the check is: did anything actually get written on a path
  // through this journey? A journey full of message steps that produces no
  // messages row is the finding.
  const sent = runIndex?.messagesByJourney?.get(journeyKey) ?? null;
  if (sent === null) {
    return finding("unverified", node.type, node, journeyKey, "no walk data for this journey");
  }
  if (sent === 0) {
    return finding(
      "mismatch",
      node.type,
      node,
      journeyKey,
      `the journey sends a ${node.type} here and no message row was written on any path through it`,
      { messagesOnJourney: 0 }
    );
  }
  return finding("ok", node.type, node, journeyKey, `${sent} message(s) written on paths through this journey`, { messagesOnJourney: sent });
}

function checkHandoff(node, facts, journeyKey) {
  const label = node.cfg?.role;
  const stage = node.cfg?.stage;
  const key = roleKey(label);

  // Does a journey exist for the receiving role? Journey keys are role-ish
  // ("closer", "advisor"), and the editor's labels are display names.
  const ALIAS = { funding_advisor: "advisor", inquiry_specialist: "inquiry", white_label_partner: "partner" };
  const target = ALIAS[key] || key;
  const exists = facts.journeyKeys.includes(target);
  if (!exists) {
    return finding("mismatch", "handoff", node, journeyKey, `hands off to "${label}" and no journey by that name exists`, { role: key, stage });
  }
  const receiving = facts.journeys[target];
  // Does the receiving journey start where the handoff lands? The handoff
  // names a stage; the journey names a start_when in prose. There is no
  // machine-readable link between them, so this is reported rather than judged.
  return finding(
    "unverified",
    "handoff",
    node,
    journeyKey,
    `hands to the ${target} journey at stage "${stage}"; that journey starts "${receiving.start}" — the two are prose and cannot be matched automatically`,
    { role: key, stage, targetJourney: target, targetStart: receiving.start }
  );
}

// ── touches ───────────────────────────────────────────────────────────────

/* Screen labels are human names ("Sales board", "Pre-call panel"), not
   filenames, and no mapping between the two exists anywhere in the repo. So
   this scores token overlap against each screen's filename and <title> and
   requires a clear win. NO CONFIDENT MATCH IS REPORTED AS UNRESOLVED, never
   guessed — a wrong match would claim a journey touches a screen it does not,
   which is worse than admitting the label cannot be resolved. */
export function matchScreen(label, screens) {
  const want = tokens(label);
  if (want.size === 0) return null;
  let best = null;
  for (const s of screens) {
    const have = new Set([...tokens(s.file.replace(/\.html$/, "")), ...tokens(s.title)]);
    let hits = 0;
    for (const t of want) if (have.has(t)) hits++;
    const score = hits / want.size;
    if (score > 0 && (!best || score > best.score)) best = { screen: s, score };
  }
  return best && best.score >= 0.5 ? best : null;
}

function checkTouch(category, label, node, facts, journeyKey) {
  if (category === "Rule") {
    // Report only, never assert. See the header.
    return finding("note", "touch:Rule", node, journeyKey, label, { label });
  }

  if (category === "Screen") {
    const hit = matchScreen(label, facts.screens);
    if (!hit) {
      return finding("mismatch", "touch:Screen", node, journeyKey, `no screen in public/app/ resolves to "${label}"`, { label });
    }
    const s = hit.screen;
    if (!s.wired) {
      return finding("mismatch", "touch:Screen", node, journeyKey, `"${label}" resolves to ${s.file}, which is a wireframe — it calls no data`, { label, file: s.file, wired: false, evidence: s.evidence });
    }
    return finding("ok", "touch:Screen", node, journeyKey, `"${label}" resolves to ${s.file}, wired via ${s.evidence}`, { label, file: s.file, wired: true });
  }

  if (category === "Template") {
    if (facts.templates === null) {
      return finding("unverified", "touch:Template", node, journeyKey, `message_templates could not be read, so "${label}" cannot be checked`, { label });
    }
    // Touch labels are short codes ("S-01", "F-03"); template keys are long
    // ("SMS-F03-ROUND-SUBMITTED"). Match on the code appearing in the key.
    const needle = norm(label).replace(/\s+/g, "");
    const hit = facts.templates.find((t) => norm(t.template_key).replace(/\s+/g, "").includes(needle));
    if (!hit) {
      return finding("mismatch", "touch:Template", node, journeyKey, `no template matching "${label}" exists — sendTemplated would be a silent no-op here`, { label });
    }
    if (!hit.compliance_passed) {
      return finding("mismatch", "touch:Template", node, journeyKey, `template ${hit.template_key} exists but has not passed compliance, so it will never render`, { label, templateKey: hit.template_key });
    }
    return finding("ok", "touch:Template", node, journeyKey, `template ${hit.template_key} exists and is compliance-passed`, { label, templateKey: hit.template_key });
  }

  if (category === "Agent") {
    if (facts.agents === null) {
      return finding("unverified", "touch:Agent", node, journeyKey, `the agents registry could not be read`, { label });
    }
    const hit = facts.agents.find((a) => tokens(label).size && [...tokens(a.name)].some((t) => tokens(label).has(t)));
    if (!hit) {
      return finding("mismatch", "touch:Agent", node, journeyKey, `no registered agent resolves to "${label}"`, { label });
    }
    if (hit.status !== "live") {
      return finding("mismatch", "touch:Agent", node, journeyKey, `"${label}" resolves to ${hit.name}, status ${hit.status}, not live`, { label, agent: hit.name, status: hit.status });
    }
    return finding("ok", "touch:Agent", node, journeyKey, `"${label}" resolves to ${hit.name}, live${hit.prompt ? "" : ", shipping with no prompt"}`, { label, agent: hit.name, promptMissing: !hit.prompt });
  }

  if (category === "Journey") {
    const hit = facts.journeyKeys.find((k) => [...tokens(label)].includes(k) || tokens(label).has(k));
    if (!hit) {
      return finding("unverified", "touch:Journey", node, journeyKey, `"${label}" does not name one of the six journeys directly`, { label, journeys: facts.journeyKeys });
    }
    return finding("ok", "touch:Journey", node, journeyKey, `"${label}" resolves to the ${hit} journey`, { label, journey: hit });
  }

  if (category === "Rail") {
    const names = Object.keys(facts.rails);
    const hit = names.find((n) => norm(label).includes(n));
    if (!hit) {
      return finding("mismatch", "touch:Rail", node, journeyKey, `no configured adapter resolves to "${label}"`, { label, known: names });
    }
    const rail = facts.rails[hit];
    if (!rail.adapter) {
      return finding("mismatch", "touch:Rail", node, journeyKey, `"${label}" names ${hit}, which has no adapter`, { label, rail: hit });
    }
    if (!rail.secretSet) {
      return finding("mismatch", "touch:Rail", node, journeyKey, `"${label}" resolves to the ${hit} adapter, but ${rail.secretEnv} is not set — it fails closed`, { label, rail: hit, secretEnv: rail.secretEnv });
    }
    return finding("ok", "touch:Rail", node, journeyKey, `"${label}" resolves to the ${hit} adapter, configured`, { label, rail: hit });
  }

  return finding("unverified", `touch:${category}`, node, journeyKey, `unknown touch category "${category}"`, { label });
}

// ── the walk index ────────────────────────────────────────────────────────

/* Folds a run report into the per-journey aggregates the node checks need. */
export function indexRun(report) {
  const messagesByJourney = new Map();
  const sleepsByJourney = new Map();
  if (!report?.paths) return { messagesByJourney, sleepsByJourney };

  for (const p of report.paths) {
    const key = String(p.pathId).split("#")[0];
    messagesByJourney.set(key, (messagesByJourney.get(key) || 0) + (p.messages?.length || 0));
    const slept = (p.stepRecord || [])
      .filter((e) => e.kind === "sleep" || e.kind === "sleepUntil")
      .reduce((sum, e) => sum + (e.ms || 0), 0);
    sleepsByJourney.set(key, Math.max(sleepsByJourney.get(key) || 0, slept));
  }
  return { messagesByJourney, sleepsByJourney };
}

// ── the diff ──────────────────────────────────────────────────────────────

const NODE_CHECK = {
  assign: checkAssign,
  stage: checkStage,
  agent: checkAgent,
  payment: checkPayment,
  condition: checkCondition,
  wait: checkWait,
  handoff: checkHandoff,
  sms: checkMessage,
  email: checkMessage
};

/* diff(journeys, facts, report) → { findings, screenCoverage, counts }
 *
 * Pure. Everything it reads comes from its arguments, which is what lets the
 * Sales Manager canary be tested against a fixture that stays honest after the
 * role is built. */
export function diff(journeys, facts, report = null) {
  const runIndex = indexRun(report);
  const findings = [];
  const touchedScreens = new Set();

  const walk = (nodes, journeyKey) => {
    for (const node of nodes) {
      const check = NODE_CHECK[node.type];
      if (check) findings.push(check(node, facts, journeyKey, runIndex));

      for (const [category, label] of node.touches || []) {
        const f = checkTouch(category, label, node, facts, journeyKey);
        findings.push(f);
        if (category === "Screen" && f.file) touchedScreens.add(f.file);
      }

      for (const branch of node.branches || []) walk(branch.nodes, journeyKey);
    }
  };

  for (const [key, journey] of Object.entries(journeys)) walk(journey.nodes || [], key);

  /* Every screen in public/app/ classified. A screen no journey touches is
     either dead or an unwritten journey — both findings, neither repaired. */
  const screenCoverage = facts.screens.map((s) => ({
    file: s.file,
    title: s.title,
    wired: s.wired,
    evidence: s.evidence,
    touched: touchedScreens.has(s.file),
    classification: !touchedScreens.has(s.file)
      ? "touched by no journey"
      : s.wired
        ? "touched and wired"
        : "touched and wireframe"
  }));

  const counts = findings.reduce((acc, f) => {
    acc[f.verdict] = (acc[f.verdict] || 0) + 1;
    return acc;
  }, {});

  return { findings, screenCoverage, counts };
}

export default diff;
