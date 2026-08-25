# Soft-pull multi-business — 2026-08-25

Owner GO: build all lanes here, test, push live. Cloud build because Chris is leaving.

## Job

One page. Client authorizes the soft pull, then pays on that same page.

Each business block: name, address, EIN, optional extra owner name.

Top note: extra owners complicate funding; say so if the company has them.

Plus button adds another full block. Product cap of 5 is gone. Safety ceiling: 20.

Price stays **$32 + $10 per business**.

Save on the client. Staff see **each business as its own fundable file**. Different state = different banks / cards. Extra owners show as a warning.

## Status

| Lane | Owner | Status |
|------|--------|--------|
| 1 Form (EIN, extra owner, plus, one-flow pay) | cloud | done |
| 2 Save (entity_data: ein, extra_owner_name, address, source) | cloud | done |
| 3 Staff screens (each business listed) | cloud | done |
| 4 Journey actual + draft intended | cloud | done |

## Do not touch

Twilio, TU, Aged Corps vendor, live credit pull, `INNGEST_EVENT_KEY`, live `verify:e2e`.

## Files (only these unless a test import forces one more)

- `public/app/soft-pull-approve.html`
- `api/soft-pull-approve.mjs`
- `src/finance/soft-pull-pricing.mjs`
- `src/finance/soft-pull-pricing.test.mjs`
- `src/http/soft-pull-approve.test.mjs`
- `src/http/client-detail.mjs`
- `src/http/client-detail.test.mjs`
- `public/app/pipeline.html` (drawer — list every business)
- `public/app/client-control-panel.html` (full file — list every business)
- `docs/journeys/client-actual.md` + `docs/journeys/CHANGELOG.md`
- `docs/journeys/soft-pull-multi-biz-intended-draft.md` (Chris approves later; do not rewrite `*-intended.md`)
- this board

No new route. No migration — store EIN + extra owner in `businesses.entity_data`.

## Proof

- Unit tests green for parse / price / client-detail list
- Form: add 2 businesses with EIN + one extra owner; total = $52; pay button after authorize
- Staff drawer / full file shows both companies, states, EIN, extra-owner warning

## Extra file (needed)

`api/dashboard/client.mjs` — businesses read was `LIMIT 5`. Raised to `LIMIT 20` so staff can see every saved company. No new route. No migration.

## Ship

- Branch: `soft-pull-multi-biz`
- PR: https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/135
- GitHub checks: same three reds as current `main` (stale diagrams / workflow registry / missing `data-open` buttons / live-spec passwords). Not from this change.
- Tests I ran: pricing / parse / save / client-detail / panel / pipeline — 142 passed. Lint clean. Journeys byte-identical (no new route).
- No live token minted — no signed soft-pull link in this environment. Form reviewed from the page source + $52 math.
