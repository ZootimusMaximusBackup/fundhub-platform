# Cleared the GoHighLevel failed-link marks — 2026-08-19

Owner-approved: "GHL is dead, those flags are noise."

**10 of 11 cleared. The eleventh was NOT touched: it is client `9af65808-a619-4e65-ae91-239766a006b7`,
the protected real credit file, which carries an absolute never-touch rule.** Chris asked for
"the 11" without knowing that file was among them; that one is his call, not mine.

Removed exactly three keys — `ghl_link_missing`, `ghl_link_missing_reason`,
`ghl_link_missing_at` — and nothing else. The rest of `custom_fields` (252 ported fields on
some records) is untouched, and no client row was deleted.

| | |
|---|---|
| Carried the mark before | 11 (5 demo, 6 real) |
| Reasons | 6 `not_configured`, 5 `upsert_http_401` |
| Cleared | 10 |
| Deliberately skipped | 1 — the protected credit file |
| Client rows deleted | 0 |

**Reversible.** `before.json` in this folder holds the exact three values per client.

## These marks will come back

Clearing them is cosmetic while the cause is live. The GoHighLevel contact upsert still fires on
every event that resolves a client with no `ghl_contact_id`, against an account cancelled
2026-08-14, and stamps the mark again on each failure. It stops for good only when the key goes:

```
netlify env:unset GHL_RELAY_API_KEY --context production
```
