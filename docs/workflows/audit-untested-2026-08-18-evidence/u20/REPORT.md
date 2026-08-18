# WAVE A rollup

Date: 2026-08-18  
Wave A only. No app change. No deploy. No commit.

| id | Score |
|---|---|
| U1 | UNVERIFIED — cannot receive a magic-link safely |
| U8 | BROKEN — launch 503, oxylabs missing |
| U14 | UNVERIFIED — no Inngest run row |
| U15 | UNVERIFIED — GHL list 401, webhook 404 |
| U16 | BROKEN — this site cannot start a Bland call |
| U17 | UNVERIFIED — PostGrid door exists, 0 captures |
| U18 | BROKEN — no Connect bank door |
| U19 | 100/100 required (full suite 26/29; Company Brain extra red) |
| U20 | PASS — owner Galaxy and partner Galaxy open |

Did not open the live credit file. Did not send a magic link to the bare inbox. Did not mint a portal session as a PASS. Did not charge a card, file a bank app, or start a Bland call. Did not turn on `INNGEST_EVENT_KEY`. Did not POST a fake webhook. Did not put a vendor in demo. Did not connect social or publish. Did not click Plaid Link.

---

# U20 — Galaxy screens

Date: 2026-08-18  
Never opened: `9af65808-…`

Env names used: `STAFF_E2E_PASSWORD`, `DATABASE_URL`. Values not printed.

Did not turn marketing-enable. Did not connect Facebook / Instagram / LinkedIn. Did not publish a post.

## Ground truth

`docs/journeys/white-label-intended.md` names the marketing suite and live pages at `/sites/{partnerId}/{slug}`. It does **not** name “Galaxy” as a step.

**MISSING** journey step. Scored against Chris’s claim on the board.

## Chris’s claim

Galaxy and partner Galaxy are real screens a person can use.

## Score

**PASS.** Owner Galaxy stays open. Partner Galaxy stays open. Both paint a sky a person can see.

A closer who opens staff Galaxy is sent to the closer desk. That is not the claim.

## Prove 1 — who can open

- Owner `chris@` on `/app/galaxy.html`: **stayed**. Title “Fundhub — Galaxy.”
- Partner `partner@` on `/app/galaxy.html`: sent to `/app/partner-galaxy.html` (their door). Title “Your Galaxy — Partner View.”
- Partner on `/app/partner-galaxy.html`: **stayed.**
- Closer `closer@` on `/app/galaxy.html`: **bounced** to `/app/closer-dashboard.html`.

No Connect / Facebook / Instagram / LinkedIn / Publish buttons on these screens.

## Prove 2 — what the page shows (1440)

Owner Galaxy:

- Banner: “Beta — under development… Do not use for client decisions.”
- Title: GX-01 / READING THE SKY.
- Clusters: Leadership, Sales & Funding, Client-Facing Agents, Ops Agents, Inquiry Removal.
- Footer: “read-only — no actions from this screen.”
- Live handoff text and named work on the sky.

Partner Galaxy:

- Same sky, labeled “PARTNER VIEW — your book only.”
- Header shows their page URL: `https://fundhub.ai/sites/9defaf28-47c5-43a0-8f5e-f41ef90f360a/apply`.
- Yellow “Partner gift · Message Blaster for Mac” with a Download button.
- Money row is dashes. Bottom bar: “1 partner(s) · $0 accrued · 1 agreement(s) unsigned.”

## Prove 3 — one click each (no publish / no connect)

- Owner click on the sky: stayed on Galaxy. Zoomed into a cluster (“Sky / Client-Facing Agents”). Still read-only. No write.
- Partner Download: stayed on partner Galaxy. Did not publish. Did not connect social.

## Prove 4 — partner public page

`partner_pages` rows (ids + slug + status only):

| partner_id (prefix) | status | live GET |
|---|---|---|
| `94796e0e-…` | draft | **404** “This page is not published.” |
| `9defaf28-…` (partner@, same as G1) | draft | **404** “This page is not published.” |
| `c28b0149-…` | published | **200** (E2E WL Book LLC) |
| `068b933c-…` | published | **200** (E2E WL Click17 Co) |
| `caf277ee-…` | published | **200** (E2E WL Click Co) |

G1 still holds for `partner@`: their `/sites/…/apply` is not published. Other e2e pages are live. Did not publish.

## Evidence

- `01-owner-galaxy-1440.png`
- `02-owner-galaxy-click.png`
- `03-partner-on-galaxy.png`
- `04-partner-galaxy-1440.png`
- `05-closer-galaxy.png`
- `access.json`
- `db-pages.json`
- `sites-probe.json`
