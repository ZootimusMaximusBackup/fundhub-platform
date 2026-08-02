# Brand theming — two lanes

Owner decision, 2026-08-02. Recorded before the CRM theming build.

## Decision

**Partners theme only their own funnels. The internal CRM has its own theme.**

Not one brand everywhere. A partner editing Brand Studio must never change how Fundhub staff see the CRM.

## Why this, not one brand

The code already separates the two:

- Partner tokens live in `partner_brand`, keyed by `partner_id`.
- Staff sessions have no `partner_id`. `shell.js` used to skip brand apply for them and leave `fundhub-brand.css` alone.
- Hosted partner funnels are still deferred; partner tokens are for that surface when it lands.

Putting partner tokens on the CRM would make every partner edit recolor the company tools. That is wrong for Fundhub.

## Two lanes

| Lane | Store | Who edits | What it themes |
|---|---|---|---|
| **Org / CRM** | `org_brand` (one row per org) | Owner / admin | Every internal CRM screen — colors, fonts, logo |
| **Partner / funnel** | `partner_brand` (one row per partner) | Owning partner, or owner/admin | That partner's white-label funnels only |

## Token shape (both lanes)

Same anchors both places:

- `ink`, `paper` — text and page background (`#rrggbb`)
- `ramp` — exactly six hex stops, or empty (builds `--spectrum`)
- `display_face`, `mono_face` — Google Fonts family names only
- `wordmark_url` — logo URL (`https:` or `data:image/…`)

Org lane also carries `entity_name` for the CRM chrome chip. Partner lane keeps its funnel fields (domain, selected funnels, voice, approval) unchanged.

## How the CRM gets themed

1. Brand Studio (staff, no `partner_id`) loads and saves `/api/org-brand`.
2. Live preview writes the real CRM CSS variables on the page (`--ink`, `--paper`, `--spectrum`, `--sans`, `--mono`, `--logo`), so the sidebar and chrome update as you type.
3. `shell.js` fetches `/api/org-brand` on every signed-in app screen and applies the same variables. Fallback is the static `fundhub-brand.css` defaults — a failed fetch leaves the page looking like Fundhub.

## What does not change

- Partner Brand Studio (`?partner_id=` or a partner session) still edits `partner_brand`. Its funnel preview uses `--p-*` vars only. It does **not** write CRM chrome variables for staff.
- `partner_brand` approval / domain / funnel selection stay as they are.
- Creative Factory `brand_kits` stay a separate system for ads.

## Status colors

When a six-stop ramp is set, status tokens follow the Fundhub stop order:

| Stop | Token |
|---|---|
| 0 | `--alert` |
| 1 | `--warn` |
| 3 | `--ok` |
| 4 | `--info` |
| 5 | `--accent` |

Empty ramp leaves status colors at the CSS defaults.
