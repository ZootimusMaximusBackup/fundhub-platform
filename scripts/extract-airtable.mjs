#!/usr/bin/env node
// Extract the live Airtable base schema into fundhub-docs/sources/AIRTABLE-BASE-EXTRACT.md.
//
//   AIRTABLE_API_KEY=pat... AIRTABLE_BASE_ID=app... node scripts/extract-airtable.mjs
//   ... --no-samples     schema only, skip the sample-record pass
//   ... --stdout         print the document instead of writing it
//
// The token is read from the environment and is never written to the output
// document, never logged, and never echoed in an error message. If you are
// behind the agent proxy, run with NODE_USE_ENV_PROXY=1 — Node's built-in fetch
// ignores HTTPS_PROXY without it.
//
// Why the redaction pass exists: this base holds SSNs, credit reports, and
// contact details. The document needs to show the *shape* of a record — which
// fields are populated together, what cardinality the links have — and nothing
// else. So sample values never reach the page. Every cell is replaced by a type
// descriptor before it is formatted, and the raw records are never persisted to
// disk in any form. describeValue() is the only thing standing between the API
// response and the committed file; treat it as security-relevant.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.airtable.com";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT_FILE = path.join(REPO, "fundhub-docs/sources/AIRTABLE-BASE-EXTRACT.md");

/** Records to pull per operational table. The spec asks for 3-5. */
const SAMPLE_SIZE = 5;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * One Airtable API call, with backoff for the 5 req/sec rate limit.
 *
 * Never interpolates the token into a thrown message — errors from here end up
 * in logs and CI output.
 */
async function api(token, pathname, search = {}) {
  const url = new URL(pathname, API);
  for (const [k, vs] of Object.entries(search)) {
    for (const v of [].concat(vs)) url.searchParams.append(k, v);
  }

  let delay = 500;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return res.json();

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 4) {
      const body = await res.text().catch(() => "");
      const err = new Error(`${res.status} ${res.statusText} on ${url.pathname} ${body.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }
}

/** Schema for every table, including per-view visible field ids. */
export async function fetchSchema(token, baseId) {
  const { tables } = await api(token, `/v0/meta/bases/${baseId}/tables`, {
    "include[]": ["visibleFieldIds"],
  });
  return tables;
}

/**
 * Base display name. Needs the schema.bases:read scope on the token; a PAT
 * scoped to a single base can read its tables but not list bases, so a 403 here
 * is normal and non-fatal.
 */
export async function fetchBaseName(token, baseId) {
  try {
    const { bases } = await api(token, "/v0/meta/bases");
    return bases.find((b) => b.id === baseId)?.name ?? null;
  } catch {
    return null;
  }
}

/** Up to SAMPLE_SIZE raw records. Callers must redact before doing anything else. */
async function fetchSample(token, baseId, tableId) {
  const { records } = await api(token, `/v0/${baseId}/${tableId}`, { maxRecords: String(SAMPLE_SIZE) });
  return records;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Replace a cell value with a description of its shape.
 *
 * Deliberately coarse on anything that could carry meaning on its own: numbers
 * report int-vs-decimal but never magnitude (a credit score and a funding
 * amount are both just `number`), booleans never report which way they point
 * (`fraud_alert_present` is real data), and select cells never report which
 * option was chosen. String length survives because it is the single most
 * useful shape signal and cannot reconstruct a value.
 */
export function describeValue(value) {
  if (value === null || value === undefined || value === "") return "—";

  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    const first = value[0];
    if (typeof first === "string" && /^rec[A-Za-z0-9]{14}$/.test(first)) return `linked[${value.length}]`;
    if (first && typeof first === "object") {
      if ("url" in first && "filename" in first) return `attachment[${value.length}]`;
      if ("email" in first || "id" in first) return `collaborator[${value.length}]`;
      return `object[${value.length}]`;
    }
    if (typeof first === "number") return `number[${value.length}]`;
    return `text[${value.length}]`;
  }

  switch (typeof value) {
    case "boolean":
      return "checkbox";
    case "number":
      return Number.isInteger(value) ? "number(int)" : "number(decimal)";
    case "object":
      if ("url" in value && "filename" in value) return "attachment";
      if ("email" in value || "name" in value) return "collaborator";
      if ("specialValue" in value) return `special(${value.specialValue})`;
      if ("state" in value) return `computed(${value.state})`;
      return "object";
    case "string": {
      if (/^rec[A-Za-z0-9]{14}$/.test(value)) return "recordId";
      return `text(len ${value.length})`;
    }
    default:
      return typeof value;
  }
}

/**
 * Turn raw records into { id, cells: { [fieldId]: descriptor } }.
 *
 * Record ids are kept — they are opaque handles, not client data, and they let
 * a reader match a sampled row against a link column in another table.
 */
export function redactRecords(records, fields) {
  const byName = new Map(fields.map((f) => [f.name, f.id]));
  return records.map((rec) => {
    const cells = {};
    for (const [name, value] of Object.entries(rec.fields ?? {})) {
      const id = byName.get(name) ?? name;
      cells[id] = describeValue(value);
    }
    return { id: rec.id, cells };
  });
}

// ---------------------------------------------------------------------------
// Schema shaping
// ---------------------------------------------------------------------------

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function findTable(tables, name) {
  return tables.find((t) => norm(t.name) === norm(name)) ?? null;
}

export function findField(table, name) {
  return table?.fields.find((f) => norm(f.name) === norm(name)) ?? null;
}

/** Choice names for a select-ish field, or null if the field has no option list. */
export function choicesOf(field) {
  const choices = field?.options?.choices;
  return Array.isArray(choices) ? choices.map((c) => c.name) : null;
}

/**
 * A one-line summary of a field's configuration, for the "Options / config"
 * column. Select option lists are rendered separately in full, so this only
 * counts them.
 */
export function describeFieldOptions(field, tablesById, table) {
  const o = field.options ?? {};
  const tableName = (id) => tablesById.get(id)?.name ?? id;
  const parts = [];

  // A lookup/rollup names a link field on *this* table; that link field names
  // the target table; the looked-up field lives on the target. Resolve the
  // whole chain so the column reads as names rather than three opaque ids.
  const throughLink = () => {
    const link = table?.fields.find((f) => f.id === o.recordLinkFieldId);
    const target = tablesById.get(link?.options?.linkedTableId);
    const targetField = target?.fields.find((f) => f.id === o.fieldIdInLinkedTable);
    return [
      link ? `via \`${link.name}\`` : o.recordLinkFieldId ? `via \`${o.recordLinkFieldId}\`` : null,
      target ? `→ ${target.name}` : null,
      targetField ? `.\`${targetField.name}\`` : o.fieldIdInLinkedTable ? `.\`${o.fieldIdInLinkedTable}\`` : null,
    ]
      .filter(Boolean)
      .join(" ")
      .replace(" .", ".");
  };

  switch (field.type) {
    case "singleSelect":
    case "multipleSelects":
      parts.push(`${(o.choices ?? []).length} options — see option sets below`);
      break;
    case "multipleRecordLinks":
      parts.push(`→ ${tableName(o.linkedTableId)}`);
      parts.push(o.prefersSingleRecordLink ? "single link" : "multiple links");
      break;
    case "multipleLookupValues":
      parts.push(throughLink());
      if (o.result?.type) parts.push(`result ${o.result.type}`);
      if (o.isValid === false) parts.push("**broken lookup**");
      break;
    case "rollup":
      parts.push(throughLink());
      if (o.result?.type) parts.push(`result ${o.result.type}`);
      if (o.isValid === false) parts.push("**broken rollup**");
      break;
    case "formula":
      parts.push(`result ${o.result?.type ?? "unknown"}`);
      if (o.isValid === false) parts.push("**invalid formula**");
      break;
    case "number":
    case "percent":
    case "currency":
      if (o.precision !== undefined) parts.push(`precision ${o.precision}`);
      if (o.symbol) parts.push(`symbol ${o.symbol}`);
      break;
    case "date":
    case "dateTime":
      if (o.dateFormat?.name) parts.push(o.dateFormat.name);
      if (o.timeZone) parts.push(o.timeZone);
      break;
    case "checkbox":
      if (o.icon) parts.push(o.icon);
      break;
    case "count":
      parts.push("count of linked records");
      break;
    case "externalSyncSource":
      parts.push("synced source");
      break;
    default:
      break;
  }
  return parts.filter(Boolean).join(" · ") || "—";
}

/** Every link between tables, deduplicated so a symmetric pair appears once. */
export function relationships(tables) {
  const tablesById = new Map(tables.map((t) => [t.id, t]));
  const seen = new Set();
  const out = [];

  for (const table of tables) {
    for (const field of table.fields) {
      if (field.type !== "multipleRecordLinks") continue;
      const target = tablesById.get(field.options?.linkedTableId);
      const inverse = field.options?.inverseLinkFieldId;

      // A symmetric link is two fields pointing at each other. Key on the
      // unordered field-id pair so it is reported once, from both sides.
      const key = [field.id, inverse].filter(Boolean).sort().join("::");
      if (seen.has(key)) continue;
      seen.add(key);

      const inverseField = target?.fields.find((f) => f.id === inverse);
      out.push({
        from: table.name,
        fromField: field.name,
        to: target?.name ?? field.options?.linkedTableId ?? "?",
        toField: inverseField?.name ?? null,
        cardinality: `${field.options?.prefersSingleRecordLink ? "one" : "many"} → ${
          inverseField?.options?.prefersSingleRecordLink ? "one" : "many"
        }`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spec expectations
// ---------------------------------------------------------------------------

// What the three build specs say the base contains. Sources:
//   spec-navigation.md              — FundHub_Navigation_Build_Spec
//   spec-client-control-panel.md    — FundHub_Client_Control_Panel_Build_Spec
//   spec-inquiry-remover-dashboard  — FundHub_Inquiry_Remover_Dashboard_Spec
//
// These are claims to be checked, not truths. Every entry here is something a
// spec asserts exists; the extract decides whether it actually does. Findings
// are FLAGGED ONLY — this script never edits the base.
export const SPEC_EXPECTATIONS = [
  // --- Client Control Panel: the field rename map (spec §2) ---------------
  ...[
    "Next Action Badge",
    "Credit Snapshot Age",
    "docs_missing",
    "Hold Reason",
    "Employee Next Action",
    "fraud_alert_present",
    "security_freeze_p_present",
    "ghl_contact_url",
    "raw_report_url_latest",
    "primary_snapshot_date",
    "primary_snapshot_source",
    "is_finalized",
  ].map((field) => ({ spec: "spec-client-control-panel.md", table: "Clients", field, note: "field rename map (§2)" })),

  // --- Client Control Panel: fields referenced by the 7 groups (spec §3) ---
  ...[
    "Funding Round #",
    "Prequal",
    "Total Approved $",
    "Open Inquiries",
    "Email",
    "Phone",
    "Personal State",
    "Business State",
    "Notes",
  ].map((field) => ({ spec: "spec-client-control-panel.md", table: "Clients", field, note: "record-detail group field (§3)" })),

  // --- Navigation: the queue list columns (spec §4 step 1) ----------------
  ...["Client Name", "Hold Badge"].map((field) => ({
    spec: "spec-navigation.md",
    table: "Clients",
    field,
    note: "Today's Queue list column (§4 step 1)",
  })),

  // --- Inquiry Remover: tables the dashboard reads ------------------------
  ...["Inquiry Removal Cases", "Inquiry Log", "Clients", "Snapshots", "Funding Rounds"].map((table) => ({
    spec: "spec-inquiry-remover-dashboard.md",
    table,
    note: "declared data source",
  })),

  // --- Inquiry Remover: INQUIRY_REMOVAL_CASES fields ----------------------
  ...[
    ["case_status", "queue filter + close action"],
    ["requested_by", "quick reference group"],
    ["requested_at", "queue sort"],
    ["selected_bureaus_raw", "queue column"],
    ["open_inquiry_count", "§4.1 required addition (rollup)"],
    ["master_call_state", "§4.1 required addition (lookup/formula)"],
    ["hold_duration_display", "§4.1 required addition (formula)"],
    ["completed_at", "§4.1 required addition (date w/ time)"],
    ["call_batch_id", "call activity log group"],
    ["voice_provider", "call activity log group"],
    ["attempt_count", "call activity log group"],
    ["hold_started_at", "call activity log group"],
    ["live_agent_reached_at", "call activity log group"],
    ["rep_handoff_at", "call activity log group"],
    ["last_dtmf_path", "call activity log group"],
    ["call_outcome_summary", "call activity log group"],
  ].map(([field, note]) => ({
    spec: "spec-inquiry-remover-dashboard.md",
    table: "Inquiry Removal Cases",
    field,
    note,
  })),

  // --- Inquiry Remover: INQUIRY_LOG fields + option sets ------------------
  {
    spec: "spec-inquiry-remover-dashboard.md",
    table: "Inquiry Log",
    field: "Bureau",
    expectChoices: ["EX", "EQ", "TU"],
    note: "single select per §2.2 group 3",
  },
  {
    spec: "spec-inquiry-remover-dashboard.md",
    table: "Inquiry Log",
    field: "call_state",
    expectChoices: ["queued", "dialing", "ivr", "holding", "live_agent_reached", "transferred_to_rep"],
    note: "queue summary-card filters (§1.2) + dropdown filter (§1.3)",
  },
  {
    spec: "spec-inquiry-remover-dashboard.md",
    table: "Inquiry Log",
    field: "Status",
    expectChoices: ["Open", "Cleared"],
    note: "mark-cleared action (§2.2 group 3)",
  },
  ...["inquiry_name", "is_open"].map((field) => ({
    spec: "spec-inquiry-remover-dashboard.md",
    table: "Inquiry Log",
    field,
    note: "§2.2 group 3 / §4.1 rollup source",
  })),

  // --- Inquiry Remover: linked-table fields it reads through lookups ------
  ...[
    ["Snapshots", "raw_report_url", "raw credit reports group (§2.2 group 2)"],
    ["Snapshots", "raw_report_url_business", "raw credit reports group (§2.2 group 2)"],
    ["Funding Rounds", "round_number", "quick reference lookup"],
    ["Clients", "full_name", "record-detail title field"],
    ["Clients", "analyzer_prequal_amount", "prequal lookup"],
    ["Clients", "personal_state", "quick reference lookup"],
    ["Clients", "ghl_contact_id", "AX24 webhook payload (§4.2)"],
  ].map(([table, field, note]) => ({ spec: "spec-inquiry-remover-dashboard.md", table, field, note })),
];

/**
 * Compare the specs against the extracted schema.
 *
 * Returns findings only — nothing here mutates the base or the schema. A
 * finding is a disagreement between what a spec asserts and what the API
 * reports, classified so the reader can tell "this was never built" from
 * "this was built differently".
 */
export function checkSpecs(tables, expectations = SPEC_EXPECTATIONS) {
  const findings = [];

  for (const exp of expectations) {
    const table = findTable(tables, exp.table);

    if (!table) {
      findings.push({
        kind: "missing-table",
        spec: exp.spec,
        table: exp.table,
        field: exp.field ?? null,
        detail: `Spec references table \`${exp.table}\`; no table with that name exists in the base.`,
        note: exp.note,
      });
      continue;
    }
    if (!exp.field) continue;

    const field = findField(table, exp.field);
    if (!field) {
      findings.push({
        kind: "missing-field",
        spec: exp.spec,
        table: table.name,
        field: exp.field,
        detail: `Spec references \`${exp.table}.${exp.field}\`; that field does not exist on \`${table.name}\`.`,
        note: exp.note,
      });
      continue;
    }

    if (exp.expectChoices) {
      const actual = choicesOf(field);
      if (!actual) {
        findings.push({
          kind: "type-mismatch",
          spec: exp.spec,
          table: table.name,
          field: field.name,
          detail: `Spec treats \`${field.name}\` as a select with a fixed option list; base type is \`${field.type}\`, which has no options.`,
          note: exp.note,
        });
        continue;
      }
      const lower = new Set(actual.map(norm));
      const missing = exp.expectChoices.filter((c) => !lower.has(norm(c)));
      const extra = actual.filter((c) => !exp.expectChoices.some((e) => norm(e) === norm(c)));
      if (missing.length || extra.length) {
        findings.push({
          kind: "option-mismatch",
          spec: exp.spec,
          table: table.name,
          field: field.name,
          detail: [
            missing.length ? `spec expects but base lacks: ${missing.map((c) => `\`${c}\``).join(", ")}` : null,
            extra.length ? `base has but spec never mentions: ${extra.map((c) => `\`${c}\``).join(", ")}` : null,
          ]
            .filter(Boolean)
            .join("; "),
          note: exp.note,
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");

function mdTable(headers, rows) {
  if (rows.length === 0) return "_none_\n";
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(esc).join(" | ")} |`).join("\n");
  return `${head}\n${rule}\n${body}\n`;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Render the whole document.
 *
 * Pure: takes already-redacted input and returns a string. `samples` maps table
 * id → redacted rows, or is empty when --no-samples was passed.
 */
export function buildMarkdown({ baseId, baseName, tables, samples = new Map(), findings = [], generatedAt, sampleErrors = new Map() }) {
  const tablesById = new Map(tables.map((t) => [t.id, t]));
  const out = [];

  out.push(`# Airtable Base Extract — ${baseName ?? "FundHub"}`);
  out.push("");
  out.push(`\`${baseId}\` · extracted ${generatedAt} · generated by \`scripts/extract-airtable.mjs\``);
  out.push("");
  out.push(
    "This is a machine extract of **what the Airtable base actually contains**, taken from the",
    "Airtable Metadata API. It is not a design document and it is not a spec — where it disagrees",
    "with a build spec, the spec is the intent and this is the reality. Disagreements are listed in",
    "[Spec mismatches](#spec-mismatches) and are **flagged, never fixed**.",
  );
  out.push("");

  out.push("## What the API exposes — and what it does not");
  out.push("");
  out.push("**Fully visible via the Metadata API, and therefore trustworthy below:**");
  out.push("");
  out.push("- Every table: name, id, description, primary field");
  out.push("- Every field: name, id, type, and the complete option list for single/multi selects");
  out.push("- Field configuration: link targets, lookup/rollup sources, formula result types, precision, date formats");
  out.push("- Every **grid/calendar/gallery/kanban/timeline/form** view: name, id, type, parent table, and visible field ids");
  out.push("- Table-to-table relationships, derived from link fields and their inverse pairs");
  out.push("");
  out.push("**Not exposed by any public Airtable API — absent below, and not to be read as absent from the base:**");
  out.push("");
  out.push(
    "- **Interface Designer layouts.** Pages, groups, tab navigation, field label overrides, button",
    "  actions, and conditional-visibility rules are not readable through the API at all. All three",
    "  build specs are almost entirely about interface layout, so most of what they describe *cannot",
    "  be verified here* — only the underlying base fields they depend on can. Interface findings",
    "  below are limited to \"the field this page needs exists / does not exist\".",
  );
  out.push("- **View configuration beyond name, type and visible fields** — filters, sorts, groupings, row height, and colour rules are not returned.");
  out.push("- **Automations.** Names, triggers, actions, and scripts (AX09, AX23, AX24, and the rest) have no read endpoint.");
  out.push("- **Personal views**, and any view belonging to a collaborator other than the token owner.");
  out.push("- **Base-level permissions, collaborators, sync configuration, and revision history.**");
  out.push("");
  out.push(
    "Verifying the interface layer means opening Interface Designer by hand. Where a spec claims an",
    "interface behaviour, this document can only confirm the data model underneath it.",
  );
  out.push("");

  out.push("## Sample records");
  out.push("");
  out.push(
    `Up to ${SAMPLE_SIZE} records were read per table **purely to observe record shape**. Every value is`,
    "replaced by a type descriptor before it reaches this file — no field value from the base is",
    "reproduced anywhere in this document. No SSNs, no credit data, no contact details. `—` means the",
    "cell was empty; `text(len 24)` means a 24-character string was present and discarded. Numbers",
    "report int-vs-decimal but never magnitude, checkboxes never report which way they point, and",
    "select cells never report which option was chosen. Record ids are kept because they are opaque",
    "handles that let you match a sampled row against a link column elsewhere.",
  );
  out.push("");

  // --- contents -----------------------------------------------------------
  out.push("## Contents");
  out.push("");
  out.push(`- [Base summary](#base-summary)`);
  out.push(`- [Relationships](#relationships)`);
  tables.forEach((t, i) => out.push(`- [${i + 1}. ${t.name}](#${slug(`${i + 1}-${t.name}`)})`));
  out.push(`- [Spec mismatches](#spec-mismatches)`);
  out.push("");

  // --- base summary -------------------------------------------------------
  out.push("## Base summary");
  out.push("");
  out.push(
    mdTable(
      ["#", "Table", "Table ID", "Fields", "Views", "Primary field", "Description"],
      tables.map((t, i) => [
        i + 1,
        t.name,
        `\`${t.id}\``,
        t.fields.length,
        t.views.length,
        t.fields.find((f) => f.id === t.primaryFieldId)?.name ?? "—",
        t.description || "—",
      ]),
    ),
  );

  // --- relationships ------------------------------------------------------
  const rels = relationships(tables);
  out.push("## Relationships");
  out.push("");
  out.push("Each row is one link, reported once from the side that declares it. A symmetric link names both fields.");
  out.push("");
  out.push(
    mdTable(
      ["From table", "Link field", "To table", "Inverse field", "Cardinality"],
      rels.map((r) => [r.from, `\`${r.fromField}\``, r.to, r.toField ? `\`${r.toField}\`` : "_one-way_", r.cardinality]),
    ),
  );

  // --- per table ----------------------------------------------------------
  out.push("## Tables");
  out.push("");

  tables.forEach((table, i) => {
    out.push(`### ${i + 1}. ${table.name}`);
    out.push("");
    out.push(`\`${table.id}\``);
    out.push("");
    out.push(table.description ? `> ${table.description}` : "_No table description set in Airtable._");
    out.push("");

    out.push("#### Fields");
    out.push("");
    out.push(
      mdTable(
        ["Field", "Field ID", "Type", "Options / config"],
        table.fields.map((f) => [
          f.id === table.primaryFieldId ? `**${f.name}** _(primary)_` : f.name,
          `\`${f.id}\``,
          `\`${f.type}\``,
          describeFieldOptions(f, tablesById, table),
        ]),
      ),
    );

    // Full option lists, which is the part people actually need.
    const selects = table.fields.filter((f) => choicesOf(f)?.length);
    if (selects.length) {
      out.push("#### Option sets");
      out.push("");
      for (const f of selects) {
        out.push(`**\`${f.name}\`** — \`${f.type}\`, ${choicesOf(f).length} options:`);
        out.push("");
        out.push(
          mdTable(
            ["Option", "Option ID", "Colour"],
            f.options.choices.map((c) => [c.name, `\`${c.id}\``, c.color ?? "—"]),
          ),
        );
      }
    }

    out.push("#### Views");
    out.push("");
    const fieldNameById = new Map(table.fields.map((f) => [f.id, f.name]));
    out.push(
      mdTable(
        ["View", "View ID", "Type", "Visible fields"],
        table.views.map((v) => [
          v.name,
          `\`${v.id}\``,
          `\`${v.type}\``,
          v.visibleFieldIds
            ? `${v.visibleFieldIds.length} of ${table.fields.length} — ${v.visibleFieldIds
                .map((id) => fieldNameById.get(id) ?? id)
                .join(", ")}`
            : "_not reported by API_",
        ]),
      ),
    );

    const rows = samples.get(table.id);
    const sampleError = sampleErrors.get(table.id);
    out.push("#### Sample record shapes");
    out.push("");
    if (sampleError) {
      out.push(`_Could not read records: ${esc(sampleError)}_`);
      out.push("");
    } else if (!rows) {
      out.push("_Not sampled._");
      out.push("");
    } else if (rows.length === 0) {
      out.push("_Table is empty._");
      out.push("");
    } else {
      out.push(`${rows.length} record${rows.length === 1 ? "" : "s"}, values redacted to types:`);
      out.push("");
      out.push(
        mdTable(
          ["Field", "Type", ...rows.map((_, n) => `r${n + 1}`)],
          table.fields.map((f) => [f.name, `\`${f.type}\``, ...rows.map((r) => r.cells[f.id] ?? "—")]),
        ),
      );
      out.push(`Record ids: ${rows.map((r) => `\`${r.id}\``).join(", ")}`);
      out.push("");
    }
  });

  // --- mismatches ---------------------------------------------------------
  out.push("## Spec mismatches");
  out.push("");
  out.push(
    "Every row is a place where a build spec and the live base disagree. **These are flagged, not",
    "fixed** — the specs describe what was supposed to be built, this extract describes what exists,",
    "and reconciling them is a decision, not a cleanup.",
  );
  out.push("");
  out.push(
    "Scope limit: only the *data model* can be checked. The specs are mostly about Interface Designer",
    "layout, which no API exposes, so a spec item absent from this table has not been verified — it",
    "has only failed to contradict the schema.",
  );
  out.push("");

  const LABEL = {
    "missing-table": "Table missing",
    "missing-field": "Field missing",
    "type-mismatch": "Type mismatch",
    "option-mismatch": "Option set differs",
  };

  if (findings.length === 0) {
    out.push("_No disagreements found between the specs' data-model claims and the extracted schema._");
    out.push("");
  } else {
    for (const spec of [...new Set(findings.map((f) => f.spec))]) {
      const forSpec = findings.filter((f) => f.spec === spec);
      out.push(`### ${spec}`);
      out.push("");
      out.push(
        mdTable(
          ["Kind", "Table", "Field", "Disagreement", "Spec context"],
          forSpec.map((f) => [
            LABEL[f.kind] ?? f.kind,
            `\`${f.table}\``,
            f.field ? `\`${f.field}\`` : "—",
            f.detail,
            f.note ?? "—",
          ]),
        ),
      );
    }
  }

  out.push("### Not verifiable from the API");
  out.push("");
  out.push(
    mdTable(
      ["Spec", "Claim", "Why it cannot be checked"],
      [
        ["spec-navigation.md", "4 sidebar pages collapse to 1 (Today's Queue) with a 3-tab Record Detail", "Interface pages and tab navigation are not exposed by any API"],
        ["spec-navigation.md", "Click into record details → full-screen Record Detail", "Interface user-actions are not exposed"],
        ["spec-navigation.md", "Credit Snapshot and Funding Matrix pages unpublished", "Page publish state is not exposed"],
        ["spec-client-control-panel.md", "7 record-detail groups, 12 field label overrides", "Interface groups and label overrides are not exposed; only the underlying fields are checked above"],
        ["spec-client-control-panel.md", "5 Run-automation buttons in a single Actions group", "Interface buttons and automations are not exposed"],
        ["spec-client-control-panel.md", "Conditional visibility on the Active Blockers group", "Interface visibility rules are not exposed"],
        ["spec-inquiry-remover-dashboard.md", "Inquiry Remover Queue list page with 4 number elements", "Interface pages and elements are not exposed"],
        ["spec-inquiry-remover-dashboard.md", "AX09 / AX23 / AX24 automations", "Automations have no read endpoint"],
        ["spec-inquiry-remover-dashboard.md", "GHL webhook on case close", "Automation actions are not exposed"],
      ],
    ),
  );

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(argv) {
  const token = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) {
    console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in the environment.");
    console.error("Do not pass the token on the command line — it lands in shell history.");
    process.exit(2);
  }

  const withSamples = !argv.includes("--no-samples");
  const toStdout = argv.includes("--stdout");

  const [tables, baseName] = await Promise.all([fetchSchema(token, baseId), fetchBaseName(token, baseId)]);
  console.error(`schema: ${tables.length} tables`);

  const samples = new Map();
  const sampleErrors = new Map();
  if (withSamples) {
    for (const table of tables) {
      try {
        // Raw records exist only inside this expression. redactRecords is the
        // last point at which a real value is in scope.
        samples.set(table.id, redactRecords(await fetchSample(token, baseId, table.id), table.fields));
      } catch (err) {
        sampleErrors.set(table.id, err.message.replace(/\s+/g, " ").slice(0, 200));
      }
      console.error(`sampled: ${table.name}`);
    }
  }

  const findings = checkSpecs(tables);
  console.error(`spec findings: ${findings.length}`);

  const md = buildMarkdown({
    baseId,
    baseName,
    tables,
    samples,
    sampleErrors,
    findings,
    generatedAt: new Date().toISOString().slice(0, 10),
  });

  if (toStdout) {
    process.stdout.write(md);
    return;
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, md);
  console.error(`wrote ${path.relative(REPO, OUT_FILE)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    // err.message never contains the token — api() builds it from status + path.
    console.error(err.message);
    process.exit(1);
  });
}
