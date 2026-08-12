# Fixed dark grid (marketing hero/CTA)

## Scope (owner-set)

Homepage, education, affiliates only.

Grid lived on the **dark** bands only (hero + CTA) — not the light paper sections.

## Change

- One fixed `body::before` layer: ink `#0A0A0A`, 56px `rgba(255,255,255,.035)` lines.
- `.hero` / `.cta-band` backgrounds transparent so that layer shows through.
- Light `section.blk` opaque paper; footer / `.blk.dark` stay solid ink (no grid).
- Removed scrolling `.hero::before` / `.cta-band::before` paints.
