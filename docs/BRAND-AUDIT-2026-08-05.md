# Brand audit — 2026-08-05

Method: every file under `public/` checked against `fundhub-brand.css` and
`docs/BRAND-THEMING-SPEC.md`. Read-only. No app was run — this is a code-truth
audit of colors, fonts and tokens, not a visual design review.

Scope: 52 HTML pages, 4 stylesheets, `shell.js`.

Verdict: **the brand is mostly right. Fonts are perfect. Two whole pages are on
a different brand, and the legal pages are on a warm off-palette.**

Owner decision 2026-08-05: **Fundhub is not rebranding.** Findings that only
bite under a rebrand are closed or downgraded below — see 3 and 6.

---

## What is clean

| Check | Result |
|---|---|
| Fonts | **Pass.** Only Inter and JetBrains Mono anywhere. Zero foreign fonts. |
| `shell.js` rebrand logic | **Pass.** Applies `/api/org-brand` and maps ramp stops 0→`--alert`, 1→`--warn`, 3→`--ok`, 4→`--info`, 5→`--accent` — exactly as the spec table says. |
| `public/fh.css` | **Pass.** Faithful copy of the tokens, status colors included. The sign-in pages that use it are on-brand. |
| Named CSS colors (`red`, `blue`…) | **Pass.** None found. |

---

## Findings

### 1. `public/dashboard.html` is a different product — HIGH

485 lines. Dark navy theme. Not one Fundhub color in it.

```
--bg:#0d0f14   --surface:#161a22   --accent:#4f7ef8   (blue)
--accent2:#34d399 (emerald)   --warn:#f59e0b   --danger:#ef4444
```

Brand says paper `#FCFCFC`, ink `#0A0A0A`, status colors from the pastel ramp.
This page shares none of it. It is a generic dark admin template.

Nothing links to it. But `publish = "public"` in `netlify.toml` means it is
live at `/dashboard.html` for anyone who types the URL.

### 2. `public/crm.html` is the whole old CRM, still published — HIGH

20,596 lines. **21 `<title>` tags, 20 `<!doctype>` declarations, 21 `<body>`
tags.** It is twenty-one complete HTML pages concatenated into one file — a
stale copy of every CRM screen that now lives properly in `public/app/`.

Titles inside it include Command Center, Pipeline, Closer Dashboard, Brand
Studio, Client Portal, Ops & Admin, Galaxy, Messaging, Documents.

It carries 78 off-palette gray references plus Tailwind default colors. It is
live at `/crm.html`. It was last edited **2026-08-02** — three days ago — so it
is still being maintained in parallel with the real app and drifting from it.

### 3. Rebrand bug: five colors will not change — CLOSED, owner decision 2026-08-05

**Owner-set: Fundhub is not rebranding.** This finding is closed. The tokens
below only diverge when the brand changes, and it is not changing. They are
doing a real job — readable dark text on the pastel chips — and their values
look correct against the ramp. No action.

Recorded for the record only:

Six live app pages invent their own color tokens:

```
--red:#6E2A22   --green:#2C5138   --amber:#6B4A12
--purple:#3F2F63   --blue:#22415F
```

Files: `automations.html`, `client-control-panel.html`, `client-portal.html`,
`consent-capture.html`, `inquiry-remover.html`, `ops-admin.html`
(plus `crm.html`).

`shell.js` never sets these — zero `setProperty` calls for any of them. Under a
rebrand those five would stay Fundhub's originals while everything else moved.
Not a live problem: no rebrand is planned.

They fill a real gap the spec does not cover — dark text that stays readable on
the pastel chips (used 209 times as `color:`). Worth naming in the spec if
anyone documents it, but nothing is broken today.

### 4. Legal pages use a warm off-palette — MEDIUM

`public/terms/index.html` and `public/privacy/index.html`:

| Token | These pages | Brand | Difference |
|---|---|---|---|
| background | `#FBFAF7` | `#FCFCFC` | warm cream vs neutral |
| ink | `#15181D` | `#0A0A0A` | lighter, blue-tinted |
| line | `#E6E3DC` | `#E4E4E7` | warm vs cool |
| muted | `#565C66` | `#52525B` | different gray |

They also rename `--accent` to mean black (`#0A0A0A`), while brand `--accent` is
lavender `#C4B3E5`. Same token name, opposite meaning.

`public/contract.html` has `--paper:#FAFAF9` instead of `#FCFCFC`.

These are the "little things" — close enough to look intentional, wrong enough
to read as a slightly different site next to the real one.

### 5. Marketing pages have no status colors — MEDIUM

`index.html`, `affiliates/index.html`, `education/index.html` and `404.html`
inline the brand tokens with **correct values**, but omit `--ok`, `--warn`,
`--alert`, `--info` and `--accent` entirely. Any status chip on those pages
falls back to browser defaults.

### 6. The brand is defined in 23 places — LOW (downgraded, no rebrand planned)

Nothing is broken today: the three `fundhub-brand.css` copies are byte-identical
and `fh.css` matches them. With no rebrand coming, this is a slow drift risk
rather than a bug — it bites only when someone edits one copy and not the rest.

Files that declare `--spectrum` themselves:

- `fundhub-brand.css`, `public/app/fundhub-brand.css`, `wireframes/fundhub-brand.css` — **byte-identical today** (same MD5). They will not stay that way.
- `public/fh.css`
- Inlined in: `public/index.html`, `affiliates/index.html`, `education/index.html`, `education/privacy`, `education/refund`, `education/terms`, `privacy/index.html`, `terms/index.html`, `404.html`, `crm.html`
- Inside `public/app/`: `closer-call.html`, `journeys.html`, `my-numbers.html`, `sales-floor.html` — these are overridden by `shell.js` at runtime, so they are dead weight rather than broken
- Also `dist/fundhub-frontend.html`, `scripts/artifact-shell.html`, 3 files in `docs/designs/sales-dashboards/`

There is no single source of truth for the brand.

### 7. Font weights are requested inconsistently — LOW

Four different Inter weight sets across pages:

```
wght@400;500;600
wght@400;500;600;700
wght@400;500;600;700;800
wght@400;600;700
```

A page that loads `400;500;600` and then styles something `font-weight:700`
gets a browser-faked bold, which looks heavier and blurrier than real Inter
Bold. Same story for JetBrains Mono (5 variants).

### 8. `public/app/sidebar.fragment.html` is dead — LOW

68 lines. Nothing references it at runtime; `shell.js` carries the sidebar
markup inline in its `SIDEBAR_HTML` constant. It is a second copy of the
navigation that will drift.

---

## Off-palette color counts

Ranked, across all of `public/`:

| Hex | Uses | What it is |
|---|---|---|
| `#161619` | 100 | dark surface, near-miss on `--card:#111113` |
| `#71717A` | 85 | Tailwind zinc-500 |
| `#6E2A22` | 80 | dark coral (see finding 3) |
| `#3F3F46` | 66 | Tailwind zinc-700 |
| `#6B4A12` | 57 | dark amber (see finding 3) |
| `#27272A` | 51 | Tailwind zinc-800 |
| `#2C5138` | 49 | dark sage (see finding 3) |
| `#3F2F63` | 42 | dark lavender (see finding 3) |
| `#22415F` | 39 | dark blue (see finding 3) |
| `#D4D4D8` | 24 | Tailwind zinc-300 |

The Tailwind zinc family (`71717A`, `3F3F46`, `27272A`, `D4D4D8`, `EFEFF1`) is
a second gray scale living alongside the brand's own (`52525B`, `A1A1AA`,
`E4E4E7`, `F4F4F5`). Heaviest in `crm.html` (78 uses).

---

## Not covered

- **No visual review.** The app was not run. Spacing, layout, hierarchy and
  whether a screen *looks* right are untested. This audit only proves which
  colors and fonts are declared, not how they render.
- **Dark-mode behaviour** was not assessed.
- **Accessibility contrast ratios** were not measured.
