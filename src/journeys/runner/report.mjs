/* Renders a run into something a person reads.
 *
 * CLAUDE.md §10 governs every string in this file: the owner does not read
 * code, so a finding has to say what is broken in terms of what a person
 * would see, not what the code does. "The card has nowhere to land" beats
 * "stage key not found in pipeline scope".
 *
 * Two outputs from the same data. `summary()` returns the structure the API
 * hands back and the screen renders. `text()` renders it as plain text for a
 * terminal or a paste into a message.
 */

const VERDICT_LABEL = {
  ok: "Working",
  mismatch: "Broken",
  unverified: "Could not check",
  note: "Note"
};

const ms = (n) => {
  if (!n) return "none";
  const d = n / 86400000;
  if (d >= 1) return `${Number(d.toFixed(d < 10 ? 1 : 0))} day${d >= 2 ? "s" : ""}`;
  const h = n / 3600000;
  if (h >= 1) return `${Number(h.toFixed(1))} hour${h >= 2 ? "s" : ""}`;
  return `${Math.round(n / 60000)} min`;
};

/* summary(runReport, diffResult) → the whole picture, machine-readable. */
export function summary(run, diffed) {
  const findings = diffed?.findings || [];
  const byVerdict = (v) => findings.filter((f) => f.verdict === v);

  const messages = run.paths.flatMap((p) => p.messages || []);
  const refused = run.paths.flatMap((p) => (p.dispatched || []).filter((d) => d.status === "refused"));

  return {
    runId: run.runId,
    walked: {
      journeys: run.journeys.length,
      paths: run.paths.length,
      clients: new Set(run.paths.map((p) => p.clientId)).size,
      failedPaths: run.paths.filter((p) => p.terminal === "error").map((p) => ({ pathId: p.pathId, failure: p.failure }))
    },
    workflows: {
      registered: run.workflowCoverage.registered,
      fired: run.workflowCoverage.fired,
      neverFired: run.workflowCoverage.neverFired,
      unrunnable: run.workflowCoverage.unrunnable
    },
    messages: {
      wouldHaveGoneOut: messages.length,
      byChannel: messages.reduce((acc, m) => {
        acc[m.channel || "unknown"] = (acc[m.channel || "unknown"] || 0) + 1;
        return acc;
      }, {}),
      refusedByFence: refused.length
    },
    findings: {
      counts: diffed?.counts || {},
      broken: byVerdict("mismatch"),
      couldNotCheck: byVerdict("unverified"),
      working: byVerdict("ok").length,
      rules: byVerdict("note")
    },
    screens: {
      total: (diffed?.screenCoverage || []).length,
      touchedAndWired: (diffed?.screenCoverage || []).filter((s) => s.classification === "touched and wired"),
      touchedAndWireframe: (diffed?.screenCoverage || []).filter((s) => s.classification === "touched and wireframe"),
      touchedByNoJourney: (diffed?.screenCoverage || []).filter((s) => s.classification === "touched by no journey")
    },
    journeysWithoutStartEvent: run.journeysWithoutStartEvent || []
  };
}

/* The one-line verdict on the whole run.
 *
 * A CLEAN FIRST RUN IS TREATED AS A FAULT, not a pass. Ticket 8: "The report
 * names at least one real mismatch on first run. If it comes back perfectly
 * clean, the diff is not working." */
export function headline(s) {
  const broken = s.findings.broken.length;
  const unchecked = s.findings.couldNotCheck.length;
  if (broken === 0 && unchecked === 0) {
    return "NOTHING WAS FOUND, WHICH IS ITSELF THE PROBLEM. A first run that comes back perfectly clean means the checker is not checking. Do not read this as a pass.";
  }
  const parts = [];
  if (broken) parts.push(`${broken} thing${broken === 1 ? "" : "s"} the code does not do the way the journey says`);
  if (unchecked) parts.push(`${unchecked} it could not check`);
  return `Walked ${s.walked.paths} path${s.walked.paths === 1 ? "" : "s"}. Found ${parts.join(", and ")}.`;
}

function section(title, lines) {
  if (!lines.length) return [];
  return ["", title, "-".repeat(title.length), ...lines];
}

export function text(run, diffed) {
  const s = summary(run, diffed);
  const out = [`JOURNEY RUN — ${s.runId}`, "=".repeat(60), "", headline(s)];

  out.push(
    "",
    "WHAT RAN",
    "--------",
    `Journeys walked:      ${s.walked.journeys}`,
    `Paths walked:         ${s.walked.paths} (one throwaway client each)`,
    `Messages that would`,
    `  have gone out:      ${s.messages.wouldHaveGoneOut}` +
      (s.messages.refusedByFence ? `  (${s.messages.refusedByFence} stopped by the safety fence)` : ""),
    `Workflows that fired: ${s.workflows.fired.length} of ${s.workflows.registered}`
  );

  if (s.walked.failedPaths.length) {
    out.push(
      ...section(
        "PATHS THAT CRASHED",
        s.walked.failedPaths.map((p) => `  ${p.pathId}: ${p.failure}`)
      )
    );
  }

  out.push(
    ...section(
      `BROKEN — the journey says one thing and the code does another (${s.findings.broken.length})`,
      s.findings.broken.map((f) => `  [${f.journey}] ${f.nodeTitle || f.category}\n      ${f.summary}`)
    )
  );

  out.push(
    ...section(
      `COULD NOT CHECK (${s.findings.couldNotCheck.length})`,
      s.findings.couldNotCheck.map((f) => `  [${f.journey}] ${f.nodeTitle || f.category}\n      ${f.summary}`)
    )
  );

  out.push(
    ...section(
      `WORKFLOWS NO JOURNEY REACHES (${s.workflows.neverFired.length})`,
      [
        "  Each one is either code nobody uses, or a journey nobody wrote.",
        "  Both are worth knowing. Neither is fixed here.",
        "",
        ...s.workflows.neverFired.map((w) => `  ${w.id}  (waits for: ${w.triggers.join(", ") || "nothing"})`)
      ]
    )
  );

  out.push(
    ...section(
      "SCREENS",
      [
        `  Touched by a journey and wired to real data:  ${s.screens.touchedAndWired.length}`,
        `  Touched by a journey but still a mock-up:     ${s.screens.touchedAndWireframe.length}`,
        `  Touched by no journey at all:                 ${s.screens.touchedByNoJourney.length}`,
        "",
        ...s.screens.touchedAndWireframe.map((x) => `  mock-up, but a journey needs it: ${x.file}`),
        ...s.screens.touchedByNoJourney.map((x) => `  no journey touches: ${x.file}`)
      ]
    )
  );

  if (s.journeysWithoutStartEvent.length) {
    out.push(
      ...section("JOURNEYS WITH NOTHING TO START THEM", [
        "  These journeys describe work the system has no event for, so nothing",
        "  in the code can ever kick them off.",
        "",
        ...s.journeysWithoutStartEvent.map((k) => `  ${k}`)
      ])
    );
  }

  out.push(
    ...section(
      `HOUSE RULES WRITTEN ON THE JOURNEYS (${s.findings.rules.length})`,
      [
        "  Free text a person wrote. Listed next to the step it governs, never",
        "  judged — a checker that tried to enforce prose would only make noise.",
        "",
        ...s.findings.rules.map((f) => `  [${f.journey}] ${f.summary}`)
      ]
    )
  );

  out.push("", `Per-path detail (${s.walked.paths} paths)`, "-".repeat(30));
  for (const p of run.paths) {
    out.push(
      `  ${p.pathId}${p.branches.length ? ` — took the "${p.branches.map((b) => b.lane).join(" / ")}" branch` : ""}`,
      `      steps ${p.steps.length} · events ${p.events.length} · workflows ${p.workflowsFired.length} · messages ${p.messages.length} · time passed ${ms(p.virtualElapsedMs)}`
    );
  }

  return out.join("\n");
}

export default { summary, text, headline };
