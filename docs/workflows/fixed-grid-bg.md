# Fixed paper grid (marketing site)

Separate from RUN4 / W4a.

## Task list

| unit | owner | status |
|------|-------|--------|
| Fixed paper grid on marketing pages | this session | done |

## Scope (owner-set)

Fixed paper grid **only** on pages that already show the grid:
- `public/index.html` (homepage)
- `public/education/index.html`
- `public/affiliates/index.html`

**Not** on legal pages or 404.

## Change manifest

**Keep fixed `body::before` paper grid** (`#FCFCFC`, 44px `rgba(10,10,10,.048)`):
- homepage, education, affiliates

**No page grid** (solid paper/bg as before):
- terms, privacy, education legal/refund, 404
