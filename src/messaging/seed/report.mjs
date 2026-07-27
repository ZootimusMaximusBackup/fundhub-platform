// The seeder's report. Kept separate from the write so `--dry-run` and the tests
// produce byte-identical output to a real run.

function h(title) {
  return `\n${title}\n${"─".repeat(title.length)}`;
}

export function formatReport(r) {
  const out = [];
  const { perDoc, seedable, problems, byChannel, mergeTags, audit, write, dryRun } = r;

  out.push(h("SEEDED — message_templates"));
  out.push(`docs: ${r.docsDir}`);
  for (const d of perDoc) {
    const delta = d.found === d.expected ? "" : `  ⚠ doc header says ${d.expected}`;
    out.push(`  ${String(d.found).padStart(3)}  ${d.file}${delta}`);
    out.push(`       ${d.note}`);
  }
  out.push("");
  for (const [channel, n] of Object.entries(byChannel).sort()) {
    const audited = seedable.filter((t) => t.channel === channel && t.compliancePassed).length;
    out.push(`  ${channel.padEnd(6)} ${String(n).padStart(3)} rows   (compliance_passed=true: ${audited})`);
  }
  out.push(`  ${"TOTAL".padEnd(6)} ${String(seedable.length).padStart(3)} rows`);
  if (write) out.push(`\n  wrote: ${write.inserted} inserted, ${write.updated} updated (upsert on org_id+template_key)`);
  else if (dryRun) out.push(`\n  wrote: nothing (--dry-run)`);

  out.push(h("EMPTY BODIES — not seeded"));
  if (!problems.emptyBody.length) out.push("  none — every parsed template has a body.");
  for (const p of problems.emptyBody) {
    out.push(`  ✗ ${p.templateKey}  [${p.channel}]  ${p.sourceDoc}`);
    out.push(`      ${p.label}`);
  }

  if (problems.duplicates.length) {
    out.push(h("DUPLICATE KEYS IN THE SOURCE DOC"));
    for (const p of problems.duplicates) {
      out.push(`  ⚠ ${p.templateKey} — ${p.resolution}`);
      out.push(`      ${p.detail}`);
      out.push(`      ${p.labels.join("  ||  ")}`);
    }
  }

  if (problems.keyHygiene.length) {
    out.push(h("KEYS WITH WHITESPACE — seeded as-is, fix the doc header"));
    out.push("  The doc separates KEY from Name with 2+ spaces; these headers used one,");
    out.push("  so the name got absorbed into the key. A workflow referencing the short");
    out.push("  form will not match these rows.");
    for (const p of problems.keyHygiene) out.push(`  ⚠ ${JSON.stringify(p.templateKey)}`);
  }

  out.push(h(`MERGE TAGS — ${mergeTags.length} distinct (the renderer must support these)`));
  const width = Math.max(...mergeTags.map((t) => t.tag.length), 1);
  for (const t of mergeTags) {
    out.push(`  {{${t.tag}}}${" ".repeat(width - t.tag.length)}  ×${String(t.count).padStart(4)}  ${t.channels.join("+")}`);
  }

  out.push(h("WORKFLOW AUDIT — template keys referenced but not seeded"));
  out.push(`  scanned ${audit.scannedFiles.length} workflow file(s)`);
  if (!audit.danglingKeys.length) out.push("  none — no workflow file names a template_key that has no row.");
  for (const d of audit.danglingKeys) out.push(`  ✗ ${d.templateKey}   ${d.file}:${d.line}`);

  out.push(h("WORKFLOW AUDIT — copy still hardcoded in workflow files"));
  out.push("  (each of these is a place someone must edit CODE to change what a client reads)");
  if (!audit.hardcodedCopy.length) out.push("  none.");
  for (const c of audit.hardcodedCopy) {
    const snippet = c.text.length > 90 ? `${c.text.slice(0, 90)}…` : c.text;
    out.push(`  ✗ ${c.file}:${c.line}  (${c.why})`);
    out.push(`      ${JSON.stringify(snippet)}`);
  }
  if (audit.untemplatedOutbound.length) {
    out.push("");
    out.push("  outbound message rows written with no template_key column:");
    for (const u of audit.untemplatedOutbound) {
      out.push(`  ? ${u.file}:${u.line}`);
      out.push(`      columns: ${u.columns}`);
    }
  }

  return `${out.join("\n")}\n`;
}
