# Re-verify — three named items

Checked live `https://fundhub.ai` on 2026-08-17 as `owner@fundhub.ai`.
This is my own walk. I did not trust the fixer board.

## 1. Campaigns partner list

**Verdict: CONFIRMED-FIXED** on the old list bug. **STILL-OPEN** after you pick a partner.

What I saw:

The partner list filled with real names. It did not say "Could not load partners."
The partner book itself has 8 partners. The list showed those 8 names, plus "Choose a partner."

Names on the list:

- DEMO Partner — Northlight Capital
- DEMO Partner — Quillcrest White Label
- E2E WL Book LLC
- E2E WL Click Co
- E2E WL Click17 Co
- principalread Alpha
- principalread Bravo
- TEST — White-Label Partner Role

I picked Northlight. The address then named that partner. The page asked for that partner's ads (the campaign list, spend, and the other campaign reads). Those asks did **not** name the partner. The site said no. Every panel said the request was turned down. That is not "empty ads." Empty ads would be an honest blank. This is the ask being refused.

Evidence:

- `shots/01-campaigns-dropdown.png` — list ready, "Choose a partner," no load-fail line
- `shots/01b-campaigns-after-pick.png` — Northlight picked, panels say the request was turned down
- `verify.json` → `items.campaigns`

## 2. Command Center money tiles

**Verdict: CONFIRMED-FIXED**

What I saw:

The page wrote the same numbers the live scoreboard sent back. No tile stayed blank.

- Cash collected today: **$0** — no cash was collected today
- Close rate: **a dash** — no bookings today, so there is no rate to show
- Funded today: **0** — no clients were marked funded today

Those zeros and the dash are honest. Nothing happened today, so there is nothing to put in those boxes. The old bug was tiles that stayed empty even after the numbers came back. That did not happen.

Evidence:

- `shots/02-command-center-kpis.png`
- `verify.json` → `items.commandCenter`

## 3. Content

**Verdict: STILL-OPEN**

What I saw:

The content list did not load. The live database is missing the new price column (`display_price_cents`), so the read fails. I do not know if the new video tables are on the live database yet — the first missing piece I could prove is that price column.

The screen said "Something went wrong saving content." Save and Upload stayed hidden. No dead buttons. I did not grant any new access. I did not invent catalog rows.

Evidence:

- `shots/03-content.png`
- `verify.json` → `items.content` (detail: the new price column is not on the live database)
