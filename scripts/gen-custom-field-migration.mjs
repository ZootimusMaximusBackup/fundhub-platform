#!/usr/bin/env node
/**
 * Generates db/schema/005_client_custom_fields.sql from the live GHL custom-field
 * definitions (Master Spec §B: the ~252 typed client columns, ported before the CRM
 * adapter writes). Run: GHL_PRIVATE_API_KEY=… GHL_LOCATION=… node scripts/gen-custom-field-migration.mjs
 *
 * Reads fields from GHL LeadConnector v2, maps GHL dataType → Postgres type, and emits
 * one column per field on a dedicated client_custom_fields table (client_id FK + org_id,
 * per Master Spec Rule 7). Column names keep the cf_* fieldKey (Rule 2) so the DB stays
 * canonical while the UI shows plain language (vision §8.3).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.GHL_PRIVATE_API_KEY;
const LOC = process.env.GHL_LOCATION || 'ORh91GeY4acceSASSnLR';
if (!KEY) throw new Error('GHL_PRIVATE_API_KEY required');

// GHL dataType → Postgres column type. Multi-value fields become text[]; everything
// unrecognized falls back to text (safe: GHL stores everything as strings on the wire).
const TYPE_MAP = {
  TEXT: 'text', LARGE_TEXT: 'text', TEXTAREA: 'text', PHONE: 'text', EMAIL: 'text',
  SINGLE_OPTIONS: 'text', RADIO: 'text', DROPDOWN: 'text', FILE_UPLOAD: 'text', URL: 'text',
  NUMERICAL: 'numeric', MONETARY: 'numeric',
  DATE: 'date',
  CHECKBOX: 'text[]', MULTIPLE_OPTIONS: 'text[]', TEXTBOX_LIST: 'text[]',
};

function pgType(dt) {
  return TYPE_MAP[String(dt || '').toUpperCase()] || 'text';
}

// contact.cf_credit_score → cf_credit_score ; sanitize to a safe lowercase identifier.
function colName(field) {
  const raw = (field.fieldKey || field.name || '').replace(/^contact\./, '');
  let c = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!c) c = 'field_' + field.id.slice(0, 8);
  if (/^[0-9]/.test(c)) c = 'f_' + c;
  return c;
}

async function fetchFields() {
  const res = await fetch(`https://services.leadconnectorhq.com/locations/${LOC}/customFields`, {
    headers: { Authorization: `Bearer ${KEY}`, Version: '2021-07-28', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GHL ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.customFields || [];
}

const fields = await fetchFields();

// Dedupe column names (GHL can have colliding sanitized keys); keep first, suffix rest.
const seen = new Map();
const cols = [];
for (const f of fields) {
  let name = colName(f);
  if (seen.has(name)) { const n = seen.get(name) + 1; seen.set(name, n); name = `${name}_${n}`; }
  else seen.set(name, 1);
  cols.push({ name, type: pgType(f.dataType), ghlId: f.id, ghlKey: f.fieldKey, ghlType: f.dataType, label: f.name });
}

const lines = [];
lines.push('-- 005_client_custom_fields.sql');
lines.push(`-- Auto-generated from ${fields.length} live GHL custom fields (location ${LOC}).`);
lines.push('-- Master Spec §B (252 typed client columns) + Rule 2 (cf_* names) + Rule 7 (org_id).');
lines.push('-- Regenerate: node scripts/gen-custom-field-migration.mjs. Do NOT hand-edit.');
lines.push('');
lines.push('CREATE TABLE IF NOT EXISTS client_custom_fields (');
lines.push('  client_id   uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,');
lines.push('  org_id      uuid NOT NULL REFERENCES orgs(id),');
lines.push('  created_at  timestamptz NOT NULL DEFAULT now(),');
lines.push('  updated_at  timestamptz NOT NULL DEFAULT now(),');
for (const c of cols) {
  const pad = c.name.padEnd(48);
  lines.push(`  ${pad} ${c.type},   -- ${c.ghlType} · ${c.label} · ${c.ghlKey}`);
}
// drop trailing comma on last column line
const lastCol = lines.length - 1;
lines[lastCol] = lines[lastCol].replace(/,(\s+-- )/, '$1');
lines.push(');');
lines.push('');
lines.push('CREATE INDEX IF NOT EXISTS idx_ccf_org ON client_custom_fields(org_id);');
lines.push('');

const outSql = resolve(__dir, '../db/schema/005_client_custom_fields.sql');
writeFileSync(outSql, lines.join('\n'));

// Also emit a machine-readable map: cf column ↔ GHL id/key/type, for the CRM adapter.
mkdirSync(resolve(__dir, '../db/schema/meta'), { recursive: true });
const mapPath = resolve(__dir, '../db/schema/meta/custom-field-map.json');
writeFileSync(mapPath, JSON.stringify({ location: LOC, count: cols.length, fields: cols }, null, 2));

console.log(`Wrote ${cols.length} columns → db/schema/005_client_custom_fields.sql`);
console.log(`Wrote field map → db/schema/meta/custom-field-map.json`);
const byType = cols.reduce((a, c) => ((a[c.type] = (a[c.type] || 0) + 1), a), {});
console.log('Type breakdown:', byType);
