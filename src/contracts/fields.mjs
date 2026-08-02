// src/contracts/fields.mjs — the boxes on the page.
//
// A field is one box placed on one page of an uploaded PDF, belonging to one
// signer. This module owns three things and nothing else:
//
//   normaliseFields()  what a valid field is, checked once, at the door
//   applyAutoFill()    the boxes the CRM already knows the answer to
//   fieldsForSigner()  what one person is actually asked to fill in
//
// ── POSITIONS ARE FRACTIONS OF THE PAGE ─────────────────────────────────────
// x, y, w, h are all between 0 and 1, measured from the TOP LEFT. Never pixels.
// A pixel position only means something at the screen width and zoom level it
// was recorded at, so the same box would land somewhere else on a laptop, on a
// phone, and in the finished PDF. The conversion to PDF points lives in exactly
// one place, boxToPoints() in src/contracts/pdf.mjs.
//
// ── WHERE A VALUE COMES FROM ────────────────────────────────────────────────
// `source` decides who fills a box, and it is the difference between this being
// a signing service and being a form:
//
//   contact.*   the CLIENT RECORD fills it, before the client ever sees it.
//               Name, email, phone, and the 252 ported CRM fields. The client
//               is not asked to re-type what the CRM already knows.
//   today       the date it was sent.
//   signer.*    that signer's own name or email as entered by the sender.
//   manual      the signer types it.
//
// Auto-filled boxes are locked on the signing page. Letting somebody edit the
// address the CRM holds, inside a contract, without that edit reaching the
// client record, produces a signed document that disagrees with the file it
// came from and nothing anywhere records which one is right.

import { badRequest } from "./errors.mjs";

export const FIELD_TYPES = Object.freeze(["text", "date", "checkbox", "signature", "initials"]);

/* The types a signer physically performs. A contract whose signer has no box of
   one of these has nowhere to sign, which send() refuses — a document nobody
   can sign is the single most embarrassing thing to put in front of a client. */
export const SIGNING_TYPES = Object.freeze(["signature", "initials"]);

export const FIELD_SOURCES = Object.freeze(["manual", "today", "signer.name", "signer.email"]);

const num = (v) => (typeof v === "number" ? v : Number(v));
const inUnit = (v) => Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * normaliseFields — validate and clean the boxes a template carries.
 *
 * Throws on anything the editor or the flattener could not honour. Cleaning
 * here rather than at each use site means the flattener never has to defend
 * itself against a field with a negative width.
 */
export function normaliseFields(raw, { pageCount = null, signerCount = null } = {}) {
  if (raw == null) return [];
  const list = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(list)) throw badRequest("The boxes on the page are stored wrongly.", "fields_not_array");

  const seen = new Set();
  return list.map((f, i) => {
    if (!f || typeof f !== "object" || Array.isArray(f)) {
      throw badRequest(`Box ${i + 1} is stored wrongly.`, "field_not_object");
    }
    const id = String(f.id ?? `f${i + 1}`).trim() || `f${i + 1}`;
    if (seen.has(id)) throw badRequest(`Two boxes share the name "${id}".`, "duplicate_field_id");
    seen.add(id);

    const type = String(f.type ?? "text").trim();
    if (!FIELD_TYPES.includes(type)) {
      throw badRequest(
        `Box "${id}" is a kind we do not have (${type}). Use one of: ${FIELD_TYPES.join(", ")}.`,
        "unknown_field_type");
    }

    const page = Math.trunc(num(f.page ?? 0));
    if (!Number.isFinite(page) || page < 0) {
      throw badRequest(`Box "${id}" is on no page.`, "field_bad_page");
    }
    if (pageCount != null && page >= pageCount) {
      throw badRequest(
        `Box "${id}" is on page ${page + 1}, but this document only has ${pageCount}.`,
        "field_page_out_of_range");
    }

    const x = num(f.x), y = num(f.y), w = num(f.w), h = num(f.h);
    for (const [k, v] of [["x", x], ["y", y], ["w", w], ["h", h]]) {
      if (!inUnit(v)) {
        throw badRequest(
          `Box "${id}" is positioned outside the page (${k} = ${f[k]}). ` +
          "Positions are a fraction of the page, between 0 and 1.",
          "field_out_of_page");
      }
    }
    if (w <= 0 || h <= 0) throw badRequest(`Box "${id}" has no size.`, "field_no_size");
    /* A box that starts inside the page and runs off the edge is a box whose
       contents are half-printed on a signed contract. Caught here, where the
       person who dragged it can still move it. */
    if (x + w > 1.0001 || y + h > 1.0001) {
      throw badRequest(`Box "${id}" hangs off the edge of the page. Move it back on.`, "field_off_page");
    }

    const signer = Math.trunc(num(f.signer ?? 0));
    if (!Number.isFinite(signer) || signer < 0) {
      throw badRequest(`Box "${id}" is not assigned to anybody.`, "field_no_signer");
    }
    if (signerCount != null && signer >= signerCount) {
      throw badRequest(
        `Box "${id}" is assigned to signer ${signer + 1}, but this contract only has ${signerCount}.`,
        "field_signer_out_of_range");
    }

    const source = String(f.source ?? "manual").trim() || "manual";
    if (!FIELD_SOURCES.includes(source) && !source.startsWith("contact.")) {
      throw badRequest(
        `Box "${id}" is filled from something that does not exist (${source}).`,
        "field_unknown_source");
    }
    /* A signature is the one thing that cannot be filled in for somebody. If a
       box could be both auto-filled AND a signature, the CRM would be typing a
       person's signature on their behalf, which is not a signature at all. */
    if (SIGNING_TYPES.includes(type) && source !== "manual") {
      throw badRequest(
        `Box "${id}" is a signature, so it has to be filled in by the person signing.`,
        "signature_must_be_manual");
    }

    return {
      id, page, type, signer, source,
      x, y, w, h,
      label: String(f.label ?? "").trim() || defaultLabel(type),
      required: f.required !== false,
      value: f.value == null ? "" : String(f.value)
    };
  });
}

const defaultLabel = (type) => ({
  text: "Text", date: "Date", checkbox: "Tick box",
  signature: "Signature", initials: "Initials"
}[type] || "Field");

/**
 * applyAutoFill — fill in everything the CRM already knows.
 *
 * Runs at SEND, so the values are frozen into the contract with everything else
 * rather than being resolved live while somebody is reading the document. A
 * value that could change between opening the page and signing it is a value
 * that is not part of what was agreed.
 */
export function applyAutoFill(fields, { contact = {}, signers = [], today = null } = {}) {
  const date = today || new Date().toISOString().slice(0, 10);
  return fields.map((f) => {
    if (f.source === "manual") return { ...f };
    if (f.source === "today") return { ...f, value: date };
    if (f.source === "signer.name" || f.source === "signer.email") {
      const s = signers[f.signer] || {};
      const v = f.source === "signer.name" ? s.name : s.email;
      return { ...f, value: v == null ? "" : String(v) };
    }
    // contact.<path> — the same namespace the {{merge tags}} use, resolved the
    // same way, so a person who has learned one has learned both.
    const path = f.source.slice("contact.".length);
    let cur = contact;
    for (const seg of path.split(".")) {
      if (cur == null || typeof cur !== "object") { cur = undefined; break; }
      cur = cur[seg];
    }
    return { ...f, value: cur == null || typeof cur === "object" ? "" : String(cur) };
  });
}

/** fieldsForSigner — the boxes one person is shown. Never anybody else's. */
export function fieldsForSigner(fields, signerIndex) {
  return (fields || []).filter((f) => Number(f.signer) === Number(signerIndex));
}

/** Which boxes that person still has to fill in themselves. */
export function openFieldsForSigner(fields, signerIndex) {
  return fieldsForSigner(fields, signerIndex).filter((f) => f.source === "manual");
}

/**
 * missingForSigner — required boxes this person left empty. Labels, not ids:
 * the person reading it is looking at a form with labels on it.
 */
export function missingForSigner(fields, signerIndex, values = {}) {
  return openFieldsForSigner(fields, signerIndex)
    .filter((f) => f.required)
    /* Signature and initials boxes are NOT asked for separately. The typed name
       IS the signature, and sign() writes it into every signature box that
       person owns. Demanding a value for them as well would mean typing your
       name twice to sign once — and the second box would be a place to type a
       DIFFERENT name, which is worse than an inconvenience. */
    .filter((f) => !SIGNING_TYPES.includes(f.type))
    .filter((f) => {
      const v = Object.prototype.hasOwnProperty.call(values, f.id) ? values[f.id] : f.value;
      if (f.type === "checkbox") return !(v === true || v === "true" || v === "on" || v === "1");
      return v == null || String(v).trim() === "";
    })
    .map((f) => f.label);
}

/**
 * mergeSignerValues — fold one signer's entries into the field list.
 *
 * A signer may only write to boxes that are BOTH theirs AND manual. Anything
 * else in the payload is dropped without comment — a client posting
 * `{"f9":"$0"}` for the fee box that belongs to the sender must not be able to
 * change it, and telling them which ids exist would only help them try again.
 */
export function mergeSignerValues(fields, signerIndex, values = {}) {
  const allowed = new Set(openFieldsForSigner(fields, signerIndex).map((f) => f.id));
  return (fields || []).map((f) => {
    if (!allowed.has(f.id)) return { ...f };
    if (!Object.prototype.hasOwnProperty.call(values, f.id)) return { ...f };
    const raw = values[f.id];
    if (f.type === "checkbox") {
      return { ...f, value: (raw === true || raw === "true" || raw === "on" || raw === "1") ? "true" : "" };
    }
    return { ...f, value: raw == null ? "" : String(raw).slice(0, 500) };
  });
}

/**
 * assertSignable — every signer has somewhere to sign.
 *
 * Called by send(). A PDF contract where signer 2 has no signature box is a
 * document that person can open, read, and not be able to complete — and the
 * only way anybody finds out is the client saying so.
 */
export function assertSignable(fields, signerCount) {
  for (let i = 0; i < signerCount; i++) {
    const mine = fieldsForSigner(fields, i);
    if (!mine.some((f) => SIGNING_TYPES.includes(f.type))) {
      throw badRequest(
        `Signer ${i + 1} has nowhere to sign. Put a signature box on the page for them.`,
        "signer_has_no_signature_box");
    }
  }
  return true;
}
