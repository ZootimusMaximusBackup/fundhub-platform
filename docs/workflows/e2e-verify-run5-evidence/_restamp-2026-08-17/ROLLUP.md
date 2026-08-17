# Fable board restamp — 2026-08-17 (live)

Live: https://fundhub.ai serving the same `shell.js` as local `a277622` at walk time.
Walks: `docs/workflows/e2e-verify-run5-evidence/<journey>/restamp-2026-08-17/ui-walk.json`
API: `docs/workflows/e2e-verify-run5-evidence/_restamp-2026-08-17/api-probe.json`

No invented numbers. No permission was widened.

## Already true on live before this fix

| Row | What the old board said | What live actually does |
|---|---|---|
| closer / advisor / inquiry / sales · demo/mode on every screen | 403 on every page | The shell and the three leftover callers skip the call unless you are owner or admin. Offered screens did not call it. |
| closer / advisor / inquiry / sales · campaign-manager | 400 + sample book | Hidden from the rail. Typing the address sends you home. |
| closer / advisor / inquiry / sales · Demo Mode (sample-data) | Screen shown, 403 | Hidden. Typing the address sends you home. |
| closer · + Sample data on /dashboard.html | Button shown | That page is gone. The address shows the public 404 page. |
| closer · pipeline “DEMONSTRATION STATES” | Live footer text | That sentence is not on the pipeline page any more. |
| inquiry · blocked messages panel stuck | Bad request | The read now answers. Panel can resolve. |
| inquiry · blank red strip | Empty red pill | The strip is not on the page any more. |
| affiliate · Ask 401 | Company Brain Ask blocked | Empty question answers “question required”. Landing had no failed calls. |

## Still broken on live — this fix hides or stops the bad call

| Row | What live did | What we changed |
|---|---|---|
| closer / advisor / inquiry · Ops & Admin | Still in the rail. Staff / invoices / failed-events refused. Footer blamed “not signed in”. | Hide Ops & Admin from everyone but owner and admin. Do not open those reads. |
| sales manager · Ops & Admin | Failed-events refused. Other panels work. | Same hide. Sales manager is not ops. |
| closer / advisor / inquiry · Staff & Teams, Agent Editor, Products & Commissions | Still in the rail. Staff / commissions refused. Add-person / add-product still shown. | Hide those three from anyone who is not owner, admin, or sales manager. |
| owner · hiring crash | `hire_rate_pct.toFixed is not a function` — the database sends that number as text. The yellow “loading hiring…” bar stayed because the paint died. | Treat a non-number as a dash. The bar can finish. |
| owner · campaign-manager 400 | Five reads fire with no partner picked. | Do not call those reads until a partner is chosen. Show “pick a partner”. Partner logins still read their own book. |
| client · portal calls staff-only reads | dashboard/client and read/documents refused. Banner said “not signed in for real data”. | Client no longer makes those two calls. Name comes from the session. Files say the advisor sends them. |

## Still true — not a broken button

| Row | Why it stays |
|---|---|
| /api/inquiry not configured | Chris put the phone inquiry remover on hold. The secret is not set. The inquiry screen does not call this on load. |
| banking-surface “needs Plaid” | Plaid is not turned on. There is no bank feed to show. |
| my-numbers / repair-exceptions 403 for advisor and inquiry | The code already limits those reads. The journey doc overstates who can open them. The doc is wrong, not the live gate. |
| intended vs actual group counts | The intended files name groups and counts only. The generated actual files grew. Docs, not a user-facing break. |
| signed-in partner/affiliate gets “not signed in” on staff routes | The door is shut. The message is the wrong one. Nothing leaked. |
| UNFINISHED-AUDIT / STILL-MISSING owner holds | Outbox paused, Inngest key not flipped, hiring writes, content-admin with no backend — still the same owner holds. |

## Count

Open user-facing rows on the Findings tables before this restamp (MEDIUM/LOW that a person could still hit): **about 24**.

Already gone on live, no code this pass: **10**.

Fixed in this pass (hide or stop the call): **6 clusters** (ops-admin, finance screens, hiring paint, campaign empty, client portal reads).

Left as missing data / owner hold / doc drift: **the rest**.
