# W-CONV notes

The written journeys do not name this belt. Chris’s 2026-08-18 order does. I did not invent steps. I walked this one file as far as the data goes.

## Belt on this file

1. **Inquiries removed — empty.** No `inquiry.removed` event on this file. None in the whole org either. One case from W-DESKS (`d1635579-…`) is still Queued. Nobody sent it. Nobody finished it. Inquiry log is empty.

2. **File optimized — empty.** No letter rows. No optimize events. Use of the file is still the seed 18. `src/optimize` is ad spend, not credit-file work (W-OPT). No credit-file optimizer ran here.

3. **Banks populate — empty (mock only).** One bank row: Simulated Checking, mock, mask 4242. That row was planted by simulate. It is not a real bank fill.

4. **Apply via proxy — path exists, apply does not run.** The Apply door is on the client page. The launch route exists. This file has 0 applications, 0 funding rounds, 0 proxy sessions.

## Lender matches

`GET /api/read/lender-matches?client_id=` (this file). Needs only the client id. No round id.

200. **0 matches.** Lender table for this org is **0 rows**. Same 0 on the read-compare file. Screen says: “Lender list is empty — import CSV on Lenders.”

## Proxy launch (one POST, then stop)

`POST /api/proxy/launch` with this client and a dummy lender id (no match to use).

**503 `oxylabs_credentials_missing`.** Names checked: `OXYLABS_USERNAME`, `OXYLABS_PASSWORD`. Both missing. No session row. No bank site opened.

## Extension fallback string

**MISSING on screen.** There is no route named detect-or-fallback. The page pings a Chrome add-on. If launch worked and the add-on is off, the page is supposed to show a copy-paste proxy string.

Launch never worked, so that string never painted. Designed words are saved in `04-designed-fallback-string.json`. Live screen shows the empty lender list, not the string.

## What I did not do

No second launch. No bank form. No live bureau. No card charge. Did not touch the live credit file. Did not tear down this client.
