# Fixed dark grid (hero + CTA only)

## Scope (owner-set)

Homepage, education, affiliates.

**Only** the black hero and black CTA bands. Not header, footer, buttons, or light sections.

## Change

- Grid painted on `.hero` and `.cta-band` with `background-attachment: fixed`
- No `body::before` page grid
- Body stays paper; footer / other dark blocks unchanged
