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
| 2 | agent | Contracts vs Documents — finish the named split | done |
| 3 | agent | Finance OS — restore company money dashboard (Plaid + subscriptions inside it) | done |
| 4 | agent | Funding advisor fulfillment — CCP + Inquiry Remover queue | pending |

## File ownership after deploy

- W2 → `public/app/contracts.html`, `public/app/documents.html`, contract APIs already on main
- W3 → `public/app/finance-os.html` and finance APIs it already owns
- W4 → `public/app/client-control-panel.html`, `public/app/inquiry-remover.html`

Nobody else edits those files while a row is `claimed`.

---

## W2 — Contracts vs Documents, remaining gaps

**COMPLIANCE REVIEW REQUIRED** — Remind and Void still sit on Documents (consent / signing mail). No new action. Same APIs and role gates as before.

### Files touched this pass

| File | What |
|---|---|
| `public/app/documents.html` | Stop filing blank templates and unknown kinds as one of the four classes |
| `src/http/documents-screen.test.mjs` | Lock the four classes, the skip, and the live banner |
| `docs/workflows/deploy-and-three-2026-08-17.md` | This manifest |

Not touched: `public/app/contracts.html`, `public/app/contract-send.js`, `present.html`, `closer-call.html`, `finance-os.html`, `client-control-panel.html`, `inquiry-remover.html`, `pipeline.html`, `sidebar.fragment.html`, `shell.js`. No new route. No new field. No journey path changed, so `docs/journeys/*-actual.md` and `CHANGELOG.md` were left alone.

### Already done on main (0242ab2 and merges)

- **Contracts** is a template loader only. Title is Contract templates. Upload a PDF, add blanks, set who signs, save. No waiting / sent / signed / draft counts. No queue. No Void. No Remind. One read: `?view=templates`.
- **Documents** watches paper: four classes (soft-pull authorizations, contracts, invoices, UnderwriteIQ deliverables). Signing badge, Open PDF, Remind, Void (owner/admin only).
- Sidebar already says **Contract templates** under Admin. Left alone.
- Send still lives on Present and the closer call, via `contract-send.js`.
- Back end already has `?document_id=` and `action: "remind"`.

### What this pass closed

Documents was still showing two things that are not sent-or-received paper:

1. A blank uploaded template (`subtype = template_source`) sat in the Contracts class next to a placeholder client.
2. A file of an unnamed kind (a client upload) was filed as a soft-pull authorization. That invented a class.

Both now leave the list. The count on screen matches the four named classes. The yellow bar says how many were skipped, in plain words.

### Proof

- `npm run lint` — clean, 1295 files.
- `src/http/contracts-screen.test.mjs` — pass.
- `src/http/documents-screen.test.mjs` — pass, including the two new locks.
- `src/http/contracts-endpoints.pg.test.mjs` — skipped here (`DATABASE_URL` unset). Those tests already passed on the earlier back-end pass against local Postgres.

### Left over (not built — already Chris's call)

1. **A draft contract does not show on Documents.** A draft has no `documents` row until send. No screen lists started-but-not-sent contracts now.
2. **Staff cannot see a tamper warning in the CRM.** The signer still sees it on the signing page, and the server still refuses a bad file. Documents has no detail panel.
3. **Client uploads are not a fifth class on Documents.** They stay on the client file. This list watches the four named classes only.
4. **Not deployed. Not pushed.** Live click is the next person's job.

Nothing committed, pushed, or deployed until the commit this row asked for.

---

## W3 — Finance OS, company money

Owner call: this screen is Chris's company money, not a client's credit file. Plaid buckets are personal, business, and investment. Subscriptions here are recurring charges on those accounts, not client billing. Honest empty if the bank is not connected. No made-up balances.

The handover file (`docs/FINANCE-OS-REBUILD-HANDOVER.md`) asked this screen to pick up client plans, client cards, and payment links. That is a different job. Left alone. Payment-link create is still without a screen.

### Files touched this pass

| File | What |
|---|---|
| `public/app/finance-os.html` | Rebuild toward company money. Wire GET `/api/finance/bank-accounts` and GET `/api/finance/bills`. |
| `docs/workflows/deploy-and-three-2026-08-17.md` | This manifest |

Not touched: `public/app/contracts.html`, `documents.html`, `inquiry-remover.html`, `client-control-panel.html`, `pipeline.html`, `sidebar.fragment.html`, `shell.js`. No finance API file. No new route. No new field. No journey path changed, so `docs/journeys/*-actual.md` and `CHANGELOG.md` were left alone. No payment writer.

### What it used to be

A client's whole money picture. Pick a client, then credit scores, cash-flow bars, funding capacity, deal calculator, ask-it, soft pull, and "Load simulated data". Empty meant "pick a client" or invent a demo file.

### What this pass closed

The first thing on the page is now company money. Three account piles (personal / business / investment) and a Subscriptions list (recurring charges from `/api/finance/bills`). If the bank is not linked, the big line says **Not connected** and every pile is empty on purpose. No dollar figure is drawn unless the server sent one. Simulated data, soft pull, bureau scores, the deal box, and ask-it are off this screen.

The existing reads still need a `client_id` in the address bar. Without one, the page stays honestly empty. With one, it reads those two endpoints and groups what they return. Typed-in rows are labeled as typed-in, not as a live bank link. Plaid's connect functions are still empty seams (`src/banking/plaid.mjs`).

### Proof

- `npm run lint`
- `src/http/app-client-carry.test.mjs` — the "no invented money" lock on this file
- Finance API tests not edited this pass

### Left over (not built)

1. **Plaid still does not connect.** `linkAccount` / `getAccounts` return not implemented. No Connect button — a button that does nothing is not allowed.
2. **No org-wide account list.** Bank-accounts and bills still require a client id. Company Plaid has nowhere to land except a named file.
3. **Client billing is still without a screen.** Start / change / cancel a client's plan, attach a card, and create a payment link were not put here. Owner said those are not this dashboard.
4. **Help text is stale.** `src/chat/platform-help.mjs` still tells people to use Soft pull and Load simulated data on this screen. Not this file.
5. **Not deployed. Not pushed.**

Nothing pushed or deployed. Commit is this row's commit.
