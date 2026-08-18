# W12 — Security delta vs Fable Aug 16

**Live:** https://fundhub.ai  
**Ran:** 2026-08-18  
**Law:** findings only. No app edits.

## One-line delta

**Nothing changed vs Fable Aug 16 — no new open doors.** (The lenders list API that used to answer a closer is now shut. That is a close, not a new hole.)

## Table

| Check | Expected | Observed | vs Fable | Evidence |
|---|---|---|---|---|
| 1. Every API with no session | No data except public login / health / climate / partner-page / sign-link 404 | 171 routes. Unsigned **200** only on login, health, climate, climate config (all already public). All other GETs 401 / 405 / 400 / 404. Empty POST {} on gated writes → 401. No new data door. | same | `unsigned-summary.json` `probe.json` |
| 2. Wrong role | Blocked routes refuse. 401 vs 403 is not a door. | closer / sales / advisor: every blocked route 403 (or 405 then POST {} → 403). affiliate: refuse is 401 or 403, same mix Fable already had. **0** blocked routes returned data. | same | `probe.json` roles |
| 3. Deleted screens still on the API? | Unsigned and closer cannot use them | Pages `/app/command-center.html`, `/app/sample-data.html`, `/app/subscriptions.html` → **404**. APIs still exist: unsigned 401. closer: demo/mode **403**, subscriptions **403**. Command Center read `/api/read/finance-command` still **200** for closer (staff). Same 200 / same size Fable already saw. | same | `probe.json` pages + targeted |
| 4. Lenders API as closer | After the Aug 17 lock: closer cannot read or write the lender book | closer GET `/api/read/lenders` **403**. closer POST `/api/lenders` **403**. closer GET `/api/read/lender-observations` **403**. sales same 403. advisor GET lenders **200** (allowed). Unsigned 401. Fable closer had lenders **200**. | **fixed** | `probe.json` targeted; Fable `role-closer/route-probe.json` |
| 5. Client portal, other file id | Test client cannot load someone else’s file | Minted the existing test-client session (then revoked). Own file: portal-summary / portal-contracts **200**. Other e2e id in the URL: same **200** and **same body hash** — the server ignores the other id and still returns the signed-in person’s own file. Other id never appears in the body. Consent on the other id → **403**. Documents / pii / staff-only reads → 403 or 401. Live gmail credit file was not used. | same (W6 UI already: “We could not load your file.” API proves own-file only.) | `idor-compare.json` `probe.json` idor |
| 6. Any client-id as closer and as test client | Test client cannot use another id. Closer may open files in the same company. | Test client: other id does not change the body (see above); staff-only routes stay shut. Closer: can load the test file and the other e2e file (different sizes). That is staff work, not a new hole. Closer still cannot read pii (**403**). | same | `probe.json` idor |
| 7. Secrets in git or in live JS | No live API keys in tracked files or in the page scripts | Tracked app code: no live `sk_live`, webhook secret, or password. Three tests use **fake** keys on purpose. Live login / pipeline / portal scripts: no live keys. | same | `secrets-repo.json` `secrets-live.json` |
| 8. GitHub public? History still hold the old secret files? | Say what is true now | Repo is **public** now (`gh repo view`: visibility PUBLIC). History has **no** `.env` file, **no** `credentials/` folder, **no** files named like a client dump. Some tracked pages/scripts still have email strings (not printed). | same (still public; those named secret files are not in history) | `github.json` `history.json` |

## BROKEN (new open doors only)

None.

## Notes that are not new doors

- Affiliate still gets **401** (looks signed out) on many staff routes instead of **403**. Fable already called this a wrong status code, not an open door. Still denied.
- Climate with no session still returns a public page. Fable already had that as public-by-design.
- Sales can still call `/api/finance/subscriptions` (needs a client id). The Subscriptions **page** is gone. The API was already allowed for sales.
- `/api/read/ai-bureau-config` still **200** for closer. Fable already had that 200. The lenders lock did not include this read.

## Stop

No edits. No deploy. Board not touched.
