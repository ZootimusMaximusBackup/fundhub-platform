// Reads the two source docs, parses them, and validates the result before a
// single row is written.
//
// Validation exists because the source docs are hand-maintained and DO contain
// collisions and gaps today. `ON CONFLICT (org_id, template_key) DO UPDATE`
// makes a duplicate key silently overwrite the earlier row, which would lose
// copy — so duplicates are resolved here, deterministically, and reported.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSmsCurrent } from "./parse-sms.mjs";
import { parseEmailTemplates } from "./parse-email.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");

// fundhub-docs is a sibling repo, not a submodule. Checked in the order a
// developer is most likely to have it; --docs=<dir> / FUNDHUB_DOCS wins.
export const DOCS_CANDIDATES = [
  path.resolve(REPO, "../fundhub-docs/sources"),
  "/workspace/fundhub-docs/sources",
  path.resolve(REPO, "fundhub-docs/sources"),
];

// Owner decision 2026-08-06: SMS-TEMPLATES-CURRENT.md supersedes both
// SMS-Compliant-Rewrites.md and Workflow-SMS-Fixes-Ready-to-Paste.md.
export const SOURCES = [
  {
    file: "SMS-TEMPLATES-CURRENT.md",
    parse: parseSmsCurrent,
    expected: 26,
    note: "post-compliance SMS source of truth (## KEY + plain body)",
  },
  {
    file: "EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md",
    parse: parseEmailTemplates,
    expected: 162,
    note: "GHL email templates (never compliance-audited)",
  },
];

// hasSources — does this directory actually hold the docs we need? Existence of
// the directory is not enough, and that distinction is load-bearing: this repo
// contains its own fundhub-docs/sources/ holding only AIRTABLE-BASE-EXTRACT.md,
// which used to win the candidate search on existence alone. resolveDocsDir()
// then returned a directory that could not satisfy a single source, and
// readSources() failed with "source doc missing" — burying the real problem
// (the sibling repo is not cloned) under a confusing error, in eight tests at
// once. A candidate only counts if the docs are in it.
export function hasSources(dir, sources = SOURCES) {
  return sources.every((s) => fs.existsSync(path.join(dir, s.file)));
}

export function missingSources(dir, sources = SOURCES) {
  return sources.filter((s) => !fs.existsSync(path.join(dir, s.file))).map((s) => s.file);
}

// findDocsDir — the usable docs directory, or null. Never throws, so a caller
// that can legitimately carry on without the docs (a test, a screen falling back
// to sample markup) can ask without a try/catch.
export function findDocsDir(override, sources = SOURCES) {
  const explicit = override || process.env.FUNDHUB_DOCS;
  if (explicit) {
    return fs.existsSync(explicit) && hasSources(explicit, sources) ? explicit : null;
  }
  for (const c of DOCS_CANDIDATES) {
    if (fs.existsSync(c) && hasSources(c, sources)) return c;
  }
  return null;
}

export function resolveDocsDir(override, sources = SOURCES) {
  const found = findDocsDir(override, sources);
  if (found) return found;

  const explicit = override || process.env.FUNDHUB_DOCS;
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`docs dir not found: ${explicit}`);
    throw new Error(
      `docs dir ${explicit} is missing: ${missingSources(explicit, sources).join(", ")}`
    );
  }

  // Say which candidates exist but are incomplete, separately from the ones that
  // are simply absent. "It's right there but empty" and "it isn't cloned" need
  // different fixes.
  const lines = DOCS_CANDIDATES.map((c) => {
    if (!fs.existsSync(c)) return `  ${c} — not present`;
    return `  ${c} — present but missing: ${missingSources(c, sources).join(", ")}`;
  });
  throw new Error(
    `Could not find a fundhub-docs/sources containing the copy source docs.\n${lines.join("\n")}\n` +
      `Clone fundhub-docs next to this repo or pass --docs=<dir> / FUNDHUB_DOCS=<dir>.`
  );
}

// Read + parse every source doc. Returns raw (pre-validation) templates.
export function readSources(docsDir, sources = SOURCES) {
  const parsed = [];
  const perDoc = [];
  for (const s of sources) {
    const full = path.join(docsDir, s.file);
    if (!fs.existsSync(full)) throw new Error(`source doc missing: ${full}`);
    const sourceDoc = `fundhub-docs/sources/${s.file}`;
    const rows = s.parse(fs.readFileSync(full, "utf8"), sourceDoc);
    parsed.push(...rows);
    perDoc.push({ ...s, sourceDoc, found: rows.length });
  }
  return { templates: parsed, perDoc };
}

// Split parsed templates into what is safe to seed and what a human must look at.
//
//   emptyBody   — nothing to render; NOT seeded (the row would be a landmine
//                 for the renderer and the schema requires body NOT NULL).
//   duplicates  — same template_key twice. Byte-identical copy collapses to one
//                 row; genuinely different copy is kept under a `--N` suffixed
//                 key so nothing is lost, and reported loudly.
//   keyHygiene  — a template_key containing internal whitespace, which happens
//                 where the doc header used a single space instead of the 2+
//                 spaces that separate KEY from Name. Seeded as-is (guessing an
//                 ID out of it would be inventing data) but reported, because a
//                 workflow referencing the short form will not match.
export function validate(templates) {
  const problems = { emptyBody: [], duplicates: [], keyHygiene: [] };

  const byKey = new Map();
  for (const t of templates) {
    if (!byKey.has(t.templateKey)) byKey.set(t.templateKey, []);
    byKey.get(t.templateKey).push(t);
  }

  const seedable = [];
  for (const t of templates) {
    if (!String(t.body).trim()) {
      problems.emptyBody.push({
        templateKey: t.templateKey,
        channel: t.channel,
        sourceDoc: t.sourceDoc,
        label: t.label,
      });
      continue;
    }
    seedable.push({ ...t });
  }

  // Resolve collisions among the rows that survived the empty-body check.
  const resolved = [];
  const groups = new Map();
  for (const t of seedable) {
    if (!groups.has(t.templateKey)) groups.set(t.templateKey, []);
    groups.get(t.templateKey).push(t);
  }
  for (const [key, group] of groups) {
    if (group.length === 1) {
      resolved.push(group[0]);
      continue;
    }
    const kept = [];
    for (const t of group) {
      const twin = kept.find((k) => k.subject === t.subject && k.body === t.body);
      if (twin) {
        problems.duplicates.push({
          templateKey: key,
          resolution: "collapsed",
          detail: "byte-identical copy appears twice in the source doc; seeded once",
          sourceDoc: t.sourceDoc,
          labels: [twin.label, t.label],
        });
        continue;
      }
      kept.push(t);
    }
    kept.forEach((t, i) => {
      if (i === 0) {
        resolved.push(t);
        return;
      }
      const suffixed = `${key}--${i + 1}`;
      problems.duplicates.push({
        templateKey: key,
        resolution: "disambiguated",
        detail: `two different templates share this key in the source doc; seeded the later one as ${suffixed}`,
        seededAs: suffixed,
        sourceDoc: t.sourceDoc,
        labels: [kept[0].label, t.label],
      });
      resolved.push({ ...t, templateKey: suffixed, disambiguatedFrom: key });
    });
  }

  for (const t of resolved) {
    if (/\s/.test(t.templateKey)) {
      problems.keyHygiene.push({
        templateKey: t.templateKey,
        sourceDoc: t.sourceDoc,
        detail: "key contains whitespace — doc header used a single space between KEY and Name",
      });
    }
  }

  resolved.sort((a, b) => a.channel.localeCompare(b.channel) || a.templateKey.localeCompare(b.templateKey));
  return { seedable: resolved, problems };
}

export function collect(docsDir, sources = SOURCES) {
  const { templates, perDoc } = readSources(docsDir, sources);
  const { seedable, problems } = validate(templates);
  return { templates, perDoc, seedable, problems };
}
