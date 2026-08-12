# Fixed paper grid (marketing site)

Separate from RUN4 / W4a.

## Task list

| unit | owner | status |
|------|-------|--------|
| Fixed paper grid on marketing pages | this session | done |

## Change manifest

**Files**
- `public/index.html`
- `public/affiliates/index.html`
- `public/education/index.html`
- `public/terms/index.html`
- `public/privacy/index.html`
- `public/education/terms/index.html`
- `public/education/privacy/index.html`
- `public/education/refund/index.html`
- `public/404.html`

**Change**
- `body::before` fixed paper grid (`#FCFCFC`, 44px `rgba(10,10,10,.048)`).
- `html`/`body` background transparent so the fixed layer is the only page-grid paint.

**Shipped** live on fundhub.ai; W4a smoke artifacts deleted from `public/`.
