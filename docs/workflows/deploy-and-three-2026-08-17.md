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
| 3 | agent | Finance OS — restore company money dashboard (Plaid + subscriptions inside it) | pending |
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
