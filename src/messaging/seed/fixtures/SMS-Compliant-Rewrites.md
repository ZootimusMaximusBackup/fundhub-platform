# FIXTURE — shaped like fundhub-docs/sources/SMS-Compliant-Rewrites.md

Not real copy. Exercises both section shapes plus the edge cases the parser has
to survive: a Before/After pair, a multi-line body, and an empty body.

---

## A. Reworded (had restricted terms) — 2

### SMS-FIX-01-REWORDED
**Before:**
> Old wording that must never be seeded.

**After:**
> Hey {{contact.first_name}}, line one.
> Line two with {{custom_values.booking_link}}. Reply STOP to opt out.

### SMS-FIX-02-AFTER-ONLY
**After:**
> Single line body. Reply STOP to opt out.

---

## B. Clean wording — just add opt-out — 2

### SMS-CLEAN-01-NO-MARKER
> Body sits directly under the header. Reply STOP to opt out.

### SMS-BROKEN-01-EMPTY
_Someone deleted the blockquote._

---

**Note:** trailing prose that belongs to no template.
