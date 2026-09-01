# Brand theming — two lanes

Owner decision, **2026-08-31**. This replaces the 2026-08-02 decision, which is kept below so nobody re-reads it as current.

## Decision

**A white-label partner sees their own brand everywhere — including every internal CRM screen.**

Everyone else — Fundhub staff, affiliates, clients — sees the org brand, exactly as before.

There are still two *stores*. What changed is which store a CRM screen paints from, and that now depends on **who is signed in**, not on which screen it is.

## What this replaced, and why it was reversed

> **Superseded — the decision from 2026-08-02 to 2026-08-31.** "Partners theme only their own funnels. The internal CRM has its own theme. A partner editing Brand Studio must never change how Fundhub staff see the CRM." Its reasoning: partner tokens live in `partner_brand`, staff sessions had no partner, and putting partner tokens on the CRM would make every partner edit recolor the company tools.

That reasoning was right about the risk and wrong about the outcome. A white-label partner signed in and saw Fundhub's colours, fonts and wordmark on every screen. That is the one thing white-label is sold to prevent.

The half of the old rule that survives, unchanged: **a partner still cannot recolor a Fundhub staff screen.** They write `partner_brand`; staff paint from `org_brand`; a partner cannot write `org_brand`.

## How both are true at once — resolve from the principal

`/api/org-brand` answers with the brand of **the caller**, not of the caller's org:

| Who is asking | What they get | Read from |
|---|---|---|
| **partner** | their own brand | `v_partner_brand_effective`, keyed by the partner id **on the session** |
| staff | the org brand | `v_org_brand_effective` |
| affiliate | the org brand | `v_org_brand_effective` |
| client | the org brand | `v_org_brand_effective` |

`public/app/shell.js` did not change to make this work. It fetches `/api/org-brand` on every signed-in app screen and paints whatever comes back.

### Two approaches that were rejected

* **Give each partner their own org.** Every fulfilment read binds `org_id = staff.org_id`. Moving partner clients into partner orgs would stop Fundhub staff seeing partner clients. That is an outage, not an upgrade.
* **Rewrite `v_org_brand_effective`.** Every partner sits in the shared default org (`api/public/partner-apply.mjs` uses `resolveDefaultOrg`), so an org-keyed lookup returns one answer for all partners.

### Fallbacks — it fails closed to the org brand

No partner id on the session, no `partners` row, no `partner_brand` row, or a partner whose org does not match the session's: all fall through to the org read. There is no half-painted state.

`v_partner_brand_effective` LEFT JOINs `partner_brand` and fills `ink`/`paper` with hardcoded Fundhub values, so it looks like a full answer even for a partner with no row at all. The endpoint therefore tests for the row itself (`EXISTS`) rather than trusting the view to say "nothing here".

### No preview parameter

The partner id is bound from the session and nowhere else. There is no `?partner_id=` on this endpoint. Staff who need to see a partner's tokens use `/api/partner-brand`, which already gates that read.

## Two lanes (the stores)

| Lane | Store | Who edits | What it themes |
|---|---|---|---|
| **Org / CRM** | `org_brand` (one row per org) | Owner / admin staff | CRM screens for staff, affiliates and clients — colors, fonts, logo |
| **Partner** | `partner_brand` (one row per partner) | Owning partner, or owner/admin | That partner's white-label funnels **and that partner's own CRM screens** |

## Token shape (both lanes)

Same anchors both places:

- `ink`, `paper` — text and page background (`#rrggbb`)
- `ramp` — exactly six hex stops, or empty (builds `--spectrum` and `--accent`)
- `display_face`, `mono_face` — Google Fonts family names only
- `wordmark_url` — logo URL (`https:` or `data:image/…`)

Org lane also carries `entity_name` for the CRM chrome chip. Partner lane keeps its funnel fields (domain, selected funnels, voice, approval) unchanged.

## The wordmark waits for approval. Colours and type do not.

`partner_brand.approval_status` is `draft` / `review` / `approved`. **`v_partner_brand_effective` ignores it completely** — it returns the tokens whatever the state — so the gate lives in `api/org-brand.mjs`, on one field:

| Field | Painted on the CRM before approval? |
|---|---|
| `ink`, `paper`, `ramp`, `display_face`, `mono_face`, `entity_name` | **Yes** |
| `wordmark_url` | **No** — only at `approval_status = 'approved'` |

Why the split: colours and a typeface on a partner's own screens harm nobody and an edit undoes them. A wordmark is an image, and an image can carry someone else's registered trademark. Painting an unreviewed one into Fundhub-hosted chrome is the one part of this that is not the partner's own risk to take. Before approval the Fundhub default logo stays — which is exactly what the partner saw before any of this.

## How the CRM gets themed

1. Brand Studio (staff, no `partner_id`) loads and saves `/api/org-brand`. Brand Studio (a partner, or `?partner_id=`) loads and saves `/api/partner-brand`.
2. Live preview writes the real CRM CSS variables on the page (`--ink`, `--paper`, `--spectrum`, `--sans`, `--mono`, `--logo`), so the sidebar and chrome update as you type.
3. `shell.js` fetches `/api/org-brand` on every signed-in app screen and applies the same variables. Fallback is the static `fundhub-brand.css` defaults — a failed fetch leaves the page looking like Fundhub.

## What does not change

- `partner_brand` approval / domain / funnel selection stay as they are.
- The partner funnel preview in Brand Studio still uses `--p-*` vars only.
- Creative Factory `brand_kits` stay a separate system for ads.
- `org_brand` is still writable by owner/admin staff only, and only for their own org.

## Status colors — brand-driven no more

**`--alert`, `--warn`, `--ok` and `--info` are NEVER overwritten by a brand.** They keep their `fundhub-brand.css` values for everybody, partner and staff alike.

> **Superseded — the rule from 2026-08-02 to 2026-08-31.** "When a six-stop ramp is set, status tokens follow the Fundhub stop order: stop 0 → `--alert`, 1 → `--warn`, 3 → `--ok`, 4 → `--info`, 5 → `--accent`."

Those four tokens are read in **374 places across 43 files** under `public/` (measured 2026-08-31, `grep -roE 'var\(--(alert|warn|ok|info)[,)]' public/`), and every one is a state signal — blocked, behind, healthy — in a regulated consumer-finance product. Nothing constrains a brand ramp to semantically sane stops, and a real brand guideline is very often a single-hue gradient. That ramp painted stop 0, 1, 3 and 4 as four shades of one colour, so "blocked" and "healthy" rendered identically. It had already happened once on a test tenant, whose screens went entirely blue.

While only Fundhub's own sensibly-chosen ramp reached the CRM this was theoretical. Partners paint the CRM now, and it would land on the partner's own staff, who have nobody to walk around it.

A brand is carried by ground, ink, logo and type. Nobody experiences a brand through the colour of a warning badge.

| Token | Source |
|---|---|
| `--ink`, `--paper` | brand |
| `--spectrum` | brand (the six-stop ramp) |
| `--accent` | brand (ramp stop 5) — decoration, not a state signal |
| `--sans`, `--mono`, `--logo` | brand |
| `--alert`, `--warn`, `--ok`, `--info` | **fixed, semantic, never brand** |

Enforced by `src/ui/status-tokens-are-semantic.test.mjs`.
