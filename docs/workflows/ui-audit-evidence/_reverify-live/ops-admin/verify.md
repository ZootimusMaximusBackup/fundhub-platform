# Live re-verify — ops-admin (owner) — 2026-08-17 20:10Z

Live https://fundhub.ai/app/ops-admin.html HTTP 200. Harness `--no-clicks`.
Evidence: `1440-fold.png` · `1440-full.png` · `audit.json` · `audit.md`

| Line | Stamp | Expected | Live | Verdict |
|---|---|---|---|---|
| 400 | CONFIRMED-FIXED HIGH | Company KPIs load | GET `/api/dashboard/kpis?period=7d` → 200. Cash $0.01, Funded 0, New Clients 36. Close rate / cost-per-funded are `—` (empty data, not a load miss). | **HOLDS** |
| 401 | CONFIRMED-FIXED HIGH | Period pill is today (Aug 17) | Pill reads `Last 7 Days — Aug 11–17`. Jul 20–26 is gone. | **HOLDS** |
| 402 | REGRESSION HIGH | Top-left = the owner's number; Demo Mode not first | After the beta bar, first content is DEMO MODE (OFF) + Turn ON. Company KPIs sit below. Turn OFF is gone (only Turn ON shows). | **STILL-REGRESSION** (placement). Toggle-only-ON is better than the old pair. |
| 403 | CONFIRMED-FIXED HIGH | Send / Pause confirm what goes out | Send / Pause / Email-unsent are not on screen. Panel says the outbound queue could not be read (harness blocked the status POST with 599). Buttons that cannot work are hidden. Confirm dialogs were not observed. | **HOLDS** on hide-when-unread. **UNVERIFIED** on the confirm text. |
| 404 | CONFIRMED-FIXED MEDIUM | One filled button; ≤4 sizes | 4 filled (period pill, Turn ON, Money tab, Chat). 7 sizes. | **DOES-NOT-HOLD** |
| 405 | CONFIRMED-FIXED LOW | Header items fit on one line | Breadcrumb, ORG, period, and clock sit on one header row. No wrap. | **HOLDS** |
