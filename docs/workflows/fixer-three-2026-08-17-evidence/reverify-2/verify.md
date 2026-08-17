# Re-verify 2 — three named items

Checked live `https://fundhub.ai` on 2026-08-17 as `owner@fundhub.ai`.
This is my own walk. I did not write the fixes. I did not trust the last report.

Live HTML matches local commit `597df13` for Campaigns, Command Center, and Content.
Every page I opened was on fundhub.ai, not my computer.

Live Playwright: **26/26 passed. Score 100/100.**

## 1. Campaigns partner list

**Verdict: CONFIRMED-FIXED**

What I saw:

The partner list filled with real names. It did not say "Could not load partners."
The partner book has 8 partners. The list showed those 8 names, plus "Choose a partner."

I picked Northlight. The address then named that partner.
The page asked for that partner's ads, spend, connections, fatigue, and action log.
Every one of those asks named the same partner. The site said yes. The lists came back empty.
That is honest. This partner has no ads yet. I did not invent ads.

The first check found those asks going out without the partner, so the site said no.
That did not happen this time.

Evidence:

- `shots/01-campaigns-dropdown.png`
- `shots/01b-campaigns-after-pick.png`
- `shots/01c-partner-select.png`
- `shots/01d-direct-partner-url.png`
- `verify.json` → `items.campaigns` and `followUpCampaignReads`

## 2. Command Center money tiles

**Verdict: CONFIRMED-FIXED**

What I saw:

The page wrote the same numbers the live scoreboard sent back. No tile stayed blank.

- Cash collected today: **$0** — no cash was collected today
- Close rate: **a dash** — no bookings today, so there is no rate to show
- Funded today: **0** — no clients were marked funded today

Those zeros and the dash are honest. Nothing happened today, so there is nothing to put in those boxes.

Evidence:

- `shots/02-command-center-kpis.png`
- `verify.json` → `items.commandCenter`

## 3. Content

**Verdict: CONFIRMED-FIXED** for the tile list and for saving tile words.
**Verdict: STILL-OPEN** for welcome videos and a stored price.

What I saw:

The content list loaded. Five catalog tiles came back. Save showed up after that read.
I saved the same tile words that were already there. The save worked. I did not invent tiles or new copy.
There were no dead Save or Upload buttons from a failed read. The read worked.

Price boxes were empty. The live scoreboard sent no stored price (`price_cents` was empty on every tile).
Welcome videos are not stored yet. The live database is still missing:

- table `content_videos`
- table `content_tier_map`
- column `entitlement_catalog.display_price_cents`

Those come from `db/migrations/171_content.sql`. That update is not applied yet.
Upload is on the screen, but a video still cannot be stored until those tables exist.
I did not invent a price or a video.

Evidence:

- `shots/03-content.png`
- `shots/03b-content-prices.png`
- `verify.json` → `items.content` and `schema`

## What Chris should click once

Open [Campaigns](https://fundhub.ai/app/campaign-manager.html), pick a partner, and look at the campaign list.
It should say there are no ads yet — not that the request was turned down.
