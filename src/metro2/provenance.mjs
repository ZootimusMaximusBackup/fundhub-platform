// Provenance — the difference between "the furnisher left this blank" and
// "this report format does not show us the field."
//
// THIS IS THE MOST IMPORTANT FILE IN src/metro2/. Everything else is
// arithmetic and lookups; this is the thing that stops the engine claiming a
// violation that may not exist.
//
// A Metro 2 field arriving here is one of exactly three things:
//
//   observed     We can see the field and it has a value.
//   absent       We can see the field and it is empty. This is reportable —
//                "no Original Creditor on a collection account" is a violation.
//   not_visible  The source report never carries this field at all. This is
//                NOT reportable. It is a limit on what we know, not a defect
//                in what the furnisher did.
//
// Conflating `absent` and `not_visible` is how this system would produce a
// letter claiming Field 25 DOFD is missing when the truth is that a soft-pull
// consumer report simply never exposes Field 25. That letter is worse than no
// letter: it hands the bureau a frivolous-determination argument and burns the
// consumer's 30-day clock.
//
// So: rules fire on `observed` and `absent`. Rules NEVER fire on
// `not_visible`. There is no override and no default that lets a caller skip
// the distinction — `observed()` throws on an empty value rather than let a
// null slip through wearing an "observed" label.
//
// Pure. No I/O, no clock.

export const OBSERVED = "observed";
export const ABSENT = "absent";
export const NOT_VISIBLE = "not_visible";

export const PROVENANCES = Object.freeze([OBSERVED, ABSENT, NOT_VISIBLE]);

/**
 * A field we can see, carrying a value.
 * Throws on null/undefined/"" — an empty observed value is a contradiction in
 * terms, and the caller means `absent()`.
 */
export function observed(value) {
  if (value === null || value === undefined || value === "") {
    throw new TypeError("observed(): empty value — use absent() instead");
  }
  return Object.freeze({ value, provenance: OBSERVED });
}

/** A field we can see, which the furnisher left empty. Reportable. */
export function absent() {
  return Object.freeze({ value: null, provenance: ABSENT });
}

/** A field this report format does not carry. Never reportable. */
export function notVisible() {
  return Object.freeze({ value: null, provenance: NOT_VISIBLE });
}

/** Is this a well-formed provenance-wrapped field? */
export function isField(field) {
  return Boolean(
    field &&
    typeof field === "object" &&
    !Array.isArray(field) &&
    PROVENANCES.includes(field.provenance) &&
    "value" in field
  );
}

/**
 * Can a rule look at this field at all?
 *
 * An unwrapped or malformed value answers `false`. That is deliberate: a rule
 * handed a bare string instead of a wrapper has lost the provenance, and a
 * rule that cannot tell `absent` from `not_visible` must not fire. Silence is
 * the safe failure here.
 */
export function isVisible(field) {
  return isField(field) && field.provenance !== NOT_VISIBLE;
}

/** Visible AND populated. */
export function isObserved(field) {
  return isField(field) && field.provenance === OBSERVED && field.value !== null && field.value !== undefined;
}

/** Visible AND empty. The reportable kind of missing. */
export function isAbsent(field) {
  return isField(field) && field.provenance === ABSENT;
}

/** Explicitly outside what we can know. */
export function isNotVisible(field) {
  return isField(field) && field.provenance === NOT_VISIBLE;
}

/** The value, or null for anything that is not an observed value. */
export function valueOf(field) {
  return isObserved(field) ? field.value : null;
}

/**
 * True when every listed field is visible (observed or absent).
 *
 * Every rule's first line. A rule that cannot see one of its inputs returns
 * null — it does not guess, and it does not treat "cannot see" as "clean".
 */
export function allVisible(...fields) {
  return fields.every((f) => isVisible(f));
}

/** True when every listed field is observed with a value. */
export function allObserved(...fields) {
  return fields.every((f) => isObserved(f));
}

/**
 * Wrap a raw value read out of a source payload.
 * A found value is `observed`; a missing one is `absent`. Use this only where
 * the source format is known to carry the field — if it does not, the caller
 * wants notVisible() and the difference is the whole point of this module.
 */
export function fromRaw(value) {
  if (value === null || value === undefined || value === "") return absent();
  return observed(value);
}
