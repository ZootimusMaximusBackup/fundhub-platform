# Deploy + three builds — 2026-08-17

Chris: deploy everything, double-check, then build the three prompts, then check.

## Order

1. Pipeline hole (two CSS lines) + deploy current `main`
2. Prove live
3. Three builds in parallel after live is up

## Task list

| # | Owner | Task | Status |
|---|-------|------|--------|
| 0 | main | Stretch Pipeline columns; commit; push; one Netlify deploy | claimed |
| 1 | main | Live prove: hashes, Pipeline hole gone, sixteen smoke | pending |
| 2 | agent | Contracts vs Documents — finish the named split | pending |
| 3 | agent | Finance OS — restore company money dashboard (Plaid + subscriptions inside it) | pending |
| 4 | agent | Funding advisor fulfillment — CCP + Inquiry Remover queue | pending |

## File ownership after deploy

- W2 → `public/app/contracts.html`, `public/app/documents.html`, contract APIs already on main
- W3 → `public/app/finance-os.html` and finance APIs it already owns
- W4 → `public/app/client-control-panel.html`, `public/app/inquiry-remover.html`

Nobody else edits those files while a row is `claimed`.
