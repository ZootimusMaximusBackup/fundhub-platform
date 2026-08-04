// message_templates seeder.
//
//   DATABASE_URL=postgres://… node src/messaging/seed/seed.mjs
//   …                          node src/messaging/seed/seed.mjs --dry-run
//   …                          node src/messaging/seed/seed.mjs --docs=/path/to/fundhub-docs/sources
//
// Reads the three source docs in fundhub-docs/sources, parses them, and upserts
// one message_templates row per template. It is a PARSER, not a transcription:
// edit the copy in the doc, re-run, and the rows follow. Copy is verbatim.
//
// Idempotent — ON CONFLICT (org_id, template_key) DO UPDATE. Re-running is safe
// and converges the rows on whatever the docs currently say.
//
// Requires db/seed/006_message_templates_source_doc.sql (adds source_doc).
//
// Does NOT render and does NOT compliance-check. Owner decision (2026-08-04):
// every seeded row ships compliance_passed=false so nothing sends until a human
// approves in the template editor (migration 116). Workflow keys that differ
// from doc IDs are covered via workflow-keys.mjs (alias / templates-seed / DRAFT).

import { collect, resolveDocsDir } from "./collect.mjs";
import { collectMergeTags } from "./merge-tags.mjs";
import { auditWorkflows } from "./workflow-audit.mjs";
import { formatReport } from "./report.mjs";
import { prepareSeedable } from "./workflow-keys.mjs";

const UPSERT = `
  INSERT INTO message_templates
    (org_id, template_key, channel, subject, body, compliance_passed, source_doc)
  SELECT o.id, $1, $2, $3, $4, $5, $6 FROM orgs o WHERE o.slug = $7
  ON CONFLICT (org_id, template_key) DO UPDATE SET
    channel           = EXCLUDED.channel,
    subject           = EXCLUDED.subject,
    body              = EXCLUDED.body,
    compliance_passed = EXCLUDED.compliance_passed,
    source_doc        = EXCLUDED.source_doc,
    updated_at        = now()
  RETURNING (xmax = 0) AS inserted`;

// db: { query(sql, params) } — the src/db.mjs interface.
export async function seedTemplates(db, templates, { orgSlug = "fundhub" } = {}) {
  let inserted = 0;
  let updated = 0;
  for (const t of templates) {
    const r = await db.query(UPSERT, [
      t.templateKey,
      t.channel,
      t.subject ?? null,
      t.body,
      t.compliancePassed,
      t.sourceDoc,
      orgSlug,
    ]);
    if (!r.rows.length) throw new Error(`org '${orgSlug}' not found — run npm run migrate first`);
    if (r.rows[0].inserted) inserted += 1;
    else updated += 1;
  }
  return { inserted, updated, total: templates.length };
}

export function countByChannel(templates) {
  const counts = {};
  for (const t of templates) counts[t.channel] = (counts[t.channel] || 0) + 1;
  return counts;
}

// Everything except the DB write — used by the report and by the tests.
export function analyse({ docs, root } = {}) {
  const docsDir = resolveDocsDir(docs);
  const { perDoc, seedable: fromDocs, problems } = collect(docsDir);
  const { seedable, coverage } = prepareSeedable(fromDocs, root ? { root } : {});
  return {
    docsDir,
    perDoc,
    seedable,
    coverage,
    problems,
    byChannel: countByChannel(seedable),
    mergeTags: collectMergeTags(seedable),
    audit: auditWorkflows(seedable.map((t) => t.templateKey), root ? { root } : {}),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const docs = (argv.find((a) => a.startsWith("--docs=")) || "").slice("--docs=".length) || undefined;

  const result = analyse({ docs });

  let write = null;
  if (dryRun) {
    console.log("(--dry-run: parsed and audited, nothing written)\n");
  } else {
    const { db, close } = await import("../../db.mjs");
    try {
      write = await seedTemplates(db, result.seedable);
    } finally {
      await close();
    }
  }

  console.log(formatReport({ ...result, write, dryRun }));

  // Empty bodies are a source-doc defect, not a transient hiccup: fail loudly so
  // it cannot slip through a CI seed step unnoticed.
  if (result.problems.emptyBody.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("FATAL:", e.message);
    process.exit(1);
  });
}
