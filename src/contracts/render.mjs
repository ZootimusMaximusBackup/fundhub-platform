// src/contracts/render.mjs — turning template copy into a finished document.
//
// THE RENDERER IS NOT NEW. This module builds a merge context and hands it to
// renderTemplate() in src/lib/render-template.mjs — the same function that
// renders every SMS and email in this platform. A second renderer with its own
// slightly-different {{tag}} rules is exactly the "two functions doing the same
// thing" bug CLAUDE.md §8 names, and on contract copy the failure mode is a
// client signing a document with a literal `{{contact.first_name}}` in it.
//
// THREE NAMESPACES, and only three:
//
//   contact.*   the client record. The six typed columns off `clients`, plus
//               the clients.custom_fields jsonb (the 252 ported CRM fields)
//               spread underneath them so a stale custom field cannot shadow
//               real identity data.
//   field.*     THE NEW ONE. The blanks a staff member types in at send time,
//               declared per template in contract_templates.manual_fields.
//               A funding agreement's deposit amount is not a property of the
//               client and does not belong on the client record.
//   today       the date, YYYY-MM-DD. Contracts are dated; nothing else in this
//               platform's merge vocabulary supplies a date.
//
// UNRESOLVED TAGS RENDER BLANK — that is renderTemplate's behaviour and this
// module does not change it. What it adds is missingTags(), so the staff member
// previewing the document is TOLD which blanks came back empty before they send
// it. There is deliberately no blocking merge-tag check like
// src/messaging/merge-tags-registry.mjs: that exists because an SMS template is
// approved once and then fires unattended for months, whereas a contract is
// previewed by a human on every single send. The human is the check.

import { renderTemplate } from "../lib/render-template.mjs";

// Must stay identical to TOKEN_RE in src/lib/render-template.mjs. A tag this
// pattern cannot see is a tag missingTags() cannot report, and the preview would
// come back clean over a document that renders blank.
const TOKEN_RE = /\{\{\s*(\w+(?:\.\w+)*)\s*\}\}/g;

/** Every distinct {{tag}} in a body, in first-appearance order. */
export function tagsIn(text) {
  const out = [];
  const seen = new Set();
  const src = String(text == null ? "" : text);
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
  }
  return out;
}

/* YYYY-MM-DD in UTC. Deliberately not the server's local date: a contract dated
   by whichever region the function happened to run in is a document whose date
   changes depending on infrastructure. UTC is arbitrary but it is stable, and
   it is what timestamptz columns are compared against everywhere else here. */
export const isoDate = (at = new Date()) => new Date(at).toISOString().slice(0, 10);

/**
 * clientContext — the `contact` namespace, read from the client record.
 *
 * DUPLICATED FROM src/workflows/messaging.mjs ON PURPOSE, and recorded as such
 * in docs/CONTRACTS-SPEC.md §4. The original is a module-private function inside
 * a live send path; extracting it would edit code this task has no business
 * touching (CLAUDE.md §8, scope discipline). Same SQL, same shape. If one grows
 * a field, the other needs it.
 */
export async function clientContext(db, clientId) {
  if (!clientId) return {};
  const r = await db.query(
    `SELECT first_name, last_name, email, phone, custom_fields
       FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  const c = r.rows[0];
  if (!c) return {};
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
  return {
    contact: {
      ...(c.custom_fields || {}),
      first_name: c.first_name ?? null,
      last_name: c.last_name ?? null,
      name: fullName,
      full_name: fullName,
      email: c.email ?? null,
      phone: c.phone ?? null
    }
  };
}

/**
 * mergeContext — everything {{tags}} may resolve against.
 *
 * `values` is what the staff member typed into the manual blanks. It is put on
 * `field` and NOWHERE ELSE: a manual value must never be able to overwrite
 * `contact.email`, or a sender could quietly change who a contract appears to be
 * addressed to without touching the client record.
 */
export function mergeContext({ contact = null, values = {}, at = new Date() } = {}) {
  const field = {};
  for (const [k, v] of Object.entries(values || {})) {
    // Objects and arrays stringify to "[object Object]" — renderTemplate refuses
    // non-scalars and renders blank, but normalising here keeps the preview and
    // the sent document identical rather than relying on that.
    field[k] = v == null ? "" : (typeof v === "object" ? "" : String(v));
  }
  return { contact: contact || {}, field, today: isoDate(at) };
}

/** renderContract — the finished words. No braces survive into a sent document. */
export function renderContract(body, context) {
  return renderTemplate(body, context);
}

/**
 * missingTags — which {{tags}} in this body resolve to nothing.
 *
 * Returns [{ tag, reason }]. `reason` is written for a staff member reading the
 * preview screen, not for a developer:
 *   "blank"   — the tag is a real one and this client simply has no value
 *   "unknown" — nothing supplies a tag by this name under any namespace
 *
 * The distinction matters. A blank {{contact.phone}} means "fill in the client
 * record"; an unknown {{clint.phone}} means "there is a typo in the template".
 * Telling somebody the second when it is the first sends them looking in the
 * wrong place.
 */
export function missingTags(body, context) {
  const ctx = context || {};
  const out = [];
  for (const tag of tagsIn(body)) {
    if (tag === "today") continue;
    const [head, ...rest] = tag.split(".");
    if (head !== "contact" && head !== "field") {
      out.push({ tag, reason: "unknown" });
      continue;
    }
    const bag = ctx[head] || {};
    const key = rest.join(".");
    if (!key) { out.push({ tag, reason: "unknown" }); continue; }
    const has = Object.prototype.hasOwnProperty.call(bag, key);
    const val = has ? bag[key] : undefined;
    if (!has) out.push({ tag, reason: "unknown" });
    else if (val == null || String(val).trim() === "") out.push({ tag, reason: "blank" });
  }
  return out;
}

/**
 * normaliseManualFields — what a template's `manual_fields` column may hold.
 *
 * Validated HERE rather than by a CHECK constraint, because a constraint strict
 * enough to police object keys would make adding a field property a migration
 * (117_contracts.sql says so at the column). Returns a clean array; throws on a
 * shape the screen could not render.
 */
export function normaliseManualFields(raw) {
  if (raw == null) return [];
  const list = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(list)) throw new Error("manual_fields must be an array");
  const seen = new Set();
  return list.map((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`manual_fields[${i}] must be an object`);
    }
    const key = String(item.key ?? "").trim();
    // Same character class the merge tag pattern accepts. A key with a dot or a
    // space in it produces a {{field.x y}} nothing can ever resolve.
    if (!/^\w+$/.test(key)) {
      throw new Error(
        `manual_fields[${i}].key "${key}" — a blank's short name may only use ` +
        `letters, numbers and underscores`);
    }
    if (seen.has(key)) throw new Error(`manual_fields: "${key}" is listed twice`);
    seen.add(key);
    return {
      key,
      label: String(item.label ?? key).trim() || key,
      required: item.required === true,
      help: item.help == null ? null : String(item.help)
    };
  });
}

/**
 * missingRequired — which required blanks the staff member left empty.
 * Returned as labels, because the person reading it is looking at a form with
 * labels on it, not at column names.
 */
export function missingRequired(fields, values = {}) {
  return normaliseManualFields(fields)
    .filter((f) => f.required)
    .filter((f) => {
      const v = values ? values[f.key] : undefined;
      return v == null || String(v).trim() === "";
    })
    .map((f) => f.label);
}
