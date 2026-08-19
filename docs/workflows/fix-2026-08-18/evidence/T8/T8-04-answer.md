# T8-04 — answered (was dropped in the first pass)

**Question:** would rolling Finance OS back to its old version give Chris the company money screen
he asked for?

**Answer: no.** Checked read-only against git history on 2026-08-19.

| commit | date | bank-linking code | references to one client |
|---|---|---|---|
| `75ba39a` last full client desk | 2026-08-17 | **0** hits for plaid / connect bank / link_token | 19 × `client_id` |
| `ac3057e` first ever version | 2026-07-31 | **0** hits | 4 × `client_id` |

Neither old version could ever link a bank account, and both are built around a single client's
file. Restoring either one brings back a client credit-and-cash desk, not a company screen.
This confirms the audit item as written. No code change follows from it — it is a decision input.
